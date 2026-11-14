// The isometric scene, art direction "Petrol night, signal colours": Valio Aimo petrol as the night, a graphite Lazydoor gate with one deep-rose accent,
// warm amber light. Static parts are built once from the anatomy kit; moving parts, effects and every word on screen
// are driven from model state and scene time (no wall clock), so Story mode renders the same frames every time.
import * as k from "./kit/iso-kit.mjs";
import { glCamera, glLayer } from "./kit/gl.mjs";
import { euro } from "./model.mjs";
import { ICONS } from "./icons.mjs";

export const W = 1600;
export const H = 900;
const CAPTION_BAND = 120;

const PLATE = { x: -312, y: -122, w: 624, d: 244, r: 12 };
const LANE = 12;
const GATE_X = -70;
const HINGE = [GATE_X, -14];
const LEAF_LEN = 50;
const RACK_X = [-8, 62, 132, 202];
const RACK = { y: -104, d: 28, w: 62, h: 66 };
const WALL = { x: -50, y: -120, w: 352, d: 7, r: 1, h: 132 };
const SPLASH = { x: -304, y: -120, w: 192, d: 7, r: 1, h: 78 };
const WALL_Y = WALL.y + WALL.d;
const COUNTER = { x: -300, y: -112, w: 150, d: 34, r: 2, h: 32 };
const SLOTS = [-222, -202, -182, -162];
const CHEF = [-226, -36];
const PHONE = { x: -306, y: -32, w: 44, d: 4, z: 30, h: 62 };
const CAL = { x: -150, w: 36, z: 30, h: 46 };
const ROAD = { x: -306, y: 56, w: 612, d: 52, r: 3 };
const TRUCK_Y = 60;
const T_LEN = 140;
const DOCK_X = 160;
const BAY_X = -296;
export const BARRIER = { x: 136, post: ROAD.y + ROAD.d + 5, z: 24, len: 56 };
const DOOR_POINT = [GATE_X + 8, 10, 46];
/** The letter slot in the closed door leaf, on its kitchen face. */
const DOOR_SLOT = [GATE_X - 1.8, 11, 42.5];
/** A small envelope drawn around its centre: body, flap and seal. */
const LETTER = `<rect class="letter-body" x="-12" y="-8" width="24" height="16" rx="1.6"/><path class="letter-flap" d="M-12 -8L0 1.5L12 -8"/><circle class="letter-seal" cx="0" cy="1.5" r="2.8"/>`;
const LAMP_Z = 88;
/** Height of the card the robot vacuum carries on its mast: where letters leave and quotes arrive. */
const HAND_Z = 14;
const LAMPS = RACK_X.map((x) => x + RACK.w / 2);
const WINDOWS = [[-46, 22], [104, 22], [134, 22], [272, 22]];
/** Logo plate on the wall between the first window and the lamps: world x, bottom z, width, height, inner margin, logo aspect. */
const LOGO = { x: -6, z: 98, w: 92, h: 32, pad: 4, ratio: 179.06 / 537.17 };
const CLOCK = [222, WALL_Y, 112, 15];
/** Bottom edge for the corner cards (decision, receipt): just above where a two-line caption starts. */
const CARD_BOTTOM = 748;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -24, 0), [PLATE.x + 262, PLATE.y, WALL.h + 6], [PLATE.x + PLATE.w, PLATE.y, WALL.h + 6], [GATE_X, 0, 150]],
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
/** Wraps markup in a material: the group's --c colour drives every kit tone inside it (demo.css, .m). */
const M = (material, svg) => `<g class="m m-${material}">${svg}</g>`;
/** Local (u, v) on the plane y = const mapped to world (x0 + u, y, z0 − v): marks on faces that look at the viewer. */
const face = (x0, y, z0) => k.sideMatrix([x0, y], z0, P, "left");
/** Screen box [x0, y0, x1, y1] around world points. */
const boxOf = (points) => {
  const xy = points.map(at);
  return [Math.min(...xy.map((p) => p[0])), Math.min(...xy.map((p) => p[1])), Math.max(...xy.map((p) => p[0])), Math.max(...xy.map((p) => p[1]))];
};
/** Words in the scene that a moving label must not cover, left to right: the terminal screen and the kitchen calendar. */
const KEEP_CLEAR = [
  boxOf([[PHONE.x, PHONE.y + PHONE.d, PHONE.z], [PHONE.x + PHONE.w, PHONE.y + PHONE.d, PHONE.z], [PHONE.x, PHONE.y + PHONE.d, PHONE.z + PHONE.h], [PHONE.x + PHONE.w, PHONE.y + PHONE.d, PHONE.z + PHONE.h]]),
  boxOf([[CAL.x, WALL_Y, CAL.z], [CAL.x + CAL.w, WALL_Y, CAL.z], [CAL.x, WALL_Y, CAL.z + CAL.h], [CAL.x + CAL.w, WALL_Y, CAL.z + CAL.h]]),
];
/** Right-most screen x the door leaf reaches as it swings open: the door's reason chips start past it. */
const LEAF_REACH = Math.max(...Array.from({ length: 19 }, (_, i) => (i / 18) * Math.PI * 0.5).flatMap((a) => [4, 86].map((z) => at([HINGE[0] + Math.sin(a) * LEAF_LEN + 2, HINGE[1] + Math.cos(a) * LEAF_LEN, z])[0])));
/** Local (u, v) on the plane x = const mapped to world (x, y0 + u, z0 − v): marks on faces that look along −x. */
function faceX(x, y0, z0) {
  const o = at([x, y0, z0]);
  const u = at([x, y0 + 1, z0]);
  const v = at([x, y0, z0 - 1]);
  return `matrix(${(u[0] - o[0]).toFixed(3)} ${(u[1] - o[1]).toFixed(3)} ${(v[0] - o[0]).toFixed(3)} ${(v[1] - o[1]).toFixed(3)} ${o[0].toFixed(2)} ${o[1].toFixed(2)})`;
}
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const easeOut = (u) => 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
const backOut = (u) => {
  const x = Math.min(1, Math.max(0, u)) - 1;
  return 1 + 2.4 * x * x * x + 1.4 * x * x;
};
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const lerp = (a, b, u) => a + (b - a) * u;
/** A Phosphor icon (256-unit box) placed at x, y with the given size, filled with currentColor. */
const icon = (name, x, y, size, cls = "") => `<g class="icon ${cls}" transform="translate(${f1(x)} ${f1(y)}) scale(${(size / 256).toFixed(4)})"><path d="${ICONS[name]}"/></g>`;

const STAMP = {
  AUTO: { icon: "check", label: "AUTO", cls: "auto" },
  NEEDS_APPROVAL: { icon: "warn", label: "NEEDS APPROVAL", cls: "hold" },
  REJECT: { icon: "cross", label: "REJECT", cls: "reject" },
};
/** Short words for reason codes on the big labels; unknown codes show as they are. */
const REASON = {
  OVER_ORDER_AUTO: "Over 500 €",
  PACK_SIZE_CHANGED: "Pack size changed",
  OVER_DAY_AUTO: "Day limit passed",
  OVER_ORDER_HARD: "Over hard limit",
  OVER_DAY_HARD: "Over day hard limit",
  NEW_ALLERGEN: "New allergen",
  CLAIM_MISSING: "Claim missing",
  SUBSTITUTE: "Substitute",
  SHORTFALL: "Short of quantity",
  APPROVAL_EXPIRED: "Approval expired",
};
const reasonText = (code) => REASON[code] ?? String(code).replace(/_/g, " ").toLowerCase();

/** Base island on feet, kitchen tiles, warehouse floor, agent lane, and the long road from the dock to the kitchen. */
function plate() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -24, 14, P)}"/>`];
  const feet = k.corners(PLATE, 26).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P));
  const base = [];
  for (const [x, y] of feet) base.push(cyl(x, y, 9, -24, 2, { tone: "lo" }), cyl(x, y, 7, -22, 8, { tone: "mid" }));
  base.push(slab(PLATE, -14, 14, { tone: "mid" }, 8, 1.6));
  base.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "faint" }));
  const screws = k.corners(PLATE, 11);
  base.push(L(screws.map(([x, y]) => k.ring(x, y, 2.4, 0, P, 16)).join(""), { tone: "lo" }), dots(screws.map(([x, y]) => [x, y, 0]), { size: 0.8 }));
  out.push(M("island", base.join("")));
  const kitchen = { x: -300, y: -112, w: 222, d: 160, r: 3 };
  const tiles = [];
  for (let x = kitchen.x + 20; x < kitchen.x + kitchen.w; x += 20) tiles.push(k.lineOnTop([x, kitchen.y], [x, kitchen.y + kitchen.d], 0.6, P));
  for (let y = kitchen.y + 20; y < kitchen.y + kitchen.d; y += 20) tiles.push(k.lineOnTop([kitchen.x, y], [kitchen.x + kitchen.w, y], 0.6, P));
  out.push(M("tile", slab(kitchen, 0, 0.6, { tone: "lo", crease: "none" }, 3, 0) + L(tiles.join(""), { tone: "faint" })));
  const floor = { x: -60, y: -113, w: 362, d: 162, r: 3 };
  out.push(M("floor", slab(floor, 0, 0.6, { tone: "lo", crease: "none" }, 3, 0) + L(k.lineOnTop([floor.x, LANE + 2], [floor.x + floor.w, LANE + 2], 0.6, P), { tone: "faint", dashed: true })));
  const edges = k.lineOnTop([ROAD.x, ROAD.y + 3], [ROAD.x + ROAD.w, ROAD.y + 3], 0.8, P) + k.lineOnTop([ROAD.x, ROAD.y + ROAD.d - 3], [ROAD.x + ROAD.w, ROAD.y + ROAD.d - 3], 0.8, P);
  const bay = k.planOutline({ x: BAY_X - 6, y: ROAD.y + 2, w: T_LEN + 12, d: ROAD.d - 4, r: 1 }, 0.8, P);
  out.push(M("asphalt", slab(ROAD, 0, 0.8, { tone: "lo", crease: "none" }, 3, 0) + `<path class="road-line" d="${k.lineOnTop([ROAD.x, ROAD.y + ROAD.d / 2], [ROAD.x + ROAD.w, ROAD.y + ROAD.d / 2], 0.8, P)}"/>` + L(edges, { tone: "mid" }) + `<path class="bay-line" d="${bay}"/>`));
  return out.join("");
}

/** Back walls on y = WALL_Y: the kitchen's tiled wall and Valio's brick warehouse with joints, pilasters, coping and lit windows. */
function backWalls() {
  const out = [];
  const grid = [];
  for (let x = SPLASH.x + 16; x < SPLASH.x + SPLASH.w; x += 16) grid.push(seg([x, WALL_Y, 0], [x, WALL_Y, SPLASH.h]));
  for (let z = 16; z < SPLASH.h; z += 16) grid.push(seg([SPLASH.x, WALL_Y, z], [SPLASH.x + SPLASH.w, WALL_Y, z]));
  out.push(M("splash", slab(SPLASH, 0, SPLASH.h, { tone: "mid" }, 3, 0.8) + L(grid.join(""), { tone: "faint" })));
  out.push(M("dark", slab({ x: SPLASH.x - 1, y: SPLASH.y - 1, w: SPLASH.w + 2, d: SPLASH.d + 3, r: 1 }, SPLASH.h, 3, { tone: "mid" }, 2, 0.4)));
  const courses = [];
  for (let z = 6; z < WALL.h; z += 6) courses.push(seg([WALL.x, WALL_Y, z], [WALL.x + WALL.w, WALL_Y, z]));
  for (let row = 0; row * 6 < WALL.h; row++) {
    for (let x = WALL.x + (row % 2 ? 8 : 16); x < WALL.x + WALL.w; x += 16) courses.push(seg([x, WALL_Y, row * 6], [x, WALL_Y, Math.min(WALL.h, row * 6 + 6)]));
  }
  const windows = WINDOWS.map(([x, w]) => `<g transform="${face(x, WALL_Y + 0.1, 126)}"><rect class="win-frame" x="-1.5" y="-1.5" width="${w + 3}" height="25" rx="1.5"/><rect class="win-glass" x="1" y="1" width="${w - 2}" height="20" rx="1"/><path class="win-bar" d="M${w / 2} 1V21M1 11H${w - 1}"/></g>`).join("");
  out.push(M("brick", slab(WALL, 0, WALL.h, { tone: "mid" }, 3, 0.8) + L(courses.join(""), { tone: "faint" }) + windows));
  out.push(M("brickDark", [WALL.x - 2, 94, 210, WALL.x + WALL.w - 6].map((x) => slab({ x, y: WALL_Y - 1, w: 8, d: 5, r: 0.6 }, 0, WALL.h, { tone: "mid" }, 2, 0.4)).join("")));
  out.push(M("dark", slab({ x: WALL.x - 3, y: WALL.y - 2, w: WALL.w + 6, d: WALL.d + 6, r: 1 }, WALL.h, 5, { tone: "mid" }, 2, 0.6)));
  return out.join("");
}

/** Kitchen fittings in front of its wall: range hood, plate shelf, calendar, counter with stove, knobs, copper pots. */
function kitchen() {
  const out = [];
  out.push(M("steel", slab({ x: -300, y: WALL_Y, w: 56, d: 16, r: 2 }, 58, 12, { tone: "mid" }, 3, 0.6) + L(k.sideSeam({ x: -300, y: WALL_Y, w: 56, d: 16, r: 2 }, 62, P, 3), { tone: "faint" })));
  const shelf = [M("sun", slab({ x: -236, y: WALL_Y, w: 80, d: 7, r: 1 }, 54, 3, { tone: "mid" }, 3))];
  for (let i = 0; i < 4; i++) shelf.push(M(["coral", "sky", "sun", "mint"][i], cyl(-226 + i * 20, WALL_Y + 3.5, 6.5, 57, 1.4, { tone: "hi" }, 24)));
  out.push(shelf.join(""));
  out.push(calendar());
  const doors = [];
  for (let x = COUNTER.x + 25; x < COUNTER.x + COUNTER.w; x += 25) doors.push(seg([x, COUNTER.y + COUNTER.d, 2], [x, COUNTER.y + COUNTER.d, COUNTER.h]));
  const handles = [];
  for (let x = COUNTER.x + 12.5; x < COUNTER.x + COUNTER.w; x += 25) handles.push(seg([x - 4, COUNTER.y + COUNTER.d + 0.2, COUNTER.h - 6], [x + 4, COUNTER.y + COUNTER.d + 0.2, COUNTER.h - 6]));
  out.push(M("cobalt", slab(COUNTER, 0, COUNTER.h, { tone: "mid" }, 3, 0.6) + L(doors.join(""), { tone: "lo" }) + L(handles.join(""), { tone: "hi" })));
  out.push(M("steel", slab(k.insetPlan(COUNTER, -1.5), COUNTER.h, 3, { tone: "hi" }, 3, 0.6)));
  for (const [x, r, h] of [[-284, 9, 13], [-262, 7, 9]]) {
    out.push(M("dark", L(k.ring(x, -95, r + 3, 35, P, 28), { tone: "mid" })));
    out.push(M("copper", cyl(x, -95, r, 35, h, { tone: "hi" }, 28) + L(k.sideArc(x, -95, r, 35 + h - 2.5, P, 20), { tone: "faint" }) + slab({ x: x + r - 1, y: -96.5, w: 7, d: 3, r: 1 }, 35 + h - 4, 2, { tone: "mid" }, 2, 0)));
  }
  const crates = SLOTS.map((x, i) => `<g class="ccrate" data-i="${i}" style="opacity:0">${M("crate2", slab({ x: x - 8, y: -105, w: 16, d: 20, r: 1 }, 35, 13, { tone: "hi" }, 2, 0.5) + L(k.sideSeam({ x: x - 8, y: -105, w: 16, d: 20, r: 1 }, 44, P, 2), { tone: "mid" }))}</g>`).join("");
  return out.join("") + `<g data-id="counter">${crates}</g>`;
}

/** Wall calendar in the kitchen: the delivery day flips to Monday when the truck arrives. */
function calendar() {
  const plate = { x: CAL.x, y: WALL_Y, w: CAL.w, d: 2, r: 1 };
  return `${M("cream", slab(plate, CAL.z, CAL.h, { tone: "hi", crease: "lo" }, 2, 0.4))}<g transform="${face(CAL.x, WALL_Y + 2.1, CAL.z + CAL.h)}"><rect class="cal-head" x="0" y="0" width="${CAL.w}" height="15" rx="1"/><circle class="cal-ring" cx="8" cy="0" r="1.8"/><circle class="cal-ring" cx="${CAL.w - 8}" cy="0" r="1.8"/><text data-id="calday" class="cal-day" x="${CAL.w / 2}" y="12" font-size="12" text-anchor="middle">SAT</text><text data-id="caldate" class="cal-date" x="${CAL.w / 2}" y="40" font-size="24" text-anchor="middle">14</text></g>`;
}

/** The chef's frame: u runs left to right across the screen (level shoulders), f points at the viewer. */
const CHEF_U = [2 / Math.sqrt(5), 1 / Math.sqrt(5)];
const CHEF_F = [-1 / Math.sqrt(5), 2 / Math.sqrt(5)];
/** World point at (u, f) from the chef's centre at height z. */
const chefAt = (u, f, z = 0) => [CHEF[0] + u * CHEF_U[0] + f * CHEF_F[0], CHEF[1] + u * CHEF_U[1] + f * CHEF_F[1], z];
/** A rounded box in the chef's frame: plan {x: u, y: f, w, d, r} turned to face the viewer, extruded from z by h. */
const chefBox = (plan, z, h, style, steps = 2, bevel = 0.6) => S(k.extrude(k.ringOf(plan, steps).map(([u, f]) => chefAt(u, f).slice(0, 2)), z, h, P, { convex: true, bevel }), style);
/** A flat bar in plan from world point a to b (an arm reaching out), width w, from z up by h. */
const bar = (a, b, w, z, h, style) => {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const [nx, ny] = [(-(b[1] - a[1]) / len) * (w / 2), ((b[0] - a[0]) / len) * (w / 2)];
  const ring = [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]];
  return S(k.extrude(ring, z, h, P, { convex: true, bevel: 0.4 }), style);
};

/**
 * The chef, turned square to the viewer so both shoulders sit level: shoes, trousers, lemon jacket with buttons, apron with pocket,
 * neckerchief, face, toque with pleats; arms down at both sides, one reaching to the keypad, both out in a shrug, or a thumbs-up.
 */
function chef() {
  const [x, y] = CHEF;
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: x - 13, y: y - 11, w: 26, d: 22, r: 10 }, 0, 0.1, P)}" style="filter:blur(4px)"/>`];
  out.push(M("dark", chefBox({ x: -9, y: -3, w: 7, d: 11, r: 2 }, 0, 3, { tone: "mid" }) + chefBox({ x: 2, y: -3, w: 7, d: 11, r: 2 }, 0, 3, { tone: "mid" }) + cyl(x, y, 8, 3, 16, { tone: "mid" }, 28)));
  const jacket = cyl(x, y, 11, 19, 30, { tone: "hi" }, 36) + L(k.sideArc(x, y, 11, 30, P, 24), { tone: "lo" });
  out.push(M("sun", jacket + dots([chefAt(-3.5, 10.6, 46), chefAt(-3.5, 10.6, 41), chefAt(3.5, 10.6, 46), chefAt(3.5, 10.6, 41)], { size: 1.3, tone: "hi" })));
  const pocket = k.pathOf([chefAt(-4, 11.8, 24), chefAt(4, 11.8, 24), chefAt(4, 11.8, 19), chefAt(-4, 11.8, 19)].map(at), true);
  out.push(M("cream", chefBox({ x: -8, y: 9.5, w: 16, d: 2.2, r: 1 }, 12, 18, { tone: "hi", crease: "lo" }, 2, 0) + `<path class="pocket" d="${pocket}"/>`));
  const armDown = (side) => M("sun", chefBox({ x: side < 0 ? -16 : 11, y: -4, w: 5, d: 8, r: 2 }, 26, 20, { tone: "hi" })) + skin(...chefAt(side * 13.5, 0, 24), 2.6);
  out.push(`<g class="arms-down arm-left">${armDown(-1)}</g>`);
  out.push(`<g class="arms-down">${armDown(1)}</g>`);
  const shoulder = chefAt(-11, 0);
  const hand = [PHONE.x + PHONE.w + 6, PHONE.y + 2];
  out.push(`<g class="arm-type" style="opacity:0">${M("sun", bar(shoulder, hand, 5, 43, 5, { tone: "hi" }))}<g class="typing-hand">${skin(hand[0], hand[1], 50.5, 2.8)}</g></g>`);
  const shrug = (side) => M("sun", bar(chefAt(side * 11, 0), chefAt(side * 25, 3), 5, 38, 5, { tone: "hi" })) + skin(...chefAt(side * 26, 3, 45), 2.8);
  out.push(`<g class="arms-shrug" style="opacity:0">${shrug(-1)}${shrug(1)}</g>`);
  out.push(`<g class="arms-up" style="opacity:0">${M("sun", chefBox({ x: 11, y: -3, w: 5, d: 6, r: 2 }, 44, 18, { tone: "hi" }))}${skin(...chefAt(13.5, 0, 65), 3.2)}${thumb(...chefAt(13.5, 0, 68.5))}</g>`);
  out.push(M("red", cyl(x, y, 6.6, 49, 3, { tone: "mid" }, 24) + chefBox({ x: -2.5, y: 6, w: 5, d: 2, r: 1 }, 45, 5, { tone: "mid" }, 2, 0)));
  const head = at([x, y, 58]);
  out.push(`<circle class="skin" cx="${f1(head[0])}" cy="${f1(head[1])}" r="${f1(8.2 * KS)}"/>`);
  const p = (du, dz) => at(chefAt(du, 7.6, 58 + dz));
  out.push(`<g class="eyes"><circle class="eye" cx="${f1(p(-3, 1.5)[0])}" cy="${f1(p(-3, 1.5)[1])}" r="${f1(1.05 * KS)}"/><circle class="eye" cx="${f1(p(3, 1.5)[0])}" cy="${f1(p(3, 1.5)[1])}" r="${f1(1.05 * KS)}"/></g>`);
  const mouth = (bend) => { const a = p(-2.6, -4.2); const b = p(2.6, -4.2); const c = p(0, -4.2 + bend); return `M${f1(a[0])} ${f1(a[1])}Q${f1(c[0])} ${f1(c[1])} ${f1(b[0])} ${f1(b[1])}`; };
  out.push(`<path class="mouth mouth-smile" d="${mouth(-2.4)}" style="opacity:0"/><path class="mouth mouth-frown" d="${mouth(2)}" style="opacity:0"/>`);
  out.push(`<circle class="cheek" cx="${f1(p(-4.6, -1.5)[0])}" cy="${f1(p(-4.6, -1.5)[1])}" r="${f1(1.4 * KS)}"/><circle class="cheek" cx="${f1(p(4.6, -1.5)[0])}" cy="${f1(p(4.6, -1.5)[1])}" r="${f1(1.4 * KS)}"/>`);
  const m = [p(-4.5, -1.6), p(-1, -0.6), p(0, -1.4), p(1, -0.6), p(4.5, -1.6), p(0, -3)];
  out.push(`<path class="moustache" d="M${f1(m[0][0])} ${f1(m[0][1])}Q${f1(m[1][0])} ${f1(m[1][1])} ${f1(m[2][0])} ${f1(m[2][1])}Q${f1(m[3][0])} ${f1(m[3][1])} ${f1(m[4][0])} ${f1(m[4][1])}Q${f1(m[5][0])} ${f1(m[5][1])} ${f1(m[0][0])} ${f1(m[0][1])}Z"/>`);
  out.push(M("cream", cyl(x, y, 7.8, 64, 7, { tone: "hi" }, 28) + L(k.knurl(x, y, 7.8, 64, 71, 12, P, 1), { tone: "lo" })));
  const puff = at([x, y, 78.5]);
  out.push(`<ellipse class="toque" cx="${f1(puff[0])}" cy="${f1(puff[1])}" rx="${f1(10.5 * KS)}" ry="${f1(7.5 * KS)}"/><path class="toque-fold" d="M${f1(puff[0] - 4 * KS)} ${f1(puff[1] + 5 * KS)}q${f1(2 * KS)} ${f1(-6 * KS)} 0 ${f1(-10 * KS)}M${f1(puff[0] + 4 * KS)} ${f1(puff[1] + 5 * KS)}q${f1(-2 * KS)} ${f1(-6 * KS)} 0 ${f1(-10 * KS)}"/>`);
  return out.join("");
}
/** A skin-coloured ball (hand or fist) of world radius r at a world point. */
const skin = (x, y, z, r) => {
  const c = at([x, y, z]);
  return `<circle class="skin" cx="${f1(c[0])}" cy="${f1(c[1])}" r="${f1(r * KS)}"/>`;
};
/** A raised thumb on a fist at a world point. */
const thumb = (x, y, z) => {
  const a = at([x, y, z]);
  const b = at([x, y, z + 4]);
  return `<path class="thumb" d="M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}"/>`;
};

/**
 * The agent as a small robot vacuum at the origin, about one floor tile across: dark bumper ring, coral shell with a lid
 * seam and a front sensor window, lidar turret, status light, a side brush on the floor.
 */
function robot() {
  const out = [`<path class="iso-halo" d="${k.haloOf({ x: -10, y: -10, w: 20, d: 20, r: 10 }, 0, 0.1, P)}" style="filter:blur(3px)"/>`];
  const brush = [0, 1, 2].map((i) => {
    const a = i * 2.1 + 0.4;
    return seg([6.6, 6.6, 0.7], [6.6 + Math.cos(a) * 4, 6.6 + Math.sin(a) * 4, 0.7]);
  }).join("");
  out.push(M("dark", L(brush, { tone: "mid" }) + cyl(0, 0, 9, 0.6, 3.2, { tone: "mid" }, 40) + L(k.sideArc(0, 0, 9, 2.2, P, 28), { tone: "lo" })));
  out.push(M("coral", cyl(0, 0, 8.5, 3.8, 2.6, { tone: "hi" }, 40) + L(k.ring(0, 0, 5.6, 6.4, P, 32), { tone: "lo" })));
  out.push(M("dark", cyl(-1.5, -1, 2.8, 6.4, 2.2, { tone: "mid" }, 20)));
  out.push(M("sun", cyl(-1.5, -1, 2.2, 8.6, 0.8, { tone: "hi" }, 20)));
  const led = at([3.8, 4.6, 6.5]);
  out.push(`<circle class="chest-led" cx="${f1(led[0])}" cy="${f1(led[1])}" r="${f1(0.9 * KS)}"/>`);
  return out.join("");
}

/** The card the robot carries on a short mast, facing the viewer; colour comes from data-carry and data-stamp. */
function card() {
  const plan = { x: 0.5, y: 1, w: 11, d: 1, r: 0.4 };
  return `<g class="card">${M("dark", L(seg([1, 1.5, 6.4], [1, 1.5, HAND_Z + 5]), { tone: "mid" }))}${M("cream", slab(plan, HAND_Z - 3, 8, { tone: "hi", crease: "lo" }, 2, 0))}<g transform="${face(1, 2.05, HAND_Z + 5)}"><rect class="card-face" x="0" y="0" width="10" height="8" rx=".8"/><rect class="card-line" x="1.5" y="1.8" width="6" height="1"/><circle class="card-stamp" cx="7.4" cy="5.4" r="1.8"/></g></g>`;
}

/** A wall lamp over one rack: bracket, shade and bulb. Its light is the WebGL layer under the front SVG. */
function lamp(x) {
  const bracket = slab({ x: x - 1.5, y: WALL_Y, w: 3, d: 9, r: 0.6 }, LAMP_Z + 8, 2.4, { tone: "mid" }, 2, 0);
  const shade = cyl(x, WALL_Y + 9, 6.5, LAMP_Z + 2, 7, { tone: "mid" }, 24);
  const bulb = at([x, WALL_Y + 9, LAMP_Z + 1]);
  return M("dark", bracket + shade) + `<ellipse class="bulb" cx="${f1(bulb[0])}" cy="${f1(bulb[1])}" rx="${f1(5 * KS)}" ry="${f1(2.6 * KS)}"/>`;
}

/** One rack: cobalt uprights with base plates, amber beams, three levels of family-coloured crates, an icon tag, alarm lamp, lock bar and X. */
function rack(i) {
  const x0 = RACK_X[i];
  const { y, d, w, h } = RACK;
  const out = [];
  const posts = [[x0, y], [x0 + w - 4, y], [x0, y + d - 4], [x0 + w - 4, y + d - 4]];
  const post = ([px, py], hh) => slab({ x: px - 1, y: py - 1, w: 6, d: 6, r: 0.6 }, 0, 1.4, { tone: "mid" }, 2, 0) + slab({ x: px, y: py, w: 4, d: 4, r: 0.6 }, 1.4, hh, { tone: "mid" }, 2, 0);
  out.push(M("cobalt", posts.slice(0, 2).map((p) => post(p, h)).join("")));
  [4, 25, 46].forEach((z, level) => {
    out.push(M("amber", slab({ x: x0, y, w, d, r: 1 }, z, 2.4, { tone: "mid" }, 2, 0.4) + dots([[x0 + 2, y + d, z + 1.2], [x0 + w - 2, y + d, z + 1.2]], { size: 0.9, tone: "hi" })));
    const crates = [];
    for (let c = 0; c < 3; c++) {
      const plan = { x: x0 + 5 + c * 18.5, y: y + 5, w: 15.5, d: 19, r: 1 };
      crates.push(slab(plan, z + 2.4, 14, { tone: "hi" }, 2, 0.5) + L(k.sideSeam(plan, z + 2.4 + 10, P, 2), { tone: "mid" }));
    }
    out.push(`<g class="crates lv${level}">${M(`crate${i}`, crates.join(""))}</g>`);
  });
  out.push(M("cobalt", posts.slice(2).map((p) => post(p, h + 2)).join("")));
  const tag = { x: x0 + 14, y: y + d - 3, w: w - 28, d: 3, r: 0.8 };
  out.push(M("dark", slab(tag, h + 2, 16, { tone: "hi", crease: "lo" }, 2, 0.4)));
  out.push(`<g transform="${face(tag.x, tag.y + tag.d + 0.1, h + 18)}"><rect class="tag-face" x="1.2" y="1.2" width="${tag.w - 2.4}" height="13.6" rx="1"/><g class="tag-icon"></g></g>`);
  return `<g class="rack" data-rack="${i}" data-status="idle">${out.join("")}</g>`;
}

/** Round wall clock on the warehouse: rim and hour ticks drawn once, hands rebuilt from the door's clock. */
function wallClock() {
  const [x, y, z, r] = CLOCK;
  const ring = [];
  const ticks = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    ring.push(at([x + Math.sin(a) * r, y + 0.2, z + Math.cos(a) * r]));
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r0 = i % 3 === 0 ? r - 4.5 : r - 3;
    ticks.push(k.pathOf([at([x + Math.sin(a) * r0, y + 0.3, z + Math.cos(a) * r0]), at([x + Math.sin(a) * (r - 1.2), y + 0.3, z + Math.cos(a) * (r - 1.2)])]));
  }
  return `<path class="clock-rim" d="${k.pathOf(ring, true)}"/><path class="clock-ticks" d="${ticks.join("")}"/><path data-id="hands" class="clock-hands" d=""/>`;
}

/** Valio Aimo's official logo on a light plate fixed flat to the warehouse wall above the lamps, drawn in the wall's plane. */
function logoSign() {
  const { x, z, w, h, pad, ratio } = LOGO;
  const imgH = h - 2 * pad;
  const imgW = imgH / ratio;
  return `<g class="logo-sign">${M("cream", slab({ x, y: WALL_Y, w, d: 1.6, r: 1 }, z, h, { tone: "hi", crease: "lo" }, 2, 0.4))}<g transform="${face(x, WALL_Y + 1.7, z + h)}"><rect class="logo-plate" x="0" y="0" width="${w}" height="${h}" rx="1.5"/><image href="assets/valio-aimo-logo.svg" x="${f1((w - imgW) / 2)}" y="${pad}" width="${f1(imgW)}" height="${f1(imgH)}" preserveAspectRatio="xMidYMid meet"/></g></g>`;
}

/** Border fence along x = GATE_X: petrol panels with bands, rose caps and graphite posts with bolts. */
function fence(from, to) {
  const plan = { x: GATE_X - 3, y: from, w: 6, d: to - from, r: 0.6 };
  const panel = M("petrol", slab(plan, 0, 30, { tone: "mid" }, 2, 0.4) + L([10, 20].map((z) => k.sideSeam(plan, z, P, 2)).join(""), { tone: "lo" }));
  const cap = M("rose", slab({ x: GATE_X - 4, y: from, w: 8, d: to - from, r: 1 }, 30, 3, { tone: "mid" }, 2, 0.4));
  const posts = [];
  for (let y = from; y <= to - 6; y += Math.max(20, (to - from - 6) / Math.round((to - from) / 28))) posts.push(slab({ x: GATE_X - 5, y, w: 10, d: 6, r: 1 }, 0, 38, { tone: "mid" }, 2, 0.4) + dots([[GATE_X, y + 3, 38]], { size: 1, tone: "hi" }));
  return panel + cap + M("gate", posts.join(""));
}

/** A graphite gate post on a dark base plate, with bolts, bands, a rose collar and hinge knuckles on its lane side. */
function post(y0, hinge) {
  const plan = { x: GATE_X - 8, y: y0, w: 16, d: 14, r: 1.5 };
  const base = M("dark", slab(k.insetPlan(plan, -3), 0, 3, { tone: "mid" }, 3, 0.4) + dots(k.corners(k.insetPlan(plan, -1.5), 0).map(([x, y]) => [x, y, 3]), { size: 1, tone: "hi" }));
  let out = slab(plan, 3, 97, { tone: "mid" }, 3, 0.8) + L(k.sideSeam(plan, 14, P, 3) + k.sideSeam(plan, 86, P, 3), { tone: "lo" });
  if (hinge) for (const z of [12, 44, 74]) out += cyl(HINGE[0], HINGE[1] + 1, 2.2, z, 7, { tone: "hi" }, 16);
  return base + M("gate", out) + M("rose", slab(k.insetPlan(plan, -0.6), 84, 4, { tone: "mid" }, 3, 0.4));
}

/** Graphite beam over the gate with its scanner head, glass strip, beacon lamp and the two masts that carry the sign. */
function beam() {
  const out = [M("gate", slab({ x: GATE_X - 10, y: -30, w: 20, d: 82, r: 1.5 }, 100, 10, { tone: "mid" }, 3, 0.8) + dots([[GATE_X - 6, -26, 110], [GATE_X - 6, 48, 110], [GATE_X + 6, -26, 110], [GATE_X + 6, 48, 110]], { size: 1, tone: "hi" }))];
  out.push(M("rose", slab({ x: GATE_X - 10.6, y: -30.6, w: 21.2, d: 83.2, r: 1.8 }, 100, 2.6, { tone: "mid" }, 3, 0.4)));
  out.push(M("dark", slab({ x: GATE_X - 20, y: -10, w: 10, d: 42, r: 1.5 }, 92, 10, { tone: "mid" }, 3, 0.6)));
  out.push(`<path class="scan-glass" d="${k.pathOf([at([GATE_X - 20, -8, 92]), at([GATE_X - 20, 30, 92]), at([GATE_X - 17, 30, 92]), at([GATE_X - 17, -8, 92])], true)}"/>`);
  out.push(M("dark", cyl(GATE_X, 11, 8, 110, 4, { tone: "mid" }, 28)));
  out.push(`<g class="beacon">${cyl(GATE_X, 11, 6, 114, 11, { tone: "hi", className: "beacon-lamp" }, 28)}</g>`);
  out.push(M("dark", cyl(GATE_X, 11, 7, 125, 2.4, { tone: "mid" }, 28)));
  out.push(M("dark", cyl(GATE_X, -22, 1.4, 110, 22, { tone: "mid" }, 10) + cyl(GATE_X, 0, 1.4, 110, 22, { tone: "mid" }, 10)));
  return out.join("");
}

/** The LAZYDOOR sign on the beam's masts, in the gate's own plane: pale rose letters on a graphite plate that faces the kitchen side. */
function sign() {
  const [y0, w, z, h] = [-50, 78, 128, 20];
  return `<g class="neon">${M("gate", slab({ x: GATE_X - 3, y: y0, w: 2.4, d: w, r: 0.6 }, z, h, { tone: "mid" }, 2, 0.4))}<g transform="${faceX(GATE_X - 3.1, y0, z + h)}"><rect class="neon-back" x="1" y="1" width="${w - 2}" height="${h - 2}" rx="2"/><text class="neon-text" x="${w / 2 + 1}" y="${h / 2 + 4}" font-size="11" text-anchor="middle">LAZYDOOR</text></g></g>`;
}

/** The kitchen terminal on a pedestal: a glowing screen facing the viewer with an icon per state, and a keypad on its right side where the chef types. */
function phone() {
  const p = PHONE;
  const stand = M("dark", slab({ x: p.x + 14, y: p.y - 6, w: 16, d: 12, r: 2 }, 0, p.z - 2, { tone: "mid" }, 3, 0.4) + slab({ x: p.x + 4, y: p.y - 10, w: 36, d: 20, r: 3 }, 0, 3, { tone: "mid" }, 3, 0.4) + slab({ x: p.x + 8, y: p.y - 4, w: 28, d: 8, r: 2 }, p.z - 2, 2.4, { tone: "mid" }, 3, 0.4));
  const screen = `<g transform="${face(p.x, p.y + p.d + 0.1, p.z + p.h)}"><rect class="phone-screen" x="3" y="5" width="${p.w - 6}" height="${p.h - 10}" rx="3"/><rect class="phone-notch" x="${p.w / 2 - 5}" y="2" width="10" height="1.6" rx=".8"/><g class="phone-icon" data-id="phonei"></g><g class="ph-buttons"><rect class="btn-ok" x="6" y="${p.h - 18}" width="14" height="8" rx="3"/><rect class="btn-no" x="${p.w - 20}" y="${p.h - 18}" width="14" height="8" rx="3"/></g></g>`;
  const pad = { x: p.x + p.w, y: p.y - 4, w: 12, d: 10, r: 1.5 };
  const keys = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) keys.push([pad.x + 3 + i * 3, pad.y + 2.5 + j * 2.5, p.z + 22]);
  const keypad = M("dark", slab({ x: p.x + p.w - 1, y: p.y - 2, w: 4, d: 6, r: 1 }, p.z + 16, 3, { tone: "mid" }, 2, 0) + slab(pad, p.z + 19, 3, { tone: "mid" }, 3, 0.4)) + dots(keys, { size: 0.9, tone: "hi" });
  return stand + `<g data-id="phone">${M("phone", slab({ x: p.x, y: p.y, w: p.w, d: p.d, r: 3 }, p.z, p.h, { tone: "hi", crease: "lo" }, 4, 0.6))}${screen}${keypad}</g>`;
}

/**
 * A cab-over delivery truck built at the origin, cab front at x = 0 facing −x, body along +x, side at y = 38 facing the viewer:
 * chassis, bumper with plate and fog lamps, cab with windscreen, wipers, grille and headlights, roof deflector and lights,
 * side window, door, handle, steps and mirror, exhaust stack, fuel tank, an open-sided box (a plain top rail in the frame's
 * colour, no panel, no lettering) with eight crate places inside, marker lights,
 * wheels with tyres, rims, hubs and nuts under arches, mudflap.
 */
function truck() {
  const out = [];
  const D = 38;
  out.push(`<path class="iso-halo" d="${k.haloOf({ x: 0, y: 0, w: T_LEN, d: D, r: 4 }, 0, 0.1, P)}" style="filter:blur(5px)"/>`);
  out.push(M("dark", slab({ x: 6, y: 5, w: 132, d: 28, r: 1 }, 8, 6, { tone: "mid" }, 2, 0.4)));
  const box = { x: 46, y: 0, w: 94, d: D, r: 2 };
  out.push(M("dark", slab({ x: box.x, y: 0, w: box.w, d: D, r: 1 }, 14, 3, { tone: "mid" }, 2, 0.4)));
  out.push(M("deep", slab({ x: box.x, y: 0, w: box.w, d: 3, r: 0.6 }, 17, 53, { tone: "mid" }, 2, 0.4) + L([30, 44, 58].map((z) => seg([box.x, 3, z], [box.x + box.w, 3, z])).join(""), { tone: "lo" })));
  out.push(M("sun", slab({ x: box.x, y: 0, w: 3, d: D, r: 0.6 }, 17, 53, { tone: "mid" }, 2, 0.4) + slab({ x: box.x + box.w - 3, y: 0, w: 3, d: D, r: 0.6 }, 17, 53, { tone: "mid" }, 2, 0.4)));
  const load = [];
  for (let i = 0; i < 8; i++) {
    const plan = { x: box.x + 6 + (i % 4) * 21.5, y: 8, w: 18, d: 22, r: 1 };
    const z = 17 + Math.floor(i / 4) * 16;
    load.push(`<g class="tcrate" data-i="${i}" style="opacity:0">${M("crate2", slab(plan, z, 15, { tone: "hi" }, 2, 0.5) + L(k.sideSeam(plan, z + 11, P, 2), { tone: "mid" }))}</g>`);
  }
  out.push(`<g data-id="tcrates">${load.join("")}</g>`);
  out.push(M("sun", [box.x, box.x + box.w - 3].map((px) => slab({ x: px, y: D - 3, w: 3, d: 3, r: 0.4 }, 17, 53, { tone: "mid" }, 2, 0)).join("")));
  out.push(M("sun", slab({ x: box.x, y: D - 4, w: box.w, d: 4, r: 1 }, 66, 4, { tone: "mid" }, 2, 0.4)));
  out.push(M("dark", slab({ x: box.x - 1, y: -1, w: box.w + 2, d: D + 2, r: 2 }, 70, 3, { tone: "mid" }, 2, 0.4)));
  out.push(`<g class="markers">${dots([...Array(7)].map((_, i) => [box.x + 7 + i * 13.3, D + 0.2, 15.5]), { size: 1.6, tone: "hi" })}</g>`);
  out.push(M("dark", slab({ x: 42, y: 2, w: 4, d: D - 4, r: 1 }, 14, 48, { tone: "mid" }, 2, 0)));
  out.push(M("dark", slab({ x: 24, y: 28, w: 16, d: 9, r: 3 }, 6, 8, { tone: "mid" }, 3, 0.4) + L(k.sideSeam({ x: 24, y: 28, w: 16, d: 9, r: 3 }, 10, P, 3), { tone: "lo" })));
  out.push(M("steel", cyl(40, 33, 2.4, 14, 50, { tone: "mid" }, 14) + cyl(40, 33, 2.8, 62, 3, { tone: "hi" }, 14)));
  const cab = { x: 4, y: 0, w: 38, d: D, r: 5 };
  out.push(M("cobalt", slab(cab, 13, 50, { tone: "hi" }, 6, 1)));
  out.push(M("cobalt", slab({ x: 9, y: 2, w: 30, d: D - 4, r: 4 }, 63, 6, { tone: "mid" }, 4, 0.6)));
  out.push(`<g class="roof-lights">${dots([...Array(5)].map((_, i) => [10, 6 + i * 6.5, 69.4]), { size: 1.7, tone: "hi" })}</g>`);
  out.push(`<g transform="${faceX(4, 0, 62)}"><rect class="windscreen" x="3" y="2" width="${D - 6}" height="19" rx="2.5"/><path class="wiper" d="M8 20L16 11M${D - 12} 20L${D - 4} 11"/><g class="grille"><rect x="7" y="28" width="${D - 14}" height="12" rx="1.5"/><path d="M8.5 31H${D - 8.5}M8.5 34H${D - 8.5}M8.5 37H${D - 8.5}"/></g><rect class="headlight" x="2.5" y="30" width="5" height="6" rx="1.5"/><rect class="headlight" x="${D - 7.5}" y="30" width="5" height="6" rx="1.5"/><rect class="indicator" x="2.5" y="37.5" width="5" height="2" rx="1"/><rect class="indicator" x="${D - 7.5}" y="37.5" width="5" height="2" rx="1"/></g>`);
  out.push(M("dark", slab({ x: -2, y: 1, w: 7, d: D - 2, r: 2 }, 6, 8, { tone: "mid" }, 3, 0.4)));
  out.push(`<g transform="${faceX(-2, 1, 13)}"><rect class="plate" x="${(D - 2) / 2 - 7}" y="1.5" width="14" height="4.5" rx="1"/><rect class="foglamp" x="3" y="2" width="4" height="3" rx="1"/><rect class="foglamp" x="${D - 9}" y="2" width="4" height="3" rx="1"/></g>`);
  out.push(`<g transform="${face(4, D + 0.1, 62)}"><rect class="side-window" x="4" y="2" width="20" height="17" rx="2"/><path class="door-line" d="M3 0.5V45M27 0.5V45M3 0.5H27"/><rect class="handle" x="20" y="24" width="5" height="1.6" rx=".8"/></g>`);
  out.push(M("dark", slab({ x: 10, y: D - 1, w: 18, d: 4, r: 1 }, 7, 2, { tone: "mid" }, 2, 0) + slab({ x: 10, y: D - 1, w: 18, d: 4, r: 1 }, 2.5, 2, { tone: "mid" }, 2, 0)));
  out.push(M("dark", slab({ x: 3, y: D, w: 3, d: 7, r: 0.6 }, 48, 2, { tone: "mid" }, 2, 0) + slab({ x: 1.5, y: D + 5, w: 5, d: 3, r: 1 }, 38, 14, { tone: "mid" }, 2, 0.4)));
  for (const wx of [22, 102, 124]) {
    const arch = [];
    for (let i = 0; i <= 16; i++) {
      const a = Math.PI * (i / 16);
      arch.push(at([wx - Math.cos(a) * 12.5, D + 0.6, 10 + Math.sin(a) * 12.5]));
    }
    out.push(`<path class="arch" d="${k.pathOf(arch)}"/>`);
    out.push(`<path class="tyre" d="${k.sideRing([wx, D + 1, 10], 10, "y", P, 32)}"/><path class="tread" d="${k.sideRing([wx, D + 1.1, 10], 8.4, "y", P, 32)}"/><path class="rim" d="${k.sideRing([wx, D + 1.2, 10], 6, "y", P, 24)}"/><path class="hub" d="${k.sideRing([wx, D + 1.4, 10], 2.4, "y", P, 14)}"/>`);
    const nuts = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      nuts.push(at([wx + Math.cos(a) * 4.2, D + 1.5, 10 + Math.sin(a) * 4.2]));
    }
    out.push(k.dotsSvg(nuts, { size: 0.9, tone: "hi" }));
  }
  out.push(`<path class="mudflap" d="${k.pathOf([at([134, D + 0.8, 14]), at([138, D + 0.8, 14]), at([138, D + 0.8, 3]), at([134, D + 0.8, 3])], true)}"/>`);
  return `<g data-id="truck">${out.join("")}</g>`;
}

/** The dock gate in front of the parked truck: post, cap and lamp; the striped boom is drawn per frame. */
function barrier() {
  const { x, post } = BARRIER;
  const lamp = at([x, post, 33]);
  const plan = { x: x - 5, y: post - 5, w: 10, d: 10, r: 2 };
  return M("amber", slab(plan, 0, 26, { tone: "mid" }, 3, 0.6) + L(k.sideSeam(plan, 8, P, 3), { tone: "lo" })) + M("dark", slab({ x: x - 6, y: post - 6, w: 12, d: 12, r: 2 }, 26, 4, { tone: "mid" }, 3, 0.4)) + `<path data-id="boom" class="boom" d=""/><path data-id="boom-stripes" class="boom-stripes" d=""/><circle data-id="blamp" class="barrier-lamp" cx="${f1(lamp[0])}" cy="${f1(lamp[1])}" r="${f1(2.8 * KS)}"/>`;
}

/** A small crate built at the origin, moved in screen space when it flies between shelf, truck and counter. */
const flyingCrate = (material) => M(material, slab({ x: -8, y: -9, w: 16, d: 18, r: 1 }, 0, 13, { tone: "hi" }, 2, 0.5) + L(k.sideSeam({ x: -8, y: -9, w: 16, d: 18, r: 1 }, 9, P, 2), { tone: "mid" }));

/** A wire from the scanner to every rack tag: the door asking Valio about each candidate. */
function asks() {
  const from = [GATE_X - 15, 30, 95];
  return RACK_X.map((x0) => k.wireSvg(at(from), at([x0 + RACK.w / 2, RACK.y + RACK.d, RACK.h + 18]), { tone: "lit", flow: true, ends: "to", size: 1.8 })).join("");
}

/** Warm wall-lamp light: a pool in front of each rack and a wash down the wall under each lamp, in the scene's own camera. */
const LAMP_FRAGMENT = `
uniform float uLamp;
const float WALLY=${WALL_Y.toFixed(1)};
const float LZ=${(LAMP_Z + 1).toFixed(1)};
const float POOLY=${(RACK.y + RACK.d + 12).toFixed(1)};
float pool(vec3 p,float lx){vec2 q=vec2((p.x-lx)/26.,(p.y-POOLY)/22.);return exp(-dot(q,q));}
float wash(vec3 p,float lx){float drop=LZ-p.z;float w=7.+max(drop,0.)*.32;return exp(-pow((p.x-lx)/w,2.))*smoothstep(-4.,6.,drop)*exp(-max(drop,0.)/70.);}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  float px=pixelOf();
  vec3 pw=onWallY(vb,WALLY);
  float wall=window(pw.x,${WALL.x.toFixed(1)},${(WALL.x + WALL.w).toFixed(1)},.7*px)*window(pw.z,0.,${WALL.h.toFixed(1)},.7*px/uCam.w);
  vec3 pf=onFloor(vb,.6);
  float floorIn=window(pf.x,-60.,302.,.7*px)*window(pf.y,WALLY,49.,.7*px/uCam.z)*(1.-wall);
  float e=0.;
  ${LAMPS.map((x) => `e+=wall*wash(pw,${x.toFixed(1)})+floorIn*pool(pf,${x.toFixed(1)});`).join("\\n  ")}
  e*=uLamp;
  float a=.6*(1.-exp(-1.8*e));
  vec3 gold=mix(vec3(1.,.66,.24),vec3(1.,.9,.62),smoothstep(.5,1.2,e));
  gl_FragColor=vec4(gold*a,a);
}`;

/** Sky stops [top, middle, horizon]: petrol night, the warm horizon as the cut-off nears, and red once an approval expires. */
const SKY = {
  night: [[2, 22, 29], [5, 46, 58], [14, 86, 100]],
  warm: [[3, 20, 30], [26, 52, 66], [240, 140, 64]],
  red: [[18, 3, 8], [70, 10, 22], [214, 40, 44]],
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
const CONFETTI = Array.from({ length: 64 }, () => ({ vx: (RNG() - 0.5) * 460, vy: -280 - RNG() * 320, spin: 6 + RNG() * 14, hue: Math.floor(RNG() * 5), w: 9 + RNG() * 7 }));
const RAIN = Array.from({ length: 18 }, () => ({ x: (RNG() - 0.5) * 2, phase: RNG(), speed: 0.9 + RNG() * 0.5 }));

/**
 * Where the truck is and what it is doing at age seconds into its current state: for an accepted order it loads,
 * drives to the kitchen bay, unloads, then drives back to the dock; a naive load drives to the closed barrier and stops.
 */
export function truckRun(tr, age) {
  const n = Math.max(1, tr.crates || 1);
  if (tr.status === "loading" && !tr.naive) {
    const [drive, stay, driveBack] = [2.6, 3, 2.4];
    const load = n * 0.22 + 0.45;
    const go = load + 0.35;
    const arrive = go + drive;
    const unloadDone = arrive + Math.min(n, 8) * 0.16 + 0.45;
    const back = arrive + stay;
    const home = back + driveBack;
    let front = DOCK_X;
    let v = 0;
    if (age >= go && age < arrive) {
      const u = (age - go) / drive;
      front = lerp(DOCK_X, BAY_X, ease(u));
      v = ((BAY_X - DOCK_X) * 6 * u * (1 - u)) / drive;
    } else if (age >= arrive && age < back) front = BAY_X;
    else if (age >= back && age < home) {
      const u = (age - back) / driveBack;
      front = lerp(BAY_X, DOCK_X, ease(u));
      v = ((DOCK_X - BAY_X) * 6 * u * (1 - u)) / driveBack;
    }
    return { n, load, go, arrive, unloadDone, back, home, front, v, accepted: true };
  }
  return { n, load: n * 0.22 + 0.45, front: DOCK_X, v: 0, accepted: false };
}

/**
 * Whether the dock boom is up at age seconds into the truck's state: from just before an accepted truck leaves until it
 * is parked at the dock again, so it rises once per run; a refused, stuck or parked truck keeps it down.
 */
export function boomOpen(tr, age) {
  const run = truckRun(tr, age);
  return run.accepted && age >= run.go - 0.5 && age < run.home + 0.3;
}

/** Builds the scene into host (back SVG, lamp canvas, front SVG) and returns draw(state, t, dt, options). */
export function buildScene(host) {
  const back = `<svg class="iso-svg scene-back" viewBox="0 0 ${W} ${H}" role="img" aria-label="Isometric scene: a hotel chef in his kitchen, the buyer agent robot, Lazydoor's gate and road barrier, Valio Aimo's brick warehouse with racks, the manager's phone, and a delivery truck on the road between the warehouse dock and the kitchen.">${plate()}${backWalls()}</svg>`;
  const front = `<svg class="iso-svg scene-front" viewBox="0 0 ${W} ${H}" aria-hidden="true">
<defs><filter id="glow" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="7"/></filter></defs>
<g>${logoSign()}${wallClock()}${LAMPS.map(lamp).join("")}${kitchen()}${[3, 2, 1, 0].map(rack).join("")}<g data-id="gate-fence">${fence(-120, -28)}</g><g data-id="gate-post">${post(-28, true)}</g>${phone()}</g>
<path data-id="stopline" class="stop-line" d="${k.lineOnTop([GATE_X - 24, -12], [GATE_X - 24, 34], 0.7, P)}"/>
<g data-id="asks" style="opacity:0">${asks()}</g>
<path data-id="sneak" class="sneak" d="" style="opacity:0"/>
<g data-id="leaf"></g>
<g data-id="chef">${chef()}</g>
<g data-id="agent">${robot()}${card()}</g>
<g data-id="gate-front">${post(36, false)}${beam()}</g>
<g data-id="gate-sign">${sign()}</g>
<g data-id="trail"></g>
<g data-id="letter" class="letter" style="opacity:0">${LETTER}</g>
${truck()}
<g data-id="exhaust"></g>
<g>${barrier()}</g>
<g data-id="scan"></g>
<g data-id="flying"></g>
<g data-id="doorfly"></g>
<g data-id="bursts"></g>
<g data-id="doorchips"></g>
<g data-id="dockchip" class="chip-g" style="opacity:0"><rect class="chip-box"/><g class="chip-icon"></g><text class="chip-text"></text></g>
<g data-id="rings"></g>
<g data-id="confetti"></g>
<g data-id="chips"></g>
<g data-id="phonechip" class="chip-g" style="opacity:0"><rect class="chip-box"/><g class="chip-icon"></g><text class="chip-text"></text></g>
<g data-id="receipt" class="receipt" style="opacity:0"><rect class="receipt-box" width="216" height="80" rx="12"/><g class="receipt-icon">${icon("receipt", 14, 14, 31)}</g><text class="receipt-amount" x="54" y="37"></text><text class="receipt-day" x="54" y="64">Mon 16 Nov</text></g>
<g data-id="gateshock" style="opacity:0"><circle class="stamp-shock" r="20"/><circle class="stamp-shock s2" r="20"/></g>
<g data-id="stampfx" style="opacity:0"><rect class="banner-box" x="0" y="0" width="344" height="232" rx="12"/><g class="stamp-badge" transform="translate(50 50)"><g class="badge-in"><circle class="stamp-disc" r="34"/><g class="stamp-icon"></g></g></g><g class="stamp-labels"></g></g>
<g data-id="bubble" class="typed" style="opacity:0"><path class="typed-box"/><text class="typed-text"></text></g>
<g data-id="label" class="label" style="opacity:0"><rect class="label-box" rx="10"/><text class="label-text"></text></g>
</svg>`;
  host.innerHTML = `${back}<canvas class="scene-gl" aria-hidden="true"></canvas>${front}`;
  const root = host.querySelector(".scene-front");
  const stage = host.closest(".stage") ?? host;
  const q = (id) => root.querySelector(`[data-id="${id}"]`);
  const ids = ["agent", "gate-fence", "gate-post", "gate-front", "gate-sign", "stopline", "leaf", "asks", "sneak", "scan", "truck", "trail", "phone", "bubble", "label", "exhaust", "doorfly", "bursts", "doorchips", "dockchip", "rings", "confetti", "stampfx", "gateshock", "chips", "phonechip", "receipt", "flying", "counter", "chef", "letter", "boom", "boom-stripes", "blamp", "hands", "calday", "caldate", "phonei"];
  const el = Object.fromEntries(ids.map((id) => [id, q(id)]));
  const racks = [...root.querySelectorAll(".rack")].sort((a, b) => a.dataset.rack - b.dataset.rack);
  const counterCrates = [...el.counter.querySelectorAll(".ccrate")];
  const truckCrates = [...el.truck.querySelectorAll(".tcrate")];
  const cardEl = el.agent.querySelector(".card");
  const beacon = root.querySelector(".beacon");
  const armsDown = [...el.chef.querySelectorAll(".arms-down")];
  const armsUp = el.chef.querySelector(".arms-up");
  const armLeft = el.chef.querySelector(".arm-left");
  const armType = el.chef.querySelector(".arm-type");
  const armsShrug = el.chef.querySelector(".arms-shrug");
  const typingHand = el.chef.querySelector(".typing-hand");
  const eyes = el.chef.querySelector(".eyes");
  const smile = el.chef.querySelector(".mouth-smile");
  const frown = el.chef.querySelector(".mouth-frown");
  const layer = glLayer({ canvas: host.querySelector(".scene-gl"), fragment: LAMP_FRAGMENT, view: [W, H], camera: glCamera(P), uniforms: ["uLamp"], onError: () => {} });

  const setText = (node, value) => {
    if (node && node.textContent !== value) node.textContent = value;
  };
  const setAttr = (node, name, value) => {
    if (value === null || value === undefined) node.removeAttribute(name);
    else if (node.getAttribute(name) !== String(value)) node.setAttribute(name, value);
  };
  /** Puts an icon into a group once per change of name. */
  const setIcon = (node, name, x, y, size) => {
    const key = `${name}|${x}|${y}|${size}`;
    if (!node || node.dataset.key === key) return;
    node.dataset.key = key;
    node.innerHTML = name ? icon(name, x, y, size) : "";
  };
  /** Keeps a pool of n children made by make() in a group and returns them. */
  const pool = (group, n, make) => {
    while (group.children.length < n) {
      const holder = document.createElementNS("http://www.w3.org/2000/svg", "g");
      holder.innerHTML = make(group.children.length);
      group.appendChild(holder.firstElementChild);
    }
    return [...group.children];
  };
  const svgNode = (tag, cls) => `<${tag} class="${cls}"/>`;
  const chipMarkup = () => `<g class="chip-g"><rect class="chip-box"/><g class="chip-icon"></g><text class="chip-text"></text></g>`;
  /** Width and height of a label chip for its text, icon and font size. */
  const chipSize = (text, iconName, size = 21) => {
    const perChar = text === text.toUpperCase() && /[A-Z]/.test(text) ? 0.68 : 0.57;
    return { width: Math.round(text.length * size * perChar + (iconName ? size * 1.5 : 0) + 30), height: Math.round(size * 1.75) };
  };
  /** A label chip: rounded box, icon and text at a screen point, sized to its text. Returns its screen box. */
  const chip = (node, { x, y, text, iconName, tone, size = 21, anchor = "middle" }) => {
    const { width, height } = chipSize(text, iconName, size);
    const left = Math.max(14, Math.min(W - 14 - width, anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x));
    setAttr(node, "data-tone", tone ?? "");
    setAttr(node, "transform", `translate(${f1(left)} ${f1(y - height)})`);
    const box = node.querySelector(".chip-box");
    setAttr(box, "width", width);
    setAttr(box, "height", height);
    setAttr(box, "rx", 10);
    setIcon(node.querySelector(".chip-icon"), iconName ?? "", 14, (height - size * 1.05) / 2, size * 1.05);
    const label = node.querySelector(".chip-text");
    setAttr(label, "x", iconName ? 14 + size * 1.35 : 15);
    setAttr(label, "y", f1(height / 2 + size * 0.36));
    setAttr(label, "font-size", size);
    setText(label, text);
    return [left, y - height, left + width, y];
  };

  /** Screen boxes [x0, y0, x1, y1] that text keeps clear of this frame: the chef, the agent, the truck, the door, and labels placed so far. */
  const taken = [];
  const GAP = 6;
  const rest = new Map();
  /** A group's screen box at rest (its own transform left out), measured once, moved by (dx, dy). */
  const bodyBox = (node, dx = 0, dy = 0) => {
    let b = rest.get(node);
    if (!b) {
      const r = node.getBBox();
      if (!r.width) return null;
      b = [r.x, r.y, r.x + r.width, r.y + r.height];
      rest.set(node, b);
    }
    return [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
  };
  /** True when box b stays inside the drawing above the caption and keeps GAP from everything taken. */
  const clear = (b) => b[0] >= 8 && b[1] >= 8 && b[2] <= W - 8 && b[3] <= CARD_BOTTOM && taken.every((o) => b[0] >= o[2] + GAP || b[2] <= o[0] - GAP || b[1] >= o[3] + GAP || b[3] <= o[1] - GAP);
  /**
   * Picks a w×h spot [left, top] for a label from candidates, trying the spot it used last frame first so it does not
   * flicker between two, and reserves it. Returns null when every candidate would cover something: the label then waits.
   */
  const place = (key, w, h, candidates) => {
    const last = live.spot[key];
    const order = last !== undefined && candidates[last] ? [last, ...candidates.keys()] : [...candidates.keys()];
    const i = order.find((j) => clear([candidates[j][0], candidates[j][1], candidates[j][0] + w, candidates[j][1] + h]));
    live.spot[key] = i;
    if (i === undefined) return null;
    const [x, y] = candidates[i];
    taken.push([x, y, x + w, y + h]);
    return [x, y];
  };

  /** The robot's path: parked at the foot of the kitchen terminal, out round the chef onto the lane, along it to the door's scan line. */
  const ROUTE = [[-284, -11], [-258, LANE], [-106, LANE]];
  const lengths = (route) => route.reduce((acc, p, i) => (i ? [...acc, acc[i - 1] + Math.hypot(p[0] - route[i - 1][0], p[1] - route[i - 1][1])] : [0]), []);
  const pointOn = (route, cum, s) => {
    const i = Math.max(1, cum.findIndex((c) => c >= s));
    if (s >= cum.at(-1)) return route.at(-1);
    const [a, b] = [route[i - 1], route[i]];
    const u = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
  const RC = lengths(ROUTE);
  const STATION = { chef: 0, home: 0, door: RC[2] };
  const HAND_AT_DOOR = at([ROUTE[2][0] + 6, ROUTE[2][1] + 2, HAND_Z + 1]);
  const RACK_TOP = at([RACK_X[0] + RACK.w / 2, RACK.y + RACK.d, RACK.h + 18]);
  /** Control point of the raw API arc in Act 1: high over the place where the door will stand. */
  const RAW_BEND = [(HAND_AT_DOOR[0] + RACK_TOP[0]) / 2, Math.min(HAND_AT_DOOR[1], RACK_TOP[1]) - 150];
  /** Parts of the door in build order, with the delay in seconds before each lowers into place. */
  const GATE_PARTS = [["gate-fence", 0], ["gate-post", 0.45], ["gate-front", 0.9], ["leaf", 1.5], ["gate-sign", 2.1], ["stopline", 2.7]];
  const live = { s: STATION.home, v: 0, leaf: 0, leafShown: "", warm: 0, red: 0, lampDrawn: -1, boom: 0, today: ["SAT", "14"], happy: false, handKey: null, handAt: null, spot: {} };

  /** Moves s toward target along a route with a speed limit and a short ease in and out. */
  const travel = (s, v, target, dt) => {
    const want = Math.max(-130, Math.min(130, (target - s) * 4.5));
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
      seal.push(onFace(25 + Math.cos(phi) * 9, 54 + Math.sin(phi) * 9));
    }
    const extra = share < 0.55 ? `<path class="leaf-panel" d="${quad(6, 44, 10, 38)}"/><path class="leaf-window" d="${quad(9, 41, 70, 79)}"/><path class="leaf-seal" data-stamp="${STAMP[stamp] ? stamp : ""}" d="${k.pathOf(seal, true)}"/><path class="leaf-kick" d="${quad(3, 47, 5, 9)}"/><path class="leaf-slot-frame" d="${quad(13, 37, 40.5, 44.5)}"/><path class="leaf-slot" d="${quad(15, 35, 41.5, 43.5)}"/>${k.dotsSvg([onFace(44, 42)], { size: 1.8, tone: "hi" })}` : "";
    el.leaf.innerHTML = M("garnet", S(paths, { tone: "hi", crease: "lo" }) + extra);
  };

  /** Draws one frame from state at scene time t; snap jumps eased parts to their targets, calm turns effects off. */
  function draw(state, t, dt, { snap = false, calm = false } = {}) {
    dt = Math.min(dt, 1 / 20);
    const stamp = STAMP[state.door.stamp] ? state.door.stamp : null;
    const target = STATION[state.agent.at] ?? STATION.home;
    const passes = stamp === "AUTO" || (stamp === "NEEDS_APPROVAL" && state.phone.status === "approved");
    live.leaf = follow(live.leaf, passes ? 1 : 0, dt, 0.2, snap || calm);
    if (snap) [live.s, live.v] = [target, 0];
    else [live.s, live.v] = travel(live.s, live.v, target, dt);
    const leafKey = `${live.leaf.toFixed(3)}|${stamp}`;
    if (leafKey !== live.leafShown) {
      drawLeaf(live.leaf, stamp);
      live.leafShown = leafKey;
    }
    const [ax, ay] = pointOn(ROUTE, RC, live.s);
    setAttr(el.agent, "transform", k.translateAlong(P, [ax, ay, 0]));
    setAttr(cardEl, "data-carry", state.agent.carry ?? "none");
    setAttr(cardEl, "data-stamp", state.agent.carry === "quote" || state.agent.carry === "rejected" ? stamp ?? "" : state.agent.carry === "receipt" ? "AUTO" : "");
    const posted = drawLetter(state, t, snap, calm, ax, ay);
    setAttr(cardEl, "style", state.agent.carry && !posted ? null : "opacity:0");

    const o = at([0, 0, 0]);
    const moved = (node, p) => {
      const q = at(p);
      return bodyBox(node, q[0] - o[0], q[1] - o[1]);
    };
    const agentBox = moved(el.agent, [ax, ay, 0]);
    const leaf = el.leaf.getBBox();
    const gateParts = state.gate.built ? [...["gate-fence", "gate-post", "gate-front", "gate-sign"].map((id) => bodyBox(el[id])), leaf.width ? [leaf.x, leaf.y, leaf.x + leaf.width, leaf.y + leaf.height] : null] : [];
    taken.length = 0;
    taken.push(...[...KEEP_CLEAR, bodyBox(el.chef), agentBox, moved(el.truck, [truckRun(state.truck, t - state.truck.since).front, TRUCK_Y, 0]), ...gateParts].filter(Boolean));

    drawGate(state.gate, t, calm);
    drawRaw(state, t);
    drawRacks(state, t, calm);

    setAttr(el.asks, "style", state.door.scan ? `stroke-dashoffset:${f1(-t * 24)}` : "opacity:0");
    if (state.door.scan && Math.abs(live.v) < 6) {
      const z = 1 + (calm ? 0.5 : Math.sin((t - state.door.since) * 3.4) * 0.5 + 0.5) * 18;
      const y = ay + 10;
      const ends = [at([ax - 10, y, z]), at([ax + 10, y, z])];
      const head = [at([GATE_X - 16, -6, 92]), at([GATE_X - 16, 28, 92])];
      el.scan.innerHTML = `<path class="scan-fan" d="${k.pathOf([head[0], head[1], ends[1], ends[0]], true)}"/><path class="scan-line" d="${k.pathOf(ends)}"/>`;
    } else if (el.scan.firstChild) el.scan.innerHTML = "";

    setAttr(beacon, "data-stamp", state.door.scan && !stamp ? (calm || Math.floor(t * 4) % 2 === 0 ? "SCAN" : "SCAN-OFF") : stamp ?? "");
    const run = truckRun(state.truck, t - state.truck.since);
    const shippedAt = run.accepted && state.truck.since >= state.door.since ? state.truck.since + run.go : Infinity;
    drawStamp(stamp, state.door.reasons, state.door.since, state.phone.status, t, calm, shippedAt);
    drawPhone(state.phone, t, calm);
    drawClock(state.now);
    const typed = drawTyped(state, t, calm);
    drawDoor(state, t, calm);
    drawTruck(state, t, dt, snap, calm);
    flushBursts(t, calm);
    drawChef(state, t, typed, calm);
    drawLabel(state, ax, ay, agentBox);
    drawSky(state, dt, snap || calm);
  }

  /** The door is not there in Story Act 1; once it is built its parts lower into place one after another and the sign lights up in place. */
  function drawGate(gate, t, calm) {
    for (const [id, delay] of GATE_PARTS) {
      const e = !gate.built ? 0 : calm ? 1 : ease((t - gate.since - delay) / 0.9);
      const drop = id === "gate-sign" ? 0 : 20;
      setAttr(el[id], "transform", e < 1 && drop ? k.translateAlong(P, [0, 0, drop * (1 - e)]) : null);
      setAttr(el[id], "style", e < 1 ? `opacity:${e.toFixed(3)}` : null);
    }
  }

  /** Act 1, before the door exists: a dashed grey arc from the agent straight to rack 0, the raw supplier API it calls. */
  function drawRaw(state, t) {
    const step = state.naive.step;
    const on = !state.gate.built && state.agent.at === "door" && live.handAt !== null && (step === "enter" || step === "grab" || step === "load");
    if (!on) return setAttr(el.sneak, "style", "opacity:0");
    const [a, c, b] = [HAND_AT_DOOR, RAW_BEND, RACK_TOP];
    setAttr(el.sneak, "d", `M${f1(a[0])} ${f1(a[1])}Q${f1(c[0])} ${f1(c[1])} ${f1(b[0])} ${f1(b[1])}`);
    setAttr(el.sneak, "style", `opacity:${clamp01((t - live.handAt) / 0.6).toFixed(3)};stroke-dashoffset:${f1(-t * 30)}`);
  }

  /** Puts a flying envelope at a screen point with a scale and opacity. */
  function placeLetter(node, x, y, scale, op) {
    setAttr(node, "transform", `translate(${f1(x)} ${f1(y)}) scale(${scale.toFixed(3)})`);
    setAttr(node, "style", `opacity:${clamp01(op).toFixed(3)}`);
  }

  /**
   * The agent posts its request: once it stands at the door, its card flies as an envelope into the door's slot and the
   * agent waits empty-handed; the quote comes back out of the slot into its hands. Before the door is built (Story Act 1)
   * the envelope flies straight over to rack 0 instead, the raw API, and nothing comes back. Returns true while the card
   * is not in the agent's hands.
   */
  function drawLetter(state, t, snap, calm, ax, ay) {
    const ag = state.agent;
    const atDoor = ag.at === "door" && Math.abs(live.s - STATION.door) < 0.5 && Math.abs(live.v) < 3;
    if (ag.at === "door" && live.handKey !== ag.since) [live.handKey, live.handAt] = [ag.since, null];
    if (live.handAt === null && atDoor) live.handAt = snap ? Math.min(t, ag.since + 1.8) : t;
    if (ag.at !== "door" || live.handAt === null) {
      setAttr(el.letter, "style", "opacity:0");
      return false;
    }
    const hand = at([ax + 6, ay + 2, HAND_Z + 1]);
    if (!state.gate.built) {
      const u = (t - live.handAt) / 1.3;
      if (calm || u < 0 || u >= 1) setAttr(el.letter, "style", "opacity:0");
      else {
        const e = ease(u);
        const q = (i) => (1 - e) * (1 - e) * hand[i] + 2 * e * (1 - e) * RAW_BEND[i] + e * e * RACK_TOP[i];
        placeLetter(el.letter, q(0), q(1), 1 - 0.3 * e, u > 0.85 ? (1 - u) / 0.15 : 1);
      }
      return true;
    }
    const back = ag.carry === "quote" && state.quote ? Math.max(state.quote.at, live.handAt + 1.2) : Infinity;
    const slot = at(DOOR_SLOT);
    let flight = null;
    if (t - live.handAt < 0.9) flight = { u: (t - live.handAt) / 0.9, from: hand, to: slot };
    else if (t >= back && t < back + 0.7) flight = { u: (t - back) / 0.7, from: slot, to: hand };
    if (!flight || calm) setAttr(el.letter, "style", "opacity:0");
    else {
      const e = ease(flight.u);
      const lift = Math.sin(Math.PI * e) * 40;
      const intoSlot = flight.from === hand ? e : 1 - e;
      const { from, to } = flight;
      placeLetter(el.letter, from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e - lift, 1 - 0.35 * intoSlot, intoSlot > 0.9 ? (1 - intoSlot) / 0.1 : 1);
    }
    return t < back + 0.7;
  }

  /** Racks: an icon on the tag, a big label chip above, the alarm light and snapping lock on a closed shelf, the X on a crossed one. */
  function drawRacks(state, t, calm) {
    const naive = state.naive;
    const chips = pool(el.chips, racks.length, chipMarkup);
    racks.forEach((rackEl, i) => {
      const shelf = state.shelves[i];
      let status = shelf.status;
      let since = shelf.since ?? 0;
      let text = "";
      if (status === "ok") text = "Offer";
      if (status === "locked") text = "Closed";
      if (status === "limited") text = shelf.remaining !== null ? `${shelf.remaining} left` : "Limited";
      if (status === "crossed") text = shelf.code === "NEW_ALLERGEN" ? "Allergen" : "Rejected";
      if (shelf.more) text += ` +${shelf.more}`;
      if (i === 0 && ["grab", "load", "stuck"].includes(naive.step) && status === "idle") {
        status = naive.step === "stuck" || naive.step === "load" ? "locked" : "naive";
        since = naive.since;
        text = naive.step === "stuck" ? "Closed" : "999999?";
      }
      const iconName = { ok: "check", locked: "lock", limited: "warn", crossed: "cross", naive: "warn" }[status] ?? "";
      setAttr(rackEl, "data-status", status);
      setIcon(rackEl.querySelector(".tag-icon"), iconName, (RACK.w - 28) / 2 - 6.5, 1, 12);
      const age = t - since;
      const node = chips[i];
      if (status !== "naive" || !text) return setAttr(node, "style", "opacity:0");
      const [cx, cy] = at([RACK_X[i] + RACK.w / 2, RACK.y + RACK.d, RACK.h + 20]);
      taken.push(chip(node, { x: cx + 6, y: cy - 4, text, iconName, tone: status, size: 20, anchor: "start" }));
      setAttr(node, "style", `opacity:${(calm ? 1 : clamp01(age / 0.25)).toFixed(3)}`);
    });
  }

  /** Burst marks (✓ or ✕) collected each frame from the door and the dock, drawn from one pool. */
  const bursts = [];
  const flushBursts = (t, calm) => {
    const nodes = pool(el.bursts, 8, () => `<g class="burst" style="opacity:0"><circle class="burst-ring" r="20"/><g class="burst-icon"></g></g>`);
    nodes.forEach((node, i) => {
      const b = bursts[i];
      if (!b) return setAttr(node, "style", "opacity:0");
      const a = calm ? 0.4 : t - b.t0;
      const u = clamp01(a / 0.7);
      setAttr(node, "data-ok", b.ok ? "" : null);
      setAttr(node, "transform", `translate(${f1(b.x)} ${f1(b.y)})`);
      setAttr(node.querySelector(".burst-ring"), "r", f1(18 + 26 * easeOut(u)));
      setIcon(node.querySelector(".burst-icon"), b.ok ? "check" : "cross", -14, -14, 28);
      setAttr(node, "style", `opacity:${(calm ? 1 : a < 0.9 ? 1 : clamp01(1 - (a - 0.9) / 0.5)).toFixed(3)}`);
    });
    bursts.length = 0;
  };

  /** Door check: each quoted product flies from its shelf to the door's scanner; refused ones bounce off with a red mark and a reason at the door. */
  function drawDoor(state, t, calm) {
    const q = state.quote;
    const tokens = pool(el.doorfly, 6, () => `<g class="fly" style="opacity:0"></g>`);
    const chips = pool(el.doorchips, 4, chipMarkup);
    const items = [];
    if (q) {
      q.rejections.forEach((r) => items.push({ productId: String(r.productId), ok: false, code: r.code, remaining: r.remaining ?? r.limit ?? null }));
      const line = q.offers[0]?.lines?.[0];
      if (line) items.push({ productId: String(line.productId), ok: true });
    }
    const [dx, dy] = at(DOOR_POINT);
    const origin = at([0, 0, 0]);
    let refused = 0;
    tokens.forEach((node, i) => {
      const item = items[i];
      if (!item || calm) return setAttr(node, "style", "opacity:0");
      const rackIndex = Math.max(0, state.shelves.findIndex((s) => s.productId === item.productId));
      if (node.dataset.mat !== String(rackIndex)) {
        node.dataset.mat = String(rackIndex);
        node.innerHTML = flyingCrate(`crate${rackIndex}`);
      }
      const start = 0.2 + i * 0.45;
      const age = t - q.at - start;
      if (age < 0) return setAttr(node, "style", "opacity:0");
      const [fx, fy] = at([RACK_X[rackIndex] + RACK.w / 2, RACK.y + RACK.d + 4, 30]);
      let x;
      let y;
      let op = 1;
      if (age < 0.6) {
        const u = age / 0.6;
        x = fx + (dx - fx) * easeOut(u);
        y = fy + (dy - fy) * easeOut(u) - Math.sin(Math.PI * u) * 60;
      } else {
        const a = age - 0.6;
        x = dx + (item.ok ? 0 : 46 * a);
        y = dy + (item.ok ? 0 : -30 * a + 160 * a * a);
        op = clamp01(1 - a / (item.ok ? 0.3 : 0.7));
      }
      setAttr(node, "transform", `translate(${f1(x - origin[0])} ${f1(y - origin[1])})`);
      setAttr(node, "style", op < 1 ? `opacity:${op.toFixed(3)}` : null);
    });
    items.forEach((item, i) => {
      const arrive = q.at + 0.2 + i * 0.45 + 0.6;
      if (t >= arrive && t < arrive + 1.4) bursts.push({ x: dx, y: dy - 34, t0: arrive, ok: item.ok });
    });
    if (state.door.stamp === "REJECT" && q && state.door.since >= q.at && t - state.door.since < 1.4) bursts.push({ x: dx, y: dy - 34, t0: state.door.since, ok: false });
    const tr = state.truck;
    const shipped = q && tr.status !== "parked" && !tr.naive && tr.since >= q.at;
    const list = shipped ? [] : items.filter((it) => !it.ok).slice(0, chips.length).map((item) => {
      const text = item.code === "STOCK_LIMITED" ? (item.remaining !== null ? `Only ${item.remaining} left` : "Stock limited") : item.code === "CUTOFF_PASSED" ? "Cut-off passed" : reasonText(item.code);
      return { item, text, arrive: q.at + 0.2 + items.indexOf(item) * 0.45 + 0.6 };
    });
    const front = bodyBox(el["gate-front"]);
    const shelf = bodyBox(racks[0]);
    const width = Math.max(0, ...list.map((c) => chipSize(c.text, "cross", 20).width));
    const spot = list.length && front && shelf ? place("doorchips", width, list.length * 44 - 9, [[Math.max(front[2], LEAF_REACH) + 12, shelf[3] + 8]]) : null;
    chips.forEach((node, k) => {
      const c = list[k];
      if (!c || !spot || (t < c.arrive && !calm)) return setAttr(node, "style", "opacity:0");
      chip(node, { x: spot[0], y: spot[1] + 35 + refused * 44, text: c.text, iconName: "cross", tone: "reject", size: 20, anchor: "start" });
      setAttr(node, "style", `opacity:${(calm ? 1 : clamp01((t - c.arrive) / 0.25)).toFixed(3)}`);
      refused += 1;
    });
  }

  /** Dock gate: the naive agent's crates are refused here at the cut-off; a pending approval waits here; an expired one keeps it shut. */
  function drawDock(state, t, calm) {
    const tr = state.truck;
    const naive = state.naive;
    const tokens = pool(el.flying, 8, () => `<g class="fly" style="opacity:0">${flyingCrate("crate2")}</g>`);
    const origin = at([0, 0, 0]);
    let words = null;
    if (tr.naive && (naive.step === "load" || naive.step === "stuck")) {
      const loadAt = naive.step === "load" ? naive.since : tr.since - 4;
      const [fx, fy] = at([RACK_X[0] + RACK.w / 2, RACK.y + RACK.d + 4, 30]);
      const [sx, sy] = at([DOCK_X + 60, TRUCK_Y - 10, 34]);
      for (let i = 0; i < 3; i++) {
        const node = tokens[5 + i];
        if (node.dataset.mat !== "0") {
          node.dataset.mat = "0";
          node.innerHTML = flyingCrate("crate0");
        }
        const age = t - loadAt - i * 0.35;
        if (age < 0 || calm) {
          setAttr(node, "style", "opacity:0");
          continue;
        }
        let x = sx;
        let y = sy;
        let op = 1;
        if (age < 0.6) {
          const u = age / 0.6;
          x = fx + (sx - fx) * easeOut(u);
          y = fy + (sy - fy) * easeOut(u) - Math.sin(Math.PI * u) * 50;
        } else {
          const a = age - 0.6;
          x = sx - 36 * a;
          y = sy - 20 * a + 170 * a * a;
          op = clamp01(1 - a / 0.7);
        }
        setAttr(node, "transform", `translate(${f1(x - origin[0])} ${f1(y - origin[1])})`);
        setAttr(node, "style", op < 1 ? `opacity:${op.toFixed(3)}` : null);
        const hit = loadAt + i * 0.35 + 0.6;
        if (t >= hit && t < hit + 1.4) bursts.push({ x: sx, y: sy - 30, t0: hit, ok: false });
      }
      if (t > loadAt + 0.6) words = ["Cut-off Thu 12 Nov 15:00", "lock", "reject"];
    }
    else for (let i = 5; i < 8; i++) setAttr(tokens[i], "style", "opacity:0");
    const parked = truckRun(tr, t - tr.since).front === DOCK_X;
    if (!words && parked && state.phone.status === "buzzing") words = ["Waiting for approval", "clock", "hold"];
    if (!words && parked && state.phone.status === "expired") words = ["Approval expired", "clock", "reject"];
    if (!words) return setAttr(el.dockchip, "style", "opacity:0");
    const [px, py] = at([BARRIER.x, BARRIER.post, 0]);
    const { width, height } = chipSize(words[0], words[1], 20);
    const spot = place("dockchip", width, height, [[px - 24 - width, py + 4 - height], [px - 24 - width, py + 16]]);
    if (!spot) return setAttr(el.dockchip, "style", "opacity:0");
    chip(el.dockchip, { x: spot[0], y: spot[1] + height, text: words[0], iconName: words[1], tone: words[2], size: 20, anchor: "start" });
    setAttr(el.dockchip, "style", null);
  }

  /**
   * The door's decision: a shockwave at the gate beacon, and a card in the bottom-right corner where the stamp slams in
   * with its reasons. The card fades once the accepted truck leaves the dock (shippedAt), since the truck drives past it.
   */
  function drawStamp(stamp, reasons, since, phoneStatus, t, calm, shippedAt) {
    const group = el.stampfx;
    const fade = clamp01(1 - (t - shippedAt) / 0.3);
    if (!stamp || fade === 0) {
      setAttr(el.gateshock, "style", "opacity:0");
      return setAttr(group, "style", "opacity:0");
    }
    const meta = STAMP[stamp];
    const age = calm ? 9 : t - since;
    const [bx, by] = at([GATE_X, 11, 126]);
    setAttr(el.gateshock, "data-stamp", stamp);
    setAttr(el.gateshock, "transform", `translate(${f1(bx)} ${f1(by)})`);
    setAttr(el.gateshock, "style", null);
    el.gateshock.querySelectorAll(".stamp-shock").forEach((ring, j) => {
      const u = clamp01((age - j * 0.14) / 0.75);
      setAttr(ring, "r", f1(14 + 130 * easeOut(u)));
      setAttr(ring, "style", u > 0 && u < 1 ? `opacity:${(0.95 * (1 - u)).toFixed(3)}` : "opacity:0");
    });
    setAttr(group, "data-stamp", stamp);
    setAttr(group, "style", fade < 1 ? `opacity:${fade.toFixed(3)}` : null);
    const badge = group.querySelector(".badge-in");
    const scale = 1 + 0.9 * (1 - backOut(age / 0.26));
    setAttr(badge, "transform", scale !== 1 ? `scale(${scale.toFixed(3)})` : null);
    setIcon(group.querySelector(".stamp-icon"), meta.icon, -21, -21, 42);
    const words = reasons.map(reasonText);
    if (stamp === "NEEDS_APPROVAL" && phoneStatus === "approved") words.push("Approved on phone");
    const items = [{ text: meta.label, tone: meta.cls, size: 22, x: 94, y: 70 }];
    words.slice(0, 3).forEach((w, i) => {
      const approved = w === "Approved on phone";
      items.push({ text: w, tone: approved ? "auto" : "plain", size: 20, x: 18, y: 128 + i * 44, iconName: approved ? "check" : null });
    });
    const height = 100 + Math.min(3, words.length) * 44;
    setAttr(group.querySelector(".banner-box"), "height", height);
    setAttr(group, "transform", `translate(${W - 16 - 344} ${CARD_BOTTOM - height})`);
    taken.push([W - 16 - 344, CARD_BOTTOM - height, W - 16, CARD_BOTTOM]);
    const rows = pool(group.querySelector(".stamp-labels"), items.length, chipMarkup);
    rows.forEach((row, i) => {
      const item = items[i];
      if (!item) return setAttr(row, "style", "opacity:0");
      chip(row, { x: item.x, y: item.y, text: item.text, iconName: item.iconName ?? null, tone: item.tone, size: item.size, anchor: "start" });
      setAttr(row, "style", `opacity:${(calm ? 1 : clamp01((age - 0.15 - i * 0.12) / 0.2)).toFixed(3)}`);
    });
  }

  /** Phone: glowing screen with a state icon, pulse rings while waiting, and a big label chip with the amount. */
  function drawPhone(ph, t, calm) {
    setAttr(el.phone, "data-status", ph.status);
    const buzz = !calm && ph.status === "buzzing" && (t - ph.since) % 2.4 < 0.9 ? Math.sin(t * 90) * 1.3 : 0;
    setAttr(el.phone, "transform", buzz ? `translate(${buzz.toFixed(2)} 0)` : null);
    setIcon(el.phonei, { buzzing: "bell", approved: "check", rejected: "cross", expired: "clock" }[ph.status] ?? "", PHONE.w / 2 - 12, 16, 24);
    const rings = pool(el.rings, 3, () => svgNode("ellipse", "pulse-ring"));
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
    const words = {
      buzzing: [ph.cents !== null ? `Approve ${euro(ph.cents)}?` : "Approve?", "bell", "hold"],
      approved: [ph.cents !== null ? `Approved ${euro(ph.cents)}` : "Approved", "check", "auto"],
      rejected: ["Rejected", "cross", "reject"],
      expired: ["Expired at cut-off", "clock", "muted"],
    }[ph.status];
    if (!words) return setAttr(el.phonechip, "style", "opacity:0");
    const [px, py] = at([PHONE.x + PHONE.w, PHONE.y + PHONE.d, 0]);
    const { width, height } = chipSize(words[0], words[1]);
    const [screen] = KEEP_CLEAR;
    const spot = place("phonechip", width, height, [[screen[0] - 8 - width, screen[3] - height], [px - 8 - width, py + 18 - height], [px - 8 - width, py + 40]]);
    if (!spot) return setAttr(el.phonechip, "style", "opacity:0");
    chip(el.phonechip, { x: spot[0], y: spot[1] + height, text: words[0], iconName: words[1], tone: words[2], anchor: "start" });
    setAttr(el.phonechip, "style", null);
  }

  /** Wall clock hands from the door's clock; remembers today's weekday and date for the calendar. */
  function drawClock(now) {
    const date = now ? new Date(now) : null;
    if (!date || Number.isNaN(date.getTime())) return;
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Helsinki", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short", day: "numeric" }).formatToParts(date).map((p) => [p.type, p.value]));
    const [x, y, z, r] = CLOCK;
    const h = Number(parts.hour) % 12;
    const m = Number(parts.minute);
    const hand = (a, len) => k.pathOf([at([x, y + 0.5, z]), at([x + Math.sin(a) * len, y + 0.5, z + Math.cos(a) * len])]);
    setAttr(el.hands, "d", hand(((h + m / 60) / 12) * Math.PI * 2, r * 0.5) + hand((m / 60) * Math.PI * 2, r * 0.8));
    live.today = [parts.weekday.toUpperCase(), parts.day];
  }

  /** Truck run: crates fly in, confetti, barrier lifts, drive to the kitchen with exhaust and trail, unload, thumbs-up, drive back. */
  function drawTruck(state, t, dt, snap, calm) {
    const tr = state.truck;
    const age = t - tr.since;
    const run = truckRun(tr, age);
    setAttr(el.truck, "transform", k.translateAlong(P, [run.front, TRUCK_Y, 0]));

    const rear = run.front + T_LEN;
    live.boom = follow(live.boom, boomOpen(tr, age) ? 1 : 0, dt, 0.16, snap || calm);
    const a = live.boom * Math.PI * 0.5;
    const pivot = [BARRIER.x, BARRIER.post - 1, BARRIER.z];
    const tip = [BARRIER.x, pivot[1] - Math.cos(a) * BARRIER.len, pivot[2] + Math.sin(a) * BARRIER.len];
    const boom = k.pathOf([at(pivot), at(tip)]);
    setAttr(el.boom, "d", boom);
    setAttr(el["boom-stripes"], "d", boom);
    setAttr(el.blamp, "data-state", live.boom > 0.5 ? "open" : state.phone.status === "buzzing" ? "wait" : "closed");
    drawDock(state, t, calm);

    const flying = pool(el.flying, 8, () => `<g class="fly" style="opacity:0">${flyingCrate("crate2")}</g>`).slice(0, 5);
    const origin = at([0, 0, 0]);
    const okRack = racks.findIndex((r) => r.dataset.status === "ok");
    const source = okRack >= 0 ? okRack : 2;
    const from = at([RACK_X[source] + RACK.w / 2, RACK.y + RACK.d + 4, 36]);
    const slotAt = (i, front) => at([front + 46 + 6 + (i % 4) * 21.5 + 9, TRUCK_Y + 19, 17 + Math.floor(i / 4) * 16 + 7]);
    const n = Math.min(run.n, 8);
    const flights = [];
    if (run.accepted) for (let i = 0; i < n; i++) flights.push({ start: i * 0.22, dur: 0.45, a: from, b: slotAt(i, DOCK_X), fadeEnd: false });
    if (run.accepted) for (let i = 0; i < n; i++) flights.push({ start: run.arrive + i * 0.16, dur: 0.42, a: slotAt(i, BAY_X), b: at([SLOTS[i % SLOTS.length], -95, 48]), fadeEnd: i >= SLOTS.length });
    flying.forEach((node, i) => {
      const f = flights.find((fl, j) => j % 5 === i && age >= fl.start && age < fl.start + fl.dur) ?? null;
      if (!f || calm) return setAttr(node, "style", "opacity:0");
      const u = (age - f.start) / f.dur;
      const e = easeOut(u);
      const x = f.a[0] + (f.b[0] - f.a[0]) * e - origin[0];
      const y = f.a[1] + (f.b[1] - f.a[1]) * e - Math.sin(Math.PI * u) * 56 * KS - origin[1];
      setAttr(node, "transform", `translate(${f1(x)} ${f1(y)})`);
      setAttr(node, "style", `opacity:${(f.fadeEnd ? 1 - clamp01((u - 0.75) / 0.25) : 1).toFixed(3)}`);
    });
    truckCrates.forEach((node, i) => {
      const on = run.accepted && i < n && age >= i * 0.22 + 0.45 && age < run.arrive + i * 0.16;
      setAttr(node, "style", on ? null : "opacity:0");
    });
    counterCrates.forEach((node, i) => {
      const on = run.accepted && i < Math.min(n, SLOTS.length) && age >= run.arrive + i * 0.16 + 0.42;
      setAttr(node, "style", on ? null : "opacity:0");
    });
    live.happy = run.accepted && age >= run.unloadDone - 0.2 && age < run.unloadDone + 3.4;
    const delivered = run.accepted && age >= run.arrive;
    const [day, date] = delivered ? ["MON", "16"] : live.today;
    setText(el.caldate, date);
    setText(el.calday, day);
    setAttr(el.caldate, "data-flip", delivered ? "" : null);
    if (run.accepted && age >= run.unloadDone - 0.2 && age < run.home + 1.5) {
      setAttr(el.receipt, "transform", `translate(40 ${CARD_BOTTOM - 90})`);
      taken.push([40, CARD_BOTTOM - 90, 256, CARD_BOTTOM - 10]);
      setText(el.receipt.querySelector(".receipt-amount"), state.receipt?.netCents != null ? euro(state.receipt.netCents) : "Delivered");
      setAttr(el.receipt, "style", `opacity:${(calm ? 1 : clamp01((age - run.unloadDone + 0.2) / 0.3)).toFixed(3)}`);
    } else setAttr(el.receipt, "style", "opacity:0");

    drawConfetti(tr, age, calm);
    drawExhaust(tr, run, age, calm);
    const trail = pool(el.trail, 3, () => svgNode("path", "trail-line"));
    trail.forEach((line, j) => {
      const speed = Math.abs(run.v);
      if (calm || speed < 12) return setAttr(line, "style", "opacity:0");
      const z = 22 + j * 16;
      const tail = run.v < 0 ? rear + 4 : run.front - 4;
      const len = Math.min(110, speed * 0.6) * -Math.sign(run.v);
      setAttr(line, "d", k.pathOf([at([tail, TRUCK_Y + 36, z]), at([tail + len, TRUCK_Y + 36, z])]));
      setAttr(line, "style", `opacity:${(Math.min(1, speed / 120) * 0.85).toFixed(3)}`);
    });
  }

  /** A short confetti burst from the truck when an order is accepted. */
  function drawConfetti(tr, age, calm) {
    const pieces = pool(el.confetti, CONFETTI.length, () => svgNode("rect", "confetti"));
    const on = !calm && tr.status === "loading" && !tr.naive && age < 2.2;
    const [ox, oy] = at([DOCK_X + 90, TRUCK_Y + 19, 80]);
    pieces.forEach((node, i) => {
      if (!on) return setAttr(node, "style", "opacity:0");
      const p = CONFETTI[i];
      const a = Math.max(0, age - (i % 4) * 0.05);
      const flip = Math.cos(a * p.spin);
      setAttr(node, "data-hue", p.hue);
      setAttr(node, "width", f1(p.w));
      setAttr(node, "height", f1(Math.max(0.8, Math.abs(flip) * 6.5)));
      setAttr(node, "transform", `translate(${f1(ox + p.vx * a)} ${f1(oy + p.vy * a + 280 * a * a)}) rotate(${f1(a * p.spin * 40)})`);
      setAttr(node, "style", `opacity:${clamp01((2.2 - age) / 0.6).toFixed(3)}`);
    });
  }

  /** Exhaust puffs from the stack while the truck drives. */
  function drawExhaust(tr, run, age, calm) {
    const puffs = pool(el.exhaust, 16, () => svgNode("circle", "puff"));
    const moving = Math.abs(run.v) > 1;
    const stuck = false;
    const every = 0.11;
    const life = 1.1;
    puffs.forEach((node, j) => {
      if (calm || !(moving || stuck)) return setAttr(node, "style", "opacity:0");
      const born = (Math.floor(age / every) - j) * every;
      const a = age - born;
      if (born < 0 || a > life) return setAttr(node, "style", "opacity:0");
      const then = truckRun(tr, born).front;
      const [px, py] = at([then + 40, TRUCK_Y + 33, 66]);
      setAttr(node, "data-dark", stuck ? "" : null);
      setAttr(node, "cx", f1(px + (run.v < 0 ? 14 : -14) * a));
      setAttr(node, "cy", f1(py - 34 * a));
      setAttr(node, "r", f1((3.5 + 11 * a) * KS * 0.7));
      setAttr(node, "style", `opacity:${(0.65 * (1 - a / life)).toFixed(3)}`);
    });
  }

  /** What the chef is typing into the kitchen terminal: the request appears letter by letter above the terminal. */
  function drawTyped(state, t, calm) {
    let source = null;
    if (state.say) source = { text: state.say.text, since: state.say.since };
    else if (state.draft && state.agent.at === "chef" && (state.agent.carry === "draft" || state.agent.carry === "question") && t - state.agent.since < 5) source = { text: state.draft.text, since: state.agent.since };
    if (!source) {
      setAttr(el.bubble, "style", "opacity:0");
      return { typing: false };
    }
    const full = wrap(source.text, 20);
    const shown = calm ? source.text.length : Math.floor((t - source.since) * 18);
    let left = shown;
    const lines = full.map((line) => {
      const part = line.slice(0, Math.max(0, left));
      left -= line.length + 1;
      return part;
    });
    const size = 21;
    const lineH = size * 1.3;
    const width = Math.max(...full.map((l) => l.length + 1)) * size * 0.62 + 40;
    const height = full.length * lineH + 26;
    const [tx, ty] = at([PHONE.x + PHONE.w / 2, PHONE.y + PHONE.d, PHONE.z + PHONE.h + 6]);
    const x = Math.max(14, tx + 26 - width);
    const y = ty - height - 22;
    taken.push([x, y, x + width, ty]);
    const rr = 12;
    const tipX = Math.min(Math.max(tx, x + 30), x + width - 30);
    const d = `M${f1(x + rr)} ${f1(y)}H${f1(x + width - rr)}Q${f1(x + width)} ${f1(y)} ${f1(x + width)} ${f1(y + rr)}V${f1(y + height - rr)}Q${f1(x + width)} ${f1(y + height)} ${f1(x + width - rr)} ${f1(y + height)}H${f1(tipX + 12)}L${f1(tx)} ${f1(ty - 4)}L${f1(tipX - 12)} ${f1(y + height)}H${f1(x + rr)}Q${f1(x)} ${f1(y + height)} ${f1(x)} ${f1(y + height - rr)}V${f1(y + rr)}Q${f1(x)} ${f1(y)} ${f1(x + rr)} ${f1(y)}Z`;
    el.bubble.querySelector(".typed-box").setAttribute("d", d);
    const txt = el.bubble.querySelector(".typed-text");
    while (txt.children.length < full.length) txt.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "tspan"));
    [...txt.children].forEach((span, i) => {
      const caret = !calm && i === lines.findLastIndex((l) => l.length > 0) && shown < source.text.length + 12 && Math.floor(t * 3) % 2 === 0 ? "▍" : "";
      setText(span, (lines[i] ?? "") + caret);
      setAttr(span, "x", f1(x + 20));
      setAttr(span, "y", f1(y + 13 + size + i * lineH - 4));
    });
    setAttr(txt, "font-size", size);
    setAttr(el.bubble, "style", `opacity:${Math.min(1, (t - source.since) / 0.3).toFixed(3)}`);
    return { typing: shown < source.text.length + 8 };
  }

  /** The chef acts: types at the terminal, looks at it when an approval waits, taps to approve, cheers at delivery, frowns at an empty counter. */
  function drawChef(state, t, typed, calm) {
    const ph = state.phone;
    const tapping = ph.status === "approved" && t - ph.since < 1;
    const looking = ph.status === "buzzing" || tapping;
    const sad = (state.naive.step === "load" && t - state.naive.since > 0.7) || state.naive.step === "stuck" || ph.status === "expired";
    const typing = typed.typing || tapping;
    const happy = live.happy;
    const shrug = sad && !happy && !typing;
    setAttr(armLeft, "style", typing || shrug ? "opacity:0" : null);
    setAttr(armType, "style", typing ? null : "opacity:0");
    setAttr(typingHand, "transform", typing && !calm ? `translate(0 ${f1(-Math.abs(Math.sin(t * 16)) * 2.4)})` : null);
    armsDown.filter((node) => node !== armLeft).forEach((node) => setAttr(node, "style", happy || shrug ? "opacity:0" : null));
    setAttr(armsUp, "style", happy ? null : "opacity:0");
    setAttr(armsShrug, "style", shrug ? null : "opacity:0");
    const [ex, ey] = looking || typing ? [-2.2, 0.6] : sad ? [0, 1.4] : [0, 0];
    setAttr(eyes, "transform", ex || ey ? `translate(${f1(ex * KS)} ${f1(ey * KS)})` : null);
    setAttr(smile, "style", happy ? null : "opacity:0");
    setAttr(frown, "style", sad && !happy ? null : "opacity:0");
    setAttr(el.phone, "data-typing", typed.typing && ph.status === "idle" ? "" : null);
  }

  /** The agent's card content as a label next to it: over its head, else under its feet or beside it, never over the cast, the door or other text. */
  function drawLabel(state, ax, ay, body) {
    const lines = cardLines(state);
    if (!lines.length || !body) return setAttr(el.label, "style", "opacity:0");
    const head = at([ax, ay, HAND_Z + 7]);
    const size = 21;
    const width = Math.max(...lines.map((l) => l.length)) * size * 0.56 + 32;
    const height = lines.length * size * 1.3 + 18;
    const [hx, above, below, mid] = [head[0], head[1] - height - 8, body[3] + 16, (body[1] + body[3]) / 2 - height / 2];
    const spot = place("label", width, height, [
      [hx - width / 2, above], [hx - width / 2, below],
      [hx - 24, above], [hx + 24 - width, above], [hx - 24, below], [hx + 24 - width, below],
      [body[2] + 8, mid], [body[0] - 8 - width, mid],
    ]);
    if (!spot) return setAttr(el.label, "style", "opacity:0");
    const [left, top] = spot;
    const box = el.label.querySelector(".label-box");
    box.setAttribute("x", f1(left));
    box.setAttribute("y", f1(top));
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
      span.setAttribute("x", f1(left + width / 2));
      span.setAttribute("y", f1(top + 9 + size + i * size * 1.3 - 3));
    });
    setAttr(el.label, "style", null);
  }

  /** Sky follows the clock: petrol night, a warming horizon toward the cut-off, red after an expiry. Lamps rise with it. */
  function drawSky(state, dt, snap) {
    const left = state.now ? (Date.parse("2026-11-15T17:00:00+02:00") - Date.parse(state.now)) / 3.6e6 : 31;
    const warm = Math.pow(clamp01((30.75 - left) / 30.75), 1.2);
    live.warm = follow(live.warm, warm, dt, 0.9, snap);
    live.red = follow(live.red, state.phone.status === "expired" ? 1 : 0, dt, 0.9, snap);
    const sky = mix3(mix3(SKY.night, SKY.warm, live.warm), SKY.red, live.red);
    const vars = { "--sky-top": rgb(sky[0]), "--sky-mid": rgb(sky[1]), "--sky-bottom": rgb(sky[2]) };
    for (const [name, value] of Object.entries(vars)) if (stage.style.getPropertyValue(name) !== value) stage.style.setProperty(name, value);
    const lampLevel = 0.9 + 0.5 * live.warm;
    if (layer && Math.abs(lampLevel - live.lampDrawn) > 0.004) {
      layer.draw({ uLamp: lampLevel }, 0);
      live.lampDrawn = lampLevel;
    }
    stage.toggleAttribute("data-gl", !!layer);
  }

  return { draw, svg: root };
}

/** Words on the agent's card for what it is carrying. */
function cardLines(state) {
  const { carry } = state.agent;
  const d = state.draft;
  const q = state.quote;
  const claim = (c) => String(c).replace(/^FREE_FROM_/, "").toLowerCase().replace(/_/g, " ") + "-free";
  if (carry === "question") return [`Needs: ${(d?.unclear ?? []).join(", ")}`];
  if (carry === "draft" && d) {
    const qty = d.quantity ? `${Number(d.quantity.value).toLocaleString("en-US")} ${d.quantity.unit}` : "? qty";
    return [`Draft: ${qty}`, (d.claims ?? []).map(claim).join(", ")].filter(Boolean);
  }
  if (carry === "quote" && q) {
    const best = q.offers[0];
    return [best ? `Quote: ${euro(best.netCents)}` : "Quote: no offer", `${q.rejections.length} rejected`];
  }
  if (carry === "rejected") return [`Rejected: ${reasonText(state.door.reasons[0] ?? (state.phone.status === "rejected" ? "by manager" : ""))}`];
  if (carry === "receipt") return ["Accepted", state.receipt?.netCents != null ? euro(state.receipt.netCents) : ""].filter(Boolean);
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
