import { describe, expect, it } from 'vitest';
import { keyToCommand } from './keyboard';

describe('keyToCommand', () => {
  it.each([
    ['ArrowRight', 'keep'],
    ['ArrowLeft', 'unfollow'],
    ['ArrowDown', 'remove'],
    ['ArrowUp', 'both'],
    ['z', 'undo'],
    ['Z', 'undo'],
    ['Backspace', 'undo'],
    ['Enter', 'open'],
  ])('maps %s to %s', (key, command) => {
    expect(keyToCommand(key)).toBe(command);
  });

  it('returns null for unmapped keys', () => {
    expect(keyToCommand('a')).toBeNull();
  });
});
