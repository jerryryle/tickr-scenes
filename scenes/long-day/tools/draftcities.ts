// The drafting tool (docs/long-day-cities.md): generates candidate cities of one style with today's
// generator, keeps those cityProblems finds nothing wrong with, chooses five that differ most from
// each other and writes each as a city file, with its contents beside it, into a folder of its own,
// src/city-<style>/<slug>/. It never overwrites a file.
//
//   make draft SCENE=long-day ARGS="<style> [candidates] [cities]"
//
// (`cities`, five unless given, is how many it writes: a style may start with fewer. A fourth
// argument, a candidate's seed, writes that one first.)
//
// A candidate's seed is a hash of the style and its number, so a run is repeatable.
import { GeneratedPlan } from "./generatedplan.ts";
import { hash2 } from "../src/rng.ts";
import { STYLES } from "../src/styles.ts";
import type { StyleId } from "../src/styles.ts";
import { cityByKey } from "../src/visits.ts";
import { cityContentsOf, cityFileOfPlan, cityFileText, cityPath, contentsFileText, contentsPath, contentsRowsOf, cityProblems, cityTraits, slugOf } from "./cityfiles.ts";

const draftProc = (globalThis as any).process, fs = draftProc.getBuiltinModule("node:fs"), path = draftProc.getBuiltinModule("node:path");
const draftArgs: string[] = draftProc.argv.slice(2);
const draftStyle = draftArgs[0] as StyleId, draftWant = Number(draftArgs[1] ?? 30), draftCount = Number(draftArgs[2] ?? 5);
if (!(draftStyle in STYLES)) throw new Error(`usage: draftcities <style> [candidates]; styles: ${Object.keys(STYLES).join(", ")}`);
const draftNames = STYLES[draftStyle].names.slice(0, draftCount);

type Draft = { seed: number; plan: GeneratedPlan; traits: ReturnType<typeof cityTraits> };
const drafts: Draft[] = [];
for (let k = 0; drafts.length < draftWant && k < draftWant * 6; k++) {
  const seed = Math.floor(hash2(k, Object.keys(STYLES).indexOf(draftStyle), 0xd2af7, 0xc17) * 2 ** 31) || 1;
  if (cityByKey(seed)) continue;
  const plan = new GeneratedPlan(seed, STYLES[draftStyle]);
  const problems = cityProblems(plan), traits = cityTraits(plan);
  // (A Victorian town's facilities are all at the kerb but its brewery: it has no docks to count.)
  if (problems.length || (traits.docks < 6 && !STYLES[draftStyle].victorian)) { console.log(`seed ${seed}: skipped (${problems[0] ?? `${traits.docks} docks`})`); continue; }
  drafts.push({ seed, plan, traits });
  console.log(`seed ${seed}: ${JSON.stringify(traits)}`);
}

// The `draftCount` that differ most: each next one the draft adding the most trait values not yet chosen,
// with a mix of freeway cities and others where the style has both.
const traitKeys = ["layout", "freeway", "merge", "river", "oneWays", "rounds"] as const;
const chosen: Draft[] = draftArgs[3] ? drafts.filter((d) => d.seed === Number(draftArgs[3])) : [];
while (chosen.length < draftCount && chosen.length < drafts.length) {
  let best: Draft | null = null, bestScore = -Infinity;
  for (const d of drafts) {
    if (chosen.includes(d)) continue;
    let score = 0;
    for (const t of traitKeys) if (!chosen.some((c) => c.traits[t] === d.traits[t])) score += t === "layout" || t === "freeway" ? 3 : 1;
    score += d.traits.docks / 100;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  chosen.push(best!);
}
if (chosen.length < draftCount) throw new Error(`only ${chosen.length} good ${draftStyle} drafts`);

let written = 0;
const draftedIds: string[] = [];
chosen.forEach((d, i) => {
  const name = draftNames[i], F = cityFileOfPlan(d.plan, `${draftStyle}-${slugOf(name)}`, name), file = path.resolve(cityPath(F));
  if (fs.existsSync(file)) { console.log(`${file}: exists, left as it is`); return; }
  written++;
  const C = contentsRowsOf(d.plan, cityContentsOf(d.plan))!;
  const text = cityFileText(F, [
    `// ${name}, a ${draftStyle} city (docs/long-day-cities.md). Drafted from seed ${d.seed} by tools/draftcities.ts;`,
    `// edited by hand from here on.`,
  ]);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.writeFileSync(contentsPath(F), contentsFileText(F, C));   // (its contents beside it)
  console.log(`${path.relative(draftProc.cwd(), file)}: seed ${d.seed}, ${JSON.stringify(d.traits)}`);
  draftedIds.push(F.id);
});
// (A style whose names all have files already gets nothing new: say so, and fail.)
if (!written) throw new Error(`every ${draftStyle} name in styles.ts already has a city file: add names to draft more`);
// (The moves a tractor-trailer never takes are swept from the files as written, their furniture
// slid clear of the doors by then: tools/tractorturns.ts, once the cities are in world.ts.)
console.log(`then, with them in src/world.ts: make tractorturns SCENE=long-day ARGS="${draftedIds.join(" ")}"`);
