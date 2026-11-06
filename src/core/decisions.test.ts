import { describe, expect, it } from 'vitest';
import type { Person, QueuedAction } from '../shared/types';
import { actionsFor, availableDecisions, decisionImplies, planUndo } from './decisions';

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

function action(overrides: Partial<QueuedAction> = {}): QueuedAction {
  return {
    id: 7,
    personPk: '1',
    type: 'unfollow',
    status: 'queued',
    attempts: 0,
    createdAt: 0,
    notBefore: 0,
    sentAt: null,
    error: null,
    ...overrides,
  };
}

describe('availableDecisions', () => {
  it('offers keep and unfollow for someone only I follow', () => {
    expect(availableDecisions(person({ iFollow: true, followsMe: false }))).toEqual(['keep', 'unfollow']);
    expect(availableDecisions(person({ iFollow: false, followsMe: true }))).toEqual(['keep', 'remove']);
  });

  it('offers everything for a mutual', () => {
    expect(availableDecisions(person({ iFollow: true, followsMe: true }))).toEqual([
      'keep',
      'unfollow',
      'remove',
      'both',
    ]);
  });
});

describe('actionsFor', () => {
  it('queues unfollow then remove for both', () => {
    const actions = actionsFor(person({ followsMe: true }), 'both', 1000);
    expect(actions.map((a) => a.type)).toEqual(['unfollow', 'remove']);
    expect(actions.every((a) => a.notBefore === 1000 && a.status === 'queued' && a.attempts === 0)).toBe(true);
  });
});

describe('planUndo', () => {
  it('treats sending like sent for an unfollow', () => {
    const p = person();
    expect(planUndo(p, action({ status: 'sending' }))).toEqual(planUndo(p, action({ status: 'sent' })));
  });

  it('flags private accounts for refollow', () => {
    expect(planUndo(person({ isPrivate: true }), action({ status: 'sent' }))).toEqual({
      kind: 'refollow',
      privateAccount: true,
    });
  });

  it('marks a sent remove as irreversible', () => {
    expect(planUndo(person(), action({ type: 'remove', status: 'sent' }))).toEqual({ kind: 'irreversible' });
  });

  it('cancels a queued action by id', () => {
    expect(planUndo(person(), action())).toEqual({ kind: 'cancel', actionId: 7 });
  });
});

describe('decisionImplies', () => {
  it('keeps writes only while the decision asks for them', () => {
    expect(decisionImplies('unfollow', 'unfollow')).toBe(true);
    expect(decisionImplies('both', 'unfollow')).toBe(true);
    expect(decisionImplies('remove', 'remove')).toBe(true);
    expect(decisionImplies('both', 'remove')).toBe(true);
    expect(decisionImplies('undecided', 'unfollow')).toBe(false);
    expect(decisionImplies('unfollow', 'remove')).toBe(false);
    expect(decisionImplies('undecided', 'follow')).toBe(true);
  });
});
