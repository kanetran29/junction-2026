// The isometric scene: static parts built once from the anatomy kit, moving parts driven from model state each frame.
import * as k from "./kit/iso-kit.mjs";
import { euro, countdown, CUTOFF } from "./model.mjs";

export const W = 1600;
export const H = 900;
const CAPTION_BAND = 96;

const PLATE = { x: -312, y: -122, w: 624, d: 244, r: 12 };
const LANE = 12;
const GATE_X = -70;
const HINGE = [GATE_X, -14];
const LEAF_LEN = 50;
const RACK_X = [-8, 62, 132, 202];
const RACK = { y: -104, d: 28, w: 62, h: 66 };
const TRUCK = { x: 146, y: 56, d: 38 };
const CHEF = [-242, -40];
const PHONE = { x: -300, y: 92, w: 54, d: 4, z: 30, h: 72 };
const BOARD = { x: -54, y: 98, w: 70, d: 3, r: 1.2, z: 20, h: 46 };
const CLOCK = { x: 96, y: -113, w: 140, d: 4, r: 1.2, z: 90, h: 38 };

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -24, 0), [PLATE.x + 262, PLATE.y, 132], [PLATE.x + PLATE.w, PLATE.y, 132], [GATE_X, 0, 128]],
  W,
  H - CAPTION_BAND,
  { pad: 18, azimuth: 120 },
);
const KS = k.cameraOf(P).k;

const S = (paths, style = {}) => k.solidSvg(paths, style);
const slab = (plan, z, h, style = {}, steps = 4, bevel = 0.6) => S(k.slabOf(plan, z, h, P, steps, bevel), style);
const cyl = (x, y, r, z, h, style = {}, steps = 28) => S(k.cylinder(x, y, r, z, h, P, steps), style);
const L = (d, style = {}) => k.lineSvg(d, style);
const at = (point) => k.iso(point, P);
const dots = (points, style = {}) => k.dotsSvg(points.map(at), style);
const seg = (a, b) => k.segment(a, b, P);
const f1 = (v) => Math.round(v * 10) / 10;
/** Maps local (u, v) on the plane y = const to world (x0 + u, y, z0 − v): text and marks on a face that looks at the viewer. */
const face = (x0, y, z0) => k.sideMatrix([x0, y], z0, P, "left");
const text = (id, x, y, size, cls = "", anchor = "start", content = "") => `<text${id ? ` data-id="${id}"` : ""} class="disp ${cls}" x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}">${content}</text>`;

/** Base plate on feet, floor inlays, lane, road and a front ruler strip. */
function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -24, 14, P)}"/>`];
  const feet = k.corners(PLATE, 26).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P));
  for (const [x, y] of feet) {
    out.push(cyl(x, y, 9, -24, 2, { tone: "lo" }), cyl(x, y, 7, -22, 8, { tone: "mid" }));
  }
  out.push(slab(PLATE, -14, 14, { tone: "mid" }, 8, 1.6));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "faint" }));
  const screws = k.corners(PLATE, 11);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }), dots(screws.map(([x, y]) => [x, y, 0]), { size: 0.7 }));
  const kitchen = { x: -300, y: -110, w: 214, d: 172, r: 3 };
  out.push(slab(kitchen, 0, 0.6, { tone: "lo", crease: "none" }, 3, 0));
  const tiles = [];
  for (let x = kitchen.x + 20; x < kitchen.x + kitchen.w; x += 20) tiles.push(k.lineOnTop([x, kitchen.y], [x, kitchen.y + kitchen.d], 0.6, P));
  for (let y = kitchen.y + 20; y < kitchen.y + kitchen.d; y += 20) tiles.push(k.lineOnTop([kitchen.x, y], [kitchen.x + kitchen.w, y], 0.6, P));
  out.push(L(tiles.join(""), { tone: "faint" }));
  const dock = { x: -54, y: -12, w: 344, d: 46, r: 2 };
  out.push(slab(dock, 0, 0.6, { tone: "lo", crease: "none" }, 3, 0));
  out.push(L(k.lineOnTop([dock.x, LANE + 2], [dock.x + dock.w, LANE + 2], 0.6, P), { tone: "faint", dashed: true }));
  const road = { x: 112, y: 44, w: 196, d: 66, r: 2 };
  out.push(slab(road, 0, 0.8, { tone: "lo", crease: "none" }, 3, 0));
  out.push(L(k.lineOnTop([road.x, road.y + 4], [road.x + road.w, road.y + 4], 0.8, P) + k.lineOnTop([road.x, road.y + road.d - 4], [road.x + road.w, road.y + road.d - 4], 0.8, P), { tone: "faint" }));
  const strip = { x: -292, y: PLATE.y + PLATE.d - 11, w: 584, d: 7, r: 1 };
  out.push(slab(strip, 0, 0.6, { tone: "lo", crease: "none" }, 3, 0));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 8, 6, strip.y + 0.8, 0.6, [2, 3.8], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  return out.join("");
}

/** The hotel kitchen: counter with stove, pots and knobs, a backsplash with a plate shelf. */
function kitchen() {
  const out = [];
  out.push(slab({ x: -304, y: -118, w: 128, d: 5, r: 1 }, 0, 74, { tone: "mid" }, 3));
  out.push(slab({ x: -298, y: -113, w: 116, d: 7, r: 1 }, 52, 3, { tone: "mid" }, 3));
  for (let i = 0; i < 5; i++) out.push(cyl(-288 + i * 22, -110, 7, 55, 1.4, { tone: "hi" }, 24));
  const counter = { x: -300, y: -112, w: 120, d: 34, r: 2 };
  out.push(slab(counter, 0, 32, { tone: "mid" }, 3, 0.6));
  out.push(slab(k.insetPlan(counter, -1.5), 32, 3, { tone: "hi" }, 3, 0.6));
  out.push(L(k.segment([counter.x + 60, counter.y + counter.d, 0], [counter.x + 60, counter.y + counter.d, 32], P), { tone: "lo" }));
  out.push(dots([[-290, -78, 26], [-282, -78, 26], [-274, -78, 26], [-232, -78, 26], [-224, -78, 26]], { size: 1.3, tone: "mid" }));
  for (const [x, r, h] of [[-276, 9, 13], [-250, 7, 9], [-206, 8, 16]]) {
    out.push(L(k.ring(x, -95, r + 3, 35, P, 28), { tone: "lo" }));
    out.push(cyl(x, -95, r, 35, h, { tone: "hi" }, 28));
    out.push(L(k.sideArc(x, -95, r, 35 + h - 2.5, P, 20), { tone: "faint" }));
    out.push(slab({ x: x + r - 1, y: -96.5, w: 7, d: 3, r: 1 }, 35 + h - 4, 2, { tone: "mid" }, 2, 0));
  }
  return out.join("");
}

/** The chef: shoes, trousers, white coat with buttons and apron, neckerchief, head and toque. */
function chef() {
  const [x, y] = CHEF;
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: x - 13, y: y - 11, w: 26, d: 22, r: 10 }, 0, 0.1, P)}" style="filter:blur(4px)"/>`];
  out.push(slab({ x: x - 9, y: y - 3, w: 7, d: 10, r: 2 }, 0, 3, { tone: "mid" }, 2), slab({ x: x + 2, y: y - 3, w: 7, d: 10, r: 2 }, 0, 3, { tone: "mid" }, 2));
  out.push(cyl(x, y, 8, 3, 16, { tone: "mid" }, 28));
  out.push(slab({ x: x - 16, y: y - 4, w: 5, d: 8, r: 2 }, 24, 22, { tone: "hi" }, 2), slab({ x: x + 11, y: y - 4, w: 5, d: 8, r: 2 }, 24, 22, { tone: "hi" }, 2));
  out.push(cyl(x, y, 11, 19, 30, { tone: "hi" }, 36));
  out.push(slab({ x: x - 8, y: y + 9, w: 16, d: 2.4, r: 1 }, 14, 24, { tone: "hi", crease: "lo" }, 2, 0));
  out.push(dots([[x - 3, y + 11.4, 44], [x + 3, y + 11.4, 44], [x - 3, y + 11.4, 39], [x + 3, y + 11.4, 39]], { size: 1.2, tone: "hi" }));
  out.push(cyl(x, y, 6.5, 49, 3, { tone: "mid" }, 24));
  const head = at([x, y, 58]);
  out.push(`<circle class="iso-fill" cx="${f1(head[0])}" cy="${f1(head[1])}" r="${f1(8 * KS)}"/><circle class="iso-line skin" data-tone="hi" cx="${f1(head[0])}" cy="${f1(head[1])}" r="${f1(8 * KS)}"/>`);
  const eye = (dx) => at([x + dx, y + 7.4, 59]);
  out.push(`<circle class="eye" cx="${f1(eye(-3)[0])}" cy="${f1(eye(-3)[1])}" r="${f1(1 * KS)}"/><circle class="eye" cx="${f1(eye(3)[0])}" cy="${f1(eye(3)[1])}" r="${f1(1 * KS)}"/>`);
  out.push(cyl(x, y, 7.6, 64, 7, { tone: "hi" }, 28));
  const puff = at([x, y, 78]);
  out.push(`<ellipse class="iso-fill" cx="${f1(puff[0])}" cy="${f1(puff[1])}" rx="${f1(10.5 * KS)}" ry="${f1(7.5 * KS)}"/><ellipse class="iso-line" data-tone="hi" cx="${f1(puff[0])}" cy="${f1(puff[1])}" rx="${f1(10.5 * KS)}" ry="${f1(7.5 * KS)}"/>`);
  return out.join("");
}

/** A robot built at the origin, facing the viewer; tone sets the agent (hi) or the naive grey one (lo). */
function robot(tone) {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: -13, y: -11, w: 26, d: 22, r: 10 }, 0, 0.1, P)}" style="filter:blur(4px)"/>`];
  out.push(cyl(0, 0, 12.5, 0, 4, { tone: "mid" }, 32));
  out.push(L(k.knurl(0, 0, 12.5, 0, 4, 40, P, 0.6), { tone: "faint" }));
  out.push(cyl(0, 0, 10, 4, 4, { tone: "mid" }, 28));
  out.push(slab({ x: -14.5, y: -2.5, w: 4, d: 12, r: 1.5 }, 17, 4, { tone: "mid" }, 2), slab({ x: 10.5, y: -2.5, w: 4, d: 12, r: 1.5 }, 17, 4, { tone: "mid" }, 2));
  const body = { x: -11, y: -9, w: 22, d: 18, r: 4 };
  out.push(slab(body, 8, 26, { tone }, 5, 0.8));
  out.push(L(k.sideSeam(body, 30, P, 5), { tone: "faint" }));
  out.push(dots([[-6, 9, 26], [-2, 9, 26], [2, 9, 26]], { size: 1, tone: "mid" }));
  out.push(cyl(0, 0, 3.2, 34, 3, { tone: "mid" }, 20));
  const head = { x: -10, y: -8, w: 20, d: 16, r: 4 };
  out.push(slab(head, 37, 15, { tone }, 5, 0.8));
  out.push(`<g transform="${face(-7, 8.05, 48)}"><rect class="visor" x="0" y="0" width="14" height="6" rx="2.5"/><circle class="eye-lit" cx="4" cy="3" r="1.3"/><circle class="eye-lit" cx="10" cy="3" r="1.3"/></g>`);
  out.push(L(seg([0, 0, 52], [0, 0, 61]), { tone: "mid" }));
  out.push(dots([[0, 0, 62]], { size: 1.8, tone: "hi" }));
  return out.join("");
}

/** The card the agent holds in front of its body; colour comes from data-carry and data-stamp. */
function card() {
  const plan = { x: -9, y: 10, w: 18, d: 1.6, r: 0.6 };
  return `<g class="card">${slab(plan, 13, 19, { tone: "hi", crease: "lo" }, 2, 0)}<g transform="${face(-8, 11.65, 31)}"><rect class="card-face" x="0" y="0" width="16" height="17" rx="1"/><rect class="card-line" x="2.5" y="3" width="11" height="1.4"/><rect class="card-line" x="2.5" y="6.5" width="8" height="1.4"/><circle class="card-stamp" cx="11" cy="12" r="3.4"/></g></g>`;
}

/** One warehouse rack with three levels of crates, a tag rail on top, a lock bar and an X for crossed-out shelves. */
function rack(i) {
  const x0 = RACK_X[i];
  const { y, d, w, h } = RACK;
  const out = [];
  const posts = [[x0, y], [x0 + w - 4, y], [x0, y + d - 4], [x0 + w - 4, y + d - 4]];
  for (const [px, py] of posts.slice(0, 2)) out.push(slab({ x: px, y: py, w: 4, d: 4, r: 0.6 }, 0, h, { tone: "mid" }, 2, 0));
  [4, 25, 46].forEach((z, level) => {
    out.push(slab({ x: x0, y, w, d, r: 1 }, z, 2.4, { tone: "mid" }, 2, 0.4));
    const crates = [];
    for (let c = 0; c < 3; c++) {
      const plan = { x: x0 + 5 + c * 18.5, y: y + 5, w: 15.5, d: 19, r: 1 };
      crates.push(slab(plan, z + 2.4, 14, { tone: "hi" }, 2, 0.5) + L(k.sideSeam(plan, z + 2.4 + 10, P, 2), { tone: "faint" }));
    }
    out.push(`<g class="crates lv${level}">${crates.join("")}</g>`);
  });
  for (const [px, py] of posts.slice(2)) out.push(slab({ x: px, y: py, w: 4, d: 4, r: 0.6 }, 0, h + 2, { tone: "mid" }, 2, 0));
  const tag = { x: x0 + 4, y: y + d - 3, w: w - 8, d: 3, r: 0.8 };
  out.push(slab(tag, h + 2, 20, { tone: "hi", crease: "lo" }, 2, 0.4));
  out.push(`<g transform="${face(tag.x, tag.y + tag.d + 0.1, h + 22)}"><rect class="tag-face" x="1.5" y="1.5" width="${tag.w - 3}" height="17" rx="1"/>${text(`tag${i}a`, tag.w / 2, 8.2, 5.2, "tag-id", "middle")}${text(`tag${i}b`, tag.w / 2, 15.4, 5.2, "tag-st", "middle")}</g>`);
  const front = y + d + 0.5;
  out.push(`<g class="lock">${slab({ x: x0 - 2, y: front, w: w + 4, d: 2, r: 0.6 }, 36, 4, { tone: "hi", className: "red-solid" }, 2, 0)}${slab({ x: x0 + w / 2 - 4, y: front + 2, w: 8, d: 3, r: 1 }, 30, 9, { tone: "hi", className: "red-solid" }, 2, 0)}</g>`);
  out.push(`<g class="cross"><path class="x-line" d="${seg([x0, front, 2], [x0 + w, front, h])}${seg([x0 + w, front, 2], [x0, front, h])}"/></g>`);
  return `<g class="rack" data-rack="${i}" data-status="idle">${out.join("")}</g>`;
}

/** Warehouse back wall with panel seams and the cut-off clock board. */
function warehouse() {
  const wall = { x: -50, y: -120, w: 352, d: 7, r: 1 };
  const out = [slab(wall, 0, 132, { tone: "mid" }, 3, 0.8)];
  const seams = [];
  for (let x = wall.x + 44; x < wall.x + wall.w; x += 44) seams.push(seg([x, wall.y + wall.d, 0], [x, wall.y + wall.d, 132]));
  out.push(L(seams.join(""), { tone: "faint" }));
  out.push(`<g transform="${face(-38, wall.y + wall.d + 0.1, 122)}">${text("", 0, 0, 6, "engraved", "start", "VALIO AIMO · WAREHOUSE")}</g>`);
  out.push(slab(CLOCK, CLOCK.z, CLOCK.h, { tone: "hi", crease: "lo" }, 3, 0.6));
  out.push(dots([[CLOCK.x + 4, CLOCK.y + CLOCK.d, CLOCK.z + CLOCK.h - 4], [CLOCK.x + CLOCK.w - 4, CLOCK.y + CLOCK.d, CLOCK.z + CLOCK.h - 4], [CLOCK.x + 4, CLOCK.y + CLOCK.d, CLOCK.z + 4], [CLOCK.x + CLOCK.w - 4, CLOCK.y + CLOCK.d, CLOCK.z + 4]], { size: 1, tone: "mid" }));
  out.push(`<g transform="${face(CLOCK.x, CLOCK.y + CLOCK.d + 0.1, CLOCK.z + CLOCK.h)}"><rect class="screen" x="7" y="3" width="${CLOCK.w - 14}" height="${CLOCK.h - 6}" rx="2"/>${text("", CLOCK.w / 2, 11, 5, "dim", "middle", "VALIO CUT-OFF · SUN 15 NOV 17:00")}${text("countdown", CLOCK.w / 2, 24.5, 12, "big", "middle")}${text("now", CLOCK.w / 2, 31.5, 4.6, "dim", "middle")}</g>`);
  return out.join("");
}

/** Border fence along x = GATE_X: back run, front run with a gap beside the gate, posts and caps. */
function fence(from, to) {
  const out = [slab({ x: GATE_X - 3, y: from, w: 6, d: to - from, r: 0.6 }, 0, 30, { tone: "mid" }, 2, 0.4)];
  out.push(slab({ x: GATE_X - 4, y: from, w: 8, d: to - from, r: 1 }, 30, 3, { tone: "mid" }, 2, 0.4));
  const posts = [];
  for (let y = from; y <= to - 6; y += Math.max(20, (to - from - 6) / Math.round((to - from) / 28))) posts.push(y);
  for (const y of posts) out.push(slab({ x: GATE_X - 5, y, w: 10, d: 6, r: 1 }, 0, 38, { tone: "mid" }, 2, 0.4), dots([[GATE_X, y + 3, 38]], { size: 0.9 }));
  return out.join("");
}

/** A gate post with hinge knuckles on its lane side. */
function post(y0, hinge) {
  const plan = { x: GATE_X - 8, y: y0, w: 16, d: 14, r: 1.5 };
  const out = [slab(plan, 0, 100, { tone: "mid" }, 3, 0.8), L(k.sideSeam(plan, 12, P, 3) + k.sideSeam(plan, 88, P, 3), { tone: "faint" })];
  if (hinge) for (const z of [12, 44, 74]) out.push(cyl(HINGE[0], HINGE[1] + 1, 2.2, z, 7, { tone: "hi" }, 16));
  return out.join("");
}

/** Beam over the gate, scanner head on its buyer side and the beacon lamp that shows the stamp. */
function beam() {
  const out = [slab({ x: GATE_X - 10, y: -30, w: 20, d: 82, r: 1.5 }, 100, 10, { tone: "mid" }, 3, 0.8)];
  out.push(dots([[GATE_X - 6, -26, 110], [GATE_X - 6, 48, 110], [GATE_X + 6, -26, 110], [GATE_X + 6, 48, 110]], { size: 0.9 }));
  out.push(slab({ x: GATE_X - 20, y: -10, w: 10, d: 42, r: 1.5 }, 92, 10, { tone: "mid" }, 3, 0.6));
  out.push(`<path class="scan-glass" d="${k.pathOf([at([GATE_X - 20, -8, 92]), at([GATE_X - 20, 30, 92]), at([GATE_X - 17, 30, 92]), at([GATE_X - 17, -8, 92])], true)}"/>`);
  out.push(cyl(GATE_X, 11, 8, 110, 4, { tone: "mid" }, 28));
  out.push(`<g class="beacon">${cyl(GATE_X, 11, 6, 114, 11, { tone: "hi", className: "beacon-lamp" }, 28)}</g>`);
  out.push(cyl(GATE_X, 11, 7, 125, 2.4, { tone: "mid" }, 28));
  return out.join("");
}

/** The status board in front of the gate: the stamp and its published reason codes. */
function statusBoard() {
  const b = BOARD;
  const out = [];
  for (const x of [b.x + 6, b.x + b.w - 10]) out.push(slab({ x, y: b.y - 2, w: 4, d: 4, r: 1 }, 0, b.z, { tone: "mid" }, 2, 0));
  out.push(slab({ x: b.x - 4, y: b.y - 6, w: b.w + 8, d: 12, r: 2 }, 0, 3, { tone: "mid" }, 3, 0.4));
  out.push(slab(b, b.z, b.h, { tone: "hi", crease: "lo" }, 3, 0.6));
  out.push(`<g class="board" transform="${face(b.x, b.y + b.d + 0.1, b.z + b.h)}"><rect class="screen" x="4" y="3" width="${b.w - 8}" height="${b.h - 6}" rx="2"/>${text("", 9, 11, 5, "dim", "start", "LAZYDOOR")}<circle class="stamp-dot" cx="${b.w - 11}" cy="9.4" r="3"/>${text("stamp", 9, 22.5, 6.2, "stamp-text")}${text("r1", 9, 31.5, 5, "mono")}${text("r2", 9, 38, 5, "mono")}</g>`);
  return out.join("");
}

/** The manager's phone on a side table: the approval inbox. */
function phone() {
  const p = PHONE;
  const out = [];
  out.push(slab({ x: p.x - 8, y: p.y - 12, w: p.w + 16, d: 22, r: 2 }, 0, 26, { tone: "mid" }, 3, 0.6));
  out.push(slab({ x: p.x - 9, y: p.y - 13, w: p.w + 18, d: 24, r: 2 }, 26, 2.4, { tone: "hi" }, 3, 0.6));
  out.push(slab({ x: p.x + 8, y: p.y - 5, w: p.w - 16, d: 9, r: 2 }, 28.4, 3, { tone: "mid" }, 3, 0.4));
  const body = `${slab({ x: p.x, y: p.y, w: p.w, d: p.d, r: 2.5 }, p.z, p.h, { tone: "hi", crease: "lo" }, 4, 0.6)}<g transform="${face(p.x, p.y + p.d + 0.1, p.z + p.h)}"><rect class="phone-screen" x="3" y="5" width="${p.w - 6}" height="${p.h - 10}" rx="2.5"/><rect class="phone-notch" x="${p.w / 2 - 5}" y="2" width="10" height="1.6" rx=".8"/>${text("", 7, 13, 4.2, "dim", "start", "Approvals")}${text("ph1", p.w / 2, 26, 7, "big", "middle")}${text("ph2", p.w / 2, 33.5, 4.2, "mono", "middle")}${text("ph3", p.w / 2, 39.5, 4.2, "mono", "middle")}<g class="ph-buttons"><rect class="btn-ok" x="6" y="45" width="19" height="9" rx="2"/><rect class="btn-no" x="${p.w - 25}" y="45" width="19" height="9" rx="2"/>${text("", 15.5, 51.2, 4, "btn-text", "middle", "Approve")}${text("", p.w - 15.5, 51.2, 4, "btn-text", "middle", "Reject")}</g>${text("ph4", p.w / 2, 59.5, 3.4, "dim", "middle")}</g>`;
  out.push(`<g data-id="phone">${body}</g>`);
  return out.join("");
}

/** The truck: chassis, wheels, curtain-side cargo box with eight crate slots, cab with a destination board. */
function truck() {
  const { x, y, d } = TRUCK;
  const back = [];
  const front = [];
  back.push(slab({ x, y, w: 142, d, r: 1.5 }, 8, 6, { tone: "lo" }, 2, 0.4));
  back.push(slab({ x, y, w: 96, d, r: 1 }, 14, 4, { tone: "mid" }, 2, 0.4));
  back.push(slab({ x, y, w: 96, d: 3, r: 0.6 }, 18, 48, { tone: "mid", className: "cavity" }, 2, 0.4));
  back.push(slab({ x, y, w: 3, d, r: 0.6 }, 18, 48, { tone: "mid" }, 2, 0.4));
  back.push(slab({ x: x + 93, y, w: 3, d, r: 0.6 }, 18, 48, { tone: "mid" }, 2, 0.4));
  const crates = [];
  for (let i = 0; i < 8; i++) {
    const cx = x + 6 + (i % 4) * 21.5;
    const z = 18 + Math.floor(i / 4) * 16;
    const plan = { x: cx, y: y + 8, w: 18, d: 22, r: 1 };
    crates.push(`<g class="tcrate" data-i="${i}" style="opacity:0">${slab(plan, z, 15, { tone: "hi" }, 2, 0.5)}${L(k.sideSeam(plan, z + 11, P, 2), { tone: "faint" })}</g>`);
  }
  for (const px of [x, x + 93]) front.push(slab({ x: px, y: y + d - 3, w: 3, d: 3, r: 0.6 }, 18, 48, { tone: "mid" }, 2, 0));
  front.push(slab({ x: x - 1, y: y - 1, w: 98, d: d + 2, r: 1.5 }, 66, 4, { tone: "mid" }, 2, 0.6));
  front.push(slab({ x: x + 3, y: y + d - 2, w: 90, d: 4, r: 2 }, 61, 5, { tone: "lo", className: "curtain" }, 4, 0));
  const cab = { x: x + 98, y, w: 44, d, r: 4 };
  front.push(slab(cab, 14, 44, { tone: "hi" }, 4, 0.8));
  front.push(`<g transform="${face(cab.x, y + d + 0.1, 58)}"><rect class="window" x="16" y="5" width="24" height="16" rx="2.5"/><path class="iso-line" data-tone="lo" d="M12 24V43"/></g>`);
  const board = { x: cab.x + 1, y: y + 16, w: 42, d: 3, r: 0.8 };
  front.push(slab({ x: cab.x + 9, y: y + 17, w: 3, d: 2, r: 0.4 }, 58, 4, { tone: "mid" }, 2, 0), slab({ x: cab.x + 32, y: y + 17, w: 3, d: 2, r: 0.4 }, 58, 4, { tone: "mid" }, 2, 0));
  front.push(slab(board, 62, 13, { tone: "hi", crease: "lo" }, 2, 0.4));
  front.push(`<g transform="${face(board.x, board.y + board.d + 0.1, 75)}"><rect class="screen" x="1.5" y="1.5" width="${board.w - 3}" height="10" rx="1"/>${text("dest", board.w / 2, 8.4, 4.6, "dest", "middle")}</g>`);
  for (const wx of [x + 22, x + 50, x + 120]) {
    front.push(`<path class="wheel" d="${k.sideRing([wx, y + d + 0.5, 10], 10, "y", P, 28)}"/><path class="hub" d="${k.sideRing([wx, y + d + 0.8, 10], 4.2, "y", P, 20)}"/>`);
  }
  front.push(`<path class="tail" d="${k.sideRing([x + 2, y + d + 0.2, 24], 2.2, "y", P, 12)}"/>`);
  return `<g data-id="truck">${back.join("")}<g data-id="tcrates">${crates.join("")}</g>${front.join("")}</g>`;
}

/** A wire from the scanner to every rack tag: the door asking Valio about each candidate. */
function asks() {
  const from = [GATE_X - 15, 30, 95];
  return RACK_X.map((x0) => k.wireSvg(at(from), at([x0 + RACK.w / 2, RACK.y + RACK.d, RACK.h + 22]), { tone: "lit", flow: true, ends: "to", size: 1.4 })).join("");
}

/** Builds the scene into host and returns draw(state, t, dt, snap) for the frame loop. */
export function buildScene(host) {
  const svg = `<svg class="iso-svg scene" viewBox="0 0 ${W} ${H}" role="img" aria-label="Isometric scene: a hotel chef, the buyer agent robot, Lazydoor's gate with its stamp, Valio's warehouse racks, the manager's phone, the cut-off clock and the delivery truck.">
<g>${plate()}${kitchen()}${warehouse()}${[3, 2, 1, 0].map(rack).join("")}${fence(-120, -28)}${post(-28, true)}</g>
<g data-id="asks" style="opacity:0">${asks()}</g>
<g data-id="leaf"></g>
<g>${chef()}</g>
<g data-id="agent">${robot("hi")}${card()}</g>
<g data-id="naive-back"></g>
<g>${post(36, false)}${beam()}</g>
<g data-id="naive-front"><g data-id="naive" class="naive" style="opacity:0">${robot("lo")}<g class="ncrate" style="opacity:0">${slab({ x: -8, y: 8, w: 16, d: 12, r: 1 }, 20, 12, { tone: "mid" }, 2, 0.4)}</g></g></g>
<g data-id="load" style="opacity:0"></g>
${truck()}
<g>${fence(80, 120)}${statusBoard()}${phone()}</g>
<g data-id="scan"></g>
<g data-id="bubble" class="bubble" style="opacity:0"><path class="bubble-box"/><text class="bubble-text"></text></g>
<g data-id="label" class="label" style="opacity:0"><rect class="label-box" rx="5"/><text class="label-text"></text></g>
</svg>`;
  host.innerHTML = svg;
  const root = host.querySelector("svg");
  const q = (id) => root.querySelector(`[data-id="${id}"]`);
  const el = { agent: q("agent"), naive: q("naive"), naiveBack: q("naive-back"), naiveFront: q("naive-front"), leaf: q("leaf"), asks: q("asks"), scan: q("scan"), truck: q("truck"), load: q("load"), phone: q("phone"), bubble: q("bubble"), label: q("label") };
  const racks = [...root.querySelectorAll(".rack")].sort((a, b) => a.dataset.rack - b.dataset.rack);
  const crates = [...root.querySelectorAll(".tcrate")];
  const cardEl = el.agent.querySelector(".card");
  const ncrate = el.naive.querySelector(".ncrate");
  const beacon = root.querySelector(".beacon");
  const board = root.querySelector(".board");
  const setText = (id, value) => {
    const node = root.querySelector(`[data-id="${id}"]`);
    if (node && node.textContent !== value) node.textContent = value;
  };
  const setAttr = (node, name, value) => {
    if (value === null || value === undefined) node.removeAttribute(name);
    else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, value);
  };

  const ROUTE = [[-176, LANE], [-140, LANE], [-104, LANE], [-36, LANE], [62, 28], [118, 40]];
  const NAIVE = [[-178, 66], [-70, 66], [-26, 46], [23, -60], [70, 0], [118, 40]];
  const lengths = (route) => route.reduce((acc, p, i) => (i ? [...acc, acc[i - 1] + Math.hypot(p[0] - route[i - 1][0], p[1] - route[i - 1][1])] : [0]), []);
  const pointOn = (route, cum, s) => {
    const i = Math.max(1, cum.findIndex((c) => c >= s));
    if (s >= cum.at(-1)) return route.at(-1);
    const [a, b] = [route[i - 1], route[i]];
    const u = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
  const RC = lengths(ROUTE);
  const NC = lengths(NAIVE);
  const STATION = { chef: RC[0], home: RC[1], door: RC[2], truck: RC[5] };
  const NSTATION = { enter: NC[3], grab: NC[3], load: NC[5], stuck: NC[5], gone: NC[5] };
  const live = { s: STATION.home, v: 0, ns: 0, nv: 0, leaf: 0, leafShown: -1, phoneJit: 0 };

  /** Moves s toward target along a route with a speed limit and a short ease in and out. */
  const travel = (s, v, target, dt) => {
    const want = Math.max(-95, Math.min(95, (target - s) * 3.2));
    v += (want - v) * (1 - Math.exp(-dt / 0.14));
    s += v * dt;
    if (Math.abs(target - s) < 0.3 && Math.abs(v) < 3) return [target, 0];
    return [s, v];
  };

  /** Rebuilds the door leaf at an opening share (0 closed across the lane, 1 swung into the Valio side). */
  const drawLeaf = (share, stamp) => {
    const a = share * Math.PI * 0.5;
    const d = [Math.sin(a), Math.cos(a)];
    const n = [Math.cos(a), -Math.sin(a)];
    const [hx, hy] = HINGE;
    const p = (s, o) => [hx + d[0] * s + n[0] * o, hy + d[1] * s + n[1] * o];
    const ring = [p(1, -1.6), p(LEAF_LEN, -1.6), p(LEAF_LEN, 1.6), p(1, 1.6)];
    const paths = k.extrude(ring, 4, 82, P, { bevel: 0.5 });
    const fx = -1.7;
    const onFace = (s, z) => { const [x, y] = p(s, fx); return at([x, y, z]); };
    const quad = (s0, s1, z0, z1) => k.pathOf([onFace(s0, z0), onFace(s1, z0), onFace(s1, z1), onFace(s0, z1)], true);
    const seal = [];
    for (let i = 0; i < 28; i++) {
      const phi = (i / 28) * Math.PI * 2;
      seal.push(onFace(25 + Math.cos(phi) * 9, 56 + Math.sin(phi) * 9));
    }
    const faceSeen = share < 0.55;
    const extra = faceSeen
      ? `<path class="leaf-window" d="${quad(9, 41, 70, 78)}"/><path class="leaf-seal" data-stamp="${stamp ?? ""}" d="${k.pathOf(seal, true)}"/>${k.lineSvg(k.pathOf([onFace(5, 30), onFace(45, 30)]), { tone: "faint" })}${k.dotsSvg([onFace(44, 40)], { size: 1.6, tone: "hi" })}`
      : "";
    el.leaf.innerHTML = S(paths, { tone: "hi", crease: "lo" }) + extra;
  };

  /** Draws one frame from state at scene time t; snap jumps every eased part to its target (used on seek). */
  function draw(state, t, dt, snap = false) {
    dt = Math.min(dt, 1 / 20);
    const stamp = state.door.stamp;
    const target = STATION[state.agent.at] ?? STATION.home;
    const inside = (s) => s > STATION.door + 20;
    const crossing = inside(target) !== inside(live.s) || (live.s > STATION.door + 6 && live.s < RC[3] - 4);
    const wantOpen = stamp === "AUTO" || crossing ? 1 : 0;
    live.leaf = snap ? wantOpen : live.leaf + (wantOpen - live.leaf) * (1 - Math.exp(-dt / 0.2));
    let goal = target;
    if (live.leaf < 0.8 && inside(target) && !inside(live.s)) goal = Math.min(target, STATION.door);
    if (live.leaf < 0.8 && !inside(target) && inside(live.s)) goal = Math.max(target, RC[3]);
    if (snap) [live.s, live.v] = [target, 0];
    else [live.s, live.v] = travel(live.s, live.v, goal, dt);
    const leafKey = `${live.leaf.toFixed(3)}|${stamp}`;
    if (leafKey !== live.leafShown) {
      drawLeaf(live.leaf, stamp);
      live.leafShown = leafKey;
    }

    const [ax, ay] = pointOn(ROUTE, RC, live.s);
    const bob = Math.abs(live.v) > 4 ? Math.abs(Math.sin(t * 13)) * 1.6 : Math.sin(t * 2.2) * 0.4;
    setAttr(el.agent, "transform", k.translateAlong(P, [ax, ay, bob]));
    setAttr(cardEl, "data-carry", state.agent.carry ?? "none");
    setAttr(cardEl, "data-stamp", state.agent.carry === "quote" || state.agent.carry === "rejected" ? stamp ?? "" : state.agent.carry === "receipt" ? "AUTO" : "");
    setAttr(cardEl, "style", state.agent.carry ? null : "opacity:0");

    const naive = state.naive;
    if (!naive.step) {
      live.ns = 0;
      live.nv = 0;
      setAttr(el.naive, "style", "opacity:0");
    } else {
      const nt = NSTATION[naive.step] ?? 0;
      if (snap) [live.ns, live.nv] = [nt, 0];
      else [live.ns, live.nv] = travel(live.ns, live.nv, nt, dt);
      const [nx, ny] = pointOn(NAIVE, NC, live.ns);
      const slot = ny < 40 ? el.naiveBack : el.naiveFront;
      if (el.naive.parentNode !== slot) slot.appendChild(el.naive);
      const fadeIn = Math.min(1, (t - naive.since) / 0.6);
      const op = naive.step === "gone" ? Math.max(0, 1 - (t - naive.since) / 1) : naive.step === "enter" ? fadeIn : 1;
      const nbob = Math.abs(live.nv) > 4 ? Math.abs(Math.sin(t * 13)) * 1.6 : 0;
      setAttr(el.naive, "transform", k.translateAlong(P, [nx, ny, nbob]));
      setAttr(el.naive, "style", `opacity:${op.toFixed(3)}`);
      setAttr(ncrate, "style", naive.step === "grab" || (naive.step === "load" && live.ns < NC[5] - 2) ? null : "opacity:0");
    }

    const shelves = state.shelves;
    racks.forEach((rack, i) => {
      const shelf = shelves[i];
      let status = shelf.status;
      let a = shelf.productId ?? "";
      let b = "";
      if (status === "ok") b = "OFFER ✓";
      if (status === "locked") b = shelf.code === "CUTOFF_PASSED" || !shelf.code ? "CUT-OFF PASSED" : shelf.code;
      if (status === "limited") b = shelf.remaining !== null ? `${shelf.remaining} left` : "STOCK LIMITED";
      if (status === "crossed") b = shelf.code ?? "REJECTED";
      if (shelf.more) b += ` +${shelf.more}`;
      if (i === 0 && naive.step && naive.step !== "gone" && status === "idle") {
        a = "463038 10 l box";
        status = naive.step === "stuck" ? "locked" : "naive";
        b = naive.step === "stuck" ? "CLOSED THU 15:00" : "999999 · MON";
      }
      setAttr(rack, "data-status", status);
      setText(`tag${i}a`, a || "·");
      setText(`tag${i}b`, b);
    });

    setAttr(el.asks, "style", state.door.scan ? null : "opacity:0");
    if (state.door.scan && Math.abs(live.v) < 6) {
      const z = 14 + (Math.sin((t - state.door.since) * 3.4) * 0.5 + 0.5) * 40;
      const y = ay + 10;
      const ends = [at([ax - 13, y, z + bob]), at([ax + 13, y, z + bob])];
      const head = [at([GATE_X - 16, -6, 92]), at([GATE_X - 16, 28, 92])];
      el.scan.innerHTML = `<path class="scan-fan" d="${k.pathOf([head[0], head[1], ends[1], ends[0]], true)}"/><path class="scan-line" d="${k.pathOf(ends)}"/>`;
    } else if (el.scan.firstChild) el.scan.innerHTML = "";

    setAttr(beacon, "data-stamp", stamp ?? (state.door.scan ? "SCAN" : ""));
    setAttr(board, "data-stamp", stamp ?? "");
    const approvedNote = state.phone.status === "approved" && stamp === "NEEDS_APPROVAL" ? "APPROVED ON PHONE" : null;
    setText("stamp", stamp === "NEEDS_APPROVAL" ? "NEEDS APPROVAL" : stamp ?? (state.door.scan ? "CHECKING…" : "READY"));
    setText("r1", approvedNote ?? state.door.reasons[0] ?? (stamp === "AUTO" ? "within mandate" : ""));
    setText("r2", approvedNote ? state.door.reasons[0] ?? "" : state.door.reasons[1] ?? "");

    const ph = state.phone;
    setAttr(el.phone, "data-status", ph.status);
    const buzz = ph.status === "buzzing" && (t - ph.since) % 2.4 < 0.9 ? Math.sin(t * 90) * 1.3 : 0;
    setAttr(el.phone, "transform", buzz ? `translate(${buzz.toFixed(2)} 0)` : null);
    const when = ph.expiresAt ? `expires ${clockText(ph.expiresAt).replace(/ \d+ \w+ /, " ")}` : "";
    const PHONE_TEXT = {
      idle: ["—", "No approvals", "waiting"],
      buzzing: [ph.cents !== null ? euro(ph.cents) : "Approve?", ph.orderId ?? "", when],
      approved: ["Approved", ph.orderId ?? "", ph.cents !== null ? euro(ph.cents) : ""],
      rejected: ["Rejected", ph.orderId ?? "", ""],
      expired: ["Expired", ph.orderId ?? "", "past the cut-off"],
    }[ph.status] ?? ["", "", ""];
    setText("ph1", PHONE_TEXT[0]);
    setText("ph2", PHONE_TEXT[1]);
    setText("ph3", PHONE_TEXT[2]);
    setText("ph4", ph.status === "buzzing" ? "bound to this quote" : "Lazydoor");

    setText("countdown", state.now ? (countdown(state.now, CUTOFF) === "closed" ? "CLOSED" : countdown(state.now, CUTOFF)) : "—");
    setText("now", state.now ? `now ${clockText(state.now)}` : "");
    root.querySelector('[data-id="countdown"]').classList.toggle("red-text", countdown(state.now, CUTOFF) === "closed");

    drawTruck(state.truck, t);
    drawBubble(state, t);
    drawLabel(state, ax, ay, bob);
  }

  /** Truck: crates drop in one by one, then it drives off and comes back empty; a naive load sits stuck. */
  function drawTruck(tr, t) {
    const age = t - tr.since;
    let shown = 0;
    let offset = 0;
    let opacity = 1;
    let drop = 0;
    if (tr.status === "loading" || tr.status === "stuck") {
      shown = Math.min(tr.crates, Math.floor(age / 0.32) + 1);
      drop = Math.max(0, 1 - ((age / 0.32) % 1) * 3);
      if (shown === tr.crates && age > tr.crates * 0.32) drop = 0;
      const loaded = tr.crates * 0.32 + 0.7;
      if (tr.status === "loading" && !tr.naive && age > loaded) {
        const u = Math.min(1, (age - loaded) / 3.2);
        offset = 320 * (u * u * (3 - 2 * u));
        opacity = 1 - Math.min(1, Math.max(0, (u - 0.5) / 0.4));
        if (age > loaded + 4.4) {
          shown = 0;
          offset = 0;
          opacity = Math.min(1, (age - loaded - 4.4) / 0.8);
        }
      }
      if (tr.status === "stuck") offset = Math.sin(age * 22) * 2.4 * Math.max(0, 1 - age / 1.6);
    }
    setAttr(el.truck, "transform", offset ? k.translateAlong(P, [offset, 0, 0]) : null);
    setAttr(el.truck, "style", opacity < 1 ? `opacity:${opacity.toFixed(3)}` : null);
    setAttr(el.truck, "data-naive", tr.naive ? "" : null);
    setAttr(el.truck, "data-status", tr.status);
    crates.forEach((c, i) => {
      const on = i < shown;
      const lift = on && i === shown - 1 ? drop * 14 : 0;
      setAttr(c, "style", on ? (lift ? `transform:translate(0px, ${(-lift * KS).toFixed(2)}px)` : null) : "opacity:0");
    });
    setText("dest", tr.naive ? (tr.status === "stuck" ? "CUT-OFF PASSED" : "MON 16 NOV ?") : "MON 16 NOV");
    const loadingFromRack = tr.status === "loading" && !tr.naive && t - tr.since < tr.crates * 0.32 + 0.4;
    const ok = racks.findIndex((r) => r.dataset.status === "ok");
    if (loadingFromRack && ok >= 0) {
      const x0 = RACK_X[ok] + RACK.w / 2;
      el.load.innerHTML = k.wireSvg(at([x0, RACK.y + RACK.d, 30]), at([TRUCK.x + 40, TRUCK.y + TRUCK.d, 40]), { tone: "lit", flow: true, size: 1.6 });
      setAttr(el.load, "style", null);
    } else setAttr(el.load, "style", "opacity:0");
  }

  /** Chef speech bubble, anchored above the toque with its tail on the chef. */
  function drawBubble(state, t) {
    const say = state.say;
    if (!say) return setAttr(el.bubble, "style", "opacity:0");
    const lines = wrap(say.text, 34);
    const anchor = at([CHEF[0], CHEF[1], 86]);
    const size = 17;
    const lineH = size * 1.3;
    const width = Math.max(...lines.map((l) => l.length)) * size * 0.56 + 28;
    const height = lines.length * lineH + 20;
    const x = anchor[0] + 18;
    const y = anchor[1] - height - 18;
    const tip = [anchor[0] + 4, anchor[1] - 4];
    const d = `M${f1(x + 10)} ${f1(y)}H${f1(x + width - 10)}Q${f1(x + width)} ${f1(y)} ${f1(x + width)} ${f1(y + 10)}V${f1(y + height - 10)}Q${f1(x + width)} ${f1(y + height)} ${f1(x + width - 10)} ${f1(y + height)}H${f1(x + 30)}L${f1(tip[0])} ${f1(tip[1])}L${f1(x + 14)} ${f1(y + height)}H${f1(x + 10)}Q${f1(x)} ${f1(y + height)} ${f1(x)} ${f1(y + height - 10)}V${f1(y + 10)}Q${f1(x)} ${f1(y)} ${f1(x + 10)} ${f1(y)}Z`;
    el.bubble.querySelector(".bubble-box").setAttribute("d", d);
    const txt = el.bubble.querySelector(".bubble-text");
    const key = lines.join("\n");
    if (txt.dataset.key !== key) {
      txt.dataset.key = key;
      txt.textContent = "";
      lines.forEach((line, i) => {
        const span = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
        span.setAttribute("x", f1(x + 14));
        span.setAttribute("y", f1(y + 14 + size + i * lineH - 4));
        span.textContent = line;
        txt.appendChild(span);
      });
      txt.setAttribute("font-size", size);
    }
    setAttr(el.bubble, "style", `opacity:${Math.min(1, (t - say.since) / 0.35).toFixed(3)}`);
  }

  /** The agent's card content as a small label over its head. */
  function drawLabel(state, ax, ay, bob) {
    const lines = cardLines(state);
    if (!lines.length) return setAttr(el.label, "style", "opacity:0");
    const head = at([ax, ay, 66 + bob]);
    const size = 13;
    const width = Math.max(...lines.map((l) => l.length)) * size * 0.62 + 18;
    const height = lines.length * size * 1.3 + 12;
    const box = el.label.querySelector(".label-box");
    box.setAttribute("x", f1(head[0] - width / 2));
    box.setAttribute("y", f1(head[1] - height - 6));
    box.setAttribute("width", f1(width));
    box.setAttribute("height", f1(height));
    setAttr(el.label, "data-carry", state.agent.carry);
    const txt = el.label.querySelector(".label-text");
    const key = lines.join("\n");
    if (txt.dataset.key !== key) {
      txt.dataset.key = key;
      txt.textContent = "";
      lines.forEach(() => txt.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "tspan")));
      txt.setAttribute("font-size", size);
    }
    [...txt.children].forEach((span, i) => {
      span.textContent = lines[i];
      span.setAttribute("x", f1(head[0]));
      span.setAttribute("y", f1(head[1] - height - 6 + 6 + size + i * size * 1.3 - 2));
    });
    setAttr(el.label, "style", null);
  }

  return { draw, svg: root };
}

/** Text on the agent's card for what it is carrying. */
function cardLines(state) {
  const { carry } = state.agent;
  const d = state.draft;
  const q = state.quote;
  const claim = (c) => String(c).replace(/^FREE_FROM_/, "").toLowerCase().replace(/_/g, " ") + "-free";
  if (carry === "question") return [`? ${(d?.unclear ?? []).join(", ")}`];
  if (carry === "draft" && d) {
    const qty = d.quantity ? `${Number(d.quantity.value).toLocaleString("en-US")} ${d.quantity.unit}` : "? qty";
    return [`DRAFT · ${qty}`, [...(d.claims ?? []).map(claim), d.category ? `cat ${d.category}` : ""].filter(Boolean).join(" · ")].filter(Boolean);
  }
  if (carry === "quote" && q) {
    const best = q.offers[0];
    return [`QUOTE · ${q.offers.length} offer · ${q.rejections.length} rejected`, best ? euro(best.netCents) : "no feasible offer"];
  }
  if (carry === "rejected") return [`REJECT · ${state.door.reasons[0] ?? (state.phone.status === "rejected" ? "by manager" : "")}`];
  if (carry === "receipt") return ["ACCEPTED · Mon 16 Nov", state.receipt?.netCents != null ? euro(state.receipt.netCents) : ""].filter(Boolean);
  return [];
}

/** "Sat 14 Nov 10:15" in Helsinki time. */
export function clockText(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.weekday} ${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`;
}

/** Greedy word wrap to at most width characters per line. */
function wrap(textValue, width) {
  const lines = [];
  let line = "";
  for (const word of String(textValue).split(/\s+/)) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

