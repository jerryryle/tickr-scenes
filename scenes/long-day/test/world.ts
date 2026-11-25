// Test: the world graph (src/world-roads.ts) and the visit planner (src/visits.ts) keep their
// requirements (docs/fixed-cities.md, 9 to 15). The graph: every road joins two catalogue cities of
// different styles at gates that exist and face different ways, no gate serves two roads, a road
// into a freeway city's way in (g0) is driven only into it, every city has at least four roads to
// cities of at least three styles, and any city reaches any other in four drives or fewer. The
// planner, over many journeys: every visit arrives by a road from the city before, no two cities
// in a row share a style, no city comes back within RECENT visits, it never drives back along the
// road it came in by, the storybook towns keep their rules (never in the first two cities, never
// within STORYBOOK_GAP of the last, between one city in ten and one in seven), and each real
// city's visits stay within 25% of its style's mean, and two visits to one city differ in dressing. It prints the frequencies it saw.
// Args (all optional): journeys (default 300), cities each (default 60).
import { CATALOGUE } from "../src/world.ts";
import { WORLD_ROADS } from "../src/world-roads.ts";
import { cityById, gateIndex, RECENT, visitOf, waysFrom } from "../src/visits.ts";
import { STORYBOOK_GAP, STYLES } from "../src/styles.ts";
import { freewayGate } from "../src/freeway.ts";

const wtProc = (globalThis as any).process, wtArgs: string[] = wtProc.argv.slice(2);
const JOURNEYS = Number(wtArgs[0] ?? 300), LEN = Number(wtArgs[1] ?? 60), fails: string[] = [];
const fail = (m: string) => { if (fails.length < 30) fails.push(m); };
const sb = (id: string) => !!STYLES[cityById(id)!.style].storybook;

// The graph.
const usedGates = new Set<string>(), near = new Map<string, Set<string>>(CATALOGUE.map((F) => [F.id, new Set<string>()]));
for (const r of WORLD_ROADS) {
  const A = cityById(r.a.city), B = cityById(r.b.city);
  if (!A || !B) { fail(`${r.id}: joins a city not in the catalogue`); continue; }
  if (A.style === B.style) fail(`${r.id}: joins two ${A.style} cities`);
  const ia = gateIndex(A, r.a.gate), ib = gateIndex(B, r.b.gate);
  if (ia < 0 || ib < 0) { fail(`${r.id}: a gate that isn't there`); continue; }
  if (A.gates[ia]!.dir === B.gates[ib]!.dir) fail(`${r.id}: its gates face the same way`);
  for (const k of [`${A.id}/${r.a.gate}`, `${B.id}/${r.b.gate}`]) { if (usedGates.has(k)) fail(`${r.id}: gate ${k} serves two roads`); usedGates.add(k); }
  if (freewayGate(A.key, STYLES[A.style]) && ia === 0) fail(`${r.id}: leaves ${A.id} by its freeway's way in`);
  if (freewayGate(B.key, STYLES[B.style]) && ib === 0 && !r.oneway) fail(`${r.id}: into ${B.id}'s freeway way in, but driven both ways`);
  if (r.seconds < 30) fail(`${r.id}: ${r.seconds} s is too short a drive`);
  near.get(A.id)!.add(B.id); near.get(B.id)!.add(A.id);
}
for (const F of CATALOGUE) {
  const n = near.get(F.id)!, styles = new Set([...n].map((id) => cityById(id)!.style));
  if (n.size < 4) fail(`${F.id}: ${n.size} roads`);
  if (styles.size < 3) fail(`${F.id}: roads to ${styles.size} styles`);
  const dist = new Map([[F.id, 0]]), todo = [F.id];
  while (todo.length) { const c = todo.shift()!; for (const m of near.get(c)!) if (!dist.has(m)) { dist.set(m, dist.get(c)! + 1); todo.push(m); } }
  if (dist.size !== CATALOGUE.length) fail(`${F.id}: reaches ${dist.size} of ${CATALOGUE.length} cities`);
  else if (Math.max(...dist.values()) > 4) fail(`${F.id}: ${Math.max(...dist.values())} drives to the furthest city`);
  if (!waysFrom(F).length) fail(`${F.id}: no road out`);
}

// The planner.
const count = new Map<string, number>();
let story = 0, total = 0, soon = 0;
for (let seed = 1; seed <= JOURNEYS; seed++) {
  let lastStory = -Infinity;
  const seen = new Map<string, number>();
  for (let N = 0; N < LEN; N++) {
    const v = visitOf(seed, N), id = v.city.id;
    total++; count.set(id, (count.get(id) ?? 0) + 1);
    if (v.arrive.to !== v.city) fail(`seed ${seed} city ${N}: arrives by a road to ${v.arrive.to.id}`);
    if (N > 0) {
      const p = visitOf(seed, N - 1);
      if (v.arrive.from !== p.city) fail(`seed ${seed} city ${N}: arrives from ${v.arrive.from.id}, not ${p.city.id}`);
      if (p.city.style === v.city.style) fail(`seed ${seed} city ${N}: two ${v.city.style} cities in a row`);
      if (v.arrive.road === p.arrive.road) fail(`seed ${seed} city ${N}: back along the road it came in by`);
    }
    if (seen.has(id) && N - seen.get(id)! <= RECENT) { soon++; fail(`seed ${seed}: ${id} again ${N - seen.get(id)!} cities on`); }
    if (seen.has(id) && visitOf(seed, seen.get(id)!).dressing === v.dressing) fail(`seed ${seed}: ${id}'s visits ${seen.get(id)} and ${N} share their dressing`);
    seen.set(id, N);
    if (sb(id)) {
      story++;
      if (N < 2) fail(`seed ${seed}: a storybook town as city ${N}`);
      if (N - lastStory <= STORYBOOK_GAP) fail(`seed ${seed}: storybook towns at ${lastStory} and ${N}`);
      lastStory = N;
    }
  }
}
const rate = story / total;
console.log(`world: ${WORLD_ROADS.length} roads; storybook towns 1 city in ${(1 / rate).toFixed(1)}; ${soon} cities back within ${RECENT} of ${total}`);
if (rate < 1 / 10 || rate > 1 / 7) fail(`storybook towns 1 city in ${(1 / rate).toFixed(1)}: want between 1 in 10 and 1 in 7`);
for (const style of new Set(CATALOGUE.map((F) => F.style))) {
  const cs = CATALOGUE.filter((F) => F.style === style), ns = cs.map((F) => count.get(F.id) ?? 0), mean = ns.reduce((a, b) => a + b, 0) / ns.length;
  console.log(`  ${style}: ${cs.map((F, i) => `${F.id.slice(style.length + 1)} ${ns[i]}`).join(", ")}`);
  if (!STYLES[style as keyof typeof STYLES].storybook) cs.forEach((F, i) => { if (Math.abs(ns[i] - mean) > 0.25 * mean) fail(`${F.id}: ${ns[i]} visits, the ${style} mean ${mean.toFixed(0)}`); });
}
for (const f of fails) console.log(`FAIL ${f}`);
if (fails.length) wtProc.exit(1);
