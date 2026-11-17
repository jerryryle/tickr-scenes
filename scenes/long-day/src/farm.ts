// Farm animals and machines for the country drive's farm set pieces (country.ts "cattle" and
// "tractor"): cows of three breeds, a horse with its rider, and a farm tractor towing a hay
// wagon. Blocky like everything else, but shaped so they read at LED size: a cow's barrel, rump,
// brisket, neck and a head that drops to graze; legs that swing as they walk.
// Every model faces +x with its feet (wheels) on the ground at the origin; a cow's or the
// horse's origin is under the middle of its barrel, the tractor's under its rear axle.
// Each kind's parts are built once and shared (geometry), so a herd costs little to build.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { Character, restPose } from "./character.ts";
import type { BodyPose } from "./character.ts";

export type Coat = 0 | 1 | 2;   // Holstein (black and white), Hereford (red, white face), Angus (black)
const COATS = [
  { main: 0xf2f0ea, patch: 0x1c1c1c, face: 0xf2f0ea, belly: 0xf2f0ea, muzzle: 0xe2a8a0, leg: 0xf2f0ea, tuft: 0x1c1c1c, udder: true, horns: false },
  { main: 0x8b3a1c, patch: 0x8b3a1c, face: 0xf2efe6, belly: 0xf2efe6, muzzle: 0xd8b0a0, leg: 0x8b3a1c, tuft: 0xf2efe6, udder: false, horns: true },
  { main: 0x232120, patch: 0x232120, face: 0x232120, belly: 0x232120, muzzle: 0x3a3634, leg: 0x232120, tuft: 0x232120, udder: false, horns: false },
];
const HOOF = 0x2a2420;

type Parts = Record<string, THREE.BufferGeometry>;
const cache = new Map<string, Parts>();
function parts(key: string, mat: THREE.Material, build: (add: (name: string, f: (b: Batch) => void) => void) => void): Parts {
  let p = cache.get(key);
  if (!p) {
    const out: Parts = {};
    build((name, f) => { const b = new Batch(); f(b); out[name] = b.build(mat)!.geometry; });
    cache.set(key, p = out);
  }
  return p;
}

// ---- cows -----------------------------------------------------------------------------------
const COW_LEGS: [number, number][] = [[0.62, -0.24], [0.62, 0.24], [-0.62, -0.24], [-0.62, 0.24]];
export class Cow {
  readonly root = new THREE.Group();
  private head = new THREE.Group();
  private legs: THREE.Group[] = [];
  constructor(mat: THREE.Material, coat: Coat) {
    const C = COATS[coat];
    const P = parts(`cow${coat}`, mat, (add) => {
      add("body", (b) => {
        b.box(0.05, 1.12, 0, 1.6, 0.6, 0.8, C.main);              // barrel
        b.box(-0.72, 1.17, 0, 0.42, 0.66, 0.78, C.main);          // rump, a little higher
        b.box(0.7, 1.15, 0, 0.36, 0.62, 0.74, C.main);            // shoulders
        b.box(0.86, 0.9, 0, 0.2, 0.26, 0.42, C.main);             // brisket
        b.box(0, 0.86, 0, 1.3, 0.1, 0.62, C.belly);               // underline (white on a Hereford)
        b.boxR(0.98, 1.3, 0, 0.42, 0.42, 0.46, C.main, 0, 0, 0.45);   // neck
        b.box(-0.95, 1.06, 0, 0.05, 0.76, 0.05, C.main);          // tail and its switch
        b.box(-0.95, 0.66, 0, 0.09, 0.14, 0.09, C.tuft);
        if (C.udder) b.box(-0.45, 0.79, 0, 0.32, 0.12, 0.3, 0xe8a0a0);
        if (coat === 0) {                                         // Holstein patches, a cm proud
          b.box(0.25, 1.22, 0.405, 0.55, 0.34, 0.02, C.patch); b.box(-0.5, 1.06, 0.405, 0.4, 0.3, 0.02, C.patch);
          b.box(0.05, 1.08, -0.405, 0.7, 0.32, 0.02, C.patch); b.box(-0.73, 1.3, -0.395, 0.3, 0.3, 0.02, C.patch);
          b.box(-0.15, 1.425, 0, 0.5, 0.02, 0.46, C.patch);
        }
      });
      add("head", (b) => {   // from the poll (the neck's joint), nose along +x
        b.box(0.28, -0.05, 0, 0.46, 0.36, 0.34, C.face);
        b.box(0.565, -0.13, 0, 0.14, 0.24, 0.3, C.muzzle);
        for (const z of [-0.24, 0.24]) b.box(0.12, 0.08, z, 0.1, 0.07, 0.16, C.main);   // ears
        for (const z of [-0.172, 0.172]) b.box(0.36, 0.02, z, 0.05, 0.05, 0.01, 0x101010);   // eyes
        if (C.horns) for (const z of [-0.15, 0.15]) b.box(0.14, 0.16, z, 0.05, 0.1, 0.05, 0xe8dcc0);
        if (coat === 0) b.box(0.18, 0.135, 0, 0.26, 0.02, 0.3, C.patch);
      });
      // A leg in two: forearm (gaskin behind) from the body to the knee (hock), then the cannon
      // and the hoof.
      add("upper", (b) => b.box(0, -0.24, 0, 0.17, 0.5, 0.17, C.leg));
      add("lower", (b) => { b.box(0, -0.2, 0, 0.13, 0.42, 0.13, C.leg); b.box(0, -0.45, 0, 0.16, 0.08, 0.16, HOOF); });
    });
    this.root.add(this.frame);
    this.frame.add(new THREE.Mesh(P.body, mat));
    this.head.position.set(1.12, 1.36, 0); this.head.add(new THREE.Mesh(P.head, mat)); this.frame.add(this.head);
    for (const [x, z] of COW_LEGS) {
      const up = new THREE.Group(), lo = new THREE.Group();
      up.position.set(x, 0.97, z); up.add(new THREE.Mesh(P.upper, mat)); lo.position.y = -0.48; lo.add(new THREE.Mesh(P.lower, mat)); up.add(lo);
      this.frame.add(up); this.legs.push(up); this.lower.push(lo);
    }
  }
  private frame = new THREE.Group(); private lower: THREE.Group[] = [];
  // phase: walking cycles; walking 0..1 (standing still..striding); graze 0..1 (head up..down to
  // the grass). A four-beat walk (hind, fore, the other hind, the other fore, a quarter apart),
  // each knee and hock folding as its leg swings through; the head nods twice a stride and the
  // body sways and bobs.
  pose(phase: number, walking: number, graze: number) {
    walkLegs(this.legs, this.lower, phase, walking, 0.3, 0.65);
    const t = phase * Math.PI * 2;
    this.head.rotation.z = -0.12 - 0.95 * graze + 0.08 * Math.sin(2 * t) * walking;
    this.head.position.y = 1.36 - 0.25 * graze;
    this.frame.rotation.x = 0.035 * Math.sin(t) * walking;
    this.frame.position.y = 0.025 * Math.abs(Math.sin(t)) * walking;
  }
}

// The legs in order front left, front right, hind left, hind right: each leg's upper part swings
// (amp, radians) and its lower part folds back as the leg comes forward (bend).
const BEAT = [0.25, 0.75, 0, 0.5];   // (the lateral four-beat walk: LH, LF, RH, RF)
function walkLegs(up: THREE.Group[], lo: THREE.Group[], phase: number, walking: number, amp: number, bend: number) {
  for (let k = 0; k < 4; k++) {
    const t = (phase + BEAT[k]) * Math.PI * 2;
    up[k].rotation.z = Math.sin(t) * amp * walking;
    lo[k].rotation.z = -Math.max(0, Math.cos(t)) * bend * walking * (k < 2 ? 1 : 0.75);
  }
}

// ---- the horse and its rider ------------------------------------------------------------------
const HORSE_LEGS: [number, number][] = [[0.7, -0.2], [0.7, 0.2], [-0.7, -0.2], [-0.7, 0.2]];
const RANCHER = { jacket: 0x8a2a22, trousers: 0x2f4a6e, boots: 0x4a3020, gloves: 0x8a6a40, skin: 0xc89070, hat: 0x5a3a20, hatPatch: 0x4a2e18, vest: 0, hardHat: false };
export class Horse {
  readonly root = new THREE.Group();
  private legs: THREE.Group[] = [];
  private rider: Character; private pose0: BodyPose = restPose();
  constructor(mat: THREE.Material) {
    const M = 0x6e3f22, D = 0x1e1612;
    const P = parts("horse", mat, (add) => {
      add("body", (b) => {
        // The barrel, rounded: narrower under the belly and stepping in over the back.
        b.box(0, 1.22, 0, 1.7, 0.48, 0.62, M);
        b.box(0, 0.96, 0, 1.4, 0.08, 0.48, M);
        b.box(0, 1.5, 0, 1.66, 0.1, 0.5, M);
        b.box(0, 1.585, 0, 1.5, 0.07, 0.34, M);
        b.box(0.75, 1.3, 0, 0.36, 0.64, 0.58, M);                     // chest
        b.box(-0.75, 1.32, 0, 0.4, 0.62, 0.6, M);                     // hindquarters
        b.box(-0.75, 1.66, 0, 0.36, 0.1, 0.42, M);
        b.boxR(1.05, 1.75, 0, 0.36, 0.86, 0.36, M, 0, 0, -0.55);       // neck, up and forward
        b.boxR(0.96, 1.86, 0, 0.1, 0.8, 0.12, D, 0, 0, -0.55);         // mane
        b.boxR(1.52, 2.02, 0, 0.62, 0.26, 0.27, M, 0, 0, -0.9);        // head, nose down
        b.boxR(1.68, 1.8, 0, 0.18, 0.2, 0.25, 0x3a2418, 0, 0, -0.9);   // muzzle
        for (const z of [-0.08, 0.08]) b.box(1.36, 2.36, z, 0.06, 0.14, 0.05, M);   // ears
        b.boxR(-1.02, 1.2, 0, 0.12, 0.85, 0.14, D, 0, 0, 0.28);        // tail
        // The saddle on its blanket, its flaps down the sides, the seat on top, the horn in front.
        b.box(0.1, 1.635, 0, 0.8, 0.04, 0.4, 0xa83a2a);
        for (const z of [-0.33, 0.33]) b.box(0.1, 1.42, z, 0.62, 0.36, 0.03, 0xa83a2a);
        for (const z of [-0.355, 0.355]) b.box(0.08, 1.45, z, 0.46, 0.34, 0.03, 0x3a2416);
        b.box(0.08, 1.7, 0, 0.6, 0.1, 0.38, 0x3a2416);
        b.box(0.36, 1.8, 0, 0.08, 0.14, 0.1, 0x3a2416);
      });
      add("upper", (b) => b.box(0, -0.25, 0, 0.15, 0.52, 0.15, M));
      add("lower", (b) => { b.box(0, -0.18, 0, 0.12, 0.38, 0.12, M); b.box(0, -0.4, 0, 0.125, 0.16, 0.125, D); b.box(0, -0.47, 0, 0.15, 0.06, 0.15, 0x141414); });
    });
    this.root.add(new THREE.Mesh(P.body, mat));
    for (const [x, z] of HORSE_LEGS) {
      const up = new THREE.Group(), lo = new THREE.Group();
      up.position.set(x, 1.0, z); up.add(new THREE.Mesh(P.upper, mat)); lo.position.y = -0.5; lo.add(new THREE.Mesh(P.lower, mat)); up.add(lo);
      this.root.add(up); this.legs.push(up); this.lower.push(lo);
    }
    this.rider = new Character(mat, RANCHER);
    this.rider.root.position.set(0.02, 1.8 - 0.92, 0);    // hips on the saddle's seat
    const p = this.pose0;
    p.hipL = p.hipR = 0.4; p.knL = p.knR = -0.6;            // astride: thighs forward and out over the barrel, shins hanging down its sides
    p.shLP = p.shRP = 0.55; p.elL = p.elR = 0.75;           // hands forward on the reins
    p.bend = 0.05;
    this.rider.apply(p); this.rider.setLegSpread(0.85, 0.85);
    this.root.add(this.rider.root);
  }
  private lower: THREE.Group[] = [];
  pose(phase: number, walking: number) {
    walkLegs(this.legs, this.lower, phase, walking, 0.3, 0.7);
    this.rider.root.position.y = 0.88 + Math.abs(Math.sin(phase * Math.PI * 2)) * 0.03 * walking;   // a little bob in the saddle
  }
}

// ---- the tractor and its hay wagon ---------------------------------------------------------------
const FARMER = { jacket: 0x2f4a6e, trousers: 0x2f4a6e, boots: 0x3a2e22, gloves: 0x8a6a40, skin: 0xb5815f, hat: 0xc0392b, hatPatch: 0xf2f2ee, vest: 0, hardHat: false };
export const TRACTOR_REAR_R = 0.8, TRACTOR_FRONT_R = 0.45;
export class Tractor {
  readonly root = new THREE.Group();
  private wheels: { g: THREE.Group; r: number }[] = [];
  readonly beacon: THREE.Mesh;
  constructor(mat: THREE.Material, glowMat: THREE.Material) {
    const G = 0x2e7d32, Y = 0xf2c200, DK = 0x26282b, TIRE = 0x1c1c1c;
    const P = parts("tractor", mat, (add) => {
      add("body", (b) => {
        // Chassis, engine and hood out front, its grille; the fenders over the rear wheels.
        b.box(1.65, 0.62, 0, 2.4, 0.3, 0.6, DK);
        b.box(1.75, 1.15, 0, 2.3, 0.75, 0.82, G);
        b.box(2.92, 1.12, 0, 0.06, 0.62, 0.7, DK);
        b.aux.set(0, 0, -3); for (const k of [-0.15, 0.15]) b.box(2.955, 1.25, k * 2, 0.02, 0.12, 0.16, 0xfff4d0); b.aux.set(0, 0, -1);   // headlamps (lit after dark)
        b.box(1.75, 1.535, 0, 2.25, 0.02, 0.76, 0x256a29);                          // hood seam
        for (const z of [-0.85, 0.85]) { b.box(0.05, 1.68, z, 1.2, 0.08, 0.56, G); b.boxR(0.75, 1.42, z, 0.5, 0.08, 0.56, G, 0, 0, -0.7); }
        // Cab: four posts, a roof, the seat and the steering wheel; the exhaust stack.
        for (const x of [-0.45, 0.85]) for (const z of [-0.62, 0.62]) b.box(x, 2.05, z, 0.08, 1.7, 0.08, DK);
        b.box(0.2, 2.95, 0, 1.6, 0.12, 1.45, G); b.box(0.2, 3.03, 0, 1.4, 0.06, 1.25, 0xf2f2ee);
        b.box(0.0, 1.35, 0, 0.5, 0.12, 0.5, DK); b.box(-0.22, 1.65, 0, 0.1, 0.5, 0.5, DK);
        b.boxR(0.55, 1.75, 0, 0.04, 0.34, 0.34, DK, 0, 0, 0.5);
        b.cyl(2.35, 2.05, -0.28, 0.06, 1.05, 0x4a4d52, 6);
        b.box(2.35, 2.6, -0.28, 0.1, 0.06, 0.1, 0x2a2a2a);
        // The hitch and the hay wagon: a flatbed on four wheels, square bales two high, the
        // slow-moving vehicle triangle on its tail.
        b.box(-0.95, 0.55, 0, 1.2, 0.08, 0.1, DK);
        b.box(-3.55, 0.92, 0, 4.2, 0.14, 2.1, 0x8a5a34);
        for (const z of [-1.0, 1.0]) b.box(-3.55, 1.12, z, 4.2, 0.3, 0.08, 0x7a4a2a);
        for (let k = 0; k < 4; k++) for (const z of [-0.5, 0.5]) for (let lv = 0; lv < 2; lv++) {
          if (lv === 1 && k === 3) continue;
          b.box(-2.0 - k * 1.02, 1.24 + lv * 0.44, z + (lv ? 0.02 : 0), 0.98, 0.42, 0.96, lv ? 0xd8c070 : 0xccb262);
        }
        b.box(-5.68, 1.3, 0.55, 0.03, 0.5, 0.5, 0xff6a00);
        b.aux.set(0, 0, -4); for (const z of [-0.85, 0.85]) b.box(-5.67, 0.95, z, 0.03, 0.12, 0.18, 0x8a1010); b.aux.set(0, 0, -1);   // tail lamps
      });
      add("rear", (b) => { b.cyl(0, 0, 0, TRACTOR_REAR_R, 0.45, TIRE, 14, Math.PI / 2); b.cyl(0, 0, 0, 0.42, 0.47, Y, 10, Math.PI / 2); for (let k = 0; k < 7; k++) b.boxR(0, 0, 0, 0.16, 1.66, 0.43, 0x161616, 0, 0, k / 7 * Math.PI); });   // (tread lugs at the rim, inside the tyre's faces)
      add("front", (b) => { b.cyl(0, 0, 0, TRACTOR_FRONT_R, 0.26, TIRE, 12, Math.PI / 2); b.cyl(0, 0, 0, 0.24, 0.28, Y, 8, Math.PI / 2); });
      add("wagonWheel", (b) => { b.cyl(0, 0, 0, 0.36, 0.22, TIRE, 10, Math.PI / 2); b.cyl(0, 0, 0, 0.18, 0.24, 0xa8a49a, 8, Math.PI / 2); });
    });
    this.root.add(new THREE.Mesh(P.body, mat));
    const wheel = (geo: THREE.BufferGeometry, x: number, y: number, z: number, r: number) => {
      const g = new THREE.Group(); g.position.set(x, y, z); g.add(new THREE.Mesh(geo, mat)); this.root.add(g); this.wheels.push({ g, r });
    };
    for (const z of [-0.85, 0.85]) wheel(P.rear, 0, TRACTOR_REAR_R, z, TRACTOR_REAR_R);
    for (const z of [-0.6, 0.6]) wheel(P.front, 2.35, TRACTOR_FRONT_R, z, TRACTOR_FRONT_R);
    for (const x of [-2.2, -4.9]) for (const z of [-0.95, 0.95]) wheel(P.wagonWheel, x, 0.36, z, 0.36);
    const lb = new Batch(); lb.box(0, 0, 0, 0.16, 0.12, 0.16, 0xffa020);
    this.beacon = lb.build(glowMat)!; this.beacon.position.set(0.2, 3.12, -0.55); this.root.add(this.beacon);
    const driver = new Character(mat, FARMER), p = restPose();
    p.hipL = p.hipR = 1.45; p.knL = p.knR = -1.35; p.drop = 0.42; p.shLP = p.shRP = 0.75; p.elL = p.elR = 0.6;
    driver.apply(p); driver.root.position.set(0.02, 1.41 - (0.92 - 0.42), 0); this.root.add(driver.root);
  }
  // dist: how far it has rolled (turns the wheels); flash: the beacon's on.
  pose(dist: number, flash: boolean) {
    for (const w of this.wheels) w.g.rotation.z = -dist / w.r;
    this.beacon.visible = flash;
  }
}
