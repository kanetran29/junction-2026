// The "Try it: you are the chef" panel under Live: input, example chips, Send, and one result area that shows the door's
// question, offer refusal, decision or the manager's phone card. Built with DOM calls only (text, never markup).
import { EXAMPLES, MAX_TEXT, CACHED_NOTE, PROGRESS, SLOW, stepAt, postTry, viewOf, VOICE_MAX_S, pickMime, postVoice, voiceViewOf, getPeppol, PEPPOL_LABEL, PEPPOL_CAPTION } from "./try.mjs";
import { hasRoute } from "./features.mjs";
import { ICONS } from "./icons.mjs";

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

/** A Phosphor icon from icons.mjs as inline SVG. */
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

/** The result area before any try: what to do, in one line. */
const EMPTY = "Pick an example or type your own. The door's answer shows here.";

/** A real button with a label and a click handler. */
function button(label, cls, onClick) {
  const b = el("button", cls, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** The input's label and placeholder while the chef writes a new request. */
const REQUEST_LABEL = "Your request, as the chef";

/**
 * Builds the panel into `root` and runs tries against the door at `base`. The result area is a short thread: the chef's
 * request, the door's question, the chef's answer, then the door's answer; while the door waits for an answer the input
 * is the answer box. `follow(buyerId)` points the scene at the visitor's sandbox buyer (and back to the kitchen with
 * null); `started()` is called as a try is sent.
 */
export function mountTry({ root, base, follow, started = () => {}, fetchImpl = fetch }) {
  let sandbox = loadSandbox();
  let codes = {};
  let pending = null;
  let busy = false;
  let waitTimer = null;

  const label = el("label", "try-label", REQUEST_LABEL);
  label.htmlFor = "try-text";
  const input = el("input", "try-input");
  Object.assign(input, { id: "try-text", type: "text", maxLength: MAX_TEXT, placeholder: EXAMPLES[0], autocomplete: "off", spellcheck: false });
  const send = el("button", "btn btn-primary try-send", "Send");
  const mic = el("button", "btn btn-ghost try-mic");
  mic.type = "button";
  const micTime = el("span", "try-mic-time");
  micTime.hidden = true;
  mic.append(icon("mic"), micTime);
  mic.hidden = true;
  const row = el("div", "try-row");
  send.type = "submit";
  const form = el("form", "try-form");
  row.append(input, mic, send);
  form.append(label, row);
  const chips = el("div", "try-chips");
  for (const text of EXAMPLES) chips.append(button(text, "try-chip", () => {
    if (pending) reset();
    input.value = text;
    input.focus();
  }));
  const empty = el("p", "try-empty", EMPTY);
  const thread = el("ol", "try-thread");
  thread.setAttribute("aria-label", "You and the door");
  const status = el("div", "try-status");
  const result = el("div", "try-result");
  result.setAttribute("aria-live", "polite");
  result.append(empty, thread, status);
  const restart = button("Start over", "try-restart", () => reset());
  restart.hidden = true;
  const back = button("Back to Hotel Aurora", "btn btn-ghost try-back", () => {
    follow(null);
    back.hidden = true;
  });
  back.hidden = true;
  const foot = el("div", "try-foot");
  foot.append(restart, back);
  root.replaceChildren(el("h2", "", "Try it: you are the chef"), el("p", "try-note", "Type a request. The door decides. If it holds the order, you decide as the kitchen manager. Your orders use a sandbox buyer of their own."), form, chips, result, foot);

  fetchImpl(`${String(base).replace(/\/+$/, "")}/v1/reason-codes`)
    .then((res) => (res.ok ? res.json() : null))
    .then((body) => {
      for (const c of body?.codes ?? []) codes[c.code] = c.text;
    })
    .catch(() => {});

  /** The input as the answer box for the door's question (`question` is its words), or back to a new request (null). */
  const asking = (question) => {
    label.textContent = question ? "Your answer" : REQUEST_LABEL;
    input.placeholder = question ?? EXAMPLES[0];
  };

  /** Clears the thread and the draft the door was asking about; the next Send is a new request. */
  const reset = () => {
    pending = null;
    thread.replaceChildren();
    status.replaceChildren();
    empty.hidden = false;
    restart.hidden = true;
    asking(null);
  };

  /** One message in the thread: the chef's words, or the door's box. */
  const message = (who, content) => {
    const li = el("li", `try-msg ${who === "chef" ? "from-chef" : "from-door"}`);
    li.append(el("span", "try-who", who === "chef" ? "You" : "Lazydoor"), typeof content === "string" ? el("p", "try-said", content) : content);
    return li;
  };

  /** Keeps Send off for `seconds` after a 429, counting down in the message's title (announced once, not every second). */
  const holdSend = (title, seconds) => {
    clearInterval(waitTimer);
    let left = seconds;
    send.disabled = true;
    title.setAttribute("aria-live", "off");
    waitTimer = setInterval(() => {
      left -= 1;
      if (left > 0) {
        title.textContent = `Busy: try again in ${left} s`;
        return;
      }
      clearInterval(waitTimer);
      waitTimer = null;
      send.disabled = false;
      title.removeAttribute("aria-live");
      title.textContent = "You can send again.";
    }, 1000);
  };

  /** The door's box for one view model: title, lines, the recorded-readings note, and its choice or decision buttons. */
  const boxOf = (view) => {
    const box = el("div", view.kind === "held" ? "try-box phone-card" : "try-box");
    box.dataset.kind = view.kind;
    box.dataset.tone = view.tone ?? "";
    if (view.kind === "held") {
      const bar = el("p", "phone-bar");
      bar.append(icon("bell"), el("span", "", "Approval request from Lazydoor"));
      box.append(bar);
    }
    box.append(el("p", "try-title", view.title), ...view.lines.map((line) => el("p", "try-line", line)));
    if (view.cached) box.append(el("p", "try-cached", CACHED_NOTE));
    const row = el("div", "try-actions");
    for (const c of view.choices ?? []) row.append(button(c.label, "btn btn-ghost try-choice", () => run({ choice: c })));
    for (const a of view.actions ?? []) row.append(button(a.label, `btn ${a.decision === "approve" ? "btn-primary" : "btn-ghost"} try-decide ${a.decision}`, () => decide(view.token, a.decision, box)));
    if (row.children.length) box.append(row);
    return box;
  };

  /** Shows a view: an error under the thread (the thread stays), the door's message in it, or hides the panel (404). Returns its box. */
  const show = (view) => {
    result.removeAttribute("aria-busy");
    if (view.kind === "hide") {
      clearInterval(waitTimer);
      root.dataset.off = "";
      return null;
    }
    chips.toggleAttribute("data-highlight", Boolean(view.examples));
    const box = boxOf(view);
    if (view.kind === "error") status.replaceChildren(box);
    else {
      status.replaceChildren();
      thread.append(message("door", box));
      restart.hidden = false;
    }
    empty.hidden = thread.children.length > 0 || status.children.length > 0;
    if (view.wait) holdSend(box.querySelector(".try-title"), view.wait);
    return box;
  };

  /**
   * Under an accepted order: the Peppol export of it, fetched with the visitor's token, as a download link and one line;
   * nothing shows when the door has no Peppol route (404) or the order has no id.
   */
  const attachPeppol = async (box, orderId) => {
    if (!box || !orderId || !sandbox?.visitor) return;
    const res = await getPeppol(base, orderId, sandbox.visitor, fetchImpl);
    if (res.status !== 200 || !res.blob) return;
    const a = el("a", "try-peppol", PEPPOL_LABEL);
    Object.assign(a, { href: URL.createObjectURL(res.blob), download: `lazydoor-order-${orderId}.xml` });
    box.append(a, el("p", "try-peppol-note", PEPPOL_CAPTION));
  };

  /** Posts to /v1/try; never throws. */
  const post = (payload) => postTry(base, "/v1/try", payload, fetchImpl);

  /**
   * Sends the typed request, or the answer to the door's question (typed, or a reading picked with `choice`), and shows the
   * reply in the thread; the scene follows the sandbox buyer. A door that does not take answers yet (400 or 404 on the
   * answer) gets the request and the answer as one new sentence, so the visitor never sees it forget.
   */
  const run = async ({ choice } = {}) => {
    if (busy || waitTimer) return;
    const said = choice?.label ?? input.value.trim();
    if (!said) {
      input.focus();
      show({ kind: "error", tone: "reject", title: pending ? "Type your answer first." : "Type a request first, or pick an example.", lines: [] });
      return;
    }
    const answering = pending;
    const mine = message("chef", said);
    if (answering) thread.append(mine);
    else thread.replaceChildren(mine);
    thread.querySelectorAll(".try-choice").forEach((b) => (b.disabled = true));
    if (!choice) input.value = "";
    empty.hidden = true;
    busy = true;
    send.disabled = true;
    const loading = el("div", "try-box try-loading");
    const steps = el("ol", "try-steps");
    const items = PROGRESS.map((p) => steps.appendChild(el("li", "", p.text)));
    const slow = el("p", "try-line try-slow", SLOW.text);
    loading.append(el("p", "try-title", "Sending to the door"), steps, slow, el("span", "skeleton"));
    const sentAt = performance.now();
    const tick = () => {
      const seconds = (performance.now() - sentAt) / 1000;
      const now = stepAt(seconds);
      items.forEach((li, i) => (li.dataset.state = i < now ? "done" : i === now ? "now" : "next"));
      slow.hidden = seconds < SLOW.at;
    };
    tick();
    const progress = setInterval(tick, 250);
    result.setAttribute("aria-busy", "true");
    status.replaceChildren(loading);
    chips.removeAttribute("data-highlight");
    started();
    if (sandbox?.buyerId) follow(sandbox.buyerId);
    let original = answering ? answering.original : said;
    let res;
    if (answering) {
      const answer = choice ? { field: choice.field, value: choice.value } : { text: said };
      res = await post(choice ? { text: original, visitor: sandbox?.visitor, draftId: answering.draftId, answer } : { visitor: sandbox?.visitor, draftId: answering.draftId, answer });
      if (res.status === 400 || res.status === 404) {
        original = `${original}, ${said}`.slice(0, MAX_TEXT);
        res = await post({ text: original, visitor: sandbox?.visitor });
      }
    } else res = await post({ text: said, visitor: sandbox?.visitor });
    clearInterval(progress);
    busy = false;
    send.disabled = false;
    if (res.status === 200 && res.body?.visitor) {
      const fresh = !sandbox || sandbox.buyerId !== res.body.buyerId;
      sandbox = { visitor: res.body.visitor, buyerId: res.body.buyerId };
      saveSandbox(sandbox);
      if (fresh) follow(sandbox.buyerId);
      back.hidden = false;
    }
    const view = viewOf(res, codes);
    if (view.kind === "error") {
      mine.remove();
      if (!choice) input.value = said;
      thread.querySelectorAll(".try-choice").forEach((b) => (b.disabled = false));
    } else if (view.kind === "question") {
      pending = { draftId: view.draftId ?? res.body?.draft?.draftId ?? res.body?.draftId ?? answering?.draftId ?? null, original };
      asking(view.title);
    } else {
      pending = null;
      asking(null);
    }
    const box = show(view);
    if (view.kind === "accepted") attachPeppol(box, res.body?.order?.orderId);
    if (pending) input.focus();
  };

  /** The visitor decides as the kitchen manager in the held order's `box`; the door's re-check is the next message. */
  const decide = async (token, decision, box) => {
    if (busy || !token) return;
    busy = true;
    box.querySelectorAll("button").forEach((b) => (b.disabled = true));
    const res = await postTry(base, "/v1/try/decision", { visitor: sandbox?.visitor, token, decision }, fetchImpl);
    busy = false;
    const view = viewOf(res, codes, true);
    if (view.kind === "error") box.querySelectorAll("button").forEach((b) => (b.disabled = false));
    const shown = show(view);
    if (view.kind === "accepted") attachPeppol(shown, res.body?.order?.orderId);
  };

  let rec = null;

  /** The mic button at rest (record) or while recording (stop, with the time so far out of the limit). */
  const micState = (recording) => {
    mic.replaceChildren(icon(recording ? "stop" : "mic"), micTime);
    mic.setAttribute("aria-pressed", String(recording));
    mic.setAttribute("aria-label", recording ? "Stop recording" : "Speak your request");
    mic.title = recording ? "Stop recording" : `Speak your request (up to ${VOICE_MAX_S} s)`;
    micTime.hidden = !recording;
    send.disabled = recording;
  };

  /** Records the chef's request from the microphone, at most VOICE_MAX_S seconds; a second press stops it. */
  const startVoice = async () => {
    if (busy || waitTimer) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const denied = err?.name === "NotAllowedError" || err?.name === "SecurityError";
      show({ kind: "error", tone: "reject", title: denied ? "The microphone is blocked for this page. Allow it in the browser, or type your request." : "No microphone was found. Type your request instead.", lines: [] });
      return;
    }
    const mime = pickMime((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    const startedAt = performance.now();
    rec = { recorder, stream, tooLong: false, tick: null };
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => finishVoice(new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" }));
    recorder.start(250);
    micState(true);
    const tick = () => {
      const s = Math.min(VOICE_MAX_S, Math.floor((performance.now() - startedAt) / 1000));
      micTime.textContent = `0:${String(s).padStart(2, "0")} / 0:${VOICE_MAX_S}`;
      if (performance.now() - startedAt >= VOICE_MAX_S * 1000) stopVoice(true);
    };
    tick();
    rec.tick = setInterval(tick, 250);
  };

  /** Stops the recording; `tooLong` when it reached the limit. */
  const stopVoice = (tooLong = false) => {
    if (!rec || rec.recorder.state === "inactive") return;
    rec.tooLong = tooLong;
    clearInterval(rec.tick);
    rec.recorder.stop();
  };

  /** Sends the recording to the door and puts the transcript in the input for the chef to check and send; never sends it. */
  const finishVoice = async (blob) => {
    const { stream, tooLong } = rec;
    stream.getTracks().forEach((t) => t.stop());
    rec = null;
    micState(false);
    if (!blob.size) {
      show({ kind: "error", tone: "reject", title: "Nothing was recorded. Try again, or type your request.", lines: [] });
      return;
    }
    busy = true;
    send.disabled = true;
    mic.disabled = true;
    const loading = el("div", "try-box try-loading");
    loading.append(el("p", "try-title", "Turning your voice into text"), ...(tooLong ? [el("p", "try-line", `Stopped at ${VOICE_MAX_S} s, the limit.`)] : []), el("span", "skeleton"));
    result.setAttribute("aria-busy", "true");
    status.replaceChildren(loading);
    empty.hidden = true;
    const res = await postVoice(base, blob, sandbox?.visitor, fetchImpl);
    busy = false;
    send.disabled = false;
    mic.disabled = false;
    if (res.status === 200 && res.body?.visitor && res.body?.buyerId) {
      sandbox = { visitor: res.body.visitor, buyerId: res.body.buyerId };
      saveSandbox(sandbox);
    }
    const view = voiceViewOf(res);
    if (view.kind === "hide-voice") {
      mic.hidden = true;
      show({ kind: "error", tone: "reject", title: "Voice is not available on this door. Type your request.", lines: [] });
      return;
    }
    if (view.kind !== "transcript") {
      show(view);
      return;
    }
    result.removeAttribute("aria-busy");
    input.value = view.text.slice(0, MAX_TEXT);
    status.replaceChildren(el("p", "try-voice-note", "From your voice: check it, change it if you like, then press Send."));
    empty.hidden = thread.children.length > 0 || status.children.length > 0;
    input.focus();
  };

  mic.addEventListener("click", () => (rec ? stopVoice() : startVoice()));
  micState(false);
  // Voice needs a recorder in this browser and a door that lists /v1/try/voice.
  if (typeof MediaRecorder !== "undefined" && navigator.mediaDevices?.getUserMedia) hasRoute(base, "/v1/try/voice", fetchImpl).then((ok) => (mic.hidden = !ok));

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });
  return { run, show, reset };
}
