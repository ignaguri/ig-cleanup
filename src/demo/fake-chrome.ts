import { DEMO_USER_ID } from './fixtures';

const BLOCKED_HOSTS = /(^|\.)(instagram\.com|cdninstagram\.com|fbcdn\.net)$/;

function refuse(api: string): never {
  throw new Error(`demo: ${api} is not available outside the extension`);
}

// Only what the deck page reads. Anything that would reach Instagram (relay tab, scripting) throws.
export function installFakeChrome(nextSendAt: () => number) {
  const fake = {
    cookies: {
      get: async ({ name }: { name: string }) =>
        name === 'ds_user_id' ? { value: DEMO_USER_ID } : name === 'csrftoken' ? { value: 'demo' } : null,
    },
    alarms: { get: async () => ({ name: 'igc-send', scheduledTime: nextSendAt() }) },
    runtime: {
      sendMessage: async () => undefined,
      getURL: (path: string) => `${location.origin}/${path}`,
      reload: () => location.reload(),
    },
    tabs: {
      getCurrent: async () => ({ id: 1 }),
      query: async () => [],
      update: async () => undefined,
      remove: async () => undefined,
      create: () => refuse('tabs.create'),
      reload: () => refuse('tabs.reload'),
      sendMessage: () => refuse('tabs.sendMessage'),
      onRemoved: { addListener: () => {}, removeListener: () => {} },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },
    windows: { update: async () => undefined },
    scripting: { executeScript: () => refuse('scripting.executeScript') },
  };
  (globalThis as unknown as { chrome: unknown }).chrome = fake;

  // Belt and braces: the demo never talks to Instagram, even by accident.
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (BLOCKED_HOSTS.test(url.hostname)) {
      return Promise.reject(new Error(`demo: blocked request to ${url.hostname}`));
    }
    return realFetch(input, init);
  };
}
