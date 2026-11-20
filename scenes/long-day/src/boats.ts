// The boat models every small boat in Long Day is drawn with: boats moored along a river town's
// quays (city.ts buildBoats), the upturned rowboat by a bait shack (city.ts), and boats carried
// as cargo (cargomodels.ts: the sailboat on its trailer, canoes and kayaks, the jet ski). Use
// these rather than building boats in place. (The car ferry is its own vessel: countryworld.ts.)
//
// A boat is x forward, its origin on the waterline at its middle. The hull is lofted through
// stations along its length, each a cross-section from the deck edge down the topsides to the
// chine and in to the keel, its stem and transom raked; flat-shaded, with a rubbing strake under
// the deck edge and a painted stripe. On it, cabins, glass, rails and rigging. The accent (a
// stripe, canvas, cushions, a narrowboat's cabin) is pure white unless given, so Batch.stamp can
// paint it; everything else keeps its colour.
import { Batch, BATCH } from "./geom.ts";
import { GLASS } from "./cars.ts";
import type { BatchModel } from "./geom.ts";

export type BoatKind = "cruiser" | "narrowboat" | "sailboat" | "rowboat" | "canoe" | "kayak" | "jetski";
export const BOAT_PAINTS = [0x1f3f6a, 0x8a2a22, 0x2f5a3a, 0x2a6fa8, 0xc8961e, 0x5a2a4a];

const ACCENT = 0xffffff, OFF_WHITE = 0xf1f0ea, DECK_GREY = 0xd8d5ca, STEEL = 0xbfc4c9;
const RUB = 0x2b2d31, ANTIFOUL = 0x7a2a22, BLACK = 0x1c1d20, TEAK = 0xa8784a, WOOD = 0xc0915c, CREAM = 0xe8dcb0, BRASS = 0xc9a24a;

// A hull station: at x, the deck edge (wd, yd), the chine (wc, yc) and the keel (wk, yk), as
// half-widths and heights above the waterline. `rake`: how far forward the deck edge stands of
// the keel (a raked stem; negative, a transom leaning aft).
export interface Station { x: number; wd: number; yd: number; wc: number; yc: number; wk: number; yk: number; rake?: number }
// How a hull is painted: topsides, the stripe (between heights s0 and s1), the strake under the
// deck edge, the bottom, the deck. `open`: an open boat, its floor this far below the gunwale,
// its inside `inside`. `wl`: the waterline's height (0 unless the origin is elsewhere: the car
// ferry's is its car deck).
export interface HullLook { top: number; stripe: number; s0: number; s1: number; rail: number; bottom: number; deck: number; open?: number; inside?: number; wl?: number }

type P2 = [number, number];
function quad(b: Batch, p: number[], q: number[], r: number[], s: number[], color: number, face: [number, number, number]) {
  b.tri(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2], color, face);
  b.tri(p[0], p[1], p[2], r[0], r[1], r[2], s[0], s[1], s[2], color, face);
}
// A station's side, deck edge down to the keel (z, y): the deck edge, the strake's foot, the
// stripe's top and foot and the waterline (on the line from the strake to the chine), the chine,
// the keel.
function section(s: Station, L: HullLook): P2[] {
  const yr = s.yd - 0.06, along = (y: number) => s.wd + (s.wc - s.wd) * Math.max(0, Math.min(1, (yr - y) / Math.max(1e-6, yr - s.yc)));
  const y1 = Math.max(s.yc, Math.min(yr, L.s1)), y0 = Math.max(s.yc, Math.min(y1, L.s0)), yw = Math.max(s.yc, Math.min(y0, L.wl ?? 0));
  return [[s.wd, s.yd], [s.wd, yr], [along(y1), y1], [along(y0), y0], [along(yw), yw], [s.wc, s.yc], [s.wk, s.yk]];
}
const raked = (s: Station, y: number) => s.x + (s.rake ?? 0) * (y - s.yk) / Math.max(1e-6, s.yd - s.yk);
// A hull's deck edge at x: its half-width and height, between the stations' deck edges (raked
// out past their keels at the ends). Past either end, no width, at that end's height.
function atDeck(st: Station[], x: number) {
  for (let i = 0; i + 1 < st.length; i++) {
    const xa = raked(st[i], st[i].yd), xc = raked(st[i + 1], st[i + 1].yd);
    if (x >= xa && x <= xc) { const t = (x - xa) / (xc - xa); return { w: st[i].wd + (st[i + 1].wd - st[i].wd) * t, y: st[i].yd + (st[i + 1].yd - st[i].yd) * t }; }
  }
  return { w: 0, y: (x < raked(st[0], st[0].yd) ? st[0] : st[st.length - 1]).yd };
}
export const deckW = (st: Station[], x: number) => atDeck(st, x).w;

export function hull(b: Batch, st: Station[], L: HullLook) {
  const bands = [L.rail, L.top, L.stripe, L.top, L.bottom, L.bottom];
  for (let i = 0; i + 1 < st.length; i++) {
    const A = st[i], C = st[i + 1], a = section(A, L), c = section(C, L), cy = (A.yd + A.yk + C.yd + C.yk) / 4;
    for (const side of [1, -1]) {
      for (let k = 0; k < 6; k++) {
        const p = a[k], q = a[k + 1], u = c[k], v = c[k + 1], color = bands[k];
        const my = (p[1] + q[1] + u[1] + v[1]) / 4, mz = (p[0] + q[0] + u[0] + v[0]) / 4;
        quad(b, [raked(A, p[1]), p[1], side * p[0]], [raked(A, q[1]), q[1], side * q[0]], [raked(C, v[1]), v[1], side * v[0]], [raked(C, u[1]), u[1], side * u[0]], color,
          [0, (my - cy) * 0.6, side * Math.max(0.05, mz)]);
      }
    }
    // The flat of the keel, and the deck (or, open, the floor and the inside of the topsides).
    quad(b, [raked(A, A.yk), A.yk, A.wk], [raked(A, A.yk), A.yk, -A.wk], [raked(C, C.yk), C.yk, -C.wk], [raked(C, C.yk), C.yk, C.wk], L.bottom, [0, -1, 0]);
    if (L.open === undefined) {
      quad(b, [raked(A, A.yd), A.yd, A.wd], [raked(A, A.yd), A.yd, -A.wd], [raked(C, C.yd), C.yd, -C.wd], [raked(C, C.yd), C.yd, C.wd], L.deck, [0, 1, 0]);
    } else {
      const fa = A.yd - L.open, fc = C.yd - L.open, ia = Math.max(0, A.wd - 0.05), ic = Math.max(0, C.wd - 0.05), fa2 = Math.max(0, A.wc - 0.05), fc2 = Math.max(0, C.wc - 0.05);
      quad(b, [raked(A, fa), fa, fa2], [raked(A, fa), fa, -fa2], [raked(C, fc), fc, -fc2], [raked(C, fc), fc, fc2], L.inside!, [0, 1, 0]);
      for (const side of [1, -1]) {
        quad(b, [raked(A, A.yd), A.yd, side * ia], [raked(C, C.yd), C.yd, side * ic], [raked(C, fc), fc, side * fc2], [raked(A, fa), fa, side * fa2], L.inside!, [0, 0, -side]);
        quad(b, [raked(A, A.yd), A.yd, side * A.wd], [raked(C, C.yd), C.yd, side * C.wd], [raked(C, C.yd), C.yd, side * ic], [raked(A, A.yd), A.yd, side * ia], L.rail, [0, 1, 0]);   // the gunwale
      }
    }
  }
  // The transom and (where it has width) the stem's face: across each end's section band by
  // band, so the strake, the stripe and the bottom paint run on round it.
  for (const [s, dir] of [[st[0], -1], [st[st.length - 1], 1]] as const) {
    if (s.wd < 0.02) continue;
    const sec = section(s, L);
    for (let k = 0; k + 1 < sec.length; k++) {
      const p = sec[k], q = sec[k + 1];
      quad(b, [raked(s, p[1]), p[1], p[0]], [raked(s, q[1]), q[1], q[0]], [raked(s, q[1]), q[1], -q[0]], [raked(s, p[1]), p[1], -p[0]], bands[k], [dir, 0, 0]);
    }
  }
}

// A thin rod from p to q (x, y, z), `t` thick.
export function rod(b: Batch, p: number[], q: number[], t: number, color: number) {
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], h = Math.hypot(dx, dz), len = Math.hypot(h, dy);
  b.boxR((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, len, t, t, color, 0, Math.atan2(-dz, dx), Math.atan2(dy, h));
}
// A wedge: a cabin's raked front, from its foot at xf up to its top at xb (back, against the
// cabin), y0..y1, w wide; its slope `slope`, its sides `side`.
export function wedge(b: Batch, xb: number, xf: number, y0: number, y1: number, w: number, slope: number, side: number) {
  const h = w / 2, dir = Math.sign(xf - xb);
  quad(b, [xf, y0, h], [xf, y0, -h], [xb, y1, -h], [xb, y1, h], slope, [dir, 1, 0]);
  for (const z of [h, -h]) b.tri(xb, y0, z, xf, y0, z, xb, y1, z, side, [0, 0, Math.sign(z)]);
}
// Stanchions and a rail along each side, 7 cm inside the deck edge and `h` up, from x0 to x1 in
// `n` bays.
function rails(b: Batch, st: Station[], x0: number, x1: number, h: number, n: number, color: number) {
  for (const side of [1, -1]) {
    let prev: number[] | null = null;
    for (let i = 0; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, d = atDeck(st, x), z = side * Math.max(0.05, d.w - 0.07), y = d.y;
      b.box(x, y + h / 2, z, 0.035, h, 0.035, color);
      const top = [x, y + h, z];
      if (prev) rod(b, prev, top, 0.03, color);
      prev = top;
    }
  }
}
const fender = (b: Batch, x: number, z: number, y: number) => { b.cyl(x, y, z, 0.11, 0.42, 0x2a5fb0, 8); b.cyl(x, y + 0.24, z, 0.03, 0.08, OFF_WHITE, 5); };

// ---- the boats --------------------------------------------------------------------------------

// A motor cruiser, about 9 m: a white hull with a stripe, a saloon with a raked windscreen and a
// hardtop over the cockpit, a rail round the foredeck, fenders out.
function cruiser(b: Batch) {
  const st: Station[] = [
    { x: -4.2, wd: 1.30, yd: 0.90, wc: 1.25, yc: -0.10, wk: 0.12, yk: -0.45, rake: -0.15 },
    { x: -2.5, wd: 1.42, yd: 0.92, wc: 1.36, yc: -0.15, wk: 0.14, yk: -0.55 },
    { x: 0.0, wd: 1.45, yd: 0.97, wc: 1.30, yc: -0.15, wk: 0.14, yk: -0.60 },
    { x: 2.0, wd: 1.30, yd: 1.05, wc: 0.95, yc: -0.05, wk: 0.10, yk: -0.55 },
    { x: 3.4, wd: 0.85, yd: 1.15, wc: 0.45, yc: 0.15, wk: 0.06, yk: -0.40 },
    { x: 4.2, wd: 0.0, yd: 1.25, wc: 0.0, yc: 0.50, wk: 0.0, yk: 0.05, rake: 0.55 },
  ];
  hull(b, st, { top: OFF_WHITE, stripe: ACCENT, s0: 0.5, s1: 0.68, rail: STEEL, bottom: ANTIFOUL, deck: DECK_GREY });
  const y = 0.96;
  b.box(-0.15, y + 0.5, 0, 2.9, 1.0, 2.2, OFF_WHITE);                                   // saloon
  wedge(b, 1.3, 2.1, y, y + 1.0, 2.2, GLASS, OFF_WHITE);                              // its raked windscreen
  b.box(1.75, y + 0.2, 0, 0.75, 0.4, 2.21, OFF_WHITE);                                  // (white under the glass)
  for (const z of [1.106, -1.106]) b.box(-0.1, y + 0.63, z, 2.5, 0.3, 0.02, GLASS);     // side windows
  b.box(-0.6, y + 1.04, 0, 4.2, 0.08, 2.35, OFF_WHITE);                                  // hardtop, out over the cockpit
  for (const z of [1.08, -1.08]) b.box(-2.55, y + 0.52, z, 0.07, 1.0, 0.07, STEEL);      // its posts
  b.box(0.1, y + 1.16, 0, 0.5, 0.16, 0.5, OFF_WHITE);                                    // radar
  b.cyl(-0.4, y + 1.45, 0, 0.03, 0.75, STEEL, 5); b.box(-0.4, y + 1.84, 0, 0.06, 0.06, 0.06, 0xfff4d0);   // mast and its light
  // Cockpit: a bench round its sides with cushions, a step down to the swim platform.
  b.box(-3.8, y + 0.2, 0, 0.5, 0.4, 2.2, OFF_WHITE); b.box(-3.8, y + 0.42, 0, 0.5, 0.06, 2.1, ACCENT);
  for (const z of [0.9, -0.9]) { b.box(-3.0, y + 0.2, z, 1.2, 0.4, 0.4, OFF_WHITE); b.box(-3.0, y + 0.42, z, 1.2, 0.06, 0.38, ACCENT); }
  b.box(-4.55, 0.32, 0, 0.55, 0.08, 2.3, TEAK);
  b.cyl(-4.25, y + 0.55, 0.9, 0.02, 1.1, STEEL, 4); b.box(-4.25, y + 0.95, 0.68, 0.02, 0.26, 0.42, 0x1f3f8a);   // ensign
  rails(b, st, 1.4, 4.0, 0.55, 3, STEEL);
  for (const x of [-2.2, -0.2, 1.6]) for (const z of [1, -1]) fender(b, x, z * (deckW(st, x) + 0.12), 0.5);
}

// A narrowboat, 15 m and narrow: a black steel hull, a long cabin in its colour with a cream
// coachline, windows and a name panel, a grey roof with its pole, plank, chimney and a pot plant,
// the tiller at the stern and a canvas cratch over the well deck at the bow.
function narrowboat(b: Batch) {
  const st: Station[] = [
    { x: -7.5, wd: 0.70, yd: 0.62, wc: 0.55, yc: 0.10, wk: 0.35, yk: -0.10, rake: -0.35 },
    { x: -6.8, wd: 1.02, yd: 0.56, wc: 1.02, yc: -0.35, wk: 0.95, yk: -0.50 },
    { x: 5.5, wd: 1.04, yd: 0.55, wc: 1.04, yc: -0.35, wk: 0.95, yk: -0.50 },
    { x: 6.8, wd: 0.62, yd: 0.62, wc: 0.55, yc: -0.35, wk: 0.45, yk: -0.50 },
    { x: 7.4, wd: 0.0, yd: 0.72, wc: 0.0, yc: -0.30, wk: 0.0, yk: -0.50, rake: 0.12 },
  ];
  hull(b, st, { top: BLACK, stripe: BLACK, s0: 0, s1: 0, rail: 0xb03a2e, bottom: BLACK, deck: 0x3a3a3a });
  const y = 0.55, x0 = -5.6, x1 = 4.9, cx = (x0 + x1) / 2, len = x1 - x0;
  b.box(cx, y + 0.6, 0, len, 1.2, 1.86, ACCENT);                                         // the cabin
  b.box(cx, y + 1.23, 0, len + 0.06, 0.07, 1.92, 0x8f8b80);                              // its roof
  for (const z of [1, -1]) {
    b.box(cx, y + 1.06, z * 0.935, len, 0.05, 0.02, CREAM); b.box(cx, y + 0.12, z * 0.935, len, 0.05, 0.02, CREAM);   // coachlines
    b.box(cx, y + 1.31, z * 0.86, len - 0.4, 0.05, 0.05, BRASS);                          // handrail
    b.box(-0.35, y + 0.6, z * 0.94, 2.0, 0.5, 0.02, CREAM); b.box(-0.35, y + 0.6, z * 0.95, 1.8, 0.36, 0.01, 0x7a2a22);   // name panel
    for (const x of [-4.5, -3.2, -1.9, 1.2, 2.5, 3.8]) { b.box(x, y + 0.72, z * 0.935, 0.62, 0.44, 0.02, CREAM); b.box(x, y + 0.72, z * 0.945, 0.52, 0.34, 0.02, GLASS); }
  }
  for (const x of [x0 - 0.01, x1 + 0.01]) b.box(x, y + 0.55, 0, 0.02, 0.95, 0.8, 0x6b2a22);   // doors at each end
  b.cyl(3.9, y + 1.55, 0, 0.09, 0.6, BLACK, 8); b.cyl(3.9, y + 1.83, 0, 0.1, 0.06, BRASS, 8);   // chimney
  b.box(-1.5, y + 1.3, -0.55, 5.5, 0.04, 0.22, TEAK); b.cyl(-1.0, y + 1.29, 0.5, 0.03, 4.5, 0x7a5232, 5, 0, Math.PI / 2);   // plank and pole
  b.box(1.8, y + 1.33, 0.3, 0.3, 0.14, 0.3, 0xb5643a); b.ico(1.8, y + 1.52, 0.3, 0.24, 0x3f8a3a);   // a pot plant
  b.prism(5.75, y + 0.4, 0, 1.7, 0.8, 1.75, 0x2f4f3a);                                    // the cratch
  b.cyl(-7.35, y + 0.45, 0, 0.04, 0.9, BLACK, 5); rod(b, [-7.35, y + 0.9, 0], [-6.4, y + 1.05, 0], 0.05, BRASS);   // the tiller
  b.cyl(7.6, 0.35, 0, 0.16, 0.3, 0x8a7a5a, 8);                                            // rope fender on the stem
}

// A sailing yacht, about 8 m: a white hull with a stripe, a cabin trunk with ports, a cockpit with
// its wheel, the mast with shrouds and stays, the mainsail furled on its boom under a cover,
// lifelines round the deck. `mastDown`: on a trailer, the mast lowered along the deck.
function sailboat(b: Batch, mastDown: boolean) {
  const st: Station[] = [
    { x: -3.9, wd: 1.05, yd: 0.80, wc: 1.00, yc: 0.05, wk: 0.10, yk: -0.35, rake: -0.30 },
    { x: -2.0, wd: 1.25, yd: 0.82, wc: 1.18, yc: -0.10, wk: 0.12, yk: -0.45 },
    { x: 0.5, wd: 1.30, yd: 0.88, wc: 1.15, yc: -0.15, wk: 0.12, yk: -0.50 },
    { x: 2.4, wd: 1.00, yd: 0.97, wc: 0.70, yc: -0.05, wk: 0.08, yk: -0.45 },
    { x: 3.5, wd: 0.45, yd: 1.05, wc: 0.25, yc: 0.15, wk: 0.04, yk: -0.25 },
    { x: 4.0, wd: 0.0, yd: 1.10, wc: 0.0, yc: 0.45, wk: 0.0, yk: 0.05, rake: 0.40 },
  ];
  hull(b, st, { top: OFF_WHITE, stripe: ACCENT, s0: 0.42, s1: 0.56, rail: OFF_WHITE, bottom: ANTIFOUL, deck: DECK_GREY });
  const y = 0.86;
  b.box(0.2, y + 0.2, 0, 2.8, 0.4, 1.7, OFF_WHITE);                                       // cabin trunk
  wedge(b, 1.6, 2.2, y, y + 0.4, 1.7, OFF_WHITE, OFF_WHITE);
  b.box(-1.15, y + 0.42, 0, 0.5, 0.06, 0.6, TEAK);                                         // hatch
  for (const z of [0.851, -0.851]) for (const x of [-0.6, 0.3, 1.1]) b.box(x, y + 0.24, z, 0.45, 0.12, 0.02, GLASS);
  for (const z of [0.95, -0.95]) b.box(-2.4, y + 0.14, z, 2.3, 0.28, 0.06, OFF_WHITE);     // cockpit coamings
  b.cyl(-3.0, y + 0.55, 0, 0.36, 0.04, STEEL, 12, 0, Math.PI / 2); b.box(-3.0, y + 0.25, 0, 0.06, 0.5, 0.06, STEEL);   // wheel
  rails(b, st, -3.6, 3.4, 0.6, 5, STEEL);
  const steel = 0xc8ccd0, mx = 0.9;
  if (mastDown) {
    // (Lowered for the road: along the deck on a crutch at the stern and the pulpit at the bow.)
    b.box(-3.6, y + 0.5, 0, 0.08, 0.9, 0.08, steel);
    rod(b, [4.6, y + 0.75, 0], [-4.4, y + 0.95, 0], 0.11, steel);
    b.box(-1.0, y + 0.72, 0.25, 3.4, 0.2, 0.26, ACCENT);                                     // the sail, bagged
    return;
  }
  const top = y + 10.8;
  b.cyl(mx, y + 5.4, 0, 0.065, 10.8, steel, 8);                                               // mast
  b.box(mx, y + 6.6, 0, 0.05, 0.05, 1.3, steel);                                               // spreaders
  rod(b, [mx, top, 0], [4.4, 1.12, 0], 0.035, 0x9aa0a6);                                       // forestay
  rod(b, [mx, top, 0], [-4.15, 0.82, 0], 0.035, 0x9aa0a6);                                     // backstay
  for (const z of [1, -1]) { rod(b, [mx, y + 9.2, 0], [mx, y + 6.6, z * 0.65], 0.03, 0x9aa0a6); rod(b, [mx, y + 6.6, z * 0.65], [mx - 0.15, y, z * 1.2], 0.03, 0x9aa0a6); }   // shrouds
  b.box(mx - 1.85, y + 1.0, 0, 3.7, 0.09, 0.09, steel);                                         // boom
  b.box(mx - 1.8, y + 1.15, 0, 3.4, 0.2, 0.28, ACCENT); b.prism(mx - 1.8, y + 1.33, 0, 3.4, 0.16, 0.28, ACCENT);   // the sail under its cover
  b.box(mx, top + 0.05, 0, 0.12, 0.08, 0.12, 0xfff4d0);                                          // masthead light
}

// A rowing boat, 3.6 m, open: painted topsides, a varnished inside, three thwarts and its oars.
function rowboat(b: Batch) {
  const st: Station[] = [
    { x: -1.75, wd: 0.55, yd: 0.42, wc: 0.50, yc: 0.02, wk: 0.15, yk: -0.08, rake: -0.10 },
    { x: -0.8, wd: 0.68, yd: 0.40, wc: 0.60, yc: -0.05, wk: 0.18, yk: -0.12 },
    { x: 0.4, wd: 0.66, yd: 0.42, wc: 0.56, yc: -0.05, wk: 0.16, yk: -0.12 },
    { x: 1.3, wd: 0.40, yd: 0.48, wc: 0.30, yc: 0.05, wk: 0.08, yk: -0.08 },
    { x: 1.8, wd: 0.0, yd: 0.58, wc: 0.0, yc: 0.25, wk: 0.0, yk: 0.0, rake: 0.20 },
  ];
  hull(b, st, { top: ACCENT, stripe: OFF_WHITE, s0: 0.3, s1: 0.37, rail: TEAK, bottom: OFF_WHITE, deck: WOOD, open: 0.3, inside: WOOD });
  for (const x of [-1.3, -0.2, 0.8]) b.box(x, 0.28, 0, 0.24, 0.04, 2 * deckW(st, x) - 0.12, TEAK);
  for (const z of [0.22, -0.22]) { b.box(-0.1, 0.33, z, 2.4, 0.045, 0.045, WOOD); b.box(1.25, 0.33, z, 0.55, 0.02, 0.14, WOOD); }
}

// A canoe, 4.2 m, its ends swept up, open with two seats and a yoke; or a kayak, closed over
// with a cockpit.
function canoe(b: Batch, kayak: boolean) {
  const n = kayak ? 0.85 : 1;
  const st: Station[] = [
    { x: -2.1 * n, wd: 0.0, yd: 0.39, wc: 0.0, yc: 0.26, wk: 0.0, yk: 0.10, rake: -0.12 },
    { x: -1.6 * n, wd: 0.24 * n, yd: 0.33, wc: 0.20 * n, yc: 0.07, wk: 0.05, yk: -0.02 },
    { x: -0.6 * n, wd: 0.39 * n, yd: 0.30, wc: 0.34 * n, yc: 0.02, wk: 0.08, yk: -0.06 },
    { x: 0.6 * n, wd: 0.39 * n, yd: 0.30, wc: 0.34 * n, yc: 0.02, wk: 0.08, yk: -0.06 },
    { x: 1.6 * n, wd: 0.24 * n, yd: 0.33, wc: 0.20 * n, yc: 0.07, wk: 0.05, yk: -0.02 },
    { x: 2.1 * n, wd: 0.0, yd: 0.39, wc: 0.0, yc: 0.26, wk: 0.0, yk: 0.10, rake: 0.12 },   // (0.45 m in all: the canoes cargo's height)
  ];
  if (kayak) {
    hull(b, st, { top: ACCENT, stripe: ACCENT, s0: 0, s1: 0, rail: RUB, bottom: ACCENT, deck: ACCENT });
    b.box(-0.1, 0.33, 0, 0.8, 0.05, 0.46, RUB); b.box(-0.1, 0.34, 0, 0.66, 0.02, 0.34, BLACK);   // cockpit
    return;
  }
  hull(b, st, { top: ACCENT, stripe: ACCENT, s0: 0, s1: 0, rail: RUB, bottom: ACCENT, deck: ACCENT, open: 0.24, inside: 0xd2cec4 });
  for (const x of [-1.3, 1.1]) b.box(x, 0.2, 0, 0.18, 0.03, 2 * deckW(st, x) - 0.08, WOOD);
  b.box(0, 0.29, 0, 0.08, 0.03, 0.74, WOOD);
}

// A personal watercraft (jet ski), 3 m: a deck in white, sides in its colour, a seat and bars.
function jetski(b: Batch) {
  const st: Station[] = [
    { x: -1.5, wd: 0.52, yd: 0.42, wc: 0.50, yc: 0.05, wk: 0.10, yk: -0.12, rake: -0.05 },
    { x: -0.2, wd: 0.58, yd: 0.46, wc: 0.54, yc: 0.00, wk: 0.12, yk: -0.16 },
    { x: 0.9, wd: 0.50, yd: 0.55, wc: 0.40, yc: 0.08, wk: 0.08, yk: -0.10 },
    { x: 1.5, wd: 0.0, yd: 0.62, wc: 0.0, yc: 0.30, wk: 0.0, yk: 0.05, rake: 0.30 },
  ];
  hull(b, st, { top: ACCENT, stripe: OFF_WHITE, s0: 0.2, s1: 0.3, rail: RUB, bottom: RUB, deck: OFF_WHITE });
  b.box(-0.5, 0.6, 0, 1.2, 0.2, 0.42, BLACK);                                               // seat
  wedge(b, 0.3, 1.1, 0.5, 0.82, 0.7, ACCENT, ACCENT);                                       // the cowl
  b.box(0.2, 0.75, 0, 0.3, 0.3, 0.7, ACCENT);
  b.box(0.25, 0.95, 0, 0.06, 0.06, 0.75, BLACK);                                             // bars
}

// ---- use ----------------------------------------------------------------------------------------

// One boat of `kind` at the origin into `b` (its accent white).
export function boatModel(b: Batch, kind: BoatKind, mastDown = false) {
  switch (kind) {
    case "cruiser": cruiser(b); break;
    case "narrowboat": narrowboat(b); break;
    case "sailboat": sailboat(b, mastDown); break;
    case "rowboat": rowboat(b); break;
    case "canoe": canoe(b, false); break;
    case "kayak": canoe(b, true); break;
    case "jetski": jetski(b); break;
  }
}

// A boat baked into a static batch: `x, y, z` its middle on the waterline, `yaw` its heading
// (bow along +x turned by yaw, as Batch.box's rotY), its accent `paint`. `scale` sizes it (a
// trailer sailer), `mastDown` lowers a sailboat's mast, `upturned` lays it hull up (then y is
// where its gunwale rests: boatExtent says how far it reaches).
interface BoatOpts { scale?: number; mastDown?: boolean; upturned?: boolean }
const models = new Map<string, { m: BatchModel; lo: number; hi: number; len: number; beam: number }>();
function model(kind: BoatKind, o: BoatOpts) {
  const key = `${kind}:${o.scale ?? 1}:${!!o.mastDown}:${!!o.upturned}`;
  let e = models.get(key);
  if (!e) {
    // (Built for real even in a dry run: a probe build can be the first to ask, and the model is kept.)
    const dry = BATCH.dry, t = new Batch();
    BATCH.dry = false; boatModel(t, kind, o.mastDown); BATCH.dry = dry;
    const m = t.take(), s = o.scale ?? 1;
    for (let i = 0; i < m.count * 3; i++) m.pos[i] *= s;
    if (o.upturned) {
      // (Upside down: y and its normals flipped, and each triangle's winding turned back.)
      for (let i = 1; i < m.count * 3; i += 3) { m.pos[i] = -m.pos[i]; m.nrm[i] = -m.nrm[i]; }
      for (let v = 0; v < m.count; v += 3) for (const a of [m.pos, m.nrm, m.col, ...(m.aux ? [m.aux] : [])]) for (let k = 0; k < 3; k++) { const t2 = a[(v + 1) * 3 + k]; a[(v + 1) * 3 + k] = a[(v + 2) * 3 + k]; a[(v + 2) * 3 + k] = t2; }
    }
    let lo = Infinity, hi = -Infinity, x0 = Infinity, x1 = -Infinity, zm = 0;
    for (let i = 0; i < m.count * 3; i += 3) {
      lo = Math.min(lo, m.pos[i + 1]); hi = Math.max(hi, m.pos[i + 1]);
      x0 = Math.min(x0, m.pos[i]); x1 = Math.max(x1, m.pos[i]); zm = Math.max(zm, Math.abs(m.pos[i + 2]));
    }
    models.set(key, e = { m, lo, hi, len: x1 - x0, beam: 2 * zm });
  }
  return e;
}
export function boatAt(b: Batch, kind: BoatKind, x: number, y: number, z: number, yaw: number, paint: number, o: BoatOpts = {}) {
  b.stamp(model(kind, o).m, x, y, z, yaw, paint, false);
}
// How far a boat (as boatAt would draw it) reaches below and above its origin: lo (negative, its
// keel) and hi. Sit it on the ground by setting its origin -lo up.
export function boatExtent(kind: BoatKind, o: BoatOpts = {}) { const e = model(kind, o); return { lo: e.lo, hi: e.hi }; }
// A boat's length and beam overall (fenders, rigging and all), measured from its model, for
// laying boats out.
export function boatSize(kind: BoatKind, o: BoatOpts = {}) { const e = model(kind, o); return { len: e.len, beam: e.beam }; }
