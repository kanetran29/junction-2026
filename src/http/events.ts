import type { Context } from 'hono';
import type { Env } from '../env';
import { listEvents, type Event } from '../events/log';
import { HttpError, identify } from './auth';

type Ctx = Context<{ Bindings: Env }>;

const POLL_MS = 1000;
const PING_MS = 15_000;
const CLOSE_MS = 60_000;

/**
 * The events a caller may read and from where: a judge or admin key may read any buyer (optionally filtered), an agent key
 * only its own. `since` comes from the query or, when absent, the `Last-Event-ID` header a reconnecting EventSource sends.
 */
async function scope(c: Ctx): Promise<{ since: number; buyerId?: string }> {
  const who = await identify(c.env, c.req.header('Authorization'));
  if (!who) throw new HttpError(401, 'UNAUTHORIZED', 'a valid Bearer API key is required');
  const asked = c.req.query('buyer') || undefined;
  if (who.role === 'agent' && asked && asked !== who.buyerId) throw new HttpError(403, 'FORBIDDEN', 'an agent key reads only its own buyer');
  const raw = c.req.query('since') ?? c.req.header('Last-Event-ID');
  const since = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 0;
  return { since, buyerId: who.role === 'agent' ? (who.buyerId ?? undefined) : asked };
}

/** `GET /v1/events`: one page of events (at most 500) and `next`, the last seq returned or `since` when none. */
export async function readEvents(c: Ctx): Promise<{ events: Event[]; next: number }> {
  const q = await scope(c);
  const events = await listEvents(c.env, q);
  return { events, next: events.length ? events[events.length - 1].seq : q.since };
}

/**
 * `GET /v1/events/stream`: Server-Sent Events built on a ReadableStream that polls `listEvents` (a Worker has no push from D1).
 * Sends `: ping` every 15 s and closes after about 60 s; the client resumes with `since` or `Last-Event-ID`.
 */
export async function streamEvents(c: Ctx): Promise<Response> {
  const q = await scope(c);
  const enc = new TextEncoder();
  let open = true;
  const body = new ReadableStream<Uint8Array>({
    async start(ctl) {
      let since = q.since;
      const started = Date.now();
      let lastWrite = started;
      try {
        while (open && Date.now() - started < CLOSE_MS) {
          for (const e of await listEvents(c.env, { since, buyerId: q.buyerId })) {
            ctl.enqueue(enc.encode(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
            since = e.seq;
            lastWrite = Date.now();
          }
          if (Date.now() - lastWrite >= PING_MS) {
            ctl.enqueue(enc.encode(': ping\n\n'));
            lastWrite = Date.now();
          }
          await new Promise((r) => setTimeout(r, POLL_MS));
        }
        ctl.close();
      } catch {
        // the client went away; nothing left to send
      }
    },
    cancel() {
      open = false;
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' } });
}
