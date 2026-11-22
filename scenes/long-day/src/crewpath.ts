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
// A pallet jack (Hold.tip) is steered rather than carried: it rolls only along itself, never
// sideways, and turns on the spot about its middle (its steering wheel turned across), so it
// gets round tight corners; the driver, on its handle at the steering end, walks round it as
// it turns (the handle swivels, and straightens as they go). Its middle goes for the point on
// the way ahead where it should be. Drawn backwards, the driver leads, and the jack trails
// them like a trailer.
import type { Chore } from "./chores.ts";

// What the driver holds during a chore, for turning: how far ahead of the feet its weight is,
// how much of a turn goes about that point rather than the driver (0..1), and how briskly the
// driver turns (a spring's rate, 1/s, and the most rad/s).
// A pallet jack's `tip`: the middle it turns about, this far on from its steering wheel, which
// is `lead` ahead of the feet (its `rate` then: the most rad/s it turns).
// `square`: in the truck's bed, where it is kept square to the bed (heading 0 or PI), rolled
// along it, edging across no more steeply than SQUARE.
// `from`: where it is when taken in hand (its steering wheel, its heading), if not straight out
// ahead of the driver; `tips`: its fork tips, this far on from the steering wheel, about which it
// is turned while well off square in the bed (lying across it, the handle's end swung back into
// the aisle).
export interface Hold { lead: number; pivot: number; omega: number; rate: number; tip?: number; square?: boolean; from?: { x: number; z: number; yaw: number }; tips?: number }
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
const JACK_V = 2.4;           // a pallet jack rolls no faster than this (m/s)
const TILLER = 0.5;           // and its handle straightens behind it with this time constant (s), going along
const SQUARE = 0.3;           // in the bed, kept square to it, or no more than this off (rad)
const LINED_UP = 0.3;         // it rolls on only once turned within this of the way (rad), the less the further off
const NEAR = 0.08;            // (this near where it should be: just turning the jack to its facing)

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
  // A pallet jack's middle follows the walk itself, from walk i on (on past the last one's end):
  // where along it (m from its start) a point is nearest, and the point that far along.
  const route = (i: number, px: number, pz: number) => {
    let best = Infinity, at = 0, s0 = 0;
    for (let k = i; k < plan.length && k < i + 8 && isWalk(plan[k]); k++) {
      const a = plan[k].a!, b = plan[k].b!, dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
      const t = len > 1e-6 ? Math.max(k === i ? -Infinity : 0, ((px - a[0]) * dx + (pz - a[2]) * dz) / len) : 0;
      const last = !isWalk(plan[k + 1]), tt = last ? t : Math.min(len, t);
      const d = len > 1e-6 ? Math.hypot(a[0] + dx / len * tt - px, a[2] + dz / len * tt - pz) : Math.hypot(a[0] - px, a[2] - pz);
      if (d < best - 1e-6) { best = d; at = s0 + tt; }
      s0 += len;
    }
    return at;
  };
  const routeAt = (i: number, d: number) => {
    let k = i;
    for (; ; k++) {
      const a = plan[k].a!, b = plan[k].b!, len = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (d <= len || !isWalk(plan[k + 1]) || k >= i + 7) { const f = len > 1e-6 ? d / len : 0; pt[0] = a[0] + (b[0] - a[0]) * f; pt[1] = a[2] + (b[2] - a[2]) * f; return pt; }
      d -= len;
    }
  };
  const FOLLOW = 0.7;   // (the jack aims this far on along it from where it is)
  let ci = 0, x = 0, z = 0, yaw = yaw0, v = 0, ex = 0, ez = 0, steps = 0, first = true, back = false, entered = -1, travel = 0, dir = 1;
  let jack = false, rx = 0, rz = 0, jth = 0, turnSign = 0;   // a pallet jack in hand: its middle, its heading, which way it is turning
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
    if (h.tip) {
      // A pallet jack: where its middle should be, the way on along the walk (straight on down a
      // ramp, or backing) or ahead of the spot the chore stands the driver at.
      const reach = h.lead + h.tip;
      // (Kept square, it stays the way it lies, and the driver goes the way they must behind it.)
      const sq = jack && h.square ? (Math.abs(wrap(jth)) < Math.PI / 2 ? 0 : Math.PI) : target;
      let gx = nm.x + Math.cos(sq) * reach, gz = nm.z - Math.sin(sq) * reach;
      if (isWalk(c) && !back && !c.noTurn && !h.square && Number.isNaN(nm.yaw)) {
        // (Along the way: on from where it is, but no further on than `reach` ahead of
        // where the driver should be.)
        const due = u * Math.hypot(c.b![0] - c.a![0], c.b![2] - c.a![2]) + reach, at = route(ci, rx, rz);
        routeAt(ci, Math.min(due, at + FOLLOW)); gx = pt[0]; gz = pt[1];
      }
      if (!jack) {
        jack = true; jth = h.from ? h.from.yaw : yaw;
        rx = h.from ? h.from.x + Math.cos(jth) * h.tip : x + Math.cos(yaw) * reach; rz = h.from ? h.from.z - Math.sin(jth) * h.tip : z - Math.sin(yaw) * reach;
      }
      if (back) {
        // Drawn backwards: the driver goes their way (as without it), the handle's end follows
        // them and the jack trails it, a trailer behind a trailer.
        const k = Math.exp(-dt / (nm.exact ? CATCH_EXACT : CATCH));
        ex *= k; ez *= k;
        nx = nm.x + ex; nz = nm.z + ez;
        let wx = rx - Math.cos(jth) * h.tip, wz = rz + Math.sin(jth) * h.tip;
        let ux = wx - nx, uz = wz - nz, um = Math.hypot(ux, uz) || 1;
        wx = nx + ux / um * h.lead; wz = nz + uz / um * h.lead;
        ux = rx - wx; uz = rz - wz; um = Math.hypot(ux, uz) || 1;
        rx = wx + ux / um * h.tip; rz = wz + uz / um * h.tip;
        jth = Math.atan2(-(rz - wz), rx - wx);
        const y1 = Math.atan2(-(wz - nz), wx - nx);
        dy = wrap(y1 - yaw); yaw = y1; v = dy / dt;
        P.jx[s] = wx; P.jz[s] = wz; P.jyaw[s] = jth;
      } else {
      // Walking, turned towards there about its middle (drawn backwards, away from it), then
      // rolled along itself; at a chore's spot, turned to its facing and rolled to and fro.
      const qx = gx - rx, qz = gz - rz, far = Math.hypot(qx, qz);
      let want = target;
      if (isWalk(c) && far > NEAR) want = Math.atan2(-qz, qx) + (back ? Math.PI : 0);
      if (h.square) {
        // (No more than a little off square, to edge across, whether it is rolled forwards or back.)
        let off = isWalk(c) && far > NEAR ? wrap(want - sq) : 0;
        if (Math.abs(off) > Math.PI / 2) off = wrap(off + Math.PI);
        want = sq + Math.max(-SQUARE, Math.min(SQUARE, off));
      }
      let off = wrap(want - jth);
      if (Math.abs(off) > 2.8 && turnSign) off = turnSign * Math.abs(off);   // (half way round: on round the way it is going)
      turnSign = Math.abs(off) > 0.02 ? Math.sign(off) : 0;
      const turn = Math.max(-h.rate * dt, Math.min(h.rate * dt, off));
      if (h.square && h.tips && Math.abs(wrap(jth - (Math.abs(wrap(jth)) < Math.PI / 2 ? 0 : Math.PI))) > 0.5) {
        // (Well off square in the bed: about its fork tips.)
        const tx = rx + Math.cos(jth) * (h.tips - h.tip), tz = rz - Math.sin(jth) * (h.tips - h.tip);
        jth += turn; rx = tx - Math.cos(jth) * (h.tips - h.tip); rz = tz + Math.sin(jth) * (h.tips - h.tip);
      } else jth += turn;
      const ax = Math.cos(jth), az = -Math.sin(jth);
      const roll = Math.max(-JACK_V * dt, Math.min(JACK_V * dt, qx * ax + qz * az)) * Math.max(0, 1 - Math.abs(wrap(want - jth)) / LINED_UP);   // (turned first, then pushed)
      rx += ax * roll; rz += az * roll;
      // The driver on the handle behind its steering wheel, as they were, the handle straightening.
      const wx = rx - ax * h.tip, wz = rz - az * h.tip;
      let ux = x - wx, uz = z - wz, um = Math.hypot(ux, uz);
      if (um < 1e-6) { ux = -ax; uz = -az; um = 1; }
      const kt = 1 - Math.exp(-dt / TILLER);
      ux = ux / um * (1 - kt) - ax * kt; uz = uz / um * (1 - kt) - az * kt; um = Math.hypot(ux, uz) || 1;
      nx = wx + ux / um * h.lead; nz = wz + uz / um * h.lead;
      const y1 = Math.atan2(-(wz - nz), wx - nx);
      dy = wrap(y1 - yaw); yaw = y1; v = dy / dt;
      ex = nx - nm.x; ez = nz - nm.z;   // (and when it is let go, the driver goes back to the path from there)
      P.jx[s] = wx; P.jz[s] = wz; P.jyaw[s] = jth;
      }
    } else {
      jack = false;
      // Turn: a critically damped spring, no faster than the load allows.
      const err = wrap(target - yaw), acc = h.omega * h.omega * err - 2 * h.omega * v;
      v = Math.max(-h.rate, Math.min(h.rate, v + acc * dt));
      dy = v * dt;
      const y1 = yaw + dy;
      // About the load: the driver steps round it, and so ends up off the path for a moment.
      if (h.pivot > 0 && h.lead > 0) {
        const px = x + Math.cos(yaw) * h.lead, pz = z - Math.sin(yaw) * h.lead;
        ex += (px - Math.cos(y1) * h.lead - x) * h.pivot; ez += (pz + Math.sin(y1) * h.lead - z) * h.pivot;
      }
      yaw = y1;
      const k = Math.exp(-dt / (nm.exact ? CATCH_EXACT : CATCH));
      ex *= k; ez *= k;
      const m = Math.hypot(ex, ez); if (m > 1.5) { ex *= 1.5 / m; ez *= 1.5 / m; }
      nx = nm.x + ex; nz = nm.z + ez;
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
