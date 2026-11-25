// The drafting tool (docs/fixed-cities.md): generates candidate cities of one style with today's
// generator, keeps those cityProblems finds nothing wrong with, chooses five that differ most from
// each other and writes each as a city file into src/city-<style>/. It never overwrites a file.
//
//   make draft SCENE=long-day ARGS="<style> [candidates]"
//
// A candidate's seed is a hash of the style and its number, so a run is repeatable.
import { CityPlan } from "../src/city.ts";
import { hash2 } from "../src/rng.ts";
import { STYLES } from "../src/styles.ts";
import type { StyleId } from "../src/styles.ts";
import { cityByKey } from "../src/visits.ts";
import { cityFileOfPlan, cityProblems, cityTraits, constOf, slugOf } from "./cityfiles.ts";

const draftProc = (globalThis as any).process, fs = draftProc.getBuiltinModule("node:fs"), path = draftProc.getBuiltinModule("node:path");
const draftArgs: string[] = draftProc.argv.slice(2);
const draftStyle = draftArgs[0] as StyleId, draftWant = Number(draftArgs[1] ?? 30);
if (!(draftStyle in STYLES)) throw new Error(`usage: draftcities <style> [candidates]; styles: ${Object.keys(STYLES).join(", ")}`);
const draftDir = path.resolve("scenes/long-day/src", `city-${draftStyle}`);
const draftNames = STYLES[draftStyle].names.slice(0, 5);

type Draft = { seed: number; plan: CityPlan; traits: ReturnType<typeof cityTraits> };
const drafts: Draft[] = [];
for (let k = 0; drafts.length < draftWant && k < draftWant * 6; k++) {
  const seed = Math.floor(hash2(k, Object.keys(STYLES).indexOf(draftStyle), 0xd2af7, 0xc17) * 2 ** 31) || 1;
  if (cityByKey(seed)) continue;
  const plan = new CityPlan(seed, STYLES[draftStyle]);
  const problems = cityProblems(plan), traits = cityTraits(plan);
  if (problems.length || traits.docks < 6) { console.log(`seed ${seed}: skipped (${problems[0] ?? `${traits.docks} docks`})`); continue; }
  drafts.push({ seed, plan, traits });
  console.log(`seed ${seed}: ${JSON.stringify(traits)}`);
}

// Five that differ most: each next one the draft adding the most trait values not yet chosen,
// with a mix of freeway cities and others where the style has both.
const traitKeys = ["layout", "freeway", "merge", "river", "oneWays", "rounds"] as const;
const chosen: Draft[] = [];
while (chosen.length < 5 && chosen.length < drafts.length) {
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
if (chosen.length < 5) throw new Error(`only ${chosen.length} good ${draftStyle} drafts`);

fs.mkdirSync(draftDir, { recursive: true });
chosen.forEach((d, i) => {
  const name = draftNames[i], file = path.join(draftDir, `${draftStyle}-city-${slugOf(name)}.ts`);
  if (fs.existsSync(file)) { console.log(`${file}: exists, left as it is`); return; }
  const F = cityFileOfPlan(d.plan, `${draftStyle}-${slugOf(name)}`, name);
  const item = (v: unknown): string => Array.isArray(v) ? `[${v.map(item).join(", ")}]`
    : v && typeof v === "object" ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${item(x)}`).join(", ")} }` : JSON.stringify(v);
  const list = (k: string, a: unknown[]) => `  ${k}: [\n${a.map((v) => `    ${item(v)},`).join("\n")}\n  ],`;
  const text = [
    `// ${name}, a ${draftStyle} city (docs/fixed-cities.md). Drafted from seed ${d.seed} by tools/draftcities.ts;`,
    `// edited by hand from here on.`,
    `import type { CityFile } from "../cityfile.ts";`,
    ``,
    `export const ${constOf(draftStyle, name)}: CityFile = {`,
    `  format: 1, id: ${item(F.id)}, name: ${item(F.name)}, style: ${item(F.style)}, key: ${F.key},`,
    `  layout: ${item(F.layout)}, outline: ${item(F.outline)},`,
    list("nodes", F.nodes), list("streets", F.streets), list("gates", F.gates), list("blocks", F.blocks),
    `};`, ``,
  ].join("\n");
  fs.writeFileSync(file, text);
  console.log(`${path.relative(draftProc.cwd(), file)}: seed ${d.seed}, ${JSON.stringify(d.traits)}`);
});
