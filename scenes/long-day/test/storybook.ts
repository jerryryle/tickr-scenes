// Test: the storybook city (styles.ts isStorybookCity) comes round now and then and no more:
// across many journeys it is never one of the first two cities, never within STORYBOOK_GAP cities
// of the last, takes between one city in ten and one in seven over a long journey, shows up in
// most journeys of twenty cities, and leaves the real styles' cycle as it was (no two cities in a
// row of the same style). It also checks that every catalogue storybook town has its knitting
// works (CityPlan.worksBlock), on a shallow dock its trucks can reach, and that the city after a
// storybook one arrives with the works' wonders, and no other city with any (journey.ts freightFor).
// The optional args are journeys (default 400), cities each (default 40) and works checked (default 12).
import { journeyStyle, isStorybookCity, STORYBOOK_GAP, STYLES } from "../src/styles.ts";
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { CityPlan } from "../src/city.ts";
import { citiesOfStyle } from "../src/visits.ts";
import { facilityAt, siteLayout } from "../src/facilities.ts";
import { STORY_CARGO, STORY_FREIGHT } from "../src/cargo.ts";

const proc = (globalThis as any).process, argv: string[] = proc.argv.slice(2);
const JOURNEYS = argv[0] ? Number(argv[0]) : 400, CITIES = argv[1] ? Number(argv[1]) : 40;
const fails: string[] = [];
let story = 0, total = 0, within20 = 0;
for (let seed = 0; seed < JOURNEYS; seed++) {
  let last = -Infinity, early = false;
  for (let N = 0; N < CITIES; N++) {
    const st = journeyStyle(seed, N), sb = !!st.storybook;
    if (sb !== isStorybookCity(seed, N)) fails.push(`seed ${seed} city ${N}: journeyStyle and isStorybookCity disagree`);
    if (sb) {
      story++;
      if (N < 2) fails.push(`seed ${seed}: city ${N} is the storybook city`);
      if (N - last <= STORYBOOK_GAP) fails.push(`seed ${seed}: storybook cities ${last} and ${N} too close`);
      last = N; if (N < 20) early = true;
    }
    if (N > 0 && journeyStyle(seed, N - 1).id === st.id) fails.push(`seed ${seed}: cities ${N - 1} and ${N} both ${st.id}`);
    total++;
  }
  if (early) within20++;
}
const rate = story / total;
console.log(`storybook cities: ${story} of ${total} (1 in ${(1 / rate).toFixed(1)}); in the first 20 cities of ${(within20 / JOURNEYS * 100).toFixed(0)}% of journeys`);
if (rate < 1 / 10 || rate > 1 / 7) fails.push(`storybook rate 1 in ${(1 / rate).toFixed(1)}: want between 1 in 10 and 1 in 7`);
if (within20 / JOURNEYS < 0.75) fails.push(`only ${(within20 / JOURNEYS * 100).toFixed(0)}% of journeys see the storybook city in 20 cities`);
// The works are checked in the storybook city of a dozen journeys.
const WORKS_N = argv[2] ? Number(argv[2]) : 12;
let works = 0;
for (let seed = 0; seed < WORKS_N; seed++) {
  const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");   // (this sets up the city's limits and gates)
  const town = citiesOfStyle("storybook")[seed % citiesOfStyle("storybook").length];   // (each catalogue storybook town in turn)
  const plan = new CityPlan(town.key, STYLES.storybook), id = plan.worksBlock;
  if (id < 0) { fails.push(`seed ${seed}: no knitting works`); continue; }
  const B = plan.graph.blocks[id], L = siteLayout(plan, B.kx, B.kz);
  if (facilityAt(plan, B.kx, B.kz) !== "knittingWorks") fails.push(`seed ${seed}: the works block's facility is ${facilityAt(plan, B.kx, B.kz)}`);
  if (L.kind !== "dock" || L.deep) fails.push(`seed ${seed}: the works' site is ${L.kind}${L.kind === "dock" ? " (deep)" : ""}, not a shallow dock`);
  for (let N = 2; N < 30; N++) {
    const f = j.freightFor(N + 1)?.cargo ?? "";
    if (journeyStyle(seed, N).storybook && !STORY_FREIGHT.includes(f)) fails.push(`seed ${seed}: city ${N + 1} after a storybook city arrives with ${f}, not the works' wonders`);
    if (!journeyStyle(seed, N).storybook && STORY_CARGO.has(f)) fails.push(`seed ${seed}: city ${N + 1} arrives with ${f} from a city that isn't a storybook city`);
  }
  works++;
}
console.log(`knitting works: ${works} of ${WORKS_N} storybook cities`);
for (const f of fails.slice(0, 20)) console.log("FAIL " + f);
if (fails.length) proc.exit(1);
