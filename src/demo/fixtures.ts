import { fetchesMutuals } from '../core/collection';
import { seededRand } from '../core/pacing';
import type { RequestLogRow } from '../db/db';
import type {
  AccountMeta,
  BlockInfo,
  CollectionState,
  Mode,
  MutualPreview,
  Person,
  QueuedAction,
  Settings,
} from '../shared/types';

export const DEMO_USER_ID = '1000000001';

export type Scenario = 'default' | 'collecting' | 'blocked' | 'empty';

export type DemoData = {
  people: Person[];
  actions: QueuedAction[];
  requests: RequestLogRow[];
  meta: {
    account: AccountMeta;
    mode: Mode;
    block: BlockInfo | null;
    collection: CollectionState;
    settings: Settings;
  };
};

const FIRST = ['Lucía', 'Mateo', 'Sofía', 'Bruno', 'Valentina', 'Tomás', 'Camila', 'Joaquín', 'Martina', 'Felipe'];
const LAST = ['Fernández', 'Gómez', 'Romero', 'Sosa', 'Torres', 'Ruiz', 'Álvarez', 'Benítez', 'Herrera', 'Medina'];
const BRANDS = ['Café Molino', 'Estudio Norte', 'Verde Yoga', 'Panadería Sur', 'Hostel Andino', 'Taller Ocre'];
const HUES = [12, 38, 160, 200, 262, 320, 95, 18];

const DAY = 86_400_000;

export function picture(label: string, hue: number): string {
  const initials = label
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 60% 35%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360} 70% 55%)"/></linearGradient></defs><rect width="150" height="150" fill="url(#g)"/><text x="75" y="92" font-family="system-ui" font-size="52" font-weight="700" fill="rgba(255,255,255,.85)" text-anchor="middle">${initials}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function mutualPreview(rand: () => number, index: number): MutualPreview {
  const count = Math.floor(rand() * 4);
  const usernames = Array.from({ length: count }, (_, offset) => {
    const name = FIRST[(index + offset * 3) % FIRST.length];
    return `${name.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')}_${(index * 7 + offset) % 90}`;
  });
  return {
    usernames,
    picUrls: usernames.map((username, offset) => picture(username, HUES[(index + offset) % HUES.length])),
    hasMore: count === 3 && rand() > 0.5,
  };
}

function makePerson(index: number, rand: () => number, now: number): Person {
  const isBrand = index % 7 === 3;
  const fullName = isBrand
    ? BRANDS[index % BRANDS.length]
    : `${FIRST[index % FIRST.length]} ${LAST[(index * 3) % LAST.length]}`;
  // A long name every so often, to exercise wrapping.
  const displayName = index % 11 === 5 ? `${fullName} Estudio Jurídico & Asociados de Córdoba` : fullName;
  const username = `${fullName
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z]+/g, '.')}${index}`;
  const relation = index % 3;
  const iFollow = relation !== 1;
  const followsMe = relation !== 0;
  const person: Person = {
    pk: String(2_000_000_000 + index),
    username,
    fullName: index % 13 === 0 ? '' : displayName,
    picUrl: index % 9 === 4 ? '' : picture(fullName, HUES[index % HUES.length]),
    isPrivate: index % 5 === 2,
    isVerified: index % 17 === 1,
    iFollow,
    followsMe,
    listIndex: index,
    mutuals: null,
    mutualsFetchedAt: null,
    iFollowedAt: iFollow && index % 4 !== 0 ? now - (400 + index * 9) * DAY : null,
    theyFollowedAt: followsMe && index % 4 !== 1 ? now - (200 + index * 5) * DAY : null,
    decision: 'undecided',
    decidedAt: null,
  };
  if (fetchesMutuals(person) && index % 10 !== 9) {
    person.mutuals = mutualPreview(rand, index);
    person.mutualsFetchedAt = now - DAY;
  }
  return person;
}

function action(
  person: Person,
  status: QueuedAction['status'],
  at: number,
  extra: Partial<QueuedAction> = {},
): QueuedAction {
  return {
    personPk: person.pk,
    type: 'unfollow',
    status,
    attempts: status === 'sent' ? 1 : 0,
    createdAt: at,
    notBefore: at,
    sentAt: status === 'sent' ? at + 3 * 60_000 : null,
    error: null,
    ...extra,
  };
}

const DONE_COLLECTION: CollectionState = {
  followers: { done: true, nextMaxId: null, seen: 0 },
  following: { done: true, nextMaxId: null, seen: 0 },
  listsCompletedAt: null,
  mutualsCompletedAt: null,
  refreshingPictures: false,
  modeBeforeRefresh: null,
};

export function buildDemoData(scenario: Scenario, now: number): DemoData {
  // Deterministic so every reload of the same scenario shows the same deck.
  const rand = seededRand(42);
  const people = scenario === 'empty' ? [] : Array.from({ length: 90 }, (_, index) => makePerson(index, rand, now));

  const actions: QueuedAction[] = [];
  const unfollowable = people.filter((person) => person.iFollow && !person.followsMe);
  const removable = people.filter((person) => person.followsMe && !person.iFollow);
  // Decide a handful in each deck, so Activity and the progress bars have something to show.
  unfollowable.slice(0, 8).forEach((person, index) => {
    const at = now - (8 - index) * 15 * 60_000;
    person.decision = index % 4 === 3 ? 'keep' : 'unfollow';
    person.decidedAt = at;
    if (person.decision === 'unfollow') {
      const status = index < 2 ? 'sent' : index === 2 ? 'failed' : index === 4 ? 'cancelled' : 'queued';
      actions.push(
        action(person, status, at, status === 'failed' ? { attempts: 3, error: 'feedback_required (status 400)' } : {}),
      );
    }
  });
  removable.slice(0, 3).forEach((person, index) => {
    const at = now - (3 - index) * 10 * 60_000;
    person.decision = index === 0 ? 'keep' : 'remove';
    person.decidedAt = at;
    if (person.decision === 'remove') {
      actions.push({ ...action(person, 'queued', at), type: 'remove' });
    }
  });

  const requests: RequestLogRow[] = people
    .filter((person) => person.mutualsFetchedAt !== null)
    .slice(0, 30)
    .map((person, index) => ({
      endpoint: `/api/v1/friendships/${person.pk}/mutual_followers/`,
      status: index === 4 ? 429 : 200,
      at: now - (40 - index) * 60_000,
      outcome: index === 4 ? 'http_429' : 'ok',
    }));
  requests.push(
    ...actions
      .filter((queued) => queued.status === 'sent' && queued.sentAt !== null)
      .map((queued) => ({
        endpoint: `/api/v1/friendships/destroy/${queued.personPk}/`,
        status: 200,
        at: queued.sentAt ?? now,
        outcome: 'ok',
      })),
  );
  requests.sort((a, b) => a.at - b.at);

  const collecting = scenario === 'collecting';
  const collection: CollectionState = collecting
    ? {
        ...DONE_COLLECTION,
        followers: { done: true, nextMaxId: null, seen: 1200 },
        following: { done: true, nextMaxId: null, seen: 1100 },
      }
    : { ...DONE_COLLECTION, mutualsCompletedAt: now - 2 * 60 * 60_000, listsCompletedAt: now - 30 * 60 * 60_000 };
  if (collecting) {
    for (const person of people.slice(40)) {
      person.mutuals = null;
      person.mutualsFetchedAt = null;
    }
  }

  return {
    people,
    actions,
    requests,
    meta: {
      account: { userId: DEMO_USER_ID, username: 'demo.account' },
      // Collecting would start the collector, which needs Instagram; the demo shows it paused mid-way instead.
      mode: collecting ? 'paused' : 'sending',
      block:
        scenario === 'blocked'
          ? {
              reason: 'http_429',
              status: 429,
              endpoint: `/api/v1/friendships/${people[4]?.pk ?? '1'}/mutual_followers/`,
              excerpt: '{"message":"Please wait a few minutes before you try again.","status":"fail"}',
              at: now - 20 * 60_000,
            }
          : null,
      collection,
      settings: { dailyCap: 20, minDelayMs: 30_000, maxDelayMs: 90_000 },
    },
  };
}
