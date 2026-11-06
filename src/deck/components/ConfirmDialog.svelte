<script lang="ts">
import { Dialog } from 'bits-ui';

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
};
let { open = $bindable(), title, description, confirmLabel, onConfirm }: Props = $props();

function confirm() {
  open = false;
  onConfirm();
}
</script>

<Dialog.Root bind:open>
  <Dialog.Portal>
    <Dialog.Overlay class="fixed inset-0 bg-bg/80" />
    <Dialog.Content class="fixed top-1/2 left-1/2 w-96 -translate-x-1/2 -translate-y-1/2 space-y-4 rounded-card bg-surface p-6 text-text">
      <Dialog.Title class="text-lg">{title}</Dialog.Title>
      <Dialog.Description class="text-sm text-muted">{description}</Dialog.Description>
      <div class="flex justify-end gap-3 text-sm">
        <Dialog.Close class="px-3 py-1 text-muted">Cancel</Dialog.Close>
        <button type="button" class="rounded-card bg-cut px-3 py-1 text-text" onclick={confirm}>{confirmLabel}</button>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
