// Test: the truck and the traffic never drive into each other. Replays cities where they once did,
// to the end of the city's slot, and fails if the truck, moving, comes OVERLAP_MAX into the box of a
// vehicle that has stood still a second or more, or a vehicle, moving, comes that far into the truck.
// Seed 7's city 7: an ice cream van waiting just round a corner the truck turned, its body swinging
// onto it (the truck looked only ahead of its nose: one beside it drops back, but a standing one
// doesn't). Seed 11's city 5: a pickup in the next lane braking hard for its light as the truck
// moved over into that lane to turn. Seed 3's city 20 and seed 3442198800's city 63: a car stopped
// dead against the truck's nose, which then slid on along it. Seed 7's city 20: a car moving back
// into its lane, sideways into the truck beside it. Seed 11's city 6: a car moving over into the
// truck's lane just ahead of it, to turn. Seed 2539665337's city 16: a car turning beside it, its
// tail swinging out into the truck. Seed 11's city 24: a car crossing the truck's nose as it pulled
// out of a bay (pulling out, it looked for nothing short of where it waits for a gap). Every car
// now never steps into the truck, whatever else it misjudges (traffic.ts truckGap). Seed
// 3442198800's city 63 again, with more traffic about: a tractor's trailer swinging across a box
// truck waiting in the oncoming lane for it to go through (the truck looked out for those waiting
// on it with its cab, not its trailer: life.ts truckStop). Seed 1399257032's city 0: the truck
// pulling out of a bay, waiting for a gap with its nose already out across the lane it joins (the
// wait measured along its path, which swings round into the lane), an SUV driving into it side on
// and the two stuck so (life.ts outAt; the SUV, stuck, could not back out either, which
// traffic.ts clearWay's finer circles against the truck fix, but which this no longer reaches).
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { StreetLife } from "../src/life.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
import { SPECS, TRAILER, truckExtents } from "../src/truck.ts";
{
  const proc = (globalThis as any).process, OVERLAP_MAX = 0.4, errs: string[] = [];
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
  for (const [seed, city] of [[7, 7], [11, 5], [3, 20], [3442198800, 63], [7, 20], [11, 6], [2539665337, 16], [11, 24], [1399257032, 0]]) {
    const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial(), traffic = new Traffic(scene, mat, null);
    const period = new Journey(readConfig({ seed } as any), 0, "autumn").period;
    const j = new Journey(readConfig({ seed } as any), city * period, "autumn");
    j.attachLife(new StreetLife(traffic, new Crowd(scene, mat), new Ambient(scene, mat)));
    let deep = 0, deepAt = 0;
    while (j.st.simTime < (city + 1) * period - 1) {
      j.step();
      if (j.st.mode === "country" || j.st.mode === "inbound") continue;
      for (const c of (traffic as any).cars as any[]) {
        // (The truck moving into one standing; or one moving into the truck.)
        if (Math.hypot(c.x - j.pose.x, c.z - j.pose.z) > 30) continue;
        if (!(Math.abs(j.st.v) > 0.3 && Math.abs(c.v) < 0.1 && c.stillT >= 1) && !(Math.abs(c.v) > 0.3)) continue;
        const d = overlap(j, c);
        if (d > 0.3 && d > deep) { deep = d; deepAt = j.st.simTime - city * period; }
      }
    }
    console.log(`sideswipe: seed ${seed} city ${city}, deepest contact ${deep.toFixed(2)} m`);
    if (deep > OVERLAP_MAX) errs.push(`seed ${seed} city ${city}: the truck and a vehicle came ${deep.toFixed(2)} m into each other (at ${deepAt.toFixed(0)} s)`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
