import type { Env } from '../worker/index.ts';

// Exchanges the GitHub code for a user token and hands it to the browser in the URL fragment
// (fragments never reach servers or logs). Nothing is stored server-side.
export async function GET(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const [nonce, encodedReturn] = (url.searchParams.get('state') ?? '').split('.');
  const cookieNonce = (req.headers.get('cookie') ?? '').match(/(?:^|;\s*)prtour_state=([^;]+)/)?.[1];

  if (!code || !nonce || nonce !== cookieNonce) {
    return new Response('Sign-in failed: invalid or expired state. Please try again.', { status: 400 });
  }

  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${url.origin}/api/callback`,
    }),
  });
  const data = (await res.json()) as { access_token?: string; error_description?: string };
  if (!data.access_token) {
    return new Response(`Sign-in failed: ${data.error_description ?? 'no token returned'}`, { status: 400 });
  }

  let returnTo = '/';
  try { returnTo = Buffer.from(encodedReturn ?? '', 'base64url').toString(); } catch {}
  if (!returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.startsWith('/\\')) returnTo = '/';

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${returnTo}#access_token=${encodeURIComponent(data.access_token)}`,
      'Set-Cookie': 'prtour_state=; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
      'Cache-Control': 'no-store',
    },
  });
}
