// City decor (phase 9): neon, billboards, ghost signs, fire escapes, street furniture, and each
// style's signature pieces (elevated rail, cable car tracks, port cranes, rail spurs, the town
// square's clock tower, the water tower with the town name), plus plaza statues, flags, the
// Ryder rooftop sign and marquees. Builders run inside the chunk builder and read the chunk's
// context from DC.
import type { PlateSet, SignStyle } from "./signs.ts";
import { Batch } from "./geom.ts";
import type { Quad } from "./geom.ts";
import { PoolBuilder } from "./atmosphere.ts";
import { facadeBox } from "./facade.ts";
import { FACADE } from "./facadetiles.ts";
import { FLAG_WAVE, NEON_BLINK, NEON_CHASE, NEON_STEADY } from "./signals.ts";
import type { CityStyle } from "./styles.ts";
import { C, CITY_HI, CITY_LO, CityPlan, cityTree, CS, faceYaw, GATE_SLOTS, inset, irange, pick, range, shade, streetSide } from "./city.ts";
import { BLOCK, CURB_H, LOT_TOP, STREET } from "./grid.ts";
import type { District, Rand, Rect, StallPose } from "./city.ts";
import type { FacilityId } from "./facilities.ts";
import { hash2 } from "./rng.ts";
import { AD_BATON, AD_BATON_MARK, AD_BILLBOARD, AD_GHOST, AD_H, AD_RYDER, AD_W, signAtlas, SignAtlas } from "./signs.ts";

interface RoofSpot { r: Rect; top: number }
// What stands on the pavement, as circles (x, z, radius, chunk-local), recorded while a probe
// build (city.ts pavementObstacles) runs, so the driver can walk round it; null otherwise.
export const PAVEMENT: { out: number[] | null; boxes: number[] | null } = { out: null, boxes: null };
export function pavementObstacle(x: number, z: number, r: number, kind = 0) { PAVEMENT.out?.push(x, z, r, kind); }
// What a pavement obstacle is, for the street life that uses it (vignettes.ts): 0 anything else.
export const PK = { hydrant: 1, trash: 2, bench: 3, mailbox: 4, news: 5, meter: 6, shelter: 7, rack: 8, lamp: 9, tree: 10 } as const;
// How far out what stands on the pavement reaches at hand height (what two carry between them,
// chores.ts): a street tree only its trunk, over its pit; the rest as for the feet. Carried at the
// shoulder (`high`, chores.ts HIGH_CARRY): over what is lower, a bin, a bench, nothing.
export const TRUNK_R = 0.2;
const LOW = new Set<number>([PK.hydrant, PK.trash, PK.bench, PK.news, PK.rack]);
export const handR = (r: number, kind?: number, high = false) => kind === PK.tree ? TRUNK_R : high && kind !== undefined && LOW.has(kind) ? NaN : r;   // (NaN: passed over)
// A vehicle parked off the street (in a dock's yard), axis-aligned from (x0, z0) to (x1, z1).
export function parkedObstacle(x0: number, z0: number, x1: number, z1: number) { PAVEMENT.boxes?.push(x0, z0, x1, z1); }
export const DC = {
  lamps: null as unknown as Batch,     // neon and flags (the lamp material animates them)
  plates: null as PlateSet | null,     // street name and freeway plates (null in probe builds)
  quads: [] as Quad[],                 // sign atlas quads: name signs and billboards
  ads: false,                          // whether `quads` uses billboard ads
  mquads: [] as Quad[],                // marquee quads
  roofs: [] as RoofSpot[],             // flat roofs built in this chunk (for billboards)
  fac: "residence" as FacilityId,
  plan: null as unknown as CityPlan,
  // (The chunk's sign slots, and a rental lot's stalls as it is drawn, tile-local: city.ts.)
  takeSlot: null as ((text: string, style: SignStyle) => ReturnType<SignAtlas["uv"]> | null) | null,
  stalls: [] as StallPose[],
  cx: 0, cz: 0,
  pools: null as unknown as PoolBuilder,   // light pools under the streetlights
  lampSites: [] as number[],   // streetlight heads (x, y, z), for applyLampLight
};

// Outward normals of facadeBox sides (+z, +x, -z, -x), and the reading direction (left to right
// as seen from outside) along each.
const SIDE_N: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const sideRight = (side: number): [number, number] => [SIDE_N[side][1], -SIDE_N[side][0]];
// A point on side `side` of rect r: `u` metres along it (from its centre, in reading direction)
// and `out` metres proud of it.
function onWall(r: Rect, side: number, u: number, out: number): [number, number] {
  const [nx, nz] = SIDE_N[side], [rx, rz] = sideRight(side);
  const cx = side === 1 ? r.x1 : side === 3 ? r.x0 : (r.x0 + r.x1) / 2;
  const cz = side === 0 ? r.z1 : side === 2 ? r.z0 : (r.z0 + r.z1) / 2;
  return [cx + rx * u + nx * out, cz + rz * u + nz * out];
}
const wallLen = (r: Rect, side: number) => (side % 2 === 0 ? r.x1 - r.x0 : r.z1 - r.z0);

// ---- neon -------------------------------------------------------------------------------------
// A stroke font on a 2x4 grid, for the few words neon signs spell.
const NEON_FONT: Record<string, number[][]> = {
  A: [[0, 0, 0, 3], [2, 0, 2, 3], [0, 3, 1, 4], [1, 4, 2, 3], [0, 2, 2, 2]],
  B: [[0, 0, 0, 4], [0, 4, 1.6, 4], [1.6, 4, 1.6, 2], [0, 2, 2, 2], [2, 2, 2, 0], [0, 0, 2, 0]],
  C: [[2, 0, 0, 0], [0, 0, 0, 4], [0, 4, 2, 4]],
  D: [[0, 0, 0, 4], [0, 4, 1.3, 4], [1.3, 4, 2, 3.2], [2, 3.2, 2, 0.8], [2, 0.8, 1.3, 0], [1.3, 0, 0, 0]],
  E: [[0, 0, 0, 4], [0, 4, 2, 4], [0, 2, 1.5, 2], [0, 0, 2, 0]],
  F: [[0, 0, 0, 4], [0, 4, 2, 4], [0, 2, 1.5, 2]],
  H: [[0, 0, 0, 4], [2, 0, 2, 4], [0, 2, 2, 2]],
  I: [[1, 0, 1, 4], [0.4, 0, 1.6, 0], [0.4, 4, 1.6, 4]],
  L: [[0, 4, 0, 0], [0, 0, 2, 0]],
  M: [[0, 0, 0, 4], [0, 4, 1, 2], [1, 2, 2, 4], [2, 4, 2, 0]],
  N: [[0, 0, 0, 4], [0, 4, 2, 0], [2, 0, 2, 4]],
  O: [[0, 0, 0, 4], [0, 4, 2, 4], [2, 4, 2, 0], [2, 0, 0, 0]],
  P: [[0, 0, 0, 4], [0, 4, 2, 4], [2, 4, 2, 2], [2, 2, 0, 2]],
  R: [[0, 0, 0, 4], [0, 4, 2, 4], [2, 4, 2, 2], [2, 2, 0, 2], [0.8, 2, 2, 0]],
  S: [[2, 4, 0, 4], [0, 4, 0, 2], [0, 2, 2, 2], [2, 2, 2, 0], [2, 0, 0, 0]],
  T: [[0, 4, 2, 4], [1, 4, 1, 0]],
  Z: [[0, 4, 2, 4], [2, 4, 0, 0], [0, 0, 2, 0]],
};
const NEON_COLORS = [0xff3a8c, 0x3af2ff, 0xff4030, 0x7dff5a, 0xffd23a, 0xc86bff];

// One neon stroke: a thin tube from (u0, v0) to (u1, v1) in a wall's plane, where u runs along
// (dx, dz) and v up from (x, y, z).
function neonStroke(L: Batch, x: number, y: number, z: number, dx: number, dz: number, u0: number, v0: number, u1: number, v1: number, color: number) {
  const du = u1 - u0, dv = v1 - v0, len = Math.hypot(du, dv), um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  L.boxR(x + dx * um, y + vm, z + dz * um, len + 0.06, 0.06, 0.06, color, 0, Math.atan2(-dz, dx), Math.atan2(dv, du));
}
// A word centred at (x, y, z) on a wall reading along (dx, dz), letters h tall.
function neonWord(L: Batch, s: Batch, x: number, y: number, z: number, dx: number, dz: number, nx: number, nz: number, word: string, h: number, color: number, mode: number, seed: number) {
  const k = h / 4, lw = 2 * k, gap = 0.9 * k, total = word.length * lw + (word.length - 1) * gap;
  // Dark backing plate so the tubes read against any wall.
  s.boxR(x - nx * 0.02, y + h / 2, z - nz * 0.02, total + 0.3, h + 0.3, 0.05, 0x17181c, 0, Math.atan2(-dz, dx), 0);
  L.aux.set(seed, mode, 0);
  let u = -total / 2;
  for (const ch of word) {
    for (const [a, b, c, d] of NEON_FONT[ch] ?? []) neonStroke(L, x + nx * 0.06, y, z + nz * 0.06, dx, dz, u + a * k, b * k, u + c * k, d * k, color);
    u += lw + gap;
  }
  L.aux.set(0, 0, -1);
}
// A coffee cup with chasing steam, or a tooth, as neon (for cafes and dentists).
function neonIcon(L: Batch, x: number, y: number, z: number, dx: number, dz: number, nx: number, nz: number, kind: "cup" | "tooth", h: number) {
  const px = x + nx * 0.06, pz = z + nz * 0.06, k = h / 4;
  L.aux.set(1, NEON_STEADY, 0);
  if (kind === "cup") {
    for (const [a, b, c, d] of [[-1, 0, 1, 0], [-1, 0, -1.2, 1.8], [1, 0, 1.2, 1.8], [-1.2, 1.8, 1.2, 1.8], [1.2, 1.4, 1.8, 1.2], [1.8, 1.2, 1.1, 0.5]])
      neonStroke(L, px, y, pz, dx, dz, a * k, b * k, c * k, d * k, 0xfff2d0);
    for (let i = 0; i < 3; i++) {
      L.aux.set(i, NEON_CHASE, 3);
      const u = (-0.6 + i * 0.6) * k;
      neonStroke(L, px, y, pz, dx, dz, u, 2.2 * k, u + 0.3 * k, 3.1 * k, 0xffffff);
      neonStroke(L, px, y, pz, dx, dz, u + 0.3 * k, 3.1 * k, u, 4 * k, 0xffffff);
    }
  } else {
    const pts = [[-1, 3.2], [-0.5, 3.8], [0, 3.4], [0.5, 3.8], [1, 3.2], [0.8, 1.6], [0.5, 0], [0.2, 1.4], [-0.2, 1.4], [-0.5, 0], [-0.8, 1.6], [-1, 3.2]];
    for (let i = 0; i < pts.length - 1; i++) neonStroke(L, px, y, pz, dx, dz, pts[i][0] * k, pts[i][1] * k, pts[i + 1][0] * k, pts[i + 1][1] * k, 0xf4fbff);
  }
  L.aux.set(0, 0, -1);
}

// The neon word a shop shows, from its block's facility.
function neonFor(fac: FacilityId, rnd: Rand): { word: string; icon?: "cup" | "tooth" } {
  switch (fac) {
    case "bar": case "sportsBar": return { word: "BAR" };
    case "diner": return { word: "DINER" };
    case "restaurant": return { word: pick(rnd, ["PIZZA", "TACOS", "PHO"]) };
    case "cafe": return { word: "COFFEE", icon: "cup" };
    case "dentist": return { word: "TEETH", icon: "tooth" };
    case "motel": return { word: "MOTEL" };
    case "hotel": return { word: "HOTEL" };
    case "barber": return { word: "BARBER" };
    default: return rnd() < 0.15 ? { word: pick(rnd, ["PIZZA", "TACOS", "COFFEE"]) } : { word: "OPEN" };
  }
}
// Neon over a storefront on side `side` of building rect b (above the awning).
export function shopNeon(s: Batch, b: Rect, side: number, rnd: Rand) {
  const n = neonFor(DC.fac, rnd), [nx, nz] = SIDE_N[side], [rx, rz] = sideRight(side);
  const len = wallLen(b, side), off = range(rnd, -0.2, 0.2) * len;
  const [x, z] = onWall(b, side, off, 0.02);
  const mode = rnd() < 0.25 ? NEON_BLINK : NEON_STEADY;
  neonWord(DC.lamps, s, x, CURB_H + 3.55, z, rx, rz, nx, nz, n.word, 0.5, pick(rnd, NEON_COLORS), mode, rnd() * 10);
  if (n.icon) { const [ix, iz] = onWall(b, side, off - (n.word.length * 0.36) / 2 - 0.6, 0.02); neonIcon(DC.lamps, ix, CURB_H + 3.45, iz, rx, rz, nx, nz, n.icon, 0.7); }
}

// ---- billboards and ghost signs -------------------------------------------------------------------
// A billboard on one of the chunk's flat roofs, facing the nearest street.
// A billboard on a roof drawn in this block (DC.roofs) facing a street: the roof (r, its top), the
// side it faces, and its ad (a pool, AD_POOLS, and the ad's place in it); or null.
export const AD_POOLS: Record<string, readonly unknown[]> = { ryder: AD_RYDER, baton: AD_BATON, billboard: AD_BILLBOARD };
export function billboardSpot(B: Rect, rnd: Rand): { r: Rect; top: number; side: number; ad: [string, number] } | null {
  const spots = DC.roofs.filter((sp) => sp.top > 3 && sp.top < 30 && Math.min(sp.r.x1 - sp.r.x0, sp.r.z1 - sp.r.z0) >= 6);
  if (!spots.length) return null;
  const sp = pick(rnd, spots), side = streetSide(sp.r, B, 30);
  if (side < 0) return null;
  const k = rnd(), pool = k < 0.25 ? "ryder" : k < 0.37 ? "baton" : "billboard";
  return { r: sp.r, top: sp.top, side, ad: [pool, Math.floor(rnd() * AD_POOLS[pool].length)] };
}
export function drawBillboard(s: Batch, r: Rect, top: number, side: number, ad: [string, number]) {
  const w = Math.min(8, wallLen(r, side) - 1), h = w * 0.375;
  const [nx, nz] = SIDE_N[side], [rx, rz] = sideRight(side);
  const [x, z] = onWall(r, side, 0, -1.0);
  const base = top + 1.4, yaw = Math.atan2(-rz, rx);
  for (const k of [-0.33, 0.33]) s.box(x + rx * w * k - nx * 0.4, top + (base - top + h) / 2, z + rz * w * k - nz * 0.4, 0.22, base - top + h, 0.22, C.pole);
  s.boxR(x, base + h / 2, z, w + 0.3, h + 0.3, 0.28, 0x2a2c30, 0, yaw, 0);
  s.boxR(x - nx * 0.2, base - 0.15, z - nz * 0.2, w, 0.08, 0.7, C.pole, 0, yaw, 0);   // catwalk
  const pool = AD_POOLS[ad[0]] ?? AD_BILLBOARD;
  DC.quads.push({ x: x + nx * 0.15, y: base + h / 2, z: z + nz * 0.15, w, h, rotY: faceYaw(nx, nz), ...signAtlas.adUV(pool[ad[1] % pool.length] as never) });
  DC.ads = true;
}
// A faded painted sign high on a blank wall.
export function ghostSign(r: Rect, side: number, y: number, rnd: Rand) {
  const [nx, nz] = SIDE_N[side], w = Math.min(10, wallLen(r, side) - 2);
  if (w < 5) return;
  const [x, z] = onWall(r, side, range(rnd, -0.15, 0.15) * (wallLen(r, side) - w), 0.04);
  DC.quads.push({ x, y, z, w, h: w * 0.375, rotY: faceYaw(nx, nz), ...signAtlas.adUV(pick(rnd, AD_GHOST)) });
  DC.ads = true;
}

// ---- fire escapes -------------------------------------------------------------------------------
export function fireEscape(s: Batch, b: Rect, side: number, floors: number, firstH: number, floorH: number, rnd: Rand) {
  const [nx, nz] = SIDE_N[side], [rx, rz] = sideRight(side), yaw = Math.atan2(-rz, rx);
  const u = range(rnd, -0.25, 0.25) * wallLen(b, side);
  const iron = 0x26282b;
  for (let f = 1; f < floors; f++) {
    const y = CURB_H + firstH + (f - 1) * floorH + 0.05;
    const [x, z] = onWall(b, side, u, 0.45);
    s.boxR(x, y, z, 2.8, 0.06, 0.9, iron, 0, yaw, 0);
    s.boxR(x + nx * 0.42, y + 0.5, z + nz * 0.42, 2.8, 0.04, 0.04, iron, 0, yaw, 0);   // rail
    for (const k of [-1.38, 1.38]) s.box(x + rx * k + nx * 0.42, y + 0.25, z + rz * k + nz * 0.42, 0.04, 0.5, 0.04, iron);
    if (f > 1) {   // stair down to the platform below
      const [sx, sz] = onWall(b, side, u + 0.4, 0.45);
      s.boxR(sx, y - floorH / 2, sz, Math.hypot(1.8, floorH) * 0.95, 0.05, 0.6, iron, 0, yaw, Math.atan2(floorH, 1.8));
    }
  }
}

// ---- street furniture ---------------------------------------------------------------------------
// Along one sidewalk of a street segment: `at(p, across)` maps the segment's along coordinate and
// an across offset to a box call; `busy` holds along positions already taken (trees, lights,
// signs, driveways), widened as items are placed.
// (Along the segment from a0 to a1: on the old grid, STREET to BLOCK.)
// Furniture a city file lists for one side of a street (cityfile.ts): each piece's kind (PK) and
// its place along the street, in the street's frame. And, while drafting, what the placing below
// picks: [street, kind, along, inward] for each piece (FURNITURE.out, read by tools/cityfiles.ts).
export type FurnitureItem = [number, number];
export const FURNITURE = { out: null as number[] | null, street: -1 };
// The pavement's furniture along one side of a street: a hydrant, a bin, benches, a mailbox, and
// in the shops newspaper boxes, parking meters, a bus shelter and a bike rack, each clear of what
// already stands there (busy). `given`: what a city file lists for this side, drawn in place of
// what the placing picks. (The placing still runs, drawing nothing: its random draws are taken as
// ever, so what the chunk lays out after it stays where it was.)
export function streetFurniture(s: Batch, g: Batch, district: District, kerbAcross: number, inward: number, axis: 0 | 1, busy: number[][], rnd: Rand, a0 = STREET, a1 = BLOCK, given: readonly FurnitureItem[] | null = null) {
  const box = (al: number, y: number, ac: number, lal: number, h: number, lac: number, color: number) =>
    axis === 0 ? s.box(al, y, ac, lal, h, lac, color) : s.box(ac, y, al, lac, h, lal, color);
  const cyl = (al: number, y: number, ac: number, r: number, h: number, color: number, seg = 8) =>
    axis === 0 ? s.cyl(al, y, ac, r, h, color, seg) : s.cyl(ac, y, al, r, h, color, seg);
  const rec = (p: number, across: number, r: number, kind = 0) => axis === 0 ? pavementObstacle(p, across, r, kind) : pavementObstacle(across, p, r, kind);
  const ac = kerbAcross + inward * 0.7, y0 = CURB_H;   // 0.7 m in from the kerb face
  // Each kind drawn at p along, with what it stands in the walkers' way as (a bus shelter, long and
  // set back, as a row of circles along its roof; a bench, long and shallow, as a row along it).
  const piece: Record<number, (p: number) => void> = {
    [PK.hydrant]: (p) => { cyl(p, y0 + 0.35, ac, 0.13, 0.7, 0xc0392b); cyl(p, y0 + 0.74, ac, 0.16, 0.1, 0xc0392b); box(p, y0 + 0.45, ac, 0.42, 0.1, 0.1, 0xd04a3a); rec(p, ac, 0.45, PK.hydrant); },
    [PK.trash]: (p) => { cyl(p, y0 + 0.45, ac, 0.28, 0.9, 0x2e4a3a); cyl(p, y0 + 0.92, ac, 0.3, 0.06, 0x223a2e); rec(p, ac, 0.45, PK.trash); },
    [PK.bench]: (p) => {
      box(p, y0 + 0.45, ac + inward * 0.1, 1.8, 0.08, 0.45, 0x7a5232); box(p, y0 + 0.75, ac + inward * 0.33, 1.8, 0.4, 0.06, 0x7a5232);
      for (const k of [-0.8, 0.8]) box(p + k, y0 + 0.22, ac + inward * 0.1, 0.07, 0.44, 0.4, 0x2a2b2e);
      for (const k of [-0.6, 0, 0.6]) rec(p + k, ac + inward * 0.2, 0.42, PK.bench);
    },
    // (A mailbox's lid overhangs: shared planes flicker.)
    [PK.mailbox]: (p) => { box(p, y0 + 0.55, ac, 0.5, 1.1, 0.45, 0x1f4f9f); box(p, y0 + 1.1, ac, 0.52, 0.1, 0.47, 0x1a3f80); rec(p, ac, 0.45, PK.mailbox); },
    [PK.news]: (p) => { for (const [k, c] of [[-0.4, 0xc0392b], [0.3, 0xf2c200]] as const) box(p + k, y0 + 0.5, ac, 0.45, 1.0, 0.4, c); rec(p, ac, 0.9, PK.news); },
    [PK.meter]: (p) => { cyl(p, y0 + 0.6, kerbAcross + inward * 0.45, 0.04, 1.2, 0x55585c, 5); box(p, y0 + 1.28, kerbAcross + inward * 0.45, 0.2, 0.28, 0.16, 0x9aa0a6); rec(p, kerbAcross + inward * 0.45, 0.15, PK.meter); },
    [PK.shelter]: (p) => {
      const back = kerbAcross + inward * 1.75, front = kerbAcross + inward * 0.35;   // open to the kerb, clear of the walkway
      box(p, y0 + 1.25, back, 3.6, 2.5, 0.06, 0x8fb8c8); box(p, y0 + 2.55, (back + front) / 2, 3.8, 0.1, 1.6, 0x3a3d40);
      for (const k of [-1.75, 1.75]) box(p + k, y0 + 1.25, (back + front) / 2, 0.08, 2.5, 1.4, 0x3a3d40);
      box(p, y0 + 0.45, back - inward * 0.3, 2.8, 0.08, 0.4, 0x55585c);
      for (const k of [-1.425, -0.475, 0.475, 1.425]) rec(p + k, kerbAcross + inward * 1.05, 0.8, PK.shelter);
    },
    [PK.rack]: (p) => { for (const k of [-0.6, 0, 0.6]) box(p + k, y0 + 0.4, ac, 0.05, 0.8, 0.6, 0x9aa0a6); rec(p, ac, 1.05, PK.rack); },
  };
  const put = (kind: number, p: number) => {
    if (given) return;
    piece[kind](p);
    FURNITURE.out?.push(FURNITURE.street, kind, p, inward);
  };
  const free = (p: number, half: number, end = 2.5) => p - half > a0 + end && p + half < a1 - end && busy.every(([a, b]) => p + half < a || p - half > b);
  const place = (half: number, kind: number) => {
    // (A bus shelter 6 m clear of the corners, where the crossing guard's children gather
    // (vignettes.ts guard): they walked through its glass.)
    const end = kind === PK.shelter ? 6 : 2.5;
    for (let t = 0; t < 12; t++) {
      const p = range(rnd, a0 + 3, a1 - 3);
      if (free(p, half, end)) { put(kind, p); busy.push([p - half - 0.4, p + half + 0.4]); return true; }
    }
    return false;
  };
  // Every sidewalk gets a hydrant.
  place(0.3, PK.hydrant);
  if (district !== "industrial") {
    // Trash can and a bench.
    place(0.3, PK.trash);
    if (district !== "residential" || rnd() < 0.3) place(0.95, PK.bench);
    if (rnd() < 0.5) place(0.3, PK.mailbox);
    if (district === "commercial" || district === "downtown") {
      place(0.75, PK.news);   // newspaper boxes
      // A row of parking meters along the kerb.
      const start = range(rnd, a0 + 6, a0 + 14);
      for (let i = 0; i < 4; i++) {
        const p = start + i * 6;
        if (!free(p, 0.15)) continue;
        put(PK.meter, p); busy.push([p - 0.3, p + 0.3]);
      }
      if (rnd() < 0.3) place(1.9, PK.shelter);   // bus shelter
    }
    if (district === "downtown" && rnd() < 0.5) place(0.9, PK.rack);   // bike rack
    // A manhole cover in the road (where by its street and side, as the stream's draws differ between
    // a city drawn by its rules and one drawn from its file).
    const mh = a0 + 8 + hash2(FURNITURE.street, inward, Math.round(a0 * 10), DC.plan.seed) * Math.max(0, a1 - a0 - 16);
    if (axis === 0) g.cyl(mh, 0.014, STREET / 2 + inward * -3, 0.38, 0.01, 0x3a3b3e, 10); else g.cyl(STREET / 2 + inward * -3, 0.014, mh, 0.38, 0.01, 0x3a3b3e, 10);
  }
  for (const [kind, p] of given ?? []) { piece[kind]?.(p); FURNITURE.out?.push(FURNITURE.street, kind, p, inward); }
}

// ---- signature pieces -------------------------------------------------------------------------------
// Elevated rail over some east-west streets (metro); cable car tracks down some north-south
// streets (coastal). Both are functions of the grid so the moving trains find them.
const elevatedRow = (cz: number) => (((cz % 4) + 4) % 4) === 1;
export const cableColumn = (cx: number) => (((cx % 3) + 3) % 3) === 1;
export const ELEVATED_Y = 7.0;
// How far the elevated lines run on out of town, east and west, into the distance (ElevatedReach).
export const ELEVATED_REACH = 2500;
// The rows an elevated line runs along in a metro city: every fourth row, but never within a block
// of a gate's row on the east or west side (the line runs straight out of town both ways, and
// there it would run out over or right beside the highway).
export function elevatedLine(style: CityStyle, cz: number) {
  return !!style.elevated && elevatedRow(cz) && cz >= CITY_LO && cz <= CITY_HI && !GATE_SLOTS.some((g) => (g.dir === 0 || g.dir === 2) && Math.abs(g.iz - cz) <= 1);
}

// One block's length of the line's deck, from x0 (block-local x from 0 to BLOCK otherwise): the
// track's top is at ELEVATED_Y + 0.5. What holds it up is elevatedBent's, placed by the street
// beneath (city.ts buildStreet) or out of town (elevated.ts).
export const EL_DECK = 0x5a5e62, EL_STEEL = 0x4a5450, EL_RAIL = 0x8a8f94;
// The deck from x0 to x1 along the street's frame (a block, on the grid).
export function buildElevated(s: Batch, x0 = 0, x1 = x0 + BLOCK) {
  s.span(x0, ELEVATED_Y, 5, x1, ELEVATED_Y + 0.5, 13, EL_DECK);
  for (const z of [5.2, 12.8]) s.span(x0, ELEVATED_Y - 0.6, z - 0.2, x1, ELEVATED_Y, z + 0.2, EL_STEEL);
  for (const z of [5.1, 12.9]) s.span(x0, ELEVATED_Y + 0.5, z - 0.05, x1, ELEVATED_Y + 1.4, z + 0.05, EL_STEEL);
  for (const z of [6.4, 7.8, 10.2, 11.6]) s.span(x0, ELEVATED_Y + 0.5, z - 0.06, x1, ELEVATED_Y + 0.62, z + 0.06, EL_RAIL);
}
// The across positions of a bent's two columns (block-local z): on each sidewalk, 0.5 m in from
// the kerb face, so the road beneath stays clear.
export const EL_COLUMNS = [2.5, 15.5] as const;
// A bent at x under a deck whose top is at `top`: a column on each side of the street, with a
// footing, knee braces and a crossbeam under the deck's girders, wider than the deck so that it
// shows from above. Its feet are at y = 0.
// Near the foot of a ramp, where there is no room for columns, it is just the crossbeam standing on
// the ground under the girders.
export function elevatedBent(s: Batch, x: number, top: number) {
  const beamTop = top - 1.1, beamBot = beamTop - 0.7, steel = EL_STEEL;
  if (beamBot < 1.2) { s.span(x - 0.35, 0, 4.6, x + 0.35, beamTop, 13.4, steel); return; }
  s.span(x - 0.35, beamBot, EL_COLUMNS[0] - 0.4, x + 0.35, beamTop, EL_COLUMNS[1] + 0.4, steel);
  for (const z of EL_COLUMNS) {
    const inward = z < 9 ? 1 : -1;
    s.box(x, beamBot / 2, z, 0.6, beamBot, 0.6, steel);
    s.box(x, 0.25, z, 1.03, 0.5, 1.03, 0x8a8780);                                        // footing (past the kerb's face, and a loading zone's yellow kerb's, which its side shared)
    s.box(x, beamBot + 0.05, z, 0.8, 0.3, 0.8, steel);                                      // cap
    const k = 1.3, len = Math.hypot(k, k);                                                  // knee brace
    s.boxR(x, beamBot - k / 2, z + (inward * k) / 2, 0.22, len, 0.22, steel, inward * Math.PI / 4, 0, 0);
  }
}
// A cable car's tracks down a street: on the grid along z, a block (a north-south street); given
// x0..x1, along x in the street's own frame (an avenue's, at any angle).
export function buildCableTracks(g: Batch, x0?: number, x1?: number) {
  for (const lane of [7.5, 10.5]) {
    for (const k of [-0.72, 0.72]) {
      if (x0 === undefined) g.span(lane + k - 0.05, 0.012, 0, lane + k + 0.05, 0.03, BLOCK, 0x8a8f94);
      else g.span(x0, 0.012, lane + k - 0.05, x1!, 0.03, lane + k + 0.05, 0x8a8f94);
    }
    if (x0 === undefined) g.span(lane - 0.03, 0.012, 0, lane + 0.03, 0.025, BLOCK, 0x111214);
    else g.span(x0, 0.012, lane - 0.03, x1!, 0.025, lane + 0.03, 0x111214);
  }
}

// Container stacks and a gantry crane in a port's industrial yard (Y: the yard rect).
export function portCrane(s: Batch, Y: Rect, alongX: boolean, rnd: Rand) {
  const colors = [0xc0392b, 0x1f6fb2, 0x2e8b57, 0xe0a020, 0x7a3e9d, 0xd9d9d4, 0x1c6f78];
  const L = alongX ? Y.x1 - Y.x0 : Y.z1 - Y.z0, W = alongX ? Y.z1 - Y.z0 : Y.x1 - Y.x0;
  if (L < 14 || W < 6) return;
  const at = (a: number, c: number): [number, number] => alongX ? [Y.x0 + a, Y.z0 + c] : [Y.x0 + c, Y.z0 + a];
  for (let a = 2; a + 6.2 < L - 1; a += 6.4)
    for (let c = 1.6; c + 1.2 < W - 0.6; c += 2.6) {
      const n = irange(rnd, 0, 3);
      for (let k = 0; k < n; k++) { const [x, z] = at(a + 3.1, c); s.box(x, k * 2.6 + 1.3, z, alongX ? 6.0 : 2.4, 2.55, alongX ? 2.4 : 6.0, pick(rnd, colors)); }
    }
  // Gantry straddling the stacks, partway along.
  const a = range(rnd, 4, L - 4), red = 0xc0442a, H = 14;
  for (const c of [0.3, W - 0.3]) { const [x, z] = at(a, c); s.box(x, H / 2, z, 0.6, H, 0.6, red); }
  const [x0, z0] = at(a, 0.3), [x1, z1] = at(a, W - 0.3);
  s.span(Math.min(x0, x1) - 0.4, H, Math.min(z0, z1) - 0.4, Math.max(x0, x1) + 0.4, H + 1.1, Math.max(z0, z1) + 0.4, red);
  const [tx, tz] = at(a, W * 0.4);
  s.box(tx, H - 0.6, tz, 2.2, 1.2, 2.2, 0xe0a020);
  s.box(tx, H - 3, tz, 0.08, 4.4, 0.08, 0x222222);
}
// A rail spur along an industrial yard, sometimes with a boxcar on it.
export function railSpur(g: Batch, s: Batch, Y: Rect, alongX: boolean, rnd: Rand) {
  const mid = alongX ? (Y.z0 + Y.z1) / 2 : (Y.x0 + Y.x1) / 2;
  const [a0, a1] = alongX ? [Y.x0, Y.x1] : [Y.z0, Y.z1];
  const span = (p0: number, p1: number, c0: number, c1: number, y0: number, y1: number, col: number, b: Batch) =>
    alongX ? b.span(p0, y0, c0, p1, y1, c1, col) : b.span(c0, y0, p0, c1, y1, p1, col);
  span(a0, a1, mid - 1.6, mid + 1.6, CURB_H, CURB_H + 0.05, 0x6a645c, g);
  for (let p = a0 + 0.4; p < a1; p += 0.9) span(p - 0.12, p + 0.12, mid - 1.3, mid + 1.3, CURB_H + 0.05, CURB_H + 0.1, 0x4a3a2c, g);
  for (const k of [-0.72, 0.72]) span(a0, a1, mid + k - 0.05, mid + k + 0.05, CURB_H + 0.1, CURB_H + 0.2, 0x8a8f94, g);
  if (a1 - a0 > 16 && rnd() < 0.6) {
    const p = range(rnd, a0 + 7, a1 - 7), col = pick(rnd, [0x7a3e2e, 0x5a4a3a, 0x8a5a2a, 0x2f4a62]);
    span(p - 6, p + 6, mid - 1.4, mid + 1.4, CURB_H + 1.1, CURB_H + 4.2, col, s);
    span(p - 1.2, p + 1.2, mid - 1.45, mid + 1.45, CURB_H + 1.3, CURB_H + 3.8, shade(col, 0.75), s);
    for (const q of [p - 4.5, p + 4.5]) span(q - 1, q + 1, mid - 1.1, mid + 1.1, CURB_H + 0.2, CURB_H + 1.1, 0x1c1c1e, s);
  }
}

// A flagpole with a waving flag (stripes of `colors`, top to bottom).
export function flagpole(s: Batch, x: number, z: number, h: number, colors: number[], yaw: number) {
  s.cyl(x, CURB_H + h / 2, z, 0.06, h, 0xd8dadc, 6);
  s.ico(x, CURB_H + h + 0.05, z, 0.1, 0xd4af37);
  const L = DC.lamps, len = 1.6, fh = 1.0, n = 5, dx = Math.cos(yaw), dz = -Math.sin(yaw);
  const normalAng = Math.atan2(Math.cos(yaw), Math.sin(yaw));   // the cloth's normal in xz, as atan2(z, x)
  colors.forEach((c, k) => {
    const sh = fh / colors.length, y = CURB_H + h - 0.15 - sh * (k + 0.5);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) * len / n;
      L.aux.set(u, FLAG_WAVE, normalAng);
      L.boxR(x + dx * u, y, z + dz * u, len / n + 0.01, sh, 0.03, c, 0, yaw, 0);
    }
  });
  L.aux.set(0, 0, -1);
}

// ---- the town square (Main Street) ------------------------------------------------------------------
// A courthouse with a clock tower on a lawn, a bandstand, flags and benches.
export function buildTownSquare(g: Batch, s: Batch, B: Rect, rnd: Rand) {
  g.span(B.x0, 0, B.z0, B.x1, LOT_TOP, B.z1, CS.grass);
  const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2;
  g.span(B.x0, CURB_H, cz - 1.2, B.x1, CURB_H + 0.02, cz + 1.2, C.path);
  g.span(cx - 1.2, CURB_H, B.z0, cx + 1.2, CURB_H + 0.02, B.z1, C.path);
  const stone = 0xece6d6, roof = 0x5f6b72;
  const r: Rect = { x0: cx - 10, z0: cz - 7, x1: cx + 10, z1: cz + 7 };
  s.span(r.x0 - 1, CURB_H, r.z0 - 1, r.x1 + 1, CURB_H + 0.8, r.z1 + 1, 0xd8d2c2);          // plinth
  const top = facadeBox(s, r.x0, r.z0, r.x1, r.z1, CURB_H + 0.8, [{ tile: FACADE.DECO, floors: 2, floorH: 3.6 }], stone, 0, FACADE.LOBBY);
  s.span(r.x0 - 0.3, top, r.z0 - 0.3, r.x1 + 0.3, top + 0.6, r.z1 + 0.3, 0xdcd4c0);
  for (let k = 0; k < 6; k++) s.cyl(r.x0 + 4 + k * 2.4, CURB_H + 0.8 + 3.6, r.z1 + 1.5, 0.32, 7.2, stone, 10);   // portico
  s.prism(cx, top + 1.2, r.z1 + 0.8, 14.5, 2.4, 2.4, stone, 0);
  // Clock tower.
  const T = 4.6, th = 13;
  const tt = facadeBox(s, cx - T / 2, cz - T / 2, cx + T / 2, cz + T / 2, top + 0.6, [{ tile: FACADE.BLANK, floors: 1, floorH: th }], stone);
  for (const [nx, nz] of SIDE_N) {
    const fx = cx + nx * (T / 2 + 0.05), fz = cz + nz * (T / 2 + 0.05), y = tt - 2.6;
    s.cyl(fx, y, fz, 1.5, 0.08, 0xfff8e6, 16, nz !== 0 ? Math.PI / 2 : 0, nx !== 0 ? Math.PI / 2 : 0);
    const yaw = Math.atan2(nx, nz);   // hands lie flat on the face
    s.boxR(fx + nx * 0.06, y + 0.45, fz + nz * 0.06, 0.12, 0.9, 0.04, 0x1a1a1a, 0, yaw, 0);           // hour hand
    s.boxR(fx + nx * 0.07, y + 0.15, fz + nz * 0.07, 1.15, 0.09, 0.04, 0x1a1a1a, 0, yaw, 0.6);        // minute hand
  }
  s.span(cx - T / 2 - 0.3, tt, cz - T / 2 - 0.3, cx + T / 2 + 0.3, tt + 0.5, cz + T / 2 + 0.3, 0xdcd4c0);
  s.cone(cx, tt + 2.6, cz, T * 0.62, 4.2, roof, 4);
  s.cyl(cx, tt + 5.3, cz, 0.05, 1.4, 0xd4af37, 4);
  // Bandstand, flags, benches and trees.
  const bx = cx - 14, bz = cz - 13;
  s.cyl(bx, CURB_H + 0.3, bz, 3, 0.6, 0xf2f2ea, 8);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; s.cyl(bx + Math.cos(a) * 2.6, CURB_H + 1.9, bz + Math.sin(a) * 2.6, 0.08, 2.6, 0xffffff, 5); }
  s.cone(bx, CURB_H + 4.0, bz, 3.4, 1.8, 0xc0392b, 8);
  for (const k of [-3, 0, 3]) flagpole(s, cx + k, r.z1 + 5, 7, k === 0 ? [0xb22234, 0xffffff, 0xb22234, 0xffffff] : [0x1f4f9f, 0xf2c200], 0);
  for (const [dx, dz] of [[-1, 1], [1, 1], [1, -1]]) cityTree(s, cx + dx * 16, CURB_H, cz + dz * 14, range(rnd, 6, 8), range(rnd, 1.8, 2.4), pick(rnd, CS.trees.greens), rnd);
}

// A water tower with the town's name, in a back garden or yard (Main Street).
export function waterTower(s: Batch, x: number, z: number, slotUV: ReturnType<SignAtlas["uv"]> | null) {
  const legs = 15, R = 4, tank = 0xa8c4d8;
  for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.boxR(x + dx * 2.6, CURB_H + legs / 2, z + dz * 2.6, 0.3, legs + 0.4, 0.3, 0x6a7a84, dz * 0.1, 0, -dx * 0.1);
  for (const y of [5, 10]) { s.span(x - 2.9, CURB_H + y, z - 2.9, x + 2.9, CURB_H + y + 0.15, z - 2.75, 0x6a7a84); s.span(x - 2.9, CURB_H + y, z + 2.75, x + 2.9, CURB_H + y + 0.15, z + 2.9, 0x6a7a84); }
  s.cyl(x, CURB_H + legs + 3, z, R, 6, tank, 16);
  s.cone(x, CURB_H + legs + 7, z, R + 0.2, 2.4, shade(tank, 0.85), 16);
  s.cyl(x, CURB_H + legs, z, R - 0.6, 0.4, shade(tank, 0.8), 16);
  if (slotUV) for (const [nx, nz] of SIDE_N) DC.quads.push({ x: x + nx * (R + 0.04), y: CURB_H + legs + 3, z: z + nz * (R + 0.04), w: 6.4, h: 0.8, rotY: faceYaw(nx, nz), ...slotUV });
}

// ---- plaza statues ------------------------------------------------------------------------------------
// Giant stuffed animals as public art: a red panda and a capybara mid-game at a chess table.
export function chessStatues(s: Batch, cx: number, cz: number, yaw: number) {
  const rot = (x: number, z: number): [number, number] => [cx + x * Math.cos(yaw) + z * Math.sin(yaw), cz - x * Math.sin(yaw) + z * Math.cos(yaw)];
  const y0 = CURB_H;
  // Table and board.
  // (Board and squares turned with the table, as rot() lays them out: turned the other way, the
  // squares overlapped their neighbours and flickered.)
  { const [x, z] = rot(0, 0); s.cyl(x, y0 + 0.5, z, 0.25, 1.0, 0x5a4030, 6); s.box(x, y0 + 1.05, z, 1.8, 0.1, 1.8, 0x7a5232, yaw);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const [px, pz] = rot(-0.6 + i * 0.4, -0.6 + j * 0.4); s.box(px, y0 + 1.11, pz, 0.4, 0.02, 0.4, (i + j) % 2 ? 0xf2efe6 : 0x2a2a2a, yaw); }
    for (const [i, j, c] of [[0.2, 0.4, 0xf2efe6], [-0.2, -0.4, 0x2a2a2a], [0.6, -0.2, 0x2a2a2a]] as const) { const [px, pz] = rot(i, j); s.cyl(px, y0 + 1.3, pz, 0.07, 0.35, c, 6); } }
  // Red panda, sitting at -x facing the table.
  { const fur = 0xc4502a, dark = 0x3a2420, cream = 0xf2e6d6;
    const [x, z] = rot(-2.2, 0);
    s.ico(x, y0 + 1.5, z, 1.2, fur, 1.15, -yaw);
    s.ico(...rotY(rot, -2.0, 0, y0 + 1.1), 0.75, dark, 1.3, -yaw);
    const [hx, hz] = rot(-1.9, 0); s.ico(hx, y0 + 3.0, hz, 0.75, fur, 0.9, -yaw);
    const [mx, mz] = rot(-1.3, 0); s.ico(mx, y0 + 2.85, mz, 0.36, cream, 0.8, -yaw);
    for (const k of [-0.45, 0.45]) { const [ex, ez] = rot(-1.55, k); s.ico(ex, y0 + 3.1, ez, 0.2, cream, 1, -yaw); const [kx, kz] = rot(-1.95, k * 1.25); s.cone(kx, y0 + 3.75, kz, 0.24, 0.45, fur, 5); }
    for (const k of [-0.25, 0.25]) { const [ex, ez] = rot(-1.2, k); s.ico(ex, y0 + 3.05, ez, 0.07, 0x111111); }
    for (let i = 0; i < 6; i++) { const [tx, tz] = rot(-3.0 - Math.sin(i * 0.5) * 0.6, -0.9 - i * 0.2); s.ico(tx, y0 + 0.45 + i * 0.32, tz, 0.4, i % 2 ? cream : fur, 1, -yaw); }
    for (const k of [-0.5, 0.5]) { const [ax, az] = rot(-1.3, k); s.boxR(ax, y0 + 1.8, az, 1.0, 0.3, 0.3, dark, 0, -yaw, -0.4); } }
  // Capybara, sitting at +x facing the table: a placid barrel with a blunt square head.
  { const fur = 0x8a6a48, dark = 0x5a4430;
    const [x, z] = rot(2.3, 0);
    s.ico(x, y0 + 1.4, z, 1.25, fur, 1.05, -yaw);
    const [hx, hz] = rot(1.6, 0); s.boxR(hx, y0 + 2.7, hz, 1.3, 0.9, 0.95, fur, 0, -yaw, 0.15);
    const [nx, nz] = rot(1.0, 0); s.boxR(nx, y0 + 2.55, nz, 0.4, 0.6, 0.8, dark, 0, -yaw, 0);
    for (const k of [-0.38, 0.38]) { const [ex, ez] = rot(1.85, k); s.ico(ex, y0 + 3.25, ez, 0.14, dark, 1, -yaw); const [ix, iz] = rot(1.35, k); s.ico(ix, y0 + 2.95, iz, 0.07, 0x111111); }
    for (const k of [-0.5, 0.5]) { const [ax, az] = rot(1.5, k); s.boxR(ax, y0 + 1.7, az, 0.9, 0.3, 0.3, dark, 0, -yaw, 0.4); } }
}
const rotY = (rot: (x: number, z: number) => [number, number], x: number, z: number, y: number): [number, number, number] => { const [a, b] = rot(x, z); return [a, y, b]; };

// The Ryder rooftop sign on the Ryder warehouse: big, lit, double-sided, seen across the city.
export function ryderRoofSign(s: Batch, r: Rect, top: number, side: number, slotUV: ReturnType<SignAtlas["uv"]>) {
  const [nx, nz] = SIDE_N[side], [rx, rz] = sideRight(side), [x, z] = onWall(r, side, 0, -3);
  const w = 14, h = 1.75, y = top + 3.2;
  for (const k of [-5, 0, 5]) s.box(x + rx * k, top + 1.3, z + rz * k, 0.25, 2.6, 0.25, C.pole);
  s.boxR(x, y, z, w + 0.4, h + 0.4, 0.3, 0x2a2c30, 0, Math.atan2(-rz, rx), 0);
  for (const k of [1, -1]) DC.quads.push({ x: x + nx * 0.16 * k, y, z: z + nz * 0.16 * k, w, h, rotY: faceYaw(nx * k, nz * k), ...slotUV });
}

// Baton Tower's crown: the BATON wordmark, lit, on all four sides of the roof.
export function batonCrown(s: Batch, r: Rect, top: number) {
  const w = Math.min(14, Math.min(r.x1 - r.x0, r.z1 - r.z0) - 1.5), h = w * AD_H / AD_W;
  const slotUV = signAtlas.adUV(AD_BATON_MARK);
  DC.ads = true;
  s.span(r.x0 + 0.4, top, r.z0 + 0.4, r.x1 - 0.4, top + h + 0.8, r.z1 - 0.4, 0x15171c);
  for (let side = 0; side < 4; side++) {
    const [nx, nz] = SIDE_N[side], [x, z] = onWall(inset(r, 0.4), side, 0, 0.03);
    DC.quads.push({ x, y: top + 0.4 + h / 2, z, w, h, rotY: faceYaw(nx, nz), ...slotUV });
  }
}

// A marquee canopy over a theatre's (or Baton Tower's) entrance, scrolling the city's messages.
export function marqueeCanopy(s: Batch, r: Rect, side: number) {
  const [nx, nz] = SIDE_N[side], [rx, rz] = sideRight(side), w = Math.min(10, wallLen(r, side) - 2);
  const [x, z] = onWall(r, side, 0, 0.8), y = CURB_H + 4.2, yaw = Math.atan2(-rz, rx);
  s.boxR(x, y, z, w + 0.3, 1.0, 1.6, 0x2a2c30, 0, yaw, 0);
  s.boxR(x, y - 0.55, z, w + 0.3, 0.1, 1.6, 0xf2c200, 0, yaw, 0);
  DC.mquads.push({ x: x + nx * 0.82, y, z: z + nz * 0.82, w, h: 0.8, rotY: faceYaw(nx, nz) });
  for (const k of [-1, 1]) {   // the canopy's ends
    const ex = x + rx * k * (w / 2 + 0.16), ez = z + rz * k * (w / 2 + 0.16);
    DC.mquads.push({ x: ex, y, z: ez, w: 1.5, h: 0.8, rotY: faceYaw(rx * k, rz * k) });
  }
}
