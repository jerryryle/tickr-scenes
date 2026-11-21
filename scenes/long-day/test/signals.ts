// Test: runs the journey with its street life and fails if a vehicle's front crosses a stop line
// on red (right on red aside). Yellow is allowed: a car too close to stop goes through. And lights
// linked as one (signals.ts linkSignals) show a short street between them green at both ends
// together: most such streets, and every one signalsInStep says is.
// Args (all optional): minutes
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { StreetLife } from "../src/life.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
import { signalsInStep, signalState } from "../src/signals.ts";
import { CityPlan } from "../src/city.ts";
import { citySeedOf } from "../src/country.ts";
import { journeyStyle } from "../src/styles.ts";

{
  const proc = (globalThis as any).process;
  const minutes = Number(proc.argv[2] ?? 15);
  const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial();
  const traffic = new Traffic(scene, mat, null);
  const j = new Journey(readConfig({} as SceneEnv), 0, "autumn");
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
  // Linked lights: every short street between two lights of as many phases that signalsInStep says
  // is in step shows the same colour at both ends through a whole cycle; and most such streets are.
  let pairs = 0, inStep = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const P = new CityPlan(citySeedOf(seed, 0), journeyStyle(seed, 0)), G = P.graph;
    for (const A of G.nodes) for (const [ai, a] of A.arms.entries()) {
      const st = G.streets[a.street], B = G.nodes[a.end === 0 ? st.n1 : st.n0];
      if (A.control !== "signal" || B.control !== "signal" || A.id > B.id || A.phases !== B.phases || !st.inCity || st.ring) continue;
      const bi = B.arms.findIndex((b) => b.street === a.street && b.end !== a.end);
      if (bi < 0 || st.len - a.mouth - B.arms[bi].mouth > 18) continue;
      pairs++;
      if (!signalsInStep(A, A.phaseOf[ai], B, B.phaseOf[bi], P.seed)) continue;
      inStep++;
      for (let t = 0; t < 120; t += 0.5) {
        const sa = signalState(A, A.phaseOf[ai], t, P.seed, null), sb = signalState(B, B.phaseOf[bi], t, P.seed, null);
        if (sa !== sb) { errs.push(`seed ${seed}: lights ${A.id} and ${B.id}, in step, disagree at ${t} s (${sa}, ${sb})`); break; }
      }
    }
  }
  console.log(`signals: ${inStep} of ${pairs} short streets between lights in step, in 12 towns`);
  if (!pairs || inStep < pairs * 0.9) errs.push(`only ${inStep} of ${pairs} short streets between lights in step`);
  if (!tally.green) errs.push("no vehicle crossed a stop line on green");
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
