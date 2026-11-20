// A city's outline: which of the city's square is land, and where the sea is. Every layout
// (citygen.ts) lays its streets out over the whole square; trimToOutline (citygen.ts) then cuts
// the graph back to this, each side's land edge standing in from the square by `inset` (smooth
// noise, up to INSET_MAX), and in a coastal or port city the sea coming in over one side to its
// `shore` line, with bays and headlands. The gates keep their slots in GATES and their outer ends;
// their streets run in to wherever the land begins, and a gate in the sea is closed.
//
// The sea is always on the left of the way into town (the entry gate's side turned a quarter
// left), so it is never the side the truck comes in by, nor the far side the freeway leaves by;
// the freeway (freeway.ts) bends away from it at both ends. Insets fade out where anything runs
// straight out of town (the freeway's line and its interchange, elevated lines, cable cars), and
// the shore keeps clear of the way in. Out past the town on the way in, its shore bends in to run
// COAST_LAT off the road by the edge of its outskirts, where the country road's coast runs
// (country.ts SEA_N, coastAt): the road in comes along one coast into the town's sea. (Over another
// gate's road out on that side, if one runs between: when the truck leaves by it, its own country
// land lies over the sea there.)
import { BLOCK, STREET } from "./grid.ts";
import { hash2 } from "./rng.ts";
import { CITY_HI, CITY_LO, entryGateOf, GATES } from "./city.ts";
import type { Gate } from "./city.ts";
import type { CityStyle } from "./styles.ts";
import { DEBUG_SEA } from "./debug.ts";

export const INSET_MAX = 1.5 * BLOCK;
const SHORE_MIN = 0.8 * BLOCK, SHORE_MAX = 3.5 * BLOCK;
const DX = [1, 0, -1, 0], DZ = [0, -1, 0, 1];
export const SEA_REACH = 40;
// (The country road's coast: its sea from 75 m off on the left, country.ts SEA_N; a literal, as
// country.ts loads after this. The bend runs over the outskirts, RING blocks.)
const COAST_LAT = 75, COAST_BEND = 240;

// The side of town the sea is on (0 east, 1 north, 2 west, 3 south), or null: a pure function of
// the city's seed and style (a country road into or out of the city asks it too).
export function seaSide(citySeed: number, style: CityStyle): number | null {
  if (DEBUG_SEA === "none" || (style.id !== "coastal" && style.id !== "port")) return null;
  return (entryGateOf(citySeed).dir + 3) % 4;
}

// Smooth 1D noise in [-1, 1] along t (metres), wavelength `wave`.
function noise1(t: number, wave: number, seed: number, salt: number) {
  const u = t / wave, i = Math.floor(u), f = u - i, s = f * f * (3 - 2 * f);
  const h = (k: number) => hash2(k, salt, seed, 0x0b1) * 2 - 1;
  return h(i) + (h(i + 1) - h(i)) * s;
}
const smoothStep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface OutlineOpts {
  freeway: Gate | null;
  straightRows: number[];   // node rows (iz) of lines running east-west straight out of town (elevated lines)
  straightCols: number[];   // node columns (ix) running north-south (cable cars)
  insetScale?: number;      // (trimToOutline's retries: 1, then 0.5, then 0)
  seaOff?: boolean;         // (the last resort: no sea at all)
}
export class CityOutline {
  readonly sea: number | null;
  readonly X0: number; readonly X1: number; readonly Z0: number; readonly Z1: number;
  private shoreCap = SHORE_MAX;
  // The way in: its side of the square (the entry gate's dir), and how far its line lies from the
  // sea's edge.
  private eDir = 0; private eLat = 0;
  constructor(readonly seed: number, readonly style: CityStyle, private readonly o: OutlineOpts) {
    this.sea = o.seaOff ? null : seaSide(seed, style);
    const at = (i: number) => i * BLOCK + STREET / 2;
    this.X0 = at(CITY_LO); this.X1 = at(CITY_HI + 1); this.Z0 = this.X0; this.Z1 = this.X1;
    // (The shore stays two blocks clear of the way in: the entry gate's line runs parallel to it.)
    if (this.sea !== null) {
      const g = entryGateOf(seed);
      this.eDir = g.dir; this.eLat = this.edgeDist(this.sea, g.dir === 0 || g.dir === 2 ? at(g.iz) : at(g.ix));
      this.shoreCap = Math.max(0.3 * BLOCK, Math.min(SHORE_MAX, this.eLat - 2 * BLOCK));
    }
  }
  // How far coordinate `c` (z for a north or south side, x for east or west) lies in from side s's edge.
  private edgeDist(s: number, c: number) { return s === 0 ? this.X1 - c : s === 1 ? c - this.Z0 : s === 2 ? c - this.X0 : this.Z1 - c; }
  // How far in from side s the point (x, z) is, and where along that side.
  private inward(s: number, x: number, z: number) { return this.edgeDist(s, s === 0 || s === 2 ? x : z); }
  private along(s: number, x: number, z: number) { return s === 0 || s === 2 ? z : x; }
  // How far the sea reaches in from its side at t along it.
  shore(t: number) {
    if (this.sea === null) return -Infinity;
    const n = 0.5 + 0.38 * noise1(t, 5 * BLOCK, this.seed, 11) + 0.12 * noise1(t, 2.2 * BLOCK, this.seed, 12);
    return Math.min(this.shoreCap, SHORE_MIN + (SHORE_MAX - SHORE_MIN) * n);
  }
  // How far side s's land edge stands in from the square at t along it (none on the sea side).
  inset(s: number, t: number) {
    if (s === this.sea) return 0;
    const sc = this.o.insetScale ?? 1;
    if (sc <= 0) return 0;
    // (Long, gentle swells: shorter ones bite single blocks out of the edge, a comb of teeth.)
    let v = INSET_MAX * Math.max(0, 0.4 + 0.6 * noise1(t, 5.5 * BLOCK, this.seed, 20 + s) + 0.1 * noise1(t, 2.5 * BLOCK, this.seed, 30 + s));
    // (Fading out where a line runs straight out of town across this side.)
    const at = (i: number) => i * BLOCK + STREET / 2, ew = s === 0 || s === 2;
    const lines: number[] = (ew ? this.o.straightRows : this.o.straightCols).map(at);
    const fw = this.o.freeway;
    if (fw && (fw.dir === 0 || fw.dir === 2) === ew) lines.push(at(ew ? fw.iz : fw.ix));
    for (const c of lines) v *= smoothStep(2 * BLOCK, 3.5 * BLOCK, Math.abs(t - c));
    return Math.min(INSET_MAX, v * sc);
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
  // On the town's land: inside every side's inset, and not in the sea.
  inLand(x: number, z: number) {
    for (let s = 0; s < 4; s++) if (s !== this.sea && this.inward(s, x, z) < this.inset(s, this.along(s, x, z))) return false;
    return !this.inSea(x, z) && x >= this.X0 - 1 && x <= this.X1 + 1 && z >= this.Z0 - 1 && z <= this.Z1 + 1;
  }
  // Gate i's line: its outer end (the gate street's outer node) and the way in.
  gateLine(i: number) {
    const g = GATES[i], at = (k: number) => k * BLOCK + STREET / 2;
    return { x: at(g.ix + DX[g.dir]), z: at(g.iz + DZ[g.dir]), dx: -DX[g.dir], dz: -DZ[g.dir] };
  }
  // Whether gate i can be open: not on the sea side, and its line not out in the sea (trimToOutline
  // also closes one whose street in would cross the sea).
  gatePossible(i: number) {
    const g = GATES[i];
    if (g.dir === this.sea) return false;
    const L = this.gateLine(i);
    for (let d = 0; d <= BLOCK + INSET_MAX + BLOCK; d += 6) if (this.inSea(L.x + L.dx * d, L.z + L.dz * d)) return false;
    return true;
  }
  // The deepest the sea comes in (for the sea plane under the town): a line along its side.
  get shoreDeepest() {
    if (this.sea === null) return null;
    let m = 0;
    const lo = this.sea === 0 || this.sea === 2 ? this.Z0 : this.X0, hi = this.sea === 0 || this.sea === 2 ? this.Z1 : this.X1;
    for (let t = lo - 600; t <= hi + 600; t += 10) m = Math.max(m, this.shore(t));
    return m;
  }
  // Whether block (bx, bz)'s middle lies within `blocks` blocks of the shore (on land).
  nearShore(bx: number, bz: number, blocks = 1.3) { return this.nearShoreAt(bx * BLOCK + 39, bz * BLOCK + 39, blocks); }
  // Whether the point (x, z) lies within `blocks` blocks of the shore (on land).
  nearShoreAt(x: number, z: number, blocks = 1.3) {
    if (this.sea === null) return false;
    return this.inward(this.sea, x, z) - this.shore(this.along(this.sea, x, z)) < blocks * BLOCK;
  }
}
