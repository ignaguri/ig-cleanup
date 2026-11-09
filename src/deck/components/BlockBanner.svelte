<script lang="ts">
import type { BlockInfo } from '../../shared/types';
import { formatWhen } from '../lib/format';
import { describeEndpoint } from '../lib/requests';
import Icon from './Icon.svelte';

type Props = { block: BlockInfo; onResume: () => void };
let { block, onResume }: Props = $props();

const THROTTLE_REASONS: BlockInfo['reason'][] = ['rate_limited', 'feedback_required', 'http_429'];
const throttled = $derived(THROTTLE_REASONS.includes(block.reason));
// HTML on a 200, or the relay finding no page tokens, both mean the pinned tab needs a reload.
const staleRelayTab = $derived(
  block.reason === 'non_json' && (block.status === 200 || block.excerpt.includes('Page tokens not found')),
);

const copy = $derived.by(() => {
  if (block.reason === 'account_mismatch') {
    return {
      title: 'Paused: Instagram is logged into a different account',
      advice: 'Switch back to the account this cleanup belongs to on instagram.com, then resume.',
    };
  }
  if (block.reason === 'login_required' && block.endpoint === 'session') {
    return { title: 'Paused: logged out of Instagram', advice: 'Log in on instagram.com, then resume.' };
  }
  if (staleRelayTab) {
    return {
      title: 'Paused: the pinned Instagram tab lost its session details',
      advice: 'Reload the pinned instagram.com tab, then resume.',
    };
  }
  if (throttled) {
    return {
      title: 'Instagram blocked a request, everything is paused',
      advice: 'Instagram is limiting this account. Wait several hours, or a day, before resuming.',
    };
  }
  return {
    title: 'Instagram blocked a request, everything is paused',
    advice: 'Check instagram.com in a normal tab, then resume.',
  };
});
</script>

<div class="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn-tint px-4 py-3 text-sm" role="alert">
  <span class="mt-0.5 text-warn"><Icon name="alert" size={16} /></span>
  <div class="min-w-0 flex-1 space-y-1">
    <p class="font-medium text-text">{copy.title}</p>
    <p class="text-soft">{copy.advice}</p>
    <p class="text-xs text-muted tabular-nums" title={block.endpoint}>
      {describeEndpoint(block.endpoint).label} · {block.reason} · status {block.status} · {formatWhen(block.at, Date.now())}
    </p>
    {#if block.excerpt}
      <p class="line-clamp-2 break-all text-xs text-muted">{block.excerpt}</p>
    {/if}
  </div>
  <button type="button" class="press btn btn-quiet" onclick={onResume}>Resume</button>
</div>
