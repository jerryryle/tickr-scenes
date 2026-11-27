// The Victorian city's traffic is horse-drawn and period, as the storybook town's is its own
// contraptions (storyvehicles.ts). Each is a rig in the storybook's shape: rigid parts, each built
// once (x forward, y up, z to the right, the rig's origin on the ground at its middle), and a pose
// for them from how far it has come (odo, m), how fast it goes (v, m/s), the time (t, s) and a
// number of its own (seed) alone, so traffic can draw a part of every one of a kind as one
// instanced mesh and scrubbing replays it. Every horse is horse.ts's (horseParts, poseHorse).
//   hansom:        a two-wheeled cab, the cabby perched high behind its roof.
//   growler:       a four-wheeled cab, its driver on the box and a trunk on the roof.
//   omnibus:       a pair draws a double-deck bus with passengers back to back on its knifeboard
//                  and advertisement boards along its roof.
//   dray:          a pair of heavy horses walks a brewer's dray stacked with barrels.
//   coster:        a donkey draws a costermonger's cart of fruit and greens.
//   coalcart:      a heavy horse walks a cart of coal sacks.
//   horseback:     a gentleman rides by in a top hat.
//   pennyfarthing: a cyclist pedals a high wheel.
//   traction:      a steam traction engine chuffs along, puffing smoke from its chimney.
// A horse team abreast shares its parts (team): its horses step together, so one instanced mesh
// draws each of their parts, and a pair costs no more draw calls than one horse.
import * as THREE from "three@0.187.0";
import { Batch } from "../geom.ts";
import { headLamp } from "../cars.ts";
import { HORSE_COATS, HORSE_PARTS, horseParts, poseHorse } from "../horse.ts";
import type { HorseLook } from "../horse.ts";
import type { RigState, StoryRig } from "../storyvehicles.ts";

// A Victorian rig carries its body's tints (the pure white of its first part takes one per
// vehicle) and how many of it traffic keeps at once.
export interface VicRig extends StoryRig { colors: number[]; cap: number }

// (The rigs are made at first use, all in a closure: its names are its own when the modules are flattened.)
let vicRigsMade: VicRig[] | null = null;
export function vicRigs(): VicRig[] { return vicRigsMade ??= makeVicRigs(); }

function makeVicRigs(): VicRig[] {
  type Build = (b: Batch) => void;
  type P3 = readonly [number, number, number];
  const TAU = Math.PI * 2;
  const INK = 0x141312, IRON = 0x26282a, WOOD = 0x6a4a30, WOOD_D = 0x3e2c1e, BRASS = 0xb8963a, GLASS = 0x2a3440, LEATHER = 0x2e2018;
  const CREAM = 0xe6dcc0, STRAW = 0xc8b070, SKIN = 0xe0b08a, SKIN2 = 0xc68a62;
  const BLACK = 0x1c1c20, NAVY = 0x262c3e, BROWN = 0x4a3424, TWEED = 0x6a5e48, DRAB = 0x8a7a58, GREY = 0x56585a, RED = 0x8e2a22;
  const BAY = HORSE_COATS[0], DARK = HORSE_COATS[1], CHESTNUT = HORSE_COATS[2], DAPPLE = HORSE_COATS[3], SABLE = HORSE_COATS[4];

  // ---- drawing helpers ---------------------------------------------------------------------------

  // rod draws a square bar of side `r` from p to q.
  function rod(b: Batch, p: P3, q: P3, r: number, col: number) {
    const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2], len = Math.hypot(dx, dy, dz);
    b.boxR((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, len, r, r, col, 0, Math.atan2(-dz, dx), Math.atan2(dy, Math.hypot(dx, dz)));
  }
  // ring draws a ring of `n` boxes of radius r about the z axis at z, `t` deep radially and w wide.
  function ring(b: Batch, z: number, r: number, t: number, w: number, col: number, n = 16) {
    const seg = TAU * r / n * 1.08;
    for (let k = 0; k < n; k++) { const a = k / n * TAU; b.boxR(Math.cos(a) * r, Math.sin(a) * r, z, seg, t, w, col, 0, 0, a + Math.PI / 2); }
  }
  // wheel draws a spoked cart wheel about the z axis at z: an iron tyre on a wooden felloe, spokes and a hub.
  function wheel(b: Batch, z: number, r: number, w: number, spoke: number, n = 12) {
    ring(b, z, r - 0.025, 0.05, w, IRON, r > 0.5 ? 20 : 14);
    ring(b, z, r - 0.075, 0.06, w * 0.8, spoke, r > 0.5 ? 20 : 14);
    for (let k = 0; k < n; k++) { const a = (k + 0.5) / n * TAU; b.boxR(Math.cos(a) * r * 0.48, Math.sin(a) * r * 0.48, z, r * 0.9, 0.04, 0.045, spoke, 0, 0, a); }
    b.cyl(0, 0, z, Math.max(0.07, r * 0.15), w + 0.1, spoke, 8, Math.PI / 2);
    b.cyl(0, 0, z, Math.max(0.035, r * 0.07), w + 0.16, IRON, 6, Math.PI / 2);
  }
  // axle draws a pair of wheels `track` apart and the axle between them.
  const axle = (r: number, track: number, w: number, spoke: number, n = 12): Build => (b) => {
    for (const s of [-1, 1]) wheel(b, s * track / 2, r, w, spoke, n);
    b.cyl(0, 0, 0, 0.04, track, IRON, 6, Math.PI / 2);
  };
  // lamp draws a carriage lamp, its glass lit after dark (cars.ts headLamp).
  function lamp(b: Batch, x: number, y: number, z: number) {
    b.box(x, y, z, 0.12, 0.2, 0.12, INK); headLamp(b, x + 0.035, y + 0.01, z, 0.07, 0.12, 0.09); b.box(x, y + 0.13, z, 0.08, 0.06, 0.08, INK);
  }

  // A person dressed for the period: what they wear, as a coat (a long one hangs to the knee), the
  // trousers or a skirt, their skin, the hat, and what they hold.
  type Hat = "top" | "bowler" | "cap" | "bonnet" | "boater" | "fantail";
  interface Dress { coat: number; legs: number; skin?: number; hat: Hat; hatCol?: number; skirt?: boolean; long?: boolean; hands?: "reins" | "lap" | "bar" | "side"; scarf?: number; apron?: number }
  function hat(b: Batch, y: number, h: Hat, col: number) {
    if (h === "top") { b.cyl(0, y, 0, 0.17, 0.025, col, 10); b.cyl(0, y + 0.13, 0, 0.115, 0.26, col, 10); b.cyl(0, y + 0.04, 0, 0.118, 0.04, INK, 10); }
    else if (h === "bowler") { b.cyl(0, y, 0, 0.16, 0.02, col, 10); b.ico(0, y + 0.03, 0, 0.125, col, 0.85); }
    else if (h === "cap") { b.cyl(-0.01, y + 0.02, 0, 0.135, 0.06, col, 10); b.box(0.12, y, 0, 0.12, 0.025, 0.2, col); }
    else if (h === "fantail") { b.cyl(0, y + 0.03, 0, 0.13, 0.08, col, 10); b.boxR(-0.13, y - 0.12, 0, 0.04, 0.3, 0.3, col, 0, 0, -0.25); }
    else if (h === "boater") { b.cyl(0, y, 0, 0.18, 0.02, col, 12); b.cyl(0, y + 0.05, 0, 0.12, 0.09, col, 12); b.cyl(0, y + 0.03, 0, 0.122, 0.035, NAVY, 12); }
    else {   // (a bonnet: a brim framing the face, a crown behind, ribbons under the chin)
      b.ico(-0.05, y - 0.08, 0, 0.14, col, 1.0); b.boxR(0.04, y - 0.04, 0, 0.06, 0.2, 0.32, col, 0, 0, -0.35);
      b.box(0.05, y - 0.2, 0, 0.03, 0.08, 0.04, CREAM);
    }
  }
  // seated draws someone sitting at (x, y, z) on a seat's top, facing `rot` from +x (Batch.transformFrom).
  function seated(b: Batch, x: number, y: number, z: number, rot: number, d: Dress) {
    const m = b.mark(), sk = d.skin ?? SKIN;
    b.dy += y;
    if (d.skirt) { b.box(0.16, 0.06, 0, 0.5, 0.18, 0.42, d.legs); b.box(0.38, -0.2, 0, 0.16, 0.46, 0.4, d.legs); }
    else {
      b.box(0.0, 0.08, 0, 0.26, 0.16, 0.34, d.legs);
      for (const s of [-1, 1]) { b.box(0.22, 0.08, s * 0.1, 0.42, 0.14, 0.14, d.legs); b.box(0.4, -0.17, s * 0.1, 0.13, 0.42, 0.13, d.legs); b.box(0.45, -0.4, s * 0.1, 0.22, 0.07, 0.12, INK); }
    }
    b.box(-0.02, 0.4, 0, 0.26, 0.5, 0.38, d.coat);
    if (d.long) { b.box(-0.08, 0.14, 0, 0.2, 0.32, 0.42, d.coat); for (const s of [-1, 1]) b.box(0.2, 0.12, s * 0.12, 0.4, 0.08, 0.18, d.coat); }
    if (d.apron) b.box(0.15, 0.2, 0, 0.04, 0.55, 0.34, d.apron);
    b.box(0.03, 0.66, 0, 0.18, 0.06, 0.2, d.scarf ?? CREAM);   // (a collar, or a neckerchief)
    arms(b, 0.62, d.coat, sk, d.hands ?? "lap");
    b.ico(0.01, 0.8, 0, 0.11, sk, 1.1);
    hat(b, 0.9, d.hat, d.hatCol ?? BLACK);
    b.dy -= y;
    b.transformFrom(m, { ox: x, oz: z, rot });
  }
  // standing draws someone standing at (x, y, z), feet on y, facing `rot`.
  function standing(b: Batch, x: number, y: number, z: number, rot: number, d: Dress) {
    const m = b.mark(), sk = d.skin ?? SKIN;
    b.dy += y;
    if (d.skirt) b.box(0, 0.45, 0, 0.42, 0.9, 0.44, d.legs);
    else for (const s of [-1, 1]) { b.box(0, 0.45, s * 0.1, 0.14, 0.9, 0.14, d.legs); b.box(0.05, 0.03, s * 0.1, 0.24, 0.07, 0.12, INK); }
    b.box(0, 1.15, 0, 0.26, 0.55, 0.38, d.coat);
    if (d.long) b.box(-0.01, 0.75, 0, 0.3, 0.4, 0.42, d.coat);
    if (d.apron) b.box(0.15, 0.85, 0, 0.04, 0.8, 0.34, d.apron);
    b.box(0.03, 1.42, 0, 0.18, 0.06, 0.2, d.scarf ?? CREAM);
    arms(b, 1.38, d.coat, sk, d.hands ?? "side");
    b.ico(0.01, 1.56, 0, 0.11, sk, 1.1);
    hat(b, 1.66, d.hat, d.hatCol ?? BLACK);
    b.dy -= y;
    b.transformFrom(m, { ox: x, oz: z, rot });
  }
  // arms draws the arms from shoulders at height y: holding reins ahead, hands in the lap, on a bar, or at the sides.
  function arms(b: Batch, y: number, coat: number, sk: number, how: NonNullable<Dress["hands"]>) {
    for (const s of [-1, 1]) {
      const sh: P3 = [0, y - 0.04, s * 0.22];
      const el: P3 = how === "side" ? [0.02, y - 0.32, s * 0.24] : [0.12, y - 0.3, s * 0.22];
      const hd: P3 = how === "reins" ? [0.38, y - 0.24, s * 0.12] : how === "bar" ? [0.42, y - 0.1, s * 0.24] : how === "lap" ? [0.32, y - 0.42, s * 0.14] : [0.04, y - 0.58, s * 0.25];
      rod(b, sh, el, 0.1, coat); rod(b, el, hd, 0.09, coat); b.ico(hd[0], hd[1], hd[2], 0.05, sk);
    }
  }

  // team gives the parts of horses abreast at zs, each part one builder for all of them (they step
  // together: poseTeam), the k'th horse in looks[k].
  function team(looks: HorseLook[], zs: number[]): Build[] {
    const per = looks.map((l) => horseParts(l));
    return Array.from({ length: HORSE_PARTS }, (_, j) => (b: Batch) => zs.forEach((z, k) => {
      const m = b.mark(); per[k % per.length][j](b); b.transformFrom(m, { ox: 0, oz: z, rot: 0 });
    }));
  }

  const m4 = new THREE.Matrix4(), hb = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler(), vv = new THREE.Vector3(), sc = new THREE.Vector3();
  const at = (out: THREE.Matrix4, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s = 1) =>
    out.compose(vv.set(x, y, z), qq.setFromEuler(ee.set(rx, ry, rz)), sc.set(s, s, s));
  // poseTeam poses a team whose withers are at x, scaled by `s` (a donkey is a small horse, a dray
  // horse a big one, and a small horse takes short strides), into out[i..i + HORSE_PARTS); a pair
  // (`pair`) shares its parts, so it is posed abreast (horse.ts poseHorse).
  const poseTeam = (st: RigState, x: number, s: number, out: THREE.Matrix4[], i: number, pair = false) => {
    hb.compose(vv.set(x, 0, 0), qq.identity(), sc.set(s, s, s));
    poseHorse({ odo: st.odo / s, v: st.v / s, t: st.t, seed: st.seed }, hb, out, i, pair);
  };
  // trot is how a horse-drawn body rides on its springs: a little bounce at the horse's stride, and a sway.
  const ride = (st: RigState, stride: number) => 0.025 * Math.min(1, st.v / 2) * Math.abs(Math.sin(st.odo / stride * TAU)) + 0.006 * Math.sin(st.t * 1.7 + st.seed);
  const roll = (out: THREE.Matrix4, x: number, r: number, st: RigState, z = 0) => at(out, x, r, z, 0, 0, -st.odo / r);

  // ---- the hansom cab ---------------------------------------------------------------------------
  // The cab sits between two tall wheels with its doors folded across the front; the cabby sits
  // high behind its roof, his reins running over it to the horse.
  const HS_L = 5.2, HS_HX = HS_L / 2 - 0.95, HS_AX = -1.05, HS_R = 0.86;
  const hansom: VicRig = {
    id: "hansom", len: HS_L, width: 1.7, vmax: 5, cap: 8,
    colors: [0x2a2a2e, 0x5a2228, 0x2e4a36, 0x2a3450, 0x6a4a2a],
    parts: [
      (b) => {
        b.box(-0.95, 1.3, 0, 1.2, 1.5, 1.25, 0xffffff);                       // the body
        b.boxR(-0.3, 0.75, 0, 0.5, 0.3, 1.2, 0xffffff, 0, 0, 0.6);           // its front swept down to the footboard
        b.box(-0.95, 2.08, 0, 1.36, 0.07, 1.38, INK); b.box(-0.95, 2.14, 0, 1.2, 0.05, 1.2, INK);   // the roof
        for (const s of [-1, 1]) {
          b.box(-0.95, 1.55, s * 0.63, 0.7, 0.5, 0.02, GLASS);                // the side windows
          b.box(-0.95, 0.85, s * 0.63, 1.2, 0.05, 0.03, BRASS);               // a lining
          rod(b, [-0.5, 0.75, s * 0.6], [HS_HX + 0.1, 1.15, s * 0.38], 0.06, WOOD_D);   // the shafts
          lamp(b, -0.28, 1.7, s * 0.68);
        }
        b.box(-0.33, 1.0, 0, 0.05, 0.55, 1.12, 0xffffff);                    // the folding doors
        b.box(-0.36, 1.62, 0, 0.02, 0.62, 1.0, GLASS);                       // the front glass, up
        seated(b, -1.15, 0.92, 0, 0, { coat: BLACK, legs: GREY, hat: "top", hands: "lap" });   // a fare inside
        b.box(-1.75, 2.0, 0, 0.3, 0.4, 0.6, INK); b.box(-1.78, 2.27, 0, 0.42, 0.06, 0.62, LEATHER);   // the cabby's perch
        seated(b, -1.82, 2.3, 0, 0, { coat: DRAB, legs: BROWN, hat: "top", hands: "reins", long: true, scarf: RED });
        rod(b, [-1.35, 2.62, 0.18], [-1.25, 3.55, 0.28], 0.025, INK);                     // his whip
        for (const s of [-1, 1]) rod(b, [-1.42, 2.66, s * 0.12], [HS_HX + 0.75, 1.75, s * 0.12], 0.018, LEATHER);   // the reins
      },
      axle(HS_R, 1.6, 0.07, WOOD_D, 14),
      ...team([BAY], [0]),
    ],
    pose(s, out) {
      at(out[0], 0, ride(s, 1.6), 0, 0, 0, 0.01 * Math.sin(s.odo / 1.6 * TAU));
      roll(out[1], HS_AX, HS_R, s);
      poseTeam(s, HS_HX, 1, out, 2);
    },
  };

  // ---- the growler -------------------------------------------------------------------------------
  // A four-wheeled cab, a box with a door and windows each side, the driver on his box in front
  // and a trunk on the roof.
  const GR_L = 5.6, GR_HX = GR_L / 2 - 0.95;
  const growler: VicRig = {
    id: "growler", len: GR_L, width: 1.8, vmax: 4.5, cap: 6,
    colors: [0x3e3222, 0x2a3450, 0x5a2228, 0x8a7a3a, 0x2e4a36],
    parts: [
      (b) => {
        b.box(-1.4, 1.38, 0, 2.1, 1.25, 1.45, 0xffffff);
        b.box(-1.4, 0.82, 0, 2.15, 0.14, 1.5, INK);
        b.box(-1.4, 2.04, 0, 2.2, 0.08, 1.55, INK);
        for (const s of [-1, 1]) {
          for (const x of [-2.05, -1.4, -0.75]) b.box(x, 1.62, s * 0.73, 0.48, 0.5, 0.02, GLASS);
          b.box(-1.4, 1.1, s * 0.73, 0.04, 0.5, 0.02, INK);                  // the door's edge
          rod(b, [0.15, 0.95, s * 0.55], [GR_HX + 0.1, 1.15, s * 0.38], 0.06, WOOD_D);
          lamp(b, 0.25, 1.75, s * 0.62);
          rod(b, [-2.45, 2.1, s * 0.7], [-0.4, 2.1, s * 0.7], 0.03, BRASS);   // the luggage rail
        }
        b.box(-1.8, 2.3, 0, 0.9, 0.45, 0.7, 0x5a3e26); b.box(-1.8, 2.3, 0, 0.92, 0.06, 0.72, BRASS);   // a trunk
        b.box(-0.05, 1.3, 0, 0.6, 0.8, 1.2, INK);                          // the box under the driver's seat
        b.box(0.0, 1.73, 0, 0.5, 0.08, 1.1, LEATHER);
        b.boxR(0.42, 1.25, 0, 0.5, 0.05, 1.0, INK, 0, 0, -0.7);              // the footboard
        seated(b, -0.05, 1.77, -0.15, 0, { coat: NAVY, legs: BROWN, hat: "bowler", hands: "reins", long: true });
        for (const s of [-1, 1]) rod(b, [0.33, 2.15, -0.15 + s * 0.12], [GR_HX + 0.75, 1.75, s * 0.12], 0.018, LEATHER);
      },
      axle(0.5, 1.4, 0.06, WOOD_D, 10),
      axle(0.66, 1.6, 0.07, WOOD_D, 12),
      ...team([DARK], [0]),
    ],
    pose(s, out) {
      at(out[0], 0, ride(s, 1.6), 0);
      roll(out[1], 0.05, 0.5, s);
      roll(out[2], -1.95, 0.66, s);
      poseTeam(s, GR_HX, 1, out, 3);
    },
  };

  // ---- the horse omnibus ------------------------------------------------------------------------
  // A pair draws the bus: its saloon below with a row of windows; on the roof, passengers sit back
  // to back on the knifeboard down its middle, behind advertisement boards along each edge; the
  // driver sits up front and the conductor stands on the step at the back.
  const OB_L = 8.4, OB_HX = OB_L / 2 - 0.95, OB_TOP = 2.45;
  const ADS = [[0x8a2222, CREAM], [0x24406a, CREAM], [0xd8b040, INK], [0x2e5a34, CREAM], [CREAM, 0x8a2222], [INK, 0xd8b040]] as const;
  const omnibus: VicRig = {
    id: "omnibus", len: OB_L, width: 2.1, vmax: 4.2, cap: 4,
    colors: [0x2e6a3a, 0x8a2222, 0xc8a030, 0x2a4a8a, 0x6a3a20],
    parts: [
      (b) => {
        b.box(-1.7, 1.2, 0, 3.8, 0.75, 1.85, 0xffffff);                       // the lower panels
        b.box(-1.7, 1.95, 0, 3.8, 0.75, 1.8, 0xe8dcc0);                       // the window band
        for (const s of [-1, 1]) {
          for (let k = 0; k < 6; k++) b.box(-3.3 + k * 0.62, 1.95, s * 0.905, 0.5, 0.55, 0.02, GLASS);
          b.box(-1.7, 2.33, s * 0.92, 3.8, 0.14, 0.02, 0xffffff);            // the route board over the windows
          for (let k = 0; k < 7; k++) b.box(-3.2 + k * 0.5, 2.33, s * 0.935, 0.3, 0.06, 0.01, CREAM);   // (its lettering)
          b.box(-1.7, 0.82, s * 0.93, 3.8, 0.06, 0.02, BRASS);
        }
        b.box(-1.7, OB_TOP, 0, 3.9, 0.06, 1.95, INK);                         // the roof
        b.box(-1.7, 0.78, 0, 3.6, 0.1, 1.5, INK);                             // the floor
        // The knifeboard: a board down the middle, seats either side of it, and the passengers on
        // them facing out over the advertisement boards.
        b.box(-1.75, OB_TOP + 0.4, 0, 3.4, 0.7, 0.06, WOOD);
        for (const s of [-1, 1]) {
          b.box(-1.75, OB_TOP + 0.28, s * 0.22, 3.4, 0.06, 0.36, WOOD);
          ADS.forEach(([bg, fg], k) => {
            const x = -3.3 + k * 0.56;
            b.box(x, OB_TOP + 0.27, s * 0.97, 0.55, 0.42, 0.04, bg);
            b.box(x, OB_TOP + 0.33, s * 0.995, 0.4, 0.08, 0.01, fg); b.box(x, OB_TOP + 0.2, s * 0.995, 0.28, 0.06, 0.01, fg);
          });
        }
        const FARES: Dress[] = [
          { coat: BLACK, legs: GREY, hat: "top" }, { coat: TWEED, legs: BROWN, hat: "bowler" }, { coat: 0x5a2a3a, legs: 0x5a2a3a, hat: "bonnet", hatCol: 0x3a2a40, skirt: true },
          { coat: NAVY, legs: GREY, hat: "bowler", hatCol: 0x3a2a1e }, { coat: GREY, legs: BLACK, hat: "cap", hatCol: TWEED }, { coat: 0x2e4a5a, legs: 0x2e4a5a, hat: "bonnet", hatCol: STRAW, skirt: true },
          { coat: BROWN, legs: DRAB, hat: "top", hatCol: 0x5a4a3a }, { coat: BLACK, legs: BLACK, hat: "boater", hatCol: STRAW },
        ];
        for (let k = 0; k < 5; k++) for (const s of [-1, 1]) {
          const d = FARES[(k * 2 + (s > 0 ? 1 : 0) * 3) % FARES.length];
          seated(b, -3.15 + k * 0.62 + (s > 0 ? 0.25 : 0), OB_TOP + 0.31, s * 0.27, -s * Math.PI / 2, { ...d, hands: "lap", skin: k % 3 === 1 ? SKIN2 : SKIN });
        }
        // Up front: the driver's high seat and footboard, the pole between the horses, the reins.
        b.box(0.35, OB_TOP + 0.08, 0, 0.5, 0.3, 1.3, INK); b.box(0.35, OB_TOP + 0.24, 0, 0.5, 0.06, 1.2, LEATHER);
        b.boxR(0.75, 2.05, 0, 0.7, 0.05, 1.4, 0xffffff, 0, 0, -0.9);
        b.box(0.35, 1.3, 0, 0.8, 1.0, 1.3, INK);
        seated(b, 0.3, OB_TOP + 0.27, 0, 0, { coat: DRAB, legs: BROWN, hat: "top", hatCol: 0x3a3a3a, hands: "reins", long: true, scarf: RED });
        for (const s of [-1, 1]) rod(b, [0.68, OB_TOP + 0.65, s * 0.12], [OB_HX + 0.75, 1.75, s * 0.4], 0.018, LEATHER);
        rod(b, [0.6, 0.95, 0], [OB_HX + 0.9, 1.3, 0], 0.08, WOOD_D);
        b.box(0.85, 0.95, 0, 0.08, 0.08, 1.5, WOOD_D);
        for (const s of [-1, 1]) lamp(b, 0.15, 2.0, s * 0.9);
        // At the back: the platform, the curving stair up to the roof and the conductor on the step.
        b.box(-3.85, 0.62, 0, 0.5, 0.08, 1.6, INK);
        for (let k = 0; k < 5; k++) b.box(-3.85 - k * 0.04, 0.95 + k * 0.33, 0.45 - k * 0.12, 0.42, 0.05, 0.5, INK);
        rod(b, [-4.05, 0.9, 0.8], [-4.05, 2.9, 0.4], 0.04, BRASS);
        rod(b, [-3.6, 0.7, -0.78], [-3.6, 2.4, -0.78], 0.04, BRASS);
        standing(b, -3.85, 0.66, -0.4, 0, { coat: NAVY, legs: NAVY, hat: "cap", hatCol: NAVY, hands: "side" });
      },
      axle(0.55, 1.55, 0.07, WOOD_D, 10),
      axle(0.78, 1.95, 0.08, WOOD_D, 14),
      ...team([BAY, CHESTNUT], [-0.4, 0.4]),
    ],
    pose(s, out) {
      at(out[0], 0, ride(s, 1.6) * 0.6, 0);
      roll(out[1], 0.2, 0.55, s);
      roll(out[2], -2.7, 0.78, s);
      poseTeam(s, OB_HX, 1, out, 3, true);
    },
  };

  // ---- the brewer's dray ------------------------------------------------------------------------
  // A pair of heavy horses walks a long low dray with barrels stacked on it, the drayman up on his
  // seat in a leather apron.
  const DR_S = 1.12, DR_L = 8.0, DR_HX = DR_L / 2 - 0.95 * DR_S;
  const BARREL: readonly (readonly [number, number])[] = [[0.84, 0], [0.95, 0.18], [1, 0.5], [0.95, 0.82], [0.84, 1]];
  const barrel = (b: Batch, x: number, y: number, z: number, lying: boolean) => {
    const r = 0.33, h = 0.78;
    if (lying) {
      b.lathe("barrel", BARREL, x, y, z - h / 2, r, h, WOOD, 10, 0, Math.PI / 2);
      for (const e of [-1, 1]) b.cyl(x, y, z + e * (h / 2 - 0.01), r * 0.84, 0.02, WOOD_D, 10, Math.PI / 2);
      for (const f of [0.18, 0.82]) b.cyl(x, y, z - h / 2 + f * h, r * 0.96, 0.04, IRON, 10, Math.PI / 2);
    } else {
      b.lathe("barrel", BARREL, x, y, z, r, h, WOOD, 10);
      b.cyl(x, y + h - 0.01, z, r * 0.84, 0.02, WOOD_D, 10);
      for (const f of [0.18, 0.82]) b.cyl(x, y + f * h, z, r * 0.96, 0.04, IRON, 10);
    }
  };
  const dray: VicRig = {
    id: "dray", len: DR_L, width: 2.0, vmax: 2.2, cap: 3,
    colors: [0x8a2222, 0x2a4a8a, 0x2e5a34, 0xc8a030],
    parts: [
      (b) => {
        b.box(-1.7, 1.05, 0, 4.4, 0.16, 1.9, WOOD_D);                          // the bed
        for (const s of [-1, 1]) { b.box(-1.7, 1.25, s * 0.93, 4.4, 0.26, 0.05, 0xffffff); b.box(-1.7, 1.25, s * 0.955, 4.0, 0.06, 0.01, CREAM); }
        b.box(-3.88, 1.3, 0, 0.06, 0.4, 1.9, 0xffffff);
        for (let k = 0; k < 5; k++) for (const z of [-0.43, 0.43]) barrel(b, -3.45 + k * 0.72, 1.13, z, false);
        for (let k = 0; k < 4; k++) barrel(b, -3.1 + k * 0.72, 1.91 + 0.31, 0, true);
        // The drayman's seat, high on its iron stays, and the pole between the horses.
        for (const s of [-1, 1]) rod(b, [0.2, 1.1, s * 0.5], [0.55, 1.95, s * 0.5], 0.05, IRON);
        b.box(0.55, 2.0, 0, 0.5, 0.1, 1.3, 0xffffff); b.boxR(0.95, 1.6, 0, 0.6, 0.05, 1.2, INK, 0, 0, -0.9);
        seated(b, 0.5, 2.05, 0, 0, { coat: 0x3a3a3c, legs: BROWN, hat: "cap", hatCol: BROWN, hands: "reins", apron: 0x6a4a2a, scarf: RED });
        for (const s of [-1, 1]) rod(b, [0.88, 2.42, s * 0.12], [DR_HX + 0.75 * DR_S, 1.75 * DR_S, s * 0.47], 0.02, LEATHER);
        rod(b, [0.5, 0.9, 0], [DR_HX + 0.8, 1.4, 0], 0.09, WOOD_D);
      },
      axle(0.6, 1.75, 0.11, 0xa8282a, 12),
      axle(0.85, 2.0, 0.12, 0xa8282a, 14),
      ...team([DAPPLE, DAPPLE], [-0.42, 0.42]),
    ],
    pose(s, out) {
      at(out[0], 0, ride(s, 1.8) * 0.4, 0);
      roll(out[1], 0.05, 0.6, s);
      roll(out[2], -2.9, 0.85, s);
      poseTeam(s, DR_HX, DR_S, out, 3, true);
    },
  };

  // ---- the costermonger's cart ------------------------------------------------------------------
  // A donkey draws a little two-wheeled cart heaped with oranges, apples and cabbages, the coster
  // sitting on its front in his cap and neckerchief.
  const CO_S = 0.62, CO_L = 3.5, CO_HX = CO_L / 2 - 0.95 * CO_S;
  const heap = (b: Batch, x0: number, x1: number, z0: number, z1: number, y: number, r: number, col: number, col2: number) => {
    let k = 0;
    for (let x = x0 + r; x <= x1 - r + 1e-6; x += r * 1.9) for (let z = z0 + r; z <= z1 - r + 1e-6; z += r * 1.9, k++) {
      const up = Math.min(x - x0, x1 - x, z - z0, z1 - z) * 0.8;
      b.ico(x, y + r + up, z, r, k % 4 ? col : col2);
    }
  };
  const coster: VicRig = {
    id: "coster", len: CO_L, width: 1.3, vmax: 2.6, cap: 4,
    colors: [0x2a6aa0, 0x2e7a3a, 0xa02a22, 0xd0a030],
    parts: [
      (b) => {
        b.box(-0.6, 0.62, 0, 1.9, 0.08, 1.1, WOOD_D);
        for (const s of [-1, 1]) b.box(-0.6, 0.76, s * 0.53, 1.9, 0.2, 0.04, 0xffffff);
        for (const x of [-1.53, 0.33]) b.box(x, 0.76, 0, 0.04, 0.2, 1.1, 0xffffff);
        heap(b, -1.5, -0.85, -0.5, 0.0, 0.66, 0.07, 0xe8821e, 0xf0a030);         // oranges
        heap(b, -1.5, -0.85, 0.0, 0.5, 0.66, 0.07, 0xb02a22, 0x8a9a2a);          // apples
        heap(b, -0.8, -0.1, -0.5, 0.5, 0.66, 0.12, 0x5a8a3a, 0x7aa04a);          // cabbages
        b.box(0.05, 0.76, 0, 0.5, 0.2, 0.9, 0x8a6a3a); heap(b, -0.2, 0.3, -0.42, 0.42, 0.8, 0.06, 0xd8c040, 0xc8302a);   // a basket of pears and plums
        for (const s of [-1, 1]) rod(b, [0.3, 0.62, s * 0.5], [CO_HX + 0.1 * CO_S, 1.15 * CO_S, s * 0.25], 0.05, WOOD_D);
        seated(b, 0.15, 0.86, -0.38, 0, { coat: 0x5a4a32, legs: 0x4a3a28, hat: "cap", hatCol: TWEED, hands: "reins", scarf: 0xc8302a, skin: SKIN2 });
        for (const s of [-1, 1]) rod(b, [0.53, 1.24, -0.38 + s * 0.1], [CO_HX + 0.7 * CO_S, 1.7 * CO_S, s * 0.08], 0.015, LEATHER);
      },
      axle(0.42, 1.28, 0.05, 0xa8822a, 10),
      ...team([DAPPLE], [0]),
    ],
    pose(s, out) {
      at(out[0], 0, ride(s, 1.0) * 0.6, 0);
      roll(out[1], -0.65, 0.42, s);
      poseTeam(s, CO_HX, CO_S, out, 2);
    },
  };

  // ---- the coal cart ----------------------------------------------------------------------------
  // A heavy horse walks a cart of sacks of coal, the coalman in his fantail hat on its front.
  const CC_S = 1.08, CC_L = 5.2, CC_HX = CC_L / 2 - 0.95 * CC_S;
  const coalcart: VicRig = {
    id: "coalcart", len: CC_L, width: 1.8, vmax: 2.2, cap: 3,
    colors: [0x5a3a2a, 0x3a4a30, 0x6a2a22, 0x2a3a4a],
    parts: [
      (b) => {
        b.box(-1.15, 0.95, 0, 2.4, 0.1, 1.5, WOOD_D);
        for (const s of [-1, 1]) b.box(-1.15, 1.25, s * 0.74, 2.4, 0.5, 0.04, 0xffffff);
        b.box(-2.33, 1.25, 0, 0.04, 0.5, 1.5, 0xffffff); b.box(0.03, 1.25, 0, 0.04, 0.5, 1.5, 0xffffff);
        for (let k = 0; k < 4; k++) for (const z of [-0.36, 0.36]) {
          const x = -2.0 + k * 0.56;
          b.ico(x, 1.38, z, 0.26, 0x2c2a28, 1.45); b.box(x + 0.02, 1.76, z, 0.12, 0.1, 0.12, 0x3a3634);
        }
        heap(b, -2.3, -1.6, -0.7, 0.7, 1.02, 0.08, 0x141414, 0x262626);       // loose coal at the tail
        for (const s of [-1, 1]) rod(b, [0.0, 0.95, s * 0.6], [CC_HX + 0.1 * CC_S, 1.15 * CC_S, s * 0.4], 0.06, WOOD_D);
        seated(b, 0.1, 1.5, -0.45, 0, { coat: 0x2e2c2a, legs: 0x2a2826, hat: "fantail", hatCol: 0x2a2624, hands: "reins", skin: 0xa88466, scarf: 0x3a3634 });
        for (const s of [-1, 1]) rod(b, [0.48, 1.88, -0.45 + s * 0.1], [CC_HX + 0.75 * CC_S, 1.75 * CC_S, s * 0.12], 0.015, LEATHER);
      },
      axle(0.72, 1.7, 0.09, 0x4a3a2a, 12),
      ...team([SABLE], [0]),
    ],
    pose(s, out) {
      at(out[0], 0, ride(s, 1.7) * 0.5, 0);
      roll(out[1], -1.1, 0.72, s);
      poseTeam(s, CC_HX, CC_S, out, 2);
    },
  };

  // ---- the gentleman on horseback ---------------------------------------------------------------
  // The rider (the first part: his coat takes the vehicle's tint) sits his saddle, rising to the trot.
  const HB_L = 2.6, HB_HX = HB_L / 2 - 0.95;
  const horseback: VicRig = {
    id: "horseback", len: HB_L, width: 0.8, vmax: 4.5, cap: 4,
    colors: [0x1c1c20, 0x222a3a, 0x3a2a1e, 0x4a4a48, 0x7a1a1a],
    parts: [
      (b) => {   // (built in the horse's frame: the saddle on its back, his legs either side)
        b.box(-0.3, 1.66, 0, 0.55, 0.08, 0.7, LEATHER); b.box(-0.3, 1.6, 0, 0.7, 0.04, 0.75, 0x6a2a22);
        b.box(-0.32, 1.95, 0, 0.26, 0.5, 0.38, 0xffffff);
        b.box(-0.42, 1.78, 0, 0.18, 0.3, 0.42, 0xffffff);                    // the tails of his frock coat
        for (const s of [-1, 1]) {
          rod(b, [-0.32, 1.72, s * 0.17], [-0.05, 1.45, s * 0.38], 0.14, 0xd8ccb0);   // breeches
          rod(b, [-0.05, 1.45, s * 0.38], [-0.12, 0.98, s * 0.38], 0.13, INK);         // boots
          b.box(-0.04, 0.94, s * 0.38, 0.24, 0.07, 0.12, INK);
          rod(b, [-0.3, 2.16, s * 0.22], [-0.2, 1.86, s * 0.22], 0.1, 0xffffff); rod(b, [-0.2, 1.86, s * 0.22], [0.08, 1.8, s * 0.1], 0.09, 0xffffff);
          b.ico(0.1, 1.8, s * 0.1, 0.05, 0xd8d0c0);                         // (gloves)
          rod(b, [0.1, 1.8, s * 0.1], [0.7, 1.95, s * 0.08], 0.015, LEATHER);
        }
        b.box(-0.29, 2.22, 0, 0.18, 0.06, 0.2, CREAM);
        b.ico(-0.3, 2.36, 0, 0.11, SKIN, 1.1);
        b.dy += 2.46; { const m = b.mark(); hat(b, 0, "top", BLACK); b.transformFrom(m, { ox: -0.3, oz: 0, rot: 0 }); } b.dy -= 2.46;
      },
      ...team([CHESTNUT], [0]),
    ],
    pose(s, out) {
      poseTeam(s, HB_HX, 1, out, 1);
      const k = Math.min(1, s.v / 2.5), post = 0.06 * k * Math.abs(Math.sin(s.odo / 1.6 * TAU));
      at(out[0], HB_HX, post, 0, 0, 0, -0.08 * k);
    },
  };

  // ---- the penny-farthing -----------------------------------------------------------------------
  // The rider sits high over the big front wheel, pedalling its cranks direct; his thighs and
  // shins are posed to the pedals.
  const PF_R = 0.66, PF_HUB: [number, number] = [0.35, PF_R], PF_HIP: [number, number] = [0.13, 1.4], PF_CRANK = 0.13, PF_THIGH = 0.45, PF_SHIN = 0.47;
  const pennyfarthing: VicRig = {
    id: "pennyfarthing", len: 1.8, width: 0.7, vmax: 4.5, cap: 4,
    colors: [0x6a5e48, 0x2a3450, 0x7a2a22, 0x3a4a30],
    parts: [
      (b) => {
        // The frame: the backbone curving from the head down to the little wheel, the fork, the bars.
        const arc: P3[] = Array.from({ length: 6 }, (_, i) => { const a = i / 5; return [0.3 - a * 0.95, 1.36 - Math.sin(a * Math.PI / 2) * 0.98 - a * 0.0, 0]; });
        for (let i = 0; i < 5; i++) rod(b, arc[i], arc[i + 1], 0.05, INK);
        for (const s of [-1, 1]) rod(b, [0.3, 1.36, s * 0.04], [PF_HUB[0], PF_HUB[1], s * 0.07], 0.04, INK);
        rod(b, [-0.62, 0.38, 0], [-0.65, 0.19, 0.05], 0.03, INK);
        rod(b, [0.32, 1.38, 0], [0.4, 1.46, 0], 0.04, INK); b.box(0.4, 1.46, 0, 0.04, 0.04, 0.62, INK);
        b.box(0.12, 1.39, 0, 0.26, 0.05, 0.16, LEATHER);
        // The rider: a tweed jacket (the tint), a cap, his arms to the bars.
        b.box(0.12, 1.47, 0, 0.24, 0.14, 0.32, 0xd8ccb0);
        b.boxR(0.18, 1.74, 0, 0.24, 0.5, 0.36, 0xffffff, 0, 0, -0.22);
        for (const s of [-1, 1]) { rod(b, [0.25, 1.92, s * 0.2], [0.33, 1.68, s * 0.24], 0.09, 0xffffff); rod(b, [0.33, 1.68, s * 0.24], [0.42, 1.48, s * 0.29], 0.08, 0xffffff); b.ico(0.42, 1.47, s * 0.3, 0.045, SKIN); }
        b.box(0.27, 2.0, 0, 0.16, 0.06, 0.2, CREAM);
        b.ico(0.3, 2.13, 0, 0.11, SKIN, 1.1);
        b.dy += 2.24; { const m = b.mark(); hat(b, 0, "cap", 0x4a4a3a); b.transformFrom(m, { ox: 0.3, oz: 0, rot: 0 }); } b.dy -= 2.24;
      },
      (b) => {   // the big wheel, its cranks and pedals (they turn with it)
        ring(b, 0, PF_R - 0.02, 0.04, 0.05, 0x1a1a1a, 24); ring(b, 0, PF_R - 0.05, 0.025, 0.03, 0x8a8a8a, 24);
        for (let k = 0; k < 18; k++) { const a = k / 18 * TAU; b.boxR(Math.cos(a) * PF_R / 2, Math.sin(a) * PF_R / 2, (k % 2 ? 1 : -1) * 0.02, PF_R * 0.95, 0.012, 0.012, 0xb8bcc0, 0, 0, a); }
        b.cyl(0, 0, 0, 0.06, 0.16, 0x8a8a8a, 8, Math.PI / 2);
        for (const [s, x] of [[-1, 1], [1, -1]] as const) { b.box(x * PF_CRANK / 2, 0, s * 0.11, PF_CRANK, 0.03, 0.02, 0x8a8a8a); b.box(x * PF_CRANK, 0, s * 0.15, 0.06, 0.03, 0.08, INK); }
      },
      (b) => { ring(b, 0, 0.18, 0.03, 0.04, 0x1a1a1a, 12); for (let k = 0; k < 6; k++) b.boxR(0, 0, 0, 0.34, 0.01, 0.01, 0xb8bcc0, 0, 0, k / 6 * Math.PI); },
      ...[0, 1].flatMap(() => [
        (b: Batch) => { b.box(0, -PF_THIGH / 2, 0, 0.13, PF_THIGH + 0.04, 0.13, 0xd8ccb0); },   // (knickerbockers)
        (b: Batch) => { b.box(0, -PF_SHIN / 2 + 0.04, 0, 0.11, PF_SHIN - 0.06, 0.11, 0x6a5040); b.box(0.06, -PF_SHIN + 0.02, 0, 0.2, 0.06, 0.1, INK); },   // (stockings, shoes)
      ]),
    ],
    pose(s, out) {
      const wob = 0.02 * Math.sin(s.t * 1.3 + s.seed);
      at(out[0], 0, 0, 0, wob);
      const turn = -s.odo / PF_R;
      at(out[1], PF_HUB[0], PF_HUB[1], 0, 0, 0, turn);
      at(out[2], -0.65, 0.19, 0, 0, 0, -s.odo / 0.19);
      // Each leg's knee from its hip and pedal (two links: the knee forward), thigh and shin hanging from it.
      for (const [k, side, ph] of [[3, -1, 0], [5, 1, Math.PI]] as const) {
        const px = PF_HUB[0] + Math.cos(turn + ph) * PF_CRANK, py = PF_HUB[1] + Math.sin(turn + ph) * PF_CRANK;
        let dx = px - PF_HIP[0], dy = py - PF_HIP[1]; const d = Math.min(Math.hypot(dx, dy), PF_THIGH + PF_SHIN - 1e-3);
        const a0 = Math.atan2(dy, dx), al = Math.acos(THREE.MathUtils.clamp((PF_THIGH ** 2 + d * d - PF_SHIN ** 2) / (2 * PF_THIGH * d), -1, 1));
        const kx = PF_HIP[0] + Math.cos(a0 + al) * PF_THIGH, ky = PF_HIP[1] + Math.sin(a0 + al) * PF_THIGH;
        at(out[k], PF_HIP[0], PF_HIP[1], side * 0.11, 0, 0, Math.atan2(kx - PF_HIP[0], -(ky - PF_HIP[1])));
        dx = px - kx; dy = py - ky;
        at(out[k + 1], kx, ky, side * 0.13, 0, 0, Math.atan2(dx, -dy));
      }
    },
  };

  // ---- the steam traction engine ----------------------------------------------------------------
  // Its boiler on great straked hind wheels, the flywheel spinning at its side, a canopy on brass
  // posts, the driver on the footplate; puffs of smoke chuff from its chimney and drift behind.
  const TE_L = 5.8, TE_RR = 0.95, TE_FR = 0.55, TE_CH: [number, number] = [1.85, 3.55], TE_PUFFS = 4;
  const traction: VicRig = {
    id: "traction", len: TE_L, width: 2.3, vmax: 1.8, cap: 2,
    colors: [0x8a1e22, 0x2e5a34, 0x5a1a20, 0x2a3a6a],
    parts: [
      (b) => {
        b.cyl(0.4, 1.5, 0, 0.48, 2.4, 0xffffff, 12, 0, Math.PI / 2);                          // the boiler
        for (const x of [-0.5, 0.4, 1.3]) b.cyl(x, 1.5, 0, 0.49, 0.05, BRASS, 12, 0, Math.PI / 2);
        b.cyl(1.82, 1.5, 0, 0.5, 0.5, 0x222222, 12, 0, Math.PI / 2); b.cyl(2.08, 1.5, 0, 0.4, 0.04, 0x333333, 12, 0, Math.PI / 2);   // the smokebox and its door
        b.cyl(TE_CH[0], 2.7, 0, 0.13, 1.7, 0x222222, 10); b.cyl(TE_CH[0], TE_CH[1] - 0.05, 0, 0.18, 0.16, 0xb87333, 10);   // the chimney and its copper cap
        b.box(-1.25, 1.45, 0, 0.7, 1.1, 1.05, 0xffffff);                                       // the firebox
        b.box(0.9, 2.1, 0, 0.7, 0.3, 0.5, 0x2a2a2a); b.cyl(0.4, 2.15, 0, 0.1, 0.4, BRASS, 8);   // the cylinder block and the dome
        b.cyl(-0.5, 2.25, -0.2, 0.04, 0.5, BRASS, 6);                                          // the whistle
        b.box(-1.95, 1.1, 0, 0.8, 0.8, 1.7, 0xffffff); heap(b, -2.3, -1.6, -0.75, 0.75, 1.45, 0.08, 0x161616, 0x2a2a2a);   // the tender, coal in it
        b.box(-2.2, 0.72, 0, 0.6, 0.06, 1.2, IRON);                                            // the footplate
        b.box(1.65, 0.7, 0, 0.3, 0.3, 1.5, IRON);                                              // the front axle's perch
        for (const [x, z] of [[-2.25, -1.0], [-2.25, 1.0], [1.45, -0.9], [1.45, 0.9]]) b.cyl(x, 2.35, z, 0.035, 1.6, BRASS, 6);
        b.box(-0.4, 3.18, 0, 3.9, 0.06, 2.2, 0x222222); b.box(-0.4, 3.13, 0, 3.95, 0.06, 2.24, 0xffffff);   // the canopy
        b.box(-0.9, 2.05, 0.8, 0.1, 0.1, 0.5, IRON);                                           // the flywheel's bearing
        standing(b, -2.1, 0.75, -0.25, 0, { coat: 0x3a3a3c, legs: 0x2a2a2c, hat: "cap", hatCol: 0x2a2a2a, hands: "bar", scarf: RED });
      },
      (b) => {   // the hind wheels: broad iron tyres with diagonal strakes, iron spokes
        for (const s of [-1, 1]) {
          ring(b, s * 1.0, TE_RR - 0.04, 0.08, 0.42, IRON, 26);
          for (let k = 0; k < 26; k++) { const a = k / 26 * TAU; b.boxR(Math.cos(a) * TE_RR, Math.sin(a) * TE_RR, s * 1.0, 0.05, 0.04, 0.44, 0x3a3a3a, 0.5, 0, a + Math.PI / 2); }
          for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; b.boxR(Math.cos(a) * TE_RR * 0.47, Math.sin(a) * TE_RR * 0.47, s * 1.0, TE_RR * 0.9, 0.06, 0.06, 0xffffff, 0, 0, a); }
          b.cyl(0, 0, s * 1.0, 0.16, 0.5, IRON, 8, Math.PI / 2);
        }
        b.cyl(0, 0, 0, 0.06, 2.0, IRON, 6, Math.PI / 2);
      },
      (b) => {
        for (const s of [-1, 1]) {
          ring(b, s * 0.75, TE_FR - 0.03, 0.06, 0.22, IRON, 18);
          for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; b.boxR(Math.cos(a) * TE_FR * 0.47, Math.sin(a) * TE_FR * 0.47, s * 0.75, TE_FR * 0.9, 0.05, 0.05, 0xffffff, 0, 0, a); }
          b.cyl(0, 0, s * 0.75, 0.1, 0.3, IRON, 8, Math.PI / 2);
        }
        b.cyl(0, 0, 0, 0.05, 1.5, IRON, 6, Math.PI / 2);
      },
      (b) => {   // the flywheel
        ring(b, 0, 0.5, 0.07, 0.09, 0x2a2a2a, 18);
        for (let k = 0; k < 6; k++) b.boxR(0, 0, 0, 0.95, 0.06, 0.05, 0x2a2a2a, 0, 0, k / 6 * Math.PI);
        b.cyl(0, 0, 0, 0.08, 0.14, BRASS, 8, Math.PI / 2);
      },
      ...Array.from({ length: TE_PUFFS }, (_, i) => (b: Batch) => {   // the puffs of smoke, a little cloud each
        const c = i % 2 ? 0xc8c8c4 : 0xa8a8a6;
        b.ico(0, 0, 0, 0.3, c); b.ico(0.18, -0.08, 0.12, 0.2, c); b.ico(-0.14, 0.1, -0.1, 0.22, c);
      }),
    ],
    pose(s, out) {
      const chug = 0.012 * Math.sin(s.odo / 0.9 * TAU) + 0.006 * Math.sin(s.t * 9 + s.seed);
      at(out[0], 0, chug, 0);
      roll(out[1], -1.5, TE_RR, s);
      roll(out[2], 1.75, TE_FR, s);
      at(out[3], -0.9, 2.05 + chug, 0.9, 0, 0, -s.odo / 0.25 - s.t * 1.5);
      // A puff leaves the chimney every quarter of a cycle (faster as it goes), rises, swells and is
      // left behind by the engine going on, then shrinks away.
      const LIFE = 2.6;
      for (let i = 0; i < TE_PUFFS; i++) {
        const a = ((s.odo / 1.4 + s.t * 0.4 + i / TE_PUFFS) % 1 + 1) % 1, sec = a * LIFE;
        const size = (0.35 + 1.5 * a) * (a < 0.75 ? 1 : (1 - a) / 0.25);
        at(out[4 + i], TE_CH[0] - sec * (s.v + 0.3), TE_CH[1] + 0.15 + sec * 0.8, 0.15 * Math.sin(a * 5 + i), 0, a * 3 + i, 0, size);
      }
    },
  };

  return [hansom, growler, omnibus, dray, coster, coalcart, horseback, pennyfarthing, traction];
}
