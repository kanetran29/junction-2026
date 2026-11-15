import { generateKeyPairSync } from 'node:crypto';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Runs every test under test/ in workerd with a real D1 (catalog) and the local Postgres behind the Hyperdrive binding
 * (writes; `localConnectionString` in wrangler.jsonc). The D1 migrations are read here (Node) and applied per test file by
 * test/setup.ts, which also empties the Postgres tables. The files share one Postgres, so they run one at a time.
 */
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  // a fresh door signing key per test run, so no key is ever stored for tests
  const doorKey = JSON.stringify(generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' }));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        // TEST_PG_URL points a worktree's tests at its own database, so parallel runs never wipe each other's tables
        miniflare: { bindings: { TEST_MIGRATIONS: migrations, DOOR_SIGNING_JWK: doorKey }, ...(process.env.TEST_PG_URL ? { hyperdrives: { HYPERDRIVE: process.env.TEST_PG_URL } } : {}) },
      }),
    ],
    test: {
      include: ['test/**/*.test.ts'],
      setupFiles: ['./test/setup.ts'],
      fileParallelism: false,
    },
  };
});
