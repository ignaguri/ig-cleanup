<script lang="ts">
import clsx from 'clsx';
import { collectionProgress } from '../../core/collection';
import { LIST_DELAY_MS, LIST_PAGE_SIZE, MUTUALS_DELAY_MS } from '../../shared/constants';
import type { CollectionState, Mode, Person, ScanSummary } from '../../shared/types';
import { formatCount, formatWhen } from '../lib/format';
import FollowerChanges from './FollowerChanges.svelte';
import Icon from './Icon.svelte';

type Props = {
  collection: CollectionState;
  people: Person[];
  mode: Mode | undefined;
  scans: ScanSummary[];
  onScanAgain: () => void;
  onStart: () => void;
  onPause: () => void;
};
let { collection, people, mode, scans, onScanAgain, onStart, onPause }: Props = $props();

const lastScan = $derived(scans.at(-1) ?? null);

// Both lists page by page at the list pace, plus roughly a second per request.
const perPageMs = (LIST_DELAY_MS[0] + LIST_DELAY_MS[1]) / 2 + 1000;

const scanEstimateMs = $derived.by(() => {
  const pages = (count: number) => Math.ceil(count / LIST_PAGE_SIZE);
  const followers = people.filter((person) => person.followsMe).length;
  const following = people.filter((person) => person.iFollow).length;
  return (pages(followers) + pages(following)) * perPageMs;
});

const progress = $derived(collectionProgress(collection, people));
const collecting = $derived(mode === 'collecting');

const averageMutualsDelayMs = (MUTUALS_DELAY_MS[0] + MUTUALS_DELAY_MS[1]) / 2;

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

const STEPS: { id: 'lists' | 'mutuals' | 'done'; label: string }[] = [
  { id: 'lists', label: 'Followers and following' },
  { id: 'mutuals', label: 'People in common' },
  { id: 'done', label: 'Ready' },
];

const stepIndex = $derived(STEPS.findIndex((step) => step.id === progress.phase));

function percentOf(done: number, total: number): number {
  return total === 0 ? 0 : (done / total) * 100;
}

const detail = $derived.by(() => {
  const { lists, followChecks } = progress;
  if (progress.followChecksLeft > 0) {
    return {
      headline: `${formatCount(followChecks.done)} of ${formatCount(followChecks.total)} confirmed`,
      sub: "Instagram's following list skips people, so checking who you really don't follow",
      percent: percentOf(followChecks.done, followChecks.total),
    };
  }
  if (progress.phase === 'lists' && lists !== null) {
    const pagesLeft = Math.ceil((lists.total - lists.done) / LIST_PAGE_SIZE);
    return {
      headline: `${formatCount(lists.done)} of ${formatCount(lists.total)} accounts read`,
      sub: `About ${formatDuration(pagesLeft * perPageMs)} left, reading both lists page by page`,
      percent: percentOf(lists.done, lists.total),
    };
  }
  if (progress.phase === 'lists') {
    return {
      headline: `${formatCount(progress.listsSeen)} accounts seen`,
      sub: 'Reading both lists page by page',
      percent: null,
    };
  }
  if (progress.phase === 'mutuals') {
    const left = progress.mutualsTotal - progress.mutualsDone;
    return {
      headline: `${formatCount(progress.mutualsDone)} of ${formatCount(progress.mutualsTotal)} checked`,
      sub: `About ${formatDuration(left * averageMutualsDelayMs)} left at the current pace`,
      percent: percentOf(progress.mutualsDone, progress.mutualsTotal),
    };
  }
  const finishedAt = collection.mutualsCompletedAt;
  return {
    headline: `${formatCount(people.length)} accounts collected`,
    sub: finishedAt !== null ? `Finished ${formatWhen(finishedAt, Date.now())}` : 'Collection complete',
    percent: null,
  };
});
</script>

<section class="mx-auto flex w-full max-w-xl flex-col gap-5">
  <ol class="flex items-center gap-3 text-sm">
    {#each STEPS as step, index (step.id)}
      {@const complete = index < stepIndex || progress.phase === 'done'}
      <li class="flex items-center gap-3">
        <span
          class={clsx(
            'flex h-6 w-6 items-center justify-center rounded-full border text-xs tabular-nums',
            complete && 'border-keep bg-keep-tint text-keep',
            !complete && index === stepIndex && 'border-text text-text',
            !complete && index > stepIndex && 'border-line text-muted',
          )}
        >
          {#if complete}
            <Icon name="check" size={12} />
          {:else}
            {index + 1}
          {/if}
        </span>
        <span class={clsx(index === stepIndex ? 'text-text' : 'text-muted')}>{step.label}</span>
        {#if index < STEPS.length - 1}
          <span class="h-px w-8 bg-line"></span>
        {/if}
      </li>
    {/each}
  </ol>

  <div class="panel space-y-4 p-6">
    <div>
      <p class="text-xl font-semibold tracking-tight tabular-nums">{detail.headline}</p>
      <p class="mt-1 text-sm text-muted">{detail.sub}</p>
    </div>
    {#if detail.percent !== null}
      <div class="h-1.5 overflow-hidden rounded-full bg-line">
        <div class="h-full rounded-full bg-text transition-[width] duration-500" style={`width: ${detail.percent}%`}></div>
      </div>
    {/if}
    {#if progress.phase === 'mutuals'}
      <p class="text-xs text-muted">Only for the two decks you'd cut from, and slowly, to stay under Instagram's limits.</p>
    {/if}
    {#if collection.refreshingPictures}
      <p class="flex items-center gap-2 text-sm text-soft"><Icon name="refresh" size={14} /> Refreshing pictures</p>
    {/if}
    {#if collection.rescan}
      <p class="flex items-center gap-2 text-sm text-soft">
        <Icon name="refresh" size={14} /> Scanning again, comparing with {formatWhen(collection.rescan.previousAt, Date.now())}.
        Decks stay open meanwhile.
      </p>
    {/if}
  </div>

  {#if progress.phase === 'done' && !collection.refreshingPictures}
    <div class="flex flex-wrap items-center gap-3">
      <button type="button" class="press btn btn-quiet" onclick={onScanAgain}>
        <Icon name="refresh" size={14} /> Scan again
      </button>
      <span class="text-sm text-muted">
        Re-reads both lists (about {formatDuration(scanEstimateMs)}) to see who stopped following you. Sending stays off
        until you turn it back on.
      </span>
    </div>
  {/if}

  {#if lastScan}
    <FollowerChanges {people} {lastScan} />
  {/if}

  {#if progress.phase !== 'done' || collection.refreshingPictures}
    <div class="flex items-center gap-3">
      {#if collecting}
        <button type="button" class="press btn btn-quiet" onclick={onPause}>
          <Icon name="pause" size={14} /> Pause collection
        </button>
        <span class="flex items-center gap-2 text-sm text-warn">
          <Icon name="alert" size={14} /> Keep this tab open while collecting
        </span>
      {:else}
        <button type="button" class="press btn btn-primary" onclick={onStart}>
          <Icon name="play" size={14} />
          {#if collection.rescan}
            Resume scan
          {:else}
            {progress.phase === 'lists' && progress.listsSeen === 0 ? 'Start collection' : 'Resume collection'}
          {/if}
        </button>
      {/if}
    </div>
  {/if}
</section>
