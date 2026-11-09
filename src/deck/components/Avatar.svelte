<script lang="ts">
import clsx from 'clsx';
import { loadPicture } from '../lib/pictures';

type Props = { url: string; name: string; class?: string };
let { url, name, class: className = '' }: Props = $props();

let src = $state<string | null>(null);

$effect(() => {
  const requested = url;
  src = null;
  if (!requested) {
    return;
  }
  return loadPicture(requested, (blobUrl) => {
    src = blobUrl;
  });
});

const initials = $derived(name.trim().slice(0, 2).toUpperCase());
</script>

{#if src}
  <img class={clsx('rounded-full object-cover', className)} {src} alt="" />
{:else}
  <span
    class={clsx('flex items-center justify-center rounded-full bg-surface-2 font-semibold text-muted select-none', className)}
    aria-hidden="true">{initials}</span
  >
{/if}
