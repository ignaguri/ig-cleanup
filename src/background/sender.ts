import { planSend, randomDelay, type SendPlan, seededRand } from '../core/pacing';
import { sendErrorOutcome } from '../core/send-outcome';
import { actionsByStatus, claimForSending, getMeta, requeueIfStillWanted, setMeta, updateAction } from '../db/db';
import { follow, removeFollower, sessionBlock, unfollow } from '../instagram/client';
import { blockFromError, IgBlockedError, IgShapeError } from '../instagram/errors';
import {
  DEFAULT_SETTINGS,
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
// Set when a block could not be persisted: stay idle until the service worker restarts.
let blockedInMemory = false;

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

async function recordBlock(info: BlockInfo): Promise<void> {
  try {
    await setMeta(META_BLOCK, info);
  } catch (error) {
    blockedInMemory = true;
    log.error('could not record block', error, info);
  }
}

async function handleSendError(error: unknown, action: QueuedAction, now: number, settings: Settings): Promise<void> {
  const outcome = sendErrorOutcome(error, action.attempts);
  if (outcome.kind === 'fail') {
    await updateAction({ ...action, status: 'failed', attempts: outcome.attempts, error: outcome.error });
    return;
  }
  if (outcome.kind === 'retry') {
    await requeueIfStillWanted(action, {
      attempts: outcome.attempts,
      notBefore: now + outcome.attempts * settings.maxDelayMs,
      error: outcome.error,
    });
    return;
  }
  if (!(error instanceof IgBlockedError || error instanceof IgShapeError)) {
    log.error('unexpected send error', error);
  }
  await recordBlock(blockFromError(error, 'unknown', now));
  await requeueIfStillWanted(action, {});
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

  if (mode === 'sending' && !block) {
    const accountBlock = await sessionBlock(now);
    if (accountBlock) {
      await recordBlock(accountBlock);
      return { kind: 'idle', reason: 'blocked' };
    }
  }

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
    await recordBlock({
      reason: 'non_json',
      status: 0,
      endpoint: 'unknown',
      excerpt: 'Could not record a sent action',
      at: now,
    });
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
    if (blockedInMemory) {
      await chrome.alarms.clear(SEND_ALARM);
      return;
    }
    const now = Date.now();
    const plan = await runSendTick(now);
    const block = await getMeta<BlockInfo | null>(META_BLOCK);
    if (block || blockedInMemory) {
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
  if (blockedInMemory) {
    await chrome.alarms.clear(SEND_ALARM);
    return;
  }
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
