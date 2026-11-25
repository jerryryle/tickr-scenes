// Test: every catalogue city (src/world.ts) loads from its file and is fit for normal play
// (tools/cityfiles.ts cityProblems), its file reads back as written (the loader drops nothing, its
// contents included), its id is its style and name, and every style has five cities.
import { CityPlan } from "../src/city.ts";
import { STYLES } from "../src/styles.ts";
import type { StyleId } from "../src/styles.ts";
import { CATALOGUE } from "../src/world.ts";
import { citiesOfStyle } from "../src/visits.ts";
import { cityFileOfPlan, cityProblems, contentsRowsOf, slugOf } from "../tools/cityfiles.ts";
import { PACKED_CONTENTS } from "../src/contents-packed.ts";
import { unpackText } from "../src/pack.ts";

const fails: string[] = [], ids = new Set<string>();
for (const F of CATALOGUE) {
  if (F.id !== `${F.style}-${slugOf(F.name)}`) fails.push(`${F.id}: its id should be ${F.style}-${slugOf(F.name)}`);
  if (ids.has(F.id)) fails.push(`${F.id}: two cities with this id`);
  ids.add(F.id);
  let plan: CityPlan;
  try { plan = new CityPlan(F.key, STYLES[F.style]); void plan.graph; }
  catch (e) { fails.push(`${F.id}: ${(e as Error).message}`); continue; }
  if (plan.file !== F) { fails.push(`${F.id}: its key ${F.key} is not read as this city`); continue; }
  for (const p of cityProblems(plan)) fails.push(`${F.id}: ${p}`);
  // (Its labels' points are where they were drafted; the loader checks each lies in its block.)
  const strip = (f: typeof F) => JSON.stringify({ ...f, blocks: f.blocks.map(({ at: _, ...b }) => b) });
  if (strip(cityFileOfPlan(plan, F.id, F.name)) !== strip(F)) fails.push(`${F.id}: its file does not read back as written`);
  // (Its contents, packed and unpacked: as its contents file lists them.)
  const C = PACKED_CONTENTS[F.id];
  if (!C) fails.push(`${F.id}: no contents`);
  else if (JSON.stringify(contentsRowsOf(plan)) !== unpackText(C)) fails.push(`${F.id}: its contents do not read back as listed`);
  console.log(`${F.id}: ${plan.graph.nodes.length} nodes, ${plan.graph.streets.length} streets, ${plan.graph.blocks.length} blocks`);
}
for (const id of Object.keys(STYLES) as StyleId[]) if (citiesOfStyle(id).length !== 5) fails.push(`${id}: ${citiesOfStyle(id).length} cities, not 5`);
for (const f of fails) console.log(`FAIL ${f}`);
if (fails.length) (globalThis as any).process.exit(1);
console.log(`ok: ${CATALOGUE.length} cities`);
