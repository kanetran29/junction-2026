#!/usr/bin/env node
// End-to-end check of the Claude connector with the official MCP TypeScript client, the way Claude connects: /mcp answers
// 401 with WWW-Authenticate, the client reads the protected-resource and authorization-server metadata, registers itself,
// sends the person to the consent page with PKCE S256 (this script answers it as the person would), exchanges the code and
// calls the tools. It then quotes and places a 1,000-litre order (HELD: over the 500 € limit), checks the connector token is
// 403 on the approval, and approves from the person's kitchen link. Prints statuses only, never a token, code or key.
// Door: GATEWAY_URL, default the deployed door. The connector feature must be on.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const door = (process.env.GATEWAY_URL ?? 'https://lazydoor.lazydoor.workers.dev').replace(/\/$/, '');
// a loopback redirect, as a native client registers; nothing listens on it, the script reads the code from the page instead
const REDIRECT = 'http://localhost:53682/callback';
const state = {};
const checks = [];

/** Records one named check and prints it. */
function check(name, ok, detail = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

/** The MCP client's OAuth storage, in memory: what Claude keeps for a connector. */
const provider = {
  get redirectUrl() {
    return REDIRECT;
  },
  get clientMetadata() {
    return { client_name: 'Lazydoor e2e (MCP SDK)', redirect_uris: [REDIRECT], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  },
  clientInformation: () => state.client,
  saveClientInformation: (c) => void (state.client = c),
  tokens: () => state.tokens,
  saveTokens: (t) => void (state.tokens = t),
  redirectToAuthorization: (url) => void (state.authUrl = url),
  saveCodeVerifier: (v) => void (state.verifier = v),
  codeVerifier: () => state.verifier,
};

const plain = await fetch(`${door}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
check('/mcp without a token is 401 with a resource_metadata challenge', plain.status === 401 && /resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/mcp"/.test(plain.headers.get('WWW-Authenticate') ?? ''), String(plain.status));

const client = new Client({ name: 'lazydoor-e2e', version: '1.0.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(`${door}/mcp`), { authProvider: provider }));
} catch (err) {
  if (!(err instanceof UnauthorizedError)) throw err;
}
check('the SDK discovered the metadata, registered and built an authorization URL', Boolean(state.authUrl && state.client?.client_id && state.verifier));
const params = state.authUrl.searchParams;
check('the authorization request uses PKCE S256 and names /mcp as the resource', params.get('code_challenge_method') === 'S256' && params.get('resource') === `${door}/mcp`, `resource ${params.get('resource')}`);

const consent = await fetch(state.authUrl);
const html = await consent.text();
const cookie = (consent.headers.get('set-cookie') ?? '').split(';')[0];
const field = (name) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? '';
check('the consent page shows the client and the 500 € limit, and cannot be framed', consent.status === 200 && html.includes('Lazydoor e2e') && html.includes('500 €') && (consent.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'"));
const allowed = await fetch(`${door}/oauth/authorize`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie }, body: new URLSearchParams({ request: field('request'), csrf: field('csrf'), decision: 'allow' }) });
const ready = await allowed.text();
const back = new URL((/href="(http:\/\/localhost[^"]+)"/.exec(ready)?.[1] ?? 'http://x/').replaceAll('&amp;', '&'));
const kitchen = /href="(\/approver\/[^"]+)"/.exec(ready)?.[1];
check('Allow shows the kitchen link and a way back with code, state and iss', allowed.status === 200 && Boolean(kitchen) && Boolean(back.searchParams.get('code')) && back.searchParams.get('iss') === door);

const transport = new StreamableHTTPClientTransport(new URL(`${door}/mcp`), { authProvider: provider });
await transport.finishAuth(back.searchParams.get('code'));
check('the code exchange gave an access and a refresh token', Boolean(state.tokens?.access_token && state.tokens?.refresh_token) && state.tokens?.token_type?.toLowerCase() === 'bearer');
await client.connect(transport);
const { tools } = await client.listTools();
check('tools/list over the connector', tools.some((t) => t.name === 'place_order'), `${tools.length} tools`);

const quote = (await client.callTool({ name: 'get_quote', arguments: { draft: { category: '10400', claims: ['FREE_FROM_LACTOSE'], quantity: { value: 1000, unit: 'l' }, deliverBy: '2026-11-16' } } })).structuredContent;
check('get_quote returns offers', Boolean(quote?.offers?.length), `${quote?.offers?.length ?? 0} offers`);
const placed = await client.callTool({ name: 'place_order', arguments: { quoteId: quote.id, offerId: quote.offers[0].offerId, quoteJws: quote.offers[0].jws, idempotencyKey: crypto.randomUUID(), agentReason: 'e2e: cheapest lactose-free milk' } });
const order = placed.structuredContent;
check('place_order over 500 € is HELD for "You (kitchen manager)"', order?.state === 'HELD' && order?.approval?.approver === 'You (kitchen manager)', order?.state);
check('the MCP result carries no approval link or token', !/approve\/|approval_token|"token"/.test(JSON.stringify(placed)));

const inbox = await (await fetch(`${door}${kitchen}`, { headers: { Accept: 'application/json' } })).json();
const pending = inbox.pending?.find((p) => p.orderId === order?.orderId);
check("the kitchen link lists the held order", Boolean(pending));
const bearer = { Authorization: `Bearer ${state.tokens.access_token}`, Accept: 'application/json' };
const agentTry = await fetch(pending.url, { method: 'POST', headers: bearer });
check('the connector token cannot approve (403)', agentTry.status === 403, String(agentTry.status));
const rest = await fetch(`${door}/v1/orders/${order.orderId}`, { headers: bearer });
check('the connector token is not an API key on /v1 (401)', rest.status === 401, String(rest.status));
const human = await fetch(pending.url, { method: 'POST', headers: { Accept: 'application/json' } });
const decided = await human.json();
check('the person approves from the kitchen link', human.status === 200 && decided.state === 'ACCEPTED', decided.state ?? decided.error);
await client.close();

console.log(`${checks.filter(Boolean).length}/${checks.length} passed`);
process.exit(checks.every(Boolean) ? 0 : 1);
