<script lang="ts">
import { applyExportDates, parseExport, readExportFiles } from '../../core/export';
import { allPeople, getMeta, putPeople, type RequestLogRow, recentRequests, setMeta } from '../../db/db';
import { DEFAULT_SETTINGS, META_SETTINGS } from '../../shared/constants';
import { log } from '../../shared/log';
import type { Mode, Settings } from '../../shared/types';
import { kick } from '../lib/decide';
import ConfirmDialog from './ConfirmDialog.svelte';

type Props = {
  mode: Mode | undefined;
  refreshKey: number;
  onPause: () => void;
  onStartSending: () => void;
  onRefreshPictures: () => void;
  onStartNew: () => void;
  onError: (error: unknown) => void;
  onImported: () => void;
};
let { mode, refreshKey, onPause, onStartSending, onRefreshPictures, onStartNew, onError, onImported }: Props = $props();

let dailyCap = $state(DEFAULT_SETTINGS.dailyCap);
let minDelaySeconds = $state(DEFAULT_SETTINGS.minDelayMs / 1000);
let maxDelaySeconds = $state(DEFAULT_SETTINGS.maxDelayMs / 1000);
let settingsMessage = $state('');
let importMessage = $state('');
let requests = $state<RequestLogRow[]>([]);
let confirmOpen = $state(false);
let importing = $state(false);
let loaded = false;

async function loadSettings() {
  const stored = await getMeta<Settings>(META_SETTINGS);
  const settings = stored ?? DEFAULT_SETTINGS;
  dailyCap = settings.dailyCap;
  minDelaySeconds = settings.minDelayMs / 1000;
  maxDelaySeconds = settings.maxDelayMs / 1000;
}

async function loadRequests() {
  requests = await recentRequests();
}

$effect(() => {
  refreshKey;
  const work = loaded ? loadRequests() : Promise.all([loadSettings(), loadRequests()]);
  loaded = true;
  work.catch(onError);
});

async function saveSettings() {
  const capValid = Number.isInteger(dailyCap) && dailyCap >= 1 && dailyCap <= 500;
  if (!capValid) {
    settingsMessage = 'Daily cap must be a whole number from 1 to 500';
    return;
  }
  if (!(minDelaySeconds >= 10) || !(maxDelaySeconds >= minDelaySeconds)) {
    settingsMessage = 'Min delay must be at least 10 s, and max delay at least the min';
    return;
  }
  try {
    await setMeta<Settings>(META_SETTINGS, {
      dailyCap,
      minDelayMs: Math.round(minDelaySeconds * 1000),
      maxDelayMs: Math.round(maxDelaySeconds * 1000),
    });
    kick();
    settingsMessage = 'Saved';
  } catch (error) {
    onError(error);
  }
}

async function loadExport(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length === 0) {
    return;
  }
  importing = true;
  try {
    const dates = parseExport(await readExportFiles(files));
    const { updated, matched, unmatched } = applyExportDates(await allPeople(), dates);
    await putPeople(updated);
    importMessage = `Matched ${matched}, unmatched ${unmatched}`;
    onImported();
  } catch (error) {
    log.error('export import failed', error);
    importMessage = '';
    onError(error);
  } finally {
    input.value = '';
    importing = false;
  }
}
</script>

<section class="mx-auto w-full max-w-xl space-y-6 text-sm">
  <form
    class="space-y-3 rounded-card bg-surface p-4"
    onsubmit={(event) => {
      event.preventDefault();
      saveSettings();
    }}
  >
    <h2 class="text-lg">Sending</h2>
    <label class="flex items-center justify-between gap-3">
      Daily cap
      <input type="number" class="w-28 rounded-card bg-bg px-2 py-1" bind:value={dailyCap} />
    </label>
    <label class="flex items-center justify-between gap-3">
      Min delay (s)
      <input type="number" class="w-28 rounded-card bg-bg px-2 py-1" bind:value={minDelaySeconds} />
    </label>
    <label class="flex items-center justify-between gap-3">
      Max delay (s)
      <input type="number" class="w-28 rounded-card bg-bg px-2 py-1" bind:value={maxDelaySeconds} />
    </label>
    <div class="flex items-center gap-3">
      <button type="submit" class="rounded-card bg-keep px-3 py-1 text-bg">Save</button>
      {#if settingsMessage}
        <span class="text-muted">{settingsMessage}</span>
      {/if}
    </div>
    <div class="flex gap-3">
      {#if mode === 'sending'}
        <button type="button" class="rounded-card bg-bg px-3 py-1" onclick={onPause}>Pause sending</button>
      {:else}
        <button type="button" class="rounded-card bg-bg px-3 py-1" onclick={onStartSending}>Start sending</button>
      {/if}
      {#if (mode ?? 'paused') !== 'paused'}
        <button type="button" class="rounded-card bg-bg px-3 py-1" onclick={onPause}>Pause</button>
      {/if}
    </div>
  </form>

  <div class="space-y-3 rounded-card bg-surface p-4">
    <h2 class="text-lg">Data</h2>
    <label class="block space-y-1">
      <span>Load export</span>
      <input
        type="file"
        multiple
        accept=".zip,.json"
        disabled={mode === 'collecting' || importing}
        onchange={loadExport}
      />
    </label>
    {#if mode === 'collecting'}
      <p class="text-muted">Pause collection before loading an export.</p>
    {/if}
    {#if importing}
      <p class="text-muted">Importing…</p>
    {/if}
    {#if importMessage}
      <p class="text-muted">{importMessage}</p>
    {/if}
    <div class="flex gap-3">
      <button type="button" class="rounded-card bg-bg px-3 py-1" onclick={onRefreshPictures}>Refresh pictures</button>
      <button type="button" class="rounded-card bg-cut px-3 py-1" onclick={() => (confirmOpen = true)}>
        Start a new cleanup
      </button>
    </div>
  </div>

  <div class="space-y-2 rounded-card bg-surface p-4">
    <h2 class="text-lg">Last requests</h2>
    {#each requests as row (row.id)}
      <p class="text-muted">{row.endpoint} | {row.status ?? '-'} | {row.outcome} | {new Date(row.at).toLocaleString()}</p>
    {:else}
      <p class="text-muted">No requests yet</p>
    {/each}
  </div>
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Start a new cleanup?"
  description="This deletes all collected people, decisions and the queue."
  confirmLabel="Delete and start new"
  onConfirm={onStartNew}
/>
