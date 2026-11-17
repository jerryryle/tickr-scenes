// People: the recurring driver and dock workers, as blocky pixel-art figures on a simple joint
// rig. The driver is deliberately gender-neutral: a navy Ryder work jacket with the red and
// yellow chest patch, work trousers, boots, gloves and a cap, a plain face and a medium build.
// Workers wear grey with an orange vest and a yellow hard hat.
//
// The figure faces +x with its feet at the origin (so root yaw follows the truck's heading
// convention). Limbs swing about z: positive brings a limb forward. Poses are flat records of
// joint angles so they can be blended.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import type { Gesture } from "./chores.ts";

export interface BodyPose {
  bend: number;     // torso pitch, negative leans forward
  twist: number;    // torso yaw
  headP: number; headY: number;
  shLP: number; shLR: number; elL: number;   // left shoulder pitch, roll (out from the body), elbow
  shRP: number; shRR: number; elR: number;
  hipL: number; knL: number; hipR: number; knR: number;   // knee negative bends
  drop: number;     // hips lowered (crouch, sitting), metres
}
const POSE_KEYS = ["bend", "twist", "headP", "headY", "shLP", "shLR", "elL", "shRP", "shRR", "elR", "hipL", "knL", "hipR", "knR", "drop"] as const;
export const restPose = (): BodyPose => ({ bend: 0, twist: 0, headP: 0, headY: 0, shLP: 0, shLR: 0.06, elL: 0.15, shRP: 0, shRR: 0.06, elR: 0.15, hipL: 0, knL: 0, hipR: 0, knR: 0, drop: 0 });
export function blendPose(a: BodyPose, b: BodyPose, t: number, out: BodyPose = restPose()): BodyPose {
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export const HIP_Y = 0.92;
export const CHARACTER_HIP_Y = HIP_Y;

interface Look { jacket: number; trousers: number; boots: number; gloves: number; skin: number; hat: number; hatPatch: number; vest: number; hardHat: boolean }
export const DRIVER_LOOK: Look = { jacket: 0x23365e, trousers: 0x3b3f46, boots: 0x2b241e, gloves: 0xb08a58, skin: 0xb5815f, hat: 0x23365e, hatPatch: 0xce1126, vest: 0xd8f22a, hardHat: false };
export const WORKER_LOOK: Look = { jacket: 0x6b6f75, trousers: 0x34383e, boots: 0x3a2e22, gloves: 0x8a8f55, skin: 0x8a5a3c, hat: 0xf2c200, hatPatch: 0xf2c200, vest: 0xff7a1a, hardHat: true };

export class Character {
  readonly root = new THREE.Group();
  private hips = new THREE.Group(); private torso = new THREE.Group(); private head = new THREE.Group();
  private shL = new THREE.Group(); private shR = new THREE.Group(); private elL = new THREE.Group(); private elR = new THREE.Group();
  private hipL = new THREE.Group(); private hipR = new THREE.Group(); private knL = new THREE.Group(); private knR = new THREE.Group();
  readonly handL = new THREE.Object3D(); readonly handR = new THREE.Object3D();
  private vest: THREE.Mesh;
  readonly headMeshes: THREE.Object3D[] = [];

  constructor(material: THREE.Material, look: Look, vest = false) {
    const part = (parent: THREE.Object3D, build: (b: Batch) => void) => {
      const b = new Batch(); build(b);
      const m = b.build(material)!; parent.add(m); return m;
    };
    this.root.add(this.hips);
    this.hips.position.y = HIP_Y;
    // Pelvis and torso.
    part(this.hips, (b) => b.box(0, 0.02, 0, 0.22, 0.18, 0.34, look.trousers));
    this.hips.add(this.torso);
    part(this.torso, (b) => {
      b.box(0, 0.3, 0, 0.24, 0.52, 0.4, look.jacket);
      b.box(0, 0.07, 0, 0.25, 0.06, 0.41, 0x2a2a2a);                  // belt
      b.box(0.121, 0.42, -0.1, 0.01, 0.06, 0.07, 0xce1126);            // chest patch, red and yellow
      b.box(0.121, 0.385, -0.1, 0.01, 0.02, 0.07, 0xf2c200);
      b.box(0.121, 0.3, 0, 0.01, 0.4, 0.02, 0x1b2a49);                 // zip
    });
    this.vest = part(this.torso, (b) => {
      b.box(0, 0.33, 0, 0.26, 0.38, 0.42, look.vest);
      b.box(0, 0.24, 0, 0.265, 0.035, 0.425, 0xd8d8d8);                // reflective bands
      b.box(0, 0.4, 0, 0.265, 0.035, 0.425, 0xd8d8d8);
    });
    this.vest.visible = vest;
    // Head: a plain face (two eyes) under a cap or hard hat.
    this.torso.add(this.head);
    this.head.position.y = 0.56;
    this.headMeshes.push(part(this.head, (b) => {
      b.box(0, 0.06, 0, 0.1, 0.08, 0.1, look.skin);                   // neck
      b.box(0, 0.17, 0, 0.22, 0.24, 0.21, look.skin);
      for (const z of [-0.05, 0.05]) b.box(0.111, 0.18, z, 0.01, 0.03, 0.03, 0x1a1a1a);
      if (look.hardHat) {
        b.box(0, 0.31, 0, 0.25, 0.08, 0.24, look.hat);
        b.box(0, 0.275, 0, 0.29, 0.02, 0.28, look.hat);
      } else {
        b.box(-0.005, 0.305, 0, 0.235, 0.07, 0.225, look.hat);
        b.box(0.15, 0.275, 0, 0.11, 0.02, 0.2, look.hat);              // brim
        b.box(0.114, 0.31, 0, 0.01, 0.04, 0.06, look.hatPatch);
      }
    }));
    // Arms.
    for (const [sh, el, hand, z] of [[this.shL, this.elL, this.handL, -0.25], [this.shR, this.elR, this.handR, 0.25]] as const) {
      this.torso.add(sh); sh.position.set(0, 0.5, z);
      part(sh, (b) => b.box(0, -0.14, 0, 0.11, 0.3, 0.11, look.jacket));
      sh.add(el); el.position.y = -0.29;
      part(el, (b) => { b.box(0, -0.13, 0, 0.1, 0.27, 0.1, look.jacket); b.box(0, -0.31, 0, 0.11, 0.1, 0.12, look.gloves); });
      el.add(hand); hand.position.y = -0.32;
    }
    // Legs.
    for (const [hp, kn, z] of [[this.hipL, this.knL, -0.1], [this.hipR, this.knR, 0.1]] as const) {
      this.hips.add(hp); hp.position.set(0, 0, z);
      part(hp, (b) => b.box(0, -0.21, 0, 0.15, 0.43, 0.15, look.trousers));
      hp.add(kn); kn.position.y = -0.43;
      part(kn, (b) => { b.box(0, -0.2, 0, 0.13, 0.4, 0.13, look.trousers); b.box(0.045, -0.455, 0, 0.25, 0.08, 0.14, look.boots); });
    }
  }

  set vestOn(v: boolean) { this.vest.visible = v; }
  // The legs spread apart (radians, each thigh out to its own side) and the shins turned back
  // under (knee): astride a horse. apply() leaves both.
  setLegSpread(r: number, knee = 0) { this.hipL.rotation.x = r; this.hipR.rotation.x = -r; this.knL.rotation.x = -knee; this.knR.rotation.x = knee; }
  set headVisible(v: boolean) { for (const m of this.headMeshes) m.visible = v; }

  apply(p: BodyPose) {
    this.hips.position.y = HIP_Y - p.drop;
    this.torso.rotation.set(0, p.twist, p.bend);
    this.head.rotation.set(0, p.headY, p.headP);
    this.shL.rotation.set(p.shLR, 0, p.shLP, "XZY"); this.elL.rotation.z = p.elL;
    this.shR.rotation.set(-p.shRR, 0, p.shRP, "XZY"); this.elR.rotation.z = p.elR;
    this.hipL.rotation.z = p.hipL; this.knL.rotation.z = p.knL;
    this.hipR.rotation.z = p.hipR; this.knR.rotation.z = p.knR;
  }
}

// ---- poses ----------------------------------------------------------------------------------
// Walking: phase in cycles (one cycle = two steps). `arms` false leaves the arms to an upper-body
// pose (carrying, pushing).
export function walkPose(phase: number, out: BodyPose, arms = true, stride = 1): BodyPose {
  const s = Math.sin(phase * Math.PI * 2), c = Math.cos(phase * Math.PI * 2);
  out.hipL = 0.45 * s * stride; out.hipR = -0.45 * s * stride;
  out.knL = -Math.max(0, -c) * 0.7 * stride - 0.05; out.knR = -Math.max(0, c) * 0.7 * stride - 0.05;
  out.drop = 0.02 + 0.015 * Math.abs(Math.sin(phase * Math.PI * 4));
  out.bend = -0.04;
  if (arms) { out.shLP = -0.4 * s * stride; out.shRP = 0.4 * s * stride; out.elL = 0.3 + 0.15 * Math.max(0, -s); out.elR = 0.3 + 0.15 * Math.max(0, s); }
  return out;
}
export function idlePose(t: number, out: BodyPose): BodyPose {
  Object.assign(out, restPose());
  out.bend = 0.015 * Math.sin(t * 1.7);   // breathing
  out.headY = 0.15 * Math.sin(t * 0.37);
  return out;
}
// Upper-body overrides, applied on top of a walk or idle.
export function carryArms(out: BodyPose): BodyPose { out.shLP = 1.0; out.shRP = 1.0; out.elL = 1.15; out.elR = 1.15; out.shLR = out.shRR = 0.1; out.bend = 0.04; return out; }
export function pushArms(out: BodyPose): BodyPose { out.shLP = 0.85; out.shRP = 0.85; out.elL = 0.35; out.elR = 0.35; out.shLR = out.shRR = 0.12; out.bend = -0.22; return out; }
export function lowArms(out: BodyPose): BodyPose { out.shLP = 0.55; out.shRP = 0.55; out.elL = 0.25; out.elR = 0.25; out.bend = -0.45; out.drop += 0.06; return out; }
export function liftArms(out: BodyPose): BodyPose { out.shLP = 0.25; out.shRP = 0.25; out.elL = 0.45; out.elR = 0.45; out.shLR = out.shRR = 0.25; return out; }
export function seatedPose(out: BodyPose, steer = 0): BodyPose {
  Object.assign(out, restPose());
  out.hipL = out.hipR = 1.45; out.knL = out.knR = -1.45; out.drop = 0;
  out.shLP = out.shRP = 1.05; out.elL = out.elR = 0.55;
  out.twist = steer * 0.25; out.shLP += steer * 0.3; out.shRP -= steer * 0.3;
  return out;
}
export function gesturePose(g: Gesture | "strap" | "reach" | "stow" | "climb", t: number, out: BodyPose): BodyPose {
  idlePose(t, out);
  switch (g) {
    case "clipboard": out.shLP = 0.9; out.elL = 1.4; out.shRP = 0.6; out.elR = 1.2 + 0.1 * Math.sin(t * 6); out.headP = -0.35; break;
    case "stretch": { const k = Math.min(1, Math.sin(Math.min(t / 2.5, 1) * Math.PI) * 1.4); out.shLP = out.shRP = 2.9 * k; out.elL = out.elR = 0.1; out.bend = 0.12 * k; break; }
    case "wave": out.shRP = 2.4; out.shRR = 0.35 + 0.35 * Math.sin(t * 9); out.elR = 0.6; break;
    case "coffee": out.shRP = 0.4 + 0.8 * Math.max(0, Math.sin(t * 1.3)); out.elR = 1.6 + 0.6 * Math.max(0, Math.sin(t * 1.3)); out.headP = 0.1 * Math.max(0, Math.sin(t * 1.3)); break;
    case "strap": { const k = Math.min(1, t * 2); out.shLP = out.shRP = 2.6 * k; out.elL = out.elR = 0.3; break; }
    case "reach": out.shLP = out.shRP = 1.3; out.elL = out.elR = 0.4; out.bend = -0.3; break;
    case "stow": out.shLP = out.shRP = 1.0 + 0.4 * Math.sin(t * 4); out.elL = out.elR = 0.6; out.bend = -0.35; out.drop = 0.12; out.knL = out.knR = -0.3; out.hipL = out.hipR = 0.3; break;
    case "climb": out.shLP = 2.2; out.elL = 0.4; out.shRP = 1.6; out.elR = 0.8; out.hipL = 0.9; out.knL = -1.2; out.hipR = 0.1; out.knR = -0.2; break;
  }
  return out;
}
