// Test: this measures what a city chunk costs the board, style by style: its triangles (mean, 95th percentile
// and the most of any chunk) and meshes (draw calls), over every chunk of a city of each style.
// The storybook city (styles.ts) is built from curved, bulging parts; it must cost no more than
// BUDGET times the dearest of the real styles, by mean and by 95th percentile, or this fails.
// The optional args are seed (default 1) and cities per style (default 2).
import * as THREE from "three@0.187.0";
import { CityPlan, makeCityChunkBuilder, cityDistance, CITY_LO, CITY_HI } from "../src/city.ts";
import { citySeedOf } from "../src/country.ts";
import { STYLES } from "../src/styles.ts";
import type { StyleId } from "../src/styles.ts";
import { BLOCK, RING } from "../src/grid.ts";

const proc = (globalThis as any).process, argv: string[] = proc.argv.slice(2);
const SEED = argv[0] ? Number(argv[0]) : 1, PER = argv[1] ? Number(argv[1]) : 2;
const BUDGET = 1.2;

const mat = { ground: new THREE.MeshLambertMaterial(), solid: new THREE.MeshLambertMaterial(), lamp: new THREE.MeshBasicMaterial() };
const pct = (a: number[], p: number) => { const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const rows: { id: string; mean: number; p95: number; max: number; meshes: number }[] = [];
for (const id of Object.keys(STYLES) as StyleId[]) {
  const tris: number[] = [], meshes: number[] = [];
  for (let k = 0; k < PER; k++) {
    const plan = new CityPlan(citySeedOf(SEED, 1 + k * 7), STYLES[id]), build = makeCityChunkBuilder(mat, plan);
    plan.climate = { season: "autumn", weather: "clear", snowCover: false };
    for (let cx = CITY_LO - RING; cx <= CITY_HI + RING; cx++) for (let cz = CITY_LO - RING; cz <= CITY_HI + RING; cz++) {
      if (cityDistance(cx, cz) > 0) continue;   // (it counts the city's own chunks: the outskirts are alike everywhere)
      const gen = build(cx, cz); let r = gen.next(); while (!r.done) r = gen.next();
      const g = r.value; if (!g) continue;
      let t = 0, m = 0;
      g.traverse((o: any) => { if (!o.isMesh) return; m++; const geo = o.geometry as THREE.BufferGeometry; t += (geo.index ? geo.index.count : geo.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); });
      tris.push(t); meshes.push(m);
      void BLOCK;
    }
  }
  const mean = tris.reduce((a, b) => a + b, 0) / tris.length;
  rows.push({ id, mean, p95: pct(tris, 0.95), max: Math.max(...tris), meshes: meshes.reduce((a, b) => a + b, 0) / meshes.length });
}
for (const r of rows) console.log(`${r.id.padEnd(11)} triangles/chunk mean ${r.mean.toFixed(0).padStart(6)}  p95 ${String(r.p95).padStart(6)}  max ${String(r.max).padStart(6)}  meshes ${r.meshes.toFixed(1)}`);
const real = rows.filter((r) => r.id !== "storybook"), sb = rows.find((r) => r.id === "storybook");
if (sb) {
  const mean = Math.max(...real.map((r) => r.mean)), p95 = Math.max(...real.map((r) => r.p95));
  const ok = sb.mean <= BUDGET * mean && sb.p95 <= BUDGET * p95;
  console.log(`storybook: mean ${(sb.mean / mean).toFixed(2)}x, p95 ${(sb.p95 / p95).toFixed(2)}x the dearest real style (budget ${BUDGET}x)`);
  if (!ok) { console.log("FAIL: the storybook city costs too much"); proc.exit(1); }
}
