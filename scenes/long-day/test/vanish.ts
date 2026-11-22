// Test: no car vanishes in sight of the truck. A car taken out of the traffic (far off, stuck for
// good in a knot, or at a dead end with no way on) goes only where the town's blocks hide it from
// the truck (traffic.ts vehicleUnseen, all of it), as spawns.ts checks they appear. Steps journeys from the
// start and checks, for each car gone that step, where it last stood. (Seed 1511948805 stood cars
// waiting behind the truck at its stops and took them away there after 55 s, 11 to 37 m off; seed
// 13's cable cars reach the end of their line in sight, 128 and 156 m off, in its first 5 min in autumn.)
// Args (all optional): seed, seconds, season (one journey instead of the cases)
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { StreetLife } from "../src/life.ts";
import { Traffic, vehicleUnseen } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
{
  const proc = (globalThis as any).process, errs: string[] = [];
  const cases: [number, number, string][] = proc.argv[2] ? [[Number(proc.argv[2]), Number(proc.argv[3] ?? 4700), proc.argv[4] ?? "winter"]] : [[1511948805, 4700, "winter"], [13, 300, "autumn"]];
  for (const [seed, secs, season] of cases) {
    const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial(), traffic = new Traffic(scene, mat, null) as any, crowd = new Crowd(scene, mat);
    const j = new Journey(readConfig({ seed } as any), 0, season as any);
    j.attachLife(new StreetLife(traffic, crowd, new Ambient(scene, mat)));
    let last = new Map<any, { x: number; z: number; h: number }>(), gone = 0;
    while (j.st.simTime < secs) {
      j.step();
      const now = new Set<any>(traffic.cars);
      for (const [c, p] of last) {
        if (now.has(c)) continue;
        gone++;
        const seen = !vehicleUnseen(j.plan.graph, j.pose, p.x, p.z, p.h, c.kind.len, c.kind.width);
        if (seen && errs.length < 10) errs.push(`seed ${seed} t=${j.st.simTime.toFixed(1)} (${j.st.mode}): a ${c.kind.id} vanished in sight of the truck, ${Math.hypot(p.x - j.pose.x, p.z - j.pose.z).toFixed(0)} m off, standing ${c.stillT.toFixed(0)} s`);
      }
      last = new Map([...now].map((c) => [c, { x: c.x, z: c.z, h: c.h }]));
    }
    console.log(`vanish: seed ${seed}, ${gone} cars gone in ${secs} s, ${errs.length} in sight of the truck`);
    if (gone < secs / 50) errs.push(`seed ${seed}: only ${gone} cars gone: too few to judge`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
