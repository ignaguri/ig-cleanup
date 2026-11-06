import { planSend, randomDelay, type SendPlan } from '../core/pacing';
import { actionsByStatus, claimForSending, getMeta, setMeta, updateAction } from '../db/db';
import { follow, removeFollower, unfollow } from '../instagram/client';
import { IgBlockedError, IgRetryableError, IgShapeError } from '../instagram/errors';
import {
  DEFAULT_SETTINGS,
  MAX_ATTEMPTS,
  META_BLOCK,
  META_LAST_SENT_AT,
  META_MODE,
  META_SETTINGS,
  SEND_ALARM,
} from '../shared/constants';
import { log } from '../shared/log';
import type { BlockInfo, Mode, QueuedAction, Settings } from '../shared/types';

const MIN_WAIT_MS = 30000;
const INTERRUPTED_ERROR = 'Interrupted while sending; check on Instagram';

let tickInFlight = false;
let kickedDuringTick = false;

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

async function loadSettings(): Promise<Settings> {
  return (await getMeta<Settings>(META_SETTINGS)) ?? DEFAULT_SETTINGS;
}

async function failInterruptedSends(): Promise<void> {
  const stuck = await actionsByStatus('sending');
  for (const action of stuck) {
    await updateAction({ ...action, status: 'failed', error: INTERRUPTED_ERROR });
  }
}

async function callClient(action: QueuedAction): Promise<void> {
  if (action.type === 'unfollow') {
    await unfollow(action.personPk);
  } else if (action.type === 'remove') {
    await removeFollower(action.personPk);
  } else {
    await follow(action.personPk);
  }
}

async function recordBlock(excerpt: string, now: number): Promise<void> {
  try {
    await setMeta(META_BLOCK, {
      reason: 'non_json',
      status: 0,
      endpoint: 'unknown',
      excerpt,
      at: now,
    } satisfies BlockInfo);
  } catch (error) {
    log.error('could not record block', error);
  }
}

async function handleSendError(error: unknown, action: QueuedAction, now: number, settings: Settings): Promise<void> {
  if (error instanceof IgRetryableError) {
    const attempts = action.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await updateAction({ ...action, status: 'failed', attempts, error: error.message });
    } else {
      await updateAction({
        ...action,
        status: 'queued',
        attempts,
        notBefore: now + attempts * settings.maxDelayMs,
        error: error.message,
      });
    }
    return;
  }

  let blockInfo: BlockInfo;
  if (error instanceof IgBlockedError) {
    blockInfo = error.info;
  } else if (error instanceof IgShapeError) {
    blockInfo = {
      reason: 'non_json',
      status: 0,
      endpoint: error.endpoint,
      excerpt: error.message.slice(0, 200),
      at: now,
    };
  } else {
    const message = error instanceof Error ? error.message : String(error);
    log.error('unexpected send error', error);
    blockInfo = {
      reason: 'non_json',
      status: 0,
      endpoint: 'unknown',
      excerpt: `Unexpected: ${message}`.slice(0, 200),
      at: now,
    };
  }
  await setMeta(META_BLOCK, blockInfo);
  await updateAction({ ...action, status: 'queued' });
}

export async function runSendTick(now: number): Promise<SendPlan> {
  await failInterruptedSends();

  const [mode, block, settings, lastSentAt, queued, sent] = await Promise.all([
    getMeta<Mode>(META_MODE),
    getMeta<BlockInfo | null>(META_BLOCK),
    loadSettings(),
    getMeta<number | null>(META_LAST_SENT_AT),
    actionsByStatus('queued'),
    actionsByStatus('sent'),
  ]);

  const plan = planSend({
    mode: mode ?? 'paused',
    block: block ?? null,
    queued,
    sent,
    lastSentAt: lastSentAt ?? null,
    settings,
    now,
    rand: seededRand(lastSentAt ?? 0),
  });
  if (plan.kind !== 'send') {
    return plan;
  }

  const claimed = plan.action.id === undefined ? null : await claimForSending(plan.action.id);
  if (!claimed) {
    // Cancelled (undo) between planning and claiming: send nothing, the next tick re-plans.
    return plan;
  }
  const action = claimed;
  // Persisted before the outcome so pacing holds after failures and blocks too.
  await setMeta(META_LAST_SENT_AT, now);
  try {
    await callClient(action);
  } catch (error) {
    await handleSendError(error, action, now, settings);
    return plan;
  }
  try {
    await updateAction({ ...action, status: 'sent', sentAt: now, error: null });
  } catch (error) {
    // Request went out: never re-queue. The action stays 'sending' and the next tick marks it failed.
    log.error('could not record sent action', error);
    await recordBlock('Could not record a sent action', now);
  }
  return plan;
}

async function scheduleAfter(plan: SendPlan, now: number, settings: Settings): Promise<void> {
  if (plan.kind === 'send') {
    const gapMs = randomDelay([settings.minDelayMs, settings.maxDelayMs], seededRand(now));
    await chrome.alarms.create(SEND_ALARM, { when: now + gapMs });
  } else if (plan.kind === 'wait') {
    if (Number.isFinite(plan.until)) {
      await chrome.alarms.create(SEND_ALARM, { when: Math.max(plan.until, now + MIN_WAIT_MS) });
    }
  } else {
    await chrome.alarms.clear(SEND_ALARM);
  }
}

export async function tickAndReschedule(): Promise<void> {
  if (tickInFlight) {
    return;
  }
  tickInFlight = true;
  try {
    const now = Date.now();
    const plan = await runSendTick(now);
    const block = await getMeta<BlockInfo | null>(META_BLOCK);
    if (block) {
      await chrome.alarms.clear(SEND_ALARM);
    } else if (kickedDuringTick) {
      await chrome.alarms.create(SEND_ALARM, { when: Date.now() + 1000 });
    } else {
      await scheduleAfter(plan, now, await loadSettings());
    }
  } finally {
    tickInFlight = false;
    kickedDuringTick = false;
  }
}

export async function rearmFallback(): Promise<void> {
  const block = await getMeta<BlockInfo | null>(META_BLOCK);
  if (!block) {
    await chrome.alarms.create(SEND_ALARM, { when: Date.now() + MIN_WAIT_MS });
  }
}

export async function kickSender(): Promise<void> {
  if (tickInFlight) {
    kickedDuringTick = true;
  }
  await chrome.alarms.clear(SEND_ALARM);
  await chrome.alarms.create(SEND_ALARM, { when: Date.now() + 1000 });
}
