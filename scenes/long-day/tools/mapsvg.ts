// A catalogue city's map (docs/fixed-cities.md, requirements 19 and 20): a layered SVG drawn top
// down from its plan, 1 unit a metre in world coordinates (x east, z south, so north is up). Each
// layer is a top-level group that Inkscape and Illustrator open as a layer, and every item carries
// an id naming what it is in the plan. The map is a view: nothing reads it back.
//
// The streets, blocks, gates and junctions come from the plan. The lots, buildings and trees are
// where the city's own builders put them: every chunk is built as the scene builds it, and what it
// recorded in geom.ts PLACED is read back.
import * as THREE from "three@0.187.0";
import { CityPlan, makeCityChunkBuilder, cityDistance, CITY_LO, CITY_HI, siteSquare } from "../src/city.ts";
import type { CityFile } from "../src/cityfile.ts";
import { facilityAt, facilityName, siteLayout } from "../src/facilities.ts";
import { pavementObstacles } from "../src/city.ts";
import { PK } from "../src/decor.ts";
import { PLACED } from "../src/geom.ts";
import { BLOCK, RING } from "../src/grid.ts";
import { STYLES } from "../src/styles.ts";

// Coordinates to the centimetre for what the plan holds, to the decimetre for what is built on it.
const cmOf = (v: number) => String(Math.round(v * 100) / 100);
const dmOf = (v: number) => String(Math.round(v * 10) / 10);
const ptsOf = (p: [number, number][], f = cmOf) => p.map(([x, z]) => `${f(x)},${f(z)}`).join(" ");
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const DISTRICT_FILL: Record<string, string> = { downtown: "#c9b8d8", commercial: "#e8d4a8", residential: "#cfe3b8", industrial: "#c8c8c8", park: "#8fc77a" };

// The layers, bottom to top: an id, the name an editor shows, and what is drawn in it.
const LAYERS = [
  ["ground", "Ground and districts"], ["water", "Water and shore"], ["streets", "Streets and pavements"],
  ["names", "Street names"], ["controls", "Junction controls"], ["lots", "Lots"], ["buildings", "Buildings"],
  ["sites", "Sites"], ["trees", "Trees and parks"], ["lines", "Freeway and elevated lines"], ["gates", "Gates"],
  ["pins", "Pinned dressing"], ["markup", "Markup"],
] as const;
type LayerId = typeof LAYERS[number][0];

// The city's built lots, building footprints and trees, as the chunk builders placed them (world
// coordinates; a block's lot built in more than one chunk counted once).
function builtCity(plan: CityPlan) {
  const mats = { ground: new THREE.MeshLambertMaterial(), solid: new THREE.MeshLambertMaterial(), lamp: new THREE.MeshBasicMaterial() };
  const build = makeCityChunkBuilder(mats, plan), quads = (a: number[], ox: number, oz: number) => {
    const out: [number, number][][] = [];
    for (let i = 0; i + 7 < a.length; i += 8) out.push([0, 2, 4, 6].map((k) => [a[i + k] + ox, a[i + k + 1] + oz] as [number, number]));
    return out;
  };
  const lots = new Map<string, [number, number][]>(), feet = new Map<string, [number, number][]>(), trees = new Map<string, [number, number]>();
  const keyOf = (q: [number, number][]) => q.map(([x, z]) => `${dmOf(x)},${dmOf(z)}`).join(" ");
  for (let cx = CITY_LO - RING; cx <= CITY_HI + RING; cx++) for (let cz = CITY_LO - RING; cz <= CITY_HI + RING; cz++) {
    if (cityDistance(cx, cz) > 0) continue;
    const gen = build(cx, cz);
    let r = gen.next();
    while (!r.done) r = gen.next();
    const ox = cx * BLOCK, oz = cz * BLOCK;
    for (const q of quads(PLACED.lots, ox, oz)) lots.set(keyOf(q), q);
    for (const q of quads(PLACED.foot, ox, oz)) feet.set(keyOf(q), q);
    for (let i = 0; i + 1 < PLACED.trees.length; i += 2) { const p: [number, number] = [PLACED.trees[i] + ox, PLACED.trees[i + 1] + oz]; trees.set(`${dmOf(p[0])},${dmOf(p[1])}`, p); }
  }
  return { lots: [...lots.values()], feet: [...feet.values()], trees: [...trees.values()] };
}

export function citySvg(F: CityFile): string {
  const plan = new CityPlan(F.key, STYLES[F.style]), G = plan.graph;
  plan.climate = { season: "summer", weather: "clear", snowCover: false };
  const L = new Map<LayerId, string[]>(LAYERS.map(([id]) => [id, []]));
  const add = (layer: LayerId, line: string) => L.get(layer)!.push(line);
  const blockId = (x: number, z: number) => { const B = G.blockAt(x, z) ?? G.nearestBlock(x, z); return B ? `${B.kx}_${B.kz}` : "none"; };
  // (Items numbered within their block, in order along x then z, so an id stays put while the rest moves.)
  const numbered = <T>(items: T[], at: (t: T) => [number, number]) => {
    const tagged = items.map((t) => { const [x, z] = at(t); return { t, x, z, b: blockId(x, z) }; }).sort((p, q) => p.b < q.b ? -1 : p.b > q.b ? 1 : p.x - q.x || p.z - q.z);
    const n = new Map<string, number>();
    return tagged.map((e) => { const k = (n.get(e.b) ?? 0) + 1; n.set(e.b, k); return { ...e, id: `${e.b}-${k}` }; });
  };
  const mid = (q: [number, number][]): [number, number] => [q.reduce((a, p) => a + p[0], 0) / q.length, q.reduce((a, p) => a + p[1], 0) / q.length];

  // Ground and districts; water and shore.
  for (const B of G.blocks) {
    const id = `${B.kx}_${B.kz}`;
    if (B.water) { add("water", `<polygon id="water-${id}" points="${ptsOf(B.poly)}" fill="#6fa8dc"/>`); continue; }
    const d = B.park ? "park" : plan.district(B.kx, B.kz);
    add("ground", `<polygon id="block-${id}" points="${ptsOf(B.poly)}" fill="${B.inCity ? DISTRICT_FILL[d] : "#e4e0d4"}"><title>block ${id}: ${d}</title></polygon>`);
  }
  if (G.outer) add("water", `<polygon id="outline" points="${ptsOf(G.outer)}" fill="none" stroke="#555" stroke-width="1"/>`);
  plan.shore.forEach((e, i) => add("water", `<line id="shore-${i}" x1="${cmOf(e.ax)}" y1="${cmOf(e.az)}" x2="${cmOf(e.bx)}" y2="${cmOf(e.bz)}" stroke="#2f78b8" stroke-width="4"/>`));

  // Streets and pavements, their names, and the freeway and elevated lines over them.
  const band = (id: number, lo: number, hi: number) => {
    const st = G.streets[id], n = Math.max(1, st.k === 0 ? 1 : Math.ceil(st.len / 4)), a: [number, number][] = [], b: [number, number][] = [];
    for (let i = 0; i <= n; i++) { const s = (st.len * i) / n, p = G.streetPt(id, s, lo), q = G.streetPt(id, s, hi); a.push([p.x, p.z]); b.push([q.x, q.z]); }
    return [...a, ...b.reverse()];
  };
  for (const st of G.streets) {
    const road = st.half - st.kerb, out = st.inCity || st.gate >= 0;
    add("streets", `<polygon id="pavement-${st.id}" points="${ptsOf(band(st.id, -st.half, st.half))}" fill="#b0ada2"/>`);
    add("streets", `<polygon id="street-${st.id}" points="${ptsOf(band(st.id, -road, road))}" fill="${out ? "#3a3b3f" : "#77766f"}"><title>street ${st.id}${st.name ? `: ${esc(st.name)}` : ""}${st.oneway ? " (one way)" : ""}</title></polygon>`);
    const tag = st.tags.freeway ? "freeway" : st.tags.elevated ? "elevated" : st.tags.cable ? "cable" : null;
    if (tag) { const A = G.streetPt(st.id, 0, 0), Z = G.streetPt(st.id, st.len, 0); add("lines", `<line id="${tag}-${st.id}" x1="${cmOf(A.x)}" y1="${cmOf(A.z)}" x2="${cmOf(Z.x)}" y2="${cmOf(Z.z)}" stroke="${tag === "freeway" ? "#d98c1e" : tag === "elevated" ? "#7a4fb0" : "#b03a3a"}" stroke-width="5" stroke-opacity="0.8"/>`); }
    if (st.name && st.len >= 30) {
      const M = G.streetPt(st.id, st.len / 2, 0);
      let deg = -M.h * 180 / Math.PI;
      if (deg > 90) deg -= 180; else if (deg < -90) deg += 180;
      add("names", `<text id="name-${st.id}" x="${cmOf(M.x)}" y="${cmOf(M.z)}" transform="rotate(${dmOf(deg)} ${cmOf(M.x)} ${cmOf(M.z)})" font-size="5" text-anchor="middle" dominant-baseline="middle" fill="#fff">${esc(st.name)}</text>`);
    }
  }
  if (plan.interchange) { const ic = plan.interchange; add("lines", `<text id="interchange" x="${cmOf(ic.ix * BLOCK + 9)}" y="${cmOf(ic.iz * BLOCK + 9)}" font-size="8" fill="#d98c1e">interchange (${ic.kind})</text>`); }

  // Junction controls.
  for (const N of G.nodes) {
    if (N.arms.length < 3) continue;
    if (N.control === "signal") add("controls", `<circle id="node-${N.id}" cx="${cmOf(N.x)}" cy="${cmOf(N.z)}" r="3" fill="#2e9e3e"><title>node ${N.id}: signals</title></circle>`);
    else if (N.control === "stop") add("controls", `<rect id="node-${N.id}" x="${cmOf(N.x - 2.5)}" y="${cmOf(N.z - 2.5)}" width="5" height="5" fill="#c0392b"><title>node ${N.id}: all-way stop</title></rect>`);
    else add("controls", `<circle id="node-${N.id}" cx="${cmOf(N.x)}" cy="${cmOf(N.z)}" r="2" fill="none" stroke="#fff" stroke-width="1"><title>node ${N.id}: no control</title></circle>`);
  }

  // Sites, and each block's facility.
  for (const B of G.blocks) {
    if (!B.inCity || B.water) continue;
    const id = `${B.kx}_${B.kz}`, S = siteLayout(plan, B.kx, B.kz), fac = facilityAt(plan, B.kx, B.kz);
    if (S.kind !== "kerb") {
      const sq = B.square ? B.poly : B.anchor ? siteSquare(G, B.anchor) : B.poly;
      add("sites", `<polygon id="site-${id}" points="${ptsOf(sq)}" fill="none" stroke="#1f5fbf" stroke-width="1.2" stroke-dasharray="3 2"><title>${S.kind} site</title></polygon>`);
    }
    add("sites", `<text id="facility-${id}" x="${cmOf(B.cx)}" y="${cmOf(B.cz)}" font-size="4" text-anchor="middle" fill="#123">${esc(facilityName(plan, fac, B.kx, B.kz))}${S.kind !== "kerb" ? ` (${S.kind})` : ""}</text>`);
  }

  // Lots, buildings and trees, as built; parks.
  const built = builtCity(plan);
  for (const e of numbered(built.lots, mid)) add("lots", `<polygon id="lot-${e.id}" points="${ptsOf(e.t, dmOf)}" fill="none" stroke="#8a7a5a" stroke-width="0.4"/>`);
  for (const e of numbered(built.feet, mid)) add("buildings", `<polygon id="building-${e.id}" points="${ptsOf(e.t, dmOf)}" fill="#a0522d" fill-opacity="0.85"/>`);
  for (const B of G.blocks) if (B.park) add("trees", `<polygon id="park-${B.kx}_${B.kz}" points="${ptsOf(B.poly)}" fill="none" stroke="#2e7d32" stroke-width="1"/>`);
  const street = G.blocks.filter((B) => B.inCity).flatMap((B) => pavementObstacles(plan, B.kx, B.kz).filter((o) => o.kind === PK.tree).map((o) => [o.x, o.z] as [number, number]));
  const allTrees = new Map<string, [number, number]>();
  for (const p of [...built.trees, ...street]) allTrees.set(`${dmOf(p[0])},${dmOf(p[1])}`, p);
  for (const e of numbered([...allTrees.values()], (p) => p)) add("trees", `<circle id="tree-${e.id}" cx="${dmOf(e.t[0])}" cy="${dmOf(e.t[1])}" r="1.5" fill="#2e7d32"/>`);

  // Gates.
  F.gates.forEach((g, i) => {
    if (!g) return;
    add("gates", `<circle id="gate-${g.id}" cx="${cmOf(g.x)}" cy="${cmOf(g.z)}" r="6" fill="#f2c200" stroke="#000" stroke-width="0.8"><title>gate ${g.id}${i === 0 ? " (the way in)" : ""}</title></circle>`);
    add("gates", `<text id="gate-label-${g.id}" x="${cmOf(g.x)}" y="${cmOf(g.z - 9)}" font-size="8" text-anchor="middle" fill="#000">${g.id}</text>`);
  });

  const m = 40, { x0, z0, x1, z1 } = G.bounds, w = x1 - x0 + 2 * m, h = z1 - z0 + 2 * m;
  const out = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- ${esc(F.name)} (${F.id}), drawn from src/city-${F.style}/${F.style}-city-${F.id.slice(F.style.length + 1)}.ts by tools/maps.ts (make maps). Build output, regenerated and never read back: mark up a copy. -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="${cmOf(x0 - m)} ${cmOf(z0 - m)} ${cmOf(w)} ${cmOf(h)}" width="${Math.round(w)}" height="${Math.round(h)}">`,
    `<title>${esc(F.name)}</title>`,
    `<rect id="backdrop" x="${cmOf(x0 - m)}" y="${cmOf(z0 - m)}" width="${cmOf(w)}" height="${cmOf(h)}" fill="#f4f1e8"/>`,
  ];
  for (const [id, label] of LAYERS) {
    out.push(`<g id="${id}" inkscape:groupmode="layer" inkscape:label="${label}">`);
    for (const line of L.get(id)!) out.push(line);
    out.push(`</g>`);
  }
  out.push(`</svg>`, ``);
  return out.join("\n");
}

// Where a city's map is written: build output, in a folder for its style as its file is.
export const mapPath = (F: CityFile) => `build/long-day-maps/city-${F.style}/${F.style}-city-${F.id.slice(F.style.length + 1)}.svg`;
