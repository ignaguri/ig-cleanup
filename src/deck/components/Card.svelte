<script lang="ts">
import clsx from 'clsx';
import { availableDecisions } from '../../core/decisions';
import type { Decision, Person } from '../../shared/types';

type Props = { person: Person; leaving: boolean; onDecide: (decision: Decision) => void };
let { person, leaving, onDecide }: Props = $props();

const monthFormat = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' });

const KEY_HINTS: Record<string, string> = { keep: '→', unfollow: '←', remove: '↓', both: '↑' };
const LABELS: Record<string, string> = { keep: 'Keep', unfollow: 'Unfollow', remove: 'Remove', both: 'Both' };

let imageFailed = $state(false);
let pictureSrc = $state<string | null>(null);
// The CDN refuses cross-origin <img> loads, so fetch the bytes (host permission) and show a blob URL.
$effect(() => {
  const url = person.picUrl;
  imageFailed = false;
  pictureSrc = null;
  if (!url) {
    return;
  }
  let objectUrl: string | null = null;
  let cancelled = false;
  fetch(url, { credentials: 'omit' })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`picture ${response.status}`);
      }
      return response.blob();
    })
    .then((blob) => {
      if (cancelled) {
        return;
      }
      objectUrl = URL.createObjectURL(blob);
      pictureSrc = objectUrl;
    })
    .catch(() => {
      if (!cancelled) {
        imageFailed = true;
      }
    });
  return () => {
    cancelled = true;
    if (objectUrl !== null) {
      URL.revokeObjectURL(objectUrl);
    }
  };
});

const initials = $derived((person.fullName || person.username).trim().slice(0, 2).toUpperCase());

const relationship = $derived(
  person.iFollow && person.followsMe
    ? 'You follow each other'
    : person.iFollow
      ? "You follow them · they don't follow you"
      : "They follow you · you don't follow them",
);

const mutualsLine = $derived.by(() => {
  const mutuals = person.mutuals;
  if (mutuals === null) {
    if (person.mutualsFetchedAt !== null) {
      return 'People in common: unavailable';
    }
    if (person.iFollow && person.followsMe) {
      return 'People in common: not fetched for mutuals';
    }
    return 'People in common: loading later';
  }
  if (mutuals.usernames.length === 0) {
    return 'No people in common';
  }
  const names = mutuals.usernames;
  if (mutuals.hasMore) {
    return `Followed by ${names.join(', ')} +`;
  }
  if (names.length === 1) {
    return `Followed by ${names[0]}`;
  }
  return `Followed by ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
});

function hintFor(decision: Decision): string {
  if (decision === 'remove') {
    return "can't be undone once sent";
  }
  if (decision === 'unfollow' && person.isPrivate) {
    return 'private: undo only sends a request';
  }
  return '';
}
</script>

<article
  class={clsx(
    'w-96 rounded-card bg-surface p-6 text-text',
    'transition-[transform,opacity] duration-150 ease-in motion-reduce:transition-none',
    leaving && 'translate-x-16 opacity-0',
  )}
>
  <div class="flex items-center gap-4">
    {#if imageFailed || !person.picUrl || pictureSrc === null}
      <div class="flex h-20 w-20 items-center justify-center rounded-full bg-bg text-lg text-muted">{initials}</div>
    {:else}
      <img
        class="h-20 w-20 rounded-full object-cover"
        src={pictureSrc}
        alt={person.username}
        onerror={() => (imageFailed = true)}
      />
    {/if}
    <div class="min-w-0">
      <p class="truncate text-lg">{person.fullName || person.username}</p>
      <p class="truncate text-sm text-muted">@{person.username}{person.isVerified ? ' ✓' : ''}{person.isPrivate ? ' · private' : ''}</p>
    </div>
  </div>

  <div class="mt-4 space-y-1 text-sm">
    <p>{relationship}</p>
    {#if person.iFollowedAt !== null}
      <p class="text-muted">You followed: {monthFormat.format(person.iFollowedAt)}</p>
    {/if}
    {#if person.theyFollowedAt !== null}
      <p class="text-muted">They followed: {monthFormat.format(person.theyFollowedAt)}</p>
    {/if}
    <p class="text-muted">{mutualsLine}</p>
    <a
      class="inline-block text-keep underline"
      href={`https://www.instagram.com/${person.username}/`}
      target="_blank"
      rel="noreferrer">Open profile (Enter)</a
    >
  </div>

  <div class="mt-5 grid grid-cols-2 gap-2">
    {#each availableDecisions(person) as decision (decision)}
      <button
        type="button"
        class={clsx(
          'rounded-card border border-muted/30 px-3 py-2 text-left text-sm',
          decision === 'keep' && 'text-keep',
          decision !== 'keep' && 'text-cut',
        )}
        onclick={() => onDecide(decision)}
      >
        <span>{KEY_HINTS[decision]} {LABELS[decision]}</span>
        {#if hintFor(decision)}
          <span class="block text-xs text-warn">{hintFor(decision)}</span>
        {/if}
      </button>
    {/each}
  </div>
</article>
