// Test: no two front faces of Long Day's geometry share a plane where they overlap. Faces that do
// z-fight: the depth buffer can't tell which is in front, so the board shows a shimmer of both as
// the camera moves. Built here, with each triangle tagged with the functions that drew it
// (wrapping Batch's primitives): every chunk of every city (city.ts makeCityChunkBuilder: blocks,
// streets, the outskirts ring, freeways, elevated lines); the models not built into chunks, each
// on its own (cars, boats, the trucks closed and opened up, the driver and dock worker in each
// pose they take, the crew's gear, every cargo model and carried load, the animals, pedestrians,
// traffic, trains, and the ships and harbour at sea); and the country roads between the cities
// (countryworld.ts), a stretch at a time. Instanced meshes count each instance as placed; a
// two-sided material's faces count both ways. Every pair of triangles facing the same way is checked, neighbouring chunks included: if
// they lie within GAP of one plane and overlap by more than AREA, and differ in colour or material
// (two alike look the same whichever wins), that is a clash. Faces facing each other on one plane
// don't count: the materials draw front faces only, so one of the two is always culled; nor do
// faces turned down near the ground (the bottoms of things standing on it).
// A clash shut inside something solid (a box's face against the next box, the underside of a cap
// inside a building's walls) is listed as hidden and passes (see hidden()).
// Reported grouped by the pair of functions and colours, with the clash's area, how far apart the
// planes are, and a place (world x, y, z) to look.
// Args (all optional): seed (default 1), cities (default 6: one of each style), gap in metres
// (default 0.001: flush; larger lists near-coplanar faces too, for review, without failing),
// a city's index to sweep just that one (-1 or "": all; given, the models and roads are left
// out), a piece of a clash's description ("buildPark", "#f2c200") to print the triangles of the
// first few such clashes ("each": the first in sight of each pair of functions; with a
// description, also what each ray met), and how many country roads (default 3).
// COPLANAR_SEASON in the environment ("winter/snow") builds the cities and roads in that season;
// built with --define DEBUG_LAYOUT=..., DEBUG_ONEWAY, DEBUG_EXIT or DEBUG_SEA, in that layout.
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { CityPlan, makeCityChunkBuilder, cityDistance, CITY_LO, CITY_HI } from "../src/city.ts";
import { citySeedOf } from "../src/country.ts";
import { journeyStyle } from "../src/styles.ts";
import { Batch } from "../src/geom.ts";
import { CAR_KINDS, carModel } from "../src/cars.ts";
import { boatAt } from "../src/boats.ts";
import type { BoatKind } from "../src/boats.ts";
import { BLOCK, RING } from "../src/grid.ts";
import { Truck, TruckKit } from "../src/truck.ts";
import type { TruckModel } from "../src/truck.ts";
import { Character, DRIVER_LOOK, WORKER_LOOK, gesturePose, idlePose, restPose, seatedPose, stoopFor, walkPose } from "../src/character.ts";
import { Crew } from "../src/crew.ts";
import { CARGO_MODELS } from "../src/cargomodels.ts";
import { CARGO } from "../src/cargo.ts";
import { buildCarried } from "../src/loads.ts";
import type { Season } from "../src/climate.ts";
import { Cow, Horse, Tractor } from "../src/farm.ts";
import { Figures } from "../src/figure.ts";
import { Traffic } from "../src/traffic.ts";
import { Ambient } from "../src/ambient.ts";
import { SeaLife } from "../src/sealife.ts";
import { CountryWorld } from "../src/countryworld.ts";

const proc = (globalThis as any).process, argv: string[] = proc.argv.slice(2);
const SEED = argv[0] ? Number(argv[0]) : 1, CITIES = argv[1] ? Number(argv[1]) : 6;
const GAP = argv[2] ? Number(argv[2]) : 0.001, FAIL_GAP = 0.001;
// (Environment: COPLANAR_SEASON, e.g. "winter/snow", builds the cities and roads in that season
// and weather instead of autumn's.)
const SEASON = ((proc.env.COPLANAR_SEASON as string | undefined) ?? "autumn/clear").split("/") as [Season, string];
const ONLY = argv[3] ? Number(argv[3]) : -1;   // just this city (0-based), to look closer
const DETAIL = argv[4] ?? "";                  // print the triangles of the first few clashes whose key has this in it
let detailed = 0, DEBUG_RAYS = false;
const shown = new Set<string>();               // (DETAIL "each": one of each pair of functions)
const AREA = 0.01;           // m²: smaller overlaps (a sliver where two edges meet; 10 cm square is about a pixel
                             // across at 10 m on the board) are let be
const COS = Math.cos(0.5 * Math.PI / 180);   // facing the same way: within half a degree
const CELL = 8;              // m: the spatial hash's cell
const DOWN_LOW = 1.2;        // m: faces turned down below this go unseen (see trianglesOf)

// ---- provenance: which functions drew each vertex ------------------------------------------------
// Each outermost call of a Batch primitive records the vertex count it began at and the first two
// callers outside geom.ts; build() hands the records to the mesh.
const PRIMS = ["box", "boxR", "span", "cyl", "cone", "ico", "prism", "wall", "tri", "stamp"];
let depth = 0;
const P = Batch.prototype as any;
const sites = new WeakMap<object, [number, string][]>();
function caller(): string {
  const lines = (new Error().stack ?? "").split("\n").slice(1);
  const out: string[] = [];
  for (const l of lines) {
    const m = /at (?:new )?([\w$.<>]+) /.exec(l);
    const name = m ? m[1] : "?";
    if (/^(Batch\.|Object\.|wrapped|caller|Generator\.|Array\.)/.test(name) || name === "?") continue;
    out.push(name.replace(/^.*\./, "")); if (out.length === 2) break;
  }
  return out.join(" < ") || "?";
}
for (const k of PRIMS) {
  const f = P[k]; if (typeof f !== "function") continue;
  P[k] = function wrapped(this: any, ...a: unknown[]) {
    if (depth === 0) { let s = sites.get(this); if (!s) sites.set(this, s = []); s.push([this.vertexCount, caller()]); }
    depth++; try { return f.apply(this, a); } finally { depth--; }
  };
}
const build0 = P.build;
P.build = function (this: any, m: THREE.Material) {
  const s = sites.get(this) ?? []; sites.delete(this);
  const mesh = build0.call(this, m); if (mesh) mesh.userData.sites = s;
  return mesh;
};
P.take = ((t) => function (this: any) { sites.delete(this); return t.call(this); })(P.take);
const siteOf = (s: [number, string][] | undefined, v: number) => {
  if (!s || !s.length) return "?";
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (s[m][0] <= v) lo = m; else hi = m - 1; }
  return s[lo][1];
};

// ---- triangles ----------------------------------------------------------------------------------
interface Tri { p: number[]; n: [number, number, number]; d: number; col: number; mat: number; site: string; lo: number[]; hi: number[] }
const matIds = new Map<string, number>();
const tmpC = new THREE.Color();   // (vertex colours are linear: reported as the sRGB hex they were given as)
const hex = (r: number, g: number, b: number) => tmpC.setRGB(r, g, b, THREE.LinearSRGBColorSpace).getHex();
function trianglesOf(root: THREE.Object3D, out: Tri[]) {
  root.updateMatrixWorld(true);
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (mats.some((m) => (m.transparent && !m.depthWrite) || !m.depthTest || !m.depthWrite)) return;   // (blended without depth: no z-fight)
    const both = mats.some((m) => m.side === THREE.DoubleSide);   // (seen from either side: each face both ways)
    // (Materials told apart by how they shade: the shared vertex-coloured Lambert ones look alike.)
    const mk = `${mats[0].type}:${(mats[0] as any).map ? (mats[0] as any).map.uuid : ""}`;
    const mat = matIds.get(mk) ?? (matIds.set(mk, matIds.size), matIds.size - 1);
    const g = mesh.geometry, pos = g.attributes.position, col = g.attributes.color, idx = g.index;
    const mc = (mats[0] as any).color as THREE.Color | undefined;
    const count = idx ? idx.count : pos.count, S = mesh.userData.sites as [number, string][] | undefined;
    // (Instanced: each instance placed and tinted as drawn; none placed yet, the model once.)
    const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? mesh as THREE.InstancedMesh : null;
    const n = inst && inst.count > 0 ? inst.count : 1, im = new THREE.Matrix4(), M = new THREE.Matrix4(), ic = new THREE.Color();
    for (let k = 0; k < n; k++) {
      M.copy(mesh.matrixWorld);
      if (inst && inst.count > 0) { inst.getMatrixAt(k, im); M.multiply(im); }
      const tint = inst && inst.count > 0 && inst.instanceColor ? (inst.getColorAt(k, ic), ic) : null;
      for (let i = 0; i + 2 < count; i += 3) {
        const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, iC = idx ? idx.getX(i + 2) : i + 2;
        v[0].fromBufferAttribute(pos, ia).applyMatrix4(M);
        v[1].fromBufferAttribute(pos, ib).applyMatrix4(M);
        v[2].fromBufferAttribute(pos, iC).applyMatrix4(M);
        e1.subVectors(v[1], v[0]); e2.subVectors(v[2], v[0]); nn.crossVectors(e1, e2);
        const L = nn.length(); if (L < 1e-6) continue;   // (degenerate)
        nn.divideScalar(L);
        let c = col ? hex(col.getX(ia), col.getY(ia), col.getZ(ia)) : mc ? mc.getHex() : 0;
        if (tint) c = hex((col ? col.getX(ia) : 1) * tint.r, (col ? col.getY(ia) : 1) * tint.g, (col ? col.getZ(ia) : 1) * tint.b);
        for (const sg of both ? [1, -1] : [1]) {
          const q = sg > 0 ? [v[0], v[1], v[2]] : [v[0], v[2], v[1]], nx = nn.x * sg, ny = nn.y * sg, nz = nn.z * sg;
          // (A face turned down near the ground is only seen from below it, where no camera goes:
          // the director keeps the camera 1.3 m up or more.)
          if (ny < -0.5 && Math.max(v[0].y, v[1].y, v[2].y) < DOWN_LOW) continue;
          const p = [q[0].x, q[0].y, q[0].z, q[1].x, q[1].y, q[1].z, q[2].x, q[2].y, q[2].z];
          out.push({ p, n: [nx, ny, nz], d: nx * v[0].x + ny * v[0].y + nz * v[0].z, col: c, mat, site: mesh.userData.sites ? siteOf(S, ia) : mesh.name || "(unbatched)",
            lo: [Math.min(p[0], p[3], p[6]), Math.min(p[1], p[4], p[7]), Math.min(p[2], p[5], p[8])],
            hi: [Math.max(p[0], p[3], p[6]), Math.max(p[1], p[4], p[7]), Math.max(p[2], p[5], p[8])] });
        }
      }
    }
  });
}

// Area of triangle a and triangle b's overlap, both projected along a's normal (convex clipping).
function overlap(a: Tri, b: Tri): { area: number; at: number[] } {
  const n = a.n, ax = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = [n[1] * ax[2] - n[2] * ax[1], n[2] * ax[0] - n[0] * ax[2], n[0] * ax[1] - n[1] * ax[0]];
  const ul = Math.hypot(u[0], u[1], u[2]); u[0] /= ul; u[1] /= ul; u[2] /= ul;
  const w = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
  const proj = (t: Tri) => [0, 3, 6].map((k) => [t.p[k] * u[0] + t.p[k + 1] * u[1] + t.p[k + 2] * u[2], t.p[k] * w[0] + t.p[k + 1] * w[1] + t.p[k + 2] * w[2]] as [number, number]);
  const ccw = (q: [number, number][]) => { const A = (q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[2][0] - q[0][0]) * (q[1][1] - q[0][1]); return A < 0 ? q.reverse() : q; };
  let poly = ccw(proj(a)); const clip = ccw(proj(b));
  for (let i = 0; i < 3 && poly.length; i++) {
    const [p0, p1] = [clip[i], clip[(i + 1) % 3]];
    const side = (q: [number, number]) => (p1[0] - p0[0]) * (q[1] - p0[1]) - (p1[1] - p0[1]) * (q[0] - p0[0]);
    const next: [number, number][] = [];
    for (let j = 0; j < poly.length; j++) {
      const c = poly[j], d = poly[(j + 1) % poly.length], sc = side(c), sd = side(d);
      if (sc >= 0) next.push(c);
      if ((sc >= 0) !== (sd >= 0)) { const t = sc / (sc - sd); next.push([c[0] + (d[0] - c[0]) * t, c[1] + (d[1] - c[1]) * t]); }
    }
    poly = next;
  }
  let A = 0, cu = 0, cw = 0;
  for (let i = 0; i < poly.length; i++) { const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length]; A += x0 * y1 - x1 * y0; cu += x0 / poly.length; cw += y0 / poly.length; }
  const at = [0, 1, 2].map((k) => u[k] * cu + w[k] * cw + n[k] * a.d);
  return { area: Math.abs(A) / 2, at };
}

// Whether a clash at `at` (on a face turned to `n`) is out of sight: inside something solid. From
// just in front of the face, rays out along the face's normal, up, level and up at a slant: along
// each, the faces it passes out through the back of less those it passes in through the front
// count the solids the spot is inside (overlapping ones too). If most rays find it inside one,
// it is shut in.
const RAY = 120, R2 = Math.SQRT1_2, R3 = 1 / Math.sqrt(3);
const RAYS = [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [R2, 0, R2], [R2, 0, -R2], [-R2, 0, R2], [-R2, 0, -R2],
  [R3, R3, R3], [R3, R3, -R3], [-R3, R3, R3], [-R3, R3, -R3]];
function insideCount(tris: Tri[], grid: Map<string, number[]>, o: number[], d: number[]): number {
  const tested = new Set<number>(), hits = new Map<string, number>();
  for (let s = 0; s <= RAY; s += CELL / 2) {
    const k = `${Math.floor((o[0] + d[0] * s) / CELL)},${Math.floor((o[1] + d[1] * s) / CELL)},${Math.floor((o[2] + d[2] * s) / CELL)}`;
    for (const i of grid.get(k) ?? []) {
      if (tested.has(i)) continue; tested.add(i);
      const p = tris[i].p;
      const e1 = [p[3] - p[0], p[4] - p[1], p[5] - p[2]], e2 = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
      const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]; if (Math.abs(det) < 1e-12) continue;
      const f = 1 / det, sv = [o[0] - p[0], o[1] - p[1], o[2] - p[2]];
      const u = f * (sv[0] * h[0] + sv[1] * h[1] + sv[2] * h[2]); if (u < 0 || u > 1) continue;
      const q = [sv[1] * e1[2] - sv[2] * e1[1], sv[2] * e1[0] - sv[0] * e1[2], sv[0] * e1[1] - sv[1] * e1[0]];
      const v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]); if (v < 0 || u + v > 1) continue;
      const t = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
      if (t <= 1e-5 || t >= RAY) continue;
      const n = tris[i].n, out = n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 0 ? 1 : -1;
      // (A ray through an edge meets both triangles there: counted once.)
      hits.set(`${t.toFixed(4)}:${out}`, out);
    }
  }
  let c = 0; for (const v of hits.values()) c += v;
  return c;
}
// How far below `o` the nearest face turned up is (Infinity: none within RAY).
function groundBelow(tris: Tri[], grid: Map<string, number[]>, o: number[]): number {
  const d = [0, -1, 0], tested = new Set<number>();
  let best = Infinity;
  for (let s = 0; s <= 4; s += CELL / 2) {
    for (const i of grid.get(`${Math.floor(o[0] / CELL)},${Math.floor((o[1] - s) / CELL)},${Math.floor(o[2] / CELL)}`) ?? []) {
      if (tested.has(i)) continue; tested.add(i);
      const t = tris[i]; if (t.n[1] < 0.3) continue;
      const p = t.p, e1 = [p[3] - p[0], p[4] - p[1], p[5] - p[2]], e2 = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
      const h = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2]; if (Math.abs(det) < 1e-12) continue;
      const f = 1 / det, sv = [o[0] - p[0], o[1] - p[1], o[2] - p[2]];
      const u = f * (sv[0] * h[0] + sv[1] * h[1] + sv[2] * h[2]); if (u < 0 || u > 1) continue;
      const q = [sv[1] * e1[2] - sv[2] * e1[1], sv[2] * e1[0] - sv[0] * e1[2], sv[0] * e1[1] - sv[1] * e1[0]];
      const v = f * (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]); if (v < 0 || u + v > 1) continue;
      const tt = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
      if (tt > 1e-4 && tt < best) best = tt;
    }
  }
  return best;
}
function hidden(tris: Tri[], grid: Map<string, number[]>, at: number[], n: number[]): boolean {
  // (A face turned down with ground under it within DOWN_LOW is seen only from below that
  // ground's level, where no camera goes: the country's land is not at y = 0.)
  if (n[1] < -0.5 && groundBelow(tris, grid, [at[0], at[1] - 0.003, at[2]]) < DOWN_LOW) return true;
  const o = [at[0] + n[0] * 0.003, at[1] + n[1] * 0.003, at[2] + n[2] * 0.003];
  let shut = 0, rays = 0;
  for (const d of [n, ...RAYS]) {
    if (d !== n && d[0] * n[0] + d[1] * n[1] + d[2] * n[2] < -0.2) continue;   // (back through the face itself: never out of sight)
    if (d !== n && d[0] * n[0] + d[1] * n[1] + d[2] * n[2] > 0.99) continue;   // (n itself already)
    rays++; const k = insideCount(tris, grid, o, d); if (k > 0) shut++; if (DEBUG_RAYS) console.log(`      ray ${d.join(",")}: inside ${k}`);
  }
  return shut * 2 > rays;
}

// (Up to SAMPLE of a group's clashes are looked at for whether they can be seen: a group with
// no more than a quarter of them in sight is listed as hidden, and doesn't fail the test. Ray
// tests misjudge now and then: an odd one in sight is let be.)
const SAMPLE = 16;
interface Clash { key: string; area: number; n: number; gap: number; at: number[]; style: string; looked: number; seen: number }
function sweep(tris: Tri[], style: string, clashes: Map<string, Clash>) {
  const grid = new Map<string, number[]>();
  tris.forEach((t, i) => {
    for (let x = Math.floor(t.lo[0] / CELL); x <= Math.floor(t.hi[0] / CELL); x++)
      for (let y = Math.floor(t.lo[1] / CELL); y <= Math.floor(t.hi[1] / CELL); y++)
        for (let z = Math.floor(t.lo[2] / CELL); z <= Math.floor(t.hi[2] / CELL); z++) {
          const k = `${x},${y},${z}`; let c = grid.get(k); if (!c) grid.set(k, c = []); c.push(i);
        }
  });
  const seen = new Set<number>();
  for (const cell of grid.values()) {
    for (let i = 0; i < cell.length; i++) for (let j = i + 1; j < cell.length; j++) {
      const a = tris[cell[i]], b = tris[cell[j]];
      if (a.col === b.col && a.mat === b.mat) continue;
      if (a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2] < COS) continue;
      // (b's corners off a's plane: all within GAP)
      let gap = 0;
      for (let k = 0; k < 9; k += 3) gap = Math.max(gap, Math.abs(a.n[0] * b.p[k] + a.n[1] * b.p[k + 1] + a.n[2] * b.p[k + 2] - a.d));
      if (gap > GAP) continue;
      if (a.lo[0] > b.hi[0] + GAP || b.lo[0] > a.hi[0] + GAP || a.lo[1] > b.hi[1] + GAP || b.lo[1] > a.hi[1] + GAP || a.lo[2] > b.hi[2] + GAP || b.lo[2] > a.hi[2] + GAP) continue;
      const pk = Math.min(cell[i], cell[j]) * 4194304 + Math.max(cell[i], cell[j]);   // (a pair shares several cells)
      if (seen.has(pk)) continue; seen.add(pk);
      const ov = overlap(a, b), A = ov.area; if (A < AREA) continue;
      const [s, t] = a.site < b.site ? [a, b] : [b, a];
      const axis = Math.abs(a.n[1]) > 0.99 ? (a.n[1] > 0 ? "up" : "down") : "side";
      const key = `${style}  ${s.site} #${s.col.toString(16).padStart(6, "0")}  /  ${t.site} #${t.col.toString(16).padStart(6, "0")}  (${axis})`;
      const plain = `${s.site} / ${t.site} (${axis})`;
      if (DETAIL === "each" ? !shown.has(plain) && !hidden(tris, grid, ov.at, a.n) && !!shown.add(plain) : DETAIL && key.includes(DETAIL) && detailed++ < 8) {
        const f = (t: Tri) => `x ${t.lo[0].toFixed(2)}..${t.hi[0].toFixed(2)} y ${t.lo[1].toFixed(3)}..${t.hi[1].toFixed(3)} z ${t.lo[2].toFixed(2)}..${t.hi[2].toFixed(2)}`;
        if (DETAIL !== "each") { DEBUG_RAYS = true; hidden(tris, grid, ov.at, a.n); DEBUG_RAYS = false; }
        console.log(`  ${key}  at ${ov.at.map((v) => v.toFixed(2)).join(", ")}\n    ${s.site}: ${f(s)}\n    ${t.site}: ${f(t)}  (overlap ${A.toFixed(2)} m²)`);
      }
      let c = clashes.get(key);
      if (c) { c.area += A; c.n++; c.gap = Math.min(c.gap, gap); }
      else clashes.set(key, c = { key, area: A, n: 1, gap, at: ov.at, style, looked: 0, seen: 0 });
      if (c.looked < SAMPLE) { c.looked++; if (!hidden(tris, grid, ov.at, a.n)) { if (!c.seen) c.at = ov.at; c.seen++; } }
    }
  }
}

{
  const clashes = new Map<string, Clash>();
  void new Journey(readConfig({ seed: SEED } as SceneEnv), 0, "autumn");   // (the city's limits and gates)
  const mat = { ground: new THREE.MeshLambertMaterial({ vertexColors: true }), solid: new THREE.MeshLambertMaterial({ vertexColors: true }), lamp: new THREE.MeshLambertMaterial({ vertexColors: true }) };
  for (let N = 0; N < CITIES; N++) {
    if (ONLY >= 0 && N !== ONLY) continue;
    const style = journeyStyle(SEED, N), plan = new CityPlan(citySeedOf(SEED, N), style), sid = (style as any).id ?? `city${N}`;
    plan.climate = { season: SEASON[0], weather: SEASON[1] as any, snowCover: /snow/.test(SEASON[1]) };
    const build = makeCityChunkBuilder(mat, plan);
    const tris: Tri[] = [];
    let chunks = 0;
    for (let cx = CITY_LO - RING; cx <= CITY_HI + RING; cx++) for (let cz = CITY_LO - RING; cz <= CITY_HI + RING; cz++) {
      if (cityDistance(cx, cz) > RING) continue;
      const gen = build(cx, cz); let r = gen.next(); while (!r.done) r = gen.next();
      const g = r.value; if (!g) continue;
      g.position.set(cx * BLOCK, 0, cz * BLOCK); trianglesOf(g, tris); chunks++;
    }
    sweep(tris, sid, clashes);
    console.log(`city ${N} (${sid}): ${chunks} chunks, ${tris.length} triangles`);
  }
  // The car models (cars.ts: traffic, and parked ones stamped into chunks), each on its own, apart,
  // and up off the ground (a parked car on a garage deck shows its underside).
  {
    const tris: Tri[] = [], b = new Batch();
    CAR_KINDS.forEach((k, i) => { carModel(b, k, 0xb22222); const m = b.build(mat.solid)!; m.position.set(i * 12, 2, 0); trianglesOf(m, tris); });
    sweep(tris, "cars", clashes);
    // And the boats (boats.ts: moored, and on the country road's water), spread out likewise.
    const boats: BoatKind[] = ["cruiser", "narrowboat", "sailboat", "rowboat", "canoe", "kayak", "jetski"], bt: Tri[] = [];
    boats.forEach((k, i) => { boatAt(b, k, i * 30, 2, 0, 0, 0x2f4f3a); const m = b.build(mat.solid)!; trianglesOf(m, bt); });
    sweep(bt, "boats", clashes);
  }
  // Everything else that isn't built into a chunk, each thing on its own, spread out and up off
  // the ground: the trucks, the people and animals, the traffic and the trains (each kind's model:
  // the meshes as built, instanced ones once), and the ships and boats at sea.
  if (ONLY < 0) {
    const objs = (label: string, list: THREE.Object3D[]) => {
      const tris: Tri[] = [];
      list.forEach((o, i) => { const g = new THREE.Group(); g.add(o); o.visible = true; g.position.set(i * 60, 2, 0); trianglesOf(g, tris); g.remove(o); });
      sweep(tris, label, clashes);
      console.log(`${label}: ${list.length} things, ${tris.length} triangles`);
    };
    const fresh = (make: (sc: THREE.Scene) => unknown) => { const sc = new THREE.Scene(); make(sc); return [...sc.children]; };
    const kit = new TruckKit(new Proxy({}, { get: () => ({ width: 1, height: 1 }) }) as any);
    const models: TruckModel[] = ["box16", "box26", "reefer", "tractor", "flatbed"];
    objs("trucks", models.map((m) => new Truck(kit, m, null).root));
    // (And opened up: the roll-up or swing doors, the ramp out, the lift gate down, the cab door,
    // the trailer's doors; half way and all the way.)
    for (const f of [0.5, 1]) objs(`trucks open ${f}`, models.map((m) => {
      const t = new Truck(kit, m, null) as any;
      t.rearDoor = f; t.ramp = f; t.liftgate = f; t.liftgateDrop = f; t.cabDoor = f; t.trailerDoors = f;
      t.update(0, 0); return t.root;
    }));
    // The driver and the dock worker in the poses they take: standing, walking (through a stride),
    // seated at the wheel, stooping to a load low and high, and each gesture.
    const posed = (look: typeof DRIVER_LOOK, vest: boolean, P: ReturnType<typeof restPose>) => { const c = new Character(mat.solid, look, vest); c.apply(P); return c.root; };
    const poses: ReturnType<typeof restPose>[] = [restPose(), idlePose(1.3, restPose()), seatedPose(restPose(), 0.3)];
    for (let ph = 0; ph < 1; ph += 0.125) poses.push(walkPose(ph, idlePose(0, restPose())));
    for (const [h, ahead] of [[0.2, 0.5], [0.9, 0.4], [1.4, 0.3]]) poses.push(stoopFor(restPose(), h, ahead));
    for (const g of ["clipboard", "wave", "point", "strap", "reach", "stow", "climb"] as const) for (const t of [0.3, 1.1]) { try { poses.push(gesturePose(g as any, t, restPose())); } catch { /* not a gesture */ } }
    objs("poses", [...poses.map((P) => posed(DRIVER_LOOK, false, P)), ...poses.map((P) => posed(WORKER_LOOK, true, P))]);
    // The crew's gear (crew.ts: the hand truck, dolly, pallet jack, forklift and the rest).
    objs("crew gear", fresh((sc) => new Crew(sc, mat.solid)));
    // Every cargo model in four variants, and every cargo carried.
    objs("cargo", Object.entries(CARGO_MODELS).flatMap(([, m]) => [0, 1, 2, 3].map((i) => { const b = new Batch(); m.build(b, 0, 0, 0, i); return b.build(mat.solid) ?? new THREE.Group(); })));
    // (Each posed as it moves, if it does: a penguin's head out of its crate.)
    objs("loads", CARGO.flatMap((c) => [0, 1].map((v) => { try { const L = buildCarried(c.id, mat.solid, 1, v); L.animate?.(0.4); return L.group; } catch { return new THREE.Group(); } })));
    objs("people", [new Character(mat.solid, DRIVER_LOOK).root, new Character(mat.solid, WORKER_LOOK, true).root,
      ...([0, 1, 2] as const).map((c) => new Cow(mat.solid, c).root), new Horse(mat.solid).root, new Tractor(mat.solid, mat.lamp).root,
      ...fresh((sc) => new Figures(sc, mat.solid, 1))]);
    objs("traffic", fresh((sc) => new Traffic(sc, mat.solid, null)));
    objs("trains", fresh((sc) => new Ambient(sc, mat.solid)));
    // (A town on the sea's: the first of the journey's that is.)
    for (let N = 0; N < 12; N++) {
      const plan = new CityPlan(citySeedOf(SEED, N), journeyStyle(SEED, N));
      if (plan.outline.sea === null) continue;
      const w = new THREE.Group(), sl = new SeaLife(w, mat.solid); sl.build(plan);
      objs("sea", [...w.children]); break;
    }
  }
  // The country roads between the cities (countryworld.ts): each of the journey's first drives,
  // built a stretch at a time along its length as the truck would see it, and swept a stretch at
  // a time.
  if (ONLY < 0) {
    const sc = new THREE.Scene(), world = new CountryWorld(sc, mat, null), seen = new Set<string>();
    world.exact = true;
    let n = 0;
    for (let m = 5; m < 1500 && n < (argv[5] ? Number(argv[5]) : 3); m += 7) {
      const road = new Journey(readConfig({ seed: SEED } as SceneEnv), m * 60, SEASON[0]).country;
      if (!road || seen.has(road.key)) continue;
      seen.add(road.key); n++;
      world.setRoad(road);
      let segs = 0, tris0 = 0;
      for (let s = 0; s < road.length; s += 300) {
        world.update(0, s, true, false);
        const tris: Tri[] = [];
        sc.updateMatrixWorld(true);
        trianglesOf(sc, tris);
        sweep(tris, `road${n}`, clashes); segs++; tris0 += tris.length;
      }
      console.log(`road ${n} (${road.key}): ${Math.round(road.length)} m, ${segs} stretches, ${tris0} triangles`);
    }
    world.setRoad(null);
  }
  for (const c of clashes.values()) c.seen = c.seen * 4 > c.looked ? c.seen : 0;
  const list = [...clashes.values()].sort((a, b) => (b.seen ? 1 : 0) - (a.seen ? 1 : 0) || b.area - a.area);
  for (const c of list) console.log(`${!c.seen ? "hidden" : c.gap <= FAIL_GAP ? "FLUSH " : "near  "} ${c.area.toFixed(2).padStart(8)} m² ${String(c.n).padStart(5)}x  gap ${(c.gap * 1000).toFixed(1)} mm  ${c.key}  at ${c.at.map((v) => v.toFixed(1)).join(", ")}`);
  const flush = list.filter((c) => c.seen && c.gap <= FAIL_GAP), near = list.filter((c) => c.seen && c.gap > FAIL_GAP);
  console.log(`${flush.length} flush clash groups in sight, ${near.length} near (within ${GAP * 1000} mm), ${list.length - flush.length - near.length} hidden`);
  if (flush.length) proc.exit(1);
}
