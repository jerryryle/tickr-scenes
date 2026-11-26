// Test: every side of a kerb facility's block has a front door for the driver (city.ts
// kerbDoors), and a park's stand or an industrial yard's container has one on its own side, so
// no load appears from, or vanishes into, thin air. Checks every other block of the city (of any shape: one door per side).
// And that no door the facades paint is left showing within a metre of one (DOOR_CLASHES).
// The doors are worked out from the city's buildings, as the drafting tool does (its file's own
// left out), and each must be where the file lists it.
// Args (all optional): seed
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { CityPlan, DOOR_CLASHES, fileOf, kerbDoors } from "../src/city.ts";
import { cityByKey } from "../src/visits.ts";
import { facilityAt, siteLayout } from "../src/facilities.ts";
{
  const proc = (globalThis as any).process;
  const seed = Number(proc.argv[2] ?? 1);
  DOOR_CLASHES.out = [];   // (before the journey, which might work out some doors itself: they're cached)
  const j0 = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn"), F = fileOf(cityByKey(j0.plan.seed)!);
  const bare = new CityPlan(F.key, j0.plan.style, j0.plan.dressing, { ...F, blocks: F.blocks.map(({ doors: _d, ...b }) => b) }), filed = j0.plan;
  const j = { plan: bare };
  let sides = 0;
  const errs: string[] = [];
  for (const blk of j.plan.graph.blocks) {
    const bx = blk.kx, bz = blk.kz;
    if (!blk.inCity || ((bx + bz) & 1) || blk.id === j.plan.plaza) continue;   // (every other block; not the town's plaza, all paving and trees, where no job goes: journey.ts)
    const L = siteLayout(j.plan, bx, bz);
    if (L.kind !== "kerb" && L.kind !== "stand") continue;
    const ds = kerbDoors(j.plan, bx, bz);
    for (let side = 0; side < blk.sides.length; side++) {
      if (!j.plan.graph.hasFrontage(blk.sides[side])) continue;   // (a sliver between close intersections: no frontage)
      if (L.kind === "stand" && side !== L.side) continue;
      sides++;
      if (!ds[side] && errs.length < 10) errs.push(`no door: ${facilityAt(j.plan, bx, bz)} (${j.plan.district(bx, bz)}) block ${bx},${bz} side ${side}`);
      const fd = kerbDoors(filed, bx, bz)[side], d = ds[side];
      if (!!fd !== !!d || (fd && d && (Math.abs(fd.a - d.a) > 0.02 || Math.abs(fd.n - d.n) > 0.02 || Math.abs(fd.x - d.x) > 0.03 || Math.abs(fd.z - d.z) > 0.03 || fd.panel !== d.panel || Math.abs(fd.h - d.h) > 0.02)))
        if (errs.length < 10) errs.push(`block ${bx},${bz} side ${side}: the file's door is not where its buildings put one (${fd ? fd.a.toFixed(2) : "none"} against ${d ? d.a.toFixed(2) : "none"})`);
    }
  }
  const clashes = DOOR_CLASHES.out;
  console.log(`doors: ${sides} block sides checked, ${errs.length} without a door, ${clashes.length} beside a painted door`);
  for (const c of clashes.slice(0, 10)) errs.push(c);
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
