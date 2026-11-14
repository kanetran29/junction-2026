import postgres from 'postgres';
import type { Env } from './env';

/** One statement's rows and how many rows it changed (`meta.changes`, as D1 reports it). */
export interface Result<T = unknown> {
  results: T[];
  meta: { changes: number };
}

/** A D1-shaped statement over Postgres, so the stores keep their `prepare(...).bind(...)` calls. */
export interface Stmt {
  readonly text: string;
  readonly args: unknown[];
  bind(...args: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<Result>;
}

/** The write store: every table except the read-only catalog, which stays in D1 (`env.DB`). */
export interface Db {
  prepare(sql: string): Stmt;
  batch(stmts: Stmt[]): Promise<Result[]>;
}

/**
 * The tables the door writes (orders, ledger, approvals, events, mandates, keys, clock and replay settings). Idempotent, so
 * `/admin/reset` and the test setup run it every time. Times stay ISO text with `+02:00`, as in the D1 schema before.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS api_keys (key_hash TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, label TEXT, role TEXT NOT NULL DEFAULT 'agent');
CREATE TABLE IF NOT EXISTS buyer_keys (buyer_id TEXT PRIMARY KEY, public_key TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approver_keys (key_hash TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, approver TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mandates (buyer_id TEXT PRIMARY KEY, payload TEXT NOT NULL, signature TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS baskets (id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, buyer_id TEXT NOT NULL, quote_id TEXT, basket_id TEXT, idempotency_key TEXT, request_hash TEXT,
  state TEXT NOT NULL, net_cents BIGINT NOT NULL DEFAULT 0, gross_cents BIGINT NOT NULL DEFAULT 0, delivery_date TEXT,
  body TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT, reason TEXT, decision TEXT, agent_reason TEXT,
  mandate_version INTEGER, approver TEXT, lines_hash TEXT, approval_token TEXT, reply TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_idem ON orders(buyer_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_token ON orders(approval_token) WHERE approval_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_day ON orders(buyer_id, delivery_date, state);
CREATE TABLE IF NOT EXISTS order_lines (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), buyer_id TEXT NOT NULL,
  product_id TEXT NOT NULL, delivery_date TEXT NOT NULL, sales_units DOUBLE PRECISION NOT NULL, state TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_lines_product_date ON order_lines(product_id, delivery_date);
CREATE INDEX IF NOT EXISTS idx_order_lines_order ON order_lines(order_id);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, order_id TEXT, buyer_id TEXT, draft_id TEXT, quote_id TEXT,
  kind TEXT NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_order ON events(order_id);
CREATE INDEX IF NOT EXISTS idx_events_buyer ON events(buyer_id, id);
CREATE TABLE IF NOT EXISTS rate_limits (key_hash TEXT NOT NULL, minute INTEGER NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (key_hash, minute));
`;

/** Every table in SCHEMA, in an order that deletes children first. */
export const TABLES = ['order_lines', 'orders', 'quotes', 'baskets', 'drafts', 'events', 'approver_keys', 'rate_limits', 'mandates', 'buyer_keys', 'api_keys', 'settings'];

/** The advisory lock every batch takes: writes that must not interleave (the stock ledger above all) run one at a time. */
const WRITE_LOCK = 1;

const clients = new WeakMap<object, postgres.Sql>();

/** Rewrites D1 placeholders (`?` in order, or `?N`) to Postgres `$N`. */
export function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?(\d*)/g, (_, n: string) => `$${n || ++i}`);
}

/**
 * The Postgres client for this env object. `src/index.ts` hands each request its own env copy, so a client (and its sockets)
 * never outlives the request that opened it, as Workers require; Hyperdrive keeps the pool to Aiven.
 */
function client(env: Env): postgres.Sql {
  let sql = clients.get(env);
  if (!sql) {
    // ponytail: 3 sockets per request leaves room for the Valio and Gemini fetches under the Workers limit of 6 open connections
    sql = postgres(env.HYPERDRIVE.connectionString, {
      max: 3,
      fetch_types: false,
      idle_timeout: 10,
      types: { int8: { to: 20, from: [20, 1700], serialize: (x: number) => String(x), parse: (x: string) => Number(x) } },
    });
    clients.set(env, sql);
  }
  return sql;
}

/** Runs one statement on the client or inside a transaction and shapes the reply like D1's. */
async function exec(q: postgres.Sql | postgres.TransactionSql, s: Stmt): Promise<Result> {
  const rows = await q.unsafe(s.text, s.args as postgres.ParameterOrJSON<never>[]);
  return { results: [...rows], meta: { changes: rows.count } };
}

/**
 * The write store for a request. `batch` runs its statements in one transaction after taking the global write lock, which
 * gives Postgres the single-writer behaviour the D1 code was written for (no two ledger commits interleave).
 */
export function db(env: Env): Db {
  const sql = client(env);
  /** A statement with its (Postgres-numbered) text and bound arguments. */
  const stmt = (text: string, args: unknown[] = []): Stmt => ({
    text,
    args,
    bind: (...a: unknown[]) => stmt(text, a),
    first: async <T>() => ((await exec(sql, stmt(text, args))).results[0] as T | undefined) ?? null,
    all: async <T>() => ({ results: (await exec(sql, stmt(text, args))).results as T[] }),
    run: () => exec(sql, stmt(text, args)),
  });
  return {
    prepare: (q) => stmt(toPg(q)),
    // ponytail: one global lock, as D1 serialised every write; per (product, day) locks if commits ever queue
    batch: (stmts) =>
      sql.begin(async (tx) => {
        await tx.unsafe(`SELECT pg_advisory_xact_lock(${WRITE_LOCK})`);
        const out: Result[] = [];
        for (const s of stmts) out.push(await exec(tx, s));
        return out;
      }) as Promise<Result[]>,
  };
}

/** Creates the write tables when missing (safe to repeat). */
export async function ensureSchema(env: Env): Promise<void> {
  await client(env).unsafe(SCHEMA);
}

/** Which Postgres holds the writes: `aiven-postgres` when the server offers Aiven's `aiven_extras` extension, else `postgres`. */
export async function storeKind(env: Env): Promise<'aiven-postgres' | 'postgres'> {
  const r = await db(env).prepare("SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'aiven_extras') AS aiven").first<{ aiven: boolean }>();
  return r?.aiven ? 'aiven-postgres' : 'postgres';
}
