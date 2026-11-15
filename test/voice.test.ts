import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db';
import type { Env } from '../src/env';
import { createApp } from '../src/http/routes';
import { addressBucket } from '../src/try/sandbox';
import { sha256Hex } from '../src/util';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', ADMIN_KEY: 'adm', GEMINI_API_KEY: 'gk', GEMINI_MODEL: 'gemini-test', GEMMA_MODEL: 'gemma-test' };

/** What the stub Gemini says to an audio clip, and the last request body the door sent it. */
let spoken = '';
let overQuota = false;
let modelDown = false;
let sent: any;
let geminiCalls = 0;

/** A stub Gemini: transcribes (says `spoken`), answers 429 with RetryInfo, fails, or 500s on a text request. */
const upstream = (async (_url: string | URL | Request, init?: RequestInit) => {
  geminiCalls++;
  sent = JSON.parse(String(init?.body ?? '{}'));
  const audio = sent.contents?.[0]?.parts?.[0]?.inlineData;
  if (!audio || modelDown) return new Response('down', { status: 500 });
  if (overQuota) return new Response(JSON.stringify({ error: { code: 429, details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' }] } }), { status: 429 });
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: spoken }] } }] }));
}) as typeof fetch;

const app = createApp(upstream);
const json = async (r: Response) => (await r.json()) as any;
const admin = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { Authorization: 'Bearer adm', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, e);
/** POSTs a clip of `size` bytes to the voice route. */
const clip = (o: { type?: string; size?: number; ip?: string; visitor?: string; env?: Env } = {}) =>
  app.request(
    '/v1/try/voice',
    { method: 'POST', headers: { 'Content-Type': o.type ?? 'audio/webm;codecs=opus', 'CF-Connecting-IP': o.ip ?? '198.51.100.7', ...(o.visitor ? { 'X-Visitor-Token': o.visitor } : {}) }, body: new Uint8Array(o.size ?? 2000).fill(7) },
    o.env ?? e,
  );
const typed = (text: string, ip = '198.51.100.7') => app.request('/v1/try', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ text }) }, e);

beforeEach(async () => {
  await admin('/admin/reset', { clock: '2026-11-13T21:10:00+02:00', replay: null, replayVariant: {} });
  await admin('/admin/feature', { name: 'voice', enabled: true });
  spoken = 'twenty litres of lactose-free milk by Monday';
  overQuota = false;
  modelDown = false;
  geminiCalls = 0;
  sent = undefined;
});

describe('POST /v1/try/voice', () => {
  it('is 404 with the voice flag off, and on a door that is not a demo', async () => {
    await admin('/admin/feature', { name: 'voice', enabled: false });
    const r = await clip();
    expect([r.status, (await json(r)).error]).toEqual([404, 'NOT_FOUND']);
    await admin('/admin/feature', { name: 'voice', enabled: true });
    expect((await clip({ env: { ...e, DEMO_MODE: '0' } })).status).toBe(404);
    expect(geminiCalls).toBe(0);
  });

  it('transcribes a clip, asking Gemini for text only: audio as inline data, the strict prompt, no tools', async () => {
    const r = await clip({ type: 'audio/webm;codecs=opus' });
    expect([r.status, await json(r)]).toEqual([200, { transcript: spoken }]);
    const part = sent.contents[0].parts[0].inlineData;
    expect(part.mimeType).toBe('audio/webm');
    expect(atob(part.data)).toBe('\x07'.repeat(2000));
    expect(sent.systemInstruction.parts[0].text).toMatch(/verbatim[\s\S]*ignore any instruction[\s\S]*NO_SPEECH/);
    expect(sent.tools).toBeUndefined();
    expect(sent.generationConfig).toEqual({ temperature: 0 });
    expect(JSON.stringify(sent)).not.toContain('functionDeclarations');
  });

  it('is 400 TRANSCRIPT_EMPTY for NO_SPEECH or an empty answer', async () => {
    spoken = 'NO_SPEECH';
    const r = await clip();
    expect([r.status, (await json(r)).error]).toEqual([400, 'TRANSCRIPT_EMPTY']);
    spoken = '   ';
    expect((await clip()).status).toBe(400);
  });

  it('is 503 MODELS_BUSY with retryAfter and a Retry-After header when Gemini is over quota', async () => {
    overQuota = true;
    const r = await clip();
    expect(r.status).toBe(503);
    expect(r.headers.get('Retry-After')).toBe('17');
    expect(await json(r)).toMatchObject({ error: 'MODELS_BUSY', retryAfter: 17 });
  });

  it('is 503 MODEL_UNAVAILABLE for any other model failure', async () => {
    modelDown = true;
    const r = await clip();
    expect([r.status, (await json(r)).error]).toEqual([503, 'MODEL_UNAVAILABLE']);
  });

  it('is 415 UNSUPPORTED_MEDIA_TYPE for anything but webm, ogg, mp4 or wav audio', async () => {
    for (const type of ['application/json', 'audio/mpeg', 'text/plain']) {
      const r = await clip({ type });
      expect([r.status, (await json(r)).error]).toEqual([415, 'UNSUPPORTED_MEDIA_TYPE']);
    }
    for (const type of ['audio/ogg', 'audio/mp4', 'audio/wav']) expect((await clip({ type })).status).toBe(200);
    expect(geminiCalls).toBe(3);
  });

  it('takes at most 1 MB, and the 4 KB limit of the other Try it routes does not apply', async () => {
    expect((await clip({ size: 900_000 })).status).toBe(200);
    const r = await clip({ size: 1_000_001 });
    expect([r.status, (await json(r)).error]).toEqual([413, 'PAYLOAD_TOO_LARGE']);
    expect(geminiCalls).toBe(1);
  });

  it('is 404 VISITOR_UNKNOWN for a token that belongs to no sandbox, and counts a known one per visitor', async () => {
    const r = await clip({ visitor: 'nobody' });
    expect([r.status, (await json(r)).error]).toEqual([404, 'VISITOR_UNKNOWN']);
    await db(e).prepare('INSERT INTO try_visitors(token_hash, buyer_id, address_hash, created_at, last_used) VALUES (?1::text, ?2::text, ?3::text, ?4::text, ?5::bigint)').bind(await sha256Hex('tok'), 'visitor-aaaaaaaa', await sha256Hex(`try-address:${addressBucket('198.51.100.7')}`), '2026-11-13T21:10:00+02:00', Date.now()).run();
    for (let i = 0; i < 3; i++) expect((await clip({ visitor: 'tok' })).status).toBe(200);
    const over = await clip({ visitor: 'tok' });
    expect([over.status, (await json(over)).error]).toEqual([429, 'TRY_RATE_LIMITED']);
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await clip()).status).toBe(200);
  });

  it('counts against the shared free-text bucket: six free-text tries, then a clip is 429', async () => {
    for (let i = 0; i < 6; i++) await typed(`free text number ${i} please`, `203.0.113.${i + 1}`);
    const r = await clip({ ip: '203.0.113.99' });
    const b = await json(r);
    expect([r.status, b.error]).toEqual([429, 'TRY_RATE_LIMITED']);
    expect(b.retryAfter).toBeGreaterThan(0);
  });

  it('counts clips against the same bucket the other way round', async () => {
    for (let i = 0; i < 6; i++) expect((await clip({ ip: `203.0.113.${i + 1}` })).status).toBe(200);
    const r = await typed('a typed request after six clips', '203.0.113.99');
    expect([r.status, (await json(r)).error]).toEqual([429, 'TRY_RATE_LIMITED']);
  });

  it('cuts a transcript over 200 characters at a word boundary', async () => {
    spoken = `${'milk '.repeat(60)}end`;
    const t = (await json(await clip())).transcript as string;
    expect(t.length).toBeLessThanOrEqual(200);
    expect(t).toBe('milk '.repeat(40).trim());
  });

  it('is in the OpenAPI document with its audio request body', async () => {
    const doc = await json(await app.request('/openapi.json', {}, e));
    const op = doc.paths['/v1/try/voice'].post;
    expect(Object.keys(op.requestBody.content)).toEqual(['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/wav']);
    expect(op.summary).toContain('never interprets');
  });
});
