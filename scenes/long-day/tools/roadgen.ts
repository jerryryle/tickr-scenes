// The country road's generator (docs/long-day-cities.md, "Road maps"): today's rules for a road's set
// pieces, curves, hills and land, run once from gate a to gate b to draft its map. The drafting tool
// (tools/draftroads.ts) records the roadside items as the segment builder places them, and writes
// the map out.
import * as THREE from "three@0.187.0";
import { hash3 } from "../src/rng.ts";
import { smooth } from "../src/route.ts";
import { CityPlan, gateEnd } from "../src/city.ts";
import { Frame, freewayGate, FW_ENTRANCE_SIGN, FW_OFF_D, FW_SHIFT } from "../src/freeway.ts";
import { ARRIVE_LEN, BIOME_OF, LAND_DS, CATTLE_LEN, COAST_FADE, CUT_RUN, FERRY_LEN, FW_STRAIGHT_IN, HILL_EASE, HILL_FLAT, HILLS, LAND_SEAM, MAX_GRADE,
  pieceGround, pieceSpan, ROAD_DS, ROAD_PAD, STRAIGHT_IN, STRAIGHT_OUT, TRACTOR_LEN, TURN_ROOM, WEIGH_LEN } from "../src/country.ts";
import type { BiomeId, PieceKind, RoadPiece } from "../src/country.ts";
import type { RoadMap, RoadMapPiece } from "../src/roadmap.ts";
import type { WorldRoad } from "../src/world.ts";
import { cityByKey } from "../src/visits.ts";
import { CATALOGUE } from "../src/world.ts";
import { STYLES } from "../src/styles.ts";
import type { StyleId } from "../src/styles.ts";

const FW_FLAT = 760;   // (country.ts FW_FLAT_IN: the land level under the freeway, into a freeway city)
// Both ends of a road that is driven both ways are straight and level for the arrival straight and
// the straight before it, as gate b's end always was.
const END_STRAIGHT = Math.max(STRAIGHT_OUT, ARRIVE_LEN + STRAIGHT_IN);
// m: a Victorian city creeps in over this stretch short of where its arrival straight begins (or
// past where the land seam leaves one), from none PERIOD_FROM short to all of it PERIOD_TO short.
const PERIOD_FROM = 900, PERIOD_TO = 150;


export interface RoadEnd { plan: CityPlan; gate: string }
// A road's ends as the drafting needs them: each city's plan (its graph built) and gate.
export function roadEnds(r: WorldRoad): [RoadEnd, RoadEnd] {
  const end = (e: { city: string; gate: string }): RoadEnd => {
    const F = CATALOGUE.find((c) => c.id === e.city)!, plan = new CityPlan(F.key, STYLES[F.style as StyleId]);
    void plan.graph;
    return { plan, gate: e.gate };
  };
  return [end(r.a), end(r.b)];
}

// A road end's gate in its city's graph (numbered as the city file's gates are).
export function gateOf(e: RoadEnd) { return e.plan.graph.gates[cityByKey(e.plan.seed)!.gates.findIndex((g) => g?.id === e.gate)]!; }

// A road's map, drafted from today's rules (its items still to be recorded): `metres` from gate a
// to the hand-over into b (the old world file's length).
export function draftRoad(r: WorldRoad, metres: number, A: RoadEnd, B: RoadEnd): RoadMap {
  const key = r.key, h = (k: number) => hash3(0, k, 0, key, 0xc0a7);
  const PA = A.plan, PB = B.plan, gA = gateOf(A), gB = gateOf(B);
  const fileB = cityByKey(PB.seed)!, fwB = freewayGate(PB.seed);
  const toFreeway = B.gate === "g0" && !!fwB && !!r.oneway;
  const twoWay = !r.oneway;
  const A0 = twoWay ? END_STRAIGHT : STRAIGHT_OUT;   // (straight out of gate a)
  const SB = Math.max(A0 + 400, metres), L = SB + ARRIVE_LEN;
  const bioA = BIOME_OF[PA.style.id], bioB = BIOME_OF[PB.style.id];
  const pieces: RoadMapPiece[] = [];
  const add = (p: RoadPiece, way: 1 | -1 = 1) => { const q = { ...p, way } as RoadMapPiece; pieces.push(q); return q; };
  const dur = SB / 20;   // (about the drive's seconds at cruising pace: what the rules' odds go by)
  const at = (k: number) => k * SB;
  // The land: b's share at s, and the storybook's.
  const story = (s: number) => {
    const to = bioB === "storybook", from = bioA === "storybook";
    if (to === from) return to ? 1 : 0;
    const b0 = LAND_SEAM + 200, b1 = Math.max(b0 + 400, SB - 350);
    const k = THREE.MathUtils.clamp((to ? s - b0 : b1 - s) / (b1 - b0), 0, 1);
    return k * k * (1.6 - 0.6 * k);
  };
  // How much of a Victorian city at either end has crept in: none until PERIOD_FROM short of its
  // gate, all of it from PERIOD_TO short of it, so the carriage is whole before the arrival straight.
  const period = (s: number) => {
    const to = !!PB.style.victorian, from = !!PA.style.victorian;
    const k = (d: number) => smooth(THREE.MathUtils.clamp((PERIOD_FROM - d) / (PERIOD_FROM - PERIOD_TO), 0, 1));
    return Math.max(to ? k(SB - s) : 0, from ? k(s - LAND_SEAM) : 0);
  };
  const blend = (s: number) => {
    if (bioB === "storybook" && bioA !== "storybook") return story(s);
    if (bioA === "storybook" && bioB !== "storybook") return 1 - story(s);
    const b0 = Math.max(LAND_SEAM + 400, SB * 0.5 - 350), b1 = Math.max(b0 + 200, Math.min(SB - 350, SB * 0.5 + 350));
    return smooth(THREE.MathUtils.clamp((s - b0) / (b1 - b0), 0, 1));
  };
  const landAt = (s: number) => blend(s) < 0.5 ? bioA : bioB;
  // Set pieces (country.ts's old rules, from gate a): a truck stop, a ferry into a port, a rail
  // crossing, a work zone.
  let zone: [number, number] | null = null;
  if (dur > 200 && h(1) < 0.45) { const z0 = Math.max(900, SB * 0.85 * (0.15 + 0.1 * h(2))); if (z0 + 220 < SB * 0.85 - 700) zone = [z0, z0 + 220]; }
  const truckstopS = dur > 70 ? Math.max(900, at(0.3 + 0.2 * h(3))) : -1;
  if (truckstopS > 0 && truckstopS < SB - 600 && h(4) < 0.6) add({ kind: "truckstop", s: truckstopS, side: 1, len: 260, variant: 0 });
  let ferryS = -1;
  if (PB.style.id === "port" && dur > 260 && h(140) < 0.5) {
    for (const k of [0.5, 0.4, 0.62]) {
      const fs = Math.max(1200, at(k));
      if (fs + FERRY_LEN > SB - (toFreeway ? 2300 : 1100) || fs < 1200) continue;
      const ts = pieces.findIndex((p) => p.kind === "truckstop");
      if (ts >= 0 && fs < truckstopS + 260 + 300 && fs + FERRY_LEN > truckstopS - 300) pieces.splice(ts, 1);
      ferryS = fs;
      add({ kind: "ferry", s: fs, side: 1, len: FERRY_LEN, variant: 0, text: `FERRY TO ${PB.name.toUpperCase()}`, back: `FERRY TO ${PA.name.toUpperCase()}` });
      break;
    }
  }
  const railS = dur > 170 && h(5) < 0.7 ? at(0.68) : -1;
  const nearFerry = (x: number) => ferryS >= 0 && x > ferryS - 500 && x < ferryS + FERRY_LEN + 500;
  if (railS > 900 && railS < SB - 700 && !nearFerry(railS) && (truckstopS < 0 || Math.abs(railS - truckstopS) > 400)) add({ kind: "rail", s: railS, side: 1, len: 80, variant: 0 });
  if (zone) add({ kind: "construction", s: zone[0] - 60, side: 1, len: zone[1] - zone[0] + 140, variant: 0 });
  // Into a freeway city, nothing that stops the truck or sprawls by the road out where the freeway
  // and the flyover are.
  if (toFreeway) for (const p of [...pieces]) if (p.s + p.len > SB - 1150) pieces.splice(pieces.indexOf(p), 1);
  // Near a Victorian city, nothing of the modern road: no truck stop, rail crossing or work zone
  // where the period has crept in.
  for (const p of [...pieces]) if ((PB.style.victorian && p.s + p.len > SB - PERIOD_FROM - 100) || (PA.style.victorian && p.s < LAND_SEAM + PERIOD_FROM + 100)) pieces.splice(pieces.indexOf(p), 1);
  // Signs: leaving, the distance, and the welcome, for each way the road is driven.
  const signs = (way: 1 | -1, from: CityPlan, to: CityPlan, fw: boolean) => {
    add({ kind: "leave", s: LAND_SEAM + 60, side: 1, len: 40, variant: from.style.storybook ? 1 : from.style.victorian ? 2 : 0, text: `LEAVING ${from.name.toUpperCase()}` }, way);
    if (SB > 1700) add({ kind: "distance", s: LAND_SEAM + 460, side: 1, len: 40, variant: 0, text: `${to.name.toUpperCase()}  ${Math.max(1, Math.round((L - LAND_SEAM - 460) / 1609))} MI` }, way);
    add({ kind: "welcome", s: L - (fw ? 940 : 230), side: 1, len: 40, variant: to.style.storybook ? 1 : to.style.victorian ? 2 : 0, text: `WELCOME TO ${to.name.toUpperCase()}`, n: fw ? -12 : undefined }, way);   // (into a freeway city it stands on the left: the freeway is on the right)
  };
  signs(1, PA, PB, toFreeway);
  if (twoWay) signs(-1, PB, PA, false);
  if (toFreeway) {
    add({ kind: "fwsign", s: L - FW_ENTRANCE_SIGN, side: 1, len: 6, variant: 0, n: 8.8 });
    add({ kind: "fwsign", s: L - 200, side: 1, len: 6, variant: 1, n: FW_SHIFT + 3.7 });
    add({ kind: "fwsign", s: L + FW_OFF_D - 4, side: 1, len: 6, variant: 2, n: 3.7 });
  }
  // Farm country: a cattle crossing and a tractor to pass, now and then.
  const lo = 900, hi = SB - (toFreeway ? 1150 : 500);
  const farmAt = (x: number) => { const b = landAt(x); return b === "farmland" || b === "prairie"; };
  const farm: [PieceKind, number][] = [];
  if (dur > 150 && h(150) < 0.55) farm.push(["cattle", CATTLE_LEN]);
  if (dur > 200 && h(151) < 0.5) farm.push(["tractor", TRACTOR_LEN]);
  let fk = 0;
  for (const [kind, len] of farm) {
    for (let tries = 0; tries < 12 && hi - len > lo; tries++) {
      const fs = lo + h(160 + fk * 9 + tries) * (hi - len - lo);
      if (pieces.some((p) => fs < p.s + p.len + 300 && fs + len + 300 > p.s)) continue;
      if (!farmAt(fs - 200) || !farmAt(fs + len + 100)) continue;
      if (kind === "cattle") {
        const sideA: 1 | -1 = h(170) < 0.5 ? 1 : -1, n = 8 + Math.floor(h(171) * 4);
        add({ kind, s: fs, side: (-sideA) as 1 | -1, len, variant: n, text: "CATTLE XING" });
      } else add({ kind, s: fs, side: 1, len, variant: 0 });
      break;
    }
    fk++;
  }
  // The rest wherever there is room (never near the cities).
  const extras: [PieceKind, number][] = [["attraction", 120], ["weigh", WEIGH_LEN], ["fruit", 80], ["watertower", 90], ["bridge", 120], ["gas", 110]];
  for (let i = extras.length - 1; i > 0; i--) { const j = Math.floor(h(20 + i) * (i + 1)); [extras[i], extras[j]] = [extras[j], extras[i]]; }
  extras.unshift(["billboards", 320]);
  let k = 0;
  const own = () => pieces.filter((p) => p.way === 1);
  for (const [kind, len] of extras) {
    for (let tries = 0; tries < 8 && hi - len > lo; tries++) {
      const s = lo + h(40 + k * 9 + tries) * (hi - len - lo);
      const [a, b] = pieceSpan({ kind, s, side: 1, len, variant: 0 });
      if (own().some((p) => { const [c, d] = pieceSpan(p); return a < d + 120 && b + 120 > c; })) continue;
      if (kind === "weigh" && pieces.some((p) => p.kind === "truckstop" && Math.abs(p.s - s) < 800)) continue;
      add({ kind, s, side: kind === "gas" || kind === "fruit" ? (h(60 + k) < 0.5 ? 1 : -1) : kind === "weigh" ? 1 : h(60 + k) < 0.5 ? 1 : -1, len, variant: Math.floor(h(70 + k) * 4) });
      break;
    }
    k++;
  }
  // Tunnels through hilly land, and an overpass now and then.
  const hillyAt = (s: number) => { const b = landAt(s); return b !== "coastal" && HILLS[b] >= 0.55; };
  const more: [PieceKind, number][] = [];
  if (h(100) < 0.75) more.push(["tunnel", 140 + Math.floor(h(101) * 120)]);
  if (h(102) < 0.6) more.push(["overpass", 30]);
  if (h(103) < 0.3) more.push(["tunnel", 120 + Math.floor(h(104) * 80)]);
  for (const [kind, len] of more) {
    for (let tries = 0; tries < 10 && hi - len > lo; tries++) {
      const s = lo + h(110 + k * 9 + tries) * (hi - len - lo);
      if (own().some((p) => { const [g0, g1] = pieceGround(p); return s < g1 + 200 && s + len + 200 > g0; })) continue;
      if (kind === "tunnel" && !(hillyAt(s - CUT_RUN) && hillyAt(s + len + CUT_RUN))) continue;
      if (kind === "overpass" && landAt(s) === "coastal") continue;
      add({ kind, s, side: 1, len, variant: Math.floor(h(120 + k) * (kind === "tunnel" ? 3 : 2)) });
      break;
    }
    k++;
  }
  pieces.sort((a, b) => a.way - b.way || a.s - b.s);
  // (The land is level round every piece, those facing b to a too: in a to b's coordinates.)
  const mine = own(), grounds = pieces.map((p) => pieceGround(p.way === 1 ? p : { ...p, s: L - p.s - p.len, side: -p.side as 1 | -1 }));
  // The centre line: straight out of gate a, gentle curves, straight into gate b; the curves turn
  // the road onto b's way in.
  const n = Math.ceil((L + (toFreeway ? FW_OFF_D : 0) + 2 * ROAD_PAD) / ROAD_DS) + 1, i0 = ROAD_PAD / ROAD_DS;
  const sIn = toFreeway ? Math.max(STRAIGHT_IN, Math.min(FW_STRAIGHT_IN, SB - A0 - TURN_ROOM)) : STRAIGHT_IN, short = toFreeway && sIn < FW_STRAIGHT_IN;
  const kap = new Float64Array(n), msk = new Float64Array(n);
  const Am = [0.0011 + 0.0011 * h(80), 0.0007 * h(81)], W = [2 * Math.PI / (700 + 500 * h(82)), 2 * Math.PI / (260 + 200 * h(83))], P = [h(84) * 6.3, h(85) * 6.3];
  let base = 0, wsum = 0;
  for (let i = i0; i < n; i++) {
    const s = (i - i0) * ROAD_DS;
    let mask = smooth(THREE.MathUtils.clamp((s - A0) / 120, 0, 1)) * smooth(THREE.MathUtils.clamp((SB - sIn - s) / 120, 0, 1));
    for (const p of mine) {
      if (p.kind === "billboards" || p.kind === "leave" || p.kind === "distance" || p.kind === "welcome" || (short && p.kind === "fwsign")) continue;
      const d = Math.max(p.s - 150 - s, s - (p.s + p.len + 150), 0);
      mask = Math.min(mask, smooth(Math.min(1, d / 120)));
    }
    msk[i] = mask;
    kap[i] = (Am[0] * Math.cos(W[0] * s + P[0]) + Am[1] * Math.cos(W[1] * s + P[1])) * mask;
    base += kap[i] * ROAD_DS; wsum += mask * ROAD_DS;
  }
  const outH = gateEnd(gA).h, inH = ((gB.dir + 2) % 4) * Math.PI / 2;
  const turn = Math.atan2(Math.sin(inH - outH), Math.cos(inH - outH)), corr = wsum > 1 ? (turn - base) / wsum : 0;
  const H = new Float64Array(n);
  let hd = 0;
  for (let i = i0; i < n; i++) { H[i] = hd; hd += (kap[i] + corr * msk[i]) * ROAD_DS; }
  // (Placed as a drive out of gate a has it: the city's own coordinates, to find its freeways.)
  const X = new Float64Array(n), Z = new Float64Array(n);
  for (let i = i0 + 1; i < n; i++) { X[i] = X[i - 1] + Math.cos(H[i]) * ROAD_DS; Z[i] = Z[i - 1] - Math.sin(H[i]) * ROAD_DS; }
  for (let i = i0 - 1; i >= 0; i--) { X[i] = X[i + 1] - Math.cos(H[i + 1]) * ROAD_DS; Z[i] = Z[i + 1] + Math.sin(H[i + 1]) * ROAD_DS; }
  const e = gateEnd(gA), fc = Math.cos(e.h), fs = Math.sin(e.h);
  const world = (i: number): [number, number] => [e.x + X[i] * fc + Z[i] * fs, e.z - X[i] * fs + Z[i] * fc];
  const fwPts: number[][] = [];
  const fwA = freewayGate(PA.seed);
  if (fwA) fwPts.push(Frame.ofCitySeed(PA.seed, PA.name, false, fwA, PA.outline.sea !== null, PA.fwCurve).centreLine(8));
  const iL = i0 + Math.round(L / ROAD_DS), [ex, ez] = world(iL);
  if (toFreeway) {
    const F = new Frame(ex, ez, e.h + H[iL]); F.merge = PB.freewayMerge;
    fwPts.push(F.label(PB.seed, PB.name).centreLine(8));
  } else if (fwB) {
    const eb = gateEnd(gB);
    fwPts.push(Frame.ofCitySeed(PB.seed, PB.name, false, fwB, PB.outline.sea !== null, PB.fwCurve).centreLine(8).map((c, j) => c + (j % 2 ? ez - eb.z : ex - eb.x)));
  }
  const fwDist = (x: number, z: number) => {
    let best = Infinity;
    for (const p of fwPts) for (let j = 0; j < p.length; j += 2) best = Math.min(best, (p[j] - x) ** 2 + (p[j + 1] - z) ** 2);
    return Math.sqrt(best);
  };
  const nearFw = new Uint8Array(n);
  if (fwPts.length) for (let i = 0; i < n; i++) { const [x, z] = world(i); if (fwDist(x, z) < 45) nearFw[i] = 1; }
  // Heights: two sets of rounded hills, level through every set piece and at both ends.
  const Y = new Float64Array(n), SM = new Float64Array(n), U = new Float64Array(n);
  let u = 0;
  for (let i = 0; i < n; i++) {
    const s = (i - i0) * ROAD_DS;
    let m = smooth(THREE.MathUtils.clamp((s - A0) / HILL_EASE, 0, 1)) * smooth(THREE.MathUtils.clamp((SB - (toFreeway ? FW_FLAT : STRAIGHT_IN) - s) / HILL_EASE, 0, 1));
    for (const [g0, g1] of grounds) m = Math.min(m, smooth(Math.min(1, Math.max(g0 - HILL_FLAT - s, s - (g1 + HILL_FLAT), 0) / HILL_EASE)));
    if (fwPts.length) { const [x, z] = world(i); m = Math.min(m, smooth(Math.min(1, Math.max(0, fwDist(x, z) - 40) / HILL_EASE))); }
    U[i] = u; SM[i] = m; u += m * ROAD_DS;
  }
  const Ut = u, hilly = 0.45 + 0.75 * h(86);
  if (Ut > 500) {
    const k1 = Math.max(1, Math.round(Ut / (1000 + 900 * h(87)))), k2 = Math.max(2, Math.round(Ut / (330 + 260 * h(88))));
    const A1 = 16 * hilly, A2 = (4 + 4 * h(89)) * hilly, a0 = HILLS[bioA], a1 = HILLS[bioB];
    let steep = 0;
    for (let i = 0; i < n; i++) {
      const w = U[i] / Ut, amp = a0 + (a1 - a0) * smooth(THREE.MathUtils.clamp((w - 0.35) / 0.3, 0, 1));
      Y[i] = amp * (A1 * (1 - Math.cos(2 * Math.PI * k1 * w)) / 2 + A2 * (1 - Math.cos(2 * Math.PI * k2 * w)) / 2);
      if (i > 0) steep = Math.max(steep, Math.abs(Y[i] - Y[i - 1]) / ROAD_DS);
    }
    if (steep > MAX_GRADE) for (let i = 0; i < n; i++) Y[i] *= MAX_GRADE / steep;
    // Down to the cities' level wherever the road meets a freeway out in the country.
    if (fwPts.length) {
      const along = new Float64Array(n).fill(Infinity);
      for (let i = 0; i < n; i++) if (nearFw[i]) along[i] = 0;
      const spread = () => {
        for (let i = 1; i < n; i++) along[i] = Math.min(along[i], along[i - 1] + ROAD_DS);
        for (let i = n - 2; i >= 0; i--) along[i] = Math.min(along[i], along[i + 1] + ROAD_DS);
      };
      spread();
      for (let again = true; again;) {
        again = false;
        for (const [g0, g1] of grounds) {
          const j0 = Math.max(0, Math.floor((g0 - HILL_FLAT) / ROAD_DS) + i0), j1 = Math.min(n - 1, Math.ceil((g1 + HILL_FLAT) / ROAD_DS) + i0);
          let lo2 = Infinity, hi2 = 0; for (let i = j0; i <= j1; i++) { lo2 = Math.min(lo2, along[i]); hi2 = Math.max(hi2, along[i]); }
          if (lo2 < 800 && hi2 > 0) { for (let i = j0; i <= j1; i++) along[i] = 0; again = true; }
        }
        if (again) spread();
      }
      for (let i = 0; i < n; i++) Y[i] = Math.min(Y[i], Math.max(0, along[i] - 10) * MAX_GRADE * 0.9);
    }
  }
  for (let i = 0; i < n; i++) { const s = (i - i0) * ROAD_DS, b = blend(s); SM[i] *= hilly * (HILLS[bioA] + (HILLS[bioB] - HILLS[bioA]) * b); }
  // The coast: on a coastal land's left looking from a to b, fading out towards a city that is not
  // on the sea there; on the right when the sea is a's and the road meets it at a's way in (g0),
  // where a's shore bends in to meet it (outline.ts), unless b's does too.
  const seaA = PA.outline.sea !== null, seaB = PB.outline.sea !== null;
  const bendA = seaA && A.gate === "g0", bendB = seaB && B.gate === "g0";
  const side: 1 | -1 = bendA && !bendB ? 1 : -1;
  const cA = bioA === "coastal" ? 1 : 0, cB = bioB === "coastal" ? 1 : 0;
  const coastAt = (s: number) => {
    let land = cA + (cB - cA) * blend(s);
    if (side < 0) {
      if (seaB && PB.style.id === "port") land = Math.max(land, smooth(THREE.MathUtils.clamp((s - (L - 1400)) / 400, 0, 1)));
      const f = Math.min(s / COAST_FADE, seaB ? 1 : (L - s) / COAST_FADE);
      return land * smooth(THREE.MathUtils.clamp(f, 0, 1));
    }
    if (PA.style.id === "port") land = Math.max(land, smooth(THREE.MathUtils.clamp((1400 - s) / 400, 0, 1)));
    return land * smooth(THREE.MathUtils.clamp((L - s) / COAST_FADE, 0, 1));
  };
  const nl = Math.ceil(L / LAND_DS) + 1, r3 = (x: number) => Math.round(x * 1000) / 1000;
  const blendS = Array.from({ length: nl }, (_, j) => r3(blend(j * LAND_DS)));
  const storyS = Array.from({ length: nl }, (_, j) => r3(story(j * LAND_DS)));
  const periodS = Array.from({ length: nl }, (_, j) => r3(period(j * LAND_DS)));
  const coastS = Array.from({ length: nl }, (_, j) => r3(coastAt(j * LAND_DS)));
  void fileB;
  return {
    id: r.id, key, length: L, ...(toFreeway ? { freeway: true as const } : {}),
    heading: Array.from(H, (x) => Math.round(x * 1e6) / 1e6), height: Array.from(Y, (y) => Math.round(y * 100)), hill: Array.from(SM, r3),
    blend: blendS, ...(storyS.some((x) => x > 0) ? { story: storyS } : {}), ...(periodS.some((x) => x > 0) ? { period: periodS } : {}), ...(coastS.some((x) => x > 0) ? { coast: coastS, coastSide: side } : {}),
    biomes: [bioA, bioB] as [BiomeId, BiomeId],
    pieces: pieces.map((p) => ({ ...p, s: Math.round(p.s * 100) / 100 })),
    items: { trees: [], rocks: [], ponds: [], turbines: [], pylons: [], farms: [], cows: [], poles: [], fences: [] },
  };
}
