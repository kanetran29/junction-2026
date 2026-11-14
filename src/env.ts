/** Worker bindings and secrets; secrets come from `.dev.vars` locally and `wrangler secret` when deployed. */
export interface Bindings {
  /** The read-only catalog (products, GTINs, category names, recorded Valio replies). */
  DB: D1Database;
  /** Hyperdrive in front of Aiven PostgreSQL: every table the door writes (see `src/db.ts`). */
  HYPERDRIVE: Hyperdrive;
  /** The demo page's static files (`dist/assets/demo/`, built by `scripts/build-demo.mjs`), served under `/demo/`. */
  ASSETS: Fetcher;
  VALIO_API_BASE: string;
  DEMO_MODE: string;
  GEMINI_MODEL: string;
  /** The second, independent reader of a request (a Gemma model on the same Gemini API key). */
  GEMMA_MODEL: string;
  VALIO_API_KEY: string;
  ADMIN_KEY: string;
  GEMINI_API_KEY?: string;
  /** The door's private Ed25519 JWK (JSON); signs quote offers, receipts and the audit head. Public half at `/.well-known/jwks.json`. */
  DOOR_SIGNING_JWK: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}
export type Env = Bindings;
