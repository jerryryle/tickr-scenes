// Test: traffic through busy junctions never overlaps and never gets stuck. Runs the traffic alone
// round each junction below for 5 minutes (as the truck would see it, focused there) and fails if
// two vehicles' boxes overlap by more than OVERLAP_MAX, or a vehicle stands still for a minute.
// The junctions: an all-way stop that once deadlocked (seed 7, node 63), signalled junctions where
// left turns once cut across oncoming cars and cars once turned from the passing lane (seed 3),
// and others from the layouts (warped, organic, roundabouts).
// Args (all optional): seconds
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT } from "../src/journey.ts";
import { CityPlan } from "../src/city.ts";
import { citySeedOf } from "../src/country.ts";
import { journeyStyle } from "../src/styles.ts";
import { Traffic } from "../src/traffic.ts";
{
  const proc = (globalThis as any).process, secs = Number(proc.argv[2] ?? 300), OVERLAP_MAX = 0.3, errs: string[] = [];
  // (Two boxes' separation along their axes: negative, how deep they overlap.)
  const box = (C: any) => { const fx = Math.cos(C.h), fz = -Math.sin(C.h), rx = Math.sin(C.h), rz = Math.cos(C.h), L = C.kind.len / 2, W = C.kind.width / 2; return [[-L, -W], [L, -W], [L, W], [-L, W]].map(([u, v]) => [C.x + fx * u + rx * v, C.z + fz * u + rz * v]); };
  const gapOf = (A: any, B: any) => {
    const pa = box(A), pb = box(B);
    let gap = -Infinity;
    for (const P of [pa, pb]) for (let k = 0; k < 4; k++) {
      const [x0, z0] = P[k], [x1, z1] = P[(k + 1) % 4], l = Math.hypot(x1 - x0, z1 - z0), nx = (z1 - z0) / l, nz = -(x1 - x0) / l;
      const qa = pa.map(([x, z]) => x * nx + z * nz), qb = pb.map(([x, z]) => x * nx + z * nz);
      gap = Math.max(gap, Math.min(...qb) - Math.max(...qa), Math.min(...qa) - Math.max(...qb));
    }
    return gap;
  };
  for (const [seed, city, spot] of [[7, 0, 63], [3, 0, 1], [11, 0, 1], [3, 1, 1], [2, 0, 18], [5, 0, 1], [8, 0, 478], [13, 0, 1]]) {
    void new Journey(readConfig({ seed } as SceneEnv), 0);   // (sets the city limits the plan reads)
    const plan = new CityPlan(citySeedOf(seed, city), journeyStyle(seed, city)), n = plan.graph.nodes[spot];
    if (!n) { errs.push(`seed ${seed} city ${city}: no node ${spot}`); continue; }
    const T = new Traffic(new THREE.Scene(), new THREE.MeshBasicMaterial(), null) as any;
    const still = new Map<number, number>();
    let worst = 0, stuck = 0;
    for (let i = 0; i < secs / SIM_DT; i++) {
      T.step(plan, i * SIM_DT, [], { x: n.x, z: n.z }, [], 0, []);
      const cs = T.cars as any[];
      for (const c of cs) {
        const t = c.v < 0.1 ? (still.get(c.id) ?? 0) + SIM_DT : 0;
        still.set(c.id, t);
        if (t > 60 && t <= 60 + SIM_DT) { stuck++; if (errs.length < 10) errs.push(`seed ${seed} city ${city} node ${spot} at ${(i * SIM_DT).toFixed(0)} s: a ${c.kind.id} has stood still a minute`); }
      }
      for (let a = 0; a < cs.length; a++) for (let b = a + 1; b < cs.length; b++) {
        if (Math.abs(cs[a].x - cs[b].x) > 8 || Math.abs(cs[a].z - cs[b].z) > 8) continue;
        const g = -gapOf(cs[a], cs[b]);
        if (g > worst) worst = g;
        if (g > OVERLAP_MAX && errs.length < 10) errs.push(`seed ${seed} city ${city} node ${spot} at ${(i * SIM_DT).toFixed(1)} s: a ${cs[a].kind.id} and a ${cs[b].kind.id} overlap by ${g.toFixed(2)} m`);
      }
    }
    console.log(`junctions: seed ${seed} city ${city} node ${spot}, ${secs} s, deepest overlap ${worst.toFixed(2)} m, stuck ${stuck}`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
