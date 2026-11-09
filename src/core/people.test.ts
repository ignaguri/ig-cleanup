import { describe, expect, it } from 'vitest';
import type { IgUser } from '../instagram/parse';
import type { Person } from '../shared/types';
import { buildDeck, deckOf, mergeListPage } from './people';

function igUser(pk: string): IgUser {
  return { pk, username: `u${pk}`, fullName: `User ${pk}`, picUrl: `p${pk}`, isPrivate: false, isVerified: false };
}

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

describe('mergeListPage', () => {
  it('keeps the first listIndex when a pk shows up again', () => {
    const existing = new Map<string, Person>();
    for (const p of mergeListPage(existing, [igUser('a'), igUser('b')], 'following', 0, 1, null)) {
      existing.set(p.pk, p);
    }
    for (const p of mergeListPage(existing, [igUser('c'), igUser('a')], 'following', 2, 1, null)) {
      existing.set(p.pk, p);
    }
    expect(existing.size).toBe(3);
    expect(existing.get('a')?.listIndex).toBe(0);
    expect(existing.get('c')?.listIndex).toBe(2);
  });

  it('marks both flags across the followers and following lists', () => {
    const existing = new Map<string, Person>();
    for (const p of mergeListPage(existing, [igUser('a')], 'followers', 0, 1, null)) {
      existing.set(p.pk, p);
    }
    const [merged] = mergeListPage(existing, [igUser('a')], 'following', 0, 1, null);
    expect(merged.iFollow).toBe(true);
    expect(merged.followsMe).toBe(true);
  });

  it('keeps an existing decision', () => {
    const existing = new Map([['a', person({ pk: 'a', decision: 'keep', decidedAt: 5 })]]);
    const [merged] = mergeListPage(existing, [igUser('a')], 'followers', 9, 1, null);
    expect(merged.decision).toBe('keep');
    expect(merged.decidedAt).toBe(5);
  });

  it('marks someone as a new follower only during a rescan', () => {
    const existing = new Map([['a', person({ pk: 'a', iFollow: true, unfollowedMe: { after: 1, before: 2 } })]]);
    expect(mergeListPage(existing, [igUser('a')], 'followers', 0, 9, null)[0].startedFollowingMe).toBeUndefined();
    expect(mergeListPage(existing, [igUser('a')], 'following', 0, 9, 5)[0].startedFollowingMe).toBeUndefined();
    const follower = new Map([['b', person({ pk: 'b', followsMe: true })]]);
    expect(mergeListPage(follower, [igUser('b')], 'followers', 0, 9, 5)[0].startedFollowingMe).toBeUndefined();
    const [merged] = mergeListPage(existing, [igUser('a')], 'followers', 0, 9, 5);
    expect(merged.startedFollowingMe).toEqual({ after: 5, before: 9 });
    expect(merged.unfollowedMe).toBeNull();
    expect(merged.seenInFollowersAt).toBe(9);
  });
});

describe('deckOf', () => {
  it('maps the four follow combinations', () => {
    expect(deckOf(person({ iFollow: true, followsMe: false }))).toBe('notFollowingBack');
    expect(deckOf(person({ iFollow: false, followsMe: true }))).toBe('fansNotFollowed');
    expect(deckOf(person({ iFollow: true, followsMe: true }))).toBe('mutual');
    expect(deckOf(person({ iFollow: false, followsMe: false }))).toBeNull();
  });
});

describe('buildDeck', () => {
  it('excludes decided people', () => {
    const deck = buildDeck([person({ pk: 'a' }), person({ pk: 'b', decision: 'keep' })], 'notFollowingBack');
    expect(deck.map((p) => p.pk)).toEqual(['a']);
  });

  it('puts dated before undated, oldest iFollowedAt first, undated by listIndex', () => {
    const deck = buildDeck(
      [
        person({ pk: 'u2', listIndex: 5 }),
        person({ pk: 'new', listIndex: 3, iFollowedAt: 200 }),
        person({ pk: 'u1', listIndex: 1 }),
        person({ pk: 'old', listIndex: 4, iFollowedAt: 100 }),
      ],
      'notFollowingBack',
    );
    expect(deck.map((p) => p.pk)).toEqual(['old', 'new', 'u1', 'u2']);
  });

  it('uses theyFollowedAt for fansNotFollowed', () => {
    const deck = buildDeck(
      [
        person({ pk: 'a', iFollow: false, followsMe: true, theyFollowedAt: 300 }),
        person({ pk: 'b', iFollow: false, followsMe: true, theyFollowedAt: 100 }),
      ],
      'fansNotFollowed',
    );
    expect(deck.map((p) => p.pk)).toEqual(['b', 'a']);
  });
});
