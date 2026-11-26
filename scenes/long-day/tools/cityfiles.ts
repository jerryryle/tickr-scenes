// Writing and checking city files (src/cityfile.ts): the drafting tool (tools/draftcities.ts)
// writes a generated city's plan out with cityFileOfPlan, and it and test/catalogue.ts check a
// city with cityProblems.
import * as THREE from "three@0.187.0";
import { CityPlan, CITY_HI, CITY_LO, cityDistance, kerbDoors, makeCityChunkBuilder, streetFrontage } from "../src/city.ts";
import { CONTENTS, rowOf } from "../src/contents.ts";
import type { Recipe, RecipeRow } from "../src/contents.ts";
import type { KerbDoor } from "../src/city.ts";
import { FURNITURE, PAVEMENT, PK } from "../src/decor.ts";
import { angleDiff } from "../src/citygraph.ts";
import { BLOCK, RING } from "../src/grid.ts";
import { TILE } from "../src/citygraph.ts";
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
// `pavement`, given: filled with everything else standing on the pavements (lights, trees, posts),
// in world coordinates.
export function streetFurnitureOf(plan: CityPlan, pavement: { x: number; z: number; r: number; kind: number }[] | null = null): Map<number, [string, "l" | "r", number][]> {
  const G = plan.graph, mats = { ground: new THREE.MeshLambertMaterial(), solid: new THREE.MeshLambertMaterial(), lamp: new THREE.MeshBasicMaterial() };
  const build = makeCityChunkBuilder(mats, plan), rec: number[] = [], pseen = new Set<string>();
  // Every block's doors are worked out first. A chunk asks for its blocks' doors, and for a city
  // without them on file that runs probe builds of other tiles, which would record what stands on
  // their pavements in their own coordinates.
  if (pavement) for (const B of G.blocks) if (B.inCity) kerbDoors(plan, B.kx, B.kz);
  FURNITURE.out = rec;
  try {
    for (let cx = CITY_LO - RING; cx <= CITY_HI + RING; cx++) for (let cz = CITY_LO - RING; cz <= CITY_HI + RING; cz++) {
      if (cityDistance(cx, cz) > 0) continue;
      const prec: number[] = [];
      if (pavement) PAVEMENT.out = prec;
      try { const gen = build(cx, cz); let r = gen.next(); while (!r.done) r = gen.next(); } finally { PAVEMENT.out = null; }
      for (let i = 0; i + 3 < prec.length; i += 4) {
        const kind = prec[i + 3];
        if (kind >= PK.hydrant && kind <= PK.rack) continue;   // (the furniture itself)
        const o = { x: prec[i] + cx * BLOCK, z: prec[i + 1] + cz * BLOCK, r: prec[i + 2], kind }, k = `${o.x.toFixed(2)},${o.z.toFixed(2)},${kind}`;
        if (!pseen.has(k)) { pseen.add(k); pavement!.push(o); }
      }
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

// Node N's moves a tractor never takes (citygraph.ts noTractor), as its city file lists them: each
// [street in, street out], in order.
function tractorBansAt(G: CityPlan["graph"], N: CityPlan["graph"]["nodes"][number]): [number, number][] {
  const out: [number, number][] = [];
  for (const a of N.arms) for (const b of N.arms) {
    if (a === b) continue;
    const din = a.street * 2 + (a.end ^ 1), dout = b.street * 2 + b.end;
    if (!G.tractorMove(din, dout)) out.push([a.street, b.street]);
  }
  return out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
}

// A street's furniture slid out from in front of the city's front doors (city.ts kerbDoors): each
// piece within a door's width (and DOOR_GAP either side) moves along its sidewalk to the nearest
// spot clear of the door, the other pieces, what else stands there (`pavement`: lights, trees,
// posts) and a stand's own stretch, and no nearer its corners than the placing allows
// (decor.ts streetFurniture); one with no such spot within DOOR_SLIDE is dropped. A piece clear of
// every door stays where it is, so a city's file reads back as written. (The placing picks its
// spots before the buildings, and so their doors, are known: a bench or a hydrant stood squarely
// in front of 27 to 49% of each city's doors.)
const DOOR_GAP = 0.5, DOOR_SLIDE = 15;
const PIECE_HALF: Record<string, number> = { hydrant: 0.3, trash: 0.3, bench: 0.95, mailbox: 0.3, news: 0.75, meter: 0.15, shelter: 1.9, rack: 0.9 };
function clearDoors(plan: CityPlan, furniture: Map<number, [string, "l" | "r", number][]>, pavement: { x: number; z: number; r: number; kind: number }[]) {
  const G = plan.graph;
  // Each street side's doors and its other obstacles, as spans along the street from its first node.
  const doors = new Map<string, [number, number][]>(), busy = new Map<string, [number, number][]>();
  const push = (m: Map<string, [number, number][]>, k: string, s: [number, number]) => (m.get(k) ?? m.set(k, []).get(k)!).push(s);
  for (const B of G.blocks) {
    if (!B.inCity || B.water) continue;
    const ds = kerbDoors(plan, B.kx, B.kz);
    B.sides.forEach((f, side) => {
      const d = ds[side], st = G.streets[f >> 1], at = (a: number) => (f & 1 ? st.len - a : a), key = `${st.id}${f & 1 ? "l" : "r"}`;
      if (d && d.y === undefined) push(doors, key, [at(d.a) - d.half - DOOR_GAP, at(d.a) + d.half + DOOR_GAP]);
      const clear = streetFrontage(plan, B.kx, B.kz, side).clear;
      if (clear) push(busy, key, [Math.min(at(clear[0]), at(clear[1])), Math.max(at(clear[0]), at(clear[1]))]);
    });
  }
  for (const o of pavement) for (const id of G.tile(Math.floor(o.x / TILE), Math.floor(o.z / TILE)).streets) {
    const st = G.streets[id], [s, n] = G.toStreet(id, o.x, o.z);
    if (s < 0 || s > st.len || Math.abs(n) < st.half - st.kerb - 0.3 || Math.abs(n) > st.half) continue;
    push(busy, `${id}${n > 0 ? "r" : "l"}`, [s - o.r - 0.4, s + o.r + 0.4]);
  }
  const hit = (spans: [number, number][] | undefined, lo: number, hi: number) => !!spans?.some(([a, b]) => hi > a && lo < b);
  for (const [id, list] of furniture) {
    const st = G.streets[id], a0 = G.armOut(id * 2).mouth, a1 = st.len - G.armIn(id * 2).mouth;
    for (let i = 0; i < list.length; i++) {
      const [kind, side, at] = list[i], half = PIECE_HALF[kind] ?? 0.3, key = `${id}${side}`;
      if (!hit(doors.get(key), at - half, at + half)) continue;
      // (Clear of the corners as the placing keeps them: a bus shelter further, where children gather.)
      const end = kind === "shelter" ? 6 : 2.5, others = list.filter((_, j) => j !== i && list[j][1] === side).map(([k, , p]): [number, number] => [p - (PIECE_HALF[k] ?? 0.3) - 0.4, p + (PIECE_HALF[k] ?? 0.3) + 0.4]);
      const fits = (p: number) => p - half > a0 + end && p + half < a1 - end && !hit(doors.get(key), p - half, p + half) && !hit(busy.get(key), p - half, p + half) && !hit(others, p - half, p + half);
      let to = NaN;
      for (let k = 1; k * 0.25 <= DOOR_SLIDE && Number.isNaN(to); k++) {
        // (Towards the middle of the street first: away from the junctions' corners.)
        const dir = at < (a0 + a1) / 2 ? 1 : -1;
        for (const p of [cm(at + dir * k * 0.25), cm(at - dir * k * 0.25)]) if (fits(p)) { to = p; break; }   // (Each spot is rounded as the file holds it, then tested.)
      }
      if (Number.isNaN(to)) { list.splice(i, 1); i--; } else list[i] = [kind, side, to];
    }
  }
  return furniture;
}

// A facility block's doors as its city file lists them (kerbDoors: the file's own when it has
// them, else worked out from its buildings), or undefined for a block that lists none.
export function fileDoorsOf(plan: CityPlan, bx: number, bz: number): CityFileBlock["doors"] {
  const ds = kerbDoors(plan, bx, bz).filter((d): d is KerbDoor => !!d);
  if (!ds.length && siteLayout(plan, bx, bz).kind !== "kerb") return undefined;
  return ds.map((d) => ({ side: d.side, a: cm(d.a), n: cm(d.n), frame: d.frame, panel: d.panel, half: cm(d.half), h: cm(d.h),
    ...(d.plain ? { plain: true as const } : {}), ...(d.wide ? { wide: true as const } : {}), ...(d.y !== undefined ? { y: cm(d.y) } : {}) }));
}

export function cityFileOfPlan(plan: CityPlan, id: string, name: string): CityFile {
  const G = plan.graph, O = plan.outline;
  const nodes: CityFileNode[] = G.nodes.map((N) => {
    const out: CityFileNode = { id: N.id, x: cm(N.x), z: cm(N.z), k: [N.kx, N.kz], ...(N.control !== "signal" ? { control: N.control } : {}) };
    const poles = signalPoles(G, N), stops = [...stopSignPosts(G, N)].sort((a, b) => a[0] - b[0]);
    if (poles.length) out.poles = poles.map((p) => [p.i, cm(p.px), cm(p.pz), Math.round(p.h * 1e4) / 1e4, cm(p.toCentre)]);
    if (stops.length) out.stops = stops.map(([arm, [x, z]]) => [arm, cm(x), cm(z)]);
    const bans = tractorBansAt(G, N);
    if (bans.length) out.noTractor = bans;
    return out;
  });
  const pavement: { x: number; z: number; r: number; kind: number }[] = [];
  const furniture = clearDoors(plan, streetFurnitureOf(plan, pavement), pavement);
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
    if (out.facility) { const ds = fileDoorsOf(plan, B.kx, B.kz); if (ds) out.doors = ds; }
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
  const item = fileItem;
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
// A value as a city file writes it: an object's keys bare, ", " between items.
export const fileItem = (v: unknown): string => Array.isArray(v) ? `[${v.map(fileItem).join(", ")}]`
  : v && typeof v === "object" ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${fileItem(x)}`).join(", ")} }` : JSON.stringify(v);
export function cityFileText(F: CityFile, header: string[]): string {
  const item = fileItem;
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
