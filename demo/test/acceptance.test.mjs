import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import source from "../../research/acceptance/cases.json" with { type: "json" };
import published from "../acceptance.json" with { type: "json" };
import { buildAcceptance } from "../dev/acceptance.mjs";
import { RUBRICS } from "../acceptance-view.mjs";

const SERVER = fileURLToPath(new URL("../dev/fake-gateway.mjs", import.meta.url));
const PORT = 8774;
/** playwright-core from PLAYWRIGHT_CORE (or the default resolution); the browser test is skipped when it is not installed. */
const pw = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core").catch(() => null);
const withoutPass = (cases) => cases.map(({ pass, checks, ...c }) => c);

test("acceptance.json matches research/acceptance/cases.json (run node demo/dev/acceptance.mjs after editing the cases) and carries no inputs", () => {
  assert.deepEqual(withoutPass(buildAcceptance(source).cases), withoutPass(published.cases));
  assert.equal(published.cases.length, 66);
  const keys = new Set(RUBRICS.map(([k]) => k));
  for (const c of published.cases) {
    assert.match(c.id, /^AC\d{2,}$/);
    assert.ok(c.title && c.calls.length > 0 && c.checks > 0, `${c.id} has a title, calls and checks`);
    assert.ok(c.rubric.length > 0 && c.rubric.every((r) => keys.has(r)), `${c.id} has known rubrics`);
  }
  assert.doesNotMatch(JSON.stringify(published), /"(input|expect|steps)"/);
});

test("buildAcceptance: the run's numbers, and pass marks only when the run says them", () => {
  const all = buildAcceptance(source, { passed: 63, total: 63, version: "32795cea-9fb8", date: "2026-11-15", extra: "not copied" });
  assert.deepEqual(all.run, { passed: 63, total: 63, version: "32795cea-9fb8", date: "2026-11-15" });
  assert.ok(all.cases.every((c) => c.pass === true));
  const some = buildAcceptance(source, { passed: 62, total: 63, results: [{ id: "AC05", ok: false }, { id: "AC01", ok: true }] });
  assert.deepEqual(some.cases.filter((c) => "pass" in c).map((c) => [c.id, c.pass]), [["AC01", true], ["AC05", false]]);
  const counted = buildAcceptance(source, { passed: 63, total: 63, cases: [{ id: "AC01", passed: true, checks: 22 }] });
  assert.deepEqual([counted.cases[0].checks, counted.cases[0].pass], [22, true], "the run's own check count wins");
  assert.equal(published.cases.reduce((n, c) => n + c.checks, 0), buildAcceptance(source).cases.reduce((n, c) => n + c.checks, 0), "the published checks add up to the cases' expectations");
  const none = buildAcceptance(source);
  assert.equal(none.run, null);
  assert.ok(none.cases.every((c) => !("pass" in c)), "not yet measured: no pass marks");
});

test("acceptance on the site: every AC chip names and links its case; Inside groups the 63 cases; an anchor opens the right group", { skip: !pw && "playwright-core not installed (set PLAYWRIGHT_CORE)" }, async (t) => {
  const child = spawn(process.execPath, [SERVER, "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
  t.after(() => child.kill());
  await new Promise((resolve) => child.stdout.once("data", resolve));
  const chromium = pw.chromium ?? pw.default.chromium;
  const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const titles = new Map(published.cases.map((c) => [c.id, c.title]));
  /** Every AC chip under `root` once labelled: [id, title, href, aria-label]. */
  const chipsIn = async (root) => {
    await page.waitForFunction((r) => [...document.querySelectorAll(`${r} a[data-ac]`)].every((a) => a.title), root);
    return page.$$eval(`${root} a[data-ac]`, (as) => as.map((a) => [a.dataset.ac, a.title, a.getAttribute("href"), a.getAttribute("aria-label")]));
  };
  const checkChips = (chips) => {
    assert.ok(chips.length > 0);
    for (const [id, title, href, label] of chips) {
      assert.equal(title, `${id}: ${titles.get(id)}`);
      assert.equal(label, title);
      assert.equal(href, `?mode=inside#ac-${id}`);
    }
  };
  /** True when the "AC = acceptance case" line comes before the first AC chip under `root`. */
  const noteFirst = (root) => page.evaluate((r) => {
    const notes = document.querySelectorAll(`${r} .ac-note`);
    const chip = document.querySelector(`${r} a[data-ac]`);
    return notes.length === 1 && Boolean(notes[0].compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING);
  }, root);

  await page.goto(`http://localhost:${PORT}/?mode=inside`);
  await page.waitForSelector('[data-section="acceptance"][data-loaded]');
  checkChips(await chipsIn("#inside-page .is-guardrails"));
  assert.equal(await noteFirst("#inside-page"), true);
  const groups = await page.$$eval(".ac-group", (gs) => gs.map((g) => [g.dataset.rubric, g.querySelectorAll(".ac-case").length, g.open]));
  assert.equal(groups.reduce((n, g) => n + g[1], 0), 63);
  assert.deepEqual(groups.map((g) => g[0]), ["e2e", "need", "controls", "exceptions", "openness"]);
  assert.ok(groups.every((g) => g[2] === false), "the groups start closed");

  await page.click('#inside-page .is-guardrails a[data-ac="AC05"]');
  await page.waitForSelector("#ac-AC05[data-highlight]");
  const opened = await page.$$eval(".ac-group", (gs) => gs.filter((g) => g.open).map((g) => g.dataset.rubric));
  assert.deepEqual(opened, [published.cases.find((c) => c.id === "AC05").rubric[0]]);
  const width = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(width[0] <= width[1], `page is ${width[0]} px wide in ${width[1]} px`);

  await page.goto(`http://localhost:${PORT}/?mode=inside#ac-AC44`);
  await page.waitForSelector("#ac-AC44[data-highlight]");
  assert.equal(await page.$eval("#ac-AC44", (li) => li.closest("details").open), true);

  await page.goto(`http://localhost:${PORT}/?mode=compare`);
  checkChips(await chipsIn("#compare-page"));
  assert.equal(await noteFirst("#compare-page"), true);
});
