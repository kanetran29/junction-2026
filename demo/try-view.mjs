// The "Try it: you are the chef" panel under Live: input, example chips, Send, and one result area that shows the door's
// question, offer refusal, decision or the manager's phone card. Built with DOM calls only (text, never markup).
import { EXAMPLES, MAX_TEXT, postTry, viewOf } from "./try.mjs";

const STORE_KEY = "lazydoor.try";

/** The visitor's sandbox ({ visitor, buyerId }) from sessionStorage, so a reload keeps it; null when storage is blocked. */
function loadSandbox() {
  try {
    return JSON.parse(sessionStorage.getItem(STORE_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** Remembers the visitor's sandbox for this tab; ignored when storage is blocked. */
function saveSandbox(sandbox) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(sandbox));
  } catch {
    /* storage blocked: the sandbox lasts for this page only */
  }
}

/** An element with a class and text. */
function el(tag, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** A real button with a label and a click handler. */
function button(label, cls, onClick) {
  const b = el("button", cls, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/**
 * Builds the panel into `root` and runs tries against the door at `base`. `follow(buyerId)` points the scene at the
 * visitor's sandbox buyer (and back to the kitchen with null); `started()` is called as a try is sent.
 */
export function mountTry({ root, base, follow, started = () => {}, fetchImpl = fetch }) {
  let sandbox = loadSandbox();
  let codes = {};
  let lastText = "";
  let draftId = null;
  let busy = false;

  const label = el("label", "try-label", "Your request to the door");
  label.htmlFor = "try-text";
  const input = el("input", "try-input");
  Object.assign(input, { id: "try-text", type: "text", maxLength: MAX_TEXT, placeholder: EXAMPLES[0], autocomplete: "off", spellcheck: false });
  const send = el("button", "try-send", "Send");
  send.type = "submit";
  const form = el("form", "try-form");
  form.append(label, input, send);
  const chips = el("div", "try-chips");
  for (const text of EXAMPLES) chips.append(button(text, "try-chip", () => { input.value = text; input.focus(); }));
  const result = el("div", "try-result");
  result.setAttribute("aria-live", "polite");
  const back = button("Back to Hotel Aurora", "try-back", () => {
    follow(null);
    back.hidden = true;
  });
  back.hidden = true;
  root.replaceChildren(el("h2", "", "Try it: you are the chef"), el("p", "try-note", "Type a request as the kitchen's chef. The door decides; if it holds the order, you decide as the kitchen manager. Your orders use a sandbox buyer of their own."), form, chips, result, back);

  fetchImpl(`${String(base).replace(/\/+$/, "")}/v1/reason-codes`)
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => {
      for (const c of body?.codes ?? []) codes[c.code] = c.text;
    })
    .catch(() => {});

  /** Shows one view model in the result area, with its choice or decision buttons. */
  const show = (view) => {
    if (view.kind === "hide") {
      root.dataset.off = "";
      return;
    }
    const box = el("div", "try-box");
    box.dataset.kind = view.kind;
    box.dataset.tone = view.tone ?? "";
    box.append(el("p", "try-title", view.title), ...view.lines.map((line) => el("p", "try-line", line)));
    const row = el("div", "try-actions");
    for (const c of view.choices ?? []) row.append(button(c.label, "try-choice", () => run({ answer: { field: c.field, value: c.value } })));
    for (const a of view.actions ?? []) row.append(button(a.label, `try-decide ${a.decision}`, () => decide(view.token, a.decision)));
    if (row.children.length) box.append(row);
    result.replaceChildren(box);
  };

  /** Sends the typed request (or the answer to the door's question) and shows the reply; the scene follows the sandbox buyer. */
  const run = async (extra = {}) => {
    if (busy) return;
    const text = extra.answer ? lastText : input.value.trim();
    busy = true;
    send.disabled = true;
    result.replaceChildren(el("p", "try-title", "The door is working…"));
    started();
    if (sandbox?.buyerId) follow(sandbox.buyerId);
    const res = await postTry(base, "/v1/try", { text, visitor: sandbox?.visitor, ...(extra.answer ? { draftId, answer: extra.answer } : {}) }, fetchImpl);
    busy = false;
    send.disabled = false;
    if (res.status === 200 && res.body?.visitor) {
      const fresh = !sandbox || sandbox.buyerId !== res.body.buyerId;
      sandbox = { visitor: res.body.visitor, buyerId: res.body.buyerId };
      saveSandbox(sandbox);
      if (fresh) follow(sandbox.buyerId);
      back.hidden = false;
      lastText = text;
      draftId = res.body.draft?.id ?? res.body.draft?.draftId ?? res.body.draftId ?? draftId;
    }
    show(viewOf(res, codes));
  };

  /** The visitor decides as the kitchen manager; shows the final state the door's re-check gives. */
  const decide = async (token, decision) => {
    if (busy || !token) return;
    busy = true;
    result.querySelectorAll("button").forEach((b) => (b.disabled = true));
    const res = await postTry(base, "/v1/try/decision", { visitor: sandbox?.visitor, token, decision }, fetchImpl);
    busy = false;
    show(viewOf(res, codes, true));
  };

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });
  return { run, show };
}
