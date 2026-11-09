import { snapshotAll } from '../../db/db';
import { DB_VERSION } from '../../shared/constants';

export async function downloadExport(now: Date): Promise<string> {
  const snapshot = await snapshotAll();
  const payload = { app: 'ig-cleanup', dbVersion: DB_VERSION, exportedAt: now.toISOString(), ...snapshot };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0'));
  const fileName = `ig-cleanup-${date.join('-')}.json`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // The click starts the download synchronously; revoke on the next tick.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return `Exported ${snapshot.people.length} accounts, ${snapshot.actions.length} sends to ${fileName}`;
}
