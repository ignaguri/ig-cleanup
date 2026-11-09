import { describe, expect, it } from 'vitest';
import { describeEndpoint } from './requests';

describe('describeEndpoint', () => {
  it('names per-person calls with their target', () => {
    expect(describeEndpoint('/api/v1/friendships/50349665716/mutual_followers/')).toEqual({
      label: 'People in common',
      targetPk: '50349665716',
    });
    expect(describeEndpoint('/api/v1/friendships/destroy/42/')).toEqual({ label: 'Unfollow', targetPk: '42' });
  });

  it('keeps list pages untargeted and falls back to the raw path', () => {
    expect(describeEndpoint('/api/v1/friendships/7/followers/?count=12')).toEqual({
      label: 'Followers page',
      targetPk: null,
    });
    expect(describeEndpoint('/api/v1/other/')).toEqual({ label: '/api/v1/other/', targetPk: null });
  });
});
