// Test: every side of a kerb facility's block has a front door for the driver (city.ts
// kerbDoors), and a park's stand or an industrial yard's container has one on its own side, so
// no load appears from, or vanishes into, thin air. Checks every other block of the city (of any shape: one door per side).
// Args (all optional): seed
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { kerbDoors } from "../src/city.ts";
import { facilityAt, siteLayout } from "../src/facilities.ts";
{
  const proc = (globalThis as any).process;
  const seed = Number(proc.argv[2] ?? 1);
  const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
  let sides = 0;
  const errs: string[] = [];
  for (const blk of j.plan.graph.blocks) {
    const bx = blk.kx, bz = blk.kz;
    if (!blk.inCity || ((bx + bz) & 1)) continue;   // (every other block)
    const L = siteLayout(j.plan, bx, bz);
    if (L.kind !== "kerb" && L.kind !== "stand") continue;
    const ds = kerbDoors(j.plan, bx, bz);
    for (let side = 0; side < blk.sides.length; side++) {
      if (!j.plan.graph.hasFrontage(blk.sides[side])) continue;   // (a sliver between close intersections: no frontage)
      if (L.kind === "stand" && side !== L.side) continue;
      sides++;
      if (!ds[side] && errs.length < 10) errs.push(`no door: ${facilityAt(j.plan, bx, bz)} (${j.plan.district(bx, bz)}) block ${bx},${bz} side ${side}`);
    }
  }
  console.log(`doors: ${sides} block sides checked, ${errs.length} without a door`);
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
