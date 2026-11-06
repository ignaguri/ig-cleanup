import { actionsFor, availableDecisions, planUndo, queuedAction, type UndoStep } from '../../core/decisions';
import { cancelIfQueued, getAction, getPerson, recordDecision } from '../../db/db';
import { UNDO_HISTORY_SIZE } from '../../shared/constants';
import { log } from '../../shared/log';
import type { Decision, QueuedAction } from '../../shared/types';

type HistoryEntry = { personPk: string; previousDecision: Decision; actionIds: number[] };

const history: HistoryEntry[] = [];

export function kick() {
  try {
    // The service worker may be asleep or absent; a failed wake-up is not fatal.
    chrome.runtime.sendMessage({ type: 'igc:kick' }).catch((error: unknown) => {
      log.warn('kick failed', error);
    });
  } catch (error) {
    log.warn('kick failed', error);
  }
}

export async function decide(personPk: string, decision: Decision): Promise<void> {
  const person = await getPerson(personPk);
  if (person?.decision !== 'undecided' || !availableDecisions(person).includes(decision)) {
    return;
  }
  const now = Date.now();
  const actionIds = await recordDecision(personPk, { decision, decidedAt: now }, actionsFor(person, decision, now));
  history.push({ personPk, previousDecision: person.decision, actionIds });
  if (history.length > UNDO_HISTORY_SIZE) {
    history.shift();
  }
  kick();
}

export type UndoResult = { personPk: string | null; steps: UndoStep[] };

export async function undoLast(): Promise<UndoResult> {
  const entry = history.pop();
  if (!entry) {
    return { personPk: null, steps: [] };
  }
  const person = await getPerson(entry.personPk);
  if (!person) {
    return { personPk: null, steps: [] };
  }
  const now = Date.now();
  const steps: UndoStep[] = [];
  const refollows: QueuedAction[] = [];
  for (const actionId of entry.actionIds) {
    const action = await getAction(actionId);
    if (!action) {
      continue;
    }
    let step = planUndo(person, action);
    if (step.kind === 'cancel' && !(await cancelIfQueued(step.actionId))) {
      // The sender claimed it first: re-plan against the current status.
      const latest = await getAction(actionId);
      step = latest ? planUndo(person, latest) : { kind: 'none' };
    }
    steps.push(step);
    if (step.kind === 'refollow') {
      refollows.push(queuedAction(person.pk, 'follow', now));
    }
  }
  await recordDecision(person.pk, { decision: entry.previousDecision, decidedAt: null }, refollows);
  kick();
  return { personPk: person.pk, steps };
}
