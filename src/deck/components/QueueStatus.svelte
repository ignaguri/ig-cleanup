<script lang="ts">
import clsx from 'clsx';
import { sentInLast24h } from '../../core/pacing';
import { actionsByStatus, getMeta } from '../../db/db';
import { DEFAULT_SETTINGS, META_SETTINGS, SEND_ALARM } from '../../shared/constants';
import { log } from '../../shared/log';
import type { Mode, Settings } from '../../shared/types';

type Props = { mode: Mode | undefined; refreshKey: number };
let { mode, refreshKey }: Props = $props();

const timeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' });

let queued = $state(0);
let sentToday = $state(0);
let dailyCap = $state(DEFAULT_SETTINGS.dailyCap);
let nextSend = $state('—');

const MODE_LABELS: Record<Mode, string> = { sending: 'Sending is ON', collecting: 'Collecting', paused: 'Paused' };
const effectiveMode = $derived(mode ?? 'paused');

async function refresh() {
  try {
    const [queuedActions, sentActions, settings, alarm] = await Promise.all([
      actionsByStatus('queued'),
      actionsByStatus('sent'),
      getMeta<Settings>(META_SETTINGS),
      chrome.alarms.get(SEND_ALARM),
    ]);
    queued = queuedActions.length;
    sentToday = sentInLast24h(sentActions, Date.now());
    dailyCap = settings?.dailyCap ?? DEFAULT_SETTINGS.dailyCap;
    nextSend = alarm ? timeFormat.format(alarm.scheduledTime) : '—';
  } catch (error) {
    log.warn('queue status refresh failed', error);
  }
}

$effect(() => {
  refreshKey;
  refresh();
});
</script>

<section class="space-y-1 rounded-card bg-surface p-3 text-sm">
  <p
    class={clsx(
      'rounded-card px-3 py-2 text-center text-base font-semibold',
      effectiveMode === 'sending' ? 'bg-cut text-text' : 'bg-bg',
      effectiveMode === 'collecting' && 'text-warn',
      effectiveMode === 'paused' && 'text-muted',
    )}
  >
    {MODE_LABELS[effectiveMode]}
  </p>
  <p>Queued: {queued}</p>
  <p>Sent today: {sentToday} / {dailyCap}</p>
  <p>Next send: {nextSend}</p>
</section>
