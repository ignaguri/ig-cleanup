import { IgRetryableError } from './errors';
import { ensureRelayTab } from './relay-tab';

const IG_ORIGIN = 'https://www.instagram.com';

export type IgRequest = {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  form?: Record<string, string>;
};

export type IgRawResponse = { status: number; url: string; text: string };

export async function readSession(): Promise<{ userId: string; csrfToken: string } | null> {
  const [userIdCookie, csrfCookie] = await Promise.all([
    chrome.cookies.get({ url: IG_ORIGIN, name: 'ds_user_id' }),
    chrome.cookies.get({ url: IG_ORIGIN, name: 'csrftoken' }),
  ]);
  if (!userIdCookie || !csrfCookie) {
    return null;
  }
  return { userId: userIdCookie.value, csrfToken: csrfCookie.value };
}

// Tabs opened before an extension reload have no content script until injected.
async function sendToRelay(tabId: number, message: unknown) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Receiving end does not exist')) {
      throw error;
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

export async function igFetch(req: IgRequest): Promise<IgRawResponse> {
  try {
    const tabId = await ensureRelayTab();
    const reply = await sendToRelay(tabId, { type: 'igc:fetch', req });
    if (!reply || 'networkError' in reply) {
      throw new Error(reply?.networkError ?? 'No reply from relay tab');
    }
    return reply as IgRawResponse;
  } catch (error) {
    throw new IgRetryableError(error instanceof Error ? error.message : 'Network failure');
  }
}
