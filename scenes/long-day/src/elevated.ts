// A metro city's elevated lines carried on out of town: from the city's east and west edges, each
// line runs straight on for ELEVATED_REACH metres over the countryside, so it goes off into the
// distance instead of stopping at the edge of town (the trains run its whole length: ambient.ts).
// Built in pieces of a few blocks (so the camera's view leaves out the ones behind it), with no
// pier standing on a road the truck uses: the road out of town, the road in and the last one.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { disposeTree } from "./chunks.ts";
import { buildElevated, ELEVATED_REACH, elevatedLine } from "./decor.ts";
import { CITY_HI, CITY_LO, CityPlan } from "./city.ts";
import { BLOCK } from "./grid.ts";
import { CountryRoad } from "./country.ts";

const REACH_PIECE = 8;   // blocks per piece

export class ElevatedReach {
  readonly group = new THREE.Group();
  private key = "";
  constructor(scene: THREE.Object3D, private material: THREE.Material) { scene.add(this.group); }

  // `roads`: the roads to keep clear, each with the offset it is drawn at in this city.
  update(plan: CityPlan, roads: { road: CountryRoad; dx: number; dz: number }[]) {
    const lines: number[] = [];
    for (let cz = CITY_LO; cz <= CITY_HI; cz++) if (elevatedLine(plan.style, cz)) lines.push(cz);
    const key = lines.length ? `${plan.seed}/${plan.style.id}/${lines.join(",")}|${roads.map((r) => `${r.road.inp.city}:${r.road.inp.kind}:${r.road.inp.dEst}:${r.dx.toFixed(1)}:${r.dz.toFixed(1)}`).join(";")}` : "";
    if (key === this.key) return;
    this.key = key;
    this.clear();
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
    const clearOfRoads = (x: number, z: number) => {
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const a = cells.get((cx + i) * 100003 + cz + j);
        if (a) for (let n = 0; n < a.length; n += 2) if (Math.hypot(a[n] - x, a[n + 1] - z) < 10) return false;
      }
      return true;
    };
    const blocks = Math.ceil(ELEVATED_REACH / BLOCK);
    for (const cz of lines) {
      const z0 = cz * BLOCK;
      for (const side of [-1, 1]) {
        // The blocks beyond the edge on this side, in pieces, each built in its own frame of reference.
        const first = side < 0 ? CITY_LO - blocks : CITY_HI + 1;
        for (let p = 0; p < blocks; p += REACH_PIECE) {
          const bx0 = first + p, n = Math.min(REACH_PIECE, blocks - p), ox = bx0 * BLOCK, b = new Batch();
          for (let i = 0; i < n; i++) buildElevated(b, i * BLOCK, (x) => clearOfRoads(ox + x, z0 + 9));
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
