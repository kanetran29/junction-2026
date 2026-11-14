// Takes the deck's real screenshots from the deployed demo at 2x: Story frames, Live with the Try panel holding an order,
// Compare rows and the Inside live checks. One browser, a fresh context per shot (no scroll or state carried over).
// Usage: node deck/capture.mjs <out dir> [demo URL] [story|live|compare|inside ...]; PLAYWRIGHT_CORE and CHROME as for
// demo/dev/label-overlap.mjs. With group names, only those are taken again.
import { writeFileSync } from "node:fs";

const [out, base = "https://lazydoor.lazydoor.workers.dev/demo/", ...only] = process.argv.slice(2);
const want = (group) => !only.length || only.includes(group);
if (!out) throw new Error("usage: node deck/capture.mjs <out dir> [demo URL]");
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const chromium = pw.chromium ?? pw.default.chromium;
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true, args: ["--use-angle=metal", "--ignore-gpu-blocklist"] });
const boxes = {};

/** Opens `query` on the demo in a fresh 2x context of the given size, runs `shoot(page)`, then closes the context. */
async function shot(width, height, query, shoot) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await page.goto(`${base}${query}`);
  await page.evaluate(() => document.fonts.ready);
  try {
    await shoot(page);
  } finally {
    await context.close();
  }
}

try {
  for (const t of want("story") ? [4, 9, 30, 50, 60, 112] : []) {
    await shot(1920, 1080, `?kiosk=1&manual=1&autoplay=1&t=${t - 2}`, async (page) => {
      await page.waitForFunction(() => typeof window.__step === "function");
      await page.addStyleTag({ content: ".caption,.rewind{display:none!important}" });
      await page.evaluate((n) => { for (let i = 0; i < n; i++) window.__step(1 / 30); }, 60);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/story-${t}.png` });
    });
  }

  if (want("live")) await shot(1440, 900, "?mode=live", async (page) => {
    await page.waitForSelector("#try-panel .try-chip");
    await page.locator("#try-panel .try-chip").first().click();
    await page.click("#try-panel button[type=submit]");
    await page.waitForSelector('#try-panel [data-kind="held"]', { timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.locator("#try-panel").screenshot({ path: `${out}/try-panel.png` });
    await page.locator('#try-panel [data-kind="held"]').screenshot({ path: `${out}/try-phone.png` });
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator("#stage").screenshot({ path: `${out}/live-stage.png` });
  });

  if (want("compare")) await shot(560, 900, "?mode=compare", async (page) => {
    for (const topic of ["Self-approval", "Splitting", "Allergens", "Stock"]) {
      const pair = page.locator("article.pair", { has: page.locator("h3", { hasText: new RegExp(`^${topic}$`) }) });
      await pair.scrollIntoViewIfNeeded();
      const b = await pair.boundingBox();
      await page.screenshot({ path: `${out}/compare-${topic.toLowerCase()}.png`, clip: { x: b.x - 24, y: b.y, width: Math.min(b.width + 24, 560 - b.x + 24), height: b.height + 12 } });
    }
  });

  if (want("inside")) await shot(900, 1000, "?mode=inside", async (page) => {
    await page.waitForFunction(() => document.querySelectorAll(".tile").length === 4 && ![...document.querySelectorAll(".tile")].some((t) => t.dataset.state === "loading"));
    const bento = page.locator(".bento");
    await bento.scrollIntoViewIfNeeded();
    boxes.bento = await bento.boundingBox();
    boxes.tiles = await page.$$eval(".tile", (ts) => ts.map((t) => ({ check: t.dataset.check, state: t.dataset.state, ...t.getBoundingClientRect().toJSON() })));
    await bento.screenshot({ path: `${out}/inside-bento.png` });
  });
} finally {
  await browser.close();
}
if (want("inside")) writeFileSync(`${out}/boxes.json`, JSON.stringify(boxes, null, 2));
console.log("captured into", out);
