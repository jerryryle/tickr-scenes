// Test: the truck never drives through traffic, nor through anyone on foot, and never stands in the
// street (waiting for them, or a light) longer than HELD_MAX (60 s, as test/gridlock.ts: its waits at
// red lights count, which the honk's clock leaves out). Runs journeys with
// their street life and fails if the truck's body and a vehicle's overlap by more than OVERLAP_MAX
// while the truck is on the ground (up on a ramp or the freeway it passes over the streets).
// Boxes: the truck's from its rear to its front about its rear axle, 1.25 m either side (a
// tractor's, two: its cab, and its trailer from the kingpin at its own angle); a vehicle's its
// length and width.
// Covers seed 659803215's first minutes: a bus waiting at the first junction in town, which the
// truck once drove through, a left turn across oncoming traffic, and (on the code of the time)
// people crossing at 58 s in the way of its left turn there. Seed 8's: a jogger on the walkway
// at 1:12, a slow left turn pulling out in front of it at 1:30, and a car overtaking as it came
// down off a garage. Seed 5's: a car coming up alongside as it reversed into a dock bay at 6:38.
// Seed 11's: a car turning in beside it as it came off a freeway ramp at 6:40. And the other seeds
// to 10 minutes, where the truck once turned into cars beside it or waiting at their line (seed 2),
// stood off with someone in its way (10, 14) or with cars at a junction (3, 7, 13). A pedestrian
// counts as hit inside the truck's boxes widened by PED_R. First, for every truck: the circles
// traffic and the reversing truck see it as (truckObstacles) reach its nose's and its back's
// corners, which swing out over the pavement as it reverses into a bay (seed 11 at 9.97 min, once);
// and reversing, it waits for someone walking into its swing, not only for someone in it already.
// Args (all optional): minutes
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT } from "../src/journey.ts";
import { StreetLife, walksInto } from "../src/life.ts";
import { Traffic, truckObstacles } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
import { SPECS, TRAILER, truckExtents } from "../src/truck.ts";
{
  const proc = (globalThis as any).process, minutes = Number(proc.argv[2] ?? 10), OVERLAP_MAX = 0.4, PED_R = 0.3, HELD_MAX = 60, errs: string[] = [];
  for (const model of Object.keys(SPECS) as (keyof typeof SPECS)[]) {
    const E = truckExtents(model), fw = SPECS[model].fifthWheel, obs: { x: number; z: number; r: number }[] = [];
    truckObstacles(model, 0, 0, 0, 0, obs);
    const back = fw !== undefined ? fw + TRAILER.rear : E.rear, hw = fw !== undefined ? TRAILER.hw : 1.25;
    for (const [x, z] of [[E.front, -1.25], [E.front, 1.25], [back, -hw], [back, hw]])
      if (!obs.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + PED_R)) errs.push(`${model}: its corner at ${x.toFixed(2)}, ${z.toFixed(2)} is outside every one of its obstacle circles`);
  }
  {
    // (A circle of the truck's sweep at the origin, r 1.5; someone 3.5 m off at walking pace.)
    const o = { x: 0, z: 0, r: 1.5 }, at = (x: number, vx: number) => [{ x, z: 0, r: 0.4, vx, vz: 0 }];
    if (!walksInto(at(3.5, -1.4), o)) errs.push("reversing: someone walking into the truck's swing doesn't hold it");
    if (walksInto(at(3.5, 0), o)) errs.push("reversing: someone standing clear of the truck's swing holds it");
    if (walksInto(at(3.5, 1.4), o)) errs.push("reversing: someone walking away from the truck's swing holds it");
    if (!walksInto(at(2.0, 0), o)) errs.push("reversing: someone standing in the truck's swing doesn't hold it");
  }
  for (const seed of [659803215, 7, 8, 5, 11, 1, 2, 3, 4, 6, 9, 10, 12, 13, 14]) {
    const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial(), traffic = new Traffic(scene, mat, null);
    const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
    const crowd = new Crowd(scene, mat);
    j.attachLife(new StreetLife(traffic, crowd, new Ambient(scene, mat)));
    let worst = 0, checks = 0, hits = 0, held = 0, heldMost = 0;
    while (j.st.simTime < minutes * 60) {
      j.step();
      // (Standing in the street (not at its stop) for street life or a light: never long.)
      held = (j.st.mode === "drive" && Math.abs(j.st.v) < 0.05 && j.st.stopS - j.st.s > 1) || (j.st.mode === "reverse" && Math.abs(j.st.v) < 0.05 && j.st.s - j.st.backS > 0.05) ? held + SIM_DT : 0;
      heldMost = Math.max(heldMost, held);
      if (held > HELD_MAX && held <= HELD_MAX + SIM_DT && errs.length < 10) errs.push(`seed ${seed} at ${(j.st.simTime / 60).toFixed(2)} min: the truck (${j.st.mode}) has stood in the street ${HELD_MAX} s`);
      if (j.st.mode === "country" || j.st.mode === "inbound" || (j.path && j.path.ramps.length && j.path.yAt(j.st.s) > 1)) continue;
      const E = truckExtents(j.st.truck), h = j.pose.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
      const tb = [[E.rear, -1.25], [E.front, -1.25], [E.front, 1.25], [E.rear, 1.25]].map(([a, b]) => [j.pose.x + fx * a + rx * b, j.pose.z + fz * a + rz * b]);
      // (A tractor and its trailer, two boxes: the trailer from the kingpin at its own angle, as it
      // swings behind on a turn or reversing into a bay.)
      const fw = SPECS[j.st.truck].fifthWheel, boxes = [tb];
      if (fw !== undefined) {
        const th = h + j.hitchYaw, tx = Math.cos(th), tz = -Math.sin(th), trx = Math.sin(th), trz = Math.cos(th), kx = j.pose.x + fx * fw, kz = j.pose.z + fz * fw;
        boxes[0] = [[-1.5, -1.25], [E.front, -1.25], [E.front, 1.25], [-1.5, 1.25]].map(([a, b]) => [j.pose.x + fx * a + rx * b, j.pose.z + fz * a + rz * b]);
        boxes.push([[TRAILER.rear, -TRAILER.hw], [TRAILER.front, -TRAILER.hw], [TRAILER.front, TRAILER.hw], [TRAILER.rear, TRAILER.hw]].map(([a, b]) => [kx + tx * a + trx * b, kz + tz * a + trz * b]));
      }
      // People: inside one of the truck's boxes widened by PED_R (as their axes say: within each
      // side's reach).
      const inBox = (T: number[][], x: number, z: number) => {
        for (let k = 0; k < 4; k++) {
          const [ax, az] = T[k], [bx, bz] = T[(k + 1) % 4], l = Math.hypot(bx - ax, bz - az), nx = (bz - az) / l, nz = -(bx - ax) / l;
          const side = (x - ax) * nx + (z - az) * nz, cx = T.reduce((q, [px, pz]) => q + (px - ax) * nx + (pz - az) * nz, 0) / 4;
          if (Math.sign(side) !== Math.sign(cx) && Math.abs(side) > PED_R) return false;
        }
        return true;
      };
      for (const p of (crowd as any).peds as any[]) {
        if (Math.abs(j.st.v) > 0.3 && boxes.some((T) => inBox(T, p.x, p.z))) {
          hits++;
          if (errs.length < 10) errs.push(`seed ${seed} at ${(j.st.simTime / 60).toFixed(2)} min: the truck (${j.st.mode}) runs into a pedestrian (${p.state})`);
        }
      }
      for (const c of (traffic as any).cars as any[]) {
        if (Math.hypot(c.x - j.pose.x, c.z - j.pose.z) > 25) continue;
        checks++;
        const cfx = Math.cos(c.h), cfz = -Math.sin(c.h), crx = Math.sin(c.h), crz = Math.cos(c.h), L2 = c.kind.len / 2, W2 = c.kind.width / 2;
        const cb = [[-L2, -W2], [L2, -W2], [L2, W2], [-L2, W2]].map(([a, b]) => [c.x + cfx * a + crx * b, c.z + cfz * a + crz * b]);
        let gap = Infinity;   // (the boxes' separation along their axes: negative, how deep they overlap)
        for (const T of boxes) {
          let g = -Infinity;
          for (const P of [T, cb]) for (let i = 0; i < 4; i++) {
            const [ax, az] = P[i], [bx, bz] = P[(i + 1) % 4], l = Math.hypot(bx - ax, bz - az), nx = (bz - az) / l, nz = -(bx - ax) / l;
            const A = T.map(([x, z]) => x * nx + z * nz), B = cb.map(([x, z]) => x * nx + z * nz);
            g = Math.max(g, Math.min(...B) - Math.max(...A), Math.min(...A) - Math.max(...B));
          }
          gap = Math.min(gap, g);
        }
        if (-gap > worst) worst = -gap;
        if (-gap > OVERLAP_MAX && errs.length < 10) errs.push(`seed ${seed} at ${(j.st.simTime / 60).toFixed(2)} min: the truck (${j.st.mode}) overlaps a ${c.kind.id} by ${(-gap).toFixed(2)} m`);
      }
    }
    console.log(`truck: seed ${seed}, ${minutes} min, ${checks} vehicle checks near it, deepest overlap ${worst.toFixed(2)} m; pedestrians hit ${hits}; longest stand ${heldMost.toFixed(0)} s`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
