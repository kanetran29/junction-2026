// Builds the pitch deck from pitch.json: every heading, bullet and note comes from that file; the visuals are the demo's
// stills, real screenshots of the deployed demo (deck/shots, from capture.mjs) and one architecture diagram.
// Usage: node deck/build.mjs <pitch.json> <out dir>   writes deck/index.html, <out>/deck.pdf, <out>/slides/NN.png, <out>/notes.md.
// PLAYWRIGHT_CORE and CHROME as for demo/dev/label-overlap.mjs. One browser, closed at the end.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [pitchPath, out] = process.argv.slice(2);
if (!pitchPath || !out) throw new Error("usage: node deck/build.mjs <pitch.json> <out dir>");
const pitch = JSON.parse(readFileSync(pitchPath, "utf8"));
const slide = Object.fromEntries(pitch.slides.map((s) => [s.id, s]));

/** Text made safe for HTML. */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One bullet as HTML: the words before the first colon in bold, paths and reason codes in mono. */
function point(text) {
  const mono = (s) => esc(s).replace(/(\/[\w.\-/{}]+|[A-Z][A-Z0-9]*_[A-Z0-9_]+)/g, "<code>$1</code>");
  const at = text.indexOf(": ");
  if (at > 0 && at <= 32) return `<b>${mono(text.slice(0, at))}:</b> ${mono(text.slice(at + 2))}`;
  return mono(text);
}

/** The bullets of a slide as a list; `cls` picks the layout (a column, a row of columns or a grid). */
const points = (bullets, cls = "points") => `<ul class="${cls}">${bullets.map((b) => `<li>${point(b)}</li>`).join("")}</ul>`;

/** A real image (still or screenshot) in the deck's frame. */
const shot = (src, alt, cls = "") => `<figure class="shot ${cls}"><img src="${src}" alt="${esc(alt)}"></figure>`;

/** A Simple Icons logo (CC0, vendored in demo/assets/logos) inlined so it takes the text colour. */
const logo = (name) => readFileSync(join(ROOT, "demo/assets/logos", `${name}.svg`), "utf8").replace(/<title>.*?<\/title>/, "").replace("<svg ", '<svg class="logo" aria-hidden="true" ');

const STILL = "../demo/assets/stills";

/** An official logo (Aiven, Gemma) from demo/assets/logos, shown unmodified as an image; see its NOTICE.md. */
const mark = (file, cls = "mark") => `<img class="${cls}" src="../demo/assets/logos/${file}" alt="">`;
const h1 = (id) => `<h1>${esc(slide[id].heading)}</h1>`;

/** Each slide's own layout, keyed by its id in pitch.json. */
const LAYOUTS = {
  hook: () => `
    <div class="split hook">
      <div><p class="wordmark">${esc(pitch.title)}</p>${h1("hook")}${points(slide.hook.bullets)}</div>
      ${shot("shots/story-4.webp", "Story: Friday 16:30, the chef types the order at the kitchen terminal and the agent sets off for Valio.", "bleed")}
    </div>`,
  problem: () => `
    ${h1("problem")}
    ${points(slide.problem.bullets, "timeline")}
    ${shot(`${STILL}/nomilk.webp`, "Monday 07:00: the kitchen calendar is stamped NO MILK.", "band")}`,
  solution: () => `
    ${h1("solution")}
    <div class="split solution">${shot(`${STILL}/held.webp`, "The door holds the 1,010.00 € milk order and the kitchen manager's phone asks for approval.")}${points(slide.solution.bullets)}</div>`,
  flow: () => `
    ${h1("flow")}
    <ol class="track">${["Ask", "Read", "Search", "Quote", "Check", "Decide", "Sign"].map((v) => `<li><span class="node"></span>${v}</li>`).join("")}</ol>
    <div class="split flow">${points(slide.flow.bullets)}${shot(`${STILL}/refusals.webp`, "The door refuses the 10 l boxes and lists each refusal with its reason code.")}</div>`,
  guardrails: () => `
    ${h1("guardrails")}
    <div class="evidence">${slide.guardrails.bullets.map((b, i) => `<div><p>${point(b)}</p>${shot(`shots/compare-${["self-approval", "splitting", "allergens", "stock"][i]}.webp`, "The Compare page row for this guardrail, with its acceptance case and reason code.")}</div>`).join("")}</div>`,
  demo: () => `
    ${h1("demo")}
    <div class="split demo">${shot("shots/live-stage.webp", "Live: the scene animates the deployed door's event log; the audit chain check is green.")}
      <div>${shot("shots/try-phone.webp", "Try it: the door held the visitor's 1,010.00 € order and asks them to decide as the kitchen manager.")}${points(slide.demo.bullets)}</div></div>`,
  built: () => `
    ${h1("built")}
    <div class="arch">
      <div class="box agent"><span class="marks">${logo("openapiinitiative")}${logo("modelcontextprotocol")}</span><b>Any agent</b><span>HTTP API or MCP</span></div>
      <div class="box door">${logo("cloudflare")}<b>Lazydoor</b><span>Cloudflare Workers</span><span>Rules, quotes, receipts</span></div>
      <div class="deps">
        <div class="box"><i></i><div><b>Valio API</b><span>Availability and price</span></div></div>
        <div class="box"><span class="marks">${logo("googlegemini")}${mark("gemma-mark-dark.svg")}</span><div><b>Gemini 3.8 Flash, Gemma 4 31B</b><span>A draft, then a second reading</span></div></div>
        <div class="box"><span class="marks">${logo("cloudflare")}</span><div><b>Cloudflare D1</b><span>Catalogue of 17,546 products</span></div></div>
        <div class="box"><span class="marks">${mark("aiven-logo-white.svg", "mark wide")}</span><div><b>Aiven for PostgreSQL</b><span>Every write, via Hyperdrive</span></div></div>
      </div>
      <svg class="wires" viewBox="0 0 1728 500" aria-hidden="true">
        <defs><marker id="tip" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>
        <path d="M300 250H396" marker-end="url(#tip)"/>${[55, 185, 315, 445].map((y) => `<path d="M840 ${y}H956" marker-end="url(#tip)"/>`).join("")}
      </svg>
    </div>
    ${points(slide.built.bullets, "grid2")}`,
  proof: () => {
    const [nums, ...rest] = slide.proof.bullets;
    const figures = [...nums.matchAll(/(\d[\d/,]*)\s+([^,]+)/g)].map(([, n, label]) => `<div><dt>${esc(n)}</dt><dd>${esc(label)}</dd></div>`).join("");
    return `${h1("proof")}<dl class="numerals">${figures}</dl>
      ${shot("shots/inside-checks.webp", "Inside, Check it yourself: the audit chain is valid and the door's EdDSA Ed25519 signing key is published, read live from the deployed door.", "wide")}
      ${points(rest, "row3")}`;
  },
  next: () => {
    const bullets = slide.next.bullets;
    const url = bullets.find((b) => b.startsWith("Demo:"));
    const [label, link] = [url.slice(0, url.indexOf(": ") + 1), url.slice(url.indexOf(": ") + 2)];
    return `<div class="closing"><div class="split next">${shot(`${STILL}/delivery.webp`, "Monday: the truck unloads the milk and chicken beside the chef, with the signed receipt.")}
      <div>${h1("next")}${points(bullets.filter((b) => b !== url))}</div></div><p class="url"><span>${esc(label)}</span> ${esc(link)}</p></div>`;
  },
};

const challenge = pitch.challenge.split(" · ").join(", ");
const slides = pitch.slides.map((s, i) => {
  if (!LAYOUTS[s.id]) throw new Error(`no layout for slide ${s.id}`);
  const n = String(i + 1).padStart(2, "0");
  const left = i === 0 ? `<span>${esc(challenge)}</span>` : "<span></span>";
  return `<section class="slide s-${s.id}" data-id="${s.id}">${LAYOUTS[s.id]()}<footer>${left}<span>${n}</span></footer></section>`;
});

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(pitch.title)}: pitch deck</title>
<link rel="stylesheet" href="deck.css"></head>
<body>
${slides.join("\n")}
</body></html>
`;
writeFileSync(join(ROOT, "deck/index.html"), html);

const notes = `# ${pitch.title}: live pitch notes (3 min)\n\n${pitch.slides.map((s, i) => `## ${String(i + 1).padStart(2, "0")} ${s.heading}\n\n${s.notes}\n`).join("\n")}`;

const TYPES = { ".html": "text/html", ".css": "text/css", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(ROOT) || !existsSync(path)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" }).end(readFileSync(path));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const bad = [];
  page.on("requestfailed", (r) => bad.push(r.url()));
  page.on("response", (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`));
  await page.goto(`http://127.0.0.1:${server.address().port}/deck/index.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  if (bad.length) throw new Error(`missing files: ${bad.join(", ")}`);
  const report = await page.evaluate(() => [...document.querySelectorAll(".slide")].map((s) => {
    const r = s.getBoundingClientRect();
    const over = [...s.querySelectorAll("h1, li, p, figure, dl, .arch, .track")].filter((e) => { const b = e.getBoundingClientRect(); return b.bottom > r.bottom - 64 || (b.right > r.right - 60 && !e.classList.contains("bleed")) || b.left < r.left + 60; }).map((e) => e.tagName + "." + e.className);
    const small = [...s.querySelectorAll("h1, li, p, dt, dd, b, span")].filter((e) => e.closest("footer") === null && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 28).map((e) => `${e.tagName}:${e.textContent.trim().slice(0, 24)}`);
    return { id: s.dataset.id, over, small };
  }));
  mkdirSync(join(out, "slides"), { recursive: true });
  const shots = await page.$$(".slide");
  for (const [i, el] of shots.entries()) await el.screenshot({ path: join(out, "slides", `${String(i + 1).padStart(2, "0")}.png`) });
  await page.pdf({ path: join(out, "deck.pdf"), width: "1920px", height: "1080px", printBackground: true, preferCSSPageSize: true });
  writeFileSync(join(out, "notes.md"), notes);
  for (const r of report) console.log(r.id, r.over.length ? `OUTSIDE ${r.over.join(" ")}` : "fits", r.small.length ? `SMALL ${r.small.join(" | ")}` : "");
  console.log(`deck: ${shots.length} slides into ${out}`);
} finally {
  await browser.close();
  server.close();
}
