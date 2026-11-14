import test from "node:test";
import assert from "node:assert/strict";
import { truckRun, boomOpen, BARRIER } from "../scene.mjs";

/** Counts how often the dock boom starts to rise over a run sampled every 50 ms. */
function raises(tr, until) {
  let count = 0;
  let before = false;
  for (let age = 0; age <= until; age += 0.05) {
    const open = boomOpen(tr, age);
    if (open && !before) count += 1;
    before = open;
  }
  return count;
}

test("dock boom: an accepted run raises it exactly once, and it is down again once the truck is home", () => {
  const tr = { status: "loading", crates: 8, naive: false, since: 0 };
  const run = truckRun(tr, 0);
  assert.equal(raises(tr, run.home + 10), 1);
  assert.equal(boomOpen(tr, 0), false);
  assert.equal(boomOpen(tr, run.go), true);
  assert.equal(boomOpen(tr, run.home + 1), false);
});

test("dock boom: the truck never drives through it while it is down", () => {
  const tr = { status: "loading", crates: 3, naive: false, since: 0 };
  const end = truckRun(tr, 0).home + 2;
  for (let age = 0; age <= end; age += 0.05) {
    const { front } = truckRun(tr, age);
    if (front < BARRIER.x) assert.ok(boomOpen(tr, age), `boom down at ${age.toFixed(2)} s with the cab past it`);
  }
});

test("dock boom: a refused naive load, a stuck truck and a parked truck keep it shut", () => {
  assert.equal(raises({ status: "loading", crates: 3, naive: true, since: 0 }, 20), 0);
  assert.equal(raises({ status: "stuck", crates: 3, naive: true, since: 0 }, 20), 0);
  assert.equal(raises({ status: "parked", crates: 0, naive: false, since: 0 }, 20), 0);
});
