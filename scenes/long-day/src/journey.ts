// The journey: an endless chain of jobs, simulated independently of rendering.
//
// Time is deterministic and seekable. The journey runs on a fixed clock of SIM_DT steps. Its cities
// and the roads between them are the visit planner's (visits.ts). Each city aims to take about
// `period` (cityMinutes, and the drive out along its world road, that road's own seconds): its jobs
// are planned to end in time to leave, and the drive out takes its road's seconds (dEst). But that
// is a guideline, not a deadline: running late or early, the truck finishes what it is doing and
// leaves, and the next city starts when the truck gets there (cityStart). A city's starting state (truck, freight carried in, route start) is a pure
// function of the journey seed and N, so a city is replayed from its start; the starts of the
// cities played so far are kept (starts), and within a city keyframes every KEYFRAME_STEPS make
// seeking (and scrubbing backwards) instant. A seek past what has been played plays on to it,
// every city between included (slow, far ahead in the preview; a board never seeks). A journey
// started at time t (tests, test renders) takes t's city at its nominal start (nominalStart: the
// periods before it, end to end); it gets there before street life is attached (main.ts), so where
// that crosses a hand-over, the next city starts where a run without traffic would put it, not
// where a board's continuous play does. (A test render given visit specs starts at 0 and seeks
// instead, so its skip stays in the first visit however long that ran: main.ts.)
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
import { setVisitSpecs, visitOf } from "./visits.ts";
import type { RoadWay, StopBatch, StopSpec, VisitSpec } from "./visits.ts";
import type { Config } from "./env.ts";
import { DEBUG_CARGO } from "./debug.ts";
import { SPECS, truckExtents, truckLayout } from "./truck.ts";
import { FIFTH_WHEEL, KINGPIN_TO_AXLES } from "./hitch.ts";
import { CARGO_MODELS } from "./cargomodels.ts";
import type { TruckModel } from "./truck.ts";
import { PREEMPT_CHANCE, PREEMPT_MAX, signalCycleIndex, signalGreenLeft, signalState, signalWait, PREEMPT_CLEAR } from "./signals.ts";
import type { SignalColor, SignalPreempt } from "./signals.ts";
import { cityName, journeyStyle } from "./styles.ts";
import { seaSide } from "./outline.ts";
import { cargoSeason, cityClimate, seasonalStyle } from "./climate.ts";
import type { Climate, Season } from "./climate.ts";
import { CITY_HI, CITY_LO, CityPlan, gateEnd } from "./city.ts";
import { BLOCK, CURB_H, STREET } from "./grid.ts";
import type { Gate, KerbDoor } from "./city.ts";
import type { CityGraph, CNode } from "./citygraph.ts";
import { DOCK_PLATFORM, dockBayFor, dockDoorH, dockDoorW, dockStair, facilityAt, facilityName, hasSign, RENTAL_LOTS, siteLayout } from "./facilities.ts";
import type { FacilityId } from "./facilities.ts";
import { CARGO, CARGO_BY_ID, pickCargo, SEA_CARGO, STORY_CARGO, STORY_FREIGHT, STORY_FREIGHT_IN, STORY_TOWN, VIC_CARGO, VIC_FREIGHT, VIC_FREIGHT_IN, slotAlign, slotCompact, slotEnd, slotFind, TRUCK_SLOTS, truckCarries } from "./cargo.ts";
import { blockGoals, LANE_KERB, Path, planRoute, STOP_BACK } from "./route.ts";
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
import { ARRIVE_DUR, ARRIVE_LEN, citySeedOf, CountryRoad, roadMetres, V_GATE, V_JOIN } from "./country.ts";
import { roadMapOf } from "./roadmap.ts";
import { bedRearX, fetchSpots, handTrips, jackStays, jackTrial, maxHandUnits, PAVE_SPOTS, planChores, STYLE, swapChores } from "./chores.ts";
import type { Chore, ChoreGroup, WalkBox } from "./chores.ts";

// Street life is stepped and saved with the journey (keyframes), so the truck may answer to it and a
// scrub still replays the same: truckStop, where on its path the truck (its rear axle) is to stop
// short of someone or something in its way (a crosser, a car ahead, a car with the junction before
// it), or null; reverseBlocked, whether someone is in the way of its next metres back into a bay.
// Without street life (tests of the bare journey) the way is always clear.
export interface LifeHook { reset(j: Journey): void; step(j: Journey): void; save(): string; load(s: string, j: Journey): void; truckStop?(j: Journey): number | null; gapHeld?: boolean; heldByWaiter?: boolean; reverseBlocked?(j: Journey): boolean; rescue?(): { id: number; x: number; z: number; h: number; side: number; up: boolean } | null }   // gapHeld: truckStop's stop is a wait for a gap to pull out (no gridlock); heldByWaiter: what it stops for waits on the truck in turn (a deadlock)
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
export const DWELL = { park: 3, exit: 4.4, enter: 5.0, startup: 1.5 };   // (exit, enter: crew.ts climb, the door opened and shut by hand and the steps taken one at a time)
type DwellPhase = "park" | ChoreGroup | "startup";
export interface DwellNow { phase: DwellPhase; t: number; len: number; chore: Chore | null; ct: number }
const STOP_SIGN_PAUSE = 1.5;     // s the truck stands at a stop sign's line before going on
const SWAP_GAP = 2.5;          // metres between the old truck's nose and the new truck's tail
const PULL_RIGHT_MIN = 35;    // metres to the junction ahead a tractor-trailer pulling away needs to turn right there (routeTo)
const WALK_SPEED = 1.35;
export const SWAP_RAMP = 0.6;   // a swap's walk: seconds getting up to WALK_SPEED, and slowing to a stop at the new door (director.ts swapWalkU)
const GATE_TRIM = STREET / 2;   // a gate street's outer end (the hand-over to the country road) is this short of its far node
// The road out, built ahead over the steps after the way out is planned: EXIT_PIECES pieces a step
// for EXIT_AHEAD steps (exitRoadAhead), whatever is left at its first use.
const EXIT_AHEAD = 30, EXIT_PIECES = 6;
// The goals on faces long enough to stop along (CityGraph.hasFrontage), or all of them if none is.
const fronted = (G: CityGraph, all: Goal[]) => { const f = all.filter((g) => G.hasFrontage(g.d)); return f.length ? f : all; };

interface JourneyState {
  city: number; citySeed: number; cityTime: number; simTime: number;
  cityStart: number; step: number;  // the city's slot start, and steps simulated in it
  clockBase: number;                // the journey time the city's clock starts from (clockTime): its start, unless its visit's spec gives another
  retryAt: number;                  // after a failed job search, when to look again
  departAt: number;                 // city time the truck left town (the end of its gate street), or -1
  departV: number; departS0: number; departTruck: TruckModel;   // its speed, how far onto the road it already was, and its truck
  exit: { gate: number; dEst: number } | null;   // the gate it is leaving by (its graph's gates) and the planned drive to the hand-over
  exitStep?: number;   // the step the way out was planned on (its road is built from the next: exitRoadAhead)
  prev?: { gate: number; dEst: number; fromTruck: TruckModel; departAt: number; departV: number; departS0: number; countryD?: number } | null;   // the last city's road out, to keep drawing it after the hand-over
  truck: TruckModel; mode: Mode; modeTime: number; dwellTotal: number; dwellDone: boolean;
  route: Route | null; s: number; v: number; at: { d: number; before: number; lane?: number };   // the dedge the truck is on, how far short of its end, and its lane (kerb unless said)
  stopS: number; backS: number;     // where the truck stops, and where it reverses to (dock stops)
  dockExit: { geom: DockGeom; s: number } | null;   // leaving a bay: the next route starts in it
  leaves?: boolean;                                // a tractor-trailer's swing doors open: from before it backs into a bay until it has pulled out (doorDwell)
  doors?: "open" | "close";                        // the dwell now is the driver opening them, or closing them (doorDwell)
  doorsAt?: number;                                // pulling out of a bay with them open: where it stops to close them (-1: DOOR_PULL on from where it sets off)
  doorsFor?: Stop;                                 // closing them: the dock stop just made
  lastDock?: DockGeom | null;                      // the bay last docked at in this city (dockfx.ts: its leveller's lip stays there till the next)
  garageExit?: GarageGeom | null;                  // up on a garage's roof: the next route starts down its ramp
  spare: TruckModel | null; parked: ParkedTruck | null;
  stops: Stop[]; aboard: Aboard[]; loaded: number; unloaded: number;
  jobCounter: number; batch: number; swapAt: number; jobsSinceSwap: number; noSwap: boolean; intercity: boolean; committed: string; stopGo: string; redWait: number; preempt: SignalPreempt[]; hitchYaw?: number; hitchFrom?: number; holdS?: number; holdT?: number; countryD?: number; jamT?: number; jamGo?: number; jamMoved?: number; jamHeld?: boolean; acc?: number; lim?: number;   // acc, lim: its acceleration and speed limit last step (easing between them)   // hold: where street life last had it stop, for how much longer   // jam: how long street life has held it standing (its own light not red, or held by what waits on it: life.ts heldByWaiter), how far it has gone since last held and in all since the director's shot of it (JAM_SHOT), and whether it is held now   // stopGo: the all-way stop it has stood at and goes on from (apart from committed, which the lights write)
  stopsDone: number; events: string[];
}

// The truck's nose ahead of its rear axle, which its path is drawn for, and its body's tail behind
// it (route.ts Route.nose, Route.tail): a tractor's its cab's (its trailer swings on its own: hitch.ts).
const truckNose = (m: TruckModel) => SPECS[m].noseFront + 0.05;
const truckTail = (m: TruckModel) => SPECS[m].fifthWheel === undefined ? -truckExtents(m).rear : 1.5;
export const SIM_DT = 0.1;              // the fixed simulation step
const KEYFRAME_STEPS = 100;       // a keyframe every 10 s of journey within the current city
const DRIVE_PACE = 18;          // m/s a drive averages, stops and all (for planning a city's time)
const COUNTRY_MIN = 45;           // the drive from the gate to the hand-over is never planned shorter than this
// A world road's key, driven one way or the other: each way is a road of its own, the same each time.
// A rig pulling up at a kerb is lined up straight over this run in (m: hitchStep).
const STRAIGHTEN = 18;
// m: how far a tractor-trailer pulls out of a dock's bay before it stops to close its swing doors.
const DOOR_PULL = 4.5;
// m: how far short of a face's end a truck stopping at the kerb has its nose: short of the stop
// line ahead (STOP_BACK short of the street's mouth), where a car stopped there would be.
const NOSE_BACK = STOP_BACK + 0.5;
const THROUGH = 1e9;              // stopS of a path driven straight through its end (JSON has no Infinity)
const GATE_SPEED = 6.5;           // rough average speed across town, for timing the way out
// (Metres) what a drive takes beyond the graph's corner to corner: round to the kerb, the lights
// and the turns; set so a grid town's estimates are what they were when it counted blocks.
const DRIVE_SLACK = 3 * BLOCK, GATE_SLACK = BLOCK;
const GATE_MAX = 900;             // s: longer than any drive out of town could be (deadline's early out)
const VMAX = 11, ACCEL = 1.6, BRAKE = 2.2, MAX_DECEL = 5, STOP_GAP = 0.6;
export const FIRM_BRAKE = 4.5;   // m/s^2: braking it takes to stop for a light; closer than that, it goes through (traffic.ts too)
// How fast its acceleration may change (m/s^3): pulling away and easing off gently; braking harder
// comes on quicker, as a driver's foot does. (Without it, a limit that comes and goes from one step
// to the next, a car ahead seen and then not, had it surge and shudder.)
const JERK = 4, BRAKE_JERK = 20, LIM_TAU = 0.4;
// HOLD_CREEP (m/s): how slowly it rolls up the last of the way to where street life holds it;
// HOLD_KEEP (s): how long, moving, it keeps a hold street life stops seeing (one passing close).
const HOLD_CREEP = 0.15, HOLD_KEEP = 0.5;
// Gridlock: held standing by street life JAM_HONK s (its own light not red, unless what holds it
// waits on it in turn, life.ts heldByWaiter; its own way back into a bay not clear of traffic), the
// truck honks, every HONK_EVERY s. Nobody pays it any mind. It never
// moves into anyone itself: held on, the clowns come for what holds it up (clowns.ts). A jam it has
// honked in is over once it has gone JAM_CLEAR m (stopping again behind the next thing in its way, a
// car length on, it is still the same jam: the clowns come back for that).
export const JAM_HONK = 14;
export const JAM_SHOT = 8;   // (director.ts: its shot of the jam, from this far into it; jamMoved counts on from here)
const JAM_CLEAR = 15, JAM_CREEP = 3, HONK_EVERY = 6;
const SEARCH = 12;           // blocks searched around a point for facilities
const LOT_SEARCH = 40;
const SWAP_SEARCH = 14;      // blocks searched for a source of another truck's cargo when a swap is due
export const siteKey = (s: Site) => `${s.bx},${s.bz}`;
// Where a truck stops along face d of a site at the kerb: its rear axle's distance along the face,
// the truck centred on it (`pull` further on), or on a short face back from there as far as it
// takes to keep its nose short of the stop line ahead (NOSE_BACK): pulling away from past the line,
// it would go on through the junction without its turn, red light and all. (Also
// tools/clearstops.ts, which keeps its stops' pavements clear.)
// (`carriage`: in the Victorian city, measured to its team's nose: truck.ts truckExtents.)
export function kerbStopAfter(G: CityGraph, d: number, model: TruckModel, pull = 0, carriage = false) {
  const { front, center } = truckExtents(model, carriage);
  return Math.min((G.faceA0(d) + G.faceA1(d)) / 2 - center + pull, G.faceA1(d) - NOSE_BACK - front);
}
// A stop as a visit spec writes it (visits.ts StopSpec): its site by block.
const stopSpec = (x: Stop): StopSpec => x.kind === "depart" ? { kind: "depart" } :
  x.kind === "swap" ? { kind: "swap", at: siteKey(x.site!), truck: x.truck, job: x.job } : { kind: x.kind as "pickup" | "drop", at: siteKey(x.site!), cargo: x.cargo, units: x.units, job: x.job };

// The city's front doors (city.ts kerbDoors), set by the scene before the first journey; tests
// leave it unset and the driver uses a spot on the pavement instead.
let DOOR_PROBE: ((plan: CityPlan, bx: number, bz: number) => (KerbDoor | null)[]) | null = null;
export function setDoorProbe(probe: ((plan: CityPlan, bx: number, bz: number) => (KerbDoor | null)[]) | null) { DOOR_PROBE = probe; }
// What stands on the pavement round a block (city.ts pavementObstacles), for a front door with
// something big before it to be passed over (doorTakes); set by the scene, absent in tests. The
// crew's walks take no notice of it: the city files keep each kerb stop's work area clear
// (tools/clearstops.ts).
let PAVEMENT_PROBE: ((plan: CityPlan, bx: number, bz: number) => { x: number; z: number; r: number; kind?: number }[]) | null = null;
export function setPavementProbe(probe: typeof PAVEMENT_PROBE) { PAVEMENT_PROBE = probe; }
// A front door is no use with something this big (radius, m) on the pavement within this of the
// spot this far out in front of it (findKerbDoor).
const DOOR_BLOCK_R = 0.5, DOOR_BLOCK_AT = 1.0;
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

  // `visits`: what a test gives for some of the journey's visits (visits.ts VisitSpec), the rest
  // planned from the seed as ever.
  constructor(readonly cfg: Config, t: number, startSeason: Season, visits?: Record<number, VisitSpec>) {
    setVisitSpecs(cfg.seed, visits);
    this.startSeason = startSeason;
    this.st = this.entryState(this.cityAt(Math.max(0, t)));
    ({ front: this.frontX, center: this.centerX } = truckExtents(this.st.truck, !!this.plan.style.victorian));
    this.placePose();
    this.advanceTo(Math.max(0, t));
  }

  // City N's visit (visits.ts): the way it arrives by and the way it leaves by (the next city's
  // way in), and the drive out's seconds as planned. Its period: cityMinutes in town and that drive.
  private arriveOf(N: number) { return visitOf(this.cfg.seed, N).arrive; }
  private leaveOf(N: number) { return visitOf(this.cfg.seed, N + 1).arrive; }
  // (Planned at an average drive's pace, DRIVE_PACE: the drive itself takes as long as its road's
  // length, the truck's speed and its stops make it, country.ts.)
  private driveOf(N: number) { return Math.round(roadMetres(this.leaveOf(N).road) / DRIVE_PACE); }
  periodOf(N: number) { return this.cfg.cityMinutes * 60 + this.driveOf(N); }
  get period() { return this.periodOf(this.st.city); }
  // City N's nominal start: the periods of the cities before it, end to end.
  private nominal: number[] = [0];
  nominalStart(N: number) {
    while (this.nominal.length <= N) { const k = this.nominal.length - 1; this.nominal.push(this.nominal[k] + this.periodOf(k)); }
    return this.nominal[N];
  }
  private nominalAt(t: number) { let N = 0; while (this.nominalStart(N + 1) <= t + 1e-9) N++; return N; }
  // When city N started (or, not reached yet, will at the earliest: its nominal start, or later),
  // and the city under journey time t: the last one started by then, of those played.
  private starts = new Map<number, number>();
  cityStart(N: number) { return this.starts.get(N) ?? this.nominalStart(N); }
  // When the next city takes over, once the truck is out on the road to it (the step stepJourney
  // hands over on); Infinity before. (cityAt knows a city's start only once it is reached.)
  get handOverAt() {
    const st = this.st;
    if (st.mode !== "country") return Infinity;
    return st.cityStart + Math.ceil((st.departAt + this.countryLength - 1e-6) / SIM_DT) * SIM_DT;
  }
  cityAt(t: number) {
    if (!this.starts.size) return this.nominalAt(Math.max(0, t));
    let best = -1, bt = -Infinity;
    for (const [N, s] of this.starts) if (s <= t + 1e-9 && s > bt) { bt = s; best = N; }
    // (Before every city played: by the nominal starts, as a journey started there would take it.)
    return best >= 0 ? best : this.nominalAt(Math.max(0, t));
  }
  // The gate the truck comes in at (the graph's gates): its way in's (visits.ts).
  private entry = 0;
  get entryGate() { return this.entry; }

  // ---- city starts --------------------------------------------------------------------------
  // City N's starting state, from the seed alone: it enters at the same edge every time, in the
  // truck its freight needs, with that freight bound for a receiver near the entrance.
  private entryState(N: number, at?: number): JourneyState {
    const citySeed = citySeedOf(this.cfg.seed, N);
    this.climate = this.climateOf(N);
    this.plan = this.planOf(N);
    this.plan.climate = this.climate;
    this.facCache.clear(); this.dockCache = null; this.batchLog.clear(); this.byName = null;
    for (const c of [...this.frames.keys()]) if (this.keepNeighbours ? Math.abs(c - N) > 1 : c !== N) this.frames.delete(c);
    this.path = null; this.chores = [];
    this.accel = 0; this.lastStep = 0; this.lightAhead = "-";   // (as a journey starting here has them)
    const start = at ?? this.cityStart(N);
    this.starts.set(N, start);
    // (A visit's spec may give the truck it starts in: it then comes in empty, unless the freight
    // it would have brought rides in that truck.)
    const carried = this.freightFor(N), truck = this.startTruck(N), freight = carried && carried.truck === truck ? carried : null;
    // In through the gate its way in arrives at: the slot starts on the highway, ARRIVE_DUR seconds out.
    this.entry = this.arriveOf(N).in;
    const st: JourneyState = {
      city: N, citySeed, cityTime: 0, simTime: start, cityStart: start, step: 0, retryAt: 0, departAt: -1, departV: 0, departS0: 0, departTruck: "box26", exit: null,
      truck, mode: "inbound", modeTime: 0,
      dwellTotal: 0, dwellDone: false, route: null, s: 0, v: V_JOIN, at: this.gateIn(),
      stopS: 0, backS: 0, dockExit: null, spare: null, parked: null,
      stops: [], aboard: [], loaded: 0, unloaded: 0, jobCounter: 0, batch: 0,
      // The first swap falls due 2 to 12 minutes in (each city plays from its own start, so the
      // timer can't carry over from the last one). A swap job may not fit in the time left, and
      // some cities have no source of another truck's cargo, so not every city gets one.
      swapAt: start + 60 * (2 + 10 * hash2(visitOf(this.cfg.seed, N).index, 1, visitOf(this.cfg.seed, N).jobs, 0x5a9)),
      clockBase: visitOf(this.cfg.seed, N).spec?.clock ?? start, jobsSinceSwap: 0, noSwap: false, intercity: false,
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
      const [gbx, gbz] = this.gateBlock();
      const dsts = this.findNear(c.to, gbx, gbz, 8, new Set(), 1);
      if (dsts.length) {
        st.aboard.push({ job: 0, cargo: c.id, units: freight.units, slotsPerUnit: c.slots, dest: siteKey(dsts[0]), slot: 0 });
        st.stops.push({ kind: "drop", site: dsts[0], job: 0, cargo: c.id, units: freight.units });
        st.loaded = freight.units;   // carried in from the last city
      }
    }
    ({ front: this.frontX, center: this.centerX } = truckExtents(st.truck, !!this.plan.style.victorian));
    if (this.life) { this.placePose(); this.life.reset(this); }
    return st;
  }

  // The city block at the way in's inner end (where the way in is planned from): the block on
  // the right of the way in.
  private gateBlock(): [number, number] {
    const G = this.plan.graph, b = G.faceBlock[this.gateIn().d], gt = G.gates[this.entry]!;
    const blk = b >= 0 ? G.blocks[b] : G.nearestBlock(G.nodes[gt.node].x, G.nodes[gt.node].z);
    return blk ? [blk.kx, blk.kz] : [0, 0];
  }
  // The way in: down the entry's gate street from its outer end (GATE_TRIM short of the node
  // beyond), towards the perimeter node.
  gateIn(): { d: number; before: number } {
    const G = this.plan.graph, gt = G.gates[this.entry]!, st = G.streets[gt.street];
    return { d: st.id * 2 + (gt.out === 1 ? 1 : 0), before: st.len - GATE_TRIM };
  }

  // The freight city N arrives with (city 0 starts empty): a common cargo, from the seed. The
  // city before it picks this up last, in this truck (swapping first if it must).
  // A storybook city sends its wonders on: the city after one picks them up last, from the works
  // (its bolts of knitting or its cloud cushions: every storybook city has the works). It is itself
  // brought one of cargo.ts STORY_FREIGHT_IN, which come from facilities every other city has.
  // A Victorian city is the same with its steam brewery's ale and stout, and is itself brought one
  // of the period goods that come from facilities every city has (cargo.ts VIC_FREIGHT_IN), so
  // nothing modern arrives there.
  freightFor(N: number): { cargo: string; units: number; truck: TruckModel } | null {
    // (A visit's spec may give it.)
    const given = visitOf(this.cfg.seed, N).spec?.freight;
    if (given) return given === "none" ? null : { ...given };
    if (N <= 0) return null;
    const pool = CARGO.filter((c) => c.tier === "common" && c.handling !== "walkOn" && !c.season && c.truck !== "flatbed" && !VIC_CARGO.has(c.id) && !STORY_CARGO.has(c.id));
    const pick = (ids: string[], k: number) => CARGO_BY_ID.get(ids[Math.floor(hash2(N, k, this.cfg.seed, 0xf8e) * ids.length)])!;
    const c = journeyStyle(this.cfg.seed, N).victorian ? pick(VIC_FREIGHT_IN, 6) : journeyStyle(this.cfg.seed, N - 1).victorian ? pick(VIC_FREIGHT, 7)
      : journeyStyle(this.cfg.seed, N - 1).storybook ? pick(STORY_FREIGHT, 5) : journeyStyle(this.cfg.seed, N).storybook ? pick(STORY_FREIGHT_IN, 8) : pool[Math.floor(hash2(N, 2, this.cfg.seed, 0xf8e) * pool.length)];
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
    const f = this.frames.get(N), target = Math.floor((t - this.cityStart(N)) / SIM_DT + 1e-6);
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
    ({ front: this.frontX, center: this.centerX } = truckExtents(this.st.truck, !!this.plan.style.victorian));
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

  // The city's clock, which its lights and street life run on: its time since it began, from
  // clockBase. (A visit captured at one place in a journey keeps its clock wherever it is played.)
  get clockTime() { return this.st.clockBase + this.st.cityTime; }

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
  // `truck` is the truck that will stop there. A tractor-trailer reaches fewer blocks (deliverable).
  private findNear(types: FacilityId[], bx: number, bz: number, radius: number, avoid: Set<string>, minDist = 1, truck: TruckModel = this.st.truck): Site[] {
    const out: { s: Site; d: number }[] = [];
    for (const [x, z] of this.deliverable(truck === "tractor")) {
      const d = Math.abs(x - bx) + Math.abs(z - bz);
      if (d < minDist || d > radius || avoid.has(`${x},${z}`)) continue;
      if (types.includes(this.facility(x, z))) out.push({ s: this.site(x, z), d });
    }
    out.sort((a, b) => a.d - b.d);
    return out.map((o) => o.s);
  }
  // The city's blocks a stop may be at, by key, north to south and west to east (findNear's order
  // among blocks as near as each other): in town, not the plaza (with no building to deliver to),
  // nor an interchange's, nor one whose every kerb is the wrong way up a one-way street. For a
  // tractor-trailer, only those it can drive to and away from, keeping to its moves (citygraph.ts
  // tractorReach): at a site, along the site's kerb; elsewhere, along any the truck can stop at.
  // (Fixed for the city, so worked out once: job planning asks it over and over.)
  private delivCache: { plan: CityPlan; keys: [number, number][]; tractor: [number, number][] } | null = null;
  private deliverable(tractor = false): [number, number][] {
    const P = this.plan;
    if (this.delivCache?.plan !== P) {
      const G = P.graph, keys: [number, number][] = [];
      for (const b of G.blocks) {
        if (!b.inCity || b.id === P.plaza || P.blockOf(b.kx, b.kz) !== b || P.interchangeAt(b.kx, b.kz) || !b.faces.some((f) => G.drivable(f))) continue;
        keys.push([b.kx, b.kz]);
      }
      keys.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
      const reach = G.tractorReach();
      const served = ([kx, kz]: [number, number]) => {
        const b = P.blockOf(kx, kz)!, L = siteLayout(P, kx, kz);
        return L.kind === "kerb" ? b.faces.some((f) => G.hasFrontage(f) && G.drivable(f) && reach.has(f)) : reach.has(P.face(kx, kz, L.side));
      };
      this.delivCache = { plan: P, keys, tractor: keys.filter(served) };
    }
    return tractor ? this.delivCache.tractor : this.delivCache.keys;
  }
  private truckBlock(): [number, number] {
    return [Math.floor(this.pose.x / BLOCK), Math.floor(this.pose.z / BLOCK)];
  }

  // ---- job planning ---------------------------------------------------------------------------
  private rand(salt: number) { return hash3(this.st.jobCounter, this.visit.index, salt, this.visit.jobs, 0x10b); }
  // The visit being played (visits.ts): its city, way in and seeds.
  get visit() { return visitOf(this.cfg.seed, this.st.city); }

  private season() { return cargoSeason(this.climate); }
  climateOf(N: number): Climate {
    // (A visit's spec may give its season, as if the journey had started so, and its weather.)
    const spec = visitOf(this.cfg.seed, N).spec, SEASONS: Season[] = ["winter", "spring", "summer", "autumn"];
    const start = spec?.season ? SEASONS[(((SEASONS.indexOf(spec.season) - N) % 4) + 4) % 4] : this.startSeason;
    let c = cityClimate(this.cfg.seed, N, journeyStyle(this.cfg.seed, N), start);
    if (spec?.weather) c = { ...c, weather: spec.weather, snowCover: c.season === "winter" && (spec.weather === "snow" || c.snowCover) };
    if (spec?.snow !== undefined) c = { ...c, snowCover: c.season === "winter" && spec.snow };
    return this.cfg.weather ? c : { ...c, weather: "clear" };   // (weather off: clear skies; the season stays)
  }

  // Rough seconds to make `stops` in turn, starting from nodes `from` (fromTruck, fromBlock): the
  // street graph's shortest drive to each (city streets, the right way up one-way ones) at ~6 m/s,
  // plus the way round to the kerb, about 50 s at each stop, and a reverse at docks.
  private estimate(stops: Stop[], from: readonly number[]) {
    let t = 0;
    for (const s of stops) {
      if (!s.site) continue;
      const to = this.fromBlock(s.site.bx, s.site.bz);
      t += (this.driveTo(from, to) + DRIVE_SLACK) / 6 + 50 + (this.isDockStop(s) ? 25 + (this.st.truck === "tractor" ? 70 : 0) : 0) + (s.kind === "swap" ? 60 : 0);   // (a trailer's doors opened before backing in and closed after: doorDwell)
      from = to;
    }
    return t;
  }
  // The street graph's nodes round block (bx, bz): where a drive from it starts, or one to it ends.
  private fromBlock(bx: number, bz: number): number[] {
    const G = this.plan.graph, B = this.plan.blockOf(bx, bz);
    if (!B) return this.nodesNear(bx * BLOCK + 39, bz * BLOCK + 39);
    return [...new Set(B.faces.map((f) => G.dedgeFrom(f)))].sort((p, q) => p - q);
  }
  // The node nearest the truck (where its drive anywhere starts).
  private fromTruck(): number[] { return this.nodesNear(this.pose.x, this.pose.z); }
  private nodesNear(x: number, z: number): number[] {
    let best = 0, bd = Infinity;
    for (const N of this.plan.graph.nodes) { const d = (N.x - x) ** 2 + (N.z - z) ** 2; if (d < bd) { bd = d; best = N.id; } }
    return [best];
  }
  // Metres of the shortest drive from any of `from` to any of `to`; where none (a cut-off corner),
  // as the crow flies and a half again.
  private driveTo(from: readonly number[], to: readonly number[]) {
    const G = this.plan.graph, D = G.driveDists(from);
    let best = Infinity;
    for (const v of to) best = Math.min(best, D[v]);
    if (best < Infinity) return best;
    for (const a of from) for (const b of to) best = Math.min(best, 1.5 * Math.hypot(G.nodes[a].x - G.nodes[b].x, G.nodes[a].z - G.nodes[b].z));
    return best;
  }

  // Fill the stop queue when it runs dry: from the visit's spec while it has batches of stops
  // left, else drawn. Either way the batch is written down (captureSpecs).
  private planStops() {
    const st = this.st;
    if (st.intercity) return;
    const k = st.batch, script = this.visit.spec?.stops, before = st.stops.length;
    if (script && k < script.length) this.playBatch(script[k], k); else this.drawStops();
    st.batch = k + 1;
    this.batchLog.set(k, { stops: st.stops.slice(before).map(stopSpec), counter: st.jobCounter, noSwap: st.noSwap, intercity: st.intercity });
  }
  // The batches of stops planned in this city so far, by number (keyed, so a seek back over them
  // writes the same ones again).
  private batchLog = new Map<number, StopBatch>();

  // A batch from the visit's spec: its stops as written, checked against the city (a site a
  // pickup comes from must be one its cargo comes from, and so on), and the counter and flags.
  private playBatch(b: StopBatch, k: number) {
    const st = this.st, counter = b.counter ?? st.jobCounter + 1;
    const bad = (i: number, why: string): never => { throw new Error(`visit ${st.city} (${this.visit.city.id}) stop batch ${k}, stop ${i}: ${why}`); };
    // (The truck each stop is made in, a swap's onwards, and the slots its pickups so far take.)
    let truck = st.truck, used = this.aboardSlots;
    const stops = b.stops.map((x, i): Stop => {
      const job = x.job ?? counter;
      if (x.kind === "depart") return { kind: "depart", site: null, job: -1, cargo: "", units: 0 };
      if (!x.at) bad(i, "no site (at)");
      const site = this.siteAt(x.at!) ?? bad(i, `no site "${x.at}" in this city`);
      const reach = x.kind === "swap" ? this.lotTruck(x.truck ?? truck) : truck;
      if (!this.deliverable(reach === "tractor").some(([bx, bz]) => bx === site.bx && bz === site.bz)) bad(i, `${site.name} (${siteKey(site)}) is no block a ${reach} can stop at`);
      if (x.kind === "swap") {
        if (!RENTAL_LOTS.includes(site.fac)) bad(i, `${site.name} is not a rental lot`);
        if (!x.truck) bad(i, "a swap with no truck");
        truck = x.truck!;
        return { kind: "swap", site, job, cargo: "", units: 0, truck: x.truck };
      }
      const c = CARGO_BY_ID.get(x.cargo ?? "") ?? bad(i, `no cargo "${x.cargo}"`);
      const kinds = x.kind === "pickup" ? c.from : c.to;
      if (!kinds.includes(site.fac)) bad(i, `${c.id} doesn't ${x.kind === "pickup" ? "come from" : "go to"} ${site.name} (a ${site.fac})`);
      if (!(x.units! >= 1)) bad(i, "no units");
      if (x.kind === "pickup") {
        if (!truckCarries(truck, c.truck)) bad(i, `a ${truck} can't carry ${c.id} (it goes in a ${c.truck})`);
        used += x.units! * c.slots;
        if (used > TRUCK_SLOTS[truck]) bad(i, `${x.units} ${c.id} don't fit in the ${truck} (${TRUCK_SLOTS[truck]} slots, ${used} wanted)`);
        if (handTrips(truckLayout(truck), c.handling) && x.units! > maxHandUnits(c.id)) bad(i, `${x.units} ${c.id} are more than the trips carry by hand (${maxHandUnits(c.id)})`);
      }
      return { kind: x.kind, site, job, cargo: c.id, units: x.units! };
    });
    st.stops.push(...stops);
    st.jobCounter = counter;
    if (b.noSwap !== undefined) st.noSwap = b.noSwap;
    if (b.intercity) st.intercity = true;
    this.log(`stops from the spec: ${stops.map((x) => x.kind + (x.site ? " " + x.site.name : "")).join(", ") || "none"}`);
  }
  // The city's sites a stop may be at, with their names and facilities (for writing a spec's stops).
  get sites(): Site[] { return this.deliverable().map(([x, z]) => this.site(x, z)); }
  // A site in this city by its name, or its block as "bx,bz" (a name more than one site has: by its
  // block, which the error lists).
  private byName: Map<string, Site[]> | null = null;
  private siteAt(at: string): Site | null {
    const m = /^(-?\d+),(-?\d+)$/.exec(at.trim());
    if (m) return this.site(Number(m[1]), Number(m[2]));
    if (!this.byName) {
      this.byName = new Map();
      for (const site of this.sites) this.byName.set(site.name, [...(this.byName.get(site.name) ?? []), site]);
    }
    const found = this.byName.get(at.trim()) ?? [];
    if (found.length > 1) throw new Error(`"${at}" is ${found.length} sites in ${this.visit.city.id}: give one by its block, ${found.map(siteKey).join(" or ")}`);
    return found[0] ?? null;
  }

  // The specs that play visit N (the current city) as it has played so far, and the next visit's
  // way in (which sets this one's way out and drive, and its freight what this one picks up last):
  // for Journey's `visits`, as the first two, with any seed. A test runs them against the seeded
  // journey (test/visitspec.ts).
  captureSpecs(): [VisitSpec, VisitSpec] {
    const N = this.st.city, v = this.visit, next = visitOf(this.cfg.seed, N + 1), c = this.climateOf(N);
    const freight = (n: number) => this.freightFor(n) ?? "none";
    const stops = [...this.batchLog.keys()].sort((a, b) => a - b).map((k) => this.batchLog.get(k)!);
    return [
      { city: v.city.id, arriveBy: v.arrive.road.id, truck: this.startTruck(N), season: c.season, weather: c.weather, snow: c.snowCover, freight: freight(N),
        index: v.index, clock: this.st.clockBase, jobs: v.jobs, dressing: v.dressing, gags: v.gags, drive: v.drive, stops },
      { city: next.city.id, arriveBy: next.arrive.road.id, freight: freight(N + 1) },
    ];
  }

  // Journey time when the dwell at stop k (0, the first) of visit N begins, played from the start
  // of that visit; or null if it hasn't by the visit's end. `life`: the street life to play it
  // with, as the journey it is for has (traffic holds the truck up, so it changes when).
  static stopTime(cfg: Config, startSeason: Season, visits: Record<number, VisitSpec> | undefined, k: number, N = 0, life?: () => LifeHook): number | null {
    const probe = new Journey(cfg, 0, startSeason, visits);
    if (N > 0) probe.seekTo(probe.nominalStart(N));
    if (life) probe.attachLife(life());
    let seen = 0, was = probe.st.mode;
    for (let guard = 400000; guard-- > 0 && probe.st.city === N;) {
      probe.step();
      if (probe.st.mode === "dwell" && was !== "dwell" && probe.st.stops[0]?.kind !== "depart" && seen++ === k) return probe.st.simTime;
      was = probe.st.mode;
    }
    return null;
  }

  private drawStops() {
    const st = this.st;
    const C = this.cfg.cityMinutes * 60, cutoff = C * (24 / 30);
    const [bx, bz] = this.truckBlock();
    const final = () => {
      // Final pickup: the next city's freight, in the truck it needs; then leave.
      let job = this.makeJob(bx, bz, true);
      // Only if there is time for it and the drive out of town after it (a short stay may not).
      if (job) {
        const last = job[job.length - 1].site!;
        if (st.cityTime + this.estimate(job, this.fromTruck()) + this.gateTime(this.fromBlock(last.bx, last.bz)) + this.driveOf(st.city) + 20 > this.period) { this.log("no time for a final pickup"); job = null; }
      }
      // Without it, the truck still has to be the one the next city starts with.
      const want = this.freightFor(st.city + 1)?.truck;
      if (!job && want && want !== st.truck) {
        const lot = this.findNear(RENTAL_LOTS, bx, bz, LOT_SEARCH, new Set(), 1, this.lotTruck(want))[0];
        if (lot) job = [{ kind: "swap", site: lot, job: ++st.jobCounter, cargo: "", units: 0, truck: want }];
      }
      if (job) st.stops.push(...job);
      this.log(`final pickup planned: ${job ? job.map((j) => j.kind + " " + j.site?.name).join(", ") : "none"} est ${job ? this.estimate(job, this.fromTruck()).toFixed(0) : 0}s`);
      st.stops.push({ kind: "depart", site: null, job: -1, cargo: "", units: 0 });
      st.intercity = true;
    };
    if (st.cityTime >= cutoff) { final(); return; }
    // Only start a job that leaves time for the final pickup before the city's time is up; near
    // the end, look for a shorter one before giving up.
    const here = this.fromTruck(), reserve = 360 + this.gateTime(here);   // a typical final pickup, swap included, and the drive out of town
    let first: Stop[] | null = null, tooLong = false;
    for (let tries = 0; tries < 6; tries++) {
      first = this.makeJob(bx, bz, false);
      if (!first || st.cityTime + this.estimate(first, here) + reserve <= C) break;
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
      if (first && st.cityTime + this.estimate(first, here) + reserve > C) first = null;
    }
    if (!first) { this.log("no job found; cruising"); return; }
    // A mixed load now and then: a second pickup near the first, then all drops by nearest next.
    const pickA = first.find((s) => s.kind === "pickup")!;
    // (Not with a load that rides on the pallet jack, jackStays: the jack is under it. Nor in a
    // tractor-trailer, whose pallets fill it two wide: one job's would block the other's.)
    const stays = (ss: Stop[]) => ss.some((s) => s.kind !== "swap" && jackStays(truckLayout(st.truck), s.cargo));
    if (this.rand(7) < 0.3 && st.truck !== "tractor" && !first.some((s) => s.kind === "swap") && !stays(first)) {
      st.jobCounter++;
      const second = this.makeJob(pickA.site!.bx, pickA.site!.bz, false, true, this.slotsOf(first));
      if (second && !second.some((s) => s.kind === "swap") && !stays(second) && st.cityTime + this.estimate([...first, ...second], here) * 1.15 + reserve <= C) {
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
    // (In a Victorian city, only its own goods: cargo.ts VIC_CARGO; in a storybook city, its own: STORY_TOWN.)
    const here = new Set([`${bx},${bz}`]), vic = !!this.plan.style.victorian, own = vic ? VIC_CARGO : this.plan.style.storybook ? STORY_TOWN : null;
    const pool = swapDue && !freight && !DEBUG_CARGO
      ? new Set(CARGO.filter((c) => c.truck !== st.truck && (own ? own.has(c.id) : !STORY_CARGO.has(c.id) && !VIC_CARGO.has(c.id)) && this.findNear(c.from, bx, bz, SWAP_SEARCH, here, 2, c.truck).length).map((c) => c.id))
      : null;
    // (The waterfront's cargo with a source near, looked for once: makeJob's shore pick.)
    let seaNear: Set<string> | null = null;
    // (And the city's own goods with a source near are likewise looked for once.)
    let ownNear: Set<string> | null = null;
    const ownHas = (k: { id: string }) => (ownNear ??= new Set([...own!].filter((id) => this.findNear(CARGO_BY_ID.get(id)!.from, bx, bz, 14, here, 1).length > 0))).has(k.id);
    const seaHas = (k: { id: string }) => (seaNear ??= new Set([...SEA_CARGO].filter((id) => this.findNear(CARGO_BY_ID.get(id)!.from, bx, bz, SEARCH, here, 1).length > 0))).has(k.id);
    for (let attempt = 0; attempt < 24; attempt++) {
      st.jobCounter++;
      // When a swap is due, the first attempts draw from that pool, so the truck really changes.
      const change = !!pool?.size && attempt < 16;
      // (In a town on the sea, half the first attempts try the waterfront's cargo, where it has a
      // source near and this truck can carry it (or a swap is due): its fish markets, chandlers and
      // surf shops, facilities.ts waterfrontAt. About one job in ten comes out the waterfront's.)
      const shore = !freight && !DEBUG_CARGO && !change && !own && attempt < 12 && this.plan.outline.sea !== null && this.rand(9) < 0.5
        ? pickCargo(this.rand(1), this.rand(2), 0, season, (k) => SEA_CARGO.has(k.id) && (swapDue || truckCarries(st.truck, k.truck)) && seaHas(k)) : null;
      // (In a Victorian or storybook city, the first attempts are its goods with a source near that
      // this truck can carry; the rest any of its goods.)
      const period = own && !freight && !DEBUG_CARGO && !change && attempt < 16
        ? pickCargo(this.rand(1), this.rand(2), this.cfg.humorFrequency, season, (k) => own.has(k.id) && (swapDue || truckCarries(st.truck, k.truck)) && ownHas(k), own) : null;
      const c = freight ? CARGO_BY_ID.get(freight.cargo)! : (DEBUG_CARGO && CARGO_BY_ID.get(DEBUG_CARGO)) || shore || period ||
        (change && pickCargo(this.rand(1), this.rand(2), this.cfg.humorFrequency, season, (k) => pool!.has(k.id), own)) ||
        pickCargo(this.rand(1), this.rand(2), this.cfg.humorFrequency, season, own ? (k) => own.has(k.id) : undefined, own)!;
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
      const near = attempt < 14, wide = c.tier === "rare" || c.tier === "humorous" || SEA_CARGO.has(c.id) || STORY_CARGO.has(c.id) || VIC_CARGO.has(c.id);   // (the waterfront's, and the storybook and Victorian cities' own, come from few places each)
      // (The storybook city has one works, and the Victorian city one brewery: its freight is fetched
      // from it wherever it is in town.)
      let sources = this.findNear(c.from, bx, bz, reach || ((STORY_FREIGHT.includes(c.id) || VIC_FREIGHT.includes(c.id)) && freight ? 40 : change ? SWAP_SEARCH : freight ? (near ? 9 : 18) : wide ? (near ? 7 : 14) : near ? 5 : SEARCH), avoid, 2, truck);
      if (!sources.length) continue;
      // (A load left on the pallet jack: from a dock, or a shop with a door it can come out of,
      // rather than one where it would have to wait on the pavement, if there are any.)
      if (jackStays(truckLayout(truck), c.id)) { const ok = sources.filter((s) => this.siteTakes(s, c.id, truck)); if (ok.length) sources = ok; }
      const src = sources[Math.min(sources.length - 1, Math.floor(this.rand(4) * Math.min(3, sources.length)))];
      avoid.add(siteKey(src));
      const cap = TRUCK_SLOTS[truck] - usedSlots;
      let units = freight ? freight.units : c.units[0] + Math.floor(this.rand(5) * (c.units[1] - c.units[0] + 1));
      units = Math.min(units, Math.floor(cap / c.slots));
      if (handTrips(truckLayout(truck), c.handling)) units = Math.min(units, maxHandUnits(c.id));   // no more than the trips carry
      if (jackStays(truckLayout(truck), c.id)) units = 1;   // (left on the one pallet jack, one at a time)
      if (units < 1) continue;
      const pickup: Stop = { kind: "pickup", site: src, job: st.jobCounter, cargo: c.id, units };
      if (intercity) {   // the drop is in the next city
        if (fits) return [pickup];
        const lots = this.findNear(RENTAL_LOTS, bx, bz, LOT_SEARCH, new Set(), 1, this.lotTruck(truck));
        return lots.length ? [{ kind: "swap", site: lots[0], job: st.jobCounter, cargo: "", units: 0, truck }, pickup] : null;
      }
      // (A swap's job makes one drop: the swap itself takes time.)
      const nDrops = change ? 1 : Math.min(units, 1 + Math.floor(this.rand(6) * (c.tier === "common" ? 3 : 1.5)));
      const drops: Stop[] = [];
      let cur = src, left = units;
      for (let i = 0; i < nDrops; i++) {
        const cands = this.findNear(c.to, cur.bx, cur.bz, Math.max(reach / 2, change ? 10 : wide ? (near ? 6 : 10) : near ? 4 : 6), avoid, 1, truck);
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
        const lots = this.findNear(RENTAL_LOTS, bx, bz, LOT_SEARCH, new Set(), 1, this.lotTruck(truck));
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
      st.route = plan.route; st.exit = { gate: plan.gate, dEst: plan.dEst }; st.exitStep = st.step;
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
        const front = truckExtents(stop.truck!, !!this.plan.style.victorian).front, L = siteLayout(this.plan, bx, bz);
        const all = blk.sides.map((f) => ({ d: f, after: G.faceA1(f) - NOSE_BACK - front, straight: true }));
        // (A rental lot's frontage ends at a 51 past its square's start: on a block where the
        // square sits on an anchor, the face can run on past it, the truck must not.)
        goals = L.kind === "lot" ? [{ ...all[L.side], after: Math.min(G.faceA1(blk.sides[L.side]) - NOSE_BACK, 51 + this.plan.siteDelta(bx, bz) - 4) - front }] : fronted(G, all);
      } else {
        // A park's stand is on one side of it: stop there. A garage: along the side its ramp is
        // on, to where the way in turns off (straight through the node before, to be in the kerb
        // lane), and on up onto its roof.
        // (At a yard stand, a little further on, so the bed clears the container: crew.ts stackPlan.)
        // (Centred on the side.)
        const L = siteLayout(this.plan, bx, bz);
        // (And a face that holds it so, its tail short of the junction behind, before one that doesn't.)
        const all = blk.sides.map((f) => ({ d: f, after: kerbStopAfter(G, f, st.truck, this.isYardStand(stop) ? YARD_PULL : 0, !!this.plan.style.victorian) }));
        const rear = 2 * this.centerX - this.frontX, holds = all.filter((g) => g.after + rear >= G.faceA0(g.d));
        goals = L.kind === "stand" ? [all[L.side]] : this.garageStop(stop) ? [{ d: blk.sides[(L as GarageLayout).side], after: GARAGE_IN_A + this.plan.siteDelta(bx, bz), straight: true }] : fronted(G, holds.length ? holds : all);
      }
      // A tractor-trailer pulling away within PULL_RIGHT_MIN of the junction ahead goes on any way
      // but right there, if it can reach the stop so: its trailer, straight behind it at the kerb,
      // would cut across the corner, signal pole and all.
      const noRight = SPECS[st.truck].fifthWheel !== undefined && st.at.before < PULL_RIGHT_MIN ? G.movesFrom(st.at.d).find((m) => m.move === "R")?.to : undefined;
      // (A tractor-trailer never takes a move that would drag its trailer across a corner: citygraph.ts noTractor.)
      const moveOk = this.movesFor(st.truck);
      st.route = noRight === undefined ? null : planRoute(G, st.at.d, st.at.before, goals, 6000, (d) => d !== noRight && this.drivable(d), moveOk);
      st.route ??= planRoute(G, st.at.d, st.at.before, goals, 6000, this.drivable, moveOk);
      // (Where no way in comes straight on through the corner before it, as at a Y-junction, any way in.)
      if (!st.route && goals.some((g) => g.straight)) st.route = planRoute(G, st.at.d, st.at.before, goals.map((g) => ({ ...g, straight: false })), 6000, this.drivable, moveOk);
      if (st.route && st.at.lane !== undefined) st.route.lane = st.at.lane;
      if (!st.route) { this.log(`no route to ${stop.site!.name}; skipping`); st.stops.shift(); return; }
      if (this.garageStop(stop)) { st.route.garageIn = true; this.log(`up onto the roof of ${stop.site!.name}`); }
      st.spare = stop.kind === "swap" ? stop.truck! : null;
    }
    // Leaving a bay: the route starts inside it.
    let s0 = 0;
    if (st.dockExit) { st.route.dock = st.dockExit.geom; s0 = st.dockExit.s; st.dockExit = null; }
    if (st.garageExit) { st.route.garageOut = st.garageExit; st.garageExit = null; }
    st.route.wide = st.truck === "tractor" || undefined;
    st.route.nose = truckNose(st.truck); st.route.tail = truckTail(st.truck);
    this.path = new Path(this.plan.graph, st.route);
    st.s = s0; st.committed = ""; st.stopGo = ""; st.redWait = 0; st.holdT = 0; st.jamT = 0; st.jamGo = 0; st.jamMoved = 0;
    st.stopS = this.path.length;
    if (stop.kind === "swap") {
      const spare = truckExtents(stop.truck!);
      st.stopS = this.path.length - (this.frontX + SWAP_GAP - spare.rear);
    }
    st.backS = dock ? -1 : st.stopS;   // below stopS: reverse into the bay on arrival
    if (stop.kind === "depart") st.stopS = THROUGH;   // no stop at the end: straight on out of town
    if (st.mode !== "drive") { st.mode = "drive"; st.modeTime = 0; st.acc = 0; st.lim = undefined; }
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
      geom: { x: ref.x, z: ref.z, H, Lb, R, door, trail }, edge: at(p, L.edge), H, sign };
  }
  get dock(): DockPlan | null { return this.dockPlan(this.st.stops[0]); }
  // Whether the truck comes into city N by its freeway (freeway.ts freewayMerge): never a
  // tractor-trailer, whose trailer would cut across the off-ramp's loop. (From the seed alone: the
  // truck it comes in is the one its freight needs.)
  private takesFreeway(N: number) {
    return this.arriveOf(N).in === 0 && freewayMerge(citySeedOf(this.cfg.seed, N)) && this.startTruck(N) !== "tractor";
  }
  // The truck city N starts in: its visit spec's, else the one its freight needs.
  private startTruck(N: number): TruckModel {
    return visitOf(this.cfg.seed, N).spec?.truck ?? this.freightFor(N)?.truck ?? "box26";
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
      if (on < 0 && (k === "doorOpen" || k === "leafOpen")) on = end;
      if (k === "doorClose" || k === "leafClose") off = end;
    }
    return on >= 0 && off > on && tc >= on && tc < off;
  }

  // How far the stop's front door (kerbDoor) stands open, 0..1, for the driver's trips through it
  // (FrontDoorFx): opened with the truck's door (or, at a stop without one to open, as the driver
  // reaches it the first time), held open between trips, and closed once everyone's done with
  // it: as the last load goes into the truck (a pickup), or as the truck is closed up (a drop).
  get frontDoorOpen(): number {
    if (this.st.mode !== "dwell" || !this.chores.length) return 0;
    const tc = this.st.modeTime - DWELL.park, ch = this.chores, S = this.choreStart;
    const first = ch.findIndex((c) => c.kind === "fetch");
    if (first < 0) return 0;
    let last = first;
    for (let i = first; i < ch.length; i++) if (ch[i].kind === "fetch") last = i;
    const u = (i: number) => (tc - S[i]) / ch[i].len, ss = THREE.MathUtils.smoothstep;
    const o = ch.findIndex((c, i) => i < first && (c.kind === "doorOpen" || c.kind === "leafOpen"));
    // (Shut once everyone is well clear of it: on a pickup, as the driver puts the last load in
    // the truck; on a drop, as they get ready to close the truck up (its door, or whatever
    // closing up it has).)
    const pickup = this.st.stops[0]?.kind === "pickup";
    let k = -1;
    if (pickup) for (let i = last; i < ch.length; i++) { if (ch[i].kind === "stow") k = i; }
    else k = ch.findIndex((c, i) => i > last && (c.kind === "doorClose" || c.kind === "leafClose"));
    if (k < 0) k = ch.findIndex((c, i) => i > last && c.group === "close");
    const shut = k < 0 ? ss(tc - S[last] - ch[last].len, 0.3, 1.2) : pickup ? ss(u(k), 0.1, 0.9) : ss(u(k), 0, 0.6);
    return (o >= 0 ? ss(u(o), 0.2, 1) : ss(u(first), 0.05, 0.3)) * (1 - shut);
  }

  // The city's front doors (city.ts kerbDoors; set by the scene, absent in tests) and the one
  // the current kerb stop uses: on the truck's right, the nearest to its back.
  kerbDoor: KerbDoor | null = null;
  // How far the kerb's edge is out to the truck's right, parked at a kerb stop (m): its lane's
  // way in from the frontage, less the pavement's width.
  get kerbSide(): number | null {
    const a = this.st.at;
    if (!a || !this.plan) return null;
    const s = this.plan.graph.streets[a.d >> 1];
    return s.half - s.kerb - (a.lane ?? LANE_KERB);
  }
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
    const cands: [number, KerbDoor][] = [];   // anywhere along the block side: a longer walk beats no door
    for (const d of DOOR_PROBE(this.plan, stop.site.bx, stop.site.bz)) {
      if (!d) continue;
      const px = d.x - pose.x, pz = d.z - pose.z, ax = px * fx + pz * fz, az = px * rx + pz * rz;
      if (az < L.hw + 1.5 || d.nx * rx + d.nz * rz > -0.7) continue;   // on the truck's right, facing it
      const dd = Math.hypot(ax - L.bedRear, az);
      if (dd < 45 && this.doorTakes(stop.site, d, stop.cargo)) cands.push([dd, d]);
    }
    cands.sort((p, q) => p[0] - q[0]);
    // A load moved with a pallet jack: through the nearest door its moves can be planned to from
    // where the truck stands (one level with the cab is too far along the truck's side to reach
    // clear of it); else to a spot on the pavement behind the truck it can be planned to. Only a
    // load that may leave the jack (not jackStays) falls back to the nearest door, walked
    // unplanned. A load moved any other way goes through the nearest door.
    // (Worked out once for the stop and where it stands: asked as the truck nears it, too.)
    if (STYLE[CARGO_BY_ID.get(stop.cargo)!.handling].tool !== "palletJack") return cands[0]?.[1] ?? null;
    const key = this.pickKey(stop, pose);
    const got = this.doorPick.get(key);
    if (got) return got.door;
    const stays = jackStays(L, stop.cargo);
    let pick: { door: KerbDoor | null; chores: Chore[] | null; pave: number } = { door: null, chores: null, pave: 0 };
    const jackWalks = (ch: Chore[]) => ch.filter((c) => c.kind === "walk" && c.tool === "palletJack");
    const planned = (ch: Chore[]) => { const walks = jackWalks(ch); return walks.length > 0 && walks.every((c) => c.jack); };
    for (const [, d] of cands.slice(0, 2)) {
      const ch = this.kerbChores(stop, d, pose, true);
      if (planned(ch)) { pick = { door: d, chores: ch, pave: 0 }; break; }
    }
    // (No door: a spot on the pavement behind the truck it can be planned to, further back if need be.)
    for (let k = 0; !pick.chores && k < PAVE_SPOTS; k++) {
      const ch = this.kerbChores(stop, null, pose, true, k);
      if (planned(ch)) pick = { door: null, chores: ch, pave: k };
    }
    // (Nothing planned on a quick look: those doors again, then the pavement spots, planned in full
    // with the brushes past the bed's loads the last tries allow, before the nearest door walked
    // unplanned.)
    if (!pick.chores && !stays) for (const [, d] of cands.slice(0, 2)) {
      const ch = this.kerbChores(stop, d, pose, true, 0, true);
      if (planned(ch)) { pick = { door: d, chores: ch, pave: 0 }; break; }
    }
    for (let k = 0; !pick.chores && !stays && k < PAVE_SPOTS; k++) {
      const ch = this.kerbChores(stop, null, pose, true, k, true);
      if (planned(ch)) pick = { door: null, chores: ch, pave: k };
    }
    if (!pick.chores && !stays) pick.door = cands[0]?.[1] ?? null;
    this.doorPick.set(key, pick);
    return pick.door;
  }
  private pickKey(stop: Stop, pose: Pose) { return `${stop.job}|${stop.kind}|${stop.site ? siteKey(stop.site) : ""}|${pose.x.toFixed(1)},${pose.z.toFixed(1)},${pose.h.toFixed(2)}`; }   // (as looked ahead to, as stood at: the same)
  // The nearest door on the truck's side of the site at all, square to it and near its back (where
  // the building's front is: a line through it, so not one round a bend).
  private frontDoor(stop: Stop, pose: Pose): KerbDoor | null {
    if (!DOOR_PROBE || !stop.site) return null;
    const L = truckLayout(this.st.truck), h = pose.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
    let best: KerbDoor | null = null, bd = 45;
    for (const d of DOOR_PROBE(this.plan, stop.site.bx, stop.site.bz)) {
      if (!d) continue;
      const px = d.x - pose.x, pz = d.z - pose.z, ax = px * fx + pz * fz, az = px * rx + pz * rz;
      if (az < L.hw + 1.5 || d.nx * rx + d.nz * rz > -0.97) continue;
      const dd = Math.hypot(ax - L.bedRear, az);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }
  // (The chores planned through the door picked, kept for the stop itself.)
  private doorPick = new Map<string, { door: KerbDoor | null; chores: Chore[] | null; pave: number }>();
  // Whether a site can take a cargo through a door (or has a dock), whichever side it is reached from.
  private siteTakes(site: Site, cargo: string, model: TruckModel = this.st.truck): boolean {
    if (this.makeDockPlan({ kind: "pickup", site, job: 0, cargo, units: 1 }, model)) return true;   // (not through dockPlan: its cache is the stop's)
    return !DOOR_PROBE || DOOR_PROBE(this.plan, site.bx, site.bz).some((d) => !!d && this.doorTakes(site, d, cargo));
  }
  // What else is aboard at a stop (its own units excluded, before and after its ledger change).
  private othersAt(stop: Stop) {
    const key = stop.site ? siteKey(stop.site) : "";
    return this.st.aboard.filter((a) => (stop.kind === "pickup" ? a.job !== stop.job : !(a.job === stop.job && a.dest === key)));
  }
  // Where a stop's loads go (pickup: the first free run from the front, closing the gaps first if
  // there is none, while the doors are still shut: `others` compacted) or come from (drop).
  private slotFor(stop: Stop, others: Aboard[]): number {
    const st = this.st;
    if (stop.kind !== "pickup") return st.aboard.find((a) => a.job === stop.job && a.dest === (stop.site ? siteKey(stop.site) : ""))?.slot ?? 0;
    const spu = CARGO_BY_ID.get(stop.cargo)!.slots, cap = TRUCK_SLOTS[st.truck];
    // (A load left on the pallet jack a row back from the front wall: room in front of it to
    // stand at the handle, jackStays.)
    const from = jackStays(truckLayout(st.truck), stop.cargo) ? slotAlign(spu, 2) : 0;
    let k = slotFind(others, spu, stop.units, cap, from);
    if (k < 0) { slotCompact(others); k = slotFind(others, spu, stop.units, cap, from); }
    return k < 0 ? slotAlign(spu, Math.max(0, ...others.map((a) => slotEnd(a.slotsPerUnit, a.units, a.slot)))) : k;
  }
  // A stop's chores, the truck standing at `pose`, through door `kd` (or none). `trial`: only to
  // see whether they can be planned (nothing aboard changes: its slots worked out on a copy).
  private kerbChores(stop: Stop, kd: KerbDoor | null, pose: Pose, trial: boolean, pave = 0, full = false): Chore[] {
    const st = this.st, others = trial ? this.othersAt(stop).map((a) => ({ ...a })) : this.othersAt(stop);
    const slot = stop.slot ?? this.slotFor(stop, others);
    // The back of the loads before and after (where the hand truck or pallet jack rests), from
    // the others and this stop's own block, so a restore after the ledger change agrees.
    const L = truckLayout(st.truck), own = [{ slot, slotsPerUnit: CARGO_BY_ID.get(stop.cargo)!.slots, units: stop.units }];
    const before = bedRearX(L, st.truck, stop.kind === "pickup" ? others : [...others, ...own]);
    const after = bedRearX(L, st.truck, stop.kind === "pickup" ? [...others, ...own] : others);
    const dp = this.dockPlan(stop);
    let door: { x: number; z: number; yaw: number; half: number } | null = null;
    const h = pose.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
    // In the truck's frame: half a metre out from a door, facing it.
    const frame = (d: KerbDoor) => { const px = d.x + d.nx * 0.5 - pose.x, pz = d.z + d.nz * 0.5 - pose.z; return { x: px * fx + pz * fz, z: px * rx + pz * rz, yaw: Math.atan2(-(-d.nx * rx - d.nz * rz), -d.nx * fx - d.nz * fz), half: d.half }; };
    if (kd && !dp) door = frame(kd);
    // At a dock, the vehicles parked in the yard and the truck itself (walks round its nose
    // to steps on the far side), as boxes in its frame.
    const boxes: WalkBox[] = [];
    if (dp && PARKED_PROBE && stop.site) {
      for (const o of PARKED_PROBE(this.plan, stop.site.bx, stop.site.bz)) {
        const px = o.x - pose.x, pz = o.z - pose.z, x = px * fx + pz * fz, z = px * rx + pz * rz;
        if (Math.hypot(x, z) < 80) boxes.push({ x, z, hx: o.hx, hz: o.hz, ax: fx, az: rx });   // (world x in the truck's frame)
      }
      if (boxes.length) boxes.push({ x: (L.front + L.rear) / 2, z: 0, hx: (L.front - L.rear) / 2, hz: L.hw, ax: 1, az: 0 });
    }
    // (No door: the building's front from the nearest one there at all, whatever its use, all wall.)
    const fr = !kd && !dp ? this.frontDoor(stop, pose) : null;
    const plan = () => planChores(st.truck, stop, dp ? dp.stair : null, slot, before, after, door, boxes, kd && !dp ? this.stackKind(stop) : null, others, true, pave, fr ? frame(fr) : null, dp?.geom.door ? dp.geom.door.w / 2 : null);
    return trial && !full ? jackTrial(plan) : plan();
  }
  // Whether a door can take a cargo at all: not one with something big stood just before it, a
  // freeway's column, a conifer (nothing carried, wheeled or two-handed gets in or out past it;
  // not street furniture, a bench, which is low and to one side); nor one too narrow for a pallet
  // to go through flat (a hot tub through a house's front door).
  private doorTakes(site: Site, d: KerbDoor, cargo: string): boolean {
    const pave = PAVEMENT_PROBE?.(this.plan, site.bx, site.bz) ?? [];
    if (pave.some((o) => !o.kind && o.r >= DOOR_BLOCK_R && Math.hypot(o.x - (d.x + d.nx * DOOR_BLOCK_AT), o.z - (d.z + d.nz * DOOR_BLOCK_AT)) < o.r + DOOR_BLOCK_AT)) return false;
    const pallet = CARGO_BY_ID.get(cargo)?.handling === "palletJack" ? CARGO_MODELS[cargo]?.size[2] ?? 0 : 0;
    return 2 * d.half >= pallet + 0.1;
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
  // The kerb stop ahead, as the truck nears it, when its building has no front door to be found
  // (crew.ts stages its loads on the pavement): where the truck will stand.
  doorlessAhead(): { pose: Pose; y: number; pave?: number; fetches?: ({ spot: number[]; face: number } | null)[] | null } | null {
    const st = this.st, stop = st.stops[0];
    if (!stop || !stop.site || (stop.kind !== "pickup" && stop.kind !== "drop") || st.mode !== "drive" || !this.path || this.path.length - st.s > 150) return null;
    if (this.dockPlan(stop)) return null;
    const pose = this.path.peek(this.path.length, this.tmpPose);
    if (this.findKerbDoor(stop, pose)) return null;
    // (Where on the pavement, and facing which way: as the stop's chores will have it.)
    const pick = this.doorPick.get(this.pickKey(stop, pose));
    return { pose: { ...pose }, y: this.path.yAt(this.path.length), pave: pick?.pave ?? 0, fetches: pick?.chores ? fetchSpots(pick.chores) : null };
  }
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
    const ds = this.doorDwell;
    if (ds) this.chores = planChores(st.truck, ds, null, 0, null, null, null, [], null, [], false, 0, null, null, st.doors);
    else if (stop.kind === "swap") {
      // The walk: from the old cab door forward to the new one at a steady pace, with a moment to
      // get going and to slow to a stop at its door (director.ts swapWalkU). Its length from the two
      // trucks alone, the old one's nose SWAP_GAP short of the new one's tail (the swap's stopS): once
      // the driver has changed trucks partway through (doStop), the old one is the one parked, and a
      // keyframe restored after then plans the same dwell. (Measured from where each truck stood, the
      // walk came out nil there, and the dwell 15 s short.)
      const old = st.spare === null && st.parked ? st.parked.model : st.truck, spare = truckExtents(stop.truck!), cur = truckExtents(old, !!this.plan.style.victorian);
      const walk = cur.front + SWAP_GAP - spare.rear + spare.doorX - cur.doorX;
      this.chores = swapChores(Math.abs(walk) / WALK_SPEED + SWAP_RAMP);
    } else {
      // What else is aboard (this stop's own units excluded, before and after its ledger change).
      if (stop.slot === undefined) stop.slot = this.slotFor(stop, this.othersAt(stop));
      const dp = this.dockPlan(stop);
      this.kerbDoor = dp ? null : this.findKerbDoor(stop);
      this.stackMode = this.kerbDoor ? this.stackKind(stop) : null;
      const pick = this.doorPick.get(this.pickKey(stop, this.pose));
      this.doorPick.clear();   // (asked again only for stops still to come)
      this.chores = pick?.chores ?? this.kerbChores(stop, this.kerbDoor, this.pose, false, pick?.pave ?? 0);
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
    const x0 = this.pose.x, z0 = this.pose.z, h0 = this.pose.h, city = this.st.city, truck = this.st.truck;
    this.stepJourney(); this.hitchStep(x0, z0, h0, city, truck); this.life?.step(this); this.prefetch(); this.exitAhead();
  }
  // A tractor's trailer, as it swings behind on a turn (the same tractrix truck.ts draws: its
  // axles dragged along the line to the kingpin), stepped with the journey so that street life
  // and the tests know where it is: its yaw off the tractor's heading. Reversing into a bay, the
  // bay path's (blended in over the first 4 m back from however it was, as main.ts draws it); anew
  // (straight) on a jump, as into a new city.
  // (A swap's hand-over is a jump too: another rig, parked straight.)
  private hitchStep(x0: number, z0: number, h0: number, city: number, truck: TruckModel) {
    const st = this.st;
    if (st.truck !== "tractor") { st.hitchYaw = 0; st.hitchFrom = undefined; return; }
    if (st.mode === "reverse" && this.path) {
      if (st.hitchFrom === undefined) st.hitchFrom = st.hitchYaw ?? 0;
      const ty = this.reversePose(st.s, this.revB, true);
      st.hitchYaw = st.hitchFrom + (ty - st.hitchFrom) * THREE.MathUtils.smoothstep(this.path.length - st.s, 0, 4);
      return;
    }
    st.hitchFrom = undefined;
    if (st.city !== city || st.truck !== truck || Math.hypot(this.pose.x - x0, this.pose.z - z0) > 20) {
      st.hitchYaw = 0;
      if (st.truck !== truck) this.prevHitch = 0;   // (drawn straight from now, as the pose is: doStop's settlePrev)
      return;
    }
    const th0 = h0 + (st.hitchYaw ?? 0);
    const kx0 = x0 + Math.cos(h0) * FIFTH_WHEEL, kz0 = z0 - Math.sin(h0) * FIFTH_WHEEL;
    const ax = kx0 - Math.cos(th0) * KINGPIN_TO_AXLES, az = kz0 + Math.sin(th0) * KINGPIN_TO_AXLES;
    const kx = this.pose.x + Math.cos(this.pose.h) * FIFTH_WHEEL, kz = this.pose.z - Math.sin(this.pose.h) * FIFTH_WHEEL;
    const th = Math.atan2(-(kz - az), kx - ax);
    st.hitchYaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(th - this.pose.h), Math.cos(th - this.pose.h)), -1.4, 1.4);
    // Pulling up at a kerb (or behind a spare), the driver lines the rig up along it over the last
    // metres, as a driver does, so it stands straight: the crew's chores, which work round a
    // straight trailer, then stay out of it. (Scaled by how much of the run in is left this step
    // over last step, so what's left of the swing when the run in starts is gone at the stop.)
    if (st.mode === "drive" && st.stopS < THROUGH && st.backS >= st.stopS - 0.01) {
      const d1 = Math.max(0, st.stopS - st.s), d0 = d1 + Math.hypot(this.pose.x - x0, this.pose.z - z0);
      const f0 = THREE.MathUtils.smoothstep(d0, 0, STRAIGHTEN), f1 = THREE.MathUtils.smoothstep(d1, 0, STRAIGHTEN);
      st.hitchYaw = f0 > 1e-6 ? st.hitchYaw * Math.min(1, f1 / f0) : 0;
    }
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
    // The drive out over: the next city starts, exactly as its seed says, now.
    if (this.st.mode === "country" && this.st.cityTime + 1e-6 >= this.st.departAt + this.countryLength) {
      const old = this.st, fromTruck = this.exitRoad?.inp.fromTruck ?? old.truck;
      this.entryState(this.st.city + 1, old.simTime);
      if (old.exit && old.departAt >= 0) this.st.prev = { gate: old.exit.gate, dEst: old.exit.dEst, fromTruck, departAt: old.departAt, departV: old.departV, departS0: old.departS0, countryD: old.countryD };
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
        let state = signalState(N, sg.phase, this.clockTime, seed, st.preempt);
        // Ask for priority: most of the time the light changes for the truck.
        st.preempt = st.preempt.filter((p) => this.clockTime < p.p1 + 3);
        if (state === "red" && dist < 90 && st.preempt.length < PREEMPT_MAX && !st.preempt.some((p) => p.node === sg.node)
            && signalWait(N, sg.phase, this.clockTime, seed) > 4
            && hash3(N.kx, N.kz, signalCycleIndex(N, this.clockTime), seed, 0x9e1) < PREEMPT_CHANCE) {
          st.preempt.push({ node: sg.node, x: N.x, z: N.z, phase: sg.phase, p0: this.clockTime, p1: this.clockTime + PREEMPT_CLEAR + Math.max(6, dist / 5 + 6),
            was: signalState(N, (sg.phase + 1) % Math.max(2, N.phases), this.clockTime, seed, null), from: this.liveOther(N, sg.phase, seed) });
        }
        // Or hold a green that would change before the truck gets there.
        if (state === "green" && dist < 90 && st.preempt.length < PREEMPT_MAX && !st.preempt.some((p) => p.node === sg.node)) {
          const eta = dist / Math.max(st.v, 4);
          if (signalGreenLeft(N, sg.phase, this.clockTime, seed) < eta + 2
              && hash3(N.kx, N.kz, signalCycleIndex(N, this.clockTime), seed, 0x9e2) < PREEMPT_CHANCE)
            st.preempt.push({ node: sg.node, x: N.x, z: N.z, phase: sg.phase, p0: this.clockTime, p1: this.clockTime + eta + 5, was: "red", ext: true });
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
      // (Moving, held a moment too, HOLD_KEEP s: one seen and then not, as it passes close, from one
      // step to the next, doesn't have it brake and let go by turns, to come on and stop dead.)
      // (Only while it is still ahead: overrun, braking as hard as it could, it is behind it.)
      else if ((st.holdT ?? 0) > 0 && (st.v < 1 || (st.holdT! > 1 - HOLD_KEEP && st.holdS! > st.s))) { st.holdT! -= dt; ys = st.holdS!; }
      else st.holdT = 0;
      // (Held standing by it, its own light not red nor turning: the jam's clock runs. Not waiting
      // for a gap to pull out of a bay: that ends in its nosing out (life.ts outWait), not a honk.
      // Held by what waits on the truck in turn, though, a deadlock (a tractor whose trailer would
      // swing across a car standing in its way, someone crossing who waits on it as it waits on
      // them: life.ts heldByWaiter), the light ahead isn't what holds it: the clock runs on through
      // its red, or the clowns come whole cycles late where the greens are short.)
      const light = this.lightAhead !== "red" && this.lightAhead !== "yellow" || !!this.life?.heldByWaiter;
      this.jam(dt, ys !== null && st.v < 0.05 && ys <= st.s + 0.5 && light && !this.life?.gapHeld);
      // (Too close to stop there comfortably: it brakes as hard as it can all the same.)
      if (ys !== null) limit = Math.min(limit, Math.sqrt(2 * BRAKE * Math.max(0, ys - st.s)));
      // (The last metre in to it at a crawl, slowing as it closes: where it stands to is only known to
      // a step of street life's look (life.ts FINE_STEP), so it never comes up to it still rolling.)
      if (ys !== null) limit = Math.min(limit, HOLD_CREEP + 1.5 * Math.max(0, ys - st.s));
      // (Where it stops for them: there; or, closer than it can stop, braking as hard as it can (with
      // the moment its brakes take to come on), as soon as it can: never dead in one step. Every stop
      // street life gives it is short of what is in its way, by 1.5 m and a margin, room for that.)
      if (ys !== null) hardStop = Math.min(hardStop, Math.max(ys, st.s + (st.v * st.v) / (2 * MAX_DECEL) + st.v * (MAX_DECEL / BRAKE_JERK) / 2));
    }
    // The stop at the end of the path.
    if (st.mode === "drive" && st.stopS < THROUGH) {
      const dist = st.stopS - st.s;
      limit = Math.min(limit, Math.sqrt(2 * BRAKE * Math.max(0, dist)));
      hardStop = Math.min(hardStop, st.stopS);
    }
    // Pulled out of a bay with its swing doors open: a stop DOOR_PULL on, to close them (doorDwell).
    if (st.mode === "drive" && st.doorsAt !== undefined) {
      if (st.doorsAt < 0) st.doorsAt = st.s + DOOR_PULL;
      limit = Math.min(limit, Math.sqrt(2 * BRAKE * Math.max(0, st.doorsAt - st.s)));
      hardStop = Math.min(hardStop, st.doorsAt);
    }
    const v0 = st.v, a0 = st.acc ?? 0, l0 = st.lim ?? limit;
    // The acceleration it wants: following the limit as it moves (coming down toward a stop at about
    // BRAKE, say), and closing on it: from below, easing off as it closes in so that it arrives with
    // none left (JERK); from above, down to it in about LIM_TAU. At most ACCEL up, MAX_DECEL down.
    // Eased toward from what it had (JERK; braking harder, BRAKE_JERK).
    const lr = Math.min(ACCEL, Math.max(-MAX_DECEL, (limit - l0) / dt)), gap = limit - st.v;
    const want = gap >= 0 ? Math.min(ACCEL, lr + Math.sqrt(2 * JERK * gap)) : Math.max(-MAX_DECEL, lr + gap / LIM_TAU);
    const J = (want < a0 && want < 0 ? BRAKE_JERK : JERK) * dt;
    let a = a0 + Math.min(J, Math.max(-J, want - a0));
    st.v = Math.max(0, st.v + a * dt);
    if (st.v === 0) a = Math.max(0, a);
    st.acc = a; st.lim = limit;
    let ds = st.v * dt;
    if (st.s + ds > hardStop) { ds = Math.max(0, hardStop - st.s); st.v = 0; st.acc = 0; st.lim = undefined; }
    this.accel = dt > 0 ? (st.v - v0) / dt : 0;
    st.s += ds; this.lastStep = ds;
    st.redWait = st.v < 0.05 ? st.redWait + dt : 0;
    if (st.stopS >= THROUGH && st.s >= p.length) { this.leave(st.s - p.length); return; }   // through the gate
    p.eval(st.s, this.pose);
    if (st.mode === "drive" && st.doorsAt !== undefined && st.doorsAt >= 0 && st.s >= st.doorsAt - 0.02 && st.v < 0.05) { this.startDoors("close"); return; }
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
    st.v = 0; st.acc = 0; st.lim = undefined;
    if (st.backS < st.stopS - 0.01) { this.beginReverse(); return; }
    this.startDwell();
  }

  // The phase of signal N other than `phase` showing green or yellow now (unpreempted), or -1.
  private liveOther(N: CNode, phase: number, seed: number): number {
    for (let p = 0; p < Math.max(2, N.phases); p++) if (p !== phase && signalState(N, p, this.clockTime, seed, null) !== "red") return p;
    return -1;
  }

  // Pulled past the bay: switch to the bay path (whose far end is exactly here) and reverse
  // along it until the reference axle is docked at its start.
  private beginReverse() {
    const st = this.st, bay = this.bayPath(st.stops[0]);
    if (!bay) { this.startDwell(); return; }
    if (st.truck === "tractor" && !st.leaves) { this.startDoors("open"); return; }   // (its swing doors opened first, standing here)
    st.route = bay.path.route;
    this.path = bay.path;
    st.s = st.stopS = this.path.length; st.backS = bay.backS;
    st.mode = "reverse"; st.modeTime = 0;
    this.reversePose(st.s, this.pose);
  }

  // The gridlock clock (JAM_HONK): `held`, standing held by street life this step. Its time adds
  // up while held; once the truck has gone on since, it is cleared: JAM_CLEAR m once it has honked,
  // else JAM_CREEP m (stop-and-go
  // traffic, creeping on a car length at a time, is not a gridlock: it adds up only standing).
  private jam(dt: number, held: boolean) {
    const st = this.st;
    st.jamHeld = held;
    if (held) { st.jamT = (st.jamT ?? 0) + dt; st.jamGo = 0; return; }
    if (!st.jamT) return;
    st.jamGo = (st.jamGo ?? 0) + Math.abs(st.v) * dt;
    if (st.jamT > JAM_SHOT) st.jamMoved = (st.jamMoved ?? 0) + Math.abs(st.v) * dt;
    if (st.jamGo > (st.jamT > JAM_HONK ? JAM_CLEAR : JAM_CREEP)) { st.jamT = 0; st.jamGo = 0; st.jamMoved = 0; }
  }
  // How far into a blast of its horn it is now, in seconds, or -1 while it is silent (drawn:
  // truck.ts honk): held long enough, two short blasts every HONK_EVERY s (the first before
  // traffic moves).
  get honking() {
    if ((this.st.jamT ?? 0) <= JAM_HONK || !this.st.jamHeld || (this.st.mode !== "drive" && this.st.mode !== "reverse")) return -1;
    const u = (this.st.jamT! - JAM_HONK) % HONK_EVERY;
    return u < 0.4 ? u : u > 0.6 && u < 1.2 ? u - 0.6 : -1;
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

  // A tractor-trailer's swing doors: opened by the driver standing in front of a dock's bay before
  // it backs in, closed once it has pulled DOOR_PULL out of it afterwards. A dwell of its own, the
  // driver out of the cab, a leaf at a time (chores.ts planChores `doors`), and back in; the ledger
  // untouched. The stop it is for: the dock stop ahead, or (closing) the one just made.
  get doorDwell(): Stop | null { const st = this.st; return st.mode === "dwell" && st.doors ? (st.doors === "open" ? st.stops[0] : st.doorsFor ?? null) : null; }
  private startDoors(kind: "open" | "close") {
    const st = this.st;
    st.mode = "dwell"; st.modeTime = 0; st.dwellDone = true; st.doors = kind; st.v = 0; st.acc = 0; st.lim = undefined;
    this.planDwell();
  }

  private dwell() {
    const st = this.st, stop = st.stops[0];
    if (st.doors) {
      if (st.modeTime < st.dwellTotal) return;
      const open = st.doors === "open";
      st.doors = undefined; this.chores = [];
      if (open) { st.leaves = true; this.beginReverse(); return; }
      st.leaves = false; st.doorsAt = undefined; st.doorsFor = undefined;
      st.mode = "drive"; st.modeTime = 0;
      return;
    }
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
        st.lastDock = dock.geom;
        if (st.leaves) { st.doorsAt = -1; st.doorsFor = stop; }   // (its swing doors closed once it has pulled out: doorDwell)
      } else if (this.path?.route.garageIn) {
        // Down off the roof next: the route starts there and comes out across the street, in the
        // kerb lane back towards the node the truck came in past.
        const L = siteLayout(this.plan, stop.site!.bx, stop.site!.bz) as GarageLayout, f = this.plan.face(stop.site!.bx, stop.site!.bz, L.side);
        st.at = { d: f ^ 1, before: GARAGE_OUT_BEFORE + this.plan.siteDelta(stop.site!.bx, stop.site!.bz) };
        st.garageExit = { x: this.pose.x, z: this.pose.z, h: this.pose.h };
      } else this.arriveAtEnd();
      this.path = null; st.route = null; st.s = 0; st.v = 0;
      st.mode = "drive"; st.modeTime = 0; st.acc = 0; st.lim = undefined; this.chores = [];
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
      ({ front: this.frontX, center: this.centerX } = truckExtents(st.truck, !!this.plan.style.victorian));
      st.s = this.path!.length; this.path!.eval(st.s, this.pose);
      // (Drawn there from now: not blended over a step from where the old truck stands, which
      // would slide the new one out of it.)
      this.settlePrev();
      return;
    }
    const c = CARGO_BY_ID.get(stop.cargo)!;
    if (stop.kind === "pickup") {
      // Tag each unit with its drop; the job's drops are the queued stops with the same job id.
      const drops = st.stops.filter((s) => s.kind === "drop" && s.job === stop.job);
      // In the order they were stowed, from the stop's slot back: the last drop's deepest, so each
      // drop's are the rearmost when it comes.
      let slot = stop.slot ?? 0;
      const put = (units: number, dest: string) => { if (c.slots >= 1 && slot !== stop.slot) slot = slotAlign(c.slots, slot); st.aboard.push({ job: stop.job, cargo: c.id, units, slotsPerUnit: c.slots, dest, slot }); slot = slotEnd(c.slots, units, slot); };
      if (drops.length) for (const d of [...drops].reverse()) put(d.units, siteKey(d.site!));
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
  // finished first, and a stop it is on its way to is still made). Normally the final pickup
  // finishes well before this. Running late is no matter: the next city waits for the truck. Only
  // as a last resort, still in town at twice the city's time (something wrong), is it put on the
  // road at a gate (a jump; never seen in tests).
  private deadline() {
    const st = this.st;
    if (st.mode === "country" || st.mode === "inbound") return;
    const [bx, bz] = this.truckBlock();
    if (st.cityTime >= 2 * this.period) { this.log("out of time: forced onto the road"); this.forceLeave(); return; }
    if (st.mode !== "drive" || st.stops.some((x) => x.kind === "depart")) return;
    // (Long before the end, no drive out could be long enough: not worth timing it every step.)
    const drive = this.driveOf(st.city);
    if (st.cityTime < this.period - drive - GATE_MAX - 150 || st.cityTime < this.period - drive - this.gateTime(this.fromTruck()) - (this.path ? 150 : 40)) return;
    // A stop it is already driving to is still made (the truck can't turn off mid-street).
    const keep = this.path && st.stops[0] ? [st.stops[0]] : [];
    const n = this.aboardUnits - keep.reduce((a, k) => a + (k.kind === "drop" ? k.units : 0), 0);
    if (n > 0) { st.unloaded += n; st.aboard = st.aboard.filter((a) => keep.some((k) => k.kind === "drop" && a.job === k.job && a.dest === siteKey(k.site!))); }
    this.log(`out of time; ${Math.max(0, n)} units handed off, leaving`);
    // The truck the next city starts with, if there is time to change to it on the way.
    const want = this.freightFor(st.city + 1)?.truck, swap: Stop[] = [];
    if (want && want !== st.truck && !keep.some((k) => k.kind === "swap")) {
      const lot = this.findNear(RENTAL_LOTS, bx, bz, LOT_SEARCH, new Set(), 1, this.lotTruck(want))[0];
      if (lot && st.cityTime + this.estimate([...keep, { kind: "swap", site: lot, job: 0, cargo: "", units: 0 }], this.fromTruck()) + this.gateTime(this.fromBlock(lot.bx, lot.bz)) + this.driveOf(st.city) < this.period)
        swap.push({ kind: "swap", site: lot, job: ++st.jobCounter, cargo: "", units: 0, truck: want });
    }
    st.stops = [...keep, ...swap, { kind: "depart", site: null, job: -1, cargo: "", units: 0 }]; st.intercity = true;
  }

  // Rough seconds to drive out of town from nodes `from`, by the gate the way on leaves by.
  private gateTime(from: readonly number[]) {
    const gt = this.plan.graph.gates[this.leaveOf(this.st.city).out];
    return gt ? (this.driveTo(from, [gt.node]) + GATE_SLACK) / GATE_SPEED + 20 : Infinity;
  }

  // The way out: a route from where the truck is now to the end of the gate street its way on
  // leaves by (visits.ts), and the drive's own seconds to the next city's hand-over.
  private planExit(): { route: Route; gate: number; dEst: number } | null {
    const st = this.st, at = this.pathEnd(), G = this.plan.graph, i = this.leaveOf(st.city).out, gt = G.gates[i];
    if (!gt) return null;
    const gst = G.streets[gt.street];
    const route = planRoute(G, at.d, at.before, [{ d: gst.id * 2 + (gt.out === 1 ? 0 : 1), after: gst.len - GATE_TRIM }], 6000, this.drivable, this.movesFor(st.truck));
    if (!route) return null;
    if (at.lane !== undefined) route.lane = at.lane;
    route.wide = st.truck === "tractor" || undefined;
    route.nose = truckNose(st.truck); route.tail = truckTail(st.truck);
    return { route, gate: i, dEst: this.driveOf(st.city) };
  }
  // Where the next route starts from: the current edge.
  private pathEnd() { return this.st.at; }
  // The streets the truck may drive through (city streets: gate streets only as a goal).
  private readonly drivable = (d: number) => this.plan.graph.streets[d >> 1].inCity;
  // A swap's Ryder lot is driven to in one truck and away from in the other. Where either is a
  // tractor-trailer, the lot has to be one the tractor reaches (deliverable).
  private lotTruck(want: TruckModel): TruckModel { return want === "tractor" || this.st.truck === "tractor" ? "tractor" : this.st.truck; }
  // The moves through a junction a truck may make: any, but for a tractor-trailer (citygraph.ts noTractor).
  private movesFor(m: TruckModel) { return m === "tractor" ? this.tractorMoves : null; }
  private readonly tractorMoves = (d: number, e: number) => this.plan.graph.tractorMove(d, e);

  // Through the end of the gate street (or put there, as a last resort): onto the road, `s0`
  // metres along it already.
  private leave(s0: number) {
    const st = this.st;
    st.mode = "country"; st.modeTime = 0; st.departAt = st.cityTime; st.departTruck = st.truck;
    st.departV = st.v; st.departS0 = s0;
    // (As long as the road was laid for, or as long as it takes: country.ts fitDuration.)
    const road = this.exitEntry(false)?.road;
    if (road) road.finish();
    st.countryD = road ? road.fitDuration(Math.max(COUNTRY_MIN, road.plannedSeconds), st.v, s0) : undefined;
    st.spare = null; st.parked = null; st.dockExit = null; st.lastDock = null; st.garageExit = null; st.intercity = true;
    st.stops = st.stops.filter((s) => s.kind !== "depart");
    this.path = null; st.route = null;
    this.log(`leaving for the country: ${this.countryLength.toFixed(0)} s to the next city's road`);
    this.countryPose();
  }
  private forceLeave() {
    const st = this.st;
    if (!st.exit) {
      st.exit = { gate: this.leaveOf(st.city).out, dEst: this.driveOf(st.city) };
    }
    st.v = 8;
    this.leave(0);
  }

  // ---- the country drive --------------------------------------------------------------------
  // The road out of town (built once the way out is planned: after a seek or a restore too), with
  // the motion it actually has once the truck is on it.
  private exitCache: { key: string; road: CountryRoad; motion: string } | null = null;
  get exitRoad(): CountryRoad | null {
    const c = this.exitEntry(false), st = this.st;
    if (!c) return null;
    c.road.finish();   // (whatever is left of it, built ahead: exitAhead)
    if (st.departAt >= 0) {
      const m = `${st.departAt.toFixed(1)}/${st.departV}/${st.departS0}`;
      if (c.motion !== m) { c.road.setMotion(this.countryLength, st.departV, st.departS0); c.motion = m; }
    }
    return c.road;
  }
  private exitEntry(ahead: boolean) {
    const st = this.st;
    if (!st.exit) return null;
    const key = `${this.cfg.seed}/${st.city}/${st.exit.gate}/${st.exit.dEst}`;
    if (!this.exitCache || this.exitCache.key !== key) this.exitCache = { key, road: this.makeExitRoad(st.city, st.exit.gate, st.exit.dEst, st.truck, ahead), motion: "" };
    return this.exitCache;
  }
  // The road out for what is drawn ahead of the drive: EXIT_AHEAD steps after the way out is
  // planned (or once the truck is on it). In the steps between, the journey builds it a few pieces
  // a step (exitAhead), so neither planning the way nor building its road takes one frame long.
  // (From the journey's state, so a scrub finds it the same.)
  get exitRoadAhead(): CountryRoad | null {
    const st = this.st;
    return st.exit && (st.departAt >= 0 || st.step > (st.exitStep ?? -1) + EXIT_AHEAD) ? this.exitRoad : null;
  }
  private exitAhead() {
    const st = this.st;
    if (!st.exit || st.departAt >= 0 || st.step <= (st.exitStep ?? Infinity) || st.step > st.exitStep! + EXIT_AHEAD) return;
    this.exitEntry(true)!.road.prepare(EXIT_PIECES);
  }
  // The last city's road out, while it is still at hand (continuous playback: main.ts keeps drawing
  // it behind the truck after the hand-over).
  // City N's road out by gate `gate` (a pure function of the seed and these: the gate is its graph's,
  // so the city's plan is built for it, the last city's too after a seek): its world road's map,
  // driven this way (from b to a when the road's b is this city), on to the next city's gate, up
  // beside the freeway when that gate is the freeway's way in (g0).
  makeExitRoad(N: number, gate: number, dEst: number, fromTruck: TruckModel, ahead = false): CountryRoad {
    const gt = this.planOf(N).graph.gates[gate]!, e = gateEnd(gt), N1 = N + 1;
    return new CountryRoad({ ...this.roadInputs(N, N1, this.leaveOf(N)), seed: this.cfg.seed, city: N, kind: "exit", driveSeed: visitOf(this.cfg.seed, N).drive, frame: e, dEst, fromTruck, toTruck: this.startTruck(N1) }, ahead);
  }
  // A drive's road and its cities, from city N to city N1 along `way`.
  private roadInputs(N: number, N1: number, way: RoadWay) {
    const fromKey = citySeedOf(this.cfg.seed, N), toKey = citySeedOf(this.cfg.seed, N1), toStyle = this.styleOf(N1), fromStyle = this.styleOf(N);
    const toFreeway = way.in === 0 && !!freewayGate(toKey), toFreewayMerge = toFreeway && this.takesFreeway(N1);
    // (The freeways' curves as the cities were laid out: their graphs built first.)
    const P = freewayGate(fromKey) ? this.planOf(N) : null, fromCurve = P ? (void P.graph, P.fwCurve) : null;
    const Q = freewayGate(toKey) && !toFreeway ? this.planOf(N1) : null;
    return {
      map: roadMapOf(way.road), back: way.back, toFreeway, toFreewayMerge, fromCurve, fromKey, toKey,
      toGateEnd: Q ? gateEnd(Q.graph.gates[way.in]!) : null, toCurve: Q ? Q.fwCurve : null,
      fromStyle, toStyle, fromClimate: this.climateOf(N), toClimate: this.climateOf(N1),
      fromName: cityName(fromKey, fromStyle), toName: cityName(toKey, toStyle),
    };
  }
  // The last city's road out, while it is still at hand: main.ts keeps drawing it behind the truck
  // after the hand-over. From the journey state, so a seek within this city finds it too.
  private prevCache: { key: string; road: CountryRoad } | null = null;
  get previousExit(): CountryRoad | null {
    const c = this.exitCache, st = this.st, p = st.prev;
    if (!p) return null;
    // (The road this journey drove, if it is that one: built, and with the motion it was driven
    // with. After a seek it may be one built ahead and never driven.)
    if (c && c.road.built && c.key === `${this.cfg.seed}/${st.city - 1}/${p.gate}/${p.dEst}` && c.motion === `${p.departAt.toFixed(1)}/${p.departV}/${p.departS0}`) return c.road;
    const key = `${this.cfg.seed}/${st.city - 1}/${p.gate}/${p.dEst}/${p.fromTruck}/${p.departAt}/${p.departV}/${p.departS0}`;
    if (!this.prevCache || this.prevCache.key !== key) {
      const road = this.makeExitRoad(st.city - 1, p.gate, p.dEst, p.fromTruck);
      road.setMotion(p.countryD ?? Math.max(COUNTRY_MIN, p.dEst), p.departV, p.departS0);
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
    const seed = citySeedOf(this.cfg.seed, N), dressing = visitOf(this.cfg.seed, N).dressing, have = this.plans.get(N);
    if (have && have.seed === seed && have.dressing === dressing) { this.plans.delete(N); this.plans.set(N, have); return have; }
    const plan = new CityPlan(seed, this.styleOf(N), dressing);
    this.plans.set(N, plan);
    if (this.plans.size > 3) this.plans.delete(this.plans.keys().next().value!);
    return plan;
  }
  // The next city's plan, its street graph built ahead a few pieces at a time while the truck is
  // still in this one (CityPlan.prepare; main.ts calls this every frame), so neither the way out
  // (its road asks whether that city is on the sea) nor the hand-over builds it all in one step.
  // The plan once its graph is built (with the climate entryState will give it), else null. (The
  // graph is a pure function of the seed, so when it is built changes nothing else.)
  prepareNext(pieces: number): CityPlan | null {
    if (this.st.cityTime < 20) return null;   // (not on the hand-over's heels: that has work of its own)
    const N = this.st.city + 1, P = this.planOf(N);
    if (!P.prepare(pieces)) return null;
    P.climate = this.climateOf(N);
    return P;
  }
  // Whether city N is on the sea: only built out to see when it could be (seaSide).
  private onSea(N: number) { return seaSide(citySeedOf(this.cfg.seed, N)) !== null && this.planOf(N).outline.sea !== null; }
  // The arrival straight into this city (pure: from the seed alone).
  private arrivalCache: CountryRoad | null = null;
  get arrivalRoad(): CountryRoad {
    const st = this.st;
    if (!this.arrivalCache || this.arrivalCache.inp.city !== st.city || this.arrivalCache.inp.seed !== this.cfg.seed) {
      const e = gateEnd(this.plan.graph.gates[this.entry]!), N0 = Math.max(0, st.city - 1);
      // (Its last stretch: the drive before it is the last city's. Placed by its end, at this gate.)
      this.arrivalCache = new CountryRoad({
        ...this.roadInputs(N0, st.city, this.arriveOf(st.city)), seed: this.cfg.seed, city: st.city, kind: "arrival", driveSeed: this.visit.drive,
        endFrame: { x: e.x, z: e.z, h: e.h + Math.PI }, dEst: 0, fromTruck: st.truck, toTruck: st.truck,
        toStyle: this.plan.style, toClimate: this.climate, toName: this.plan.name,
      });
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
      st.mode = "drive"; st.modeTime = 0; st.acc = 0; st.lim = undefined; st.v = this.arrivalRoad.inp.toFreewayMerge ? FW_OFF_V : V_GATE;
      this.path = null; st.route = null;
    }
  }
  // The drive out: as long as its road was laid for (dEst, from when the way out was planned).
  get countryLength() { return this.st.departAt < 0 ? 0 : this.st.countryD ?? Math.max(COUNTRY_MIN, this.st.exit?.dEst ?? COUNTRY_MIN); }

  snapshot(): JourneyState { return this.st; }
  get keyframeCount() { return this.frames.get(this.st.city)?.k.size ?? 0; }
}

const dist = (a: Site, b: Site) => Math.abs(a.bx - b.bx) + Math.abs(a.bz - b.bz);
