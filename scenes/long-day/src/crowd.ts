// Street life: pedestrians (walkers, joggers, dog walkers with small dogs, a hot dog vendor, a
// street musician, someone chasing a runaway balloon) and birds circling overhead (pigeons, or
// gulls by the water). Every body part is a scaled unit cube in one InstancedMesh with
// per-instance colour, so the whole crowd is a single draw call.
// Pedestrians walk the sidewalks round a block (keeping right), and at a corner either turn
// with the block or cross at the crosswalk when the parallel traffic has a green. Positions are
// in a block side's frontage frame (a face of the street graph, citygraph.ts facePt) and
// converted to world each step.
import * as THREE from "three@0.187.0";
import { Rng } from "./rng.ts";
import { Figures, HAIRS, PANTS, SHIRTS, SKINS, UMBRELLAS, walkSwing } from "./figure.ts";
import type { Body } from "./figure.ts";
import { CLOCK, Vignettes, blockNear, crossing, crossSignal, districtAt, faceCorner, faceRef, sideFace } from "./vignettes.ts";
import type { Adopt, KerbParked } from "./vignettes.ts";
import { weatherMix } from "./climate.ts";
import { signalState } from "./signals.ts";
import type { SignalPreempt } from "./signals.ts";
import { CityPlan, pick } from "./city.ts";
import type { CityGraph, GPt } from "./citygraph.ts";
import { CURB_H } from "./grid.ts";
import { SIM_DT } from "./journey.ts";
import type { Obstacle } from "./traffic.ts";
import type { Path, Pose } from "./route.ts";

type PedKind = "walk" | "jog" | "dog" | "vendor" | "musician" | "chase";
interface Ped {
  kind: PedKind; bx: number; bz: number; side: number; a: number; dir: 1 | -1; n: number;
  speed: number; phase: number; state: "walk" | "wait" | "cross"; crossA: number; crossLen: number; waitT: number;
  crossN?: number;   // where across the crossing lands, in the side's frame (default -0.85)
  shirt: number; pants: number; skin: number; hair: number;
  x: number; z: number; h: number; px: number; pz: number; ph: number; pphase: number;   // and one step ago
  dog: { x: number; z: number; h: number; phase: number; color: number } | null;
  balloon: { x: number; y: number; z: number; free: boolean; t: number; py: number } | null;
  s?: number; hat?: number; umbrella?: number; cup?: boolean;   // a child's scale; a cap; an umbrella's colour; a coffee
}
// What else street life needs from the journey this step (vignettes.ts).
// truckPath: the truck driving its path (its s, speed, and its body's reach about s), or null.
export interface CrowdMore { cars: Obstacle[]; parked: KerbParked | null; busy: Set<string>; truckPath?: { path: Path; s: number; v: number; front: number; rear: number } | null }
interface Flock { cx: number; cz: number; y: number; r: number; w: number; a: number; pa: number; gull: boolean; n: number }

const PED_SPAWN = [35, 105], PED_DESPAWN = 130;
const BELLE = 0xf4ead8;
const _pt: GPt = { x: 0, z: 0, h: 0 };
const _tq: Pose = { x: 0, z: 0, h: 0, k: 0 };
// A pedestrian's face (block side) in the graph.
const faceOf = (G: CityGraph, p: Ped) => sideFace(G, p.bx, p.bz, p.side);

export class Crowd {
  private F: Figures;
  private peds: Ped[] = [];
  private flocks: Flock[] = [];
  private rng = new Rng(0xc40d);
  private rnd = this.rng.next;
  private time = 0;   // render time (tails, wings)
  readonly obstacles: Obstacle[] = [];
  private vendorCount = 0;
  private time0 = 0;   // journey time this step

  readonly vig: Vignettes;
  private G: CityGraph | null = null;   // the city's street graph (from the last step)
  constructor(scene: THREE.Scene, material: THREE.Material, cap = 520) {
    this.F = new Figures(scene, material, cap);
    this.vig = new Vignettes(new Figures(scene, material, 2400, 48));
    this.vig.adopt = (a) => this.adopt(a);
  }

  clear() { this.peds.length = 0; this.flocks.length = 0; this.vendorCount = 0; this.obstacles.length = 0; this.vig.clear(); }
  // A new city: nobody about, and the random stream from the city's seed.
  reset(seed: number) { this.clear(); this.rng.s = seed >>> 0; this.vig.reset((seed ^ 0x5bd1e995) >>> 0); }
  save() { return { rng: this.rng.s, peds: this.peds, flocks: this.flocks, vendors: this.vendorCount, vig: this.vig.save() }; }
  load(o: ReturnType<Crowd["save"]>) {
    this.rng.s = o.rng; this.peds = o.peds; this.flocks = o.flocks; this.vendorCount = o.vendors;
    this.vig.load(o.vig);
    this.obstacles.length = 0;
    for (const p of this.peds) this.obstacles.push({ x: p.x, z: p.z, r: 0.4 });
    this.obstacles.push(...this.vig.obstacles);
  }

  // Someone a vignette is done with, walking on as one of the crowd.
  adopt(a: Adopt) {
    const G = this.G;
    if (!G || sideFace(G, a.bx, a.bz, a.side) < 0) return;
    const p: Ped = {
      kind: a.dog !== undefined ? "dog" : "walk", bx: a.bx, bz: a.bz, side: a.side, a: a.a, dir: a.dir, n: a.n,
      speed: a.speed ?? 1.2, phase: this.rnd() * 10, state: "walk", crossA: 0, crossLen: 16, waitT: 0,
      shirt: a.shirt, pants: a.pants, skin: a.skin, hair: a.hair, x: 0, z: 0, h: 0, px: 0, pz: 0, ph: 0, pphase: 0,
      dog: a.dog !== undefined ? { x: 0, z: 0, h: 0, phase: 0, color: a.dog } : null, balloon: null,
      s: a.s, hat: a.hat, umbrella: a.umbrella, cup: a.cup,
    };
    // (Round the corner first if handed over past the end of the side.)
    const f = faceOf(G, p);
    if (p.dir > 0 && p.a > faceCorner(G, f, p.n)[0]) this.turnCorner(G, p);
    else if (p.dir < 0 && p.a < faceCorner(G, G.prevFace(f), p.n)[1]) this.turnCorner(G, p);
    this.place(G, p);
    p.px = p.x; p.pz = p.z; p.ph = p.h; p.pphase = p.phase;
    if (p.dog) { const fx = Math.cos(p.h), fz = -Math.sin(p.h), rx = Math.sin(p.h), rz = Math.cos(p.h); p.dog.x = p.x - fx * 1.2 - rx * 0.45; p.dog.z = p.z - fz * 1.2 - rz * 0.45; p.dog.h = p.h; }
    this.peds.push(p);
  }

  // One fixed step (the journey's), around `focus`; `prs` are the signals the truck has held.
  step(plan: CityPlan, simTime: number, prs: SignalPreempt[], focus: { x: number; z: number }, truck: Obstacle[], more: CrowdMore = { cars: [], parked: null, busy: new Set() }) {
    const dt = SIM_DT, G = this.G = plan.graph;
    this.time0 = simTime;
    for (const p of this.peds) { p.px = p.x; p.pz = p.z; p.ph = p.h; p.pphase = p.phase; if (p.balloon) p.balloon.py = p.balloon.y; }
    for (const f of this.flocks) f.pa = f.a;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      if (Math.hypot(p.x - focus.x, p.z - focus.z) > PED_DESPAWN || (p.balloon?.free && p.balloon.t > 20)) {
        if (p.kind === "vendor" || p.kind === "musician") this.vendorCount--;
        this.peds.splice(i, 1);
      }
    }
    const d = districtAt(plan, focus.x, focus.z);
    const want = d === "downtown" ? 26 : d === "commercial" ? 20 : d === "park" ? 14 : d === "residential" ? 10 : 5;
    for (let k = 0; k < 3 && this.peds.length < want; k++) this.spawn(plan, focus);
    this.obstacles.length = 0;
    this.truckPath = more.truckPath ?? null;
    for (const p of this.peds) { this.walk(G, p, dt, plan, simTime, prs, truck); this.obstacles.push({ x: p.x, z: p.z, r: 0.4 }); }
    this.vig.step({ plan, simTime, prs, focus, truck, cars: more.cars, parked: more.parked, busy: more.busy, peds: this.peds.map((p) => ({ x: p.x, z: p.z, run: p.kind === "jog" || p.kind === "chase" })) });
    this.obstacles.push(...this.vig.obstacles);
    this.updateFlocks(dt, plan, focus);
  }

  // ---- pedestrians --------------------------------------------------------------------------
  private spawn(plan: CityPlan, focus: { x: number; z: number }) {
    const r = this.rnd, ang = r() * Math.PI * 2, dist = PED_SPAWN[0] + r() * (PED_SPAWN[1] - PED_SPAWN[0]);
    const wx = focus.x + Math.cos(ang) * dist, wz = focus.z + Math.sin(ang) * dist;
    const G = plan.graph, B = blockNear(G, wx, wz);
    if (!B) return;
    const bx = B.kx, bz = B.kz, district = plan.district(bx, bz);
    if (district === "industrial" && r() < 0.6) return;
    let kind: PedKind = r() < (district === "park" ? 0.4 : 0.14) ? "jog" : r() < 0.15 ? "dog" : "walk";
    const fixed = (district === "downtown" || district === "commercial") && this.vendorCount < 2 && r() < 0.08;
    if (fixed) kind = r() < 0.55 ? "vendor" : "musician";
    else if (!this.peds.some((p) => p.kind === "chase") && r() < 0.04) kind = "chase";
    const dir: 1 | -1 = r() < 0.5 ? 1 : -1;
    const side = Math.floor(r() * B.sides.length), f = B.sides[side], a0 = G.faceA0(f) + 4, a1 = G.faceA1(f) - 4;   // (4 m clear of the corners)
    const p: Ped = {
      kind, bx, bz, side, a: a0 + r() * Math.max(0, a1 - a0), dir, n: fixed ? -2.0 : dir > 0 ? -0.65 : -1.1,
      speed: kind === "jog" ? 2.8 + r() * 0.6 : kind === "chase" ? 3.0 : 1.1 + r() * 0.35, phase: r() * 10,
      state: fixed ? "wait" : "walk", crossA: 0, crossLen: 16, waitT: 0,
      shirt: kind === "jog" ? pick(r, [0xff5722, 0x00bcd4, 0xcddc39, 0xe91e63]) : pick(r, SHIRTS), pants: pick(r, PANTS), skin: pick(r, SKINS), hair: pick(r, HAIRS),
      x: 0, z: 0, h: 0, px: 0, pz: 0, ph: 0, pphase: 0, dog: null, balloon: null,
    };
    // A dog walker's dog: often Belle (small, fluffy and cream, with tan floppy ears and a collar).
    if (kind === "dog") p.dog = { x: 0, z: 0, h: 0, phase: 0, color: r() < 0.45 ? BELLE : pick(r, [0x8a5a3a, 0x222222, 0xc8a060, 0xeeeeee]) };
    if (kind === "chase") p.balloon = { x: 0, y: 2.2, z: 0, free: false, t: 0, py: 2.2 };
    if (kind === "vendor") { p.shirt = 0xffffff; p.pants = 0x2c3e50; }
    // In the rain, umbrellas; first thing in the morning, coffee.
    if ((kind === "walk" || kind === "dog") && weatherMix(plan.climate?.weather ?? "clear").rain > 0.3 && r() < 0.65) p.umbrella = pick(r, UMBRELLAS);
    else if (kind === "walk" && district !== "park" && district !== "residential") { const hr = CLOCK.hourAt(this.time0); if (hr >= 6.5 && hr < 10 && r() < 0.35) p.cup = true; }
    this.place(G, p);
    p.px = p.x; p.pz = p.z; p.ph = p.h; p.pphase = p.phase;
    if (Math.hypot(p.x - focus.x, p.z - focus.z) < PED_SPAWN[0] - 5) return;
    if (fixed) this.vendorCount++;
    this.peds.push(p);
  }

  private place(G: CityGraph, p: Ped) {
    const q = G.facePt(faceOf(G, p), p.a, p.n, _pt), h = q.h;
    p.x = q.x; p.z = q.z;
    p.h = p.dir > 0 ? h : h + Math.PI;
    if (p.kind === "vendor" || p.kind === "musician") p.h = h + Math.PI / 2;   // facing the street
  }

  private truckPath: CrowdMore["truckPath"] = null;
  // Whether the truck, driving on, comes within `reach` m (of its path's line) of any of the first
  // `n` points of `pts` (x, z pairs) in the next `secs` s: by its path, from its tail now to where
  // its nose would get to by then, at its speed but no less than `vMin` (it may be pulling away).
  private truckSweeps(pts: number[], n: number, secs: number, vMin: number, reach: number): boolean {
    const T = this.truckPath;
    if (!T) return false;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < n; k++) { x0 = Math.min(x0, pts[2 * k]); x1 = Math.max(x1, pts[2 * k]); z0 = Math.min(z0, pts[2 * k + 1]); z1 = Math.max(z1, pts[2 * k + 1]); }
    const s1 = Math.min(T.path.length, T.s + T.front + Math.max(T.v, vMin) * secs);
    for (let s = Math.max(0, T.s + T.rear); s <= s1; s += 1) {
      T.path.peek(s, _tq);
      if (_tq.x < x0 - reach || _tq.x > x1 + reach || _tq.z < z0 - reach || _tq.z > z1 + reach) continue;
      for (let k = 0; k < n; k++) if (Math.hypot(_tq.x - pts[2 * k], _tq.z - pts[2 * k + 1]) < reach) return true;
    }
    return false;
  }
  // Whether the truck comes over the crosswalk p is about to take (`len` m of it, from p's spot at
  // the kerb) before p could be across.
  private truckCrossing(G: CityGraph, p: Ped, len: number): boolean {
    if (!this.truckPath) return false;
    const f = faceOf(G, p), pts = this.sweepPts;
    let n = 0;
    for (let t = 0; t <= len && n < 32; t += 1.5, n++) { const q = G.facePt(f, p.a + p.dir * t, 1.7, _pt); pts[2 * n] = q.x; pts[2 * n + 1] = q.z; }
    return this.truckSweeps(pts, n, len / p.speed + 3, 6, 1.25 + 1.2);
  }
  // p's pace this step with the truck coming over its way (walking or crossing): it waits short of
  // the truck's way (2 m on, along its line), or, in it, hurries on out (above its own pace). The
  // truck doesn't stop for people: one already out when it turns this way gets clear.
  private truckPace(G: CityGraph, f: number, p: Ped, truck: Obstacle[]): number {
    // (Only near enough to be reached: within the truck's length and 2.5 s of travel, and the reach.)
    const T = this.truckPath, o = truck[0], pts = this.sweepPts;
    if (!T || !o) return p.speed;
    const R = T.front - T.rear + Math.max(T.v, 1) * 2.5 + 3;
    if (Math.abs(o.x - p.x) > R || Math.abs(o.z - p.z) > R) return p.speed;
    pts[0] = p.x; pts[1] = p.z;
    if (this.truckSweeps(pts, 1, 2.5, 1, 1.25 + 1.0)) return Math.max(p.speed, 2.6);
    const q = G.facePt(f, p.a + p.dir * 2, p.n, _pt);
    pts[0] = q.x; pts[1] = q.z;
    return this.truckSweeps(pts, 1, 2.5, 1, 1.25 + 1.2) ? 0 : p.speed;
  }
  private sweepPts: number[] = new Array(64).fill(0);

  private walk(G: CityGraph, p: Ped, dt: number, plan: CityPlan, simTime: number, prs: SignalPreempt[], truck: Obstacle[]) {
    if (p.kind === "vendor" || p.kind === "musician") { p.phase += dt; this.place(G, p); return; }
    const f = faceOf(G, p), kerb = G.streets[f >> 1].kerb, fwd = p.dir > 0;
    // The corner ahead: where this walkway line meets the next side's (or the last side's).
    const corner = fwd ? faceCorner(G, f, p.n)[0] : faceCorner(G, G.prevFace(f), p.n)[1];
    if (p.state === "walk") {
      // Wait for the truck if it's across the sidewalk just ahead.
      const fx = Math.cos(p.h), fz = -Math.sin(p.h);
      const blocked = truck.some((o) => { const rx = o.x - p.x, rz = o.z - p.z, al = rx * fx + rz * fz; return al > 0 && al < o.r + 1.2 && Math.abs(rx * -fz + rz * fx) < o.r + 0.4; });
      // Round a vignette on the pavement (to whichever side of it there is room), or wait.
      let nT = p.dir > 0 ? -0.65 : -1.1, held = false;
      const fp = this.vig.blocker(p.bx, p.bz, p.side, p.a, p.dir);
      if (fp && fp[3] > nT - 0.35 && fp[2] < nT + 0.35) {
        const inner = fp[3] + 0.4, outer = fp[2] - 0.4;
        if (inner <= -0.2 && (outer < 0.1 - kerb || Math.abs(inner - nT) < Math.abs(outer - nT))) nT = inner;
        else if (outer >= 0.1 - kerb) nT = outer;
        else held = (p.dir > 0 ? fp[0] - p.a : p.a - fp[1]) < 1.2;
      }
      // (The truck coming over the walkway, cutting a corner or turning in across it.)
      const sp = this.truckPace(G, f, p, truck);
      if (!blocked && !held) { p.a += p.dir * sp * dt; p.phase += sp * dt; }
      p.n += (nT - p.n) * Math.min(1, dt * 2);
      if ((p.dir > 0 && p.a >= corner) || (p.dir < 0 && p.a <= corner)) {
        p.a = corner;
        if (this.rnd() < 0.35 && p.kind !== "chase") { p.state = "wait"; p.waitT = 0; }
        else this.turnCorner(G, p);
      }
    } else if (p.state === "wait") {
      // At the kerb: cross with the parallel traffic's green, unless the truck is right there.
      p.waitT += dt;
      const sg = crossSignal(G, f, fwd), cr = crossing(G, f, fwd);
      const green = signalState(sg.node, sg.phase, simTime, plan.seed, prs) === "green";
      // (Nor if the truck is to come over the crosswalk before they could be across.)
      const clear = truck.every((o) => Math.hypot(o.x - p.x, o.z - p.z) > 12);
      if (!cr) { p.state = "walk"; this.turnCorner(G, p); }   // the edge of town: no crossing
      else if (green && clear && p.waitT > 0.8 && !this.truckCrossing(G, p, (cr.a - p.a) * p.dir)) {
        p.state = "cross"; p.crossA = p.a; p.crossN = cr.n;
        p.crossLen = (cr.a - p.a) * p.dir;   // to the far corner's walkway
      }
      else if (p.waitT > 30) { p.state = "walk"; this.turnCorner(G, p); }
    } else {
      // Crossing: step out to the crosswalk line (n = 1.7), across, and back to the walkway.
      // (The truck coming through the crosswalk. Caught just off the kerb, they step back onto it
      // and wait again rather than run out across its lane.)
      let sp = this.truckPace(G, f, p, truck);
      if (sp > p.speed && (p.a - p.crossA) * p.dir < 1.6) sp = -sp;
      p.a += p.dir * sp * dt; p.phase += Math.abs(sp) * dt;
      if ((p.a - p.crossA) * p.dir <= 0) { p.a = p.crossA; p.n = -0.85; p.state = "wait"; p.waitT = 0; p.crossN = undefined; }
      const t = (p.a - p.crossA) * p.dir;
      const L = p.crossLen, nE = p.crossN ?? -0.85;
      p.n = t < 1.6 ? -0.85 + (1.7 + 0.85) * (t / 1.6) : t > L - 1.6 ? 1.7 - (1.7 - nE) * ((t - (L - 1.6)) / 1.6) : 1.7;
      if (t >= L) {
        // Over: on along the side across, from its corner's walkway (as far on as this step went).
        const cr = crossing(G, f, fwd);
        if (cr) {
          const to = cr.to;
          Object.assign(p, faceRef(G, to));
          p.a = (fwd ? G.faceA0(to) - 0.85 : G.faceA1(to) + 0.85) + (t - L) * p.dir;
        }
        p.n = -0.85; p.state = "walk"; p.crossN = undefined;
      }
    }
    // The runaway balloon: just ahead of its chaser, until it gets away and floats up.
    if (p.balloon) {
      const bl = p.balloon; bl.t += dt;
      if (!bl.free && bl.t > 14) { bl.free = true; bl.t = 0; p.kind = "walk"; p.speed = 1.2; }
      if (!bl.free) { const fx = Math.cos(p.h), fz = -Math.sin(p.h); bl.x = p.x + fx * 2.6; bl.z = p.z + fz * 2.6; bl.y = 2.1 + 0.25 * Math.sin(simTime * 3); }
      else { bl.y += dt * 1.6; bl.x += dt * 0.6; }
    }
    this.place(G, p);
    if (p.dog) {   // trotting a leash length behind, a little to the street side
      const fx = Math.cos(p.h), fz = -Math.sin(p.h), rx = Math.sin(p.h), rz = Math.cos(p.h);
      p.dog.x = p.x - fx * 1.2 - rx * 0.45; p.dog.z = p.z - fz * 1.2 - rz * 0.45; p.dog.h = p.h; p.dog.phase = p.phase * 1.8;
    }
  }

  // Round the corner ahead onto the next side (walking with the block on the right) or the
  // last one, at the same distance out from the frontage.
  private turnCorner(G: CityGraph, p: Ped) {
    const f = faceOf(G, p);
    if (p.dir > 0) { const g = G.nextFace(f); p.side = G.sideOf(g); p.a = faceCorner(G, f, p.n)[1]; }
    else { const e = G.prevFace(f); p.side = G.sideOf(e); p.a = faceCorner(G, e, p.n)[0]; }
  }

  // ---- birds --------------------------------------------------------------------------------
  private updateFlocks(dt: number, plan: CityPlan, focus: { x: number; z: number }) {
    const gull = plan.style.id === "port" || plan.style.id === "coastal";
    this.flocks = this.flocks.filter((f) => Math.hypot(f.cx - focus.x, f.cz - focus.z) < 110);
    while (this.flocks.length < 3) {
      const r = this.rnd, a = r() * Math.PI * 2, d = 25 + r() * 55;
      this.flocks.push({ cx: focus.x + Math.cos(a) * d, cz: focus.z + Math.sin(a) * d, y: 14 + r() * 10, r: 5 + r() * 7, w: (0.35 + r() * 0.3) * (r() < 0.5 ? 1 : -1), a: r() * 6, pa: 0, gull, n: 4 + Math.floor(r() * 4) });
      const f = this.flocks[this.flocks.length - 1]; f.pa = f.a;
    }
    for (const f of this.flocks) f.a += f.w * dt;
  }

  // ---- drawing ------------------------------------------------------------------------------
  private box(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, pitch: number, color: number) { this.F.box(x, y, z, sx, sy, sz, yaw, pitch, color); }

  // Draw everyone `alpha` of the way from the last step to this one; `time` drives tails and wings.
  draw(alpha: number, time: number) {
    this.time = time;
    const F = this.F;
    F.begin();
    for (const p of this.peds) {
      if (!F.room(16)) break;
      // Drawn at the in-between pose: swap it in for the drawing, then put the step's pose back.
      const sx = p.x, sz = p.z, sh = p.h, sph = p.phase, d0 = p.dog, b0 = p.balloon;
      const dsx = d0?.x ?? 0, dsz = d0?.z ?? 0, dsh = d0?.h ?? 0, dsp = d0?.phase ?? 0, bsx = b0?.x ?? 0, bsy = b0?.y ?? 0, bsz = b0?.z ?? 0;
      p.x = p.px + (sx - p.px) * alpha; p.z = p.pz + (sz - p.pz) * alpha;
      p.h = p.ph + Math.atan2(Math.sin(sh - p.ph), Math.cos(sh - p.ph)) * alpha; p.phase = p.pphase + (sph - p.pphase) * alpha;
      const ddx = p.x - sx, ddz = p.z - sz;
      if (d0) { d0.x += ddx; d0.z += ddz; d0.h = p.h; d0.phase = p.phase * 1.8; }
      if (b0) { b0.x += ddx; b0.z += ddz; b0.y = b0.py + (bsy - b0.py) * alpha; }
      this.drawPed(p);
      p.x = sx; p.z = sz; p.h = sh; p.phase = sph;
      if (d0) { d0.x = dsx; d0.z = dsz; d0.h = dsh; d0.phase = dsp; }
      if (b0) { b0.x = bsx; b0.y = bsy; b0.z = bsz; }
    }
    this.drawFlocks(alpha);
    F.end_();
    this.vig.draw(alpha, time);
  }

  private drawPed(p: Ped) {
    const F = this.F, moving = p.state !== "wait" && p.kind !== "vendor" && p.kind !== "musician";
    const run = p.kind === "jog" || p.kind === "chase", w = walkSwing(p.phase, run), s = p.s ?? 1;
    const h = p.h, fx = Math.cos(h), fz = -Math.sin(h), ct = (p.a - p.crossA) * p.dir;
    const inRoad = p.state === "cross" && ct > 1.2 && ct < p.crossLen - 1.2;
    const b: Body = {
      x: p.x, z: p.z, yaw: h, s, y: (inRoad ? 0.02 : CURB_H) + (moving ? w.bob : 0),
      legs: moving ? w.legs : [0, 0], arms: moving ? w.arms : [0, 0], lean: run ? 0.15 : 0,
      shirt: p.shirt, pants: p.pants, skin: p.skin, hair: p.hair, hat: p.hat,
    };
    if (p.kind === "musician") { const m = 0.9 + 0.25 * Math.sin(p.phase * 7); b.arms = [-m, m]; }
    if (p.kind === "vendor") { const m = 0.3 + 0.2 * Math.sin(p.phase * 1.3); b.arms = [-m, m]; }
    if (p.kind === "chase") b.arms = [0.96, 2.4];   // reaching for the string
    if (p.umbrella !== undefined) { b.arms = [b.arms![0], 0.55]; b.fore = [b.arms![0], 2.2]; }
    else if (p.cup) { b.arms = [b.arms![0], 0.35]; b.fore = [b.arms![0], 1.55]; }
    F.person(b);
    if (p.umbrella !== undefined) { const hd = F.handR; F.umbrella(hd[0] - fx * 0.05, F.head[1] + 0.42 * s, hd[2] - fz * 0.05, hd, p.umbrella, 0, h + Math.PI / 4); }
    else if (p.cup) { const hd = F.handR; F.box(hd[0], hd[1] + 0.06, hd[2], 0.07, 0.12, 0.07, 0, 0, 0xf4f0e8); F.box(hd[0], hd[1] + 0.13, hd[2], 0.075, 0.02, 0.075, 0, 0, 0x3a2a1e); }
    if (p.kind === "musician") this.box(p.x + fx * 0.25, b.y! + 0.86 + 0.25, p.z + fz * 0.25, 0.12, 0.3, 0.8, h + 0.7, 0, 0x8a5a2a);   // guitar
    if (p.kind === "vendor") {   // cart with an umbrella, between the vendor and the kerb
      const cx = p.x + fx * 1.0, cz = p.z + fz * 1.0;
      this.box(cx, 0.6 + CURB_H, cz, 0.9, 0.8, 1.6, h, 0, 0xd8dadc);
      this.box(cx, 1.05 + CURB_H, cz, 0.92, 0.1, 1.62, h, 0, 0xc0392b);
      this.box(cx, 1.6 + CURB_H, cz, 0.05, 1.1, 0.05, h, 0, 0x555555);
      this.box(cx, 2.15 + CURB_H, cz, 1.8, 0.1, 1.8, h, 0, 0xf2c200);
    }
    if (p.dog) this.F.dog({ x: p.dog.x, z: p.dog.z, yaw: p.dog.h, phase: p.dog.phase, color: p.dog.color, belle: p.dog.color === BELLE, tail: this.time * 12 });
    if (p.balloon) {
      const bl = p.balloon;
      this.box(bl.x, bl.y, bl.z, 0.42, 0.5, 0.42, 0, 0, 0xe8202a);
      if (!bl.free) { const mx = (bl.x + p.x) / 2, mz = (bl.z + p.z) / 2; this.box(mx, (bl.y + 1.5) / 2, mz, 0.02, bl.y - 1.5, 0.02, 0, 0, 0xeeeeee); }
    }
  }

  private drawFlocks(alpha: number) {
    for (const f of this.flocks) for (let i = 0; i < f.n; i++) {
      if (!this.F.room(3)) break;
      const a = f.pa + (f.a - f.pa) * alpha + i * (Math.PI * 2 / f.n) * 0.35, rr = f.r + (i % 3) * 0.9;
      const x = f.cx + Math.cos(a) * rr, z = f.cz + Math.sin(a) * rr, y = f.y + Math.sin(a * 2 + i) * 0.8;
      const yaw = f.w > 0 ? Math.atan2(-Math.cos(a), -Math.sin(a)) : Math.atan2(Math.cos(a), Math.sin(a)), flap = Math.sin(this.time * 9 + i * 1.7) * 0.6;
      const body = f.gull ? 0xf2f2f0 : 0x7a7f88, wing = f.gull ? 0xe0e0e0 : 0x5a5f68;
      const rx = Math.sin(yaw), rz = Math.cos(yaw);
      this.box(x, y, z, 0.32, 0.12, 0.12, yaw, 0, body);
      for (const k of [-1, 1]) this.F.box(x + rx * k * 0.2, y + Math.sin(k * flap) * 0.1 * k, z + rz * k * 0.2, 0.16, 0.03, 0.38, yaw, 0, wing, k * flap);
    }
  }
}
