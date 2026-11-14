// Writes demo/acceptance.json from research/acceptance/cases.json, for the site's AC chips and Inside's "Acceptance cases":
// per case its id, title, rubric, the API calls it makes and how many checks it runs; plus the last run on the deployed
// door (passed, total, version, date) when a run file is given. Nothing else from the cases (no inputs, no product data).
// Usage: node demo/dev/acceptance.mjs [last-run.json]   (default ~/junction-2026/.data/acceptance-last-run.json when it exists)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SOURCE = `${ROOT}research/acceptance/cases.json`;
const OUT = `${ROOT}demo/acceptance.json`;

/** "controls 20" (a rubric key and its judging weight) as "controls". */
const rubricKey = (r) => String(r).split(/\s+/)[0];

/**
 * Whether case `id` passed in `run`: from its per-case results when the run lists them (an array of { id, ok|pass|passed }
 * or an { id: boolean } map), else true for every case when the whole run passed; null when unknown.
 */
function passedIn(run, id) {
  if (!run) return null;
  const results = run.results ?? run.cases;
  if (Array.isArray(results)) {
    const r = results.find((x) => x?.id === id);
    const v = r?.ok ?? r?.pass ?? r?.passed;
    return typeof v === "boolean" ? v : null;
  }
  if (results && typeof results === "object" && typeof results[id] === "boolean") return results[id];
  return Number.isFinite(run.passed) && Number.isFinite(run.total) && run.passed === run.total ? true : null;
}

/** The public summary of the acceptance cases in `source` (cases.json), with the run's numbers when `run` is given. */
export function buildAcceptance(source, run = null) {
  const cases = source.cases.map((c) => {
    const steps = c.steps ?? [];
    const pass = passedIn(run, c.id);
    return {
      id: c.id,
      title: c.title,
      rubric: (c.rubric ?? []).map(rubricKey),
      calls: [...new Set(steps.map((s) => s.call).filter(Boolean))],
      checks: steps.reduce((n, s) => n + (s.expect?.length ?? 0), 0),
      ...(pass === null ? {} : { pass }),
    };
  });
  const total = Number.isFinite(run?.total) ? run.total : cases.length;
  const measured = run && Number.isFinite(run.passed) ? { passed: run.passed, total, version: run.version ?? null, date: run.date ?? null } : null;
  return { source: "research/acceptance/cases.json", run: measured, cases };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runPath = process.argv[2] ?? `${homedir()}/junction-2026/.data/acceptance-last-run.json`;
  const run = existsSync(runPath) ? JSON.parse(readFileSync(runPath, "utf8")) : null;
  const out = buildAcceptance(JSON.parse(readFileSync(SOURCE, "utf8")), run);
  writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`acceptance.json: ${out.cases.length} cases, ${out.run ? `run ${out.run.passed}/${out.run.total}` : "no run yet (not yet measured)"}`);
}
