// This file builds the Victorian city's steam brewery (facilities.ts steamBrewery), a dock site on one
// block of the town (CityPlan.worksBlock). The carriage backs into a shallow dock under the brewhouse,
// a tower brewery, and the rest of the works stands in the yard beside it so it reads from the
// street, left to right as the carriage pulls up:
//   the brewhouse rises over the dock in red brick, its name in big letters under a louvred top
//   storey, a hipped slate roof and a louvred lantern;
//   the copper house beside it shows its coppers through tall arched openings, a cast-iron water
//   tank on its roof, and a pipe bridge to the brewhouse;
//   the engine house has its beam engine on its front, the great beam rocking on iron columns
//   before the gable, its flywheel turning below with a governor beside it, and the cylinder at
//   the other end;
//   the malt kiln behind has a pyramid roof and a white cowl that turns in the wind, and the
//   boiler house's tall chimney smokes beside it;
//   along the street, casks roll down a ramp from the loft over the dray horses' stable into the
//   cooperage, past stacks of barrels.
// Positions are in the site's frame (facilities.ts: `a` along the frontage, `n` in from the
// pavement's back, y up), so the chunk draws the still parts (buildBreweryStatic, in the block's
// grid frame) and SteamBreweryFx the moving ones (in the world) from one layout. Everything stays
// at a >= 32.8 in front of the dock wall, clear of the truck yard and the carriage's swing in.
import * as THREE from "three@0.187.0";
import { Batch } from "../geom.ts";
import { BAY, facadeBox } from "../facade.ts";
import { FACADE } from "../facadetiles.ts";
import { puffScale } from "../puffs.ts";
import type { CityPlan } from "../city.ts";
import type { DockLayout } from "../facilities.ts";
import { VIC, VIC_GASLIGHT } from "./victorian-buildings-town.ts";

type BrP3 = [number, number, number];
// A frame to draw in (as the knitting works' WorksFrame): P maps (a, n) along the site's frontage
// and in from it to (x, z); al and inn are the unit vectors along the frontage and in from it.
export interface BreweryFrame { P: (a: number, n: number) => [number, number]; al: [number, number]; inn: [number, number] }
function breweryFrameOf(P: (a: number, n: number) => [number, number]): BreweryFrame {
  const [x0, z0] = P(30, 20), [x1, z1] = P(31, 20), [x2, z2] = P(30, 21);
  return { P, al: [x1 - x0, z1 - z0], inn: [x2 - x0, z2 - z0] };
}

// BREWERY holds the layout, in the site frame. The brewhouse spans the dock building's frontage
// (L.a0 to L.a1) from its wall back to n = 39.5.
export const BREWERY = {
  ground: 5.0,                      // the brewhouse's plain ground storey, over the dock's doors
  floors: 3, floorH: 3.4,           // its storeys of arched windows above
  nameH: 2.4,                       // the band with the name in it, under the louvred storey
  louvreH: 3.0,                     // the louvred top storey
  roofRise: 5.2, back: 39.5,
  copper: { a0: 32.8, a1: 38.6, n0: 19, n1: 29, top: 7.6, arches: [34.3, 37.1] as const, archW: 2.0, archTop: 5.8 },
  engine: { a0: 40.5, a1: 50.5, n0: 18, n1: 28, top: 11.5, gable: 3.6 },
  beam: { a: 45.5, n: 16.6, y: 13.6, half: 4.5 },
  wheel: { a: 41, n: 17.0, y: 4.0, r: 3.0, crank: 1.2 },
  cyl: { a: 50, y0: 0.13, y1: 5.6, r: 0.75 },
  // (The governor stands behind the wheel's rim, between it and the beam's back column, and a lay
  // shaft drives it from the crankshaft. Its arms hinge at y and are `arm` long to the balls.)
  governor: { a: 44.55, n: 17.55, y: 6.3, arm: 0.45 },
  kiln: { a0: 41, a1: 50, n0: 30, n1: 39, top: 11, rise: 7.5 },
  boiler: { a0: 32.8, a1: 39.5, n0: 31, n1: 36.8, top: 5.2 },
  chimney: { a: 36, n: 39.3, h: 34, r0: 1.7, r1: 1.1 },
  stable: { a0: 45.5, a1: 50.5, n0: 2.5, n1: 11, eaves: 4.6, ridge: 7.0 },
  cooperage: { a0: 32.8, a1: 36.5, n0: 3, n1: 9.5, top: 3.2 },
  ramp: { n: 6, aTop: 45.5, yTop: 3.0, aFoot: 37.8 },
  caskR: 0.42, caskL: 0.95,
};
const BR = BREWERY;
const BR_GROUND = 0.13;   // (this is the block's raised base, grid.ts LOT_TOP, under the yard)
// breweryTop gives the brewhouse walls' top (the louvred storey's top), and nameY the name's middle.
export const breweryTop = () => BR.ground + BR.floors * BR.floorH + BR.nameH + BR.louvreH;
export const breweryNameY = () => BR.ground + BR.floors * BR.floorH + BR.nameH / 2;

const BR_COL = {
  brick: VIC.red, brickDark: 0x6c2a1e, stock: VIC.stock, stone: VIC.stone, slate: VIC.slate, lead: 0x6a7078,
  iron: VIC.iron, black: VIC.black, copper: 0xc8783a, copperDark: 0x8a4a24, timber: VIC.timber, louvre: 0x5a4632,
  stave: 0x8c5c30, white: 0xefeadf, dark: 0x16130f, green: VIC.green, gilt: VIC.gilt, hay: 0xc8a850, horse: 0x5a3a22,
  smoke: 0x55504a, steam: 0xeeeae2, fire: 0xff9a3a, setts: 0x6c665c,
};

// BREWERY_DOCK holds the colours city.ts breweryDock dresses the brewery's dock in.
export const BREWERY_DOCK = { stone: 0xa8a090, coping: 0xc4bba8, timber: 0x5e3f26, iron: VIC.black, lamp: VIC.lamp, brick: VIC.red, gilt: VIC.gilt };

const brRot = (F: BreweryFrame) => Math.atan2(-F.al[1], F.al[0]);
const brAt = (F: BreweryFrame, a: number, n: number, y: number): BrP3 => { const [x, z] = F.P(a, n); return [x, y, z]; };
// fbox draws a box from (a0, n0) to (a1, n1), y0 to y1, square to the frame.
function brBox(s: Batch, F: BreweryFrame, a0: number, a1: number, y0: number, y1: number, n0: number, n1: number, c: number) {
  const [x, z] = F.P((a0 + a1) / 2, (n0 + n1) / 2);
  s.box(x, (y0 + y1) / 2, z, Math.abs(a1 - a0), y1 - y0, Math.abs(n1 - n0), c, brRot(F));
}
// rod draws a cylinder from p to q.
const BR_UP = new THREE.Vector3(0, 1, 0), BR_DV = new THREE.Vector3(), BR_Q = new THREE.Quaternion(), BR_E = new THREE.Euler();
function brRod(s: Batch, p: BrP3, q: BrP3, r: number, c: number, seg = 6) {
  BR_DV.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]); const L = BR_DV.length(); if (L < 1e-4) return;
  BR_Q.setFromUnitVectors(BR_UP, BR_DV.normalize()); BR_E.setFromQuaternion(BR_Q, "XYZ");
  s.cyl((p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2, r, L, c, seg, BR_E.x, BR_E.z, BR_E.y);
}
// tri3 draws one triangle facing away from `from` (a point inside the solid it bounds).
function brTri(s: Batch, p: BrP3, q: BrP3, r: BrP3, from: BrP3, c: number) {
  const cx = (p[0] + q[0] + r[0]) / 3 - from[0], cy = (p[1] + q[1] + r[1]) / 3 - from[1], cz = (p[2] + q[2] + r[2]) / 3 - from[2];
  s.tri(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2], c, [cx, cy, cz]);
}
// hipRoof draws a hipped roof over (a0, n0)-(a1, n1) from eaves y rising `rise`, its hips at 45
// degrees in plan, so a square one comes to a point (a pyramid roof).
function brHipRoof(s: Batch, F: BreweryFrame, a0: number, a1: number, n0: number, n1: number, y: number, rise: number, c: number) {
  const wa = a1 - a0, wn = n1 - n0, am = (a0 + a1) / 2, nm = (n0 + n1) / 2, h = Math.min(wa, wn) / 2;
  const r0 = wn >= wa ? brAt(F, am, n0 + h, y + rise) : brAt(F, a0 + h, nm, y + rise);
  const r1 = wn >= wa ? brAt(F, am, n1 - h, y + rise) : brAt(F, a1 - h, nm, y + rise);
  const c00 = brAt(F, a0, n0, y), c10 = brAt(F, a1, n0, y), c11 = brAt(F, a1, n1, y), c01 = brAt(F, a0, n1, y), mid = brAt(F, am, nm, y);
  // (Each face is one or two triangles, between a pair of eave corners and the ridge's ends.)
  const face = (p: BrP3, q: BrP3) => {
    const rp = brDist2(p, r0) < brDist2(p, r1) ? r0 : r1, rq = brDist2(q, r0) < brDist2(q, r1) ? r0 : r1;
    brTri(s, p, q, rq, mid, c);
    if (rp !== rq) brTri(s, p, rq, rp, mid, c);
  };
  face(c00, c10); face(c10, c11); face(c11, c01); face(c01, c00);
}
const brDist2 = (p: BrP3, q: BrP3) => (p[0] - q[0]) ** 2 + (p[2] - q[2]) ** 2;
// louvres draws a louvred panel on the face n (facing out towards -n when `out` is -1, +n when 1,
// and so on for faces across a: `alongA` false), from u0 to u1 along it and y0 to y1: a dark opening
// and slats across it.
function brLouvres(s: Batch, F: BreweryFrame, alongA: boolean, at0: number, out: number, u0: number, u1: number, y0: number, y1: number, k: number) {
  const box = (v0: number, v1: number, ya: number, yb: number, d0: number, d1: number, c: number) =>
    alongA ? brBox(s, F, v0, v1, ya, yb, at0 + out * d0, at0 + out * d1, c) : brBox(s, F, at0 + out * d0, at0 + out * d1, ya, yb, v0, v1, c);
  box(u0, u1, y0, y1, -0.02, 0.02, BR_COL.dark);
  for (let i = 0; i < k; i++) { const y = y0 + (y1 - y0) * (i + 0.6) / k; box(u0, u1, y - 0.1, y + 0.08, 0.03, 0.12, BR_COL.louvre); }
}
// archOpenings draws a wall across a at n from n0 to n1 (thick), a0 to a1 and y0 to y1, with
// round-headed openings of width w at each of `arches` up to archTop (the arch is stepped).
function brArchWall(s: Batch, F: BreweryFrame, n0: number, n1: number, a0: number, a1: number, y0: number, y1: number, arches: readonly number[], w: number, archTop: number, c: number) {
  const hw = w / 2, spring = archTop - hw;
  let a = a0;
  for (const ac of arches) { brBox(s, F, a, ac - hw, y0, y1, n0, n1, c); a = ac + hw; }
  brBox(s, F, a, a1, y0, y1, n0, n1, c);
  for (const ac of arches) {
    brBox(s, F, ac - hw, ac + hw, archTop, y1, n0, n1, c);
    for (let j = 0; j < 4; j++) {
      const ya = spring + hw * j / 4, yb = spring + hw * (j + 1) / 4, wj = hw * Math.sqrt(1 - ((j + 0.5) / 4) ** 2);
      brBox(s, F, ac - hw, ac - wj, ya, yb, n0, n1, c); brBox(s, F, ac + wj, ac + hw, ya, yb, n0, n1, c);
    }
    // a stone keystone and a sill
    brBox(s, F, ac - 0.22, ac + 0.22, archTop - 0.25, archTop + 0.3, n0 - 0.06, n1, BR_COL.stone);
    brBox(s, F, ac - hw - 0.15, ac + hw + 0.15, y0 - 0.12, y0, n0 - 0.12, n1, BR_COL.stone);
  }
}
// cask draws a barrel lying along n (its ends to the street) or standing (`up`), centred at (a, n, y).
function brCask(s: Batch, F: BreweryFrame, a: number, n: number, y: number, up = false, r = BR.caskR, len = BR.caskL) {
  const [x, , z] = brAt(F, a, n, y);
  if (up) {
    s.cyl(x, y, z, r, len, BR_COL.stave, 8);
    for (const d of [-0.32, 0.32]) s.cyl(x, y + d * len, z, r + 0.03, 0.07, BR_COL.black, 8);
    return;
  }
  const [ix, iz] = F.inn, yaw = Math.atan2(ix, iz);
  // (A cylinder laid along n: turned a quarter about x, then about y to face along inn.)
  s.cyl(x, y, z, r, len, BR_COL.stave, 8, Math.PI / 2, 0, yaw);
  for (const d of [-0.32, 0.32]) { const [hx, , hz] = brAt(F, a, n + d * len, y); s.cyl(hx, y, hz, r + 0.03, 0.07, BR_COL.black, 8, Math.PI / 2, 0, yaw); }
}

// ---- the still parts --------------------------------------------------------------------------
// buildBreweryStatic draws the brewery's still parts over and beside the dock in the block's grid
// frame (city.ts buildDockSite: P is frontPt on the site's side), and returns the brewhouse's top.
export function buildBreweryStatic(s: Batch, F: BreweryFrame, L: DockLayout): number {
  const mid = (L.a0 + L.a1) / 2;
  const rect = (a0: number, a1: number, n0: number, n1: number) => {
    const c0 = F.P(a0, n0), c1 = F.P(a1, n1);
    return [Math.min(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[0], c1[0]), Math.max(c0[1], c1[1])] as const;
  };
  // The brewhouse is red brick: a plain storey over the dock, storeys of arched windows, the band
  // with the name in it, then the louvred storey under a stone cornice and a hipped slate roof.
  const nameY0 = BR.ground + BR.floors * BR.floorH, louvreY0 = nameY0 + BR.nameH, top = breweryTop();
  { const [x0, z0, x1, z1] = rect(L.a0, L.a1, L.wall, BR.back);
    facadeBox(s, x0, z0, x1, z1, 0, [{ tile: FACADE.BLANK, floors: 1, floorH: BR.ground }, { tile: FACADE.VICT_MILL, floors: BR.floors, floorH: BR.floorH },
      { tile: FACADE.BLANK, floors: 1, floorH: BR.nameH + BR.louvreH }], BR_COL.brick); }
  // (Its corners are piers of darker brick, and stone bands run round it at the storeys.)
  for (const ca of [L.a0, L.a1]) for (const cn of [L.wall, BR.back]) brBox(s, F, ca - 0.35, ca + 0.35, 0, top, cn - 0.35, cn + 0.35, BR_COL.brickDark);
  for (const y of [BR.ground, nameY0, louvreY0]) {
    brBox(s, F, L.a0 - 0.12, L.a1 + 0.12, y - 0.12, y + 0.12, L.wall - 0.12, BR.back + 0.12, BR_COL.stone);
  }
  // Pilasters of darker brick rise between the window bays (facade.ts BAY: the walls' bays), with a
  // band of stock brick at each storey, on the front and the side to the yard.
  { const front = Math.max(1, Math.round((L.a1 - L.a0) / BAY)), side = Math.max(1, Math.round((BR.back - L.wall) / BAY));
    for (let k = 1; k < front; k++) { const a = L.a0 + (L.a1 - L.a0) * k / front; brBox(s, F, a - 0.22, a + 0.22, BR.ground + 0.12, nameY0 - 0.12, L.wall - 0.16, L.wall, BR_COL.brickDark); }
    for (let k = 1; k < side; k++) { const n = L.wall + (BR.back - L.wall) * k / side; brBox(s, F, L.a1, L.a1 + 0.16, BR.ground + 0.12, nameY0 - 0.12, n - 0.22, n + 0.22, BR_COL.brickDark); }
    for (let f = 1; f < BR.floors; f++) {
      const y = BR.ground + f * BR.floorH;
      brBox(s, F, L.a0, L.a1, y - 0.07, y + 0.07, L.wall - 0.06, L.wall, BR_COL.stock);
      brBox(s, F, L.a1, L.a1 + 0.06, y - 0.07, y + 0.07, L.wall, BR.back, BR_COL.stock);
    } }
  // A brick gable stands on the front over the cornice, its coping in stone and a date stone in it.
  { const y0 = top + 0.45, g0 = brAt(F, mid - 4.2, L.wall - 0.2, y0), g1 = brAt(F, mid + 4.2, L.wall - 0.2, y0), g2 = brAt(F, mid, L.wall - 0.2, y0 + 3.4);
    brTri(s, g0, g1, g2, brAt(F, mid, L.wall + 3, y0), BR_COL.brick);
    for (const e of [g0, g1]) brRod(s, [e[0] + (e[0] - g2[0]) * 0.06, e[1] - 0.1, e[2] + (e[2] - g2[2]) * 0.06], [g2[0], g2[1] + 0.25, g2[2]], 0.2, BR_COL.stone, 4);
    brBox(s, F, mid - 0.9, mid + 0.9, y0 + 0.8, y0 + 1.7, L.wall - 0.26, L.wall - 0.18, BR_COL.stone);
    const [fx, , fz] = brAt(F, mid, L.wall - 0.2, 0); s.ico(fx, y0 + 3.75, fz, 0.3, BR_COL.stone); }
  // A timber lucam (the hoist's housing) juts from the side to the yard, high up, with its beam.
  { const n0 = L.wall + 1.2, n1 = n0 + 2.6, y0 = BR.ground + 2 * BR.floorH - 0.4, y1 = nameY0 - 0.3;
    brBox(s, F, L.a1, L.a1 + 1.3, y0, y1, n0, n1, BR_COL.timber);
    brBox(s, F, L.a1 + 1.3, L.a1 + 1.34, y0 + 0.3, y1 - 0.6, n0 + 0.5, n1 - 0.5, BR_COL.dark);
    const [rx, , rz] = brAt(F, L.a1 + 0.7, (n0 + n1) / 2, 0);
    s.prism(rx, y1 + 0.5, rz, n1 - n0 + 0.3, 1.0, 1.7, BR_COL.slate, brRot(F) + Math.PI / 2);
    brBox(s, F, L.a1 + 1.0, L.a1 + 2.2, y1 + 0.2, y1 + 0.45, (n0 + n1) / 2 - 0.12, (n0 + n1) / 2 + 0.12, BR_COL.timber);
    const [hx, , hz] = brAt(F, L.a1 + 2.0, (n0 + n1) / 2, 0); s.cyl(hx, y1 - 1.2, hz, 0.02, 2.8, BR_COL.black, 3); s.box(hx, y1 - 2.65, hz, 0.14, 0.22, 0.14, BR_COL.black); }
  // the louvres, three bays across the front and back and five down each side
  const lv = (u0: number, u1: number, k: number, f: (v0: number, v1: number) => void) => { const w = (u1 - u0) / k; for (let i = 0; i < k; i++) f(u0 + w * i + 0.7, u0 + w * (i + 1) - 0.7); };
  lv(L.a0 + 0.4, L.a1 - 0.4, 3, (v0, v1) => { brLouvres(s, F, true, L.wall, -1, v0, v1, louvreY0 + 0.35, top - 0.3, 5); brLouvres(s, F, true, BR.back, 1, v0, v1, louvreY0 + 0.35, top - 0.3, 5); });
  lv(L.wall + 0.4, BR.back - 0.4, 5, (v0, v1) => { brLouvres(s, F, false, L.a0, -1, v0, v1, louvreY0 + 0.35, top - 0.3, 5); brLouvres(s, F, false, L.a1, 1, v0, v1, louvreY0 + 0.35, top - 0.3, 5); });
  // the cornice, the roof and its lantern, louvred in turn, with a lead cap and a weathervane
  brBox(s, F, L.a0 - 0.45, L.a1 + 0.45, top, top + 0.45, L.wall - 0.45, BR.back + 0.45, BR_COL.stone);
  brHipRoof(s, F, L.a0 - 0.5, L.a1 + 0.5, L.wall - 0.5, BR.back + 0.5, top + 0.45, BR.roofRise, BR_COL.slate);
  { const ry = top + 0.45 + BR.roofRise, nm = (L.wall + BR.back) / 2, w = 1.9;
    brBox(s, F, mid - w, mid + w, ry - 1.5, ry + 2.6, nm - w, nm + w, BR_COL.white);
    for (const o of [-1, 1]) { brLouvres(s, F, true, nm + o * w, o, mid - w + 0.35, mid + w - 0.35, ry + 0.1, ry + 2.3, 4); brLouvres(s, F, false, mid + o * w, o, nm - w + 0.35, nm + w - 0.35, ry + 0.1, ry + 2.3, 4); }
    brHipRoof(s, F, mid - w - 0.35, mid + w + 0.35, nm - w - 0.35, nm + w + 0.35, ry + 2.6, 1.9, BR_COL.lead);
    const [x, , z] = brAt(F, mid, nm, 0);
    s.cyl(x, ry + 5.2, z, 0.05, 2.2, BR_COL.black, 4); s.box(x, ry + 5.8, z, 1.4, 0.08, 0.08, BR_COL.gilt, brRot(F)); s.ico(x, ry + 4.6, z, 0.18, BR_COL.gilt);
  }
  // a gilt frame round the name (city.ts breweryDock draws it on the name band)
  brBox(s, F, mid - 7.6, mid + 7.6, nameY0 + 0.2, louvreY0 - 0.2, L.wall - 0.1, L.wall - 0.02, BR_COL.gilt);

  // The copper house has two coppers in it, seen through tall arched openings in its front; its
  // flat roof carries the cast-iron liquor tank, and a pipe bridge runs from it to the brewhouse.
  { const C = BR.copper, fn = C.n0;
    brArchWall(s, F, fn, fn + 0.5, C.a0, C.a1, BR_GROUND, C.top, C.arches, C.archW, C.archTop, BR_COL.brick);
    brBox(s, F, C.a0, C.a0 + 0.4, BR_GROUND, C.top, fn + 0.5, C.n1, BR_COL.brick); brBox(s, F, C.a1 - 0.4, C.a1, BR_GROUND, C.top, fn + 0.5, C.n1, BR_COL.brick);
    brBox(s, F, C.a0 + 0.4, C.a1 - 0.4, BR_GROUND, BR_GROUND + 0.05, fn + 0.5, fn + 3.4, BR_COL.dark);       // the floor inside
    brBox(s, F, C.a0 + 0.4, C.a1 - 0.4, BR_GROUND, C.top, fn + 3.4, fn + 3.45, BR_COL.dark);              // the dark inside, behind the coppers
    brBox(s, F, C.a0 + 0.4, C.a1 - 0.4, BR_GROUND, C.top, fn + 3.45, C.n1, BR_COL.brick);
    brBox(s, F, C.a0 - 0.2, C.a1 + 0.2, C.top, C.top + 0.4, fn - 0.2, C.n1 + 0.2, BR_COL.stone);
    for (const ac of C.arches) {
      const [x, , z] = brAt(F, ac, fn + 1.9, 0);
      s.lathe("copper", [[0, 0], [0.85, 0], [1, 0.12], [1, 0.55], [0.86, 0.75], [0.55, 0.92], [0.2, 1]], x, BR_GROUND, z, 1.15, 3.6, BR_COL.copper, 10);
      s.cyl(x, BR_GROUND + 0.3, z, 1.18, 0.6, BR_COL.copperDark, 10);                                    // its brick setting
      // (Its fire door glows orange at night, as a gas flame does: VIC_GASLIGHT.)
      const ax = s.aux.clone(); s.aux.set(0, 0, VIC_GASLIGHT); brBox(s, F, ac - 0.3, ac + 0.3, BR_GROUND + 0.08, BR_GROUND + 0.5, fn + 0.64, fn + 0.72, BR_COL.fire); s.aux.copy(ax);
      s.cyl(x, BR_GROUND + 3.6 + (C.top - 3.6) / 2, z, 0.22, C.top - 3.6, BR_COL.copper, 6);             // the vapour pipe up through the roof
      s.cyl(x, C.top + 1.1, z, 0.3, 1.4, BR_COL.copper, 6); s.cone(x, C.top + 2.1, z, 0.5, 0.6, BR_COL.copperDark, 6);
    }
    // the tank: iron plates in a grid of flanges, on bearers
    const t0 = C.top + 0.4, t1 = t0 + 2.6;
    brBox(s, F, C.a0 + 0.6, C.a1 - 0.6, t0, t0 + 0.3, C.n1 - 5.2, C.n1 - 0.6, BR_COL.black);
    brBox(s, F, C.a0 + 0.7, C.a1 - 0.7, t0 + 0.3, t1, C.n1 - 5.1, C.n1 - 0.7, BR_COL.iron);
    for (let k = 0; k <= 4; k++) { const a = C.a0 + 0.7 + (C.a1 - C.a0 - 1.4) * k / 4; brBox(s, F, a - 0.06, a + 0.06, t0 + 0.3, t1 + 0.08, C.n1 - 5.18, C.n1 - 0.62, BR_COL.black); }
    brBox(s, F, C.a0 + 0.62, C.a1 - 0.62, t0 + 1.4, t0 + 1.52, C.n1 - 5.18, C.n1 - 0.62, BR_COL.black);
    brBox(s, F, C.a0 + 0.62, C.a1 - 0.62, t1, t1 + 0.12, C.n1 - 5.18, C.n1 - 0.62, BR_COL.black);
    // the pipe bridge from the tank and the coppers to the brewhouse
    for (const [y, r, n] of [[t0 + 1.2, 0.2, C.n1 - 3], [C.top + 1.5, 0.28, fn + 2.4], [C.top + 2.4, 0.18, fn + 2.9]] as const)
      brRod(s, brAt(F, L.a1, n, y), brAt(F, n > C.n1 - 4 ? C.a0 + 0.7 : C.a0 + 0.2, n, y), r, n > C.n1 - 4 ? BR_COL.black : BR_COL.copper, 6);
    brBox(s, F, L.a1, C.a0, C.top + 0.95, C.top + 1.1, fn + 1.8, fn + 3.4, BR_COL.iron);               // a catwalk under them
  }

  // The engine house is stock brick with a slate roof and a tall front gable; its beam engine
  // stands before it: two fluted iron columns carry the beam's bearing, the flywheel turns in its
  // pit on stone pedestals, and the cylinder stands at the far end (SteamBreweryFx moves them).
  { const E = BR.engine, [x0, z0, x1, z1] = rect(E.a0, E.a1, E.n0, E.n1);
    const et = facadeBox(s, x0, z0, x1, z1, BR_GROUND, [{ tile: FACADE.VICT_MILL, floors: 2, floorH: (E.top - BR_GROUND) / 2 }], BR_COL.stock);
    for (const ca of [E.a0, E.a1]) brBox(s, F, ca - 0.3, ca + 0.3, BR_GROUND, et, E.n0 - 0.3, E.n1 + 0.3, BR_COL.brick);
    brBox(s, F, E.a0 - 0.15, E.a1 + 0.15, et - 0.25, et, E.n0 - 0.15, E.n1 + 0.15, BR_COL.stone);
    const [rx, , rz] = brAt(F, (E.a0 + E.a1) / 2, (E.n0 + E.n1) / 2, 0);
    s.prism(rx, et + E.gable / 2, rz, E.n1 - E.n0 + 0.8, E.gable, E.a1 - E.a0 + 0.8, BR_COL.slate, brRot(F) + Math.PI / 2);
    // (The front gable is brick, a little proud of the roof's end, with a stone coping and a round window.)
    const am = (E.a0 + E.a1) / 2, g0 = brAt(F, E.a0, E.n0 - 0.05, et), g1 = brAt(F, E.a1, E.n0 - 0.05, et), g2 = brAt(F, am, E.n0 - 0.05, et + E.gable);
    brTri(s, g0, g1, g2, brAt(F, am, E.n0 + 2, et), BR_COL.stock);
    brRod(s, brAt(F, E.a0 - 0.4, E.n0 - 0.15, et - 0.1), brAt(F, am, E.n0 - 0.15, et + E.gable + 0.2), 0.2, BR_COL.stone, 4);
    brRod(s, brAt(F, E.a1 + 0.4, E.n0 - 0.15, et - 0.1), brAt(F, am, E.n0 - 0.15, et + E.gable + 0.2), 0.2, BR_COL.stone, 4);
    const [ox, , oz] = brAt(F, am, E.n0 - 0.1, et + 1.1), [ix, iz] = F.inn;
    s.cyl(ox, et + 1.1, oz, 0.75, 0.12, BR_COL.stone, 12, Math.PI / 2, 0, Math.atan2(ix, iz)); s.cyl(ox, et + 1.1, oz, 0.55, 0.14, BR_COL.dark, 12, Math.PI / 2, 0, Math.atan2(ix, iz));
    // the columns and their entablature
    const Bm = BR.beam;
    for (const dn of [-0.65, 0.65]) {
      const [cx, , cz] = brAt(F, Bm.a, Bm.n + dn, 0);
      s.box(cx, BR_GROUND + 0.4, cz, 1.0, 0.8, 1.0, BR_COL.stone);
      s.cyl(cx, (BR_GROUND + 0.8 + Bm.y - 0.5) / 2, cz, 0.24, Bm.y - 0.5 - BR_GROUND - 0.8, BR_COL.green, 8);
      s.box(cx, Bm.y - 0.45, cz, 0.7, 0.3, 0.7, BR_COL.gilt);
      s.box(cx, BR_GROUND + 0.95, cz, 0.6, 0.3, 0.6, BR_COL.gilt);
    }
    brRod(s, brAt(F, Bm.a, Bm.n - 0.9, Bm.y), brAt(F, Bm.a, Bm.n + 0.9, Bm.y), 0.18, BR_COL.black, 6);       // the beam's shaft through its bearings
    brRod(s, brAt(F, Bm.a, Bm.n + 0.65, Bm.y - 0.3), brAt(F, Bm.a, E.n0, Bm.y - 0.3), 0.15, BR_COL.green, 4);   // a tie back to the gable
    // the flywheel's pit, pedestals and shaft
    const W = BR.wheel;
    brBox(s, F, W.a - W.r - 0.4, W.a + W.r + 0.4, BR_GROUND, BR_GROUND + 0.02, W.n - 0.7, W.n + 0.7, BR_COL.dark);
    brBox(s, F, W.a - 0.5, W.a + 0.5, BR_GROUND, W.y - 0.2, W.n + 0.4, W.n + 0.9, BR_COL.stone);   // (the bearing pedestal stands behind the wheel)
    brRod(s, brAt(F, W.a, W.n - 0.45, W.y), brAt(F, W.a, E.n0, W.y), 0.16, BR_COL.black, 6);
    // the governor's lay shaft off the crankshaft, its bevel boxes and the pillar it stands on
    const Gv = BR.governor;
    brRod(s, brAt(F, W.a, Gv.n, W.y), brAt(F, Gv.a, Gv.n, W.y), 0.09, BR_COL.black, 5);
    for (const a of [W.a, Gv.a]) brBox(s, F, a - 0.22, a + 0.22, W.y - 0.22, W.y + 0.22, Gv.n - 0.22, Gv.n + 0.22, BR_COL.iron);
    brBox(s, F, Gv.a - 0.16, Gv.a + 0.16, BR_GROUND, W.y - 0.22, Gv.n - 0.16, Gv.n + 0.16, BR_COL.green);
    // the cylinder: lagged in timber with iron bands, on a stone block
    const Cy = BR.cyl, [kx, , kz] = brAt(F, Cy.a, Bm.n, 0);
    s.box(kx, BR_GROUND + 0.35, kz, 2.0, 0.7, 2.0, BR_COL.stone);
    s.cyl(kx, (BR_GROUND + 0.7 + Cy.y1) / 2, kz, Cy.r, Cy.y1 - BR_GROUND - 0.7, BR_COL.timber, 10);
    for (const y of [BR_GROUND + 0.85, (Cy.y1 + BR_GROUND) / 2, Cy.y1 - 0.15]) s.cyl(kx, y, kz, Cy.r + 0.06, 0.18, BR_COL.black, 10);
    s.cyl(kx, Cy.y1 + 0.15, kz, 0.4, 0.3, BR_COL.gilt, 8);
    brRod(s, brAt(F, Cy.a, Bm.n, Cy.y1 - 1.0), brAt(F, Cy.a, E.n0, Cy.y1 - 1.0), 0.16, BR_COL.copper, 6);   // the steam pipe in from the boiler house
  }

  // The malt kiln is red brick with a steep pyramid roof of slate, topped by the cowl's throat (the
  // cowl turns on it: SteamBreweryFx).
  { const K = BR.kiln, [x0, z0, x1, z1] = rect(K.a0, K.a1, K.n0, K.n1);
    const kt = facadeBox(s, x0, z0, x1, z1, BR_GROUND, [{ tile: FACADE.BLANK, floors: 1, floorH: K.top - BR_GROUND }], BR_COL.brick);
    brBox(s, F, K.a0 - 0.2, K.a1 + 0.2, kt - 0.3, kt, K.n0 - 0.2, K.n1 + 0.2, BR_COL.stone);
    brHipRoof(s, F, K.a0 - 0.4, K.a1 + 0.4, K.n0 - 0.4, K.n1 + 0.4, kt, K.rise, BR_COL.slate);
    const [x, , z] = brAt(F, (K.a0 + K.a1) / 2, (K.n0 + K.n1) / 2, 0);
    s.box(x, kt + K.rise - 0.6, z, 1.6, 1.6, 1.6, BR_COL.white, brRot(F));
    s.cyl(x, kt + K.rise + 0.35, z, 0.75, 0.3, BR_COL.white, 10);
  }

  // The boiler house is low, with the chimney standing free at its back on its square base, the
  // flue from the boilers running into it low down: octagonal, tapering, with a corbelled stone cap
  // and an iron band.
  { const Bo = BR.boiler, [x0, z0, x1, z1] = rect(Bo.a0, Bo.a1, Bo.n0, Bo.n1);
    const bt = facadeBox(s, x0, z0, x1, z1, BR_GROUND, [{ tile: FACADE.VICT_MILL, floors: 1, floorH: Bo.top - BR_GROUND }], BR_COL.stock);
    brHipRoof(s, F, Bo.a0 - 0.3, Bo.a1 + 0.3, Bo.n0 - 0.3, Bo.n1 + 0.3, bt, 1.6, BR_COL.slate);
    const Ch = BR.chimney, [x, , z] = brAt(F, Ch.a, Ch.n, 0);
    brBox(s, F, Ch.a - 0.9, Ch.a + 0.9, BR_GROUND, 2.4, Bo.n1, Ch.n, BR_COL.brickDark);
    s.box(x, BR_GROUND + 3, z, Ch.r0 * 2 + 0.6, 6, Ch.r0 * 2 + 0.6, BR_COL.brickDark, brRot(F));
    s.lathe("chimney", [[1, 0], [Ch.r1 / Ch.r0, 1]], x, BR_GROUND + 6, z, Ch.r0, Ch.h - 6, BR_COL.brick, 8, Math.PI / 8);
    s.cyl(x, Ch.h - 1.3, z, Ch.r1 + 0.08, 0.35, BR_COL.black, 8, 0, 0, Math.PI / 8);
    s.cyl(x, Ch.h + 0.25, z, Ch.r1 + 0.35, 0.5, BR_COL.stone, 8, 0, 0, Math.PI / 8);
    s.cyl(x, Ch.h + 0.7, z, Ch.r1 + 0.2, 0.4, BR_COL.brickDark, 8, 0, 0, Math.PI / 8);
  }

  // The stable is stock brick with its gable to the street: two stable doors with their top
  // halves open and a dray horse looking out of one, the loft door above with its hoist beam, and
  // in its side the cask loft's door at the head of the ramp.
  { const S = BR.stable, [x0, z0, x1, z1] = rect(S.a0, S.a1, S.n0, S.n1);
    const st = facadeBox(s, x0, z0, x1, z1, BR_GROUND, [{ tile: FACADE.BLANK, floors: 1, floorH: S.eaves - BR_GROUND }], BR_COL.stock);
    const am = (S.a0 + S.a1) / 2, [rx, , rz] = brAt(F, am, (S.n0 + S.n1) / 2, 0);
    s.prism(rx, st + (S.ridge - st) / 2, rz, S.n1 - S.n0 + 0.6, S.ridge - st, S.a1 - S.a0 + 0.6, BR_COL.slate, brRot(F) + Math.PI / 2);
    brTri(s, brAt(F, S.a0, S.n0 - 0.04, st), brAt(F, S.a1, S.n0 - 0.04, st), brAt(F, am, S.n0 - 0.04, S.ridge), brAt(F, am, S.n0 + 2, st), BR_COL.stock);
    for (const [d0, d1] of [[46.3, 47.7], [48.3, 49.7]]) {
      brBox(s, F, d0 - 0.12, d1 + 0.12, BR_GROUND, 2.55, S.n0 - 0.08, S.n0 - 0.02, BR_COL.stone);
      brBox(s, F, d0, d1, BR_GROUND, 1.35, S.n0 - 0.12, S.n0 - 0.06, BR_COL.green);
      brBox(s, F, d0, d1, 1.35, 2.45, S.n0 - 0.1, S.n0 - 0.06, BR_COL.dark);
      brBox(s, F, d0 + 0.6, d1 - 0.6, BR_GROUND, 1.35, S.n0 - 0.14, S.n0 - 0.12, BR_COL.black);
    }
    // the horse: a head and neck over the half door, a white blaze down its face
    { const [hx, , hz] = brAt(F, 47.0, S.n0 - 0.45, 0), yaw = brRot(F) + 0.25;
      s.boxR(hx, 1.95, hz, 0.38, 0.95, 0.5, BR_COL.horse, -0.5, yaw, 0);
      const [fx, , fz] = brAt(F, 47.0, S.n0 - 0.95, 0); s.boxR(fx, 1.75, fz, 0.32, 0.36, 0.75, BR_COL.horse, 0.35, yaw, 0);
      s.boxR(fx, 1.8, fz, 0.12, 0.38, 0.77, BR_COL.white, 0.35, yaw, 0);
      for (const d of [-0.1, 0.1]) { const [ex, , ez] = brAt(F, 47.0 + d, S.n0 - 0.75, 0); s.box(ex, 2.18, ez, 0.07, 0.2, 0.07, BR_COL.horse); } }
    // the loft door, a hay bale in it, and the hoist beam
    brBox(s, F, am - 0.7, am + 0.7, st + 0.1, st + 1.5, S.n0 - 0.1, S.n0 - 0.04, BR_COL.dark);
    brBox(s, F, am - 0.5, am + 0.5, st + 0.1, st + 0.6, S.n0 - 0.3, S.n0 - 0.05, BR_COL.hay);
    brBox(s, F, am - 0.14, am + 0.14, S.ridge - 0.9, S.ridge - 0.6, S.n0 - 1.4, S.n0 + 0.2, BR_COL.timber);
    { const [px, , pz] = brAt(F, am, S.n0 - 1.25, 0); s.cyl(px, S.ridge - 1.6, pz, 0.015, 1.4, BR_COL.black, 3); s.box(px, S.ridge - 2.35, pz, 0.12, 0.18, 0.12, BR_COL.black); }
    // the cask loft's door, onto the ramp
    const R = BR.ramp;
    brBox(s, F, S.a0 - 0.06, S.a0 - 0.02, R.yTop - 0.1, R.yTop + 1.3, R.n - 0.65, R.n + 0.65, BR_COL.dark);
    brBox(s, F, S.a0 - 0.1, S.a0 - 0.02, R.yTop + 1.3, R.yTop + 1.45, R.n - 0.8, R.n + 0.8, BR_COL.stone);
  }

  // The cooperage is a boarded shed with its gable to the street, a slate roof and a brick stack at
  // the back for the fire the coopers fire their casks over, and its door to the ramp's foot; casks
  // roll down the ramp's two rails from the cask loft, on timber trestles, and in at its door.
  { const Co = BR.cooperage, R = BR.ramp, am = (Co.a0 + Co.a1) / 2, pitch = 1.7;
    brBox(s, F, Co.a0, Co.a1, BR_GROUND, Co.top, Co.n0, Co.n1, BR_COL.timber);
    for (let a = Co.a0 + 0.5; a < Co.a1; a += 0.9) brBox(s, F, a - 0.05, a + 0.05, BR_GROUND, Co.top, Co.n0 - 0.04, Co.n0, 0x4e3624);   // its boards
    brBox(s, F, Co.a1, Co.a1 + 0.04, BR_GROUND, 1.45, R.n - 0.7, R.n + 0.7, BR_COL.dark);
    const [rx, , rz] = brAt(F, am, (Co.n0 + Co.n1) / 2, 0);
    s.prism(rx, Co.top + pitch / 2, rz, Co.n1 - Co.n0 + 0.5, pitch, Co.a1 - Co.a0 + 0.5, BR_COL.slate, brRot(F) + Math.PI / 2);
    brTri(s, brAt(F, Co.a0, Co.n0 - 0.04, Co.top), brAt(F, Co.a1, Co.n0 - 0.04, Co.top), brAt(F, am, Co.n0 - 0.04, Co.top + pitch), brAt(F, am, Co.n0 + 2, Co.top), BR_COL.timber);
    brBox(s, F, Co.a0 + 0.5, Co.a0 + 1.3, Co.top - 0.5, Co.top + pitch + 1.0, Co.n1 - 1.6, Co.n1 - 0.9, BR_COL.brick);
    const len = R.aTop - R.aFoot, rise = R.yTop - BR_GROUND;
    for (const dn of [-0.38, 0.38]) {
      brRod(s, brAt(F, R.aFoot, R.n + dn, BR_GROUND + 0.06), brAt(F, R.aTop, R.n + dn, R.yTop), 0.07, BR_COL.timber, 4);
      brRod(s, brAt(F, Co.a1, R.n + dn, BR_GROUND + 0.06), brAt(F, R.aFoot, R.n + dn, BR_GROUND + 0.06), 0.07, BR_COL.timber, 4);
    }
    for (let k = 1; k <= 3; k++) {
      const a = R.aFoot + len * k / 4, y = BR_GROUND + rise * k / 4;
      for (const dn of [-0.45, 0.45]) brBox(s, F, a - 0.07, a + 0.07, BR_GROUND, y, R.n + dn - 0.07, R.n + dn + 0.07, BR_COL.timber);
      brBox(s, F, a - 0.07, a + 0.07, y - 0.2, y - 0.06, R.n - 0.5, R.n + 0.5, BR_COL.timber);
    }
  }
  // the barrels: stacks behind the ramp, ends to the street, and a few standing about
  { const r = BR.caskR, d = 2 * r + 0.04;
    for (const [a0, nB, rows] of [[37.4, 10.6, 4], [41.6, 10.6, 3], [38.2, 2.2, 2]] as const)
      for (let row = 0; row < rows; row++) for (let i = 0; i < rows - row; i++) brCask(s, F, a0 + i * d + row * r, nB, BR_GROUND + r + row * r * 1.75);
    for (const [a, n] of [[43.6, 2.0], [44.4, 2.4], [43.9, 3.2], [32.9, 11.6], [33.8, 11.9]] as const) brCask(s, F, a, n, BR_GROUND + BR.caskL / 2, true);
  }
  // The yard is paved in setts (a hair over the block's base, which it would flicker against).
  brBox(s, F, 32.8, 51, BR_GROUND, BR_GROUND + 0.015, 0.6, 41.5, BR_COL.setts);
  // A low brick wall with iron railings runs along the street in front of the yard.
  brBox(s, F, 32.8, BR.stable.a0, BR_GROUND, 0.6, 0.3, 0.6, BR_COL.brick);
  brBox(s, F, 32.8, BR.stable.a0, 0.6, 0.68, 0.26, 0.64, BR_COL.stone);
  brBox(s, F, 32.8, BR.stable.a0, 1.55, 1.6, 0.42, 0.48, BR_COL.black);
  for (let a = 33.0; a < BR.stable.a0; a += 0.32) brBox(s, F, a - 0.025, a + 0.025, 0.68, 1.7, 0.43, 0.47, BR_COL.black);
  return top + BR.roofRise;
}

// ---- the moving parts -------------------------------------------------------------------------
// SteamBreweryFx is built in the world when a Victorian city is (main.ts buildCity) and posed by
// scene time alone (update), so scrubbing replays it: the beam engine (its beam rocking, flywheel,
// connecting rod, piston rod and governor), the kiln's cowl, the casks rolling down the ramp, and
// the smoke and steam from the chimney, the cowl, the coppers and the engine's exhaust.
// The engine's linkage is solved from the crank's angle each frame. The connecting rod keeps its
// length from the crank pin to the beam's end, and the beam turns about its pivot to meet it. The
// piston rod hangs from the beam's other end and slides at its own length in the cylinder's gland.
const BR_ENGINE_RATE = 1.15;   // the flywheel's turn, radians a second
const BR_GOVERNOR_GEAR = 6;    // the governor's turns to the flywheel's
const BR_PISTON_ROD = 9.4;     // the piston rod's length, so its foot stays in the cylinder at the top of the stroke
interface BrPuffSource { o: THREE.Vector3; k: number; rate: number; size: number; rise: number; drift: number; color: THREE.Color; phase: number }
export class SteamBreweryFx {
  private group = new THREE.Group();
  private wheel: THREE.Object3D | null = null;
  private beam: THREE.Object3D | null = null;
  private connRod: THREE.Object3D | null = null;
  private pistonRod: THREE.Object3D | null = null;
  private governor: THREE.Object3D | null = null;
  private cowl: THREE.Object3D | null = null;
  private casks: THREE.Object3D[] = [];
  private puffs: THREE.InstancedMesh | null = null;
  private sources: BrPuffSource[] = [];
  private F: BreweryFrame | null = null;
  // (axis is al x up: a positive turn about it carries al towards up, whichever way round the frame is.)
  private inn = new THREE.Vector3(); private al = new THREE.Vector3(); private axis = new THREE.Vector3(); private wind = new THREE.Vector3();
  private m = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private v2 = new THREE.Vector3(); private sc = new THREE.Vector3();
  built = "";

  constructor(private readonly world: THREE.Object3D, private readonly mat: THREE.Material) { world.add(this.group); }

  clear() {
    for (const o of [...this.group.children]) { this.group.remove(o); o.traverse((c) => { if (c instanceof THREE.Mesh) c.geometry.dispose(); }); }
    if (this.puffs) { (this.puffs.material as THREE.Material).dispose(); this.puffs.dispose(); }
    this.wheel = this.beam = this.connRod = this.pistonRod = this.governor = this.cowl = null; this.casks = []; this.puffs = null; this.sources = []; this.F = null; this.built = "";
  }

  build(plan: CityPlan, layout: (bx: number, bz: number) => DockLayout | null) {
    this.clear();
    const id = plan.worksBlock; if (id < 0 || !plan.style.victorian) return;
    const Bk = plan.graph.blocks[id], L = layout(Bk.kx, Bk.kz);
    if (!L || !Bk.anchor) return;
    const G = plan.graph, face = Bk.anchor.face, delta = Bk.anchor.delta;
    this.buildAt(breweryFrameOf((a, n) => { const p = G.facePt(face, a + delta, n); return [p.x, p.z]; }));
    this.built = `${plan.seed}`;
  }

  // buildAt builds the moving parts in frame F (a tool scene builds them here directly).
  buildAt(F: BreweryFrame) {
    this.F = F;
    this.inn.set(F.inn[0], 0, F.inn[1]).normalize(); this.al.set(F.al[0], 0, F.al[1]).normalize(); this.axis.crossVectors(this.al, BR_UP);
    this.wind.copy(this.al).multiplyScalar(0.8).addScaledVector(this.inn, 0.45);
    const piece = (make: (b: Batch) => void, pivot: BrP3) => {
      const b = new Batch(); make(b); const m = b.build(this.mat); if (!m) return new THREE.Object3D();
      m.geometry.translate(-pivot[0], -pivot[1], -pivot[2]); m.position.set(pivot[0], pivot[1], pivot[2]); this.group.add(m); return m;
    };
    // the flywheel: a heavy rim in segments, six spokes, a hub and the crank and its pin on the front
    const W = BR.wheel, wc = brAt(F, W.a, W.n, W.y), [ix, iz] = F.inn, yawN = Math.atan2(ix, iz);
    this.wheel = piece((b) => {
      for (let i = 0; i < 18; i++) {
        const t0 = (i / 18) * Math.PI * 2, t1 = ((i + 1) / 18) * Math.PI * 2;
        brRod(b, brAt(F, W.a + Math.cos(t0) * W.r, W.n, W.y + Math.sin(t0) * W.r), brAt(F, W.a + Math.cos(t1) * W.r, W.n, W.y + Math.sin(t1) * W.r), 0.24, BR_COL.green, 4);
      }
      for (let i = 0; i < 6; i++) { const t = (i / 6) * Math.PI * 2; brRod(b, wc, brAt(F, W.a + Math.cos(t) * (W.r - 0.15), W.n, W.y + Math.sin(t) * (W.r - 0.15)), 0.09, BR_COL.green, 4); }
      b.cyl(wc[0], wc[1], wc[2], 0.42, 0.5, BR_COL.black, 8, Math.PI / 2, 0, yawN);
      brRod(b, brAt(F, W.a, W.n - 0.3, W.y), brAt(F, W.a + W.crank, W.n - 0.3, W.y), 0.16, BR_COL.gilt, 4);   // the crank, out to its pin at angle 0
      const cp = brAt(F, W.a + W.crank, W.n - 0.4, W.y); b.cyl(cp[0], cp[1], cp[2], 0.12, 0.35, BR_COL.black, 6, Math.PI / 2, 0, yawN);
    }, wc);
    // the beam: cast iron, fish-bellied, lined in gilt, with its ends' bosses
    const Bm = BR.beam, bc = brAt(F, Bm.a, Bm.n, Bm.y);
    this.beam = piece((b) => {
      const k = 6;
      for (let i = 0; i < k; i++) {
        const u0 = -Bm.half + (2 * Bm.half * i) / k, u1 = u0 + (2 * Bm.half) / k, um = (u0 + u1) / 2, depth = 0.35 + 0.7 * (1 - (um / Bm.half) ** 2);
        brBox(b, F, Bm.a + u0, Bm.a + u1 + 0.01, Bm.y - depth / 2, Bm.y + depth / 2, Bm.n - 0.12, Bm.n + 0.12, BR_COL.green);
        brBox(b, F, Bm.a + u0, Bm.a + u1 + 0.01, Bm.y + depth / 2 - 0.08, Bm.y + depth / 2 + 0.02, Bm.n - 0.16, Bm.n + 0.16, BR_COL.gilt);
      }
      for (const u of [-Bm.half, 0, Bm.half]) { const p = brAt(F, Bm.a + u, Bm.n, Bm.y); b.cyl(p[0], p[1], p[2], u ? 0.26 : 0.42, 0.42, BR_COL.black, 8, Math.PI / 2, 0, yawN); }
    }, bc);
    // The rods are built at their own lengths, stood up from their foot, and turned into place
    // (update): the connecting rod with its brasses at both ends, the piston rod with its crosshead.
    const Lc = Math.hypot(W.crank, Bm.y - W.y);
    this.connRod = piece((b) => { b.cyl(0, Lc / 2, 0, 0.14, Lc, BR_COL.green, 6); for (const y of [0.1, Lc - 0.1]) b.cyl(0, y, 0, 0.22, 0.3, BR_COL.black, 6); }, [0, 0, 0]);
    this.pistonRod = piece((b) => { b.cyl(0, BR_PISTON_ROD / 2, 0, 0.1, BR_PISTON_ROD, 0xb8b4aa, 6); b.box(0, BR_PISTON_ROD - 0.15, 0, 0.36, 0.3, 0.36, BR_COL.black); }, [0, 0, 0]);
    // The governor is a spindle with two arms hinged at its head, a ball on each and links down to
    // the sleeve, spun about the spindle (update). It turns at a steady speed, so its balls stand
    // out at the one angle where they balance, where cos = g / (w^2 arm).
    const Gv = BR.governor, gc = brAt(F, Gv.a, Gv.n, Gv.y), wG = BR_ENGINE_RATE * BR_GOVERNOR_GEAR;
    const tilt = Math.acos(Math.min(1, 9.81 / (wG * wG * Gv.arm))), bx = Gv.arm * Math.sin(tilt), by = Gv.arm * Math.cos(tilt);
    this.governor = piece((b) => {
      b.cyl(gc[0], gc[1] - 1.1, gc[2], 0.05, 2.3, BR_COL.black, 4);
      b.cone(gc[0], gc[1] + 0.25, gc[2], 0.12, 0.3, BR_COL.gilt, 6);
      b.cyl(gc[0], gc[1] - by * 0.95, gc[2], 0.1, 0.18, BR_COL.gilt, 6);                          // the sleeve
      for (const s of [-1, 1]) {
        const ball: BrP3 = [gc[0] + s * bx, gc[1] - by, gc[2]], mid: BrP3 = [gc[0] + s * bx / 2, gc[1] - by / 2, gc[2]];
        brRod(b, gc, ball, 0.035, BR_COL.black, 4);
        brRod(b, mid, [gc[0], gc[1] - by * 0.95, gc[2]], 0.03, BR_COL.black, 4);
        b.ico(ball[0], ball[1], ball[2], 0.15, BR_COL.gilt);
      }
    }, gc);
    // The cowl is a white hood on a drum, open to one side, and its fan stands out over the
    // opening. The wind blows the fan, and the opening with it, round to leeward.
    const K = BR.kiln, kc = brAt(F, (K.a0 + K.a1) / 2, (K.n0 + K.n1) / 2, K.top + K.rise + 0.5);
    this.cowl = piece((b) => {
      b.cyl(kc[0], kc[1] + 0.8, kc[2], 0.72, 1.6, BR_COL.white, 10);
      b.lathe("cowlcap", [[1, 0], [0.8, 0.5], [0.3, 0.9], [0, 1]], kc[0], kc[1] + 1.6, kc[2], 0.78, 0.9, BR_COL.white, 10);
      b.box(kc[0] + 0.62, kc[1] + 0.9, kc[2], 0.3, 1.1, 1.0, BR_COL.dark);           // the opening, to +x before it turns
      b.box(kc[0] + 1.1, kc[1] + 2.0, kc[2], 1.6, 0.9, 0.08, BR_COL.white);          // the fan, out over it
      b.cyl(kc[0], kc[1] + 2.7, kc[2], 0.04, 0.6, BR_COL.black, 4); b.ico(kc[0], kc[1] + 3.05, kc[2], 0.12, BR_COL.gilt);
    }, kc);
    // the casks that roll (stood at the frame's origin, along n, posed in update)
    const R = BR.ramp, cp = brAt(F, R.aTop, R.n, 0);
    for (let i = 0; i < 3; i++) this.casks.push(piece((b) => brCask(b, F, R.aTop, R.n, 0), cp));
    // the puffs: one instanced mesh of hard-edged cubes, as puffs.ts draws them
    const src = (p: BrP3, k: number, rate: number, size: number, rise: number, drift: number, color: number, phase = 0) =>
      this.sources.push({ o: new THREE.Vector3(...p), k, rate, size, rise, drift, color: new THREE.Color(color), phase });
    const Ch = BR.chimney;
    src(brAt(F, Ch.a, Ch.n, Ch.h + 0.9), 9, 0.11, 1.5, 6, 18, BR_COL.smoke);
    src(brAt(F, (K.a0 + K.a1) / 2, (K.n0 + K.n1) / 2, K.top + K.rise + 2.6), 5, 0.16, 0.8, 4, 6, 0xd8d4cc);
    for (const ac of BR.copper.arches) src(brAt(F, ac, BR.copper.n0 + 1.9, BR.copper.top + 2.4), 4, 0.22, 0.32, 3.5, 3, BR_COL.steam);
    // (The engine is double-acting and exhausts at each end of the stroke, when the crank points
    // straight up or down. Each of the three puffs comes every third stroke.)
    src(brAt(F, BR.cyl.a, BR.beam.n, BR.cyl.y1 + 0.3), 3, BR_ENGINE_RATE / (3 * Math.PI), 0.5, 2.2, 1.5, BR_COL.steam, -1 / 6);
    const n = this.sources.reduce((s, x) => s + x.k, 0);
    this.puffs = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), n);
    this.puffs.frustumCulled = false;
    let i = 0;
    for (const s of this.sources) for (let k = 0; k < s.k; k++) this.puffs.setColorAt(i++, s.color);
    this.group.add(this.puffs);
  }

  update(t: number) {
    const F = this.F; if (!F || !this.wheel || !this.beam || !this.connRod || !this.pistonRod) return;
    const W = BR.wheel, Bm = BR.beam, h = Bm.half, th = t * BR_ENGINE_RATE;
    this.wheel.quaternion.setFromAxisAngle(this.axis, th);
    if (this.governor) this.governor.quaternion.setFromAxisAngle(BR_UP, th * BR_GOVERNOR_GEAR);
    // The crank pin is at angle th round the wheel's centre in the a-y plane. The beam's near end is
    // where the circle it swings on about the pivot meets the circle the connecting rod's top can
    // reach about the pin, on the wheel's side. The rod is as long as it is when the beam lies level.
    const pinA = W.a + W.crank * Math.cos(th), pinY = W.y + W.crank * Math.sin(th), Lc = Math.hypot(W.crank, Bm.y - W.y);
    const dx = pinA - Bm.a, dy = pinY - Bm.y, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
    const along = (d * d + h * h - Lc * Lc) / (2 * d), across = Math.sqrt(Math.max(0, h * h - along * along));
    const nearA = Bm.a + along * ux + across * uy, nearY = Bm.y + along * uy - across * ux;
    const phi = Math.atan2(Bm.y - nearY, Bm.a - nearA);
    this.beam.quaternion.setFromAxisAngle(this.axis, phi);
    this.place(this.connRod, brAt(F, pinA, Bm.n, pinY), brAt(F, nearA, Bm.n, nearY));
    // The piston rod hangs from the far end and points down through the gland on the cylinder's
    // top. (The far end sways sideways by a few centimetres, so the rod leans by under a degree.)
    const far = brAt(F, Bm.a + h * Math.cos(phi), Bm.n, Bm.y + h * Math.sin(phi)), gland = brAt(F, BR.cyl.a, Bm.n, BR.cyl.y1 + 0.3);
    this.v2.set(far[0] - gland[0], far[1] - gland[1], far[2] - gland[2]).normalize();
    this.place(this.pistonRod, [far[0] - this.v2.x * BR_PISTON_ROD, far[1] - this.v2.y * BR_PISTON_ROD, far[2] - this.v2.z * BR_PISTON_ROD], far);
    // The cowl's opening turns to leeward, hunting a little about it in the gusts.
    if (this.cowl) this.cowl.quaternion.setFromAxisAngle(BR_UP, Math.atan2(-this.wind.z, this.wind.x) + 0.12 * Math.sin(t * 0.37) + 0.06 * Math.sin(t * 1.1 + 1.3));
    // the casks come out of the loft door in turn, roll down the ramp and along into the cooperage
    const R = BR.ramp, Co = BR.cooperage, r = BR.caskR, slope = R.aTop - R.aFoot, flat = R.aFoot - Co.a1, path = slope + flat + 1.4, T = 7.5;
    this.casks.forEach((c, k) => {
      const u = ((t / T + k / this.casks.length) % 1 + 1) % 1, d = -0.7 + path * u * u * (1.6 - 0.6 * u);   // (it gathers speed down the ramp)
      const a = R.aTop - d, onRamp = a > R.aFoot, y = onRamp ? BR_GROUND + (R.yTop - BR_GROUND) * (a - R.aFoot) / slope : BR_GROUND;
      c.visible = a < R.aTop + 0.2 && a > Co.a1 - 0.2;
      const p = brAt(F, a, R.n, y + r + 0.07);
      c.position.set(p[0], p[1], p[2]);
      // (Laid along n, it turns about n as it rolls towards -a.)
      c.quaternion.setFromAxisAngle(this.axis, d / r);
    });
    // the puffs rise, swell, drift downwind and shrink away, each source's in turn
    if (this.puffs) {
      let i = 0;
      for (const s of this.sources) for (let k = 0; k < s.k; k++) {
        const age = ((t * s.rate + k / s.k + s.phase) % 1 + 1) % 1;
        const g = 0.5 + 0.5 * Math.sin(k * 2.3);
        this.v.copy(s.o).addScaledVector(this.wind, s.drift * age * age).addScaledVector(this.al, Math.sin(k * 1.7) * 0.3);
        this.v.y += s.rise * age;
        this.q.setFromAxisAngle(BR_UP, k * 0.9 + age);
        const sz = puffScale(age, 1, s.size * (0.8 + 0.4 * g));
        this.m.compose(this.v, this.q, this.sc.set(sz, sz, sz));
        this.puffs.setMatrixAt(i++, this.m);
      }
      this.puffs.instanceMatrix.needsUpdate = true;
    }
  }

  // place stands a rod that was built up from its foot with the foot at p, pointing at q.
  private place(o: THREE.Object3D, p: BrP3, q: BrP3) {
    this.v.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
    o.position.set(p[0], p[1], p[2]); o.quaternion.setFromUnitVectors(BR_UP, this.v);
  }
}
