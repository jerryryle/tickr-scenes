// Test: no gridlock ever holds the truck for good. Replays cities where it once stood still in the
// street to the end of the city's slot (two boards' overnight runs): seed 2539665337's city 9, a
// car at its junction line waiting on one stuck behind the truck, and city 4; seed 3442198800's
// city 66, someone crossing in front of the truck waiting on it as it waited on them, and 58,
// where they rocked back and forth giving the crossing up; 59, an oncoming car waiting its turn
// through the junction on the truck as the truck waited on it, and 60; seed 659803215's city 15
// and seed 11's 19, a tractor whose trailer would swing in across a car standing in the next lane;
// seed 7's city 7; and seed 11's city 10, a street vendor in its way back into a bay.
// Held so (journey.ts JAM_HONK) the truck honks, to no avail; then the clowns come and carry off
// whatever holds it up (clowns.ts), as often as it takes. Fails if it stands still in the street
// (not at its stop) longer than HELD_MAX, or if a lot of clowns sent out finds nothing to lift.
// Run with arguments (seed, city) it replays that city alone, reporting each lot as it goes.
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT } from "../src/journey.ts";
import { StreetLife } from "../src/life.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
{
  const proc = (globalThis as any).process, argv: string[] = proc.argv.slice(2), HELD_MAX = 75, errs: string[] = [];
  const verbose = argv.length >= 2;
  const cases: number[][] = verbose ? [[Number(argv[0]), Number(argv[1])]] : [[2539665337, 9], [2539665337, 4], [3442198800, 66], [3442198800, 58], [3442198800, 59], [3442198800, 60], [659803215, 15], [11, 19], [7, 7], [11, 10]];
  for (const [seed, city] of cases) {
    const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial(), traffic = new Traffic(scene, mat, null), crowd = new Crowd(scene, mat);
    const period = new Journey(readConfig({ seed } as any), 0, "autumn").period;
    const j = new Journey(readConfig({ seed } as any), city * period, "autumn");
    j.attachLife(new StreetLife(traffic, crowd, new Ambient(scene, mat)));
    let held = 0, most = 0, at = 0, sent = 0, lifted = 0, seen = new Map<number, string>();
    while (j.st.simTime < (city + 1) * period - 1) {
      j.step();
      const t = j.st.simTime - city * period, lots = (crowd.clowns as any).waves as any[];   // (afresh: a load replaces it)
      for (const w of lots) if (seen.get(w.id) !== w.state) {
        if (w.state === "in") sent++;
        if (w.state === "lift") { if (w.load) lifted++; else if (errs.length < 10) errs.push(`seed ${seed} city ${city}: a lot of clowns found nothing to lift (at ${t.toFixed(0)} s)`); }
        if (verbose) console.log(`${t.toFixed(1)} s: lot ${w.id} ${w.state}${w.state === "in" ? ` for ${w.car >= 0 ? "car " + w.car : "someone on foot"} (held ${j.st.jamT!.toFixed(1)} s, ${j.st.mode}, off to the ${w.side < 0 ? "far" : "near"} side)` : w.state === "lift" && w.load ? ` ${"car" in w.load ? w.load.car.kind : "person"}` : ""}`);
      }
      seen = new Map(lots.map((w) => [w.id, w.state]));
      held = Math.abs(j.st.v) < 0.05 && ((j.st.mode === "drive" && j.st.stopS - j.st.s > 1) || (j.st.mode === "reverse" && j.st.s - j.st.backS > 0.05)) ? held + SIM_DT : 0;
      if (held > most) { most = held; at = j.st.simTime - city * period; }
    }
    console.log(`gridlock: seed ${seed} city ${city}, longest stand ${most.toFixed(0)} s (to ${at.toFixed(0)} s into the city), ${sent} lots of clowns sent, ${lifted} lifted something`);
    if (most > HELD_MAX) errs.push(`seed ${seed} city ${city}: the truck stood still in the street ${most.toFixed(0)} s (to ${at.toFixed(0)} s)`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
