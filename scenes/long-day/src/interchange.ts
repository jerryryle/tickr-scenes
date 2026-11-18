// A freeway's off-ramp into town (facilities.ts "interchange" site; route.ts drives it as a
// "helix" tail): a deceleration lane widens the freeway's deck on the right from FW_OFF_A along
// the street (before its node) and peels away from it over the sidewalk; clear of the deck it
// starts down, round three-quarters of a loop in the block beside, and out at street level across
// the sidewalk into the kerb lane under the freeway. The block is landscaped round it. A slip
// ramp (route.ts "slip") leaves the same way but runs straight on, down beside the freeway across
// a superblock of three blocks, and tapers into the same kerb lane before the next intersection.
// Laid out in the frontage frame of the freeway's line (a along it from the node the exit is
// counted from, n in from the back of its sidewalk), in world coordinates; drawn relative to the
// tile's origin.
import { Batch } from "./geom.ts";
import { hash2 } from "./rng.ts";
import { OFFRAMP_LEN, OFFRAMP_SHIFT, Path, trackSweep } from "./route.ts";
import type { ExitKind, Pose } from "./route.ts";
import type { CityPlan } from "./city.ts";
import type { CBlock } from "./citygraph.ts";
import { inPoly } from "./citygraph.ts";
import { FW_LANE_N, FW_OFF_A } from "./freeway.ts";
import { CURB_H, STREET } from "./grid.ts";
import { C, slab } from "./city.ts";

// Along the frontage: where the off-ramp crosses the freeway deck's edge (its parapet is open),
// where the way out crosses the sidewalk (no bents), and the kerb cut.
// (The barrier is open from where the deceleration lane starts to the gore's nose, where the
// ramp's left edge leaves the deck: see offrampNose.)
export function interchangeOpen(): [number, number] { return [FW_OFF_A, FW_OFF_A + offrampNose()]; }
// (Where the way out crosses the sidewalk: the loop's foot by the block's middle, the slip ramp's
// near the far end of its superblock; found from its track.)
const CROSSING = new Map<ExitKind, [number, number]>();
function sidewalkCrossing(kind: ExitKind): [number, number] {
  const hit = CROSSING.get(kind);
  if (hit) return hit;
  // The track in a frame of its own: the line along x from the origin, n = z - STREET / 2.
  const t = Path.garageTrack(true, FW_OFF_A, -STREET / 2 + FW_LANE_N + STREET / 2, 0, kind), q: Pose = { x: 0, z: 0, h: 0, k: 0 };
  let a0 = Infinity, a1 = -Infinity;
  for (let s = OFFRAMP_LEN; s <= t.length; s += 0.25) { t.eval(s, q); const n = q.z - STREET / 2; if (n < 0.5 && n > -3.5) { a0 = Math.min(a0, q.x); a1 = Math.max(a1, q.x); } }
  const r: [number, number] = [a0, a1];
  CROSSING.set(kind, r);
  return r;
}
export const interchangeClear = (kind: ExitKind): [number, number] => kind === "helix" ? [22, 48] : [sidewalkCrossing(kind)[0] - 6, sidewalkCrossing(kind)[1] + 3];
// The kerb cut: just where the ramp's foot crosses the sidewalk (interchangeFoot).
export const interchangeDrive = (plan: CityPlan): [number, number] => { const f = interchangeFoot(plan); return [f.l0, f.r3]; };
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
// The freeway line's frontage frame: the dedge leaving the interchange's node into town, whose
// right side the ramp is on (a may run past its end: the line is straight).
export function interchangeFace(plan: CityPlan): number {
  const ic = plan.interchange!, G = plan.graph;
  return G.dedgeLeaving(G.node(ic.ix, ic.iz)!.id, ic.dir * Math.PI / 2);
}
// The off-ramp's track (world), from the freeway's right-hand lane.
export function interchangeTrack(plan: CityPlan): Path {
  const P = plan.graph.facePt(interchangeFace(plan), FW_OFF_A, -STREET / 2 + FW_LANE_N);
  return Path.garageTrack(true, P.x, P.z, P.h, plan.interchange!.kind);
}

// The off-ramp and its block (or superblock), relative to the tile's origin (ox, oz).
// The ramp's samples (world, or moved by -ox, -oz): where its track is, its height, the way across
// it and its edges' offsets: along the deceleration lane its left edge reaches only to the
// freeway's asphalt (it is the same roadway until the gore's nose) and its right opens out from
// the deck's edge; at its foot, where it tapers into the street, its pavement stops at the kerb
// line (the street's own asphalt is the rest).
type Sample = { x: number; z: number; y: number; rx: number; rz: number; l: number; r: number; c: number; free: boolean; on: boolean; ext: boolean };
function rampSamples(plan: CityPlan, ox = 0, oz = 0): Sample[] {
  const G = plan.graph, f0 = interchangeFace(plan), kind = plan.interchange!.kind, t = interchangeTrack(plan), p: Pose = { x: 0, z: 0, h: 0, k: 0 };
  const W = IC_W, nose = offrampNose(), sw = trackSweep(kind, IC_W, 0.75), pts: Sample[] = [], hL = G.facePt(f0, 0, 0).h;
  for (let s = 0; s <= t.length + 1e-6; s += 0.75) {
    const ss = Math.min(s, t.length); t.eval(ss, p);
    const c = G.toFace(f0, p.x, p.z)[1], on = ss < OFFRAMP_LEN, y = t.yAt(ss);
    // (Offsets across the ramp reach a frontage n of c + offset * cs: it crosses the line on a slant.)
    const cs = Math.max(0.3, Math.cos(p.h - hL)), toKerb = (KERB_LINE - c) / cs;
    // (Once down at street level and its street-side edge has reached the sidewalk, its pavement
    // runs out to the street's kerb line: no strip of sidewalk is left between it and the street.)
    const ext = !on && y < 0.04 && c - W * cs < 0.05, l = on && ss < nose ? Math.max(-W, ASPH_EDGE - c) : ext ? toKerb : -W;
    // (Past the deceleration lane, its deck widened through the turns to the truck's swept path.)
    const k = Math.min(pts.length, sw.l.length - 1);
    // (At the foot its block-side edge closes in to the truck's own width as it nears the street,
    // and runs into the kerb line: past the sidewalk the street is the rest.)
    let r = on ? Math.min(W, offRight(ss)) : sw.r[k];
    if (!on && y < 0.04) { const w = icSmooth((1 - c) / 3); r = r * (1 - w) + Math.min(r, Math.max(toKerb, 1.5)) * w; }
    pts.push({ x: p.x - ox, z: p.z - oz, y, rx: Math.sin(p.h), rz: Math.cos(p.h), c, free: ss >= nose, on, ext, l: on ? l : y < 0.04 ? Math.min(l, sw.l[k]) : Math.max(sw.l[k], l > -W ? l : -Infinity), r });
  }
  return pts;
}
// Where the ramp's foot crosses the sidewalk, in the freeway line's frontage: along its street-side
// (left) edge and its block-side (right) edge, the frontage a at the sidewalk's back (n = 0) and at
// the kerb line (n = -3). The kerb is cut from the first to the last of them, and the sidewalk
// either side follows the ramp's edges.
type Foot = { l0: number; l3: number; r0: number; r3: number; left: [number, number][]; right: [number, number][]; apron: [number, number][] };
const FOOT = new Map<string, Foot>();
export function interchangeFoot(plan: CityPlan) {
  const key = `${plan.seed}/${plan.style.id}`, hit = FOOT.get(key);
  if (hit) return hit;
  const G = plan.graph, f0 = interchangeFace(plan), pts = rampSamples(plan).filter((q) => !q.on && q.y < 0.04);
  // (Along the line itself: past its first face, which toFace would clamp to.)
  const P0 = G.facePt(f0, 0, 0), fx = Math.cos(P0.h), fz = -Math.sin(P0.h);
  const toLine = (x: number, z: number): [number, number] => [(x - P0.x) * fx + (z - P0.z) * fz, (x - P0.x) * -fz + (z - P0.z) * fx];
  const edge = (side: "l" | "r") => pts.map((q) => toLine(q.x + q.rx * q[side], q.z + q.rz * q[side]));
  // The first a at which an edge comes down to frontage n (the edges run down across the sidewalk).
  const cross = (E: [number, number][], n: number) => {
    if (E.length && E[0][1] <= n) return E[0][0];   // (already there where it comes down)
    for (let i = 1; i < E.length; i++) if (E[i - 1][1] > n && E[i][1] <= n) return E[i - 1][0] + (E[i][0] - E[i - 1][0]) * (E[i - 1][1] - n) / (E[i - 1][1] - E[i][1]);
    return E.length ? E[E.length - 1][0] : 0;
  };
  const L = edge("l"), R = edge("r");
  // (And each edge across the sidewalk, as points (a, n) from its back to the kerb line.)
  const band = (E: [number, number][], a0: number, a1: number): [number, number][] => [[a0, 0], ...E.filter(([a, n]) => a > a0 && a < a1 && n < 0 && n > KERB_LINE), [a1, KERB_LINE]];
  let l0 = cross(L, 0), l3 = cross(L, KERB_LINE + 0.01), left = band(L, l0, l3);
  // (Where the paving steps out to the kerb line, its edge runs across the sidewalk on a slant,
  // from where it meets the sidewalk's back to its kerb point further on. The sidewalk ends square
  // where the paving meets its back, and the triangle in front of that end is paved too: no point
  // of sidewalk left sticking out along the kerb.)
  let apron: [number, number][] = [];
  const iK = L.findIndex(([, n]) => n <= KERB_LINE + 0.01);
  if (iK > 0 && L[iK - 1][1] > KERB_LINE + 1) {
    const [A, B] = [L[iK - 1], L[iK]], aTop = A[0] + (B[0] - A[0]) * Math.max(0, Math.min(1, A[1] / (A[1] - B[1])));
    l0 = l3 = Math.min(aTop, B[0]); left = [];
    if (B[0] > aTop) apron = [[aTop, 0], [B[0], KERB_LINE], [aTop, KERB_LINE]];
  }
  const r0 = cross(R, 0), r3 = cross(R, KERB_LINE + 0.01);
  const foot: Foot = { l0, l3, r0, r3, left, right: band(R, r0, r3), apron };
  FOOT.set(key, foot);
  return foot;
}

export function buildInterchange(ground: Batch, solid: Batch, plan: CityPlan, blk: CBlock, ox: number, oz: number) {
  const G = plan.graph, f0 = interchangeFace(plan), seed = plan.seed, kind = plan.interchange!.kind;
  // Grass over the block, and a few trees out of the ramp's way.
  const poly = blk.poly.map(([x, z]) => [x - ox, z - oz] as [number, number]);
  for (let i = 1; i + 1 < poly.length; i++) ground.tri(poly[0][0], 0.02, poly[0][1], poly[i][0], 0.02, poly[i][1], poly[i + 1][0], 0.02, poly[i + 1][1], IC_GRASS);
  const tw = interchangeTrack(plan), p: Pose = { x: 0, z: 0, h: 0, k: 0 };
  // (The track's samples, moved to the tile's frame.)
  const t = { length: tw.length, yAt: (s: number) => tw.yAt(s), eval: (s: number, q: Pose) => { tw.eval(s, q); q.x -= ox; q.z -= oz; return q; } };
  const across = (x: number, z: number) => G.toFace(f0, x + ox, z + oz)[1];   // frontage n
  const W = IC_W, T = 0.42, pts = rampSamples(plan, ox, oz);
  void t; void p;
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
    quad(at(i, a.l, 0), at(i, a.r, 0), at(i + 1, b.r, 0), at(i + 1, b.l, 0), ground0 ? C.asphalt : IC_TOP, [0, 1, 0]);
    // Edge lines: the right one down to where it reaches the street's kerb line (past it the
    // street's own markings take over); the left one from the gore's nose (the freeway's own line,
    // dashed along the deceleration lane, meets it there) to where the ramp reaches the sidewalk.
    const offStreet = (q: Sample) => q.c + q.r > KERB_LINE + 0.7;
    for (const k of [-1, 1]) if (k > 0 ? !ground0 || (offStreet(a) && offStreet(b)) : a.free && b.free && !a.ext && !b.ext) {
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
  // The sidewalk either side of the foot, up to the ramp's edges (the kerb is cut between them):
  // before it, from the cut's start along the street-side edge down to the kerb line; after it,
  // from the block-side edge to the cut's end. Each with its kerb along the street.
  {
    const ft = interchangeFoot(plan), fp = (a: number, n: number): [number, number] => { const P = G.facePt(f0, a, n); return [P.x - ox, P.z - oz]; };
    if (ft.apron.length) slab(ground, ft.apron.map(([a, n]) => fp(a, n)), PAVE_Y, PAVE_Y, C.asphalt);
    if (ft.l3 - ft.l0 > 0.05 && ft.left.length) {
      slab(ground, ft.left[ft.left.length - 1][0] === ft.l0 && ft.left[ft.left.length - 1][1] === KERB_LINE ? ft.left.map(([a, n]) => fp(a, n)) : [...ft.left.map(([a, n]) => fp(a, n)), fp(ft.l0, KERB_LINE)], 0, CURB_H, C.sidewalk);
      slab(ground, [fp(ft.l0, KERB_LINE + 0.25), fp(ft.l3 - 0.25 * (ft.l3 - ft.l0) / 3, KERB_LINE + 0.25), fp(ft.l3, KERB_LINE), fp(ft.l0, KERB_LINE)], CURB_H, CURB_H + 0.008, C.curb);
    }
    if (ft.r3 - ft.r0 > 0.05) slab(ground, [fp(ft.r3, 0), ...ft.right.map(([a, n]) => fp(a, n))], 0, CURB_H, C.sidewalk);
  }
  // Columns where the deck is up and nothing of it runs beneath.
  for (let i = 0; i < pts.length; i += 8) {
    const a = pts[i];
    if (a.y < 2.2 || a.c < 1) continue;
    if (pts.some((q) => q.y < a.y - 1 && Math.hypot(q.x - a.x, q.z - a.z) < 4.2)) continue;
    solid.cyl(a.x, (a.y - T - 0.04) / 2, a.z, 0.5, a.y - T - 0.04, IC_COL, 8);
  }
  // Trees round the block, clear of the ramp.
  const len = kind === "slip" ? 158 : 38;
  for (let k = 0; k < (kind === "slip" ? 34 : 10); k++) {
    const P = G.facePt(f0, 11 + hash2(k, 1, seed, 0x1c) * len, 2 + hash2(k, 2, seed, 0x1c) * 38), tx = P.x - ox, tz = P.z - oz;
    if (!inPoly(poly, tx, tz) || pts.some((q) => Math.hypot(q.x - tx, q.z - tz) < 6)) continue;
    const r = 1.4 + hash2(k, 3, seed, 0x1c);
    solid.cyl(tx, 1.1, tz, 0.18, 2.2, 0x5a4030, 5); solid.ico(tx, 3.0, tz, r, 0x3c7a3a, 1, k);
  }
}
