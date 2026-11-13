/** Worker bindings and secrets; secrets come from `.dev.vars` locally and `wrangler secret` when deployed. */
export interface Bindings {
  DB: D1Database;
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
