// A freeway's off-ramp into town (facilities.ts "interchange" site; route.ts drives it as a
// "helix" tail): a deceleration lane widens the freeway's deck on the right from FW_OFF_A along
// the street (before its node) and peels away from it over the sidewalk; clear of the deck it
// starts down, round three-quarters of a loop in the block beside, and out at street level across
// the sidewalk into the kerb lane under the freeway. The block is landscaped round it. Block-
// local, in the frontage frame of the freeway's side (city.ts frontPt).
import { Batch } from "./geom.ts";
import { hash2 } from "./rng.ts";
import { OFFRAMP_LEN, OFFRAMP_SHIFT, Path } from "./route.ts";
import type { Pose } from "./route.ts";
import { frontPt, FRONT_NODE } from "./city.ts";
import { FW_LANE_N, FW_OFF_A } from "./freeway.ts";
import { STREET } from "./grid.ts";

// Along the frontage: where the off-ramp crosses the freeway deck's edge (its parapet is open),
// where the way out crosses the sidewalk (no bents), and the kerb cut.
// (The barrier is open from where the deceleration lane starts to the gore's nose, where the
// ramp's left edge leaves the deck: see offrampNose.)
export function interchangeOpen(): [number, number] { return [FW_OFF_A, FW_OFF_A + offrampNose()]; }
export const INTERCHANGE_CLEAR: [number, number] = [22, 48];
export const INTERCHANGE_DRIVE: [number, number] = [26, 47];
const DECK_EDGE = -1.6;   // the freeway deck's right edge (frontage n)
const ASPH_EDGE = -2.0;   // and its asphalt's (the deceleration lane's surface runs on from it)
const KERB_LINE = -3.0;   // the street's kerb line (frontage n): the sidewalk's front edge
const PAVE_Y = 0.036;     // the ramp's pavement at street level: just over the kerb cut's apron
const IC_W = 3.1;
const icSmooth = (u: number) => { const x = Math.min(Math.max(u, 0), 1); return x * x * x * (10 + x * (6 * x - 15)); };
// The deceleration lane's centre (frontage n) at s along it, and its right edge's offset from
// the centre: from the deck's edge, widening over the first 30 m (the lane opening out).
const offN = (s: number) => -STREET / 2 + FW_LANE_N + OFFRAMP_SHIFT * icSmooth(s / OFFRAMP_LEN);
const offRight = (s: number) => { const c = offN(s), w = icSmooth(s / 30); return (DECK_EDGE - c) * (1 - w) + IC_W * w; };
// The gore's nose: s where the ramp's left edge clears the deck's.
function offrampNose() { let s = 0; while (s < OFFRAMP_LEN && offN(s) - IC_W < DECK_EDGE) s += 0.25; return s; }
const IC_DECK = 0x9a978e, IC_TOP = 0x3a3b3f, IC_RAIL = 0xb5b2a8, IC_COL = 0x8d8a82, IC_GRASS = 0x5f8f4a;
const IC_SIDE_DIR = [0, 2, 1, 3];
const IC_RIGHT: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

// The off-ramp's track (block-local), from the freeway's right-hand lane.
export function interchangeTrack(side: number): Path {
  const [x, z] = frontPt(side, FW_OFF_A, -STREET / 2 + FW_LANE_N);
  return Path.garageTrack(true, x, z, IC_SIDE_DIR[side] * Math.PI / 2, "helix");
}

export function buildInterchange(ground: Batch, solid: Batch, side: number, seed: number) {
  // Grass over the block, and a few trees out of the ramp's way.
  const [x0, z0] = frontPt(side, 9, 0), [x1, z1] = frontPt(side, 51, 42);
  ground.span(Math.min(x0, x1), -0.05, Math.min(z0, z1), Math.max(x0, x1), 0.02, Math.max(z0, z1), IC_GRASS);
  const t = interchangeTrack(side), p: Pose = { x: 0, z: 0, h: 0, k: 0 };
  const [nx0, nz0, d] = FRONT_NODE[side], [rx0, rz0] = IC_RIGHT[d];
  const across = (x: number, z: number) => (x - nx0) * rx0 + (z - nz0) * rz0 - STREET / 2;   // frontage n
  // Samples along it: where it is, its height, the way across it and its edges' offsets: along
  // the deceleration lane its left edge reaches only to the freeway's asphalt (it is the same
  // roadway until the gore's nose) and its right opens out from the deck's edge.
  const W = IC_W, T = 0.42, nose = offrampNose();
  const pts: { x: number; z: number; y: number; rx: number; rz: number; l: number; r: number; c: number; free: boolean }[] = [];
  for (let s = 0; s <= t.length + 1e-6; s += 0.75) {
    const ss = Math.min(s, t.length); t.eval(ss, p);
    const c = across(p.x, p.z), on = ss < OFFRAMP_LEN, y = t.yAt(ss);
    // (At the foot, where it tapers into the street, its pavement stops at the kerb line: the
    // street's own asphalt is the rest.)
    const l = on && ss < nose ? Math.max(-W, ASPH_EDGE - c) : y < 0.04 && !on ? Math.max(-W, KERB_LINE - c) : -W;
    pts.push({ x: p.x, z: p.z, y, rx: Math.sin(p.h), rz: Math.cos(p.h), c, free: ss >= nose, l, r: on ? Math.min(W, offRight(ss)) : W });
  }
  // All of it in the ground batch, like the freeway: the truck's see-through spotlight leaves it be.
  type V = [number, number, number];
  const quad = (a: V, b: V, c: V, e: V, color: number, face: V) => { ground.tri(...a, ...b, ...c, color, face); ground.tri(...a, ...c, ...e, color, face); };
  // (At street level its pavement is flush with the kerb cut's apron; up, its deck's top is the road.)
  const top = (q: { y: number }) => (q.y < 0.04 ? PAVE_Y : q.y - 0.005);
  const at = (i: number, n: number, dy: number): V => { const q = pts[i]; return [q.x + q.rx * n, top(q) + dy, q.z + q.rz * n]; };
  // Its barriers run on down to the sidewalk's back edge and slope away to nothing just short of it.
  const wallH = (i: number, n: number) => { if (pts[i].y > 0.6) return 0.9; const [x, , z] = at(i, n, 0); return 0.9 * Math.min(1, Math.max(0, (across(x, z) - 0.4) / 3)); };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.r - a.l < 0.05 && b.r - b.l < 0.05) continue;
    const ground0 = Math.max(a.y, b.y) < 0.04;
    if (ground0 && a.r - a.l < 0.05 && b.r - b.l < 0.05) continue;   // out in the street: the street's own
    const rx = (a.rx + b.rx) / 2, rz = (a.rz + b.rz) / 2, my = (a.y + b.y) / 2;
    quad(at(i, a.l, 0), at(i, a.r, 0), at(i + 1, b.r, 0), at(i + 1, b.l, 0), IC_TOP, [0, 1, 0]);
    // Edge lines: the right one all the way; the left one from the gore's nose (the freeway's
    // own line, dashed along the deceleration lane, meets it there).
    for (const k of [-1, 1]) if ((k > 0 || (a.free && b.free)) && !(k < 0 && (a.l > -W + 0.01 || b.l > -W + 0.01) && ground0)) {
      const ea = k > 0 ? a.r : a.l, eb = k > 0 ? b.r : b.l;
      quad(at(i, ea - k * 0.6, 0.006), at(i, ea - k * 0.45, 0.006), at(i + 1, eb - k * 0.45, 0.006), at(i + 1, eb - k * 0.6, 0.006), 0xe8e8e0, [0, 1, 0]);
    }
    if (!ground0) {
      quad(at(i, a.l, -T), at(i, a.r, -T), at(i + 1, b.r, -T), at(i + 1, b.l, -T), IC_DECK, [0, -1, 0]);
      for (const k of [-1, 1]) {
        if (k < 0 && !(a.free && b.free)) continue;
        const sd: V = [rx * k, 0, rz * k], low = my < 2.2, na = k > 0 ? a.r : a.l, nb = k > 0 ? b.r : b.l;
        quad(at(i, na, low ? -top(a) + 0.02 : -T), at(i + 1, nb, low ? -top(b) + 0.02 : -T), at(i + 1, nb, 0), at(i, na, 0), low ? IC_COL : IC_DECK, sd);
      }
    }
    // Barriers: the right one from where the freeway's ends; the left one from the gore's nose.
    for (const k of [-1, 1]) {
      if (k < 0 && !(a.free && b.free)) continue;
      const sd: V = [rx * k, 0, rz * k], ea = k > 0 ? a.r : a.l, eb = k > 0 ? b.r : b.l;
      const n0a = ea - k * 0.25, n0b = eb - k * 0.25, ha = wallH(i, ea), hb = wallH(i + 1, eb);
      if (ha < 0.02 && hb < 0.02) continue;
      quad(at(i, n0a, 0), at(i + 1, n0b, 0), at(i + 1, n0b, hb), at(i, n0a, ha), IC_RAIL, [-sd[0], 0, -sd[2]]);
      quad(at(i, ea, 0), at(i + 1, eb, 0), at(i + 1, eb, hb), at(i, ea, ha), IC_RAIL, sd);
      quad(at(i, n0a, ha), at(i, ea, ha), at(i + 1, eb, hb), at(i + 1, n0b, hb), IC_RAIL, [0, 1, 0]);
    }
  }
  // Columns where the deck is up and nothing of it runs beneath.
  for (let i = 0; i < pts.length; i += 8) {
    const a = pts[i];
    if (a.y < 2.2 || a.c < 1) continue;
    if (pts.some((q) => q.y < a.y - 1 && Math.hypot(q.x - a.x, q.z - a.z) < 4.2)) continue;
    solid.cyl(a.x, (a.y - T - 0.04) / 2, a.z, 0.5, a.y - T - 0.04, IC_COL, 8);
  }
  // Trees round the edge of the block, clear of the ramp.
  for (let k = 0; k < 10; k++) {
    const [tx, tz] = frontPt(side, 11 + hash2(k, 1, seed, 0x1c) * 38, 2 + hash2(k, 2, seed, 0x1c) * 38);
    if (pts.some((q) => Math.hypot(q.x - tx, q.z - tz) < 6)) continue;
    const r = 1.4 + hash2(k, 3, seed, 0x1c);
    solid.cyl(tx, 1.1, tz, 0.18, 2.2, 0x5a4030, 5); solid.ico(tx, 3.0, tz, r, 0x3c7a3a, 1, k);
  }
}
