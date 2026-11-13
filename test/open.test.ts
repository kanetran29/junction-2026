import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { insertStatements } from '../scripts/build-index';
import type { Env } from '../src/env';
import { logEvent } from '../src/events/log';
import { createApp } from '../src/http/routes';
import { sha256Hex } from '../src/orders/store';
import { product } from './quote-helpers';

const e = { ...(env as unknown as Env), DEMO_MODE: '1', ADMIN_KEY: 'adm' };
const app = createApp(async () => {
  throw new Error('resolve, families and rules must make zero Valio calls');
});
const call = (path: string, key?: string, init: RequestInit = {}) => app.request(path, { ...init, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) } }, e);
const post = (path: string, body: unknown, key = 'adm-agent') => call(path, key, { method: 'POST', body: JSON.stringify(body) });
const json = async (r: Response) => (await r.json()) as any;
const name = (value: string) => [{ language: 'fi', value }];

beforeAll(async () => {
  await e.DB.batch(
    [
      product('A1', { names: name('Lasten maito 1l'), salesUnitGtin: '111', units: [{ unitId: 'ST', gtin: '111', sizeInBaseUnits: 1 }] }),
      product('A2', { names: name('Dupe item'), salesUnit: 'PAK' }),
      product('A3', { names: name('dupe item '), salesUnit: 'ST', category: '10500', subtype: 'butter' }),
      product('A4', { names: name('Juustomaito'), brand: 'ARLA', category: '10500', subtype: 'butter', salesUnitGtin: '222', units: [{ unitId: 'ST', gtin: '222', sizeInBaseUnits: 1 }] }),
      product('A5', { names: name('Tuote 5'), salesUnitGtin: '222', units: [{ unitId: 'ST', gtin: '222', sizeInBaseUnits: 1 }, { unitId: 'PAK', gtin: '333', sizeInBaseUnits: 6 }] }),
      ...['B1', 'B2', 'B3', 'B4'].map((id, i) => product(id, { category: '63235', subtype: null, tagSource: 'model', names: name(`Party ${id}`), brand: null, brandNorm: '', claims: [], searchText: i < 2 ? 'sopii juhla tarjoiluun' : 'ei mitään' })),
      ...['C1', 'C2'].map((id) => product(id, { category: '22300', names: name(`Few ${id}`), searchText: 'party' })),
    ].flatMap((p) => insertStatements([p]).map((s) => e.DB.prepare(s))),
  );
  await e.DB.prepare("INSERT OR REPLACE INTO category_names(category, names, tag_source) VALUES ('63235','Party food','reviewed')").run();
  for (const [key, role, buyer] of [['adm-agent', 'agent', 'hotel-a'], ['other-agent', 'agent', 'hotel-b'], ['the-judge', 'judge', 'hotel-a']])
    await e.DB.prepare('INSERT OR REPLACE INTO api_keys(key_hash, buyer_id, label, role) VALUES (?,?,?,?)').bind(await sha256Hex(key), buyer, 'test', role).run();
});

describe('resolve', () => {
  it('needs a key', async () => expect((await post('/v1/resolve', { productId: 'A1' }, '')).status).toBe(401));

  it('finds a product by id and by its sales-unit GTIN, with zero Valio calls', async () => {
    expect(await json(await post('/v1/resolve', { gtin: '111' }))).toMatchObject({ status: 'RESOLVED', product: { id: 'A1', salesUnit: 'ST' }, valioCalls: 0 });
    expect(await json(await post('/v1/resolve', { productId: 'A1' }))).toMatchObject({ status: 'RESOLVED', product: { id: 'A1' } });
    expect(await json(await post('/v1/resolve', { productId: 'nope' }))).toMatchObject({ status: 'NO_MATCH' });
  });

  it('answers AMBIGUOUS for a GTIN on two products or at another unit, NO_MATCH for none', async () => {
    const shared = await json(await post('/v1/resolve', { gtin: '222' }));
    expect(shared.status).toBe('AMBIGUOUS');
    expect(shared.candidates.map((c: { id: string }) => c.id)).toEqual(['A4', 'A5']);
    const other = await json(await post('/v1/resolve', { gtin: '333' }));
    expect(other).toMatchObject({ status: 'AMBIGUOUS', candidates: [{ id: 'A5', unitId: 'PAK' }] });
    expect((await json(await post('/v1/resolve', { gtin: '999' }))).status).toBe('NO_MATCH');
  });

  it('never picks between two products sharing an exact name', async () => {
    const r = await json(await post('/v1/resolve', { name: 'Dupe Item' }));
    expect(r.status).toBe('AMBIGUOUS');
    expect(r.candidates).toMatchObject([{ id: 'A2', salesUnit: 'PAK' }, { id: 'A3', salesUnit: 'ST' }]);
    expect(await json(await post('/v1/resolve', { name: 'lasten MAITO 1l' }))).toMatchObject({ status: 'RESOLVED', product: { id: 'A1' } });
  });

  it('resolves a partial name to a type, or lists the types it spans', async () => {
    expect(await json(await post('/v1/resolve', { name: 'lasten' }))).toMatchObject({ status: 'TYPE_RESOLVED', category: '10400', subtype: 'drinking milk' });
    const r = await json(await post('/v1/resolve', { name: 'maito' }));
    expect(r.status).toBe('AMBIGUOUS');
    expect(r.candidates.map((c: { category: string }) => c.category).sort()).toEqual(['10400', '10500']);
    expect((await json(await post('/v1/resolve', { name: 'zzz' }))).status).toBe('NO_MATCH');
  });

  it('reports brands as carried (display spelling), near, or not carried, never corrected', async () => {
    expect(await json(await post('/v1/resolve', { brand: 'arla' }))).toMatchObject({ status: 'RESOLVED', brand: 'Arla' });
    expect(await json(await post('/v1/resolve', { brand: 'Arrla' }))).toMatchObject({ status: 'BRAND_NOT_CARRIED', didYouMean: ['Arla'] });
    expect(await json(await post('/v1/resolve', { brand: 'Pirkka' }))).toMatchObject({ status: 'BRAND_NOT_CARRIED', didYouMean: [] });
  });
});

describe('families', () => {
  it('maps every category without terms', async () => {
    const r = await json(await call('/v1/families', 'adm-agent'));
    expect(r.valioCalls).toBe(0);
    expect(r.families.find((f: { category: string }) => f.category === '63235')).toMatchObject({ name: 'Party food', productCount: 4, tagSource: 'reviewed', subtypes: [] });
    expect(r.families.find((f: { category: string }) => f.category === '10400')).toMatchObject({ subtypes: ['drinking milk'], claims: ['FREE_FROM_LACTOSE'] });
  });

  it('ranks by evidence, needs three products, and never lists products', async () => {
    const r = await json(await call('/v1/families?terms=Juhla,party', 'adm-agent'));
    expect(r.families.map((f: { category: string }) => f.category)).toEqual(['63235']);
    expect(r.families[0]).toMatchObject({ evidence: { terms: ['juhla', 'party'], mentions: 2, of: 4 } });
    expect(r.families[0]).not.toHaveProperty('products');
  });
});

describe('rules and reason codes', () => {
  it('publishes the decision register without a key', async () => {
    const r = await json(await call('/v1/rules'));
    const by = (id: string) => r.decisions.find((d: { id: string }) => d.id === id);
    expect(r.decisions.map((d: { id: string }) => d.id)).toEqual(expect.arrayContaining(['orderable', 'conversion', 'rounding', 'subtype', 'ranking', 'rejectionPrecedence', 'split', 'substitution', 'quoteExpiry', 'allocation', 'approvalRecheck', 'interpretation', 'policy', 'approval']));
    expect(by('interpretation')).toMatchObject({ model: true, owner: 'buyer' });
    expect(by('policy')).toMatchObject({ model: false, owner: 'buyer' });
    expect(by('allocation').owner).toBe('seller');
    expect(by('approval').owner).toBe('approver');
    expect(by('ranking').rule).toContain('No sponsored placement, no popularity score');
  });

  it('lists the reason codes with resolution and retryable', async () => {
    const r = await json(await call('/v1/reason-codes'));
    expect(r.codes.find((c: { code: string }) => c.code === 'QUOTE_EXPIRED')).toMatchObject({ resolution: 'recoverable', retryable: true, text: expect.any(String) });
  });
});

describe('events', () => {
  beforeAll(async () => {
    await e.DB.prepare('DELETE FROM events').run();
    await logEvent(e, { type: 'draft.confirmed', buyerId: 'hotel-a', data: {} });
    await logEvent(e, { type: 'draft.confirmed', buyerId: 'hotel-b', data: {} });
    await logEvent(e, { type: 'search.done', buyerId: 'hotel-a', data: { count: 1, categories: ['10400'] } });
  });

  it('needs a key; an agent sees only its buyer, a judge and the admin see all', async () => {
    expect((await call('/v1/events')).status).toBe(401);
    const mine = await json(await call('/v1/events', 'adm-agent'));
    expect(mine.events.map((x: { buyerId: string }) => x.buyerId)).toEqual(['hotel-a', 'hotel-a']);
    expect((await json(await call('/v1/events', 'the-judge'))).events).toHaveLength(3);
    expect((await json(await call('/v1/events?buyer=hotel-b', 'adm'))).events).toHaveLength(1);
    expect((await call('/v1/events?buyer=hotel-b', 'adm-agent')).status).toBe(403);
  });

  it('since is exclusive and next is the last seq (or since when nothing is new)', async () => {
    const all = await json(await call('/v1/events', 'the-judge'));
    const [first, , last] = all.events;
    expect(all.next).toBe(last.seq);
    const rest = await json(await call(`/v1/events?since=${first.seq}`, 'the-judge'));
    expect(rest.events).toHaveLength(2);
    expect(await json(await call(`/v1/events?since=${last.seq}`, 'the-judge'))).toEqual({ events: [], next: last.seq });
  });

  it('streams the same events as SSE and resumes from Last-Event-ID', async () => {
    const polled = (await json(await call('/v1/events', 'the-judge'))).events;
    const read = async (path: string, headers: Record<string, string> = {}) => {
      const res = await app.request(path, { headers: { Authorization: 'Bearer the-judge', ...headers } }, e);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let text = '';
      while ((text.match(/\n\n/g) ?? []).length < 3 || !text.includes(`id: ${polled[2].seq}`)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
        if (text.includes(`id: ${polled[polled.length - 1].seq}\n`) && text.endsWith('\n\n')) break;
      }
      await reader.cancel();
      return text;
    };
    const full = await read('/v1/events/stream');
    const frames = full.trim().split('\n\n').map((f) => Object.fromEntries(f.split('\n').map((l) => [l.slice(0, l.indexOf(': ')), l.slice(l.indexOf(': ') + 2)])));
    expect(frames.map((f) => JSON.parse(f.data))).toEqual(polled);
    expect(frames.map((f) => [f.id, f.event])).toEqual(polled.map((p: { seq: number; type: string }) => [String(p.seq), p.type]));
    const resumed = await read('/v1/events/stream', { 'Last-Event-ID': String(polled[1].seq) });
    expect(resumed).toContain(`id: ${polled[2].seq}`);
    expect(resumed).not.toContain(`id: ${polled[1].seq}\n`);
  });
});

describe('/openapi.json', () => {
  it('lists the open routes', async () => {
    const doc = await json(await call('/openapi.json'));
    for (const p of ['/v1/resolve', '/v1/families', '/v1/rules', '/v1/reason-codes', '/v1/events', '/v1/events/stream']) expect(doc.paths).toHaveProperty([p]);
  });
});
