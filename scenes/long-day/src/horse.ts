// A horse, for everything horse-drawn in the Victorian city: the carriages the trucks become there
// (truck.ts carriage) and its traffic (city-victorian/victorian-vehicles.ts). A horse is HORSE_PARTS
// rigid parts, each built once (horseParts) and placed every frame by a matrix (poseHorse), so a
// city's traffic can draw a part of every horse of a kind as one instanced mesh. Its pose comes from
// how far it has come (odo), how fast it goes (v), the time (t) and a number of its own (seed),
// alone, so scrubbing replays it: a walk, a trot when it goes faster, and standing, a horse shifts
// its weight, swishes its tail and tosses its head now and then.
//
// The horse's frame: +x forward, y up, z to its right; the origin on the ground under its withers
// (the top of its shoulders), where a collar's traces or a shaft's tug are hitched. Units are metres.
//
// The body is lofted from elliptical rings along its length (loft), flat-shaded like the rest of the
// scene. It wears a carriage horse's harness: a collar and hames, a cart saddle with its girth and
// tugs, a crupper and breeching, and a bridle with blinkers, its reins run back to the hames. Each
// leg is two parts, the upper hung from its elbow or stifle and the lower from its knee or hock,
// set by two-bone inverse kinematics on each hoof's place (poseLeg).
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";

// A horse's size, in its frame: its length from rump to nose (behind and ahead of the origin), its
// withers' height and its width over the barrel; HITCH is where traces attach on its shoulder.
// RUMP is how far behind the origin its buttocks are (its tail hangs on to `back`).
export const HORSE = { back: 1.45, front: 0.95, withers: 1.62, width: 0.62, hitch: [0.1, 1.15] as const, rump: 1.38 };
// The parts: body (with the collar and saddle), neck and head, tail, then the four upper legs (fore
// left, fore right, hind left, hind right) and the four lower legs in the same order.
export const HORSE_PARTS = 11;
export interface HorseState { odo: number; v: number; t: number; seed: number }
// A coat (the body's colour), its mane, tail and lower legs' colour, and its harness's.
export interface HorseLook { coat: number; mane: number; harness: number }
export const HORSE_COATS: readonly HorseLook[] = [
  { coat: 0x6a3e24, mane: 0x241812, harness: 0x1a1412 },   // bay
  { coat: 0x3a2618, mane: 0x16100c, harness: 0x1a1412 },   // dark brown
  { coat: 0x9a6a3a, mane: 0x4a2e1a, harness: 0x1a1412 },   // chestnut
  { coat: 0x8a8a86, mane: 0x3a3a3a, harness: 0x1a1412 },   // grey
  { coat: 0x1c1a1a, mane: 0x0e0c0c, harness: 0x3a1a12 },   // black
];
const hsBRASS = 0xc09a3e, hsHOOF = 0x2a2420, hsEYE = 0x0a0808;

// ---- the legs' skeleton ------------------------------------------------------------------------
// Each leg's top joint in the horse's frame (an elbow before, a stifle behind), its upper and lower
// bones' lengths, and where its hoof stands at rest. Legs are in part order (FL, FR, HL, HR).
interface hsLegSpec { fore: boolean; x: number; y: number; z: number; a: number; b: number; hoof: number }
const hsLEGS: hsLegSpec[] = [
  { fore: true, x: 0.3, y: 0.98, z: -0.155, a: 0.49, b: 0.51, hoof: 0.32 },
  { fore: true, x: 0.3, y: 0.98, z: 0.155, a: 0.49, b: 0.51, hoof: 0.32 },
  { fore: false, x: -0.86, y: 0.98, z: -0.16, a: 0.5, b: 0.58, hoof: -1.02 },
  { fore: false, x: -0.86, y: 0.98, z: 0.16, a: 0.5, b: 0.58, hoof: -1.02 },
];
const hsNECK: [number, number] = [0.3, 1.42];   // the neck's pivot (it nods and tosses about it)
const hsTAIL: [number, number] = [-1.3, 1.5];   // the tail's root

// ---- geometry helpers ----------------------------------------------------------------------------
type hsV3 = [number, number, number];
// A ring of a loft: its middle, its half width across (z) and its half depth in the xy plane,
// square to the loft's path there.
type hsRingSpec = [number, number, number, number, number];   // x, y, z, half width, half depth
// loft wraps rings along a path in the xy plane with `seg` facets round, capping both ends.
function hsLoft(b: Batch, rings: hsRingSpec[], seg: number, color: number, caps = true) {
  const n = rings.length, pts: hsV3[][] = [], mid: hsV3[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y, z, w, h] = rings[i], p = rings[Math.max(0, i - 1)], q = rings[Math.min(n - 1, i + 1)];
    let tx = q[0] - p[0], ty = q[1] - p[1];
    const l = Math.hypot(tx, ty) || 1; tx /= l; ty /= l;
    const vx = -ty, vy = tx;   // (the path's normal in the xy plane: up along a body, forward down a leg)
    const ring: hsV3[] = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      ring.push([x + vx * h * s, y + vy * h * s, z + w * c]);
    }
    pts.push(ring); mid.push([x, y, z]);
  }
  const face: hsV3 = [0, 0, 0];
  const tri = (A: hsV3, B: hsV3, C: hsV3, m: hsV3) => {
    face[0] = (A[0] + B[0] + C[0]) / 3 - m[0]; face[1] = (A[1] + B[1] + C[1]) / 3 - m[1]; face[2] = (A[2] + B[2] + C[2]) / 3 - m[2];
    b.tri(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2], color, face);
  };
  const m: hsV3 = [0, 0, 0];
  for (let i = 0; i + 1 < n; i++) for (let j = 0; j < seg; j++) {
    const k = (j + 1) % seg, A = pts[i][j], B = pts[i + 1][j], C = pts[i + 1][k], D = pts[i][k];
    m[0] = (mid[i][0] + mid[i + 1][0]) / 2; m[1] = (mid[i][1] + mid[i + 1][1]) / 2; m[2] = (mid[i][2] + mid[i + 1][2]) / 2;
    tri(A, B, C, m); tri(A, C, D, m);
  }
  if (!caps) return;
  for (const [i, o] of [[0, 1], [n - 1, n - 2]]) {
    // (A cap faces away from its neighbour ring.)
    for (let j = 0; j < seg; j++) tri(mid[i], pts[i][j], pts[i][(j + 1) % seg], mid[o]);
  }
}
// A thin straight strap or rod from A to B, `w` across and `t` thick (a box along it).
function hsRod(b: Batch, A: hsV3, B: hsV3, w: number, t: number, color: number) {
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], len = Math.hypot(dx, dy, dz) || 1e-3;
  const rz = Math.asin(THREE.MathUtils.clamp(dy / len, -1, 1)), ry = Math.atan2(-dz, dx);
  b.boxR((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2, len, t, w, color, 0, ry, rz);
}
// The body's cross-section at x: its middle's height, half width and half height (the rings the
// barrel is lofted from, hsBODY, read between).
const hsBODY: [number, number, number, number][] = [
  [0.52, 1.17, 0.12, 0.15], [0.45, 1.2, 0.21, 0.26], [0.32, 1.25, 0.27, 0.36], [0.1, 1.27, 0.3, 0.36], [-0.15, 1.26, 0.31, 0.34],
  [-0.45, 1.25, 0.315, 0.32], [-0.75, 1.28, 0.3, 0.31], [-1.0, 1.31, 0.29, 0.31], [-1.18, 1.3, 0.25, 0.28], [-1.3, 1.27, 0.15, 0.19], [-1.34, 1.25, 0.05, 0.08],
];
function hsBodyAt(x: number): [number, number, number] {
  for (let i = 0; i + 1 < hsBODY.length; i++) {
    const p = hsBODY[i], q = hsBODY[i + 1];
    if (x <= p[0] && x >= q[0]) { const f = (p[0] - x) / (p[0] - q[0]); return [p[1] + (q[1] - p[1]) * f, p[2] + (q[2] - p[2]) * f, p[3] + (q[3] - p[3]) * f]; }
  }
  const e = x > hsBODY[0][0] ? hsBODY[0] : hsBODY[hsBODY.length - 1];
  return [e[1], e[2], e[3]];
}
// A strap round the barrel at x, `w` wide along it, standing `out` off the coat; `from` and `to`
// (radians round the ring, 0 at the right side, up positive) give how much of the ring it covers.
function hsBand(b: Batch, x: number, w: number, color: number, from = -Math.PI, to = Math.PI, out = 0.014) {
  const [yc, hw, hh] = hsBodyAt(x), n = 14;
  for (let k = 0; k < n; k++) {
    const a0 = from + (to - from) * k / n, a1 = from + (to - from) * (k + 1) / n;
    const P = (a: number): hsV3 => [x, yc + (hh + out) * Math.sin(a), (hw + out) * Math.cos(a)];
    hsRod(b, P(a0), P(a1), w, 0.02, color);
  }
}
// The barrel's top line (y) at x, and its side (z) at a height.
const hsTopAt = (x: number) => { const [yc, , hh] = hsBodyAt(x); return yc + hh; };
const hsSideAt = (x: number, y: number) => { const [yc, hw, hh] = hsBodyAt(x); const s = THREE.MathUtils.clamp((y - yc) / hh, -1, 1); return hw * Math.sqrt(1 - s * s); };

// The parts' builders, in their own frames (each leg hangs from its elbow, stifle, knee or hock at
// the origin, down its own -y; the neck and head turn about hsNECK, the tail about hsTAIL).
export function horseParts(look: HorseLook): ((b: Batch) => void)[] {
  const coat = look.coat, dark = new THREE.Color(coat).multiplyScalar(0.72).getHex(), H = look.harness;
  const body = (b: Batch) => {
    hsLoft(b, hsBODY.map(([x, y, w, h]) => [x, y, 0, w, h] as hsRingSpec), 12, coat);
    // Shoulders and hind thighs, standing out of the barrel's sides and down to the elbow and stifle.
    for (const z of [-1, 1]) {
      hsLoft(b, [[0.2, 1.5, z * 0.17, 0.1, 0.1], [0.36, 1.2, z * 0.2, 0.11, 0.16], [0.32, 0.98, z * 0.17, 0.085, 0.1]], 8, coat);
      hsLoft(b, [[-1.06, 1.36, z * 0.18, 0.12, 0.2], [-0.98, 1.12, z * 0.2, 0.13, 0.2], [-0.87, 0.94, z * 0.17, 0.1, 0.12]], 8, coat);
      hsLoft(b, [[-1.26, 1.3, z * 0.13, 0.1, 0.12], [-1.2, 1.05, z * 0.16, 0.11, 0.14], [-1.1, 0.84, z * 0.16, 0.08, 0.09]], 8, coat);   // (the back of the thigh, down from the buttock)
    }
    // The collar, round the neck's foot in front of the shoulders and leaning back, its hames up
    // its sides to brass tips, and a terret on top for the reins.
    const cx = 0.44, cy = 1.47, ux = -0.78, uy = 0.63, ra = 0.215, rb = 0.36, n = 14;
    const cp = (a: number, o: number): hsV3 => [cx + ux * (rb + o) * Math.sin(a), cy + uy * (rb + o) * Math.sin(a), (ra + o) * Math.cos(a)];
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      hsRod(b, cp(a0, 0), cp(a1, 0), 0.11, 0.09, H);
      hsRod(b, cp(a0, 0.05), cp(a1, 0.05), 0.04, 0.03, 0x2a2018);
    }
    for (const z of [-1, 1]) {
      const A: hsV3 = [cx - ux * rb * 0.6, cy - uy * rb * 0.6, z * (ra + 0.05)], B: hsV3 = [cx + ux * rb * 0.75, cy + uy * rb * 0.75, z * (ra * 0.55 + 0.05)];
      hsRod(b, A, B, 0.035, 0.03, H);
      b.ico(B[0] + ux * 0.07, B[1] + uy * 0.07, z * ra * 0.45, 0.03, hsBRASS);
      b.box(cx + 0.02, cy - 0.06, z * (ra + 0.07), 0.06, 0.06, 0.03, hsBRASS);   // (the hame tug, where the traces hook on)
    }
    b.cyl(cx + ux * (rb + 0.06), cy + uy * (rb + 0.06), 0, 0.035, 0.015, hsBRASS, 8, Math.PI / 2);
    // The cart saddle over the back, its girth round the barrel, a shaft's tug either side, and
    // its terrets.
    const sx = -0.16, st = hsTopAt(sx);
    b.boxR(sx, st + 0.01, 0, 0.24, 0.05, 0.26, H, 0, 0, 0);
    for (const z of [-1, 1]) b.boxR(sx, st - 0.06, z * 0.17, 0.22, 0.16, 0.04, H, z * 0.7, 0, 0);
    hsBand(b, sx, 0.08, H);
    for (const z of [-1, 1]) {
      b.box(sx, 1.12, z * (hsSideAt(sx, 1.12) + 0.04), 0.14, 0.09, 0.04, H);
      b.cyl(sx, st + 0.06, z * 0.08, 0.025, 0.012, hsBRASS, 8, 0, 0, Math.PI / 2);
    }
    // The crupper along the spine to the tail, and the breeching round the hindquarters with its
    // hip straps over the croup.
    for (let x = sx - 0.12; x > -1.26; x -= 0.12) hsRod(b, [x, hsTopAt(x) + 0.012, 0], [x - 0.12, hsTopAt(x - 0.12) + 0.012, 0], 0.05, 0.02, H);
    const by = 1.12;
    for (const z of [-1, 1]) {
      for (let x = -0.82; x > -1.3; x -= 0.08) hsRod(b, [x, by, z * (hsSideAt(x, by) + 0.014)], [x - 0.08, by, z * (hsSideAt(x - 0.08, by) + 0.014)], 0.07, 0.02, H);
      for (const x of [-0.9, -1.12]) hsRod(b, [x, by, z * (hsSideAt(x, by) + 0.014)], [x, hsTopAt(x) - 0.02, z * 0.08], 0.04, 0.02, H);
    }
    hsRod(b, [-1.3, by, -hsSideAt(-1.3, by) - 0.014], [-1.3, by, hsSideAt(-1.3, by) + 0.014], 0.07, 0.02, H);
  };
  const neck = (b: Batch) => {
    const [px, py] = hsNECK, o = (x: number, y: number) => [x - px, y - py] as const;
    const ring = (x: number, y: number, w: number, h: number): hsRingSpec => [o(x, y)[0], o(x, y)[1], 0, w, h];
    hsLoft(b, [ring(0.2, 1.38, 0.17, 0.33), ring(0.38, 1.58, 0.14, 0.26), ring(0.52, 1.77, 0.115, 0.19), ring(0.62, 1.93, 0.095, 0.13), ring(0.68, 2.03, 0.085, 0.1)], 10, coat);
    // The head, from the poll down to its muzzle, carried high by the bearing rein.
    hsLoft(b, [ring(0.64, 2.05, 0.07, 0.07), ring(0.72, 1.97, 0.095, 0.12), ring(0.81, 1.83, 0.085, 0.115), ring(0.88, 1.7, 0.068, 0.085), ring(0.92, 1.6, 0.065, 0.07), ring(0.94, 1.54, 0.045, 0.04)], 10, coat);
    hsLoft(b, [ring(0.9, 1.63, 0.067, 0.07), ring(0.93, 1.57, 0.064, 0.066), ring(0.945, 1.535, 0.044, 0.04)], 10, dark);   // (the muzzle)
    // The mane along the crest, plaited flat, and a forelock between the ears.
    const crest: [number, number][] = [[0.66, 2.1], [0.6, 2.03], [0.53, 1.93], [0.45, 1.82], [0.37, 1.72], [0.28, 1.64], [0.18, 1.6]];
    for (let k = 0; k + 1 < crest.length; k++) { const [ax, ay] = o(...crest[k]), [bx, by] = o(...crest[k + 1]); hsRod(b, [ax, ay, 0], [bx, by, 0], 0.06, 0.05, look.mane); }
    { const [fx, fy] = o(0.72, 2.0); hsRod(b, [fx - 0.02, fy + 0.05, 0], [fx + 0.03, fy - 0.07, 0], 0.07, 0.025, look.mane); }
    for (const z of [-1, 1]) {
      const [ex, ey] = o(0.66, 2.1);
      b.cone(ex, ey + 0.06, z * 0.05, 0.03, 0.14, coat, 5, z * 0.2, 0, -0.25);
      // Eyes behind blinkers, the bridle's cheek straps and browband, its noseband, the bit's rings,
      // and the reins back along the neck to the hames.
      const [yx, yy] = o(0.77, 1.93);
      b.box(yx, yy, z * 0.097, 0.03, 0.025, 0.01, hsEYE);
      b.boxR(yx - 0.02, yy + 0.005, z * 0.118, 0.11, 0.09, 0.012, H, 0, z * 0.15, 0);
      const [cx0, cy0] = o(0.68, 2.03), [cx1, cy1] = o(0.9, 1.6);
      hsRod(b, [cx0, cy0, z * 0.092], [cx1, cy1, z * 0.07], 0.03, 0.012, H);
      const [nx, ny] = o(0.885, 1.69);
      hsRod(b, [nx, ny, z * 0.075], [nx + 0.07, ny + 0.035, z * 0.06], 0.035, 0.012, H);
      b.cyl(cx1 + 0.01, cy1 - 0.01, z * 0.072, 0.022, 0.01, hsBRASS, 8, Math.PI / 2);
      const [rx, ry] = o(0.32, 1.74);
      hsRod(b, [cx1 + 0.01, cy1 - 0.01, z * 0.075], [0.5 - px + 0.04, 1.66 - py, z * 0.12], 0.02, 0.01, H);
      hsRod(b, [0.5 - px + 0.04, 1.66 - py, z * 0.12], [rx, ry, z * 0.1], 0.02, 0.01, H);
    }
    { const [bx, by] = o(0.71, 2.0); b.box(bx, by, 0, 0.025, 0.03, 0.2, H); }
    { const [nx, ny] = o(0.885, 1.69); hsRod(b, [nx + 0.07, ny + 0.035, -0.06], [nx + 0.07, ny + 0.035, 0.06], 0.035, 0.012, H); }
  };
  const tail = (b: Batch) => {
    hsLoft(b, [[0, 0, 0, 0.045, 0.05], [-0.06, -0.1, 0, 0.06, 0.06], [-0.1, -0.28, 0, 0.075, 0.06], [-0.11, -0.5, 0, 0.08, 0.055], [-0.1, -0.68, 0, 0.065, 0.045], [-0.08, -0.78, 0, 0.03, 0.02]], 7, look.mane);
  };
  // (The legs: the upper coat-coloured, the lower in the points' colour down to dark hooves.)
  const foreUp = (b: Batch) => hsLoft(b, [[0, 0.06, 0, 0.08, 0.1], [0, -0.06, 0, 0.08, 0.1], [0.005, -0.26, 0, 0.06, 0.075], [0, -0.44, 0, 0.048, 0.058], [0, -0.5, 0, 0.052, 0.062]], 8, coat);
  const hindUp = (b: Batch) => {
    hsLoft(b, [[0, 0.06, 0, 0.1, 0.15], [0, -0.12, 0, 0.085, 0.13], [0, -0.36, 0, 0.055, 0.075], [0, -0.48, 0, 0.055, 0.072], [0, -0.52, 0, 0.045, 0.05]], 8, coat);
    b.box(-0.055, -0.48, 0, 0.05, 0.06, 0.06, coat);   // (the point of the hock)
  };
  const lower = (len: number) => (b: Batch) => {
    const hsL = len;
    hsLoft(b, [[0, 0.02, 0, 0.05, 0.06], [0, -0.08, 0, 0.04, 0.045], [0, -(hsL - 0.15), 0, 0.037, 0.044], [0.008, -(hsL - 0.11), 0, 0.045, 0.055], [0.025, -(hsL - 0.07), 0, 0.037, 0.04]], 8, look.mane);
    hsLoft(b, [[0.03, -(hsL - 0.065), 0, 0.048, 0.05], [0.045, -(hsL - 0.005), 0, 0.058, 0.068]], 8, hsHOOF);
  };
  return [body, neck, tail, foreUp, foreUp, hindUp, hindUp, lower(hsLEGS[0].b), lower(hsLEGS[1].b), lower(hsLEGS[2].b), lower(hsLEGS[3].b)];
}

// ---- the gait ------------------------------------------------------------------------------------
// A gait's stride (m a full cycle of the legs), the share of it each hoof stands on the ground, each
// leg's place in the cycle (FL, FR, HL, HR), how high fore and hind hooves lift, and the body's bob
// (twice a cycle) and the head's nod. The walk is four-beat (left hind, left fore, right hind, right
// fore); the trot moves diagonal pairs together, and above hsFAST the trot lengthens.
interface hsGait { S: number; duty: number; off: [number, number, number, number]; liftF: number; liftH: number; bob: number; nod: number }
const hsWALK: hsGait = { S: 1.75, duty: 0.62, off: [0.25, 0.75, 0, 0.5], liftF: 0.12, liftH: 0.09, bob: 0.02, nod: 0.07 };
const hsTROT: hsGait = { S: 2.6, duty: 0.44, off: [0, 0.5, 0.5, 0], liftF: 0.26, liftH: 0.15, bob: 0.045, nod: 0.02 };
const hsFAST: hsGait = { S: 4.2, duty: 0.4, off: [0, 0.5, 0.5, 0], liftF: 0.28, liftH: 0.17, bob: 0.05, nod: 0.015 };
const hsGAITS = [hsWALK, hsTROT, hsFAST];
const hsSWEEP = 1.2;   // m: the furthest a hoof sweeps back under the horse while it stands on it (faster, it slips)
const hsFract = (x: number) => x - Math.floor(x);
const hsSs = THREE.MathUtils.smoothstep;

const hsM4 = new THREE.Matrix4(), hsL = new THREE.Matrix4(), hsQq = new THREE.Quaternion(), hsEe = new THREE.Euler(), hsVv = new THREE.Vector3(), hsOne = new THREE.Vector3(1, 1, 1);
const hsJv = new THREE.Vector3(), hsGw = [0, 0, 0], hsHx = [0, 0, 0, 0], hsHy = [0, 0, 0, 0];
const hsAt = (o: THREE.Matrix4, x: number, y: number, z: number, rx: number, ry: number, rz: number) => o.compose(hsVv.set(x, y, z), hsQq.setFromEuler(hsEe.set(rx, ry, rz)), hsOne);

// poseHorse writes its parts' matrices into out[i..i + HORSE_PARTS), each `base` (the horse's
// frame in its rig's) times the part's place in the horse's frame. `abreast` poses horses abreast
// that share their parts (one part draws them all, off the frame's middle): they turn only about
// z, so they do not roll, shake their heads or swish their tails sideways.
export function poseHorse(s: HorseState, base: THREE.Matrix4, out: THREE.Matrix4[], i: number, abreast = false) {
  const v = Math.abs(s.v), seed = s.seed, sp = hsFract(seed * 0.618);
  // How much it walks, trots or trots on (gw), and how much it is moving at all (go).
  hsGw[2] = hsSs(v, 5.0, 7.0); hsGw[0] = 1 - hsSs(v, 2.0, 2.8); hsGw[1] = Math.max(0, 1 - hsGw[0] - hsGw[2]);
  const go = hsSs(v, 0.02, 0.35);
  // Standing, it rests a hind leg, by turns (rest: the right one, positive; the left, negative),
  // the hip on that side dropped.
  const sw = Math.sin((s.t / (9 + 5 * hsFract(seed * 0.37)) + seed * 3.1) * Math.PI * 2);
  const restR = (1 - go) * hsSs(sw, 0.25, 0.6), restL = (1 - go) * hsSs(-sw, 0.25, 0.6);
  let bob = 0, pitch = 0, nod = 0;
  for (let k = 0; k < 4; k++) { hsHx[k] = 0; hsHy[k] = 0; }
  for (let g = 0; g < 3; g++) {
    const G = hsGAITS[g], w = hsGw[g] * go;
    if (w <= 0) continue;
    const ph = s.odo / G.S + sp, D = Math.min(G.S * G.duty, hsSWEEP);
    bob += w * G.bob * (0.5 - 0.5 * Math.cos(ph * Math.PI * 4));
    pitch += w * 0.012 * Math.sin(ph * Math.PI * 4);
    nod += w * G.nod * Math.sin(ph * Math.PI * 4 + 0.6);
    for (let k = 0; k < 4; k++) {
      const f = hsFract(ph + G.off[k]), lift = hsLEGS[k].fore ? G.liftF : G.liftH;
      let x: number, y: number;
      if (f < G.duty) { x = D / 2 - D * (f / G.duty); y = 0; }
      else { const u = (f - G.duty) / (1 - G.duty), e = u * u * (3 - 2 * u); x = -D / 2 + D * e; y = lift * Math.sin(Math.PI * Math.pow(u, 0.8)); }
      hsHx[k] += w * x; hsHy[k] += w * y;
    }
  }
  // (The resting hoof stands tipped on its toe, a little forward.)
  hsHx[2] += restL * 0.1; hsHy[2] += restL * 0.06; hsHx[3] += restR * 0.1; hsHy[3] += restR * 0.06;
  const roll = abreast ? 0 : 0.035 * (restR - restL);
  // The head tosses now and then, and lowers a little standing; the tail swishes in bursts, and
  // lifts at the trot.
  const toss = Math.pow(Math.max(0, Math.sin((s.t / (7 + 6 * hsFract(seed * 0.71)) + seed * 1.7) * Math.PI * 2)), 14) * (1 - 0.6 * (1 - hsGw[0]) * go);
  const neckZ = nod + 0.35 * toss - 0.1 * (1 - go), neckY = abreast ? 0 : 0.15 * toss * Math.sin(s.t * Math.PI * 6);
  const burst = Math.pow(Math.max(0, Math.sin((s.t / (4.5 + 3 * hsFract(seed * 0.29)) + seed * 2.3) * Math.PI * 2)), 6);
  const tailX = abreast ? 0 : 0.5 * burst * Math.sin(s.t * Math.PI * 2 * 1.6), tailZ = -0.3 * (1 - hsGw[0]) * go;

  // The body: bobbing, pitching a little and rolling to a rested leg.
  hsAt(hsL, 0, -bob - 0.02 * Math.max(restL, restR), 0, roll, 0, pitch);
  out[i].multiplyMatrices(base, hsL);
  out[i + 1].multiplyMatrices(base, hsM4.multiplyMatrices(hsL, hsAt(hsM4, hsNECK[0], hsNECK[1], 0, 0, neckY, neckZ)));
  out[i + 2].multiplyMatrices(base, hsM4.multiplyMatrices(hsL, hsAt(hsM4, hsTAIL[0], hsTAIL[1], 0, tailX, 0, tailZ)));
  // Each leg by two-bone IK from its joint (moved with the body) to its hoof.
  for (let k = 0; k < 4; k++) {
    const G = hsLEGS[k];
    hsJv.set(G.x, G.y, G.z).applyMatrix4(hsL);
    const tx = G.hoof + hsHx[k], ty = hsHy[k];
    let dx = tx - hsJv.x, dy = ty - hsJv.y, d = Math.hypot(dx, dy);
    const dMax = G.a + G.b - 0.004, dMin = Math.abs(G.a - G.b) + 0.05;
    if (d > dMax) { dx *= dMax / d; dy *= dMax / d; d = dMax; } else if (d < dMin) { dx *= dMin / d; dy *= dMin / d; d = dMin; }
    const al = Math.atan2(dy, dx), A = Math.acos(THREE.MathUtils.clamp((G.a * G.a + d * d - G.b * G.b) / (2 * G.a * d), -1, 1));
    const up = al + (G.fore ? A : -A);   // (a knee bends forward of the line, a hock back)
    const kx = hsJv.x + G.a * Math.cos(up), ky = hsJv.y + G.a * Math.sin(up);
    const lo = Math.atan2(hsJv.y + dy - ky, hsJv.x + dx - kx);
    out[i + 3 + k].multiplyMatrices(base, hsAt(hsM4, hsJv.x, hsJv.y, G.z, 0, 0, up + Math.PI / 2));
    out[i + 7 + k].multiplyMatrices(base, hsAt(hsM4, kx, ky, G.z, 0, 0, lo + Math.PI / 2));
  }
}
