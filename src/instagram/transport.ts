import { IgRetryableError, IgShapeError } from './errors';
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

type RelayReply = IgRawResponse | { networkError: string } | { tokenError: string } | undefined;

export async function igFetch(req: IgRequest): Promise<IgRawResponse> {
  let reply: RelayReply;
  try {
    const tabId = await ensureRelayTab();
    reply = await sendToRelay(tabId, { type: 'igc:fetch', req });
  } catch (error) {
    throw new IgRetryableError(error instanceof Error ? error.message : 'Network failure');
  }
  if (!reply) {
    throw new IgRetryableError('No reply from relay tab');
  }
  if ('networkError' in reply) {
    throw new IgRetryableError(reply.networkError);
  }
  // Not transient: the page lost its tokens (logged out or not an instagram page).
  if ('tokenError' in reply) {
    throw new IgShapeError(req.path, reply.tokenError);
  }
  return reply;
}
