<script lang="ts">
import { type IgRawResponse, igFetch, readSession } from '../instagram/transport';

type SpikeResult = { label: string } & Partial<IgRawResponse> & { error?: string };

let getResult = $state<SpikeResult | null>(null);
let postResult = $state<SpikeResult | null>(null);

async function run(label: string, send: (userId: string) => Promise<IgRawResponse>) {
  try {
    const session = await readSession();
    if (!session) {
      return { label, error: 'No Instagram session cookies (log in first)' };
    }
    return { label, ...(await send(session.userId)) };
  } catch (error) {
    return { label, error: String(error) };
  }
}

async function runGet() {
  getResult = await run('GET followers', (userId) =>
    igFetch({
      method: 'GET',
      path: `/api/v1/friendships/${userId}/followers/`,
      query: { count: '12', search_surface: 'follow_list_page' },
    }),
  );
}

async function runPost() {
  postResult = await run('POST show_many', (userId) =>
    igFetch({
      method: 'POST',
      path: '/api/v1/friendships/show_many/',
      form: { user_ids: userId },
    }),
  );
}

function format(result: SpikeResult | null) {
  if (!result) {
    return '(not run)';
  }
  if (result.error) {
    return `${result.label}\nerror: ${result.error}`;
  }
  return `${result.label}\nstatus: ${result.status}\nurl: ${result.url}\nbody: ${(result.text ?? '').slice(0, 300)}`;
}

async function copyResults() {
  await navigator.clipboard.writeText(
    `Transport: Option 2: pinned-tab relay\n\n${format(getResult)}\n\n${format(postResult)}`,
  );
}
</script>

<main class="min-h-screen bg-bg p-4 text-text">
  <h1 class="text-xl">Instagram Cleanup</h1>

  <section class="mt-4 space-y-2">
    <h2 class="text-lg">Spike (temporary)</h2>
    <p>Transport: Option 2: pinned-tab relay</p>
    <div class="flex gap-2">
      <button class="border px-2 py-1" onclick={runGet}>GET</button>
      <button class="border px-2 py-1" onclick={runPost}>POST</button>
      <button class="border px-2 py-1" onclick={copyResults}>Copy results</button>
    </div>
    <pre class="whitespace-pre-wrap break-all text-sm">{format(getResult)}</pre>
    <pre class="whitespace-pre-wrap break-all text-sm">{format(postResult)}</pre>
  </section>
</main>
