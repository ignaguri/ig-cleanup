import { describe, expect, it } from 'vitest';
import { checkAccount } from './account-guard';

describe('checkAccount', () => {
  it('is unset when nothing is stored', () => {
    expect(checkAccount(undefined, '1')).toBe('unset');
  });

  it('is ok when ids match', () => {
    expect(checkAccount({ userId: '1', username: null }, '1')).toBe('ok');
  });

  it('is mismatch when ids differ', () => {
    expect(checkAccount({ userId: '1', username: null }, '2')).toBe('mismatch');
  });

  it('is logged_out without a current user', () => {
    expect(checkAccount(undefined, null)).toBe('logged_out');
    expect(checkAccount({ userId: '1', username: null }, null)).toBe('logged_out');
  });
});
