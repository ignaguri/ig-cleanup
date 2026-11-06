import type { CollectionState, DeckId, Person } from '../shared/types';
import { deckOf } from './people';

export const INITIAL_COLLECTION: CollectionState = {
  followers: { done: false, nextMaxId: null, seen: 0 },
  following: { done: false, nextMaxId: null, seen: 0 },
  listsCompletedAt: null,
  mutualsCompletedAt: null,
  refreshingPictures: false,
  modeBeforeRefresh: null,
};

const DECK_ORDER: DeckId[] = ['notFollowingBack', 'fansNotFollowed', 'mutual'];

export function nextListStep(s: CollectionState): 'followers' | 'following' | null {
  if (!s.followers.done) {
    return 'followers';
  }
  if (!s.following.done) {
    return 'following';
  }
  return null;
}

export function nextMutualsTarget(people: Person[], sentPks: Set<string>): Person | null {
  let best: Person | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const p of people) {
    const deck = deckOf(p);
    if (deck === null || p.mutualsFetchedAt !== null || sentPks.has(p.pk)) {
      continue;
    }
    const rank = DECK_ORDER.indexOf(deck);
    if (rank < bestRank || (rank === bestRank && best !== null && p.listIndex < best.listIndex)) {
      best = p;
      bestRank = rank;
    }
  }
  return best;
}

export function collectionProgress(
  s: CollectionState,
  people: Person[],
): { phase: 'lists' | 'mutuals' | 'done'; listsSeen: number; mutualsDone: number; mutualsTotal: number } {
  const inDecks = people.filter((p) => deckOf(p) !== null);
  let phase: 'lists' | 'mutuals' | 'done' = 'lists';
  if (s.followers.done && s.following.done) {
    phase = s.mutualsCompletedAt !== null ? 'done' : 'mutuals';
  }
  return {
    phase,
    listsSeen: s.followers.seen + s.following.seen,
    mutualsDone: inDecks.filter((p) => p.mutualsFetchedAt !== null).length,
    mutualsTotal: inDecks.length,
  };
}
