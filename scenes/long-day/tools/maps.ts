// Writes every catalogue city's map and every road's into build/long-day-maps/ (tools/mapsvg.ts), or
// only the cities and roads named:
//
//   make maps SCENE=long-day [ARGS="<city or road id> ..."]
//
// Run from the repo root.
import { CATALOGUE } from "../src/world.ts";
import { citySvg, mapPath, roadMapPath, roadSvg, worldMapPath, worldSvg } from "./mapsvg.ts";
import { WORLD_ROADS } from "../src/world-roads.ts";

const mapsProc = (globalThis as any).process, mapsFs = mapsProc.getBuiltinModule("node:fs");
const mapsWant: string[] = mapsProc.argv.slice(2);
// (--list: the cities' ids, one a line, for make maps to share out.)
const mapsList = mapsWant[0] === "--list";
if (mapsList) mapsProc.stdout.write(["world", ...CATALOGUE.map((F) => F.id), ...WORLD_ROADS.map((r) => r.id)].join("\n") + "\n");
// (The world map with every run of all the cities, or when "world" is named.)
if (!mapsList && (!mapsWant.length || mapsWant.includes("world"))) { mapsFs.mkdirSync("build/long-day-maps", { recursive: true }); mapsFs.writeFileSync(worldMapPath, worldSvg()); console.log(worldMapPath); }
for (const F of mapsList ? [] : CATALOGUE) {
  if (mapsWant.length && !mapsWant.includes(F.id)) continue;
  const t0 = Date.now(), svg = citySvg(F);
  mapsFs.mkdirSync(mapPath(F).replace(/\/[^/]*$/, ""), { recursive: true });
  mapsFs.writeFileSync(mapPath(F), svg);
  console.log(`${mapPath(F)}: ${(svg.length / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
// Each road's map, likewise (named by its id).
for (const r of mapsList ? [] : WORLD_ROADS) {
  if (mapsWant.length && !mapsWant.includes(r.id)) continue;
  const svg = roadSvg(r);
  mapsFs.mkdirSync("build/long-day-maps/roads", { recursive: true });
  mapsFs.writeFileSync(roadMapPath(r), svg);
  console.log(`${roadMapPath(r)}: ${(svg.length / 1024).toFixed(0)} KB`);
}
