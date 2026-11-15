// Ambient traffic: cars, taxis, SUVs, pickups, vans, buses, a police car, an ice cream truck,
// other Ryder trucks and, in a coastal city, cable cars. Vehicles drive the same street paths
// as the truck (route.ts) one intersection at a time, stop for signals, queue behind whatever is
// in their lane, and pull into the inner lane to pass a stopped vehicle or to get out of the
// truck's way. The journey ignores traffic (so it stays deterministic and resumable); traffic
// yields to it instead. Each vehicle type is one InstancedMesh, tinted per vehicle with
// instanceColor; a Ryder truck is a baked copy of the real model.
import * as THREE from "three@0.187.0";
import { Rng } from "./rng.ts";
import { Batch } from "./geom.ts";
import { SPECS } from "./truck.ts";
import type { TruckModel } from "./truck.ts";
import { signalState } from "./signals.ts";
import type { SignalPreempt } from "./signals.ts";
import { cableColumn } from "./decor.ts";
import { CityPlan, cityStreet, pick } from "./city.ts";
import { BLOCK, STREET } from "./grid.ts";
import { DIR_X, DIR_Z, LANE_INNER, LANE_KERB, Path, turnDir } from "./route.ts";
import type { Move, Pose } from "./route.ts";
import { SIM_DT } from "./journey.ts";

export interface Obstacle { x: number; z: number; r: number; still?: boolean; owner?: number }   // still: a truck parked in the lane (traffic passes it); owner: the vehicle's id

interface VehicleKind {
  id: string; len: number; width: number; vmax: number; weight: number;
  colors: number[] | null;             // body tints; null keeps the painted colours
  mesh: THREE.InstancedMesh | null;    // null for Ryder trucks (separate groups)
  cap: number;
}
interface Car {
  kind: VehicleKind; path: Path; s: number; v: number;
  dodge: number; dodgeTarget: number; dodgeV: number; holdT: number;   // lateral shift into the inner lane (negative = left), and its rate
  stillT: number; committed: number; color: number;   // committed: the signal (index on the path) it is going through
  blockedBy: number; slowT: number; pedT: number; acc: number;   // acc: current acceleration (eased)
  lastO?: number; mergeUp?: boolean;   // the path's lane offset last step, and which way it last moved   // pedT: how long a pedestrian has held it up   // the vehicle it is held up close behind (-1: none, or not a vehicle), and how long it has crawled (< 0.5 m/s)
  x: number; z: number; h: number; px: number; pz: number; ph: number;   // pose now and one step ago
  cable: boolean; id: number; model: TruckModel | null;   // model: a Ryder truck's
}

const TRAFFIC_SPAWN = [70, 150], TRAFFIC_DESPAWN = 175;
const BRAKE_COMFY = 3.0;   // m/s^2: how hard traffic plans to brake for what's ahead
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
  private groups = new Map<number, THREE.Object3D>();   // Ryder trucks' models, by car id
  private spare = new Map<TruckModel, THREE.Object3D[]>();   // models of Ryder trucks that left, for reuse (each is new GPU geometry)
  time = 0;   // render time (the police lights)
  private drawn: number[] = [];   // per vehicle as last drawn: x, z, heading, half length
  readonly obstacles: Obstacle[] = [];      // this frame's vehicles, for pedestrians

  constructor(private scene: THREE.Scene, material: THREE.Material, private ryder: ((model: TruckModel) => THREE.Object3D | null) | null) {
    const kind = (id: string, len: number, width: number, vmax: number, weight: number, colors: number[] | null, cap: number, build: ((b: Batch) => void) | null) => {
      let mesh: THREE.InstancedMesh | null = null;
      if (build) {
        const b = new Batch(); build(b);
        mesh = new THREE.InstancedMesh(b.build(material)!.geometry, material, cap);
        mesh.count = 0; mesh.frustumCulled = false;
        for (let i = 0; i < cap; i++) mesh.setColorAt(i, this.col.set(0xffffff));
        scene.add(mesh);
      }
      this.kinds.push({ id, len, width, vmax, weight, colors, mesh, cap });
    };
    kind("sedan", 4.6, 1.8, 11, 5, CAR_COLORS, 20, (b) => carBody(b, 4.6, 1.8, 1.45, SEDAN));
    kind("hatch", 4.0, 1.75, 11, 3, CAR_COLORS, 10, (b) => carBody(b, 4.0, 1.75, 1.5, HATCH));
    kind("suv", 4.8, 1.95, 11, 3, CAR_COLORS, 10, (b) => carBody(b, 4.8, 1.95, 1.8, SUV));
    kind("pickup", 5.4, 2.0, 10, 2, [0xb22222, 0x222428, 0xe8e8e8, 0x1f4fa0, 0x7a7f86], 6, pickupBody);
    kind("taxi", 4.6, 1.8, 11, 2, null, 6, (b) => { carBody(b, 4.6, 1.8, 1.45, SEDAN, 0xf2c200); b.box(-0.2, 1.56, 0, 0.6, 0.2, 0.28, 0xffffff); b.box(-0.2, 1.56, 0, 0.62, 0.08, 0.3, 0x222222); });
    kind("van", 5.6, 2.0, 10, 2, [0xe8e8e8, 0xe8e8e8, 0x8a8f94, 0x1f4fa0], 6, vanBody);
    kind("bus", 11.5, 2.5, 9, 0.8, null, 3, busBody);
    kind("police", 4.8, 1.85, 11, 0.5, null, 2, (b) => { carBody(b, 4.8, 1.85, 1.45, SEDAN, 0xf4f4f0); for (const z of [-1, 1]) b.box(-0.05, 0.62, z * 0.931, 1.7, 0.42, 0.01, 0x15181c); b.box(-0.1, 1.5, 0, 0.3, 0.1, 1.2, 0x222222); });
    kind("icecream", 5.8, 2.1, 8, 0.5, null, 2, iceCreamBody);
    kind("ryder", 11.3, 2.5, 10, 0.8, null, 2, null);
    kind("cablecar", 8.6, 2.5, 6, 0, null, 3, cableCarBody);
    const bb = new Batch(); bb.box(0, 0, 0, 0.28, 0.14, 0.5, 0xffffff);
    const bm = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.beacons = new THREE.InstancedMesh(bb.build(bm)!.geometry, bm, 4);
    this.beacons.count = 0; this.beacons.frustumCulled = false;
    for (let i = 0; i < 4; i++) this.beacons.setColorAt(i, this.col.set(0xffffff));
    scene.add(this.beacons);
  }

  private release(g: THREE.Object3D) {
    g.removeFromParent();
    const m = g.userData.model as TruckModel;
    let list = this.spare.get(m);
    if (!list) this.spare.set(m, (list = []));
    list.push(g);
  }

  // Remove every vehicle (a new city, or the country).
  clear() {
    this.cars.length = 0;
    this.obstacles.length = 0;
  }
  // A new city: no vehicles, and the random stream from the city's seed.
  reset(seed: number) { this.clear(); this.rng.s = seed >>> 0; this.nextId = 0; }

  save() {
    return { rng: this.rng.s, id: this.nextId, cars: this.cars.map((c) => ({ ...c, kind: c.kind.id, path: c.path.route })) };
  }
  load(o: ReturnType<Traffic["save"]>) {
    this.rng.s = o.rng; this.nextId = o.id;
    this.cars = o.cars.map((c) => ({ ...c, kind: this.kinds.find((k) => k.id === c.kind)!, path: new Path(c.path) }));
    for (const c of this.cars) c.path.eval(c.s, this.pose);   // the path remembers its last lane offset
    this.obstacles.length = 0;
  }

  // `truck` is the truck's body as circles; `peds` the pedestrians. `density` scales how many.
  // One fixed step (the journey's), around `focus`; `prs` are the signals the truck has held.
  step(plan: CityPlan, simTime: number, prs: SignalPreempt[], focus: { x: number; z: number }, truck: Obstacle[], truckHeading: number, peds: Obstacle[]) {
    const dt = SIM_DT;
    for (const c of this.cars) { c.px = c.x; c.pz = c.z; c.ph = c.h; }
    // Despawn far vehicles; top up near the truck.
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (Math.hypot(c.x - focus.x, c.z - focus.z) > TRAFFIC_DESPAWN) this.cars.splice(i, 1);
    }
    const bx = Math.floor(focus.x / BLOCK), bz = Math.floor(focus.z / BLOCK);
    const d = plan.district(bx, bz);
    const want = d === "downtown" ? 30 : d === "commercial" ? 26 : d === "residential" ? 15 : 12;
    for (let tries = 0; tries < 3 && this.cars.length < want; tries++) this.spawn(plan, focus, truck);
    // Drive.
    this.obstacles.length = 0;
    for (const c of this.cars) this.carCircles(c, this.obstacles);
    const byId = new Map<number, Car>();
    for (const c of this.cars) byId.set(c.id, c);
    const ignore = this.cars.map((c) => this.deadlockBlocker(c, byId));   // from last step's state, before anyone moves
    for (let i = this.cars.length - 1; i >= 0; i--) this.drive(this.cars[i], dt, plan, simTime, prs, truck, truckHeading, peds, i, ignore[i]);
  }

  private spawn(plan: CityPlan, focus: { x: number; z: number }, truck: Obstacle[]) {
    const r = this.rnd;
    const ang = r() * Math.PI * 2, dist = TRAFFIC_SPAWN[0] + r() * (TRAFFIC_SPAWN[1] - TRAFFIC_SPAWN[0]);
    const px = focus.x + Math.cos(ang) * dist, pz = focus.z + Math.sin(ang) * dist;
    // Snap to an edge: approach node (ix, iz) heading dir, `before` metres short of it.
    const dir = Math.floor(r() * 4);
    const ix = Math.round((px - STREET / 2) / BLOCK), iz = Math.round((pz - STREET / 2) / BLOCK);
    const before = 15 + r() * 35;
    let kind = this.pickKind(plan);
    let cable = false;
    if (plan.style.cableCar && r() < 0.25) {
      // A cable car on a track street, running north or south.
      const col = [ix - 1, ix, ix + 1].find((x) => cableColumn(x));
      if (col !== undefined && this.count("cablecar") < 2) { kind = this.kinds.find((k) => k.id === "cablecar")!; cable = true; }
    }
    if (!kind || this.count(kind.id) >= kind.cap) return;
    const route = { ix, iz, dir: cable ? (r() < 0.5 ? 1 : 3) : dir, before, moves: "S", after: 30 };
    if (cable) route.ix = [ix - 1, ix, ix + 1].find((x) => cableColumn(x))!;
    // Only on the city's own streets (none out of town).
    if (!cityStreet(route.ix - DIR_X[route.dir], route.iz - DIR_Z[route.dir], route.dir)) return;
    const mv = this.validMove(route.ix, route.iz, route.dir, cable);
    if (!mv) return;
    route.moves = mv;
    const path = new Path(route);
    path.eval(0, this.pose);
    // Not on top of anything.
    for (const o of [...truck, ...this.obstacles]) if (Math.hypot(o.x - this.pose.x, o.z - this.pose.z) < 14) return;
    for (const c of this.cars) if (Math.hypot(c.x - this.pose.x, c.z - this.pose.z) < 14) return;
    const color = kind.colors ? pick(r, kind.colors) : 0xffffff;
    const model: TruckModel | null = kind.id === "ryder" ? (r() < 0.5 ? "box16" : "box26") : null;
    this.cars.push({ kind, path, s: 0, v: kind.vmax * 0.7, dodge: cable ? -3 : 0, dodgeTarget: cable ? -3 : 0, dodgeV: 0, holdT: 0, stillT: 0, committed: -1, blockedBy: -1, slowT: 0, pedT: 0, acc: 0,
      color, x: this.pose.x, z: this.pose.z, h: this.pose.h, px: this.pose.x, pz: this.pose.z, ph: this.pose.h, cable, id: this.nextId++, model });
  }
  private count(id: string) { let n = 0; for (const c of this.cars) if (c.kind.id === id) n++; return n; }
  private pickKind(plan: CityPlan): VehicleKind | null {
    const pool = this.kinds.filter((k) => k.weight > 0 && (k.id !== "icecream" || plan.style.id !== "port"));
    let t = this.rnd() * pool.reduce((a, k) => a + k.weight, 0);
    for (const k of pool) { if ((t -= k.weight) < 0) return k; }
    return pool[0] ?? null;
  }
  // A move at node (ix, iz), arriving heading dir, that stays on the city's streets.
  private validMove(ix: number, iz: number, dir: number, cable: boolean): string | null {
    for (let k = 0; k < 4; k++) { const m = this.pickMove(cable); if (cityStreet(ix, iz, turnDir(dir, m as Move))) return m; }
    for (const m of ["S", "R", "L"]) if (!cable && cityStreet(ix, iz, turnDir(dir, m as Move))) return m;
    return null;
  }
  private pickMove(cable: boolean): string {
    if (cable) return "S";
    const x = this.rnd();
    return x < 0.6 ? "S" : x < 0.85 ? "R" : "L";
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
    let limit = Math.min(c.kind.vmax, p.speedLimit(c.s, 2.5));
    let hardStop = Infinity;
    // Signals (the same rule as the truck: right on red after a pause).
    for (let key = 0; key < p.signals.length; key++) {
      const sg = p.signals[key], target = sg.sLine - 0.8 - half;
      if (c.s > target + 0.5) continue;
      const state = signalState(sg.ix, sg.iz, sg.axis, simTime, plan.seed, prs);
      if (state === "green" || c.committed === key) break;
      const dist = target - c.s;
      if (state === "red" && sg.move === "R" && !c.cable && c.stillT > 1.2 && dist < 1.2) { c.committed = key; break; }
      if (dist >= c.v * c.v / 9 - 0.5) { limit = Math.min(limit, Math.sqrt(5 * Math.max(0, dist))); hardStop = target; }
      else c.committed = key;
      break;
    }
    // What's ahead in this lane: other vehicles, the truck, pedestrians.
    // (Judged along the street, not the car's own heading: easing across lanes after a turn, that
    // points at the kerb, and a truck parked in the kerb lane would seem to be dead ahead.)
    const turningNow = Number.isNaN(p.lastOffset), hr = turningNow ? c.h : Math.round(c.h / (Math.PI / 2)) * (Math.PI / 2);
    const fx = Math.cos(hr), fz = -Math.sin(hr), lx = -fz, lz = fx;   // forward, right
    let gap = Infinity, truckBehind = Infinity, otherLaneBlocked = false, stillAhead = Infinity, gapOwner = -1, gapPed = false, truckAhead = Infinity;
    const look = 10 + c.v * 2.4;   // far enough to stop comfortably from city speed
    // The lane we'd move into: the inner lane 3 m to the left, or back to the kerb lane. (`side`
    // below is measured to the right: (lx, lz) points right of the heading.)
    const otherLane = c.dodge < -1.5 ? 3 : -3;
    const reach = Math.max(look, 45) + half + 12;   // nothing further away matters
    const scan = (o: Obstacle, isTruck: boolean, ped = false) => {
      const rx = o.x - c.x, rz = o.z - c.z;
      if (rx > reach || rx < -reach || rz > reach || rz < -reach) return;
      const along = rx * fx + rz * fz, side = rx * lx + rz * lz;
      // Pulling out round a parked truck: judged from where the car is steering to, so it keeps
      // rolling as it eases out instead of stopping and sliding sideways.
      const sideEff = o.still && c.dodgeTarget < c.dodge - 0.1 ? side - (c.dodgeTarget - c.dodge) * 0.7 : side;
      // (Sideways, the truck's circles are wider than its body: passing it in the next lane, its
      // real half-width counts.)
      const rLat = isTruck ? Math.min(o.r, 1.3) : o.r + 0.2;
      if (along > half && along < look + o.r && Math.abs(sideEff) < rLat + c.kind.width * 0.5 && o.owner !== ignoreId) {
        const g = along - half - o.r;
        if (g < gap) { gap = g; gapOwner = o.owner ?? -1; gapPed = ped; }
        if (isTruck) truckAhead = Math.min(truckAhead, g);
      }
      if (Math.abs(along) < half + 8 && Math.abs(side - otherLane) < 1.5 + o.r * 0.5) otherLaneBlocked = true;
      if (isTruck && along < -half && along > -45 && Math.abs(side) < 2) truckBehind = Math.min(truckBehind, -along);
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
    const turning = Number.isNaN(p.lastOffset), laneChanging = !turning && Math.abs(p.lastOffset - LANE_KERB) > 0.1;
    let rightSoon = false;
    for (const t of p.turns) if (t.dir === 1 && t.s - c.s < 30 && t.s > c.s) rightSoon = true;
    // Which way the path's lane offset last moved: up means easing from the inner lane back to
    // the kerb lane (after a turn), which is the wrong way with a truck parked ahead.
    const off = turning ? LANE_INNER : p.lastOffset;
    if (Math.abs(off - (c.lastO ?? off)) > 1e-4) c.mergeUp = off > (c.lastO ?? off);
    c.lastO = off;
    const merging = laneChanging && !!c.mergeUp;
    // The truck in this lane close ahead (moving slowly or stopped): pass it now rather than queue.
    const truckClose = truckAhead < 14;
    if (!c.cable && merging && (stillAhead < 40 || truckClose)) {
      // Coming out of a turn in the inner lane with a parked truck
      // ahead in the kerb lane: stay in the inner lane rather than merge in behind it, then pass.
      c.dodgeTarget = THREE.MathUtils.clamp(-(p.lastOffset - LANE_INNER), -3, 0); c.holdT = 4;
    } else if (!c.cable) {
      // (A right turn just ahead keeps a car in the kerb lane, but not with the truck stopped in it
      // short of the corner: then it pulls round the truck and swings wide into the turn.)
      const passTruck = stillAhead < 35 || truckClose;
      if (laneChanging || turning || (rightSoon && !passTruck)) c.dodgeTarget = 0;
      else if ((sameDir && truckBehind < 40) || stillAhead < 35 || truckClose || (gap < 12 && c.stillT > 1.5)) { if (c.dodge < -1.5 || !otherLaneBlocked) { c.dodgeTarget = -3; c.holdT = 4; } }
      else if ((c.holdT -= dt) <= 0 && (c.dodge > -1.5 || !otherLaneBlocked)) c.dodgeTarget = 0;
    }
    if ((globalThis as any).TRAFFIC_DEBUG && gap < 4 && gapOwner < 0 && !gapPed && c.stillT > 4 && Math.floor(c.stillT * 10) % 20 === 0) (globalThis as any).TRAFFIC_DEBUG({ id: c.id, stillT: c.stillT, stillAhead, rightSoon, laneChanging, turning, merging, otherLaneBlocked, dodge: c.dodge, dodgeTarget: c.dodgeTarget, cable: c.cable, signal: hardStop < Infinity, gap, cx: c.x, cz: c.z, ch: c.h, v: c.v, s: c.s, plen: p.length });
    // Something ahead: the speed from which a comfortable stop still ends 2 m short of it. Only an
    // overlap stops a car dead.
    if (gap < Infinity) { limit = Math.min(limit, Math.sqrt(2 * BRAKE_COMFY * Math.max(0, gap - 2))); if (gap < -1) hardStop = Math.min(hardStop, c.s); }   // only a real overlap stops a car dead
    // Speed follows the limit through an eased acceleration (no instant changes in braking), up
    // to 2.2 m/s^2 speeding up and 5 m/s^2 braking.
    {
      const want = THREE.MathUtils.clamp((limit - c.v) / 0.6, -5, 2.2);
      c.acc += THREE.MathUtils.clamp(want - c.acc, -9 * dt, 9 * dt);
      if (c.acc < 0 && c.v + c.acc * dt < limit && limit < c.v) c.acc = Math.max(c.acc, (limit - c.v) / dt);   // don't brake below the limit
      if (gap < 0.4 && c.v > 0) c.acc = Math.min(c.acc, -8);   // cut in on: a hard stop, but not a dead one
      if (c.acc > 0 && c.v + c.acc * dt > limit) c.acc = Math.max(0, (limit - c.v) / dt);   // nor speed up past it
      c.v = Math.max(0, c.v + c.acc * dt);
      if (c.v === 0 && c.acc < 0) c.acc = 0;
    }
    let ds = c.v * dt;
    if (c.s + ds > hardStop) { ds = Math.max(0, hardStop - c.s); c.v = 0; }
    c.s += ds;
    c.stillT = c.v < 0.05 ? c.stillT + dt : 0;
    c.slowT = c.v < 0.5 ? c.slowT + dt : 0;
    c.blockedBy = gap < 3 ? gapOwner : -1;
    c.pedT = gap < 3 && gapPed ? c.pedT + dt : c.v > 2 ? 0 : c.pedT;
    // Ease across: the sideways rate builds and fades gently and is tied to forward speed, so a
    // lane change takes 12-15 m of road at speed, and a stopped car eases out more slowly.
    {
      const rate = Math.min(1.4, 0.2 * c.v + 0.6);
      const want = THREE.MathUtils.clamp(1.6 * (c.dodgeTarget - c.dodge), -rate, rate);
      c.dodgeV += THREE.MathUtils.clamp(want - c.dodgeV, -1.2 * dt, 1.2 * dt);
      c.dodge += c.dodgeV * dt;
      if (c.dodge <= -3 || c.dodge >= 0) { c.dodge = THREE.MathUtils.clamp(c.dodge, -3, 0); c.dodgeV = 0; }   // in a lane: settled
    }
    // The truck is about to run into a vehicle that couldn't move over: it slips away.
    if (truckBehind < 2.5 && Math.abs(c.dodge) < 1) { this.cars.splice(index, 1); return; }
    // Next intersection: plan on from the end of this path.
    if (c.s >= p.length - 0.5) {
      const past = p.route.after - (p.length - c.s), d = p.endDir, [ex, ez] = p.endNode;
      const mv = this.validMove(ex + DIR_X[d], ez + DIR_Z[d], d, c.cable);
      if (!mv) { this.cars.splice(index, 1); return; }
      c.path = new Path({ ix: ex + DIR_X[d], iz: ez + DIR_Z[d], dir: d, before: BLOCK - past, moves: mv, after: 30 });
      c.s = 0; c.committed = -1;
    }
    c.path.eval(c.s, this.pose);
    const h = this.pose.h;
    c.x = this.pose.x + Math.sin(h) * c.dodge; c.z = this.pose.z + Math.cos(h) * c.dodge;   // negative dodge: to the left
    c.h = h;
  }

  // Headlight patches on the road ahead of the vehicles nearest `at` (atmosphere.ts HEAD_LIGHTS),
  // into out[from..]; the rest are switched off.
  headlights(out: THREE.Vector4[], from: number, at: { x: number; z: number }) {
    const d = this.drawn, order: number[] = [];
    for (let i = 0; i < d.length; i += 4) if (Math.hypot(d[i] - at.x, d[i + 1] - at.z) < 120) order.push(i);
    order.sort((a, b) => Math.hypot(d[a] - at.x, d[a + 1] - at.z) - Math.hypot(d[b] - at.x, d[b + 1] - at.z));
    for (let k = from; k < out.length; k++) {
      const i = order[k - from];
      if (i === undefined) { out[k].w = 0; continue; }
      const h = d[i + 2], ahead = d[i + 3] + 5;
      out[k].set(d[i] + Math.cos(h) * ahead, d[i + 1] - Math.sin(h) * ahead, h, 0.7);
    }
  }

  // Write instance matrices and colours, `alpha` of the way from the last step's poses to these.
  draw(alpha: number) {
    for (const k of this.kinds) if (k.mesh) k.mesh.count = 0;
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
        if (!g) { g = this.spare.get(c.model)?.pop() ?? this.ryder?.(c.model) ?? undefined; if (!g) continue; g.userData.model = c.model; this.scene.add(g); this.groups.set(c.id, g); }
        live.add(c.id);
        g.position.set(x, 0, z); g.rotation.set(0, h, 0); g.position.addScaledVector(this.v3.set(Math.cos(h), 0, -Math.sin(h)), -3.0);   // the model's origin is its rear axle
        continue;
      }
      const mesh = c.kind.mesh!;
      const i = mesh.count++;
      mesh.setMatrixAt(i, this.m4.compose(this.v3.set(x, 0, z), this.q, this.one));
      mesh.setColorAt(i, this.col.set(c.color));
      if (c.kind.id === "police" && beacon < 4) {
        for (const side of [-0.32, 0.32]) {
          const on = Math.floor(this.time * 6 + (side > 0 ? 1 : 0)) % 2 === 0;
          const off = this.v3.set(-0.1, 1.6, side).applyQuaternion(this.q);
          this.beacons.setMatrixAt(beacon, this.m4.compose(off.add(new THREE.Vector3(x, 0, z)), this.q, this.one));
          this.beacons.setColorAt(beacon++, this.col.set(on ? (side < 0 ? 0xff2020 : 0x2a6bff) : 0x202024));
        }
      }
    }
    for (const [id, g] of this.groups) if (!live.has(id)) {
      this.release(g); this.groups.delete(id);
    }
    for (const k of this.kinds) if (k.mesh) { k.mesh.instanceMatrix.needsUpdate = true; if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true; }
    this.beacons.count = beacon;
    this.beacons.instanceMatrix.needsUpdate = true;
    if (this.beacons.instanceColor) this.beacons.instanceColor.needsUpdate = true;
  }
}

// ---- vehicle models (x forward, origin on the ground at the middle) ---------------------------------------
// Bodies are painted white so instanceColor tints them; glass, tyres and trim stay dark.
export const GLASS = 0x26313d, TYRE = 0x161616;
function wheels(b: Batch, L: number, W: number, r = 0.33, front = 0.32, rear = 0.32) {
  // Set 5 cm inside the body's sides: flush, the tyre's face and the body fought over the same
  // pixels where they overlap and shimmered.
  for (const x of [L / 2 - L * front * 0.5 - 0.35, -L / 2 + L * rear * 0.5 + 0.35]) for (const z of [-W / 2 + 0.17, W / 2 - 0.17])
    b.cyl(x, r, z, r, 0.24, TYRE, 10, Math.PI / 2);
}
function lamps(b: Batch, L: number, W: number, y: number) {
  for (const z of [-W / 2 + 0.25, W / 2 - 0.25]) { headLamp(b, L / 2 + 0.01, y, z, 0.04, 0.14, 0.3); tailLamp(b, -L / 2 - 0.01, y, z, 0.04, 0.14, 0.3); }
}
// Lamps tagged for the night glow (applyLampGlow): aux.z -3 headlamps, -4 tail lamps.
export function headLamp(b: Batch, x: number, y: number, z: number, w: number, h: number, d: number) {
  b.aux.set(0, 0, -3); b.box(x, y, z, w, h, d, 0xfff4d0); b.aux.set(0, 0, -1);
}
export function tailLamp(b: Batch, x: number, y: number, z: number, w: number, h: number, d: number) {
  b.aux.set(0, 0, -4); b.box(x, y, z, w, h, d, 0xc01818); b.aux.set(0, 0, -1);
}
// A car in three layers: a lower body cut away over the wheels (open arches, the tyres showing in
// them), a full-length shoulder, and a greenhouse with raked windscreen and rear glass, set in
// from the sides. `shape` sets where the glass starts and ends (from the nose and the tail) and
// how far the roof is drawn in from them.
interface CarShape { hood: number; tail: number; rakeF: number; rakeR: number }
const TRIM = 0x23262b, CHROME = 0xb8bcc0;
// The lower car: body cut away over open arches with the tyres in them, the shoulder up to the belt
// line `yb`, bumpers, grille and lamps. Shared by the cars, the pickup and the van.
function carBase(b: Batch, L: number, W: number, yb: number, paint: number, r = 0.33, wheelIn = 0.95) {
  const F = L / 2, R = -L / 2, wf = F - wheelIn, wr = R + wheelIn, arch = r + 0.07;
  const yr = 0.27, ym = 2 * r + 0.02;
  b.box((F + wf + arch) / 2, (yr + ym) / 2, 0, F - wf - arch, ym - yr, W, paint);
  b.box(((wf - arch) + (wr + arch)) / 2, (yr + ym) / 2, 0, (wf - arch) - (wr + arch), ym - yr, W, paint);
  b.box((R + wr - arch) / 2, (yr + ym) / 2, 0, (wr - arch) - R, ym - yr, W, paint);
  for (const x of [wf, wr]) for (const z of [-1, 1]) {
    b.box(x, ym - 0.12, z * (W / 2 - 0.25), arch * 2, 0.26, 0.4, 0x0e0f11);              // the well, in shadow
    b.cyl(x, r, z * (W / 2 - 0.15), r, 0.2, TYRE, 12, Math.PI / 2);
    b.cyl(x, r, z * (W / 2 - 0.045), r * 0.55, 0.02, CHROME, 10, Math.PI / 2);          // hub
  }
  b.box(0, (ym + yb) / 2, 0, L, yb - ym, W, paint);
  b.box(0, yb + 0.02, 0, L - 0.1, 0.04, W - 0.06, paint);
  b.box(F - 0.04, 0.4, 0, 0.12, 0.2, W - 0.06, TRIM);
  b.box(F + 0.005, ym - 0.1, 0, 0.02, 0.14, W * 0.42, TRIM);
  b.box(R + 0.04, 0.4, 0, 0.12, 0.2, W - 0.06, TRIM);
  for (const z of [-1, 1]) {
    headLamp(b, F + 0.01, ym - 0.08, z * (W / 2 - 0.2), 0.03, 0.1, 0.32);
    tailLamp(b, R - 0.01, yb - 0.1, z * (W / 2 - 0.18), 0.03, 0.16, 0.3);
  }
}
// Glass between belt `yb` and roof `H`, from g0 (rear) to g1 (front) at the belt, raked in by
// rakeR / rakeF at the roof, with pillars, roof, a B pillar and mirrors.
function greenhouse(b: Batch, W: number, yb: number, H: number, g0: number, g1: number, rakeR: number, rakeF: number, paint: number, bPillar = true) {
  const r1 = g1 - rakeF, r0 = g0 + rakeR, gh = H - yb - 0.06;
  for (let k = 0; k < 3; k++) {
    const f = (k + 1) / 3, x1 = g1 + (r1 - g1) * f, x0 = g0 + (r0 - g0) * f;   // each slice's top: always behind the raked glass
    b.box((x0 + x1) / 2, yb + 0.04 + gh * (k + 0.5) / 3, 0, x1 - x0, gh / 3 + 0.01, W * 0.84, GLASS);
  }
  const slope = (xa: number, xb: number) => { const len = Math.hypot(xa - xb, gh), th = Math.atan2(xa - xb, gh);
    b.boxR((xa + xb) / 2, yb + 0.04 + gh / 2, 0, 0.05, len, W * 0.82, GLASS, 0, 0, th);
    for (const z of [-1, 1]) b.boxR((xa + xb) / 2, yb + 0.04 + gh / 2, z * W * 0.41, 0.07, len, 0.06, paint, 0, 0, th); };
  slope(g1, r1); slope(g0, r0);
  b.box((r0 + r1) / 2, H - 0.03, 0, r1 - r0 + 0.06, 0.07, W * 0.86, paint);
  const bx = (r0 + r1) / 2 + (r1 - r0) * 0.08;
  if (bPillar) b.box(bx, yb + 0.04 + gh / 2, 0, 0.09, gh, W * 0.85, paint);
  for (const z of [-1, 1]) {
    b.box(g1 - 0.15, yb + 0.12, z * (W / 2 + 0.05), 0.14, 0.1, 0.1, paint);                   // mirror
    if (bPillar) b.box(bx, (0.27 + yb) / 2, z * (W / 2 + 0.004), 0.02, yb - 0.33, 0.01, TRIM);  // door shut line
  }
}
export function carBody(b: Batch, L: number, W: number, H: number, shape: CarShape, paint = 0xffffff) {
  const yb = 0.84 + (H - 1.4) * 0.5;   // the belt line, above the arch tops (0.68)
  carBase(b, L, W, yb, paint);
  greenhouse(b, W, yb, H, -L / 2 + shape.tail, L / 2 - shape.hood, shape.rakeR, shape.rakeF, paint);
}
export const SEDAN: CarShape = { hood: 1.25, tail: 0.95, rakeF: 0.62, rakeR: 0.5 };
export const HATCH: CarShape = { hood: 1.0, tail: 0.22, rakeF: 0.55, rakeR: 0.22 };
export const SUV: CarShape = { hood: 1.15, tail: 0.2, rakeF: 0.5, rakeR: 0.14 };
export function pickupBody(b: Batch) {
  const L = 5.4, W = 2.0, yb = 1.02, P = 0xffffff;
  carBase(b, L, W, yb, P, 0.38, 1.05);
  greenhouse(b, W, yb, 1.85, -0.35, 1.25, 0.12, 0.55, P);
  // The bed: walls, tailgate and a dark floor.
  for (const z of [-1, 1]) b.box(-1.62, yb + 0.22, z * (W / 2 - 0.04), 2.0, 0.44, 0.08, P);
  b.box(-L / 2 + 0.06, yb + 0.22, 0, 0.1, 0.44, W - 0.04, P);
  b.box(-0.62, yb + 0.22, 0, 0.08, 0.44, W - 0.04, P);
  b.box(-1.62, yb + 0.03, 0, 2.0, 0.02, W - 0.16, 0x2a2a2a);
}
export function vanBody(b: Batch) {
  const L = 5.6, W = 2.0, yb = 1.05, P = 0xffffff;
  carBase(b, L, W, yb, P, 0.36, 1.0);
  // A tall box behind a short sloped nose.
  b.box(-0.55, yb + 0.68, 0, L - 1.1, 1.36, W, P);
  greenhouse(b, W, yb, 2.0, 1.2, 2.45, 0, 0.6, P, false);
  b.box(-0.55, yb + 1.38, 0, L - 1.2, 0.05, W - 0.08, P);
  for (const z of [-1, 1]) { b.box(1.75, yb + 0.5, z * (W / 2 + 0.004), 0.02, 1.0, 0.01, TRIM); b.box(0.4, yb + 0.6, z * (W / 2 + 0.004), 0.02, 1.2, 0.01, TRIM); }
  b.box(-L / 2 + 0.005, yb + 0.7, 0, 0.01, 1.2, 0.02, TRIM);   // the rear doors' split
}
// City bus, 11.5 m low-floor: a two-tone body, a band of side windows split by pillars, the
// doors on the kerb side (+z), a big windscreen under a lit destination sign, roof pods.
function busBody(b: Batch) {
  const L = 11.5, W = 2.5, H = 3.05, F = L / 2, R = -L / 2;
  const BODY = 0xf2f2ee, BLUE = 0x1f5fa8, SKIRT = 0x2a2d33, PILLAR = 0x1c2128;
  b.box(0, 0.62, 0, L, 0.7, W, SKIRT);                                     // skirt with the wheel wells
  b.box(0, 1.25, 0, L, 0.56, W, BLUE);                                     // livery band
  b.box(-0.2, 2.25, 0, L - 0.4, 1.45, W, BODY);                            // upper body
  b.box(0.15, 2.18, 0, L - 2.0, 1.0, W + 0.02, GLASS);                     // side windows
  for (let x = R + 1.6; x < F - 1.2; x += 1.45) b.box(x, 2.18, 0, 0.14, 1.02, W + 0.04, PILLAR);
  b.box(0, 2.95, 0, L - 0.5, 0.18, W - 0.1, BODY);                         // roof, rounded in by a step
  b.box(-1.0, 3.18, 0, 3.4, 0.3, 1.8, 0xd8dad6); b.box(R + 1.4, 3.15, 0, 1.6, 0.25, 1.6, 0xd8dad6);   // AC and battery pods
  // Front: windscreen, destination sign, bumper, lamps.
  b.box(F - 0.06, 1.95, 0, 0.12, 1.45, W - 0.18, GLASS);
  b.box(F - 0.04, 2.83, 0, 0.1, 0.28, W - 0.5, 0x101010); b.box(F + 0.005, 2.83, 0, 0.02, 0.16, W - 0.8, 0xffb000);
  b.box(F - 0.05, 0.5, 0, 0.14, 0.32, W, 0x1a1a1a);
  for (const z of [-W / 2 + 0.3, W / 2 - 0.3]) headLamp(b, F + 0.01, 0.95, z, 0.04, 0.16, 0.34);
  // Rear: engine grille, tail lamps.
  b.box(R + 0.03, 1.3, 0, 0.08, 0.5, W - 0.5, 0x3a3d42);
  for (const z of [-W / 2 + 0.25, W / 2 - 0.25]) tailLamp(b, R - 0.01, 1.0, z, 0.04, 0.4, 0.22);
  // Doors on the kerb side: glass leaves in dark frames.
  for (const x of [F - 1.1, -0.6]) { b.box(x, 1.6, W / 2 + 0.02, 1.2, 2.2, 0.04, PILLAR); b.box(x, 1.65, W / 2 + 0.04, 0.5, 1.95, 0.02, GLASS); b.box(x + 0.27, 1.65, W / 2 + 0.04, 0.04, 1.95, 0.03, PILLAR); b.box(x - 0.27, 1.65, W / 2 + 0.04, 0.5, 1.95, 0.02, GLASS); }
  // Wheels, set into the wells.
  for (const x of [F - 2.4, R + 2.7]) for (const z of [-W / 2 + 0.2, W / 2 - 0.2]) { b.box(x, 0.62, z * 1.02, 1.25, 0.72, 0.1, 0x111214); b.cyl(x, 0.5, z, 0.5, 0.32, TYRE, 12, Math.PI / 2); b.cyl(x, 0.5, z * 1.03, 0.28, 0.32, 0x8d9296, 8, Math.PI / 2); }
}
function iceCreamBody(b: Batch) {
  const L = 5.8, W = 2.1;
  b.box(-0.5, 1.45, 0, L - 1.0, 2.3, W, 0xf7c9de); b.box(L / 2 - 0.5, 0.9, 0, 1.0, 1.2, W, 0xf7c9de);
  b.box(L / 2 - 1.05, 1.85, 0, 0.2, 0.75, W * 0.9, GLASS);
  b.box(-0.6, 1.7, W / 2 + 0.01, 2.4, 0.9, 0.02, 0x8fd3e8); b.box(-0.6, 2.25, W / 2 + 0.3, 2.6, 0.06, 0.6, 0xff6fa8);   // serving hatch, awning
  b.cone(-0.5, 3.2, 0, 0.35, 0.8, 0xe0a050, 8); b.ico(-0.5, 3.75, 0, 0.42, 0xfff0f5);                                        // giant cone
  wheels(b, L, W, 0.36); lamps(b, L, W, 0.9);
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
export function truckObstacles(model: TruckModel, x0: number, z0: number, h: number, trailerYaw: number, out: Obstacle[]) {
  const spec = SPECS[model], fx = Math.cos(h), fz = -Math.sin(h);
  const trailer = spec.fifthWheel !== undefined;
  const front = spec.noseFront + 0.05, rear = trailer ? -1.5 : spec.cargo ? spec.cargo.x0 - 0.1 : -1.4;
  for (let a = rear + 1.2; a <= front - 1.0; a += 2.2) out.push({ x: x0 + fx * a, z: z0 + fz * a, r: 1.5 });
  if (trailer) {
    const th = h + trailerYaw, tx = Math.cos(th), tz = -Math.sin(th), kx = x0 + fx * (spec.fifthWheel ?? 0), kz = z0 + fz * (spec.fifthWheel ?? 0);
    for (let a = -1; a >= -14.5; a -= 2.2) out.push({ x: kx + tx * a, z: kz + tz * a, r: 1.5 });
  }
}
