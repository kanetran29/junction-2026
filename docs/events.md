# Lazydoor events

Every step the door takes is appended to the `events` table and can be read live. The animated demo page and any judge tool use
exactly this schema; a change here is announced in `research/STATUS.md`.

## Reading

| Route | What it returns |
|---|---|
| `GET /v1/events?since=<seq>&buyer=<buyerId>` | `{ events: Event[], next: <seq of the last event, or since> }`, oldest first, at most 500 per call (polling fallback) |
| `GET /v1/events/stream?since=<seq>&buyer=<buyerId>` | Server-Sent Events: one message per event, `id: <seq>`, `event: <type>`, `data: <Event as JSON>`; a comment line `: ping` every 15 s; the server may close the stream after about 60 s, and the client resumes with `?since=` or the `Last-Event-ID` header |

- `since` is exclusive (events with `seq > since`); default 0. `buyer` is optional (all buyers).
- Auth: `Authorization: Bearer <key>`. A judge or admin key reads every buyer; an agent key reads only its own buyer's events. Keys are never accepted in the query string.
- Demo door (`DEMO_MODE=1`, as deployed): a request with no `Authorization` header at all reads every buyer, like a judge key, read-only. A header with a wrong or unknown key is still 401; with `DEMO_MODE` off, no key is 401. No event carries an approval token or link, an API key or a mandate signature; `draft.created` carries the buyer's own request text.
- A `since` that is not a non-negative integer gets 400 `INVALID_REQUEST`; a `Last-Event-ID` that is not one is treated as 0.
- Browsers: on a demo door a plain `new EventSource(url)` works without a key. Elsewhere `EventSource` cannot send an `Authorization` header, so use `fetch(url, { headers: { Authorization: 'Bearer <key>' } })` and read the response body stream (parse the `id:`/`event:`/`data:` lines yourself), or poll `GET /v1/events?since=`. Both events routes answer cross-origin requests (`Access-Control-Allow-Origin: *`, `Authorization` allowed, `OPTIONS` preflight answered, no credentials or cookies); no other route does.

## Event

```ts
interface Event {
  seq: number;          // strictly increasing
  ts: string;           // ISO time with offset, from the door's clock (the demo clock when it is set)
  type: EventType;
  buyerId: string;
  draftId?: string;
  quoteId?: string;
  orderId?: string;
  data: object;         // per type, below
  prevHash: string;     // the hash of the event before this one; 64 zeros for the first event after a reset
  hash: string;         // see "Hash chain" below
}
```

| `type` | `data` |
|---|---|
| `draft.created` | `{ text, category, claims, quantity, unclear, crossCheck }`; `crossCheck` is `{ model, result, fields }`: the Gemma second reading, `result` `agreed`, `disagreed` (then `fields` lists where the readings differ) or `unavailable` |
| `draft.confirmed` | `{}` |
| `search.done` | `{ count, categories }` |
| `valio.called` | `{ endpoint, ids, replay }` (`endpoint` is `availability` or `price`) |
| `quote.created` | `{ offers: [{ offerId, lines: [{ productId, salesUnits }], netCents, changes }], rejections: [{ productId, code }] }` |
| `policy.decided` | `{ outcome, reasons: [code] }` (`outcome` is `AUTO`, `NEEDS_APPROVAL` or `REJECT`) |
| `approval.requested` | `{ orderId, expiresAt }` |
| `approval.approved` | `{}` |
| `approval.rejected` | `{}` |
| `approval.expired` | `{}` |
| `order.accepted` | `{ lines, netCents }` |
| `stock.denied` | `{ productId, remaining }` |
| `clock.set` | `{ now }` |

`approval.requested` never carries the approval link or token: those reach only the approver inbox.

## Hash chain

Every event is chained to the one before it, in commit order, so changing, removing or reordering a stored event shows.

- `hash = hex(sha256(UTF-8 bytes of prevHash + canonicalJson(event)))`, where `+` is plain string concatenation of the 64 hex
  characters of `prevHash` and the canonical JSON.
- `event` is the event exactly as `/v1/events` serves it **without** `prevHash` and `hash`: `seq`, `ts`, `type`, `buyerId`,
  `draftId`, `quoteId` and `orderId` when present (absent ids are left out, never `null`), and `data`.
- `canonicalJson` follows RFC 8785 (JCS): object keys sorted by UTF-16 code units at every depth, arrays in order, no whitespace,
  strings and numbers written as ECMAScript `JSON.stringify` writes them.
- The first event's `prevHash` is the genesis, 64 zeros. **`/admin/reset` (demo doors only) wipes the log, so the chain starts
  again from genesis**; seqs keep increasing across resets.
- Inserts hold one Postgres advisory lock until they commit; the next seq and the previous hash are read under it, so seqs
  commit in order, the chain is linear, and a reader polling `seq > since` never sees a hash that later changes.

`GET /v1/audit/verify` (public, no key) recomputes the whole chain and answers
`{ count, firstSeq, headSeq, headHash, valid, firstBadSeq?, checkedAt, jws }`. `firstBadSeq` is the first event whose `prevHash`
is not the stored hash before it or whose `hash` does not recompute; a removed event shows at the event after it. `jws` is the
door's compact EdDSA JWS over every other field plus `aud: "lazydoor:audit"`; verify it with `/.well-known/jwks.json`. Keep a
signed head to notice later that events were cut from the end, which a chain alone cannot show.

Check it from outside with `node scripts/verify-audit.mjs <door URL>` (Node only, no dependencies). The demo route
`POST /admin/tamper` (admin key, `DEMO_MODE=1`) adds `"tampered": true` to one event's `data` without touching its hash, so
verify names that seq.
