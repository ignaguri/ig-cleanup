import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import { decisionImplies } from '../core/decisions';
import {
  DB_NAME,
  DB_VERSION,
  META_MODE,
  REQUEST_LOG_SIZE,
  STORE_ACTIONS,
  STORE_META,
  STORE_PEOPLE,
  STORE_REQUEST_LOG,
} from '../shared/constants';
import type { ActionStatus, Decision, Mode, Person, QueuedAction } from '../shared/types';

export type RequestLogRow = { id?: number; endpoint: string; status: number | null; at: number; outcome: string };

type MetaRow = { key: string; value: unknown };

interface IgCleanupDb extends DBSchema {
  people: { key: string; value: Person };
  actions: { key: number; value: QueuedAction; indexes: { status: ActionStatus } };
  requestLog: { key: number; value: RequestLogRow };
  meta: { key: string; value: MetaRow };
}

let dbPromise: Promise<IDBPDatabase<IgCleanupDb>> | null = null;

export function openDb(): Promise<IDBPDatabase<IgCleanupDb>> {
  if (!dbPromise) {
    dbPromise = openDB<IgCleanupDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE_PEOPLE, { keyPath: 'pk' });
        const actions = db.createObjectStore(STORE_ACTIONS, { keyPath: 'id', autoIncrement: true });
        actions.createIndex('status', 'status');
        db.createObjectStore(STORE_REQUEST_LOG, { keyPath: 'id', autoIncrement: true });
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      },
      // The deck tab and the service worker share the DB; let a future upgrade through.
      blocking() {
        void dbPromise?.then((db) => db.close());
        dbPromise = null;
      },
      terminated() {
        dbPromise = null;
      },
    }).catch((error: unknown) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

export async function getPerson(pk: string): Promise<Person | undefined> {
  return (await openDb()).get(STORE_PEOPLE, pk);
}

export async function putPeople(people: Person[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_PEOPLE, 'readwrite');
  await Promise.all([...people.map((person) => tx.store.put(person)), tx.done]);
}

// Read-modify-write in one transaction, so the collector and a decision never overwrite each other's fields.
export async function mergePeople(pks: string[], merge: (current: Map<string, Person>) => Person[]): Promise<Person[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_PEOPLE, 'readwrite');
  const current = new Map<string, Person>();
  for (const pk of new Set(pks)) {
    const person = await tx.store.get(pk);
    if (person) {
      current.set(pk, person);
    }
  }
  const merged = merge(current);
  await Promise.all([...merged.map((person) => tx.store.put(person)), tx.done]);
  return merged;
}

export async function allPeople(): Promise<Person[]> {
  return (await openDb()).getAll(STORE_PEOPLE);
}

export async function addActions(actions: QueuedAction[]): Promise<number[]> {
  const db = await openDb();
  const tx = db.transaction(STORE_ACTIONS, 'readwrite');
  const [ids] = await Promise.all([Promise.all(actions.map((action) => tx.store.add(action))), tx.done]);
  return ids;
}

export async function updateAction(action: QueuedAction): Promise<void> {
  await (await openDb()).put(STORE_ACTIONS, action);
}

export async function actionsByStatus(status: ActionStatus): Promise<QueuedAction[]> {
  return (await openDb()).getAllFromIndex(STORE_ACTIONS, 'status', status);
}

export async function allActions(): Promise<QueuedAction[]> {
  return (await openDb()).getAll(STORE_ACTIONS);
}

export async function getAction(id: number): Promise<QueuedAction | undefined> {
  return (await openDb()).get(STORE_ACTIONS, id);
}

export async function logRequest(row: RequestLogRow): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE_REQUEST_LOG, 'readwrite');
  await tx.store.add(row);
  const keys = await tx.store.getAllKeys();
  const excess = keys.length - REQUEST_LOG_SIZE;
  for (const key of keys.slice(0, Math.max(0, excess))) {
    await tx.store.delete(key);
  }
  await tx.done;
}

export async function recentRequests(): Promise<RequestLogRow[]> {
  const rows = await (await openDb()).getAll(STORE_REQUEST_LOG);
  return rows.reverse();
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await (await openDb()).get(STORE_META, key);
  return row?.value as T | undefined;
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await (await openDb()).put(STORE_META, { key, value });
}

export type DataSnapshot = {
  people: Person[];
  actions: QueuedAction[];
  requestLog: RequestLogRow[];
  meta: Record<string, unknown>;
};

// One read transaction, so the snapshot is consistent even while the sender writes.
export async function snapshotAll(): Promise<DataSnapshot> {
  const db = await openDb();
  const tx = db.transaction([STORE_PEOPLE, STORE_ACTIONS, STORE_REQUEST_LOG, STORE_META], 'readonly');
  const [people, actions, requestLog, metaRows] = await Promise.all([
    tx.objectStore(STORE_PEOPLE).getAll(),
    tx.objectStore(STORE_ACTIONS).getAll(),
    tx.objectStore(STORE_REQUEST_LOG).getAll(),
    tx.objectStore(STORE_META).getAll(),
    tx.done,
  ]);
  return { people, actions, requestLog, meta: Object.fromEntries(metaRows.map((row) => [row.key, row.value])) };
}

export async function wipeAll(): Promise<void> {
  const db = await openDb();
  const stores = [STORE_PEOPLE, STORE_ACTIONS, STORE_REQUEST_LOG, STORE_META] as const;
  const tx = db.transaction(stores, 'readwrite');
  await Promise.all([...stores.map((store) => tx.objectStore(store).clear()), tx.done]);
}

export async function cancelIfQueued(id: number): Promise<boolean> {
  const db = await openDb();
  const tx = db.transaction(STORE_ACTIONS, 'readwrite');
  const action = await tx.store.get(id);
  if (action?.status !== 'queued') {
    await tx.done;
    return false;
  }
  await Promise.all([tx.store.put({ ...action, status: 'cancelled' }), tx.done]);
  return true;
}

// Reads the person and the mode in the same transaction, so neither an undo nor a switch to collecting
// can slip between the check and the claim.
export async function claimForSending(id: number): Promise<QueuedAction | null> {
  const db = await openDb();
  const tx = db.transaction([STORE_PEOPLE, STORE_ACTIONS, STORE_META], 'readwrite');
  const actions = tx.objectStore(STORE_ACTIONS);
  const action = await actions.get(id);
  const mode = (await tx.objectStore(STORE_META).get(META_MODE))?.value as Mode | undefined;
  if (action?.status !== 'queued' || mode !== 'sending') {
    await tx.done;
    return null;
  }
  const person = await tx.objectStore(STORE_PEOPLE).get(action.personPk);
  if (!person || !decisionImplies(person.decision, action.type)) {
    await Promise.all([actions.put({ ...action, status: 'cancelled' }), tx.done]);
    return null;
  }
  const claimed: QueuedAction = { ...action, status: 'sending' };
  await Promise.all([actions.put(claimed), tx.done]);
  return claimed;
}

// Puts a failed send back in the queue only if it is still in flight and still wanted.
export async function requeueIfStillWanted(action: QueuedAction, patch: Partial<QueuedAction>): Promise<boolean> {
  if (action.id === undefined) {
    return false;
  }
  const db = await openDb();
  const tx = db.transaction([STORE_PEOPLE, STORE_ACTIONS], 'readwrite');
  const actions = tx.objectStore(STORE_ACTIONS);
  const latest = await actions.get(action.id);
  if (latest?.status !== 'sending') {
    await tx.done;
    return false;
  }
  const person = await tx.objectStore(STORE_PEOPLE).get(latest.personPk);
  if (!person || !decisionImplies(person.decision, latest.type)) {
    await Promise.all([actions.put({ ...latest, status: 'cancelled' }), tx.done]);
    return false;
  }
  await Promise.all([actions.put({ ...latest, ...patch, status: 'queued' }), tx.done]);
  return true;
}

// Patches the stored person rather than writing a copy, so fields the collector filled in meanwhile survive.
export async function recordDecision(
  personPk: string,
  patch: { decision: Decision; decidedAt: number | null },
  actions: QueuedAction[],
): Promise<number[]> {
  const db = await openDb();
  const tx = db.transaction([STORE_PEOPLE, STORE_ACTIONS], 'readwrite');
  const people = tx.objectStore(STORE_PEOPLE);
  const person = await people.get(personPk);
  if (!person) {
    await tx.done;
    return [];
  }
  const [, ids] = await Promise.all([
    people.put({ ...person, ...patch }),
    Promise.all(actions.map((action) => tx.objectStore(STORE_ACTIONS).add(action))),
    tx.done,
  ]);
  return ids;
}
