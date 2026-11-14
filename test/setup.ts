import { applyD1Migrations } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { D1Migration } from '@cloudflare/vitest-pool-workers';
import { db, ensureSchema, TABLES } from '../src/db';
import type { Env } from '../src/env';

const e = env as unknown as Env;
await applyD1Migrations(e.DB, (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS);
await ensureSchema(e);
await db(e).prepare(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY`).run();
