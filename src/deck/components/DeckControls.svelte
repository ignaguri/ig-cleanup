<script lang="ts">
import clsx from 'clsx';
import type { Decision } from '../../shared/types';
import Icon, { type IconName } from './Icon.svelte';

type Props = {
  decisions: Decision[];
  disabled: boolean;
  onDecide: (decision: Decision) => void;
  onUndo: () => void;
};
let { decisions, disabled, onDecide, onUndo }: Props = $props();

type Control = { decision: Decision; label: string; key: string; icon: IconName; tone: 'cut' | 'keep' };

const CUT_CONTROLS: Control[] = [
  { decision: 'unfollow', label: 'Unfollow', key: '←', icon: 'x', tone: 'cut' },
  { decision: 'remove', label: 'Remove follower', key: '↓', icon: 'userX', tone: 'cut' },
  { decision: 'both', label: 'Both', key: '↑', icon: 'ban', tone: 'cut' },
];
const KEEP_CONTROL: Control = { decision: 'keep', label: 'Keep', key: '→', icon: 'heart', tone: 'keep' };

const cutControls = $derived(CUT_CONTROLS.filter((control) => decisions.includes(control.decision)));
</script>

{#snippet decisionButton(control: Control)}
  <div class="flex flex-col items-center gap-2">
    <button
      type="button"
      class={clsx(
        'press flex h-16 w-16 items-center justify-center rounded-full border-2',
        control.tone === 'cut' && 'border-cut/70 bg-cut-tint text-cut',
        control.tone === 'keep' && 'border-keep/70 bg-keep-tint text-keep',
        control.tone === 'cut' && 'hover:border-cut hover:bg-cut hover:text-bg',
        control.tone === 'keep' && 'hover:border-keep hover:bg-keep hover:text-bg',
      )}
      {disabled}
      aria-label={`${control.label} (${control.key})`}
      onclick={() => onDecide(control.decision)}
    >
      <Icon name={control.icon} size={26} />
    </button>
    <span class="flex items-center gap-1.5 text-xs text-muted"><span class="kbd">{control.key}</span>{control.label}</span>
  </div>
{/snippet}

<div class="flex items-start justify-center gap-6">
  {#each cutControls as control (control.decision)}
    {@render decisionButton(control)}
  {/each}
  <div class="flex flex-col items-center gap-2">
    <span class="flex h-16 items-center">
    <button
      type="button"
      class="press flex h-12 w-12 items-center justify-center rounded-full border-2 border-line-strong text-soft hover:border-muted hover:text-text"
      {disabled}
      aria-label="Undo (Z)"
      onclick={onUndo}
    >
      <Icon name="undo" size={18} />
    </button>
    </span>
    <span class="flex items-center gap-1.5 text-xs text-muted"><span class="kbd">Z</span>Undo</span>
  </div>
  {@render decisionButton(KEEP_CONTROL)}
</div>
