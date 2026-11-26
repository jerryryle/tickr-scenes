// The driver's work at a stop, as a fixed plan of timed chores. It is a pure function of the
// stop and the truck, so the journey can time the dwell from it, the driver animation can play
// it, and a restored journey replays exactly the same moment.
//
// Positions are in the parked truck's rear-axle frame: x forward, z to the right (the facility
// side), y up. At the kerb the driver gets out on the left (street side), walks to the back,
// opens up, makes one trip per load between the truck and the facility's door at the kerb edge
// behind the truck, closes up and climbs back in. The loader decides the route in and out of
// the bed: a walk ramp (box trucks), a lift gate (reefer), the flatbed's deck side, or the
// trailer's swing doors. At a loading dock the truck's rear is against the platform: the driver
// climbs the dock stairs, works from the platform through the open door, and a tractor-trailer
// is loaded by a dock worker's forklift. Forklift trips (`forklift` waits) also load flatbeds.
import * as THREE from "three@0.187.0";
import { GATE_LEN, LEAF_HANDLE_Y, LEAF_OPEN, truckLayout } from "./truck.ts";
import type { TruckLayout, TruckModel } from "./truck.ts";
import { DOCK_DEPTH, DOCK_PLATFORM } from "./facilities.ts";
import { CARGO_BY_ID, slotAlign, slotEnd, TRUCK_SLOTS } from "./cargo.ts";
import type { Handling } from "./cargo.ts";
import { DWELL } from "./journey.ts";
import type { StackMode, Stop } from "./journey.ts";
import { CARGO_MODELS } from "./cargomodels.ts";
import { handR } from "./decor.ts";
import { jackArc, jackCurve, jackFlows, jackMotion, jackSmooth, jackBedJoin, jackBudget, jackLeft, jackSpent, jackDoorWays, jackStreet, jackDriverAt, jackDriverClear, jackPoseClear, jackLead, jackReverse, jackExtents, jackJoin, jackMoveClear, jackMoveLen, jackPivot, JACK_MID } from "./jackplan.ts";
import type { JackWorld, JMove, JPose } from "./jackplan.ts";
import { jackPoseAt } from "./jackplan.ts";
import { CURB_H, KERB } from "./grid.ts";
import { END_ON_HALF } from "./city.ts";

type ChoreKind =
  | "climbDown" | "climbUp" | "walk" | "doorOpen" | "doorClose" | "rampOut" | "rampIn"
  | "gateOut" | "gateIn" | "gateRide" | "leafOpen" | "leafClose" | "fetch" | "stow" | "wait"
  | "toolGet" | "toolPut"   // take the hand truck or pallet jack from the bed, put it back
  | "bedUp" | "bedDown"     // climb up into a trailer at its back from the road, or down out of it
  | "jackUp" | "jackDown";  // pump the pallet jack's forks up under a load, or let them down
export type ChoreGroup = "exit" | "load" | "walk" | "close" | "enter";
export type ItemKind = "box" | "stack" | "pallet" | "drum" | "crate" | "long" | "animal" | "bundle";
export type Gesture = "clipboard" | "stretch" | "wave" | "coffee";
export interface Chore {
  kind: ChoreKind; group: ChoreGroup; len: number;
  a?: [number, number, number]; b?: [number, number, number];   // from and to (walks, rides)
  face?: number;                    // facing for stationary chores (truck-frame yaw)
  item?: ItemKind | null;           // carried during this chore
  tool?: "handTruck" | "palletJack" | null;
  rest?: ToolRest;                  // toolGet / toolPut: where the tool rests in the bed
  helper?: boolean;                 // a dock worker carries the other end (team lift)
  gesture?: Gesture;
  dir?: "up" | "down";              // gateRide
  linear?: boolean;                 // walk height interpolates straight from a to b (stairs, dock)
  noTurn?: boolean;                 // walked the way the driver already faces, backwards if need be (down the walk ramp)
  forward?: boolean;                // walked facing the way, what's held turned round first, never backwards (crewpath.ts)
  round?: boolean;                  // walked round what's held, from a to b on its far side, turning it about itself (crew.ts)
  jack?: JMove;                     // a pallet jack's planned move (jackplan.ts): the jack and the driver placed from it exactly (crewpath.ts)
  backward?: boolean;               // walked facing back the way it comes from, whichever way it turns (a team lift: facing the load)
  flip?: number;                    // fetch at a doorway: in this far, out of sight, turned round there, and back out facing out (crew.ts)
  flipOff?: number;                 // (and the way out turned this far from square through the doorway, the heading out with it: a pallet jack steered off at an angle, chores.ts jackRuns)
  flipYaw?: [number, number];       // (and the driver's heading going in and coming out, from `face`: default [0, π]. A team lift's: the
                                    // driver faces the load, backing in with it or out; a load drawn on its jack: backed out with it)
  roundStill?: number;              // (round a crate on its dolly: it stays as it is, the driver stepping round it this far out to its side)
  forklift?: boolean;               // a wait during which the dock worker makes one forklift trip
  mate?: [[number, number], [number, number]];   // a team lift's walk with the load held rigid: the worker's end from and to (x, z), placed from the driver (crew.ts)
  faceYaw?: [number, number];       // a walk faced so from start to end, whichever way it goes (crewpath.ts): turning a load, side-stepping it
  over?: number;                    // a walk climbing over a load this tall (its top above the floor), on hands and knees (crew.ts)
  leaf?: number;                    // leafOpen / leafClose: which of a trailer's swing doors (-1 the street side's, +1 the kerb side's)
  leafPart?: boolean;               // (and only pulled open part way, and pushed to from there: something on the pavement is in its way round)
  lay?: [number, number, number];   // the stop's load lies on the floor here meanwhile, on its own (crew.ts): handed over by the forklift, or left by the jack
  handoff?: boolean;                // a forklift wait that hands the load over at the trailer's back (the trip is the stow, not this)
}

// A trailer's swing doors, one leaf at a time. The driver lifts the leaf's lock handles, pulls it
// open, backing round as it comes, steps round its free edge, walks it on round to lie flat along
// the trailer's side and hooks it there; closing, the same backwards: unhooked, drawn off the side
// walking backwards, stepped round, pushed shut and locked. Each leaf is hinged at a rear corner
// and turns LEAF_OPEN round to the side. (truck.ts draws them; crew.ts poses the driver from
// leafAt, and crewpath.ts walks them there.)
export const LEAF_LEN = 6.4;
// Its timeline, as fractions of LEAF_LEN opening: handles, pulled open to LEAF_PULL, round the
// edge, walked round to the side, hooked.
const LEAF_T = [0.13, 0.36, 0.5, 0.88];
const LEAF_PULL = 1.75;
// Where the driver holds it, out from its hinge (m), and stands off its face (m); and the lock
// handles are at LEAF_HANDLE_Y (truck.ts).
const LEAF_HOLD = 0.85, LEAF_OFF = 0.5;
// A leaf's hinge, its width, and the driver's place at it: its free edge's direction from the
// hinge at angle th, and the normal of its outside (rear) face.
export function leafGeom(L: TruckLayout, side: number) {
  const hw = L.hw - 0.04;
  return { hx: L.bedRear - 0.02, hz: side * (L.hw - 0.02), w: hw, r: hw * LEAF_HOLD };
}
const leafDir = (side: number, th: number): [number, number] => [-Math.sin(th), -side * Math.cos(th)];
const leafNorm = (side: number, th: number): [number, number] => [-Math.cos(th), side * Math.sin(th)];
// The driver at a leaf at progress u of its chore (or of opening, `open`): where they stand and
// face (truck frame), the leaf's angle, where their hands are on it (x, y, z each) and how firmly
// (0..1), and how far they stoop (0..1: unhooking it low at the side).
// (`part`: only its handles and the pull, to LEAF_PULL, and back: its chore is LEAF_PART_LEN long.)
export function leafAt(L: TruckLayout, side: number, open: boolean, u: number, part = false) {
  const g = leafGeom(L, side), T = (open ? u : 1 - u) * (part ? LEAF_T[1] : 1);
  const [t0, t1, t2, t3] = LEAF_T, e = (a: number, b: number) => { const k = THREE.MathUtils.clamp((T - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const th = leafAngle(open, u, part);
  let side2 = 1, round = 0;
  if (T >= t1 && T < t2) { round = e(t1, t2); side2 = Math.cos(Math.PI * round); }
  else if (T >= t2) side2 = -1;
  const [dx, dz] = leafDir(side, th), [nx, nz] = leafNorm(side, th);
  const cx = g.hx + dx * g.r, cz = g.hz + dz * g.r;
  // (Round the free edge: out past it by a body's width and back in on its other face.)
  const bulge = round ? (g.w - g.r + 0.38) * Math.sin(Math.PI * round) : 0;
  const ox = nx * LEAF_OFF * side2 + dx * bulge, oz = nz * LEAF_OFF * side2 + dz * bulge;
  const x = cx + ox, z = cz + oz, yaw = Math.atan2(oz, -ox);   // (facing the leaf: back towards where it's held)
  // Hands: on the handles (lifted, swung out, as the lock bars turn), then on the leaf's face either
  // side of where it's held; off it going round its edge; low on it hooking it to the side.
  const grip = T < t1 ? 1 : T < t2 ? 1 - Math.sin(Math.PI * round) : 1;
  const lift = T < t0 ? 0.14 * Math.sin(Math.PI * Math.min(1, T / t0)) : 0;
  const stoop = e(t3, 1);
  const hy = LEAF_HANDLE_Y + lift - 0.35 * stoop, f = side2 >= 0 ? 0.04 : -0.04;
  const hand = (d: number): [number, number, number] => [g.hx + dx * (g.r + d) + nx * f, hy, g.hz + dz * (g.r + d) + nz * f];
  // (Opening, on the handles of its two rods; then either side of where it's held.)
  return { x, z, yaw, th, hands: (T < t1 ? [hand(0.82 * g.w - g.r + 0.15), hand(0.42 * g.w - g.r + 0.15)] : [hand(0.12), hand(-0.28)]) as [[number, number, number], [number, number, number]], grip, stoop };
}
// The leaf's angle (rad from shut) at progress u of its chore.
export function leafAngle(open: boolean, u: number, part = false) {
  const T = (open ? u : 1 - u) * (part ? LEAF_T[1] : 1), [t0, t1, t2, t3] = LEAF_T;
  const e = (a: number, b: number) => { const k = THREE.MathUtils.clamp((T - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  return T < t2 ? LEAF_PULL * e(t0, t1) : LEAF_PULL + (LEAF_OPEN - LEAF_PULL) * e(t2, t3);
}
// Where the driver stands to begin a leaf, or where they finish (opening: closed at the back,
// open beside the trailer's side).
export function leafStand(L: TruckLayout, side: number, opened: boolean, part = false): [number, number, number] {
  const p = leafAt(L, side, true, opened ? 1 : 0, part);
  return [p.x, 0, p.z];
}
export const LEAF_PART_LEN = LEAF_LEN * LEAF_T[1];
// Whether anything standing on the pavement is in a leaf's way round to the trailer's side (or the
// driver's, walking it round), so it is only pulled open part way.
export function leafBlocked(L: TruckLayout, side: number, obstacles: WalkObstacle[]) {
  const g = leafGeom(L, side);
  return obstacles.some((o) => o.x > g.hx - g.w - 1.0 && Math.sign(o.z) === Math.sign(side) && Math.abs(o.z) > L.hw - 0.1
    && Math.hypot(o.x - g.hx, o.z - g.hz) < g.w + LEAF_OFF + 0.35 + o.r);
}

// A tractor-trailer at the kerb: the dock worker's forklift lifts the load to the trailer's floor
// and sets it down just inside its doors (its middle this far in), or takes it from there; the
// driver, up in the trailer with the pallet jack, takes it from there to where it rides, or brings
// it there. A jack's driver is always at its handle, behind the load, so the hand-over at the
// doors is worked from the trailer's inside, the jack's forks to the doors; and the jack, with
// no room to turn a load round in the trailer, stays under the load at the back of the rest (as a
// box truck's heavy loads stay on theirs, jackStays): a pickup's left on it, a drop's taken up
// from where it was left. The driver comes past it on foot, along the other column.
export const HAND_IN = 0.75;
// Climbing up into the trailer (and down): from the road behind it, a step on the underride guard.
export const BED_CLIMB = 2.8, BED_CLIMB_Z = -0.35;
// Pumping the jack's forks up under a load, or letting them down.
export const JACK_PUMP = 1.4;
// The jack, from its middle: back to its pump (-), on to its fork tips, half wide; and the
// driver, behind its middle on the handle, and their half width.
const TJ_BACK = 0.88, TJ_FRONT = 0.69, TJ_HALF = 0.33, TJ_LEAD = JACK_MID + 1.0, TJ_BODY = 0.28;
const tjFwd = (h: number): [number, number] => [Math.cos(h), -Math.sin(h)];
// Whether a move keeps the jack and its driver inside the trailer and off what lies in it
// (footprints: x0 x1 z0 z1).
function trailerMoveClear(L: TruckLayout, m: JMove, lying: { x0: number; x1: number; z0: number; z1: number }[]): boolean {
  const inside = (x: number, z: number, r: number) => x > L.bedRear + r - 0.02 && x < L.bedFront - r && Math.abs(z) < L.hw - 0.05 - r;
  const off = (x: number, z: number, r: number) => lying.every((b) => x < b.x0 - r || x > b.x1 + r || z < b.z0 - r || z > b.z1 + r);
  for (let i = 0; i <= 24; i++) {
    const u = i / 24, p = jackPoseAt(m, u), [fx, fz] = tjFwd(p.h), [dx, dz] = jackDriverAt(m, u);
    if (!inside(dx, dz, TJ_BODY) || !off(dx, dz, TJ_BODY)) return false;
    for (const a of [-TJ_BACK, 0, TJ_FRONT]) for (const b of [-TJ_HALF, 0, TJ_HALF]) {
      const x = p.x + fx * a - fz * b, z = p.z + fz * a + fx * b;
      if (!inside(x, z, 0.02) || !off(x, z, 0.02)) return false;
    }
  }
  return true;
}
// Two arcs that shift the jack `dz` across as it rolls on along itself, gently enough that the
// driver on its handle keeps inside the trailer.
function jackShift(p: JPose, dz: number): JMove[] {
  const d = 0.6, rho = Math.abs(dz) / (2 * (1 - Math.cos(d))), len = rho * d;
  for (const sg of [1, -1]) {
    const a = jackArc(p, len, sg * d), b = jackArc(a.p1, len, -sg * d);
    if (Math.sign(b.p1.z - p.z) === Math.sign(dz)) return [a, { ...b, p1: { ...b.p1, z: p.z + dz, h: p.h } }];
  }
  return [];
}
// The trailer's plan for a kerb stop, in order: the jack's moves, walks on foot, the hand-over and
// the rest, with where the load lies meanwhile; or null where there isn't the room (it's too full
// behind the stop's loads, or they aren't the rearmost, or there are too few to leave room deep of
// the one shown once they're gone), and the forklift loads it as it can.
export type TJStep = { move: JMove; item: boolean; lay?: [number, number, number] } | { walk: [number, number, number][]; lay?: [number, number, number] }
  | { chore: "handoff" | "up" | "down" | "merge"; lay?: [number, number, number] } | { get: ToolRest } | { put: ToolRest; lay?: [number, number, number] };
export function trailerJackPlan(L: TruckLayout, model: TruckModel, stop: Stop, slot0: number, aboard: { cargo: string; slot: number; units: number }[], store: ToolRest): TJStep[] | null {
  if (!L.trailer || STYLE[CARGO_BY_ID.get(stop.cargo)!.handling].tool !== "palletJack") return null;
  const pickup = stop.kind === "pickup", F = L.floor, R = L.bedRear, size = CARGO_MODELS[stop.cargo]?.size ?? [1.2, 1.1, 1.0];
  const units = bedUnits(L, model, stop.cargo, stop.units, slot0);
  if (!units.length) return null;
  const print = (x: number, z: number, sz: number[]) => ({ x0: x - sz[0] / 2, x1: x + sz[0] / 2, z0: z - sz[2] / 2, z1: z + sz[2] / 2 });
  const others = aboard.flatMap((a) => { const sz = CARGO_MODELS[a.cargo]?.size ?? [0.5, 0.5, 0.5]; return bedUnits(L, model, a.cargo, a.units, a.slot).map((p) => print(p[0], p[2], sz)); });
  // The load's rearmost unit (a row's kerb side one): the one shown on its own, on the jack.
  const rear = Math.min(...units.map((p) => p[0]));
  const row = units.filter((p) => p[0] < rear + 0.05), unit = row.find((p) => p[2] > 0) ?? row[0];
  const zc = unit[2], P = unit[0];
  // (Nothing of the other stops' behind the load, and room deep of the one shown, its jack's driver
  // there, once the rest are gone (or before they come).)
  const blockDeep = Math.max(...units.map((p) => p[0])) + size[0] / 2;
  if (others.some((b) => b.x0 < blockDeep - 0.05)) return null;
  const deepFree = Math.min(L.bedFront, ...others.map((b) => b.x0)) - 0.02;
  if (P + TJ_LEAD + 0.09 + TJ_BODY + 0.05 > Math.max(blockDeep, deepFree) || P - size[0] / 2 < R + HAND_IN + size[0] / 2 + 0.6) return null;
  // The way past it on foot: along the other column, out of the jack's and the load's way.
  const zp = -Math.sign(zc || 1) * Math.max(0.35, L.hw - 0.05 - TJ_BODY - 0.25);
  const H = R + HAND_IN, pose = (x: number, z: number, h: number): JPose => ({ x, z, h });
  const roll = (a: JPose, x: number, z = a.z): JMove => ({ kind: "roll", p0: a, p1: pose(x, z, a.h) });
  const back = Math.PI;   // (forks to the doors)
  const handAt: [number, number, number] = [H, F, zc], restAt: [number, number, number] = [P, F, zc];
  const feet = (p: JPose): [number, number, number] => [p.x - Math.cos(p.h) * TJ_LEAD, F, p.z + Math.sin(p.h) * TJ_LEAD];
  const wheel = (p: JPose): [number, number, number] => [p.x - Math.cos(p.h) * JACK_MID, F, p.z + Math.sin(p.h) * JACK_MID];
  // (At the doors: the forks out from under where the load is handed over, and in under it.)
  const wait = pose(H + 0.09 + 1.2, zc, back), under = pose(H + 0.09, zc, back), left = pose(P + 0.09, zc, back);
  const leftRest: ToolRest = { at: wheel(left), stand: feet(left), yaw: back };
  const past = (lay: [number, number, number]): [number, number, number][] =>   // (from deep of it to before it, or back)
    [[P + size[0] / 2 + 0.45, F, zp], [P - size[0] / 2 - 0.45, F, zp]];
  const ok = (ms: JMove[]) => ms.every((q) => trailerMoveClear(L, q, others));
  const steps: TJStep[] = [];
  if (pickup) {
    if (Math.abs(store.yaw) > 0.01) return null;
    // From where it rides, drawn back from the loads ahead (room to turn it), turned round, over to
    // the load's column, and down to the doors to wait for the forklift.
    const rest = pose(store.at[0] + JACK_MID, store.at[2], 0);
    let lead: JMove[] | null = null;
    for (let xc = rest.x; xc >= wait.x + 1.0 && !lead; xc -= 0.1) {
      const a = roll(rest, xc), tp: JMove = { kind: "pivot", p0: a.p1, p1: pose(xc, a.p1.z, back), tight: 0.5, turn: Math.PI };
      const sh = Math.abs(zc - a.p1.z) > 0.01 ? jackShift(tp.p1, zc - a.p1.z) : [];
      const end = sh.length ? sh[1].p1 : tp.p1;
      if (end.x >= wait.x && ok([a, tp, ...sh])) lead = [a, tp, ...sh];
    }
    if (!lead) return null;
    steps.push({ get: store });
    for (const m of lead) steps.push({ move: m, item: false });
    const at = lead[lead.length - 1].p1;
    steps.push({ move: roll(at, wait.x, zc), item: false });
    steps.push({ chore: "handoff", lay: handAt });
    // Forks in under it, pumped up, drawn in to the back of the rest, let down and left on it; past
    // it on foot, and the rest are there with it.
    steps.push({ move: roll(wait, under.x), item: false, lay: handAt });
    steps.push({ chore: "up" });
    steps.push({ move: roll(under, left.x), item: true });
    steps.push({ chore: "down", lay: restAt });
    steps.push({ put: leftRest, lay: restAt });
    steps.push({ walk: past(restAt), lay: restAt });
    steps.push({ chore: "merge", lay: restAt });
    return steps;
  }
  // A drop: the jack left under the back of the load at the last stop. The rest are taken as the
  // driver comes to them, and the one on the jack is left; past it on foot to the jack's handle,
  // pumped up, pushed to the doors, let down, drawn back out from under it for the forklift.
  steps.push({ walk: [[P - size[0] / 2 - 0.45, F, zp]] });
  steps.push({ chore: "merge", lay: restAt });
  steps.push({ walk: [...past(restAt).reverse(), feet(left)], lay: restAt });
  steps.push({ get: leftRest });
  steps.push({ chore: "up" });
  steps.push({ move: roll(left, under.x), item: true });
  steps.push({ chore: "down", lay: handAt });
  steps.push({ move: roll(under, wait.x), item: false, lay: handAt });
  steps.push({ chore: "handoff", lay: handAt });
  steps.push({ put: { at: wheel(wait), stand: feet(wait), yaw: back } });
  return steps;
}

// Brisk: a stop's whole dwell should land around 35-50 s so a stop cycle stays near 60-90 s.
const WALK = 2.0, CARRY = 1.5, TOOL = 1.6, HEAVY = 1.25;
// Facing in the truck frame: yaw 0 looks along +x (towards the cab), PI along -x (backwards).
const FACE_FRONT = 0, FACE_BACK = Math.PI;
// Opening and closing up: the roll-up door (bend to the handle, lift, push it up and give it a
// last shove; reach up for the strap, pull it down hand over hand until the door is in reach,
// pull that down, bend to push it shut), and the walk ramp pulled out and pushed back in, with
// the driver this far behind its end.
export const DOOR_OPEN = 3.4, RAMP_MOVE = 3.6, RAMP_HOLD = 0.5;
// A pallet jack at a front door goes in and comes out square to it: turned to it (about its
// middle, 1.7 m ahead of the driver) this far out in front of where the driver stands at it, and
// drawn straight back out this far, its middle well out of the doorway to turn it.
const JACK_DOOR_IN = 1.2, JACK_DOOR_OUT = 2.6;
// The driver turns a pallet jack about its middle no faster than this (rad/s: crew.ts, empty
// and loaded); a walk with one starts with the time that takes.
export const JACK_TURN = 1.3, JACK_TURN_LOADED = 1.0;
// The lift gate: where the driver stands on it, in from its end (m); and where they line up for
// it behind it, and walk on to off it.
export const GATE_STAND = 0.3, GATE_LINEUP = 1.0, GATE_OFF = 0.6;
// What the driver holds ahead of them, as crew.ts places it: the hand truck's wheels this far
// ahead of the feet; the pallet jack's steering wheel this far, its middle (which it turns
// about) this far on from that; and the near end of a pushed load this far (pushGap: further
// behind a tall one, so leaning into it keeps the head out of it).
export const HT_LEAD = 1.15, JACK_LEAD = 1.0, JACK_PIVOT_AT = 0.68;
// The driver walks round a hand truck's wheels, turning it, this fast (m/s).
const HT_TURN_V = 0.9;
// And rolls it along no faster than this (m/s), at the most.
const HT_WALK_V = 1.2;
// Fetching at a doorway (Chore.flip): how far in the driver goes, out of sight with what they hold
// ahead of them (and, turned round, behind them), and how fast (m, m/s).
const FLIP_DEPTH: Record<string, number> = { handTruck: 2.2, palletJack: 2.9, none: 0.9 };
const FLIP_V = 1.1;
// The driver's heading going into a doorway for a flip fetch, and coming out of it.
export const flipYawIn = (c: Chore) => (c.face ?? 0) + (c.flipYaw?.[0] ?? 0);
export const flipYawOut = (c: Chore) => (c.face ?? 0) + (c.flipYaw?.[1] ?? Math.PI);
export function pushGap(h: number) { return h > 1.6 ? 0.8 : h > 1.15 ? 0.65 : 0.4; }
// Walking round what's held (Chore.round), the driver goes this fast along the way round (m/s).
const ROUND_SPEED = 1.1;
// Backing (or drawing what's held along, not turning it), the driver goes this much slower.
const BACKING = 0.8;
// Taking something wheeled up it, the driver lines up on the ramp this far short of its foot, walks
// round it there, and backs up the ramp drawing it after them.
export const RAMP_LINEUP = 3.6;
// Pushing an empty hand truck up it, the driver lines up on the ramp's middle this far short of
// its foot, so the hand truck is square to it before its wheels reach it.
const HT_PUSH_LINEUP = 1.0;
// Drawing a loaded one up it, the driver stops this far short of its foot, the hand truck pushed out
// ahead of them, away from the ramp, and backs up from there.
const HT_DRAW_LINEUP = 0.9;
// A team lift lined up square to a front door (square, planChores): turned about the load's middle
// this far clear of the walk ramp's foot (m), and that much slower turning it, and side-stepping it.
const TEAM_RAMP_CLEAR = 0.5, TEAM_TURN_V = 0.55, TEAM_SIDE_V = 0.6;
// A team lift turns onto and off the walk ramp this much wider than the load is long (the two
// carriers' bodies either end of it, and room).
const TEAM_TURN = 1.2;
// A team lift: each end of the load this far from its carrier's feet (clear of the body), so the
// worker walks the load's length and twice this behind the driver (teamSpan).
export const TEAM_CLEAR = 0.4;
// And in the bed no nearer its walls than this (the driver's middle: their half width and a hand's
// breadth).
const TEAM_WALL = 0.38;
// Taking up a load at the bed's back, the driver stands no nearer its edge than this (m).
const TEAM_SILL = 0.05;
// Team lifts carried on edge, as movers carry a mattress: on its long side, narrow, through gaps it
// would never pass flat (crew.ts teamLoad), and laid flat in the bed.
export const ON_EDGE = new Set(["mattresses"]);
// Team lifts carried at the shoulder, as two carry a canoe: over the bins and benches.
export const HIGH_CARRY = new Set(["canoes"]);
// How far apart a team lift's carriers walk (crew.ts teamMate): the load's length, the two
// clearances, and on edge a little more, its top coming back towards their heads.
export const teamSpan = (cargo: string, length: number) => length + 2 * TEAM_CLEAR + (ON_EDGE.has(cargo) ? 0.3 : 0);
// And on the pavement, the load between them keeps this clear of what stands there (a tree's
// trunk, a bin), beside its own half width; the way round stood further off a step at a time
// (m) until it does; and it turns out to the door's side no more than so far further back from
// the ramp than it would to find a clear way out between them (m).
// (The driver closing on the worker, the way doubling back, counts this many times worse than
// brushing something by as much: it walks the driver into the load.)
const TEAM_CLOSE = 5;
// (Of the turns tried, this many of the clearest are followed all the way.)
const TEAM_TRIES = 40;
const TEAM_PASS = 0.3, TEAM_BACK_MAX = 6, TEAM_WIDER = [0, 0.3, 0.6, 1.0, 1.5, 2.2];
// The walk ramp's half width (crew.ts ground), and how far clear of its side what's wheeled
// past it keeps (a hand truck's wheels and a hand's breadth).
export const RAMP_HW = 0.47;
const RAMP_WHEELS = 0.6;
// At the roll-up door the driver steps up to stand this far behind its plane, square to its
// middle, where both hands reach this high above the feet (crew.ts reachPose, arms straight).
export const DOOR_STAND = 0.5, DOOR_REACH = 1.78;
// Closing: one pull on the strap takes this long, and the rest of the chore DOOR_CLOSE_BASE.
export const STRAP_PULL = 0.55, DOOR_CLOSE_BASE = 2.45;
// The pulls on the strap that bring the door's bottom edge from `edge` (fully open) down within
// reach, both heights above the feet, `floor` the bed floor's: each pulls the strap from overhead
// down to the waist (no lower than just above the floor, where the hands would meet the sill).
// hi, lo: where each pull starts and ends; reach: where the edge ends up; n pulls of `each`.
export function strapPulls(edge: number, floor: number) {
  const hi = Math.min(DOOR_REACH - 0.08, edge - 0.05), lo = Math.max(1.0, floor + 0.12);
  const reach = Math.min(edge, DOOR_REACH - 0.03), drop = edge - reach;
  const n = drop < 0.02 ? 0 : Math.ceil(drop / Math.max(0.2, hi - lo));
  return { hi, lo, reach, n, each: n ? drop / n : 0 };
}
// How long closing the door takes with the driver's feet at `feetY` (truck frame).
export function doorCloseLen(L: TruckLayout, feetY: number) {
  return DOOR_CLOSE_BASE + STRAP_PULL * strapPulls(L.doorTop - feetY, L.floor - feetY).n;
}

interface TripStyle { perTrip: number; cap: number; item: ItemKind; tool: Chore["tool"]; speed: number; helper?: boolean }
export const STYLE: Record<Handling, TripStyle> = {
  carry: { perTrip: 4, cap: 2, item: "box", tool: null, speed: CARRY },
  handTruck: { perTrip: 6, cap: 2, item: "stack", tool: "handTruck", speed: TOOL },
  palletJack: { perTrip: 2, cap: 2, item: "pallet", tool: "palletJack", speed: HEAVY },
  roll: { perTrip: 3, cap: 2, item: "drum", tool: null, speed: CARRY },
  push: { perTrip: 2, cap: 2, item: "crate", tool: null, speed: HEAVY },
  walkOn: { perTrip: 99, cap: 1, item: "animal", tool: null, speed: 1.0 },
  teamLift: { perTrip: 3, cap: 1, item: "long", tool: null, speed: HEAVY, helper: true },
  flatbed: { perTrip: 1, cap: 4, item: "bundle", tool: null, speed: WALK },   // the forklift takes one at a time
  tow: { perTrip: 1, cap: 1, item: "bundle", tool: null, speed: WALK },
};

const dist3 = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Something on the pavement the driver walks round: a circle in the truck's frame (x, z, radius).
export interface WalkObstacle { x: number; z: number; r: number; kind?: number; hand?: number }   // kind: decor.ts PK; hand: how far out it reaches where a team lift is carried (decor.ts handR)
const BODY_R = 0.32;   // the driver's half-width, and a load carried in front
// The legs of a walk from a to b (on the ground) that keep clear of `obs`: where the straight line
// meets an obstacle, step out beside it on the nearer side (or the other, if that is blocked),
// and route each half the same way. Obstacles at either end (standing at a door beside a tree)
// are ignored.
function walkRoute(a: [number, number, number], b: [number, number, number], obs: WalkObstacle[], depth = 0): [number, number, number][] {
  const dx = b[0] - a[0], dz = b[2] - a[2], len = Math.hypot(dx, dz);
  if (len < 0.3 || depth > 6) return [b];
  const ux = dx / len, uz = dz / len;
  let hit: WalkObstacle | null = null, hitT = Infinity;
  for (const o of obs) {
    const r = o.r + BODY_R;
    if (Math.hypot(a[0] - o.x, a[2] - o.z) < r || Math.hypot(b[0] - o.x, b[2] - o.z) < r) continue;
    const t = (o.x - a[0]) * ux + (o.z - a[2]) * uz;
    if (t < 0 || t > len) continue;
    const side = Math.abs((o.x - a[0]) * -uz + (o.z - a[2]) * ux);
    if (side < r && t < hitT) { hit = o; hitT = t; }
  }
  if (!hit) return [b];
  const s = (hit.x - a[0]) * -uz + (hit.z - a[2]) * ux;   // which side of the line the obstacle is on
  // (Out beside it, then, if something stands there too, further out, round the two together.)
  for (const wide of [1, 1.8, 2.6]) {
    const off = ((hit.r + BODY_R) * 1.35 + 0.1) * wide;
    for (const dir of s > 0 ? [-1, 1] : [1, -1]) {
      const w: [number, number, number] = [hit.x - uz * off * dir, 0, hit.z + ux * off * dir];
      if (obs.some((o) => o !== hit && Math.hypot(w[0] - o.x, w[2] - o.z) < o.r + BODY_R)) continue;
      return [...walkRoute(a, w, obs, depth + 1), ...walkRoute(w, b, obs, depth + 1)];
    }
  }
  return [b];   // boxed in: straight through
}

// How much of a team lift's load hits what stands on the pavement (the sum of how far into each it
// goes, at points 0.2 m apart along the driver's way): the driver going on from `a` by `legs`
// after the carry so far (`trail`, x z pairs, ending at a), and the worker the load's length
// (`back`) behind on the way the driver went (as crew.ts mateOn has them), the load a line between
// the two, `half` wide either side.
function loadHits(trail: number[], a: [number, number, number], legs: [number, number, number][], back: number, half: number, obs: WalkObstacle[], step = 0.2) {
  const pts = trail.slice();
  let hit = 0, k = 0, px = a[0], pz = a[2], walked = 0;
  for (let i = 2; i < trail.length; i += 2) walked += Math.hypot(trail[i] - trail[i - 2], trail[i + 1] - trail[i - 1]);
  for (const to of legs) {
    const n = Math.max(1, Math.ceil(Math.hypot(to[0] - px, to[2] - pz) / step));
    for (let i = 1; i <= n; i++) {
      const dx = px + (to[0] - px) * i / n, dz = pz + (to[2] - pz) * i / n;
      pts.push(dx, dz);
      const far = (j: number) => Math.hypot(pts[2 * j] - dx, pts[2 * j + 1] - dz), m = pts.length / 2 - 1;
      while (k < m - 1 && far(k + 1) >= back) k++;
      walked += Math.hypot(to[0] - px, to[2] - pz) / n;
      // (Not yet the load's length along: still taking it up. Past that, the driver closing on
      // the worker, the way doubling back on itself, walks into it: as bad.)
      // (Then the worker waits where they are, the load swinging round them as the driver goes.)
      if (far(k) < back) { if (walked <= back) continue; hit += (back - far(k)) * TEAM_CLOSE; }
      const f0 = far(k), f1 = far(k + 1), f = f0 >= back && f1 < back ? (f0 - back) / (f0 - f1) : 0;
      const wx = pts[2 * k] + (pts[2 * k + 2] - pts[2 * k]) * f, wz = pts[2 * k + 1] + (pts[2 * k + 3] - pts[2 * k + 1]) * f;
      // (The load itself: the line between them, short of each carrier by their clearance.)
      const lx = dx - wx, lz = dz - wz, ll = Math.hypot(lx, lz) || 1;
      for (const o of obs) {
        const t = Math.max(TEAM_CLEAR, Math.min(ll - TEAM_CLEAR, ((o.x - wx) * lx + (o.z - wz) * lz) / ll));
        const d = Math.hypot(wx + lx / ll * t - o.x, wz + lz / ll * t - o.z), r = o.hand ?? o.r;   // (NaN, passed over: never hit)
        if (d < r + half) hit += r + half - d;
      }
    }
    px = to[0]; pz = to[2];
  }
  return hit;
}

// A vehicle parked in a dock's yard (or the truck itself) that the driver walks round: a box in
// the truck's frame, centred on (x, z), hx / hz half its length along (ax, az) and its width
// across that.
export interface WalkBox { x: number; z: number; hx: number; hz: number; ax: number; az: number }
// A box as a row of discs along its length, for walkRoute (one along the truck's axis: the ramp).
function rampDiscs(o: WalkBox): WalkObstacle[] {
  const out: WalkObstacle[] = [], n = Math.max(1, Math.ceil(o.hx / o.hz));
  for (let i = 0; i <= n; i++) out.push({ x: o.x - o.hx + (2 * o.hx * i) / n, z: o.z, r: o.hz });
  return out;
}
// The legs of a walk from a to b (on the ground) round boxes: the shortest way through the
// corners of each box (stood off from it), by what can be seen from where. Boxes either end is in
// or beside (standing at a trailer's door) are ignored; null if there is no way round.
function boxRoute(a: [number, number, number], b: [number, number, number], all: WalkBox[]): [number, number, number][] | null {
  const CLEAR = BODY_R - 0.04, STAND = BODY_R + 0.3;   // how close a path may pass, and where its corners are
  const local = (o: WalkBox, x: number, z: number) => { const dx = x - o.x, dz = z - o.z; return [dx * o.ax + dz * o.az, -dx * o.az + dz * o.ax]; };
  const inside = (o: WalkBox, x: number, z: number, m: number) => { const [u, v] = local(o, x, z); return Math.abs(u) < o.hx + m && Math.abs(v) < o.hz + m; };
  const boxes = all.filter((o) => !inside(o, a[0], a[2], CLEAR + 0.01) && !inside(o, b[0], b[2], CLEAR + 0.01));
  // Whether the segment p-q passes through a box (grown by CLEAR): slabs in the box's own frame.
  const blocked = (px: number, pz: number, qx: number, qz: number) => boxes.some((o) => {
    const [u0, v0] = local(o, px, pz), [u1, v1] = local(o, qx, qz);
    let t0 = 0, t1 = 1;
    for (const [p0, d, h] of [[u0, u1 - u0, o.hx + CLEAR], [v0, v1 - v0, o.hz + CLEAR]]) {
      if (Math.abs(d) < 1e-9) { if (Math.abs(p0) >= h) return false; continue; }
      let ta = (-h - p0) / d, tb = (h - p0) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 >= t1) return false;
    }
    return t1 - t0 > 1e-6;
  });
  if (!blocked(a[0], a[2], b[0], b[2])) return [b];
  const pts: [number, number][] = [[a[0], a[2]], [b[0], b[2]]];
  for (const o of boxes) for (const [su, sv] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    const u = su * (o.hx + STAND), v = sv * (o.hz + STAND), x = o.x + u * o.ax - v * o.az, z = o.z + u * o.az + v * o.ax;
    if (!boxes.some((q) => inside(q, x, z, CLEAR))) pts.push([x, z]);
  }
  // Dijkstra from a (0) to b (1).
  const n = pts.length, dist = new Array(n).fill(Infinity), prev = new Array(n).fill(-1), done = new Array(n).fill(false);
  dist[0] = 0;
  for (;;) {
    let i = -1;
    for (let k = 0; k < n; k++) if (!done[k] && dist[k] < Infinity && (i < 0 || dist[k] < dist[i])) i = k;
    if (i < 0 || i === 1) break;
    done[i] = true;
    for (let k = 0; k < n; k++) {
      if (done[k]) continue;
      const d = dist[i] + Math.hypot(pts[k][0] - pts[i][0], pts[k][1] - pts[i][1]);
      if (d < dist[k] && !blocked(pts[i][0], pts[i][1], pts[k][0], pts[k][1])) { dist[k] = d; prev[k] = i; }
    }
  }
  if (prev[1] < 0) return null;
  const legs: [number, number, number][] = [];
  for (let k = prev[1]; k > 0; k = prev[k]) legs.unshift([pts[k][0], 0, pts[k][1]]);
  return [...legs, b];
}

// Units moved per trip by hand, matching what the driver is seen carrying (loads.ts
// buildCarried): a hand truck's stack, a pallet jack's pallet, one or two in the arms, one
// rolled, one on the dolly, one lifted between two. Every trip carries
// exactly what lands in the bed. Forklift work (trailers, flatbeds) and herds go by STYLE.
const TRIP_CAP = 4;
function tripLoad(id: string): number {
  const c = CARGO_BY_ID.get(id)!, m = CARGO_MODELS[id];
  if (!m) return STYLE[c.handling].perTrip;
  const [l, h, w] = m.size;
  switch (c.handling) {
    case "handTruck": return Math.max(1, Math.min(4, Math.floor(1.25 / h)));
    case "palletJack":
      return m.palletized ? 1 : Math.max(1, Math.floor(1.15 / l)) * Math.max(1, Math.floor(0.95 / w)) * Math.max(1, Math.min(3, Math.floor(1.0 / h)));
    case "carry": return h < 0.35 && l < 0.6 && id !== "envelope" ? 2 : 1;
    case "roll": case "push": case "teamLift": return 1;
    default: return STYLE[c.handling].perTrip;
  }
}
export const handTrips = (L: TruckLayout, handling: Handling) => !L.trailer && !L.flatbed && handling !== "walkOn" && handling !== "flatbed" && handling !== "tow";
// The most units one stop can move by hand.
export function maxHandUnits(id: string) { return TRIP_CAP * tripLoad(id); }
export function tripCount(L: TruckLayout, id: string, units: number) {
  const c = CARGO_BY_ID.get(id)!;
  if (!handTrips(L, c.handling)) { const st = STYLE[c.handling]; return Math.min(st.cap, Math.max(1, Math.ceil(units / st.perTrip))); }
  return Math.max(1, Math.ceil(units / tripLoad(id)));
}

// Where the hand truck or pallet jack rides: against the bed's front wall on the left (truck
// frame), and where the driver stands to take it: in the aisle between the load columns, so
// the driver is never standing inside a stowed load.
// A box's cargo starts this far back from the front wall, leaving the strip in front of it for
// the tool: the hand truck stands there, and the pallet jack lies across it once there are loads
// (in an empty bed it lies along the bed, toolStore).
const bedFrontGap = (L: TruckLayout) => (L.trailer || L.flatbed ? 0.15 : 0.7);
// Taking the tool from where it rests (a step to it, a grip, tipping it onto its wheels and
// drawing it back into the aisle), or putting it back the same way, takes this long.
export const TOOL_TAKE = 1.9;
export interface ToolRest { at: [number, number, number]; stand: [number, number, number]; yaw: number }   // yaw: added to the truck's heading
// `rearX`: the back of the rearmost row of loads (bedRearX), or null for an empty bed. With room
// behind the loads, the tool is secured right behind them, upright against the last load (the
// pallet jack lying in the aisle); otherwise it rides in the strip at the front wall.
export function toolStore(L: TruckLayout, tool: "handTruck" | "palletJack", rearX: number | null = null): ToolRest {
  // Both stand facing into the bed, ready to be taken: the hand truck upright with its nose plate
  // to the load (or the wall), the pallet jack with its forks to it and its handle up.
  const jack = tool === "palletJack", reach = jack ? 1.45 : 0.32, x = (rearX ?? 0) - reach, standX = x - (jack ? 0.85 : 1.1);
  // (The pallet jack rests in the middle of the aisle, where it is pushed and drawn along, square
  // to the bed: the bed is too narrow to swing it across.)
  // (The pallet jack's driver can stand right at the bed's back edge to take it: anywhere else
  // it would be beyond the loads, out of reach.)
  if (rearX !== null && standX >= L.bedRear + (jack ? 0.15 : 0.45))
    return { at: [x, L.floor, jack ? 0 : -L.hw + 0.5], stand: [standX, L.floor, 0], yaw: 0 };
  // (At the front wall the jack only lies along the bed in an empty one; with loads it lies across
  // the strip in front of them, bedFrontGap.)
  return tool === "palletJack"
    ? (rearX === null ? { at: [L.bedFront - 1.45, L.floor, 0], stand: [L.bedFront - 2.3, L.floor, 0], yaw: 0 }
      : { at: [L.bedFront - 0.35, L.floor, -L.hw + 0.35], stand: [L.bedFront - 1.3, L.floor, 0], yaw: -Math.PI / 2 })
    : { at: [L.bedFront - 0.32, L.floor, -L.hw + 0.5], stand: [L.bedFront - 1.3, L.floor, 0], yaw: 0 };
}
// The back of the rearmost row holding anything in `aboard` (truck frame x), or null if empty.
export function bedRearX(L: TruckLayout, model: TruckModel, aboard: { slot: number; slotsPerUnit: number; units: number }[]): number | null {
  let end = 0;
  for (const a of aboard) if (a.units > 0) end = Math.max(end, slotEnd(a.slotsPerUnit, a.units, a.slot));
  if (end <= 0) return null;
  const slots = TRUCK_SLOTS[model], rows = Math.ceil(slots / 2);
  const x1 = L.bedFront - bedFrontGap(L), x0 = L.bedRear + 0.15, rowLen = (x1 - x0) / rows;
  return x1 - Math.ceil(end / 2 - 1e-6) * rowLen;
}

// Where each unit of an aboard entry sits on the bed floor (truck frame: x, y of its bottom, z),
// from its slot: pallet slots in two columns, filled from the front wall back. Units smaller
// than a slot share it (stacked, or side by side when stacking would hit the roof); units of two
// slots or more span the bed. The bed mesh
// (loads.ts), the stow target and the driver's spot all come from this.
export function bedUnits(L: TruckLayout, model: TruckModel, cargo: string, units: number, slot: number): [number, number, number][] {
  const m = CARGO_MODELS[cargo], c = CARGO_BY_ID.get(cargo)!, out: [number, number, number][] = [];
  if (!m) return out;
  const spu = c.slots, slots = TRUCK_SLOTS[model], rows = Math.ceil(slots / 2);
  const x1 = L.bedFront - bedFrontGap(L), x0 = L.bedRear + 0.15, rowLen = (x1 - x0) / rows, half = L.hw - 0.12;
  const roof = L.flatbed ? 4 : 2.45;
  const [ml, mh, mw] = m.size;
  const centre = (start: number, span: number): [number, number] => {
    const r0 = Math.floor(start / 2), r1 = Math.floor((start + span - 1) / 2);
    return [x1 - ((r0 + r1 + 1) / 2) * rowLen, span >= 2 ? 0 : (start % 2 ? half / 2 : -half / 2)];
  };
  let s = slot;
  if (spu >= 1) {
    const span = Math.ceil(spu);
    // A unit longer than the rows it takes (lumber and pipe bundles on the flatbed) would overlap
    // the next one face to face, so those go end to end along the bed, side by side in two files
    // where the bed is wide enough for two with one pushed in down the middle past the other
    // (motorcycles in a box: never stacked on one another while there is floor), and then stack.
    const rowsSpanned = Math.max(1, Math.ceil(span / 2)), long = ml > rowsSpanned * rowLen + 0.05;
    const files = !L.flatbed && 1.5 * mw + 0.05 <= half ? 2 : 1;
    const gap = 0.1, perLayer = Math.max(1, Math.floor((x1 - x0 + gap) / (ml + gap))) * files;
    for (let u = 0; u < units; u++) {
      const start = slotAlign(spu, s);
      if (start + span > slots) break;
      if (long) {
        const ord = Math.floor(start / span), at = ord % perLayer, layer = Math.floor(ord / perLayer);
        const col = Math.floor(at / files), z = files === 2 ? (at % 2 ? 1 : -1) * (half - mw / 2) : 0;
        out.push([x1 - ml / 2 - col * (ml + gap), L.floor + layer * (mh + 0.005), z]);
      } else {
        const [x, z] = centre(start, span);
        out.push([x, L.floor, z]);
      }
      s = start + span;
    }
  } else {
    const perSlot = Math.max(1, Math.round(1 / spu));
    const stack = Math.max(1, Math.min(perSlot, Math.floor(roof / mh)));
    const cols = Math.ceil(perSlot / stack);
    for (let u = 0; u < units; u++) {
      const k0 = Math.floor(s + 1e-6);
      if (k0 >= slots) break;
      const k = Math.round((s - k0) * perSlot) % perSlot;
      const [x, z] = centre(k0, 1);
      const cx = k % cols, cy = Math.floor(k / cols);
      const off = (cx - (cols - 1) / 2) * Math.min(mw, half / cols);
      out.push([x + (cols > 1 && ml < rowLen / 2 ? off * 0.5 : 0), L.floor + cy * mh, z + off]);
      s += spu;
    }
  }
  return out;
}
// The units one trip moves, as [from, to) indices into the stop's block: a pickup's first trip
// goes deepest, a drop's first trip takes the rearmost.
export function tripUnits(stop: Stop, trips: number, i: number): [number, number] {
  const per = Math.ceil(stop.units / trips);
  return stop.kind === "pickup" ? [Math.min(stop.units, i * per), Math.min(stop.units, (i + 1) * per)]
    : [Math.max(0, stop.units - (i + 1) * per), Math.max(0, stop.units - i * per)];
}
// How far ahead of the driver a stowed load sits (crew.ts props: the load's near edge in reach).
function stowReach(id: string) {
  const c = CARGO_BY_ID.get(id)!, m = CARGO_MODELS[id], tool = STYLE[c.handling].tool;
  const len = tool === "palletJack" && m && !m.palletized ? 1.2 : m ? m.size[0] : 0.5;
  if (c.handling === "push" && m) return Math.max(0.55, pushGap(m.size[1]) + 0.05) + len / 2;   // (as far ahead as it is pushed)
  return 0.55 + len / 2 + (tool === "palletJack" ? 0.9 : tool === "handTruck" ? 0.45 : 0);
}

// Where in the bed each trip's load goes (x of the driver's spot, truck frame). The stop's units
// start at the stop's own slot (`slot0`, cargo.ts slotFind), filling rows from the front: a pickup's first
// trip goes deepest, a drop's first trip takes the rearmost.
function stowSpots(L: TruckLayout, model: TruckModel, stop: Stop, slot0: number, trips: number, reach: number): number[] {
  const pos = bedUnits(L, model, stop.cargo, stop.units, slot0), out: number[] = [];
  for (let i = 0; i < trips; i++) {
    const [u0, u1] = tripUnits(stop, trips, i), ps = pos.slice(u0, u1);
    const x = ps.length ? ps.reduce((a, p) => a + p[0], 0) / ps.length : L.bedRear + 1;
    out.push(THREE.MathUtils.clamp(x - reach, L.bedRear + 0.6, L.bedFront - 0.8));
  }
  return out;
}

// Where the driver stands to set down (or take up) each trip of a team lift (x, z, truck frame):
// at its far end on its line, the load between them, a body's clearance off it; where that is past
// the front wall, beside that end instead, on its outer side (towards the nearer wall) or else its
// inner, where there is room for them clear of the bed's walls and the stop's other loads; with
// neither, at its far end as near the wall as they can stand.
// A drop's: at its near end, to lead it out, back to the bed's very edge if need be.
function teamSpots(L: TruckLayout, model: TruckModel, stop: Stop, slot0: number, trips: number, pickup: boolean): [number, number][] {
  const pos = bedUnits(L, model, stop.cargo, stop.units, slot0), out: [number, number][] = [], size = CARGO_MODELS[stop.cargo]?.size ?? [0.5, 0.5, 0.5];
  const [l, , w] = size, room = L.hw - TEAM_WALL;
  for (let i = 0; i < trips; i++) {
    const [u0, u1] = tripUnits(stop, trips, i), ps = pos.slice(u0, u1), others = pos.filter((_, k) => k < u0 || k >= u1);
    const x = ps.length ? ps.reduce((a, p) => a + p[0], 0) / ps.length : L.bedRear + 1, z = ps.length ? ps.reduce((a, p) => a + p[2], 0) / ps.length : 0;
    if (!pickup) { out.push([Math.min(L.bedFront - 0.8, Math.max(L.bedRear + TEAM_SILL, x - teamSpan(stop.cargo, l) / 2)), z]); continue; }
    const end = x + l / 2, at = end + teamSpan(stop.cargo, l) / 2 - l / 2;
    if (at <= L.bedFront - TEAM_WALL) { out.push([at, z]); continue; }
    const clear = (px: number, pz: number) => Math.abs(pz) <= room && !others.some((p) => Math.abs(px - p[0]) < l / 2 + BODY_R && Math.abs(pz - p[2]) < w / 2 + BODY_R);
    const bx = Math.max(L.bedRear + 0.6, end - 0.25), outer = Math.sign(z) || 1;
    const sides = [outer, -outer].map((sd) => z + sd * (w / 2 + TEAM_CLEAR)).filter((pz) => clear(bx, pz));
    out.push(sides.length ? [bx, sides[0]] : [Math.min(at, L.bedFront - TEAM_WALL), z]);
  }
  return out;
}

// A forklift's first trip from the road side starts by driving out from where it's parked, and
// its last ends driving back, this long (s).
export const ROAD_PARK = 2.4;
// The forklift goes this fast on average (m/s; at its fastest half as fast again, easing in and
// out): on each leg of a trip to a stack, and out of a front door to a flatbed's side, over the
// straight distance and this much more for its curve out of the doorway and round to the deck (m).
const FORK_V = 1.3, FORK_CURVE = 4;
// A trip to or from a stack is this much longer than its legs (s): a moment parked between trips.
const STACK_SLACK = 0.5;
// Turning, the load out on the forks sweeps round this much further out than the forklift's heel (m).
const FORK_LOAD = 1.6;
// ---- a stacking trip's legs ----------------------------------------------------------------------
// In the truck's frame: the forklift's heel (the forks' root, on the ground) and the forks' yaw
// (forks along (cos yaw, -sin yaw): towards the truck at PI/2). Its middle is 1.15 m behind the heel.
export interface YPose { x: number; z: number; yaw: number }
export interface YLeg { d: number; kind: "line" | "s" | "curve" | "spin" | "turn" | "hold"; a: YPose; b: YPose; f0: number; f1: number; ev?: "take" | "give"; rev?: boolean; truck?: boolean }
export const FL_MID = 1.15;
export const LONG_TINES = (1.27 + 0.55) / 1.13;   // tines long enough to reach a flatbed's middle from its side
export const fvec = (yaw: number): [number, number] => [Math.cos(yaw), -Math.sin(yaw)];
function spinTo(a: YPose, d: number): YPose {
  const [fx, fz] = fvec(a.yaw), cx = a.x - fx * FL_MID, cz = a.z - fz * FL_MID, yaw = a.yaw + d, [gx, gz] = fvec(yaw);
  return { x: cx + gx * FL_MID, z: cz + gz * FL_MID, yaw };
}
// (No quicker than its way allows at FORK_V: the forklift along a line, an S or a curve (longer
// than straight), round its middle on the spot, or both; turning, the load out on its forks
// sweeps round further than the forklift itself: FORK_LOAD.)
function legLen(kind: YLeg["kind"], a: YPose, b: YPose) {
  const d = Math.hypot(b.x - a.x, b.z - a.z), arc = Math.abs(b.yaw - a.yaw) * (FL_MID + FORK_LOAD);
  return kind === "line" ? d : kind === "s" ? d * 1.3 + arc : kind === "curve" ? d * 1.4 + arc : kind === "spin" ? arc : kind === "turn" ? d + arc : 0;
}
const leg = (d: number, kind: YLeg["kind"], a: YPose, b: YPose, f0: number, f1: number, o: Partial<YLeg> = {}): YLeg => ({ d: Math.max(d, legLen(kind, a, b) / FORK_V), kind, a, b, f0, f1, ...o });
// The yard: off the deck, round on the pavement (the load swinging away from the container), and
// up the yard to the stack; a pickup the other way. Starting and ending parked by the stack. Fork
// heights are the forks' own (over the ground under the forklift).
function yardLegs(L: TruckLayout, F: { s: number; sx: number; sz: number }, ux: number, uy: number, sy: number, pickup: boolean): YLeg[] {
  const reach = L.hw + 0.15, travel = 0.15, up = 0.06;
  const B: YPose = { x: ux, z: reach, yaw: Math.PI / 2 }, R: YPose = { x: ux, z: L.hw + 2.55, yaw: Math.PI / 2 };
  const turn = F.s > 0 ? -Math.PI : Math.PI, Rp = spinTo(R, turn);
  const P2: YPose = { x: F.sx, z: F.sz - reach, yaw: Rp.yaw }, Pk: YPose = { ...P2, z: P2.z - 0.8 };
  const tl = uy + 0.05, sl = sy - CURB_H + 0.05;
  return pickup ? [
    leg(0.8, "line", Pk, P2, travel, sl),
    leg(0.4, "hold", P2, P2, sl, sl, { ev: "take" }),
    leg(0.4, "hold", P2, P2, sl, sl + up),
    leg(2.0, "s", P2, Rp, sl + up, travel, { rev: true }),
    leg(1.4, "spin", Rp, R, travel, tl + up),
    leg(1.0, "line", R, B, tl + up, tl + up),
    leg(0.5, "hold", B, B, tl + up, tl, { ev: "give", truck: true }),
    leg(1.0, "line", B, R, tl, tl),
    leg(1.4, "spin", R, Rp, tl, travel),
    leg(2.0, "s", Rp, Pk, travel, travel),
  ] : [
    leg(2.0, "s", Pk, Rp, travel, travel, { rev: true }),
    leg(1.4, "spin", Rp, R, travel, tl),
    leg(1.0, "line", R, B, tl, tl),
    leg(0.4, "hold", B, B, tl, tl, { ev: "take", truck: true }),
    leg(0.4, "hold", B, B, tl, tl + up),
    leg(1.0, "line", B, R, tl + up, tl + up),
    leg(1.4, "spin", R, Rp, tl + up, travel),
    leg(2.0, "s", Rp, P2, travel, sl + up),
    leg(0.5, "hold", P2, P2, sl + up, sl, { ev: "give" }),
    leg(0.8, "line", P2, Pk, sl, travel),
  ];
}
// The road side: the forklift parks on the pavement beyond the stack (H), and works through the
// inner lane: out to C (facing along the truck, behind it), round into the truck's side (B) or up
// onto the pavement to the stack (P2), and back to C in reverse. Its first trip starts by turning
// out of where it's parked; its last ends turning back in. Loads ride high alongside the truck.
function roadLegs(L: TruckLayout, F: { front: number; sx: number; sz: number }, ux: number, uy: number, sy: number, pickup: boolean, first: boolean, last: boolean): YLeg[] {
  const reach = L.hw + 0.15, travel = 0.15, up = 0.06, high = 1.6, tl = uy + 0.05, sl = sy - CURB_H + 0.05;
  const B: YPose = { x: ux, z: -reach, yaw: -Math.PI / 2 }, C: YPose = { x: F.sx - 2, z: -3, yaw: 0 };
  const P2: YPose = { x: F.sx, z: F.sz - reach, yaw: -Math.PI / 2 }, H: YPose = { x: F.sx - 4.2, z: F.front - 1.6, yaw: Math.PI };
  const out = first ? [leg(ROAD_PARK, "turn", H, C, travel, travel)] : [];
  out.push(...(pickup ? [
    leg(2.4, "curve", C, P2, travel, sl),
    leg(0.4, "hold", P2, P2, sl, sl, { ev: "take" }),
    leg(0.4, "hold", P2, P2, sl, sl + up),
    leg(2.4, "curve", P2, C, sl + up, high, { rev: true }),
    leg(3.0, "curve", C, B, high, tl + up),
    leg(0.5, "hold", B, B, tl + up, tl, { ev: "give", truck: true }),
    leg(3.0, "curve", B, C, tl, travel, { rev: true }),
  ] : [
    leg(3.0, "curve", C, B, travel, tl),
    leg(0.4, "hold", B, B, tl, tl, { ev: "take", truck: true }),
    leg(0.4, "hold", B, B, tl, tl + up),
    leg(3.0, "curve", B, C, tl + up, high, { rev: true }),
    leg(2.4, "curve", C, P2, high, sl + up),
    leg(0.6, "hold", P2, P2, sl + up, sl, { ev: "give" }),
    leg(2.4, "curve", P2, C, sl, travel, { rev: true }),
  ]));
  if (last) out.push(leg(ROAD_PARK, "turn", C, H, travel, travel));
  return out;
}

// A stop's stack in the truck's frame, from its door's place there (dx along the truck, `front`
// out to its side): the building's front, the kerb, the column (sx) and its depth (sz), and per
// trip the bed unit it moves and the layer it goes to or comes from. The trips are the chores'
// (tripCount, tripUnits: one bundle each): drops take the bed's last unit first, onto the stack;
// pickups fill the bed in order, from the top of a stack that starts full.
export type StackGeom = ReturnType<typeof stackGeom>;
export function stackGeom(L: TruckLayout, model: TruckModel, stop: Stop, dx: number, front: number, mode: "yard" | "road") {
  // The yard's column: opposite the bed's middle (the truck stops clear of the container:
  // journey.ts YARD_PULL), but never beside the container.
  const mid = (L.bedRear + L.bedFront) / 2, s = Math.sign(mid - dx) || 1, clear = dx + s * (END_ON_HALF + 0.4 + CARGO_MODELS[stop.cargo].size[0] / 2);
  const sx = mode === "road" ? L.rear - 2.4 : s > 0 ? Math.max(mid, clear) : Math.min(mid, clear);
  const units = bedUnits(L, model, stop.cargo, stop.units, stop.slot ?? 0), pickup = stop.kind === "pickup";
  const n = units.length ? tripCount(L, stop.cargo, stop.units) : 0;
  const trips = Array.from({ length: n }, (_, i) => ({ u: Math.min(units.length - 1, tripUnits(stop, n, i)[0]), layer: pickup ? n - 1 - i : i }));
  return { mode, s, front, kerb: front - KERB, sx, sz: mode === "yard" ? front + 4.5 : front - 0.55, units, trips };
}
// Trip i's legs (mh: a bundle's height, for the stack's layers).
export function stackTripLegs(L: TruckLayout, P: StackGeom, i: number, mh: number, pickup: boolean) {
  const T = P.trips[i], unit = P.units[T.u], sy = CURB_H + T.layer * (mh + 0.005);
  return P.mode === "yard" ? yardLegs(L, P, unit[0], unit[1], sy, pickup)
    : roadLegs(L, P, unit[0], unit[1], sy, pickup, i === 0, i === P.trips.length - 1);
}


// At the kerb with no front door: where the load is fetched on the pavement behind the truck
// (truck frame) and which way the driver faces there: from the ramp's foot (or the lowered lift
// gate) towards it. crew.ts stages the loads in front of it. (`k`: the k-th choice of spot: where a
// large load left on the jack can be planned to, jackStays.)
// (The usual; well back along the pavement; and there, nearer the kerb, for a shallow pavement.)
export const PAVE_SPOTS = 3;
// The fetches in a stop's chores, one each: where it is (the walk to it ends there) and which way
// it faces, or null where that isn't known.
export function fetchSpots(ch: Chore[]): ({ spot: number[]; face: number } | null)[] {
  return ch.flatMap((c, i) => c.kind === "fetch" ? [ch[i - 1]?.b ? { spot: ch[i - 1].b!, face: c.face ?? 0 } : null] : []);
}
export function pavementFetch(L: TruckLayout, k = 0) {
  const spot: [number, number, number] = [L.bedRear - 2.2 - (k ? 3.6 : 0), 0, L.hw + 3.2 - (k === 2 ? 0.7 : 0)];
  const foot = L.loader !== "liftgate" ? L.bedRear - L.rampRun - RAMP_HOLD : L.bedRear - GATE_LEN - GATE_OFF;
  return { spot, face: Math.atan2(-spot[2], spot[0] - foot) };
}

// A pallet-jack load that can't be turned round anywhere in the bed (a hot tub, a museum crate,
// ducks): drawn in backwards up the ramp to the front, the jack left under it and the driver
// climbing out over it; at its drop, climbing back in over it to the jack and pushing it out,
// forks first. (The driver uphill of it both ways. One at a time: one jack.)
// (Worked out once for each truck and cargo, whatever planning budget is left: jackBudget.)
const jackStaysKnown = new Map<string, boolean>();
export function jackStays(L: TruckLayout, cargo: string): boolean {
  const c = CARGO_BY_ID.get(cargo), m = CARGO_MODELS[cargo];
  if (!c || !m || STYLE[c.handling].tool !== "palletJack" || L.trailer || L.flatbed) return false;
  const key = `${cargo}|${L.rear},${L.bedRear},${L.bedFront},${L.hw}`, got = jackStaysKnown.get(key);
  if (got !== undefined) return got;
  const left = jackLeft();
  jackBudget(Infinity);
  const stays = !jackPivot({ L, rampHW: RAMP_HW, free: L.bedFront, bed: [], obs: [], door: null, load: m.size }, { x: (Math.min(L.rear, L.bedRear) + L.bedFront) / 2, z: 0, h: Math.PI }, 0);
  jackBudget(left);
  jackStaysKnown.set(key, stays);
  return stays;
}

// ---- the pallet jack's moves --------------------------------------------------------------
// Each run of walks with the pallet jack in hand between where it is still (taken from its rest,
// at the doorway, set down in the bed or on the pavement, put back) replaced by its planned moves
// (jackplan.ts): on the ground round the truck and what stands there, out of the doorway and in
// square to it (turning as it comes out, where the pavement is narrow), along the walk ramp with
// its forks downhill (the driver above it: drawn up, pushed down; a load too wide to turn in the
// bed, a hot tub, the other way round, pushed up and drawn down), turned in the bed where there
// is room between its loads, and straight out from under a load just set down (or in under one).
// A run that can't be planned clear of everything is planned with less in the way (jackRuns).
const JACK_BUDGET = 1200;
// Drawn up the walk ramp, the pallet jack is pushed on past its lineup behind the ramp by the first
// of these (m) whose way is clear, and drawn back from there.
const JK_PAST = [0.8, 1.4, 2.2];
// A pallet jack turned round inside a doorway comes out at the first of these angles from square
// (rad) that lets it be steered on round curves.
const JK_OUT_ANGLES = [0, -0.4, 0.4, -0.7, 0.7];
// (And the way it comes out at an angle, this far (m) straight on to where it starts from, is clear
// of the doorway's frame.)
const JK_OUT_RUN = 1.6;   // (about 30 ms in node, all told, for a stop that uses it up)
// (Planning only to see whether a door will do, journey.ts: clear of what stands on the pavement
// at most, none of the rest let go.)
let jackTrying = false;
// (The last, most relaxed, planning's own budget for the whole stop, jackRuns.)
let jackLast = 0;
export function jackTrial<T>(f: () => T): T { jackTrying = true; try { return f(); } finally { jackTrying = false; } }   // (about 60 ms in node, all told, for a stop that uses it up)
interface JackCtx { L: TruckLayout; model: TruckModel; stop: Stop; slot0: number; aboard: { cargo: string; slot: number; units: number }[];
  kerbDoor: { x: number; z: number; yaw: number; half?: number } | null; obstacles: WalkObstacle[]; size: number[]; speed: number; dock?: boolean;
  facade?: { x: number; z: number; yaw: number } | null;   // (with no door to go through: the building's front, from one that won't do, all wall)
  dockDoor?: number | null }   // (at a dock: its door's half width, on the bay's line, in the building's wall behind the platform)
function jackLegs(out: Chore[], k: JackCtx): boolean {
  // (Whether a load can be turned round anywhere in the bed: worked out before the budget is set.)
  const L = k.L, canTurn = !jackStays(L, k.stop.cargo);
  // (Planning given up past this many move checks: the walks as walked. Unlimited again after.)
  // (A load left on the jack is one trip, but a heavy one to look round: three trips' worth.)
  jackBudget(canTurn ? JACK_BUDGET : 3 * JACK_BUDGET);
  jackLast = 8 * JACK_BUDGET;
  try { return jackRuns(out, k, canTurn); } finally { jackBudget(Infinity); }
}
function jackRuns(out: Chore[], k: JackCtx, canTurn: boolean): boolean {
  const { L, stop } = k, pickup = stop.kind === "pickup", reach = JACK_LEAD + JACK_MID;
  const fv = (h: number): [number, number] => [Math.cos(h), -Math.sin(h)];
  const door = k.kerbDoor ? (() => { const [fx, fz] = fv(k.kerbDoor!.yaw); return { x: k.kerbDoor!.x + fx * 0.5, z: k.kerbDoor!.z + fz * 0.5, nx: -fx, nz: -fz, half: k.kerbDoor!.half ?? 0.6 }; })() : null;
  const obs = k.obstacles.map((o) => ({ x: o.x, z: o.z, r: o.r, hand: o.hand ?? o.r }));
  // (A dock's building behind its platform, through its doorway: kept clear of on the first try only;
  // where its fetch, a step into the doorway at an angle, can't be planned clear of the frame, let be.)
  const dockWall = k.dock && k.dockDoor ? { x: L.rear - DOCK_DEPTH, z: 0, nx: 1, nz: 0, half: k.dockDoor } : null;
  const wall = !door && k.facade ? (() => { const [fx, fz] = fv(k.facade!.yaw); return { x: k.facade!.x + fx * 0.5, z: k.facade!.z + fz * 0.5, nx: -fx, nz: -fz, half: 0 }; })() : null;
  // The bed's loads: this stop's units by trip, and the other stops' all along (their floor
  // footprints, a little inside them: packed in their rows, they meet).
  const units = bedUnits(L, k.model, stop.cargo, stop.units, k.slot0), trips = Math.max(1, out.filter((c) => c.kind === "stow").length);
  const print = (p: number[], sz: number[]) => ({ x0: p[0] - sz[0] / 2 + 0.06, x1: p[0] + sz[0] / 2 - 0.06, z0: p[2] - sz[2] / 2 + 0.02, z1: p[2] + sz[2] / 2 - 0.02 });
  const others = k.aboard.flatMap((a) => { const sz = CARGO_MODELS[a.cargo]?.size ?? [0.5, 0.5, 0.5]; return bedUnits(L, k.model, a.cargo, a.units, a.slot).map((p) => print(p, sz)); });
  const rest = (c: Chore) => { const r = c.rest!, [fx, fz] = fv(r.yaw); return { x: r.at[0] + fx * JACK_MID, z: r.at[2] + fz * JACK_MID, h: r.yaw }; };
  const held = (d: number[], h: number): JPose => { const [fx, fz] = fv(h); return { x: d[0] + fx * reach, z: d[2] + fz * reach, h }; };
  const foot = L.bedRear - L.rampRun, back = Math.min(L.rear, L.bedRear);
  for (let i = 0; i < out.length; i++) {
    if (!(out[i].kind === "walk" && out[i].tool === "palletJack")) continue;
    let j = i;
    while (j + 1 < out.length && out[j + 1].kind === "walk" && out[j + 1].tool === "palletJack") j++;
    const first = out[i], last = out[j];
    if (!first.a || !last.b) { i = j; continue; }
    // (With nothing before or after the run: as if a moment's pause, facing the way it goes.)
    const way = (c: Chore) => Math.atan2(-(c.b![2] - c.a![2]), c.b![0] - c.a![0]);
    const prev: Chore = out[i - 1] ?? { kind: "wait", group: first.group, len: 0, face: way(first) };
    const next: Chore = out[j + 1] ?? { kind: "wait", group: last.group, len: 0, face: way(last) };
    const item = first.item ?? null, loaded = !!item, load = loaded ? k.size : null;
    let A = prev.kind === "toolGet" && prev.rest ? rest(prev) : held(first.a, prev.flip ? flipYawOut(prev) : prev.face ?? 0);   // (turned round inside a doorway: out ahead, facing out)
    let curvesOnly = false;   // (planning only ways steered round on curves on the ground: ground)
    const B = next.kind === "toolPut" && next.rest ? rest(next) : held(last.b, next.face ?? 0);
    // The bed as it is for this run: which trip (by the stows before it), what's in it: a pickup's
    // trips so far, a drop's still to go. `under`: the trip under the forks as it starts (just set
    // down) or ends (about to be taken up), which the forks slide straight out from (or in) under.
    const si = out.slice(0, i).filter((c) => c.kind === "stow").length;   // stows already done
    const inFirst = prev.kind === "stow", inLast = next.kind === "stow";
    const aboard: number[] = [];
    for (let t = 0; t < trips; t++) if (pickup ? t < si : t >= si) aboard.push(t);
    const under = pickup ? (inFirst ? si - 1 : -1) : (inLast ? si : -1);
    const boxes = (ts: number[]) => ts.flatMap((t) => { const [u0, u1] = tripUnits(stop, trips, t); return units.slice(u0, u1); })
      .map((p) => print(p, k.size));
    const bedAll = [...boxes(aboard), ...others], bedOut = [...boxes(aboard.filter((t) => t !== under)), ...others];
    const ext = jackExtents(load), half = Math.max(0.33, (load?.[2] ?? 0) / 2);
    let laid: JackWorld["ground"] = [], relax = 0;   // relax: 1, what stands on the pavement passed through; 2, the corners of the loads in the bed too; 3, the doorway's edges (or with no door, the building's front), a set-down load's corners and the bed's loads too
    const world = (bed = bedAll): JackWorld => ({ L, rampHW: k.dock ? 3 : RAMP_HW, free: L.bedFront, bed: relax >= 3 ? [] : relax >= 2 ? bed.map((b) => ({ x0: b.x0 + 0.3, x1: b.x1 - 0.3, z0: b.z0 + 0.3, z1: b.z1 - 0.3 })).filter((b) => b.x0 < b.x1 && b.z0 < b.z1) : bed, obs: k.dock || relax >= 1 ? [] : obs, door: k.dock ? (relax >= 1 ? null : dockWall) : relax >= 3 ? (door ? { ...door, half: door.half + 0.1 } : null) : door ?? wall, load, ground: relax >= 3 ? (laid ?? []).map((g) => ({ ...g, l: Math.max(0.2, g.l - 0.6), w: Math.max(0.2, g.w - 0.6) })) : laid });
    const inBed = (p: JPose) => p.x > back - 0.3 && Math.abs(p.z) < L.hw;
    // Straight back out from a stowed load (or in under one), square in the bed: back until it is
    // past every load beside it. null if that is blocked.
    const slide = (p: JPose): JMove | null => {
      if (Math.abs(Math.sin(p.h)) > 0.05) return null;
      const [fx] = fv(p.h);
      const beside = (x: number) => bedAll.some((b) => b.z1 > p.z - half - 0.1 && b.z0 < p.z + half + 0.1 && Math.min(x - fx * ext.back, x + fx * ext.front) < b.x1 && Math.max(x - fx * ext.back, x + fx * ext.front) > b.x0);
      let x = p.x;
      for (let n = 0; n < 80 && beside(x); n++) x -= fx * 0.05;
      if (Math.abs(x - p.x) < 0.02) return null;
      const m: JMove = { kind: "roll", p0: p, p1: { x, z: p.z, h: p.h } };
      return jackMoveClear(world(bedOut), m) ? m : null;
    };
    // (Out of a doorway it was turned round inside: already facing out, nothing to draw it back out of.)
    const doorWays = (w: JackWorld, r: JPose, curves: boolean) => prev.flip && Math.hypot(r.x - A.x, r.z - A.z) < 0.05 && Math.abs(r.h - A.h) < 0.05 ? [[]] : jackDoorWays(w, r, reach + 1.5, curves);
    // At a stop with no doorway, a load set down on the pavement just now (or about to be taken
    // up): drawn straight back out from under it first (or pushed in under it last), and kept
    // clear of otherwise. (Where its forks hold it: crew.ts stageLocal.)
    const setDown = (p: JPose) => { const [fx, fz] = fv(p.h); return { x: p.x + fx * (0.77 - JACK_MID), z: p.z + fz * (0.77 - JACK_MID), h: p.h, l: k.size[0], w: k.size[2] }; };
    const atFetch = (c: Chore) => !door && !k.dock && c.kind === "fetch";   // (a dock's is its building's doorway)
    // (Several trips' pallets waiting on the pavement side by side, crew.ts stageLocal: not planned
    // round, so walked as before.)
    // (A load to be set down there, or waiting there to be taken up: turned either way, as far
    // as side-on along the pavement, if need be, so the jack can be drawn out from under it after
    // (or pushed in under it), and the fetch faces that way.)
    if (atFetch(next)) {
      const ok = (h: number) => {
        const b = held(last.b!, h), [fx, fz] = fv(h), wU: JackWorld = { L, rampHW: RAMP_HW, free: L.bedFront, bed: [], obs, door: door ?? wall, load: null, ground: [setDown(b)] };
        if (!jackPoseClear({ ...wU, load: k.size, ground: [] }, b)) return false;   // (the load itself clear of the building and what stands there)
        for (let d = 0.1; d < 3; d += 0.1) {
          const q: JPose = { x: b.x - fx * d, z: b.z - fz * d, h };
          if (!jackPoseClear(wU, q)) continue;
          const m: JMove = { kind: "roll", p0: b, p1: q };
          return jackMoveClear({ ...wU, ground: [] }, m) && jackDriverClear(wU, ...jackDriverAt(m, 1));
        }
        return false;
      };
      const f0 = next.face ?? 0, f = [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.57, -1.57].map((d) => f0 + d).find(ok);
      if (f !== undefined && f !== f0) { next.face = f; B.h = f; const b = held(last.b!, f); B.x = b.x; B.z = b.z; }
    }
    const staged = atFetch(prev) && !loaded ? [setDown(A)] : atFetch(next) && !loaded ? [setDown(B)] : [];
    // (And the other trips' loads waiting there, side by side, as crew.ts stageLocal has them: a
    // pickup's still to come, a drop's already set down.)
    const waiting: NonNullable<JackWorld["ground"]> = [];
    if (!door && !k.dock) {
      const fs = out.map((c, n) => [c, n] as const).filter(([c]) => c.kind === "fetch"), done = fs.filter(([, n]) => n < i).length;
      for (let t = 0; t < fs.length; t++) {
        const [f, n] = fs[t], at = out[n - 1]?.b;
        if (!at || (pickup ? t < done || (t === done && atFetch(next)) : t >= done || (t === done - 1 && atFetch(prev)))) continue;
        const face = f.face ?? 0, ahead = JACK_LEAD + 0.77;   // (each trip's from its own spot: planChores facilityFor)
        waiting.push({ x: at[0] + Math.cos(face) * ahead, z: at[2] - Math.sin(face) * ahead, h: face, l: k.size[0], w: k.size[2] });
      }
    }
    const clearOf = (p: JPose): JMove | null => {
      const [fx, fz] = fv(p.h), wG: JackWorld = { ...world(), ground: [...staged, ...waiting] };
      for (let d = 0.1; d < 3; d += 0.1) {
        const q: JPose = { x: p.x - fx * d, z: p.z - fz * d, h: p.h };
        if (!jackPoseClear(wG, q)) continue;
        const m: JMove = { kind: "roll", p0: p, p1: q };
        return jackMoveClear({ ...world(), ground: waiting }, m) && jackDriverClear(wG, ...jackDriverAt(m, 1)) ? m : null;
      }
      return null;
    };
    const plan = (hRamp: number): JMove[] | null => {
      const moves: JMove[] = [];
      let a = A, b = B;
      if (inFirst) { const s0 = slide(a); if (s0) { moves.push(s0); a = s0.p1; } }
      let tail0: JMove | null = null;
      laid = waiting;
      if (staged.length && atFetch(prev)) { const s0 = clearOf(a); if (!s0) return null; moves.push(s0); a = s0.p1; }
      if (staged.length && atFetch(next)) { const s1 = clearOf(b); if (!s1) return null; tail0 = { kind: "roll", p0: s1.p1, p1: b }; b = s1.p1; }
      laid = [...staged, ...waiting];
      let tail: JMove | null = null;
      if (inLast) { const s1 = slide(b); if (s1) { tail = { kind: "roll", p0: s1.p1, p1: b }; b = s1.p1; } }
      // On the ramp: lined up behind its foot, all of it off it; in the bed, all of it aboard.
      const lineup: JPose = { x: foot - (Math.abs(hRamp) > 1 ? ext.back : ext.front) - 0.35, z: 0, h: hRamp };
      const entry: JPose = { x: back + (Math.abs(hRamp) > 1 ? ext.front : ext.back) + 0.05, z: 0, h: hRamp };
      // In the bed, from p to q: straight if they line up, else turned on the spot where there is room.
      // (Steered there on curves, pushed or drawn, where that is clear: across to a load beside
      // the aisle, say.)
      const bed = (p: JPose, q: JPose) => {
        const w = world(), c = jackCurve(w, p, q) ?? jackCurve(w, q, p);
        return c ? (jackMotion(c[0]) > 0 && Math.hypot(c[0].p0.x - p.x, c[0].p0.z - p.z) < 0.02 ? c : jackReverse(c)) : jackBedJoin(w, p, q, entry.x);
      };
      // On the ground, from p to q, round the truck and the ramp and what stands there; out of the
      // doorway and into it square to it.
      const ground = (p: JPose, q: JPose): JMove[] | null => {
        const w = world();
        // The straightest way, if it is clear: straight out of the doorway and round.
        {
          const o = doorWays(w, p, false)[0], n = doorWays(w, q, false).map(jackReverse)[0];
          if (o && n) {
            const p1 = o.length ? o[o.length - 1].p1 : p, q1 = n.length ? n[0].p0 : q;
            // Steered round on curves, pushed all the way (jackCurve). To the ramp's foot, to be
            // drawn up it: pushed on past the lineup, curving onto the ramp's line, and drawn
            // straight back to it, so it goes up the ramp as it came, without stopping to turn.
            if (q === lineup) {
              const [fx, fz] = fv(q1.h);
              for (const d of JK_PAST) {
                const past: JPose = { x: q1.x + fx * d, z: q1.z + fz * d, h: q1.h }, back: JMove = { kind: "roll", p0: past, p1: q1 };
                const c = jackMoveClear(w, back) ? jackCurve(w, p1, past) : null;
                if (c) return [...o, ...c, back, ...n];
              }
            } else { const c = jackCurve(w, p1, q1); if (c) return [...o, ...c, ...n]; }
            if (curvesOnly) return null;
            const via = jackRoute([p1.x, 0, p1.z], [q1.x, 0, q1.z], w, half), mid = via && jackJoin(w, p1, via.slice(0, -1), q1, "either", false);
            if (mid) return [...o, ...mid, ...n];
          }
        }
        // Else along the pavement until there's room, and down into the road behind the truck
        // (jackStreet), to or from the ramp's foot.
        // (Straight out of the doorway first; curving out of it only if that finds nothing.)
        const street = (r: JPose, end: JPose) => jackStreet(w, r, doorWays(w, r, false), end) ?? (door ? jackStreet(w, r, doorWays(w, r, true), end) : null);
        if (q === lineup) { const m = street(p, q); if (m) return m; }
        if (p === lineup) { const m = street(q, p); if (m) return jackReverse(m); }
        // (Else nothing here: planned again with less in the way, jackRuns.)
        return null;
      };
      const ramp = (p: JPose, q: JPose): JMove[] | null => { const m: JMove = { kind: "roll", p0: p, p1: q }; return jackMoveClear(world(), m) ? [m] : null; };
      let body: JMove[] | null;
      // (At a dock: across its level platform, lined up square behind the bed, all of it off it,
      // and straight in or out.)
      const square = (h: number): JPose => ({ x: back - Math.max(ext.front, ext.back) - 0.3, z: 0, h });
      if (k.dock) {
        const sq = square(inBed(a) ? a.h : b.h), w = world();
        if (inBed(a) && inBed(b)) body = bed(a, b);
        else if (inBed(a)) { const x = bed(a, { ...entry, h: sq.h }), y = x && jackJoin(w, x.length ? x[x.length - 1].p1 : a, [], sq, "either", false), z = y && jackJoin(w, sq, [], b); body = x && y && z ? [...x, ...y, ...z] : null; }
        else if (inBed(b)) { const x = jackJoin(w, a, [], sq), y = x && jackJoin(w, sq, [], { ...entry, h: sq.h }, "either", false), z = y && bed({ ...entry, h: sq.h }, b); body = x && y && z ? [...x, ...y, ...z] : null; }
        else body = jackJoin(w, a, [], b);
      }
      else if (inBed(a) && inBed(b)) body = bed(a, b);
      else if (inBed(a)) { const x = bed(a, entry), y = x && ramp(entry, lineup), z = y && ground(lineup, b); body = x && y && z ? [...x, ...y, ...z] : null; }
      else if (inBed(b)) { const x = ground(a, lineup), y = x && ramp(lineup, entry), z = y && bed(entry, b); body = x && y && z ? [...x, ...y, ...z] : null; }
      else body = ground(a, b);
      if (!body) return null;
      return jackSmooth(world(), [...moves, ...body, ...(tail ? [tail] : []), ...(tail0 ? [tail0] : [])]);
    };
    // (Forks downhill, the driver above them: a load that can't be turned round in the bed comes
    // in that way and goes out the same way, jackStays.)
    // Where it can't be planned clear of everything, it is planned through what stands on the
    // pavement, then through the loads, then a doorway's edges, rather than not at all: a brush past a bench or
    // a corner of a pallet, a doorway's edge, never through the truck. (The last with a budget of its own, for the stop.)
    // Turned round inside a doorway, out of sight, it can come out angled as well as square: at the
    // first of JK_OUT_ANGLES from square that lets it be steered round on curves from there.
    let moves: JMove[] | null = null;
    if (prev.flip && !k.dock && door) {
      const y0 = flipYawOut(prev);
      curvesOnly = true;
      for (const off of JK_OUT_ANGLES) {
        if (jackSpent()) break;
        A = held(first.a, y0 + off);
        // (Out through the doorway that way, the jack's length and more straight on to where it
        // starts from: clear of the frame.)
        const [fx, fz] = fv(A.h), out: JMove = { kind: "roll", p0: { x: A.x - fx * JK_OUT_RUN, z: A.z - fz * JK_OUT_RUN, h: A.h }, p1: A };
        if (off && !jackMoveClear(world(), out)) continue;
        moves = plan(Math.PI);
        if (moves) { if (off) { prev.flipYaw = [prev.flipYaw?.[0] ?? 0, (prev.flipYaw?.[1] ?? Math.PI) + off]; prev.flipOff = off; } break; }
      }
      curvesOnly = false;
      if (!moves) A = held(first.a, y0);
    }
    if (!moves) moves = jackSpent() ? null : plan(Math.PI);
    if (!moves) { relax = 1; moves = jackSpent() ? null : plan(Math.PI); }
    if (!moves && !jackTrying) { relax = 2; moves = jackSpent() ? null : plan(Math.PI); }
    if (!moves && !jackTrying && jackLast > 0) {
      relax = 3; const left = jackLeft(), give = Math.min(4 * JACK_BUDGET, jackLast);
      jackBudget(give); moves = plan(Math.PI); jackLast -= give - Math.max(0, jackLeft()); jackBudget(left);
    }
    relax = 0;
    if (!moves || !moves.length) { if (!out[i - 1] || !out[j + 1]) { i = j; continue; } return false; }   // (a run at the very start or end: just itself left as walked)
    // The driver from the jack's pose, blended from where they stand to start, to where the next
    // chore has them at the end.
    moves[0] = { ...moves[0], from: [first.a[0], first.a[2]] };
    moves[moves.length - 1] = { ...moves[moves.length - 1], to: [last.b[0], last.b[2]] };
    const speed = loaded ? k.speed : TOOL, rate = loaded ? JACK_TURN_LOADED : JACK_TURN;
    const y = (x: number, z: number) => k.dock ? first.a![1] : x > back - 0.3 && Math.abs(z) < L.hw ? L.floor : 0;
    for (const m of moves) m.lead ??= jackLead(load);
    const legs: Chore[] = moves.map((m, n) => {
      const [ax, az] = jackDriverAt(m, 0), [bx, bz] = jackDriverAt(m, 1);
      // (A move run on into from the one before, or on into the next, isn't eased in or out
      // there (crewpath.ts): it takes that much less of the quarter longer jackMoveLen allows.)
      const flows = (jackFlows(moves[n - 1], m) ? 1 : 0) + (jackFlows(m, moves[n + 1]) ? 1 : 0);
      return { kind: "walk", group: first.group, len: jackMoveLen(m, speed, rate, TOOL) / (1 + 0.125 * flows), a: [ax, y(ax, az), az], b: [bx, y(bx, bz), bz], tool: "palletJack", item: first.item, jack: m, linear: inBed(m.p0) && inBed(m.p1) };
    });
    out.splice(i, j - i + 1, ...legs);
    i += legs.length - 1;
  }
  return true;
}
// The jack's middle's way from a to b on the ground (legs, ending at b): round the truck and its
// ramp, the building either side of its door, what stands on the pavement and a load set down
// there, all grown by the
// jack's (or its load's) half width.
function jackRoute(a: [number, number, number], b: [number, number, number], w: JackWorld, half: number): [number, number][] | null {
  // (boxRoute keeps BODY_R more clear of each than this.)
  const L = w.L, g = Math.max(0, half + 0.12 - BODY_R), back = Math.min(L.rear, L.bedRear), foot = L.bedRear - L.rampRun;
  const bx: WalkBox[] = [{ x: (back + L.front) / 2, z: 0, hx: (L.front - back) / 2 + g, hz: L.hw + g, ax: 1, az: 0 }, { x: (foot + back) / 2, z: 0, hx: (back - foot) / 2, hz: L.hw + g, ax: 1, az: 0 }];
  // (The building, deep behind its front: never round behind it and in through its door.)
  if (w.door) { const d = w.door, ax = -d.nz, az = d.nx; for (const s of [-1, 1]) bx.push({ x: d.x + ax * s * (d.half + 60) - d.nx * 15, z: d.z + az * s * (d.half + 60) - d.nz * 15, hx: 60, hz: 15 + g, ax, az }); }
  for (const o of w.obs) { const r = Math.max(o.r, Number.isNaN(o.hand) ? 0 : o.hand); bx.push({ x: o.x, z: o.z, hx: r + g, hz: r + g, ax: 1, az: 0 }); }
  // (And a load set down on the pavement.)
  for (const l of w.ground ?? []) bx.push({ x: l.x, z: l.z, hx: l.l / 2 + g, hz: l.w / 2 + g, ax: Math.cos(l.h), az: -Math.sin(l.h) });
  const legs = boxRoute(a, b, bx);
  return legs ? legs.map((p) => [p[0], p[2]] as [number, number]) : null;
}

// Chores for a pickup or drop. (Swaps use swapChores; the driver's walk there is in world space.)
// `rearBefore` / `rearAfter`: the back of the loads before and after this stop (bedRearX), where
// the tool is taken from and put back.
// `dockStair`: at a loading dock, where its steps are (truck-frame z: negative on the driver's
// side); null at the kerb.
// `kerbDoor`: at the kerb, the building's front door (truck frame: where to stand in front of it,
// and the yaw that faces it), or null for a spot on the pavement behind the truck.
export function planChores(model: TruckModel, stop: Stop, dockStair: number | null = null, slot0 = 0, rearBefore: number | null = null, rearAfter: number | null = null,
                    kerbDoor: { x: number; z: number; yaw: number; half?: number } | null = null, obstacles: WalkObstacle[] = [], boxes: WalkBox[] = [], stack: StackMode = null,
                    aboard: { cargo: string; slot: number; units: number }[] = [], jackPlan = true, pave = 0,
                    facade: { x: number; z: number; yaw: number } | null = null, dockDoor: number | null = null): Chore[] {
  const L = truckLayout(model), obstacles0 = obstacles;
  const cargo = CARGO_BY_ID.get(stop.cargo)!;
  const st = STYLE[cargo.handling];
  const pickup = stop.kind === "pickup";
  const out: Chore[] = [];
  const add = (c: Chore) => { out.push(c); return c; };
  // A walk on the ground goes round what stands in the way (trees, lights, furniture, vehicles
  // parked in a dock's yard), in legs.
  // (The walk ramp, once it is down: what's wheeled or rolled goes round it, not across it.)
  let rampBox: WalkBox | null = null;
  // (The load's size; and for a team lift, what stands on the pavement as the way and the load
  // between the two must keep clear of it.)
  const size = CARGO_MODELS[stop.cargo]?.size ?? [0.5, 0.5, 0.5];
  const teamWidth = ON_EDGE.has(stop.cargo) ? size[1] : size[2];   // (a team lift's, across the way it goes)
  // (What stands on the pavement as it reaches out where a team lift is carried.)
  if (st.helper) obstacles = obstacles.map((o) => ({ ...o, hand: handR(o.r, o.kind, HIGH_CARRY.has(stop.cargo)) }));
  // (And as far out as the load passing them must keep: what a team lift's way goes round first.)
  // (Grown so far that one takes in where a walk starts or ends (a tree before a door), only to
  // short of that, so the way still goes round it rather than taking no notice of it.)
  const clearEnds = (obs: WalkObstacle[], a: number[], b: number[]) => obs.map((o) => ({ ...o, r: Math.min(o.r, Math.max(0, Math.hypot(o.x - a[0], o.z - a[2]) - BODY_R - 0.05), Math.max(0, Math.hypot(o.x - b[0], o.z - b[2]) - BODY_R - 0.05)) }));
  // (Those near the way from a to b, all that can matter to the way round between them: few to
  // route round, and quick.)
  const nearWay = (obs: WalkObstacle[], a: number[], b: number[], m = 5) => obs.filter((o) => o.x > Math.min(a[0], b[0]) - m && o.x < Math.max(a[0], b[0]) + m && o.z > Math.min(a[2], b[2]) - m && o.z < Math.max(a[2], b[2]) + m);
  const loadObs = obstacles.map((o) => ({ x: o.x, z: o.z, r: Number.isNaN(o.hand ?? o.r) ? o.r : Math.max(o.r, (o.hand ?? o.r) + teamWidth / 2 + TEAM_PASS - BODY_R) }));
  // (A team lift's carry so far: the driver's way, which the worker follows the load's length
  // behind, crew.ts mateOn.)
  let teamTrail: number[] | null = null;
  const walk = (group: ChoreGroup, a: [number, number, number], b: [number, number, number], speed: number, extra: Partial<Chore> = {}) => {
    const team = !!extra.helper && !!extra.item, last = out[out.length - 1];
    // (Going nowhere, straight after a walk that ends here with the same in hand: none. Stood still
    // with a hand truck, the walk swung the driver round its wheels.)
    if (last?.kind === "walk" && last.b && dist3(a, b) < 0.05 && dist3(last.b, a) < 0.05 && (last.tool ?? null) === (extra.tool ?? null) && (last.item ?? null) === (extra.item ?? null)) return last;
    if (!team) teamTrail = null;
    else if (!teamTrail || !(last && last.kind === "walk" && last.helper && last.item)) teamTrail = [a[0], a[2]];
    const legsFor = (obstacles: WalkObstacle[]) => route(a, b, extra, obstacles);
    let legs = legsFor(obstacles);
    // (A team lift: the load between the two kept off what stands on the pavement, as it cuts
    // inside the driver's corners round it: stood further off it until it is.)
    if (team && obstacles.length) {
      const back = teamSpan(stop.cargo, size[0]), half = Math.max(BODY_R, teamWidth / 2) + TEAM_PASS;
      let best = legs, bestHit = Infinity;
      for (const wider of [-1, ...TEAM_WIDER]) {
        const L2 = wider < 0 ? legsFor(clearEnds(nearWay(loadObs, a, b), a, b)) : wider ? legsFor(nearWay(obstacles, a, b, 5 + wider).map((o) => ({ x: o.x, z: o.z, r: o.r + wider }))) : legs;
        const hit = loadHits(teamTrail!, a, L2, back, half, obstacles);
        if (hit < bestHit) { best = L2; bestHit = hit; }
        if (hit === 0) break;
      }
      // (Still in something standing by where it starts or ends, too near for the way round to
      // take notice of it (a tree before a door): round it by a step or two out to its side.)
      if (bestHit > 0) for (const o of obstacles) {
        const h = o.hand ?? o.r, R = (Number.isNaN(h) ? o.r : Math.max(o.r, h + teamWidth / 2)) + TEAM_PASS + 0.1;
        const nearA = Math.hypot(o.x - a[0], o.z - a[2]) < R + 1.5, nearB = Math.hypot(o.x - b[0], o.z - b[2]) < R + 1.5;
        if (!nearA && !nearB) continue;
        for (let k = 0; k < 8 && bestHit > 0; k++) for (const turn of [0, 1, -1]) {
          const w = (q: number): [number, number, number] => [o.x + Math.cos(q * Math.PI / 4) * R, 0, o.z + Math.sin(q * Math.PI / 4) * R];
          const ws = turn ? [w(k), w(k + turn)] : [w(k)];
          if (ws.some((p) => obstacles.some((q) => q !== o && Math.hypot(q.x - p[0], q.z - p[2]) < q.r + BODY_R))) continue;
          const w0 = ws[0], w1 = ws[ws.length - 1];
          const L2 = nearA ? [...ws, ...route(w1, b, extra, clearEnds(nearWay(loadObs, w1, b), w1, b))] : [...route(a, w0, extra, clearEnds(nearWay(loadObs, a, w0), a, w0)), ...ws, b];
          const hit = loadHits(teamTrail!, a, L2, back, half, obstacles);
          if (hit < bestHit) { best = L2; bestHit = hit; }
        }
      }
      legs = best;
    }
    if (team) for (const to of legs) teamTrail!.push(to[0], to[2]);
    let c: Chore | null = null, from = a;
    // (A team lift: the driver ahead of it backs away facing it, holding its end out in front of
    // them rather than reaching back for it.)
    const facing = team ? { backward: true } : {};
    for (const to of legs) { c = add({ kind: "walk", group, len: Math.max(0.4, dist3(from, to) / speed), a: from, b: to, ...extra, ...facing }); from = to; }
    return c!;
  };
  const route = (a: [number, number, number], b: [number, number, number], extra: Partial<Chore>, obstacles: WalkObstacle[]) => {
    const ground = !extra.linear && a[1] === 0 && b[1] === 0;
    const drawn = !!extra.tool || (!!extra.item && (cargo.handling === "push" || cargo.handling === "roll"));
    // (A hand truck's way past the ramp is rounded clear of its sides as it is walked: crewpath.ts.)
    const rb = rampBox;
    let bx = rb && drawn ? [...boxes, rb] : boxes;
    // (Round the truck itself too: the way round anything else is never through its side.)
    if (ground) {
      // (A tractor-trailer as its trailer and its narrower cab: one box as wide as the trailer all
      // along would take in the cab's door, where walks start and end, and so be left out of them.)
      const box = (x0: number, x1: number, hw: number): WalkBox => ({ x: (x0 + x1) / 2, z: 0, hx: (x1 - x0) / 2, hz: hw + 0.15, ax: 1, az: 0 });   // (boxRoute keeps BODY_R more clear)
      // (Its back a little further out for the underride guard under it.)
      const tbs = L.trailer ? [box(L.rear - 0.2, L.bedFront, L.hw), box(L.bedFront, L.front + 0.1, L.cabHW)] : [box(L.rear - 0.1, L.front + 0.1, L.hw)];
      const inTb = (tb: WalkBox, p: [number, number, number]) => Math.abs(p[0] - tb.x) < tb.hx && Math.abs(p[2]) < tb.hz;
      for (const tb of tbs) if (!inTb(tb, a) && !inTb(tb, b)) bx = [...bx, tb];
    }
    // (Round the boxes, the pavement's things as squares among them; where that finds no way (a
    // square crowding the truck's corner), round the pavement's things as they are, circles, and
    // the ramp as a row of them.)
    const obs = rb && drawn ? [...obstacles, ...rampDiscs(rb)] : obstacles;
    return !ground ? [b] : (bx.length ? boxRoute(a, b, [...bx, ...obstacles.map((o) => ({ x: o.x, z: o.z, hx: o.r, hz: o.r, ax: 1, az: 0 }))]) : null)
      ?? (obs.length ? walkRoute(a, b, obs) : [b]);
  };

  const door: [number, number, number] = [L.doorX, 0, L.doorZ];
  const rear = L.bedRear;
  const side: [number, number, number] = [rear - 1.0, 0, -L.hw - 0.6];            // left rear corner
  const atRear: [number, number, number] = [rear - 0.7, 0, -0.35];               // facing the doors
  const facility: [number, number, number] = kerbDoor ? [kerbDoor.x, 0, kerbDoor.z] : pavementFetch(L, pave).spot;   // at the front door
  // (With no door, a pallet jack's trips each to their own spot on the pavement, side by side, as
  // crew.ts stageLocal sets their loads out: so each is set down, or taken up, where it lies.)
  const facilityFor = (i: number): [number, number, number] => {
    if (kerbDoor || st.tool !== "palletJack") return facility;
    const f = pavementFetch(L, pave).face, side = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * (Math.hypot(size[0], size[2]) + 0.15);   // (room for one turned any way, jackRuns)
    return [facility[0] + Math.sin(f) * side, 0, facility[2] + Math.cos(f) * side];
  };
  // At a door: up to it, it opens, the load goes in (or comes out), it closes.
  const fetchLen = kerbDoor ? 2.6 : 1.3, faceDoor = kerbDoor ? kerbDoor.yaw : null;
  // At a doorway, the driver goes in, with whatever they hold, far enough to be out of sight, turns
  // round in there, and comes back out facing out, the load (or the tool) ahead: never turned in
  // the doorway itself. A drop's load is left in there; a pickup's comes out. The fetch takes the
  // walk in and out on top of the time inside. A team lift: the driver, facing the load, backs in
  // with it (the worker following, all the way in) and walks out, or walks in and backs out with
  // it (the worker inside with its far end); either way not turning. A load that rides into the
  // bed left on its jack: the jack pushed in empty and drawn back out loaded, the driver backing.
  const flipIn = (pickup: boolean, door = !!kerbDoor): Partial<Chore> => {
    if (!door) return {};
    const len = (d: number) => (kerbDoor ? 2.6 : 1.3) + 2 * d / FLIP_V;
    if (st.helper) {
      const d = pickup ? 1.4 : teamSpan(stop.cargo, size[0]) + 1.3;
      return { flip: d, len: len(d), flipYaw: pickup ? [0, 0] : [Math.PI, Math.PI] };
    }
    const d = FLIP_DEPTH[st.tool ?? "none"] + (st.tool ? 0 : size[0] / 2);
    return { flip: d, len: len(d), ...(pickup && jackStays(L, stop.cargo) ? { flipYaw: [0, 0] as [number, number] } : {}) };
  };
  // (A dock's building door. Not a pallet jack: the platform is too shallow to hold it turned
  // round out of the doorway, short of the bed; it is drawn straight back out and turned on it.)
  const goIn = (pickup: boolean) => st.tool === "palletJack" ? {} : flipIn(pickup, true);
  // (To and from the door with a pallet jack: through these, square to it.)
  const squared = st.tool === "palletJack" && !!kerbDoor;
  const doorOff = (d: number): [number, number, number] => [facility[0] - Math.cos(faceDoor ?? 0) * d, 0, facility[2] + Math.sin(faceDoor ?? 0) * d];
  const toDoor = (from: [number, number, number], speed: number, extra: Partial<Chore>, at = facility) => {
    // (The jack, out ahead along the way, turns at its corner, and the driver comes round behind.)
    if (squared) { walk("load", from, doorOff(JACK_DOOR_IN), speed, extra); from = doorOff(JACK_DOOR_IN); }
    walk("load", from, at, speed, extra);
  };
  // (Away from it, the jack is drawn straight back out of the doorway, turned on the spot about
  // its middle, clear of the wall, and pushed on.)
  const fromDoor = (to: [number, number, number], speed: number, extra: Partial<Chore>, spot = facility) => {
    if (!squared) { walk("load", spot, to, speed, extra); return; }
    let d = JACK_DOOR_OUT;
    const hit = (p: [number, number, number]) => p[0] > L.rear - 0.4 && p[0] < L.front + 0.4 && Math.abs(p[2]) < L.hw + 0.4;
    while (d > 1.6 && hit(doorOff(d))) d -= 0.1;   // (no nearer the truck than the driver's own width from it)
    let at = doorOff(d);
    walk("load", facility, at, speed * BACKING, { ...extra, noTurn: true });
    // (A door beside the truck: along its side and past its back before cutting across behind it.)
    if (at[0] > L.bedRear - 3.0 && Math.abs(at[2]) < L.hw + 2.5) {
      const by: [number, number, number] = [L.bedRear - 3.0, 0, Math.sign(at[2] || 1) * Math.max(Math.abs(at[2]), L.hw + 1.3)];
      walk("load", at, by, speed, extra); at = by;
    }
    walk("load", at, to, speed, extra);
  };
  const trips = tripCount(L, stop.cargo, stop.units);
  // Into the bed with each load to where it rides (not for animals, which wait at the door), and
  // the hand truck or pallet jack taken from the bed first and put back last.
  const tool = st.tool ?? null;
  const reach = stowReach(stop.cargo);
  const spots = cargo.handling === "walkOn" ? null : stowSpots(L, model, stop, slot0, trips, reach);
  // (A team lift's pickup: the driver, in first, sets it down from its far end, facing it; against
  // the front wall, with no room there, from beside that end. A drop's: from its near end, to lead
  // it out, facing it.)
  const teamAt = st.helper && spots ? teamSpots(L, model, stop, slot0, trips, pickup) : null;
  // (A pallet jack's: behind the load where it rides, in line with it, so the load is set down
  // (or taken up) right where it rides, in its column.)
  const allUnits = tool === "palletJack" ? bedUnits(L, model, stop.cargo, stop.units, slot0) : [];
  // (A load that stays on the jack, jackStays: from its far side, the jack's forks to the doors.)
  const stays = tool === "palletJack" && jackStays(L, stop.cargo) && !!spots && !teamAt;
  const jackAt = tool === "palletJack" && !teamAt && spots && (jackPlan || stays) ? Array.from({ length: trips }, (_, i) => {
    const [u0, u1] = tripUnits(stop, trips, i), ps = allUnits.slice(u0, u1);
    if (!ps.length) return [spots[i], 0] as [number, number];
    const x = ps.reduce((a, p) => a + p[0], 0) / ps.length, z = ps.reduce((a, p) => a + p[2], 0) / ps.length;
    return [THREE.MathUtils.clamp(stays ? x + JACK_LEAD + 0.77 : x - JACK_LEAD - 0.77, L.bedRear + 0.6, L.bedFront - 0.35), z] as [number, number];
  }) : null;
  const stowFace = (teamAt && pickup) || stays ? FACE_BACK : FACE_FRONT;
  // (Under it, and where to climb over it from: its near side and far side.)
  const under: ToolRest | null = stays && jackAt ? { at: [jackAt[0][0] - JACK_LEAD, L.floor, jackAt[0][1]], stand: [jackAt[0][0], L.floor, jackAt[0][1]], yaw: Math.PI } : null;
  const nearSide = (i: number): [number, number, number] => { const [u0, u1] = tripUnits(stop, trips, i), ps = allUnits.slice(u0, u1); return [Math.min(...ps.map((p) => p[0])) - size[0] / 2 - 0.55, L.floor, jackAt![i][1]]; };
  const climbOver = (a: [number, number, number], b: [number, number, number]) => add({ kind: "walk", group: "load", len: dist3(a, b) / 0.5 + 1.2, a, b, linear: true, over: size[1] + (CARGO_MODELS[stop.cargo]?.palletized ? 0.14 : 0), forward: true });
  const store = tool ? (stays && !pickup ? under : toolStore(L, tool, rearBefore)) : null, back = tool ? toolStore(L, tool, rearAfter) : null;
  const inBed = (sill: [number, number, number]) => ({
    // From the sill to a spot in the bed and back (linear walks at the floor's height).
    to: (x: number, extra: Partial<Chore>, from = sill) => { const p: [number, number, number] = [x, L.floor, 0]; walk("load", from, p, extra.item ? st.speed : WALK, { linear: true, ...extra }); return p; },
    // (To trip i's spot: as `to`, or a team lift's, teamAt.)
    toSpot: (i: number, extra: Partial<Chore>, from = sill) => {
      const at = teamAt ?? jackAt, p: [number, number, number] = at ? [at[i][0], L.floor, at[i][1]] : [spots![i], L.floor, 0];
      walk("load", from, p, extra.item ? st.speed : WALK, { linear: true, ...extra }); return p;
    },
    back: (from: [number, number, number], extra: Partial<Chore>) => walk("load", from, sill, (extra.item ? st.speed : WALK) * (extra.noTurn ? BACKING : 1), { linear: true, ...extra }),
  });
  const fetchTool = (sill: [number, number, number], get: boolean, out: Partial<Chore> = {}) => {
    const r = get ? store : back;
    if (!r) return;
    walk("load", sill, r.stand, WALK, { linear: true, tool: get ? null : tool });
    add({ kind: get ? "toolGet" : "toolPut", group: "load", len: TOOL_TAKE, face: FACE_FRONT, rest: r });
    walk("load", r.stand, sill, WALK, { linear: true, tool: get ? tool : null, ...out });
  };
  // A pickup's last trip: from the load just stowed, secure the tool at its place and walk out
  // empty-handed. A drop's first trip: take the tool and go straight to the first load.
  // A team lift's worker follows the driver into the bed and round the load to its far end; the
  // driver waits for them there before they lift it together.
  const teamWait = () => add({ kind: "wait", group: "load", len: (CARGO_MODELS[stop.cargo]?.size[0] ?? 1) / 1.7 + 1.6, face: FACE_FRONT, gesture: "wave" });
  const putToolFrom = (from: [number, number, number], sill: [number, number, number]) => {
    walk("load", from, back!.stand, WALK, { linear: true, tool });
    add({ kind: "toolPut", group: "load", len: TOOL_TAKE, face: FACE_FRONT, rest: back! });
    walk("load", back!.stand, sill, WALK, { linear: true, tool: null });
  };
  const getToolTo = (i: number, sill: [number, number, number]) => {
    walk("load", sill, store!.stand, WALK, { linear: true, tool: null });
    add({ kind: "toolGet", group: "load", len: TOOL_TAKE, face: FACE_FRONT, rest: store! });
    const x = jackAt ? jackAt[i][0] : spots![i], p: [number, number, number] = [x, L.floor, jackAt ? jackAt[i][1] : 0];
    // (To a load at the door: backing to it, drawing the hand truck along, rather than turning it
    // round at the sill, out over the ramp or the gate.)
    const backTo = x - sill[0] < 2;
    walk("load", store!.stand, p, WALK * (backTo ? BACKING : 1), { linear: true, tool, noTurn: backTo || undefined });
    return p;
  };

  // Walking round what's held (Chore.round), turning it about itself: how far ahead of the feet
  // it is, as crew.ts places it (the middle it turns about); round it from `at`, it `r` ahead
  // along x (dir +1: towards the cab), to its far side.
  const heldAt = (t: Chore["tool"]) => t === "handTruck" ? HT_LEAD : t === "palletJack" ? JACK_LEAD + JACK_PIVOT_AT : cargo.handling === "push" ? pushGap(size[1]) + size[0] / 2 : 0.35 + size[0] / 2;
  // (A crate on its dolly isn't turned: too long to swing round in the bed, a jet ski, say, it stays
  // as it is and the driver steps round it, along its side, to push it from its other end.)
  const goRound = (at: [number, number, number], dir: number, r: number, extra: Partial<Chore>): [number, number, number] => {
    const b: [number, number, number] = [at[0] + dir * 2 * r, at[1], at[2]];
    const still = cargo.handling === "push" && !!extra.item ? size[2] / 2 + 0.4 : undefined;
    add({ kind: "walk", group: "load", len: Math.PI * r / ROUND_SPEED + 0.4, a: at, b, round: true, roundStill: still, ...extra });
    return b;
  };

  add({ kind: "climbDown", group: "exit", len: DWELL.exit });

  if (dockStair !== null) {
    // At a dock: the rear is against the platform edge (x = L.rear). Up the steps (beside the
    // bay on either side, or at the end of the platform), then work from the platform. Steps on
    // the far side of the truck mean a walk round its nose.
    const P = DOCK_PLATFORM, lin = { linear: true };
    const foot: [number, number, number] = [L.rear + 2.9, 0, dockStair];
    const top: [number, number, number] = [L.rear - 0.45, P, dockStair];
    const round: [number, number, number][] = dockStair > 0
      ? [[L.front + 1.3, 0, door[2]], [L.front + 1.3, 0, L.hw + 0.9], [L.rear + 2.9, 0, Math.max(L.hw + 0.9, dockStair)]] : [];
    let at = door;
    for (const q of round) { walk("load", at, q, WALK); at = q; }
    walk("load", at, foot, WALK);
    walk("load", foot, top, 1.1, lin);
    if (L.trailer) {
      // The worker brings the pallets out on a forklift while the driver checks them off.
      const spot: [number, number, number] = [L.rear - 0.9, P, -2.1];
      walk("load", top, spot, WALK, lin);
      for (let i = 0; i < trips; i++) add({ kind: "wait", group: "load", len: 7, face: -Math.PI / 2 + 0.5, gesture: "clipboard", forklift: true });
      walk("close", spot, top, WALK, lin);
    } else {
      const atRear: [number, number, number] = [L.rear - 0.6, P, -0.3];
      const inside: [number, number, number] = [L.rear - DOCK_DEPTH + 0.55, P, 0.4];   // on the platform, at the open door
      const sill: [number, number, number] = [L.bedRear + 0.6, L.floor, 0];
      const ex = { ...lin, tool: st.tool };
      walk("load", top, atRear, WALK, lin);
      add({ kind: "doorOpen", group: "load", len: DOOR_OPEN, face: FACE_FRONT });
      const faceIn = Math.atan2(-(inside[2] - atRear[2]), inside[0] - atRear[0]);
      const bed = inBed(sill);
      if (store && pickup) { walk("load", atRear, sill, WALK, lin); fetchTool(sill, true); walk("load", sill, atRear, WALK, ex); }
      for (let i = 0; i < trips; i++) {
        const helper = st.helper, item = st.item;
        const last = !!store && pickup && i === trips - 1, first = !!store && !pickup && i === 0;
        if (pickup) {
          walk("load", atRear, inside, WALK, ex);
          add({ kind: "fetch", group: "load", len: 1.3, face: faceIn, tool: st.tool, ...goIn(true) });
          // (Pushed into the bed, turned on the platform first, not drawn in backwards: it is set
          // down at its place ahead of the driver.)
          walk("load", inside, sill, st.speed, { ...ex, item, helper, ...(stays ? { noTurn: true } : { forward: true }) });
          if (stays) {
            // (Drawn in backwards to the front, left on its jack, climbed out over.)
            const p = bed.toSpot(i, { tool: st.tool, item, helper, noTurn: true }); add({ kind: "stow", group: "load", len: 1.0, face: stowFace });
            add({ kind: "toolPut", group: "load", len: 1.0, face: FACE_BACK, rest: under! });
            const n = nearSide(i); climbOver(p, n); walk("load", n, sill, WALK, lin);
          } else if (spots) {
            const p = bed.toSpot(i, { tool: st.tool, item, helper }); add({ kind: "stow", group: "load", len: 1.0, face: stowFace });
            if (last) putToolFrom(p, sill); else bed.back(p, { tool: st.tool });
          } else add({ kind: "stow", group: "load", len: 1.0, face: stowFace });
          walk("load", sill, atRear, WALK, last || stays ? lin : ex);
        } else {
          walk("load", atRear, sill, WALK, first || stays ? lin : ex);
          if (stays) {
            const n = nearSide(i), p = under!.stand;
            walk("load", sill, n, WALK, lin); climbOver(n, p);
            add({ kind: "toolGet", group: "load", len: TOOL_TAKE * 0.6, face: FACE_BACK, rest: under! });
            add({ kind: "stow", group: "load", len: 1.0, face: stowFace });
            walk("load", p, sill, st.speed, { ...ex, item, helper, linear: true });
          } else if (spots) { const p = first ? getToolTo(i, sill) : bed.toSpot(i, { tool: st.tool }); if (helper) teamWait(); add({ kind: "stow", group: "load", len: 1.0, face: stowFace }); bed.back(p, { tool: st.tool, item, helper }); }
          else add({ kind: "stow", group: "load", len: 1.0, face: stowFace });
          walk("load", sill, inside, st.speed, { ...ex, item, helper });
          add({ kind: "fetch", group: "load", len: 1.3, face: faceIn, tool: st.tool, ...goIn(false) });
          walk("load", inside, atRear, WALK, ex);
        }
      }
      if (store && !pickup) { walk("load", atRear, sill, WALK, ex); fetchTool(sill, false); walk("load", sill, atRear, WALK, lin); }
      add({ kind: "doorClose", group: "close", len: doorCloseLen(L, atRear[1]), face: FACE_FRONT });
      walk("close", atRear, top, WALK, lin);
    }
    walk("close", top, foot, 1.1, lin);
    at = foot;
    for (const q of [...round].reverse()) { walk("close", at, q, WALK); at = q; }
    walk("close", at, door, WALK);
    add({ kind: "climbUp", group: "enter", len: DWELL.enter });
    // (A load left on the pallet jack: its moves planned, as at the kerb.)
    if (jackPlan && st.tool === "palletJack" && !jackLegs(out, { L, model, stop, slot0, aboard, kerbDoor: null, obstacles: [], size, speed: st.speed, dock: true, dockDoor }))
      return planChores(model, stop, dockStair, slot0, rearBefore, rearAfter, kerbDoor, obstacles0, boxes, stack, aboard, false, pave, facade, dockDoor);
    return finishChores(out, L, obstacles0);
  }

  if (L.trailer) {
    // Tractor-trailer at the kerb: open the swing doors one leaf at a time, the street side's
    // first, the worker forklifts the pallets in from behind, close up the other way round.
    // (A leaf with something on the pavement in its way round is only pulled open part way.)
    const part = (s: number) => leafBlocked(L, s, obstacles), lp = (s: number) => (part(s) ? { leafPart: true, len: LEAF_PART_LEN } : { len: LEAF_LEN });
    const open = (s: number, from: [number, number, number]) => { walk("load", from, leafStand(L, s, false, part(s)), WALK); add({ kind: "leafOpen", group: "load", leaf: s, ...lp(s) }); return leafStand(L, s, true, part(s)); };
    const shut = (s: number, from: [number, number, number]) => { walk("close", from, leafStand(L, s, true, part(s)), WALK); add({ kind: "leafClose", group: "close", leaf: s, ...lp(s) }); return leafStand(L, s, false, part(s)); };
    let at = open(1, open(-1, door));
    const tj = trailerJackPlan(L, model, stop, slot0, aboard, toolStore(L, "palletJack", rearBefore));
    if (tj) {
      // Up into the trailer at its back; the load handed over with the forklift at the doors, the
      // pallet jack under it in the trailer (trailerJackPlan); down again.
      const foot: [number, number, number] = [L.bedRear - 0.6, 0, BED_CLIMB_Z], top: [number, number, number] = [L.bedRear + 0.5, L.floor, BED_CLIMB_Z];
      walk("load", at, foot, WALK);
      add({ kind: "bedUp", group: "load", len: BED_CLIMB, a: foot, b: top, face: FACE_FRONT });
      let here = top, h = 0;
      const on = (lay?: [number, number, number]) => (lay ? { lay } : {});
      for (const q of tj) {
        if ("move" in q) {
          const m = q.move, [ax, az] = jackDriverAt(m, 0), [bx, bz] = jackDriverAt(m, 1);
          add({ kind: "walk", group: "load", len: jackMoveLen(m, q.item ? HEAVY : TOOL, q.item ? JACK_TURN_LOADED : JACK_TURN, WALK), a: [ax, L.floor, az], b: [bx, L.floor, bz], tool: "palletJack", item: q.item ? st.item : null, jack: m, linear: true, ...on(q.lay) });
          here = [bx, L.floor, bz]; h = m.p1.h;
        } else if ("walk" in q) {
          for (const p of q.walk) { if (dist3(here, p) < 0.05) continue; add({ kind: "walk", group: "load", len: Math.max(0.4, dist3(here, p) / WALK), a: here, b: p, linear: true, ...on(q.lay) }); h = Math.atan2(-(p[2] - here[2]), p[0] - here[0]); here = p; }
        } else if ("get" in q) {
          if (dist3(here, q.get.stand) > 0.05) walk("load", here, q.get.stand, WALK, { linear: true });
          add({ kind: "toolGet", group: "load", len: TOOL_TAKE, face: q.get.yaw, rest: q.get });
          here = q.get.stand; h = q.get.yaw;
        } else if ("put" in q) {
          add({ kind: "toolPut", group: "load", len: TOOL_TAKE, face: q.put.yaw, rest: q.put, ...on(q.lay) });
        } else if (q.chore === "handoff") add({ kind: "wait", group: "load", len: 9, face: h, tool: "palletJack", forklift: true, handoff: true, ...on(q.lay) });
        else if (q.chore === "up") add({ kind: "jackUp", group: "load", len: JACK_PUMP, face: h, tool: "palletJack", item: st.item });
        else if (q.chore === "down") add({ kind: "jackDown", group: "load", len: JACK_PUMP, face: h, tool: "palletJack", item: st.item, ...on(q.lay) });
        else add({ kind: "stow", group: "load", len: 1.2, face: h, ...on(q.lay) });   // (facing on the way they walked: no turning round, the stop's jack not in hand)
      }
      walk("close", here, top, WALK, { linear: true });
      add({ kind: "bedDown", group: "close", len: BED_CLIMB, a: top, b: foot, face: FACE_FRONT });
      at = foot;
    } else {
      walk("load", at, side, WALK); at = side;
      for (let i = 0; i < trips; i++) add({ kind: "wait", group: "load", len: 7, face: FACE_BACK, gesture: i % 2 ? "wave" : "clipboard", forklift: true });
    }
    at = shut(-1, shut(1, at));
    walk("close", at, door, WALK);
  } else if (L.flatbed) {
    walk("load", door, side, WALK);
    // Flatbed: the dock worker forklifts the load on from the facility side, then it's strapped.
    // (Working from the road side, the forklift comes round the back of the truck: the driver
    // waits by the cab, out of its way.)
    const deck: [number, number, number] = stack === "road" ? [L.bedFront + 1.3, 0, -L.hw - 0.7] : [(rear + L.bedFront) / 2, 0, -L.hw - 0.7];
    walk("load", side, deck, WALK);
    // (Out of the facility's door and back in, when it has one: a longer drive.)
    // (Long enough, by how far it is from the door round to the deck's side, for it to go no
    // faster than a forklift does: crew.ts drives it out over 0.4 of the wait and back over 0.4.)
    const doorRun = kerbDoor ? Math.hypot(kerbDoor.x - (rear + L.bedFront) / 2, kerbDoor.z - (L.hw + 1.5)) + FORK_CURVE : 0;
    // (To and from a stack: as long as the trip's legs take, each as long as its way, crew.ts
    // stackTrip playing them; the door's place in the truck's frame from where the driver stands
    // at it, half a metre out.)
    const geom = stack && kerbDoor ? stackGeom(L, model, stop, kerbDoor.x + Math.cos(kerbDoor.yaw) * 0.5, kerbDoor.z - Math.sin(kerbDoor.yaw) * 0.5, stack) : null;
    const tripLen = (i: number) => geom && geom.trips.length ? stackTripLegs(L, geom, Math.min(i, geom.trips.length - 1), size[1], pickup).reduce((a, g) => a + g.d, 0) + STACK_SLACK : 11.5;
    const len = (i: number) => stack ? tripLen(i) : kerbDoor ? Math.max(9.5, doorRun / FORK_V / 0.4) : 7;
    for (let i = 0; i < trips; i++) add({ kind: "wait", group: "load", len: len(i), face: -Math.PI / 2, gesture: i % 2 ? "wave" : "clipboard", forklift: true });
    add({ kind: "wait", group: "close", len: 3, face: Math.PI / 2, gesture: "stretch" });
    walk("close", deck, door, WALK);
  } else {
    walk("load", door, side, WALK);
    const sill: [number, number, number] = [rear + 0.5, L.floor, 0];
    const ramp = L.loader !== "liftgate";
    let foot: [number, number, number];
    // Walk ramp: at the back, pull the ramp out from under the floor and set it down (the
    // driver ends at its foot), walk up it and open the roll-up door from the top of the ramp.
    // Lift gate: open the door from the ground, then step aside to the gate's controls at the
    // body's rear corner and lower it (no one on it as it comes out and down). Up it, the driver
    // steps on at its outer end facing the truck, what they push ahead of them on it too; down it,
    // they stand at its inner end facing out, it ahead of them; off it, on out past its end.
    // (The controls on the side away from the kerb, off the pavement and what stands on it.)
    const gateCtl: [number, number, number] = [rear - 0.35, 0, -(Math.sign(facility[2]) || 1) * (L.hw + 0.35)];
    const gateFace = Math.atan2(gateCtl[2], rear - GATE_LEN / 2 - gateCtl[0]);   // (towards the platform's middle)
    const gateTop: [number, number, number] = [rear - GATE_STAND, L.floor, 0], gateLow: [number, number, number] = [rear - GATE_STAND, 0, 0];
    const gateUp: [number, number, number] = [rear - GATE_LEN + GATE_STAND, L.floor, 0];
    const lineup: [number, number, number] = [rear - GATE_LEN - GATE_LINEUP, 0, 0], offGate: [number, number, number] = [rear - GATE_LEN - GATE_OFF, 0, 0];
    const grab: [number, number, number] = [rear - RAMP_HOLD, 0, 0];   // holding the stowed ramp's end
    const onRamp: [number, number, number] = [rear - 0.45, ((L.rampRun - 0.45) / L.rampRun) * (L.floor - 0.12), 0];   // at the door, on the ramp
    if (!ramp) {
      walk("load", side, atRear, WALK);
      add({ kind: "doorOpen", group: "load", len: DOOR_OPEN, face: FACE_FRONT });
      walk("load", atRear, gateCtl, WALK);
      add({ kind: "gateOut", group: "load", len: 2.2, face: gateFace });
      foot = [rear - GATE_LEN + GATE_STAND, 0, 0];   // on the lowered platform's outer end
      walk("load", gateCtl, lineup, WALK);
    } else {
      foot = [rear - L.rampRun - RAMP_HOLD, 0, 0];
      walk("load", side, grab, WALK);
      add({ kind: "rampOut", group: "load", len: RAMP_MOVE, face: FACE_FRONT, a: grab, b: foot });
      rampBox = { x: rear - L.rampRun / 2, z: 0, hx: L.rampRun / 2, hz: RAMP_HW + RAMP_WHEELS, ax: 1, az: 0 };
      walk("load", foot, onRamp, WALK);
      add({ kind: "doorOpen", group: "load", len: DOOR_OPEN, face: FACE_FRONT });
    }
    // Still up at the door (ramp): the first trip starts from there.
    let atDoor = ramp;
    // In and out of the bed: up the ramp, or a ride on the lift gate.
    // On the walk ramp, the driver stays uphill of anything wheeled or rolled (a hand truck, a
    // pallet jack, a crate on its dolly, a drum): up it, backing, drawing it up after them, facing
    // it; down it, walking forwards, it rolling ahead. So at the ramp's foot and again in the bed
    // the driver walks round it (Chore.round) to its other side, turning it about itself.
    // An empty hand truck is light and has nothing to tip onto the driver, so it is pushed up the
    // ramp ahead of them and straight on into the bed, never turned round to be drawn up.
    // (Not a motorcycle: wheeled beside the driver, it goes up and down the ramp at their side.)
    // (Nor what's on the pallet jack too wide to turn round in the bed, a hot tub: pushed up it,
    // the driver below, and drawn back down it, never turned in the bed.)
    const drawnBy = (item: ItemKind | null, t: Chore["tool"]) => ramp && ((!!t && !(t === "handTruck" && !item)) || (!!item && ((cargo.handling === "push" && stop.cargo !== "motorcycles") || cargo.handling === "roll")));
    // Up it, lined up on it well short of its foot (`upFrom`), the driver walks round what's held
    // and backs up the ramp with it.
    // A team lift: on and off it by a wide turn behind it, as wide as the two carriers and the load
    // between them are long, so the worker in the driver's footsteps (crew.ts mateOn) comes onto
    // the ramp at its foot and is off it before the driver turns back towards the door.
    const team = (item: ItemKind | null) => ramp && st.helper && !!item;
    const teamW = size[0] + TEAM_TURN;
    // (The turn out to the door's side: beyond the ramp's foot, out no further than the door, not
    // into the building, and where the two and the load between them stand clear of what's there
    // (a tree, a light, a row of planters along the kerb), as near the ramp as that allows; where
    // nowhere is, where it brushes least. The way to it and on to the door is found through what
    // stands between. A load longer than the door is far out, a canoe, turns from as far the other
    // way, behind the truck, so the two legs of the turn are its length apart and the worker never
    // waits there with it swinging round them.)
    const doorSide = Math.sign(facility[2] || 1), outMost = Math.max(L.hw, Math.abs(facility[2]));
    const teamBack = teamSpan(stop.cargo, size[0]), teamHalf = Math.max(BODY_R, teamWidth / 2) + TEAM_PASS;
    let uZ = teamBack > outMost - 0.3 ? -doorSide * Math.min(L.hw, teamBack - outMost + 0.4) : 0;
    const teamIn: [number, number, number] = [foot[0], 0, 0];   // (off the ramp's foot first, on its line)
    // (The two clear of what's there at their feet, the load at their hands, from z0 out to z1.)
    const into = (x: number, z0: number, z1: number) => obstacles.reduce((n, o) => {
      const h = o.hand ?? o.r, t = z1 === z0 ? 0 : Math.max(0, Math.min(1, (o.z - z0) / (z1 - z0)));
      return n + Math.max(0, Math.max(o.r + BODY_R, Number.isNaN(h) ? 0 : h + teamWidth / 2) + TEAM_PASS - Math.hypot(o.x - x, o.z - z0 - t * (z1 - z0)));
    }, 0);
    let teamX = foot[0] - teamW, swingZ = doorSide * Math.min(teamW, outMost), least = Infinity, bestU = uZ;
    // (Only for a team lift; the dearer half, the way on to the door, only for a turn still in it.)
    // (And where that still brushes something on the ramp's line behind it, a lamp post, coming
    // onto it from aside instead.)
    // (The candidates ranked by how clear the two stand out there, nearer the ramp first, and only
    // the best few followed all the way, legs routed and the load swept, to keep it quick.)
    // (What stands where any turn tried, and the way on to the door, could take the load.)
    const x0 = foot[0] - teamW - TEAM_BACK_MAX - teamBack - 1, x1 = Math.max(facility[0], teamIn[0]) + teamBack + 1;
    const areaObs = obstacles.filter((o) => o.x > x0 && o.x < x1 && Math.abs(o.z) < outMost + 3.5 + teamBack);
    if (ramp && st.helper) lineups: for (const u of [uZ, uZ - 0.8 * doorSide, uZ + 0.8 * doorSide, uZ - 1.6 * doorSide, uZ + 1.6 * doorSide, uZ - 2.4 * doorSide]) {
      const cands: { x: number; z: number; clear: number; near: number; rank: number }[] = [];
      for (let dx = 0; dx <= TEAM_BACK_MAX; dx += 0.5) for (let dz = 0; dz <= 4; dz += 0.5) for (const sz of [1, -1]) {
        const z = Math.min(teamW, outMost) + sz * dz, x = foot[0] - teamW - dx;
        if (z < L.hw + 0.3 || z > outMost) continue;
        const clear = into(x, u, doorSide * z), bias = dx * 0.01 + Math.abs(u - uZ) * 0.05;
        // (Ranked by the load swept along the legs taken straight: quick, and near enough.)
        const rough = loadHits([L.bedRear, 0, teamIn[0], 0], teamIn, [[x, 0, u], [x, 0, doorSide * z], facility], teamBack, teamHalf, areaObs, 0.5);
        cands.push({ x, z, clear, near: clear + bias, rank: clear + bias + rough });
      }
      cands.sort((p, q) => p.rank - q.rank);
      for (const { x, z, clear, near } of cands.slice(0, TEAM_TRIES)) {
        if (near >= least) continue;
        // (Out to it, the load swept round inside the turns, and on to the door: each leg as its
        // walk will go, round what stands in the way.)
        const on: [number, number, number] = [x, 0, u], sw: [number, number, number] = [x, 0, doorSide * z];
        const leg = (p: [number, number, number], q: [number, number, number]) => route(p, q, {}, clearEnds(nearWay(loadObs, p, q), p, q));
        const legs = [...leg(teamIn, on), ...leg(on, sw), ...leg(sw, facility)];
        const hits = loadHits([L.bedRear, 0, teamIn[0], 0], teamIn, legs, teamBack, teamHalf, obstacles);
        if (near + hits < least) { least = near + hits; teamX = x; swingZ = doorSide * z; bestU = u; }
        if (hits < 1e-9 && clear < 1e-9) break lineups;   // (clean: nothing nearer the ramp will be)
      }
    }
    uZ = bestU;
    const teamOn: [number, number, number] = [teamX, 0, uZ], teamSwing: [number, number, number] = [teamX, 0, swingZ];
    // Through a front door along the pavement: lined up square to it, so the load goes in (and
    // comes out) straight through the doorway. Off the ramp in line, on until the load is clear of
    // it, turned a quarter round about its middle (the driver to the door's side), side-stepped out
    // to the line of the door, the driver's end at it, and along to it; then in. A pickup, the
    // other way round: backed out square, along, back in and turned onto the ramp's line. The load
    // held rigid between the two all the while (Chore.mate). Where that won't go (no room on the
    // pavement for the load's length beside the ramp or the truck, something standing in the
    // way), round by the turn above instead.
    const square = (() => {
      if (!ramp || !st.helper || !kerbDoor || faceDoor === null) return null;
      const nx = Math.cos(faceDoor), nz = -Math.sin(faceDoor), ds = Math.sign(facility[2] || 1);
      if (Math.abs(nx) > 0.2 || Math.sign(nz) !== ds) return null;
      const B = teamBack, h = B / 2, w = Math.max(BODY_R, teamWidth / 2) + 0.15;
      const cx = foot[0] - h - TEAM_RAMP_CLEAR;
      const S: [number, number] = [facility[0], facility[2]], O: [number, number] = [S[0] - nx * B, S[1] - nz * B];
      const mid: [number, number] = [(S[0] + O[0]) / 2, (S[1] + O[1]) / 2];
      // (The outer end on the door's side of the ramp and the truck where it slides past them.)
      const x0 = Math.min(cx, mid[0]) - w, x1 = Math.max(cx, mid[0]) + w;
      if (x1 > foot[0] - 0.3 && ds * O[1] < RAMP_HW + w) return null;
      if (x1 > L.rear - 0.3 && x0 < L.front + 0.3 && ds * O[1] < L.hw + w) return null;
      // (Nothing standing where it turns, nor where it's side-stepped.)
      const R = (o: WalkObstacle) => { const hh = o.hand ?? o.r; return (Number.isNaN(hh) ? o.r : Math.max(o.r, hh)) + w; };
      const inRect = (o: WalkObstacle, ax: number, bx: number, az: number, bz: number) =>
        o.x > Math.min(ax, bx) - R(o) && o.x < Math.max(ax, bx) + R(o) && o.z > Math.min(az, bz) - R(o) && o.z < Math.max(az, bz) + R(o);
      for (const o of obstacles) {
        if (Math.hypot(o.x - cx, o.z) < h + R(o)) return null;
        if (inRect(o, cx, cx, -h * ds, mid[1] + h * ds)) return null;
        if (inRect(o, cx, mid[0], O[1], S[1])) return null;
      }
      return { cx, h, ds, mid, S, O };
    })();
    // (Its legs: rigid, the driver facing the worker.)
    const yawTo = (a: [number, number], b: [number, number]) => Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    const rigid = (d0: [number, number], d1: [number, number], w0: [number, number], w1: [number, number], speed: number, ex: Partial<Chore>) => {
      teamTrail?.push(d1[0], d1[1]);   // (the way the load goes, for the walks after: walk)
      return add({ kind: "walk", group: "load", len: Math.max(0.4, Math.max(Math.hypot(d1[0] - d0[0], d1[1] - d0[1]), Math.hypot(w1[0] - w0[0], w1[1] - w0[1])) / speed),
        a: [d0[0], 0, d0[1]], b: [d1[0], 0, d1[1]], ...ex, backward: true, mate: [w0, w1], faceYaw: [yawTo(d0, w0), yawTo(d1, w1)] });
    };
    // (Turned about its middle at (cx, 0), the driver's end from angle p0 to p1, in steps.)
    const turnAbout = (cx: number, h: number, p0: number, p1: number, speed: number, ex: Partial<Chore>) => {
      const n = 6, at = (p: number): [number, number] => [cx + Math.cos(p) * h, Math.sin(p) * h], op = (p: number): [number, number] => [cx - Math.cos(p) * h, -Math.sin(p) * h];
      for (let k = 0; k < n; k++) { const a = p0 + (p1 - p0) * k / n, b = p0 + (p1 - p0) * (k + 1) / n; rigid(at(a), at(b), op(a), op(b), speed * TEAM_TURN_V, ex); }
    };
    // (Moved as it is, the bar from centre m0 to m1, the driver's end `e` along it from the middle.)
    const sideStep = (m0: [number, number], m1: [number, number], e: [number, number], speed: number, ex: Partial<Chore>) =>
      rigid([m0[0] + e[0], m0[1] + e[1]], [m1[0] + e[0], m1[1] + e[1]], [m0[0] - e[0], m0[1] - e[1]], [m1[0] - e[0], m1[1] - e[1]], speed * TEAM_SIDE_V, ex);
    const squareIn = (speed: number, ex: Partial<Chore>) => {
      const q = square!, e: [number, number] = [0, q.ds * q.h];
      walk("load", teamIn, [q.cx - q.h, 0, 0], speed, ex);
      turnAbout(q.cx, q.h, Math.PI, q.ds * Math.PI / 2, speed, ex);
      sideStep([q.cx, 0], [q.cx, q.mid[1]], e, speed, ex);
      sideStep([q.cx, q.mid[1]], q.mid, e, speed, ex);
    };
    const squareOut = (speed: number, ex: Partial<Chore>) => {
      const q = square!, e: [number, number] = [0, -q.ds * q.h];
      rigid(q.S, q.O, [q.S[0] + (q.S[0] - q.O[0]), q.S[1] + (q.S[1] - q.O[1])], q.S, speed * BACKING, ex);   // (backed out, the worker coming out after)
      sideStep(q.mid, [q.cx, q.mid[1]], e, speed, ex);
      sideStep([q.cx, q.mid[1]], [q.cx, 0], e, speed, ex);
      turnAbout(q.cx, q.h, -q.ds * Math.PI / 2, 0, speed, ex);
      walk("load", [q.cx + q.h, 0, 0], teamIn, speed, ex);
    };
    const upFrom = (item: ItemKind | null, t: Chore["tool"] = st.tool): [number, number, number] => !ramp ? lineup : drawnBy(item, t) ? [foot[0] - (t === "handTruck" ? HT_DRAW_LINEUP : RAMP_LINEUP), 0, 0] : t === "handTruck" ? [foot[0] - HT_PUSH_LINEUP, 0, 0] : team(item) ? teamIn : foot;
    // Into the bed. Drawn up the ramp, on in backing until it is all aboard with room behind it to
    // go round it (no further in than `free`, where the bed is taken: by the loads, or the front
    // wall), then round it to push it on: where the driver is then.
    const intoBed = (item: ItemKind | null, t: Chore["tool"] = st.tool, free = L.bedFront): [number, number, number] => {
      const speed = item ? st.speed : WALK, ex = { item, tool: t, helper: st.helper && !!item };
      if (atDoor) { atDoor = false; walk("load", onRamp, sill, WALK, { linear: true, tool: t }); return sill; }
      if (!ramp) {
        walk("load", lineup, foot, speed, ex);
        add({ kind: "gateRide", group: "load", len: 2.0, dir: "up", a: foot, b: gateUp, ...ex });
        walk("load", gateUp, sill, speed, ex);
        return sill;
      }
      if (!drawnBy(item, t)) { walk("load", upFrom(item, t), sill, speed * 0.95, ex); return sill; }
      const r = heldAt(t);
      // (A loaded hand truck comes to the ramp's foot already turned away from it, pushed out past
      // the foot on a curve (crewpath.ts wheelWalk): drawn straight back up from there.)
      const up = t === "handTruck" ? upFrom(item, t) : goRound(upFrom(item, t), 1, r, ex);
      walk("load", up, sill, speed * BACKING, { ...ex, ...(t === "handTruck" ? { backward: true } : { noTurn: true }) });
      // (Where it is turned: just aboard, the driver on the floor once round it, and no deeper
      // in than `free` allows, short of what is stowed there.)
      const c = Math.max(L.bedRear + r + 0.1, Math.min(L.bedRear + r + 0.35, free - 0.3 - r));
      const deep: [number, number, number] = [c + r, L.floor, 0];
      walk("load", sill, deep, speed * BACKING, { ...ex, noTurn: true, linear: true });
      return goRound(deep, -1, r, ex);
    };
    // Out of the bed from `from` (where the driver stands, facing in, what's held ahead). Drawn,
    // first drawn back clear of what's in front of it (the bed is free up to `free` ahead of
    // it), round it, and out forwards behind it, down the ramp and on until it is off it.
    let street = ramp ? foot : lineup;   // (where the driver is when a pickup sets off for the door: at the gate, lined up behind it)
    const outOfBed = (from: [number, number, number], item: ItemKind | null, t: Chore["tool"] = st.tool, free = from[0] + heldAt(t) + 0.1) => {
      const speed = item ? st.speed : WALK, ex = { item, tool: t, helper: st.helper && !!item };
      if (!ramp) {
        if (from !== sill) walk("load", from, sill, speed, { ...ex, linear: true });
        walk("load", sill, gateTop, speed, ex);
        add({ kind: "gateRide", group: "load", len: 2.0, dir: "down", a: gateTop, b: gateLow, ...ex });
        walk("load", gateLow, offGate, speed, ex);
        street = offGate;
        return;
      }
      if (!drawnBy(item, t)) {
        // (Not deeper in first, from a load taken up at the bed's back: straight out from there.)
        const edge = from[0] > sill[0] ? sill : from;
        if (edge !== from) walk("load", from, sill, speed, { ...ex, linear: true });
        if (team(item) && square) { walk("load", edge, teamIn, speed * 0.95, ex); squareIn(speed, ex); street = facility; return; }
        if (team(item)) { walk("load", edge, teamIn, speed * 0.95, ex); walk("load", teamIn, teamOn, speed, ex); walk("load", teamOn, teamSwing, speed, ex); street = teamSwing; return; }
        // (Drawn back down it: on until it is all off it, before it is turned for the door.)
        street = foot; walk("load", edge, street, speed * 0.95, ex);
        return;
      }
      const r = heldAt(t), c = Math.max(L.bedRear + r + 0.1, Math.min(from[0] + r, free - 0.3 - r));   // (the driver on the floor once round it, short of `free`)
      const back: [number, number, number] = [c - r, L.floor, 0];
      if (back[0] < from[0] - 0.05) walk("load", from, back, speed * BACKING, { ...ex, noTurn: true, linear: true });
      const turned = goRound(back[0] < from[0] - 0.05 ? back : from, 1, r, ex);
      walk("load", turned, sill, speed, { ...ex, linear: true });
      street = [foot[0] - 0.4, 0, 0];
      walk("load", sill, street, speed * 0.95, ex);
    };
    const bed = inBed(sill);
    // (Each trip's load: where it goes in the bed, and the bed free up to where it ends.)
    const slotFront = (x: number) => x + heldAt(st.tool) + size[0] / 2;
    if (store && pickup) {
      intoBed(null, null);
      walk("load", sill, store.stand, WALK, { linear: true, tool: null });
      add({ kind: "toolGet", group: "load", len: TOOL_TAKE, face: FACE_FRONT, rest: store });
      outOfBed(store.stand, null);
    }
    for (let i = 0; i < trips; i++) {
      const helper = st.helper, item = st.item;
      const last = !!store && pickup && i === trips - 1, first = !!store && !pickup && i === 0;
      if (pickup) {
        if (atDoor) {
          atDoor = false;
          walk("load", onRamp, street, WALK, { tool: st.tool });
        }
        toDoor(street, WALK, { tool: st.tool }, facilityFor(i));
        add({ kind: "fetch", group: "load", len: fetchLen, face: faceDoor ?? pavementFetch(L, pave).face, tool: st.tool, ...flipIn(true) });
        if (team(item) && square) squareOut(st.speed, { item, tool: st.tool, helper });
        else if (team(item)) { const ex = { item, tool: st.tool, helper }; fromDoor(teamSwing, st.speed, ex); walk("load", teamSwing, teamOn, st.speed, ex); walk("load", teamOn, teamIn, st.speed, ex); }
        // (What's drawn up the ramp comes to where the driver walks round it pushed ahead, never
        // drawn after them: so it is ahead of them there, where the way round goes.)
        else fromDoor(upFrom(item), st.speed, { item, tool: st.tool, helper, ...(drawnBy(item, st.tool) ? { forward: true } : {}) }, facilityFor(i));
        const inAt = intoBed(item, st.tool, spots ? slotFront(spots[i]) : L.bedFront);
        if (spots) {
          const p = bed.toSpot(i, { tool: st.tool, item, helper, ...(stays ? { noTurn: true } : {}) }, inAt); add({ kind: "stow", group: "load", len: 1.0, face: stowFace });
          if (stays) { add({ kind: "toolPut", group: "load", len: 1.0, face: FACE_BACK, rest: under! }); const n = nearSide(i); climbOver(p, n); outOfBed(n, null, null); }
          else if (last) { putToolFrom(p, sill); outOfBed(sill, null, null); } else outOfBed(p, null, st.tool);
        } else { add({ kind: "stow", group: "load", len: 1.0, face: stowFace }); outOfBed(inAt, null, last ? null : st.tool); }
      } else {
        const tIn = first || stays ? null : st.tool;
        const inAt = intoBed(null, tIn, spots ? spots[i] + 0.5 : L.bedFront);
        if (stays) {
          // (In over it to the jack under it, and out with it, pushed ahead.)
          const n = nearSide(i), p = under!.stand;
          walk("load", inAt, n, WALK, { linear: true, tool: null }); climbOver(n, p);
          add({ kind: "toolGet", group: "load", len: TOOL_TAKE * 0.6, face: FACE_BACK, rest: under! });
          add({ kind: "stow", group: "load", len: 1.0, face: stowFace });
          outOfBed(p, item, st.tool, L.bedFront);
        } else if (spots) {
          const p = first ? getToolTo(i, inAt) : bed.toSpot(i, { tool: st.tool }, inAt);
          if (helper) teamWait();
          add({ kind: "stow", group: "load", len: 1.0, face: stowFace });
          outOfBed(p, item, st.tool, slotFront(p[0]));
        } else { add({ kind: "stow", group: "load", len: 1.0, face: stowFace }); outOfBed(inAt, item); }
        if (!(square && team(item))) toDoor(street, st.speed, { item, tool: st.tool, helper }, facilityFor(i));
        add({ kind: "fetch", group: "load", len: fetchLen, face: faceDoor ?? pavementFetch(L, pave).face, tool: st.tool, ...flipIn(false) });
        fromDoor(upFrom(null), WALK, { tool: st.tool, ...(drawnBy(null, st.tool) ? { forward: true } : {}) }, facilityFor(i));
      }
    }
    if (store && !pickup) {
      const inAt = intoBed(null, st.tool, back!.at[0]);
      walk("load", inAt, back!.stand, WALK, { linear: true, tool });
      add({ kind: "toolPut", group: "load", len: TOOL_TAKE, face: FACE_FRONT, rest: back! });
      walk("load", back!.stand, sill, WALK, { linear: true, tool: null });
      outOfBed(sill, null, null);
    }
    if (ramp) {
      // Out of the bed onto the top of the ramp (or up it from the street), pull the door down
      // from there, walk down, lift the ramp's end and push it back in under the floor.
      const lastC = out[out.length - 1];
      if (lastC.kind === "walk" && lastC.b === street && lastC.a === sill) { lastC.b = onRamp; lastC.linear = true; lastC.len = Math.max(0.4, dist3(sill, onRamp) / WALK); lastC.group = "close"; delete lastC.noTurn; }
      else walk("close", lastC.b ?? street, onRamp, WALK);   // (from where the driver is)
      add({ kind: "doorClose", group: "close", len: doorCloseLen(L, onRamp[1]), face: FACE_FRONT });
      walk("close", onRamp, foot, WALK);
      add({ kind: "rampIn", group: "close", len: RAMP_MOVE, face: FACE_FRONT, a: foot, b: grab });
      walk("close", grab, side, WALK);
    } else {
      walk("close", out[out.length - 1].b ?? street, gateCtl, WALK);   // (from where the driver is)
      add({ kind: "gateIn", group: "close", len: 1.6, face: gateFace });
      walk("close", gateCtl, atRear, WALK);
      add({ kind: "doorClose", group: "close", len: doorCloseLen(L, atRear[1]), face: FACE_FRONT });
      walk("close", atRear, side, WALK);
    }
    walk("close", side, door, WALK);
  }
  add({ kind: "climbUp", group: "enter", len: DWELL.enter });
  // A pallet jack at the kerb, up and down the walk ramp: its walks planned as its own moves
  // (jackLegs), clear of the truck, the building and the pavement's things; where any one can't
  // be, all of them as walked above (the jack left where it was walked to, not planned from).
  if (jackPlan && st.tool === "palletJack" && L.loader === "ramp" && !stack
    && !jackLegs(out, { L, model, stop, slot0, aboard, kerbDoor, obstacles, size, speed: st.speed, facade }))
    return planChores(model, stop, dockStair, slot0, rearBefore, rearAfter, kerbDoor, obstacles0, boxes, stack, aboard, false, pave, facade, dockDoor);
  return finishChores(out, L, obstacles0);
}

// Last touches to a stop's chores, wherever it is: walks in the bed round a pallet jack lying there,
// and time for turning what's held.
// (`obstacles`: what stands on the pavement, kept with the chores for the driver's way round it
// with what they hold, crewpath.ts: choreObstacles.)
const CHORE_OBSTACLES = new WeakMap<Chore[], WalkObstacle[]>();
export function choreObstacles(plan: Chore[]): WalkObstacle[] { return CHORE_OBSTACLES.get(plan) ?? []; }
function finishChores(out: Chore[], L: TruckLayout, obstacles: WalkObstacle[] = []): Chore[] {
  CHORE_OBSTACLES.set(out, obstacles);
  roundRestingJack(out, L);
  // With a pallet jack in hand, a walk that sets off another way from the driver's facing first
  // turns the jack (about its middle, the driver walking round it): time for that.
  let facing = NaN;
  for (const c of out) {
    if (c.kind === "walk" && c.a && c.b) {
      if (c.jack) { facing = c.jack.p1.h; continue; }   // (planned, timed as planned)
      const dx = c.b[0] - c.a[0], dz = c.b[2] - c.a[2];
      if (Math.hypot(dx, dz) < 0.05) continue;
      const dir = Math.atan2(-dz, dx) + (c.noTurn || c.round ? Math.PI : 0);   // (noTurn: backing, facing back the way it goes; round: facing back the way it came)
      if (c.tool === "palletJack" && !c.noTurn && !c.round && !Number.isNaN(facing)) {
        const turn = Math.abs(Math.atan2(Math.sin(dir - facing), Math.cos(dir - facing)));
        if (turn > 0.3) c.len += turn / (c.item ? JACK_TURN_LOADED : JACK_TURN);
      }
      // (With a hand truck, turned on its wheels, the driver walking round them: at the start,
      // the way on (a short way back is rolled backwards, not turned), and at the end, the way
      // the next chore faces.)
      if (c.tool === "handTruck" && !c.noTurn && !c.round && !c.backward) {
        const by = (p: number, q: number) => Math.abs(Math.atan2(Math.sin(p - q), Math.cos(p - q)));
        let turn = Number.isNaN(facing) ? 0 : by(dir, facing);
        if (turn > 2.2 && Math.hypot(dx, dz) <= 3.2 && !c.forward) turn = Math.PI - turn;
        const next = out[out.indexOf(c) + 1];
        if (next && next.kind !== "walk" && next.face !== undefined) turn += by(next.face, dir);
        if (turn > 0.3) c.len += turn * HT_LEAD / HT_TURN_V;
        c.len = Math.max(c.len, Math.hypot(dx, dz) / HT_WALK_V + 0.3);   // (never hurried: rolled at a walk, eased in and out)
      }
      facing = dir;
    } else if (c.face !== undefined) facing = c.flip ? flipYawOut(c) : c.face;   // (turned round inside a doorway: facing out)
  }
  return out;
}

// A pallet jack left lying along the bed (put back at its rest, or not yet taken from it): the
// driver's walks in the bed while it lies there go round it, along its side, never through it.
function roundRestingJack(out: Chore[], L: TruckLayout) {
  let lying: ToolRest | null = null;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (c.kind === "toolPut" && c.rest) { if (out.slice(0, i).reverse().find((q) => q.tool)?.tool === "palletJack") lying = c.rest; continue; }
    if (c.kind === "toolGet") { lying = null; continue; }
    if (!lying || c.kind !== "walk" || c.tool || c.over || !c.a || !c.b || c.a[1] < L.floor - 0.01 || c.b[1] < L.floor - 0.01) continue;
    const r = lying, fx = Math.cos(r.yaw), fz = -Math.sin(r.yaw);
    if (Math.abs(fz) > 0.3) continue;   // (lying across the bed, at its front wall: out of the way)
    // Its footprint from the steering wheel (`at`) to the forks' ends, the driver's width round it.
    const xa = Math.min(r.at[0] - fx * 0.2, r.at[0] + fx * 1.37) - BODY_R, xb = Math.max(r.at[0] - fx * 0.2, r.at[0] + fx * 1.37) + BODY_R;
    const za = r.at[2] - 0.33 - BODY_R, zb = r.at[2] + 0.33 + BODY_R;
    const [ax, , az] = c.a, [bx, , bz] = c.b;
    let hits = false;
    for (let k = 0; k <= 20 && !hits; k++) { const x = ax + (bx - ax) * k / 20, z = az + (bz - az) * k / 20; hits = x > xa && x < xb && z > za && z < zb; }
    if (!hits) continue;
    // (Along whichever side has room in the bed, the nearer first.)
    const room = L.hw - BODY_R - 0.02, sides = [zb, za].filter((z) => Math.abs(z) <= room).sort((p, q) => Math.abs(p - az) - Math.abs(q - az));
    if (!sides.length) continue;
    const zs = sides[0], y = c.a[1], dx = Math.sign(bx - ax) || 1;
    const p1: [number, number, number] = [ax, y, zs];   // (a step aside first, then along it)
    const p2: [number, number, number] = [dx > 0 ? Math.max(xb, ax) : Math.min(xa, ax), y, zs];
    const pts = [c.a, p1, p2, c.b].filter((p, k, all) => k === 0 || Math.hypot(p[0] - all[k - 1][0], p[2] - all[k - 1][2]) > 0.05);
    const total = pts.slice(1).reduce((s, p, k) => s + Math.hypot(p[0] - pts[k][0], p[2] - pts[k][2]), 0), straight = Math.hypot(bx - ax, bz - az) || 1;
    const legs: Chore[] = pts.slice(1).map((p, k) => ({ ...c, a: pts[k], b: p, len: c.len * Math.max(1, total / straight) * Math.hypot(p[0] - pts[k][0], p[2] - pts[k][2]) / total }));
    out.splice(i, 1, ...legs);
    i += legs.length - 1;
  }
}

// Swap: climb down from the old truck, walk to the new one (world space, see swapWalkPoint),
// climb in.
export function swapChores(walkLen: number): Chore[] {
  return [
    { kind: "climbDown", group: "exit", len: DWELL.exit },
    { kind: "walk", group: "walk", len: walkLen },
    { kind: "climbUp", group: "enter", len: DWELL.enter },
  ];
}
