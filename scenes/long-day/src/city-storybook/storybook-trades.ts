// This file draws the storybook city's trade emblems (facilities.ts, the sb trades): each trade's
// front door has a big emblem of what it makes or sells over it, standing on a curly bracket out
// from the wall, so a street of round pods reads as a street of shops from the board. A home has a
// striped letterbox on a curl of post beside its door instead.
// Everything is drawn in the door's frame: x along the wall, y up, the street at -z, the door's
// foot at (x, z) on the wall. The chunk draws an emblem over every door (city.ts
// makeCityChunkBuilder); tools/storyfacilities.ts shows them all close up. Each hangs a lantern under
// its shelf, lit after dark, whose light falls on the emblem, the door and the step.
// The emblems that move (the cogs, the pinwheel, the key and the cuckoo) leave their moving parts to
// TradeSpinners: the chunk records where each is (registerTradeSpins), and one instanced mesh for each
// kind of part draws every one in the loaded chunks, turned by scene time.
import * as THREE from "three@0.187.0";
import { Batch, PLACED, toTile } from "../geom.ts";
import { SB, SB_BULB, SB_GLOW, SB_LENS, SB_ONION, SB_PUFF, sbCurve, sbTube } from "./storybook-buildings-town.ts";
import type { SbP3 } from "./storybook-buildings-town.ts";
import type { FacilityId } from "../facilities.ts";

// The emblem's bracket stands EMBLEM_OUT out from the wall, and its shelf is no lower than
// EMBLEM_Y0 above the pavement, clear of a shop row's awning (storybook-buildings-town.ts storyShopRow).
// The emblems are drawn at about a person's size and scaled up by EMBLEM_SCALE.
const EMBLEM_OUT = 1.45, EMBLEM_Y0 = 3.75, EMBLEM_SCALE = 1.4;
type Emblem = (s: Batch, x: number, y: number, z: number) => void;
const T = Math.PI / 2;

// A curl of ink rod, out from the wall, from (x, y, z) to (x, y, z - out), ending in a little spiral under its end.
function bracket(s: Batch, x: number, y: number, z: number, out: number) {
  sbTube(s, sbCurve(4, (t) => [x, y - Math.sin(t * Math.PI) * 0.12, z - t * out]), () => 0.05, () => SB.ink, 5, x);
  sbTube(s, sbCurve(3, (t) => [x, y - 0.75 + t * 0.7, z - Math.sin(t * T) * out * 0.75]), () => 0.04, () => SB.ink, 5, x + 1);
  s.cyl(x, y + 0.03, z - out, 0.55, 0.06, SB.cream, 10);
}
// A striped ring of n pieces round the y axis at (x, y, z), radius R, tube radius r.
function ring(s: Batch, x: number, y: number, z: number, R: number, r: number, c0: number, c1: number, n = 10, upright = false) {
  sbTube(s, sbCurve(n, (t) => upright ? [x + Math.cos(t * 2 * Math.PI) * R, y + Math.sin(t * 2 * Math.PI) * R, z] : [x + Math.cos(t * 2 * Math.PI) * R, y, z + Math.sin(t * 2 * Math.PI) * R]), () => r, (i) => (i % 2 ? c1 : c0), 6, x + y);
}
// A ball on a stick, for hats' pom-poms and the like.
const pom = (s: Batch, x: number, y: number, z: number, r: number, c: number) => s.lathe("bulb", SB_BULB, x, y - r, z, r, r * 2, c, 8, x);

const EMBLEMS: Partial<Record<FacilityId, Emblem>> = {
  // A gumdrop as big as a person, sugared with dots.
  sbGumdropMill: (s, x, y, z) => {
    s.lathe("onion", SB_ONION, x, y, z, 1.0, 1.7, SB.lime, 12, 0.3);
    for (let k = 0; k < 7; k++) { const a = k * 0.9, h = 0.3 + (k % 3) * 0.35; s.ico(x + Math.cos(a) * (0.95 - h * 0.35), y + h, z + Math.sin(a) * (0.95 - h * 0.35), 0.07, SB.white); }
  },
  // A fat bottle of pop with bubbles rising out of its neck.
  sbFizzWorks: (s, x, y, z) => {
    s.lathe("bulb", SB_BULB, x, y, z, 0.6, 1.4, SB.mint, 10, 0);
    s.cyl(x, y + 1.6, z, 0.22, 0.5, SB.mint, 8); s.cyl(x, y + 1.9, z, 0.28, 0.14, SB.red, 8);
    s.box(x, y + 0.64, z - 0.6, 0.6, 0.32, 0.06, SB.butter);
    for (const [dx, dy, r] of [[0.1, 2.25, 0.14], [-0.15, 2.55, 0.11], [0.12, 2.8, 0.08]]) s.ico(x + dx, y + dy, z, r, SB.aqua, 1, dx);
  },
  // A great ball of yarn with two needles through it.
  sbSpinnery: (s, x, y, z) => {
    s.ico(x, y + 0.85, z, 0.85, SB.coral, 1, 0.4);
    ring(s, x, y + 0.85, z, 0.86, 0.06, SB.pink, SB.pink, 12, true);
    for (const r of [-0.5, 0.5]) s.boxR(x, y + 1.3, z, 0.07, 2.2, 0.07, SB.cream, 0, 0, r);
    for (const r of [-0.5, 0.5]) s.ico(x - Math.sin(r) * 1.1 * -1, y + 1.3 + Math.cos(r) * 1.1, z, 0.1, SB.mustard);
  },
  // A coiled spring, bouncing a red ball.
  sbSpringWorks: (s, x, y, z) => {
    sbTube(s, sbCurve(24, (t) => [x + Math.cos(t * 5 * 2 * Math.PI) * 0.55, y + 0.1 + t * 1.5, z + Math.sin(t * 5 * 2 * Math.PI) * 0.55]), () => 0.08, () => SB.white, 5, x);
    s.ico(x, y + 2.05, z, 0.42, SB.red, 1, 0.2);
  },
  // A bubble wand's ring, and bubbles floating off it.
  sbBubbleWorks: (s, x, y, z) => {
    s.boxR(x - 0.2, y + 0.55, z, 0.1, 1.1, 0.1, SB.violet, 0, 0, -0.3);
    ring(s, x + 0.15, y + 1.55, z, 0.5, 0.07, SB.violet, SB.pink, 12, true);
    for (const [dx, dy, r] of [[0.8, 1.9, 0.3], [0.55, 2.5, 0.22], [1.05, 2.4, 0.16]]) s.ico(x + dx, y + dy, z, r, 0xd8f4ff, 1, dx);
  },
  // A jar of purple jam with a gingham lid.
  sbJammery: (s, x, y, z) => {
    s.cyl(x, y + 0.7, z, 0.65, 1.4, SB.plum, 12);
    s.cyl(x, y + 1.48, z, 0.72, 0.18, SB.red, 12); s.cone(x, y + 1.7, z, 0.75, 0.3, SB.white, 12);
    s.box(x, y + 0.7, z - 0.64, 0.8, 0.5, 0.04, SB.cream);
  },
  // A rainbow arch on two little clouds.
  sbRainbowRefinery: (s, x, y, z) => {
    const bands = [SB.red, SB.orange, SB.mustard, SB.lime, SB.sky, SB.violet];
    bands.forEach((c, k) => sbTube(s, sbCurve(8, (t) => [x + Math.cos(Math.PI * t) * (1.2 - k * 0.12), y + 0.35 + Math.sin(Math.PI * t) * (1.2 - k * 0.12), z + k * 0.01]), () => 0.065, () => c, 5, k));
    for (const sx of [-1, 1]) s.lathe("puff", SB_PUFF, x + sx * 1.1, y, z, 0.38, 0.55, SB.fluff, 8, sx);
  },
  // A cuckoo clock: a little house with a clock face and a bird popping out.
  sbClockery: (s, x, y, z) => {
    s.box(x, y + 0.75, z, 1.2, 1.5, 0.5, SB.orange);
    s.prism(x, y + 1.85, z, 1.6, 0.7, 0.7, SB.red);
    s.cyl(x, y + 0.85, z - 0.26, 0.42, 0.04, SB.cream, 12, T);
    s.boxR(x, y + 0.97, z - 0.29, 0.05, 0.28, 0.02, SB.ink, 0, 0, 0); s.boxR(x + 0.08, y + 0.85, z - 0.29, 0.2, 0.05, 0.02, SB.ink, 0, 0, 0);
    s.box(x, y + 1.55, z - 0.26, 0.36, 0.36, 0.03, SB.ink);   // (the bird's little door: TRADE_SPIN cuckoo pops out of it)
  },
  // A great wind-up key, for the Ryder trucks that roost here (they are wound up, in this town). Its bow
  // turns on the shaft (TRADE_SPIN keyBow).
  sbTruckRoost: (s, x, y, z) => {
    s.cyl(x, y + 0.75, z, 0.12, 1.5, SB.mustard, 8);
  },
  // A cloud with a washing line of socks.
  sbCloudLaundry: (s, x, y, z) => {
    for (const [dx, dy, r] of [[-0.6, 0.6, 0.55], [0, 0.85, 0.7], [0.6, 0.6, 0.5]]) s.lathe("puff", SB_PUFF, x + dx, y + dy - r * 0.5, z, r, r * 1.5, SB.fluff, 9, dx);
    sbTube(s, sbCurve(4, (t) => [x - 1.1 + t * 2.2, y + 0.35 - Math.sin(t * Math.PI) * 0.25, z - 0.4]), () => 0.02, () => SB.ink, 3, 0);
    [-0.6, 0, 0.6].forEach((dx, k) => { s.box(x + dx, y + 0.05, z - 0.4, 0.18, 0.4, 0.06, [SB.pink, SB.sky, SB.mustard][k]); s.box(x + dx + 0.07, y - 0.12, z - 0.4, 0.3, 0.12, 0.06, [SB.pink, SB.sky, SB.mustard][k]); });
  },
  // Three tall striped hats, stacked and tipping.
  sbHatStacker: (s, x, y, z) => {
    let yy = y, dx = 0;
    [[SB.red, SB.white], [SB.teal, SB.butter], [SB.violet, SB.white]].forEach(([c0, c1], k) => {
      s.cyl(x + dx, yy + 0.04, z, 0.62 - k * 0.1, 0.08, c0, 12);
      for (let b = 0; b < 3; b++) s.cyl(x + dx, yy + 0.2 + b * 0.22, z, 0.4 - k * 0.07, 0.22, b % 2 ? c0 : c1, 12);
      yy += 0.74; dx += 0.12;
    });
  },
  // A swirled lollipop on its stick.
  sbSweetShop: (s, x, y, z) => {
    s.cyl(x, y + 0.6, z, 0.06, 1.2, SB.white, 6);
    for (let r = 0; r < 4; r++) s.cyl(x + r * 0.004, y + 1.75, z - r * 0.01, 0.75 - r * 0.17, 0.12 + r * 0.01, r % 2 ? SB.white : SB.pink, 14, T);
  },
  // A spinning top, striped round, on its point.
  sbToyShop: (s, x, y, z) => {
    s.cone(x, y + 0.45, z, 0.75, 0.9, SB.sky, 12, Math.PI);
    s.cyl(x, y + 0.95, z, 0.78, 0.12, SB.mustard, 12);
    s.lathe("onion", SB_ONION, x, y + 1.0, z, 0.72, 0.7, SB.red, 12, 0);
    s.cyl(x, y + 1.85, z, 0.07, 0.4, SB.ink, 6);
  },
  // A great cog standing on edge, a smaller one meshing with it (TRADE_SPIN cogBig, cogSmall), on a plate.
  sbGadgetry: (s, x, y, z) => {
    s.box(x + 0.2, y + 1.35, z + 0.25, 2.2, 2.3, 0.1, SB.plum);
    for (const [dx, dy] of [[-0.25, 1.0], [0.75, 1.85]]) s.cyl(x + dx, y + dy, z + 0.12, 0.07, 0.2, SB.ink, 6, T);
  },
  // A cupcake with pink icing and a cherry.
  sbBakery: (s, x, y, z) => {
    s.cone(x, y + 0.45, z, 0.72, 0.9, SB.orange, 12, Math.PI);
    s.cyl(x, y + 0.43, z, 0.58, 0.86, SB.butter, 12);
    s.lathe("puff", SB_PUFF, x, y + 0.85, z, 0.78, 1.0, SB.pink, 12, 0);
    s.ico(x, y + 1.95, z, 0.18, SB.red);
  },
  // A teapot, tipped to pour, steam curling from its spout.
  sbTeaHouse: (s, x, y, z) => {
    s.lathe("bulb", SB_BULB, x, y, z, 0.8, 1.3, SB.teal, 12, 0.2);
    s.lathe("bulb", SB_BULB, x, y + 1.25, z, 0.25, 0.35, SB.mustard, 8, 0);
    sbTube(s, sbCurve(3, (t) => [x + 0.7 + t * 0.55, y + 0.45 + t * 0.6, z]), (i) => 0.13 - i * 0.03, () => SB.teal, 6, 0);
    sbTube(s, sbCurve(5, (t) => [x - 0.7 - Math.sin(t * Math.PI) * 0.4, y + 0.3 + t * 0.7, z]), () => 0.07, () => SB.cream, 5, 1);
    sbTube(s, sbCurve(5, (t) => [x + 1.3 + Math.sin(t * 6) * 0.15, y + 1.15 + t * 0.9, z]), () => 0.06, () => SB.fluff, 4, 2);
  },
  // A noodle bowl with chopsticks standing in it and noodles over its rim.
  sbNoodlery: (s, x, y, z) => {
    s.lathe("lens", SB_LENS, x, y - 0.2, z, 0.95, 1.4, SB.red, 12, 0);
    s.cyl(x, y + 0.52, z, 0.82, 0.06, SB.butter, 12);
    for (const sx of [-1, 1]) s.boxR(x + sx * 0.2 + 0.2, y + 1.2, z, 0.06, 1.5, 0.06, SB.cream, 0, 0, sx * 0.12 - 0.3);
    for (let k = 0; k < 4; k++) sbTube(s, sbCurve(4, (t) => [x - 0.6 + k * 0.4, y + 0.55 - t * 0.4, z - 0.6 - Math.sin(t * Math.PI) * 0.15]), () => 0.04, () => SB.butter, 4, k);
  },
  // A tall glass of pop with a striped bendy straw.
  sbFizzParlour: (s, x, y, z) => {
    s.cone(x, y + 0.9, z, 0.6, 1.8, SB.pink, 12, Math.PI);
    s.cyl(x, y + 1.78, z, 0.6, 0.06, SB.cream, 12);
    sbTube(s, [[x + 0.15, y + 0.9, z], [x + 0.25, y + 2.3, z], [x + 0.55, y + 2.6, z]], () => 0.06, (i) => (i % 2 ? SB.red : SB.white), 6, 0);
    s.ico(x - 0.25, y + 1.9, z, 0.12, SB.red);
  },
  // A long striped scarf, looped over a peg and hanging in tails.
  sbScarfShop: (s, x, y, z) => {
    s.cyl(x, y + 2.0, z + 0.3, 0.08, 0.6, SB.ink, 6, T);
    for (const sx of [-1, 1]) for (let k = 0; k < 7; k++) s.boxR(x + sx * 0.3, y + 2.0 - k * 0.3 - 0.15, z - 0.1, 0.4, 0.29, 0.1, k % 2 ? SB.white : SB.coral, 0, 0, sx * 0.1);
    for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) s.box(x + sx * 0.3 - 0.13 + k * 0.13, y - 0.05, z - 0.1, 0.04, 0.2, 0.04, SB.coral);
  },
  // A crescent moon in a nightcap.
  sbSnoozery: (s, x, y, z) => {
    sbTube(s, sbCurve(8, (t) => [x + Math.cos(-T + t * Math.PI) * 0.9, y + 1.1 + Math.sin(-T + t * Math.PI) * 0.9, z]), (i, t) => 0.12 + Math.sin(t * Math.PI) * 0.3, () => SB.butter, 8, 0);
    s.cone(x + 0.1, y + 2.25, z, 0.3, 0.7, SB.sky, 8, 0, 0, 0.6); pom(s, x - 0.25, y + 2.55, z, 0.12, SB.white);
  },
  // A party hat with its pom-pom, and a streamer.
  sbPartyShop: (s, x, y, z) => {
    s.cone(x, y + 0.85, z, 0.75, 1.7, SB.magenta, 12);
    for (const h of [0.45, 0.95]) s.cyl(x, y + h, z, 0.75 * (1 - h / 1.7) + 0.03, 0.14, SB.mustard, 12);
    pom(s, x, y + 2.0, z, 0.2, SB.aqua);
    sbTube(s, sbCurve(6, (t) => [x + 0.5 + t * 0.6, y + 0.4 + Math.sin(t * 9) * 0.15, z - 0.4]), () => 0.04, (i) => (i % 2 ? SB.lime : SB.coral), 4, 0);
  },
  // An ice-cream cone with three scoops.
  sbScoopery: (s, x, y, z) => {
    s.cone(x, y + 0.6, z, 0.5, 1.2, SB.orange, 10, Math.PI);
    [SB.pink, SB.mint, SB.butter].forEach((c, k) => s.ico(x + (k - 1) * 0.08, y + 1.35 + k * 0.5, z, 0.5 - k * 0.07, c, 0.9, k));
    s.ico(x, y + 2.6, z, 0.12, SB.red);
  },
  // A giant pickle, warty and green.
  sbCornerNook: (s, x, y, z) => {
    sbTube(s, sbCurve(5, (t) => [x - 0.9 + t * 1.8, y + 0.7 + Math.sin(t * Math.PI) * 0.25, z]), (i, t) => 0.32 + Math.sin(t * Math.PI) * 0.18, () => SB.lime, 8, 0, true);
    for (let k = 0; k < 6; k++) s.ico(x - 0.7 + k * 0.28, y + 0.95 + Math.sin(k) * 0.15, z - 0.4, 0.07, 0x6ab03a);
  },
  // A tumble of three boxes, a question mark on each.
  sbEmporium: (s, x, y, z) => {
    [[-0.45, 0, 0.8, SB.violet, 0.1], [0.45, 0, 0.7, SB.orange, -0.1], [0.05, 0.75, 0.7, SB.teal, 0.3]].forEach(([dx, dy, w, c, r]) => {
      s.boxR(x + dx, y + dy + w / 2, z, w, w, w, c, 0, r, 0);
      s.boxR(x + dx, y + dy + w / 2 + 0.05, z - w / 2 - 0.01, 0.2, 0.3, 0.02, SB.cream, 0, r, 0);
    });
  },
  // Two music notes, joined.
  sbTinklery: (s, x, y, z) => {
    for (const dx of [-0.5, 0.5]) { s.lathe("lens", SB_LENS, x + dx - 0.12, y + 0.15, z, 0.3, 0.45, SB.ink, 10, 0, 0, 1.1); s.box(x + dx + 0.12, y + 1.0, z, 0.1, 1.5, 0.1, SB.ink); }
    s.boxR(x, y + 1.75, z, 1.15, 0.22, 0.1, SB.ink, 0, 0, 0.15);
  },
  // A rubber stamp, its handle red.
  sbDoodads: (s, x, y, z) => {
    s.box(x, y + 0.2, z, 1.4, 0.4, 1.0, SB.ink); s.box(x, y + 0.01, z, 1.3, 0.08, 0.9, SB.magenta);
    s.cyl(x, y + 0.85, z, 0.18, 0.9, SB.red, 8); s.lathe("bulb", SB_BULB, x, y + 1.25, z, 0.42, 0.75, SB.red, 10, 0);
  },
  // A pinwheel spinning on its stick (TRADE_SPIN pinwheel).
  sbTippyTower: (s, x, y, z) => {
    s.cyl(x, y + 0.75, z + 0.08, 0.05, 1.5, SB.white, 6);
  },
  // An umbrella turned upside down, catching the rain.
  sbUpsideInn: (s, x, y, z) => {
    s.cone(x, y + 0.65, z, 1.0, 0.8, SB.coral, 8, Math.PI);
    ring(s, x, y + 1.05, z, 1.0, 0.05, SB.white, SB.coral, 8);
    s.cyl(x, y + 1.3, z, 0.05, 1.3, SB.ink, 6);
    sbTube(s, sbCurve(4, (t) => [x + Math.sin(t * Math.PI) * 0.25, y + 1.95 + Math.cos(t * Math.PI) * 0.1 - t * 0.2, z]), () => 0.05, () => SB.ink, 5, 0);
  },
  // A five-pointed star, gold, on a stalk.
  sbPlayhouse: (s, x, y, z) => {
    const cy = y + 1.25, P = (k: number, r: number): [number, number] => [x + Math.sin(k * Math.PI / 5) * r, cy + Math.cos(k * Math.PI / 5) * r];
    for (let k = 0; k < 10; k++) {
      const [ax, ay] = P(k, k % 2 ? 0.45 : 1.1), [bx, by] = P(k + 1, (k + 1) % 2 ? 0.45 : 1.1);
      for (const sz of [-1, 1]) s.tri(x, cy, z + sz * 0.12, sz > 0 ? ax : bx, sz > 0 ? ay : by, z + sz * 0.06, sz > 0 ? bx : ax, sz > 0 ? by : ay, z + sz * 0.06, SB.mustard, [0, 0, sz]);
    }
    s.ico(x, cy, z - 0.15, 0.2, SB.red);
  },
  // A big odd mitten, cuff striped.
  sbMuseum: (s, x, y, z) => {
    s.cyl(x, y + 0.25, z, 0.5, 0.5, SB.white, 10); s.cyl(x, y + 0.25, z, 0.52, 0.18, SB.red, 10);
    s.lathe("bulb", SB_BULB, x, y + 0.45, z, 0.62, 1.5, SB.coral, 12, 0);
    s.lathe("bulb", SB_BULB, x + 0.55, y + 0.65, z, 0.22, 0.75, SB.coral, 8, 0, 0, -0.6);
  },
  // A stack of three letter blocks.
  sbSchool: (s, x, y, z) => {
    [[-0.38, 0, SB.red, 0.1], [0.38, 0, SB.sky, -0.15], [0, 0.72, SB.mustard, 0.25]].forEach(([dx, dy, c, r]) => {
      s.boxR(x + dx, y + dy + 0.35, z, 0.7, 0.7, 0.7, c, 0, r, 0);
      s.boxR(x + dx, y + dy + 0.35, z - 0.36, 0.36, 0.36, 0.02, SB.white, 0, r, 0);
    });
  },
  // A trufflunk tuft: a striped stalk with a pom-pom of fluff.
  sbTrufflunkGrove: (s, x, y, z) => {
    sbTube(s, sbCurve(4, (t) => [x + t * t * 0.4, y + t * 1.6, z]), () => 0.09, (i) => (i % 2 ? SB.white : SB.ink), 5, 0);
    s.lathe("puff", SB_PUFF, x + 0.4, y + 1.35, z, 0.75, 1.2, SB.pink, 10, 0);
  },
  // A snorkberry, round and blue, with its curly leaf.
  sbSnorkberryPatch: (s, x, y, z) => {
    s.ico(x, y + 0.8, z, 0.8, SB.sky, 1, 0.3);
    for (let k = 0; k < 6; k++) { const a = k; s.ico(x + Math.cos(a) * 0.55, y + 0.8 + Math.sin(a * 2) * 0.4, z - 0.6 + Math.abs(Math.sin(a)) * 0.2, 0.06, SB.navy); }
    sbTube(s, sbCurve(5, (t) => [x + Math.sin(t * 4) * 0.4, y + 1.55 + t * 0.6, z + Math.cos(t * 4) * 0.2]), (i, t) => 0.12 * (1 - t) + 0.03, () => SB.lime, 5, 0);
  },
  // A diamond kite with a bowed tail.
  sbKiteMeadow: (s, x, y, z) => {
    const cy = y + 1.4, P: [number, number][] = [[0, 0.9], [0.65, 0], [0, -1.0], [-0.65, 0]], cols = [SB.red, SB.mustard];
    for (let k = 0; k < 4; k++) for (const sz of [-1, 1]) {
      const [a0, b0] = P[k], [a1, b1] = P[(k + 1) % 4];
      s.tri(x, cy, z + sz * 0.02, sz > 0 ? x + a0 : x + a1, sz > 0 ? cy + b0 : cy + b1, z + sz * 0.02, sz > 0 ? x + a1 : x + a0, sz > 0 ? cy + b1 : cy + b0, z + sz * 0.02, cols[k % 2], [0, 0, sz]);
    }
    for (let k = 0; k < 4; k++) s.boxR(x + 0.25 * Math.sin(k * 1.5), cy - 1.1 - k * 0.22, z, 0.2, 0.1, 0.04, [SB.pink, SB.aqua][k % 2], 0, 0, k);
  },
  // A bell hung with a bow.
  sbGazebo: (s, x, y, z) => {
    s.lathe("bulb", SB_BULB, x, y + 0.35, z, 0.7, 1.4, SB.mustard, 12, 0);
    s.cyl(x, y + 0.38, z, 0.78, 0.12, SB.mustard, 12); s.ico(x, y + 0.2, z, 0.15, SB.ink);
    for (const sx of [-1, 1]) s.boxR(x + sx * 0.3, y + 1.9, z - 0.1, 0.5, 0.3, 0.08, SB.pink, 0, 0, sx * 0.4);
  },
};

// storyEmblem draws trade `fac`'s emblem over its door at (x, z) on the wall (the street at -z),
// whose top is `doorTop` above the ground, or a home's letterbox beside it, and returns where its
// lantern's light comes from (null for a home). Trades with no emblem (the knitting works, which is
// its own) draw nothing. With `spin`, an emblem's moving parts are left to TradeSpinners (recorded in
// TRADE_SPIN_OUT, in the tile's coordinates, for registerTradeSpins); without, they are drawn standing.
export function storyEmblem(s: Batch, fac: FacilityId, x: number, z: number, y0: number, doorTop: number, spin = false): SbP3 | null {
  if (fac === "sbPodHouse" || fac === "sbTeeterFlats") { storyLetterbox(s, x + 1.15, z, y0, fac === "sbTeeterFlats"); return null; }
  const e = EMBLEMS[fac];
  if (!e) return null;
  const y = Math.max(doorTop + 0.55, y0 + EMBLEM_Y0), ex = x, ey = y + 0.06, ez = z - EMBLEM_OUT;
  bracket(s, x, y, z, EMBLEM_OUT);
  // the lantern hangs under the shelf's street edge, in an ink cap
  s.cone(x, y - 0.06, ez - 0.4, 0.17, 0.12, SB.ink, 5);
  s.aux.set(0, 0, SB_GLOW); s.ico(x, y - 0.24, ez - 0.4, 0.16, SB.lamp, 1.2); s.aux.set(0, 0, -1);
  const n0 = s.mark();
  e(s, ex, ey, ez);
  for (const [kind, P] of TRADE_SPIN_PARTS) {
    if (P.fac !== fac) continue;
    if (spin) {
      const [tx, tz] = toTile(ex + P.at[0] * EMBLEM_SCALE, ez + P.at[2] * EMBLEM_SCALE);
      TRADE_SPIN_OUT.push(kind, tx, ey + P.at[1] * EMBLEM_SCALE, tz, PLACED.frames.reduce((r, f) => r + f.rot, 0), ((x * 12.9898 + z * 78.233) % 1 + 1) % 1 * 6.283);
    } else P.build(s, ex + P.at[0], ey + P.at[1], ez + P.at[2], 0);
  }
  s.scaleFrom(n0, EMBLEM_SCALE, ex, ey, ez);
  return [x, y - 0.3, ez - 0.4];
}
// A home's letterbox: a round striped box on a curl of post against its wall (three, one over
// another, for a block of flats).
function storyLetterbox(s: Batch, x: number, z: number, y0: number, flats: boolean) {
  const n = flats ? 3 : 1;
  sbTube(s, sbCurve(3, (t) => [x + Math.sin(t * 3) * 0.08, y0 + t * (0.9 + n * 0.32), z - 0.2]), () => 0.04, () => SB.ink, 4, x);
  for (let k = 0; k < n; k++) {
    const y = y0 + 1.0 + k * 0.34;
    s.cyl(x, y, z - 0.2, 0.14, 0.32, k % 2 ? SB.sky : SB.red, 8, 0, T);
    s.box(x - 0.16, y + 0.1, z - 0.2, 0.03, 0.14, 0.03, SB.mustard);
  }
}
export const EMBLEM_TRADES = Object.keys(EMBLEMS) as FacilityId[];

// ---- the moving parts -------------------------------------------------------------------------
// TRADE_SPIN_PARTS holds each kind of moving part: its trade, where its pivot is from the emblem's foot
// (before EMBLEM_SCALE), how to draw it about its pivot at (x, y, z) turned `a`, and how it moves (pose:
// its turn about its axis at time t, given the emblem's own phase). The cogs mesh: the small one has 5 teeth
// to the big one's 9 at the same pitch (0.52 m), turns 9/5 as fast the other way, and both start with a
// tooth of the big one's in a gap of the small one's on the line between them.
interface TradeSpinPart { fac: FacilityId; at: SbP3; axis: "y" | "z" | "pop"; build: (b: Batch, x: number, y: number, z: number, a: number) => void; pose: (t: number, phase: number) => number }
const COG_RATE = 0.7, COG_LINE = Math.atan2(0.85, 1.0);
function tradeCog(b: Batch, x: number, y: number, z: number, a: number, R: number, c: number, n: number, a0: number) {
  b.cyl(x, y, z, R, 0.25, c, 14, T);
  for (let k = 0; k < n; k++) { const t = a + a0 + (k / n) * Math.PI * 2; b.boxR(x + Math.cos(t) * R, y + Math.sin(t) * R, z, 0.24, 0.24, 0.23, c, 0, 0, t); }
  for (let k = 0; k < 3; k++) { const t = a + k * 2.094; b.boxR(x + Math.cos(t) * R * 0.45, y + Math.sin(t) * R * 0.45, z - 0.13, R * 0.7, 0.09, 0.04, SB.ink, 0, 0, t); }
  b.cyl(x, y, z - 0.02, R * 0.3, 0.33, SB.ink, 8, T);
}
const TRADE_SPIN_PARTS: [number, TradeSpinPart][] = [
  [0, { fac: "sbGadgetry", at: [-0.25, 1.0, 0], axis: "z", build: (b, x, y, z, a) => tradeCog(b, x, y, z, a, 0.75, SB.mustard, 9, COG_LINE), pose: (t, p) => COG_RATE * t + p }],
  [1, { fac: "sbGadgetry", at: [0.75, 1.85, -0.07], axis: "z", build: (b, x, y, z, a) => tradeCog(b, x, y, z, a, 0.4, SB.teal, 5, COG_LINE + Math.PI + Math.PI / 5), pose: (t, p) => -(COG_RATE * t + p) * 9 / 5 }],
  [2, { fac: "sbTippyTower", at: [0, 1.5, 0], axis: "z", pose: (t, p) => 3 * t + p, build: (b, x, y, z, a) => {
    const cols = [SB.pink, SB.sky, SB.mustard, SB.lime];
    for (let k = 0; k < 4; k++) {
      const u = a + k * T, ca = Math.cos(u), sa = Math.sin(u), cb = Math.cos(u + T), sb = Math.sin(u + T);
      for (const sz of [-1, 1]) b.tri(x, y, z + sz * 0.02, x + ca * 0.9, y + sa * 0.9, z + sz * 0.02, x + ca * 0.9 + cb * 0.5, y + sa * 0.9 + sb * 0.5, z + sz * 0.02, cols[k], [0, 0, sz]);
    }
    b.ico(x, y, z - 0.05, 0.1, SB.red);
  } }],
  [3, { fac: "sbTruckRoost", at: [0, 1.8, 0], axis: "y", pose: (t, p) => 1.1 * t + p, build: (b, x, y, z, a) => {
    for (const sx of [-1, 1]) b.lathe("lens", SB_LENS, x + Math.cos(a) * sx * 0.5, y, z - Math.sin(a) * sx * 0.5, 0.55, 0.3, SB.mustard, 10, a, 0, T);
    b.cyl(x, y - 0.2, z, 0.2, 0.25, SB.red, 8, 0, 0, a);
  } }],
  // (The cuckoo pops out of its door for two seconds every twelve: pose gives how far out it is.)
  [4, { fac: "sbClockery", at: [0, 1.55, -0.3], axis: "pop", pose: (t, p) => { const u = ((t + p * 2) % 12 + 12) % 12; return u < 2 ? 0.32 * Math.sin(Math.PI * u / 2) : 0; }, build: (b, x, y, z) => {
    b.ico(x, y, z - 0.15, 0.16, SB.mustard); b.cone(x, y, z - 0.36, 0.06, 0.18, SB.orange, 5, -T);
  } }],
];
// TRADE_SPIN_OUT gathers the moving parts a chunk's emblems leave (storyEmblem with `spin`): kind, x, y, z,
// turn and phase for each, in the tile's coordinates. registerTradeSpins takes them for the chunk's group.
export const TRADE_SPIN_OUT: number[] = [];
const TRADE_SPINS = new Map<THREE.Object3D, number[]>();
export function registerTradeSpins(group: THREE.Object3D) {
  const recs = TRADE_SPIN_OUT.splice(0);
  if (!recs.length) return;
  const u = group.userData, dispose = u.onDispose, stash = u.onStash, restore = u.onRestore;
  TRADE_SPINS.set(group, recs);
  u.onDispose = () => { dispose?.(); TRADE_SPINS.delete(group); };
  u.onStash = () => { stash?.(); TRADE_SPINS.delete(group); };
  u.onRestore = () => { restore?.(); TRADE_SPINS.set(group, recs); };
}
// TradeSpinners draws every moving part of the emblems in the loaded chunks: one instanced mesh for each
// kind, grown when a town has more of them than it holds, posed each frame from scene time alone.
export class TradeSpinners {
  private meshes: THREE.InstancedMesh[] = [];
  private m = new THREE.Matrix4(); private local = new THREE.Matrix4(); private q = new THREE.Quaternion(); private q2 = new THREE.Quaternion();
  private v = new THREE.Vector3(); private v2 = new THREE.Vector3(); private sc = new THREE.Vector3(EMBLEM_SCALE, EMBLEM_SCALE, EMBLEM_SCALE);
  constructor(private readonly scene: THREE.Object3D, private readonly mat: THREE.Material) {}
  private mesh(kind: number, need: number) {
    const old = this.meshes[kind];
    if (old && old.instanceMatrix.count >= need) return old;
    if (old) { this.scene.remove(old); old.dispose(); }
    const b = new Batch(); TRADE_SPIN_PARTS[kind][1].build(b, 0, 0, 0, 0);
    const g = b.build(this.mat)!.geometry, mesh = new THREE.InstancedMesh(g, this.mat, Math.max(16, need * 2));
    mesh.frustumCulled = false; this.scene.add(mesh);
    return (this.meshes[kind] = mesh);
  }
  update(t: number) {
    const counts = TRADE_SPIN_PARTS.map(() => 0);
    for (const [obj, recs] of TRADE_SPINS) if (obj.parent) for (let i = 0; i < recs.length; i += 6) counts[recs[i]]++;
    const meshes = counts.map((n, k) => (n || this.meshes[k] ? this.mesh(k, n) : null)), at = counts.map(() => 0);
    for (const [obj, recs] of TRADE_SPINS) {
      if (!obj.parent) continue;
      obj.updateWorldMatrix(true, false);
      for (let i = 0; i < recs.length; i += 6) {
        const kind = recs[i], P = TRADE_SPIN_PARTS[kind][1], a = P.pose(t, recs[i + 5]);
        this.v.set(recs[i + 1], recs[i + 2], recs[i + 3]);
        this.q.setFromAxisAngle(Y_AXIS, recs[i + 4]);
        if (P.axis === "pop") this.v.add(this.v2.set(0, 0, -a * EMBLEM_SCALE).applyQuaternion(this.q));
        else this.q.multiply(this.q2.setFromAxisAngle(P.axis === "y" ? Y_AXIS : Z_AXIS, a));
        this.local.compose(this.v, this.q, this.sc);
        this.m.multiplyMatrices(obj.matrixWorld, this.local);
        meshes[kind]!.setMatrixAt(at[kind]++, this.m);
      }
    }
    meshes.forEach((m, k) => { if (m) { m.count = at[k]; m.instanceMatrix.needsUpdate = true; } });
  }
}
const Y_AXIS = new THREE.Vector3(0, 1, 0), Z_AXIS = new THREE.Vector3(0, 0, 1);
