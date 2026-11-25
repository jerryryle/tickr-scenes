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
import { cityHeadOf } from "./visits.ts";
import type { RoadMap, RoadMapPiece } from "./roadmap.ts";
import type { WorldRoad } from "./world.ts";
import type { Steps } from "./slices.ts";
type Writable<T> = { -readonly [K in keyof T]: T[K] };

export type BiomeId = "coastal" | "forest" | "desert" | "farmland" | "prairie" | "wetlands" | "storybook";
export type PieceKind = "leave" | "distance" | "welcome" | "truckstop" | "rail" | "construction" | "billboards" | "attraction"
  | "weigh" | "fruit" | "watertower" | "bridge" | "gas" | "tunnel" | "overpass" | "fwsign" | "ferry" | "cattle" | "tractor";
export const PIECE_KINDS: PieceKind[] = ["leave", "distance", "welcome", "truckstop", "rail", "construction", "billboards", "attraction", "weigh", "fruit", "watertower", "bridge", "gas", "tunnel", "overpass", "fwsign", "ferry", "cattle", "tractor"];
export interface RoadPiece { kind: PieceKind; s: number; side: 1 | -1; len: number; variant: number; text?: string; back?: string; n?: number; open?: boolean }
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
export const FERRY_BOOTH = 30, FERRY_Q0 = 110, FERRY_W = 640, FERRY_OUT = 110, FERRY_LEN = FERRY_Q0 + FERRY_W + FERRY_OUT;
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

export const ROAD_DS = 2;               // geometry sample spacing (m)
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
// A world road's length to the hand-over into the city at its end (its map's, less the arrival straight).
export function roadMetres(r: WorldRoad) { return r.map.length - ARRIVE_LEN; }
// Within LAND_SEAM of either end the city's own countryside ring (city.ts) is the land; the road
// is straight there and well beyond, so the seam is a straight line across it.
export const LAND_SEAM = (RING - 1) * BLOCK;
export const STRAIGHT_OUT = LAND_SEAM + 120;   // straight out of town
export const STRAIGHT_IN = 150;                 // straight before the hand-over (and the arrival straight)
// Into a freeway city (freeway.ts) the road runs straight on for longer, beside the freeway, and
// the land is level for longer still, under it.
export const FW_STRAIGHT_IN = 560, FW_FLAT_IN = 760;
// The least road left between the straights to turn onto the next city's way in (m).
export const TURN_ROOM = 360;
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
export const MAX_GRADE = 0.055;
export const HILL_FLAT = 35, HILL_EASE = 90;   // set pieces sit on the level: this far either side, then eased over this
export const SIDE_HILL = 16;                   // the land beside the road rises or falls up to about this much (m)
export const COAST_N = -57, SEA_N = -75; // the beach (coastal land, on the left) and the sea beyond it
export const COAST_FADE = 500;                  // the coast fades out over this far to a city's gate (coastAt)
// A tunnel through a hill: its bore (half width, height inside), the cutting walls either side of
// its approaches, how far they run out, and the hill's height over the road at the portals.
export const BORE_HALF = 5.2, BORE_H = 6.6, CUT_N = 7.6, CUT_RUN = 80;
// An overpass: a cross road (or railway) on a bridge over the road, on embankments either side.
export const OVER_DECK = 6.6, OVER_HALF = 7, OVER_ABUT = 10.5;
export const tunnelTop = (p: RoadPiece) => 11 + 3 * p.variant;   // the hill over a tunnel's portals

export const BIOME_OF: Record<StyleId, BiomeId> = { coastal: "coastal", metro: "forest", desert: "desert", brick: "farmland", mainstreet: "prairie", port: "wetlands", storybook: "storybook" };

// City N's hash key: its catalogue city's (visits.ts), what every default rule about the city hashes.
export function citySeedOf(seed: number, N: number) { return cityHeadOf(seed, N).key; }

// Padding: a map's samples run from ROAD_PAD before gate a to ROAD_PAD past its far end.
export const ROAD_PAD = 40;
export const LAND_DS = 10;   // the map's land samples (blend, story, coast) every this far
export const SEA_SIDE_LEFT = -1;

// A view of a road's geometry: positions, heights and land at (s, n). RoadGeo is the road in its
// map's coordinates; a MirrorView turns another view half round about a point along it (s to 2c - s,
// n to -n), which is the road driven the other way when c is half its length, or one piece's other
// face (countryworld.ts).
export interface RoadView {
  readonly length: number;
  center(s: number, out: Pose): Pose;
  point(s: number, n: number, out: Pose): Pose;
  baseAt(s: number): number;
  heightAt(s: number): number;
  gradeAt(s: number): number;
  groundAt(s: number, n: number): number;
  floorAt(s: number, n: number): number;
  tunnelAt(s: number, margin?: number): RoadPiece | null;
  coastAt(s: number): number;
  storyAt(s: number): number;
  biomeAt(s: number, n?: number): BiomeId;
  climateAt(s: number, n?: number): Climate;
  clearAt(s: number, n: number): boolean;
  widthAt(s: number): number;
  lowBetween(s0: number, s1: number): number;
  locate(x: number, z: number, near: number, range?: number): { s: number; n: number };
}

// The road in its map's coordinates, placed in the world: what is drawn, the same whichever way
// the road is driven. (Its climates and its freeways' places are the drive's: CountryRoad sets them.)
export class RoadGeo implements RoadView {
  readonly key: number; readonly length: number; readonly map: RoadMap;
  readonly pieces: RoadMapPiece[];
  readonly bioA: BiomeId; readonly bioB: BiomeId;
  climA!: Climate; climB!: Climate;
  readonly landFrom: number; readonly landTo: number;
  readonly ferry: FerryPlan | null = null;    // the ferry's terminals and water, in map coordinates
  readonly shapes: RoadPiece[];               // tunnels and overpasses (the land they shape)
  private X: Float64Array; private Z: Float64Array; private H: Float64Array;
  private Y: Float64Array; private SM: Float64Array; private PM: Float64Array;
  private blend: Float32Array; private story: Float32Array | null; private coast: Float32Array | null;
  readonly coastSide: 1 | -1;
  // The world placement: local (x, z) turned by th, then moved by (tx, tz).
  private tc = 1; private ts = 0; private th = 0; private tx = 0; private tz = 0;
  // Freeways out in this road's land (either city's, and the one it comes up beside), and the corridor
  // under the one it comes up beside: set by the drive.
  fwPoints: number[][] = []; corridor: ((x: number, z: number) => boolean) | null = null;
  constructor(map: RoadMap) {
    this.map = map; this.key = map.key; this.length = map.length;
    this.pieces = map.pieces;
    this.bioA = map.biomes[0] as BiomeId; this.bioB = map.biomes[1] as BiomeId;
    this.landFrom = LAND_SEAM; this.landTo = map.length - LAND_SEAM;
    const n = map.heading.length;
    this.X = new Float64Array(n); this.Z = new Float64Array(n); this.H = Float64Array.from(map.heading);
    this.Y = new Float64Array(n); this.SM = Float64Array.from(map.hill); this.PM = new Float64Array(n);
    // (The centre line from its headings, gate a's street end at the origin.)
    const i0 = ROAD_PAD / ROAD_DS;
    for (let i = i0 + 1; i < n; i++) { this.X[i] = this.X[i - 1] + Math.cos(this.H[i]) * ROAD_DS; this.Z[i] = this.Z[i - 1] - Math.sin(this.H[i]) * ROAD_DS; }
    for (let i = i0 - 1; i >= 0; i--) { this.X[i] = this.X[i + 1] - Math.cos(this.H[i + 1]) * ROAD_DS; this.Z[i] = this.Z[i + 1] + Math.sin(this.H[i + 1]) * ROAD_DS; }
    for (let i = 0; i < n; i++) this.Y[i] = map.height[i] / 100;
    this.blend = Float32Array.from(map.blend);
    this.story = map.story ? Float32Array.from(map.story) : null;
    this.coast = map.coast ? Float32Array.from(map.coast) : null;
    this.coastSide = map.coastSide ?? -1;
    this.shapes = this.pieces.filter((p) => p.kind === "tunnel" || p.kind === "overpass").map((p) => this.inMap(p));
    const fp = this.pieces.find((p) => p.kind === "ferry");
    if (fp) { const s = fp.way === 1 ? fp.s : this.length - fp.s - fp.len; this.ferry = ferryPlan(s); }
    // (Level round each piece: 0 at it, 1 clear of it.)
    const grounds = this.pieces.map((p) => this.groundOf(p));
    for (let i = 0; i < n; i++) {
      const s = i * ROAD_DS - ROAD_PAD;
      let pm = 1;
      for (const [g0, g1] of grounds) pm = Math.min(pm, smooth(Math.min(1, Math.max(g0 - HILL_FLAT - s, s - (g1 + HILL_FLAT), 0) / HILL_EASE)));
      this.PM[i] = pm;
    }
  }
  // Where the road is: its drive's pose at map distance `s` (heading `h` there) is (x, z, h).
  place(s: number, x: number, z: number, h: number) {
    const f = this.f(s), i = Math.floor(f), u = f - i;
    const lx = this.X[i] + (this.X[i + 1] - this.X[i]) * u, lz = this.Z[i] + (this.Z[i + 1] - this.Z[i]) * u, lh = this.H[i] + (this.H[i + 1] - this.H[i]) * u;
    this.th = h - lh; this.tc = Math.cos(this.th); this.ts = Math.sin(this.th);
    this.tx = x - (lx * this.tc + lz * this.ts); this.tz = z - (-lx * this.ts + lz * this.tc);
  }
  // A piece in map coordinates (one facing b to a turned half round): for its ground and shape.
  inMap(p: RoadMapPiece): RoadPiece { return p.way === 1 ? p : { ...p, s: this.length - p.s - p.len, side: -p.side as 1 | -1, n: p.n === undefined ? undefined : -p.n }; }
  private f(s: number) { return THREE.MathUtils.clamp((s + ROAD_PAD) / ROAD_DS, 0, this.X.length - 1.001); }
  private at(A: Float64Array, s: number) { const f = this.f(s), i = Math.floor(f); return A[i] + (A[i + 1] - A[i]) * (f - i); }
  private land(A: Float32Array | null, s: number) {
    if (!A) return 0;
    const f = THREE.MathUtils.clamp(s / LAND_DS, 0, A.length - 1.001), i = Math.floor(f);
    return A[i] + (A[i + 1] - A[i]) * (f - i);
  }
  get samples() { return this.X.length; }
  center(s: number, out: Pose): Pose {
    const f = this.f(s), i = Math.floor(f), u = f - i;
    const lx = this.X[i] + (this.X[i + 1] - this.X[i]) * u, lz = this.Z[i] + (this.Z[i + 1] - this.Z[i]) * u;
    out.x = this.tx + lx * this.tc + lz * this.ts;
    out.z = this.tz - lx * this.ts + lz * this.tc;
    out.h = this.th + this.H[i] + (this.H[i + 1] - this.H[i]) * u;
    out.k = (this.H[i + 1] - this.H[i]) / ROAD_DS;
    return out;
  }
  point(s: number, n: number, out: Pose): Pose {
    this.center(s, out);
    out.x += Math.sin(out.h) * n; out.z += Math.cos(out.h) * n;
    return out;
  }
  heightAt(s: number) { return this.baseAt(s); }
  baseAt(s: number) { return this.at(this.Y, s); }
  gradeAt(s: number) { return (this.baseAt(s + 3) - this.baseAt(s - 3)) / 6; }
  private smAt(s: number) { return this.at(this.SM, s); }
  pmAt(s: number) { return this.at(this.PM, s); }
  // The freeways' centre lines, a grid of them by cell.
  private fwGrid: Map<number, number[]> | null = null;
  private fwIndex() {
    if (this.fwGrid) return this.fwGrid;
    const grid = this.fwGrid = new Map<number, number[]>();
    for (const p of this.fwPoints) for (let i = 0; i < p.length; i += 2) {
      const k = fwCell(Math.floor(p[i] / FW_CELL), Math.floor(p[i + 1] / FW_CELL));
      let a = grid.get(k); if (!a) grid.set(k, a = []);
      a.push(p[i], p[i + 1]);
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
  lowBetween(s0: number, s1: number) {
    let lo = 0;
    const i0 = Math.max(0, Math.floor(this.f(s0))), i1 = Math.min(this.Y.length - 1, Math.ceil(this.f(s1)));
    for (let i = i0; i <= i1; i += 4) lo = Math.min(lo, this.Y[i] - SIDE_HILL * 0.9 * this.SM[i]);
    if (this.ferry && s1 > this.ferry.q0 && s0 < this.ferry.q1) lo = Math.min(lo, this.waterY - 1);
    return lo - 1;
  }
  // How much of the land at s is coast (its sea on side coastSide); of b's land; of the storybook's.
  coastAt(s: number) { return this.land(this.coast, s); }
  blendAt(s: number) { return this.land(this.blend, s); }
  storyAt(s: number) { return this.land(this.story, s); }
  isA(s: number, n = 0) { return hash2(Math.floor(s / 12), Math.floor(n / 12), this.key, 0xb10) >= this.blendAt(s); }
  biomeAt(s: number, n = 0): BiomeId { return this.isA(s, n) ? this.bioA : this.bioB; }
  climateAt(s: number, n = 0): Climate { return this.isA(s, n) ? this.climA : this.climB; }
  // The ground at (s, n) (country.ts's old groundAt: the road's level out to the ditches, the land's
  // own hills, the shapes of tunnels and overpasses, low under a freeway, and the coast).
  groundAt(s: number, n: number) {
    if (this.inChannel(s)) return this.baseAt(s) - WATER_DROP - 2.4;   // the bed under the ferry's water
    const y = this.baseAt(s), sm = this.smAt(s), an = Math.abs(n);
    let g = y;
    if (sm > 0 && an > 11) {
      const noise = valueNoise(s / 95, n / 70, this.key, 0x41) + 0.4 * valueNoise(s / 38, n / 30, this.key, 0x42);
      g += sm * smooth(Math.min(1, (an - 11) / 40)) * SIDE_HILL * (noise * 0.75 + 0.2);
    }
    if (this.shapes.length) g = this.shaped(s, n, y, g);
    if (an > 11 && this.nearFreeways) {
      this.point(s, n, this.tmpF);
      const d = this.fwDist(this.tmpF.x, this.tmpF.z);
      if (d < FW_CELL) g = Math.min(g, 0.6 + Math.max(0, d - 14) * 0.35);
    }
    // (The coast's offsets as on its left: COAST_N and SEA_N are negative.)
    const nn = this.coastSide < 0 ? n : -n;
    const c = nn < -11 ? this.coastAt(s) : 0;
    if (c > 0) {
      const n0 = -11 + (COAST_N + 4 + 11) * (1 - this.pmAt(s));
      const shore = nn > n0 ? y : nn > COAST_N ? y * (1 - smooth((n0 - nn) / (n0 - COAST_N))) : nn > SEA_N ? 0 : -1;
      g += (shore - g) * c;
    }
    return g;
  }
  locate(x: number, z: number, near: number, range = 400): { s: number; n: number } {
    const q = this.tmpQ;
    let best = near, bd = Infinity;
    const s0 = Math.max(-ROAD_PAD, near - range), s1 = Math.min(this.length + ROAD_PAD, near + range);
    for (let s = s0; s <= s1; s += 8) { this.center(s, q); const d = (q.x - x) ** 2 + (q.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    for (let step = 4; step > 0.2; step /= 2) {
      for (const s of [best - step, best + step]) { this.center(s, q); const d = (q.x - x) ** 2 + (q.z - z) ** 2; if (d < bd) { bd = d; best = s; } }
    }
    this.center(best, q);
    return { s: best, n: (x - q.x) * Math.sin(q.h) + (z - q.z) * Math.cos(q.h) };
  }
  private tmpQ: Pose = { x: 0, z: 0, h: 0, k: 0 };
  tunnelAt(s: number, margin = 0): RoadPiece | null {
    for (const p of this.shapes) if (p.kind === "tunnel" && s > p.s - margin && s < p.s + p.len + margin) return p;
    return null;
  }
  floorAt(s: number, n: number) {
    if (this.inChannel(s)) return this.waterY + 2.6;
    return this.tunnelAt(s) && Math.abs(n) < BORE_HALF ? this.heightAt(s) : this.groundAt(s, n);
  }
  private shaped(s: number, n: number, y: number, g: number) {
    const an = Math.abs(n);
    for (const p of this.shapes) {
      if (p.kind === "tunnel") {
        if (s < p.s - CUT_RUN || s > p.s + p.len + CUT_RUN) continue;
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
  inChannel(s: number) { const F = this.ferry; return !!F && s > F.q0 && s < F.q1; }
  get waterY() { return this.ferry ? this.baseAt(this.ferry.q0) - WATER_DROP : 0; }
  get cliffs(): number[] {
    const out: number[] = [];
    for (const p of this.shapes) if (p.kind === "tunnel") out.push(p.s, p.s + p.len);
    if (this.ferry) out.push(this.ferry.q0, this.ferry.q1);
    return out;
  }
  // How far the road has widened to a city street's width near a gate (1 at either gate).
  widthAt(s: number) { return Math.max(1 - smooth(THREE.MathUtils.clamp(s / 70, 0, 1)), smooth(THREE.MathUtils.clamp((s - (this.length - 70)) / 70, 0, 1))); }
  private grounds = new WeakMap<RoadPiece, [number, number]>();
  // A piece's ground in map coordinates.
  groundOf(p: RoadPiece) {
    let g = this.grounds.get(p);
    if (!g) { const q = (p as RoadMapPiece).way === -1 ? this.inMap(p as RoadMapPiece) : p; this.grounds.set(p, g = pieceGround(q)); }
    return g;
  }
  // Is (s, n) clear of the road furniture and set pieces (for scenery)?
  clearAt(s: number, n: number) {
    if (Math.abs(n) < 11) return false;
    if (this.ferry && s > this.ferry.q0 - 4 && s < this.ferry.q1 + 4) return false;
    if (this.corridor || this.nearFreeways) {
      this.point(s, n, this.tmpQ);
      if (this.corridor?.(this.tmpQ.x, this.tmpQ.z)) return false;   // under the freeway it comes up beside, and its on-ramp
      if (this.fwDist(this.tmpQ.x, this.tmpQ.z) < 11.5) return false;
    }
    for (const q of this.pieces) {
      const p = this.inMap(q), [g0, g1] = this.groundOf(q);
      if (s < g0 - 40 || s > g1 + 40) continue;
      if (p.kind === "rail" || p.kind === "bridge") return false;
      if (p.kind === "tunnel" || p.kind === "overpass") { if (Math.abs(n) < (p.kind === "tunnel" ? 18 : 80)) return false; continue; }
      if (Math.sign(n) === p.side && Math.abs(n) < 75) return false;
      if (Math.abs(n) < 30 && s > p.s - 20) return false;   // room for a roadside camera
    }
    return true;
  }
}

// A view turned half round about c along another (see RoadView).
export class MirrorView implements RoadView {
  constructor(readonly base: RoadView, readonly c: number) {}
  get length() { return this.base.length; }
  center(s: number, out: Pose): Pose { this.base.center(2 * this.c - s, out); out.h += Math.PI; out.k = -out.k; return out; }
  point(s: number, n: number, out: Pose): Pose { this.base.point(2 * this.c - s, -n, out); out.h += Math.PI; out.k = -out.k; return out; }
  baseAt(s: number) { return this.base.baseAt(2 * this.c - s); }
  heightAt(s: number) { return this.base.heightAt(2 * this.c - s); }
  gradeAt(s: number) { return -this.base.gradeAt(2 * this.c - s); }
  groundAt(s: number, n: number) { return this.base.groundAt(2 * this.c - s, -n); }
  floorAt(s: number, n: number) { return this.base.floorAt(2 * this.c - s, -n); }
  tunnelAt(s: number, margin = 0) { return this.base.tunnelAt(2 * this.c - s, margin); }
  coastAt(s: number) { return this.base.coastAt(2 * this.c - s); }
  storyAt(s: number) { return this.base.storyAt(2 * this.c - s); }
  biomeAt(s: number, n = 0) { return this.base.biomeAt(2 * this.c - s, -n); }
  climateAt(s: number, n = 0) { return this.base.climateAt(2 * this.c - s, -n); }
  clearAt(s: number, n: number) { return this.base.clearAt(2 * this.c - s, -n); }
  widthAt(s: number) { return this.base.widthAt(2 * this.c - s); }
  lowBetween(s0: number, s1: number) { return this.base.lowBetween(2 * this.c - s1, 2 * this.c - s0); }
  locate(x: number, z: number, near: number, range = 400) { const r = this.base.locate(x, z, 2 * this.c - near, range); return { s: 2 * this.c - r.s, n: -r.n }; }
}

// A ferry's plan from its piece's start s (its terminals are alike, so it reads the same from
// either end).
function ferryPlan(s: number): FerryPlan {
  const F: FerryPlan = { s, booth: s + FERRY_BOOTH, q0: s + FERRY_Q0, q1: s + FERRY_Q0 + FERRY_W, board: 0, land: 0 };
  F.board = F.q0 + FERRY_BOARD; F.land = F.q1 - BOAT_L + FERRY_BOARD;
  return F;
}

// Set pieces whose signs face both ways: drawn a second time turned half round about their middle
// (countryworld.ts), so a drive either way can read them.
export const TWO_WAY_SIGNS: ReadonlySet<PieceKind> = new Set<PieceKind>(["construction", "ferry", "cattle", "billboards"]);
// A piece as the drive has it: in its coordinates, and `away` when it faces the other way.
export type DrivePiece = RoadPiece & { away?: boolean; way: 1 | -1 };

// `exit`: the drive out of `city` from its gate (frame: the gate street's end, world) along its
// world road's map, from a to b or (`back`) from b to a, to the next city's gate. `arrival`: the
// same road's last stretch into `city`, ending at its gate (endFrame: the gate street's end, its
// heading into the city), for a seek into the start of a city's slot (the drive before it is the
// last city's).
interface CountryInput {
  seed: number; city: number; kind: "exit" | "arrival";
  map: RoadMap; back: boolean;
  driveSeed: number; // what this drive's events hash (oncoming cars, cattle, the weather on the way): its visit's (visits.ts)
  frame?: { x: number; z: number; h: number };
  endFrame?: { x: number; z: number; h: number };
  dEst: number;      // (the journey's plan for it: only in keys)
  fromTruck: TruckModel; toTruck: TruckModel;
  fromStyle: CityStyle; toStyle: CityStyle; fromName: string; toName: string;
  fromClimate: Climate; toClimate: Climate;
  toFreeway?: boolean;   // the next city has a freeway and this is its way in: the road comes up onto a flyover beside it
  toFreewayMerge?: boolean;   // and joins it, for a stretch (freeway.ts freewayMerge)
  fromCurve?: FwCurve | null;   // leaving a freeway city: its freeway's curve as the city was laid out (CityPlan.fwCurve)
  fromKey: number; toKey: number;   // the two cities' hash keys
  toGateEnd?: { x: number; z: number } | null;   // arriving in a freeway city by another gate: that gate's street end in the city's coordinates (its freeway's place, for the land)
  toCurve?: FwCurve | null;      // and its freeway's curve
}

export class CountryRoad {
  readonly key: string;
  readonly fromBiome: BiomeId; readonly toBiome: BiomeId;
  readonly geo: RoadGeo;
  readonly dir: 1 | -1;
  private v: RoadView;              // the road from this drive's end: geo, or geo turned half round
  readonly pieces: DrivePiece[] = [];
  stops: CountryStop[] = [];
  readonly length!: number;         // to the next city's gate street (on into town, along a freeway the truck takes)
  readonly gateS!: number;          // where the next city's gate street begins
  readonly SB!: number;             // where the next city takes over (the arrival straight begins)
  readonly swapU: number = -1;     // drive time of a truck change (none: trucks change in town)
  readonly swapS: number = 0;
  readonly landFrom!: number; readonly landTo!: number;   // the road's own land (the city rings' outside)
  private S: Float64Array = new Float64Array(1); private V: Float32Array = new Float32Array(1);   // per motion step, to the hand-over
  private zone: [number, number] | null = null;
  ferry: FerryPlan | null = null;   // this drive's ferry, if it has one (in its coordinates)
  ferryText = "";
  cattle: CattlePlan | null = null; tractor: { s: number } | null = null;
  tractorRun: TractorRun | null = null;   // (from the motion)
  weighOpen = false;                 // this drive's weigh station (one facing it) is open
  private planStops: { s: number; dwell: number; kind: RoadStopKind }[] = [];
  trainT = -1;                     // drive time the train front reaches the far side of the road, start
  meetings: number[] = [];         // drive times oncoming cars pass the truck
  private D = 0;                   // seconds to the hand-over
  get plannedSeconds() { return this.D; }   // (at cruising pace, before its stops, which fitDuration adds)
  private geoReady = false;        // the motion eases off for curves once the geometry is read
  private kAt(s: number) { this.v.center(s, this.tmpK); return Math.abs(this.tmpK.k); }
  private tmpK: Pose = { x: 0, z: 0, h: 0, k: 0 };

  constructor(readonly inp: CountryInput, ahead = false) {
    const { seed, city } = inp, M = inp.map;
    this.dir = inp.back ? -1 : 1;
    this.key = `${inp.kind}/${seed}/${city}/${M.id}/${this.dir}/${(inp.frame ?? inp.endFrame)!.x.toFixed(2)},${(inp.frame ?? inp.endFrame)!.z.toFixed(2)}`;
    const geo = this.geo = new RoadGeo(M);
    this.v = inp.back ? new MirrorView(geo, geo.length / 2) : geo;
    this.fromBiome = inp.back ? geo.bioB : geo.bioA; this.toBiome = inp.back ? geo.bioA : geo.bioB;
    geo.climA = inp.back ? inp.toClimate : inp.fromClimate; geo.climB = inp.back ? inp.fromClimate : inp.toClimate;
    // Placed in the world: its start at `frame`, or its gate end at `endFrame`.
    const L = geo.length;
    if (inp.frame) geo.place(inp.back ? L : 0, inp.frame.x, inp.frame.z, inp.frame.h + (inp.back ? Math.PI : 0));
    else geo.place(inp.back ? 0 : L, inp.endFrame!.x, inp.endFrame!.z, inp.endFrame!.h + (inp.back ? Math.PI : 0));
    this.job = this.build();
    if (!ahead) this.finish();
  }
  private job: Steps<void> | null;
  get built() { return !this.job; }
  prepare(pieces: number): boolean {
    for (let i = 0; i < pieces && this.job; i++) if (this.job.next().done) this.job = null;
    return !this.job;
  }
  finish() { if (this.job) { drain(this.job); this.job = null; } }
  // (Distances: a map distance's along this drive, and back.)
  ds(sMap: number) { return this.dir > 0 ? sMap : this.geo.length - sMap; }
  // A distance along piece p (in its own way's coordinates) as this drive has it.
  private dc(p: RoadMapPiece, s: number) { return p.way === this.dir ? s : this.geo.length - s; }
  private *build(): Steps<void> {
    const inp = this.inp, arrival = inp.kind === "arrival", self = this as Writable<CountryRoad>, geo = this.geo, L = geo.length;
    self.gateS = L; self.SB = L - ARRIVE_LEN;
    self.length = L + (inp.toFreewayMerge ? FW_OFF_D : 0);
    self.landFrom = LAND_SEAM; self.landTo = L - LAND_SEAM;
    // The freeways out in the land: the city's it leaves, the one it comes up beside, and the next
    // city's when it arrives by another gate. (Cities share the world's axes: a city's own
    // coordinates are the world's, moved to where its gate meets the road.)
    const fwPts: number[][] = [];
    if (this.fromFreewayFrame) fwPts.push(this.fromFreewayFrame.centreLine(8));
    if (inp.toGateEnd && !inp.toFreeway) {
      const cs = inp.toKey, g = freewayGate(cs);
      if (g) {
        const F = Frame.ofCitySeed(cs, inp.toName, false, g, seaSide(cs) !== null, inp.toCurve ?? null), e = inp.toGateEnd, end = this.v.center(L, this.tmpK);
        fwPts.push(F.centreLine(8).map((c, i) => c + (i % 2 ? end.z - e.z : end.x - e.x)));
      }
    }
    geo.fwPoints = fwPts;
    yield;
    if (inp.toFreeway) { const F = this.freewayFrame!; geo.corridor = (x, z) => F.corridor(x, z); geo.fwPoints = [...fwPts, F.centreLine(8)]; }
    // The drive's pieces: each in this drive's coordinates.
    for (const p of geo.pieces) {
      if (p.way === this.dir) this.pieces.push({ ...p });
      else this.pieces.push({ ...p, s: L - p.s - p.len, side: -p.side as 1 | -1, n: p.n === undefined ? undefined : -p.n, away: true, open: false });
    }
    this.pieces.sort((a, b) => a.s - b.s);
    this.geoReady = true;
    yield;
    if (arrival) { this.D = 0; return; }
    // What stops or slows the truck on this drive: a work zone, a rail crossing, a ferry, a
    // cattle crossing; a tractor to pass and a weigh station to cross only on a drive their way.
    for (const p of geo.pieces) {
      if (p.kind === "construction") { const a = this.dc(p, p.s + 60), b = this.dc(p, p.s + p.len - 80); this.zone = [Math.min(a, b), Math.max(a, b)]; }
      if (p.kind === "rail") this.planStops.push({ s: this.dc(p, p.s) - 16, dwell: RAIL_DWELL, kind: "rail" });   // the nose short of the gate
      if (p.kind === "ferry") {
        const F = this.ferry = ferryPlan(p.way === this.dir ? p.s : L - p.s - p.len);
        this.ferryText = p.way === this.dir ? p.text ?? "" : p.back ?? "";
        this.planStops.push({ s: F.booth, dwell: FERRY_DWELL[0], kind: "ferry" }, { s: F.board, dwell: FERRY_DWELL[1], kind: "ferry" }, { s: F.land, dwell: FERRY_DWELL[2], kind: "ferry" });
      }
      if (p.kind === "cattle") {
        const cross = this.dc(p, p.s + CATTLE_X), sideA = (p.way === this.dir ? -p.side : p.side) as 1 | -1;
        this.cattle = { s: cross - CATTLE_X, cross, sideA, n: p.variant };
      }
      if (p.kind === "tractor" && p.way === this.dir) this.tractor = { s: p.s + 260 };
    }
    // How long the drive takes at cruising pace with no stops, to the hand-over (its stops make it
    // longer: fitDuration).
    let dur = Math.max(20, this.SB / COUNTRY_VMAX);
    for (let k = 0; k < 4; k++) { dur = Math.max(20, dur * this.SB / this.simulate([], COUNTRY_VMAX, dur, 9, 0).S.at(-1)!); yield; }
    dur = Math.round(dur * 10) / 10;   // (whole steps, SIM_DT: the hand-over falls on one)
    this.D = dur;
    yield;
    if (this.cattle) {
      // (The truck waits till the last of them is off the road: |n| < 6, plus a moment.)
      let clear = 0;
      for (const m of this.herd()) clear = Math.max(clear, m.leave + herdTime(m, m.cum[1] + COW_GATE + 6));
      this.planStops.push({ s: this.cattle.cross - CATTLE_STOP, dwell: Math.max(4, clear - CATTLE_LEAD + 2), kind: "cattle" });
    }
    const weigh = this.pieces.find((p) => p.kind === "weigh" && !p.away);
    if (weigh && dur > 150 && hash3(0, 130, 0, inp.driveSeed, 0xc0a7) < 0.5) {
      weigh.open = true; this.weighOpen = true;
      this.planStops.push({ s: weigh.s + WEIGH_STOP, dwell: WEIGH_DWELL, kind: "weigh" });
    }
    this.planStops.sort((a, b) => a.s - b.s);
    yield;
    const m = this.simulate(this.planStops, COUNTRY_VMAX, dur, 9, 0);
    this.S = m.S; this.V = m.V; this.stops = m.stops; this.tractorRun = m.tractor;
    this.computeMeetings();
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
    const seed = this.inp.driveSeed, city = this.inp.city, h = (k: number) => hash3(city, k, 0, seed, 0xc0a7);
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
        if (this.geoReady) { const k = Math.max(this.kAt(s + 10), this.kAt(s + 35), this.kAt(s + 60)); if (k > 1e-5) target = Math.min(target, Math.max(V_JOIN, Math.sqrt(LAT_MAX / k))); }
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
    if (t > this.D || this.inp.kind === "arrival") return this.SB + this.arriveS(t - this.D);
    const f = THREE.MathUtils.clamp(t / SIM_DT, 0, this.S.length - 1), i = Math.floor(f), j = Math.min(i + 1, this.S.length - 1);
    return this.S[i] + (this.S[j] - this.S[i]) * (f - i);
  }
  vAt(t: number) { return t > this.D || this.inp.kind === "arrival" ? this.arriveV(t - this.D) : this.V[THREE.MathUtils.clamp(Math.round(t / SIM_DT), 0, this.V.length - 1)]; }
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


  // ---- the road from this drive's end (its geometry: RoadGeo, turned half round driving b to a) ----
  center(s: number, out: Pose): Pose { return this.v.center(s, out); }
  heightAt(s: number) { return this.v.heightAt(s); }
  baseAt(s: number) { return this.v.baseAt(s); }
  gradeAt(s: number) { return this.v.gradeAt(s); }
  groundAt(s: number, n: number) { return this.v.groundAt(s, n); }
  floorAt(s: number, n: number) { return this.v.floorAt(s, n); }
  tunnelAt(s: number, margin = 0) { return this.v.tunnelAt(s, margin); }
  coastAt(s: number) { return this.v.coastAt(s); }
  storyAt(s: number) { return this.v.storyAt(s); }
  biomeAt(s: number, n = 0): BiomeId { return this.v.biomeAt(s, n); }
  climateAt(s: number, n = 0): Climate { return this.v.climateAt(s, n); }
  clearAt(s: number, n: number) { return this.v.clearAt(s, n); }
  lowBetween(s0: number, s1: number) { return this.v.lowBetween(s0, s1); }
  locate(x: number, z: number, near: number, range = 400) { return this.v.locate(x, z, near, range); }
  widthAt(s: number) { return this.v.widthAt(s); }
  point(s: number, n: number, out: Pose): Pose { return this.v.point(s, n, out); }
  // How much of the land at s is the next city's (0 the last city's, 1 the next's).
  blendAt(s: number) { const b = this.geo.blendAt(this.ds(s)); return this.dir > 0 ? b : 1 - b; }
  isFrom(s: number, n = 0) { const a = this.geo.isA(this.ds(s), this.dir * n); return this.dir > 0 ? a : !a; }
  // The truck's height and grade at s: the road's, or up the on-ramp and on the freeway.
  truckY(s: number) { return this.baseAt(s) + (this.inp.toFreewayMerge ? (s > this.gateS ? FW_TOP : onRampY(this.gateS - s)) : 0); }
  truckGrade(s: number, wb = 5) { return (this.truckY(s + wb) - this.truckY(s)) / wb; }   // (rear axle to front)
  // The freeway's frame, on a road into a freeway city by its way in (freeway.ts).
  private fwFrame: Frame | null = null;
  get freewayFrame(): Frame | null { if (!this.inp.toFreeway) return null; if (!this.fwFrame) this.fwFrame = Frame.ofRoad(this); return this.fwFrame; }
  // The freeway of the city a road leaves, if it has one (it runs out of town both ways).
  private fwFrom: Frame | null | undefined;
  get fromFreewayFrame(): Frame | null {
    if (this.fwFrom === undefined) {
      const i = this.inp, cs = i.fromKey, g = i.kind === "exit" ? freewayGate(cs) : null;
      this.fwFrom = g ? Frame.ofCitySeed(cs, i.fromName, false, g, seaSide(cs) !== null, i.fromCurve !== undefined ? i.fromCurve : new CityPlan(cs, i.fromStyle).fwCurve) : null;
    }
    return this.fwFrom;
  }
  // Across the ferry's water (strictly between the quays).
  inChannel(s: number) { const F = this.ferry; return !!F && s > F.q0 && s < F.q1; }
  get waterY() { return this.geo.waterY; }
  // The ferry boat's rear, with the truck at s.
  boatRear(s: number) { const F = this.ferry!; return THREE.MathUtils.clamp(s - FERRY_BOARD, F.q0 + BOAT_GAP, F.q1 - BOAT_L - BOAT_GAP); }
  // The truck is on the boat at drive time t.
  aboardAt(t: number) { const F = this.ferry; if (!F) return false; const s = this.sAt(t); return s > F.board - 0.3 && s < F.land + 0.3; }
  // A piece's span of ground, in this drive's coordinates.
  groundOf(p: RoadPiece) { return pieceGround(p); }
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
    const c = this.cattle!, A = c.sideA, B = -A, hh = (i: number, k: number) => hash3(i, k, Math.floor(c.cross), this.inp.driveSeed, 0xc0e5);
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
  // The weather at drive time t: the last city's until a third of the way, then the next city's.
  weatherAt(t: number): WeatherMix {
    const k = this.inp.kind === "arrival" || t >= this.D ? 1 : smooth(THREE.MathUtils.clamp((t / this.D - 0.33) / 0.34, 0, 1));
    return lerpWeather(weatherMix(this.inp.fromClimate.weather), weatherMix(this.inp.toClimate.weather), k);
  }
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
      if (p.away && (isSign || p.kind === "fwsign" || p.kind === "weigh" || p.kind === "tractor")) continue;   // (facing the other way)
      if (!stop && !isSign && hash2(i, Math.floor(p.s), this.geo.key, 0x5a0) > 0.7) continue;
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
