import type { Person, RescanState } from '../shared/types';

const FOLLOW_CHECK_BATCH = 40;

// A fan nobody has asked Instagram about yet. Hidden from the decks until then.
export function awaitsFollowCheck(person: Person): boolean {
  return needsFollowCheck(person, null);
}

// Instagram's following list skips people, so anyone it leaves out is asked about directly:
// fans, and in a rescan also the people I followed who didn't come back in the list.
export function needsFollowCheck(person: Person, scan: RescanState | null): boolean {
  const since = scan?.startedAt ?? 0;
  if ((person.followCheckedAt ?? -1) >= since) {
    return false;
  }
  if (person.followsMe && !person.iFollow) {
    return true;
  }
  return scan !== null && person.iFollow && (person.seenInFollowingAt ?? 0) < scan.startedAt;
}

export function nextFollowCheckBatch(people: Person[], scan: RescanState | null): Person[] {
  return people.filter((person) => needsFollowCheck(person, scan)).slice(0, FOLLOW_CHECK_BATCH);
}

// An account missing from the answer is gone, so it isn't followed.
export function applyFollowCheck(people: Person[], followStatuses: Map<string, boolean>, checkedAt: number): Person[] {
  return people.map((person) => {
    const iFollow = followStatuses.get(person.pk) ?? false;
    return {
      ...person,
      iFollow,
      followCheckedAt: checkedAt,
      ...(iFollow ? { seenInFollowingAt: checkedAt } : {}),
    };
  });
}
