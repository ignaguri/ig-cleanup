import { MUTUALS_PATH } from '../../instagram/endpoints';

const ENDPOINTS: { pattern: RegExp; label: string }[] = [
  { pattern: /^\/api\/v1\/friendships\/(\d+)\/followers\/$/, label: 'Followers page' },
  { pattern: /^\/api\/v1\/friendships\/(\d+)\/following\/$/, label: 'Following page' },
  { pattern: MUTUALS_PATH, label: 'People in common' },
  { pattern: /^\/api\/v1\/friendships\/destroy\/(\d+)\/$/, label: 'Unfollow' },
  { pattern: /^\/api\/v1\/friendships\/create\/(\d+)\/$/, label: 'Follow' },
  { pattern: /^\/api\/v1\/friendships\/remove_follower\/(\d+)\/$/, label: 'Remove follower' },
];

// List pages carry the account's own id, so only per-person calls name a target.
const OWN_ID_LABELS = new Set(['Followers page', 'Following page']);

export function describeEndpoint(endpoint: string): { label: string; targetPk: string | null } {
  const path = endpoint.split('?')[0];
  for (const { pattern, label } of ENDPOINTS) {
    const match = pattern.exec(path);
    if (match) {
      return { label, targetPk: OWN_ID_LABELS.has(label) ? null : match[1] };
    }
  }
  return { label: path, targetPk: null };
}
