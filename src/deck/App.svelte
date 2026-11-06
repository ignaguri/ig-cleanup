<script lang="ts">
import clsx from 'clsx';
import { onMount } from 'svelte';
import { startCollector } from '../collector/collector';
import { checkAccount } from '../core/account-guard';
import { collectionProgress, INITIAL_COLLECTION } from '../core/collection';
import { availableDecisions } from '../core/decisions';
import { buildDeck, deckCounts } from '../core/people';
import { allPeople, getMeta, setMeta, wipeAll } from '../db/db';
import { readSession } from '../instagram/transport';
import { META_ACCOUNT, META_BLOCK, META_COLLECTION, META_MODE } from '../shared/constants';
import { log } from '../shared/log';
import type { AccountMeta, BlockInfo, CollectionState, Decision, DeckId, Mode, Person } from '../shared/types';
import AccountMismatch from './components/AccountMismatch.svelte';
import BlockBanner from './components/BlockBanner.svelte';
import Card from './components/Card.svelte';
import CollectionView from './components/CollectionView.svelte';
import DeckSidebar from './components/DeckSidebar.svelte';
import ErrorBanner from './components/ErrorBanner.svelte';
import QueueStatus from './components/QueueStatus.svelte';
import SettingsView from './components/SettingsView.svelte';
import { decide, kick, undoLast } from './lib/decide';
import { keyToCommand } from './lib/keyboard';

const SLIDE_OUT_MS = 150;

let people = $state<Person[]>([]);
let selectedDeck = $state<DeckId>('notFollowingBack');
let leaving = $state(false);
let busy = false;
let refreshSequence = 0;
let errorMessage = $state('');
let refreshKey = $state(0);
let undoNotes = $state<string[]>([]);

type View = 'deck' | 'collection' | 'settings';
type Gate =
  | { kind: 'loading' }
  | { kind: 'logged_out' }
  | { kind: 'mismatch'; currentUserId: string; storedUserId: string }
  | { kind: 'ok' };

const VIEWS: { id: View; label: string }[] = [
  { id: 'deck', label: 'Deck' },
  { id: 'collection', label: 'Collection' },
  { id: 'settings', label: 'Settings' },
];

let gate = $state<Gate>({ kind: 'loading' });
let view = $state<View>('deck');
let collection = $state<CollectionState>(INITIAL_COLLECTION);
let mode = $state<Mode | undefined>(undefined);
let block = $state<BlockInfo | null>(null);
let collector: { stop(): void } | null = null;

const counts = $derived(deckCounts(people));
const current = $derived(buildDeck(people, selectedDeck)[0] ?? null);

async function refresh() {
  refreshSequence += 1;
  const sequence = refreshSequence;
  const [loaded, storedCollection, storedMode, storedBlock] = await Promise.all([
    allPeople(),
    getMeta<CollectionState>(META_COLLECTION),
    getMeta<Mode>(META_MODE),
    getMeta<BlockInfo | null>(META_BLOCK),
  ]);
  if (sequence !== refreshSequence) {
    return;
  }
  people = loaded;
  collection = storedCollection ?? INITIAL_COLLECTION;
  mode = storedMode;
  block = storedBlock ?? null;
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

function stopCollecting() {
  collector?.stop();
  collector = null;
}

async function handleStartCollecting() {
  try {
    await setMode('collecting');
    startCollecting();
  } catch (error) {
    reportError(error);
  }
}

async function handlePauseAndSend() {
  try {
    stopCollecting();
    await setMode('sending');
  } catch (error) {
    reportError(error);
  }
}

async function handleSendingMode(next: 'sending' | 'paused') {
  try {
    stopCollecting();
    await setMode(next);
  } catch (error) {
    reportError(error);
  }
}

async function handleRefreshPictures() {
  try {
    // Stop first: the collector overwrites META_COLLECTION from memory.
    stopCollecting();
    const storedCollection = (await getMeta<CollectionState>(META_COLLECTION)) ?? INITIAL_COLLECTION;
    if (storedCollection.refreshingPictures) {
      startCollecting();
      return;
    }
    const currentMode = (await getMeta<Mode>(META_MODE)) ?? 'paused';
    await setMeta<CollectionState>(META_COLLECTION, {
      ...storedCollection,
      followers: INITIAL_COLLECTION.followers,
      following: INITIAL_COLLECTION.following,
      refreshingPictures: true,
      modeBeforeRefresh: currentMode,
    });
    await setMode('collecting');
    startCollecting();
    await refresh();
    view = 'collection';
  } catch (error) {
    reportError(error);
  }
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
    stopCollecting();
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
    gate = { kind: 'mismatch', currentUserId, storedUserId: stored.userId };
    return;
  }
  await refresh();
  const progress = collectionProgress(collection, people);
  view = progress.phase === 'done' ? 'deck' : 'collection';
  gate = { kind: 'ok' };
  if (mode === 'collecting' && block === null) {
    startCollecting();
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
  if (!current || busy || !availableDecisions(current).includes(decision)) {
    return;
  }
  busy = true;
  undoNotes = [];
  errorMessage = '';
  try {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) {
      leaving = true;
      await new Promise((resolve) => setTimeout(resolve, SLIDE_OUT_MS));
    }
    await decide(current.pk, decision);
    await refresh();
  } catch (error) {
    reportError(error);
  } finally {
    leaving = false;
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
    const steps = await undoLast();
    undoNotes = steps.flatMap((step) => {
      if (step.kind === 'refollow' && step.privateAccount) {
        return ['Follow request sent, not restored'];
      }
      if (step.kind === 'irreversible') {
        return ["Removal already sent, can't undo"];
      }
      return [];
    });
    await refresh();
  } catch (error) {
    reportError(error);
  } finally {
    busy = false;
  }
}

function openProfile() {
  if (current) {
    window.open(`https://www.instagram.com/${current.username}/`, '_blank', 'noopener');
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
  window.addEventListener('pagehide', stopCollecting);
  const intervalId = setInterval(() => {
    if (!busy && gate.kind === 'ok') {
      refresh().catch((error) => log.warn('refresh failed', error));
    }
  }, 5000);
  return () => {
    clearInterval(intervalId);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('pagehide', stopCollecting);
    stopCollecting();
  };
});
</script>

<svelte:window onkeydown={onKeydown} />

{#if gate.kind === 'loading'}
  <main class="flex min-h-screen items-center justify-center bg-bg text-muted">
    <p>Loading</p>
    {#if errorMessage}
      <ErrorBanner message={errorMessage} onDismiss={() => (errorMessage = '')} />
    {/if}
  </main>
{:else if gate.kind === 'logged_out'}
  {#if errorMessage}
    <ErrorBanner message={errorMessage} onDismiss={() => (errorMessage = '')} />
  {/if}
  <main class="flex min-h-screen items-center justify-center bg-bg p-6 text-text">
    <p class="text-lg">Log in to instagram.com in this Chrome profile, then reload</p>
  </main>
{:else if gate.kind === 'mismatch'}
  {#if errorMessage}
    <ErrorBanner message={errorMessage} onDismiss={() => (errorMessage = '')} />
  {/if}
  <AccountMismatch currentUserId={gate.currentUserId} storedUserId={gate.storedUserId} onStartNew={handleStartNew} />
{:else}
  <main class="flex min-h-screen flex-col gap-4 bg-bg p-6 text-text">
    <nav class="flex gap-2 text-sm">
      {#each VIEWS as item (item.id)}
        <button
          type="button"
          class={clsx('rounded-card px-3 py-2', item.id === view ? 'bg-surface text-text' : 'text-muted')}
          onclick={() => (view = item.id)}
        >
          {item.label}
        </button>
      {/each}
    </nav>
    {#if errorMessage}
      <ErrorBanner message={errorMessage} onDismiss={() => (errorMessage = '')} />
    {/if}
    {#if block}
      <BlockBanner {block} onResume={handleResumeBlock} />
    {/if}
    {#if view === 'deck'}
      <div class="flex flex-1 gap-6">
        <section class="flex flex-1 flex-col items-center justify-center gap-4">
          {#if current}
            <Card person={current} {leaving} onDecide={handleDecide} />
          {:else}
            <p class="text-muted">Nothing left in this deck</p>
          {/if}
          {#each undoNotes as note (note)}
            <p class="text-sm text-warn">{note}</p>
          {/each}
          <p class="text-sm text-muted">Undo: Z or Backspace</p>
        </section>
        <aside class="w-64 space-y-4">
          <DeckSidebar {counts} selected={selectedDeck} onSelect={(deck) => (selectedDeck = deck)} />
          <QueueStatus {refreshKey} />
        </aside>
      </div>
    {:else if view === 'collection'}
      <CollectionView
        {collection}
        {people}
        {mode}
        onStart={handleStartCollecting}
        onPauseAndSend={handlePauseAndSend}
      />
    {:else}
      <SettingsView
        {mode}
        {refreshKey}
        onPauseSending={() => handleSendingMode('paused')}
        onResumeSending={() => handleSendingMode('sending')}
        onRefreshPictures={handleRefreshPictures}
        onStartNew={handleStartNew}
        onError={reportError}
        onImported={() => refresh().catch(reportError)}
      />
    {/if}
  </main>
{/if}
