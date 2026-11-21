// Test: street life never appears in sight of the truck. Every car, pedestrian and vignette is set down where
// the town's blocks hide it from the truck (citygraph.ts outOfSight): spawned where the cameras that
// follow it could see, it would appear from nowhere. Steps the first city through to its end (the
// way in, its stops and the way out) and the next two cities' first 200 s, and checks each one new that step, where it first stands, and each new street
// vignette where it is set. (Vignettes' people, handed on to the crowd as they finish, aren't new:
// they are skipped by where they came from. The parking officer's ticket is set by the kerb stop,
// its officer coming from round the corner: spawnTicket checks that way itself.)
// Args (all optional): seed
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { StreetLife } from "../src/life.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
import { outOfSight } from "../src/citygraph.ts";
{
  const proc = (globalThis as any).process, seed = Number(proc.argv[2] ?? 12345), errs: string[] = [];
  const period = new Journey(readConfig({ seed } as any), 0, "autumn").period;
  let checked = 0;
  for (const city of [0, 1, 2]) {
    const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial(), traffic = new Traffic(scene, mat, null), crowd = new Crowd(scene, mat);
    const j = new Journey(readConfig({ seed } as any), city * period, "autumn");
    j.attachLife(new StreetLife(traffic, crowd, new Ambient(scene, mat)));
    const seen = new WeakSet<object>();
    for (const o of [...(traffic as any).cars, ...(crowd as any).peds]) seen.add(o);
    const V = (crowd as any).vig, vigs = () => (V.list as any[]).map((v) => V.where(v) as [number, number]);
    for (const v of V.list) seen.add(v);
    let near = vigs();
    while (j.st.simTime < city * period + (city === 0 ? period - 1 : 200)) {
      j.step();
      const G = j.plan.graph, eye = j.pose;   // (street life steps after the truck: where it was as they were set down)
      for (const [kind, list] of [["car", (traffic as any).cars], ["pedestrian", (crowd as any).peds]] as [string, any[]][]) for (const o of list) {
        if (seen.has(o)) continue;
        seen.add(o);
        if (kind === "pedestrian" && near.some(([x, z]) => Math.hypot(x - o.px, z - o.pz) < 15)) continue;   // (from a vignette)
        checked++;
        // (Where it was set down, px/pz: it has moved on from there since, in the same step.)
        if (!outOfSight(G, eye, o.px, o.pz) && errs.length < 10) errs.push(`seed ${seed} city ${city} t=${(j.st.simTime - city * period).toFixed(1)} (${j.st.mode}): a ${kind} appeared in sight of the truck, ${Math.hypot(o.px - eye.x, o.pz - eye.z).toFixed(0)} m off`);
      }
      for (const v of V.list) {
        if (seen.has(v)) continue;
        seen.add(v);
        if (v.k === "ticket") continue;
        const [x, z] = V.where(v);
        checked++;
        if (!outOfSight(G, eye, x, z) && errs.length < 10) errs.push(`seed ${seed} city ${city} t=${(j.st.simTime - city * period).toFixed(1)} (${j.st.mode}): a ${v.k} vignette appeared in sight of the truck`);
      }
      near = vigs();
    }
  }
  console.log(`spawns: ${checked} cars, pedestrians and vignettes set down, ${errs.length} in sight of the truck`);
  if (checked < 100) errs.push(`only ${checked} set down: too few to judge`);
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
