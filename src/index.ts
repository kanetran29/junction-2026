import { createApp } from './http/routes';
import { mcpRoutes } from './mcp/tools';
import type { Env } from './env';

const app = createApp();
app.route('/', mcpRoutes());

/**
 * The Worker. Each request gets its own copy of `env`, so the Postgres client that `src/db.ts` keys on it (and its sockets)
 * belongs to that request alone, as Workers require.
 */
export default {
  fetch: (req: Request, env: Env, ctx?: ExecutionContext) => app.fetch(req, { ...env }, ctx),
} satisfies ExportedHandler<Env>;
