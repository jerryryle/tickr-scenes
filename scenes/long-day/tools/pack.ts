// Packs every city and road for the scene (docs/long-day-cities.md, "How the scene carries the
// cities") into src/world-packed.ts: from each city's folder, src/city-<style>/<city>/, its city
// file's head (all but its layout: cityfile.ts CityHead) as it is, and its layout (nodes, streets
// and blocks) and its contents file's rows as JSON packed by src/pack.ts; and from each road map in
// src/roads/, its head (roadmap.ts RoadHead) and the map packed. The scene imports that in place of
// the city files, contents files and road maps, so it holds a city's layout and contents only while
// it has the city planned, and a road's map only while it has a drive along it (build output: not
// committed). The Makefile runs this before every build of the scene, a test or a tool; it does
// nothing when the packed file is newer than everything it packs.
//
//   node scenes/long-day/tools/pack.ts
//
// (Plain Node: the city files, contents files, road maps and pack.ts are TypeScript that Node runs
// as it is.)
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { packText, unpackText } from "../src/pack.ts";

const src = path.resolve(import.meta.dirname, "../src"), outFile = path.join(src, "world-packed.ts");
// (Each city's folder in its style's, under the city's id: <style>-<slug>.)
const cities = fs.readdirSync(src).filter((d) => d.startsWith("city-")).flatMap((d) => fs.readdirSync(path.join(src, d), { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => ({ id: `${d.slice("city-".length)}-${e.name}`, file: path.join(src, d, e.name, `${e.name}.ts`), contents: path.join(src, d, e.name, `${e.name}-contents.ts`) })))
  .filter((c) => fs.existsSync(c.file)).sort((a, b) => (a.id < b.id ? -1 : 1));
const roads = fs.readdirSync(path.join(src, "roads")).filter((f) => /^road-.*\.ts$/.test(f)).sort().map((f) => ({ id: f.slice("road-".length, -".ts".length), file: path.join(src, "roads", f) }));
const inputs = [...roads.map((r) => r.file), ...cities.flatMap((c) => [c.file, ...(fs.existsSync(c.contents) ? [c.contents] : [])]), path.join(src, "pack.ts"), import.meta.filename];
const stale = !fs.existsSync(outFile) || inputs.some((f) => fs.statSync(f).mtimeMs > fs.statSync(outFile).mtimeMs);
if (stale) {
  const heads: string[] = [], layouts: string[] = [], contents: string[] = [], roadHeads: string[] = [], roadMaps: string[] = [];
  let raw = 0, packed = 0;
  const pack = (f: string, json: string) => {
    const p = packText(json);
    if (unpackText(p) !== json) throw new Error(`${f}: did not unpack as it was packed`);
    raw += json.length; packed += p.length;
    return p;
  };
  const exported = async (f: string) => Object.values(await import(pathToFileURL(f).href))[0] as Record<string, unknown>;
  for (const c of cities) {
    const { nodes, streets, blocks, ...head } = await exported(c.file);
    if (head.id !== c.id) throw new Error(`${c.file}: its id is ${head.id}, not ${c.id}`);
    heads.push(`  ${JSON.stringify(c.id)}: ${JSON.stringify(head)},`);
    layouts.push(`  ${JSON.stringify(c.id)}: ${JSON.stringify(pack(c.file, JSON.stringify({ nodes, streets, blocks })))},`);
    if (fs.existsSync(c.contents)) contents.push(`  ${JSON.stringify(c.id)}: ${JSON.stringify(pack(c.contents, JSON.stringify(await exported(c.contents))))},`);
  }
  for (const r of roads) {
    const M = await exported(r.file) as { id: string; length: number; heading: number[] };
    if (M.id !== r.id) throw new Error(`${r.file}: its id is ${M.id}, not ${r.id}`);
    roadHeads.push(`  ${JSON.stringify(r.id)}: ${JSON.stringify({ length: M.length, end: M.heading[M.heading.length - 1] })},`);
    roadMaps.push(`  ${JSON.stringify(r.id)}: ${JSON.stringify(pack(r.file, JSON.stringify(M)))},`);
  }
  const lines = [
    `// Every city and road, packed (tools/pack.ts from src/city-*/*/ and src/roads/). Build output:`,
    `// edit the city files, contents files and road maps, not this.`,
    `import type { CityHead } from "./cityfile.ts";`,
    `import type { RoadHead } from "./roadmap.ts";`,
    `export const CITY_HEADS: Record<string, CityHead> = {`, ...heads, `};`,
    `export const PACKED_LAYOUTS: Record<string, string> = {`, ...layouts, `};`,
    `export const PACKED_CONTENTS: Record<string, string> = {`, ...contents, `};`,
    `export const ROAD_HEADS: Record<string, RoadHead> = {`, ...roadHeads, `};`,
    `export const PACKED_ROADS: Record<string, string> = {`, ...roadMaps, `};`, ``,
  ];
  // (Written whole and then moved into place: tests flattened side by side may each run this.)
  const tmp = `${outFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, lines.join("\n"));
  fs.renameSync(tmp, outFile);
  console.error(`${path.relative(process.cwd(), outFile)}: ${cities.length} cities' layouts and contents and ${roads.length} roads' maps, ${(raw / 1048576).toFixed(1)} MB packed to ${(packed / 1048576).toFixed(1)} MB`);
}
