// This sketch scene is an art-direction study for Long Day's first fantasy city, a storybook town
// of bent, bulging towers, tufted trees on striped trunks, striped contour hills and a contraption
// of a factory, whose people are human but dressed for it. The sketch is not part of the scene. It
// is a diorama built from Long Day's own Batch and Figures so the look can be judged at the board's
// resolution, with a stand-in box truck for scale. It shows one view a second (the last two are at
// dusk). Build and render it with
//   make tool SCENE=long-day TOOL=whimsy SECS=10   -> build/long-day-whimsy/whimsy.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { Figures } from "../src/figure.ts";
import { mulberry32 } from "../src/rng.ts";

type P3 = [number, number, number];
const rnd = mulberry32(0x5e055);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The palette has saturated storybook colours, a warm cream for relief, and black and white for stripes.
const C = {
  coral: 0xff5a4e, red: 0xe8333a, pink: 0xff7fb5, magenta: 0xd83a9a, orange: 0xff9a2e, mustard: 0xf2c230,
  butter: 0xfbe58a, lime: 0xa6e05a, mint: 0x5fd3a0, teal: 0x1fb5b0, aqua: 0x6fe0e8, sky: 0x4f9cf0,
  violet: 0x9a6cf0, plum: 0x6a3a9a, cream: 0xfff3dc, white: 0xffffff, ink: 0x2a2440, navy: 0x2b3f8a,
};
const WALLS = [C.coral, C.pink, C.mustard, C.mint, C.teal, C.violet, C.aqua, C.orange, C.butter, C.lime, C.magenta];
const TRIMS = [C.cream, C.white, C.ink, C.red, C.navy, C.plum];
const TUFTS = [C.pink, C.orange, C.mustard, C.violet, C.magenta, C.coral, C.aqua];
const WIN_DAY = 0x24304a, WIN_LIT = 0xffe08a;

// The main street is a lazy S along x.
const zc = (x: number) => 11 * Math.sin(x / 34) + 4 * Math.sin(x / 13 + 1);
const zcd = (x: number) => (11 / 34) * Math.cos(x / 34) + (4 / 13) * Math.cos(x / 13 + 1);
const ROAD = 4.5, WALK = 3.4;
function frame(x: number) {
  const d = zcd(x), l = Math.hypot(1, d), tx = 1 / l, tz = d / l;
  return { x, z: zc(x), tx, tz, nx: -tz, nz: tx, yaw: -Math.atan2(tz, tx) };
}
// along() gives the point at x offset from the street by `off` (a positive `off` goes towards +z).
function along(x: number, off: number): [number, number] { const f = frame(x); return [f.x + f.nx * off, f.z + f.nz * off]; }

// tube() lays a chain of cylinders through `pts` for pipes, trunks and crooks. Each piece takes its own
// r and colour.
const Y = new THREE.Vector3(0, 1, 0), dv = new THREE.Vector3(), qq = new THREE.Quaternion(), ee = new THREE.Euler();
function tube(b: Batch, pts: P3[], r: (i: number, t: number) => number, col: (i: number) => number, seg = 8) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay, az] = pts[i], [bx, by, bz] = pts[i + 1];
    dv.set(bx - ax, by - ay, bz - az); const L = dv.length(); if (L < 1e-4) continue;
    qq.setFromUnitVectors(Y, dv.normalize()); ee.setFromQuaternion(qq, "XYZ");
    const rr = r(i, i / (pts.length - 1));
    b.cyl((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, rr, L + rr * 0.35, col(i), seg, ee.x, ee.z, ee.y);
  }
}
const curve = (n: number, f: (t: number) => P3) => Array.from({ length: n + 1 }, (_, i) => f(i / n));

// ---- Buildings --------------------------------------------------------------------------------
// A wobbly tower stacks pods up a bending spine, each its own colour and girth (the tower is
// top-heavy as often as not). It has a trim band at each pod's top, portholes and tall windows, an
// arched door facing `face`, and a hat, which is an onion dome, a bent witch's cone, a curly chimney
// or a little ball-and-spike.
function tower(b: Batch, glow: Batch, x: number, z: number, face: number, scale = 1, floors = 2 + Math.floor(rnd() * 4)) {
  const lean = (rnd() - 0.5) * 0.35, dir = rnd() * Math.PI * 2, wob = rnd() * 6;
  let y = 0, R = (2.6 + rnd() * 1.6) * scale;
  const pal = [pick(WALLS), pick(WALLS)], trim = pick(TRIMS), striped = rnd() < 0.3;
  let cx = x, cz = z, topR = R;
  for (let k = 0; k < floors; k++) {
    const h = (3.0 + rnd() * 1.4) * scale;
    const r = k === 0 ? R : Math.max(1.4 * scale, R * (0.75 + rnd() * 0.55));
    const off = lean * y * y / 20 + Math.sin(wob + k) * 0.25;
    cx = x + Math.cos(dir) * off; cz = z + Math.sin(dir) * off;
    const wall = pal[k % 2];
    if (striped) for (let s = 0; s < 4; s++) b.cyl(cx, y + h * (s + 0.5) / 4, cz, r, h / 4 + 0.01, s % 2 ? C.white : wall, 12);
    else b.cyl(cx, y + h / 2, cz, r, h, wall, 12);
    b.cyl(cx, y + h - 0.15, cz, r + 0.35, 0.35, trim, 12);                    // the trim band, a little proud
    if (k > 0) b.ico(cx, y + 0.05, cz, r * 1.02, wall, 0.18);                 // a soft shoulder where it sits
    const nW = Math.max(3, Math.round(r * 1.6));
    for (let i = 0; i < nW; i++) {
      const a = face + (i / nW) * Math.PI * 2 + (k % 2) * 0.4, wx = cx + Math.cos(a) * (r + 0.02), wz = cz + Math.sin(a) * (r + 0.02);
      if (k === 0 && i === 0) {                                               // the door, and its arch
        b.box(wx, 1.1, wz, 0.25, 2.2, 1.2, C.ink, -a); b.cyl(wx, 2.2, wz, 0.6, 0.25, C.ink, 8, 0, Math.PI / 2, -a);
        continue;
      }
      const round = (i + k) % 3 === 0, wy = y + h * 0.52;
      if (round) { b.cyl(wx, wy, wz, 0.5, 0.22, trim, 8, 0, Math.PI / 2, -a); b.cyl(wx + Math.cos(a) * 0.05, wy, wz + Math.sin(a) * 0.05, 0.36, 0.22, WIN_DAY, 8, 0, Math.PI / 2, -a); glow.cyl(wx + Math.cos(a) * 0.07, wy, wz + Math.sin(a) * 0.07, 0.36, 0.22, WIN_LIT, 8, 0, Math.PI / 2, -a); }
      else { b.box(wx, wy, wz, 0.2, 1.5, 0.75, WIN_DAY, -a); b.box(wx, wy + 0.85, wz, 0.25, 0.2, 0.95, trim, -a); glow.box(wx + Math.cos(a) * 0.04, wy, wz + Math.sin(a) * 0.04, 0.2, 1.5, 0.75, WIN_LIT, -a); }
    }
    y += h; topR = r;
  }
  hat(b, glow, cx, y, cz, topR, dir);
  return y;
}
function hat(b: Batch, glow: Batch, x: number, y: number, z: number, r: number, dir: number) {
  const kind = Math.floor(rnd() * 5), c = pick(WALLS), c2 = pick(TRIMS);
  if (kind === 0) {                                                           // onion dome, spike and ball
    b.ico(x, y + r * 0.55, z, r * 1.05, c, 0.9); b.cone(x, y + r * 1.55, z, r * 0.35, r * 0.9, c, 8);
    b.cyl(x, y + r * 2.1, z, 0.06, 0.8, C.ink, 4); b.ico(x, y + r * 2.5, z, 0.3, C.mustard);
  } else if (kind === 1) {                                                    // a witch's hat, bending over
    const n = 6, H = r * 3.2;
    b.cyl(x, y + 0.15, z, r * 1.25, 0.3, c2, 12);
    for (let i = 0; i < n; i++) {
      const t = i / n, t1 = (i + 1) / n, bend = (s: number) => s * s * s * r * 1.4;
      const ax = x + Math.cos(dir) * bend(t), az = z + Math.sin(dir) * bend(t), bx = x + Math.cos(dir) * bend(t1), bz = z + Math.sin(dir) * bend(t1);
      tube(b, [[ax, y + t * H, az], [bx, y + t1 * H, bz]], () => r * (1 - t) * 0.95 + 0.08, () => (i % 2 ? c : c2), 10);
    }
  } else if (kind === 2) {                                                    // a curly chimney with a puff
    b.cyl(x, y + 0.2, z, r * 0.9, 0.4, c2, 12);
    const pts = curve(18, t => [x + Math.cos(t * 9 + dir) * r * 0.35 * (1 - t * 0.5), y + t * r * 2.6, z + Math.sin(t * 9 + dir) * r * 0.35 * (1 - t * 0.5)]);
    tube(b, pts, () => 0.28, i => (i % 3 ? c : C.ink), 6);
    const e = pts[pts.length - 1]; b.cone(e[0], e[1] + 0.3, e[2], 0.5, 0.6, C.ink, 8, Math.PI);
  } else if (kind === 3) {                                                    // a flat cap and a weathervane-ish spring
    b.cyl(x, y + 0.25, z, r * 1.3, 0.5, c, 12); b.cyl(x, y + 0.7, z, r * 0.6, 0.5, c2, 10);
    tube(b, curve(24, t => [x + Math.cos(t * 18) * 0.35, y + 1 + t * 2.4, z + Math.sin(t * 18) * 0.35]), () => 0.07, () => C.ink, 4);
    b.ico(x, y + 3.6, z, 0.45, C.coral);
  } else {                                                                    // a tall stack of shrinking bulbs
    let yy = y, rr = r * 0.8;
    for (let i = 0; i < 4; i++) { b.ico(x + Math.sin(i * 1.7) * 0.3, yy + rr * 0.6, z, rr, i % 2 ? c : c2, 0.75); yy += rr * 1.1; rr *= 0.68; }
    b.cone(x, yy + 0.5, z, 0.15, 1.2, C.ink, 4);
  }
  if (rnd() < 0.5) {                                                          // a pennant
    const px = x + Math.cos(dir) * r * 0.5, pz = z + Math.sin(dir) * r * 0.5, py = y + 0.3;
    b.cyl(px, py + 1.2, pz, 0.05, 2.4, C.ink, 4);
    b.tri(px, py + 2.4, pz, px, py + 1.7, pz, px + 1.3, py + 2.1, pz + 0.2, pick([C.red, C.mustard, C.teal]), [0, 0, 1]);
    b.tri(px, py + 2.4, pz, px + 1.3, py + 2.1, pz + 0.2, px, py + 1.7, pz, pick([C.red, C.mustard, C.teal]), [0, 0, -1]);
  }
  void glow;
}
// A shop row building stacks boxes crooked, each a little off true, and has a striped awning.
function crooked(b: Batch, glow: Batch, x: number, z: number, yaw: number, w: number) {
  const n = 2 + Math.floor(rnd() * 3), fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
  let y = 0, roll = 0, shift = 0, ww = w;
  const c1 = pick(WALLS), c2 = pick(WALLS), trim = pick(TRIMS);
  for (let k = 0; k < n; k++) {
    const h = 3.2 + rnd() * 1.2; roll += (rnd() - 0.5) * 0.22; shift += (rnd() - 0.5) * 1.4 + roll * h;
    ww = k === 0 ? w : ww * (0.75 + rnd() * 0.45);
    const cx = x + fx * shift, cz = z + fz * shift;
    b.boxR(cx, y + h / 2, cz, ww, h, 7, k % 2 ? c2 : c1, 0, yaw, roll);
    b.boxR(cx, y + h, cz, ww + 0.6, 0.35, 7.6, trim, 0, yaw, roll);
    const nw = Math.max(1, Math.floor(ww / 2.4));
    for (let i = 0; i < nw; i++) {
      const u = (i - (nw - 1) / 2) * (ww / nw) + Math.sin(i * 2.3 + k) * 0.2, wy = y + h * 0.5 + Math.sin(i + k) * 0.25;
      const ox = cx + fx * u + rx * 3.53, oz = cz + fz * u + rz * 3.53;
      if (k === 0) continue;
      b.boxR(ox, wy, oz, 0.8, 1.4 + (i % 2) * 0.4, 0.12, WIN_DAY, 0, yaw, roll + Math.sin(i * 3.1) * 0.1);
      glow.boxR(ox + rx * 0.03, wy, oz + rz * 0.03, 0.8, 1.4 + (i % 2) * 0.4, 0.12, WIN_LIT, 0, yaw, roll + Math.sin(i * 3.1) * 0.1);
    }
    if (k === 0) {                                                            // shop window, door and striped awning
      b.box(x + rx * 3.53 - fx * ww * 0.15, 1.5, z + rz * 3.53 - fz * ww * 0.15, ww * 0.5, 1.9, 0.1, WIN_DAY, yaw);
      glow.box(x + rx * 3.56 - fx * ww * 0.15, 1.5, z + rz * 3.56 - fz * ww * 0.15, ww * 0.5, 1.9, 0.1, WIN_LIT, yaw);
      b.box(x + rx * 3.53 + fx * ww * 0.28, 1.2, z + rz * 3.53 + fz * ww * 0.28, 1.1, 2.4, 0.1, C.ink, yaw);
      const ac = pick([C.red, C.teal, C.violet, C.orange]), ns = 7;
      for (let s = 0; s < ns; s++) {
        const u = (s - (ns - 1) / 2) * (ww / ns);
        b.boxR(x + fx * u + rx * 4.3, 3.0, z + fz * u + rz * 4.3, ww / ns + 0.01, 0.08, 1.7, s % 2 ? C.white : ac, 0.35, yaw, 0);
        b.cone(x + fx * u + rx * 5.1, 2.62, z + fz * u + rz * 5.1, ww / ns / 2, 0.4, s % 2 ? C.white : ac, 6, Math.PI);   // scalloped edge
      }
    }
    y += h;
  }
  b.boxR(x + fx * shift, y + 0.8, z + fz * shift, ww * 0.6, 1.6, 4, trim, 0, yaw, roll * 2);   // a lopsided attic
  b.prism(x + fx * shift, y + 2.2, z + fz * shift, ww * 0.7, 1.4, 4.4, pick(WALLS), yaw);
  b.cyl(x + fx * shift + fx * ww * 0.2, y + 2.8, z + fz * shift + fz * ww * 0.2, 0.3, 2.2, C.ink, 6, 0, roll * 4);
}

// ---- Trees and garden -------------------------------------------------------------------------
function tuftTree(b: Batch, x: number, z: number, s = 1, tuft?: number) {
  const H = (5 + rnd() * 5) * s, bend = (rnd() - 0.5) * 3, d = rnd() * 6.3, wig = rnd() * 6;
  const pts = curve(9, t => [x + Math.cos(d) * bend * t * t + Math.sin(t * 7 + wig) * 0.25, t * H, z + Math.sin(d) * bend * t * t]);
  const sc = pick([[C.cream, C.ink], [C.white, C.red], [C.butter, C.orange], [C.cream, C.plum]]);
  tube(b, pts, () => 0.2 * s, i => sc[i % 2], 6);
  const [tx, ty, tz] = pts[pts.length - 1], c = tuft ?? pick(TUFTS);
  for (let i = 0; i < 5; i++) b.ico(tx + Math.cos(i * 1.3) * 0.7 * s, ty + 0.6 * s + Math.sin(i * 2.1) * 0.4 * s, tz + Math.sin(i * 1.3) * 0.7 * s, (1.1 + rnd() * 0.4) * s, c, 0.85, i);
  for (let i = 0; i < 6; i++) b.cone(tx + Math.cos(i) * 1.3 * s, ty - 0.4 * s, tz + Math.sin(i) * 1.3 * s, 0.25 * s, 1.1 * s, c, 4, Math.PI);   // a ragged fringe
}
function pancakeTree(b: Batch, x: number, z: number) {
  const H = 4 + rnd() * 3, bend = (rnd() - 0.5) * 2.2, greens = pick([[C.teal, C.mint], [C.lime, C.mint], [0x3fa06a, C.lime]]);
  const pts = curve(6, t => [x + bend * t * t, t * H, z + Math.sin(t * 4) * 0.4]);
  tube(b, pts, () => 0.3, () => 0x8a5a3a, 6);
  let r = 3.2;
  for (let i = 0; i < 4; i++) { const t = 0.45 + i * 0.2; b.ico(x + bend * t * t, t * H + i * 0.4, z + Math.sin(t * 4) * 0.4, r, greens[i % 2], 0.28, i * 0.7); r *= 0.72; }
  b.ico(x + bend, H + 1.8, z, 0.45, C.red);
}
function spiralTopiary(b: Batch, x: number, z: number, c = C.mint) {
  b.cyl(x, 0.5, z, 0.9, 1.0, C.coral, 10); b.cyl(x, 1.0, z, 1.05, 0.2, C.cream, 10);
  for (let i = 0; i < 16; i++) { const t = i / 16; b.ico(x + Math.cos(t * 14) * 0.9 * (1 - t), 1.4 + t * 4, z + Math.sin(t * 14) * 0.9 * (1 - t), 0.6 * (1 - t * 0.6), c); }
}
function droopTree(b: Batch, x: number, z: number, d: number) {
  const pts = curve(10, t => [x + Math.cos(d) * Math.sin(t * 2.2) * 3.5, Math.sin(t * 1.9) * 8, z + Math.sin(d) * Math.sin(t * 2.2) * 3.5]);
  tube(b, pts, (i, t) => 0.35 * (1 - t * 0.6), () => C.plum, 6);
  const [tx, ty, tz] = pts[pts.length - 1];
  b.ico(tx, ty + 0.4, tz, 1.6, C.violet, 0.8);
  for (let i = 0; i < 9; i++) { const a = i * 0.7; b.cone(tx + Math.cos(a) * 1.4, ty - 1.0 - (i % 3) * 0.4, tz + Math.sin(a) * 1.4, 0.22, 2.2 + (i % 3) * 0.8, C.magenta, 4, Math.PI); }
}
function lamp(b: Batch, glow: Batch, x: number, z: number, d: number) {
  const pts = curve(12, t => t < 0.7 ? [x, t / 0.7 * 4.6, z] : [x + Math.cos(d) * Math.sin((t - 0.7) / 0.3 * Math.PI) * 0.7, 4.6 + Math.sin((t - 0.7) / 0.3 * Math.PI * 0.9) * 0.8, z + Math.sin(d) * Math.sin((t - 0.7) / 0.3 * Math.PI) * 0.7]);
  tube(b, pts, () => 0.09, () => C.ink, 5);
  const [lx, ly, lz] = pts[pts.length - 1];
  b.cone(lx, ly - 0.15, lz, 0.4, 0.4, C.ink, 6);
  b.ico(lx, ly - 0.5, lz, 0.3, WIN_LIT); glow.ico(lx, ly - 0.5, lz, 0.34, 0xfff2b0);
}
function fountain(b: Batch, x: number, z: number) {
  b.cyl(x, 0.35, z, 5, 0.7, C.cream, 16); b.cyl(x, 0.6, z, 4.5, 0.3, C.aqua, 16);
  let y = 0.7, r = 3;
  for (let i = 0; i < 4; i++) {                                               // bowls stacked off true
    const ox = Math.sin(i * 1.9) * 0.6, oz = Math.cos(i * 1.4) * 0.6;
    b.cyl(x + ox, y + 0.9, z + oz, 0.3, 1.8, C.mustard, 6); y += 1.8;
    b.cone(x + ox, y + 0.25, z + oz, r, 0.5, i % 2 ? C.pink : C.teal, 12, Math.PI); b.cyl(x + ox, y + 0.5, z + oz, r * 0.9, 0.12, C.aqua, 12);
    r *= 0.7;
  }
  for (let i = 0; i < 8; i++) {                                               // water arcs
    const a = i / 8 * Math.PI * 2;
    tube(b, curve(6, t => [x + Math.cos(a) * (1 + t * 3.2), y - 3 + Math.sin(t * Math.PI) * 1.8 - t * 2.6 + 2.6, z + Math.sin(a) * (1 + t * 3.2)]), () => 0.09, () => C.aqua, 4);
  }
}

// ---- The knitting works -----------------------------------------------------------------------
// The town's factory lays one process out along the street, left to right. Undyed white tufts are
// picked from an orchard by a gantry claw, lifted by a bucket elevator into a sorting hopper,
// dropped by chutes into three dye vats (the vats are stirred and steam in their colour), piped into
// a barrel-roofed spinning hall, wound as yarn onto spools turned by a row of meshing gears, knitted
// by a circular knitting head into a striped band that runs down a roller table onto a bolt, and
// stacked as bolts on a dock where a truck loads. The function returns its moving parts and its
// steam vents.
const DYES = [C.pink, C.aqua, C.mustard];
const WZ = -38;                                        // the works' centre line, parallel to the street
const SPOOLS = [106, 113.5, 121], SPOOL_Y = 4.5, KNIT_X = 128, BOLT_X = 137.5;
interface Works { anim: (t: number) => void; vents: { o: P3; c: number }[] }
function knittingWorks(scene: THREE.Scene, mat: THREE.Material, b: Batch, glow: Batch): Works {
  const parts: ((t: number) => void)[] = [], vents: { o: P3; c: number }[] = [];
  const part = (make: (m: Batch) => void, x: number, y: number, z: number) => { const m = new Batch(); make(m); const o = m.build(mat)!; o.position.set(x, y, z); scene.add(o); return o; };
  const Z = WZ;
  b.box(89, 0.06, Z - 3, 126, 0.12, 42, 0xf2dcc8);                            // the yard's paving

  // 1. The orchard has rows of white tuft trees and a gantry whose claw carries a tuft to the elevator.
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) if (!(j === 1 && i > 1)) tuftTree(b, 9 + i * 5 + (j % 2) * 2, Z - 9 + j * 9, 0.75, 0xfff8ee);
  for (const x of [6, 30]) for (const dz of [-3, 3]) b.box(x, 5.5, Z + dz, 0.5, 11, 0.5, C.navy);
  b.box(18, 11.2, Z, 25, 0.7, 0.9, C.mustard); for (const x of [6, 30]) b.box(x, 11.2, Z, 0.9, 0.7, 6.8, C.mustard);
  const claw = part(m => {
    m.box(0, 10.5, 0, 1.6, 0.8, 1.4, C.red); m.cyl(0, 8.4, 0, 0.05, 3.6, C.ink, 4);
    for (let k = 0; k < 3; k++) { const a = k * 2.1; m.boxR(Math.cos(a) * 0.5, 6.1, Math.sin(a) * 0.5, 0.15, 1.2, 0.15, C.ink, Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4); }
    m.ico(0, 5.7, 0, 0.75, 0xfff8ee); m.box(0, 6.6, 0, 0.9, 0.3, 0.9, C.ink);
  }, 0, 0, Z);
  parts.push(t => { const s = (Math.sin(t * 0.6) + 1) / 2; claw.position.x = lerp(12, 28.5, s); claw.position.y = -Math.max(0, Math.sin(t * 0.6 - 1.2)) * 1.5; });
  b.box(29.5, 0.5, Z, 3.2, 1, 3.2, C.ink); for (let k = 0; k < 5; k++) b.ico(28.7 + (k % 3) * 0.8, 1.1, Z - 0.6 + (k % 2) * 1.2, 0.6, 0xfff8ee);   // the elevator's pit

  // 2. The bucket elevator runs up to the sorting hopper.
  const A: P3 = [29.5, 0.8, Z], B: P3 = [38, 21, Z], L = Math.hypot(B[0] - A[0], B[1] - A[1]), ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
  for (const dz of [-0.9, 0.9]) tube(b, [[A[0], A[1], Z + dz], [B[0], B[1], Z + dz]], () => 0.18, () => C.navy, 4);
  for (let k = 1; k < 4; k++) { const x = lerp(A[0], B[0], k / 4); b.box(x + 0.6, lerp(A[1], B[1], k / 4) / 2, Z + 1.1, 0.3, lerp(A[1], B[1], k / 4), 0.3, C.navy); }
  b.cyl(B[0], B[1], Z, 1.0, 2.2, C.red, 10, Math.PI / 2); b.cyl(A[0], A[1] + 0.3, Z, 0.8, 2.2, C.red, 10, Math.PI / 2);
  const NB = 14, buckets: { g: THREE.Group; tuft: THREE.Mesh }[] = [];
  for (let k = 0; k < NB; k++) {
    const g = new THREE.Group(), body = part(m => { m.box(0, 0, 0, 1.0, 0.7, 1.3, C.orange); m.box(0, 0.36, 0, 1.05, 0.08, 1.35, C.ink); }, 0, 0, 0);
    const tuft = part(m => m.ico(0, 0.55, 0, 0.55, 0xfff8ee), 0, 0, 0); g.add(body, tuft); scene.add(g); buckets.push({ g, tuft });
  }
  parts.push(t => buckets.forEach(({ g, tuft }, k) => {
    const s = ((t * 1.6 + k * 2 * L / NB) % (2 * L)), up = s < L, d = up ? s : 2 * L - s, side = up ? 0.75 : -0.75;
    g.position.set(A[0] + ux * d - uy * side, A[1] + uy * d + ux * side, Z); g.rotation.set(0, 0, up ? 0 : Math.PI); tuft.visible = up;
  }));

  // 3. The sorting hopper stands on stilts, and a chute runs to each vat.
  const HX = 40;
  for (const [ox, oz] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) b.box(HX + ox, 7.5, Z + oz, 0.4, 15, 0.4, C.navy);
  b.box(HX, 14.2, Z, 3.4, 2.4, 3.4, C.violet); b.cone(HX, 18, Z, 3.4, 4.6, C.orange, 12, Math.PI); b.cyl(HX, 20.4, Z, 3.5, 0.4, C.cream, 12);
  for (let k = 0; k < 9; k++) b.ico(HX + Math.cos(k * 2.4) * 2 * Math.sqrt(k / 9), 20.6, Z + Math.sin(k * 2.4) * 2 * Math.sqrt(k / 9), 0.75, 0xfff8ee);
  const VATS = [47, 54, 61];
  VATS.forEach((vx, k) => tube(b, curve(6, s => [lerp(HX + 1.6, vx - 0.6, s), lerp(13.6, 8.6, s) + Math.sin(s * Math.PI) * 0.8, Z + 1.2 * s]), () => 0.45, i => (i % 2 ? C.cream : DYES[k]), 6));

  // 4. The dye vats stand on legs and are striped, with the dye's surface showing, a stirrer turning
  // in each and a ladder up the front. Water is piped in from a tower behind, and dye is piped out to
  // the spinning hall.
  VATS.forEach((vx, k) => {
    for (const a of [0.8, 2.4, 4.0, 5.6]) b.box(vx + Math.cos(a) * 2.2, 1.5, Z + Math.sin(a) * 2.2, 0.35, 3, 0.35, C.navy);
    for (let s = 0; s < 3; s++) b.cyl(vx, 3 + s * 1.5 + 0.75, Z, 2.7, 1.5, s === 1 ? DYES[k] : C.cream, 14);
    b.cyl(vx, 7.6, Z, 2.95, 0.35, C.ink, 14); b.cyl(vx, 7.45, Z, 2.6, 0.2, DYES[k], 14);
    for (const dx of [-0.45, 0.45]) b.box(vx + dx, 3.8, Z + 2.85, 0.12, 7.6, 0.12, C.ink);
    for (let r = 0; r < 9; r++) b.box(vx, 0.6 + r * 0.8, Z + 2.85, 0.9, 0.08, 0.12, C.ink);
    b.box(vx, 10.3, Z - 0.8, 1.4, 1.2, 1.4, C.red); for (const dx of [-1.6, 1.6]) b.box(vx + dx * 0.9, 8.7, Z - 0.8, 0.2, 2.2, 0.2, C.ink); b.box(vx, 9.6, Z - 0.8, 3.2, 0.2, 0.3, C.ink);
    const stir = part(m => { m.cyl(0, 8.4, 0, 0.12, 3, C.ink, 4); m.box(0, 8.0, 0, 3.2, 0.25, 0.25, C.orange); m.box(1.5, 8.0, 0, 0.25, 0.9, 0.6, C.orange); m.box(-1.5, 8.0, 0, 0.25, 0.9, 0.6, C.orange); }, vx, 0, Z - 0.8);
    parts.push(t => (stir.rotation.y = t * 1.4 + k));
    vents.push({ o: [vx, 8.2, Z], c: DYES[k] });
    tube(b, [[vx, 3.6, Z - 2.4], [vx, 3.6, Z - 4.5 - k * 1.2], [66.2, 3.6 + k * 0.9, Z - 4.5 - k * 1.2]], () => 0.4, i => (i === 1 ? C.ink : DYES[k]), 6);
  });
  const WX = 54, WT = Z - 15;                                                // the water tower
  for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.5; tube(b, curve(5, s => [WX + Math.cos(a) * 3 * (1 - s * 0.5) + Math.sin(s * 5) * 0.4, s * 18, WT + Math.sin(a) * 3 * (1 - s * 0.5)]), () => 0.25, () => C.ink, 4); }
  for (let i = 0; i < 5; i++) b.cyl(WX, 19 + i * 1.3, WT, 4.2 - Math.abs(i - 2) * 0.6, 1.31, i % 2 ? C.white : C.sky, 12);
  b.cone(WX, 26.6, WT, 3.2, 3.2, C.coral, 10); b.ico(WX, 28.5, WT, 0.5, C.mustard);
  tube(b, [[WX, 18.5, WT], [WX, 12.5, WT], [WX, 12.5, Z - 3.2], [VATS[0], 12.5, Z - 3.2]], () => 0.35, () => C.sky, 6);
  tube(b, [[VATS[0], 12.5, Z - 3.2], [VATS[2], 12.5, Z - 3.2]], () => 0.35, () => C.sky, 6);
  for (const vx of VATS) tube(b, [[vx, 12.5, Z - 3.2], [vx, 8.6, Z - 2.2]], () => 0.2, () => C.sky, 4);

  // 5. The spinning hall has a long barrel roof of wobbling red and cream bands, arched windows and
  // two boiler stacks behind. On the ridge stands its sign, a giant ball of yarn run through by needles.
  b.box(83, 4, Z, 34, 8, 24, C.cream); b.box(83, 0.8, Z, 34.3, 1.6, 24.3, C.red);
  for (let i = 0; i < 6; i++) b.cyl(66 + (i + 0.5) * 34 / 6, 8, Z, 12 + (i % 2) * 0.6 + Math.sin(i * 1.7) * 0.3, 34 / 6 + 0.02, i % 2 ? C.cream : C.red, 18, 0, Math.PI / 2);
  for (let i = 0; i < 5; i++) {
    const x = 70.5 + i * 6.25;
    b.box(x, 4.4, Z + 12.05, 3, 4, 0.2, WIN_DAY); b.cyl(x, 6.4, Z + 12.05, 1.5, 0.2, WIN_DAY, 10, Math.PI / 2);
    b.box(x, 2.3, Z + 12.15, 3.6, 0.3, 0.4, C.mustard);
    glow.box(x, 4.4, Z + 12.1, 3, 4, 0.2, WIN_LIT); glow.cyl(x, 6.4, Z + 12.1, 1.5, 0.2, WIN_LIT, 10, Math.PI / 2);
  }
  for (const [sx, H, bend] of [[71, 32, 2.5], [95, 26, -2]] as [number, number, number][]) {
    const pts = curve(12, s => [sx + Math.sin(s * 2.5) * bend * s, s * H, Z - 9]);
    tube(b, pts, (i, s) => 1.3 * (1 - s * 0.25), i => (i % 3 === 2 ? C.ink : C.white), 10);
    const [tx, ty, tz] = pts[pts.length - 1]; b.cyl(tx, ty + 0.3, tz, 1.5, 0.6, C.ink, 10); vents.push({ o: [tx, ty + 0.8, tz], c: 0xfffaf0 });
  }
  const ball = part(m => {
    m.ico(0, 0, 0, 3.4, C.pink); for (let k = 0; k < 4; k++) m.cyl(0, 0, 0, 3.35, 0.25, C.magenta, 14, 0.4 + k * 0.7, k * 0.9);
    m.cyl(0, 0, 0, 0.2, 11, C.mustard, 6, 0, 0.5); m.cyl(0, 0, 0, 0.2, 11, C.mustard, 6, 0.3, -0.6);
    m.ico(Math.sin(0.5) * -5.5, Math.cos(0.5) * 5.5, 0, 0.45, C.red);
    tube(m, curve(10, s => [3.2 + s * 2, -1 - s * 2.5 + Math.sin(s * 6) * 0.4, s * 2]), () => 0.15, () => C.magenta, 4);   // a loose end
  }, 83, 22.5, Z);
  parts.push(t => (ball.rotation.y = Math.sin(t * 0.4) * 0.3));
  for (let k = 0; k < 3; k++) b.box(100.1, 6.5 - k * 0.3, Z - 1 + k, 0.2, 0.7, 0.5, C.ink);   // the yarn's slots

  // 6. Each spool is wound in its dye and turned by a row of meshing gears from a motor on the hall.
  const gearM = (m: Batch, r: number, c: number, teeth: number, phase: number, dz = 0) => {
    m.cyl(0, 0, dz, r, 0.5, c, 18, Math.PI / 2); m.cyl(0, 0, dz + 0.1, r * 0.3, 0.7, C.ink, 10, Math.PI / 2);
    for (let i = 0; i < teeth; i++) { const a = phase + i / teeth * Math.PI * 2; m.boxR(Math.cos(a) * (r + 0.22), Math.sin(a) * (r + 0.22), dz, 0.5, 0.5, 0.5, c, 0, 0, a); }
    for (let i = 0; i < 3; i++) { const a = phase + i / 3 * Math.PI * 2; m.boxR(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, dz + 0.28, r * 0.5, 0.35, 0.1, c === C.navy ? C.cream : C.ink, 0, 0, a); }
  };
  SPOOLS.forEach((sx, k) => {
    for (const dz of [-2.1, 2.1]) for (const dx of [-1.6, 1.6]) b.boxR(sx + dx / 2, SPOOL_Y / 2, Z + dz, 0.35, SPOOL_Y + 0.6, 0.35, C.navy, 0, 0, -dx * 0.18);
    b.cyl(sx, SPOOL_Y, Z, 0.25, 5.6, C.ink, 6, Math.PI / 2);
    const spool = part(m => {
      // The spools are overfilled: the dyed yarn bulges past the flanges, so it reads from the street.
      for (const [dz, r] of [[-1.2, 2.9], [-0.4, 3.25], [0.4, 3.25], [1.2, 2.9]]) m.cyl(0, 0, dz, r, 0.82, DYES[k], 16, Math.PI / 2);
      for (const dz of [-1.65, 1.65]) m.cyl(0, 0, dz, 2.15, 0.2, C.cream, 14, Math.PI / 2);
      for (let i = 0; i < 6; i++) { const a = i * 1.05; m.boxR(Math.cos(a) * 2.85, Math.sin(a) * 2.85, 1.62, 0.5, 0.12, 0.06, C.white, 0, 0, a + 1.2); }   // loose turns of yarn on the face
      gearM(m, 1.9, C.navy, 10, 0, 2.4);
    }, sx, SPOOL_Y, Z);
    parts.push(t => (spool.rotation.z = -t * 0.9));
  });
  // Small gears sit on the spools with idlers between them (the idlers make neighbouring spools turn
  // the same way), and a pinion from a motor on the hall's end drives the first.
  const pin = part(m => gearM(m, 1.2, C.red, 7, 0), SPOOLS[0] - 3.35, SPOOL_Y, Z + 2.4);
  parts.push(t => (pin.rotation.z = t * 0.9 * 1.9 / 1.2));
  b.box(SPOOLS[0] - 3.35, SPOOL_Y, Z + 1.2, 1.6, 1.6, 2, C.violet);
  for (let k = 0; k + 1 < SPOOLS.length; k++) {
    const ix = (SPOOLS[k] + SPOOLS[k + 1]) / 2, idl = part(m => gearM(m, 1.4, C.violet, 8, 0), ix, SPOOL_Y, Z + 2.4);
    b.box(ix, SPOOL_Y / 2, Z + 2.0, 0.3, SPOOL_Y, 0.3, C.navy);
    parts.push(t => (idl.rotation.z = t * 0.9 * 1.9 / 1.4));
  }
  SPOOLS.forEach((sx, k) => tube(b, [[100.2, 6.5 - k * 0.3, Z - 1 + k], [sx - 1.2, SPOOL_Y + 2.7, Z - 1 + k]], () => 0.07, () => DYES[k], 4));
  SPOOLS.forEach((sx, k) => tube(b, [[sx + 0.4, SPOOL_Y + 2.7, Z - 0.6 + k * 0.6], [sx + 1, 10.6, Z - 0.6 + k * 0.6], [KNIT_X, 10.4, Z - 0.4 + k * 0.4]], () => 0.07, () => DYES[k], 4));
  for (const sx of [SPOOLS[0] + 1, SPOOLS[2] + 1]) b.box(sx, 5.3, Z - 2.6, 0.3, 10.6, 0.3, C.navy);
  b.box((SPOOLS[0] + KNIT_X) / 2 + 0.5, 10.8, Z - 2.6, KNIT_X - SPOOLS[0], 0.3, 0.3, C.navy);

  // 7. The circular knitting head sits on its frame, and the striped band it makes runs down a roller
  // table onto a turning bolt. The bolts are stacked on the dock for the truck.
  for (const dx of [-2.8, 2.8]) for (const dz of [-2.8, 2.8]) b.box(KNIT_X + dx, 5.8, Z + dz, 0.4, 11.6, 0.4, C.violet);
  b.box(KNIT_X, 11.6, Z, 6, 0.4, 6, C.violet); b.cone(KNIT_X, 12.6, Z, 1.3, 1.8, C.mustard, 8);
  const head = part(m => {
    m.cyl(0, 0, 0, 2.3, 1.4, C.red, 16); m.cyl(0, 0.8, 0, 2.5, 0.25, C.ink, 16);
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; m.box(Math.cos(a) * 2.1, 1.4, Math.sin(a) * 2.1, 0.08, 0.9, 0.08, C.white); }
  }, KNIT_X, 8.8, Z);
  parts.push(t => (head.rotation.y = t * 2.2));
  b.box((KNIT_X + BOLT_X) / 2 + 0.5, 1.7, Z, BOLT_X - KNIT_X + 1, 0.25, 3.2, C.navy);
  for (let x = KNIT_X + 1; x < BOLT_X; x += 0.9) b.cyl(x, 1.95, Z, 0.22, 3, C.cream, 6, Math.PI / 2);
  for (const x of [KNIT_X + 1, BOLT_X - 1]) for (const dz of [-1.3, 1.3]) b.box(x, 0.8, Z + dz, 0.25, 1.6, 0.25, C.navy);
  let band: THREE.Mesh | null = null;
  const STR = [C.pink, C.white, C.aqua, C.white, C.mustard, C.red];
  parts.push(t => {
    const m = new Batch(), o = t * 0.9, seg = 0.55;
    for (let y = 2.1; y < 8.1; y += seg) { const k = Math.floor((8.1 - y + o) / seg); m.cyl(KNIT_X, y + seg / 2, Z, 1.15, seg + 0.01, STR[((k % 6) + 6) % 6], 10); }
    for (let x = KNIT_X; x < BOLT_X; x += seg) { const k = Math.floor((x - KNIT_X + 6 + o) / seg); m.box(x + seg / 2, 2.15, Z, seg + 0.01, 0.12, 2.6, STR[((k % 6) + 6) % 6]); }
    if (band) { scene.remove(band); band.geometry.dispose(); } band = m.build(mat)!; scene.add(band);
  });
  for (const dz of [-1.9, 1.9]) b.box(BOLT_X, 1.4, Z + dz, 0.4, 2.8, 0.4, C.navy);
  const bolt = part(m => { m.cyl(0, 0, 0, 1.5, 3.0, C.pink, 14, Math.PI / 2); for (const dz of [-1.0, 0, 1.0]) m.cyl(0, 0, dz, 1.52, 0.18, C.white, 14, Math.PI / 2); for (let i = 0; i < 3; i++) m.boxR(0, 0, 1.52, 2.6, 0.2, 0.05, C.ink, 0, 0, i * Math.PI / 3); }, BOLT_X, 2.8, Z);
  parts.push(t => (bolt.rotation.z = -t * 0.9 / 1.5));
  // The dock is a platform under a scalloped canopy, with bolts stacked on it and a truck backed in.
  b.box(145, 0.65, Z, 12, 1.3, 12, C.cream); b.box(145, 1.32, Z + 5.9, 12, 0.1, 0.3, C.mustard);
  for (const dx of [-5.6, 5.6]) for (const dz of [-5.6, 5.6]) b.box(145 + dx, 4, Z + dz, 0.35, 6, 0.35, C.ink);
  for (let i = 0; i < 6; i++) { b.boxR(140 + i * 2 + 1, 7.2 + (i % 2) * 0.3, Z, 2.05, 0.25, 13, i % 2 ? C.white : C.teal, 0, 0, (i % 2 ? 1 : -1) * 0.12); b.cone(140 + i * 2 + 1, 6.75, Z + 6.5, 1, 0.6, i % 2 ? C.white : C.teal, 6, Math.PI); }
  const BC = [[C.pink, C.white], [C.aqua, C.white], [C.mustard, C.red], [C.pink, C.aqua], [C.mustard, C.white], [C.aqua, C.mustard]];
  let n = 0;
  for (const [row, cnt] of [[0, 3], [1, 2], [2, 1]] as [number, number][]) for (let i = 0; i < cnt; i++) {
    const x = 141.5 + i * 2 + row, y = 2.2 + row * 1.6, c = BC[n++ % BC.length];
    for (let s = 0; s < 4; s++) b.cyl(x, y, Z - 2.6 + s * 0.65, 0.85, 0.66, c[s % 2], 10, Math.PI / 2);
  }
  b.box(149, 1.9, Z - 1, 1.2, 1.2, 1.2, C.orange); b.box(149, 3.1, Z - 1, 1.2, 1.2, 1.2, C.violet);
  truck(b, 145, Z + 12, -Math.PI / 2);
  void glow;
  return { anim: t => parts.forEach(p => p(t)), vents };
}

// ---- The truck (a stand-in, for scale) --------------------------------------------------------
function truck(b: Batch, x: number, z: number, yaw: number) {
  const c = Math.cos(yaw), s = -Math.sin(yaw), at = (u: number, v: number): [number, number] => [x + c * u - s * v, z + s * u + c * v];
  let [px, pz] = at(-2.4, 0); b.box(px, 2.45, pz, 7.4, 2.9, 2.5, 0xf4f4f4, yaw);
  [px, pz] = at(-2.4, 1.26); b.box(px, 1.8, pz, 6, 0.35, 0.02, 0xc0282a, yaw);
  [px, pz] = at(2.4, 0); b.box(px, 1.8, pz, 2.2, 2.4, 2.4, 0x23365e, yaw);
  [px, pz] = at(3.45, 0); b.box(px, 2.4, pz, 0.12, 0.8, 2.0, 0x9ab8d0, yaw);
  for (const [u, v] of [[2.5, 1.15], [2.5, -1.15], [-4.2, 1.15], [-4.2, -1.15], [-5.3, 1.15], [-5.3, -1.15]]) { [px, pz] = at(u, v); b.cyl(px, 0.5, pz, 0.5, 0.35, 0x1a1a1a, 10, Math.PI / 2, 0, yaw); }
}

// ---- People: human, dressed for the place -----------------------------------------------------
function dressed(fig: Figures, x: number, z: number, yaw: number, kind: number, phase: number) {
  const SK = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
  const sw = Math.sin(phase) * 0.45, outfit = [C.coral, C.teal, C.violet, C.mustard, C.pink, C.mint, C.orange][kind % 7];
  const pants = [C.ink, C.navy, C.plum, C.red, C.white][(kind * 3) % 5];
  fig.person({ x, z, yaw, y: 0.15, shirt: outfit, pants, skin: SK[kind % 5], hair: 0x2a1a10, legs: [-sw, sw], arms: [sw * 0.7, -sw * 0.7], coat: kind % 3 === 0 ? pick([C.red, C.violet, C.teal]) : undefined, bulk: kind % 4 === 1 ? 1.35 : 1 });
  const [hx, hy, hz] = fig.head, fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw);
  const H = kind % 5;
  if (H === 0) {                                                              // a tall striped stovepipe, bending back
    for (let i = 0; i < 7; i++) fig.box(hx - fx * i * i * 0.012, hy + 0.17 + i * 0.12, hz - fz * i * i * 0.012, 0.2, 0.125, 0.2, yaw, 0.1 + i * 0.05, i % 2 ? C.white : C.red);
    fig.box(hx, hy + 0.13, hz, 0.36, 0.03, 0.36, yaw, 0, C.red);
  } else if (H === 1) {                                                       // a floppy wide-brimmed hat with a tall crown
    fig.box(hx, hy + 0.14, hz, 0.6, 0.03, 0.6, yaw, 0.12, C.mustard);
    for (let i = 0; i < 4; i++) fig.box(hx + rx * i * 0.03, hy + 0.22 + i * 0.1, hz + rz * i * 0.03, 0.22 - i * 0.03, 0.11, 0.22 - i * 0.03, yaw, 0, C.mustard, 0.25 * i);
    fig.box(hx, hy + 0.17, hz, 0.24, 0.05, 0.24, yaw, 0, C.magenta);
  } else if (H === 2) {                                                       // a knitted cap with a long tassel and pompom
    fig.box(hx, hy + 0.15, hz, 0.24, 0.12, 0.23, yaw, 0, C.mint);
    fig.box(hx - fx * 0.1, hy + 0.42, hz - fz * 0.1, 0.05, 0.45, 0.05, yaw, 0.5, C.mint);
    fig.box(hx - fx * 0.24, hy + 0.66, hz - fz * 0.24, 0.14, 0.14, 0.14, yaw, 0, C.pink);
  } else if (H === 3) {                                                       // big curly hair-do, and a bow
    for (let i = 0; i < 4; i++) fig.box(hx + Math.sin(i * 2) * 0.06, hy + 0.18 + i * 0.13, hz + Math.cos(i * 2) * 0.06, 0.3 - i * 0.05, 0.14, 0.3 - i * 0.05, yaw + i * 0.4, 0, 0xc8502a);
    fig.box(hx, hy + 0.68, hz, 0.24, 0.08, 0.06, yaw, 0, C.pink);
  } else {                                                                    // a cap with a propeller... no: a teapot of a hat, spout and all
    fig.box(hx, hy + 0.2, hz, 0.28, 0.2, 0.28, yaw, 0, C.sky);
    fig.box(hx + fx * 0.22, hy + 0.26, hz + fz * 0.22, 0.2, 0.05, 0.05, yaw, -0.6, C.sky);
    fig.box(hx, hy + 0.33, hz, 0.06, 0.06, 0.06, yaw, 0, C.white);
  }
  if (kind % 2 === 0) {                                                       // a long striped scarf, trailing
    for (let i = 0; i < 6; i++) fig.box(hx - fx * (0.12 + i * 0.07) + rx * 0.05, hy - 0.2 - i * 0.09, hz - fz * (0.12 + i * 0.07) + rz * 0.05, 0.08, 0.1, 0.12, yaw, 0.6, i % 2 ? C.white : outfit === C.mustard ? C.red : C.mustard);
  } else fig.box(hx + fx * 0.12, hy - 0.2, hz + fz * 0.12, 0.05, 0.1, 0.3, yaw, 0, C.ink);   // a big bow tie
}

// ---- Views: [camera x, y, z, look x, y, z, fov, dusk] -----------------------------------------
const TRUCK_X = -34;
const WHIMSY_CLIP = 0;   // 1: only the works' views, three seconds each (a clip, rendered every 100 ms)
const CLIP_VIEWS = [2, 3, 4, 5, 6, 9];
const VIEWS: [number, number, number, number, number, number, number, boolean][] = [];

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera;
  let works: Works, glowMesh: THREE.Mesh, sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight;
  let skyDay: THREE.Mesh, skyDusk: THREE.Mesh;
  const puffs: { m: THREE.Mesh; o: P3; k: number; big: boolean }[] = [];
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(36, sys.width / sys.height, 0.3, 1200);
      sun = new THREE.DirectionalLight(0xfff4e0, 2.2); sun.position.set(-50, 70, 60);
      hemi = new THREE.HemisphereLight(0xd8f4ff, 0x6a5a70, 2.1);
      scene.add(sun, hemi);
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      // Two sky domes give a turquoise-to-peach day and a violet-to-tangerine dusk.
      const dome = (top: number, mid: number, low: number) => {
        const g = new THREE.SphereGeometry(900, 24, 16), p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color(), a = new THREE.Color(top), m = new THREE.Color(mid), l = new THREE.Color(low);
        for (let i = 0; i < p.count; i++) { const t = p.getY(i) / 900; if (t > 0.18) c.copy(m).lerp(a, Math.min(1, (t - 0.18) / 0.5)); else c.copy(l).lerp(m, Math.max(0, t / 0.18)); col.set([c.r, c.g, c.b], i * 3); }
        g.setAttribute("color", new THREE.BufferAttribute(col, 3));
        const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })); scene.add(mesh); return mesh;
      };
      skyDay = dome(0x34b6e0, 0x9fe6e0, 0xffe0b0); skyDusk = dome(0x3a2a7a, 0xc0508a, 0xffa050);
      // The ground is flat in town with striped contour hills beyond, and the town's lawns are mown in waves.
      const gg = new THREE.PlaneGeometry(1400, 1400, 200, 200).toNonIndexed(); gg.rotateX(-Math.PI / 2);
      const gp = gg.attributes.position, gc = new Float32Array(gp.count * 3), cc = new THREE.Color();
      const hillCols = [0xa6e05a, 0x5fcf8a, 0xf3e07a, 0x5fcf8a, 0xff9fc0];
      for (let i = 0; i < gp.count; i++) {
        const x = gp.getX(i), z = gp.getZ(i), d = Math.hypot(x * 0.8, z);
        const yard = Math.max(sstep(-30, -5, x) * (1 - sstep(165, 200, x)), 0) * sstep(-100, -75, z) * (1 - sstep(-10, 5, z));   // the knitting works' ground
        const m = sstep(80, 150, d) * sstep(8, 40, Math.abs(z - zc(x))) * (1 - yard);
        const h = m * Math.max(0, 14 + 14 * Math.sin(x / 47) * Math.cos(z / 61) + 9 * Math.sin((x + 2 * z) / 43)) + m * m * 18 * (0.5 + 0.5 * Math.sin(x / 90 + z / 70));
        gp.setY(i, h - 0.02);
        if (m < 0.05) cc.set(Math.sin(x * 0.22 + Math.sin(z * 0.09) * 3) > 0 ? 0x98dc62 : 0x86d058);
        else cc.set(hillCols[((Math.floor((h + 2.5 * Math.sin(x / 47 + z / 61)) / 6) % hillCols.length) + hillCols.length) % hillCols.length]);
        gc.set([cc.r, cc.g, cc.b], i * 3);
      }
      gg.setAttribute("color", new THREE.BufferAttribute(gc, 3)); gg.computeVertexNormals();
      scene.add(new THREE.Mesh(gg, mat));

      const b = new Batch(), glow = new Batch();
      // The street is a purple-grey road with a polka-dot centre line and checkered pavements.
      for (let x = -300; x < 300; x += 2) {
        const f0 = frame(x), f1 = frame(x + 2), k = Math.round((x + 300) / 2);
        const q = (o0: number, o1: number, y: number, col: number) => {
          const a = [f0.x + f0.nx * o0, f0.z + f0.nz * o0], bb = [f0.x + f0.nx * o1, f0.z + f0.nz * o1], c = [f1.x + f1.nx * o1, f1.z + f1.nz * o1], d = [f1.x + f1.nx * o0, f1.z + f1.nz * o0];
          b.tri(a[0], y, a[1], bb[0], y, bb[1], c[0], y, c[1], col); b.tri(a[0], y, a[1], c[0], y, c[1], d[0], y, d[1], col);
        };
        q(-ROAD, ROAD, 0.02, 0x7a6a8c);
        if (Math.abs(x) < 140) {
          for (const sgn of [-1, 1]) {
            q(sgn * ROAD, sgn * (ROAD + WALK / 2), 0.15, k % 2 ? 0xfff1d6 : 0xffc2d4); q(sgn * (ROAD + WALK / 2), sgn * (ROAD + WALK), 0.15, k % 2 ? 0xffc2d4 : 0xfff1d6);
            const a = along(x, sgn * ROAD), c = along(x + 2, sgn * ROAD);       // the kerb's face
            b.tri(a[0], 0, a[1], a[0], 0.15, a[1], c[0], 0.15, c[1], C.cream, [-f0.nx * sgn, 0, -f0.nz * sgn]); b.tri(a[0], 0, a[1], c[0], 0.15, c[1], c[0], 0, c[1], C.cream, [-f0.nx * sgn, 0, -f0.nz * sgn]);
          }
        }
        if (k % 2 === 0) b.cyl(f0.x, 0.03, f0.z, 0.35, 0.03, (k / 2) % 2 ? C.pink : C.mustard, 8);
      }
      // The buildings along it are wobbly towers and crooked shop rows, on both sides.
      for (const sgn of [-1, 1]) {
        let x = -130 + rnd() * 6;
        while (x < 130) {
          const f = frame(x);
          if (sgn < 0 && x > 0 && x < 156) { x += 8; continue; }                // the knitting works' yard
          if (sgn > 0 && x > 6 && x < 30) { x += 8; continue; }                 // the fountain square
          if (rnd() < 0.55) {
            const R = 3.5 + rnd(), [bx, bz] = along(x, sgn * (ROAD + WALK + R + 1.6));
            tower(b, glow, bx, bz, Math.atan2(-f.nz * sgn, -f.nx * sgn), 0.9 + rnd() * 0.35);
            x += R * 2 + 2.5 + rnd() * 3;
          } else {
            const w = 6.5 + rnd() * 3, [bx, bz] = along(x + w / 2, sgn * (ROAD + WALK + 4.2));
            crooked(b, glow, bx, bz, frame(x + w / 2).yaw + (sgn > 0 ? Math.PI : 0), w);
            x += w + 1.2;
          }
          if (rnd() < 0.6) { const [tx, tz] = along(x - 1, sgn * (ROAD + WALK + 1.2)); rnd() < 0.7 ? tuftTree(b, tx, tz, 0.8) : droopTree(b, tx, tz, Math.atan2(-f.nz * sgn, -f.nx * sgn)); }
        }
        for (let x = -120; x < 130; x += 16) { const [lx, lz] = along(x, sgn * (ROAD + 0.6)); lamp(b, glow, lx, lz, Math.atan2(-frame(x).nz * sgn, -frame(x).nx * sgn)); }
      }
      // The second row and beyond hold more towers, trees and a garden of oddities, which thin out.
      for (let i = 0; i < 160; i++) {
        const x = (rnd() - 0.5) * 300, off = (rnd() < 0.5 ? -1 : 1) * (22 + rnd() * 70), [px, pz] = along(x, off);
        if (px > -4 && px < 160 && pz > -84 && pz < -12) continue;
        const k = rnd();
        if (k < 0.3 && Math.abs(off) < 60) tower(b, glow, px, pz, rnd() * 6.3, 1 + rnd() * 0.6, 3 + Math.floor(rnd() * 4));
        else if (k < 0.65) tuftTree(b, px, pz, 1 + rnd() * 0.5);
        else if (k < 0.85) pancakeTree(b, px, pz);
        else if (k < 0.93) spiralTopiary(b, px, pz, pick([C.mint, C.lime, C.teal]));
        else droopTree(b, px, pz, rnd() * 6.3);
      }
      // the fountain square
      { const [fx, fz] = along(18, ROAD + WALK + 9); b.cyl(fx, 0.08, fz, 12, 0.16, 0xfff1d6, 24); fountain(b, fx, fz); spiralTopiary(b, fx - 9, fz + 6); spiralTopiary(b, fx + 9, fz + 6, C.lime); }
      // bunting across the street
      for (const x of [-60, -20, 40]) {
        const a = along(x, -(ROAD + WALK + 1)), c = along(x + 3, ROAD + WALK + 1), n = 14;
        const pts = curve(n, t => [lerp(a[0], c[0], t), 9 - Math.sin(t * Math.PI) * 2.2, lerp(a[1], c[1], t)]);
        tube(b, pts, () => 0.04, () => C.ink, 3);
        for (let i = 0; i < n; i++) { const [px, py, pz] = pts[i], [qx, qy, qz] = pts[i + 1]; b.tri(px, py, pz, qx, qy, qz, (px + qx) / 2, py - 1, (pz + qz) / 2, TUFTS[i % TUFTS.length], [1, 0, 0]); b.tri(px, py, pz, (px + qx) / 2, py - 1, (pz + qz) / 2, qx, qy, qz, TUFTS[i % TUFTS.length], [-1, 0, 0]); }
      }
      // The town gate has two corkscrew columns and a striped arch.
      { const gx = -150, [ax, az] = along(gx, -ROAD - 2), [cx, cz] = along(gx, ROAD + 2);
        for (const [px, pz] of [[ax, az], [cx, cz]]) { tube(b, curve(16, t => [px + Math.cos(t * 12) * 0.5, t * 10, pz + Math.sin(t * 12) * 0.5]), () => 0.55, i => (i % 2 ? C.white : C.red), 8); b.ico(px, 10.6, pz, 1, C.mustard); }
        tube(b, curve(16, t => [lerp(ax, cx, t), 10 + Math.sin(t * Math.PI) * 4, lerp(az, cz, t)]), () => 0.5, i => (i % 2 ? C.white : C.teal), 8);
        b.box((ax + cx) / 2 + 0.6, 11.5, (az + cz) / 2, 0.4, 2.2, 7, C.butter, 0); b.box((ax + cx) / 2 + 0.5, 11.5, (az + cz) / 2, 0.4, 2.6, 7.4, C.magenta, 0);
      }
      // The clouds are curly heaps.
      for (let i = 0; i < 14; i++) {
        const cx = (rnd() - 0.5) * 600, cy = 70 + rnd() * 50, cz = -150 - rnd() * 250;
        for (let j = 0; j < 6; j++) b.ico(cx + j * 5 - 12, cy + Math.sin(j * 1.3) * 3, cz, 5 + Math.sin(j * 2.1) * 2, 0xfffaf0, 0.7, j);
        tube(b, curve(10, t => [cx + 16 + Math.cos(t * 8) * 3 * (1 - t), cy + Math.sin(t * 8) * 3 * (1 - t), cz]), () => 1.2, () => 0xfffaf0, 6);
      }
      // The far spires on the hills are tall bent cones.
      for (let i = 0; i < 9; i++) {
        const a = -2.6 + i * 0.4 + rnd() * 0.2, d = 260 + rnd() * 120, sx = Math.cos(a) * d, sz = Math.sin(a) * d, H = 40 + rnd() * 40;
        tube(b, curve(8, t => [sx + t * t * 14, t * H, sz]), (j, t) => 7 * (1 - t) + 0.6, j => (j % 2 ? pick([C.pink, C.butter]) : C.teal), 8);
      }
      works = knittingWorks(scene, mat, b, glow);
      truck(b, TRUCK_X, zc(TRUCK_X), frame(TRUCK_X).yaw);
      scene.add(b.build(mat)!);
      glowMesh = glow.build(new THREE.MeshBasicMaterial({ vertexColors: true }))!; scene.add(glowMesh);
      // The steam is tinted over the vats and white from the boilers.
      works.vents.forEach(({ o, c }) => { for (let j = 0; j < 6; j++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: c, flatShading: true })); scene.add(m); puffs.push({ m, o, k: j, big: c === 0xfffaf0 }); } });
      // people on the pavements and round the fountain
      const fig = new Figures(scene, mat, 4000);
      fig.begin();
      for (let i = 0; i < 70; i++) {
        const x = -120 + rnd() * 230, sgn = rnd() < 0.5 ? -1 : 1, [px, pz] = along(x, sgn * (ROAD + 0.8 + rnd() * (WALK - 1.4)));
        dressed(fig, px, pz, frame(x).yaw + (rnd() < 0.5 ? 0 : Math.PI), Math.floor(rnd() * 30), rnd() * 6);
      }
      { const [fx, fz] = along(18, ROAD + WALK + 9); for (let i = 0; i < 10; i++) { const a = i * 0.63; dressed(fig, fx + Math.cos(a) * 6.5, fz + Math.sin(a) * 6.5, -a + Math.PI / 2, i, i); } }
      // A line-up for the costume view stands on the plaza's far side.
      for (let i = 0; i < 10; i++) { const [px, pz] = along(-90 + i * 1.3, ROAD + 1.6); dressed(fig, px, pz, frame(-90).yaw - Math.PI / 2, i, 0); }
      fig.end_();

      // The views are built here, once the street is known.
      const t = frame(TRUCK_X), ahead = along(TRUCK_X + 30, 0), [lx, lz] = along(-90 + 6, ROAD + 1.6), fs = along(18, ROAD + WALK + 9), fq = along(4, -ROAD);
      VIEWS.push(
        [TRUCK_X - t.tx * 18, 8.5, zc(TRUCK_X) - t.tz * 18 + 1, ahead[0], 3, ahead[1], 36, false],    // chase: down main street
        [-8, 2.2, zc(-8) + 2, 40, 9, zc(40) - 6, 46, false],                                          // low on the pavement: towers and bunting
        [80, 8, 16, 80, 8, WZ, 44, false],                                                            // the knitting works, whole, from across the street
        [34, 6, 12, 34, 9, WZ, 40, false],                                                            // orchard, elevator, hopper, vats
        [124, 6.5, -9, 122, 6, WZ, 46, false],                                                        // spools, knitting head, bolts, dock
        [53, 7, -21, 52, 8, WZ, 50, false],                                                           // the vats, close
        [113, 4.5, -21, 115, 6, WZ, 52, false],                                                       // the spools and gears, close
        [-150, 70, 150, 20, 0, -10, 40, false],                                                       // over the town and the striped hills
        [lx + 1, 1.6, lz - 5, lx, 1.3, lz, 52, false],                                                // the people, close
        [fq[0], 3.0, fq[1], fs[0], 3.5, fs[1], 50, false],                                            // the fountain square
        [-180, 4, zc(-180) - 3, -140, 8, zc(-140), 40, false],                                        // arriving: the town gate
        [20, 55, 40, 88, 2, WZ, 38, false],                                                           // the works from above
        [TRUCK_X - t.tx * 18, 8.5, zc(TRUCK_X) - t.tz * 18 + 1, ahead[0], 3, ahead[1], 36, true],     // chase, at dusk
        [80, 8, 16, 80, 8, WZ, 44, true],                                                             // the works at dusk
      );
    },
    render(ctx, f) {
      const v = WHIMSY_CLIP ? VIEWS[CLIP_VIEWS[Math.floor(f.t / 3) % CLIP_VIEWS.length]] : VIEWS[Math.floor(f.t) % VIEWS.length], dusk = v[7];
      works.anim(f.t);
      for (const p of puffs) { const s = ((f.t * 0.3 + p.k / 6) % 1), g = p.big ? 1 : 0.45; p.m.position.set(p.o[0] + s * 8 * g + Math.sin(s * 6 + p.k) * g, p.o[1] + s * 14 * g, p.o[2] + Math.cos(s * 5 + p.k) * g); p.m.scale.setScalar((0.8 + s * 3) * g); }
      skyDay.visible = !dusk; skyDusk.visible = dusk; glowMesh.visible = dusk;
      sun.color.set(dusk ? 0xff9a60 : 0xfff4e0); sun.intensity = dusk ? 1.0 : 2.2; sun.position.set(dusk ? -120 : -50, dusk ? 25 : 70, dusk ? 20 : 60);
      hemi.color.set(dusk ? 0x7a6ab0 : 0xd8f4ff); hemi.groundColor.set(dusk ? 0x3a2a4a : 0x6a5a70); hemi.intensity = dusk ? 1.2 : 2.1;
      scene.fog = new THREE.Fog(dusk ? 0x9a5a8a : 0xbfeee8, 220, 900);
      cam.position.set(v[0], v[1], v[2]); cam.lookAt(v[3], v[4], v[5]); cam.fov = v[6]; cam.updateProjectionMatrix();
      r.setClearColor(0x4fb0e0); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
