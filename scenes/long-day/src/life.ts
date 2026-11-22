// Street life as part of the journey: traffic, pedestrians, birds and the blimp step with the
// journey's fixed clock (Journey.life), from a random stream seeded by each city, and are saved
// in its keyframes. So any moment looks the same however it was reached, scrubbing included.
// The truck is a road user in it: it books junctions as the cars do, and the journey's driving asks
// street life where to stop (truckStop, reverseBlocked), so the two replay together.
import { hash2 } from "./rng.ts";
import { SPECS, TRAILER, truckExtents, truckLayout } from "./truck.ts";
import { KINGPIN_TO_AXLES } from "./hitch.ts";
import type { Path, Pose } from "./route.ts";
import { Journey } from "./journey.ts";
import type { LifeHook } from "./journey.ts";
import { Traffic, truckObstacles } from "./traffic.ts";
import type { Obstacle } from "./traffic.ts";
import { Crowd } from "./crowd.ts";
import type { KerbParked } from "./vignettes.ts";
import { Ambient } from "./ambient.ts";
import { DEBUG_BLOCK } from "./debug.ts";
import { RAMP_HOLD, RAMP_LINEUP } from "./chores.ts";

// m/s: a vehicle beside the truck going slower than this, or than the truck, is one it waits for if
// its body would come into it (truckStop): standing, coming to a stop, or one it would close on
// moving over into its lane (one coming to a stop for a light ahead of it doesn't drop back).
const SLOW_BESIDE = 2;
// How far ahead the truck looks along the way of a car moving its way, for one easing over into its
// lane in front of it (s; truckStop), and how finely it looks at its way near its nose (m, the first
// FINE_NEAR m) so that where it stops short of something comes on smoothly, not a metre at a time.
const CUT_IN_LOOK = 1.5, FINE_STEP = 0.25, FINE_NEAR = 4;
const MOVE_LOOK = 1;   // s: how far ahead it looks at where those on foot and vehicles about are going (truckStop)
const CAR_BRAKE = 5;   // m/s^2: the hardest a car ahead could brake (how far one pulling away would still go: truckStop)
export class StreetLife implements LifeHook {
  private obs: Obstacle[] = [];
  private spare: Pose = { x: 0, z: 0, h: 0, k: 0 };
  private setDown = "";   // (the other truck where it was last set down: dropInside)
  private busy = new Set<string>();
  private truckPath = { path: null as unknown as Path, s: 0, v: 0, front: 0, rear: 0, yaw: 0, fw: undefined as number | undefined };
  private truckGate = { node: 0, street: 0 };
  private extents = new Map<string, ReturnType<typeof truckExtents>>();   // (per model: truckExtents makes a new object each call)
  private landing = { path: null as unknown as Path, s0: 0, s1: 0, at: 0 };
  // Where the truck pulling out of a dock bay is to wait for a gap in the traffic it joins (its rear
  // axle's s), or null: its nose 3 m short of the street (or where it stands, if that is past), as
  // a driver pulls up to the street and looks; with the street clear for 6 s there, it goes, and
  // after 15 s of waiting it noses out and the traffic stops for it. (From the traffic as it
  // stands: the same played on as when scrubbed to.)
  private outWait(j: Journey): number | null {
    const st = j.st, out = st.mode === "drive" && j.path ? j.path.dockOut : 0;
    if (!(out > 0) || st.redWait >= 15) return null;
    let E = this.extents.get(st.truck);
    if (!E) this.extents.set(st.truck, (E = truckExtents(st.truck)));
    const at = out - E.front - 3;
    if ((st.s > at + 0.5 && st.v > 0.3) || st.s + E.front > out) return null;   // (out already, or too close to stop)
    if (at - st.s > 25) return null;                  // (nowhere near yet)
    const q = j.path!.peek(out, this.spare);
    // (Rolling already, the gap closing as it comes: where it can stop, braking firmly, short of the
    // road all the same if it can.)
    return this.traffic.gapAt(q.x, q.z, 6) ? null : Math.max(at, st.s + (st.v * st.v) / (2 * 4));
  }
  private sweep = { path: null as Path | null, obs: [] as Obstacle[], at: [] as number[] };   // (a bay path's sweep, and the s of each obstacle's pose)

  constructor(private traffic: Traffic, private crowd: Crowd, private ambient: Ambient) {}
  private carsClear = (x0: number, z0: number, x1: number, z1: number, secs: number) => this.traffic.crossingClear(x0, z0, x1, z1, secs);

  reset(j: Journey) {
    const s = j.st.citySeed;
    this.traffic.reset(Math.floor(hash2(s, 1, 0, 0x7a4f) * 2 ** 32));
    this.crowd.reset(Math.floor(hash2(s, 2, 0, 0xc40d) * 2 ** 32));
    this.ambient.resetBlimp();
  }

  step(j: Journey) {
    const st = j.st;
    // Out on the road: the town carries on behind the truck until it is well out of sight.
    if (st.mode === "country" && j.countryS > 450) { this.traffic.clear(); this.crowd.clear(); this.ambient.resetBlimp(); return; }
    // The truck, and the second truck (the spare at a swap, or the old one left parked).
    const p = j.pose, obs = this.obs;
    obs.length = 0;
    truckObstacles(st.truck, p.x, p.z, p.h, j.hitchYaw, obs);
    const truckN = obs.length;
    for (const o of obs) o.body = true;
    // Reversing into a bay: where it will be all the way in (every 2 m), as if parked there, so
    // traffic waits clear of the whole sweep (the cab swings out across the lanes) rather than
    // pull up alongside it.
    // (And so from its last 30 m pulling past the bay: traffic coming up behind waits back, rather
    // than pass it and be caught in the sweep when it starts back.)
    // (Laid once per bay path, and handed on each step from just behind the truck on.)
    const ahead = st.mode === "reverse" ? null : j.upcomingReverse();
    const R = st.mode === "reverse" && j.path ? j.path : ahead?.path ?? null;
    if (R) {
      const back = ahead ? ahead.backS : st.backS, W = this.sweep;
      if (W.path !== R) {
        W.path = R; W.at.length = 0; W.obs.length = 0;
        for (let s = R.length; s > back - 1; s -= 2) {
          const n0 = W.obs.length, yaw = j.reverseSweepPose(Math.max(s, back), this.spare, R);
          truckObstacles(st.truck, this.spare.x, this.spare.z, this.spare.h, yaw, W.obs);
          for (let k = n0; k < W.obs.length; k++) { W.obs[k].still = true; W.obs[k].sweep = true; W.at.push(s); }
        }
      }
      const s1 = ahead ? Infinity : st.s - 2;
      for (let k = 0; k < W.obs.length; k++) if (W.at[k] <= s1) obs.push(W.obs[k]);
    }
    // Parked at a stop (or just pulled up at one, or waiting for its next job), traffic changes
    // lanes early to pass (not at a red light).
    const parked = st.mode === "drive" && Math.abs(st.v) < 0.3 && (!j.path || st.stopS - st.s < 25);
    if (st.mode === "dwell" || parked) {
      // The walk ramp, when it is out behind the truck at a kerb stop, is in the lane too.
      const L = truckLayout(st.truck), stop = st.stops[0];
      if (L.loader === "ramp" && stop && stop.kind !== "swap" && !j.isDockStop(stop)) {
        const fx = Math.cos(p.h), fz = -Math.sin(p.h);
        // (And, while the driver is out, behind its foot, where they line up on it with a hand
        // truck and turn off it: chores.ts RAMP_LINEUP.)
        const end = L.bedRear - L.rampRun - (st.mode === "dwell" ? RAMP_HOLD + RAMP_LINEUP + 0.6 : 0.2);
        for (let a = L.bedRear - 0.6; a > end; a -= 1.0) obs.push({ x: p.x + fx * a, z: p.z + fz * a, r: 0.75 });
      }
      // A forklift unloading from the road side (crew.ts roadLegs) works in the inner lane beside
      // and behind the truck: traffic waits behind it.
      if (st.mode === "dwell" && j.stackMode === "road") {
        const fx = Math.cos(p.h), fz = -Math.sin(p.h), rx = Math.sin(p.h), rz = Math.cos(p.h);
        for (let a = L.rear - 8.5; a <= L.bedFront + 1; a += 2.2) obs.push({ x: p.x + fx * a - rx * 3, z: p.z + fz * a - rz * 3, r: 1.5 });
      }
      for (const o of obs) o.still = true;
    }
    const other = st.spare ?? st.parked?.model ?? null;
    if (other) {
      const q = st.spare ? j.sparePose(this.spare) : st.parked ? { x: st.parked.x, z: st.parked.z, h: st.parked.h } : null;
      const n0 = obs.length;
      if (q) truckObstacles(other, q.x, q.z, q.h, 0, obs);
      for (let k = n0; k < obs.length; k++) obs[k].still = true;
      // (Set down where a car already stood, the spare at a lot, say: that car is gone, turned off
      // somewhere, rather than left standing inside it. Only as it is set down: one found inside it
      // after that, standing there since, goes only out of sight (traffic.ts dropInside).)
      const key = q ? `${other}@${q.x.toFixed(1)},${q.z.toFixed(1)}` : "";
      this.traffic.dropInside(j.plan.graph, obs, n0, obs.length, key !== this.setDown, p);
      this.setDown = key;
    } else this.setDown = "";
    const prs = st.preempt ?? [];
    // For the vignettes: the truck parked at a kerb stop (its cab), and the blocks it is to stop at.
    let parkedAt: KerbParked | null = null;
    const stop0 = st.stops[0];
    if (st.mode === "dwell" && stop0 && stop0.kind !== "swap" && stop0.site && !j.isDockStop(stop0)) {
      const fx = Math.cos(p.h), fz = -Math.sin(p.h);
      let best = -Infinity;
      for (let k = 0; k < truckN; k++) { const o = obs[k], al = (o.x - p.x) * fx + (o.z - p.z) * fz; if (al > best) { best = al; parkedAt = { x: p.x, z: p.z, h: p.h, cabX: o.x, cabZ: o.z }; } }
    }
    this.busy.clear();
    for (const s of st.stops) if (s.site) this.busy.add(`${s.site.bx},${s.site.bz}`);
    // (Out of town, on the road in or just out: round the town's gate nearest the truck, all there
    // as the town comes into view. Round the truck, out there, cars and people would be set down on
    // the town's nearest streets, far from it, and be gone again the next step.)
    let tf: { x: number; z: number } = p;
    if (st.mode === "inbound" || st.mode === "country") {
      const G = j.plan.graph;
      let bd = Infinity;
      for (const g of G.gates) if (g) { const n = G.nodes[g.node], d = Math.hypot(n.x - p.x, n.z - p.z); if (d < bd) { bd = d; tf = n; } }
    }
    const cf = tf;
    // (Test renders watching one block, "block:kx,kz": the traffic round that block instead.)
    if (DEBUG_BLOCK) { const B = j.plan.graph.block(DEBUG_BLOCK[0], DEBUG_BLOCK[1]); if (B) tf = { x: B.cx, z: B.cz }; }
    // (Driving on its path, the truck has traffic give way where their ways cross. Arriving, in
    // its last 8 s before the gate, traffic gives way at the junction inside it: the truck's first.)
    // (The objects handed on are kept and refilled: no garbage on a step, as seeks replay thousands.)
    const tp = st.mode === "drive" && j.path ? this.truckPath : null;
    if (tp) { let E = this.extents.get(st.truck); if (!E) this.extents.set(st.truck, (E = truckExtents(st.truck))); tp.path = j.path!; tp.s = st.s; tp.v = st.v; tp.front = E.front; tp.rear = E.rear; tp.yaw = j.hitchYaw; tp.fw = SPECS[st.truck].fifthWheel; }
    this.crowd.step(j.plan, st.simTime, prs, cf, obs, { eye: p, cars: this.traffic.obstacles, parked: parkedAt, busy: this.busy, truckPath: tp, carsClear: this.carsClear, truckYieldsAt: this.traffic.truckYieldsAt, truckHonks: j.clearing });
    const g = st.mode === "inbound" && j.arrivalRoad.arriveDur - st.cityTime < 8 ? j.plan.graph.gates[0] : null;
    const gate = g ? this.truckGate : null;
    if (gate) { gate.node = g!.node; gate.street = g!.street; }
    // (Coming down a freeway exit ramp, which joins the streets off any junction: traffic gives way
    // where the ramp's last 15 m and the 25 m after it cross its way, from 70 m short of the foot.)
    const rp = st.mode === "drive" && j.path?.route.garageOut ? j.path.ramps[j.path.ramps.length - 1] : null;
    let landing = rp && st.s < rp.s1 + 10 && rp.s1 - st.s < 70 ? this.landing : null;
    if (landing) { landing.path = j.path!; landing.s0 = Math.max(st.s, rp!.s1 - 15); landing.s1 = rp!.s1 + 25; landing.at = rp!.s1; }
    // (Pulling out of a dock bay, swinging across the street into the kerb lane: likewise, from the
    // truck to 25 m on from where it joins the lane, until it is 10 m into it.)
    // (Before it moves off, it waits for a gap in the traffic there, as a driver pulling out does,
    // rather than have everyone stop for it; after 15 s of waiting, it noses out and they do.)
    const out = st.mode === "drive" && j.path ? j.path.dockOut : 0;
    if (!landing && this.outWait(j) === null && out > 0 && st.s < out + 10) { landing = this.landing; landing.path = j.path!; landing.s0 = st.s; landing.s1 = out + 25; landing.at = out; }
    this.traffic.step(j.plan, st.simTime, prs, tf, obs, p.h, this.crowd.obstacles, tp, gate, landing, this.crowd.crossers, this.crowd.waiters, j.clearing ? (st.mode === "reverse" ? -1 : 1) : 0, p);
    this.ambient.stepBlimp(p, st.simTime);
  }

  // Where the truck (its rear axle, on its path) is to stop, or null: short of whatever its body
  // would come to first over the next metres ahead (as far as it needs to stop easily and 10 m), with
  // 1.5 m to spare: someone crossing, or the stretch of crosswalk they have still to cross; a
  // vehicle (its circles); or where its junction booking has it wait for a car with the junction
  // before it (traffic.truckZoneStop).
  truckStop(j: Journey): number | null {
    const st = j.st, P = j.path;
    if (st.mode !== "drive" || !P) return null;
    // (Pulling out of a bay, where it waits for a gap in the traffic: and short of anything in its
    // way before that, all the same.)
    const ow = this.outWait(j);
    let E = this.extents.get(st.truck);
    if (!E) this.extents.set(st.truck, (E = truckExtents(st.truck)));
    const X = this.crowd.crossers, C = this.traffic.obstacles, reach = st.v * st.v / (2 * 2.2) + 10, pfx = Math.cos(j.pose.h), pfz = -Math.sin(j.pose.h);
    const fw = SPECS[st.truck].fifthWheel, peds = this.crowd.obstacles;
    // (Its trailer's axles, stepped on as the cab goes, dragged along the line to the kingpin: as
    // journey.ts hitchStep and truck.ts draw it.)
    let ax = 0, az = 0;
    if (fw !== undefined) { const th0 = j.pose.h + j.hitchYaw, kx0 = j.pose.x + pfx * fw, kz0 = j.pose.z + pfz * fw; ax = kx0 - Math.cos(th0) * KINGPIN_TO_AXLES; az = kz0 + Math.sin(th0) * KINGPIN_TO_AXLES; }
    // (Out of a gridlock, honking (journey.ts JAM_HONK): not waiting its turn through the junction
    // for a car booked before it, which waits there on the truck in turn; only for what is in its
    // way, which makes way, traffic.ts clearWay.)
    // (And while traffic is still making way, it waits where it is till all of it has: it never
    // comes on into one backing out of its way.)
    // (Where it can stop, braking firmly, from the speed it has: it may be pulling away already.)
    if (j.clearing && this.traffic.clearPending) return st.s + (st.v * st.v) / (2 * 4);
    const zs = j.clearing ? null : this.traffic.truckZoneStop();
    let stop = ow === null ? zs : zs === null ? ow : Math.min(ow, zs);
    // (A car moving its way, on along its own way CUT_IN_LOOK s: easing over into its lane in front
    // of it, say, or turning in ahead of it. Its circles moved on with it; seen while it begins, so the truck
    // eases off rather than coming on to stop dead once it is across its nose.)
    // (And how fast each car ahead is going its way: one pulling away, even braking as hard as it
    // could (CAR_BRAKE), would go on u² / (2 CAR_BRAKE) further, so the truck stops short of where
    // it would be: looking on to there for anything else in its way.)
    const CI = this.cutIn, VA = this.aheadV; CI.length = 0; VA.clear();
    for (const c of C) {
      if ((c.x - j.pose.x) * pfx + (c.z - j.pose.z) * pfz <= E.front + 0.5 || Math.abs(c.x - j.pose.x) > 40 || Math.abs(c.z - j.pose.z) > 40 || this.traffic.waitsForTruck(c.owner)) continue;
      const a = this.traffic.aheadOf(c.owner, CUT_IN_LOOK);
      if (!a) continue;
      // (Its heading then at least partly the truck's way: turning in ahead of it from a side street
      // too; not one coming the other way, nor one crossing, which its junction booking keeps clear.)
      if (Math.cos(a.h - j.pose.h) > 0.2) CI.push({ x: c.x + a.dx, z: c.z + a.dz, r: c.r });
      if (c.owner !== undefined && !VA.has(c.owner)) VA.set(c.owner, Math.max(0, (a.dx * pfx + a.dz * pfz) / CUT_IN_LOOK));
    }
    // (Where those on foot and the vehicles about will be in MOVE_LOOK s, as they go: one stepping out
    // ahead of its nose, or a vehicle pulling up into where its trailer swings, is seen coming. Not
    // those on foot by its trailer: they sidestep this way and that, and it would brake for each.)
    const PP = this.pedsAhead, TP = this.trailerAhead; PP.length = 0; TP.length = 0;
    for (const p of peds) if (p.vx !== undefined && Math.hypot(p.vx, p.vz ?? 0) > 0.2 && Math.abs(p.x - j.pose.x) < 40 && Math.abs(p.z - j.pose.z) < 40) PP.push({ x: p.x + p.vx * MOVE_LOOK, z: p.z + (p.vz ?? 0) * MOVE_LOOK, r: p.r, pad: 0.4 });
    if (fw !== undefined) {
      for (const c of C) {
        if (Math.abs(c.x - j.pose.x) > 40 || Math.abs(c.z - j.pose.z) > 40 || this.traffic.waitsForTruck(c.owner) || (c.x - j.pose.x) * pfx + (c.z - j.pose.z) * pfz > E.front + 0.5) continue;
        const a = this.traffic.aheadOf(c.owner, MOVE_LOOK);
        if (a) TP.push({ x: c.x + a.dx, z: c.z + a.dz, r: c.r, pad: 0.3 });
      }
    }
    for (let s = st.s + 0.5, step = FINE_STEP, came = 0; s <= Math.min(P.length, st.s + reach) && s < (stop ?? Infinity); came = step, s += step) {
      step = s - st.s < FINE_NEAR ? FINE_STEP : 1;
      let shift = 0;
      const q = P.peek(s, this.spare), fx = Math.cos(q.h), fz = -Math.sin(q.h);
      // (Its body there: nearBody, from rear to nose along its heading, 1.25 m either side.)
      // (A crosser: where they are and the rest of their way across.)
      // (Its trailer, a tractor's, from the kingpin at its angle: pulling out of a bay or round a
      // corner it swings across the pavement. Anyone near it there.)
      let hit = false;
      if (fw !== undefined) {
        const kx = q.x + fx * fw, kz = q.z + fz * fw, d = Math.hypot(kx - ax, kz - az) || 1;
        ax = kx - (kx - ax) / d * KINGPIN_TO_AXLES; az = kz - (kz - az) / d * KINGPIN_TO_AXLES;
        const tx = (kx - ax) / KINGPIN_TO_AXLES, tz = (kz - az) / KINGPIN_TO_AXLES;
        for (let k = 0; k < peds.length && !hit; k++) {
          const ex = peds[k].x - kx, ez = peds[k].z - kz;
          if (Math.abs(ex) > 20 || Math.abs(ez) > 20) continue;
          const b = Math.max(TRAILER.rear, Math.min(TRAILER.front, ex * tx + ez * tz));
          hit = Math.hypot(ex - tx * b, ez - tz * b) < TRAILER.hw + peds[k].r + 0.4;
        }
        // (And a vehicle standing there, waiting at its line, say, that its trailer would cut in
        // across; or one ahead of its nose now.)
        for (let k = 0; k < C.length && !hit; k++) {
          const ex = C[k].x - kx, ez = C[k].z - kz;
          if (Math.abs(ex) > 20 || Math.abs(ez) > 20) continue;
          if (this.traffic.speedOf(C[k].owner) > 0.5 && (C[k].x - j.pose.x) * pfx + (C[k].z - j.pose.z) * pfz <= E.front + 0.5) continue;
          // (One waiting at its line for the truck by its junction booking: only if the trailer would
          // touch it, not merely pass close, as for the cab below; a trailer swinging across a car
          // waiting in the oncoming lane would hit it all the same.)
          const pad = this.traffic.waitsForTruck(C[k].owner) ? -0.02 : 0.3;
          const b = Math.max(TRAILER.rear, Math.min(TRAILER.front, ex * tx + ez * tz));
          hit = Math.hypot(ex - tx * b, ez - tz * b) < TRAILER.hw + C[k].r + pad;
        }
        for (let k = 0; k < TP.length && !hit; k++) {
          const ex = TP[k].x - kx, ez = TP[k].z - kz;
          if (Math.abs(ex) > 20 || Math.abs(ez) > 20) continue;
          const b = Math.max(TRAILER.rear, Math.min(TRAILER.front, ex * tx + ez * tz));
          hit = Math.hypot(ex - tx * b, ez - tz * b) < TRAILER.hw + TP[k].r + TP[k].pad;
        }
      }
      for (let i = 0; i < X.length && !hit; i += 4) {
        if (Math.abs(X[i] - q.x) > 30 || Math.abs(X[i + 1] - q.z) > 30) continue;
        // (The rest of their way across, all of it: they walk on into its way while it comes, so it
        // gives way to anyone on the crosswalk it is to cross, as a driver does, not just to one about
        // to step in front of it.)
        const L = Math.hypot(X[i + 2] - X[i], X[i + 3] - X[i + 1]), tEnd = L > 0 ? 1 : 0, dtc = L > 0 ? Math.min(1, 1 / L) : 1;   // (about a metre a sample)
        for (let t = 0; t <= tEnd + 1e-6 && !hit; t += dtc) {
          const x = X[i] + (X[i + 2] - X[i]) * t, z = X[i + 1] + (X[i + 3] - X[i + 1]) * t;
          // (Ahead of its nose, or where its body would newly come: not beside it already, which
          // driving on it slides past.)
          hit = this.nearBody(q, fx, fz, E!.front, E!.rear, x, z, 0.8) && (!this.underTruck(x, z, E!.front, E!.rear, j) || (x - j.pose.x) * pfx + (z - j.pose.z) * pfz > E!.front);
        }
      }
      // (Anyone on foot ahead of its nose now, in the way it goes: crossing a driveway it pulls out
      // across, say. One beside it already steps back out of its way.)
      for (let k = 0; k < peds.length && !hit; k++) if (Math.abs(peds[k].x - q.x) < 20 && Math.abs(peds[k].z - q.z) < 20 && (peds[k].x - j.pose.x) * pfx + (peds[k].z - j.pose.z) * pfz > E.front) hit = this.nearBody(q, fx, fz, E!.front, E!.rear, peds[k].x, peds[k].z, peds[k].r + 0.4);
      for (let k = 0; k < PP.length && !hit; k++) if (Math.abs(PP[k].x - q.x) < 20 && Math.abs(PP[k].z - q.z) < 20 && (PP[k].x - j.pose.x) * pfx + (PP[k].z - j.pose.z) * pfz > E.front) hit = this.nearBody(q, fx, fz, E!.front, E!.rear, PP[k].x, PP[k].z, PP[k].r + 0.4);
      // (A vehicle ahead of its nose now: one level with it, beside, drops back out of its way. Not
      // one stopped short of where its junction booking has it wait for the truck to go through.)
      for (let k = 0; k < C.length && !hit; k++) if (!this.traffic.waitsForTruck(C[k].owner) && Math.abs(C[k].x - q.x) < 25 && Math.abs(C[k].z - q.z) < 25 && (C[k].x - j.pose.x) * pfx + (C[k].z - j.pose.z) * pfz > E.front + 0.5) { hit = this.nearBody(q, fx, fz, E!.front, E!.rear, C[k].x, C[k].z, C[k].r + 0.3); if (hit) { const u = VA.get(C[k].owner ?? -1) ?? 0; shift = (u * u) / (2 * CAR_BRAKE); } }
      for (let k = 0; k < CI.length && !hit; k++) if (Math.abs(CI[k].x - q.x) < 25 && Math.abs(CI[k].z - q.z) < 25 && (CI[k].x - j.pose.x) * pfx + (CI[k].z - j.pose.z) * pfz > E.front + 0.5) hit = this.nearBody(q, fx, fz, E!.front, E!.rear, CI[k].x, CI[k].z, CI[k].r + 0.3);
      // (And one standing, or slower than it (SLOW_BESIDE), beside it that its body would come
      // into, swinging round a corner into the lane where it waits, say: a standing one doesn't
      // drop back out of the way. Only nearer than it is now, so it slides on past one it is
      // already alongside. A tractor's cab: its trailer,
      // which follows the kingpin rather than the cab's line, is looked after above. With a little
      // less room than traffic leaves it out of a gridlock (traffic.ts CLEAR_ROOM), so whatever it
      // waits for here, honking, is made way for.)
      const cabRear = fw !== undefined ? -1.5 : E!.rear;
      for (let k = 0; k < C.length && !hit; k++) {
        const c = C[k];
        if (Math.abs(c.x - q.x) > 25 || Math.abs(c.z - q.z) > 25 || this.traffic.speedOf(c.owner) > Math.max(SLOW_BESIDE, st.v)) continue;
        const then = this.bodyDist(q, fx, fz, E!.front, cabRear, c.x, c.z), now = this.bodyDist(j.pose, pfx, pfz, E!.front, cabRear, c.x, c.z);
        // (Or one up against it already, stopped dead there coming across its nose, say, that it
        // would stay against, sliding along it: it waits, honking, for it to back off.)
        const touch = 1.25 + c.r;
        // (One waiting at its line for the truck by its junction booking: only if the truck would
        // touch it, not merely pass close: else it stops dead alongside it for a few centimetres.)
        // (Nor one moving, in the lane beside, that it passes close: only one it would touch.)
        const pad = this.traffic.waitsForTruck(c.owner) || this.traffic.speedOf(c.owner) > 0.5 ? -0.02 : 0.15;
        hit = (then < touch + pad && then < now - 0.05) || (now < touch && then < touch && then < now + 0.05);
      }
      // (Short of it by the step it was found in too: it began somewhere since the last sample.)
      if (hit) { stop = Math.min(stop ?? Infinity, s - 1.5 - came + shift); if (!shift) break; }
    }
    return stop;
  }
  private cutIn: { x: number; z: number; r: number }[] = [];
  private aheadV = new Map<number, number>();
  private pedsAhead: { x: number; z: number; r: number; pad: number }[] = [];
  private trailerAhead: { x: number; z: number; r: number; pad: number }[] = [];
  // How far (x, z) is from the middle line of the truck's body standing at q (heading fx, fz).
  private bodyDist(q: { x: number; z: number }, fx: number, fz: number, front: number, rear: number, x: number, z: number): number {
    const dx = x - q.x, dz = z - q.z, a = Math.max(rear, Math.min(front, dx * fx + dz * fz));
    return Math.hypot(dx - fx * a, dz - fz * a);
  }
  // Whether (x, z) is within r of the truck's body standing at q (heading fx, fz; 1.25 m either side).
  private nearBody(q: Pose, fx: number, fz: number, front: number, rear: number, x: number, z: number, r: number): boolean {
    const dx = x - q.x, dz = z - q.z, a = Math.max(rear, Math.min(front, dx * fx + dz * fz));
    return Math.hypot(dx - fx * a, dz - fz * a) < 1.25 + r;
  }
  // Whether (x, z) is under the truck's body where it stands now (1.25 m either side of its middle line).
  private underTruck(x: number, z: number, front: number, rear: number, j: Journey): boolean {
    const p = j.pose, fx = Math.cos(p.h), fz = -Math.sin(p.h), dx = x - p.x, dz = z - p.z, a = Math.max(rear, Math.min(front, dx * fx + dz * fz));
    return Math.hypot(dx - fx * a, dz - fz * a) < 1.25 + 0.8;
  }
  // Someone (a vehicle or a pedestrian, as last stepped) in the way of the truck's next 6 m back
  // into the bay: within its sweep there, their circles touching (people with room to spare, and
  // where they walk to in the next 1.5 s: someone walking along the pavement into the cab's swing).
  // (Someone standing, waiting for it, is only where they are.)
  reverseBlocked(j: Journey): boolean {
    const st = j.st, W = this.sweep;
    if (st.mode !== "reverse" || W.path !== j.path) return false;
    for (let k = 0; k < W.obs.length; k++) {
      if (W.at[k] > st.s + 1 || W.at[k] < st.s - 6) continue;
      const o = W.obs[k];
      for (const c of this.traffic.obstacles) if (Math.hypot(c.x - o.x, c.z - o.z) < c.r + o.r - 0.3) return true;
      if (walksInto(this.crowd.obstacles, o)) return true;
    }
    return false;
  }
  save() { return JSON.stringify({ t: this.traffic.save(), c: this.crowd.save(), b: this.ambient.saveBlimp(), d: this.setDown }); }
  load(s: string, j: Journey) {
    const o = JSON.parse(s);
    this.traffic.load(o.t, j.plan); this.crowd.load(o.c); this.ambient.loadBlimp(o.b); this.setDown = o.d ?? "";
  }
}

// Whether anyone on foot (`people`, as the crowd's obstacles: each moving as it says) is in circle
// o, or walking into it in the next 1.5 s, with room to spare (StreetLife.reverseBlocked: someone
// walking along the pavement into the cab's swing).
export function walksInto(people: Obstacle[], o: Obstacle): boolean {
  for (const c of people) for (let t = 0; t <= 1.5; t += 0.5) if (Math.hypot(c.x + (c.vx ?? 0) * t - o.x, c.z + (c.vz ?? 0) * t - o.z) < c.r + o.r + 0.5) return true;
  return false;
}
