// Test: runs the journey with its street life and fails if a vehicle's front crosses a stop line
// on red (right on red aside). Yellow is allowed: a car too close to stop goes through.
// Args (all optional): minutes
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { StreetLife } from "../src/life.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
import { signalState } from "../src/signals.ts";

{
  const proc = (globalThis as any).process;
  const minutes = Number(proc.argv[2] ?? 15);
  const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial();
  const traffic = new Traffic(scene, mat, null);
  const j = new Journey(readConfig({} as SceneEnv), 0);
  j.attachLife(new StreetLife(traffic, new Crowd(scene, mat), new Ambient(scene, mat)));
  const prev = new Map<number, { s: number; path: unknown }>();
  const tally: Record<string, number> = {};
  const errs: string[] = [];
  while (j.st.simTime < minutes * 60) {
    j.step();
    for (const c of (traffic as any).cars as any[]) {
      const pv = prev.get(c.id), half = c.kind.len / 2;
      if (pv && pv.path === c.path) for (const sg of c.path.signals) {
        if (!(pv.s + half < sg.sLine && c.s + half >= sg.sLine)) continue;
        const N = j.plan.graph.nodes[sg.node], state = signalState(N, sg.phase, j.st.simTime, j.plan.seed, j.st.preempt);
        const k = state === "red" && sg.move === "R" ? "red-right" : state;
        tally[k] = (tally[k] ?? 0) + 1;
        if (k === "red" && errs.length < 20)
          errs.push(`t${j.st.simTime.toFixed(1)} ${c.kind.id} #${c.id} ran the red at node ${N.kx},${N.kz} (move ${sg.move}, ${c.v.toFixed(1)} m/s)`);
      }
      prev.set(c.id, { s: c.s, path: c.path });
    }
  }
  console.log(`signals: ${minutes} min, stop-line crossings ${JSON.stringify(tally)}`);
  if (!tally.green) errs.push("no vehicle crossed a stop line on green");
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
