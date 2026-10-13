// Standalone Cloudflare Worker entry. See wrangler.toml in this folder.
import { handle, type Env } from './handler';

export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handle(req, env, ctx);
  },
};
