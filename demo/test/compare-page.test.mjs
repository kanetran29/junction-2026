import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { STRENGTHS, PAGE_ONLY } from "../compare.mjs";

const SERVER = fileURLToPath(new URL("../dev/fake-gateway.mjs", import.meta.url));
const PORT = 8798;
/** playwright-core from PLAYWRIGHT_CORE (or the default resolution); the browser test is skipped when it is not installed. */
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core").catch(() => null);

test("compare: twelve rows, each Lazydoor line with its evidence; the webshop column never claims more than we know", () => {
  const rows = [...STRENGTHS, ...PAGE_ONLY];
  assert.equal(STRENGTHS.length, 8);
  assert.equal(rows.length, 12);
  for (const row of rows) {
    assert.ok(row.topic && row.without && row.with && row.evidence, row.topic);
    assert.ok(["—", "the person, if they notice"].includes(row.webshop), `${row.topic}: ${row.webshop}`);
  }
});

test("compare page: no horizontal scroll at 375 px, and every row is on the page", { skip: !pw && "playwright-core not installed (set PLAYWRIGHT_CORE)" }, async (t) => {
  const child = spawn(process.execPath, [SERVER, "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once("data", resolve));
  const chromium = pw.chromium ?? pw.default.chromium;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.goto(`http://localhost:${PORT}/?mode=compare`);
  const { scroll, client, rows, stage } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
    rows: document.querySelectorAll("#cmp-body tr").length,
    stage: document.getElementById("stage").hidden,
  }));
  assert.ok(scroll <= client, `page is ${scroll} px wide in a ${client} px viewport`);
  assert.equal(rows, 12);
  assert.equal(stage, true);
});
