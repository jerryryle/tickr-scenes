// Writes a build's scene.json: the scene's own, with every asset a build step packed into
// scenes/<scene>/assets-packed/ added to its list (long-day's world asset, tools/pack.ts), since the
// toolkit finds each asset by its scene.json entry.
//
//   node scripts/scenejson.ts scenes/<scene> build/<out>
import * as fs from "node:fs";
import * as path from "node:path";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error("usage: node scripts/scenejson.ts scenes/<scene> <out dir>"); process.exit(2); }
const scene = JSON.parse(fs.readFileSync(path.join(dir, "scene.json"), "utf8"));
const packed = path.join(dir, "assets-packed");
if (fs.existsSync(packed)) for (const f of fs.readdirSync(packed).filter((f) => !f.includes(".tmp")).sort()) {
  if (scene.assets.some((a: { name: string }) => a.name === f)) { console.error(`${packed}/${f}: the scene has an asset of that name already`); process.exit(1); }
  scene.assets.push({ name: f, content_type: "application/octet-stream", size: fs.statSync(path.join(packed, f)).size, type: "binary", configurable: false });
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "scene.json"), JSON.stringify(scene, null, 2) + "\n");
