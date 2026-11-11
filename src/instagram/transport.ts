import { IG_ORIGIN } from '../shared/constants';
import { IgNoAnswerError, IgRetryableError, IgShapeError } from './errors';
import { ensureRelayTab, findRelayTab } from './relay-tab';
import { isViewer } from './viewer';

const RELAY_TIMEOUT_MS = 45000;

export type IgRequest = {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string>;
  form?: Record<string, string>;
  headers?: Record<string, string>;
};

export type ProfileQuery = { docId: string; providedVariables: Record<string, unknown>; lsd: string };

type PageModule = {
  params?: { id?: unknown; providedVariables?: Record<string, { get: () => unknown }> };
  token?: unknown;
};

// Runs inside the page, so it can't use anything from this file.
function readProfileQueryInPage(): ProfileQuery | null {
  try {
    const pageRequire = (window as unknown as { require: (name: string) => PageModule }).require;
    const params = pageRequire('PolarisProfilePageContentQuery$Parameters').params;
    const lsd = pageRequire('LSD').token;
    if (typeof params?.id !== 'string' || typeof lsd !== 'string') {
      return null;
    }
    const providedVariables: Record<string, unknown> = {};
    for (const [name, provider] of Object.entries(params.providedVariables ?? {})) {
      providedVariables[name] = provider.get();
    }
    return { docId: params.id, providedVariables, lsd };
  } catch {
    return null;
  }
}

// The query's doc_id changes with Instagram's deploys, so it's read from the page's own modules.
// Null when the page doesn't have them; never throws.
export async function readProfileQuery(): Promise<ProfileQuery | null> {
  try {
    const tabId = await ensureRelayTab();
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: readProfileQueryInPage,
    });
    return (injection?.result as ProfileQuery | null | undefined) ?? null;
  } catch {
    return null;
  }
}

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

// Read from the relay page itself, not requested from Instagram. Without openTab only an already open relay
// tab is used. Null when unknown or another account; never throws.
export async function readUsername(userId: string, { openTab }: { openTab: boolean }): Promise<string | null> {
  try {
    const tabId = openTab ? await ensureRelayTab() : await findRelayTab();
    if (tabId === null) {
      return null;
    }
    const reply = await sendToRelay(tabId, { type: 'igc:viewer' });
    return isViewer(reply) && reply.userId === userId ? reply.username : null;
  } catch {
    return null;
  }
}
