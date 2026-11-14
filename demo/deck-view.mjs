// The Deck tab: the pitch deck's slides in one column, each with its speaker notes in a closed "Notes" disclosure, and the
// PDF to download. Built from deck.json (written by deck/build.mjs --site from pitch.json) with DOM calls only.

/** An element with a class and text. */
function el(tag, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** Builds the tab into `root` from deck.json at `url`; resolves once the slides (or the reason they are missing) show. */
export async function mountDeck(root, url = "deck.json") {
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
  const head = el("header", "deck-head");
  head.append(el("h1", "", "Pitch deck"), pdf);
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
}
