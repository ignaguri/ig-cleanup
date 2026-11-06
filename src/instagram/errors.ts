import type { BlockInfo } from '../shared/types';

export const EXCERPT_LENGTH = 200;

export class IgBlockedError extends Error {
  info: BlockInfo;

  constructor(info: BlockInfo) {
    super(`Instagram blocked the request: ${info.reason}`);
    this.name = 'IgBlockedError';
    this.info = info;
  }
}

// A 404 about one account (deleted, deactivated): it fails that item instead of pausing everything.
export class IgNotFoundError extends IgBlockedError {
  constructor(info: BlockInfo) {
    super(info);
    this.name = 'IgNotFoundError';
  }
}

export class IgShapeError extends Error {
  endpoint: string;
  detail: string;
  status: number | undefined;
  excerpt: string | undefined;

  constructor(endpoint: string, detail: string, response?: { status: number; text: string }) {
    super(`Unexpected response shape from ${endpoint}: ${detail}`);
    this.name = 'IgShapeError';
    this.endpoint = endpoint;
    this.detail = detail;
    this.status = response?.status;
    this.excerpt = response?.text.slice(0, EXCERPT_LENGTH);
  }
}

export class IgRetryableError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'IgRetryableError';
    this.status = status;
  }
}

export const NO_ANSWER_MESSAGE = 'Relay tab did not answer';

// The request may have reached Instagram: a write that ends like this must not be retried.
export class IgNoAnswerError extends IgRetryableError {
  constructor(message: string = NO_ANSWER_MESSAGE) {
    super(message);
    this.name = 'IgNoAnswerError';
  }
}

// What the sender and collector record when a request fails in a way that should pause everything.
export function blockFromError(error: unknown, endpoint: string, at: number): BlockInfo {
  if (error instanceof IgBlockedError) {
    return error.info;
  }
  if (error instanceof IgShapeError) {
    const excerpt = (error.excerpt ?? error.message).slice(0, EXCERPT_LENGTH);
    return { reason: 'non_json', status: error.status ?? 0, endpoint: error.endpoint, excerpt, at };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { reason: 'non_json', status: 0, endpoint, excerpt: `Unexpected: ${message}`.slice(0, EXCERPT_LENGTH), at };
}
