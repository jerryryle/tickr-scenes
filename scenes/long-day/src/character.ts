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
  sideL: number; sideR: number;   // each leg swung out to the side (hip roll: positive, the foot to the left)
  drop: number;     // hips lowered (crouch, sitting), metres
}
const POSE_KEYS = ["bend", "twist", "headP", "headY", "shLP", "shLR", "elL", "shRP", "shRR", "elR", "hipL", "knL", "hipR", "knR", "sideL", "sideR", "drop"] as const;
export const restPose = (): BodyPose => ({ bend: 0, twist: 0, headP: 0, headY: 0, shLP: 0, shLR: 0.06, elL: 0.15, shRP: 0, shRR: 0.06, elR: 0.15, hipL: 0, knL: 0, hipR: 0, knR: 0, sideL: 0, sideR: 0, drop: 0 });
export function blendPose(a: BodyPose, b: BodyPose, t: number, out: BodyPose = restPose()): BodyPose {
  for (const k of POSE_KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export const HIP_Y = 0.92;
export const CHARACTER_HIP_Y = HIP_Y;
// The rig's limbs: shoulder to elbow, elbow to the middle of the glove; hip to knee, knee to the sole.
export const ARM_U = 0.29, ARM_F = 0.32, LEG_U = 0.43, LEG_L = 0.495;
export const SHOULDER_Y = 0.5;   // the shoulders above the hips, along the torso

// A point (x forward, y up, z right, from the shoulder) brought into the arm's plane: the roll
// that turns the plane out (s = 1 left, -1 right: out is -z on the left) to contain it, within
// [lo, hi], and the point's coordinates in the plane (forward, and along the arm's hanging line).
function limbPlane(x: number, y: number, z: number, s: number, lo: number, hi: number): [number, number, number] {
  const below = Math.atan2(-s * z, -y);
  if (below >= lo && below <= hi) return [below, x, Math.hypot(y, z)];
  const above = Math.atan2(s * z, y), th = THREE.MathUtils.clamp(Math.abs(above - THREE.MathUtils.clamp(above, lo, hi)) < Math.abs(below - THREE.MathUtils.clamp(below, lo, hi)) ? above : below, lo, hi);
  return [th, x, -y * Math.cos(th) - s * z * Math.sin(th)];
}
// Two segments a, b from the root to a point (fwd, down) in their plane: the root's angle from
// hanging straight down (positive forward) and the middle joint's (bend +1: folding forward, an
// elbow; -1: back, a knee), and how far short the point is when out of reach.
function twoBone(fwd: number, dn: number, a: number, b: number, bend: 1 | -1): [number, number, number] {
  const d0 = Math.hypot(fwd, dn), d = THREE.MathUtils.clamp(d0, Math.abs(a - b) + 1e-3, (a + b) * 0.999);
  const beta = Math.atan2(fwd, dn);
  const joint = Math.PI - Math.acos(THREE.MathUtils.clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1));
  const base = beta - bend * Math.acos(THREE.MathUtils.clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  return [base, bend * joint, Math.max(0, d0 - (a + b))];
}

// The body lowered and leaning so the hands reach a point `h` above the feet and `ahead` of them:
// bent at the hips and knees for anything low, leaning for anything far (`lean`: added, as into a
// push). Sets the torso, the drop and (to be planted again by Character.step) the legs.
export function stoopFor(P: BodyPose, h: number, ahead: number, o: { lean?: number } = {}): BodyPose {
  const k = THREE.MathUtils.clamp((1.18 - h) / 0.9, 0, 1);
  const bend = -0.06 - 0.72 * k - THREE.MathUtils.clamp((ahead - 0.5) * 0.9, 0, 0.45) * (1 - k) + (o.lean ?? 0);
  const drop = 0.4 * k * k + 0.08 * k;
  P.bend = bend; P.drop = Math.min(0.5, drop);
  P.hipL = P.hipR = 0.4 * k; P.knL = P.knR = -0.8 * k;
  P.headP = THREE.MathUtils.clamp(-bend * 0.45 + 0.05, -0.2, 0.55);
  return P;
}

interface Look { jacket: number; trousers: number; boots: number; gloves: number; skin: number; hat: number; hatPatch: number; vest: number; hardHat: boolean }
export const DRIVER_LOOK: Look = { jacket: 0x23365e, trousers: 0x3b3f46, boots: 0x2b241e, gloves: 0xb08a58, skin: 0xb5815f, hat: 0x23365e, hatPatch: 0xce1126, vest: 0xd8f22a, hardHat: false };
export const WORKER_LOOK: Look = { jacket: 0x6b6f75, trousers: 0x34383e, boots: 0x3a2e22, gloves: 0x8a8f55, skin: 0x8a5a3c, hat: 0xf2c200, hatPatch: 0xf2c200, vest: 0xff7a1a, hardHat: true };

// The crew's period dress (Character.period), worn in the Victorian city and on the road into it:
// a carman's collarless shirt, a waistcoat, a neckerchief, trousers and boots, under a bowler or a
// flat cap. The driver drives the van from its open box in all weathers, so he wears a fustian
// jacket open over the waistcoat, as carriers' vanmen did. The mate works in shirtsleeves rolled
// to the elbow and a leather apron.
interface PeriodLook { shirt: number; waistcoat: number; neck: number; trousers: number; boots: number; hat: number; bowler: boolean; apron?: number; jacket?: number }
export const CARTER_DRIVER: PeriodLook = { shirt: 0xe6e0d0, waistcoat: 0x3a3026, neck: 0xa82a2a, trousers: 0x3a3630, boots: 0x2a201a, hat: 0x1e1c1a, bowler: true, jacket: 0x8c7a56 };
export const CARTER_MATE: PeriodLook = { shirt: 0xd4cebe, waistcoat: 0x4a4a42, neck: 0x2a4a7a, trousers: 0x3a3a36, boots: 0x2a201a, hat: 0x4a4238, bowler: false, apron: 0x7a5434 };

// The crew's storybook dress (Character.story), worn in the storybook city and on the road while
// its land has crept more than half in: the Ryder colours in the town's idiom. The driver wears a
// long-tailed navy coat with gold buttons over a cream front, a tall bending stovepipe striped red
// and cream with a gold band, a striped scarf, white cartoon gloves and long upturned shoes. The
// mate wears a striped jumper, knee breeches, long stockings and a knitted cap with a tassel and a
// pompom, its brim in Ryder red.
interface StoryLook {
  coat: number; front: number; trousers: number; shoes: number; hands: number; hat: number; hat2: number; band: number;
  scarf?: [number, number];   // a scarf's two stripes (the driver)
  stockings?: number;         // the mate's breeches stop at the knee over these
  stovepipe: boolean;         // a stovepipe, or a knitted cap with a tassel
}
export const STORY_DRIVER: StoryLook = { coat: 0x2b3f8a, front: 0xfff3dc, trousers: 0x4a3a6a, shoes: 0xce1126, hands: 0xfffdf4, hat: 0xce1126, hat2: 0xfff3dc, band: 0xf2c200, scarf: [0xf2c200, 0x2b3f8a], stovepipe: true };
export const STORY_MATE: StoryLook = { coat: 0xe8333a, front: 0xfff3dc, trousers: 0xf2c230, shoes: 0x6a3a9a, hands: 0x8a5a3c, hat: 0x1fb5b0, hat2: 0xff7fb5, band: 0xce1126, stockings: 0x5fd3a0, stovepipe: false };
// The storybook crew's walk is bouncier (walkPose): crew.ts sets this with the dress.
export const CREW_GAIT = { story: false };
// A long shoe whose toe curls up, under a shin (the knee's frame: the sole at -LEG_L).
function storyShoe(b: Batch, c: number) {
  b.box(0.06, -0.455, 0, 0.3, 0.08, 0.14, c);
  b.boxR(0.24, -0.43, 0, 0.12, 0.06, 0.12, c, 0, 0, 0.5);
  b.ico(0.28, -0.39, 0, 0.035, c);
}

export class Character {
  readonly root = new THREE.Group();
  private hips = new THREE.Group(); private torso = new THREE.Group(); private head = new THREE.Group();
  private shL = new THREE.Group(); private shR = new THREE.Group(); private elL = new THREE.Group(); private elR = new THREE.Group();
  private hipL = new THREE.Group(); private hipR = new THREE.Group(); private knL = new THREE.Group(); private knR = new THREE.Group();
  readonly handL = new THREE.Object3D(); readonly handR = new THREE.Object3D();
  private vest: THREE.Mesh;
  readonly headMeshes: THREE.Object3D[] = [];
  // Each part is built in every dress the character has (modern, period, storybook), and `dress`
  // shows one set.
  private dressed: [THREE.Mesh[], THREE.Mesh[], THREE.Mesh[]] = [[], [], []];
  private headOf = new Set<THREE.Object3D>();
  private shown = { dress: 0, head: true, vest: false };

  constructor(material: THREE.Material, look: Look, vest = false, pl: PeriodLook | null = null, sl: StoryLook | null = null) {
    // A part in the modern dress, and in the period and storybook dresses when there are those
    // (each its own builder, or the modern one).
    const part = (parent: THREE.Object3D, build: (b: Batch) => void, period: ((b: Batch, p: PeriodLook) => void) | null = null, story: ((b: Batch, s: StoryLook) => void) | null = null) => {
      const b = new Batch(); build(b);
      const m = b.build(material)!; parent.add(m); this.dressed[0].push(m);
      const extra = (i: 1 | 2, f: (c: Batch) => void) => { const c = new Batch(); f(c); const n = c.build(material)!; n.visible = false; parent.add(n); this.dressed[i].push(n); if (parent === this.head) this.headOf.add(n); };
      if (pl) extra(1, (c) => (period ?? build)(c, pl));
      if (sl) extra(2, (c) => (story ?? build)(c, sl));
      return m;
    };
    this.root.add(this.hips);
    this.hips.position.y = HIP_Y;
    // Pelvis and torso.
    part(this.hips, (b) => b.box(0, 0.02, 0, 0.22, 0.18, 0.34, look.trousers), (b, p) => {
      b.box(0, 0.02, 0, 0.22, 0.18, 0.34, p.trousers);
      if (p.jacket !== undefined) b.box(0, -0.02, 0, 0.27, 0.2, 0.43, p.jacket);   // the jacket's skirt, over the seat
    }, (b, s) => {
      b.box(0, 0.02, 0, 0.22, 0.18, 0.34, s.trousers);
      if (s.stovepipe) { b.box(0, 0.0, 0, 0.27, 0.16, 0.43, s.coat); b.boxR(-0.15, -0.26, 0, 0.04, 0.46, 0.3, s.coat, 0, 0, -0.12); }   // the coat's skirt, and its tails behind
      else b.box(0, 0.06, 0, 0.27, 0.1, 0.42, s.coat);                  // the jumper's hem
    });
    this.hips.add(this.torso);
    part(this.torso, (b) => {
      b.box(0, 0.3, 0, 0.24, 0.52, 0.4, look.jacket);
      b.box(0, 0.07, 0, 0.25, 0.06, 0.41, 0x2a2a2a);                  // belt
      b.box(0.121, 0.42, -0.1, 0.01, 0.06, 0.07, 0xce1126);            // chest patch, red and yellow
      b.box(0.121, 0.385, -0.1, 0.01, 0.02, 0.07, 0xf2c200);
      b.box(0.121, 0.3, 0, 0.01, 0.4, 0.02, 0x1b2a49);                 // zip
    }, (b, p) => {
      b.box(0, 0.3, 0, 0.24, 0.52, 0.4, p.shirt);
      if (p.jacket !== undefined) {
        // The jacket to the shoulders, open down the front on the shirt and the waistcoat.
        b.box(0, 0.3, 0, 0.26, 0.53, 0.42, p.jacket);
        b.box(0.131, 0.49, 0, 0.01, 0.1, 0.12, p.shirt);
        b.box(0.131, 0.28, 0, 0.01, 0.34, 0.16, p.waistcoat);
      } else b.box(0, 0.28, 0, 0.26, 0.4, 0.42, p.waistcoat);
      const wf = p.jacket !== undefined ? 0.137 : 0.132;               // the waistcoat's buttons and watch chain
      for (const y of [0.18, 0.28, 0.38]) b.box(wf, y, 0, 0.01, 0.025, 0.025, 0x1a1612);
      b.box(wf, 0.24, -0.05, 0.01, 0.015, 0.07, 0xc8a040);
      b.box(0.01, 0.565, 0, 0.17, 0.07, 0.19, p.neck);                 // the neckerchief, knotted at the front
      b.box(0.1, 0.52, 0, 0.05, 0.07, 0.06, p.neck);
      if (p.apron !== undefined) b.box(0.14, 0.12, 0, 0.02, 0.66, 0.34, p.apron);   // a leather apron
    }, (b, s) => {
      if (s.scarf) {
        // The coat, open on a cream front with two rows of gold buttons, and the striped scarf
        // round the neck, one end down the front and one flying out behind.
        b.box(0, 0.3, 0, 0.26, 0.53, 0.42, s.coat);
        b.box(0.131, 0.3, 0, 0.01, 0.44, 0.14, s.front);
        for (const y of [0.16, 0.27, 0.38]) for (const z of [-0.1, 0.1]) b.box(0.136, y, z, 0.012, 0.035, 0.035, 0xf2c200);
        b.box(0.01, 0.56, 0, 0.2, 0.08, 0.3, s.scarf[0]);
        for (let i = 0; i < 4; i++) b.box(0.14, 0.47 - i * 0.08, -0.12, 0.02, 0.08, 0.09, s.scarf[i % 2]);
        for (let i = 0; i < 4; i++) b.boxR(-0.15 - i * 0.07, 0.53 - i * 0.04, 0.1, 0.08, 0.035, 0.09, s.scarf[(i + 1) % 2], 0, 0, 0.5);
      } else {
        // A jumper in broad stripes, a roll collar.
        for (let i = 0; i < 5; i++) b.box(0, 0.1 + i * 0.105, 0, 0.25, 0.105, 0.41, i % 2 ? s.front : s.coat);
        b.box(0, 0.565, 0, 0.18, 0.06, 0.22, s.coat);
      }
    });
    {
      const b = new Batch();
      b.box(0, 0.33, 0, 0.26, 0.38, 0.42, look.vest);
      b.box(0, 0.24, 0, 0.265, 0.035, 0.425, 0xd8d8d8);                // reflective bands
      b.box(0, 0.4, 0, 0.265, 0.035, 0.425, 0xd8d8d8);
      this.vest = b.build(material)!; this.torso.add(this.vest);
    }
    this.vestOn = vest;
    // Head: a plain face (two eyes) under a cap or hard hat, or in period dress a bowler or flat
    // cap, or in storybook dress a stovepipe or a tasselled cap.
    this.torso.add(this.head);
    this.head.position.y = 0.56;
    const face = (b: Batch) => {
      b.box(0, 0.06, 0, 0.1, 0.08, 0.1, look.skin);                   // neck
      b.box(0, 0.17, 0, 0.22, 0.24, 0.21, look.skin);
      for (const z of [-0.05, 0.05]) b.box(0.111, 0.18, z, 0.01, 0.03, 0.03, 0x1a1a1a);
    };
    this.headMeshes.push(part(this.head, (b) => {
      face(b);
      if (look.hardHat) {
        b.box(0, 0.31, 0, 0.25, 0.08, 0.24, look.hat);
        b.box(0, 0.275, 0, 0.29, 0.02, 0.28, look.hat);
      } else {
        b.box(-0.005, 0.305, 0, 0.235, 0.07, 0.225, look.hat);
        b.box(0.15, 0.275, 0, 0.11, 0.02, 0.2, look.hat);              // brim
        b.box(0.114, 0.31, 0, 0.01, 0.04, 0.06, look.hatPatch);
      }
    }, (b, p) => {
      face(b);
      if (p.bowler) { b.box(0, 0.286, 0, 0.3, 0.02, 0.29, p.hat); b.box(-0.005, 0.347, 0, 0.23, 0.11, 0.22, p.hat); b.box(-0.005, 0.412, 0, 0.17, 0.04, 0.16, p.hat); }
      else { b.box(0.005, 0.316, 0, 0.25, 0.062, 0.24, p.hat); b.box(0.15, 0.289, 0, 0.11, 0.02, 0.21, p.hat); }
    }, (b, s) => {
      face(b);
      if (s.stovepipe) {
        // The brim, the band, then six striped tiers bending further back the higher they go.
        b.box(0, 0.29, 0, 0.36, 0.025, 0.34, s.hat);
        b.box(0, 0.33, 0, 0.215, 0.06, 0.205, s.band);
        for (let i = 0; i < 6; i++) b.boxR(-i * i * 0.011, 0.4 + i * 0.1, 0, 0.2, 0.105, 0.19, i % 2 ? s.hat2 : s.hat, 0, 0, 0.06 + i * 0.05);
      } else {
        // The cap, its brim, and a long tassel drooping back to a pompom.
        b.box(-0.005, 0.32, 0, 0.235, 0.1, 0.225, s.hat);
        b.box(-0.005, 0.28, 0, 0.245, 0.04, 0.235, s.band);
        b.boxR(-0.09, 0.47, 0, 0.05, 0.26, 0.05, s.hat, 0, 0, 0.55);
        b.ico(-0.18, 0.59, 0, 0.075, s.hat2);
      }
    }));
    // Arms: in period dress the hands are bare, and the jacket's sleeves reach the wrist or the
    // shirtsleeves are rolled to the elbow; in storybook dress the sleeves reach the wrist.
    for (const [sh, el, hand, z] of [[this.shL, this.elL, this.handL, -0.25], [this.shR, this.elR, this.handR, 0.25]] as const) {
      this.torso.add(sh); sh.position.set(0, 0.5, z);
      part(sh, (b) => b.box(0, -0.14, 0, 0.11, 0.3, 0.11, look.jacket), (b, p) => b.box(0, -0.14, 0, 0.115, 0.3, 0.115, p.jacket ?? p.shirt), (b, s) => b.box(0, -0.14, 0, 0.115, 0.3, 0.115, s.coat));
      sh.add(el); el.position.y = -0.29;
      part(el, (b) => { b.box(0, -0.13, 0, 0.1, 0.27, 0.1, look.jacket); b.box(0, -0.31, 0, 0.11, 0.1, 0.12, look.gloves); },
        (b, p) => {
          if (p.jacket !== undefined) b.box(0, -0.125, 0, 0.105, 0.27, 0.105, p.jacket);
          else { b.box(0, -0.04, 0, 0.115, 0.08, 0.115, p.shirt); b.box(0, -0.155, 0, 0.09, 0.2, 0.09, look.skin); }
          b.box(0, -0.31, 0, 0.1, 0.1, 0.11, look.skin);
        },
        (b, s) => { b.box(0, -0.125, 0, 0.105, 0.27, 0.105, s.coat); b.box(0, -0.245, 0, 0.12, 0.04, 0.12, s.front); b.box(0, -0.31, 0, 0.115, 0.11, 0.125, s.hands); });
      el.add(hand); hand.position.y = -0.32;
    }
    // Legs: in period dress, ankle boots; in storybook dress long shoes curling up at the toe (and
    // the mate's stockings below the knee).
    for (const [hp, kn, z] of [[this.hipL, this.knL, -0.1], [this.hipR, this.knR, 0.1]] as const) {
      this.hips.add(hp); hp.position.set(0, 0, z);
      part(hp, (b) => b.box(0, -0.21, 0, 0.15, 0.43, 0.15, look.trousers), (b, p) => b.box(0, -0.21, 0, 0.15, 0.43, 0.15, p.trousers), (b, s) => b.box(0, -0.21, 0, 0.15, 0.43, 0.15, s.trousers));
      hp.add(kn); kn.position.y = -0.43;
      part(kn, (b) => { b.box(0, -0.2, 0, 0.13, 0.4, 0.13, look.trousers); b.box(0.045, -0.455, 0, 0.25, 0.08, 0.14, look.boots); },
        (b, p) => { b.box(0, -0.2, 0, 0.13, 0.4, 0.13, p.trousers); b.box(0.045, -0.455, 0, 0.25, 0.08, 0.14, p.boots); b.box(0, -0.36, 0, 0.145, 0.12, 0.145, p.boots); },
        (b, s) => {
          if (s.stockings !== undefined) { b.box(0, -0.05, 0, 0.145, 0.1, 0.145, s.trousers); b.box(0, -0.25, 0, 0.12, 0.38, 0.12, s.stockings); }
          else b.box(0, -0.2, 0, 0.13, 0.4, 0.13, s.trousers);
          storyShoe(b, s.shoes);
        });
    }
  }

  // The dress: the period one or the storybook one (when the character has it), or the modern
  // one. Only what is drawn changes; the rig and its motion are the same in all.
  set period(v: boolean) { this.setDress(v ? 1 : this.shown.dress === 1 ? 0 : this.shown.dress); }
  get period() { return this.shown.dress === 1; }
  set story(v: boolean) { this.setDress(v ? 2 : this.shown.dress === 2 ? 0 : this.shown.dress); }
  get story() { return this.shown.dress === 2; }
  private setDress(i: number) {
    if (i === this.shown.dress || (i > 0 && !this.dressed[i].length)) return;
    this.shown.dress = i; this.show();
  }
  private show() {
    const { dress, head, vest } = this.shown;
    for (const [i, set] of this.dressed.entries()) for (const m of set) m.visible = i === dress && (head || !(this.headOf.has(m) || this.headMeshes.includes(m)));
    this.vest.visible = vest && dress === 0;   // (no hi-vis on a carter, nor in the storybook)
  }

  // ---- reaching (two-bone IK) -----------------------------------------------------------------
  // The arm (or leg) solved so the hand (or the boot's sole) is at a world point, as near as it
  // reaches, for the body as `p` poses it, the character already placed. The pose's own values
  // for that limb are blended towards the solution by `w` (0 leaves them, 1 reaches), so a hand can
  // go to something and let go of it smoothly. Writes the limb's angles into `p` and applies them.
  // The arm turns out from the body (roll) to bring the point into its plane, then the shoulder
  // and elbow are solved in that plane, the elbow bending forward; the leg likewise, the knee
  // bending back.
  private ikV = new THREE.Vector3(); private ikM = new THREE.Matrix4();
  reach(side: "L" | "R", target: THREE.Vector3, p: BodyPose, w = 1): number {
    if (w <= 0) return 0;
    const sh = side === "L" ? this.shL : this.shR, s = side === "L" ? 1 : -1;
    this.root.updateMatrixWorld(true);
    const v = this.ikV.copy(target).applyMatrix4(this.ikM.copy(this.torso.matrixWorld).invert()).sub(sh.position);
    const [roll, fwd, dn] = limbPlane(v.x, v.y, v.z, s, -1.0, 1.6);
    const [a1, a2, miss] = twoBone(fwd, dn, ARM_U, ARM_F, 1);
    const kP = side === "L" ? "shLP" : "shRP", kR = side === "L" ? "shLR" : "shRR", kE = side === "L" ? "elL" : "elR";
    p[kP] += (a1 - p[kP]) * w; p[kR] += (roll - p[kR]) * w; p[kE] += (a2 - p[kE]) * w;
    if (side === "L") { this.shL.rotation.set(p.shLR, 0, p.shLP, "XZY"); this.elL.rotation.z = p.elL; }
    else { this.shR.rotation.set(-p.shRR, 0, p.shRP, "XZY"); this.elR.rotation.z = p.elR; }
    return miss;
  }
  // The leg: the sole to a world point (feet on the steps of a cab, a kerb).
  step(side: "L" | "R", target: THREE.Vector3, p: BodyPose, w = 1): number {
    if (w <= 0) return 0;
    const hp = side === "L" ? this.hipL : this.hipR;
    this.root.updateMatrixWorld(true);
    const v = this.ikV.copy(target).applyMatrix4(this.ikM.copy(this.hips.matrixWorld).invert()).sub(hp.position);
    const [a1, a2, miss] = twoBone(v.x, -v.y, LEG_U, LEG_L, -1);
    const kH = side === "L" ? "hipL" : "hipR", kK = side === "L" ? "knL" : "knR";
    p[kH] += (a1 - p[kH]) * w; p[kK] += (a2 - p[kK]) * w;
    hp.rotation.z = p[kH]; (side === "L" ? this.knL : this.knR).rotation.z = p[kK];
    return miss;
  }

  // The sole of a leg (the point step() puts where it's asked), in the world, as posed.
  sole(side: "L" | "R", out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return out.set(0, -LEG_L, 0).applyMatrix4((side === "L" ? this.knL : this.knR).matrixWorld);
  }

  get headNode(): THREE.Object3D { return this.head; }
  set vestOn(v: boolean) { this.shown.vest = v; this.vest.visible = v && this.shown.dress === 0; }
  // The legs spread apart (radians, each thigh out to its own side) and the shins turned back
  // under (knee): astride a horse. apply() leaves both.
  setLegSpread(r: number, knee = 0) { this.hipL.rotation.x = r; this.hipR.rotation.x = -r; this.knL.rotation.x = -knee; this.knR.rotation.x = knee; }
  set headVisible(v: boolean) {
    if (v === this.shown.head) return;
    this.shown.head = v;
    if (this.dressed[1].length || this.dressed[2].length) this.show(); else for (const m of this.headMeshes) m.visible = v;
  }

  apply(p: BodyPose) {
    this.hips.position.y = HIP_Y - p.drop;
    this.torso.rotation.set(0, p.twist, p.bend);
    this.head.rotation.set(0, p.headY, p.headP);
    this.shL.rotation.set(p.shLR, 0, p.shLP, "XZY"); this.elL.rotation.z = p.elL;
    this.shR.rotation.set(-p.shRR, 0, p.shRP, "XZY"); this.elR.rotation.z = p.elR;
    this.hipL.rotation.set(p.sideL, 0, p.hipL); this.knL.rotation.z = p.knL;
    this.hipR.rotation.set(p.sideR, 0, p.hipR); this.knR.rotation.z = p.knR;
  }
}

// ---- poses ----------------------------------------------------------------------------------
// Walking: phase in cycles (one cycle = two steps), counting up walking forwards and down walking
// backwards. `arms` false leaves the arms to an upper-body pose (carrying, pushing). Each knee
// bends while its leg swings forward (the foot lifted to come through) and is straight while the
// leg swings back, the foot planted under the body as it passes over; run backwards, the foot is
// lifted as the leg reaches back, and planted as the body backs over it.
// The hips are lowest at contact, the legs spread widest (walkDrop). In the storybook city
// (CREW_GAIT) the walk is a springy one: a deep bob, the knees lifted high, the arms pumping with
// the elbows bent, the body dipping forward onto each step and the head nodding back after it.
export function walkPose(phase: number, out: BodyPose, arms = true, stride = 1): BodyPose {
  const s = Math.sin(phase * Math.PI * 2), c = Math.cos(phase * Math.PI * 2), sb = CREW_GAIT.story, s2 = s * s * stride;
  const knee = sb ? 1.1 : 0.7, swing = sb ? 0.65 : 0.4, elbow = sb ? 0.5 : 0.3;
  out.hipL = 0.45 * s * stride; out.hipR = -0.45 * s * stride;
  out.knL = -Math.max(0, c) * knee * stride - 0.05; out.knR = -Math.max(0, -c) * knee * stride - 0.05;
  out.drop = walkDrop(phase, stride);
  out.bend = sb ? -0.04 - 0.06 * s2 : -0.04;
  if (sb) out.headP = 0.08 * s2;
  if (arms) { out.shLP = -swing * s * stride; out.shRP = swing * s * stride; out.elL = elbow + 0.15 * Math.max(0, -s); out.elR = elbow + 0.15 * Math.max(0, s); }
  return out;
}
// How far walkPose lowers the hips at `phase`.
export function walkDrop(phase: number, stride = 1) {
  const s = Math.sin(phase * Math.PI * 2);
  return 0.02 + (CREW_GAIT.story ? 0.08 : 0.025) * s * s * stride;
}
// Stepping sideways, on top of walkPose run at the same phase: each foot swung out to the side
// and back by `e` (rad) as it swings fore and aft, so it is planted, moving neither way, through
// the same half of the cycle. `sgn`: +1 when the phase runs forwards as the body goes right (or
// backwards going left), -1 otherwise. Each foot keeps to its own side, the two never crossing:
// going right, the right foot steps out and the left closes up to it. `lift` (0..1): the knee
// lifting the swinging foot, which the fore-and-aft stride alone does too little of going across.
// Going sideways a cycle covers SIDE_STEP of ground, where walking it covers a stride.
export const SIDE_STEP = 0.5;
// And walking a cycle covers this much (m, two steps): walkPose's planted foot keeps still.
export const STRIDE = 1.6;
export function sideStepPose(phase: number, out: BodyPose, e: number, sgn: number, lift: number): BodyPose {
  if (e <= 0 && lift <= 0) return out;
  const s = Math.sin(phase * Math.PI * 2), c = Math.cos(phase * Math.PI * 2);
  // (Each foot's way out to the side, timed as walkPose's fore and aft but evenly, a straight
  // line each half, so the planted foot keeps still under the body as it goes over: out = +z.)
  const tri = Math.asin(Math.max(-1, Math.min(1, s))) * 2 / Math.PI;
  const outL = e * sgn * tri - e, outR = -e * sgn * tri + e;
  out.sideL = -outL; out.sideR = -outR;
  out.knL += -Math.max(0, c) * 0.55 * lift; out.knR += -Math.max(0, -c) * 0.55 * lift;
  out.hipL += Math.max(0, c) * 0.25 * lift; out.hipR += Math.max(0, -c) * 0.25 * lift;
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
