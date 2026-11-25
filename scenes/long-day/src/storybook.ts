// The storybook city's pieces (styles.ts, `storybook`): its curved, striped, bulging street
// furniture, trees, buildings and its gate, drawn into the city's batches like any other city's.
// Curves are chains of short cylinders (tube), each piece turned half a sector from the last, so
// two pieces in line never share a plane (where they overlap, flat faces in one plane flicker).
// Imports only geometry, so city.ts and the others can import it at load.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";

export type P3 = [number, number, number];

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
const Y = new THREE.Vector3(0, 1, 0), dv = new THREE.Vector3(), qq = new THREE.Quaternion(), ee = new THREE.Euler(), q2 = new THREE.Quaternion();
export function tube(b: Batch, pts: P3[], r: (i: number, t: number) => number, col: (i: number) => number, seg = 6, spin = 0) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
    dv.set(bx - ax, by - ay, bz - az); const L = dv.length(); if (L < 1e-4) continue;
    // Turned about its own axis half a sector more each piece, then laid along the chain.
    qq.setFromUnitVectors(Y, dv.normalize()); q2.setFromAxisAngle(Y, spin + (i % 2) * Math.PI / seg);
    ee.setFromQuaternion(qq.multiply(q2), "XYZ");
    const rr = r(i, i / Math.max(1, pts.length - 2)) * (i % 2 ? 1.025 : 1);
    b.cyl((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, rr, L + rr * 0.3, col(i), seg, ee.x, ee.z, ee.y);
  }
}
export const curve = (n: number, f: (t: number) => P3): P3[] => Array.from({ length: n + 1 }, (_, i) => f(i / n));
// A hash in [0, 1) of where something stands (to turn it its own way, pick its colour, ...).
export const spot = (x: number, z: number, k = 0) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return v - Math.floor(v); };

// ---- street furniture -------------------------------------------------------------------------
// A shepherd's-crook streetlight: a dark pole curling over at the top toward (hx, hz), its lamp
// hanging from the crook's end under a little hat of a shade. The lamp glows after dark (aux -2,
// as every city's streetlight heads); returns where its light hangs.
export function storyLamp(s: Batch, px: number, pz: number, hx: number, hz: number, y0: number): P3 {
  const dx = hx - px, dz = hz - pz, top = y0 + 5.8;
  const k = 1 - Math.cos(Math.PI * 0.95);
  const pts = curve(10, (t): P3 => {
    if (t <= 0.4) return [px, y0 + (t / 0.4) * (top - y0), pz];
    const a = (t - 0.4) / 0.6 * Math.PI * 0.95, f = (1 - Math.cos(a)) / k;
    return [px + dx * f, top + Math.sin(a) * 0.9, pz + dz * f];
  });
  tube(s, pts, (i) => (i < 4 ? 0.1 : 0.075), () => SB.ink, 5, px * 1.7 + pz);
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
    tube(s, curve(6, (t) => [x, y0 + t * (H - y0 + 0.4), z]), () => 0.09, (i) => (i % 2 ? SB.white : SB.red), 6, x + z);
    s.ico(x, H + 0.55, z, 0.2, SB.mustard, 1, x - z);
  }
  const at = (t: number): P3 => [ax + (bx - ax) * t, H - Math.sin(t * Math.PI) * sag, az + (bz - az) * t];
  tube(s, curve(n, at), () => 0.025, () => SB.ink, 3, salt);
  const ux = bx - ax, uz = bz - az, L = Math.hypot(ux, uz) || 1, nx = -uz / L * 0.02, nz = ux / L * 0.02;
  for (let i = 0; i < n; i++) {
    const p = at((i + 0.1) / n), q = at((i + 0.9) / n), c = SB_TUFTS[(i + salt) % SB_TUFTS.length];
    const mx = (p[0] + q[0]) / 2, mz = (p[2] + q[2]) / 2, my = Math.min(p[1], q[1]) - 0.85;
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
    tube(s, curve(18, (t) => [cx + Math.cos(t * 13 + k) * 0.45, y0 + 0.7 + t * (H - 0.7), cz + Math.sin(t * 13 + k) * 0.45]), () => 0.6, (i) => (i % 2 ? SB.white : SB.red), 8, k);
    s.ico(cx, y0 + H + 0.9, cz, 1.05, SB.mustard, 1, k * 0.7);
  });
  const arc = curve(20, (t) => [cols[0][0] + (cols[1][0] - cols[0][0]) * t, y0 + H + Math.sin(t * Math.PI) * rise, cols[0][1] + (cols[1][1] - cols[0][1]) * t]);
  tube(s, arc, () => 0.5, (i) => (i % 2 ? SB.white : SB.teal), 8, 0.3);
  // the board at the crown, a bright magenta panel framed in butter, either face
  const yaw = Math.atan2(-rz, rx);
  s.box(x, y0 + H + rise - 1.6, z, 7.6, 2.4, 0.3, SB.butter, yaw);
  s.box(x + fx * 0.17, y0 + H + rise - 1.6, z + fz * 0.17, 7.0, 1.9, 0.06, SB.magenta, yaw);
  s.box(x - fx * 0.17, y0 + H + rise - 1.6, z - fz * 0.17, 7.0, 1.9, 0.06, SB.magenta, yaw);
}
