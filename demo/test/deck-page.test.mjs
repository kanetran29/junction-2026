import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import deck from "../deck.json" with { type: "json" };

const SERVER = fileURLToPath(new URL("../dev/fake-gateway.mjs", import.meta.url));
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PORT = 8784;
/** playwright-core from PLAYWRIGHT_CORE (or the default resolution); the browser test is skipped when it is not installed. */
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core").catch(() => null);

test("deck.json: nine slides, each with its image, heading and notes, and a PDF under the 25 MiB asset limit", () => {
  assert.equal(deck.slides.length, 9);
  for (const s of deck.slides) {
    assert.ok(existsSync(`${ROOT}${s.src}`), `${s.src} is published`);
    assert.ok(statSync(`${ROOT}${s.src}`).size < 200 * 1024, `${s.src} stays small`);
    assert.ok(s.heading && s.notes, "every slide has a heading (its alt text) and speaker notes");
  }
  assert.equal(deck.pdf, "assets/deck/lazydoor-deck.pdf");
  assert.ok(statSync(`${ROOT}${deck.pdf}`).size < 25 * 1024 * 1024);
});

test("deck tab: nine slides with their headings as alt text, notes folded, the PDF downloads, the Inside link opens it, 375 px", { skip: !pw && "playwright-core not installed (set PLAYWRIGHT_CORE)" }, async (t) => {
  const child = spawn(process.execPath, [SERVER, "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once("data", resolve));
  const chromium = pw.chromium ?? pw.default.chromium;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(`http://localhost:${PORT}/?mode=deck`);
  await page.waitForSelector("#deck-page[data-loaded]");
  const out = await page.evaluate(() => ({
    alts: [...document.querySelectorAll("#deck-page .deck-slide img")].map((i) => i.alt),
    loading: [...document.querySelectorAll("#deck-page .deck-slide img")].map((i) => i.loading),
    open: [...document.querySelectorAll("#deck-page .deck-notes")].filter((d) => d.open).length,
    pdf: document.querySelector("#deck-page .deck-pdf")?.href,
    pressed: document.querySelector('.modes button[data-mode="deck"]').getAttribute("aria-pressed"),
    stage: document.getElementById("stage").hidden,
    scroll: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
  }));
  assert.deepEqual(out.alts, deck.slides.map((s) => s.heading));
  assert.deepEqual(out.loading, ["eager", ...Array(8).fill("lazy")]);
  assert.equal(out.open, 0, "the notes start folded");
  assert.deepEqual([out.pressed, out.stage], ["true", true]);
  assert.ok(out.scroll[0] <= out.scroll[1], `page is ${out.scroll[0]} px wide in ${out.scroll[1]} px`);

  const pdf = await page.evaluate(async (href) => {
    const res = await fetch(href);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { status: res.status, size: bytes.length, magic: String.fromCharCode(...bytes.slice(0, 5)) };
  }, out.pdf);
  assert.deepEqual([pdf.status, pdf.magic], [200, "%PDF-"]);
  assert.ok(pdf.size > 1024 * 1024);

  await page.focus("#deck-page .deck-notes summary");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.querySelector("#deck-page .deck-notes").open), true, "Enter opens the notes");
  assert.equal((await page.textContent("#deck-page .deck-notes p")).trim(), deck.slides[0].notes);

  await page.goto(`http://localhost:${PORT}/?mode=inside`);
  await page.click('#inside-page a[href="?mode=deck"]');
  await page.waitForSelector("#deck-page[data-loaded]");
  assert.equal(await page.isHidden("#inside-page"), true);
});
