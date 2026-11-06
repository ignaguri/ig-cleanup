import { LIST_PAGE_SIZE } from '../shared/constants';
import type { BlockInfo, MutualPreview } from '../shared/types';
import { EXCERPT_LENGTH, IgBlockedError, IgNotFoundError, IgRetryableError, IgShapeError } from './errors';
import type { IgRawResponse } from './transport';

export type IgUser = {
  pk: string;
  username: string;
  fullName: string;
  picUrl: string;
  isPrivate: boolean;
  isVerified: boolean;
};

const BLOCK_MESSAGES = ['feedback_required', 'checkpoint_required', 'login_required'] as const;

export function detectBlock(res: IgRawResponse, endpoint: string, now: number): BlockInfo | null {
  const build = (reason: BlockInfo['reason']): BlockInfo => ({
    reason,
    status: res.status,
    endpoint,
    excerpt: res.text.slice(0, EXCERPT_LENGTH),
    at: now,
  });

  if (res.status === 429) {
    return build('http_429');
  }
  if (res.url.includes('/accounts/login')) {
    return build('login_redirect');
  }
  if (res.url.includes('/challenge')) {
    return build('challenge_redirect');
  }

  let body: unknown;
  try {
    body = JSON.parse(res.text);
  } catch {
    return build('non_json');
  }

  const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  for (const reason of BLOCK_MESSAGES) {
    if (fields.message === reason || fields.error_type === reason) {
      return build(reason);
    }
  }
  // "Please wait a few minutes" style replies: Instagram is throttling this account.
  const throttled = fields.spam === true || fields.require_login === true || fields.status === 'fail';
  if (!throttled && res.status === 404) {
    return build('not_found');
  }
  if (throttled || (res.status >= 400 && res.status < 500)) {
    return build('rate_limited');
  }
  return null;
}

// 5xx is checked before block detection so an HTML gateway error retries instead of pausing.
function parseBody(res: IgRawResponse, endpoint: string): Record<string, unknown> {
  if (res.status >= 500) {
    throw new IgRetryableError(`Instagram returned ${res.status} for ${endpoint}`, res.status);
  }
  const block = detectBlock(res, endpoint, Date.now());
  if (block) {
    throw block.reason === 'not_found' ? new IgNotFoundError(block) : new IgBlockedError(block);
  }
  const body = JSON.parse(res.text);
  if (!body || typeof body !== 'object') {
    throw new IgShapeError(endpoint, 'body is not an object', res);
  }
  return body as Record<string, unknown>;
}

function toUser(raw: unknown, endpoint: string, res: IgRawResponse): IgUser {
  const user = (raw ?? {}) as Record<string, unknown>;
  const pk = user.pk;
  if ((typeof pk !== 'string' && typeof pk !== 'number') || typeof user.username !== 'string') {
    throw new IgShapeError(endpoint, 'user missing pk or username', res);
  }
  return {
    pk: String(pk),
    username: user.username,
    fullName: typeof user.full_name === 'string' ? user.full_name : '',
    picUrl: typeof user.profile_pic_url === 'string' ? user.profile_pic_url : '',
    isPrivate: user.is_private === true,
    isVerified: user.is_verified === true,
  };
}

export function parseUserPage(res: IgRawResponse, endpoint: string): { users: IgUser[]; nextMaxId: string | null } {
  const body = parseBody(res, endpoint);
  if (!Array.isArray(body.users)) {
    throw new IgShapeError(endpoint, 'missing users array', res);
  }
  const users = body.users.map((raw) => toUser(raw, endpoint, res));
  const hasCursor = body.has_more !== false && body.next_max_id != null;
  return { users, nextMaxId: hasCursor ? String(body.next_max_id) : null };
}

export function parseMutualsPage(res: IgRawResponse, endpoint: string): MutualPreview {
  const body = parseBody(res, endpoint);
  if (!Array.isArray(body.users)) {
    throw new IgShapeError(endpoint, 'missing users array', res);
  }
  const users = body.users.slice(0, LIST_PAGE_SIZE).map((raw) => toUser(raw, endpoint, res));
  return {
    usernames: users.map((user) => user.username),
    picUrls: users.map((user) => user.picUrl),
    hasMore: body.next_max_id != null,
  };
}

export function parseWriteResult(res: IgRawResponse, endpoint: string): void {
  const body = parseBody(res, endpoint);
  if (body.status !== 'ok') {
    throw new IgShapeError(endpoint, `status is ${String(body.status)}`, res);
  }
}
