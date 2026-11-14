// Builds the Inside tab from inside.mjs and proof.json with DOM calls only (text, never markup), then fills its live
// checks from the door. Called once when the tab first opens.
import { WHAT, FLOW, FLOW_NOTE, GUARDRAILS, BUILT_WITH, PRODUCTION, CHECKS, COMMANDS, DOOR_URL, REPO_URL, runCheck } from "./inside.mjs";

/** An element with a class and text. */
function el(tag, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** A link that opens in the same tab. */
function link(href, text) {
  const a = el("a", "", text);
  a.href = href;
  return a;
}

/** One numbered section with its heading. */
function section(n, title, ...children) {
  const s = el("section", "inside-section");
  s.dataset.section = String(n);
  s.append(el("h2", "", title), ...children);
  return s;
}

/** A list of label/value rows as a definition list. */
function rows(items, label, value) {
  const dl = el("dl", "inside-rows");
  for (const item of items) dl.append(el("dt", "", item[label]), el("dd", "", item[value]));
  return dl;
}

/** The proof numbers from proof.json, each marked pending until confirmed on the deployed door. */
function proofNumbers(proof) {
  const ul = el("ul", "proof-numbers");
  for (const key of ["acceptance", "scenarios", "tests"]) {
    const p = proof[key];
    if (!p) continue;
    const li = el("li");
    li.dataset.key = key;
    li.append(el("b", "", p.total ? `${p.passed} / ${p.total}` : String(p.passed)), el("span", "", ` ${p.label}`));
    if (!p.confirmed) li.append(el("span", "pending-tag", "pending final deploy"));
    ul.append(li);
  }
  return ul;
}

/**
 * Builds every section into `root`: what it is, the flow, guardrails, live checks (filled from `base`), proof, the
 * stack, and the path to production with links. Returns a promise that settles when the live checks have answered.
 */
export async function mountInside(root, base, proofUrl = "proof.json") {
  const what = section(1, "What it is", el("p", "punchline", WHAT.punchline), ...WHAT.lines.map((line) => el("p", "lede", line)));

  const flow = el("ol", "flow");
  for (const f of FLOW) {
    const li = el("li");
    li.append(el("b", "", f.step), el("span", "", f.text));
    flow.append(li);
  }
  const how = section(2, "How an order flows", flow, el("p", "flow-note", FLOW_NOTE));

  const table = el("table", "guard-table");
  const head = el("tr");
  for (const h of ["Guardrail", "Code", "Proof"]) {
    const th = el("th", "", h);
    th.scope = "col";
    head.append(th);
  }
  const thead = el("thead");
  thead.append(head);
  const tbody = el("tbody");
  for (const g of GUARDRAILS) {
    const tr = el("tr");
    const name = el("th", "", g.what);
    name.scope = "row";
    const code = el("td", "code", g.code);
    code.dataset.label = "Code";
    const proofCell = el("td", "proof", g.proof);
    proofCell.dataset.label = "Proof";
    tr.append(name, code, proofCell);
    tbody.append(tr);
  }
  table.append(thead, tbody);
  const guards = section(3, "Guardrails, with evidence", table);

  const checks = el("ul", "live-checks");
  const slots = CHECKS.map((check) => {
    const li = el("li");
    li.dataset.check = check.id;
    li.dataset.state = "loading";
    const result = el("span", "check-result", "Checking…");
    li.append(el("b", "", check.title), el("code", "", check.path), result);
    checks.append(li);
    return { check, li, result };
  });
  const links = el("p", "check-links");
  links.append(link(`${DOOR_URL}/openapi.json`, "/openapi.json"), document.createTextNode(" · MCP at "), el("code", "", `${DOOR_URL}/mcp`));
  const commands = el("ul", "commands");
  for (const cmd of COMMANDS) {
    const li = el("li");
    const button = el("button", "copy", "Copy");
    button.type = "button";
    button.addEventListener("click", () => navigator.clipboard?.writeText(cmd).then(() => (button.textContent = "Copied"), () => {}));
    li.append(el("code", "", cmd), button);
    commands.append(li);
  }
  const live = section(4, "Check it yourself, live", el("p", "lede", "Read from the door when this tab opens:"), checks, links, commands);

  const proofBody = el("div", "proof-body");
  const proof = section(5, "Proof", proofBody);

  const built = section(6, "Built with", rows(BUILT_WITH, "part", "does"));

  const linksP = el("p", "inside-links");
  linksP.append(link(REPO_URL, "Code on GitHub"), document.createTextNode(" · "), link(DOOR_URL, "The door"), document.createTextNode(" · MCP: "), el("code", "", `${DOOR_URL}/mcp`));
  const production = section(7, "Path to production", el("p", "lede", PRODUCTION), linksP);

  root.replaceChildren(what, how, guards, live, proof, built, production);

  const proofLoad = fetch(proofUrl)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((data) => {
      const video = el("video", "agent-run");
      video.src = data.agentRun.src;
      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;
      const figure = el("figure", "agent-figure");
      figure.append(video, el("figcaption", "", data.agentRun.caption));
      const pitch = el("p", "pitch-link");
      if (data.pitchVideo?.url) pitch.append(link(data.pitchVideo.url, data.pitchVideo.label));
      else pitch.textContent = `${data.pitchVideo?.label ?? "The pitch video"}: the link comes once it is uploaded.`;
      proofBody.replaceChildren(proofNumbers(data), figure, pitch);
      proofBody.dataset.loaded = "";
    })
    .catch(() => proofBody.replaceChildren(el("p", "lede", "The proof numbers could not be loaded.")));

  const liveLoad = Promise.all(slots.map(async ({ check, li, result }) => {
    const out = await runCheck(base, check);
    li.dataset.state = out.state;
    result.textContent = out.text;
    if (out.list) {
      const ul = el("ul", "endpoint-list");
      for (const url of out.list) ul.append(el("li", "", url));
      li.append(ul);
    }
  }));
  await Promise.all([proofLoad, liveLoad]);
}
