# Valio Aimo "Trusted Trade Agents": deep analysis

Measured Fri 13 Nov 2026, about 20:30 Helsinki time, on the real data files and the live mock API (about 55 calls, 9 product
families, never the whole catalogue). Scripts are in `scripts/analysis/`; section 6 says how to re-run them. Local only, never push.

## 0. The seven findings that change the plan

1. **The mock is a frozen snapshot of one delivery day.** `requestedDate` is echoed and ignored: for 10 Nov, 14 Nov, 20 Nov, 24 Dec and
   June 2027 the reply is identical: `availableDate` 2026-11-16 (Monday), the same cut-offs, stock and prices. Weekday against weekend
   cannot be tested; the agent has to compare `availableDate` with the date it asked for.
2. **After Sun 15 Nov 17:00 nothing in the mock can be ordered.** Every "Stock" product closes then and every "Terminal" product closed
   on Thu 12 Nov or earlier. The gateway needs a clock it can set and recorded replies, or any demo after that time shows an empty shop.
3. **"Available 999999 on Monday" is not "orderable".** Terminal products still report stock and Monday delivery after their cut-off
   has passed. Only `closingTime > timeNow` decides. This is the trap a naive agent falls into, and the best 10 seconds of the demo.
4. **The poster's example has no exception in it.** 1,000 l resolves to one product (464306, 1.01 €/l, unlimited stock, cut-off Sun 17:00).
   Robustness (15 points) has to come from a scenario with a constraint: bulk 10 l packs (closed), one brand (stock 51 / 384 / 698), organic (closed).
5. **Litres or kg per sales unit come from the price API, not from the product data.** `catalogPrice / comparisonPrice` exists for 92 % of
   the non-KG products probed; Synkka content for 49 %, and it is wrong by a pack factor (4x, 12x, 48x, 60x) in some of them.
6. **Official substitutions are not safe to apply.** 250 pairs on 189 products (1.1 %): 29 add an allergen, 12 lose the lactose-free claim,
   13 lose gluten-free, 73 cost more than +20 %. Only 115 of the 189 had a substitute that could still be ordered.
7. **Carbon cannot rank candidates of one type, and reliability hardly can.** Carbon is a group average (all milk 1.1; 190 of 279
   categories hold a single value). Reliability covers 25 % and 87 % of the known values are exactly 1.0. Both need an explicit "unknown".

Build time is nearer 18 hours than 30: Fri 21:00 to Sun 10:00 is 37 hours of clock, less two nights and the video and submission.

## 1. Requirements against the rubric

| Brief / rubric line | What a winning demo has to show | Proof on screen |
|---|---|---|
| Core 1: structured lookup | An agent finds a product type by attributes (type, claims, temperature, brand), gets facts with units it can compute on, and asks Valio only about its shortlist | `search_products` returns 35 candidates; `quote` makes 2 Valio calls for 35 ids, shown as a counter |
| Core 2: request to order at fixed prices | A quantity in litres becomes whole sales units; price, validity and cut-off are frozen in a quote; the order repeats the quote exactly | "1,000 l = 1,000 ST = 50 cases, 1.01 €/l, 1,010.00 € + VAT 13.5 %, valid to 31 Dec, order by Sun 17:00" |
| Core 3: permissions and human approval | A mandate the agent cannot edit; three outcomes with reason codes; a human approves exactly what will be placed | AUTO for a small order, NEEDS_APPROVAL for the big one, REJECT for a forbidden one; phone approval page |
| Bonus: reliability / sustainability | Shown per offer with coverage stated; never a made-up ranking | "reliability 1.0 (known for 17 of 35)", "CO2 1.1 kg/kg, product-group average", organic / Finnish origin badges |
| Bonus: substitutions, exceptions | A closed product, limited stock and an unsafe substitute, each handled with a typed reason | `CUTOFF_PASSED`, `STOCK_LIMITED 384`, `SUBSTITUTE_LOSES_CLAIM lactose-free` |
| Bonus: human-readable explanation | The receipt and approval page are written from the reason codes | One paragraph: what was asked, what was changed and why, what it costs, who approved |
| End-to-end demo (30) | One unbroken run: request, lookup, quote, policy, approval, order, receipt, driven by an external agent | Gemini agent over MCP in one pane, phone in the other; no cuts inside the run |
| Solving the user's need (20) | The hotel gets milk on Monday without a human doing the work; Valio gets orders it can deliver | The naive-agent trap shown and avoided; overage and pack sizes explicit |
| Autonomy and controls (20) | The agent acts alone inside limits and cannot talk its way out of them | Three outcomes; order splitting caught by a cumulative cap; quantity in cases against litres rejected |
| Robustness to exceptions (15) | Wrong inputs and bad timing fail closed with a reason | Approval after cut-off expires; replayed order returns the same receipt; unknown product id; fractional case |
| Openness, path to production (15) | Any agent can connect; every decision can be replayed; honest list of what is simulated | OpenAPI and MCP from one schema, reason-code catalogue, event log, "what Valio must add" list |

"Not a chatbot" is met by keeping the language model outside the gateway: the buyer's agent is the only model in the run.

## 2. Data and API deep-dive (beyond NOTES.md)

### 2.1 Finding a product type without name matching

- 349 category codes, all five digits, no names. Codes seen: 10400 drinking milk (91 products), 10401 cream, 10404 condensed milk,
  10500 butter, 10590 eggs, 10900 fresh bread, 18701 fresh fish, 18750 fresh poultry, 22300 coffee, 41710 frozen poultry, 41720 frozen fish,
  41760 frozen bread. The same food sits in different codes when fresh and frozen ("rintafilee": 12 in 18750, 17 in 41710).
- A category is too coarse to be a product type. 10400 with the lactose-free claim gives 35 products, of which about 27 are milk:
  4 are buttermilk (piimä), 3 coffee milk, 1 a latte drink.
- Attributes that work:
  - `nutritionalClaim FREE_FROM_LACTOSE`: 4,178 products, and all 35 lactose-free products in 10400 carry it.
  - `nonAllergen ML FREE_FROM` is set on about a quarter of those, so it cannot be the filter. `nutritionFact LACS` (grams of lactose) is present on 3,572.
  - 12,336 products carry no lactose information at all: unknown, not "contains".
  - `allergen` / `nonAllergen` codes (AM milk, AW wheat, GO oats, ML lactose...) with CONTAINS / MAY_CONTAIN / FREE_FROM.
  - `packagingMarkedLabel`: EU organic 456, Svanen 362, Rainforest Alliance 234, MSC 104, Fairtrade 92, ASC 51, two Finnish-origin marks (2,057 and 1,772).
  - `temperatureCondition`: 7 frozen (max -18 °C), 8 ambient (22 °C), 1 to 4 chilled (3 to 8 °C), 5 and 6 produce kept cool. UHT milk is 8 or 4.
- Recommended lookup: category code AND claims AND temperature class, then a subtype tag made once, offline: let Gemini name the 349
  codes and tag subtypes from ten sample names each, keep the result as a reviewed table in D1, and hand-check the families used in the demo.
  Free-text search over fi / en / sv names is the fallback, never the first filter.

### 2.2 Units, lot sizes and quantity conversion

- `salesUnit`: KI case 8,005, ST piece 5,607, KG 1,068, then PAK, BAG, RAS, PRK, BOT and 7 more. Fifteen codes, no translations.
- `allowedLotSize` is 0.01 for 16,872 products (96 %), which means "no rule": nothing stops 0.37 of a case. Real steps exist mostly on
  KG products (chicken breast 4.4 kg, 15 kg, 21 kg).
- 632 products are variable weight: the invoice follows the real weight, so a quote is an estimate.
- Content per sales unit, measured on 597 non-KG products in 9 families:

  | Source | Available | Notes |
  |---|---|---|
  | `catalogPrice / comparisonPrice` (price API) | 550 (92 %) | Rounding noise: 19.943 for a 2 x 10 l case, 21.069 for 12 x 1.75 l |
  | Synkka base-unit volume or net weight x `sizeInBaseUnits` | 292 (49 %, counted where a price ratio exists) | Agrees within 2 % in 276; off by a pack factor in 7 (butter "4x5 kg": 20 kg against 5 kg billed) |
  | Number in the name ("1 l", "100x2 cl") | most | Last resort, cross-check only |

  Rule: take the price ratio, snap it to the Synkka or name value when they agree within 2 %, otherwise mark the product `NOT_CONVERTIBLE`
  and leave it out. Then round up to whole sales units and show the overage.
- Eggs are priced per kg; piece counts exist only in names ("M10", "L180"). A request in pieces cannot be converted safely: out of scope.
- A schedule line can use another unit than the product: 8 of 47 fresh breads are sold per KI while the line reports ST or BAG.
- VAT: `valueWithTax` is rounded per unit. 1,000 x 1.15 = 1,150.00 €, but 1,010.00 € x 1.135 = 1,146.35 €. Budget on net, state which.

### 2.3 Mock API behaviour

- Static snapshot (finding 1). `timeNow` in the reply is the real clock. Whether the snapshot rolls forward is unknown: re-run one call on
  Saturday morning and ask at the booth.
- Two logistic models, and the cut-off depends on the model, not on fresh or frozen:

  | Model | Cut-off for Monday 16 Nov | Seen in |
  |---|---|---|
  | Stock | Sun 15 Nov 17:00 (two products Fri 13 Nov 13:00, already closed) | 14 of 35 lactose-free milks, 59 of 122 frozen fish, 72 of 109 coffees |
  | Terminal | Thu 12 Nov 12:00, 12:30, 13:00, 14:00, 15:00 or 16:00; a few Tue 10 Nov 14:00 | 20 of 35 milks, 84 of 107 fresh chicken, 25 of 47 fresh breads (12:30) |
  | none (no `closingTime`, no schedule line) | not orderable | 44 of 81 fresh fish, 39 of 244 frozen breads, 464440 |

- `availableAmount`: 999999 (every Terminal line), 9999999999, and 1e10 divided by units per case (666666666, 714285714) all mean
  "not limited". Real stock is common in Stock products: 52 of 99 frozen fish lines, 72 of 98 coffee lines. A zero line has `availableDate` null.
- Price: per one sales unit, no quantity breaks; `validTo` is 9999-12-31 or 2026-12-31; the same price comes back for a date after `validTo`.
  `netPriceFound` is true for 13 of 774 products probed (10 of them milks), always with a finite `validTo` (2026-12-31, once 2032-12-31);
  every false one has 9999-12-31. It looks like an agreed price with an end date, but the meaning is not documented.
- Errors: an unknown product id gives HTTP 200 with empty `scheduleLines` and price `error: true` (no 404). An empty list, a missing
  `customer`, a datetime instead of a date, or a numeric id give 422. There is no order, search or substitution endpoint (404).
- Timestamps come as `+0200` without a colon. Node parses it; turn it into `+02:00` in the gateway before a phone browser sees it.

### 2.4 Buyer requests tested

| Request | Candidates | What the API says | Feasible answer | Trap |
|---|---|---|---|---|
| 1,000 l lactose-free milk by Monday | 35 (10400 + claim) | 14 open, 20 closed Thu 15:00, 1 without a line | 464306: 1,000 ST (50 cases of 20), 1,010.00 € net | Cheapest per litre among closed ones looks orderable |
| Same, 10 l bulk packs | 463038, 464179 | Both Terminal, closed Thu 15:00, "999999 on 16 Nov" | None for Monday; offer 1 l cartons | Ordering 50 cases that cannot arrive |
| Same, Arla only | 11 Arla | Open ones hold 51, 384, 698 pieces and 192 cases of 2 l | 51 + 384 l of milk; 698 is barista milk: shortfall | Treating barista or portion milk as the same thing |
| Same for Sat 14, Sun 15, Tue 17, Fri 20 Nov | 35 | Identical reply, `availableDate` 16 Nov | Sat and Sun: cannot be met; Tue, Fri: arrives Monday | Trusting that the reply answers the date asked |
| 150 kg fresh chicken breast | 107 in 18750 | 84 closed, 14 no line, 9 open | 462281: 198 kg in stock, 4.4 kg steps: 35 x 4.4 = 154 kg, about 1,185.80 € | Variable weight; 150 is not a multiple of 4.4 |
| Frozen fish | 122 in 41720 | 59 open, 40 closed Thu, 23 no line; half the lines have real stock | Per product | "Frozen is always available" |
| Eggs | 9 in 10590 | 8 open; one closed Fri 13:00 with 2 cases left | Only by kg or by pack | Pieces against kg; a cut-off earlier than the rest |
| Butter | 20 in 10500 | 10 open, 10 closed; stock 18 to 387 on four | Per product | HYLA and "vähälaktoosinen" are low lactose, not lactose-free |
| Fresh bread | 47 in 10900 | 27 closed (mostly Thu 12:30), 10 no line | 10 open | Line unit differs from sales unit |

### 2.5 What substitutions, reliability and carbon allow

- Substitutions: 189 products, 250 pairs, 63 two-way; 230 stay in the same category. Differences: sales unit 75, temperature class 58,
  brand 98, country 80. Unsafe: 29 add a CONTAINS allergen (464296 gluten-free gets wheat and oats), 13 lose gluten-free, 12 lose
  lactose-free (some from missing data on the substitute), 12 lose organic. Price per kg or litre: median +2 %, a tenth above +82 %.
  Live: 139 pairs both open, 31 with the substitute closed, 12 with it unavailable.
  Use: an official pair is a hint. Our own rule decides: same claims, no new allergen, same temperature class, price inside the mandate.
- Reliability: 4,425 products; 3,847 are 1.0, 380 about 0.9, 13 are 0.0. The coldest chilled class (mostly fresh fish) averages 0.81; beef cuts go down to 0.25.
  17 of 35 lactose-free milks have a value. Use: a floor in the mandate ("at least 0.9, unknown needs approval") and a tie-break.
- Carbon: 177 distinct values from 0.13 to 30.46 kg CO2-eq per kg. Useless inside a type, meaningful across types and as a total
  (1,000 l of milk is about 1.1 t CO2-eq). Use: show it, label it "product-group average", never a threshold inside one type.

### 2.6 Traps an agent would fall into

1. Reading `availableAmount > 0` and `availableDate` as "orderable" while the cut-off has passed.
2. Reading 999999 or 9999999999 as a quantity.
3. Trusting that the reply is for the date asked.
4. Using a price outside `validFrom` to `validTo`, or reading `error: true` as price 0.
5. Ordering "1000" of a KI product: 1,000 cases of 2 x 10 l is 20,000 litres.
6. Ordering 0.37 of a case because `allowedLotSize` is 0.01.
7. Comparing prices per sales unit instead of `comparisonPrice`.
8. Taking Synkka weight as the content of the sales unit.
9. Matching "laktoositon" in names: gets chocolate and pudding, and misses that "vähälaktoosinen" and HYLA are not lactose-free.
10. Treating missing reliability as 1.0, or a missing lactose claim as "contains".
11. Applying an official substitution without comparing allergens and claims.
12. Comparing stock in the line's unit with a quantity in the product's sales unit.
13. Quoting a fixed total for a variable-weight product.
14. Approval that arrives after the cut-off, or an order placed twice on a retry.
15. Asking the API about all products: the limit is 1,000 ids a call, and the poster forbids it.

## 3. The proposed design: alternatives and red-team

### 3.1 Three ways to build it

| Approach | What it is | Trade-off |
|---|---|---|
| A. Smart gateway (as proposed) | The gateway plans: 2 or 3 plans with trade-offs, substitutes, splits, signed mandates | Most to build; the planner eats the weekend and the happy path does not need it |
| B. Quote protocol (recommended) | `search` then `quote` then `order`. A quote is an immutable, expiring object with offers and typed rejections; the buyer's agent chooses; policy decides on the order | Small, deterministic, easy to test with recorded replies; less "intelligence" on screen, so the demo must show the traps it prevents |
| C. Conversational concierge | A model inside the gateway talks to the agent | Ruled out by "It is not a chatbot"; decisions cannot be replayed |

B keeps "the model proposes, rules decide" and makes it literal: the gateway has no model in its decision path. Gemini is the buyer's
agent (function calling over the same tools) and the offline tagger of the catalogue.

### 3.2 Red-team objections, ranked

Four blind reviewers (correctness and false confidence, hidden assumptions, over-engineering, safety and trust), then checked against
the data. Objections only; the decision is Kane's.

| # | Objection | Raised by | Why it matters | Cheaper or safer |
|---|---|---|---|---|
| 1 | The demo expires Sun 17:00 and the countdown depends on a mock that ignores dates | 4 of 4 | 30 points rest on a run that stops working mid-afternoon | Clock taken from a setting, recorded replies as fallback, a visible "replay" badge |
| 2 | "Orderable" is not defined; Terminal and no-line products pass a stock filter | 3 of 4 | The gateway would sell what cannot be delivered | One function: has a line, `closingTime > now`, amount above 0, no sales block, unit matches |
| 3 | Quantity conversion is the riskiest step and is not a gate | 3 of 4 | A unit mistake is a 20-fold order | Agent states litres, kg or pieces; gateway converts, echoes "= N cases = X l", rejects fractions and mismatches |
| 4 | `place_order` and "price locked" claim what nobody verified | 3 of 4 | One judge question breaks it | Status "accepted by gateway, simulated"; re-check price and stock when placing; an adapter for the real order API |
| 5 | Missing data is treated as good data | 3 of 4 | AUTO decided on nothing | Three values everywhere: pass, fail, unknown; unknown on a required rule means approval |
| 6 | Official substitutes are trusted | 4 of 4 | Allergen harm is the worst outcome | Our rule on claims and allergens; any substitute needs approval; show one rejected |
| 7 | The approved thing is not bound to the placed thing; late approval still works | 2 of 4 | Guardrails become decoration | Token bound to a hash of the lines, single use, expires at the cut-off; re-check on placing |
| 8 | The approval limit can be dodged by splitting; the daily cap can be raced | 1 of 4 | A judge may try it | Cumulative spend per buyer and delivery day, pending orders count; one conditional insert |
| 9 | The signed mandate is theatre for a solo build | 3 of 4 | Hours on keys nobody sees | Mandate stored server-side per API key with a version and hash; signing described as path to production |
| 10 | Two or three plans: the happy path has one, the rest would be near-copies | 2 of 4 | Planner time comes out of the demo | One recommended fill plus the list of rejected offers with reasons |
| 11 | No idempotency | 1 of 4 | A retry is a second 1,146 € order | `place_order` takes only a quote id; state change checked to touch exactly one row |
| 12 | The agent's free text can reach policy | 1 of 4 | Prompt injection widens scope | Policy reads typed fields only; text is shown escaped |
| 13 | Gemini, the MCP client and the phone are single points of failure | 1 of 4 | A stall inside two minutes | Plain HTTP path with curl, a manager tab on the laptop, a recorded agent run |
| 14 | The happy path shows no exception | 2 of 4 | 15 points rest on slides | Script the 10 l bulk request |
| 15 | "Append-only log" is only a claim | 1 of 4 | Weak for openness | Hash chain and a verify endpoint, about an hour; optional |

Reviewer claims that did not survive the check:
- "Bake 35 products into a static JSON file": Valio data may not be committed to the public repo. It goes into D1, loaded by a script.
- "Index one family, leave the other 17,500": a wide and shallow index is one script, because conversion happens at quote time from the
  price ratio. Keep it wide; verify three families by hand (milk in litres, chicken in kg with lot steps, one ambient family).
- "Drop D1": it holds the data that must stay out of git and gives the one-statement cap check. Keep it, one database for everything.
- "51 cases for 1,000 l": with the ratio snapped to 20 l it is 50 cases.

### 3.3 Missing from the design

A settable clock and recorded replies; the definition of orderable; the quote as a first-class object with an expiry (earliest of cut-off,
price `validTo`, 30 minutes); three-valued facts with coverage; a reason-code catalogue shared by the agent reply, approval page and
receipt; idempotency; cumulative limits; a statement of what is simulated; a scripted exception.

### 3.4 Cut for a solo build

Signed mandates; multiple plans; carbon and reliability thresholds beyond one reliability floor; per-day budgets beyond one cumulative
cap; brand lists; a generic substitution engine (one rule and the official pairs as hints); eggs and other requests in pieces; model-written
explanations; any model call inside the gateway.

## 4. Recommended final scope

### 4.1 Must have (about 18 hours)

| Order | Piece | Hours |
|---|---|---|
| 1 | Index script to D1: id, names, category, units, sales unit, lot, temperature, claims, allergens, labels, brand, origin, reliability, carbon, substitutes; subtype tags for three families | 2 |
| 2 | Offer core: Valio calls for a shortlist, sentinels, orderable, unit conversion, three-valued facts; tests on recorded replies with a set clock | 3 |
| 3 | `search_products` and `quote` (fill a quantity from open offers, list rejections with codes) | 2 |
| 4 | Mandate (server-side), policy with AUTO / NEEDS_APPROVAL / REJECT and reasons, order state machine: quote-bound, idempotent, cumulative cap | 2.5 |
| 5 | Approval page for a phone (diff against the request, countdown, expiry), receipt in plain language, event log | 2.5 |
| 6 | MCP wrapper over the same handlers, Gemini buyer agent script | 2 |
| 7 | OpenAPI file, README: reason codes, what is simulated, what Valio must add | 1 |
| 8 | Scenario hardening and the video | 3 |

Order matters: 1 to 3 give a testable lookup by Saturday noon; MCP comes after the HTTP path works.

### 4.2 Nice to have, in this order

Hash-chained log with a verify endpoint; a second scenario (chicken by kg with lot steps and limited stock); a split across two products;
sustainability badges (organic, MSC, Finnish origin); a small "decision replay" page.

### 4.3 Two-minute demo script

| Time | On screen | Rubric line |
|---|---|---|
| 0:00 to 0:12 | The raw API reply for the 10 l milk box: "999999 available, Monday". Its cut-off was Thursday 15:00. "An agent that trusts this orders milk that never arrives." | User need |
| 0:12 to 0:35 | The hotel's Gemini agent gets "1,000 litres of lactose-free milk by Monday, bulk packs preferred". Tool calls: `search_products` by type and claim gives 35; `quote` asks Valio about those 35 in 2 calls | End-to-end, lookup |
| 0:35 to 0:55 | The quote: bulk packs `CUTOFF_PASSED`, Arla `STOCK_LIMITED 384`, chosen 1,000 x 1 l = 50 cases at 1.01 €/l, 1,010.00 € + VAT, order by Sun 17:00; reliability 1.0, CO2 marked group average | Fixed price, exceptions, bonus |
| 0:55 to 1:20 | Mandate: alone up to 500 € an order. Outcome NEEDS_APPROVAL. Phone: what changed against the request (10 l boxes became 1 l cartons), countdown, Approve. Receipt in plain language | Guardrails, approval, explanation |
| 1:20 to 1:40 | Fast cuts: a 20 l order goes AUTO; three orders of 400 € hit the cumulative cap; a substitute that loses lactose-free is REJECTED; clock set to Sun 17:05 and the approval link has expired; a repeated `place_order` returns the same receipt | Guardrails, robustness |
| 1:40 to 2:00 | OpenAPI and MCP from one schema, reason-code list, the event log; "simulated: order acceptance. Valio adds: an order endpoint with reservation, category names, the cut-off calendar. No model decides anything in the gateway." | Openness |

Record it on Saturday evening against the live mock, with the replay mode as the spare.

### 4.4 Questions for the Valio booth

From REVIEW-2 section 13 (Fri 13 Nov), replacing the first list. Most important first; each is ready to ask as written.

1. **"Many Terminal products still report 999999 available for Monday 16 Nov although their closing time passed on Thursday. Is
   'no longer orderable for that date' the right reading? And is the mock a frozen snapshot of that Monday, or will it roll forward
   before judging?"**
   *Vì sao:* khoảnh khắc demo số 1 (cái bẫy 999999) và định nghĩa "đặt được" đều dựa trên cách đọc này; nếu sai, cả hai sụp.
2. **"When two customers want the same limited stock for the same delivery day, who gets it: the first confirmed order, contract
   customers first, or quotas? Does an order that is still waiting for the customer's own approval hold stock in the meantime?"**
   *Vì sao:* quyết định D2 (đơn chờ duyệt có giữ kho không) và luật "đơn được uỷ quyền trước thắng"; 149/246 sản phẩm đặt được có tồn kho hữu hạn.
3. **"Whose approval do you want to see in the flow: the buyer's manager, a Valio sales person, or both? And may Valio substitute a
   product or ship short without the buyer confirming first, given that some listed substitution pairs add an allergen?"**
   *Vì sao:* xác định ai là người duyệt trong hộp thư duyệt, và luật hàng thay thế/thiếu hàng phải qua người duyệt (20 điểm controls).
4. **"How do your customers really start an order: 'I need product X', a reorder of their usual list, or 'what should I buy for this
   event'? If the wholesaler's side suggests anything, what would you want it based on?"**
   *Vì sao:* quyết định D3: dừng ở form + bản đồ danh mục, hay làm tìm kiếm theo dịp; dữ liệu không có lịch sử bán nên ta không tự gợi ý số lượng.
5. **"How many lines does a typical order have, and when one line cannot be delivered do you ship the rest, hold the whole order, or
   ask the customer? Is there a minimum order value or a delivery charge per order?"**
   *Vì sao:* luật giỏ hàng: thiếu một dòng thì cần người duyệt (PARTIAL_BASKET) hay huỷ cả giỏ, và có nên gộp đơn theo ngày giao.
6. **"What do customers' systems send you today: your product codes, GTINs, or free-text names? And when the sales unit is a case, may
   a customer order single pieces, or does 0.01 in `allowedLotSize` simply mean whole sales units?"**
   *Vì sao:* thứ tự phân giải tên (mã → GTIN đơn vị bán → loại → tên) và luật làm tròn lên đơn vị bán nguyên.
7. **"Is the price fixed when the order is accepted or on the delivery day, and can `catalogPrice` change before the cut-off? What do
   `netPriceFound: false` and a missing delivery-reliability value mean?"**
   *Vì sao:* hạn của báo giá và luật PRICE_CHANGED khi duyệt; quyết định D4 (độ tin cậy không rõ: gắn cờ hay bắt duyệt, đang ảnh hưởng 14/37 sản phẩm).

Settled by the review, so no longer asked: budgets with or without VAT (the mandate compares net, the receipt shows both); what a
demo shows after Sunday 17:00 (recorded replies with a "replay" badge); which unit `availableAmount` uses when a line's unit differs
and what a product without schedule lines means (both refused as not orderable, the conservative reading).

## 5. How to stand out in a crowded challenge

Many teams at the venue picked this challenge. What follows about them is an expectation from the brief and the material, not something observed.

### 5.1 What a typical team will build

A chat window where a person types the request; a language model that calls the price and availability APIs as tools; product search by
name or by embeddings over the names; an "order placed" message; a budget rule written into the prompt and a "Confirm?" button for the
same person who typed the request. In short: the buyer's agent. The brief asks for the other side: the interface and operating model
that lets an external agent buy from Valio Aimo.

### 5.2 Where that loses points

| Rubric line | What the typical build does | Why it costs points |
|---|---|---|
| End-to-end demo (30) | Works on the poster example, because 464306 is open and unlimited | Scores here; but it is a chatbot, which the poster rules out, and the "order" is a sentence in a chat |
| Solving the user's need (20) | Reads "999999 on 16 Nov" as orderable; sorts by price per sales unit (the cheapest, 464440 at 0.88 €, is 0.5 l and has no schedule line); orders "1000" of a case product | Any request with a preference (bulk packs, organic, one brand) ends in an order Valio cannot deliver or a wrong quantity |
| Autonomy and controls (20) | Limits live in the prompt; the approver is the requester; no mandate; nothing binds the approved order to the placed one | Nothing is enforced: split orders, a retry or a persuasive prompt get through |
| Robustness (15) | Never notices that the date is ignored or that cut-offs exist; name search returns pudding and chocolate for "lactose-free milk"; official substitutes applied as listed | The demo keeps "working" after Sunday 17:00, which is itself the error; allergen changes pass unseen |
| Openness (15) | A custom chat UI and a prompt | No machine interface another agent can use, no reason codes, decisions cannot be replayed |

### 5.3 Three moments in our two minutes that a typical team will not have

1. **The trap, side by side (0:00 to 0:12, paid off at 0:35).** Left: the raw reply for the 10 l box 463038, "999999 available, Monday",
   and a plain agent ordering 50 cases. Right: our quote for the same request, `CUTOFF_PASSED: closed Thu 12 Nov 15:00`, with 1 l cartons
   offered instead. Real product codes and real times from the mock, so it cannot be dismissed as staged.
2. **We attack our own gateway (1:20 to 1:32).** The agent tries three orders of 400 € under the 500 € limit and hits the cumulative cap;
   asks for "1000" of a case product and gets "= 20,000 l, rejected"; proposes a listed substitute that loses the lactose-free claim and
   gets REJECT. Other teams show that the agent can buy. This shows what it cannot do.
3. **Time is a rule (1:32 to 1:40).** The clock is set to Sunday 17:05: the manager's approval link has expired and no order exists.
   A repeated `place_order` returns the same receipt. The approval was for a hash of the exact lines, and the page says so.

A fourth, if there is room: numbers that admit what they do not know ("reliability known for 17 of 35", "CO2 is a product-group average").

### 5.4 Positioning

- One line for the pitch: "Everyone built an agent. We built the door Valio can leave open."
- The screen must not look like a chat: tool calls and reason codes in one pane, the phone approval in the other, no message bubbles.
- Say "no model decides anything in the gateway" out loud; it answers "It is not a chatbot" directly.
- Use Valio's own words on screen: cut-off (`closingTime`), Stock and Terminal, sales unit, fixed price.
- Ask the booth questions in 4.4 early. They show the mentors that the cut-off and unit problems were found, and the answers may change the rules.
- Some strong teams will find the cut-off too. The lead then comes from moments 2 and 3 and from the honest "simulated" label.

## 6. Re-running the checks

```
set -a; . ./.env; set +a
python3 -I scripts/analysis/data_profile.py data
python3 -I scripts/analysis/explore_attrs.py data
python3 -I scripts/analysis/find_cats.py data "rintafilee" "kananmun"
python3 -I scripts/analysis/probe_requests.py data OUT_DIR lfmilk 10400 lf 2026-11-16 2026-11-14
python3 -I scripts/analysis/subs_carbon.py data
python3 -I scripts/analysis/conversion_check.py data OUT_DIR
```

`OUT_DIR` is a folder outside the repo for raw replies. `probe_requests.py` and `subs_carbon.py` call the live API (2 calls per date and
family); the rest are offline. Unverified: whether the snapshot changes over the weekend, and how other browsers parse `+0200`.
