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
- A `since` that is not a non-negative integer gets 400 `INVALID_REQUEST`; a `Last-Event-ID` that is not one is treated as 0.
- Browsers: `EventSource` cannot send an `Authorization` header, so use `fetch(url, { headers: { Authorization: 'Bearer <key>' } })` and read the response body stream (parse the `id:`/`event:`/`data:` lines yourself), or poll `GET /v1/events?since=`. Both events routes answer cross-origin requests (`Access-Control-Allow-Origin: *`, `Authorization` allowed, `OPTIONS` preflight answered, no credentials or cookies); no other route does.

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
