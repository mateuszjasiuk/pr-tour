// Starts GitHub sign-in. Stateless: a short-lived cookie holds a nonce to check `state` on the way back.
export function GET(req: Request): Response {
  const url = new URL(req.url);
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) return new Response('GITHUB_CLIENT_ID is not set', { status: 500 });

  const returnTo = safePath(url.searchParams.get('return'));
  const nonce = crypto.randomUUID();
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', `${url.origin}/api/callback`);
  authorize.searchParams.set('state', `${nonce}.${Buffer.from(returnTo).toString('base64url')}`);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      'Set-Cookie': `prtour_state=${nonce}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=600`,
    },
  });
}

function safePath(p: string | null): string {
  return p && p.startsWith('/') && !p.startsWith('//') && !p.startsWith('/\\') ? p : '/';
}
