import { AUD } from '../sign/door';

/** The door's API version, shown in `/openapi.json` and the discovery document. */
export const VERSION = '0.1.0';

/** Where the code lives; the demo page and the discovery document link it. */
export const REPOSITORY = 'https://github.com/kanetran29/junction-2026';

/**
 * The discovery document served at `/.well-known/agent-gateway.json`: everything an agent or a judge needs to find and check
 * the door (API, MCP, rules, reason codes, events, audit, signing keys, approval model, demo page, code, and Try it on a demo
 * door: `demo`), as absolute URLs on the origin it was requested from. Each feature that is switched off (`on`) is left out:
 * Try it's `voice` route, the connector's OAuth metadata under `mcp.oauth`, and the `peppol` export.
 */
export function discovery(origin: string, demo: boolean, on: { voice?: boolean; connector?: boolean; peppol?: boolean } = {}) {
  const { voice = false, connector = false, peppol = false } = on;
  return {
    name: 'Lazydoor',
    punchline: 'Lazy at the order, strict at the border.',
    description:
      "A trusted ordering door in front of Valio Aimo's catalogue, price and availability: any agent can quote and order through it; the buyer's signed mandate and a named human approver decide what goes through.",
    version: VERSION,
    openapi: `${origin}/openapi.json`,
    mcp: {
      url: `${origin}/mcp`,
      transport: 'streamable-http',
      auth: connector ? 'Authorization: Bearer <agent key>, or OAuth 2.1 (a connector token, for its own sandbox kitchen)' : 'Authorization: Bearer <agent key>',
      note: 'POST JSON-RPC; stateless; same tools and schemas as the HTTP API',
      ...(connector
        ? {
            oauth: {
              protectedResource: `${origin}/.well-known/oauth-protected-resource/mcp`,
              authorizationServer: `${origin}/.well-known/oauth-authorization-server`,
              claude: `Claude: Settings, Connectors, Add custom connector, URL ${origin}/mcp; the consent page opens a sandbox kitchen (500 € an order and 1,500 € a day automatically) with you as its approver; the agent can never approve`,
            },
          }
        : {}),
    },
    auth: { scheme: 'bearer', keys: 'one agent key per buyer, issued by the door operator; keys never go in a query string' },
    health: `${origin}/health`,
    rules: `${origin}/v1/rules`,
    reasonCodes: `${origin}/v1/reason-codes`,
    events: { poll: `${origin}/v1/events`, stream: `${origin}/v1/events/stream`, auth: 'an agent key reads its own buyer, a judge key every buyer; a demo door (DEMO_MODE=1) also answers with no key' },
    audit: { verify: `${origin}/v1/audit/verify`, chain: 'hash = sha256(prevHash + RFC 8785 canonical JSON of the event without prevHash and hash), from 64 zeros after a reset' },
    ...(peppol
      ? {
          peppol: {
      export: 'GET /v1/orders/{id}/peppol',
      approver: 'GET /approve/{token}/peppol',
      format: 'Peppol BIS Order 3.0 (UBL 2.1 Order, "Order only"), application/xml',
      auth: 'an agent or judge key for your own order; a Try it visitor sends X-Visitor-Token for their own sandbox order; the approval token for the approver route',
      note: 'feature flag peppol (off by default, then 404); export only, no access point, nothing is sent; an order that is not ACCEPTED is 409 ORDER_NOT_ACCEPTED',
          },
        }
      : {}),
    jwks: `${origin}/.well-known/jwks.json`,
    signing: { alg: 'EdDSA', quoteOffers: AUD.quote, receipts: AUD.receipt, audit: AUD.audit },
    approval: {
      agentCanApprove: false,
      rule: "An order over the buyer's signed limits is HELD; only the named human approver accepts it, through their own link. Agent and judge keys get 403 AGENT_CANNOT_APPROVE.",
    },
    ...(demo
      ? {
          tryIt: {
            url: `${origin}/v1/try`,
            decision: `${origin}/v1/try/decision`,
            ...(voice ? { voice: `${origin}/v1/try/voice` } : {}),
            demoOnly: true,
            auth: 'none',
            note: "POST; a visitor orders as the chef of a sandbox kitchen (its own stock world) and approves its held orders as that kitchen's manager; example sentences use recorded readings; 3 calls a minute per visitor, 60 per address, 6 free-text tries a minute for everyone",
          },
        }
      : {}),
    demo: `${origin}/demo/`,
    repository: REPOSITORY,
  };
}
