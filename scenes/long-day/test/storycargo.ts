// Test: the storybook city's wonders (cargo.ts STORY_CARGO) are only ever picked up in a
// storybook city: plays journeys through one (and the cities either side of it) and checks every
// pickup planned, and that the wonders do turn up there, several kinds of them.
// Args (optional): minutes per journey (default 110), seeds (comma separated; default 4,9,11: the
// third city a storybook one, about 56 minutes in).
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { journeyStyle } from "../src/styles.ts";
import { STORY_CARGO } from "../src/cargo.ts";

const proc = (globalThis as any).process, argv: string[] = proc.argv.slice(2);
const MINUTES = Number(argv[0] ?? 110), SEEDS = (argv[1] ?? "4,9,11").split(",").map(Number);
const fails: string[] = [], kinds = new Set<string>();
let story = 0, other = 0;
for (const seed of SEEDS) {
  const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn"), seen = new Set<string>();
  const n = Math.round(MINUTES * 60 / 0.1);
  for (let i = 0; i < n; i++) {
    j.step();
    for (const s of j.st.stops) {
      if (s.kind !== "pickup") continue;
      const key = `${j.st.city}/${s.job}/${s.cargo}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sb = !!journeyStyle(seed, j.st.city).storybook;
      if (STORY_CARGO.has(s.cargo)) {
        story++; kinds.add(s.cargo);
        if (!sb) fails.push(`seed ${seed}: ${s.cargo} picked up in city ${j.st.city} (${journeyStyle(seed, j.st.city).id}), not a storybook city`);
      } else if (sb) other++;
    }
  }
}
console.log(`storybook wonders picked up: ${story} (${[...kinds].join(", ")}); other goods in storybook cities: ${other}`);
if (story < 4) fails.push(`only ${story} wonders picked up`);
if (kinds.size < 3) fails.push(`only ${kinds.size} kinds of wonder picked up`);
for (const f of fails.slice(0, 20)) console.log("FAIL " + f);
if (fails.length) proc.exit(1);
