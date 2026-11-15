// Inside's "Use it your way": the door's newer ways in, each one sentence and one action, each shown only while the door
// advertises it (features.mjs): from Claude (the connector), by voice (Try it's mic), into an ordering system (the Peppol
// export). The pictures are real screenshots: Try it recording, and the door's own Peppol XML in a browser's XML viewer.
import { featuresOn } from "./features.mjs";
import { connectorUrl } from "./connect.mjs";

export const WAYS = [
  {
    feature: "connector",
    title: "From Claude",
    text: "Add Lazydoor to Claude as a custom connector, no key needed: you get your own kitchen with signed limits, and you approve in your kitchen tab, never Claude.",
  },
  {
    feature: "voice",
    title: "By voice",
    text: "Say the order into Try it: the words come back for you to check, then the same two readers and the same rules apply.",
    action: { label: "Try it by voice", mode: "live", anchor: "try-panel" },
    still: { src: "assets/ways/voice.webp", width: 1692, height: 170, alt: "Try it recording a spoken request: the timer reads 0:04 of 0:30 and Send waits.", caption: "Recording in Try it: up to 30 s, then the words land in the box." },
  },
  {
    feature: "peppol",
    title: "Into your ordering system",
    text: "Every accepted order exports as Peppol BIS Order 3.0 (UBL 2.1). Export only; nothing is sent.",
    action: { label: "Order in Try it", mode: "live", anchor: "try-panel" },
    still: { src: "assets/ways/peppol.webp", width: 1400, height: 844, alt: "The door's Peppol BIS Order 3.0 XML of the Story's milk order in a browser's XML viewer: delivery 16 Nov, 1010.00 EUR net, 1000 of 464306 Valio Eila 1 l.", caption: "The door's own export of the Story's 1,010.00 € milk order, in a browser's XML viewer." },
  },
  {
    feature: "cancel",
    title: "Change your mind",
    text: "An agent cancels its own accepted or held order until Valio's cut-off: the stock goes back on sale, the day total frees up, and the door signs the cancellation. After the cut-off the order stands.",
    code: "POST /v1/orders/{id}/cancel · MCP\u00a0cancel_order",
  },
];

/** An element with a class and text. */
function el(tag, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** One way in: its title, sentence and action, and its screenshot when it has one. */
function way(w, go) {
  const box = el("article", w.still ? "way" : "way way-plain");
  box.dataset.feature = w.feature;
  const text = el("div", "way-text");
  text.append(el("h3", "", w.title), el("p", "", w.text));
  if (w.action) {
    const b = el("button", "btn btn-ghost", w.action.label);
    b.type = "button";
    b.addEventListener("click", () => go(w.action.mode, w.action.anchor));
    text.append(b);
  } else if (w.code) text.append(el("code", "way-code", w.code));
  else text.append(connectorUrl());
  box.append(text);
  if (w.still) {
    const fig = el("figure", "still way-still");
    const img = el("img");
    Object.assign(img, { src: w.still.src, alt: w.still.alt, width: w.still.width, height: w.still.height, loading: "lazy", decoding: "async" });
    fig.append(img, el("figcaption", "", w.still.caption));
    box.append(fig);
  }
  return box;
}

/** Fills `section` with the ways the door at `base` advertises; leaves it hidden when there are none. Resolves to how many show. */
export async function mountWays(section, base, go, fetchImpl = fetch) {
  const on = await featuresOn(base, fetchImpl);
  const live = WAYS.filter((w) => on[w.feature]);
  if (live.length) section.replaceChildren(el("h2", "", "Use it your way"), ...live.map((w) => way(w, go)));
  section.hidden = !live.length;
  return live.length;
}
