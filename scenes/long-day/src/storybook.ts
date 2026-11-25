// The storybook city's pieces (styles.ts, `storybook`): its curved, striped, bulging street
// furniture, trees, buildings and its gate, drawn into the city's batches like any other city's.
// Curves are chains of short cylinders (sbTube), each piece turned half a sector from the last, so
// two pieces in line never share a plane (where they overlap, flat faces in one plane flicker).
// Imports only geometry, so city.ts and the others can import it at load.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { facadeBox, facadePrism } from "./facade.ts";
import { headLamp, tailLamp } from "./cars.ts";

export type SbP3 = [number, number, number];

// The palette: saturated storybook colours, a warm cream, ink and white for stripes.
export const SB = {
  coral: 0xff5a4e, red: 0xe8333a, pink: 0xff7fb5, magenta: 0xd83a9a, orange: 0xff9a2e, mustard: 0xf2c230,
  butter: 0xfbe58a, lime: 0xa6e05a, mint: 0x5fd3a0, teal: 0x1fb5b0, aqua: 0x6fe0e8, sky: 0x4f9cf0,
  violet: 0x9a6cf0, plum: 0x6a3a9a, cream: 0xfff3dc, white: 0xffffff, ink: 0x2a2440, navy: 0x2b3f8a,
  lamp: 0xffe08a, fluff: 0xfff8ee,
};
export const SB_WALLS = [SB.coral, SB.pink, SB.mustard, SB.mint, SB.teal, SB.violet, SB.aqua, SB.orange, SB.butter, SB.lime, SB.magenta];
export const SB_TRIMS = [SB.cream, SB.white, SB.ink, SB.red, SB.navy, SB.plum];
export const SB_TUFTS = [SB.pink, SB.orange, SB.mustard, SB.violet, SB.magenta, SB.coral, SB.aqua];
// The street's colours, laid over city.ts's C while a storybook city is built (setCityStyle).
export const SB_STREET = { asphalt: 0x5e5070, sidewalk: 0xffd9e0, curb: 0xfff3dc, white: 0xfff8ee, yellow: 0xff7fb5, pole: 0x2a2440, lampHead: 0xffe08a, pavers: 0xffe2dc, plaza: 0xfff1d6, path: 0xf6d9a8 };

// A chain of cylinders through `pts`: r and colour per piece (i, and t from 0 to 1 along it).
const SB_UP = new THREE.Vector3(0, 1, 0), SB_DV = new THREE.Vector3(), SB_Q = new THREE.Quaternion(), SB_E = new THREE.Euler(), SB_Q2 = new THREE.Quaternion();
export function sbTube(b: Batch, pts: SbP3[], r: (i: number, t: number) => number, col: (i: number) => number, seg = 6, spin = 0) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
    SB_DV.set(bx - ax, by - ay, bz - az); const L = SB_DV.length(); if (L < 1e-4) continue;
    // Turned about its own axis half a sector more each piece, then laid along the chain.
    SB_Q.setFromUnitVectors(SB_UP, SB_DV.normalize()); SB_Q2.setFromAxisAngle(SB_UP, spin + (i % 2) * Math.PI / seg);
    SB_E.setFromQuaternion(SB_Q.multiply(SB_Q2), "XYZ");
    const rr = r(i, i / Math.max(1, pts.length - 2)) * (i % 2 ? 1.025 : 1);
    b.cyl((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, rr, L + rr * 0.3, col(i), seg, SB_E.x, SB_E.z, SB_E.y);
  }
}
export const sbCurve = (n: number, f: (t: number) => SbP3): SbP3[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));
// A hash in [0, 1) of where something stands (to turn it its own way, pick its colour, ...).
export const sbSpot = (x: number, z: number, k = 0) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };

// ---- street furniture -------------------------------------------------------------------------
// A shepherd's-crook streetlight: a dark pole curling over at the top toward (hx, hz), its lamp
// hanging from the crook's end under a little hat of a shade. The lamp glows after dark (aux -2,
// as every city's streetlight heads); returns where its light hangs.
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
  s.aux.set(0, 0, -2); s.ico(ex, ey - 0.86, ez, 0.26, SB.lamp, 1.15, px * 0.7 + pz); s.aux.set(0, 0, -1);
  return [ex, ey - 0.9, ez];
}
// Bunting across a street: two striped poles at the backs of the sidewalks, (ax, az) and (bx, bz),
// a line sagging between them and pennants hanging from it, well above any truck.
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
  }
}
// The town gate: two red-and-white corkscrew columns either side of the road in, at (x, z) facing
// (fx, fz) (along the road), an arch striped teal and white over it, a gold ball on each column and
// a board across the arch's crown. `half`: from the road's middle to each column.
export function storyGate(s: Batch, x: number, z: number, fx: number, fz: number, half: number, y0 = 0) {
  const rx = -fz, rz = fx, H = 9.5, rise = 4.2;
  const cols: [number, number][] = [[x - rx * half, z - rz * half], [x + rx * half, z + rz * half]];
  cols.forEach(([cx, cz], k) => {
    s.cyl(cx, y0 + 0.4, cz, 1.3, 0.8, SB.cream, 10, 0, 0, k);
    sbTube(s, sbCurve(18, (t) => [cx + Math.cos(t * 13 + k) * 0.45, y0 + 0.7 + t * (H - 0.7), cz + Math.sin(t * 13 + k) * 0.45]), () => 0.6, (i) => (i % 2 ? SB.white : SB.red), 8, k);
    s.ico(cx, y0 + H + 0.9, cz, 1.05, SB.mustard, 1, k * 0.7);
  });
  const arc = sbCurve(20, (t) => [cols[0][0] + (cols[1][0] - cols[0][0]) * t, y0 + H + Math.sin(t * Math.PI) * rise, cols[0][1] + (cols[1][1] - cols[0][1]) * t]);
  sbTube(s, arc, () => 0.5, (i) => (i % 2 ? SB.white : SB.teal), 8, 0.3);
  // the board at the crown, a bright magenta panel framed in butter, either face
  const yaw = Math.atan2(-rz, rx);
  s.box(x, y0 + H + rise - 1.6, z, 7.6, 2.4, 0.3, SB.butter, yaw);
  s.box(x + fx * 0.17, y0 + H + rise - 1.6, z + fz * 0.17, 7.0, 1.9, 0.06, SB.magenta, yaw);
  s.box(x - fx * 0.17, y0 + H + rise - 1.6, z - fz * 0.17, 7.0, 1.9, 0.06, SB.magenta, yaw);
}

// ---- buildings --------------------------------------------------------------------------------
// Walls are facade tiles (facade.ts facadePrism, facadeBox): windows and doors are paint, not
// geometry, so a storybook building costs about what any city's does. The shape is the thing: round
// pods stacked up a bending spine, each its own colour and girth, a trim band at each pod's top,
// and a hat.
type SbRand = () => number;
const sbPick = <T,>(r: SbRand, a: readonly T[]) => a[Math.floor(r() * a.length)];
// A flat n-gon (as facadePrism lays one) at height y, facing up (or down: an overhang's underside).
export function sbCap(s: Batch, cx: number, cz: number, R: number, n: number, rot: number, y: number, color: number, down = false) {
  const step = (2 * Math.PI) / n;
  for (let i = 0; i < n; i++) {
    const a0 = rot + i * step, a1 = a0 + step;
    s.tri(cx, y, cz, cx + R * Math.cos(a0), y, cz + R * Math.sin(a0), cx + R * Math.cos(a1), y, cz + R * Math.sin(a1), color, [0, down ? -1 : 1, 0]);
  }
}
// The trim round a pod's top: a short n-sided band a little proud of its walls, its sides
// parallel to theirs (CylinderGeometry's corners lie at angle PI/2 - theta: turned to match).
function sbTrim(s: Batch, cx: number, cz: number, R: number, n: number, rot: number, y: number, color: number) {
  s.cyl(cx, y, cz, R * 1.08, 0.34, color, n, 0, 0, Math.PI / 2 - rot);
}

export interface TowerLook { walls: readonly number[]; roofs: readonly number[]; trims?: readonly number[]; ground: number; upper: number; door?: number; storeys: number }
// A tower of pods on a lot, its foot centred on (cx, cz) in the lot's frame (the street at -z),
// its foot's radius R (to its corners), `storeys` storeys of facade in pods of one or two. The
// pods above lean off true along a bending spine, each a little wider or narrower than the last,
// within `room` (so never into the neighbours'). Each building's storeys are a few cm taller or
// shorter than its neighbours' (so their trims and roofs never share a plane, which flickers).
// The foot's front side faces the street
// (-z): `door` paints a door on it. Returns the top's height and the front wall's depth (z).
export interface TowerRoom { x: number; zf: number; zb: number }   // how far a pod's edge may reach from the foot's middle: either way along the street, toward it, away
// How many sides a tower's foot of radius R has: as many as leave each 3.2 m wide at least, so its
// front side takes any door (a service door's two leaves too), and an even number, 6 at least.
export function sbFootSides(R: number) { return Math.max(6, 2 * Math.floor(Math.PI / Math.asin(Math.min(1, 1.6 / R)) / 2)); }
const sbPodSides = (r: number) => (r < 3.2 ? 8 : r < 4.6 ? 10 : 12);
export function storyTower(s: Batch, cx: number, cz: number, R: number, room: TowerRoom, y0: number, look: TowerLook, rnd: SbRand): { top: number; front: number } {
  let n = sbFootSides(R), step = (2 * Math.PI) / n;
  // (Leaning toward the street or away from it, a little to one side.)
  const lean = 0.4 + rnd() * 0.6, dir = (rnd() < 0.6 ? -Math.PI / 2 : Math.PI / 2) + (rnd() - 0.5) * 0.9, trims = look.trims ?? SB_TRIMS, jit = (rnd() - 0.5) * 0.12;
  let y = y0, left = look.storeys, k = 0, r = R, px = cx, pz = cz, rot = -Math.PI / 2 - step / 2, prevR = 0;
  const front = cz - R * Math.cos(Math.PI / n);
  while (left > 0) {
    const fl = k === 0 ? 1 : Math.min(left, rnd() < 0.5 ? 1 : 2), first = k === 0;
    if (!first) {
      r = Math.max(1.8, Math.min(room.x - 0.1, R * (0.72 + rnd() * 0.5)));
      const off = lean * k * (0.9 + k * 0.25) + (rnd() - 0.5) * 0.4;
      px = cx + Math.max(-(room.x - r), Math.min(room.x - r, Math.cos(dir) * off));
      pz = cz + Math.max(-(room.zf - r), Math.min(room.zb - r, Math.sin(dir) * off));
      n = sbPodSides(r); step = (2 * Math.PI) / n;
      rot = -Math.PI / 2 - step / 2 + (k % 2) * step / 2;
    }
    const wall = sbPick(rnd, look.walls), bandH = first ? 4.2 + jit : 3.2;
    const band = { tile: first ? look.ground : look.upper, floors: fl, floorH: bandH };
    if (!first && r > prevR * 1.08) sbCap(s, px, pz, r, n, rot, y, wall, true);   // an overhang's underside
    const top = facadePrism(s, px, pz, r, n, rot, y, [band], wall, first && look.door !== undefined ? 0 : -1, look.door ?? -1);
    sbTrim(s, px, pz, r, n, rot, top - 0.17, sbPick(rnd, trims));   // (no higher than the pod's top: the next pod's walls start there)
    sbCap(s, px, pz, r, n, rot, top - 0.005, sbPick(rnd, look.roofs));
    y = top; left -= fl; k++; prevR = r;
  }
  storyHat(s, px, y, pz, r, dir, rnd);
  return { top: y, front };
}
// A tower's hat: an onion dome with its spike and ball, a witch's hat bending over, a curly
// chimney, or a stack of shrinking bulbs.
export function storyHat(s: Batch, x: number, y: number, z: number, r: number, dir: number, rnd: SbRand) {
  r = Math.min(r * 0.8, 3.4);
  const kind = Math.floor(rnd() * 4), c = sbPick(rnd, SB_WALLS), c2 = sbPick(rnd, SB_TRIMS), t = x * 1.7 + z;
  if (kind === 0) {
    s.ico(x, y + r * 0.5, z, r * 0.95, c, 0.95, t); s.cone(x, y + r * 1.45, z, r * 0.32, r * 0.9, c, 7, 0, t);
    s.cyl(x, y + r * 2.05, z, 0.06, 0.8, SB.ink, 4, 0, 0, t); s.ico(x, y + r * 2.5, z, 0.32, SB.mustard, 1, t);
  } else if (kind === 1) {
    const H = r * 3, bend = r * (0.8 + rnd() * 0.8);
    s.cyl(x, y + 0.12, z, r * 1.15, 0.24, c2, 10, 0, 0, t);
    for (let i = 0; i < 4; i++) {
      const u0 = i / 4, u1 = (i + 1) / 4, B = (u: number) => u * u * u * bend;
      sbTube(s, [[x + Math.cos(dir) * B(u0), y + u0 * H, z + Math.sin(dir) * B(u0)], [x + Math.cos(dir) * B(u1), y + u1 * H, z + Math.sin(dir) * B(u1)]], () => r * (1 - (u0 + u1) / 2) * 0.95 + 0.1, () => (i % 2 ? c : c2), 9, t + i);
    }
  } else if (kind === 2) {
    s.cyl(x, y + 0.2, z, r * 0.85, 0.4, c2, 10, 0, 0, t);
    const pts = sbCurve(7, (u) => [x + Math.cos(u * 8 + dir) * r * 0.35 * (1 - u * 0.5), y + 0.4 + u * r * 2.3, z + Math.sin(u * 8 + dir) * r * 0.35 * (1 - u * 0.5)]);
    sbTube(s, pts, () => 0.28, (i) => (i % 3 ? c : SB.ink), 5, t);
    const e = pts[pts.length - 1]; s.cone(e[0], e[1] + 0.3, e[2], 0.5, 0.6, SB.ink, 7, Math.PI, t);
  } else {
    let yy = y, rr = r * 0.8;
    for (let i = 0; i < 3; i++) { s.ico(x + Math.sin(i * 1.7 + t) * 0.3, yy + rr * 0.6, z, rr, i % 2 ? c : c2, 0.75, t + i); yy += rr * 1.1; rr *= 0.66; }
    s.cone(x, yy + 0.5, z, 0.15, 1.2, SB.ink, 4, 0, t);
  }
}
// A crooked row building on a lot b (x0..x1 along the street, z0..z1 in from it; street at -z):
// storeys stacked each a little off the last, wider or narrower, a scalloped awning over its shop
// front (whose tile paints the doors) and a lopsided attic. Returns its top.
export function storyShopRow(s: Batch, b: { x0: number; z0: number; x1: number; z1: number }, y0: number, storeys: number, look: TowerLook, rnd: SbRand): number {
  const w = b.x1 - b.x0, d = b.z1 - b.z0, mid = (b.x0 + b.x1) / 2, jit = (rnd() - 0.5) * 0.12;
  let y = facadeBox(s, b.x0, b.z0, b.x1, b.z1, y0, [{ tile: look.ground, floors: 1, floorH: 4.2 + jit }], sbPick(rnd, look.walls));
  s.box(mid, y - 0.15, (b.z0 + b.z1) / 2, w + 0.24, 0.3, d + 0.3, sbPick(rnd, SB_TRIMS));
  let shift = 0, ww = w;
  for (let k = 1; k < storeys; k++) {
    shift += (rnd() - 0.5) * 1.4; ww = Math.max(Math.min(4.5, w), Math.min(w - 0.4, ww * (0.82 + rnd() * 0.3)));
    shift = Math.max(-(w - ww) / 2 + 0.2, Math.min((w - ww) / 2 - 0.2, shift));   // (within its lot: its neighbours' walls are 0.6 m off)
    const x0 = mid + shift - ww / 2, x1 = mid + shift + ww / 2, dz = (rnd() - 0.5) * 0.6, z0 = b.z0 + 0.3 + Math.max(0, dz), z1 = b.z1 - 0.3;
    const top = facadeBox(s, x0, z0, x1, z1, y, [{ tile: look.upper, floors: 1, floorH: 3.2 }], sbPick(rnd, look.walls));
    s.box((x0 + x1) / 2, top - 0.13, (z0 + z1) / 2, ww + 0.24, 0.26, z1 - z0 + 0.3, sbPick(rnd, SB_TRIMS));   // (no higher than the storey's top: the next one's walls start there)
    y = top;
  }
  // the attic: a gable off to one side, tipped, its ridge along the street, and a chimney
  const ax = mid + shift + (rnd() - 0.5) * 1.5, aw = Math.max(3.5, ww * 0.7), roof = sbPick(rnd, look.roofs);
  s.prism(ax, y + 1.5, (b.z0 + b.z1) / 2 + 0.3, aw, 3, Math.min(d - 1, 7), roof);
  sbTube(s, sbCurve(3, (u) => [ax + aw * 0.28 + Math.sin(u * 3) * 0.3, y + 1 + u * 3.2, b.z1 - 2.5]), () => 0.3, (i) => (i % 2 ? SB.ink : SB.red), 6, ax);
  // a scalloped awning over the shop front: a sloping striped board and a row of hanging points
  const ac = sbPick(rnd, [SB.red, SB.teal, SB.violet, SB.orange]), ns = Math.max(4, Math.round(w / 1.5));
  for (let i = 0; i < ns; i++) {
    const u = b.x0 + (i + 0.5) * w / ns, c = i % 2 ? SB.white : ac;
    s.boxR(u, y0 + 3.45 + jit, b.z0 - 0.75, w / ns - 0.004, 0.07, 1.55, c, -0.32, 0, 0);   // (a hair apart: overlapping, their tops shared a plane)
    s.cone(u, y0 + 2.98 + jit, b.z0 - 1.5, w / ns / 2 - 0.02, 0.34, c, 5, Math.PI, i * 0.3);
  }
  return y;
}
// A house: a squat pod of one or two storeys with its door (painted, on the front side) and a hat;
// or a crooked gable house. In the lot's frame (street at -z), centred on (cx, cz), R its radius.
// Returns its front wall's depth, the span of that wall its door is painted in, and its top.
export function storyHouse(s: Batch, cx: number, cz: number, R: number, y0: number, look: TowerLook, rnd: SbRand): { front: number; door: [number, number]; top: number } {
  if (rnd() < 0.6) {
    const t = storyTower(s, cx, cz, R, { x: R + 0.3, zf: R, zb: R + 1.5 }, y0, { ...look, storeys: rnd() < 0.5 ? 1 : 2 }, rnd);
    return { front: t.front, door: [cx - 0.5, cx + 0.5], top: t.top };
  }
  const w = R * 1.9, d = R * 1.7, x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, wall = sbPick(rnd, look.walls);
  const top = facadeBox(s, x0, z0, x1, z1, y0, [{ tile: look.upper, floors: rnd() < 0.5 ? 1 : 2, floorH: 3.1 + (rnd() - 0.5) * 0.12 }], wall, 2, look.door ?? -1);
  // a steep crooked roof: two gables, the upper one set off and tipped, and a corkscrew chimney
  const roof = sbPick(rnd, look.roofs);
  s.prism(cx, top + 1.6, cz, w + 0.6, 3.2, d + 0.6, roof);
  s.boxR(cx + (rnd() - 0.5) * 1.2, top + 3.9, cz, w * 0.45, 1.6, d * 0.45, sbPick(rnd, SB_WALLS), 0, 0, (rnd() - 0.5) * 0.3);
  s.prism(cx + (rnd() - 0.5) * 1.2, top + 5.2, cz, w * 0.5, 1.4, d * 0.55, roof, 0.15);
  sbTube(s, sbCurve(4, (u) => [x1 - 1 + Math.cos(u * 7) * 0.3, top + 1.5 + u * 4, z1 - 1.2 + Math.sin(u * 7) * 0.3]), () => 0.26, (i) => (i % 2 ? SB.cream : SB.red), 6, cx);
  return { front: z0, door: [x0, x1], top: top + 6 };
}

// A fountain of bowls stacked off true on a stem, water arcing out of the top bowl into a round
// pool, at (x, y, z), its pool R across.
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
// The storybook city's trees, at (x, y, z), about h tall with a crown about r across, coloured
// `color` (the style's tree colours: pink, orange, gold, violet...), each bent and turned its own
// way by where it stands. Kept cheap (a hundred-odd triangles): a city has a great many. `snow`
// caps the crown.
const SB_TRUNKS: [number, number][] = [[SB.cream, SB.ink], [SB.white, SB.red], [SB.butter, SB.orange], [SB.cream, SB.plum]];
export function storyTree(s: Batch, kind: string, x: number, y: number, z: number, h: number, r: number, color: number, snow = false) {
  const t = sbSpot(x, z) * Math.PI * 2, bx = Math.cos(t), bz = Math.sin(t), u = sbSpot(x, z, 1);
  const shadeC = (c: number, f: number) => ((Math.min(255, ((c >> 16) & 255) * f) << 16) | (Math.min(255, ((c >> 8) & 255) * f) << 8) | Math.min(255, (c & 255) * f)) >>> 0;
  if (kind === "pancake") {
    const bend = (u - 0.5) * 2.2, H = h * 0.8, at = (v: number): SbP3 => [x + bx * bend * v * v, y + v * H, z + bz * bend * v * v];
    sbTube(s, sbCurve(2, at), (i) => 0.24 - i * 0.05, () => 0x7a4a32, 5, t);
    let rr = r * 1.45;
    for (let i = 0; i < 3; i++) { const p = at(0.5 + i * 0.25); s.ico(p[0], p[1] + i * 0.35, p[2], rr, i % 2 ? shadeC(color, 0.8) : color, 0.3, t + i * 0.7); rr *= 0.7; }
    const p = at(1); if (snow) s.ico(p[0], p[1] + 0.9, p[2], r * 0.5, 0xf4f6f8, 0.4, t);
    else s.ico(p[0], p[1] + 0.95, p[2], 0.3, SB.red, 1, t);
    return;
  }
  if (kind === "droop") {
    // a trunk curling over like a question mark, its crown hanging tendrils
    const L = h * 0.5, at = (v: number): SbP3 => [x + bx * Math.sin(v * 2.1) * L, y + Math.sin(v * 1.8) * h * 0.95, z + bz * Math.sin(v * 2.1) * L];
    sbTube(s, sbCurve(3, at), (i) => 0.26 - i * 0.05, () => SB.plum, 5, t);
    const [ex, ey, ez] = at(1);
    s.ico(ex, ey + 0.2, ez, r * 0.85, snow ? 0xf4f6f8 : color, 0.8, t);
    for (let i = 0; i < 4; i++) { const a = t + i * 1.57; s.cone(ex + Math.cos(a) * r * 0.7, ey - r * 0.55 - (i % 2) * 0.4, ez + Math.sin(a) * r * 0.7, 0.2, 1.6 + (i % 2) * 0.7, shadeC(color, 0.8), 3, Math.PI, a); }
    return;
  }
  if (kind === "spiral") {
    // topiary: a pot, and balls clipped in a spiral up a stake
    s.cyl(x, y + 0.4, z, 0.7, 0.8, SB.coral, 6, 0, 0, t); s.cyl(x, y + 0.84, z, 0.8, 0.12, SB.cream, 6, 0, 0, t + 0.5);
    const g = color === SB.pink || color === SB.magenta ? SB.mint : SB.lime;
    for (let i = 0; i < 4; i++) { const v = i / 4, a = t + v * 9; s.ico(x + Math.cos(a) * 0.65 * (1 - v), y + 1.4 + v * h * 0.55, z + Math.sin(a) * 0.65 * (1 - v), 0.62 * (1 - v * 0.45), snow && i === 3 ? 0xf4f6f8 : g, 1, a); }
    return;
  }
  // tuft: a thin striped trunk with a kink, a pom-pom crown and a ragged fringe under it
  const bend = (u - 0.5) * 2.4, H = h, [c0, c1] = SB_TRUNKS[Math.floor(sbSpot(x, z, 2) * SB_TRUNKS.length)];
  const at = (v: number): SbP3 => [x + bx * bend * v * v + Math.sin(v * 5 + t) * 0.15, y + v * H, z + bz * bend * v * v];
  sbTube(s, sbCurve(3, at), () => 0.15, (i) => (i % 2 ? c1 : c0), 5, t);
  const [tx, ty, tz] = at(1);
  s.ico(tx, ty + r * 0.35, tz, r * 0.95, snow ? 0xf4f6f8 : color, 0.85, t);
  s.ico(tx + bx * r * 0.45, ty + r * 0.7, tz + bz * r * 0.45, r * 0.6, shadeC(color, 1.12), 0.9, t + 1.12);
  for (let i = 0; i < 3; i++) { const a = t + i * 2.09; s.cone(tx + Math.cos(a) * r * 0.7, ty - r * 0.25, tz + Math.sin(a) * r * 0.7, 0.24, 0.9, color, 3, Math.PI, a); }
}

// ---- vehicles ---------------------------------------------------------------------------------
// The storybook city's traffic (traffic.ts STORY_TRAFFIC), modelled as cars.ts's are: at the
// origin, nose to +x, on the road at y = 0; white parts take the car's colour.
// A bubble car: a short chassis on four fat wheels under a tall bulging cabin with a round
// windscreen, a curly exhaust at the back and a bobble on a spring on its roof.
export function storyBubbleCar(b: Batch) {
  const W = 1.8;
  for (const x of [-1.1, 1.1]) for (const z of [-0.78, 0.78]) b.cyl(x, 0.36, z, 0.36, 0.3, 0x161616, 10, Math.PI / 2);
  b.box(0, 0.62, 0, 3.3, 0.42, W - 0.1, 0xffffff);
  b.ico(-0.15, 1.35, 0, 1.15, 0xffffff, 1.0, 0.3);
  b.ico(0.42, 1.45, 0, 0.82, 0x26313d, 0.95, 1.4);   // the windscreen, bulging out of the front of the dome
  b.box(1.66, 0.62, 0, 0.06, 0.26, W - 0.3, 0x2a2440);
  headLamp(b, 1.66, 0.82, -0.6, 0.04, 0.16, 0.22); headLamp(b, 1.66, 0.82, 0.6, 0.04, 0.16, 0.22);
  tailLamp(b, -1.66, 0.82, -0.6, 0.04, 0.14, 0.22); tailLamp(b, -1.66, 0.82, 0.6, 0.04, 0.14, 0.22);
  sbTube(b, sbCurve(4, (t) => [-1.55 - t * 0.35, 0.55 + t * 1.2 + Math.sin(t * 7) * 0.12, 0.6 + Math.cos(t * 7) * 0.12]), () => 0.07, () => 0x2a2440, 4, 0.2);
  sbTube(b, sbCurve(3, (t) => [-0.25 + Math.cos(t * 9) * 0.06, 2.45 + t * 0.6, Math.sin(t * 9) * 0.06]), () => 0.035, () => 0x2a2440, 4, 0.5);
  b.ico(-0.25, 3.12, 0, 0.17, SB.mustard, 1, 0.2);
}
// The puff bus: a fat round-ended coral body banded in cream, round windows down both sides, a
// little striped onion on its roof.
export function storyPuffBus(b: Batch) {
  const L = 9.2, R = 1.3, y = 1.75;
  for (const x of [-2.9, 2.9]) for (const z of [-1.05, 1.05]) b.cyl(x, 0.48, z, 0.48, 0.34, 0x161616, 10, Math.PI / 2);
  b.cyl(0, y, 0, R, L - 2 * R * 0.8, SB.coral, 12, 0, Math.PI / 2);
  b.cyl(0, y - 0.35, 0, R + 0.03, L - 2 * R * 0.8 - 0.2, SB.cream, 12, 0, Math.PI / 2);   // (not quite as long: its ends inside the body's)
  b.ico(L / 2 - R * 0.8, y, 0, R, SB.coral, 1, 0.4); b.ico(-L / 2 + R * 0.8, y, 0, R, SB.coral, 1, 1.1);
  b.ico(L / 2 - R * 0.55, y + 0.25, 0, R * 0.78, 0x26313d, 0.75, 0.9);   // windscreen
  for (let i = 0; i < 5; i++) for (const z of [-1, 1]) b.cyl(-2.6 + i * 1.3, y + 0.35, z * (R - 0.02), 0.34, 0.08, 0x26313d, 8, Math.PI / 2, 0, i * 0.3);
  b.cyl(0, y + R + 0.15, 0, 0.5, 0.3, SB.teal, 8);
  b.ico(0, y + R + 0.75, 0, 0.55, SB.mustard, 1.2, 0.3); b.cone(0, y + R + 1.45, 0, 0.12, 0.5, SB.ink, 4);
  headLamp(b, L / 2 + 0.25, 0.95, -0.7, 0.04, 0.16, 0.3); headLamp(b, L / 2 + 0.25, 0.95, 0.7, 0.04, 0.16, 0.3);
  tailLamp(b, -L / 2 - 0.25, 0.95, -0.7, 0.04, 0.14, 0.3); tailLamp(b, -L / 2 - 0.25, 0.95, 0.7, 0.04, 0.14, 0.3);
}

// A storybook workshop's roof (an industrial lot's shed, b in its frame, its roof at `top`): a
// curly striped chimney at one end under a little hat, clear of the roof's clutter.
export function storyWorkshop(s: Batch, b: { x0: number; z0: number; x1: number; z1: number }, top: number, rnd: SbRand) {
  const cx = b.x1 - 2.2 - rnd() * 1.5, cz = (b.z0 + b.z1) / 2 + 1.5, c = sbPick(rnd, [SB.red, SB.teal, SB.violet, SB.mustard]);
  sbTube(s, sbCurve(4, (t) => [cx + Math.sin(t * 6) * 0.5, top + 0.3 + t * 5.5, cz + Math.cos(t * 6) * 0.5]), (i) => 0.55 - i * 0.05, (i) => (i % 2 ? SB.white : c), 7, cx);
  s.cone(cx + Math.sin(6) * 0.5, top + 6.3, cz + Math.cos(6) * 0.5, 0.75, 0.9, SB.ink, 7, Math.PI, cx);
}
