import type { IgRequest } from '../instagram/transport';

const IG_APP_ID = '936619743392459';

function readCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

// Instagram rejects POSTs without these (it answers with HTML). API POSTs derive jazoest from the csrftoken.
function readPageTokens(csrfToken: string): { fb_dtsg: string; jazoest: string } | null {
  const scriptsText = Array.from(document.scripts, (script) => script.textContent ?? '').join('\n');
  const dtsg = scriptsText.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/)?.[1];
  if (!dtsg || !csrfToken) {
    return null;
  }
  return { fb_dtsg: dtsg, jazoest: computeJazoest(csrfToken) };
}

function computeJazoest(seed: string): string {
  let sum = 0;
  for (const char of seed) {
    sum += char.charCodeAt(0);
  }
  return `2${sum}`;
}

async function performFetch(req: IgRequest) {
  try {
    const queryString = req.query ? `?${new URLSearchParams(req.query).toString()}` : '';
    const csrfToken = readCsrfToken();
    const headers: Record<string, string> = {
      'X-IG-App-ID': IG_APP_ID,
      'X-CSRFToken': csrfToken,
      'X-Requested-With': 'XMLHttpRequest',
    };
    let body: URLSearchParams | undefined;
    if (req.method === 'POST') {
      const tokens = readPageTokens(csrfToken);
      if (!tokens) {
        return { tokenError: 'Page tokens not found; reload the instagram.com tab' };
      }
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ ...(req.form ?? {}), jazoest: tokens.jazoest, fb_dtsg: tokens.fb_dtsg });
    }
    const response = await fetch(`${req.path}${queryString}`, {
      method: req.method,
      credentials: 'include',
      headers,
      body,
    });
    return { status: response.status, url: response.url, text: await response.text() };
  } catch (error) {
    return { networkError: error instanceof Error ? error.message : 'Network failure' };
  }
}

const relayFlag = globalThis as { __igcRelay?: boolean };
if (!relayFlag.__igcRelay) {
  relayFlag.__igcRelay = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'igc:fetch') {
      return false;
    }
    performFetch(message.req).then(sendResponse);
    return true;
  });
}
