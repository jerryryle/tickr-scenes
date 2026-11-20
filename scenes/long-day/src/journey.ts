// The journey: an endless chain of jobs, simulated independently of rendering.
//
// Time is deterministic and seekable. The journey runs on a fixed clock of SIM_DT steps, and
// every city has a fixed slot of the timeline: city N starts at N * period (period =
// cityMinutes + countrySeconds), runs its jobs, departs, and the country drive fills the rest of
// the slot. A city's starting state (truck, freight carried in, route start) is a pure function
// of the journey seed and N, so any moment of the journey can be reached by simulating its city
// from the start; within the current city, keyframes every KEYFRAME_STEPS make seeking (and
// scrubbing backwards) instant. Saved progress is just the journey time.
//
// A job picks up one consignment at a source facility and delivers it in one to three drops;
// every unit loaded is tagged with the drop it belongs to, so loads and unloads always balance
// (concept doc, "Load ledger"). Sometimes two jobs share the truck (a mixed load). When a job
// needs a different truck, a swap stop at the nearest Ryder rental lot goes first, with the
// truck empty. After about 25 of the city's 30 minutes no new local jobs are issued; the last
// pickup is tagged for the next city, and the truck leaves once it is aboard.
//
// Most stops happen at the kerb beside the facility's block. At a loading dock (siteLayout in
// facilities.ts) the truck pulls past the bay along the kerb lane, reverses round into it and
// later drives out the same way, on a bay path (DockPlan); a tractor-trailer reverses with the
// trailer leading along that path. A stop's dwell follows a fixed timeline (DWELL) that the
// camera director and the crew share. At a swap stop the new truck is already parked at the
// kerb in front of the rental lot; the old truck pulls up behind it, the driver walks forward,
// and the new truck drives off, leaving the old one parked. Phase 10 replaces the "country"
// stub (a straight drive) with real country.
// Street life (traffic, pedestrians, the blimp) runs inside the journey's fixed step and is saved
// in its keyframes, so seeking replays it exactly. The journey never reads it back.
import * as THREE from "three@0.187.0";
import { hash2, hash3 } from "./rng.ts";
import { journeyPeriod } from "./env.ts";
import type { Config } from "./env.ts";
import { DEBUG_CARGO } from "./debug.ts";
import { truckExtents, truckLayout } from "./truck.ts";
import { FIFTH_WHEEL, KINGPIN_TO_AXLES } from "./hitch.ts";
import { CARGO_MODELS } from "./cargomodels.ts";
import type { TruckModel } from "./truck.ts";
import { PREEMPT_CHANCE, PREEMPT_MAX, signalCycleIndex, signalGreenLeft, signalState, signalWait, PREEMPT_CLEAR } from "./signals.ts";
import type { SignalColor, SignalPreempt } from "./signals.ts";
import { cityName, journeyStyle } from "./styles.ts";
import { seaSide } from "./outline.ts";
import { cargoSeason, cityClimate, seasonalStyle } from "./climate.ts";
import type { Climate, Season } from "./climate.ts";
import { CITY_HI, CITY_LO, CityPlan, entryGateOf, gateEnd, GATES, setCityLimits } from "./city.ts";
import { BLOCK, CURB_H, STREET } from "./grid.ts";
import type { Gate, KerbDoor } from "./city.ts";
import type { CityGraph, CNode } from "./citygraph.ts";
import { DOCK_PLATFORM, dockBayFor, dockDoorH, dockDoorW, dockStair, facilityAt, facilityName, hasSign, siteLayout } from "./facilities.ts";
import type { FacilityId } from "./facilities.ts";
import { CARGO, CARGO_BY_ID, pickCargo, SEA_CARGO, slotAlign, slotCompact, slotEnd, slotFind, TRUCK_SLOTS, truckCarries } from "./cargo.ts";
import { blockGoals, LANE_KERB, Path, planRoute } from "./route.ts";
import type { DockDoor, DockGeom, Goal, Pose, Route } from "./route.ts";
import { freewayGate, freewayMerge, FW_OFF_V } from "./freeway.ts";
import { interchangeTrack } from "./interchange.ts";
import { GARAGE_IN_A } from "./garage.ts";
import { GARAGE_H, HELIX_TOP } from "./route.ts";
import type { GarageGeom } from "./route.ts";
import type { GarageLayout } from "./facilities.ts";
// Debug builds: every journey log line, from the start (main.ts).
export const JOURNEY_LOG: { out: ((line: string) => void) | null } = { out: null };
// Out of a garage, the street leg back towards its node starts this far from it (garage.ts:
// the way down ends 36 m along the frontage, in the far kerb lane).
const GARAGE_OUT_BEFORE = 36;
import { ARRIVE_DUR, ARRIVE_LEN, citySeedOf, CountryRoad, V_GATE, V_JOIN } from "./country.ts";
import { bedRearX, handTrips, maxHandUnits, planChores, swapChores } from "./chores.ts";
import type { Chore, ChoreGroup, WalkBox } from "./chores.ts";

// Street life is stepped and saved with the journey (keyframes), so the truck may answer to it and a
// scrub still replays the same: truckStop, where on its path the truck (its rear axle) is to stop
// short of someone or something in its way (a crosser, a car ahead, a car with the junction before
// it), or null; reverseBlocked, whether someone is in the way of its next metres back into a bay.
// Without street life (tests of the bare journey) the way is always clear.
export interface LifeHook { reset(j: Journey): void; step(j: Journey): void; save(): string; load(s: string, j: Journey): void; truckStop?(j: Journey): number | null; reverseBlocked?(j: Journey): boolean }
type StopKind = "pickup" | "drop" | "swap" | "depart";
interface Site { bx: number; bz: number; fac: FacilityId; name: string }
export interface Stop { kind: StopKind; site: Site | null; job: number; cargo: string; units: number; truck?: TruckModel; slot?: number }   // slot: where its loads go in the bed (set when the stop begins)
export type StackMode = "yard" | "road" | null;
export interface Aboard { job: number; cargo: string; units: number; slotsPerUnit: number; dest: string; slot: number } // dest = site key or "next"; slot: its first pallet slot
// "inbound": the arrival straight into town at the start of a city's slot; "country": the drive
// out of town to the next city (country.ts).
export type Mode = "drive" | "reverse" | "dwell" | "country" | "inbound";
interface ParkedTruck { model: TruckModel; x: number; z: number; h: number }
// A truck's use of a dock: the frontage's goal edge, the bay, and the bay path (route.ts
// DockGeom), which starts with the reference axle docked. The reference axle is the rear axle,
// or a tractor's trailer axles, `trail` metres behind its rear axle.
export interface DockPlan {
  face: number;                                  // the dedge (face) the bay opens off
  pa: number;                                    // the bay's frontage along that face (p, moved to the face's own a: city.ts siteDelta)
  p: number; R: number; pull: number; trail: number;
  stair: number;                                 // the platform steps, as an offset from the bay (dockStair)
  geom: DockGeom;
  edge: { x: number; z: number }; H: number;   // the platform edge at the bay, and the docked heading
  // The facility's name sign (city.ts buildDockSite): the centre of its lettering, its size and
  // the way it faces (out to the street). For the camera, so the destination can be read.
  sign: { x: number; z: number; y: number; w: number; h: number; nx: number; nz: number } | null;
}
const DOCK_R: Record<TruckModel, number> = { box16: 6.5, box26: 8, reefer: 8, tractor: 10, flatbed: 0 };
const YARD_PULL = 2.5;               // how much further a flatbed stops at a yard stand (crew.ts stackPlan)
const TRAILER_TRAIL = KINGPIN_TO_AXLES - FIFTH_WHEEL;   // tractor rear axle to the trailer's axles
const TRAILER_AXLE_TO_REAR = 2.25;

// Dwell timeline: park, then the driver's chores (chores.ts: exit, load, close, enter for a
// normal stop; exit, walk, enter for a swap), then startup. The ledger changes halfway through
// the load group; a swap hands over to the new truck at startup.
export const DWELL = { park: 3, exit: 2.6, enter: 2.6, startup: 1.5 };
type DwellPhase = "park" | ChoreGroup | "startup";
export interface DwellNow { phase: DwellPhase; t: number; len: number; chore: Chore | null; ct: number }
const STOP_SIGN_PAUSE = 1.5;     // s the truck stands at a stop sign's line before going on
const SWAP_GAP = 2.5;          // metres between the old truck's nose and the new truck's tail
const WALK_SPEED = 1.35;
const GATE_TRIM = STREET / 2;   // a gate street's outer end (the hand-over to the country road) is this short of its far node
// The goals on faces long enough to stop along (CityGraph.hasFrontage), or all of them if none is.
const fronted = (G: CityGraph, all: Goal[]) => { const f = all.filter((g) => G.hasFrontage(g.d)); return f.length ? f : all; };

interface JourneyState {
  city: number; citySeed: number; cityTime: number; simTime: number;
  cityStart: number; step: number;  // the city's slot start, and steps simulated in it
  retryAt: number;                  // after a failed job search, when to look again
  departAt: number;                 // city time the truck left town (the end of its gate street), or -1
  departV: number; departS0: number; departTruck: TruckModel;   // its speed, how far onto the road it already was, and its truck
  exit: { gate: number; dEst: number } | null;   // the gate it is leaving by (GATES) and the planned drive to the hand-over
  prev?: { gate: number; dEst: number; fromTruck: TruckModel; departAt: number; departV: number; departS0: number } | null;   // the last city's road out, to keep drawing it after the hand-over
  truck: TruckModel; mode: Mode; modeTime: number; dwellTotal: number; dwellDone: boolean;
  route: Route | null; s: number; v: number; at: { d: number; before: number; lane?: number };   // the dedge the truck is on, how far short of its end, and its lane (kerb unless said)
  stopS: number; backS: number;     // where the truck stops, and where it reverses to (dock stops)
  dockExit: { geom: DockGeom; s: number } | null;   // leaving a bay: the next route starts in it
  garageExit?: GarageGeom | null;                  // up on a garage's roof: the next route starts down its ramp
  spare: TruckModel | null; parked: ParkedTruck | null;
  stops: Stop[]; aboard: Aboard[]; loaded: number; unloaded: number;
  jobCounter: number; swapAt: number; jobsSinceSwap: number; noSwap: boolean; intercity: boolean; committed: string; stopGo: string; redWait: number; preempt: SignalPreempt[]; hitchYaw?: number; hitchFrom?: number; holdS?: number; holdT?: number; jamT?: number; jamGo?: number; jamMoved?: number; jamHeld?: boolean;   // hold: where street life last had it stop, for how much longer   // jam: how long street life has held it standing (its own light not red), how far it has gone since last held and in all since the director's shot of it (JAM_SHOT), and whether it is held now   // stopGo: the all-way stop it has stood at and goes on from (apart from committed, which the lights write)
  stopsDone: number; events: string[];
}

export const SIM_DT = 0.1;              // the fixed simulation step
const KEYFRAME_STEPS = 100;       // a keyframe every 10 s of journey within the current city
const COUNTRY_MIN = 45;           // the drive from the gate to the hand-over is never planned shorter than this
const THROUGH = 1e9;              // stopS of a path driven straight through its end (JSON has no Infinity)
const GATE_SPEED = 6.5;           // rough average speed across town, for timing the way out
const VMAX = 11, ACCEL = 1.6, BRAKE = 2.2, FIRM_BRAKE = 4.5, MAX_DECEL = 5, STOP_GAP = 0.6;
// Gridlock: held standing by street life JAM_HONK s (its own light not red, its own way back into a
// bay not clear of traffic), the truck honks; JAM_REACT s after (its first two blasts over), the
// traffic in its way backs up or pulls on out of it (traffic.ts clearWay) and holds there until it
// has gone JAM_CLEAR m. It never moves into anyone itself: it waits, honking every HONK_EVERY s,
// until the way is clear.
export const JAM_HONK = 20;
export const JAM_SHOT = 8;   // (director.ts: its shot of the jam, from this far into it; jamMoved counts on from here)
const JAM_REACT = 1.5, JAM_CLEAR = 15, JAM_CREEP = 3, HONK_EVERY = 6;
const SEARCH = 12;           // blocks searched around a point for facilities
const LOT_SEARCH = 40;
const SWAP_SEARCH = 14;      // blocks searched for a source of another truck's cargo when a swap is due
export const siteKey = (s: Site) => `${s.bx},${s.bz}`;

// The city's front doors (city.ts kerbDoors), set by the scene before the first journey; tests
// leave it unset and the driver uses a spot on the pavement instead.
let DOOR_PROBE: ((plan: CityPlan, bx: number, bz: number) => (KerbDoor | null)[]) | null = null;
export function setDoorProbe(probe: ((plan: CityPlan, bx: number, bz: number) => (KerbDoor | null)[]) | null) { DOOR_PROBE = probe; }
// What stands on the pavement round a block (city.ts pavementObstacles), for the driver's walks to
// go round; set by the scene, absent in tests (where the walks go straight).
let PAVEMENT_PROBE: ((plan: CityPlan, bx: number, bz: number) => { x: number; z: number; r: number }[]) | null = null;
export function setPavementProbe(probe: typeof PAVEMENT_PROBE) { PAVEMENT_PROBE = probe; }
// The vehicles parked in a dock's yard (city.ts parkedObstacles: axis-aligned boxes), for the
// driver's walks there to go round; set by the scene, absent in tests.
let PARKED_PROBE: ((plan: CityPlan, bx: number, bz: number) => { x: number; z: number; hx: number; hz: number }[]) | null = null;
export function setParkedProbe(probe: typeof PARKED_PROBE) { PARKED_PROBE = probe; }

export class Journey {
  st!: JourneyState;
  plan!: CityPlan;
  path: Path | null = null;
  readonly pose: Pose = { x: 0, z: 0, h: 0, k: 0 };
  lastStep = 0;          // distance moved in the last update (for wheels and the trailer)
  accel = 0;
  lightAhead: SignalColor | "-" = "-";
  private facCache = new Map<number, FacilityId>();
  private frontX = 0; private centerX = 0;

  private dockCache: { stop: Stop; model: TruckModel; plan: DockPlan | null } | null = null;
  private tmpPose: Pose = { x: 0, z: 0, h: 0, k: 0 };
  chores: Chore[] = [];   // the current stop's chores (dwell only)
  private choreStart: number[] = [];

  // Rendering: the pose before the last step (poses are interpolated between steps), and how
  // far the render time is past the last step (negative or zero: the state is just ahead of it).
  readonly prevPose: Pose = { x: 0, z: 0, h: 0, k: 0 };
  frac = 0;
  // Keyframes, per city: the current city's only on a board (where they are never used but for a
  // stall), and the cities either side too in the preview (main.ts), so a scrub back over a
  // hand-over is as quick as one within a city.
  keyframing = true; keepNeighbours = false;
  private frames = new Map<number, { k: Map<number, string>; l: Map<number, string> }>();
  private framesOf(N: number) { let f = this.frames.get(N); if (!f) { f = { k: new Map(), l: new Map() }; this.frames.set(N, f); } return f; }
  life: LifeHook | null = null;

  readonly startSeason: Season;   // the first city's season (main: saved, or the real month's; always given, so a test can't pick up the month by leaving it out)
  climate!: Climate;

  constructor(readonly cfg: Config, t: number, startSeason: Season) {
    this.startSeason = startSeason;
    setCityLimits(cfg.cityMinutes);
    this.st = this.entryState(this.cityAt(Math.max(0, t)));
    ({ front: this.frontX, center: this.centerX } = truckExtents(this.st.truck));
    this.placePose();
    this.advanceTo(Math.max(0, t));
  }

  get period() { return journeyPeriod(this.cfg); }
  cityAt(t: number) { return Math.max(0, Math.floor(t / this.period + 1e-9)); }

  // ---- city starts --------------------------------------------------------------------------
  // City N's starting state, from the seed alone: it enters at the same edge every time, in the
  // truck its freight needs, with that freight bound for a receiver near the entrance.
  private entryState(N: number): JourneyState {
    const citySeed = citySeedOf(this.cfg.seed, N);
    this.climate = this.climateOf(N);
    this.plan = this.planOf(N);
    this.plan.climate = this.climate;
    this.facCache.clear(); this.dockCache = null;
    for (const c of [...this.frames.keys()]) if (this.keepNeighbours ? Math.abs(c - N) > 1 : c !== N) this.frames.delete(c);
    this.path = null; this.chores = [];
    this.accel = 0; this.lastStep = 0; this.lightAhead = "-";   // (as a journey starting here has them)
    const start = N * this.period;
    const freight = this.freightFor(N);
    // In through the entry gate: the slot starts on the highway, ARRIVE_DUR seconds out.
    const gate = this.plan.entryGate, inward = (gate.dir + 2) % 4;
    const st: JourneyState = {
      city: N, citySeed, cityTime: 0, simTime: start, cityStart: start, step: 0, retryAt: 0, departAt: -1, departV: 0, departS0: 0, departTruck: "box26", exit: null,
      truck: freight?.truck ?? "box26", mode: "inbound", modeTime: 0,
      dwellTotal: 0, dwellDone: false, route: null, s: 0, v: V_JOIN, at: this.gateIn(gate),
      stopS: 0, backS: 0, dockExit: null, spare: null, parked: null,
      stops: [], aboard: [], loaded: 0, unloaded: 0, jobCounter: 0,
      // The first swap falls due 2 to 12 minutes in (each city plays from its own start, so the
      // timer can't carry over from the last one). A swap job may not fit in the time left, and
      // some cities have no source of another truck's cargo, so not every city gets one.
      swapAt: start + 60 * (2 + 10 * hash2(N, 1, this.cfg.seed, 0x5a9)), jobsSinceSwap: 0, noSwap: false, intercity: false,
      committed: "", stopGo: "", redWait: 0, preempt: [], stopsDone: N * 1000, events: [],
    };
    // By the freeway: the arrival ends at its off-ramp, where the city's route starts: down the
    // off-ramp (a "helix" tail) and out into the kerb lane under the freeway, towards the next node.
    const ic = this.takesFreeway(N) ? this.plan.interchange : null;
    if (ic) {
      const track = interchangeTrack(this.plan), q = { x: 0, z: 0, h: 0, k: 0 };
      track.eval(0, q);
      st.garageExit = { x: q.x, z: q.z, h: q.h, kind: ic.kind };
      track.eval(track.length, q);
      st.at = this.plan.graph.locate(q.x, q.z, q.h);
    }
    this.st = st;
    if (freight) {
      const c = CARGO_BY_ID.get(freight.cargo)!;
      const [gbx, gbz] = this.gateBlock(gate);
      const dsts = this.findNear(c.to, gbx, gbz, 8, new Set(), 1);
      if (dsts.length) {
        st.aboard.push({ job: 0, cargo: c.id, units: freight.units, slotsPerUnit: c.slots, dest: siteKey(dsts[0]), slot: 0 });
        st.stops.push({ kind: "drop", site: dsts[0], job: 0, cargo: c.id, units: freight.units });
        st.loaded = freight.units;   // carried in from the last city
      }
    }
    ({ front: this.frontX, center: this.centerX } = truckExtents(st.truck));
    if (this.life) { this.placePose(); this.life.reset(this); }
    return st;
  }

  // The city block at a gate's inner end (where the way in or out is planned from): the block on
  // the right of the way in.
  private gateBlock(g: Gate): [number, number] {
    const G = this.plan.graph, b = G.faceBlock[this.gateIn(g).d], gt = G.gates[GATES.indexOf(g)]!;   // (an open gate: the entry)
    const blk = b >= 0 ? G.blocks[b] : G.nearestBlock(G.nodes[gt.node].x, G.nodes[gt.node].z);
    return blk ? [blk.kx, blk.kz] : [0, 0];
  }
  // The way in by a gate: down its gate street from its outer end (GATE_TRIM short of the node
  // beyond), towards the perimeter node.
  gateIn(g: Gate): { d: number; before: number } {
    const G = this.plan.graph, gt = G.gates[GATES.indexOf(g)]!, st = G.streets[gt.street];   // (an open gate: the entry)
    return { d: st.id * 2 + (gt.out === 1 ? 1 : 0), before: st.len - GATE_TRIM };
  }

  // The freight city N arrives with (city 0 starts empty): a common cargo, from the seed. The
  // city before it picks this up last, in this truck (swapping first if it must).
  freightFor(N: number): { cargo: string; units: number; truck: TruckModel } | null {
    if (N <= 0) return null;
    const pool = CARGO.filter((c) => c.tier === "common" && c.handling !== "walkOn" && !c.season && c.truck !== "flatbed");
    const c = pool[Math.floor(hash2(N, 2, this.cfg.seed, 0xf8e) * pool.length)];
    const truck: TruckModel = c.truck === "box16" && hash2(N, 3, this.cfg.seed, 0xf8e) < 0.5 ? "box26" : c.truck;
    const units = Math.min(c.units[1], Math.max(c.units[0], Math.round(c.units[0] + (c.units[1] - c.units[0]) * hash2(N, 4, this.cfg.seed, 0xf8e))),
      Math.floor(TRUCK_SLOTS[truck] / c.slots), maxHandUnits(c.id));   // it may be picked up by hand
    return { cargo: c.id, units, truck };
  }

  // ---- time ---------------------------------------------------------------------------------
  // Run forward to journey time t (the state ends up at or just after t; `frac` is the rest).
  advanceTo(t: number) {
    let guard = 200000;
    while (this.st.simTime < t - 1e-9 && guard-- > 0) this.step();
    this.frac = t - this.st.simTime;
  }

  // Jump to journey time t, in either direction: from a keyframe of this city if there is one at
  // or before t, else from the start of t's city.
  seekTo(t: number) {
    t = Math.max(0, t);
    const N = this.cityAt(t);
    if (N === this.st.city && t >= this.st.simTime - 1e-9) { this.advanceTo(t); this.settlePrev(); return; }
    const f = this.frames.get(N), target = Math.floor((t - N * this.period) / SIM_DT + 1e-6);
    let best = -1;
    if (f) for (const k of f.k.keys()) if (k <= target && k > best) best = k;
    if (best >= 0) {
      if (N !== this.st.city) this.entryState(N);   // (the city's plan and caches; the keyframe has the rest)
      this.restore(f!.k.get(best)!); this.life?.load(f!.l.get(best)!, this);
    } else this.entryState(N);
    this.placePose();
    this.advanceTo(t);
    this.settlePrev();
  }

  // Attach street life: replay this city up to now so it is in the state it would have had.
  attachLife(life: LifeHook) {
    const t = this.st.simTime + this.frac;
    this.life = life;
    this.frames.clear();   // (keyframes so far have no street life)
    this.entryState(this.st.city);
    this.placePose();
    this.advanceTo(t);
    this.settlePrev();
  }
  // How far the render time is between the last two steps (0 = the previous, 1 = the latest).
  get alpha() { return this.alphaAt(this.st.simTime + this.frac); }
  // The same for journey time t at or before the latest step (0 at or before the previous one).
  alphaAt(t: number) { return THREE.MathUtils.clamp(1 + (t - this.st.simTime) / SIM_DT, 0, 1); }

  private restore(json: string) {
    const k = JSON.parse(json);
    this.st = k.st; this.accel = k.accel; this.lastStep = k.lastStep; this.lightAhead = k.lightAhead;
    ({ front: this.frontX, center: this.centerX } = truckExtents(this.st.truck));
    this.path = this.st.route ? new Path(this.plan.graph, this.st.route) : null;
    this.dockCache = null; this.chores = [];
    this.placePose();   // (first: planDwell works in the truck's frame, from where it is parked)
    if (this.st.mode === "dwell") this.planDwell();
  }

  // The truck's pose for rendering: between the last two steps.
  // The pose (and trailer's yaw) the last step started from: where drawing blends from.
  private prevHitch = 0;
  private settlePrev() {
    const p = this.prevPose, q = this.pose;
    p.x = q.x; p.z = q.z; p.h = q.h; p.k = q.k; this.prevHitch = this.st.hitchYaw ?? 0;
  }
  // The trailer's yaw at render time, between the last two steps' as renderPose is.
  renderHitchYaw(): number {
    const a = THREE.MathUtils.clamp(1 + this.frac / SIM_DT, 0, 1), y = this.st.hitchYaw ?? 0;
    return this.prevHitch + (y - this.prevHitch) * a;
  }
  renderPose(out: Pose): Pose {
    const a = THREE.MathUtils.clamp(1 + this.frac / SIM_DT, 0, 1), p = this.prevPose, q = this.pose;
    out.x = p.x + (q.x - p.x) * a; out.z = p.z + (q.z - p.z) * a;
    out.h = p.h + Math.atan2(Math.sin(q.h - p.h), Math.cos(q.h - p.h)) * a; out.k = q.k;
    return out;
  }

  get aboardUnits() { return this.st.aboard.reduce((a, b) => a + b.units, 0); }
  get aboardSlots() { return this.st.aboard.reduce((a, b) => a + b.units * b.slotsPerUnit, 0); }
  get nextStop(): Stop | null { return this.st.stops[0] ?? null; }

  onEvent: ((line: string) => void) | null = null;
  private log(msg: string) {
    const t = this.st.cityTime;
    const line = `c${this.st.city} ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")} ${msg}`;
    JOURNEY_LOG.out?.(line);
    this.st.events.push(line);
    if (this.st.events.length > 12) this.st.events.shift();   // recent lines for the debug HUD
    this.onEvent?.(line);
  }

  // ---- facilities -----------------------------------------------------------------------------
  facility(bx: number, bz: number): FacilityId {
    const key = (bx + 4096) * 8192 + (bz + 4096);
    let f = this.facCache.get(key);
    if (!f) { f = facilityAt(this.plan, bx, bz); this.facCache.set(key, f); }
    return f;
  }
  private site(bx: number, bz: number): Site {
    const fac = this.facility(bx, bz);
    return { bx, bz, fac, name: facilityName(this.plan, fac, bx, bz) };
  }
  // Blocks with one of `types` within `radius` blocks of (bx, bz), nearest first, skipping `avoid`.
  private findNear(types: FacilityId[], bx: number, bz: number, radius: number, avoid: Set<string>, minDist = 1): Site[] {
    const out: { s: Site; d: number }[] = [];
    for (let dz = -radius; dz <= radius; dz++)
      for (let dx = -radius; dx <= radius; dx++) {
        const d = Math.abs(dx) + Math.abs(dz);
        if (d < minDist || d > radius) continue;
        const x = bx + dx, z = bz + dz;
        // (Nor the plaza, with no building to deliver to, nor a block whose every kerb is the wrong
        // way up a one-way street.)
        const blk = this.plan.blockOf(x, z), G = this.plan.graph;
        if (!blk?.inCity || avoid.has(`${x},${z}`) || this.plan.interchangeAt(x, z) || blk.id === this.plan.plaza || !blk.faces.some((f) => G.drivable(f))) continue;
        if (types.includes(this.facility(x, z))) out.push({ s: this.site(x, z), d });
      }
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => o.s);
  }
  private truckBlock(): [number, number] {
    return [Math.floor(this.pose.x / BLOCK), Math.floor(this.pose.z / BLOCK)];
  }

  // ---- job planning ---------------------------------------------------------------------------
  private rand(salt: number) { return hash3(this.st.jobCounter, this.st.city, salt, this.cfg.seed, 0x10b); }

  private season() { return cargoSeason(this.climate); }
  climateOf(N: number): Climate {
    const c = cityClimate(this.cfg.seed, N, journeyStyle(this.cfg.seed, N), this.startSeason);
    return this.cfg.weather ? c : { ...c, weather: "clear" };   // (weather off: clear skies; the season stays)
  }

  // Rough seconds for a run of stops from block (bx, bz): driving at ~6 m/s across blocks, about
  // 50 s at each stop, and a reverse at docks.
  private estimate(stops: Stop[], bx: number, bz: number) {
    let t = 0, cx = bx, cz = bz;
    for (const s of stops) {
      if (!s.site) continue;
      t += (Math.abs(s.site.bx - cx) + Math.abs(s.site.bz - cz) + 1) * BLOCK / 6 + 50 + (this.isDockStop(s) ? 25 : 0) + (s.kind === "swap" ? 60 : 0);
      cx = s.site.bx; cz = s.site.bz;
    }
    return t;
  }

  // Fill the stop queue when it runs dry.
  private planStops() {
    const st = this.st;
    const C = this.cfg.cityMinutes * 60, cutoff = C * (24 / 30);
    const [bx, bz] = this.truckBlock();
    if (st.intercity) return;
    const final = () => {
      // Final pickup: the next city's freight, in the truck it needs; then leave.
      let job = this.makeJob(bx, bz, true);
      // Only if there is time for it and the drive out of town after it (a short stay may not).
      if (job) {
        const last = job[job.length - 1].site!;
        if (st.cityTime + this.estimate(job, bx, bz) + this.gateTime(last.bx, last.bz) + COUNTRY_MIN + 20 > this.period) { this.log("no time for a final pickup"); job = null; }
      }
      // Without it, the truck still has to be the one the next city starts with.
      const want = this.freightFor(st.city + 1)?.truck;
      if (!job && want && want !== st.truck) {
        const lot = this.findNear(["rentalLot"], bx, bz, LOT_SEARCH, new Set(), 1)[0];
        if (lot) job = [{ kind: "swap", site: lot, job: ++st.jobCounter, cargo: "", units: 0, truck: want }];
      }
      if (job) st.stops.push(...job);
      this.log(`final pickup planned: ${job ? job.map((j) => j.kind + " " + j.site?.name + " " + (j.site ? Math.abs(j.site.bx - bx) + Math.abs(j.site.bz - bz) : 0) + "blk").join(", ") : "none"} est ${job ? this.estimate(job, bx, bz).toFixed(0) : 0}s`);
      st.stops.push({ kind: "depart", site: null, job: -1, cargo: "", units: 0 });
      st.intercity = true;
    };
    if (st.cityTime >= cutoff) { final(); return; }
    // Only start a job that leaves time for the final pickup before the city's time is up; near
    // the end, look for a shorter one before giving up.
    const reserve = 360 + this.gateTime(bx, bz);   // a typical final pickup, swap included, and the drive out of town
    let first: Stop[] | null = null, tooLong = false;
    for (let tries = 0; tries < 6; tries++) {
      first = this.makeJob(bx, bz, false);
      if (!first || st.cityTime + this.estimate(first, bx, bz) + reserve <= C) break;
      // A swap job too long for the time left: no more swaps in this city, so the tries that
      // follow look for an ordinary job.
      if (first.some((x) => x.kind === "swap")) { st.noSwap = true; first = null; st.jobCounter++; continue; }
      first = null; st.jobCounter++; tooLong = true;
      if (C - st.cityTime - reserve < 150) break;
    }
    // Nothing that fits, or nothing at all late in the city's time: head for the final pickup
    // rather than wait at the kerb.
    if (!first && (tooLong || st.cityTime > C * 0.6)) { final(); return; }
    // Nothing near (at the edge of town, the facilities a cargo comes from may all be far off):
    // look across the whole town before giving up, so the truck never sits at the kerb idle.
    if (!first && !tooLong) {
      first = this.makeJob(bx, bz, false, false, 0, 2 * (CITY_HI - CITY_LO + 1));
      if (first && st.cityTime + this.estimate(first, bx, bz) + reserve > C) first = null;
    }
    if (!first) { this.log("no job found; cruising"); return; }
    // A mixed load now and then: a second pickup near the first, then all drops by nearest next.
    const pickA = first.find((s) => s.kind === "pickup")!;
    if (this.rand(7) < 0.3 && !first.some((s) => s.kind === "swap")) {
      st.jobCounter++;
      const second = this.makeJob(pickA.site!.bx, pickA.site!.bz, false, true, this.slotsOf(first));
      if (second && !second.some((s) => s.kind === "swap") && st.cityTime + this.estimate([...first, ...second], bx, bz) * 1.15 + reserve <= C) {
        const pickups = [...first, ...second].filter((s) => s.kind === "pickup");
        let drops = [...first, ...second].filter((s) => s.kind === "drop");
        const ordered: Stop[] = [];
        let cur = pickups[pickups.length - 1].site!;
        while (drops.length) {
          drops.sort((a, b) => dist(a.site!, cur) - dist(b.site!, cur));
          const n = drops.shift()!; ordered.push(n); cur = n.site!;
        }
        st.stops.push(...pickups, ...ordered);
        return;
      }
    }
    st.stops.push(...first);
  }

  private slotsOf(stops: Stop[]) {
    return stops.filter((s) => s.kind === "pickup").reduce((a, s) => a + s.units * CARGO_BY_ID.get(s.cargo)!.slots, 0);
  }

  // One job: [swap?] pickup, drops. `secondary` jobs must fit beside `usedSlots` on this truck.
  private makeJob(bx: number, bz: number, intercity: boolean, secondary = false, usedSlots = 0, reach = 0): Stop[] | null {
    const st = this.st;
    const season = this.season();
    // A swap is due at `swapAt` (15 to 30 minutes after the last one), or after a job or two in a
    // specialist truck (the tractor, reefer and flatbed carry few cargo types, so they shouldn't
    // linger).
    const specialist = st.truck !== "box26" && st.truck !== "box16";
    const swapDue = !secondary && !intercity && !st.noSwap &&
      (st.simTime >= st.swapAt || (specialist && st.jobsSinceSwap >= 1 + Math.floor(this.rand(8) * 2)));
    const freight = intercity ? this.freightFor(st.city + 1) : null;
    // When a swap is due: the cargo another truck is for (a box16 load too, though the box26 could
    // carry it) that has a source within reach. Most of it comes from few kinds of facility,
    // which many cities lack, so drawing it blind mostly misses.
    const here = new Set([`${bx},${bz}`]);
    const pool = swapDue && !freight && !DEBUG_CARGO
      ? new Set(CARGO.filter((c) => c.truck !== st.truck && this.findNear(c.from, bx, bz, SWAP_SEARCH, here, 2).length).map((c) => c.id))
      : null;
    // (The waterfront's cargo with a source near, looked for once: makeJob's shore pick.)
    let seaNear: Set<string> | null = null;
    const seaHas = (k: { id: string }) => (seaNear ??= new Set([...SEA_CARGO].filter((id) => this.findNear(CARGO_BY_ID.get(id)!.from, bx, bz, SEARCH, here, 1).length > 0))).has(k.id);
    for (let attempt = 0; attempt < 24; attempt++) {
      st.jobCounter++;
      // When a swap is due, the first attempts draw from that pool, so the truck really changes.
      const change = !!pool?.size && attempt < 16;
      // (In a town on the sea, half the first attempts try the waterfront's cargo, where it has a
      // source near and this truck can carry it (or a swap is due): its fish markets, chandlers and
      // surf shops, facilities.ts waterfrontAt. About one job in ten comes out the waterfront's.)
      const shore = !freight && !DEBUG_CARGO && !change && attempt < 12 && this.plan.outline.sea !== null && this.rand(9) < 0.5
        ? pickCargo(this.rand(1), this.rand(2), 0, season, (k) => SEA_CARGO.has(k.id) && (swapDue || truckCarries(st.truck, k.truck)) && seaHas(k)) : null;
      const c = freight ? CARGO_BY_ID.get(freight.cargo)! : (DEBUG_CARGO && CARGO_BY_ID.get(DEBUG_CARGO)) || shore ||
        (change && pickCargo(this.rand(1), this.rand(2), this.cfg.humorFrequency, season, (k) => pool!.has(k.id))) ||
        pickCargo(this.rand(1), this.rand(2), this.cfg.humorFrequency, season)!;
      // The final pickup goes in any truck that can carry all of the next city's freight (it
      // changes to the next city's truck at the country truck stop); otherwise swap first.
      // The final pickup goes in the next city's own truck (swapping first if need be): the
      // drive between cities is continuous, so the truck can't change on the way.
      const fits = freight ? st.truck === freight.truck : !change && truckCarries(st.truck, c.truck);
      // Prefer the current truck, unless a swap is due (so all five appear).
      if (secondary) { if (!fits) continue; }
      else if (!freight && !swapDue && !fits && attempt < 20) continue;
      const truck = freight ? freight.truck : fits ? st.truck : c.truck;
      const avoid = new Set<string>([`${bx},${bz}`]);
      // Keep stops close (a stop cycle should be 60-90 s): near sources and drops first,
      // widening the search only after a few attempts.
      // Rare and humorous cargo comes from rare facilities, so it may look further afield. A
      // swap's cargo looks as far as its pool did.
      const near = attempt < 14, wide = c.tier === "rare" || c.tier === "humorous" || SEA_CARGO.has(c.id);   // (the waterfront's: few places take it)
      const sources = this.findNear(c.from, bx, bz, reach || (change ? SWAP_SEARCH : freight ? (near ? 9 : 18) : wide ? (near ? 7 : 14) : near ? 5 : SEARCH), avoid, 2);
      if (!sources.length) continue;
      const src = sources[Math.min(sources.length - 1, Math.floor(this.rand(4) * Math.min(3, sources.length)))];
      avoid.add(siteKey(src));
      const cap = TRUCK_SLOTS[truck] - usedSlots;
      let units = freight ? freight.units : c.units[0] + Math.floor(this.rand(5) * (c.units[1] - c.units[0] + 1));
      units = Math.min(units, Math.floor(cap / c.slots));
      if (handTrips(truckLayout(truck), c.handling)) units = Math.min(units, maxHandUnits(c.id));   // no more than the trips carry
      if (units < 1) continue;
      const pickup: Stop = { kind: "pickup", site: src, job: st.jobCounter, cargo: c.id, units };
      if (intercity) {   // the drop is in the next city
        if (fits) return [pickup];
        const lots = this.findNear(["rentalLot"], bx, bz, LOT_SEARCH, new Set(), 1);
        return lots.length ? [{ kind: "swap", site: lots[0], job: st.jobCounter, cargo: "", units: 0, truck }, pickup] : null;
      }
      // (A swap's job makes one drop: the swap itself takes time.)
      const nDrops = change ? 1 : Math.min(units, 1 + Math.floor(this.rand(6) * (c.tier === "common" ? 3 : 1.5)));
      const drops: Stop[] = [];
      let cur = src, left = units;
      for (let i = 0; i < nDrops; i++) {
        const cands = this.findNear(c.to, cur.bx, cur.bz, Math.max(reach / 2, change ? 10 : wide ? (near ? 6 : 10) : near ? 4 : 6), avoid, 1);
        if (!cands.length) break;
        const dst = cands[Math.floor(this.rand(10 + i) * Math.min(3, cands.length))];
        avoid.add(siteKey(dst));
        const u = i === nDrops - 1 ? left : Math.max(1, Math.round(left / (nDrops - i)));
        drops.push({ kind: "drop", site: dst, job: st.jobCounter, cargo: c.id, units: u });
        left -= u; cur = dst;
      }
      if (!drops.length) continue;
      drops[drops.length - 1].units += left; // any units a missing drop would have taken
      const stops: Stop[] = [pickup, ...drops];
      if (!fits) {
        const lots = this.findNear(["rentalLot"], bx, bz, LOT_SEARCH, new Set(), 1);
        if (!lots.length) continue;
        stops.unshift({ kind: "swap", site: lots[0], job: st.jobCounter, cargo: "", units: 0, truck });
      }
      return stops;
    }
    return null;
  }

  // ---- routing --------------------------------------------------------------------------------
  private routeTo(stop: Stop) {
    const st = this.st;
    const dock = this.dockPlan(stop);
    if (stop.kind === "depart") {
      // Out of town: to the end of the nearest gate street that heads the right way for the next
      // city (never straight away from it), without stopping; the country road starts there.
      const plan = this.planExit();
      if (!plan) { this.log("no way out of town"); this.forceLeave(); return; }
      st.route = plan.route; st.exit = { gate: plan.gate, dEst: plan.dEst };
      this.log(`leaving by gate ${plan.gate}, ${plan.route.edges.length} blocks, planned ${plan.dEst.toFixed(0)} s of road`);
    } else {
      // A dock stop pulls past its bay, ready to reverse in; a swap's path ends at the spare
      // truck, parked in front of the lot with its nose just short of the stop line ahead; any
      // other stop centres the truck on a side of the block.
      const { bx, bz } = stop.site!, G = this.plan.graph, blk = this.plan.blockOf(bx, bz)!;
      let goals: Goal[];
      if (dock) goals = [{ d: dock.face, after: dock.pa + dock.R + dock.pull + dock.trail }];
      else if (stop.kind === "swap") {
        // (Nose just short of the stop line ahead.)
        const front = truckExtents(stop.truck!).front, L = siteLayout(this.plan, bx, bz);
        const all = blk.sides.map((f) => ({ d: f, after: G.faceA1(f) - 4 - front, straight: true }));
        // (A rental lot's frontage ends at a 51 past its square's start: on a block where the
        // square sits on an anchor, the face can run on past it, the truck must not.)
        goals = L.kind === "lot" ? [{ ...all[L.side], after: Math.min(G.faceA1(blk.sides[L.side]), 51 + this.plan.siteDelta(bx, bz)) - 4 - front }] : fronted(G, all);
      } else {
        // A park's stand is on one side of it: stop there. A garage: along the side its ramp is
        // on, to where the way in turns off (straight through the node before, to be in the kerb
        // lane), and on up onto its roof.
        // (At a yard stand, a little further on, so the bed clears the container: crew.ts stackPlan.)
        // (Centred on the side.)
        const pull = -this.centerX + (this.isYardStand(stop) ? YARD_PULL : 0), L = siteLayout(this.plan, bx, bz);
        const all = blk.sides.map((f) => ({ d: f, after: (G.faceA0(f) + G.faceA1(f)) / 2 + pull }));
        goals = L.kind === "stand" ? [all[L.side]] : this.garageStop(stop) ? [{ d: blk.sides[(L as GarageLayout).side], after: GARAGE_IN_A + this.plan.siteDelta(bx, bz), straight: true }] : fronted(G, all);
      }
      st.route = planRoute(G, st.at.d, st.at.before, goals, 6000, this.drivable);
      // (Where no way in comes straight on through the corner before it, as at a Y-junction, any way in.)
      if (!st.route && goals.some((g) => g.straight)) st.route = planRoute(G, st.at.d, st.at.before, goals.map((g) => ({ ...g, straight: false })), 6000, this.drivable);
      if (st.route && st.at.lane !== undefined) st.route.lane = st.at.lane;
      if (!st.route) { this.log(`no route to ${stop.site!.name}; skipping`); st.stops.shift(); return; }
      if (this.garageStop(stop)) { st.route.garageIn = true; this.log(`up onto the roof of ${stop.site!.name}`); }
      st.spare = stop.kind === "swap" ? stop.truck! : null;
    }
    // Leaving a bay: the route starts inside it.
    let s0 = 0;
    if (st.dockExit) { st.route.dock = st.dockExit.geom; s0 = st.dockExit.s; st.dockExit = null; }
    if (st.garageExit) { st.route.garageOut = st.garageExit; st.garageExit = null; }
    this.path = new Path(this.plan.graph, st.route);
    st.s = s0; st.committed = ""; st.stopGo = ""; st.redWait = 0; st.holdT = 0; st.jamT = 0; st.jamGo = 0; st.jamMoved = 0;
    st.stopS = this.path.length;
    if (stop.kind === "swap") {
      const spare = truckExtents(stop.truck!);
      st.stopS = this.path.length - (this.frontX + SWAP_GAP - spare.rear);
    }
    st.backS = dock ? -1 : st.stopS;   // below stopS: reverse into the bay on arrival
    if (stop.kind === "depart") st.stopS = THROUGH;   // no stop at the end: straight on out of town
    if (st.mode !== "drive") { st.mode = "drive"; st.modeTime = 0; }
  }

  // How the current truck uses a stop's dock, or null for a kerb stop (no dock, a flatbed, or a
  // yard too shallow for this truck).
  dockPlan(stop: Stop | undefined | null, model: TruckModel = this.st.truck): DockPlan | null {
    if (!stop || (stop.kind !== "pickup" && stop.kind !== "drop")) return null;
    const c = this.dockCache;
    if (c && c.stop === stop && c.model === model) return c.plan;
    const plan = this.makeDockPlan(stop, model);
    this.dockCache = { stop, model, plan };
    return plan;
  }
  private makeDockPlan(stop: Stop, model: TruckModel): DockPlan | null {
    const { bx, bz } = stop.site!;
    const L = siteLayout(this.plan, bx, bz);
    const R = DOCK_R[model];
    if (L.kind !== "dock" || !R) return null;
    const tractor = model === "tractor";
    const trail = tractor ? TRAILER_TRAIL : 0;
    const nRef = L.edge - (tractor ? TRAILER_AXLE_TO_REAR : -truckExtents(model).rear);
    const Lb = nRef - (R - LANE_KERB);          // the bay line ends where the turn onto the lane begins
    if (Lb < trail + 0.5) return null;          // a tractor's own axle must be in the bay line too
    const G = this.plan.graph, face = this.plan.face(bx, bz, L.side);
    const p = dockBayFor(L, model);
    const dl = this.plan.siteDelta(bx, bz), h = G.facePt(face, p + dl, 0).h, rx = Math.sin(h), rz = Math.cos(h);
    const at = (a: number, n: number) => { const q = G.facePt(face, a + dl, n); return { x: q.x, z: q.z }; };
    // (Docked facing out to the street: a quarter turn left of the way along the face.)
    const ref = at(p, nRef), H = h + Math.PI / 2;
    const dp = at(p, L.wall), lp = at(p, L.edge);
    const door: DockDoor = { x: dp.x, z: dp.z, w: dockDoorW(L), h: dockDoorH(L), lx: lp.x, lz: lp.z };
    const sp = L.deep ? at(30, L.wall - 0.13) : at(39, 1.87);
    const sign = hasSign(stop.site!.fac) ? { x: sp.x, z: sp.z, y: L.deep ? DOCK_PLATFORM + 5.7 : CURB_H + 5.5, w: L.deep ? 9.6 : 9.2, h: L.deep ? 1.2 : 1.15, nx: -rx, nz: -rz } : null;
    return { face, pa: p + dl, p, R, pull: tractor ? 1.5 : 3, trail, stair: dockStair(L, p),
      geom: { x: ref.x, z: ref.z, H, Lb, R, door }, edge: at(p, L.edge), H, sign };
  }
  get dock(): DockPlan | null { return this.dockPlan(this.st.stops[0]); }
  // Whether the truck comes into city N by its freeway (freeway.ts freewayMerge): never a
  // tractor-trailer, whose trailer would cut across the off-ramp's loop. (From the seed alone: the
  // truck it comes in is the one its freight needs.)
  private takesFreeway(N: number) {
    return freewayMerge(citySeedOf(this.cfg.seed, N)) && (this.freightFor(N)?.truck ?? "box26") !== "tractor";
  }
  // Whether a stop is up on a garage's roof (a garage site, and a truck that goes up its ramps).
  garageStop(stop: Stop | undefined | null, model: TruckModel = this.st.truck) {
    if (!stop?.site || (stop.kind !== "pickup" && stop.kind !== "drop") || model === "tractor" || model === "flatbed") return false;
    return siteLayout(this.plan, stop.site.bx, stop.site.bz).kind === "garage";
  }
  // The truck's height (and grade) where it is drawn: up a garage's ramps or on its roof. The grade
  // is from the rear axle to the front one `wb` metres on (both wheels on the ramp, through a turn
  // where it levels off too).
  truckLift(wb = 5): { y: number; grade: number } {
    const st = this.st;
    if (st.mode === "country" || st.mode === "inbound") return { y: 0, grade: 0 };
    if (this.path && this.path.ramps.length) { const s = st.s - (1 - this.alpha) * this.lastStep, y = this.path.yAt(s); return { y, grade: (this.path.yAt(s + wb) - y) / wb }; }
    if (st.garageExit) return { y: st.garageExit.kind ? HELIX_TOP : GARAGE_H, grade: 0 };
    return { y: 0, grade: 0 };
  }
  // The height of the current path at s (0 off a garage).
  pathY(s: number) { return this.path ? this.path.yAt(s) : this.st.garageExit ? (this.st.garageExit.kind ? HELIX_TOP : GARAGE_H) : 0; }

  isDockStop(stop: Stop | undefined | null) { return this.dockPlan(stop) !== null; }

  // Where the truck is on the final leg of the current path (for planning the next leg).
  private arriveAtEnd() {
    const p = this.path!;
    const past = p.endA - (p.length - this.st.s);  // metres past the last node
    this.st.at = { d: p.endEdge, before: this.plan.graph.streets[p.endEdge >> 1].len - past, lane: p.endLane === LANE_KERB ? undefined : p.endLane };
  }

  // Pose of the spare truck waiting at a swap stop (at the end of the path).
  sparePose(out: Pose): Pose | null {
    if (this.st.mode === "country") { const r = this.country; return r && this.st.spare ? r.sparePose(out) : null; }
    if (!this.st.spare || !this.path) return null;
    return this.path.eval(this.path.length, out);
  }

  // Where the dwell is now: its group (phase), time into the group and its length, and the
  // current chore with time into it.
  dwellPhase(): DwellNow {
    const t = this.st.modeTime;
    if (t < DWELL.park || !this.chores.length) return { phase: "park", t, len: DWELL.park, chore: null, ct: 0 };
    const tc = t - DWELL.park;
    const n = this.chores.length, end = this.choreStart[n - 1] + this.chores[n - 1].len;
    if (tc >= end) return { phase: "startup", t: tc - end, len: DWELL.startup, chore: null, ct: 0 };
    let i = 0;
    while (i < n - 1 && this.choreStart[i + 1] <= tc) i++;
    const c = this.chores[i];
    // The group's span around chore i.
    let g0 = i, g1 = i;
    while (g0 > 0 && this.chores[g0 - 1].group === c.group) g0--;
    while (g1 < n - 1 && this.chores[g1 + 1].group === c.group) g1++;
    const gs = this.choreStart[g0], ge = this.choreStart[g1] + this.chores[g1].len;
    return { phase: c.group, t: tc - gs, len: ge - gs, chore: c, ct: tc - this.choreStart[i] };
  }

  // Whether the driver spotlight is on (main.ts): from when the truck's door is open (the driver
  // steps into the back) until it is closed again, at a stop with a door to open; never in the cab.
  get driverSpotOn(): boolean {
    if (this.st.mode !== "dwell" || !this.chores.length) return false;
    const tc = this.st.modeTime - DWELL.park;
    let on = -1, off = -1;
    for (let i = 0; i < this.chores.length; i++) {
      const k = this.chores[i].kind, end = this.choreStart[i] + this.chores[i].len;
      if (on < 0 && (k === "doorOpen" || k === "doorsOpen")) on = end;
      if (k === "doorClose" || k === "doorsClose") off = end;
    }
    return on >= 0 && off > on && tc >= on && tc < off;
  }

  // The city's front doors (city.ts kerbDoors; set by the scene, absent in tests) and the one
  // the current kerb stop uses: on the truck's right, the nearest to its back.
  kerbDoor: KerbDoor | null = null;
  // Where the current kerb stop's forklift stacks bundles (lumber, pipe: too wide to carry through
  // a door, crew.ts stackTrip): "yard", in the yard beside an industrial facility's end-on
  // container; "road", on the pavement behind the truck, unloading it from the road side (there's
  // no room on the pavement side); null for neither.
  stackMode: StackMode = null;
  private findKerbDoor(stop: Stop, pose: Pose = this.pose): KerbDoor | null {
    if (!DOOR_PROBE || !stop.site || stop.kind === "swap") return null;
    const L = truckLayout(this.st.truck);
    if (L.trailer) return null;   // (a flatbed's forklift uses the door: crew.ts)
    if (siteLayout(this.plan, stop.site.bx, stop.site.bz).kind === "garage" && !this.garageStop(stop)) return null;   // (its door is up on the roof)
    const h = pose.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
    let best: KerbDoor | null = null, bestD = 45;   // anywhere along the block side: a longer walk beats no door
    for (const d of DOOR_PROBE(this.plan, stop.site.bx, stop.site.bz)) {
      if (!d) continue;
      const px = d.x - pose.x, pz = d.z - pose.z, ax = px * fx + pz * fz, az = px * rx + pz * rz;
      if (az < L.hw + 1.5 || d.nx * rx + d.nz * rz > -0.7) continue;   // on the truck's right, facing it
      const dd = Math.hypot(ax - L.bedRear, az);
      if (dd < bestD) { bestD = dd; best = d; }
    }
    return best;
  }
  // How a stop's bundles are stacked, given it has a front door (stackMode), before the door is known.
  private stackKind(stop: Stop): StackMode {
    if (!stop.site || stop.kind === "swap" || !truckLayout(this.st.truck).flatbed || !CARGO_MODELS[stop.cargo]?.dunnage) return null;
    const s = siteLayout(this.plan, stop.site.bx, stop.site.bz);
    return s.kind === "stand" && s.stand === "container" && s.forklift ? "yard" : "road";
  }
  private isYardStand(stop: Stop) { return this.stackKind(stop) === "yard"; }
  // Ahead of a stacking stop, where the truck will park and the door from there (the stack and
  // the forklift are there before the truck arrives), or null.
  stackAhead(): { pose: Pose; y: number; door: KerbDoor; mode: "yard" | "road" } | null {
    const st = this.st, stop = st.stops[0];
    if (!stop || st.mode !== "drive" || !this.path || this.path.length - st.s > 150) return null;
    const mode = this.stackKind(stop);
    if (!mode) return null;
    const pose = this.path.peek(this.path.length, this.tmpPose);
    const door = this.findKerbDoor(stop, pose);
    return door ? { pose: { ...pose }, y: this.path.yAt(this.path.length), door, mode } : null;
  }

  private planDwell() {
    const st = this.st, stop = st.stops[0];
    this.kerbDoor = null; this.stackMode = null;
    if (stop.kind === "swap") {
      // The walk: from the old cab door forward to the new one, plus a moment to look it over.
      const spare = truckExtents(stop.truck!), cur = truckExtents(st.truck);
      const walk = (this.path!.length + spare.doorX) - (st.s + cur.doorX);
      this.chores = swapChores(Math.abs(walk) / WALK_SPEED + 1.5);
    } else {
      // What else is aboard (this stop's own units excluded, before and after its ledger change).
      const key = stop.site ? siteKey(stop.site) : "";
      const others = st.aboard.filter((a) => (stop.kind === "pickup" ? a.job !== stop.job : !(a.job === stop.job && a.dest === key)));
      if (stop.slot === undefined) {
        // Where this stop's loads go (pickup: the first free run from the front, closing the gaps
        // first if there is none, while the doors are still shut) or come from (drop).
        if (stop.kind === "pickup") {
          const spu = CARGO_BY_ID.get(stop.cargo)!.slots, cap = TRUCK_SLOTS[st.truck];
          let k = slotFind(others, spu, stop.units, cap);
          if (k < 0) { slotCompact(others); k = slotFind(others, spu, stop.units, cap); }
          stop.slot = k < 0 ? slotAlign(spu, Math.max(0, ...others.map((a) => slotEnd(a.slotsPerUnit, a.units, a.slot)))) : k;
        } else stop.slot = st.aboard.find((a) => a.job === stop.job && a.dest === key)?.slot ?? 0;
      }
      // The back of the loads before and after (where the hand truck or pallet jack rests), from
      // the others and this stop's own block, so a restore after the ledger change agrees.
      const L = truckLayout(st.truck), own = [{ slot: stop.slot, slotsPerUnit: CARGO_BY_ID.get(stop.cargo)!.slots, units: stop.units }];
      const before = bedRearX(L, st.truck, stop.kind === "pickup" ? others : [...others, ...own]);
      const after = bedRearX(L, st.truck, stop.kind === "pickup" ? [...others, ...own] : others);
      const dp = this.dockPlan(stop);
      this.kerbDoor = dp ? null : this.findKerbDoor(stop);
      const kd = this.kerbDoor;
      this.stackMode = kd ? this.stackKind(stop) : null;
      let door: { x: number; z: number; yaw: number } | null = null;
      if (kd) {
        // In the truck's frame: stand half a metre out from the door, facing it.
        const h = this.pose.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
        const px = kd.x + kd.nx * 0.5 - this.pose.x, pz = kd.z + kd.nz * 0.5 - this.pose.z;
        door = { x: px * fx + pz * fz, z: px * rx + pz * rz, yaw: Math.atan2(-(-kd.nx * rx - kd.nz * rz), -kd.nx * fx - kd.nz * fz) };
      }
      // At the kerb, what stands near the truck's back (trees, lights, furniture), in its frame.
      const obstacles: { x: number; z: number; r: number }[] = [];
      if (!dp && PAVEMENT_PROBE && stop.site) {
        const h = this.pose.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
        for (const o of PAVEMENT_PROBE(this.plan, stop.site.bx, stop.site.bz)) {
          const px = o.x - this.pose.x, pz = o.z - this.pose.z, x = px * fx + pz * fz, z = px * rx + pz * rz;
          if (Math.abs(x - L.bedRear) < 30 && Math.abs(z) < 25) obstacles.push({ x, z, r: o.r });
        }
      }
      // At a dock, the vehicles parked in the yard and the truck itself (walks round its nose
      // to steps on the far side), as boxes in its frame.
      const boxes: WalkBox[] = [];
      if (dp && PARKED_PROBE && stop.site) {
        const h = this.pose.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
        for (const o of PARKED_PROBE(this.plan, stop.site.bx, stop.site.bz)) {
          const px = o.x - this.pose.x, pz = o.z - this.pose.z, x = px * fx + pz * fz, z = px * rx + pz * rz;
          if (Math.hypot(x, z) < 80) boxes.push({ x, z, hx: o.hx, hz: o.hz, ax: fx, az: rx });   // (world x in the truck's frame)
        }
        if (boxes.length) boxes.push({ x: (L.front + L.rear) / 2, z: 0, hx: (L.front - L.rear) / 2, hz: L.hw, ax: 1, az: 0 });
      }
      this.chores = planChores(st.truck, stop, dp ? dp.stair : null, stop.slot, before, after, door, obstacles, boxes, this.stackMode);
    }
    this.choreStart = [];
    let t = 0;
    for (const c of this.chores) { this.choreStart.push(t); t += c.len; }
    st.dwellTotal = DWELL.park + t + DWELL.startup;
  }

  private placePose() {
    if (this.st.mode === "country" || this.st.mode === "inbound") { this.countryPose(); return; }
    if (this.path) { if (this.st.mode === "reverse") this.reversePose(this.st.s, this.pose); else this.path.eval(this.st.s, this.pose); return; }
    const gx = this.st.garageExit;
    if (gx) { this.pose.x = gx.x; this.pose.z = gx.z; this.pose.h = gx.h; this.pose.k = 0; return; }   // up on a garage's roof
    const ex = this.st.dockExit;
    if (ex) {   // waiting in a bay for the next route
      this.pose.x = ex.geom.x + Math.cos(ex.geom.H) * ex.s; this.pose.z = ex.geom.z - Math.sin(ex.geom.H) * ex.s;
      this.pose.h = ex.geom.H; this.pose.k = 0;
      return;
    }
    const a = this.st.at, G = this.plan.graph, st = G.streets[a.d >> 1], q = G.facePt(a.d, st.len - a.before, (a.lane ?? LANE_KERB) - st.half);
    this.pose.h = q.h; this.pose.k = 0; this.pose.x = q.x; this.pose.z = q.z;
  }

  // ---- simulation -----------------------------------------------------------------------------
  // One fixed step of the simulation, then street life.
  step() {
    const x0 = this.pose.x, z0 = this.pose.z, h0 = this.pose.h, city = this.st.city;
    this.stepJourney(); this.hitchStep(x0, z0, h0, city); this.life?.step(this); this.prefetch();
  }
  // A tractor's trailer, as it swings behind on a turn (the same tractrix truck.ts draws: its
  // axles dragged along the line to the kingpin), stepped with the journey so that street life
  // and the tests know where it is: its yaw off the tractor's heading. Reversing into a bay, the
  // bay path's (blended in over the first 4 m back from however it was, as main.ts draws it); anew
  // (straight) on a jump, as into a new city.
  private hitchStep(x0: number, z0: number, h0: number, city: number) {
    const st = this.st;
    if (st.truck !== "tractor") { st.hitchYaw = 0; st.hitchFrom = undefined; return; }
    if (st.mode === "reverse" && this.path) {
      if (st.hitchFrom === undefined) st.hitchFrom = st.hitchYaw ?? 0;
      const ty = this.reversePose(st.s, this.revB, true);
      st.hitchYaw = st.hitchFrom + (ty - st.hitchFrom) * THREE.MathUtils.smoothstep(this.path.length - st.s, 0, 4);
      return;
    }
    st.hitchFrom = undefined;
    if (st.city !== city || Math.hypot(this.pose.x - x0, this.pose.z - z0) > 20) { st.hitchYaw = 0; return; }
    const th0 = h0 + (st.hitchYaw ?? 0);
    const kx0 = x0 + Math.cos(h0) * FIFTH_WHEEL, kz0 = z0 - Math.sin(h0) * FIFTH_WHEEL;
    const ax = kx0 - Math.cos(th0) * KINGPIN_TO_AXLES, az = kz0 + Math.sin(th0) * KINGPIN_TO_AXLES;
    const kx = this.pose.x + Math.cos(this.pose.h) * FIFTH_WHEEL, kz = this.pose.z - Math.sin(this.pose.h) * FIFTH_WHEEL;
    const th = Math.atan2(-(kz - az), kx - ax);
    st.hitchYaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(th - this.pose.h), Math.cos(th - this.pose.h)), -1.4, 1.4);
  }
  // The trailer's yaw off the tractor's heading as the journey steps it (hitchStep); 0 for others.
  get hitchYaw(): number { return this.st.hitchYaw ?? 0; }

  // On the way to a stop, look up its block's front doors and pavement (cached by the city), so
  // the work isn't all on the step the driver gets out. They are pure functions of the city, so
  // when they run changes nothing else.
  // (One lookup per step: the doors' build is the dearer, so it doesn't share a step.)
  private prefetchKey = ""; private prefetchStage = 0;
  private prefetch() {
    const st = this.st, stop = st.stops[0];
    if (st.mode !== "drive" || !stop?.site || stop.kind === "swap" || (!DOOR_PROBE && !PAVEMENT_PROBE)) return;
    const key = `${st.city}|${stop.site.bx},${stop.site.bz}`;
    if (key !== this.prefetchKey) { this.prefetchKey = key; this.prefetchStage = 0; }
    if (this.prefetchStage === 0) DOOR_PROBE?.(this.plan, stop.site.bx, stop.site.bz);
    else if (this.prefetchStage === 1) PAVEMENT_PROBE?.(this.plan, stop.site.bx, stop.site.bz);
    else return;
    this.prefetchStage++;
  }
  private stepJourney() {
    const dt = SIM_DT;
    this.settlePrev();
    // The slot's end: the next city starts, exactly as its seed says.
    if (this.st.simTime + 1e-6 >= (this.st.city + 1) * this.period) {
      const old = this.st, fromTruck = this.exitRoad?.inp.fromTruck ?? old.truck;
      this.entryState(this.st.city + 1);
      if (old.exit && old.departAt >= 0) this.st.prev = { gate: old.exit.gate, dEst: old.exit.dEst, fromTruck, departAt: old.departAt, departV: old.departV, departS0: old.departS0 };
      this.log(`arrived in city ${this.st.city}`);
      this.placePose();
      this.settlePrev();
    }
    const st = this.st;
    if (this.keyframing && st.step % KEYFRAME_STEPS === 0) {
      const f = this.framesOf(st.city);
      // (With what the last step left outside the state: the truck's acceleration and its last move.)
      if (!f.k.has(st.step)) { f.k.set(st.step, JSON.stringify({ st, accel: this.accel, lastStep: this.lastStep, lightAhead: this.lightAhead })); if (this.life) f.l.set(st.step, this.life.save()); }
    }
    st.step++;
    st.cityTime = st.step * SIM_DT; st.simTime = st.cityStart + st.cityTime; st.modeTime += dt;
    this.lastStep = 0; this.accel = 0;
    this.deadline();
    if (st.mode === "country") { this.countryStep(dt); return; }
    if (st.mode === "inbound") { this.inboundStep(); return; }
    if (st.mode === "dwell") { this.dwell(); return; }
    if (st.mode === "reverse") { this.reverse(dt); return; }
    // The old truck stays parked at a swap lot until the new one is well away.
    if (st.parked && Math.hypot(st.parked.x - this.pose.x, st.parked.z - this.pose.z) > 220) st.parked = null;
    if (!this.path) {
      if (!st.stops.length && st.simTime >= st.retryAt) {
        this.planStops();
        if (!st.stops.length) st.retryAt = st.simTime + 5;
      }
      const next = st.stops[0];
      if (!next) { this.placePose(); return; }
      this.routeTo(next);
      if (!this.path) return;
    }
    this.drive(dt);
  }

  private drive(dt: number) {
    const st = this.st, p = this.path!;
    const front = this.frontX;
    let limit = Math.min(VMAX, p.speedLimit(st.s, BRAKE));
    let hardStop = Infinity; // rear-axle s the truck must not pass this frame
    // Signals (not in the country stub).
    this.lightAhead = "-";
    if (st.mode === "drive") {
      for (const sg of p.signals) {
        const target = sg.sLine - STOP_GAP - front, N = this.plan.graph.nodes[sg.node];
        const key = `${sg.node},${sg.sLine.toFixed(1)}`;
        if (st.s > target + 0.5) continue;           // already past this one
        const seed = this.plan.seed, dist = target - st.s;
        let state = signalState(N, sg.phase, st.simTime, seed, st.preempt);
        // Ask for priority: most of the time the light changes for the truck.
        st.preempt = st.preempt.filter((p) => st.simTime < p.p1 + 3);
        if (state === "red" && dist < 90 && st.preempt.length < PREEMPT_MAX && !st.preempt.some((p) => p.node === sg.node)
            && signalWait(N, sg.phase, st.simTime, seed) > 4
            && hash3(N.kx, N.kz, signalCycleIndex(N, st.simTime), seed, 0x9e1) < PREEMPT_CHANCE) {
          st.preempt.push({ node: sg.node, x: N.x, z: N.z, phase: sg.phase, p0: st.simTime, p1: st.simTime + PREEMPT_CLEAR + Math.max(6, dist / 5 + 6),
            was: signalState(N, (sg.phase + 1) % Math.max(2, N.phases), st.simTime, seed, null), from: this.liveOther(N, sg.phase, seed) });
        }
        // Or hold a green that would change before the truck gets there.
        if (state === "green" && dist < 90 && st.preempt.length < PREEMPT_MAX && !st.preempt.some((p) => p.node === sg.node)) {
          const eta = dist / Math.max(st.v, 4);
          if (signalGreenLeft(N, sg.phase, st.simTime, seed) < eta + 2
              && hash3(N.kx, N.kz, signalCycleIndex(N, st.simTime), seed, 0x9e2) < PREEMPT_CHANCE)
            st.preempt.push({ node: sg.node, x: N.x, z: N.z, phase: sg.phase, p0: st.simTime, p1: st.simTime + eta + 5, was: "red", ext: true });
        }
        this.lightAhead = state;
        if (state === "green" || st.committed === key) break;
        if (state === "red" && sg.move === "R" && st.redWait > 1.5 && dist < 1.2) { st.committed = key; break; } // right on red
        if (dist >= st.v * st.v / (2 * FIRM_BRAKE) - 0.5) {
          limit = Math.min(limit, Math.sqrt(2 * BRAKE * Math.max(0, dist)));
          hardStop = target;
        } else st.committed = key;                   // too close to stop: go through
        break;
      }
    }
    // All-way stops: a full stop at the line, a moment's look both ways, then on.
    if (st.mode === "drive") {
      for (const y of p.stops) {
        const target = y.sLine - STOP_GAP - front, key = `stop ${y.node},${y.sLine.toFixed(1)}`;
        if (st.s > target + 0.5) continue;           // already past this one
        if (st.stopGo === key) break;
        const dist = target - st.s;
        if (st.redWait > STOP_SIGN_PAUSE && dist < 1.2) { st.stopGo = key; break; }
        if (dist >= st.v * st.v / (2 * FIRM_BRAKE) - 0.5) {
          limit = Math.min(limit, Math.sqrt(2 * BRAKE * Math.max(0, dist)));
          hardStop = Math.min(hardStop, target);
        } else st.stopGo = key;                      // too close to stop: go through
        break;
      }
    }
    // Someone or something in its way (street life: truckStop): it stops short of them, as a driver
    // does. Stopped or crawling, held a second after the way is clear, so it doesn't creep on and
    // off; moving, it goes on as soon as it is.
    if (st.mode === "drive") {
      let ys = this.life?.truckStop?.(this) ?? null;
      if (ys !== null) { st.holdS = ys; st.holdT = 1; }
      else if ((st.holdT ?? 0) > 0 && st.v < 1) { st.holdT! -= dt; ys = st.holdS!; }
      else st.holdT = 0;
      // (Held standing by it, its own light not red nor turning: the jam's clock runs.)
      this.jam(dt, ys !== null && st.v < 0.05 && ys <= st.s + 0.5 && this.lightAhead !== "red" && this.lightAhead !== "yellow");
      // (Too close to stop there comfortably: it brakes as hard as it can all the same.)
      if (ys !== null) limit = Math.min(limit, Math.sqrt(2 * BRAKE * Math.max(0, ys - st.s)));
      if (ys !== null && (ys - st.s >= st.v * st.v / (2 * FIRM_BRAKE) - 0.5 || st.v < 3)) hardStop = Math.min(hardStop, Math.max(ys, st.s));
    }
    // The stop at the end of the path.
    if (st.mode === "drive" && st.stopS < THROUGH) {
      const dist = st.stopS - st.s;
      limit = Math.min(limit, Math.sqrt(2 * BRAKE * Math.max(0, dist)));
      hardStop = Math.min(hardStop, st.stopS);
    }
    const v0 = st.v;
    st.v = st.v < limit ? Math.min(limit, st.v + ACCEL * dt) : Math.max(limit, st.v - MAX_DECEL * dt);
    let ds = st.v * dt;
    if (st.s + ds > hardStop) { ds = Math.max(0, hardStop - st.s); st.v = 0; }
    this.accel = dt > 0 ? (st.v - v0) / dt : 0;
    st.s += ds; this.lastStep = ds;
    st.redWait = st.v < 0.05 ? st.redWait + dt : 0;
    if (st.stopS >= THROUGH && st.s >= p.length) { this.leave(st.s - p.length); return; }   // through the gate
    p.eval(st.s, this.pose);
    if (st.mode === "drive" && st.s >= st.stopS - 0.02 && st.v < 0.05) this.arrive();

  }

  // Indicator for the truck: the next turn within 45 m, or none.
  get indicator(): -1 | 0 | 1 {
    if (this.st.mode === "country" || this.st.mode === "inbound") { const r = this.country; return r ? r.indicator(this.countryU) : 0; }
    if (!this.path || this.st.mode !== "drive") return 0;
    for (const t of this.path.turns) {
      const d = t.s - this.st.s;
      if (d > -12 && d < 45) return t.dir;
    }
    return 0;
  }

  private arrive() {
    const st = this.st;
    st.v = 0;
    if (st.backS < st.stopS - 0.01) { this.beginReverse(); return; }
    this.startDwell();
  }

  // The phase of signal N other than `phase` showing green or yellow now (unpreempted), or -1.
  private liveOther(N: CNode, phase: number, seed: number): number {
    for (let p = 0; p < Math.max(2, N.phases); p++) if (p !== phase && signalState(N, p, this.st.simTime, seed, null) !== "red") return p;
    return -1;
  }

  // Pulled past the bay: switch to the bay path (whose far end is exactly here) and reverse
  // along it until the reference axle is docked at its start.
  private beginReverse() {
    const st = this.st, bay = this.bayPath(st.stops[0]);
    if (!bay) { this.startDwell(); return; }
    st.route = bay.path.route;
    this.path = bay.path;
    st.s = st.stopS = this.path.length; st.backS = bay.backS;
    st.mode = "reverse"; st.modeTime = 0;
    this.reversePose(st.s, this.pose);
  }

  // The gridlock clock (JAM_HONK): `held`, standing held by street life this step. Its time adds
  // up while held; once the truck has gone on since, it is cleared: JAM_CLEAR m once traffic is
  // making way for it (it holds there till the truck is through), else JAM_CREEP m (stop-and-go
  // traffic, creeping on a car length at a time, is not a gridlock: it adds up only standing).
  private jam(dt: number, held: boolean) {
    const st = this.st;
    st.jamHeld = held;
    if (held) { st.jamT = (st.jamT ?? 0) + dt; st.jamGo = 0; return; }
    if (!st.jamT) return;
    st.jamGo = (st.jamGo ?? 0) + Math.abs(st.v) * dt;
    if (st.jamT > JAM_SHOT) st.jamMoved = (st.jamMoved ?? 0) + Math.abs(st.v) * dt;
    if (st.jamGo > (st.jamT > JAM_HONK + JAM_REACT ? JAM_CLEAR : JAM_CREEP)) { st.jamT = 0; st.jamGo = 0; st.jamMoved = 0; }
  }
  // Whether the truck has honked, and traffic has had a moment to react: it clears the truck's way
  // (street life, traffic).
  get clearing() { return (this.st.jamT ?? 0) > JAM_HONK + JAM_REACT && (this.st.mode === "drive" || this.st.mode === "reverse"); }
  // Whether its horn sounds now (drawn: truck.ts honk): held long enough, two short blasts every
  // HONK_EVERY s (the first before traffic moves).
  get honking() {
    if ((this.st.jamT ?? 0) <= JAM_HONK || !this.st.jamHeld || (this.st.mode !== "drive" && this.st.mode !== "reverse")) return false;
    const u = (this.st.jamT! - JAM_HONK) % HONK_EVERY;
    return u < 0.4 || (u > 0.6 && u < 1.2);
  }

  // Backing into the bay, gently.
  private reverse(dt: number) {
    const st = this.st, p = this.path!;
    const dist = st.s - st.backS;
    // (A tractor swinging round ahead of its trailer goes faster than the trailer: slower then. And
    // someone in the way of its next metres back: it stops and waits for them to go by.)
    const blocked = this.life?.reverseBlocked?.(this) ?? false;
    this.jam(dt, blocked && Math.abs(st.v) < 0.05);
    const pace = Math.min(2.2, Math.sqrt(2 * 0.8 * Math.max(0, dist))) * Math.cos(this.reversePose(st.s, this.revB, true));
    const limit = blocked ? 0 : pace;
    const speed = -st.v;
    const next = speed < limit ? Math.min(limit, speed + 0.9 * dt) : Math.max(limit, speed - 3 * dt);
    let ds = next * dt;
    if (ds > dist) ds = Math.max(0, dist);
    this.accel = dt > 0 ? (-next - st.v) / dt : 0;
    st.v = -next; st.s -= ds; this.lastStep = -ds;
    this.reversePose(st.s, this.pose);
    if (dist - ds < 0.02 && next < 0.05) { st.v = 0; this.startDwell(); }
  }

  // Where the truck is at `s` along a bay path while reversing into it. A tractor-trailer's bay
  // path is its trailer axles' (the reference axle's): they follow it without sliding sideways,
  // the trailer along the path's heading there, and the kingpin rides KINGPIN_TO_AXLES ahead of
  // them. The tractor, its rear axle just behind the kingpin, heads the way the kingpin moves:
  // off the trailer's heading by atan(KINGPIN_TO_AXLES x curvature). (The curvature is smoothed over
  // a few metres, as a driver would steer it, and eased in over the first metres back from where
  // the drive in left the truck straight; docked, it's straight again.) Others: on the path.
  private revA: Pose = { x: 0, z: 0, h: 0, k: 0 }; private revB: Pose = { x: 0, z: 0, h: 0, k: 0 };
  private reversePose(s: number, out: Pose, yawOnly = false, peekOnly = false, path: Path | null = null): number {
    const p = path ?? this.path!;
    if (this.st.truck !== "tractor") { if (!yawOnly) { if (peekOnly) p.peek(s, out); else p.eval(s, out); } return 0; }
    const sa = s - TRAILER_TRAIL, s0 = Math.max(0, sa - 3), s1 = Math.min(p.length, sa + 3);
    // (Looking along the trailer's stretch of the path leaves the path's state alone: traffic reads
    // its lastOffset, which stays the truck's own, below.)
    const h0 = p.peek(s0, this.revA).h, h1 = p.peek(s1, this.revB).h;
    const kap = s1 > s0 ? Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)) / (s1 - s0) : 0;
    const k = kap * THREE.MathUtils.smoothstep(p.length - s, 0, 3);
    const yaw = -Math.atan(KINGPIN_TO_AXLES * k);   // the trailer's heading less the tractor's
    if (yawOnly) return yaw;
    const a = p.peek(sa, this.revA), h = a.h - yaw;
    const kx = a.x + Math.cos(a.h) * KINGPIN_TO_AXLES, kz = a.z - Math.sin(a.h) * KINGPIN_TO_AXLES;
    out.x = kx - Math.cos(h) * FIFTH_WHEEL; out.z = kz + Math.sin(h) * FIFTH_WHEEL; out.h = h; out.k = k;
    if (!peekOnly) p.eval(s, this.revB);   // (the path's state at the truck, as for other trucks)
    return yaw;
  }
  // Reversing into a bay (along `path`: its bay path, the current one by default): where the truck
  // will be with the path at `s` (into `out`) and its trailer's yaw then (as trailerYaw), for
  // traffic to keep out of its sweep. The path's state, which traffic reads, is left at the truck.
  reverseSweepPose(s: number, out: Pose, path: Path | null = null): number { return this.reversePose(s, out, false, true, path); }
  // Pulling past a dock's bay to reverse into it, its last 30 m: the bay path it will reverse
  // along (as beginReverse lays it) and where it will stop on it, for traffic to hold clear of the
  // sweep before it starts back. Else null. (Laid once per stop.)
  upcomingReverse(): { path: Path; backS: number } | null {
    const st = this.st, stop = st.stops[0];
    if (st.mode !== "drive" || !this.path || !stop || st.backS >= st.stopS - 0.01 || st.stopS - st.s > 30) return null;
    return this.bayPath(stop);
  }
  // A dock stop's bay path, which the truck reverses along from its far end (where it pulled past
  // the bay) to backS, docked; or null (no dock there). (Laid once per stop: traffic's view of it
  // ahead, upcomingReverse, and the truck's are the one path.)
  private bay: { stop: Stop; path: Path; backS: number } | null = null;
  private bayPath(stop: Stop): { path: Path; backS: number } | null {
    if (this.bay?.stop !== stop) {
      const dock = this.dockPlan(stop);
      if (!dock) return null;
      const route = { d: dock.face, before: this.plan.graph.faceLen(dock.face) - (dock.pa + dock.R), edges: [], after: dock.pa + dock.R + dock.pull + dock.trail, dock: dock.geom };
      this.bay = { stop, path: new Path(this.plan.graph, route), backS: dock.trail };
    }
    return this.bay;
  }
  // The trailer's articulation while reversing into a bay (reversePose), where the truck is
  // drawn (between steps), or null to let the truck's own hitch model run.
  trailerYaw(): number | null {
    const st = this.st;
    if (st.truck !== "tractor" || st.mode !== "reverse" || !this.path) return null;
    return this.reversePose(st.s - (1 - this.alpha) * this.lastStep, this.revB, true);
  }
  // How far the truck has reversed along its bay path (where it's drawn), or -1 when it isn't.
  get reversed(): number { return this.st.mode === "reverse" && this.path ? this.path.length - (this.st.s - (1 - this.alpha) * this.lastStep) : -1; }

  private startDwell() {
    const st = this.st;
    st.mode = "dwell"; st.modeTime = 0; st.dwellDone = false;
    this.planDwell();
  }

  private dwell() {
    const st = this.st, stop = st.stops[0];
    const ph = this.dwellPhase();
    if (!st.dwellDone && stop.kind !== "swap" && ph.phase === "load" && ph.t >= ph.len / 2) { this.doStop(stop); st.dwellDone = true; }
    if (!st.dwellDone && stop.kind === "swap" && (ph.phase === "startup")) { this.doStop(stop); st.dwellDone = true; }
    if (st.modeTime >= st.dwellTotal) {
      if (!st.dwellDone) { this.doStop(stop); st.dwellDone = true; }
      const dock = this.dockPlan(stop);
      st.stops.shift(); st.stopsDone++;
      if (dock) {
        // Out of the bay next: the route starts in it and joins the street after the turn.
        st.at = { d: dock.face, before: this.plan.graph.faceLen(dock.face) - (dock.pa + dock.R) };
        st.dockExit = { geom: dock.geom, s: dock.trail };
      } else if (this.path?.route.garageIn) {
        // Down off the roof next: the route starts there and comes out across the street, in the
        // kerb lane back towards the node the truck came in past.
        const L = siteLayout(this.plan, stop.site!.bx, stop.site!.bz) as GarageLayout, f = this.plan.face(stop.site!.bx, stop.site!.bz, L.side);
        st.at = { d: f ^ 1, before: GARAGE_OUT_BEFORE + this.plan.siteDelta(stop.site!.bx, stop.site!.bz) };
        st.garageExit = { x: this.pose.x, z: this.pose.z, h: this.pose.h };
      } else this.arriveAtEnd();
      this.path = null; st.route = null; st.s = 0; st.v = 0;
      st.mode = "drive"; st.modeTime = 0; this.chores = [];
      this.placePose();
    }
  }

  // Apply a stop's effect on the ledger (or the truck).
  private doStop(stop: Stop) {
    const st = this.st;
    if (stop.kind === "swap") {
      // The driver is now in the spare truck: it becomes the journey's truck and the old one
      // stays parked where it stopped.
      this.log(`swap ${st.truck} -> ${stop.truck} at ${stop.site!.name}`);
      st.parked = { model: st.truck, x: this.pose.x, z: this.pose.z, h: this.pose.h };
      st.truck = stop.truck!; st.spare = null; slotCompact(st.aboard); st.swapAt = st.simTime + 60 * (15 + 15 * this.rand(3)); st.jobsSinceSwap = 0;
      ({ front: this.frontX, center: this.centerX } = truckExtents(st.truck));
      st.s = this.path!.length; this.path!.eval(st.s, this.pose);
      return;
    }
    const c = CARGO_BY_ID.get(stop.cargo)!;
    if (stop.kind === "pickup") {
      // Tag each unit with its drop; the job's drops are the queued stops with the same job id.
      const drops = st.stops.filter((s) => s.kind === "drop" && s.job === stop.job);
      // In the order they were stowed, from the stop's slot back.
      let slot = stop.slot ?? 0;
      const put = (units: number, dest: string) => { if (c.slots >= 1 && slot !== stop.slot) slot = slotAlign(c.slots, slot); st.aboard.push({ job: stop.job, cargo: c.id, units, slotsPerUnit: c.slots, dest, slot }); slot = slotEnd(c.slots, units, slot); };
      if (drops.length) for (const d of drops) put(d.units, siteKey(d.site!));
      else put(stop.units, "next");
      st.loaded += stop.units; st.jobsSinceSwap++;
      this.log(`load ${stop.units} ${c.name} at ${stop.site!.name}`);
    } else {
      const key = siteKey(stop.site!);
      let n = 0;
      st.aboard = st.aboard.filter((a) => { if (a.job === stop.job && a.dest === key) { n += a.units; return false; } return true; });
      st.unloaded += n;
      this.log(`unload ${n} ${c.name} at ${stop.site!.name}`);
    }
  }

  // The city's time is nearly up and the truck hasn't left: anything still aboard for this city is
  // handed to another driver and it heads out of town now (between stops: a stop in progress is
  // finished first). Normally the final pickup finishes well before this. As a last resort, with
  // no time left to drive out, it is put on the road at a gate (a jump; never seen in tests).
  private deadline() {
    const st = this.st;
    if (st.mode === "country" || st.mode === "inbound") return;
    const [bx, bz] = this.truckBlock();
    if (st.cityTime >= this.period - COUNTRY_MIN) { this.log("out of time: forced onto the road"); this.forceLeave(); return; }
    if (st.mode !== "drive" || st.stops.some((x) => x.kind === "depart") || st.cityTime < this.period - COUNTRY_MIN - this.gateTime(bx, bz) - (this.path ? 150 : 40)) return;
    // A stop it is already driving to is still made (the truck can't turn off mid-street).
    const keep = this.path && st.stops[0] ? [st.stops[0]] : [];
    const n = this.aboardUnits - keep.reduce((a, k) => a + (k.kind === "drop" ? k.units : 0), 0);
    if (n > 0) { st.unloaded += n; st.aboard = st.aboard.filter((a) => keep.some((k) => k.kind === "drop" && a.job === k.job && a.dest === siteKey(k.site!))); }
    this.log(`out of time; ${Math.max(0, n)} units handed off, leaving`);
    // The truck the next city starts with, if there is time to change to it on the way.
    const want = this.freightFor(st.city + 1)?.truck, swap: Stop[] = [];
    if (want && want !== st.truck && !keep.some((k) => k.kind === "swap")) {
      const lot = this.findNear(["rentalLot"], bx, bz, LOT_SEARCH, new Set(), 1)[0];
      if (lot && st.cityTime + this.estimate([...keep, { kind: "swap", site: lot, job: 0, cargo: "", units: 0 }], bx, bz) + this.gateTime(lot.bx, lot.bz) + COUNTRY_MIN < this.period)
        swap.push({ kind: "swap", site: lot, job: ++st.jobCounter, cargo: "", units: 0, truck: want });
    }
    st.stops = [...keep, ...swap, { kind: "depart", site: null, job: -1, cargo: "", units: 0 }]; st.intercity = true;
  }

  // Rough seconds to drive out of town from block (bx, bz).
  private gateTime(bx: number, bz: number) {
    let best = Infinity;
    const inward = (entryGateOf(citySeedOf(this.cfg.seed, this.st.city + 1)).dir + 2) % 4;
    const G = this.plan.graph;
    GATES.forEach((g, i) => { const gt = G.gates[i]; if (!gt || (inward - g.dir + 4) % 4 === 2) return; const n = G.nodes[gt.node]; best = Math.min(best, Math.abs(Math.floor(n.x / BLOCK) - bx) + Math.abs(Math.floor(n.z / BLOCK) - bz)); });
    return (best + 1) * BLOCK / GATE_SPEED + 20;
  }

  // The way out: a route from where the truck is now to the end of a gate street, choosing among
  // the gates whose way out is at most a quarter turn from the next city's way in (and straight
  // on when the drive will be short), and how long the road to the hand-over is planned to be.
  private planExit(): { route: Route; gate: number; dEst: number } | null {
    const st = this.st, at = this.pathEnd();
    const inward = (entryGateOf(citySeedOf(this.cfg.seed, st.city + 1)).dir + 2) % 4;
    const G = this.plan.graph;
    let best: { route: Route; gate: number; dEst: number; cost: number } | null = null;
    for (let i = 0; i < GATES.length; i++) {
      const g = GATES[i], turn = (inward - g.dir + 4) % 4;
      const gt = G.gates[i];
      if (!gt || turn === 2 || g === this.plan.freeway) continue;   // (not a closed gate, nor out under the flyover the highway came in on)
      const gst = G.streets[gt.street];
      const route = planRoute(G, at.d, at.before, [{ d: gst.id * 2 + (gt.out === 1 ? 0 : 1), after: gst.len - GATE_TRIM }], 6000, this.drivable);
      if (!route) continue;
      if (at.lane !== undefined) route.lane = at.lane;
      const len = new Path(G, route).length;
      const dEst = Math.round((this.period - st.cityTime - len / GATE_SPEED) * 10) / 10;
      const cost = len + (turn !== 0 && dEst < 50 ? 1500 : 0);
      if (!best || cost < best.cost) best = { route, gate: i, dEst, cost };
    }
    if (!best) return null;
    best.dEst = Math.max(COUNTRY_MIN, best.dEst);
    return best;
  }
  // Where the next route starts from: the current edge.
  private pathEnd() { return this.st.at; }
  // The streets the truck may drive through (city streets: gate streets only as a goal).
  private readonly drivable = (d: number) => this.plan.graph.streets[d >> 1].inCity;

  // Through the end of the gate street (or put there, as a last resort): onto the road, `s0`
  // metres along it already.
  private leave(s0: number) {
    const st = this.st;
    st.mode = "country"; st.modeTime = 0; st.departAt = st.cityTime; st.departTruck = st.truck;
    st.departV = st.v; st.departS0 = s0;
    st.spare = null; st.parked = null; st.dockExit = null; st.garageExit = null; st.intercity = true;
    st.stops = st.stops.filter((s) => s.kind !== "depart");
    this.path = null; st.route = null;
    this.log(`leaving for the country: ${(this.period - st.departAt).toFixed(0)} s to the next city's road`);
    this.countryPose();
  }
  private forceLeave() {
    const st = this.st;
    if (!st.exit) {
      const inward = (entryGateOf(citySeedOf(this.cfg.seed, st.city + 1)).dir + 2) % 4;
      // (Straight on if it can, else at most a quarter turn, else any open gate: some are closed.)
      const open = (i: number) => this.plan.gateOpen(i) && GATES[i] !== this.plan.freeway, turn = (i: number) => (inward - GATES[i].dir + 4) % 4;
      const idx = [...GATES.keys()], i = idx.find((k) => open(k) && turn(k) === 0) ?? idx.find((k) => open(k) && turn(k) !== 2) ?? idx.find((k) => this.plan.gateOpen(k)) ?? 0;
      st.exit = { gate: i, dEst: Math.max(COUNTRY_MIN, this.period - st.cityTime) };
    }
    st.v = 8;
    this.leave(0);
  }

  // ---- the country drive --------------------------------------------------------------------
  // The road out of town (built once the way out is planned: after a seek or a restore too), with
  // the motion it actually has once the truck is on it.
  private exitCache: { key: string; road: CountryRoad; motion: string } | null = null;
  get exitRoad(): CountryRoad | null {
    const st = this.st;
    if (!st.exit) return null;
    const key = `${this.cfg.seed}/${st.city}/${st.exit.gate}/${st.exit.dEst}`;
    if (!this.exitCache || this.exitCache.key !== key) this.exitCache = { key, road: this.makeExitRoad(st.city, st.exit.gate, st.exit.dEst, st.truck), motion: "" };
    const c = this.exitCache;
    if (st.departAt >= 0) {
      const m = `${st.departAt.toFixed(1)}/${st.departV}/${st.departS0}`;
      if (c.motion !== m) { c.road.setMotion(this.period - st.departAt, st.departV, st.departS0); c.motion = m; }
    }
    return c.road;
  }
  // The last city's road out, while it is still at hand (continuous playback: main.ts keeps drawing
  // it behind the truck after the hand-over).
  // City N's road out by gate `gate` (a pure function of the seed and these).
  private makeExitRoad(N: number, gate: number, dEst: number, fromTruck: TruckModel): CountryRoad {
    const e = gateEnd(GATES[gate]), N1 = N + 1, toClimate = this.climateOf(N1), fromClimate = this.climateOf(N);
    const toStyle = this.styleOf(N1), fromStyle = this.styleOf(N);
    const inward = (entryGateOf(citySeedOf(this.cfg.seed, N1)).dir + 2) % 4;
    const toFreeway = !!freewayGate(citySeedOf(this.cfg.seed, N1), toStyle), toFreewayMerge = toFreeway && this.takesFreeway(N1);
    return new CountryRoad({ toFreeway, toFreewayMerge, toSea: this.onSea(N1),
      seed: this.cfg.seed, city: N, kind: "exit", frame: e, dEst, endH: inward * Math.PI / 2,
      fromTruck, toTruck: this.freightFor(N1)?.truck ?? "box26",
      fromStyle, toStyle, fromClimate, toClimate, fromName: cityName(citySeedOf(this.cfg.seed, N), fromStyle), toName: cityName(citySeedOf(this.cfg.seed, N1), toStyle),
    });
  }
  // The last city's road out, while it is still at hand: main.ts keeps drawing it behind the truck
  // after the hand-over. From the journey state, so a seek within this city finds it too.
  private prevCache: { key: string; road: CountryRoad } | null = null;
  get previousExit(): CountryRoad | null {
    const c = this.exitCache, st = this.st;
    if (c && c.road.inp.city === st.city - 1) return c.road;
    const p = st.prev;
    if (!p) return null;
    const key = `${this.cfg.seed}/${st.city - 1}/${p.gate}/${p.dEst}/${p.fromTruck}/${p.departAt}/${p.departV}/${p.departS0}`;
    if (!this.prevCache || this.prevCache.key !== key) {
      const road = this.makeExitRoad(st.city - 1, p.gate, p.dEst, p.fromTruck);
      road.setMotion(this.period - p.departAt, p.departV, p.departS0);
      this.prevCache = { key, road };
    }
    return this.prevCache.road;
  }
  // City N's plan: this city's, or the next's as its road out needs it (whether it has its sea:
  // CityPlan falls back to none), kept to be this city's when the journey gets there. (The last
  // few, so a scrub back and forth over a hand-over doesn't build them again and again.)
  private plans = new Map<number, CityPlan>();
  private styleOf(N: number) { return seasonalStyle(journeyStyle(this.cfg.seed, N), this.climateOf(N)); }
  private planOf(N: number): CityPlan {
    const seed = citySeedOf(this.cfg.seed, N), have = this.plans.get(N);
    if (have && have.seed === seed) { this.plans.delete(N); this.plans.set(N, have); return have; }
    const plan = new CityPlan(seed, this.styleOf(N));
    this.plans.set(N, plan);
    if (this.plans.size > 3) this.plans.delete(this.plans.keys().next().value!);
    return plan;
  }
  // Whether city N is on the sea: only built out to see when it could be (seaSide).
  private onSea(N: number) { return seaSide(citySeedOf(this.cfg.seed, N), this.styleOf(N)) !== null && this.planOf(N).outline.sea !== null; }
  // The arrival straight into this city (pure: from the seed alone).
  private arrivalCache: CountryRoad | null = null;
  get arrivalRoad(): CountryRoad {
    const st = this.st, key = `${this.cfg.seed}/${st.city}`;
    if (!this.arrivalCache || this.arrivalCache.inp.city !== st.city || this.arrivalCache.inp.seed !== this.cfg.seed) {
      const g = this.plan.entryGate, e = gateEnd(g), h = e.h + Math.PI;
      const N0 = Math.max(0, st.city - 1), fromClimate = this.climateOf(N0);
      this.arrivalCache = new CountryRoad({
        seed: this.cfg.seed, city: st.city, kind: "arrival", toSea: this.plan.outline.sea !== null, toFreeway: !!this.plan.freeway, toFreewayMerge: !!this.plan.freeway && this.takesFreeway(st.city),
        frame: { x: e.x - Math.cos(h) * ARRIVE_LEN, z: e.z + Math.sin(h) * ARRIVE_LEN, h }, dEst: 0, endH: h,
        fromTruck: st.truck, toTruck: st.truck,
        fromStyle: this.plan.style, toStyle: this.plan.style, fromClimate, toClimate: this.climate, fromName: this.plan.name, toName: this.plan.name,
      });
      void key;
    }
    return this.arrivalCache;
  }
  // The road the truck is on now, if any.
  get country(): CountryRoad | null {
    const m = this.st.mode;
    return m === "country" ? this.exitRoad : m === "inbound" ? this.arrivalRoad : null;
  }
  // Drive time along it.
  get countryU() { const st = this.st; return st.mode === "country" ? st.cityTime - st.departAt : st.mode === "inbound" ? st.cityTime : -1; }
  get countryS() { const r = this.country; return r ? r.sAt(Math.max(0, this.countryU)) : 0; }
  get countryStopped() { const r = this.country, x = r ? r.stoppedAt(this.countryU) : null; return !!x && x.kind !== "weigh" && x.kind !== "ferry"; }   // (not on a weigh station's scale or at a ferry)
  // On a ferry: the boat carries the truck, its wheels still.
  get countryAboard() { const r = this.country; return !!r && this.st.mode === "country" && r.aboardAt(this.countryU); }

  private countryPose() {
    const r = this.country!, u = this.countryU;
    r.poseAt(u, this.pose);
    this.st.v = r.vAt(u);
  }

  // One step of the drive out of town: the road gives the pose.
  private countryStep(_dt: number) {
    const px = this.pose.x, pz = this.pose.z;
    this.countryPose();
    this.lastStep = Math.hypot(this.pose.x - px, this.pose.z - pz);
  }
  // One step of the arrival straight; at its end the truck is at the start of the gate street,
  // where the city's own routing takes over (at gate speed, not stopping).
  private inboundStep() {
    const st = this.st, px = this.pose.x, pz = this.pose.z;
    this.countryPose();
    this.lastStep = Math.hypot(this.pose.x - px, this.pose.z - pz);
    if (st.cityTime >= this.arrivalRoad.arriveDur - 1e-6) {
      st.mode = "drive"; st.modeTime = 0; st.v = this.arrivalRoad.inp.toFreewayMerge ? FW_OFF_V : V_GATE;
      this.path = null; st.route = null;
    }
  }
  get countryLength() { return this.st.departAt < 0 ? 0 : this.period - this.st.departAt; }

  snapshot(): JourneyState { return this.st; }
  get keyframeCount() { return this.frames.get(this.st.city)?.k.size ?? 0; }
}

const dist = (a: Site, b: Site) => Math.abs(a.bx - b.bx) + Math.abs(a.bz - b.bz);
