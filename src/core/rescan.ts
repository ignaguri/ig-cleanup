import type { Person, RescanState, ScanSummary, TimeWindow } from '../shared/types';

// Above this share missing, a list is more likely incomplete than real changes.
const MAX_LOST_SHARE = 0.1;

function missedBy(seenAt: number | undefined, scan: RescanState): boolean {
  return (seenAt ?? 0) < scan.startedAt;
}

function missingFollowers(people: Person[], scan: RescanState): Person[] {
  return people.filter((person) => person.followsMe && missedBy(person.seenInFollowersAt, scan));
}

// People I removed myself are expected to be missing, so they don't make the list look short.
export function followersDiffLooksWrong(people: Person[], scan: RescanState, removedPks: Set<string>): boolean {
  const counted = people.filter((person) => !removedPks.has(person.pk));
  const listed = counted.filter((person) => person.followsMe).length;
  return missingFollowers(counted, scan).length > Math.max(10, listed * MAX_LOST_SHARE);
}

// After a full followers pass. People I removed myself aren't counted as having left.
// Someone I kept who left while I still follow them is back to undecided, so they come up again.
export function dropMissingFollowers(
  people: Person[],
  scan: RescanState,
  now: number,
  removedPks: Set<string>,
): Person[] {
  return missingFollowers(people, scan).map((person) => {
    if (removedPks.has(person.pk)) {
      return { ...person, followsMe: false };
    }
    const reopen = person.iFollow && person.decision === 'keep';
    return {
      ...person,
      followsMe: false,
      // Last seen as a follower is a tighter start than the previous scan, which may have been skipped.
      unfollowedMe: { after: person.seenInFollowersAt ?? scan.previousAt, before: now },
      startedFollowingMe: null,
      ...(reopen ? { decision: 'undecided' as const, decidedAt: null } : {}),
    };
  });
}

export function summarizeScan(people: Person[], scan: RescanState, completedAt: number): ScanSummary {
  const sinceThisScan = (timeWindow: TimeWindow | null | undefined) =>
    timeWindow != null && timeWindow.before >= scan.startedAt;
  return {
    startedAt: scan.startedAt,
    completedAt,
    followers: people.filter((person) => person.followsMe).length,
    following: people.filter((person) => person.iFollow).length,
    lostFollowers: people.filter((person) => sinceThisScan(person.unfollowedMe)).length,
    newFollowers: people.filter((person) => sinceThisScan(person.startedFollowingMe)).length,
    followersDiffSkipped: scan.followersDiffSkipped ?? false,
  };
}
