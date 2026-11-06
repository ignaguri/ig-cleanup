import type { Settings } from './types';

export const DB_NAME = 'ig-cleanup';
export const DB_VERSION = 1;

export const STORE_PEOPLE = 'people';
export const STORE_ACTIONS = 'actions';
export const STORE_REQUEST_LOG = 'requestLog';
export const STORE_META = 'meta';

export const META_ACCOUNT = 'account';
export const META_MODE = 'mode';
export const META_BLOCK = 'block';
export const META_COLLECTION = 'collection';
export const META_SETTINGS = 'settings';
export const META_LAST_SENT_AT = 'lastSentAt';

export const IG_ORIGIN = 'https://www.instagram.com';
export const IG_APP_ID = '936619743392459';

export const LIST_PAGE_SIZE = 12;
export const LIST_DELAY_MS: [number, number] = [2000, 4000];
export const MUTUALS_DELAY_MS: [number, number] = [5000, 10000];

export const DEFAULT_SETTINGS: Settings = { dailyCap: 100, minDelayMs: 30000, maxDelayMs: 90000 };
export const MAX_ATTEMPTS = 3;
export const UNDO_HISTORY_SIZE = 20;
export const REQUEST_LOG_SIZE = 50;
export const SEND_ALARM = 'igc-send';
