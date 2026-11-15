// Builds the Inside tab from inside.mjs and proof.json with DOM calls only (text, never markup), then fills its four live
// tiles from the door. Called once when the tab first opens. Each section uses its own layout: a split hero, a flow track,
// three guardrail clusters, a bento of live tiles, display numerals with the agent-run video, logo groups, a closing split.
import { HERO, FLOW, FLOW_NOTE, FLOW_STILL, GUARDRAILS, GUARD_STILL, BUILT_WITH, PRODUCTION, CHECKS, COMMANDS, DOOR_URL, REPO_URL, runCheck } from "./inside.mjs";
import { ICONS } from "./icons.mjs";
import { AC_ID, acChip, acNote, labelAcChips, fillAcceptance, openCase } from "./acceptance-view.mjs";
import { mountWays } from "./ways.mjs";
import { mountModels } from "./models-view.mjs";

/** An element with a class and text. */
function el(tag, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** A link styled as a button or a plain link. */
function link(href, text, cls = "") {
  const a = el("a", cls, text);
  a.href = href;
  return a;
}

/** A Phosphor icon from icons.mjs as inline SVG (paths from the library, not drawn here). */
function icon(name, cls = "icon") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", cls);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

/** A figure with a still from the scene and its caption. */
function still({ src, alt, caption }, cls = "", eager = false) {
  const figure = el("figure", `still ${cls}`.trim());
  const img = el("img");
  Object.assign(img, { src, alt, width: 1600, height: 800, decoding: "async", loading: eager ? "eager" : "lazy" });
  figure.append(img);
  if (caption) figure.append(el("figcaption", "", caption));
  return figure;
}

/** Small chips, one per value. */
function chips(values, cls) {
  const span = el("span", "chips");
  for (const v of values) span.append(AC_ID.test(v) ? acChip(v, `chip ${cls}`) : el("span", `chip ${cls}`, v));
  return span;
}

/** A section with its heading. */
function section(id, title, ...children) {
  const s = el("section", `inside-section is-${id}`);
  s.dataset.section = id;
  if (title) s.append(el("h2", "", title));
  s.append(...children);
  return s;
}

/** The split hero: punchline, one sentence, two actions, and the held-order still. */
function hero(go) {
  const text = el("div", "hero-text");
  const watch = el("button", "btn btn-primary", "Watch the story");
  watch.type = "button";
  watch.addEventListener("click", () => go("story"));
  const tryIt = el("button", "btn btn-ghost", "Try it live");
  tryIt.type = "button";
  tryIt.addEventListener("click", () => go("live", "try-panel"));
  const actions = el("div", "hero-actions");
  actions.append(watch, tryIt);
  text.append(el("h1", "", HERO.punchline), el("p", "hero-sentence", HERO.sentence), actions);
  return section("hero", null, text, still(HERO.still, "hero-still", true));
}

/** The flow as one track: a line through seven nodes, a verb under each node and one line of detail. */
function flow() {
  const track = el("ol", "track");
  for (const f of FLOW) {
    const li = el("li");
    li.append(el("span", "node"), el("b", "", f.verb), el("span", "detail", f.detail));
    track.append(li);
  }
  const below = el("div", "flow-below");
  below.append(still(FLOW_STILL, "flow-still"), el("p", "flow-note", FLOW_NOTE));
  return section("flow", "How an order flows", track, below);
}

/** Guardrails in three clusters, each item one sentence with code chips and proof chips. */
function guardrails() {
  const grid = el("div", "clusters");
  for (const c of GUARDRAILS) {
    const cluster = el("div", "cluster");
    const list = el("ul");
    for (const item of c.items) {
      const li = el("li");
      const tags = el("div", "tags");
      tags.append(chips(item.codes, "code"), chips(item.proof, "proof"));
      li.append(el("p", "", item.text), tags);
      list.append(li);
    }
    cluster.append(el("h3", "", c.heading), list);
    grid.append(cluster);
  }
  return section("guardrails", "Guardrails, with evidence", still(GUARD_STILL, "guard-still"), acNote(), grid);
}

/** The four live tiles and the copyable commands; returns the section and a function that fills the tiles. */
function checks(base) {
  const bento = el("div", "bento");
  const tile = (id, title, cls = "") => {
    const t = el("article", `tile ${cls}`.trim());
    t.dataset.check = id;
    t.dataset.state = "loading";
    const value = el("p", "tile-value", "Checking");
    const text = el("p", "tile-text", "");
    t.append(el("h3", "", title), value, text);
    bento.append(t);
    return { t, value, text };
  };
  const tiles = { audit: tile("audit", "Audit chain", "tile-wide"), jwks: tile("jwks", "Signing key"), rules: tile("rules", "Rules and reason codes"), discovery: tile("discovery", "Discovery") };
  const commands = el("ul", "commands");
  for (const cmd of COMMANDS) {
    const li = el("li");
    const button = el("button", "btn btn-ghost btn-small", "Copy");
    button.type = "button";
    button.setAttribute("aria-label", `Copy: ${cmd}`);
    button.addEventListener("click", () => navigator.clipboard?.writeText(cmd).then(() => (button.textContent = "Copied"), () => {}));
    li.append(el("code", "", cmd), button);
    commands.append(li);
  }
  const links = el("p", "check-links");
  links.append(link(`${DOOR_URL}/openapi.json`, "OpenAPI document"), link(`${DOOR_URL}/.well-known/agent-gateway.json`, "Discovery document"));
  const s = section("checks", "Check it yourself, live", bento, commands, links);

  /** Adds the API catalog and llms.txt links, and the CORS line, once the door answers them. */
  const extras = async () => {
    const door = String(base).replace(/\/+$/, "");
    const answers = await Promise.all(OPTIONAL_LINKS.map((l) => fetch(`${door}${l.path}`).then((r) => r.ok, () => false)));
    OPTIONAL_LINKS.forEach((l, i) => answers[i] && links.append(link(`${DOOR_URL}${l.path}`, l.label)));
    const cors = await fetch(`${door}/.well-known/jwks.json`).then((r) => r.ok && r.headers.get("access-control-allow-origin"), () => null);
    if (cors) s.append(el("p", "check-cors", "Public GETs answer pages on any origin (CORS), so a check like these runs from your own page too."));
  };

  /** Puts one result into a tile. */
  const fill = ({ t, value, text }, out) => {
    t.dataset.state = out.state;
    value.replaceChildren();
    if (out.state === "ok") value.append(icon("check", "icon ok"));
    if (out.state === "bad") value.append(icon("cross", "icon bad"));
    value.append(document.createTextNode(out.value));
    text.textContent = out.text;
  };
  const run = async () => {
    const results = Object.fromEntries(await Promise.all(CHECKS.map(async (c) => [c.id, await runCheck(base, c)])));
    fill(tiles.audit, results.audit);
    fill(tiles.jwks, results.jwks);
    const r = results.rules;
    const c = results.codes;
    fill(tiles.rules, r.state === "ok" && c.state === "ok" ? { state: "ok", value: `${r.value}, ${c.value}`, text: r.text } : r.state === "ok" ? r : c);
    fill(tiles.discovery, results.discovery);
    await extras();
    if (results.discovery.list) {
      const details = el("details", "endpoints");
      const ul = el("ul");
      for (const url of results.discovery.list) ul.append(el("li", "", url));
      details.append(el("summary", "", "All endpoints"), ul);
      tiles.discovery.t.append(details);
    }
  };
  return { s, run };
}

/** Discovery documents the door may serve; each link shows only once it answers 200. */
const OPTIONAL_LINKS = [
  { path: "/.well-known/api-catalog", label: "API catalog (RFC 9727)" },
  { path: "/llms.txt", label: "llms.txt" },
];

/** Proof: display numerals from proof.json, the agent-run video with its poster, and the pitch link when there is one. */
function proof(data) {
  const numbers = el("dl", "numerals");
  for (const key of ["acceptance", "scenarios", "tests"]) {
    const p = data[key];
    if (!p) continue;
    const item = el("div", "numeral");
    item.dataset.key = key;
    const dd = el("dd", "", p.label);
    if (!p.confirmed) dd.append(el("span", "pending-tag", "pending final deploy"));
    item.append(el("dt", "", p.total ? `${p.passed}/${p.total}` : String(p.passed)), dd);
    numbers.append(item);
  }
  const video = el("video", "agent-run");
  Object.assign(video, { src: data.agentRun.src, poster: data.agentRun.poster ?? "", controls: true, preload: "none", playsInline: true });
  video.setAttribute("aria-label", data.agentRun.caption);
  const figure = el("figure", "agent-figure");
  figure.append(video, el("figcaption", "", data.agentRun.caption));
  const parts = [numbers, figure];
  if (data.pitchVideo?.url) {
    const p = el("p", "pitch-link");
    p.append(link(data.pitchVideo.url, data.pitchVideo.label));
    parts.push(p);
  }
  const s = section("proof", "Proof", ...parts);
  s.dataset.loaded = "";
  return s;
}

/**
 * Built with: three groups, each part its logos above its name and one line. Simple Icons marks (CC0) take the text
 * colour; official logos (Aiven, Gemma) are images, unmodified. The name says the same, so the logos are decorative.
 */
function builtWith() {
  const groups = el("div", "stack-groups");
  for (const g of BUILT_WITH) {
    const box = el("div", "stack-group");
    const ul = el("ul");
    for (const part of g.parts) {
      const li = el("li");
      const marks = el("span", "marks");
      marks.setAttribute("aria-hidden", "true");
      for (const m of part.marks) {
        if (m.image) {
          const img = el("img", "mark-img");
          Object.assign(img, { src: `assets/logos/${m.image}`, alt: "", decoding: "async" });
          marks.append(img);
        } else {
          const mark = el("span", "logo");
          mark.style.setProperty("--logo", `url("assets/logos/${m.icon}.svg")`);
          marks.append(mark);
        }
      }
      const words = el("div");
      words.append(el("b", "", part.name), el("span", "", part.line));
      li.append(marks, words);
      ul.append(li);
    }
    box.append(el("h3", "", g.group), ul);
    groups.append(box);
  }
  return section("stack", "Built with", groups);
}

/** The closing split: Monday's delivery and the path to production, with the links (the Deck one switches tabs). */
function production(go) {
  const text = el("div", "closing-text");
  const links = el("div", "closing-links");
  const deck = link("?mode=deck", "Deck", "btn btn-ghost");
  deck.addEventListener("click", (e) => {
    e.preventDefault();
    go("deck", "deck-page");
  });
  links.append(link(REPO_URL, "Code on GitHub", "btn btn-ghost"), link(DOOR_URL, "The live door", "btn btn-ghost"), deck);
  const mcp = el("p", "mcp-line");
  mcp.append(document.createTextNode("MCP endpoint: "), el("code", "", `${DOOR_URL}/mcp`));
  text.append(el("h2", "", "Path to production"), el("p", "closing-sentence", PRODUCTION.sentence), links, mcp);
  return section("production", null, still(PRODUCTION.still, "closing-still"), text);
}

/**
 * Builds every section into `root` and fills the live tiles from the door at `base`; `go(mode, anchor)` switches tabs
 * for the hero's two actions. A #ac-AC05 hash opens that acceptance case. Resolves once proof.json, the live checks and
 * acceptance.json have answered.
 */
export async function mountInside(root, base, go, proofUrl = "proof.json", modelsUrl = "models.json") {
  const live = checks(base);
  const proofSlot = section("proof", "Proof", el("p", "muted", "Loading the proof numbers."));
  const acSlot = section("acceptance", "Acceptance cases", el("p", "muted", "Loading the acceptance cases."));
  const waysSlot = section("ways", null);
  waysSlot.hidden = true;
  const modelsSlot = section("models", null);
  modelsSlot.hidden = true;
  root.replaceChildren(hero(go), flow(), modelsSlot, guardrails(), waysSlot, live.s, proofSlot, acSlot, builtWith(), production(go));
  const modelsLoad = mountModels(modelsSlot, modelsUrl);
  mountWays(waysSlot, base, go);
  labelAcChips(root);
  const smooth = () => !matchMedia("(prefers-reduced-motion: reduce)").matches;
  const acLoad = fillAcceptance(acSlot).then((ok) => ok && openCase(root, location.hash, false));
  window.addEventListener("hashchange", () => openCase(root, location.hash, smooth()));
  const proofLoad = fetch(proofUrl)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((data) => proofSlot.replaceWith(proof(data)))
    .catch(() => proofSlot.replaceChildren(el("h2", "", "Proof"), el("p", "muted", "The proof numbers could not be loaded.")));
  const modelsLine = Promise.all([modelsLoad, proofLoad]).then(([data]) => {
    if (data?.summary) root.querySelector('[data-section="proof"] .numerals')?.after(el("p", "proof-models", `Same sentence, ${data.models.length} models: ${data.summary}`));
  });
  await Promise.all([proofLoad, live.run(), acLoad, modelsLine]);
}
