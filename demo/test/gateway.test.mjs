import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("../dev/fake-gateway.mjs", import.meta.url));
const PORT = 8799;

/** Starts the dev server on PORT and resolves once it prints its listening line. */
function startServer() {
  const child = spawn(process.execPath, [SERVER, "--port", String(PORT)], { stdio: ["ignore", "pipe", "inherit"] });
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
