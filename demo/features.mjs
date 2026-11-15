// Which of the door's newer features this door has switched on, so each shows only where it works. Never throws.
//   voice: the discovery document (/.well-known/agent-gateway.json) lists tryIt.voice only while the flag is on;
//   Peppol: with the flag off the route itself is absent (404 NOT_FOUND), so one GET of a made-up order tells.

const seen = {};
/** A value computed once per page and key. */
const once = (key, make) => (seen[key] ??= make());
const trim = (base) => String(base).replace(/\/+$/, "");

/** The door's discovery document at `base`, or null when it cannot be read. */
export const discovery = (base, fetchImpl = fetch) =>
  once(`discovery ${trim(base)}`, () => fetchImpl(`${trim(base)}/.well-known/agent-gateway.json`, { headers: { Accept: "application/json" } }).then((r) => (r.ok ? r.json() : null)).catch(() => null));

/** True while the door's voice flag is on. */
export const voiceOn = async (base, fetchImpl = fetch) => Boolean((await discovery(base, fetchImpl))?.tryIt?.voice);

/** True while the door's Peppol flag is on: a made-up order answers anything but a plain 404 NOT_FOUND. */
export const peppolOn = (base, fetchImpl = fetch) =>
  once(`peppol ${trim(base)}`, async () => {
    try {
      const res = await fetchImpl(`${trim(base)}/v1/orders/peppol-probe/peppol`, { headers: { Accept: "application/json" } });
      const body = await res.json().catch(() => null);
      return !(res.status === 404 && (body?.error ?? "NOT_FOUND") === "NOT_FOUND");
    } catch {
      return false;
    }
  });

/** True when a GET of `path` on the door at `base` answers 200 (a missing route answers 404). */
export async function answers(base, path, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${trim(base)}${path}`, { headers: { Accept: "application/json" } });
    return res.ok;
  } catch {
    return false;
  }
}
