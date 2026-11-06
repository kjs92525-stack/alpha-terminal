// Cloudflare Workers entry (Workers Builds / "Import a repository" flow):
// serves the built web app from static assets and the API under /api/*.
import { handle, type Env } from './handler.ts';
import { telegramTick, type TgEnv } from './telegram-watch.ts';
import { nightlyKick, type KickEnv } from './nightly-kick.ts';

interface AssetsEnv extends Env, TgEnv, KickEnv {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

export default {
  fetch(req: Request, env: AssetsEnv, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith('/api/') || pathname === '/health') return handle(req, env, ctx);
    return env.ASSETS.fetch(req);
  },
  // Cron Trigger (wrangler.toml [triggers]): send a new Telegram channel digest, and start the
  // nightly data pipeline right after the US close (GitHub's own schedule runs hours late)
  scheduled(_event: unknown, env: AssetsEnv, ctx: ExecutionContext): void {
    ctx.waitUntil(telegramTick(env).catch(() => undefined));
    ctx.waitUntil(nightlyKick(env).catch(() => undefined));
  },
};
