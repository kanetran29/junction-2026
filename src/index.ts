import { Hono } from 'hono';
import { helsinkiIso, now, replayOn } from './clock';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

/** Liveness plus the gateway's clock (+02:00), replay mode, and whether a Gemini key is configured. */
app.get('/health', async (c) => {
  const env = c.env;
  return c.json({
    ok: true,
    now: helsinkiIso(await now(env)),
    replay: await replayOn(env),
    models: { gemini: Boolean(env.GEMINI_API_KEY) },
  });
});

export default app;
