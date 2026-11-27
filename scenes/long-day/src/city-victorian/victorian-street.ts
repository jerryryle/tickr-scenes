// This file draws the Victorian city's street pieces (styles.ts, `victorian`): its gas lamps, its
// junction signals and point-duty constables (signals.ts), its street furniture (decor.ts) and the
// finger posts on the country road into it (countryworld.ts). Each piece is cast iron, timber or
// granite, after the kind a town of about 1870 had. A city chunk holds dozens of them, so each is
// drawn in as few triangles as keep its shape: six-sided shafts, four-sided finials, flat panes for
// glass and lettering.
// The file imports only geometry and the figures, so city.ts and the others can import it at load.
import * as THREE from "three@0.187.0";
import { Batch, BATCH } from "../geom.ts";
import { hash2 } from "../rng.ts";
import { Figures, FIG_STYLE, HAIRS, SKINS } from "../figure.ts";
import { VIC, VIC_GASLIGHT } from "./victorian-buildings-town.ts";

// The street's iron is painted a dark green, a shade lighter than VIC.iron so that it reads against
// a dark pavement on the board; its trim is gilt, its pillar boxes are post-office red. Bollards,
// pumps and hitching posts are plain black iron, so that the green stays with the lamps and signals.
const VS_IRON = 0x2c3a31, VS_IRON_DARK = 0x1f2822, VS_GILT = VIC.gilt, VS_RED = 0xb3221c, VS_GRANITE = 0x8e8a82, VS_TIMBER = VIC.timber;
const VS_BLACK = 0x26272a;
// (A gas lamp's glass by day is clear, so it shows a pale grey; it glows orange after dark.)
const VS_LAMP_GLASS = 0xb4b8aa;

// vsLocal runs fn, which draws into b about the origin, and then moves what it drew to (x, z)
// turned by rot (Frame2's sense: local +x goes to (cos rot, -sin rot), local +z to (sin rot, cos rot)).
function vsLocal(b: Batch, x: number, z: number, rot: number, fn: () => void) {
  const n0 = b.mark();
  fn();
  b.transformFrom(n0, { ox: x, oz: z, rot });
}
// vsPane draws an upright rectangle w across and h high centred on (x, y, z), facing local +x or -x
// (`nx` 1 or -1, nz 0) or +z or -z: two triangles, for glass and lettering on a face.
function vsPane(b: Batch, x: number, y: number, z: number, w: number, h: number, color: number, nx: number, nz: number) {
  const ux = nz, uz = nx, y0 = y - h / 2, y1 = y + h / 2, ax = x - ux * w / 2, az = z - uz * w / 2, bx = x + ux * w / 2, bz = z + uz * w / 2;
  b.tri(ax, y0, az, bx, y0, bz, bx, y1, bz, color, [nx, 0, nz]); b.tri(ax, y0, az, bx, y1, bz, ax, y1, az, color, [nx, 0, nz]);
}
// A cast-iron foot: a plinth and a flared waist up into the shaft, r across and h tall, closed at
// the top (thirty triangles in six steps).
const VS_FOOT = [[1, 0], [1, 0.3], [0.45, 1], [0, 1]] as const;
// A tapered square lantern on its seat (lathed in four steps, turned a quarter to square it up).
const VS_LANTERN = [[0.25, 0], [0.62, 0.25], [1, 1]] as const;

// vicLamp draws a cast-iron gas lamp post at the back of the kerb (px, pz), on ground y0: a flared
// foot, a slim shaft with a gilt collar and a ladder bar for the lamplighter's ladder, and a tapered
// glazed lantern with a pointed cap and a finial. Its ladder bar runs along the kerb (across the
// way to the road head (hx, hz), where another city's streetlight hangs its head). The glass glows
// a gas flame's orange after dark (VIC_GASLIGHT). It returns where its light is.
export function vicLamp(s: Batch, px: number, pz: number, hx: number, hz: number, y0: number): [number, number, number] {
  vsLocal(s, px, pz, Math.atan2(hx - px, hz - pz), () => {
    s.lathe("vicFoot", VS_FOOT, 0, y0, 0, 0.17, 0.7, VS_IRON, 6);
    s.cyl(0, y0 + 2.0, 0, 0.05, 2.7, VS_IRON, 6);
    s.cyl(0, y0 + 3.36, 0, 0.08, 0.06, VS_GILT, 6);
    s.box(0, y0 + 3.22, 0, 0.66, 0.04, 0.04, VS_IRON);
    s.aux.set(0, 0, VIC_GASLIGHT); s.lathe("vicLantern", VS_LANTERN, 0, y0 + 3.4, 0, 0.25, 0.72, VS_LAMP_GLASS, 4, Math.PI / 4); s.aux.set(0, 0, -1);
    s.cone(0, y0 + 4.25, 0, 0.3, 0.26, VS_IRON, 4, 0, Math.PI / 4);
    s.cone(0, y0 + 4.48, 0, 0.05, 0.2, VS_GILT, 4);
  });
  return [px, y0 + 3.86, pz];
}

// ---- junctions ----------------------------------------------------------------------------------
// The signal's tag for its lamps and arms (signals.ts): `lamp` is the state it shows in (0 red, 1
// yellow, 2 green); with `hide`, it is not drawn at all while that state is not showing, where an
// ordinary lamp only dims.
export type VicSignalTag = (lamp: 0 | 1 | 2, hide: boolean) => void;
const VS_ARM_RED = 0x9e1e18, VS_GLASS_RED = 0xff3a22, VS_GLASS_GREEN = 0x3aff7a;
// vicSignal draws the Westminster kind of junction signal (1868) at (px, pz) for the traffic coming
// up heading (fx, fz), the road towards (ax, az): a tall cast-iron column with a lantern of red and
// green glass at its top and a semaphore arm that reaches out over the kerb. The arm stands out level
// for stop, drops to a slant for caution and hangs down by the column for go. The red glass lights
// for stop and the green for caution and go, and each arm position and the green glass are drawn
// only while their state shows (tag). Column and lantern go in `solid`, glass and arms in `lamps`.
export function vicSignal(solid: Batch, lamps: Batch, px: number, pz: number, fx: number, fz: number, ax: number, az: number, tag: VicSignalTag) {
  // (Local frame: +z towards the road, +x along it the way the traffic heads; the glass faces -x.)
  const rot = Math.atan2(ax, az), f = Math.sign(fx * Math.cos(rot) - fz * Math.sin(rot)) || 1;   // (f: the traffic heads along local +x, or -x)
  vsLocal(solid, px, pz, rot, () => {
    solid.lathe("vicFoot", VS_FOOT, 0, 0, 0, 0.3, 1.4, VS_IRON, 6);
    solid.cyl(0, 3.3, 0, 0.11, 4.0, VS_IRON, 6);
    solid.cyl(0, 4.85, 0, 0.15, 0.12, VS_GILT, 6);
    solid.box(0, 5.55, 0, 0.42, 0.7, 0.42, VS_IRON_DARK);
    solid.cone(0, 6.05, 0, 0.36, 0.3, VS_IRON, 6);
    solid.cone(0, 6.4, 0, 0.08, 0.4, VS_GILT, 4);
  });
  // (The glass is boxes: a lamp's tag rides on its vertices' aux, which Batch.tri does not write.)
  vsLocal(lamps, px, pz, rot, () => {
    tag(0, false); lamps.box(-f * 0.215, 5.73, 0, 0.02, 0.2, 0.24, VS_GLASS_RED);
    for (const k of [1, 2] as const) { tag(k, true); lamps.box(-f * 0.215, 5.37, 0, 0.02, 0.2, 0.24, VS_GLASS_GREEN); }
    // The arm: 1.5 m of red from its pivot on the column's road side.
    const arm = (state: 0 | 1 | 2, tilt: number) => {
      tag(state, true);
      lamps.boxR(0, 5.0 + Math.sin(tilt) * 0.75, 0.14 + Math.cos(tilt) * 0.75, 0.04, 0.2, 1.5, VS_ARM_RED, -tilt, 0, 0);
    };
    arm(0, 0); arm(1, -Math.PI / 4); arm(2, -Math.PI / 2 + 0.08);
  });
}
// A constable on point duty stands in the middle of a junction that has no signal columns. He is
// drawn once for each phase of its signal (signals.ts), each pose tagged to show only while its
// phase has the junction. In each pose he faces out along an arm whose traffic he is holding, his
// right arm raised straight up to stop it and his left arm out level towards the traffic he is
// waving on. His limbs keep to the vertical and to the line of the traffic he lets through, so the
// carriages passing him on either side clear him. He is the crowd's bobby (figure.ts, dress
// "bobby"), posed once and kept as boxes in his own frame, facing +x, his feet on the roadway.
let vsBobby: number[] | null = null;
function bobbyBoxes(): number[] {
  if (vsBobby) return vsBobby;
  const F = new Figures(new THREE.Scene(), new THREE.MeshBasicMaterial(), 64), was = FIG_STYLE.victorian;
  FIG_STYLE.victorian = true;
  try { F.person({ x: 0, z: 0, yaw: 0, y: 0, arms: [0, 2.95], armOut: [Math.PI / 2 - 0.05, 0], shirt: 0, pants: 0, skin: SKINS[0], hair: HAIRS[0], dress: "bobby" }); }
  finally { FIG_STYLE.victorian = was; }
  // (Each box as its centre, its size, its colour and its turn, in Batch.boxR's terms.)
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), e = new THREE.Euler(), c = new THREE.Color(), out: number[] = [];
  for (let i = 0; i < F.n; i++) {
    F.mesh.getMatrixAt(i, m); F.mesh.getColorAt(i, c); m.decompose(p, q, sc); e.setFromQuaternion(q, "XYZ");
    out.push(p.x, p.y, p.z, sc.x, sc.y, sc.z, c.getHex(), e.x, e.y, e.z);
  }
  // (His white gloves for point duty, on the ends of his sleeves: Figures draws no hands.)
  for (const h of [F.handL, F.handR]) out.push(h[0], h[1], h[2], 0.1, 0.1, 0.1, VS_GLOVE, 0, 0, 0);
  F.mesh.geometry.dispose();
  return vsBobby = out;
}
// vicConstable draws him at (x, z), once for each of `poses`: the heading he faces (Frame2's sense)
// and the tag that shows that pose (tag(true): the part of it that glows after dark). He wears white
// gloves for point duty, and a bull's-eye lantern on his belt glows after dark; the junction's gas
// light falls on him (city.ts registers a lamp over him), so he and his signals read at night.
export function vicConstable(lamps: Batch, x: number, z: number, poses: { yaw: number; tag: (glow?: boolean) => void }[]) {
  if (BATCH.dry) return;   // (a probe build, where every Batch drops what it is given and Figures cannot pose him)
  const B = bobbyBoxes();
  for (const { yaw, tag } of poses) {
    tag();
    vsLocal(lamps, x, z, yaw, () => {
      for (let i = 0; i < B.length; i += 10) lamps.boxR(B[i], B[i + 1], B[i + 2], B[i + 3], B[i + 4], B[i + 5], B[i + 6], B[i + 7], B[i + 8], B[i + 9]);
      tag(true); lamps.box(0.2, VS_BELT, 0.1, 0.1, 0.13, 0.1, VS_BULLSEYE);
    });
  }
}
const VS_GLOVE = 0xf4f1e8, VS_BELT = 0.98, VS_BULLSEYE = 0xffb04a;
const VS_BOARD = 0xece4cc;

// ---- street furniture ------------------------------------------------------------------------------
// Each piece is drawn by decor.ts streetFurniture in the pavement's frame: at (x, z) along the kerb
// and the way in from it (`inward` unit (ix, iz): from the road towards the buildings), on ground
// y0, (x, z) on the kerb's face. Each keeps to the footprint of the modern piece it stands in for,
// which decor.ts records for the walkers, and stands as far in from the kerb (d) as that one does.
export type VicPiece = (s: Batch, x: number, z: number, ix: number, iz: number, y0: number) => void;
const vsPiece = (d: number, draw: (s: Batch, y0: number) => void): VicPiece => (s, x, z, ix, iz, y0) => vsLocal(s, x + ix * d, z + iz * d, Math.atan2(ix, iz), () => draw(s, y0));

// A street pump: a tall black iron column on a granite step, its spout over the step on the road
// side, its long handle raised on the other, and a cap with a knob on top.
export const vicStreetPump = vsPiece(0.7, (s, y0) => {
  s.box(0, y0 + 0.06, -0.15, 0.56, 0.12, 0.56, VS_GRANITE);
  s.lathe("vicFoot", VS_FOOT, 0, y0 + 0.12, 0.1, 0.17, 0.3, VS_BLACK, 6);
  s.cyl(0, y0 + 1.05, 0.1, 0.1, 1.5, VS_BLACK, 6);
  s.cyl(0, y0 + 1.83, 0.1, 0.16, 0.06, VS_BLACK, 6);
  s.cyl(0, y0 + 1.9, 0.1, 0.1, 0.08, VS_BLACK, 6);
  s.cyl(0, y0 + 1.98, 0.1, 0.06, 0.08, VS_BLACK, 6);
  s.boxR(0, y0 + 0.9, -0.08, 0.07, 0.07, 0.36, VS_BLACK, -0.4, 0, 0);
  s.boxR(0, y0 + 1.45, 0.42, 0.05, 0.05, 0.7, VS_BLACK, 0.5, 0, 0);
});
// A cast-iron bollard: a short black post with a collar and a knob on top.
export const vicBollard = vsPiece(0.7, (s, y0) => {
  s.cyl(0, y0 + 0.4, 0, 0.12, 0.8, VS_BLACK, 6);
  s.cyl(0, y0 + 0.82, 0, 0.15, 0.06, VS_BLACK, 6);
  s.cyl(0, y0 + 0.92, 0, 0.09, 0.14, VS_BLACK, 4);
});
// For a hydrant: a bollard, as stood along any street, or one time in five a street pump. (A town
// had a pump to a street or two, where a modern one has a hydrant on every pavement: decor.ts.)
export const vicPump: VicPiece = (s, x, z, ix, iz, y0) => (hash2(Math.round(x), Math.round(z), 0, 0x9b1) < 0.2 ? vicStreetPump : vicBollard)(s, x, z, ix, iz, y0);
// A street orderly's dust bin (for a trash can): a timber box with a sloped lid and iron bands.
export const vicDustBin = vsPiece(0.7, (s, y0) => {
  s.box(0, y0 + 0.4, 0, 0.62, 0.8, 0.5, VS_TIMBER);
  for (const y of [0.2, 0.62]) s.box(0, y0 + y, 0, 0.64, 0.05, 0.52, VS_IRON_DARK);
  s.boxR(0, y0 + 0.86, 0, 0.68, 0.06, 0.56, 0x5a3e28, 0.18, 0, 0);
});
// A cast-iron bench (for a bench): scrolled iron ends, timber slats to sit on and to lean on.
export const vicBench = vsPiece(0.7, (s, y0) => {
  for (const k of [-0.82, 0.82]) {
    s.boxR(k, y0 + 0.22, -0.04, 0.06, 0.46, 0.06, VS_IRON, 0.3, 0, 0);
    s.boxR(k, y0 + 0.22, 0.26, 0.06, 0.46, 0.06, VS_IRON, -0.3, 0, 0);
    s.boxR(k, y0 + 0.74, 0.34, 0.06, 0.6, 0.06, VS_IRON, 0.2, 0, 0);
    s.box(k, y0 + 0.64, 0.04, 0.06, 0.05, 0.44, VS_IRON);
  }
  s.box(0, y0 + 0.46, 0.12, 1.8, 0.05, 0.4, VS_TIMBER);
  for (const y of [0.66, 0.86]) s.boxR(0, y0 + y, 0.33 + (y - 0.66) * 0.2, 1.8, 0.11, 0.04, VS_TIMBER, 0.2, 0, 0);
});
// A Penfold pillar box (for a mailbox): a red hexagonal column on a plinth, its posting slot under
// a wide cap, and a hexagonal roof with a finial on top.
export const vicPillarBox = vsPiece(0.7, (s, y0) => {
  s.cyl(0, y0 + 0.06, 0, 0.3, 0.12, VS_RED, 6, 0, 0, Math.PI / 6);
  s.cyl(0, y0 + 0.66, 0, 0.26, 1.1, VS_RED, 6, 0, 0, Math.PI / 6);
  s.cyl(0, y0 + 1.26, 0, 0.34, 0.1, VS_RED, 6, 0, 0, Math.PI / 6);
  s.cone(0, y0 + 1.42, 0, 0.32, 0.22, VS_RED, 6, 0, Math.PI / 6);
  s.cone(0, y0 + 1.6, 0, 0.07, 0.16, VS_RED, 4);
  vsPane(s, 0, y0 + 1.15, -0.231, 0.22, 0.04, 0x1a1a1a, 0, -1);
  vsPane(s, 0, y0 + 0.86, -0.231, 0.18, 0.1, VS_GILT, 0, -1);
});
// A newsvendor's stand (for newspaper boxes): a green timber stall with the day's papers on its
// sloped counter and its placard above, and a placard board on the pavement beside it.
export const vicNewsStand = vsPiece(0.7, (s, y0) => {
  s.box(0.25, y0 + 0.5, 0.1, 0.9, 1.0, 0.55, VIC.green);
  s.boxR(0.25, y0 + 1.04, 0.05, 0.94, 0.06, 0.6, 0x3a2e22, -0.25, 0, 0);
  s.box(0.25, y0 + 1.45, 0.36, 0.9, 0.8, 0.05, VIC.green);
  vsPane(s, 0.25, y0 + 1.6, 0.331, 0.78, 0.36, 0xefe8d4, 0, -1);
  vsPane(s, 0.25, y0 + 1.66, 0.328, 0.62, 0.08, 0x1a1a1a, 0, -1);
  vsPane(s, 0.25, y0 + 1.53, 0.328, 0.5, 0.05, 0xa82218, 0, -1);
  // (The placard board: two boards leaning together, the day's headlines pasted on the road side.)
  for (const k of [-1, 1]) s.boxR(-0.5, y0 + 0.45, k * 0.12, 0.5, 0.9, 0.03, 0x3a2e22, k * 0.25, 0, 0);
  s.boxR(-0.5, y0 + 0.5, -0.135, 0.42, 0.6, 0.01, 0xefe8d4, -0.25, 0, 0);
});
// A cast-iron hitching post (for a parking meter): a slim black post with a ring for the reins and
// a knob on top.
export const vicHitchPost = vsPiece(0.45, (s, y0) => {
  s.cyl(0, y0 + 0.5, 0, 0.05, 1.0, VS_BLACK, 6);
  s.cone(0, y0 + 1.04, 0, 0.07, 0.1, VS_BLACK, 4);
  s.box(0, y0 + 0.86, -0.08, 0.02, 0.12, 0.12, VS_BLACK);
});
// A cabmen's shelter (for a bus shelter): a green timber hut with panelled walls, a band of windows,
// a pitched roof with deep eaves and a little ventilator on its ridge.
export const vicCabShelter = vsPiece(1.05, (s, y0) => {
  s.box(0, y0 + 0.08, 0, 3.5, 0.16, 1.3, 0x5a5550);
  s.box(0, y0 + 1.05, 0, 3.4, 1.8, 1.2, VIC.green);
  s.box(0, y0 + 0.5, 0, 3.44, 0.7, 1.24, 0x23402c);
  for (const side of [-1, 1]) for (const x of [-1.15, 0, 1.15]) {
    vsPane(s, x, y0 + 1.38, side * 0.602, 0.86, 0.6, VIC.cream, 0, side);
    vsPane(s, x, y0 + 1.38, side * 0.605, 0.74, 0.5, VIC.glass, 0, side);
  }
  s.prism(0, y0 + 2.27, 0, 3.9, 0.66, 1.8, 0x3d4740, 0);
  s.box(0, y0 + 2.66, 0, 0.5, 0.26, 0.4, VIC.green);
  s.prism(0, y0 + 2.86, 0, 0.66, 0.16, 0.56, 0x3d4740, 0);
});
// A granite horse trough (for a bike rack): a long trough of dressed granite, brimming, on a plinth.
export const vicTrough = vsPiece(0.7, (s, y0) => {
  s.box(0, y0 + 0.03, 0, 2.1, 0.06, 0.76, 0x7a766e);
  s.box(0, y0 + 0.38, 0, 2.0, 0.64, 0.66, VS_GRANITE);
  s.box(0, y0 + 0.71, 0, 2.04, 0.04, 0.7, 0x9e9a92);
  s.box(0, y0 + 0.732, 0, 1.86, 0.01, 0.52, 0x3c4a52);
});

// ---- the country road --------------------------------------------------------------------------
// vicFingerPost draws a cast-iron finger post at (x, z) on ground y0, its arm facing the way
// (fx, fz) (towards the traffic coming up, which reads it) and reaching from the post towards the
// road (rx, rz): a tall post on a flared foot, its finial a ring and a gilt point, and an arm with
// a pointed end on a bracket. The arm's face is w long and h high with its middle at height y over
// the ground and `reach` from the post; the sign's lettering is a quad of its own on each of the
// arm's two faces (countryworld.ts).
export function vicFingerPost(s: Batch, x: number, z: number, y0: number, fx: number, fz: number, rx: number, rz: number, y: number, w: number, h: number, reach: number) {
  // (Local frame: +z the way the arm faces, +x along the arm, towards the road.)
  const rot = Math.atan2(fx, fz), ax = Math.cos(rot) * rx - Math.sin(rot) * rz, f = Math.sign(ax) || 1;
  vsLocal(s, x, z, rot, () => {
    const top = y + h / 2 + 0.6;
    s.lathe("vicFoot", VS_FOOT, 0, y0, 0, 0.22, 1.1, VS_IRON, 6);
    s.cyl(0, y0 + (top + 1.1) / 2, 0, 0.08, top - 1.1, VS_IRON, 6);
    s.cyl(0, y0 + y - h / 2 - 0.08, 0, 0.12, 0.08, VS_GILT, 6);
    s.cyl(0, y0 + top + 0.2, 0, 0.16, 0.04, VS_IRON, 8, Math.PI / 2);
    s.cone(0, y0 + top + 0.46, 0, 0.08, 0.24, VS_GILT, 4);
    // The arm: its iron core, a raised rim round each face, and its point. Both faces are white for
    // their lettering, the back's 2 cm behind the core (countryworld.ts letters both).
    const c = f * reach;
    s.box(c, y0 + y, -0.02, w, h + 0.08, 0.05, VS_IRON_DARK);
    s.boxR(c + f * (w / 2 + 0.12), y0 + y, -0.02, 0.24, 0.24, 0.05, VS_IRON_DARK, 0, 0, Math.PI / 4);
    for (const z of [0.01, -0.055]) {
      s.box(c, y0 + y, z, w - 0.04, h + 0.02, 0.02, VS_BOARD);
      s.boxR(c + f * (w / 2 + 0.1), y0 + y, z, 0.2, 0.2, 0.02, VS_BOARD, 0, 0, Math.PI / 4);
    }
    // (Its bracket under the arm, from the post out.)
    s.boxR(f * 0.35, y0 + y - h / 2 - 0.2, -0.02, 0.05, 0.7, 0.05, VS_IRON, 0, 0, -f * 0.9);
  });
}

// ---- the setts and the flags ---------------------------------------------------------------------
// A Victorian street's road and junctions are granite setts, and its pavements York stone flags.
// city.ts tags their ground (aux.z VIC_SETT or VIC_FLAGS, aux.xy the way along the street in the
// world), and applySetts draws the stones on the ground's material from the world position.
// Both are laid in rows, broken bond: setts in courses across the road, flags in courses along the
// kerb. Each row's width and each stone's length vary about the sizes STONES gives (irr: the share
// of a size a joint may stray), so a course of flags reads as quarried stone laid by hand. Each
// stone is a little lighter or darker than the next, with joints between. A flag also takes a warm
// or cool cast, a mottle, edges worn darker, and now and then a crack across it. Each way on its
// own, as a low camera sees the ground foreshortened, a joint is drawn at least about a pixel wide,
// and the pattern fades to the stones' mean tone where a stone comes to less than about two pixels
// that way, so far streets read as even stone and never shimmer.
export const VIC_SETT = -7, VIC_FLAGS = -8;
// In the rain (SETT_WET: how wet, 0..1, set each frame from the weather: main.ts) the stones darken as
// wet stone does and take a sheen of the sky's colour, strongest at a grazing look (Schlick's
// Fresnel): over each stone's crown and not in its joints, and most where water stands in a
// hollow of the setts (puddles at random, a few metres across).
export const SETT_WET = { value: 0 };
// (Per kind: size along the street and across it, m; how far a row's and a stone's joints may stray;
// the tone's spread; how dark a joint is; the joint's width, m; and the pixel's share of a stone over
// which the pattern fades.)
const STONES = {
  sett: { u: 0.25, v: 0.4, rowIrr: 0.1, irr: 0.2, lo: 0.88, hi: 1.1, joint: 0.6, jw: 0.02, fade: [0.18, 0.42] },
  flag: { u: 1.0, v: 0.7, rowIrr: 0.6, irr: 0.7, lo: 0.82, hi: 1.1, joint: 0.62, jw: 0.012, fade: [0.12, 0.35] },
};
const glsl = (x: number) => x.toFixed(3);
const SETT_GLSL = `
float stHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float stHash2(vec2 v) { return fract(sin(dot(mod(v, 1024.0), vec2(12.9898, 78.233))) * 43758.5453); }
// (Joint k of a row of stones a unit long, strayed by up to irr / 2 either way; the stone t falls in:
// its index, and how far t is past its near joint and short of its far one, in units.)
float stJoint(float k, float irr, float seed) { return k + (stHash(mod(k, 4096.0) * 1.73 + seed) - 0.5) * irr; }
vec3 stCell(float t, float irr, float seed) {
  float k = floor(t), b0 = stJoint(k, irr, seed), b1 = stJoint(k + 1.0, irr, seed);
  if (t < b0) { b1 = b0; b0 = stJoint(k - 1.0, irr, seed); k -= 1.0; }
  else if (t > b1) { b0 = b1; b1 = stJoint(k + 2.0, irr, seed); k += 1.0; }
  return vec3(k, t - b0, b1 - t);
}
float stNoise(vec2 q) {
  vec2 i = floor(q), f = fract(q); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(stHash2(i), stHash2(i + vec2(1.0, 0.0)), f.x), mix(stHash2(i + vec2(0.0, 1.0)), stHash2(i + vec2(1.0, 1.0)), f.x), f.y);
}`;
export function applySetts(mat: THREE.Material, sky: THREE.Color) {
  const prev = mat.onBeforeCompile.bind(mat), prevKey = mat.customProgramCacheKey.bind(mat);
  const S = STONES.sett, F = STONES.flag;
  const pick = (k: keyof typeof S) => `(sett > 0.5 ? ${glsl(S[k] as number)} : ${glsl(F[k] as number)})`;
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uSettWet = SETT_WET; shader.uniforms.uSettSky = { value: sky };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aAux;\nvarying vec3 vSettAux;\nvarying vec2 vSettXZ;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSettAux = aAux; vSettXZ = (modelMatrix * vec4(transformed, 1.0)).xz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSettAux;\nvarying vec2 vSettXZ;\nuniform float uSettWet;\nuniform vec3 uSettSky;" + SETT_GLSL)
      .replace("#include <color_fragment>", `#include <color_fragment>
  float stShine = 0.0;   // (the wet sheen's strength here: emissivemap_fragment below)
  float sett = abs(vSettAux.z - (${glsl(VIC_SETT)})) < 0.5 ? 1.0 : 0.0, flag = abs(vSettAux.z - (${glsl(VIC_FLAGS)})) < 0.5 ? 1.0 : 0.0;
  // (Where the stones lie: x along the street, y across it; and a pixel's size on the ground each
  // way, m. Both before the branch, as a derivative is undefined in one.)
  vec2 d = length(vSettAux.xy) > 0.5 ? normalize(vSettAux.xy) : vec2(1.0, 0.0);
  vec2 p = vec2(dot(vSettXZ, d), dot(vSettXZ, vec2(-d.y, d.x)));
  vec2 px = vec2(fwidth(p.x), fwidth(p.y));
  // (Only on the ground's tops: a tagged box's sides, such as a pavement's at a driveway, are plain stone.)
  if (dot(normalize(vNormal), (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz) < 0.5) sett = flag = 0.0;
  if (sett + flag > 0.5) {
    vec2 size = sett > 0.5 ? vec2(${glsl(S.u)}, ${glsl(S.v)}) : vec2(${glsl(F.u)}, ${glsl(F.v)});
    // (The rows: courses across the road (by x) for setts, along the kerb (by y) for flags; then the
    // stones along each row, its joints set off by the row.)
    float rowSize = sett > 0.5 ? size.x : size.y, stoneSize = sett > 0.5 ? size.y : size.x;
    vec3 R = stCell((sett > 0.5 ? p.x : p.y) / rowSize, ${pick("rowIrr")}, 0.0);
    vec3 C = stCell((sett > 0.5 ? p.y : p.x) / stoneSize + stHash(R.x * 3.1), ${pick("irr")}, R.x * 7.7);
    vec2 id = vec2(R.x, C.x);
    float h = stHash2(id);
    // (How far from the stone's joints, m, each way: x along the street, y across.)
    vec2 eR = vec2(R.y, R.z) * rowSize, eC = vec2(C.y, C.z) * stoneSize;
    vec2 e = sett > 0.5 ? vec2(min(eR.x, eR.y), min(eC.x, eC.y)) : vec2(min(eC.x, eC.y), min(eR.x, eR.y));
    // (How much of the pattern shows each way.)
    vec2 fade = sett > 0.5 ? vec2(${glsl(S.fade[0])}, ${glsl(S.fade[1])}) : vec2(${glsl(F.fade[0])}, ${glsl(F.fade[1])});
    vec2 show = 1.0 - smoothstep(vec2(fade.x), vec2(fade.y), px / size);
    vec2 jw = max(vec2(${pick("jw")}), 0.7 * px);
    float joint = max((1.0 - smoothstep(jw.x * 0.5, jw.x * 1.25, e.x)) * show.x, (1.0 - smoothstep(jw.y * 0.5, jw.y * 1.25, e.y)) * show.y);
    float detail = max(show.x, show.y), inner = min(show.x, show.y);
    vec3 tone = vec3(mix(${pick("lo")}, ${pick("hi")}, h));
    if (flag > 0.5) {
      // (A flag's cast, warm or cool; its mottle; its edges worn darker; and a crack across one in
      // six, from side to side of its row at a slant.)
      tone *= mix(vec3(1.05, 1.0, 0.93), vec3(0.95, 0.99, 1.05), stHash2(id + 17.0));
      tone *= 0.93 + 0.14 * stNoise(p * 4.0 + id * 5.3);
      tone *= 1.0 - 0.1 * (1.0 - smoothstep(0.0, 0.09, min(e.x, e.y)));
      if (stHash2(id + 3.0) > 0.83) {
        float len = (C.y + C.z) * stoneSize, w = (R.y + R.z) * rowSize, slope = (stHash2(id + 9.0) - 0.5) * 1.6;
        float u = C.y * stoneSize - len * (0.3 + 0.4 * stHash2(id + 11.0)), v = R.y * rowSize - w * 0.5;
        float cw = max(0.008, 0.6 * min(px.x, px.y));
        joint = max(joint, (1.0 - smoothstep(cw * 0.5, cw * 1.25, abs(u - v * slope) / sqrt(1.0 + slope * slope))) * inner * 0.8);
      }
    }
    tone = mix(vec3(1.0), tone, inner) * mix(1.0, ${pick("joint")}, joint);
    diffuseColor.rgb *= mix(vec3(sett > 0.5 ? 0.95 : 0.97), tone, detail);
    if (uSettWet > 0.0) {
      float puddle = sett > 0.5 ? smoothstep(0.52, 0.64, stNoise(vSettXZ * 0.3 + 31.0)) : 0.0;
      diffuseColor.rgb *= mix(1.0, 0.62 - 0.2 * puddle, uSettWet);
      stShine = uSettWet * mix(0.7, 1.6, puddle) * (1.0 - joint * (1.0 - puddle));
    }
  }`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  if (stShine > 0.0) totalEmissiveRadiance += uSettSky * stShine * (0.06 + 0.94 * pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 4.0));`);
  };
  mat.customProgramCacheKey = () => prevKey() + "|setts-v12";
  mat.needsUpdate = true;
}
