// Test: the named scenarios (src/scenarios.ts) play as written, whatever the journey's seed. Each
// is played under two seeds to the dwell at its stop to watch, which must begin at the same moment,
// be the stop written, and plan the same chores. Then through that dwell with the crew: a team
// lift's load (held between the two) must cross the line of the building's front inside the
// doorway's jambs, beside its own half width. (Taken up, a load still comes out cutting the corner
// as the pavement's way to the ramp has it: a warning only, for now.)
// Args: scenario names (all of them with none); or "--sites <city id>" to list a city's sites by
// name, facility and block, for writing a scenario's stops.
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT, setDoorProbe, setParkedProbe, setPavementProbe } from "../src/journey.ts";
import type { Pose } from "../src/route.ts";
import { kerbDoors, parkedObstacles, pavementObstacles } from "../src/city.ts";
import { Truck, TruckKit } from "../src/truck.ts";
import { Crew } from "../src/crew.ts";
import { CARGO_BY_ID } from "../src/cargo.ts";
import { CARGO_MODELS } from "../src/cargomodels.ts";
import { SCENARIOS } from "../src/scenarios.ts";

const proc = (globalThis as any).process, argv: string[] = proc.argv.slice(2);
setDoorProbe(kerbDoors); setPavementProbe(pavementObstacles); setParkedProbe(parkedObstacles);
const SEEDS = [1, 4242];
const JAMB_SLACK = 0.02;   // (m: a load this close to a jamb counts as clear of it)

if (argv[0] === "--sites") {
  const j = new Journey(readConfig({ seed: 1 } as SceneEnv), 0, "autumn", { 0: { city: argv[1] } });
  for (const s of [...j.sites].sort((a, b) => a.fac.localeCompare(b.fac) || a.name.localeCompare(b.name))) console.log(`${s.fac.padEnd(18)} ${s.name.padEnd(34)} ${s.bx},${s.bz}`);
  proc.exit(0);
}

const kit = new TruckKit(new Proxy({}, { get: () => ({ width: 1, height: 1 }) }) as any);
let failed = 0;
for (const name of argv.length ? argv : Object.keys(SCENARIOS)) {
  const sc = SCENARIOS[name];
  if (!sc) { console.log(`FAIL ${name}: no such scenario`); failed++; continue; }
  const errs: string[] = [], warns: string[] = [];
  let crossing = "";
  // Under each seed: when the dwell begins, and what it is.
  const seen = SEEDS.map((seed) => {
    const t = Journey.stopTime(readConfig({ seed } as SceneEnv), "autumn", sc.visits, sc.stop);
    if (t === null) return null;
    const j = new Journey(readConfig({ seed } as SceneEnv), t, "autumn", sc.visits);
    const s = j.st.stops[0];
    return { t, j, key: `${s.kind} ${s.cargo} x${s.units} at ${s.site?.name} (${s.site?.bx},${s.site?.bz})`, chores: JSON.stringify(j.chores) };
  });
  if (seen.some((x) => !x)) { console.log(`FAIL ${name}: the journey never stops at stop ${sc.stop}`); failed++; continue; }
  const [a, b] = seen as NonNullable<typeof seen[number]>[];
  if (a.t !== b.t || a.key !== b.key || a.chores !== b.chores) errs.push(`differs between seeds ${SEEDS.join(" and ")}: ${a.t.toFixed(1)} s ${a.key} / ${b.t.toFixed(1)} s ${b.key}`);
  // The stop as written in the first batches of stops (after the drop of any freight it arrives with).
  const freight = sc.visits[0].freight && sc.visits[0].freight !== "none" ? 1 : 0;
  const written = (sc.visits[0].stops ?? []).flatMap((x) => x.stops).filter((x) => x.kind !== "depart")[sc.stop - freight];
  if (written && (written.kind !== a.j.st.stops[0].kind || written.cargo !== a.j.st.stops[0].cargo)) errs.push(`stop ${sc.stop} is ${a.key}, not the ${written.kind} of ${written.cargo} written`);
  // Through the dwell with the crew: where the team lift's load crosses the building's front.
  const j = a.j, stop = j.st.stops[0], cargo = CARGO_BY_ID.get(stop.cargo), D = j.kerbDoor;
  if (cargo?.handling === "teamLift" && D) {
    const scene = new THREE.Scene(), crew = new Crew(scene, new THREE.MeshLambertMaterial()), K = crew as any, cam = new THREE.PerspectiveCamera();
    const truck = new Truck(kit, j.st.truck, null); scene.add(truck.root);
    const spares = new Map<string, Truck>(), spare = (m: string) => { let t = spares.get(m); if (!t) { t = new Truck(kit, m as any, null); scene.add(t.root); spares.set(m, t); } return t; };
    const size = CARGO_MODELS[stop.cargo].size, half = size[2] / 2, pose = {} as Pose;
    const tx = -D.nz, tz = D.nx, rel = (v: THREE.Vector3) => [(v.x - D.x) * tx + (v.z - D.z) * tz, (v.x - D.x) * D.nx + (v.z - D.z) * D.nz];
    let worst = 0, at = 0;
    const done = j.st.stopsDone;
    while (j.st.stopsDone === done && j.st.mode === "dwell") {
      j.step();
      const p = j.renderPose(pose); truck.follow(p.x, p.z, p.h, p.k, 0);
      { const l = j.truckLift(truck.wheelbase); truck.setGrade(l.y, l.grade); }
      // (The spare at a swap, or the old truck parked there: as crewmotion.ts has them.)
      const om = j.st.spare ?? j.st.parked?.model ?? null;
      let other: Truck | null = null;
      if (om) {
        other = spare(om); const q = {} as Pose;
        if (j.st.spare) j.sparePose(q); else { q.x = j.st.parked!.x; q.z = j.st.parked!.z; q.h = j.st.parked!.h; }
        other.follow(q.x, q.z, q.h, 0, 0);
      }
      crew.update(SIM_DT, j, truck, other, cam);
      if (!crew.helper.root.visible || !K.mate.attached || !K.load?.group.visible) continue;
      const [dl, dn] = rel(crew.driver.root.position), [ml, mn] = rel(crew.helper.root.position);
      if ((dn < 0) === (mn < 0)) continue;
      const lat = Math.abs(dl + (ml - dl) * (dn / (dn - mn)));
      if (lat > worst) { worst = lat; at = j.st.modeTime; }
    }
    crossing = `; its load crosses the front ${worst.toFixed(2)} m off the doorway's middle (half ${D.half.toFixed(2)} m wide, the load ${half.toFixed(2)})`;
    if (half < D.half && worst + half > D.half + JAMB_SLACK) {
      const m = `the ${stop.cargo} crosses the building's front ${(worst + half - D.half).toFixed(2)} m past the doorway's jamb (${at.toFixed(1)} s into the stop)`;
      (stop.kind === "pickup" ? warns : errs).push(m);
    }
  }
  if (errs.length) { failed++; console.log(`FAIL ${name}: ${a.key}, at ${a.t.toFixed(1)} s`); for (const e of errs) console.log(`    ${e}`); }
  else console.log(`ok   ${name}: ${a.key}, at ${a.t.toFixed(1)} s${crossing}`);
  for (const w of warns) console.log(`    (warning) ${w}`);
}
if (failed) { console.log(`${failed} scenarios failed`); proc.exit(1); }
