import { MUTUALS_PATH } from '../instagram/endpoints';
import type { CollectionState, DeckId, ListCursor, Person, ProfileCounts, RescanState } from '../shared/types';
import { decisionImplies } from './decisions';
import { followCheckedInScan, needsFollowCheck } from './follow-check';
import { deckOf } from './people';

export const INITIAL_COLLECTION: CollectionState = {
  followers: { done: false, nextMaxId: null, seen: 0 },
  following: { done: false, nextMaxId: null, seen: 0 },
  listsCompletedAt: null,
  mutualsCompletedAt: null,
  refreshingPictures: false,
  modeBeforeRefresh: null,
  rescan: null,
};

// Mutuals are only fetched for the two non-mutual decks: the shared budget is ~250 calls a day.
const DECK_ORDER: DeckId[] = ['notFollowingBack', 'fansNotFollowed'];

export function fetchesMutuals(person: Person): boolean {
  const deck = deckOf(person);
  return deck !== null && DECK_ORDER.includes(deck);
}

// Decided people no longer need their people in common, so they don't spend the daily budget.
function needsMutuals(person: Person): boolean {
  return fetchesMutuals(person) && person.mutualsFetchedAt === null && person.decision === 'undecided';
}

export function nextListStep(collection: CollectionState): 'followers' | 'following' | null {
  if (!collection.followers.done) {
    return 'followers';
  }
  if (!collection.following.done) {
    return 'following';
  }
  return null;
}

export function nextMutualsTarget(people: Person[], sentPks: Set<string>): Person | null {
  let best: Person | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const person of people) {
    const deck = deckOf(person);
    if (deck === null || !needsMutuals(person) || sentPks.has(person.pk)) {
      continue;
    }
    const rank = DECK_ORDER.indexOf(deck);
    if (rank < bestRank || (rank === bestRank && best !== null && person.listIndex < best.listIndex)) {
      best = person;
      bestRank = rank;
    }
  }
  return best;
}

export type Progress = { done: number; total: number };

// Lists repeat people, so only accounts seen in this pass count, and a list isn't full until Instagram says it's over.
function listProgress(cursor: ListCursor, total: number, seen: number): Progress {
  return { done: cursor.done ? total : Math.min(seen, Math.max(total - 1, 0)), total };
}

// A rescan expects what the last scan found.
function rescanListProgress(collection: CollectionState, people: Person[], scan: RescanState): Progress {
  const seenSince = (seenAt: number | undefined) => (seenAt ?? 0) >= scan.startedAt;
  const progressOf = (cursor: ListCursor, expected: (person: Person) => boolean, seen: (person: Person) => boolean) =>
    listProgress(
      cursor,
      people.filter((person) => expected(person) || seen(person)).length,
      people.filter(seen).length,
    );
  const followers = progressOf(
    collection.followers,
    (person) => person.followsMe && !decisionImplies(person.decision, 'remove'),
    (person) => seenSince(person.seenInFollowersAt),
  );
  const following = progressOf(
    collection.following,
    (person) => person.iFollow && !decisionImplies(person.decision, 'unfollow'),
    (person) => seenSince(person.seenInFollowingAt),
  );
  return { done: followers.done + following.done, total: followers.total + following.total };
}

// The first scan expects what the profile says.
function firstScanListProgress(collection: CollectionState, people: Person[], counts: ProfileCounts): Progress {
  const progressOf = (cursor: ListCursor, expected: number, seen: number) =>
    listProgress(cursor, Math.max(expected, seen), seen);
  const followers = progressOf(
    collection.followers,
    counts.followers,
    people.filter((person) => person.seenInFollowersAt !== undefined).length,
  );
  const following = progressOf(
    collection.following,
    counts.following,
    people.filter((person) => person.seenInFollowingAt !== undefined).length,
  );
  return { done: followers.done + following.done, total: followers.total + following.total };
}

function scanListsProgress(collection: CollectionState, people: Person[]): Progress | null {
  if (collection.rescan) {
    return rescanListProgress(collection, people, collection.rescan);
  }
  if (collection.listsCompletedAt === null && collection.profileCounts) {
    return firstScanListProgress(collection, people, collection.profileCounts);
  }
  return null;
}

export function collectionProgress(
  collection: CollectionState,
  people: Person[],
): {
  phase: 'lists' | 'mutuals' | 'done';
  listsSeen: number;
  lists: Progress | null;
  // People the following list left out, still to be confirmed with Instagram.
  followChecksLeft: number;
  followChecks: Progress;
  mutualsDone: number;
  mutualsTotal: number;
} {
  const inDecks = people.filter(fetchesMutuals);
  let phase: 'lists' | 'mutuals' | 'done' = 'lists';
  const listsRead = collection.followers.done && collection.following.done;
  const scan = collection.rescan ?? null;
  const followChecksLeft = listsRead ? people.filter((person) => needsFollowCheck(person, scan)).length : 0;
  if (listsRead && followChecksLeft === 0 && scan === null) {
    phase = collection.mutualsCompletedAt !== null ? 'done' : 'mutuals';
  }
  const followChecksDone = people.filter((person) => followCheckedInScan(person, scan)).length;
  return {
    phase,
    listsSeen: collection.followers.seen + collection.following.seen,
    lists: scanListsProgress(collection, people),
    followChecksLeft,
    followChecks: { done: followChecksDone, total: followChecksDone + followChecksLeft },
    mutualsDone: inDecks.filter((person) => !needsMutuals(person)).length,
    mutualsTotal: inDecks.length,
  };
}

// A 429 on one person's mutuals skips them, unless the request before it was a 429 on a different person.
export function skipsMutuals429(
  targetPk: string,
  previous: { endpoint: string; status: number | null } | undefined,
): boolean {
  if (previous === undefined || previous.status !== 429) {
    return true;
  }
  const previousPk = MUTUALS_PATH.exec(previous.endpoint)?.[1];
  return previousPk === undefined || previousPk === targetPk;
}
