import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../shared/constants';
import type { BlockInfo, QueuedAction } from '../shared/types';
import { planSend, randomDelay, seededRand, sentInLast24h } from './pacing';

const DAY = 86400000;
const NOW = 10 * DAY;

function action(overrides: Partial<QueuedAction> = {}): QueuedAction {
  return {
    id: 1,
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

function sentAction(sentAt: number): QueuedAction {
  return action({ status: 'sent', sentAt });
}

const block: BlockInfo = { reason: 'http_429', status: 429, endpoint: '/x', excerpt: '', at: 0 };

function plan(overrides: Partial<Parameters<typeof planSend>[0]> = {}) {
  return planSend({
    mode: 'sending',
    block: null,
    queued: [action()],
    sent: [],
    lastSentAt: null,
    settings: DEFAULT_SETTINGS,
    now: NOW,
    rand: () => 0,
    ...overrides,
  });
}

describe('randomDelay', () => {
  it('spans the inclusive range', () => {
    expect(randomDelay([30000, 90000], () => 0)).toBe(30000);
    expect(randomDelay([30000, 90000], () => 0.999999)).toBe(90000);
  });
});

describe('sentInLast24h', () => {
  it('counts only sends inside the window', () => {
    const sent = [sentAction(NOW - DAY), sentAction(NOW - DAY + 1), sentAction(NOW - 5)];
    expect(sentInLast24h(sent, NOW)).toBe(2);
  });
});

describe('planSend', () => {
  it('is idle when blocked', () => {
    expect(plan({ block })).toEqual({ kind: 'idle', reason: 'blocked' });
  });

  it('is idle when not sending', () => {
    expect(plan({ mode: 'collecting' })).toEqual({ kind: 'idle', reason: 'not_sending' });
  });

  it('is idle when nothing is queued', () => {
    expect(plan({ queued: [] })).toEqual({ kind: 'idle', reason: 'empty' });
  });

  it('waits for the cap to roll off', () => {
    const sent = Array.from({ length: 100 }, (_, index) => sentAction(NOW - 1000 + index));
    expect(plan({ sent })).toEqual({ kind: 'wait', until: NOW - 1000 + DAY, reason: 'cap' });
  });

  it('waits for backoff when every action is in the future', () => {
    const queued = [action({ id: 1, notBefore: NOW + 5000 }), action({ id: 2, notBefore: NOW + 3000 })];
    expect(plan({ queued })).toEqual({ kind: 'wait', until: NOW + 3000, reason: 'backoff' });
  });

  it('waits for the delay since the last send', () => {
    const lastSentAt = NOW - 10000;
    expect(plan({ lastSentAt })).toEqual({ kind: 'wait', until: lastSentAt + 30000, reason: 'delay' });
  });

  it('sends the lowest-id eligible action, skipping backed-off ones', () => {
    const queued = [
      action({ id: 3 }),
      action({ id: 1, notBefore: NOW + 1 }),
      action({ id: 2 }),
      action({ id: undefined }),
    ];
    const result = plan({ queued, lastSentAt: NOW - 30000 });
    expect(result).toEqual({ kind: 'send', action: queued[2] });
  });
});

describe('seededRand', () => {
  it('is deterministic per seed and within [0, 1)', () => {
    const first = seededRand(42)();
    expect(seededRand(42)()).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(1);
    expect(seededRand(43)()).not.toBe(first);
  });
});
