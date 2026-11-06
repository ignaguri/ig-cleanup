import type { ActionType, Decision, Person, QueuedAction } from '../shared/types';

export type UndoStep =
  | { kind: 'cancel'; actionId: number }
  | { kind: 'refollow'; privateAccount: boolean }
  | { kind: 'irreversible' }
  | { kind: 'none' };

export function availableDecisions(p: Person): Decision[] {
  const decisions: Decision[] = ['keep'];
  if (p.iFollow) {
    decisions.push('unfollow');
  }
  if (p.followsMe) {
    decisions.push('remove');
  }
  if (p.iFollow && p.followsMe) {
    decisions.push('both');
  }
  return decisions;
}

export function actionsFor(p: Person, d: Decision, now: number): QueuedAction[] {
  const types: ActionType[] =
    d === 'unfollow' ? ['unfollow'] : d === 'remove' ? ['remove'] : d === 'both' ? ['unfollow', 'remove'] : [];
  return types.map((type) => ({
    personPk: p.pk,
    type,
    status: 'queued',
    attempts: 0,
    createdAt: now,
    notBefore: now,
    sentAt: null,
    error: null,
  }));
}

export function planUndo(p: Person, action: QueuedAction): UndoStep {
  if (action.status === 'queued') {
    return action.id === undefined ? { kind: 'none' } : { kind: 'cancel', actionId: action.id };
  }
  if (action.status === 'sending' || action.status === 'sent') {
    if (action.type === 'unfollow') {
      return { kind: 'refollow', privateAccount: p.isPrivate };
    }
    if (action.type === 'remove') {
      return { kind: 'irreversible' };
    }
  }
  return { kind: 'none' };
}
