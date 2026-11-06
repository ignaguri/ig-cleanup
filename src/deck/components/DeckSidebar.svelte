<script lang="ts">
import clsx from 'clsx';
import type { DeckId } from '../../shared/types';

type Props = {
  counts: Record<DeckId, { remaining: number; total: number }>;
  selected: DeckId;
  onSelect: (deck: DeckId) => void;
};
let { counts, selected, onSelect }: Props = $props();

const DECKS: { id: DeckId; label: string }[] = [
  { id: 'notFollowingBack', label: "Don't follow me back" },
  { id: 'fansNotFollowed', label: "I don't follow back" },
  { id: 'mutual', label: 'Mutuals' },
];
</script>

<nav class="space-y-2">
  {#each DECKS as deck (deck.id)}
    <button
      type="button"
      class={clsx(
        'flex w-full justify-between rounded-card px-3 py-2 text-left text-sm',
        deck.id === selected ? 'bg-surface text-text' : 'text-muted',
      )}
      onclick={() => onSelect(deck.id)}
    >
      <span>{deck.label}</span>
      <span>{counts[deck.id].remaining} / {counts[deck.id].total}</span>
    </button>
  {/each}
</nav>
