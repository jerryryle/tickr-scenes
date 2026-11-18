// Street vignettes: little set pieces round the city that play out as the truck goes by. A dog
// at the base of a "no dogs peeing" sign, a dog walker towed by a pack, a wet-paint bench, a
// pigeon feeder, an umbrella blown inside out, an ice cream dropped, a ticket on the truck, chalk
// and hopscotch, window washers, a food truck's queue, a bike courier, a couch stuck in a doorway,
// a utility hatch, a crossing guard, the morning coffee queue, a couple under a streetlight, a
// falafel cart and a club's velvet rope after dark, a sled, a shoveller and a snowman in the
// snow, an open hydrant on a hot afternoon, and in the parks chess, tai chi, a frisbee dog and a
// kite.
// Each is anchored to a block side's frontage (city.ts frontPt: `a` along it, `n` across, 0 at
// the building line and -3 at the kerb face), chosen for its district, the hour, the weather and
// the season, and placed on the furniture it needs (decor.ts PK) or a free stretch of pavement.
// Most are choreographed as a function of their own clock (started when the truck comes near),
// so stepping only advances the clock and drawing is the pose at a moment: seeking replays them
// exactly. People who are done walk off as ordinary pedestrians (Crowd.adopt).
import { Rng, hash2, mulberry32 } from "./rng.ts";
import { Figures, HAIRS, PANTS, SHIRTS, SKINS, UMBRELLAS, walkSwing } from "./figure.ts";
import type { Body, V3 } from "./figure.ts";
import { CityPlan, FRONT_NODE, insideCity, kerbDoors, pavementObstacles, pick } from "./city.ts";
import type { District } from "./city.ts";
import { BLOCK, CURB_H, STREET } from "./grid.ts";
import { PK } from "./decor.ts";
import { facilityAt, siteLayout } from "./facilities.ts";
import { signalGreenLeft, signalState } from "./signals.ts";
import type { SignalAxis, SignalPreempt } from "./signals.ts";
import { blockGoals, DIR_X, DIR_Z, nodeX, nodeZ } from "./route.ts";
import { weatherMix } from "./climate.ts";
import type { WeatherMix } from "./climate.ts";
import { OCCLUSION } from "./occlusion.ts";
import { SIM_DT } from "./journey.ts";
import type { Obstacle } from "./traffic.ts";
import { DEBUG_SKIP_MINUTES, DEBUG_VIGNETTE } from "./debug.ts";

// The hour of day (0..24) at journey time t: main.ts points this at the atmosphere's clock.
export const CLOCK = { hourAt: (_t: number) => 12.5 };
export const VIG_LOG: { out: ((line: string) => void) | null } = { out: null };   // test renders (DEBUG_VIGNETTE)

export type VK = "peeSign" | "dogPack" | "wetPaint" | "pigeons" | "umbrella" | "iceCream" | "ticket" | "chalk" |
  "washers" | "foodTruck" | "courier" | "couch" | "hatch" | "guard" | "coffee" | "couple" | "falafel" | "bouncer" |
  "sled" | "shovel" | "snowman" | "hydrant" | "chess" | "taichi" | "frisbee" | "kite";

export interface Vig {
  k: VK; bx: number; bz: number; side: number; a: number; n: number;
  t: number; pt: number; on: boolean;     // its clock (from when it started) and one step ago
  seed: number; c: number[];             // its own numbers: cast colours and the like
  st: number[]; pst: number[];           // state (st[0] discrete: never blended), one step ago
  rel: number;                           // who has walked off as a pedestrian (bits)
}
// Someone handed over to the crowd: on a block side's walkway, walking along it.
export interface Adopt {
  bx: number; bz: number; side: number; a: number; n: number; dir: 1 | -1;
  shirt: number; pants: number; skin: number; hair: number;
  s?: number; hat?: number; dog?: number; cup?: boolean; umbrella?: number; speed?: number;
}
export interface KerbParked { x: number; z: number; h: number; cabX: number; cabZ: number }
export interface VigInput {
  plan: CityPlan; simTime: number; prs: SignalPreempt[]; focus: { x: number; z: number };
  truck: Obstacle[]; cars: Obstacle[]; peds: { x: number; z: number; run: boolean }[];
  parked: KerbParked | null; busy: Set<string>;
}
interface Ctx extends VigInput { hour: number; w: WeatherMix; season: string; snow: boolean }

// ---- frontage frames ----------------------------------------------------------------------------
const V_FWD: [number, number][] = [[1, 0], [0, -1], [-1, 0], [0, 1]];
const V_RIGHT: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const V_NEXT_SIDE = [3, 2, 0, 1];
interface VFrame { ox: number; oz: number; fx: number; fz: number; rx: number; rz: number; h0: number }
function frameOf(bx: number, bz: number, side: number): VFrame {
  const [nx, nz, d] = FRONT_NODE[side], [fx, fz] = V_FWD[d], [rx, rz] = V_RIGHT[d];
  return { ox: bx * BLOCK + nx + rx * 9, oz: bz * BLOCK + nz + rz * 9, fx, fz, rx, rz, h0: d * Math.PI / 2 };
}
const P = (f: VFrame, a: number, n: number): [number, number] => [f.ox + f.fx * a + f.rx * n, f.oz + f.fz * a + f.rz * n];
const toFront = (f: VFrame, x: number, z: number): [number, number] => [(x - f.ox) * f.fx + (z - f.oz) * f.fz, (x - f.ox) * f.rx + (z - f.oz) * f.rz];
// Yaws: along +a, towards the street (-n), towards the buildings (+n).
const along = (f: VFrame, dir = 1) => (dir > 0 ? f.h0 : f.h0 + Math.PI);
const toStreet = (f: VFrame) => f.h0 + Math.PI / 2;
const toBldg = (f: VFrame) => f.h0 - Math.PI / 2;
const yawTo = (dx: number, dz: number) => Math.atan2(-dz, dx);

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ramp = (t: number, t0: number, t1: number) => clamp01((t - t0) / (t1 - t0));
const vEase = (u: number) => u * u * (3 - 2 * u);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const Y0 = CURB_H;
const washSeen = [0, 9, 0, 30, 0], washPt = [0, 0], washF = [1, 0, 0, 1];   // test renders: where the cradle was last drawn (across, height)

// ---- colours ----------------------------------------------------------------------------------
const OLD_HAIR = [0xcfcfcf, 0xe8e8e8, 0xaaaaaa];
const DOGS = [0xf4ead8, 0x8a5a3a, 0x222222, 0xc8a060, 0xeeeeee, 0x6a4a2a, 0xd9b48c, 0x4a4a4a];
const V_BELLE = 0xf4ead8;
const CONE = 0xd9a45a, SCOOPS = [0xff9ec0, 0xb8f0c8, 0x6a3a1e, 0xfff2c0];
const HIVIS = 0xff7a1a, HARDHAT = 0xf2c200, CONE_ORANGE = 0xff5a1a;
const CHALK = [0xff8fb0, 0x8fd0ff, 0xfff08a, 0xa8f0a0, 0xd8a8ff, 0xffffff];
const PAINT = 0x2e9b5a;
interface Cast { shirt: number; pants: number; skin: number; hair: number }
function cast(r: () => number, c: number[]) { c.push(pick(r, SHIRTS), pick(r, PANTS), pick(r, SKINS), pick(r, HAIRS)); }
const castAt = (v: Vig, i: number): Cast => ({ shirt: v.c[i * 4], pants: v.c[i * 4 + 1], skin: v.c[i * 4 + 2], hair: v.c[i * 4 + 3] });
// Someone in a crowd the vignette keeps drawing (a queue): colours from their number.
function extra(v: Vig, i: number): Cast {
  const h = (s: number) => hash2(v.seed, i, s, 0x7e1);
  return { shirt: SHIRTS[Math.floor(h(1) * SHIRTS.length)], pants: PANTS[Math.floor(h(2) * PANTS.length)], skin: SKINS[Math.floor(h(3) * SKINS.length)], hair: HAIRS[Math.floor(h(4) * HAIRS.length)] };
}

// ---- kinds ------------------------------------------------------------------------------------
interface Kind {
  // How likely here and now (0: not here, not now).
  w(d: District, c: Ctx): number;
  // Find a spot on block (bx, bz) and set the vignette up; false when there is none.
  place(v: Vig, c: Ctx, r: () => number, V: Vignettes): boolean;
  trigger: number;                                   // starts when the truck is this close (0: at once)
  step?(v: Vig, c: Ctx, V: Vignettes): void;
  draw(v: Vig, F: Figures, t: number, D: DrawCtx): void;
  foot?(v: Vig): [number, number, number, number] | null;   // frontage a0, a1, n0, n1 people walk round
  done?(v: Vig): boolean;
}
interface DrawCtx { time: number; hour: number; night: boolean; st: number[] }

const day = (c: Ctx, h0 = 8, h1 = 18) => c.hour >= h0 && c.hour < h1;
const night = (h: number) => h >= 20 || h < 5;
const wet = (c: Ctx) => c.w.rain > 0.3 || c.w.snow > 0.3;
const city = (d: District, ...ok: District[]) => ok.includes(d);

// A free stretch of pavement on a block side: a in [a0, a1] (searched), the rect (len along,
// n0..n1 across) clear of furniture, other vignettes, crowd fixtures and anything the site uses.
function freeSpot(V: Vignettes, c: Ctx, bx: number, bz: number, side: number, len: number, n0: number, n1: number, r: () => number, a0 = 13, a1 = 47): number | null {
  if (!sideOk(c, bx, bz, side)) return null;
  const f = frameOf(bx, bz, side), obs = pavementObstacles(c.plan, bx, bz);
  for (let k = 0; k < 8; k++) {
    const a = a0 + len / 2 + r() * Math.max(0, a1 - a0 - len);
    let ok = true;
    for (const o of obs) {
      const [oa, on] = toFront(f, o.x, o.z);
      if (oa + o.r > a - len / 2 - 0.3 && oa - o.r < a + len / 2 + 0.3 && on + o.r > n0 && on - o.r < n1) { ok = false; break; }
    }
    if (ok && V.clashes(bx, bz, side, a - len / 2 - 1, a + len / 2 + 1, n0, n1)) ok = false;
    if (ok) return a;
  }
  return null;
}
// A side the street life may use: not where the truck stops, docks or parks.
function sideOk(c: Ctx, bx: number, bz: number, side: number) {
  if (!insideCity(bx, bz) || c.busy.has(`${bx},${bz}`)) return false;
  const site = siteLayout(c.plan, bx, bz);
  return site.kind === "kerb" || site.side !== side;
}
// Furniture of a kind (PK) on a block side, as frontage (a, n), within a in [13, 47].
function furniture(c: Ctx, bx: number, bz: number, side: number, kind: number, V: Vignettes, len = 4): [number, number][] {
  if (!sideOk(c, bx, bz, side)) return [];
  const f = frameOf(bx, bz, side), out: [number, number][] = [];
  for (const o of pavementObstacles(c.plan, bx, bz)) {
    if (o.kind !== kind) continue;
    const [a, n] = toFront(f, o.x, o.z);
    if (a > 13 && a < 47 && n < -1.5 && n > -3 && !V.clashes(bx, bz, side, a - len, a + len, -3, 0)) out.push([a, n]);
  }
  return out;
}
// Move the vignette to a block nearby (within two) whose facility is one of `facs`, on a side
// whose door it can use; false when there is none.
function nearFacility(c: Ctx, v: Vig, facs: string[], V: Vignettes, r: () => number): KerbDoorLike | null {
  const bx0 = v.bx, bz0 = v.bz;
  for (let k = 0; k < 25; k++) {
    const bx = bx0 + ((k % 5) - 2), bz = bz0 + (Math.floor(k / 5) - 2), side = (v.side + Math.floor(r() * 4)) % 4;
    if (!insideCity(bx, bz) || !facs.includes(facilityAt(c.plan, bx, bz) as string) || !sideOk(c, bx, bz, side)) continue;
    const door = kerbDoors(c.plan, bx, bz)[side];
    if (!door || door.y !== undefined || door.a < 16 || door.a > 44 || V.clashes(bx, bz, side, door.a - 6, door.a + 6, -2.5, 0)) continue;
    v.bx = bx; v.bz = bz; v.side = side;
    return door;
  }
  return null;
}
interface KerbDoorLike { a: number; n: number; half: number; h: number; y?: number }

// Hand someone over to the crowd, once (bit b of v.rel).
function release(v: Vig, b: number, V: Vignettes, p: Omit<Adopt, "bx" | "bz" | "side">) {
  if (v.rel & (1 << b)) return;
  v.rel |= 1 << b;
  V.adopt?.({ bx: v.bx, bz: v.bz, side: v.side, ...p });
}

// A walking (or standing) person at frontage (a, n) of frame f.
function walker(F: Figures, f: VFrame, a: number, n: number, yaw: number, phase: number, cs: Cast, moving: boolean, extraB: Partial<Body> = {}) {
  const [x, z] = P(f, a, n), w = walkSwing(phase);
  F.person({ x, z, yaw, y: Y0 + (moving ? w.bob : 0), legs: moving ? w.legs : [0, 0], arms: moving ? w.arms : [0.05, -0.05], ...cs, ...extraB });
}
function leash(F: Figures, h: V3, x: number, y: number, z: number) {
  const mx = (h[0] + x) / 2, mz = (h[2] + z) / 2, my = Math.min(h[1], y) - 0.12;
  F.seg(h[0], h[1], h[2], mx, my, mz, 0.02, 0x3a3a3a); F.seg(mx, my, mz, x, y, z, 0.02, 0x3a3a3a);
}
// The sitting pose on a seat whose top is `seat` above the feet' ground.
const sitting = (seat: number): Partial<Body> => ({ hip: seat + 0.06, legs: [1.45, 1.45], shins: [0.1, 0.1] });

// ---- the pee sign -------------------------------------------------------------------------------
// The sign: a white plate with a red ring and slash over a black dog lifting its leg.
function peeSign(F: Figures, f: VFrame, a: number, n: number) {
  const [px, pz] = P(f, a, n), top = Y0 + 2.2;
  F.box(px, Y0 + 1.1, pz, 0.05, 2.2, 0.05, f.h0, 0, 0x8a9096);
  const yaw = f.h0;
  for (const face of [-1, 1]) {
    const mirror = face;   // read the right way from either side
    const el = (u: number, y: number, su: number, sy: number, layer: number, color: number, rot = 0) => {
      const [x, z] = P(f, a + u * mirror, n + face * (0.013 + layer * 0.005));
      F.box(x, top + y, z, su, sy, 0.005, yaw, rot * mirror, color);
    };
    if (face < 0) { const [x, z] = P(f, a, n); F.box(x, top, z, 0.5, 0.5, 0.022, yaw, 0, 0xf4f4f0); }
    for (let i = 0; i < 16; i++) { const th = (i / 16) * Math.PI * 2; el(Math.cos(th) * 0.19, Math.sin(th) * 0.19, 0.082, 0.036, 0, 0xd0202a, th + Math.PI / 2); }
    el(0, -0.01, 0.15, 0.06, 0, 0x151515);                  // body
    el(0.093, 0.035, 0.06, 0.055, 0, 0x151515);             // head
    el(0.115, 0.06, 0.02, 0.03, 0, 0x151515, 0.4);          // ear
    el(0.055, -0.07, 0.022, 0.075, 0, 0x151515);            // front legs
    el(0.03, -0.07, 0.022, 0.075, 0, 0x151515);
    el(-0.05, -0.07, 0.022, 0.075, 0, 0x151515);            // the hind leg it stands on
    el(-0.095, -0.012, 0.075, 0.022, 0, 0x151515, 0.6);     // and the one it lifts
    el(-0.085, 0.025, 0.05, 0.016, 0, 0x151515, -0.8);      // tail
    for (let i = 0; i < 3; i++) el(-0.14 - i * 0.012, -0.03 - i * 0.03, 0.014, 0.022, 0, 0xf2c200);   // and what it does
    el(0, 0, 0.38, 0.038, 1, 0xd0202a, -Math.PI / 4);       // the slash
  }
}

const K: Record<VK, Kind> = {
  // A dog walker stops by the sign; the dog does exactly what it says not to; the owner looks away.
  peeSign: {
    w: (d, c) => (city(d, "residential", "commercial", "park") && !wet(c) ? 1.2 : 0), trigger: 45,
    place(v, c, r, V) {
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 1.2, -2.7, -1.9, r);
      if (a === null) return false;
      v.a = a; v.n = -2.3; cast(r, v.c);
      v.c.push(r() < 0.45 ? V_BELLE : pick(r, DOGS), 0.7 + r() * 0.9);
      return true;
    },
    step(v, c, V) {
      if (v.t > 21) { const cs = castAt(v, 0); release(v, 0, V, { a: v.a + walkU(v.t, 1.2, 20), n: -0.95, dir: 1, ...cs, dog: v.c[4] }); }
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side), cs = castAt(v, 0), dc = v.c[4], S = v.c[5];
      peeSign(F, f, v.a, v.n);
      const pee = ramp(t, 13, 17.5);
      if (pee > 0) { const [x, z] = P(f, v.a + 0.05, -2.15); F.box(x, Y0 + 0.006, z, 0.25 + pee * 0.25, 0.006, 0.22 + pee * 0.2, f.h0, 0, 0xd8c040); }
      if (v.rel & 1) return;
      // The walker: up to the sign, a pause, on again.
      const u = t < 11 ? -14 + t * 1.2 : t < 18.5 ? -0.8 : -0.8 + (t - 18.5) * 1.2, moving = t < 11 || t > 18.5;
      const ph = t < 11 ? t * 1.2 : t * 1.2;
      const look = t > 12.5 && t < 18 ? 1.3 * Math.sin(ramp(t, 12.5, 13.5) * Math.PI / 2) : 0;
      walker(F, f, v.a + u, -0.95, along(f), ph, cs, moving, { turn: look, nod: look ? -0.25 : 0, arms: moving ? undefined : [0.6, look ? -0.1 : 0] });
      const hand = [...F.handL] as V3;
      // The dog: leading, then to the post, round to put its side to it, the leg up.
      let da: number, dn: number, dy: number, dg = 0.6, lift = 0, ph2 = t * 2.2;
      if (t < 11) { da = v.a + u + 1.3; dn = -1.5; dy = along(f); }
      else if (t < 12.5) { const k = vEase(ramp(t, 11, 12.5)); da = lerp(v.a + 0.5, v.a - 0.18 * S, k); dn = lerp(-1.5, -2.3 + 0.36 * S, k); dy = along(f) + Math.PI * k; }
      else if (t < 18) { da = v.a - 0.18 * S; dn = -2.3 + 0.36 * S; dy = along(f, -1); dg = t > 17.4 ? 0.9 : 0; lift = Math.sin(ramp(t, 12.6, 13.2) * Math.PI / 2) * (1 - ramp(t, 17.2, 17.5)); ph2 = 12 * 2.2 + (t > 17.4 ? (t - 17.4) * 6 : 0); }
      else { const k = vEase(ramp(t, 18, 19)); da = lerp(v.a - 0.18 * S, v.a + u + 1.3, k); dn = lerp(-2.3 + 0.36 * S, -1.5, k); dy = along(f, -1) + Math.PI * k; }
      const [dx, dz] = P(f, da, dn);
      F.dog({ x: dx, z: dz, yaw: dy, phase: ph2, gait: dg, color: dc, size: S, belle: dc === V_BELLE, lift, tail: t * 10 });
      if (lift > 0.6 && t < 17.2) {   // the stream, to the foot of the post
        const [hx, hz] = P(f, v.a - 0.02, -2.3 + 0.2 * S), [px, pz] = P(f, v.a, -2.28);
        F.seg(hx, Y0 + 0.3 * S, hz, px, Y0 + 0.05, pz, 0.025, 0xe8d040);
      }
      leash(F, hand, dx + Math.cos(dy) * 0.19 * S, Y0 + 0.4 * S, dz - Math.sin(dy) * 0.19 * S);
    },
    foot: (v) => [v.a - 0.6, v.a + 0.6, -2.7, -1.8],
  },

  // A dog walker with a whole pack on leads, leaning back against them; now and then they bolt
  // (a squirrel!) and tow the walker along at a run, heels skidding.
  dogPack: {
    w: (d, c) => (city(d, "residential", "park", "commercial") && !wet(c) && day(c, 7, 19) ? 1 : 0), trigger: 0,
    place(v, c, r, V) {
      if (!sideOk(c, v.bx, v.bz, v.side)) return false;
      v.a = 14 + r() * 20; v.n = -1.2; cast(r, v.c);
      const n = 5 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) v.c.push(pick(r, DOGS), 0.65 + r() * 1.3, (i / (n - 1) - 0.5) * 2.1 + (r() - 0.5) * 0.3, 1.5 + r() * 1.6, r() * 10);
      v.st = [0, v.a]; v.pst = [0, v.a];
      return true;
    },
    step(v) {
      const t = v.t, drag = dragAt(t), sp = drag > 0 ? lerp(1.25, 3.4, drag) : 1.25;
      v.st[1] += sp * SIM_DT;
      if (v.st[1] > 51 - v.n) {   // round the corner, clockwise
        v.side = V_NEXT_SIDE[v.side]; v.st[1] = 9 + v.n + (v.st[1] - (51 - v.n));
        v.pst = v.st.slice();
      }
    },
    draw(v, F, t, D) {
      const f = frameOf(v.bx, v.bz, v.side), a = D.st[1], cs = castAt(v, 0), drag = dragAt(t);
      const [x, z] = P(f, a, v.n), yaw = along(f), w = walkSwing(t * lerp(1.25, 0.2, drag));
      // Leaning back, arms out in front; dragged, the heels go out in front too.
      F.person({ x, z, yaw, y: Y0 + w.bob * (1 - drag), legs: drag > 0.3 ? [0.45, 0.25] : w.legs, lean: lerp(-0.18, -0.5, drag), arms: [1.05 + drag * 0.35, 1.0 + drag * 0.35], armOut: [0.1, 0.1], ...cs, turn: Math.sin(t * 0.7) * 0.3 });
      const hands: V3 = [(F.handL[0] + F.handR[0]) / 2, (F.handL[1] + F.handR[1]) / 2, (F.handL[2] + F.handR[2]) / 2];
      const n = (v.c.length - 4) / 5;
      for (let i = 0; i < n; i++) {
        const o = 4 + i * 5, col = v.c[o], S = v.c[o + 1], lat = v.c[o + 2], reach = v.c[o + 3] + drag * 1.4, wob = v.c[o + 4];
        const pa = a + reach + Math.sin(t * 0.9 + wob) * 0.25 * (1 - drag), pn = THREE_CLAMP(v.n + lat * (1 - drag * 0.4) + Math.sin(t * 0.6 + wob * 2) * 0.2, -2.8, -0.25);
        const [dx, dz] = pathPt(v, pa, pn), dyaw = sidePathYaw(v, pa) + Math.sin(t * 1.3 + wob) * 0.25 * (1 - drag);
        F.dog({ x: dx, z: dz, yaw: dyaw, phase: t * (drag > 0 ? 4.2 : 2.0) + wob, gait: drag > 0 ? 0.95 : 0.6, color: col, size: S, legs: S > 1.4 ? 1.25 : 1, belle: col === V_BELLE, tail: t * 12 + wob, pitch: drag * 0.12 });
        leash(F, hands, dx + Math.cos(dyaw) * 0.19 * S, Y0 + 0.4 * S, dz - Math.sin(dyaw) * 0.19 * S);
      }
      // The squirrel that set them off.
      const k = squirrelAt(t);
      if (k >= 0) { const [sx, sz] = pathPt(v, a + 4.5 + k * 9, lerp(-1.2, -0.1, k)); F.box(sx, Y0 + 0.1, sz, 0.22, 0.12, 0.1, sidePathYaw(v, a + 4.5 + k * 9), 0, 0x8a5a3a); F.box(sx - Math.cos(sidePathYaw(v, a)) * 0.16, Y0 + 0.22, sz + Math.sin(sidePathYaw(v, a)) * 0.16, 0.1, 0.22, 0.12, sidePathYaw(v, a), -0.5, 0x9a6a4a); }
    },
  },

  // A bench painted fresh, its sign taped on; someone reading their phone sits down, then
  // springs up and twists round to see the stripes on their trousers.
  wetPaint: {
    w: (d, c) => (city(d, "commercial", "downtown", "residential", "park") && !wet(c) ? 1 : 0), trigger: 40,
    place(v, c, r, V) {
      const b = furniture(c, v.bx, v.bz, v.side, PK.bench, V);
      if (!b.length) return false;
      [v.a, v.n] = pick(r, b); cast(r, v.c);
      v.c.push(r() < 0.5 ? 1 : -1);
      return true;
    },
    step(v, c, V) { if (v.t > 25) release(v, 0, V, { a: v.a + v.c[4] * (2 + (v.t - 18) * 1.2), n: -0.95, dir: v.c[4] > 0 ? 1 : -1, ...castAt(v, 0) }); },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side), s = v.c[4], seatN = v.n + 0.1, backN = v.n + 0.33;   // (the bench faces the street: its back on the building side)
      // The fresh coat, a little proud of the bench underneath, the sign, the can and brush.
      { let [x, z] = P(f, v.a, seatN); F.box(x, Y0 + 0.45, z, 1.84, 0.11, 0.47, f.h0, 0, PAINT);
        [x, z] = P(f, v.a, backN); F.box(x, Y0 + 0.75, z, 1.84, 0.42, 0.07, f.h0, 0, PAINT);
        [x, z] = P(f, v.a + 0.3, backN - 0.045); F.box(x, Y0 + 0.78, z, 0.36, 0.22, 0.01, f.h0, 0, 0xf4f0d8);
        for (const k of [0.04, -0.04]) { [x, z] = P(f, v.a + 0.3, backN - 0.052); F.box(x, Y0 + 0.78 + k, z, 0.28, 0.03, 0.005, f.h0, 0, 0xd0202a); }
        [x, z] = P(f, v.a - 1.25, v.n + 0.25); F.box(x, Y0 + 0.11, z, 0.2, 0.22, 0.2, 0, 0, 0xb8bcc0); F.box(x, Y0 + 0.225, z, 0.2, 0.02, 0.2, 0, 0, PAINT);
        F.box(x + 0.05, Y0 + 0.3, z, 0.04, 0.2, 0.06, 0.4, 0.5, 0x8a5a2a); }
      if (v.rel & 1) return;
      const cs = castAt(v, 0), a0 = v.a - s * 12, standN = v.n - 0.5, sitN = seatN + 0.07;
      let body: Body;
      if (t < 10) {   // along, reading, on the kerb side of the furniture row
        const [x, z] = P(f, a0 + s * t * 1.2, standN), w = walkSwing(t * 1.2);
        body = { x, z, yaw: along(f, s), y: Y0 + w.bob, legs: w.legs, arms: [w.arms[0], 0.9], fore: [w.arms[0], 1.9], nod: 0.45, ...cs };
      } else if (t < 11.2) {   // stop in front of the bench and turn about, back to it
        const k = vEase(ramp(t, 10, 11.2)), [x, z] = P(f, v.a, standN);
        body = { x, z, yaw: lerp(along(f, s), toStreet(f) + (s > 0 ? 0 : -Math.PI * 2), k), legs: [0, 0], arms: [0.1, 0.9], fore: [0.1, 1.9], nod: 0.45, ...cs };
      } else if (t < 14.3) {   // sit down; settle in
        const k = vEase(ramp(t, 11.2, 12)), [x, z] = P(f, v.a, lerp(standN, sitN, k));
        const sit = sitting(0.5);
        body = { x, z, yaw: toStreet(f), hip: lerp(0.86, sit.hip!, k), legs: [lerp(0, 1.45, k), lerp(0, 1.45, k)], shins: [0.1, 0.1], arms: [0.1, 0.9], fore: [0.1, 1.9], nod: 0.45, lean: 0.1 - k * 0.2, ...cs };
      } else if (t < 14.8) {   // ...and up like a shot
        const k = vEase(ramp(t, 14.3, 14.6)), [x, z] = P(f, v.a, lerp(sitN, standN, k)), hop = Math.sin(ramp(t, 14.3, 14.8) * Math.PI) * 0.18;
        body = { x, z, yaw: toStreet(f), y: Y0 + hop, hip: lerp(0.56, 0.86, k), legs: [lerp(1.45, 0, k), lerp(1.45, 0, k)], shins: [lerp(0.1, 0, k), lerp(0.1, 0, k)], arms: [1.2, 1.2], armOut: [0.6, 0.6], ...cs };
      } else {   // turn round to the bench and look back over a shoulder at the damage, arms out (the
        // painted back to the street); then off, muttering
        const [x, z] = P(f, v.a, standN), look = ramp(t, 14.8, 15.4) * (1 - ramp(t, 17.6, 18));
        const spin = vEase(ramp(t, 14.8, 15.3)) * Math.PI + vEase(ramp(t, 17.6, 18)) * s * Math.PI / 2;
        if (t < 18) body = { x, z, yaw: toStreet(f) + spin, legs: [0, 0], arms: [0.4, 0.4], armOut: [0.9 * look, 0.9 * look], turn: look * 1.7 * s, nod: look * 0.5, tilt: look * 0.12 * s, ...cs };
        else {
          const u = (t - 18) * 1.2, k = vEase(ramp(t, 19, 20.2)), [wx, wz] = P(f, v.a + s * u, lerp(standN, -0.95, k)), w = walkSwing(u);
          body = { x: wx, z: wz, yaw: along(f, s), y: Y0 + w.bob, legs: w.legs, arms: w.arms, ...cs };
        }
      }
      F.person(body);
      if (t > 14.3) {   // the solid seat and back, printed on: the back of the shirt and the backs of the legs
        const yaw = body.yaw, fx = Math.cos(yaw), fz = -Math.sin(yaw), rx = Math.sin(yaw), rz = Math.cos(yaw), hy = (body.y ?? Y0) + (body.hip ?? 0.86);
        const lean = body.lean ?? 0, tilt = body.tilt ?? 0, sl = Math.sin(lean), cl = Math.cos(lean);
        // The backrest's 0.42 m, from just above the waist, across the shirt's width (Figures.person's torso: 0.24 deep, 0.36 wide).
        const up = 0.27, cx = body.x + (fx * sl + rx * Math.sin(tilt)) * up - fx * cl * 0.13, cy = hy + cl * Math.cos(tilt) * up + sl * 0.13, cz = body.z + (fz * sl + rz * Math.sin(tilt)) * up - fz * cl * 0.13;
        F.box(cx, cy, cz, 0.02, 0.42, 0.37, yaw, -lean, PAINT, -tilt);
        // The seat's 0.42 m down the back of each thigh, swung with the leg (legs 0.13 thick, 0.1 either side of the middle).
        for (let i = 0; i < 2; i++) {
          const k = i === 0 ? -1 : 1, sw = body.legs?.[i] ?? 0, ss = Math.sin(sw), cs2 = Math.cos(sw), d = 0.21, b = 0.075;
          const px = body.x + rx * k * 0.1 + fx * (ss * d - cs2 * b), pz = body.z + rz * k * 0.1 + fz * (ss * d - cs2 * b), py = hy - cs2 * d - ss * b;
          F.box(px, py, pz, 0.02, 0.42, 0.14, yaw, sw, PAINT);
        }
      }
    },
    foot: (v) => [v.a - 1.4, v.a + 1.4, -2.7, -1.6],
  },

  // Someone on a bench throwing crumbs to the pigeons; anyone hurrying by flushes them up, and
  // round they come again.
  pigeons: {
    w: (d, c) => (city(d, "park", "commercial", "downtown", "residential") && !wet(c) && day(c, 8, 18) ? 1.1 : 0), trigger: 0,
    place(v, c, r, V) {
      const b = furniture(c, v.bx, v.bz, v.side, PK.bench, V);
      if (!b.length) return false;
      [v.a, v.n] = pick(r, b);
      v.c.push(pick(r, [0x7a5a6a, 0x5a6a7a, 0x8a6a4a, 0x4a5a4a]), pick(r, PANTS), pick(r, SKINS), pick(r, OLD_HAIR));
      for (let i = 0; i < 9; i++) {   // (along, across): five on the strip in front, the rest past the ends
        const ua = r(), un = r();
        v.c.push(i < 5 ? (ua - 0.5) * 2.4 : (i % 2 ? 1 : -1) * (1.35 + ua * 1.1), i < 5 ? v.n - 0.36 - un * 0.12 : v.n - 0.5 + un * 1.1, r() * 10, r() < 0.15 ? 1 : 0);
      }
      v.st = [0, -99]; v.pst = [0, -99];
      return true;
    },
    step(v, c) {
      // Flushed by anyone close (a runner from further off), or by the truck; back after 9 s.
      if (v.st[0] === 0) {
        const f = frameOf(v.bx, v.bz, v.side), [cx, cz] = P(f, v.a, v.n - 0.5);
        const near = c.peds.some((p) => Math.hypot(p.x - cx, p.z - cz) < (p.run ? 3.6 : 1.9)) || c.truck.some((o) => Math.hypot(o.x - cx, o.z - cz) < o.r + 2.5);
        if (near) { v.st[0] = 1; v.st[1] = v.t; }
      } else if (v.t - v.st[1] > 9) v.st[0] = 0;
    },
    draw(v, F, t, D) {
      const f = frameOf(v.bx, v.bz, v.side), cs = castAt(v, 0);
      const [x, z] = P(f, v.a + 0.3, v.n + 0.17), toss = Math.max(0, Math.sin((t % 4.5) / 4.5 * Math.PI * 2 - 1.2));
      F.person({ x, z, yaw: toStreet(f), ...sitting(0.5), lean: 0.32, arms: [0.5, 0.5 + toss * 1.1], fore: [1.3, 0.8 + toss * 1.2], foreOut: [-0.5, 0.2], nod: 0.35, ...cs });
      { const [bx, bz] = P(f, v.a - 0.35, v.n + 0.12); F.box(bx, Y0 + 0.56, bz, 0.2, 0.14, 0.12, f.h0, 0, 0xe8dcc0); }   // the bag of crumbs
      const flushT = D.st[0] === 1 ? t - D.st[1] : -1;
      for (let i = 0; i < 9; i++) {
        const o = 4 + i * 4, ua = v.c[o], un = v.c[o + 1], ph = v.c[o + 2], wh = v.c[o + 3] ? 0xdedede : 0x7a7f88;
        const pa = v.a + ua + Math.sin(t * 0.3 + ph) * 0.35, pn = un + Math.cos(t * 0.27 + ph) * 0.08;
        let [bx, bz] = P(f, pa, pn), by = Y0, yaw = f.h0 + ph + Math.sin(t * 0.5 + ph) * 1.5;
        if (flushT >= 0 && flushT < 9) {
          // (up and round, and down again on the spot they left)
          const k = flushT / 9, arc = Math.sin(Math.min(1, k * 1.25) * Math.PI), up = arc * (3.5 + (i % 3)), ang = ph + k * 7;
          bx += Math.cos(ang) * 2.5 * arc; bz += Math.sin(ang) * 2.5 * arc; by += up;
          if (up > 0.05) { F.pigeon(bx, by, bz, ang + Math.PI / 2, 0, t * 22 + i, wh); continue; }
        }
        F.pigeon(bx, by, bz, yaw, Math.max(0, Math.sin(t * 5 + ph * 3)) ** 3, null, wh);
      }
      // Crumbs in the air.
      const ct = t % 4.5;
      if (ct > 2.0 && ct < 2.7) { const k = (ct - 2.0) / 0.7, [cx, cz] = P(f, v.a + 0.3, lerp(v.n - 0.1, v.n - 0.55, k)); F.box(cx, Y0 + 0.9 * Math.sin(k * Math.PI) + 0.2, cz, 0.04, 0.04, 0.04, 0, 0, 0xf0e2b8); }
    },
  },

  // Rain: a gust turns a walker's umbrella inside out; a struggle; it snaps back.
  umbrella: {
    w: (d, c) => (d !== "industrial" && c.w.rain > 0.3 ? 2.5 : 0), trigger: 45,
    place(v, c, r) {
      if (!sideOk(c, v.bx, v.bz, v.side)) return false;
      v.a = 20 + r() * 12; v.n = -0.95; cast(r, v.c); v.c.push(pick(r, UMBRELLAS));
      return true;
    },
    step(v, c, V) { if (v.t > 16) release(v, 0, V, { a: v.a - 10 + umbU(16), n: v.n, dir: 1, ...castAt(v, 0), umbrella: v.c[4] }); },
    draw(v, F, t) {
      if (v.rel & 1) return;
      const f = frameOf(v.bx, v.bz, v.side), cs = castAt(v, 0), u = umbU(t), flip = ramp(t, 8, 8.25) * (1 - ramp(t, 11.2, 11.45));
      const fight = t > 8 && t < 11.4, stagger = fight ? Math.sin((t - 8) * 3.1) * 0.35 : 0;
      const [x, z] = P(f, v.a - 10 + u, v.n + stagger * 0.4), w = walkSwing(u), moving = t < 8 || t > 11.4;
      const jerk = fight ? Math.sin((t - 8) * 9) * 0.25 : 0;
      F.person({ x, z, yaw: along(f) + stagger * 0.3, y: Y0 + (moving ? w.bob : 0), legs: moving ? w.legs : [0.3 * Math.sin(t * 6), -0.3 * Math.sin(t * 6)], arms: [moving ? w.arms[0] : 1.2 + jerk, fight ? 2.5 + jerk : 0.75], fore: fight ? [1.6 + jerk, 2.7 + jerk] : [moving ? w.arms[0] : 1.2, 2.3], lean: fight ? -0.2 : 0.05, tilt: stagger * 0.5, ...cs });
      const h = F.handR, hx = h[0] + (fight ? Math.cos(along(f)) * 0.25 : 0), hz = h[2] - (fight ? Math.sin(along(f)) * 0.25 : 0);
      F.umbrella(hx, h[1] + 0.62 + flip * 0.15, hz, h, v.c[4], flip, along(f) + Math.PI / 4 + (fight ? Math.sin(t * 7) * 0.3 : 0));
    },
  },

  // An ice cream cart; a child gets a cone, drops the scoop, howls; a passing dog cleans up.
  iceCream: {
    w: (d, c) => (city(d, "park", "commercial", "residential") && !wet(c) && day(c, 11, 19) && (c.season === "summer" || c.season === "spring") ? 1.4 : 0), trigger: 40,
    place(v, c, r, V) {
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 2.2, -3, -1.6, r);
      if (a === null) return false;
      v.a = a; v.n = -2.3;
      cast(r, v.c); cast(r, v.c); cast(r, v.c);   // the child, the parent, the dog walker
      v.c.push(pick(r, SCOOPS), pick(r, DOGS), 0.8 + r() * 0.6);
      return true;
    },
    step(v, c, V) {
      if (v.t > 16.5) { const ua = 3.5 + (v.t - 13.5) * 1.0; release(v, 0, V, { a: v.a + ua + 0.4, n: -0.75, dir: 1, ...castAt(v, 0), s: 0.6, speed: 1.0 }); release(v, 1, V, { a: v.a + ua - 0.3, n: -1.15, dir: 1, ...castAt(v, 1), speed: 1.0 }); }
      if (v.t > 17) release(v, 2, V, { a: v.a + 3.9 - (v.t - 14.5) * 1.2 - 1.3, n: -1.0, dir: -1, ...castAt(v, 2), dog: v.c[13] });
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side);
      // The cart and its striped umbrella; the vendor behind it on the kerb side.
      { const [x, z] = P(f, v.a, v.n);
        F.box(x, Y0 + 0.55, z, 1.5, 0.8, 0.85, f.h0, 0, 0xf6f2ec); F.box(x, Y0 + 0.97, z, 1.52, 0.06, 0.87, f.h0, 0, 0xff8fb0);
        for (const k of [-0.6, 0.6]) { const [wx, wz] = P(f, v.a + k, v.n - 0.43); F.box(wx, Y0 + 0.18, wz, 0.34, 0.34, 0.06, f.h0, 0, 0x333333); }
        F.box(x, Y0 + 1.6, z, 0.05, 1.2, 0.05, 0, 0, 0xcccccc);
        for (let i = 0; i < 6; i++) { const ang = f.h0 + i * Math.PI / 3; F.box(x + Math.cos(ang) * 0.42, Y0 + 2.13, z - Math.sin(ang) * 0.42, 0.85, 0.05, 0.5, ang, -0.25, i % 2 ? 0xffffff : 0xff6fa0); }
        const [vx, vz] = P(f, v.a + 1.15, v.n + 0.05), serve = t > 0.5 && t < 2.5 ? 1 : 0;
        F.person({ x: vx, z: vz, yaw: toBldg(f) + 0.5, arms: [0.3 + serve * 1.0, 0.25 + Math.sin(t * 1.2) * 0.1], shirt: 0xffffff, pants: 0x2c3e50, skin: v.c[2], hair: v.c[3], hat: 0xffffff, hatH: 0.12 }); }
      // The scoop on the pavement, licked smaller.
      const lick = ramp(t, 10.5, 14.5);
      if (t > 7.4) { const [sx, sz] = P(f, v.a + 3.9, -0.95); F.box(sx, Y0 + 0.02, sz, 0.18 * (1 - lick * 0.8), 0.04, 0.16 * (1 - lick * 0.8), f.h0, 0, v.c[12]); if (lick < 0.9) F.box(sx + 0.12, Y0 + 0.008, sz, 0.12 * (1 - lick), 0.01, 0.1, f.h0, 0, v.c[12]); }
      // The child and the parent.
      if (!(v.rel & 3)) {
        const kidA = t < 3 ? -0.2 : t < 7 ? -0.2 + (t - 3) * 0.95 : t < 13.5 ? 3.6 : 3.6 + (t - 13.5) * 1.0, moving = (t > 3 && t < 7) || t > 13.5;
        const cry = t > 7.4 && t < 12.5, faceCart = t < 3;
        const kid = castAt(v, 0), par = castAt(v, 1);
        const [kx, kz] = P(f, v.a + kidA + 0.4, faceCart ? -1.45 : -0.75), w = walkSwing(t * 1.4);
        const sob = cry ? Math.sin(t * 9) * 0.2 : 0;
        F.person({ x: kx, z: kz, s: 0.6, yaw: faceCart ? toStreet(f) : along(f), y: Y0 + (moving ? w.bob : 0), legs: moving ? w.legs : [0, 0], arms: cry ? [0.15 + sob, 0.15 - sob] : t < 7.2 && t > 1.6 ? [w.arms[0] * (moving ? 1 : 0), 0.7] : [0, 0], fore: !cry && t < 7.2 && t > 1.6 ? [moving ? w.arms[0] : 0, 2.1] : null, nod: cry ? -0.35 : 0, turn: t > 7.2 && t < 7.8 ? -0.6 : 0, ...kid });
        if (t > 1.6 && t < 7.2) {   // the cone (and the scoop, until it goes)
          const h = F.handR;
          F.box(h[0], h[1] + 0.06, h[2], 0.06, 0.13, 0.06, 0, 0, CONE);
          if (t < 7.0) F.box(h[0], h[1] + 0.16, h[2], 0.1, 0.09, 0.1, 0, 0, v.c[12]);
        } else if (t >= 7.0 && t < 7.4) { const k = (t - 7.0) / 0.4, [sx, sz] = P(f, v.a + 3.9, -0.95); F.box(sx, lerp(Y0 + 0.75, Y0 + 0.03, k * k), sz, 0.1, 0.09, 0.1, k * 4, 0, v.c[12]); }
        else if (cry || t > 12.5) { const h = F.handR; F.box(h[0], h[1] + 0.06, h[2], 0.06, 0.13, 0.06, 0, 0, CONE); }
        // The parent: beside the child; down to comfort them.
        const kneel = ramp(t, 8, 8.6) * (1 - ramp(t, 12.6, 13.2));
        const [px, pz] = P(f, v.a + kidA - 0.3 + kneel * 0.3, faceCart ? -1.3 : lerp(-1.15, -1.05, kneel));
        F.person({ x: px, z: pz, yaw: faceCart ? toStreet(f) : along(f) + kneel * 0.8, y: Y0 + (moving ? w.bob : 0), hip: lerp(0.86, 0.5, kneel), legs: moving ? w.legs : [kneel * 1.5, kneel * 0.2], shins: kneel > 0 ? [-kneel * 0.4, -kneel * 1.5] : null, arms: [kneel * 1.2, 0.05 + kneel * 0.3], lean: kneel * 0.25, ...par });
      }
      // The dog walker coming the other way; the dog to the scoop, then on.
      if (!(v.rel & 4) && t > 6) {
        const wa = t < 10.2 ? v.a + 14 - (t - 6) * 1.2 : t < 14.5 ? v.a + 14 - 4.2 * 1.2 : v.a + 14 - 4.2 * 1.2 - (t - 14.5) * 1.2;
        const moving = t < 10.2 || t > 14.5, [wx, wz] = P(f, wa, -1.0);
        walker(F, f, wa, -1.0, along(f, -1), t * 1.2, castAt(v, 2), moving, { arms: moving ? undefined : [0.5, 0], turn: moving ? 0 : -0.4 });
        const hand = [...F.handL] as V3, S = v.c[14], licking = t > 10.5 && t < 14.5;
        const da = licking ? v.a + 3.9 + 0.3 * S : wa - 1.3, [dx, dz] = P(f, da, licking ? -0.95 : -0.9), dy = along(f, -1);
        F.dog({ x: dx, z: dz, yaw: dy, phase: licking ? 10 : t * 2.2, gait: licking ? 0 : 0.6, color: v.c[13], size: S, belle: v.c[13] === V_BELLE, head: licking ? 0.8 + Math.sin(t * 14) * 0.2 : 0, tail: t * 16 });
        void wx; void wz;
        leash(F, hand, dx + Math.cos(dy) * 0.19 * S, Y0 + 0.4 * S, dz - Math.sin(dy) * 0.19 * S);
      }
    },
    foot: (v) => [v.a - 1.0, v.a + 1.6, -3, -1.6],
  },

  // The truck stopped at the kerb: a parking officer strolls up, writes it a ticket and tucks it
  // on the cab window.
  ticket: {
    w: () => 0, trigger: 0,   // (started by step when the truck is parked)
    place() { return false; },
    step(v, c, V) {
      const p = c.parked;
      v.st[1] = p && Math.hypot(p.cabX - v.st[2], p.cabZ - v.st[3]) < 0.3 ? 1 : 0;   // still there?
      if (v.t > 24) release(v, 0, V, { a: v.a + v.c[4] * (v.t - 18) * 1.1, n: -1.0, dir: v.c[4] > 0 ? 1 : -1, ...castAt(v, 0), hat: 0x1f2f55 });
    },
    draw(v, F, t, D) {
      const f = frameOf(v.bx, v.bz, v.side), s = v.c[4], cs = castAt(v, 0);
      if (t > 17.6 && D.st[1]) { const [x, z] = P(f, v.a, -3.32); F.box(x, Y0 + 1.75, z, 0.18, 0.1, 0.012, f.h0, 0.15, 0xfff2a0); }
      if (v.rel & 1) return;
      let body: Body;
      if (t < 12) { const [x, z] = P(f, v.a - s * (13 - t * 1.08), -1.0), w = walkSwing(t * 1.08); body = { x, z, yaw: along(f, s), y: Y0 + w.bob, legs: w.legs, arms: w.arms, ...cs }; }
      else if (t < 18.2) {
        const k = vEase(ramp(t, 12, 13)), back = vEase(ramp(t, 17.6, 18.2)), [x, z] = P(f, v.a - s * 0.04, lerp(-1.0, -2.55, k) + back * 0.1);
        const write = t > 13 && t < 17 ? 1 : 0, scrib = Math.sin(t * 11) * 0.12 * write, reach = ramp(t, 17, 17.5) * (1 - back);
        body = { x, z, yaw: lerp(along(f, s), toStreet(f) + (s > 0 ? 0 : Math.PI * 2), k), legs: [0, 0], arms: [0.55 * write + reach * 1.5, 0.75 * write + scrib + reach * 0.3], fore: [1.3 * write + reach * 1.6, 1.6 * write + scrib], foreOut: [-0.35, 0.3], nod: 0.5 * write, ...cs };
      } else { const u = (t - 18.2) * 1.1, k = vEase(ramp(t, 18.2, 19)), [x, z] = P(f, v.a + s * u, lerp(-2.45, -1.0, k)), w = walkSwing(u); body = { x, z, yaw: along(f, s), y: Y0 + w.bob, legs: w.legs, arms: w.arms, ...cs }; }
      F.person({ ...body, hat: 0x1f2f55 });
      if (t > 12.5 && t < 17.6) { const h = F.handL; F.box(h[0], h[1] + 0.04, h[2], 0.1, 0.14, 0.03, body.yaw, 0, 0xf2f2e8); }   // the ticket book
    },
  },

  // A child drawing on the pavement in chalk, a hopscotch growing; then another hops it.
  chalk: {
    w: (d, c) => (city(d, "residential", "park") && !wet(c) && !c.snow && day(c, 9, 19) ? 1.2 : 0), trigger: 0,
    place(v, c, r, V) {
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 6, -2.0, -0.2, r);
      if (a === null) return false;
      v.a = a; v.n = -1.05; cast(r, v.c); cast(r, v.c);
      for (let i = 0; i < 6; i++) v.c.push(pick(r, CHALK));
      return true;
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side), done = ramp(t, 2, 20);
      // Hopscotch: 1, 2, 3-4, 5, 6-7, 8 along a, then a sun beside it; drawn stroke by stroke.
      const cells: [number, number][] = [[0, 0], [0.55, 0], [1.1, -0.28], [1.1, 0.28], [1.65, 0], [2.2, -0.28], [2.2, 0.28], [2.75, 0]];
      const strokes = Math.floor(done * (cells.length * 4 + 12));
      let k = 0;
      const line = (a: number, n: number, la: number, ln: number, col: number) => { if (k++ >= strokes) return; const [x, z] = P(f, a, n); F.box(x, Y0 + 0.008, z, la, 0.006, ln, f.h0, 0, col); };
      for (const [ca, cn] of cells) {
        const a = v.a - 1.4 + ca, n = v.n + cn, col = v.c[8];
        line(a - 0.25, n, 0.03, 0.5, col); line(a + 0.25, n, 0.03, 0.5, col); line(a, n - 0.25, 0.5, 0.03, col); line(a, n + 0.25, 0.5, 0.03, col);
      }
      for (let i = 0; i < 10; i++) { const th = i / 10 * Math.PI * 2, [x, z] = P(f, v.a + 2.4 + Math.cos(th) * 0.38, v.n - 0.4 + Math.sin(th) * 0.38); if (k++ < strokes) F.box(x, Y0 + 0.008, z, 0.06, 0.006, 0.22, f.h0 - th, 0, v.c[9]); }
      if (k++ < strokes) { const [x, z] = P(f, v.a + 2.4, v.n - 0.4); F.box(x, Y0 + 0.008, z, 0.3, 0.006, 0.3, f.h0 + 0.4, 0, v.c[9]); }
      // The artist, kneeling, the chalk going.
      const at = Math.min(cells.length - 1, Math.floor(done * cells.length)), ka = done < 1 ? v.a - 1.4 + cells[at][0] : v.a + 2.4;
      const [kx, kz] = P(f, ka, v.n + 0.55), sc = Math.sin(t * 6) * 0.2;
      F.person({ x: kx, z: kz, s: 0.6, yaw: toStreet(f), hip: 0.3, legs: [0.1, 0.1], shins: [-1.5, -1.5], lean: 0.75, arms: [1.3 + sc, 0.6], nod: 0.6, ...castAt(v, 0) });
      F.box(F.handL[0], F.handL[1] - 0.02, F.handL[2], 0.03, 0.05, 0.03, 0, 0, v.c[8 + (Math.floor(t / 6) % 3)]);
      // The hopper: waiting, then hopping the squares and back.
      const ht = t - 20, cyc = ht > 0 ? ht % 9 : -1, cs = castAt(v, 1);
      if (cyc < 0 || cyc > 6.5) { const [x, z] = P(f, v.a - 2.2, v.n - 0.3); F.person({ x, z, s: 0.62, yaw: along(f), arms: [0.2, -0.1], turn: Math.sin(t * 0.4) * 0.5, ...cs }); }
      else {
        const hop = cyc / 0.75, i = Math.min(cells.length - 1, Math.floor(hop)), fr = hop - Math.floor(hop), back = cyc > 6;
        const ci = back ? 0 : i, cn = cells[ci][1] === 0 ? 0 : 0, a0 = v.a - 1.4 + (i > 0 ? cells[i - 1][0] : -0.8), a1 = v.a - 1.4 + cells[ci][0];
        const a = back ? lerp(v.a - 1.4 + 2.75, v.a - 2.2, (cyc - 6) / 0.5) : lerp(a0, a1, fr), y = Math.sin(fr * Math.PI) * 0.25, [x, z] = P(f, a, v.n + cn);
        const two = cells[ci][1] !== 0;
        F.person({ x, z, s: 0.62, yaw: along(f, back ? -1 : 1), y: Y0 + y, legs: two ? [0, 0] : [0, 0.9], shins: two ? null : [0, -0.6], legOut: two ? [0.25, 0.25] : [0, 0], arms: [0.6, 0.6], armOut: [0.5, 0.5], ...cs });
      }
    },
    foot: (v) => [v.a - 2.6, v.a + 3.0, -1.9, -0.2],
  },

  // A window-washing cradle on a tower: two in hard hats wiping as it inches down, then up again.
  washers: {
    w: (d, c) => (d === "downtown" && !wet(c) && day(c, 8, 17) && c.w.storm < 0.5 ? 1.3 : 0), trigger: 0,
    place(v, c, r, V) {
      if (c.plan.downtownHeight(v.bx, v.bz) < 0.4) return false;   // towers, not a plaza's edge
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 4, -0.8, 0, r, 15, 45);
      if (a === null) return false;
      v.a = a; v.n = 0; cast(r, v.c); cast(r, v.c);
      return true;
    },
    draw(v, F, t) {
      // The wall: a tower's face across the pavement (or a plaza), near the spot or round the block.
      let f = frameOf(v.bx, v.bz, v.side), A = v.a, wallN = 99, top = 0;
      search: for (let k = 0; k < 4; k++) {
        const ff = frameOf(v.bx, v.bz, (v.side + k) % 4);
        for (const da of [0, 5, -5, 10, -10, 15, -15]) {
          const a = k === 0 ? v.a + da : 30 + da;
          if (a < 14 || a > 46) continue;
          // (Across open ground, a plaza, to the first thing that stands: a tower, or give up.)
          for (let n = -0.5; n <= 34; n += 0.5) {
            let hmin = Infinity, hmax = 0;
            for (const d2 of [-1.4, 0, 1.4]) { const [x, z] = P(ff, a + d2, n + 0.25), h = OCCLUSION.heightAt(x, z); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
            if (hmin > 11) { f = ff; A = a; wallN = n; top = hmin; break search; }
            if (n > 0.5 && hmax > 2.5) break;
          }
        }
      }
      if (wallN > 50) return;
      washSeen[2] = (v.side + 0) % 4; washSeen[3] = A; washSeen[4] = f.h0;
      const lo = 4.5, hi = top - 2.5, span = hi - lo, down = span / 0.12, upT = span / 0.5, cyc = (t + Math.max(0, hi - 12) / 0.12) % (down + upT + 20);
      const y = cyc < down ? hi - cyc * 0.12 : cyc < down + 10 ? lo : cyc < down + 10 + upT ? lo + (cyc - down - 10) * 0.5 : hi;
      const yaw = toBldg(f), wn = wallN - 0.7;
      washSeen[0] = wn; washSeen[1] = y; [washPt[0], washPt[1]] = P(f, A, wn); washF[0] = f.fx; washF[1] = f.fz; washF[2] = -f.rx; washF[3] = -f.rz;
      { const [x, z] = P(f, A, wn); F.box(x, y, z, 3.4, 0.1, 0.7, f.h0, 0, 0x9aa0a6); F.box(x, y + 0.55, z - 0, 3.4, 0.05, 0.7, f.h0, 0, 0xb8bcc0);
        for (const k of [-1.65, 1.65]) { const [px, pz] = P(f, A + k, wn); F.box(px, y + 0.28, pz, 0.05, 0.55, 0.7, f.h0, 0, 0xb8bcc0); }
        const [ox, oz] = P(f, A, wn - 0.33); F.box(ox, y + 0.28, oz, 3.4, 0.05, 0.03, f.h0, 0, 0xb8bcc0); }
      for (const k of [-1.5, 1.5]) {   // cables up to the davits on the roof
        const [px, pz] = P(f, A + k, wn), [rx, rz] = P(f, A + k, wallN - 0.6);
        F.seg(px, y + 0.55, pz, rx, top + 1.2, rz, 0.025, 0x333333);
        const [dx, dz] = P(f, A + k, wallN + 0.4); F.seg(dx, top, dz, rx, top + 1.25, rz, 0.08, 0x6a6e72);
      }
      for (let i = 0; i < 2; i++) {
        const k = i ? 0.75 : -0.75, wipe = t * (1.6 + i * 0.3) + i * 2, [x, z] = P(f, A + k, wn + 0.08);
        F.person({ x, z, yaw, y: y + 0.05, arms: [1.6 + Math.sin(wipe) * 0.4, 0.4], armOut: [0.25 + Math.cos(wipe) * 0.3, 0.1], ...castAt(v, i), shirt: HIVIS, hat: HARDHAT });
        const h = F.handL; F.box(h[0], h[1], h[2], 0.06, 0.04, 0.3, f.h0, 0, 0x2a2a2a);
        const b = P(f, A + k * 1.5, wn - 0.15); F.box(b[0], y + 0.17, b[1], 0.22, 0.22, 0.22, 0, 0, 0xd8402a);   // bucket
      }
    },
  },

  // A food truck parked just inside a park, its hatch open; a queue on the pavement, longer
  // at lunch, shuffling up as each customer gets their food and goes.
  foodTruck: {
    w: (d, c) => (d === "park" && !c.snow && day(c, 10, 20) && c.w.storm < 0.5 ? 2.2 : 0), trigger: 0,
    place(v, c, r, V) {
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 7, -1.2, 3.4, r, 12, 26) ?? freeSpot(V, c, v.bx, v.bz, v.side, 7, -1.2, 3.4, r, 34, 48);
      if (a === null) return false;
      v.a = a; v.n = 1.7;
      v.c.push(pick(r, [0x16a085, 0xe67e22, 0xc0392b, 0x2e86c1, 0xf1c40f, 0x8e44ad]), c.hour >= 11.5 && c.hour < 13.8 ? 6 + Math.floor(r() * 3) : 2 + Math.floor(r() * 3), r() < 0.5 ? 1 : -1, 0);
      cast(r, v.c);   // the cook
      return true;
    },
    step(v, c, V) {
      const k = Math.floor(v.t / 12);
      if (k > 0 && !(v.st[1] >= k)) {   // the one just served walks off along the pavement
        v.st[1] = k; v.rel = 0;
        const cs = extra(v, k - 1), s = -v.c[2] as 1 | -1;
        V.adopt?.({ bx: v.bx, bz: v.bz, side: v.side, a: v.a + 1.4 + s * 0.5, n: -0.75, dir: s, ...cs, speed: 1.15 });
      }
    },
    draw(v, F, t, D) {
      const f = frameOf(v.bx, v.bz, v.side), col = v.c[0], L = v.c[1], s = v.c[2];
      const [x, z] = P(f, v.a, v.n);
      // Body, cab, wheels, the hatch and its awning, a menu board, the cook in the window.
      F.box(x, 0.95 + Y0 + 0.35, z, 5.0, 2.3, 2.2, f.h0, 0, col);
      { const [cx, cz] = P(f, v.a - s * 3.2, v.n); F.box(cx, Y0 + 1.15, cz, 1.4, 1.9, 2.1, f.h0, 0, col); const [wx, wz] = P(f, v.a - s * 3.92, v.n); F.box(wx, Y0 + 1.6, wz, 0.04, 0.6, 1.8, f.h0, 0, 0x22303a); }
      for (const ka of [-3.0, 1.6]) for (const kn of [-1.0, 1.0]) { const [wx, wz] = P(f, v.a + s * ka, v.n + kn); F.box(wx, Y0 + 0.38, wz, 0.75, 0.75, 0.3, f.h0, 0, 0x1a1a1a); }
      const [hx, hz] = P(f, v.a + s * 0.5, v.n - 1.12); F.box(hx, Y0 + 1.75, hz, 2.4, 0.95, 0.04, f.h0, 0, 0x2a1e14);
      if (D.night) F.glow(hx, Y0 + 1.75, hz + 0, 2.2, 0.8, 0.03, f.h0, 0xffd890);
      const [ax, az] = P(f, v.a + s * 0.5, v.n - 1.55); F.box(ax, Y0 + 2.35, az, 2.6, 0.06, 0.95, f.h0, 0, 0xffffff, 0); F.box(ax, Y0 + 2.36, az, 2.6, 0.04, 0.35, f.h0, 0, 0xc0392b);
      const [sx, sz] = P(f, v.a + s * 0.5, v.n - 1.3); F.box(sx, Y0 + 1.25, sz, 2.4, 0.06, 0.4, f.h0, 0, 0xb8bcc0);
      const [mx, mz] = P(f, v.a + s * 2.0, v.n - 1.13); F.box(mx, Y0 + 1.75, mz, 0.6, 0.8, 0.02, f.h0, 0, 0x1a1a1a); for (let i = 0; i < 4; i++) F.box(mx, Y0 + 2.0 - i * 0.16, mz - 0, 0.44, 0.03, 0.025, f.h0, 0, 0xf4f0d8);
      { const [px, pz] = P(f, v.a + s * (0.5 + Math.sin(t * 0.7) * 0.6), v.n - 1.05), cook = castAt(v, 1), y = Y0 + 1.4;
        F.box(px, y + 0.25, pz, 0.36, 0.5, 0.2, toStreet(f), 0, 0xffffff); F.box(px, y + 0.62, pz, 0.21, 0.24, 0.2, toStreet(f), 0, cook.skin); F.box(px, y + 0.78, pz, 0.23, 0.1, 0.22, toStreet(f), 0, 0xffffff); }
      // The queue: position 0 at the hatch, the rest lined up along the pavement.
      const k = Math.floor(t / 12), ph = t - k * 12, shuffle = vEase(ramp(ph, 0.5, 2.5));
      const slotA = (i: number) => (i === 0 ? v.a + s * 0.5 : v.a + s * 0.5 - s * (0.4 + i * 0.75)), slotN = (i: number) => (i === 0 ? -0.45 : -0.85);
      for (let j = 0; j < L + 1; j++) {
        const id = k + j, i = j, from = i + 1, sh = shuffle;
        if (j === L) {   // the newcomer walking up to the back
          const arrive = ramp(ph, 0, 10), aa = lerp(slotA(L - 1) - s * 14, slotA(L - 1), arrive), moving = arrive < 1;
          walker(F, f, aa, slotN(L - 1), along(f, s), ph * 1.2, extra(v, id), moving);
          continue;
        }
        const a = lerp(slotA(from), slotA(i), i === L - 1 ? 1 : sh), n = lerp(slotN(from), slotN(i), sh), moving = sh > 0 && sh < 1 && i < L - 1;
        const facing = i === 0 && sh > 0.9 ? toBldg(f) : along(f, s), waiting = !moving;
        walker(F, f, a, n, facing, t * 1.2 + j, extra(v, id), moving, waiting ? { turn: Math.sin(t * 0.3 + id) * 0.4, arms: [0.05, i === 0 && ph > 8 ? 1.1 : -0.05] } : {});
        if (i === 0 && ph > 9) { const h = F.handR; F.box(h[0], h[1], h[2], 0.2, 0.08, 0.14, facing, 0, 0xf4e8d0); }
      }
    },
    foot: (v) => [Math.min(v.a + v.c[2] * 1.2, v.a - v.c[2] * (0.4 + v.c[1] * 0.75 + 0.5)), Math.max(v.a + v.c[2] * 1.2, v.a - v.c[2] * (0.4 + v.c[1] * 0.75 + 0.5)), -1.2, -0.2],
  },

  // A bike courier with a big insulated bag, splitting the lanes, braking for whatever's in the
  // way, and through on the amber (and the first blink of red).
  courier: {
    w: (d, c) => (d !== "industrial" && c.hour >= 7 && c.hour < 23 && !c.snow ? 1.3 : 0), trigger: 0,
    place(v, c, r) {
      // A street heading past the truck: start a block or so off, pointed its way.
      const ix = Math.round((c.focus.x - STREET / 2) / BLOCK), iz = Math.round((c.focus.z - STREET / 2) / BLOCK);
      const d = Math.floor(r() * 4), back = 1 + Math.floor(r() * 2), sx = ix - DIR_X[d] * back, sz = iz - DIR_Z[d] * back;
      if (!insideCity(sx, sz) || !insideCity(sx + DIR_X[d], sz + DIR_Z[d])) return false;
      if (c.plan.freewayStreet(d % 2, Math.min(sx, sx + DIR_X[d]), Math.min(sz, sz + DIR_Z[d]))) return false;
      const x = nodeX(sx) + DIR_X[d] * 9, z = nodeZ(sz) + DIR_Z[d] * 9, h = d * Math.PI / 2;
      v.st = [0, x, z, h, 5, sx, sz, d, 9]; v.pst = v.st.slice();   // [_, x, z, h, v, node ix, iz, dir, s along]
      v.c.push(pick(r, [0x27ae60, 0xff5722, 0xf1c40f, 0x00bcd4]), pick(r, PANTS), pick(r, SKINS), pick(r, HAIRS), pick(r, [0x2ecc71, 0xff7a1a, 0xe91e63, 0x1abc9c]));
      return true;
    },
    step(v, c) {
      const S = v.st, d = S[7];
      let ix = S[5], iz = S[6], s = S[8], sp = S[4];
      // Anything just ahead in its line: brake.
      const fx = DIR_X[d], fz = DIR_Z[d], x = S[1], z = S[2];
      let gap = Infinity;
      const scan = (o: { x: number; z: number; r?: number }) => { const dx = o.x - x, dz = o.z - z, al = dx * fx + dz * fz, lat = Math.abs(-dx * fz + dz * fx); if (al > 0 && al < 12 && lat < (o.r ?? 0.4) + 0.75) gap = Math.min(gap, al - (o.r ?? 0.4)); };
      for (const o of c.truck) scan(o); for (const o of c.cars) scan(o); for (const p of c.peds) scan(p);
      // The light at the next node, for this axis.
      const nx = ix + fx, nz = iz + fz, stopAt = BLOCK - 9 - 2.5;
      if (s < stopAt + 0.5 && insideCity(nx, nz)) {
        const sig = signalState(nx, nz, (d % 2) as SignalAxis, c.simTime, c.plan.seed, c.prs);
        const justRed = sig === "red" && signalState(nx, nz, (d % 2) as SignalAxis, c.simTime - 0.5, c.plan.seed, c.prs) !== "red";
        if (!(sig === "green" || sig === "yellow" || justRed)) gap = Math.min(gap, stopAt - s);
      }
      const want = Math.max(0, Math.min(6.5, (gap - 1.5) * 1.6));
      sp += Math.max(-6 * SIM_DT, Math.min(2.5 * SIM_DT, want - sp));
      s += sp * SIM_DT;
      if (s >= BLOCK) { s -= BLOCK; ix = nx; iz = nz; }
      const off = 2.9 + Math.sin(v.t * 0.8) * 0.15;   // right of travel, between the lanes
      S[1] = nodeX(ix) + fx * s + Math.sin(d * Math.PI / 2) * off; S[2] = nodeZ(iz) + fz * s + Math.cos(d * Math.PI / 2) * off;
      S[4] = sp; S[5] = ix; S[6] = iz; S[8] = s;
      if (!insideCity(ix + fx, iz + fz) || !insideCity(ix, iz)) S[0] = 1;   // the edge of town: gone (far off)
    },
    draw(v, F, t, D) {
      const S = D.st, x = S[1], z = S[2], h = S[3], fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
      const ped = v.t * 0 + S[8] * 1.4, cs = { shirt: v.c[0], pants: v.c[1], skin: v.c[2], hair: v.c[3] };
      // The bike: wheels, frame, bars.
      for (const k of [-0.52, 0.52]) { const wx = x + fx * k, wz = z + fz * k; F.box(wx, 0.34, wz, 0.66, 0.1, 0.04, h, ped * 2, 0x1a1a1a); F.box(wx, 0.34, wz, 0.66, 0.1, 0.04, h, ped * 2 + Math.PI / 2, 0x1a1a1a); }
      F.seg(x - fx * 0.52, 0.34, z - fz * 0.52, x + fx * 0.1, 0.9, z + fz * 0.1, 0.05, 0x8a8f94);
      F.seg(x + fx * 0.52, 0.34, z + fz * 0.52, x + fx * 0.42, 1.05, z + fz * 0.42, 0.05, 0x8a8f94);
      F.seg(x - fx * 0.12, 0.6, z - fz * 0.12, x + fx * 0.42, 0.95, z + fz * 0.42, 0.05, 0x8a8f94);
      F.box(x + fx * 0.42, 1.06, z + fz * 0.42, 0.05, 0.05, 0.5, h, 0, 0x2a2a2a);
      const pedal = S[8] * 2.2, stopped = S[4] < 0.3;
      F.person({ x: x - fx * 0.12, z: z - fz * 0.12, yaw: h, y: 0.02, hip: 0.98, lean: 0.75, legs: stopped ? [0.9, 0.05] : [0.9 + Math.sin(pedal) * 0.45, 0.9 - Math.sin(pedal) * 0.45], shins: stopped ? [0.1, 0.05] : [Math.sin(pedal + 1.2) * 0.4 - 0.1, -Math.sin(pedal + 1.2) * 0.4 - 0.1], legOut: stopped ? [0, 0.25] : [0, 0], arms: [1.15, 1.15], ...cs, hat: 0x222222, hatH: 0.08 });
      const back = F.hipC;
      F.box(back[0] - fx * 0.32 + 0, back[1] + 0.6 + Math.sin(0.75) * 0.1, back[2] - fz * 0.32, 0.42, 0.42, 0.42, h, -0.75, v.c[4]);
      void rx; void rz;
    },
    done: (v) => v.st[0] === 1,
  },

  // A couch stuck in a doorway: one mover heaving at the end, twisting and tilting it; a friend
  // on the pavement waving directions; boxes waiting.
  couch: {
    w: (d, c) => (city(d, "residential", "commercial") && !wet(c) && day(c, 8, 18) ? 1.1 : 0), trigger: 0,
    place(v, c, r, V) {
      if (!sideOk(c, v.bx, v.bz, v.side)) return false;
      const door = kerbDoors(c.plan, v.bx, v.bz)[v.side];
      if (!door || door.y !== undefined || door.a < 14 || door.a > 46 || V.clashes(v.bx, v.bz, v.side, door.a - 3, door.a + 3, -2.5, 0)) return false;
      v.a = door.a; v.n = door.n; cast(r, v.c); cast(r, v.c);
      v.c.push(pick(r, [0xc89a2a, 0x2a7a7a, 0x7a4a2a, 0x8a2a3a, 0x4a5a8a]), door.half, door.h, door.frame);
      return true;
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side), col = v.c[8], half = v.c[9], dh = v.c[10];
      { const [x, z] = P(f, v.a, v.n - 0.02); F.box(x, Y0 + dh / 2, z, 2 * half + 0.16, dh + 0.08, 0.04, f.h0, 0, v.c[11]); F.box(x, Y0 + dh / 2, z - 0, 2 * half, dh, 0.05, f.h0, 0, 0x1a1410); }
      // The couch: half in, swinging and tipping as they try every angle.
      const cyc = t % 14, tw = Math.sin(cyc / 14 * Math.PI * 2) * 0.35, tip = Math.max(0, Math.sin(cyc / 14 * Math.PI * 4)) * 0.55;
      const push = Math.sin(cyc / 14 * Math.PI * 2 + 1) * 0.15, outN = v.n - 0.75 + push, yaw = toBldg(f) + tw;
      const [cx, cz] = P(f, v.a, outN);
      F.box(cx, Y0 + 0.5 + tip * 0.3, cz, 2.0, 0.45, 0.85, yaw, tip, col);
      F.box(cx - Math.sin(yaw) * 0.35, Y0 + 0.85 + tip * 0.3, cz - Math.cos(yaw) * 0.35, 2.0, 0.4, 0.18, yaw, tip, col);
      F.box(cx, Y0 + 0.18, cz, 1.9, 0.25, 0.8, yaw, tip * 0.9, 0x3a2a1a);
      // The mover at the outer end, heaving.
      const ex = cx - Math.cos(yaw) * 1.15, ez = cz + Math.sin(yaw) * 1.15, heave = Math.sin(t * 2.2) * 0.1;
      F.person({ x: ex, z: ez, yaw, lean: 0.35 + heave, legs: [0.35, -0.25], arms: [1.0 + tip, 1.0 + tip], armOut: [0.25, 0.25], ...castAt(v, 0) });
      // The friend, directing.
      const [gx, gz] = P(f, v.a + 2.2, v.n - 1.9), wave = Math.sin(t * 3.3);
      F.person({ x: gx, z: gz, yaw: toBldg(f) + 0.5, arms: [1.6 + wave * 0.6, 1.4 - wave * 0.5], armOut: [0.6, 0.4 + wave * 0.3], fore: [2.2 + wave, 1.0 - wave * 0.6], turn: wave * 0.15, ...castAt(v, 1) });
      // Boxes, a lamp, a plant.
      const bx = (a: number, n: number, y: number, s: number, r2: number) => { const [x, z] = P(f, v.a + a, v.n + n); F.box(x, Y0 + y, z, s, s * 0.8, s * 0.9, f.h0 + r2, 0, 0xc89a5a); F.box(x, Y0 + y + s * 0.4, z, s * 0.9, 0.01, 0.06, f.h0 + r2, 0, 0x8a6a3a); };
      bx(-2.0, -0.55, 0.22, 0.55, 0.1); bx(-2.0, -0.55, 0.66, 0.45, -0.15); bx(-2.7, -0.7, 0.22, 0.55, 0.3);
      { const [x, z] = P(f, v.a - 3.3, v.n - 0.5); F.box(x, Y0 + 0.75, z, 0.04, 1.5, 0.04, 0, 0, 0x9aa0a6); F.box(x, Y0 + 1.55, z, 0.35, 0.25, 0.35, 0, 0, 0xf4e8c8);
        const [px, pz] = P(f, v.a - 1.6, v.n - 1.2); F.box(px, Y0 + 0.17, pz, 0.3, 0.34, 0.3, 0, 0, 0xb8603a); F.box(px, Y0 + 0.6, pz, 0.5, 0.6, 0.5, 0.6, 0, 0x2e7d4f); }
    },
    foot: (v) => [v.a - 3.6, v.a + 2.8, -2.3, 0],
  },

  // An open utility hatch in the pavement, coned off: a worker's head pops up, looks about,
  // ducks down again; steam drifts out; a mate stands by with a torch.
  hatch: {
    w: (d, c) => (city(d, "downtown", "commercial", "residential") && day(c, 8, 17) && c.w.storm < 0.5 ? 0.9 : 0), trigger: 0,
    place(v, c, r, V) {
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 3, -3, -0.9, r);
      if (a === null) return false;
      v.a = a; v.n = -1.95; cast(r, v.c); cast(r, v.c);
      return true;
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side);
      { const [x, z] = P(f, v.a, v.n); F.box(x, Y0 + 0.004, z, 1.0, 0.012, 0.75, f.h0, 0, 0x0a0a0a);
        const [lx, lz] = P(f, v.a + 0.62, v.n); F.box(lx, Y0 + 0.36, lz, 0.06, 0.75, 0.75, f.h0, 0.25, 0x5a5c5e); }
      for (const [ca, cn] of [[-1.1, -2.75], [1.1, -2.75], [-1.1, -1.1], [1.1, -1.1]] as const) {
        const [x, z] = P(f, v.a + ca, cn); F.box(x, Y0 + 0.02, z, 0.32, 0.04, 0.32, 0, 0, 0x1a1a1a); F.box(x, Y0 + 0.24, z, 0.2, 0.42, 0.2, 0, 0, CONE_ORANGE); F.box(x, Y0 + 0.3, z, 0.21, 0.07, 0.21, 0, 0, 0xffffff); F.box(x, Y0 + 0.49, z, 0.1, 0.1, 0.1, 0, 0, CONE_ORANGE);
      }
      { const [x, z] = P(f, v.a, -1.1); F.box(x, Y0 + 0.8, z, 1.8, 0.2, 0.05, f.h0, 0, 0xff5a1a); F.box(x, Y0 + 0.8, z, 0.6, 0.21, 0.055, f.h0, 0, 0xffffff); }
      // The head and shoulders in the hole (the rest is under the pavement).
      const cyc = t % 16, up = vEase(ramp(cyc, 1, 2)) * (1 - vEase(ramp(cyc, 11, 12))), [x, z] = P(f, v.a - 0.15, v.n);
      F.person({ x, z, yaw: toStreet(f) + Math.sin(cyc * 0.9) * 0.4 * up, y: Y0 - 1.7 + up * 0.68, arms: [0.6 * up, 1.4 * up], fore: [0.6 * up, 2.4 * up], turn: Math.sin(cyc * 1.3) * 0.8 * up, ...castAt(v, 0), shirt: HIVIS, hat: HARDHAT });
      const [mx, mz] = P(f, v.a + 1.6, -1.55);
      F.person({ x: mx, z: mz, yaw: toStreet(f) + 1.1, lean: 0.3, nod: 0.5, arms: [1.0, 0.1], ...castAt(v, 1), shirt: HIVIS, hat: 0xffffff });
      F.box(F.handL[0], F.handL[1], F.handL[2], 0.08, 0.08, 0.2, toStreet(f) + 1.1, 0, 0x2a2a2a);
      // Steam, rising and spreading.
      for (let i = 0; i < 6; i++) { const k = ((t * 0.3 + i / 6) % 1), [sx, sz] = P(f, v.a + Math.sin(i * 2.1 + t * 0.4) * 0.35 * k, v.n + 0.15 * Math.cos(i + t * 0.3)); const s = (0.18 + k * 0.22) * (1 - k * k); if (k < 0.9) F.box(sx, Y0 + 0.15 + k * 1.8, sz, s, s * 0.6, s, i + t * 0.2, 0, 0xdde2e8); }
    },
    foot: (v) => [v.a - 1.4, v.a + 2.0, -3, -0.85],
  },

  // A crossing guard at the corner before and after school: the children gather, she walks out
  // with her sign up when the light allows, they hurry across, she follows them back.
  guard: {
    w: (d, c) => (city(d, "residential", "commercial") && ((c.hour >= 7.4 && c.hour < 8.9) || (c.hour >= 14.6 && c.hour < 15.9)) ? 4 : 0), trigger: 0,
    place(v, c, r) {
      if (!sideOk(c, v.bx, v.bz, v.side)) return false;
      const fd = FRONT_NODE[v.side][2];
      if (!insideCity(v.bx + DIR_X[fd], v.bz + DIR_Z[fd])) return false;
      v.a = 50.6; v.n = -2.3; cast(r, v.c);
      v.st = [0, 0, 0]; v.pst = [0, 0, 0];   // [phase 0 gather, 1 crossing; phase start t, group number]
      return true;
    },
    step(v, c, V) {
      const S = v.st, ph = S[0], since = v.t - S[1];
      if (ph === 0) {
        const g = blockGoals(v.bx, v.bz, 0)[v.side], d = g.dir, nx = g.ix + DIR_X[d], nz = g.iz + DIR_Z[d];
        const green = signalState(nx, nz, (d % 2) as SignalAxis, c.simTime, c.plan.seed, c.prs) === "green" && signalGreenLeft(nx, nz, (d % 2) as SignalAxis, c.simTime, c.plan.seed, c.prs) > 8.5;
        const f = frameOf(v.bx, v.bz, v.side), [cx, cz] = P(f, 60, 1.7);
        const clear = c.truck.every((o) => Math.hypot(o.x - cx, o.z - cz) > o.r + 10);
        if (since > 12 && green && clear) { S[0] = 1; S[1] = v.t; }
      } else if (since > 14) {
        // Across: the children walk on along the next block (in the crosswalk's frame, as the crowd does).
        const fd = FRONT_NODE[v.side][2], g = S[2];
        for (let i = 0; i < guardKids(v, g); i++) {
          const cs = extra(v, g * 10 + i);
          V.adopt?.({ bx: v.bx + DIR_X[fd], bz: v.bz + DIR_Z[fd], side: v.side, a: 11 + i * 0.7, n: -0.75 - (i % 2) * 0.4, dir: 1, ...cs, s: 0.58 + (i % 3) * 0.04, speed: 1.3 });
        }
        S[0] = 0; S[1] = v.t; S[2] = g + 1;
      }
    },
    draw(v, F, t, D) {
      const f = frameOf(v.bx, v.bz, v.side), S = D.st, ph = S[0], since = t - S[1], g = S[2];
      const kids = guardKids(v, g), crossA = BLOCK + 9 - 0.85, mid = (51 + crossA) / 2;
      // The guard: at the kerb; out to the middle of the crosswalk, sign up; back.
      let ga: number, gn: number, up = 0, moving = false;
      if (ph === 0) { ga = 50.3; gn = -2.5; }
      else { const out = vEase(ramp(since, 0, 2.2)), back = vEase(ramp(since, 11.5, 14)); ga = lerp(50.3, mid, out * (1 - back)); gn = lerp(-2.5, 3.0, out * (1 - back)); up = ramp(since, 1.5, 2.2) * (1 - ramp(since, 11, 11.5)); moving = (since < 2.2) || (since > 11.5 && since < 14); }
      const [gx, gz] = P(f, ga, gn), w = walkSwing(t * 1.2);
      F.person({ x: gx, z: gz, yaw: up > 0.5 ? toStreet(f) : ph === 1 && since > 11.5 ? along(f, -1) : along(f), y: (gn > -0.1 ? 0.02 : Y0) + (moving ? w.bob : 0), legs: moving ? w.legs : [0, 0], arms: [moving ? w.arms[0] : 0.1, lerp(0.3, 2.9, up)], armOut: [0, 0.2], shirt: 0xd8f020, pants: 0x1f2a44, skin: v.c[2], hair: v.c[3], hat: 0xffffff });
      { const h = F.handR; F.seg(h[0], h[1] - 0.1, h[2], h[0], h[1] + 0.85, h[2], 0.04, 0xcccccc); F.box(h[0], h[1] + 1.05, h[2], 0.4, 0.4, 0.04, toStreet(f) + Math.PI / 2, 0, 0xd0202a); F.box(h[0], h[1] + 1.05, h[2], 0.42, 0.12, 0.03, toStreet(f) + Math.PI / 2, 0, 0xffffff); F.box(h[0], h[1] + 1.05, h[2], 0.3, 0.42, 0.045, toStreet(f) + Math.PI / 2, 0, 0xd0202a); }
      // The children: arriving along the pavement and waiting; then across in a line.
      for (let i = 0; i < kids; i++) {
        const cs = extra(v, g * 10 + i), s = 0.58 + (i % 3) * 0.04, waitA = 48.8 - i * 0.75, waitN = -1.2 - (i % 2) * 0.55;
        let a: number, n: number, mv = false, yaw = along(f);
        if (ph === 0) { const arr = ramp(since, i * 1.6, i * 1.6 + 8); a = lerp(waitA - 12, waitA, arr); n = waitN; mv = arr > 0 && arr < 1; if (arr <= 0) continue; }
        else { const go = Math.max(0, since - 2.4 - i * 0.55) * 1.8, path = (crossA - waitA); a = waitA + Math.min(go, path + 1.5); n = go < 2 ? lerp(waitN, 1.7, vEase(go / 2)) : go > path - 1 ? lerp(1.7, -0.9, ramp(go, path - 1, path + 1)) : 1.7; mv = go > 0 && go < path + 1.5; }
        const [x, z] = P(f, a, n), ww = walkSwing(t * 1.6 + i);
        F.person({ x, z, s, yaw, y: (a > 51.4 && a < crossA - 0.2 ? 0.02 : Y0) + (mv ? ww.bob : 0), legs: mv ? ww.legs : [0, 0], arms: mv ? ww.arms : [0.1, -0.1], turn: mv ? 0 : Math.sin(t * 0.8 + i) * 0.6, ...cs });
        F.box(x - Math.cos(yaw) * 0.16 * s, Y0 + 1.15 * s + (mv ? ww.bob : 0), z + Math.sin(yaw) * 0.16 * s, 0.14, 0.32 * s, 0.3 * s, yaw, 0, pick(mulberry32(v.seed + i + g * 7), [0xd0202a, 0x2e86c1, 0xf1c40f, 0x8e44ad, 0x27ae60]));   // backpack
      }
    },
    foot: (v) => [v.a - 6, v.a + 0.8, -2.0, -0.9],
  },

  // The morning coffee queue out of a café's door; each comes out again with a cup.
  coffee: {
    w: (d, c) => (city(d, "commercial", "downtown") && c.hour >= 6.5 && c.hour < 10 ? 3 : 0), trigger: 0,
    place(v, c, r, V) {
      const door = nearFacility(c, v, ["cafe"], V, r);
      if (!door) return false;
      v.a = door.a; v.n = door.n;
      v.c.push(4 + Math.floor(r() * 3), door.a < 30 ? 1 : -1, door.half, door.h);
      return true;
    },
    step(v, c, V) {
      const k = Math.floor(v.t / 9);
      if (k > 0 && !(v.st[1] >= k)) { v.st[1] = k; const s = (-v.c[1]) as 1 | -1; V.adopt?.({ bx: v.bx, bz: v.bz, side: v.side, a: v.a + s * 1.5, n: -0.7, dir: s, ...extra(v, 1000 + k), cup: true }); }
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side), L = v.c[0], s = v.c[1], half = v.c[2], dh = v.c[3];
      { const [x, z] = P(f, v.a, v.n - 0.02); F.box(x, Y0 + dh / 2, z, 2 * half, dh, 0.05, f.h0, 0, 0x2a1e14); }
      { const [x, z] = P(f, v.a - s * 2.6, -2.3); F.box(x, Y0 + 0.4, z, 0.06, 0.8, 0.55, f.h0, 0.18, 0x3a2a1e); F.box(x - 0.001, Y0 + 0.4, z, 0.065, 0.6, 0.45, f.h0, 0.18, 0x1a1a1a); for (const dy of [0.12, 0, -0.12]) F.box(x, Y0 + 0.4 + dy, z, 0.07, 0.04, 0.32, f.h0, 0.18, 0xf4f0d8); }
      // The queue: the front at the door, the rest along the building line; every 9 s the front
      // goes in, the one inside comes out with a cup, the rest step up.
      const k = Math.floor(t / 9), ph = t - k * 9, sh = vEase(ramp(ph, 0.3, 2.0));
      const slotA = (i: number) => v.a + s * (0.9 + i * 0.75), n0 = -0.55;
      for (let j = 0; j <= L; j++) {
        const id = k + j, cs = extra(v, id);
        if (j === 0) {   // going in
          const k2 = vEase(ramp(ph, 0, 1.5)), [x, z] = P(f, lerp(slotA(0), v.a, k2), lerp(n0, v.n + 0.6, k2 * k2));
          if (k2 < 0.98) F.person({ x, z, yaw: lerp(along(f, -s), toBldg(f), k2), ...vWalkPose(ph), ...cs });
          continue;
        }
        if (j === L) { const arr = ramp(ph, 0, 8), a = lerp(slotA(L - 1) + s * 12, slotA(L - 1), arr); walker(F, f, a, n0, along(f, -s), ph * 1.2, cs, arr < 1); continue; }
        const a = lerp(slotA(j), slotA(j - 1), sh);
        walker(F, f, a, n0, along(f, -s), t * 1.2 + j, cs, sh > 0 && sh < 1, sh >= 1 || sh <= 0 ? { turn: Math.sin(t * 0.4 + id) * 0.5, nod: j % 2 ? 0.4 : 0, arms: [0.05, j % 2 ? 0.9 : -0.05], fore: j % 2 ? [0.05, 1.9] : null } : {});
      }
      // The one coming out, cup in hand.
      { const k2 = vEase(ramp(ph, 0.5, 2.2)), cs = extra(v, 1000 + k + 1), [x, z] = P(f, lerp(v.a, v.a - s * 1.5, k2), lerp(v.n + 0.6, -0.7, k2));
        if (k > 0 && k2 > 0.02 && k2 < 0.999) { F.person({ x, z, yaw: lerp(toStreet(f), along(f, -s), k2), ...vWalkPose(ph * 1.2), arms: [0, 0.4], fore: [0, 1.6], ...cs }); const h = F.handR; F.box(h[0], h[1] + 0.06, h[2], 0.07, 0.12, 0.07, 0, 0, 0xf4f0e8); F.box(h[0], h[1] + 0.13, h[2], 0.075, 0.02, 0.075, 0, 0, 0x3a2a1e); } }
    },
    foot: (v) => [Math.min(v.a, v.a + v.c[1] * (1.4 + v.c[0] * 0.75)), Math.max(v.a, v.a + v.c[1] * (1.4 + v.c[0] * 0.75)), -1.0, 0],
  },

  // After dark: a couple under a streetlight, hands held, swaying; now and then a kiss.
  couple: {
    w: (d, c) => (city(d, "residential", "commercial", "park", "downtown") && night(c.hour) && c.w.rain < 0.5 ? 1.6 : 0), trigger: 0,
    place(v, c, r, V) {
      const l = furniture(c, v.bx, v.bz, v.side, PK.lamp, V, 2);
      if (!l.length) return false;
      [v.a] = pick(r, l); v.n = -1.65; cast(r, v.c); cast(r, v.c);
      return true;
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side), sway = Math.sin(t * 0.8) * 0.06, kiss = vEase(ramp(t % 14, 9, 10)) * (1 - vEase(ramp(t % 14, 12, 13)));
      for (let i = 0; i < 2; i++) {
        const k = i ? 1 : -1, [x, z] = P(f, v.a + k * (0.3 - kiss * 0.08), v.n + sway);
        F.person({ x, z, yaw: along(f, -k), lean: kiss * 0.22, arms: [0.55, 0.3], armOut: [-0.25, 0.1], s: i ? 0.95 : 1, nod: kiss * -0.15, ...castAt(v, i) });
      }
    },
    foot: (v) => [v.a - 0.8, v.a + 0.8, -2.0, -1.3],
  },

  // After dark: a falafel cart with its own bulb, steam off the grill, a customer or two waiting.
  falafel: {
    w: (d, c) => (city(d, "commercial", "downtown") && (c.hour >= 19 || c.hour < 2) && c.w.storm < 0.5 ? 1.5 : 0), trigger: 0,
    place(v, c, r, V) {
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 3, -3, -1.6, r);
      if (a === null) return false;
      v.a = a; v.n = -2.35; cast(r, v.c); cast(r, v.c); cast(r, v.c);
      return true;
    },
    draw(v, F, t, D) {
      const f = frameOf(v.bx, v.bz, v.side), [x, z] = P(f, v.a, v.n);
      F.box(x, Y0 + 0.6, z, 1.7, 0.9, 1.0, f.h0, 0, 0xc8ccd0); F.box(x, Y0 + 1.06, z, 1.72, 0.04, 1.02, f.h0, 0, 0x2a7a3a);
      for (const k of [-0.65, 0.65]) { const [wx, wz] = P(f, v.a + k, v.n - 0.52); F.box(wx, Y0 + 0.2, wz, 0.38, 0.38, 0.06, f.h0, 0, 0x2a2a2a); }
      for (const k of [-0.8, 0.8]) { const [px, pz] = P(f, v.a + k, v.n); F.box(px, Y0 + 1.55, pz, 0.04, 0.95, 0.04, 0, 0, 0x8a8f94); }
      F.box(x, Y0 + 2.05, z, 2.0, 0.06, 1.3, f.h0, 0, 0xf2c200); F.box(x, Y0 + 2.06, z, 2.0, 0.05, 0.4, f.h0, 0, 0xc0392b);
      const [mx, mz] = P(f, v.a, v.n + 0.52); F.box(mx, Y0 + 1.6, mz, 1.3, 0.5, 0.03, f.h0, 0, 0x1a1a1a);
      F.glow(mx, Y0 + 1.6, mz + 0, 1.2, 0.4, 0.035, f.h0, D.night ? 0xfff0b0 : 0xe8d8a0);
      const [bx, bz] = P(f, v.a, v.n); F.glow(bx, Y0 + 1.92, bz, 0.13, 0.16, 0.13, 0, D.night ? 0xffe8a0 : 0xcac0a0);
      for (let i = 0; i < 4; i++) { const k = ((t * 0.5 + i / 4) % 1), [sx, sz] = P(f, v.a - 0.3 + Math.sin(i * 1.7) * 0.2, v.n); F.box(sx, Y0 + 1.15 + k * 0.8, sz, 0.15 + k * 0.25, 0.1 + k * 0.15, 0.15 + k * 0.25, i, 0, 0xd8dce0); }
      const [vx, vz] = P(f, v.a - 0.2, v.n - 0.85), flip = Math.max(0, Math.sin(t * 2.5));
      F.person({ x: vx, z: vz, y: 0.02, yaw: toBldg(f), arms: [0.9 + flip * 0.5, 0.6], fore: [1.3 + flip * 0.6, 1.2], ...castAt(v, 0), hat: 0xffffff });
      for (let i = 0; i < 2; i++) {
        const [cx, cz] = P(f, v.a + (i ? 0.9 : -0.5), -1.2 - i * 0.2), eat = i === 0 && (t % 10) > 5;
        F.person({ x: cx, z: cz, yaw: toStreet(f) + (i ? -0.4 : 0.2), arms: [0.1, eat ? 1.1 : 0.05], fore: eat ? [0.1, 2.5] : null, turn: Math.sin(t * 0.5 + i) * 0.4, ...castAt(v, 1 + i) });
        if (eat) { const h = F.handR; F.box(h[0], h[1] + 0.05, h[2], 0.07, 0.18, 0.07, 0, 0, 0xe8d8b0); }
      }
    },
    foot: (v) => [v.a - 1.4, v.a + 1.4, -3, -1.0],
  },

  // After dark: a club's door under a velvet rope; the bouncer, arms folded, lets them in one
  // by one; the door glows.
  bouncer: {
    w: (d, c) => (city(d, "commercial", "downtown") && (c.hour >= 20.5 || c.hour < 3) ? 3 : 0), trigger: 0,
    place(v, c, r, V) {
      const door = nearFacility(c, v, ["bar", "theater", "restaurant", "musicStore"], V, r);
      if (!door) return false;
      v.a = door.a; v.n = door.n; cast(r, v.c);
      v.c.push(3 + Math.floor(r() * 3), door.a < 30 ? 1 : -1, door.half, door.h, pick(r, [0xff3a8c, 0x7a3aff, 0x3af2ff]));
      return true;
    },
    draw(v, F, t, D) {
      const f = frameOf(v.bx, v.bz, v.side), L = v.c[4], s = v.c[5], half = v.c[6], dh = v.c[7];
      const [dx, dz] = P(f, v.a, v.n - 0.03);
      F.box(dx, Y0 + dh / 2, dz, 2 * half + 0.1, dh + 0.06, 0.04, f.h0, 0, 0x111111);
      F.glow(dx, Y0 + dh / 2, dz, 2 * half - 0.1, dh - 0.1, 0.045, f.h0, D.night ? v.c[8] : 0x553044);
      // Stanchions and the rope, unhooked at the door end while someone goes in.
      const k = Math.floor(t / 15), ph = t - k * 15, open = ramp(ph, 1, 1.5) * (1 - ramp(ph, 4, 4.5));
      const posts = [0.8, 2.6, 4.4].map((u) => P(f, v.a + s * u, -1.25));
      for (const [px, pz] of posts) { F.box(px, Y0 + 0.45, pz, 0.05, 0.9, 0.05, 0, 0, 0xd4af37); F.box(px, Y0 + 0.93, pz, 0.1, 0.1, 0.1, 0, 0, 0xd4af37); F.box(px, Y0 + 0.02, pz, 0.28, 0.04, 0.28, 0, 0, 0xd4af37); }
      for (let i = 0; i < 2; i++) {
        const [ax, az] = posts[i], [bx, bz] = posts[i + 1];
        if (i === 0 && open > 0.5) { F.seg(bx, Y0 + 0.85, bz, bx - (bx - ax) * 0.2, Y0 + 0.2, bz - (bz - az) * 0.2, 0.05, 0xa01020); continue; }
        const mx = (ax + bx) / 2, mz = (az + bz) / 2; F.seg(ax, Y0 + 0.85, az, mx, Y0 + 0.62, mz, 0.05, 0xa01020); F.seg(mx, Y0 + 0.62, mz, bx, Y0 + 0.85, bz, 0.05, 0xa01020);
      }
      // The bouncer: big, black, arms folded; turns to look the next one over.
      const [bx, bz] = P(f, v.a - s * 0.95, v.n - 0.55), look = Math.sin(ph / 15 * Math.PI * 2) * 0.6;
      F.person({ x: bx, z: bz, yaw: toStreet(f) + s * 0.3, bulk: 1.45, arms: [0.55, 0.55], fore: [1.55, 1.55], foreOut: [-1.25, -1.25], turn: look * -s, shirt: 0x151515, pants: 0x151515, skin: v.c[2], hair: 0x111111 });
      // The queue behind the rope: the front one goes in; the others step up; one more arrives.
      const sh = vEase(ramp(ph, 5, 7)), slotA = (i: number) => v.a + s * (0.9 + i * 0.75);
      for (let j = 0; j <= L; j++) {
        const id = k + j, cs = extra(v, id), dress = { ...cs, shirt: [0x151515, 0x8e1a4a, 0xd4af37, 0x1a3a8a, 0xffffff][id % 5] };
        if (j === 0) {
          const go = vEase(ramp(ph, 1.5, 4.0)), [x, z] = P(f, lerp(slotA(0), v.a, go), lerp(-1.75, v.n + 0.6, go * go));
          if (go < 0.98) F.person({ x, z, yaw: lerp(along(f, -s), toBldg(f), go), ...vWalkPose(ph), ...dress });
          continue;
        }
        if (j === L) { const arr = ramp(ph, 3, 12), a = lerp(slotA(L - 1) + s * 12, slotA(L - 1), arr); walker(F, f, a, -1.75, along(f, -s), ph * 1.2, dress, arr > 0 && arr < 1); continue; }
        const a = lerp(slotA(j), slotA(j - 1), sh);
        walker(F, f, a, -1.75, along(f, -s), t * 1.2 + j, dress, sh > 0 && sh < 1, sh <= 0 || sh >= 1 ? { turn: Math.sin(t * 0.6 + id) * 0.7, arms: [0.2, j % 2 ? 1.0 : 0.1], fore: j % 2 ? [0.2, 2.2] : null } : {});
      }
    },
    foot: (v) => [Math.min(v.a - v.c[5] * 1.3, v.a + v.c[5] * (1.2 + v.c[4] * 0.75)), Math.max(v.a - v.c[5] * 1.3, v.a + v.c[5] * (1.2 + v.c[4] * 0.75)), -2.1, 0],
  },

  // Snow: a parent pulling a child on a sled round the block, the child's arms up.
  sled: {
    w: (d, c) => (city(d, "residential", "park") && c.snow && day(c, 8, 18) ? 2 : 0), trigger: 0,
    place(v, c, r) {
      if (!sideOk(c, v.bx, v.bz, v.side)) return false;
      v.a = 14 + r() * 20; v.n = -1.1; cast(r, v.c); cast(r, v.c);
      v.c[4] = pick(r, [0xd0202a, 0x2e86c1, 0xff7a1a, 0x8e44ad]);
      v.st = [0, v.a]; v.pst = [0, v.a];
      return true;
    },
    step(v) {
      v.st[1] += 1.05 * SIM_DT;
      if (v.st[1] > 51 - v.n) { v.side = V_NEXT_SIDE[v.side]; v.st[1] = 9 + v.n + (v.st[1] - (51 - v.n)); v.pst = v.st.slice(); }
    },
    draw(v, F, t, D) {
      const f = frameOf(v.bx, v.bz, v.side), a = D.st[1], [x, z] = P(f, a, v.n), w = walkSwing(t * 1.05), yaw = along(f);
      F.person({ x, z, yaw, y: Y0 + w.bob, legs: w.legs, lean: 0.25, arms: [w.arms[0], -0.7], turn: Math.sin(t * 0.4) > 0.8 ? 2.4 : 0, ...castAt(v, 0), hat: 0x2a2a2a, coat: castAt(v, 0).shirt });
      const hand = [...F.handR] as V3;
      const sa = a - 2.0, [sx, sz] = pathPt(v, sa, v.n), syaw = sidePathYaw(v, sa), fx = Math.cos(syaw), fz = -Math.sin(syaw);
      F.box(sx, Y0 + 0.13, sz, 1.0, 0.06, 0.45, syaw, 0, v.c[4]);
      for (const k of [-0.2, 0.2]) F.box(sx - Math.sin(syaw) * -k, Y0 + 0.05, sz - Math.cos(syaw) * -k, 1.05, 0.04, 0.04, syaw, 0, 0x5a5c5e);
      F.seg(hand[0], hand[1], hand[2], sx + fx * 0.5, Y0 + 0.15, sz + fz * 0.5, 0.02, 0x8a6a3a);
      const cheer = Math.sin(t * 2.4);
      F.person({ x: sx - fx * 0.15, z: sz - fz * 0.15, yaw: syaw, s: 0.6, ...sitting(0.1), arms: [2.6 + cheer * 0.3, 2.6 - cheer * 0.3], armOut: [0.4, 0.4], ...castAt(v, 1), y: Y0 + 0.06, hat: v.c[4], coat: v.c[4] });
    },
  },

  // Snow: shovelling the front walk, scoop by scoop, the pile growing; then a rest on the shovel.
  shovel: {
    w: (d, c) => (d === "residential" && c.snow && day(c, 7, 17) ? 2 : 0), trigger: 0,
    place(v, c, r, V) {
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 9, -2.0, -0.2, r);
      if (a === null) return false;
      v.a = a - 4.5; v.n = -1.1; cast(r, v.c);
      return true;
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side), prog = Math.min(9, t / 7), stroke = (t % 2.6) / 2.6, done = prog >= 9;
      // Cleared path behind, snow still ahead, the pile along the kerb side.
      if (prog > 0.05) { const [x, z] = P(f, v.a + prog / 2, -1.1); F.box(x, Y0 + 0.012, z, prog, 0.012, 1.6, f.h0, 0, 0x8f918f); }
      if (!done) { const [x, z] = P(f, v.a + (prog + 9) / 2, -1.1); F.box(x, Y0 + 0.04, z, 9 - prog, 0.07, 1.6, f.h0, 0, 0xe4eaf2); }
      for (let i = 0; i < Math.floor(prog * 1.5); i++) { const [x, z] = P(f, v.a + i / 1.5 + 0.3, -2.25 + (i % 2) * 0.12); F.box(x, Y0 + 0.12, z, 0.55, 0.24 + (i % 3) * 0.06, 0.45, f.h0 + i, 0, 0xeef2f8); }
      const [x, z] = P(f, v.a + prog + 0.3, -1.0);
      if (done) { F.person({ x, z, yaw: toStreet(f), arms: [0.7, 0.7], fore: [1.3, 1.3], lean: 0.1, ...castAt(v, 0), hat: 0xc0392b, coat: castAt(v, 0).shirt }); const h = F.handL; F.seg(h[0], h[1], h[2], h[0], Y0, h[2], 0.04, 0x8a6a3a); return; }
      const push = stroke < 0.55, lift = !push ? Math.sin((stroke - 0.55) / 0.45 * Math.PI) : 0;
      const yaw = along(f) + (push ? 0 : -lift * 1.3);
      F.person({ x, z, yaw, lean: push ? 0.55 : 0.3 - lift * 0.2, legs: [0.35, -0.3], arms: [push ? 0.6 : 0.6 + lift * 0.9, push ? 0.9 : 0.9 + lift * 0.9], ...castAt(v, 0), hat: 0xc0392b, coat: castAt(v, 0).shirt });
      const hl = F.handL, hr = F.handR, fx = Math.cos(yaw), fz = -Math.sin(yaw);
      const bladeX = hr[0] + fx * 0.6, bladeZ = hr[2] + fz * 0.6, bladeY = push ? Y0 + 0.05 : hr[1] + 0.1;
      F.seg(hl[0], hl[1], hl[2], bladeX, bladeY + 0.1, bladeZ, 0.04, 0x8a6a3a);
      F.box(bladeX, bladeY, bladeZ, 0.3, 0.05, 0.45, yaw, 0.3, 0x2a2a2a);
      if (!push) { const k = (stroke - 0.55) / 0.45, [sx, sz] = P(f, v.a + prog + 0.6, lerp(-1.0, -2.3, k)); F.box(sx, Y0 + 0.9 * Math.sin(k * Math.PI) + 0.2, sz, 0.25, 0.18, 0.25, k * 3, 0, 0xeef2f8); }
      else F.box(bladeX, bladeY + 0.08, bladeZ, 0.26, 0.12, 0.36, yaw, 0, 0xeef2f8);
    },
    foot: (v) => [v.a - 0.5, v.a + 9.5, -2.0, -0.2],
  },

  // Snow: a snowman on the verge, a child putting its hat on.
  snowman: {
    w: (d, c) => (city(d, "residential", "park") && c.snow ? 1.8 : 0), trigger: 40,
    place(v, c, r, V) {
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 1.6, -2.9, -1.7, r);
      if (a === null) return false;
      v.a = a; v.n = -2.3; cast(r, v.c);
      v.c.push(pick(r, [0xd0202a, 0x27ae60, 0x2e86c1, 0xf1c40f]));
      return true;
    },
    step(v, c, V) { if (v.t > 14) release(v, 0, V, { a: v.a + 1 + (v.t - 8) * 1.1, n: -0.8, dir: 1, ...castAt(v, 0), s: 0.62 }); },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side), [x, z] = P(f, v.a, v.n), yaw = toStreet(f), fx = Math.cos(yaw), fz = -Math.sin(yaw);
      for (const [y, s] of [[0.32, 0.66], [0.85, 0.48], [1.24, 0.34]] as const) { F.box(x, Y0 + y, z, s, s * 0.95, s, yaw, 0, 0xf2f5fa); F.box(x, Y0 + y, z, s * 0.85, s * 0.8, s * 0.85, yaw + Math.PI / 4, 0, 0xeef2f8); }
      for (const k of [-0.07, 0.07]) F.box(x + fx * 0.17 + Math.sin(yaw) * k, Y0 + 1.29, z + fz * 0.17 + Math.cos(yaw) * k, 0.04, 0.04, 0.04, yaw, 0, 0x111111);
      F.seg(x + fx * 0.17, Y0 + 1.22, z + fz * 0.17, x + fx * 0.4, Y0 + 1.2, z + fz * 0.4, 0.05, 0xff7a1a);
      for (const k of [-1, 1]) F.seg(x + Math.sin(yaw) * k * 0.22, Y0 + 0.9, z + Math.cos(yaw) * k * 0.22, x + Math.sin(yaw) * k * 0.62, Y0 + 1.18, z + Math.cos(yaw) * k * 0.62, 0.03, 0x5a3a1a);
      F.box(x, Y0 + 1.06, z, 0.4, 0.07, 0.4, yaw, 0, v.c[4]); F.box(x + fx * 0.12 + Math.sin(yaw) * 0.12, Y0 + 0.95, z + fz * 0.12 + Math.cos(yaw) * 0.12, 0.06, 0.25, 0.08, yaw, 0, v.c[4]);
      // The hat: in the child's hands, up, on.
      const put = vEase(ramp(t, 2, 4)), on = t >= 4;
      if (!(v.rel & 1)) {
        const leave = ramp(t, 8, 9), [kx, kz] = P(f, v.a + 0.1 + leave * 1.2 + Math.max(0, t - 9) * 1.1, lerp(-1.45, -0.8, leave)), moving = t > 8, w = walkSwing(t * 1.1);
        F.person({ x: kx, z: kz, s: 0.62, yaw: moving ? along(f) : toStreet(f) + Math.PI, y: Y0 + (moving ? w.bob : 0), legs: moving ? w.legs : [0, 0], arms: moving ? w.arms : on ? [0.2 + Math.max(0, Math.sin(t * 6)) * 2.2 * ramp(t, 4, 5) * (1 - ramp(t, 7, 8)), 0.2] : [lerp(1.2, 2.8, put), lerp(1.2, 2.8, put)], ...castAt(v, 0), hat: v.c[4] });
        if (!on) { const h = F.handL; F.box((h[0] + F.handR[0]) / 2, h[1] + 0.12, (h[2] + F.handR[2]) / 2, 0.24, 0.2, 0.24, 0, 0, 0x111111); }
      }
      if (on) { F.box(x, Y0 + 1.5, z, 0.3, 0.04, 0.3, yaw, 0, 0x111111); F.box(x, Y0 + 1.6, z, 0.2, 0.2, 0.2, yaw, 0, 0x111111); }
    },
    foot: (v) => [v.a - 0.6, v.a + 0.6, -2.8, -1.8],
  },

  // A hot afternoon: an open hydrant fanning water into the street, children running through it.
  hydrant: {
    w: (d, c) => (city(d, "residential", "commercial") && c.season === "summer" && !wet(c) && c.w.cloud < 0.7 && c.hour >= 11 && c.hour < 19 ? 3 : 0), trigger: 0,
    place(v, c, r, V) {
      const h = furniture(c, v.bx, v.bz, v.side, PK.hydrant, V, 4.5);
      if (!h.length) return false;
      [v.a, v.n] = pick(r, h);
      for (let i = 0; i < 4; i++) cast(r, v.c);
      return true;
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side);
      { const [x, z] = P(f, v.a, -4.6); F.box(x, 0.012, z, 3.2, 0.01, 2.6, f.h0, 0, 0x3a4a58); const [px, pz] = P(f, v.a + 0.4, -2.9); F.box(px, Y0 + 0.003, pz, 2.0, 0.006, 0.6, f.h0, 0, 0x6a7a88); }
      // The jet: three streams arcing out over the gutter, spray off their ends.
      const arc = (j: number, k: number): V3 => { const sp = (j - 1) * 0.3 + Math.sin(t * 2 + j) * 0.04, [x, z] = P(f, v.a + sp * k * 2.6, v.n - 0.15 - k * 3.2); return [x, Y0 + 0.45 + k * 1.9 - k * k * 2.25, z]; };
      for (let j = 0; j < 3; j++) for (let i = 0; i < 8; i++) { const a = arc(j, i / 8), b = arc(j, (i + 1) / 8); F.seg(a[0], a[1], a[2], b[0], b[1], b[2], 0.09 - i * 0.006, i < 4 ? 0xeaf6ff : 0xc8e0f4); }
      for (let i = 0; i < 14; i++) { const k = (t * 1.6 + i / 14) % 1, j = i % 3, e = arc(j, 1), x = e[0] + Math.sin(i * 3.1) * k * 0.6, z = e[2] + Math.cos(i * 1.7) * k * 0.6; F.box(x, Math.max(0.02, e[1] + k * 0.5 - k * k * 0.9), z, 0.05, 0.05, 0.05, 0, 0, 0xdcecfa); }
      // Children running a loop through the spray (in it on the kerb side), shrieking.
      for (let i = 0; i < 3; i++) {
        const p = ((t * 0.13 + i / 3) % 1), lap = p * Math.PI * 2, ca = v.a + Math.cos(lap) * 3.4, cn = -2.2 + Math.sin(lap) * 0.65;
        const [x, z] = P(f, ca, cn), yaw = along(f) + Math.atan2(Math.cos(lap) * 0.65, -Math.sin(lap) * 3.4) * -1 + Math.PI / 2 * 0;
        const inSpray = Math.abs(ca - v.a) < 0.9, w = walkSwing(t * 2.6 + i, true);
        const dirYaw = Math.atan2(-(Math.cos(lap) * 0.65), -Math.sin(lap) * 3.4) + f.h0;
        void yaw;
        F.person({ x, z, s: 0.6, yaw: dirYaw, y: Y0 + w.bob, legs: w.legs, arms: inSpray ? [2.8, 2.6] : w.arms, armOut: inSpray ? [0.4, 0.4] : [0, 0], lean: 0.12, ...castAt(v, i), shirt: [0xff5722, 0x00bcd4, 0xcddc39][i] });
      }
    },
    foot: (v) => [v.a - 4.2, v.a + 4.2, -3, -1.4],
  },

  // In a park: two old friends at a chess table, one move at a time; someone watching.
  chess: {
    w: (d, c) => (d === "park" && !wet(c) && !c.snow && day(c, 9, 19) ? 1.3 : 0), trigger: 0,
    place(v, c, r, V) {
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 3.4, 1.2, 4.6, r, 12, 27) ?? freeSpot(V, c, v.bx, v.bz, v.side, 3.4, 1.2, 4.6, r, 33, 48);
      if (a === null) return false;
      v.a = a; v.n = 2.9;
      v.c.push(pick(r, [0x7a5a6a, 0x5a6a7a, 0x8a6a4a]), pick(r, PANTS), pick(r, SKINS), pick(r, OLD_HAIR));
      v.c.push(pick(r, [0x4a5a4a, 0x8a3a2a, 0x2c3e50]), pick(r, PANTS), pick(r, SKINS), pick(r, OLD_HAIR));
      cast(r, v.c);
      return true;
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side), [x, z] = P(f, v.a, v.n);
      F.box(x, Y0 + 0.37, z, 0.12, 0.74, 0.12, 0, 0, 0x6a6e72); F.box(x, Y0 + 0.76, z, 0.9, 0.05, 0.9, f.h0, 0, 0xb8b0a0);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const [cx, cz] = P(f, v.a - 0.24 + i * 0.16, v.n - 0.24 + j * 0.16); F.box(cx, Y0 + 0.79, cz, 0.16, 0.012, 0.16, f.h0, 0, (i + j) % 2 ? 0x2a2a2a : 0xe8e0d0); }
      const move = Math.floor(t / 9), mt = (t % 9) / 9, who = move % 2;
      for (let p = 0; p < 6; p++) {
        const side = p < 3 ? 0 : 1, i = p % 3, moved = (move + p) % 6 === 0 && mt > 0.55;
        const pa = v.a + (side ? 0.16 : -0.16) * (i === 1 ? 1 : 2) * (moved ? 0.5 : 1), pn = v.n - 0.16 + i * 0.16 + (moved ? 0.08 : 0);
        const [px, pz] = P(f, pa, pn); F.box(px, Y0 + 0.83, pz, 0.05, 0.08 + (i === 1 ? 0.04 : 0), 0.05, 0, 0, side ? 0x151515 : 0xf8f4ea);
      }
      for (let i = 0; i < 2; i++) {
        const k = i ? 1 : -1, [px, pz] = P(f, v.a + k * 0.75, v.n), reach = who === i ? Math.sin(ramp(mt, 0.35, 0.75) * Math.PI) : 0;
        const [sx, sz] = P(f, v.a + k * 0.78, v.n); F.box(sx, Y0 + 0.22, sz, 0.36, 0.44, 0.36, 0, 0, 0x6a6e72);
        F.person({ x: px, z: pz, yaw: along(f, -k), ...sitting(0.44), lean: 0.3 + reach * 0.15, arms: [0.9, 0.9 + reach * 0.5], fore: [1.6, 1.6 - reach * 0.3], foreOut: [-0.4, 0], nod: 0.5, turn: who !== i ? Math.sin(t * 0.3) * 0.2 : 0, ...castAt(v, i), hat: i ? 0x3a3a3a : undefined });
      }
      const [ox, oz] = P(f, v.a + 0.2, v.n - 1.1);
      F.person({ x: ox, z: oz, yaw: toBldg(f), lean: 0.22, arms: [-0.35, -0.35], fore: [-0.2, -0.2], foreOut: [0.6, 0.6], nod: 0.55, turn: Math.sin(t * 0.2) * 0.3, ...castAt(v, 2) });
    },
  },

  // A morning tai chi class on the grass, slow and in step, the teacher leading.
  taichi: {
    w: (d, c) => (d === "park" && !wet(c) && !c.snow && c.hour >= 6 && c.hour < 10 ? 3 : 0), trigger: 0,
    place(v, c, r, V) {
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 7, 1.5, 9, r, 10, 27) ?? freeSpot(V, c, v.bx, v.bz, v.side, 7, 1.5, 9, r, 33, 50);
      if (a === null) return false;
      v.a = a; v.n = 2.4;
      for (let i = 0; i < 7; i++) v.c.push(pick(r, [0xf4f4f0, 0xe8e0d0, 0xc0392b, 0xf4f4f0, 0x2c3e50]), pick(r, [0x2a2a2a, 0xf4f4f0, 0x4a4a4a]), pick(r, SKINS), pick(r, [...HAIRS, ...OLD_HAIR]));
      return true;
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side);
      const pose = (tt: number): Partial<Body> => {
        const c = (tt % 14) / 14 * Math.PI * 2, rise = (1 - Math.cos(c)) / 2, sweep = Math.sin(c), shift = Math.sin(c + 0.8);
        return { hip: 0.78 - rise * 0.06, legs: [0.15, 0.15], shins: [-0.1, -0.1], legOut: [0.28, 0.28], arms: [0.3 + rise * 1.1 + sweep * 0.2, 0.3 + rise * 1.1 - sweep * 0.2], fore: [0.3 + rise * 1.3, 0.3 + rise * 1.3], foreOut: [sweep * 0.5, -sweep * 0.5], armOut: [0.15 + Math.max(0, sweep) * 0.5, 0.15 + Math.max(0, -sweep) * 0.5], tilt: shift * 0.08, turn: sweep * 0.3 };
      };
      { const [x, z] = P(f, v.a, v.n); F.person({ x, z, yaw: toBldg(f), ...pose(t + 0.4), ...castAt(v, 0), shirt: 0xf4f4f0, pants: 0x1a1a1a }); }
      for (let i = 1; i < 7; i++) {
        const row = i < 4 ? 0 : 1, col = row ? i - 4 : i - 1, [x, z] = P(f, v.a + (col - (row ? 1 : 1)) * 2.0 + row * 1.0, v.n + 2.6 + row * 2.2);
        F.person({ x, z, yaw: toStreet(f), ...pose(t - (i % 3) * 0.15), ...castAt(v, i) });
      }
    },
  },

  // A frisbee thrown across the park, the dog flying after it and catching it in the air.
  frisbee: {
    w: (d, c) => (d === "park" && !wet(c) && !c.snow && day(c, 9, 19) && c.w.storm < 0.5 ? 1.5 : 0), trigger: 0,
    place(v, c, r, V) {
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 14, 2.0, 6.0, r, 12, 30) ?? freeSpot(V, c, v.bx, v.bz, v.side, 14, 2.0, 6.0, r, 30, 48);
      if (a === null) return false;
      v.a = a; v.n = 3.6; cast(r, v.c);
      v.c.push(pick(r, [0x222222, 0xc8a060, 0x8a5a3a, 0xeeeeee]), pick(r, [0xff3a3a, 0xf2c200, 0x3af2ff, 0x7dff5a]));
      return true;
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side), c = t % 9, thrower = v.a - 6, catchA = v.a + 5.5, S = 1.35;
      // The thrower: a wind-up and a flick; later stooping for the disc.
      const wind = ramp(c, 0, 0.45), flick = ramp(c, 0.45, 0.65), stoop = Math.sin(ramp(c, 6.2, 7.4) * Math.PI);
      const [tx, tz] = P(f, thrower, v.n);
      F.person({ x: tx, z: tz, yaw: along(f), lean: stoop * 0.7 + (flick - wind) * 0.1, hip: 0.86 - stoop * 0.2, arms: [0.2, lerp(lerp(0.4, 1.0, wind), 1.6, flick) + stoop * 0.6], armOut: [0, lerp(lerp(0.2, -1.0, wind), 0.9, flick)], ...castAt(v, 0) });
      const hand = F.handR;
      // The disc: in the hand, then in flight, then in the dog's mouth.
      const fl = ramp(c, 0.6, 2.25);
      // The dog: off with the throw, up for the catch, back with it, drops it.
      let da: number, jump = 0, pitch = 0, dyaw = along(f), gait = 0.9, ph = t * 4;
      if (c < 0.6) { da = thrower + 1.0; gait = 0; ph = 0; }
      else if (c < 2.25) { da = lerp(thrower + 1.0, catchA - 0.3, ramp(c, 0.6, 2.25)); jump = Math.sin(ramp(c, 1.85, 2.6) * Math.PI) * 0.9; pitch = jump * 0.5; }
      else if (c < 2.6) { da = catchA - 0.3 + (c - 2.25) * 2; jump = Math.sin(ramp(c, 1.85, 2.6) * Math.PI) * 0.9; pitch = jump * 0.4; }
      else if (c < 3.2) { da = catchA + 0.4; dyaw = along(f) + Math.PI * ramp(c, 2.6, 3.2); gait = 0.5; }
      else if (c < 6.0) { da = lerp(catchA + 0.4, thrower + 0.9, ramp(c, 3.2, 6.0)); dyaw = along(f, -1); gait = 0.7; ph = t * 3; }
      else { da = thrower + 0.9; dyaw = along(f, -1); gait = 0; ph = 0; }
      const [dx, dz] = P(f, da, v.n + 0.4);
      F.dog({ x: dx, z: dz, yaw: dyaw, phase: ph, gait, color: v.c[4], size: S, legs: 1.2, jump, pitch, tail: t * 14 });
      const mouth: V3 = [dx + Math.cos(dyaw) * 0.55 * S, Y0 + 0.5 * S * 1.1 + jump + pitch * 0.3, dz - Math.sin(dyaw) * 0.55 * S];
      let disc: V3;
      if (c < 0.6) disc = [hand[0], hand[1], hand[2]];
      else if (c < 2.25) { const [x, z] = P(f, lerp(thrower + 0.5, catchA + 0.2, fl), v.n + 0.4 + Math.sin(fl * Math.PI) * 0.6); disc = [x, Y0 + 1.25 + Math.sin(fl * Math.PI) * 1.1 - fl * 0.2, z]; }
      else if (c < 6.2) disc = mouth;
      else if (c < 6.8) { const [x, z] = P(f, thrower + 0.6, v.n + 0.4); disc = [x, Y0 + 0.02, z]; }
      else disc = [hand[0], hand[1], hand[2]];
      F.box(disc[0], disc[1], disc[2], 0.27, 0.03, 0.27, c > 0.6 && c < 2.25 ? t * 12 : 0, c > 0.6 && c < 2.25 ? 0.15 : 0, v.c[5]);
    },
  },

  // A kite high over the park on the breeze, its tail snaking, its flyer leaning back on the line.
  kite: {
    w: (d, c) => (d === "park" && !wet(c) && !c.snow && day(c, 9, 19) && c.w.storm < 0.5 && c.season !== "winter" ? 1.3 : 0), trigger: 0,
    place(v, c, r, V) {
      const a = freeSpot(V, c, v.bx, v.bz, v.side, 3, 1.6, 5, r, 12, 27) ?? freeSpot(V, c, v.bx, v.bz, v.side, 3, 1.6, 5, r, 33, 48);
      if (a === null) return false;
      v.a = a; v.n = 3.2; cast(r, v.c);
      v.c.push(pick(r, [0xff3a3a, 0xf2c200, 0x3af2ff, 0xff8fb0, 0x7dff5a]), pick(r, [0x2e86c1, 0xff7a1a, 0x8e44ad]));
      return true;
    },
    draw(v, F, t) {
      const f = frameOf(v.bx, v.bz, v.side), [x, z] = P(f, v.a, v.n), tug = Math.sin(t * 1.7) * 0.15;
      F.person({ x, z, yaw: toBldg(f) + 0.4, lean: -0.15 + tug * 0.3, arms: [1.6 + tug, 1.5 + tug], fore: [1.9 + tug, 1.8 + tug], legs: [0.2, -0.15], turn: 0, nod: -0.6, ...castAt(v, 0) });
      const h = F.handR;
      const ka = v.a + 6 + Math.sin(t * 0.35) * 3, kn = v.n + 9 + Math.sin(t * 0.7) * 1.2, ky = Y0 + 15 + Math.sin(t * 0.5) * 1.5;
      const [kx, kz] = P(f, ka, kn), roll = Math.sin(t * 0.35) * 0.4;
      F.seg(h[0], h[1], h[2], kx, ky - 0.4, kz, 0.02, 0xdddddd);
      F.box(kx, ky, kz, 0.8, 0.8, 0.03, toStreet(f), Math.PI / 4 + roll, v.c[4]);
      F.box(kx, ky, kz, 0.82, 0.04, 0.035, toStreet(f), Math.PI / 4 + roll, v.c[5]); F.box(kx, ky, kz, 0.04, 0.82, 0.035, toStreet(f), Math.PI / 4 + roll, v.c[5]);
      for (let i = 1; i <= 5; i++) { const [tx, tz] = P(f, ka - Math.sin(roll) * i * 0.3 + Math.sin(t * 3 + i) * 0.25, kn + i * 0.08); F.box(tx, ky - 0.6 - i * 0.45, tz, 0.16, 0.08, 0.04, toStreet(f), Math.sin(t * 4 + i) * 0.6, i % 2 ? v.c[5] : v.c[4]); }
    },
  },
};

// Moving along a block side (the pack, the sled): a point `a` along it, round the next corner
// clockwise if past its end, and the heading there.
function pathPt(v: Vig, a: number, n: number): [number, number] {
  const end = 51 - v.n;
  if (a <= end) return P(frameOf(v.bx, v.bz, v.side), a, n);
  return P(frameOf(v.bx, v.bz, V_NEXT_SIDE[v.side]), 9 + v.n + (a - end), n);
}
function sidePathYaw(v: Vig, a: number) { return a <= 51 - v.n ? along(frameOf(v.bx, v.bz, v.side)) : along(frameOf(v.bx, v.bz, V_NEXT_SIDE[v.side])); }
// The pack's bolts: one every 21 s or so, 3.5 s long (0..1, eased in and out).
function dragAt(t: number) { const k = (t - 9) % 21; return t < 9 ? 0 : k < 3.5 ? Math.sin(Math.min(1, k / 0.4) * Math.PI / 2) * (1 - ramp(k, 3.0, 3.5)) : 0; }
function squirrelAt(t: number) { const k = (t - 9) % 21; return t < 9 || k > 1.2 ? -1 : k / 1.2; }
function walkU(t: number, sp: number, t0: number) { return -0.8 + (t - 18.5) * sp + 0 * t0; }
function umbU(t: number) { return t < 8 ? t * 1.15 : t < 11.4 ? 8 * 1.15 + (t - 8) * 0.15 : 8 * 1.15 + 3.4 * 0.15 + (t - 11.4) * 1.15; }
function guardKids(v: Vig, g: number) { return 3 + Math.floor(hash2(v.seed, g, 0, 0x6d) * 4); }
function vWalkPose(ph: number): Partial<Body> { const w = walkSwing(ph); return { legs: w.legs, arms: w.arms, y: CURB_H + w.bob }; }
const THREE_CLAMP = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

// ---- the set -----------------------------------------------------------------------------------
const VIG_SPAWN = [40, 105], VIG_DESPAWN = 140, VIG_TRY = 1.5;
const WANT: Record<District, number> = { downtown: 5, commercial: 5, park: 5, residential: 4, industrial: 1 };
const KINDS = Object.keys(K) as VK[];

export class Vignettes {
  readonly F: Figures;
  private list: Vig[] = [];
  private rng = new Rng(0x71c3);
  private rnd = this.rng.next;
  private tryT = 0;
  private ticketed = "";
  private logK = 0;
  readonly obstacles: Obstacle[] = [];   // people in the road (the crossing), for traffic
  adopt: ((p: Adopt) => void) | null = null;

  constructor(F: Figures) { this.F = F; }

  clear() { this.list.length = 0; this.obstacles.length = 0; this.tryT = 0; }
  reset(seed: number) { this.clear(); this.rng.s = seed >>> 0; this.ticketed = ""; }
  save() { return { rng: this.rng.s, list: this.list, tryT: this.tryT, tk: this.ticketed }; }
  load(o: ReturnType<Vignettes["save"]>) { this.rng.s = o.rng; this.list = o.list; this.tryT = o.tryT; this.ticketed = o.tk; this.obstacles.length = 0; }

  // Whether a frontage rect on a block side overlaps a vignette already there.
  clashes(bx: number, bz: number, side: number, a0: number, a1: number, n0: number, n1: number) {
    for (const v of this.list) {
      if (v.bx !== bx || v.bz !== bz) continue;
      if (v.side !== side) continue;
      const fp = K[v.k].foot?.(v) ?? [v.a - 2, v.a + 2, -3, 0];
      if (fp[1] > a0 && fp[0] < a1 && fp[3] > n0 && fp[2] < n1) return true;
    }
    return false;
  }
  // A footprint pedestrians on this side should step round, within `ahead` of a (either way).
  blocker(bx: number, bz: number, side: number, a: number, dir: number, ahead = 4): [number, number, number, number] | null {
    for (const v of this.list) {
      if (v.bx !== bx || v.bz !== bz || v.side !== side) continue;
      const fp = K[v.k].foot?.(v);
      if (!fp) continue;
      const lo = dir > 0 ? a : a - ahead, hi = dir > 0 ? a + ahead : a;
      if (fp[1] > lo && fp[0] < hi) return fp;
    }
    return null;
  }

  step(inp: VigInput) {
    const c = this.ctx(inp, inp.simTime);
    for (const v of this.list) { v.pt = v.t; for (let i = 0; i < v.st.length; i++) v.pst[i] = v.st[i]; }
    // Gone: out of range or done.
    for (let i = this.list.length - 1; i >= 0; i--) {
      const v = this.list[i], [x, z] = this.where(v);
      if (Math.hypot(x - c.focus.x, z - c.focus.z) > (DEBUG_VIGNETTE ? 1e9 : VIG_DESPAWN) || K[v.k].done?.(v)) this.list.splice(i, 1);
    }
    // Clocks: running, or waiting for the truck to come near.
    for (const v of this.list) {
      const kd = K[v.k];
      if (!v.on) { const [x, z] = this.where(v); if (kd.trigger <= 0 || DEBUG_VIGNETTE || Math.hypot(x - c.focus.x, z - c.focus.z) < kd.trigger) v.on = true; }
      if (DEBUG_VIGNETTE && c.simTime < DEBUG_SKIP_MINUTES * 60 + 1) continue;   // (test renders: from when the frames start)
      if (v.on) { v.t += SIM_DT; kd.step?.(v, c, this); }
    }
    // The truck parked at the kerb: a ticket, once a stop.
    if (inp.parked) {
      const key = `${Math.round(inp.parked.cabX)},${Math.round(inp.parked.cabZ)}`;
      if (key !== this.ticketed && !this.list.some((v) => v.k === "ticket") && (DEBUG_VIGNETTE === "ticket" || this.rnd() < SIM_DT / 9)) { this.ticketed = key; this.spawnTicket(c, inp.parked); }
    }
    if ((this.tryT += SIM_DT) >= (DEBUG_VIGNETTE ? SIM_DT : VIG_TRY)) { this.tryT = 0; this.spawn(c); }
    if (DEBUG_VIGNETTE && VIG_LOG.out && (this.logK = (this.logK + 1) % 20) === 0) VIG_LOG.out(`VIG t=${inp.simTime.toFixed(1)} focus=${c.focus.x.toFixed(0)},${c.focus.z.toFixed(0)} d=${c.plan.district(Math.floor(c.focus.x / BLOCK), Math.floor(c.focus.z / BLOCK))} hour=${c.hour.toFixed(1)} parked=${inp.parked ? 1 : 0} list=${this.list.map((v) => `${v.k}@${v.bx},${v.bz}/${v.side} a=${v.a.toFixed(1)} t=${v.t.toFixed(1)}`).join(" ")}`);
    // People in the road, for the traffic to wait for (the crossing).
    this.obstacles.length = 0;
    for (const v of this.list) {
      if (v.k === "guard" && v.st[0] === 1) {
        const f = frameOf(v.bx, v.bz, v.side), since = v.t - v.st[1];
        for (let a = 52; a < BLOCK + 8; a += 2.5) if (since > 1.5 && since < 13) { const [x, z] = P(f, a, 1.7); this.obstacles.push({ x, z, r: 0.5 }); }
      }
    }
  }

  private ctx(inp: VigInput, t: number): Ctx {
    const cl = inp.plan.climate;
    return { ...inp, hour: CLOCK.hourAt(t), w: weatherMix(cl?.weather ?? "clear"), season: cl?.season ?? "summer", snow: !!cl?.snowCover };
  }
  private where(v: Vig): [number, number] {
    if (v.k === "courier") return [v.st[1], v.st[2]];
    const a = v.k === "dogPack" || v.k === "sled" ? v.st[1] : v.k === "umbrella" ? v.a - 10 + umbU(v.t) : v.a;
    return P(frameOf(v.bx, v.bz, v.side), a, v.n);
  }

  private spawn(c: Ctx) {
    const d0 = c.plan.district(Math.floor(c.focus.x / BLOCK), Math.floor(c.focus.z / BLOCK)), dbg = DEBUG_VIGNETTE as VK | "";
    if (dbg && this.list.some((v) => v.k === dbg)) return;
    if (!dbg && this.list.length >= WANT[d0]) return;
    const r = this.rnd, ang = r() * Math.PI * 2, dist = dbg ? 8 + r() * 260 : VIG_SPAWN[0] + r() * (VIG_SPAWN[1] - VIG_SPAWN[0]);
    const bx = Math.floor((c.focus.x + Math.cos(ang) * dist) / BLOCK), bz = Math.floor((c.focus.z + Math.sin(ang) * dist) / BLOCK);
    if (!insideCity(bx, bz)) return;
    const d = c.plan.district(bx, bz);
    // A kind for here and now, not one already about.
    const ws = KINDS.map((k) => (dbg ? (k === dbg && K[k].w(d, c) > 0 ? 1 : 0) : this.list.some((v) => v.k === k) ? 0 : K[k].w(d, c)));
    let tot = ws.reduce((s, w) => s + w, 0);
    if (tot <= 0) return;
    let x = r() * tot, k: VK = KINDS[0];
    for (let i = 0; i < KINDS.length; i++) { x -= ws[i]; if (x < 0) { k = KINDS[i]; break; } }
    const side = Math.floor(r() * 4), seed = Math.floor(r() * 2 ** 31);
    const v: Vig = { k, bx, bz, side, a: 30, n: -1, t: 0, pt: 0, on: false, seed, c: [], st: [0, 0], pst: [0, 0], rel: 0 };
    if (!K[k].place(v, c, mulberry32(seed), this)) return;
    // Not where the truck can already see it pop in.
    const [vx, vz] = this.where(v);
    if (!dbg && Math.hypot(vx - c.focus.x, vz - c.focus.z) < VIG_SPAWN[0] - 8) return;
    if (v.pst.length !== v.st.length) v.pst = v.st.slice();
    this.list.push(v);
  }

  private spawnTicket(c: Ctx, p: KerbParked) {
    // The pavement beside the cab: the block side whose kerb lane it is in.
    const bx0 = Math.floor(p.cabX / BLOCK), bz0 = Math.floor(p.cabZ / BLOCK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (let side = 0; side < 4; side++) {
      const bx = bx0 + dx, bz = bz0 + dz, f = frameOf(bx, bz, side), [a, n] = toFront(f, p.cabX, p.cabZ);
      if (n > -6.5 && n < -3.2 && a > 12 && a < 48 && insideCity(bx, bz)) {
        const fx = Math.cos(p.h), fz = -Math.sin(p.h), s = fx * f.fx + fz * f.fz > 0 ? 1 : -1;
        const r = mulberry32(Math.floor(this.rnd() * 2 ** 31));
        const v: Vig = { k: "ticket", bx, bz, side, a, n: -1, t: 0, pt: 0, on: true, seed: 1, c: [], st: [0, 1, p.cabX, p.cabZ], pst: [0, 1, p.cabX, p.cabZ], rel: 0 };
        v.c.push(0x2f4f7f, 0x1f2f55, pick(r, SKINS), pick(r, HAIRS), s);
        this.list.push(v);
        return;
      }
    }
  }

  // Draw every vignette `alpha` of the way from its last step to this one.
  draw(alpha: number, time: number) {
    const F = this.F, hour = CLOCK.hourAt(time), dc: DrawCtx = { time, hour, night: night(hour) || hour < 6.5 || hour > 19.5, st: [] };
    F.begin();
    for (const v of this.list) {
      if (!F.room(120)) break;
      const t = v.on ? v.pt + (v.t - v.pt) * alpha : 0;
      const st = v.st.map((x, i) => (i === 0 || v.st[0] !== v.pst[0] ? x : v.pst[i] + (x - v.pst[i]) * alpha));
      dc.st = st;
      K[v.k].draw(v, F, t, dc);
    }
    F.end_();
  }

  get count() { return this.list.length; }
  // Test renders: where to watch the debug vignette from (its point, the way along its
  // frontage and the way out to the street), and how far back and how high to look.
  view(): { x: number; z: number; fx: number; fz: number; ox: number; oz: number; back: number; y: number; look: number } | null {
    const v = this.list.find((u) => u.k === DEBUG_VIGNETTE) ?? null;
    if (!v) return null;
    const f = frameOf(v.bx, v.bz, v.side), [x, z] = this.where(v);
    const far: Partial<Record<VK, [number, number, number]>> = { washers: [13, 4, 9], kite: [24, 3, 6], taichi: [16, 4, 1], frisbee: [18, 4, 1], foodTruck: [14, 3, 1.4], courier: [9, 2.5, 1], dogPack: [9, 2.5, 0.6] };
    const [back, y, look] = far[v.k] ?? [5, 2.0, 0.8];
    if (v.k === "washers" && washPt[0] !== 0) { const [wx, wz] = washPt; return { x: wx, z: wz, fx: washF[0], fz: washF[1], ox: washF[2], oz: washF[3], back: back + washSeen[0], y, look: washSeen[1] }; }
    if (v.k === "ticket") return { x, z, fx: f.fx * v.c[4], fz: f.fz * v.c[4], ox: f.rx * 0.08, oz: f.rz * 0.08, back: 16, y: 2.2, look: 1.4 };   // (along the pavement, behind the officer)
    if (v.k === "courier") { const h = v.st[3]; return { x, z, fx: Math.cos(h), fz: -Math.sin(h), ox: Math.sin(h), oz: Math.cos(h), back, y, look }; }
    return { x, z, fx: f.fx, fz: f.fz, ox: -f.rx, oz: -f.rz, back: back + Math.max(0, v.n), y, look };
  }
  kinds() { return this.list.map((v) => v.k); }
}

// For the close-up tool (tools/vignettes.ts): draw one kind's vignette on a frontage at a time,
// on a stand-in vignette; `st` its state.
export function drawVignette(F: Figures, v: Vig, t: number, D: Partial<DrawCtx> = {}) {
  K[v.k].draw(v, F, t, { time: t, hour: 12, night: false, st: v.st, ...D });
}
export function placeVignette(v: Vig, c: Partial<Ctx> & { plan: CityPlan }, V: Vignettes) {
  const full: Ctx = { simTime: 0, prs: [], focus: { x: 0, z: 0 }, truck: [], cars: [], peds: [], parked: null, busy: new Set(), hour: 12, w: weatherMix("clear"), season: "summer", snow: false, ...c };
  return K[v.k].place(v, full, mulberry32(v.seed), V);
}
export function stepVignette(v: Vig, c: Partial<Ctx> & { plan: CityPlan }, V: Vignettes) {
  const full: Ctx = { simTime: v.t, prs: [], focus: { x: 0, z: 0 }, truck: [], cars: [], peds: [], parked: null, busy: new Set(), hour: 12, w: weatherMix("clear"), season: "summer", snow: false, ...c };
  for (let i = 0; i < v.st.length; i++) v.pst[i] = v.st[i];
  v.pt = v.t; v.t += SIM_DT; K[v.k].step?.(v, full, V);
}
export const VIG_KINDS = KINDS;
