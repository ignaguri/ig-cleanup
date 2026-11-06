import type { Decision } from '../../shared/types';

export type DeckCommand = Decision | 'undo' | 'open';

export function keyToCommand(key: string): DeckCommand | null {
  switch (key) {
    case 'ArrowRight':
      return 'keep';
    case 'ArrowLeft':
      return 'unfollow';
    case 'ArrowDown':
      return 'remove';
    case 'ArrowUp':
      return 'both';
    case 'z':
    case 'Z':
    case 'Backspace':
      return 'undo';
    case 'Enter':
      return 'open';
    default:
      return null;
  }
}
