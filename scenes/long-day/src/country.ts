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

export type BiomeId = "coastal" | "forest" | "desert" | "farmland" | "prairie" | "wetlands";
type PieceKind = "leave" | "distance" | "welcome" | "truckstop" | "rail" | "construction" | "billboards" | "attraction"
  | "weigh" | "fruit" | "watertower" | "bridge" | "gas";
export interface RoadPiece { kind: PieceKind; s: number; side: 1 | -1; len: number; variant: number; text?: string }
// A piece's lettered signs, in road coordinates: the centre of the lettering at (s, n) and height
// y, its width and height, all facing the oncoming truck. countryworld.ts builds them from this,
// and the camera director uses it to film them so they can be read. (Billboards: one entry per
// board, in order.)
export interface RoadSign { s: number; n: number; y: number; w: number; h: number; billboard?: boolean }
export function pieceSigns(p: RoadPiece): RoadSign[] {
  const S = p.s, side = p.side;
  switch (p.kind) {
    case "leave": case "distance": case "welcome": return [{ s: S, n: 11, y: 5.2, w: 12.8, h: 1.6 }];
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
// Distance and speed into the arrival straight, u seconds after the hand-over.
function arriveS(u: number) {
  if (u >= ARRIVE_DUR) return ARRIVE_LEN + V_GATE * (u - ARRIVE_DUR);
  const w = Math.max(0, u) / ARRIVE_DUR;
  return V_GATE * Math.max(0, u) + (V_JOIN - V_GATE) * ARRIVE_DUR * (w - (w ** 6 - 3 * w ** 5 + 2.5 * w ** 4));
}
function arriveV(u: number) { return V_GATE + (V_JOIN - V_GATE) * (1 - smooth(THREE.MathUtils.clamp(u / ARRIVE_DUR, 0, 1))); }

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
}

export class CountryRoad {
  readonly key: string;
  readonly fromBiome: BiomeId; readonly toBiome: BiomeId;
  readonly pieces: RoadPiece[] = [];
  stops: CountryStop[] = [];
  readonly length: number;         // to the next city's gate street
  readonly SB: number;             // where the next city takes over (the arrival straight begins)
  readonly swapU: number = -1;     // drive time of a truck change (none: trucks change in town)
  readonly swapS: number = 0;
  readonly landFrom: number; readonly landTo: number;   // the road's own land (the city rings' outside)
  private X: Float64Array; private Z: Float64Array; private H: Float64Array;
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
      this.S = m.S; this.V = m.V; this.D = dur; this.stops = m.stops;
    }
    this.SB = SB;
    const L = this.length = SB + ARRIVE_LEN;
    this.landFrom = arrival ? 0 : LAND_SEAM; this.landTo = L - LAND_SEAM;
    // Signs and the rest of the set pieces, wherever there is room (never near the cities, so
    // nothing the cities' ends can see depends on how long the drive turns out to be).
    if (!arrival) {
      this.pieces.push({ kind: "leave", s: LAND_SEAM + 60, side: 1, len: 40, variant: 0, text: `LEAVING ${inp.fromName.toUpperCase()}` });
      if (SB > 1700) this.pieces.push({ kind: "distance", s: LAND_SEAM + 460, side: 1, len: 40, variant: 0,
        text: `${inp.toName.toUpperCase()}  ${Math.max(1, Math.round((L - LAND_SEAM - 460) / 1609))} MI` });
    }
    this.pieces.push({ kind: "welcome", s: L - 230, side: 1, len: 40, variant: 0, text: `WELCOME TO ${inp.toName.toUpperCase()}` });
    if (!arrival) {
      const extras: [PieceKind, number][] = [["attraction", 120], ["weigh", 200], ["fruit", 80], ["watertower", 90], ["bridge", 120], ["gas", 110]];
      for (let i = extras.length - 1; i > 0; i--) { const j = Math.floor(h(20 + i) * (i + 1)); [extras[i], extras[j]] = [extras[j], extras[i]]; }
      extras.unshift(["billboards", 320]);   // billboards on every drive long enough for them
      let k = 0;
      const lo = 900, hi = SB - 500;
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
    }
    this.pieces.sort((a, b) => a.s - b.s);
    // Geometry: straight out of town, gentle curves, straight into the hand-over and the arrival
    // straight. The curves also turn the road onto the next city's way in (endH): the city's exit
    // gate is chosen so that is never more than a quarter turn.
    const n = Math.ceil((L + 40) / ROAD_DS) + 1;
    this.X = new Float64Array(n); this.Z = new Float64Array(n); this.H = new Float64Array(n);
    const kap = new Float64Array(n), msk = new Float64Array(n);
    const A = [0.0011 + 0.0011 * h(80), 0.0007 * h(81)], W = [2 * Math.PI / (700 + 500 * h(82)), 2 * Math.PI / (260 + 200 * h(83))], P = [h(84) * 6.3, h(85) * 6.3];
    let base = 0, wsum = 0;
    for (let i = 0; i < n; i++) {
      const s = i * ROAD_DS;
      let mask = arrival ? 0 : smooth(THREE.MathUtils.clamp((s - STRAIGHT_OUT) / 120, 0, 1)) * smooth(THREE.MathUtils.clamp((SB - STRAIGHT_IN - s) / 120, 0, 1));
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
    if (t > this.D) return this.SB + arriveS(t - this.D);
    const f = THREE.MathUtils.clamp(t / SIM_DT, 0, this.S.length - 1), i = Math.floor(f), j = Math.min(i + 1, this.S.length - 1);
    return this.S[i] + (this.S[j] - this.S[i]) * (f - i);
  }
  vAt(t: number) { return t > this.D ? arriveV(t - this.D) : this.V[THREE.MathUtils.clamp(Math.round(t / SIM_DT), 0, this.V.length - 1)]; }
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
    if (s > this.length - 60) return LANE + (LANE_KERB - LANE) * smooth(THREE.MathUtils.clamp((s - (this.length - 60)) / 60, 0, 1));
    return LANE;
  }
  // How far the road has widened to a city street's width near a gate (0 on the open road, 1 at the gate).
  widthAt(s: number) { return Math.max(this.inp.kind === "exit" ? 1 - smooth(THREE.MathUtils.clamp(s / 70, 0, 1)) : 0, smooth(THREE.MathUtils.clamp((s - (this.length - 70)) / 70, 0, 1))); }
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
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i];
      const stop = this.stops.find((x) => (p.kind === "rail" && x.kind === "rail") || (p.kind === "truckstop" && x.kind === "truckstop"));
      const isSign = p.kind === "leave" || p.kind === "distance" || p.kind === "welcome";
      if (!stop && !isSign && hash2(i, Math.floor(p.s), this.inp.seed, 0x5a0) > 0.7) continue;
      const F: Record<PieceKind, [number, number, number]> = {
        leave: [0, 11, 5], distance: [0, 11, 5], welcome: [0, 11, 5], truckstop: [stop ? SWAP_AHEAD / 2 : 70, stop ? APRON : 38, 2],
        rail: [0, 0, 2.5], construction: [p.len / 2, 10, 1.5], billboards: [140, -22, 8], attraction: [50, p.side * 40, 7],
        weigh: [100, 22, 2], fruit: [40, p.side * 13, 2], watertower: [45, p.side * 32, 14], bridge: [60, 0, 4], gas: [40, p.side * 22, 3],
      };
      if (p.kind === "bridge") continue;   // its trusses hide the truck from any roadside spot; the chase shots show it
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
    for (const p of this.pieces) {
      if (s < p.s - 40 || s > p.s + p.len + 40) continue;
      if (p.kind === "rail" || p.kind === "bridge") return false;
      if (Math.sign(n) === p.side && Math.abs(n) < 75) return false;
      if (Math.abs(n) < 30 && s > p.s - 20) return false;   // room for a roadside camera
    }
    return true;
  }
}
