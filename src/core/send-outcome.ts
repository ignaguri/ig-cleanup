import { IgNoAnswerError, IgNotFoundError, IgRetryableError } from '../instagram/errors';
import { MAX_ATTEMPTS } from '../shared/constants';

export const NO_ANSWER_ERROR = 'No answer from Instagram; check on Instagram';
export const NOT_FOUND_ERROR = 'Account not found on Instagram';

export type SendErrorOutcome =
  | { kind: 'fail'; attempts: number; error: string }
  | { kind: 'retry'; attempts: number; error: string }
  | { kind: 'block' };

// A write that may have reached Instagram is never retried: no-answer is checked before its retryable parent.
export function sendErrorOutcome(error: unknown, attempts: number): SendErrorOutcome {
  if (error instanceof IgNoAnswerError) {
    return { kind: 'fail', attempts, error: NO_ANSWER_ERROR };
  }
  if (error instanceof IgNotFoundError) {
    return { kind: 'fail', attempts, error: NOT_FOUND_ERROR };
  }
  if (error instanceof IgRetryableError) {
    const next = attempts + 1;
    return next >= MAX_ATTEMPTS
      ? { kind: 'fail', attempts: next, error: error.message }
      : { kind: 'retry', attempts: next, error: error.message };
  }
  return { kind: 'block' };
}
