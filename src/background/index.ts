import { SEND_ALARM } from '../shared/constants';
import { log } from '../shared/log';
import { kickSender, rearmFallback, tickAndReschedule } from './sender';

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

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SEND_ALARM) {
    return;
  }
  try {
    await tickAndReschedule();
  } catch (error) {
    log.error('send tick failed', error);
    try {
      await rearmFallback();
    } catch (rearmError) {
      log.error('fallback alarm failed', rearmError);
    }
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'igc:kick') {
    return false;
  }
  kickSender()
    .then(() => sendResponse({ ok: true }))
    .catch((error) => {
      log.error('kick failed', error);
      sendResponse({ ok: false });
    });
  return true;
});

function kickOnLifecycle(): void {
  kickSender().catch((error) => log.error('kick failed', error));
}
chrome.runtime.onStartup.addListener(kickOnLifecycle);
chrome.runtime.onInstalled.addListener(kickOnLifecycle);
