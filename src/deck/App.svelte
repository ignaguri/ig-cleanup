<script lang="ts">
import { onMount } from 'svelte';
import { buildDeck, deckCounts } from '../core/people';
import { allPeople } from '../db/db';
import type { Decision, DeckId, Person } from '../shared/types';
import Card from './components/Card.svelte';
import DeckSidebar from './components/DeckSidebar.svelte';
import QueueStatus from './components/QueueStatus.svelte';
import { decide, undoLast } from './lib/decide';
import { keyToCommand } from './lib/keyboard';

const SLIDE_OUT_MS = 150;

let people = $state<Person[]>([]);
let selectedDeck = $state<DeckId>('notFollowingBack');
let leaving = $state(false);
let busy = false;
let refreshKey = $state(0);
let undoNotes = $state<string[]>([]);

const counts = $derived(deckCounts(people));
const current = $derived(buildDeck(people, selectedDeck)[0] ?? null);

async function refresh() {
  people = await allPeople();
  refreshKey += 1;
}

async function handleDecide(decision: Decision) {
  if (!current || busy) {
    return;
  }
  busy = true;
  undoNotes = [];
  try {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) {
      leaving = true;
      await new Promise((resolve) => setTimeout(resolve, SLIDE_OUT_MS));
    }
    await decide(current.pk, decision);
    await refresh();
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
  if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  const command = keyToCommand(event.key);
  if (command === null) {
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
  refresh();
  const intervalId = setInterval(refresh, 5000);
  return () => clearInterval(intervalId);
});
</script>

<svelte:window onkeydown={onKeydown} />

<main class="flex min-h-screen gap-6 bg-bg p-6 text-text">
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
</main>
