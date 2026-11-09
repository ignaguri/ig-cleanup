<script lang="ts">
import clsx from 'clsx';
import { collectionProgress } from '../../core/collection';
import { MUTUALS_DELAY_MS } from '../../shared/constants';
import type { CollectionState, Mode, Person } from '../../shared/types';
import { formatCount, formatWhen } from '../lib/format';
import Icon from './Icon.svelte';

type Props = {
  collection: CollectionState;
  people: Person[];
  mode: Mode | undefined;
  onStart: () => void;
  onPause: () => void;
};
let { collection, people, mode, onStart, onPause }: Props = $props();

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

const mutualsPercent = $derived(progress.mutualsTotal === 0 ? 0 : (progress.mutualsDone / progress.mutualsTotal) * 100);

const detail = $derived.by(() => {
  if (progress.phase === 'lists') {
    return { headline: `${formatCount(progress.listsSeen)} accounts seen`, sub: 'Reading both lists page by page' };
  }
  if (progress.phase === 'mutuals') {
    const left = progress.mutualsTotal - progress.mutualsDone;
    return {
      headline: `${formatCount(progress.mutualsDone)} of ${formatCount(progress.mutualsTotal)} checked`,
      sub: `About ${formatDuration(left * averageMutualsDelayMs)} left at the current pace`,
    };
  }
  const finishedAt = collection.mutualsCompletedAt;
  return {
    headline: `${formatCount(people.length)} accounts collected`,
    sub: finishedAt !== null ? `Finished ${formatWhen(finishedAt, Date.now())}` : 'Collection complete',
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
    {#if progress.phase === 'mutuals'}
      <div class="h-1.5 overflow-hidden rounded-full bg-line">
        <div class="h-full rounded-full bg-text transition-[width] duration-500" style={`width: ${mutualsPercent}%`}></div>
      </div>
      <p class="text-xs text-muted">Only for the two decks you'd cut from, and slowly, to stay under Instagram's limits.</p>
    {/if}
    {#if collection.refreshingPictures}
      <p class="flex items-center gap-2 text-sm text-soft"><Icon name="refresh" size={14} /> Refreshing pictures</p>
    {/if}
  </div>

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
          {progress.phase === 'lists' && progress.listsSeen === 0 ? 'Start collection' : 'Resume collection'}
        </button>
      {/if}
    </div>
  {/if}
</section>
