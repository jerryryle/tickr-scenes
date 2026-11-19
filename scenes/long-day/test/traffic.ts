// Test: traffic drives smoothly round a roundabout (citygen.ts, one-way ring streets) as through an
// ordinary signalled crossroads: no car moves further in a step than its speed takes it (a jump:
// a plan starting somewhere other than where the last one left it), and none turns faster than
// TURN_MAX (a snap: a turn squeezed tight, or taken too fast). Traffic alone, round each spot.
// And no gridlock: round signalled junctions in two cities, no car stands still for 60 s.
// Args (all optional): seed (its first city must have a roundabout)
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT } from "../src/journey.ts";
import { CityPlan } from "../src/city.ts";
import { citySeedOf } from "../src/country.ts";
import { journeyStyle } from "../src/styles.ts";
import { Traffic } from "../src/traffic.ts";
{
  const proc = (globalThis as any).process, seed = Number(proc.argv[2] ?? 3), TURN_MAX = 1.5, errs: string[] = [];
  void new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
  const plan = new CityPlan(citySeedOf(seed, 0), journeyStyle(seed, 0)), G = plan.graph;
  const ring = [...new Set(G.streets.filter((s) => s.oneway).map((s) => s.n0))];
  if (!ring.length) { console.error(`seed ${seed}: no roundabout in its first city`); proc.exit(1); }
  const rx = ring.reduce((a, n) => a + G.nodes[n].x, 0) / ring.length, rz = ring.reduce((a, n) => a + G.nodes[n].z, 0) / ring.length;
  const cross = G.nodes.filter((n) => n.control === "signal" && n.arms.length === 4).sort((a, b) => Math.hypot(a.x - rx, a.z - rz) - Math.hypot(b.x - rx, b.z - rz))[3];
  if (!cross) { console.error(`seed ${seed}: fewer than four signalled crossroads in its first city`); proc.exit(1); }
  for (const [name, cx, cz] of [["roundabout", rx, rz], ["crossroads", cross.x, cross.z]] as [string, number, number][]) {
    const T = new Traffic(new THREE.Scene(), new THREE.MeshBasicMaterial(), null), prev = new Map<number, { x: number; z: number; h: number }>();
    let jump = 0, yaw = 0, samples = 0;
    for (let i = 0; i < 3000; i++) {
      T.step(plan, i * SIM_DT, [], { x: cx, z: cz }, [], 0, []);
      for (const c of (T as any).cars) {
        const p = prev.get(c.id);
        if (p && Math.hypot(c.x - cx, c.z - cz) < 45) {
          samples++;
          jump = Math.max(jump, Math.hypot(c.x - p.x, c.z - p.z) - c.v * SIM_DT);
          yaw = Math.max(yaw, Math.abs(Math.atan2(Math.sin(c.h - p.h), Math.cos(c.h - p.h))) / SIM_DT);
        }
        prev.set(c.id, { x: c.x, z: c.z, h: c.h });
      }
    }
    console.log(`traffic, ${name}: ${samples} samples, worst jump ${jump.toFixed(2)} m, worst turn ${yaw.toFixed(2)} rad/s`);
    if (samples < 2000) errs.push(`${name}: only ${samples} samples (too little traffic to judge)`);
    if (jump > 0.2) errs.push(`${name}: a car jumped ${jump.toFixed(2)} m beyond its speed in one step`);
    if (yaw > TURN_MAX) errs.push(`${name}: a car turned at ${yaw.toFixed(2)} rad/s`);
  }
  // Gridlock: round six signalled junctions in two cities each, no car stands still for 60 s, as
  // two cars turning left across each other once did, or a queue blocking the junction. (No light
  // is red for more than 27 s, but a car that won't enter a junction it can't get out of, with the
  // next light along a short street red, rightly misses a green: about 45 s. A gridlock never
  // clears.)
  for (const gs of [3, 11]) {
    void new Journey(readConfig({ seed: gs } as SceneEnv), 0, "autumn");
    const P = new CityPlan(citySeedOf(gs, 0), journeyStyle(gs, 0)), GG = P.graph;
    let stuck = 0;
    for (const n of GG.nodes.filter((x) => x.control === "signal").filter((_, i) => i % 9 === 0).slice(0, 6)) {
      const T = new Traffic(new THREE.Scene(), new THREE.MeshBasicMaterial(), null), still = new Map<number, number>();
      for (let i = 0; i < 3000; i++) {
        T.step(P, i * SIM_DT, [], { x: n.x, z: n.z }, [], 0, []);
        for (const c of (T as any).cars) { const t = c.v < 0.2 ? (still.get(c.id) ?? 0) + SIM_DT : 0; still.set(c.id, t); if (t > 60 && t < 60 + SIM_DT * 1.5) stuck++; }
      }
    }
    console.log(`traffic, seed ${gs}: ${stuck} cars stood still 60 s round six signalled junctions`);
    if (stuck) errs.push(`seed ${gs}: ${stuck} cars stood still for 60 s (gridlock)`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
