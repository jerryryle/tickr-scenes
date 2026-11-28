// This file builds the storybook city's knitting works (styles.ts storybook; facilities.ts knittingWorks),
// a dock site on one block of the town (CityPlan.worksBlock). Its process is laid out beside its shallow
// van dock so it reads from the street, left to right as the truck pulls up:
//   an orchard of white tuft trees stands behind, and a gantry's claw picks their tufts and drops them down a chute;
//   a bucket elevator lifts them from the chute's foot to a hopper on stilts;
//   chutes run from the hopper into three dye vats along the street, which are stirred and steam in their dye;
//   dye is piped into the spinning hall (the dock's building) under a striped barrel roof;
//   a kettle engine at the hall's end drives the hall's machines: its belt turns the spools, which sit on the hall's front
//   over the dock doors, wound in the dyes and linked by gears;
//   yarn runs from the spools up the hall's gable to a circular knitting head on the roof, whose striped
//   knitted tube goes down into the hall; the bolts come out on the dock (cargo.ts knitwear).
// Positions are in the site's frame (facilities.ts: `a` along the frontage, `n` in from the
// pavement's back, y up), so the chunk draws the still parts (buildWorksStatic, in the block's
// grid frame) and KnittingWorksFx the moving ones (in the world) from one layout.
import * as THREE from "three@0.187.0";
import { Batch } from "../geom.ts";
import { facadeBox } from "../facade.ts";
import { FACADE } from "../facadetiles.ts";
import { SB, SB_GLOW, sbCurve, sbSpot, sbTube, storyTree } from "./storybook-buildings-town.ts";
import { puffScale } from "../puffs.ts";
import type { SbP3 } from "./storybook-buildings-town.ts";
import type { CityPlan } from "../city.ts";
import { DOCK_PLATFORM, dockDoorH, dockDoorW, dockStair, dockUsedBays } from "../facilities.ts";
import type { DockLayout } from "../facilities.ts";

// WORKS holds the layout, in the site frame.
export const WORKS = {
  hallTop: 9.6,                                  // the hall's walls reach this height, and its barrel roof rises from here
  vats: [35, 41, 47] as const, vatN: 7, vatR: 2.2, vatY0: 2.6, vatY1: 6.4,
  hopper: [41, 20, 11.5] as const,               // these are the a, n, y of its bottom
  elevator: { a: 41, n0: 30, n1: 21.5, y0: 0.7, y1: 17.2 },
  orchardA: [33, 37, 45, 49] as const, orchardN: [33, 37, 41] as const,
  gantry: { n: 36, a0: 32, a1: 50, y: 11.2 },     // (high enough that the claw's hook clears the tree crowns as it travels)
  chute: { a: 41, n0: 36, y0: 7.6, n1: 31.6, y1: 1.5 },   // from its mouth under the gantry down to the elevator's boot
  // The kettle engine stands past the hall's end: the flywheel (its crank and pulley in front of it), the
  // cylinder's trunnion on the kettle's shoulder, and the belt from the flywheel's pulley up to the last spool's.
  engine: { wheelA: 30.75, wheelN: 13.0, wheelY: 1.6, wheelR: 1.15, crank: 0.35, crankN: 12.6, pivotA: 31.95, pivotY: 2.65,
    beltN: 11.9, pulleyR: 0.4, spoolPulleyR: 0.8, kettleA: 32.85, kettleN: 13.4, spoutA: 34.2, spoutY: 2.6 },
  water: [49.5, 24] as const,
  spoolsA: [15, 20.5, 26] as const, spoolY: 7.6, spoolR: 1.3,   // the spools sit on the hall's front (n = L.wall)
  knit: { n: 19, y: 0 },                         // the knitting head sits over the ridge (y counts from the roof's top)
  stacks: [[13.5, 37.5], [27.5, 37.5]] as const, stackH: 30,
  dyes: [SB.pink, SB.aqua, SB.mustard] as const,
};
const WORKS_FLUFF = SB.fluff;

// A WorksFrame is a frame to draw in: P maps (a, n) to (x, z), and al and inn are the unit vectors along the
// frontage and in from it.
export interface WorksFrame { P: (a: number, n: number) => [number, number]; al: [number, number]; inn: [number, number] }
export function worksFrameOf(P: (a: number, n: number) => [number, number]): WorksFrame {
  const [x0, z0] = P(30, 20), [x1, z1] = P(31, 20), [x2, z2] = P(30, 21);
  return { P, al: [x1 - x0, z1 - z0], inn: [x2 - x0, z2 - z0] };
}
const worksAt = (F: WorksFrame, a: number, n: number, y: number): SbP3 => { const [x, z] = F.P(a, n); return [x, y, z]; };
// worksRoofR gives the roof's top over the ridge (the barrel's radius is half the hall's width).
const worksRoofR = (L: DockLayout) => (L.a1 - L.a0) / 2 - 0.05;
export const worksKnitAt = (L: DockLayout): [number, number, number] => [(L.a0 + L.a1) / 2, WORKS.knit.n, WORKS.hallTop + worksRoofR(L) + 0.35];

// ---- the still parts --------------------------------------------------------------------------
// buildWorksStatic draws the spinning hall over the dock (from its wall back to n = 39.5), its barrel roof and
// stacks, and the yard's vats, hopper, elevator frame, pipes, water tower, orchard and gantry. It draws in the
// block's grid frame (city.ts buildDockSite: P is frontPt on the site's side), and returns the hall's top.
export function buildWorksStatic(s: Batch, F: WorksFrame, L: DockLayout): number {
  const W = WORKS, mid = (L.a0 + L.a1) / 2, R = worksRoofR(L), [ax, az] = F.al, [ix, iz] = F.inn;
  // The hall is cream, with two storeys of storybook windows over the dock band.
  const c0 = F.P(L.a0, L.wall), c1 = F.P(L.a1, 39.5);
  const top = facadeBox(s, Math.min(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[0], c1[0]), Math.max(c0[1], c1[1]), 0,
    [{ tile: FACADE.BLANK, floors: 1, floorH: 3.2 }, { tile: FACADE.STORYBOOK, floors: 2, floorH: (W.hallTop - 3.2) / 2 }], SB.cream);
  // The barrel roof has bands red and cream down its length, each a little fatter or thinner, and its
  // ends sit a little in from the hall's (the barrel's lower half is inside the hall; end walls and
  // roof ends in one plane would flicker).
  const n0 = L.wall + 0.3, n1 = 39.2, k = 6;
  for (let i = 0; i < k; i++) {
    // (Each band is a cylinder laid along the hall's length, turned a quarter about z, then about y to its line.)
    const [x, , z] = worksAt(F, mid, n0 + (n1 - n0) * (i + 0.5) / k, top);
    s.cyl(x, top, z, R - (i % 2 ? 0.25 : 0), (n1 - n0) / k, i % 2 ? SB.cream : SB.red, 16, 0, Math.PI / 2, Math.atan2(-iz, ix) + i * 0.02);
  }
  // Two boiler stacks stand at the back, ringed white and ink and bending a little.
  W.stacks.forEach(([sa, sn], j) => {
    sbTube(s, sbCurve(6, (t) => { const [x, z] = F.P(sa + Math.sin(t * 2.4) * (j ? -1.2 : 1.2) * t, sn); return [x, t * W.stackH, z]; }), (i) => 1.0 - i * 0.05, (i) => (i % 2 ? SB.ink : SB.white), 8, j);
    const [x, z] = F.P(sa + Math.sin(2.4) * (j ? -1.2 : 1.2), sn); s.cyl(x, W.stackH + 0.2, z, 1.05, 0.5, SB.ink, 8, 0, 0, j);
    s.aux.set(0, 0, SB_GLOW); s.cyl(x, W.stackH + 0.47, z, 0.8, 0.06, SB.orange, 8, 0, 0, j); s.aux.set(0, 0, -1);   // (embers in the mouth, aglow after dark)
  });
  // The sign on the ridge is a giant ball of pink yarn with needles through it and a loose end trailing.
  { const [x, y, z] = worksAt(F, mid, 31, top + R + 2.6);
    s.ico(x, y, z, 2.8, SB.pink, 1, 0.4);
    for (let i = 0; i < 3; i++) s.cyl(x, y, z, 2.78, 0.22, SB.magenta, 12, 0.5 + i * 0.8, i * 0.9);
    sbTube(s, [[x - 4.5, y - 3.2, z - 1], [x + 4.5, y + 3.2, z + 1]], () => 0.14, () => SB.mustard, 5, 0.2);
    sbTube(s, [[x - 4, y + 3.5, z + 1.2], [x + 4, y - 3.5, z - 1.2]], () => 0.14, () => SB.mustard, 5, 0.7);
    s.ico(x + 4.6, y + 3.3, z + 1, 0.4, SB.red); s.ico(x - 4.1, y + 3.6, z + 1.2, 0.4, SB.red);
    // a ring of marquee bulbs round the ball, on its street side, lit after dark
    s.aux.set(0, 0, SB_GLOW);
    for (let i = 0; i < 12; i++) { const a2 = (i / 12) * Math.PI * 2, p = worksAt(F, mid + Math.cos(a2) * 3.25, 31 - 0.9, y + Math.sin(a2) * 3.25); s.ico(p[0], p[1], p[2], 0.16, SB.lamp); }
    s.aux.set(0, 0, -1); }
  // These are the knitting head's deck and frame on the ridge (KnittingWorksFx turns the head).
  { const [ka, kn, ky] = worksKnitAt(L), [x, y, z] = worksAt(F, ka, kn, ky);
    s.box(x, y - 0.1, z, 5.2, 0.5, 5.2, SB.violet, Math.atan2(-az, ax));
    for (const [da, dn] of [[-2.2, -2.2], [2.2, -2.2], [-2.2, 2.2], [2.2, 2.2]]) { const [px, , pz] = worksAt(F, ka + da, kn + dn, 0); s.box(px, y + 2.9, pz, 0.3, 5.6, 0.3, SB.violet); }
    s.box(x, y + 5.8, z, 5, 0.3, 5, SB.violet, Math.atan2(-az, ax)); s.cyl(x, y + 6.05, z, 0.35, 0.2, SB.mustard, 8); }   // (the governor turns on the collar: KnittingWorksFx)
  // These are the spools' brackets on the hall's front, and the yarn from each up the gable to its feeder on the
  // head's needle ring, on the side facing the spools.
  W.spoolsA.forEach((sa, i) => {
    const [bx, , bz] = worksAt(F, sa, L.wall - 0.15, 0); s.box(bx, W.spoolY, bz, 0.5, 0.5, 0.5, SB.ink);
    const [ka, kn, ky] = worksKnitAt(L);
    sbTube(s, [worksAt(F, sa, L.wall - 1.0, W.spoolY + W.spoolR), worksAt(F, sa + (mid - sa) * 0.4, L.wall - 1.2, top + R + 1.2), worksAt(F, ka + Math.sin((i - 1) * 0.45) * 1.8, kn - Math.cos((i - 1) * 0.45) * 1.8, ky + 3.2 + 1.3)], () => 0.06, () => W.dyes[i], 4, i);
  });
  // The yard has the vats on their legs, striped in their dye, each with its stirrer's motor on a
  // bridge and a ladder up the front, and the dye's surface (KnittingWorksFx turns the stirrer).
  W.vats.forEach((va, i) => {
    const [x, , z] = worksAt(F, va, W.vatN, 0), c = W.dyes[i];
    for (let k2 = 0; k2 < 4; k2++) { const a2 = 0.8 + k2 * 1.57, [lx, , lz] = worksAt(F, va + Math.cos(a2) * 1.8, W.vatN + Math.sin(a2) * 1.8, 0); s.box(lx, W.vatY0 / 2, lz, 0.3, W.vatY0, 0.3, SB.navy); }
    const h3 = (W.vatY1 - W.vatY0) / 3;
    for (let k2 = 0; k2 < 3; k2++) s.cyl(x, W.vatY0 + h3 * (k2 + 0.5), z, W.vatR - (k2 === 1 ? 0 : 0.03), h3 + (k2 === 1 ? 0.02 : 0), k2 === 1 ? c : SB.cream, 12, 0, 0, k2 * 0.13);
    s.cyl(x, W.vatY1 + 0.1, z, W.vatR + 0.22, 0.28, SB.ink, 12, 0, 0, 0.3); s.aux.set(0, 0, SB_GLOW); s.cyl(x, W.vatY1 - 0.08, z, W.vatR - 0.15, 0.1, c, 12, 0, 0, 0.5); s.aux.set(0, 0, -1);   // (the dye glows after dark)
    const [mx, , mz] = worksAt(F, va, W.vatN + 0.9, 0); s.box(mx, W.vatY1 + 2.3, mz, 1.1, 0.9, 1.1, SB.red, Math.atan2(-az, ax));
    for (const d of [-1, 1]) { const [px, , pz] = worksAt(F, va + d * 2.3, W.vatN + 0.9, 0); s.box(px, W.vatY1 + 1.2, pz, 0.18, 2.2, 0.18, SB.ink); }
    const [hx, , hz] = worksAt(F, va, W.vatN + 0.9, 0); s.box(hx, W.vatY1 + 1.9, hz, 4.8, 0.18, 0.25, SB.ink, Math.atan2(-az, ax));
    for (const d of [-0.35, 0.35]) { const [px, , pz] = worksAt(F, va + d, W.vatN - W.vatR - 0.1, 0); s.box(px, W.vatY1 / 2, pz, 0.08, W.vatY1, 0.08, SB.ink); }
    for (let r2 = 0; r2 < 7; r2++) { const [px, , pz] = worksAt(F, va, W.vatN - W.vatR - 0.1, 0); s.box(px, 0.5 + r2 * 0.85, pz, 0.7, 0.07, 0.1, SB.ink, Math.atan2(-az, ax)); }
    // dye is piped to the hall's side wall, low
    const pn = 14.6 + i * 1.2, py = 3.0 + i * 0.6;
    sbTube(s, [worksAt(F, va, W.vatN + W.vatR - 0.3, py), worksAt(F, va, pn, py), worksAt(F, L.a1 + 0.1, pn, py)], () => 0.32, (j) => (j === 1 ? SB.ink : c), 6, i);
    // a chute runs from the hopper
    const [ha, hn, hy] = W.hopper;
    sbTube(s, sbCurve(3, (t) => worksAt(F, ha + (va - ha) * t, hn - 1.2 + (W.vatN + 0.6 - (hn - 1.2)) * t, hy + 0.4 + (W.vatY1 + 0.6 - hy - 0.4) * t + Math.sin(t * Math.PI) * 0.6)), () => 0.4, (j) => (j % 2 ? SB.cream : c), 6, i * 0.4);
  });
  // The hopper stands on its stilts, heaped with white tufts.
  { const [ha, hn, hy] = W.hopper, [x, , z] = worksAt(F, ha, hn, 0);
    for (const [da, dn] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) { const [px, , pz] = worksAt(F, ha + da, hn + dn, 0); s.box(px, hy / 2, pz, 0.3, hy, 0.3, SB.navy); }
    s.box(x, hy + 0.9, z, 2.6, 1.8, 2.6, SB.violet, Math.atan2(-az, ax));
    s.cone(x, hy + 3.9, z, 3.0, 4.2, SB.orange, 10, Math.PI); s.cyl(x, hy + 6.0, z, 3.1, 0.3, SB.cream, 10);
    for (let k2 = 0; k2 < 6; k2++) { const a2 = k2 * 2.4, rr = 1.8 * Math.sqrt((k2 + 0.5) / 6); s.ico(x + Math.cos(a2) * rr, hy + 6.25, z + Math.sin(a2) * rr, 0.7, WORKS_FLUFF, 1, k2); } }
  // The elevator's frame runs from the orchard's pit up to the hopper (KnittingWorksFx moves its buckets).
  { const E = W.elevator;
    for (const d of [-0.8, 0.8]) sbTube(s, [worksAt(F, E.a + d, E.n0, E.y0), worksAt(F, E.a + d, E.n1, E.y1)], () => 0.15, () => SB.navy, 4, d);
    for (let k2 = 1; k2 < 4; k2++) { const t = k2 / 4, [x, , z] = worksAt(F, E.a, E.n0 + (E.n1 - E.n0) * t, 0); s.box(x, (E.y0 + (E.y1 - E.y0) * t) / 2, z, 0.25, E.y0 + (E.y1 - E.y0) * t, 0.25, SB.navy); }
    for (const [n2, y2] of [[E.n0, E.y0 + 0.3], [E.n1, E.y1]]) for (const d of [-0.95, 0.95]) { const [x2, , z2] = worksAt(F, E.a + d, n2, 0); s.box(x2, y2, z2, 0.2, 0.5, 0.5, SB.navy, Math.atan2(-az, ax)); }   // (the drums' bearings: KnittingWorksFx turns the drums)
    const [x, , z] = worksAt(F, E.a, E.n0 + 1.2, 0); s.box(x, 0.45, z, 3, 0.9, 3, SB.ink, Math.atan2(-az, ax));
    for (let k2 = 0; k2 < 4; k2++) { const [px, , pz] = worksAt(F, E.a - 0.6 + (k2 % 2) * 1.2, E.n0 + 0.7 + (k2 >> 1) * 1.1, 0); s.ico(px, 1.05, pz, 0.55, WORKS_FLUFF, 1, k2); } }
  // The water tower is piped to the vats over their bridges.
  { const [wa, wn] = W.water, [x, , z] = worksAt(F, wa, wn, 0);
    for (let i = 0; i < 3; i++) { const a2 = i * 2.1 + 0.5; sbTube(s, sbCurve(3, (t) => worksAt(F, wa + Math.cos(a2) * 2.2 * (1 - t * 0.5), wn + Math.sin(a2) * 2.2 * (1 - t * 0.5), t * 14)), () => 0.2, () => SB.ink, 4, a2); }
    for (let i = 0; i < 5; i++) s.cyl(x, 15 + i * 1.1, z, 3.2 - Math.abs(i - 2) * 0.45, 1.11, i % 2 ? SB.white : SB.sky, 10, 0, 0, i * 0.2);
    s.cone(x, 21.4, z, 2.4, 2.4, SB.coral, 9); s.ico(x, 22.9, z, 0.4, SB.mustard);
    sbTube(s, [worksAt(F, wa, wn, 14.5), worksAt(F, wa, wn, W.vatY1 + 3.2), worksAt(F, wa, W.vatN + 1.6, W.vatY1 + 3.2), worksAt(F, W.vats[0], W.vatN + 1.6, W.vatY1 + 3.2)], () => 0.25, () => SB.sky, 6, 0.1); }
  // The orchard has rows of white tufts behind, and the gantry stands over them.
  for (const oa of W.orchardA) for (const on of W.orchardN) { const [x, , z] = worksAt(F, oa, on, 0); storyTree(s, "tuft", x, WORKS_LOT_Y, z, 5.2, 1.6, WORKS_FLUFF); }
  { const G2 = W.gantry;
    for (const ga of [G2.a0, G2.a1]) for (const d of [-2.5, 2.5]) { const [x, , z] = worksAt(F, ga, G2.n + d, 0); s.box(x, G2.y / 2, z, 0.35, G2.y, 0.35, SB.navy); }
    sbTube(s, [worksAt(F, G2.a0, G2.n, G2.y + 0.3), worksAt(F, G2.a1, G2.n, G2.y + 0.3)], () => 0.35, () => SB.mustard, 4, 0.2);
    for (const ga of [G2.a0, G2.a1]) sbTube(s, [worksAt(F, ga, G2.n - 2.6, G2.y + 0.3), worksAt(F, ga, G2.n + 2.6, G2.y + 0.3)], () => 0.3, () => SB.mustard, 4, 0.6); }
  // The chute runs from a funnel under the gantry down to the elevator's boot, a striped trough on two legs.
  { const C = W.chute, m0 = worksAt(F, C.a, C.n0, C.y0), m1 = worksAt(F, C.a, C.n1, C.y1);
    sbTube(s, sbCurve(4, (t): SbP3 => [m0[0] + (m1[0] - m0[0]) * t, m0[1] + (m1[1] - m0[1]) * t, m0[2] + (m1[2] - m0[2]) * t]), () => 0.42, (i) => (i % 2 ? SB.cream : SB.coral), 8, 0.2);
    s.cone(m0[0], m0[1] + 0.3, m0[2], 0.95, 1.1, SB.mustard, 10, Math.PI);
    for (const t of [0.15, 0.6]) { const [x, , z] = worksAt(F, C.a, C.n0 + (C.n1 - C.n0) * t, 0), y = C.y0 + (C.y1 - C.y0) * t; s.box(x, y / 2, z, 0.2, y, 0.2, SB.navy); } }
  // The kettle engine: a striped kettle on stubby legs over a glowing firebox, the steam pipe to the cylinder's
  // trunnion bracket on its shoulder, the flywheel's bearing post, and the belt from the flywheel's pulley up to
  // the last spool's (its two straight runs, tangent to both). KnittingWorksFx turns the wheel and swings the cylinder.
  { const En = W.engine, [x, , z] = worksAt(F, En.kettleA, En.kettleN, 0), yaw = Math.atan2(-az, ax);
    for (let k = 0; k < 4; k++) { const a2 = 0.8 + k * 1.57, [lx, , lz] = worksAt(F, En.kettleA + Math.cos(a2) * 0.7, En.kettleN + Math.sin(a2) * 0.7, 0); s.box(lx, 0.25, lz, 0.18, 0.5, 0.18, SB.ink); }
    s.aux.set(0, 0, SB_GLOW); s.cyl(x, 0.3, z, 0.6, 0.3, SB.orange, 8); s.aux.set(0, 0, -1);
    s.lathe("kettle", SB_KETTLE, x, 0.45, z, 1.1, 2.2, SB.teal, 12);
    for (const [h, r] of [[0.8, 1.01], [1.55, 1.03]]) s.cyl(x, h, z, r + 0.02, 0.18, SB.mustard, 12);
    s.cyl(x, 2.65, z, 0.36, 0.12, SB.ink, 8); s.ico(x, 2.8, z, 0.15, SB.red);
    sbTube(s, sbCurve(4, (t): SbP3 => worksAt(F, En.kettleA + 0.95 + t * (En.spoutA - En.kettleA - 0.95), En.kettleN, 1.05 + Math.sin(t * Math.PI / 2) * (En.spoutY - 1.15))), (i, t) => 0.16 - t * 0.07, () => SB.teal, 6);
    sbTube(s, sbCurve(6, (t): SbP3 => worksAt(F, En.kettleA - 0.7 * Math.cos(t * Math.PI), En.kettleN, 2.4 + Math.sin(t * Math.PI) * 0.7)), () => 0.05, () => SB.ink, 4, 0, true);
    sbTube(s, [worksAt(F, En.kettleA - 0.4, En.kettleN - 0.3, 2.1), worksAt(F, En.pivotA + 0.1, En.crankN + 0.35, En.pivotY + 0.3), worksAt(F, En.pivotA, En.crankN + 0.2, En.pivotY)], () => 0.07, () => SB.ink, 5);
    { const [px, , pz] = worksAt(F, En.pivotA, En.crankN + 0.3, 0); s.box(px, En.pivotY, pz, 0.24, 0.24, 0.3, SB.ink, yaw); }
    { const [px, , pz] = worksAt(F, En.wheelA, En.wheelN + 0.5, 0); s.box(px, En.wheelY / 2, pz, 0.3, En.wheelY + 0.1, 0.3, SB.ink, yaw); s.box(px, 0.08, pz, 1.2, 0.16, 0.6, SB.ink, yaw); }
    const c1: [number, number] = [En.wheelA, En.wheelY], c2: [number, number] = [W.spoolsA[2], W.spoolY], r1 = En.pulleyR, r2 = En.spoolPulleyR;
    const dl = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]), be = Math.atan2(c2[1] - c1[1], c2[0] - c1[0]), al2 = Math.acos((r1 - r2) / dl);
    for (const sg of [-1, 1]) {
      const g = be + sg * al2, ca = Math.cos(g), sa = Math.sin(g);
      sbTube(s, [worksAt(F, c1[0] + r1 * ca, En.beltN, c1[1] + r1 * sa), worksAt(F, c2[0] + r2 * ca, En.beltN, c2[1] + r2 * sa)], () => 0.07, () => SB.plum, 4);
    } }
  return top + R;
}
// storyDock dresses the works' dock in the storybook's idiom (city.ts buildDockSite draws it in place of the
// modern dressing, as it does the brewery's): a pink platform with a scalloped cream edge, round-topped doors
// in the town's colours (standing open at the bays trucks use), a lantern on a curled bracket between each pair
// of bays and at the ends, pink steps with a plum handrail, and baskets of yarn balls on the platform. It
// returns the lanterns' points, whose light falls on the yard, the driver and the load (DC.lampSites).
export function storyDock(s: Batch, F: WorksFrame, L: DockLayout): SbP3[] {
  const P = DOCK_PLATFORM, dw = dockDoorW(L), doorH = dockDoorH(L), [ax, az] = F.al, [ix, iz] = F.inn, yaw = Math.atan2(-az, ax), yawN = Math.atan2(ix, iz);
  const usedA = dockUsedBays(L).map((i) => L.bays[i]);
  const box = (a0: number, a1: number, y0: number, y1: number, n0: number, n1: number, c: number) => { const [x, , z] = worksAt(F, (a0 + a1) / 2, (n0 + n1) / 2, 0); s.box(x, (y0 + y1) / 2, z, a1 - a0, y1 - y0, n1 - n0, c, yaw); };
  const disc = (a: number, y: number, n0: number, n1: number, r: number, c: number, seg = 12) => { const [x, , z] = worksAt(F, a, (n0 + n1) / 2, 0); s.cyl(x, y, z, r, n1 - n0, c, seg, Math.PI / 2, 0, yawN); };
  box(L.a0, L.a1, 0, P, L.edge, L.wall, SB.pink);
  box(L.a0 + 0.01, L.a1 - 0.01, P - 0.13, P + 0.03, L.edge - 0.06, L.edge + 0.3, SB.cream);
  for (let a = L.a0 + 0.3; a < L.a1 - 0.2; a += 0.6) disc(a, P - 0.13, L.edge - 0.09, L.edge - 0.03, 0.27, SB.cream, 8);
  // (A door's arch is a disc over its rectangle, the frame's a little bigger behind it: the faces that
  // overlap are one colour, so they cannot be seen to flicker.)
  const DOORS = [SB.teal, SB.violet, SB.mustard, SB.coral, SB.mint];
  L.bays.forEach((b, i) => {
    const open = usedA.includes(b), c = open ? 0x1c1626 : DOORS[Math.floor(sbSpot(b, L.look * 97, i) * DOORS.length)], spring = P + doorH - dw;
    box(b - dw - 0.15, b + dw + 0.15, P, spring, L.wall - 0.06, L.wall + 0.01, SB.plum); disc(b, spring, L.wall - 0.06, L.wall + 0.01, dw + 0.15, SB.plum, 14);
    box(b - dw, b + dw, P + 0.005, spring, L.wall - 0.1, L.wall - 0.06, c); disc(b, spring, L.wall - 0.1, L.wall - 0.06, dw, c, 14);
    if (!open) { disc(b, spring + 0.2, L.wall - 0.13, L.wall - 0.09, 0.32, SB.cream, 10); box(b + dw - 0.4, b + dw - 0.25, P + 1.1, P + 1.25, L.wall - 0.16, L.wall - 0.1, SB.mustard); }
  });
  // A lantern hangs from a curled ink bracket between each pair of bays and at the ends, lit after dark.
  const lamps: SbP3[] = [];
  for (const la of [L.a0 + 0.9, ...L.bays.slice(1).map((b, i) => (b + L.bays[i]) / 2), L.a1 - 0.9]) {
    const y = P + doorH + 0.55;
    sbTube(s, sbCurve(5, (t): SbP3 => worksAt(F, la, L.wall - 0.02 - t * 0.6, y + Math.sin(t * Math.PI) * 0.35)), () => 0.04, () => SB.ink, 4, 0, true);
    const p = worksAt(F, la, L.wall - 0.62, y - 0.3);
    s.cone(p[0], p[1] + 0.27, p[2], 0.22, 0.2, SB.ink, 6);
    s.aux.set(0, 0, SB_GLOW); s.ico(p[0], p[1], p[2], 0.17, SB.lamp, 1.2); s.aux.set(0, 0, -1);
    lamps.push([p[0], p[1] - 0.1, p[2]]);
  }
  // Pink steps with a plum handrail up to the platform for each used bay, where any dock has them.
  const flights = new Set<number>();
  for (const p of usedA) flights.add(Math.round((p + dockStair(L, p)) * 10) / 10);
  for (const aS of flights) {
    for (let k = 0; k < 5; k++) box(aS - 0.55, aS + 0.55, 0, (k + 1) * P / 5, L.edge - 2.6 + k * 0.52, L.edge - 0.001, SB.pink);   // (one colour: the steps' ends share their planes)
    const ra = aS + (aS < (L.a0 + L.a1) / 2 ? -1 : 1) * 0.6;
    sbTube(s, [worksAt(F, ra, L.edge - 2.5, 0), worksAt(F, ra, L.edge - 2.5, 1.0), worksAt(F, ra, L.edge - 0.1, P + 1.0), worksAt(F, ra, L.edge - 0.1, P)], () => 0.045, () => SB.plum, 5);
  }
  // On the platform, away from the used bays and the steps, stand baskets heaped with yarn balls.
  L.bays.forEach((b, i) => {
    const a = b + (sbSpot(b, L.look, 3) < 0.5 ? -1 : 1) * 0.9;
    if (usedA.some((u) => Math.abs(u - b) < 4) || sbSpot(b, L.look, 4) > 0.6 || [...flights].some((f) => Math.abs(f - a) < 1.6) || a < L.a0 + 0.6 || a > L.a1 - 0.6) return;
    const [x, , z] = worksAt(F, a, L.edge + 0.9, 0);
    s.cyl(x, P + 0.25, z, 0.45, 0.5, SB.mustard, 10); s.cyl(x, P + 0.5, z, 0.48, 0.06, SB.orange, 10);
    for (let k = 0; k < 3; k++) { const a2 = k * 2.1 + i; s.ico(x + Math.cos(a2) * 0.2, P + 0.62 + (k === 2 ? 0.15 : 0), z + Math.sin(a2) * 0.2, 0.24, WORKS.dyes[(i + k) % 3], 1, a2); }
  });
  return lamps;
}
const SB_KETTLE: readonly (readonly [number, number])[] = [[0, 0], [0.85, 0.05], [1, 0.35], [0.82, 0.8], [0.35, 1], [0, 1]];   // (a kettle's squat body)
const WORKS_LOT_Y = 0.13;   // (this is the block's raised base, grid.ts LOT_TOP, under the orchard)

// ---- the moving parts -------------------------------------------------------------------------
// KnittingWorksFx is built in the world when a storybook city is (main.ts buildCity) and posed by scene
// time alone (update), so scrubbing replays it. One angle drives the works, as the steam brewery's
// crank does: the kettle engine's flywheel turns at WORKS_ENGINE_RATE, and its belt, the spools and
// their idlers, the stirrers, the knitting head, its governor and the knitted tube all turn by fixed
// ratios from it (worksRates). The engine is an oscillating one: its cylinder swings on a trunnion to
// follow the crank pin, and its spout puffs at each dead centre. The yard runs on one 12 s cycle
// (WORKS_CYCLE): the gantry's claw picks a tuft in the orchard and drops it down a chute to the
// elevator's boot, and the bucket that passes the boot next carries it up to the hopper.
const WORKS_ENGINE_RATE = 2.4;   // the flywheel's turn, radians a second
const WORKS_CYCLE = 12;          // seconds the claw takes to pick and drop one tuft
const WORKS_BUCKETS = 10;        // buckets on the elevator, one past the boot every WORKS_CYCLE / 4 s
const WORKS_LOOP_R = 0.8;        // the radius the buckets go round the elevator's drums at
const WORKS_UP = new THREE.Vector3(0, 1, 0);
// worksRates gives each part's turn from the flywheel's: the belt's pulleys, the spools and their
// idlers in mesh (equal tooth pitch), the knitting head geared 1.5 to a spool, and the governor 4 to the head.
const WORKS_TEETH = { spool: 18, spoolR: 1.45, idler: 16 };
function worksRates() {
  const E = WORKS.engine, spool = WORKS_ENGINE_RATE * E.pulleyR / E.spoolPulleyR, head = spool * 1.5;
  return { engine: WORKS_ENGINE_RATE, spool, idler: -spool * WORKS_TEETH.spool / WORKS_TEETH.idler, head, governor: head * 4, stirrer: WORKS_ENGINE_RATE * 0.5, tube: head * 0.3 };
}
const worksEase = (u: number) => { const k = Math.min(1, Math.max(0, u)); return k * k * (3 - 2 * k); };
interface WorksSpin { m: THREE.Object3D; axis: THREE.Vector3; rate: number; phase: number }
interface WorksPuffSource { o: THREE.Vector3; k: number; rate: number; size: number; rise: number; drift: number; color: THREE.Color; phase: number }
export class KnittingWorksFx {
  private group = new THREE.Group();
  private spins: WorksSpin[] = [];
  private buckets: { g: THREE.Object3D; tuft: THREE.Object3D }[] = [];
  private trolley: THREE.Object3D | null = null;
  private cable: THREE.Object3D | null = null;
  private hook: THREE.Object3D | null = null;
  private fingers: THREE.Object3D[] = [];
  private clawTuft: THREE.Object3D | null = null;
  private fallTuft: THREE.Object3D | null = null;
  private cyl: THREE.Object3D | null = null;
  private rod: THREE.Object3D | null = null;
  private tube: THREE.Mesh | null = null;
  private tubeStep = NaN;
  private puffs: THREE.InstancedMesh | null = null;
  private sources: WorksPuffSource[] = [];
  private F: WorksFrame | null = null;
  private L: DockLayout | null = null;
  private axis = new THREE.Vector3();   // (al x up: a positive turn about it carries al towards up, so angles in the a-y plane grow)
  private yaw = new THREE.Quaternion();
  private E = { p0: new THREE.Vector3(), p1: new THREE.Vector3(), u: new THREE.Vector3(), w: new THREE.Vector3(), k: new THREE.Vector3(), len: 0 };
  private knit = new THREE.Vector3();
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private sc = new THREE.Vector3(); private col = new THREE.Color();
  built = "";

  constructor(private readonly world: THREE.Object3D, private readonly mat: THREE.Material) { world.add(this.group); }

  clear() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse((c) => { if (c instanceof THREE.Mesh) c.geometry.dispose(); }); }
    if (this.puffs) (this.puffs.material as THREE.Material).dispose();
    this.spins = []; this.buckets = []; this.trolley = this.cable = this.hook = this.clawTuft = this.fallTuft = this.cyl = this.rod = null; this.fingers = [];
    this.tube = null; this.tubeStep = NaN; this.puffs = null; this.sources = []; this.F = null; this.L = null; this.built = "";
  }

  build(plan: CityPlan, layout: (bx: number, bz: number) => DockLayout | null) {
    this.clear();
    const id = plan.worksBlock; if (id < 0) return;
    const B = plan.graph.blocks[id], L = layout(B.kx, B.kz);
    if (!L || !B.anchor) return;
    const G = plan.graph, face = B.anchor.face, delta = B.anchor.delta;
    const F = worksFrameOf((a, n) => { const p = G.facePt(face, a + delta, n); return [p.x, p.z]; });
    this.F = F; this.L = L; this.built = `${plan.seed}`;
    const W = WORKS, R = worksRates(), al = new THREE.Vector3(F.al[0], 0, F.al[1]).normalize();
    this.axis.crossVectors(al, WORKS_UP).normalize();
    this.yaw.setFromAxisAngle(WORKS_UP, Math.atan2(-F.al[1], F.al[0]));
    const ax = this.axis, at = (a: number, n: number, y: number) => worksAt(F, a, n, y);
    const piece = (make: (b: Batch) => void, pivot: SbP3) => {
      const b = new Batch(); make(b); const m = b.build(this.mat); if (!m) return new THREE.Object3D();
      m.geometry.translate(-pivot[0], -pivot[1], -pivot[2]); m.position.set(pivot[0], pivot[1], pivot[2]); this.group.add(m); return m;
    };
    // A disc in the a-y plane (its axis along n, from n0 to n1) is a short capped tube.
    const disc = (b: Batch, a: number, y: number, n0: number, n1: number, r: number, c: number, seg = 16) => sbTube(b, [at(a, n0, y), at(a, n1, y)], () => r, () => c, seg, 0, true);
    const spoke = (b: Batch, a: number, y: number, n: number, r0: number, r1: number, ang: number, w: number, c: number) =>
      sbTube(b, [at(a + Math.cos(ang) * r0, n, y + Math.sin(ang) * r0), at(a + Math.cos(ang) * r1, n, y + Math.sin(ang) * r1)], () => w, () => c, 4);

    // The kettle engine: the flywheel with its crank (the pin at angle 0 before it turns) and the belt's
    // pulley on the front of its axle. The cylinder swings on its trunnion and the piston rod slides in it.
    const En = W.engine, wc = at(En.wheelA, En.wheelN, En.wheelY);
    this.spins.push({ m: piece((b) => {
      sbTube(b, sbCurve(16, (t): SbP3 => at(En.wheelA + Math.cos(t * Math.PI * 2) * En.wheelR, En.wheelN, En.wheelY + Math.sin(t * Math.PI * 2) * En.wheelR)), () => 0.1, (i) => (i % 2 ? SB.cream : SB.red), 6, 0, true);
      for (let k = 0; k < 5; k++) spoke(b, En.wheelA, En.wheelY, En.wheelN, 0.1, En.wheelR - 0.05, k * Math.PI * 2 / 5, 0.05, SB.ink);
      disc(b, En.wheelA, En.wheelY, En.wheelN - 0.15, En.wheelN + 0.15, 0.18, SB.mustard, 8);
      sbTube(b, [at(En.wheelA, En.beltN - 0.1, En.wheelY), at(En.wheelA, En.wheelN + 0.4, En.wheelY)], () => 0.07, () => SB.ink, 6);
      sbTube(b, [at(En.wheelA, En.crankN + 0.12, En.wheelY), at(En.wheelA + En.crank, En.crankN + 0.12, En.wheelY)], () => 0.08, () => SB.mustard, 4);
      disc(b, En.wheelA + En.crank, En.wheelY, En.crankN - 0.1, En.crankN + 0.2, 0.08, SB.ink, 6);
      disc(b, En.wheelA, En.wheelY, En.beltN - 0.12, En.beltN + 0.12, En.pulleyR, SB.violet, 12);
      for (let k = 0; k < 3; k++) spoke(b, En.wheelA, En.wheelY, En.beltN - 0.14, 0, En.pulleyR - 0.05, k * 2.09, 0.05, SB.cream);
    }, wc), axis: ax, rate: R.engine, phase: 0 });
    this.cyl = piece((b) => {
      b.cyl(0, 0.5, 0, 0.22, 1.0, SB.mustard, 10); for (const y of [0.04, 0.96]) b.cyl(0, y, 0, 0.26, 0.1, SB.red, 10);
      b.cyl(0, 0, 0, 0.09, 0.5, SB.ink, 6, Math.PI / 2);   // (the trunnion, across the cylinder)
    }, [0, 0, 0]);
    this.rod = piece((b) => { b.cyl(0, 0.52, 0, 0.05, 1.05, SB.cream, 6); b.ico(0, 0, 0, 0.1, SB.ink); }, [0, 0, 0]);
    this.cyl.quaternion.copy(this.yaw); this.rod.quaternion.copy(this.yaw);

    // The spools are wound in their dyes, with cream end plates, a bold ink cross on the front, loose turns
    // of white on the face and a ring of teeth at the back. The idlers between them mesh with those rings
    // and turn the other way. The last spool carries the belt's big pulley on its front.
    const T = WORKS_TEETH;
    W.spoolsA.forEach((sa, i) => {
      const c = at(sa, L.wall - 1.0, W.spoolY), f0 = at(sa, L.wall - 1.6, W.spoolY), f1 = at(sa, L.wall - 0.4, W.spoolY);
      const m = piece((b) => {
        sbTube(b, [f0, f1], () => W.spoolR, () => W.dyes[i], 16, 0, true);
        for (const [p, q2] of [[L.wall - 1.75, L.wall - 1.62], [L.wall - 0.38, L.wall - 0.25]]) disc(b, sa, W.spoolY, p, q2, 0.95, SB.cream, 14);
        for (let k = 0; k < 3; k++) spoke(b, sa, W.spoolY, L.wall - 1.82, 0, 0.88, k * Math.PI * 2 / 3 + 0.5, 0.16, SB.ink);
        for (let k = 0; k < 3; k++) { const a2 = k * 2.1 + 0.4, p = at(sa + Math.cos(a2) * 1.25, L.wall - 1.62, W.spoolY + Math.sin(a2) * 1.25); b.ico(p[0], p[1], p[2], 0.16, SB.white, 1, k); }
        worksGear(b, F, sa, L.wall - 0.22, W.spoolY, T.spoolR - 0.1, T.spoolR, T.spool, 0, SB.navy);
        if (i === 2) {
          disc(b, sa, W.spoolY, En.beltN - 0.12, En.beltN + 0.12, En.spoolPulleyR, SB.violet, 16);
          for (let k = 0; k < 4; k++) spoke(b, sa, W.spoolY, En.beltN - 0.14, 0, En.spoolPulleyR - 0.08, k * Math.PI / 2, 0.06, SB.cream);
          sbTube(b, [at(sa, En.beltN - 0.1, W.spoolY), at(sa, L.wall - 1.7, W.spoolY)], () => 0.12, () => SB.ink, 6);
        }
      }, c);
      this.spins.push({ m, axis: ax, rate: R.spool, phase: 0 });
      if (i < 2) {
        // (An idler's teeth sit half a pitch round from its mesh points, where the spools' teeth are.)
        const ia = (sa + W.spoolsA[i + 1]) / 2, ic = at(ia, L.wall - 0.22, W.spoolY), ir = (W.spoolsA[i + 1] - sa) / 2 - T.spoolR;
        this.spins.push({ m: piece((b) => worksGear(b, F, ia, L.wall - 0.22, W.spoolY, ir - 0.1, ir, T.idler, Math.PI + Math.PI / T.idler, SB.violet), ic), axis: ax, rate: R.idler, phase: 0 });
      }
    });
    // each stirrer has a shaft from the motor and a cross of paddles over the dye
    W.vats.forEach((va, i) => {
      const c = at(va, W.vatN, W.vatY1 + 0.5);
      const m = piece((b) => {
        b.cyl(c[0], W.vatY1 + 1.1, c[2], 0.09, 1.9, SB.ink, 4);
        for (const r of [0, Math.PI / 2]) b.boxR(c[0], W.vatY1 + 0.25, c[2], 3.2, 0.18, 0.28, SB.orange, 0, r, 0);
        for (const [dx, dz] of [[1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5]]) b.box(c[0] + dx, W.vatY1 + 0.15, c[2] + dz, 0.3, 0.6, 0.3, SB.orange);
      }, c);
      this.spins.push({ m, axis: WORKS_UP, rate: R.stirrer, phase: i });
    });
    // The knitting head is a red drum ringed with needles. The governor on the frame's top spins with it,
    // its balls standing out at the angle where they balance at its speed (cos = g / (w^2 arm)).
    const [ka, kn, ky] = worksKnitAt(L), kc = at(ka, kn, ky + 3.2);
    this.knit.set(kc[0], kc[1], kc[2]);
    const head = piece((b) => {
      b.cyl(kc[0], kc[1], kc[2], 1.9, 1.1, SB.red, 14); b.cyl(kc[0], kc[1] + 0.62, kc[2], 2.05, 0.16, SB.ink, 14);
      for (let i = 0; i < 16; i++) { const a2 = (i / 16) * Math.PI * 2; b.box(kc[0] + Math.cos(a2) * 1.75, kc[1] + 1.05, kc[2] + Math.sin(a2) * 1.75, 0.07, 0.75, 0.07, SB.white); }
      for (let i = 0; i < 4; i++) { const a2 = (i / 4) * Math.PI * 2; b.box(kc[0] + Math.cos(a2) * 1.92, kc[1], kc[2] + Math.sin(a2) * 1.92, 0.12, 0.7, 0.3, SB.mustard, -a2); }
    }, kc);
    this.spins.push({ m: head, axis: WORKS_UP, rate: R.head, phase: 0 });
    { const gc = at(ka, kn, ky + 7.3), arm = 0.6, tilt = Math.acos(Math.min(1, 9.81 / (R.governor * R.governor * arm))), gx = arm * Math.sin(tilt), gy = arm * Math.cos(tilt);
      this.spins.push({ m: piece((b) => {
        b.cyl(gc[0], gc[1] - 0.65, gc[2], 0.05, 1.5, SB.ink, 4); b.ico(gc[0], gc[1] + 0.15, gc[2], 0.14, SB.red);
        b.cyl(gc[0], gc[1] - gy * 0.95, gc[2], 0.1, 0.16, SB.mustard, 6);
        for (const s of [-1, 1]) {
          sbTube(b, [gc, [gc[0] + s * gx, gc[1] - gy, gc[2]]], () => 0.035, () => SB.ink, 4);
          sbTube(b, [[gc[0] + s * gx / 2, gc[1] - gy / 2, gc[2]], [gc[0], gc[1] - gy * 0.95, gc[2]]], () => 0.03, () => SB.ink, 4);
          b.ico(gc[0] + s * gx, gc[1] - gy, gc[2], 0.2, SB.mustard);
        }
      }, gc), axis: WORKS_UP, rate: R.governor, phase: 0 }); }
    // The knitted tube is built once as rings, from inside the head down into the roof, and scrolls
    // down a ring's height at a time (update), its stripes stepping on a ring as it jumps back.
    { const b = new Batch(); for (let k = 0; k < 9; k++) b.cyl(0, -(k + 0.5) * WORKS_KNIT_ROW, 0, 1.0, WORKS_KNIT_ROW + 0.01, SB.white, 10);
      this.tube = b.build(this.mat); if (this.tube) this.group.add(this.tube); }

    // The bucket elevator: its buckets go round a stadium, up the incline on one side and down the other,
    // and round the drums at the boot and the head, which turn with them.
    const Ev = W.elevator, p0 = at(Ev.a, Ev.n0, Ev.y0 + 0.3), p1 = at(Ev.a, Ev.n1, Ev.y1), Es = this.E;
    Es.p0.set(...p0); Es.p1.set(...p1); Es.len = Es.p0.distanceTo(Es.p1);
    Es.u.subVectors(Es.p1, Es.p0).normalize();
    Es.w.copy(WORKS_UP).addScaledVector(Es.u, -Es.u.y).normalize();
    Es.k.crossVectors(Es.w, Es.u).normalize();
    for (const [n2, y2] of [[Ev.n0, Ev.y0 + 0.3], [Ev.n1, Ev.y1]]) {
      const dc = at(Ev.a, n2, y2);
      this.spins.push({ m: piece((b) => {
        sbTube(b, [at(Ev.a - 0.6, n2, y2), at(Ev.a + 0.6, n2, y2)], () => 0.45, () => SB.red, 10, 0, true);
        for (const d of [-0.62, 0.62]) for (let k = 0; k < 2; k++) {
          const ang = k * Math.PI / 2, dy = Math.cos(ang) * 0.42, dn = Math.sin(ang) * 0.42;
          sbTube(b, [at(Ev.a + d, n2 - dn, y2 - dy), at(Ev.a + d, n2 + dn, y2 + dy)], () => 0.07, () => SB.mustard, 4);
        }
      }, dc), axis: Es.k, rate: this.bucketV() / WORKS_LOOP_R, phase: 0 });
    }
    for (let k = 0; k < WORKS_BUCKETS; k++) {
      const g = new THREE.Group(), body = piece((b) => { b.box(0, 0, 0, 0.9, 0.6, 1.0, SB.orange); b.box(0, 0.32, 0, 0.95, 0.07, 1.05, SB.ink); }, [0, 0, 0]);
      const tuft = piece((b) => b.ico(0, 0.5, 0, 0.5, WORKS_FLUFF), [0, 0, 0]);
      g.add(body, tuft); this.group.add(g); this.buckets.push({ g, tuft });
    }

    // The gantry's claw: a trolley runs on the girder, and its hook hangs on a cable (a unit long, scaled
    // to the drop) with three fingers that close on a tuft.
    const G2 = W.gantry;
    this.trolley = piece((b) => {
      b.box(0, G2.y - 0.15, 0, 1.4, 0.6, 1.2, SB.red); b.box(0, G2.y + 0.2, 0, 1.0, 0.12, 0.9, SB.ink);
      for (const d of [-0.45, 0.45]) b.cyl(d, G2.y + 0.42, 0, 0.16, 0.95, SB.ink, 8, Math.PI / 2);
      b.cyl(0, G2.y - 0.5, 0, 0.22, 0.4, SB.mustard, 8, 0, Math.PI / 2);
    }, [0, 0, 0]);
    this.cable = piece((b) => b.cyl(0, -0.5, 0, 0.04, 1, SB.ink, 4), [0, 0, 0]);
    this.hook = new THREE.Group(); this.group.add(this.hook);
    { const hb = new Batch(); hb.cyl(0, -0.15, 0, 0.32, 0.3, SB.mustard, 8); hb.ico(0, 0.02, 0, 0.12, SB.ink);
      const hm = hb.build(this.mat); if (hm) this.hook.add(hm); }
    for (let k = 0; k < 3; k++) {
      const f = new THREE.Group(), fb = new Batch();
      fb.box(0, -0.45, 0.06, 0.12, 0.9, 0.12, SB.ink); fb.boxR(0, -0.95, -0.06, 0.12, 0.35, 0.12, SB.ink, 0.7, 0, 0);
      const fm = fb.build(this.mat); if (fm) f.add(fm);
      f.position.set(Math.sin(k * 2.09) * 0.28, -0.3, Math.cos(k * 2.09) * 0.28); f.rotation.set(0, k * 2.09, 0, "YXZ");
      this.hook.add(f); this.fingers.push(f);
    }
    { const tb = new Batch(); tb.ico(0, 0, 0, 0.55, WORKS_FLUFF, 0.9); const tm = tb.build(this.mat);
      if (tm) { this.clawTuft = tm; tm.position.set(0, -1.1, 0); this.hook.add(tm); this.fallTuft = new THREE.Mesh(tm.geometry, this.mat); this.group.add(this.fallTuft); } }

    // The puffs: one instanced mesh of round puffs, as the brewery has: dyed steam off the vats, white
    // steam from the boiler stacks, and the kettle's spout puffing at each dead centre of the crank
    // (where the crank points along the cylinder: a new puff each stroke).
    const src = (p: SbP3, k: number, rate: number, size: number, rise: number, drift: number, color: number, phase = 0) =>
      this.sources.push({ o: new THREE.Vector3(...p), k, rate, size, rise, drift, color: new THREE.Color(color), phase });
    W.vats.forEach((va, i) => src(at(va, W.vatN, W.vatY1 + 0.4), 4, 0.25, 0.45, 3.2, 1.2, W.dyes[i], i * 0.31));
    for (const [sa, sn] of W.stacks) src(at(sa + Math.sin(2.4) * (sa < 20 ? 1.2 : -1.2), sn, W.stackH + 0.5), 6, 0.12, 1.4, 7, 5, 0xfffaf0, sa * 0.1);
    const dead = Math.atan2(En.pivotY - En.wheelY, En.pivotA - En.wheelA);
    src(at(En.spoutA, En.kettleN, En.spoutY), 3, R.engine / (3 * Math.PI), 0.35, 1.8, 0.8, 0xffffff, -dead / (3 * Math.PI));
    const n = this.sources.reduce((s, x) => s + x.k, 0);
    this.puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
    this.puffs.frustumCulled = false;
    let pi = 0;
    for (const s of this.sources) for (let k = 0; k < s.k; k++) this.puffs.setColorAt(pi++, s.color);
    this.group.add(this.puffs);
  }

  // bucketV is the elevator's speed, which brings a bucket past the boot every quarter of the claw's cycle.
  private bucketV() { return (2 * this.E.len + 2 * Math.PI * WORKS_LOOP_R) / WORKS_BUCKETS / (WORKS_CYCLE / 4); }

  update(t: number) {
    const F = this.F, L = this.L; if (!F || !L) return;
    const W = WORKS, R = worksRates(), En = W.engine, at = (a: number, n: number, y: number) => worksAt(F, a, n, y);
    for (const s of this.spins) s.m.quaternion.setFromAxisAngle(s.axis, s.phase + t * s.rate);
    // The engine: the crank pin is at angle th round the wheel's centre, and the cylinder, pivoted on its
    // trunnion, points at it; the piston rod reaches back from the pin into the cylinder.
    const th = t * R.engine, pinA = En.wheelA + En.crank * Math.cos(th), pinY = En.wheelY + En.crank * Math.sin(th);
    if (this.cyl && this.rod) {
      const o = at(En.pivotA, En.crankN, En.pivotY), p = at(pinA, En.crankN, pinY);
      this.v.set(p[0] - o[0], p[1] - o[1], p[2] - o[2]).normalize();
      this.cyl.position.set(...o); this.cyl.quaternion.setFromUnitVectors(WORKS_UP, this.v).multiply(this.yaw);
      this.rod.position.set(...p); this.rod.quaternion.setFromUnitVectors(WORKS_UP, this.v.negate()).multiply(this.yaw);
    }
    // The bucket elevator: s runs round the loop from the boot's top (the foot of the up side), and psi is
    // how far round a bucket has turned, which tips it over the head drum to empty it.
    const E = this.E, rb = WORKS_LOOP_R, v = this.bucketV(), Lp = 2 * E.len + 2 * Math.PI * rb, cyc = WORKS_CYCLE;
    this.buckets.forEach(({ g, tuft }, k) => {
      const s = ((t * v + (k * Lp) / WORKS_BUCKETS) % Lp + Lp) % Lp;
      let psi: number;
      if (s < E.len) { psi = 0; g.position.copy(E.p0).addScaledVector(E.u, s).addScaledVector(E.w, rb); }
      else if (s < E.len + Math.PI * rb) { psi = (s - E.len) / rb; g.position.copy(E.p1).addScaledVector(E.w, rb * Math.cos(psi)).addScaledVector(E.u, rb * Math.sin(psi)); }
      else if (s < 2 * E.len + Math.PI * rb) { psi = Math.PI; g.position.copy(E.p1).addScaledVector(E.u, -(s - E.len - Math.PI * rb)).addScaledVector(E.w, -rb); }
      else { psi = Math.PI + (s - 2 * E.len - Math.PI * rb) / rb; g.position.copy(E.p0).addScaledVector(E.w, rb * Math.cos(psi)).addScaledVector(E.u, rb * Math.sin(psi)); }
      g.quaternion.setFromAxisAngle(E.k, psi).multiply(this.yaw);
      // (It carries a tuft if it left the boot just after one came down the chute, near the cycle's end.)
      const left = t - s / v, u = ((left % cyc) + cyc) % cyc;
      tuft.visible = psi < 1.75 && u < cyc / 4;
    });
    // The claw's cycle: travel to a tree, lower, close on a tuft, raise, travel to the chute, open, wait.
    // The tuft drops into the chute's mouth and slides down it to the boot.
    if (this.trolley && this.cable && this.hook) {
      const G2 = W.gantry, C = W.chute, u = ((t % cyc) + cyc) % cyc, col = W.orchardA[((Math.floor(t / cyc) % 4) + 4) % 4];
      const a = u < 3 ? C.a + (col - C.a) * worksEase(u / 3) : u < 6.5 ? col : u < 9.5 ? col + (C.a - col) * worksEase((u - 6.5) / 3) : C.a;
      const drop = 0.6 + 2.3 * (u < 3 ? 0 : u < 4.5 ? worksEase((u - 3) / 1.5) : u < 5 ? 1 : u < 6.5 ? 1 - worksEase((u - 5) / 1.5) : 0);
      const close = u < 4.5 ? 0 : u < 5 ? (u - 4.5) / 0.5 : u < 9.5 ? 1 : u < 10 ? 1 - (u - 9.5) / 0.5 : 0;
      const p = at(a, G2.n, 0), top = G2.y - 0.7;
      this.trolley.position.set(p[0], 0, p[2]); this.trolley.quaternion.copy(this.yaw);
      this.cable.position.set(p[0], top, p[2]); this.cable.scale.set(1, drop, 1);
      this.hook.position.set(p[0], top - drop, p[2]); this.hook.quaternion.copy(this.yaw);
      this.fingers.forEach((f) => { f.rotation.x = -0.6 + 0.75 * close; });
      if (this.clawTuft) this.clawTuft.visible = u >= 4.7 && u < 9.7;
      if (this.fallTuft) {
        // (It falls freely from the hook to the chute's mouth, then slides down the chute at an even pace.)
        const ft = u - 9.7, hy = top - 0.6 - 1.1, m0 = at(C.a, C.n0, C.y0), m1 = at(C.a, C.n1, C.y1), fall = Math.sqrt((hy - C.y0 - 0.4) / 4.9);
        this.fallTuft.visible = ft >= 0 && ft < fall + 1.5;
        if (ft >= 0 && ft < fall) this.fallTuft.position.set(m0[0], hy - 4.9 * ft * ft, m0[2]);
        else if (ft >= fall) { const k = Math.min(1, (ft - fall) / 1.5); this.fallTuft.position.set(m0[0] + (m1[0] - m0[0]) * k, C.y0 + 0.4 + (C.y1 - C.y0) * k, m0[2] + (m1[2] - m0[2]) * k); }
      }
    }
    // The knitted tube turns with the head and moves down at its speed: shifted down within one row, with
    // its rows' stripes stepped on whenever a whole row has gone by.
    if (this.tube) {
      const o = t * R.tube, step = Math.floor(o / WORKS_KNIT_ROW), top = this.knit.y - 0.55 + WORKS_KNIT_ROW;
      this.tube.position.set(this.knit.x, top - (o - step * WORKS_KNIT_ROW), this.knit.z);
      this.tube.quaternion.setFromAxisAngle(WORKS_UP, t * R.head);
      if (step !== this.tubeStep) {
        this.tubeStep = step;
        const c = this.tube.geometry.getAttribute("color") as THREE.BufferAttribute, per = c.count / 9;
        for (let k = 0; k < 9; k++) {
          this.col.set(WORKS_KNIT_STRIPES[((step - k) % 6 + 6) % 6]);
          for (let i = k * per; i < (k + 1) * per; i++) c.setXYZ(i, this.col.r, this.col.g, this.col.b);
        }
        c.needsUpdate = true;
      }
    }
    // The puffs rise, swell, drift and shrink away, each source's in turn.
    if (this.puffs) {
      let i = 0;
      for (const s of this.sources) for (let k = 0; k < s.k; k++) {
        const age = ((t * s.rate + k / s.k + s.phase) % 1 + 1) % 1, g = 0.5 + 0.5 * Math.sin(k * 2.3);
        this.v.copy(s.o); this.v.x += s.drift * age * age * 0.8 + Math.sin(k * 1.7) * 0.2; this.v.z += s.drift * age * age * 0.45; this.v.y += s.rise * age;
        this.q.setFromAxisAngle(WORKS_UP, k * 0.9 + age);
        const sz = puffScale(age, 1, s.size * (0.8 + 0.4 * g));
        this.m.compose(this.v, this.q, this.sc.set(sz, sz, sz));
        this.puffs.setMatrixAt(i++, this.m);
      }
      this.puffs.instanceMatrix.needsUpdate = true;
    }
  }
}
const WORKS_KNIT_ROW = 0.45;
const WORKS_KNIT_STRIPES = [SB.pink, SB.white, SB.aqua, SB.white, SB.mustard, SB.red];
// worksGear draws a gear lying in the hall's front plane (its axis in from it), centred at (a, n, y): a disc
// of radius r, `teeth` teeth round the pitch radius rp starting at angle a0, and three bold cream spokes on its street side, so its turning reads.
function worksGear(b: Batch, F: WorksFrame, a: number, n: number, y: number, r: number, rp: number, teeth: number, a0: number, color: number) {
  sbTube(b, [worksAt(F, a, n - 0.12, y), worksAt(F, a, n + 0.12, y)], () => r, () => color, 18, 0, true);
  for (let i = 0; i < teeth; i++) {
    const a2 = a0 + (i / teeth) * Math.PI * 2, p = worksAt(F, a + Math.cos(a2) * rp, n, y + Math.sin(a2) * rp);
    b.ico(p[0], p[1], p[2], 0.13, color, 1, a2);
  }
  for (let i = 0; i < 3; i++) { const a2 = (i / 3) * Math.PI * 2 + 0.3; sbTube(b, [worksAt(F, a, n - 0.2, y), worksAt(F, a + Math.cos(a2) * r * 0.85, n - 0.2, y + Math.sin(a2) * r * 0.85)], () => 0.15, () => SB.cream, 4, a2); }
}
