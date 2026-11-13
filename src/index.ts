import { Hono } from 'hono';
import { helsinkiIso, now, replayOn } from './clock';
import type { Env } from './env';

const app = new Hono<{ Bindings: Env }>();

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
