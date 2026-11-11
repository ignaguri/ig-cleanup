<script lang="ts">
import type { Person, ScanSummary, TimeWindow } from '../../shared/types';
import { formatCount, formatWhen, formatWindow } from '../lib/format';
import PersonCell from './PersonCell.svelte';

type Props = { people: Person[]; lastScan: ScanSummary };
let { people, lastScan }: Props = $props();

const ROWS_SHOWN = 50;

type Row = { person: Person; timeWindow: TimeWindow };

function rowsBy(pick: (person: Person) => TimeWindow | null | undefined): Row[] {
  return people
    .flatMap((person) => {
      const timeWindow = pick(person);
      return timeWindow ? [{ person, timeWindow }] : [];
    })
    .sort((a, b) => b.timeWindow.before - a.timeWindow.before);
}

// Everyone who ever left, newest first; new followers only from the latest scan.
const lost = $derived(rowsBy((person) => person.unfollowedMe));
const gained = $derived(
  rowsBy((person) => person.startedFollowingMe).filter((row) => row.timeWindow.before >= lastScan.startedAt),
);
</script>

{#snippet personRows(rows: Row[], emptyText: string)}
  {#if rows.length === 0}
    <p class="text-sm text-muted">{emptyText}</p>
  {:else}
    <ul class="divide-y divide-line">
      {#each rows.slice(0, ROWS_SHOWN) as { person, timeWindow } (person.pk)}
        <li class="flex items-center gap-3 py-2.5">
          <div class="min-w-0 flex-1"><PersonCell {person} pk={person.pk} detail={formatWindow(timeWindow)} /></div>
          {#if person.unfollowedMe && person.iFollow}
            <span class="shrink-0 rounded-md bg-cut/15 px-2 py-0.5 text-xs text-cut">You still follow them</span>
          {/if}
        </li>
      {/each}
    </ul>
    {#if rows.length > ROWS_SHOWN}
      <p class="text-xs text-muted">And {formatCount(rows.length - ROWS_SHOWN)} more</p>
    {/if}
  {/if}
{/snippet}

<div class="panel space-y-5 p-6">
  <div>
    <p class="text-base font-semibold">Follower changes</p>
    <p class="mt-1 text-sm text-muted">
      Last scan {formatWhen(lastScan.completedAt, Date.now())}: {formatCount(lastScan.lostFollowers)} stopped following you,
      {formatCount(lastScan.newFollowers)} new.
    </p>
    {#if lastScan.followersDiffSkipped}
      <p class="mt-2 text-sm text-warn">
        Instagram's followers list came back much shorter than before, so nobody was marked as gone from it. Try scanning again later.
      </p>
    {/if}
  </div>

  <div class="space-y-2">
    <p class="text-xs font-medium tracking-wide text-muted uppercase">Stopped following you, all scans</p>
    {@render personRows(lost, 'Nobody so far.')}
    {#if lost.some((row) => row.person.iFollow)}
      <p class="text-xs text-muted">The ones you still follow are back in "Doesn't follow you back", even if you'd kept them.</p>
    {/if}
  </div>

  <div class="space-y-2">
    <p class="text-xs font-medium tracking-wide text-muted uppercase">New followers, last scan</p>
    {@render personRows(gained, 'None in the last scan.')}
  </div>
</div>
