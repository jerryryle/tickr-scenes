// Packs every city and road for the scene (docs/long-day-cities.md, "How the scene carries the
// cities"). From each city's folder, src/city-<style>/<city>/, it takes its city file's head (all but
// its layout: cityfile.ts CityHead), its layout (nodes, streets and blocks) and its contents file's
// rows; from each road map in src/roads/, its head (roadmap.ts RoadHead) and the map. The heads go
// into src/world-packed.ts as they are, with where each packed item lies in the world asset. The
// layouts, contents and maps go as JSON packed by src/pack.ts, one after another, into the world
// asset, assets-packed/<WORLD_ASSET>, which the Makefile copies in among the scene's assets and
// which is named after its contents' hash, so a new one never replaces one a published version
// reads. The scene reads that asset (worlddata.ts) in place of the city files, contents files and
// road maps, so it holds a city's layout and contents only while it has the city planned, and a
// road's map only while it has a drive along it. Both are build output, not committed.
//
// The Makefile runs this before every build of the scene, a test or a tool; it does nothing when
// the packed files are newer than everything they pack.
//
//   node scenes/long-day/tools/pack.ts
//
// (Plain Node: the city files, contents files, road maps and pack.ts are TypeScript that Node runs
// as it is.)
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { packBytes, unpackBytes } from "../src/pack.ts";

const src = path.resolve(import.meta.dirname, "../src"), outFile = path.join(src, "world-packed.ts");
const assetDir = path.resolve(import.meta.dirname, "../assets-packed");
// (Each city's folder in its style's, under the city's id: <style>-<slug>.)
const cities = fs.readdirSync(src).filter((d) => d.startsWith("city-")).flatMap((d) => fs.readdirSync(path.join(src, d), { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => ({ id: `${d.slice("city-".length)}-${e.name}`, file: path.join(src, d, e.name, `${e.name}.ts`), contents: path.join(src, d, e.name, `${e.name}-contents.ts`) })))
  .filter((c) => fs.existsSync(c.file)).sort((a, b) => (a.id < b.id ? -1 : 1));
const roads = fs.readdirSync(path.join(src, "roads")).filter((f) => /^road-.*\.ts$/.test(f)).sort().map((f) => ({ id: f.slice("road-".length, -".ts".length), file: path.join(src, "roads", f) }));
const inputs = [...roads.map((r) => r.file), ...cities.flatMap((c) => [c.file, ...(fs.existsSync(c.contents) ? [c.contents] : [])]), path.join(src, "pack.ts"), import.meta.filename];
// (Stale, too, when the files packed are not those it packed last, as its first line lists them: a
// city or road renamed or deleted keeps its files' times; or when its asset is gone.)
const listed = `// From ${JSON.stringify(inputs.map((f) => path.relative(src, f)))}`;
const last = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
const lastAsset = /WORLD_ASSET = "([^"]+)"/.exec(last)?.[1];
const stale = !last.startsWith(`${listed}\n`) || !lastAsset || !fs.existsSync(path.join(assetDir, lastAsset))
  || inputs.some((f) => fs.statSync(f).mtimeMs > fs.statSync(outFile).mtimeMs);
if (stale) {
  const heads: string[] = [], roadHeads: string[] = [], chunks: Uint8Array[] = [];
  const index: Record<"layouts" | "contents" | "roads", Record<string, [number, number]>> = { layouts: {}, contents: {}, roads: {} };
  let raw = 0, at = 0;
  // (Packed into the asset, and where it lies there.)
  const put = (kind: keyof typeof index, id: string, f: string, json: string) => {
    const p = packBytes(json);
    if (unpackBytes(p) !== json) throw new Error(`${f}: did not unpack as it was packed`);
    index[kind][id] = [at, p.length]; chunks.push(p); at += p.length; raw += json.length;
  };
  const exported = async (f: string) => Object.values(await import(pathToFileURL(f).href))[0] as Record<string, unknown>;
  for (const c of cities) {
    const { nodes, streets, blocks, ...head } = await exported(c.file);
    if (head.id !== c.id) throw new Error(`${c.file}: its id is ${head.id}, not ${c.id}`);
    heads.push(`  ${JSON.stringify(c.id)}: ${JSON.stringify(head)},`);
    put("layouts", c.id, c.file, JSON.stringify({ nodes, streets, blocks }));
    if (fs.existsSync(c.contents)) put("contents", c.id, c.contents, JSON.stringify(await exported(c.contents)));
  }
  for (const r of roads) {
    const M = await exported(r.file) as { id: string; length: number; heading: number[] };
    if (M.id !== r.id) throw new Error(`${r.file}: its id is ${M.id}, not ${r.id}`);
    roadHeads.push(`  ${JSON.stringify(r.id)}: ${JSON.stringify({ length: M.length, end: M.heading[M.heading.length - 1] })},`);
    put("roads", r.id, r.file, JSON.stringify(M));
  }
  const bytes = new Uint8Array(at);
  for (let k = 0, o = 0; k < chunks.length; o += chunks[k].length, k++) bytes.set(chunks[k], o);
  const name = `world_${crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`;
  // (The asset alone in its folder, written whole and then moved into place: tests flattened side
  // by side may each run this.)
  fs.mkdirSync(assetDir, { recursive: true });
  for (const f of fs.readdirSync(assetDir)) if (f !== name && !f.includes(".tmp")) fs.rmSync(path.join(assetDir, f));
  const tmpAsset = path.join(assetDir, `${name}.${process.pid}.tmp`);
  fs.writeFileSync(tmpAsset, bytes);
  fs.renameSync(tmpAsset, path.join(assetDir, name));
  const lines = [
    listed,
    `// Every city's and road's head, and where its packed parts lie in the world asset (tools/pack.ts`,
    `// from src/city-*/*/ and src/roads/). Build output: edit the city files, contents files and road`,
    `// maps, not this.`,
    `import type { CityHead } from "./cityfile.ts";`,
    `import type { RoadHead } from "./roadmap.ts";`,
    `export const WORLD_ASSET = ${JSON.stringify(name)};`,
    `export const WORLD_FILE = ${JSON.stringify(path.relative(path.resolve(import.meta.dirname, "../../.."), path.join(assetDir, name)))};   // (where Node finds it: from the repo's root)`,
    `export const WORLD_INDEX: Record<"layouts" | "contents" | "roads", Record<string, [number, number]>> = ${JSON.stringify(index)};`,
    `export const CITY_HEADS: Record<string, CityHead> = {`, ...heads, `};`,
    `export const ROAD_HEADS: Record<string, RoadHead> = {`, ...roadHeads, `};`, ``,
  ];
  const tmp = `${outFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, lines.join("\n"));
  fs.renameSync(tmp, outFile);
  console.error(`${path.relative(process.cwd(), outFile)} and assets-packed/${name}: ${cities.length} cities' layouts and contents and ${roads.length} roads' maps, ${(raw / 1048576).toFixed(1)} MB packed to ${(at / 1048576).toFixed(1)} MB`);
}
