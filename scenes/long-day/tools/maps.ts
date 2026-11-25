// Writes every catalogue city's map into build/long-day-maps/ (tools/mapsvg.ts), or only the cities named:
//
//   make maps SCENE=long-day [ARGS="<city id> ..."]
//
// Run from the repo root.
import { CATALOGUE } from "../src/world.ts";
import { citySvg, mapPath, worldMapPath, worldSvg } from "./mapsvg.ts";

const mapsProc = (globalThis as any).process, mapsFs = mapsProc.getBuiltinModule("node:fs");
const mapsWant: string[] = mapsProc.argv.slice(2);
// (--list: the cities' ids, one a line, for make maps to share out.)
const mapsList = mapsWant[0] === "--list";
if (mapsList) mapsProc.stdout.write(["world", ...CATALOGUE.map((F) => F.id)].join("\n") + "\n");
// (The world map with every run of all the cities, or when "world" is named.)
if (!mapsList && (!mapsWant.length || mapsWant.includes("world"))) { mapsFs.mkdirSync("build/long-day-maps", { recursive: true }); mapsFs.writeFileSync(worldMapPath, worldSvg()); console.log(worldMapPath); }
for (const F of mapsList ? [] : CATALOGUE) {
  if (mapsWant.length && !mapsWant.includes(F.id)) continue;
  const t0 = Date.now(), svg = citySvg(F);
  mapsFs.mkdirSync(mapPath(F).replace(/\/[^/]*$/, ""), { recursive: true });
  mapsFs.writeFileSync(mapPath(F), svg);
  console.log(`${mapPath(F)}: ${(svg.length / 1024).toFixed(0)} KB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
