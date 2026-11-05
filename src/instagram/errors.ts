export type BlockInfo = {
  reason:
    | 'http_429'
    | 'feedback_required'
    | 'checkpoint_required'
    | 'login_required'
    | 'login_redirect'
    | 'challenge_redirect'
    | 'non_json';
  status: number;
  endpoint: string;
  excerpt: string;
  at: number;
};

export class IgBlockedError extends Error {
  info: BlockInfo;

  constructor(info: BlockInfo) {
    super(`Instagram blocked the request: ${info.reason}`);
    this.name = 'IgBlockedError';
    this.info = info;
  }
}

export class IgShapeError extends Error {
  endpoint: string;
  detail: string;

  constructor(endpoint: string, detail: string) {
    super(`Unexpected response shape from ${endpoint}: ${detail}`);
    this.name = 'IgShapeError';
    this.endpoint = endpoint;
    this.detail = detail;
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
