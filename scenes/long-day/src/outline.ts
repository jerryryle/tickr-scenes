// A town's sea (docs/long-day-cities.md): which side of the town's square it is on, and how far in it
// reaches along that side, as the city file holds it (SeaData). Out past the town on the way in
// (gate g0's side), its shore bends in to run COAST_LAT off the road by the edge of its outskirts,
// where the country road's coast runs (country.ts SEA_N, coastAt): the road in comes along one
// coast into the town's sea. The drafting tools lay the sea out (tools/outlinegen.ts) and cut the
// town's streets back to it and to its land's edges (tools/citygen.ts trimToOutline).
import { BLOCK, STREET } from "./grid.ts";
import { CITY_HI, CITY_LO } from "./city.ts";
import { cityByKey } from "./visits.ts";

const DX = [1, 0, -1, 0], DZ = [0, -1, 0, 1];
export const SEA_REACH = 40;
// (The country road's coast: its sea from 75 m off on the left, country.ts SEA_N; a literal, as
// country.ts loads after this. The bend runs over the outskirts, RING blocks.)
const COAST_LAT = 75, COAST_BEND = 240;
export const smoothStep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The side of a catalogue city the sea is on (0 east, 1 north, 2 west, 3 south), or null: its
// file's (a country road into or out of the city asks it too).
export function seaSide(citySeed: number): number | null { return cityByKey(citySeed)?.sea?.side ?? null; }

// A town's sea as a city file holds it: its side, the way in the shore keeps clear of (gate g0's
// side, and how far its line lies from the sea's edge), and how far the sea reaches in from its
// side, every `step` metres along it from `t0` (held at its ends beyond them).
export interface SeaData { side: number; entryDir: number; entryLat: number; t0: number; step: number; depth: number[] }

export class CityOutline {
  readonly sea: number | null;
  readonly X0: number; readonly X1: number; readonly Z0: number; readonly Z1: number;
  protected eDir = 0; protected eLat = 0;
  constructor(readonly data: SeaData | null) {
    const at = (i: number) => i * BLOCK + STREET / 2;
    this.X0 = at(CITY_LO); this.X1 = at(CITY_HI + 1); this.Z0 = this.X0; this.Z1 = this.X1;
    this.sea = data ? data.side : null;
    if (data) { this.eDir = data.entryDir; this.eLat = data.entryLat; }
  }
  // How far coordinate `c` (z for a north or south side, x for east or west) lies in from side s's edge.
  protected edgeDist(s: number, c: number) { return s === 0 ? this.X1 - c : s === 1 ? c - this.Z0 : s === 2 ? c - this.X0 : this.Z1 - c; }
  // How far in from side s the point (x, z) is, and where along that side.
  protected inward(s: number, x: number, z: number) { return this.edgeDist(s, s === 0 || s === 2 ? x : z); }
  protected along(s: number, x: number, z: number) { return s === 0 || s === 2 ? z : x; }
  // How far the sea reaches in from its side at t along it.
  shore(t: number) {
    const D = this.data;
    if (!D) return -Infinity;
    const f = Math.min(Math.max((t - D.t0) / D.step, 0), D.depth.length - 1), i = Math.min(Math.floor(f), D.depth.length - 2);
    return D.depth[i] + (D.depth[i + 1] - D.depth[i]) * (f - i);
  }
  inSea(x: number, z: number) { return this.sea !== null && this.inward(this.sea, x, z) < this.shore(this.along(this.sea, x, z)); }
  // Out past the square on the way in: the shore bending in towards the road (for the land and the
  // sea's surface round the town: seaward; the town's own gates and shore go by inSea alone).
  private inBend(x: number, z: number) {
    const out = -this.inward(this.eDir, x, z);
    if (this.sea === null || out <= 0) return false;
    const inw = this.inward(this.sea, x, z), D = this.eLat - this.shore(this.along(this.sea, x, z));
    return this.eLat - inw > COAST_LAT + (D - COAST_LAT) * (1 - smoothStep(0, COAST_BEND, out));
  }
  // The sea round that bend, as a rectangle (x0, x1, z0, z1) out to `far` past the square, for the
  // sea's surface (main.ts buildSea); or null.
  bendSea(far: number): [number, number, number, number] | null {
    if (this.sea === null) return null;
    const s = this.sea, e = this.eDir, sx = DX[s] + DZ[s], ex = DX[e] + DZ[e];   // (+1 or -1 along each's axis)
    const seaEdge = s === 0 ? this.X1 : s === 1 ? this.Z0 : s === 2 ? this.X0 : this.Z1, line = seaEdge - sx * this.eLat;
    const a0 = line + sx * (COAST_LAT - 10), a1 = seaEdge + sx * 60;
    const edge = e === 0 ? this.X1 : e === 1 ? this.Z0 : e === 2 ? this.X0 : this.Z1, b0 = edge, b1 = edge + ex * far;
    const [p0, p1, q0, q1] = [Math.min(a0, a1), Math.max(a0, a1), Math.min(b0, b1), Math.max(b0, b1)];
    return s === 0 || s === 2 ? [p0, p1, q0, q1] : [q0, q1, p0, p1];
  }
  // Sea for drawing the land round the town (city.ts outskirts): the sea, and inside the square
  // anywhere within SEA_REACH of it, out towards it. (The town's shore streets stand back from the
  // shore line: the blocks between them and it were dropped as the sea's, and the ground they leave
  // is the sea's too, not a strip of grass along the water.)
  seaward(x: number, z: number) {
    if (this.sea === null) return false;
    if (this.inSea(x, z) || this.inBend(x, z)) return true;
    const inside = x > this.X0 && x < this.X1 && z > this.Z0 && z < this.Z1;
    return inside && this.inSea(x + DX[this.sea] * SEA_REACH, z + DZ[this.sea] * SEA_REACH);
  }
  // The deepest the sea comes in (for the sea plane under the town).
  get shoreDeepest() { return this.data ? Math.max(...this.data.depth) : null; }
  // Whether block (bx, bz)'s middle lies within `blocks` blocks of the shore (on land).
  nearShore(bx: number, bz: number, blocks = 1.3) { return this.nearShoreAt(bx * BLOCK + 39, bz * BLOCK + 39, blocks); }
  // Whether the point (x, z) lies within `blocks` blocks of the shore (on land).
  nearShoreAt(x: number, z: number, blocks = 1.3) {
    if (this.sea === null) return false;
    return this.inward(this.sea, x, z) - this.shore(this.along(this.sea, x, z)) < blocks * BLOCK;
  }
}
