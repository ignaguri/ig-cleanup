import { describe, expect, it } from 'vitest';
import writes from './__fixtures__/writes.json';
import {
  followersRequest,
  followingRequest,
  followRequest,
  followStatusRequest,
  mutualsRequest,
  profileCountsRequest,
  removeFollowerRequest,
  unfollowRequest,
} from './endpoints';

type WriteFixture = { method: string; url: string; form: Record<string, string> };

// Tokens are added by the relay; nav_chain is deliberately not replicated.
function expectedWrite(fixture: WriteFixture, fixtureId: string, pk: string) {
  const { jazoest, fb_dtsg, nav_chain, ...form } = fixture.form;
  return {
    method: fixture.method,
    path: new URL(fixture.url).pathname.replace(fixtureId, pk),
    form: JSON.parse(JSON.stringify(form).replaceAll(fixtureId, pk)),
  };
}

function actualWrite(request: ReturnType<typeof unfollowRequest>) {
  return { method: request.method, path: request.path, form: request.form ?? {} };
}

describe('list requests', () => {
  it('builds the followers request', () => {
    expect(followersRequest('1', null)).toEqual({
      method: 'GET',
      path: '/api/v1/friendships/1/followers/',
      query: { count: '12', search_surface: 'follow_list_page' },
    });
  });

  it('adds max_id when paginating', () => {
    expect(followersRequest('1', 'abc').query?.max_id).toBe('abc');
    expect(followingRequest('1', 'abc').query?.max_id).toBe('abc');
  });

  it('builds the following request without search_surface', () => {
    expect(followingRequest('1', null)).toEqual({
      method: 'GET',
      path: '/api/v1/friendships/1/following/',
      query: { count: '12' },
    });
  });

  it('builds the mutuals request', () => {
    expect(mutualsRequest('5')).toEqual({
      method: 'GET',
      path: '/api/v1/friendships/5/mutual_followers/',
      query: { page_size: '12' },
    });
  });
});

describe('follow status request', () => {
  it('sends the ids comma separated', () => {
    expect(followStatusRequest(['1', '2'])).toEqual({
      method: 'POST',
      path: '/api/v1/friendships/show_many/',
      form: { user_ids: '1,2' },
    });
  });
});

describe('profile counts request', () => {
  it("asks for my profile with the page's doc_id and flags", () => {
    const request = profileCountsRequest('42', { docId: '99', providedVariables: { flag: true }, lsd: 'L' });
    expect(request).toMatchObject({
      method: 'POST',
      path: '/graphql/query',
      form: { doc_id: '99', lsd: 'L' },
      headers: { 'X-FB-LSD': 'L', 'X-FB-Friendly-Name': 'PolarisProfilePageContentQuery' },
    });
    expect(JSON.parse(request.form?.variables ?? '')).toMatchObject({ id: '42', flag: true });
  });
});

describe('write requests', () => {
  it('matches the captured unfollow', () => {
    expect(actualWrite(unfollowRequest('77'))).toEqual(expectedWrite(writes.unfollow, '1000000011', '77'));
  });

  it('matches the captured follow', () => {
    expect(actualWrite(followRequest('77'))).toEqual(expectedWrite(writes.follow, '1000000011', '77'));
  });

  it('matches the captured remove follower', () => {
    expect(actualWrite(removeFollowerRequest('77'))).toEqual(expectedWrite(writes.remove, '1000000010', '77'));
  });
});
