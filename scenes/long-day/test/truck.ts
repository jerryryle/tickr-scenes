// Test: the truck never drives through traffic, nor through anyone on foot. Runs journeys with
// their street life and fails if the truck's body and a vehicle's overlap by more than OVERLAP_MAX
// while the truck is on the ground (up on a ramp or the freeway it passes over the streets).
// Boxes: the truck's from its rear to its front about its rear axle, 1.25 m either side; a
// vehicle's its length and width.
// Covers seed 659803215's first minutes: a bus waiting at the first junction in town, which the
// truck once drove through, a left turn across oncoming traffic, and (on the code of the time)
// people crossing at 58 s in the way of its left turn there. Seed 8's: a jogger on the walkway
// at 1:12, a slow left turn pulling out in front of it at 1:30, and a car overtaking as it came
// down off a garage. Seed 5's: a car coming up alongside as it reversed into a dock bay at 6:38.
// Seed 11's: a car turning in beside it as it came off a freeway ramp at 6:40. A pedestrian counts
// as hit inside the truck's box widened by PED_R.
// Args (all optional): minutes
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { StreetLife } from "../src/life.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
import { truckExtents } from "../src/truck.ts";
{
  const proc = (globalThis as any).process, minutes = Number(proc.argv[2] ?? 7), OVERLAP_MAX = 0.4, PED_R = 0.3, errs: string[] = [];
  for (const seed of [659803215, 7, 8, 5, 11]) {
    const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial(), traffic = new Traffic(scene, mat, null);
    const j = new Journey(readConfig({ seed } as SceneEnv), 0);
    const crowd = new Crowd(scene, mat);
    j.attachLife(new StreetLife(traffic, crowd, new Ambient(scene, mat)));
    let worst = 0, checks = 0, hits = 0;
    while (j.st.simTime < minutes * 60) {
      j.step();
      if (j.st.mode === "country" || j.st.mode === "inbound" || (j.path && j.path.ramps.length && j.path.yAt(j.st.s) > 1)) continue;
      const E = truckExtents(j.st.truck), h = j.pose.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
      const tb = [[E.rear, -1.25], [E.front, -1.25], [E.front, 1.25], [E.rear, 1.25]].map(([a, b]) => [j.pose.x + fx * a + rx * b, j.pose.z + fz * a + rz * b]);
      for (const p of (crowd as any).peds as any[]) {
        const dx = p.x - j.pose.x, dz = p.z - j.pose.z, a = dx * fx + dz * fz, b = dx * rx + dz * rz;
        if (Math.abs(j.st.v) > 0.3 && a > E.rear - PED_R && a < E.front + PED_R && Math.abs(b) < 1.25 + PED_R) {
          hits++;
          if (errs.length < 10) errs.push(`seed ${seed} at ${(j.st.simTime / 60).toFixed(2)} min: the truck (${j.st.mode}) runs into a pedestrian (${p.state})`);
        }
      }
      for (const c of (traffic as any).cars as any[]) {
        if (Math.hypot(c.x - j.pose.x, c.z - j.pose.z) > 25) continue;
        checks++;
        const cfx = Math.cos(c.h), cfz = -Math.sin(c.h), crx = Math.sin(c.h), crz = Math.cos(c.h), L2 = c.kind.len / 2, W2 = c.kind.width / 2;
        const cb = [[-L2, -W2], [L2, -W2], [L2, W2], [-L2, W2]].map(([a, b]) => [c.x + cfx * a + crx * b, c.z + cfz * a + crz * b]);
        let gap = -Infinity;   // (the boxes' separation along their axes: negative, how deep they overlap)
        for (const P of [tb, cb]) for (let i = 0; i < 4; i++) {
          const [ax, az] = P[i], [bx, bz] = P[(i + 1) % 4], l = Math.hypot(bx - ax, bz - az), nx = (bz - az) / l, nz = -(bx - ax) / l;
          const A = tb.map(([x, z]) => x * nx + z * nz), B = cb.map(([x, z]) => x * nx + z * nz);
          gap = Math.max(gap, Math.min(...B) - Math.max(...A), Math.min(...A) - Math.max(...B));
        }
        if (-gap > worst) worst = -gap;
        if (-gap > OVERLAP_MAX && errs.length < 10) errs.push(`seed ${seed} at ${(j.st.simTime / 60).toFixed(2)} min: the truck (${j.st.mode}) overlaps a ${c.kind.id} by ${(-gap).toFixed(2)} m`);
      }
    }
    console.log(`truck: seed ${seed}, ${minutes} min, ${checks} vehicle checks near it, deepest overlap ${worst.toFixed(2)} m; pedestrians hit ${hits}`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
