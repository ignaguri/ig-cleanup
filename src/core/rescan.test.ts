import { describe, expect, it } from 'vitest';
import type { Person } from '../shared/types';
import {
  dropMissingFollowers,
  dropMissingFollowing,
  followersDiffLooksWrong,
  followingDiffLooksWrong,
  summarizeScan,
} from './rescan';

const scan = { startedAt: 100, previousAt: 10 };
const none = new Set<string>();

function person(overrides: Partial<Person>): Person {
  return {
    pk: 'x',
    username: 'x',
    fullName: '',
    picUrl: '',
    isPrivate: false,
    isVerified: false,
    iFollow: false,
    followsMe: false,
    listIndex: 0,
    mutuals: null,
    mutualsFetchedAt: null,
    iFollowedAt: null,
    theyFollowedAt: null,
    decision: 'undecided',
    decidedAt: null,
    ...overrides,
  };
}

describe('dropMissingFollowers', () => {
  it('marks followers missing from this scan, reopens only a kept one, and skips people I removed', () => {
    const people = [
      person({ pk: 'seen', followsMe: true, seenInFollowersAt: 150 }),
      person({ pk: 'left', followsMe: true, iFollow: true, decision: 'keep', decidedAt: 5, seenInFollowersAt: 40 }),
      person({ pk: 'removed', followsMe: true, seenInFollowersAt: 50, decision: 'remove' }),
      person({ pk: 'notFollower', iFollow: true }),
      person({ pk: 'unfollowing', followsMe: true, iFollow: true, decision: 'unfollow' }),
    ];
    const changed = dropMissingFollowers(people, scan, 200, new Set(['removed']));
    expect(changed.map((p) => p.pk)).toEqual(['left', 'removed', 'unfollowing']);
    expect(changed[0]).toMatchObject({
      followsMe: false,
      unfollowedMe: { after: 40, before: 200 },
      decision: 'undecided',
      decidedAt: null,
    });
    expect(changed[1]).toMatchObject({ followsMe: false, decision: 'remove' });
    expect(changed[1].unfollowedMe).toBeUndefined();
    expect(changed[2]).toMatchObject({ decision: 'unfollow', unfollowedMe: { after: 10, before: 200 } });
  });
});

describe('followersDiffLooksWrong', () => {
  const followers = Array.from({ length: 200 }, (_, index) =>
    person({ pk: String(index), followsMe: true, seenInFollowersAt: index < 170 ? 150 : 50 }),
  );

  it('flags a list far shorter than stored, with a floor of 10 for small accounts', () => {
    expect(followersDiffLooksWrong(followers, scan, none)).toBe(true);
    expect(followersDiffLooksWrong(followers.slice(0, 180), scan, none)).toBe(false);
    expect(followersDiffLooksWrong(followers.slice(160, 180), scan, none)).toBe(false);
  });

  it("doesn't count people I removed as missing", () => {
    const removed = new Set(followers.slice(170, 190).map((p) => p.pk));
    expect(followersDiffLooksWrong(followers, scan, removed)).toBe(false);
  });
});

describe('dropMissingFollowing', () => {
  it('drops only accounts missing from this scan, and holds back when the list looks short', () => {
    const people = [
      person({ pk: 'gone', iFollow: true, seenInFollowingAt: 50 }),
      person({ pk: 'still', iFollow: true, seenInFollowingAt: 150 }),
    ];
    expect(dropMissingFollowing(people, scan).map((p) => [p.pk, p.iFollow])).toEqual([['gone', false]]);
    const following = Array.from({ length: 30 }, (_, index) =>
      person({ pk: String(index), iFollow: true, seenInFollowingAt: index < 15 ? 150 : 50 }),
    );
    expect(followingDiffLooksWrong(following, scan, none)).toBe(true);
    expect(followingDiffLooksWrong(following, scan, new Set(following.slice(15, 25).map((p) => p.pk)))).toBe(false);
  });
});

describe('summarizeScan', () => {
  it('counts only what changed in this scan', () => {
    const people = [
      person({ pk: 'new', followsMe: true, startedFollowingMe: { after: 10, before: 120 } }),
      person({ pk: 'old', unfollowedMe: { after: 1, before: 10 } }),
    ];
    expect(summarizeScan(people, scan, 300)).toMatchObject({ followers: 1, lostFollowers: 0, newFollowers: 1 });
  });
});
