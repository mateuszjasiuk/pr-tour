const API = 'https://api.github.com';

export class AuthError extends Error {}

export interface Pull {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  head: { sha: string };
  base: { sha: string };
}

async function gh(path: string, token: string | null, init: RequestInit & { accept?: string } = {}): Promise<Response> {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      Accept: init.accept ?? 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  // Private repos answer 404 to anonymous callers, so treat that as "needs sign-in" too.
  if (res.status === 401 || (!token && (res.status === 404 || res.status === 403))) {
    throw new AuthError(token ? 'Your GitHub session expired.' : 'Sign in to view this pull request.');
  }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message ?? msg; } catch {}
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  return res;
}

export const getPull = async (o: string, r: string, n: number, token: string | null): Promise<Pull> =>
  (await gh(`/repos/${o}/${r}/pulls/${n}`, token)).json();

export const getPullDiff = async (o: string, r: string, n: number, token: string | null): Promise<string> =>
  (await gh(`/repos/${o}/${r}/pulls/${n}`, token, { accept: 'application/vnd.github.diff' })).text();
