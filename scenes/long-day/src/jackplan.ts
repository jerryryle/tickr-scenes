// The pallet jack's moves at a kerb stop, planned rather than chased (chores.ts jackLegs): where
// its middle goes and which way it points, as rolls straight along itself (pushed, forks first,
// or drawn, its handle first), curves (steered as it rolls) and pivots on the spot about its
// middle, each checked against what is there: the truck (solid but for its bed, open at the
// back), the walk ramp (along it, not off its sides), the building's front (only through its
// doorway), the loads in the bed and one just set down. The driver,
// on its handle, comes from the jack's pose: behind it rolling, the handle swung towards a curve,
// walking round it pivoting (jackDriverAt). crewpath.ts plays the moves exactly.
import type { TruckLayout } from "./truck.ts";

// The jack in its own frame (x along it from its steering wheel, forks ahead): its middle (what it
// pivots about), its body from behind the wheel to the fork ends, its half width; a load sits
// centred JK_LOAD_AT along; the handle, JACK_LEAD (chores.ts) from the wheel to the hands.
export const JACK_MID = 0.68;
const JK_BACK = -0.2, JK_END = 1.37, JK_HALF = 0.33, JK_LOAD_AT = 0.77, JK_HANDLE = 1.0;
// The jack's body keeps this clear of the walk ramp's side, on the ground beside it (m).
const JK_RAMP_SIDE = 0.35;
// Round a curve, the driver swings the handle towards it over this much of the way in and out (m).
const JK_SWING = 0.9;
// The driver keeps this clear of walls and things (their body's half width, m).
const JK_BODY = 0.3;
// Pivoting it, the driver nearer its middle than this stands beside its back, not behind it (m).
const JK_CLOSE = JACK_MID - JK_BACK + JK_BODY * 0.8;
// (There, this far to the side, beside the pump and steering wheel, the narrow part at its back:
// any further and it no longer turns round in a box truck's bed, jackStays.)
const JK_PUMP = 0.26;

// The jack's middle (truck frame) and heading (its forks along (cos h, -sin h)).
export interface JPose { x: number; z: number; h: number }
// A move: rolled from p0 to p1 along itself (h the same), round the point `c` (an arc, steered as
// it goes, p1.h - p0.h the turn), or pivoted from p0.h to p1.h about its middle (`tight`: the
// driver this much of the way out at the turn's middle); `from`, `to`: where the driver is as it
// starts or should be as it ends, when not where the move itself puts them (blended over its
// first or last part); `lead`: the driver this far behind its middle (jackLead); `turn`: how far
// a pivot turns, signed, where that isn't the short way round (a half turn the other way).
export interface JMove { kind: "roll" | "pivot" | "arc"; p0: JPose; p1: JPose; from?: [number, number]; to?: [number, number]; tight?: number; c?: [number, number]; lead?: number; turn?: number; swung?: [boolean, boolean] }   // swung: an arc's handle already swung to it at its start, or still at its end (on into an arc turning the same way)   // turn: a pivot's, signed, when it goes the long way round

export interface JackWorld {
  L: TruckLayout;
  rampHW: number;                                   // the walk ramp's half width (its run: L.rampRun behind the bed)
  free: number;                                     // the bed is clear up to this x (other stops' loads beyond)
  bed: { x0: number; x1: number; z0: number; z1: number }[];   // this stop's loads in the bed (their floor footprints)
  door: { x: number; z: number; nx: number; nz: number; half: number } | null;   // the building's door: its foot's middle and outward normal, its half width
  load: number[] | null;                            // what's on the forks: [length along, height, width]
  lead?: number;                                    // the driver this far behind its middle, on the handle (else jackLead)
  ground?: { x: number; z: number; h: number; l: number; w: number }[];   // loads set down on the pavement: middle, heading, length, width
}
// How far behind the jack's middle the driver walks: on the handle, at arm's length; further out
// behind a tall load reaching back over the wheel, so their head, leant in, stays clear of it.
export function jackLead(load: number[] | null): number {
  const base = JACK_MID + JK_HANDLE;
  return load && load[1] > 1.2 ? Math.max(base, JACK_MID - (JK_LOAD_AT - load[0] / 2) + 1.2) : base;
}

const jackWrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const jackFwd = (h: number): [number, number] => [Math.cos(h), -Math.sin(h)];
// (x, z) turned as a heading is by d (jackFwd(h) to jackFwd(h + d)).
const jackTurnBy = (x: number, z: number, d: number): [number, number] => [x * Math.cos(d) + z * Math.sin(d), -x * Math.sin(d) + z * Math.cos(d)];
// An arc from p, rolled `dist` along itself (forwards, or back if negative) while turning by d.
export function jackArc(p: JPose, dist: number, d: number): JMove {
  const rho = dist / d, [fx, fz] = jackFwd(p.h), c: [number, number] = [p.x + fz * rho, p.z - fx * rho];
  const [rx, rz] = jackTurnBy(p.x - c[0], p.z - c[1], d);
  return { kind: "arc", p0: p, p1: { x: c[0] + rx, z: c[1] + rz, h: p.h + d }, c };
}
export const jackEase = (u: number) => u * u * (3 - 2 * u);
// How far a pivot or arc turns (signed).
const jackTurn = (m: JMove) => m.turn ?? jackWrap(m.p1.h - m.p0.h);

// The jack's pose and the driver's place at u through a move (u eased by the caller).
export function jackPoseAt(m: JMove, u: number): JPose {
  if (m.kind === "roll") return { x: m.p0.x + (m.p1.x - m.p0.x) * u, z: m.p0.z + (m.p1.z - m.p0.z) * u, h: m.p0.h };
  if (m.kind === "arc") { const [cx, cz] = m.c!, d = jackWrap(m.p1.h - m.p0.h) * u, [rx, rz] = jackTurnBy(m.p0.x - cx, m.p0.z - cz, d); return { x: cx + rx, z: cz + rz, h: m.p0.h + d }; }
  return { x: m.p0.x, z: m.p0.z, h: m.p0.h + jackTurn(m) * u };
}
export function jackWheel(p: JPose): [number, number] { const [fx, fz] = jackFwd(p.h); return [p.x - fx * JACK_MID, p.z - fz * JACK_MID]; }
// The driver at u through a move: behind the wheel on the handle; pivoting, staying behind it as
// it turns, closer in through the middle of the turn (the handle tipped up, `tight` of the way
// out) where there is no room for more; blended from and to `from`, `to`.
export function jackDriverAt(m: JMove, u: number): [number, number] {
  const p = jackPoseAt(m, u), [fx, fz] = jackFwd(p.h), lead = m.lead ?? JACK_MID + JK_HANDLE, r = lead * (m.kind === "pivot" ? 1 - (1 - (m.tight ?? 1)) * Math.sin(Math.PI * u) : 1);
  let dx = p.x - fx * r, dz = p.z - fz * r;
  if (m.kind === "pivot" && r < JK_CLOSE) {
    // (In closer than its back, the handle folded up: beside the pump, on the side it is pushed
    // round from, not in the jack.)
    const k = Math.min(1, (JK_CLOSE - r) / 0.25), s = Math.sign(jackTurn(m)) || 1, side = k * JK_PUMP * s;
    dx += -fz * side; dz += fx * side;
  }
  if (m.kind === "arc") {
    // (Round a curve the handle is swung towards it, steering: along the way the wheel goes, behind
    // the jack, easing in and out at the curve's ends.)
    const [wx, wz] = jackWheel(p), d = jackWrap(m.p1.h - m.p0.h), vx = Math.sign(d) * (wz - m.c![1]), vz = -Math.sign(d) * (wx - m.c![0]);
    const back = vx * fx + vz * fz < 0 ? 1 : -1, sw = Math.atan2(-(back * vx * fz - back * vz * fx), -(back * vx * fx + back * vz * fz));
    // (The swing eased in and out over JK_SWING of the way, or half the curve if it is shorter, so a
    // tight one doesn't whip the driver round the wheel.)
    const f = Math.min(0.5, JK_SWING / Math.max(1e-3, jackArcLen(m)));
    const k = jackEase(Math.min(1, m.swung?.[0] ? 1 : u / f, m.swung?.[1] ? 1 : (1 - u) / f)), [hx, hz] = jackTurnBy(-fx, -fz, sw * k);
    dx = wx + hx * (lead - JACK_MID); dz = wz + hz * (lead - JACK_MID);
  }
  // (Blended by the difference between where the move itself puts the driver at its start or end
  // and `from` or `to`: where they agree, as they mostly do, nothing changes how the driver goes.)
  if (m.from || m.to) {
    const at = (v: number) => { const { from, to, ...own } = m; return jackDriverAt(own, v); };
    if (m.from) { const [sx, sz] = at(0), kk = 1 - jackEase(Math.min(1, u / 0.35)); dx += (m.from[0] - sx) * kk; dz += (m.from[1] - sz) * kk; }
    if (m.to) { const [ex, ez] = at(1), kk = jackEase(Math.max(0, (u - 0.65) / 0.35)); dx += (m.to[0] - ex) * kk; dz += (m.to[1] - ez) * kk; }
  }
  return [dx, dz];
}

// ---- what is in the way -------------------------------------------------------------------
// Points round the jack's body (ground: on the ramp only along it) and its load (in the air), in
// its own frame from the steering wheel: [along, across, kind] (0 its body, 1 a fork's tip, 2 its
// load, 3 the load as wide all along the forks, for the building's wall alone). Worked out once
// for each size of load.
// (The forks' tips, past where a pallet ends, slip under the next one's, in its pockets.)
const JK_TIP = 1.22;
const jkOffsets = new Map<string, Float32Array>();
function jackOffsets(load: number[] | null): Float32Array {
  const key = load ? load.join(",") : "", got = jkOffsets.get(key);
  if (got) return got;
  const out: number[] = [];
  const rect = (u0: number, u1: number, half: number, kind: number) => {
    const nu = Math.max(1, Math.ceil((u1 - u0) / 0.25)), nv = Math.max(1, Math.ceil(2 * half / 0.25));
    const at = (u: number, v: number) => out.push(u, v, kind === 0 && u > JK_TIP ? 1 : kind);
    for (let i = 0; i <= nu; i++) { at(u0 + (u1 - u0) * i / nu, -half); at(u0 + (u1 - u0) * i / nu, half); }
    for (let j = 1; j < nv; j++) { at(u0, -half + 2 * half * j / nv); at(u1, -half + 2 * half * j / nv); }
  };
  rect(JK_BACK, JK_END, JK_HALF, 0);
  if (load) { rect(JK_LOAD_AT - load[0] / 2, JK_LOAD_AT + load[0] / 2, load[2] / 2, 2); rect(-0.1, 1.4, load[2] / 2, 3); }
  const f = new Float32Array(out);
  jkOffsets.set(key, f);
  return f;
}
// Whether a point (on the jack, or the driver's middle with `body` round it) is somewhere solid
// (`load`: up where a load is carried; `tip`: a fork's tip).
function jackSolid(w: JackWorld, x: number, z: number, body: number, load: boolean, tip = false): boolean {
  const L = w.L, az = Math.abs(z), back = Math.min(L.rear, L.bedRear);
  // The truck: solid but for its bed (open at its back, where the ramp's top meets it) up to
  // `free`, and the loads in it.
  if (x > back - body - 0.02 && x < L.front + body + 0.05 && az < L.hw + body + 0.1) {
    const inBed = x > back - body - 0.3 && x < (tip ? Math.min(w.free + 0.15, L.bedFront) : w.free) - body && az < L.hw - body - 0.04;
    if (!inBed) return true;
    if (!tip) for (const b of w.bed) if (x > b.x0 - body - 0.02 && x < b.x1 + body + 0.02 && z > b.z0 - body - 0.02 && z < b.z1 + body + 0.02) return true;
  }
  // The walk ramp: on it only along it (its sides a drop, below the bed); the driver on it, well
  // in from its edges; on the ground beside it, JK_RAMP_SIDE clear of its edge (the driver's
  // middle that and their half width).
  const foot = L.bedRear - L.rampRun;
  if (!load && x > foot && x < back - 0.3 && az < w.rampHW + body + JK_RAMP_SIDE && az > (body ? w.rampHW - 0.12 : w.rampHW + 0.05)) return true;
  if (jackWall(w, x, z, body)) return true;
  // A load set down on the pavement.
  for (const g of w.ground ?? []) {
    const [fx, fz] = jackFwd(g.h), ox = x - g.x, oz = z - g.z;
    if (Math.abs(ox * fx + oz * fz) < g.l / 2 + body + 0.02 && Math.abs(-ox * fz + oz * fx) < g.w / 2 + body + 0.02) return true;
  }
  return false;
}
// The building's front: only through its doorway.
function jackWall(w: JackWorld, x: number, z: number, body: number): boolean {
  const d = w.door;
  if (!d) return false;
  const ox = x - d.x, oz = z - d.z, out = ox * d.nx + oz * d.nz, across = Math.abs(-ox * d.nz + oz * d.nx);
  return out < body + 0.02 && !(across < d.half - body - 0.05 && out > -3.0);
}
// How far the jack (and its load) reaches from its middle, at most (m).
function jackReach(w: JackWorld): number {
  const ext = jackExtents(w.load), half = Math.max(JK_HALF, (w.load?.[2] ?? 0) / 2);
  return Math.max(Math.hypot(ext.front, half), Math.hypot(ext.back, half), Math.hypot(1.4 - JACK_MID, half), Math.hypot(JACK_MID + 0.1, half));
}
// Whether anything solid might be within r of (x, z): the truck and its ramp, the building's front,
// a load set down. (False: certainly nothing; true: look closer.)
function jackNear(w: JackWorld, x: number, z: number, r: number): boolean {
  const L = w.L, foot = L.bedRear - L.rampRun;
  if (x > foot - r - 0.5 && x < L.front + r + 0.5 && Math.abs(z) < L.hw + r + 0.5) return true;
  const d = w.door;
  if (d && (x - d.x) * d.nx + (z - d.z) * d.nz < r + 0.4) return true;
  for (const g of w.ground ?? []) if (Math.hypot(x - g.x, z - g.z) < r + Math.hypot(g.l, g.w) / 2 + 0.4) return true;
  return false;
}
// The world cut down to what is within r of (x, z).
function jackLocal(w: JackWorld, x: number, z: number, r: number): JackWorld {
  return { ...w,
    bed: w.bed.filter((b) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1)) < r + 0.4),
    ground: (w.ground ?? []).filter((g) => Math.hypot(x - g.x, z - g.z) < r + Math.hypot(g.l, g.w) / 2 + 0.4) };
}
export function jackPoseClear(w: JackWorld, p: JPose): boolean {
  if (!jackNear(w, p.x, p.z, jackReach(w))) return true;
  const o = jackOffsets(w.load), [fx, fz] = jackFwd(p.h), [wx, wz] = jackWheel(p);
  for (let i = 0; i < o.length; i += 3) {
    const x = wx + fx * o[i] - fz * o[i + 1], z = wz + fz * o[i] + fx * o[i + 1], kind = o[i + 2];
    if (kind === 3 ? jackWall(w, x, z, 0) : jackSolid(w, x, z, 0, kind === 2, kind === 1)) return false;
  }
  return true;
}
export function jackDriverClear(w: JackWorld, x: number, z: number): boolean { return !jackSolid(w, x, z, JK_BODY, false); }
// A move clear all along, the jack and the driver, the driver never leaping.
// (A stop's planning gives up after this much checking, jackBudget: in moves of 20 poses of 100
// points each. Counted, not timed, so a plan is always the same.)
let jkChecks = Infinity;
export function jackBudget(n: number) { jkChecks = n; }
export function jackSpent() { return jkChecks < 0; }
export function jackLeft() { return jkChecks; }
export function jackMoveClear(w0: JackWorld, m: JMove): boolean {
  if (jkChecks < 0) return false;
  m.lead ??= w0.lead ?? jackLead(w0.load);   // (the driver as far behind as this world has them)
  // (Only what is near the move matters.)
  const q = jackPoseAt(m, 0.5), cx = (m.p0.x + m.p1.x + 2 * q.x) / 4, cz = (m.p0.z + m.p1.z + 2 * q.z) / 4;
  const w = jackLocal(w0, cx, cz, Math.max(Math.hypot(m.p0.x - cx, m.p0.z - cz), Math.hypot(m.p1.x - cx, m.p1.z - cz), Math.hypot(q.x - cx, q.z - cz)) + Math.max(jackReach(w0), m.lead) + JK_BODY + 0.3);
  // (Coarsely: a few centimetres' brush between samples will do.)
  const n = Math.max(2, Math.ceil(jackArcLen(m) / 0.2), m.kind === "roll" ? 0 : Math.ceil(Math.abs(jackTurn(m)) / 0.15));
  jkChecks -= (n + 1) * jackOffsets(w0.load).length / 3 / 2000;   // (a move of 20 poses of 100 points each: one)
  let px = NaN, pz = NaN;
  const bedBack = Math.min(w.L.rear, w.L.bedRear), inBedPivot = m.kind === "pivot" && m.p0.x > bedBack && Math.abs(m.p0.z) < w.L.hw;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    if (!jackPoseClear(w, jackPoseAt(m, u))) return false;
    const [dx, dz] = jackDriverAt(m, u);
    if (!(m.from && u < 0.3) && !(m.to && u > 0.7) && !jackDriverClear(w, dx, dz)) return false;
    // (Turning it in the bed, the driver stays in the bed with it, or up on the ramp's top: never
    // out beside it, down off the floor, through the bed's corner posts.)
    if (inBedPivot && dx < bedBack + JK_BODY * 0.5 && !(dx > bedBack - 1.2 && Math.abs(dz) < w.rampHW - JK_BODY)) return false;   // (or up on the walk ramp's top, a dock's platform)
    if (!Number.isNaN(px) && Math.hypot(dx - px, dz - pz) > 0.6) return false;
    px = dx; pz = dz;
  }
  return true;
}
// How far a move takes the jack's middle (m).
function jackArcLen(m: JMove): number {
  if (m.kind === "pivot") return 0;
  if (m.kind === "roll") return Math.hypot(m.p1.x - m.p0.x, m.p1.z - m.p0.z);
  return Math.hypot(m.p0.x - m.c![0], m.p0.z - m.c![1]) * Math.abs(jackWrap(m.p1.h - m.p0.h));
}
// How long a move takes (s): rolled at `speed`, pivoted at `rate` (rad/s), but never quicker
// than the driver can walk their way round it at `walk`.
export function jackMoveLen(m: JMove, speed: number, rate: number, walk: number): number {
  let path = 0, [px, pz] = jackDriverAt(m, 0);
  for (let i = 1; i <= 24; i++) { const [dx, dz] = jackDriverAt(m, i / 24); path += Math.hypot(dx - px, dz - pz); px = dx; pz = dz; }
  // (Drawn, the driver backing, a fifth slower.)
  const [fx, fz] = jackFwd(m.p0.h), mid = jackPoseAt(m, 0.5), k = m.kind !== "pivot" && (mid.x - m.p0.x) * fx + (mid.z - m.p0.z) * fz < 0 ? 0.8 : 1;
  const own = m.kind === "pivot" ? Math.abs(jackTurn(m)) / rate : jackArcLen(m) / (speed * k);
  return Math.max(0.4, own, path / (walk * k)) * 1.25;   // (eased in and out: a quarter longer for its middle's pace)
}

// ---- joining poses ------------------------------------------------------------------------
const JK_BACKOFF = [0.3, 0.6, 1.0];   // m: rolled straight on (or back) first, to turn where there is room
// From pose a through the points `via` (x, z) to pose b: at each, pivoted to the way on (pushed,
// or drawn back when that turns it less, or `mode` says), rolled there, and pivoted at the end to
// b's heading; where it can't turn, rolled a little straight on or back first; where it can't
// turn at b, come at it straight along b's heading from a little before it. null if all of
// that is blocked.
export function jackJoin(w: JackWorld, a: JPose, via: [number, number][], b: JPose, mode: "push" | "pull" | "either" = "either", near = true): JMove[] | null {
  const moves: JMove[] = [];
  let cur = a, ok = true;
  const pts: [number, number][] = [...via, [b.x, b.z]];
  for (const [n, [x, z]] of pts.entries()) {
    if (Math.hypot(x - cur.x, z - cur.z) < 0.02) continue;
    const end = n === pts.length - 1 ? b.h : undefined;   // (the last leg: rolled the way it is to end up, if it can be)
    let seg = jackSeg(w, cur, x, z, mode, end);
    for (const d of JK_BACKOFF) for (const sg of [-1, 1]) {
      if (seg) break;
      const [fx, fz] = jackFwd(cur.h), off: JMove = { kind: "roll", p0: cur, p1: { x: cur.x + fx * d * sg, z: cur.z + fz * d * sg, h: cur.h } };
      if (!jackMoveClear(w, off)) continue;
      const rest = jackSeg(w, off.p1, x, z, mode, end);
      if (rest) seg = [off, ...rest];
    }
    if (!seg) { ok = false; break; }
    moves.push(...seg); cur = seg[seg.length - 1].p1;
  }
  if (ok && Math.abs(jackWrap(b.h - cur.h)) <= 0.01) return moves;
  if (ok) { const m = jackPivot(w, cur, b.h); if (m) return [...moves, m]; }
  if (!near) return null;
  for (const d of JK_BACKOFF) for (const sg of [-1, 1]) {
    const [fx, fz] = jackFwd(b.h), b2: JPose = { x: b.x - fx * d * sg, z: b.z - fz * d * sg, h: b.h }, last: JMove = { kind: "roll", p0: b2, p1: b };
    if (!jackMoveClear(w, last)) continue;
    const m = jackJoin(w, a, via, b2, mode, false);
    if (m) return [...m, last];
  }
  return null;
}
// One leg of a join: pivoted to the way to (x, z) (pushed or drawn) and rolled there.
// (`end`: the heading wanted at its end, preferred to the least turn now.)
function jackSeg(w: JackWorld, cur: JPose, x: number, z: number, mode: "push" | "pull" | "either", end?: number): JMove[] | null {
  const push = Math.atan2(-(z - cur.z), x - cur.x), pull = jackWrap(push + Math.PI), ref = end ?? cur.h;
  const opts = mode === "push" ? [push] : mode === "pull" ? [pull] : Math.abs(jackWrap(push - ref)) <= Math.abs(jackWrap(pull - ref)) ? [push, pull] : [pull, push];
  for (const h of opts) {
    const roll: JMove = { kind: "roll", p0: { x: cur.x, z: cur.z, h }, p1: { x, z, h } };
    if (!jackMoveClear(w, roll)) continue;
    if (Math.abs(jackWrap(h - cur.h)) <= 0.01) return [roll];
    const turn = jackPivot(w, cur, h);
    if (turn) return [turn, roll];
  }
  return null;
}
// A pivot from p to heading h, the driver as far out round it as there is room for.
// (Never so tight that they stand in a load reaching back over the wheel, nor, a tall one, with
// their face in it: it is ahead of their middle.)
export function jackPivot(w: JackWorld, p: JPose, h: number): JMove | null {
  const least = w.load ? (JACK_MID - (JK_LOAD_AT - w.load[0] / 2) + JK_BODY + (w.load[1] > 1.2 ? 0.15 : 0)) / (w.lead ?? jackLead(w.load)) : 0;
  // (A half turn, either way round.)
  const d = jackWrap(h - p.h), turns = Math.abs(d) > Math.PI - 0.35 ? [d, d - Math.sign(d) * 2 * Math.PI] : [d];
  for (const tight of [1, 0.8, 0.62, 0.5]) {   // (the nearest, the handle folded up, beside the pump: JK_CLOSE)
    if (tight < least) continue;
    for (const turn of turns) {
      const m: JMove = { kind: "pivot", p0: p, p1: { x: p.x, z: p.z, h }, tight, turn };
      if (jackMoveClear(w, m)) return m;
    }
  }
  return null;
}
// The footprint's reach from the middle forwards and back along the jack (m).
export function jackExtents(load: number[] | null): { front: number; back: number } {
  const front = Math.max(JK_END, load ? JK_LOAD_AT + load[0] / 2 : 0) - JACK_MID;
  const back = JACK_MID - Math.min(JK_BACK, load ? JK_LOAD_AT - load[0] / 2 : 0);
  return { front, back };
}
// In the bed, from p to q: straight there if they line up, else turned on the spot somewhere
// between the bed's back (`x0`, the jack all aboard) and its loads, wherever there is room.
export function jackBedJoin(w: JackWorld, p: JPose, q: JPose, x0: number): JMove[] | null {
  const direct = jackJoin(w, p, [], q);
  if (direct) return direct;
  const zs = [...new Set([0, p.z, q.z, 0.3, -0.3])];
  for (let x = x0; x <= w.free - 0.3; x += 0.2) for (const z of zs) {
    const mid: JPose = { x, z, h: p.h }, s1 = jackJoin(w, p, [], mid);
    if (!s1) continue;
    const turn = jackPivot(w, mid, q.h);
    if (!turn) continue;
    const s2 = jackJoin(w, turn.p1, [], q);
    if (s2) return [...s1, turn, ...s2];
  }
  return null;
}
// Moves played backwards (from the end of the last to the start of the first).
export function jackReverse(ms: JMove[]): JMove[] {
  return ms.slice().reverse().map((m) => ({ ...m, p0: m.p1, p1: m.p0, from: undefined, to: undefined, turn: m.turn === undefined ? undefined : -m.turn }));
}
// Ways out of the doorway from r (within `near` of it; none needed further off), each ending
// clear of the building, the straightest first: drawn straight back until it can turn clear of
// the wall; or until all of it is out, and on back round a curve either way, steered as it comes
// out; or, through a wide door, curving sooner, still in its doorway (`curves`: those too).
export function jackDoorWays(w: JackWorld, r: JPose, near: number, curves = true): JMove[][] {
  const door = w.door;
  if (!door || Math.hypot(r.x - door.x, r.z - door.z) >= near) return [[]];
  const ext = jackExtents(w.load), half = Math.max(JK_HALF, (w.load?.[2] ?? 0) / 2), R = Math.max(Math.hypot(ext.front, half), Math.hypot(ext.back, half));
  const [fx, fz] = jackFwd(r.h), inside = -((r.x - door.x) * door.nx + (r.z - door.z) * door.nz);
  const back = (d: number): JMove => ({ kind: "roll", p0: r, p1: { x: r.x - fx * d, z: r.z - fz * d, h: r.h } });
  // (Where it may start to turn: from as soon as all of it is out, back to half a metre into the
  // doorway, a wide door's, where the pavement is narrow.)
  const out = Math.max(0.3, inside + ext.front + 0.15), d0s = [out];
  for (let d = out - 0.25; d >= Math.max(0.2, inside - 0.5); d -= 0.25) d0s.push(d);
  const ways: JMove[][] = [[back(Math.max(ext.front + 1.0, inside + R + 0.35))], ...d0s.map((d) => [back(d)])], arcs: JMove[][] = [];
  for (const d0 of curves ? d0s : []) {
    const s1 = back(d0);
    if (!jackMoveClear(w, s1)) continue;
    for (const d of [Math.PI / 2, Math.PI / 3, Math.PI / 4]) for (const rho of [1.2, 1.8, 2.6]) for (const sg of [-1, 1]) arcs.push([s1, jackArc(s1.p1, -rho * d, sg * d)]);
  }
  return [...ways, ...arcs].filter((ms) => ms.every((m) => jackMoveClear(w, m)));
}
// The way round that always works where any does, cheap to check: from `from` (out of its
// doorway by one of `exits`, if it has one), turned to run along the pavement (along the truck)
// and rolled on past the ramp's foot as far as it needs, then straight down into the
// road behind the truck and round to `to` there, lined up on the ramp. Looked for along one line
// only: the first spot along it with room. null if none.
export function jackStreet(w: JackWorld, from: JPose, exits: JMove[][], to: JPose): JMove[] | null {
  for (const o of exits.slice(0, 8)) {
    const e = o.length ? o[o.length - 1].p1 : from;
    for (const h of Math.abs(jackWrap(e.h)) < Math.PI / 2 ? [0, Math.PI] : [Math.PI, 0]) {
      const turn = Math.abs(jackWrap(h - e.h)) > 0.01 ? jackPivot(w, e, h) : null;
      if (Math.abs(jackWrap(h - e.h)) > 0.01 && !turn) continue;
      const s0: JPose = { x: e.x, z: e.z, h };
      // (Down to the road where it is, if that's past the truck already; else on past the
      // ramp's foot a metre at a time, until the way along is blocked.)
      const xs = e.x < to.x ? [e.x] : [];
      for (let k = 0; k <= 8; k++) xs.push(to.x - k);
      for (const xt of xs) {
        const roll: JMove | null = Math.abs(xt - e.x) > 0.02 ? { kind: "roll", p0: s0, p1: { x: xt, z: e.z, h } } : null;
        if (roll && !jackMoveClear(w, roll)) { if (xt < e.x) break; continue; }
        const at = roll ? roll.p1 : s0, rest = jackJoin(w, at, [[xt, to.z]], to, "either", false);
        if (rest) return [...o, ...(turn ? [turn] : []), ...(roll ? [roll] : []), ...rest];
      }
    }
  }
  return null;
}

// ---- curving between poses --------------------------------------------------------------------
// The shortest way pushed from pose a to pose b (forks first all the way) as curves and a straight
// between them, turning no tighter than a radius (a Dubins path), as a person steers a jack across
// open ground rather than stopping to turn it on the spot: the widest radius whose way is clear.
// (In (X, Y) = (x, -z), where a heading turns anticlockwise: L, the heading growing.)
const JK_RADII = [2.2, 1.7, 1.3, 1.0, 0.75, 0.55];
// How many of the ways found are checked, the shortest first (each check costs from jackBudget).
const JK_CURVE_TRIES = 14;
// Turning counts for this much more way than the curve itself goes, per radian (m).
const JK_TURN_COST = 0.5;
// A way found is no longer than this many times the straight distance, and this much more (m).
const JK_CURVE_DETOUR = [1.6, 2.0];
type DSeg = { k: "L" | "S" | "R"; v: number };   // (an arc's angle, or a straight's length, in radii)
function dubinsWords(dx: number, dy: number, th0: number, th1: number): DSeg[][] {
  const d = Math.hypot(dx, dy), phi = Math.atan2(dy, dx), a = th0 - phi, b = th1 - phi;
  const md = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const sa = Math.sin(a), sb = Math.sin(b), ca = Math.cos(a), cb = Math.cos(b), cab = Math.cos(a - b), out: DSeg[][] = [];
  let tmp = 2 + d * d - 2 * cab + 2 * d * (sa - sb);
  if (tmp >= 0) { const g = Math.atan2(cb - ca, d + sa - sb); out.push([{ k: "L", v: md(-a + g) }, { k: "S", v: Math.sqrt(tmp) }, { k: "L", v: md(b - g) }]); }
  tmp = 2 + d * d - 2 * cab + 2 * d * (sb - sa);
  if (tmp >= 0) { const g = Math.atan2(ca - cb, d - sa + sb); out.push([{ k: "R", v: md(a - g) }, { k: "S", v: Math.sqrt(tmp) }, { k: "R", v: md(-b + g) }]); }
  tmp = -2 + d * d + 2 * cab + 2 * d * (sa + sb);
  if (tmp >= 0) { const p = Math.sqrt(tmp), g = Math.atan2(-ca - cb, d + sa + sb) - Math.atan2(-2, p); out.push([{ k: "L", v: md(-a + g) }, { k: "S", v: p }, { k: "R", v: md(-b + g) }]); }
  tmp = d * d - 2 + 2 * cab - 2 * d * (sa + sb);
  if (tmp >= 0) { const p = Math.sqrt(tmp), g = Math.atan2(ca + cb, d - sa - sb) - Math.atan2(2, p); out.push([{ k: "R", v: md(a - g) }, { k: "S", v: p }, { k: "L", v: md(b - g) }]); }
  tmp = (6 - d * d + 2 * cab + 2 * d * (sa - sb)) / 8;
  if (Math.abs(tmp) <= 1) { const p = md(2 * Math.PI - Math.acos(tmp)), t = md(a - Math.atan2(ca - cb, d - sa + sb) + p / 2); out.push([{ k: "R", v: t }, { k: "L", v: p }, { k: "R", v: md(a - b - t + p) }]); }
  tmp = (6 - d * d + 2 * cab + 2 * d * (-sa + sb)) / 8;
  if (Math.abs(tmp) <= 1) { const p = md(2 * Math.PI - Math.acos(tmp)), t = md(-a - Math.atan2(ca - cb, d + sa - sb) + p / 2); out.push([{ k: "L", v: t }, { k: "R", v: p }, { k: "L", v: md(b - a - t + p) }]); }
  return out;
}
// A word's moves from a at radius R (arcs in pieces of no more than 2.5 rad: jackPoseAt takes an
// arc's turn the short way), or null where it doesn't come to b (a formula's stray answer).
function dubinsMoves(a: JPose, b: JPose, word: DSeg[], R: number): JMove[] | null {
  const moves: JMove[] = [];
  let cur = a;
  for (const s of word) {
    if (s.v * R < 1e-3) continue;
    if (s.k === "S") { const [fx, fz] = jackFwd(cur.h), p1 = { x: cur.x + fx * s.v * R, z: cur.z + fz * s.v * R, h: cur.h }; moves.push({ kind: "roll", p0: cur, p1 }); cur = p1; continue; }
    const n = Math.ceil(s.v / 2.5), sg = s.k === "L" ? 1 : -1;
    for (let i = 0; i < n; i++) { const m = jackArc(cur, R * s.v / n, sg * s.v / n); moves.push(m); cur = m.p1; }
  }
  return Math.hypot(cur.x - b.x, cur.z - b.z) < 0.03 && Math.abs(jackWrap(cur.h - b.h)) < 0.03 ? moves : null;
}
export function jackCurve(w: JackWorld, a: JPose, b: JPose): JMove[] | null {
  const ways: { len: number; moves: JMove[] }[] = [];
  for (const R of JK_RADII) for (const word of dubinsWords((b.x - a.x) / R, -(b.z - a.z) / R, a.h, b.h)) {
    const moves = dubinsMoves(a, b, word, R);
    // (Shortest first, a tighter turn counting for a little more, and turning at all for more: a
    // way round a little further beats a tight loop.)
    if (moves) ways.push({ len: word.reduce((s, q) => s + (q.k === "S" ? q.v * R : q.v * (R + JK_TURN_COST)), 0) + (JK_RADII[0] - R) * 0.6, moves });
  }
  // (Not a way round a loop: never much longer than going straight there.)
  const most = JK_CURVE_DETOUR[0] * Math.hypot(b.x - a.x, b.z - a.z) + JK_CURVE_DETOUR[1];
  ways.sort((p, q) => p.len - q.len);
  while (ways.length && ways[ways.length - 1].len > most) ways.pop();
  for (const way of ways.slice(0, JK_CURVE_TRIES)) if (way.moves.every((m) => jackMoveClear(w, m))) return way.moves;
  return null;
}

// ---- smoothing a plan -------------------------------------------------------------------------
// Which way a move takes the jack: +1 pushed (forks first), -1 drawn (handle first), 0 turned on
// the spot.
export function jackMotion(m: JMove): number {
  if (m.kind === "pivot") return 0;
  const [fx, fz] = jackFwd(m.p0.h), q = jackPoseAt(m, 0.5);
  return (q.x - m.p0.x) * fx + (q.z - m.p0.z) * fz >= 0 ? 1 : -1;
}
// Whether move b carries straight on from move a, rolled or steered the same way: one movement,
// not stopped between them (crewpath.ts eases the run of them in and out only at its ends).
export function jackFlows(a: JMove | undefined, b: JMove | undefined): boolean {
  if (!a || !b) return false;
  const da = jackMotion(a);
  return da !== 0 && da === jackMotion(b) && Math.hypot(a.p1.x - b.p0.x, a.p1.z - b.p0.z) < 0.02 && Math.abs(jackWrap(a.p1.h - b.p0.h)) < 0.02;
}
// A plan's moves with what makes them stop and start taken out where the way stays clear:
// pivots one after another on the same spot made one, and a pivot between two rolls the same way
// steered round as a curve (the rolls cut short by as much as it takes, at most half of each);
// and arcs on into arcs turning the same way marked to keep the handle swung between them.
const JK_FILLET = [1.2, 0.8, 0.5, 0.35];
export function jackSmooth(w: JackWorld, ms: JMove[]): JMove[] {
  const out: JMove[] = [];
  for (const m of ms) {
    const last = out[out.length - 1];
    if (m.kind === "pivot" && last?.kind === "pivot" && Math.hypot(last.p0.x - m.p0.x, last.p0.z - m.p0.z) < 0.02 && !last.from && !m.to) {
      const turn = jackTurn(last) + jackTurn(m), one: JMove = { ...last, p1: m.p1, turn, tight: Math.min(last.tight ?? 1, m.tight ?? 1) };
      if (Math.abs(turn) < 0.01) { out.pop(); continue; }
      if (jackMoveClear(w, one)) { out[out.length - 1] = one; continue; }
    }
    out.push({ ...m });
  }
  for (let i = 1; i < out.length - 1; i++) {
    const a = out[i - 1], t = out[i], b = out[i + 1];
    if (t.kind !== "pivot" || a.kind !== "roll" || b.kind !== "roll" || t.from || t.to) continue;
    const sa = jackMotion(a), d = jackTurn(t);
    if (sa !== jackMotion(b) || Math.abs(d) > 2.2 || Math.abs(d) < 0.03) continue;
    const la = Math.hypot(a.p1.x - a.p0.x, a.p1.z - a.p0.z), lb = Math.hypot(b.p1.x - b.p0.x, b.p1.z - b.p0.z);
    for (const R of JK_FILLET) {
      const T = R * Math.tan(Math.abs(d) / 2);
      if (T > 0.5 * la || T > 0.5 * lb) continue;
      const [ax, az] = jackFwd(a.p0.h), [bx, bz] = jackFwd(b.p0.h);
      const s0: JPose = { x: t.p0.x - ax * sa * T, z: t.p0.z - az * sa * T, h: a.p0.h }, e0: JPose = { x: t.p0.x + bx * sa * T, z: t.p0.z + bz * sa * T, h: b.p0.h };
      const arc = jackArc(s0, sa * R * Math.abs(d), d);
      if (Math.hypot(arc.p1.x - e0.x, arc.p1.z - e0.z) > 0.03) continue;
      const a2: JMove = { ...a, p1: s0, to: undefined }, b2: JMove = { ...b, p0: e0, from: undefined };
      if (!jackMoveClear(w, arc) || !jackMoveClear(w, a2) || !jackMoveClear(w, b2)) continue;
      out.splice(i - 1, 3, { ...a2, ...(a.to ? { to: a.to } : {}) }, arc, { ...b2, ...(b.from ? { from: b.from } : {}) });
      break;
    }
  }
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    if (a.kind === "arc" && b.kind === "arc" && jackFlows(a, b) && Math.sign(jackTurn(a)) === Math.sign(jackTurn(b))) {
      a.swung = [a.swung?.[0] ?? false, true]; b.swung = [true, b.swung?.[1] ?? false];
    }
  }
  return out;
}
