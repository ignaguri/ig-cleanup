import { LIST_PAGE_SIZE } from '../shared/constants';
import type { IgRequest, ProfileQuery } from './transport';

// fb_dtsg / jazoest are added by the relay at send time; nav_chain is telemetry we skip.
const PAGE_SIZE = String(LIST_PAGE_SIZE);

export const MUTUALS_PATH = /^\/api\/v1\/friendships\/(\d+)\/mutual_followers\/$/;

export function followersRequest(userId: string, maxId: string | null): IgRequest {
  const query: Record<string, string> = { count: PAGE_SIZE, search_surface: 'follow_list_page' };
  if (maxId) {
    query.max_id = maxId;
  }
  return { method: 'GET', path: `/api/v1/friendships/${userId}/followers/`, query };
}

export function followingRequest(userId: string, maxId: string | null): IgRequest {
  const query: Record<string, string> = { count: PAGE_SIZE };
  if (maxId) {
    query.max_id = maxId;
  }
  return { method: 'GET', path: `/api/v1/friendships/${userId}/following/`, query };
}

export function mutualsRequest(targetPk: string): IgRequest {
  return {
    method: 'GET',
    path: `/api/v1/friendships/${targetPk}/mutual_followers/`,
    query: { page_size: PAGE_SIZE },
  };
}

// Read-only, but Instagram takes the ids in a POST body.
export function followStatusRequest(pks: string[]): IgRequest {
  return { method: 'POST', path: '/api/v1/friendships/show_many/', form: { user_ids: pks.join(',') } };
}

const PROFILE_QUERY_NAME = 'PolarisProfilePageContentQuery';

// The query the profile page runs for its header. Instagram answers HTML without the friendly-name header.
export function profileCountsRequest(userId: string, query: ProfileQuery): IgRequest {
  return {
    method: 'POST',
    path: '/graphql/query',
    form: {
      __a: '1',
      __d: 'www',
      __comet_req: '7',
      lsd: query.lsd,
      fb_api_caller_class: 'RelayModern',
      fb_api_req_friendly_name: PROFILE_QUERY_NAME,
      server_timestamps: 'true',
      doc_id: query.docId,
      variables: JSON.stringify({
        id: userId,
        render_surface: 'PROFILE',
        enable_integrity_filters: true,
        ...query.providedVariables,
      }),
    },
    headers: { 'X-FB-LSD': query.lsd, 'X-FB-Friendly-Name': PROFILE_QUERY_NAME },
  };
}

export function unfollowRequest(targetPk: string): IgRequest {
  return {
    method: 'POST',
    path: `/api/v1/friendships/destroy/${targetPk}/`,
    form: { container_module: 'profile', user_id: targetPk },
  };
}

export function followRequest(targetPk: string): IgRequest {
  return {
    method: 'POST',
    path: `/api/v1/friendships/create/${targetPk}/`,
    form: { container_module: 'profile', include_follow_friction_check: 'true', user_id: targetPk },
  };
}

export function removeFollowerRequest(targetPk: string): IgRequest {
  return { method: 'POST', path: `/api/v1/friendships/remove_follower/${targetPk}/`, form: {} };
}
