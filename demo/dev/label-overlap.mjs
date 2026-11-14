// Bounding-box check of every word on screen at 1920×1080: steps Story frame by frame and replays the recorded Live file,
// collects the visible cards, chips, signs and HUD panels, and prints every pair that overlaps or any that leaves the stage.
// Usage: node demo/dev/label-overlap.mjs [base URL]   (needs a running server for demo/, e.g. on port 8790)
// PLAYWRIGHT_CORE and CHROME point at a playwright-core install and a Chrome binary when they are not on the default paths.
const base = process.argv[2] ?? "http://localhost:8790/";
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });

/** Runs in the page: the screen boxes of every visible piece of text (and the terminal screen, which must stay clear). */
const collect = () => {
  const scene = document.querySelector(".scene-front");
  const seen = (node) => {
    for (let n = node; n && n !== scene.parentNode; n = n.parentNode) {
      if (n.nodeType !== 1) continue;
      const style = getComputedStyle(n);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) < 0.05) return false;
    }
    return true;
  };
  const items = [];
  const end = document.getElementById("endcard");
  if (!end.hidden) {
    const r = end.getBoundingClientRect();
    const s = document.querySelector(".stage").getBoundingClientRect();
    return { items: [{ name: "end card", x: r.left, y: r.top, w: r.width, h: r.height }], stage: { x: s.left, y: s.top, w: s.width, h: s.height } };
  }
  const add = (name, node) => {
    if (!node || !seen(node)) return;
    const r = node.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    items.push({ name, x: r.left, y: r.top, w: r.width, h: r.height });
  };
  const one = (id, part, name = id) => add(name, scene.querySelector(`[data-id="${id}"] ${part}`));
  one("label", ".label-box", "agent label");
  one("bubble", ".typed-box", "typed request");
  one("receipt", ".receipt-box", "receipt");
  one("stampfx", ".banner-box", "decision card");
  one("dockchip", ".chip-box", "dock chip");
  one("phonechip", ".chip-box", "terminal chip");
  scene.querySelectorAll('[data-id="doorchips"] > .chip-g').forEach((g, i) => add(`door chip ${i}`, g.querySelector(".chip-box")));
  scene.querySelectorAll('[data-id="chips"] > .chip-g').forEach((g, i) => add(`rack chip ${i}`, g.querySelector(".chip-box")));
  add("LAZYDOOR sign", scene.querySelector(".neon-back"));
  add("logo sign", scene.querySelector('image[href*="valio-aimo-logo"]'));
  add("calendar", scene.querySelector(".cal-head")?.parentNode);
  add("terminal screen", scene.querySelector(".phone-screen"));
  const livery = scene.querySelector(".livery-text");
  if (seen(livery)) {
    // Skewed text: test sample points of its own box, not the screen-aligned box around it.
    const b = livery.getBBox();
    const m = livery.getScreenCTM();
    const pts = [];
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 3; j++) pts.push(new DOMPoint(b.x + (b.width * i) / 12, b.y + (b.height * j) / 3).matrixTransform(m));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    items.push({ name: "truck livery", x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), pts: pts.map((p) => [p.x, p.y]) });
  }
  const html = (sel, name) => {
    const node = document.querySelector(sel);
    if (!node || node.hidden || !node.textContent.trim()) return;
    const r = node.getBoundingClientRect();
    if (r.width > 2 && r.height > 2) items.push({ name, x: r.left, y: r.top, w: r.width, h: r.height });
  };
  html(".hud-events", "event ticker");
  html(".hud-clock", "cut-off clock");
  html("#caption", "caption");
  const s = document.querySelector(".stage").getBoundingClientRect();
  return { items, stage: { x: s.left, y: s.top, w: s.width, h: s.height } };
};

const found = new Map();
/** Records overlapping pairs and boxes outside the stage for one sample. */
function check({ items, stage }, when) {
  const note = (key, area) => {
    const f = found.get(key) ?? { first: when, last: when, area: 0 };
    f.last = when;
    f.area = Math.max(f.area, Math.round(area));
    found.set(key, f);
  };
  for (const a of items) {
    if (a.x < stage.x - 1 || a.y < stage.y - 1 || a.x + a.w > stage.x + stage.w + 1 || a.y + a.h > stage.y + stage.h + 1) note(`${a.name} | outside stage`, 0);
  }
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (w <= 2 || h <= 2) continue;
      const skewed = a.pts ? [a, b] : b.pts ? [b, a] : null;
      if (!skewed) note([a.name, b.name].sort().join(" | "), w * h);
      else {
        const [p, r] = skewed;
        const inside = p.pts.filter(([x, y]) => x > r.x + 2 && x < r.x + r.w - 2 && y > r.y + 2 && y < r.y + r.h - 2).length;
        if (inside) note([a.name, b.name].sort().join(" | "), w * h);
      }
    }
  }
}

await page.goto(`${base}?kiosk=1&manual=1&autoplay=1&t=0`);
await page.waitForFunction(() => typeof window.__step === "function");
const duration = await page.evaluate(() => Number(document.getElementById("scrub").max));
for (let t = 0; t <= duration + 0.01; t += 0.25) {
  const sample = await page.evaluate(() => {
    for (let i = 0; i < 6; i++) window.__step(0.25 / 6);
    return null;
  }).then(() => page.evaluate(collect));
  check(sample, `story ${t.toFixed(2)} s`);
}

await page.goto(`${base}?kiosk=1&mode=live&gateway=${encodeURIComponent("fixtures/sample-events.json")}`);
const start = Date.now();
while (Date.now() - start < 70000) {
  check(await page.evaluate(collect), `live ${((Date.now() - start) / 1000).toFixed(1)} s`);
  if ((await page.evaluate(() => document.getElementById("chip").textContent)) === "ended" && Date.now() - start > 5000) {
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(150);
      check(await page.evaluate(collect), "live ended");
    }
    break;
  }
  await page.waitForTimeout(100);
}
await browser.close();

if (!found.size) console.log("label overlaps: 0");
else {
  for (const [key, f] of found) console.log(`${key}  (${f.first} … ${f.last}, max ${f.area} px²)`);
  console.log(`label overlaps: ${found.size}`);
  process.exitCode = 1;
}
