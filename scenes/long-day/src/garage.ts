// A parking garage with a rooftop stop (facilities.ts "garage" site; route.ts drives it): a deck
// of parking over the ground floor, a ramp up one side and down the other, a level lane across the
// back of the roof where trucks stop, and the receiver's stair-and-lift tower beside it. Block-
// local, in the frontage frame of the side the truck comes along (city.ts frontPt: `a` along the
// street from the node, `n` into the block from its edge).
import { Batch } from "./geom.ts";
import { hash2 } from "./rng.ts";
import { carKindAt, carPaintAt, parkedCar } from "./cars.ts";
import { GARAGE_H, Path, trackSweep } from "./route.ts";
import type { Pose } from "./route.ts";
import { frontPt, FRONT_NODE } from "./city.ts";
import type { Rand } from "./city.ts";

// The way in starts at the kerb lane GARAGE_IN_A along the frontage; the truck stops on the roof at
// GARAGE_STOP (rear axle), and the receiver's door is GARAGE_DOOR (frontage a, n), facing it.
export const GARAGE_IN_A = 12;
export const GARAGE_STOP: [number, number] = [29, 36];
export const GARAGE_DOOR: [number, number] = [32.5, 40.2];
export const GARAGE_DRIVE: [number, number] = [13, 50];   // the kerb cut along the frontage (no furniture)
const DECK = 0x9a978e, DECK_TOP = 0x6f6e6a, RAIL = 0xb5b2a8, COLUMN = 0x8d8a82, STRIPE = 0xe8e2c0;

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


const my2 = (a: number, b: number) => (a + b) / 2;
// (`cars` says whether cars stand in its bays; there are none in the storybook city, which has only its own vehicles.)
export function buildGarage(ground: Batch, solid: Batch, side: number, rnd: Rand, seed: number, cars = true) {
  const H = GARAGE_H, h = heading(side);
  // The ground floor's slab and its painted bays.
  // (Its sides a cm inside the block's edges and from the road's top up: where they met the
  // street's asphalt and the lots' ground in one plane, they flickered.)
  fbox(ground, side, 9.01, 50.99, 0.01, 41.99, 0, 0.03, 0x8d8a82);
  // The roof deck: everywhere over the middle of the block and across its back that the ramps'
  // decks don't cover (garageRoof), so it meets them without gaps; its edges walled except where
  // a ramp comes up level with it (cars drive on and off there). Columns under it.
  const R = garageRoof(), { a0: RA, n0: RN, cell: RC } = R;
  for (let j = 0; j < R.nn; j++) {
    for (let i = 0; i < R.na; ) {
      if (R.slab[j * R.na + i] !== 1) { i++; continue; }
      let e = i; while (e < R.na && R.slab[j * R.na + e] === 1) e++;
      const a0 = RA + i * RC, a1 = RA + e * RC, n0 = RN + j * RC, n1 = n0 + RC;
      fbox(solid, side, a0, a1, n0, n1, H - 0.5, H - 0.1, DECK); fbox(solid, side, a0, a1, n0, n1, H - 0.1, H - 0.05, DECK_TOP);
      i = e;
    }
  }
  for (const w of R.walls) fbox(solid, side, w[0], w[1], w[2], w[3], H - 0.05, H + 1.0, RAIL);
  const columns: [number, number][] = [];
  for (let a = 24; a <= 40; a += 8) for (let n = 5; n <= 33; n += 7) if (R.at(a, n) === 1) { columns.push([a, n]); const [x, z] = fp(side, a, n); solid.box(x, (H - 0.5) / 2, z, 0.6, H - 0.5, 0.6, COLUMN); }
  // (No car in a bay under the deck that a column stands in, or that would be nose to it.)
  const columnIn = (a: number, n: number) => columns.some(([ca, cn]) => Math.abs(ca - a) < 1.35 && Math.abs(cn - n) < 2.75);
  // Parked cars: in the bays under the deck and on it, and the bays' lines.
  for (let row = 0; row < 2; row++) for (let k = 0; k < 7; k++) {
    const a = 24.6 + k * 2.6, n = row ? 26 : 9.5;
    for (const [y, salt] of [[0.03, 1], [H - 0.05, 2]] as const) {
      // (Only where the deck is: on the roof, not out over a ramp; underneath, clear of one.)
      const here = (a: number, n: number) => (y < 1 ? R.at(a, n) !== 2 : R.at(a, n) === 1);
      const [lx, lz] = fp(side, a - 1.3, n);
      if (here(a - 1.3, n - 2.4) && here(a - 1.3, n + 2.4)) (y < 1 ? ground : solid).box(lx, y + 0.01, lz, 0.1, 0.02, 4.8, STRIPE, h);
      if (cars && hash2(k + row * 7, salt, seed, 0x9a7) < 0.62 && [-1, 1].every((u) => here(a + u, n - 2.4) && here(a + u, n + 2.4)) && !(y < 1 && columnIn(a, n))) {
        // Nose in (towards the bay's back: the deck's edge or the back wall), cars in car-sized bays.
        const [x, z] = fp(side, a, n), r = hash2(k, row + salt * 3, seed, 0xca7);
        parkedCar(solid, carKindAt(r * 7 % 1, false), x, y, z, h + (row ? -1 : 1) * Math.PI / 2, carPaintAt(r));
      }
    }
  }
  // The ramps: the deck under each track, eased to the ground at its ends; low walls up the sides.
  // One continuous surface along each track (sampled finely, so it follows the turns without
  // gaps): the deck's top, sides and underside, a parapet along each edge once it is up, and
  // under it a solid wall low down, columns higher up.
  const { up, down } = garageTracks(side), p: Pose = { x: 0, z: 0, h: 0, k: 0 };
  // Whether a block-local point is over the roof deck.
  const [nx0, nz0, nd] = FRONT_NODE[side], FW = [[1, 0], [0, -1], [-1, 0], [0, 1]][nd], RT = [[0, 1], [1, 0], [0, -1], [-1, 0]][nd];
  const slabAt = (x: number, z: number) => R.at((x - nx0) * FW[0] + (z - nz0) * FW[1], (x - nx0) * RT[0] + (z - nz0) * RT[1] - 9) === 1;
  type V = [number, number, number];
  // (In the ground batch, like a road: the truck's see-through spotlight leaves it be.)
  const quadIn = (bt: Batch, a: V, b: V, c: V, d: V, color: number, face: V) => { bt.tri(...a, ...b, ...c, color, face); bt.tri(...a, ...c, ...d, color, face); };
  const quad = (a: V, b: V, c: V, d: V, color: number, face: V) => quadIn(ground, a, b, c, d, color, face);
  for (const [t, kind] of [[up, "up"], [down, "down"]] as const) {
    // (Its deck widened through the turns to the truck's swept path: route.ts trackSweep.)
    const STEP = 0.75, pts: { x: number; z: number; y: number; rx: number; rz: number }[] = [], sw = trackSweep(kind, 3.1, STEP);
    const E = (i: number, k: number) => (k < 0 ? sw.l[Math.min(i, sw.l.length - 1)] : sw.r[Math.min(i, sw.r.length - 1)]);
    for (let s = 0; s <= t.length + 1e-6; s += STEP) { const ss = Math.min(s, t.length); t.eval(ss, p); pts.push({ x: p.x, z: p.z, y: t.yAt(ss), rx: Math.sin(p.h), rz: Math.cos(p.h) }); }
    // (The way up's deck runs on to where the way down's starts, so they meet.)
    if (kind === "up") {
      const e = pts[pts.length - 1], d = (down.eval(0, p), (p.x - e.x) * e.rz - (p.z - e.z) * e.rx);
      if (d > 0.01) pts.push({ ...e, x: e.x + e.rz * d, z: e.z - e.rx * d });
    }
    // The point n across from sample i, at height y above the deck's top.
    const at = (i: number, n: number, dy: number): V => { const q = pts[i]; return [q.x + q.rx * n, q.y - 0.01 + dy, q.z + q.rz * n]; };
    // Whether the roof deck is just beyond its edge e on side k at sample i.
    const slabBeside = (i: number, e: number, k: number) => [0.3, 0.6, 1.0].some((d) => { const [x, , z] = at(i, e + k * d, 0); return slabAt(x, z); });
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.max(a.y, b.y) < 0.04) continue;
      const T = 0.38, out: V = [b.x - a.x, 0, b.z - a.z], rx = (a.rx + b.rx) / 2, rz = (a.rz + b.rz) / 2;
      const la = E(i, -1), lb = E(i + 1, -1), ra = E(i, 1), rb = E(i + 1, 1);
      // (In strips across, so through the turns, where its inner edge climbs more steeply than its
      // outer, its facets stay small.)
      for (let u = 0; u < 6; u++) {
        const f0 = u / 6, f1 = (u + 1) / 6, A = (x: number, y: number, f: number) => x + (y - x) * f;
        quad(at(i, A(la, ra, f0), 0), at(i, A(la, ra, f1), 0), at(i + 1, A(lb, rb, f1), 0), at(i + 1, A(lb, rb, f0), 0), DECK_TOP, [0, 1, 0]);
      }
      quad(at(i, la, -T), at(i, ra, -T), at(i + 1, rb, -T), at(i + 1, lb, -T), DECK, [0, -1, 0]);
      for (const k of [-1, 1]) {
        const side: V = [rx * k, 0, rz * k], my = (a.y + b.y) / 2, ea = k < 0 ? la : ra, eb = k < 0 ? lb : rb;
        // The deck's edge, down to the ground where it is low (a wall under it).
        const lo = my < 2.2 ? -a.y + 0.01 : -T, lob = my < 2.2 ? -b.y + 0.01 : -T;
        quad(at(i, ea, lo), at(i + 1, eb, lob), at(i + 1, eb, 0), at(i, ea, 0), my < 2.2 ? COLUMN : DECK, side);
        // Where the roof deck is beside it, the deck's edge follows the ramp's exactly (a strip of
        // deck out from its edge, over the cells the ramp only partly covers): its face down to the
        // deck's underside, and a parapet on it while the ramp is still well below. No walls on
        // either where the ramp has come up level with it: cars drive between them.
        const sa = slabBeside(i, ea, k), sb = slabBeside(i + 1, eb, k), low = Math.min(a.y, b.y) < H - 0.6;
        if (Math.min(a.y, b.y) > 0.6 && (low || !(sa && sb))) {
          const n0a = ea - k * 0.22, n0b = eb - k * 0.22;
          quad(at(i, n0a, 0), at(i + 1, n0b, 0), at(i + 1, n0b, 0.85), at(i, n0a, 0.85), RAIL, [-side[0], 0, -side[2]]);
          quad(at(i, ea, 0), at(i + 1, eb, 0), at(i + 1, eb, 0.85), at(i, ea, 0.85), RAIL, side);
          quad(at(i, n0a, 0.85), at(i, ea, 0.85), at(i + 1, eb, 0.85), at(i + 1, n0b, 0.85), RAIL, [0, 1, 0]);
        }
        if (sa || sb) {
          const Y = H - 0.05, P = (j: number, n: number, y: number): V => { const q = pts[j]; return [q.x + q.rx * n, y, q.z + q.rz * n]; };
          // (Tapering away where the deck beside it ends, not out over nothing.)
          const ka = sa ? 0.9 * k : 0, kb = sb ? 0.9 * k : 0;
          quadIn(solid, P(i, ea, Y), P(i + 1, eb, Y), P(i + 1, eb + kb, Y), P(i, ea + ka, Y), DECK_TOP, [0, 1, 0]);
          quadIn(solid, P(i, ea, H - 0.5), P(i + 1, eb, H - 0.5), P(i + 1, eb + kb, H - 0.5), P(i, ea + ka, H - 0.5), DECK, [0, -1, 0]);
          // (Its face a cm out from the ramp's edge, where the ramp's parapet faces the same way.)
          quadIn(solid, P(i, ea + k * 0.01, H - 0.5), P(i + 1, eb + k * 0.01, H - 0.5), P(i + 1, eb + k * 0.01, Y), P(i, ea + k * 0.01, Y), DECK, side);
          if (low) {
            const o = 0.25, ta = H + 1.0;
            quadIn(solid, P(i, ea, Y), P(i + 1, eb, Y), P(i + 1, eb, ta), P(i, ea, ta), RAIL, side);
            quadIn(solid, P(i, ea + k * o, Y), P(i + 1, eb + k * o, Y), P(i + 1, eb + k * o, ta), P(i, ea + k * o, ta), RAIL, [-side[0], 0, -side[2]]);
            quadIn(solid, P(i, ea, ta), P(i + 1, eb, ta), P(i + 1, eb + k * o, ta), P(i, ea + k * o, ta), RAIL, [0, 1, 0]);
            // (Its end, where the ramp comes up level and it stops.)
            if (i + 2 < pts.length && Math.min(b.y, pts[i + 2].y) >= H - 0.6) quadIn(solid, P(i + 1, eb, Y), P(i + 1, eb + k * o, Y), P(i + 1, eb + k * o, ta), P(i + 1, eb, ta), RAIL, out);
            if (i > 0 && Math.min(pts[i - 1].y, a.y) >= H - 0.6) quadIn(solid, P(i, ea, Y), P(i, ea + k * o, Y), P(i, ea + k * o, ta), P(i, ea, ta), RAIL, [-out[0], 0, -out[2]]);
          }
        }
      }
      // Its ends where it meets the ground or another deck: closed off.
      if (i === 0 || Math.max(pts[i - 1].y, a.y) < 0.04) quad(at(i, la, -T), at(i, ra, -T), at(i, ra, 0), at(i, la, 0), DECK, [-out[0], 0, -out[2]]);
      if (my2(a.y, b.y) >= 2.2 && i % 8 === 0) solid.box(a.x, (a.y - 0.39) / 2, a.z, 0.6, a.y - 0.39, 0.6, COLUMN);
    }
  }
  // The receiver's stair and lift tower on the roof, its door facing the lane.
  fbox(solid, side, 29.5, 35.5, 40.2, 41.97, H - 0.01, H + 3.3, 0xd8d2c4);   // (its back inside the wall along the deck's edge: shared planes flicker)
  fbox(solid, side, 29.3, 35.7, 40.0, 42, H + 3.3, H + 3.6, 0x5b6470);
  fbox(solid, side, GARAGE_DOOR[0] - 0.62, GARAGE_DOOR[0] + 0.62, 40.15, 40.2, H, H + 2.35, 0xf2efe8);   // door frame
  fbox(solid, side, GARAGE_DOOR[0] - 0.55, GARAGE_DOOR[0] + 0.55, 40.13, 40.17, H + 0.01, H + 2.25, 0x23365e);   // the door
  // A "P" sign on a post at the corner where the ramp up begins.
  const [sx, sz] = fp(side, 15.5, 1.2);
  solid.cyl(sx, 2.25, sz, 0.08, 4.5, 0x3a3d40, 6);   // (up to the sign's foot: its faces met the sign's)
  solid.box(sx, 5.2, sz, 1.4, 1.4, 0.14, 0x1f4fa8, h);
  solid.box(sx + Math.sin(h) * 0.08, 5.2, sz + Math.cos(h) * 0.08, 0.16, 0.9, 0.04, 0xf2f2ee, h);
  solid.box(sx + Math.sin(h) * 0.08 + Math.cos(h) * 0.18, 5.42, sz + Math.cos(h) * 0.08 - Math.sin(h) * 0.18, 0.4, 0.46, 0.04, 0xf2f2ee, h);
  void rnd;
}

// The roof deck as cells (frontage frame, the same for every side, so worked out once): 1 where
// the deck is, 2 where a ramp's deck is (its height in `y`), 0 open. Its edges' walls, as runs
// of [a0, a1, n0, n1]: round its outside, and against a ramp where that is still well below it.
interface GarageRoof { a0: number; n0: number; cell: number; na: number; nn: number; slab: Uint8Array; rampY: Float32Array; walls: [number, number, number, number][]; at: (a: number, n: number) => number }
let GARAGE_ROOF: GarageRoof | null = null;
function garageRoof(): GarageRoof {
  if (GARAGE_ROOF) return GARAGE_ROOF;
  const H = GARAGE_H, C = 0.5, A0 = 12, A1 = 50.5, N0 = 2.5, N1 = 42.5, na = Math.round((A1 - A0) / C), nn = Math.round((N1 - N0) / C);
  // (All of it between the ramps' outer sides, so the deck runs right up to them along their whole
  // length: no slot between a ramp and the deck to see down through.)
  // (Not in the back corners, outside the ramps' turns: there their own walls are the edge.)
  const inside = (a: number, n: number) => a > 17.5 && a < 48 && n > 3 && (n < 36 || (a > 25 && a < 41 && n < 42));
  // The ramps' decks, sampled, in this frame (x = a, z = n): which cells they cover, and how high.
  const cover = new Int8Array(na * nn), rampY = new Float32Array(na * nn).fill(-1), q: Pose = { x: 0, z: 0, h: 0, k: 0 };
  for (const [t, kind] of [[Path.garageTrack(false, GARAGE_IN_A, -4.5, 0), "up"], [Path.garageTrack(true, GARAGE_STOP[0], GARAGE_STOP[1], 0), "down"]] as const) {
    const STEP = 0.75, sw = trackSweep(kind, 3.1, STEP);
    for (let i = 0, s = 0; s <= t.length + 1e-6; i++, s += STEP) {
      const ss = Math.min(s, t.length), y = t.yAt(ss);
      t.eval(ss, q);
      const fx = Math.cos(q.h), fz = -Math.sin(q.h), rx = Math.sin(q.h), rz = Math.cos(q.h), l = sw.l[Math.min(i, sw.l.length - 1)], r = sw.r[Math.min(i, sw.r.length - 1)];
      // (The two meet where the way down starts, GARAGE_STOP: the way up's deck runs on to it.)
      const last = ss >= t.length - 1e-6;
      for (let u = -STEP / 2 - 0.1; u <= (last ? 2 : STEP / 2 + 0.1); u += 0.2) for (let o = l; o <= r + 1e-6; o += 0.2) {
        const a = q.x + fx * u + rx * o, n = q.z + fz * u + rz * o, ci = Math.floor((a - A0) / C), cj = Math.floor((n - N0) / C);
        if (ci < 0 || cj < 0 || ci >= na || cj >= nn) continue;
        if (n > 30 && (kind === "up" ? a > GARAGE_STOP[0] : a < GARAGE_STOP[0])) continue;
        const k = cj * na + ci; cover[k] = 1; rampY[k] = Math.max(rampY[k], y);
      }
    }
  }
  const slab = new Uint8Array(na * nn);
  for (let j = 0; j < nn; j++) for (let i = 0; i < na; i++) { const k = j * na + i; if (cover[k]) slab[k] = 2; else if (inside(A0 + (i + 0.5) * C, N0 + (j + 0.5) * C)) slab[k] = 1; }
  // (No slivers of it, under 2 m across, between a ramp and the block's edge: there the ramp's
  // own wall is the edge.)
  const Q = 4, full = new Uint8Array(na * nn);
  for (let j = 0; j + Q <= nn; j++) for (let i = 0; i + Q <= na; i++) {
    let ok = 1;
    for (let dj = 0; dj < Q && ok; dj++) for (let di = 0; di < Q; di++) if (slab[(j + dj) * na + i + di] !== 1) { ok = 0; break; }
    full[j * na + i] = ok;
  }
  for (let j = 0; j < nn; j++) for (let i = 0; i < na; i++) {
    if (slab[j * na + i] !== 1) continue;
    let keep = false;
    for (let dj = 0; dj < Q && !keep; dj++) for (let di = 0; di < Q; di++) if (j - dj >= 0 && i - di >= 0 && full[(j - dj) * na + i - di]) { keep = true; break; }
    if (!keep) slab[j * na + i] = 0;
  }
  // Walls along its edges that face open air, in straight runs (against a ramp, the ramp's own
  // edge is walled where it runs along it: see buildGarage).
  const walls: [number, number, number, number][] = [], W = 0.3;
  const open = (i: number, j: number) => i < 0 || j < 0 || i >= na || j >= nn || slab[j * na + i] === 0;
  const deck = (i: number, j: number) => slab[j * na + i] === 1;
  for (let j = 0; j < nn; j++) for (const [dj, lo] of [[-1, true], [1, false]] as const) {
    for (let i = 0; i < na; ) {
      if (!(deck(i, j) && open(i, j + dj))) { i++; continue; }
      let e = i; while (e < na && deck(e, j) && open(e, j + dj)) e++;
      const n0 = N0 + j * C; walls.push([A0 + i * C, A0 + e * C, lo ? n0 : n0 + C - W, lo ? n0 + W : n0 + C]); i = e;
    }
  }
  for (let i = 0; i < na; i++) for (const [di, lo] of [[-1, true], [1, false]] as const) {
    for (let j = 0; j < nn; ) {
      if (!(deck(i, j) && open(i + di, j))) { j++; continue; }
      let e = j; while (e < nn && deck(i, e) && open(i + di, e)) e++;
      const a0 = A0 + i * C; walls.push([lo ? a0 : a0 + C - W, lo ? a0 + W : a0 + C, N0 + j * C, N0 + e * C]); j = e;
    }
  }
  const at = (a: number, n: number) => { const i = Math.floor((a - A0) / C), j = Math.floor((n - N0) / C); return i < 0 || j < 0 || i >= na || j >= nn ? 0 : slab[j * na + i]; };
  return (GARAGE_ROOF = { a0: A0, n0: N0, cell: C, na, nn, slab, rampY, walls, at });
}
