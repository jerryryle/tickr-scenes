// Packs every city's contents for the scene (docs/fixed-cities.md, "City contents"): each
// src/city-<style>/<city>/<city>-contents.ts, its recipes' rows as JSON packed by
// src/pack.ts, into src/contents-packed.ts, which the scene imports in place of the contents
// files themselves (build output: not committed). The Makefile runs it before every build of the
// scene, a test or a tool; it does nothing when the packed file is newer than everything it packs.
//
//   node scenes/long-day/tools/pack.ts
//
// (Plain Node: the contents files and pack.ts are TypeScript that Node runs as it is.)
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { packText, unpackText } from "../src/pack.ts";

const src = path.resolve(import.meta.dirname, "../src"), outFile = path.join(src, "contents-packed.ts");
// (Each city's folder in its style's: src/city-<style>/<city>/.)
const files = fs.readdirSync(src).filter((d) => d.startsWith("city-")).flatMap((d) => fs.readdirSync(path.join(src, d), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(src, d, e.name, `${e.name}-contents.ts`))).filter((f) => fs.existsSync(f)).sort();
const inputs = [...files, path.join(src, "pack.ts"), import.meta.filename];
const stale = !fs.existsSync(outFile) || inputs.some((f) => fs.statSync(f).mtimeMs > fs.statSync(outFile).mtimeMs);
if (stale) {
  const lines = [
    `// Every city's contents, packed (tools/pack.ts from src/city-*/*/*-contents.ts). Build output:`,
    `// edit the contents files, not this.`,
    `export const PACKED_CONTENTS: Record<string, string> = {`,
  ];
  let raw = 0, packed = 0;
  for (const f of files) {
    const mod = await import(pathToFileURL(f).href), C = Object.values(mod)[0], json = JSON.stringify(C), p = packText(json);
    if (unpackText(p) !== json) throw new Error(`${f}: did not unpack as it was packed`);
    // (Under the city's id: <style>-<slug>.)
    const id = `${path.basename(path.dirname(path.dirname(f))).slice("city-".length)}-${path.basename(path.dirname(f))}`;
    lines.push(`  ${JSON.stringify(id)}: ${JSON.stringify(p)},`);
    raw += json.length; packed += p.length;
  }
  lines.push(`};`, ``);
  // (Written whole and then moved into place: tests flattened side by side may each run this.)
  const tmp = `${outFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, lines.join("\n"));
  fs.renameSync(tmp, outFile);
  console.error(`${path.relative(process.cwd(), outFile)}: ${files.length} cities' contents, ${(raw / 1048576).toFixed(1)} MB packed to ${(packed / 1048576).toFixed(1)} MB`);
}
