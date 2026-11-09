<script lang="ts">
import clsx from 'clsx';
import { onMount } from 'svelte';
import { applyExportDates, parseExport, readExportFiles } from '../../core/export';
import { allPeople, getMeta, putPeople, setMeta } from '../../db/db';
import { DEFAULT_SETTINGS, META_SETTINGS } from '../../shared/constants';
import { log } from '../../shared/log';
import type { Mode, Settings } from '../../shared/types';
import { kick } from '../lib/decide';
import ConfirmDialog from './ConfirmDialog.svelte';
import Icon from './Icon.svelte';

type Props = {
  mode: Mode | undefined;
  onRefreshPictures: () => void;
  onStartNew: () => void;
  onError: (error: unknown) => void;
  onImported: () => void;
};
let { mode, onRefreshPictures, onStartNew, onError, onImported }: Props = $props();

const SAVED_NOTE_MS = 2000;

let dailyCap = $state(DEFAULT_SETTINGS.dailyCap);
let minDelaySeconds = $state(DEFAULT_SETTINGS.minDelayMs / 1000);
let maxDelaySeconds = $state(DEFAULT_SETTINGS.maxDelayMs / 1000);
let settingsMessage = $state<{ text: string; tone: 'ok' | 'error' } | null>(null);
let importMessage = $state('');
let confirmOpen = $state(false);
let importing = $state(false);
let savedTimerId: ReturnType<typeof setTimeout> | undefined;

const collecting = $derived(mode === 'collecting');

onMount(() => {
  getMeta<Settings>(META_SETTINGS)
    .then((stored) => {
      const settings = stored ?? DEFAULT_SETTINGS;
      dailyCap = settings.dailyCap;
      minDelaySeconds = settings.minDelayMs / 1000;
      maxDelaySeconds = settings.maxDelayMs / 1000;
    })
    .catch(onError);
  return () => clearTimeout(savedTimerId);
});

async function saveSettings() {
  clearTimeout(savedTimerId);
  const capValid = Number.isInteger(dailyCap) && dailyCap >= 1 && dailyCap <= 500;
  if (!capValid) {
    settingsMessage = { text: 'Daily cap must be a whole number from 1 to 500', tone: 'error' };
    return;
  }
  if (!(minDelaySeconds >= 10) || !(maxDelaySeconds >= minDelaySeconds)) {
    settingsMessage = { text: 'Min delay must be at least 10 s, and max delay at least the min', tone: 'error' };
    return;
  }
  try {
    await setMeta<Settings>(META_SETTINGS, {
      dailyCap,
      minDelayMs: Math.round(minDelaySeconds * 1000),
      maxDelayMs: Math.round(maxDelaySeconds * 1000),
    });
    kick();
    settingsMessage = { text: 'Saved', tone: 'ok' };
    savedTimerId = setTimeout(() => (settingsMessage = null), SAVED_NOTE_MS);
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
    importMessage = `Follow dates added for ${matched} accounts, ${unmatched} not found`;
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

const FIELDS = [
  { id: 'daily-cap', label: 'Daily cap', hint: 'Unfollows and removals per 24 hours', unit: 'per day' },
  { id: 'min-delay', label: 'Min delay', hint: 'Shortest wait between two sends', unit: 's' },
  { id: 'max-delay', label: 'Max delay', hint: 'Longest wait between two sends', unit: 's' },
] as const;
</script>

{#snippet sectionHeader(title: string, description: string)}
  <div>
    <h2 class="text-base font-semibold">{title}</h2>
    <p class="mt-0.5 text-sm text-muted">{description}</p>
  </div>
{/snippet}

<section class="mx-auto flex w-full max-w-xl flex-col gap-5 text-sm">
  <form
    class="panel space-y-5 p-6"
    onsubmit={(event) => {
      event.preventDefault();
      saveSettings();
    }}
  >
    {@render sectionHeader('Sending pace', 'Each send waits a random time between the two delays.')}
    <div class="divide-y divide-line">
      {#each FIELDS as field (field.id)}
        <div class="flex items-center justify-between gap-4 py-3 first:pt-0">
          <label for={field.id}>
            <span class="block text-text">{field.label}</span>
            <span class="block text-xs text-muted">{field.hint}</span>
          </label>
          <span class="flex items-center gap-2">
            {#if field.id === 'daily-cap'}
              <input id={field.id} type="number" min="1" max="500" class="field" bind:value={dailyCap} />
            {:else if field.id === 'min-delay'}
              <input id={field.id} type="number" min="10" class="field" bind:value={minDelaySeconds} />
            {:else}
              <input id={field.id} type="number" min="10" class="field" bind:value={maxDelaySeconds} />
            {/if}
            <span class="w-12 text-xs text-muted">{field.unit}</span>
          </span>
        </div>
      {/each}
    </div>
    <div class="flex items-center gap-3">
      <button type="submit" class="press btn btn-primary">Save</button>
      {#if settingsMessage}
        <span
          class={clsx('flex items-center gap-1.5', settingsMessage.tone === 'ok' ? 'text-keep' : 'text-cut')}
          role="status"
        >
          {#if settingsMessage.tone === 'ok'}<Icon name="check" size={14} />{/if}
          {settingsMessage.text}
        </span>
      {/if}
    </div>
  </form>

  <div class="panel space-y-5 p-6">
    {@render sectionHeader('Data', 'Add follow dates from an Instagram export, or reload profile pictures.')}
    <div class="flex flex-wrap items-center gap-3">
      <label
        class={clsx(
          'press btn btn-quiet has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-text',
          (collecting || importing) && 'pointer-events-none opacity-40')}
        aria-disabled={collecting || importing}
      >
        <Icon name="upload" size={14} />
        {importing ? 'Importing…' : 'Load export (.zip or .json)'}
        <input
          type="file"
          multiple
          accept=".zip,.json"
          class="sr-only"
          disabled={collecting || importing}
          onchange={loadExport}
        />
      </label>
      <button type="button" class="press btn btn-quiet" onclick={onRefreshPictures}>
        <Icon name="refresh" size={14} /> Refresh pictures
      </button>
    </div>
    {#if collecting}
      <p class="text-xs text-muted">Pause collection before loading an export.</p>
    {/if}
    {#if importMessage}
      <p class="text-soft" role="status">{importMessage}</p>
    {/if}
  </div>

  <div class="space-y-4 rounded-2xl border border-cut/25 p-6">
    {@render sectionHeader(
      'Start over',
      'Deletes every collected account, decision and queued send in this browser. Nothing changes on Instagram.',
    )}
    <button type="button" class="press btn btn-danger" onclick={() => (confirmOpen = true)}>
      <Icon name="trash" size={14} /> Start a new cleanup
    </button>
  </div>
</section>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Start a new cleanup?"
  description="This deletes all collected people, decisions and the queue. It can't be undone."
  confirmLabel="Delete and start new"
  onConfirm={onStartNew}
/>
