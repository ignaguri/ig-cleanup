<script lang="ts">
import ConfirmDialog from './ConfirmDialog.svelte';

type Props = { currentUserId: string; storedUserId: string; onStartNew: () => void };
let { currentUserId, storedUserId, onStartNew }: Props = $props();
let confirmOpen = $state(false);
</script>

<main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-bg p-6 text-text">
  <p class="text-lg">Logged in as user {currentUserId}, this cleanup belongs to user {storedUserId}.</p>
  <p class="text-sm text-muted">Switch back to the original account in instagram.com, or start over.</p>
  <button type="button" class="rounded-card bg-cut px-4 py-2" onclick={() => (confirmOpen = true)}>
    Start a new cleanup for user {currentUserId}
  </button>
</main>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Start a new cleanup?"
  description="This deletes all collected people, decisions and the queue for the old account."
  confirmLabel="Delete and start new"
  onConfirm={onStartNew}
/>
