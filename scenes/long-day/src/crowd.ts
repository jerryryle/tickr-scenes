// Street life: pedestrians (walkers, joggers, dog walkers with small dogs, a hot dog vendor, a
// street musician, someone chasing a runaway balloon) and birds circling overhead (pigeons, or
// gulls by the water). Every body part is a scaled unit cube in one InstancedMesh with
// per-instance colour, so the whole crowd is a single draw call.
// Pedestrians walk the sidewalks round a block (keeping right), and at a corner either turn
// with the block or cross at the crosswalk when the parallel traffic has a green. Positions are
// in a block side's frontage frame (city.ts frontPt) and converted to world each frame.
import * as THREE from "three@0.187.0";
import { Rng } from "./rng.ts";
import { Batch } from "./geom.ts";
import { signalState } from "./signals.ts";
import type { SignalAxis, SignalPreempt } from "./signals.ts";
import { CityPlan, FRONT_NODE, frontPt, insideCity, pick } from "./city.ts";
import { BLOCK, CURB_H } from "./grid.ts";
import { blockGoals, DIR_X, DIR_Z } from "./route.ts";
import { SIM_DT } from "./journey.ts";
import type { Obstacle } from "./traffic.ts";

type PedKind = "walk" | "jog" | "dog" | "vendor" | "musician" | "chase";
interface Ped {
  kind: PedKind; bx: number; bz: number; side: number; a: number; dir: 1 | -1; n: number;
  speed: number; phase: number; state: "walk" | "wait" | "cross"; crossA: number; crossLen: number; waitT: number;
  shirt: number; pants: number; skin: number; hair: number;
  x: number; z: number; h: number; px: number; pz: number; ph: number; pphase: number;   // and one step ago
  dog: { x: number; z: number; h: number; phase: number; color: number } | null;
  balloon: { x: number; y: number; z: number; free: boolean; t: number; py: number } | null;
}
interface Flock { cx: number; cz: number; y: number; r: number; w: number; a: number; pa: number; gull: boolean; n: number }

const PED_SPAWN = [35, 105], PED_DESPAWN = 130;
const BELLE = 0xf4ead8;
const SHIRTS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xecf0f1, 0x2c3e50, 0xe67e22, 0x16a085, 0xd35400, 0x34495e, 0xff8fb0];
const PANTS = [0x2c3e50, 0x1f2a44, 0x4a4a4a, 0x7a5a3a, 0x222222, 0x5a6a7a, 0xc8b89a];
const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4423];
const HAIRS = [0x2a1a10, 0x5a3a1a, 0x111111, 0xc8a050, 0x8a3a1a, 0xaaaaaa];
// Side order round a block, walking clockwise (+1): north (0) -> east (3) -> south (1) -> west (2).
const NEXT_SIDE = [3, 2, 0, 1], PREV_SIDE_CW = [2, 3, 1, 0];

export class Crowd {
  private mesh: THREE.InstancedMesh;
  private peds: Ped[] = [];
  private flocks: Flock[] = [];
  private n = 0;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private p3 = new THREE.Vector3(); private s3 = new THREE.Vector3(); private col = new THREE.Color();
  private rng = new Rng(0xc40d);
  private rnd = this.rng.next;
  private time = 0;   // render time (tails, wings)
  readonly obstacles: Obstacle[] = [];
  private vendorCount = 0;

  constructor(scene: THREE.Scene, material: THREE.Material, cap = 520) {
    const b = new Batch(); b.box(0, 0, 0, 1, 1, 1, 0xffffff);
    this.mesh = new THREE.InstancedMesh(b.build(material)!.geometry, material, cap);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, this.col.set(0xffffff));
    scene.add(this.mesh);
  }

  clear() { this.peds.length = 0; this.flocks.length = 0; this.vendorCount = 0; this.obstacles.length = 0; }
  // A new city: nobody about, and the random stream from the city's seed.
  reset(seed: number) { this.clear(); this.rng.s = seed >>> 0; }
  save() { return { rng: this.rng.s, peds: this.peds, flocks: this.flocks, vendors: this.vendorCount }; }
  load(o: ReturnType<Crowd["save"]>) {
    this.rng.s = o.rng; this.peds = o.peds; this.flocks = o.flocks; this.vendorCount = o.vendors;
    this.obstacles.length = 0;
    for (const p of this.peds) this.obstacles.push({ x: p.x, z: p.z, r: 0.4 });
  }

  // One fixed step (the journey's), around `focus`; `prs` are the signals the truck has held.
  step(plan: CityPlan, simTime: number, prs: SignalPreempt[], focus: { x: number; z: number }, truck: Obstacle[]) {
    const dt = SIM_DT;
    for (const p of this.peds) { p.px = p.x; p.pz = p.z; p.ph = p.h; p.pphase = p.phase; if (p.balloon) p.balloon.py = p.balloon.y; }
    for (const f of this.flocks) f.pa = f.a;
    for (let i = this.peds.length - 1; i >= 0; i--) {
      const p = this.peds[i];
      if (Math.hypot(p.x - focus.x, p.z - focus.z) > PED_DESPAWN || (p.balloon?.free && p.balloon.t > 20)) {
        if (p.kind === "vendor" || p.kind === "musician") this.vendorCount--;
        this.peds.splice(i, 1);
      }
    }
    const d = plan.district(Math.floor(focus.x / BLOCK), Math.floor(focus.z / BLOCK));
    const want = d === "downtown" ? 26 : d === "commercial" ? 20 : d === "park" ? 14 : d === "residential" ? 10 : 5;
    for (let k = 0; k < 3 && this.peds.length < want; k++) this.spawn(plan, focus);
    this.obstacles.length = 0;
    for (const p of this.peds) { this.walk(p, dt, plan, simTime, prs, truck); this.obstacles.push({ x: p.x, z: p.z, r: 0.4 }); }
    this.updateFlocks(dt, plan, focus);
  }

  // ---- pedestrians --------------------------------------------------------------------------
  private spawn(plan: CityPlan, focus: { x: number; z: number }) {
    const r = this.rnd, ang = r() * Math.PI * 2, dist = PED_SPAWN[0] + r() * (PED_SPAWN[1] - PED_SPAWN[0]);
    const wx = focus.x + Math.cos(ang) * dist, wz = focus.z + Math.sin(ang) * dist;
    const bx = Math.floor(wx / BLOCK), bz = Math.floor(wz / BLOCK);
    if (!insideCity(bx, bz)) return;
    const district = plan.district(bx, bz);
    if (district === "industrial" && r() < 0.6) return;
    let kind: PedKind = r() < (district === "park" ? 0.4 : 0.14) ? "jog" : r() < 0.15 ? "dog" : "walk";
    const fixed = (district === "downtown" || district === "commercial") && this.vendorCount < 2 && r() < 0.08;
    if (fixed) kind = r() < 0.55 ? "vendor" : "musician";
    else if (!this.peds.some((p) => p.kind === "chase") && r() < 0.04) kind = "chase";
    const dir: 1 | -1 = r() < 0.5 ? 1 : -1;
    const p: Ped = {
      kind, bx, bz, side: Math.floor(r() * 4), a: 13 + r() * 34, dir, n: fixed ? -2.0 : dir > 0 ? -0.65 : -1.1,
      speed: kind === "jog" ? 2.8 + r() * 0.6 : kind === "chase" ? 3.0 : 1.1 + r() * 0.35, phase: r() * 10,
      state: fixed ? "wait" : "walk", crossA: 0, crossLen: 16, waitT: 0,
      shirt: kind === "jog" ? pick(r, [0xff5722, 0x00bcd4, 0xcddc39, 0xe91e63]) : pick(r, SHIRTS), pants: pick(r, PANTS), skin: pick(r, SKINS), hair: pick(r, HAIRS),
      x: 0, z: 0, h: 0, px: 0, pz: 0, ph: 0, pphase: 0, dog: null, balloon: null,
    };
    // A dog walker's dog: often Belle (small, fluffy and cream, with tan floppy ears and a collar).
    if (kind === "dog") p.dog = { x: 0, z: 0, h: 0, phase: 0, color: r() < 0.45 ? BELLE : pick(r, [0x8a5a3a, 0x222222, 0xc8a060, 0xeeeeee]) };
    if (kind === "chase") p.balloon = { x: 0, y: 2.2, z: 0, free: false, t: 0, py: 2.2 };
    if (kind === "vendor") { p.shirt = 0xffffff; p.pants = 0x2c3e50; }
    this.place(p);
    p.px = p.x; p.pz = p.z; p.ph = p.h; p.pphase = p.phase;
    if (Math.hypot(p.x - focus.x, p.z - focus.z) < PED_SPAWN[0] - 5) return;
    if (fixed) this.vendorCount++;
    this.peds.push(p);
  }

  private place(p: Ped) {
    const [x, z] = frontPt(p.side, p.a, p.n);
    p.x = p.bx * BLOCK + x; p.z = p.bz * BLOCK + z;
    const d = FRONT_NODE[p.side][2], h = d * Math.PI / 2;
    p.h = p.dir > 0 ? h : h + Math.PI;
    if (p.kind === "vendor" || p.kind === "musician") p.h = h + Math.PI / 2;   // facing the street
  }

  private walk(p: Ped, dt: number, plan: CityPlan, simTime: number, prs: SignalPreempt[], truck: Obstacle[]) {
    if (p.kind === "vendor" || p.kind === "musician") { p.phase += dt; this.place(p); return; }
    const corner = p.dir > 0 ? 51 - p.n : 9 + p.n;
    if (p.state === "walk") {
      // Wait for the truck if it's across the sidewalk just ahead.
      const fx = Math.cos(p.h), fz = -Math.sin(p.h);
      const blocked = truck.some((o) => { const rx = o.x - p.x, rz = o.z - p.z, al = rx * fx + rz * fz; return al > 0 && al < o.r + 1.2 && Math.abs(rx * -fz + rz * fx) < o.r + 0.4; });
      if (!blocked) { p.a += p.dir * p.speed * dt; p.phase += p.speed * dt; }
      p.n += ((p.dir > 0 ? -0.65 : -1.1) - p.n) * Math.min(1, dt * 2);
      if ((p.dir > 0 && p.a >= corner) || (p.dir < 0 && p.a <= corner)) {
        p.a = corner;
        if (this.rnd() < 0.35 && p.kind !== "chase") { p.state = "wait"; p.waitT = 0; }
        else this.turnCorner(p);
      }
    } else if (p.state === "wait") {
      // At the kerb: cross with the parallel traffic's green, unless the truck is right there.
      p.waitT += dt;
      const g = blockGoals(p.bx, p.bz, 0)[p.side], d = g.dir;
      const nx = p.dir > 0 ? g.ix + DIR_X[d] : g.ix, nz = p.dir > 0 ? g.iz + DIR_Z[d] : g.iz;
      const green = signalState(nx, nz, (d % 2) as SignalAxis, simTime, plan.seed, prs) === "green";
      const clear = truck.every((o) => Math.hypot(o.x - p.x, o.z - p.z) > 12);
      const fd = FRONT_NODE[p.side][2];
      if (!insideCity(p.bx + DIR_X[fd] * p.dir, p.bz + DIR_Z[fd] * p.dir)) { p.state = "walk"; this.turnCorner(p); }   // the edge of town: no crossing
      else if (green && clear && p.waitT > 0.8) {
        p.state = "cross"; p.crossA = p.a;
        p.crossLen = p.dir > 0 ? (BLOCK + 9 - 0.85) - p.a : p.a - (51 + 0.85 - BLOCK);   // to the far corner's walkway
      }
      else if (p.waitT > 30) { p.state = "walk"; this.turnCorner(p); }
    } else {
      // Crossing: step out to the crosswalk line (n = 1.7), across, and back to the walkway.
      p.a += p.dir * p.speed * dt; p.phase += p.speed * dt;
      const t = (p.a - p.crossA) * p.dir;
      const L = p.crossLen;
      p.n = t < 1.6 ? -0.85 + (1.7 + 0.85) * (t / 1.6) : t > L - 1.6 ? 1.7 - (1.7 + 0.85) * ((t - (L - 1.6)) / 1.6) : 1.7;
      if (t >= L) {
        const d = FRONT_NODE[p.side][2];
        p.bx += DIR_X[d] * p.dir; p.bz += DIR_Z[d] * p.dir; p.a -= BLOCK * p.dir; p.n = -0.85; p.state = "walk";
      }
    }
    // The runaway balloon: just ahead of its chaser, until it gets away and floats up.
    if (p.balloon) {
      const bl = p.balloon; bl.t += dt;
      if (!bl.free && bl.t > 14) { bl.free = true; bl.t = 0; p.kind = "walk"; p.speed = 1.2; }
      if (!bl.free) { const fx = Math.cos(p.h), fz = -Math.sin(p.h); bl.x = p.x + fx * 2.6; bl.z = p.z + fz * 2.6; bl.y = 2.1 + 0.25 * Math.sin(simTime * 3); }
      else { bl.y += dt * 1.6; bl.x += dt * 0.6; }
    }
    this.place(p);
    if (p.dog) {   // trotting a leash length behind, a little to the street side
      const fx = Math.cos(p.h), fz = -Math.sin(p.h), rx = Math.sin(p.h), rz = Math.cos(p.h);
      p.dog.x = p.x - fx * 1.2 - rx * 0.45; p.dog.z = p.z - fz * 1.2 - rz * 0.45; p.dog.h = p.h; p.dog.phase = p.phase * 1.8;
    }
  }

  private turnCorner(p: Ped) {
    if (p.dir > 0) { p.side = NEXT_SIDE[p.side]; p.a = 9 + p.n; }
    else { p.side = PREV_SIDE_CW[p.side]; p.a = 51 - p.n; }
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
  private box(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, pitch: number, color: number) {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.q.setFromEuler(this.e.set(0, yaw, pitch, "YXZ"));
    this.mesh.setMatrixAt(this.n, this.m4.compose(this.p3.set(x, y, z), this.q, this.s3.set(sx, sy, sz)));
    this.mesh.setColorAt(this.n++, this.col.set(color));
  }
  // A limb hanging from (x, y, z), swung by `swing` about the body's side axis.
  private limb(x: number, y: number, z: number, yaw: number, swing: number, len: number, w: number, color: number) {
    const fx = Math.cos(yaw), fz = -Math.sin(yaw), half = len / 2;
    this.box(x + fx * Math.sin(swing) * half, y - Math.cos(swing) * half, z + fz * Math.sin(swing) * half, w, len, w, yaw, swing, color);
  }

  // Draw everyone `alpha` of the way from the last step to this one; `time` drives tails and wings.
  draw(alpha: number, time: number) {
    this.time = time;
    this.n = 0;
    const cap = this.mesh.instanceMatrix.count;
    this.mesh.count = cap;
    for (const p of this.peds) {
      if (this.n + 14 > cap) break;
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
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private drawPed(p: Ped) {
    {
      const moving = p.state !== "wait" && p.kind !== "vendor" && p.kind !== "musician";
      const run = p.kind === "jog" || p.kind === "chase";
      const sw = moving ? Math.sin(p.phase * (run ? 3.2 : 4.6)) * (run ? 0.75 : 0.5) : 0;
      const bob = moving ? Math.abs(Math.sin(p.phase * (run ? 3.2 : 4.6))) * (run ? 0.08 : 0.04) : 0;
      const h = p.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
      const hip = 0.88 + bob, lean = run ? 0.15 : 0;
      for (const k of [-1, 1]) this.limb(p.x + rx * k * 0.1, hip, p.z + rz * k * 0.1, h, sw * k, 0.86, 0.13, p.pants);
      this.box(p.x + fx * lean * 0.3, hip + 0.3, p.z + fz * lean * 0.3, 0.24, 0.62, 0.36, h, -lean, p.shirt);
      const headX = p.x + fx * lean * 0.6, headZ = p.z + fz * lean * 0.6, headY = hip + 0.73;
      this.box(headX, headY, headZ, 0.21, 0.24, 0.2, h, 0, p.skin);
      this.box(headX - fx * 0.02, headY + 0.11, headZ - fz * 0.02, 0.23, 0.07, 0.22, h, 0, p.hair);
      let armSwing = -sw * 0.8;
      if (p.kind === "musician") armSwing = 0.9 + 0.25 * Math.sin(p.phase * 7);
      if (p.kind === "vendor") armSwing = 0.3 + 0.2 * Math.sin(p.phase * 1.3);
      if (p.kind === "chase") armSwing = 2.4;   // reaching for the string
      for (const k of [-1, 1]) this.limb(p.x + rx * k * 0.25 + fx * lean * 0.4, hip + 0.58, p.z + rz * k * 0.25 + fz * lean * 0.4, h, k > 0 && p.kind === "chase" ? armSwing : armSwing * (p.kind === "chase" ? 0.4 : k), 0.6, 0.1, p.shirt);
      if (p.kind === "musician") this.box(p.x + fx * 0.25, hip + 0.25, p.z + fz * 0.25, 0.12, 0.3, 0.8, h + 0.7, 0, 0x8a5a2a);   // guitar
      if (p.kind === "vendor") {   // cart with an umbrella, between the vendor and the kerb
        const cx = p.x + fx * 1.0, cz = p.z + fz * 1.0;
        this.box(cx, 0.6 + CURB_H, cz, 0.9, 0.8, 1.6, h, 0, 0xd8dadc);
        this.box(cx, 1.05 + CURB_H, cz, 0.92, 0.1, 1.62, h, 0, 0xc0392b);
        this.box(cx, 1.6 + CURB_H, cz, 0.05, 1.1, 0.05, h, 0, 0x555555);
        this.box(cx, 2.15 + CURB_H, cz, 1.8, 0.1, 1.8, h, 0, 0xf2c200);
      }
      if (p.dog) {
        const d = p.dog, dh = d.h, dfx = Math.cos(dh), dfz = -Math.sin(dh), drx = Math.sin(dh), drz = Math.cos(dh), ds = Math.sin(d.phase * 5) * 0.6;
        const y0 = CURB_H;
        this.box(d.x, y0 + 0.32, d.z, 0.5, 0.2, 0.2, dh, 0, d.color);
        const belle = d.color === BELLE, hs = belle ? 1.25 : 1;   // Belle's head is a fluffy ball
        this.box(d.x + dfx * 0.3, y0 + 0.45, d.z + dfz * 0.3, 0.2 * hs, 0.19 * hs, 0.18 * hs, dh, 0, d.color);
        this.box(d.x + dfx * 0.28, y0 + 0.43, d.z + dfz * 0.28, 0.09, 0.17, 0.3 * hs, dh, 0, belle ? 0xd9b48c : d.color);   // floppy ears
        this.box(d.x + dfx * (0.3 + 0.11 * hs), y0 + 0.43, d.z + dfz * (0.3 + 0.11 * hs), 0.04, 0.05, 0.05, dh, 0, 0x2a1a12);   // nose
        if (belle) this.box(d.x + dfx * 0.19, y0 + 0.37, d.z + dfz * 0.19, 0.05, 0.13, 0.19, dh, 0, 0x5a3a26);               // collar
        for (const [ax, sz] of [[0.18, -1], [0.18, 1], [-0.18, -1], [-0.18, 1]] as const)
          this.limb(d.x + dfx * ax + drx * sz * 0.07, y0 + 0.24, d.z + dfz * ax + drz * sz * 0.07, dh, ds * sz * (ax > 0 ? 1 : -1), 0.22, 0.06, d.color);
        this.box(d.x - dfx * 0.3, y0 + 0.42, d.z - dfz * 0.3, 0.2, 0.05, 0.05, dh, 0.7 + 0.3 * Math.sin(this.time * 12), d.color);   // wagging
      }
      if (p.balloon) {
        const b = p.balloon;
        this.box(b.x, b.y, b.z, 0.42, 0.5, 0.42, 0, 0, 0xe8202a);
        if (!b.free) { const mx = (b.x + p.x) / 2, mz = (b.z + p.z) / 2; this.box(mx, (b.y + 1.5) / 2, mz, 0.02, b.y - 1.5, 0.02, 0, 0, 0xeeeeee); }
      }
    }
  }

  private drawFlocks(alpha: number) {
    const cap = this.mesh.instanceMatrix.count;
    for (const f of this.flocks) for (let i = 0; i < f.n; i++) {
      if (this.n + 3 > cap) break;
      const a = f.pa + (f.a - f.pa) * alpha + i * (Math.PI * 2 / f.n) * 0.35, rr = f.r + (i % 3) * 0.9;
      const x = f.cx + Math.cos(a) * rr, z = f.cz + Math.sin(a) * rr, y = f.y + Math.sin(a * 2 + i) * 0.8;
      const yaw = f.w > 0 ? Math.atan2(-Math.cos(a), -Math.sin(a)) : Math.atan2(Math.cos(a), Math.sin(a)), flap = Math.sin(this.time * 9 + i * 1.7) * 0.6;
      const body = f.gull ? 0xf2f2f0 : 0x7a7f88, wing = f.gull ? 0xe0e0e0 : 0x5a5f68;
      const rx = Math.sin(yaw), rz = Math.cos(yaw);
      this.box(x, y, z, 0.32, 0.12, 0.12, yaw, 0, body);
      for (const k of [-1, 1]) {
        this.q.setFromEuler(this.e.set(k * flap, yaw, 0, "YXZ"));
        this.mesh.setMatrixAt(this.n, this.m4.compose(this.p3.set(x + rx * k * 0.2, y + Math.sin(k * flap) * 0.1 * k, z + rz * k * 0.2), this.q, this.s3.set(0.16, 0.03, 0.38)));
        this.mesh.setColorAt(this.n++, this.col.set(wing));
      }
    }
  }
}
