import { mount } from 'svelte';
import { addActions, getMeta, logRequest, putPeople, setMeta, wipeAll } from '../db/db';
import App from '../deck/App.svelte';
import '../deck/app.css';
import { META_ACCOUNT, META_BLOCK, META_COLLECTION, META_MODE, META_SETTINGS } from '../shared/constants';
import { installFakeChrome } from './fake-chrome';
import { buildDemoData, type Scenario } from './fixtures';

const SCENARIOS: Scenario[] = ['default', 'collecting', 'blocked', 'empty'];
const SEEDED_KEY = 'demoScenario';

// Runs the real deck UI on localhost against seeded IndexedDB. ?scenario=collecting|blocked|empty, ?reset to reseed.
async function seed(scenario: Scenario) {
  const params = new URLSearchParams(location.search);
  const seeded = await getMeta<Scenario>(SEEDED_KEY);
  if (seeded === scenario && !params.has('reset')) {
    return;
  }
  const data = buildDemoData(scenario, Date.now());
  await wipeAll();
  await putPeople(data.people);
  await addActions(data.actions);
  for (const row of data.requests) {
    await logRequest(row);
  }
  await setMeta(META_ACCOUNT, data.meta.account);
  await setMeta(META_MODE, data.meta.mode);
  await setMeta(META_BLOCK, data.meta.block);
  await setMeta(META_COLLECTION, data.meta.collection);
  await setMeta(META_SETTINGS, data.meta.settings);
  await setMeta(SEEDED_KEY, scenario);
}

const requested = new URLSearchParams(location.search).get('scenario') as Scenario | null;
const scenario: Scenario = requested && SCENARIOS.includes(requested) ? requested : 'default';
const nextSendAt = Date.now() + 4 * 60_000;

installFakeChrome(() => nextSendAt);
seed(scenario)
  .then(() => {
    mount(App, { target: document.getElementById('app')! });
  })
  .catch((error) => {
    document.body.textContent = `Demo seeding failed: ${error instanceof Error ? error.message : String(error)}`;
  });
