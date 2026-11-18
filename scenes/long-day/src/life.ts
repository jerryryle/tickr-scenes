// Street life as part of the journey: traffic, pedestrians, birds and the blimp step with the
// journey's fixed clock (Journey.life), from a random stream seeded by each city, and are saved
// in its keyframes. So any moment looks the same however it was reached, scrubbing included.
// Traffic still yields to the truck and the journey still ignores traffic.
import { hash2 } from "./rng.ts";
import { truckExtents, truckLayout } from "./truck.ts";
import type { Path, Pose } from "./route.ts";
import { Journey } from "./journey.ts";
import { GATES } from "./city.ts";
import type { LifeHook } from "./journey.ts";
import { Traffic, truckObstacles } from "./traffic.ts";
import type { Obstacle } from "./traffic.ts";
import { Crowd } from "./crowd.ts";
import type { KerbParked } from "./vignettes.ts";
import { Ambient } from "./ambient.ts";
import { DEBUG_BLOCK } from "./debug.ts";

export class StreetLife implements LifeHook {
  private obs: Obstacle[] = [];
  private spare: Pose = { x: 0, z: 0, h: 0, k: 0 };
  private busy = new Set<string>();
  private truckPath = { path: null as unknown as Path, s: 0, v: 0, front: 0, rear: 0 };
  private truckGate = { node: 0, street: 0 };
  private extents = new Map<string, ReturnType<typeof truckExtents>>();   // (per model: truckExtents makes a new object each call)
  private landing = { path: null as unknown as Path, s0: 0, s1: 0, at: 0 };

  constructor(private traffic: Traffic, private crowd: Crowd, private ambient: Ambient) {}

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
    truckObstacles(st.truck, p.x, p.z, p.h, j.trailerYaw() ?? 0, obs);
    const truckN = obs.length;
    // Parked at a stop (or just pulled up at one, or waiting for its next job), traffic changes
    // lanes early to pass (not at a red light).
    const parked = st.mode === "drive" && Math.abs(st.v) < 0.3 && (!j.path || st.stopS - st.s < 25);
    if (st.mode === "dwell" || parked) {
      // The walk ramp, when it is out behind the truck at a kerb stop, is in the lane too.
      const L = truckLayout(st.truck), stop = st.stops[0];
      if (L.loader === "ramp" && stop && stop.kind !== "swap" && !j.isDockStop(stop)) {
        const fx = Math.cos(p.h), fz = -Math.sin(p.h);
        for (let a = L.bedRear - 0.6; a > L.bedRear - L.rampRun - 0.2; a -= 1.0) obs.push({ x: p.x + fx * a, z: p.z + fz * a, r: 0.75 });
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
    }
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
    this.crowd.step(j.plan, st.simTime, prs, p, obs, { cars: this.traffic.obstacles, parked: parkedAt, busy: this.busy });
    // (Test renders watching one block, "block:kx,kz": the traffic round that block instead.)
    let tf: { x: number; z: number } = p;
    if (DEBUG_BLOCK) { const B = j.plan.graph.block(DEBUG_BLOCK[0], DEBUG_BLOCK[1]); if (B) tf = { x: B.cx, z: B.cz }; }
    // (Driving on its path, the truck has traffic give way where their ways cross. Arriving, in
    // its last 8 s before the gate, traffic gives way at the junction inside it: the truck's first.)
    // (The objects handed on are kept and refilled: no garbage on a step, as seeks replay thousands.)
    const tp = st.mode === "drive" && j.path ? this.truckPath : null;
    if (tp) { let E = this.extents.get(st.truck); if (!E) this.extents.set(st.truck, (E = truckExtents(st.truck))); tp.path = j.path!; tp.s = st.s; tp.v = st.v; tp.front = E.front; tp.rear = E.rear; }
    const gi = st.mode === "inbound" ? GATES.indexOf(j.plan.entryGate) : -1, g = gi >= 0 && j.arrivalRoad.arriveDur - st.cityTime < 8 ? j.plan.graph.gates[gi] : null;
    const gate = g ? this.truckGate : null;
    if (gate) { gate.node = g!.node; gate.street = g!.street; }
    // (Coming down a freeway exit ramp, which joins the streets off any junction: traffic gives way
    // where the ramp's last 15 m and the 25 m after it cross its way, from 70 m short of the foot.)
    const rp = st.mode === "drive" && j.path?.route.garageOut ? j.path.ramps[j.path.ramps.length - 1] : null;
    const landing = rp && st.s < rp.s1 + 10 && rp.s1 - st.s < 70 ? this.landing : null;
    if (landing) { landing.path = j.path!; landing.s0 = Math.max(st.s, rp!.s1 - 15); landing.s1 = rp!.s1 + 25; landing.at = rp!.s1; }
    this.traffic.step(j.plan, st.simTime, prs, tf, obs, p.h, this.crowd.obstacles, tp, gate, landing);
    this.ambient.stepBlimp(p, st.simTime);
  }

  save() { return JSON.stringify({ t: this.traffic.save(), c: this.crowd.save(), b: this.ambient.saveBlimp() }); }
  load(s: string, j: Journey) {
    const o = JSON.parse(s);
    this.traffic.load(o.t, j.plan); this.crowd.load(o.c); this.ambient.loadBlimp(o.b);
  }
}
