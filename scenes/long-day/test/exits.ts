// Test: a freeway's off-ramp (interchange.ts), of either kind, comes down to the street clear of
// everything on the pavement: where its track runs at street level, no bench, lamp, tree or sign
// stands within a truck's half width of it (the sidewalk it crosses has a kerb cut, and nothing
// is put on a kerb cut). Checks the first freeway cities with each kind of exit.
// Args (all optional): seed
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { CityPlan, pavementObstacles } from "../src/city.ts";
import { citySeedOf } from "../src/country.ts";
import { journeyStyle } from "../src/styles.ts";
import { interchangeTrack } from "../src/interchange.ts";
{
  const proc = (globalThis as any).process;
  const seed = Number(proc.argv[2] ?? 1);
  void new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");   // (the city's limits and gates)
  const errs: string[] = [], seen: Record<string, number> = {};
  for (let N = 0; N < 80 && Object.keys(seen).length < 2; N++) {
    const plan = new CityPlan(citySeedOf(seed, N), journeyStyle(seed, N)), ic = plan.interchange;
    if (!ic || (seen[ic.kind] ?? 0) >= 2) continue;
    seen[ic.kind] = (seen[ic.kind] ?? 0) + 1;
    const blk = plan.graph.blocks.find((b) => plan.interchangeAt(b.kx, b.kz));
    if (!blk) { errs.push(`city ${N}: no block for its ${ic.kind} exit`); continue; }
    const obs = pavementObstacles(plan, blk.kx, blk.kz), t = interchangeTrack(plan), q = { x: 0, z: 0, h: 0, k: 0 };
    for (let s = 0; s <= t.length; s += 0.5) {
      if (t.yAt(s) > 0.3) continue;
      t.eval(s, q);
      const o = obs.find((o) => Math.hypot(o.x - q.x, o.z - q.z) < o.r + 1.25);
      if (o) { errs.push(`city ${N} (${ic.kind}): pavement obstacle (kind ${o.kind ?? 0}) in the way ${s.toFixed(1)} m down the ramp`); break; }
    }
  }
  console.log(`exits: checked ${JSON.stringify(seen)}, ${errs.length} in the way`);
  if (!seen.slip || !seen.helix) errs.push("not both kinds of exit found");
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
