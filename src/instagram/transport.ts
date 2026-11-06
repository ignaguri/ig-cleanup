import { IG_ORIGIN } from '../shared/constants';
import { IgNoAnswerError, IgRetryableError, IgShapeError } from './errors';
import { ensureRelayTab } from './relay-tab';

const RELAY_TIMEOUT_MS = 45000;

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
async function messageRelay(tabId: number, message: unknown) {
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

async function sendToRelay(tabId: number, message: unknown) {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => reject(new IgNoAnswerError()), RELAY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([messageRelay(tabId, message), timeout]);
  } finally {
    clearTimeout(timerId);
  }
}

type RelayReply = IgRawResponse | { networkError: string; timedOut?: boolean } | { tokenError: string } | undefined;

export async function igFetch(req: IgRequest): Promise<IgRawResponse> {
  let reply: RelayReply;
  try {
    const tabId = await ensureRelayTab();
    reply = await sendToRelay(tabId, { type: 'igc:fetch', req });
  } catch (error) {
    if (error instanceof IgNoAnswerError) {
      throw error;
    }
    // The relay got the request but its page went away before answering: a write may have gone out.
    if (error instanceof Error && /message (channel|port) closed/.test(error.message)) {
      throw new IgNoAnswerError(error.message);
    }
    throw new IgRetryableError(error instanceof Error ? error.message : 'Network failure');
  }
  if (!reply) {
    throw new IgRetryableError('No reply from relay tab');
  }
  if ('networkError' in reply) {
    throw reply.timedOut ? new IgNoAnswerError(reply.networkError) : new IgRetryableError(reply.networkError);
  }
  // Not transient: the page lost its tokens (logged out or not an instagram page).
  if ('tokenError' in reply) {
    throw new IgShapeError(req.path, reply.tokenError);
  }
  return reply;
}
