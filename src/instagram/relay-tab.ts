const IG_URL = 'https://www.instagram.com/';

function waitForLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const onUpdated = (updatedTabId: number, changeInfo: { status?: string }) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    // Covers the tab finishing between the first status read and the listener attaching.
    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
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
