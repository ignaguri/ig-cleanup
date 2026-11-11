import { describe, expect, it } from 'vitest';
import type { Person } from '../shared/types';
import { applyFollowCheck, awaitsFollowCheck, needsFollowCheck } from './follow-check';

const scan = { startedAt: 100, previousAt: 10 };

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

describe('needsFollowCheck', () => {
  it('checks a fan once outside a rescan, and again in each rescan', () => {
    const fan = person({ followsMe: true });
    const checkedFan = person({ followsMe: true, followCheckedAt: 50 });
    expect(needsFollowCheck(fan, null)).toBe(true);
    expect(needsFollowCheck(checkedFan, null)).toBe(false);
    expect(needsFollowCheck(checkedFan, scan)).toBe(true);
    expect(needsFollowCheck({ ...checkedFan, followCheckedAt: 150 }, scan)).toBe(false);
  });

  it('checks someone I followed only when a rescan left them out of the list', () => {
    const followed = person({ iFollow: true, seenInFollowingAt: 40 });
    expect(needsFollowCheck(followed, null)).toBe(false);
    expect(needsFollowCheck(followed, scan)).toBe(true);
    expect(needsFollowCheck({ ...followed, seenInFollowingAt: 150 }, scan)).toBe(false);
  });

  it('leaves mutuals and people in neither list alone', () => {
    const mutual = person({ iFollow: true, followsMe: true, seenInFollowingAt: 150 });
    for (const current of [mutual, person({})]) {
      expect(needsFollowCheck(current, null)).toBe(false);
      expect(needsFollowCheck(current, scan)).toBe(false);
    }
  });
});

describe('awaitsFollowCheck', () => {
  it('holds back only fans that were never confirmed', () => {
    expect(awaitsFollowCheck(person({ followsMe: true }))).toBe(true);
    expect(awaitsFollowCheck(person({ followsMe: true, followCheckedAt: 1 }))).toBe(false);
    expect(awaitsFollowCheck(person({ followsMe: true, iFollow: true }))).toBe(false);
  });
});

describe('applyFollowCheck', () => {
  it('takes Instagram at its word, and treats a missing account as not followed', () => {
    const people = [
      person({ pk: 'followed', followsMe: true }),
      person({ pk: 'fan', followsMe: true }),
      person({ pk: 'gone', iFollow: true, seenInFollowingAt: 40 }),
    ];
    const followStatuses = new Map([
      ['followed', true],
      ['fan', false],
    ]);
    expect(applyFollowCheck(people, followStatuses, 200)).toMatchObject([
      { pk: 'followed', iFollow: true, seenInFollowingAt: 200, followCheckedAt: 200 },
      { pk: 'fan', iFollow: false, followCheckedAt: 200 },
      { pk: 'gone', iFollow: false, seenInFollowingAt: 40, followCheckedAt: 200 },
    ]);
  });
});
