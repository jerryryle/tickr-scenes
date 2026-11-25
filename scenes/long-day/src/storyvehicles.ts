// These are the storybook city's own vehicles, surreal contraptions that get about in strange ways. Each is
// a rig: rigid parts (each built once, x forward, y up, the rig's origin on the ground at its
// middle) and a pose for them from how far it has come (odo, m), how fast it goes (v, m/s), the
// time (t, s) and a number of its own (seed), so traffic can draw a part of every one of a kind
// as one instanced mesh. What moves is worked out from those alone, so scrubbing replays it.
//   hamster:  a giant hamster wheel is rolled along by its runner, who pounds the rungs inside.
//   strider:  a bubble car trots on four long jointed legs.
//   caterpillar: the bus is a string of round carriages that hump along one after another on little feet.
//   pogo:     a bubble on a great spring hops down the street.
//   unicycle: a stack of round cabins teeters on one tall wheel.
//   balloon:  a striped balloon tows its basket along a few feet off the road, with a propeller astern.
//   teacup:   a teacup on a saucer turns round and round as it goes.
//   snail:    a striped spiral shell sits on a soft body whose foot ripples.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { SB, SB_BULB, SB_LENS, SB_PUFF, sbCurve, sbTube } from "./storybook.ts";
import type { SbP3 } from "./storybook.ts";

export interface RigState { odo: number; v: number; t: number; seed: number }
export interface StoryRig {
  id: string; len: number; width: number; vmax: number;
  parts: ((b: Batch) => void)[];   // part 0 is tinted with the vehicle's colour where white
  pose(s: RigState, out: THREE.Matrix4[]): void;
}

// (The rigs are made at first use, all in a closure: its names are its own, and storybook.ts's palette is
// there by then whatever order the modules load in.)
let rigsMade: StoryRig[] | null = null;
export function storyRigs(): StoryRig[] { return rigsMade ??= makeRigs(); }
function makeRigs(): StoryRig[] {
  const TAU = Math.PI * 2;
  const m4 = new THREE.Matrix4(), m5 = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler(), vv = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const at = (out: THREE.Matrix4, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
    out.compose(vv.set(x, y, z), qq.setFromEuler(ee.set(rx, ry, rz)), one.set(sx, sy, sz));
  const gait = (v: number, full = 2.5) => Math.min(1, v / full);   // this is how much of its stride it puts into it, by speed
// eye draws a friendly cartoon eye looking ahead (+x) from (x, y, z): it is white, with a big dark pupil and a glint.
const eye = (b: Batch, x: number, y: number, z: number, r: number) => {
  b.ico(x, y, z, r, SHINE, 1.15); b.ico(x + r * 0.55, y - r * 0.05, z, r * 0.55, INK, 1.15); b.ico(x + r * 0.95, y + r * 0.22, z + r * 0.15, r * 0.16, SHINE);
};
// glint draws a glint on glass as a little white dash.
const glint = (b: Batch, x: number, y: number, z: number, s: number) => b.boxR(x, y, z, 0.04, s, s * 0.35, SHINE, 0.6, 0, 0);
  const INK = SB.ink, GLASS = 0x9fdcff, SKIN = 0xd8a47f, SHINE = 0xfafafa, CHEEK = 0xff9ab8;

  // A blocky little rider has these parts: torso and head are one part, and each leg and arm is its own
  // (each is built hanging from its hip or shoulder at the origin).
  function riderBody(b: Batch, shirt: number, hat: number) {
    b.box(0, 0.32, 0, 0.26, 0.5, 0.36, shirt); b.ico(0, 0.72, 0, 0.15, SKIN); b.cyl(0, 0.84, 0, 0.17, 0.06, hat, 8); b.cyl(0, 0.92, 0, 0.11, 0.16, hat, 8);
  }
  const leg = (col: number) => (b: Batch) => { b.box(0, -0.25, 0, 0.12, 0.5, 0.12, col); b.box(0.05, -0.5, 0, 0.2, 0.08, 0.13, INK); };
  const arm = (col: number) => (b: Batch) => { b.box(0, -0.2, 0, 0.09, 0.4, 0.09, col); b.ico(0, -0.42, 0, 0.06, SKIN); };
  // Pose a rider whose hips are at (x, y, z), running (`run` 0..1) at phase `ph`, leaning `lean`.
  function poseRider(out: THREE.Matrix4[], i: number, x: number, y: number, z: number, ph: number, run: number, lean = 0) {
    at(out[i], x, y, z, 0, 0, -lean);
    const sw = 0.75 * run * Math.sin(ph);
    for (const [k, s] of [[1, 1], [2, -1]] as const) at(out[i + k], x, y + 0.04, z + s * 0.08, 0, 0, sw * s);
    for (const [k, s] of [[3, -1], [4, 1]] as const) { m5.copy(out[i]); at(m4, 0, 0.55, s * 0.22, 0, 0, sw * s * 0.9 - 0.3 * run); out[i + k].multiplyMatrices(m5, m4); }
  }

  // ---- the hamster wheel ----------------------------------------------------------------------------
  const HW_R = 1.45, HW_W = 0.75;
  const hamster: StoryRig = {
    id: "hamster", len: 3.0, width: 1.8, vmax: 7,
    parts: [
      // The wheel has two rims, rungs between and spokes to a hub, and all of it turns.
      (b) => {
        for (const z of [-HW_W, HW_W]) {
          sbTube(b, sbCurve(24, (t): SbP3 => [Math.cos(t * TAU) * HW_R, Math.sin(t * TAU) * HW_R, z]), () => 0.09, (i) => (i % 2 ? SB.white : SB.red), 6, 0, true);
          for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; sbTube(b, [[0, 0, z], [Math.cos(a) * HW_R, Math.sin(a) * HW_R, z]], () => 0.035, () => SB.mustard, 4); }
          b.cyl(0, 0, z, 0.16, 0.12, SB.mustard, 8, Math.PI / 2);
        }
        for (let k = 0; k < 20; k++) { const a = k / 20 * TAU; b.cyl(Math.cos(a) * (HW_R - 0.02), Math.sin(a) * (HW_R - 0.02), 0, 0.04, 2 * HW_W, SB.cream, 5, Math.PI / 2); }
      },
      (b) => riderBody(b, 0xffffff, SB.teal), leg(SB.navy), leg(SB.navy), arm(0xffffff), arm(0xffffff),
    ],
    pose(s, out) {
      // The wheel rolls (its centre HW_R up); the runner keeps to the bottom, a little forward,
      // running as fast as it goes.
      at(out[0], 0, HW_R, 0, 0, 0, -s.odo / HW_R);
      const run = 0.25 + 0.75 * gait(s.v, 2);
      poseRider(out, 1, 0.35 * run, 0.72, 0, s.odo / 0.55 + s.t * 2 * (1 - gait(s.v)), run, 0.35 * run);
    },
  };

  // ---- the strider ----------------------------------------------------------------------------------
  const ST_HIP = 1.45, ST_L1 = 0.78, ST_L2 = 0.82;
  const ST_LEGS: [number, number, number][] = [[0.8, 0.62, 0], [0.8, -0.62, 0.5], [-0.8, 0.62, 0.5], [-0.8, -0.62, 0]];   // each leg is [x, z, phase], and the phases make a trot
  const strider: StoryRig = {
    id: "strider", len: 3.2, width: 2.2, vmax: 7,
    parts: [
      (b) => {   // this is a bubble body with its windscreen bulging out ahead and a little hat
        b.lathe("bulb", SB_BULB, 0, -0.55, 0, 1.25, 1.5, 0xffffff, 12, 0.2);
        b.lathe("bulb", SB_BULB, 0.55, -0.15, 0, 0.8, 1.05, GLASS, 10, 1.1); glint(b, 1.22, 0.55, -0.3, 0.3);
        b.cyl(0, -0.5, 0, 1.18, 0.16, SB.cream, 12);
        b.lathe("lens", SB_LENS, 0, 0.88, 0, 0.5, 0.22, SB.mustard, 8); b.ico(0, 1.15, 0, 0.12, SB.red);
        for (const z of [-0.5, 0.5]) b.cyl(1.2, -0.25, z, 0.13, 0.08, SB.lamp, 8, 0, Math.PI / 2);
      },
      ...[0, 1, 2, 3].flatMap(() => [
        (b: Batch) => { b.ico(0, 0, 0, 0.2, SB.mustard); sbTube(b, [[0, 0, 0], [0, -ST_L1, 0]], () => 0.14, (i) => (i % 2 ? SB.pink : SB.white), 8); },
        (b: Batch) => { b.ico(0, 0, 0, 0.17, SB.mustard); sbTube(b, [[0, 0, 0], [0, -ST_L2 + 0.15, 0]], () => 0.12, () => SB.pink, 8); b.lathe("bulb", SB_BULB, 0.12, -ST_L2 - 0.04, 0, 0.3, 0.3, SB.red, 10); b.ico(0.32, -ST_L2 + 0.1, 0, 0.1, SHINE); },   // (The foot is a big round boot.)
      ]),
    ],
    pose(s, out) {
      const g = gait(s.v), ph0 = s.odo / 1.6 * TAU;
      const bob = 0.1 * g * Math.abs(Math.sin(ph0)) + 0.04 * Math.sin(s.t * 2.1 + s.seed);
      at(out[0], 0, ST_HIP + 0.55 + bob, 0, 0.05 * g * Math.sin(ph0), 0, -0.04 * g);
      ST_LEGS.forEach(([x, z, p], k) => {
        // (The knees point forward, like a toddler's: it is a bouncy little trot.)
        const ph = ph0 + p * TAU, th = 0.45 * g * Math.sin(ph) - 0.25, knee = 0.8 * g * Math.max(0, Math.cos(ph)) + 0.45, splay = Math.sign(z) * 0.12;
        at(out[1 + 2 * k], x * 0.75, ST_HIP + bob, z * 0.75, splay, 0, th);
        m5.copy(out[1 + 2 * k]); at(m4, 0, -ST_L1, 0, -splay * 1.5, 0, knee * 0.9 - th * 0.4); out[2 + 2 * k].multiplyMatrices(m5, m4);
      });
    },
  };

  // ---- the caterpillar bus -------------------------------------------------------------------------
  const CT_N = 6, CT_GAP = 1.3, CT_R = 1.05;
  const caterpillar: StoryRig = {
    id: "caterpillar", len: 8.6, width: 2.3, vmax: 6,
    parts: [
      (b) => {   // the head is a round face with big eyes, a smile and two curly feelers
        b.lathe("bulb", SB_BULB, 0, -1.0, 0, 1.0, 2.0, SB.lime, 12, 0.3);
        for (const z of [-0.36, 0.36]) { eye(b, 0.72, 0.28, z, 0.26); b.ico(0.86, -0.12, z * 1.6, 0.13, CHEEK, 0.6); }
        sbTube(b, sbCurve(6, (t): SbP3 => [0.97 - Math.sin(t * Math.PI) * 0.04, -0.3 - Math.sin(t * Math.PI) * 0.16, (t - 0.5) * 0.6]), () => 0.045, () => SB.red, 4, 0, true);   // this draws a smile
        for (const z of [-1, 1]) { sbTube(b, sbCurve(6, (t): SbP3 => [0.2 + t * 0.35, 0.9 + t * 0.75, z * (0.3 + t * 0.3)]), () => 0.05, () => SB.plum, 4, 0, true); b.ico(0.55, 1.68, z * 0.6, 0.14, SB.pink); }
        for (const z of [-0.6, 0.6]) b.ico(0.1, -1.0, z, 0.22, SB.red, 0.7);
      },
      ...Array.from({ length: CT_N - 1 }, (_, i) => (b: Batch) => {   // the carriages are striped round bodies with a round window each side and two little feet
        const col = [SB.violet, SB.mustard, SB.teal, SB.pink, SB.orange][i % 5];
        b.lathe("bulb", SB_BULB, 0, -CT_R, 0, CT_R, 2 * CT_R, col, 12, i * 0.4);
        b.cyl(0, -0.3, 0, CT_R - 0.02, 0.24, SB.cream, 14);   // (This is a belly stripe.)
        for (const z of [-1, 1]) { b.cyl(0, 0.35, z * (CT_R - 0.14), 0.36, 0.1, SB.cream, 10, Math.PI / 2); b.cyl(0, 0.35, z * (CT_R - 0.1), 0.28, 0.1, GLASS, 10, Math.PI / 2); }
        for (const z of [-0.55, 0.55]) b.ico(0, -CT_R, z, 0.22, SB.red, 0.7);
      }),
    ],
    pose(s, out) {
      // Each carriage humps up in turn, the hump running back along it as it goes.
      const g = gait(s.v, 2);
      for (let i = 0; i < CT_N; i++) {
        const ph = s.odo / 2.2 * TAU - i * 1.0, hump = 0.45 * g * Math.max(0, Math.sin(ph)) + 0.03 * Math.sin(s.t * 1.7 - i);
        const x = 8.6 / 2 - 1.0 - i * CT_GAP - (i ? 0.25 : 0);
        at(out[i], x, (i ? CT_R : 1.0) + 0.2 + hump, 0, 0, 0, 0.25 * g * Math.cos(ph) * (i ? 1 : 0.4));
      }
    },
  };

  // ---- the pogo hopper ----------------------------------------------------------------------------
  const PG_SPRING = 1.1;
  const pogo: StoryRig = {
    id: "pogo", len: 2.2, width: 1.7, vmax: 7,
    parts: [
      (b) => {   // this draws the bubble and its seat
        b.lathe("bulb", SB_BULB, 0, 0, 0, 0.95, 1.6, 0xffffff, 12, 0.5);
        b.lathe("bulb", SB_BULB, 0.38, 0.35, 0, 0.62, 0.95, GLASS, 10, 1.0); glint(b, 0.95, 0.95, -0.2, 0.22);
        b.cyl(0, 0.05, 0, 0.9, 0.12, SB.cream, 12);
        b.cone(0, 1.62, 0, 0.12, 0.4, SB.red, 6);
      },
      (b) => sbTube(b, sbCurve(40, (t): SbP3 => [Math.cos(t * 7 * TAU) * 0.34, -t * PG_SPRING, Math.sin(t * 7 * TAU) * 0.34]), () => 0.05, () => SB.mustard, 5),   // the spring hangs from the origin
      (b) => { b.lathe("lens", SB_LENS, 0, -0.14, 0, 0.5, 0.18, SB.red, 10); },   // this is its foot
    ],
    pose(s, out) {
      // It hops 2.6 m at a time, up and down as it goes, and the spring squashes as it lands and pushes off;
      // standing, it bounces a little on the spot.
      const g = gait(s.v, 3), p = (s.odo / 2.6) % 1, air = 4 * p * (1 - p);
      const land = 1 - Math.max(0, 1 - Math.min(p, 1 - p) / 0.14);   // land is 0 at touch-down
      const squash = 1 - 0.35 * g * (1 - land) - 0.08 * (1 - g) * (0.5 + 0.5 * Math.sin(s.t * 5 + s.seed));
      const y = 1.3 * g * air, sp = PG_SPRING * squash;
      at(out[2], 0, y + 0.14, 0);
      at(out[1], 0, y + 0.14 + sp, 0, 0, 0, 0, 1, squash, 1);
      at(out[0], 0, y + 0.14 + sp + 0.05, 0, 0, 0, -0.12 * g * (p - 0.5));
    },
  };

  // ---- the unicycle tower ---------------------------------------------------------------------------
  const UC_R = 1.0;
  const unicycle: StoryRig = {
    id: "unicycle", len: 2.1, width: 1.4, vmax: 6,
    parts: [
      (b) => {   // the wheel has a fat tyre and a striped hub
        b.cyl(0, 0, 0, UC_R, 0.38, SB.plum, 16, Math.PI / 2);
        b.cyl(0, 0, 0, UC_R * 0.72, 0.4, SB.pink, 14, Math.PI / 2);
        for (let k = 0; k < 4; k++) b.box(0, 0, 0, UC_R * 1.4, 0.1, 0.42, SB.cream, k * Math.PI / 4);
        b.cyl(0, 0, 0, 0.18, 0.5, SB.mustard, 8, Math.PI / 2);
      },
      (b) => {   // the stack runs from the axle up: a fork, a pole, three round cabins and a flag
        for (const z of [-0.28, 0.28]) b.box(0, 0.6, z, 0.12, 1.2, 0.08, SB.plum);
        sbTube(b, [[0, 1.1, 0], [0, 4.9, 0]], () => 0.08, () => SB.plum, 6);
        [[1.35, 0.85, SB.teal], [2.55, 0.72, SB.orange], [3.6, 0.58, SB.violet]].forEach(([y, r, c], i) => {
          b.lathe("bulb", SB_BULB, 0, y, 0, r, r * 1.5, c, 12, i);
          b.cyl(r * 0.55, y + r * 0.8, 0, r * 0.42, 0.06, GLASS, 8, 0, Math.PI / 2);
          b.cyl(0, y + 0.08, 0, r * 0.98, 0.1, SB.cream, 12);
        });
        b.box(0.3, 4.75, 0, 0.6, 0.32, 0.03, SB.red);
      },
    ],
    pose(s, out) {
      // The wheel turns; the stack teeters over its axle, leaning into the going and swaying.
      at(out[0], 0, UC_R, 0, 0, 0, -s.odo / UC_R);
      const g = gait(s.v), sway = 0.07 * Math.sin(s.t * 1.6 + s.seed) + 0.05 * Math.sin(s.t * 2.7 + 2 * s.seed);
      at(out[1], 0, UC_R, 0, 0.05 * Math.sin(s.t * 1.3 + s.seed), 0, -0.1 * g + sway);
    },
  };

  // ---- the balloon ----------------------------------------------------------------------------------
  const balloon: StoryRig = {
    id: "balloon", len: 3.0, width: 2.4, vmax: 6,
    parts: [
      (b) => {   // this draws the basket (it is at the origin, its bottom 1.2 m up) and the balloon over it
        b.box(0, 0.45, 0, 1.9, 0.9, 1.4, SB.mustard); b.box(0, 0.92, 0, 2.0, 0.1, 1.5, SB.orange);
        for (let i = 0; i < 4; i++) b.box(-0.7 + i * 0.47, 0.45, 0, 0.08, 0.92, 1.42, SB.orange);
        for (const x of [-0.85, 0.85]) for (const z of [-0.6, 0.6]) sbTube(b, [[x, 0.9, z], [x * 0.9, 2.5, z * 0.9]], () => 0.025, () => INK, 4);
        b.lathe("puff", SB_PUFF, 0, 2.4, 0, 1.55, 3.2, SB.pink, 14, 0.3);
        b.cyl(0, 3.55, 0, 1.6, 0.32, SB.white, 14); b.cyl(0, 4.35, 0, 1.47, 0.3, SB.white, 14);   // (These are bands round it, a little proud.)
        b.ico(0, 5.62, 0, 0.16, SB.mustard);
        b.box(-1.05, 0.45, 0, 0.2, 0.5, 0.2, INK);
      },
      (b) => { b.box(0, 0, 0, 0.06, 0.9, 0.16, SB.red); b.box(0.01, 0, 0, 0.06, 0.16, 0.9, SB.red); b.ico(0.04, 0, 0, 0.1, SB.mustard); },   // this is the propeller
    ],
    pose(s, out) {
      const bob = 1.2 + 0.25 * Math.sin(s.t * 1.1 + s.seed) + 0.1 * Math.sin(s.t * 2.3 + 2 * s.seed);
      at(out[0], 0, bob, 0, 0.06 * Math.sin(s.t * 0.9 + s.seed), 0, -0.08 * gait(s.v) + 0.04 * Math.sin(s.t * 1.4));
      m5.copy(out[0]); at(m4, -1.2, 0.45, 0, s.t * (3 + 12 * gait(s.v)), 0, 0); out[1].multiplyMatrices(m5, m4);
    },
  };

  // ---- the teacup ---------------------------------------------------------------------------------
  const CUP: readonly (readonly [number, number])[] = [[0, 0], [0.55, 0.02], [0.72, 0.12], [0.9, 0.45], [1, 0.9], [0.96, 1]];
  const teacup: StoryRig = {
    id: "teacup", len: 2.8, width: 2.8, vmax: 6,
    parts: [
      (b) => {   // the saucer glides on hidden wheels
        b.lathe("lens", SB_LENS, 0, 0.1, 0, 1.4, 0.35, 0xffffff, 16);
        b.cyl(0, 0.36, 0, 1.0, 0.05, SB.pink, 16);
      },
      (b) => {   // this draws the cup, its handle, a band of dots and two riders' heads over its rim
        b.lathe("cup", CUP, 0, 0, 0, 1.15, 1.25, SB.cream, 16);
        b.cyl(0, 0.85, 0, 1.08, 0.18, SB.violet, 16);
        for (let k = 0; k < 10; k++) { const a = k / 10 * TAU; b.ico(Math.cos(a) * 1.07, 0.55, Math.sin(a) * 1.07, 0.09, SB.pink); }
        sbTube(b, sbCurve(8, (t): SbP3 => [1.05 + Math.sin(t * Math.PI) * 0.45, 1.0 - t * 0.6, 0]), () => 0.08, () => SB.cream, 6, 0, true);
        for (const z of [-0.4, 0.4]) { b.ico(0, 1.35, z, 0.2, SKIN); b.cyl(0, 1.52, z, 0.22, 0.08, z < 0 ? SB.teal : SB.red, 8); }
      },
    ],
    pose(s, out) {
      at(out[0], 0, 0, 0);
      at(out[1], 0, 0.38, 0, 0, s.t * 0.9 + s.odo * 0.15 + s.seed, 0);
    },
  };

  // ---- the snail ----------------------------------------------------------------------------------
  const SN_N = 5;
  const snail: StoryRig = {
    id: "snail", len: 4.2, width: 1.8, vmax: 4,
    parts: [
      (b) => {   // the shell is a striped spiral coiled on its side, with a door in it
        sbTube(b, sbCurve(48, (t): SbP3 => { const a = t * 2.6 * TAU, r = 1.25 * (1 - t * 0.85); return [Math.cos(a) * r, Math.sin(a) * r, (0.5 - t) * 0.5]; }),
          (i, t) => 0.62 * (1 - t * 0.8), (i) => (Math.floor(i / 3) % 2 ? SB.orange : SB.butter), 10);
        b.lathe("lens", SB_LENS, 0, -0.1, 0.62, 0.38, 0.2, SB.plum, 10, 0, Math.PI / 2);
      },
      (b) => {   // the head end has a neck, eye stalks and a smile
        sbTube(b, sbCurve(5, (t): SbP3 => [t * 0.9, 0.3 + t * 0.55, 0]), (i, t) => 0.42 - t * 0.1, () => SB.mint, 10, 0, true);
        for (const z of [-0.2, 0.2]) { sbTube(b, [[0.9, 0.85, z * 0.5], [1.0, 1.4, z * 1.4]], () => 0.07, () => SB.mint, 6); eye(b, 1.0, 1.55, z * 1.4, 0.2); }
    sbTube(b, sbCurve(5, (t): SbP3 => [1.18 + Math.sin(t * Math.PI) * 0.02, 0.62 - Math.sin(t * Math.PI) * 0.1, (t - 0.5) * 0.4]), () => 0.035, () => SB.red, 4, 0, true);
    for (const z of [-0.28, 0.28]) b.ico(1.12, 0.72, z, 0.08, CHEEK, 0.6);
      },
      ...Array.from({ length: SN_N }, () => (b: Batch) => b.lathe("lens", SB_LENS, 0, 0, 0, 0.62, 0.42, SB.mint, 10, 0, 0, 0)),   // the foot is in pads that ripple
    ],
    pose(s, out) {
      const g = gait(s.v, 1.5), ph = s.odo / 1.2 * TAU;
      at(out[0], -0.35, 1.55 + 0.05 * g * Math.sin(ph), 0, 0, 0, -0.5 + 0.04 * g * Math.sin(ph + 1));   // (The shell is turned a little, its opening down onto the body.)
      at(out[1], 1.1, 0.05 + 0.04 * g * Math.sin(ph + 2), 0, 0, 0, 0.05 * Math.sin(s.t * 1.2 + s.seed));
      for (let i = 0; i < SN_N; i++) {
        const w = Math.sin(ph - i * 1.2);
        at(out[2 + i], 1.4 - i * 0.75, 0, 0, 0, 0, 0, 1 + 0.18 * g * w, 1 + 0.5 * g * Math.max(0, w), 1.2);
      }
    },
  };

  return [hamster, strider, caterpillar, pogo, unicycle, balloon, teacup, snail];
}
export function storyRigColors() { return [SB.pink, SB.aqua, SB.mustard, SB.violet, SB.mint, SB.orange, SB.coral, SB.lime]; }
