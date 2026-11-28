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
// FIG_STYLE marks the storybook city and the Victorian one (main.ts sets it as each city is built):
// people dress for it (Figures.person).
export const FIG_STYLE = { storybook: false, victorian: false };
const STORY_CLOTHES = [0xe8333a, 0x1fb5b0, 0x9a6cf0, 0xf2c230, 0xff7fb5, 0x5fd3a0, 0xff9a2e, 0x2b3f8a];
// The storybook wardrobe's body colours: the town's accents (shirts, smocks, skirts and trousers),
// with cream for stripes; and its hats, the stovepipe, the floppy brim and the tasselled cap
// (which read at the board's scale) twice as often as the rest.
const STORY_BODY = [0xe8333a, 0xff8a1e, 0xf2c230, 0x14a3a0, 0x7a4fd8, 0xd83a9a, 0x2b3f8a, 0x5fd3a0];
const STORY_CREAM = 0xfff3dc;
const STORY_HATS = [0, 0, 1, 1, 2, 2, 3, 4, 5];
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
  // In Victorian dress (FIG_STYLE.victorian), what they wear: one of VicDress, chosen for them from
  // their colours unless given here. Given, their own colours dress it (vicPerson). "own" keeps
  // the body as drawn, for someone the caller costumes.
  dress?: VicDress | "own";
  vicHat?: VicHat;                  // their hat, in place of the one their dress gives them
  parasol?: number;                 // a parasol of this colour, held up by a woman in Victorian dress
  jig?: number;                     // the storybook costume's swing phase (rad): the stride's, or time standing (storyOutfit)
}
// The Victorian wardrobe (Figures.vicPerson): men in a frock coat, a sack coat, a jacket and flat
// cap, or shirtsleeves with a waistcoat and apron; women in a long full skirt; children; a bobby.
export type VicDress = "frock" | "sack" | "cap" | "sleeves" | "woman" | "boy" | "girl" | "bobby";
export type VicHat = "top" | "bowler" | "cap" | "bonnet" | "wide" | "helmet" | "none";
// Umbrellas and parasols in the Victorian city: black and dark umbrellas, pale parasols.
export const VIC_UMBRELLAS = [0x1a1a1a, 0x1a1a1a, 0x24242c, 0x3a2626, 0x26302a];
export const VIC_PARASOLS = [0xf4efe4, 0xead6de, 0xd6e2ea, 0xf0e0c0, 0xe0e8d0];
const V_COAT = [0x1e1e24, 0x2a2a30, 0x3a3226, 0x283244, 0x4a4236, 0x2e3a2e, 0x52463a, 0x3a2a26];
const V_TROUSER = [0x2a2a2c, 0x4a4844, 0x5e5646, 0x3a3a42, 0x6a6052, 0x34302a];
const V_WAIST = [0x7a2a2a, 0x3a4a3a, 0x8a7a5a, 0x2a2a2a, 0x54446a, 0x7a5a2a, 0xa08a5a];
const V_SHIRT = [0xece6da, 0xdcd6c6, 0xdcdfe2];
const V_DRESS = [0x5a2a4a, 0x2a3a5a, 0x3a5a4a, 0x8a3a2a, 0x8a7a9a, 0x6a5a3a, 0x2a2a2a, 0xa89a7a, 0x7a2a32, 0x4a5a6a, 0x9a6a4a, 0x5a6a3a];
const V_SHAWL = [0xc8b89a, 0x8a3a3a, 0x3a4a6a, 0xd8d0b8, 0x5a4a3a, 0x6a6a5a, 0x7a5a7a];
const V_HAT = [0x1a1a1a, 0x1a1a1a, 0x2a2622, 0x4a3a2a];
const V_CAP = [0x4a4238, 0x3a3a3a, 0x5a4e3e, 0x2e3440];
const V_STRAW = [0xd8c08a, 0xc8a870, 0x2a2a2a, 0xe8e0d0, 0x4a2a3a];
const V_TRIM = [0xc0303a, 0x3a5a9a, 0xe8d8a0, 0x6a2a6a, 0xf0e8e0, 0x2a6a4a];
const V_BOOT = 0x2a221e, V_APRON = [0xe8e4d8, 0x7a5a3a, 0xd8d2c0], V_BOBBY = 0x1a2034, V_SILVER = 0xc8ccd0;

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
const BIG_BOX = 1.5;   // m: bigger than any part of a person, an umbrella or a dog

export class Figures {
  readonly mesh: THREE.InstancedMesh;
  readonly glowMesh: THREE.InstancedMesh | null;
  // Boxes bigger than BIG_BOX in any direction (a food truck, a couch, a cradle: props, not
  // people) go here when there is a big material, so they can thin in the driver spotlight while
  // the people round them stay solid (main.ts).
  readonly bigMesh: THREE.InstancedMesh | null;
  n = 0; g = 0; b = 0;
  readonly handL: V3 = [0, 0, 0]; readonly handR: V3 = [0, 0, 0]; readonly head: V3 = [0, 0, 0];
  readonly footL: V3 = [0, 0, 0]; readonly footR: V3 = [0, 0, 0]; readonly hipC: V3 = [0, 0, 0];
  readonly kneeL: V3 = [0, 0, 0]; readonly kneeR: V3 = [0, 0, 0];
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private q2 = new THREE.Quaternion(); private e = new THREE.Euler();
  private p3 = new THREE.Vector3(); private s3 = new THREE.Vector3(); private d3 = new THREE.Vector3(); private col = new THREE.Color();
  private end: V3 = [0, 0, 0];

  constructor(scene: THREE.Scene, material: THREE.Material, cap: number, glowCap = 0, big: { material: THREE.Material; cap: number } | null = null) {
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
    if (big) {
      this.bigMesh = new THREE.InstancedMesh(geo, big.material, big.cap);
      this.bigMesh.count = 0; this.bigMesh.frustumCulled = false;
      for (let i = 0; i < big.cap; i++) this.bigMesh.setColorAt(i, this.col.set(0xffffff));
      scene.add(this.bigMesh);
    } else this.bigMesh = null;
  }

  get cap() { return this.mesh.instanceMatrix.count; }
  room(k: number) { return this.n + k <= this.cap; }
  begin() { this.n = 0; this.g = 0; this.b = 0; }
  end_() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.glowMesh) {
      this.glowMesh.count = this.g;
      this.glowMesh.instanceMatrix.needsUpdate = true;
      if (this.glowMesh.instanceColor) this.glowMesh.instanceColor.needsUpdate = true;
    }
    if (this.bigMesh) {
      this.bigMesh.count = this.b;
      this.bigMesh.instanceMatrix.needsUpdate = true;
      if (this.bigMesh.instanceColor) this.bigMesh.instanceColor.needsUpdate = true;
    }
  }

  // A box centred on (x, y, z), turned by yaw, then pitched (top forward for -pitch) and rolled.
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, pitch: number, color: number, roll = 0) {
    const big = this.bigMesh !== null && Math.max(sx, sy, sz) > BIG_BOX;
    const m = big ? this.bigMesh! : this.mesh, i = big ? this.b : this.n;
    if (i >= m.instanceMatrix.count) return;
    this.q.setFromEuler(this.e.set(roll, yaw, pitch, "YXZ"));
    m.setMatrixAt(i, this.m4.compose(this.p3.set(x, y, z), this.q, this.s3.set(sx, sy, sz)));
    m.setColorAt(i, this.col.set(color));
    if (big) this.b++; else this.n++;
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

  // In the storybook city (FIG_STYLE, main.ts sets it with the city), people are dressed for the
  // place (storyPerson). It is off for figures that are in costume already.
  costumes = true;
  // A person. Afterwards handL/handR, footL/footR, kneeL/kneeR, head and hipC hold where those ended up.
  person(b: Body) {
    if (FIG_STYLE.victorian && this.costumes && b.dress !== "own") { this.vicPerson(b); return; }
    if (FIG_STYLE.storybook && this.costumes) { this.storyPerson(b); return; }
    this.personBody(b);
  }
  // The storybook wardrobe, everything picked from the person's own colours, so it stays theirs
  // frame to frame and on a scrub. Shirt and trousers come from the town's accents (STORY_BODY).
  // Some are round and short, some lanky. A third wear long striped stockings, a quarter a short
  // flared smock, another quarter a bell skirt to the knee, and everyone long shoes curling up at
  // the toe. Each has a hat or hairdo and a scarf or bow tie (storyOutfit), unless given a hat.
  private storyPerson(b: Body) {
    const k = ((b.shirt * 7 + b.pants * 13 + b.skin * 3 + b.hair) >>> 0) % 997, h = Math.imul(k + 1, 2654435761) >>> 0;
    const pk = (i: number) => STORY_BODY[(h >>> (i * 3)) % STORY_BODY.length];
    const adult = (b.s ?? 1) >= 0.8, shape = adult ? (h >>> 20) % 5 : 2;
    const top = pk(1), q: Body = { ...b, shirt: top, pants: pk(2) === top ? pk(3) : pk(2) };
    if (shape === 0) { q.s = (b.s ?? 1) * 0.9; q.bulk = (b.bulk ?? 1) * 1.3; }          // round and short
    else if (shape === 1) { q.s = (b.s ?? 1) * 1.1; q.bulk = (b.bulk ?? 1) * 0.8; }     // lanky
    if (b.hip !== undefined && q.s !== b.s) q.hip = b.hip * q.s! / (b.s ?? 1);
    this.personBody(q);
    const s = q.s ?? 1, yaw = b.yaw, fx = Math.cos(yaw), fz = -Math.sin(yaw), dress = (h >>> 9) % 4, trim = pk(4) === top ? STORY_CREAM : pk(4);
    // (Over the hips along the thighs' mean line: a smock or a skirt's tiers.)
    const lq = q.legs ?? [0, 0], m = (lq[0] + lq[1]) / 2, sm = Math.sin(m), cm = Math.cos(m), [px, py, pz] = this.hipC;
    const L = (u: number, sx: number, sy: number, sz: number, c: number) => this.box(px + fx * sm * u * s, py - cm * u * s, pz + fz * sm * u * s, sx * s, sy * s, sz * s, yaw, m, c, -(b.tilt ?? 0));
    if (dress === 0) { L(0.02, 0.3, 0.2, 0.44, top); L(0.14, 0.36, 0.1, 0.5, trim); }                       // a smock, flared at its hem
    else if (dress === 1) { L(0.06, 0.34, 0.16, 0.44, pk(5)); L(0.22, 0.5, 0.2, 0.6, pk(5)); L(0.33, 0.52, 0.03, 0.62, STORY_CREAM); }   // a bell skirt, hemmed
    // Stockings: the shin in three stripes.
    if ((h >>> 13) % 3 === 0) for (const [kn, ft] of [[this.kneeL, this.footL], [this.kneeR, this.footR]] as const) {
      for (let i = 0; i < 3; i++) {
        const u0 = 0.1 + i * 0.3, u1 = u0 + 0.3, at = (u: number) => [kn[0] + (ft[0] - kn[0]) * u, kn[1] + (ft[1] - kn[1]) * u, kn[2] + (ft[2] - kn[2]) * u];
        const a = at(u0), c = at(u1);
        this.seg(a[0], a[1], a[2], c[0], c[1], c[2], 0.135 * s, i % 2 ? STORY_CREAM : trim);
      }
    }
    // Long shoes, their toes curling up.
    const shoe = (h >>> 16) % 2 ? 0x2a2440 : pk(6);
    for (const ft of [this.footL, this.footR]) {
      this.box(ft[0] + fx * 0.08 * s, ft[1] + 0.03 * s, ft[2] + fz * 0.08 * s, 0.3 * s, 0.07 * s, 0.13 * s, yaw, 0, shoe);
      this.box(ft[0] + fx * 0.26 * s, ft[1] + 0.07 * s, ft[2] + fz * 0.26 * s, 0.1 * s, 0.05 * s, 0.11 * s, yaw, -0.6, shoe);
    }
    if (b.hat === undefined) this.storyOutfit(q, k);   // (a hat given is the costume's: personBody draws it)
  }
  // The hat or hairdo, and the scarf or bow tie. Its loose parts swing with `jig`: the spring cap's
  // ball bobs, the tassel swings, the stovepipe sways and a wave runs down the scarf's tail.
  private storyOutfit(b: Body, k: number) {
    const s = b.s ?? 1, yaw = b.yaw + (b.turn ?? 0), lean = b.lean ?? 0, [hx, hy, hz] = this.head;
    const fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
    const kind = STORY_HATS[k % STORY_HATS.length], jig = b.jig ?? 0;
    const C = STORY_CLOTHES, a = C[k % C.length], c2 = C[(k >> 3) % C.length];
    const H = (i: number) => hy + (0.15 + i) * s;
    if (kind === 0) {   // kind 0 is a tall striped stovepipe, bending back and swaying
      const sway = 1 + 0.6 * Math.sin(2 * jig - 0.8);
      for (let i = 0; i < 6; i++) this.box(hx - fx * i * i * 0.012 * sway * s, H(0.03 + i * 0.12), hz - fz * i * i * 0.012 * sway * s, 0.2 * s, 0.125 * s, 0.2 * s, yaw, -lean + 0.1 + i * 0.05 * sway, i % 2 ? 0xffffff : a);
      this.box(hx, hy + 0.13 * s, hz, 0.36 * s, 0.03 * s, 0.36 * s, yaw, -lean, a);
    } else if (kind === 1) {   // kind 1 is a floppy wide-brimmed hat with a tall crooked crown
      this.box(hx, hy + 0.14 * s, hz, 0.58 * s, 0.03 * s, 0.58 * s, yaw, -lean + 0.12, a);
      for (let i = 0; i < 4; i++) this.box(hx + rx * i * 0.03 * s, H(0.07 + i * 0.1), hz + rz * i * 0.03 * s, (0.22 - i * 0.03) * s, 0.11 * s, (0.22 - i * 0.03) * s, yaw, -lean, a, 0.25 * i);
      this.box(hx, hy + 0.17 * s, hz, 0.24 * s, 0.05 * s, 0.24 * s, yaw, -lean, c2);
    } else if (kind === 2) {   // kind 2 is a knitted cap with its long tassel swinging and a pompom
      this.box(hx, hy + 0.15 * s, hz, 0.24 * s, 0.12 * s, 0.23 * s, yaw, -lean, a);
      const ang = 0.8 - lean + 0.25 * Math.sin(2 * jig - 1.0), bx = -Math.sin(ang), by = Math.cos(ang), y0 = hy + 0.2 * s;
      this.box(hx + fx * bx * 0.225 * s, y0 + by * 0.225 * s, hz + fz * bx * 0.225 * s, 0.05 * s, 0.45 * s, 0.05 * s, yaw, ang, a);
      this.box(hx + fx * bx * 0.48 * s, y0 + by * 0.48 * s, hz + fz * bx * 0.48 * s, 0.14 * s, 0.14 * s, 0.14 * s, yaw, 0, c2);
    } else if (kind === 3) {   // kind 3 is a tower of curls with a bow on top
      for (let i = 0; i < 4; i++) this.box(hx + Math.sin(i * 2) * 0.06 * s, H(0.03 + i * 0.13), hz + Math.cos(i * 2) * 0.06 * s, (0.3 - i * 0.05) * s, 0.14 * s, (0.3 - i * 0.05) * s, yaw + i * 0.4, -lean, b.hair);
      this.box(hx, hy + 0.68 * s, hz, 0.24 * s, 0.08 * s, 0.06 * s, yaw, 0, a);
    } else if (kind === 4) {   // kind 4 is a teapot of a hat, spout and all
      this.box(hx, hy + 0.2 * s, hz, 0.28 * s, 0.2 * s, 0.28 * s, yaw, -lean, a);
      this.box(hx + fx * 0.22 * s, hy + 0.26 * s, hz + fz * 0.22 * s, 0.2 * s, 0.05 * s, 0.05 * s, yaw, -lean - 0.6, a);
      this.box(hx, hy + 0.33 * s, hz, 0.06 * s, 0.06 * s, 0.06 * s, yaw, 0, 0xffffff);
    } else {   // kind 5 is a cap with a spring and a ball bobbing on it
      const bob = 0.08 * Math.sin(2 * jig - 1.2), st = 1 + bob / 0.27;
      this.box(hx, hy + 0.15 * s, hz, 0.25 * s, 0.1 * s, 0.24 * s, yaw, -lean, a);
      for (let i = 0; i < 3; i++) this.box(hx + Math.sin(i * 2.1) * 0.04 * s, hy + (0.25 + i * 0.09 * st) * s, hz + Math.cos(i * 2.1) * 0.04 * s, 0.03 * s, 0.09 * st * s, 0.03 * s, yaw + i, 0.5, 0x2a2440);
      this.box(hx, hy + (0.55 + bob) * s, hz, 0.13 * s, 0.13 * s, 0.13 * s, yaw, 0, c2);
    }
    if ((k >> 2) % 2) {   // this is a long striped scarf, trailing behind, a wave running down it
      for (let i = 0; i < 5; i++) this.box(hx - fx * (0.12 + i * 0.07) * s + rx * 0.05 * s, hy - (0.2 + i * 0.09 - 0.03 * i * Math.sin(2 * jig - 0.5 * i)) * s, hz - fz * (0.12 + i * 0.07) * s + rz * 0.05 * s, 0.08 * s, 0.1 * s, 0.12 * s, b.yaw, 0.6, i % 2 ? 0xffffff : c2);
    } else this.box(hx + fx * 0.12 * s, hy - 0.2 * s, hz + fz * 0.12 * s, 0.05 * s, 0.1 * s, 0.3 * s, b.yaw, 0, c2);   // otherwise this is a big bow tie
  }
  // In the Victorian city (FIG_STYLE.victorian, main.ts sets it with the city) everyone is in
  // period dress. Their dress, hat and colours are picked from their own colours, so they stay
  // theirs frame to frame and on a scrub. When the caller gives `dress`, the caller's colours dress
  // it: the shirt colours the coat or bodice, the pants the trousers or skirt, and the coat (if
  // any) the waistcoat, apron or shawl; a hat colour given (hat) colours the hat. A long skirt
  // hides the legs below the knee: under it they take half a stride, and its hem sways with them.
  // Skirts and coat tails follow the thighs, so they lie over the lap of someone sitting.
  private vicPerson(b: Body) {
    const s = b.s ?? 1, k = ((b.shirt * 7 + b.pants * 13 + b.skin * 3 + b.hair) >>> 0) % 997, h = Math.imul(k + 1, 2654435761) >>> 0;
    const pk = <T>(a: readonly T[], i: number) => a[(h >>> (i * 3)) % a.length];
    const own = b.dress !== undefined;
    const dress: VicDress = own ? b.dress as VicDress : s < 0.8 ? (k % 2 ? "boy" : "girl") : k % 29 === 0 ? "bobby" : k % 20 < 9 ? "woman" : (["frock", "sack", "sack", "cap", "cap", "sleeves"] as const)[(h >>> 7) % 6];
    const woman = dress === "woman", girl = dress === "girl";
    const coat = own ? b.shirt : pk(V_COAT, 1), trous = own ? b.pants : pk(V_TROUSER, 2), waist = own && b.coat !== undefined ? b.coat : pk(V_WAIST, 3);
    const gown = own ? b.pants : pk(V_DRESS, 1), bodice = own ? b.shirt : (k >> 2) % 3 === 0 ? pk(V_DRESS, 5) : gown;
    const shawl = own ? b.coat ?? -1 : (k >> 3) % 3 === 0 ? pk(V_SHAWL, 6) : -1, trim = pk(V_TRIM, 4);
    const hat: VicHat = b.vicHat ?? (dress === "frock" ? "top" : dress === "sack" ? ((h >>> 11) % 4 ? "bowler" : "top") : dress === "sleeves" ? ((h >>> 11) % 2 ? "bowler" : "cap") :
      dress === "cap" || dress === "boy" ? "cap" : dress === "bobby" ? "helmet" : girl ? "none" : (h >>> 12) % 20 < 9 ? "bonnet" : (h >>> 12) % 20 < 17 ? "wide" : "none");
    const hatC = own && b.hat !== undefined ? b.hat : hat === "cap" ? pk(V_CAP, 5) : hat === "bonnet" || hat === "wide" ? pk(V_STRAW, 6) : hat === "helmet" ? V_BOBBY : pk(V_HAT, 7);
    const q: Body = { ...b, hat: undefined, hatH: undefined, coat: undefined };
    const legs = b.legs ?? [0, 0];
    let parasol = false;
    if (woman) {
      q.shirt = bodice; q.pants = V_BOOT; q.legs = [legs[0] * 0.45, legs[1] * 0.45];
      // (A parasol up in the right hand, unless the hands are busy or she wears a working woman's
      // shawl.)
      if (b.parasol !== undefined && b.fore === undefined && shawl < 0) { const a = b.arms ?? [0, 0]; q.arms = [a[0], 0.55]; q.fore = [a[0], 2.2]; parasol = true; }
    } else if (girl) { q.shirt = gown; q.pants = 0x34302e; }
    else if (dress === "bobby") { q.shirt = q.pants = V_BOBBY; q.bulk = (b.bulk ?? 1) * 1.06; }
    else { q.shirt = dress === "sleeves" ? pk(V_SHIRT, 4) : coat; q.pants = trous; }
    this.personBody(q);
    const yaw = b.yaw, fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw), tilt = b.tilt ?? 0;
    const lean = b.lean ?? 0, sl = Math.sin(lean), cl = Math.cos(lean), [px, py, pz] = this.hipC;
    // T: a box on the torso, d up it from the hips and f forward of its middle (metres, for an adult).
    const T = (d: number, f: number, sx: number, sy: number, sz: number, c: number) =>
      this.box(px + fx * (sl * d + cl * f) * s, py + (cl * d - sl * f) * s, pz + fz * (sl * d + cl * f) * s, sx * s, sy * s, sz * s, yaw, -lean, c, -tilt);
    // L: a box on the thighs, u down along their mean line from the hips and f forward of it.
    const lq = q.legs ?? [0, 0], m = (lq[0] + lq[1]) / 2, sm = Math.sin(m), cm = Math.cos(m);
    const L = (u: number, f: number, sx: number, sy: number, sz: number, c: number) =>
      this.box(px + fx * (sm * u + cm * f) * s, py + (-cm * u + sm * f) * s, pz + fz * (sm * u + cm * f) * s, sx * s, sy * s, sz * s, yaw, m, c);
    // Hd: a box on the head, d up from its middle, f forward of it and r to its right.
    const hyaw = yaw + (b.turn ?? 0), hp = lean + (b.nod ?? 0), hs = Math.sin(hp), hc = Math.cos(hp), hfx = Math.cos(hyaw), hfz = -Math.sin(hyaw), [hx, hy, hz] = this.head;
    const Hd = (d: number, f: number, sx: number, sy: number, sz: number, c: number, r = 0) =>
      this.box(hx + (hfx * (hs * d + hc * f) + Math.sin(hyaw) * r) * s, hy + (hc * d - hs * f) * s, hz + (hfz * (hs * d + hc * f) + Math.cos(hyaw) * r) * s, sx * s, sy * s, sz * s, hyaw, -hp, c);
    if (woman || girl) {
      if (woman) {
        // The skirt lies over the hips and thighs, then falls from the knees to just off the
        // ground in two tiers, the lower swaying with the stride.
        L(0.24, 0, 0.38, 0.52, 0.46, gown);
        const kx = px + fx * sm * 0.48 * s, kz = pz + fz * sm * 0.48 * s, top = py - cm * 0.48 * s + 0.04 * s, bot = (b.y ?? CURB_H) + 0.03, H = top - bot;
        if (H > 0.05) {
          const d = lq[1] - lq[0], sw = d * 0.05 * s, kick = Math.abs(d) * 0.03 * s;
          this.box(kx, top - H * 0.25, kz, 0.48 * s, H * 0.5, 0.54 * s, yaw, 0, gown);
          this.box(kx + fx * kick + rx * sw, bot + H * 0.25, kz + fz * kick + rz * sw, 0.56 * s, H * 0.5 + 0.01, 0.6 * s, yaw, 0, gown, d * 0.1);
        }
        if (!own && k % 4 === 1) T(-0.04, -0.2, 0.24, 0.24, 0.36, gown);   // a bustle
        if (bodice !== gown) T(-0.03, 0, 0.29, 0.12, 0.4, bodice);           // the jacket's peplum
      } else {
        L(0.17, 0, 0.36, 0.36, 0.44, gown);                                  // a short skirt, and a white pinafore over it all
        T(0.3, 0.123, 0.01, 0.36, 0.24, 0xf2efe6); L(0.17, 0.185, 0.01, 0.34, 0.3, 0xf2efe6);
        Hd(0.1, -0.11, 0.05, 0.06, 0.18, trim);                              // a ribbon in the hair
      }
      if (shawl >= 0) { T(0.51, -0.02, 0.3, 0.16, 0.46, shawl); T(0.3, -0.135, 0.03, 0.34, 0.3, shawl); }   // a shawl round the shoulders, its point down the back
    } else if (dress === "bobby") {
      L(0.06, 0, 0.28, 0.14, 0.4, V_BOBBY);                                  // the tunic's skirt, the belt and the buttons
      T(0.04, 0, 0.27, 0.05, 0.4, 0x111111);
      for (const d of [0.2, 0.33, 0.46]) T(d, 0.124, 0.01, 0.03, 0.03, V_SILVER);
    } else if (dress === "sleeves") {
      T(0.33, 0, 0.26, 0.4, 0.38, waist);                                    // the waistcoat, a neckerchief, and often an apron
      T(0.57, 0.116, 0.04, 0.06, 0.16, trim);
      if (own ? b.coat !== undefined : (h >>> 15) % 3 !== 0) L(0.24, 0.15, 0.02, 0.5, 0.3, own ? waist : pk(V_APRON, 8));
    } else {
      T(0.54, 0.122, 0.01, 0.13, 0.1, pk(V_SHIRT, 4));                       // the shirt front and tie, and the waistcoat between the lapels
      T(0.52, 0.127, 0.01, 0.08, 0.035, 0x1a1a1e);
      if (dress !== "boy") T(0.34, 0.122, 0.01, 0.26, 0.12, waist);
      if (dress === "frock") L(0.22, 0, 0.3, 0.46, 0.4, coat);               // a frock coat's skirts reach the knee, a sack coat's the hips
      else L(0.08, 0, 0.29, 0.18, 0.39, coat);
    }
    if (hat === "top") { Hd(0.13, 0, 0.32, 0.022, 0.3, hatC); Hd(0.27, -0.005, 0.2, 0.26, 0.19, hatC); Hd(0.165, -0.005, 0.205, 0.035, 0.195, 0x3a3030); }
    else if (hat === "bowler") { Hd(0.125, 0, 0.3, 0.02, 0.28, hatC); Hd(0.185, -0.005, 0.22, 0.11, 0.21, hatC); Hd(0.25, -0.005, 0.16, 0.04, 0.15, hatC); }
    else if (hat === "cap") { Hd(0.14, 0.01, 0.26, 0.06, 0.24, hatC); Hd(0.115, 0.15, 0.11, 0.02, 0.2, hatC); }
    else if (hat === "helmet") { Hd(0.12, 0, 0.27, 0.02, 0.25, hatC); Hd(0.22, -0.005, 0.23, 0.2, 0.22, hatC); Hd(0.35, -0.005, 0.17, 0.08, 0.16, hatC); Hd(0.41, -0.005, 0.04, 0.05, 0.04, V_SILVER); Hd(0.21, 0.111, 0.01, 0.06, 0.05, V_SILVER); }
    else if (hat === "bonnet") {   // a hood over the back of the head, its brim standing out round the face, ribbons under the chin
      Hd(0.03, -0.04, 0.18, 0.28, 0.25, hatC); Hd(0.15, 0.06, 0.16, 0.05, 0.34, hatC);
      for (const r of [-0.15, 0.15]) Hd(0.0, 0.07, 0.12, 0.26, 0.04, hatC, r);
      Hd(-0.125, 0.02, 0.06, 0.03, 0.24, trim); Hd(0.1, -0.02, 0.2, 0.04, 0.27, trim);
    }
    else if (hat === "wide") { Hd(0.125, 0, 0.52, 0.02, 0.5, hatC); Hd(0.18, -0.005, 0.2, 0.1, 0.2, hatC); Hd(0.2, -0.04, 0.08, 0.07, 0.09, trim, 0.09); }
    if (woman && hat !== "bonnet") Hd(0.03, -0.13, 0.09, 0.11, 0.13, b.hair);   // the hair up in a bun
    if (parasol) { const hd = this.handR; this.umbrella(hd[0] - fx * 0.05, this.head[1] + 0.45 * s, hd[2] - fz * 0.05, hd, b.parasol!, 0, yaw + Math.PI / 4, 0.4); }
  }
  private personBody(b: Body) {
    const s = b.s ?? 1, yaw = b.yaw, fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
    const y0 = b.y ?? CURB_H, H = b.hip ?? 0.86 * s, hy = y0 + H, lean = b.lean ?? 0, tilt = b.tilt ?? 0;
    const legs = b.legs ?? [0, 0], arms = b.arms ?? [0, 0], lo = b.legOut ?? [0, 0], ao = b.armOut ?? [0, 0];
    this.hipC[0] = b.x; this.hipC[1] = hy; this.hipC[2] = b.z;
    for (let i = 0; i < 2; i++) {
      const k = i === 0 ? -1 : 1, px = b.x + rx * k * 0.1 * s, pz = b.z + rz * k * 0.1 * s;
      let e: V3;
      const kn = i === 0 ? this.kneeL : this.kneeR;
      if (b.shins) { const q = this.limb(px, hy, pz, yaw, legs[i], 0.45 * s, 0.13 * s, b.pants, lo[i], k); kn[0] = q[0]; kn[1] = q[1]; kn[2] = q[2]; e = this.limb(kn[0], kn[1], kn[2], yaw, b.shins[i], 0.43 * s, 0.12 * s, b.pants, lo[i] * 0.5, k); }
      else { e = this.limb(px, hy, pz, yaw, legs[i], 0.86 * s, 0.13 * s, b.pants, lo[i], k); kn[0] = (px + e[0]) / 2; kn[1] = (hy + e[1]) / 2; kn[2] = (pz + e[2]) / 2; }
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

  // An umbrella open over (x, y, z): its canopy a shallow dome of four panels of radius r, or
  // blown inside out (flip 1: the panels cupped upwards), its shaft down to the hand.
  umbrella(x: number, y: number, z: number, hand: V3, color: number, flip = 0, yaw = 0, r = 0.52) {
    const droop = 0.32 - flip * 0.95;
    for (let i = 0; i < 4; i++) {
      const ang = yaw + i * Math.PI / 2, cx = Math.cos(ang), cz = -Math.sin(ang);
      this.box(x + cx * r * 0.5, y - Math.sin(droop) * r * 0.5, z + cz * r * 0.5, r, 0.04, r * 1.35, ang, -droop, color);
    }
    this.seg(hand[0], hand[1], hand[2], x, y + 0.08, z, 0.03, 0x333333);
  }
}

// Walking: legs and arms swinging with `phase` (metres walked), as the crowd walks. The body is
// lowest at contact, the legs spread widest, and highest as they pass. In the storybook city (and
// not running) the walk is a cartoon's: quicker steps, the swinging knee folding, a bouncing-ball
// bob that rounds over at passing and bounces sharply at contact, arms pumping with bent elbows, a
// waddle, the chest out in a strut, and the head nodding a beat behind. `jig` is the stride's phase
// for the costume's loose parts (Figures.storyOutfit), and `hip` the hip height for the jointed legs.
export interface Swing {
  legs: [number, number]; arms: [number, number]; bob: number;
  shins?: [number, number]; fore?: [number, number]; tilt?: number; lean?: number; nod?: number; jig: number; hip?: number;
}
// A walking body's pose from a swing, for a person of scale s (the bob is added to their feet's y by the caller).
export function swingBody(w: Swing, s = 1): Partial<Body> {
  const b: Partial<Body> = { legs: w.legs, arms: w.arms, jig: w.jig };
  if (w.shins) { b.shins = w.shins; b.hip = (w.hip ?? 0.86) * s; }
  if (w.fore) b.fore = w.fore;
  if (w.lean !== undefined) b.lean = w.lean;
  if (w.tilt !== undefined) { b.tilt = w.tilt; b.nod = w.nod; }
  return b;
}
export function walkSwing(phase: number, run = false, story = FIG_STYLE.storybook): Swing {
  if (story && !run) {
    const k = phase * 5.4, w = Math.sin(k), c = Math.cos(k), sw = 0.4 * w, am = 0.7 * w;
    return { legs: [-sw, sw], shins: [-sw - 0.9 * Math.max(0, -c), sw - 0.9 * Math.max(0, c)], arms: [am, -am], fore: [am + 0.7, -am + 0.7],
      bob: 0.12 * Math.abs(c), tilt: 0.07 * w, lean: -0.06, nod: 0.08 * Math.abs(Math.cos(k - 0.6)), jig: k, hip: 0.88 };
  }
  const k = phase * (run ? 3.2 : 4.6), w = Math.sin(k), sw = w * (run ? 0.75 : 0.5);
  return { legs: [-sw, sw], arms: [sw * 0.8, -sw * 0.8], bob: Math.abs(Math.cos(k)) * (run ? 0.08 : 0.04), jig: k };
}
// Standing about at time t: the weight shifting from foot to foot. In the storybook city they
// fidget too, now and then tapping a toe for a moment and bouncing on their heels, each in their own
// time (`seed`), and their costumes swing as they do.
export function standIdle(b: Body, t: number, seed: number) {
  b.tilt = 0.05 * Math.sin(t * 1.1 + seed);
  if (!FIG_STYLE.storybook) return;
  b.jig = t * 1.5 + seed;
  const tap = (t + seed) % 5, heel = (t + seed * 1.7) % 4;
  if (tap < 1.2) { const k = 0.5 - 0.5 * Math.cos(tap * Math.PI * 2 * 3); b.legs = [0, 0.12 * k]; b.shins = [0, -0.25 * k]; b.hip = 0.88 * (b.s ?? 1); }
  if (heel < 0.4) b.y = (b.y ?? CURB_H) + 0.05 * Math.sin(heel / 0.4 * Math.PI);
}
