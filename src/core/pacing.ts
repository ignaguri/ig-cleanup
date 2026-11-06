import type { BlockInfo, Mode, QueuedAction, Settings } from '../shared/types';

const DAY_MS = 86400000;

export type SendPlan =
  | { kind: 'send'; action: QueuedAction }
  | { kind: 'wait'; until: number; reason: 'cap' | 'delay' | 'backoff' }
  | { kind: 'idle'; reason: 'not_sending' | 'blocked' | 'empty' };

// mulberry32: same seed gives the same gap, so the alarm lands exactly when planSend allows the send.
export function seededRand(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomDelay(range: readonly [number, number], rand: () => number): number {
  const [min, max] = range;
  return min + Math.floor(rand() * (max - min + 1));
}

function sentTimesInWindow(actions: QueuedAction[], now: number): number[] {
  const windowStart = now - DAY_MS;
  return actions
    .map((entry) => entry.sentAt)
    .filter((sentAt): sentAt is number => sentAt !== null && sentAt > windowStart);
}

export function sentInLast24h(actions: QueuedAction[], now: number): number {
  return sentTimesInWindow(actions, now).length;
}

export function planSend(input: {
  mode: Mode;
  block: BlockInfo | null;
  queued: QueuedAction[];
  sent: QueuedAction[];
  lastSentAt: number | null;
  settings: Settings;
  now: number;
  rand: () => number;
}): SendPlan {
  const { mode, block, queued, sent, lastSentAt, settings, now, rand } = input;

  if (block !== null) {
    return { kind: 'idle', reason: 'blocked' };
  }
  if (mode !== 'sending') {
    return { kind: 'idle', reason: 'not_sending' };
  }
  if (queued.length === 0) {
    return { kind: 'idle', reason: 'empty' };
  }

  const recentSends = sentTimesInWindow(sent, now);
  if (recentSends.length >= settings.dailyCap) {
    return { kind: 'wait', until: Math.min(...recentSends) + DAY_MS, reason: 'cap' };
  }

  const eligible = queued.filter((entry) => entry.notBefore <= now);
  if (eligible.length === 0) {
    return { kind: 'wait', until: Math.min(...queued.map((entry) => entry.notBefore)), reason: 'backoff' };
  }

  if (lastSentAt !== null) {
    const delayMs = randomDelay([settings.minDelayMs, settings.maxDelayMs], rand);
    if (now < lastSentAt + delayMs) {
      return { kind: 'wait', until: lastSentAt + delayMs, reason: 'delay' };
    }
  }

  const next = eligible.reduce((lowest, entry) =>
    (entry.id ?? Number.POSITIVE_INFINITY) < (lowest.id ?? Number.POSITIVE_INFINITY) ? entry : lowest,
  );
  return { kind: 'send', action: next };
}
