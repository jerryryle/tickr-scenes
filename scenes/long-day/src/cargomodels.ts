// 3D models for the cargo types (concept doc, "Goods catalog"), as Batch builders: each one
// writes a few coloured primitives with its bottom centre at (x, y, z), so a whole load (a hand
// truck's stack, a pallet, the truck bed) merges into one mesh. Models face +x (length along x,
// width along z). Round loads (`round`) stand on edge with their axle along z so they roll
// forward. `variant` varies colours between units.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { boatAt, boatExtent } from "./boats.ts";

interface CargoModel {
  size: [number, number, number];     // length (x), height (y), width (z)
  build(b: Batch, x: number, y: number, z: number, variant: number, noLegs?: boolean): void;
  // Animals: leg layout, so the herd can animate legs built separately (build with noLegs).
  legs?: { lx: number; lz: number; h: number; t: number; color: (variant: number) => number };
  round?: boolean;                     // rolls (radius = height / 2)
  palletized?: boolean;                // already sits on its own pallet
  dunnage?: number;                    // rides on blocks this high, with room between them for forks
}

const CK = {
  card: 0xb07a45, tape: 0xd8c08a, white: 0xeeeee8, black: 0x1c1c1e, steel: 0x9aa0a6, wood: 0xa47a4a, darkWood: 0x6b4a2c,
  red: 0xc0392b, blue: 0x1f5fb0, yellow: 0xf2c200, green: 0x2e8b57, orange: 0xe67e22, pink: 0xf08bb4, gold: 0xd4af37,
};
const TRAILER_SAILER = { scale: 0.5, mastDown: true }, JETSKI = { scale: 0.8 };
const vpick = <T,>(a: T[], i: number) => a[((i % a.length) + a.length) % a.length];

function carton(b: Batch, x: number, y: number, z: number, l: number, h: number, w: number, tape = CK.tape, color = CK.card) {
  b.box(x, y + h / 2, z, l, h, w, color);
  b.box(x, y + h + 0.003, z, l * 0.98, 0.006, 0.06, tape);
}
function pallet(b: Batch, x: number, y: number, z: number, l = 1.2, w = 1.0) {
  b.box(x, y + 0.025, z, l, 0.05, w, CK.wood);
  for (const zz of [-w * 0.4, 0, w * 0.4]) b.box(x, y + 0.08, z + zz, l, 0.06, 0.12, CK.darkWood);
  b.box(x, y + 0.13, z, l, 0.03, w, CK.wood);
}
// Blocks under a long bundle near its ends, so a forklift's forks slide in between them.
const DUNNAGE = 0.1;
function dunnage(b: Batch, x: number, y: number, z: number, w: number) {
  for (const xx of [-1.35, 1.35]) b.box(x + xx, y + DUNNAGE / 2, z, 0.1, DUNNAGE, w, CK.darkWood);
}
// Legs for animals: 4 posts swinging handled by the crew (static here).
function legs4(b: Batch, x: number, y: number, z: number, lx: number, lz: number, h: number, t: number, color: number) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(x + sx * lx, y + h / 2, z + sz * lz, t, h, t, color);
}

const GOAT_COLORS = [0xeeeee8, 0x8a6a4a, 0x3a3a3a];

export const CARGO_MODELS: Record<string, CargoModel> = {
  // ---- common ----
  boxes: { size: [0.55, 0.42, 0.45], build: (b, x, y, z, i) => carton(b, x, y, z, 0.55, 0.42 - (i % 2) * 0.08, 0.45) },
  parcels: { size: [0.42, 0.3, 0.36], build: (b, x, y, z, i) => carton(b, x, y, z, 0.42, 0.3, 0.36, vpick([CK.red, CK.blue, CK.yellow], i)) },
  pallets: { size: [1.2, 1.1, 1.0], palletized: true, build: (b, x, y, z) => {
    pallet(b, x, y, z); b.box(x, y + 0.6, z, 1.12, 0.92, 0.94, 0xd9dcd2);
    for (const yy of [0.35, 0.65, 0.95]) b.box(x, y + yy, z, 1.13, 0.01, 0.95, 0xb8bcb4);
  } },
  carTires: { size: [0.66, 0.66, 0.22], round: true, build: (b, x, y, z) => {
    b.cyl(x, y + 0.33, z, 0.33, 0.22, CK.black, 12, Math.PI / 2); b.cyl(x, y + 0.33, z, 0.17, 0.23, 0xb8bcc2, 8, Math.PI / 2);
  } },
  // A bolt of knitting is a fat roll of striped knit on its edge, wound in the works' dyes.
  knitwear: { size: [0.8, 0.8, 1.1], round: true, build: (b, x, y, z, i) => {
    const pair = vpick([[CK.pink, CK.white], [0x6fe0e8, CK.white], [0xf2c230, CK.red], [CK.pink, 0x6fe0e8]], i);
    for (let k = 0; k < 5; k++) b.cyl(x, y + 0.4, z - 0.44 + k * 0.22, 0.4 - (k % 2) * 0.01, 0.222, pair[k % 2], 12, Math.PI / 2, 0, k * 0.26);
    b.cyl(x, y + 0.4, z, 0.08, 1.12, 0x6b4a2c, 6, Math.PI / 2);
  } },
  // ---- the storybook city's wonders (cargo.ts STORY_CARGO) ----
  // Bottled rainbows are a pale crate of six jars, each a rainbow in bands under a cork.
  rainbowJars: { size: [0.5, 0.36, 0.4], build: (b, x, y, z, i) => {
    b.box(x, y + 0.08, z, 0.5, 0.16, 0.4, vpick([0xfff3dc, 0xffd9e0, 0xd8f4ff], i));
    b.box(x, y + 0.155, z, 0.52, 0.03, 0.42, vpick([0xff7fb5, 0x6fe0e8, 0xf2c230], i));
    const bands = [0xe8333a, 0xff9a2e, 0xf2c230, 0x5fd3a0, 0x4f9cf0, 0x9a6cf0];
    for (let a = 0; a < 3; a++) for (let c = 0; c < 2; c++) {
      const jx = x - 0.15 + a * 0.15, jz = z - 0.09 + c * 0.18;
      for (let k = 0; k < 6; k++) b.cyl(jx, y + 0.135 + k * 0.03 + 0.015, jz, 0.055 - (k % 2) * 0.002, 0.03, bands[(k + a + c + i) % 6], 8);
      b.cyl(jx, y + 0.33, jz, 0.045, 0.06, 0xa47a4a, 6);
    }
  } },
  // Giant lollipops are three swirled discs on sticks standing in a striped tub.
  lollipops: { size: [0.5, 0.95, 0.7], build: (b, x, y, z, i) => {
    b.cyl(x, y + 0.13, z, 0.2, 0.26, vpick([0xff7fb5, 0x6fe0e8, 0xf2c230], i), 10);
    b.cyl(x, y + 0.24, z, 0.21, 0.05, CK.white, 10);
    const cols = [[0xff5a4e, CK.white], [0x9a6cf0, 0xfbe58a], [0x5fd3a0, 0xff7fb5]];
    // (They fan out: the middle one is tallest, and the others lean away from it.)
    [-1, 0, 1].forEach((s, k) => {
      const [a, c] = vpick(cols, i + k), hy = y + (k === 1 ? 0.76 : 0.62), dx = s * 0.06, dz = s * 0.17;
      b.cyl(x + dx * 0.5, (y + 0.2 + hy) / 2, z + dz * 0.5, 0.015, hy - y - 0.2, CK.white, 5, s * 0.25);
      for (let r = 0; r < 4; r++) b.cyl(x + dx + 0.003 * r, hy, z + dz, 0.17 - r * 0.038, 0.05 + r * 0.004, r % 2 ? c : a, 12, 0, Math.PI / 2);
    });
  } },
  // Cloud cushions are a puffy cloud, white with a blush of colour underneath.
  cloudCushions: { size: [0.7, 0.42, 0.5], build: (b, x, y, z, i) => {
    const under = vpick([0xffd9e0, 0xd8f4ff, 0xfff3c8], i);
    b.ico(x, y + 0.13, z, 0.26, under, 0.5);
    for (const [dx, dy, dz, r] of [[-0.2, 0.2, 0.02, 0.17], [0.01, 0.25, -0.04, 0.2], [0.21, 0.19, 0.03, 0.15], [-0.04, 0.2, 0.13, 0.13], [0.07, 0.17, -0.15, 0.12]] as const)
      b.ico(x + dx, y + dy, z + dz, r, 0xfffdf8, 0.9);
  } },
  // Wind-up toys are a striped crate with a big brass key on top and a tin toy peeping out.
  windupToys: { size: [0.5, 0.42, 0.45], build: (b, x, y, z, i) => {
    const c = vpick([0x9a6cf0, 0x1fb5b0, 0xff5a4e], i);
    b.box(x, y + 0.14, z, 0.5, 0.28, 0.45, c);
    for (const dx of [-0.17, 0, 0.17]) b.box(x + dx, y + 0.15, z, 0.06, 0.28, 0.47, 0xfff3dc);   // (these are bands round it, clearly proud: a hair off its faces flickers)
    b.cyl(x, y + 0.31, z, 0.03, 0.08, 0xd4af37, 6);
    b.box(x, y + 0.38, z, 0.04, 0.08, 0.26, 0xd4af37);
    for (const dz of [-0.1, 0.1]) b.cyl(x, y + 0.38, z + dz, 0.06, 0.04, 0xd4af37, 8, Math.PI / 2);
  } },
  // Balloon bunches are three balloons on ribbons over a little weight.
  balloons: { size: [0.5, 1.1, 0.5], build: (b, x, y, z, i) => {
    b.box(x, y + 0.06, z, 0.16, 0.12, 0.16, 0xd4af37);
    const cols = [0xff7fb5, 0x6fe0e8, 0xf2c230, 0x9a6cf0, 0x5fd3a0, 0xff5a4e];
    [[-0.12, 0.84, -0.06], [0.1, 0.9, 0.08], [0.0, 0.94, -0.1]].forEach(([dx, dy, dz], k) => {
      const tx = x + dx, tz = z + dz, ty = y + dy;
      b.cyl((x + tx) / 2, (y + 0.12 + ty - 0.17) / 2, (z + tz) / 2, 0.006, Math.hypot(dx, ty - 0.17 - y - 0.12, dz), 0xfffdf8, 3, Math.atan2(dz, ty - 0.17 - y - 0.12), -Math.atan2(dx, ty - 0.17 - y - 0.12));
      b.ico(tx, ty, tz, 0.15, cols[(k * 2 + i) % cols.length], 1.2);
    });
  } },
  // A music box is a little lacquered box, its lid ajar, with a gold crank on its side.
  musicBoxes: { size: [0.36, 0.28, 0.26], build: (b, x, y, z, i) => {
    const c = vpick([0xd83a9a, 0x2b3f8a, 0x1fb5b0, 0xff9a2e], i);
    b.box(x, y + 0.08, z, 0.36, 0.16, 0.26, c);
    b.box(x - 0.02, y + 0.162, z, 0.32, 0.006, 0.22, 0xfff3dc);
    b.boxR(x + 0.02, y + 0.21, z, 0.36, 0.03, 0.26, c, 0, 0, 0.3);
    b.box(x, y + 0.085, z + 0.134, 0.3, 0.02, 0.006, 0xd4af37);
    b.box(x - 0.12, y + 0.09, z - 0.145, 0.03, 0.03, 0.03, 0xd4af37); b.box(x - 0.12, y + 0.12, z - 0.155, 0.02, 0.06, 0.02, 0xd4af37);
  } },
  truckTires: { size: [1.0, 1.0, 0.3], round: true, build: (b, x, y, z) => {
    b.cyl(x, y + 0.5, z, 0.5, 0.3, CK.black, 14, Math.PI / 2); b.cyl(x, y + 0.5, z, 0.26, 0.31, 0x8a9096, 8, Math.PI / 2);
  } },
  drums: { size: [0.58, 0.58, 0.88], round: true, build: (b, x, y, z, i) => {
    const c = vpick([CK.blue, CK.red], i);
    b.cyl(x, y + 0.29, z, 0.29, 0.88, c, 12, Math.PI / 2);
    for (const zz of [-0.28, 0, 0.28]) b.cyl(x, y + 0.29, z + zz, 0.3, 0.03, 0x163f78, 12, Math.PI / 2);
  } },
  beverages: { size: [0.4, 0.26, 0.3], build: (b, x, y, z, i) => {
    b.box(x, y + 0.13, z, 0.4, 0.26, 0.3, vpick([0xc0392b, 0x2a7fd4, 0x27ae60], i));
    for (const xx of [-0.12, 0, 0.12]) for (const zz of [-0.08, 0.08]) b.box(x + xx, y + 0.27, z + zz, 0.05, 0.03, 0.05, CK.white);
  } },
  kegs: { size: [0.4, 0.58, 0.4], build: (b, x, y, z) => {
    b.cyl(x, y + 0.29, z, 0.2, 0.58, 0xc8ccd0, 10);
    for (const yy of [0.12, 0.46]) b.cyl(x, y + yy, z, 0.21, 0.04, 0x8a9096, 10);
  } },
  produce: { size: [0.5, 0.32, 0.4], build: (b, x, y, z, i) => {
    b.box(x, y + 0.13, z, 0.5, 0.26, 0.4, 0xc49a5a);
    for (const xx of [-0.16, 0, 0.16]) for (const zz of [-0.1, 0.1]) b.ico(x + xx, y + 0.27, z + zz, 0.08, vpick([0xd63c2f, 0xf39c12, 0x58b84a], i));
  } },
  bagged: { size: [1.2, 1.0, 1.0], palletized: true, build: (b, x, y, z, i) => {
    pallet(b, x, y, z);
    for (let k = 0; k < 6; k++) b.box(x + (k % 2 ? 0.02 : -0.02), y + 0.24 + k * 0.14, z, 1.05, 0.13, 0.85, vpick([0xe8e2d0, 0x9a7a52, 0xb0b0a8], i + (k % 2)));
  } },
  paper: { size: [0.45, 0.3, 0.3], build: (b, x, y, z) => { b.box(x, y + 0.15, z, 0.45, 0.3, 0.3, CK.white); b.box(x, y + 0.2, z, 0.455, 0.06, 0.305, 0x2a5fb0); } },
  appliances: { size: [0.75, 1.7, 0.75], build: (b, x, y, z) => { carton(b, x, y, z, 0.75, 1.7, 0.75); b.box(x + 0.376, y + 1.0, z, 0.01, 0.8, 0.5, CK.white); } },
  mattresses: { size: [1.95, 1.05, 0.3], build: (b, x, y, z) => { b.box(x, y + 0.525, z, 1.95, 1.05, 0.3, 0xdfe8f0); b.box(x, y + 0.525, z, 1.96, 1.06, 0.04, 0xb8c8d8); } },   // stood on its long edge: carried and stowed so, as movers do
  restaurantSupply: { size: [0.45, 0.36, 0.4], build: (b, x, y, z) => { carton(b, x, y, z, 0.45, 0.36, 0.4); b.box(x + 0.226, y + 0.2, z, 0.01, 0.1, 0.3, CK.red); } },
  // ---- uncommon ----
  motorcycles: { size: [1.9, 1.15, 0.7], build: (b, x, y, z, i) => {
    // A standard bike: spoked-look wheels with silver rims, raked fork, V-twin with chrome, a
    // shaped tank in the unit's colour, stepped seat, fenders, exhaust, headlamp and bars.
    const paint = vpick([CK.red, CK.blue, 0x111111, 0x2e7d4f, 0xd8d4c8, 0xe0a020], i), chrome = 0xc8ccd0, dark = 0x2a2b2e;
    const R = 0.31, fx = 0.68, rx = -0.66, ay = y + R;
    for (const ax of [fx, rx]) {
      b.cyl(x + ax, ay, z, R, 0.12, CK.black, 14, Math.PI / 2);          // tyre
      b.cyl(x + ax, ay, z, R * 0.68, 0.13, chrome, 12, Math.PI / 2);      // rim
      b.cyl(x + ax, ay, z, R * 0.5, 0.135, dark, 10, Math.PI / 2);        // spokes, in shadow
      b.cyl(x + ax, ay, z, 0.06, 0.16, chrome, 8, Math.PI / 2);           // hub
    }
    // Fork: two raked legs from the front axle up to the steering head.
    const rake = 0.42, headX = fx - 0.24, headY = y + 0.98, legLen = Math.hypot(fx - headX, headY - ay);
    for (const zz of [-0.09, 0.09]) b.boxR(x + (fx + headX) / 2, (ay + headY) / 2, z + zz, 0.045, legLen, 0.045, chrome, 0, 0, rake);
    b.boxR(x + fx - 0.04, ay + R * 0.95, z, 0.36, 0.04, 0.16, paint, 0, 0, -0.35);   // front fender
    // Frame and swingarm.
    b.boxR(x + 0.12, y + 0.72, z, 0.95, 0.06, 0.08, dark, 0, 0, -0.18);                 // backbone
    b.boxR(x + (rx + 0.0) / 2, y + 0.38, z + 0.1, 0.72, 0.05, 0.05, dark, 0, 0, 0.06);   // swingarm
    b.boxR(x + (rx + 0.0) / 2, y + 0.38, z - 0.1, 0.72, 0.05, 0.05, dark, 0, 0, 0.06);
    // Engine: crankcase, two finned cylinders in a V, chrome covers.
    b.box(x + 0.02, y + 0.42, z, 0.42, 0.24, 0.28, 0x6f757b);
    for (const [cx, rz] of [[-0.07, 0.42], [0.13, -0.42]]) {
      b.boxR(x + cx, y + 0.64, z, 0.15, 0.3, 0.2, 0x9aa0a6, 0, 0, rz);
      for (const f of [0.55, 0.62, 0.69]) b.boxR(x + cx + (rz > 0 ? -1 : 1) * (f - 0.55) * 0.35, y + f + 0.02, z, 0.19, 0.02, 0.24, chrome, 0, 0, rz);
    }
    b.cyl(x + 0.02, y + 0.42, z + 0.15, 0.1, 0.03, chrome, 10, Math.PI / 2);         // primary cover
    // Exhaust: down from the cylinders and back along the right side to a chrome muffler.
    b.boxR(x + 0.2, y + 0.42, z + 0.17, 0.05, 0.32, 0.05, chrome, 0, 0, -0.5);
    b.cyl(x - 0.32, y + 0.3, z + 0.2, 0.05, 0.75, chrome, 8, 0, Math.PI / 2);
    b.cyl(x - 0.76, y + 0.33, z + 0.2, 0.065, 0.3, chrome, 8, 0, Math.PI / 2);
    // Tank: a fuller lower half and a rounded top, with a chrome cap.
    b.box(x + 0.22, y + 0.84, z, 0.5, 0.2, 0.3, paint);
    b.box(x + 0.2, y + 0.96, z, 0.4, 0.07, 0.24, paint);
    b.box(x + 0.27, y + 0.15 + 0.85, z, 0.06, 0.02, 0.06, chrome);
    // Seat: rider and passenger steps.
    b.box(x - 0.2, y + 0.83, z, 0.44, 0.09, 0.27, 0x18181a);
    b.box(x - 0.47, y + 0.88, z, 0.2, 0.1, 0.22, 0x18181a);
    // Rear fender over the wheel, a side panel and the tail lamp.
    b.boxR(x + rx + 0.06, ay + R * 0.92, z, 0.5, 0.04, 0.17, paint, 0, 0, 0.3);
    b.box(x - 0.3, y + 0.66, z, 0.3, 0.16, 0.22, paint);
    b.box(x - 0.6, y + 0.83, z, 0.04, 0.05, 0.12, 0xd02018);
    // Steering head: headlamp, bars with grips, and mirrors.
    b.cyl(x + headX + 0.12, headY - 0.02, z, 0.09, 0.08, chrome, 12, 0, Math.PI / 2);
    b.cyl(x + headX + 0.165, headY - 0.02, z, 0.07, 0.01, 0xfff4cc, 12, 0, Math.PI / 2);
    b.box(x + headX - 0.03, headY + 0.08, z, 0.05, 0.04, 0.66, chrome);
    for (const zz of [-0.3, 0.3]) {
      b.box(x + headX - 0.06, headY + 0.08, z + zz, 0.06, 0.05, 0.1, CK.black);
      b.box(x + headX - 0.02, headY + 0.22, z + zz * 0.9, 0.02, 0.18, 0.02, chrome);
      b.box(x + headX - 0.02, headY + 0.32, z + zz * 0.95, 0.03, 0.05, 0.08, chrome);
    }
  } },
  bicycles: { size: [1.3, 0.75, 0.25], build: (b, x, y, z) => { carton(b, x, y, z, 1.3, 0.75, 0.25); b.box(x, y + 0.4, z + 0.126, 0.6, 0.3, 0.01, 0x2a7fd4); } },
  // (A base on short legs, two seat cushions between the arms, the back along +z with two back
  // cushions leaning on it: the seat towards the street, set out on the pavement.)
  sofa: { size: [2.1, 0.85, 0.9], build: (b, x, y, z) => {
    for (const lx of [-0.95, 0.95]) for (const lz of [-0.36, 0.36]) b.box(x + lx, y + 0.04, z + lz, 0.06, 0.08, 0.06, 0x2a1d14);
    b.box(x, y + 0.24, z, 2.1, 0.32, 0.9, 0x2c4470);
    // (The back a cm in from the base's ends and the arms a cm out past them: shared planes flicker.)
    b.box(x, y + 0.6, z + 0.33, 2.08, 0.5, 0.24, 0x2c4470);
    for (const ax of [-0.96, 0.96]) b.box(x + ax, y + 0.53, z - 0.06, 0.2, 0.26, 0.78, 0x3d5a8a);
    for (const cx of [-0.42, 0.42]) {
      b.box(x + cx, y + 0.47, z - 0.1, 0.82, 0.14, 0.62, 0x4a6aa0);
      b.box(x + cx, y + 0.66, z + 0.15, 0.82, 0.36, 0.14, 0x4a6aa0);
    }
  } },
  tvs: { size: [1.3, 0.8, 0.18], build: (b, x, y, z) => { carton(b, x, y, z, 1.3, 0.8, 0.18); b.box(x, y + 0.42, z + 0.091, 1.0, 0.5, 0.01, 0x111111); } },
  lumber: { size: [3.6, 0.65, 1.0], dunnage: DUNNAGE, build: (b, x, y, z, i) => {
    dunnage(b, x, y, z, 1.0);
    const y0 = y + DUNNAGE;
    b.box(x, y0 + 0.27, z, 3.6, 0.55, 1.0, vpick([0xd6b47a, 0xc9a46a], i));
    for (const xx of [-1.2, 0, 1.2]) b.box(x + xx, y0 + 0.275, z, 0.05, 0.6, 1.05, 0x222222);
  } },
  pipe: { size: [3.6, 0.55, 0.9], dunnage: DUNNAGE, build: (b, x, y, z, i) => {
    dunnage(b, x, y, z, 0.9);
    const c = vpick([0xc8743a, 0xe8e8e2], i), y0 = y + DUNNAGE;
    for (let r = 0; r < 3; r++) for (let k = 0; k < 6; k++) b.box(x, y0 + 0.08 + r * 0.14, z - 0.35 + k * 0.14, 3.6, 0.12, 0.12, c);
    for (const xx of [-1.2, 1.2]) b.box(x + xx, y0 + 0.235, z, 0.05, 0.49, 0.95, 0xd03030);
  } },
  serverRacks: { size: [0.65, 2.0, 1.0], build: (b, x, y, z) => {
    b.box(x, y + 1.0, z, 0.65, 2.0, 1.0, 0x1a1c20);
    for (let k = 0; k < 6; k++) b.box(x + 0.326, y + 0.3 + k * 0.28, z - 0.3, 0.01, 0.04, 0.04, 0x2ef06a);
  } },
  xmasTrees: { size: [1.9, 0.6, 0.6], build: (b, x, y, z) => {
    // A netted tree lying down along x, its trunk at the back and its tip at the front.
    b.cyl(x - 0.85, y + 0.3, z, 0.06, 0.25, 0x5a3a24, 6, 0, Math.PI / 2);
    b.cone(x + 0.1, y + 0.3, z, 0.3, 1.7, 0x1f6b3a, 7, 0, 0, -Math.PI / 2);
  } },
  pumpkins: { size: [1.0, 0.95, 1.0], palletized: true, build: (b, x, y, z) => {
    b.box(x, y + 0.35, z, 1.0, 0.7, 1.0, 0x9a7444);
    for (const xx of [-0.25, 0.25]) for (const zz of [-0.25, 0.25]) b.ico(x + xx, y + 0.78, z + zz, 0.2, CK.orange, 0.8);
  } },
  flowers: { size: [0.32, 0.6, 0.32], build: (b, x, y, z, i) => {
    b.cyl(x, y + 0.15, z, 0.15, 0.3, 0x5a6a7a, 8);
    for (let k = 0; k < 5; k++) b.ico(x + Math.cos(k * 1.3) * 0.08, y + 0.42 + (k % 2) * 0.08, z + Math.sin(k * 1.3) * 0.08, 0.07, vpick([0xe84393, 0xfdcb6e, 0xd63031, 0xa29bfe], i + k));
  } },
  frozen: { size: [0.6, 0.42, 0.42], build: (b, x, y, z) => { b.box(x, y + 0.18, z, 0.6, 0.36, 0.42, 0x2a7fd4); b.box(x, y + 0.39, z, 0.62, 0.06, 0.44, CK.white); } },
  medical: { size: [0.55, 0.36, 0.4], build: (b, x, y, z) => {
    b.box(x, y + 0.18, z, 0.55, 0.36, 0.4, CK.white);
    b.box(x + 0.276, y + 0.2, z, 0.01, 0.16, 0.05, CK.red); b.box(x + 0.276, y + 0.2, z, 0.01, 0.05, 0.16, CK.red);
  } },
  // A fish tote: blue, iced, a fish or two showing.
  seafood: { size: [0.6, 0.34, 0.42], build: (b, x, y, z, i) => {
    b.box(x, y + 0.15, z, 0.6, 0.3, 0.42, vpick([0x2a6fb8, 0x2a8fa8], i)); b.box(x, y + 0.305, z, 0.54, 0.02, 0.36, 0xe8f2f6);
    b.box(x - 0.08, y + 0.32, z + 0.05, 0.34, 0.04, 0.09, 0xa8b4bc); b.box(x + 0.1, y + 0.32, z - 0.08, 0.3, 0.035, 0.08, 0x8f9ca6);
  } },
  // Ship's stores on a pallet: cartons, sacks and a coil of rope, wrapped.
  shipStores: { size: [1.2, 1.15, 1.0], palletized: true, build: (b, x, y, z) => {
    pallet(b, x, y, z);
    carton(b, x - 0.28, y + 0.16, z - 0.24, 0.55, 0.42, 0.45); carton(b, x + 0.28, y + 0.16, z - 0.24, 0.55, 0.42, 0.45);
    b.box(x, y + 0.36, z + 0.25, 1.1, 0.4, 0.45, 0xd9cfae);
    carton(b, x - 0.2, y + 0.58, z, 0.6, 0.38, 0.8);
    b.cyl(x + 0.32, y + 0.7, z, 0.26, 0.2, 0xc8a85a, 10); b.cyl(x + 0.32, y + 0.81, z, 0.1, 0.02, 0x8a6a3a, 8);
  } },
  // Nets and rope: a bundle of green net, tied, a coil of rope on top.
  nets: { size: [0.7, 0.45, 0.5], build: (b, x, y, z, i) => {
    b.box(x, y + 0.17, z, 0.7, 0.34, 0.5, vpick([0x3f6f4a, 0x2f5a6a, 0x6a5a2a], i)); b.box(x, y + 0.18, z, 0.06, 0.35, 0.51, 0xc8a85a);
    b.cyl(x + 0.05, y + 0.39, z, 0.2, 0.1, 0xd8c08a, 10); b.cyl(x + 0.05, y + 0.445, z, 0.08, 0.01, 0x8a6a3a, 8);
  } },
  // A surfboard: long, thin, narrower at its nose and tail, a stripe down it (lying flat: no fin
  // under it, which would stand it off the floor).
  surfboards: { size: [2.1, 0.12, 0.55], build: (b, x, y, z, i) => {
    const c = vpick([0xf2f0ea, 0x2aa8c8, 0xf2c200, 0xe86a4a], i);
    b.box(x, y + 0.05, z, 2.0, 0.07, 0.52, c);
    b.box(x + 1.02, y + 0.05, z, 0.08, 0.06, 0.34, c);
    b.box(x - 1.02, y + 0.05, z, 0.06, 0.06, 0.3, c);
    b.box(x, y + 0.087, z, 1.9, 0.004, 0.06, vpick([0xc0392b, 0x1f3a93, 0x2e8b57], i));
  } },
  canoes: { size: [4.2, 0.45, 0.8], build: (b, x, y, z, i) => {   // (boats.ts: a canoe, every third a kayak)
    const kind = i % 3 === 2 ? "kayak" : "canoe";
    boatAt(b, kind, x, y - boatExtent(kind).lo, z, 0, vpick([0x27ae60, 0xd35400, 0xc0392b, 0x1f6fb0], i));
  } },
  vending: { size: [0.9, 1.85, 0.8], build: (b, x, y, z, i) => {
    b.box(x, y + 0.92, z, 0.9, 1.85, 0.8, vpick([CK.red, CK.blue], i));
    b.box(x + 0.451, y + 1.1, z - 0.1, 0.01, 1.1, 0.5, 0x223344);
    for (let k = 0; k < 4; k++) b.box(x + 0.455, y + 0.75 + k * 0.25, z - 0.1, 0.01, 0.06, 0.4, vpick([CK.yellow, CK.green, CK.orange], k));
  } },
  // ---- rare ----
  grandPiano: { size: [1.8, 1.05, 1.5], build: (b, x, y, z) => {
    b.box(x, y + 0.08, z, 1.9, 0.08, 1.6, 0x6a6a6a);                              // piano board
    b.box(x - 0.15, y + 0.6, z, 1.5, 0.9, 1.45, 0x0e0e10);
    b.cyl(x + 0.55, y + 0.6, z - 0.2, 0.6, 0.9, 0x0e0e10, 12);                   // the curve
    b.box(x - 0.89, y + 0.75, z, 0.04, 0.12, 1.3, CK.white);                       // keys edge
  } },
  // An upright piano, its keyboard along x on the +z side: a tall, shallow upper case over a
  // deeper lower one, the keys standing out on a shelf between the cheeks (the side arms), on
  // legs to the floor, with a music desk, a lid, and pedals; polished ebony or mahogany.
  upright: { size: [1.5, 1.3, 0.6], build: (b, x, y, z, i) => {
    const wood = vpick([0x141416, 0x4a2214], i), trim = vpick([0x2a2a2e, 0x6b3a22], i);
    b.box(x, y + 0.65, z - 0.12, 1.5, 1.3, 0.36, wood);                           // upper case, full height
    b.box(x, y + 0.31, z + 0.01, 1.44, 0.62, 0.24, wood);                         // lower case
    b.box(x, y + 0.33, z + 0.135, 1.2, 0.48, 0.01, trim);                         // its front panel
    b.box(x, y + 1.315, z - 0.115, 1.54, 0.03, 0.4, trim);                        // lid
    b.box(x, y + 0.66, z + 0.15, 1.5, 0.05, 0.3, wood);                           // keybed shelf
    b.box(x, y + 0.705, z + 0.17, 1.3, 0.04, 0.2, CK.white);                      // white keys
    for (let k = 0; k < 36; k++) {                                                // black keys, in twos and threes
      const o = k % 5, oct = Math.floor(k / 5), at = oct * 7 + [0.5, 1.5, 3.5, 4.5, 5.5][o];
      b.box(x - 0.65 + (at + 0.5) * (1.3 / 52), y + 0.735, z + 0.125, 0.012, 0.025, 0.11, CK.black);
    }
    b.box(x, y + 0.76, z + 0.07, 1.3, 0.08, 0.04, wood);                          // fallboard, folded back
    b.box(x, y + 0.93, z + 0.075, 1.0, 0.18, 0.02, trim);                         // music desk
    for (const s of [-1, 1]) {
      b.box(x + s * 0.68, y + 0.72, z + 0.15, 0.08, 0.16, 0.3, wood);             // cheeks
      b.box(x + s * 0.68, y + 0.32, z + 0.24, 0.07, 0.64, 0.07, wood);            // legs
    }
    for (const px of [-0.07, 0, 0.07]) b.box(x + px, y + 0.06, z + 0.16, 0.035, 0.02, 0.07, CK.gold);   // pedals
  } },
  arcade: { size: [0.7, 1.8, 0.85], build: (b, x, y, z, i) => {
    b.box(x, y + 0.9, z, 0.7, 1.8, 0.85, vpick([0x6c3483, 0x1f618d, 0x111111], i));
    b.box(x + 0.351, y + 1.25, z, 0.01, 0.45, 0.6, 0x4ad8ff);                    // screen glow
    b.box(x + 0.351, y + 1.65, z, 0.01, 0.16, 0.7, CK.yellow);                    // marquee
    b.box(x + 0.4, y + 0.95, z, 0.15, 0.06, 0.7, 0x333333);
  } },
  hotTub: { size: [2.1, 0.9, 2.1], palletized: true, build: (b, x, y, z) => {
    pallet(b, x, y, z, 2.1, 2.1);
    b.box(x, y + 0.6, z, 2.0, 0.9, 2.0, 0x7a6a5a); b.box(x, y + 1.06, z, 1.9, 0.04, 1.9, 0x3a3a3a);
  } },
  jetSki: { size: [3.0, 1.1, 1.1], build: (b, x, y, z) => {
    b.box(x, y + 0.06, z, 2.6, 0.12, 0.9, 0x555555);                              // stand
    boatAt(b, "jetski", x - 0.05, y + 0.12 - boatExtent("jetski", JETSKI).lo, z, 0, CK.yellow, JETSKI);   // (boats.ts: within its size)
  } },
  cheese: { size: [0.9, 0.9, 0.36], round: true, build: (b, x, y, z) => {
    b.cyl(x, y + 0.45, z, 0.45, 0.36, 0xf4c430, 14, Math.PI / 2); b.cyl(x, y + 0.45, z, 0.46, 0.04, 0xc8961e, 14, Math.PI / 2);
  } },
  // (Four tiers in a box low enough to carry alone: a taller one put its top in the driver's face
  // as they stooped to set it down.)
  cake: { size: [0.7, 0.9, 0.7], build: (b, x, y, z) => {
    b.box(x, y + 0.02, z, 0.72, 0.04, 0.72, 0xd8d8d8);
    for (let k = 0; k < 4; k++) b.cyl(x, y + 0.1 + k * 0.19, z, 0.3 - k * 0.06, 0.17, k % 2 ? 0xfff6e8 : 0xf8e0e8, 12);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(x + sx * 0.35, y + 0.45, z + sz * 0.35, 0.02, 0.9, 0.02, 0xe0f0ff);   // clear box edges
    b.box(x, y + 0.9, z, 0.72, 0.02, 0.72, 0xe0f0ff);
  } },
  gym: { size: [1.8, 1.3, 0.8], build: (b, x, y, z) => {
    b.box(x, y + 0.15, z, 1.8, 0.3, 0.8, 0x2a2a2a); b.box(x, y + 0.31, z, 1.5, 0.02, 0.6, 0x111111);
    for (const sz of [-1, 1]) b.box(x + 0.8, y + 0.8, z + sz * 0.35, 0.06, 1.0, 0.06, 0x888888);
    b.box(x + 0.85, y + 1.28, z, 0.2, 0.15, 0.75, 0x444444);
  } },
  museumCrate: { size: [1.6, 1.4, 1.2], palletized: true, build: (b, x, y, z) => {
    b.box(x, y + 0.7, z, 1.6, 1.4, 1.2, 0xb08a58);
    for (const xx of [-0.78, 0.78]) b.box(x + xx, y + 0.7, z, 0.06, 1.42, 1.22, 0x7a5a38);
    b.box(x, y + 0.9, z + 0.605, 0.9, 0.18, 0.01, CK.red); b.box(x, y + 0.6, z + 0.605, 0.25, 0.25, 0.01, CK.black);   // FRAGILE, arrow
  } },
  // ---- humorous ----
  cow: { size: [2.1, 1.45, 0.62], legs: { lx: 0.6, lz: 0.2, h: 0.65, t: 0.14, color: () => CK.white }, build: (b, x, y, z, _v, noLegs) => {
    b.box(x, y + 1.0, z, 1.6, 0.7, 0.6, CK.white);
    b.box(x - 0.3, y + 1.1, z + 0.302, 0.5, 0.4, 0.01, CK.black); b.box(x + 0.35, y + 0.95, z - 0.302, 0.45, 0.35, 0.01, CK.black);
    b.box(x + 0.95, y + 1.2, z, 0.4, 0.38, 0.36, CK.white); b.box(x + 1.16, y + 1.12, z, 0.08, 0.16, 0.3, CK.pink);     // head, snout
    for (const sz of [-1, 1]) b.box(x + 0.92, y + 1.42, z + sz * 0.17, 0.06, 0.1, 0.06, 0xe8e0c8);                       // horns
    if (!noLegs) legs4(b, x, y, z, 0.6, 0.2, 0.65, 0.14, CK.white);
    b.box(x + 0.15, y + 0.6, z, 0.25, 0.12, 0.2, CK.pink);                                                               // udder
  } },
  goats: { size: [0.9, 0.85, 0.32], legs: { lx: 0.26, lz: 0.1, h: 0.4, t: 0.07, color: (i) => GOAT_COLORS[((i % 3) + 3) % 3] }, build: (b, x, y, z, i, noLegs) => {
    const c = vpick(GOAT_COLORS, i);
    b.box(x, y + 0.55, z, 0.7, 0.32, 0.3, c); b.box(x + 0.4, y + 0.72, z, 0.22, 0.22, 0.18, c);
    for (const sz of [-1, 1]) b.box(x + 0.38, y + 0.86, z + sz * 0.05, 0.04, 0.1, 0.03, 0x666666);
    b.box(x + 0.46, y + 0.6, z, 0.05, 0.1, 0.05, c);                                                                   // beard
    if (!noLegs) legs4(b, x, y, z, 0.26, 0.1, 0.4, 0.07, c);
  } },
  gorilla: { size: [1.4, 2.4, 1.2], build: (b, x, y, z) => {
    b.ico(x, y + 1.05, z, 0.65, 0x4a2a6a, 1.15); b.ico(x + 0.1, y + 1.95, z, 0.36, 0x4a2a6a);
    b.box(x + 0.4, y + 1.95, z, 0.08, 0.2, 0.36, 0x9a7aaa);                                                             // face
    for (const sz of [-1, 1]) { b.box(x + 0.1, y + 1.0, z + sz * 0.72, 0.3, 1.1, 0.3, 0x4a2a6a); b.box(x, y + 0.2, z + sz * 0.3, 0.35, 0.4, 0.3, 0x4a2a6a); }
  } },
  doughnut: { size: [2.6, 2.6, 0.6], build: (b, x, y, z) => {
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      b.ico(x + Math.cos(a) * 0.95, y + 1.3 + Math.sin(a) * 0.95, z, 0.36, 0xd9a066, 1);
      b.ico(x + Math.cos(a) * 0.95, y + 1.3 + Math.sin(a) * 0.95, z + 0.12, 0.3, CK.pink, 1);
    }
    for (let k = 0; k < 10; k++) { const a = k * 0.63; b.box(x + Math.cos(a) * 0.95, y + 1.3 + Math.sin(a) * 0.95, z + 0.4, 0.1, 0.03, 0.03, vpick([CK.yellow, CK.blue, 0x2ecc71, CK.white], k)); }
  } },
  ducks: { size: [1.4, 1.35, 1.2], palletized: true, build: (b, x, y, z) => {
    b.box(x, y + 0.6, z, 1.4, 1.2, 1.2, 0xb08a58); b.box(x, y + 0.9, z + 0.605, 0.8, 0.3, 0.01, CK.yellow);
    for (const xx of [-0.35, 0.3]) for (const zz of [-0.3, 0.25]) { b.box(x + xx, y + 1.28, z + zz, 0.22, 0.18, 0.18, CK.yellow); b.box(x + xx + 0.13, y + 1.3, z + zz, 0.07, 0.04, 0.08, CK.orange); }
  } },
  gnomes: { size: [1.2, 0.7, 1.0], palletized: true, build: (b, x, y, z) => {
    pallet(b, x, y, z);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {
      const gx = x - 0.45 + c * 0.225, gz = z - 0.36 + r * 0.24;
      b.box(gx, y + 0.27, gz, 0.12, 0.2, 0.12, vpick([0x2e86c1, 0x27ae60], r + c)); b.box(gx + 0.05, y + 0.33, gz, 0.04, 0.1, 0.1, CK.white);
      b.cone(gx, y + 0.48, gz, 0.07, 0.22, CK.red, 5);
    }
  } },
  bowling: { size: [0.5, 0.5, 0.5], round: true, build: (b, x, y, z, i) => { b.ico(x, y + 0.25, z, 0.25, vpick([0x1f3a93, 0xc0392b, 0x111111, 0x8e44ad], i)); } },
  penguin: { size: [0.8, 0.9, 0.8], palletized: true, build: (b, x, y, z) => {
    b.box(x, y + 0.45, z, 0.8, 0.9, 0.8, 0xb08a58);
    for (const yy of [0.3, 0.55]) for (const zz of [-0.2, 0, 0.2]) b.box(x + 0.401, y + yy, z + zz, 0.01, 0.06, 0.06, 0x2a1a0a);   // air holes
  } },
  trophy: { size: [0.26, 0.62, 0.26], build: (b, x, y, z) => {
    b.box(x, y + 0.06, z, 0.24, 0.12, 0.24, 0x2a2a2a); b.cyl(x, y + 0.22, z, 0.03, 0.2, CK.gold, 6);
    b.cyl(x, y + 0.45, z, 0.13, 0.26, CK.gold, 10); for (const sz of [-1, 1]) b.box(x, y + 0.48, z + sz * 0.16, 0.03, 0.12, 0.05, CK.gold);
  } },
  envelope: { size: [0.24, 0.02, 0.11], build: (b, x, y, z) => { b.box(x, y + 0.01, z, 0.24, 0.02, 0.11, CK.white); b.box(x + 0.06, y + 0.021, z, 0.04, 0.002, 0.03, CK.red); } },
  sailboat: { size: [5.0, 6.5, 1.6], build: (b, x, y, z) => {
    b.box(x, y + 0.2, z, 4.2, 0.2, 1.0, 0x555555);                                                                    // boat trailer
    for (const sz of [-0.45, 0.45]) b.box(x, y + 0.42, z + sz, 3.2, 0.24, 0.12, 0x3a3a3a);                            // its bunks
    boatAt(b, "sailboat", x - 0.1, y + 0.54 - boatExtent("sailboat", TRAILER_SAILER).lo, z, 0, 0x2a5fb0, TRAILER_SAILER);   // (boats.ts: mast down for the road)
  } },
  toilet: { size: [1.1, 2.3, 1.1], build: (b, x, y, z) => {
    b.box(x, y + 1.1, z, 1.1, 2.2, 1.1, 0x2a7fd4); b.box(x, y + 2.25, z, 1.15, 0.1, 1.15, CK.white);
    b.box(x + 0.556, y + 1.0, z, 0.01, 1.9, 0.8, 0x1f6ab8); b.box(x + 0.56, y + 1.95, z + 0.2, 0.01, 0.12, 0.2, 0x2ecc71);  // door, VACANT
  } },
  // Baton in-jokes.
  teeth: { size: [0.16, 0.24, 0.16], build: (b, x, y, z) => {   // a jar, labelled, full of teeth
    b.cyl(x, y + 0.1, z, 0.08, 0.2, 0xcfe6ee, 10); b.cyl(x, y + 0.215, z, 0.085, 0.03, 0x8a8f94, 10);
    for (let i = 0; i < 9; i++) b.box(x + Math.cos(i * 2.4) * 0.04, y + 0.03 + (i % 4) * 0.04, z + Math.sin(i * 2.4) * 0.04, 0.025, 0.03, 0.022, 0xfffaf0);
    b.box(x + 0.081, y + 0.11, z, 0.004, 0.06, 0.09, 0xf2f2ea);
  } },
  redPanda: { size: [1.3, 1.9, 1.1], build: (b, x, y, z) => {   // giant plush, sitting
    const fur = 0xc4502a, dark = 0x3a2420, cream = 0xf2e6d6;
    b.ico(x, y + 0.6, z, 0.55, fur, 1.1); b.ico(x + 0.15, y + 0.45, z, 0.35, dark, 1.2);
    b.ico(x + 0.05, y + 1.3, z, 0.4, fur, 0.9); b.ico(x + 0.38, y + 1.24, z, 0.18, cream, 0.8);
    for (const k of [-0.24, 0.24]) { b.ico(x + 0.22, y + 1.36, z + k, 0.1, cream); b.cone(x, y + 1.68, z + k * 1.3, 0.12, 0.22, fur, 5); b.ico(x + 0.36, y + 1.36, z + k * 0.5, 0.035, 0x111111); }
    for (let i = 0; i < 5; i++) b.ico(x - 0.5 - i * 0.08, y + 0.2 + i * 0.16, z - 0.35, 0.2, i % 2 ? cream : fur);
  } },
  capybara: { size: [1.5, 1.3, 0.9], build: (b, x0, y, z) => {   // giant plush: a placid barrel with a square head
    const fur = 0x8a6a48, dark = 0x5a4430, x = x0 - 0.1;   // (centred on its length: its head out no further than its size says)
    b.ico(x - 0.15, y + 0.55, z, 0.6, fur, 0.95);
    b.box(x + 0.5, y + 0.85, z, 0.6, 0.5, 0.5, fur); b.box(x + 0.82, y + 0.78, z, 0.08, 0.32, 0.42, dark);
    for (const k of [-0.2, 0.2]) { b.ico(x + 0.42, y + 1.14, z + k, 0.08, dark); b.ico(x + 0.7, y + 0.95, z + k, 0.035, 0x111111); }
    for (const sx of [-0.45, 0.25]) for (const sz of [-0.3, 0.3]) b.box(x + sx, y + 0.1, z + sz, 0.16, 0.2, 0.16, dark);
  } },
  frog: { size: [1.6, 1.6, 1.5], build: (b, x, y, z) => {       // inflatable, slightly smug
    const g = 0x3fae49;
    b.ico(x, y + 0.65, z, 0.75, g, 0.85);
    for (const k of [-0.38, 0.38]) { b.ico(x + 0.35, y + 1.25, z + k, 0.24, g); b.ico(x + 0.48, y + 1.3, z + k, 0.14, 0xffffff); b.ico(x + 0.58, y + 1.31, z + k, 0.07, 0x111111); }
    b.box(x + 0.62, y + 0.8, z, 0.04, 0.05, 0.7, 0x1d5e24);
    for (const k of [-0.55, 0.55]) b.ico(x + 0.4, y + 0.1, z + k, 0.25, g, 0.5);
  } },
};

// One mesh per model (cached), for single-object use (carried loads, gag props).
const singleCache = new Map<string, THREE.BufferGeometry>();
function cargoMesh(id: string, material: THREE.Material, variant = 0): THREE.Mesh {
  const key = `${id}:${variant}`;
  let g = singleCache.get(key);
  if (!g) {
    const b = new Batch();
    CARGO_MODELS[id].build(b, 0, 0, 0, variant);
    g = b.build(material)!.geometry; g.userData.shared = true;
    singleCache.set(key, g);
  }
  return new THREE.Mesh(g, material);
}
