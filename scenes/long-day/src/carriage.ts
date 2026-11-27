// The horse-drawn carriages the trucks become in and near the Victorian city (truck.ts carriage).
// Here are what a carriage adds to a truck, worked out from its model's spec, and the team that
// draws it. truck.ts makeCarriage morphs the truck itself (its cab cut down to an open coachman's
// seat, its trim recoloured) and grows these parts.
//
// What each model becomes: a box truck a panelled van, lettered on its sides, with a roof rail and a
// canopy over the coachman; the flatbed a dray with stakes; the tractor and its trailer a pair on a
// pole, the driver on a forecarriage box and the trailer a pantechnicon. Each has a dashboard, a
// footboard and a bench where the truck's seats were, carriage lamps by the seat and a red lamp
// behind, spoked wheels with iron tyres at the truck's axles, and its team in shafts or on a pole.
//
// The team (TeamLayout) stands ahead of the dashboard, turning with the front wheels about the front
// axle like a forecarriage. Where the horses reach more than TEAM_SLACK past the truck's nose, the
// nose is moved on by `reach` in the Victorian city (truck.ts truckExtents), so every stop short of
// something keeps the horses' noses clear of it.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { HORSE, HORSE_PARTS, horseParts, poseHorse } from "./horse.ts";
import type { HorseLook, HorseState } from "./horse.ts";
import type { TruckSpec } from "./truck.ts";

// The carriages' colours: a green body with darker mouldings, gold lining, a cream board with red
// lettering, vermilion wheels, underframe and shafts, black ironwork, and leather.
export const CC = {
  van: 0x2f5a3c, vanDark: 0x1f3e2a, gold: 0xd8ae4e, board: 0xeadfba, letter: 0x8a1e18,
  under: 0xa8432c, iron: 0x1e1b19, roof: 0x34322f, leather: 0x2e1d14, brass: 0xc9a04a, wood: 0x8c6a44, woodDark: 0x5a4028,
  stake: 0x6a4a2c, lampOff: 0x5a4a26, lampOn: 0xffe2a0,
};
// How far past the truck's nose its team may reach with no change to the nose (m): about what the
// stop-short checks leave clear ahead of it anyway.
export const TEAM_SLACK = 0.3;

// A model's carriage: where its dashboard stands (the floor ends there, and the horses stand ahead),
// the front axle the team turns about, each horse's withers (x, z) in the truck's frame and its
// scale, whether it is a pair on a pole, the tips of its shafts or pole in the team's frame (x from
// the front axle), how far the team reaches past the nose (0 within TEAM_SLACK), and the spoked
// wheels' radii as shares of the truck's.
export interface TeamLayout {
  dash: number; pivot: number; horses: [number, number][]; scale: number; pole: boolean;
  rear: [number, number]; tip: [number, number]; reach: number; front: number; back: number;
}
const TEAM_LAYOUTS = new Map<TruckSpec, TeamLayout>();
export function teamLayout(s: TruckSpec): TeamLayout {
  let L = TEAM_LAYOUTS.get(s);
  if (L) return L;
  const pole = s.cab === "daycab", scale = 0.9, front = 0.82, back = 1.0;
  // (The dashboard stands far enough ahead of the seat for the coachman's feet and the climb's
  // footholds (crew.ts cabSpots), behind the door's front, so the climb's grab handles stay.)
  const dash = s.cabFront - 0.5;
  // (The team stands between the front wheels' tracks, a pair as well as a single horse, since it
  // turns with them. A pair's rumps are just ahead of the front axle, with the splinter bar on the
  // forecarriage behind them: standing any further on, its noses reach past a tractor's by over a
  // metre, and the truck stood minutes beside traffic at junctions.)
  const rump = pole ? Math.max(dash + 0.08, s.frontAxle + 0.1) : dash + 0.08;
  const wx = rump + HORSE.rump * scale, nose = wx + HORSE.front * scale;
  const over = nose - (s.noseFront + 0.05), reach = over > TEAM_SLACK ? Math.ceil(over * 20) / 20 : 0;
  const pivot = s.frontAxle;
  const horses: [number, number][] = pole ? [[wx, -0.4], [wx, 0.4]] : [[wx, 0]];
  const rear: [number, number] = [pole ? 0.02 : dash - 0.02 - pivot, pole ? 0.72 : 0.9];
  const tip: [number, number] = pole ? [wx + 0.62 * scale - pivot, 1.02 * scale] : [wx + 0.42 * scale - pivot, 1.15 * scale + 0.04];
  L = { dash, pivot, horses, scale, pole, rear, tip, reach, front, back };
  TEAM_LAYOUTS.set(s, L);
  return L;
}

// ---- a few shapes --------------------------------------------------------------------------------
type CarV3 = [number, number, number];
// A straight rod or strap from A to B, `w` across (z when level) and `t` thick.
export function carRod(b: Batch, A: CarV3, B: CarV3, w: number, t: number, color: number) {
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], len = Math.hypot(dx, dy, dz) || 1e-3;
  const rz = Math.asin(THREE.MathUtils.clamp(dy / len, -1, 1)), ry = Math.atan2(-dz, dx);
  b.boxR((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2, len, t, w, color, 0, ry, rz);
}

// A spoked wooden wheel of radius 1 with an iron tyre, its axis along z, its width real (the truck
// scales it as it does its own wheels: truck.ts update). Twelve spokes, so its turning reads.
export function spokedWheel(b: Batch) {
  const n = 18;
  for (let k = 0; k < n; k++) {
    const a = (k + 0.5) / n * Math.PI * 2, len = 2 * Math.sin(Math.PI / n) * 0.985;
    b.boxR(Math.cos(a) * 0.97, Math.sin(a) * 0.97, 0, 0.06, len, 0.075, CC.iron, 0, 0, a);
    b.boxR(Math.cos(a) * 0.87, Math.sin(a) * 0.87, 0, 0.15, len * 0.9, 0.065, CC.under, 0, 0, a);
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    b.boxR(Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0, 0.66, 0.07, 0.045, CC.under, 0, 0, a);
  }
  b.cyl(0, 0, 0, 0.19, 0.2, CC.under, 10, Math.PI / 2);
  b.cyl(0, 0, 0, 0.12, 0.26, CC.brass, 8, Math.PI / 2);
}

// ---- lettering -----------------------------------------------------------------------------------
// A sign-writer's letters, 5 by 7 cells, each row's runs of cells drawn as one block.
const CAR_GLYPHS: Record<string, string[]> = {
  A: [" ### ", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"], C: [" ####", "#    ", "#    ", "#    ", "#    ", "#    ", " ####"],
  D: ["#### ", "#   #", "#   #", "#   #", "#   #", "#   #", "#### "], E: ["#####", "#    ", "#    ", "#### ", "#    ", "#    ", "#####"],
  H: ["#   #", "#   #", "#   #", "#####", "#   #", "#   #", "#   #"], I: [" ### ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", " ### "],
  N: ["#   #", "##  #", "# # #", "#  ##", "#   #", "#   #", "#   #"], O: [" ### ", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "],
  P: ["#### ", "#   #", "#   #", "#### ", "#    ", "#    ", "#    "], R: ["#### ", "#   #", "#   #", "#### ", "# #  ", "#  # ", "#   #"],
  S: [" ####", "#    ", "#    ", " ### ", "    #", "    #", "#### "], T: ["#####", "  #  ", "  #  ", "  #  ", "  #  ", "  #  ", "  #  "],
  U: ["#   #", "#   #", "#   #", "#   #", "#   #", "#   #", " ### "], Y: ["#   #", "#   #", " # # ", "  #  ", "  #  ", "  #  ", "  #  "],
  L: ["#    ", "#    ", "#    ", "#    ", "#    ", "#    ", "#####"], V: ["#   #", "#   #", "#   #", "#   #", "#   #", " # # ", "  #  "],
  M: ["#   #", "## ##", "# # #", "#   #", "#   #", "#   #", "#   #"], "&": [" ##  ", "#  # ", "#  # ", " ##  ", "# # #", "#  # ", " ## #"],
  ".": ["     ", "     ", "     ", "     ", "     ", "     ", "  #  "], " ": ["     ", "     ", "     ", "     ", "     ", "     ", "     "],
};
// letters writes `text` centred on (x, y) on a side of the van facing `face` (+1: +z, -1: -z) at
// z, its letters `h` tall, standing `t` proud.
export function carLetters(b: Batch, text: string, x: number, y: number, z: number, face: 1 | -1, h: number, t: number, color: number) {
  const p = h / 7, adv = 6 * p, w = text.length * adv - p;
  for (let i = 0; i < text.length; i++) {
    const g = CAR_GLYPHS[text[i]] ?? CAR_GLYPHS[" "];
    const lx = -w / 2 + i * adv;
    for (let r = 0; r < 7; r++) {
      const row = g[r];
      for (let c = 0; c < 5;) {
        if (row[c] !== "#") { c++; continue; }
        let e = c; while (e < 5 && row[e] === "#") e++;
        const u0 = lx + c * p, u1 = lx + e * p, yy = y + h / 2 - (r + 1) * p;
        // (Read along +x from +z, along -x from -z.)
        const xa = x + face * u0, xb = x + face * u1;
        b.span(Math.min(xa, xb), yy, z, Math.max(xa, xb), yy + p, z + face * t, color);
        c = e;
      }
    }
  }
}

// ---- the grown parts -----------------------------------------------------------------------------
// seat adds the coachman's bench, its footboard and dashboard, and the carriage lamps by it
// (their lenses in `lens`), in the truck's frame. `belt` is the cab's belt line, where the cut-down
// cab's sides end.
export function seatParts(b: Batch, lens: Batch, s: TruckSpec, L: TeamLayout, belt: number) {
  const xf = s.cabFront, yf = s.cabFloor, hw = s.cabHW, D = L.dash;
  b.span(xf - 1.56, yf, -hw + 0.09, xf - 0.95, yf + 0.36, hw - 0.09, CC.vanDark);            // the seat box
  b.span(xf - 1.49, yf + 0.36, -hw + 0.11, xf - 0.96, yf + 0.495, hw - 0.11, CC.leather);   // its cushion
  b.span(xf - 1.6, yf + 0.36, -hw + 0.11, xf - 1.4, yf + 0.98, hw - 0.11, CC.leather);       // its back
  b.cyl(xf - 1.5, yf + 1.0, 0, 0.025, 2 * hw - 0.2, CC.brass, 6, Math.PI / 2);
  for (const z of [-1, 1]) b.span(xf - 1.6, yf + 0.36, z * (hw - 0.11), xf - 0.95, yf + 0.72, z * (hw - 0.09), CC.vanDark);   // its arms
  carRod(b, [xf - 0.93, yf + 0.03, 0], [D - 0.06, yf + 0.2, 0], 2 * hw - 0.2, 0.04, CC.woodDark);   // the footboard
  b.span(D - 0.05, yf - 0.12, -hw + 0.07, D, yf + 0.66, hw - 0.07, CC.leather);               // the dashboard
  // A gold line round the panels of the cut-down cab's sides (on the street side behind the door
  // only: the door swings).
  for (const z of [-1, 1]) {
    const xa = s.cabBack + 0.14, xb = z > 0 ? s.cabFront - 0.14 : s.cabFront - 0.07 - s.doorLen - 0.1, ya = yf + 0.12, yb = belt - 0.12, o = z * (hw + 0.012);
    for (const [p0, p1, q0, q1] of [[xa, xb, ya, ya + 0.025], [xa, xb, yb - 0.025, yb], [xa, xa + 0.025, ya, yb], [xb - 0.025, xb, ya, yb]])
      b.span(p0, q0, Math.min(z * hw, o), p1, q1, Math.max(z * hw, o), CC.gold);
  }
  b.cyl(D - 0.025, yf + 0.68, 0, 0.022, 2 * hw - 0.1, CC.brass, 6, Math.PI / 2);
  // The lamps, on brackets off the sides at the dashboard: black boxes with brass tops, glazed ahead
  // and to the side.
  for (const z of [-1, 1]) {
    const x = D - 0.06, y = belt + 0.24, zz = z * (hw + 0.12);
    carRod(b, [x, belt - 0.04, z * (hw - 0.01)], [x, y - 0.14, zz], 0.04, 0.03, CC.brass);
    b.span(x - 0.08, y - 0.14, zz - 0.07, x + 0.08, y + 0.12, zz + 0.07, CC.iron);
    b.cone(x, y + 0.17, zz, 0.075, 0.1, CC.brass, 6);
    b.cyl(x, y - 0.155, zz, 0.06, 0.03, CC.brass, 6);
    lens.span(x + 0.08, y - 0.08, zz - 0.05, x + 0.095, y + 0.07, zz + 0.05);
    lens.span(x - 0.05, y - 0.08, zz + z * 0.07, x + 0.05, y + 0.07, zz + z * 0.085);
  }
}

// rearLamp adds the small red lamp on the back's street-side corner at (x, y, z): its lens in `lens`.
export function rearLamp(b: Batch, lens: Batch, x: number, y: number, z: number) {
  b.span(x - 0.02, y - 0.09, z - 0.06, x + 0.1, y + 0.08, z + 0.06, CC.iron);
  b.cone(x + 0.04, y + 0.12, z, 0.06, 0.07, CC.brass, 6);
  lens.span(x - 0.035, y - 0.05, z - 0.04, x - 0.02, y + 0.04, z + 0.04);
}

// vanTrim panels a box body's sides (the kerb side, +z, into `kerb`; the street side into `street`)
// with mouldings, a cream board lettered `top` above the waist and `low` in gilt below it, and gives
// it a roof with a rail round it, its canopy run `canopy` on ahead over the coachman.
export interface BoxDims { x0: number; x1: number; floor: number; top: number; hw: number }
export function vanTrim(kerb: Batch, street: Batch, c: BoxDims, top: string, low: string, canopy: number) {
  const { x0, x1, floor, hw } = c, yt = c.top - 0.06, yb = floor - 0.12;
  const wy = floor + (c.top - floor) * 0.4;
  for (const face of [1, -1] as const) {
    const b = face > 0 ? kerb : street, z0 = face * (hw + 0.002), d = 0.03, at = (o: number) => face * (hw + 0.002 + o);
    const rail = (ya: number, yb2: number) => b.span(x0 + 0.02, ya, Math.min(z0, at(d)), x1 - 0.02, yb2, Math.max(z0, at(d)), CC.vanDark);
    rail(yb, yb + 0.12); rail(wy - 0.05, wy + 0.05); rail(yt - 0.16, yt);
    // (Stiles below the waist into panels a metre and a bit long, and at the ends above it.)
    const n = Math.max(2, Math.round((x1 - x0) / 1.25));
    for (let k = 0; k <= n; k++) {
      const x = x0 + 0.06 + (x1 - x0 - 0.12) * k / n;
      b.span(x - 0.045, yb + 0.12, Math.min(z0, at(d)), x + 0.045, wy - 0.05, Math.max(z0, at(d)), CC.vanDark);
      if (k === 0 || k === n) b.span(x - 0.045, wy + 0.05, Math.min(z0, at(d)), x + 0.045, yt - 0.16, Math.max(z0, at(d)), CC.vanDark);
      // (A gold line round each lower panel.)
      if (k < n) {
        const xa = x + 0.1, xb = x0 + 0.06 + (x1 - x0 - 0.12) * (k + 1) / n - 0.1, ya = yb + 0.2, yc = wy - 0.13;
        for (const [p0, p1, q0, q1] of [[xa, xb, ya, ya + 0.025], [xa, xb, yc - 0.025, yc], [xa, xa + 0.025, ya, yc], [xb - 0.025, xb, ya, yc]])
          b.span(p0, q0, Math.min(z0, at(0.012)), p1, q1, Math.max(z0, at(0.012)), CC.gold);
      }
    }
    // The board, gold edged, and its lettering; the lower lettering gilt on the panels.
    const bx0 = x0 + 0.2, bx1 = x1 - 0.2, by0 = wy + 0.13, by1 = yt - 0.24;
    b.span(bx0, by0, Math.min(z0, at(0.016)), bx1, by1, Math.max(z0, at(0.016)), CC.board);
    for (const [p0, p1, q0, q1] of [[bx0, bx1, by0 - 0.04, by0], [bx0, bx1, by1, by1 + 0.04], [bx0 - 0.04, bx0, by0 - 0.04, by1 + 0.04], [bx1, bx1 + 0.04, by0 - 0.04, by1 + 0.04]])
      b.span(p0, q0, Math.min(z0, at(0.022)), p1, q1, Math.max(z0, at(0.022)), CC.gold);
    const h1 = Math.min((by1 - by0) * 0.62, (bx1 - bx0) / (top.length * 6 / 7) * 0.9);
    carLetters(b, top, (x0 + x1) / 2, (by0 + by1) / 2, at(0.016), face, h1, 0.012, CC.letter);
    const h2 = Math.min((wy - yb - 0.3) * 0.5, (x1 - x0 - 0.6) / (low.length * 6 / 7) * 0.8);
    carLetters(b, low, (x0 + x1) / 2, (yb + 0.12 + wy - 0.05) / 2, at(d), face, h2, 0.012, CC.gold);
  }
  // The roof: an oilcloth top overhanging the sides a little, run on ahead as a canopy on two
  // brackets, and a rail round it on posts.
  const rt = c.top + 0.05, xr1 = x1 + 0.05 + canopy;
  kerb.span(x0 - 0.06, c.top, -hw - 0.06, xr1, rt, hw + 0.06, CC.roof);
  if (canopy > 0) for (const z of [-1, 1]) carRod(kerb, [x1 + 0.01, c.top - 0.55, z * (hw - 0.12)], [xr1 - 0.08, c.top - 0.005, z * (hw - 0.12)], 0.05, 0.05, CC.iron);
  for (const z of [-1, 1]) {
    for (let x = x0 + 0.1; x <= xr1 - 0.05; x += 0.7) kerb.span(x - 0.02, rt, z * (hw + 0.02) - 0.02, x + 0.02, rt + 0.16, z * (hw + 0.02) + 0.02, CC.iron);
    kerb.span(x0 + 0.08, rt + 0.16, z * (hw + 0.02) - 0.025, xr1 - 0.03, rt + 0.2, z * (hw + 0.02) + 0.025, CC.brass);
  }
  for (const x of [x0 + 0.08, xr1 - 0.05]) kerb.span(x - 0.025, rt + 0.16, -hw - 0.045, x + 0.025, rt + 0.2, hw + 0.045, CC.brass);
}

// drayParts stands stakes along a flatbed's sides on a low rave board, lettered.
export function drayParts(b: Batch, c: BoxDims) {
  const { x0, x1, floor: y, hw } = c;
  for (const z of [-1, 1]) {
    b.span(x0 + 0.05, y - 0.02, z * (hw + 0.065), x1 - 0.12, y + 0.2, z * (hw + 0.035), CC.wood);
    const n = Math.round((x1 - x0) / 0.75);
    for (let k = 0; k <= n; k++) {
      const x = x0 + 0.1 + (x1 - x0 - 0.3) * k / n;
      b.span(x - 0.035, y - 0.24, z * (hw + 0.035), x + 0.035, y + 0.62, z * (hw + 0.105), CC.stake);
      b.span(x - 0.045, y + 0.03, z * (hw + 0.03), x + 0.045, y + 0.08, z * (hw + 0.11), CC.iron);
    }
    carLetters(b, "RYDER & CO.", (x0 + x1) / 2, y + 0.09, z * (hw + 0.065), z as 1 | -1, 0.15, 0.01, CC.board);
  }
}

// teamGear builds the forecarriage's axle bed (`axle`), the shafts or pole (`shafts`) and the
// harness between the horses and them, with the reins to the coachman's hands (`harness`), in the
// team's frame (x forward from the front axle). `hands` is where the reins end, in that frame.
export function teamGear(axle: Batch, shafts: Batch, harness: Batch, s: TruckSpec, L: TeamLayout, hands: CarV3) {
  const sc = L.scale, P = L.pivot, [rx, ry] = L.rear, [tx, ty] = L.tip;
  axle.span(-0.08, s.wheelR * L.front + 0.08, -(s.frontZ - 0.08), 0.08, s.wheelR * L.front + 0.24, s.frontZ - 0.08, CC.under);
  const STRAP = 0x1c1612;
  if (!L.pole) {
    const [wx] = L.horses[0], tug = wx - 0.16 * sc - P, tz = 0.35 * sc + 0.03;
    // The shafts: from under the dashboard out past the horse's sides, through its saddle's tugs,
    // to their tips at its shoulders, and a bar across their back ends.
    for (const z of [-1, 1]) {
      carRod(shafts, [rx, ry, z * 0.55], [tug, 1.1 * sc, z * tz], 0.07, 0.07, CC.under);
      carRod(shafts, [tug, 1.1 * sc, z * tz], [tx, ty, z * (tz - 0.04)], 0.06, 0.06, CC.under);
      shafts.cyl(tx + 0.02, ty, z * (tz - 0.045), 0.035, 0.05, CC.brass, 6, Math.PI / 2);
    }
    carRod(shafts, [rx + 0.04, ry - 0.02, -0.6], [rx + 0.04, ry - 0.02, 0.6], 0.08, 0.08, CC.under);
    for (const z of [-1, 1]) {
      // Traces from the hames back to the bar, and the breeching's straps out to the shafts.
      carRod(harness, [wx + 0.46 * sc - P, 1.41 * sc, z * 0.29 * sc], [rx + 0.1, ry + 0.02, z * 0.5], 0.04, 0.015, STRAP);
      const bx = wx - 1.0 * sc - P, f = (bx - rx) / (tug - rx);
      carRod(harness, [bx, 1.12 * sc, z * 0.3 * sc], [bx, ry + (1.1 * sc - ry) * f + 0.02, z * (0.55 + (tz - 0.55) * f)], 0.04, 0.015, STRAP);
    }
  } else {
    // The pole between the pair, out to a neck yoke strapped to their collars; the splinter bar
    // across the forecarriage with a swingletree for each horse, and their traces back to it.
    carRod(shafts, [rx, ry, 0], [tx, ty, 0], 0.09, 0.09, CC.under);
    carRod(shafts, [tx - 0.06, ty - 0.02, -0.62], [tx - 0.06, ty - 0.02, 0.62], 0.06, 0.06, CC.under);
    carRod(axle, [rx - 0.05, ry + 0.05, -0.95], [rx - 0.05, ry + 0.05, 0.95], 0.08, 0.08, CC.under);
    for (const [wx, hz] of L.horses) {
      carRod(axle, [rx + 0.02, ry + 0.06, hz - 0.3], [rx + 0.02, ry + 0.06, hz + 0.3], 0.06, 0.05, CC.under);
      carRod(harness, [tx - 0.06, ty - 0.02, Math.sign(hz) * 0.55], [wx + 0.56 * sc - P, 1.13 * sc, hz * 0.85], 0.04, 0.02, STRAP);
      for (const z of [-1, 1]) carRod(harness, [wx + 0.46 * sc - P, 1.41 * sc, hz + z * 0.29 * sc], [rx + 0.04, ry + 0.07, hz + z * 0.28], 0.04, 0.015, STRAP);
    }
  }
  // The reins, two to a horse, from its hames' terrets to the coachman's hands.
  for (const [wx, hz] of L.horses) for (const z of [-1, 1])
    carRod(harness, [wx + 0.3 * sc - P, 1.78 * sc, hz + z * 0.1 * sc], hands, 0.018, 0.008, STRAP);
}

// ---- the team ------------------------------------------------------------------------------------
// The horses' parts' geometry, one set per look, shared by every team (never disposed).
const TEAM_HORSE_GEO = new Map<HorseLook, THREE.BufferGeometry[]>();
function horseGeometry(look: HorseLook) {
  let g = TEAM_HORSE_GEO.get(look);
  if (!g) {
    g = horseParts(look).map((p) => { const b = new Batch(); p(b); const geo = b.build(new THREE.MeshBasicMaterial())!.geometry; geo.userData.shared = true; return geo; });
    TEAM_HORSE_GEO.set(look, g);
  }
  return g;
}
// A team of `n` horses of one look: a part of each as one instanced mesh (left out of baked
// fleets: fleet.ts). `pose` places horse j from its base (its frame in the meshes' parent's).
export class HorseTeam {
  readonly meshes: THREE.InstancedMesh[];
  private out = Array.from({ length: HORSE_PARTS }, () => new THREE.Matrix4());
  private st: HorseState = { odo: 0, v: 0, t: 0, seed: 0 };
  constructor(material: THREE.Material, look: HorseLook, n: number) {
    this.meshes = horseGeometry(look).map((g) => {
      const m = new THREE.InstancedMesh(g, material, n);
      m.frustumCulled = false; m.userData.noBake = true;
      return m;
    });
  }
  pose(j: number, base: THREE.Matrix4, odo: number, v: number, t: number, seed: number) {
    const st = this.st; st.odo = odo; st.v = v; st.t = t; st.seed = seed;
    poseHorse(st, base, this.out, 0);
    for (let p = 0; p < HORSE_PARTS; p++) this.meshes[p].setMatrixAt(j, this.out[p]);
  }
  commit() { for (const m of this.meshes) m.instanceMatrix.needsUpdate = true; }
  set visible(on: boolean) { for (const m of this.meshes) m.visible = on; }
}
