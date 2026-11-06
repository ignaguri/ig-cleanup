<script lang="ts">
import type { BlockInfo } from '../../shared/types';

type Props = { block: BlockInfo; onResume: () => void };
let { block, onResume }: Props = $props();
</script>

<div class="space-y-2 rounded-card bg-surface px-4 py-3 text-sm" role="alert">
  <p class="text-warn">Instagram blocked a request: {block.reason}</p>
  <p class="text-muted">{block.endpoint} (status {block.status}) at {new Date(block.at).toLocaleString()}</p>
  {#if block.excerpt}
    <p class="break-all text-muted">{block.excerpt}</p>
  {/if}
  <p class="text-muted">If a write was rejected (non_json), reload the pinned instagram.com tab before resuming.</p>
  <button type="button" class="rounded-card bg-keep px-3 py-1 text-bg" onclick={onResume}>Resume</button>
</div>
