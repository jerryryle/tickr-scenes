// A freeway's off-ramp into town (facilities.ts "interchange" site; route.ts drives it as a
// "helix" tail): a deceleration lane widens the freeway's deck on the right from FW_OFF_A along
// the street (before its node) and peels away from it over the sidewalk; clear of the deck it
// starts down, round three-quarters of a loop in the block beside, and out at street level across
// the sidewalk into the kerb lane under the freeway. The block is landscaped round it. Block-
// local, in the frontage frame of the freeway's side (city.ts frontPt).
import { Batch } from "./geom.ts";
import { hash2 } from "./rng.ts";
import { OFFRAMP_LEN, Path } from "./route.ts";
import type { Pose } from "./route.ts";
import { frontPt, FRONT_NODE } from "./city.ts";
import { FW_LANE_N, FW_OFF_A } from "./freeway.ts";
import { STREET } from "./grid.ts";

// Along the frontage: where the off-ramp crosses the freeway deck's edge (its parapet is open),
// where the way out crosses the sidewalk (no bents), and the kerb cut.
export const INTERCHANGE_OPEN: [number, number] = [FW_OFF_A, 2];
export const INTERCHANGE_CLEAR: [number, number] = [8, 26];
export const INTERCHANGE_DRIVE: [number, number] = [8, 26];
const DECK_EDGE = -1.6;   // the freeway deck's right edge (frontage n)
const PAVE_Y = 0.16;       // the ramp's pavement at street level: over the sidewalk's top
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
  ground.span(Math.min(x0, x1), -0.05, Math.min(z0, z1), Math.max(x0, x1), 0.04, Math.max(z0, z1), IC_GRASS);
  const t = interchangeTrack(side), p: Pose = { x: 0, z: 0, h: 0, k: 0 };
  const [nx0, nz0, d] = FRONT_NODE[side], [rx0, rz0] = IC_RIGHT[d];
  const across = (x: number, z: number) => (x - nx0) * rx0 + (z - nz0) * rz0 - STREET / 2;   // frontage n
  // Samples along it: where it is, its height and the way across it, and how far its left edge
  // reaches (along the deceleration lane, only out to the freeway deck's edge, where it joins it).
  const W = 3.1, T = 0.42;
  const pts: { x: number; z: number; y: number; rx: number; rz: number; l: number; c: number }[] = [];
  for (let s = 0; s <= t.length + 1e-6; s += 0.75) {
    const ss = Math.min(s, t.length); t.eval(ss, p);
    const c = across(p.x, p.z), l = ss < OFFRAMP_LEN ? Math.max(-W, DECK_EDGE - c) : -W;
    pts.push({ x: p.x, z: p.z, y: t.yAt(ss), rx: Math.sin(p.h), rz: Math.cos(p.h), l, c });
  }
  type V = [number, number, number];
  const quad = (a: V, b: V, c: V, e: V, color: number, face: V) => { solid.tri(...a, ...b, ...c, color, face); solid.tri(...a, ...c, ...e, color, face); };
  // (At street level its pavement is just over the sidewalk's top; up, its deck's top is the road.)
  const top = (q: { y: number }) => (q.y < 0.04 ? PAVE_Y : q.y - 0.005);
  const at = (i: number, n: number, dy: number): V => { const q = pts[i]; return [q.x + q.rx * n, top(q) + dy, q.z + q.rz * n]; };
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.l > W - 0.05 && b.l > W - 0.05) continue;            // all on the freeway's deck yet
    const ground = Math.max(a.y, b.y) < 0.04;
    if (ground && Math.min(a.c, b.c) < -3) continue;             // out in the street: the street's own
    const rx = (a.rx + b.rx) / 2, rz = (a.rz + b.rz) / 2, my = (a.y + b.y) / 2;
    const L = (q: number) => Math.min(pts[q].l, W - 0.05);
    quad(at(i, L(i), 0), at(i, W, 0), at(i + 1, W, 0), at(i + 1, L(i + 1), 0), IC_TOP, [0, 1, 0]);
    // Lane edge lines (the left one once it has peeled away).
    if (i % 6 < 3) for (const k of [-1, 1]) if (k > 0 || a.l <= -W + 0.01) quad(at(i, k * (W - 0.6), 0.006), at(i, k * (W - 0.45), 0.006), at(i + 1, k * (W - 0.45), 0.006), at(i + 1, k * (W - 0.6), 0.006), 0xe8e8e0, [0, 1, 0]);
    if (ground) continue;
    quad(at(i, L(i), -T), at(i, W, -T), at(i + 1, W, -T), at(i + 1, L(i + 1), -T), IC_DECK, [0, -1, 0]);
    for (const k of [-1, 1]) {
      const sd: V = [rx * k, 0, rz * k], low = my < 2.2, na = k > 0 ? W : L(i), nb = k > 0 ? W : L(i + 1);
      quad(at(i, na, low ? -top(a) + 0.02 : -T), at(i + 1, nb, low ? -top(b) + 0.02 : -T), at(i + 1, nb, 0), at(i, na, 0), low ? IC_COL : IC_DECK, sd);
      // Parapets: the right all the way; the left once it is clear of the freeway's deck.
      if (Math.min(a.y, b.y) > 0.6 && (k > 0 || (a.l <= -W + 0.01 && b.l <= -W + 0.01))) {
        const n0 = k * (W - 0.22), n1 = k * W;
        quad(at(i, n0, 0), at(i + 1, n0, 0), at(i + 1, n0, 0.9), at(i, n0, 0.9), IC_RAIL, [-sd[0], 0, -sd[2]]);
        quad(at(i, n1, 0), at(i + 1, n1, 0), at(i + 1, n1, 0.9), at(i, n1, 0.9), IC_RAIL, sd);
        quad(at(i, n0, 0.9), at(i, n1, 0.9), at(i + 1, n1, 0.9), at(i + 1, n0, 0.9), IC_RAIL, [0, 1, 0]);
      }
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
