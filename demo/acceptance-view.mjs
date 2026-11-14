// The acceptance cases on the site: AC chips that name their case and link to it in Inside, the one line that says what
// an AC is, and Inside's "Acceptance cases" section. Read from acceptance.json (demo/dev/acceptance.mjs, from
// research/acceptance/cases.json) and proof.json; DOM calls only (text, never markup).

export const AC_ID = /^AC\d{2,}$/;
export const SOURCE_URL = "https://github.com/kanetran29/junction-2026/blob/main/research/acceptance/cases.json";

/** The rubric groups in order, by each case's first rubric, with their headings. */
export const RUBRICS = [
  ["e2e", "End-to-end demo"],
  ["need", "The user's need"],
  ["controls", "Controls"],
  ["exceptions", "Exceptions"],
  ["openness", "Openness"],
];

const loaded = {};
/** A JSON file fetched once per page; null when it cannot be read. */
const once = (url) => (loaded[url] ??= fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));

/** An element with a class and text. */
function el(tag, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** An AC chip: a link to its case in Inside's "Acceptance cases"; labelAcChips names it once acceptance.json has loaded. */
export function acChip(id, cls = "chip proof") {
  const a = el("a", cls, id);
  a.href = `?mode=inside#ac-${id}`;
  a.dataset.ac = id;
  return a;
}

/** Gives every AC chip under `root` its title and aria-label, "AC05: <the case's title>". */
export async function labelAcChips(root, url = "acceptance.json") {
  const data = await once(url);
  const byId = new Map((data?.cases ?? []).map((c) => [c.id, c]));
  for (const a of root.querySelectorAll("a[data-ac]")) {
    const c = byId.get(a.dataset.ac);
    if (!c) continue;
    a.title = `${c.id}: ${c.title}`;
    a.setAttribute("aria-label", a.title);
  }
}

/** The line that says what an AC is, placed before the first chips on a page; the pass count joins once it is measured. */
export function acNote(proofUrl = "proof.json") {
  const p = el("p", "ac-note", "AC = acceptance case: an automated end-to-end check run on the deployed door.");
  once(proofUrl).then((proof) => {
    const a = proof?.acceptance;
    if (a?.confirmed && Number.isFinite(a.passed) && Number.isFinite(a.total)) p.append(` ${a.passed}/${a.total} pass.`);
  });
  return p;
}

/** One case: its id, title and pass mark, then the API calls it makes and how many checks it runs. */
function caseItem(c) {
  const li = el("li", "ac-case");
  li.id = `ac-${c.id}`;
  const head = el("p", "ac-head");
  head.append(el("span", "ac-id", c.id), el("span", "ac-title", c.title));
  if (c.pass === true) head.append(el("span", "ac-pass", "✓ passed"));
  if (c.pass === false) head.append(el("span", "ac-pass ac-fail", "✕ failed"));
  const meta = el("p", "ac-meta");
  for (const call of c.calls) meta.append(el("span", "chip call", call));
  meta.append(el("span", "ac-checks", `${c.checks} ${c.checks === 1 ? "check" : "checks"}`));
  li.append(head, meta);
  return li;
}

/** The section's content: what a case is, the last run, one closed group per rubric with its count, and the source. */
export function acceptanceNodes(data) {
  const run = data.run;
  const runLine = run
    ? `Last run: ${run.passed}/${run.total} passed${run.date ? ` on ${run.date}` : ""}${run.version ? `, door version ${String(run.version).slice(0, 8)}` : ""}.`
    : "Last run: not yet measured.";
  const groups = el("div", "ac-groups");
  for (const [key, heading] of RUBRICS) {
    const cases = data.cases.filter((c) => c.rubric[0] === key);
    if (!cases.length) continue;
    const details = el("details", "ac-group");
    details.dataset.rubric = key;
    const summary = el("summary");
    summary.append(el("span", "ac-group-name", heading), el("span", "ac-count", `${cases.length} cases`));
    const list = el("ol", "ac-cases");
    list.append(...cases.map(caseItem));
    details.append(summary, list);
    groups.append(details);
  }
  const source = el("p", "ac-source");
  const a = el("a", "", "research/acceptance/cases.json on GitHub");
  a.href = SOURCE_URL;
  source.append("Every case, step by step: ", a);
  return [el("p", "ac-lede", `${data.cases.length} cases call the deployed door's API the way an agent would and check every answer.`), el("p", "ac-run", runLine), groups, source];
}

/** Loads acceptance.json into Inside's section `slot` (its heading stays); resolves to false when it cannot be read. */
export async function fillAcceptance(slot, url = "acceptance.json") {
  const data = await once(url);
  const heading = slot.querySelector("h2");
  if (!data?.cases?.length) {
    slot.replaceChildren(heading, el("p", "muted", "The acceptance cases could not be loaded."));
    return false;
  }
  slot.replaceChildren(heading, ...acceptanceNodes(data));
  slot.dataset.loaded = "";
  return true;
}

/** Opens the group of the case `hash` names (#ac-AC05), marks the case and scrolls to it; false when there is no such case. */
export function openCase(root, hash, smooth = true) {
  const m = /^#ac-(AC\d{2,})$/.exec(hash ?? "");
  const li = m && root.querySelector(`#ac-${m[1]}`);
  if (!li) return false;
  li.closest("details").open = true;
  root.querySelectorAll(".ac-case[data-highlight]").forEach((x) => delete x.dataset.highlight);
  li.dataset.highlight = "";
  requestAnimationFrame(() => li.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "center" }));
  return true;
}
