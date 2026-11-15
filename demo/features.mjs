// Which of the door's newer features are live, from what the door itself advertises in its discovery document
// (/.well-known/agent-gateway.json): tryIt.voice, peppol, and mcp.oauth for the Claude connector. Each appears there only
// while its flag is on, so nothing half-built shows on the page. Read once per page; never throws.

const seen = {};
const trim = (base) => String(base).replace(/\/+$/, "");

/** The door's discovery document at `base`, or null when it cannot be read. */
export const discovery = (base, fetchImpl = fetch) =>
  (seen[trim(base)] ??= fetchImpl(`${trim(base)}/.well-known/agent-gateway.json`, { headers: { Accept: "application/json" } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null));

/** The live features: { voice, peppol, connector }, each true only while the door advertises it. */
export async function featuresOn(base, fetchImpl = fetch) {
  const d = await discovery(base, fetchImpl);
  return { voice: Boolean(d?.tryIt?.voice), peppol: Boolean(d?.peppol), connector: Boolean(d?.mcp?.oauth) };
}

export const voiceOn = async (base, fetchImpl = fetch) => (await featuresOn(base, fetchImpl)).voice;
export const peppolOn = async (base, fetchImpl = fetch) => (await featuresOn(base, fetchImpl)).peppol;
export const connectorOn = async (base, fetchImpl = fetch) => (await featuresOn(base, fetchImpl)).connector;
