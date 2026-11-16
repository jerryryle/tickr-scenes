// A parking garage with a rooftop stop (facilities.ts "garage" site; route.ts drives it): a deck
// of parking over the ground floor, a ramp up one side and down the other, a level lane across the
// back of the roof where trucks stop, and the receiver's stair-and-lift tower beside it. Block-
// local, in the frontage frame of the side the truck comes along (city.ts frontPt: `a` along the
// street from the node, `n` into the block from its edge).
import { Batch } from "./geom.ts";
import { hash2 } from "./rng.ts";
import { GARAGE_H, Path } from "./route.ts";
import type { Pose } from "./route.ts";
import { frontPt } from "./city.ts";
import type { Rand } from "./city.ts";

// The way in starts at the kerb lane GARAGE_IN_A along the frontage; the truck stops on the roof at
// GARAGE_STOP (rear axle), and the receiver's door is GARAGE_DOOR (frontage a, n), facing it.
export const GARAGE_IN_A = 12;
export const GARAGE_STOP: [number, number] = [29, 36];
export const GARAGE_DOOR: [number, number] = [28, 40.2];
export const GARAGE_DRIVE: [number, number] = [13, 50];   // the kerb cut along the frontage (no furniture)
const DECK = 0x9a978e, DECK_TOP = 0x6f6e6a, RAIL = 0xb5b2a8, COLUMN = 0x8d8a82, STRIPE = 0xe8e2c0;
const CARS = [0xc0392b, 0x2e6fb2, 0xe8e8e0, 0x2a2b2e, 0x8a9aa6, 0x2e8b57, 0xe0a020];

// The heading of travel along a side (as FRONT_NODE's directions).
const SIDE_DIR = [0, 2, 1, 3];
const heading = (side: number) => SIDE_DIR[side] * Math.PI / 2;
// Frontage (a, n) to block-local (x, z).
const fp = (side: number, a: number, n: number) => frontPt(side, a, n);
// The two tracks (block-local), for drawing and for the stop's pose.
export function garageTracks(side: number): { up: Path; down: Path } {
  const h = heading(side), [ux, uz] = fp(side, GARAGE_IN_A, -4.5), [dx, dz] = fp(side, GARAGE_STOP[0], GARAGE_STOP[1]);
  return { up: Path.garageTrack(false, ux, uz, h), down: Path.garageTrack(true, dx, dz, h) };
}

// A box between two frontage corners (axis-aligned in block-local space), y0..y1.
function fbox(b: Batch, side: number, a0: number, a1: number, n0: number, n1: number, y0: number, y1: number, color: number) {
  const [x0, z0] = fp(side, a0, n0), [x1, z1] = fp(side, a1, n1);
  b.span(Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1), color);
}

function car(b: Batch, x: number, y: number, z: number, yaw: number, color: number) {
  b.box(x, y + 0.65, z, 4.2, 0.7, 1.8, color, yaw);
  b.box(x - Math.cos(yaw) * 0.3, y + 1.22, z + Math.sin(yaw) * 0.3, 2.0, 0.5, 1.5, 0x4a5868, yaw);
}

const my2 = (a: number, b: number) => (a + b) / 2;
export function buildGarage(ground: Batch, solid: Batch, side: number, rnd: Rand, seed: number) {
  const H = GARAGE_H, h = heading(side);
  // The ground floor's slab and its painted bays.
  fbox(ground, side, 9, 51, 0, 42, -0.05, 0.03, 0x8d8a82);
  // The roof deck: over the middle of the block, and the level lane across the back.
  const roof: [number, number, number, number][] = [[22.6, 41.4, 3, 33.2], [25.5, 38.5, 33.2, 42]];
  for (const [a0, a1, n0, n1] of roof) { fbox(solid, side, a0, a1, n0, n1, H - 0.45, H - 0.06, DECK); fbox(solid, side, a0 + 0.05, a1 - 0.05, n0 + 0.05, n1 - 0.05, H - 0.06, H - 0.01, DECK_TOP); }
  // Its parapets (open where the ramps and the back lane meet it) and the columns under it.
  fbox(solid, side, 22.6, 41.4, 3, 3.3, H - 0.01, H + 1.0, RAIL);
  fbox(solid, side, 22.6, 22.9, 3, 31, H - 0.01, H + 1.0, RAIL);
  fbox(solid, side, 41.1, 41.4, 3, 31, H - 0.01, H + 1.0, RAIL);
  for (let a = 24; a <= 40; a += 8) for (let n = 5; n <= 33; n += 7) { const [x, z] = fp(side, a, n); solid.box(x, (H - 0.45) / 2, z, 0.6, H - 0.45, 0.6, COLUMN); }
  // Parked cars: in the bays under the deck and on it, and the bays' lines.
  for (let row = 0; row < 2; row++) for (let k = 0; k < 7; k++) {
    const a = 24.6 + k * 2.6, n = row ? 26 : 9.5;
    for (const [y, salt] of [[0.03, 1], [H - 0.01, 2]] as const) {
      const [lx, lz] = fp(side, a - 1.3, n); (y < 1 ? ground : solid).box(lx, y + 0.01, lz, 0.1, 0.02, 4.8, STRIPE, h);
      if (hash2(k + row * 7, salt, seed, 0x9a7) < 0.62) { const [x, z] = fp(side, a, n); car(solid, x, y, z, h + Math.PI / 2, CARS[Math.floor(hash2(k, row + salt * 3, seed, 0xca7) * CARS.length)]); }
    }
  }
  // The ramps: the deck under each track, eased to the ground at its ends; low walls up the sides.
  // One continuous surface along each track (sampled finely, so it follows the turns without
  // gaps): the deck's top, sides and underside, a parapet along each edge once it is up, and
  // under it a solid wall low down, columns higher up.
  const { up, down } = garageTracks(side), p: Pose = { x: 0, z: 0, h: 0, k: 0 };
  type V = [number, number, number];
  const quad = (a: V, b: V, c: V, d: V, color: number, face: V) => { solid.tri(...a, ...b, ...c, color, face); solid.tri(...a, ...c, ...d, color, face); };
  for (const t of [up, down]) {
    const STEP = 0.75, pts: { x: number; z: number; y: number; rx: number; rz: number }[] = [];
    for (let s = 0; s <= t.length + 1e-6; s += STEP) { const ss = Math.min(s, t.length); t.eval(ss, p); pts.push({ x: p.x, z: p.z, y: t.yAt(ss), rx: Math.sin(p.h), rz: Math.cos(p.h) }); }
    // The point n across from sample i, at height y above the deck's top.
    const at = (i: number, n: number, dy: number): V => { const q = pts[i]; return [q.x + q.rx * n, q.y - 0.01 + dy, q.z + q.rz * n]; };
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.max(a.y, b.y) < 0.04) continue;
      const W = 3.1, T = 0.38, out: V = [b.x - a.x, 0, b.z - a.z], rx = (a.rx + b.rx) / 2, rz = (a.rz + b.rz) / 2;
      quad(at(i, -W, 0), at(i, W, 0), at(i + 1, W, 0), at(i + 1, -W, 0), DECK_TOP, [0, 1, 0]);
      quad(at(i, -W, -T), at(i, W, -T), at(i + 1, W, -T), at(i + 1, -W, -T), DECK, [0, -1, 0]);
      for (const k of [-1, 1]) {
        const side: V = [rx * k, 0, rz * k], my = (a.y + b.y) / 2;
        // The deck's edge, down to the ground where it is low (a wall under it).
        const lo = my < 2.2 ? -a.y + 0.01 : -T, lob = my < 2.2 ? -b.y + 0.01 : -T;
        quad(at(i, k * W, lo), at(i + 1, k * W, lob), at(i + 1, k * W, 0), at(i, k * W, 0), my < 2.2 ? COLUMN : DECK, side);
        if (Math.min(a.y, b.y) > 0.6) {
          const n0 = k * (W - 0.22), n1 = k * W;
          quad(at(i, n0, 0), at(i + 1, n0, 0), at(i + 1, n0, 0.85), at(i, n0, 0.85), RAIL, [-side[0], 0, -side[2]]);
          quad(at(i, n1, 0), at(i + 1, n1, 0), at(i + 1, n1, 0.85), at(i, n1, 0.85), RAIL, side);
          quad(at(i, n0, 0.85), at(i, n1, 0.85), at(i + 1, n1, 0.85), at(i + 1, n0, 0.85), RAIL, [0, 1, 0]);
        }
      }
      // Its ends where it meets the ground or another deck: closed off.
      if (i === 0 || Math.max(pts[i - 1].y, a.y) < 0.04) quad(at(i, -W, -T), at(i, W, -T), at(i, W, 0), at(i, -W, 0), DECK, [-out[0], 0, -out[2]]);
      if (my2(a.y, b.y) >= 2.2 && i % 8 === 0) solid.box(a.x, (a.y - 0.39) / 2, a.z, 0.6, a.y - 0.39, 0.6, COLUMN);
    }
  }
  // The receiver's stair and lift tower on the roof, its door facing the lane.
  fbox(solid, side, 25, 31, 40.2, 42, H - 0.01, H + 3.3, 0xd8d2c4);
  fbox(solid, side, 24.8, 31.2, 40.0, 42, H + 3.3, H + 3.6, 0x5b6470);
  fbox(solid, side, GARAGE_DOOR[0] - 0.62, GARAGE_DOOR[0] + 0.62, 40.15, 40.2, H, H + 2.35, 0xf2efe8);   // door frame
  fbox(solid, side, GARAGE_DOOR[0] - 0.55, GARAGE_DOOR[0] + 0.55, 40.13, 40.17, H, H + 2.25, 0x23365e);   // the door
  // A "P" sign on a post at the corner where the ramp up begins.
  const [sx, sz] = fp(side, 15.5, 1.2);
  solid.cyl(sx, 2.4, sz, 0.08, 4.8, 0x3a3d40, 6);
  solid.box(sx, 5.2, sz, 1.4, 1.4, 0.14, 0x1f4fa8, h);
  solid.box(sx + Math.sin(h) * 0.08, 5.2, sz + Math.cos(h) * 0.08, 0.16, 0.9, 0.04, 0xf2f2ee, h);
  solid.box(sx + Math.sin(h) * 0.08 + Math.cos(h) * 0.18, 5.42, sz + Math.cos(h) * 0.08 - Math.sin(h) * 0.18, 0.4, 0.46, 0.04, 0xf2f2ee, h);
  void rnd;
}
