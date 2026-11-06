import { INITIAL_COLLECTION, nextListStep, nextMutualsTarget } from '../core/collection';
import { randomDelay } from '../core/pacing';
import { mergeListPage } from '../core/people';
import { actionsByStatus, allPeople, getMeta, putPeople, setMeta } from '../db/db';
import { fetchFollowersPage, fetchFollowingPage, fetchMutuals } from '../instagram/client';
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

export function startCollector(onUpdate: () => void): { stop(): void } {
  let stopped = false;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      wake = resolve;
      timerId = setTimeout(resolve, ms);
    });
  }

  async function block(info: BlockInfo): Promise<void> {
    await setMeta(META_BLOCK, info);
    onUpdate();
  }

  async function run(): Promise<void> {
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

      const listStep = nextListStep(collection);
      let stepLabel = 'mutuals';
      try {
        if (listStep !== null) {
          stepLabel = listStep;
          delayRange = LIST_DELAY_MS;
          const cursor = collection[listStep];
          const page = await (listStep === 'followers' ? fetchFollowersPage : fetchFollowingPage)(cursor.nextMaxId);
          if (stopped) {
            return;
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
            onUpdate();
            return;
          }
        } else {
          const sentPks = new Set((await actionsByStatus('sent')).map((a) => a.personPk));
          const target = nextMutualsTarget([...peopleByPk.values()], sentPks);
          if (target === null) {
            collection = { ...collection, mutualsCompletedAt: Date.now() };
            await setMeta(META_COLLECTION, collection);
            await setMeta<Mode>(META_MODE, 'sending');
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
        if (stopped) {
          return;
        }
        if (error instanceof IgBlockedError) {
          await block(error.info);
          return;
        }
        if (error instanceof IgShapeError) {
          await block({
            reason: 'non_json',
            status: 0,
            endpoint: error.endpoint,
            excerpt: error.message.slice(0, 200),
            at: Date.now(),
          });
          return;
        }
        if (error instanceof IgRetryableError) {
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
        log.error('collector failed', error);
        await block({
          reason: 'non_json',
          status: 0,
          endpoint: stepLabel,
          excerpt: `Unexpected: ${error instanceof Error ? error.message : String(error)}`,
          at: Date.now(),
        });
        return;
      }
      await sleep(randomDelay(delayRange, Math.random));
    }
  }

  run().catch((error) => {
    log.error('collector crashed', error);
  });

  return {
    stop() {
      stopped = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
      wake?.();
    },
  };
}
