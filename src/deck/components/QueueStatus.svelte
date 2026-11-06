<script lang="ts">
import { sentInLast24h } from '../../core/pacing';
import { actionsByStatus, getMeta } from '../../db/db';
import { DEFAULT_SETTINGS, META_MODE, META_SETTINGS, SEND_ALARM } from '../../shared/constants';
import { log } from '../../shared/log';
import type { Mode, Settings } from '../../shared/types';

type Props = { refreshKey: number };
let { refreshKey }: Props = $props();

const timeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' });

let queued = $state(0);
let sentToday = $state(0);
let dailyCap = $state(DEFAULT_SETTINGS.dailyCap);
let nextSend = $state('—');
let mode = $state<Mode | '—'>('—');

async function refresh() {
  try {
    const [queuedActions, sentActions, storedMode, settings, alarm] = await Promise.all([
      actionsByStatus('queued'),
      actionsByStatus('sent'),
      getMeta<Mode>(META_MODE),
      getMeta<Settings>(META_SETTINGS),
      chrome.alarms.get(SEND_ALARM),
    ]);
    queued = queuedActions.length;
    sentToday = sentInLast24h(sentActions, Date.now());
    dailyCap = settings?.dailyCap ?? DEFAULT_SETTINGS.dailyCap;
    mode = storedMode ?? '—';
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
  <p>Queued: {queued}</p>
  <p>Sent today: {sentToday} / {dailyCap}</p>
  <p>Next send: {nextSend}</p>
  <p class="text-muted">Mode: {mode}</p>
</section>
