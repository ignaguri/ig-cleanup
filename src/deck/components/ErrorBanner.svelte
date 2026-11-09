<script lang="ts">
import Icon from './Icon.svelte';

type Props = { message: string; onDismiss: () => void };
let { message, onDismiss }: Props = $props();
</script>

<div class="flex items-start gap-3 rounded-xl border border-cut/30 bg-cut-tint px-4 py-3 text-sm" role="alert">
  <span class="mt-0.5 text-cut"><Icon name="alert" size={16} /></span>
  <p class="flex-1 break-words text-soft">{message}</p>
  <button type="button" class="press rounded-md px-2 text-muted hover:text-text" onclick={onDismiss}>Dismiss</button>
</div>
