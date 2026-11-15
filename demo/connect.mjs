// "Connect Claude": how to add Lazydoor to Claude as a custom connector, in the flow the build session confirmed on the live
// door. Shown only while the door advertises the connector (mcp.oauth in its discovery document).
import { DOOR_URL } from "./inside.mjs";
import { connectorOn } from "./features.mjs";

export const CONNECT = {
  heading: "Connect Claude",
  lede: "Let your own Claude order through the door. No key, no client id.",
  mcpUrl: `${DOOR_URL}/mcp`,
  steps: [
    "In Claude, open Settings → Connectors → Add custom connector, with this URL:",
    "Claude opens Lazydoor's page “Connect Claude to Lazydoor”. It shows your kitchen's signed limits: up to 500 € an order and 1,500 € a day go through on their own; above that the order waits for you; over 5,000 € an order or 10,000 € a day is refused. Click Allow.",
    "On “Your kitchen is ready”, open “Open your kitchen” in a new tab and keep it: that is where you approve. Then click “Continue to Claude”.",
    "Ask Claude, for example “Order 1,000 litres of lactose-free milk by Monday.” Claude quotes and places the order, and it is held (about 1,010 € net). Claude never gets the approval link, and its token is refused (403) on every approval.",
    "Approve in your kitchen tab: the order is accepted.",
  ],
  note: "The kitchen ends after 20 idle minutes or a demo reset; Claude then asks you to connect again.",
  deckNote: `Connect your own Claude: Settings → Connectors → Add custom connector, URL ${DOOR_URL}/mcp. Allow, keep your kitchen tab open, and approve there; Claude never can.`,
};

/** True while the door at `base` advertises the connector (mcp.oauth in its discovery document). */
export const connectReady = (base, fetchImpl = fetch) => connectorOn(base, fetchImpl);

/** An element with a class and text. */
function el(tag, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** The connector URL with a Copy button. */
export function connectorUrl() {
  const row = el("span", "connect-url");
  const copy = el("button", "btn btn-ghost btn-small", "Copy");
  copy.type = "button";
  copy.setAttribute("aria-label", `Copy ${CONNECT.mcpUrl}`);
  copy.addEventListener("click", () => navigator.clipboard?.writeText(CONNECT.mcpUrl).then(() => (copy.textContent = "Copied"), () => {}));
  row.append(el("code", "", CONNECT.mcpUrl), copy);
  return row;
}

/** The section's content: the heading, the five steps (the first with the connector URL to copy) and when the kitchen ends. */
function connectNodes() {
  const steps = el("ol", "connect-steps");
  CONNECT.steps.forEach((text, i) => {
    const li = el("li", "", text);
    if (i === 0) li.append(connectorUrl());
    steps.append(li);
  });
  return [el("h2", "", CONNECT.heading), el("p", "connect-lede", CONNECT.lede), steps, el("p", "connect-note", CONNECT.note)];
}

/** Fills `root` with the section when the door advertises the connector; otherwise leaves it hidden. Resolves to whether it shows. */
export async function mountConnect(root, base, fetchImpl = fetch) {
  const ok = await connectReady(base, fetchImpl);
  if (ok) root.replaceChildren(...connectNodes());
  root.hidden = !ok;
  return ok;
}
