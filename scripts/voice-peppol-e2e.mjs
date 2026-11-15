#!/usr/bin/env node
// Live check of voice and Peppol together, as a Try it visitor: a spoken clip (WAV) goes to /v1/try/voice, the transcript
// goes to /v1/try like typed text and must end in an ACCEPTED order, and that order's Peppol XML (by the visitor token) is
// saved for an XSD check. Prints statuses and the transcript only, never the visitor token.
// Usage: node scripts/voice-peppol-e2e.mjs <clip.wav> <out.xml>   Door: GATEWAY_URL, default the deployed door.
import { readFileSync, writeFileSync } from 'node:fs';

const door = (process.env.GATEWAY_URL ?? 'https://lazydoor.lazydoor.workers.dev').replace(/\/$/, '');
const [clip, out] = process.argv.slice(2);
const said = await fetch(`${door}/v1/try/voice`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: readFileSync(clip) });
const { transcript, error } = await said.json();
console.log(`voice ${said.status}: ${JSON.stringify(transcript ?? error)}`);
const tried = await fetch(`${door}/v1/try`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: transcript }) });
const t = await tried.json();
console.log(`try ${tried.status}: step ${t.step}, order ${t.order?.state ?? '-'}, net ${t.order ? (t.order.netCents / 100).toFixed(2) : '-'} €${t.question ? `, asks ${t.question.text}` : ''}${t.error ? `, ${t.error}` : ''}`);
const xml = await fetch(`${door}/v1/orders/${t.order?.orderId}/peppol`, { headers: { 'X-Visitor-Token': t.visitor ?? '' } });
writeFileSync(out, await xml.text());
console.log(`peppol ${xml.status}: ${xml.headers.get('content-type')}`);
process.exit(said.status === 200 && t.order?.state === 'ACCEPTED' && xml.status === 200 ? 0 : 1);
