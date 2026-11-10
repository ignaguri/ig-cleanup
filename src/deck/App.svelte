<script lang="ts">
import clsx from 'clsx';
import { onMount } from 'svelte';
import { type CollectorHandle, startCollector } from '../collector/collector';
import { checkAccount } from '../core/account-guard';
import { collectionProgress, INITIAL_COLLECTION, nextListStep } from '../core/collection';
import { availableDecisions } from '../core/decisions';
import { buildDeck, deckCounts, deckOf } from '../core/people';
import { isUnsettledInRescan } from '../core/rescan';
import { allPeople, getMeta, setMeta, wipeAll } from '../db/db';
import { readSession, readUsername } from '../instagram/transport';
import { IG_ORIGIN, META_ACCOUNT, META_BLOCK, META_COLLECTION, META_MODE, META_SCANS } from '../shared/constants';
import { log } from '../shared/log';
import type {
  AccountMeta,
  BlockInfo,
  CollectionState,
  Decision,
  DeckId,
  Mode,
  Person,
  ScanSummary,
} from '../shared/types';
import AccountMismatch from './components/AccountMismatch.svelte';
import ActivityView from './components/ActivityView.svelte';
import BlockBanner from './components/BlockBanner.svelte';
import Card from './components/Card.svelte';
import CollectionView from './components/CollectionView.svelte';
import DeckControls from './components/DeckControls.svelte';
import ErrorBanner from './components/ErrorBanner.svelte';
import Icon from './components/Icon.svelte';
import SettingsView from './components/SettingsView.svelte';
import StatusFooter from './components/StatusFooter.svelte';
import VoiceToggle from './components/VoiceToggle.svelte';
import { decide, kick, undoLast } from './lib/decide';
import { accountLabel } from './lib/format';
import { type DeckCommand, keyToCommand } from './lib/keyboard';
import { EXIT_MS } from './lib/motion';

const UNDO_NOTE_MS = 4000;

let people = $state<Person[]>([]);
let selectedDeck = $state<DeckId>('notFollowingBack');
// Tied to the person, so the next card never mounts already exited.
let leaving = $state<{ pk: string; decision: Decision } | null>(null);
let entrance = $state<'next' | 'return'>('next');
let busy = $state(false);
let refreshSequence = 0;
let errorMessage = $state('');
let refreshKey = $state(0);
let undoNotes = $state<string[]>([]);
let undoNoteTimerId: ReturnType<typeof setTimeout> | undefined;

type View = 'deck' | 'activity' | 'collection' | 'settings';
type Gate =
  | { kind: 'loading' }
  | { kind: 'logged_out' }
  | { kind: 'mismatch'; current: AccountMeta; stored: AccountMeta }
  | { kind: 'ok' };

const VIEWS: { id: View; label: string }[] = [
  { id: 'deck', label: 'Deck' },
  { id: 'activity', label: 'Activity' },
  { id: 'collection', label: 'Collection' },
  { id: 'settings', label: 'Settings' },
];

let gate = $state<Gate>({ kind: 'loading' });
let view = $state<View>('deck');
let collection = $state<CollectionState>(INITIAL_COLLECTION);
let mode = $state<Mode | undefined>(undefined);
let block = $state<BlockInfo | null>(null);
let scans = $state<ScanSummary[]>([]);
let collector: CollectorHandle | null = null;

// People first seen in a rescan wait for the following list, or someone I follow back would look like a fan.
const deckPeople = $derived(
  people.filter((person) => !isUnsettledInRescan(person, collection.rescan, collection.following.done)),
);
const counts = $derived(deckCounts(deckPeople));
const deck = $derived(buildDeck(deckPeople, selectedDeck));
const current = $derived(deck[0] ?? null);
const upNext = $derived(deck[1] ?? null);
// Until both lists are read every follower looks like a fan, so the decks stay closed. A picture refresh
// or a rescan re-reads the lists but keeps the relationships, so they don't close them.
const listsPending = $derived(
  nextListStep(collection) !== null && !collection.refreshingPictures && (collection.rescan ?? null) === null,
);

async function refresh() {
  refreshSequence += 1;
  const sequence = refreshSequence;
  const [loaded, storedCollection, storedMode, storedBlock, storedScans] = await Promise.all([
    allPeople(),
    getMeta<CollectionState>(META_COLLECTION),
    getMeta<Mode>(META_MODE),
    getMeta<BlockInfo | null>(META_BLOCK),
    getMeta<ScanSummary[]>(META_SCANS),
  ]);
  if (sequence !== refreshSequence) {
    return;
  }
  people = loaded;
  collection = storedCollection ?? INITIAL_COLLECTION;
  mode = storedMode;
  block = storedBlock ?? null;
  scans = storedScans ?? [];
  refreshKey += 1;
}

function reportError(error: unknown) {
  log.error('unexpected error', error);
  errorMessage = error instanceof Error ? error.message : String(error);
}

async function setMode(next: Mode) {
  await setMeta<Mode>(META_MODE, next);
  mode = next;
  kick();
}

function startCollecting() {
  collector = startCollector(() => {
    refresh().catch(reportError);
  });
}

// Resolves once the collector loop has exited, so no collector request is still in flight.
async function stopCollecting() {
  const stopping = collector;
  collector = null;
  await stopping?.stop();
}

function stopCollectingInBackground() {
  stopCollecting().catch((error) => log.warn('stop collector failed', error));
}

async function handleStartCollecting() {
  try {
    await setMode('collecting');
    startCollecting();
  } catch (error) {
    reportError(error);
  }
}

async function handleSendingMode(next: 'sending' | 'paused') {
  try {
    await stopCollecting();
    await setMode(next);
  } catch (error) {
    reportError(error);
  }
}

// Picture refreshes and rescans both re-read the lists from the start; one already running is resumed.
async function rereadLists(startPatch: (stored: CollectionState) => Promise<Partial<CollectionState>>) {
  try {
    // Stop first: the collector overwrites META_COLLECTION from memory.
    await stopCollecting();
    const storedCollection = (await getMeta<CollectionState>(META_COLLECTION)) ?? INITIAL_COLLECTION;
    if (!storedCollection.refreshingPictures && !storedCollection.rescan) {
      await setMeta<CollectionState>(META_COLLECTION, {
        ...storedCollection,
        followers: INITIAL_COLLECTION.followers,
        following: INITIAL_COLLECTION.following,
        ...(await startPatch(storedCollection)),
      });
    }
    await setMode('collecting');
    startCollecting();
    await refresh();
    view = 'collection';
  } catch (error) {
    reportError(error);
  }
}

function handleRefreshPictures() {
  return rereadLists(async () => {
    const currentMode = (await getMeta<Mode>(META_MODE)) ?? 'paused';
    // The loop ends with the refresh, so never come back to 'collecting' without a running loop.
    return { refreshingPictures: true, modeBeforeRefresh: currentMode === 'collecting' ? 'paused' : currentMode };
  });
}

// Compares the re-read lists with the stored ones; see core/rescan.
function handleScanAgain() {
  return rereadLists(async (stored) => {
    const startedAt = Date.now();
    return { rescan: { startedAt, previousAt: stored.listsCompletedAt ?? startedAt } };
  });
}

async function handleResumeBlock() {
  try {
    await setMeta(META_BLOCK, null);
    kick();
    block = null;
    if (mode === 'collecting') {
      startCollecting();
    }
    await refresh();
  } catch (error) {
    reportError(error);
  }
}

async function handleStartNew() {
  try {
    await stopCollecting();
    await wipeAll();
    kick();
    location.reload();
  } catch (error) {
    reportError(error);
  }
}

async function init() {
  const stored = await getMeta<AccountMeta>(META_ACCOUNT);
  const session = await readSession();
  const currentUserId = session?.userId ?? null;
  const status = checkAccount(stored, currentUserId);
  if (status === 'logged_out') {
    gate = { kind: 'logged_out' };
    return;
  }
  if (status === 'mismatch' && stored && currentUserId) {
    gate = { kind: 'mismatch', current: { userId: currentUserId, username: null }, stored };
    const username = await readUsername(currentUserId, { openTab: false });
    if (username !== null && gate.kind === 'mismatch') {
      gate = { ...gate, current: { ...gate.current, username } };
    }
    return;
  }
  if (stored && stored.username === null) {
    rememberUsername(stored).catch((error) => log.warn('could not read username', error));
  }
  await refresh();
  const progress = collectionProgress(collection, people);
  view = progress.phase === 'done' ? 'deck' : 'collection';
  gate = { kind: 'ok' };
  if (mode === 'collecting' && block === null) {
    startCollecting();
  }
}

// Accounts collected before usernames were stored get theirs from an already open instagram.com tab.
async function rememberUsername(stored: AccountMeta) {
  const username = await readUsername(stored.userId, { openTab: false });
  if (username !== null) {
    await setMeta<AccountMeta>(META_ACCOUNT, { ...stored, username });
  }
}

function onRejection(event: PromiseRejectionEvent) {
  reportError(event.reason);
}

function onWindowError(event: ErrorEvent) {
  if (event.message.startsWith('ResizeObserver loop')) {
    return;
  }
  reportError(event.error ?? event.message);
}

async function handleDecide(decision: Decision) {
  if (!current || busy || listsPending || !availableDecisions(current).includes(decision)) {
    return;
  }
  busy = true;
  undoNotes = [];
  errorMessage = '';
  try {
    // The exit plays while the decision is stored, so the next card is never held back by it.
    leaving = { pk: current.pk, decision };
    entrance = 'next';
    await Promise.all([decide(current.pk, decision), new Promise((resolve) => setTimeout(resolve, EXIT_MS))]);
    await refresh();
  } catch (error) {
    reportError(error);
  } finally {
    leaving = null;
    busy = false;
  }
}

async function handleUndo() {
  if (busy) {
    return;
  }
  busy = true;
  errorMessage = '';
  try {
    const { personPk, steps } = await undoLast();
    entrance = 'return';
    undoNotes = steps.flatMap((step) => {
      if (step.kind === 'refollow' && step.privateAccount) {
        return ['Follow request sent, not restored'];
      }
      if (step.kind === 'irreversible') {
        return ["Removal already sent, can't undo"];
      }
      return [];
    });
    clearTimeout(undoNoteTimerId);
    undoNoteTimerId = setTimeout(() => (undoNotes = []), UNDO_NOTE_MS);
    await refresh();
    // Undo can bring back someone from another deck: follow them there so the undo is visible.
    const restored = people.find((person) => person.pk === personPk);
    const restoredDeck = restored ? deckOf(restored) : null;
    if (restoredDeck !== null && restoredDeck !== selectedDeck) {
      selectedDeck = restoredDeck;
    }
  } catch (error) {
    reportError(error);
  } finally {
    busy = false;
  }
}

function selectDeck(next: DeckId) {
  selectedDeck = next;
  entrance = 'next';
  view = 'deck';
}

// Voice has no click behind it, so window.open would hit the popup blocker; the demo's fake chrome has no runtime.id.
function openProfile() {
  if (!current) {
    return;
  }
  const url = `${IG_ORIGIN}/${current.username}/`;
  if (globalThis.chrome?.runtime?.id) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
}

function onKeydown(event: KeyboardEvent) {
  if (view !== 'deck' || gate.kind !== 'ok' || event.repeat) {
    return;
  }
  if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  const command = keyToCommand(event.key);
  if (command === null) {
    return;
  }
  const onControl = event.target instanceof HTMLButtonElement || event.target instanceof HTMLAnchorElement;
  if (command === 'open' && onControl) {
    return;
  }
  event.preventDefault();
  runCommand(command);
}

// Keys and voice both land here.
function runCommand(command: DeckCommand) {
  if (view !== 'deck' || gate.kind !== 'ok') {
    return;
  }
  if (command === 'undo') {
    handleUndo();
  } else if (command === 'open') {
    openProfile();
  } else {
    handleDecide(command);
  }
}

onMount(() => {
  init().catch(reportError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('error', onWindowError);
  window.addEventListener('pagehide', stopCollectingInBackground);
  const intervalId = setInterval(() => {
    if (!busy && gate.kind === 'ok') {
      refresh().catch((error) => log.warn('refresh failed', error));
    }
  }, 5000);
  return () => {
    clearInterval(intervalId);
    clearTimeout(undoNoteTimerId);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('pagehide', stopCollectingInBackground);
    stopCollectingInBackground();
  };
});
</script>

<svelte:window onkeydown={onKeydown} />

{#snippet gateScreen(message: string)}
  <main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-text">
    {#if errorMessage}
      <div class="w-full max-w-md"><ErrorBanner message={errorMessage} onDismiss={() => (errorMessage = '')} /></div>
    {/if}
    <p class="text-base text-soft">{message}</p>
  </main>
{/snippet}

{#if gate.kind === 'loading'}
  {@render gateScreen('Loading')}
{:else if gate.kind === 'logged_out'}
  {@render gateScreen('Log in to instagram.com in this Chrome profile, then reload this tab')}
{:else if gate.kind === 'mismatch'}
  {#if errorMessage}
    <ErrorBanner message={errorMessage} onDismiss={() => (errorMessage = '')} />
  {/if}
  <AccountMismatch
    currentAccount={accountLabel(gate.current)}
    storedAccount={accountLabel(gate.stored)}
    onStartNew={handleStartNew}
  />
{:else}
  <div class="flex h-screen flex-col bg-bg text-text">
    <header class="flex items-center justify-between gap-6 px-6 py-4">
      <div class="flex items-center gap-6">
        <span class="text-sm font-bold tracking-tight">IG Cleanup</span>
        <nav class="flex gap-1" aria-label="Sections">
          {#each VIEWS as item (item.id)}
            <button
              type="button"
              class={clsx(
                'press rounded-full px-3.5 py-1.5 text-sm',
                item.id === view ? 'bg-surface-2 text-text' : 'text-muted hover:text-text',
              )}
              aria-current={item.id === view ? 'page' : undefined}
              onclick={() => (view = item.id)}
            >
              {item.label}
            </button>
          {/each}
        </nav>
      </div>
      <div class="flex items-center gap-4 text-xs text-muted">
        <VoiceToggle active={view === 'deck'} onCommand={runCommand} />
        {#if view === 'deck'}
          <span class="flex items-center gap-1.5"><span class="kbd">←</span><span class="kbd">→</span> decide</span>
          <span class="flex items-center gap-1.5"><span class="kbd">Z</span> undo</span>
          {#if current}
            <button type="button" class="press flex items-center gap-1.5 rounded-md hover:text-text" onclick={openProfile}>
              <span class="kbd">↵</span> open profile <Icon name="external" size={12} />
            </button>
          {/if}
        {/if}
      </div>
    </header>

    {#if errorMessage || block}
      <div class="mx-auto w-full max-w-3xl space-y-3 px-6">
        {#if errorMessage}
          <ErrorBanner message={errorMessage} onDismiss={() => (errorMessage = '')} />
        {/if}
        {#if block}
          <BlockBanner {block} onResume={handleResumeBlock} />
        {/if}
      </div>
    {/if}

    <main class="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-6">
      {#if view === 'deck'}
        <section class="flex flex-1 flex-col items-center justify-center gap-8">
          {#if listsPending}
            <div class="flex max-w-sm flex-col items-center gap-3 text-center">
              <p class="text-lg font-semibold">Decks open once both lists are read</p>
              <p class="text-sm text-muted">
                Until your following list is in, everyone who follows you looks like a fan. Check progress in Collection.
              </p>
              <button type="button" class="press btn btn-quiet" onclick={() => (view = 'collection')}>Go to Collection</button>
            </div>
          {:else if current}
            <div class="relative">
              {#if upNext}
                <div
                  class="absolute inset-0 translate-y-6 scale-[0.94] rounded-card border border-line bg-surface"
                  aria-hidden="true"
                ></div>
              {/if}
              {#key current.pk}
                <Card person={current} leaving={leaving?.pk === current.pk ? leaving.decision : null} {entrance} />
              {/key}
            </div>
            <DeckControls
              decisions={availableDecisions(current)}
              disabled={busy}
              onDecide={handleDecide}
              onUndo={handleUndo}
            />
          {:else}
            <div class="flex flex-col items-center gap-3 text-center">
              <span class="flex h-12 w-12 items-center justify-center rounded-full bg-keep-tint text-keep">
                <Icon name="check" size={22} />
              </span>
              <p class="text-lg font-semibold">This deck is done</p>
              <p class="max-w-xs text-sm text-muted">Pick another deck below, or press Z to bring back the last one.</p>
            </div>
          {/if}
          <div class="min-h-5" aria-live="polite">
            {#each undoNotes as note (note)}
              <p class="text-sm text-warn">{note}</p>
            {/each}
          </div>
        </section>
      {:else if view === 'activity'}
        <ActivityView {people} {refreshKey} onError={reportError} />
      {:else if view === 'collection'}
        <CollectionView
          {collection}
          {people}
          {mode}
          {scans}
          onScanAgain={handleScanAgain}
          onStart={handleStartCollecting}
          onPause={() => handleSendingMode('paused')}
        />
      {:else}
        <SettingsView
          {mode}
          onRefreshPictures={handleRefreshPictures}
          onStartNew={handleStartNew}
          onError={reportError}
          onImported={() => refresh().catch(reportError)}
        />
      {/if}
    </main>

    <StatusFooter
      {counts}
      selected={selectedDeck}
      deckActive={view === 'deck'}
      {mode}
      {refreshKey}
      onSelectDeck={selectDeck}
      onSending={handleSendingMode}
    />
  </div>
{/if}
