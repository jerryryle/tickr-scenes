// Clowns: the way out of any gridlock nothing else undoes. Held standing in the street CLOWN_AFTER s
// (journey.ts jamT: well past its honk, to which nobody pays any mind), the truck is rescued by a
// troupe of clowns. They run in from out of sight along its way ahead, crowd round whatever holds
// it up (a car, a bus, someone on foot), lift it over their heads and run off with it, on along the
// pavement and out of sight, where it is gone. While it is still held, the last lot well away, they
// come back for the next thing in its way, as often as it takes.
// They try to keep to the street, but they and what they carry go through whatever is in their way:
// nobody waits on them but the truck (and traffic, as for anyone on foot). What they hold is held
// from when they set out for it (traffic.ts holdCar; someone on foot, by their cid, crowd.ts) and taken out of the town as
// they lift it (takeCar, takePed), then theirs: drawn here, a car by traffic.ts (lifted).
// Stepped with street life (life.ts), on the journey's clock, and saved with the crowd: a scrub
// replays them as played.
import { Figures, walkSwing } from "./figure.ts";
import type { Body } from "./figure.ts";
import { hash2 } from "./rng.ts";
import { SIM_DT } from "./journey.ts";
import type { Journey } from "./journey.ts";
import type { LiftedCar, LiftDraw, Obstacle, Traffic } from "./traffic.ts";
import type { Crowd, Ped } from "./crowd.ts";
import type { Pose } from "./route.ts";
import { SPECS, TRAILER, truckExtents } from "./truck.ts";
import { KINGPIN_TO_AXLES } from "./hitch.ts";
import { CURB_H } from "./grid.ts";
import { DEBUG_CLOWN_AFTER } from "./debug.ts";
import * as THREE from "three@0.187.0";

const CLOWN_AFTER = DEBUG_CLOWN_AFTER || 30;   // s the truck stands held (journey.ts jamT) before they come (its honk is at 14)
const CLOWN_AGAIN = 4;    // s still held, the last lot CLOWN_AWAY m off with theirs, before the next lot comes
const CLOWN_AWAY = 15;          // m
const CLOWN_REACH = 55;         // m: how far along its way ahead they come from, and take it (out of sight)
const CLOWN_SIDE = 3.2;         // m: how far beside its lane (to the kerb side) the pavement they run along is
const CLOWN_RUN_V = 6, CLOWN_CARRY_V = 4;   // m/s: running in, and carrying
const CLOWN_LIFT_T = 1.2;       // s: up over their heads
const CLOWN_STRAGGLE = 20;      // s: the most they wait for the last one in before lifting
const CLOWN_SPREAD = 1.4;       // m: how far across each other they run in, at most
const CLOWN_TURN = 1.5;         // rad/s: how fast what they carry turns to the way they go
const CLOWN_HANDS = 2.02;       // m: their hands, arms up (figure.ts: hips 0.86, shoulders 0.58 on, arms 0.6)
const CLOWN_CAR_Y = CLOWN_HANDS - 0.3, CLOWN_PED_Y = CLOWN_HANDS + 0.08;   // m: a car's ground (its sills 0.3 up) and a lying person's middle, held up
const CLOWN_SUITS = [0xe8202a, 0x1f6fe0, 0xf2c200, 0x22a845, 0x9b30d0, 0xff7a00, 0xff4fa8, 0x00b4c8];
const CLOWN_WIGS = [0xff5a00, 0x2a9a3a, 0x2060ff, 0xff2a8a, 0xffd000, 0xc81e1e];
const CLOWN_SHOES = [0xd01818, 0xf2c200, 0x1a1a1a, 0x2a6be0, 0x22a845];
const CLOWN_FACE = 0xfaf6f0, CLOWN_NOSE = 0xff1010, CLOWN_RUFF = 0xffffff;

interface ClownBody {
  sa: number; sb: number;            // their place round what they carry: along it and out to its side (its carry frame)
  kerb?: boolean;                    // up on the pavement (their way's later legs, laid along it), not in the road
  d: number; v: number; spread: number; back?: boolean;   // running in: how far along the way they still have to come, their pace, how far across; turned back (nothing to carry)
  x: number; z: number; h: number; px: number; pz: number; ph: number; phase: number; pphase: number;
  suit: number; trim: number; wig: number; shoes: number; hat: number | null;
}
interface ClownLot {
  id: number; state: "in" | "lift" | "out"; t: number;
  car: number;                       // the car held for them (traffic.ts holdCar), or -1: someone on foot (crowd.ts holdPed, by id)
  load: { car: LiftedCar } | { ped: Ped } | null;   // what they carry, once lifted
  L: number; W: number;              // its size, in its carry frame
  x: number; z: number; h: number; y: number; px: number; pz: number; ph: number; py: number;   // where it is (h: its carry frame's heading)
  flip: number;                      // how its own heading is turned from that (0 or PI)
  ox: number; oz: number; mh: number; side: number;   // where it was, the way they take it off and which side of the truck's way they go (1 right, -1 left), for the director's shot of them
  pave?: boolean;                    // its later legs laid along the pavement (driving, on the kerb side), not in the road
  route: number[];                   // x, z: from where it was out to where they come from and go
  u: number;                         // how far along that they have carried it
  clowns: ClownBody[];
}
const _clq: Pose = { x: 0, z: 0, h: 0, k: 0 };

export class Clowns {
  private waves: ClownLot[] = [];
  private nextId = 1;
  private since = 0;     // s held since the last lot were well away
  private came = false;  // a lot has come in this jam
  readonly obstacles: Obstacle[] = [];   // the clowns, for the truck and traffic to wait for (crowd.ts)
  private F: Figures | null;

  constructor(scene: THREE.Scene | null, material: THREE.Material | null) {
    this.F = scene && material ? new Figures(scene, material, 1400) : null;
  }

  clear() { this.waves.length = 0; this.since = 0; this.came = false; this.obstacles.length = 0; }
  reset() { this.clear(); this.nextId = 1; }
  save() { return { w: this.waves, n: this.nextId, s: this.since, c: this.came }; }
  load(o: ReturnType<Clowns["save"]> | undefined) {
    this.waves = o?.w ?? []; this.nextId = o?.n ?? 1; this.since = o?.s ?? 0; this.came = o?.c ?? false;
    this.fillObstacles();
  }
  // The rescue to film (director.ts): the first lot still on its way in, lifting, or not yet far off
  // with theirs; where what they came for was, and the way they take it off.
  // (One kept object, filled in: the director asks every frame.)
  private focusOut = { id: 0, x: 0, z: 0, h: 0, side: 1, up: false };
  get focus(): { id: number; x: number; z: number; h: number; side: number; up: boolean } | null {
    const f = this.focusOut;
    // (A lot setting out or lifting first, the newest: the last lot may still be near, off with theirs.)
    let best: ClownLot | null = null;
    for (const w of this.waves) if (w.state !== "out") best = w;
    if (!best) for (const w of this.waves) if (w.u < 22) { best = w; break; }
    if (!best) return null;
    f.id = best.id; f.x = best.ox; f.z = best.oz; f.h = best.mh; f.side = best.side ?? 1; f.up = best.state === "out";
    return f;
  }

  // One step. `body`: the truck's own circles where it stands.
  step(j: Journey, traffic: Traffic, crowd: Crowd, body: Obstacle[]) {
    const st = j.st, dt = SIM_DT;
    for (const w of this.waves) {
      w.px = w.x; w.pz = w.z; w.ph = w.h; w.py = w.y;
      for (const c of w.clowns) { c.px = c.x; c.pz = c.z; c.ph = c.h; c.pphase = c.phase; }
    }
    // A new lot: held long enough, none still on its way in or just off with theirs.
    const held = (st.mode === "drive" || st.mode === "reverse") && !!st.jamHeld && (st.jamT ?? 0) >= CLOWN_AFTER;
    if (!st.jamT) this.came = false;
    const pending = this.waves.some((w) => w.state !== "out" || w.u < CLOWN_AWAY);
    this.since = !held || pending ? 0 : this.since + dt;
    // (Nothing found to carry: they look again CLOWN_AGAIN s on, not every step.)
    if (held && !pending && (!this.came || this.since >= CLOWN_AGAIN)) { this.send(j, traffic, crowd, body); this.came = true; this.since = 0; }
    for (let i = this.waves.length - 1; i >= 0; i--) if (!this.stepWave(this.waves[i], traffic, crowd, dt)) this.waves.splice(i, 1);
    this.fillObstacles();
  }

  private fillObstacles() {
    this.obstacles.length = 0;
    for (const w of this.waves) for (const c of w.clowns) this.obstacles.push({ x: c.x, z: c.z, r: 0.35, vx: (c.x - c.px) / SIM_DT, vz: (c.z - c.pz) / SIM_DT });
  }

  // What holds the truck up, of what they can carry: of the vehicles and people about, the one that
  // comes into its way first, from its body where it stands on along its way (its next 12 m ahead, or
  // back into a bay); or, with none in it (held by a booking through a junction, say), the vehicle
  // its booking waits for, or the nearest vehicle or person just ahead of it. Then a lot sent for it.
  private way: Obstacle[] = [];
  private send(j: Journey, traffic: Traffic, crowd: Crowd, body: Obstacle[]): boolean {
    const st = j.st, P = j.path, p = j.pose, W = this.way;
    W.length = 0;
    for (const o of body) if (o.body) W.push(o);
    const E = truckExtents(st.truck);
    // (A tractor's trailer, its axles dragged along after the kingpin, swinging in across a turn, as
    // life.ts truckStop looks after it: someone on the pavement inside the turn holds it up too.)
    const fw = SPECS[st.truck].fifthWheel, K = KINGPIN_TO_AXLES;
    let ax = 0, az = 0;
    if (fw !== undefined) { const th = p.h + j.hitchYaw, kx = p.x + Math.cos(p.h) * fw, kz = p.z - Math.sin(p.h) * fw; ax = kx - Math.cos(th) * K; az = kz + Math.sin(th) * K; }
    if (P && st.mode === "drive") for (let a = 0.5; a <= 12; a += 1) {
      P.peek(Math.min(P.length, st.s + a), _clq);
      const fx = Math.cos(_clq.h), fz = -Math.sin(_clq.h);
      for (let b = fw !== undefined ? -1.5 : E.rear; ; b += 1.5) { const u = Math.min(b, E.front); W.push({ x: _clq.x + fx * u, z: _clq.z + fz * u, r: 1.3 }); if (u >= E.front) break; }
      if (fw === undefined) continue;
      const kx = _clq.x + fx * fw, kz = _clq.z + fz * fw, d = Math.hypot(kx - ax, kz - az) || 1;
      ax = kx - (kx - ax) / d * K; az = kz - (kz - az) / d * K;
      const tx = (kx - ax) / K, tz = (kz - az) / K;
      for (let b = TRAILER.rear; b <= TRAILER.front + 0.75; b += 1.5) { const u = Math.min(b, TRAILER.front); W.push({ x: kx + tx * u, z: kz + tz * u, r: TRAILER.hw + 0.1 }); }
    }
    else for (const o of body) if (o.sweep) W.push(o);
    const first = (x: number, z: number, r: number) => { for (let k = 0; k < W.length; k++) if (Math.hypot(W[k].x - x, W[k].z - z) < W[k].r + r + 0.5) return k; return Infinity; };
    let car = -1, ped = -1, best = Infinity;
    // (Not a vehicle driving by: only one standing, or near enough, can be what holds it up.)
    for (const o of traffic.obstacles) {
      if (o.owner === undefined || o.owner < 0 || traffic.isHeld(o.owner) || traffic.speedOf(o.owner) > 0.5) continue;
      const k = first(o.x, o.z, o.r);
      if (k < best) { best = k; car = o.owner; ped = -1; }
    }
    const people = crowd.people;
    for (let i = 0; i < people.length; i++) {
      if (people[i].cid !== undefined) continue;
      const k = first(people[i].x, people[i].z, 0.4);
      if (k < best) { best = k; ped = i; car = -1; }
    }
    // (Held by its booking through a junction: the car it waits for.)
    if (best === Infinity && traffic.truckWaitsOn >= 0 && !traffic.isHeld(traffic.truckWaitsOn) && traffic.speedOf(traffic.truckWaitsOn) <= 0.5 && traffic.obstacles.some((o) => o.owner === traffic.truckWaitsOn)) { car = traffic.truckWaitsOn; best = 0; }
    // (Else the nearest ahead of its nose (backing, behind its tail), within 15 m on and 4 m either
    // side of its line: never one behind it or off in another street. None such: no lot.)
    if (best === Infinity) {
      const dir = st.mode === "reverse" ? -1 : 1, fx = Math.cos(p.h) * dir, fz = -Math.sin(p.h) * dir, end = dir > 0 ? E.front : -E.rear, nx = p.x + fx * end, nz = p.z + fz * end;
      const ahead = (x: number, z: number) => { const a = (x - nx) * fx + (z - nz) * fz, b = Math.abs((x - nx) * fz - (z - nz) * fx); return a > -1 && a < 15 && b < 4 ? a : Infinity; };
      let bd = Infinity;
      for (const o of traffic.obstacles) { if (o.owner === undefined || o.owner < 0 || traffic.isHeld(o.owner) || traffic.speedOf(o.owner) > 0.5) continue; const d = ahead(o.x, o.z); if (d < bd) { bd = d; car = o.owner; } }
      if (car < 0) for (let i = 0; i < people.length; i++) { if (people[i].cid !== undefined) continue; const d = ahead(people[i].x, people[i].z); if (d < bd) { bd = d; ped = i; } }
    }
    if (car < 0 && ped < 0) return false;
    const id = this.nextId++;
    let x: number, z: number, h: number, L: number, Wd: number;
    if (car >= 0) { const c = traffic.holdCar(car)!; x = c.x; z = c.z; h = c.h; L = c.len; Wd = c.width; }
    else { const q = people[ped]; q.cid = id; x = q.x; z = q.z; h = q.h; L = 1.7 * (q.s ?? 1); Wd = 0.5; }
    // Their way: off to the side of the truck's lane it is on (the pavement, by the kerb; across the
    // way, if it is over there), and on along the truck's way to CLOWN_REACH m. Backing into a bay:
    // square off the truck's line, out of its sweep.
    const R: number[] = [x, z];
    let main: number, sideOf = 1;
    if (P && st.mode === "drive") {
      let sb = st.s, bd = Infinity;
      for (let s = Math.max(0, st.s - 15); s <= st.s + 40; s += 0.5) { P.peek(Math.min(P.length, s), _clq); const d = Math.hypot(_clq.x - x, _clq.z - z); if (d < bd) { bd = d; sb = s; } }
      P.peek(Math.min(P.length, sb), _clq);
      const lat = (x - _clq.x) * Math.sin(_clq.h) + (z - _clq.z) * Math.cos(_clq.h), side = lat < -1.2 ? -Math.max(CLOWN_SIDE + 3, -lat + 2.5) : CLOWN_SIDE;
      // (Over there, out past what they lift, in the road: not across to the far pavement, which
      // would have them cross every oncoming lane, traffic stopping for them, a hold-up of its own.)
      main = _clq.h; sideOf = side < 0 ? -1 : 1;
      let len = 0;
      for (let k = 0; len < CLOWN_REACH; k++) {
        const s = sb + 2 + 5 * k, q = P.peek(Math.min(P.length, s), _clq), over = Math.max(0, s - P.length);
        const px = q.x + Math.cos(q.h) * over + Math.sin(q.h) * side, pz = q.z - Math.sin(q.h) * over + Math.cos(q.h) * side;
        len += Math.hypot(px - R[R.length - 2], pz - R[R.length - 1]);
        R.push(px, pz);
      }
    } else {
      // (Square off the truck's line, to whichever side of it it is on: out of its sweep back into
      // the bay, not on along it into the dock.)
      const rx = Math.sin(p.h), rz = Math.cos(p.h), k = (x - p.x) * rx + (z - p.z) * rz < 0 ? -1 : 1, dx = rx * k, dz = rz * k;
      main = Math.atan2(-dz, dx);
      for (let k = 1; k <= Math.ceil(CLOWN_REACH / 5); k++) R.push(x + dx * 5 * k, z + dz * 5 * k);
    }
    // (Carried lengthways along their way: a car turned whichever way round it already nearly is.)
    const flip = car >= 0 && Math.cos(h - main) < 0 ? Math.PI : 0;
    const w: ClownLot = { id, state: "in", t: 0, car, load: null, L, W: Wd, x, z, h: car >= 0 ? h - flip : main, y: 0, px: x, pz: z, ph: 0, py: 0, flip, ox: x, oz: z, mh: main, side: sideOf, pave: !!(P && st.mode === "drive") && sideOf > 0, route: R, u: 0, clowns: [] };
    w.ph = w.h;
    const per = car >= 0 ? Math.max(1, Math.min(7, Math.round(L / 1.3))) : 2, total = clownRouteLen(R);
    for (let i = 0; i < per * 2; i++) {
      const r = (k: number) => hash2(id, i, k, 0xc10f), side = i % 2 ? 1 : -1, n = Math.floor(i / 2);
      const c: ClownBody = {
        sa: -L / 2 + L * (n + 0.5) / per, sb: side * (Wd / 2 + 0.3),
        d: total + i * 0.9 + r(1) * 2, v: CLOWN_RUN_V * (0.88 + r(2) * 0.24), spread: (r(3) - 0.5) * 2 * CLOWN_SPREAD,
        x: 0, z: 0, h: 0, px: 0, pz: 0, ph: 0, phase: r(4) * 10, pphase: 0,
        suit: CLOWN_SUITS[Math.floor(r(5) * CLOWN_SUITS.length)], trim: CLOWN_SUITS[Math.floor(r(6) * CLOWN_SUITS.length)], wig: CLOWN_WIGS[Math.floor(r(7) * CLOWN_WIGS.length)],
        shoes: CLOWN_SHOES[Math.floor(r(8) * CLOWN_SHOES.length)], hat: r(9) < 0.4 ? CLOWN_SUITS[Math.floor(r(10) * CLOWN_SUITS.length)] : null,
      };
      this.placeIn(w, c);
      c.px = c.x; c.pz = c.z; c.ph = c.h; c.pphase = c.phase;
      w.clowns.push(c);
    }
    this.waves.push(w);
    return true;
  }

  // Where clown c is coming in (or turned back): along the way from its far end, spread across it,
  // closing on its place round what it is to carry over its last 4 m.
  private placeIn(w: ClownLot, c: ClownBody) {
    const d = Math.max(0, c.d), q = clownAlong(w.route, d), k = Math.min(1, d / 4);
    const sx = w.x + Math.cos(w.h) * c.sa + Math.sin(w.h) * c.sb, sz = w.z - Math.sin(w.h) * c.sa + Math.cos(w.h) * c.sb;
    const ox = q.x + Math.sin(q.h) * c.spread * Math.min(1, d / 8), oz = q.z + Math.cos(q.h) * c.spread * Math.min(1, d / 8);
    const x = sx + (ox - sx) * k, z = sz + (oz - sz) * k;
    const mx = x - c.x, mz = z - c.z;
    c.kerb = !!w.pave && d > clownFirstLeg(w.route) + 1;
    c.x = x; c.z = z;
    // (Facing the way they run; there, in to what they are to lift.)
    if (Math.hypot(mx, mz) > 0.02) { c.h = Math.atan2(-mz, mx); c.phase += Math.hypot(mx, mz); }
    else c.h = clownTurn(c.h, w.h + (c.sb > 0 ? Math.PI / 2 : -Math.PI / 2), 8 * SIM_DT);
  }

  private stepWave(w: ClownLot, traffic: Traffic, crowd: Crowd, dt: number): boolean {
    w.t += dt;
    if (w.state === "in") {
      // (What they came for gone meanwhile: back the way they came, and gone too.)
      const there = w.car >= 0 ? traffic.isHeld(w.car) : crowd.people.some((q) => q.cid === w.id);
      if (!there) {
        for (const c of w.clowns) { c.back = true; c.d += c.v * dt; this.placeIn(w, c); }
        return w.clowns.some((c) => c.d < clownRouteLen(w.route) + 3);
      }
      let all = true;
      for (const c of w.clowns) { c.d -= c.v * dt; if (c.d > 0) all = false; this.placeIn(w, c); }
      if (all || w.t > CLOWN_STRAGGLE) {
        w.state = "lift"; w.t = 0;
        if (w.car >= 0) { const c = traffic.takeCar(w.car); w.load = c ? { car: c } : null; }
        else { const q = crowd.takePed(w.id); w.load = q ? { ped: q } : null; }
        for (const c of w.clowns) { c.d = 0; this.placeIn(w, c); }
      }
      return true;
    }
    if (w.state === "lift") {
      const k = Math.min(1, w.t / CLOWN_LIFT_T), e = k * k * (3 - 2 * k);
      w.y = e * (w.load && "car" in w.load ? CLOWN_CAR_Y : CLOWN_PED_Y);
      for (const c of w.clowns) c.h = clownTurn(c.h, w.h + (c.sb > 0 ? Math.PI / 2 : -Math.PI / 2), 8 * dt);
      if (w.t >= CLOWN_LIFT_T) { w.state = "out"; w.t = 0; }
      return true;
    }
    // Off with it: along their way, turning to it (but not on its first leg, out to the side: they
    // go crabwise), each in their place round it, facing the way they go.
    const total = clownRouteLen(w.route), v = Math.min(CLOWN_CARRY_V, 0.6 + w.t * 3);
    w.u = Math.min(total, w.u + v * dt);
    const q = clownAlong(w.route, w.u), first = clownFirstLeg(w.route);
    w.x = q.x; w.z = q.z;
    if (w.u > first) w.h = clownTurn(w.h, q.h, CLOWN_TURN * dt);
    // (Up the kerb with them, on the pavement.)
    w.y = (w.load && "car" in w.load ? CLOWN_CAR_Y : CLOWN_PED_Y) + (w.pave && w.u > first + 1 ? CURB_H : 0) + Math.sin(w.t * 13) * 0.04;
    for (const c of w.clowns) {
      const x = w.x + Math.cos(w.h) * c.sa + Math.sin(w.h) * c.sb, z = w.z - Math.sin(w.h) * c.sa + Math.cos(w.h) * c.sb;
      c.phase += Math.hypot(x - c.x, z - c.z); c.x = x; c.z = z; c.kerb = !!w.pave && w.u > first + 1;
      c.h = clownTurn(c.h, q.h, 6 * dt);
    }
    return w.u < total;
  }

  // The cars they carry, for traffic.ts to draw `alpha` of the way from the last step to this one.
  // (Its records kept and filled in again each frame: no garbage on a frame.)
  lifted(alpha: number, out: LiftDraw[]) {
    let n = 0;
    for (const w of this.waves) {
      if (!w.load || !("car" in w.load)) continue;
      const L = out[n] ?? (out[n] = { car: w.load.car, x: 0, y: 0, z: 0, h: 0, roll: 0 });
      n++;
      L.car = w.load.car; L.x = w.px + (w.x - w.px) * alpha; L.z = w.pz + (w.z - w.pz) * alpha; L.h = clownLerpAng(w.ph, w.h, alpha) + w.flip; L.y = w.py + (w.y - w.py) * alpha;
      L.roll = w.state === "out" ? Math.sin(w.t * 6.5) * 0.05 : 0;
    }
    out.length = n;
  }

  draw(alpha: number, time: number) {
    const F = this.F;
    if (!F) return;
    F.begin();
    for (const w of this.waves) {
      const lifting = w.state !== "in", y = w.py + (w.y - w.py) * alpha;
      for (const c of w.clowns) {
        if (!F.room(30)) break;
        const x = c.px + (c.x - c.px) * alpha, z = c.pz + (c.z - c.pz) * alpha, h = clownLerpAng(c.ph, c.h, alpha), ph = c.pphase + (c.phase - c.pphase) * alpha;
        const moving = Math.hypot(c.x - c.px, c.z - c.pz) > 0.01;
        this.clown(F, c, x, z, h, ph, moving, lifting ? Math.min(1, y / 1.2) : 0);
      }
      if (w.load && "ped" in w.load && F.room(30)) {
        const x = w.px + (w.x - w.px) * alpha, z = w.pz + (w.z - w.pz) * alpha, h = clownLerpAng(w.ph, w.h, alpha);
        clownLoad(F, w.load.ped, x, y, z, h, time);
      }
    }
    F.end_();
  }

  // A clown: white face, red nose, a wig in tufts, a ruff, pompoms down a baggy suit, long shoes;
  // sometimes a little hat. Running (arms pumping), or with arms up (`up` 0..1) to lift and carry.
  private clown(F: Figures, c: ClownBody, x: number, z: number, h: number, phase: number, moving: boolean, up: number) {
    const w = walkSwing(phase, true), run = moving ? 1 : 0;
    const arms: [number, number] = up > 0 ? [2.95 * up + w.arms[0] * run * (1 - up), 2.95 * up + w.arms[1] * run * (1 - up)] : [w.arms[0] * run, w.arms[1] * run];
    const b: Body = {
      x, z, yaw: h, y: (c.kerb ? CURB_H : 0.02) + (moving ? w.bob : 0), legs: moving ? w.legs : [0, 0], arms, lean: moving && up === 0 ? 0.18 : 0,
      armOut: up > 0 ? [0.12, 0.12] : [0.15, 0.15], shirt: c.suit, pants: c.suit, skin: CLOWN_FACE, hair: c.wig, bulk: 1.18,
    };
    F.person(b);
    const fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h), hd = F.head;
    // Wig: tufts either side of the head and a crown.
    for (const k of [-1, 1]) F.box(hd[0] + rx * k * 0.15 - fx * 0.03, hd[1] + 0.03, hd[2] + rz * k * 0.15 - fz * 0.03, 0.2, 0.2, 0.14, h, 0, c.wig);
    if (c.hat !== null) { F.box(hd[0], hd[1] + 0.2, hd[2], 0.14, 0.16, 0.14, h, 0, c.hat); F.box(hd[0], hd[1] + 0.31, hd[2], 0.06, 0.08, 0.06, h, 0, 0xffffff); }
    else F.box(hd[0] - fx * 0.02, hd[1] + 0.15, hd[2] - fz * 0.02, 0.18, 0.1, 0.18, h, 0, c.wig);
    F.box(hd[0] + fx * 0.12, hd[1] - 0.01, hd[2] + fz * 0.12, 0.07, 0.07, 0.07, h, 0, CLOWN_NOSE);
    F.box(hd[0] + fx * 0.105, hd[1] - 0.08, hd[2] + fz * 0.105, 0.02, 0.03, 0.12, h, 0, CLOWN_NOSE);   // the grin
    // Ruff at the neck; pompoms down the front.
    const nx = hd[0] - fx * 0.01, ny = hd[1] - 0.16, nz = hd[2] - fz * 0.01;
    F.box(nx, ny, nz, 0.34, 0.06, 0.5, h, 0, CLOWN_RUFF);
    for (const dy of [0.2, 0.38]) F.box(nx + fx * 0.17, ny - dy, nz + fz * 0.17, 0.07, 0.07, 0.07, h, 0, c.trim);
    // Long shoes.
    for (const f of [F.footL, F.footR]) F.box(f[0] + fx * 0.12, f[1] + 0.05, f[2] + fz * 0.12, 0.46, 0.1, 0.17, h, 0, c.shoes);
  }
}

// Someone carried flat on their back over the clowns' heads (along heading h, middle at y), legs
// and arms kicking (and their dog, cart or balloon with them).
function clownLoad(F: Figures, p: Ped, x: number, y: number, z: number, h: number, time: number) {
  const s = p.s ?? 1, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
  const at = (a: number, b: number, up: number): [number, number, number] => [x + fx * a + rx * b, y + up, z + fz * a + rz * b];
  let q = at(0.1 * s, 0, 0); F.box(q[0], q[1], q[2], 0.24 * s, 0.62 * s, 0.36 * s, h, -Math.PI / 2, p.shirt);   // torso, head forward
  q = at(0.56 * s, 0, 0.02); F.box(q[0], q[1], q[2], 0.24 * s, 0.21 * s, 0.2 * s, h, -Math.PI / 2, p.skin);
  q = at(0.69 * s, 0, 0.02); F.box(q[0], q[1], q[2], 0.07 * s, 0.22 * s, 0.22 * s, h, -Math.PI / 2, p.hat ?? p.hair);
  for (const k of [-1, 1]) {
    const kick = Math.sin(time * 11 + k) * 0.25, wave = Math.sin(time * 9 + k * 2) * 0.35;
    const hip = at(-0.2 * s, k * 0.1 * s, 0), foot = at(-1.0 * s, k * 0.16 * s, 0.2 + kick);
    F.seg(hip[0], hip[1], hip[2], foot[0], foot[1], foot[2], 0.13 * s, p.pants);
    const sh = at(0.35 * s, k * 0.24 * s, 0), hand = at(0.6 * s, k * 0.55 * s, 0.35 + wave);
    F.seg(sh[0], sh[1], sh[2], hand[0], hand[1], hand[2], 0.1 * s, p.shirt);
  }
  // (A dog walker's dog, carried off with them: sat up on their middle, wagging.)
  // (A hot-dog vendor's cart, carried along with them on top, its umbrella up; a chaser's balloon
  // still on its string, above them.)
  if (p.kind === "vendor") {
    q = at(-0.1, 0, 0.75); F.box(q[0], q[1], q[2], 1.6, 0.8, 0.9, h, 0, 0xd8dadc); F.box(q[0], q[1] + 0.45, q[2], 1.62, 0.1, 0.92, h, 0, 0xc0392b);
    F.box(q[0], q[1] + 1.0, q[2], 0.05, 1.1, 0.05, h, 0, 0x555555); F.box(q[0], q[1] + 1.55, q[2], 1.8, 0.1, 1.8, h, 0, 0xf2c200);
  }
  if (p.balloon) { const hd = at(0.6 * s, 0.55 * s, 0.35), bt = at(0.8 * s, 0.6 * s, 1.6 + Math.sin(time * 2) * 0.1); F.seg(hd[0], hd[1], hd[2], bt[0], bt[1], bt[2], 0.02, 0xeeeeee); F.box(bt[0], bt[1] + 0.25, bt[2], 0.42, 0.5, 0.42, 0, 0, 0xe8202a); }
  if (p.dog) { q = at(-0.15 * s, 0, 0.12); F.dog({ x: q[0], z: q[2], y: q[1], yaw: h + 1.2, phase: 0, gait: 0, color: p.dog.color, belle: p.dog.color === 0xf4ead8, tail: time * 12 }); }
}

function clownFirstLeg(R: number[]) { return Math.hypot(R[2] - R[0], R[3] - R[1]); }
function clownRouteLen(R: number[]) { let L = 0; for (let i = 2; i < R.length; i += 2) L += Math.hypot(R[i] - R[i - 2], R[i + 1] - R[i - 1]); return L; }
// The point d along polyline R (x, z pairs), and its heading there.
const _cla = { x: 0, z: 0, h: 0 };
function clownAlong(R: number[], d: number) {
  for (let i = 2; i < R.length; i += 2) {
    const dx = R[i] - R[i - 2], dz = R[i + 1] - R[i - 1], L = Math.hypot(dx, dz);
    if (d <= L || i === R.length - 2) { const t = L > 0 ? Math.min(1, d / L) : 0; _cla.x = R[i - 2] + dx * t; _cla.z = R[i - 1] + dz * t; _cla.h = Math.atan2(-dz, dx); return _cla; }
    d -= L;
  }
  _cla.x = R[0]; _cla.z = R[1]; _cla.h = 0; return _cla;
}
function clownTurn(h: number, to: number, max: number) { const d = Math.atan2(Math.sin(to - h), Math.cos(to - h)); return h + Math.max(-max, Math.min(max, d)); }
function clownLerpAng(a: number, b: number, t: number) { return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t; }
