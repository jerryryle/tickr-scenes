// Test: people cross the road and no vehicle runs into them. Runs journeys with their street life
// and fails if a moving vehicle's box (widened 0.2 m) takes in a pedestrian, if a vehicle stands
// still for a minute (but for waiting out the truck parked at a stop, or at a dead end, or queued
// behind one doing so, however far back), or if nobody crosses at all (people waiting for a gap
// that never comes).
// Args (all optional): minutes
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT } from "../src/journey.ts";
import { StreetLife } from "../src/life.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
{
  const proc = (globalThis as any).process, minutes = Number(proc.argv[2] ?? 6), errs: string[] = [];
  for (const seed of [659803215, 7, 3, 2, 8, 5, 11, 13]) {
    const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial(), traffic = new Traffic(scene, mat, null) as any, crowd = new Crowd(scene, mat) as any;
    const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
    j.attachLife(new StreetLife(traffic, crowd, new Ambient(scene, mat)));
    const was = new Map<unknown, string>(), still = new Map<number, number>();
    let hits = 0, crossings = 0, stuck = 0;
    while (j.st.simTime < minutes * 60) {
      j.step();
      if (j.st.mode === "country" || j.st.mode === "inbound") continue;
      for (const p of crowd.peds) { if (p.state === "cross" && was.get(p) === "wait") crossings++; was.set(p, p.state); }
      // (Those waiting out the truck unloading, parked across the lanes, or standing at the end of
      // their way with no way on; and those queued behind them, however far back.)
      const ends = new Set<number>(), dwell = j.st.mode === "dwell";
      for (const c of traffic.cars) if ((!c.next && c.s >= c.path.length - 0.6) || (dwell && Math.hypot(c.x - j.pose.x, c.z - j.pose.z) < 45)) ends.add(c.id);
      for (let k = 0; k < 8; k++) for (const c of traffic.cars) if (c.v < 0.1 && ends.has(c.blockedBy)) ends.add(c.id);
      for (const c of traffic.cars) {
        const fx = Math.cos(c.h), fz = -Math.sin(c.h), rx = Math.sin(c.h), rz = Math.cos(c.h);
        for (const p of crowd.peds) {
          const dx = p.x - c.x, dz = p.z - c.z;
          if (Math.abs(dx) > 8 || Math.abs(dz) > 8) continue;
          if (c.v > 0.3 && Math.abs(dx * fx + dz * fz) < c.kind.len / 2 + 0.2 && Math.abs(dx * rx + dz * rz) < c.kind.width / 2 + 0.2) {
            hits++;
            if (errs.length < 10) errs.push(`seed ${seed} at ${(j.st.simTime / 60).toFixed(2)} min: a ${c.kind.id} runs into a pedestrian (${p.state})`);
          }
        }
        // (Not waiting out the truck unloading, parked across the lanes, or the queue behind that;
        // nor standing at the end of its way with no way on, a cable car at the end of its line,
        // till it is out of the truck's sight (traffic.ts validMove), or queued behind one: ends.)
        const t = c.v < 0.1 && !ends.has(c.id) ? (still.get(c.id) ?? 0) + SIM_DT : 0;
        still.set(c.id, t);
        if (t > 60 && t <= 60 + SIM_DT) { stuck++; if (errs.length < 10) errs.push(`seed ${seed} at ${(j.st.simTime / 60).toFixed(2)} min: a ${c.kind.id} has stood still a minute`); }
      }
    }
    if (!crossings) errs.push(`seed ${seed}: nobody crossed the road in ${minutes} min`);
    console.log(`crossings: seed ${seed}, ${minutes} min, ${crossings} crossings, pedestrians hit ${hits}, vehicles stuck ${stuck}`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
