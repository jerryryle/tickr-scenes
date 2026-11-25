// The town's outline as the generator lays it out (drafting only: docs/fixed-cities.md). Every
// layout (citygen.ts) lays its streets out over the whole square; trimToOutline (citygen.ts) then
// cuts the graph back to this, each side's land edge standing in from the square by `inset` (smooth
// noise, up to INSET_MAX), and in a coastal or port city the sea coming in over one side to its
// shore line, with bays and headlands. The way in keeps its slot (GATE_SLOTS) and its outer end; its
// street runs in to wherever the land begins. The ways out are where the land's streets meet its
// edge, off the sea and the lines running out of town (exitClear). The sea it lays out is written
// into the city file (src/outline.ts SeaData), which is all the scene reads of it.
//
// The sea is always on the left of the way into town (the entry gate's side turned a quarter
// left), so it is never the side the truck comes in by, nor the far side the freeway leaves by;
// the freeway (freeway.ts) bends away from it at both ends. Insets fade out where anything runs
// straight out of town (the freeway's line and its interchange, elevated lines, cable cars), and
// the shore keeps clear of the way in.
import { BLOCK, STREET } from "../src/grid.ts";
import { hash2 } from "../src/rng.ts";
import { CITY_HI, CITY_LO, GATE_SLOTS } from "../src/city.ts";
import type { Gate } from "../src/city.ts";
import type { CityStyle } from "../src/styles.ts";
import { DEBUG_SEA } from "../src/debug.ts";
import { CityOutline, smoothStep } from "../src/outline.ts";
import type { SeaData } from "../src/outline.ts";

export const INSET_MAX = 1.5 * BLOCK;
const SHORE_MIN = 0.8 * BLOCK, SHORE_MAX = 3.5 * BLOCK;
const OG_DX = [1, 0, -1, 0], OG_DZ = [0, -1, 0, 1];

// The gate the highway comes in through (a gate slot): pure, from the city's seed.
export function entryGateOf(citySeed: number): Gate { return GATE_SLOTS[Math.floor(hash2(citySeed, 5, 0, 0x6a7e) * GATE_SLOTS.length)]; }
// The side of town the sea is on (0 east, 1 north, 2 west, 3 south), or null: from the seed and style.
export function ruleSeaSide(citySeed: number, style: CityStyle): number | null {
  if (DEBUG_SEA === "none" || (style.id !== "coastal" && style.id !== "port")) return null;
  return (entryGateOf(citySeed).dir + 3) % 4;
}

// Smooth 1D noise in [-1, 1] along t (metres), wavelength `wave`.
function noise1(t: number, wave: number, seed: number, salt: number) {
  const u = t / wave, i = Math.floor(u), f = u - i, s = f * f * (3 - 2 * f);
  const h = (k: number) => hash2(k, salt, seed, 0x0b1) * 2 - 1;
  return h(i) + (h(i + 1) - h(i)) * s;
}

export interface OutlineOpts {
  freeway: Gate | null;
  straightRows: number[];   // node rows (iz) of lines running east-west straight out of town (elevated lines)
  straightCols: number[];   // node columns (ix) running north-south (cable cars)
  insetScale?: number;      // (trimToOutline's retries: 1, then 0.5, then 0)
  seaOff?: boolean;         // (the last resort: no sea at all)
}

// The sea as the city file holds it: the shore's noise sampled every 5 m along its side, 600 m
// past the square either way (as far as anything asks), to the centimetre; null with no sea.
export function ruleSeaData(seed: number, style: CityStyle, o: OutlineOpts): SeaData | null {
  const X0 = CITY_LO * BLOCK + STREET / 2, X1 = (CITY_HI + 1) * BLOCK + STREET / 2, sea = o.seaOff ? null : ruleSeaSide(seed, style);
  if (sea === null) return null;
  const at = (i: number) => i * BLOCK + STREET / 2, g = entryGateOf(seed), c = g.dir === 0 || g.dir === 2 ? at(g.iz) : at(g.ix);
  const eLat = sea === 0 ? X1 - c : sea === 1 ? c - X0 : sea === 2 ? c - X0 : X1 - c;
  // (The shore stays two blocks clear of the way in: the entry gate's line runs parallel to it.)
  const cap = Math.max(0.3 * BLOCK, Math.min(SHORE_MAX, eLat - 2 * BLOCK)), depth: number[] = [];
  for (let t = X0 - 600; t <= X1 + 600 + 1e-6; t += 5) {
    const n = 0.5 + 0.38 * noise1(t, 5 * BLOCK, seed, 11) + 0.12 * noise1(t, 2.2 * BLOCK, seed, 12);
    depth.push(Math.round(Math.min(cap, SHORE_MIN + (SHORE_MAX - SHORE_MIN) * n) * 100) / 100);
  }
  return { side: sea, entryDir: g.dir, entryLat: Math.round(eLat * 100) / 100, t0: X0 - 600, step: 5, depth };
}

// The outline the generator cuts a layout back to: the sea, and the land's edges standing in.
export class TrimOutline extends CityOutline {
  constructor(readonly seed: number, readonly style: CityStyle, private readonly o: OutlineOpts) {
    super(ruleSeaData(seed, style, o));
  }
  get insetScale() { return this.o.insetScale ?? 1; }
  get seaOff() { return !!this.o.seaOff; }
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
  // On the town's land: inside every side's inset, and not in the sea.
  inLand(x: number, z: number) {
    for (let s = 0; s < 4; s++) if (s !== this.sea && this.inward(s, x, z) < this.inset(s, this.along(s, x, z))) return false;
    return !this.inSea(x, z) && x >= this.X0 - 1 && x <= this.X1 + 1 && z >= this.Z0 - 1 && z <= this.Z1 + 1;
  }
  // A gate slot's line: its outer end (the gate street's outer node) and the way in.
  gateLine(g: Gate) {
    const at = (k: number) => k * BLOCK + STREET / 2;
    return { x: at(g.ix + OG_DX[g.dir]), z: at(g.iz + OG_DZ[g.dir]), dx: -OG_DX[g.dir], dz: -OG_DZ[g.dir] };
  }
  // Whether a gate slot can be open: not on the sea side, and its line not out in the sea
  // (trimToOutline also refuses one whose street in would cross the sea).
  gatePossible(g: Gate) {
    if (g.dir === this.sea) return false;
    const L = this.gateLine(g);
    for (let d = 0; d <= BLOCK + INSET_MAX + BLOCK; d += 6) if (this.inSea(L.x + L.dx * d, L.z + L.dz * d)) return false;
    return true;
  }
  // Whether a way out through side s at `along` keeps clear of the lines running straight out across
  // that side (elevated lines, cable cars, the freeway's line and where its curve leaves).
  exitClear(s: number, along: number) {
    const at = (i: number) => i * BLOCK + STREET / 2, ew = s === 0 || s === 2;
    const lines: number[] = (ew ? this.o.straightRows : this.o.straightCols).map(at);
    const fw = this.o.freeway;
    if (fw && (fw.dir === 0 || fw.dir === 2) === ew) lines.push(at(ew ? fw.iz : fw.ix));
    return lines.every((c) => Math.abs(c - along) >= 0.75 * BLOCK);
  }
}
