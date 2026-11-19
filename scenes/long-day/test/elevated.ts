// Test: a metro city's elevated lines out of town (elevated.ts) come down to the ground, and
// cross every road the truck uses there at full height, never at grade. Every city of the journey
// is treated as a metro city, with the roads main.ts keeps clear (the way in, the way out and the
// last city's way out).
// Args (all optional): minutes
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { ElevatedReach, elevatedLift } from "../src/elevated.ts";
import { elevatedLine, ELEVATED_REACH } from "../src/decor.ts";
import { CITY_HI, CITY_LO } from "../src/city.ts";
import type { CityPlan } from "../src/city.ts";
import type { CountryRoad } from "../src/country.ts";
import { BLOCK } from "../src/grid.ts";

{
  const proc = (globalThis as any).process;
  const minutes = Number(proc.argv[2] ?? 70);
  const j = new Journey(readConfig({} as SceneEnv), 0, "autumn");
  const reach = new ElevatedReach(new THREE.Scene(), new THREE.MeshBasicMaterial());
  const errs: string[] = [];
  const q = { x: 0, z: 0, h: 0, k: 0 }, a = { x: 0, z: 0, h: 0, k: 0 };
  let lastKey = "", checks = 0, crossings = 0, grounded = 0, maxVerts = 0;
  while (j.st.simTime < minutes * 60) {
    j.step();
    const plan = { ...j.plan, seed: j.plan.seed, style: { ...j.plan.style, elevated: true } } as unknown as CityPlan;
    const rr: { road: CountryRoad; dx: number; dz: number }[] = [{ road: j.arrivalRoad, dx: 0, dz: 0 }];
    const ex = j.exitRoad, pv = j.previousExit;
    if (ex) rr.push({ road: ex, dx: 0, dz: 0 });
    if (pv && pv !== ex) { pv.center(pv.SB, q); j.arrivalRoad.center(0, a); rr.push({ road: pv, dx: a.x - q.x, dz: a.z - q.z }); }
    const key = `${j.st.city}|${rr.map((r) => `${r.road.inp.city}:${r.road.inp.kind}:${r.road.inp.dEst}:${r.dx.toFixed(1)}`).join(";")}`;
    if (key === lastKey) continue;
    lastKey = key;
    reach.update(plan, rr);
    checks++;
    let verts = 0;
    for (const m of reach.group.children) verts += ((m as THREE.Mesh).geometry.attributes.position.count);
    maxVerts = Math.max(maxVerts, verts);
    const W = CITY_LO * BLOCK - ELEVATED_REACH, E = (CITY_HI + 1) * BLOCK + ELEVATED_REACH;
    for (let cz = CITY_LO; cz <= CITY_HI; cz++) {
      if (!elevatedLine(plan.style, cz)) continue;
      const z0 = cz * BLOCK;
      // Down on the ground somewhere on each side, well out of town.
      for (const x of [CITY_LO * BLOCK - 400, (CITY_HI + 1) * BLOCK + 400]) if (elevatedLift(cz, x) === 0) grounded++;
      // Every road point over the line's deck or close beside it is under a full-height span.
      for (const { road, dx, dz } of rr) {
        let crossed = false;
        for (let s = 0; s <= road.length; s += 1) {
          road.center(s, q);
          const x = q.x + dx, z = q.z + dz;
          if (x < W || x > E || Math.abs(z - (z0 + 9)) > 9) continue;
          if (x > CITY_LO * BLOCK && x < (CITY_HI + 1) * BLOCK) continue;
          crossed = true;
          const f = elevatedLift(cz, x);
          if (f < 0.999 && errs.length < 20) errs.push(`city ${j.st.city} line ${cz}: road ${road.inp.kind} of city ${road.inp.city} at x ${x.toFixed(0)} z ${z.toFixed(0)} under the line at ${(f * 100).toFixed(0)}% height`);
        }
        if (crossed) crossings++;
      }
    }
  }
  console.log(`minutes ${minutes} cities ${j.st.city + 1} road sets ${checks} road crossings ${crossings} lines grounded out of town ${grounded}, at most ${maxVerts} vertices`);
  if (!grounded) errs.push("no line ever comes down to the ground");
  if (errs.length) { for (const e of errs) console.log("FAIL " + e); proc.exit(1); }
}
