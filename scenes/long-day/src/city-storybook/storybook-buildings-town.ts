// This file draws the storybook city's pieces (styles.ts, `storybook`) into the city's batches like
// any other city's: its curved, striped, bulging street furniture, trees, buildings and its gate.
// Curves are chains of short cylinders (sbTube), each piece turned half a sector from the last, so
// two pieces in line never share a plane (where they overlap, flat faces in one plane flicker).
// The file imports only geometry, so city.ts and the others can import it at load.
import * as THREE from "three@0.187.0";
import { Batch } from "../geom.ts";
import { BAY, facadeBox, facadePrism } from "../facade.ts";
import { FACADE, FACADE_KINDS } from "../facadetiles.ts";

export type SbP3 = [number, number, number];

// The palette has saturated storybook colours, a warm cream, ink and white for stripes.
export const SB = {
  coral: 0xff5a4e, red: 0xe8333a, pink: 0xff7fb5, magenta: 0xd83a9a, orange: 0xff9a2e, mustard: 0xf2c230,
  butter: 0xfbe58a, lime: 0xa6e05a, mint: 0x5fd3a0, teal: 0x1fb5b0, aqua: 0x6fe0e8, sky: 0x4f9cf0,
  violet: 0x9a6cf0, plum: 0x6a3a9a, cream: 0xfff3dc, white: 0xffffff, ink: 0x2a2440, navy: 0x2b3f8a,
  lamp: 0xffe08a, fluff: 0xfff8ee,
};
export const SB_WALLS = [SB.coral, SB.pink, SB.mustard, SB.mint, SB.teal, SB.violet, SB.aqua, SB.orange, SB.butter, SB.lime, SB.magenta];
export const SB_TRIMS = [SB.cream, SB.white, SB.ink, SB.red, SB.navy, SB.plum];
// The town spends its colour as a picture book does: each building has two candy body colours (SB_BODY
// and the districts' lists, bright enough to stay candy under the facade tiles' shading at street level),
// and the deeper accents (SB_ACCENT) go on
// what should catch the eye: trims, roofs, hats, awnings, doors, pennants and the trees' crowns.
// (storybook-style.ts gives each district its family of bodies.)
export const SB_BODY = { rose: 0xff8fb5, peach: 0xffa860, butter: 0xffd84a, pistachio: 0xa6e05a, seafoam: 0x5fd3a0, powder: 0x7fd0f0, lilac: 0xb48cf0, cream: 0xfbeedd };
export const SB_ACCENT = { red: 0xe8333a, tangerine: 0xff8a1e, gold: 0xf2c230, teal: 0x14a3a0, violet: 0x7a4fd8, magenta: 0xd83a9a, navy: 0x2b3f8a };
export const SB_ACCENTS = Object.values(SB_ACCENT);
export const SB_TUFTS = [SB_ACCENT.red, SB_ACCENT.tangerine, SB_ACCENT.gold, SB_ACCENT.teal, SB_ACCENT.violet, SB_ACCENT.magenta];
// A piece drawn with aux.z = SB_GLOW glows after dark in its own colour (facade.ts): the storybook's lanterns, bulbs and lit glass.
export const SB_GLOW = -6;
// These are the street's colours, laid over city.ts's C while a storybook city is built (setCityStyle).
// (The ground sits below the walls in value, about luma 0.7 to 0.85, so at the board's resolution the
// pavements never outshine the buildings: a dusty rose sidewalk checkered in sand.)
export const SB_STREET = { asphalt: 0x5650a8, sidewalk: 0xf2dcc8, curb: 0xfbeedd, white: 0xfff8ee, yellow: 0xff7fb5, pole: 0x2a2440, lampHead: 0xffe08a, pavers: 0xe8c4c0, plaza: 0xf3dcc8, path: 0xe8c898 };

// sbTube draws a chain of cylinders through `pts`, with r and colour set per piece (by i, and t from 0 to 1
// along it). Pieces overlap a little, so they are open (Batch.tubeSeg draws no end caps and so half the
// triangles), except where the radius steps between pieces, or when `capped` is set (for a spool or a disc,
// whose ends are seen).
const SB_UP = new THREE.Vector3(0, 1, 0), SB_DV = new THREE.Vector3(), SB_Q = new THREE.Quaternion(), SB_E = new THREE.Euler(), SB_Q2 = new THREE.Quaternion();
export function sbTube(b: Batch, pts: SbP3[], r: (i: number, t: number) => number, col: (i: number) => number, seg = 6, spin = 0, capped = false) {
  const R = (i: number) => r(i, i / Math.max(1, pts.length - 2));
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
    SB_DV.set(bx - ax, by - ay, bz - az); const L = SB_DV.length(); if (L < 1e-4) continue;
    // Each piece is turned about its own axis half a sector more than the last, then laid along the chain.
    SB_Q.setFromUnitVectors(SB_UP, SB_DV.normalize()); SB_Q2.setFromAxisAngle(SB_UP, spin + (i % 2) * Math.PI / seg);
    SB_E.setFromQuaternion(SB_Q.multiply(SB_Q2), "XYZ");
    const r0 = R(i), rr = r0 * (i % 2 ? 1.025 : 1);
    const step = (i > 0 && Math.abs(R(i - 1) - r0) > 0.05 * r0) || (i + 2 < pts.length && Math.abs(R(i + 1) - r0) > 0.05 * r0);
    if (capped || step) b.cyl((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, rr, L + rr * 0.3, col(i), seg, SB_E.x, SB_E.z, SB_E.y);
    else b.tubeSeg((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, rr, L + rr * 0.3, col(i), seg, SB_E.x, SB_E.z, SB_E.y);
  }
}
// sbTaper draws a tapered piece from a (radius r0) to b (radius r1) as a smooth open frustum, which is a turned line.
export function sbTaper(b: Batch, a: SbP3, c: SbP3, r0: number, r1: number, color: number, seg = 10, spin = 0) {
  SB_DV.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]); const L = SB_DV.length(); if (L < 1e-4) return;
  SB_Q.setFromUnitVectors(SB_UP, SB_DV.normalize()); SB_Q2.setFromAxisAngle(SB_UP, spin);
  SB_E.setFromQuaternion(SB_Q.multiply(SB_Q2), "XYZ");
  const k = Math.max(0, Math.min(1, Math.round((r1 / r0) * 20) / 20));
  b.lathe(`taper${k}`, [[1, 0], [k, 1]], a[0], a[1], a[2], r0, L, color, seg, SB_E.y, SB_E.x, SB_E.z);
}
// These turned profiles (Batch.lathe takes [radius, height] from the foot up) give smooth shapes for domes,
// bulbs, pom-poms and discs, where an icosahedron's facets read as coarse.
export const SB_ONION: readonly (readonly [number, number])[] = [[0, 0], [0.8, 0.08], [1, 0.32], [0.66, 0.62], [0.2, 0.86], [0, 1]];
export const SB_BULB: readonly (readonly [number, number])[] = [[0, 0], [0.8, 0.12], [1, 0.46], [0.74, 0.86], [0, 1]];
export const SB_PUFF: readonly (readonly [number, number])[] = [[0, 0], [0.8, 0.12], [1, 0.42], [0.9, 0.66], [0.62, 0.9], [0, 1]];
export const SB_LENS: readonly (readonly [number, number])[] = [[0, 0], [1, 0.42], [0.82, 0.8], [0, 1]];
export const sbCurve = (n: number, f: (t: number) => SbP3): SbP3[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));
// sbSpot hashes where something stands into [0, 1), to turn it its own way, pick its colour and so on.
export const sbSpot = (x: number, z: number, k = 0) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };

// ---- street furniture -------------------------------------------------------------------------
// storyLamp draws a shepherd's-crook streetlight: a dark pole curling over at the top toward (hx, hz), with
// its lamp hanging from the crook's end under a little hat of a shade. The lamp's glass glows after dark in
// its own colour (SB_GLOW): butter mostly, a fifth of them pink and a fifth aqua. It returns where its
// light hangs.
export function storyLamp(s: Batch, px: number, pz: number, hx: number, hz: number, y0: number): SbP3 {
  const dx = hx - px, dz = hz - pz, top = y0 + 5.8;
  const k = 1 - Math.cos(Math.PI * 0.95);
  const pts = sbCurve(6, (t): SbP3 => {
    if (t <= 1 / 6) return [px, y0 + t * 6 * (top - y0), pz];
    const a = (t - 1 / 6) / (5 / 6) * Math.PI * 0.95, f = (1 - Math.cos(a)) / k;
    return [px + dx * f, top + Math.sin(a) * 0.9, pz + dz * f];
  });
  sbTube(s, pts, (i) => (i < 1 ? 0.1 : 0.075), () => SB.ink, 5, px * 1.7 + pz);
  const [ex, ey, ez] = pts[pts.length - 1];
  s.cyl(ex, ey - 0.25, ez, 0.03, 0.5, SB.ink, 4);
  s.cone(ex, ey - 0.55, ez, 0.42, 0.36, SB.ink, 7, 0, px + pz);
  const k2 = sbSpot(px, pz, 0x1a3b), glass = k2 < 0.6 ? SB.lamp : k2 < 0.8 ? SB.pink : SB.aqua;
  s.aux.set(0, 0, SB_GLOW); s.ico(ex, ey - 0.86, ez, 0.26, glass, 1.15, px * 0.7 + pz); s.aux.set(0, 0, -1);
  return [ex, ey - 0.9, ez];
}
// bunting hangs bunting across a street. It has two striped poles at the backs of the sidewalks, (ax, az)
// and (bx, bz), and a line sagging between them with pennants hanging from it, well above any truck.
// Between every second pair of pennants a festoon bulb hangs from the line, lamp, pink, aqua and lime
// by turns, and glows after dark in its own colour (SB_GLOW).
export function bunting(s: Batch, ax: number, az: number, bx: number, bz: number, y0: number, salt: number) {
  const H = y0 + 8.6, sag = 1.4, n = Math.max(6, Math.round(Math.hypot(bx - ax, bz - az) / 1.4));
  for (const [x, z] of [[ax, az], [bx, bz]]) {
    sbTube(s, sbCurve(3, (t) => [x, y0 + t * (H - y0 + 0.4), z]), () => 0.09, (i) => (i % 2 ? SB.white : SB.red), 5, x + z);
    s.ico(x, H + 0.55, z, 0.2, SB.mustard, 1, x - z);
  }
  const at = (t: number): SbP3 => [ax + (bx - ax) * t, H - Math.sin(t * Math.PI) * sag, az + (bz - az) * t];
  sbTube(s, sbCurve(Math.ceil(n / 2), at), () => 0.025, () => SB.ink, 3, salt);
  const ux = bx - ax, uz = bz - az, L = Math.hypot(ux, uz) || 1, nx = -uz / L * 0.02, nz = ux / L * 0.02;
  for (let i = 0; i < n; i++) {
    const p = at((i + 0.1) / n), q = at((i + 0.9) / n), c = SB_TUFTS[(i + salt) % SB_TUFTS.length];
    const mx = (p[0] + q[0]) / 2, mz = (p[2] + q[2]) / 2, my = Math.min(p[1], q[1]) - 0.6;
    s.tri(p[0] + nx, p[1], p[2] + nz, q[0] + nx, q[1], q[2] + nz, mx + nx, my, mz + nz, c, [nx, 0, nz]);
    s.tri(p[0] - nx, p[1], p[2] - nz, mx - nx, my, mz - nz, q[0] - nx, q[1], q[2] - nz, c, [-nx, 0, -nz]);
    if (i % 2 && i + 1 < n) { const b = at((i + 1) / n); s.aux.set(0, 0, SB_GLOW); s.ico(b[0], b[1] - 0.17, b[2], 0.15, SB_FESTOON[(i >> 1) % 4], 1, i); s.aux.set(0, 0, -1); }
  }
}
const SB_FESTOON = [SB.lamp, SB.pink, SB.aqua, SB.lime];
// storyGate draws the town gate at (x, z) facing (fx, fz) (along the road). It has two red-and-white
// corkscrew columns either side of the road in, an arch striped teal and white over it, a gold ball on each
// column and a board across the arch's crown. `half` is the distance from the road's middle to each column.
// A tuft tree stands outside each column, and a run of bunting goes out from each column's top to a pole
// in the field. `letter`, when given, places the town's name on each face of the board (city.ts, through
// the plates): at (x, y, z), w by h, facing rotY.
export function storyGate(s: Batch, x: number, z: number, fx: number, fz: number, half: number, y0 = 0,
  letter: ((x: number, y: number, z: number, w: number, h: number, rotY: number) => void) | null = null) {
  const rx = -fz, rz = fx, H = 9.5, rise = 4.2;
  const cols: [number, number][] = [[x - rx * half, z - rz * half], [x + rx * half, z + rz * half]];
  cols.forEach(([cx, cz], k) => {
    s.cyl(cx, y0 + 0.4, cz, 1.3, 0.8, SB.cream, 10, 0, 0, k);
    sbTube(s, sbCurve(18, (t) => [cx + Math.cos(t * 13 + k) * 0.45, y0 + 0.7 + t * (H - 0.7), cz + Math.sin(t * 13 + k) * 0.45]), () => 0.6, (i) => (i % 2 ? SB.white : SB.red), 8, k);
    s.lathe("bulb", SB_BULB, cx, y0 + H - 0.15, cz, 1.05, 2.1, SB.mustard, 16, k * 0.7);
  });
  const arc = sbCurve(20, (t) => [cols[0][0] + (cols[1][0] - cols[0][0]) * t, y0 + H + Math.sin(t * Math.PI) * rise, cols[0][1] + (cols[1][1] - cols[0][1]) * t]);
  sbTube(s, arc, () => 0.5, (i) => (i % 2 ? SB.white : SB.teal), 8, 0.3);
  // the board at the crown is a bright magenta panel framed in butter, on either face
  const yaw = Math.atan2(-rz, rx);
  s.box(x, y0 + H + rise - 1.6, z, 7.6, 2.4, 0.3, SB.butter, yaw);
  s.box(x + fx * 0.17, y0 + H + rise - 1.6, z + fz * 0.17, 7.0, 1.9, 0.06, SB.magenta, yaw);
  s.box(x - fx * 0.17, y0 + H + rise - 1.6, z - fz * 0.17, 7.0, 1.9, 0.06, SB.magenta, yaw);
  if (letter) for (const k of [1, -1]) letter(x + fx * 0.21 * k, y0 + H + rise - 1.6, z + fz * 0.21 * k, 6.6, 0.82, Math.atan2(fx * k, fz * k));
  // (Each column's tree and its run of bunting, out from the road and a little ahead of the gate.)
  for (const k of [-1, 1]) {
    const tx = x + rx * k * (half + 3.4) - fx * 1.5, tz = z + rz * k * (half + 3.4) - fz * 1.5;
    storyTree(s, "tuft", tx, y0, tz, 6.5, 2.1, k < 0 ? SB.orange : SB.pink);
    const [cx, cz] = cols[k < 0 ? 0 : 1];
    bunting(s, cx, cz, x + rx * k * (half + 9) + fx * 1.5, z + rz * k * (half + 9) + fz * 1.5, y0, k < 0 ? 0 : 3);
  }
}

// ---- buildings --------------------------------------------------------------------------------
// Walls are facade tiles (facade.ts facadePrism, facadeBox): windows and doors are paint, not
// geometry, so a storybook building costs about what any city's does. The shape is the thing: round
// pods stacked up a bending spine, crooked shop rows under bell-cast roofs, boarded works under
// striped barrel roofs, and hats. A building has two candy body colours, the second on about half
// its pods or storeys (never the first's), and its trims, roofs and hats carry the saturated accents (SB_ACCENTS).
type SbRand = () => number;
const sbPick = <T,>(r: SbRand, a: readonly T[]) => a[Math.floor(r() * a.length)];
// sbOther picks from `a` anything but `not` (one draw, as sbPick), for a building's second body colour.
const sbOther = <T,>(r: SbRand, a: readonly T[], not: T) => { const i = a.indexOf(not); return a.length < 2 || i < 0 ? sbPick(r, a) : a[(i + 1 + Math.floor(r() * (a.length - 1))) % a.length]; };
const sbClamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
// sbCap lays a flat n-gon (as facadePrism lays one) at height y, facing up (or down, for an overhang's underside).
export function sbCap(s: Batch, cx: number, cz: number, R: number, n: number, rot: number, y: number, color: number, down = false) {
  const step = (2 * Math.PI) / n;
  for (let i = 0; i < n; i++) {
    const a0 = rot + i * step, a1 = a0 + step;
    s.tri(cx, y, cz, cx + R * Math.cos(a0), y, cz + R * Math.sin(a0), cx + R * Math.cos(a1), y, cz + R * Math.sin(a1), color, [0, down ? -1 : 1, 0]);
  }
}
// sbTrim draws the trim round a pod's top, a short n-sided band a little proud of its walls with its sides
// parallel to theirs (CylinderGeometry's corners lie at angle PI/2 - theta, so the band is turned to match).
function sbTrim(s: Batch, cx: number, cz: number, R: number, n: number, rot: number, y: number, color: number) {
  s.cyl(cx, y, cz, R * 1.08, 0.34, color, n, 0, 0, Math.PI / 2 - rot);
}
// A storey's tile (or a pod's): STORYBOOK's windows and STORY_ALT's by turns up a building, so it shows two shapes.
const sbStorey = (tile: number, k: number) => (tile === FACADE.STORYBOOK && k % 2 ? FACADE.STORY_ALT : tile);
const sbBands = (tile: number, k: number, floors: number, floorH: number) => Array.from({ length: floors }, (_, i) => ({ tile: sbStorey(tile, k + i), floors: 1, floorH }));

export interface TowerLook { walls: readonly number[]; roofs: readonly number[]; trims?: readonly number[]; ground: number; upper: number; door?: number; storeys: number }
// storyTower builds a tower of pods on a lot. Its foot is centred on (cx, cz) in the lot's frame (the street
// is at -z), R is the foot's radius measured to its corners, and the tower has `storeys` storeys of facade in
// pods of one or two. The pods above lean off true along a bending spine, each a little wider or narrower
// than the last, within `room` (so they never reach into the neighbours'). Each building's storeys are a few
// cm taller or shorter than its neighbours' (so their trims and roofs never share a plane, which flickers).
// The foot's front side faces the street (-z), and `door` paints a door on it; a shop's foot (`ground`
// STORY_SHOP) paints its door on that side and shop windows on the rest.
// Its `kind` is a stack of round pods, or of square ones each turned off the one below like a pile of
// books, or the town clock (straight, with a clock drum six storeys up and an onion dome), or the Tippy
// Tower (the steepest lean, on two crutches). A third of the towers lean much further than the rest, and
// now and then a thin neck of two storeys carries a fat pod. Where a pod overhangs the foot by more than
// 1.2 m, an ink crutch props it from the foot's roof, and one upper pod in four has a patch nailed on.
// It returns the top's height, the front wall's depth (z) and its pods.
export interface TowerRoom { x: number; zf: number; zb: number }   // these give how far a pod's edge may reach from the foot's middle, either way along the street, toward it and away
export type TowerKind = "pods" | "books" | "clock" | "tippy";
export interface TowerPod { x: number; z: number; y0: number; y1: number; r: number }
// sbFootSides counts the sides of a tower's foot of radius R: as many as leave each 3.2 m wide at least, so
// its front side takes any door (a service door's two leaves too). The count is even, and 6 at least.
export function sbFootSides(R: number) { return Math.max(6, 2 * Math.floor(Math.PI / Math.asin(Math.min(1, 1.6 / R)) / 2)); }
const sbPodSides = (r: number) => (r < 3.2 ? 10 : r < 4.6 ? 12 : 14);
export function storyTower(s: Batch, cx: number, cz: number, R: number, room: TowerRoom, y0: number, look: TowerLook, rnd: SbRand, kind?: TowerKind, avoid?: number): { top: number; front: number; pods: TowerPod[]; jit: number } {
  let n = sbFootSides(R), step = (2 * Math.PI) / n;
  // (The tower leans toward the street or away from it, and a little to one side. Its first four draws
  // are as they were before the kinds came, so its foot's storey, which sets the height of a kerb
  // door made tall over its painted one, stays as the city files have it.)
  const l0 = rnd(), dir = (rnd() < 0.6 ? -Math.PI / 2 : Math.PI / 2) + (rnd() - 0.5) * 0.9, trims = look.trims ?? SB_TRIMS, j0 = (rnd() - 0.5) * 0.12;
  // (A tower beside another on its lot keeps its storeys 2 cm or more off the other's, `avoid`.)
  const jit = avoid !== undefined && Math.abs(j0 - avoid) < 0.02 ? avoid + (j0 < avoid ? -0.02 : 0.02) : j0;
  const k0 = kind ?? (rnd() < 1 / 3 ? "books" : "pods"), books = k0 === "books", clock = k0 === "clock", tippy = k0 === "tippy";
  const lean = tippy ? 3.5 : clock ? 0.12 : rnd() < 1 / 3 ? 1.2 + l0 * 1.2 : 0.4 + l0 * 0.6;
  const wall = sbPick(rnd, look.walls), wall2 = sbOther(rnd, look.walls, wall), roof = sbPick(rnd, look.roofs), trim = [sbPick(rnd, trims), sbPick(rnd, trims)];
  let y = y0, left = look.storeys, k = 0, r = R, px = cx, pz = cz, rot = -Math.PI / 2 - step / 2, prevR = 0, neck = false, twist = 0, drum = !clock;
  const front = cz - R * Math.cos(Math.PI / n), pods: TowerPod[] = [];
  while (left > 0) {
    let fl = k === 0 ? 1 : Math.min(left, rnd() < 0.5 ? 1 : 2);
    const first = k === 0;
    if (!first) {
      // The town clock's drum, six storeys up: a cylinder in cream as wide as the pod under it, with a
      // clock face to the street.
      if (!drum && look.storeys - left >= 6) {
        const dr = Math.min(Math.max(prevR, 2.6), room.x - 0.1);
        if (dr > prevR * 1.05) sbCap(s, px, pz, dr, 16, 0, y, SB.cream, true);
        s.cyl(px, y + 1.9, pz, dr, 3.8, SB.cream, 16);
        sbClockFace(s, px, y + 1.9, pz - dr, Math.min(1.75, dr * 0.6));
        s.cyl(px, y + 3.85, pz, dr * 1.08, 0.3, trim[0], 16);
        y += 4; drum = true; prevR = dr;
      }
      const thin: boolean = !neck && !clock && !books && left >= 3 && k < look.storeys - 2 && rnd() < 0.22;
      r = thin ? Math.min(1.8, room.x - 0.1) : Math.max(1.8, Math.min(room.x - 0.1, R * ((neck ? 0.95 : 0.72) + rnd() * 0.5)));
      if (thin) fl = 2;
      neck = thin;
      const off = lean * k * (0.9 + k * 0.25) + (rnd() - 0.5) * 0.4;
      px = cx + Math.max(-(room.x - r), Math.min(room.x - r, Math.cos(dir) * off));
      pz = cz + Math.max(-(room.zf - r), Math.min(room.zb - r, Math.sin(dir) * off));
      if (books) { n = 4; twist += (rnd() < 0.5 ? -1 : 1) * (0.15 + rnd() * 0.15); rot = -Math.PI / 4 + twist; }
      else { n = sbPodSides(r); rot = -Math.PI / 2 - Math.PI / n + (k % 2) * Math.PI / n; }
      step = (2 * Math.PI) / n;
    }
    const w = first || rnd() > 0.5 ? wall : wall2;
    let bands = first ? [{ tile: look.ground, floors: 1, floorH: 4.2 + jit }] : [{ tile: sbStorey(look.upper, k), floors: fl, floorH: 3.2 }];
    let doorFacet = first && look.door !== undefined ? 0 : -1, doorTile = look.door ?? -1;
    // (A shop's foot: its door on the front side, shop windows round the rest. Where the front side
    // is two bays wide, every side keeps STORY_SHOP's doors, as the kerb's door is found over one.)
    if (first && look.ground === FACADE.STORY_SHOP && Math.round(2 * R * Math.sin(Math.PI / n) / BAY) <= 1) { bands = [{ tile: FACADE.STORY_SHOPWIN, floors: 1, floorH: 4.2 + jit }]; doorFacet = 0; doorTile = FACADE.STORY_SHOP; }
    if (!first && r > prevR * 1.08) sbCap(s, px, pz, r, n, rot, y, w, true);   // this caps an overhang's underside
    const top = facadePrism(s, px, pz, r, n, rot, y, bands, w, doorFacet, doorTile);
    sbTrim(s, px, pz, r, n, rot, top - 0.17, trim[k % 2]);   // (the trim sits no higher than the pod's top, since the next pod's walls start there)
    sbCap(s, px, pz, r, n, rot, top - 0.005, roof);
    if (!first && !neck && rnd() < 0.25) sbPatch(s, px, pz, r, n, rot, y, top - 0.4, w === wall ? wall2 : wall, rnd);
    pods.push({ x: px, z: pz, y0: y, y1: top, r });
    y = top; left -= fl; k++; prevR = r;
  }
  storyHat(s, px, y, pz, r, dir, rnd, clock ? 0 : tippy ? 1 : undefined);
  // The crutches: from the foot's roof up to the underside of the lowest pod that overhangs the foot by
  // more than 1.2 m (and stands a storey or more above it); the Tippy Tower has two, splayed.
  const ux = Math.cos(dir), uz = Math.sin(dir), foot = pods[0];
  const over = pods.find((p, i) => i >= 2 && Math.hypot(p.x - cx, p.z - cz) + p.r - R > 1.2 && p.y0 - foot.y1 > 2.4);
  if (over) for (const sp of tippy ? [-0.5, 0.5] : [0]) {
    const vx = ux * Math.cos(sp) - uz * Math.sin(sp), vz = ux * Math.sin(sp) + uz * Math.cos(sp);
    sbCrutch(s, [cx + vx * R * 0.55, foot.y1, cz + vz * R * 0.55], [over.x + vx * over.r * 0.75, over.y0 - 0.05, over.z + vz * over.r * 0.75]);
  }
  return { top: y, front, pods, jit };
}
// sbCrutch draws a crutch from a (its foot, on a roof) to b (the pod it props): an ink pole bowed a
// little, a pad under its foot and a cup under the pod.
function sbCrutch(s: Batch, a: SbP3, b: SbP3) {
  const pts = sbCurve(3, (t): SbP3 => [a[0] + (b[0] - a[0]) * t + Math.sin(t * Math.PI) * 0.25, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
  sbTube(s, pts, () => 0.18, () => SB.ink, 5, a[0]);
  s.cyl(a[0], a[1] + 0.06, a[2], 0.4, 0.12, SB.ink, 6);
  s.cone(b[0], b[1] - 0.25, b[2], 0.45, 0.5, SB.ink, 6, Math.PI);
}
// sbPatch nails a patch over one side of a pod (n sides, radius r, from y0 to y1): a panel in another
// body colour, tipped off true, 4 cm proud of the wall, with two ink straps across it.
function sbPatch(s: Batch, px: number, pz: number, r: number, n: number, rot: number, y0: number, y1: number, col: number, rnd: SbRand) {
  const i = Math.floor(rnd() * n), a = rot + (i + 0.5) * 2 * Math.PI / n, ap = r * Math.cos(Math.PI / n), w = Math.min(1.2, 2 * r * Math.sin(Math.PI / n) - 0.4);
  if (w < 0.6 || y1 - y0 < 1.2) return;
  const ca = Math.cos(a), sa = Math.sin(a), ry = Math.atan2(ca, sa), tilt = (rnd() - 0.5) * 0.4, y = y0 + (y1 - y0) * (0.35 + rnd() * 0.3);
  s.boxR(px + ca * (ap + 0.04), y, pz + sa * (ap + 0.04), w, 0.9, 0.05, col, 0, ry, tilt);
  for (const d of [-0.3 * w, 0.3 * w]) s.boxR(px + ca * (ap + 0.07) + sa * d * Math.cos(tilt), y + d * Math.sin(tilt), pz + sa * (ap + 0.07) - ca * d * Math.cos(tilt), 0.08, 1.05, 0.03, SB.ink, 0, ry, tilt);
}
// sbClockFace draws a clock face of radius r looking toward -z, its front at (x, y, z): a gold rim, a cream
// face, four ink hour marks and its hands at ten past ten.
function sbClockFace(s: Batch, x: number, y: number, z: number, r: number) {
  s.cyl(x, y, z - 0.05, r + 0.18, 0.14, SB.mustard, 16, Math.PI / 2);
  s.cyl(x, y, z - 0.1, r, 0.1, SB.cream, 16, Math.PI / 2);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; s.box(x + Math.cos(a) * r * 0.8, y + Math.sin(a) * r * 0.8, z - 0.16, 0.16, 0.16, 0.02, SB.ink); }
  s.boxR(x - r * 0.22, y + r * 0.13, z - 0.17, r * 0.55, 0.12, 0.02, SB.ink, 0, 0, -0.52);
  s.boxR(x + r * 0.3, y + r * 0.17, z - 0.18, r * 0.75, 0.08, 0.02, SB.ink, 0, 0, 0.52);
}
// storyHat puts a hat on a tower: a witch's hat bending over (two times in five, and now and then so far
// that its tip droops below its brim), an onion dome with its spike and ball, a curly chimney, or a stack
// of shrinking bulbs. `kind` picks one (0 onion, 1 witch's hat, 2 chimney, 3 bulbs).
export function storyHat(s: Batch, x: number, y: number, z: number, r: number, dir: number, rnd: SbRand, kind?: number) {
  r = Math.min(r * 0.8, 3.4);
  kind ??= [1, 1, 0, 2, 3][Math.floor(rnd() * 5)];
  const c = sbPick(rnd, SB_ACCENTS), c2 = sbPick(rnd, SB_TRIMS), t = x * 1.7 + z;
  if (kind === 0) {   // this is an onion dome, a spike and a gold ball
    s.lathe("onion", SB_ONION, x, y - 0.05, z, r * 1.02, r * 2.1, c, 10, t);
    s.tubeSeg(x, y + r * 2.25, z, 0.06, 0.8, SB.ink, 4, 0, 0, t); s.lathe("bulb", SB_BULB, x, y + r * 2.55, z, 0.32, 0.62, SB.mustard, 8, t);
  } else if (kind === 1) {
    // This is a banded witch's hat, tapering smoothly as it bends over: its spine turns from upright by
    // 0.8 to 2.5 rad toward its tip. (A small one, on an oriel, has fewer and coarser pieces.)
    const L = r * 3, bend = 0.8 + rnd() * 1.7, N = r < 1.5 ? 3 : 4, sg = r < 1.5 ? 6 : 8, pts: SbP3[] = [[x, y + 0.2, z]];
    for (let i = 0; i < N; i++) { const u = (i + 0.5) / N, a = bend * u * u, p = pts[i]; pts.push([p[0] + Math.cos(dir) * Math.sin(a) * L / N, p[1] + Math.cos(a) * L / N, p[2] + Math.sin(dir) * Math.sin(a) * L / N]); }
    const rad = (u: number) => r * (1 - u) * 0.95 + 0.06;
    s.cyl(x, y + 0.12, z, r * 1.15, 0.24, c2, sg + 2, 0, 0, t);
    for (let i = 0; i < N; i++) {
      const p = pts[i], q = pts[i + 1], e: SbP3 = [p[0] + (q[0] - p[0]) * 1.06, p[1] + (q[1] - p[1]) * 1.06, p[2] + (q[2] - p[2]) * 1.06];
      sbTaper(s, p, e, rad(i / N), rad((i + 1.06) / N), i % 2 ? c : c2, sg, t + i * 0.31);
    }
    s.lathe("bulb", SB_BULB, ...pts[N], 0.16, 0.3, SB.mustard, 6, t);
  } else if (kind === 2) {   // this is a curly chimney
    s.cyl(x, y + 0.2, z, r * 0.85, 0.4, c2, 12, 0, 0, t);
    const pts = sbCurve(9, (u) => [x + Math.cos(u * 8 + dir) * r * 0.35 * (1 - u * 0.5), y + 0.4 + u * r * 2.3, z + Math.sin(u * 8 + dir) * r * 0.35 * (1 - u * 0.5)]);
    sbTube(s, pts, () => 0.28, (i) => (i % 3 ? c : SB.ink), 6, t);
    const e = pts[pts.length - 1]; s.cone(e[0], e[1] + 0.3, e[2], 0.5, 0.6, SB.ink, 8, Math.PI, t);
  } else {   // this is a stack of shrinking bulbs and a spike
    let yy = y - 0.05, rr = r * 0.8;
    for (let i = 0; i < 3; i++) { s.lathe("bulb", SB_BULB, x + Math.sin(i * 1.7 + t) * 0.3, yy, z, rr, rr * 1.3, i % 2 ? c : c2, 9, t + i); yy += rr * 1.18; rr *= 0.66; }
    s.cone(x, yy + 0.5, z, 0.15, 1.2, SB.ink, 5, 0, t);
  }
}
// sbBellRoof draws a bell-cast gable over x0..x1 by z0..z1 from y, its ridge along x: each slope a steep
// upper slab (0.9 rad) and a shallow lower one (0.45 rad) that flares 0.6 m past the eave, its ridge
// sagging 0.25 m in the middle where `sag` is set (each upper slab two halves, tipped), and its gable
// ends in `end`. It returns the ridge's height.
export function sbBellRoof(s: Batch, x0: number, z0: number, x1: number, z1: number, y: number, roof: number, end: number, sag = false): number {
  const w = x1 - x0 + 0.5, hd = (z1 - z0) / 2, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, flare = 0.6, a1 = 0.45, a2 = 0.9;
  const L1 = 0.45 * hd + flare, L2 = hd + flare - L1, yT = y + 0.12 - flare * Math.tan(a1), yB = yT + L1 * Math.tan(a1), yR = yB + L2 * Math.tan(a2);
  const tip = Math.min(0.08, 0.25 / (w / 2));
  for (const sg of [-1, 1]) {
    s.boxR(cx, (yT + yB) / 2, cz + sg * (hd + flare - L1 / 2), w, 0.14, L1 / Math.cos(a1) + 0.05, roof, sg * a1, 0, 0);
    if (sag) for (const h of [-1, 1]) s.boxR(cx + h * w / 4, (yB + yR) / 2 + (h > 0 ? 0.015 : 0), cz + sg * L2 / 2, w / 2, 0.14, L2 / Math.cos(a2) + 0.12, roof, sg * a2, 0, h * tip);
    else s.boxR(cx, (yB + yR) / 2, cz + sg * L2 / 2, w, 0.14, L2 / Math.cos(a2) + 0.12, roof, sg * a2, 0, 0);
  }
  // the gable ends, a fan under the slabs at either end
  const prof: [number, number][] = [[-hd, y], [-hd, y + 0.05], [-L2, yB - 0.1], [0, yR - 0.12], [L2, yB - 0.1], [hd, y + 0.05], [hd, y]];
  for (const [ex, sx] of [[x0, -1], [x1, 1]] as const) for (let i = 1; i + 1 < prof.length; i++)
    s.tri(ex, y, cz, ex, prof[i][1], cz + prof[i][0], ex, prof[i + 1][1], cz + prof[i + 1][0], end, [sx, 0, 0]);
  return yR;
}
// sbDormer puts a dormer on a roof's front slope: a box w wide with a window (its front at zf, its foot at
// y, its back at zb) under a little gable of its own facing the street.
function sbDormer(s: Batch, x: number, zf: number, zb: number, y: number, w: number, wall: number, roof: number) {
  const top = facadeBox(s, x - w / 2, zf, x + w / 2, zb, y, [{ tile: FACADE.STORYBOOK, floors: 1, floorH: 1.6 }], wall);
  s.prism(x, top + 0.4, (zf + zb) / 2 - 0.1, zb - zf + 0.4, 0.8, w + 0.4, roof, Math.PI / 2);
}
// storyShopRow builds a crooked row building on a lot b (x0..x1 along the street, z0..z1 in from it, street
// at -z). Its storeys stack each a little off the last, wider or narrower, and it has a scalloped awning over
// its shop front (its door in the bay where the kerb's door is found, city.ts kerbDoors, and windows in
// the rest), a bell-cast roof with perhaps a dormer, and one row in three a round oriel at one end under
// a witch's hat. It returns its top.
export function storyShopRow(s: Batch, b: { x0: number; z0: number; x1: number; z1: number }, y0: number, storeys: number, look: TowerLook, rnd: SbRand): number {
  const w = b.x1 - b.x0, d = b.z1 - b.z0, mid = (b.x0 + b.x1) / 2, jit = (rnd() - 0.5) * 0.12;
  const wall = sbPick(rnd, look.walls), wall2 = sbOther(rnd, look.walls, wall), roof = sbPick(rnd, look.roofs), trim = sbPick(rnd, SB_TRIMS);
  // (The door's bay, counted from x1 as the front wall runs: the one whose painted door is nearest the
  // bay line kerbDoors starts from, round(bays / 2) bays from x0.)
  const bays = Math.max(1, Math.round(w / BAY)), db = Math.max(0, bays - Math.round(bays / 2) - 1);
  const shop = look.ground === FACADE.STORY_SHOP, gt = shop ? FACADE.STORY_SHOPWIN : look.ground;
  let y = facadeBox(s, b.x0, b.z0, b.x1, b.z1, y0, [{ tile: gt, floors: 1, floorH: 4.2 + jit }], wall, shop ? 2 : -1, shop ? FACADE.STORY_SHOP : -1, db);
  s.box(mid, y - 0.15, (b.z0 + b.z1) / 2, w + 0.24, 0.3, d + 0.3, trim);
  let shift = 0, ww = w, z0 = b.z0, z1 = b.z1, x0 = b.x0, x1 = b.x1;
  for (let k = 1; k < storeys; k++) {
    shift += (rnd() - 0.5) * 1.4; ww = Math.max(Math.min(4.5, w), Math.min(w - 0.4, ww * (0.82 + rnd() * 0.3)));
    shift = Math.max(-(w - ww) / 2 + 0.2, Math.min((w - ww) / 2 - 0.2, shift));   // (the storey stays within its lot, since its neighbours' walls are 0.6 m off)
    const dz = (rnd() - 0.5) * 0.6;
    x0 = mid + shift - ww / 2; x1 = mid + shift + ww / 2; z0 = b.z0 + 0.3 + Math.max(0, dz); z1 = b.z1 - 0.3;
    const top = facadeBox(s, x0, z0, x1, z1, y, [{ tile: sbStorey(look.upper, k), floors: 1, floorH: 3.2 }], rnd() < 0.5 ? wall2 : wall);
    s.box((x0 + x1) / 2, top - 0.13, (z0 + z1) / 2, ww + 0.24, 0.26, z1 - z0 + 0.3, trim);   // (the trim sits no higher than the storey's top, since the next one's walls start there)
    y = top;
  }
  // the roof: bell-cast over the top storey, a dormer on its front slope where it is deep enough, and a chimney
  // (Over the storey's front 7.5 m at most: a deeper storey's back keeps its flat lid, the trim.)
  const rz1 = Math.min(z1, z0 + 7.5), hd = (rz1 - z0) / 2, rc = (z0 + rz1) / 2, ridge = sbBellRoof(s, x0, z0, x1, rz1, y, roof, wall, true);
  if (hd >= 2.8 && x1 - x0 >= 5 && rnd() < 0.6) sbDormer(s, (x0 + x1) / 2 + (rnd() - 0.5) * (x1 - x0 - 3.5), rc - 0.55 * hd, rc - 0.55 * hd + 1.3, y + 0.75, 2, wall, roof);
  sbTube(s, sbCurve(3, (u) => [x1 - 1.2 + Math.sin(u * 3) * 0.3, ridge - 1.6 + u * 3.2, rc + 0.6 * hd]), () => 0.3, (i) => (i % 2 ? SB.ink : SB.red), 6, x0);
  // the oriel: a round bay two storeys tall off one end of the front, from the first floor up, on a corbel
  if (storeys >= 2 && w >= 7 && rnd() < 1 / 3) {
    const ox = rnd() < 0.5 ? b.x0 + 1.75 : b.x1 - 1.75, oz = b.z0 + 0.25, yb = y0 + 4.2 + jit + 0.3, n = 8, rot = -Math.PI / 2 - Math.PI / n;
    s.cone(ox, yb - 0.45, oz, 1.6, 0.9, trim, n, Math.PI, Math.PI / 2 - rot);
    const ot = facadePrism(s, ox, oz, 1.6, n, rot, yb, sbBands(look.upper, 1, 2, 3.0), wall2);
    sbTrim(s, ox, oz, 1.6, n, rot, ot - 0.17, trim);
    sbCap(s, ox, oz, 1.6, n, rot, ot - 0.005, roof);
    storyHat(s, ox, ot, oz, 1.6, -Math.PI / 2 + (rnd() - 0.5), rnd, 1);
  }
  // the scalloped awning over the shop front is a sloping striped board and a row of hanging points
  const ac = sbPick(rnd, [SB.red, SB_ACCENT.teal, SB_ACCENT.violet, SB_ACCENT.tangerine]), ns = Math.max(4, Math.round(w / 1.5));
  for (let i = 0; i < ns; i++) {
    const u = b.x0 + (i + 0.5) * w / ns, c = i % 2 ? SB.white : ac;
    s.boxR(u, y0 + 3.45 + jit, b.z0 - 0.75, w / ns - 0.004, 0.07, 1.55, c, -0.32, 0, 0);   // (the strips sit a hair apart, because when they overlapped, their tops shared a plane)
    s.cone(u, y0 + 2.98 + jit, b.z0 - 1.5, w / ns / 2 - 0.02, 0.34, c, 5, Math.PI, i * 0.3);
  }
  return Math.max(y, ridge);
}
// storyHouse builds a house: a squat pod of one or two storeys with its door (painted, on the front side) and
// a hat, or a crooked house under a bell-cast roof with a dormer. It sits in the lot's frame (street at -z),
// centred on (cx, cz), with R its radius. It returns its front wall's depth, the span of that wall its door
// is painted in, and its top.
export function storyHouse(s: Batch, cx: number, cz: number, R: number, y0: number, look: TowerLook, rnd: SbRand): { front: number; door: [number, number]; top: number } {
  if (rnd() < 0.6) {
    const t = storyTower(s, cx, cz, R, { x: R + 0.3, zf: R, zb: R + 1.5 }, y0, { ...look, storeys: rnd() < 0.5 ? 1 : 2 }, rnd, "pods");
    return { front: t.front, door: [cx - 0.5, cx + 0.5], top: t.top };
  }
  const w = R * 1.9, d = R * 1.7, x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, wall = sbPick(rnd, look.walls);
  const floors = rnd() < 0.5 ? 1 : 2, fh = 3.1 + (rnd() - 0.5) * 0.12;
  const top = facadeBox(s, x0, z0, x1, z1, y0, sbBands(look.upper, 0, floors, fh), wall, 2, look.door ?? -1);
  // the roof is bell-cast, its ridge sagging, with a dormer on the front slope and a corkscrew chimney
  const roof = sbPick(rnd, look.roofs), ridge = sbBellRoof(s, x0 - 0.3, z0 - 0.3, x1 + 0.3, z1 + 0.3, top, roof, wall);
  sbDormer(s, cx + (rnd() - 0.5) * (w - 2.6), cz - d * 0.22, cz - 0.15, top + 0.55, 1.8, wall, roof);
  sbTube(s, sbCurve(4, (u) => [x1 - 1 + Math.cos(u * 7) * 0.3, ridge - 1.6 + u * 3.2, z1 - 1.2 + Math.sin(u * 7) * 0.3]), () => 0.26, (i) => (i % 2 ? SB.cream : SB.red), 6, cx);
  return { front: z0, door: [x0, x1], top: ridge };
}

// ---- lots -------------------------------------------------------------------------------------
// The storybook city's districts' walls and roofs (storybook-style.ts), as storyLotBuilding takes them.
export interface StoryLooks { walls: { downtown: readonly number[]; commercial: readonly number[]; residential: readonly number[]; industrial: readonly number[] }; roofs: readonly number[]; gables: readonly number[]; maxShopFloors: number }
type SbRect = { x0: number; z0: number; x1: number; z1: number };
// storyLotBuilding builds a lot's buildings on b (in its face's frame, the street at -z, the ground at y0)
// by its district: downtown a bent tower or two of pods in hats (two on a wide lot, joined by a sky
// bridge), shops in crooked rows (now and then a short tower), and houses as squat pods or crooked
// houses set back behind their front gardens. `clock` makes it the town clock (one lot facing the
// plaza), `tippy` the Tippy Tower. `door` records the front door for city.ts kerbDoors (x0..x1 the wall
// it is in, n its depth). It returns where a house's tree goes, behind it, or null.
export function storyLotBuilding(s: Batch, b: SbRect, y0: number, district: string, hs: number, L: StoryLooks, rnd: SbRand,
                                 door: (x0: number, x1: number, n: number, painted?: boolean) => void, opt: { clock?: boolean; tippy?: boolean } = {}): [number, number] | null {
  const w = b.x1 - b.x0, d = b.z1 - b.z0, range = (lo: number, hi: number) => lo + (hi - lo) * rnd(), irange = (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * rnd());
  if (district === "downtown" || (district === "commercial" && rnd() < 0.3)) {
    const two = !opt.clock && w > 1.7 * d, cw = two ? w / 2 : w, R = Math.max(2.4, Math.min(cw / 2, d / 2) - 0.4), n = sbFootSides(R);
    const look = { walls: district === "downtown" ? L.walls.downtown : L.walls.commercial, roofs: L.roofs, ground: FACADE.STORY_SHOP, upper: FACADE.STORYBOOK, storeys: 0 };
    const pods: TowerPod[][] = [];
    let jit: number | undefined;
    for (let k = 0; k < (two ? 2 : 1); k++) {
      const cx = two ? b.x0 + cw * (k + 0.5) : (b.x0 + b.x1) / 2, cz = b.z0 + R * Math.cos(Math.PI / n);
      const storeys = opt.clock ? irange(9, 11) : district === "downtown" ? Math.max(3, Math.min(9, Math.round(3 + hs * range(2, 9)))) : irange(2, 3);
      const kind: TowerKind | undefined = opt.clock ? "clock" : opt.tippy && k === 0 ? "tippy" : undefined;
      const t = storyTower(s, cx, cz, R, { x: cw / 2 - 0.55, zf: R + 1.2, zb: d - R - 0.5 }, y0, { ...look, storeys }, rnd, kind, jit);   // (its trims stay clear of the next lot's, the other tower's, or those of the lot behind)
      pods.push(t.pods); jit = t.jit;
      if (k === 0) door(cx - 0.5, cx + 0.5, b.z0);
    }
    if (two) sbSkyBridge(s, pods[0], pods[1], y0 + 4.2 + 3.2 * irange(2, 3) - 1.6, rnd);
    return null;
  }
  if (district === "commercial") {
    door(b.x0, b.x1, b.z0);
    storyShopRow(s, b, y0, Math.min(L.maxShopFloors, irange(1, 3)), { walls: L.walls.commercial, roofs: L.roofs, ground: FACADE.STORY_SHOP, upper: FACADE.STORYBOOK, storeys: 0 }, rnd);
    return null;
  }
  // a house is set back behind its front garden, with its tree behind it
  const h: SbRect = { x0: b.x0 + 0.8, z0: b.z0 + range(2.2, 3.2), x1: b.x1 - 0.8, z1: Math.min(b.z1, b.z0 + 10) };
  const R = Math.max(2.6, Math.min((h.x1 - h.x0) / 2, (h.z1 - h.z0) / 2) - 0.2), cx = (h.x0 + h.x1) / 2, cz = h.z0 + R;
  const r = storyHouse(s, cx, cz, R, y0, { walls: L.walls.residential, roofs: L.gables, ground: FACADE.STORYBOOK, upper: FACADE.STORYBOOK, door: FACADE.STORY_DOOR, storeys: 0 }, rnd);
  door(r.door[0], r.door[1], r.front, true);
  return [cx, cz + R + 2.8];
}
// sbSkyBridge joins two towers (their pods) at height y with a covered bridge: a fat striped tube from
// the middle of one's pod there to the other's, arching 1.2 m up between them. Where either tower is
// too short, there is none.
function sbSkyBridge(s: Batch, a: TowerPod[], b: TowerPod[], y: number, rnd: SbRand) {
  const pa = a.find((p) => p.y0 <= y - 1 && p.y1 >= y + 1), pb = b.find((p) => p.y0 <= y - 1 && p.y1 >= y + 1);
  if (!pa || !pb) return;
  const c = sbPick(rnd, SB_ACCENTS);
  sbTube(s, sbCurve(7, (t): SbP3 => [pa.x + (pb.x - pa.x) * t, y + Math.sin(t * Math.PI) * 1.2, pa.z + (pb.z - pa.z) * t]), () => 0.9, (i) => (i % 2 ? SB.cream : c), 8, pa.x);
}
// sbArch lays a round-topped panel flat on a wall facing -z, its front at z: x - hw..x + hw wide from y0 up
// to y1, then a half ellipse `rise` high over it. (Front faces only: it lies on the wall.)
function sbArch(s: Batch, x: number, z: number, y0: number, y1: number, hw: number, rise: number, color: number, tagged = false) {
  const F: [number, number, number] = [0, 0, -1];
  s.tri(x - hw, y0, z, x + hw, y0, z, x + hw, y1, z, color, F, tagged); s.tri(x - hw, y0, z, x + hw, y1, z, x - hw, y1, z, color, F, tagged);
  if (rise <= 0.01) return;
  const N = 6;
  for (let i = 0; i < N; i++) {
    const t0 = Math.PI * i / N, t1 = Math.PI * (i + 1) / N;
    s.tri(x, y1, z, x + hw * Math.cos(t0), y1 + rise * Math.sin(t0), z, x + hw * Math.cos(t1), y1 + rise * Math.sin(t1), z, color, F, tagged);
  }
}

// ---- the works, its yards and the parks' pavilions ---------------------------------------------
// storyWorks builds an industrial building on b (in its face's frame, the street at -z): one boarded
// storey 6 to 8 m high (floorH, from the recipe) in STORY_WORKS's tile, in one of the district's candy
// bodies, under a striped barrel roof along the street that sags in the middle, or on a wide, deep lot
// (two in five of them) a sawtooth of three or four gables, each tipped and in its two colours by turns. On a lot
// three bays wide or more it has a round-topped barn door in its end bay away from the kerb's door
// (city.ts records that door, round(bays / 2) bays from x0), one lot in three a bulging silo leaning at
// the back, and a curly chimney (storyWorkshop). It returns its walls' top.
export function storyWorks(s: Batch, b: SbRect, y0: number, floorH: number, walls: readonly number[], rnd: SbRand): number {
  const w = b.x1 - b.x0, d = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, H = sbClamp(floorH, 6, 8);
  const wall = sbPick(rnd, walls), ra = sbPick(rnd, [SB.red, SB_ACCENT.teal, SB_ACCENT.violet, SB_ACCENT.tangerine]), rb = sbPick(rnd, [SB.cream, SB.white, SB.mustard]), trim = sbPick(rnd, SB_TRIMS);
  const top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, y0, [{ tile: FACADE.STORY_WORKS, floors: 2, floorH: H / 2 }], wall);
  s.box(cx, top - 0.15, cz, w + 0.24, 0.3, d + 0.24, trim);   // the eaves' trim, and the lid under the roof
  if (w >= 18 && d >= 12 && rnd() < 0.4) {
    // the sawtooth: gables across the lot, their ends to the street, each a little higher than the last
    const n = w >= 24 ? 4 : 3, tw = w / n;
    for (let i = 0; i < n; i++) { const hh = 2.2 + rnd() * 0.6; s.prism(b.x0 + tw * (i + 0.5), top + hh / 2 + i * 0.07, cz, d + 0.5, hh, tw + 0.3, i % 2 ? rb : ra, Math.PI / 2 + (rnd() - 0.5) * 0.12); }
  } else {
    // the barrel: five staves on an arc rising 30% of the depth, by turns in two colours, the middle
    // stave lowered 0.2 m (it sags), and the barrel's ends filled in the wall's colour
    const c = d / 2 + 0.3, h = sbClamp(0.3 * d, 1.5, 4), Rb = (c * c + h * h) / (2 * h), phi = Math.asin(Math.min(1, c / Rb)), yc = top + h - Rb, N = 5;
    const chord = 2 * Rb * Math.sin(phi / N) + 0.05, pts: [number, number][] = [];
    for (let i = 0; i < N; i++) { const a = -phi + (i + 0.5) * 2 * phi / N; s.boxR(cx, yc + Rb * Math.cos(a) - (i === 2 ? 0.2 : 0), cz + Rb * Math.sin(a), w + 0.6, 0.16, chord, i % 2 ? rb : ra, a, 0, 0); }
    for (let i = 0; i <= N; i++) { const a = -phi + i * 2 * phi / N; pts.push([cz + Rb * Math.sin(a), yc + Rb * Math.cos(a) - 0.12]); }
    for (const [ex, sx] of [[b.x0, -1], [b.x1, 1]] as const) for (let i = 0; i < N; i++) s.tri(ex, top, cz, ex, pts[i][1], pts[i][0], ex, pts[i + 1][1], pts[i + 1][0], wall, [sx, 0, 0]);
  }
  // the barn door, in the end bay at x0
  const bays = Math.max(1, Math.round(w / BAY));
  if (bays >= 3) {
    const bx = b.x0 + w * 0.5 / bays, hw = Math.min(1.4, w / bays / 2 - 0.3), dc = sbPick(rnd, [SB.red, SB_ACCENT.teal, SB_ACCENT.navy, SB_ACCENT.violet]);
    sbArch(s, bx, b.z0 - 0.02, y0, y0 + 3.2, hw + 0.18, hw + 0.18, trim);
    sbArch(s, bx, b.z0 - 0.04, y0, y0 + 3.2, hw, hw, dc);
    const L = Math.hypot(2 * hw, 3.2), ang = Math.atan2(3.2, 2 * hw);
    s.boxR(bx, y0 + 1.6, b.z0 - 0.05, L - 0.2, 0.16, 0.02, SB.cream, 0, 0, ang);   // its brace, a Z's diagonal
    s.box(bx, y0 + 3.2 + hw * 0.45, b.z0 - 0.05, 0.06, hw * 0.9, 0.02, SB.cream);   // and the line between its leaves' tops
  }
  // a silo, one lot in three, at the back of the x0 end, leaning
  if (d >= 9 && w >= 8 && rnd() < 1 / 3) {
    const sx = b.x0 + 3, sz = b.z1 - 2.8, lx = (rnd() - 0.5) * 0.2, lz = (rnd() - 0.5) * 0.2, sh = 9, col = sbPick(rnd, [SB.cream, SB_BODY.butter, SB_BODY.seafoam, SB_BODY.peach]);
    const at = (u: number): SbP3 => [sx - Math.sin(lx) * sh * u, y0 + 1.5 + sh * u, sz + Math.sin(lz) * sh * u];
    s.lathe("bulb", SB_BULB, sx, y0 + 1.5, sz, 2.4, sh, col, 10, 0, lz, lx);
    for (const [u, rr] of [[0.3, 2.22], [0.62, 2.2]]) s.tubeSeg(...at(u), rr, 0.4, ra, 10, lz, lx);
    s.cone(...at(1.02), 0.5, 0.8, SB.ink, 6, lz, 0, lx);
  }
  storyWorkshop(s, b, top, rnd);
  return top;
}
// storyYard dresses an industrial yard w by d (centred on its frame's origin) in place of another city's
// containers: in cells of about 3.4 by 3.1 m (a quarter left bare), a pyramid of barrels on their sides,
// each turned a little; a pair of giant spools lying down; a lopsided tower of crates; or giant yarn
// bales tied with ribbon. Six cells at most.
export function storyYard(s: Batch, w: number, d: number, y0: number, rnd: SbRand) {
  const nx = Math.max(1, Math.floor(w / 3.4)), nz = Math.max(1, Math.floor(d / 3.1)), cw = w / nx, cd = d / nz;
  let n = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (rnd() < 0.25 || n >= 6) continue;
    n++;
    const x = -w / 2 + (i + 0.5) * cw, z = -d / 2 + (j + 0.5) * cd, k = rnd(), c = sbPick(rnd, SB_ACCENTS);
    if (k < 0.3) {   // barrels on their sides, three, two and one
      for (let row = 0, m = 0; row < 3; row++) for (let q = 0; q < 3 - row; q++, m++)
        s.cyl(x - (2 - row) * 0.62 + q * 1.24, y0 + 0.6 + row * 1.04, z, 0.6, 1.3, m % 2 ? c : SB_BODY.peach, 6, Math.PI / 2, 0, (rnd() - 0.5) * 0.3);
    } else if (k < 0.55) {   // spools, lying down
      for (const dz of [-0.75, 0.75]) {
        s.cyl(x, y0 + 1.0, z + dz - 0.28, 1.0, 0.14, SB.cream, 8, Math.PI / 2); s.cyl(x, y0 + 1.0, z + dz + 0.28, 1.0, 0.14, SB.cream, 8, Math.PI / 2);
        s.tubeSeg(x, y0 + 1.0, z + dz, 0.75, 0.46, dz < 0 ? c : SB_ACCENT.magenta, 8, Math.PI / 2);
      }
    } else if (k < 0.8) {   // crates, stacked and leaning
      let yy = y0, lean = 0;
      for (let q = 0; q < 4; q++) { const sz = 1.3 - q * 0.12; lean += (rnd() - 0.5) * 0.3; s.box(x + lean, yy + sz / 2, z, sz, sz, sz, q % 2 ? SB_BODY.butter : c, (rnd() - 0.5) * 0.5); yy += sz; }
    } else {   // yarn bales, each round with a ribbon
      for (let q = 0; q < 3; q++) { const bx = x - 0.9 + q * 0.9, bz = z + (q % 2 ? 0.6 : -0.4), col = sbPick(rnd, SB_ACCENTS); s.ico(bx, y0 + 0.7, bz, 0.75, col, 0.95, q); s.box(bx, y0 + 0.7, bz, 0.16, 1.45, 1.46, SB.cream, q); }
    }
  }
}
// storyPavilion builds a park's pavilion on lot b, its front facing the street (-z) with its middle at x
// (where city.ts records its door): half are a carousel kiosk, an eight-sided booth of shop windows under a
// cone roof striped in cream and an accent, its eave scalloped, with a pennant on top; half a toadstool, a
// fat round stem with portholes under a wide spotted cap.
export function storyPavilion(s: Batch, b: SbRect, x: number, y0: number, wall: number, rnd: SbRand) {
  const n = 8, step = (2 * Math.PI) / n, rot = -Math.PI / 2 - step / 2, c = sbPick(rnd, SB_ACCENTS);
  if (rnd() < 0.5) {
    const R = sbClamp(Math.min(b.x1 - b.x0, b.z1 - b.z0) / 2 - 0.2, 2.2, 2.8), cz = b.z0 + R * Math.cos(Math.PI / n);
    const top = facadePrism(s, x, cz, R, n, rot, y0, [{ tile: FACADE.STORY_SHOPWIN, floors: 1, floorH: 3.1 }], wall);
    sbTrim(s, x, cz, R, n, rot, top - 0.17, SB.cream);
    const RR = R + 0.7, H = 2.6, ap: SbP3 = [x, top + H, cz];
    for (let i = 0; i < n; i++) {
      const a0 = rot + i * step, a1 = a0 + step, am = a0 + step / 2;
      s.tri(...ap, x + RR * Math.cos(a1), top, cz + RR * Math.sin(a1), x + RR * Math.cos(a0), top, cz + RR * Math.sin(a0), i % 2 ? SB.cream : c, [Math.cos(am), 0.6, Math.sin(am)]);
      s.cone(x + RR * Math.cos(am) * 0.95, top - 0.2, cz + RR * Math.sin(am) * 0.95, 0.42, 0.4, i % 2 ? c : SB.cream, 5, Math.PI, am);
    }
    sbCap(s, x, cz, RR, n, rot, top + 0.01, SB.cream, true);
    s.cyl(x, top + H + 0.5, cz, 0.04, 1.1, SB.ink, 4);
    s.tri(x, top + H + 1.0, cz, x, top + H + 0.6, cz, x + 0.7, top + H + 0.85, cz + 0.1, sbPick(rnd, SB_ACCENTS), [0, 0, -1]);
    s.tri(x, top + H + 1.0, cz, x + 0.7, top + H + 0.85, cz + 0.1, x, top + H + 0.6, cz, SB.cream, [0, 0, 1]);
    return;
  }
  const R = 1.9, cz = b.z0 + R * Math.cos(Math.PI / n);
  const top = facadePrism(s, x, cz, R, n, rot, y0, [{ tile: FACADE.STORYBOOK, floors: 1, floorH: 3.2 }], SB.cream);
  const CR = 3.6, ch = 2.1, cy = top - 0.5;
  s.lathe("lens", SB_LENS, x, cy, cz, CR, ch, c, 10, x);
  for (let i = 0; i < 5; i++) { const a = x + i * 1.26, rr = CR * (i ? 0.6 : 0), yy = cy + ch * (i ? 0.84 : 1); s.ico(x + Math.cos(a) * rr, yy, cz + Math.sin(a) * rr, i ? 0.42 : 0.5, SB.cream, 0.5, a); }
}
// storyGarden fences a house's back garden (a0, n0)-(a1, n1) in its face's frame on three sides with a
// cream picket fence in runs about 2.4 m long, each run's palings leaning their own way (the tile's
// variant, STORY_PICKET) and each run a few cm higher or lower and in or out than the last, as if put
// up by hand. A garden with a shed (`shed`, its colour) has a pod shed in its back corner.
export function storyGarden(s: Batch, a0: number, n0: number, a1: number, n1: number, y0: number, shed: number | undefined, rnd: SbRand) {
  sbPickets(s, a0, n1, a0, n0, y0, rnd); sbPickets(s, a1, n0, a1, n1, y0, rnd); sbPickets(s, a1, n1, a0, n1, y0, rnd);
  if (shed !== undefined) storyShed(s, a1 - 1.6, y0, n1 - 1.5, shed, rnd);
}
// (A fence from a to b: its runs are wall quads both ways, 1.1 m tall, a tile to 1.2 m.)
function sbPickets(s: Batch, ax: number, az: number, bx: number, bz: number, y0: number, rnd: SbRand) {
  const L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L, runs = Math.max(1, Math.round(L / 2.4)), rl = L / runs;
  for (let k = 0; k < runs; k++) {
    const o = (k % 2 ? 1 : -1) * 0.03, nx = -uz * o, nz = ux * o, p0 = k * rl + 0.02, p1 = (k + 1) * rl - 0.02, h = 1.05 + rnd() * 0.12;
    const x0 = ax + ux * p0 + nx, z0 = az + uz * p0 + nz, x1 = ax + ux * p1 + nx, z1 = az + uz * p1 + nz, tile = FACADE.STORY_PICKET + FACADE_KINDS * Math.floor(rnd() * 4), u = (p1 - p0) / 1.2;
    s.wall(x0, z0, x1, z1, y0, y0 + h, SB.cream, tile, 0, u, 0, 1); s.wall(x1, z1, x0, z0, y0, y0 + h, SB.cream, tile, 0, u, 0, 1);
  }
}
// storyShed draws a garden's pod shed at (x, z): a round hut 1.1 m across and 2.2 m tall in `wall` under a
// cone hat in an accent, its round-topped door to -z.
export function storyShed(s: Batch, x: number, y0: number, z: number, wall: number, rnd: SbRand) {
  s.cyl(x, y0 + 1.1, z, 1.1, 2.2, wall, 8, 0, 0, Math.PI / 8);
  s.cone(x, y0 + 2.7, z, 1.45, 1.4, sbPick(rnd, SB_ACCENTS), 8, 0, (rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.2);
  sbArch(s, x, z - 1.03, y0, y0 + 1.3, 0.38, 0.38, SB_ACCENT.navy);
}

// ---- kerb doors -------------------------------------------------------------------------------
// storyKerbDoor draws a trade's front door the storybook way (city.ts entranceDoor), on a wall facing -z
// whose face is at z, the door's middle at x: a round-topped frame in cream or ink, the door's panel (its
// colour, so it matches the leaf FrontDoorFx swings open) with a porthole in it (one in each leaf of a wide
// door), a fanlight glowing after dark in the arch over it, a cream step, and a lantern
// beside it. The arch keeps under a shop row's awning, 3.45 m up.
export function storyKerbDoor(s: Batch, x: number, z: number, y0: number, half: number, h: number, panel: number, frame: number, wide: boolean) {
  const rise = sbClamp(3.4 - h, 0, half), fc = ((frame >> 16) & 255) > 0xa0 ? SB.cream : SB.ink;
  s.span(x - half - 0.12, y0, z - 0.06, x + half + 0.12, y0 + h + 0.05, z + 0.01, fc);   // (its top over the panel's: shared planes flicker)
  sbArch(s, x, z - 0.065, y0 + h, y0 + h + 0.05, half + 0.12, rise + 0.08, fc);
  s.span(x - half, y0, z - 0.09, x + half, y0 + h, z - 0.05, panel);
  s.aux.set(0, 0, SB_GLOW); sbArch(s, x, z - 0.075, y0 + h - 0.01, y0 + h, half - 0.04, rise - 0.04, SB.lamp, true); s.aux.set(0, 0, -1);
  for (const px of wide ? [x - half / 2, x + half / 2] : [x]) { sbDisc(s, px, y0 + 1.6, z - 0.1, 0.24, SB.mustard); sbDisc(s, px, y0 + 1.6, z - 0.11, 0.17, 0x2a3644); }
  if (!wide) s.span(x - half - 0.25, 0, z - 0.5, x + half + 0.25, y0 + 0.03, z, SB.cream);
  const lx = x + half + 0.4;
  s.box(lx, y0 + h - 0.1, z - 0.15, 0.06, 0.06, 0.3, SB.ink);
  s.aux.set(0, 0, SB_GLOW); s.ico(lx, y0 + h - 0.32, z - 0.28, 0.13, SB.lamp, 1.3); s.aux.set(0, 0, -1);
}
// sbDisc lays a disc of radius r flat on a wall facing -z, its face at z (an octagon: front face only).
function sbDisc(s: Batch, x: number, y: number, z: number, r: number, color: number) {
  for (let i = 0; i < 8; i++) { const a0 = i * Math.PI / 4, a1 = a0 + Math.PI / 4; s.tri(x, y, z, x + r * Math.cos(a0), y + r * Math.sin(a0), z, x + r * Math.cos(a1), y + r * Math.sin(a1), z, color, [0, 0, -1]); }
}

// storyFountain builds a fountain of bowls stacked off true on a stem, with water arcing out of the top bowl
// into a round pool, at (x, y, z), its pool R across.
export function storyFountain(s: Batch, x: number, y: number, z: number, R: number) {
  R = Math.max(3, Math.min(6, R));
  s.cyl(x, y + 0.3, z, R, 0.6, SB.cream, 14, 0, 0, x);
  s.cyl(x, y + 0.56, z, R - 0.35, 0.1, SB.aqua, 14, 0, 0, x + 0.2);
  let yy = y + 0.6, r = R * 0.6;
  for (let i = 0; i < 3; i++) {
    const ox = Math.sin(i * 1.9) * 0.4, oz = Math.cos(i * 1.4) * 0.4;
    s.cyl(x + ox, yy + 0.8, z + oz, 0.22, 1.6, SB.mustard, 6, 0, 0, i); yy += 1.6;
    s.cone(x + ox, yy + 0.22, z + oz, r, 0.45, i % 2 ? SB.pink : SB.teal, 10, Math.PI, i * 0.5);
    s.cyl(x + ox, yy + 0.42, z + oz, r * 0.88, 0.06, SB.aqua, 10, 0, 0, i * 0.5 + 0.2);
    r *= 0.68;
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    sbTube(s, sbCurve(5, (t) => [x + Math.cos(a) * (0.6 + t * (R * 0.55)), yy + 0.4 + Math.sin(t * Math.PI) * 1.2 - t * (yy + 0.4 - y - 0.6), z + Math.sin(a) * (0.6 + t * (R * 0.55))]), () => 0.07, () => SB.aqua, 4, a);
  }
}

// ---- trees ------------------------------------------------------------------------------------
// storyTree draws the storybook city's trees at (x, y, z), about h tall with a crown about r across, coloured
// `color` from the style's tree colours (pink, orange, gold, violet...), each bent and turned its own way by
// where it stands. Each is kept cheap (a hundred-odd triangles), because a city has a great many. `snow`
// caps the crown.
const SB_TRUNKS: [number, number][] = [[SB.cream, SB.ink], [SB.white, SB.red], [SB.butter, SB.orange], [SB.cream, SB.plum]];
export function storyTree(s: Batch, kind: string, x: number, y: number, z: number, h: number, r: number, color: number, snow = false) {
  const t = sbSpot(x, z) * Math.PI * 2, bx = Math.cos(t), bz = Math.sin(t), u = sbSpot(x, z, 1);
  const shadeC = (c: number, f: number) => ((Math.min(255, ((c >> 16) & 255) * f) << 16) | (Math.min(255, ((c >> 8) & 255) * f) << 8) | Math.min(255, (c & 255) * f)) >>> 0;
  if (kind === "pancake") {
    const bend = (u - 0.5) * 2.2, H = h * 0.8, at = (v: number): SbP3 => [x + bx * bend * v * v, y + v * H, z + bz * bend * v * v];
    sbTube(s, sbCurve(2, at), (i) => 0.24 - i * 0.05, () => 0x7a4a32, 5, t);
    let rr = r * 1.45;
    for (let i = 0; i < 3; i++) { const p = at(0.5 + i * 0.25); s.lathe("lens", SB_LENS, p[0], p[1] + i * 0.35 - rr * 0.3, p[2], rr, rr * 0.6, i % 2 ? shadeC(color, 0.8) : color, 7, t + i * 0.7); rr *= 0.7; }
    const p = at(1); if (snow) s.ico(p[0], p[1] + 0.9, p[2], r * 0.5, 0xf4f6f8, 0.4, t);
    else s.lathe("bulb", SB_BULB, p[0], p[1] + 0.65, p[2], 0.3, 0.6, SB.red, 6, t);
    return;
  }
  if (kind === "droop") {
    // a droop has a trunk curling over like a question mark, and its crown hangs tendrils
    const L = h * 0.5, at = (v: number): SbP3 => [x + bx * Math.sin(v * 2.1) * L, y + Math.sin(v * 1.8) * h * 0.95, z + bz * Math.sin(v * 2.1) * L];
    sbTube(s, sbCurve(3, at), (i) => 0.26 - i * 0.05, () => SB.plum, 5, t);
    const [ex, ey, ez] = at(1);
    s.lathe("puff", SB_PUFF, ex, ey + 0.2 - r * 0.68, ez, r * 0.85, r * 1.36, snow ? 0xf4f6f8 : color, 7, t);
    for (let i = 0; i < 4; i++) { const a = t + i * 1.57; s.cone(ex + Math.cos(a) * r * 0.7, ey - r * 0.55 - (i % 2) * 0.4, ez + Math.sin(a) * r * 0.7, 0.2, 1.6 + (i % 2) * 0.7, shadeC(color, 0.8), 3, Math.PI, a); }
    return;
  }
  if (kind === "spiral") {
    // a spiral is topiary: a pot, and balls clipped in a spiral up a stake
    s.cyl(x, y + 0.4, z, 0.7, 0.8, SB.coral, 6, 0, 0, t); s.cyl(x, y + 0.84, z, 0.8, 0.12, SB.cream, 6, 0, 0, t + 0.5);
    const g = color === SB.pink || color === SB.magenta ? SB.mint : SB.lime;
    for (let i = 0; i < 4; i++) { const v = i / 4, a = t + v * 9, rr = 0.62 * (1 - v * 0.45); s.lathe("bulb", SB_BULB, x + Math.cos(a) * 0.65 * (1 - v), y + 1.4 + v * h * 0.55 - rr, z + Math.sin(a) * 0.65 * (1 - v), rr, rr * 2, snow && i === 3 ? 0xf4f6f8 : g, 6, a); }
    return;
  }
  // a tuft has a thin striped trunk with a kink, a pom-pom crown and a ragged fringe under it
  const bend = (u - 0.5) * 2.4, H = h, [c0, c1] = SB_TRUNKS[Math.floor(sbSpot(x, z, 2) * SB_TRUNKS.length)];
  const at = (v: number): SbP3 => [x + bx * bend * v * v + Math.sin(v * 5 + t) * 0.15, y + v * H, z + bz * bend * v * v];
  sbTube(s, sbCurve(3, at), () => 0.15, (i) => (i % 2 ? c1 : c0), 5, t);
  const [tx, ty, tz] = at(1);
  s.lathe("puff", SB_PUFF, tx, ty - r * 0.5, tz, r * 1.0, r * 1.75, snow ? 0xf4f6f8 : color, 7, t);
  for (let i = 0; i < 3; i++) { const a = t + i * 2.09; s.cone(tx + Math.cos(a) * r * 0.7, ty - r * 0.25, tz + Math.sin(a) * r * 0.7, 0.24, 0.9, color, 3, Math.PI, a); }
}

// ---- vehicles ---------------------------------------------------------------------------------
// storyWorkshop dresses a storybook workshop's roof (an industrial lot's shed, b in its frame, its roof at
// `top`) with a curly striped chimney at one end under a little hat, clear of the roof's clutter.
export function storyWorkshop(s: Batch, b: { x0: number; z0: number; x1: number; z1: number }, top: number, rnd: SbRand) {
  const cx = b.x1 - 2.2 - rnd() * 1.5, cz = (b.z0 + b.z1) / 2 + 1.5, c = sbPick(rnd, [SB.red, SB.teal, SB.violet, SB.mustard]);
  sbTube(s, sbCurve(4, (t) => [cx + Math.sin(t * 6) * 0.5, top + 0.3 + t * 5.5, cz + Math.cos(t * 6) * 0.5]), (i) => 0.55 - i * 0.05, (i) => (i % 2 ? SB.white : c), 7, cx);
  s.cone(cx + Math.sin(6) * 0.5, top + 6.3, cz + Math.cos(6) * 0.5, 0.75, 0.9, SB.ink, 7, Math.PI, cx);
}
