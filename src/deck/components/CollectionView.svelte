<script lang="ts">
import { collectionProgress } from '../../core/collection';
import { MUTUALS_DELAY_MS } from '../../shared/constants';
import type { CollectionState, Mode, Person } from '../../shared/types';

type Props = {
  collection: CollectionState;
  people: Person[];
  mode: Mode | undefined;
  onStart: () => void;
  onPauseAndSend: () => void;
};
let { collection, people, mode, onStart, onPauseAndSend }: Props = $props();

const progress = $derived(collectionProgress(collection, people));
const collecting = $derived(mode === 'collecting');

const averageMutualsDelayMs = (MUTUALS_DELAY_MS[0] + MUTUALS_DELAY_MS[1]) / 2;

function formatDuration(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

const timeLeft = $derived.by(() => {
  if (progress.phase === 'lists') {
    return `${progress.listsSeen} accounts seen`;
  }
  if (progress.phase === 'mutuals') {
    return formatDuration((progress.mutualsTotal - progress.mutualsDone) * averageMutualsDelayMs);
  }
  return 'Collection complete';
});
</script>

<section class="mx-auto w-full max-w-xl space-y-4">
  {#if collecting}
    <p class="rounded-card bg-surface px-4 py-3 text-sm text-warn">Keep this tab open while collecting</p>
  {/if}
  <div class="space-y-1 rounded-card bg-surface p-4 text-sm">
    <p class="text-lg">Phase: {progress.phase}</p>
    {#if progress.phase === 'mutuals'}
      <p>Mutuals fetched: {progress.mutualsDone} / {progress.mutualsTotal}</p>
    {/if}
    {#if progress.phase === 'done'}
      <p class="text-muted">{timeLeft}</p>
    {:else}
      <p class="text-muted">{progress.phase === 'lists' ? 'Progress' : 'Time left'}: {timeLeft}</p>
    {/if}
    {#if collection.refreshingPictures}
      <p class="text-muted">Refreshing pictures</p>
    {/if}
  </div>
  <div class="flex gap-3 text-sm">
    {#if !collecting}
      <button type="button" class="rounded-card bg-keep px-4 py-2 text-bg" onclick={onStart}>
        Start/Resume collection
      </button>
    {/if}
    <button type="button" class="rounded-card bg-surface px-4 py-2" onclick={onPauseAndSend}>
      Pause collection, start sending
    </button>
  </div>
</section>
