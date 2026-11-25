// The storybook city's knitting works (styles.ts storybook; facilities.ts knittingWorks): a dock
// site on one block of the town (CityPlan.worksBlock), its process laid out beside its shallow
// van dock so it reads from the street, left to right as the truck pulls up:
//   an orchard of white tuft trees behind, a gantry's claw picking their tufts;
//   a bucket elevator lifting them to a hopper on stilts;
//   chutes from the hopper into three dye vats along the street, stirred, steaming in their dye;
//   dye piped into the spinning hall (the dock's building) under a striped barrel roof;
//   three spools on the hall's front over the dock doors, wound in the dyes, linked by gears;
//   yarn from the spools up the hall's gable to a circular knitting head on the roof, its striped
//   knitted tube going down into the hall; the bolts come out on the dock (cargo.ts knitwear).
// Positions are in the site's frame (facilities.ts: `a` along the frontage, `n` in from the
// pavement's back, y up), so the chunk draws the still parts (buildWorksStatic, in the block's
// grid frame) and KnittingWorksFx the moving ones (in the world) from one layout.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { facadeBox } from "./facade.ts";
import { FACADE } from "./facadetiles.ts";
import { SB, sbCurve, sbTube, storyTree } from "./storybook.ts";
import type { SbP3 } from "./storybook.ts";
import type { CityPlan } from "./city.ts";
import type { DockLayout } from "./facilities.ts";

// The layout (site frame).
export const WORKS = {
  hallTop: 9.6,                                  // the hall's walls; its barrel roof rises from here
  vats: [35, 41, 47] as const, vatN: 7, vatR: 2.2, vatY0: 2.6, vatY1: 6.4,
  hopper: [41, 20, 11.5] as const,               // a, n, y of its bottom
  elevator: { a: 41, n0: 30, n1: 21.5, y0: 0.7, y1: 17.2 },
  orchardA: [33, 37, 45, 49] as const, orchardN: [33, 37, 41] as const,
  gantry: { n: 36, a0: 32, a1: 50, y: 9.2 },
  water: [49.5, 24] as const,
  spoolsA: [15, 20.5, 26] as const, spoolY: 7.6, spoolR: 1.3,   // on the hall's front (n = L.wall)
  knit: { n: 19, y: 0 },                         // the knitting head over the ridge (y from the roof's top)
  stacks: [[13.5, 37.5], [27.5, 37.5]] as const, stackH: 30,
  dyes: [SB.pink, SB.aqua, SB.mustard] as const,
};
const WORKS_FLUFF = SB.fluff;

// A frame to draw in: P(a, n) to (x, z), and the unit vectors along the frontage and in from it.
export interface WorksFrame { P: (a: number, n: number) => [number, number]; al: [number, number]; inn: [number, number] }
export function worksFrameOf(P: (a: number, n: number) => [number, number]): WorksFrame {
  const [x0, z0] = P(30, 20), [x1, z1] = P(31, 20), [x2, z2] = P(30, 21);
  return { P, al: [x1 - x0, z1 - z0], inn: [x2 - x0, z2 - z0] };
}
const worksAt = (F: WorksFrame, a: number, n: number, y: number): SbP3 => { const [x, z] = F.P(a, n); return [x, y, z]; };
// The roof's top over the ridge (the barrel's radius is half the hall's width).
const worksRoofR = (L: DockLayout) => (L.a1 - L.a0) / 2 - 0.05;
export const worksKnitAt = (L: DockLayout): [number, number, number] => [(L.a0 + L.a1) / 2, WORKS.knit.n, WORKS.hallTop + worksRoofR(L) + 0.35];

// ---- the still parts --------------------------------------------------------------------------
// The spinning hall over the dock (from its wall back to n = 39.5), its barrel roof and stacks, the
// yard's vats, hopper, elevator frame, pipes, water tower, orchard and gantry. In the block's grid
// frame (city.ts buildDockSite: P is frontPt on the site's side). Returns the hall's top.
export function buildWorksStatic(s: Batch, F: WorksFrame, L: DockLayout): number {
  const W = WORKS, mid = (L.a0 + L.a1) / 2, R = worksRoofR(L), [ax, az] = F.al, [ix, iz] = F.inn;
  // The hall: two storeys of storybook windows over the dock band, cream.
  const c0 = F.P(L.a0, L.wall), c1 = F.P(L.a1, 39.5);
  const top = facadeBox(s, Math.min(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[0], c1[0]), Math.max(c0[1], c1[1]), 0,
    [{ tile: FACADE.BLANK, floors: 1, floorH: 3.2 }, { tile: FACADE.STORYBOOK, floors: 2, floorH: (W.hallTop - 3.2) / 2 }], SB.cream);
  // The barrel roof: bands red and cream down its length, each a little fatter or thinner, its
  // ends a little in from the hall's (the barrel's lower half is inside the hall; end walls and
  // roof ends in one plane would flicker).
  const n0 = L.wall + 0.3, n1 = 39.2, k = 6;
  for (let i = 0; i < k; i++) {
    // (A cylinder laid along the hall's length: turned a quarter about z, then about y to its line.)
    const [x, , z] = worksAt(F, mid, n0 + (n1 - n0) * (i + 0.5) / k, top);
    s.cyl(x, top, z, R - (i % 2 ? 0.25 : 0), (n1 - n0) / k, i % 2 ? SB.cream : SB.red, 16, 0, Math.PI / 2, Math.atan2(-iz, ix) + i * 0.02);
  }
  // Two boiler stacks at the back, ringed white and ink, bending a little.
  W.stacks.forEach(([sa, sn], j) => {
    sbTube(s, sbCurve(6, (t) => { const [x, z] = F.P(sa + Math.sin(t * 2.4) * (j ? -1.2 : 1.2) * t, sn); return [x, t * W.stackH, z]; }), (i) => 1.0 - i * 0.05, (i) => (i % 2 ? SB.ink : SB.white), 8, j);
    const [x, z] = F.P(sa + Math.sin(2.4) * (j ? -1.2 : 1.2), sn); s.cyl(x, W.stackH + 0.2, z, 1.05, 0.5, SB.ink, 8, 0, 0, j);
  });
  // The sign on the ridge: a giant ball of pink yarn, needles through it, a loose end trailing.
  { const [x, y, z] = worksAt(F, mid, 31, top + R + 2.6);
    s.ico(x, y, z, 2.8, SB.pink, 1, 0.4);
    for (let i = 0; i < 3; i++) s.cyl(x, y, z, 2.78, 0.22, SB.magenta, 12, 0.5 + i * 0.8, i * 0.9);
    sbTube(s, [[x - 4.5, y - 3.2, z - 1], [x + 4.5, y + 3.2, z + 1]], () => 0.14, () => SB.mustard, 5, 0.2);
    sbTube(s, [[x - 4, y + 3.5, z + 1.2], [x + 4, y - 3.5, z - 1.2]], () => 0.14, () => SB.mustard, 5, 0.7);
    s.ico(x + 4.6, y + 3.3, z + 1, 0.4, SB.red); s.ico(x - 4.1, y + 3.6, z + 1.2, 0.4, SB.red); }
  // The knitting head's deck and frame on the ridge (the head turns: KnittingWorksFx).
  { const [ka, kn, ky] = worksKnitAt(L), [x, y, z] = worksAt(F, ka, kn, ky);
    s.box(x, y - 0.1, z, 5.2, 0.5, 5.2, SB.violet, Math.atan2(-az, ax));
    for (const [da, dn] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) { const [px, , pz] = worksAt(F, ka + da, kn + dn, 0); s.box(px, y + 2.9, pz, 0.3, 5.6, 0.3, SB.violet); }
    s.box(x, y + 5.8, z, 5, 0.3, 5, SB.violet, Math.atan2(-az, ax)); s.cone(x, y + 6.8, z, 1.0, 1.4, SB.mustard, 8); }
  // The spools' brackets on the hall's front, and the yarn from each up the gable to the head.
  W.spoolsA.forEach((sa, i) => {
    const [bx, , bz] = worksAt(F, sa, L.wall - 0.15, 0); s.box(bx, W.spoolY, bz, 0.5, 0.5, 0.5, SB.ink);
    const [ka, kn, ky] = worksKnitAt(L);
    sbTube(s, [worksAt(F, sa, L.wall - 1.0, W.spoolY + W.spoolR), worksAt(F, sa + (mid - sa) * 0.4, L.wall - 1.2, top + R + 1.2), worksAt(F, ka + (i - 1) * 0.4, kn, ky + 4.8)], () => 0.06, () => W.dyes[i], 4, i);
  });
  // The yard: the vats on their legs, striped in their dye, each with its stirrer's motor on a
  // bridge and a ladder up the front; the dye's surface (the stirrer turns: KnittingWorksFx).
  W.vats.forEach((va, i) => {
    const [x, , z] = worksAt(F, va, W.vatN, 0), c = W.dyes[i];
    for (let k2 = 0; k2 < 4; k2++) { const a2 = 0.8 + k2 * 1.57, [lx, , lz] = worksAt(F, va + Math.cos(a2) * 1.8, W.vatN + Math.sin(a2) * 1.8, 0); s.box(lx, W.vatY0 / 2, lz, 0.3, W.vatY0, 0.3, SB.navy); }
    const h3 = (W.vatY1 - W.vatY0) / 3;
    for (let k2 = 0; k2 < 3; k2++) s.cyl(x, W.vatY0 + h3 * (k2 + 0.5), z, W.vatR - (k2 === 1 ? 0 : 0.03), h3 + (k2 === 1 ? 0.02 : 0), k2 === 1 ? c : SB.cream, 12, 0, 0, k2 * 0.13);
    s.cyl(x, W.vatY1 + 0.1, z, W.vatR + 0.22, 0.28, SB.ink, 12, 0, 0, 0.3); s.cyl(x, W.vatY1 - 0.08, z, W.vatR - 0.15, 0.1, c, 12, 0, 0, 0.5);
    const [mx, , mz] = worksAt(F, va, W.vatN + 0.9, 0); s.box(mx, W.vatY1 + 2.3, mz, 1.1, 0.9, 1.1, SB.red, Math.atan2(-az, ax));
    for (const d of [-1, 1]) { const [px, , pz] = worksAt(F, va + d * 2.3, W.vatN + 0.9, 0); s.box(px, W.vatY1 + 1.2, pz, 0.18, 2.2, 0.18, SB.ink); }
    const [hx, , hz] = worksAt(F, va, W.vatN + 0.9, 0); s.box(hx, W.vatY1 + 1.9, hz, 4.8, 0.18, 0.25, SB.ink, Math.atan2(-az, ax));
    for (const d of [-0.35, 0.35]) { const [px, , pz] = worksAt(F, va + d, W.vatN - W.vatR - 0.1, 0); s.box(px, W.vatY1 / 2, pz, 0.08, W.vatY1, 0.08, SB.ink); }
    for (let r2 = 0; r2 < 7; r2++) { const [px, , pz] = worksAt(F, va, W.vatN - W.vatR - 0.1, 0); s.box(px, 0.5 + r2 * 0.85, pz, 0.7, 0.07, 0.1, SB.ink, Math.atan2(-az, ax)); }
    // dye piped to the hall's side wall, low
    const pn = 14.6 + i * 1.2, py = 3.0 + i * 0.6;
    sbTube(s, [worksAt(F, va, W.vatN + W.vatR - 0.3, py), worksAt(F, va, pn, py), worksAt(F, L.a1 + 0.1, pn, py)], () => 0.32, (j) => (j === 1 ? SB.ink : c), 6, i);
    // a chute from the hopper
    const [ha, hn, hy] = W.hopper;
    sbTube(s, sbCurve(3, (t) => worksAt(F, ha + (va - ha) * t, hn - 1.2 + (W.vatN + 0.6 - (hn - 1.2)) * t, hy + 0.4 + (W.vatY1 + 0.6 - hy - 0.4) * t + Math.sin(t * Math.PI) * 0.6)), () => 0.4, (j) => (j % 2 ? SB.cream : c), 6, i * 0.4);
  });
  // The hopper on its stilts, heaped with white tufts.
  { const [ha, hn, hy] = W.hopper, [x, , z] = worksAt(F, ha, hn, 0);
    for (const [da, dn] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) { const [px, , pz] = worksAt(F, ha + da, hn + dn, 0); s.box(px, hy / 2, pz, 0.3, hy, 0.3, SB.navy); }
    s.box(x, hy + 0.9, z, 2.6, 1.8, 2.6, SB.violet, Math.atan2(-az, ax));
    s.cone(x, hy + 3.9, z, 3.0, 4.2, SB.orange, 10, Math.PI); s.cyl(x, hy + 6.0, z, 3.1, 0.3, SB.cream, 10);
    for (let k2 = 0; k2 < 6; k2++) { const a2 = k2 * 2.4, rr = 1.8 * Math.sqrt((k2 + 0.5) / 6); s.ico(x + Math.cos(a2) * rr, hy + 6.25, z + Math.sin(a2) * rr, 0.7, WORKS_FLUFF, 1, k2); } }
  // The elevator's frame, from the orchard's pit up to the hopper (its buckets: KnittingWorksFx).
  { const E = W.elevator;
    for (const d of [-0.8, 0.8]) sbTube(s, [worksAt(F, E.a + d, E.n0, E.y0), worksAt(F, E.a + d, E.n1, E.y1)], () => 0.15, () => SB.navy, 4, d);
    for (let k2 = 1; k2 < 4; k2++) { const t = k2 / 4, [x, , z] = worksAt(F, E.a, E.n0 + (E.n1 - E.n0) * t, 0); s.box(x, (E.y0 + (E.y1 - E.y0) * t) / 2, z, 0.25, E.y0 + (E.y1 - E.y0) * t, 0.25, SB.navy); }
    for (const [n2, y2] of [[E.n0, E.y0 + 0.3], [E.n1, E.y1]]) sbTube(s, [worksAt(F, E.a - 1.1, n2, y2), worksAt(F, E.a + 1.1, n2, y2)], () => 0.8, () => SB.red, 8, 0.3);
    const [x, , z] = worksAt(F, E.a, E.n0 + 1.2, 0); s.box(x, 0.45, z, 3, 0.9, 3, SB.ink, Math.atan2(-az, ax));
    for (let k2 = 0; k2 < 4; k2++) { const [px, , pz] = worksAt(F, E.a - 0.6 + (k2 % 2) * 1.2, E.n0 + 0.7 + (k2 >> 1) * 1.1, 0); s.ico(px, 1.05, pz, 0.55, WORKS_FLUFF, 1, k2); } }
  // The water tower, piped to the vats over their bridges.
  { const [wa, wn] = W.water, [x, , z] = worksAt(F, wa, wn, 0);
    for (let i = 0; i < 3; i++) { const a2 = i * 2.1 + 0.5; sbTube(s, sbCurve(3, (t) => worksAt(F, wa + Math.cos(a2) * 2.2 * (1 - t * 0.5), wn + Math.sin(a2) * 2.2 * (1 - t * 0.5), t * 14)), () => 0.2, () => SB.ink, 4, a2); }
    for (let i = 0; i < 5; i++) s.cyl(x, 15 + i * 1.1, z, 3.2 - Math.abs(i - 2) * 0.45, 1.11, i % 2 ? SB.white : SB.sky, 10, 0, 0, i * 0.2);
    s.cone(x, 21.4, z, 2.4, 2.4, SB.coral, 9); s.ico(x, 22.9, z, 0.4, SB.mustard);
    sbTube(s, [worksAt(F, wa, wn, 14.5), worksAt(F, wa, wn, W.vatY1 + 3.2), worksAt(F, wa, W.vatN + 1.6, W.vatY1 + 3.2), worksAt(F, W.vats[0], W.vatN + 1.6, W.vatY1 + 3.2)], () => 0.25, () => SB.sky, 6, 0.1); }
  // The orchard: rows of white tufts behind, and the gantry over them.
  for (const oa of W.orchardA) for (const on of W.orchardN) { const [x, , z] = worksAt(F, oa, on, 0); storyTree(s, "tuft", x, WORKS_LOT_Y, z, 5.2, 1.6, WORKS_FLUFF); }
  { const G2 = W.gantry;
    for (const ga of [G2.a0, G2.a1]) for (const d of [-2.5, 2.5]) { const [x, , z] = worksAt(F, ga, G2.n + d, 0); s.box(x, G2.y / 2, z, 0.35, G2.y, 0.35, SB.navy); }
    sbTube(s, [worksAt(F, G2.a0, G2.n, G2.y + 0.3), worksAt(F, G2.a1, G2.n, G2.y + 0.3)], () => 0.35, () => SB.mustard, 4, 0.2);
    for (const ga of [G2.a0, G2.a1]) sbTube(s, [worksAt(F, ga, G2.n - 2.6, G2.y + 0.3), worksAt(F, ga, G2.n + 2.6, G2.y + 0.3)], () => 0.3, () => SB.mustard, 4, 0.6); }
  return top + R;
}
const WORKS_LOT_Y = 0.13;   // (the block's raised base, grid.ts LOT_TOP, under the orchard)

// ---- the moving parts -------------------------------------------------------------------------
// Built in the world when a storybook city is (main.ts buildCity), turned by scene time
// (update), so scrubbing replays them: the spools and the gears between them, the stirrers, the
// bucket elevator, the gantry's claw, the knitting head and its knitted tube, and steam.
interface WorksSpin { m: THREE.Object3D; axis: THREE.Vector3; rate: number; phase: number }
export class KnittingWorksFx {
  private group = new THREE.Group();
  private spins: WorksSpin[] = [];
  private buckets: { g: THREE.Object3D; tuft: THREE.Object3D }[] = [];
  private claw: THREE.Object3D | null = null;
  private puffs: { m: THREE.Mesh; o: THREE.Vector3; k: number; big: boolean }[] = [];
  private tube: THREE.Mesh | null = null;
  private F: WorksFrame | null = null;
  private L: DockLayout | null = null;
  private E = { p0: new THREE.Vector3(), p1: new THREE.Vector3(), up: new THREE.Vector3() };
  private clawPath = { p0: new THREE.Vector3(), p1: new THREE.Vector3() };
  private knit = new THREE.Vector3();
  built = "";

  constructor(private readonly world: THREE.Object3D, private readonly mat: THREE.Material) { world.add(this.group); }

  clear() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse((c) => { if (c instanceof THREE.Mesh) c.geometry.dispose(); }); }
    this.spins = []; this.buckets = []; this.claw = null; this.puffs = []; this.tube = null; this.F = null; this.L = null; this.built = "";
  }

  build(plan: CityPlan, layout: (bx: number, bz: number) => DockLayout | null) {
    this.clear();
    const id = plan.worksBlock; if (id < 0) return;
    const B = plan.graph.blocks[id], L = layout(B.kx, B.kz);
    if (!L || !B.anchor) return;
    const G = plan.graph, face = B.anchor.face, delta = B.anchor.delta;
    const F = worksFrameOf((a, n) => { const p = G.facePt(face, a + delta, n); return [p.x, p.z]; });
    this.F = F; this.L = L; this.built = `${plan.seed}`;
    const W = WORKS, inn = new THREE.Vector3(F.inn[0], 0, F.inn[1]).normalize(), up = new THREE.Vector3(0, 1, 0);
    const piece = (make: (b: Batch) => void, pivot: SbP3) => {
      const b = new Batch(); make(b); const m = b.build(this.mat); if (!m) return new THREE.Object3D();
      m.geometry.translate(-pivot[0], -pivot[1], -pivot[2]); m.position.set(pivot[0], pivot[1], pivot[2]); this.group.add(m); return m;
    };
    // the spools: wound in their dyes, cream flanges, loose turns of white on the face; a gear
    // behind each, and bigger idlers between them on the wall, turning the other way
    W.spoolsA.forEach((sa, i) => {
      const c = worksAt(F, sa, L.wall - 1.0, W.spoolY), f0 = worksAt(F, sa, L.wall - 1.6, W.spoolY), f1 = worksAt(F, sa, L.wall - 0.4, W.spoolY);
      const m = piece((b) => {
        sbTube(b, [f0, f1], () => W.spoolR, () => W.dyes[i], 16, 0, true);
        for (const [p, q] of [[L.wall - 1.75, L.wall - 1.62], [L.wall - 0.38, L.wall - 0.25]]) sbTube(b, [worksAt(F, sa, p, W.spoolY), worksAt(F, sa, q, W.spoolY)], () => 0.95, () => SB.cream, 14, 0.2, true);
        for (let k = 0; k < 4; k++) { const a2 = k * 1.57; const p = worksAt(F, sa + Math.cos(a2) * 0.6, L.wall - 1.8, W.spoolY + Math.sin(a2) * 0.6); b.ico(p[0], p[1], p[2], 0.14, SB.red, 1, k); }
        for (let k = 0; k < 3; k++) { const a2 = k * 2.1 + 0.4; const p = worksAt(F, sa + Math.cos(a2) * 1.25, L.wall - 1.62, W.spoolY + Math.sin(a2) * 1.25); b.ico(p[0], p[1], p[2], 0.16, SB.white, 1, k); }
      }, c);
      this.spins.push({ m, axis: inn, rate: -1.6, phase: i });
      const gc = worksAt(F, sa, L.wall - 0.22, W.spoolY);
      this.spins.push({ m: piece((b) => worksGear(b, F, sa, L.wall - 0.22, W.spoolY, 0.9, SB.navy, 9), gc), axis: inn, rate: -1.6, phase: 0 });
      if (i < 2) {
        const ia = (sa + W.spoolsA[i + 1]) / 2, ic = worksAt(F, ia, L.wall - 0.22, W.spoolY);
        this.spins.push({ m: piece((b) => worksGear(b, F, ia, L.wall - 0.22, W.spoolY, 1.55, SB.violet, 14), ic), axis: inn, rate: 1.6 * 1.15 / 1.8, phase: 0.11 });
      }
    });
    // the stirrers: a shaft from the motor, a cross of paddles over the dye
    W.vats.forEach((va, i) => {
      const c = worksAt(F, va, W.vatN, W.vatY1 + 0.5);
      const m = piece((b) => {
        b.cyl(c[0], W.vatY1 + 1.1, c[2], 0.09, 1.9, SB.ink, 4);
        for (const r of [0, Math.PI / 2]) b.boxR(c[0], W.vatY1 + 0.25, c[2], 3.2, 0.18, 0.28, SB.orange, 0, r, 0);
        for (const [dx, dz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) b.box(c[0] + dx, W.vatY1 + 0.15, c[2] + dz, 0.3, 0.6, 0.3, SB.orange);
      }, c);
      this.spins.push({ m, axis: up, rate: 1.3, phase: i });
      this.puffs.push(...this.steam(worksAt(F, va, W.vatN, W.vatY1 + 0.4), W.dyes[i], false));
    });
    // the boilers' white steam
    for (const [sa, sn] of W.stacks) this.puffs.push(...this.steam(worksAt(F, sa + Math.sin(2.4) * (sa < 20 ? 1.2 : -1.2), sn, W.stackH + 0.5), 0xfffaf0, true));
    // the knitting head: a red drum ringed with needles, turning
    const [ka, kn, ky] = worksKnitAt(L), kc = worksAt(F, ka, kn, ky + 3.2);
    this.knit.set(kc[0], kc[1], kc[2]);
    this.spins.push({ m: piece((b) => {
      b.cyl(kc[0], kc[1], kc[2], 1.9, 1.1, SB.red, 14); b.cyl(kc[0], kc[1] + 0.62, kc[2], 2.05, 0.16, SB.ink, 14);
      for (let i = 0; i < 16; i++) { const a2 = (i / 16) * Math.PI * 2; b.box(kc[0] + Math.cos(a2) * 1.75, kc[1] + 1.05, kc[2] + Math.sin(a2) * 1.75, 0.07, 0.75, 0.07, SB.white); }
    }, kc), axis: up, rate: 2.2, phase: 0 });
    // the bucket elevator: buckets up one side carrying tufts, back down the other empty
    const E = W.elevator, p0 = worksAt(F, E.a, E.n0, E.y0 + 0.3), p1 = worksAt(F, E.a, E.n1, E.y1);
    this.E.p0.set(...p0); this.E.p1.set(...p1);
    this.E.up.set(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]).normalize();
    for (let k = 0; k < 10; k++) {
      const g = new THREE.Group(), body = piece((b) => { b.box(0, 0, 0, 0.9, 0.6, 1.1, SB.orange); b.box(0, 0.32, 0, 0.95, 0.07, 1.15, SB.ink); }, [0, 0, 0]);
      const tuft = piece((b) => b.ico(0, 0.5, 0, 0.5, WORKS_FLUFF), [0, 0, 0]);
      g.add(body, tuft); g.rotation.y = Math.atan2(-F.al[1], F.al[0]); this.group.add(g); this.buckets.push({ g, tuft });
    }
    // the gantry's claw, holding a tuft, running the length of the orchard and back
    const G2 = W.gantry, q0 = worksAt(F, G2.a0 + 2, G2.n, 0), q1 = worksAt(F, G2.a1 - 2, G2.n, 0);
    this.clawPath.p0.set(...q0); this.clawPath.p1.set(...q1);
    this.claw = piece((b) => {
      b.box(0, G2.y - 0.2, 0, 1.4, 0.7, 1.2, SB.red); b.cyl(0, G2.y - 1.9, 0, 0.05, 3.0, SB.ink, 4);
      for (let k = 0; k < 3; k++) { const a2 = k * 2.1; b.boxR(Math.cos(a2) * 0.4, G2.y - 3.8, Math.sin(a2) * 0.4, 0.12, 1.0, 0.12, SB.ink, Math.sin(a2) * 0.4, 0, -Math.cos(a2) * 0.4); }
      b.ico(0, G2.y - 4.25, 0, 0.6, WORKS_FLUFF);
    }, [0, 0, 0]);
  }

  private steam(o: SbP3, color: number, big: boolean) {
    const out: { m: THREE.Mesh; o: THREE.Vector3; k: number; big: boolean }[] = [];
    for (let k = 0; k < 5; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color, flatShading: true, transparent: true, opacity: 0.85 }));
      this.group.add(m); out.push({ m, o: new THREE.Vector3(...o), k, big });
    }
    return out;
  }

  update(t: number) {
    if (!this.F || !this.L) return;
    for (const s of this.spins) s.m.quaternion.setFromAxisAngle(s.axis, s.phase + t * s.rate);
    // buckets round their loop
    const E = this.E, len = E.p0.distanceTo(E.p1), side = new THREE.Vector3(-E.up.y * 0, 0, 0);
    void side;
    this.buckets.forEach(({ g, tuft }, k) => {
      const s = (t * 1.4 + (k * 2 * len) / this.buckets.length) % (2 * len), upLeg = s < len, d = upLeg ? s : 2 * len - s;
      g.position.copy(E.p0).addScaledVector(E.up, d); g.position.y += upLeg ? 0.55 : -0.55;
      g.rotation.z = upLeg ? 0 : Math.PI; tuft.visible = upLeg;
    });
    if (this.claw) { const u = (Math.sin(t * 0.55) + 1) / 2; this.claw.position.lerpVectors(this.clawPath.p0, this.clawPath.p1, u); this.claw.position.y = -Math.max(0, Math.sin(t * 0.55 - 1.3)) * 1.2; }
    // the knitted tube, striped, moving down out of the head into the roof
    if (this.tube) { this.group.remove(this.tube); this.tube.geometry.dispose(); }
    const b = new Batch(), STR = [SB.pink, SB.white, SB.aqua, SB.white, SB.mustard, SB.red], seg = 0.45, o = t * 0.7;
    for (let y = this.knit.y - 0.55 - 3.2 + 0.2, k = 0; y < this.knit.y - 0.55; y += seg, k++) {
      const s = Math.floor((this.knit.y - y + o) / seg);
      b.cyl(this.knit.x, y + seg / 2, this.knit.z, 1.0, seg + 0.01, STR[((s % 6) + 6) % 6], 10, 0, 0, k * 0.31);
    }
    this.tube = b.build(this.mat); if (this.tube) this.group.add(this.tube);
    // steam: puffs rising and swelling, one after another
    for (const p of this.puffs) {
      const s = (t * 0.3 + p.k / 5) % 1, g = p.big ? 0.9 : 0.32;
      p.m.position.set(p.o.x + s * 6 * g + Math.sin(s * 6 + p.k) * g, p.o.y + s * 10 * g, p.o.z + Math.cos(s * 5 + p.k) * g);
      p.m.scale.setScalar((0.7 + s * 2.6) * g);
    }
  }
}
// A gear lying in the hall's front plane (its axis in from it), centred at (a, n, y): a disc, a
// ring of teeth and three spokes.
function worksGear(b: Batch, F: WorksFrame, a: number, n: number, y: number, r: number, color: number, teeth: number) {
  sbTube(b, [worksAt(F, a, n - 0.12, y), worksAt(F, a, n + 0.12, y)], () => r, () => color, 18, 0, true);
  for (let i = 0; i < teeth; i++) {
    const a2 = (i / teeth) * Math.PI * 2, p = worksAt(F, a + Math.cos(a2) * (r + 0.15), n, y + Math.sin(a2) * (r + 0.15));
    b.ico(p[0], p[1], p[2], 0.2, color, 1, a2);
  }
  for (let i = 0; i < 3; i++) { const a2 = (i / 3) * Math.PI * 2 + 0.3; sbTube(b, [worksAt(F, a, n - 0.16, y), worksAt(F, a + Math.cos(a2) * r * 0.85, n - 0.16, y + Math.sin(a2) * r * 0.85)], () => 0.1, () => SB.cream, 4, a2); }
}
