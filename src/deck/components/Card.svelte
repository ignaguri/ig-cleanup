<script lang="ts">
import clsx from 'clsx';
import { fetchesMutuals } from '../../core/collection';
import { deckOf } from '../../core/people';
import type { Decision, DeckId, Person } from '../../shared/types';
import { formatMonth } from '../lib/format';
import { EXIT_MS } from '../lib/motion';
import { loadPicture } from '../lib/pictures';
import Avatar from './Avatar.svelte';
import Icon from './Icon.svelte';

type Props = { person: Person; leaving: Decision | null; entrance: 'next' | 'return' };
let { person, leaving, entrance }: Props = $props();

const EXIT_TRANSFORMS: Record<Decision, string> = {
  keep: 'translateX(115%) rotate(14deg)',
  unfollow: 'translateX(-115%) rotate(-14deg)',
  remove: 'translateY(60%) rotate(4deg)',
  both: 'translateY(-60%) rotate(-4deg)',
  undecided: 'none',
};

const STAMPS: Record<Decision, { label: string; tone: string; side: string }> = {
  keep: { label: 'KEEP', tone: 'border-keep text-keep', side: 'left-5 -rotate-12' },
  unfollow: { label: 'UNFOLLOW', tone: 'border-cut text-cut', side: 'right-5 rotate-12' },
  remove: { label: 'REMOVE', tone: 'border-cut text-cut', side: 'right-5 rotate-12' },
  both: { label: 'UNFOLLOW + REMOVE', tone: 'border-cut text-cut', side: 'right-5 rotate-12' },
  undecided: { label: '', tone: '', side: '' },
};

let cardElement: HTMLElement | undefined = $state();
let backdrop = $state<string | null>(null);

// WAAPI, so a decision made while the card is still entering starts from where it visibly is.
$effect(() => {
  if (!cardElement || leaving === null) {
    return;
  }
  const element = cardElement;
  const { transform, opacity } = getComputedStyle(element);
  for (const running of element.getAnimations()) {
    running.cancel();
  }
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const exitTransform = reducedMotion ? transform : EXIT_TRANSFORMS[leaving];
  element.animate(
    [
      { transform, opacity, offset: 0 },
      { opacity, offset: 0.3 },
      { transform: exitTransform, opacity: 0, offset: 1 },
    ],
    { duration: EXIT_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
  );
});

$effect(() => {
  const url = person.picUrl;
  backdrop = null;
  if (!url) {
    return;
  }
  return loadPicture(url, (blobUrl) => {
    backdrop = blobUrl;
  });
});

const displayName = $derived(person.fullName.trim() || person.username);

const RELATIONSHIPS: Record<DeckId, { label: string; tone: string }> = {
  mutual: { label: 'You follow each other', tone: 'bg-surface-2 text-soft' },
  notFollowingBack: { label: "Doesn't follow you back", tone: 'bg-cut/15 text-cut' },
  fansNotFollowed: { label: "Follows you, you don't follow back", tone: 'bg-warn/15 text-warn' },
};

// Cards only show people from a deck, so deckOf is never null here.
const relationship = $derived(RELATIONSHIPS[deckOf(person) ?? 'mutual']);

const mutualsLine = $derived.by(() => {
  const mutuals = person.mutuals;
  if (mutuals === null) {
    if (person.mutualsFetchedAt !== null) {
      return 'People in common unavailable';
    }
    if (!fetchesMutuals(person)) {
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
    entrance === 'return' ? 'animate-card-return' : 'animate-card-in',
  )}
  bind:this={cardElement}
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
            {#each person.mutuals.picUrls.slice(0, 3) as url, index (index)}
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
