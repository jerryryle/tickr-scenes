// The road maps (docs/long-day-cities.md, "Road maps"): every world road's map is well formed, and the
// road driven from b to a is the same road as driven from a to b: placed so their gate b ends meet,
// each point, ground height and land of one is the other's turned half round (to 2 cm: the
// headings are held to a microradian).
import { CountryRoad, roadMetres } from "../src/country.ts";
import { STYLES } from "../src/styles.ts";
import type { StyleId } from "../src/styles.ts";
import type { Climate } from "../src/climate.ts";
import { CATALOGUE } from "../src/world.ts";
import { WORLD_ROADS } from "../src/world-roads.ts";
import { roadMapOf } from "../src/roadmap.ts";
import type { RoadItems } from "../src/roadmap.ts";
import { CityPlan, gateEnd } from "../src/city.ts";
import { freewayGate } from "../src/freeway.ts";

{
  const proc = (globalThis as any).process, errs: string[] = [];
  const err = (m: string) => { if (errs.length < 60) errs.push(m); };
  const c: Climate = { season: "autumn", weather: "clear", snowCover: false };
  const STRIDE: Record<keyof RoadItems, number> = { trees: 4, rocks: 2, ponds: 2, turbines: 2, pylons: 1, farms: 2, cows: 2, poles: 1, fences: 2 };
  let pts = 0;
  const plans = new Map<string, CityPlan>();
  for (const r of WORLD_ROADS) {
    const M = roadMapOf(r), A = CATALOGUE.find((F) => F.id === r.a.city)!, B = CATALOGUE.find((F) => F.id === r.b.city)!;
    if (M.id !== r.id) err(`${r.id}: its map is ${M.id}'s`);
    if (M.heading.length !== M.height.length || M.hill.length !== M.heading.length) err(`${r.id}: its samples disagree in number`);
    if ((M.heading.length - 1) * 2 < M.length + 80) err(`${r.id}: its samples stop short of gate b`);
    if (M.blend.length * 10 < M.length) err(`${r.id}: its land stops short of gate b`);
    if (roadMetres(r) < 600) err(`${r.id}: ${roadMetres(r)} m is too short a drive`);
    for (const p of M.pieces) {
      if (p.way !== 1 && p.way !== -1) err(`${r.id}: a ${p.kind} faces no way`);
      if (p.s < 0 || p.s + p.len > M.length + 2000) err(`${r.id}: a ${p.kind} off the road at ${p.s}`);
      if (r.oneway && p.way !== 1) err(`${r.id}: a ${p.kind} faces b to a on a road driven only a to b`);
    }
    for (const way of r.oneway ? [1] : [1, -1]) for (const k of ["leave", "welcome"]) if (!M.pieces.some((p) => p.kind === k && p.way === way)) err(`${r.id}: no ${k} sign facing ${way > 0 ? "a to b" : "b to a"}`);
    for (const k of Object.keys(STRIDE) as (keyof RoadItems)[]) {
      const L = M.items[k], st = STRIDE[k];
      if (L.length % st) err(`${r.id}: its ${k} list is ragged`);
      for (let i = st; i < L.length; i += st) if (L[i] < L[i - st]) { err(`${r.id}: its ${k} out of order at ${L[i] / 10} m`); break; }
    }
    // Driven each way, placed so the two meet at gate b. (Each city's freeway out in the land, as
    // the journey gives them: Journey.roadInputs.)
    const plan = (F: typeof A) => { let P = plans.get(F.id); if (!P) { plans.set(F.id, P = new CityPlan(F.key, STYLES[F.style as StyleId])); void P.graph; } return P; };
    const PA = plan(A), PB = plan(B), ga = PA.graph.gates[A.gates.findIndex((g) => g?.id === r.a.gate)]!, gb = PB.graph.gates[B.gates.findIndex((g) => g?.id === r.b.gate)]!;
    const fw = (P: CityPlan) => freewayGate(P.seed) ? P.fwCurve : null;
    const inp = (back: boolean) => ({
      seed: 0, city: 0, kind: "exit" as const, map: M, back, driveSeed: 1, dEst: 0, fromTruck: "box16" as const, toTruck: "box16" as const,
      fromStyle: STYLES[(back ? B : A).style as StyleId], toStyle: STYLES[(back ? A : B).style as StyleId], fromName: "", toName: "",
      fromClimate: c, toClimate: c, fromCurve: fw(back ? PB : PA), toCurve: fw(back ? PA : PB), toGateEnd: freewayGate((back ? PA : PB).seed) ? gateEnd(back ? ga : gb) : null,
      fromKey: (back ? B : A).key, toKey: (back ? A : B).key, toFreeway: false,
    });
    const F = new CountryRoad({ ...inp(false), frame: gateEnd(ga) }), q = { x: 0, z: 0, h: 0, k: 0 }, w = { x: 0, z: 0, h: 0, k: 0 };
    F.center(F.gateS, q);
    if (r.oneway) continue;
    // (Each drive in its own city's coordinates, as the journey places them: b's are a's moved so
    // the road's end meets b's gate.)
    const eb = gateEnd(gb), dx = q.x - eb.x, dz = q.z - eb.z;
    if (Math.abs(Math.atan2(Math.sin(q.h + Math.PI - eb.h), Math.cos(q.h + Math.PI - eb.h))) > 1e-6) err(`${r.id}: it reaches gate b ${(q.h + Math.PI - eb.h).toFixed(4)} rad askew`);
    const Bk = new CountryRoad({ ...inp(true), frame: eb }), L = M.length;
    for (let s = 0; s <= L; s += 37) for (const n of [-120, -30, 0, 14, 90]) {
      F.point(s, n, q); Bk.point(L - s, -n, w); pts++;
      const d = Math.hypot(q.x - w.x - dx, q.z - w.z - dz);
      if (d > 0.02) { err(`${r.id}: s${s} n${n} lies ${d.toFixed(3)} m apart the two ways`); break; }
      const dg = Math.abs(F.groundAt(s, n) - Bk.groundAt(L - s, -n));
      if (dg > 0.02) { err(`${r.id}: the ground at s${s} n${n} differs the two ways by ${dg.toFixed(3)} m`); break; }
      if (F.biomeAt(s, n) !== Bk.biomeAt(L - s, -n)) { err(`${r.id}: the land at s${s} n${n} differs the two ways`); break; }
    }
    if (Math.abs(F.blendAt(500) + Bk.blendAt(L - 500) - 1) > 1e-6) err(`${r.id}: its blend is not the other way's`);
  }
  if (errs.length) { console.error(errs.join("\n")); proc.exit(1); }
  console.log(`roads: ${WORLD_ROADS.length} maps well formed; ${pts} points the same both ways`);
}
