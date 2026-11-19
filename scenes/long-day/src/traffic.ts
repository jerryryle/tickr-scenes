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
import { CAR_SPECS, carModel, GLASS, headLamp, tailLamp, TYRE } from "./cars.ts";
import type { CarKind } from "./cars.ts";
import { SPECS } from "./truck.ts";
import type { TruckModel } from "./truck.ts";
import { signalState } from "./signals.ts";
import type { SignalPreempt } from "./signals.ts";
import { CityPlan, pick } from "./city.ts";
import type { CityGraph } from "./citygraph.ts";
import { BLOCK } from "./grid.ts";
import { LANE_INNER, LANE_KERB, Path, STOP_BACK } from "./route.ts";
import type { Move, Pose, Route } from "./route.ts";
import { SIM_DT } from "./journey.ts";

export interface Obstacle { x: number; z: number; r: number; still?: boolean; owner?: number; sweep?: boolean }   // still: a truck parked in the lane (traffic passes it); owner: the vehicle's id; sweep: where the truck reversing into a bay will be

interface VehicleKind {
  id: string; len: number; width: number; vmax: number; weight: number;
  colors: number[] | null;             // body tints; null keeps the painted colours
  mesh: THREE.InstancedMesh | null;    // null for Ryder trucks (separate groups)
  cap: number;
}
interface Car {
  kind: VehicleKind; path: Path; s: number; v: number;
  next: Path | null;                   // the plan after this one, from its end (its move picked already): braked for ahead of time
  dodge: number; dodgeTarget: number; dodgeV: number; holdT: number;   // lateral shift into the inner lane (negative = left), and its rate
  stillT: number; committed: number; color: number;   // committed: the signal (index on the path) it is going through
  stopFor: number;                     // the signal (index on the path) it is stopping for, -1: none
  blockedBy: number; slowT: number; pedT: number; acc: number;   // acc: current acceleration (eased)
  passId?: number; passT?: number;      // a car it was let through past out of a deadlock, and for how much longer
  held?: boolean;                      // holding at a junction's line last step (for a car with priority, or the way out blocked)
  truckHold?: boolean;                 // holding last step for the truck to go by (giveWay, landingWay)
  gwNode?: number;                     // the node it is holding at for the truck to go through, or -1
  stopOk?: number;                     // the all-way stop it has stopped at and may now go on from
  lastO?: number; mergeUp?: boolean;   // the path's lane offset last step, and which way it last moved   // pedT: how long a pedestrian has held it up   // the vehicle it is held up close behind (-1: none, or not a vehicle), and how long it has crawled (< 0.5 m/s)
  x: number; z: number; h: number; px: number; pz: number; ph: number;   // pose now and one step ago
  cable: boolean; id: number; model: TruckModel | null;   // model: a Ryder truck's
}

const TRAFFIC_SPAWN = [70, 150], TRAFFIC_DESPAWN = 175;
const BRAKE_COMFY = 3.0;   // m/s^2: how hard traffic plans to brake for what's ahead
const CAR_STOP_PAUSE = 1.0;     // s a car stands at a stop sign's line before going on
const PULL_IN = STOP_BACK + 2;   // m past its line a left turn waiting for oncoming traffic pulls in to (its line, then 1.5 m in)
const GIVE_WAY_GAP = 3.4;   // m between centre lines: closer than this, a car and the truck would touch (the truck's rear cuts its turns)
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
    return { rng: this.rng.s, id: this.nextId, cars: this.cars.map((c) => ({ ...c, kind: c.kind.id, path: c.path.route, next: c.next?.route ?? null })) };
  }
  load(o: ReturnType<Traffic["save"]>, plan: CityPlan) {
    this.rng.s = o.rng; this.nextId = o.id;
    this.cars = o.cars.map((c) => ({ ...c, kind: this.kinds.find((k) => k.id === c.kind)!, path: new Path(plan.graph, c.path), next: c.next ? new Path(plan.graph, c.next) : null }));   // (`next` absent in older saves: null)
    for (const c of this.cars) c.path.eval(c.s, this.pose);   // the path remembers its last lane offset
    this.obstacles.length = 0;
  }

  // `truck` is the truck's body as circles; `peds` the pedestrians. `density` scales how many.
  // One fixed step (the journey's), around `focus`; `prs` are the signals the truck has held.
  // The truck's own path and where it is on it (its rear axle), and how far its body reaches
  // ahead of and behind that: cars give way to it where their ways cross (giveWay).
  private truckPath: { path: Path; s: number; v: number; front: number; rear: number } | null = null;
  // The truck arriving at the town's gate: the junction inside it, and the gate street.
  private truckGate: { node: number; street: number } | null = null;
  // The truck's way where it lands off a freeway exit ramp, sampled every 1.5 m (x, z pairs).
  private landing: number[] = [];
  private landingAt = 0;   // (the sample there the ramp meets the street)
  step(plan: CityPlan, simTime: number, prs: SignalPreempt[], focus: { x: number; z: number }, truck: Obstacle[], truckHeading: number, peds: Obstacle[], truckPath: { path: Path; s: number; v: number; front: number; rear: number } | null = null, truckGate: { node: number; street: number } | null = null, landing: { path: Path; s0: number; s1: number; at: number } | null = null) {
    this.truckPath = truckPath; this.truckGate = truckGate;
    this.landing.length = 0;
    if (landing) for (let a = landing.s0; a <= Math.min(landing.s1, landing.path.length); a += 1.5) { landing.path.peek(a, this.gw0); this.landing.push(this.gw0.x, this.gw0.z); }
    this.landingAt = landing ? Math.round((landing.at - landing.s0) / 1.5) : 0;
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
    for (let tries = 0; tries < 3 && this.cars.length < want; tries++) this.spawn(plan, focus, truck, simTime, prs);
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
    for (let i = this.cars.length - 1; i >= 0; i--) this.drive(this.cars[i], dt, plan, simTime, prs, truck, truckHeading, peds, i, ignore[i]);
  }

  private spawn(plan: CityPlan, focus: { x: number; z: number }, truck: Obstacle[], simTime: number, prs: SignalPreempt[]) {
    const r = this.rnd;
    const ang = r() * Math.PI * 2, dist = TRAFFIC_SPAWN[0] + r() * (TRAFFIC_SPAWN[1] - TRAFFIC_SPAWN[0]);
    const px = focus.x + Math.cos(ang) * dist, pz = focus.z + Math.sin(ang) * dist;
    // Onto the nearest street (a cable car: the nearest with tracks), one way or the other,
    // `before` metres short of the node it runs to.
    const G = plan.graph, fwd = r() < 0.5, before0 = 15 + r() * 35;
    let kind = this.pickKind(plan);
    let cable = false;
    if (plan.style.cableCar && r() < 0.25 && this.count("cablecar") < 2) { kind = this.kinds.find((k) => k.id === "cablecar")!; cable = true; }
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
    // Short of a light that isn't green: not past its stop line, and stopped there if it is too
    // close to stop from speed.
    let v = kind.vmax * 0.7;
    // (No faster than it can stop from, 6 m short of the first junction's line: it may have to
    // give way there, to a car already crossing.)
    const n0 = path.nodes[0];
    if (n0) v = Math.min(v, Math.sqrt(9 * Math.max(0, n0.sLine - 0.8 - kind.len / 2 - 6)));
    const sg = path.signals[0];
    if (sg && signalState(G.nodes[sg.node], sg.phase, simTime, plan.seed, prs) !== "green") {
      const dist = sg.sLine - 0.8 - kind.len / 2;
      if (dist < 0.5) return;
      if (dist < v * v / 9 + 1) v = 0;
    }
    const next = this.planOn(G, path, cable, path.endA);
    const color = kind.colors ? pick(r, kind.colors) : 0xffffff;
    const model: TruckModel | null = kind.id === "ryder" ? (r() < 0.5 ? "box16" : "box26") : null;
    this.cars.push({ kind, path, next, s: 0, v, dodge: cable ? -3 : 0, dodgeTarget: cable ? -3 : 0, dodgeV: 0, holdT: 0, stillT: 0, committed: -1, stopFor: -1, blockedBy: -1, slowT: 0, pedT: 0, acc: 0,
      color, x: this.pose.x, z: this.pose.z, h: this.pose.h, px: this.pose.x, pz: this.pose.z, ph: this.pose.h, cable, id: this.nextId++, model });
  }
  private count(id: string) { let n = 0; for (const c of this.cars) if (c.kind.id === id) n++; return n; }
  private pickKind(plan: CityPlan): VehicleKind | null {
    const pool = this.kinds.filter((k) => k.weight > 0 && (k.id !== "icecream" || plan.style.id !== "port"));
    let t = this.rnd() * pool.reduce((a, k) => a + k.weight, 0);
    for (const k of pool) { if ((t -= k.weight) < 0) return k; }
    return pool[0] ?? null;
  }
  // Where car c is to wait for the truck (an s on its path), or null. The truck's path through a
  // node c's path goes through next (within 30 m of c), not yet left by the truck's tail: where
  // the truck turns off into c's street, c waits 6 m short of its line; otherwise, with the truck
  // within 55 m, if the two ways come within GIVE_WAY_GAP of each other in the junction
  // (sampled every 1.5 m), at its line. A car on the truck's own approach follows it as any
  // car ahead.
  private giveWay(c: Car, G: CityGraph): number | null {
    const r = this.giveWayAt(c, G);
    if (r === null) c.gwNode = -1;
    return r;
  }
  private giveWayAt(c: Car, G: CityGraph): number | null {
    const T = this.truckPath, gate = this.truckGate;
    if (!T && !gate) return null;
    // (The node next on its path, or, past the last, on the next path planned: one coming up fast
    // on a junction just round from where its path ends must see it in time to stop. `off` is
    // where that path starts on this one's s.)
    let n = this.nextNode(c), p = c.path, off = 0;
    if (!n && c.next) { const m = c.next.nodes[0]; if (m && c.path.length + m.sLine - c.s <= 30) { n = m; p = c.next; off = c.path.length; } }
    if (!n) return null;
    const line = off + n.sLine;
    // (The truck about to come in at the gate, its way on not yet known: every approach to the
    // junction inside the gate but the gate street's waits.)
    if (gate) return n.node === gate.node && (n.from >> 1) !== gate.street ? line : null;
    if (!T) return null;
    for (const tn of T.path.nodes) {
      if (tn.node !== n.node || tn.from === n.from || T.s + T.rear > tn.sOut) continue;
      // (The truck turning into c's street: c holds back from as soon as the truck is 120 m off,
      // so it has not already pulled up to the line, in the way of the truck's swing.)
      // (Only where the truck turns: going straight on, it leaves by the street oncoming cars come
      // by, and they meet it below. And only while c is still short of that point.)
      if ((tn.to >> 1) === (n.from >> 1) && tn.move !== "S" && tn.sLine - T.s < 120 && c.s + c.kind.len / 2 + 0.8 < line - 6 + 0.5) return line - 6;
      // (Once holding for the truck here, it holds until the truck's tail is through: the truck
      // coming in and out of range must not let it creep out in front of it.)
      if (c.gwNode === n.node && (T.v > 0.5 || tn.sLine - T.s < 15)) return line;   // (not for a truck stopped well short, at its own red)
      // (55 m: 5 s at the truck's town speed, time enough to pull out of the way; or, for a car
      // that would take longer to get through and clear, as a slow left turn pulling away from
      // its line does, as far as the truck comes in that time.)
      const clearT = (off + Math.min(n.sOut, p.length) - c.s + c.kind.len) / Math.max(c.v, 3) + 1;
      if (tn.sLine - T.s > Math.max(55, T.v * clearT)) continue;
      if (this.pathsNear(T.path, Math.max(T.s + T.rear, tn.sLine - 4), Math.min(tn.sOut + 6, T.path.length), p, n.sLine, Math.min(n.sOut + 4, p.length), GIVE_WAY_GAP) < GIVE_WAY_GAP) { c.gwNode = n.node; return line; }
    }
    return null;
  }
  private gw0: Pose = { x: 0, z: 0, h: 0, k: 0 }; private gw1: Pose = { x: 0, z: 0, h: 0, k: 0 };
  // The node car c's path comes to next, within 30 m and its line not yet crossed, or null.
  // (`past`: how far past its line the car may be and the node still count: junctionPriority
  // reaches to where a left turn pulls in to wait.)
  private nextNode(c: Car, past = 0.5) {
    for (const n of c.path.nodes) if (c.s <= n.sLine + past && n.sLine - c.s <= 30) return n;
    return null;
  }
  // The least distance between path P over [a0, a1] and path Q over [b0, b1], sampled every
  // 1.5 m along each, giving up once under `enough`.
  private pathsNear(P: Path, a0: number, a1: number, Q: Path, b0: number, b1: number, enough: number): number {
    let near = Infinity;
    for (let a = a0; a <= a1 && near >= enough; a += 1.5) {
      P.peek(a, this.gw0);
      for (let b = b0; b <= b1; b += 1.5) { Q.peek(b, this.gw1); near = Math.min(near, Math.hypot(this.gw0.x - this.gw1.x, this.gw0.z - this.gw1.z)); }
    }
    return near;
  }
  // Where car c is to wait for the truck landing off an exit ramp or pulling out of a dock bay (an
  // s, as giveWay's), or null: short of the first point in its next 35 m (on along its next path
  // too) within GIVE_WAY_GAP + 1.5 of the truck's way there. A car already on that way 3 m past
  // the landing, going its way (ahead of the truck on it), carries on; one beside the foot, short
  // of it, waits where it is.
  private landingWay(c: Car, half: number): number | null {
    const P = this.landing;
    if (!P.length) return null;
    // (On the street past where the ramp meets it, ahead of the truck and going its way, in its lane
    // or the next: it carries on. Stopping there would stop it in the truck's way.)
    let best = Infinity, bi = -1;
    for (let i = 0; i < P.length; i += 2) { const d = Math.hypot(P[i] - c.x, P[i + 1] - c.z); if (d < best) { best = d; bi = i / 2; } }
    // (Past the foot by 3 m at least: one coming up the street to it isn't ahead of the truck yet.)
    if (best < GIVE_WAY_GAP + 1.5 && bi >= this.landingAt + 2 && P.length >= 4) {
      const k = Math.min(bi, P.length / 2 - 2) * 2, wx = P[k + 2] - P[k], wz = P[k + 3] - P[k + 1];
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
      // (With room to spare: a car turning in to run alongside the truck's way meets it at a slant,
      // and stopped 2 m short along its own way would still be beside it.)
      for (let i = 0; i < P.length && !near; i += 2) near = Math.hypot(P[i] - this.gw1.x, P[i + 1] - this.gw1.z) < GIVE_WAY_GAP + 1.5;
      // (b is where c's middle would be on the truck's way: c is to stop with its front 2 m short
      // of that point, so its "line", as giveWay's, 1.2 m short: the caller stops it 0.8 m and
      // half a length further back.)
      if (near) return b - 1.2;
    }
    return null;
  }
  // The stop line of the node car c comes to next (within 30 m, not yet crossed) if another car
  // has the junction first where their ways cross in it (within 2.6 m: sampled every 1.5 m):
  // one already in it, or one coming from another approach, not held at a light, within 15 m of
  // its line or 2.5 s at its speed (a car coming fast is there sooner; 6 s for c going slowly or
  // starting from a stop, which takes that long to get going and clear), that goes before c:
  // going straight or right where c turns left, else the one due at its line first (then the
  // lower id). A car past its line, in the junction, goes before one waiting at its line. Else
  // null.
  private junctionPriority(c: Car): number | null {
    const p = c.path, n = this.nextNode(c, PULL_IN);
    if (!n) return null;
    // (When each is due at its line: from where it stops for it, its front 0.8 m short.)
    const tc = Math.max(0, n.sLine - 0.8 - c.kind.len / 2 - c.s) / Math.max(c.v, 1);
    for (const o of this.cars) {
      if (o === c) continue;
      // (Its way through the node: on its path, or on the next one, planned already, for a car
      // whose path ends short of it: os is then its s on that next path.)
      let m: Path["nodes"][number] | null = null, P = o.path, os = o.s;
      for (const x of o.path.nodes) if (x.node === n.node) { m = x; break; }
      if (!m && o.next) for (const x of o.next.nodes) if (x.node === n.node) { m = x; P = o.next; os = o.s - o.path.length; break; }
      if (!m || m.from === n.from || os > m.sOut) continue;
      const inside = os > m.sLine + 0.5;
      // (One held at a light doesn't count; one moving off from it on green does. Nor one stopped
      // in a queue behind another, nor one waiting for the truck to go by, nor one itself holding
      // at its line for another, unless it holds for this one and has the lower id: then it goes
      // first.)
      if (!inside && (m.sLine - os > Math.max(15, o.v * (c.v < 5 ? 6 : 2.5)) || o.stopFor >= 0 || (o.v < 0.5 && o.blockedBy >= 0) || o.truckHold || (o.held && o.id > c.id))) continue;
      if (!inside) {
        // (c already in the junction, past its line, goes first over o waiting at its line, which
        // holds for it. Not over one coming on: a left turn pulled in to wait still waits for that.)
        if (c.s > n.sLine + 0.5 && o.v < 2) continue;
        const cl = n.move === "L", ol = m.move === "L", to = Math.max(0, m.sLine - 0.8 - o.kind.len / 2 - os) / Math.max(o.v, 1);
        // (c goes first: straight or right against a left turn, else due at its line first. But a
        // slow car, or one pulling away from a stop, takes some 6 s to get going and clear: not in
        // front of a faster one coming on that will be there sooner.)
        const cFirst = cl !== ol ? !cl : tc < to || (tc === to && c.id < o.id);
        if (cFirst && !(c.v < 5 && o.v > c.v + 2 && to < 6)) continue;
      }
      if (this.pathsNear(P, Math.max(os, m.sLine), Math.min(m.sOut + 3, P.length), p, n.sLine, Math.min(n.sOut + 3, p.length), 2.6) < 2.6) return n.sLine;
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
      // (Not one that is itself holding, waiting its turn in the junction: junctionPriority settles
      // that, and counting it here would have every car round a junction hold for the others.)
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
  // Whether the truck's way goes through node `node`, its tail not yet out of it, the truck within
  // 120 m of it (or the truck about to come in at the gate there).
  private truckDue(node: number): boolean {
    const T = this.truckPath;
    if (this.truckGate?.node === node) return true;
    if (!T) return false;
    for (const tn of T.path.nodes) if (tn.node === node && T.s + T.rear <= tn.sOut && tn.sLine - T.s < 120) return true;
    return false;
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
  private validMove(G: CityGraph, d: number, cable: boolean): number {
    const ok = (e: number) => G.streets[e >> 1].inCity && (!cable || !!G.streets[e >> 1].tags.cable);
    const moves = G.movesFrom(d);
    for (let k = 0; k < 4; k++) {
      const m = this.pickMove(cable), o = moves.filter((x) => x.move === m && ok(x.to));
      if (o.length) return o[Math.floor(this.rnd() * o.length)].to;
    }
    if (!cable) for (const m of ["S", "R", "L"] as Move[]) { const o = moves.find((x) => x.move === m && ok(x.to)); if (o) return o.to; }
    return -1;
  }
  private pickMove(cable: boolean): Move {
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
    // (And the turn after this path's end, planned already: on a short street it is close. Read
    // from where the car will be in 0.6 s too, as its speed follows the limit that far behind; and
    // from where it is, so a turn it is in still holds it to the end.)
    const sa = c.s + c.v * 0.6;
    let limit = Math.min(c.kind.vmax, p.speedLimit(c.s, 2.5), p.speedLimit(sa, 2.5), c.next ? c.next.speedLimit(sa - p.length, 2.5) : Infinity);
    let hardStop = Infinity, signalBrake = 0;
    // Signals (the same rule as the truck: right on red after a pause). The next one ahead on this
    // path, or past its end the next node's: a path ends 30 m beyond its last node, so the next
    // stop line is only ~12 m into the next path, too late to stop from city speed. (Key
    // p.signals.length stands for that one; it becomes key 0 on the next path.)
    const G = plan.graph;
    let sg: { node: number; phase: number; sLine: number; move: string } | null = null, key = 0;
    for (; key < p.signals.length; key++) if (c.s <= p.signals[key].sLine - 0.8 - half + 0.5) { sg = p.signals[key]; break; }
    if (!sg) {
      const e = p.endEdge, N = G.nodes[G.dedgeTo(e)], ai = G.armIndexIn(e);
      if (N.control === "signal") sg = { node: N.id, phase: N.phaseOf[ai], sLine: p.length + G.faceLen(e) - p.endA - N.arms[ai].mouth - STOP_BACK, move: "?" };
    }
    let greenLeft = -1;   // (the node whose light is green for this car's left turn, or -1)
    if (sg) {
      const target = sg.sLine - 0.8 - half, dist = target - c.s;
      const state = signalState(G.nodes[sg.node], sg.phase, simTime, plan.seed, prs);
      if (state === "green" && sg.move === "L") greenLeft = sg.node;
      if (state === "green") { if (c.stopFor === key) c.stopFor = -1; }
      else if (c.committed !== key) {
        if (state === "red" && sg.move === "R" && !c.cable && c.stillT > 1.2 && dist < 1.2) c.committed = key;
        // Stop if it can (about 4.5 m/s^2 at most); once stopping for a light it never changes its
        // mind and runs it.
        else if (c.stopFor === key || dist >= c.v * c.v / 9 - 0.5) {
          c.stopFor = key;
          limit = Math.min(limit, Math.sqrt(5 * Math.max(0, dist))); hardStop = target;
          signalBrake = c.v * c.v / (2 * Math.max(dist, 0.1));
        } else c.committed = key;   // too close to stop: go through
      }
    }
    // Never into a junction it can't get out of: with a slow car queued just past it on the way
    // out, it waits at the line rather than stop in the middle and block the crossing traffic; nor
    // ahead of a car that has the junction first (junctionPriority).
    // (A left turn on a green, held by oncoming traffic, pulls into the junction to wait, as drivers
    // do: past its line, it turns as soon as the way is clear, the light changed or not.)
    const bb = this.boxBlocked(c), jp = bb === null ? this.junctionPriority(c) : null;
    // (Not with the truck due through the junction: it waits at its line, where giveWay holds it.)
    // (Any other already past its line when it must give way waits there too, short of the other's
    // way; but creeping away from a stop it stops where it is: creeping on to where a left turn
    // waits could take it across the other's way.)
    const pastLine = jp !== null && c.s > jp - 0.8 - half + 0.5;
    const pullIn = jp !== null && (pastLine || (greenLeft >= 0 && greenLeft === this.nextNode(c)?.node && !this.truckDue(greenLeft)));
    const box = bb ?? (jp === null ? null : pastLine && c.v < 2 && c.stopOk === this.nextNode(c, PULL_IN)?.node ? c.s + 0.8 + half : pullIn ? jp + PULL_IN - 0.5 : jp);
    c.held = box !== null;
    if (box !== null) {
      const target = box - 0.8 - half, dist = target - c.s;
      if (dist >= c.v * c.v / 9 - 0.5) { limit = Math.min(limit, Math.sqrt(5 * Math.max(0, dist))); hardStop = Math.min(hardStop, target); }
    }
    // The truck about to go through a node ahead whose way crosses this car's there (or landing
    // off an exit ramp across it): wait at the line (further back where the truck turns into this
    // street: its rear swings in), unless too close to stop.
    const gw = this.giveWay(c, G) ?? this.landingWay(c, half);
    c.truckHold = gw !== null;
    if (gw !== null) {
      // (Creeping at the line, it can still stop there.)
      const target = gw - 0.8 - half, dist = target - c.s;
      // (Braking as for a red light, firmly enough to stop there: the eased limit alone trails it.)
      if (dist >= c.v * c.v / 9 - 0.5 || (c.v < 2 && dist > -1.5)) { limit = Math.min(limit, Math.sqrt(5 * Math.max(0, dist))); hardStop = Math.min(hardStop, Math.max(target, c.s)); signalBrake = Math.max(signalBrake, c.v * c.v / (2 * Math.max(dist, 0.1))); }
    }
    // An all-way stop ahead (on this path, or past its end on the next): a full stop at the line,
    // a second's pause, then on when nothing with the junction first is crossing (junctionPriority,
    // above, keeps it there). Too close to stop: it rolls on through.
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
        const r = o.path.route, onRing = G.streets[r.d >> 1].oneway, joining = r.edges.length > 0 && G.streets[r.edges[0] >> 1].oneway;
        if (!onRing && !joining) continue;                       // out on an approach street
        if (G.dedgeTo(r.d) === y.node && (!joining || o.s > r.before)) continue;   // coming off the ring here, or gone on past
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
    let gap = Infinity, truckBehind = Infinity, otherLaneBlocked = false, stillAhead = Infinity, gapOwner = -1, gapPed = false, truckAhead = Infinity;
    const look = 10 + c.v * 2.4;   // far enough to stop comfortably from city speed
    // The lane we'd move into: the inner lane 3 m to the left, or back to the kerb lane. (`side`
    // below is measured to the right: (lx, lz) points right of the heading.)
    const otherLane = c.dodge < -1.5 ? 3 : -3;
    const reach = Math.max(look, 45) + half + 12;   // nothing further away matters
    // (Where the path takes the car sideways over the next dAhead m, as a lane change for a turn
    // ahead does: the truck in the lane it is moving into is ahead of it too.)
    const dAhead = Math.max(8, c.v * 1.6), pe = turningNow ? null : p.peek(Math.min(c.s + dAhead, p.length), this.gw1);
    const latAhead = pe ? (pe.x - c.x) * lx + (pe.z - c.z) * lz : 0;
    const scan = (o: Obstacle, isTruck: boolean, ped = false) => {
      const rx = o.x - c.x, rz = o.z - c.z;
      if (rx > reach || rx < -reach || rz > reach || rz < -reach) return;
      const along = rx * fx + rz * fz, side = rx * lx + rz * lz;
      // (Where the truck reversing into a bay will be: ahead, kept clear of; level with or over
      // the car already, driven on out of before it comes.)
      if (o.sweep && along <= half + o.r) return;
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
      // (A parked truck alongside, not yet clear of it sideways: held there while it eases out.)
      if (o.still && Math.abs(along) <= half && Math.abs(side) < rLat + c.kind.width * 0.5) { gap = Math.min(gap, 0.5); truckAhead = Math.min(truckAhead, 0.5); }
      const sideLane = isTruck && Math.abs(latAhead) > 0.5 ? side - latAhead * Math.min(1, Math.max(0, along) / dAhead) : sideEff;
      // (Turning, judged along the car's own way round, not its heading: a car stopped further
      // round the curve sits off to the side of the heading, but on the way.)
      let onWay = false;
      if (turningNow && !ped && along > half && along < look + o.r) { const q = p.peek(Math.min(c.s + along, p.length), this.gw1); onWay = Math.hypot(o.x - q.x, o.z - q.z) < rLat + c.kind.width * 0.5; }
      // (A car alongside, level or ahead, in the lane this one's path is moving it into: it waits,
      // so the other goes on by, and then moves over behind it.)
      if (!isTruck && !ped && Math.abs(latAhead) > 0.5 && Math.sign(side) === Math.sign(latAhead) && Math.abs(side) > 0.8 && along > -0.5 && along <= half + o.r && Math.abs(side - latAhead) < rLat + c.kind.width * 0.5 && o.owner !== ignoreId && 0.5 < gap) { gap = 0.5; gapOwner = o.owner ?? -1; }
      if (along > half && along < look + o.r && (onWay || Math.abs(sideEff) < rLat + c.kind.width * 0.5 || Math.abs(sideLane) < rLat + c.kind.width * 0.5) && o.owner !== ignoreId) {
        const g = along - half - o.r;
        if (g < gap) { gap = g; gapOwner = o.owner ?? -1; gapPed = ped; }
        if (isTruck) truckAhead = Math.min(truckAhead, g);
      }
      if (Math.abs(along) < half + 8 && Math.abs(side - otherLane) < 1.5 + o.r * 0.5) otherLaneBlocked = true;
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
      // Stopping for a light: at least the braking that ends at the line (the eased limit above
      // trails the stop and would reach it still rolling).
      if (signalBrake > 1.5) c.acc = Math.min(c.acc, -Math.min(signalBrake, 7));
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
    // (truckBehind counts only a truck overlapping it sideways: moved over or not, it would be hit.
    // It is measured to the truck's circles, whose front one sits short of its nose: 1.6 m.)
    if (truckBehind < 1.6) { this.cars.splice(index, 1); return; }
    // Next intersection: plan on from the end of this path.
    if (c.s >= p.length - 0.5) {
      // (From where the car is, by the move already picked for the next plan; then the one after.)
      const past = p.endA - (p.length - c.s);
      // (A car saved before cars planned ahead has none: its move is picked now.)
      const now = this.planOn(G, p, c.cable, past, c.next ? c.next.route.edges[0] : undefined);
      if (!now) { this.cars.splice(index, 1); return; }
      const next = p.signals.length;   // the next node's signal, already judged from this path
      c.path = now; c.next = this.planOn(G, now, c.cable, now.endA);
      c.s = 0; c.committed = c.committed === next ? 0 : -1; c.stopFor = c.stopFor === next ? 0 : -1;
    }
    c.path.eval(c.s, this.pose);
    const h = this.pose.h;
    c.x = this.pose.x + Math.sin(h) * c.dodge; c.z = this.pose.z + Math.cos(h) * c.dodge;   // negative dodge: to the left
    c.h = h;
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
          const off = this.v3.set(-0.35, 1.6, side).applyQuaternion(this.q);
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
  b.box(0, 1.25, 0, L, 0.56, W, BLUE);                                     // livery band
  b.box(-0.2, 2.25, 0, L - 0.4, 1.45, W, BODY);                            // upper body
  b.box(0.15, 2.18, 0, L - 2.0, 1.0, W + 0.02, GLASS);                     // side windows
  for (let x = R + 1.6; x < F - 1.2; x += 1.45) b.box(x, 2.18, 0, 0.14, 1.02, W + 0.04, PILLAR);
  b.box(0, 2.95, 0, L - 0.5, 0.18, W - 0.1, BODY);                         // roof, rounded in by a step
  b.box(-1.0, 3.18, 0, 3.4, 0.3, 1.8, 0xd8dad6); b.box(R + 1.4, 3.15, 0, 1.6, 0.25, 1.6, 0xd8dad6);   // AC and battery pods
  // Front: windscreen, destination sign, bumper, lamps.
  b.box(F - 0.055, 1.95, 0, 0.12, 1.45, W - 0.18, GLASS);   // (5 mm proud of the livery band: shared planes flicker)
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

// The street nearest (x, z) by its centre line (with tracks, for a cable car), round the point's
// tile, or -1.
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
