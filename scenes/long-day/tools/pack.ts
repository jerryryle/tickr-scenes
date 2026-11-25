// Packs every city for the scene (docs/long-day-cities.md, "City contents"): from each city's
// folder, src/city-<style>/<city>/, its city file's head (all but its layout: cityfile.ts
// CityHead) as it is, and its layout (nodes, streets and blocks) and its contents file's rows as
// JSON packed by src/pack.ts, into src/cities-packed.ts. The scene imports that in place of the
// city files and contents files, so it holds a city's layout and contents only while it has the
// city planned (build output: not committed). The Makefile runs this before every build of the
// scene, a test or a tool; it does nothing when the packed file is newer than everything it packs.
//
//   node scenes/long-day/tools/pack.ts
//
// (Plain Node: the city files, contents files and pack.ts are TypeScript that Node runs as it is.)
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { packText, unpackText } from "../src/pack.ts";

const src = path.resolve(import.meta.dirname, "../src"), outFile = path.join(src, "cities-packed.ts");
// (Each city's folder in its style's, under the city's id: <style>-<slug>.)
const cities = fs.readdirSync(src).filter((d) => d.startsWith("city-")).flatMap((d) => fs.readdirSync(path.join(src, d), { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => ({ id: `${d.slice("city-".length)}-${e.name}`, file: path.join(src, d, e.name, `${e.name}.ts`), contents: path.join(src, d, e.name, `${e.name}-contents.ts`) })))
  .filter((c) => fs.existsSync(c.file)).sort((a, b) => (a.id < b.id ? -1 : 1));
const inputs = [...cities.flatMap((c) => [c.file, ...(fs.existsSync(c.contents) ? [c.contents] : [])]), path.join(src, "pack.ts"), import.meta.filename];
const stale = !fs.existsSync(outFile) || inputs.some((f) => fs.statSync(f).mtimeMs > fs.statSync(outFile).mtimeMs);
if (stale) {
  const heads: string[] = [], layouts: string[] = [], contents: string[] = [];
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
  const lines = [
    `// Every city, packed (tools/pack.ts from src/city-*/*/). Build output: edit the city files and`,
    `// contents files, not this.`,
    `import type { CityHead } from "./cityfile.ts";`,
    `export const CITY_HEADS: Record<string, CityHead> = {`, ...heads, `};`,
    `export const PACKED_LAYOUTS: Record<string, string> = {`, ...layouts, `};`,
    `export const PACKED_CONTENTS: Record<string, string> = {`, ...contents, `};`, ``,
  ];
  // (Written whole and then moved into place: tests flattened side by side may each run this.)
  const tmp = `${outFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, lines.join("\n"));
  fs.renameSync(tmp, outFile);
  console.error(`${path.relative(process.cwd(), outFile)}: ${cities.length} cities' layouts and contents, ${(raw / 1048576).toFixed(1)} MB packed to ${(packed / 1048576).toFixed(1)} MB`);
}
