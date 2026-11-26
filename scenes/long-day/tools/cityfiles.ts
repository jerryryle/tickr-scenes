// Writing and checking city files (src/cityfile.ts): the drafting tool (tools/draftcities.ts)
// writes a generated city's plan out with cityFileOfPlan, and it and test/catalogue.ts check a
// city with cityProblems.
import * as THREE from "three@0.187.0";
import { CityPlan, CITY_HI, CITY_LO, cityDistance, kerbDoors, makeCityChunkBuilder } from "../src/city.ts";
import { CONTENTS, rowOf } from "../src/contents.ts";
import type { Recipe, RecipeRow } from "../src/contents.ts";
import type { KerbDoor } from "../src/city.ts";
import { FURNITURE, PK } from "../src/decor.ts";
import { angleDiff } from "../src/citygraph.ts";
import { BLOCK, RING } from "../src/grid.ts";
import { signalPoles, stopSignPosts } from "../src/signals.ts";
import { insidePoint, STREET_HALF, STREET_KERB } from "../src/cityfile.ts";
import type { CityFile, CityFileBlock, CityFileContents, CityFileFreeway, CityFileGate, CityFileNode, CityFileStreet, StreetTag } from "../src/cityfile.ts";
import { inPoly } from "../src/citygraph.ts";
import { facilityAt, siteLayout } from "../src/facilities.ts";
import type { StyleId } from "../src/styles.ts";

const cm = (v: number) => Math.round(v * 100) / 100;

// Every street's furniture as the city's chunks are built (decor.ts streetFurniture records each
// piece it places, or draws from a file): each street's pieces as [kind, side looking from its
// first node to its second, metres along from it].
export function streetFurnitureOf(plan: CityPlan): Map<number, [string, "l" | "r", number][]> {
  const G = plan.graph, mats = { ground: new THREE.MeshLambertMaterial(), solid: new THREE.MeshLambertMaterial(), lamp: new THREE.MeshBasicMaterial() };
  const build = makeCityChunkBuilder(mats, plan), rec: number[] = [];
  FURNITURE.out = rec;
  try {
    for (let cx = CITY_LO - RING; cx <= CITY_HI + RING; cx++) for (let cz = CITY_LO - RING; cz <= CITY_HI + RING; cz++) {
      if (cityDistance(cx, cz) > 0) continue;
      const gen = build(cx, cz); let r = gen.next(); while (!r.done) r = gen.next();
    }
  } finally { FURNITURE.out = null; }
  const name = Object.fromEntries(Object.entries(PK).map(([k, v]) => [v, k])) as Record<number, string>;
  const out = new Map<number, [string, "l" | "r", number][]>(), seen = new Set<string>();
  for (let i = 0; i + 3 < rec.length; i += 4) {
    // (Once each: a street is drawn again in the probe builds a chunk's doors and pavement ask for.)
    const k = `${rec[i]}/${rec[i + 1]}/${rec[i + 2].toFixed(3)}/${rec[i + 3]}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const st = G.streets[rec[i]], axis = Math.abs(angleDiff(st.h0 + Math.PI / 2)) < 1e-9 ? 1 : 0;
    // (Its lo side, inward -1, is the street's right on a north-south grid street, its left on any other: city.ts fileFurniture.)
    const lo = rec[i + 3] < 0, side: "l" | "r" = (axis === 1) === lo ? "r" : "l";
    const list = out.get(st.id) ?? [];
    list.push([name[rec[i + 1]], side, cm(rec[i + 2] - 9)]);
    out.set(st.id, list);
  }
  return out;
}

// A city's plan as a city file, its structure as the plan has it.
// Everything that stands on the city's layout, as its builders make it (contents.ts): every chunk
// built with the recipes recorded, by what owns them (a block, a street, the countryside ring).
export interface CityContents { blocks: Map<number, Recipe[]>; streets: Map<number, Recipe[]>; outskirts: Recipe[] }
export function cityContentsOf(plan: CityPlan): CityContents {
  const mats = { ground: new THREE.MeshLambertMaterial(), solid: new THREE.MeshLambertMaterial(), lamp: new THREE.MeshBasicMaterial() };
  const build = makeCityChunkBuilder(mats, plan), rec = CONTENTS.out = new Map<string, Recipe[]>();
  try {
    for (let cx = CITY_LO - RING; cx <= CITY_HI + RING; cx++) for (let cz = CITY_LO - RING; cz <= CITY_HI + RING; cz++) {
      if (cityDistance(cx, cz) > 0) continue;
      const gen = build(cx, cz); let r = gen.next(); while (!r.done) r = gen.next();
      (r.value as THREE.Group).userData.onDispose?.();
    }
  } finally { CONTENTS.out = null; }
  const out: CityContents = { blocks: new Map(), streets: new Map(), outskirts: [] };
  for (const [owner, list] of rec) {
    if (owner.startsWith("b")) out.blocks.set(Number(owner.slice(1)), list);
    else if (owner.startsWith("s")) { const sid = Number(owner.slice(1, owner.indexOf("@"))); out.streets.set(sid, [...(out.streets.get(sid) ?? []), ...list]); }
    else out.outskirts.push(...list);
  }
  return out;
}

export function cityFileOfPlan(plan: CityPlan, id: string, name: string): CityFile {
  const G = plan.graph, O = plan.outline;
  const nodes: CityFileNode[] = G.nodes.map((N) => {
    const out: CityFileNode = { id: N.id, x: cm(N.x), z: cm(N.z), k: [N.kx, N.kz], ...(N.control !== "signal" ? { control: N.control } : {}) };
    const poles = signalPoles(G, N), stops = [...stopSignPosts(G, N)].sort((a, b) => a[0] - b[0]);
    if (poles.length) out.poles = poles.map((p) => [p.i, cm(p.px), cm(p.pz), Math.round(p.h * 1e4) / 1e4, cm(p.toCentre)]);
    if (stops.length) out.stops = stops.map(([arm, [x, z]]) => [arm, cm(x), cm(z)]);
    return out;
  });
  const furniture = streetFurnitureOf(plan);
  const streets: CityFileStreet[] = G.streets.map((st) => {
    const A = G.nodes[st.n0], B = G.nodes[st.n1], out: CityFileStreet = { id: st.id, a: st.n0, b: st.n1 };
    if (st.name) out.name = st.name;
    if (st.k !== 0) {
      const M = G.streetPt(st.id, st.len / 2, 0), hc = Math.atan2(-(B.z - A.z), B.x - A.x);
      const bend = cm((M.x - (A.x + B.x) / 2) * -Math.sin(hc) + (M.z - (A.z + B.z) / 2) * -Math.cos(hc));
      if (bend !== 0) out.bend = bend;
    }
    if (st.half !== STREET_HALF) out.half = cm(st.half);
    if (st.kerb !== STREET_KERB) out.kerb = cm(st.kerb);
    if (!st.inCity) out.outside = true;
    if (st.oneway) out.oneway = true;
    if (st.ring) out.ring = true;
    const tags = (["elevated", "cable", "freeway"] as StreetTag[]).filter((t) => st.tags[t]);
    if (tags.length) out.tags = tags;
    const f = furniture.get(st.id);
    if (f?.length) out.furniture = f.sort((p, q) => p[2] - q[2] || (p[1] < q[1] ? -1 : 1));
    return out;
  });
  const gates: (CityFileGate | null)[] = G.gates.map((g, i) => g ? { id: `g${i}`, street: g.street, out: g.out ? "b" : "a", dir: g.dir, x: cm(g.x), z: cm(g.z) } : null);
  const blocks: CityFileBlock[] = G.blocks.map((B) => {
    const p = insidePoint(B.poly, B.cx, B.cz), q: [number, number] = [cm(p[0]), cm(p[1])];
    const out: CityFileBlock = { at: inPoly(B.poly, q[0], q[1]) ? q : p, k: [B.kx, B.kz], district: plan.district(B.kx, B.kz) };
    if (B.inCity && !B.water) out.facility = facilityAt(plan, B.kx, B.kz);
    if (B.water) out.water = true;
    if (B.park) out.park = true;
    if (!B.inCity) out.outside = true;
    const lots = plan.fileLots(B.id);
    if (lots) out.lots = lots;
    // (Its facility's doors, as the scene would find them on its buildings: kerbDoors, which reads
    // a file's own when it has them.)
    if (out.facility) {
      const ds = kerbDoors(plan, B.kx, B.kz).filter((d): d is KerbDoor => !!d), c2 = (v: number) => Math.round(v * 100) / 100;
      if (ds.length || siteLayout(plan, B.kx, B.kz).kind === "kerb") out.doors = ds.map((d) => ({ side: d.side, a: c2(d.a), n: c2(d.n), frame: d.frame, panel: d.panel, half: c2(d.half), h: c2(d.h),
        ...(d.plain ? { plain: true as const } : {}), ...(d.wide ? { wide: true as const } : {}), ...(d.y !== undefined ? { y: c2(d.y) } : {}) }));
    }
    return out;
  });
  // (Its sea as the outline holds it; its freeway's gate slot, whether the truck comes in on it and
  // by which exit, and its curve through an organic town, to the millimetre.)
  const cut = plan.outlineCut, fw = plan.freeway, c = plan.fwCurve, r3 = (v: number) => Math.round(v * 1000) / 1000;
  const freeway: CityFileFreeway | undefined = fw ? { gate: { ix: fw.ix, iz: fw.iz, dir: fw.dir }, merge: plan.freewayMerge,
    ...(plan.interchange ? { exit: plan.interchange.kind } : {}),
    ...(c ? { curve: { ...c, pts: c.pts.map(([x, z]) => [r3(x), r3(z)] as [number, number]), cum: c.cum.map(r3), len: r3(c.len), ex: r3(c.ex), ez: r3(c.ez), dx: r3(c.dx), dz: r3(c.dz) } } : {}) } : undefined;
  return { format: 1, id, name, style: plan.style.id, key: plan.seed, layout: plan.layout,
    outline: { scale: cut.scale, ...(cut.seaOff ? { seaOff: true as const } : {}) }, sea: O.data, ...(freeway ? { freeway } : {}), nodes, streets, gates, blocks };
}
// A city's contents as its contents file lists them: each block's rows by its place in the city
// file's blocks, each street's by its id, the ring's (`contents`: cityContentsOf's, or else the
// plan's own, as read).
export function contentsRowsOf(plan: CityPlan, given: CityContents | null = null): CityFileContents | null {
  const contents = given ?? plan.contents, G = plan.graph;
  if (!contents) return null;
  return {
    blocks: Object.fromEntries(G.blocks.map((B, i) => [i, (contents.blocks.get(B.id) ?? []).map(rowOf)]).filter(([, l]) => (l as RecipeRow[]).length)),
    streets: Object.fromEntries([...contents.streets].filter(([, l]) => l.length).map(([k, l]) => [k, l.map(rowOf)])),
    outskirts: contents.outskirts.map(rowOf),
  };
}

// What is wrong with a city, for normal play: an empty list when nothing is. Its streets must let
// the truck and traffic get from every node to every other, and every site's kerb must be one the
// truck can drive along.
export function cityProblems(plan: CityPlan): string[] {
  const G = plan.graph, out: string[] = [];
  const fwd = G.nodes.map(() => [] as number[]), back = G.nodes.map(() => [] as number[]);
  const drive = (a: number, b: number) => { fwd[a].push(b); back[b].push(a); };
  const used = new Set<number>();
  for (const st of G.streets) {
    if (!st.inCity && st.gate < 0) continue;
    used.add(st.n0); used.add(st.n1);
    drive(st.n0, st.n1);
    if (!st.oneway) drive(st.n1, st.n0);
  }
  const reach = (adj: number[][], from: number) => {
    const seen = new Set([from]), todo = [from];
    while (todo.length) for (const n of adj[todo.pop()!]) if (!seen.has(n)) { seen.add(n); todo.push(n); }
    return seen;
  };
  const entry = G.gates[0];
  if (!entry) return ["no way in"];
  const there = reach(fwd, entry.node), back0 = reach(back, entry.node);
  const stuck = [...used].filter((n) => !there.has(n) || !back0.has(n));
  if (stuck.length) out.push(`${stuck.length} nodes not reachable both ways from the way in (first at ${G.nodes[stuck[0]].x.toFixed(0)}, ${G.nodes[stuck[0]].z.toFixed(0)})`);
  G.gates.forEach((g, i) => { if (g && (!there.has(g.node) || !back0.has(g.node))) out.push(`gate ${i} cut off`); });
  for (const B of G.blocks) {
    if (!B.inCity || B.water) continue;
    const L = siteLayout(plan, B.kx, B.kz);
    if (L.kind === "kerb" || L.kind === "interchange") continue;
    const f = plan.face(B.kx, B.kz, L.side);
    if (f < 0 || !G.drivable(f)) out.push(`block ${B.kx},${B.kz}: its ${L.kind}'s kerb cannot be driven along`);
  }
  return out;
}

// Counts that tell a drafted city's character, for choosing among drafts.
export function cityTraits(plan: CityPlan) {
  const G = plan.graph;
  let docks = 0, lots = 0;
  for (const B of G.blocks) {
    if (!B.inCity || B.water) continue;
    const k = siteLayout(plan, B.kx, B.kz).kind;
    if (k === "dock") docks++;
    else if (k === "lot") lots++;
  }
  return { layout: plan.layout, freeway: !!plan.freeway, merge: plan.freewayMerge, river: plan.hasRiver, sea: plan.outline.sea !== null,
    oneWays: G.streets.some((st) => st.oneway && !st.ring), rounds: G.streets.some((st) => st.ring), docks, lots, blocks: G.blocks.length };
}

// A city's contents file's text (src/city-<style>/<city>/<city>-contents.ts): one recipe's
// row a line, each block's under its place in the city file's blocks and each street's under its id.
export function contentsFileText(F: CityFile, C: CityFileContents): string {
  const item = (v: unknown): string => Array.isArray(v) ? `[${v.map(item).join(", ")}]`
    : v && typeof v === "object" ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${item(x)}`).join(", ")} }` : JSON.stringify(v);
  const group = (name: string, R: Record<number, RecipeRow[]>) => [`  ${name}: {`, ...Object.entries(R).flatMap(([k, l]) => [`    ${k}: [`, ...l.map((r) => `      ${item(r)},`), `    ],`]), `  },`];
  return [
    `// ${F.name}'s contents (docs/long-day-cities.md, "City contents"): everything that stands on its`,
    `// layout, each a recipe's row (src/contents.ts FIELDS). Drafted by tools/cityfiles.ts; edited by hand`,
    `// from here on. The scene carries them packed (tools/pack.ts).`,
    `import type { CityFileContents } from "../../cityfile.ts";`, ``,
    `export const CONTENTS_${F.style.toUpperCase()}_${slugOf(F.name).toUpperCase().replace(/-/g, "_")}: CityFileContents = {`,
    ...group("blocks", C.blocks), ...group("streets", C.streets), `  outskirts: [`, ...C.outskirts.map((r) => `    ${item(r)},`), `  ],`, `};`, ``,
  ].join("\n");
}
// A city's folder, src/city-<style>/<slug>/, and its city file and contents file there.
export const cityDir = (F: CityFile) => `scenes/long-day/src/city-${F.style}/${F.id.slice(F.style.length + 1)}`;
export const cityPath = (F: CityFile) => `${cityDir(F)}/${F.id.slice(F.style.length + 1)}.ts`;
export const contentsPath = (F: CityFile) => `${cityDir(F)}/${F.id.slice(F.style.length + 1)}-contents.ts`;
// A city's slug and constant: higgle-on-the-wobble and CITY_<STYLE>_<SLUG>.
export const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const constOf = (style: StyleId, name: string) => `CITY_${style.toUpperCase()}_${slugOf(name).toUpperCase().replace(/-/g, "_")}`;

// A city file's text (its header comment lines given): one node, street, gate and block a line.
export function cityFileText(F: CityFile, header: string[]): string {
  const item = (v: unknown): string => Array.isArray(v) ? `[${v.map(item).join(", ")}]`
    : v && typeof v === "object" ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${item(x)}`).join(", ")} }` : JSON.stringify(v);
  const list = (k: string, a: unknown[]) => `  ${k}: [\n${a.map((v) => `    ${item(v)},`).join("\n")}\n  ],`;
  return [
    ...header,
    `import type { CityFile } from "../../cityfile.ts";`,
    ``,
    `export const ${constOf(F.style, F.name)}: CityFile = {`,
    `  format: 1, id: ${item(F.id)}, name: ${item(F.name)}, style: ${item(F.style)}, key: ${F.key},`,
    `  layout: ${item(F.layout)}, outline: ${item(F.outline)},`,
    `  sea: ${F.sea ? item(F.sea) : "null"},`,
    ...(F.freeway ? [`  freeway: ${item(F.freeway)},`] : []),
    list("nodes", F.nodes), list("streets", F.streets), list("gates", F.gates), list("blocks", F.blocks),
    `};`, ``,
  ].join("\n");
}
