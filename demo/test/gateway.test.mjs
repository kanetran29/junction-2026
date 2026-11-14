import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dev/fake-gateway.mjs", import.meta.url));
const PORT = 8799;

/** Starts the dev server on PORT with extra arguments and resolves once it prints its listening line. */
function startServer(...args) {
  const child = spawn(process.execPath, [SERVER, "--port", String(PORT), ...args], { stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolve) => child.stdout.once("data", () => resolve(child)));
}

test("dev server: a voice clip answers a byte range, so the player can seek inside a line", async (t) => {
  const child = await startServer();
  t.after(() => child.kill());
  const res = await fetch(`http://localhost:${PORT}/assets/voice/01.mp3`, { headers: { range: "bytes=100-199" } });
  const total = (await (await fetch(`http://localhost:${PORT}/assets/voice/01.mp3`)).arrayBuffer()).byteLength;
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-type"), "audio/mpeg");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(res.headers.get("content-range"), `bytes 100-199/${total}`);
  assert.equal((await res.arrayBuffer()).byteLength, 100);
});

test("dev server: a range past the end of the file is refused with 416", async (t) => {
  const child = await startServer();
  t.after(() => child.kill());
  const res = await fetch(`http://localhost:${PORT}/assets/voice/01.mp3`, { headers: { range: "bytes=999999999-" } });
  assert.equal(res.status, 416);
});

test("dev server: --replay plays the recorded run into the event log once a viewer reads it, every buyer, no key", async (t) => {
  const child = await startServer("--replay", "--pace", "0.01");
  t.after(() => child.kill());
  const first = await (await fetch(`http://localhost:${PORT}/v1/events?since=0`)).json();
  assert.equal(first.events.length, 0, "nothing plays before someone watches");
  await new Promise((r) => setTimeout(r, 1500));
  const later = await (await fetch(`http://localhost:${PORT}/v1/events?since=0`)).json();
  assert.equal(later.events.length, 52);
  assert.deepEqual([...new Set(later.events.map((e) => e.buyerId))].sort(), ["admin", "hotel-a", "hotel-b"]);
});
