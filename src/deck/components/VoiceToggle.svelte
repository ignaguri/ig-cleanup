<script lang="ts">
import clsx from 'clsx';
import type { DeckCommand } from '../lib/keyboard';
import { prepareOnDevice, startListening, type VoiceActivity, voiceSupported } from '../lib/voice';
import Icon from './Icon.svelte';

// Inactive (another view) pauses the microphone but remembers that voice is on.
type Props = { active: boolean; onCommand: (command: DeckCommand) => void };
let { active, onCommand }: Props = $props();

// Speech ended this long ago and no text came back: say so instead of looking stuck.
const NO_TEXT_MS = 4000;

let wanted = $state(false);
let preparing = $state(false);
let onDevice = $state(false);
let errorText = $state('');
let activity = $state<VoiceActivity>('waiting');
let interim = $state('');
let heard = $state<{ text: string; matched: boolean } | null>(null);
let noText = $state(false);
let noTextTimerId: ReturnType<typeof setTimeout> | undefined;

const ACTIVITY_DOT: Record<VoiceActivity, string> = {
  waiting: 'bg-muted',
  hearing: 'bg-keep motion-safe:animate-pulse',
  processing: 'bg-warn motion-safe:animate-pulse',
};
const ACTIVITY_LABEL: Record<VoiceActivity, string> = {
  waiting: 'Listening',
  hearing: 'Hearing you',
  processing: 'Working it out',
};

async function toggle() {
  if (wanted) {
    wanted = false;
    return;
  }
  errorText = '';
  preparing = true;
  try {
    onDevice = await prepareOnDevice();
  } catch {
    onDevice = false;
  } finally {
    preparing = false;
  }
  wanted = true;
}

function setActivity(next: VoiceActivity) {
  activity = next;
  clearTimeout(noTextTimerId);
  noText = false;
  if (next === 'processing') {
    noTextTimerId = setTimeout(() => (noText = true), NO_TEXT_MS);
  }
}

$effect(() => {
  if (!wanted || !active) {
    return;
  }
  const stop = startListening(onDevice, {
    onHeard: (text, command) => {
      heard = { text, matched: command !== null };
      if (command !== null) {
        onCommand(command);
      }
    },
    onInterim: (text) => {
      interim = text;
    },
    onActivity: setActivity,
    onError: (message) => {
      errorText = message;
      wanted = false;
    },
  });
  return () => {
    stop();
    clearTimeout(noTextTimerId);
    activity = 'waiting';
    interim = '';
    heard = null;
    noText = false;
  };
});
</script>

{#if active && voiceSupported()}
  <div class="relative">
    <button
      type="button"
      class={clsx('press flex items-center gap-1.5 rounded-md', wanted ? 'text-text' : 'hover:text-text')}
      aria-pressed={wanted}
      disabled={preparing}
      title="Say keep, unfollow, remove, both, undo or open"
      onclick={toggle}
    >
      {#if wanted}
        <span class={clsx('h-2 w-2 rounded-full', ACTIVITY_DOT[activity])} aria-hidden="true"></span>
        {ACTIVITY_LABEL[activity]} · {onDevice ? 'on this device' : "via Google's servers"}
      {:else}
        <Icon name="mic" size={13} />
        {preparing ? 'Getting voice ready' : 'Voice'}
      {/if}
    </button>
    {#if errorText || wanted}
      <div class="absolute top-full right-0 mt-2 w-72 space-y-1 rounded-md border border-line bg-raised p-2.5" aria-live="polite">
        {#if errorText}
          <p class="text-warn">{errorText}</p>
        {:else}
          <p class={clsx('truncate', heard?.matched ? 'text-text' : 'text-soft')}>
            {#if interim}
              <span class="text-muted italic">{interim}…</span>
            {:else if heard}
              Heard "{heard.text}"{heard.matched ? '' : ', not a command'}
            {:else}
              Nothing heard yet
            {/if}
          </p>
          {#if noText}
            <p class="text-warn">Speech ended but no text came back</p>
          {/if}
        {/if}
      </div>
    {/if}
  </div>
{/if}
