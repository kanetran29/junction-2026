# Lazydoor: live pitch notes (3 min)

## 01 Agents will order for kitchens. Who checks the agent?

Kitchens will let AI agents do the ordering. Valio's API answers availability and price, but nothing in it checks whether the agent's order makes sense. So who checks the agent?

## 02 Friday 16:30: an agent orders milk for Monday

Hotel Aurora's chef needs 1,000 litres of lactose-free milk by Monday. The agent calls Valio's API, sees 999999 and Monday, orders 50 cases of 10-litre boxes. But 999999 means stock unknown, and that box closed on Thursday at 15:00. Nobody checked, nobody approved. Monday morning, there is no milk. And this is not a corner case: in 539 recorded availability replies, 58% of stock figures are the 999999 placeholder and 40% of lines past their cut-off still show a delivery date; 29 of Valio's 250 substitution pairs add an allergen.

## 03 One door at Valio for every agent

Lazydoor is one door at Valio that any agent goes through. It applies two layers of rules: Valio's, the same for everyone, and each kitchen's own signed mandate. Inside the kitchen's limits the agent is done alone; above them the door holds the order and asks the kitchen manager. Lazy at the order, strict at the border.

## 04 Words in, a checked order out

The same sentence again, through the door. Gemini turns it into a typed request and Gemma reads it a second time on its own. The door searches the catalogue and asks Valio only about the 35 lactose-free milks, not everything. 20 are past their cut-off and say so with a reason code. Best offer: one-litre cartons, 1,010 euros, price held for 30 minutes.

## 05 Strict at the border

This is the part judges asked for: autonomy with controls. The agent cannot approve its own order. It cannot split an order to slip under the limit. A Valio substitute that adds gluten is refused. Two agents racing for six boxes: one wins, the other is told two are left. And an approval after Valio's cut-off expires.

## 06 Try it: type a request, decide as the manager

DEMO, about two minutes. Open the demo page on the deployed door. Show the Story from the door going up to the held order and the manager's phone. Then Live: hand the laptop to the reviewer and let them type a request in Try it, or click a chip. If the door holds it, they approve as the kitchen manager. End on Inside: the audit chain is valid, checked live. Two more ways in: say the order with the mic, or connect your own Claude with one URL; the same rules apply, and Claude can never approve.

## 07 Built to be trusted

Every write lives in Aiven PostgreSQL through Hyperdrive. Each order commits in one transaction under an advisory lock, so the stock ledger never oversells, and every step is an event in a hash-chained log. Quotes and receipts are signed with the door's Ed25519 key, published at /.well-known/jwks.json. Gemini drafts, Gemma double-checks. Any agent connects through the typed HTTP API or the MCP server. Every accepted order also exports as a Peppol BIS Order 3.0 document (UBL 2.1), export only, and Claude connects over OAuth 2.1 to a sandbox kitchen of its own.

## 08 It works, and you can check it

This is not a mock-up. 69 acceptance cases and 11 scenarios pass on the deployed door. A real Gemini agent ordered milk: held, approved by the manager, accepted at 1,010 euros. And you don't have to trust us: /v1/audit/verify recomputes the hash chain and signs the result, and our verify script checks it from outside. Change one byte of a quote and the door refuses it.

## 09 Path to production

Ordering is simulated today because Valio's API has no order endpoint. Valio adds that endpoint and its allocation rule; the door, the rules and the agents stay as they are. Kitchens sign their limits once, and any agent can plug in. Lazy at the order, strict at the border. Thank you. The pitch video: youtu.be/etiVUAh1mYw.
