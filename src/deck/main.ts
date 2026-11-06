import { mount } from 'svelte';
import { log } from '../shared/log';
import App from './App.svelte';
import './app.css';

async function focusOtherDeckTab(): Promise<boolean> {
  const [currentTab, deckTabs] = await Promise.all([
    chrome.tabs.getCurrent(),
    chrome.tabs.query({ url: chrome.runtime.getURL('deck.html') }),
  ]);
  const otherTab = deckTabs.find((tab) => tab.id !== currentTab?.id);
  if (!otherTab?.id) {
    return false;
  }
  await chrome.tabs.update(otherTab.id, { active: true });
  await chrome.windows.update(otherTab.windowId, { focused: true });
  return true;
}

function closeThisTab() {
  chrome.tabs
    .getCurrent()
    .then((tab) => (tab?.id === undefined ? window.close() : chrome.tabs.remove(tab.id)))
    .catch((error) => log.error('could not close duplicate deck tab', error));
}

// Two deck tabs would run two collectors against the same IndexedDB.
focusOtherDeckTab()
  .then((focused) => {
    if (focused) {
      closeThisTab();
    } else {
      mount(App, { target: document.getElementById('app')! });
    }
  })
  .catch((error) => {
    log.error('single-tab guard failed', error);
    mount(App, { target: document.getElementById('app')! });
  });
