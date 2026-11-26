// Test: a visit captured from a journey plays the same from its spec alone. Plays visit N of a
// seeded journey, street life and the crew with it, and writes down its spec as it goes
// (journey.ts captureSpecs); then plays that spec as the first visit of a journey with another
// seed, and compares the two step by step through the city: the truck's mode, place and stops,
// the lights it asks to change, each stop's chores, and every so often the driver's and the
// worker's places. Fails at the first step where they differ.
// Args (all optional): seed:visit ... With none, a few visits of a few seeds.
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT, setDoorProbe, setParkedProbe, setPavementProbe } from "../src/journey.ts";
import type { Pose } from "../src/route.ts";
import { kerbDoors, parkedObstacles, pavementObstacles } from "../src/city.ts";
import { Truck, TruckKit } from "../src/truck.ts";
import type { TruckModel } from "../src/truck.ts";
import { Crew } from "../src/crew.ts";
import { StreetLife } from "../src/life.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
import type { VisitSpec } from "../src/visits.ts";

const proc = (globalThis as any).process;
setDoorProbe(kerbDoors); setPavementProbe(pavementObstacles); setParkedProbe(parkedObstacles);
const CASES = proc.argv.length > 2 ? proc.argv.slice(2) : ["12:1", "7:3", "1:2", "24:4"];
const CREW_EVERY = 10;   // (steps between comparing the crew's places)
const kit = new TruckKit(new Proxy({}, { get: () => ({ width: 1, height: 1 }) }) as any);

// A journey played with street life and the crew, one step at a time, and what each step shows.
class Run {
  readonly j: Journey; private crew: Crew; private trucks = new Map<TruckModel, Truck>(); private scene = new THREE.Scene(); private pose = {} as Pose;
  private dwellKey = "";
  constructor(seed: number, t: number, visits?: Record<number, VisitSpec>) {
    this.j = new Journey(readConfig({ seed } as SceneEnv), t, "autumn", visits);
    const mat = new THREE.MeshBasicMaterial();
    this.j.attachLife(new StreetLife(new Traffic(this.scene, mat, null), new Crowd(this.scene, mat), new Ambient(this.scene, mat)));
    this.crew = new Crew(this.scene, new THREE.MeshLambertMaterial());
  }
  private spares = new Map<TruckModel, Truck>();
  private truckFor(m: TruckModel, map = this.trucks) { let t = map.get(m); if (!t) { t = new Truck(kit, m, null); this.scene.add(t.root); map.set(m, t); } return t; }
  // One step; what it shows, as text.
  step(k: number): string {
    const j = this.j; j.step();
    const st = j.st, p = j.renderPose(this.pose), s = st.stops[0];
    let line = `${st.mode} ${p.x.toFixed(3)},${p.z.toFixed(3)},${p.h.toFixed(4)} ${st.truck} ${s ? `${s.kind}@${s.site ? `${s.site.bx},${s.site.bz}` : "-"}:${s.cargo}x${s.units}` : "-"} pre${st.preempt.length} aboard${j.aboardUnits}`;
    if (st.mode === "dwell") {
      const key = `${st.stopsDone}`;
      if (key !== this.dwellKey) { this.dwellKey = key; line += ` chores ${JSON.stringify(j.chores)}`; }
      const truck = this.truckFor(st.truck); truck.follow(p.x, p.z, p.h, p.k, 0);
      { const l = j.truckLift(truck.wheelbase); truck.setGrade(l.y, l.grade); }
      // (The spare at a swap, or the old truck parked there: as crewmotion.ts has them.)
      let other: Truck | null = null;
      const om = st.spare ?? st.parked?.model ?? null;
      if (om) {
        other = om === st.truck ? this.truckFor(om, this.spares) : this.truckFor(om);
        const q = {} as Pose;
        if (st.spare) j.sparePose(q); else { q.x = st.parked!.x; q.z = st.parked!.z; q.h = st.parked!.h; }
        other.follow(q.x, q.z, q.h, 0, 0);
      }
      this.crew.update(SIM_DT, j, truck, other, new THREE.PerspectiveCamera());
      if (k % CREW_EVERY === 0) {
        const d = this.crew.driver.root.position, w = this.crew.helper.root.position;
        line += ` driver ${d.x.toFixed(3)},${d.y.toFixed(3)},${d.z.toFixed(3)}${this.crew.helper.root.visible ? ` worker ${w.x.toFixed(3)},${w.y.toFixed(3)},${w.z.toFixed(3)}` : ""}`;
      }
    } else this.dwellKey = "";
    return line;
  }
}

let failed = 0;
for (const cs of CASES) {
  const [seed, N] = cs.split(":").map(Number);
  const t0 = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn").nominalStart(N);
  // The visit from its journey: every step's line, and its spec as it leaves town.
  const A = new Run(seed, t0), lines: string[] = [];
  let specs: [VisitSpec, VisitSpec] | null = null;
  for (let k = 0; A.j.st.city === N && k < 200000; k++) {
    lines.push(A.step(k));
    if (!specs && A.j.st.mode === "country") specs = A.j.captureSpecs();
  }
  if (!specs) { console.log(`FAIL ${cs}: never left town`); failed++; continue; }
  // The same visit from its spec alone, as the first visit of another journey.
  const B = new Run(seed + 7919, 0, { 0: specs[0], 1: specs[1] });
  let bad = "";
  for (let k = 0; k < lines.length && B.j.st.city === 0; k++) {
    const line = B.step(k);
    if (line !== lines[k]) { bad = `step ${k} (${(k * SIM_DT).toFixed(1)} s in):\n      seeded:    ${lines[k].slice(0, 400)}\n      from spec: ${line.slice(0, 400)}`; break; }
  }
  const stops = specs[0].stops!.reduce((a, b) => a + b.stops.length, 0);
  if (bad) { failed++; console.log(`FAIL ${cs} (${specs[0].city}): differs at ${bad}`); }
  else console.log(`ok   ${cs} (${specs[0].city}, ${stops} stops, ${lines.length} steps)`);
}
if (failed) { console.log(`${failed} of ${CASES.length} visits differ`); proc.exit(1); }
