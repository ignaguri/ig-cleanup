import { describe, expect, it } from 'vitest';
import { formatRelative, formatWhen } from './format';

const now = new Date(2026, 10, 9, 12, 0).getTime();

describe('formatWhen', () => {
  it('shows only the time today and names tomorrow and yesterday', () => {
    expect(formatWhen(new Date(2026, 10, 9, 8, 5).getTime(), now)).toBe('08:05');
    expect(formatWhen(new Date(2026, 10, 10, 12, 23).getTime(), now)).toBe('tomorrow 12:23');
    expect(formatWhen(new Date(2026, 10, 8, 23, 59).getTime(), now)).toBe('yesterday 23:59');
  });

  it('adds the date further away', () => {
    expect(formatWhen(new Date(2026, 10, 6, 14, 12).getTime(), now)).toBe('6 Nov, 14:12');
  });
});

describe('formatRelative', () => {
  it('is relative within the hour and absolute beyond it', () => {
    expect(formatRelative(now + 4 * 60_000, now)).toBe('in 4 min');
    expect(formatRelative(now - 2 * 60_000, now)).toBe('2 min ago');
    expect(formatRelative(now + 10_000, now)).toBe('now');
    expect(formatRelative(now + 2 * 3_600_000, now)).toBe('14:00');
  });
});
