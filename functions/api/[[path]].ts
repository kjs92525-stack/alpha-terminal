// Cloudflare Pages Functions entry: serves /api/* from the same origin as the web app.
import { handle, type Env } from '../../apps/api/src/handler';

export const onRequest = (ctx: { request: Request; env: Env; waitUntil(p: Promise<unknown>): void }): Promise<Response> =>
  handle(ctx.request, ctx.env, { waitUntil: (p) => ctx.waitUntil(p) });
