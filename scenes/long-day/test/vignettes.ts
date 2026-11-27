// Test: the street vignettes (vignettes.ts). Drives a focus along the streets of a few cities at
// several hours, seasons and weathers, stopping at the kerb now and then (a parked truck), with
// the crowd stepping and drawing as in the scene. Fails on an exception, a non-finite position,
// or if reloading a save and replaying does not reproduce the street life exactly. Reports which
// vignettes appeared.
import * as THREE from "three@0.187.0";
import { CityPlan } from "../src/city.ts";
import { STYLES } from "../src/styles.ts";
import { citiesOfStyle } from "../src/visits.ts";
import type { StyleId } from "../src/styles.ts";
import { Crowd } from "../src/crowd.ts";
import { CLOCK, VIG_KINDS } from "../src/vignettes.ts";
import type { KerbParked } from "../src/vignettes.ts";
import { SIM_DT } from "../src/journey.ts";
import { FIG_STYLE } from "../src/figure.ts";

const proc = (globalThis as any).process;
const runs: [StyleId, number, string, string, boolean][] = [
  ["coastal", 12, "summer", "clear", false], ["metro", 11, "spring", "cloudy", false], ["brick", 8.2, "autumn", "clear", false],
  ["mainstreet", 22, "summer", "clear", false], ["metro", 21.5, "autumn", "cloudy", false], ["port", 14, "summer", "rain", false],
  ["brick", 12, "winter", "snow", true], ["mainstreet", 15, "summer", "clear", false], ["coastal", 7, "summer", "clear", false],
  ["metro", 8.5, "spring", "clear", false], ["coastal", 9, "autumn", "cloudy", false], ["port", 7.6, "summer", "clear", false],
  ["mainstreet", 10.5, "summer", "clear", false], ["desert", 16, "spring", "clear", false],
  ["victorian", 12, "summer", "clear", false], ["victorian", 18.5, "autumn", "cloudy", false], ["victorian", 9, "winter", "rain", false], ["victorian", 16, "winter", "cloudy", false],
];
const seen = new Map<string, number>();
let failed = false;
const fail = (m: string) => { console.log("FAIL " + m); failed = true; };

for (const [i, [style, hour, season, weather, snow]] of runs.entries()) {
  const towns = citiesOfStyle(style), plan = new CityPlan(towns[i % towns.length].key, STYLES[style]);   // (the catalogue's cities of the style in turn)
  plan.climate = { season: season as any, weather: weather as any, snowCover: snow };
  CLOCK.hourAt = () => hour;
  FIG_STYLE.victorian = style === "victorian";   // (dressed as main.ts dresses them)
  const crowd = new Crowd(new THREE.Scene(), new THREE.MeshLambertMaterial({ vertexColors: true }), new THREE.MeshLambertMaterial({ vertexColors: true }));   // (with the props material, as in the scene)
  crowd.reset(77 + i);
  // The focus: along a street's kerb lane, east, a row of blocks at a time; parked for 40 s of
  // every 100. (From the node keyed (-8, iz): on the grid, column -8 of row iz.)
  const G = plan.graph, node = (iz: number) => G.node(-8, iz) ?? G.nodes[0];
  const at = (k: number) => {
    const t = k * SIM_DT, cyc = t % 100, row = Math.floor(t / 100) % 6;
    const moving = Math.min(cyc, 60) * 6, n0 = node(-3 + row * 2);
    const x = n0.x + 20 + moving + row * 37, z = n0.z + 4.5;
    const parked: KerbParked | null = cyc > 62 ? { x, z, h: 0, cabX: x + 5, cabZ: z } : null;
    return { x, z, parked, t };
  };
  const step = (k: number) => {
    const f = at(k);
    crowd.step(plan, f.t, [], { x: f.x, z: f.z }, [{ x: f.x, z: f.z, r: 1.3, still: !!f.parked }, { x: f.x + 5, z: f.z, r: 1.3, still: !!f.parked }], { cars: [], parked: f.parked, busy: new Set() });
  };
  const N = 2400, SNAP = 1200, END = 1800;
  let snap = "", end = "";
  try {
    for (let k = 0; k < N; k++) {
      if (k === SNAP) snap = JSON.stringify(crowd.save());
      step(k);
      if (k === END) end = JSON.stringify(crowd.save());
      if (k % 7 === 0) {
        crowd.draw(0.5, k * SIM_DT);
        // No prop left out for want of room in the big-box mesh (Figures.bigMesh).
        for (const [who, F] of [["vignettes", crowd.vig.F], ["crowd", (crowd as any).F]] as const) {
          const bm = F.bigMesh!;
          if (F.b >= bm.instanceMatrix.count) fail(`${style} ${hour}h: ${F.b} big boxes fill the ${who} props mesh (${bm.instanceMatrix.count})`);
        }
      }
      for (const kd of crowd.vig.kinds()) seen.set(kd, (seen.get(kd) ?? 0) + 1);
      const s = crowd.save() as any;
      for (const v of s.vig.list) if (![v.a, v.n, v.t, ...v.st].every(Number.isFinite)) { fail(`${style} ${hour}h: ${v.k} has a non-finite state`); break; }
      for (const p of s.peds) if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) { fail(`${style} ${hour}h: a pedestrian at a non-finite position`); break; }
    }
    // Replay from the snapshot: the same street life.
    crowd.load(JSON.parse(snap));
    for (let k = SNAP; k <= END; k++) step(k);
    if (JSON.stringify(crowd.save()) !== end) fail(`${style} ${hour}h ${season}/${weather}: replaying from a save differs`);
  } catch (e) { fail(`${style} ${hour}h ${season}/${weather}: ${(e as Error).stack}`); }
}
console.log("vignettes seen (steps alive): " + VIG_KINDS.map((k) => `${k} ${seen.get(k) ?? 0}`).join(", "));
const missing = VIG_KINDS.filter((k) => !seen.has(k));
if (missing.length) console.log("never appeared: " + missing.join(", "));
if (failed) proc.exit(1);
