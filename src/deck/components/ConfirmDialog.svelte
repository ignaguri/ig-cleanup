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
    <Dialog.Overlay class="fixed inset-0 z-40 bg-bg/80 backdrop-blur-sm data-[state=open]:animate-[fade-in_160ms_ease]" />
    <Dialog.Content
      class="fixed top-1/2 left-1/2 z-50 w-[26rem] -translate-x-1/2 -translate-y-1/2 space-y-5 rounded-2xl border border-line bg-surface p-6 text-text shadow-[0_24px_60px_-12px_rgb(0_0_0_/_0.8)] data-[state=open]:animate-[fade-in_160ms_ease]"
    >
      <div class="space-y-2">
        <Dialog.Title class="text-lg font-semibold">{title}</Dialog.Title>
        <Dialog.Description class="text-sm text-soft">{description}</Dialog.Description>
      </div>
      <div class="flex justify-end gap-3">
        <Dialog.Close class="press btn btn-quiet">Cancel</Dialog.Close>
        <button type="button" class="press btn btn-danger" onclick={confirm}>{confirmLabel}</button>
      </div>
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
