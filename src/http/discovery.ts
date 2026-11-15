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
    apiCatalog: `${origin}/.well-known/api-catalog`,
    llms: `${origin}/llms.txt`,
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
    cancellation: {
      http: 'POST /v1/orders/{id}/cancel',
      mcp: 'cancel_order',
      rule: "An agent cancels its own ACCEPTED or HELD order until Valio's cut-off: the stock goes back on sale and the day total no longer counts it; after the cut-off it is 409 ORDER_CUTOFF_PASSED. The reply is a signed cancellation record; a repeat returns the same one.",
    },
    jwks: `${origin}/.well-known/jwks.json`,
    signing: { alg: 'EdDSA', quoteOffers: AUD.quote, receipts: AUD.receipt, cancellations: AUD.cancellation, audit: AUD.audit },
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

/** The RFC 9727 API catalog of the door as an RFC 9264 linkset: the OpenAPI description, the discovery document, the agent guide and the health check. */
export function apiCatalog(origin: string) {
  return {
    linkset: [
      {
        anchor: `${origin}/`,
        'service-desc': [{ href: `${origin}/openapi.json`, type: 'application/vnd.oai.openapi+json' }],
        'service-meta': [{ href: `${origin}/.well-known/agent-gateway.json`, type: 'application/json' }],
        'service-doc': [{ href: `${origin}/llms.txt`, type: 'text/markdown' }],
        status: [{ href: `${origin}/health`, type: 'application/json' }],
      },
    ],
  };
}

/** `/llms.txt`: what the door is, its rules in one paragraph, how to connect (the Claude connector only while it is on) and where to check it. */
export function llmsTxt(origin: string, connector: boolean): string {
  return [
    '# Lazydoor',
    '',
    "> Lazy at the order, strict at the border. A trusted ordering door in front of Valio Aimo's catalogue, price and availability: any agent can quote and order through it; the buyer's signed mandate and a named human approver decide what goes through.",
    '',
    '## Rules',
    '',
    "Quotes use Valio's live price and stock and every offer is signed by the door (EdDSA). The buyer's signed mandate decides each order, never a model: within the automatic limits it is ACCEPTED and takes stock first come, first served; over them it is HELD for the named human approver; over the hard limits it is REJECTED. Agents cannot approve: an agent key on an approval link is 403 AGENT_CANNOT_APPROVE. An agent can cancel its own accepted or held order until Valio's cut-off and gets a signed cancellation record. Every refusal carries a reason code, every final order a signed receipt, and every event joins one hash chain.",
    '',
    '## Connect',
    '',
    `- HTTP API: ${origin}/openapi.json, with \`Authorization: Bearer <agent key>\`. Keys never go in a query string.`,
    `- MCP (streamable HTTP, stateless): ${origin}/mcp, the same tools and schemas as the HTTP API.`,
    ...(connector ? [`- Claude connector: add a custom connector with the URL ${origin}/mcp; OAuth 2.1 opens a sandbox kitchen with you as its approver.`] : []),
    `- Discovery: ${origin}/.well-known/agent-gateway.json and ${origin}/.well-known/api-catalog`,
    '',
    '## Check',
    '',
    `- [Decision rules](${origin}/v1/rules)`,
    `- [Reason codes](${origin}/v1/reason-codes)`,
    `- [Signing keys](${origin}/.well-known/jwks.json)`,
    `- [Audit chain](${origin}/v1/audit/verify)`,
    '',
  ].join('\n');
}
