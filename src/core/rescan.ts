import type { Person, RescanState, ScanSummary, TimeWindow } from '../shared/types';

// Above this share missing, a list is more likely incomplete than real changes.
const MAX_LOST_SHARE = 0.1;

function missedBy(seenAt: number | undefined, scan: RescanState): boolean {
  return (seenAt ?? 0) < scan.startedAt;
}

function missingFollowers(people: Person[], scan: RescanState): Person[] {
  return people.filter((person) => person.followsMe && missedBy(person.seenInFollowersAt, scan));
}

function missingFollowing(people: Person[], scan: RescanState): Person[] {
  return people.filter((person) => person.iFollow && missedBy(person.seenInFollowingAt, scan));
}

// People I removed or unfollowed myself are expected to be missing, so they don't make a list look short.
function looksShort(
  people: Person[],
  inList: (person: Person) => boolean,
  missing: (people: Person[]) => Person[],
  expectedGone: Set<string>,
): boolean {
  const counted = people.filter((person) => !expectedGone.has(person.pk));
  const listed = counted.filter(inList).length;
  return missing(counted).length > Math.max(10, listed * MAX_LOST_SHARE);
}

export function followersDiffLooksWrong(people: Person[], scan: RescanState, removedPks: Set<string>): boolean {
  return looksShort(
    people,
    (person) => person.followsMe,
    (counted) => missingFollowers(counted, scan),
    removedPks,
  );
}

export function followingDiffLooksWrong(people: Person[], scan: RescanState, unfollowedPks: Set<string>): boolean {
  return looksShort(
    people,
    (person) => person.iFollow,
    (counted) => missingFollowing(counted, scan),
    unfollowedPks,
  );
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

// After a full following pass: whoever isn't in it was unfollowed (here or on Instagram).
export function dropMissingFollowing(people: Person[], scan: RescanState): Person[] {
  return missingFollowing(people, scan).map((person) => ({ ...person, iFollow: false }));
}

// While the following list is being re-read, people first seen in this rescan may look like fans.
export function isUnsettledInRescan(
  person: Person,
  scan: RescanState | null | undefined,
  followingDone: boolean,
): boolean {
  return scan != null && !followingDone && (person.startedFollowingMe?.before ?? 0) >= scan.startedAt;
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
    followingDiffSkipped: scan.followingDiffSkipped ?? false,
  };
}
