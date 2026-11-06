import type { ActionType, Decision, Person, QueuedAction } from '../shared/types';

export type UndoStep =
  | { kind: 'cancel'; actionId: number }
  | { kind: 'refollow'; privateAccount: boolean }
  | { kind: 'irreversible' }
  | { kind: 'none' };

export function availableDecisions(person: Person): Decision[] {
  const decisions: Decision[] = ['keep'];
  if (person.iFollow) {
    decisions.push('unfollow');
  }
  if (person.followsMe) {
    decisions.push('remove');
  }
  if (person.iFollow && person.followsMe) {
    decisions.push('both');
  }
  return decisions;
}

export function queuedAction(personPk: string, type: ActionType, now: number): QueuedAction {
  return { personPk, type, status: 'queued', attempts: 0, createdAt: now, notBefore: now, sentAt: null, error: null };
}

export function actionsFor(person: Person, decision: Decision, now: number): QueuedAction[] {
  const types: ActionType[] =
    decision === 'unfollow'
      ? ['unfollow']
      : decision === 'remove'
        ? ['remove']
        : decision === 'both'
          ? ['unfollow', 'remove']
          : [];
  return types.map((type) => queuedAction(person.pk, type, now));
}

// A queued action is only still wanted while the person's decision asks for it; follow is the undo re-follow.
export function decisionImplies(decision: Decision, type: ActionType): boolean {
  if (type === 'unfollow') {
    return decision === 'unfollow' || decision === 'both';
  }
  if (type === 'remove') {
    return decision === 'remove' || decision === 'both';
  }
  return true;
}

export function planUndo(person: Person, action: QueuedAction): UndoStep {
  if (action.status === 'queued') {
    return action.id === undefined ? { kind: 'none' } : { kind: 'cancel', actionId: action.id };
  }
  if (action.status === 'sending' || action.status === 'sent') {
    if (action.type === 'unfollow') {
      return { kind: 'refollow', privateAccount: person.isPrivate };
    }
    if (action.type === 'remove') {
      return { kind: 'irreversible' };
    }
  }
  return { kind: 'none' };
}
