// Test: the parking officer (vignettes.ts ticket). At a journey's first ticketed kerb stop, starts
// the ticket afresh three times: with the truck staying, when the officer must come round the corner
// to the cab and write it (vignette time past 18 s); with the truck leaving as they set off, when they
// must be gone while still round the corner, out of sight (never at the cab); and with the truck
// leaving to where it can see down their side street, when they must not vanish in its view.
// Args (all optional): seed
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT } from "../src/journey.ts";
import { StreetLife } from "../src/life.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
import type { KerbParked } from "../src/vignettes.ts";
import { outOfSight } from "../src/citygraph.ts";
// (Where the officer is with `back` metres of their way still to go: their way is the polyline of
// four points at v.c[5..12], as vignettes.ts alongPts reads it.)
function onWay(c: number[], back: number): [number, number] {
  for (let i = 11; i > 5; i -= 2) {
    const L = Math.hypot(c[i] - c[i - 2], c[i + 1] - c[i - 1]);
    if (back <= L || i === 7) { const u = L > 0 ? Math.max(0, 1 - back / L) : 1; return [c[i - 2] + (c[i] - c[i - 2]) * u, c[i - 1] + (c[i + 1] - c[i - 1]) * u]; }
    back -= L;
  }
  return [c[5], c[6]];
}
{
  const proc = (globalThis as any).process, seed = Number(proc.argv[2] ?? 777), errs: string[] = [];
  const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial(), crowd = new Crowd(scene, mat);
  const j = new Journey(readConfig({ seed } as any), 0, "autumn");
  j.attachLife(new StreetLife(new Traffic(scene, mat, null), crowd, new Ambient(scene, mat)));
  let tk: any = null;
  while (!tk && j.st.simTime < 3600) { j.step(); tk = ((crowd as any).vig.list as any[]).find((v) => v.k === "ticket"); }
  if (!tk) { console.error(`seed ${seed}: no ticket in the first hour`); proc.exit(1); }
  const parked: KerbParked = { x: j.pose.x, z: j.pose.z, h: j.pose.h, cabX: tk.st[2], cabZ: tk.st[3] };
  const eye = { x: j.pose.x, z: j.pose.z, h: j.pose.h };
  for (const run of ["staying", "leaving", "leaving, in view"] as const) {
    const V = new Crowd(scene, mat).vig as any, t0 = j.st.simTime, leaves = run !== "staying";
    // (Pulled away: 20 m on along the street; or, for the officer in view, as if it stood down the
    // side street they come from, 15 m beyond where they set off, looking up it at them.)
    let away = { x: eye.x + Math.cos(eye.h) * 20, z: eye.z - Math.sin(eye.h) * 20, h: eye.h };
    const inp = (t: number, p: KerbParked | null) => ({ plan: j.plan, simTime: t, prs: [], focus: eye, truck: [], cars: [], peds: [], parked: p, busy: new Set<string>(), eye: p ? eye : away });
    V.G = j.plan.graph;
    V.spawnTicket(V.ctx(inp(t0, parked), t0), parked);
    const v = V.list.find((x: any) => x.k === "ticket");
    if (!v) { errs.push(`seed ${seed}: the ticket wasn't started again at the same stop`); break; }
    if (run === "leaving, in view") {
      const dx = v.c[5] - v.c[7], dz = v.c[6] - v.c[8], L = Math.hypot(dx, dz);
      away = { x: v.c[5] + dx / L * 15, z: v.c[6] + dz / L * 15, h: Math.atan2(dz, -dx) };
    }
    const tv0 = v.t;   // (negative: the walk from round the corner, before the old 13 m)
    let most = -Infinity, gone = NaN;
    for (let i = 0; i < 900 && Number.isNaN(gone); i++) {
      const t = t0 + i * SIM_DT;
      V.step(inp(t, leaves && i > 0 ? null : parked));
      if (!V.list.includes(v)) gone = v.t;
      else most = Math.max(most, v.t);
    }
    if (!j.plan.graph.sightBlocked(eye.x, eye.z, v.c[5], v.c[6])) errs.push(`seed ${seed}: the officer sets off in sight of the truck`);
    if (run === "staying" && most < 18.5) errs.push(`seed ${seed}: with the truck there, the officer never wrote the ticket (got to ${most.toFixed(1)} s)`);
    if (run === "leaving" && !(gone < 12)) errs.push(`seed ${seed}: with the truck gone, the officer ${Number.isNaN(gone) ? "stayed" : "got to the cab"}`);
    if (leaves && gone < 12) { const [x, z] = onWay(v.c, (12 - gone) * 1.08); if (!outOfSight(j.plan.graph, away, x, z)) errs.push(`seed ${seed}: the officer was gone in sight of the truck (${run})`); }
    console.log(`ticket, truck ${run}: a ${(12.96 - tv0 * 1.08).toFixed(1)} m walk, ${Number.isNaN(gone) ? `got to ${most.toFixed(1)} s` : `gone at ${gone.toFixed(1)} s`}`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
