const IG_URL = 'https://www.instagram.com/';

function waitForLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
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
  if (tab.status !== 'complete') {
    await waitForLoad(tab.id);
  }
  return tab.id;
}
