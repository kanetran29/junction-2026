/** Worker bindings and secrets; secrets come from `.dev.vars` locally and `wrangler secret` when deployed. */
export interface Bindings {
  /** The read-only catalog (products, GTINs, category names, recorded Valio replies). */
  DB: D1Database;
  /** Hyperdrive in front of Aiven PostgreSQL: every table the door writes (see `src/db.ts`). */
  HYPERDRIVE: Hyperdrive;
  VALIO_API_BASE: string;
  DEMO_MODE: string;
  GEMINI_MODEL: string;
  VALIO_API_KEY: string;
  ADMIN_KEY: string;
  GEMINI_API_KEY?: string;
}

declare global {
  namespace Cloudflare {
    interface Env extends Bindings {}
  }
}
export type Env = Bindings;
