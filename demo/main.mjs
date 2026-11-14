// Wires the scene to its two sources: the story timeline and the live gateway (or a recorded file).
import { initialState, liveState, reduce, otherBuyer, countdown, shownNow, clockText, closingFades } from "./model.mjs";
import { STORY, DURATION, VOICE, SFX, stateAt } from "./story.mjs";

/** Everything on the narration track, in time order: the voice lines and the rewind sound. */
const CLIPS = [...VOICE, ...SFX].sort((a, b) => a.at - b.at);
import { connectLive, readBacklog } from "./live.mjs";
import { buildScene } from "./scene.mjs";
import { STRENGTHS, PAGE_ONLY, GROUPS, COMPARE_NOTE, CONNECT_LINE } from "./compare.mjs";
import { ICONS } from "./icons.mjs";
import { mountInside } from "./inside-view.mjs";
import { runCheck, CHECKS } from "./inside.mjs";
import { mountTry } from "./try-view.mjs";

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const store = {
  get: (name) => { try { return localStorage.getItem(`lazydoor.${name}`); } catch { return null; } },
  set: (name, value) => { try { localStorage.setItem(`lazydoor.${name}`, value); } catch { /* storage blocked: keep the value for this page only */ } },
};

document.body.dataset.theme = "dark";
const kiosk = params.get("kiosk") === "1";
const manual = params.get("manual") === "1";
if (kiosk) document.body.classList.add("kiosk");
const scene = buildScene($("scene"));
const still = matchMedia("(prefers-reduced-motion: reduce)");

let mode = ["live", "compare", "inside"].includes(params.get("mode")) ? params.get("mode") : "story";
/** The pages that replace the stage (no scene, no story or live). */
const PAGES = ["compare", "inside"];
let insideMounted = false;
const story = { t: 0, next: 0, state: initialState(), playing: false, snap: true };
/** Live watches the door at ?gateway= (a local preview against the deployed door) or the page's own origin, and follows ?buyer=. */
const GATEWAY = params.get("gateway") || location.origin;
const BUYER = params.get("buyer") || "hotel-a";
const live = { state: liveState(BUYER), t0: performance.now() / 1000, abort: null, queue: [], nextAt: 0, lines: [], caption: "", captionUntil: 0, snap: false, following: BUYER, recent: [], lastSeq: 0, tryFrom: 0 };
let tryMounted = false;
const voice = { audio: new Audio(), seg: -1, muted: store.get("muted") === "1" };

/** An element with a class and text (never markup), for the comparison built from compare.mjs. */
function el(tag, cls, text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  node.textContent = text;
  return node;
}

/** Fills the Story's closing comparison (eight rows, ✕ without the door, ✓ with Lazydoor) and the Compare page's table. */
function buildCompare() {
  $("compare-rows").replaceChildren(...STRENGTHS.map((row) => {
    const li = el("li");
    li.append(el("span", "cmp-without", `✕ ${row.without}`), el("span", "cmp-with", `✓ ${row.with}`));
    return li;
  }));
  $("compare-foot").textContent = CONNECT_LINE;
  $("compare-note").textContent = COMPARE_NOTE;
  const rows = [...STRENGTHS, ...PAGE_ONLY];
  $("compare-groups").replaceChildren(...GROUPS.map((g) => {
    const group = el("section", "pair-group");
    group.append(el("h2", "", g.heading));
    for (const row of rows.filter((r) => r.group === g.id)) {
      const pair = el("article", "pair");
      const without = el("p", "side without");
      without.append(glyph("cross"), el("span", "", row.without));
      const withDoor = el("div", "side with");
      const line = el("p");
      line.append(glyph("check"), el("span", "", row.with));
      const tags = el("span", "chips");
      for (const e of row.evidence) tags.append(el("span", "chip proof", e));
      withDoor.append(line, tags);
      pair.append(el("h3", "", row.topic), without, withDoor);
      group.append(pair);
    }
    return group;
  }));
}

/** A Phosphor glyph (check or cross) from icons.mjs, inline. */
function glyph(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", `glyph ${name}`);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name]);
  svg.append(path);
  return svg;
}

/** Jumps the story to t seconds: state rebuilt from the timeline, moving parts snapped. */
function seek(t) {
  story.t = Math.max(0, Math.min(DURATION, t));
  story.state = stateAt(story.t);
  story.next = STORY.findIndex((item) => item.at > story.t);
  if (story.next < 0) story.next = STORY.length;
  story.snap = true;
}

/** Advances the story clock and applies the beats it passes. */
function advance(dt) {
  if (!story.playing) return;
  story.t = Math.min(DURATION, story.t + dt);
  while (story.next < STORY.length && STORY[story.next].at <= story.t) {
    const item = STORY[story.next++];
    story.state = reduce(story.state, item.ev, item.at);
  }
  if (story.t >= DURATION) setPlaying(false);
}

function setPlaying(on) {
  story.playing = on;
  $("play").textContent = on ? "Pause" : "Play";
  syncVoice();
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Updates the HTML overlays from state at scene time t: caption, ticker, clock, rewind label, replay badge, end card. */
function overlays(state, t = 0) {
  const caption = mode === "story" ? state.caption : live.caption;
  const ending = mode === "story" && state.close;
  const shown = ending || (mode === "story" && state.compare) ? "" : caption;
  if ($("caption").textContent !== shown) $("caption").textContent = shown;
  const key = state.log.map((l) => `${l.seq}|${l.type}`).join(",");
  const ticker = $("ticker");
  if (ticker.dataset.key !== key) {
    ticker.dataset.key = key;
    ticker.replaceChildren(...state.log.slice(-3).map((l) => {
      const li = document.createElement("li");
      li.textContent = l.text ? `${l.seq ?? ""} ${l.type}: ${l.text}` : `${l.seq ?? ""} ${l.type}`;
      return li;
    }));
  }
  const clockNow = mode === "story" ? shownNow(state, t) : state.now;
  const warp = mode === "story" && state.warp;
  const rewinding = Boolean(warp?.back && t >= warp.since && t < warp.since + warp.dur + 0.3);
  $("rewind").hidden = !rewinding;
  $("stage").toggleAttribute("data-rewind", rewinding);
  const left = countdown(clockNow);
  const big = $("hud-countdown");
  $("hud-rule").hidden = !state.gate.built;
  big.hidden = !state.gate.built;
  const remaining = !clockNow ? "-" : left === "closed" ? "Closed" : left;
  if (big.textContent !== remaining) big.textContent = remaining;
  big.toggleAttribute("data-closed", left === "closed");
  const time = clockNow ? clockText(clockNow).replace(/ \d+ \w+ /, " ") : "";
  const now = !time ? "" : state.gate.built ? `Cut-off Sun 17:00 · now ${time}` : `Now ${clockText(clockNow)}`;
  if ($("hud-now").textContent !== now) $("hud-now").textContent = now;
  $("replay").hidden = !state.replay;
  $("endcard").hidden = !ending;
  const comparing = mode === "story" && Boolean(state.compare) && !ending;
  $("compare").hidden = !comparing;
  if (mode === "story") {
    const fades = closingFades(state, t);
    $("endcard").style.opacity = ending ? fades.end.toFixed(3) : "";
    $("compare").style.opacity = fades.compare.toFixed(3);
    [...$("compare-rows").children].forEach((li, i) => {
      li.style.opacity = fades.rows[i].toFixed(3);
      li.style.transform = fades.rows[i] < 1 ? `translateY(${((1 - fades.rows[i]) * 0.6).toFixed(3)}cqw)` : "";
    });
  }
}

let last = performance.now();
/** Draws one frame dt seconds after the previous one. */
function render(dt) {
  if (PAGES.includes(mode)) return;
  if (mode === "story") {
    advance(dt);
    syncVoice();
    scene.draw(story.state, story.t, dt, { snap: story.snap, calm: still.matches, story: true });
    story.snap = false;
    overlays(story.state, story.t);
    const scrub = $("scrub");
    if (document.activeElement !== scrub) scrub.value = story.t.toFixed(1);
    $("time").textContent = `${clock(story.t)} / ${clock(DURATION)}`;
  } else {
    const t = performance.now() / 1000 - live.t0;
    paceLive(t);
    scene.draw(live.state, t, dt, { calm: still.matches, snap: live.snap });
    live.snap = false;
    overlays(live.state, t);
  }
}

/** The frame loop; with ?manual=1 a recorder calls window.__step(dt) instead, one deterministic frame per call. */
function frame(now) {
  render(Math.max(0, (now - last) / 1000));
  last = now;
  requestAnimationFrame(frame);
}

/**
 * Keeps the narration in step with the story clock: plays the line whose window holds the story time, from the matching
 * offset, and pauses between lines, when paused or muted, and while a recorder steps frames by hand.
 */
function syncVoice() {
  const a = voice.audio;
  const on = mode === "story" && story.playing && !voice.muted && !manual;
  const i = on ? CLIPS.findIndex((v) => story.t >= v.at && story.t < v.at + v.dur) : -1;
  if (i < 0) {
    if (!a.paused) a.pause();
    voice.seg = -1;
    return;
  }
  const offset = story.t - CLIPS[i].at;
  if (voice.seg !== i) {
    voice.seg = i;
    a.src = CLIPS[i].src;
    a.currentTime = offset;
  } else if (Math.abs(a.currentTime - offset) > 0.35) a.currentTime = offset;
  if (a.paused) a.play().catch(() => {});
}

/** Shows whether the narration is on and remembers the choice. */
function setMuted(on) {
  voice.muted = on;
  store.set("muted", on ? "1" : "0");
  $("mute").textContent = on ? "Sound off" : "Sound on";
  $("mute").setAttribute("aria-pressed", String(on));
  syncVoice();
}

const portrait = matchMedia("(orientation: portrait) and (max-width: 640px)");
const rotate = { dismissed: false, resume: false };
/** Covers the stage with a rotate prompt on a narrow portrait screen and holds the story until the phone turns or the viewer watches anyway. */
function rotateGate() {
  const show = portrait.matches && !rotate.dismissed && !kiosk;
  if (show === !$("rotate").hidden) return;
  $("rotate").hidden = !show;
  if (show) {
    rotate.resume = story.playing;
    setPlaying(false);
  } else if (rotate.resume) {
    rotate.resume = false;
    setPlaying(true);
  }
}

/** The status chip in words for a viewer. */
const STATUS = { connecting: "Connecting to the door…", streaming: "Watching the door live · connected", polling: "Watching the door live · checking every few seconds", down: "The door is not answering · retrying" };
function status(s) {
  const chip = $("chip");
  chip.hidden = mode !== "live";
  chip.dataset.s = s;
  chip.textContent = STATUS[s] ?? s;
}

/** Queues a live event: the door often sends several in the same instant, and the scene shows them one after another. */
/** Events after which Live re-checks the door's hash chain. */
const ORDER_EVENTS = new Set(["policy.decided", "order.accepted", "approval.approved", "approval.rejected", "approval.expired"]);
const AUDIT_GAP_MS = 10000;
let auditAt = -Infinity;
let auditTimer = null;

/**
 * Re-checks the door's hash-chained log (/v1/audit/verify) and shows the result as a chip in the ticker's header; the chip
 * stays hidden while the route is not deployed or not reachable. At most one check every 10 s, with one more at the end
 * of a burst, so dozens of kitchens ordering at once do not multiply the calls from every open page.
 */
async function checkAudit() {
  const wait = auditAt + AUDIT_GAP_MS - Date.now();
  if (wait > 0) {
    auditTimer ??= setTimeout(() => {
      auditTimer = null;
      checkAudit();
    }, wait);
    return;
  }
  auditAt = Date.now();
  const out = await runCheck(GATEWAY, CHECKS.find((c) => c.id === "audit"));
  const chip = $("audit-chip");
  chip.dataset.state = out.state;
  chip.textContent = out.state === "bad" ? "Audit chain ✕" : "Audit chain ✓";
  chip.hidden = mode !== "live" || !["ok", "bad"].includes(out.state);
}

/** Queues a live event (the door often sends several in the same instant) and re-checks the audit chain after order events. */
const onLive = (ev) => {
  live.queue.push(ev);
  live.recent = [...live.recent.slice(-299), ev];
  if (typeof ev.seq === "number") live.lastSeq = Math.max(live.lastSeq, ev.seq);
  if (ORDER_EVENTS.has(ev.type)) checkAudit();
};

/**
 * Applies queued live events at most one every 0.45 s (faster when many wait), and keeps each plain-words caption up for
 * at least 2.5 s and long enough to read at 17 characters a second; when captions pile up, only the newest two are kept.
 * Other kitchens' events are ticker lines only and take no turn, so a crowd of visitors never delays the followed kitchen.
 */
function paceLive(t) {
  while (live.queue.length && t >= live.nextAt) {
    const ev = live.queue.shift();
    const quiet = otherBuyer(live.state, ev);
    live.state = reduce(live.state, ev, t);
    const line = live.state.seq === ev.seq ? live.state.log.at(-1)?.plain : null;
    if (line) live.lines = [...live.lines, line].slice(-2);
    if (!quiet) live.nextAt = t + (live.queue.length > 12 ? 0.08 : 0.45);
  }
  if (live.lines.length && t >= live.captionUntil) {
    live.caption = live.lines.shift();
    live.captionUntil = t + Math.max(2.5, live.caption.length / 17);
  }
}

/**
 * Points the scene at another buyer: a visitor's sandbox during "Try it" (its events since the try started are played
 * again for it), or back to the kitchen (null). The door's clock carries over; the kitchen's rule board shows only for it.
 */
function followBuyer(buyerId) {
  const target = buyerId ?? BUYER;
  if (target === live.following && buyerId !== null) return;
  const clock = { now: live.state.now, clockSet: live.state.clockSet };
  live.following = target;
  document.body.dataset.follow = target;
  live.state = { ...liveState(target), ...clock, rules: target === BUYER };
  live.queue = buyerId === null ? [] : live.recent.filter((ev) => ev.seq > live.tryFrom);
  Object.assign(live, { snap: true, lines: [], caption: buyerId === null ? "Watching Hotel Aurora's kitchen again." : "Your order, as the door sees it.", captionUntil: 0 });
}

/**
 * (Re)connects to the door: reads its event log once and starts after the newest event, keeping only the door's clock
 * from the past (no burst of old animations), then follows new events as they come. Retries while the door is down.
 */
async function connect() {
  live.abort?.abort();
  const ctl = (live.abort = new AbortController());
  Object.assign(live, { state: liveState(BUYER), t0: performance.now() / 1000, queue: [], nextAt: 0, lines: [], caption: "Watching the door. Waiting for an agent…", captionUntil: 0, snap: true, following: BUYER, recent: [] });
  status("connecting");
  let since = 0;
  for (;;) {
    try {
      const backlog = await readBacklog({ base: GATEWAY, signal: ctl.signal });
      since = backlog.last;
      const clock = backlog.events.findLast((ev) => ev.type === "clock.set");
      if (clock) live.state = reduce(live.state, clock, -60);
      break;
    } catch {
      if (ctl.signal.aborted) return;
      status("down");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  checkAudit();
  connectLive({ base: GATEWAY, since, onEvent: onLive, onStatus: status, signal: ctl.signal });
}

function setMode(next) {
  mode = next;
  document.querySelectorAll(".modes button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  $("story-controls").hidden = mode !== "story";
  $("live-note").hidden = mode !== "live";
  $("try-panel").hidden = mode !== "live" || kiosk;
  if (mode === "live" && !kiosk && !tryMounted) {
    tryMounted = true;
    mountTry({ root: $("try-panel"), base: GATEWAY, follow: followBuyer, started: () => (live.tryFrom = live.lastSeq) });
  }
  $("stage").hidden = PAGES.includes(mode);
  $("compare-page").hidden = mode !== "compare";
  $("inside-page").hidden = mode !== "inside";
  if (mode !== "live") $("audit-chip").hidden = true;
  if (mode === "inside" && !insideMounted) {
    insideMounted = true;
    mountInside($("inside-page"), GATEWAY, (next, anchor) => {
      setMode(next);
      if (anchor) requestAnimationFrame(() => $(anchor)?.scrollIntoView({ behavior: still.matches ? "auto" : "smooth", block: "start" }));
    });
  }
  $("mode-tag").textContent = mode === "story" ? "Story" : "Live";
  $("chip").hidden = mode !== "live";
  if (mode === "live") {
    setPlaying(false);
    connect();
  } else {
    live.abort?.abort();
    if (PAGES.includes(mode)) setPlaying(false);
    else seek(story.t);
  }
}

document.querySelectorAll(".modes button").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
$("play").addEventListener("click", () => {
  if (!$("rotate").hidden) {
    rotate.dismissed = true;
    rotateGate();
  }
  if (story.t >= DURATION) seek(0);
  setPlaying(!story.playing);
});
$("restart").addEventListener("click", () => {
  seek(0);
  setPlaying(true);
});
$("scrub").max = String(DURATION);
$("mute").addEventListener("click", () => setMuted(!voice.muted));
$("watch").addEventListener("click", () => {
  rotate.dismissed = true;
  rotateGate();
});
portrait.addEventListener("change", rotateGate);
setMuted(voice.muted);
$("scrub").addEventListener("input", (e) => seek(Number(e.target.value)));
document.addEventListener("keydown", (e) => {
  if (mode !== "story" || e.target.closest("input, textarea")) return;
  if (e.key === " ") { e.preventDefault(); $("play").click(); }
  if (e.key === "ArrowRight") seek(story.t + 5);
  if (e.key === "ArrowLeft") seek(story.t - 5);
});

buildCompare();
seek(Number(params.get("t")) || 0);
setMode(mode);
if (params.get("autoplay") === "1" && mode === "story") setPlaying(true);
rotateGate();
if (manual) window.__step = (dt) => render(dt);
else requestAnimationFrame(frame);
