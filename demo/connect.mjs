// "Connect Claude": how to add Lazydoor to Claude as a custom connector and what happens next. Off until the connector
// flow is confirmed (`enabled`); then it shows only on a door that publishes its OAuth metadata. Every word is here.
import { DOOR_URL } from "./inside.mjs";
import { answers } from "./features.mjs";

export const CONNECT = {
  enabled: false,
  heading: "Connect Claude",
  lede: "Let your own Claude order through the door.",
  mcpUrl: `${DOOR_URL}/mcp`,
  steps: ["In Claude, open Settings → Connectors → Add custom connector.", "Paste this URL:", "Sign in on the Lazydoor page that opens."],
  nextHeading: "What happens next",
  next: [
    "You get your own sandbox kitchen, with limits of 500 € per order and 1,500 € per day.",
    "Claude can search, quote and order.",
    "Anything over a limit waits for you on your kitchen page, because Claude cannot approve.",
  ],
  kitchen: { href: `${DOOR_URL}/kitchen`, label: "Open your kitchen page" },
  metadata: "/.well-known/oauth-authorization-server",
  deckNote: `Try it with your own Claude: Settings → Connectors → Add custom connector, then ${DOOR_URL}/mcp.`,
};

const checked = {};
/** True when the section is switched on and the door at `base` publishes its OAuth metadata (checked once per page). */
export const connectReady = (base, fetchImpl = fetch) => (CONNECT.enabled ? (checked[base] ??= answers(base, CONNECT.metadata, fetchImpl)) : Promise.resolve(false));

/** An element with a class and text. */
function el(tag, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** The section's content: the heading, the three steps with the connector URL to copy, what happens next, the kitchen link. */
function connectNodes() {
  const steps = el("ol", "connect-steps");
  CONNECT.steps.forEach((text, i) => {
    const li = el("li", "", text);
    if (i === 1) {
      const row = el("span", "connect-url");
      const copy = el("button", "btn btn-ghost btn-small", "Copy");
      copy.type = "button";
      copy.setAttribute("aria-label", `Copy ${CONNECT.mcpUrl}`);
      copy.addEventListener("click", () => navigator.clipboard?.writeText(CONNECT.mcpUrl).then(() => (copy.textContent = "Copied"), () => {}));
      row.append(el("code", "", CONNECT.mcpUrl), copy);
      li.append(row);
    }
    steps.append(li);
  });
  const next = el("ul", "connect-next");
  for (const text of CONNECT.next) next.append(el("li", "", text));
  const kitchen = el("a", "btn btn-ghost", CONNECT.kitchen.label);
  kitchen.href = CONNECT.kitchen.href;
  return [el("h2", "", CONNECT.heading), el("p", "connect-lede", CONNECT.lede), steps, el("h3", "", CONNECT.nextHeading), next, kitchen];
}

/** Fills `root` with the section when the door supports the connector; otherwise leaves it hidden. Resolves to whether it shows. */
export async function mountConnect(root, base, fetchImpl = fetch) {
  const ok = await connectReady(base, fetchImpl);
  if (ok) root.replaceChildren(...connectNodes());
  root.hidden = !ok;
  return ok;
}
