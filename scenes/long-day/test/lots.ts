// Test: a hand-shaped block (cityfile.ts CityFileLot) is built from the lots its file lists, in place
// of those the rules pick (city.ts buildLots): one block of Millbrook, given one lot of its own with
// its floors and wall colour, has that lot and no other, a building on it, and its neighbours
// unchanged; and a file with the lot reads back as written. (A city drafted by its rules, as the
// drafting tools build it: a city that lists its contents draws them, its lots among them.)
import * as THREE from "three@0.187.0";
import { CityPlan, fileOf, makeCityChunkBuilder } from "../src/city.ts";
import type { CityFile } from "../src/cityfile.ts";
import { inPoly, TILE } from "../src/citygraph.ts";
import { siteLayout } from "../src/facilities.ts";
import { PLACED } from "../src/geom.ts";
import { STYLES } from "../src/styles.ts";
import { cityById } from "../src/visits.ts";
import { cityFileOfPlan } from "../tools/cityfiles.ts";

const ltProc = (globalThis as any).process, ltFails: string[] = [];
const F0: CityFile = { ...fileOf(cityById("brick-millbrook")!), contents: () => null }, P0 = new CityPlan(F0.key, STYLES.brick, F0.key, F0), G0 = P0.graph;
// (A residential block with no site, its longest face 30 m or more.)
const B = G0.blocks.find((b) => b.inCity && !b.water && !b.park && P0.district(b.kx, b.kz) === "residential" && siteLayout(P0, b.kx, b.kz).kind === "kerb"
  && b.faces.some((f) => G0.faceA1(f) - G0.faceA0(f) >= 30))!;
const f = B.faces.reduce((p, q) => (G0.faceA1(q) - G0.faceA0(q) > G0.faceA1(p) - G0.faceA0(p) ? q : p)), a0 = G0.faceA0(f) + 2, a1 = a0 + 10;
const lot = { street: f >> 1, side: (f & 1 ? "l" : "r") as "l" | "r", a0, a1, depth: 10, floors: 2, wall: 0xd04a3a };
const F1: CityFile = { ...F0, blocks: F0.blocks.map((L) => G0.blockAt(L.at[0], L.at[1]) === B ? { ...L, lots: [lot] } : L) };
const mats = { ground: new THREE.MeshLambertMaterial(), solid: new THREE.MeshLambertMaterial(), lamp: new THREE.MeshBasicMaterial() };
// (The lots and footprints the block's own chunk records, in world coordinates, those in the block.)
const ltBuilt = (P: CityPlan) => {
  const cx = Math.floor(B.cx / TILE), cz = Math.floor(B.cz / TILE), gen = makeCityChunkBuilder(mats, P)(cx, cz);
  let r = gen.next(); while (!r.done) r = gen.next();
  const quads = (a: number[]) => { const out: [number, number][][] = []; for (let i = 0; i + 7 < a.length; i += 8) out.push([0, 2, 4, 6].map((k) => [a[i + k] + cx * TILE, a[i + k + 1] + cz * TILE] as [number, number])); return out; };
  const mid = (q: [number, number][]) => [q.reduce((s, p) => s + p[0], 0) / 4, q.reduce((s, p) => s + p[1], 0) / 4];
  const inB = (q: [number, number][]) => { const [x, z] = mid(q); return inPoly(B.poly, x, z); };
  return { lots: quads(PLACED.lots).filter(inB), feet: quads(PLACED.foot).filter(inB), others: quads(PLACED.lots).filter((q) => !inB(q)).length };
};
const before = ltBuilt(P0), P1 = new CityPlan(F0.key, STYLES.brick, F0.key, F1), after = ltBuilt(P1);
const corner = (a: number, n: number) => { const p = P1.graph.facePt(f, a, n); return [p.x, p.z]; };
if (after.lots.length !== 1) ltFails.push(`the block has ${after.lots.length} lots, not its 1 (it had ${before.lots.length})`);
else {
  const got = after.lots[0], exp = [corner(a0, 0.3), corner(a1, 0.3), corner(a1, 10), corner(a0, 10)];
  if (!exp.every(([x, z]) => got.some(([gx, gz]) => Math.hypot(gx - x, gz - z) < 0.01))) ltFails.push(`its lot is at ${JSON.stringify(got)}, not ${JSON.stringify(exp)}`);
}
if (!after.feet.length) ltFails.push("no building on its lot");
if (after.others !== before.others) ltFails.push(`the chunk's other lots changed: ${before.others} -> ${after.others}`);
const back = cityFileOfPlan(P1, F1.id, F1.name).blocks.find((L) => L.lots);
if (JSON.stringify(back?.lots) !== JSON.stringify([lot])) ltFails.push(`its file reads back with lots ${JSON.stringify(back?.lots)}`);
console.log(`lots: block ${B.kx},${B.kz}: ${before.lots.length} lots by the rules, ${after.lots.length} listed, ${after.feet.length} buildings on it`);
for (const m of ltFails) console.log(`FAIL ${m}`);
if (ltFails.length) ltProc.exit(1);
