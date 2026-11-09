<script lang="ts">
import ConfirmDialog from './ConfirmDialog.svelte';

type Props = { currentUserId: string; storedUserId: string; onStartNew: () => void };
let { currentUserId, storedUserId, onStartNew }: Props = $props();
let confirmOpen = $state(false);
</script>

<main class="flex min-h-screen items-center justify-center bg-bg p-6 text-text">
  <div class="panel w-full max-w-md space-y-4 p-6">
    <h1 class="text-lg font-semibold">This cleanup belongs to another account</h1>
    <p class="text-sm text-soft">
      You're logged in as user {currentUserId}, but the data here was collected for user {storedUserId}. Switch back to
      that account on instagram.com, or start over for this one.
    </p>
    <button type="button" class="press btn btn-danger" onclick={() => (confirmOpen = true)}>
      Start a new cleanup for user {currentUserId}
    </button>
  </div>
</main>

<ConfirmDialog
  bind:open={confirmOpen}
  title="Start a new cleanup?"
  description="This deletes all collected people, decisions and the queue for the old account."
  confirmLabel="Delete and start new"
  onConfirm={onStartNew}
/>
