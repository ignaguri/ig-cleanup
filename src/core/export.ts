import JSZip from 'jszip';
import { log } from '../shared/log';
import type { Person } from '../shared/types';

export type ExportFile = { name: string; text: string };
export type ExportDates = { followers: Map<string, number>; following: Map<string, number> };

const FOLLOWERS_NAME = /^followers_\d+\.json$/;
const FOLLOWING_NAME = 'following.json';

const basename = (path: string) => path.split('/').pop() ?? path;
const isWantedName = (name: string) => FOLLOWERS_NAME.test(name) || name === FOLLOWING_NAME;

export async function readExportFiles(files: File[]): Promise<ExportFile[]> {
  const result: ExportFile[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.zip')) {
      const zip = await JSZip.loadAsync(file);
      for (const entry of Object.values(zip.files)) {
        if (!entry.dir && isWantedName(basename(entry.name))) {
          result.push({ name: entry.name, text: await entry.async('string') });
        }
      }
    } else if (isWantedName(basename(file.name))) {
      result.push({ name: file.name, text: await file.text() });
    }
  }
  return result;
}

function resolveUsername(entry: unknown): { username: string; timestampMs: number } | null {
  const raw = entry as {
    title?: unknown;
    string_list_data?: { href?: unknown; value?: unknown; timestamp?: unknown }[];
  } | null;
  const data = raw?.string_list_data?.[0];
  if (!data || typeof data.timestamp !== 'number' || !Number.isFinite(data.timestamp)) {
    return null;
  }
  let username = '';
  if (typeof data.value === 'string' && data.value) {
    username = data.value;
  } else if (typeof raw?.title === 'string' && raw.title) {
    username = raw.title;
  } else if (typeof data.href === 'string') {
    username = data.href.replace(/\/+$/, '').split('/').pop() ?? '';
  }
  username = username.trim().toLowerCase();
  if (!username) {
    return null;
  }
  return { username, timestampMs: data.timestamp * 1000 };
}

function collect(target: Map<string, number>, entries: unknown): void {
  if (!Array.isArray(entries)) {
    return;
  }
  for (const entry of entries) {
    const resolved = resolveUsername(entry);
    if (!resolved) {
      continue;
    }
    const existing = target.get(resolved.username);
    if (existing === undefined || resolved.timestampMs < existing) {
      target.set(resolved.username, resolved.timestampMs);
    }
  }
}

export function parseExport(files: ExportFile[]): ExportDates {
  const dates: ExportDates = { followers: new Map(), following: new Map() };
  for (const file of files) {
    const name = basename(file.name);
    const isFollowers = FOLLOWERS_NAME.test(name);
    if (!isFollowers && name !== FOLLOWING_NAME) {
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(file.text);
    } catch {
      log.warn('skipping unparseable export file', file.name);
      continue;
    }
    if (isFollowers) {
      collect(dates.followers, json);
    } else {
      collect(dates.following, (json as { relationships_following?: unknown })?.relationships_following);
    }
  }
  return dates;
}

export function applyExportDates(
  people: Person[],
  dates: ExportDates,
): { updated: Person[]; matched: number; unmatched: number } {
  const byUsername = new Map(people.map((person) => [person.username.toLowerCase(), person]));
  const changes = new Map<string, Person>();
  // Sets, because a mutual appears in both lists but is one account.
  const matched = new Set<string>();
  const unmatched = new Set<string>();

  const apply = (source: Map<string, number>, field: 'theyFollowedAt' | 'iFollowedAt') => {
    for (const [username, timestamp] of source) {
      const person = byUsername.get(username);
      if (!person) {
        unmatched.add(username);
        continue;
      }
      matched.add(username);
      if (person[field] !== timestamp) {
        const next = changes.get(username) ?? { ...person };
        next[field] = timestamp;
        changes.set(username, next);
      }
    }
  };
  apply(dates.followers, 'theyFollowedAt');
  apply(dates.following, 'iFollowedAt');

  return { updated: [...changes.values()], matched: matched.size, unmatched: unmatched.size };
}
