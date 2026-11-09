export type Decision = 'undecided' | 'keep' | 'unfollow' | 'remove' | 'both';

export type DeckId = 'notFollowingBack' | 'fansNotFollowed' | 'mutual';

export type MutualPreview = { usernames: string[]; picUrls: string[]; hasMore: boolean };

export type Person = {
  pk: string;
  username: string;
  fullName: string;
  picUrl: string;
  isPrivate: boolean;
  isVerified: boolean;
  iFollow: boolean;
  followsMe: boolean;
  listIndex: number;
  mutuals: MutualPreview | null;
  mutualsFetchedAt: number | null;
  iFollowedAt: number | null;
  theyFollowedAt: number | null;
  decision: Decision;
  decidedAt: number | null;
  // Missing on records from before rescans existed.
  seenInFollowersAt?: number;
  seenInFollowingAt?: number;
  unfollowedMe?: TimeWindow | null;
  startedFollowingMe?: TimeWindow | null;
};

// Somewhere between two scans; the exact moment isn't knowable.
export type TimeWindow = { after: number; before: number };

export type ActionType = 'unfollow' | 'remove' | 'follow';

export type ActionStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';

export type QueuedAction = {
  id?: number;
  personPk: string;
  type: ActionType;
  status: ActionStatus;
  attempts: number;
  createdAt: number;
  notBefore: number;
  sentAt: number | null;
  error: string | null;
};

export type Mode = 'collecting' | 'sending' | 'paused';

export type BlockInfo = {
  reason:
    | 'http_429'
    | 'feedback_required'
    | 'checkpoint_required'
    | 'login_required'
    | 'login_redirect'
    | 'challenge_redirect'
    | 'rate_limited'
    | 'account_mismatch'
    | 'non_json'
    | 'not_found';
  status: number;
  endpoint: string;
  excerpt: string;
  at: number;
};

export type ListCursor = { done: boolean; nextMaxId: string | null; seen: number };

export type CollectionState = {
  followers: ListCursor;
  following: ListCursor;
  listsCompletedAt: number | null;
  mutualsCompletedAt: number | null;
  refreshingPictures: boolean;
  modeBeforeRefresh: Mode | null;
  rescan?: RescanState | null;
};

export type RescanState = {
  startedAt: number;
  previousAt: number;
  followersDiffSkipped?: boolean;
  followingDiffSkipped?: boolean;
};

export type ScanSummary = {
  startedAt: number;
  completedAt: number;
  followers: number;
  following: number;
  lostFollowers: number;
  newFollowers: number;
  // A list came back much shorter than stored, so nobody was marked as gone from it.
  followersDiffSkipped: boolean;
  followingDiffSkipped?: boolean;
};

export type Settings = { dailyCap: number; minDelayMs: number; maxDelayMs: number };

export type AccountMeta = { userId: string; username: string | null };
