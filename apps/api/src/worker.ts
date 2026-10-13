// Cloudflare Workers entry (Workers Builds / "Import a repository" flow):
// serves the built web app from static assets and the API under /api/*.
import { handle, type Env } from './handler.ts';

interface AssetsEnv extends Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

export default {
  fetch(req: Request, env: AssetsEnv, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith('/api/') || pathname === '/health') return handle(req, env, ctx);
    return env.ASSETS.fetch(req);
  },
};
