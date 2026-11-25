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
import { seaSide } from "./outline.ts";
import { CityPlan } from "./city.ts";
import { Frame, freewayGate, FW_ENTRANCE_SIGN, FW_OFF_D, FW_OFF_V, FW_SHIFT, FW_TOP, onRampN, onRampY } from "./freeway.ts";
import type { FwCurve } from "./freeway.ts";
import { drain } from "./slices.ts";
import type { Steps } from "./slices.ts";
type Writable<T> = { -readonly [K in keyof T]: T[K] };

export type BiomeId = "coastal" | "forest" | "desert" | "farmland" | "prairie" | "wetlands" | "storybook";
type PieceKind = "leave" | "distance" | "welcome" | "truckstop" | "rail" | "construction" | "billboards" | "attraction"
  | "weigh" | "fruit" | "watertower" | "bridge" | "gas" | "tunnel" | "overpass" | "fwsign" | "ferry" | "cattle" | "tractor";
export interface RoadPiece { kind: PieceKind; s: number; side: 1 | -1; len: number; variant: number; text?: string; n?: number; open?: boolean }
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
    case "truckstop": return [{ s: S - 60, n: TS_SIGN_N, y: 14.2, w: 9.0, h: 1.1 }];
    case "construction": return [{ s: S, n: 9, y: 2.6, w: 5.2, h: 0.7 }];
    case "attraction": return [{ s: S, n: side * 15, y: 3.2, w: 6.8, h: 0.85 }];
    case "weigh": return [{ s: S - 80, n: 10, y: 4.0, w: 8.4, h: 1.05 }];
    case "ferry": return [{ s: S - 150, n: 10, y: 4.0, w: 8.4, h: 1.05 }];
    case "cattle": return [{ s: S - 150, n: 9, y: 2.9, w: 4.4, h: 0.62 }];
    case "fruit": return [{ s: S, n: side * 9.5, y: 1.6, w: 4.0, h: 0.5 }];
    case "gas": return [{ s: S + GAS_SIGN, n: side * GAS_SIGN_N, y: 7.2, w: 4.6, h: 0.6 }];
    // A freeway's signs (freeway.ts draws them): its entrance sign by the highway, and the
    // plates over its lanes on the gantries ahead of the exit and where its lane opens.
    case "fwsign": return [p.variant === 0 ? { s: S, n: p.n ?? 8.8, y: 3.55, w: 5.6, h: 0.7 } : { s: S, n: p.n ?? 0, y: FW_TOP + 6.35, w: 6.4, h: 0.8 }];
    default: return [];
  }
}
// A roadside business's paving, in road coordinates: its lot, and the drives that take it off the
// road and back on. Each is a band along the road: at each of its stations `s` it runs across from
// `lo` to `hi` metres out from the centre line, on the piece's side (`side`), linearly between
// stations; its top `top` above the piece's ground. Every lot is reached from the road through its
// drives: a drive starts at the asphalt's edge (PAVE_EDGE, just inside it, over the shoulder) and
// meets its lot along a shared edge.
// A gas station or a truck stop has a slip lane at each end, the same both ways so either side of
// the road reads right: it peels off the road's edge in a long smooth taper to a lane's width,
// runs along beside the road, and its inner edge swings out in an easy S onto the lot, leaving a
// grass island between the lot and the road. A fruit stand pulls in onto a gravel shoulder in
// front of it; an attraction has a car park and a drive straight in off the road.
// countryworld.ts lays them; the test checks them.
export const PAVE_EDGE = 4.0;
export const GAS_SIGN = 55, GAS_SIGN_N = 10;   // a gas station's price sign, on the island between its drives (from its s, out)
export const TS_SIGN_N = 27;   // the truck stop's tall sign, just past its apron
export type PaveKind = "drive" | "lot" | "apron" | "gravel";
export interface RoadPave { kind: PaveKind; top: number; side: 1 | -1; s: number[]; lo: number[]; hi: number[] }
const BAY_STEP = 2;   // a slip lane's stations along its curves
const slipEase = (u: number) => { const x = Math.min(1, Math.max(0, u)); return x * x * x * (x * (6 * x - 15) + 10); };   // (smootherstep: flat at both ends)
// A slip lane onto a lot's front (n = N) whose near corner is at s = c, the lot lying beyond it in
// direction `dir` (+1: the lot starts at c and runs on; -1: it ends at c): a lane BAY_W wide that
// tapers off the road's edge, runs along beside it, and swings out in an easy S (its centre line
// on a smootherstep over BAY_CURVE) to come onto the lot just past the corner, its width kept
// square to its own heading through the curve.
export const BAY_W = 5, BAY_TAPER = 34, BAY_RUN = 16, BAY_CURVE = 64;
function slipLane(c: number, dir: 1 | -1, N: number, side: 1 | -1, S: number): RoadPave {
  const E = PAVE_EDGE, W = BAY_W, n0 = E + W / 2, n1 = N + W / 2, dn = n1 - n0;
  // (Across the road, the lane's edges at d along the curve from its start.)
  const edges = (d: number): [number, number] => {
    const u = Math.min(1, Math.max(0, d / BAY_CURVE)), x = u;
    const nc = n0 + dn * slipEase(u), slope = dn / BAY_CURVE * 30 * x * x * (1 - x) * (1 - x);
    const hw = W / 2 * Math.hypot(1, slope);
    return [nc - hw, nc + hw];
  };
  // The curve starts where its outer edge then reaches the lot's front at the corner.
  let d0 = 0;
  for (let d = 0; d <= BAY_CURVE; d += 0.05) if (edges(d)[1] >= N) { d0 = d; break; }
  const start = -d0 - BAY_RUN - BAY_TAPER, end = BAY_CURVE - d0;
  const s: number[] = [], lo: number[] = [], hi: number[] = [];
  for (let d = start; d <= end + 1e-9; d += BAY_STEP) {
    let a: number, b: number;
    if (d < start + BAY_TAPER) { a = E; b = E + W * slipEase((d - start) / BAY_TAPER); }
    else if (d < -d0) { a = E; b = E + W; }
    else { [a, b] = edges(d + d0); a = Math.max(E, a); }
    if (d > 0) b = Math.min(b, N);           // (the lot from the corner on)
    a = Math.min(a, b);
    s.push(S + c + dir * d); lo.push(a); hi.push(b);
  }
  if (lo[lo.length - 1] < N) { s.push(S + c + dir * end); lo.push(N); hi.push(N); }   // (closed onto the lot at its very end)
  if (dir < 0) { s.reverse(); lo.reverse(); hi.reverse(); }
  return { kind: "drive", top: 0, side, s, lo, hi };
}
// Gas stations and truck stops stand back from the road, a grass island between, their slip lanes
// curving across it: the front of the forecourt (or the truck stop's apron) is FORECOURT out.
export const FORECOURT = 16;
export function piecePaving(p: RoadPiece): RoadPave[] {
  const S = p.s, sd = p.side, E = PAVE_EDGE;
  const band = (kind: PaveKind, top: number, st: [number, number, number][]): RoadPave =>
    ({ kind, top, side: sd, s: st.map((q) => S + q[0]), lo: st.map((q) => q[1]), hi: st.map((q) => q[2]) });
  const rect = (kind: PaveKind, top: number, a0: number, a1: number, n0: number, n1: number) => band(kind, top, [[a0, n0, n1], [a1, n0, n1]]);
  switch (p.kind) {
    case "gas": return [
      rect("lot", 0.005, 0, p.len, FORECOURT, FORECOURT + 18),
      slipLane(0, 1, FORECOURT, sd, S),             // in (or out, from the far side)
      slipLane(p.len, -1, FORECOURT, sd, S),
    ];
    case "truckstop": return [
      rect("apron", 0.01, -120, 150, FORECOURT, FORECOURT + 9),
      rect("lot", 0.005, -40, 120, FORECOURT + 9, FORECOURT + 34),
      rect("lot", 0.005, 85, 130, FORECOURT + 34, FORECOURT + 54),   // the rental trucks' lot
      slipLane(-120, 1, FORECOURT, sd, S),
      slipLane(150, -1, FORECOURT, sd, S),
    ];
    case "fruit": return [band("gravel", 0, [[12, E, E], [22, E, 10.6], [58, E, 10.6], [68, E, E]])];
    case "attraction": return [
      rect("lot", 0.005, 22, 78, 18, 31),
      band("drive", 0, [[36, E, E], [44, E, 9], [56, E, 9], [64, E, E]]),
      rect("drive", 0, 44, 56, 9, 18),
    ];
    default: return [];
  }
}
// A band's extent across the road at s (null off its ends), its edges as distances out.
export function paveAt(v: RoadPave, s: number): [number, number] | null {
  const S = v.s;
  if (s < S[0] - 1e-9 || s > S[S.length - 1] + 1e-9) return null;
  let i = 0;
  while (i < S.length - 2 && s > S[i + 1]) i++;
  const u = S[i + 1] > S[i] ? Math.min(1, Math.max(0, (s - S[i]) / (S[i + 1] - S[i]))) : 0;
  return [v.lo[i] + (v.lo[i + 1] - v.lo[i]) * u, v.hi[i] + (v.hi[i + 1] - v.hi[i]) * u];
}
// The stretch of road a piece's ground takes up: its own, and its paving's (the land is levelled
// and kept clear of scenery over this).
export function pieceGround(p: RoadPiece): [number, number] {
  let a = p.s, b = p.s + p.len;
  for (const v of piecePaving(p)) { a = Math.min(a, v.s[0]); b = Math.max(b, v.s[v.s.length - 1]); }
  return [a, b];
}
// The stretch of road a piece takes up, its drives and signs included (pieces keep apart by these).
export function pieceSpan(p: RoadPiece): [number, number] {
  let [a, b] = pieceGround(p);
  for (const g of pieceSigns(p)) { a = Math.min(a, g.s - 1); b = Math.max(b, g.s + 1); }
  return [a, b];
}
type RoadStopKind = "truckstop" | "rail" | "weigh" | "ferry" | "cattle";
interface CountryStop { s: number; dwell: number; kind: RoadStopKind; arrive: number }
// A weigh station (piece "weigh", from its s): its lane beside the road, the scale on it and the
// signal at the scale's far end. When it is open (`open`) every truck has to cross the scale: the
// truck signals and leaves the road along WEIGH_OUT, stops with its rear axle at WEIGH_STOP until
// the light goes green, and comes back on along WEIGH_BACK.
export const WEIGH_N = 12.5, WEIGH_LEN = 200;
export const WEIGH_OUT: [number, number] = [-30, 70], WEIGH_BACK: [number, number] = [125, 200];
export const WEIGH_SCALE: [number, number] = [84, 110], WEIGH_STOP = 96, WEIGH_LIGHT = 113;
export const WEIGH_DWELL = 7, WEIGH_GREEN = 1.5;
// A car ferry (piece "ferry", on some drives into a port city): from its s, the ticket booth
// (the truck stops with its rear axle at FERRY_BOOTH), the near quay's edge at FERRY_Q0, open water
// FERRY_W long, the far quay and FERRY_OUT of road on past it. The boat (BOAT_L long, its car
// deck level with the quays) waits at the near quay; the truck creeps aboard and stops
// FERRY_BOARD past the boat's rear, rides across with it, and drives off at the far quay. The
// boat's rear is always the truck's distance less FERRY_BOARD, held between the two quays (so
// it is a pure function of where the truck is). The water is WATER_DROP under the quays.
export const FERRY_BOOTH = 30, FERRY_Q0 = 110, FERRY_W = 640, FERRY_OUT = 80, FERRY_LEN = FERRY_Q0 + FERRY_W + FERRY_OUT;
export const BOAT_L = 56, BOAT_W = 14, FERRY_BOARD = 44, BOAT_GAP = 0.3, WATER_DROP = 1.6;
const FERRY_V = 7, FERRY_ACC = 0.35, CREEP_V = 3.5, FERRY_DWELL = [6, 5, 5];   // (at the booth, aboard before it sails, at the far quay)
// A cattle crossing (piece "cattle", in farm country): a herd walks out of a pasture through its
// gate (side A), across the road in a column and into a corral through the gate opposite (side
// B), where a barn stands; a rider brings up the rear. The truck stops CATTLE_STOP short of the
// crossing line (s + CATTLE_X) and waits for the road to clear. The herd sets off CATTLE_LEAD
// before the truck stops (herd time 0), so it is already crossing as the truck comes up to it.
// It moves as a loose group (herd()): each cow reaches the pasture gate at its own time (some
// close together, side by side), walks at its own pace, surging and easing, and fans out across
// the road.
export const CATTLE_X = 40, CATTLE_LEN = 80, CATTLE_STOP = 22, COW_GATE = 14.5, COW_V = 1.5, CATTLE_LEAD = 21;
export interface CattlePlan { s: number; cross: number; sideA: 1 | -1; n: number }
// One of the herd (the rider last): its path in road coordinates (s, n pairs), the distance along
// it at each point, and its pace: it sets off at herd time `leave`, covering herdDist(m, t - leave).
export interface HerdMember { pts: number[]; cum: number[]; leave: number; vf: number; amp: number; w: number; ph: number; rider: boolean; coat: number }
export function herdDist(m: HerdMember, tau: number) {
  if (tau <= 0) return 0;
  const d = m.vf * COW_V * tau + m.amp * (Math.sin(m.w * tau + m.ph) - Math.sin(m.ph));   // (never backwards: amp * w < vf * COW_V)
  return Math.min(d, m.cum[m.cum.length - 1]);
}
const herdTime = (m: HerdMember, d: number) => { let lo = 0, hi = 400; for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (herdDist(m, mid) < d) lo = mid; else hi = mid; } return hi; };
// A farm tractor towing a hay wagon (piece "tractor", in farm country): it pulls out of a field
// gate on the right at the piece's s (along an arc from TRACTOR_R back up the field track) as
// the truck comes up, drives on at TRACTOR_V, and turns off into another field at s + TRACTOR_B.
// The truck catches it up, follows for a while and passes it in the other lane (the oncoming lane
// is kept clear), back in its own once well past (TractorRun records where, from the motion).
export const TRACTOR_V = 6.2, TRACTOR_B = 700, TRACTOR_LEN = 1000, TRACTOR_R = 14.15, TRACTOR_PULL = 5;
export const TRACTOR_FRONT = 3.1, TRACTOR_TAIL = 5.7;   // its nose and its wagon's tail, from its rear axle
export interface TractorRun { appear: number; follow: number; pass0: number; pass1: number }
export interface FerryPlan { s: number; booth: number; q0: number; q1: number; board: number; land: number }   // (the light goes green this long before the truck pulls off)

const ROAD_DS = 2;               // geometry sample spacing (m)
export const LANE = 1.85;               // right lane centre from the centre line
const APRON = 20.5;              // the truck stop's parking lane, from the centre line (FORECOURT + 4.5)
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
// The least road left between the straights to turn onto the next city's way in (m).
const TURN_ROOM = 360;
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
export const HILLS: Record<BiomeId, number> = { coastal: 0.9, forest: 1, desert: 0.7, farmland: 0.55, prairie: 0.35, wetlands: 0, storybook: 1 };
const MAX_GRADE = 0.055;
const HILL_FLAT = 35, HILL_EASE = 90;   // set pieces sit on the level: this far either side, then eased over this
const SIDE_HILL = 16;                   // the land beside the road rises or falls up to about this much (m)
export const COAST_N = -57, SEA_N = -75; // the beach (coastal land, on the left) and the sea beyond it
const COAST_FADE = 500;                  // the coast fades out over this far to a city's gate (coastAt)
// A tunnel through a hill: its bore (half width, height inside), the cutting walls either side of
// its approaches, how far they run out, and the hill's height over the road at the portals.
export const BORE_HALF = 5.2, BORE_H = 6.6, CUT_N = 7.6, CUT_RUN = 80;
// An overpass: a cross road (or railway) on a bridge over the road, on embankments either side.
export const OVER_DECK = 6.6, OVER_HALF = 7, OVER_ABUT = 10.5;
export const tunnelTop = (p: RoadPiece) => 11 + 3 * p.variant;   // the hill over a tunnel's portals

export const BIOME_OF: Record<StyleId, BiomeId> = { coastal: "coastal", metro: "forest", desert: "desert", brick: "farmland", mainstreet: "prairie", port: "wetlands", storybook: "storybook" };

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
  toSea: boolean;   // the next city (or, arriving, this one) is on the sea, as its plan is built (CityPlan.outline)
  fromCurve?: FwCurve | null;   // leaving a freeway city: its freeway's curve as the city was laid out (CityPlan.fwCurve, after its graph: an organic town that fell back has none)
}

export class CountryRoad {
  readonly key: string;
  readonly fromBiome: BiomeId; readonly toBiome: BiomeId;
  readonly pieces: RoadPiece[] = [];
  stops: CountryStop[] = [];
  readonly length!: number;         // to the next city's gate street (on into town, along a freeway the truck takes)
  readonly gateS!: number;          // where the next city's gate street begins
  readonly SB!: number;             // where the next city takes over (the arrival straight begins)
  readonly swapU: number = -1;     // drive time of a truck change (none: trucks change in town)
  readonly swapS: number = 0;
  readonly landFrom!: number; readonly landTo!: number;   // the road's own land (the city rings' outside)
  private X!: Float64Array; private Z!: Float64Array; private H!: Float64Array;
  private Y!: Float64Array;          // the road's height at each geometry sample
  private SM!: Float64Array;         // how far the land beside the road may rise and fall there (0..1)
  private PM!: Float64Array;         // 0 at the set pieces (the land level round them), 1 clear of them
  private S: Float64Array = new Float64Array(1); private V: Float32Array = new Float32Array(1);   // per motion step, to the hand-over
  private zone: [number, number] | null = null;
  ferry: FerryPlan | null = null;   // this drive's ferry, if it has one
  cattle: CattlePlan | null = null; tractor: { s: number } | null = null;
  tractorRun: TractorRun | null = null;   // (from the motion)
  private planStops: { s: number; dwell: number; kind: RoadStopKind }[] = [];
  trainT = -1;                     // drive time the train front reaches the far side of the road, start
  meetings: number[] = [];         // drive times oncoming cars pass the truck
  private D = 0;                   // seconds to the hand-over
  private geo = false;             // the geometry is built (the motion then eases off for curves)
  private kAt(s: number) { const f = Math.min(Math.max(s / ROAD_DS, 0), this.H.length - 2), i = Math.floor(f); return Math.abs(this.H[i + 1] - this.H[i]) / ROAD_DS; }
  private fc: number; private fs: number;   // the frame's rotation

  constructor(readonly inp: CountryInput, ahead = false) {
    const { seed, city } = inp;
    this.key = `${inp.kind}/${seed}/${city}/${inp.frame.x.toFixed(2)},${inp.frame.z.toFixed(2)},${inp.frame.h.toFixed(4)}/${inp.dEst.toFixed(1)}`;
    this.fc = Math.cos(inp.frame.h); this.fs = Math.sin(inp.frame.h);
    const arrival = inp.kind === "arrival";
    this.toBiome = BIOME_OF[inp.toStyle.id]; this.fromBiome = arrival ? this.toBiome : BIOME_OF[inp.fromStyle.id];
    this.job = this.build();
    if (!ahead) this.finish();
  }
  // The rest of the road (its pieces, motion, geometry and heights): built at once, or (`ahead`) a
  // piece at a time as the journey goes on (slices.ts; Journey.exitRoadAhead), and the rest at
  // first use. Nothing else of it may be asked before it is built.
  private job: Steps<void> | null;
  get built() { return !this.job; }
  prepare(pieces: number): boolean {
    for (let i = 0; i < pieces && this.job; i++) if (this.job.next().done) this.job = null;
    return !this.job;
  }
  finish() { if (this.job) { drain(this.job); this.job = null; } }
  private *build(): Steps<void> {
    const inp = this.inp, { seed, city } = inp, arrival = inp.kind === "arrival", self = this as Writable<CountryRoad>;
    const h = (k: number) => hash3(city, k, 0, seed, 0xc0a7);
    let SB = 0;
    if (!arrival) {
      const dur = Math.max(20, inp.dEst);
      // Construction zone (motion slows through it) on drives long enough to spare it.
      const estL = COUNTRY_VMAX * dur * 0.85;
      if (dur > 200 && h(1) < 0.45) { const z0 = Math.max(900, estL * (0.15 + 0.1 * h(2))); if (z0 + 220 < estL - 700) this.zone = [z0, z0 + 220]; }
      // First pass: no stops, to see how far the drive goes.
      let m = this.simulate([], COUNTRY_VMAX, dur, 9, 0);
      yield;
      const L1 = m.S[m.S.length - 1];
      const at = (k: number) => m.S[Math.min(m.S.length - 1, Math.floor(k * (m.S.length - 1)))];
      const truckstopS = dur > 70 ? Math.max(900, at(0.3 + 0.2 * h(3))) : -1;
      if (truckstopS > 0 && truckstopS < L1 - 600 && h(4) < 0.6) this.pieces.push({ kind: "truckstop", s: truckstopS, side: 1, len: 260, variant: 0 });
      // A ferry on about half the long drives into a port city (into one with a freeway, well
      // short of the freeway's stretch). It takes the place of a truck stop in its way.
      if (inp.toStyle.id === "port" && dur > 260 && h(140) < 0.5) {
        for (const k of [0.5, 0.4, 0.62]) {
          const fs = Math.max(1200, at(k));
          if (fs + FERRY_LEN > L1 - (inp.toFreeway ? 2300 : 1100)) continue;
          const ts = this.pieces.findIndex((p) => p.kind === "truckstop");
          if (ts >= 0 && fs < truckstopS + 260 + 300 && fs + FERRY_LEN > truckstopS - 300) this.pieces.splice(ts, 1);
          this.setFerry(fs);
          break;
        }
      }
      const railS = dur > 170 && h(5) < 0.7 ? at(0.68) : -1;
      const nearFerry = (x: number) => !!this.ferry && x > this.ferry.s - 500 && x < this.ferry.s + FERRY_LEN + 500;
      if (railS > 900 && railS < L1 - 700 && !nearFerry(railS) && (truckstopS < 0 || Math.abs(railS - truckstopS) > 400)) {
        this.planStops.push({ s: railS - 16, dwell: RAIL_DWELL, kind: "rail" });   // the nose short of the gate
        this.pieces.push({ kind: "rail", s: railS, side: 1, len: 80, variant: 0 });
      }
      if (this.zone) this.pieces.push({ kind: "construction", s: this.zone[0] - 60, side: 1, len: this.zone[1] - this.zone[0] + 140, variant: 0 });
      m = this.simulate(this.planStops, COUNTRY_VMAX, dur, 9, 0);
      if (this.ferry && this.ferry.s + FERRY_LEN > m.S[m.S.length - 1] - 700) {
        yield;
        this.pieces.splice(this.pieces.findIndex((p) => p.kind === "ferry"), 1);
        this.planStops = this.planStops.filter((x) => x.kind !== "ferry"); this.ferry = null;
        m = this.simulate(this.planStops, COUNTRY_VMAX, dur, 9, 0);
      }
      SB = Math.max(STRAIGHT_OUT + 400, m.S[m.S.length - 1]);
      // Into a freeway city, nothing that stops the truck or sprawls by the road out where the
      // freeway and the flyover are (the drive is replanned without it: it only gets longer).
      yield;
      const fwClash = (p: RoadPiece) => inp.toFreeway && p.s + p.len > SB - 1150;
      if (this.pieces.some(fwClash)) {
        for (const p of this.pieces.filter(fwClash)) {
          this.pieces.splice(this.pieces.indexOf(p), 1);
          if (p.kind === "construction") this.zone = null;
          if (p.kind === "rail") this.planStops = this.planStops.filter((x) => x.kind !== "rail");
          if (p.kind === "ferry") { this.planStops = this.planStops.filter((x) => x.kind !== "ferry"); this.ferry = null; }
        }
        m = this.simulate(this.planStops, COUNTRY_VMAX, dur, 9, 0);
        SB = Math.max(STRAIGHT_OUT + 400, m.S[m.S.length - 1]);
      }
      this.S = m.S; this.V = m.V; this.D = dur; this.stops = m.stops;
    }
    yield;
    self.SB = SB;
    const L = self.gateS = SB + ARRIVE_LEN;
    self.length = L + (inp.toFreewayMerge ? FW_OFF_D : 0);
    self.landFrom = arrival ? 0 : LAND_SEAM; self.landTo = L - LAND_SEAM;
    // Signs and the rest of the set pieces, wherever there is room (never near the cities, so
    // nothing the cities' ends can see depends on how long the drive turns out to be).
    if (!arrival) {
      this.pieces.push({ kind: "leave", s: LAND_SEAM + 60, side: 1, len: 40, variant: inp.fromStyle.storybook ? 1 : 0, text: `LEAVING ${inp.fromName.toUpperCase()}` });
      if (SB > 1700) this.pieces.push({ kind: "distance", s: LAND_SEAM + 460, side: 1, len: 40, variant: 0,
        text: `${inp.toName.toUpperCase()}  ${Math.max(1, Math.round((L - LAND_SEAM - 460) / 1609))} MI` });
    }
    if (inp.toFreeway) {
      this.pieces.push({ kind: "fwsign", s: L - FW_ENTRANCE_SIGN, side: 1, len: 6, variant: 0, n: 8.8 });
      if (inp.toFreewayMerge) {
        this.pieces.push({ kind: "fwsign", s: L - 200, side: 1, len: 6, variant: 1, n: FW_SHIFT + 3.7 });
        this.pieces.push({ kind: "fwsign", s: L + FW_OFF_D - 4, side: 1, len: 6, variant: 2, n: 3.7 });
      }
    }
    this.pieces.push({ kind: "welcome", s: L - (inp.toFreeway ? 940 : 230), side: 1, len: 40, variant: inp.toStyle.storybook ? 1 : 0, text: `WELCOME TO ${inp.toName.toUpperCase()}`, n: inp.toFreeway ? -12 : undefined });   // (into a freeway city, on the left: the freeway is on the right)
    if (!arrival) {
      // Farm country: a cattle crossing and a tractor to pass, now and then (where the land at
      // both ends of them is farmland or prairie).
      const lo = 900, hi = SB - (inp.toFreeway ? 1150 : 500);
      const farmAt = (x: number) => { const b = this.blendAt(x) < 0.5 ? this.fromBiome : this.toBiome; return b === "farmland" || b === "prairie"; };
      const farm: [PieceKind, number][] = [];
      if (this.D > 150 && h(150) < 0.55) farm.push(["cattle", CATTLE_LEN]);
      if (this.D > 200 && h(151) < 0.5) farm.push(["tractor", TRACTOR_LEN]);
      let moved = false, fk = 0;
      for (const [kind, len] of farm) {
        for (let tries = 0; tries < 12 && hi - len > lo; tries++) {
          const fs = lo + h(160 + fk * 9 + tries) * (hi - len - lo);
          if (this.pieces.some((p) => fs < p.s + p.len + 300 && fs + len + 300 > p.s)) continue;
          if (!farmAt(fs - 200) || !farmAt(fs + len + 100)) continue;
          if (kind === "cattle") {
            const sideA: 1 | -1 = h(170) < 0.5 ? 1 : -1, n = 8 + Math.floor(h(171) * 4);
            this.cattle = { s: fs, cross: fs + CATTLE_X, sideA, n };
            this.pieces.push({ kind, s: fs, side: (-sideA) as 1 | -1, len, variant: n, text: "CATTLE XING" });
            // (The truck waits till the last of them is off the road: |n| < 6, plus a moment.)
            let clear = 0;
            for (const m of this.herd()) clear = Math.max(clear, m.leave + herdTime(m, m.cum[1] + COW_GATE + 6));
            this.planStops.push({ s: fs + CATTLE_X - CATTLE_STOP, dwell: Math.max(4, clear - CATTLE_LEAD + 2), kind: "cattle" });
            this.planStops.sort((a, b) => a.s - b.s);
          } else {
            this.tractor = { s: fs + 260 };
            this.pieces.push({ kind, s: fs, side: 1, len, variant: 0 });
          }
          moved = true;
          break;
        }
        fk++;
      }
      const extras: [PieceKind, number][] = [["attraction", 120], ["weigh", WEIGH_LEN], ["fruit", 80], ["watertower", 90], ["bridge", 120], ["gas", 110]];
      for (let i = extras.length - 1; i > 0; i--) { const j = Math.floor(h(20 + i) * (i + 1)); [extras[i], extras[j]] = [extras[j], extras[i]]; }
      extras.unshift(["billboards", 320]);   // billboards on every drive long enough for them
      let k = 0;
      for (const [kind, len] of extras) {
        yield;
        for (let tries = 0; tries < 8 && hi - len > lo; tries++) {
          const s = lo + h(40 + k * 9 + tries) * (hi - len - lo);
          const [a, b] = pieceSpan({ kind, s, side: 1, len, variant: 0 });
          if (this.pieces.some((p) => { const [c, d] = pieceSpan(p); return a < d + 120 && b + 120 > c; })) continue;
          if (kind === "weigh" && this.pieces.some((p) => p.kind === "truckstop" && Math.abs(p.s - s) < 800)) continue;
          this.pieces.push({ kind, s, side: kind === "gas" || kind === "fruit" ? (h(60 + k) < 0.5 ? 1 : -1) : kind === "weigh" ? 1 : h(60 + k) < 0.5 ? 1 : -1,
            len, variant: Math.floor(h(70 + k) * 4) });
          break;
        }
        k++;
      }
      // An open weigh station, on a drive with time to spare for it: the truck crosses its scale.
      const weigh = this.pieces.find((p) => p.kind === "weigh");
      if (weigh && this.D > 150 && h(130) < 0.5) {
        weigh.open = true;
        this.planStops.push({ s: weigh.s + WEIGH_STOP, dwell: WEIGH_DWELL, kind: "weigh" });
        this.planStops.sort((a, b) => a.s - b.s);
        const m = this.simulate(this.planStops, COUNTRY_VMAX, this.D, 9, 0);
        this.S = m.S; this.V = m.V; this.stops = m.stops;
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
          if (this.pieces.some((p) => { const [g0, g1] = this.groundOf(p); return s < g1 + 200 && s + len + 200 > g0; })) continue;
          if (kind === "tunnel" && !(hillyAt(s - CUT_RUN) && hillyAt(s + len + CUT_RUN))) continue;
          if (kind === "overpass" && (this.blendAt(s) < 0.5 ? this.fromBiome : this.toBiome) === "coastal") continue;
          this.pieces.push({ kind, s, side: 1, len, variant: Math.floor(h(120 + k) * (kind === "tunnel" ? 3 : 2)) });
          break;
        }
        k++;
      }
      if (moved) { const m = this.simulate(this.planStops, COUNTRY_VMAX, this.D, 9, 0); this.S = m.S; this.V = m.V; this.stops = m.stops; this.tractorRun = m.tractor; }
    }
    yield;
    this.pieces.sort((a, b) => a.s - b.s);
    this.shapes = this.pieces.filter((p) => p.kind === "tunnel" || p.kind === "overpass");
    // Geometry: straight out of town, gentle curves, straight into the hand-over and the arrival
    // straight. The curves also turn the road onto the next city's way in (endH): the city's exit
    // gate is chosen so that is never more than a quarter turn.
    const n = Math.ceil((this.length + 40) / ROAD_DS) + 1;
    this.X = new Float64Array(n); this.Z = new Float64Array(n); this.H = new Float64Array(n);
    // (Into a freeway city on a short road, the straight beside the freeway shortened, and its
    // first sign curved past, so there is still a stretch to turn on: else the road would end
    // turned the wrong way for the next city's way in.)
    const sIn = inp.toFreeway ? Math.max(STRAIGHT_IN, Math.min(FW_STRAIGHT_IN, SB - STRAIGHT_OUT - TURN_ROOM)) : STRAIGHT_IN, short = inp.toFreeway && sIn < FW_STRAIGHT_IN;
    const kap = new Float64Array(n), msk = new Float64Array(n);
    const A = [0.0011 + 0.0011 * h(80), 0.0007 * h(81)], W = [2 * Math.PI / (700 + 500 * h(82)), 2 * Math.PI / (260 + 200 * h(83))], P = [h(84) * 6.3, h(85) * 6.3];
    let base = 0, wsum = 0;
    for (let i = 0; i < n; i++) {
      if (i % 256 === 255) yield;
      const s = i * ROAD_DS;
      let mask = arrival ? 0 : smooth(THREE.MathUtils.clamp((s - STRAIGHT_OUT) / 120, 0, 1)) * smooth(THREE.MathUtils.clamp((SB - sIn - s) / 120, 0, 1));
      for (const p of this.pieces) {
        if (p.kind === "billboards" || p.kind === "leave" || p.kind === "distance" || p.kind === "welcome" || (short && p.kind === "fwsign")) continue;
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
    yield;
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
    const U = new Float64Array(n), grounds = this.pieces.map((p) => this.groundOf(p));
    let u = 0;
    for (let i = 0; i < n; i++) {
      if (i % 128 === 127) yield;
      const s = i * ROAD_DS;
      let m = arrival ? 0 : smooth(THREE.MathUtils.clamp((s - STRAIGHT_OUT) / HILL_EASE, 0, 1)) * smooth(THREE.MathUtils.clamp((SB - (inp.toFreeway ? FW_FLAT_IN : STRAIGHT_IN) - s) / HILL_EASE, 0, 1));
      for (const [g0, g1] of grounds) {
        const d = Math.max(g0 - HILL_FLAT - s, s - (g1 + HILL_FLAT), 0);
        m = Math.min(m, smooth(Math.min(1, d / HILL_EASE)));
      }
      if (this.nearFreeways) { this.center(s, this.tmpF); m = Math.min(m, smooth(Math.min(1, Math.max(0, this.fwDist(this.tmpF.x, this.tmpF.z) - 40) / HILL_EASE))); }
      let pm = 1;
      for (const [g0, g1] of grounds) pm = Math.min(pm, smooth(Math.min(1, Math.max(g0 - HILL_FLAT - s, s - (g1 + HILL_FLAT), 0) / HILL_EASE)));
      U[i] = u; this.SM[i] = m; this.PM[i] = pm; u += m * ROAD_DS;
    }
    const Ut = u, hilly = 0.45 + 0.75 * h(86);
    if (Ut > 500) {
      const k1 = Math.max(1, Math.round(Ut / (1000 + 900 * h(87)))), k2 = Math.max(2, Math.round(Ut / (330 + 260 * h(88))));
      const A1 = 16 * hilly, A2 = (4 + 4 * h(89)) * hilly;
      const a0 = HILLS[this.fromBiome], a1 = HILLS[this.toBiome];
      let steep = 0;
      yield;
      for (let i = 0; i < n; i++) {
        const w = U[i] / Ut, amp = a0 + (a1 - a0) * smooth(THREE.MathUtils.clamp((w - 0.35) / 0.3, 0, 1));
        this.Y[i] = amp * (A1 * (1 - Math.cos(2 * Math.PI * k1 * w)) / 2 + A2 * (1 - Math.cos(2 * Math.PI * k2 * w)) / 2);
        if (i > 0) steep = Math.max(steep, Math.abs(this.Y[i] - this.Y[i - 1]) / ROAD_DS);
      }
      if (steep > MAX_GRADE) for (let i = 0; i < n; i++) this.Y[i] *= MAX_GRADE / steep;
      // Down to the cities' level wherever the road meets a freeway out in the country (it
      // passes under or beside it), coming down to it no steeper than the grade limit.
      if (this.nearFreeways) {
        const along = new Float64Array(n).fill(Infinity);
        for (let i = 0; i < n; i++) { this.center(i * ROAD_DS, this.tmpF); if (this.fwDist(this.tmpF.x, this.tmpF.z) < 45) along[i] = 0; }
        yield;
        const spread = () => {
          for (let i = 1; i < n; i++) along[i] = Math.min(along[i], along[i - 1] + ROAD_DS);
          for (let i = n - 2; i >= 0; i--) along[i] = Math.min(along[i], along[i + 1] + ROAD_DS);
        };
        spread();
        // (A set piece on the way down holds level: down at the bottom with the freeway.)
        for (let more = true; more;) {
          more = false;
          for (const [g0, g1] of grounds) {
            const i0 = Math.max(0, Math.floor((g0 - HILL_FLAT) / ROAD_DS)), i1 = Math.min(n - 1, Math.ceil((g1 + HILL_FLAT) / ROAD_DS));
            let lo = Infinity, hi = 0; for (let i = i0; i <= i1; i++) { lo = Math.min(lo, along[i]); hi = Math.max(hi, along[i]); }
            if (lo < 800 && hi > 0) { for (let i = i0; i <= i1; i++) along[i] = 0; more = true; }
          }
          if (more) spread();
        }
        for (let i = 0; i < n; i++) this.Y[i] = Math.min(this.Y[i], Math.max(0, along[i] - 10) * MAX_GRADE * 0.9);
      }
    }
    for (let i = 0; i < n; i++) {
      const s = i * ROAD_DS, b = this.blendAt(s);
      this.SM[i] *= hilly * (HILLS[this.fromBiome] + (HILLS[this.toBiome] - HILLS[this.fromBiome]) * b);
    }
    this.coastFrom = this.fromBiome === "coastal" ? 1 : 0; this.coastTo = this.toBiome === "coastal" ? 1 : 0;
    this.toSea = inp.toSea;
    this.toPort = this.toSea && inp.toStyle.id === "port";
    if (arrival) this.D = 0;
    else this.computeMeetings();
  }

  private setFerry(fs: number) {
    const F: FerryPlan = { s: fs, booth: fs + FERRY_BOOTH, q0: fs + FERRY_Q0, q1: fs + FERRY_Q0 + FERRY_W, board: 0, land: 0 };
    F.board = F.q0 + FERRY_BOARD; F.land = F.q1 - BOAT_L + FERRY_BOARD;
    this.ferry = F;
    this.pieces.push({ kind: "ferry", s: fs, side: 1, len: FERRY_LEN, variant: 0, text: `FERRY TO ${this.inp.toName.toUpperCase()}` });
    this.planStops.push({ s: F.booth, dwell: FERRY_DWELL[0], kind: "ferry" }, { s: F.board, dwell: FERRY_DWELL[1], kind: "ferry" }, { s: F.land, dwell: FERRY_DWELL[2], kind: "ferry" });
    this.planStops.sort((a, b) => a.s - b.s);
  }
  // Across the ferry's water (strictly between the quays).
  inChannel(s: number) { const F = this.ferry; return !!F && s > F.q0 && s < F.q1; }
  // The water's level there.
  get waterY() { return this.ferry ? this.baseAt(this.ferry.q0) - WATER_DROP : 0; }
  // The ferry boat's rear, with the truck at s.
  boatRear(s: number) { const F = this.ferry!; return THREE.MathUtils.clamp(s - FERRY_BOARD, F.q0 + BOAT_GAP, F.q1 - BOAT_L - BOAT_GAP); }
  // The truck is on the boat at drive time t.
  aboardAt(t: number) { const F = this.ferry; if (!F) return false; const s = this.sAt(t); return s > F.board - 0.3 && s < F.land + 0.3; }
  // Where the land steps sheer down (the land mesh puts a row either side): tunnels' portals and the ferry's quays.
  get cliffs(): number[] {
    const out: number[] = [];
    for (const p of this.pieces) if (p.kind === "tunnel") out.push(p.s, p.s + p.len);
    if (this.ferry) out.push(this.ferry.q0, this.ferry.q1);
    return out;
  }

  // How long the drive out takes, starting `s0` metres in at `v0`: `D` (as the road was laid for),
  // or longer, as long as it takes to reach the hand-over at cruising speed with all its stops (a
  // weigh station or a cattle crossing laid after the road's length: seed 500's road out of city 2
  // was 592 m short in its 222 s). The next city waits for it (journey.ts).
  fitDuration(D: number, v0: number, s0: number) {
    if (this.inp.kind === "arrival") return D;
    let d = D;
    for (let k = 0; k < 6; k++) {
      const m = this.simulate(this.planStops, COUNTRY_VMAX, d, v0, s0), short = this.SB - m.S[m.S.length - 1];
      if (short < 1) break;
      d = Math.ceil((d + short / COUNTRY_VMAX + 2) * 10) / 10;
    }
    return d;
  }
  // The drive as it actually goes: `D` seconds from the gate to the hand-over, starting `s0` metres
  // in at `v0`, ending exactly at SB at V_JOIN (the cruising speed is what gives).
  setMotion(D: number, v0: number, s0: number) {
    if (this.inp.kind === "arrival") return;
    const target = this.SB;
    const end = (m: { S: Float64Array }) => m.S[m.S.length - 1];
    // A short drive gets a brisker pull-away too.
    const acc = this.simulate(this.planStops, 32, D, v0, s0).S.at(-1)! < target ? 1.7 : COUNTRY_ACCEL;
    let best = this.simulate(this.planStops, COUNTRY_VMAX, D, v0, s0, acc);
    if (Math.abs(end(best) - target) > 0.01) {
      // The cruising speed that ends the drive there: regula falsi (Illinois) between 6 and 34 m/s,
      // the distance growing with the speed (a handful of drives simulated, where halving took up
      // to 40, in one journey step). The distance can jump (a stop made or not), with the target in
      // the jump: then, once the speed is pinned down (halving every other time), the drive that
      // ended nearest. Out of reach either side: the nearer end. Whatever is left is eased in below.
      const mlo = this.simulate(this.planStops, 6, D, v0, s0, acc), mhi = this.simulate(this.planStops, 34, D, v0, s0, acc);
      let lo = 6, hi = 34, flo = end(mlo) - target, fhi = end(mhi) - target, side = 0;
      if (flo >= 0) best = mlo;
      else if (fhi <= 0) best = mhi;
      else {
        best = -flo < fhi ? mlo : mhi;
        let bf = Math.min(-flo, fhi);
        for (let it = 0; it < 40 && hi - lo > 1e-4; it++) {
          const v = it % 2 === 1 ? (lo + hi) / 2 : (lo * fhi - hi * flo) / (fhi - flo), m = this.simulate(this.planStops, v, D, v0, s0, acc), f = end(m) - target;
          if (Math.abs(f) < bf) { best = m; bf = Math.abs(f); }
          if (bf < 0.01) break;   // (as near as the first drive needs to be to keep: above)
          if (f < 0) { lo = v; flo = f; if (side === -1) fhi /= 2; side = -1; }
          else { hi = v; fhi = f; if (side === 1) flo /= 2; side = 1; }
        }
      }
    }
    // Whatever is left (a drive that can't quite make it): eased in over the drive, so it lands
    // exactly, still at V_JOIN.
    const e = end(best), n = best.S.length - 1;
    for (let i = 0; i <= n; i++) { const w = i / n; best.S[i] += (target - e) * smooth(w); best.V[i] += (target - e) * smoothD(w) / D; }
    this.S = best.S; this.V = best.V; this.D = D; this.stops = best.stops; this.tractorRun = best.tractor;
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
      if (this.ferry && s > this.ferry.s - 500 && s < this.ferry.s + FERRY_LEN + 500) continue;   // (they would drive into the water)
      if (this.pieces.some((p) => (p.kind === "cattle" || p.kind === "tractor") && s > p.s - 450 && s < p.s + p.len + 350)) continue;   // (the herd on the road; the lane to pass in)
      if (rail) {
        const cross = t + (s - rail.s) / ONCOMING_SPEED;
        if (cross > rail.arrive - 8 && cross < rail.arrive + rail.dwell + 2) continue;
      }
      this.meetings.push(t);
    }
  }

  // The truck's motion at 0.1 s steps from the gate: up to cruising speed, slowing for the work
  // zone, stopping for each stop, and settling to V_JOIN well before the hand-over.
  private simulate(stops: { s: number; dwell: number; kind: RoadStopKind }[], vmax: number, D: number, v0: number, s0: number, acc = COUNTRY_ACCEL) {
    const dt = SIM_DT, n = Math.max(1, Math.round(D / dt)) + 1;
    const S = new Float64Array(n), V = new Float32Array(n);
    let s = s0, v = v0, next = 0, dwell = -1;
    const out: CountryStop[] = [];
    const T = this.tractor, tr: TractorRun = { appear: -1, follow: -1, pass0: -1, pass1: -1 };
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
        // The ferry: creeping on past the booth and aboard, and off at the far quay; across the
        // water at the boat's pace, easing up to speed and down to the far quay.
        const F = this.ferry, aboard = !!F && s >= F.board - 1e-6 && s < F.land - 0.05;
        if (F && ((s > F.booth - 0.2 && s < F.board) || (s > F.land - 0.2 && s < F.q1 + 30))) target = Math.min(target, CREEP_V);
        if (aboard) target = Math.min(FERRY_V, Math.sqrt(2 * FERRY_ACC * Math.max(0, F!.land - s)));
        // The tractor: up behind it, matching its pace, then out and past it.
        if (T) {
          if (tr.appear < 0 && s >= T.s - 260) tr.appear = t;
          if (tr.appear >= 0 && tr.pass1 < 0) {
            const sT = this.tractorAxle(t, tr.appear);
            if (tr.pass0 < 0) {
              const gap = sT - TRACTOR_TAIL - (s + 7.5);
              target = Math.min(target, TRACTOR_V + Math.sqrt(2 * COUNTRY_BRAKE * 0.8 * Math.max(0, gap - 16)));
              if (gap < 22 && tr.follow < 0) tr.follow = t;
              if (tr.follow >= 0 && t - tr.follow > 6) tr.pass0 = s;
            } else {
              target = Math.min(target, 19);
              if (s > sT + TRACTOR_FRONT + 11) tr.pass1 = s;
            }
          }
        }
        if (next < stops.length) {
          const d = stops[next].s - s;
          target = Math.min(target, Math.max(d > 0.15 ? 0.6 : 0, Math.sqrt(2 * COUNTRY_BRAKE * Math.max(0, d))));
          if (d < 0.15 && v < 0.7) { s = stops[next].s; v = 0; dwell = 0; out.push({ ...stops[next], arrive: t }); }
        }
        if (dwell < 0) {
          const F = this.ferry, aboard = !!F && s >= F.board - 1e-6 && s < F.land - 0.05;
          v += aboard ? THREE.MathUtils.clamp(target - v, -FERRY_ACC * dt, FERRY_ACC * dt) : THREE.MathUtils.clamp(target - v, -2.6 * dt, acc * dt);
          s += v * dt;
        }
      }
      S[i] = s; V[i] = v;
    }
    return { S, V, stops: out, tractor: T ? tr : null };
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
  truckGrade(s: number, wb = 5) { return (this.truckY(s + wb) - this.truckY(s)) / wb; }   // (rear axle to front)
  // The freeway's frame, on a road into a freeway city (freeway.ts).
  private fwFrame: Frame | null = null;
  get freewayFrame(): Frame | null { if (!this.inp.toFreeway) return null; if (!this.fwFrame) this.fwFrame = Frame.ofRoad(this); return this.fwFrame; }
  // The freeway of the city a road leaves, if it has one (it runs out of town both ways).
  private fwFrom: Frame | null | undefined;
  get fromFreewayFrame(): Frame | null {
    if (this.fwFrom === undefined) {
      const i = this.inp, cs = citySeedOf(i.seed, i.city), g = i.kind === "exit" ? freewayGate(cs, i.fromStyle) : null;
      this.fwFrom = g ? Frame.ofCitySeed(cs, i.fromName, false, g, seaSide(cs, i.fromStyle) !== null, i.fromCurve !== undefined ? i.fromCurve : new CityPlan(cs, i.fromStyle).fwCurve) : null;   // (an organic town's curves: CityPlan.fwCurve)
    }
    return this.fwFrom;
  }
  // How far (x, z) is from the centre line of a freeway out in this road's land (either city's),
  // up to about FW_CELL (Infinity beyond): the land stays down under the freeways and the road
  // level near them (they stand on bents over level ground).
  private fwGrid: Map<number, number[]> | null = null;
  private fwIndex() {
    if (this.fwGrid) return this.fwGrid;
    const grid = this.fwGrid = new Map<number, number[]>();
    for (const F of [this.fromFreewayFrame, this.freewayFrame]) if (F) {
      const p = F.centreLine(8);
      for (let i = 0; i < p.length; i += 2) {
        const k = fwCell(Math.floor(p[i] / FW_CELL), Math.floor(p[i + 1] / FW_CELL));
        let a = grid.get(k); if (!a) grid.set(k, a = []);
        a.push(p[i], p[i + 1]);
      }
    }
    return grid;
  }
  get nearFreeways() { return this.fwIndex().size > 0; }
  fwDist(x: number, z: number) {
    const g = this.fwIndex();
    if (!g.size) return Infinity;
    const cx = Math.floor(x / FW_CELL), cz = Math.floor(z / FW_CELL);
    let best = Infinity;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = g.get(fwCell(cx + i, cz + j));
      if (a) for (let k = 0; k < a.length; k += 2) { const d = (a[k] - x) ** 2 + (a[k + 1] - z) ** 2; if (d < best) best = d; }
    }
    return best < FW_CELL * FW_CELL ? Math.sqrt(best) : Infinity;
  }
  private tmpF: Pose = { x: 0, z: 0, h: 0, k: 0 };
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
    if (this.ferry && s1 > this.ferry.q0 && s0 < this.ferry.q1) lo = Math.min(lo, this.waterY - 1);
    return lo - 1;
  }
  // How much of the land at s is coast (the sea on the left), easing from one land to the next.
  private coastFrom = 0; private coastTo = 0;
  private toSea = false; private toPort = false;   // (into a town on the sea; a port)
  // (Fading out over the first COAST_FADE metres out of a city's gate: a coastal city has its own
  // sea, on its own side (outline.ts), and its outskirts' land comes up to the road there. Into a
  // town on the sea, on to its gate: the town's shore bends in to meet it there, its sea on the left
  // of the way in as the coast is (outline.ts); and a port's road, through wetlands, comes out to
  // the coast for its last stretch. Into one not on the sea, fading out over the last COAST_FADE.)
  coastAt(s: number) {
    let land = this.coastFrom + (this.coastTo - this.coastFrom) * this.blendAt(s);
    if (this.toPort) land = Math.max(land, smooth(THREE.MathUtils.clamp((s - (this.gateS - 1400)) / 400, 0, 1)));
    const f = Math.min(this.inp.kind === "exit" ? s / COAST_FADE : 1, this.toSea ? 1 : (this.gateS - s) / COAST_FADE);
    return land * smooth(THREE.MathUtils.clamp(f, 0, 1));
  }
  // The height of the ground at (s, n): the road's level out to the ditches, then the land's own
  // hills (smooth noise, rising more often than falling), eased in over the first 40 m, so the
  // road runs in cuttings and on embankments. On a coast the land falls away to the beach on the
  // left, under the sea beyond it.
  groundAt(s: number, n: number) {
    if (this.inChannel(s)) return this.baseAt(s) - WATER_DROP - 2.4;   // the bed under the ferry's water
    const y = this.baseAt(s), sm = this.smAt(s), an = Math.abs(n);
    let g = y;
    if (sm > 0 && an > 11) {
      const seed = this.inp.seed + this.inp.city * 977;
      const noise = valueNoise(s / 95, n / 70, seed, 0x41) + 0.4 * valueNoise(s / 38, n / 30, seed, 0x42);
      g += sm * smooth(Math.min(1, (an - 11) / 40)) * SIDE_HILL * (noise * 0.75 + 0.2);
    }
    if (this.shapes.length) g = this.shaped(s, n, y, g);
    // Low under a freeway (its deck's over the cities' level), rising gently away from it.
    if (an > 11 && this.nearFreeways) {
      this.point(s, n, this.tmpF);
      const d = this.fwDist(this.tmpF.x, this.tmpF.z);
      if (d < FW_CELL) g = Math.min(g, 0.6 + Math.max(0, d - 14) * 0.35);
    }
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
    if (this.inChannel(s)) return this.waterY + 2.6;   // (over the water, clear of a boat's rails)
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
  laneAt(s: number) { return this.baseLane(s) + this.weighOffset(s) + this.passOffset(s); }
  // Out in the oncoming lane passing the tractor.
  private passOffset(s: number) {
    const r = this.tractorRun;
    if (!r || r.pass0 < 0 || s <= r.pass0) return 0;
    const w = -2 * LANE, up = smooth(THREE.MathUtils.clamp((s - r.pass0) / 40, 0, 1));
    return r.pass1 < 0 ? w * up : w * Math.min(up, 1 - smooth(THREE.MathUtils.clamp((s - r.pass1) / 45, 0, 1)));
  }
  // The tractor's rear axle along the road at drive time t (it pulls out at `appear`).
  private tractorAxle(t: number, appear: number) { return this.tractor!.s + TRACTOR_V * Math.max(0, t - appear - TRACTOR_PULL); }
  // Its pose at drive time u: in the field at its gate, pulling out round an arc onto the road,
  // along the road, turning off round an arc into the field further on. (s, n, heading relative to
  // the road's, speed.)
  tractorPose(u: number, out: { s: number; n: number; yaw: number; v: number; d: number }) {
    const T = this.tractor!, r = this.tractorRun, R = TRACTOR_R, arc = Math.PI / 2 * R;
    const gate = (k: number, back: boolean) => {   // k in [0, 1] round the arc
      const a = k * Math.PI / 2;
      if (!back) { out.s = T.s - R * Math.cos(a); out.n = LANE + R - R * Math.sin(a); out.yaw = Math.PI / 2 - a; }
      else { out.s = T.s + TRACTOR_B + R * Math.sin(a); out.n = LANE + R - R * Math.cos(a); out.yaw = -a; }
    };
    if (!r || r.appear < 0 || u < r.appear) { gate(0, false); out.v = 0; out.d = 0; return out; }
    const tu = u - r.appear;
    if (tu < TRACTOR_PULL) { const k = smooth(tu / TRACTOR_PULL); gate(k, false); out.v = arc / TRACTOR_PULL; out.d = arc * k; return out; }
    const d = TRACTOR_V * (tu - TRACTOR_PULL);
    if (d < TRACTOR_B) { out.s = T.s + d; out.n = LANE; out.yaw = 0; out.v = TRACTOR_V; out.d = arc + d; return out; }
    const k = (d - TRACTOR_B) / arc;
    if (k < 1) { gate(k, true); out.v = TRACTOR_V; out.d = arc + d; return out; }
    gate(1, true); out.v = 0; out.d = 2 * arc + TRACTOR_B; return out;
  }
  // The herd's paths and paces (a pure function of the seed and the crossing).
  private herdM: HerdMember[] | null = null;
  herd(): HerdMember[] {
    if (this.herdM) return this.herdM;
    const c = this.cattle!, A = c.sideA, B = -A, hh = (i: number, k: number) => hash3(i, k, Math.floor(c.cross), this.inp.seed, 0xc0e5);
    const breed = Math.floor(hh(99, 0) * 3), out: HerdMember[] = [];
    let gate = 0;
    for (let i = 0; i <= c.n; i++) {
      const rider = i === c.n;
      // Through the gate one or two at a time (6.4 m wide), out over the road (two lanes), and in.
      const P0 = rider ? [c.cross + 10, A * 54] : [c.cross + (hh(i, 1) - 0.5) * 18, A * (24 + hh(i, 2) * 26)];
      const P1 = [c.cross + (rider ? 0.5 : (hh(i, 3) - 0.5) * 4.4), A * COW_GATE];
      const P2 = [c.cross + (rider ? 0 : (hh(i, 4) - 0.5) * 6.5), -A * 0.5 + (hh(i, 9) - 0.5) * 3];
      const P3 = [c.cross + (rider ? 0.5 : (hh(i, 10) - 0.5) * 4.4), B * COW_GATE];
      const P4 = rider ? [c.cross + 3.5, B * (COW_GATE + 4)] : [c.cross + (hh(i, 5) - 0.5) * 16, B * (22 + hh(i, 6) * 16)];
      const pts = [...P0, ...P1, ...P2, ...P3, ...P4], cum = [0];
      for (let k = 2; k < pts.length; k += 2) cum.push(cum[cum.length - 1] + Math.hypot(pts[k] - pts[k - 2], pts[k + 1] - pts[k - 1]));
      gate += i === 0 ? 0 : rider ? 3 : 0.35 + hh(i, 11) * 2.3;
      const m: HerdMember = { pts, cum, leave: 0, vf: rider ? 1 : 0.85 + hh(i, 12) * 0.3, amp: rider ? 0.2 : 0.4 + hh(i, 13) * 0.5, w: 0.5 + hh(i, 14) * 0.6, ph: hh(i, 15) * 6.3,
        rider, coat: hh(i, 7) < 0.8 ? breed : Math.floor(hh(i, 8) * 3) };
      m.leave = gate - herdTime(m, cum[1]);
      out.push(m);
    }
    return (this.herdM = out);
  }
  // Herd time 0 (as drive time), or null before the motion is known.
  get herdT0(): number | null { const st = this.stops.find((x) => x.kind === "cattle"); return st ? st.arrive - CATTLE_LEAD : null; }
  private weighP: RoadPiece | null | undefined;
  private weighOffset(s: number) {
    if (this.weighP === undefined) this.weighP = this.pieces.find((p) => p.kind === "weigh" && p.open) ?? null;
    const p = this.weighP;
    if (!p) return 0;
    const d = s - p.s, w = WEIGH_N - LANE;
    if (d <= WEIGH_OUT[0] || d >= WEIGH_BACK[1]) return 0;
    if (d < WEIGH_OUT[1]) return w * smooth((d - WEIGH_OUT[0]) / (WEIGH_OUT[1] - WEIGH_OUT[0]));
    if (d > WEIGH_BACK[0]) return w * (1 - smooth((d - WEIGH_BACK[0]) / (WEIGH_BACK[1] - WEIGH_BACK[0])));
    return w;
  }
  private baseLane(s: number) {
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
  //   A drive into or out of the storybook city changes slowly instead: from soon after the
  // last city's edge to the arrival straight (storyAt), the land taking on more and more of the
  // storybook's, its trees and colours creeping into the real land as well (countryworld.ts).
  blendAt(s: number) {
    if (this.inp.kind === "arrival") return 1;
    if (this.toBiome === "storybook" && this.fromBiome !== "storybook") return this.storyAt(s);
    if (this.fromBiome === "storybook" && this.toBiome !== "storybook") return 1 - this.storyAt(s);
    const SB = this.SB, b0 = Math.max(LAND_SEAM + 400, SB * 0.5 - 350), b1 = Math.max(b0 + 200, Math.min(SB - 350, SB * 0.5 + 350));
    return smooth(THREE.MathUtils.clamp((s - b0) / (b1 - b0), 0, 1));
  }
  // How much of the storybook there is at s (0..1): none on a drive that has nothing to do with
  // it, all of it in its own town's land; between, it grows from soon after one city's edge to
  // the other's arrival straight, slowly at first (a tinted tree or two) and fastest near the
  // end. Out of the storybook city, the same backwards.
  storyAt(s: number) {
    const to = this.toBiome === "storybook", from = this.fromBiome === "storybook";
    if (to === from || this.inp.kind === "arrival") return to ? 1 : 0;
    const b0 = LAND_SEAM + 200, b1 = Math.max(b0 + 400, this.SB - 350);
    const k = THREE.MathUtils.clamp((to ? s - b0 : b1 - s) / (b1 - b0), 0, 1);
    return k * k * (1.6 - 0.6 * k);   // (eased in: k², softened so the last stretch isn't sudden)
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
      const stop = this.stops.find((x) => x.kind === p.kind);
      const isSign = p.kind === "leave" || p.kind === "distance" || p.kind === "welcome";
      if (!stop && !isSign && hash2(i, Math.floor(p.s), this.inp.seed, 0x5a0) > 0.7) continue;
      const F: Record<PieceKind, [number, number, number]> = {
        leave: [0, 11, 5], distance: [0, 11, 5], welcome: [0, p.n ?? 11, 5], truckstop: [stop ? SWAP_AHEAD / 2 : 70, stop ? APRON : 45, 2],
        rail: [0, 0, 2.5], construction: [p.len / 2, 10, 1.5], billboards: [140, -22, 8], attraction: [50, p.side * 40, 7],
        weigh: [100, 22, 2], fruit: [40, p.side * 13, 2], watertower: [45, p.side * 32, 14], bridge: [60, 0, 4], gas: [40, p.side * (FORECOURT + 6), 3],
        tunnel: [0, 0, 4], overpass: [p.len / 2, 0, 2], fwsign: [0, p.n ?? 0, 4], ferry: [0, 0, 0], cattle: [0, 0, 0], tractor: [0, 0, 0],
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
      // The ferry: from out along the near quay, the truck creeping onto the boat (from just
      // short of the quay, so the truck is in the shot at once); across the water, from out on it to the side, the boat crossing the frame; at
      // the far quay, from beyond it, the boat coming in and the truck driving off towards the
      // camera. (Heights over the ground there, which is the bed under the water.)
      if (p.kind === "ferry" && this.ferry) {
        const Fp = this.ferry, mid = (Fp.q0 + Fp.q1) / 2, dw = WATER_DROP + 2.4;
        if (s >= Fp.q0 - 32 && s <= Fp.board + 8) return { key: i, cam: [Fp.q0 - 2, 24, 4.5], look: [Fp.q0 + 6, 1.5, 1.5 + dw], fixed: true };
        if (s >= mid - 130 && s <= mid + 40) return { key: i, cam: [mid + 10, 48, 4 + dw], look: [mid - 30, 0, 2 + dw], fixed: true };
        if (s >= Fp.land - 70 && s <= Fp.q1 + 30) return { key: i, cam: [Fp.q1 + 22, -8, 3.6], look: [Fp.q1 - 25, 1.5, 1.6 + dw], fixed: true };
        continue;
      }
      // The cattle crossing: from the shoulder beyond it, low, the herd crossing between the
      // camera and the truck waiting for it.
      if (p.kind === "cattle" && stop && this.cattle) {
        const c = this.cattle;
        if (s < c.cross - 170 || s > c.cross + 6) continue;
        return { key: i, cam: [c.cross + 6, c.sideA * 7.2, 1.6], look: [c.cross - 3, -c.sideA * 4, 1.0], fixed: true };
      }
      // The tractor: from the right shoulder ahead, the truck coming up behind it, pulling out
      // and going past it (and the camera).
      if (p.kind === "tractor") {
        const r = this.tractorRun;
        if (!r || r.pass0 < 0 || s < r.pass0 - 100 || s > r.pass0 + 60) continue;
        return { key: i, cam: [r.pass0 + 58, 9.5, 2.6], look: [r.pass0 + 4, LANE, 1.5], fixed: true };
      }
      // An open weigh station: from the far shoulder short of the scale, locked off on the truck
      // on it and the signal past it, so the shot sees it pull on, the light go green and it leave.
      if (p.kind === "weigh" && stop) {
        if (s < p.s + 64 || s > p.s + 125) continue;
        return { key: i, cam: [p.s + 80, -6.5, 3.0], look: [p.s + 106, WEIGH_N + 1.5, 2.0], fixed: true };
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
  // A piece's ground (pieceGround), once.
  private grounds = new WeakMap<RoadPiece, [number, number]>();
  groundOf(p: RoadPiece) { let g = this.grounds.get(p); if (!g) this.grounds.set(p, g = pieceGround(p)); return g; }
  // Is (s, n) clear of the road furniture and set pieces (for scenery)?
  clearAt(s: number, n: number) {
    if (Math.abs(n) < 11) return false;
    if (this.ferry && s > this.ferry.q0 - 4 && s < this.ferry.q1 + 4) return false;
    if (this.inp.toFreeway) { this.point(s, n, this.tmpQ); if (this.freewayFrame!.corridor(this.tmpQ.x, this.tmpQ.z)) return false; }   // under the freeway and its on-ramp
    if (this.fromFreewayFrame) { this.point(s, n, this.tmpQ); if (this.fwDist(this.tmpQ.x, this.tmpQ.z) < 11.5) return false; }   // (and the city's it leaves)
    for (const p of this.pieces) {
      const [g0, g1] = this.groundOf(p);
      if (s < g0 - 40 || s > g1 + 40) continue;
      if (p.kind === "rail" || p.kind === "bridge") return false;
      if (p.kind === "tunnel" || p.kind === "overpass") { if (Math.abs(n) < (p.kind === "tunnel" ? 18 : 80)) return false; continue; }
      if (Math.sign(n) === p.side && Math.abs(n) < 75) return false;
      if (Math.abs(n) < 30 && s > p.s - 20) return false;   // room for a roadside camera
    }
    return true;
  }
}

const FW_CELL = 140;
const fwCell = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

// Smooth value noise in [-1, 1] on a unit grid (smoothstep between hashed corners).
function valueNoise(x: number, y: number, seed: number, salt: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const v = (a: number, b: number) => hash2(ix + a, iy + b, seed, salt) * 2 - 1;
  const top = v(0, 0) + (v(1, 0) - v(0, 0)) * sx, bot = v(0, 1) + (v(1, 1) - v(0, 1)) * sx;
  return top + (bot - top) * sy;
}
