// Inside's "Same sentence, several models": the same order sentences read by several models, scored against the
// expected reading. Read from models.json (the eval on main); the section stays hidden when that file is missing. DOM
// calls only (text, never markup).

const LEDE = "Models only read the words. Prices, limits, the cut-off and approval are the door's own code. When the reader and Gemma disagree, the door asks the kitchen instead of guessing.";

/** An element with a class and text. */
function el(tag, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== "") node.textContent = text;
  return node;
}

/** A table cell (th or td) with text and an optional class. */
function cell(tag, text, cls = "") {
  return el(tag, cls, String(text));
}

/** True when `data` has the shape the section needs. */
export function modelsReady(data) {
  return Boolean(data && Array.isArray(data.models) && data.models.length && Array.isArray(data.rows) && data.rows.length);
}

/** One model's scoreboard numbers as the cells show them; asked and wrongUnflagged are null for the second reader. */
export function scoreOf(m, sentences) {
  const second = m.asked === null && m.wrongUnflagged === null;
  return {
    exact: `${m.sentencesExact}/${sentences}`,
    fields: `${m.fieldsRight}/${m.fieldsTotal} fields`,
    asked: second ? "n/a" : String(m.asked),
    unflagged: second ? "n/a" : String(m.wrongUnflagged),
    risky: !second && m.wrongUnflagged > 0,
    ms: Number.isFinite(m.msMedian) ? `${Math.round(m.msMedian).toLocaleString("en-US")} ms` : "n/a",
    role: m.isDoorReader ? "Door's reader" : second ? "Second reader" : "",
  };
}

/** The scoreboard: one row per model with what it read right, what the door caught as a question and what slipped. */
function scoreboard(data) {
  const table = el("table", "models-score");
  const heads = ["Model", "Sentences read exactly", "Wrong, caught as a question", "Wrong, would have gone through", "Median time"];
  const head = el("tr");
  for (const h of heads) head.append(cell("th", h));
  const thead = el("thead");
  thead.append(head);
  const body = el("tbody");
  for (const m of data.models) {
    const s = scoreOf(m, data.sentences ?? data.rows.length);
    const tr = el("tr");
    tr.dataset.model = m.model;
    if (m.isDoorReader) tr.dataset.door = "";
    const name = cell("th", m.label ?? m.model);
    name.scope = "row";
    if (s.role) name.append(el("span", "models-role", s.role));
    const exact = el("td");
    exact.append(el("b", "", s.exact), el("span", "models-sub", s.fields));
    tr.append(name, exact, cell("td", s.asked), cell("td", s.unflagged, s.risky ? "models-risky" : ""), cell("td", s.ms, "models-ms"));
    [...tr.children].forEach((c, i) => i && (c.dataset.label = heads[i]));
    body.append(tr);
  }
  table.append(thead, body);
  return table;
}

/** What one reading shows in the grid: a check when exact, the wrong fields, or the error. */
export function readingText(r) {
  if (!r) return "n/a";
  if (r.error) return "error";
  if (r.exact) return "✓";
  return (r.wrongFields ?? []).join(", ") || "wrong";
}

/** The grid: one row per sentence, one column per model; each cell is exact or names the fields it read wrong. */
function grid(data) {
  const table = el("table", "models-grid");
  const head = el("tr");
  head.append(cell("th", "Sentence"));
  for (const m of data.models) head.append(cell("th", m.label ?? m.model));
  const thead = el("thead");
  thead.append(head);
  const body = el("tbody");
  for (const row of data.rows) {
    const tr = el("tr");
    const sentence = el("th");
    sentence.scope = "row";
    sentence.append(el("span", "models-text", `“${row.text}”`));
    if (row.note) sentence.append(el("span", "models-sub", row.note));
    tr.append(sentence);
    for (const m of data.models) {
      const r = row.readings?.[m.model];
      const td = cell("td", readingText(r), r?.exact ? "models-exact" : r?.error ? "models-error" : "models-wrong");
      if (r?.error) td.title = r.error;
      tr.append(td);
    }
    body.append(tr);
  }
  table.append(thead, body);
  return table;
}

/** A wrapper that scrolls sideways on its own when a table is wider than the page. */
function scroller(child, label) {
  const div = el("div", "models-scroll");
  div.tabIndex = 0;
  div.setAttribute("role", "region");
  div.setAttribute("aria-label", label);
  div.append(child);
  return div;
}

/** The section's content after its heading. */
export function modelsNodes(data) {
  const n = data.sentences ?? data.rows.length;
  const parts = [el("p", "models-lede", LEDE), scroller(scoreboard(data), "Scores per model"), el("h3", "", `${n} sentences, read by each model`), scroller(grid(data), "Each reading, sentence by sentence")];
  const meta = [`Second reader: ${data.secondReader}.`, data.today ? `Read as if today were ${data.today}.` : ""].filter(Boolean).join(" ");
  if (data.summary) parts.push(el("p", "models-summary", data.summary));
  parts.push(el("p", "models-meta", meta));
  return parts;
}

/** Loads models.json into `slot` and shows it; resolves to the data, or null (slot stays hidden) when it is missing. */
export async function mountModels(slot, url = "models.json", fetchImpl = fetch) {
  const data = await fetchImpl(url)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!modelsReady(data)) {
    slot.hidden = true;
    return null;
  }
  slot.replaceChildren(el("h2", "", "Same sentence, several models"), ...modelsNodes(data));
  slot.hidden = false;
  slot.dataset.loaded = "";
  return data;
}
