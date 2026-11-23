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
// A pallet jack's moves are planned (jackplan.ts, Chore.jack): it and the driver on its handle are
// placed from them exactly, and between them it stays where they left it. (A walk with it that
// wasn't planned, rarely: held straight out ahead of the driver.)
import type { Chore } from "./chores.ts";
import { jackDriverAt, jackEase, jackPoseAt, jackWheel } from "./jackplan.ts";

// What the driver holds during a chore, for turning: how far ahead of the feet its weight is,
// how much of a turn goes about that point rather than the driver (0..1), and how briskly the
// driver turns (a spring's rate, 1/s, and the most rad/s).
// A pallet jack's `tip`: its middle, this far on from its steering wheel, which is `lead` ahead
// of the feet.
export interface Hold { lead: number; pivot: number; omega: number; rate: number; tip?: number }
export const EMPTY_HOLD: Hold = { lead: 0, pivot: 0, omega: 9, rate: 7 };

// Where a chore puts the driver at progress u (truck frame), the facing it wants (NaN: whatever
// the driver has), and whether that spot is exact (the door, the ramp's end, the cab steps:
// any drift from a turn is taken up quickly there).
export interface Nominal { x: number; z: number; yaw: number; exact: boolean }

// (jx, jz, jyaw: a pallet jack in hand, its steering wheel and heading; NaN when there is none.)
export interface CrewPath { rate: number; x: Float32Array; z: Float32Array; yaw: Float32Array; steps: Float32Array; travel: Float32Array; jx: Float32Array; jz: Float32Array; jyaw: Float32Array; starts: number[] }

const RATE = 30;              // samples a second
const LOOK = 0.9;             // walking, the driver heads for the path this far ahead (m)
const PRE_TURN = 0.55;        // and turns to face the next chore's way over its last this many seconds
const CATCH = 0.45, CATCH_EXACT = 0.12;   // the time constant of catching up with the path (s)
const BACK_TURN = 2.2, BACK_LEN = 3.2;    // walked backwards: a walk this far round from the facing, no longer than this

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

// `nominal(c, u)`: the chore's spot and facing; `hold(c, u)`: what is in hand; `yaw0`: the facing
// as the plan starts.
export function buildCrewPath(plan: Chore[], nominal: (c: Chore, u: number) => Nominal, hold: (c: Chore, u: number) => Hold, yaw0: number): CrewPath {
  const starts: number[] = [];
  let total = 0;
  for (const c of plan) { starts.push(total); total += c.len; }
  const n = Math.max(2, Math.ceil(total * RATE) + 2), dt = 1 / RATE;
  const P: CrewPath = { rate: RATE, x: new Float32Array(n), z: new Float32Array(n), yaw: new Float32Array(n), steps: new Float32Array(n), travel: new Float32Array(n), jx: new Float32Array(n).fill(NaN), jz: new Float32Array(n).fill(NaN), jyaw: new Float32Array(n).fill(NaN), starts };
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
  for (let s = 0; s < n; s++) {
    const t = Math.min(s * dt, total - 1e-6);
    while (ci < plan.length - 1 && t >= starts[ci + 1]) ci++;
    const c = plan[ci], u = Math.min(1, Math.max(0, (t - starts[ci]) / c.len));
    const nm = nominal(c, u), h = hold(c, u);
    if (entered !== ci) {
      // Into a new chore: a walk back the way the driver faces away from, holding something, is
      // walked backwards.
      entered = ci; back = false;
      if (isWalk(c) && h.pivot > 0 && !c.round) {
        const dx = c.b![0] - c.a![0], dz = c.b![2] - c.a![2], len = Math.hypot(dx, dz);
        const off = Math.abs(wrap(Math.atan2(-dz, dx) - yaw));
        back = len > 0.05 && !c.forward && (c.noTurn ? off > Math.PI / 2 : len <= BACK_LEN && off > BACK_TURN);
      }
    }
    let target = nm.yaw;
    if (back) { const a = c.a!, b = c.b!; target = Math.atan2(-(b[2] - a[2]), b[0] - a[0]) + Math.PI; }
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
    if (c.jack) {
      // A pallet jack's planned move (jackplan.ts): the jack and the driver just as planned, eased
      // in and out; the driver facing the handle's end, and the jack's state carried on for
      // whatever comes next.
      const e = jackEase(u), p = jackPoseAt(c.jack, e), [wx, wz] = jackWheel(p), [dx, dz] = jackDriverAt(c.jack, e);
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
  return P;
}

// The path at time t (seconds into the plan): x, z, yaw, steps taken so far, ground covered (both
// counting back when walking backwards), speed (m/s), how much of the move is along the facing
// (along, 0..1), and a pallet jack's steering wheel and
// heading (jx, jz, jyaw; NaN with none in hand).
export function samplePath(P: CrewPath, t: number, out: { x: number; z: number; yaw: number; steps: number; travel: number; speed: number; along: number; jx: number; jz: number; jyaw: number }) {
  const f = Math.max(0, t * P.rate), n = P.x.length, i = Math.min(n - 2, Math.floor(f)), k = Math.min(1, f - i);
  out.x = P.x[i] + (P.x[i + 1] - P.x[i]) * k;
  out.z = P.z[i] + (P.z[i + 1] - P.z[i]) * k;
  out.yaw = P.yaw[i] + wrap(P.yaw[i + 1] - P.yaw[i]) * k;
  out.steps = P.steps[i] + (P.steps[i + 1] - P.steps[i]) * k;
  out.travel = P.travel[i] + (P.travel[i + 1] - P.travel[i]) * k;
  out.speed = Math.abs(P.steps[i + 1] - P.steps[i]) * P.rate;
  // (How much of the way goes along the facing, 0..1: side-stepping, the rest.)
  const mx = P.x[i + 1] - P.x[i], mz = P.z[i + 1] - P.z[i], mm = Math.hypot(mx, mz);
  out.along = mm > 1e-5 ? Math.abs(mx * Math.cos(out.yaw) - mz * Math.sin(out.yaw)) / mm : 1;
  out.jx = P.jx[i] + (P.jx[i + 1] - P.jx[i]) * k;
  out.jz = P.jz[i] + (P.jz[i + 1] - P.jz[i]) * k;
  out.jyaw = P.jyaw[i] + wrap(P.jyaw[i + 1] - P.jyaw[i]) * k;
  if (Number.isNaN(out.jx)) { const j = Number.isNaN(P.jx[i]) ? i + 1 : i; out.jx = P.jx[j]; out.jz = P.jz[j]; out.jyaw = P.jyaw[j]; }   // (picked up or let go between samples: the one there is)
  return out;
}
