// The country drive between two cities: a two-lane highway, generated from the journey seed and
// the city number, with the set pieces along it and the truck's motion on it.
// Everything is a pure function of its inputs: the road (curves, biomes, set pieces) and the
// truck's distance along it at each 0.1 s step are worked out once when the truck leaves a city,
// so the drive can be entered at any moment (seeking) and always plays out the same way.
// The world is in its own coordinates (the road starts at the origin); country world.ts draws it.
//
// The truck pulls into the Ryder truck stop when the next city needs a different truck (the
// spare waits in the apron; the driver changes trucks), and waits at a railroad crossing for a
// train on longer drives. The drive ends at about city speed, entering the next city's edge.
import * as THREE from "three@0.187.0";
import { hash2, hash3 } from "./rng.ts";
import type { TruckModel } from "./truck.ts";
import type { CityStyle, StyleId } from "./styles.ts";
import { lerpWeather, weatherMix } from "./climate.ts";
import type { Climate, WeatherMix } from "./climate.ts";
import { BLOCK, RING } from "./grid.ts";
import { LANE_KERB, smooth, smoothD } from "./route.ts";
import type { Pose } from "./route.ts";
import { SIM_DT } from "./journey.ts";
import { Frame, FW_OFF_D, FW_OFF_V, FW_TOP, onRampN, onRampY } from "./freeway.ts";

export type BiomeId = "coastal" | "forest" | "desert" | "farmland" | "prairie" | "wetlands";
type PieceKind = "leave" | "distance" | "welcome" | "truckstop" | "rail" | "construction" | "billboards" | "attraction"
  | "weigh" | "fruit" | "watertower" | "bridge" | "gas" | "tunnel" | "overpass";
export interface RoadPiece { kind: PieceKind; s: number; side: 1 | -1; len: number; variant: number; text?: string; n?: number }
// A piece's lettered signs, in road coordinates: the centre of the lettering at (s, n) and height
// y, its width and height, all facing the oncoming truck. countryworld.ts builds them from this,
// and the camera director uses it to film them so they can be read. (Billboards: one entry per
// board, in order.)
export interface RoadSign { s: number; n: number; y: number; w: number; h: number; billboard?: boolean }
export function pieceSigns(p: RoadPiece): RoadSign[] {
  const S = p.s, side = p.side;
  switch (p.kind) {
    case "leave": case "distance": case "welcome": return [{ s: S, n: p.n ?? 11, y: 5.2, w: 12.8, h: 1.6 }];
    case "billboards": return [0, 1, 2].map((k) => ({ s: S + 30 + k * 110 - 0.05, n: (k % 2 ? -1 : 1) * 22, y: 9.0, w: 14.6, h: 5.0, billboard: true }));
    case "truckstop": return [{ s: S - 60, n: 20, y: 14.2, w: 9.0, h: 1.1 }];
    case "construction": return [{ s: S, n: 9, y: 2.6, w: 5.2, h: 0.7 }];
    case "attraction": return [{ s: S, n: side * 15, y: 3.2, w: 6.8, h: 0.85 }];
    case "weigh": return [{ s: S - 80, n: 10, y: 4.0, w: 8.4, h: 1.05 }];
    case "fruit": return [{ s: S, n: side * 9.5, y: 1.6, w: 4.0, h: 0.5 }];
    case "gas": return [{ s: S + 5, n: side * 11, y: 7.2, w: 4.6, h: 0.6 }];
    default: return [];
  }
}
interface CountryStop { s: number; dwell: number; kind: "truckstop" | "rail"; arrive: number }

const ROAD_DS = 2;               // geometry sample spacing (m)
export const LANE = 1.85;               // right lane centre from the centre line
const APRON = 13;                // the truck stop's parking lane, from the centre line
const SWAP_AHEAD = 15;           // the spare waits this far ahead of where the truck stops
const COUNTRY_VMAX = 22, COUNTRY_ACCEL = 1.0, COUNTRY_BRAKE = 1.4, ZONE_V = 12;
const RAIL_DWELL = 24;
export const TRAIN_SPEED = 20, TRAIN_CARS = 8, TRAIN_CAR = 17;
export const ONCOMING_SPEED = 25;
const LAT_MAX = 1.8;             // m/s^2 of sideways pull the drive allows on curves
// The hand-over between cities (journey.ts): every road ends with ARRIVE_DUR seconds of straight
// highway into the next city's gate, slowing smoothly from V_JOIN to V_GATE. The next city's
// slot begins where that straight begins, out on the open road.
export const ARRIVE_DUR = 40, V_JOIN = 16, V_GATE = 8;
export const ARRIVE_LEN = V_GATE * ARRIVE_DUR + (V_JOIN - V_GATE) * ARRIVE_DUR * 0.5;   // 480 m
// Within LAND_SEAM of either end the city's own countryside ring (city.ts) is the land; the road
// is straight there and well beyond, so the seam is a straight line across it.
const LAND_SEAM = (RING - 1) * BLOCK;
const STRAIGHT_OUT = LAND_SEAM + 120;   // straight out of town
const STRAIGHT_IN = 150;                 // straight before the hand-over (and the arrival straight)
// Into a freeway city (freeway.ts) the road runs straight on for longer, beside the freeway, and
// the land is level for longer still, under it.
const FW_STRAIGHT_IN = 560, FW_FLAT_IN = 760;
// The slowing on the freeway for its off-ramp: about 90 m, just so that the arrival ends on a
// simulation step (the city's route takes over there, exactly at the off-ramp).
export const ONRAMP_SHOT = 99999;   // featureShot's key for the on-ramp's shot (no piece of the road's)
// (Worked out on first use: it needs constants from modules loaded after this one.)
let mergeDecM = 0;
function mergeDec() {
  if (mergeDecM) return mergeDecM;
  const total = ARRIVE_LEN + FW_OFF_D, V = V_JOIN, v = FW_OFF_V, k = (V - v) / (V * (V + v));
  const dur = Math.ceil((total / V + 90 * k) / SIM_DT - 1e-9) * SIM_DT;
  return (mergeDecM = (dur - total / V) / k);
}
// Distance and speed into the arrival straight, u seconds after the hand-over.
function arriveS(u: number) {
  if (u >= ARRIVE_DUR) return ARRIVE_LEN + V_GATE * (u - ARRIVE_DUR);
  const w = Math.max(0, u) / ARRIVE_DUR;
  return V_GATE * Math.max(0, u) + (V_JOIN - V_GATE) * ARRIVE_DUR * (w - (w ** 6 - 3 * w ** 5 + 2.5 * w ** 4));
}
function arriveV(u: number) { return V_GATE + (V_JOIN - V_GATE) * (1 - smooth(THREE.MathUtils.clamp(u / ARRIVE_DUR, 0, 1))); }

// Hills: how hilly each land is (0 flat to 1), and the steepest grade the road takes.
export const HILLS: Record<BiomeId, number> = { coastal: 0.9, forest: 1, desert: 0.7, farmland: 0.55, prairie: 0.35, wetlands: 0 };
const MAX_GRADE = 0.055;
const HILL_FLAT = 35, HILL_EASE = 90;   // set pieces sit on the level: this far either side, then eased over this
const SIDE_HILL = 16;                   // the land beside the road rises or falls up to about this much (m)
export const COAST_N = -57, SEA_N = -75; // the beach (coastal land, on the left) and the sea beyond it
// A tunnel through a hill: its bore (half width, height inside), the cutting walls either side of
// its approaches, how far they run out, and the hill's height over the road at the portals.
export const BORE_HALF = 5.2, BORE_H = 6.6, CUT_N = 7.6, CUT_RUN = 80;
// An overpass: a cross road (or railway) on a bridge over the road, on embankments either side.
export const OVER_DECK = 6.6, OVER_HALF = 7, OVER_ABUT = 10.5;
export const tunnelTop = (p: RoadPiece) => 11 + 3 * p.variant;   // the hill over a tunnel's portals

export const BIOME_OF: Record<StyleId, BiomeId> = { coastal: "coastal", metro: "forest", desert: "desert", brick: "farmland", mainstreet: "prairie", port: "wetlands" };

export function citySeedOf(seed: number, N: number) { return N === 0 ? seed : Math.floor(hash2(N, 0, seed, 0xc17) * 2 ** 31); }

// `exit`: the drive out of `city` from its gate (frame: the gate street's end, world) to the next
// city, planned for `dEst` seconds to the hand-over and ending on heading `endH` (the next city's
// way in). `arrival`: just the arrival straight into `city`, ending at its gate (what a seek into
// the start of a city's slot needs; the drive before it is the last city's).
interface CountryInput {
  seed: number; city: number; kind: "exit" | "arrival";
  frame: { x: number; z: number; h: number };
  dEst: number; endH: number;
  fromTruck: TruckModel; toTruck: TruckModel;
  fromStyle: CityStyle; toStyle: CityStyle; fromName: string; toName: string;
  fromClimate: Climate; toClimate: Climate;
  toFreeway?: boolean;   // the next city has a freeway: the road comes up onto a flyover beside it
  toFreewayMerge?: boolean;   // and joins it, for a stretch (freeway.ts freewayMerge)
}

export class CountryRoad {
  readonly key: string;
  readonly fromBiome: BiomeId; readonly toBiome: BiomeId;
  readonly pieces: RoadPiece[] = [];
  stops: CountryStop[] = [];
  readonly length: number;         // to the next city's gate street (on into town, along a freeway the truck takes)
  readonly gateS: number;          // where the next city's gate street begins
  readonly SB: number;             // where the next city takes over (the arrival straight begins)
  readonly swapU: number = -1;     // drive time of a truck change (none: trucks change in town)
  readonly swapS: number = 0;
  readonly landFrom: number; readonly landTo: number;   // the road's own land (the city rings' outside)
  private X: Float64Array; private Z: Float64Array; private H: Float64Array;
  private Y: Float64Array;          // the road's height at each geometry sample
  private SM: Float64Array;         // how far the land beside the road may rise and fall there (0..1)
  private PM: Float64Array;         // 0 at the set pieces (the land level round them), 1 clear of them
  private S: Float64Array = new Float64Array(1); private V: Float32Array = new Float32Array(1);   // per motion step, to the hand-over
  private zone: [number, number] | null = null;
  private planStops: { s: number; dwell: number; kind: "truckstop" | "rail" }[] = [];
  trainT = -1;                     // drive time the train front reaches the far side of the road, start
  meetings: number[] = [];         // drive times oncoming cars pass the truck
  private D = 0;                   // seconds to the hand-over
  private geo = false;             // the geometry is built (the motion then eases off for curves)
  private kAt(s: number) { const f = Math.min(Math.max(s / ROAD_DS, 0), this.H.length - 2), i = Math.floor(f); return Math.abs(this.H[i + 1] - this.H[i]) / ROAD_DS; }
  private fc: number; private fs: number;   // the frame's rotation

  constructor(readonly inp: CountryInput) {
    const { seed, city } = inp;
    this.key = `${inp.kind}/${seed}/${city}/${inp.frame.x.toFixed(2)},${inp.frame.z.toFixed(2)},${inp.frame.h.toFixed(4)}/${inp.dEst.toFixed(1)}`;
    this.fc = Math.cos(inp.frame.h); this.fs = Math.sin(inp.frame.h);
    const arrival = inp.kind === "arrival";
    this.toBiome = BIOME_OF[inp.toStyle.id]; this.fromBiome = arrival ? this.toBiome : BIOME_OF[inp.fromStyle.id];
    const h = (k: number) => hash3(city, k, 0, seed, 0xc0a7);
    let SB = 0;
    if (!arrival) {
      const dur = Math.max(20, inp.dEst);
      // Construction zone (motion slows through it) on drives long enough to spare it.
      const estL = COUNTRY_VMAX * dur * 0.85;
      if (dur > 200 && h(1) < 0.45) { const z0 = Math.max(900, estL * (0.15 + 0.1 * h(2))); if (z0 + 220 < estL - 700) this.zone = [z0, z0 + 220]; }
      // First pass: no stops, to see how far the drive goes.
      let m = this.simulate([], COUNTRY_VMAX, dur, 9, 0);
      const L1 = m.S[m.S.length - 1];
      const at = (k: number) => m.S[Math.min(m.S.length - 1, Math.floor(k * (m.S.length - 1)))];
      const truckstopS = dur > 70 ? Math.max(900, at(0.3 + 0.2 * h(3))) : -1;
      if (truckstopS > 0 && truckstopS < L1 - 600 && h(4) < 0.6) this.pieces.push({ kind: "truckstop", s: truckstopS, side: 1, len: 260, variant: 0 });
      const railS = dur > 170 && h(5) < 0.7 ? at(0.68) : -1;
      if (railS > 900 && railS < L1 - 700 && (truckstopS < 0 || Math.abs(railS - truckstopS) > 400)) {
        this.planStops.push({ s: railS - 16, dwell: RAIL_DWELL, kind: "rail" });   // the nose short of the gate
        this.pieces.push({ kind: "rail", s: railS, side: 1, len: 80, variant: 0 });
      }
      if (this.zone) this.pieces.push({ kind: "construction", s: this.zone[0] - 60, side: 1, len: this.zone[1] - this.zone[0] + 140, variant: 0 });
      m = this.simulate(this.planStops, COUNTRY_VMAX, dur, 9, 0);
      SB = Math.max(STRAIGHT_OUT + 400, m.S[m.S.length - 1]);
      // Into a freeway city, nothing that stops the truck or sprawls by the road out where the
      // freeway and the flyover are (the drive is replanned without it: it only gets longer).
      const fwClash = (p: RoadPiece) => inp.toFreeway && p.s + p.len > SB - 1150;
      if (this.pieces.some(fwClash)) {
        for (const p of this.pieces.filter(fwClash)) {
          this.pieces.splice(this.pieces.indexOf(p), 1);
          if (p.kind === "construction") this.zone = null;
          if (p.kind === "rail") this.planStops = this.planStops.filter((x) => x.kind !== "rail");
        }
        m = this.simulate(this.planStops, COUNTRY_VMAX, dur, 9, 0);
        SB = Math.max(STRAIGHT_OUT + 400, m.S[m.S.length - 1]);
      }
      this.S = m.S; this.V = m.V; this.D = dur; this.stops = m.stops;
    }
    this.SB = SB;
    const L = this.gateS = SB + ARRIVE_LEN;
    this.length = L + (inp.toFreewayMerge ? FW_OFF_D : 0);
    this.landFrom = arrival ? 0 : LAND_SEAM; this.landTo = L - LAND_SEAM;
    // Signs and the rest of the set pieces, wherever there is room (never near the cities, so
    // nothing the cities' ends can see depends on how long the drive turns out to be).
    if (!arrival) {
      this.pieces.push({ kind: "leave", s: LAND_SEAM + 60, side: 1, len: 40, variant: 0, text: `LEAVING ${inp.fromName.toUpperCase()}` });
      if (SB > 1700) this.pieces.push({ kind: "distance", s: LAND_SEAM + 460, side: 1, len: 40, variant: 0,
        text: `${inp.toName.toUpperCase()}  ${Math.max(1, Math.round((L - LAND_SEAM - 460) / 1609))} MI` });
    }
    this.pieces.push({ kind: "welcome", s: L - (inp.toFreeway ? 800 : 230), side: 1, len: 40, variant: 0, text: `WELCOME TO ${inp.toName.toUpperCase()}`, n: inp.toFreeway ? -12 : undefined });   // (into a freeway city, on the left: the freeway is on the right)
    if (!arrival) {
      const extras: [PieceKind, number][] = [["attraction", 120], ["weigh", 200], ["fruit", 80], ["watertower", 90], ["bridge", 120], ["gas", 110]];
      for (let i = extras.length - 1; i > 0; i--) { const j = Math.floor(h(20 + i) * (i + 1)); [extras[i], extras[j]] = [extras[j], extras[i]]; }
      extras.unshift(["billboards", 320]);   // billboards on every drive long enough for them
      let k = 0;
      const lo = 900, hi = SB - (inp.toFreeway ? 1150 : 500);
      for (const [kind, len] of extras) {
        for (let tries = 0; tries < 8 && hi - len > lo; tries++) {
          const s = lo + h(40 + k * 9 + tries) * (hi - len - lo);
          if (this.pieces.some((p) => s < p.s + p.len + 120 && s + len + 120 > p.s)) continue;
          if (kind === "weigh" && this.pieces.some((p) => p.kind === "truckstop" && Math.abs(p.s - s) < 800)) continue;
          this.pieces.push({ kind, s, side: kind === "gas" || kind === "fruit" ? (h(60 + k) < 0.5 ? 1 : -1) : kind === "weigh" ? 1 : h(60 + k) < 0.5 ? 1 : -1,
            len, variant: Math.floor(h(70 + k) * 4) });
          break;
        }
        k++;
      }
      // Tunnels through the hills of hilly land, and an overpass now and then (drawn apart from the
      // rest, so the drives that had no room for them keep their pieces where they were).
      const hillyAt = (s: number) => { const b = this.blendAt(s) < 0.5 ? this.fromBiome : this.toBiome; return b !== "coastal" && HILLS[b] >= 0.55; };
      const more: [PieceKind, number][] = [];
      if (h(100) < 0.75) more.push(["tunnel", 140 + Math.floor(h(101) * 120)]);
      if (h(102) < 0.6) more.push(["overpass", 30]);
      if (h(103) < 0.3) more.push(["tunnel", 120 + Math.floor(h(104) * 80)]);
      for (const [kind, len] of more) {
        for (let tries = 0; tries < 10 && hi - len > lo; tries++) {
          const s = lo + h(110 + k * 9 + tries) * (hi - len - lo);
          if (this.pieces.some((p) => s < p.s + p.len + 200 && s + len + 200 > p.s)) continue;
          if (kind === "tunnel" && !(hillyAt(s - CUT_RUN) && hillyAt(s + len + CUT_RUN))) continue;
          if (kind === "overpass" && (this.blendAt(s) < 0.5 ? this.fromBiome : this.toBiome) === "coastal") continue;
          this.pieces.push({ kind, s, side: 1, len, variant: Math.floor(h(120 + k) * (kind === "tunnel" ? 3 : 2)) });
          break;
        }
        k++;
      }
    }
    this.pieces.sort((a, b) => a.s - b.s);
    this.shapes = this.pieces.filter((p) => p.kind === "tunnel" || p.kind === "overpass");
    // Geometry: straight out of town, gentle curves, straight into the hand-over and the arrival
    // straight. The curves also turn the road onto the next city's way in (endH): the city's exit
    // gate is chosen so that is never more than a quarter turn.
    const n = Math.ceil((this.length + 40) / ROAD_DS) + 1;
    this.X = new Float64Array(n); this.Z = new Float64Array(n); this.H = new Float64Array(n);
    const kap = new Float64Array(n), msk = new Float64Array(n);
    const A = [0.0011 + 0.0011 * h(80), 0.0007 * h(81)], W = [2 * Math.PI / (700 + 500 * h(82)), 2 * Math.PI / (260 + 200 * h(83))], P = [h(84) * 6.3, h(85) * 6.3];
    let base = 0, wsum = 0;
    for (let i = 0; i < n; i++) {
      const s = i * ROAD_DS;
      let mask = arrival ? 0 : smooth(THREE.MathUtils.clamp((s - STRAIGHT_OUT) / 120, 0, 1)) * smooth(THREE.MathUtils.clamp((SB - (inp.toFreeway ? FW_STRAIGHT_IN : STRAIGHT_IN) - s) / 120, 0, 1));
      for (const p of this.pieces) {
        if (p.kind === "billboards" || p.kind === "leave" || p.kind === "distance" || p.kind === "welcome") continue;
        const d = Math.max(p.s - 150 - s, s - (p.s + p.len + 150), 0);
        mask = Math.min(mask, smooth(Math.min(1, d / 120)));
      }
      msk[i] = mask;
      kap[i] = (A[0] * Math.cos(W[0] * s + P[0]) + A[1] * Math.cos(W[1] * s + P[1])) * mask;
      base += kap[i] * ROAD_DS; wsum += mask * ROAD_DS;
    }
    const turn = arrival ? 0 : Math.atan2(Math.sin(inp.endH - inp.frame.h), Math.cos(inp.endH - inp.frame.h));
    const corr = wsum > 1 ? (turn - base) / wsum : 0;
    let x = 0, z = 0, hd = 0;
    for (let i = 0; i < n; i++) {
      this.X[i] = x; this.Z[i] = z; this.H[i] = hd;
      hd += (kap[i] + corr * msk[i]) * ROAD_DS;
      x += Math.cos(hd) * ROAD_DS; z -= Math.sin(hd) * ROAD_DS;
    }
    this.geo = true;
    // Heights. The road rises and falls over two sets of rounded hills, but holds level through
    // every set piece and at both ends (the cities are at 0): the hills are laid out along a
    // distance `u` that only runs where the road may climb, so they pause at each piece and end
    // exactly at the last city's level (a whole number of hills fits between). The land beside
    // the road has hills of its own (groundAt), likewise level around the pieces.
    this.Y = new Float64Array(n); this.SM = new Float64Array(n); this.PM = new Float64Array(n);
    const U = new Float64Array(n);
    let u = 0;
    for (let i = 0; i < n; i++) {
      const s = i * ROAD_DS;
      let m = arrival ? 0 : smooth(THREE.MathUtils.clamp((s - STRAIGHT_OUT) / HILL_EASE, 0, 1)) * smooth(THREE.MathUtils.clamp((SB - (inp.toFreeway ? FW_FLAT_IN : STRAIGHT_IN) - s) / HILL_EASE, 0, 1));
      for (const p of this.pieces) {
        const d = Math.max(p.s - HILL_FLAT - s, s - (p.s + p.len + HILL_FLAT), 0);
        m = Math.min(m, smooth(Math.min(1, d / HILL_EASE)));
      }
      let pm = 1;
      for (const p of this.pieces) pm = Math.min(pm, smooth(Math.min(1, Math.max(p.s - HILL_FLAT - s, s - (p.s + p.len + HILL_FLAT), 0) / HILL_EASE)));
      U[i] = u; this.SM[i] = m; this.PM[i] = pm; u += m * ROAD_DS;
    }
    const Ut = u, hilly = 0.45 + 0.75 * h(86);
    if (Ut > 500) {
      const k1 = Math.max(1, Math.round(Ut / (1000 + 900 * h(87)))), k2 = Math.max(2, Math.round(Ut / (330 + 260 * h(88))));
      const A1 = 16 * hilly, A2 = (4 + 4 * h(89)) * hilly;
      const a0 = HILLS[this.fromBiome], a1 = HILLS[this.toBiome];
      let steep = 0;
      for (let i = 0; i < n; i++) {
        const w = U[i] / Ut, amp = a0 + (a1 - a0) * smooth(THREE.MathUtils.clamp((w - 0.35) / 0.3, 0, 1));
        this.Y[i] = amp * (A1 * (1 - Math.cos(2 * Math.PI * k1 * w)) / 2 + A2 * (1 - Math.cos(2 * Math.PI * k2 * w)) / 2);
        if (i > 0) steep = Math.max(steep, Math.abs(this.Y[i] - this.Y[i - 1]) / ROAD_DS);
      }
      if (steep > MAX_GRADE) for (let i = 0; i < n; i++) this.Y[i] *= MAX_GRADE / steep;
    }
    for (let i = 0; i < n; i++) {
      const s = i * ROAD_DS, b = this.blendAt(s);
      this.SM[i] *= hilly * (HILLS[this.fromBiome] + (HILLS[this.toBiome] - HILLS[this.fromBiome]) * b);
    }
    this.coastFrom = this.fromBiome === "coastal" ? 1 : 0; this.coastTo = this.toBiome === "coastal" ? 1 : 0;
    if (arrival) this.D = 0;
    else this.computeMeetings();
  }

  // The drive as it actually goes: `D` seconds from the gate to the hand-over, starting `s0` metres
  // in at `v0`, ending exactly at SB at V_JOIN (the cruising speed is what gives).
  setMotion(D: number, v0: number, s0: number) {
    if (this.inp.kind === "arrival") return;
    const target = this.SB;
    const end = (m: { S: Float64Array }) => m.S[m.S.length - 1];
    // A short drive gets a brisker pull-away too.
    const acc = this.simulate(this.planStops, 32, D, v0, s0).S.at(-1)! < target ? 1.7 : COUNTRY_ACCEL;
    let lo = 6, hi = 34, best = this.simulate(this.planStops, COUNTRY_VMAX, D, v0, s0, acc);
    if (Math.abs(end(best) - target) > 0.01) {
      for (let it = 0; it < 40; it++) {
        const mid = (lo + hi) / 2, m = this.simulate(this.planStops, mid, D, v0, s0, acc);
        best = m;
        if (Math.abs(end(m) - target) < 1e-4) break;
        if (end(m) < target) lo = mid; else hi = mid;
      }
    }
    // Whatever is left (a drive that can't quite make it): eased in over the drive, so it lands
    // exactly, still at V_JOIN.
    const e = end(best), n = best.S.length - 1;
    for (let i = 0; i <= n; i++) { const w = i / n; best.S[i] += (target - e) * smooth(w); best.V[i] += (target - e) * smoothD(w) / D; }
    this.S = best.S; this.V = best.V; this.D = D; this.stops = best.stops;
    this.computeMeetings();
  }

  private computeMeetings() {
    const rail = this.stops.find((s) => s.kind === "rail");
    this.trainT = rail ? rail.arrive + 2 : -1;
    // Oncoming cars: a meeting every 7 to 25 s, none while the crossing is closed, and none
    // within sight of either city (they would drive into its gate street).
    const seed = this.inp.seed, city = this.inp.city, h = (k: number) => hash3(city, k, 0, seed, 0xc0a7);
    this.meetings = [];
    for (let t = 8 + 10 * h(90), i = 0; t < this.D - 6; t += 7 + 18 * hash2(i++, 3, seed + city, 0xcab)) {
      const s = this.sAt(t);
      if (s < 700 || s > this.SB - 260) continue;
      if (rail) {
        const cross = t + (s - rail.s) / ONCOMING_SPEED;
        if (cross > rail.arrive - 8 && cross < rail.arrive + rail.dwell + 2) continue;
      }
      this.meetings.push(t);
    }
  }

  // The truck's motion at 0.1 s steps from the gate: up to cruising speed, slowing for the work
  // zone, stopping for each stop, and settling to V_JOIN well before the hand-over.
  private simulate(stops: { s: number; dwell: number; kind: "truckstop" | "rail" }[], vmax: number, D: number, v0: number, s0: number, acc = COUNTRY_ACCEL) {
    const dt = SIM_DT, n = Math.max(1, Math.round(D / dt)) + 1;
    const S = new Float64Array(n), V = new Float32Array(n);
    let s = s0, v = v0, next = 0, dwell = -1;
    const out: CountryStop[] = [];
    S[0] = s; V[0] = v;
    for (let i = 1; i < n; i++) {
      const t = i * dt;
      if (dwell >= 0) {
        const st = stops[next];
        dwell += dt; v = 0;
        if (dwell >= st.dwell) { dwell = -1; next++; }
      } else {
        let target = Math.min(vmax, V_JOIN + Math.max(0, D - 14 - t) * 0.7);
        if (t > D - 14) target = V_JOIN;
        if (this.geo) { const k = Math.max(this.kAt(s + 10), this.kAt(s + 35), this.kAt(s + 60)); if (k > 1e-5) target = Math.min(target, Math.max(V_JOIN, Math.sqrt(LAT_MAX / k))); }
        if (this.zone && s < this.zone[1]) target = Math.min(target, Math.sqrt(ZONE_V * ZONE_V + 2 * COUNTRY_BRAKE * Math.max(0, this.zone[0] - s)));
        if (next < stops.length) {
          const d = stops[next].s - s;
          target = Math.min(target, Math.max(d > 0.15 ? 0.6 : 0, Math.sqrt(2 * COUNTRY_BRAKE * Math.max(0, d))));
          if (d < 0.15 && v < 0.7) { s = stops[next].s; v = 0; dwell = 0; out.push({ ...stops[next], arrive: t }); }
        }
        if (dwell < 0) {
          v += THREE.MathUtils.clamp(target - v, -2.6 * dt, acc * dt);
          s += v * dt;
        }
      }
      S[i] = s; V[i] = v;
    }
    return { S, V, stops: out };
  }

  // ---- queries ------------------------------------------------------------------------------
  // Seconds from the gate to the hand-over (0 for an arrival straight).
  get duration() { return this.D; }
  // Distance along the road at drive time t (interpolated between steps); past the hand-over, the
  // arrival straight.
  sAt(t: number) {
    if (t > this.D) return this.SB + this.arriveS(t - this.D);
    const f = THREE.MathUtils.clamp(t / SIM_DT, 0, this.S.length - 1), i = Math.floor(f), j = Math.min(i + 1, this.S.length - 1);
    return this.S[i] + (this.S[j] - this.S[i]) * (f - i);
  }
  vAt(t: number) { return t > this.D ? this.arriveV(t - this.D) : this.V[THREE.MathUtils.clamp(Math.round(t / SIM_DT), 0, this.V.length - 1)]; }
  // The arrival into the next city, u seconds after the hand-over. By the highway: ARRIVE_DUR
  // seconds to the gate, slowing to V_GATE. By the freeway: on at V_JOIN up the on-ramp and along
  // it into town, slowing to FW_OFF_V where the off-ramp leaves it (mergeDec() metres before).
  private arriveS(u: number) {
    if (!this.inp.toFreewayMerge) return arriveS(u);
    const total = ARRIVE_LEN + FW_OFF_D, a1 = total - mergeDec(), t1 = a1 / V_JOIN, acc = (V_JOIN * V_JOIN - FW_OFF_V * FW_OFF_V) / (2 * mergeDec()), t2 = (V_JOIN - FW_OFF_V) / acc;
    if (u <= t1) return V_JOIN * Math.max(0, u);
    if (u <= t1 + t2) { const w = u - t1; return a1 + V_JOIN * w - acc * w * w / 2; }
    return total + FW_OFF_V * (u - t1 - t2);
  }
  private arriveV(u: number) {
    if (!this.inp.toFreewayMerge) return arriveV(u);
    const total = ARRIVE_LEN + FW_OFF_D, t1 = (total - mergeDec()) / V_JOIN, acc = (V_JOIN * V_JOIN - FW_OFF_V * FW_OFF_V) / (2 * mergeDec());
    return u <= t1 ? V_JOIN : Math.max(FW_OFF_V, V_JOIN - acc * (u - t1));
  }
  // How long the arrival takes (to the gate, or to the off-ramp).
  get arriveDur() {
    if (!this.inp.toFreewayMerge) return ARRIVE_DUR;
    const acc = (V_JOIN * V_JOIN - FW_OFF_V * FW_OFF_V) / (2 * mergeDec());
    return (ARRIVE_LEN + FW_OFF_D - mergeDec()) / V_JOIN + (V_JOIN - FW_OFF_V) / acc;
  }
  stoppedAt(t: number) { return this.stops.find((s) => t >= s.arrive && t < s.arrive + s.dwell) ?? null; }

  // A point on the centre line at distance s (world), its heading and curvature.
  center(s: number, out: Pose): Pose {
    const f = THREE.MathUtils.clamp(s / ROAD_DS, 0, this.X.length - 1.001), i = Math.floor(f), u = f - i;
    const lx = this.X[i] + (this.X[i + 1] - this.X[i]) * u, lz = this.Z[i] + (this.Z[i + 1] - this.Z[i]) * u;
    const F = this.inp.frame;
    out.x = F.x + lx * this.fc + lz * this.fs;
    out.z = F.z - lx * this.fs + lz * this.fc;
    out.h = F.h + this.H[i] + (this.H[i + 1] - this.H[i]) * u;
    out.k = (this.H[i + 1] - this.H[i]) / ROAD_DS;
    return out;
  }
  // The road's height at distance s (on a flyover into a freeway city, up off the land), and its
  // grade (rise per metre); the land's own level under the road (where the pieces stand).
  heightAt(s: number) { return this.baseAt(s); }
  baseAt(s: number) {
    const f = THREE.MathUtils.clamp(s / ROAD_DS, 0, this.Y.length - 1.001), i = Math.floor(f);
    return this.Y[i] + (this.Y[i + 1] - this.Y[i]) * (f - i);
  }
  gradeAt(s: number) { return (this.heightAt(s + 3) - this.heightAt(s - 3)) / 6; }
  // The truck's height and grade at s: the road's, or up the on-ramp and on the freeway.
  truckY(s: number) { return this.baseAt(s) + (this.inp.toFreewayMerge ? (s > this.gateS ? FW_TOP : onRampY(this.gateS - s)) : 0); }
  truckGrade(s: number) { return (this.truckY(s + 3) - this.truckY(s - 3)) / 6; }
  // The freeway's frame, on a road into a freeway city (freeway.ts).
  private fwFrame: Frame | null = null;
  get freewayFrame(): Frame | null { if (!this.inp.toFreeway) return null; if (!this.fwFrame) this.fwFrame = Frame.ofRoad(this); return this.fwFrame; }
  private at(A: Float64Array, s: number) {
    const f = THREE.MathUtils.clamp(s / ROAD_DS, 0, A.length - 1.001), i = Math.floor(f);
    return A[i] + (A[i + 1] - A[i]) * (f - i);
  }
  private smAt(s: number) { return this.at(this.SM, s); }
  // Lower than any ground between s0 and s1 (for the far land under the fog).
  lowBetween(s0: number, s1: number) {
    let lo = 0;
    const i0 = Math.max(0, Math.floor(s0 / ROAD_DS)), i1 = Math.min(this.Y.length - 1, Math.ceil(s1 / ROAD_DS));
    for (let i = i0; i <= i1; i += 4) lo = Math.min(lo, this.Y[i] - SIDE_HILL * 0.9 * this.SM[i]);
    return lo - 1;
  }
  // How much of the land at s is coast (the sea on the left), easing from one land to the next.
  private coastFrom = 0; private coastTo = 0;
  coastAt(s: number) { return this.coastFrom + (this.coastTo - this.coastFrom) * this.blendAt(s); }
  // The height of the ground at (s, n): the road's level out to the ditches, then the land's own
  // hills (smooth noise, rising more often than falling), eased in over the first 40 m, so the
  // road runs in cuttings and on embankments. On a coast the land falls away to the beach on the
  // left, under the sea beyond it.
  groundAt(s: number, n: number) {
    const y = this.baseAt(s), sm = this.smAt(s), an = Math.abs(n);
    let g = y;
    if (sm > 0 && an > 11) {
      const seed = this.inp.seed + this.inp.city * 977;
      const noise = valueNoise(s / 95, n / 70, seed, 0x41) + 0.4 * valueNoise(s / 38, n / 30, seed, 0x42);
      g += sm * smooth(Math.min(1, (an - 11) / 40)) * SIDE_HILL * (noise * 0.75 + 0.2);
    }
    if (this.shapes.length) g = this.shaped(s, n, y, g);
    const c = n < -11 ? this.coastAt(s) : 0;
    if (c > 0) {
      // (By a set piece the land holds level until just short of the beach.)
      const n0 = -11 + (COAST_N + 4 + 11) * (1 - this.at(this.PM, s));
      const shore = n > n0 ? y : n > COAST_N ? y * (1 - smooth((n0 - n) / (n0 - COAST_N))) : n > SEA_N ? 0 : -1;
      g += (shore - g) * c;
    }
    return g;
  }
  // The road point nearest (x, z), searched within `range` metres of distance `near`: its
  // distance along the road and offset to the right.
  locate(x: number, z: number, near: number, range = 400): { s: number; n: number } {
    const q = this.tmpQ;
    let best = near, bd = Infinity;
    const s0 = Math.max(0, near - range), s1 = Math.min(this.length + 40, near + range);
    for (let s = s0; s <= s1; s += 8) { this.center(s, q); const d = (q.x - x) ** 2 + (q.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    for (let step = 4; step > 0.2; step /= 2) {
      for (const s of [best - step, best + step]) { this.center(s, q); const d = (q.x - x) ** 2 + (q.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    }
    this.center(best, q);
    return { s: best, n: (x - q.x) * Math.sin(q.h) + (z - q.z) * Math.cos(q.h) };
  }
  private tmpQ: Pose = { x: 0, z: 0, h: 0, k: 0 };
  // The pieces that shape the land: tunnels' hills and overpasses' embankments.
  private shapes: RoadPiece[] = [];
  // The tunnel the road is in at s (strictly inside its bore), if any.
  tunnelAt(s: number, margin = 0): RoadPiece | null {
    for (const p of this.shapes) if (p.kind === "tunnel" && s > p.s - margin && s < p.s + p.len + margin) return p;
    return null;
  }
  // Where a camera may stand: the ground, except in a tunnel's bore, where it is the road.
  floorAt(s: number, n: number) {
    return this.tunnelAt(s) && Math.abs(n) < BORE_HALF ? this.heightAt(s) : this.groundAt(s, n);
  }
  // The land the pieces shape, at (s, n) over the road's level y (raising g, the land there).
  private shaped(s: number, n: number, y: number, g: number) {
    const an = Math.abs(n);
    for (const p of this.shapes) {
      if (p.kind === "tunnel") {
        if (s < p.s - CUT_RUN || s > p.s + p.len + CUT_RUN) continue;
        // The hill: over the bore and out across the land, humped along the tunnel; its sides
        // eased down along the approaches, where the road runs into a cutting.
        const top = tunnelTop(p), out = s < p.s ? p.s - s : s > p.s + p.len ? s - p.s - p.len : 0;
        const along = out > 0 ? 1 - smooth(out / CUT_RUN) : 1 + 0.6 * Math.sin(Math.PI * (s - p.s) / p.len);
        const wide = 1 - smooth(THREE.MathUtils.clamp((an - 40) / 110, 0, 1));
        if (out > 0 && an < CUT_N) continue;
        g = Math.max(g, y + top * along * wide);
      } else {
        const ds = Math.abs(s - (p.s + p.len / 2));
        if (ds > OVER_HALF + 16 || an < OVER_ABUT) continue;
        const f = ds < OVER_HALF ? 1 : 1 - smooth((ds - OVER_HALF) / 16), fade = 1 - smooth(THREE.MathUtils.clamp((an - 70) / 70, 0, 1));
        g = Math.max(g, y + (OVER_DECK - 0.1) * f * fade);
      }
    }
    return g;
  }
  // A point `n` metres to the right of the centre line.
  point(s: number, n: number, out: Pose): Pose {
    this.center(s, out);
    out.x += Math.sin(out.h) * n; out.z += Math.cos(out.h) * n;
    return out;
  }
  // The truck's lane offset: the right lane, easing to and from a city street's kerb lane at the
  // gates at both ends.
  laneAt(s: number) {
    if (s < 60 && this.inp.kind === "exit") return LANE_KERB + (LANE - LANE_KERB) * smooth(THREE.MathUtils.clamp(s / 60, 0, 1));
    // Into a city by the freeway: off the highway up its on-ramp and into its right-hand lane.
    if (this.inp.toFreewayMerge) return onRampN(this.gateS - s, LANE);
    if (s > this.gateS - 60) return LANE + (LANE_KERB - LANE) * smooth(THREE.MathUtils.clamp((s - (this.gateS - 60)) / 60, 0, 1));
    return LANE;
  }
  // How far the road has widened to a city street's width near a gate (0 on the open road, 1 at the gate).
  widthAt(s: number) { return Math.max(this.inp.kind === "exit" ? 1 - smooth(THREE.MathUtils.clamp(s / 70, 0, 1)) : 0, smooth(THREE.MathUtils.clamp((s - (this.gateS - 70)) / 70, 0, 1))); }
  // The truck's pose at drive time t.
  poseAt(t: number, out: Pose): Pose {
    const s = this.sAt(t), n = this.laneAt(s), dn = (this.laneAt(s + 0.5) - this.laneAt(s - 0.5));
    this.point(s, n, out);
    out.h -= Math.atan(dn);   // a positive dn moves right, which turns the heading clockwise
    return out;
  }
  // Where the spare waits, and where the old truck is left (no truck changes on the road now).
  sparePose(out: Pose) { this.point(this.swapS + SWAP_AHEAD, APRON, out); return out; }
  parkedPose(out: Pose) { this.point(this.swapS, APRON, out); return out; }
  // Turn signal: on while the lane offset changes ahead.
  indicator(t: number): -1 | 0 | 1 {
    const s = this.sAt(t), d = this.laneAt(s + 30) - this.laneAt(s);
    return d > 0.3 ? 1 : d < -0.3 ? -1 : 0;
  }
  // The land changes from the last city's to the next city's around the middle of the drive, along
  // a ragged line: patches of the next land become more and more common. Settled well before the
  // hand-over (the arrival straight is all the next city's).
  blendAt(s: number) {
    if (this.inp.kind === "arrival") return 1;
    const SB = this.SB, b0 = Math.max(LAND_SEAM + 400, SB * 0.5 - 350), b1 = Math.max(b0 + 200, Math.min(SB - 350, SB * 0.5 + 350));
    return smooth(THREE.MathUtils.clamp((s - b0) / (b1 - b0), 0, 1));
  }
  isFrom(s: number, n = 0) { return hash2(Math.floor(s / 12), Math.floor(n / 12), this.inp.seed, 0xb10) >= this.blendAt(s); }
  biomeAt(s: number, n = 0): BiomeId { return this.isFrom(s, n) ? this.fromBiome : this.toBiome; }
  // The weather at drive time t: the last city's until a third of the way, then the next city's.
  weatherAt(t: number): WeatherMix {
    const k = this.inp.kind === "arrival" || t >= this.D ? 1 : smooth(THREE.MathUtils.clamp((t / this.D - 0.33) / 0.34, 0, 1));
    return lerpWeather(weatherMix(this.inp.fromClimate.weather), weatherMix(this.inp.toClimate.weather), k);
  }
  climateAt(s: number, n = 0): Climate { return this.isFrom(s, n) ? this.inp.fromClimate : this.inp.toClimate; }
  pieceNear(s: number, ahead: number, behind: number): RoadPiece | null {
    for (const p of this.pieces) if (p.s + p.len > s - behind && p.s < s + ahead) return p;
    return null;
  }
  // A set piece worth a roadside shot while the truck (at s) approaches it: where to put the
  // camera and what to frame with the truck. Stops always get one; other pieces most of the time.
  featureShot(s: number): { key: number; cam: [number, number, number]; look: [number, number, number]; fixed: boolean } | null {
    // Taking the freeway: from the ground beyond it, the truck coming out from under it on the
    // on-ramp, towards the camera, and starting up.
    if (this.inp.toFreewayMerge) { const d = this.gateS - s; if (d < 790 && d > 545) return { key: ONRAMP_SHOT, cam: [this.gateS - 515, 36, 3.4], look: [this.gateS - 650, 16, 1.5], fixed: false }; }
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      const stop = this.stops.find((x) => (p.kind === "rail" && x.kind === "rail") || (p.kind === "truckstop" && x.kind === "truckstop"));
      const isSign = p.kind === "leave" || p.kind === "distance" || p.kind === "welcome";
      if (!stop && !isSign && hash2(i, Math.floor(p.s), this.inp.seed, 0x5a0) > 0.7) continue;
      const F: Record<PieceKind, [number, number, number]> = {
        leave: [0, 11, 5], distance: [0, 11, 5], welcome: [0, p.n ?? 11, 5], truckstop: [stop ? SWAP_AHEAD / 2 : 70, stop ? APRON : 38, 2],
        rail: [0, 0, 2.5], construction: [p.len / 2, 10, 1.5], billboards: [140, -22, 8], attraction: [50, p.side * 40, 7],
        weigh: [100, 22, 2], fruit: [40, p.side * 13, 2], watertower: [45, p.side * 32, 14], bridge: [60, 0, 4], gas: [40, p.side * 22, 3],
        tunnel: [0, 0, 4], overpass: [p.len / 2, 0, 2],
      };
      if (p.kind === "bridge") continue;   // its trusses hide the truck from any roadside spot; the chase shots show it
      // A tunnel: from the cutting's shoulder short of the portal, looking on at it, the truck
      // driving past the camera and into the hill. An overpass: from its deck, over the far lane,
      // looking down the road at the truck coming, which passes under the camera.
      if (p.kind === "tunnel" || p.kind === "overpass") {
        const tun = p.kind === "tunnel", cs = tun ? p.s - 55 : p.s + p.len / 2 - 2.5;
        const start = tun ? cs - 8 : cs - 90, end = tun ? p.s + 6 : cs + 2;
        if (s < start || s > end) continue;
        return tun ? { key: i, cam: [cs, -5.6, 3.4], look: [p.s, 0, 3.6], fixed: true }
          : { key: i, cam: [cs, -2.2, OVER_DECK + 2.6], look: [p.s - 60, LANE, 1.4], fixed: true };
      }
      const [fa, fn, fy] = F[p.kind];
      const fs = p.s + fa;
      const side = fn === 0 ? -1 : -Math.sign(fn);
      // Signs and billboards face the oncoming truck, so their camera waits before them on the far
      // side, looking ahead: the shot starts as the truck comes past the camera and follows it on
      // past the sign. Anything else is framed from beyond it, looking back at the truck coming;
      // the shot starts close enough that the truck is in it from the start (a stop at a truck
      // stop or a crossing slows the truck down, so those start further out).
      const facesBack = p.kind === "billboards" || p.kind === "welcome" || p.kind === "leave" || p.kind === "distance";
      const camS = facesBack ? fs - (p.kind === "billboards" ? 110 : 60) : 0;
      const start = facesBack ? camS - 6 : stop ? fs - 130 : fs - 55;
      const end = facesBack ? fs + 10 : p.kind === "rail" || stop ? fs + 12 : fs + 8;
      if (s < start || s > end) continue;
      // At the crossing: from the far side of the tracks, low on the shoulder, looking back at the
      // truck coming to a stop, so the train passes between them and the truck reappears after it.
      const cam: [number, number, number] = p.kind === "rail" ? [fs + 32, -6.8, 1.9]
       
        : facesBack ? [camS, fn > 0 ? -7 : 7, 3.2]
        : p.kind === "truckstop" && stop ? [fs + 26, -7, 4.5]
        : [fs + 32, side * 14, 4.5];
      return { key: i, cam, look: [fs, fn, fy], fixed: facesBack };
    }
    return null;
  }
  // Is (s, n) clear of the road furniture and set pieces (for scenery)?
  clearAt(s: number, n: number) {
    if (Math.abs(n) < 11) return false;
    if (this.inp.toFreeway) { this.point(s, n, this.tmpQ); if (this.freewayFrame!.corridor(this.tmpQ.x, this.tmpQ.z)) return false; }   // under the freeway and its on-ramp
    for (const p of this.pieces) {
      if (s < p.s - 40 || s > p.s + p.len + 40) continue;
      if (p.kind === "rail" || p.kind === "bridge") return false;
      if (p.kind === "tunnel" || p.kind === "overpass") { if (Math.abs(n) < (p.kind === "tunnel" ? 18 : 80)) return false; continue; }
      if (Math.sign(n) === p.side && Math.abs(n) < 75) return false;
      if (Math.abs(n) < 30 && s > p.s - 20) return false;   // room for a roadside camera
    }
    return true;
  }
}

// Smooth value noise in [-1, 1] on a unit grid (smoothstep between hashed corners).
function valueNoise(x: number, y: number, seed: number, salt: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (a: number, b: number) => hash2(ix + a, iy + b, seed, salt) * 2 - 1;
  const top = v(0, 0) + (v(1, 0) - v(0, 0)) * sx, bot = v(0, 1) + (v(1, 1) - v(0, 1)) * sx;
  return top + (bot - top) * sy;
}
