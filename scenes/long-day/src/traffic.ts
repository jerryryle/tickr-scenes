// Ambient traffic: cars, taxis, SUVs, pickups, vans, buses, a police car, an ice cream truck,
// other Ryder trucks and, in a coastal city, cable cars. Vehicles drive the same street paths
// as the truck (route.ts) one intersection at a time, stop for signals, queue behind whatever is
// in their lane, and pull into the inner lane to pass a stopped vehicle or to get out of the
// truck's way. The journey ignores traffic (so it stays deterministic and resumable); traffic
// yields to it instead. Each vehicle type is one InstancedMesh, tinted per vehicle with
// instanceColor; a Ryder truck is a baked copy of the real model.
import * as THREE from "three@0.187.0";
import { Rng } from "./rng.ts";
import { storyRigs } from "./storyvehicles.ts";
import type { StoryRig } from "./storyvehicles.ts";
import { SB } from "./storybook.ts";
import { Batch, keepWarm } from "./geom.ts";
import { CAR_SPECS, carModel, GLASS, headLamp, iceCreamTruck, tailLamp, TYRE } from "./cars.ts";
import type { CarKind } from "./cars.ts";
import { SPECS, TRAILER } from "./truck.ts";
import { KINGPIN_TO_AXLES } from "./hitch.ts";
import type { TruckModel } from "./truck.ts";
import { signalsInStep, signalState } from "./signals.ts";
import type { SignalPreempt } from "./signals.ts";
import { CityPlan, pick } from "./city.ts";
import { outOfSight } from "./citygraph.ts";
import type { CityGraph } from "./citygraph.ts";
import { BLOCK } from "./grid.ts";
import { LANE_INNER, LANE_KERB, Path, STOP_BACK } from "./route.ts";
import type { Move, Pose, Route } from "./route.ts";
import { FIRM_BRAKE, SIM_DT } from "./journey.ts";

// A vehicle the clowns have lifted out of the town (clowns.ts), as traffic draws it, and where it is.
export interface LiftedCar { kind: string; color: number; model: TruckModel | null; len: number; width: number; id: number }
export interface LiftDraw { car: LiftedCar; x: number; y: number; z: number; h: number; roll: number }
export interface Obstacle { x: number; z: number; r: number; still?: boolean; owner?: number; sweep?: boolean; vx?: number; vz?: number; body?: boolean }   // still: a truck parked in the lane (traffic passes it); owner: the vehicle's id; sweep: where the truck reversing into a bay will be; vx, vz: how it is moving (m/s: someone walking); body: the truck's own body (life.ts), parked or not

// The storybook city's traffic: its own contraptions (storyvehicles.ts) and nothing else but the
// Ryder trucks, gone cartoonish there as the player's is (fleet.ts, `toon`).
const STORY_TRAFFIC: Record<string, number> = { hamster: 1.4, strider: 1.4, caterpillar: 0.8, pogo: 1.2, unicycle: 1.0, balloon: 0.8, teacup: 1.2, snail: 0.7, ryder: 0.8 };
interface VehicleKind {
  id: string; len: number; width: number; vmax: number; weight: number;
  colors: number[] | null;             // body tints; null keeps the painted colours
  mesh: THREE.InstancedMesh | null;    // null for Ryder trucks (separate groups) and the storybook's rigs
  cap: number;
  // A storybook contraption (storyvehicles.ts): its parts, each an instanced mesh posed per
  // vehicle (the white of its first part apart, tinted with the vehicle's colour).
  rig?: StoryRig; rigMeshes?: { mesh: THREE.InstancedMesh; part: number; tint: boolean }[];
}
interface Car {
  kind: VehicleKind; path: Path; s: number; v: number;
  next: Path | null;                   // the plan after this one, from its end (its move picked already): braked for ahead of time
  dodge: number; dodgeTarget: number; dodgeV: number; holdT: number;   // lateral shift into the inner lane (negative = left), and its rate
  stillT: number; committed: number; color: number; beyondT?: number;   // beyondT: s held at its line, on its green, by a light just past the junction   // committed: the signal (index on the path) it is going through
  stopFor: number;                     // the signal (index on the path) it is stopping for, -1: none
  blockedBy: number; slowT: number; pedT: number; acc: number;   // acc: current acceleration (eased)
  passId?: number; passT?: number;      // a car it was let through past out of a deadlock, and for how much longer
  clownHold?: boolean;                 // held where it stands for the clowns coming to carry it off (clowns.ts)
  held?: boolean;                      // holding at a junction's line last step (for a car with priority, or the way out blocked)
  truckHold?: boolean;                 // holding last step for the truck to go by (giveWay, landingWay)
  stopOk?: number;                     // the all-way stop it has stopped at and may now go on from
  // Its booking through the junction ahead (junction): the node and the approach, its place in the
  // order, its footprint (x, z every metre from 1 m short of the line), its conflict zones with
  // earlier bookings (each: that car's id and booking, where this car's middle is as its front
  // comes to the zone and as its back leaves, the same for the other) and where it is clear of it.
  bk?: { node: number; from: number; seq: number; pts: number[]; at?: number[]; zones: number[]; end: number; wide?: boolean; dodge?: number; turn?: boolean; also?: number[] } | null;   // wide: turning from the next lane over; dodge: how far over it booked from (below -1, the next lane over: a cable car on its tracks, a car passing); turn: it turns; also: the nodes on past it booked with it (the truck's, where their lines are inside this one: truckBook)
  gapT?: number;                       // the gap (s) it wants in the bookings ahead before it goes, giving way
  waitFor?: number;                    // the car whose booking it is waiting short of a zone for (-1: none)
  passStill?: boolean;                 // passing something parked in its lane (last step)
  // Its driver (spawn): the time gap kept to the car ahead (s), the gap left standing behind it
  // (m), how hard it pulls away and how hard it likes to brake (m/s^2), and its pace (of the
  // vehicle's top speed). Missing (older saves): the middle of each.
  dT?: number; dS0?: number; dA?: number; dB?: number; dV?: number;
  lastO?: number; mergeUp?: boolean;   // the path's lane offset last step, and which way it last moved   // pedT: how long a pedestrian has held it up   // the vehicle it is held up close behind (-1: none, or not a vehicle), and how long it has crawled (< 0.5 m/s)
  x: number; z: number; h: number; px: number; pz: number; ph: number;   // pose now and one step ago
  odo?: number; podo?: number;         // how far it has come (m), now and one step ago (a rig's stride: storyvehicles.ts)
  cable: boolean; id: number; model: TruckModel | null;   // model: a Ryder truck's
}

const TRAFFIC_SPAWN = [70, 150], TRAFFIC_DESPAWN = 175;
const STUCK_GONE = 55;   // s a vehicle may stand before it is gone (longer than a red light lasts: signals.ts, five phases at most)
const CABLE_LAYOVER = 8;   // s: how long a cable car stands at the end of its line before it turns round (turnRound)
const TRUCK_CUT_ROOM = 4;   // m: the least room a car leaves before the truck's nose, moving over in front of it (and a second and a half at its speed)
const TRUCK_ROOM = 0.1;   // m: the least a car's circles leave the truck's, moving (truckGap)
const DROP_DEEP = 0.6;   // m: how deep inside a parked truck's circles a car is dropped (dropInside)
const SLIDE_LOOK = 6;     // m on along its way a car beside the truck may slide by it to come clear (slidesBy)
const CAR_STOP_PAUSE = 1.0;     // s a car stands at a stop sign's line before going on
const GIVE_WAY_GAP = 3.4;   // m between centre lines: closer than this, a car and the truck would touch (the truck's rear cuts its turns)
const LIFT_CAP = 3;   // instances kept over each kind's cap for those the clowns carry (lifted)
const CAR_COLORS = [0xb22222, 0x1f4fa0, 0xe8e8e8, 0x222428, 0x7a7f86, 0xd4a017, 0x2e7d4f, 0x8a3fa0, 0xe8e0d0, 0x5a2a1a, 0x3a8ac8];

export class Traffic {
  private kinds: VehicleKind[] = [];
  private cars: Car[] = [];
  private beacons: THREE.InstancedMesh;     // the police car's light bar
  private pose: Pose = { x: 0, z: 0, h: 0, k: 0 };
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private v3 = new THREE.Vector3(); private one = new THREE.Vector3(1, 1, 1); private col = new THREE.Color();
  private rng = new Rng(0x7a4f);
  private rnd = this.rng.next;
  private nextId = 0;
  private byId = new Map<number, Car>(); private ignore: number[] = [];   // (step's, reused)
  private groups = new Map<number, THREE.Object3D>();   // Ryder trucks' models, by car id
  private spare = new Map<string, THREE.Object3D[]>();   // models of Ryder trucks that left, for reuse (each is new GPU geometry)
  time = 0;   // render time (the police lights)
  ryderToon = 0;   // how cartoonish Ryder trucks in traffic are drawn (1 in the storybook city: truck.ts makeToon)
  private drawn: number[] = [];   // per vehicle as last drawn: x, z, heading, half length
  readonly obstacles: Obstacle[] = [];      // this frame's vehicles, for pedestrians

  constructor(private scene: THREE.Scene, material: THREE.Material, private ryder: ((model: TruckModel, toon: number) => THREE.Object3D | null) | null) {
    const kind = (id: string, len: number, width: number, vmax: number, weight: number, colors: number[] | null, cap: number, build: ((b: Batch) => void) | null) => {
      let mesh: THREE.InstancedMesh | null = null;
      if (build) {
        const b = new Batch(); build(b);
        mesh = new THREE.InstancedMesh(b.build(material)!.geometry, material, cap + LIFT_CAP);
        mesh.count = 0; mesh.frustumCulled = false;
        for (let i = 0; i < cap + LIFT_CAP; i++) mesh.setColorAt(i, this.col.set(0xffffff));
        scene.add(mesh);
      }
      this.kinds.push({ id, len, width, vmax, weight, colors, mesh, cap });
    };
    const car = (k: CarKind) => [CAR_SPECS[k].len, CAR_SPECS[k].width] as const;
    kind("sedan", ...car("sedan"), 11, 4, CAR_COLORS, 16, (b) => carModel(b, "sedan"));
    kind("hatch", ...car("hatch"), 11, 3, CAR_COLORS, 10, (b) => carModel(b, "hatch"));
    kind("wagon", ...car("wagon"), 11, 1.5, CAR_COLORS, 6, (b) => carModel(b, "wagon"));
    kind("suv", ...car("suv"), 11, 3, CAR_COLORS, 10, (b) => carModel(b, "suv"));
    kind("pickup", ...car("pickup"), 10, 2, [0xb22222, 0x222428, 0xe8e8e8, 0x1f4fa0, 0x7a7f86], 6, (b) => carModel(b, "pickup"));
    kind("taxi", ...car("sedan"), 11, 2, null, 6, (b) => { carModel(b, "sedan", 0xf2c200); b.box(-0.35, 1.53, 0, 0.6, 0.2, 0.28, 0xffffff); b.box(-0.35, 1.53, 0, 0.62, 0.08, 0.3, 0x222222); });
    kind("van", ...car("van"), 10, 2, [0xe8e8e8, 0xe8e8e8, 0x8a8f94, 0x1f4fa0], 6, (b) => carModel(b, "van"));
    kind("bus", 11.5, 2.5, 9, 0.8, null, 3, busBody);
    kind("police", ...car("sedan"), 11, 0.5, null, 2, (b) => { carModel(b, "sedan", 0xf4f4f0); for (const z of [-1, 1]) b.box(-0.05, 0.68, z * 0.906, 1.9, 0.3, 0.01, 0x15181c); b.box(-0.35, 1.49, 0, 0.3, 0.1, 1.2, 0x222222); });
    kind("icecream", 5.8, 2.1, 8, 0.5, null, 2, (b) => iceCreamTruck(b));
    kind("ryder", 11.3, 2.5, 10, 0.8, null, 2, null);
    kind("cablecar", 8.6, 2.5, 6, 0, null, 3, cableCarBody);
    // The storybook city's own (STORY_TRAFFIC): each contraption, its parts' meshes made the first
    // time one is wanted (rigMeshesOf: the start has a budget, and most journeys meet these late).
    const rigCols = [SB.pink, SB.aqua, SB.mustard, SB.violet, SB.mint, SB.orange, SB.coral, SB.lime, SB.teal, SB.magenta];
    for (const rig of storyRigs()) {
      const cap = rig.id === "caterpillar" || rig.id === "balloon" ? 4 : 8;
      this.kinds.push({ id: rig.id, len: rig.len, width: rig.width, vmax: rig.vmax, weight: 0, colors: rigCols, mesh: null, cap, rig });
    }
    this.material = material;
    const bb = new Batch(); bb.box(0, 0, 0, 0.28, 0.14, 0.5, 0xffffff);
    const bm = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.beacons = new THREE.InstancedMesh(bb.build(bm)!.geometry, bm, 4);
    this.beacons.count = 0; this.beacons.frustumCulled = false;
    for (let i = 0; i < 4; i++) this.beacons.setColorAt(i, this.col.set(0xffffff));
    scene.add(this.beacons);
    keepWarm(scene, this.beacons.geometry, bm, true);
  }

  private release(g: THREE.Object3D) {
    g.removeFromParent();
    const m = `${g.userData.model}/${g.userData.toon ?? 0}`;
    let list = this.spare.get(m);
    if (!list) this.spare.set(m, (list = []));
    list.push(g);
  }

  // Remove every vehicle (a new city, or the country).
  clear() {
    this.cars.length = 0; this.truckBk = null; this.truckCar = null; this.truckStillT = 0; this.truckYieldsAt = -1;
    this.obstacles.length = 0;
  }
  // A new city: no vehicles, and the random stream from the city's seed.
  reset(seed: number) { this.clear(); this.rng.s = seed >>> 0; this.nextId = 0; this.bookSeq = 0; }

  save() {
    return { rng: this.rng.s, id: this.nextId, seq: this.bookSeq, truckBk: this.truckBk, truckStill: this.truckStillT, truckYields: this.truckYieldsAt, cars: this.cars.map((c) => ({ ...c, kind: c.kind.id, path: c.path.route, next: c.next?.route ?? null })) };
  }
  load(o: ReturnType<Traffic["save"]>, plan: CityPlan) {
    this.rng.s = o.rng; this.nextId = o.id; this.bookSeq = o.seq ?? 0; this.truckBk = o.truckBk ?? null; this.truckStillT = o.truckStill ?? 0; this.truckYieldsAt = o.truckYields ?? -1; this.truckCar = null;
    // (`next` absent in older saves, from before cars planned ahead: planned now. A saved null is a
    // dead end, no way on: drive.)
    this.cars = o.cars.map((c) => { const path = new Path(plan.graph, c.path); return { ...c, kind: this.kinds.find((k) => k.id === c.kind)!, path, next: c.next ? new Path(plan.graph, c.next) : (c as { next?: unknown }).next === undefined ? this.planOn(plan.graph, path, !!c.cable, path.endA) : null }; });
    for (const c of this.cars) c.path.eval(c.s, this.pose);   // the path remembers its last lane offset
    this.obstacles.length = 0;
  }

  // `truck` is the truck's body as circles; `peds` the pedestrians. `density` scales how many.
  // One fixed step (the journey's), around `focus`; `prs` are the signals the truck has held.
  // The truck's own path and where it is on it (its rear axle), and how far its body reaches
  // ahead of and behind that, its trailer's angle and kingpin (a tractor's): it books junctions on
  // its way as any car (truckBook), its body's sweep through them.
  private truckPath: { path: Path; s: number; v: number; front: number; rear: number; yaw?: number; fw?: number } | null = null;
  // The truck arriving at the town's gate: the junction inside it, and the gate street.
  private truckGate: { node: number; street: number } | null = null;
  // The truck's way where it lands off a freeway exit ramp, sampled every 1.5 m (x, z pairs).
  private landing: number[] = [];
  private landingAt = 0;   // (where on the way the ramp meets the street)
  private landingS: number[] = [];
  step(plan: CityPlan, simTime: number, prs: SignalPreempt[], focus: { x: number; z: number }, truck: Obstacle[], truckHeading: number, peds: Obstacle[], truckPath: { path: Path; s: number; v: number; front: number; rear: number; yaw?: number; fw?: number } | null = null, truckGate: { node: number; street: number } | null = null, landing: { path: Path; s0: number; s1: number; at: number } | null = null, crossers: number[] = [], waiters: number[] = [], eye: { x: number; z: number; h: number } | null = null) {
    this.truckPath = truckPath; this.truckGate = truckGate; this.crossers = crossers; this.waiters = waiters; this.eye = eye;
    // (Its body at each place on that way, from rear to nose along its heading every 1.5 m: pulling
    // out of a bay or off a ramp, its nose swings wide of the way its rear wheels take. landingS:
    // each point's place on the way.)
    this.landing.length = 0; this.landingS.length = 0;
    const fr = truckPath ? truckPath.front : 4, rr = truckPath ? truckPath.rear : -4;
    if (landing) for (let a = landing.s0; a <= Math.min(landing.s1, landing.path.length); a += 1.5) {
      landing.path.peek(a, this.gw0);
      const fx = Math.cos(this.gw0.h), fz = -Math.sin(this.gw0.h);
      for (let b = rr; b <= fr + 0.01; b += 1.5) { this.landing.push(this.gw0.x + fx * b, this.gw0.z + fz * b); this.landingS.push(a); }
    }
    this.landingAt = landing ? landing.at : 0;
    this.sweep.length = 0;
    for (const o of truck) if (o.sweep) this.sweep.push(o);
    // (The truck about to turn within 70 m: to the left (1), moving over into the inner lane for
    // it, or the right (-1), swinging its rear across the kerb lane. The next turn on its way.)
    this.truckTurn = 0;
    if (truckPath) for (const tn of truckPath.path.nodes) if (tn.sOut > truckPath.s) { if (tn.sLine - truckPath.s < 70 && tn.move !== "S") this.truckTurn = tn.move === "L" ? 1 : -1; break; }
    const dt = SIM_DT;
    for (const c of this.cars) { c.px = c.x; c.pz = c.z; c.ph = c.h; c.podo = c.odo ?? 0; }
    // Despawn far vehicles; top up near the truck. (Never where it would be seen going: a far one
    // still in sight down a long street goes once it is out of sight, past the view distance at most.)
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i], far = Math.hypot(c.x - focus.x, c.z - focus.z);
      if (far > TRAFFIC_DESPAWN && this.unseen(plan.graph, c)) this.cars.splice(i, 1);
      // (And one stuck for good, in a knot of traffic nothing undoes: gone, turned off somewhere,
      // once it is out of sight. In sight it stands on in the knot.)
      else if (c.stillT > STUCK_GONE && this.unseen(plan.graph, c)) this.cars.splice(i, 1);
    }
    const bx = Math.floor(focus.x / BLOCK), bz = Math.floor(focus.z / BLOCK);
    const d = plan.district(bx, bz);
    const want = d === "downtown" ? 30 : d === "commercial" ? 26 : d === "residential" ? 15 : 12;
    // (Counting only those within reach: far ones kept on in sight down a long street aren't round
    // the truck, and mustn't stop it being topped up.)
    let near = 0;
    for (const c of this.cars) if (Math.hypot(c.x - focus.x, c.z - focus.z) <= TRAFFIC_DESPAWN) near++;
    for (let tries = 0; tries < 3 && near < want; tries++) { const n = this.cars.length; this.spawn(plan, focus, truck, simTime, prs, peds, eye); if (this.cars.length > n) near++; }
    // Drive.
    this.obstacles.length = 0;
    for (const c of this.cars) this.carCircles(c, this.obstacles);
    // (The lookup and the deadlock answers are reused from step to step: seeks replay thousands.)
    const byId = this.byId, ignore = this.ignore;
    byId.clear();
    for (const c of this.cars) byId.set(c.id, c);
    ignore.length = this.cars.length;
    // (Once let through, a car goes on ignoring that one car for 4 s: else, moving, it is no
    // longer stuck behind it, the ring is broken, it stops again and is stuck for good.)
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i], b = this.deadlockBlocker(c, byId);   // from last step's state, before anyone moves
      // (Or until the two are 3 m clear of each other, ends to ends: past each other, it no longer
      // needs to. Measured from their middles plus half their lengths: a bus and a box truck nose
      // to nose are 11 m apart middle to middle.)
      if (b >= 0) { c.passId = b; c.passT = 4; }
      else if ((c.passT ?? 0) > 0) { const o = byId.get(c.passId!); c.passT = o && Math.hypot(o.x - c.x, o.z - c.z) < (c.kind.len + o.kind.len) / 2 + 3 ? c.passT! - dt : 0; }
      ignore[i] = b >= 0 ? b : (c.passT ?? 0) > 0 ? c.passId! : -1;
    }
    // (The bookings by node, as they stand: in their order.)
    this.booked.clear();
    const bks = this.bks; bks.length = 0;
    for (const c of this.cars) if (c.bk) bks.push(c);
    bks.sort(Traffic.bySeq);
    for (const c of bks) this.listAt(c.bk!.node).push(c);
    this.truckBook(plan.graph, simTime, plan.seed, prs);
    for (let i = this.cars.length - 1; i >= 0; i--) { const c = this.cars[i]; if (c.clownHold) { c.v = 0; c.acc = 0; c.stillT = 0; c.blockedBy = -1; c.slowT = 0; } else this.drive(c, dt, plan, simTime, prs, truck, truckHeading, peds, i, ignore[i]); }
  }


  private spawn(plan: CityPlan, focus: { x: number; z: number }, truck: Obstacle[], simTime: number, prs: SignalPreempt[], peds: Obstacle[], eye: { x: number; z: number; h: number } | null) {
    const r = this.rnd;
    const ang = r() * Math.PI * 2, dist = TRAFFIC_SPAWN[0] + r() * (TRAFFIC_SPAWN[1] - TRAFFIC_SPAWN[0]);
    const px = focus.x + Math.cos(ang) * dist, pz = focus.z + Math.sin(ang) * dist;
    // Onto the nearest street (a cable car: the nearest with tracks), one way or the other,
    // `before` metres short of the node it runs to.
    const G = plan.graph, fwd = r() < 0.5, before0 = 15 + r() * 35;
    let kind = this.pickKind(plan);
    let cable = false;
    if (plan.style.cableCar && r() < 0.25 && this.count("cablecar", focus) < 2) { kind = this.kinds.find((k) => k.id === "cablecar")!; cable = true; }
    if (!kind || this.count(kind.id) >= kind.cap) return;
    const sid = nearestStreet(G, px, pz, cable);
    // Only on the city's own streets (none out of town).
    if (sid < 0 || !G.streets[sid].inCity) return;
    const d = sid * 2 + (fwd || G.streets[sid].oneway ? 0 : 1), before = Math.min(before0, G.streets[sid].len - 6);
    if (before < 8) return;
    const mv = this.validMove(G, d, cable);
    if (mv < 0) return;
    // (On along the next street half its length at most, where the next plan picks up: short of
    // the corner after it, leaving that turn its room.)
    const route: Route = { d, before, edges: [mv], after: Math.min(30, G.faceLen(mv) / 2) };
    const path = new Path(G, route);
    path.eval(0, this.pose);
    // Not on top of anything.
    for (const o of truck) if (Math.hypot(o.x - this.pose.x, o.z - this.pose.z) < 14) return;
    for (const o of this.obstacles) if (Math.hypot(o.x - this.pose.x, o.z - this.pose.z) < 14) return;
    for (const c of this.cars) if (Math.hypot(c.x - this.pose.x, c.z - this.pose.z) < 14) return;
    // Nor where it would be seen appearing: nose, middle or tail.
    if (eye && !vehicleUnseen(G, eye, this.pose.x, this.pose.z, this.pose.h, kind.len, kind.width)) return;
    // (Nor on anyone in the road, nor just short of someone crossing it.)
    const fx = Math.cos(this.pose.h), fz = -Math.sin(this.pose.h);
    for (const o of peds) { const dx = o.x - this.pose.x, dz = o.z - this.pose.z, a = dx * fx + dz * fz; if (a > -8 && a < 14 && Math.abs(dx * fz - dz * fx) < 4) return; }
    for (let i = 0; i < this.crossers.length; i += 4) if (segDist(this.pose.x, this.pose.z, this.crossers[i], this.crossers[i + 1], this.crossers[i + 2], this.crossers[i + 3]) < 16) return;
    // Short of a light that isn't green: not past its stop line, and stopped there if it is too
    // close to stop from speed.
    let v = kind.vmax * 0.7;
    // (No faster than it can stop from, 6 m short of the first junction's line: it may have to
    // give way there, to a car already crossing.)
    // (Nor too close to it to stop: never past its line, in the junction, unbooked.)
    const n0 = path.nodes[0];
    if (n0 && n0.sLine - 0.8 - kind.len / 2 < 6) return;
    if (n0) v = Math.min(v, Math.sqrt(9 * Math.max(0, n0.sLine - 0.8 - kind.len / 2 - 6)));
    const sg = path.signals[0];
    if (sg && signalState(G.nodes[sg.node], sg.phase, simTime, plan.seed, prs) !== "green") {
      const dist = sg.sLine - 0.8 - kind.len / 2;
      if (dist < 0.5) return;
      if (dist < v * v / 9 + 1) v = 0;
    }
    const next = this.planOn(G, path, cable, path.endA);
    // (Not on a way that leads nowhere, nor on into one: it would only drive on into sight and stand
    // at its end. A cable car, at the end of its line, turns round: turnRound.)
    if (!cable && (!next || !this.wayOn(G, next.endEdge, cable, 1))) return;
    const color = kind.colors ? pick(r, kind.colors) : 0xffffff;
    // The driver: one number for how bold, and a little of each on its own.
    const bold = r(), mix = (a: number, b: number) => a + (b - a) * (0.7 * bold + 0.3 * r());
    const big = kind.len > 7;   // (a bus or truck: steady, whoever drives it)
    const dT = mix(1.8, 1.0), dS0 = mix(2.6, 1.6), dA = big ? 1.1 : mix(1.3, 2.4), dB = big ? 1.6 : mix(1.8, 3.0), dV = mix(0.88, 1.08), gapT = mix(3.4, 1.8);
    const model: TruckModel | null = kind.id === "ryder" ? (r() < 0.5 ? "box16" : "box26") : null;
    this.cars.push({ kind, path, next, s: 0, v, dodge: cable ? -3 : 0, dodgeTarget: cable ? -3 : 0, dodgeV: 0, holdT: 0, stillT: 0, committed: -1, stopFor: -1, blockedBy: -1, slowT: 0, pedT: 0, acc: 0,
      color, x: this.pose.x, z: this.pose.z, h: this.pose.h, px: this.pose.x, pz: this.pose.z, ph: this.pose.h, cable, id: this.nextId++, model, dT, dS0, dA, dB, dV, gapT,
      odo: kind.rig ? r() * 10 : 0, podo: 0 });
  }
  // How many of kind `id` there are (within TRAFFIC_DESPAWN of `near`, if given: not far ones kept on
  // in sight down a long street).
  private count(id: string, near: { x: number; z: number } | null = null) { let n = 0; for (const c of this.cars) if (c.kind.id === id && (!near || Math.hypot(c.x - near.x, c.z - near.z) <= TRAFFIC_DESPAWN)) n++; return n; }
  private pickKind(plan: CityPlan): VehicleKind | null {
    const w = (k: VehicleKind) => plan.style.storybook ? STORY_TRAFFIC[k.id] ?? 0 : k.weight;
    const pool = this.kinds.filter((k) => w(k) > 0 && (k.id !== "icecream" || plan.style.id !== "port"));
    let t = this.rnd() * pool.reduce((a, k) => a + w(k), 0);
    for (const k of pool) { if ((t -= w(k)) < 0) return k; }
    return pool[0] ?? null;
  }
  // Where car c is to wait for the truck coming in at the town's gate, its way on not yet known (an
  // s on its path), or null: at the line of the junction inside the gate, on every approach but the
  // gate street's. (Elsewhere the truck is in the junction bookings, as any car.)
  private giveWay(c: Car): number | null {
    const gate = this.truckGate;
    if (!gate) return null;
    // (The node next on its path, or, past the last, on the next path planned: one coming up fast
    // on a junction just round from where its path ends must see it in time to stop. `off` is
    // where that path starts on this one's s.)
    let n = this.nextNode(c), off = 0;
    if (!n && c.next) { const m = c.next.nodes[0]; if (m && c.path.length + m.sLine - c.s <= 30) { n = m; off = c.path.length; } }
    if (!n) return null;
    return n.node === gate.node && (n.from >> 1) !== gate.street ? off + n.sLine : null;
  }
  private gw0: Pose = { x: 0, z: 0, h: 0, k: 0 }; private gw1: Pose = { x: 0, z: 0, h: 0, k: 0 }; private gwS: Pose = { x: 0, z: 0, h: 0, k: 0 };
  // Whether car c's body a little further on along its way (2 m, or 0.8 s at its speed; moved over
  // as it is) would come closer to obstacle o than it is now and touch it: its tail swinging out
  // round a turn into something beside it. (That pose kept for the rest of c's scan this step.)
  private swId = -1; private swS = NaN; private swP: Path | null = null; private swOk = false;
  private swingsInto(c: Car, o: Obstacle, half: number): boolean {
    if (this.swId !== c.id || this.swS !== c.s || this.swP !== c.path) {
      this.swId = c.id; this.swS = c.s; this.swP = c.path;
      const b = c.s + Math.max(2, c.v * 0.8);
      this.swOk = true;
      if (b <= c.path.length) c.path.peek(b, this.gwS);
      else if (c.next && b - c.path.length <= c.next.length) c.next.peek(b - c.path.length, this.gwS);
      else this.swOk = false;
    }
    if (!this.swOk) return false;
    // (Its body, a rectangle, from o's middle: within o's radius. Corners and all: a long vehicle's
    // back corner is what swings out.)
    const q = this.gwS, r = Math.min(o.r, 1.3) + 0.1, hw = c.kind.width / 2;
    const dNext = boxDist(o.x, o.z, q.x + Math.sin(q.h) * c.dodge, q.z + Math.cos(q.h) * c.dodge, q.h, half, hw);
    return dNext < r && dNext < boxDist(o.x, o.z, c.x, c.z, c.h, half, hw) - 0.02;
  }
  // The node car c's path comes to next, within 30 m and its line not yet crossed, or null.
  // (`past`: how far past its line the car may be and the node still count.)
  private nextNode(c: Car, past = 0.5) {
    for (const n of c.path.nodes) if (c.s <= n.sLine + past && n.sLine - c.s <= 30) return n;
    return null;
  }
  // Where car c is to wait for the truck landing off an exit ramp or pulling out of a dock bay (an
  // s, as giveWay's), or null: short of the first point in its next 35 m (on along its next path
  // too) within its half width and 1.5 m of the truck's body anywhere on its way there. A car
  // already on that way 3 m past the landing, going its way (ahead of the truck on it), carries on;
  // one beside the foot, short of it, waits where it is.
  private landingWay(c: Car, half: number): number | null {
    const P = this.landing;
    if (!P.length) return null;
    // (On the street past where the ramp meets it, ahead of the truck and going its way, in its lane
    // or the next: it carries on. Stopping there would stop it in the truck's way.)
    let best = Infinity, bi = -1;
    for (let i = 0; i < P.length; i += 2) { const d = Math.hypot(P[i] - c.x, P[i + 1] - c.z); if (d < best) { best = d; bi = i / 2; } }
    // (Past the foot by 3 m at least: one coming up the street to it isn't ahead of the truck yet.
    // Going its way: as the way runs there.)
    if (best < GIVE_WAY_GAP + 1.5 && this.landingS[bi] >= this.landingAt + 3 && P.length >= 4) {
      let k2 = bi; while (k2 + 1 < this.landingS.length && this.landingS[k2 + 1] === this.landingS[bi]) k2++;
      const k = Math.min(k2, P.length / 2 - 2) * 2, wx = P[k + 2] - P[k], wz = P[k + 3] - P[k + 1];
      if (wx * Math.cos(c.h) - wz * Math.sin(c.h) > 0) return null;
    }
    // (Nowhere near it: no point in its next 35 m can come within GIVE_WAY_GAP + 1.5 of the way.)
    if (best > 35 + GIVE_WAY_GAP + 1.5) return null;
    // (On along its next path past this one's end: the way may cross just round the corner.)
    for (let b = c.s + half; b <= c.s + 35; b += 1.5) {
      if (b <= c.path.length) c.path.peek(b, this.gw1);
      else if (c.next && b - c.path.length <= c.next.length) c.next.peek(b - c.path.length, this.gw1);
      else break;
      let near = false;
      // (Clear of its body by the car's half width and 1.5 m: a car turning in to run alongside its
      // way meets it at a slant, and stopped 2 m short along its own way would still be beside it.)
      const w = 1.25 + c.kind.width / 2 + 1.5;
      for (let i = 0; i < P.length && !near; i += 2) near = Math.hypot(P[i] - this.gw1.x, P[i + 1] - this.gw1.z) < w;
      // (b is where c's middle would be on the truck's way: c is to stop with its front 2 m short
      // of that point, so its "line", as giveWay's, 1.2 m short: the caller stops it 0.8 m and
      // half a length further back.)
      if (near) return b - 1.2;
    }
    return null;
  }
  // ---- junction bookings -----------------------------------------------------------------------
  // Each car books its way through a junction before it crosses the line: its path from the line
  // to past the far mouth, as a footprint (centre-line points every metre and its width). Where
  // that footprint comes within touching distance of an earlier booking's, the two share a
  // conflict zone, and the later booking waits short of the zone until the earlier car has left
  // it. The order of bookings is the order of right of way, so no two cars wait on each other.
  // Who books when is the rules of the road: a car with right of way (straight or right on a
  // green, on round a roundabout) books on its approach; one that must give way (a left turn on
  // a green, at a stop sign once stopped, joining a roundabout, at an unmarked junction) books at
  // its line once the bookings ahead of it leave it a gap, and waits there until then.
  // The node ahead of car c it is to book or has booked (not yet cleared): on its path, or on the
  // next one, planned already (`off`: where that path starts on this one's s); rel is c's middle
  // from its line.
  private nodeAhead(c: Car): { n: Path["nodes"][number]; P: Path; off: number; rel: number } | null {
    const half = c.kind.len / 2;
    for (const n of c.path.nodes) if (c.s <= n.sOut + half + 3) return n.sLine - c.s <= 45 ? { n, P: c.path, off: 0, rel: c.s - n.sLine } : null;
    if (c.next) for (const n of c.next.nodes) { const off = c.path.length; return off + n.sLine - c.s <= 45 ? { n, P: c.next, off, rel: c.s - off - n.sLine } : null; }
    return null;
  }
  // Where an owner of a booking is now, from its line (Infinity: gone on past it, onto a later path).
  private relOf(o: Car): number {
    const b = o.bk!;
    for (const n of o.path.nodes) if (n.node === b.node && n.from === b.from) return o.s - n.sLine;
    if (o.next) for (const n of o.next.nodes) if (n.node === b.node && n.from === b.from) return o.s - o.path.length - n.sLine;
    return Infinity;
  }
  // A footprint: P's centre line from 1 m short of the line to 2 m past the far mouth, every
  // metre (x, z pairs; the i-th is i - 1 m from the line).
  // (Moved over out of its lane (dodge, negative to the left), from where it is: easing back over
  // the first 12 m, `ease`; or not, staying there: a car going straight on, a cable car on its tracks.)
  private footprint(P: Path, n: Path["nodes"][number], dodge = 0, ease = true): number[] {
    const pts: number[] = [];
    for (let s = n.sLine - 1, i = 0; s <= Math.min(n.sOut + 2, P.length); s += 1, i++) {
      P.peek(s, this.gw0);
      const d = ease ? dodge * Math.max(0, 1 - i / 12) : dodge;
      pts.push(cm(this.gw0.x + Math.sin(this.gw0.h) * d), cm(this.gw0.z + Math.cos(this.gw0.h) * d));
    }
    return pts;
  }
  // The conflict zone of two footprints (half lengths and widths), or null: [where A's middle is
  // when its front comes to the zone, where its back leaves it, the same for B], from each line.
  // (A body sweep, the truck's (truckSweep), has `at`: where its middle is, from the line, as it
  // covers each point. Its half width then is its body's; its length is in the points.)
  private zone(A: number[], ha: number, wa: number, B: number[], hb: number, wb: number, atA?: number[], atB?: number[]): number[] | null {
    // (With room to spare: a car stopped at the edge of one isn't in the other's way. And more for
    // a long vehicle, whose back wheels cut inside its front's way round a turn; a sweep has that
    // in it already, and wants only a little for the gaps between its points.)
    if (atA) ha = 0;
    if (atB) hb = 0;
    const near = (wa + wb) / 2 + 0.8 + 0.08 * Math.max(ha, hb) * 2 + (atA || atB ? 0.3 : 0);
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let i = 0; i < A.length; i += 2) for (let j = 0; j < B.length; j += 2) {
      const dx = A[i] - B[j], dz = A[i + 1] - B[j + 1];
      if (dx > near || dx < -near || dz > near || dz < -near || dx * dx + dz * dz > near * near) continue;
      const ia = atA ? atA[i / 2] : i / 2 - 1, jb = atB ? atB[j / 2] : j / 2 - 1;
      if (ia < a0) a0 = ia; if (ia > a1) a1 = ia; if (jb < b0) b0 = jb; if (jb > b1) b1 = jb;
    }
    return a0 === Infinity ? null : [a0 - ha, a1 + ha, b0 - hb, b1 + hb];
  }
  // Seconds for a car going v to cover d metres, pulling away at 2 m/s^2 up to 7 m/s (or its speed).
  private static tTravel(d: number, v: number): number {
    if (d <= 0) return 0;
    const A = 2, vc = Math.max(v, 7), t1 = (vc - v) / A, d1 = (v + vc) / 2 * t1;
    return d <= d1 ? (-v + Math.sqrt(v * v + 2 * A * d)) / A : t1 + (d - d1) / vc;
  }
  private bookSeq = 0;
  // The truck as a road user in the bookings: it books each junction on its way as it comes within
  // 60 m of it, its way through as a footprint like any car's (its length and width), and so comes
  // in the order: cars booking after it wait for it, and it waits (street life's truckStop) short of
  // a zone a car that booked before it is still crossing. Kept and saved here (truckBk), as the
  // truck isn't one of the cars. Its id: -2.
  private truckCar: Car | null = null;
  private truckBk: Car["bk"] = null;
  // (Its turn, by the same rules as any car's: with right of way, on a green (any way: the lights
  // are held for it, and it doesn't go on the yellow as a car waiting to turn left does), or at an
  // unmarked junction, as on the main road, it books on its approach; it gives way turning right
  // on a red, at an all-way stop once stopped, and joining a roundabout, and books at its line
  // when the bookings ahead leave it a gap. Short of that, it waits at the line: truckZoneStop.)
  private truckBook(G: CityGraph, simTime: number, seed: number, prs: SignalPreempt[]) {
    const T = this.truckPath;
    this.truckLine = null; this.truckYieldsAt = -1;
    if (!T) { this.truckCar = null; this.truckBk = null; this.truckStillT = 0; return; }
    const len = T.front - T.rear, mid = T.s + (T.front + T.rear) / 2;
    const tc = this.truckCar ?? ({ kind: { id: "truck", len, width: 2 * TRAILER.hw }, id: -2, dodge: 0, next: null } as unknown as Car);
    tc.path = T.path; tc.s = mid; tc.v = Math.abs(T.v); tc.kind.len = len;
    T.path.peek(T.s, this.gw0); tc.x = this.gw0.x; tc.z = this.gw0.z; tc.h = this.gw0.h;
    this.truckCar = tc;
    this.byId.set(-2, tc);
    tc.bk = this.truckBk;
    // (Gone through its node: off it. Then the next node on its way within 60 m.)
    if (tc.bk && this.relOf(tc) > tc.bk.end) tc.bk = null;
    const n0 = tc.bk ? T.path.nodes.find((x) => x.node === tc.bk!.node && x.from === tc.bk!.from) : T.path.nodes.find((x) => x.sOut + len / 2 + 2 > mid && x.sLine - (T.s + T.front) < 60);
    if (!n0) { this.truckBk = tc.bk = null; this.truckStillT = 0; return; }
    // (With the nodes on past it whose lines are inside it, booked with it: else it would come to
    // their lines still booked through this one, too late to stop at them or book in turn.)
    const { n, also } = this.through(T.path, n0);
    const N = G.nodes[n.node], dLine = n.sLine - 0.6 - (T.s + T.front), short = dLine > -0.5, stopped = T.v < 0.3 && dLine < 2.5;
    // (How long it has stood at its line: at an all-way stop, anyone who has waited at the kerb
    // longer crosses first, as for a car: pedFirst.)
    this.truckStillT = stopped && short ? this.truckStillT + SIM_DT : 0; tc.stillT = this.truckStillT;
    let sigOk = true, first = true;
    if (N.control === "signal") {
      const sg = T.path.signals.find((x) => x.node === n.node), state = sg ? signalState(N, sg.phase, simTime, seed, prs) : "red";
      sigOk = state !== "red" || (n.move === "R" && stopped);
      first = state !== "red";
    } else if (N.control === "stop") { sigOk = stopped || !!tc.bk; first = false; }
    else if (T.path.yields.some((y) => y.node === n.node)) first = false;
    // (The nodes booked with it, by their own controls too: a red light there holds it at this
    // one's line, rather than waiting in this junction for it; an all-way stop or a give-way there,
    // it books at its line once there is a gap, not on its approach.)
    let alsoRed = false;
    for (const a of also) {
      const A = G.nodes[a];
      if (A.control === "signal") { const sg = T.path.signals.find((x) => x.node === a); if (!sg || signalState(A, sg.phase, simTime, seed, prs) === "red") sigOk = first = false, alsoRed = true; }
      else if (A.control === "stop" || T.path.yields.some((y) => y.node === a)) first = false;
    }
    // (Behind a car in its lane holding at the line for its turn: the truck's comes after that
    // one's, as in any queue. Booked before it, those crossing its way would wait for the truck
    // as the truck waits behind the car, and the car for them. Nor, short of the line, does it keep
    // a booking through a red.)
    const held = this.heldAhead(T, n);
    // (Unless it is too close to stop for the light, as journey.ts then goes on through it: then it
    // keeps its booking, rather than be held at a line it can't stop at.)
    const tooClose = dLine < (T.v * T.v) / (2 * FIRM_BRAKE) - 0.5;
    if (tc.bk && short && ((!sigOk && !tooClose) || held)) tc.bk = null;
    if (!tc.bk && sigOk && !held) {
      // (Its sweep from where it stands, kept while it waits there at its line for a gap.)
      const S = this.tSweep;
      if (S.node !== n.node || S.from !== n.from || Math.abs(S.s - T.s) > 0.05 || S.path !== T.path) { S.node = n.node; S.from = n.from; S.s = T.s; S.path = T.path; S.at = []; S.fp = this.truckSweep(T, n, S.at); }
      const at = S.at, fp = S.fp;
      if (first || !short) this.book(tc, n, fp, at, also);
      else if (dLine < 2.5 && T.v < 4) {
        this.truckYieldsAt = N.control === "stop" && this.pedFirst(tc, fp) ? n.node : -1;
        if (this.truckYieldsAt < 0 && this.gapOk(tc, n, fp, mid - n.sLine, 2.5, at, also)) this.book(tc, n, fp, at, also);
      }
    } else if (tc.bk) for (const nd of [tc.bk.node, ...(tc.bk.also ?? [])]) { const l = this.listAt(nd); if (!l.includes(tc)) l.push(tc); }
    // (Its turn not come, it waits at the line. At a red, the truck's own driving stops it.)
    // (A red at a node booked with it, its own light green: here, at this one's line, too, not at
    // that one's inside this junction, as its own driving would.)
    if (!tc.bk && short && !(N.control === "signal" && !sigOk && !alsoRed)) this.truckLine = n.sLine - 0.6 - T.front;
    this.truckBk = tc.bk ?? null;
  }
  private truckLine: number | null = null;
  private truckStillT = 0;   // (how long the truck has stood at its line: saved)
  // Whether the truck, stopped at an all-way stop, is letting someone waiting at the kerb cross
  // first (pedFirst): that stop's node, or -1. The crowd's next step has them go, close as it is.
  // (Saved.)
  truckYieldsAt = -1;
  private tSweep = { node: -1, from: -1, s: 0, path: null as Path | null, fp: [] as number[], at: [] as number[] };   // (where the truck is to wait at its line: its rear axle's s)
  // Whether a car holding at node n's line for its turn (unbooked) is ahead of the truck in its lane.
  private heldAhead(T: NonNullable<Traffic["truckPath"]>, n: Path["nodes"][number]): boolean {
    for (const o of this.cars) {
      if (!o.held || o.bk) continue;
      const J = this.nodeAhead(o);
      if (!J || J.n.node !== n.node || J.n.from !== n.from) continue;
      const s = n.sLine + J.rel;
      if (s < T.s + T.front || s > n.sLine + 2) continue;
      T.path.peek(s, this.gw0);
      if (Math.hypot(this.gw0.x - o.x, this.gw0.z - o.z) < 1.8) return true;
    }
    return false;
  }
  // The truck's way through node n as its body sweeps it, from where it is now: every metre its
  // rear axle goes, points every 1.5 m down the middle of each rigid part (cab and body; a
  // tractor's trailer, dragged on its kingpin as journey.ts hitchStep drags it), from as its nose
  // comes 3 m short of the line until it has left the far mouth; and in `at` for each, where its
  // middle then is from the line. So its trailer cutting inside a turn and its nose swinging wide
  // are in it: where its body really goes, not its rear wheels' way.
  private truckSweep(T: NonNullable<Traffic["truckPath"]>, n: Path["nodes"][number], at: number[]): number[] {
    const pts: number[] = [], mid0 = (T.front + T.rear) / 2, len = T.front - T.rear, fw = T.fw, K = KINGPIN_TO_AXLES, q = this.gw0;
    let ax = 0, az = 0;
    if (fw !== undefined) {
      T.path.peek(T.s, q);
      const th = q.h + (T.yaw ?? 0), kx = q.x + Math.cos(q.h) * fw, kz = q.z - Math.sin(q.h) * fw;
      ax = kx - Math.cos(th) * K; az = kz + Math.sin(th) * K;
    }
    const cabRear = fw !== undefined ? -1.4 : T.rear, sEnd = Math.min(T.path.length, n.sOut + 2 + len / 2 - mid0);
    for (let s = T.s; s <= sEnd; s += 1) {
      T.path.peek(s, q);
      const fx = Math.cos(q.h), fz = -Math.sin(q.h), rel = s + mid0 - n.sLine, rec = s + T.front >= n.sLine - 3;
      let tx = 0, tz = 0, kx = 0, kz = 0;
      if (fw !== undefined) {
        kx = q.x + fx * fw; kz = q.z + fz * fw;
        const d = Math.hypot(kx - ax, kz - az) || 1;
        ax = kx - (kx - ax) / d * K; az = kz - (kz - az) / d * K;
        tx = (kx - ax) / K; tz = (kz - az) / K;
      }
      if (!rec) continue;
      for (let b = cabRear; b < T.front + 0.74; b += 1.5) { const u = Math.min(b, T.front); pts.push(cm(q.x + fx * u), cm(q.z + fz * u)); at.push(cm(rel)); }
      if (fw !== undefined) for (let b = TRAILER.rear; b < TRAILER.front + 0.74; b += 1.5) { const u = Math.min(b, TRAILER.front); pts.push(cm(kx + tx * u), cm(kz + tz * u)); at.push(cm(rel)); }
    }
    return pts;
  }
  private booked = new Map<number, Car[]>();   // (this step's bookings by node)
  private bkAt: Car[] = [];
  private bks: Car[] = [];   // (the booked cars, in booking order: kept, so a step makes no garbage)
  private static bySeq = (a: Car, b: Car) => a.bk!.seq - b.bk!.seq;
  // Book car c through node n (footprint fp): its conflict zones with every earlier booking there.
  // (`at`: a body sweep's, as zone's.)
  private book(c: Car, n: Path["nodes"][number], fp: number[], at?: number[], also?: number[]) {
    const zones: number[] = [], turn = n.move !== "S", over = c.dodge < -1;
    for (const o of this.bookedAt(n.node, also)) {
      if (o === c || !o.bk || (o.bk.from === n.from && !Traffic.across(turn, over, o.bk)) || this.relOf(o) > o.bk.end) continue;
      const z = this.zone(fp, c.kind.len / 2, c.kind.width, o.bk.pts, o.kind.len / 2, o.kind.width, at, o.bk.at);
      if (z) zones.push(o.id, o.bk.seq, cm(z[0]), cm(z[1]), cm(z[2]), cm(z[3]));
    }
    c.bk = { node: n.node, from: n.from, seq: this.bookSeq++, pts: fp, at, zones, end: n.sOut - n.sLine + 2 + c.kind.len / 2, wide: turn && over, dodge: cm(c.dodge) || undefined, turn: turn || undefined, also: also?.length ? also.slice() : undefined };
    for (const nd of [n.node, ...(also ?? [])]) {
      const list = this.listAt(nd), i = list.indexOf(c);
      if (i >= 0) list.splice(i, 1);
      list.push(c);
    }
  }
  // Whether two bookings from the same approach must look out for each other: not as a rule, as
  // they follow each other, as on any street; but where one turns from the next lane over, across
  // the other's, or where they go side by side, one in the next lane over (a cable car on its
  // tracks, or a car moved over to pass), and either turns (a long vehicle's back swings out round
  // a turn into the lane beside). turn, over: the car booking (or asking)'s, through the node (it
  // turns there; it is moved over, dodge < -1); b: the other's booking.
  private static across(turn: boolean, over: boolean, b: NonNullable<Car["bk"]>): boolean {
    return (turn && over) || !!b.wide || (over !== (b.dodge ?? 0) < -1 && (turn || !!b.turn));
  }
  // This step's bookings at node nd (made if none).
  private listAt(nd: number): Car[] { let l = this.booked.get(nd); if (!l) this.booked.set(nd, (l = [])); return l; }
  // The bookings at node nd and at the nodes booked with it (`also`), each once.
  private bookedAt(nd: number, also?: number[]): Car[] {
    const l = this.booked.get(nd) ?? [];
    if (!also?.length) return l;
    const out = this.bkAt; out.length = 0; out.push(...l);   // (kept: a step makes no garbage)
    for (const a of also) for (const o of this.booked.get(a) ?? []) if (!out.includes(o)) out.push(o);
    return out;
  }
  // Node n on path P, run on through the nodes after it whose lines come before its far mouth (or
  // within 2 m of it): as one, out at the last one's mouth; also: those nodes.
  private thru = { P: null as Path | null, n0: null as Path["nodes"][number] | null, n: null as unknown as Path["nodes"][number], also: [] as number[] };
  private through(P: Path, n: Path["nodes"][number]): { n: Path["nodes"][number]; also: number[] } {
    // (Kept from the step before for the same node: a step makes no garbage.)
    const T = this.thru;
    if (T.P === P && T.n0 === n) return T;
    T.P = P; T.n0 = n;
    const i = P.nodes.indexOf(n);
    let m = n;
    const also: number[] = [];
    for (let k = i + 1; k < P.nodes.length && P.nodes[k].sLine < m.sOut + 2; k++) { m = { ...m, sOut: Math.max(m.sOut, P.nodes[k].sOut) }; also.push(P.nodes[k].node); }
    T.n = m; T.also = also;
    return T;
  }
  // Whether car c, at rel from its line going v, could book footprint fp through n now: every
  // earlier booking there whose way it would cross has left the zone `gap` s before c gets to it.
  private gapOk(c: Car, n: Path["nodes"][number], fp: number[], rel: number, gap: number, at?: number[], also?: number[]): boolean {
    const turn = n.move !== "S", over = c.dodge < -1;
    for (const o of this.bookedAt(n.node, also)) {
      if (o === c || !o.bk || (o.bk.from === n.from && !Traffic.across(turn, over, o.bk))) continue;
      const ro = this.relOf(o);
      if (ro > o.bk.end || this.behindOnApproach(o, c, n.from)) continue;
      const z = this.zone(fp, c.kind.len / 2, c.kind.width, o.bk.pts, o.kind.len / 2, o.kind.width, at, o.bk.at);
      if (!z || ro > z[3]) continue;   // (clear of it already)
      const tIn = Traffic.tTravel(z[0] - rel, c.v), tOut = Traffic.tTravel(z[3] - ro, o.v);
      if (tIn < tOut + gap) return false;
    }
    return true;
  }
  // Booked car c (rel from its line, which is at `line` on its path): where to stop (as a stop
  // line) short of any conflict zone an earlier booking is still in or yet to come to, or null.
  private zoneStop(c: Car, rel: number, line: number): number | null {
    let stop = Infinity;
    c.waitFor = -1;
    const Z = c.bk!.zones;
    for (let k = 0; k < Z.length; k += 6) {
      const o = this.byId.get(Z[k]);
      if (!o || !o.bk || o.bk.seq !== Z[k + 1] || this.relOf(o) > Z[k + 5]) continue;
      // (Unless that one is stuck behind this one, waiting on it to move: then this one goes on,
      // out of its way, first. Nor, for the truck, one behind it already, or one holding for it.)
      if (this.stuckBehind(o, c.id) || this.behindOnApproach(o, c, c.bk!.from)) continue;
      // (Nor, for the truck, one the clowns are coming for: lifted out of its way soon, clowns.ts.)
      if (c.id === -2 && ((o.x - c.x) * Math.cos(c.h) - (o.z - c.z) * Math.sin(c.h) < 0 || o.truckHold || o.clownHold)) continue;
      if (rel < Z[k + 2] && Z[k + 2] - 1 < stop) { stop = Z[k + 2] - 1; c.waitFor = o.id; }
    }
    return stop === Infinity ? null : line + stop + 0.8 + c.kind.len / 2;
  }
  // Car c's way through the junction on its path, replanned straight on (and the plan after it),
  // if there is one: whether it was.
  private straightOn(c: Car, G: CityGraph): boolean {
    // (A way through one junction only: one through two (from older saves) would have straight on
    // from the first undo the way it came.)
    const r = c.path.route, d = r.edges.length === 1 ? r.d : -1;
    if (d < 0) return false;
    const ok = (e: number) => G.streets[e >> 1].inCity && (!c.cable || !!G.streets[e >> 1].tags.cable);
    // (Not into a street with no way on from its far end, two streets deep: validMove.)
    const mv = G.movesFrom(d).find((x) => x.move === "S" && ok(x.to) && this.wayOn(G, x.to, c.cable, 2));
    if (!mv) return false;
    const path = new Path(G, { ...r, edges: [mv.to], after: Math.min(30, G.faceLen(mv.to) / 2) });
    if (Math.abs(path.length - c.path.length) > 200) return false;
    // (Its light judged anew for the new way through: a right on red it had begun is no straight on.)
    // (From where it is: moved over as far from the new way's lane as it is now, which must be no
    // further than the next lane over. Else it would jump across.)
    const o = c.path.peek(c.s, this.gw0), ox = o.x, oz = o.z, q = path.peek(c.s, this.gw1);
    const dodge = c.dodge + (ox - q.x) * Math.sin(q.h) + (oz - q.z) * Math.cos(q.h);
    if (dodge < -3.05 || dodge > 0.05) return false;
    c.path = path; c.next = this.planOn(G, path, c.cable, path.endA); c.bk = null; c.committed = -1; c.stopFor = -1;
    c.dodge = c.dodgeTarget = Math.min(0, Math.max(-3, dodge)); c.dodgeV = 0;
    c.path.eval(c.s, this.pose);
    return true;
  }
  // The clowns (clowns.ts): car `id` held where it stands for them (it stops dead, and nothing has
  // it make way), and where it is; whether it is held so (and still here); and taking it out of the
  // town as they lift it, to be drawn as they carry it (lifted).
  holdCar(id: number): { x: number; z: number; h: number; len: number; width: number } | null {
    const c = this.cars.find((o) => o.id === id);
    if (!c) return null;
    // (Not stuck behind anyone any more, as far as a deadlock goes: else, in a ring, one stuck behind
    // it would be let through it, deadlockBlocker. Its junction booking kept: standing in the
    // junction, those booked after it wait clear of it till it is lifted, zoneStop.)
    c.clownHold = true; c.v = 0; c.acc = 0; c.blockedBy = -1; c.slowT = 0; c.truckHold = false; c.held = false;
    return { x: c.x, z: c.z, h: c.h, len: c.kind.len, width: c.kind.width };
  }
  // (The car the truck's junction booking has it wait for, or -1: truckZoneStop.)
  get truckWaitsOn(): number { const w = this.truckCar?.waitFor; return w !== undefined && w >= 0 ? w : -1; }
  isHeld(id: number): boolean { return this.cars.some((o) => o.id === id && o.clownHold); }
  takeCar(id: number): LiftedCar | null {
    const i = this.cars.findIndex((o) => o.id === id);
    if (i < 0) return null;
    const c = this.cars[i];
    this.cars.splice(i, 1);
    (c as Car & { taken?: boolean }).taken = true;   // (test/vanish.ts: lifted in plain sight, not vanished)
    for (let k = this.obstacles.length - 1; k >= 0; k--) if (this.obstacles[k].owner === id) this.obstacles.splice(k, 1);
    return { kind: c.kind.id, color: c.color, model: c.model, len: c.kind.len, width: c.kind.width, id: c.id };
  }
  // (Those the clowns carry, filled in to be drawn: set by street life, life.ts.)
  liftedAt: ((alpha: number, out: LiftDraw[]) => void) | null = null;
  private liftList: LiftDraw[] = [];
  private liftE = new THREE.Euler();

  // Where the truck is to wait (its rear axle's s on its path) short of a junction zone a car that
  // booked before it is still crossing, or null. (Its booking: truckBook.)
  truckZoneStop(): number | null {
    const tc = this.truckCar, T = this.truckPath;
    if (!tc || !T) return null;
    if (!tc.bk) return this.truckLine;
    const n = T.path.nodes.find((x) => x.node === tc.bk!.node && x.from === tc.bk!.from);
    if (!n) return null;
    const stop = this.zoneStop(tc, this.relOf(tc), n.sLine);
    // (zoneStop's line: where the truck's front stops 0.8 m short; its rear axle's s then.)
    return stop === null ? null : stop - 0.8 - T.front;
  }
  // Whether there is a gap in the traffic at (x, z) for secs: no vehicle within 8 m of it, nor one
  // coming towards it that would be there sooner.
  gapAt(x: number, z: number, secs: number): boolean {
    for (const c of this.cars) {
      // (Not one holding for the truck already: it has the way.)
      if (c.truckHold) continue;
      const dx = x - c.x, dz = z - c.z;
      if (dx > 70 || dx < -70 || dz > 70 || dz < -70) continue;
      const d = Math.hypot(dx, dz);
      if (d < 8) return false;
      if (d > 70 || c.v < 1) continue;
      if ((dx * Math.cos(c.h) - dz * Math.sin(c.h)) / d > 0.5 && d / c.v < secs) return false;
    }
    return true;
  }
  // Car `id`'s speed (0 for none).
  speedOf(id: number | undefined): number { return id === undefined ? 0 : this.byId.get(id)?.v ?? 0; }
  // How far car `id` will have moved `secs` from now, on along its way at its speed (with the lane
  // changes and turns its path has, its dodge as it is), and its heading then; null if there is
  // none or it is standing.
  private aheadP: Pose = { x: 0, z: 0, h: 0, k: 0 };
  aheadOf(id: number | undefined, secs: number): { dx: number; dz: number; h: number } | null {
    const c = id === undefined ? undefined : this.byId.get(id);
    if (!c || c.v < 0.5) return null;
    const q = c.path.peek(Math.min(c.path.length, c.s + c.v * secs), this.aheadP);
    return { dx: q.x + Math.sin(q.h) * c.dodge - c.x, dz: q.z + Math.cos(q.h) * c.dodge - c.z, h: q.h };
  }
  // Whether car `id` stands waiting, where its junction booking has it, for the truck to go through.
  waitsForTruck(id: number | undefined): boolean {
    const c = id === undefined ? undefined : this.byId.get(id);
    return !!c && c.waitFor === -2 && c.v < 0.5;
  }
  // Whether booking owner o is behind car c on the same approach (from), still short of the line:
  // it can't come to the junction before c, so c doesn't wait for it, as from the lane beside.
  private behindOnApproach(o: Car, c: Car, from: number): boolean {
    if (!o.bk || o.bk.from !== from || c.id === -2) return false;
    return (o.x - c.x) * Math.cos(c.h) - (o.z - c.z) * Math.sin(c.h) < -c.kind.len / 2 && this.relOf(o) + o.kind.len / 2 < 0;
  }
  // Whether car o is held up, through a short chain of cars each stopped behind the next, by car `id`.
  private stuckBehind(o: Car, id: number): boolean {
    for (let k = 0, x: Car | undefined = o; k < 4 && x && x.v < 1 && x.blockedBy >= 0; k++) {
      if (x.blockedBy === id) return true;
      x = this.byId.get(x.blockedBy);
    }
    return false;
  }
  // The junction ahead of car c: book it when its turn comes, and where to stop short of it (as a
  // stop line, the caller stops the car's front 0.8 m short), or null to go on. sigOk: whether the
  // light (if any) lets it go; first: whether it has right of way (books on its approach).
  private junction(c: Car, G: CityGraph, simTime: number, seed: number, prs: SignalPreempt[]): number | null {
    const J = this.nodeAhead(c), half = c.kind.len / 2;
    c.waitFor = -1;
    if (!J) { c.bk = null; return null; }
    const { n, P, off, rel } = J, line = off + n.sLine;
    if (c.bk && (c.bk.node !== n.node || c.bk.from !== n.from)) c.bk = null;   // (an old one, gone past)
    // (Moved over since it booked, or back, or on over from part way, still short of its line:
    // booked again, from where it is now, as the cars beside it judge it by.)
    if (c.bk && rel + half < 0 && Math.abs(c.dodge - (c.bk.dodge ?? 0)) > 1) c.bk = null;
    // The rules: a light must be green (or it was too close to stop on the change: committed); a
    // stop sign stopped at first; a roundabout entered with a gap.
    const N = G.nodes[n.node], dLine = line - 0.8 - half - c.s;
    let sigOk = true, first = false;
    if (N.control === "signal") {
      const k = P.signals.findIndex((x) => x.node === n.node), sg = P.signals[k];
      const key = P === c.path ? k : c.path.signals.length;
      const state = sg ? signalState(N, sg.phase, simTime, seed, prs) : "red";
      sigOk = state === "green" || c.committed === key;
      first = sigOk && n.move !== "L" && c.committed !== key;   // (on a green; right on red gives way)
      // (A left turn waiting at its line through the green, with the oncoming stream that never
      // left it a gap: on the yellow, as that stops, it goes, as drivers do.)
      if (state === "yellow" && n.move === "L" && dLine < 2.5 && c.v < 1) sigOk = true;
    } else if (N.control === "stop") sigOk = c.stopOk === n.node || c.bk != null;
    else first = P.yields.length === 0 && !!G.streets[n.from >> 1].ring && !!G.streets[n.to >> 1].ring;   // (on round a roundabout)
    // (A booking lapses while the car is still short of its line if the light turns against it,
    // or it stands stuck in a queue: else those booked after it, crossing on the next green, wait
    // for it all that time.)
    // (Nor does it book while it stands queued behind another: its turn comes when it gets there.)
    const queued = c.blockedBy >= 0 && c.v < 1;
    // (Or the way out of the junction has filled up since it booked: it waits at its line, out of
    // the junction, rather than stop in it in others' way.)
    // (A light just past the junction, closer than the car's length beyond its far mouth, that isn't
    // green: it would stop in the junction for it. Not one in step with this one along the street
    // between (signals.ts linkSignals): that turns green as this one's cross traffic does, so it
    // waits there harmlessly.)
    let redBeyond = false;
    const outArm = N.arms.findIndex((a) => a.street === n.to >> 1), outPhase = outArm >= 0 ? N.phaseOf[outArm] : -1;
    for (const [Q, o] of [[c.path, 0], [c.next, c.path.length]] as [Path | null, number][]) if (Q) for (const sg of Q.signals) {
      const at = o + sg.sLine - (off + n.sOut);
      if (sg.node !== n.node && at > -2 && at < c.kind.len + 3 && !(outPhase >= 0 && signalsInStep(N, outPhase, G.nodes[sg.node], sg.phase, seed)) && signalState(G.nodes[sg.node], sg.phase, simTime, seed, prs) !== "green") redBeyond = true;
    }
    // (Kept from going a good while by that light, theirs never green with its own: it goes anyway,
    // as drivers do, and waits at it with its tail in the junction. The while counted standing at
    // its own line through its red too, so it goes on its next green, not after greens' worth.)
    // (Rolling away from its line, not just creeping off it as its green comes and stopping for that
    // light again: else the while starts over on every green, never long enough to go on.)
    if (c.v > 0.5 && dLine > 2.5) c.beyondT = 0;
    else if (redBeyond && (sigOk || dLine < 2.5)) c.beyondT = (c.beyondT ?? 0) + SIM_DT;
    if ((c.beyondT ?? 0) > 15) redBeyond = false;
    const exitBlocked = redBeyond || this.boxBlocked(c) !== null;
    // (Nor while it holds at its line for the truck to go by: its turn comes after the truck's.)
    if (c.bk && rel + half < 0 && (!sigOk || (c.stillT > 2 && queued) || exitBlocked || c.truckHold)) c.bk = null;
    // (Turning, but still moved over out of its lane to pass something: not from there, across the
    // next lane; it waits at the line until it is back in it. Unless what it passes is parked at
    // the corner: then it swings wide round it, as drivers do.)
    // (Kept from its lane a while, it gives the turn up and goes straight on instead, where it can.)
    // (No way straight on, and still kept out after 4 s: it turns from where it is after all, its
    // booking starting from there, across the lane beside it.)
    const wide = n.move !== "S" && c.dodge < -1 && !c.passStill;
    if (wide && rel + half < 0 && !c.bk && c.stillT <= 4) {
      if (c.stillT > 1.5 && P === c.path && this.straightOn(c, G)) return this.junction(c, G, simTime, seed, prs);
      return line;
    }
    if (c.bk) return this.zoneStop(c, rel, line);
    const tooClose = dLine < c.v * c.v / 9 - 0.5;
    // (Its footprint from where it is, moved over or not: turning, easing back over as it goes
    // round; straight on, kept over, as a car passing or a cable car stays out across the junction.
    // But one swinging wide round something parked at the corner, from its lane.)
    const fp = () => this.footprint(P, n, c.dodge < -1 && !(n.move !== "S" && c.passStill) ? c.dodge : 0, n.move !== "S");
    if (sigOk && !exitBlocked && !queued && first && dLine < Math.max(30, c.v * 4)) { this.book(c, n, fp()); return this.zoneStop(c, rel, line); }
    if (sigOk && !exitBlocked && !queued && dLine < 2.5 && c.v < 4) { const f = fp(); if (!(N.control === "stop" && this.pedFirst(c, f)) && this.gapOk(c, n, f, rel, c.gapT ?? 2)) { this.book(c, n, f); return this.zoneStop(c, rel, line); } }
    // (Too close to stop and not booked, as on a light changing: in it goes, last in line.)
    if (tooClose && sigOk) { this.book(c, n, fp()); return this.zoneStop(c, rel, line); }
    return line;
  }
  // Where car c is to wait (an s, as giveWay's) short of where the truck reversing into a bay will
  // swing (its sweep: still obstacles marked sweep), or null: the first point in its next 30 m (on
  // along its next path too) that comes within the sweep, by the car's half width and 0.5 m, where
  // the car is across the road (moved over to pass or not). One already in it drives on out.
  private sweep: Obstacle[] = [];
  // People crossing the road (crowd.ts crossers): where each is and where their crossing ends.
  private crossers: number[] = [];
  private waiters: number[] = [];   // (crowd.ts waiters: x, z, x1, z1, t each)
  // At an all-way stop, someone at the kerb who has waited longer than car c has stood at its line
  // (for its first 10 s there), whose crossing its way through node n would come over (footprint
  // fp): they go first, and c waits its turn.
  private pedFirst(c: Car, fp: number[]): boolean {
    const W = this.waiters;
    if (!W.length || c.stillT > 10) return false;
    const w = c.kind.width / 2 + 1;
    for (let i = 0; i < W.length; i += 5) {
      if (W[i + 4] <= c.stillT || Math.abs(W[i] - fp[0]) > 40 || Math.abs(W[i + 1] - fp[1]) > 40) continue;
      for (let k = 0; k < fp.length; k += 2) if (segDist(fp[k], fp[k + 1], W[i], W[i + 1], W[i + 2], W[i + 3]) < w) return true;
    }
    return false;
  }
  // Where car c is to wait (an s, as giveWay's) for someone crossing ahead of it, or null: short
  // of the first point in its next 30 m (on along its next path too) on the stretch of crosswalk
  // they have still to cross, or close by them. Once they are past its lane, it goes on behind
  // them. A car already on the crosswalk goes on off it.
  private crosserWay(c: Car, half: number): number | null {
    const X = this.crossers;
    if (!X.length) return null;
    const w = c.kind.width / 2 + 0.7;
    for (let b = c.s + half; b <= c.s + 30; b += 1.5) {
      if (b <= c.path.length) c.path.peek(b, this.gw1);
      else if (c.next && b - c.path.length <= c.next.length) c.next.peek(b - c.path.length, this.gw1);
      else break;
      const x = this.gw1.x + Math.sin(this.gw1.h) * c.dodge, z = this.gw1.z + Math.cos(this.gw1.h) * c.dodge;
      for (let i = 0; i < X.length; i += 4) {
        if (Math.abs(X[i] - x) > 30 || Math.abs(X[i + 1] - z) > 30) continue;
        if (segDist(x, z, X[i], X[i + 1], X[i + 2], X[i + 3]) < w || Math.hypot(X[i] - x, X[i + 1] - z) < w + 0.8) return b === c.s + half ? null : b - 1.2;
      }
    }
    return null;
  }
  // Whether no vehicle would come over the crossing from (x0, z0) to (x1, z1) within secs s: its
  // way in its next 30 m comes within its half width and 1 m of the crossing, and it would get
  // there (at its speed, no less than 3 m/s) in time; or it is on it now.
  crossingClear(x0: number, z0: number, x1: number, z1: number, secs: number): boolean {
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, R = Math.hypot(x1 - x0, z1 - z0) / 2 + 45;
    for (const c of this.cars) {
      if (Math.abs(c.x - mx) > R || Math.abs(c.z - mz) > R) continue;
      const w = c.kind.width / 2 + 1, half = c.kind.len / 2;
      const dc = segDist(c.x, c.z, x0, z0, x1, z1);
      if (dc < w + half) return false;   // (on it, or its body over it)
      // (Standing short of it, waiting at a red or for someone crossing: it won't come, and giving
      // way to anyone out on the crossing, it waits for them if it does.)
      if (c.v < 0.5) continue;
      for (let b = c.s + half; b <= c.s + 30; b += 1.5) {
        if (b <= c.path.length) c.path.peek(b, this.gw0);
        else if (c.next && b - c.path.length <= c.next.length) c.next.peek(b - c.path.length, this.gw0);
        else break;
        if (segDist(this.gw0.x, this.gw0.z, x0, z0, x1, z1) < w) { if ((b - c.s - half) / Math.max(c.v, 3) < secs) return false; break; }
      }
    }
    return true;
  }
  private truckTurn = 0;
  private sweepWay(c: Car, half: number): number | null {
    if (!this.sweep.length) return null;
    const w = c.kind.width / 2 + 0.5;
    for (let b = c.s + half; b <= c.s + 30; b += 1.5) {
      if (b <= c.path.length) c.path.peek(b, this.gw1);
      else if (c.next && b - c.path.length <= c.next.length) c.next.peek(b - c.path.length, this.gw1);
      else break;
      // (Where the car will be across the road there: moved over to pass, it is out of its lane.)
      const x = this.gw1.x + Math.sin(this.gw1.h) * c.dodge, z = this.gw1.z + Math.cos(this.gw1.h) * c.dodge;
      for (const o of this.sweep) if (Math.hypot(o.x - x, o.z - z) < o.r + w) return b === c.s + half ? null : b - 1.2;
    }
    return null;
  }
  // The stop line of the node car c comes to next (within 30 m, not yet crossed) if its way
  // through is blocked: a car moving at under 1.5 m/s within 1.8 m of c's path from just past its
  // line, through the junction (one stopped part-way round a turn) and on as far as c would need
  // to be clear of it (its length and 2 m). Else null.
  private boxBlocked(c: Car): number | null {
    const p = c.path, n = this.nextNode(c);
    if (!n) return null;
    for (let b = n.sLine + 3; b <= n.sOut + c.kind.len + 2; b += 2) {
      const pp = b <= p.length ? p.peek(b, this.gw1) : c.next ? c.next.peek(b - p.length, this.gw1) : null;
      if (!pp) break;
      // (Not one that is itself waiting its turn at its line, in the junction's mouth.)
      for (const o of this.cars) if (o !== c && o.v < 1.5 && !(o.held && b < n.sOut) && Math.hypot(o.x - pp.x, o.z - pp.z) < 1.8) return n.sLine;
    }
    return null;
  }
  // Where car c is to stop for the next all-way stop on path P (P's s + off is c's), or null (none
  // within 30 m, or stopped at already, or too close to stop: then it goes on).
  private stopSign(c: Car, P: Path, off: number, half: number): number | null {
    for (const y of P.stops) {
      const target = y.sLine + off - 0.8 - half, dist = target - c.s;
      if (c.s > target + 0.5) { if (c.stopOk === y.node) c.stopOk = -1; continue; }   // (gone through: next time round it stops again)
      if (c.stopOk === y.node || dist > 30) return null;
      if (c.stillT > CAR_STOP_PAUSE && dist < 1.2) { c.stopOk = y.node; return null; }
      if (dist < c.v * c.v / 9 - 0.5) { c.stopOk = y.node; return null; }
      return target;
    }
    return null;
  }
  // The plan on from the end of path p (`a` along its last street): through the next node by a
  // move picked now, half the street after it at most; null where there is no way on.
  private planOn(G: CityGraph, p: Path, cable: boolean, a: number, mv = this.validMove(G, p.endEdge, cable)): Path | null {
    if (mv < 0) return null;
    const d = p.endEdge;
    return new Path(G, { d, before: G.faceLen(d) - a, edges: [mv], after: Math.min(30, G.faceLen(mv) / 2), lane: p.endLane });
  }
  // The dedge on from the end of dedge d, by a move picked at random, that stays on the city's
  // streets (a cable car: straight on along its tracks), or -1.
  // (Into a street with a way on again from its far end, where there is one: a street with none, a
  // dead end or one leading out of town, leaves a car nowhere to go but out of the world.)
  private validMove(G: CityGraph, d: number, cable: boolean): number {
    const ok = (e: number) => G.streets[e >> 1].inCity && (!cable || !!G.streets[e >> 1].tags.cable);
    const moves = G.movesFrom(d).filter((x) => ok(x.to));
    // (A way on two streets deep where there is one: one street deep only, a street whose only way
    // on is into a dead end would pass.)
    const on2 = moves.filter((x) => this.wayOn(G, x.to, cable, 2)), on1 = on2.length ? on2 : moves.filter((x) => this.wayOn(G, x.to, cable, 1));
    const from = on1.length ? on1 : moves;
    for (let k = 0; k < 4; k++) {
      const m = this.pickMove(cable), o = from.filter((x) => x.move === m);
      if (o.length) return o[Math.floor(this.rnd() * o.length)].to;
    }
    if (!cable) for (const m of ["S", "R", "L"] as Move[]) { const o = from.find((x) => x.move === m); if (o) return o.to; }
    return -1;
  }
  // Whether there is a way on from the far end of dedge e, `depth` streets deep, on the city's
  // streets (a cable car: straight on along its tracks).
  private wayOn(G: CityGraph, e: number, cable: boolean, depth: number): boolean {
    for (const y of G.movesFrom(e)) {
      const s = G.streets[y.to >> 1];
      if (s.inCity && (!cable || (!!s.tags.cable && y.move === "S")) && (depth <= 1 || this.wayOn(G, y.to, cable, depth - 1))) return true;
    }
    return false;
  }
  // Whether vehicle c is out of the truck's sight (vehicleUnseen), all of it:
  // where it may go without being seen to vanish. (No truck given, as in tests: always.)
  private eye: { x: number; z: number; h: number } | null = null;
  private unseen(G: CityGraph, c: Car, eye = this.eye) {
    if (!eye) return true;
    return vehicleUnseen(G, eye, c.x, c.z, c.h, c.kind.len, c.kind.width);
  }
  private pickMove(cable: boolean): Move {
    if (cable) return "S";
    const x = this.rnd();
    return x < 0.6 ? "S" : x < 0.85 ? "R" : "L";
  }

  // How far car c's circles, were it at s along its way and moved `dodge` across from its lane,
  // stand clear of the truck's (not of the way it is to back into a bay: sweepWay waits for that).
  // (Peeked, not evaluated: the path's cursor and lane offset stay where the car is. Nowhere near
  // the truck, not looked at all: every car asks every step.)
  private truckGap(c: Car, s: number, dodge: number, truck: Obstacle[]): number {
    const R = c.kind.len + 8;
    if (!truck.some((o) => !o.sweep && Math.abs(o.x - c.x) < R + o.r && Math.abs(o.z - c.z) < R + o.r)) return Infinity;
    c.path.peek(Math.min(s, c.path.length), this.pose);
    const h = this.pose.h, x = this.pose.x + Math.sin(h) * dodge, z = this.pose.z + Math.cos(h) * dodge, fx = Math.cos(h), fz = -Math.sin(h);
    const L = c.kind.len, n = Math.max(2, Math.ceil(L / (c.kind.width * 1.1))), step = L / n, r = Math.max(c.kind.width * 0.55, step * 0.55);
    let m = Infinity;
    for (const o of truck) {
      if (o.sweep || Math.abs(o.x - x) > L + 6 || Math.abs(o.z - z) > L + 6) continue;
      for (let i = 0; i < n; i++) { const q = -L / 2 + step * (i + 0.5); m = Math.min(m, Math.hypot(x + fx * q - o.x, z + fz * q - o.z) - r - o.r); }
    }
    return m;
  }
  // Whether car c, close beside the truck, comes clear of it (TRUCK_ROOM) within SLIDE_LOOK m on
  // along its way without touching it on the way.
  private slidesBy(c: Car, truck: Obstacle[]) {
    for (let a = 0.5; a <= SLIDE_LOOK; a += 0.5) {
      const g = this.truckGap(c, c.s + a, c.dodge, truck);
      if (g < 0) return false;
      if (g >= TRUCK_ROOM) return true;
    }
    return false;
  }
  // Drops any vehicle deep inside obstacles o[i0..i1) (a parked truck set down where it stood):
  // `fresh`, as it is set down; after that, only one out of the sight of `eye` (the truck where it is
  // now: this runs before step, which keeps its own), never seen to go.
  private dropC: Obstacle[] = [];
  dropInside(G: CityGraph, o: Obstacle[], i0: number, i1: number, fresh = true, eye: { x: number; z: number; h: number } | null = null) {
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i], C = this.dropC;
      let near = false;
      for (let k = i0; k < i1 && !near; k++) near = Math.hypot(o[k].x - c.x, o[k].z - c.z) < o[k].r + c.kind.len;
      if (!near) continue;
      C.length = 0; this.carCircles(c, C);
      if (C.some((p) => { for (let k = i0; k < i1; k++) if (Math.hypot(p.x - o[k].x, p.z - o[k].z) < p.r + o[k].r - DROP_DEEP) return true; return false; }) && (fresh || this.unseen(G, c, eye))) this.cars.splice(i, 1);
    }
  }
  // A vehicle as a row of circles about its own width, so long ones block their whole length
  // without reaching into the next lane (a bus's two big circles used to block the lanes
  // beside it and oncoming traffic).
  private carCircles(c: Car, out: Obstacle[]) {
    const fx = Math.cos(c.h), fz = -Math.sin(c.h), L = c.kind.len, n = Math.max(2, Math.ceil(L / (c.kind.width * 1.1)));
    const step = L / n, r = Math.max(c.kind.width * 0.55, step * 0.55);
    for (let i = 0; i < n; i++) { const q = -L / 2 + step * (i + 0.5); out.push({ x: c.x + fx * q, z: c.z + fz * q, r, owner: c.id }); }
  }
  // A true deadlock: following who is stopped behind whom from this car comes back to it (two
  // cars turning left across each other, a ring of cars round an intersection). The lowest id
  // in the ring goes, ignoring the car it is stuck behind; a queue at a red light ends at the
  // signal, not in a ring, so it waits as usual.
  private deadlockBlocker(c: Car, byId: Map<number, Car>): number {
    if (c.slowT < 3 || c.blockedBy < 0) return -1;
    let id = c.blockedBy, minId = c.id;
    for (let k = 0; k < 8; k++) {
      if (id === c.id) return c.id === minId ? c.blockedBy : -1;
      const o = byId.get(id);
      if (!o || o.blockedBy < 0 || o.slowT < 1) return -1;
      minId = Math.min(minId, id);
      id = o.blockedBy;
    }
    return -1;
  }

  private drive(c: Car, dt: number, plan: CityPlan, simTime: number, prs: SignalPreempt[], truck: Obstacle[], truckHeading: number, peds: Obstacle[], index: number, ignoreId = -1) {
    const p = c.path, half = c.kind.len / 2;
    // (And the turn after this path's end, planned already: on a short street it is close. Read
    // from where the car will be in 0.6 s too, as its speed follows the limit that far behind; and
    // from where it is, so a turn it is in still holds it to the end.)
    const sa = c.s + c.v * 0.6;
    let limit = Math.min(c.kind.vmax * (c.dV ?? 1), p.speedLimit(c.s, 2.5), p.speedLimit(sa, 2.5), c.next ? c.next.speedLimit(sa - p.length, 2.5) : Infinity);
    let hardStop = Infinity, signalBrake = 0;
    // (No way on past the end of its way, a rare dead end (validMove): it stops there, braking to
    // it, not driving on into nothing.)
    if (!c.next) { const end = p.length - 0.5, dist = end - c.s; limit = Math.min(limit, Math.sqrt(5 * Math.max(0, dist))); hardStop = end; }
    // Signals (the same rule as the truck: right on red after a pause). The next one ahead on this
    // path, or past its end the next node's: a path ends 30 m beyond its last node, so the next
    // stop line is only ~12 m into the next path, too late to stop from city speed. (Key
    // p.signals.length stands for that one; it becomes key 0 on the next path.)
    const G = plan.graph;
    let sg: { node: number; phase: number; sLine: number; move: string } | null = null, key = 0;
    for (; key < p.signals.length; key++) if (c.s <= p.signals[key].sLine - 0.8 - half + 0.5) { sg = p.signals[key]; break; }
    if (!sg) {
      // (From the next path, planned already, where it has one: its own line; else reckoned from the
      // street.)
      const e = p.endEdge, N = G.nodes[G.dedgeTo(e)], ai = G.armIndexIn(e), ns = c.next?.signals[0];
      if (ns && ns.node === N.id) sg = { node: ns.node, phase: ns.phase, sLine: p.length + ns.sLine, move: ns.move };
      else if (N.control === "signal") sg = { node: N.id, phase: N.phaseOf[ai], sLine: p.length + G.faceLen(e) - p.endA - N.arms[ai].mouth - STOP_BACK, move: "?" };
    }
    if (sg) {
      const target = sg.sLine - 0.8 - half, dist = target - c.s;
      const state = signalState(G.nodes[sg.node], sg.phase, simTime, plan.seed, prs);
      if (state === "green") { if (c.stopFor === key) c.stopFor = -1; }
      else if (c.committed !== key) {
        if (state === "red" && sg.move === "R" && !c.cable && c.stillT > 1.2 && dist < 1.2) c.committed = key;
        // Stop if it can (about 4.5 m/s^2 at most); once stopping for a light it never changes its
        // mind and runs it.
        else if (c.stopFor === key || dist >= c.v * c.v / 9 - 0.5) {
          c.stopFor = key;
          limit = Math.min(limit, Math.sqrt(5 * Math.max(0, dist))); hardStop = Math.min(hardStop, target);
          signalBrake = c.v * c.v / (2 * Math.max(dist, 0.1));
        } else c.committed = key;   // too close to stop: go through
      }
    }
    // The junction ahead: booked through it (or waiting at the line for its turn to book), and
    // short of where an earlier booking is still crossing its way.
    const box = this.junction(c, G, simTime, plan.seed, prs);
    c.held = box !== null && !c.bk;
    if (box !== null) {
      const target = box - 0.8 - half, dist = target - c.s;
      if (dist >= c.v * c.v / 9 - 0.5) { limit = Math.min(limit, Math.sqrt(5 * Math.max(0, dist))); hardStop = Math.min(hardStop, target); signalBrake = Math.max(signalBrake, c.v * c.v / (2 * Math.max(dist, 0.1))); }
      // (Booked and in the junction, short of a car still crossing its way: it stops, hard if it
      // must; rolling on would take it into the other.)
      else if (c.bk && dist > -1) { limit = Math.min(limit, Math.sqrt(5 * Math.max(0, dist))); hardStop = Math.min(hardStop, Math.max(target, c.s)); signalBrake = Math.max(signalBrake, Math.min(7, c.v * c.v / (2 * Math.max(dist, 0.1)))); }
    }
    // The truck coming in at the gate, landing off an exit ramp or pulling out of a bay across this
    // car's way, or reversing into one, or someone crossing ahead: wait short of it, unless too
    // close to stop. (At junctions the truck is in the bookings.)
    const gw = this.giveWay(c) ?? this.landingWay(c, half) ?? this.sweepWay(c, half) ?? this.crosserWay(c, half);
    c.truckHold = gw !== null;
    if (gw !== null) {
      // (Creeping at the line, it can still stop there.)
      const target = gw - 0.8 - half, dist = target - c.s;
      // (Braking as for a red light, firmly enough to stop there: the eased limit alone trails it.)
      if (dist >= c.v * c.v / 9 - 0.5 || (c.v < 2 && dist > -1.5)) { limit = Math.min(limit, Math.sqrt(5 * Math.max(0, dist))); hardStop = Math.min(hardStop, Math.max(target, c.s)); signalBrake = Math.max(signalBrake, c.v * c.v / (2 * Math.max(dist, 0.1))); }
    }
    // An all-way stop ahead (on this path, or past its end on the next): a full stop at the line,
    // a second's pause, then on when its turn to book the junction comes (junction, above, keeps it
    // there). Too close to stop: it rolls on through.
    const sgn = this.stopSign(c, p, 0, half) ?? (c.next ? this.stopSign(c, c.next, p.length, half) : null);
    // (Braking as for a red light: at least what ends at the line, or the eased limit trails it.)
    if (sgn !== null) { limit = Math.min(limit, Math.sqrt(5 * Math.max(0, sgn - c.s))); hardStop = Math.min(hardStop, sgn); signalBrake = Math.max(signalBrake, c.v * c.v / (2 * Math.max(sgn - c.s, 0.1))); }
    // A roundabout ahead: give way at its line while anything is moving round the ring near the
    // entry (the truck too); once on it, carry on. (On the ring: a car whose street is the ring, or
    // that is turning onto it, but not one coming off it here or gone on past it, nor one out on the
    // approaches; the truck unless it is parked.)
    for (const y of p.yields) {
      const target = y.sLine - 0.8 - half, dist = target - c.s;
      if (c.s > target + 0.5) continue;
      if (dist > 25) break;
      const N = G.nodes[y.node];
      let busy = false;
      for (const o of this.cars) {
        if (o === c || o.v <= 1 || Math.hypot(o.x - N.x, o.z - N.z) >= 16) continue;
        // (By the junction it is at or coming to: on a way through more than one (from older
        // saves), not necessarily its first.)
        const r = o.path.route, ns = o.path.nodes;
        let k = ns.findIndex((q) => q.sOut > o.s);
        if (k < 0) k = ns.length - 1;
        const from = k > 0 ? ns[k].from : r.d, to = k > 0 ? ns[k].to : r.edges.length ? r.edges[0] : -1;
        const into = k > 0 ? ns[k].sLine + (r.before - ns[0].sLine) : r.before;   // (where it is into the junction: as far past its line as the first's mouth is)
        const onRing = !!G.streets[from >> 1].ring, joining = to >= 0 && !!G.streets[to >> 1].ring;
        if (!onRing && !joining) continue;                       // out on an approach street
        if (G.dedgeTo(from) === y.node && (!joining || o.s > into)) continue;   // coming off the ring here, or gone on past
        busy = true; break;
      }
      if (!busy) for (const o of truck) if (!o.still && Math.hypot(o.x - N.x, o.z - N.z) < 14) { busy = true; break; }   // (not parked)
      if (busy && dist >= c.v * c.v / 9 - 0.5) { limit = Math.min(limit, Math.sqrt(5 * Math.max(0, dist))); hardStop = Math.min(hardStop, target); }
      break;
    }
    // What's ahead in this lane: other vehicles, the truck, pedestrians.
    // (Judged along the street, not the car's own heading: easing across lanes after a turn, that
    // points at the kerb, and a truck parked in the kerb lane would seem to be dead ahead.)
    const turningNow = Number.isNaN(p.lastOffset), hr = turningNow ? c.h : p.lastLineH;
    const fx = Math.cos(hr), fz = -Math.sin(hr), lx = -fz, lz = fx;   // forward, right
    let gap = Infinity, truckBehind = Infinity, otherLaneBlocked = false, stillAhead = Infinity, gapOwner = -1, gapPed = false, truckAhead = Infinity, gapV = 0;
    const look = 10 + c.v * 2.4;   // far enough to stop comfortably from city speed
    // The lane we'd move into: the inner lane 3 m to the left, or back to the kerb lane. (`side`
    // below is measured to the right: (lx, lz) points right of the heading.)
    const otherLane = c.dodge < -1.5 ? 3 : -3;
    const reach = Math.max(look, 45) + half + 12;   // nothing further away matters
    // (Where the path takes the car sideways over the next dAhead m, as a lane change for a turn
    // ahead does: the truck in the lane it is moving into is ahead of it too.)
    const dAhead = Math.max(8, c.v * 1.6), pe = turningNow ? null : p.peek(Math.min(c.s + dAhead, p.length), this.gw1);
    // (Its path's lane, not where it has moved over to: kept over, it stays there.)
    const latAhead = pe ? (pe.x - c.x) * lx + (pe.z - c.z) * lz + c.dodgeTarget : 0;
    const sameDirT = Math.cos(truckHeading - c.h) > 0.7;
    // (Caught inside where the truck will reverse already: none of that sweep holds it, ahead or
    // not; it drives on out, and the truck waits for it.)
    let inSweep = false;
    // (Any of its body, as the truck reversing sees it: street life's reverseBlocked.)
    const hx = fx * half, hz = fz * half;
    for (const o of this.sweep) if (segDist(o.x, o.z, c.x - hx, c.z - hz, c.x + hx, c.z + hz) < o.r + c.kind.width / 2 + 0.2) { inSweep = true; break; }
    const scan = (o: Obstacle, isTruck: boolean, ped = false) => {
      // (Not a car waiting short of a junction zone for this one to go by: by its booking, it is
      // clear of this one's way.)
      // (Though in the lane beside, the one this car would move back into, it is still there: this
      // one doesn't move over onto it.)
      const rx = o.x - c.x, rz = o.z - c.z;
      if (rx > reach || rx < -reach || rz > reach || rz < -reach) return;
      const along = rx * fx + rz * fz, side = rx * lx + rz * lz;
      if (!isTruck && !ped && o.owner !== undefined && this.byId.get(o.owner)?.waitFor === c.id) {
        if (Math.abs(along) < half + 8 && Math.abs(side - otherLane) < 1.5 + o.r * 0.5) otherLaneBlocked = true;
        return;
      }
      const standingO = !isTruck && !ped && (this.byId.get(o.owner ?? -1)?.v ?? 9) < 1;
      // (Where the truck reversing into a bay will be: ahead, kept clear of; level with or over
      // the car already, driven on out of before it comes.)
      if (o.sweep && (inSweep || along <= half + o.r)) return;
      // Pulling out round a parked truck: judged from where the car will be by the time it gets
      // there (easing over at 0.6 m/s on average: it starts slowly), so it keeps rolling as it
      // eases out instead of stopping and sliding sideways, but doesn't reach the truck still
      // half in its lane: within 1.2 s of it, only where it is now counts.
      const reachT = Math.max(0, along - half - o.r) / Math.max(c.v, 0.5);
      const sideEff = o.still && c.dodgeTarget < c.dodge - 0.1 && reachT > 1.2 ? side - Math.max(c.dodgeTarget - c.dodge, -0.6 * (reachT - 1.2)) : side;
      // (Sideways, the truck's circles are wider than its body: passing it in the next lane, its
      // real half-width counts.)
      // (A parked truck is passed with a little room to spare.)
      const rLat = isTruck ? Math.min(o.r, 1.3) + (o.still ? 0.25 : 0) : o.r + 0.2;
      // (The truck about to turn, a car beside it on the side it turns to (into the inner lane for
      // a left, its rear across the kerb lane for a right), the truck's nose ahead of the car's
      // middle: it treats it as in its lane and drops back behind it. Further ahead than that, it
      // goes on, and the truck waits for it: street life's truckStop.) (Both standing, the car beside
      // it already: it goes on past, as the truck waits for it; neither would ever move first.)
      const bothStill = c.v < 0.1 && Math.abs(this.truckPath?.v ?? 0) < 0.1;
      if (isTruck && !o.still && !bothStill && this.truckTurn !== 0 && side * this.truckTurn > 0 && Math.abs(side) < 4.5 && along > 0 && Math.abs(along) <= half + o.r && sameDirT) { gap = Math.min(gap, 0.5); truckAhead = Math.min(truckAhead, 0.5); }
      // (A parked truck alongside, not yet clear of it sideways: held there while it eases out.)
      if (o.still && Math.abs(along) <= half && Math.abs(side) < rLat + c.kind.width * 0.5) { gap = Math.min(gap, 0.5); truckAhead = Math.min(truckAhead, 0.5); }
      // (Something standing beside it, a parked truck or a car, that its body would swing into as
      // it turns on: a long vehicle's tail swings out round a turn. It waits rather than clip it.)
      // (Not a car itself waiting on this one: one of the two goes first.)
      if (!ped && !o.sweep && (o.still || (standingO && this.byId.get(o.owner ?? -1)?.blockedBy !== c.id)) && Math.abs(along) <= half + o.r + 1 && Math.abs(side) < c.kind.width / 2 + o.r + 3 && this.swingsInto(c, o, half)) { gap = Math.min(gap, 0.5); if (isTruck) truckAhead = Math.min(truckAhead, 0.5); else gapOwner = o.owner ?? -1; }
      // (Moving over into another lane: what's in it ahead counts where the car is going, a truck,
      // or a car standing there.)
      const standing = standingO;
      const sideLane = (isTruck || standing) && Math.abs(latAhead) > 0.5 ? side - latAhead * Math.min(1, Math.max(0, along) / dAhead) : sideEff;
      // (Turning, judged along the car's own way round, not its heading: a car stopped further
      // round the curve sits off to the side of the heading, but on the way.)
      let onWay = false;
      if (turningNow && !ped && along > half && along < look + o.r) { const q = p.peek(Math.min(c.s + along, p.length), this.gw1); onWay = Math.hypot(o.x - q.x, o.z - q.z) < rLat + c.kind.width * 0.5; }
      // (A car alongside, or the truck, level or ahead, in the lane this one's path is moving it
      // into: it waits, so the other goes on by, and then moves over behind it.)
      if (!ped && !o.sweep && Math.abs(latAhead) > 0.5 && Math.sign(side) === Math.sign(latAhead) && Math.abs(side) > 0.8 && along > -0.5 && along <= half + o.r && Math.abs(side - latAhead) < rLat + c.kind.width * 0.5 && o.owner !== ignoreId && 0.5 < gap) { gap = 0.5; gapOwner = o.owner ?? -1; }
      // (And the truck coming up close behind in that lane, moving: the car doesn't move over across
      // its nose, which can't stop in the room left (seed 2539665337's city 16: a van moving over to
      // turn, its tail swinging into the truck's nose). It waits, and moves over once the truck has
      // gone by.)
      if (isTruck && !o.still && Math.abs(this.truckPath?.v ?? 0) > 0.3 && Math.abs(latAhead) > 0.5 && Math.sign(side) === Math.sign(latAhead) && Math.abs(side) > 0.8 && along <= -0.5 && -along - half - o.r < TRUCK_CUT_ROOM + Math.abs(this.truckPath?.v ?? 0) * 1.5 && Math.abs(side - latAhead) < rLat + c.kind.width * 0.5 && sameDirT && 0.5 < gap) { gap = 0.5; truckAhead = Math.min(truckAhead, 0.5); }
      // (Turning, straight ahead of its heading is off its way but for just in front of it.)
      const inLine = (Math.abs(sideEff) < rLat + c.kind.width * 0.5 || Math.abs(sideLane) < rLat + c.kind.width * 0.5) && (!turningNow || ped || along < half + o.r + 1.5);
      if (along > half && along < look + o.r && (onWay || inLine) && o.owner !== ignoreId) {
        const g = along - half - o.r;
        if (g < gap) { gap = g; gapOwner = o.owner ?? -1; gapPed = ped; gapV = ped || o.still ? 0 : isTruck ? Math.abs(this.truckPath?.v ?? 0) : (this.byId.get(o.owner ?? -1)?.v ?? 0); }
        if (isTruck) truckAhead = Math.min(truckAhead, g);
      }
      // (Or coming up behind in it, faster: in the mirror, 3 s off at most. Or coming the other way
      // in it, as in the oncoming lane: 3 s off at their speed and this one's.)
      const oc = ped || o.still ? undefined : isTruck ? null : this.byId.get(o.owner ?? -1);
      const ov = oc === undefined ? 0 : oc === null ? Math.abs(this.truckPath?.v ?? 0) : oc.v;
      const oncoming = oc === null ? Math.cos(truckHeading - c.h) < -0.5 : !!oc && Math.cos(oc.h - c.h) < -0.5;
      if (along < half + 8 + (oncoming ? (ov + c.v) * 3 : 0) && along > -(half + 8 + (oncoming ? 0 : Math.max(0, ov - c.v) * 3)) && Math.abs(side - otherLane) < 1.5 + o.r * 0.5) otherLaneBlocked = true;
      // (The truck behind: the gap from its front to this car's back.)
      if (isTruck && along < -half && along > -45 && Math.abs(side) < 2) truckBehind = Math.min(truckBehind, -along - half - o.r);
      // A truck parked in this lane (double-parked at a stop): seen well before reaching it.
      if (o.still && along > half && along < 45 + o.r && Math.abs(side) < o.r + c.kind.width * 0.5 + 0.6) stillAhead = Math.min(stillAhead, along - half - o.r);
    };
    for (const o of truck) scan(o, true);
    const obs = this.obstacles;
    for (let k = 0; k < obs.length; k++) if (obs[k].owner !== c.id) scan(obs[k], false);
    // Pedestrians: someone standing at the edge of the lane (waiting to cross) holds a car up
    // for a few seconds at most, then it edges past; they never wait on each other for good.
    if (c.pedT < 5) for (const o of peds) scan(o, false, true);
    // The truck behind, heading our way: move over if we can.
    const sameDir = Math.cos(truckHeading - c.h) > 0.7;
    // (Through a junction straight on, the path has no lane offset either, but the car keeps to its
    // lane: only a turn takes it back to the path.)
    const inNode = p.nodes.find((x) => c.s >= x.sLine && c.s <= x.sOut);
    const turning = Number.isNaN(p.lastOffset) && (!inNode || inNode.move !== "S"), laneChanging = !Number.isNaN(p.lastOffset) && Math.abs(p.lastOffset - LANE_KERB) > 0.1;
    let rightSoon = false;
    for (const t of p.turns) if (t.dir === 1 && t.s - c.s < 30 && t.s > c.s) rightSoon = true;
    // Which way the path's lane offset last moved: up means easing from the inner lane back to
    // the kerb lane (after a turn), which is the wrong way with a truck parked ahead.
    const off = turning ? LANE_INNER : Number.isNaN(p.lastOffset) ? (c.lastO ?? LANE_KERB) : p.lastOffset;
    if (Math.abs(off - (c.lastO ?? off)) > 1e-4) c.mergeUp = off > (c.lastO ?? off);
    c.lastO = off;
    const merging = laneChanging && !!c.mergeUp;
    // The truck in this lane close ahead (moving slowly or stopped): pass it now rather than queue.
    const truckClose = truckAhead < 14 && sameDirT;   // (not one coming the other way)
    if (!c.cable && merging && (stillAhead < 40 || truckClose)) {
      // Coming out of a turn in the inner lane with a parked truck
      // ahead in the kerb lane: stay in the inner lane rather than merge in behind it, then pass.
      c.dodgeTarget = THREE.MathUtils.clamp(-(p.lastOffset - LANE_INNER), -3, 0); c.holdT = 4;
      // (Taken at once: it only cancels the path's own easing back to the kerb, so the car isn't
      // moving sideways at all. Eased, it lags and the car drifts toward the truck.)
      if (c.dodge >= c.dodgeTarget) { c.dodge = c.dodgeTarget; c.dodgeV = 0; }
    } else if (!c.cable) {
      // (A right turn just ahead keeps a car in the kerb lane, but not with the truck stopped in it
      // short of the corner: then it pulls round the truck and swings wide into the turn.)
      const passTruck = stillAhead < 35 || truckClose;
      // (Back over to the kerb lane only when it is clear alongside: else it stays out, in its own
      // lane, until there is a gap.)
      if ((laneChanging || turning || (rightSoon && !passTruck)) && c.dodge < -1.5 && otherLaneBlocked && !turning) c.dodgeTarget = c.dodge;
      else if (laneChanging || turning || (rightSoon && !passTruck)) c.dodgeTarget = 0;
      else if ((sameDir && truckBehind < 40 && this.truckTurn !== 1) || stillAhead < 35 || truckClose || (gap < 12 && c.stillT > 1.5)) { if (c.dodge < -1.5 || !otherLaneBlocked) { c.dodgeTarget = -3; c.holdT = 4; } }
      else if ((c.holdT -= dt) <= 0 && (c.dodge > -1.5 || !otherLaneBlocked)) c.dodgeTarget = 0;
    }
    if ((globalThis as any).TRAFFIC_DEBUG && gap < 4 && gapOwner < 0 && !gapPed && c.stillT > 4 && Math.floor(c.stillT * 10) % 20 === 0) (globalThis as any).TRAFFIC_DEBUG({ id: c.id, stillT: c.stillT, stillAhead, rightSoon, laneChanging, turning, merging, otherLaneBlocked, dodge: c.dodge, dodgeTarget: c.dodgeTarget, cable: c.cable, signal: hardStop < (c.next ? Infinity : p.length - 0.5), gap, cx: c.x, cz: c.z, ch: c.h, v: c.v, s: c.s, plen: p.length });
    // Speed, as a driver keeps it (the Intelligent Driver Model): towards the limit (the road's, a
    // turn's, a stop ahead's), easing off as it nears it, and behind whatever is ahead keeping its
    // own time gap and standing gap, closing slower on one going slower. Each driver has their own
    // (spawn). Only an overlap stops a car dead.
    {
      const A = c.dA ?? 1.8, B = c.dB ?? 2.4, v0 = Math.max(0.1, limit);
      let want = A * (1 - (c.v / v0) ** 4);
      if (gap < Infinity) {
        if (gap < -1) hardStop = Math.min(hardStop, c.s);
        const sStar = (c.dS0 ?? 2) + Math.max(0, c.v * (c.dT ?? 1.4) + c.v * (c.v - gapV) / (2 * Math.sqrt(A * B)));
        want -= A * (sStar / Math.max(gap, 0.2)) ** 2;
      }
      want = THREE.MathUtils.clamp(want, -8, A);
      // (No instant changes in braking: the pedal moves at up to 9 m/s^3; stamped on, faster, when
      // something cuts in close ahead.)
      const stamp = want < c.acc - 3 && gap < c.v * 1.2 + 3 ? 30 : 9;
      c.acc += THREE.MathUtils.clamp(want - c.acc, -stamp * dt, 9 * dt);
      if (gap < 0.4 && c.v > 0) c.acc = Math.min(c.acc, -8);   // cut in on: a hard stop, but not a dead one
      // Stopping for a light: at least the braking that ends at the line (the eased pedal above
      // trails the stop and would reach it still rolling).
      if (signalBrake > 1.5) c.acc = Math.min(c.acc, -Math.min(signalBrake, 7));
      c.v = Math.max(0, c.v + c.acc * dt);
      if (c.v === 0 && c.acc < 0) c.acc = 0;
    }
    let ds = c.v * dt;
    // (Moved over off its lane's line round a curve, its own line is longer or shorter than the
    // lane's by its offset times the turn: it goes along the lane that much slower or faster, so the
    // car itself keeps the speed it has, not swinging wide round a corner faster than it drives.)
    if (ds > 0 && Math.abs(c.dodge) > 0.05 && c.s + 1 <= p.length) {
      const h0 = p.peek(c.s, this.gwS).h, h1 = p.peek(c.s + 1, this.gwS).h;
      ds /= THREE.MathUtils.clamp(1 + c.dodge * Math.atan2(Math.sin(h1 - h0), Math.cos(h1 - h0)), 0.5, 2);
    }
    if (c.s + ds > hardStop) { ds = Math.max(0, hardStop - c.s); c.v = 0; }
    // (Never on into the truck, whatever it has misjudged: a step that would take any of it into
    // the truck's body, or nearer it once there, swinging its tail round a turn beside it, cutting
    // across its nose, it doesn't take. It waits where it is till there is room. (Unless it is only
    // sliding by, close beside it, its way opening out again a little on without touching it.)
    if (ds > 0) {
      const g1 = this.truckGap(c, c.s + ds, c.dodge, truck);
      if (g1 < Math.min(TRUCK_ROOM, this.truckGap(c, c.s, c.dodge, truck)) && !(g1 >= 0 && this.slidesBy(c, truck))) { ds = 0; c.v = 0; c.acc = 0; }
    }
    c.s += ds; c.odo = (c.odo ?? 0) + ds;
    c.stillT = c.v < 0.05 ? c.stillT + dt : 0;
    c.slowT = c.v < 0.5 ? c.slowT + dt : 0;
    c.blockedBy = gap < 3 ? gapOwner : -1;
    c.pedT = gap < 3 && gapPed ? c.pedT + dt : c.v > 2 ? 0 : c.pedT;
    c.passStill = stillAhead < 35;
    // Ease across: the sideways rate builds and fades gently and is tied to forward speed, so a
    // lane change takes 12-15 m of road at speed, and a stopped car eases out more slowly.
    {
      const rate = Math.min(1.4, 0.2 * c.v + 0.6);
      const want = THREE.MathUtils.clamp(1.6 * (c.dodgeTarget - c.dodge), -rate, rate);
      c.dodgeV += THREE.MathUtils.clamp(want - c.dodgeV, -1.2 * dt, 1.2 * dt);
      const d0 = c.dodge;
      c.dodge += c.dodgeV * dt;
      // (In a lane: settled. One coming over from beyond the next lane, a cable car crossing over to
      // its own track turned round at the end of its line (turnRound), settles as it gets there.)
      if ((d0 >= -3 && c.dodge <= -3) || (d0 <= 0 && c.dodge >= 0) || (d0 < -3 && c.dodge >= -3)) { c.dodge = THREE.MathUtils.clamp(c.dodge, -3, 0); c.dodgeV = 0; }
      // (Not sideways into the truck, or anything of it standing: moving back over with the truck
      // alongside, it waits till there is room.)
      if (c.dodge !== d0 && this.truckGap(c, c.s, c.dodge, truck) < Math.min(TRUCK_ROOM, this.truckGap(c, c.s, d0, truck))) { c.dodge = d0; c.dodgeV = 0; }
    }
    // Next intersection: plan on from the end of this path.
    let turned = false;
    if (c.s >= p.length - 0.5 - 1e-6) {
      // (From where the car is, by the move already picked for the next plan; then the one after.)
      const past = p.endA - (p.length - c.s);
      // (With no next plan there is no way on: validMove found none from this street's end, and
      // would find none again.)
      const now = c.next ? this.planOn(G, p, c.cable, past, c.next.route.edges[0]) : null;
      // (No way on, a rare dead end: gone, out of sight; in sight, it stands at the end of its way,
      // where it braked to a stop (drive, endStop), till it is out of sight.)
      // (A cable car, after a layover there (CABLE_LAYOVER), turns round to go back along its line on
      // the other track: turnRound.)
      if (!now) {
        if (this.unseen(G, c)) { this.cars.splice(index, 1); return; }
        c.v = 0; c.acc = 0;
        // (Tried again every couple of seconds where it can't, not every step.)
        if (c.cable && c.stillT > CABLE_LAYOVER && Math.floor((c.stillT - CABLE_LAYOVER) / 2) !== Math.floor((c.stillT - dt - CABLE_LAYOVER) / 2) && this.turnRound(G, c)) turned = true;
      } else {
        const next = p.signals.length;   // the next node's signal, already judged from this path
        c.path = now; c.next = this.planOn(G, now, c.cable, now.endA);
        c.s = 0; c.committed = c.committed === next ? 0 : -1; c.stopFor = c.stopFor === next ? 0 : -1;
      }
    }
    c.path.eval(c.s, this.pose);
    const h = this.pose.h;
    c.x = this.pose.x + Math.sin(h) * c.dodge; c.z = this.pose.z + Math.cos(h) * c.dodge;   // negative dodge: to the left
    c.h = h;
    // (Turned round, its two ends alike: drawn so from this step on, not swung round between them.)
    if (turned) { c.px = c.x; c.pz = c.z; c.ph = c.h; }
  }
  // Cable car c, standing at the end of its line, turned round to go back along it on the other
  // track (its two ends alike): its way from where it stands back along the street it is on, the
  // way it came, crossing over to that track as it pulls away (from the next lane over and more).
  // Whether it could be.
  private turnRound(G: CityGraph, c: Car): boolean {
    const p = c.path, e = p.endEdge, a = p.endA - (p.length - c.s), back = e ^ 1;
    const mv = this.validMove(G, back, true);
    if (mv < 0) return false;
    const path = new Path(G, { d: back, before: a, edges: [mv], after: Math.min(30, G.faceLen(mv) / 2), lane: p.endLane });
    const o = p.peek(c.s, this.gw0), ox = o.x, oz = o.z, q = path.peek(0, this.gw1);
    // (Where it stands, across the new way's lane: its sideways turned round with it.)
    const dodge = -c.dodge + (ox - q.x) * Math.sin(q.h) + (oz - q.z) * Math.cos(q.h);
    if (dodge < -9 || dodge > 0.05 || Math.abs(Math.cos(q.h - o.h) + 1) > 0.05) return false;
    c.path = path; c.next = this.planOn(G, path, true, path.endA); c.s = 0; c.bk = null; c.committed = -1; c.stopFor = -1;
    c.dodge = Math.min(0, dodge); c.dodgeTarget = -3; c.dodgeV = 0; c.stillT = 0;
    return true;
  }

  // Headlight patches on the road ahead of the vehicles nearest `at` (atmosphere.ts HEAD_LIGHTS),
  // into out[from..]; the rest are switched off.
  headlights(out: THREE.Vector4[], from: number, at: { x: number; z: number }, ys: number[]) {
    const d = this.drawn, order: number[] = [];
    for (let i = 0; i < d.length; i += 4) if (Math.hypot(d[i] - at.x, d[i + 1] - at.z) < 120) order.push(i);
    order.sort((a, b) => Math.hypot(d[a] - at.x, d[a + 1] - at.z) - Math.hypot(d[b] - at.x, d[b + 1] - at.z));
    for (let k = from; k < out.length; k++) {
      const i = order[k - from];
      if (i === undefined) { out[k].w = 0; continue; }
      const h = d[i + 2], ahead = d[i + 3] + 5;
      out[k].set(d[i] + Math.cos(h) * ahead, d[i + 1] - Math.sin(h) * ahead, h, 0.7); ys[k] = 0;   // (town traffic keeps to the streets)
    }
  }

  // Test renders (main.ts DEBUG_VIEW "traffic"): the vehicle (not a Ryder truck) nearest (x, z),
  // or one by its id, as it stands: where, its heading and length.
  vehicleNear(x: number, z: number): number { let best = -1, bd = Infinity; for (const c of this.cars) { if (c.model) continue; const d = Math.hypot(c.x - x, c.z - z); if (d < bd) { bd = d; best = c.id; } } return best; }
  vehiclePose(id: number): { x: number; z: number; h: number; len: number } | null { const c = this.cars.find((o) => o.id === id); return c ? { x: c.x, z: c.z, h: c.h, len: c.kind.len } : null; }

  // A storybook contraption's parts, posed (storyvehicles.ts) and placed by `base`.
  private material: THREE.Material;
  // A contraption's parts as instanced meshes, made the first time (its first part's pure white
  // apart, tinted per vehicle).
  private rigMeshesOf(k: VehicleKind) {
    if (k.rigMeshes) return k.rigMeshes;
    const meshes: { mesh: THREE.InstancedMesh; part: number; tint: boolean }[] = [];
    k.rig!.parts.forEach((build, part) => {
      const b = new Batch(); build(b);
      const g = b.build(this.material)!.geometry;
      (part === 0 ? splitWhite(g) : [g, null]).forEach((geo, i) => {
        if (!geo) return;
        const mesh = new THREE.InstancedMesh(geo, this.material, k.cap + LIFT_CAP);
        mesh.count = 0; mesh.frustumCulled = false; mesh.visible = false;
        for (let j = 0; j < k.cap + LIFT_CAP; j++) mesh.setColorAt(j, this.col.set(0xffffff));
        this.scene.add(mesh); meshes.push({ mesh, part, tint: i === 1 });
      });
    });
    return (k.rigMeshes = meshes);
  }
  private rigPose: THREE.Matrix4[] = Array.from({ length: 16 }, () => new THREE.Matrix4());
  private rigM = new THREE.Matrix4();
  private drawRig(k: VehicleKind, base: THREE.Matrix4, s: { odo: number; v: number; t: number; seed: number }, color: number) {
    k.rig!.pose(s, this.rigPose);
    for (const r of this.rigMeshesOf(k)) {
      if (r.mesh.count >= r.mesh.instanceMatrix.count) continue;
      const i = r.mesh.count++;
      r.mesh.setMatrixAt(i, this.rigM.multiplyMatrices(base, this.rigPose[r.part]));
      r.mesh.setColorAt(i, this.col.set(r.tint ? color : 0xffffff));
    }
  }

  // Write instance matrices and colours, `alpha` of the way from the last step's poses to these.
  draw(alpha: number) {
    for (const k of this.kinds) { if (k.mesh) k.mesh.count = 0; if (k.rigMeshes) for (const r of k.rigMeshes) r.mesh.count = 0; }
    let beacon = 0;
    const live = new Set<number>();
    this.drawn.length = 0;
    for (const c of this.cars) {
      const x = c.px + (c.x - c.px) * alpha, z = c.pz + (c.z - c.pz) * alpha;
      // Drawn pointing where it is going: angled into a lane change (the lane's heading is kept for driving).
      const h = c.ph + Math.atan2(Math.sin(c.h - c.ph), Math.cos(c.h - c.ph)) * alpha + THREE.MathUtils.clamp(Math.atan2(-c.dodgeV, Math.max(c.v, 1.5)), -0.25, 0.25);
      if (!c.cable) this.drawn.push(x, z, h, c.kind.len / 2);
      this.q.setFromEuler(this.e.set(0, h, 0));
      if (c.model) {
        let g = this.groups.get(c.id);
        if (g && g.userData.model !== c.model) { this.release(g); this.groups.delete(c.id); g = undefined; }   // ids restart in each city
        if (g && (g.userData.toon ?? 0) !== this.ryderToon) { this.release(g); this.groups.delete(c.id); g = undefined; }
        if (!g) { g = this.spare.get(`${c.model}/${this.ryderToon}`)?.pop() ?? this.ryder?.(c.model, this.ryderToon) ?? undefined; if (!g) continue; g.userData.model = c.model; g.userData.toon = this.ryderToon; this.scene.add(g); this.groups.set(c.id, g); }
        live.add(c.id);
        g.position.set(x, 0, z); g.rotation.set(0, h, 0); g.position.addScaledVector(this.v3.set(Math.cos(h), 0, -Math.sin(h)), -3.0);   // the model's origin is its rear axle
        continue;
      }
      if (c.kind.rig) {
        const odo = (c.podo ?? 0) + ((c.odo ?? 0) - (c.podo ?? 0)) * alpha;
        this.drawRig(c.kind, this.m4.compose(this.v3.set(x, 0, z), this.q, this.one), { odo, v: c.v, t: this.time, seed: c.id * 0.37 }, c.color);
        continue;
      }
      const mesh = c.kind.mesh!;
      const i = mesh.count++;
      mesh.setMatrixAt(i, this.m4.compose(this.v3.set(x, 0, z), this.q, this.one));
      mesh.setColorAt(i, this.col.set(c.color));
      if (c.kind.id === "police" && beacon < 4) {
        for (const side of [-0.32, 0.32]) {
          const on = Math.floor(this.time * 6 + (side > 0 ? 1 : 0)) % 2 === 0;
          const off = this.v3.set(-0.35, 1.6, side).applyQuaternion(this.q);
          this.beacons.setMatrixAt(beacon, this.m4.compose(off.add(new THREE.Vector3(x, 0, z)), this.q, this.one));
          this.beacons.setColorAt(beacon++, this.col.set(on ? (side < 0 ? 0xff2020 : 0x2a6bff) : 0x202024));
        }
      }
    }
    // (Those the clowns carry, up over their heads, rocking as they run: a Ryder truck by its own
    // model, kept under its id turned negative.)
    this.liftedAt?.(alpha, this.liftList);
    for (const L of this.liftList) {
      this.q.setFromEuler(this.liftE.set(L.roll, L.h, 0, "YXZ"));
      if (L.car.model) {
        const key = -1 - L.car.id;
        let g = this.groups.get(key);
        if (g && g.userData.model !== L.car.model) { this.release(g); this.groups.delete(key); g = undefined; }
        if (g && (g.userData.toon ?? 0) !== this.ryderToon) { this.release(g); this.groups.delete(key); g = undefined; }
        if (!g) { g = this.spare.get(`${L.car.model}/${this.ryderToon}`)?.pop() ?? this.ryder?.(L.car.model, this.ryderToon) ?? undefined; if (!g) continue; g.userData.model = L.car.model; g.userData.toon = this.ryderToon; this.scene.add(g); this.groups.set(key, g); }
        live.add(key);
        g.position.set(L.x, L.y, L.z); g.quaternion.copy(this.q); g.position.addScaledVector(this.v3.set(Math.cos(L.h), 0, -Math.sin(L.h)), -3.0);
        continue;
      }
      const k = this.kinds.find((o) => o.id === L.car.kind), mesh = k?.mesh;
      if (k?.rig) { this.drawRig(k, this.m4.compose(this.v3.set(L.x, L.y, L.z), this.q, this.one), { odo: 0, v: 0, t: this.time, seed: L.car.id * 0.37 }, L.car.color); continue; }
      if (!mesh || mesh.count >= mesh.instanceMatrix.count) continue;
      const i = mesh.count++;
      mesh.setMatrixAt(i, this.m4.compose(this.v3.set(L.x, L.y, L.z), this.q, this.one));
      mesh.setColorAt(i, this.col.set(L.car.color));
    }
    for (const [id, g] of this.groups) if (!live.has(id)) {
      this.release(g); this.groups.delete(id);
    }
    for (const k of this.kinds) if (k.mesh) { k.mesh.instanceMatrix.needsUpdate = true; if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true; }
    for (const k of this.kinds) if (k.rigMeshes) for (const { mesh } of k.rigMeshes) {
      mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.beacons.count = beacon;
    this.beacons.instanceMatrix.needsUpdate = true;
    if (this.beacons.instanceColor) this.beacons.instanceColor.needsUpdate = true;
  }
}

// ---- vehicle models (x forward, origin on the ground at the middle) ---------------------------------------
// Bodies are painted white so instanceColor tints them; glass, tyres and trim stay dark.
function wheels(b: Batch, L: number, W: number, r = 0.33, front = 0.32, rear = 0.32) {
  // Set 5 cm inside the body's sides: flush, the tyre's face and the body fought over the same
  // pixels where they overlap and shimmered.
  for (const x of [L / 2 - L * front * 0.5 - 0.35, -L / 2 + L * rear * 0.5 + 0.35]) for (const z of [-W / 2 + 0.17, W / 2 - 0.17])
    b.cyl(x, r, z, r, 0.24, TYRE, 10, Math.PI / 2);
}
function lamps(b: Batch, L: number, W: number, y: number) {
  for (const z of [-W / 2 + 0.25, W / 2 - 0.25]) { headLamp(b, L / 2 + 0.01, y, z, 0.04, 0.14, 0.3); tailLamp(b, -L / 2 - 0.01, y, z, 0.04, 0.14, 0.3); }
}
// (Cars, pickups and vans are cars.ts's models.)
// City bus, 11.5 m low-floor: a two-tone body, a band of side windows split by pillars, the
// doors on the kerb side (+z), a big windscreen under a lit destination sign, roof pods.
function busBody(b: Batch) {
  const L = 11.5, W = 2.5, H = 3.05, F = L / 2, R = -L / 2;
  const BODY = 0xf2f2ee, BLUE = 0x1f5fa8, SKIRT = 0x2a2d33, PILLAR = 0x1c2128;
  b.box(0, 0.62, 0, L, 0.7, W, SKIRT);                                     // skirt with the wheel wells
  b.box(0, 1.25, 0, L, 0.55, W, BLUE);                                     // livery band (up to the body's foot, not into it: shared planes flicker)
  b.box(-0.2, 2.25, 0, L - 0.4, 1.45, W, BODY);                            // upper body
  b.box(0.15, 2.18, 0, L - 2.0, 1.0, W + 0.02, GLASS);                     // side windows
  for (let x = R + 1.6; x < F - 1.2; x += 1.45) b.box(x, 2.18, 0, 0.14, 1.02, W + 0.04, PILLAR);
  b.box(0, 2.95, 0, L - 0.5, 0.18, W - 0.1, BODY);                         // roof, rounded in by a step
  b.box(-1.0, 3.18, 0, 3.4, 0.3, 1.8, 0xd8dad6); b.box(R + 1.4, 3.15, 0, 1.6, 0.25, 1.6, 0xd8dad6);   // AC and battery pods
  // Front: windscreen, destination sign, bumper, lamps.
  b.box(F - 0.055, 1.95, 0, 0.12, 1.45, W - 0.18, GLASS);   // (5 mm proud of the livery band: shared planes flicker)
  b.box(F - 0.04, 2.83, 0, 0.1, 0.28, W - 0.5, 0x101010); b.box(F + 0.005, 2.83, 0, 0.02, 0.16, W - 0.8, 0xffb000);
  b.box(F - 0.05, 0.5, 0, 0.14, 0.32, W + 0.02, 0x1a1a1a);   // bumper (wrapping a cm round the skirt's sides: shared planes flicker)
  for (const z of [-W / 2 + 0.3, W / 2 - 0.3]) headLamp(b, F + 0.01, 0.95, z, 0.04, 0.16, 0.34);
  // Rear: engine grille, tail lamps.
  b.box(R + 0.03, 1.3, 0, 0.08, 0.5, W - 0.5, 0x3a3d42);
  for (const z of [-W / 2 + 0.25, W / 2 - 0.25]) tailLamp(b, R - 0.01, 1.0, z, 0.04, 0.4, 0.22);
  // Doors on the kerb side: glass leaves in dark frames.
  for (const x of [F - 1.1, -0.6]) { b.box(x, 1.6, W / 2 + 0.02, 1.2, 2.2, 0.04, PILLAR); b.box(x, 1.65, W / 2 + 0.04, 0.5, 1.95, 0.02, GLASS); b.box(x + 0.27, 1.65, W / 2 + 0.04, 0.04, 1.95, 0.03, PILLAR); b.box(x - 0.27, 1.65, W / 2 + 0.04, 0.5, 1.95, 0.02, GLASS); }
  // Wheels, set into the wells.
  for (const x of [F - 2.4, R + 2.7]) for (const z of [-W / 2 + 0.2, W / 2 - 0.2]) { b.box(x, 0.62, z * 1.02, 1.25, 0.72, 0.1, 0x111214); b.cyl(x, 0.5, z, 0.5, 0.32, TYRE, 12, Math.PI / 2); b.cyl(x, 0.5, z * 1.03, 0.28, 0.32, 0x8d9296, 8, Math.PI / 2); }
}
// San Francisco style cable car: maroon below with gold lines, a cream closed saloon with a grid
// of small windows in the middle, open bench sections at both ends with brass poles, and a long
// roof with a raised clerestory.
function cableCarBody(b: Batch) {
  const L = 8.4, W = 2.4, F = L / 2, MAROON = 0x7a1e22, CREAM = 0xf0e3c4, GOLD = 0xd4af37, WOOD = 0x8a5a34, BRASS = 0xc9a24a;
  b.box(0, 0.45, 0, L - 1.0, 0.3, 1.6, 0x1c1c1c);                          // trucks under the floor
  b.box(0, 0.7, 0, L, 0.2, W, 0x5a3a24);                                   // floor
  b.box(0, 1.05, 0, L, 0.5, W, MAROON);                                    // lower body
  for (const y of [0.85, 1.25]) b.box(0, y, 0, L + 0.02, 0.05, W + 0.02, GOLD);
  // The saloon: cream walls and small windows.
  const S = 4.2;
  b.box(0, 1.95, 0, S, 1.3, W - 0.1, CREAM);
  for (let i = 0; i < 6; i++) b.box(-S / 2 + 0.38 + i * 0.69, 2.0, 0, 0.5, 0.75, W - 0.06, GLASS);
  for (const k of [-1, 1]) b.box(k * (S / 2 + 0.02), 2.0, 0, 0.04, 0.8, 1.1, GLASS);       // end windows
  // Open ends: outward-facing benches along each side and brass grab poles.
  for (const k of [-1, 1]) {
    const x0 = k * (S / 2 + (F - S / 2) / 2);
    for (const z of [-W / 2 + 0.3, W / 2 - 0.3]) { b.box(x0, 1.45, z, F - S / 2 - 0.3, 0.1, 0.45, WOOD); b.box(x0, 1.7, z * 0.75, F - S / 2 - 0.3, 0.45, 0.06, WOOD); }
    for (const z of [-W / 2 + 0.05, W / 2 - 0.05]) for (const dx of [0.2, F - S / 2 - 0.15]) b.box(k * (S / 2 + dx), 2.05, z, 0.05, 1.5, 0.05, BRASS);
    b.box(k * (F - 0.1), 1.9, 0, 0.2, 1.2, 0.9, MAROON);                 // end dash with the headlamp
    headLamp(b, k * (F + 0.01), 2.1, 0, 0.03, 0.22, 0.22);
  }
  // Roof: full length, then the clerestory with its little windows, number boards at the ends.
  b.box(0, 2.82, 0, L + 0.2, 0.12, W + 0.25, MAROON);
  b.box(0, 2.98, 0, L - 1.2, 0.22, W * 0.55, CREAM);
  for (let i = 0; i < 8; i++) b.box(-L / 2 + 1.0 + i * 0.88, 2.98, 0, 0.45, 0.12, W * 0.56, GLASS);
  b.box(0, 3.12, 0, L - 1.0, 0.06, W * 0.6, MAROON);
  for (const k of [-1, 1]) b.box(k * (F - 0.2), 3.1, 0, 0.06, 0.3, 0.8, 0x101010);
  for (const x of [-L / 2 + 1.3, L / 2 - 1.3]) for (const z of [-0.65, 0.65]) b.cyl(x, 0.32, z, 0.32, 0.16, TYRE, 10, Math.PI / 2);
}

// The truck's body as circles for traffic and pedestrians: along the box, and along a trailer at
// its articulation.
// Whether a vehicle `len` by `width` at x, z heading h is out of the truck's sight from `eye`
// (citygraph.ts outOfSight): its middle, nose and tail, and its four corners (its centre line
// hidden behind a block's corner, a corner of it can still show past it).
const SIGHT_AT = [[0, 0], [0.5, 0], [-0.5, 0], [0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5]];
export function vehicleUnseen(G: CityGraph, eye: { x: number; z: number; h: number }, x: number, z: number, h: number, len: number, width: number): boolean {
  const fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
  for (const [u, v] of SIGHT_AT) { const a = u * len, b = v * width; if (!outOfSight(G, eye, x + fx * a + rx * b, z + fz * a + rz * b)) return false; }
  return true;
}
export function truckObstacles(model: TruckModel, x0: number, z0: number, h: number, trailerYaw: number, out: Obstacle[]) {
  const spec = SPECS[model], fx = Math.cos(h), fz = -Math.sin(h);
  const trailer = spec.fifthWheel !== undefined;
  const front = spec.noseFront + 0.05, rear = trailer ? -1.5 : spec.cargo ? spec.cargo.x0 - 0.1 : -1.4;
  // (And one at the nose: the steps can end up to a step short of it, leaving its corners, which
  // swing out wide reversing into a bay, outside every circle.)
  let a = rear + 1.2;
  for (; a <= front - 1.0; a += 2.2) out.push({ x: x0 + fx * a, z: z0 + fz * a, r: 1.5 });
  if (a - 2.2 < front - 1.05) out.push({ x: x0 + fx * (front - 1.0), z: z0 + fz * (front - 1.0), r: 1.5 });
  if (trailer) {
    const th = h + trailerYaw, tx = Math.cos(th), tz = -Math.sin(th), kx = x0 + fx * (spec.fifthWheel ?? 0), kz = z0 + fz * (spec.fifthWheel ?? 0);
    for (let a = -1; a >= -14.5; a -= 2.2) out.push({ x: kx + tx * a, z: kz + tz * a, r: 1.5 });
  }
}

// The street nearest (x, z) by its centre line (with tracks, for a cable car), round the point's
// tile, or -1.
// The distance from (x, z) to the segment (x0, z0)-(x1, z1).
// To the centimetre: a booking's footprint and zones are saved with street life's keyframes (as
// short numbers), and kept so when made, so a scrub replays them as they were.
function cm(v: number): number { return Math.round(v * 100) / 100; }
// How far (x, z) is from a box centred on (cx, cz), heading h, half length hl and half width hw
// (0 inside it).
function boxDist(x: number, z: number, cx: number, cz: number, h: number, hl: number, hw: number): number {
  const dx = x - cx, dz = z - cz, u = dx * Math.cos(h) - dz * Math.sin(h), v = dx * Math.sin(h) + dz * Math.cos(h);
  return Math.hypot(Math.max(0, Math.abs(u) - hl), Math.max(0, Math.abs(v) - hw));
}
function segDist(x: number, z: number, x0: number, z0: number, x1: number, z1: number): number {
  const dx = x1 - x0, dz = z1 - z0, l2 = dx * dx + dz * dz, t = l2 > 0 ? Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / l2)) : 0;
  return Math.hypot(x - x0 - dx * t, z - z0 - dz * t);
}
function nearestStreet(G: CityGraph, x: number, z: number, cable: boolean): number {
  let best = -1, bd = Infinity;
  const gx = Math.floor(x / BLOCK), gz = Math.floor(z / BLOCK);
  for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++)
    for (const id of G.tile(gx + dx, gz + dz).streets) {
      if (cable && !G.streets[id].tags.cable) continue;
      const [s, o] = G.toStreet(id, x, z), st = G.streets[id], d = Math.abs(o) + Math.max(0, -s, s - st.len);
      if (d < bd || (d === bd && id < best)) { bd = d; best = id; }
    }
  return best;
}

// A geometry's triangles split in two: those not all pure white, and those that are (or null when
// none are): a storybook contraption's tinted body apart from the rest.
function splitWhite(g: THREE.BufferGeometry): [THREE.BufferGeometry, THREE.BufferGeometry | null] {
  const C = g.getAttribute("color"), names = Object.keys(g.attributes), out: [number[][], number[][]] = [names.map(() => []), names.map(() => [])];
  const white = (i: number) => C.getX(i) > 0.999 && C.getY(i) > 0.999 && C.getZ(i) > 0.999;
  for (let i = 0; i + 2 < C.count; i += 3) {
    const o = out[white(i) && white(i + 1) && white(i + 2) ? 1 : 0];
    names.forEach((n, j) => { const a = g.getAttribute(n); for (let v = i; v < i + 3; v++) for (let k = 0; k < a.itemSize; k++) o[j].push(a.getComponent(v, k)); });
  }
  const make = (o: number[][]) => { const r = new THREE.BufferGeometry(); names.forEach((n, j) => r.setAttribute(n, new THREE.BufferAttribute(new Float32Array(o[j]), g.getAttribute(n).itemSize))); r.computeBoundingSphere(); return r; };
  return [make(out[0]), out[1][0].length ? make(out[1]) : null];
}
