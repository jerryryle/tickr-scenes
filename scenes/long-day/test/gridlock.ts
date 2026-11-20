// Test: no gridlock ever holds the truck for good. Replays cities where it once stood still in the
// street to the end of the city's slot (two boards' overnight runs): seed 2539665337's city 9, a
// car at its junction line waiting on one stuck behind the truck, and city 4; seed 3442198800's
// city 66, someone crossing in front of the truck waiting on it as it waited on them, and 58,
// where they rocked back and forth giving the crossing up; 59, an oncoming car waiting its turn
// through the junction on the truck as the truck waited on it, and 60; seed 659803215's city 15
// and seed 11's 19, a tractor whose trailer would swing in across a car standing in the next lane;
// seed 7's city 7, cars pulling on out of its way past the end of their own streets (and so never
// out of it); and seed 11's city 10, a street vendor in its way back into a bay.
// Held by traffic (journey.ts JAM_HONK) the truck honks and the traffic in its way backs up or
// pulls on out of it; held by someone crossing, they step back to the kerb. Fails if it stands
// still in the street (not at its stop) longer than HELD_MAX, or if anything making way for it
// comes further into it, deeper than OVERLAP_MAX (seed 659803215's city 15: a cable car once made
// way through it, forward along its tracks being the shorter way out; seed 2539665337's city 4:
// the truck came on into an SUV still backing out of its way).
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT } from "../src/journey.ts";
import { StreetLife } from "../src/life.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
import { SPECS, TRAILER, truckExtents } from "../src/truck.ts";
{
  const proc = (globalThis as any).process, HELD_MAX = 60, OVERLAP_MAX = 0.4, errs: string[] = [];
  // (How deep vehicle c's box comes into the truck's (its cab's, and a tractor's trailer's).)
  const overlap = (j: Journey, c: any) => {
    const E = truckExtents(j.st.truck), h = j.pose.h, fx = Math.cos(h), fz = -Math.sin(h), fw = SPECS[j.st.truck].fifthWheel;
    const box = (x: number, z: number, ax: number, az: number, a0: number, a1: number, w: number) => [[a0, -w], [a1, -w], [a1, w], [a0, w]].map(([a, b]) => [x + ax * a - az * b, z + az * a + ax * b]);
    const boxes = [box(j.pose.x, j.pose.z, fx, fz, fw !== undefined ? -1.5 : E.rear, E.front, 1.25)];
    if (fw !== undefined) { const th = h + j.hitchYaw; boxes.push(box(j.pose.x + fx * fw, j.pose.z + fz * fw, Math.cos(th), -Math.sin(th), TRAILER.rear, TRAILER.front, TRAILER.hw)); }
    const cb = box(c.x, c.z, Math.cos(c.h), -Math.sin(c.h), -c.kind.len / 2, c.kind.len / 2, c.kind.width / 2);
    let deep = 0;
    for (const T of boxes) {
      let g = -Infinity;
      for (const P of [T, cb]) for (let i = 0; i < 4; i++) {
        const [ax, az] = P[i], [bx, bz] = P[(i + 1) % 4], l = Math.hypot(bx - ax, bz - az), nx = (bz - az) / l, nz = -(bx - ax) / l;
        const A = T.map(([x, z]) => x * nx + z * nz), B = cb.map(([x, z]) => x * nx + z * nz);
        g = Math.max(g, Math.min(...B) - Math.max(...A), Math.min(...A) - Math.max(...B));
      }
      deep = Math.max(deep, -g);
    }
    return deep;
  };
  for (const [seed, city] of [[2539665337, 9], [2539665337, 4], [3442198800, 66], [3442198800, 58], [3442198800, 59], [3442198800, 60], [659803215, 15], [11, 19], [7, 7], [11, 10]]) {
    const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial(), traffic = new Traffic(scene, mat, null);
    const period = new Journey(readConfig({ seed } as any), 0, "autumn").period;
    const j = new Journey(readConfig({ seed } as any), city * period, "autumn");
    j.attachLife(new StreetLife(traffic, new Crowd(scene, mat), new Ambient(scene, mat)));
    let held = 0, most = 0, at = 0, deep = 0, deepAt = 0;
    const was = new Map<number, number>();   // (how deep each vehicle making way came into it last step)
    while (j.st.simTime < (city + 1) * period - 1) {
      j.step();
      held = Math.abs(j.st.v) < 0.05 && ((j.st.mode === "drive" && j.st.stopS - j.st.s > 1) || (j.st.mode === "reverse" && j.st.s - j.st.backS > 0.05)) ? held + SIM_DT : 0;
      if (held > most) { most = held; at = j.st.simTime - city * period; }
      // (Coming further into it while making way: as it backs out, or as the truck comes on. Not
      // one it was in already, before the jam.)
      if (j.clearing) for (const c of (traffic as any).cars as any[]) if (c.clearHold && Math.hypot(c.x - j.pose.x, c.z - j.pose.z) < 30) {
        const d = overlap(j, c), w = was.get(c.id);
        if (w !== undefined && d > w + 1e-3 && d > deep) { deep = d; deepAt = j.st.simTime - city * period; }
        was.set(c.id, d);
      }
    }
    console.log(`gridlock: seed ${seed} city ${city}, longest stand ${most.toFixed(0)} s (to ${at.toFixed(0)} s into the city), deepest into it making way ${deep.toFixed(2)} m`);
    if (deep > OVERLAP_MAX) errs.push(`seed ${seed} city ${city}: a vehicle making way came ${deep.toFixed(2)} m into the truck (at ${deepAt.toFixed(0)} s)`);
    if (most > HELD_MAX) errs.push(`seed ${seed} city ${city}: the truck stood still in the street ${most.toFixed(0)} s (to ${at.toFixed(0)} s)`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
