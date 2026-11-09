<script lang="ts">
import { Tooltip } from 'bits-ui';
import clsx from 'clsx';
import { sentInLast24h } from '../../core/pacing';
import { actionsByStatus, getMeta } from '../../db/db';
import { DEFAULT_SETTINGS, META_SETTINGS, SEND_ALARM } from '../../shared/constants';
import { log } from '../../shared/log';
import type { DeckId, Mode, Settings } from '../../shared/types';
import { DECKS } from '../lib/decks';
import { formatCount, formatRelative } from '../lib/format';
import Icon from './Icon.svelte';

type Props = {
  counts: Record<DeckId, { remaining: number; total: number }>;
  selected: DeckId;
  deckActive: boolean;
  mode: Mode | undefined;
  refreshKey: number;
  onSelectDeck: (deck: DeckId) => void;
  onSending: (next: 'sending' | 'paused') => void;
};
let { counts, selected, deckActive, mode, refreshKey, onSelectDeck, onSending }: Props = $props();

let queued = $state(0);
let sentToday = $state(0);
let pace = $state<Settings>(DEFAULT_SETTINGS);
const dailyCap = $derived(pace.dailyCap);
const delayRange = $derived(`${pace.minDelayMs / 1000}-${pace.maxDelayMs / 1000} s`);
let nextSendAt = $state<number | null>(null);
let now = $state(Date.now());

const effectiveMode = $derived(mode ?? 'paused');

const MODE_PILLS: Record<Mode, { label: string; tone: string }> = {
  sending: { label: 'Sending', tone: 'bg-keep-tint text-keep' },
  collecting: { label: 'Collecting', tone: 'bg-warn-tint text-warn' },
  paused: { label: 'Paused', tone: 'bg-surface-2 text-muted' },
};

const explanation = $derived.by(() => {
  if (effectiveMode === 'sending') {
    return {
      title: 'Sending is on',
      body: `Your queued unfollows and removals go to Instagram one at a time, ${delayRange} apart, at most ${dailyCap} in 24 hours. Pausing stops after the one in flight, and nothing in the queue is lost.`,
    };
  }
  if (effectiveMode === 'collecting') {
    return {
      title: 'Collecting',
      body: 'Reading your followers, following and people in common from Instagram. Nothing is sent while this runs. Starting sending stops collecting first.',
    };
  }
  return {
    title: 'Sending is paused',
    body: 'Your decisions keep queuing up here, but nothing goes to Instagram until you start sending.',
  };
});

const nextLine = $derived.by(() => {
  if (effectiveMode !== 'sending') {
    return null;
  }
  if (queued === 0) {
    return 'Queue empty';
  }
  if (nextSendAt === null) {
    return null;
  }
  const when = formatRelative(nextSendAt, now);
  return sentToday >= dailyCap ? `Cap reached, next ${when}` : `Next ${when}`;
});

async function refresh() {
  try {
    const [queuedActions, sentActions, settings, alarm] = await Promise.all([
      actionsByStatus('queued'),
      actionsByStatus('sent'),
      getMeta<Settings>(META_SETTINGS),
      chrome.alarms.get(SEND_ALARM),
    ]);
    now = Date.now();
    queued = queuedActions.length;
    sentToday = sentInLast24h(sentActions, now);
    pace = settings ?? DEFAULT_SETTINGS;
    nextSendAt = alarm?.scheduledTime ?? null;
  } catch (error) {
    log.warn('footer status refresh failed', error);
  }
}

$effect(() => {
  refreshKey;
  refresh();
});

function percentDone(deck: DeckId): number {
  const { remaining, total } = counts[deck];
  return total === 0 ? 0 : ((total - remaining) / total) * 100;
}
</script>

<footer class="flex items-stretch border-t border-line bg-raised">
  <nav class="flex" aria-label="Decks">
    {#each DECKS as deck (deck.id)}
      {@const active = deckActive && deck.id === selected}
      <button
        type="button"
        class={clsx(
          'press relative w-52 border-r border-line px-5 py-3 text-left hover:bg-surface',
          active && 'bg-surface',
        )}
        aria-current={active ? 'page' : undefined}
        onclick={() => onSelectDeck(deck.id)}
      >
        {#if active}
          <span class="absolute inset-x-0 top-0 h-0.5 bg-text"></span>
        {/if}
        <span class={clsx('block text-sm', active ? 'text-text' : 'text-soft')}>{deck.label}</span>
        <span class="mt-2 block h-[3px] overflow-hidden rounded-full bg-line">
          <span
            class={clsx('block h-full rounded-full', active ? 'bg-text' : 'bg-muted')}
            style={`width: ${percentDone(deck.id)}%`}
          ></span>
        </span>
        <span class="mt-1.5 block text-xs text-muted tabular-nums">
          {formatCount(counts[deck.id].remaining)} left of {formatCount(counts[deck.id].total)}
        </span>
      </button>
    {/each}
  </nav>

  <div class="ml-auto flex items-center gap-4 px-5 text-sm">
    <Tooltip.Provider delayDuration={150}>
      <Tooltip.Root>
        <Tooltip.Trigger
          class={clsx(
            'press inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium',
            MODE_PILLS[effectiveMode].tone,
          )}
          aria-label={`${explanation.title}. ${explanation.body}`}
        >
          <span
            class={clsx(
              'h-1.5 w-1.5 rounded-full bg-current',
              effectiveMode === 'sending' && 'shadow-[0_0_0_3px_rgb(74_222_128_/_0.2)]',
            )}
          ></span>
          {MODE_PILLS[effectiveMode].label}
          <Icon name="info" size={12} class="opacity-70" />
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={10}
            class="z-50 w-80 origin-(--bits-tooltip-content-transform-origin) rounded-xl border border-line bg-surface-2 p-4 text-sm shadow-[0_16px_40px_-8px_rgb(0_0_0_/_0.7)] data-[state=delayed-open]:animate-[tooltip-in_160ms_var(--ease-out)]"
          >
            <p class="font-medium text-text">{explanation.title}</p>
            <p class="mt-1 text-soft">{explanation.body}</p>
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
    <span class="text-muted tabular-nums">{formatCount(queued)} queued</span>
    <span class="text-muted tabular-nums">{sentToday} / {dailyCap} today</span>
    {#if nextLine}
      <span class="text-soft tabular-nums">{nextLine}</span>
    {/if}
    {#if effectiveMode === 'sending'}
      <button type="button" class="press btn btn-quiet" onclick={() => onSending('paused')}>
        <Icon name="pause" size={14} /> Pause sending
      </button>
    {:else}
      <button
        type="button"
        class="press btn btn-quiet"
        title={effectiveMode === 'collecting' ? 'Stops collecting, then starts sending the queue' : undefined}
        onclick={() => onSending('sending')}
      >
        <Icon name="play" size={14} /> Start sending
      </button>
    {/if}
  </div>
</footer>
