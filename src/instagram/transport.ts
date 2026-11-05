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

export async function igFetch(req: IgRequest): Promise<IgRawResponse> {
  try {
    const tabId = await ensureRelayTab();
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'igc:fetch', req });
    if (!reply || 'networkError' in reply) {
      throw new Error(reply?.networkError ?? 'No reply from relay tab');
    }
    return reply as IgRawResponse;
  } catch (error) {
    throw new IgRetryableError(error instanceof Error ? error.message : 'Network failure');
  }
}
