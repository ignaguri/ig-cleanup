<script lang="ts">
import { IG_ORIGIN } from '../../shared/constants';
import type { Person } from '../../shared/types';
import Avatar from './Avatar.svelte';

type Props = { person: Person | undefined; pk: string; detail?: string };
let { person, pk, detail }: Props = $props();
</script>

<div class="flex min-w-0 items-center gap-3">
  <Avatar url={person?.picUrl ?? ''} name={person?.fullName || person?.username || '?'} class="h-8 w-8 shrink-0 text-[10px]" />
  <div class="min-w-0">
    {#if person}
      <a
        class="block truncate text-sm text-text hover:underline"
        href={`${IG_ORIGIN}/${person.username}/`}
        target="_blank"
        rel="noreferrer">{person.fullName || person.username}</a
      >
      <span class="block truncate text-xs text-muted">@{person.username}{detail ? ` · ${detail}` : ''}</span>
    {:else}
      <span class="block truncate text-sm text-muted">Unknown account {pk}</span>
    {/if}
  </div>
</div>
