import { IgRetryableError } from './errors';

const IG_ORIGIN = 'https://www.instagram.com';
const IG_APP_ID = '936619743392459';

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
  const session = await readSession();
  const queryString = req.query ? `?${new URLSearchParams(req.query).toString()}` : '';
  const headers: Record<string, string> = {
    'X-IG-App-ID': IG_APP_ID,
    'X-CSRFToken': session?.csrfToken ?? '',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (req.method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  try {
    const response = await fetch(`${IG_ORIGIN}${req.path}${queryString}`, {
      method: req.method,
      credentials: 'include',
      headers,
      body: req.method === 'POST' ? new URLSearchParams(req.form ?? {}) : undefined,
    });
    return { status: response.status, url: response.url, text: await response.text() };
  } catch (error) {
    throw new IgRetryableError(error instanceof Error ? error.message : 'Network failure');
  }
}
