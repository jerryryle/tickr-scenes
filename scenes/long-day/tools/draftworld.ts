// The world graph's drafting tool (docs/fixed-cities.md, requirements 9 to 12): joins the catalogue's
// cities with country roads and writes the roads and the cities' places on the world map into
// src/world-roads.ts, which src/world.ts reads. It overwrites that file, so it is for a first
// draft; after that the roads are edited by hand.
//
//   make draftworld SCENE=long-day [ARGS="<seed>"]
//
// Each road joins two gates, one in each city, a gate serving one road. Its two cities are of
// different styles, and its gates face different ways (a road from a gate out east to one whose
// way in is west would turn the truck right round). A freeway city's way in (its gate g0, where the
// freeway runs out of town) takes one road, driven only into the city: the truck never leaves by
// it. Every city gets at least four roads, to cities of at least three styles, and the drafting
// starts over with the next seed until any city can reach any other in four drives or fewer.
import { hash2, mulberry32 } from "../src/rng.ts";
import { freewayGate } from "../src/freeway.ts";
import { STYLES } from "../src/styles.ts";
import { CATALOGUE } from "../src/world.ts";
import type { WorldRoad } from "../src/world.ts";

const dwProc = (globalThis as any).process, dwFs = dwProc.getBuiltinModule("node:fs");
const dwSeed0 = Number(dwProc.argv[2] ?? 1);
const MIN_ROADS = 5, MIN_STYLES = 3, MAX_HOPS = 4, MAX_ROADS = 7;

interface Town { id: string; style: string; gates: { id: string; dir: number }[]; freeway: boolean }
const towns: Town[] = CATALOGUE.map((F) => ({ id: F.id, style: F.style, freeway: !!freewayGate(F.key),
  gates: F.gates.flatMap((g) => g ? [{ id: g.id, dir: g.dir }] : []) }));

function draft(seed: number): WorldRoad[] | null {
  const rnd = mulberry32(seed), roads: WorldRoad[] = [], used = new Map<string, Set<string>>(towns.map((t) => [t.id, new Set<string>()]));
  const near = new Map<string, Set<string>>(towns.map((t) => [t.id, new Set<string>()]));
  const byId = new Map(towns.map((t) => [t.id, t]));
  const free = (t: Town) => t.gates.filter((g) => !used.get(t.id)!.has(g.id) && !(t.freeway && g.id === "g0"));
  const styles = (t: Town) => new Set([...near.get(t.id)!].map((n) => byId.get(n)!.style));
  const add = (a: Town, ga: string, b: Town, gb: string, oneway: boolean) => {
    const n = roads.length, key = Math.floor(hash2(n, seed, 0x70ad, 0x5eed) * 2 ** 31) || 1;
    roads.push(({ id: `r${n}`, a: { city: a.id, gate: ga }, b: { city: b.id, gate: gb }, metres: Math.round((60 + 240 * hash2(n, seed, 0x5ec, 0x70ad)) * 18 / 10) * 10, key, ...(oneway ? { oneway: true as const } : {}) } as unknown as WorldRoad));
    used.get(a.id)!.add(ga); used.get(b.id)!.add(gb); near.get(a.id)!.add(b.id); near.get(b.id)!.add(a.id);
  };
  // (A pair of free gates facing different ways, the first found from a shuffled start.)
  const pair = (a: Town, b: Town, bGates = free(b)) => {
    const A = free(a), k0 = Math.floor(rnd() * Math.max(1, A.length));
    for (let i = 0; i < A.length; i++) { const ga = A[(i + k0) % A.length], gb = bGates.find((g) => g.dir !== ga.dir); if (gb) return [ga.id, gb.id] as const; }
    return null;
  };
  // A freeway city's way in first: one road in from a city of another style.
  for (const t of towns) {
    if (!t.freeway) continue;
    const g0 = t.gates.find((g) => g.id === "g0")!, from = towns.filter((o) => o.style !== t.style && !near.get(t.id)!.has(o.id)).sort(() => rnd() - 0.5);
    const got = from.map((o) => [o, pair(o, t, [g0])] as const).find(([, p]) => p);
    if (!got) return null;
    add(got[0], got[1]![0], t, got[1]![1], true);
  }
  // Then the city with the fewest roads (and neighbouring styles) each time, joined to the city of
  // another style that adds a style it lacks, with the fewest roads itself.
  for (let guard = 0; guard < 2000; guard++) {
    const short = towns.filter((t) => near.get(t.id)!.size < MIN_ROADS || styles(t).size < MIN_STYLES);
    if (!short.length) break;
    short.sort((p, q) => near.get(p.id)!.size - near.get(q.id)!.size || styles(p).size - styles(q).size || (rnd() - 0.5));
    const a = short[0], have = styles(a);
    const cands = towns.filter((b) => b.style !== a.style && !near.get(a.id)!.has(b.id) && near.get(b.id)!.size < MAX_ROADS && free(b).length)
      .map((b) => ({ b, score: (have.has(b.style) ? 10 : 0) + near.get(b.id)!.size + (b.style === "storybook" ? 3 : 0) + rnd() }))
      .sort((p, q) => p.score - q.score);
    const got = cands.map((c) => [c.b, pair(a, c.b)] as const).find(([, p]) => p);
    if (!got) return null;
    add(a, got[1]![0], got[0], got[1]![1], false);
  }
  // Any city reaches any other (along roads either way) in MAX_HOPS drives or fewer.
  for (const t of towns) {
    const dist = new Map([[t.id, 0]]), todo = [t.id];
    while (todo.length) { const c = todo.shift()!; for (const n of near.get(c)!) if (!dist.has(n)) { dist.set(n, dist.get(c)! + 1); todo.push(n); } }
    if (dist.size !== towns.length || Math.max(...dist.values()) > MAX_HOPS) return null;
  }
  return roads;
}

let dwRoads: WorldRoad[] | null = null, dwSeed = dwSeed0;
for (; !dwRoads && dwSeed < dwSeed0 + 500; dwSeed++) dwRoads = draft(dwSeed);
if (!dwRoads) throw new Error("no world graph drafted in 500 tries");
console.log(`world graph from seed ${dwSeed - 1}: ${dwRoads.length} roads`);

// The cities' places on the world map: spread out by springs along the roads, repelling each other.
const dwPos = new Map(towns.map((t, i) => [t.id, [Math.cos(i * 2.39996) * (10 + i * 3), Math.sin(i * 2.39996) * (10 + i * 3)]]));
for (let it = 0; it < 600; it++) {
  const f = new Map(towns.map((t) => [t.id, [0, 0]]));
  for (const a of towns) for (const b of towns) {
    if (a === b) continue;
    const [ax, az] = dwPos.get(a.id)!, [bx, bz] = dwPos.get(b.id)!, dx = ax - bx, dz = az - bz, d2 = Math.max(1, dx * dx + dz * dz);
    f.get(a.id)![0] += 4000 * dx / d2; f.get(a.id)![1] += 4000 * dz / d2;
  }
  for (const r of dwRoads) {
    const [ax, az] = dwPos.get(r.a.city)!, [bx, bz] = dwPos.get(r.b.city)!, dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz) || 1, k = 0.02 * (d - 60);
    f.get(r.a.city)![0] += k * dx / d; f.get(r.a.city)![1] += k * dz / d; f.get(r.b.city)![0] -= k * dx / d; f.get(r.b.city)![1] -= k * dz / d;
  }
  for (const t of towns) { const p = dwPos.get(t.id)!, q = f.get(t.id)!, step = Math.min(5, Math.hypot(q[0], q[1])), n = Math.hypot(q[0], q[1]) || 1; p[0] += q[0] / n * step; p[1] += q[1] / n * step; }
}
const xs = [...dwPos.values()].map((p) => p[0]), zs = [...dwPos.values()].map((p) => p[1]), x0 = Math.min(...xs), z0 = Math.min(...zs);

const item = (v: unknown): string => Array.isArray(v) ? `[${v.map(item).join(", ")}]`
  : v && typeof v === "object" ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${item(x)}`).join(", ")} }` : JSON.stringify(v);
dwFs.writeFileSync("scenes/long-day/src/world-roads.ts", [
  `// The world graph's roads and the cities' places on the world map (docs/fixed-cities.md). Drafted`,
  `// from seed ${dwSeed - 1} by tools/draftworld.ts; edited by hand from here on.`,
  `import type { WorldRoad } from "./world.ts";`,
  ``,
  `export const WORLD_ROADS: WorldRoad[] = [`,
  ...dwRoads.map((r) => `  ${item(r)},`),
  `];`,
  ``,
  `// (Each city's place, x east and z south, in arbitrary units: for the world map only.)`,
  `export const WORLD_PLACES: Record<string, [number, number]> = {`,
  ...towns.map((t) => `  ${JSON.stringify(t.id)}: [${Math.round(dwPos.get(t.id)![0] - x0)}, ${Math.round(dwPos.get(t.id)![1] - z0)}],`),
  `};`,
  ``,
].join("\n"));
const deg = towns.map((t) => dwRoads!.filter((r) => r.a.city === t.id || r.b.city === t.id).length);
console.log(`scenes/long-day/src/world-roads.ts: roads per city ${Math.min(...deg)} to ${Math.max(...deg)}`);
