import { actionsFor, availableDecisions, planUndo, type UndoStep } from '../../core/decisions';
import { actionsForPerson, addActions, getPerson, putPeople, updateAction } from '../../db/db';
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
  await putPeople([{ ...person, decision, decidedAt: now }]);
  const actionIds = await addActions(actionsFor(person, decision, now));
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
  const current = await actionsForPerson(entry.personPk);
  const steps: UndoStep[] = [];
  for (const actionId of entry.actionIds) {
    const action = current.find((candidate) => candidate.id === actionId);
    if (!action) {
      continue;
    }
    const step = planUndo(person, action);
    steps.push(step);
    if (step.kind === 'cancel') {
      await updateAction({ ...action, status: 'cancelled' });
    } else if (step.kind === 'refollow') {
      const follow: QueuedAction = {
        personPk: person.pk,
        type: 'follow',
        status: 'queued',
        attempts: 0,
        createdAt: now,
        notBefore: now,
        sentAt: null,
        error: null,
      };
      await addActions([follow]);
    }
  }
  await putPeople([{ ...person, decision: entry.previousDecision, decidedAt: null }]);
  kick();
  return steps;
}
