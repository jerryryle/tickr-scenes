// A freeway through some cities: an elevated motorway along the entry gate's street line, right
// through town and on out into the country both ways, where it curves away and runs off into the
// distance. Out on the entry side it runs along the highway's left, and swings over it to the
// street line at the gate. Just out of town an on-ramp leaves the highway, climbs beside the
// freeway and joins it as its right-hand lane. In about half the freeway cities the truck takes
// it (freewayMerge): along the freeway into town and off it a couple of blocks in, down an
// off-ramp that spirals down to the street below (interchange.ts); elsewhere it stays on the
// highway, under the freeway into town.
//
// Everything here is placed from a Frame: the entry gate street's outer end, the way out of town
// and the way to the right of a truck coming in. d is the distance out of town from the gate end
// (negative: the gate street, the city, the far side), n the offset to the right of a truck coming
// in, along the line; beyond the bends, d runs on along the freeway and n is across it. The same
// pieces are drawn by the road coming in (countryworld.ts: before the next city takes over, and
// for a while after) and by the city (FreewayReach), from the same frame, so the one can hand over
// to the other without anything moving. In town the deck is the street's (city.ts), and its bents
// stand on the sidewalks.
import * as THREE from "three@0.187.0";
import { hash2 } from "./rng.ts";
import { Batch } from "./geom.ts";
import { disposeTree } from "./chunks.ts";
import { BLOCK, STREET } from "./grid.ts";
import { CITY_HI, CITY_LO, entryGateOf, gateEndSlot } from "./city.ts";
import type { CityPlan, Gate } from "./city.ts";
import type { CityStyle } from "./styles.ts";
import type { CountryRoad } from "./country.ts";
import { citySeedOf } from "./country.ts";
import { seaSide } from "./outline.ts";
import { PlateSet } from "./signs.ts";
import { CarFleet, carKindAt } from "./cars.ts";

export const FW_TOP = 9.6;             // the deck's top (clear of the streetlights' arms under it)
export const FW_HALF = 7.4;            // half the deck's width
export const FW_COLS = 8.2;            // a bent's columns, either side of the deck's centre line
export const FW_SHIFT = 16;            // out on the entry side the deck runs this far to the highway's right
const FW_SHIFT_LEN = 130;              // and swings over to the street line within this of the gate end
// Out of town each way it runs straight for FW_BEND (on the entry side, past the on-ramp), then
// curves away from the line (radius FW_BEND_R, a quarter turn) and runs straight on for FW_LEG,
// out of sight.
const FW_BEND = 780, FW_BEND_FAR = 350, FW_BEND_R = 600, FW_LEG = 900;
export const FW_TIP = FW_BEND + FW_BEND_R * Math.PI / 2 + FW_LEG;   // its far end, from the gate end
const FW_TIP_FAR = FW_BEND_FAR + FW_BEND_R * Math.PI / 2 + FW_LEG;   // and on the far side, from the city's far edge
const FW_BENT_STEP = 30;
// The on-ramp: an exit lane off the highway to the right (DIV), across under the freeway at
// ground level between its columns, up along its far side (UP), and into its right-hand lane
// over a taper (MERGE): the truck's lane all the way (onRampN, onRampY).
const RAMP_DIV0 = 720, RAMP_DIV1 = 560, RAMP_UP0 = 560, RAMP_UP1 = 330, RAMP_MERGE1 = 250;
const RAMP_N = 28, RAMP_HALF = 2.6, ROAD_EDGE = 4.1;
export const FW_LANE_N = 5.4;           // the freeway's right-hand lane coming in (its outer one)
// Off the freeway into town (interchange.ts): from its right-hand lane FW_OFF_A along the street
// from the FW_OFF_K-th node in from the gate; FW_OFF_D past the gate end along the line.
export const FW_OFF_K = 2, FW_OFF_A = -50, FW_OFF_D = (BLOCK - STREET / 2) + FW_OFF_K * BLOCK + FW_OFF_A;
export const FW_OFF_V = 10;             // the truck's speed as it starts off the freeway (it slows on the ramp)
const FW_CONCRETE = 0x9a978e, FW_GIRDER = 0x6f7276, FW_ASPHALT = 0x3a3b3f, FW_WHITE = 0xe8e8e0, FW_YELLOW = 0xf2c200;

const fwEase = (u: number) => { const t = THREE.MathUtils.clamp(u, 0, 1); return t * t * (3 - 2 * t); };
const fwSmooth = (u: number) => { const x = THREE.MathUtils.clamp(u, 0, 1); return x * x * x * (10 + x * (6 * x - 15)); };
const fwM = (d: number) => (d <= 0 ? 0 : FW_SHIFT * fwEase(d / FW_SHIFT_LEN));

// Whether a city has a freeway, and through which gate: about half of them (never in a small
// Main Street town, nor across a metro's elevated lines). A pure function of the city's seed.
export function freewayGate(citySeed: number, style: CityStyle): Gate | null {
  if (style.id === "mainstreet" || style.storybook) return null;
  const g = entryGateOf(citySeed);
  if (style.elevated && (g.dir === 1 || g.dir === 3)) return null;
  return hash2(citySeed, 0xf3e, 0, 0x7a2) < 0.55 ? g : null;
}
// Whether the truck takes the freeway into a freeway city (about half of them).
export function freewayMerge(citySeed: number) { return hash2(citySeed, 0x3e6, 0, 0x7a3) < 0.5; }

// The truck's lane (n) at d on the way in by the on-ramp, from the highway's lane `base`.
export function onRampN(d: number, base: number) {
  if (d >= RAMP_DIV0) return base;
  if (d > RAMP_DIV1) return base + (RAMP_N - base) * fwSmooth((RAMP_DIV0 - d) / (RAMP_DIV0 - RAMP_DIV1));
  if (d > RAMP_UP1) return RAMP_N;
  const lane = fwM(d) + FW_LANE_N;
  if (d > RAMP_MERGE1) return RAMP_N + (lane - RAMP_N) * fwSmooth((RAMP_UP1 - d) / (RAMP_UP1 - RAMP_MERGE1));
  return lane;
}
// Its height there (the ramp's surface, then the freeway's).
export function onRampY(d: number) {
  if (d >= RAMP_UP0) return 0;
  if (d > RAMP_UP1) return FW_TOP * fwEase((RAMP_UP0 - d) / (RAMP_UP0 - RAMP_UP1));
  return FW_TOP;
}
// The on-ramp's edges at d: leaving the highway, its left clipped to the highway's edge (a gore
// opening from it); over the merge, its left clipped to the freeway's right edge and its right
// closing in on it (a taper).
function rampEdges(d: number): [number, number] {
  const c = onRampN(d, ONRAMP_FROM), fwEdge = fwM(d) + FW_HALF;
  if (d > RAMP_UP0) return [Math.max(c - RAMP_HALF, ROAD_EDGE), c + RAMP_HALF];
  if (d > RAMP_UP1) return [c - RAMP_HALF, c + RAMP_HALF];
  const right = RAMP_N + RAMP_HALF + (fwEdge - (RAMP_N + RAMP_HALF)) * fwSmooth((RAMP_UP1 - d) / (RAMP_UP1 - RAMP_MERGE1));
  // (Past the gore's nose the ramp's lane is the freeway's: its surface runs on to the freeway's
  // asphalt, over the strip of deck along its edge.)
  return [Math.max(c - RAMP_HALF, d < ONRAMP_NOSE ? fwEdge - 0.4 : fwEdge), Math.max(right, fwEdge)];
}
export const FW_ENTRANCE_SIGN = 800;   // the entrance sign, on the highway before the on-ramp leaves it
const ONRAMP_SIGN = FW_ENTRANCE_SIGN;
const ONRAMP_FROM = 1.85;   // (the highway's lane: country.ts LANE)
// The gore's nose: where the on-ramp's left edge meets the freeway's right edge (to the metre).
// The two barriers run together to it and end there; from it to the end of the taper the lanes
// are one roadway, marked by a dashed line along the freeway's edge.
const ONRAMP_NOSE = (() => {
  let d = RAMP_UP1;
  while (d > RAMP_MERGE1 && onRampN(d, ONRAMP_FROM) - RAMP_HALF > FW_SHIFT + FW_HALF) d -= 0.5;
  return Math.round(d / 10) * 10;
})();

// An organic town's freeway (CityPlan.layout: none other has one that bends): straight in from its
// gate past the interchange (FW_STRAIGHT blocks: the grid's patch round it, citygen.ts), then on
// through town along a smooth curve, either an S over to the far side (`s`: some blocks to one
// side) or a long bend out through the side to its right (`bend`: never towards the sea, on the
// left), leaving town square to that edge on one of the grid's lines, clear of its gates. From the
// city's seed and gate alone (a country road needs it before the town is laid out), or null: a
// town too small for it (the straight leaves too little), or with no room clear of the gates.
export const FW_STRAIGHT = 7;
export interface FwCurve { pts: [number, number][]; cum: number[]; len: number; ex: number; ez: number; dx: number; dz: number; kind: "s" | "bend" }
export function freewayCurveOf(seed: number, g: Gate, gates: readonly Gate[], seaward: boolean): FwCurve | null {
  const span = CITY_HI + 1 - CITY_LO;
  if (span < 18) return null;
  const at = (i: number) => i * BLOCK + STREET / 2, X0 = at(CITY_LO), X1 = at(CITY_HI + 1);
  const I = [[-1, 0], [0, 1], [1, 0], [0, -1]][g.dir], R = [-I[1], I[0]], N0 = [at(g.ix), at(g.iz)];
  const dot = (x: number, z: number, v: number[]) => (x - N0[0]) * v[0] + (z - N0[1]) * v[1];
  // (How far the town reaches either side of the line, and where its gates are along each edge.)
  const room = (v: number[]) => v[0] ? ((v[0] > 0 ? X1 : X0) - N0[0]) * v[0] : ((v[1] > 0 ? X1 : X0) - N0[1]) * v[1];
  const right = room(R), left = room([-R[0], -R[1]]), h = (k: number) => hash2(seed, 0xc7a, 0, k);
  const gatesOn = (dir: number) => gates.filter((q) => q.dir === dir);
  // S: over to the opposite edge, 3 to 6 blocks to one side, clear of its gates (and of the sea).
  const opp = gatesOn((g.dir + 2) % 4).map((q) => dot(at(q.ix), at(q.iz), R));
  const sCands: number[] = [];
  for (let k = -6; k <= 6; k++) {
    const lat = k * BLOCK;
    if (Math.abs(k) < 3 || lat > right - 3 * BLOCK || -lat > left - (seaward ? 5 : 3) * BLOCK || opp.some((o) => Math.abs(o - lat) < 1.5 * BLOCK)) continue;
    sCands.push(lat);
  }
  // Bend: out through the right-hand edge, a good way on in from the straight, clear of its gates.
  const side = gatesOn((g.dir + 1) % 4).map((q) => dot(at(q.ix), at(q.iz), I));   // (the right-hand edge's gates: they face R)
  const bCands: number[] = [];
  if (right >= 5 * BLOCK) for (let m = FW_STRAIGHT + 5; m <= span - 3; m++) if (side.every((o) => Math.abs(o - m * BLOCK) >= 1.5 * BLOCK)) bCands.push(m * BLOCK);
  const bend = bCands.length > 0 && (h(1) < 0.5 || !sCands.length);
  if (!bend && !sCands.length) return null;
  const P1 = [N0[0] + I[0] * FW_STRAIGHT * BLOCK, N0[1] + I[1] * FW_STRAIGHT * BLOCK];
  let E: number[], D: number[];
  if (bend) { const m = bCands[Math.floor(h(2) * bCands.length) % bCands.length]; E = [N0[0] + I[0] * m + R[0] * right, N0[1] + I[1] * m + R[1] * right]; D = R; }
  else { const lat = sCands[Math.floor(h(3) * sCands.length) % sCands.length]; E = [N0[0] + I[0] * span * BLOCK + R[0] * lat, N0[1] + I[1] * span * BLOCK + R[1] * lat]; D = I; }
  // (A cubic from P1 heading in to E heading out, sampled finely.)
  const c = Math.hypot(E[0] - P1[0], E[1] - P1[1]) * 0.42, C1 = [P1[0] + I[0] * c, P1[1] + I[1] * c], C2 = [E[0] - D[0] * c, E[1] - D[1] * c];
  const pts: [number, number][] = [], cum: number[] = [0], N = 400;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    pts.push([b0 * P1[0] + b1 * C1[0] + b2 * C2[0] + b3 * E[0], b0 * P1[1] + b1 * C1[1] + b2 * C2[1] + b3 * E[1]]);
    if (i) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum, len: cum[N], ex: E[0], ez: E[1], dx: D[0], dz: D[1], kind: bend ? "bend" : "s" };
}

export class Frame {
  readonly ox: number; readonly oz: number; readonly rx: number; readonly rz: number;
  merge = false;   // the truck takes the freeway here (freewayMerge)
  // What its signs say: its route number, the city's exit number and name (and whether it has an
  // exit: its off-ramp, interchange.ts), and the compass ways in (towards the city) and out.
  route = 0; exitNo = 0; name = ""; hasExit = false; wayIn = ""; wayOut = "";
  label(citySeed: number, name: string) {
    this.route = 10 + Math.floor(hash2(citySeed, 0x1e7, 0, 0x7a5) * 80);
    this.exitNo = 2 + Math.floor(hash2(citySeed, 0xe17, 0, 0x7a6) * 38);
    this.name = name.toUpperCase(); this.hasExit = freewayMerge(citySeed);
    const ix = -this.ox, iz = -this.oz;   // the way in
    this.wayIn = Math.abs(ix) > Math.abs(iz) ? (ix > 0 ? "EAST" : "WEST") : (iz < 0 ? "NORTH" : "SOUTH");
    this.wayOut = { EAST: "WEST", WEST: "EAST", NORTH: "SOUTH", SOUTH: "NORTH" }[this.wayIn]!;
    return this;
  }
  farSide = 1;     // which way the far side's end bends (+1: towards +n)
  // (x, z): the gate end; h: the heading of a truck coming in there. near/far: where the city's
  // own streets begin and end along the line (d).
  // An organic town's curve (freewayCurveOf): from d = bend0 (where the straight from the gate
  // ends) on through town to the far edge (far), then the far side runs on straight from there the
  // way it left (its own line: fx + fox * d, across fr), and bends off as a straight one's does.
  curve: FwCurve | null = null; bend0 = -1e9;
  fx: number; fz: number; fox: number; foz: number; frx: number; frz: number;
  constructor(readonly x: number, readonly z: number, h: number, readonly near = -60, readonly far = -1e9) {
    this.ox = -Math.cos(h); this.oz = Math.sin(h); this.rx = Math.sin(h); this.rz = Math.cos(h);
    this.fx = x; this.fz = z; this.fox = this.ox; this.foz = this.oz; this.frx = this.rx; this.frz = this.rz;
  }
  static ofCity(plan: CityPlan, g: Gate): Frame { return Frame.ofCitySeed(plan.seed, plan.name, plan.freewayMerge, g, seaSide(plan.seed, plan.style) !== null, plan.fwCurve); }
  // (The same from the city's seed and name alone: a country road out of the city needs it.)
  // `seaward`: the city is on the sea (outline.ts), always on the left of the way in, so the far
  // side's end bends right (+n), away from it, as the entry side's does.
  static ofCitySeed(seed: number, name: string, merge: boolean, g: Gate, seaward = false, curve: FwCurve | null = null): Frame {
    const e = gateEndSlot(g), f = new Frame(e.x, e.z, e.h + Math.PI);
    // The city's streets along the line, as distances out of the gate end.
    const lo = CITY_LO * BLOCK, hi = (CITY_HI + 1) * BLOCK, along = g.dir === 0 || g.dir === 2;
    const d = (u: number) => along ? (u - e.x) * f.ox : (u - e.z) * f.oz;
    // (Curving: the straight to its start, then the curve to the edge it leaves by.)
    const b0 = -(BLOCK - STREET / 2 + FW_STRAIGHT * BLOCK);
    const out = new Frame(e.x, e.z, e.h + Math.PI, Math.max(d(lo), d(hi)), curve ? b0 - curve.len : Math.min(d(lo), d(hi)));
    if (curve) {
      out.curve = curve; out.bend0 = b0;
      out.fox = -curve.dx; out.foz = -curve.dz; out.frx = out.foz; out.frz = -out.fox;
      out.fx = curve.ex - out.fox * out.far; out.fz = curve.ez - out.foz * out.far;
    }
    out.merge = merge;
    out.farSide = seaward || hash2(seed, 0xfa5, 0, 0x7a4) < 0.5 ? 1 : -1;
    return out.label(seed, name);
  }
  static ofRoad(road: CountryRoad, dx = 0, dz = 0): Frame {
    const q = road.center(road.gateS, { x: 0, z: 0, h: 0, k: 0 });
    const out = new Frame(q.x + dx, q.z + dz, q.h);
    out.merge = !!road.inp.toFreewayMerge;
    const i = road.inp;
    return out.label(citySeedOf(i.seed, i.kind === "exit" ? i.city + 1 : i.city), i.toName);
  }
  // The deck's centre line out of town, as x, z pairs every `step` metres: the entry side, and for
  // a city's frame the far side too (a road's frame knows only its own side).
  centreLine(step = 8): number[] {
    const out: number[] = [];
    for (let d = 0; d <= FW_TIP; d += step) out.push(this.px(d, this.m(d)), this.pz(d, this.m(d)));
    if (this.far > -1e8) for (let d = this.far; d >= this.far - FW_TIP_FAR; d -= step) out.push(this.px(d, 0), this.pz(d, 0));
    return out;
  }
  // The deck's centre line (n) and its top at d.
  m(d: number) { return fwM(d); }
  y(_d: number) { return FW_TOP; }
  // The point n across at d, and the way across there (the bends turn it).
  private pt = { x: 0, z: 0, ax: 0, az: 0 };
  private at(d: number) {
    const p = this.pt, R = FW_BEND_R, q = Math.PI / 2 * R;
    if (d > FW_BEND) {
      // Entry side: bending away from the highway (towards the side it runs on) from its line at
      // n = FW_SHIFT.
      const sg = Math.sign(FW_SHIFT), u = d - FW_BEND, kx = this.x + this.ox * FW_BEND + this.rx * (FW_SHIFT + sg * R), kz = this.z + this.oz * FW_BEND + this.rz * (FW_SHIFT + sg * R);
      if (u <= q) { const c = Math.cos(u / R), s = Math.sin(u / R); p.ax = this.rx * c - sg * this.ox * s; p.az = this.rz * c - sg * this.oz * s; p.x = kx - sg * p.ax * R; p.z = kz - sg * p.az * R; }
      else { p.ax = -sg * this.ox; p.az = -sg * this.oz; p.x = kx + this.ox * R + sg * this.rx * (u - q); p.z = kz + this.oz * R + sg * this.rz * (u - q); }
      p.x -= p.ax * FW_SHIFT; p.z -= p.az * FW_SHIFT;   // (n is measured from where the line's n = 0 would be)
      return p;
    }
    const fb = this.far - FW_BEND_FAR;
    if (d < fb) {
      // Far side: bending towards farSide * n from its line.
      const ox = this.fox, oz = this.foz, rx = this.frx, rz = this.frz;
      const v = fb - d, sg = this.farSide, kx = this.fx + ox * fb + rx * sg * R, kz = this.fz + oz * fb + rz * sg * R;
      if (v <= q) { const c = Math.cos(v / R), s = Math.sin(v / R); p.ax = rx * c + ox * sg * s; p.az = rz * c + oz * sg * s; p.x = kx - p.ax * sg * R; p.z = kz - p.az * sg * R; }
      else { p.ax = ox * sg; p.az = oz * sg; p.x = kx - ox * R + rx * sg * (v - q); p.z = kz - oz * R + rz * sg * (v - q); }
      // (at v = q: kx - ox*R*... the leg goes on along +sg*r)
      return p;
    }
    if (d <= this.far) { p.ax = this.frx; p.az = this.frz; p.x = this.fx + this.fox * d; p.z = this.fz + this.foz * d; return p; }
    const C = this.curve;
    if (C && d < this.bend0) {
      // Through town along the curve: u from its start; the way across, square to it.
      const u = Math.min(C.len, this.bend0 - d);
      let lo = 0, hi = C.cum.length - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C.cum[m] <= u) lo = m; else hi = m; }
      const f = (u - C.cum[lo]) / (C.cum[hi] - C.cum[lo] || 1), [ax, az] = C.pts[lo], [bx, bz] = C.pts[hi], l = Math.hypot(bx - ax, bz - az) || 1;
      const ox = -(bx - ax) / l, oz = -(bz - az) / l;   // (outward: back along it)
      p.x = ax + (bx - ax) * f; p.z = az + (bz - az) * f; p.ax = oz; p.az = -ox;
      return p;
    }
    p.ax = this.rx; p.az = this.rz; p.x = this.x + this.ox * d; p.z = this.z + this.oz * d;
    return p;
  }
  px(d: number, n: number) { const p = this.at(d); return p.x + p.ax * n; }
  pz(d: number, n: number) { const p = this.at(d); return p.z + p.az * n; }
  // Where (x, z) is along the line (straight: d and n; for the town, the on-ramp and the highway).
  dAt(x: number, z: number) { return (x - this.x) * this.ox + (z - this.z) * this.oz; }
  nAt(x: number, z: number) { return (x - this.x) * this.rx + (z - this.z) * this.rz; }
  // The freeway's d nearest (x, z) and how far across from its centre line (x, z) is.
  locate(x: number, z: number): { d: number; off: number } {
    if (this.curve) return this.locateCurved(x, z);
    let d = THREE.MathUtils.clamp(this.dAt(x, z), this.far - FW_TIP_FAR, FW_TIP);
    // (Out on the bends: search along it.)
    if (d > FW_BEND - 1 || d < this.far - FW_BEND_FAR + 1) {
      let best = d, bd = Infinity;
      const lo = d > 0 ? FW_BEND : this.far - FW_TIP_FAR, hi = d > 0 ? FW_TIP : this.far - FW_BEND_FAR;
      for (let u = lo; u <= hi; u += 20) { const dx = this.px(u, this.m(u)) - x, dz = this.pz(u, this.m(u)) - z, e = dx * dx + dz * dz; if (e < bd) { bd = e; best = u; } }
      for (let st = 10; st > 0.5; st /= 2) for (const u of [best - st, best + st]) { if (u < lo || u > hi) continue; const dx = this.px(u, this.m(u)) - x, dz = this.pz(u, this.m(u)) - z, e = dx * dx + dz * dz; if (e < bd) { bd = e; best = u; } }
      d = best;
    }
    const p = this.at(d);
    return { d, off: (x - p.x) * p.ax + (z - p.z) * p.az - this.m(d) };
  }
  // (Curving: the nearest of the straight in, the curve and the far side, each as near as it gets.)
  private cells: Map<number, number[]> | null = null;
  private locateCurved(x: number, z: number): { d: number; off: number } {
    const C = this.curve!, CELL = 40;
    if (!this.cells) {
      this.cells = new Map();
      for (let i = 0; i < C.pts.length; i++) { const k = Math.floor(C.pts[i][0] / CELL) * 100003 + Math.floor(C.pts[i][1] / CELL); let a = this.cells.get(k); if (!a) this.cells.set(k, a = []); a.push(i); }
    }
    const dist = (d: number) => { const p = this.at(d); return Math.hypot(x - p.x, z - p.z); };
    const refine = (d: number, lo: number, hi: number) => {
      let best = THREE.MathUtils.clamp(d, lo, hi), bd = dist(best);
      for (let st = 16; st > 0.25; st /= 2) for (const u of [best - st, best + st]) { if (u < lo || u > hi) continue; const e = dist(u); if (e < bd) { bd = e; best = u; } }
      return best;
    };
    const cands: number[] = [];
    // (The straight in, and on out: as a straight frame's, from bend0 on.)
    { const d0 = THREE.MathUtils.clamp(this.dAt(x, z), this.bend0, FW_TIP); cands.push(d0 > FW_BEND - 1 ? refine(d0, FW_BEND, FW_TIP) : d0); }
    // (The curve: its sample nearest, round the point's cell.)
    { let bi = -1, bd = Infinity; const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) for (const k of this.cells.get((cx + i) * 100003 + cz + j) ?? []) { const e = Math.hypot(C.pts[k][0] - x, C.pts[k][1] - z); if (e < bd) { bd = e; bi = k; } }
      if (bi >= 0) cands.push(refine(this.bend0 - C.cum[bi], this.far, this.bend0)); }
    // (The far side: along its own line, then round its bend.)
    { const d0 = THREE.MathUtils.clamp(this.far + (x - this.fx - this.fox * this.far) * this.fox + (z - this.fz - this.foz * this.far) * this.foz, this.far - FW_TIP_FAR, this.far);
      cands.push(d0 < this.far - FW_BEND_FAR + 1 ? refine(d0, this.far - FW_TIP_FAR, this.far - FW_BEND_FAR) : d0); }
    let d = cands[0];
    for (const c of cands) if (dist(c) < dist(d)) d = c;
    const p = this.at(d);
    return { d, off: (x - p.x) * p.ax + (z - p.z) * p.az - this.m(d) };
  }
  // The underside of the deck over (x, z), if (x, z) is under it (the camera keeps below it).
  under(x: number, z: number): number | null {
    const L = this.locate(x, z);
    if (Math.abs(L.off) > FW_HALF + 0.5 || L.d > FW_TIP || L.d < this.far - FW_TIP_FAR) return null;
    return FW_TOP - 2.2;
  }
  // Is (x, z) where the freeway or its on-ramp stands (scenery keeps out)?
  corridor(x: number, z: number) {
    const d0 = this.dAt(x, z), n0 = this.nAt(x, z);
    // (Quick: the bends go off to one side only.)
    if ((d0 > 0 && n0 * Math.sign(FW_SHIFT) < -8) || (!this.curve && d0 < this.far && n0 * this.farSide < -12)) return false;
    // The on-ramp (its lane, out to its edges and a little more).
    if (d0 > RAMP_MERGE1 - 20 && d0 < RAMP_DIV0 + 20) { const c = onRampN(THREE.MathUtils.clamp(d0, RAMP_MERGE1, RAMP_DIV0), ONRAMP_FROM); if (Math.abs(n0 - c) < RAMP_HALF + 3) return true; }
    const L = this.locate(x, z);
    return L.d <= FW_TIP + 10 && L.d >= this.far - FW_TIP_FAR - 10 && Math.abs(L.off) < FW_COLS + 2;
  }
}

// Whether a bent's column may stand at (x, z).
type FwColumnOk = (x: number, z: number) => boolean;

// The freeway between d0 and d1 (d0 < d1), drawn into b relative to (ax, az): the deck (`main`),
// the on-ramp (`ramp`) and the highway's surface out to the gate (`surface`, when nothing else
// draws it). On the entry side the columns keep off the highway and the on-ramp.
export function buildFreeway(b: Batch, F: Frame, d0: number, d1: number, ax: number, az: number,
  parts: { main?: boolean; ramp?: boolean; surface?: boolean; bents?: boolean }, columnOk: FwColumnOk | null = null, plates: PlateSet | null = null) {
  // Its signs: gantries over it on the way in (the route; the exit ahead, where the city has one)
  // and on the far side, and the entrance sign on the highway before the on-ramp.
  if (plates && parts.main) {
    const R = `I-${F.route}`, ex = `EXIT ${F.exitNo}`;
    const G: [number, string, string][] = [[620, `${R} ${F.wayIn} · ${F.name}`, `${R} ${F.wayOut}`]];
    if (F.hasExit) G.push([200, `${ex} · ${F.name} CENTER · 1/4 MI`, `${R} ${F.wayOut}`]);
    G.push([F.far - 260, `${R} ${F.wayIn}`, `${R} ${F.wayOut} · ${F.name}`]);
    for (const [d, pos, neg] of G) if (d >= d0 && d < d1) freewayGantry(b, plates, F, d, ax, az, [{ k: 1, face: 1, text: pos }, { k: -1, face: -1, text: neg }]);
  }
  if (plates && parts.ramp && ONRAMP_SIGN >= d0 && ONRAMP_SIGN < d1) {
    const n = 8.8, xa = F.px(ONRAMP_SIGN, n) - ax, za = F.pz(ONRAMP_SIGN, n) - az, yaw = Math.atan2(-F.rz, F.rx);
    for (const k of [-2.4, 2.4]) b.cyl(F.px(ONRAMP_SIGN + 0.15, n + k) - ax, 2.2, F.pz(ONRAMP_SIGN + 0.15, n + k) - az, 0.09, 4.4, 0x8d9296, 6);
    b.box(xa, 3.55, za, 5.8, 1.5, 0.1, 0x1e6b3a, yaw);
    plates.put(`I-${F.route} ${F.wayIn} · ENTRANCE`, xa - F.ox * -0.06, 3.55, za - F.oz * -0.06, 5.6, 0.7, Math.atan2(F.ox, F.oz));
  }
  const STEP = 10;
  // A box along the line from d=a to d=a2 at offset n, following heights ya..yb, `lo`..`hi` above them.
  const along = (a: number, a2: number, na: number, nb: number, ya: number, yb: number, lo: number, hi: number, wid: number, color: number) => {
    const xa = F.px(a, na), za = F.pz(a, na), xb = F.px(a2, nb), zb = F.pz(a2, nb), run = Math.hypot(xb - xa, zb - za);
    b.boxR((xa + xb) / 2 - ax, (ya + yb) / 2 + (lo + hi) / 2, (za + zb) / 2 - az, Math.hypot(run, yb - ya) + 0.04, hi - lo, wid, color, 0, Math.atan2(-(zb - za), xb - xa), Math.atan2(yb - ya, run));
  };
  const keep = b.dy; b.dy = 0;
  // (Finer where the deck bends, so its pieces follow it without gaps.)
  const bendy = (a: number) => (F.curve && a < F.bend0 + 1 && a > F.far - 1) || (a > -1 && a < FW_SHIFT_LEN + 1) || (a > FW_BEND - 1 && a < FW_BEND + FW_BEND_R * Math.PI / 2 + 1) || (a < F.far - FW_BEND_FAR + 1 && a > F.far - FW_BEND_FAR - FW_BEND_R * Math.PI / 2 - 1);
  const stepAt = (a: number) => (bendy(a) ? 2 : STEP);
  const next = (a: number) => Math.min(d1, (Math.floor(a / stepAt(a) + 1e-9) + 1) * stepAt(a));
  const gore = (a: number, a2: number) => a >= RAMP_MERGE1 - 1e-6 && a2 <= ONRAMP_NOSE + 1e-6;   // where the on-ramp joins (the barrier is open)
  for (let a = d0; a < d1 - 1e-6; a = next(a)) {
    const a2 = next(a);
    if (parts.main) {
      const ya = F.y(a), yb = F.y(a2), ma = F.m(a), mb = F.m(a2);
      along(a, a2, ma, mb, ya, yb, -0.55, -0.06, 2 * FW_HALF, FW_CONCRETE);
      along(a, a2, ma, mb, ya, yb, -0.06, 0, 2 * FW_HALF - 0.8, FW_ASPHALT);
      // Edge lines: solid, but dashed along the on-ramp's merge (where the lanes are one roadway).
      for (const k of [-1, 1]) {
        const n = k * (FW_HALF - 0.75);
        if (k > 0 && gore(a, a2)) { for (let e = Math.ceil(a / 6) * 6; e < a2 - 0.01; e += 6) along(e, Math.min(a2, e + 3), ma + n, ma + n, ya, yb, 0.002, 0.025, 0.16, FW_WHITE); }
        else along(a, a2, ma + n, mb + n, ya, yb, 0.002, 0.025, 0.14, FW_WHITE);   // (lines from 2 mm up: their undersides met the barrier's, which they run under, in one plane)
      }
      for (const k of [-1, 1]) {
        along(a, a2, ma + k * 4, mb + k * 4, ya, yb, -1.45, -0.55, 0.9, FW_GIRDER);
        if (!(k > 0 && gore(a, a2))) along(a, a2, ma + k * (FW_HALF - 0.2), mb + k * (FW_HALF - 0.2), ya, yb, 0, 0.95, 0.4, FW_CONCRETE);
        // Lane lines, dashed.
        { const k0 = Math.floor(a / STEP + 1e-9) * STEP, e = Math.min(a2, k0 + 4);
          if (Math.floor(a / STEP + 1e-9) % 2 === 0 && e > a + 0.01) along(a, e, F.m(a) + k * 3.5, F.m(e) + k * 3.5, ya, ya + (yb - ya) * (e - a) / (a2 - a), 0.002, 0.025, 0.16, FW_WHITE); }
      }
      along(a, a2, ma, mb, ya, yb, 0, 0.8, 0.5, FW_CONCRETE);   // the median barrier
    }
    if (parts.surface && a >= -1 && a < 1100) {
      // The highway itself, as countryworld.ts draws it: widening to the gate street's width at the gate.
      const w = fwEase((70 - (a + a2) / 2) / 70), half = 4.1 + 1.9 * w;
      along(a, a2, 0, 0, 0, 0, -0.124, -0.004, 2 * half, 0x34353a);
      for (const k of [-1, 1]) {
        along(a, a2, k * (half + 0.9), k * (half + 0.9), 0, 0, -0.125, -0.025, 1.8, 0x7a776c);
        along(a, a2, k * (half - 0.25), k * (half - 0.25), 0, 0, -0.005, 0.015, 0.14, FW_WHITE);
      }
      if (Math.floor(a / 6) % 2 === 0) along(a, Math.min(a2, a + 5), 0, 0, 0, 0, -0.005, 0.015, 0.24, FW_YELLOW);
    }
  }
  // The on-ramp: one continuous surface (its deck's top, sides and underside), parapets along its
  // edges once it is up, a wall under it low down and piers higher up.
  if (parts.ramp) {
    const r0 = Math.max(d0, RAMP_MERGE1), r1 = Math.min(d1, RAMP_DIV0);
    type V = [number, number, number];
    const quad = (p: V, q: V, r: V, s: V, color: number, face: V) => { b.tri(...p, ...q, ...r, color, face); b.tri(...p, ...r, ...s, color, face); };
    // (On the ground it is just its pavement, a few millimetres under the highway's at its edge.)
    const P = (d: number, n: number, dy: number): V => [F.px(d, n) - ax, Math.max(onRampY(d) - 0.01, -0.006) + dy, F.pz(d, n) - az];
    for (let a = r0; a < r1 - 1e-6; a = Math.min(r1, a + 2)) {
      const a2 = Math.min(r1, a + 2), [la, ra] = rampEdges(a), [lb, rb] = rampEdges(a2), ya = onRampY(a), yb = onRampY(a2);
      const out: V = [F.ox, 0, F.oz], right: V = [F.rx, 0, F.rz], left: V = [-F.rx, 0, -F.rz];
      if (rb - lb < 0.05 && ra - la < 0.05) continue;
      quad(P(a, la, 0), P(a, ra, 0), P(a2, rb, 0), P(a2, lb, 0), 0x34353a, [0, 1, 0]);
      if (Math.max(ya, yb) < 0.02) {
        // At grade: its edge lines (the left one only once clear of the highway).
        for (const [na, nb, k] of [[ra, rb, 1], [la, lb, -1]] as const) if (k > 0 || la > ROAD_EDGE + 0.3) quad(P(a, na - k * 0.25, 0.012), P(a, na - k * 0.11, 0.012), P(a2, nb - k * 0.11, 0.012), P(a2, nb - k * 0.25, 0.012), FW_WHITE, [0, 1, 0]);
        continue;
      }
      quad(P(a, la, -0.7), P(a, ra, -0.7), P(a2, rb, -0.7), P(a2, lb, -0.7), FW_CONCRETE, [0, -1, 0]);
      const low = (ya + yb) / 2 < 2.8;
      for (const [na, nb, face] of [[la, lb, left], [ra, rb, right]] as const) {
        quad(P(a, na, low ? -ya + 0.01 : -0.7), P(a2, nb, low ? -yb + 0.01 : -0.7), P(a2, nb, 0), P(a, na, 0), low ? 0x8a867c : FW_CONCRETE, face);
      }
      // Parapets: the right all the way up; the left until it meets the freeway.
      if (Math.min(ya, yb) > 0.6) for (const [na, nb, k] of [[ra, rb, 1], [la, lb, -1]] as const) {
        if (k < 0 && a < ONRAMP_NOSE - 1e-6) continue;
        const ia = na - k * 0.25, ib = nb - k * 0.25;
        quad(P(a, ia, 0), P(a2, ib, 0), P(a2, ib, 0.9), P(a, ia, 0.9), FW_CONCRETE, k > 0 ? left : right);
        quad(P(a, na, 0), P(a2, nb, 0), P(a2, nb, 0.9), P(a, na, 0.9), FW_CONCRETE, k > 0 ? right : left);
        quad(P(a, ia, 0.9), P(a, na, 0.9), P(a2, nb, 0.9), P(a2, ib, 0.9), FW_CONCRETE, [0, 1, 0]);
      }

      // Its edge lines: the right one all the way (it becomes the freeway's), the left one to the
      // gore's nose, where it meets the freeway's (a V between them).
      quad(P(a, ra - 0.9, 0.006), P(a, ra - 0.75, 0.006), P(a2, rb - 0.75, 0.006), P(a2, rb - 0.9, 0.006), FW_WHITE, [0, 1, 0]);
      if (a >= ONRAMP_NOSE) quad(P(a, la + 0.75, 0.006), P(a, la + 0.9, 0.006), P(a2, lb + 0.9, 0.006), P(a2, lb + 0.75, 0.006), FW_WHITE, [0, 1, 0]);
    }
    for (let d = Math.ceil((r0 - 15) / FW_BENT_STEP) * FW_BENT_STEP + 15; d < r1; d += FW_BENT_STEP) {
      const l = onRampY(d), c = onRampN(d, ONRAMP_FROM);
      if (d < r0 || l < 2.8) continue;
      b.cyl(F.px(d, c) - ax, (l - 0.7) / 2, F.pz(d, c) - az, 0.7, l - 0.7, FW_CONCRETE, 10);
    }
  }
  // Bents: every FW_BENT_STEP metres of d (the same spots whoever draws them).
  if (parts.bents ?? parts.main) {
    const entryOk = (d: number, n: number) => {
      if (d < 0 || d > FW_BEND + 1) return true;
      if (Math.abs(n) < 7.2) return false;
      if (d > RAMP_MERGE1 - 10 && d < RAMP_DIV0 + 10) { const c = onRampN(THREE.MathUtils.clamp(d, RAMP_MERGE1, RAMP_DIV0), ONRAMP_FROM); if (Math.abs(n - c) < RAMP_HALF + 1.2) return false; }
      return true;
    };
    for (let d = Math.ceil(d0 / FW_BENT_STEP) * FW_BENT_STEP; d < d1; d += FW_BENT_STEP) {
      const y = F.y(d), m = F.m(d);
      if (d < F.near && d > F.far) continue;   // (in town the street's own: city.ts)
      const cols = [-1, 1].map((k) => m + k * FW_COLS).filter((n) => columnOk ? columnOk(F.px(d, n), F.pz(d, n)) : entryOk(d, n));
      if (!cols.length) continue;
      const capY = y - 1.45 - 0.45;
      const xa = F.px(d, m - FW_COLS - 0.6), za = F.pz(d, m - FW_COLS - 0.6), xb = F.px(d, m + FW_COLS + 0.6), zb = F.pz(d, m + FW_COLS + 0.6);
      b.box((xa + xb) / 2 - ax, capY, (za + zb) / 2 - az, Math.hypot(xb - xa, zb - za), 0.9, 1.2, FW_CONCRETE, Math.atan2(-(zb - za), xb - xa));
      for (const n of cols) b.cyl(F.px(d, n) - ax, (capY - 0.45) / 2, F.pz(d, n) - az, 0.6, capY - 0.45 + 0.2, FW_CONCRETE, 10);
    }
  }
  b.dy = keep;
}

// An overhead sign gantry across the deck at d: posts on its barriers, a truss across, and a
// green plate over each side's lanes, facing the traffic coming up to it (face: +1 the traffic
// heading in, along -d; -1 the traffic heading out).
export function freewayGantry(b: Batch, plates: PlateSet, F: Frame, d: number, ax: number, az: number, panels: { k: number; face: number; text: string }[]) {
  const y = F.y(d), m = F.m(d), keep = b.dy; b.dy = 0;
  const across = (n0: number, n1: number, dd: number, yy: number, hgt: number, thick: number, color: number) => {
    const xa = F.px(d + dd, n0), za = F.pz(d + dd, n0), xb = F.px(d + dd, n1), zb = F.pz(d + dd, n1);
    b.box((xa + xb) / 2 - ax, yy, (za + zb) / 2 - az, Math.hypot(xb - xa, zb - za), hgt, thick, color, Math.atan2(-(zb - za), xb - xa));
  };
  for (const k of [-1, 1]) b.box(F.px(d, m + k * (FW_HALF - 0.2)) - ax, y + 4.3, F.pz(d, m + k * (FW_HALF - 0.2)) - az, 0.35, 6.7, 0.35, 0x8d9296);
  for (const yy of [y + 6.95, y + 7.55]) across(m - FW_HALF, m + FW_HALF, 0, yy, 0.22, 0.3, 0x8d9296);
  for (const p of panels) {
    const nc = m + p.k * 3.7, fo = p.face * 0.32;
    across(nc - 3.3, nc + 3.3, fo, y + 6.35, 1.2, 0.1, 0x1e6b3a);
    plates.put(p.text, F.px(d + p.face * 0.38, nc) - ax, y + 6.35, F.pz(d + p.face * 0.38, nc) - az, 6.4, 0.8, Math.atan2(p.face * F.ox, p.face * F.oz));
  }
  b.dy = keep;
}

// The freeway in town along one street (city.ts, block-local: the street along x for axis 0, z
// for axis 1, from 0 to BLOCK): the deck, level. Its bents stand on the sidewalks (city.ts).
// `open`: where the right-hand parapet (+n, k = 1) or the left one (k = -1) is left out, from a0 to
// a1 along (an off-ramp leaves there: interchange.ts).
// (x0..x1: along it, for a street of the curve, city.ts: an organic town's, along x in its frame.)
export function buildFreewayStreet(b: Batch, axis: number, open: { a0: number; a1: number; k: number } | null = null,
  gantry: { at: number; face: number; k: number; text: string; other: string; plates: PlateSet } | null = null, x0 = 0, x1 = BLOCK) {
  const F = axis === 0 ? new Frame(0, STREET / 2, Math.PI) : new Frame(STREET / 2, 0, Math.PI / 2);
  // (A frame with the line along +x (or along +z), level all the way: d from 0 to BLOCK.)
  const level = Object.assign(Object.create(Frame.prototype), F, { y: () => FW_TOP, m: () => 0 }) as Frame;
  if (gantry) freewayGantry(b, gantry.plates, level, gantry.at, 0, 0, [{ k: gantry.k, face: gantry.face, text: gantry.text }, { k: -gantry.k, face: -gantry.face, text: gantry.other }]);
  if (!open) { buildFreeway(b, level, x0, x1, 0, 0, { main: true, bents: false }); return; }
  // The deck without that parapet, then the parapet where it stands.
  buildFreewayDeck(b, level, open);
}
function buildFreewayDeck(b: Batch, F: Frame, open: { a0: number; a1: number; k: number }) {
  const along = (a: number, a2: number, n: number, lo: number, hi: number, wid: number, color: number) => {
    const xa = F.px(a, n), za = F.pz(a, n), xb = F.px(a2, n), zb = F.pz(a2, n);
    b.box((xa + xb) / 2, FW_TOP + (lo + hi) / 2, (za + zb) / 2, Math.hypot(xb - xa, zb - za) + 0.04, hi - lo, wid, color, Math.atan2(-(zb - za), xb - xa));
  };
  const keep = b.dy; b.dy = 0;
  for (let a = 0; a < BLOCK - 1e-6; a += 10) {
    const a2 = Math.min(BLOCK, a + 10);
    along(a, a2, 0, -0.55, -0.06, 2 * FW_HALF, FW_CONCRETE); along(a, a2, 0, -0.06, 0, 2 * FW_HALF - 0.8, FW_ASPHALT);
    for (const k of [-1, 1]) {
      along(a, a2, k * 4, -1.45, -0.55, 0.9, FW_GIRDER);
      if (Math.floor(a / 10) % 2 === 0) along(a, a + 4, k * 3.5, 0, 0.025, 0.16, FW_WHITE);
      // Its edge line: dashed along the deceleration lane (where the lanes are one roadway).
      const en = k * (FW_HALF - 0.75);
      if (k === open.k) for (const [s0, s1, dash] of [[a, Math.min(a2, open.a0), false], [Math.max(a, open.a0), Math.min(a2, open.a1), true], [Math.max(a, open.a1), a2, false]] as const) {
        if (s1 <= s0 + 0.01) continue;
        if (!dash) along(s0, s1, en, 0, 0.025, 0.14, FW_WHITE);
        else for (let e = Math.ceil(s0 / 6) * 6; e < s1 - 0.01; e += 6) along(e, Math.min(s1, e + 3), en, 0, 0.025, 0.16, FW_WHITE);
      } else along(a, a2, en, 0, 0.025, 0.14, FW_WHITE);
      const n = k * (FW_HALF - 0.2);
      if (k !== open.k) { along(a, a2, n, 0, 0.95, 0.4, FW_CONCRETE); continue; }
      for (const [s0, s1] of [[a, Math.min(a2, open.a0)], [Math.max(a, open.a1), a2]]) if (s1 > s0 + 0.01) along(s0, s1, n, 0, 0.95, 0.4, FW_CONCRETE);
    }
    along(a, a2, 0, 0, 0.8, 0.5, FW_CONCRETE);
  }
  b.dy = keep;
}
// The bent over a street at `at` along it (block-local), its two columns on the sidewalks.
export const FW_STREET_COLS = [STREET / 2 - FW_COLS, STREET / 2 + FW_COLS] as const;
export function freewayStreetBent(b: Batch, axis: number, at: number) {
  const capY = FW_TOP - 1.9;
  const [x, z, w, d] = axis === 0 ? [at, STREET / 2, 1.2, 2 * FW_COLS + 1.2] : [STREET / 2, at, 2 * FW_COLS + 1.2, 1.2];
  b.box(x, capY, z, w, 0.9, d, FW_CONCRETE);
  for (const c of FW_STREET_COLS) { const [cx, cz] = axis === 0 ? [at, c] : [c, at]; b.cyl(cx, (capY - 0.45) / 2, cz, 0.55, capY - 0.45 + 0.2, FW_CONCRETE, 10); }
}

// The freeway out of town either side of a city with one: built in pieces when the city starts
// (and when the roads it must keep clear of change). The pieces on the entry side are hidden while
// the road coming in draws them itself (cover).
export class FreewayReach {
  readonly group = new THREE.Group();
  frame: Frame | null = null;
  private key = "";
  private entry: { d0: number; d1: number; mesh: THREE.Object3D }[] = [];
  private disposers: (() => void)[] = [];
  constructor(scene: THREE.Object3D, private material: THREE.Material) { scene.add(this.group); }

  update(plan: CityPlan, roads: { road: CountryRoad; dx: number; dz: number }[]) {
    const g = plan.freeway;
    const key = g ? `${plan.seed}/${CITY_LO}/${FW_GATE_KEY(g)}|${roads.map((r) => `${r.road.inp.city}:${r.road.inp.kind}:${r.road.inp.dEst}:${r.dx.toFixed(1)}:${r.dz.toFixed(1)}`).join(";")}` : "";
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (!g) { this.frame = null; return; }
    const F = this.frame = Frame.ofCity(plan, g);
    // Where the roads are (the far side keeps its columns off them, and comes down only where clear).
    const pts: number[] = [], q = { x: 0, z: 0, h: 0, k: 0 };
    for (const { road, dx, dz } of roads) for (let s = 0; s <= road.gateS; s += 4) { road.center(s, q); const x = q.x + dx, z = q.z + dz; if (F.dAt(x, z) < F.far + 40) pts.push(x, z); }
    const clear = (x: number, z: number, r: number) => { for (let i = 0; i < pts.length; i += 2) if (Math.hypot(pts[i] - x, pts[i + 1] - z) < r) return false; return true; };
    const piece = (d0: number, d1: number, entry: boolean) => {
      const b = new Batch(), ax = F.px(d0, 0), az = F.pz(d0, 0), plates = new PlateSet();
      buildFreeway(b, F, d0, d1, ax, az, { main: true, ramp: entry, surface: entry }, entry ? null : (x, z) => clear(x, z, 7.9), plates);
      const mesh = b.build(this.material);
      if (!mesh) { plates.discard(); return; }
      const g = new THREE.Group(); g.add(mesh);
      const pm = plates.build(); if (pm) { g.add(pm.mesh); this.disposers.push(pm.dispose); }
      g.position.set(ax, 0, az); this.group.add(g);
      if (entry) this.entry.push({ d0, d1, mesh: g });
    };
    piece(F.near, 0, true);
    for (let d = 0; d < FW_TIP; d += 60) piece(d, Math.min(FW_TIP, d + 60), true);
    for (let d = F.far; d > F.far - FW_TIP_FAR; d -= 60) piece(Math.max(F.far - FW_TIP_FAR, d - 60), d, false);
  }
  // The road coming in draws the entry side out to `d` itself (0: it doesn't).
  cover(d: number) { for (const p of this.entry) p.mesh.visible = !(p.d0 >= 0 && p.d1 <= d + 0.01); }
  clear() {
    for (const m of [...this.group.children]) { this.group.remove(m); disposeTree(m); }
    for (const f of this.disposers) f();
    this.entry = []; this.disposers = [];
  }
}
const FW_GATE_KEY = (g: Gate) => `${g.ix},${g.iz},${g.dir}`;

// Cars on the freeway: two lanes each way, at steady speeds, where they are a pure function of the
// journey's time. Only the ones near the camera are drawn.
const FW_CAR_COLORS = [0xc0392b, 0x2e6fb2, 0xe8e8e0, 0x2a2b2e, 0x8a9aa6, 0x2e8b57, 0xe0a020, 0xd8d8d0];
const FW_LANES = [{ n: 2.0, v: 27, dir: -1 }, { n: 5.4, v: 24, dir: -1 }, { n: -2.0, v: 29, dir: 1 }, { n: -5.4, v: 25, dir: 1 }];
const FW_PER_LANE = 16, FW_MAX_CARS = 40;
export class FreewayTraffic {
  private cars: CarFleet;
  private poses: number[] = [];   // the cars drawn: x, z, heading, road height
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private one = new THREE.Vector3(1, 1, 1);
  constructor(scene: THREE.Object3D, material: THREE.Material) {
    this.cars = new CarFleet(scene, material, 14);
  }
  // F: the freeway's frame now (null: none here); t: journey time; near: the camera; entryOnly:
  // only the stretch out on the entry side (the city beyond isn't there yet).
  update(F: Frame | null, t: number, near: { x: number; z: number }, entryOnly: boolean) {
    let n = 0;
    this.cars.begin(); this.poses.length = 0;
    if (F) {
      const lo = (entryOnly ? -40 : F.far - FW_TIP_FAR + 10), hi = FW_TIP - 10, span = hi - lo;
      for (let li = 0; li < FW_LANES.length; li++) {
        const L = FW_LANES[li];
        if (F.merge && L.n === FW_LANE_N) continue;   // (the lane the truck takes)
        for (let k = 0; k < FW_PER_LANE && n < FW_MAX_CARS; k++) {
          const phase = (k + hash2(k, li, 0x5ca, 0xf00)) / FW_PER_LANE * (FW_TIP * 2 + 3000);
          const raw = phase + L.dir * L.v * t, d = lo + (((raw % span) + span) % span);
          const nn = F.m(d) + L.n;
          const x = F.px(d, nn), z = F.pz(d, nn);
          if (Math.hypot(x - near.x, z - near.z) > 360) continue;
          const hx = F.px(d + 1, F.m(d + 1) + L.n) - F.px(d - 1, F.m(d - 1) + L.n), hz = F.pz(d + 1, F.m(d + 1) + L.n) - F.pz(d - 1, F.m(d - 1) + L.n);
          const heading = Math.atan2(-hz, hx) + (L.dir > 0 ? 0 : Math.PI);
          this.e.set(0, heading, 0); this.q.setFromEuler(this.e);
          this.m4.compose(this.v.set(x, F.y(d), z), this.q, this.one);
          this.cars.add(carKindAt(hash2(k, li, 0x5cb, 0xf01)), this.m4, FW_CAR_COLORS[(k * 3 + li) % FW_CAR_COLORS.length]);
          this.poses.push(x, z, heading, F.y(d));
          n++;
        }
      }
    }
    this.cars.end();
  }
  // Headlight patches on the deck ahead of the cars within `reach` of `at` (atmosphere.ts
  // HEAD_LIGHTS): x, z, heading, strength and the deck's height, nearest first.
  headlights(at: { x: number; z: number }, reach: number, out: HeadSpots) {
    const d = this.poses;
    for (let i = 0; i < d.length; i += 4) {
      const h = d[i + 2], x = d[i] + Math.cos(h) * 7.5, z = d[i + 1] - Math.sin(h) * 7.5, dist = Math.hypot(x - at.x, z - at.z);
      if (dist < reach) out.add(dist, x, z, h, 0.7, d[i + 3]);
    }
  }
}

// Candidate headlight patches for the shader's few slots (main.ts), nearest taken first; the
// records are reused from frame to frame, so a night frame allocates nothing for them.
// A record: [distance, x, z, heading, strength, surface y, taken].
export class HeadSpots {
  n = 0;
  private recs: number[][] = [];
  clear() { this.n = 0; }
  add(dist: number, x: number, z: number, h: number, w: number, y: number) {
    let r = this.recs[this.n];
    if (!r) r = this.recs[this.n] = [0, 0, 0, 0, 0, 0, 0];
    r[0] = dist; r[1] = x; r[2] = z; r[3] = h; r[4] = w; r[5] = y; r[6] = 0;
    this.n++;
  }
  // The nearest not yet taken (the first added among equals), or null when all are.
  takeNearest(): number[] | null {
    let best: number[] | null = null;
    for (let i = 0; i < this.n; i++) { const r = this.recs[i]; if (!r[6] && (!best || r[0] < best[0])) best = r; }
    if (best) best[6] = 1;
    return best;
  }
}
