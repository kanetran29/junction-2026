// Wires the scene to its two sources: the story timeline and the live gateway (or a recorded file).
import { initialState, reduce, countdown, shownNow } from "./model.mjs";
import { STORY, DURATION, VOICE, stateAt } from "./story.mjs";
import { connectLive, replayFile, sendRequest } from "./live.mjs";
import { buildScene, clockText } from "./scene.mjs";

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

let mode = params.get("mode") === "live" ? "live" : "story";
const story = { t: 0, next: 0, state: initialState(), playing: false, snap: true };
const live = { state: initialState(), t0: performance.now() / 1000, abort: null };
const voice = { audio: new Audio(), seg: -1, muted: store.get("muted") === "1" };

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
  const caption = mode === "story" ? state.caption : state.log.at(-1) ? `${state.log.at(-1).type} · ${state.log.at(-1).text}` : "Waiting for gateway events…";
  const ending = mode === "story" && state.close;
  const shown = ending ? "" : caption;
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
}

let last = performance.now();
/** Draws one frame dt seconds after the previous one. */
function render(dt) {
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
    scene.draw(live.state, performance.now() / 1000 - live.t0, dt, { calm: still.matches });
    overlays(live.state);
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
  const i = on ? VOICE.findIndex((v) => story.t >= v.at && story.t < v.at + v.dur) : -1;
  if (i < 0) {
    if (!a.paused) a.pause();
    voice.seg = -1;
    return;
  }
  const offset = story.t - VOICE[i].at;
  if (voice.seg !== i) {
    voice.seg = i;
    a.src = VOICE[i].src;
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

/** Shows the live connection status chip. */
function status(s, detail) {
  const chip = $("chip");
  chip.hidden = false;
  chip.dataset.s = s;
  chip.textContent = detail ? `${s} · ${detail}` : s;
}

/** Applies a live event at live scene time. */
const onLive = (ev) => (live.state = reduce(live.state, ev, performance.now() / 1000 - live.t0));

/** (Re)connects the live source: a .json path replays a recording, anything else is a gateway base URL. */
function connect() {
  live.abort?.abort();
  live.abort = new AbortController();
  live.state = initialState();
  live.t0 = performance.now() / 1000;
  const gw = $("gw").value.trim();
  const key = $("key").value;
  const buyer = $("buyer").value.trim();
  store.set("gw", gw);
  store.set("buyer", buyer);
  if (/\.json(\?|$)/.test(gw)) replayFile({ url: gw, onEvent: onLive, onStatus: status, signal: live.abort.signal });
  else connectLive({ base: gw || location.origin, key, buyer, since: 0, onEvent: onLive, onStatus: status, signal: live.abort.signal });
}

function setMode(next) {
  mode = next;
  document.querySelectorAll(".modes button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  $("story-controls").hidden = mode !== "story";
  $("live-controls").hidden = mode !== "live";
  $("mode-tag").textContent = mode === "story" ? "Story" : "Live";
  $("chip").hidden = mode !== "live";
  if (mode === "live") {
    setPlaying(false);
    connect();
  } else {
    live.abort?.abort();
    seek(story.t);
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

$("gw").value = params.get("gateway") ?? store.get("gw") ?? "";
$("key").value = params.get("key") ?? "";
$("buyer").value = params.get("buyer") ?? store.get("buyer") ?? "hotel-aurora";
$("connect").addEventListener("submit", (e) => { e.preventDefault(); connect(); });
$("sample").addEventListener("click", () => { $("gw").value = "fixtures/sample-events.json"; connect(); });
$("ask").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("ask-text").value.trim();
  if (!text) return;
  const out = $("ask-status");
  out.dataset.ok = "";
  out.textContent = "sending…";
  const gw = $("gw").value.trim();
  const result = await sendRequest({ base: /\.json(\?|$)/.test(gw) || !gw ? location.origin : gw, key: $("key").value, buyer: $("buyer").value.trim(), text });
  out.dataset.ok = String(result.ok);
  out.textContent = result.ok ? `order placed: ${result.order?.orderId ?? ""} ${result.order?.state ?? ""}`.trim() : `stopped at ${result.step}: ${result.error}`;
});

seek(Number(params.get("t")) || 0);
setMode(mode);
if (params.get("autoplay") === "1" && mode === "story") setPlaying(true);
rotateGate();
if (manual) window.__step = (dt) => render(dt);
else requestAnimationFrame(frame);
