// The visit planner (docs/fixed-cities.md, requirements 13 to 15): which catalogue city each city
// of a journey is, and the country road the truck arrives by. A journey drives the world graph
// (world-roads.ts): from each city it takes one of that city's roads on to a neighbour. A pure
// function of the journey seed and the city's number, worked out city by city from the first.
//
// The first city is any real one, entered by one of its roads as if from that road's far end.
// From each city the planner takes a road other than the one it came in by (never back the same
// way), to a city of another style (every road joins two), and among those it takes, in turn:
//   1. a storybook town when one is due, and no storybook town otherwise;
//   2. a city not among the last RECENT visited, if there is one;
//   3. the city whose onward roads lead to the most cities not visited lately (LOOKAHEAD visits
//      on), then the one visited fewest times so far, then the one longest since, then by hash.
// A storybook town comes due as the old rule had it: never in the first two cities nor within
// STORYBOOK_GAP cities of the last one, and past that with STORYBOOK_ODDS at each city; once due it
// stays due until the journey reaches one, and on the way it prefers a city next to one.
import { hash2 } from "./rng.ts";
import { DEBUG_STYLE } from "./debug.ts";
import { STORYBOOK_GAP, STORYBOOK_ODDS, STYLES } from "./styles.ts";
import type { StyleId } from "./styles.ts";
import type { CityFile } from "./cityfile.ts";
import { CATALOGUE } from "./world.ts";
import type { WorldRoad } from "./world.ts";
import { WORLD_ROADS } from "./world-roads.ts";

export const RECENT = 8;   // visits before a city may come back (requirement 14)
const LOOKAHEAD = 4;       // visits the planner looks ahead for fresh cities

let byStyle: Map<StyleId, CityFile[]> | null = null;
let byKey: Map<number, CityFile> | null = null;
let byId: Map<string, CityFile> | null = null;
function index() {
  if (!byStyle) {
    byStyle = new Map(); byKey = new Map(); byId = new Map();
    for (const F of CATALOGUE) {
      if (byKey.has(F.key)) throw new Error(`world.ts: ${F.id} and ${byKey.get(F.key)!.id} share key ${F.key}`);
      byKey.set(F.key, F); byId.set(F.id, F); byStyle.set(F.style, [...(byStyle.get(F.style) ?? []), F]);
    }
  }
  return { byStyle: byStyle!, byKey: byKey!, byId: byId! };
}
// The catalogue's cities of a style, the city a hash key belongs to, and the city with an id.
export const citiesOfStyle = (id: StyleId): readonly CityFile[] => index().byStyle.get(id) ?? [];
export const cityByKey = (key: number): CityFile | undefined => index().byKey.get(key);
export const cityById = (id: string): CityFile | undefined => index().byId.get(id);
// A gate's index in its city's gates (the graph's), by its id.
export const gateIndex = (F: CityFile, id: string) => F.gates.findIndex((g) => g?.id === id);

// A way along a road: the road, the city and gate it leaves from and the city and gate it arrives
// at (gate indexes), and whether it runs from the road's b end to its a end.
export interface RoadWay { road: WorldRoad; from: CityFile; out: number; to: CityFile; in: number; back: boolean }
let waysOut: Map<string, RoadWay[]> | null = null;
export function waysFrom(F: CityFile): readonly RoadWay[] {
  if (!waysOut) {
    waysOut = new Map();
    for (const r of WORLD_ROADS) {
      const A = cityById(r.a.city)!, B = cityById(r.b.city)!;
      const put = (w: RoadWay) => waysOut!.set(w.from.id, [...(waysOut!.get(w.from.id) ?? []), w]);
      put({ road: r, from: A, out: gateIndex(A, r.a.gate), to: B, in: gateIndex(B, r.b.gate), back: false });
      if (!r.oneway) put({ road: r, from: B, out: gateIndex(B, r.b.gate), to: A, in: gateIndex(A, r.a.gate), back: true });
    }
  }
  return waysOut.get(F.id) ?? [];
}

// Visit N of a journey: its city, and the way it arrives by (from visit N - 1's city; for the
// first, a way into it from a neighbour, as if driven).
export interface Visit { city: CityFile; arrive: RoadWay }
interface Plan { visits: Visit[]; count: Map<string, number>; last: Map<string, number>; lastStory: number; due: boolean }
const visitPlans = new Map<number, Plan>();
const pickOf = (seed: number, n: number, salt: number, len: number) => Math.floor(hash2(seed, n, 0x715a, salt) * len);

function firstVisit(seed: number): Visit {
  const real = CATALOGUE.filter((F) => !STYLES[F.style].storybook && (!DEBUG_STYLE || F.style === DEBUG_STYLE));
  const pool = real.length ? real : CATALOGUE.filter((F) => !DEBUG_STYLE || F.style === DEBUG_STYLE), city = pool[pickOf(seed, 0, 1, pool.length)];
  const into = DEBUG_STYLE ? [] : CATALOGUE.flatMap((F) => waysFrom(F).filter((w) => w.to === city));
  return { city, arrive: into.length ? into[pickOf(seed, 0, 2, into.length)] : debugWay(city, city, seed, 0) };
}
// (Under DEBUG_STYLE every city is of one style, so no road joins two in a row: a road made up
// between them, from a gate of one to a gate of the other facing another way.)
function debugWay(from: CityFile, to: CityFile, seed: number, n: number): RoadWay {
  const ins = to.gates.map((g, i) => [g, i] as const).filter(([g, i]) => g && i > 0), [gi, ii] = ins[pickOf(seed, n, 3, ins.length)] ?? [to.gates[0]!, 0];
  const outs = from.gates.map((g, i) => [g, i] as const).filter(([g, i]) => g && i > 0 && g.dir !== gi!.dir), [go, oi] = outs[pickOf(seed, n, 4, outs.length)] ?? [from.gates[0]!, 0];
  return { road: { id: `debug-${n}`, a: { city: from.id, gate: go!.id }, b: { city: to.id, gate: gi!.id }, seconds: 120, key: Math.floor(hash2(seed, n, 0xdeb, 0x70ad) * 2 ** 31) || 1 }, from, out: oi, to, in: ii, back: false };
}

function nextVisit(seed: number, P: Plan, n: number): Visit {
  const cur = P.visits[n - 1], story = (F: CityFile) => !!STYLES[F.style].storybook;
  if (DEBUG_STYLE) {
    const same = citiesOfStyle(DEBUG_STYLE as StyleId).filter((F) => F !== cur.city);
    const to = same.length ? same[pickOf(seed, n, 5, same.length)] : cur.city;
    return { city: to, arrive: debugWay(cur.city, to, seed, n) };
  }
  // (A storybook town comes due: STORYBOOK_GAP cities after the last, by STORYBOOK_ODDS a city.)
  if (!P.due && n >= 2 && n - P.lastStory > STORYBOOK_GAP && hash2(seed, n, 0x5b, 0x5e055) < STORYBOOK_ODDS) P.due = true;
  let ways = waysFrom(cur.city).filter((w) => w.road !== cur.arrive.road);
  if (!ways.length) ways = [...waysFrom(cur.city)];
  // (A town visited lately waits: the next due may be another, or this one later.)
  const towns = ways.filter((w) => story(w.to) && n - (P.last.get(w.to.id) ?? -Infinity) > RECENT), real = ways.filter((w) => !story(w.to));
  if (P.due && n >= 2 && towns.length) ways = towns;
  else if (real.length) ways = real;
  const fresh = ways.filter((w) => n - (P.last.get(w.to.id) ?? -Infinity) > RECENT);
  if (fresh.length) ways = fresh;
  // (On the way to a storybook town that is due, a city next to one first.)
  const nearStory = (w: RoadWay) => P.due && waysFrom(w.to).some((x) => story(x.to)) ? 0 : 1;
  // (And the way that leaves the most fresh cities ahead: how many visits on it can go without
  // one coming back too soon, looking LOOKAHEAD on.)
  const freshRun = (w: RoadWay, depth: number, path: string[]): number => {
    if (depth === 0) return 0;
    let best = 0;
    for (const x of waysFrom(w.to)) {
      if (x.road === w.road || story(x.to)) continue;
      const k = n + path.length;
      if (path.includes(x.to.id) || k - (P.last.get(x.to.id) ?? -Infinity) <= RECENT) continue;
      best = Math.max(best, 1 + freshRun(x, depth - 1, [...path, x.to.id]));
      if (best === depth) break;
    }
    return best;
  };
  const ranked = ways.map((w) => ({ w, k: [nearStory(w), -freshRun(w, LOOKAHEAD, [w.to.id]), P.count.get(w.to.id) ?? 0, P.last.get(w.to.id) ?? -Infinity, hash2(seed, n, 0x7a1, w.road.key)] }))
    .sort((p, q) => p.k[0] - q.k[0] || p.k[1] - q.k[1] || p.k[2] - q.k[2] || p.k[3] - q.k[3] || p.k[4] - q.k[4]);
  return { city: ranked[0].w.to, arrive: ranked[0].w };
}

// Visit N of the journey with this seed.
export function visitOf(seed: number, N: number): Visit {
  let P = visitPlans.get(seed);
  if (!P) {
    if (visitPlans.size > 4) visitPlans.clear();
    P = { visits: [], count: new Map(), last: new Map(), lastStory: -Infinity, due: false };
    visitPlans.set(seed, P);
  }
  while (P.visits.length <= N) {
    const n = P.visits.length, v = n === 0 ? firstVisit(seed) : nextVisit(seed, P, n);
    P.visits.push(v);
    P.count.set(v.city.id, (P.count.get(v.city.id) ?? 0) + 1); P.last.set(v.city.id, n);
    if (STYLES[v.city.style].storybook) { P.lastStory = n; P.due = false; }
  }
  return P.visits[N];
}
// City N's catalogue city.
export const cityFileOf = (seed: number, N: number): CityFile => visitOf(seed, N).city;
