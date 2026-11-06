import { INITIAL_COLLECTION, nextListStep, nextMutualsTarget } from '../core/collection';
import { randomDelay } from '../core/pacing';
import { mergeListPage } from '../core/people';
import { actionsByStatus, allPeople, getMeta, putPeople, setMeta } from '../db/db';
import { kick } from '../deck/lib/decide';
import { fetchFollowersPage, fetchFollowingPage, fetchMutuals, sessionBlock } from '../instagram/client';
import { IgBlockedError, IgRetryableError, IgShapeError } from '../instagram/errors';
import { readSession } from '../instagram/transport';
import {
  LIST_DELAY_MS,
  MAX_ATTEMPTS,
  META_ACCOUNT,
  META_BLOCK,
  META_COLLECTION,
  META_MODE,
  MUTUALS_DELAY_MS,
} from '../shared/constants';
import { log } from '../shared/log';
import type { AccountMeta, BlockInfo, CollectionState, Mode, Person } from '../shared/types';

export type CollectorHandle = { stop(): Promise<void> };

type CollectorRun = { handle: CollectorHandle; isStopping: () => boolean; finished: Promise<void> };

class CursorStalledError extends Error {
  constructor(public endpoint: string) {
    super('Cursor did not advance');
    this.name = 'CursorStalledError';
  }
}

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

  function blockFromError(error: unknown, stepLabel: string): BlockInfo {
    const at = Date.now();
    if (error instanceof IgBlockedError) {
      return error.info;
    }
    if (error instanceof IgShapeError) {
      return {
        reason: 'non_json',
        status: error.status ?? 0,
        endpoint: error.endpoint,
        excerpt: (error.excerpt ?? error.message).slice(0, 200),
        at,
      };
    }
    if (error instanceof CursorStalledError) {
      return { reason: 'non_json', status: 0, endpoint: error.endpoint, excerpt: error.message, at };
    }
    log.error('collector failed', error);
    return {
      reason: 'non_json',
      status: 0,
      endpoint: stepLabel,
      excerpt: `Unexpected: ${error instanceof Error ? error.message : String(error)}`,
      at,
    };
  }

  async function run(): Promise<void> {
    let stepLabel = 'setup';
    try {
      await previousFinished;
      if (stopped) {
        return;
      }
      const peopleByPk = new Map<string, Person>((await allPeople()).map((p) => [p.pk, p]));
      let collection = (await getMeta<CollectionState>(META_COLLECTION)) ?? INITIAL_COLLECTION;

      if ((await getMeta<AccountMeta>(META_ACCOUNT)) === undefined) {
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
        await setMeta<AccountMeta>(META_ACCOUNT, { userId: session.userId, username: null });
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
          const restoredMode = collection.modeBeforeRefresh ?? 'paused';
          collection = { ...collection, refreshingPictures: false, modeBeforeRefresh: null };
          await setMeta(META_COLLECTION, collection);
          await setMeta<Mode>(META_MODE, restoredMode);
          kick();
          onUpdate();
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
            if (collection.refreshingPictures) {
              const refreshed: Person[] = [];
              for (const user of page.users) {
                const known = peopleByPk.get(user.pk);
                if (known) {
                  refreshed.push({ ...known, picUrl: user.picUrl });
                }
              }
              await putPeople(refreshed);
              for (const p of refreshed) {
                peopleByPk.set(p.pk, p);
              }
            } else {
              const touched = mergeListPage(peopleByPk, page.users, listStep, cursor.seen);
              await putPeople(touched);
              for (const p of touched) {
                peopleByPk.set(p.pk, p);
              }
            }
            const updatedCursor = {
              done: page.nextMaxId === null,
              nextMaxId: page.nextMaxId,
              seen: cursor.seen + page.users.length,
            };
            collection = { ...collection, [listStep]: updatedCursor };
            if (listStep === 'following' && updatedCursor.done && !collection.refreshingPictures) {
              collection = { ...collection, listsCompletedAt: Date.now() };
            }
            if (collection.refreshingPictures && nextListStep(collection) === null) {
              const restoredMode = collection.modeBeforeRefresh ?? 'paused';
              collection = { ...collection, refreshingPictures: false, modeBeforeRefresh: null };
              await setMeta(META_COLLECTION, collection);
              await setMeta<Mode>(META_MODE, restoredMode);
              kick();
              onUpdate();
              return;
            }
          } else {
            const sentPks = new Set((await actionsByStatus('sent')).map((a) => a.personPk));
            const target = nextMutualsTarget([...peopleByPk.values()], sentPks);
            if (target === null) {
              collection = { ...collection, mutualsCompletedAt: Date.now() };
              await setMeta(META_COLLECTION, collection);
              // Never start sending unattended: the user turns sending on.
              await setMeta<Mode>(META_MODE, 'paused');
              onUpdate();
              return;
            }
            delayRange = MUTUALS_DELAY_MS;
            const preview = await fetchMutuals(target.pk);
            if (stopped) {
              return;
            }
            const updated = { ...target, mutuals: preview, mutualsFetchedAt: Date.now() };
            await putPeople([updated]);
            peopleByPk.set(updated.pk, updated);
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
      await block(blockFromError(error, stepLabel));
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
