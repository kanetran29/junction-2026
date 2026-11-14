#!/usr/bin/env node
// One-line demo operations on the deployed door, with the admin key read from a file (never printed):
//   node scripts/demo-admin.mjs reset     the standard demo state for the next round (Fri 21:10, replay, the kitchen
//                                         mandate 500 €/order and 1,500 €/day, Try it on; wipes orders, events, sandboxes)
//   node scripts/demo-admin.mjs try-off   switch Try it off at once (both routes 404, the page hides the panel)
//   node scripts/demo-admin.mjs try-on    switch it back on
// Key file: LAZYDOOR_ADMIN_KEY_FILE, default .data/valio/keys/deploy-admin.key. Door: GATEWAY_URL, default the deployed door.
import { readFileSync } from 'node:fs';

const door = (process.env.GATEWAY_URL ?? 'https://lazydoor.lazydoor.workers.dev').replace(/\/$/, '');
const key = readFileSync(process.env.LAZYDOOR_ADMIN_KEY_FILE ?? '.data/valio/keys/deploy-admin.key', 'utf8').trim();
const STANDARD = {
  clock: '2026-11-13T21:10:00+02:00',
  replay: 'replies_2026-11-16',
  mandate: { perOrder: { auto: 500, hard: 5000 }, perDay: { auto: 1500, hard: 10000 } },
  tryIt: true,
};

/** POSTs JSON with the admin key and returns the HTTP status. */
async function admin(path, body) {
  const res = await fetch(door + path, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await res.body?.cancel();
  return res.status;
}

const command = process.argv[2];
if (command === 'reset') {
  console.log(`reset: ${await admin('/admin/reset', STANDARD)}`);
  console.log(`health: ${JSON.stringify(await (await fetch(`${door}/health`)).json())}`);
  const { jws: _jws, ...verify } = await (await fetch(`${door}/v1/audit/verify`)).json();
  console.log(`audit: ${JSON.stringify(verify)}`);
} else if (command === 'try-off' || command === 'try-on') {
  console.log(`Try it ${command === 'try-on' ? 'on' : 'off'}: ${await admin('/admin/try', { enabled: command === 'try-on' })}`);
} else {
  console.error('usage: node scripts/demo-admin.mjs reset | try-off | try-on');
  process.exit(1);
}
