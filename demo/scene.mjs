// The isometric scene: static parts built once from the anatomy kit, moving parts and effects driven from model state
// and scene time each frame (no wall clock, so Story mode renders the same frames every time).
import * as k from "./kit/iso-kit.mjs";
import { glCamera, glLayer } from "./kit/gl.mjs";
import { euro, countdown, CUTOFF } from "./model.mjs";

export const W = 1600;
export const H = 900;
const CAPTION_BAND = 110;

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
const CLOCK = { x: 96, y: -113, w: 140, d: 4, r: 1.2, z: 96, h: 32 };
const WALL = { x: -50, y: -120, w: 352, d: 7, r: 1, h: 132 };
const SPLASH = { x: -304, y: -120, w: 128, d: 7, r: 1, h: 74 };
const WALL_Y = WALL.y + WALL.d;
const LAMP_Z = 88;
const LAMPS = RACK_X.map((x) => x + RACK.w / 2);

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -24, 0), [PLATE.x + 262, PLATE.y, WALL.h], [PLATE.x + PLATE.w, PLATE.y, WALL.h], [GATE_X, 0, 128]],
  W,
  H - CAPTION_BAND,
  { pad: 22, azimuth: 120 },
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
/** Wraps markup in a material: the group's --c colour drives every kit tone inside it (see demo.css, .m). */
const M = (material, svg) => `<g class="m m-${material}">${svg}</g>`;
/** Maps local (u, v) on the plane y = const to world (x0 + u, y, z0 − v): text and marks on a face that looks at the viewer. */
const face = (x0, y, z0) => k.sideMatrix([x0, y], z0, P, "left");
const text = (id, x, y, size, cls = "", anchor = "start", content = "") => `<text${id ? ` data-id="${id}"` : ""} class="disp ${cls}" x="${x}" y="${y}" font-size="${size}" text-anchor="${anchor}">${content}</text>`;
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const easeOut = (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
const backOut = (u) => {
  const x = Math.min(1, Math.max(0, u)) - 1;
  return 1 + 2.4 * x * x * x + 1.4 * x * x;
};
const clamp01 = (u) => Math.min(1, Math.max(0, u));

/** Icon paths in a 24-unit box, stroked: every coloured state also carries one of these and a word. */
const ICONS = {
  check: "M5 12.5l4.5 4.5L19 7.5",
  cross: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  bang: "M12 4.5v10M12 19v.4",
  lock: "M6.5 11h11v8.5h-11zM9 11V8.2a3 3 0 0 1 6 0V11",
  bell: "M6 16.5h12l-1.6-2.2V10a4.4 4.4 0 0 0-8.8 0v4.3zM10.4 19a1.7 1.7 0 0 0 3.2 0",
  clock: "M12 4a8 8 0 1 0 .01 0zM12 8v4.4l3 2",
  warn: "M12 4.5l8.5 15h-17zM12 10v4.5M12 17v.3",
};
const icon = (name, x, y, size, cls = "", extra = "") => `<g class="icon ${cls}" transform="translate(${f1(x)} ${f1(y)}) scale(${(size / 24).toFixed(3)})"${extra}><path d="${ICONS[name]}"/></g>`;
const STAMP = {
  AUTO: { icon: "check", label: "AUTO", cls: "auto" },
  NEEDS_APPROVAL: { icon: "bang", label: "NEEDS APPROVAL", cls: "hold" },
  REJECT: { icon: "cross", label: "REJECT", cls: "reject" },
};

/** Base plate on feet, the two floors (kitchen tiles, warehouse concrete), the dock lane, the road and a front ruler strip. */
function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -24, 14, P)}"/>`];
  const feet = k.corners(PLATE, 26).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P));
  const base = [];
  for (const [x, y] of feet) base.push(cyl(x, y, 9, -24, 2, { tone: "lo" }), cyl(x, y, 7, -22, 8, { tone: "mid" }));
  base.push(slab(PLATE, -14, 14, { tone: "mid" }, 8, 1.6));
  base.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "faint" }));
  const screws = k.corners(PLATE, 11);
  base.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }), dots(screws.map(([x, y]) => [x, y, 0]), { size: 0.7 }));
  const strip = { x: -292, y: PLATE.y + PLATE.d - 11, w: 584, d: 7, r: 1 };
  base.push(slab(strip, 0, 0.6, { tone: "lo", crease: "none" }, 3, 0));
  const ticks = k.topTicks(strip.x + 4, strip.x + strip.w - 4, 8, 6, strip.y + 0.8, 0.6, [2, 3.8], P);
  base.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  out.push(M("base", base.join("")));
  const kitchen = { x: -300, y: -112, w: 214, d: 174, r: 3 };
  const tiles = [];
  for (let x = kitchen.x + 20; x < kitchen.x + kitchen.w; x += 20) tiles.push(k.lineOnTop([x, kitchen.y], [x, kitchen.y + kitchen.d], 0.6, P));
  for (let y = kitchen.y + 20; y < kitchen.y + kitchen.d; y += 20) tiles.push(k.lineOnTop([kitchen.x, y], [kitchen.x + kitchen.w, y], 0.6, P));
  out.push(M("tile", slab(kitchen, 0, 0.6, { tone: "lo", crease: "none" }, 3, 0) + L(tiles.join(""), { tone: "faint" })));
  const floor = { x: -60, y: -113, w: 362, d: 220, r: 3 };
  out.push(M("concrete", slab(floor, 0, 0.6, { tone: "lo", crease: "none" }, 3, 0) + L(k.lineOnTop([floor.x, LANE + 2], [floor.x + floor.w, LANE + 2], 0.6, P), { tone: "mid", dashed: true })));
  const road = { x: 112, y: 44, w: 196, d: 66, r: 2 };
  const edges = k.lineOnTop([road.x, road.y + 4], [road.x + road.w, road.y + 4], 0.8, P) + k.lineOnTop([road.x, road.y + road.d - 4], [road.x + road.w, road.y + road.d - 4], 0.8, P);
  out.push(M("asphalt", slab(road, 0, 0.8, { tone: "lo", crease: "none" }, 3, 0) + `<path class="road-line" d="${k.lineOnTop([road.x, road.y + road.d / 2], [road.x + road.w, road.y + road.d / 2], 0.8, P)}"/>` + L(edges, { tone: "faint" })));
  return out.join("");
}

/** Back walls on the plane y = WALL_Y: the kitchen's tiled splash wall and Valio's warehouse wall with seams and a label. */
function backWalls() {
  const out = [];
  const grid = [];
  for (let x = SPLASH.x + 16; x < SPLASH.x + SPLASH.w; x += 16) grid.push(seg([x, WALL_Y, 0], [x, WALL_Y, SPLASH.h]));
  for (let z = 16; z < SPLASH.h; z += 16) grid.push(seg([SPLASH.x, WALL_Y, z], [SPLASH.x + SPLASH.w, WALL_Y, z]));
  out.push(M("splash", slab(SPLASH, 0, SPLASH.h, { tone: "mid" }, 3, 0.8) + L(grid.join(""), { tone: "faint" })));
  const seams = [];
  for (let x = WALL.x + 44; x < WALL.x + WALL.w; x += 44) seams.push(seg([x, WALL_Y, 0], [x, WALL_Y, WALL.h]));
  const label = `<g transform="${face(-38, WALL_Y + 0.1, 122)}">${text("", 0, 0, 7, "wall-label", "start", "VALIO AIMO · WAREHOUSE")}</g>`;
  out.push(M("navy", slab(WALL, 0, WALL.h, { tone: "mid" }, 3, 0.8) + L(seams.join(""), { tone: "faint" }) + label));
  return out.join("");
}

/** The hotel kitchen in front of its wall: plate shelf, counter with stove, knobs and copper pots. */
function kitchen() {
  const out = [];
  const shelf = [slab({ x: -298, y: -113, w: 116, d: 7, r: 1 }, 52, 3, { tone: "mid" }, 3)];
  for (let i = 0; i < 5; i++) shelf.push(cyl(-288 + i * 22, -110, 7, 55, 1.4, { tone: "hi" }, 24));
  out.push(M("steel", shelf.join("")));
  const counter = { x: -300, y: -112, w: 120, d: 34, r: 2 };
  out.push(M("cabinet", slab(counter, 0, 32, { tone: "mid" }, 3, 0.6) + L(k.segment([counter.x + 60, counter.y + counter.d, 0], [counter.x + 60, counter.y + counter.d, 32], P), { tone: "lo" }) + dots([[-290, -78, 26], [-282, -78, 26], [-274, -78, 26], [-232, -78, 26], [-224, -78, 26]], { size: 1.3, tone: "hi" })));
  out.push(M("steel", slab(k.insetPlan(counter, -1.5), 32, 3, { tone: "hi" }, 3, 0.6)));
  for (const [x, r, h] of [[-276, 9, 13], [-250, 7, 9], [-206, 8, 16]]) {
    out.push(M("dark", L(k.ring(x, -95, r + 3, 35, P, 28), { tone: "mid" })));
    out.push(M("copper", cyl(x, -95, r, 35, h, { tone: "hi" }, 28) + L(k.sideArc(x, -95, r, 35 + h - 2.5, P, 20), { tone: "faint" }) + slab({ x: x + r - 1, y: -96.5, w: 7, d: 3, r: 1 }, 35 + h - 4, 2, { tone: "mid" }, 2, 0)));
  }
  return out.join("");
}

/** The chef: shoes, trousers, white coat with buttons and apron, red neckerchief, head and toque. */
function chef() {
  const [x, y] = CHEF;
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: x - 13, y: y - 11, w: 26, d: 22, r: 10 }, 0, 0.1, P)}" style="filter:blur(4px)"/>`];
  out.push(M("dark", slab({ x: x - 9, y: y - 3, w: 7, d: 10, r: 2 }, 0, 3, { tone: "mid" }, 2) + slab({ x: x + 2, y: y - 3, w: 7, d: 10, r: 2 }, 0, 3, { tone: "mid" }, 2) + cyl(x, y, 8, 3, 16, { tone: "mid" }, 28)));
  out.push(M("white", slab({ x: x - 16, y: y - 4, w: 5, d: 8, r: 2 }, 24, 22, { tone: "hi" }, 2) + slab({ x: x + 11, y: y - 4, w: 5, d: 8, r: 2 }, 24, 22, { tone: "hi" }, 2) + cyl(x, y, 11, 19, 30, { tone: "hi" }, 36)));
  out.push(M("apron", slab({ x: x - 8, y: y + 9, w: 16, d: 2.4, r: 1 }, 14, 24, { tone: "hi", crease: "lo" }, 2, 0)));
  out.push(M("white", dots([[x - 3, y + 11.4, 44], [x + 3, y + 11.4, 44], [x - 3, y + 11.4, 39], [x + 3, y + 11.4, 39]], { size: 1.2, tone: "hi" })));
  out.push(M("red", cyl(x, y, 6.5, 49, 3, { tone: "mid" }, 24)));
  const head = at([x, y, 58]);
  out.push(`<circle class="skin" cx="${f1(head[0])}" cy="${f1(head[1])}" r="${f1(8 * KS)}"/>`);
  const eye = (dx) => at([x + dx, y + 7.4, 59]);
  out.push(`<circle class="eye" cx="${f1(eye(-3)[0])}" cy="${f1(eye(-3)[1])}" r="${f1(1 * KS)}"/><circle class="eye" cx="${f1(eye(3)[0])}" cy="${f1(eye(3)[1])}" r="${f1(1 * KS)}"/>`);
  out.push(M("white", cyl(x, y, 7.6, 64, 7, { tone: "hi" }, 28)));
  const puff = at([x, y, 78]);
  out.push(`<ellipse class="toque" cx="${f1(puff[0])}" cy="${f1(puff[1])}" rx="${f1(10.5 * KS)}" ry="${f1(7.5 * KS)}"/>`);
  return out.join("");
}

/** A robot built at the origin, facing the viewer; the material gives the agent (teal) or the naive one (grey). */
function robot(material) {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: -13, y: -11, w: 26, d: 22, r: 10 }, 0, 0.1, P)}" style="filter:blur(4px)"/>`];
  out.push(M("dark", cyl(0, 0, 12.5, 0, 4, { tone: "mid" }, 32) + L(k.knurl(0, 0, 12.5, 0, 4, 40, P, 0.6), { tone: "faint" }) + cyl(0, 0, 10, 4, 4, { tone: "mid" }, 28)));
  const body = { x: -11, y: -9, w: 22, d: 18, r: 4 };
  out.push(M(material, slab({ x: -14.5, y: -2.5, w: 4, d: 12, r: 1.5 }, 17, 4, { tone: "mid" }, 2) + slab({ x: 10.5, y: -2.5, w: 4, d: 12, r: 1.5 }, 17, 4, { tone: "mid" }, 2) + slab(body, 8, 26, { tone: "hi" }, 5, 0.8) + L(k.sideSeam(body, 30, P, 5), { tone: "faint" }) + dots([[-6, 9, 26], [-2, 9, 26], [2, 9, 26]], { size: 1, tone: "hi" })));
  out.push(M("dark", cyl(0, 0, 3.2, 34, 3, { tone: "mid" }, 20)));
  const head = { x: -10, y: -8, w: 20, d: 16, r: 4 };
  out.push(M(material === "teal" ? "white" : material, slab(head, 37, 15, { tone: "hi" }, 5, 0.8)));
  out.push(`<g transform="${face(-7, 8.05, 48)}"><rect class="visor" x="0" y="0" width="14" height="6" rx="2.5"/><circle class="eye-lit" cx="4" cy="3" r="1.3"/><circle class="eye-lit" cx="10" cy="3" r="1.3"/></g>`);
  out.push(M("dark", L(seg([0, 0, 52], [0, 0, 61]), { tone: "mid" })));
  const tip = at([0, 0, 62]);
  out.push(`<circle class="antenna" cx="${f1(tip[0])}" cy="${f1(tip[1])}" r="${f1(1.9 * KS)}"/>`);
  return out.join("");
}

/** The card the agent holds in front of its body; colour comes from data-carry and data-stamp. */
function card() {
  const plan = { x: -9, y: 10, w: 18, d: 1.6, r: 0.6 };
  return `<g class="card">${M("white", slab(plan, 13, 19, { tone: "hi", crease: "lo" }, 2, 0))}<g transform="${face(-8, 11.65, 31)}"><rect class="card-face" x="0" y="0" width="16" height="17" rx="1"/><rect class="card-line" x="2.5" y="3" width="11" height="1.4"/><rect class="card-line" x="2.5" y="6.5" width="8" height="1.4"/><circle class="card-stamp" cx="11" cy="12" r="3.4"/></g></g>`;
}

/** A wall lamp over one rack: bracket, shade and bulb. Its light is the WebGL layer under the front SVG. */
function lamp(x) {
  const bracket = slab({ x: x - 1.5, y: WALL_Y, w: 3, d: 9, r: 0.6 }, LAMP_Z + 8, 2.4, { tone: "mid" }, 2, 0);
  const shade = cyl(x, WALL_Y + 9, 6.5, LAMP_Z + 2, 7, { tone: "mid" }, 24);
  const bulb = at([x, WALL_Y + 9, LAMP_Z + 1]);
  return M("dark", bracket + shade) + `<ellipse class="bulb" cx="${f1(bulb[0])}" cy="${f1(bulb[1])}" rx="${f1(5 * KS)}" ry="${f1(2.6 * KS)}"/>`;
}

/** One warehouse rack: blue uprights, orange beams, three levels of crates, a tag on top, alarm light, lock bar and X. */
function rack(i) {
  const x0 = RACK_X[i];
  const { y, d, w, h } = RACK;
  const out = [];
  const posts = [[x0, y], [x0 + w - 4, y], [x0, y + d - 4], [x0 + w - 4, y + d - 4]];
  out.push(M("blue", posts.slice(0, 2).map(([px, py]) => slab({ x: px, y: py, w: 4, d: 4, r: 0.6 }, 0, h, { tone: "mid" }, 2, 0)).join("")));
  [4, 25, 46].forEach((z, level) => {
    out.push(M("orange", slab({ x: x0, y, w, d, r: 1 }, z, 2.4, { tone: "mid" }, 2, 0.4)));
    const crates = [];
    for (let c = 0; c < 3; c++) {
      const plan = { x: x0 + 5 + c * 18.5, y: y + 5, w: 15.5, d: 19, r: 1 };
      crates.push(slab(plan, z + 2.4, 14, { tone: "hi" }, 2, 0.5) + L(k.sideSeam(plan, z + 2.4 + 10, P, 2), { tone: "mid" }));
    }
    out.push(`<g class="crates lv${level}">${M("crate", crates.join(""))}</g>`);
  });
  out.push(M("blue", posts.slice(2).map(([px, py]) => slab({ x: px, y: py, w: 4, d: 4, r: 0.6 }, 0, h + 2, { tone: "mid" }, 2, 0)).join("")));
  const tag = { x: x0 + 1, y: y + d - 3, w: w - 2, d: 3, r: 0.8 };
  out.push(M("dark", slab(tag, h + 2, 20, { tone: "hi", crease: "lo" }, 2, 0.4)));
  const tw = tag.w - 3;
  out.push(`<g transform="${face(tag.x, tag.y + tag.d + 0.1, h + 22)}"><rect class="tag-face" x="1.5" y="1.5" width="${tw}" height="17" rx="1"/><g class="tag-icon" data-id="tagi${i}"></g>${text(`tag${i}a`, 15, 8.2, 4.8, "tag-id", "start")}${text(`tag${i}b`, 15, 15.2, 4.7, "tag-st", "start")}</g>`);
  const alarm = [x0 + w - 7, y + d - 1.5, h + 22];
  const glow = at([alarm[0], alarm[1], alarm[2] + 3]);
  out.push(`<g class="alarm">${M("dark", cyl(alarm[0], alarm[1], 3.4, alarm[2], 1.4, { tone: "mid" }, 16))}<g class="alarm-lens">${cyl(alarm[0], alarm[1], 2.6, alarm[2] + 1.4, 4.2, { tone: "hi" }, 16)}</g><circle class="alarm-glow" cx="${f1(glow[0])}" cy="${f1(glow[1])}" r="${f1(16 * KS)}"/></g>`);
  const front = y + d + 0.5;
  out.push(`<g class="lock">${M("red", slab({ x: x0 - 2, y: front, w: w + 4, d: 2, r: 0.6 }, 36, 4, { tone: "hi" }, 2, 0) + slab({ x: x0 + w / 2 - 4, y: front + 2, w: 8, d: 3, r: 1 }, 30, 9, { tone: "hi" }, 2, 0))}</g>`);
  out.push(`<g class="cross"><path class="x-line" d="${seg([x0, front, 2], [x0 + w, front, h])}${seg([x0 + w, front, 2], [x0, front, h])}"/></g>`);
  return `<g class="rack" data-rack="${i}" data-status="idle">${out.join("")}</g>`;
}

/** The cut-off clock on the warehouse wall. */
function clockBoard() {
  const body = M("dark", slab(CLOCK, CLOCK.z, CLOCK.h, { tone: "hi", crease: "lo" }, 3, 0.6) + dots([[CLOCK.x + 4, CLOCK.y + CLOCK.d, CLOCK.z + CLOCK.h - 4], [CLOCK.x + CLOCK.w - 4, CLOCK.y + CLOCK.d, CLOCK.z + CLOCK.h - 4], [CLOCK.x + 4, CLOCK.y + CLOCK.d, CLOCK.z + 4], [CLOCK.x + CLOCK.w - 4, CLOCK.y + CLOCK.d, CLOCK.z + 4]], { size: 1, tone: "hi" }));
  return `${body}<g transform="${face(CLOCK.x, CLOCK.y + CLOCK.d + 0.1, CLOCK.z + CLOCK.h)}"><rect class="screen" x="5" y="2.5" width="${CLOCK.w - 10}" height="${CLOCK.h - 5}" rx="2"/>${icon("clock", 9, 8, 14, "clock-icon")}${text("", 27, 10.5, 4.8, "dim", "start", "VALIO CUT-OFF · SUN 15 NOV 17:00")}${text("countdown", 27, 22.5, 11, "big", "start")}${text("now", 27, 28.3, 4.4, "dim", "start")}</g>`;
}

/** Border fence along x = GATE_X: panels, caps and brand-coloured posts. */
function fence(from, to) {
  const panel = M("steel", slab({ x: GATE_X - 3, y: from, w: 6, d: to - from, r: 0.6 }, 0, 30, { tone: "mid" }, 2, 0.4));
  const cap = M("violet", slab({ x: GATE_X - 4, y: from, w: 8, d: to - from, r: 1 }, 30, 3, { tone: "mid" }, 2, 0.4));
  const posts = [];
  for (let y = from; y <= to - 6; y += Math.max(20, (to - from - 6) / Math.round((to - from) / 28))) posts.push(slab({ x: GATE_X - 5, y, w: 10, d: 6, r: 1 }, 0, 38, { tone: "mid" }, 2, 0.4) + dots([[GATE_X, y + 3, 38]], { size: 0.9, tone: "hi" }));
  return panel + cap + M("violet", posts.join(""));
}

/** A brand-violet gate post with hinge knuckles on its lane side. */
function post(y0, hinge) {
  const plan = { x: GATE_X - 8, y: y0, w: 16, d: 14, r: 1.5 };
  let out = slab(plan, 0, 100, { tone: "mid" }, 3, 0.8) + L(k.sideSeam(plan, 12, P, 3) + k.sideSeam(plan, 88, P, 3), { tone: "faint" });
  if (hinge) for (const z of [12, 44, 74]) out += cyl(HINGE[0], HINGE[1] + 1, 2.2, z, 7, { tone: "hi" }, 16);
  return M("violet", out);
}

/** Beam over the gate, the scanner head on its buyer side and the beacon lamp that shows the stamp. */
function beam() {
  const out = [M("violet", slab({ x: GATE_X - 10, y: -30, w: 20, d: 82, r: 1.5 }, 100, 10, { tone: "mid" }, 3, 0.8) + dots([[GATE_X - 6, -26, 110], [GATE_X - 6, 48, 110], [GATE_X + 6, -26, 110], [GATE_X + 6, 48, 110]], { size: 0.9, tone: "hi" }))];
  out.push(`<g transform="${face(GATE_X - 9, 52.1, 108)}">${text("", 0, 0, 5.2, "brand-mark", "start", "LAZYDOOR")}</g>`);
  out.push(M("dark", slab({ x: GATE_X - 20, y: -10, w: 10, d: 42, r: 1.5 }, 92, 10, { tone: "mid" }, 3, 0.6)));
  out.push(`<path class="scan-glass" d="${k.pathOf([at([GATE_X - 20, -8, 92]), at([GATE_X - 20, 30, 92]), at([GATE_X - 17, 30, 92]), at([GATE_X - 17, -8, 92])], true)}"/>`);
  out.push(M("dark", cyl(GATE_X, 11, 8, 110, 4, { tone: "mid" }, 28)));
  out.push(`<g class="beacon">${cyl(GATE_X, 11, 6, 114, 11, { tone: "hi", className: "beacon-lamp" }, 28)}</g>`);
  out.push(M("dark", cyl(GATE_X, 11, 7, 125, 2.4, { tone: "mid" }, 28)));
  return out.join("");
}

/** The status board in front of the gate: the stamp, its icon and its published reason codes. */
function statusBoard() {
  const b = BOARD;
  const legs = [b.x + 6, b.x + b.w - 10].map((x) => slab({ x, y: b.y - 2, w: 4, d: 4, r: 1 }, 0, b.z, { tone: "mid" }, 2, 0)).join("");
  const foot = slab({ x: b.x - 4, y: b.y - 6, w: b.w + 8, d: 12, r: 2 }, 0, 3, { tone: "mid" }, 3, 0.4);
  const out = [M("dark", legs + foot), M("violet", slab(b, b.z, b.h, { tone: "hi", crease: "lo" }, 3, 0.6))];
  out.push(`<g class="board" transform="${face(b.x, b.y + b.d + 0.1, b.z + b.h)}"><rect class="screen" x="4" y="3" width="${b.w - 8}" height="${b.h - 6}" rx="2"/>${text("", 9, 11, 5, "brand-mark", "start", "LAZYDOOR")}<g class="board-icon" data-id="boardi"></g>${text("stamp", 9, 22.5, 6.2, "stamp-text")}${text("r1", 9, 31.5, 5, "mono")}${text("r2", 9, 38, 5, "mono")}</g>`);
  return out.join("");
}

/** The manager's phone on a side table: the approval inbox. */
function phone() {
  const p = PHONE;
  const table = M("wood", slab({ x: p.x - 8, y: p.y - 12, w: p.w + 16, d: 22, r: 2 }, 0, 26, { tone: "mid" }, 3, 0.6) + slab({ x: p.x - 9, y: p.y - 13, w: p.w + 18, d: 24, r: 2 }, 26, 2.4, { tone: "hi" }, 3, 0.6));
  const dock = M("dark", slab({ x: p.x + 8, y: p.y - 5, w: p.w - 16, d: 9, r: 2 }, 28.4, 3, { tone: "mid" }, 3, 0.4));
  const screen = `<g transform="${face(p.x, p.y + p.d + 0.1, p.z + p.h)}"><rect class="phone-screen" x="3" y="5" width="${p.w - 6}" height="${p.h - 10}" rx="2.5"/><rect class="phone-notch" x="${p.w / 2 - 5}" y="2" width="10" height="1.6" rx=".8"/>${text("", 7, 12.5, 4.2, "dim", "start", "Approvals")}<g class="phone-icon" data-id="phonei"></g>${text("ph1", p.w / 2, 26, 7, "big", "middle")}${text("ph2", p.w / 2, 33.5, 4.2, "mono", "middle")}${text("ph3", p.w / 2, 39.5, 4.2, "mono", "middle")}<g class="ph-buttons"><rect class="btn-ok" x="6" y="45" width="19" height="9" rx="2"/><rect class="btn-no" x="${p.w - 25}" y="45" width="19" height="9" rx="2"/>${text("", 15.5, 51.2, 4, "btn-text", "middle", "Approve")}${text("", p.w - 15.5, 51.2, 4, "btn-text", "middle", "Reject")}</g>${text("ph4", p.w / 2, 59.5, 3.4, "dim", "middle")}</g>`;
  return table + dock + `<g data-id="phone">${M("dark", slab({ x: p.x, y: p.y, w: p.w, d: p.d, r: 2.5 }, p.z, p.h, { tone: "hi", crease: "lo" }, 4, 0.6))}${screen}</g>`;
}

/** Truck slot of crate i (world centre of its top), shared by the drawing and the fly-in. */
const slotOf = (i) => [TRUCK.x + 6 + (i % 4) * 21.5 + 9, TRUCK.y + 19, 18 + Math.floor(i / 4) * 16 + 15];

/** The truck: chassis, wheels, curtain-side cargo box with eight crate slots, Valio-blue cab with a destination board. */
function truck() {
  const { x, y, d } = TRUCK;
  const back = [];
  const front = [];
  back.push(M("dark", slab({ x, y, w: 142, d, r: 1.5 }, 8, 6, { tone: "lo" }, 2, 0.4)));
  back.push(M("steel", slab({ x, y, w: 96, d, r: 1 }, 14, 4, { tone: "mid" }, 2, 0.4)));
  back.push(M("cavity", slab({ x, y, w: 96, d: 3, r: 0.6 }, 18, 48, { tone: "mid" }, 2, 0.4)));
  back.push(M("white", slab({ x, y, w: 3, d, r: 0.6 }, 18, 48, { tone: "mid" }, 2, 0.4) + slab({ x: x + 93, y, w: 3, d, r: 0.6 }, 18, 48, { tone: "mid" }, 2, 0.4)));
  const crates = [];
  for (let i = 0; i < 8; i++) {
    const cx = x + 6 + (i % 4) * 21.5;
    const z = 18 + Math.floor(i / 4) * 16;
    const plan = { x: cx, y: y + 8, w: 18, d: 22, r: 1 };
    crates.push(`<g class="tcrate" data-i="${i}" style="opacity:0">${M("crate", slab(plan, z, 15, { tone: "hi" }, 2, 0.5) + L(k.sideSeam(plan, z + 11, P, 2), { tone: "mid" }))}</g>`);
  }
  front.push(M("white", [x, x + 93].map((px) => slab({ x: px, y: y + d - 3, w: 3, d: 3, r: 0.6 }, 18, 48, { tone: "mid" }, 2, 0)).join("") + slab({ x: x - 1, y: y - 1, w: 98, d: d + 2, r: 1.5 }, 66, 4, { tone: "mid" }, 2, 0.6)));
  front.push(M("valio", slab({ x: x + 3, y: y + d - 2, w: 90, d: 4, r: 2 }, 61, 5, { tone: "lo" }, 4, 0)));
  const cab = { x: x + 98, y, w: 44, d, r: 4 };
  front.push(M("valio", slab(cab, 14, 44, { tone: "hi" }, 4, 0.8)));
  front.push(`<g transform="${face(cab.x, y + d + 0.1, 58)}"><rect class="window" x="16" y="5" width="24" height="16" rx="2.5"/><path class="door-line" d="M12 24V43"/></g>`);
  const board = { x: cab.x + 1, y: y + 16, w: 42, d: 3, r: 0.8 };
  front.push(M("dark", slab({ x: cab.x + 9, y: y + 17, w: 3, d: 2, r: 0.4 }, 58, 4, { tone: "mid" }, 2, 0) + slab({ x: cab.x + 32, y: y + 17, w: 3, d: 2, r: 0.4 }, 58, 4, { tone: "mid" }, 2, 0) + slab(board, 62, 13, { tone: "hi", crease: "lo" }, 2, 0.4)));
  front.push(`<g transform="${face(board.x, board.y + board.d + 0.1, 75)}"><rect class="screen" x="1.5" y="1.5" width="${board.w - 3}" height="10" rx="1"/>${text("dest", board.w / 2, 8.4, 4.6, "dest", "middle")}</g>`);
  for (const wx of [x + 22, x + 50, x + 120]) front.push(`<path class="wheel" d="${k.sideRing([wx, y + d + 0.5, 10], 10, "y", P, 28)}"/><path class="hub" d="${k.sideRing([wx, y + d + 0.8, 10], 4.2, "y", P, 20)}"/>`);
  front.push(`<path class="tail" d="${k.sideRing([x + 2, y + d + 0.2, 24], 2.2, "y", P, 12)}"/>`);
  return `<g data-id="truck">${back.join("")}<g data-id="tcrates">${crates.join("")}</g>${front.join("")}</g>`;
}

/** A wire from the scanner to every rack tag: the door asking Valio about each candidate. */
function asks() {
  const from = [GATE_X - 15, 30, 95];
  return RACK_X.map((x0) => k.wireSvg(at(from), at([x0 + RACK.w / 2, RACK.y + RACK.d, RACK.h + 22]), { tone: "lit", flow: true, ends: "to", size: 1.6 })).join("");
}

/** Warm wall-lamp light on the warehouse floor and wall, in the scene's own camera (anatomy kit webgl.md). */
const LAMP_FRAGMENT = `
uniform float uLamp;
const float WALLY=${WALL_Y.toFixed(1)};
const float LY=${(WALL_Y + 9).toFixed(1)};
const float LZ=${(LAMP_Z + 1).toFixed(1)};
float lampAt(vec3 p,vec3 n,float lx){
  vec3 l=vec3(lx,LY,LZ);
  vec3 d=l-p;
  float r2=dot(d,d)+60.;
  vec3 dir=normalize(-d);
  float spot=smoothstep(.2,.8,dot(dir,normalize(vec3(0.,.55,-1.))));
  return max(dot(normalize(d),n),0.)*spot*5200./r2;
}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  float px=pixelOf();
  vec3 pw=onWallY(vb,WALLY);
  float wall=window(pw.x,${WALL.x.toFixed(1)},${(WALL.x + WALL.w).toFixed(1)},.7*px)*window(pw.z,0.,${WALL.h.toFixed(1)},.7*px/uCam.w);
  vec3 pf=onFloor(vb,.6);
  float floorIn=window(pf.x,-60.,302.,.7*px)*window(pf.y,WALLY,107.,.7*px/uCam.z)*(1.-wall);
  float e=0.;
  ${LAMPS.map((x) => `e+=wall*lampAt(pw,vec3(0.,1.,0.),${x.toFixed(1)})+floorIn*lampAt(pf,vec3(0.,0.,1.),${x.toFixed(1)});`).join("\n  ")}
  e*=uLamp;
  float a=.62*(1.-exp(-1.7*e));
  vec3 warm=mix(vec3(1.,.62,.28),vec3(1.,.9,.7),smoothstep(.4,1.4,e));
  gl_FragColor=vec4(warm*a,a);
}`;

/** Sky stops as [top, middle, bottom] colours: day, golden hour, evening, and the red sky after the approval expires. */
const SKY = {
  day: [[111, 182, 255], [191, 226, 255], [242, 248, 255]],
  gold: [[96, 132, 214], [255, 197, 154], [255, 231, 199]],
  eve: [[43, 42, 110], [224, 96, 126], [255, 178, 122]],
  red: [[26, 3, 6], [92, 13, 23], [143, 29, 38]],
};
const mix3 = (a, b, u) => a.map((c, i) => c.map((v, j) => v + (b[i][j] - v) * u));
const rgb = (c) => `rgb(${c.map((v) => Math.round(v)).join(",")})`;

/** Seeded pseudo-random numbers, so confetti and rain land the same way on every run. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
const RNG = seeded(16112026);
const CONFETTI = Array.from({ length: 64 }, () => ({ vx: (RNG() - 0.5) * 460, vy: -280 - RNG() * 320, spin: 6 + RNG() * 14, hue: Math.floor(RNG() * 6), w: 9 + RNG() * 7 }));
const RAIN = Array.from({ length: 18 }, () => ({ x: (RNG() - 0.5) * 2, phase: RNG(), speed: 0.9 + RNG() * 0.5 }));

/** Builds the scene into host (back SVG, lamp canvas, front SVG) and returns draw(state, t, dt, options). */
export function buildScene(host) {
  const back = `<svg class="iso-svg scene-back" viewBox="0 0 ${W} ${H}" role="img" aria-label="Isometric scene: a hotel chef, the buyer agent robot, Lazydoor's gate with its stamp, Valio's warehouse racks, the manager's phone, the cut-off clock and the delivery truck.">${plate()}${backWalls()}</svg>`;
  const front = `<svg class="iso-svg scene-front" viewBox="0 0 ${W} ${H}" aria-hidden="true">
<defs><filter id="glow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="7"/></filter></defs>
<g>${kitchen()}${clockBoard()}${LAMPS.map(lamp).join("")}${[3, 2, 1, 0].map(rack).join("")}${fence(-120, -28)}${post(-28, true)}</g>
<g data-id="asks" style="opacity:0">${asks()}</g>
<g data-id="leaf"></g>
<g>${chef()}</g>
<g data-id="agent">${robot("teal")}${card()}</g>
<g data-id="naive-back"></g>
<g>${post(36, false)}${beam()}</g>
<g data-id="naive-front"><g data-id="naive" class="naive" style="opacity:0">${robot("grey")}<g class="ncrate" style="opacity:0">${M("crate", slab({ x: -8, y: 8, w: 16, d: 12, r: 1 }, 20, 12, { tone: "mid" }, 2, 0.4))}</g></g></g>
<g data-id="load" style="opacity:0"></g>
<g data-id="trail"></g>
${truck()}
<g>${fence(80, 120)}${statusBoard()}${phone()}</g>
<g data-id="scan"></g>
<g data-id="exhaust"></g>
<g data-id="cloud" style="opacity:0"><g data-id="rain"></g><path class="cloud-edge" d=""/><path class="cloud" d=""/></g>
<g data-id="rings"></g>
<g data-id="confetti"></g>
<g data-id="stampfx" style="opacity:0"><circle class="stamp-glow" r="46" filter="url(#glow)"/><circle class="stamp-shock" r="30"/><circle class="stamp-shock s2" r="30"/><g class="stamp-badge"><circle class="stamp-disc" r="30"/><g class="stamp-icon"></g><rect class="stamp-pill" x="-62" y="38" width="124" height="26" rx="13"/><text class="stamp-label" x="0" y="56" text-anchor="middle"></text></g></g>
<g data-id="bubble" class="bubble" style="opacity:0"><path class="bubble-box"/><text class="bubble-text"></text></g>
<g data-id="label" class="label" style="opacity:0"><rect class="label-box" rx="5"/><text class="label-text"></text></g>
</svg>`;
  host.innerHTML = `${back}<canvas class="scene-gl" aria-hidden="true"></canvas>${front}`;
  const root = host.querySelector(".scene-front");
  const stage = host.closest(".stage") ?? host;
  const q = (id) => root.querySelector(`[data-id="${id}"]`);
  const el = Object.fromEntries(["agent", "naive", "naive-back", "naive-front", "leaf", "asks", "scan", "truck", "load", "trail", "phone", "bubble", "label", "exhaust", "cloud", "rain", "rings", "confetti", "stampfx"].map((id) => [id, q(id)]));
  const racks = [...root.querySelectorAll(".rack")].sort((a, b) => a.dataset.rack - b.dataset.rack);
  const crates = [...root.querySelectorAll(".tcrate")];
  const cardEl = el.agent.querySelector(".card");
  const ncrate = el.naive.querySelector(".ncrate");
  const beacon = root.querySelector(".beacon");
  const board = root.querySelector(".board");
  const layer = glLayer({ canvas: host.querySelector(".scene-gl"), fragment: LAMP_FRAGMENT, view: [W, H], camera: glCamera(P), uniforms: ["uLamp"], onError: () => {} });

  const setText = (id, value) => {
    const node = root.querySelector(`[data-id="${id}"]`);
    if (node && node.textContent !== value) node.textContent = value;
  };
  const setAttr = (node, name, value) => {
    if (value === null || value === undefined) node.removeAttribute(name);
    else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, value);
  };
  /** Puts an icon into an empty group once per change of name. */
  const setIcon = (id, name, x, y, size) => {
    const node = root.querySelector(`[data-id="${id}"]`);
    const key = `${name}|${x}|${y}|${size}`;
    if (!node || node.dataset.key === key) return;
    node.dataset.key = key;
    node.innerHTML = name ? icon(name, x, y, size) : "";
  };
  /** Keeps a pool of n children of one tag in a group and returns them. */
  const pool = (group, n, tag, cls) => {
    while (group.children.length < n) {
      const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
      node.setAttribute("class", cls);
      group.appendChild(node);
    }
    return [...group.children];
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
  const live = { s: STATION.home, v: 0, ns: 0, nv: 0, leaf: 0, leafShown: "", eve: 0, red: 0, lampDrawn: -1 };

  /** Moves s toward target along a route with a speed limit and a short ease in and out. */
  const travel = (s, v, target, dt) => {
    const want = Math.max(-95, Math.min(95, (target - s) * 3.2));
    v += (want - v) * (1 - Math.exp(-dt / 0.14));
    s += v * dt;
    if (Math.abs(target - s) < 0.3 && Math.abs(v) < 3) return [target, 0];
    return [s, v];
  };
  const follow = (value, target, dt, seconds, snap) => (snap ? target : value + (target - value) * (1 - Math.exp(-dt / seconds)));

  /** Rebuilds the door leaf at an opening share (0 closed across the lane, 1 swung into the Valio side). */
  const drawLeaf = (share, stamp) => {
    const a = share * Math.PI * 0.5;
    const d = [Math.sin(a), Math.cos(a)];
    const n = [Math.cos(a), -Math.sin(a)];
    const [hx, hy] = HINGE;
    const p = (s, o) => [hx + d[0] * s + n[0] * o, hy + d[1] * s + n[1] * o];
    const ring = [p(1, -1.6), p(LEAF_LEN, -1.6), p(LEAF_LEN, 1.6), p(1, 1.6)];
    const paths = k.extrude(ring, 4, 82, P, { bevel: 0.5 });
    const onFace = (s, z) => {
      const [x, y] = p(s, -1.7);
      return at([x, y, z]);
    };
    const quad = (s0, s1, z0, z1) => k.pathOf([onFace(s0, z0), onFace(s1, z0), onFace(s1, z1), onFace(s0, z1)], true);
    const seal = [];
    for (let i = 0; i < 28; i++) {
      const phi = (i / 28) * Math.PI * 2;
      seal.push(onFace(25 + Math.cos(phi) * 9, 56 + Math.sin(phi) * 9));
    }
    const extra = share < 0.55 ? `<path class="leaf-window" d="${quad(9, 41, 70, 78)}"/><path class="leaf-seal" data-stamp="${STAMP[stamp] ? stamp : ""}" d="${k.pathOf(seal, true)}"/>${k.lineSvg(k.pathOf([onFace(5, 30), onFace(45, 30)]), { tone: "faint" })}${k.dotsSvg([onFace(44, 40)], { size: 1.6, tone: "hi" })}` : "";
    el.leaf.innerHTML = M("violetLight", S(paths, { tone: "hi", crease: "lo" }) + extra);
  };

  /** Draws one frame from state at scene time t; snap jumps eased parts to their targets, calm turns effects off. */
  function draw(state, t, dt, { snap = false, calm = false } = {}) {
    dt = Math.min(dt, 1 / 20);
    const stamp = STAMP[state.door.stamp] ? state.door.stamp : null;
    const target = STATION[state.agent.at] ?? STATION.home;
    const inside = (s) => s > STATION.door + 20;
    const crossing = inside(target) !== inside(live.s) || (live.s > STATION.door + 6 && live.s < RC[3] - 4);
    const wantOpen = stamp === "AUTO" || crossing ? 1 : 0;
    live.leaf = follow(live.leaf, wantOpen, dt, 0.2, snap || calm);
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
    const bob = calm ? 0 : Math.abs(live.v) > 4 ? Math.abs(Math.sin(t * 13)) * 1.6 : Math.sin(t * 2.2) * 0.4;
    setAttr(el.agent, "transform", k.translateAlong(P, [ax, ay, bob]));
    setAttr(cardEl, "data-carry", state.agent.carry ?? "none");
    setAttr(cardEl, "data-stamp", state.agent.carry === "quote" || state.agent.carry === "rejected" ? stamp ?? "" : state.agent.carry === "receipt" ? "AUTO" : "");
    setAttr(cardEl, "style", state.agent.carry ? null : "opacity:0");

    drawNaive(state.naive, t, dt, snap, calm);
    drawRacks(state, t, calm);

    setAttr(el.asks, "style", state.door.scan ? `stroke-dashoffset:${f1(-t * 24)}` : "opacity:0");
    if (state.door.scan && Math.abs(live.v) < 6) {
      const z = 14 + (calm ? 0.5 : Math.sin((t - state.door.since) * 3.4) * 0.5 + 0.5) * 40;
      const y = ay + 10;
      const ends = [at([ax - 13, y, z + bob]), at([ax + 13, y, z + bob])];
      const head = [at([GATE_X - 16, -6, 92]), at([GATE_X - 16, 28, 92])];
      el.scan.innerHTML = `<path class="scan-fan" d="${k.pathOf([head[0], head[1], ends[1], ends[0]], true)}"/><path class="scan-line" d="${k.pathOf(ends)}"/>`;
    } else if (el.scan.firstChild) el.scan.innerHTML = "";

    const blink = state.door.scan && !stamp ? (calm || Math.floor(t * 4) % 2 === 0 ? "SCAN" : "SCAN-OFF") : stamp ?? "";
    setAttr(beacon, "data-stamp", blink);
    setAttr(board, "data-stamp", stamp ?? "");
    setIcon("boardi", stamp ? STAMP[stamp].icon : "", BOARD.w - 17, 4, 9);
    const approvedNote = state.phone.status === "approved" && stamp === "NEEDS_APPROVAL" ? "APPROVED ON PHONE" : null;
    setText("stamp", stamp ? STAMP[stamp].label : state.door.scan ? "CHECKING…" : "READY");
    setText("r1", approvedNote ?? state.door.reasons[0] ?? (stamp === "AUTO" ? "within mandate" : ""));
    setText("r2", approvedNote ? state.door.reasons[0] ?? "" : state.door.reasons[1] ?? "");
    drawStamp(stamp, state.door.since, t, calm);

    drawPhone(state.phone, t, calm);

    const cd = countdown(state.now, CUTOFF);
    setText("countdown", state.now ? (cd === "closed" ? "CLOSED" : cd) : "—");
    setText("now", state.now ? `now ${clockText(state.now)}` : "");
    root.querySelector('[data-id="countdown"]').classList.toggle("red-text", cd === "closed");

    drawTruck(state.truck, state, t, calm);
    drawBubble(state, t);
    drawLabel(state, ax, ay, bob);
    drawSky(state, dt, snap || calm);
  }

  /** The naive robot: walks around the door, grabs the 10 l box, loads the truck and fades out. */
  function drawNaive(naive, t, dt, snap, calm) {
    if (!naive.step) {
      live.ns = 0;
      live.nv = 0;
      setAttr(el.naive, "style", "opacity:0");
      return;
    }
    const nt = NSTATION[naive.step] ?? 0;
    if (snap) [live.ns, live.nv] = [nt, 0];
    else [live.ns, live.nv] = travel(live.ns, live.nv, nt, dt);
    const [nx, ny] = pointOn(NAIVE, NC, live.ns);
    const slot = ny < 40 ? el["naive-back"] : el["naive-front"];
    if (el.naive.parentNode !== slot) slot.appendChild(el.naive);
    const op = naive.step === "gone" ? Math.max(0, 1 - (t - naive.since) / 1) : naive.step === "enter" ? Math.min(1, (t - naive.since) / 0.6) : 1;
    const nbob = !calm && Math.abs(live.nv) > 4 ? Math.abs(Math.sin(t * 13)) * 1.6 : 0;
    setAttr(el.naive, "transform", k.translateAlong(P, [nx, ny, nbob]));
    setAttr(el.naive, "style", `opacity:${op.toFixed(3)}`);
    setAttr(ncrate, "style", naive.step === "grab" || (naive.step === "load" && live.ns < NC[5] - 2) ? null : "opacity:0");
  }

  /** Rack tags with icon and words, the alarm light and snapping lock on a closed shelf, the X on a crossed one. */
  function drawRacks(state, t, calm) {
    const naive = state.naive;
    racks.forEach((rackEl, i) => {
      const shelf = state.shelves[i];
      let status = shelf.status;
      let since = shelf.since ?? 0;
      let a = shelf.productId ?? "";
      let b = "";
      if (status === "ok") b = "OFFER";
      if (status === "locked") b = shelf.code === "CUTOFF_PASSED" || !shelf.code ? "CUT-OFF PASSED" : shelf.code;
      if (status === "limited") b = shelf.remaining !== null ? `${shelf.remaining} left` : "STOCK LIMITED";
      if (status === "crossed") b = shelf.code ?? "REJECTED";
      if (shelf.more) b += ` +${shelf.more}`;
      if (i === 0 && naive.step && naive.step !== "gone" && status === "idle") {
        a = "463038 · 10 l";
        status = naive.step === "stuck" ? "locked" : "naive";
        since = naive.since;
        b = naive.step === "stuck" ? "CLOSED THU" : "999999 · MON";
      }
      setAttr(rackEl, "data-status", status);
      setText(`tag${i}a`, a || "·");
      setText(`tag${i}b`, b);
      setIcon(`tagi${i}`, { ok: "check", locked: "lock", limited: "warn", crossed: "cross", naive: "bang" }[status] ?? "", 3, 3.5, 11);
      const age = t - since;
      const flashing = status === "locked" && (calm || Math.floor(age * 3.2) % 2 === 0);
      setAttr(rackEl, "data-alarm", flashing ? "on" : null);
      const lock = rackEl.querySelector(".lock");
      const drop = status === "locked" && !calm ? (1 - backOut(age / 0.32)) * 16 * KS : 0;
      setAttr(lock, "transform", drop ? `translate(0 ${f1(-drop)})` : null);
    });
  }

  /** The big stamp over the gate: slams in with a glow and a shockwave whenever the door decides. */
  function drawStamp(stamp, since, t, calm) {
    const group = el.stampfx;
    if (!stamp) return setAttr(group, "style", "opacity:0");
    const meta = STAMP[stamp];
    const [gx, gy] = at([GATE_X, 11, 150]);
    const [cx, cy] = [gx - 64, gy - 6];
    const age = calm ? 9 : t - since;
    setAttr(group, "data-stamp", stamp);
    setAttr(group, "style", null);
    setAttr(group, "transform", `translate(${f1(cx)} ${f1(cy)})`);
    const badge = group.querySelector(".stamp-badge");
    const scale = 1 + 0.9 * (1 - backOut(age / 0.26));
    setAttr(badge, "transform", scale !== 1 ? `scale(${scale.toFixed(3)})` : null);
    setAttr(badge, "style", `opacity:${clamp01(age / 0.08).toFixed(3)}`);
    const iconBox = group.querySelector(".stamp-icon");
    if (iconBox.dataset.key !== meta.icon) {
      iconBox.dataset.key = meta.icon;
      iconBox.innerHTML = icon(meta.icon, -17, -17, 34);
    }
    const label = group.querySelector(".stamp-label");
    if (label.textContent !== meta.label) {
      label.textContent = meta.label;
      const width = 26 + meta.label.length * 9.6;
      const pill = group.querySelector(".stamp-pill");
      pill.setAttribute("x", f1(-width / 2));
      pill.setAttribute("width", f1(width));
    }
    group.querySelectorAll(".stamp-shock").forEach((ring, j) => {
      const u = clamp01((age - 0.12 - j * 0.12) / 0.7);
      const on = u > 0 && u < 1;
      setAttr(ring, "r", f1(30 + 120 * easeOut(u)));
      setAttr(ring, "style", on ? `opacity:${(0.9 * (1 - u)).toFixed(3)}` : "opacity:0");
    });
    const glow = 0.45 + 0.55 * Math.max(0, 1 - age / 0.9);
    setAttr(group.querySelector(".stamp-glow"), "style", `opacity:${glow.toFixed(3)}`);
  }

  /** Phone screen texts and icon; pulse rings while it waits for the manager. */
  function drawPhone(ph, t, calm) {
    setAttr(el.phone, "data-status", ph.status);
    const buzz = !calm && ph.status === "buzzing" && (t - ph.since) % 2.4 < 0.9 ? Math.sin(t * 90) * 1.3 : 0;
    setAttr(el.phone, "transform", buzz ? `translate(${buzz.toFixed(2)} 0)` : null);
    const when = ph.expiresAt ? `expires ${clockText(ph.expiresAt).replace(/ \d+ \w+ /, " ")}` : "";
    const lines = {
      idle: ["—", "No approvals", "waiting"],
      buzzing: [ph.cents !== null ? euro(ph.cents) : "Approve?", ph.orderId ?? "", when],
      approved: ["Approved", ph.orderId ?? "", ph.cents !== null ? euro(ph.cents) : ""],
      rejected: ["Rejected", ph.orderId ?? "", ""],
      expired: ["Expired", ph.orderId ?? "", "past the cut-off"],
    }[ph.status] ?? ["", "", ""];
    setText("ph1", lines[0]);
    setText("ph2", lines[1]);
    setText("ph3", lines[2]);
    setText("ph4", ph.status === "buzzing" ? "bound to this quote" : "Lazydoor");
    setIcon("phonei", { buzzing: "bell", approved: "check", rejected: "cross", expired: "clock" }[ph.status] ?? "", PHONE.w - 16, 6.5, 9);
    const rings = pool(el.rings, 3, "ellipse", "pulse-ring");
    const [cx, cy] = at([PHONE.x + PHONE.w / 2, PHONE.y + PHONE.d, PHONE.z + PHONE.h / 2]);
    rings.forEach((ring, j) => {
      if (calm || ph.status !== "buzzing") return setAttr(ring, "style", "opacity:0");
      const u = (((t - ph.since) / 1.5 + j / 3) % 1 + 1) % 1;
      setAttr(ring, "cx", f1(cx));
      setAttr(ring, "cy", f1(cy));
      setAttr(ring, "rx", f1(46 + 110 * u));
      setAttr(ring, "ry", f1(60 + 110 * u));
      setAttr(ring, "style", `opacity:${(0.85 * (1 - u)).toFixed(3)}`);
    });
  }

  /** Truck: crates fly in from the shelf, confetti, then it drives off with exhaust and a trail; a naive load sputters under rain. */
  function drawTruck(tr, state, t, calm) {
    const age = t - tr.since;
    const loading = tr.status === "loading" || tr.status === "stuck";
    const loaded = tr.crates * 0.32 + 0.9;
    let offset = 0;
    let opacity = 1;
    let shown = loading ? tr.crates : 0;
    let speed = 0;
    if (tr.status === "loading" && !tr.naive && age > loaded) {
      const u = Math.min(1, (age - loaded) / 3.2);
      offset = 320 * ease(u);
      speed = (320 * 6 * u * (1 - u)) / 3.2;
      opacity = 1 - clamp01((u - 0.5) / 0.4);
      if (age > loaded + 4.4) {
        shown = 0;
        offset = 0;
        speed = 0;
        opacity = clamp01((age - loaded - 4.4) / 0.8);
      }
    }
    if (tr.status === "stuck" && !calm) offset = Math.sin(age * 22) * 2.4 * Math.max(0, 1 - (age % 2.2) / 0.8);
    setAttr(el.truck, "transform", offset ? k.translateAlong(P, [offset, 0, 0]) : null);
    setAttr(el.truck, "style", opacity < 1 ? `opacity:${opacity.toFixed(3)}` : null);
    setAttr(el.truck, "data-naive", tr.naive ? "" : null);
    setAttr(el.truck, "data-status", tr.status);
    const source = tr.naive ? 0 : racks.findIndex((r) => r.dataset.status === "ok");
    const from = at([RACK_X[Math.max(0, source)] + RACK.w / 2, RACK.y + RACK.d + 4, 36]);
    crates.forEach((c, i) => {
      if (i >= shown) return setAttr(c, "style", "opacity:0");
      const u = calm ? 1 : clamp01((age - i * 0.32) / 0.55);
      if (u <= 0) return setAttr(c, "style", "opacity:0");
      if (u >= 1) return setAttr(c, "style", null);
      const to = at(slotOf(i));
      const e = easeOut(u);
      const dx = (from[0] - to[0]) * (1 - e);
      const dy = (from[1] - to[1]) * (1 - e) - Math.sin(Math.PI * u) * 46 * KS;
      setAttr(c, "style", `transform:translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`);
    });
    setText("dest", tr.naive ? (tr.status === "stuck" ? "CUT-OFF PASSED" : "MON 16 NOV ?") : "MON 16 NOV");

    const loadingFromRack = tr.status === "loading" && !tr.naive && age < tr.crates * 0.32 + 0.5;
    if (loadingFromRack && source >= 0) {
      el.load.innerHTML = k.wireSvg(at([RACK_X[source] + RACK.w / 2, RACK.y + RACK.d, 30]), at([TRUCK.x + 40, TRUCK.y + TRUCK.d, 40]), { tone: "lit", flow: true, size: 1.6 });
      setAttr(el.load, "style", `stroke-dashoffset:${f1(-t * 24)}`);
    } else setAttr(el.load, "style", "opacity:0");

    drawConfetti(tr, age, calm);
    drawExhaust(tr, age, loaded, calm);
    const trail = pool(el.trail, 3, "path", "trail-line");
    trail.forEach((line, j) => {
      if (calm || speed < 8) return setAttr(line, "style", "opacity:0");
      const z = 26 + j * 14;
      const x = TRUCK.x - 4 + offset;
      const len = Math.min(120, speed * 0.55);
      setAttr(line, "d", k.pathOf([at([x - 6, TRUCK.y + TRUCK.d - 4, z]), at([x - 6 - len, TRUCK.y + TRUCK.d - 4, z])]));
      setAttr(line, "style", `opacity:${(Math.min(1, speed / 120) * opacity * 0.9).toFixed(3)}`);
    });
    drawCloud(state.naive, tr, t, calm);
  }

  /** A short confetti burst from the truck when an order is accepted. */
  function drawConfetti(tr, age, calm) {
    const pieces = pool(el.confetti, CONFETTI.length, "rect", "confetti");
    const live = !calm && tr.status === "loading" && !tr.naive && age < 2.2;
    const [ox, oy] = at([TRUCK.x + 48, TRUCK.y + 19, 72]);
    pieces.forEach((node, i) => {
      if (!live) return setAttr(node, "style", "opacity:0");
      const p = CONFETTI[i];
      const a = Math.max(0, age - (i % 4) * 0.05);
      const x = ox + p.vx * a;
      const y = oy + p.vy * a + 0.5 * 560 * a * a;
      const flip = Math.cos(a * p.spin);
      setAttr(node, "data-hue", p.hue);
      setAttr(node, "width", f1(p.w));
      setAttr(node, "height", f1(Math.max(0.8, Math.abs(flip) * 6.5)));
      setAttr(node, "transform", `translate(${f1(x)} ${f1(y)}) rotate(${f1(a * p.spin * 40)})`);
      setAttr(node, "style", `opacity:${clamp01((2.2 - age) / 0.6).toFixed(3)}`);
    });
  }

  /** Exhaust puffs from the truck's pipe: grey while it drives off, dark coughs while the naive load sits stuck. */
  function drawExhaust(tr, age, loaded, calm) {
    const puffs = pool(el.exhaust, 16, "circle", "puff");
    const driving = tr.status === "loading" && !tr.naive;
    const stuck = tr.status === "stuck";
    const every = stuck ? 0.45 : 0.1;
    const start = stuck ? 0 : loaded - 0.4;
    const stop = stuck ? Infinity : loaded + 3.4;
    const life = stuck ? 1.6 : 1.2;
    puffs.forEach((node, j) => {
      if (calm || !(driving || stuck)) return setAttr(node, "style", "opacity:0");
      const newest = Math.floor((Math.min(age, stop) - start) / every);
      const n = newest - j;
      const born = start + n * every;
      const a = age - born;
      if (n < 0 || a < 0 || a > life) return setAttr(node, "style", "opacity:0");
      const u = ease(clamp01((born - loaded) / 3.2));
      const off = stuck ? 0 : 320 * u;
      const [px, py] = at([TRUCK.x - 3 + off, TRUCK.y + TRUCK.d - 7, 9]);
      setAttr(node, "data-dark", stuck ? "" : null);
      setAttr(node, "cx", f1(px - 18 * a));
      setAttr(node, "cy", f1(py - 34 * a));
      setAttr(node, "r", f1((3.5 + 11 * a) * KS * 0.7));
      setAttr(node, "style", `opacity:${(0.6 * (1 - a / life)).toFixed(3)}`);
    });
  }

  /** Grey rain cloud over the naive agent's stuck truck. */
  function drawCloud(naive, tr, t, calm) {
    const visible = naive.step === "stuck" || (naive.step === "gone" && t - naive.since < 1);
    if (!visible) return setAttr(el.cloud, "style", "opacity:0");
    const op = naive.step === "gone" ? 1 - (t - naive.since) : Math.min(1, (t - naive.since) / 0.6);
    setAttr(el.cloud, "style", `opacity:${clamp01(op).toFixed(3)}`);
    const [cx, cy] = at([TRUCK.x + 62, TRUCK.y + 19, 132]);
    const r = 20 * KS;
    const blob = (x, y, rr) => `M${f1(cx + x - rr)} ${f1(cy + y)}a${f1(rr)} ${f1(rr)} 0 1 0 ${f1(2 * rr)} 0a${f1(rr)} ${f1(rr)} 0 1 0 ${f1(-2 * rr)} 0`;
    const d = blob(-r * 1.3, r * 0.2, r * 0.8) + blob(0, -r * 0.25, r) + blob(r * 1.25, r * 0.15, r * 0.85) + blob(r * 0.1, r * 0.45, r * 0.9);
    setAttr(el.cloud.querySelector(".cloud-edge"), "d", d);
    setAttr(el.cloud.querySelector(".cloud"), "d", d);
    const drops = pool(el.rain, RAIN.length, "path", "rain");
    const fall = 72 * KS;
    drops.forEach((node, i) => {
      const p = RAIN[i];
      const u = calm ? p.phase : (p.phase + (t - naive.since) * p.speed) % 1;
      const x = cx + p.x * r * 1.9 - u * 6;
      const y = cy + r * 0.9 + u * fall;
      setAttr(node, "d", `M${f1(x)} ${f1(y)}l-4 ${f1(16 * KS * 0.5)}`);
      setAttr(node, "style", `opacity:${(0.85 * Math.sin(Math.PI * u)).toFixed(3)}`);
    });
  }

  /** Chef speech bubble, anchored above the toque with its tail on the chef. */
  function drawBubble(state, t) {
    const say = state.say;
    if (!say) return setAttr(el.bubble, "style", "opacity:0");
    const lines = wrap(say.text, 34);
    const anchor = at([CHEF[0], CHEF[1], 86]);
    const size = 19;
    const lineH = size * 1.3;
    const width = Math.max(...lines.map((l) => l.length)) * size * 0.55 + 30;
    const height = lines.length * lineH + 22;
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
        span.setAttribute("x", f1(x + 15));
        span.setAttribute("y", f1(y + 15 + size + i * lineH - 4));
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
    const size = 14;
    const width = Math.max(...lines.map((l) => l.length)) * size * 0.62 + 20;
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

  /** Sky and dusk follow the clock toward the cut-off; red once an approval has expired. Lamps brighten as it darkens. */
  function drawSky(state, dt, snap) {
    const left = state.now ? (Date.parse(CUTOFF) - Date.parse(state.now)) / 3.6e6 : 31;
    const eve = Math.pow(clamp01((30.75 - left) / 30.75), 1.15);
    live.eve = follow(live.eve, eve, dt, 0.9, snap);
    live.red = follow(live.red, state.phone.status === "expired" ? 1 : 0, dt, 0.9, snap);
    const u = live.eve;
    let sky = u < 0.5 ? mix3(SKY.day, SKY.gold, u / 0.5) : mix3(SKY.gold, SKY.eve, (u - 0.5) / 0.5);
    sky = mix3(sky, SKY.red, live.red);
    const vars = {
      "--sky-top": rgb(sky[0]),
      "--sky-mid": rgb(sky[1]),
      "--sky-bottom": rgb(sky[2]),
      "--sun-x": `${(78 - 10 * u).toFixed(2)}%`,
      "--sun-y": `${(9 + 30 * u).toFixed(2)}%`,
      "--sun-size": `${(7 + 3 * u).toFixed(2)}cqw`,
      "--sun-hot": rgb([255, 222 - 110 * u, 90 - 40 * u]),
      "--sun-o": (1 - live.red).toFixed(3),
      "--dusk": (0.2 * u * (1 - live.red) + 0.14 * live.red).toFixed(3),
      "--dusk-c": rgb(mix3([[70, 40, 130]], [[120, 0, 24]], live.red)[0]),
    };
    for (const [name, value] of Object.entries(vars)) if (stage.style.getPropertyValue(name) !== value) stage.style.setProperty(name, value);
    const lampLevel = 0.75 + 0.75 * u;
    if (layer && Math.abs(lampLevel - live.lampDrawn) > 0.004) {
      layer.draw({ uLamp: lampLevel }, 0);
      live.lampDrawn = lampLevel;
    }
    stage.toggleAttribute("data-gl", !!layer);
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
  if (carry === "rejected") return [`✕ REJECT · ${state.door.reasons[0] ?? (state.phone.status === "rejected" ? "by manager" : "")}`];
  if (carry === "receipt") return ["✓ ACCEPTED · Mon 16 Nov", state.receipt?.netCents != null ? euro(state.receipt.netCents) : ""].filter(Boolean);
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
