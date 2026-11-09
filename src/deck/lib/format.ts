import type { AccountMeta, TimeWindow } from '../../shared/types';

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });
const monthFormat = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// Absolute time in the local zone: "12:23", "yesterday 12:23", "tomorrow 12:23" or "7 Nov, 12:23".
export function formatWhen(at: number, now: number): string {
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);
  const time = timeFormat.format(at);
  if (days === 0) {
    return time;
  }
  if (days === 1) {
    return `tomorrow ${time}`;
  }
  if (days === -1) {
    return `yesterday ${time}`;
  }
  return `${dayFormat.format(at)}, ${time}`;
}

// Relative for the next hour either way ("in 4 min", "2 min ago"), absolute beyond that.
export function formatRelative(at: number, now: number): string {
  const minutes = Math.round((at - now) / 60_000);
  if (Math.abs(minutes) < 1) {
    return 'now';
  }
  if (minutes > 0 && minutes < 60) {
    return `in ${minutes} min`;
  }
  if (minutes < 0 && minutes > -60) {
    return `${-minutes} min ago`;
  }
  return formatWhen(at, now);
}

export function formatMonth(at: number): string {
  return monthFormat.format(at);
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function accountLabel(account: AccountMeta): string {
  return account.username !== null ? `@${account.username}` : `user ${account.userId}`;
}

// When something happened between two scans: "between 6 Nov and 9 Nov", or "on 9 Nov" within one day.
export function formatWindow(timeWindow: TimeWindow): string {
  const after = dayFormat.format(timeWindow.after);
  const before = dayFormat.format(timeWindow.before);
  return after === before ? `on ${before}` : `between ${after} and ${before}`;
}
