// The road maps' drafting tool (docs/long-day-cities.md, "Road maps"): drafts each world road's map
// from today's rules (tools/roadgen.ts), records the roadside items as the segment builder places
// them, and writes src/roads/road-<id>.ts. A map is hand-owned once drafted, so the tool writes
// only the roads it is given or, with none given, those that have no map yet.
//
//   make draftroads SCENE=long-day [ARGS="r3 r7"]
//
// (make shares the roads out between processes, then runs it with --world.)
// With --world it rewrites src/world-roads.ts without the lengths the world graph was drafted with,
// once every road has a map: each road's length is then its map's.
import * as THREE from "three@0.187.0";
import { gateEnd } from "../src/city.ts";
import { ARRIVE_LEN, CountryRoad } from "../src/country.ts";
import { CountryWorld } from "../src/countryworld.ts";
import { freewayGate } from "../src/freeway.ts";
import type { Climate } from "../src/climate.ts";
import { roadHead } from "../src/roadmap.ts";
import type { RoadMap } from "../src/roadmap.ts";
import { WORLD_PLACES, WORLD_ROADS } from "../src/world-roads.ts";
import type { WorldRoad } from "../src/world.ts";
import { draftRoad, gateOf, roadEnds } from "./roadgen.ts";

const drProc = (globalThis as any).process, drFs = drProc.getBuiltinModule("node:fs");
const drArgs: string[] = drProc.argv.slice(2), drWorld = drArgs.includes("--world"), drIds = drArgs.filter((a) => !a.startsWith("--"));
const drDir = "scenes/long-day/src/roads";
const roadFile = (id: string) => `${drDir}/road-${id}.ts`, roadConst = (id: string) => `ROAD_${id.toUpperCase()}`;

const drItem = (v: unknown): string => Array.isArray(v) ? `[${v.map(drItem).join(", ")}]`
  : v && typeof v === "object" ? `{ ${Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => `${k}: ${drItem(x)}`).join(", ")} }` : JSON.stringify(v);
// (Long lists wrapped, a fixed count of numbers to a line.)
const drList = (name: string, A: number[], per: number) => {
  const rows: string[] = [];
  for (let i = 0; i < A.length; i += per) rows.push(`    ${A.slice(i, i + per).join(", ")},`);
  return [`  ${name}: [`, ...rows, `  ],`];
};

function writeMap(M: RoadMap, r: WorldRoad) {
  const I = M.items, lines = [
    `// World road ${r.id}: ${r.a.city} (gate ${r.a.gate}) to ${r.b.city} (gate ${r.b.gate})${r.oneway ? ", one way" : ""}. Drafted by`,
    `// tools/draftroads.ts; edited by hand from here on (docs/long-day-cities.md, "Road maps").`,
    `import type { RoadMap } from "../roadmap.ts";`,
    ``,
    `export const ${roadConst(r.id)}: RoadMap = {`,
    `  id: ${JSON.stringify(M.id)}, key: ${M.key}, length: ${M.length},${M.freeway ? " freeway: true," : ""}`,
    `  biomes: ${drItem(M.biomes)},${M.coastSide ? ` coastSide: ${M.coastSide},` : ""}`,
    ...drList("heading", M.heading, 16), ...drList("height", M.height, 24), ...drList("hill", M.hill, 24),
    ...drList("blend", M.blend, 24), ...(M.story ? drList("story", M.story, 24) : []), ...(M.period ? drList("period", M.period, 24) : []), ...(M.coast ? drList("coast", M.coast, 24) : []),
    `  pieces: [`, ...M.pieces.map((p) => `    ${drItem(p)},`), `  ],`,
    `  items: {`,
    ...(["trees", "rocks", "ponds", "turbines", "pylons", "farms", "cows", "poles", "fences"] as const).map((k) => drList(k, I[k], k === "trees" ? 32 : 24).map((l) => `  ${l}`)).flat(),
    `  },`,
    `};`, ``,
  ];
  drFs.writeFileSync(roadFile(r.id), lines.join("\n"));
}

const summer: Climate = { season: "summer", weather: "clear", snowCover: false };
const drMats = { ground: new THREE.MeshLambertMaterial({ vertexColors: true }), solid: new THREE.MeshLambertMaterial({ vertexColors: true }), lamp: new THREE.MeshBasicMaterial() };
const drCw = new CountryWorld(new THREE.Scene(), drMats as any, null);
drFs.mkdirSync(drDir, { recursive: true });
// (--list: the roads with no map yet, one a line, for make draftroads to share out.)
if (drArgs.includes("--list")) { drProc.stdout.write(WORLD_ROADS.filter((r) => !drFs.existsSync(roadFile(r.id))).map((r) => r.id + "\n").join("")); }
else for (const r of WORLD_ROADS) {
  const has = drFs.existsSync(roadFile(r.id));
  if (drWorld || (drIds.length ? !drIds.includes(r.id) : has)) continue;
  const t0 = Date.now(), metres = (r as any).metres ?? roadHead(r).length - ARRIVE_LEN, [A, B] = roadEnds(r);
  const M = draftRoad(r, metres, A, B);
  const gA = gateOf(A), gB = gateOf(B);
  const toFreeway = !!M.freeway, fwA = freewayGate(A.plan.seed), fwB = freewayGate(B.plan.seed);
  const road = new CountryRoad({
    seed: 0, city: 0, kind: "exit", map: M, back: false, driveSeed: 1, frame: gateEnd(gA), dEst: 0,
    fromTruck: "box16", toTruck: "box16", fromStyle: A.plan.style, toStyle: B.plan.style, fromName: A.plan.name, toName: B.plan.name,
    fromClimate: summer, toClimate: summer, toFreeway, toFreewayMerge: false, fromCurve: fwA ? A.plan.fwCurve : null,
    fromKey: A.plan.seed, toKey: B.plan.seed, toGateEnd: fwB && !toFreeway ? gateEnd(gB) : null, toCurve: fwB ? B.plan.fwCurve : null,
  });
  M.items = drCw.recordItems(road);
  writeMap(M, r);
  const I = M.items;
  console.log(`${roadFile(r.id)}: ${(M.length / 1000).toFixed(2)} km, ${M.pieces.length} pieces, ${I.trees.length / 4} trees, ${I.poles.length} poles, ${I.fences.length / 2} fence bays, ${(drFs.statSync(roadFile(r.id)).size / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (drWorld && !drArgs.includes("--list")) {
  const missing = WORLD_ROADS.filter((r) => !drFs.existsSync(roadFile(r.id)));
  if (missing.length) throw new Error(`no map for ${missing.map((r) => r.id).join(", ")}: draft them first`);
  const strip = ({ metres: _m, ...r }: WorldRoad & { metres?: number }) => r;
  drFs.writeFileSync("scenes/long-day/src/world-roads.ts", [
    `// The world graph's roads and the cities' places on the world map (docs/long-day-cities.md). Drafted`,
    `// by tools/draftworld.ts; edited by hand from here on. Each road's map is its own file in roads/ (roadmap.ts).`,
    `import type { WorldRoad } from "./world.ts";`,
    ``,
    `export const WORLD_ROADS: WorldRoad[] = [`,
    ...WORLD_ROADS.map((r) => `  ${drItem(strip(r))},`),
    `];`,
    ``,
    `// (Each city's place, x east and z south, in arbitrary units: for the world map only.)`,
    `export const WORLD_PLACES: Record<string, [number, number]> = {`,
    ...Object.entries(WORLD_PLACES).map(([k, v]) => `  ${JSON.stringify(k)}: [${v[0]}, ${v[1]}],`),
    `};`,
    ``,
  ].join("\n"));
  console.log(`scenes/long-day/src/world-roads.ts: ${WORLD_ROADS.length} roads, each with its map`);
}
