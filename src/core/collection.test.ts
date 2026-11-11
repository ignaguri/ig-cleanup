import { describe, expect, it } from 'vitest';
import type { CollectionState, Person } from '../shared/types';
import { collectionProgress, INITIAL_COLLECTION, nextListStep, nextMutualsTarget, skipsMutuals429 } from './collection';

function person(overrides: Partial<Person> = {}): Person {
  return {
    pk: '1',
    username: 'u1',
    fullName: 'User 1',
    picUrl: 'p1',
    isPrivate: false,
    isVerified: false,
    iFollow: true,
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

const doneCursor = { done: true, nextMaxId: null, seen: 10 };

describe('nextListStep', () => {
  it('walks followers, then following, then null', () => {
    expect(nextListStep(INITIAL_COLLECTION)).toBe('followers');
    expect(nextListStep({ ...INITIAL_COLLECTION, followers: doneCursor })).toBe('following');
    expect(nextListStep({ ...INITIAL_COLLECTION, followers: doneCursor, following: doneCursor })).toBeNull();
  });
});

describe('nextMutualsTarget', () => {
  it('skips fetched, decided, sent and deckless people', () => {
    const people = [
      person({ pk: 'fetched', mutualsFetchedAt: 1 }),
      person({ pk: 'decided', decision: 'keep', listIndex: 0 }),
      person({ pk: 'sent' }),
      person({ pk: 'none', iFollow: false, followsMe: false }),
      person({ pk: 'target', listIndex: 5 }),
    ];
    expect(nextMutualsTarget(people, new Set(['sent']))?.pk).toBe('target');
  });

  it('orders by deck before listIndex', () => {
    const people = [
      person({ pk: 'mutual', followsMe: true, listIndex: 0 }),
      person({ pk: 'fan', iFollow: false, followsMe: true, listIndex: 1 }),
      person({ pk: 'nfb', listIndex: 9 }),
      person({ pk: 'nfb-early', listIndex: 2 }),
    ];
    expect(nextMutualsTarget(people, new Set())?.pk).toBe('nfb-early');
    expect(
      nextMutualsTarget(
        people.filter((p) => p.pk === 'mutual' || p.pk === 'fan'),
        new Set(),
      )?.pk,
    ).toBe('fan');
  });

  it('never targets the mutual deck', () => {
    expect(nextMutualsTarget([person({ pk: 'mutual', followsMe: true })], new Set())).toBeNull();
  });

  it('returns null when nothing is left', () => {
    expect(nextMutualsTarget([], new Set())).toBeNull();
  });
});

describe('collectionProgress', () => {
  const listsDone: CollectionState = { ...INITIAL_COLLECTION, followers: doneCursor, following: doneCursor };

  it('is in the lists phase until both cursors are done', () => {
    expect(collectionProgress(INITIAL_COLLECTION, []).phase).toBe('lists');
    const fan = person({ pk: 'fan', iFollow: false, followsMe: true });
    expect(collectionProgress({ ...INITIAL_COLLECTION, followers: doneCursor }, [fan])).toMatchObject({
      phase: 'lists',
      followChecksLeft: 0,
    });
  });

  it('reports mutuals phase with counts, then done', () => {
    const people = [person({ pk: 'a', mutualsFetchedAt: 1 }), person({ pk: 'b' }), person({ pk: 'c', iFollow: false })];
    expect(collectionProgress(listsDone, people)).toEqual({
      phase: 'mutuals',
      listsSeen: 20,
      lists: null,
      followChecksLeft: 0,
      followChecks: { done: 0, total: 0 },
      mutualsDone: 1,
      mutualsTotal: 2,
    });
    expect(collectionProgress({ ...listsDone, mutualsCompletedAt: 5 }, people).phase).toBe('done');
  });

  it('counts a rescan by accounts seen in this pass, and holds short of full until the list ends', () => {
    const rescan = { startedAt: 100, previousAt: 10 };
    const people = [
      person({ pk: 'seen', followsMe: true, iFollow: false, seenInFollowersAt: 150 }),
      person({ pk: 'pending', followsMe: true, iFollow: false, seenInFollowersAt: 50 }),
      person({ pk: 'also-pending', followsMe: true, iFollow: false, seenInFollowersAt: 60 }),
      person({ pk: 'removed', followsMe: true, iFollow: false, decision: 'remove' }),
      person({ pk: 'new', followsMe: true, iFollow: false, seenInFollowersAt: 160 }),
    ];
    const reading = { ...INITIAL_COLLECTION, rescan };
    expect(collectionProgress(reading, people).lists).toEqual({ done: 2, total: 4 });
    const allSeen = people.map((current) => ({ ...current, seenInFollowersAt: 150 }));
    expect(collectionProgress(reading, allSeen).lists).toEqual({ done: 4, total: 5 });
    expect(collectionProgress({ ...reading, followers: doneCursor }, allSeen).lists).toEqual({ done: 5, total: 5 });
  });

  it('counts a first scan against the profile, growing the total when the list runs over', () => {
    const profileCounts = { followers: 2, following: 3 };
    const follower = person({ pk: 'follower', iFollow: false, followsMe: true, seenInFollowersAt: 5 });
    const reading = { ...INITIAL_COLLECTION, profileCounts };
    expect(collectionProgress(INITIAL_COLLECTION, [follower]).lists).toBeNull();
    expect(collectionProgress(reading, [follower]).lists).toEqual({ done: 1, total: 5 });
    const extras = ['a', 'b', 'c'].map((pk) => person({ pk, iFollow: false, followsMe: true, seenInFollowersAt: 5 }));
    expect(collectionProgress(reading, [follower, ...extras]).lists).toEqual({ done: 3, total: 7 });
    expect(collectionProgress({ ...reading, listsCompletedAt: 9 }, [follower]).lists).toBeNull();
  });

  it('stays in the lists phase while fans are unconfirmed', () => {
    const fan = person({ pk: 'fan', iFollow: false, followsMe: true });
    const progress = collectionProgress({ ...listsDone, mutualsCompletedAt: 5 }, [fan]);
    expect(progress.phase).toBe('lists');
    expect(progress.followChecksLeft).toBe(1);
    const checked = person({ pk: 'checked', iFollow: false, followsMe: true, followCheckedAt: 3 });
    expect(collectionProgress(listsDone, [fan, checked]).followChecks).toEqual({ done: 1, total: 2 });
  });
});

describe('skipsMutuals429', () => {
  const mutualsOf = (pk: string, status: number) => ({
    endpoint: `/api/v1/friendships/${pk}/mutual_followers/`,
    status,
  });

  it('skips the person when the previous request went through', () => {
    expect(skipsMutuals429('1', mutualsOf('2', 200))).toBe(true);
  });

  it('skips the person when their own retry hits 429 again', () => {
    expect(skipsMutuals429('1', mutualsOf('1', 429))).toBe(true);
  });

  it('blocks when a different person also got 429', () => {
    expect(skipsMutuals429('1', mutualsOf('2', 429))).toBe(false);
  });
});
