import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { db, storeKind, toPg } from '../src/db';
import type { Env } from '../src/env';

const e = env as unknown as Env;

describe('db (Postgres write store)', () => {
  beforeEach(async () => {
    await db(e).prepare('DELETE FROM settings').run();
  });

  it('rewrites D1 placeholders to $N', () => {
    expect(toPg('SELECT ? , ?')).toBe('SELECT $1 , $2');
    expect(toPg('WHERE id = ?1 AND (?2::text IS NULL OR b = ?2)')).toBe('WHERE id = $1 AND ($2::text IS NULL OR b = $2)');
  });

  it('first, all and run answer like D1, with counts as numbers', async () => {
    const s = db(e);
    expect((await s.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').bind('a', '1').run()).meta.changes).toBe(1);
    await s.prepare('INSERT INTO settings(key, value) VALUES (?, ?)').bind('b', '2').run();
    expect(await s.prepare('SELECT value FROM settings WHERE key = ?').bind('a').first()).toEqual({ value: '1' });
    expect(await s.prepare('SELECT value FROM settings WHERE key = ?').bind('none').first()).toBeNull();
    expect((await s.prepare('SELECT key FROM settings ORDER BY key').all<{ key: string }>()).results.map((r) => r.key)).toEqual(['a', 'b']);
    expect(await s.prepare('SELECT COUNT(*) AS c, SUM(LENGTH(value))::numeric AS n FROM settings').first()).toEqual({ c: 2, n: 2 });
  });

  it('a batch is one transaction: a failing statement undoes the ones before it', async () => {
    const s = db(e);
    await expect(
      s.batch([s.prepare("INSERT INTO settings(key, value) VALUES ('x', '1')"), s.prepare("INSERT INTO settings(key, value) VALUES ('x', '2')")]),
    ).rejects.toThrow();
    expect(await s.prepare("SELECT 1 FROM settings WHERE key = 'x'").first()).toBeNull();
    const [, up] = await s.batch([
      s.prepare("INSERT INTO settings(key, value) VALUES ('y', '1')"),
      s.prepare("UPDATE settings SET value = '2' WHERE key = 'y' RETURNING value"),
    ]);
    expect(up).toEqual({ results: [{ value: '2' }], meta: { changes: 1 } });
  });

  it('keeps order totals above 2^31 cents (unknown stock lets a quote cover any quantity)', async () => {
    const s = db(e);
    await s.prepare("INSERT INTO orders(id, buyer_id, state, net_cents, gross_cents, body, created_at) VALUES ('big', 'b', 'REJECTED', ?, ?, '{}', 'x')").bind(3_000_000_000, 3_000_000_000).run();
    expect(await s.prepare("SELECT net_cents, SUM(gross_cents) AS g FROM orders WHERE id = 'big' GROUP BY net_cents").first()).toEqual({ net_cents: 3_000_000_000, g: 3_000_000_000 });
    await s.prepare("DELETE FROM orders WHERE id = 'big'").run();
  });

  it('names the store: plain Postgres here, aiven-postgres where aiven_extras is offered', async () => {
    expect(await storeKind(e)).toBe('postgres');
  });
});
