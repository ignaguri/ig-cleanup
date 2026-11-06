<script lang="ts">
import type { BlockInfo } from '../../shared/types';

type Props = { block: BlockInfo; onResume: () => void };
let { block, onResume }: Props = $props();

const THROTTLE_REASONS: BlockInfo['reason'][] = ['rate_limited', 'feedback_required', 'http_429'];
const throttled = $derived(THROTTLE_REASONS.includes(block.reason));
// Instagram answering a write with HTML on a 200 means the relay tab lost its page tokens.
const staleRelayTab = $derived(block.reason === 'non_json' && block.status === 200);
</script>

<div class="space-y-2 rounded-card bg-surface px-4 py-3 text-sm" role="alert">
  <p class="text-warn">Instagram blocked a request: {block.reason}</p>
  <p class="text-muted">{block.endpoint} (status {block.status}) at {new Date(block.at).toLocaleString()}</p>
  {#if block.excerpt}
    <p class="break-all text-muted">{block.excerpt}</p>
  {/if}
  {#if throttled}
    <p class="text-warn">Instagram is limiting this account. Wait several hours (or a day) before resuming.</p>
  {:else if staleRelayTab}
    <p class="text-muted">Reload the pinned instagram.com tab before resuming.</p>
  {/if}
  <button type="button" class="rounded-card bg-keep px-3 py-1 text-bg" onclick={onResume}>Resume</button>
</div>
