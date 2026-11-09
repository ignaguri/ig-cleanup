<script lang="ts">
import clsx from 'clsx';
import type { Decision, Person } from '../../shared/types';
import { formatMonth } from '../lib/format';
import { pictureUrl } from '../lib/pictures';
import Avatar from './Avatar.svelte';
import Icon from './Icon.svelte';

type Props = { person: Person; leaving: Decision | null; entrance: 'next' | 'return' };
let { person, leaving, entrance }: Props = $props();

// Reduced motion keeps only the fade.
const EXIT_TRANSFORMS: Record<Decision, string> = {
  keep: 'motion-safe:translate-x-[115%] motion-safe:rotate-[14deg]',
  unfollow: 'motion-safe:-translate-x-[115%] motion-safe:-rotate-[14deg]',
  remove: 'motion-safe:translate-y-[60%] motion-safe:rotate-[4deg]',
  both: 'motion-safe:-translate-y-[60%] motion-safe:-rotate-[4deg]',
  undecided: '',
};

const STAMPS: Record<Decision, { label: string; tone: string; side: string }> = {
  keep: { label: 'KEEP', tone: 'border-keep text-keep', side: 'left-5 -rotate-12' },
  unfollow: { label: 'UNFOLLOW', tone: 'border-cut text-cut', side: 'right-5 rotate-12' },
  remove: { label: 'REMOVE', tone: 'border-cut text-cut', side: 'right-5 rotate-12' },
  both: { label: 'UNFOLLOW + REMOVE', tone: 'border-cut text-cut', side: 'right-5 rotate-12' },
  undecided: { label: '', tone: '', side: '' },
};

let backdrop = $state<string | null>(null);

$effect(() => {
  const url = person.picUrl;
  backdrop = null;
  if (!url) {
    return;
  }
  let cancelled = false;
  pictureUrl(url)
    .then((blobUrl) => {
      if (!cancelled) {
        backdrop = blobUrl;
      }
    })
    .catch(() => {});
  return () => {
    cancelled = true;
  };
});

const displayName = $derived(person.fullName.trim() || person.username);

const relationship = $derived.by(() => {
  if (person.iFollow && person.followsMe) {
    return { label: 'You follow each other', tone: 'bg-surface-2 text-soft' };
  }
  if (person.iFollow) {
    return { label: "Doesn't follow you back", tone: 'bg-cut/15 text-cut' };
  }
  return { label: "Follows you, you don't follow back", tone: 'bg-warn/15 text-warn' };
});

const mutualsLine = $derived.by(() => {
  const mutuals = person.mutuals;
  if (mutuals === null) {
    if (person.mutualsFetchedAt !== null) {
      return 'People in common unavailable';
    }
    if (person.iFollow && person.followsMe) {
      return null;
    }
    return 'People in common load later';
  }
  const names = mutuals.usernames;
  if (names.length === 0) {
    return 'No people in common';
  }
  const others = names.length - 1;
  if (others === 0 && !mutuals.hasMore) {
    return `Followed by ${names[0]}`;
  }
  if (mutuals.hasMore) {
    return `Followed by ${names[0]} and others`;
  }
  return `Followed by ${names[0]} and ${others} ${others === 1 ? 'other' : 'others'}`;
});

const followDates = $derived(
  [
    person.iFollowedAt !== null ? `You followed ${formatMonth(person.iFollowedAt)}` : null,
    person.theyFollowedAt !== null ? `They followed ${formatMonth(person.theyFollowedAt)}` : null,
  ].filter((line) => line !== null),
);
</script>

<article
  class={clsx(
    'relative flex h-[440px] w-[340px] flex-col overflow-hidden rounded-card border border-line bg-surface',
    'shadow-[0_24px_60px_-12px_rgb(0_0_0_/_0.7)]',
    leaving === null && (entrance === 'return' ? 'animate-card-return' : 'animate-card-in'),
    leaving !== null && ['opacity-0', EXIT_TRANSFORMS[leaving]],
  )}
  style="transition: translate 380ms var(--ease-swipe), rotate 380ms var(--ease-swipe), opacity 260ms linear 120ms"
  aria-label={displayName}
>
  {#if backdrop}
    <img
      class="pointer-events-none absolute inset-0 h-full w-full scale-125 object-cover opacity-50 blur-2xl"
      src={backdrop}
      alt=""
    />
  {/if}
  <div
    class="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_25%,rgb(11_12_16_/_0.92)_68%)]"
  ></div>

  {#if leaving !== null && leaving !== 'undecided'}
    <span
      class={clsx(
        'absolute top-6 z-10 rounded-lg border-2 px-3 py-1 text-base font-extrabold tracking-wider',
        STAMPS[leaving].tone,
        STAMPS[leaving].side,
      )}>{STAMPS[leaving].label}</span
    >
  {/if}

  <div class="relative flex flex-1 items-center justify-center pt-6">
    <Avatar
      url={person.picUrl}
      name={displayName}
      class="h-36 w-36 text-3xl shadow-[0_12px_32px_rgb(0_0_0_/_0.5)] ring-4 ring-white/10"
    />
  </div>

  <div class="relative space-y-3 px-6 pb-6">
    <div>
      <h2 class="line-clamp-2 text-xl leading-tight font-bold tracking-tight text-balance">{displayName}</h2>
      <p class="mt-1 flex items-center gap-1.5 text-sm text-soft">
        <span class="truncate">@{person.username}</span>
        {#if person.isVerified}
          <span class="text-sky-400" title="Verified"><Icon name="badge" size={14} /></span>
        {/if}
        {#if person.isPrivate}
          <span class="flex items-center gap-1 text-muted" title="Private account">
            <Icon name="lock" size={12} /> private
          </span>
        {/if}
      </p>
    </div>

    <span class={clsx('inline-flex rounded-md px-2 py-0.5 text-xs font-medium', relationship.tone)}>
      {relationship.label}
    </span>

    {#if mutualsLine !== null}
      <div class="flex items-center gap-2.5 text-sm text-soft">
        {#if person.mutuals && person.mutuals.picUrls.length > 0}
          <div class="flex shrink-0">
            {#each person.mutuals.picUrls.slice(0, 3) as url, index (url)}
              <Avatar
                {url}
                name={person.mutuals.usernames[index] ?? ''}
                class={clsx('h-6 w-6 text-[9px] ring-2 ring-surface', index > 0 && '-ml-2')}
              />
            {/each}
          </div>
        {/if}
        <span class="min-w-0 truncate" title={person.mutuals?.usernames.join(', ')}>{mutualsLine}</span>
      </div>
    {/if}

    {#if followDates.length > 0}
      <p class="text-xs text-muted tabular-nums">{followDates.join(' · ')}</p>
    {/if}
  </div>
</article>
