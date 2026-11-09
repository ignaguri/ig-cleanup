import type { IgUser } from '../instagram/parse';
import type { DeckId, Person } from '../shared/types';

export function mergeListPage(
  existing: Map<string, Person>,
  users: IgUser[],
  list: 'followers' | 'following',
  startIndex: number,
  seenAt: number,
  // Previous scan's end during a rescan, so people who start following show up as new.
  rescanSince: number | null,
): Person[] {
  const touched = new Map<string, Person>();
  users.forEach((user, position) => {
    const current = touched.get(user.pk) ?? existing.get(user.pk);
    const base: Person = current
      ? { ...current }
      : {
          pk: user.pk,
          username: user.username,
          fullName: user.fullName,
          picUrl: user.picUrl,
          isPrivate: user.isPrivate,
          isVerified: user.isVerified,
          iFollow: false,
          followsMe: false,
          listIndex: startIndex + position,
          mutuals: null,
          mutualsFetchedAt: null,
          iFollowedAt: null,
          theyFollowedAt: null,
          decision: 'undecided',
          decidedAt: null,
        };
    touched.set(user.pk, {
      ...base,
      username: user.username,
      fullName: user.fullName,
      picUrl: user.picUrl,
      isPrivate: user.isPrivate,
      isVerified: user.isVerified,
      ...(list === 'followers'
        ? { followsMe: true, seenInFollowersAt: seenAt }
        : { iFollow: true, seenInFollowingAt: seenAt }),
      ...(list === 'followers' && rescanSince !== null && !base.followsMe
        ? { startedFollowingMe: { after: rescanSince, before: seenAt }, unfollowedMe: null }
        : {}),
    });
  });
  return [...touched.values()];
}

export function deckOf(person: Person): DeckId | null {
  if (person.iFollow && person.followsMe) {
    return 'mutual';
  }
  if (person.iFollow) {
    return 'notFollowingBack';
  }
  if (person.followsMe) {
    return 'fansNotFollowed';
  }
  return null;
}

export function buildDeck(people: Person[], deck: DeckId): Person[] {
  const dateOf = (person: Person) => (deck === 'fansNotFollowed' ? person.theyFollowedAt : person.iFollowedAt);
  return people
    .filter((person) => deckOf(person) === deck && person.decision === 'undecided')
    .sort((a, b) => {
      const dateA = dateOf(a);
      const dateB = dateOf(b);
      if (dateA !== null && dateB !== null && dateA !== dateB) {
        return dateA - dateB;
      }
      if ((dateA === null) !== (dateB === null)) {
        return dateA === null ? 1 : -1;
      }
      return a.listIndex - b.listIndex;
    });
}

export function deckCounts(people: Person[]): Record<DeckId, { remaining: number; total: number }> {
  const counts: Record<DeckId, { remaining: number; total: number }> = {
    notFollowingBack: { remaining: 0, total: 0 },
    fansNotFollowed: { remaining: 0, total: 0 },
    mutual: { remaining: 0, total: 0 },
  };
  for (const person of people) {
    const deck = deckOf(person);
    if (deck === null) {
      continue;
    }
    counts[deck].total += 1;
    if (person.decision === 'undecided') {
      counts[deck].remaining += 1;
    }
  }
  return counts;
}
