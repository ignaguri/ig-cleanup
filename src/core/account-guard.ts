import type { AccountMeta } from '../shared/types';

export function checkAccount(
  stored: AccountMeta | undefined,
  currentUserId: string | null,
): 'unset' | 'ok' | 'mismatch' | 'logged_out' {
  if (currentUserId === null) {
    return 'logged_out';
  }
  if (stored === undefined) {
    return 'unset';
  }
  return stored.userId === currentUserId ? 'ok' : 'mismatch';
}
