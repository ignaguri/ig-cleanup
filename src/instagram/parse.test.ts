import { describe, expect, it } from 'vitest';
import followers from './__fixtures__/followers-page.json';
import following from './__fixtures__/following-page.json';
import mutuals from './__fixtures__/mutuals-page.json';
import writes from './__fixtures__/writes.json';
import { IgBlockedError, IgRetryableError, IgShapeError } from './errors';
import { detectBlock, parseMutualsPage, parseUserPage, parseWriteResult } from './parse';
import type { IgRawResponse } from './transport';

const URL_OK = 'https://www.instagram.com/api/v1/friendships/1/followers/';

function ok(body: unknown): IgRawResponse {
  return { status: 200, url: URL_OK, text: JSON.stringify(body) };
}

describe('parseUserPage', () => {
  it('parses followers with a string cursor', () => {
    const page = parseUserPage(ok(followers), 'followers');
    expect(page.users).toHaveLength(3);
    expect(page.nextMaxId).toBe(followers.next_max_id);
    expect(typeof page.users[0].pk).toBe('string');
    expect(page.users[0]).toMatchObject({
      username: 'fake.user_1',
      fullName: 'Fake Person 1',
      isPrivate: false,
      isVerified: false,
    });
    expect(page.users[0].picUrl).toContain('1_150x150');
  });

  it('returns the following cursor', () => {
    expect(parseUserPage(ok(following), 'following').nextMaxId).toBe('13');
  });

  it('normalizes numeric pks and keeps empty full names', () => {
    const page = parseUserPage(ok(mutuals), 'mutuals');
    expect(page.users).toHaveLength(3);
    expect(page.users[0].pk).toBe('1000000007');
    expect(page.users[2].fullName).toBe('');
    expect(page.nextMaxId).toBeNull();
  });

  it('returns a null cursor when has_more is false', () => {
    const page = parseUserPage(ok({ ...followers, has_more: false }), 'followers');
    expect(page.nextMaxId).toBeNull();
  });

  it('throws IgShapeError when users is missing', () => {
    const res = { status: 200, url: URL_OK, text: '{"status":"ok"}' };
    expect(() => parseUserPage(res, 'followers')).toThrow(IgShapeError);
    try {
      parseUserPage(res, 'followers');
    } catch (error) {
      expect((error as IgShapeError).endpoint).toBe('followers');
    }
  });

  it('throws IgShapeError when a user lacks pk or username', () => {
    expect(() => parseUserPage(ok({ users: [{ username: 'a' }] }), 'x')).toThrow(IgShapeError);
    expect(() => parseUserPage(ok({ users: [{ pk: '1' }] }), 'x')).toThrow(IgShapeError);
  });

  it('throws IgRetryableError on 5xx', () => {
    const res = { status: 502, url: URL_OK, text: '<html>bad gateway</html>' };
    expect(() => parseUserPage(res, 'followers')).toThrow(IgRetryableError);
  });

  it('throws IgBlockedError when blocked', () => {
    const res = { status: 429, url: URL_OK, text: '{}' };
    expect(() => parseUserPage(res, 'followers')).toThrow(IgBlockedError);
  });
});

describe('parseMutualsPage', () => {
  it('has no more pages when next_max_id is null', () => {
    const preview = parseMutualsPage(ok(mutuals), 'mutuals');
    expect(preview.usernames).toEqual(['fake.user_7', 'fake.user_8', 'fake.user_9']);
    expect(preview.picUrls).toHaveLength(3);
    expect(preview.hasMore).toBe(false);
  });

  it('has more pages when next_max_id is set', () => {
    const preview = parseMutualsPage(ok({ ...mutuals, next_max_id: 'cursor' }), 'mutuals');
    expect(preview.hasMore).toBe(true);
  });
});

describe('detectBlock', () => {
  const now = 1234;

  it('detects 429', () => {
    const block = detectBlock({ status: 429, url: URL_OK, text: '' }, 'e', now);
    expect(block).toMatchObject({ reason: 'http_429', status: 429, endpoint: 'e', at: now });
  });

  it.each(['feedback_required', 'checkpoint_required', 'login_required'])('detects %s', (message) => {
    const res = { status: 400, url: URL_OK, text: JSON.stringify({ message, status: 'fail' }) };
    expect(detectBlock(res, 'e', now)?.reason).toBe(message);
  });

  it('detects a login redirect on a 200', () => {
    const res = {
      status: 200,
      url: 'https://www.instagram.com/accounts/login/?next=%2Fapi',
      text: '<html>',
    };
    expect(detectBlock(res, 'e', now)?.reason).toBe('login_redirect');
  });

  it('detects a challenge redirect', () => {
    const res = { status: 200, url: 'https://www.instagram.com/challenge/abc/', text: '<html>' };
    expect(detectBlock(res, 'e', now)?.reason).toBe('challenge_redirect');
  });

  it('detects non-JSON bodies and truncates the excerpt', () => {
    const res = { status: 200, url: URL_OK, text: `<!DOCTYPE html>${'x'.repeat(300)}` };
    const block = detectBlock(res, 'e', now);
    expect(block?.reason).toBe('non_json');
    expect(block?.excerpt).toHaveLength(200);
  });

  it('returns null for a healthy response', () => {
    expect(detectBlock(ok(followers), 'e', now)).toBeNull();
  });
});

describe('parseWriteResult', () => {
  it('accepts the captured write responses', () => {
    for (const fixture of [writes.unfollow, writes.follow, writes.remove]) {
      expect(() => parseWriteResult(ok(fixture.response), 'w')).not.toThrow();
    }
  });

  it('throws IgShapeError when status is not ok', () => {
    expect(() => parseWriteResult(ok({ status: 'fail' }), 'w')).toThrow(IgShapeError);
  });
});
