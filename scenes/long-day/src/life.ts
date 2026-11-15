// Street life as part of the journey: traffic, pedestrians, birds and the blimp step with the
// journey's fixed clock (Journey.life), from a random stream seeded by each city, and are saved
// in its keyframes. So any moment looks the same however it was reached, scrubbing included.
// Traffic still yields to the truck and the journey still ignores traffic.
import { hash2 } from "./rng.ts";
import { truckLayout } from "./truck.ts";
import type { Pose } from "./route.ts";
import { Journey } from "./journey.ts";
import type { LifeHook } from "./journey.ts";
import { Traffic, truckObstacles } from "./traffic.ts";
import type { Obstacle } from "./traffic.ts";
import { Crowd } from "./crowd.ts";
import { Ambient } from "./ambient.ts";

export class StreetLife implements LifeHook {
  private obs: Obstacle[] = [];
  private spare: Pose = { x: 0, z: 0, h: 0, k: 0 };

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
    this.crowd.step(j.plan, st.simTime, prs, p, obs);
    this.traffic.step(j.plan, st.simTime, prs, p, obs, p.h, this.crowd.obstacles);
    this.ambient.stepBlimp(p, st.simTime);
  }

  save() { return JSON.stringify({ t: this.traffic.save(), c: this.crowd.save(), b: this.ambient.saveBlimp() }); }
  load(s: string) {
    const o = JSON.parse(s);
    this.traffic.load(o.t); this.crowd.load(o.c); this.ambient.loadBlimp(o.b);
  }
}
