// A city's contents (docs/long-day-cities.md, "City contents"): a city drawn from its listed recipes
// is the city its rules draw. Each city named (by default one of each style) is built chunk by
// chunk by its rules with the recipes recorded (contents.ts CONTENTS), then again from a file that
// lists those recipes and nothing else, through the same rows a contents file holds; every chunk
// must draw the same triangles, to the centimetre and in colour. (Each chunk is kept as a digest
// of its triangles; one that differs is built again both ways and compared, within 2 cm.)
//   Args (optional): city ids
import * as THREE from "three@0.187.0";
import { CityPlan, CITY_HI, CITY_LO, cityDistance, makeCityChunkBuilder } from "../src/city.ts";
import type { CityFile } from "../src/cityfile.ts";
import { CONTENTS, recipeOf, rowOf } from "../src/contents.ts";
import type { Recipe } from "../src/contents.ts";
import { RING } from "../src/grid.ts";
import { STYLES } from "../src/styles.ts";
import type { StyleId } from "../src/styles.ts";
import { CATALOGUE } from "../src/world.ts";

{
  const proc = (globalThis as any).process, errs: string[] = [];
  const want: string[] = proc.argv.slice(2);
  const ids = want.length ? want : [...new Set(CATALOGUE.map((F) => F.style))].map((st) => CATALOGUE.find((F) => F.style === st)!.id);
  const mats = { ground: new THREE.MeshLambertMaterial(), solid: new THREE.MeshLambertMaterial(), lamp: new THREE.MeshBasicMaterial() };
  type Tri = { key: string; p: number[] };
  // A chunk's triangles: each a key (its material's, and its corners and colour to the centimetre)
  // and its corners.
  const trisOf = (plan: CityPlan, cx: number, cz: number) => {
    const gen = makeCityChunkBuilder(mats as any, plan)(cx, cz); let r = gen.next(); while (!r.done) r = gen.next();
    const tris: Tri[] = [];
    (r.value as THREE.Group).traverse((o: any) => {
      if (!o.geometry) return;
      const m = o.material === mats.ground ? "g" : o.material === mats.solid ? "s" : o.material === mats.lamp ? "l" : "o", P = o.geometry.getAttribute("position").array, Cc = o.geometry.getAttribute("color")?.array;
      const ix = o.geometry.index?.array, n = ix ? ix.length : P.length / 3;
      for (let t = 0; t + 2 < n; t += 3) {
        const p: number[] = [], c: number[] = [];
        for (let k = 0; k < 3; k++) { const v = ix ? ix[t + k] : t + k; p.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); if (Cc) c.push(Math.round(Cc[v * 3] * 255), Math.round(Cc[v * 3 + 1] * 255), Math.round(Cc[v * 3 + 2] * 255)); }
        tris.push({ key: `${m}|${p.map((v) => Math.round(v * 100)).join(",")}|${c.join(",")}`, p });
      }
    });
    (r.value as THREE.Group).userData.onDispose?.();   // (its sign slots back: the city is built twice)
    return tris;
  };
  // (Its triangles in any order, as one number.)
  const digest = (tris: Tri[]) => {
    let h = 2166136261;
    for (const k of tris.map((t) => t.key).sort()) for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const chunksOf = () => { const out: [number, number][] = []; for (let cx = CITY_LO - RING; cx <= CITY_HI + RING; cx++) for (let cz = CITY_LO - RING; cz <= CITY_HI + RING; cz++) if (cityDistance(cx, cz) <= 0) out.push([cx, cz]); return out; };
  let chunks = 0, recipes = 0;
  for (const id of ids) {
    // (The city by its rules: its file's own contents and doors left out.)
    const F0 = CATALOGUE.find((c) => c.id === id)!, style = STYLES[F0.style as StyleId];
    const F: CityFile = { ...F0, contents: () => null, blocks: F0.blocks.map(({ doors: _d, ...b }) => b) };
    const ruledPlan = new CityPlan(F.key, style, F.key, F), ruled = new Map<string, number>(), recorded = new Map<string, Recipe[]>();
    CONTENTS.out = recorded;
    try { for (const [cx, cz] of chunksOf()) ruled.set(`${cx},${cz}`, digest(trisOf(ruledPlan, cx, cz))); }
    finally { CONTENTS.out = null; }
    // The file listing what was recorded, as a contents file's rows: each block's, each street's (all
    // its tiles'), the ring's.
    const G = ruledPlan.graph, blockItems = new Map<number, Recipe[]>(), streetItems = new Map<number, Recipe[]>(), outskirts: Recipe[] = [];
    for (const [owner, list] of recorded) {
      recipes += list.length;
      if (owner.startsWith("b")) blockItems.set(Number(owner.slice(1)), list);
      else if (owner.startsWith("s")) { const sid = Number(owner.slice(1, owner.indexOf("@"))); streetItems.set(sid, [...(streetItems.get(sid) ?? []), ...list]); }
      else outskirts.push(...list);
    }
    const rows = JSON.parse(JSON.stringify({
      blocks: Object.fromEntries(F.blocks.map((b, i) => [i, (blockItems.get(G.blockAt(b.at[0], b.at[1])!.id) ?? []).map(rowOf)])),
      streets: Object.fromEntries([...streetItems].map(([k, l]) => [k, l.map(rowOf)])), outskirts: outskirts.map(rowOf) }));
    // (A row reads back as its recipe, its fields in any order.)
    const canon = (r: Recipe) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));
    for (const l of [...blockItems.values(), ...streetItems.values(), outskirts]) for (const r of l) if (canon(recipeOf(JSON.parse(JSON.stringify(rowOf(r))))) !== canon(r)) { errs.push(`${id}: a ${r.k}'s row does not read back as it (${JSON.stringify(r).slice(0, 120)})`); break; }
    const listedPlan = new CityPlan(F.key, style, F.key, { ...F, contents: () => rows });
    let diffs = 0;
    for (const [cx, cz] of chunksOf()) {
      chunks++;
      const key = `${cx},${cz}`, B = trisOf(listedPlan, cx, cz);
      if (digest(B) === ruled.get(key)) continue;
      // Built again by the rules, the two compared: what the centimetre's rounding split, matched within 2 cm.
      const A = trisOf(ruledPlan, cx, cz), count = new Map<string, number>();
      for (const t of A) count.set(t.key, (count.get(t.key) ?? 0) + 1);
      const extra: Tri[] = [];
      for (const t of B) { const n = count.get(t.key) ?? 0; if (n > 0) count.set(t.key, n - 1); else extra.push(t); }
      const missing = A.filter((t) => { const n = count.get(t.key) ?? 0; if (n > 0) { count.set(t.key, n - 1); return true; } return false; });
      const left = extra.filter((t) => {
        const tail = t.key.slice(t.key.lastIndexOf("|")), mk = t.key[0];
        const i = missing.findIndex((u) => u.key[0] === mk && u.key.endsWith(tail) && u.p.every((v, k) => Math.abs(v - t.p[k]) < 0.02));
        if (i < 0) return true;
        missing.splice(i, 1); return false;
      });
      if (!missing.length && !left.length) continue;
      errs.push(`${id} chunk ${key}: ${missing.length} of its rules' triangles not drawn from its file, ${left.length} drawn that its rules don't (e.g. ${(missing[0] ?? left[0]).key.slice(0, 90)})`);
      if (++diffs > 8 || errs.length > 30) break;
    }
    console.log(`${id}: ${[...recorded.values()].reduce((n, l) => n + l.length, 0)} recipes, ${(JSON.stringify(rows).length / 1024).toFixed(0)} KB as rows`);
  }
  if (errs.length) { console.error(errs.slice(0, 30).join("\n")); proc.exit(1); }
  console.log(`contents: ${chunks} chunks of ${ids.length} cities drawn from their recipes as by their rules (${recipes} recipes)`);
}
