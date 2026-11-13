import { GET as login } from '../api/login.ts';
import { GET as callback } from '../api/callback.ts';

/** Bindings Cloudflare passes to the Worker: the static build and the dashboard variables. */
export interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_OAUTH_SCOPE?: string;
}

export default {
  fetch(req: Request, env: Env): Response | Promise<Response> {
    const { pathname } = new URL(req.url);

    if (pathname === '/api/login') return login(req, env);
    if (pathname === '/api/callback') return callback(req, env);

    return env.ASSETS.fetch(req);
  },
};
