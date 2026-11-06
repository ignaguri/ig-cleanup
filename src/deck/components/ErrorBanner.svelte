<script lang="ts">
type Props = { message: string; onDismiss: () => void };
let { message, onDismiss }: Props = $props();
</script>

<div class="flex items-center justify-between gap-4 rounded-card bg-surface px-4 py-3 text-sm text-cut" role="alert">
  <span>{message}</span>
  <button type="button" class="text-muted" onclick={onDismiss}>Dismiss</button>
</div>
