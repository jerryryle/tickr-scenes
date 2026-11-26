// The driver's way round the truck at a stop, worked out once for the stop's plan of chores
// (chores.ts) and then looked up by the dwell clock, so a scrub lands on the same step.
//
// The chores say where the driver should be (a walk's line, the spot of a stationary chore) and
// which way to face. Walking, the driver heads for a point a little way along the path ahead, so
// corners are taken in a curve and whatever is pushed in front goes round them first. Turning
// with something heavy in hand (a loaded hand truck, a crate on a dolly, a drum), the driver
// turns it about itself rather than swinging it round: the driver walks round the load, which
// barely moves, and then catches up with the path. Empty-handed, the driver simply turns. A short
// walk back the way the driver came with a tool or load in hand (out of the bed after stowing,
// away from a door) is walked backwards, drawing it along, as people do in a tight space.
// Down a walk ramp with it (Chore.noTurn) the driver turns nothing: on the way they face,
// forwards or backwards, until it is off the ramp.
// A hand truck can't be pushed sideways: walking with one, it rolls straight along the way it
// faces and is turned on its wheels, the driver walking round them (wheelWalk), never swung round
// the driver.
// A pallet jack's moves are planned (jackplan.ts, Chore.jack): it and the driver on its handle are
// placed from them exactly, and between them it stays where they left it. (A walk with it that
// wasn't planned, rarely: held straight out ahead of the driver.)
import type { Chore } from "./chores.ts";
import { jackDriverAt, jackEase, jackFlows, jackMotion, jackPoseAt, jackWheel } from "./jackplan.ts";
import { SIDE_STEP, STRIDE } from "./character.ts";

// What the driver holds during a chore, for turning: how far ahead of the feet its weight is,
// how much of a turn goes about that point rather than the driver (0..1), and how briskly the
// driver turns (a spring's rate, 1/s, and the most rad/s).
// A pallet jack's `tip`: its middle, this far on from its steering wheel, which is `lead` ahead
// of the feet.
// `wheels`: a hand truck, which only rolls along the way it faces or turns on its wheels.
// A pallet jack's move played by how far the driver has walked through it, not the jack: round a
// tight curve the driver swings round its wheel, further than the jack goes, and timed by the jack
// they would hurry through that. `u` of the driver's way: the move's own progress (0..1) there.
const DRIVER_WAY = new WeakMap<object, Float32Array>();
function byDriver(m: NonNullable<Chore["jack"]>, u: number): number {
  let cum = DRIVER_WAY.get(m);
  if (!cum) {
    const n = 32; cum = new Float32Array(n + 1);
    let [px, pz] = jackDriverAt(m, 0);
    for (let i = 1; i <= n; i++) { const [x, z] = jackDriverAt(m, i / n); cum[i] = cum[i - 1] + Math.hypot(x - px, z - pz); px = x; pz = z; }
    DRIVER_WAY.set(m, cum);
  }
  const n = cum.length - 1, total = cum[n];
  if (total < 0.05) return u;   // (a pivot about the driver, say: as it is)
  const want = u * total;
  let i = 0;
  while (i < n - 1 && cum[i + 1] < want) i++;
  const span = cum[i + 1] - cum[i];
  return (i + (span > 1e-6 ? (want - cum[i]) / span : 0)) / n;
}
// Whether a chore pushes the pallet jack along, forks first: on into a doorway's fetch, or out of
// one, carried on without a stop at the threshold (crew.ts flipDepth).
export function jackIntoDoor(c?: Chore): boolean { return !!c && c.kind === "walk" && !!c.jack && jackMotion(c.jack) > 0; }
const flipJack = (c?: Chore) => !!c && c.kind === "fetch" && !!c.flip && c.tool === "palletJack";
export interface Hold { lead: number; pivot: number; omega: number; rate: number; tip?: number; wheels?: boolean }
export const EMPTY_HOLD: Hold = { lead: 0, pivot: 0, omega: 9, rate: 7 };

// Where a chore puts the driver at progress u (truck frame), the facing it wants (NaN: whatever
// the driver has), and whether that spot is exact (the door, the ramp's end, the cab steps:
// any drift from a turn is taken up quickly there).
// (snap: exactly there, facing so, at once: out of sight, turned round inside a doorway.)
export interface Nominal { x: number; z: number; yaw: number; exact: boolean; snap?: boolean }

// (jx, jz, jyaw: a pallet jack in hand, its steering wheel and heading; NaN when there is none.)
// (lead: a hand truck's wheels this far ahead of the driver, walked with as planned (wheelWalk); NaN otherwise.)
export interface CrewPath { rate: number; x: Float32Array; z: Float32Array; yaw: Float32Array; steps: Float32Array; gait: Float32Array; travel: Float32Array; jx: Float32Array; jz: Float32Array; jyaw: Float32Array; lead: Float32Array; starts: number[] }

const RATE = 30;              // samples a second
const AVG = 8;                // samples either side over which a move's sideways share is judged (samplePath)
const LOOK = 0.9;             // walking, the driver heads for the path this far ahead (m)
const PRE_TURN = 0.55;        // and turns to face the next chore's way over its last this many seconds
const CATCH = 0.45, CATCH_EXACT = 0.12;   // the time constant of catching up with the path (s)
const BACK_TURN = 2.2, BACK_LEN = 3.2;    // walked backwards: a walk this far round from the facing, no longer than this

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// `nominal(c, u)`: the chore's spot and facing; `hold(c, u)`: what is in hand; `yaw0`: the facing
// as the plan starts.
// `clear(x, z)`: whether the driver may stand there (not in the truck), turning a hand truck.
export function buildCrewPath(plan: Chore[], nominal: (c: Chore, u: number) => Nominal, hold: (c: Chore, u: number) => Hold, yaw0: number, clear: (x: number, z: number) => boolean = () => true): CrewPath {
  const starts: number[] = [];
  let total = 0;
  for (const c of plan) { starts.push(total); total += c.len; }
  const n = Math.max(2, Math.ceil(total * RATE) + 2), dt = 1 / RATE;
  const P: CrewPath = { rate: RATE, x: new Float32Array(n), z: new Float32Array(n), yaw: new Float32Array(n), steps: new Float32Array(n), gait: new Float32Array(n), travel: new Float32Array(n), jx: new Float32Array(n).fill(NaN), jz: new Float32Array(n).fill(NaN), jyaw: new Float32Array(n).fill(NaN), lead: new Float32Array(n).fill(NaN), starts };
  const isWalk = (c?: Chore) => !!c && c.kind === "walk";
  // Walking: the point `look` metres on along this walk and the ones straight after it (on past
  // the last one's end), and the direction to it from (x, z).
  const pt = [0, 0];
  const ahead = (i: number, u: number, x: number, z: number, look = LOOK) => {
    let c = plan[i], ax = c.a![0] + (c.b![0] - c.a![0]) * u, az = c.a![2] + (c.b![2] - c.a![2]) * u, left = look;
    for (let k = i; ; k++) {
      const q = plan[k], bx = q.b![0], bz = q.b![2], seg = Math.hypot(bx - ax, bz - az);
      const next = plan[k + 1];
      if (seg >= left || !isWalk(next)) {
        const dx = (bx - q.a![0]), dz = (bz - q.a![2]), m = Math.hypot(dx, dz);
        if (seg >= left && seg > 1e-6) { ax += (bx - ax) * left / seg; az += (bz - az) * left / seg; }
        else if (m > 1e-6) { ax = bx + dx / m * (left - seg); az = bz + dz / m * (left - seg); }
        break;
      }
      left -= seg; ax = bx; az = bz; c = next;
    }
    pt[0] = ax; pt[1] = az;
    return Math.hypot(ax - x, az - z) > 1e-4 ? Math.atan2(-(az - z), ax - x) : NaN;
  };
  let ci = 0, x = 0, z = 0, yaw = yaw0, v = 0, ex = 0, ez = 0, steps = 0, first = true, back = false, entered = -1, travel = 0, dir = 1;
  let jack = false, rx = 0, rz = 0, jth = 0;   // a pallet jack where its last planned move left it: its middle, its heading
  let snapAt: { i: number; ex: number; ez: number; ey: number; jdx: number; jdz: number; jh: number } | null = null;   // a snapped chore's start, as it really was
  let wheel: WheelWalk | null = null, wheelTo = -1, wheelT0 = 0, wheelT1 = 0;   // walks with a hand truck, as rolled and turned (wheelWalk): to chore wheelTo, from time wheelT0 to wheelT1
  for (let s = 0; s < n; s++) {
    const t = Math.min(s * dt, total - 1e-6);
    while (ci < plan.length - 1 && t >= starts[ci + 1]) ci++;
    const c = plan[ci], u = Math.min(1, Math.max(0, (t - starts[ci]) / c.len));
    const nm = nominal(c, u), h = hold(c, u);
    if (entered !== ci) {
      // Into a new chore: a walk back the way the driver faces away from, holding something, is
      // walked backwards.
      entered = ci; back = false; snapAt = null;
      if (ci > wheelTo) wheel = null;
      const plain = (q?: Chore) => !!q && isWalk(q) && !!hold(q, 0).wheels && !q.round && !q.noTurn && !q.backward && !q.jack;
      if (!wheel && plain(c) && !first) {
        // (A run of walks with it, one after another, taken as one: the wheels through each corner,
        // and at the end, where the driver should stand, facing the way the next chore wants,
        // turned there on the wheels.)
        let j = ci;
        while (plain(plan[j + 1]) && !plan[j + 1].forward === !c.forward) j++;
        const next = plan[j + 1];
        // (Round it next: facing its wheels. Drawn back next, the driver backing: facing back the way that goes.)
        const fy = next && (!isWalk(next) || next.round) ? nominal(next, 0).yaw : next?.backward && next.a && next.b ? Math.atan2(-(next.b[2] - next.a[2]), next.b[0] - next.a[0]) + Math.PI : NaN;
        wheel = wheelWalk(x, z, yaw, plan.slice(ci, j + 1).map((q) => q.b!), h.lead, fy, !!c.forward, clear, c.a![1]);
        wheelTo = j; wheelT0 = starts[ci]; wheelT1 = starts[j] + plan[j].len; wheel.dur = wheelT1 - wheelT0;
      }
      if (isWalk(c) && h.pivot > 0 && !c.round) {
        const dx = c.b![0] - c.a![0], dz = c.b![2] - c.a![2], len = Math.hypot(dx, dz);
        const off = Math.abs(wrap(Math.atan2(-dz, dx) - yaw));
        back = len > 0.05 && !c.forward && (c.noTurn ? off > Math.PI / 2 : len <= BACK_LEN && off > BACK_TURN);
      }
    }
    let target = nm.yaw;
    if (c.faceYaw && isWalk(c)) target = c.faceYaw[0] + wrap(c.faceYaw[1] - c.faceYaw[0]) * u;   // (faced so all the way: turning a load, side-stepping it)
    else if (back) { const a = c.a!, b = c.b!; target = Math.atan2(-(b[2] - a[2]), b[0] - a[0]) + Math.PI; }
    else if (c.round) target = nm.yaw;   // (round what's held: facing it)
    else if (c.backward && isWalk(c)) { const f = ahead(ci, u, nm.x, nm.z); if (!Number.isNaN(f)) target = f + Math.PI; }   // (backing along it, facing back the way it comes)
    else if (c.noTurn) { const a = c.a!, b = c.b!; if (Math.hypot(b[0] - a[0], b[2] - a[2]) > 0.05) target = Math.atan2(-(b[2] - a[2]), b[0] - a[0]); }   // (straight on, not turning early for what comes next; on no way at all, as they are)
    else if (isWalk(c) && Number.isNaN(target)) {
      target = ahead(ci, u, nm.x, nm.z);
      // Arriving: face the way the next chore wants.
      const next = plan[ci + 1], left = (1 - u) * c.len;
      if (next && !isWalk(next) && left < PRE_TURN) {
        const f = nominal(next, 0).yaw;
        if (!Number.isNaN(f)) { const k = 1 - left / PRE_TURN, kk = k * k * (3 - 2 * k); target = (Number.isNaN(target) ? f : target + wrap(f - target) * kk); }
      }
    }
    if (Number.isNaN(target)) target = yaw;
    if (first) { x = nm.x; z = nm.z; first = false; }
    let nx: number, nz: number, dy: number;
    if (nm.snap) {
      // Placed exactly (a fetch turned round inside a doorway), from wherever the driver and what
      // they hold really were as it began (the end of a pallet jack's planned moves, say), closing
      // on it over the walk in; turned round out of sight, what's held straight out ahead.
      if (!snapAt) {
        const [jx0, jz0] = jack ? [rx, rz] : [NaN, NaN];
        snapAt = { i: ci, ex: x - nm.x, ez: z - nm.z, ey: wrap(yaw - nm.yaw), jdx: jx0 - x, jdz: jz0 - z, jh: jth };
      }
      const k = u < 0.5 ? 1 - jackEase(Math.min(1, u / 0.35)) : 0;
      nx = nm.x + snapAt.ex * k; nz = nm.z + snapAt.ez * k;
      const y1 = nm.yaw + snapAt.ey * k;
      dy = wrap(y1 - yaw); yaw = y1; v = 0; ex = ez = 0;
      if (h.tip) {
        jack = true;
        if (u < 0.5 && !Number.isNaN(snapAt.jdx)) { rx = nx + snapAt.jdx; rz = nz + snapAt.jdz; jth = snapAt.jh; }   // (going in: pushed straight on, as it was)
        else { jth = yaw; rx = nx + Math.cos(yaw) * (h.lead + h.tip); rz = nz - Math.sin(yaw) * (h.lead + h.tip); }
        const [wx, wz] = jackWheel({ x: rx, z: rz, h: jth });
        P.jx[s] = wx; P.jz[s] = wz; P.jyaw[s] = jth;
      } else jack = false;
      if (Math.abs(dy) > 1) dy = 0;   // (turned round out of sight: no steps for it)
    } else if (wheel) {
      // A walk with a hand truck: rolled and turned on its wheels as worked out (wheelWalk).
      const q = wheelAt(wheel, Math.min(1, Math.max(0, (t - wheelT0) / (wheelT1 - wheelT0))));
      nx = q[0]; nz = q[1];
      dy = wrap(q[2] - yaw); yaw = q[2]; v = 0; ex = ez = 0; jack = false;   // (each part eased to a stop: still at its end)
      P.lead[s] = q[3];
    } else if (c.round && h.wheels && !Number.isNaN(nm.yaw)) {
      // Round a hand truck: facing its wheels all the way, which stay where they are.
      nx = nm.x; nz = nm.z;
      dy = wrap(nm.yaw - yaw); yaw += dy; v = dy / dt; ex = ez = 0; jack = false;
    } else if (c.jack) {
      // A pallet jack's planned move (jackplan.ts): the jack and the driver just as planned, eased
      // in and out; the driver facing the handle's end, and the jack's state carried on for
      // whatever comes next.
      // (Run on into from the move before, or on into the next, one movement: not eased there.)
      const fi = jackFlows(plan[ci - 1]?.jack, c.jack) || (flipJack(plan[ci - 1]) && jackIntoDoor(c)), fo = jackFlows(c.jack, plan[ci + 1]?.jack) || (flipJack(plan[ci + 1]) && jackIntoDoor(c));
      const e = fi && fo ? u : fi ? 1 - (1 - u) * (1 - u) * (1 + u) : fo ? u * u * (2 - u) : jackEase(u);
      const ed = byDriver(c.jack, e), p = jackPoseAt(c.jack, ed), [wx, wz] = jackWheel(p), [dx, dz] = jackDriverAt(c.jack, ed);
      nx = dx; nz = dz;
      const y1 = Math.hypot(wx - nx, wz - nz) > 0.05 ? Math.atan2(-(wz - nz), wx - nx) : yaw;
      dy = wrap(y1 - yaw); yaw = y1; v = dy / dt;
      jack = true; jth = p.h; rx = p.x; rz = p.z; ex = ez = 0; first = false;
      P.jx[s] = wx; P.jz[s] = wz; P.jyaw[s] = p.h;
    } else if (h.tip && !isWalk(c) && (jack || (c.kind === "toolGet" && c.rest))) {
      if (!jack) { jack = true; jth = c.rest!.yaw; rx = c.rest!.at[0] + Math.cos(jth) * h.tip; rz = c.rest!.at[2] - Math.sin(jth) * h.tip; }   // (taken from where it rests)
      // (Between planned moves, at a chore's spot: the jack stays just where they left it (or
      // where it rested), the driver at the spot, facing it.)
      const [wx, wz] = jackWheel({ x: rx, z: rz, h: jth });
      nx = nm.x; nz = nm.z;
      const y1 = Math.hypot(wx - nx, wz - nz) > 0.05 ? Math.atan2(-(wz - nz), wx - nx) : yaw;
      dy = wrap(y1 - yaw); yaw = y1; v = dy / dt; ex = ez = 0;
      P.jx[s] = wx; P.jz[s] = wz; P.jyaw[s] = jth;
    } else {
      jack = false;
      // Turn: a critically damped spring, no faster than the load allows.
      const err = wrap(target - yaw), acc = h.omega * h.omega * err - 2 * h.omega * v;
      v = Math.max(-h.rate, Math.min(h.rate, v + acc * dt));
      dy = v * dt;
      const y1 = yaw + dy;
      // About the load: the driver steps round it, and so ends up off the path for a moment.
      if (h.pivot > 0 && h.lead > 0 && !c.round) {
        const px = x + Math.cos(yaw) * h.lead, pz = z - Math.sin(yaw) * h.lead;
        ex += (px - Math.cos(y1) * h.lead - x) * h.pivot; ez += (pz + Math.sin(y1) * h.lead - z) * h.pivot;
      }
      yaw = y1;
      const k = Math.exp(-dt / (nm.exact ? CATCH_EXACT : CATCH));
      ex *= k; ez *= k;
      const m = Math.hypot(ex, ez); if (m > 1.5) { ex *= 1.5 / m; ez *= 1.5 / m; }
      nx = nm.x + ex; nz = nm.z + ez;
      if (h.wheels && !isWalk(c) && c.kind !== "toolGet" && c.kind !== "toolPut" && Math.abs(dy) < 1e-4) {
        // (Holding a hand truck, still, closing on the chore's spot: only along the way it faces,
        // as its wheels roll, never sideways.)
        const fx = Math.cos(yaw), fz = -Math.sin(yaw), along = (nx - x) * fx + (nz - z) * fz;
        nx = x + fx * along; nz = z + fz * along; ex = nx - nm.x; ez = nz - nm.z;
      }
      if (h.tip) {
        // (A walk with the jack that wasn't planned: held straight out ahead, and left where it is
        // after, for a chore that follows.)
        jack = true; jth = yaw; rx = nx + Math.cos(yaw) * (h.lead + h.tip); rz = nz - Math.sin(yaw) * (h.lead + h.tip);
        const [wx, wz] = jackWheel({ x: rx, z: rz, h: jth });
        P.jx[s] = wx; P.jz[s] = wz; P.jyaw[s] = jth;
      }
    }
    // The steps count up going forwards and down going backwards, whichever way the move comes
    // from (a planned walk backwards, backing out of a doorway, stepping back round a load):
    // the way the driver goes along their facing, or as they were going when that's unclear
    // (sideways, turning on the spot, which takes steps too).
    const moved = Math.hypot(nx - x, nz - z), fwd = (nx - x) * Math.cos(yaw) - (nz - z) * Math.sin(yaw);
    if (Math.abs(fwd) > 0.3 * moved && moved > 1e-5) dir = fwd > 0 ? 1 : -1;
    steps += dir * (moved + Math.abs(dy) * 0.22);
    travel += dir * moved;   // (the ground covered alone: what rolls a drum)
    x = nx; z = nz;
    P.x[s] = x; P.z[s] = z; P.yaw[s] = yaw; P.steps[s] = steps; P.travel[s] = travel;
  }
  // The walk cycle's phase, in strides: the steps, each going as far through a cycle as the ground
  // it covers takes, a stride along the facing and less, SIDE_STEP, across it (side-stepping), by
  // the share along it that the pose is drawn with (shares), so a planted foot keeps still.
  const sh = { along: 1, lat: 0 };
  for (let s = 1; s < n; s++) {
    const a = shares(P, s - 1, sh).along, d = P.steps[s] - P.steps[s - 1];
    P.gait[s] = P.gait[s - 1] + d * STRIDE / (a * STRIDE + (1 - a) * SIDE_STEP);
  }
  return P;
}

// Walks with a hand truck (`lead` from the driver's feet to its wheels), from the driver at (x, z)
// facing `yaw` through the walks' ends `pts`: at each, turned on its wheels to the way on and
// rolled there, the driver to each corner; the last, to where the driver is to stand, turned
// there on its wheels to face `face` (NaN: the way it rolled). A single short walk back the way
// the driver faces away from is rolled backwards instead, drawn after them.
// A corner between two rolls the same way is taken on an arc (rounded), the wheels curving
// through it as the driver steers, as wide as there is room for; only where there is no room, or
// the way reverses, is it turned on the spot.
// Each part takes its share of the time by how far the driver goes in it. A run of rolls and arcs
// between two stops (a turn on the spot, a change from pushing to drawing) is one movement:
// eased in at its start and out at its end, at an even walk between (wheelAt).
// (arc: the wheels about (cx, cz) from angle a0 by h1 - h0, radius rr.)
interface WheelPart { kind: "turn" | "roll" | "arc"; wx0: number; wz0: number; wx1: number; wz1: number; h0: number; h1: number; w: number; near: number; back?: boolean; cx?: number; cz?: number; a0?: number; rr?: number }
// (seg: the parts' runs, each eased as one: its first part, its last, and its share of the time.)
interface WheelWalk { lead: number; parts: WheelPart[]; total: number; segs: { i0: number; i1: number; w: number }[]; dur: number }
// The radii a corner is rounded on, the widest that fits first (m, the wheels' path).
const ARC_R = [1.4, 1.0, 0.7, 0.45];
// Coming to a spot to face a given way, the wheels roll straight that way for the last this far
// (m), where there is room.
const SQUARE_RUN = 2.0;
// A movement eases in and out over this long at each end (s), at most a third of it.
const EASE_T = 0.45;
// (Turning it on its wheels where walking round them at arm's length would take the driver into
// something, the truck: held more upright, nearer, the nearest this, through the middle of the turn.)
const WHEEL_NEAR = [0.9, 0.75, 0.6];
function wheelWalk(x: number, z: number, yaw: number, pts: number[][], lead: number, face: number, forward: boolean, clear: (x: number, z: number) => boolean, y0 = 0): WheelWalk {
  const fw = (h: number): [number, number] => [Math.cos(h), -Math.sin(h)];
  const [f0x, f0z] = fw(yaw);
  let wx = x + f0x * lead, wz = z + f0z * lead, h = yaw;
  const parts: WheelPart[] = [];
  // (Whether turning it by d on its wheels where they are leaves the driver room at r, nearest.)
  const fits = (d: number, r: number) => { for (let i = 1; i < 12; i++) { const u = i / 12, rr = lead - (lead - r) * Math.sin(Math.PI * u), [fx, fz] = fw(h + d * u); if (!clear(wx - fx * rr, wz - fz * rr)) return false; } return true; };
  const room = (to: number) => fits(wrap(to - h), WHEEL_NEAR[WHEEL_NEAR.length - 1]);
  const turn = (to: number) => {
    const d = wrap(to - h);
    if (Math.abs(d) > 0.01) {
      // (As far out as there is room for.)
      const near = fits(d, lead) ? lead : WHEEL_NEAR.find((r) => fits(d, r)) ?? WHEEL_NEAR[WHEEL_NEAR.length - 1];
      parts.push({ kind: "turn", wx0: wx, wz0: wz, wx1: wx, wz1: wz, h0: h, h1: h + d, w: Math.abs(d) * (lead + near) / 2, near });
    }
    h += d;
  };
  // Setting off pushed towards (tx, tz) from facing another way: on an arc, as wide as fits, that
  // leaves it heading there, so the turn on the spot after it comes to nothing.
  const setOff = (tx: number, tz: number) => {
    const off = wrap(Math.atan2(-(tz - wz), tx - wx) - h), sg = Math.sign(off);
    if (Math.abs(off) < 0.3) return;
    for (const R of ARC_R) {
      const cx = wx + Math.cos(h + sg * Math.PI / 2) * R, cz = wz - Math.sin(h + sg * Math.PI / 2) * R, dist = Math.hypot(tx - cx, tz - cz);
      if (dist < R + 0.3) continue;
      // (Where the way on to the target leaves the circle, tangent, going round it the way it turns.)
      const a0 = h - sg * Math.PI / 2, ap = Math.atan2(-(tz - cz), tx - cx) - sg * Math.acos(R / dist);
      const turnBy = (((sg * (ap - a0)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (turnBy > 2.4 || turnBy < 0.05) continue;
      const d = sg * turnBy;
      let ok = true;
      for (let k = 0; k <= 10 && ok; k++) {
        const q = a0 + d * k / 10, hh = h + d * k / 10, px = cx + Math.cos(q) * R, pz = cz - Math.sin(q) * R;
        ok = clear(px, pz) && clear(px - Math.cos(hh) * lead, pz + Math.sin(hh) * lead);
      }
      const ex = cx + Math.cos(a0 + d) * R, ez = cz - Math.sin(a0 + d) * R, [gx, gz] = fw(h + d);
      // (And the straight way on from it to the target, a way the planned walk never took.)
      for (let k = 1; k <= 10 && ok; k++) { const px = ex + (tx - ex) * k / 10, pz = ez + (tz - ez) * k / 10; ok = clear(px, pz) && clear(px - gx * lead, pz - gz * lead); }
      if (!ok) continue;
      parts.push({ kind: "arc", wx0: wx, wz0: wz, wx1: ex, wz1: ez, h0: h, h1: h + d, w: Math.hypot(R, lead) * Math.abs(d), near: lead, cx, cz, a0, rr: R });
      wx = ex; wz = ez; h += d;
      return;
    }
  };
  const roll = (tx: number, tz: number, back: boolean) => {
    if (Math.hypot(tx - wx, tz - wz) < 0.02) return;
    if (!parts.length && !back) setOff(tx, tz);
    const dist = Math.hypot(tx - wx, tz - wz), go = Math.atan2(-(tz - wz), tx - wx);
    turn(back ? go + Math.PI : go);
    parts.push({ kind: "roll", wx0: wx, wz0: wz, wx1: tx, wz1: tz, h0: h, h1: h, w: dist, near: lead, back });
    wx = tx; wz = tz;
  };
  // Each leg to its end, the driver (not the wheels) coming to it: pushed ahead, or a short way
  // back the way the driver faces away from, drawn after them, backing (in the bed, too narrow to
  // turn it round in). At a corner it is turned on its wheels, out ahead of the driver, who swings
  // out round them, away from what the way goes round (the truck's corner, say).
  // (Drawn backwards only for a short run all told: further, it is turned round where it starts
  // and pushed, not drawn on and on, to be turned at last somewhere with no room.)
  let runLen = 0;
  for (let k = 0, qx = x, qz = z; k < pts.length; k++) { runLen += Math.hypot(pts[k][0] - qx, pts[k][2] - qz); qx = pts[k][0]; qz = pts[k][2]; }
  let px = x, pz = z;
  for (let k = 0; k < pts.length; k++) {
    const p1 = pts[k], d = Math.hypot(p1[0] - px, p1[2] - pz), lastLeg = k === pts.length - 1;
    const dir = d > 0.05 ? Math.atan2(-(p1[2] - pz), p1[0] - px) : h;
    // (Back the way the driver faces away from: drawn after them, a short way. Where there is no
    // room to turn it round (at the bed's front wall, say), drawn back first until there is.)
    // (Up off the ground, in the bed or out of it onto a dock, drawn back a leg at a time: there is
    // no room to turn it round in there.)
    const up = p1[1] > 0.5 && (k ? pts[k - 1][1] : y0) > 0.5;
    let back = !forward && d > 0.05 && Math.abs(wrap(dir - h)) > BACK_TURN && d <= BACK_LEN && (runLen <= BACK_LEN || up);
    if (!forward && !back && d > 0.05 && Math.abs(wrap(dir - h)) > BACK_TURN && !room(dir)) {
      const [ux, uz] = fw(dir), x0 = wx, z0 = wz;
      for (let sb = 0.25; sb < d - 0.3; sb += 0.25) {
        wx = x0 + ux * sb; wz = z0 + uz * sb;
        if (room(dir)) { const tx = wx, tz = wz; wx = x0; wz = z0; roll(tx, tz, true); break; }
        wx = x0; wz = z0;
      }
    }
    // (The last leg, to face the way the next chore wants: rolled forwards if that is the way it
    // goes, backwards if the other.)
    if (lastLeg && !Number.isNaN(face) && d > 0.05) back = Math.abs(wrap(dir - face)) > Math.PI / 2;
    const hd = lastLeg && !Number.isNaN(face) ? face : back ? dir + Math.PI : dir, [fx, fz] = fw(hd);
    if (lastLeg && !Number.isNaN(face) && !back) {
      // (Into a doorway, say, coming at it at an angle: the wheels square to it first, so they
      // never cut across beside it, then straight on in. Squared SQUARE_RUN short of their end
      // where that is clear, for a corner wide enough to round; else just short of the spot.)
      for (const q0 of [lead - SQUARE_RUN, Math.min(lead, 0.3)]) {
        const qx = p1[0] + fx * q0, qz = p1[2] + fz * q0;
        if ((qx - wx) * fx + (qz - wz) * fz <= 0.05 || Math.abs(wrap(Math.atan2(-(qz - wz), qx - wx) - face)) <= 0.4) continue;   // (only with it still ahead)
        // (The driver behind the wheels there, the way they come to it.)
        const qd = Math.hypot(qx - wx, qz - wz) || 1;
        if (q0 < 0.3 && !(clear(qx, qz) && clear(qx - (qx - wx) / qd * lead, qz - (qz - wz) / qd * lead))) continue;
        roll(qx, qz, false);
        break;
      }
    }
    // (At a corner, the wheels on past it no further than they stay clear: not into the truck's
    // side, where the way turns along it.)
    // (Before a leg up off the ground, the walk ramp: the wheels no further than the corner, so
    // the way up starts square on its line, the ramp's middle.)
    let o = !lastLeg && p1[1] < 0.3 && pts[k + 1][1] > 0.5 ? 0 : lead;
    if (!lastLeg && o > 0) {
      const ok = (r: number) => { for (let i = 1; i <= 8; i++) { const f = i / 8, x1 = p1[0] + fx * r, z1 = p1[2] + fz * r; if (!clear(wx + (x1 - wx) * f, wz + (z1 - wz) * f)) return false; } return true; };
      while (o > 0.05 && !ok(o)) o -= 0.15;
      o = Math.max(0, o);
    }
    roll(p1[0] + fx * o, p1[2] + fz * o, back);
    px = p1[0]; pz = p1[2];
  }
  if (!Number.isNaN(face)) turn(face);
  const rounded = roundCorners(parts, lead, clear);
  const segs: WheelWalk["segs"] = [];
  for (let i = 0; i < rounded.length; i++) {
    const p = rounded[i], prev = rounded[i - 1], s = segs[segs.length - 1];
    if (s && p.kind !== "turn" && prev.kind !== "turn" && !!p.back === !!prev.back) { s.i1 = i; s.w += p.w; }
    else segs.push({ i0: i, i1: i, w: p.w });
  }
  return { lead, parts: rounded, total: rounded.reduce((s, p) => s + p.w, 0), segs, dur: 1 };
}
// Each turn on the spot between two rolls the same way, made an arc where one fits: the rolls
// either side cut short by as much as the arc takes (no more than half of either, so the next
// corner has its share), the driver and the wheels clear all through it.
function roundCorners(parts: WheelPart[], lead: number, clear: (x: number, z: number) => boolean): WheelPart[] {
  const out = parts.map((p) => ({ ...p }));
  for (let i = 1; i < out.length - 1; i++) {
    const a = out[i - 1], t = out[i], b = out[i + 1];
    if (t.kind !== "turn" || a.kind !== "roll" || b.kind !== "roll" || !!a.back !== !!b.back) continue;
    const d = t.h1 - t.h0;
    if (Math.abs(d) > 2.8 || Math.abs(d) < 0.03) continue;
    const la = Math.hypot(a.wx1 - a.wx0, a.wz1 - a.wz0), lb = Math.hypot(b.wx1 - b.wx0, b.wz1 - b.wz0);
    // (The way the wheels travel in and out: the heading, or backwards, the other way.)
    const th0 = a.h0 + (a.back ? Math.PI : 0), th1 = th0 + d, sg = Math.sign(d);
    const ux0 = Math.cos(th0), uz0 = -Math.sin(th0), ux1 = Math.cos(th1), uz1 = -Math.sin(th1);
    for (const R of ARC_R) {
      const T = R * Math.tan(Math.abs(d) / 2);
      if (T > 0.5 * la || T > 0.5 * lb) continue;
      const sx = t.wx0 - ux0 * T, sz = t.wz0 - uz0 * T, ex = t.wx0 + ux1 * T, ez = t.wz0 + uz1 * T;
      const cx = sx + Math.cos(th0 + sg * Math.PI / 2) * R, cz = sz - Math.sin(th0 + sg * Math.PI / 2) * R, a0 = th0 - sg * Math.PI / 2;
      let ok = true;
      for (let k = 0; k <= 10 && ok; k++) {
        const q = a0 + d * k / 10, h = t.h0 + d * k / 10, px = cx + Math.cos(q) * R, pz = cz - Math.sin(q) * R;
        ok = clear(px, pz) && clear(px - Math.cos(h) * lead, pz + Math.sin(h) * lead);
      }
      if (!ok) continue;
      a.wx1 = sx; a.wz1 = sz; a.w = la - T;
      b.wx0 = ex; b.wz0 = ez; b.w = lb - T;
      out[i] = { kind: "arc", wx0: sx, wz0: sz, wx1: ex, wz1: ez, h0: t.h0, h1: t.h1, w: Math.hypot(R, lead) * Math.abs(d), near: lead, back: a.back, cx, cz, a0, rr: R };   // (w: the driver's way round, behind the wheels, a little wider than theirs)
      break;
    }
  }
  return out;
}
// The driver (x, z), their facing, and how far ahead the wheels are, at u through a hand truck's
// walk: each movement (WheelWalk.segs) eased in and out as one, a turn on the spot on its own.
function wheelAt(m: WheelWalk, u: number): [number, number, number, number] {
  if (!m.parts.length) return [NaN, NaN, NaN, m.lead];
  let at = u * m.total, sg = m.segs[0];
  for (const q of m.segs) { sg = q; if (at <= q.w) break; at -= q.w; }
  // (Through the movement, by its time: eased in over EASE_T, at an even pace, eased out.)
  const f = sg.w > 1e-6 ? Math.min(1, Math.max(0, at / sg.w)) : 1;
  let s = sg.i0 === sg.i1 && m.parts[sg.i0].kind === "turn" ? sg.w * jackEase(f) : sg.w * evenPace(f, Math.min(1 / 3, EASE_T / Math.max(1e-3, m.dur * sg.w / m.total)));
  let p = m.parts[sg.i0];
  for (let i = sg.i0; i <= sg.i1; i++) { p = m.parts[i]; if (s <= p.w || i === sg.i1) break; s -= p.w; }
  const v = p.w > 1e-6 ? Math.min(1, Math.max(0, s / p.w)) : 1, k = v;
  const h = p.h0 + (p.h1 - p.h0) * k;
  let wx: number, wz: number;
  if (p.kind === "arc") { const q = p.a0! + (p.h1 - p.h0) * k; wx = p.cx! + Math.cos(q) * p.rr!; wz = p.cz! - Math.sin(q) * p.rr!; }
  else { wx = p.wx0 + (p.wx1 - p.wx0) * k; wz = p.wz0 + (p.wz1 - p.wz0) * k; }
  const r = m.lead - (m.lead - p.near) * Math.sin(Math.PI * v);
  return [wx - Math.cos(h) * r, wz + Math.sin(h) * r, h, r];
}
// How far through a movement at f of its time (both 0..1): its pace eased up from a stand over the
// first `a` of the time and back down over the last, smoothly, and even between.
function evenPace(f: number, a: number) {
  const I = (x: number) => x * x * x - x * x * x * x / 2;   // (the smoothstep's integral)
  const total = 1 - a;
  if (a <= 0) return f;
  if (f < a) return a * I(f / a) / total;
  if (f > 1 - a) return 1 - a * I((1 - f) / a) / total;
  return (a / 2 + (f - a)) / total;
}

// How much of the way about sample i goes along the facing (along, 0..1: side-stepping, the rest),
// and across it (lat, signed: to the right, +). Over a quarter second either side, by the ground
// each sample covers: from one sample alone, the drift as a walk comes to a stop read as
// side-stepping, and the stride narrowed at a stroke, the planted foot sliding.
function shares(P: CrewPath, i: number, out: { along: number; lat?: number }) {
  const n = P.x.length;
  let fw = 0, mm = 0, lt = 0;
  for (let j = Math.max(0, i - AVG), e = Math.min(n - 1, i + 1 + AVG); j < e; j++) {
    const mx = P.x[j + 1] - P.x[j], mz = P.z[j + 1] - P.z[j];
    fw += Math.abs(mx * Math.cos(P.yaw[j]) - mz * Math.sin(P.yaw[j])); mm += Math.hypot(mx, mz);
    lt += mx * Math.sin(P.yaw[j]) + mz * Math.cos(P.yaw[j]);
  }
  out.along = mm > 1e-5 ? Math.min(1, fw / mm) : 1;
  out.lat = mm > 1e-5 ? Math.max(-1, Math.min(1, lt / mm)) : 0;
  return out;
}

// The path at time t (seconds into the plan): x, z, yaw, steps taken so far, ground covered (both
// counting back when walking backwards), speed (m/s), how much of the move is along the facing
// (along, 0..1), and a pallet jack's steering wheel and
// heading (jx, jz, jyaw; NaN with none in hand).
export function samplePath(P: CrewPath, t: number, out: { x: number; z: number; yaw: number; steps: number; gait?: number; travel: number; lat?: number; speed: number; along: number; jx: number; jz: number; jyaw: number; lead?: number }) {
  const f = Math.max(0, t * P.rate), n = P.x.length, i = Math.min(n - 2, Math.floor(f)), k = Math.min(1, f - i);
  out.x = P.x[i] + (P.x[i + 1] - P.x[i]) * k;
  out.z = P.z[i] + (P.z[i + 1] - P.z[i]) * k;
  out.yaw = P.yaw[i] + wrap(P.yaw[i + 1] - P.yaw[i]) * k;
  out.steps = P.steps[i] + (P.steps[i + 1] - P.steps[i]) * k;
  out.travel = P.travel[i] + (P.travel[i + 1] - P.travel[i]) * k;
  out.gait = P.gait[i] + (P.gait[i + 1] - P.gait[i]) * k;
  out.speed = Math.abs(P.steps[i + 1] - P.steps[i]) * P.rate;
  shares(P, i, out);
  out.lead = Number.isNaN(P.lead[i]) || Number.isNaN(P.lead[i + 1]) ? (Number.isNaN(P.lead[i]) ? P.lead[i + 1] : P.lead[i]) : P.lead[i] + (P.lead[i + 1] - P.lead[i]) * k;
  out.jx = P.jx[i] + (P.jx[i + 1] - P.jx[i]) * k;
  out.jz = P.jz[i] + (P.jz[i + 1] - P.jz[i]) * k;
  out.jyaw = P.jyaw[i] + wrap(P.jyaw[i + 1] - P.jyaw[i]) * k;
  if (Number.isNaN(out.jx)) { const j = Number.isNaN(P.jx[i]) ? i + 1 : i; out.jx = P.jx[j]; out.jz = P.jz[j]; out.jyaw = P.jyaw[j]; }   // (picked up or let go between samples: the one there is)
  return out;
}
