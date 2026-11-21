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
import type { Chore } from "./chores.ts";

// What the driver holds during a chore, for turning: how far ahead of the feet its weight is,
// how much of a turn goes about that point rather than the driver (0..1), and how briskly the
// driver turns (a spring's rate, 1/s, and the most rad/s).
export interface Hold { lead: number; pivot: number; omega: number; rate: number }
export const EMPTY_HOLD: Hold = { lead: 0, pivot: 0, omega: 9, rate: 7 };

// Where a chore puts the driver at progress u (truck frame), the facing it wants (NaN: whatever
// the driver has), and whether that spot is exact (the door, the ramp's end, the cab steps:
// any drift from a turn is taken up quickly there).
export interface Nominal { x: number; z: number; yaw: number; exact: boolean }

export interface CrewPath { rate: number; x: Float32Array; z: Float32Array; yaw: Float32Array; steps: Float32Array; travel: Float32Array; starts: number[] }

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
  const P: CrewPath = { rate: RATE, x: new Float32Array(n), z: new Float32Array(n), yaw: new Float32Array(n), steps: new Float32Array(n), travel: new Float32Array(n), starts };
  const isWalk = (c?: Chore) => !!c && c.kind === "walk";
  // Walking: the point LOOK metres on along this walk and the ones straight after it (on past the
  // last one's end), and the direction to it from (x, z).
  const ahead = (i: number, u: number, x: number, z: number) => {
    let c = plan[i], ax = c.a![0] + (c.b![0] - c.a![0]) * u, az = c.a![2] + (c.b![2] - c.a![2]) * u, left = LOOK;
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
    return Math.hypot(ax - x, az - z) > 1e-4 ? Math.atan2(-(az - z), ax - x) : NaN;
  };
  let ci = 0, x = 0, z = 0, yaw = yaw0, v = 0, ex = 0, ez = 0, steps = 0, first = true, back = false, entered = -1, travel = 0;
  for (let s = 0; s < n; s++) {
    const t = Math.min(s * dt, total - 1e-6);
    while (ci < plan.length - 1 && t >= starts[ci + 1]) ci++;
    const c = plan[ci], u = Math.min(1, Math.max(0, (t - starts[ci]) / c.len));
    const nm = nominal(c, u), h = hold(c, u);
    if (entered !== ci) {
      // Into a new chore: a walk back the way the driver faces away from, holding something, is
      // walked backwards.
      entered = ci; back = false;
      if (isWalk(c) && h.pivot > 0) {
        const dx = c.b![0] - c.a![0], dz = c.b![2] - c.a![2], len = Math.hypot(dx, dz);
        const off = Math.abs(wrap(Math.atan2(-dz, dx) - yaw));
        back = len > 0.05 && (c.noTurn ? off > Math.PI / 2 : len <= BACK_LEN && off > BACK_TURN);
      }
    }
    let target = nm.yaw;
    if (back) { const a = c.a!, b = c.b!; target = Math.atan2(-(b[2] - a[2]), b[0] - a[0]) + Math.PI; }
    else if (c.noTurn) { const a = c.a!, b = c.b!; target = Math.atan2(-(b[2] - a[2]), b[0] - a[0]); }   // (straight on, not turning early for what comes next)
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
    // Turn: a critically damped spring, no faster than the load allows.
    const err = wrap(target - yaw), acc = h.omega * h.omega * err - 2 * h.omega * v;
    v = Math.max(-h.rate, Math.min(h.rate, v + acc * dt));
    const dy = v * dt, y1 = yaw + dy;
    // About the load: the driver steps round it, and so ends up off the path for a moment.
    if (h.pivot > 0 && h.lead > 0) {
      const px = x + Math.cos(yaw) * h.lead, pz = z - Math.sin(yaw) * h.lead;
      ex += (px - Math.cos(y1) * h.lead - x) * h.pivot; ez += (pz + Math.sin(y1) * h.lead - z) * h.pivot;
    }
    yaw = y1;
    const k = Math.exp(-dt / (nm.exact ? CATCH_EXACT : CATCH));
    ex *= k; ez *= k;
    const m = Math.hypot(ex, ez); if (m > 1.5) { ex *= 1.5 / m; ez *= 1.5 / m; }
    const nx = nm.x + ex, nz = nm.z + ez;
    const moved = Math.hypot(nx - x, nz - z);
    steps += (back ? -1 : 1) * (moved + Math.abs(dy) * 0.22);
    travel += (back ? -1 : 1) * moved;   // (the ground covered alone: what rolls a drum)   // (turning on the spot takes steps too; backwards, the cycle runs back)
    x = nx; z = nz;
    P.x[s] = x; P.z[s] = z; P.yaw[s] = yaw; P.steps[s] = steps; P.travel[s] = travel;
  }
  return P;
}

// The path at time t (seconds into the plan): x, z, yaw, steps taken so far, ground covered (both
// counting back when walking backwards), and speed (m/s).
export function samplePath(P: CrewPath, t: number, out: { x: number; z: number; yaw: number; steps: number; travel: number; speed: number }) {
  const f = Math.max(0, t * P.rate), n = P.x.length, i = Math.min(n - 2, Math.floor(f)), k = Math.min(1, f - i);
  out.x = P.x[i] + (P.x[i + 1] - P.x[i]) * k;
  out.z = P.z[i] + (P.z[i + 1] - P.z[i]) * k;
  out.yaw = P.yaw[i] + wrap(P.yaw[i + 1] - P.yaw[i]) * k;
  out.steps = P.steps[i] + (P.steps[i + 1] - P.steps[i]) * k;
  out.travel = P.travel[i] + (P.travel[i + 1] - P.travel[i]) * k;
  out.speed = Math.abs(P.steps[i + 1] - P.steps[i]) * P.rate;
  return out;
}
