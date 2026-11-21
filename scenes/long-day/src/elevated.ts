// A metro city's elevated lines carried on out of town: from the city's east and west edges, each
// line runs straight on for ELEVATED_REACH metres, so it goes off into the distance instead of
// stopping at the edge of town (the trains run its whole length: ambient.ts). Out of town it comes
// down: just past the edge street the same deck on the same bents dips down until it meets the
// ground, where it becomes plain track on ballast. Where a road the truck uses crosses its path
// it rises again on the same ramps and crosses on a short viaduct, its bents clear of the road.
// Built in pieces of a few blocks (so the camera's view leaves out the ones behind it).
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { disposeTree } from "./chunks.ts";
import { EL_COLUMNS, EL_DECK, EL_RAIL, EL_STEEL, ELEVATED_REACH, ELEVATED_Y, elevatedBent } from "./decor.ts";
import { CITY_HI, CITY_LO, CityPlan } from "./city.ts";
import { BLOCK, STREET } from "./grid.ts";
import { CountryRoad } from "./country.ts";

const REACH_PIECE = 8;                         // blocks per piece
const EL_TOP = ELEVATED_Y + 0.5, EL_GRADE = 0.3;    // the track's top: on the deck, and on the ballast at ground level
const EL_RAMP = 220;                              // a ramp's length (cosine-eased: at most about 5% at its middle)
const RAMP_SEG = 10;                           // the ramps are built in straight pieces this long (1 cm off the curve at most)
const EL_BENT_STEP = 20;

// The parts of each line (by its row) at full height, as world-x ranges: the town and, out of town,
// a bridge over each road. Between them the line eases down to the ground and back up.
const EL_FLATS = new Map<number, [number, number][]>();
const townFlat = (): [number, number] => [CITY_LO * BLOCK - 6, (CITY_HI + 1) * BLOCK + STREET + 6];
function liftFrom(a: number, b: number, x: number) {
  const d = x < a ? a - x : x > b ? x - b : 0;
  return d >= EL_RAMP ? 0 : (1 + Math.cos((Math.PI * d) / EL_RAMP)) / 2;
}
// How far up (0 on the ground, 1 at full height) line `cz` is at world x.
export function elevatedLift(cz: number, x: number) {
  const [a, b] = townFlat();
  let f = liftFrom(a, b, x);
  for (const r of EL_FLATS.get(cz) ?? []) { if (f >= 1) break; f = Math.max(f, liftFrom(r[0], r[1], x)); }
  return f;
}
// The height of line `cz`'s rail tops' seat (the deck's top, or the ballast's) at world x.
export const elevatedTrackY = (cz: number, x: number) => EL_GRADE + (EL_TOP - EL_GRADE) * elevatedLift(cz, x);

export class ElevatedReach {
  readonly group = new THREE.Group();
  private key = "";
  constructor(scene: THREE.Object3D, private material: THREE.Material) { scene.add(this.group); }

  // `roads`: the roads to keep clear, each with the offset it is drawn at in this city.
  update(plan: CityPlan, roads: { road: CountryRoad; dx: number; dz: number }[]) {
    // (Each line's row out of town on each side it leaves by: plan.elevatedLines.)
    const lines: number[] = [];
    for (let cz = CITY_LO; cz <= CITY_HI; cz++) if (plan.elevatedSides(cz).length) lines.push(cz);
    const key = lines.length ? `${plan.seed}/${plan.style.id}/${CITY_LO}/${lines.map((cz) => `${cz}:${plan.elevatedSides(cz).join("")}`).join(",")}|${roads.map((r) => `${r.road.inp.city}:${r.road.inp.kind}:${r.road.inp.dEst}:${r.dx.toFixed(1)}:${r.dz.toFixed(1)}`).join(";")}` : "";
    if (key === this.key) return;
    this.key = key;
    this.clear();
    EL_FLATS.clear();
    if (!lines.length) return;
    // Where the roads are: their centre lines in 16 m cells.
    const CELL = 16, cells = new Map<number, number[]>(), q = { x: 0, z: 0, h: 0, k: 0 };
    const zMin = CITY_LO * BLOCK - 40, zMax = (CITY_HI + 1) * BLOCK + 40;
    for (const { road, dx, dz } of roads) {
      for (let s = 0; s <= road.length; s += 4) {
        road.center(s, q);
        const x = q.x + dx, z = q.z + dz;
        if (z < zMin || z > zMax) continue;
        const k = Math.floor(x / CELL) * 100003 + Math.floor(z / CELL);
        let a = cells.get(k); if (!a) cells.set(k, a = []);
        a.push(x, z);
      }
    }
    // Whether no road's centre line is within r (at most CELL) of (x, z).
    const clearOfRoads = (x: number, z: number, r: number) => {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const a = cells.get((cx + i) * 100003 + cz + j);
        if (a) for (let n = 0; n < a.length; n += 2) if (Math.hypot(a[n] - x, a[n + 1] - z) < r) return false;
      }
      return true;
    };
    const blocks = Math.ceil(ELEVATED_REACH / BLOCK);
    const W = CITY_LO * BLOCK, E = (CITY_HI + 1) * BLOCK;
    for (const cz of lines) {
      const z0 = cz * BLOCK;
      // A bridge over each road that crosses the line's path: full height over it and 8 m beyond.
      const flats: [number, number][] = [];
      for (const [x0, x1] of [[W - blocks * BLOCK, W], [E, E + blocks * BLOCK]]) {
        let run: [number, number] | null = null;
        for (let x = x0; x <= x1; x += 2) {
          if (clearOfRoads(x, z0 + 9, 15)) continue;
          if (run && x - run[1] <= 6) run[1] = x;
          else { if (run) flats.push([run[0] - 8, run[1] + 8]); run = [x, x]; }
        }
        if (run) flats.push([run[0] - 8, run[1] + 8]);
      }
      EL_FLATS.set(cz, flats);
      const y = (x: number) => elevatedTrackY(cz, x);
      // The bents, every EL_BENT_STEP metres on out from the town's own (the first one east past the
      // edge street), wherever the deck is high enough and neither column stands on a road.
      const bents: number[] = [];
      for (let k = 0; k * EL_BENT_STEP < blocks * BLOCK; k++) bents.push(E + STREET + 4 + k * EL_BENT_STEP, W - 4 - k * EL_BENT_STEP);
      for (const side of plan.elevatedSides(cz)) {
        // The blocks beyond the edge on this side, in pieces, each built in its own frame of reference.
        const first = side < 0 ? CITY_LO - blocks : CITY_HI + 1;
        for (let p = 0; p < blocks; p += REACH_PIECE) {
          const n = Math.min(REACH_PIECE, blocks - p), ox = (first + p) * BLOCK, b = new Batch();
          buildReach(b, ox, ox + n * BLOCK, y);
          for (const x of bents) {
            if (x < ox || x >= ox + n * BLOCK || y(x) < 1.4) continue;   // (below that its girders are nearly on the ground)
            if (EL_COLUMNS.every((c) => clearOfRoads(x, z0 + c, 9))) elevatedBent(b, x - ox, y(x));
          }
          const mesh = b.build(this.material);
          if (mesh) { mesh.position.set(ox, 0, z0); this.group.add(mesh); }
        }
      }
    }
  }

  clear() {
    for (const m of [...this.group.children]) { this.group.remove(m); disposeTree(m); }
  }
}

type ReachMode = "deck" | "grade";
const modeAt = (t: number): ReachMode => t > EL_GRADE + 0.01 ? "deck" : "grade";

// The line from world x0 to x1 (x relative to x0 in the batch), its track top at y(x): in RAMP_SEG-long
// pieces, runs of the same slope and kind merged into one.
function buildReach(b: Batch, x0: number, x1: number, y: (x: number) => number) {
  const runs: { a: number; b: number; ya: number; yb: number; mode: ReachMode }[] = [];
  for (let x = x0; x < x1 - 1e-6; x += RAMP_SEG) {
    const xb = Math.min(x1, x + RAMP_SEG), ya = y(x), yb = y(xb), mode = modeAt((ya + yb) / 2), last = runs[runs.length - 1];
    if (last && last.mode === mode && Math.abs((yb - ya) / (xb - x) - (last.yb - last.ya) / (last.b - last.a)) < 1e-5) { last.b = xb; last.yb = yb; }
    else runs.push({ a: x, b: xb, ya, yb, mode });
  }
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i], xa = r.a - x0, xb = r.b - x0;
    // A box between z0 and z1 whose top and bottom follow the track, `lo` and `hi` above its top.
    const along = (lo: number, hi: number, z0: number, z1: number, color: number) => {
      const dx = xb - xa, dy = r.yb - r.ya;
      b.boxR((xa + xb) / 2, (r.ya + r.yb) / 2 + (lo + hi) / 2, (z0 + z1) / 2, Math.hypot(dx, dy) + 0.02, hi - lo, z1 - z0, color, 0, 0, Math.atan2(dy, dx));
    };
    for (const z of [6.4, 7.8, 10.2, 11.6]) along(0, 0.12, z - 0.06, z + 0.06, EL_RAIL);
    if (r.mode === "deck") {
      // The same deck as in town, all the way down: its girders and then the deck itself sink
      // into the ground at the foot of the ramp, and its railings end once it is nearly down.
      along(-0.5, 0, 5, 13, EL_DECK);
      for (const z of [5.2, 12.8]) along(-1.1, -0.5, z - 0.2, z + 0.2, EL_STEEL);
      if (Math.min(r.ya, r.yb) > 1.2) for (const z of [5.1, 12.9]) along(0, 0.9, z - 0.05, z + 0.05, EL_STEEL);
    } else {
      for (const z of [7.1, 10.9]) along(-0.02, 0.04, z - 1.1, z + 1.1, 0x4a4038);   // the sleepers, in a strip
      along(-(EL_GRADE + 0.2), 0, 5.4, 12.6, 0x7d776c);
    }
  }
}
