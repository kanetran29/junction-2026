// The Deck tab: the pitch deck's slides in one column, each with its speaker notes in a closed "Notes" disclosure, and the
// PDF to download. Built from deck.json (written by deck/build.mjs --site from pitch.json) with DOM calls only. On a door
// that supports the Claude connector, the demo slide's notes say how to connect it.
import { CONNECT, connectReady } from "./connect.mjs";
import { PITCH_VIDEO_URL } from "./inside.mjs";

/** An element with a class and text. */
function el(tag, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** Builds the tab into `root` from deck.json at `url`; resolves once the slides (or the reason they are missing) show. */
export async function mountDeck(root, url = "deck.json", base = location.origin) {
  let deck;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    deck = await res.json();
  } catch {
    root.replaceChildren(el("p", "muted", "The deck could not be loaded."));
    return;
  }
  const pdf = el("a", "btn btn-primary deck-pdf", "Download PDF");
  Object.assign(pdf, { href: deck.pdf, download: "lazydoor-deck.pdf" });
  const video = el("a", "btn btn-ghost", "Watch on YouTube");
  Object.assign(video, { href: PITCH_VIDEO_URL, target: "_blank", rel: "noopener" });
  const actions = el("div", "deck-actions");
  actions.append(video, pdf);
  const head = el("header", "deck-head");
  head.append(el("h1", "", "Pitch deck"), actions);
  const list = el("ol", "deck-slides");
  deck.slides.forEach((s, i) => {
    const img = el("img");
    Object.assign(img, { src: s.src, alt: s.heading, width: 1600, height: 900, decoding: "async", loading: i === 0 ? "eager" : "lazy" });
    const notes = el("details", "deck-notes");
    notes.append(el("summary", "", "Notes"), el("p", "", s.notes));
    const li = el("li", "deck-slide");
    li.append(img, notes);
    list.append(li);
  });
  root.replaceChildren(head, list);
  root.dataset.loaded = "";
  connectReady(base).then((ok) => {
    if (!ok) return;
    const at = deck.slides.findIndex((s) => s.id === "demo");
    list.children[at >= 0 ? at : deck.slides.length - 1].querySelector(".deck-notes").append(el("p", "deck-connect", CONNECT.deckNote));
  });
}
