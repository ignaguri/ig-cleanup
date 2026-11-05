import type { IgRequest } from '../instagram/transport';

const IG_APP_ID = '936619743392459';

function readCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

async function performFetch(req: IgRequest) {
  const queryString = req.query ? `?${new URLSearchParams(req.query).toString()}` : '';
  const headers: Record<string, string> = {
    'X-IG-App-ID': IG_APP_ID,
    'X-CSRFToken': readCsrfToken(),
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (req.method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  try {
    const response = await fetch(`${req.path}${queryString}`, {
      method: req.method,
      credentials: 'include',
      headers,
      body: req.method === 'POST' ? new URLSearchParams(req.form ?? {}) : undefined,
    });
    return { status: response.status, url: response.url, text: await response.text() };
  } catch (error) {
    return { networkError: error instanceof Error ? error.message : 'Network failure' };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'igc:fetch') {
    return false;
  }
  performFetch(message.req).then(sendResponse);
  return true;
});
