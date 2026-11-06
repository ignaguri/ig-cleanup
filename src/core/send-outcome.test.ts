import { describe, expect, it } from 'vitest';
import { IgBlockedError, IgNoAnswerError, IgNotFoundError, IgRetryableError } from '../instagram/errors';
import { MAX_ATTEMPTS } from '../shared/constants';
import { sendErrorOutcome } from './send-outcome';

const info = { reason: 'not_found' as const, status: 404, endpoint: 'e', excerpt: '', at: 0 };

describe('sendErrorOutcome', () => {
  it('never retries a write that got no answer, even on its first attempt', () => {
    expect(sendErrorOutcome(new IgNoAnswerError(), 0).kind).toBe('fail');
  });

  it('retries network failures until the attempt cap, then fails', () => {
    expect(sendErrorOutcome(new IgRetryableError('down'), 0)).toMatchObject({ kind: 'retry', attempts: 1 });
    expect(sendErrorOutcome(new IgRetryableError('down'), MAX_ATTEMPTS - 1)).toMatchObject({
      kind: 'fail',
      attempts: MAX_ATTEMPTS,
    });
  });

  it('fails one missing account but blocks on anything else', () => {
    expect(sendErrorOutcome(new IgNotFoundError(info), 0).kind).toBe('fail');
    expect(sendErrorOutcome(new IgBlockedError({ ...info, reason: 'rate_limited' }), 0).kind).toBe('block');
  });
});
