import { logRequest, type RequestLogRow } from '../db/db';
import { log } from '../shared/log';
import type { MutualPreview } from '../shared/types';
import {
  followersRequest,
  followingRequest,
  followRequest,
  mutualsRequest,
  removeFollowerRequest,
  unfollowRequest,
} from './endpoints';
import { IgBlockedError, IgRetryableError, IgShapeError } from './errors';
import { type IgUser, parseMutualsPage, parseUserPage, parseWriteResult } from './parse';
import { type IgRawResponse, type IgRequest, igFetch, readSession } from './transport';

type UserPage = { users: IgUser[]; nextMaxId: string | null };

function describeError(error: unknown): string {
  if (error instanceof IgBlockedError) {
    return `${error.name}:${error.info.reason}`;
  }
  if (error instanceof IgShapeError) {
    return `${error.name}:${error.detail}`;
  }
  if (error instanceof Error) {
    return `${error.name}:${error.message}`;
  }
  return 'UnknownError';
}

function errorStatus(error: unknown): number | null {
  if (error instanceof IgBlockedError) {
    return error.info.status || null;
  }
  if (error instanceof IgRetryableError) {
    return error.status;
  }
  return null;
}

async function requireSession(endpoint: string): Promise<{ userId: string; csrfToken: string }> {
  const session = await readSession();
  if (!session) {
    throw new IgBlockedError({
      reason: 'login_required',
      status: 0,
      endpoint,
      excerpt: 'No Instagram session cookie',
      at: Date.now(),
    });
  }
  return session;
}

// Logs every attempt (never bodies or tokens) before parsing, then rethrows errors untouched.
async function send<T>(req: IgRequest, parse: (res: IgRawResponse, endpoint: string) => T): Promise<T> {
  const endpoint = req.path;
  let response: IgRawResponse | null = null;
  let result: T;
  try {
    response = await igFetch(req);
    result = parse(response, endpoint);
  } catch (error) {
    await safeLog({
      endpoint,
      status: response?.status ?? errorStatus(error),
      at: Date.now(),
      outcome: describeError(error),
    });
    throw error;
  }
  await safeLog({ endpoint, status: response.status, at: Date.now(), outcome: 'ok' });
  return result;
}

// A logging failure must never hide the Instagram outcome.
async function safeLog(row: RequestLogRow): Promise<void> {
  try {
    await logRequest(row);
  } catch (error) {
    log.warn('request log write failed', error);
  }
}

export async function fetchFollowersPage(maxId: string | null): Promise<UserPage> {
  const session = await requireSession('/api/v1/friendships/followers/');
  return send(followersRequest(session.userId, maxId), parseUserPage);
}

export async function fetchFollowingPage(maxId: string | null): Promise<UserPage> {
  const session = await requireSession('/api/v1/friendships/following/');
  return send(followingRequest(session.userId, maxId), parseUserPage);
}

export async function fetchMutuals(pk: string): Promise<MutualPreview> {
  await requireSession('/api/v1/friendships/mutual_followers/');
  return send(mutualsRequest(pk), parseMutualsPage);
}

export async function unfollow(pk: string): Promise<void> {
  await requireSession('/api/v1/friendships/destroy/');
  return send(unfollowRequest(pk), parseWriteResult);
}

export async function follow(pk: string): Promise<void> {
  await requireSession('/api/v1/friendships/create/');
  return send(followRequest(pk), parseWriteResult);
}

export async function removeFollower(pk: string): Promise<void> {
  await requireSession('/api/v1/friendships/remove_follower/');
  return send(removeFollowerRequest(pk), parseWriteResult);
}
