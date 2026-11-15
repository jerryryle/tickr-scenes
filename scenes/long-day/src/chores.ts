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
import { truckLayout } from "./truck.ts";
import type { TruckLayout, TruckModel } from "./truck.ts";
import { DOCK_DEPTH, DOCK_PLATFORM } from "./facilities.ts";
import { CARGO_BY_ID, slotAlign, slotEnd, TRUCK_SLOTS } from "./cargo.ts";
import type { Handling } from "./cargo.ts";
import { DWELL } from "./journey.ts";
import type { Stop } from "./journey.ts";
import { CARGO_MODELS } from "./cargomodels.ts";

type ChoreKind =
  | "climbDown" | "climbUp" | "walk" | "doorOpen" | "doorClose" | "rampOut" | "rampIn"
  | "gateOut" | "gateIn" | "gateRide" | "doorsOpen" | "doorsClose" | "fetch" | "stow" | "wait"
  | "toolGet" | "toolPut";   // take the hand truck or pallet jack from the bed, put it back
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
  forklift?: boolean;               // a wait during which the dock worker makes one forklift trip
}

// Brisk: a stop's whole dwell should land around 35-50 s so a stop cycle stays near 60-90 s.
const WALK = 2.0, CARRY = 1.5, TOOL = 1.6, HEAVY = 1.25;
// Facing in the truck frame: yaw 0 looks along +x (towards the cab), PI along -x (backwards).
const FACE_FRONT = 0, FACE_BACK = Math.PI;
// Opening and closing up: the roll-up door (bend to the handle, lift, push it up; reach up,
// pull it down, bend to push it shut), and the walk ramp pulled out and pushed back in, with the
// driver this far behind its end.
export const DOOR_OPEN = 3.0, DOOR_CLOSE = 2.8, RAMP_MOVE = 3.6, RAMP_HOLD = 0.5;

interface TripStyle { perTrip: number; cap: number; item: ItemKind; tool: Chore["tool"]; speed: number; helper?: boolean }
export const STYLE: Record<Handling, TripStyle> = {
  carry: { perTrip: 4, cap: 2, item: "box", tool: null, speed: CARRY },
  handTruck: { perTrip: 6, cap: 2, item: "stack", tool: "handTruck", speed: TOOL },
  palletJack: { perTrip: 2, cap: 2, item: "pallet", tool: "palletJack", speed: HEAVY },
  roll: { perTrip: 3, cap: 2, item: "drum", tool: null, speed: CARRY },
  push: { perTrip: 2, cap: 2, item: "crate", tool: null, speed: HEAVY },
  walkOn: { perTrip: 99, cap: 1, item: "animal", tool: null, speed: 1.0 },
  teamLift: { perTrip: 3, cap: 1, item: "long", tool: null, speed: HEAVY, helper: true },
  flatbed: { perTrip: 2, cap: 2, item: "bundle", tool: null, speed: WALK },
  tow: { perTrip: 1, cap: 1, item: "bundle", tool: null, speed: WALK },
};

const dist3 = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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
function tripCount(L: TruckLayout, id: string, units: number) {
  const c = CARGO_BY_ID.get(id)!;
  if (!handTrips(L, c.handling)) { const st = STYLE[c.handling]; return Math.min(st.cap, Math.max(1, Math.ceil(units / st.perTrip))); }
  return Math.max(1, Math.ceil(units / tripLoad(id)));
}

// Where the hand truck or pallet jack rides: against the bed's front wall on the left (truck
// frame), and where the driver stands to take it: in the aisle between the load columns, so
// the driver is never standing inside a stowed load.
// A box's cargo starts this far back from the front wall, leaving the strip in front of it for
// the tool: the hand truck stands there, the pallet jack lies across it with its handle up.
const bedFrontGap = (L: TruckLayout) => (L.trailer || L.flatbed ? 0.15 : 0.7);
export interface ToolRest { at: [number, number, number]; stand: [number, number, number]; yaw: number }   // yaw: added to the truck's heading
// `rearX`: the back of the rearmost row of loads (bedRearX), or null for an empty bed. With room
// behind the loads, the tool is secured right behind them, upright against the last load (the
// pallet jack along the left wall); otherwise it rides in the strip at the front wall.
export function toolStore(L: TruckLayout, tool: "handTruck" | "palletJack", rearX: number | null = null): ToolRest {
  const jack = tool === "palletJack", x = (rearX ?? 0) - (jack ? 0.3 : 0.1), standX = x - (jack ? 1.75 : 1.1);   // the jack's forks run back from the handle
  if (rearX !== null && standX >= L.bedRear + 0.45)
    return { at: [x, L.floor, -L.hw + (jack ? 0.35 : 0.5)], stand: [standX, L.floor, 0], yaw: Math.PI };
  return tool === "palletJack"
    ? { at: [L.bedFront - 0.35, L.floor, -L.hw + 0.35], stand: [L.bedFront - 1.3, L.floor, 0], yaw: -Math.PI / 2 }
    : { at: [L.bedFront - 0.3, L.floor, -L.hw + 0.5], stand: [L.bedFront - 1.3, L.floor, 0], yaw: Math.PI };
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
    for (let u = 0; u < units; u++) {
      const start = slotAlign(spu, s);
      if (start + span > slots) break;
      const [x, z] = centre(start, span);
      out.push([x, L.floor, z]);
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

// Chores for a pickup or drop. (Swaps use swapChores; the driver's walk there is in world space.)
// `rearBefore` / `rearAfter`: the back of the loads before and after this stop (bedRearX), where
// the tool is taken from and put back.
// `dockStair`: at a loading dock, where its steps are (truck-frame z: negative on the driver's
// side); null at the kerb.
// `kerbDoor`: at the kerb, the building's front door (truck frame: where to stand in front of it,
// and the yaw that faces it), or null for a spot on the pavement behind the truck.
export function planChores(model: TruckModel, stop: Stop, dockStair: number | null = null, slot0 = 0, rearBefore: number | null = null, rearAfter: number | null = null,
                    kerbDoor: { x: number; z: number; yaw: number } | null = null): Chore[] {
  const L = truckLayout(model);
  const cargo = CARGO_BY_ID.get(stop.cargo)!;
  const st = STYLE[cargo.handling];
  const pickup = stop.kind === "pickup";
  const out: Chore[] = [];
  const add = (c: Chore) => { out.push(c); return c; };
  const walk = (group: ChoreGroup, a: [number, number, number], b: [number, number, number], speed: number, extra: Partial<Chore> = {}) =>
    add({ kind: "walk", group, len: Math.max(0.4, dist3(a, b) / speed), a, b, ...extra });

  const door: [number, number, number] = [L.doorX, 0, L.doorZ];
  const rear = L.bedRear;
  const side: [number, number, number] = [rear - 1.0, 0, -L.hw - 0.6];            // left rear corner
  const atRear: [number, number, number] = [rear - 0.7, 0, -0.35];               // facing the doors
  const facility: [number, number, number] = kerbDoor ? [kerbDoor.x, 0, kerbDoor.z] : [rear - 2.2, 0, L.hw + 3.2];   // at the front door
  // At a door: up to it, it opens, the load goes in (or comes out), it closes.
  const fetchLen = kerbDoor ? 2.6 : 1.3, faceDoor = kerbDoor ? kerbDoor.yaw : null;
  const trips = tripCount(L, stop.cargo, stop.units);
  // Into the bed with each load to where it rides (not for animals, which wait at the door), and
  // the hand truck or pallet jack taken from the bed first and put back last.
  const tool = st.tool ?? null;
  const reach = stowReach(stop.cargo);
  const spots = cargo.handling === "walkOn" ? null : stowSpots(L, model, stop, slot0, trips, reach);
  const store = tool ? toolStore(L, tool, rearBefore) : null, back = tool ? toolStore(L, tool, rearAfter) : null;
  const inBed = (sill: [number, number, number]) => ({
    // From the sill to a spot in the bed and back (linear walks at the floor's height).
    to: (x: number, extra: Partial<Chore>) => { const p: [number, number, number] = [x, L.floor, 0]; walk("load", sill, p, extra.item ? st.speed : WALK, { linear: true, ...extra }); return p; },
    back: (from: [number, number, number], extra: Partial<Chore>) => walk("load", from, sill, extra.item ? st.speed : WALK, { linear: true, ...extra }),
  });
  const fetchTool = (sill: [number, number, number], get: boolean) => {
    const r = get ? store : back;
    if (!r) return;
    walk("load", sill, r.stand, WALK, { linear: true, tool: get ? null : tool });
    add({ kind: get ? "toolGet" : "toolPut", group: "load", len: 1.2, face: FACE_FRONT, rest: r });
    walk("load", r.stand, sill, WALK, { linear: true, tool: get ? tool : null });
  };
  // A pickup's last trip: from the load just stowed, secure the tool at its place and walk out
  // empty-handed. A drop's first trip: take the tool and go straight to the first load.
  // A team lift's worker follows the driver into the bed and round the load to its far end; the
  // driver waits for them there before they lift it together.
  const teamWait = () => add({ kind: "wait", group: "load", len: (CARGO_MODELS[stop.cargo]?.size[0] ?? 1) / 1.7 + 1.6, face: FACE_FRONT, gesture: "wave" });
  const putToolFrom = (from: [number, number, number], sill: [number, number, number]) => {
    walk("load", from, back!.stand, WALK, { linear: true, tool });
    add({ kind: "toolPut", group: "load", len: 1.2, face: FACE_FRONT, rest: back! });
    walk("load", back!.stand, sill, WALK, { linear: true, tool: null });
  };
  const getToolTo = (x: number, sill: [number, number, number]) => {
    walk("load", sill, store!.stand, WALK, { linear: true, tool: null });
    add({ kind: "toolGet", group: "load", len: 1.2, face: FACE_FRONT, rest: store! });
    const p: [number, number, number] = [x, L.floor, 0];
    walk("load", store!.stand, p, WALK, { linear: true, tool });
    return p;
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
          add({ kind: "fetch", group: "load", len: 1.3, face: faceIn, tool: st.tool });
          walk("load", inside, sill, st.speed, { ...ex, item, helper });
          if (spots) {
            const p = bed.to(spots[i], { tool: st.tool, item, helper }); add({ kind: "stow", group: "load", len: 1.0, face: FACE_FRONT });
            if (last) putToolFrom(p, sill); else bed.back(p, { tool: st.tool });
          } else add({ kind: "stow", group: "load", len: 1.0, face: FACE_FRONT });
          walk("load", sill, atRear, WALK, last ? lin : ex);
        } else {
          walk("load", atRear, sill, WALK, first ? lin : ex);
          if (spots) { const p = first ? getToolTo(spots[i], sill) : bed.to(spots[i], { tool: st.tool }); if (helper) teamWait(); add({ kind: "stow", group: "load", len: 1.0, face: FACE_FRONT }); bed.back(p, { tool: st.tool, item, helper }); }
          else add({ kind: "stow", group: "load", len: 1.0, face: FACE_FRONT });
          walk("load", sill, inside, st.speed, { ...ex, item, helper });
          add({ kind: "fetch", group: "load", len: 1.3, face: faceIn, tool: st.tool });
          walk("load", inside, atRear, WALK, ex);
        }
      }
      if (store && !pickup) { walk("load", atRear, sill, WALK, ex); fetchTool(sill, false); walk("load", sill, atRear, WALK, lin); }
      add({ kind: "doorClose", group: "close", len: DOOR_CLOSE, face: FACE_FRONT });
      walk("close", atRear, top, WALK, lin);
    }
    walk("close", top, foot, 1.1, lin);
    at = foot;
    for (const q of [...round].reverse()) { walk("close", at, q, WALK); at = q; }
    walk("close", at, door, WALK);
    add({ kind: "climbUp", group: "enter", len: DWELL.enter });
    return out;
  }

  walk("load", door, side, WALK);
  if (L.trailer) {
    // Tractor-trailer at the kerb: open the swing doors, the worker forklifts the pallets in
    // from behind, close up.
    walk("load", side, atRear, WALK);
    add({ kind: "doorsOpen", group: "load", len: 2.6, face: FACE_FRONT });
    walk("load", atRear, side, WALK);
    for (let i = 0; i < trips; i++) add({ kind: "wait", group: "load", len: 7, face: FACE_BACK, gesture: i % 2 ? "wave" : "clipboard", forklift: true });
    walk("close", side, atRear, WALK);
    add({ kind: "doorsClose", group: "close", len: 2.6, face: FACE_FRONT });
    walk("close", atRear, door, WALK);
  } else if (L.flatbed) {
    // Flatbed: the dock worker forklifts the load on from the facility side, then it's strapped.
    const deck: [number, number, number] = [(rear + L.bedFront) / 2, 0, -L.hw - 0.7];
    walk("load", side, deck, WALK);
    for (let i = 0; i < trips; i++) add({ kind: "wait", group: "load", len: 7, face: -Math.PI / 2, gesture: i % 2 ? "wave" : "clipboard", forklift: true });
    add({ kind: "wait", group: "close", len: 3, face: Math.PI / 2, gesture: "stretch" });
    walk("close", deck, door, WALK);
  } else {
    const sill: [number, number, number] = [rear + 0.5, L.floor, 0];
    const ramp = L.loader !== "liftgate";
    let foot: [number, number, number];
    // Walk ramp: at the back, pull the ramp out from under the floor and set it down (the
    // driver ends at its foot), walk up it and open the roll-up door from the top of the ramp.
    // Lift gate: open the door from the ground, then lower the gate.
    const grab: [number, number, number] = [rear - RAMP_HOLD, 0, 0];   // holding the stowed ramp's end
    const onRamp: [number, number, number] = [rear - 0.45, ((L.rampRun - 0.45) / L.rampRun) * (L.floor - 0.12), 0];   // at the door, on the ramp
    if (!ramp) {
      walk("load", side, atRear, WALK);
      add({ kind: "doorOpen", group: "load", len: DOOR_OPEN, face: FACE_FRONT });
      add({ kind: "gateOut", group: "load", len: 2.2, face: FACE_FRONT });
      foot = [rear - 0.75, 0, 0];   // on the lowered platform
      walk("load", atRear, foot, WALK);
    } else {
      foot = [rear - L.rampRun - RAMP_HOLD, 0, 0];
      walk("load", side, grab, WALK);
      add({ kind: "rampOut", group: "load", len: RAMP_MOVE, face: FACE_FRONT, a: grab, b: foot });
      walk("load", foot, onRamp, WALK);
      add({ kind: "doorOpen", group: "load", len: DOOR_OPEN, face: FACE_FRONT });
    }
    // Still up at the door (ramp): the first trip starts from there.
    let atDoor = ramp;
    // In and out of the bed: up the ramp, or a ride on the lift gate.
    const intoBed = (item: ItemKind | null, t: Chore["tool"] = st.tool) => {
      const speed = item ? st.speed : WALK;
      if (atDoor) { atDoor = false; walk("load", onRamp, sill, WALK, { linear: true, tool: t }); return; }
      if (L.loader === "liftgate") {
        add({ kind: "gateRide", group: "load", len: 2.0, dir: "up", a: foot, b: [foot[0], L.floor, 0], item, tool: t, helper: st.helper && !!item });
        walk("load", [foot[0], L.floor, 0], sill, speed, { item, tool: t, helper: st.helper && !!item });
      } else walk("load", foot, sill, speed * 0.95, { item, tool: t, helper: st.helper && !!item });
    };
    const outOfBed = (item: ItemKind | null, t: Chore["tool"] = st.tool) => {
      const speed = item ? st.speed : WALK;
      if (L.loader === "liftgate") {
        walk("load", sill, [foot[0], L.floor, 0], speed, { item, tool: t, helper: st.helper && !!item });
        add({ kind: "gateRide", group: "load", len: 2.0, dir: "down", a: [foot[0], L.floor, 0], b: foot, item, tool: t, helper: st.helper && !!item });
      } else walk("load", sill, foot, speed * 0.95, { item, tool: t, helper: st.helper && !!item });
    };
    const bed = inBed(sill);
    if (store && pickup) { intoBed(null, null); fetchTool(sill, true); outOfBed(null); }
    for (let i = 0; i < trips; i++) {
      const helper = st.helper, item = st.item;
      const last = !!store && pickup && i === trips - 1, first = !!store && !pickup && i === 0;
      if (pickup) {
        if (atDoor) { atDoor = false; walk("load", onRamp, foot, WALK, { tool: st.tool }); }
        walk("load", foot, facility, WALK, { tool: st.tool });
        add({ kind: "fetch", group: "load", len: fetchLen, face: faceDoor ?? Math.atan2(-(facility[2] - foot[2]), facility[0] - foot[0]), tool: st.tool });
        walk("load", facility, foot, st.speed, { item, tool: st.tool, helper });
        intoBed(item);
        if (spots) {
          const p = bed.to(spots[i], { tool: st.tool, item, helper }); add({ kind: "stow", group: "load", len: 1.0, face: FACE_FRONT });
          if (last) putToolFrom(p, sill); else bed.back(p, { tool: st.tool });
        } else add({ kind: "stow", group: "load", len: 1.0, face: FACE_FRONT });
        outOfBed(null, last ? null : st.tool);
      } else {
        intoBed(null, first ? null : st.tool);
        if (spots) { const p = first ? getToolTo(spots[i], sill) : bed.to(spots[i], { tool: st.tool }); if (helper) teamWait(); add({ kind: "stow", group: "load", len: 1.0, face: FACE_FRONT }); bed.back(p, { tool: st.tool, item, helper }); }
        else add({ kind: "stow", group: "load", len: 1.0, face: FACE_FRONT });
        outOfBed(item);
        walk("load", foot, facility, st.speed, { item, tool: st.tool, helper });
        add({ kind: "fetch", group: "load", len: fetchLen, face: faceDoor ?? Math.atan2(-(facility[2] - foot[2]), facility[0] - foot[0]), tool: st.tool });
        walk("load", facility, foot, WALK, { tool: st.tool });
      }
    }
    if (store && !pickup) { intoBed(null); fetchTool(sill, false); outOfBed(null, null); }
    if (ramp) {
      // Out of the bed onto the top of the ramp (or up it from the street), pull the door down
      // from there, walk down, lift the ramp's end and push it back in under the floor.
      const lastC = out[out.length - 1];
      if (lastC.kind === "walk" && lastC.b === foot && lastC.a === sill) { lastC.b = onRamp; lastC.linear = true; lastC.len = Math.max(0.4, dist3(sill, onRamp) / WALK); lastC.group = "close"; }
      else walk("close", foot, onRamp, WALK);
      add({ kind: "doorClose", group: "close", len: DOOR_CLOSE, face: FACE_FRONT });
      walk("close", onRamp, foot, WALK);
      add({ kind: "rampIn", group: "close", len: RAMP_MOVE, face: FACE_FRONT, a: foot, b: grab });
      walk("close", grab, side, WALK);
    } else {
      walk("close", foot, atRear, WALK);
      add({ kind: "gateIn", group: "close", len: 1.6, face: FACE_FRONT });
      add({ kind: "doorClose", group: "close", len: DOOR_CLOSE, face: FACE_FRONT });
      walk("close", atRear, side, WALK);
    }
    walk("close", side, door, WALK);
  }
  add({ kind: "climbUp", group: "enter", len: DWELL.enter });
  return out;
}

// Swap: climb down from the old truck, walk to the new one (world space, see swapWalkPoint),
// look it over, climb in.
export function swapChores(walkLen: number): Chore[] {
  return [
    { kind: "climbDown", group: "exit", len: DWELL.exit },
    { kind: "walk", group: "walk", len: walkLen },
    { kind: "climbUp", group: "enter", len: DWELL.enter },
  ];
}
