// Cloudflare Workers entry (Workers Builds / "Import a repository" flow):
// serves the built web app from static assets and the API under /api/*.
import { handle, type Env } from './handler.ts';
import { telegramTick, type TgEnv } from './telegram-watch.ts';

interface AssetsEnv extends Env, TgEnv {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

export default {
  fetch(req: Request, env: AssetsEnv, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith('/api/') || pathname === '/health') return handle(req, env, ctx);
    return env.ASSETS.fetch(req);
  },
  // Cron Trigger (wrangler.toml [triggers]): 1-minute Telegram channel check
  scheduled(_event: unknown, env: AssetsEnv, ctx: ExecutionContext): void {
    ctx.waitUntil(telegramTick(env).catch(() => undefined));
  },
};
