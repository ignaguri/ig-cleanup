import { IG_ORIGIN } from '../shared/constants';

const IG_URL = `${IG_ORIGIN}/`;
const LOAD_TIMEOUT_MS = 45000;

function waitForLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timerId = setTimeout(() => {
      cleanup();
      reject(new Error('Relay tab did not finish loading'));
    }, LOAD_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timerId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
    const onUpdated = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    };
    const onRemoved = (removedTabId: number) => {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error('Relay tab was closed while loading'));
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    // Covers the tab finishing between the first status read and the listener attaching.
    chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') {
          cleanup();
          resolve();
        }
      })
      .catch((error: unknown) => {
        cleanup();
        reject(error);
      });
  });
}

export async function ensureRelayTab(): Promise<number> {
  const [existingTab] = await chrome.tabs.query({ url: `${IG_URL}*`, pinned: true });
  const tab = existingTab ?? (await chrome.tabs.create({ url: IG_URL, pinned: true, active: false }));
  if (tab.id === undefined) {
    throw new Error('Relay tab has no id');
  }
  // A discarded tab has no running page to relay through.
  if (tab.discarded || tab.status === 'unloaded') {
    await chrome.tabs.reload(tab.id);
    await waitForLoad(tab.id);
  } else if (tab.status !== 'complete') {
    await waitForLoad(tab.id);
  }
  return tab.id;
}
