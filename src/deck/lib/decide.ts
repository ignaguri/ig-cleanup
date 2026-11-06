import { actionsFor, availableDecisions, planUndo, type UndoStep } from '../../core/decisions';
import { actionsForPerson, cancelIfQueued, getPerson, recordDecision } from '../../db/db';
import { UNDO_HISTORY_SIZE } from '../../shared/constants';
import { log } from '../../shared/log';
import type { Decision, QueuedAction } from '../../shared/types';

type HistoryEntry = { personPk: string; previousDecision: Decision; actionIds: number[] };

const history: HistoryEntry[] = [];

export function canUndo(): boolean {
  return history.length > 0;
}

function kick() {
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
  const actionIds = await recordDecision({ ...person, decision, decidedAt: now }, actionsFor(person, decision, now));
  history.push({ personPk, previousDecision: person.decision, actionIds });
  if (history.length > UNDO_HISTORY_SIZE) {
    history.shift();
  }
  kick();
}

export async function undoLast(): Promise<UndoStep[]> {
  const entry = history.pop();
  if (!entry) {
    return [];
  }
  const person = await getPerson(entry.personPk);
  if (!person) {
    return [];
  }
  const now = Date.now();
  const steps: UndoStep[] = [];
  const refollows: QueuedAction[] = [];
  for (const actionId of entry.actionIds) {
    const findAction = async () =>
      (await actionsForPerson(entry.personPk)).find((candidate) => candidate.id === actionId);
    const action = await findAction();
    if (!action) {
      continue;
    }
    let step = planUndo(person, action);
    if (step.kind === 'cancel' && !(await cancelIfQueued(step.actionId))) {
      // The sender claimed it first: re-plan against the current status.
      const latest = await findAction();
      step = latest ? planUndo(person, latest) : { kind: 'none' };
    }
    steps.push(step);
    if (step.kind === 'refollow') {
      refollows.push({
        personPk: person.pk,
        type: 'follow',
        status: 'queued',
        attempts: 0,
        createdAt: now,
        notBefore: now,
        sentAt: null,
        error: null,
      });
    }
  }
  await recordDecision({ ...person, decision: entry.previousDecision, decidedAt: null }, refollows);
  kick();
  return steps;
}
