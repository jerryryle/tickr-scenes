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
import { SB, SB_BULB, SB_LENS, SB_PUFF, sbCurve, sbTube } from "./city-storybook/storybook-buildings-town.ts";
import type { SbP3 } from "./city-storybook/storybook-buildings-town.ts";

export interface RigState { odo: number; v: number; t: number; seed: number }
export interface StoryRig {
  id: string; len: number; width: number; vmax: number;
  parts: ((b: Batch) => void)[];   // part 0 is tinted with the vehicle's colour where white
  pose(s: RigState, out: THREE.Matrix4[]): void;
}

// (The rigs are made at first use, all in a closure: its names are its own, and storybook-buildings-town.ts's palette is
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
// lamp draws a round lamp lit after dark as a car's headlamp is (aux -3, cars.ts headLamp), so the light
// traffic.ts casts on the road ahead comes from something.
const lamp = (b: Batch, x: number, y: number, z: number, r: number) => { b.aux.set(0, 0, -3); b.ico(x, y, z, r, SB.lamp); b.aux.set(0, 0, -1); };
  const INK = SB.ink, GLASS = 0x9fdcff, SKIN = 0xd8a47f, SHINE = 0xfafafa, CHEEK = 0xff9ab8;

  // A blocky little rider has these parts: torso and head are one part, and each leg and arm is its own
  // (each is built hanging from its hip or shoulder at the origin).
  function riderBody(b: Batch, shirt: number, hat: number) {
    b.box(0, 0.32, 0, 0.26, 0.5, 0.36, shirt); b.ico(0, 0.72, 0, 0.15, SKIN); b.cyl(0, 0.84, 0, 0.17, 0.06, hat, 8); b.cyl(0, 0.92, 0, 0.11, 0.16, hat, 8);
    lamp(b, 0.12, 0.93, 0, 0.06);   // (a miner's lamp on the hat)
  }
  const leg = (col: number) => (b: Batch) => { b.box(0, -0.25, 0, 0.12, 0.5, 0.12, col); b.box(0.05, -0.5, 0, 0.2, 0.08, 0.13, INK); };
  const arm = (col: number) => (b: Batch) => { b.box(0, -0.2, 0, 0.09, 0.4, 0.09, col); b.ico(0, -0.42, 0, 0.06, SKIN); };
  // Pose a rider whose hips are at (x, y, z), running (`run` 0..1) at phase `ph` with legs swinging `swing` rad
  // either way at full run, leaning `lean`.
  function poseRider(out: THREE.Matrix4[], i: number, x: number, y: number, z: number, ph: number, run: number, lean = 0, swing = 0.75) {
    at(out[i], x, y, z, 0, 0, -lean);
    const sw = swing * run * Math.sin(ph);
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
      // The wheel rolls (its centre HW_R up); the runner keeps to the bottom, a little forward, scrambling
      // with feet on the rungs. A foot sweeps back 2 * 0.5 m * sin(0.9) in half a stride, so a stride of
      // 0.25 * 2 pi m of road keeps a planted foot going back with the rungs.
      at(out[0], 0, HW_R, 0, 0, 0, -s.odo / HW_R);
      const run = 0.25 + 0.75 * gait(s.v, 2), ph = s.odo / 0.25 + s.t * 2 * (1 - gait(s.v));
      poseRider(out, 1, 0.35 * run, 0.56 + 0.06 * run * Math.abs(Math.sin(ph)), 0, ph, run, 0.45 * run, 0.9);
    },
  };

  // ---- the strider ----------------------------------------------------------------------------------
  // The strider trots: each foot is planted for ST_DUTY of a stride of ST_STRIDE m and swings forward the rest,
  // and each leg reaches it by two-bone IK (thigh ST_L1, shin to the boot's sole ST_L2 + 0.04), knee forward.
  const ST_HIP = 1.35, ST_L1 = 0.78, ST_L2 = 0.82, ST_STRIDE = 1.6, ST_DUTY = 0.55;
  const ST_LEGS: [number, number, number][] = [[0.8, 0.62, 0], [0.8, -0.62, 0.5], [-0.8, 0.62, 0.5], [-0.8, -0.62, 0]];   // each leg is [x, z, phase], and the phases make a trot
  const strider: StoryRig = {
    id: "strider", len: 3.2, width: 2.2, vmax: 7,
    parts: [
      (b) => {   // this is a bubble body with its windscreen bulging out ahead, a little hat, a bumper, lamps and a curly horn
        b.lathe("bulb", SB_BULB, 0, -0.55, 0, 1.25, 1.5, 0xffffff, 12, 0.2);
        b.lathe("bulb", SB_BULB, 0.55, -0.15, 0, 0.8, 1.05, GLASS, 10, 1.1); glint(b, 1.22, 0.55, -0.3, 0.3);
        b.cyl(0, -0.5, 0, 1.18, 0.16, SB.cream, 12);
        b.cyl(0, -0.3, 0, 1.24, 0.1, SB.ink, 12);   // (a belt of ink round its middle, to give the bubble a waist)
        b.lathe("lens", SB_LENS, 0, 0.88, 0, 0.5, 0.22, SB.mustard, 8); b.ico(0, 1.15, 0, 0.12, SB.red);
        for (const z of [-0.5, 0.5]) { b.cyl(1.17, -0.25, z, 0.17, 0.1, SB.ink, 8, 0, Math.PI / 2); lamp(b, 1.22, -0.25, z, 0.13); }
        sbTube(b, sbCurve(6, (t): SbP3 => [-0.9 - Math.sin(t * Math.PI) * 0.35, 0.3 + t * 0.9, 0.55 + Math.sin(t * 2.5) * 0.15]), (i, t) => 0.05 + t * 0.06, () => SB.mustard, 6);
        b.cone(-0.9, 1.25, 0.6, 0.22, 0.2, SB.mustard, 8, Math.PI);   // (the horn's bell, open to the sky)
      },
      ...[0, 1, 2, 3].flatMap(() => [
        (b: Batch) => { b.ico(0, 0, 0, 0.2, SB.mustard); sbTube(b, [[0, 0, 0], [0, -ST_L1, 0]], () => 0.14, (i) => (i % 2 ? SB.pink : SB.white), 8); },
        (b: Batch) => { b.ico(0, 0, 0, 0.17, SB.mustard); sbTube(b, [[0, 0, 0], [0, -ST_L2 + 0.15, 0]], () => 0.12, () => SB.pink, 8); b.lathe("bulb", SB_BULB, 0.12, -ST_L2 - 0.04, 0, 0.3, 0.3, SB.red, 10); b.ico(0.32, -ST_L2 + 0.1, 0, 0.1, SHINE); },   // (The foot is a big round boot.)
      ]),
    ],
    pose(s, out) {
      // A planted foot goes back under the body as fast as the body goes forward, from +h to -h of the hip
      // (h = ST_DUTY * ST_STRIDE / 2); a swinging one goes forward and up in an arc. The body bobs twice a
      // stride. Slowing to a stand, the swing's lift dies away and the feet come down where they are.
      const g = gait(s.v), f0 = s.odo / ST_STRIDE, h = ST_DUTY * ST_STRIDE / 2, Ls = ST_L2 + 0.04;
      const bob = 0.06 * g * (0.5 - 0.5 * Math.cos(f0 * 2 * TAU)) + 0.03 * Math.sin(s.t * 2.1 + s.seed);
      at(out[0], 0, ST_HIP + 0.55 + bob, 0, 0.04 * g * Math.sin(f0 * TAU), 0, -0.04 * g);
      ST_LEGS.forEach(([x, z, p], k) => {
        const u = ((f0 + p) % 1 + 1) % 1, w = (u - ST_DUTY) / (1 - ST_DUTY);
        const fx = u < ST_DUTY ? h - 2 * h * u / ST_DUTY : -h + 2 * h * (w * w * (3 - 2 * w)), fy = u < ST_DUTY ? 0 : 0.3 * g * Math.sin(Math.PI * w);
        // (Two-bone IK in the leg's plane: the thigh turns past the hip-to-sole line by the triangle's angle at
        // the hip, which puts the knee forward, and the shin points from the knee to the sole.)
        const hy = ST_HIP + bob, dx = fx, dy = fy - hy, d = Math.min(Math.hypot(dx, dy), ST_L1 + Ls - 1e-3);
        const th = Math.atan2(dx, -dy) + Math.acos(Math.max(-1, Math.min(1, (ST_L1 * ST_L1 + d * d - Ls * Ls) / (2 * ST_L1 * d))));
        const kx = ST_L1 * Math.sin(th), ky = -ST_L1 * Math.cos(th), sh = Math.atan2(dx - kx, -(dy - ky));
        at(out[1 + 2 * k], x * 0.75, hy, z * 0.75, 0, 0, th);
        m5.copy(out[1 + 2 * k]); at(m4, 0, -ST_L1, 0, 0, 0, sh - th); out[2 + 2 * k].multiplyMatrices(m5, m4);
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
        lamp(b, 0.9, 0.72, 0, 0.12);   // (a lamp on its forehead, between the feelers)
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
      // Each carriage humps up in turn, the hump running forward from the tail to the head as a real
      // caterpillar's does, and surges forward as it lifts.
      const g = gait(s.v, 2);
      for (let i = 0; i < CT_N; i++) {
        const ph = s.odo / 2.2 * TAU + i * 1.0, hump = 0.45 * g * Math.max(0, Math.sin(ph)) + 0.03 * Math.sin(s.t * 1.7 - i);
        const x = 8.6 / 2 - 1.0 - i * CT_GAP - (i ? 0.25 : 0) + 0.3 * g * Math.cos(ph);
        at(out[i], x, (i ? CT_R : 1.0) + 0.2 + hump, 0, 0, 0, 0.25 * g * Math.cos(ph) * (i ? 1 : 0.4));
      }
    },
  };

  // ---- the pogo hopper ----------------------------------------------------------------------------
  const PG_SPRING = 1.1, PG_STANCE = 0.22;
  const pogo: StoryRig = {
    id: "pogo", len: 2.2, width: 1.7, vmax: 7,
    parts: [
      (b) => {   // this draws the bubble and its seat
        b.lathe("bulb", SB_BULB, 0, 0, 0, 0.95, 1.6, 0xffffff, 12, 0.5);
        b.lathe("bulb", SB_BULB, 0.38, 0.35, 0, 0.62, 0.95, GLASS, 10, 1.0); glint(b, 0.95, 0.95, -0.2, 0.22);
        b.cyl(0, 0.05, 0, 0.9, 0.12, SB.cream, 12);
        b.cone(0, 1.62, 0, 0.12, 0.4, SB.red, 6);
        lamp(b, 0.93, 0.15, 0, 0.1);
      },
      (b) => sbTube(b, sbCurve(40, (t): SbP3 => [Math.cos(t * 7 * TAU) * 0.34, -t * PG_SPRING, Math.sin(t * 7 * TAU) * 0.34]), () => 0.05, () => SB.mustard, 5),   // the spring hangs from the origin
      (b) => { b.lathe("lens", SB_LENS, 0, -0.14, 0, 0.5, 0.18, SB.red, 10); },   // this is its foot
    ],
    pose(s, out) {
      // It hops 2.6 m at a time. For the first PG_STANCE of a hop the foot is planted: it goes back under
      // the bubble as the bubble goes on, the spring leans over it from back to front and squashes, and the
      // bubble dips. Then it flies, the foot swinging forward under it to land ahead. Standing, it bounces a
      // little on the spot.
      const g = gait(s.v, 3), p = ((s.odo / 2.6) % 1 + 1) % 1, reach = 0.29 * g;
      let fx: number, fy: number, squash: number;
      if (p < PG_STANCE) { const u = p / PG_STANCE; fx = reach * (1 - 2 * u); fy = 0; squash = 1 - 0.35 * g * Math.sin(Math.PI * u); }
      else { const u = (p - PG_STANCE) / (1 - PG_STANCE); fx = -reach * Math.cos(Math.PI * u); fy = 1.3 * g * 4 * u * (1 - u); squash = 1; }
      squash -= 0.08 * (1 - g) * (0.5 + 0.5 * Math.sin(s.t * 5 + s.seed));
      // (The spring runs from the foot to under the bubble's middle, so its lean is set by how far ahead or
      // behind the foot is, and the bubble's height by its squashed length.)
      const sp = PG_SPRING * squash, top = fy + 0.14 + Math.sqrt(Math.max(0.01, sp * sp - fx * fx)), lean = Math.atan2(fx, top - fy - 0.14);
      at(out[2], fx, fy + 0.14, 0);
      at(out[1], 0, top, 0, 0, 0, lean, 1, squash, 1);
      at(out[0], 0, top + 0.05, 0, 0, 0, -0.4 * lean);
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
        lamp(b, 0.86, 1.25, 0, 0.1);
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
        b.cyl(0, 1.75, 0, 0.22, 0.3, INK, 8); lamp(b, 0, 2.0, 0, 0.18);   // (the burner, aflame)
        lamp(b, 0.98, 0.7, 0, 0.1);
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
  // CUP_IN is the cup's inside wall, from the rim down to below the tea. It runs downward, so its faces
  // point in toward the middle: the outside wall is one-sided, and from above its far side shows only
  // these.
  const CUP_IN: readonly (readonly [number, number])[] = [[0.96, 1], [0.93, 1], [0.91, 0.9], [0.87, 0.72]];
  const teacup: StoryRig = {
    id: "teacup", len: 2.8, width: 2.8, vmax: 6,
    parts: [
      (b) => {   // the saucer glides on hidden wheels
        b.lathe("lens", SB_LENS, 0, 0.1, 0, 1.4, 0.35, 0xffffff, 16);
        b.cyl(0, 0.36, 0, 1.0, 0.05, SB.pink, 16);
        sbTube(b, [[1.2, 0.3, 0], [1.38, 0.55, 0]], () => 0.03, () => INK, 4); lamp(b, 1.4, 0.62, 0, 0.09);   // (a lamp on a stalk at the saucer's rim)
      },
      (b) => {   // this draws the cup, its handle, a band of dots and two riders' heads over its rim
        b.lathe("cup", CUP, 0, 0, 0, 1.15, 1.25, SB.cream, 16);
        b.lathe("cupin", CUP_IN, 0, 0, 0, 1.15, 1.25, SB.cream, 16);
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
        for (const z of [-0.2, 0.2]) lamp(b, 1.12, 1.78, z * 1.4, 0.07);   // (little lamps atop its eyes)
      },
      ...Array.from({ length: SN_N }, () => (b: Batch) => b.lathe("lens", SB_LENS, 0, 0, 0, 0.62, 0.42, SB.mint, 10, 0, 0, 0)),   // the foot is in pads that ripple
    ],
    pose(s, out) {
      const g = gait(s.v, 1.5), ph = s.odo / 1.2 * TAU;
      at(out[0], -0.35, 1.55 + 0.05 * g * Math.sin(ph), 0, 0, 0, -0.5 + 0.04 * g * Math.sin(ph + 1));   // (The shell is turned a little, its opening down onto the body.)
      at(out[1], 1.1, 0.05 + 0.04 * g * Math.sin(ph + 2), 0, 0, 0, 0.05 * Math.sin(s.t * 1.2 + s.seed));
      for (let i = 0; i < SN_N; i++) {
        const w = Math.sin(ph + i * 1.2);   // (the pads' wave runs from tail to head, as a land snail's does)
        at(out[2 + i], 1.4 - i * 0.75, 0, 0, 0, 0, 0, 1 + 0.18 * g * w, 1 + 0.5 * g * Math.max(0, w), 1.2);
      }
    },
  };

  return [hamster, strider, caterpillar, pogo, unicycle, balloon, teacup, snail];
}
export function storyRigColors() { return [SB.pink, SB.aqua, SB.mustard, SB.violet, SB.mint, SB.orange, SB.coral, SB.lime]; }
