// Figures for the street life (crowd.ts, vignettes.ts): people with jointed limbs, dogs of any
// size, pigeons and props, every part a scaled unit cube in one InstancedMesh with per-instance
// colour (one draw call), plus a second, unlit mesh for things that glow (lamps, lit windows).
// A body's frame: +x forward (yaw as elsewhere: forward is (cos yaw, -sin yaw)), +z its right.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { CURB_H } from "./grid.ts";

export type V3 = [number, number, number];

export const SHIRTS = [0xc0392b, 0x2e86c1, 0x27ae60, 0xf1c40f, 0x8e44ad, 0xecf0f1, 0x2c3e50, 0xe67e22, 0x16a085, 0xd35400, 0x34495e, 0xff8fb0];
export const PANTS = [0x2c3e50, 0x1f2a44, 0x4a4a4a, 0x7a5a3a, 0x222222, 0x5a6a7a, 0xc8b89a];
export const SKINS = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4423];
export const HAIRS = [0x2a1a10, 0x5a3a1a, 0x111111, 0xc8a050, 0x8a3a1a, 0xaaaaaa];
export const UMBRELLAS = [0x1a1a1a, 0xc0392b, 0x2e86c1, 0xf1c40f, 0x16a085, 0x8e44ad, 0xff8fb0];

// A person's pose. Swings are about the body's side axis from hanging straight down (+ forward,
// PI straight up); `out` raises a limb sideways. Left first, then right, in every pair.
export interface Body {
  x: number; z: number; yaw: number;
  y?: number;                       // the feet (default: on the sidewalk)
  s?: number;                       // scale: 1 an adult, about 0.6 a child
  hip?: number;                     // hip height above the feet (default straight legs)
  legs?: [number, number];          // thigh swing
  shins?: [number, number] | null;  // shin swing (absolute), when the knees bend
  legOut?: [number, number];
  arms?: [number, number];          // upper-arm swing
  armOut?: [number, number];
  fore?: [number, number] | null;   // forearm swing (absolute), when the elbows bend
  foreOut?: [number, number];
  lean?: number;                    // torso pitch, forward
  tilt?: number;                    // torso roll, to the right
  turn?: number; nod?: number;      // head yaw (to the left) and pitch (down)
  shirt: number; pants: number; skin: number; hair: number;
  hat?: number; hatH?: number;      // a cap (or a tall hat with hatH)
  bulk?: number;                    // torso width factor (a bouncer)
  coat?: number;                    // a long coat over the shirt
}

export interface DogPose {
  x: number; z: number; yaw: number; y?: number;
  phase: number; gait?: number;     // leg swing phase and amplitude
  color: number; size?: number; legs?: number;   // body scale, and leg length on top of it
  belle?: boolean; ears?: number;
  lift?: number;                    // a hind leg raised (0..1), on the right
  tail?: number;                    // tail wag phase (radians)
  jump?: number; pitch?: number;    // up off the ground, nose up
  head?: number;                    // head dipped (0..1): sniffing, licking
}

const DOWN = new THREE.Vector3(0, -1, 0);

export class Figures {
  readonly mesh: THREE.InstancedMesh;
  readonly glowMesh: THREE.InstancedMesh | null;
  n = 0; g = 0;
  readonly handL: V3 = [0, 0, 0]; readonly handR: V3 = [0, 0, 0]; readonly head: V3 = [0, 0, 0];
  readonly footL: V3 = [0, 0, 0]; readonly footR: V3 = [0, 0, 0]; readonly hipC: V3 = [0, 0, 0];
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private q2 = new THREE.Quaternion(); private e = new THREE.Euler();
  private p3 = new THREE.Vector3(); private s3 = new THREE.Vector3(); private d3 = new THREE.Vector3(); private col = new THREE.Color();
  private end: V3 = [0, 0, 0];

  constructor(scene: THREE.Scene, material: THREE.Material, cap: number, glowCap = 0) {
    const b = new Batch(); b.box(0, 0, 0, 1, 1, 1, 0xffffff);
    const geo = b.build(material)!.geometry;
    this.mesh = new THREE.InstancedMesh(geo, material, cap);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    for (let i = 0; i < cap; i++) this.mesh.setColorAt(i, this.col.set(0xffffff));
    scene.add(this.mesh);
    if (glowCap > 0) {
      this.glowMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), glowCap);
      this.glowMesh.count = 0; this.glowMesh.frustumCulled = false;
      for (let i = 0; i < glowCap; i++) this.glowMesh.setColorAt(i, this.col.set(0xffffff));
      scene.add(this.glowMesh);
    } else this.glowMesh = null;
  }

  get cap() { return this.mesh.instanceMatrix.count; }
  room(k: number) { return this.n + k <= this.cap; }
  begin() { this.n = 0; this.g = 0; }
  end_() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.glowMesh) {
      this.glowMesh.count = this.g;
      this.glowMesh.instanceMatrix.needsUpdate = true;
      if (this.glowMesh.instanceColor) this.glowMesh.instanceColor.needsUpdate = true;
    }
  }

  // A box centred on (x, y, z), turned by yaw, then pitched (top forward for -pitch) and rolled.
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, pitch: number, color: number, roll = 0) {
    if (this.n >= this.cap) return;
    this.q.setFromEuler(this.e.set(roll, yaw, pitch, "YXZ"));
    this.mesh.setMatrixAt(this.n, this.m4.compose(this.p3.set(x, y, z), this.q, this.s3.set(sx, sy, sz)));
    this.mesh.setColorAt(this.n++, this.col.set(color));
  }
  // The same, unlit (it glows): only drawn when there is a glow mesh.
  glow(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, color: number) {
    const m = this.glowMesh;
    if (!m || this.g >= m.instanceMatrix.count) return;
    this.q.setFromEuler(this.e.set(0, yaw, 0, "YXZ"));
    m.setMatrixAt(this.g, this.m4.compose(this.p3.set(x, y, z), this.q, this.s3.set(sx, sy, sz)));
    m.setColorAt(this.g++, this.col.set(color));
  }
  // A bar of width w from a to b.
  seg(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, color: number) {
    if (this.n >= this.cap) return;
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
    if (len < 1e-5) return;
    this.q.setFromUnitVectors(DOWN, this.d3.set(dx / len, dy / len, dz / len));
    this.mesh.setMatrixAt(this.n, this.m4.compose(this.p3.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), this.q, this.s3.set(w, len, w)));
    this.mesh.setColorAt(this.n++, this.col.set(color));
  }
  // A limb hanging from (x, y, z): swung forward by `swing` and out by `out` on side k (-1 left,
  // +1 right). Returns (in this.end) where it ends.
  limb(x: number, y: number, z: number, yaw: number, swing: number, len: number, w: number, color: number, out = 0, k = 1): V3 {
    const co = Math.cos(out), lx = Math.sin(swing) * co, ly = -Math.cos(swing) * co, lz = k * Math.sin(out);
    const fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
    const dx = lx * fx + lz * rx, dz = lx * fz + lz * rz, half = len / 2;
    if (this.n < this.cap) {
      this.q2.setFromEuler(this.e.set(0, yaw, 0, "YXZ"));
      this.q.setFromUnitVectors(DOWN, this.d3.set(lx, ly, lz)).premultiply(this.q2);
      this.mesh.setMatrixAt(this.n, this.m4.compose(this.p3.set(x + dx * half, y + ly * half, z + dz * half), this.q, this.s3.set(w, len, w)));
      this.mesh.setColorAt(this.n++, this.col.set(color));
    }
    const e = this.end; e[0] = x + dx * len; e[1] = y + ly * len; e[2] = z + dz * len;
    return e;
  }

  // A person. Afterwards handL/handR, footL/footR, head and hipC hold where those ended up.
  person(b: Body) {
    const s = b.s ?? 1, yaw = b.yaw, fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
    const y0 = b.y ?? CURB_H, H = b.hip ?? 0.86 * s, hy = y0 + H, lean = b.lean ?? 0, tilt = b.tilt ?? 0;
    const legs = b.legs ?? [0, 0], arms = b.arms ?? [0, 0], lo = b.legOut ?? [0, 0], ao = b.armOut ?? [0, 0];
    this.hipC[0] = b.x; this.hipC[1] = hy; this.hipC[2] = b.z;
    for (let i = 0; i < 2; i++) {
      const k = i === 0 ? -1 : 1, px = b.x + rx * k * 0.1 * s, pz = b.z + rz * k * 0.1 * s;
      let e: V3;
      if (b.shins) { const kn = this.limb(px, hy, pz, yaw, legs[i], 0.45 * s, 0.13 * s, b.pants, lo[i], k); e = this.limb(kn[0], kn[1], kn[2], yaw, b.shins[i], 0.43 * s, 0.12 * s, b.pants, lo[i] * 0.5, k); }
      else e = this.limb(px, hy, pz, yaw, legs[i], 0.86 * s, 0.13 * s, b.pants, lo[i], k);
      const f = i === 0 ? this.footL : this.footR; f[0] = e[0]; f[1] = e[1]; f[2] = e[2];
    }
    // Torso and head, pitched forward about the hips and rolled to the right.
    const up = (d: number): V3 => [b.x + (fx * Math.sin(lean) + rx * Math.sin(tilt)) * d, hy + Math.cos(lean) * Math.cos(tilt) * d, b.z + (fz * Math.sin(lean) + rz * Math.sin(tilt)) * d];
    const bulk = b.bulk ?? 1;
    const tc = up(0.31 * s);
    this.box(tc[0], tc[1], tc[2], 0.24 * s * bulk, 0.62 * s, 0.36 * s * bulk, yaw, -lean, b.shirt, -tilt);
    if (b.coat !== undefined) { const cc = up(0.12 * s); this.box(cc[0], cc[1], cc[2], 0.28 * s * bulk, 0.66 * s, 0.4 * s * bulk, yaw, -lean, b.coat, -tilt); }
    const hc = up(0.73 * s), hyaw = yaw + (b.turn ?? 0), nod = b.nod ?? 0;
    this.head[0] = hc[0]; this.head[1] = hc[1]; this.head[2] = hc[2];
    this.box(hc[0], hc[1], hc[2], 0.21 * s, 0.24 * s, 0.2 * s, hyaw, -lean - nod, b.skin, -tilt);
    const hfx = Math.cos(hyaw), hfz = -Math.sin(hyaw);
    if (b.hat !== undefined) {
      const hh = b.hatH ?? 0.07;
      this.box(hc[0] - hfx * 0.01 * s, hc[1] + (0.12 + hh / 2) * s, hc[2] - hfz * 0.01 * s, 0.24 * s, hh * s, 0.23 * s, hyaw, -lean, b.hat, -tilt);
      if (b.hatH === undefined) this.box(hc[0] + hfx * 0.14 * s, hc[1] + 0.1 * s, hc[2] + hfz * 0.14 * s, 0.12 * s, 0.03 * s, 0.2 * s, hyaw, -lean, b.hat, -tilt);   // the peak
    } else this.box(hc[0] - hfx * 0.02 * s, hc[1] + 0.11 * s, hc[2] - hfz * 0.02 * s, 0.23 * s, 0.07 * s, 0.22 * s, hyaw, -lean - nod, b.hair, -tilt);
    const sh = up(0.58 * s), fore = b.fore, foo = b.foreOut ?? [0, 0];
    for (let i = 0; i < 2; i++) {
      const k = i === 0 ? -1 : 1, px = sh[0] + rx * k * 0.25 * s * bulk, pz = sh[2] + rz * k * 0.25 * s * bulk;
      const sleeve = b.coat ?? b.shirt;
      let e: V3;
      if (fore) { const el = this.limb(px, sh[1], pz, yaw, arms[i], 0.32 * s, 0.1 * s, sleeve, ao[i], k); e = this.limb(el[0], el[1], el[2], yaw, fore[i], 0.29 * s, 0.09 * s, sleeve, foo[i], k); }
      else e = this.limb(px, sh[1], pz, yaw, arms[i], 0.6 * s, 0.1 * s, sleeve, ao[i], k);
      const h = i === 0 ? this.handL : this.handR; h[0] = e[0]; h[1] = e[1]; h[2] = e[2];
    }
  }

  // A dog: Belle (small, fluffy and cream, with tan floppy ears and a collar) or any other.
  dog(d: DogPose) {
    const S = d.size ?? 1, L = S * (d.legs ?? 1), dh = d.yaw, dfx = Math.cos(dh), dfz = -Math.sin(dh), drx = Math.sin(dh), drz = Math.cos(dh);
    const y0 = (d.y ?? CURB_H) + (L - S) * 0.22 + (d.jump ?? 0), ds = Math.sin(d.phase * 5) * (d.gait ?? 0.6), pitch = d.pitch ?? 0, sp = Math.sin(pitch);
    const at = (ax: number, ay: number): [number, number, number] => [d.x + dfx * ax * Math.cos(pitch), y0 + ay + ax * sp, d.z + dfz * ax * Math.cos(pitch)];
    const c = d.color, belle = !!d.belle, hs = belle ? 1.25 : 1, dip = (d.head ?? 0) * 0.2 * S;
    let p = at(0, 0.32 * S); this.box(p[0], p[1], p[2], 0.5 * S, 0.2 * S, 0.2 * S, dh, pitch, c);
    p = at(0.3 * S, 0.45 * S - dip); this.box(p[0], p[1], p[2], 0.2 * S * hs, 0.19 * S * hs, 0.18 * S * hs, dh, pitch - (d.head ?? 0) * 0.6, c);
    p = at(0.28 * S, 0.43 * S - dip); this.box(p[0], p[1], p[2], 0.09 * S, 0.17 * S, 0.3 * S * hs, dh, pitch, d.ears ?? (belle ? 0xd9b48c : c));
    p = at((0.3 + 0.11 * hs) * S, 0.43 * S - dip * 1.3); this.box(p[0], p[1], p[2], 0.04 * S, 0.05 * S, 0.05 * S, dh, 0, 0x2a1a12);
    if (belle) { p = at(0.19 * S, 0.37 * S); this.box(p[0], p[1], p[2], 0.05 * S, 0.13 * S, 0.19 * S, dh, pitch, 0x5a3a26); }
    const lift = d.lift ?? 0;
    for (const [ax, sz] of [[0.18, -1], [0.18, 1], [-0.18, -1], [-0.18, 1]] as const) {
      const q = at(ax * S, 0.24 * S), up = ax < 0 && sz > 0 ? lift : 0;
      this.limb(q[0] + drx * sz * 0.07 * S, q[1], q[2] + drz * sz * 0.07 * S, dh, (d.jump ? (ax > 0 ? 1.0 : -1.0) : ds * sz * (ax > 0 ? 1 : -1)) - pitch * 0.5, 0.22 * L, 0.06 * S, c, up * 1.3, sz);
    }
    p = at(-0.3 * S, 0.42 * S); this.box(p[0], p[1], p[2], 0.2 * S, 0.05 * S, 0.05 * S, dh, 0.7 + 0.3 * Math.sin(d.tail ?? d.phase * 6), c);
  }

  // A pigeon on the ground (pecking 0..1) or in the air (flap).
  pigeon(x: number, y: number, z: number, yaw: number, peck: number, flap: number | null, color = 0x7a7f88) {
    const fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
    this.box(x, y + 0.1, z, 0.22, 0.13, 0.12, yaw, 0.15, color);
    this.box(x + fx * (0.12 + peck * 0.03), y + 0.18 - peck * 0.12, z + fz * (0.12 + peck * 0.03), 0.08, 0.08, 0.07, yaw, 0, 0x5c6470);
    if (flap !== null) for (const k of [-1, 1]) this.box(x + rx * k * 0.15, y + 0.13 + Math.sin(flap) * 0.08, z + rz * k * 0.15, 0.14, 0.03, 0.3, yaw, 0, 0x5a5f68, k * Math.sin(flap) * 0.7);
  }

  // An umbrella open over (x, y, z): its canopy a shallow dome of four panels, or blown inside
  // out (flip 1: the panels cupped upwards), its shaft down to the hand.
  umbrella(x: number, y: number, z: number, hand: V3, color: number, flip = 0, yaw = 0) {
    const r = 0.52, droop = 0.32 - flip * 0.95;
    for (let i = 0; i < 4; i++) {
      const ang = yaw + i * Math.PI / 2, cx = Math.cos(ang), cz = -Math.sin(ang);
      this.box(x + cx * r * 0.5, y - Math.sin(droop) * r * 0.5, z + cz * r * 0.5, r, 0.04, r * 1.35, ang, -droop, color);
    }
    this.seg(hand[0], hand[1], hand[2], x, y + 0.08, z, 0.03, 0x333333);
  }
}

// Walking: legs and arms swinging with `phase` (metres walked), as the crowd walks.
export function walkSwing(phase: number, run = false): { legs: [number, number]; arms: [number, number]; bob: number } {
  const w = Math.sin(phase * (run ? 3.2 : 4.6)), sw = w * (run ? 0.75 : 0.5);
  return { legs: [-sw, sw], arms: [sw * 0.8, -sw * 0.8], bob: Math.abs(w) * (run ? 0.08 : 0.04) };
}
