import { log } from '../shared/log';

chrome.action.onClicked.addListener(async () => {
  const deckUrl = chrome.runtime.getURL('deck.html');
  const [existingTab] = await chrome.tabs.query({ url: deckUrl });
  if (existingTab?.id !== undefined) {
    await chrome.tabs.update(existingTab.id, { active: true });
    if (existingTab.windowId !== undefined) {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
    return;
  }
  log.info('opening deck');
  await chrome.tabs.create({ url: deckUrl });
});
