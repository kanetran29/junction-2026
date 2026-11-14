// Which of the door's newer routes this door has, so a feature shows only where it works: the OpenAPI document lists
// the routes (read once per page), and a plain GET tells whether one answers. Never throws.

const docs = {};

/** The door's OpenAPI paths at `base` (read once), or an empty list when the document cannot be read. */
export function openapiPaths(base, fetchImpl = fetch) {
  const url = `${String(base).replace(/\/+$/, "")}/openapi.json`;
  docs[url] ??= fetchImpl(url)
    .then((r) => (r.ok ? r.json() : null))
    .then((doc) => Object.keys(doc?.paths ?? {}))
    .catch(() => []);
  return docs[url];
}

/** True when the door at `base` lists a path that `pattern` (a string or a RegExp) matches. */
export async function hasRoute(base, pattern, fetchImpl = fetch) {
  const paths = await openapiPaths(base, fetchImpl);
  return paths.some((p) => (typeof pattern === "string" ? p === pattern : pattern.test(p)));
}

/** True when a GET of `path` on the door at `base` answers 200 (a missing route answers 404). */
export async function answers(base, path, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${String(base).replace(/\/+$/, "")}${path}`, { headers: { Accept: "application/json" } });
    return res.ok;
  } catch {
    return false;
  }
}
