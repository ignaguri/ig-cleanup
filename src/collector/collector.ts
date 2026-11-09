import { INITIAL_COLLECTION, nextListStep, nextMutualsTarget, skipsMutuals429 } from '../core/collection';
import { randomDelay } from '../core/pacing';
import { mergeListPage } from '../core/people';
import {
  dropMissingFollowers,
  dropMissingFollowing,
  followersDiffLooksWrong,
  followingDiffLooksWrong,
  summarizeScan,
} from '../core/rescan';
import { actionsByStatus, allActions, allPeople, getMeta, mergePeople, recentRequests, setMeta } from '../db/db';
import { kick } from '../deck/lib/decide';
import { fetchFollowersPage, fetchFollowingPage, fetchMutuals, sessionBlock } from '../instagram/client';
import { blockFromError, IgBlockedError, IgNotFoundError, IgRetryableError, IgShapeError } from '../instagram/errors';
import { readSession, readUsername } from '../instagram/transport';
import {
  LIST_DELAY_MS,
  MAX_ATTEMPTS,
  META_ACCOUNT,
  META_BLOCK,
  META_COLLECTION,
  META_MODE,
  META_SCANS,
  MUTUALS_DELAY_MS,
} from '../shared/constants';
import { log } from '../shared/log';
import type {
  AccountMeta,
  ActionType,
  BlockInfo,
  CollectionState,
  Mode,
  MutualPreview,
  Person,
  RescanState,
  ScanSummary,
} from '../shared/types';

export type CollectorHandle = { stop(): Promise<void> };

type CollectorRun = { handle: CollectorHandle; isStopping: () => boolean; finished: Promise<void> };

class CursorStalledError extends Error {
  constructor(public endpoint: string) {
    super('Cursor did not advance');
    this.name = 'CursorStalledError';
  }
}

// Long enough for a send already claimed before the switch to collecting to finish (relay timeout is 45 s).
const SEND_SETTLE_MS = 50000;

let activeRun: CollectorRun | null = null;

export function startCollector(onUpdate: () => void): CollectorHandle {
  if (activeRun !== null && !activeRun.isStopping()) {
    return activeRun.handle;
  }
  // A run that is still exiting may have a request in flight: never overlap two runs.
  const previousFinished = activeRun?.finished ?? Promise.resolve();

  let stopped = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;
  let markFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    markFinished = resolve;
  });

  const handle: CollectorHandle = {
    stop() {
      stopped = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      wake?.();
      return finished;
    },
  };
  const thisRun: CollectorRun = { handle, isStopping: () => stopped, finished };

  function release(): void {
    if (activeRun === thisRun) {
      activeRun = null;
    }
    markFinished();
  }

  function sleep(ms: number): Promise<void> {
    if (stopped) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      wake = resolve;
      timerId = setTimeout(resolve, ms);
    });
  }

  async function block(info: BlockInfo): Promise<void> {
    try {
      await setMeta(META_BLOCK, info);
    } catch (writeError) {
      log.error('could not persist block', writeError, info);
    }
    onUpdate();
  }

  function collectorBlock(error: unknown, stepLabel: string): BlockInfo {
    const at = Date.now();
    if (error instanceof CursorStalledError) {
      return { reason: 'non_json', status: 0, endpoint: error.endpoint, excerpt: error.message, at };
    }
    if (!(error instanceof IgBlockedError || error instanceof IgShapeError)) {
      log.error('collector failed', error);
    }
    return blockFromError(error, stepLabel, at);
  }

  async function finishRefresh(collection: CollectionState): Promise<void> {
    await setMeta(META_COLLECTION, { ...collection, refreshingPictures: false, modeBeforeRefresh: null });
    await setMeta<Mode>(META_MODE, collection.modeBeforeRefresh ?? 'paused');
    kick();
    onUpdate();
  }

  // Applies a diff to the stored records, so decisions made meanwhile survive.
  async function applyDiff(diff: (people: Person[]) => Person[]): Promise<void> {
    const pks = diff(await allPeople()).map((person) => person.pk);
    if (pks.length > 0) {
      await mergePeople(pks, (current) => diff([...current.values()]));
    }
  }

  // A write that failed with "check on Instagram" may still have gone out, so failed ones count too.
  async function actedOnPks(type: ActionType): Promise<Set<string>> {
    const actions = await allActions();
    return new Set(
      actions
        .filter((action) => action.type === type && (action.status === 'sent' || action.status === 'failed'))
        .map((action) => action.personPk),
    );
  }

  async function finishFollowersPass(scan: RescanState): Promise<boolean> {
    const removedPks = await actedOnPks('remove');
    if (followersDiffLooksWrong(await allPeople(), scan, removedPks)) {
      log.warn('followers list came back much shorter than stored, not marking anyone as gone');
      return true;
    }
    const now = Date.now();
    await applyDiff((people) => dropMissingFollowers(people, scan, now, removedPks));
    return false;
  }

  async function finishRescan(scan: RescanState): Promise<void> {
    const followingDiffSkipped = followingDiffLooksWrong(await allPeople(), scan, await actedOnPks('unfollow'));
    if (followingDiffSkipped) {
      log.warn('following list came back much shorter than stored, not dropping anyone from it');
    } else {
      await applyDiff((people) => dropMissingFollowing(people, scan));
    }
    const summary = summarizeScan(await allPeople(), { ...scan, followingDiffSkipped }, Date.now());
    const scans = (await getMeta<ScanSummary[]>(META_SCANS)) ?? [];
    await setMeta<ScanSummary[]>(META_SCANS, [...scans, summary]);
  }

  async function run(): Promise<void> {
    let stepLabel = 'setup';
    try {
      await previousFinished;
      if (stopped) {
        return;
      }
      // A send claimed just before the switch to collecting may still be in flight: never overlap with it.
      for (let waited = 0; waited < SEND_SETTLE_MS && (await actionsByStatus('sending')).length > 0; waited += 1000) {
        await sleep(1000);
      }
      if (stopped) {
        return;
      }
      let collection = (await getMeta<CollectionState>(META_COLLECTION)) ?? INITIAL_COLLECTION;

      const storedAccount = await getMeta<AccountMeta>(META_ACCOUNT);
      if (storedAccount?.username === null) {
        // Accounts collected before usernames were stored: collecting opens the relay tab anyway.
        const username = await readUsername(storedAccount.userId, { openTab: true });
        if (username !== null) {
          await setMeta<AccountMeta>(META_ACCOUNT, { ...storedAccount, username });
        }
      }
      if (storedAccount === undefined) {
        const session = await readSession();
        if (session === null) {
          await block({
            reason: 'login_required',
            status: 0,
            endpoint: 'session',
            excerpt: 'No Instagram session found',
            at: Date.now(),
          });
          return;
        }
        // Collecting needs the relay tab anyway.
        const username = await readUsername(session.userId, { openTab: true });
        await setMeta<AccountMeta>(META_ACCOUNT, { userId: session.userId, username });
      }

      let attempts = 0;
      let delayRange = LIST_DELAY_MS;

      while (!stopped) {
        const mode = await getMeta<Mode>(META_MODE);
        const existingBlock = await getMeta<BlockInfo | null>(META_BLOCK);
        if (stopped || mode !== 'collecting' || (existingBlock ?? null) !== null) {
          return;
        }
        const accountBlock = await sessionBlock(Date.now());
        if (accountBlock) {
          await block(accountBlock);
          return;
        }

        const listStep = nextListStep(collection);

        if (collection.refreshingPictures && listStep === null) {
          await finishRefresh(collection);
          return;
        }

        stepLabel = listStep ?? 'mutuals';
        try {
          if (listStep !== null) {
            delayRange = LIST_DELAY_MS;
            const cursor = collection[listStep];
            const page = await (listStep === 'followers' ? fetchFollowersPage : fetchFollowingPage)(cursor.nextMaxId);
            if (stopped) {
              return;
            }
            if (page.nextMaxId !== null && page.nextMaxId === cursor.nextMaxId) {
              throw new CursorStalledError(listStep);
            }
            // Merged onto the stored records, so decisions made meanwhile survive.
            const pagePks = page.users.map((user) => user.pk);
            if (collection.refreshingPictures) {
              await mergePeople(pagePks, (current) =>
                page.users.flatMap((user) => {
                  const known = current.get(user.pk);
                  return known ? [{ ...known, picUrl: user.picUrl }] : [];
                }),
              );
            } else {
              const seenAt = Date.now();
              const rescanSince = collection.rescan?.previousAt ?? null;
              await mergePeople(pagePks, (current) =>
                mergeListPage(current, page.users, listStep, cursor.seen, seenAt, rescanSince),
              );
            }
            const updatedCursor = {
              done: page.nextMaxId === null,
              nextMaxId: page.nextMaxId,
              seen: cursor.seen + page.users.length,
            };
            collection = { ...collection, [listStep]: updatedCursor };
            const scan = collection.rescan ?? null;
            if (scan !== null && updatedCursor.done && listStep === 'followers') {
              const skipped = await finishFollowersPass(scan);
              collection = { ...collection, rescan: { ...scan, followersDiffSkipped: skipped } };
            }
            if (listStep === 'following' && updatedCursor.done && !collection.refreshingPictures) {
              collection = { ...collection, listsCompletedAt: Date.now() };
              if (scan !== null) {
                await finishRescan(scan);
                // New people get their people in common next.
                collection = { ...collection, rescan: null, mutualsCompletedAt: null };
              }
            }
            if (collection.refreshingPictures && nextListStep(collection) === null) {
              await finishRefresh(collection);
              return;
            }
          } else {
            const sentPks = new Set((await actionsByStatus('sent')).map((action) => action.personPk));
            const target = nextMutualsTarget(await allPeople(), sentPks);
            if (target === null) {
              collection = { ...collection, mutualsCompletedAt: Date.now() };
              await setMeta(META_COLLECTION, collection);
              // Never start sending unattended: the user turns sending on.
              await setMeta<Mode>(META_MODE, 'paused');
              onUpdate();
              return;
            }
            delayRange = MUTUALS_DELAY_MS;
            let preview: MutualPreview | null;
            try {
              preview = await fetchMutuals(target.pk);
            } catch (error) {
              if (error instanceof IgNotFoundError) {
                log.warn('account not found, skipping its people in common', target.pk);
                preview = null;
              } else if (!(error instanceof IgBlockedError) || error.info.status !== 429) {
                throw error;
              } else {
                // recentRequests is newest first: [0] is this 429, [1] the request before it.
                const previous = (await recentRequests())[1];
                if (!skipsMutuals429(target.pk, previous)) {
                  throw error;
                }
                log.warn('mutuals unavailable for one person, skipping', target.pk);
                preview = null;
              }
            }
            if (stopped) {
              return;
            }
            const fetchedAt = Date.now();
            await mergePeople([target.pk], (current) => {
              const latest = current.get(target.pk);
              return latest ? [{ ...latest, mutuals: preview, mutualsFetchedAt: fetchedAt }] : [];
            });
          }
          await setMeta(META_COLLECTION, collection);
          attempts = 0;
          onUpdate();
        } catch (error) {
          if (error instanceof IgRetryableError && !stopped) {
            attempts += 1;
            if (attempts >= MAX_ATTEMPTS) {
              await block({
                reason: 'non_json',
                status: error.status ?? 0,
                endpoint: stepLabel,
                excerpt: `Gave up after ${MAX_ATTEMPTS} network failures: ${error.message}`,
                at: Date.now(),
              });
              return;
            }
            log.warn('retryable failure', stepLabel, error);
            await sleep(3 * randomDelay(delayRange, Math.random));
            continue;
          }
          throw error;
        }
        await sleep(randomDelay(delayRange, Math.random));
      }
    } catch (error) {
      // A real Instagram block must be recorded even if the user stopped meanwhile.
      if (stopped && !(error instanceof IgBlockedError)) {
        return;
      }
      await block(collectorBlock(error, stepLabel));
    } finally {
      release();
    }
  }

  activeRun = thisRun;
  run().catch((error) => {
    log.error('collector crashed', error);
  });

  return handle;
}
