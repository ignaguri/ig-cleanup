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
      followChecksLeft: 0,
      mutualsDone: 1,
      mutualsTotal: 2,
    });
    expect(collectionProgress({ ...listsDone, mutualsCompletedAt: 5 }, people).phase).toBe('done');
  });

  it('stays in the lists phase while fans are unconfirmed', () => {
    const fan = person({ pk: 'fan', iFollow: false, followsMe: true });
    const progress = collectionProgress({ ...listsDone, mutualsCompletedAt: 5 }, [fan]);
    expect(progress.phase).toBe('lists');
    expect(progress.followChecksLeft).toBe(1);
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
