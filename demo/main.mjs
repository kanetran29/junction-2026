// Wires the scene to its two sources: the story timeline and the live gateway (or a recorded file).
import { initialState, reduce } from "./model.mjs";
import { STORY, DURATION, stateAt } from "./story.mjs";
import { connectLive, replayFile, sendRequest } from "./live.mjs";
import { buildScene } from "./scene.mjs";

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const store = {
  get: (name) => { try { return localStorage.getItem(`lazydoor.${name}`); } catch { return null; } },
  set: (name, value) => { try { localStorage.setItem(`lazydoor.${name}`, value); } catch { /* storage blocked: keep the value for this page only */ } },
};

document.body.dataset.theme = params.get("theme") ?? store.get("theme") ?? "light";
if (params.get("kiosk") === "1") document.body.classList.add("kiosk");
const scene = buildScene($("scene"));
const still = matchMedia("(prefers-reduced-motion: reduce)");

let mode = params.get("mode") === "live" ? "live" : "story";
const story = { t: 0, next: 0, state: initialState(), playing: false, snap: true };
const live = { state: initialState(), t0: performance.now() / 1000, abort: null };

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
}

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Updates the HTML overlays from state: caption, ticker, replay badge, end card. */
function overlays(state) {
  const caption = mode === "story" ? state.caption : state.log.at(-1) ? `${state.log.at(-1).type} · ${state.log.at(-1).text}` : "Waiting for gateway events…";
  const ending = mode === "story" && state.close;
  const shown = ending ? "" : caption;
  if ($("caption").textContent !== shown) $("caption").textContent = shown;
  if (ending && $("endline").textContent !== caption) $("endline").textContent = caption;
  const key = state.log.map((l) => `${l.seq}|${l.type}`).join(",");
  const ticker = $("ticker");
  if (ticker.dataset.key !== key) {
    ticker.dataset.key = key;
    ticker.replaceChildren(...state.log.slice(-7).map((l) => {
      const li = document.createElement("li");
      const seq = document.createElement("b");
      seq.textContent = l.seq ?? "";
      const body = document.createElement("span");
      body.textContent = l.text ? `${l.type} · ${l.text}` : l.type;
      li.append(seq, body);
      return li;
    }));
  }
  $("replay").hidden = !state.replay;
  $("endcard").hidden = !ending;
}

let last = performance.now();
/** Draws one frame dt seconds after the previous one. */
function render(dt) {
  if (mode === "story") {
    advance(dt);
    scene.draw(story.state, story.t, dt, story.snap || still.matches);
    story.snap = false;
    overlays(story.state);
    const scrub = $("scrub");
    if (document.activeElement !== scrub) scrub.value = story.t.toFixed(1);
    $("time").textContent = `${clock(story.t)} / ${clock(DURATION)}`;
  } else {
    scene.draw(live.state, performance.now() / 1000 - live.t0, dt, still.matches);
    overlays(live.state);
  }
}

/** The frame loop; with ?manual=1 a recorder calls window.__step(dt) instead, one deterministic frame per call. */
function frame(now) {
  render(Math.max(0, (now - last) / 1000));
  last = now;
  requestAnimationFrame(frame);
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
$("theme").addEventListener("click", () => {
  document.body.dataset.theme = document.body.dataset.theme === "light" ? "dark" : "light";
  store.set("theme", document.body.dataset.theme);
});
$("play").addEventListener("click", () => {
  if (story.t >= DURATION) seek(0);
  setPlaying(!story.playing);
});
$("restart").addEventListener("click", () => {
  seek(0);
  setPlaying(true);
});
$("scrub").max = String(DURATION);
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
if (params.get("manual") === "1") window.__step = (dt) => render(dt);
else requestAnimationFrame(frame);
