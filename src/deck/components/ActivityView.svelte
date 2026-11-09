<script lang="ts">
import clsx from 'clsx';
import { allActions, type RequestLogRow, recentRequests } from '../../db/db';
import { REQUEST_LOG_SIZE } from '../../shared/constants';
import type { ActionStatus, ActionType, Decision, Person, QueuedAction } from '../../shared/types';
import { formatCount, formatWhen } from '../lib/format';
import { describeEndpoint } from '../lib/requests';
import PersonCell from './PersonCell.svelte';

type Props = { people: Person[]; refreshKey: number; onError: (error: unknown) => void };
let { people, refreshKey, onError }: Props = $props();

type Tab = 'sends' | 'decisions' | 'requests';
type SendFilter = 'upcoming' | 'sent' | 'failed' | 'cancelled';

const DECISIONS_SHOWN = 100;

let tab = $state<Tab>('sends');
let sendFilter = $state<SendFilter>('upcoming');
let actions = $state<QueuedAction[]>([]);
let requests = $state<RequestLogRow[]>([]);
let now = $state(Date.now());

$effect(() => {
  refreshKey;
  Promise.all([allActions(), recentRequests()])
    .then(([loadedActions, loadedRequests]) => {
      actions = loadedActions;
      requests = loadedRequests;
      now = Date.now();
    })
    .catch(onError);
});

const peopleByPk = $derived(new Map(people.map((person) => [person.pk, person])));

const FILTER_STATUSES: Record<SendFilter, ActionStatus[]> = {
  upcoming: ['sending', 'queued'],
  sent: ['sent'],
  failed: ['failed'],
  cancelled: ['cancelled'],
};

const FILTERS: { id: SendFilter; label: string }[] = [
  { id: 'upcoming', label: 'Up next' },
  { id: 'sent', label: 'Sent' },
  { id: 'failed', label: 'Failed' },
  { id: 'cancelled', label: 'Cancelled' },
];

function actionsIn(filter: SendFilter): QueuedAction[] {
  return actions.filter((action) => FILTER_STATUSES[filter].includes(action.status));
}

// The sender sends sending-first, then the lowest id; sent rows read newest first.
const visibleActions = $derived.by(() => {
  const rows = actionsIn(sendFilter);
  if (sendFilter === 'upcoming') {
    return [...rows].sort(
      (a, b) => Number(b.status === 'sending') - Number(a.status === 'sending') || (a.id ?? 0) - (b.id ?? 0),
    );
  }
  return [...rows].sort((a, b) => (b.sentAt ?? b.createdAt) - (a.sentAt ?? a.createdAt));
});

const recentDecisions = $derived(
  people
    .filter((person) => person.decision !== 'undecided' && person.decidedAt !== null)
    .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0))
    .slice(0, DECISIONS_SHOWN),
);

const ACTION_LABELS: Record<ActionType, string> = {
  unfollow: 'Unfollow',
  remove: 'Remove follower',
  follow: 'Re-follow',
};

const DECISION_BADGES: Record<Decision, { label: string; tone: string }> = {
  keep: { label: 'Keep', tone: 'bg-keep-tint text-keep' },
  unfollow: { label: 'Unfollow', tone: 'bg-cut-tint text-cut' },
  remove: { label: 'Remove', tone: 'bg-cut-tint text-cut' },
  both: { label: 'Unfollow + remove', tone: 'bg-cut-tint text-cut' },
  undecided: { label: '', tone: '' },
};

function actionTime(action: QueuedAction): string {
  if (action.status === 'sent' && action.sentAt !== null) {
    return `Sent ${formatWhen(action.sentAt, now)}`;
  }
  if (action.status === 'sending') {
    return 'Sending now';
  }
  return `Queued ${formatWhen(action.createdAt, now)}`;
}

function statusTone(status: number | null): string {
  if (status === null) {
    return 'text-cut';
  }
  if (status >= 200 && status < 300) {
    return 'text-keep';
  }
  if (status === 429 || status >= 500) {
    return 'text-cut';
  }
  return 'text-warn';
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'sends', label: 'Sends' },
  { id: 'decisions', label: 'Decisions' },
  { id: 'requests', label: 'Instagram requests' },
];
</script>

<section class="mx-auto flex w-full max-w-3xl flex-col gap-5">
  <div class="flex items-center gap-1 self-start rounded-full border border-line bg-raised p-1" role="tablist">
    {#each TABS as item (item.id)}
      <button
        type="button"
        role="tab"
        aria-selected={tab === item.id}
        class={clsx(
          'press rounded-full px-4 py-1.5 text-sm',
          tab === item.id ? 'bg-surface-2 text-text' : 'text-muted hover:text-text',
        )}
        onclick={() => (tab = item.id)}>{item.label}</button
      >
    {/each}
  </div>

  {#if tab === 'sends'}
    <div class="flex flex-wrap gap-2">
      {#each FILTERS as filter (filter.id)}
        {@const count = actionsIn(filter.id).length}
        <button
          type="button"
          class={clsx(
            'press inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs',
            sendFilter === filter.id ? 'border-text text-text' : 'border-line text-muted hover:border-line-strong hover:text-text',
          )}
          aria-pressed={sendFilter === filter.id}
          onclick={() => (sendFilter = filter.id)}
        >
          {filter.label}
          <span class={clsx('tabular-nums', filter.id === 'failed' && count > 0 && 'text-cut')}>{formatCount(count)}</span>
        </button>
      {/each}
    </div>

    <ol class="panel divide-y divide-line overflow-hidden">
      {#each visibleActions as action, index (action.id)}
        <li class="flex items-center gap-4 px-4 py-3 hover:bg-surface-2/60">
          {#if sendFilter === 'upcoming'}
            <span class="w-6 shrink-0 text-right text-xs text-muted tabular-nums">{index + 1}</span>
          {/if}
          <div class="min-w-0 flex-1"><PersonCell person={peopleByPk.get(action.personPk)} pk={action.personPk} /></div>
          <span
            class={clsx(
              'shrink-0 rounded-md px-2 py-0.5 text-xs',
              action.type === 'follow' ? 'bg-surface-2 text-soft' : 'bg-cut-tint text-cut',
            )}>{ACTION_LABELS[action.type]}</span
          >
          <div class="w-44 shrink-0 text-right">
            <span class={clsx('block text-xs tabular-nums', action.status === 'sending' ? 'text-keep' : 'text-muted')}>
              {actionTime(action)}
            </span>
            {#if action.error}
              <span class="block truncate text-xs text-cut" title={action.error}>{action.error}</span>
            {/if}
            {#if action.attempts > 1}
              <span class="block text-xs text-muted">{action.attempts} attempts</span>
            {/if}
          </div>
        </li>
      {:else}
        <li class="px-4 py-10 text-center text-sm text-muted">
          {sendFilter === 'upcoming' ? 'Nothing queued. Unfollows and removals you pick land here.' : 'Nothing here yet.'}
        </li>
      {/each}
    </ol>
  {:else if tab === 'decisions'}
    <ol class="panel divide-y divide-line overflow-hidden">
      {#each recentDecisions as person (person.pk)}
        <li class="flex items-center gap-4 px-4 py-3 hover:bg-surface-2/60">
          <div class="min-w-0 flex-1"><PersonCell {person} pk={person.pk} /></div>
          <span class={clsx('shrink-0 rounded-md px-2 py-0.5 text-xs', DECISION_BADGES[person.decision].tone)}>
            {DECISION_BADGES[person.decision].label}
          </span>
          <span class="w-32 shrink-0 text-right text-xs text-muted tabular-nums">
            {person.decidedAt !== null ? formatWhen(person.decidedAt, now) : ''}
          </span>
        </li>
      {:else}
        <li class="px-4 py-10 text-center text-sm text-muted">No decisions yet. Swipe through a deck to start.</li>
      {/each}
    </ol>
    {#if recentDecisions.length === DECISIONS_SHOWN}
      <p class="text-center text-xs text-muted">Showing the latest {DECISIONS_SHOWN}</p>
    {/if}
  {:else}
    <div class="panel overflow-hidden">
      <table class="w-full text-sm">
        <thead class="text-left text-xs text-muted">
          <tr class="border-b border-line">
            <th class="px-4 py-2.5 font-medium">Time</th>
            <th class="px-4 py-2.5 font-medium">Call</th>
            <th class="px-4 py-2.5 font-medium">Status</th>
            <th class="px-4 py-2.5 font-medium">Result</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          {#each requests as row (row.id)}
            {@const call = describeEndpoint(row.endpoint)}
            {@const target = call.targetPk ? peopleByPk.get(call.targetPk) : undefined}
            <tr class="hover:bg-surface-2/60">
              <td class="px-4 py-2.5 whitespace-nowrap text-muted tabular-nums">{formatWhen(row.at, now)}</td>
              <td class="px-4 py-2.5" title={row.endpoint}>
                {call.label}
                {#if target}
                  <span class="text-muted">· @{target.username}</span>
                {/if}
              </td>
              <td class={clsx('px-4 py-2.5 font-medium tabular-nums', statusTone(row.status))}>{row.status ?? 'none'}</td>
              <td class={clsx('max-w-64 truncate px-4 py-2.5', row.outcome === 'ok' ? 'text-muted' : 'text-warn')} title={row.outcome}>
                {row.outcome}
              </td>
            </tr>
          {:else}
            <tr><td colspan="4" class="px-4 py-10 text-center text-muted">No requests yet</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="text-xs text-muted">The last {REQUEST_LOG_SIZE} calls to Instagram, newest first.</p>
  {/if}
</section>
