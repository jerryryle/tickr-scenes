// A freeway through some cities: an elevated motorway along the entry gate's street line, right
// through town and on out into the country both ways. The highway in comes up onto a flyover
// beside it a few hundred metres out, runs alongside at its height, and comes back down to the
// gate street (country.ts gives the road those heights: rampLift). Out on the entry side the
// motorway runs to the left of the highway, and swings over it to the street line at the gate.
//
// Everything here is placed from a Frame: the entry gate street's outer end, the way out of town
// and the way to the right of a truck coming in. d is the distance out of town from the gate end
// (negative: the gate street, the city, the far side), n the offset to the right of a truck coming
// in. The same pieces are drawn by the road coming in (countryworld.ts: before the next city takes
// over, and for a while after) and by the city (FreewayReach), from the same frame, so the one
// can hand over to the other without anything moving. In town the deck is the street's
// (city.ts), and its bents stand on the sidewalks.
import * as THREE from "three@0.187.0";
import { hash2 } from "./rng.ts";
import { Batch } from "./geom.ts";
import { disposeTree } from "./chunks.ts";
import { BLOCK, STREET } from "./grid.ts";
import { CITY_HI, CITY_LO, entryGateOf, gateEnd } from "./city.ts";
import type { CityPlan, Gate } from "./city.ts";
import type { CityStyle } from "./styles.ts";
import type { CountryRoad } from "./country.ts";
import { headLamp, tailLamp } from "./traffic.ts";

export const FW_TOP = 9.6;             // the deck's top (clear of the streetlights' arms under it)
export const FW_HALF = 7.4;            // half the deck's width
export const FW_COLS = 8.2;            // a bent's columns, either side of the deck's centre line
export const FW_SHIFT = -16;           // out on the entry side the deck runs this far to the highway's left
const FW_SHIFT_LEN = 130;                 // and swings over to the street line within this of the gate end
export const FW_REACH = 1000;          // how far it runs on out of town, either way
const FW_END_RUN = 150;                   // its last stretch, where it comes down to the ground
const FW_BENT_STEP = 30;
// The highway's flyover beside it: up from the ground UP0..UP1 metres out, at the deck's height
// to DOWN1, down to the ground by DOWN0, and level on in to the gate.
export const RAMP_UP0 = 830, RAMP_UP1 = 570, RAMP_DOWN1 = 360, RAMP_DOWN0 = 120;
export const RAMP_HALF = 6.2;          // half its deck's width (the road and its shoulders)
const FW_CONCRETE = 0x9a978e, FW_GIRDER = 0x6f7276, FW_ASPHALT = 0x3a3b3f, FW_WHITE = 0xe8e8e0, FW_YELLOW = 0xf2c200;

const fwEase = (u: number) => { const t = THREE.MathUtils.clamp(u, 0, 1); return t * t * (3 - 2 * t); };

// Whether a city has a freeway, and through which gate: about half of them (never in a small
// Main Street town, nor across a metro's elevated lines). A pure function of the city's seed.
export function freewayGate(citySeed: number, style: CityStyle): Gate | null {
  if (style.id === "mainstreet") return null;
  const g = entryGateOf(citySeed);
  if (style.elevated && (g.dir === 1 || g.dir === 3)) return null;
  return hash2(citySeed, 0xf3e, 0, 0x7a2) < 0.55 ? g : null;
}

// The highway's height above the land at d out of town, on a road into a freeway city.
export function rampLift(d: number) {
  if (d <= RAMP_DOWN0 || d >= RAMP_UP0) return 0;
  if (d < RAMP_DOWN1) return FW_TOP * fwEase((d - RAMP_DOWN0) / (RAMP_DOWN1 - RAMP_DOWN0));
  if (d > RAMP_UP1) return FW_TOP * (1 - fwEase((d - RAMP_UP1) / (RAMP_UP0 - RAMP_UP1)));
  return FW_TOP;
}

export class Frame {
  readonly ox: number; readonly oz: number; readonly rx: number; readonly rz: number;
  // (x, z): the gate end; h: the heading of a truck coming in there. near/far: where the city's
  // own streets begin and end along the line (d); descend: whether the far end comes down.
  constructor(readonly x: number, readonly z: number, h: number, readonly near = -60, readonly far = -1e9, public descendFar = true) {
    this.ox = -Math.cos(h); this.oz = Math.sin(h); this.rx = Math.sin(h); this.rz = Math.cos(h);
  }
  static ofCity(plan: CityPlan, g: Gate): Frame {
    const e = gateEnd(g), f = new Frame(e.x, e.z, e.h + Math.PI);
    // The city's streets along the line, as distances out of the gate end.
    const lo = CITY_LO * BLOCK, hi = (CITY_HI + 1) * BLOCK, along = g.dir === 0 || g.dir === 2;
    const d = (u: number) => along ? (u - e.x) * f.ox : (u - e.z) * f.oz;
    return new Frame(e.x, e.z, e.h + Math.PI, Math.max(d(lo), d(hi)), Math.min(d(lo), d(hi)));
  }
  static ofRoad(road: CountryRoad, dx = 0, dz = 0): Frame {
    const q = road.center(road.length, { x: 0, z: 0, h: 0, k: 0 });
    return new Frame(q.x + dx, q.z + dz, q.h);
  }
  px(d: number, n: number) { return this.x + this.ox * d + this.rx * n; }
  pz(d: number, n: number) { return this.z + this.oz * d + this.rz * n; }
  // Where (x, z) is: d and n.
  dAt(x: number, z: number) { return (x - this.x) * this.ox + (z - this.z) * this.oz; }
  nAt(x: number, z: number) { return (x - this.x) * this.rx + (z - this.z) * this.rz; }
  // The deck's centre line (n) and its top at d.
  m(d: number) { return d <= 0 ? 0 : FW_SHIFT * fwEase(d / FW_SHIFT_LEN); }
  y(d: number) {
    if (d > FW_REACH - FW_END_RUN) return FW_TOP * (1 - fwEase((d - (FW_REACH - FW_END_RUN)) / FW_END_RUN));
    const out = this.far - d;   // beyond the far side's edge
    if (this.descendFar && out > FW_REACH - FW_END_RUN) return FW_TOP * (1 - fwEase((out - (FW_REACH - FW_END_RUN)) / FW_END_RUN));
    return FW_TOP;
  }
  // The underside of the deck over (x, z), if (x, z) is under it (the camera keeps below it).
  under(x: number, z: number): number | null {
    const d = this.dAt(x, z), n = this.nAt(x, z);
    if (d > FW_REACH || d < this.far - FW_REACH) return null;
    if (Math.abs(n - this.m(d)) > FW_HALF + 0.5) return null;
    const y = this.y(d);
    return y > 4 ? y - 2.2 : null;
  }
  // Is (x, z) where the freeway or the flyover stands (scenery keeps out)?
  corridor(x: number, z: number) {
    const d = this.dAt(x, z), n = this.nAt(x, z);
    if (d > FW_REACH + 10 || d < this.far - FW_REACH - 10) return false;
    if (Math.abs(n - this.m(d)) < FW_COLS + 2) return true;
    return d > RAMP_DOWN0 - 20 && d < RAMP_UP0 + 20 && Math.abs(n) < RAMP_HALF + 2.5;
  }
}

// Whether a bent's column may stand at (d, n): clear of the highway coming in (out to where it
// stops being straight), else as the caller says.
type FwColumnOk = (x: number, z: number) => boolean;
const fwEntryColumnOk = (d: number, n: number) => d < 0 || Math.abs(n) > 7.2;

// The freeway between d0 and d1 (d0 < d1), drawn into b relative to (ax, az): the deck (`main`),
// the highway's flyover (`ramp`) and its road surface (`surface`, when nothing else draws it).
export function buildFreeway(b: Batch, F: Frame, d0: number, d1: number, ax: number, az: number,
  parts: { main?: boolean; ramp?: boolean; surface?: boolean; bents?: boolean }, columnOk: FwColumnOk | null = null) {
  const STEP = 10;
  // A box along the line from d=a to d=a2 at offset n, following heights ya..yb, `lo`..`hi` above them.
  const along = (a: number, a2: number, na: number, nb: number, ya: number, yb: number, lo: number, hi: number, wid: number, color: number) => {
    const xa = F.px(a, na), za = F.pz(a, na), xb = F.px(a2, nb), zb = F.pz(a2, nb), run = Math.hypot(xb - xa, zb - za);
    b.boxR((xa + xb) / 2 - ax, (ya + yb) / 2 + (lo + hi) / 2, (za + zb) / 2 - az, Math.hypot(run, yb - ya) + 0.04, hi - lo, wid, color, 0, Math.atan2(-(zb - za), xb - xa), Math.atan2(yb - ya, run));
  };
  const keep = b.dy; b.dy = 0;
  // (Finer where the deck swings across, so its pieces follow the bend without gaps.)
  const stepAt = (a: number) => (a > -1 && a < FW_SHIFT_LEN + 1 && F.m(FW_SHIFT_LEN) !== 0 ? 2 : STEP);
  const next = (a: number) => Math.min(d1, (Math.floor(a / stepAt(a) + 1e-9) + 1) * stepAt(a));
  for (let a = d0; a < d1 - 1e-6; a = next(a)) {
    const a2 = next(a);
    if (parts.main) {
      const ya = F.y(a), yb = F.y(a2), ma = F.m(a), mb = F.m(a2);
      if (ya > 0.05 || yb > 0.05) {
        along(a, a2, ma, mb, ya, yb, -0.55, -0.06, 2 * FW_HALF, FW_CONCRETE);
        along(a, a2, ma, mb, ya, yb, -0.06, 0, 2 * FW_HALF - 0.8, FW_ASPHALT);
        for (const k of [-1, 1]) {
          along(a, a2, ma + k * 4, mb + k * 4, ya, yb, -1.45, -0.55, 0.9, FW_GIRDER);
          along(a, a2, ma + k * (FW_HALF - 0.2), mb + k * (FW_HALF - 0.2), ya, yb, 0, 0.95, 0.4, FW_CONCRETE);
          // Lane lines, dashed.
          { const k0 = Math.floor(a / STEP + 1e-9) * STEP, e = Math.min(a2, k0 + 4);
            if (Math.floor(a / STEP + 1e-9) % 2 === 0 && e > a + 0.01) along(a, e, F.m(a) + k * 3.5, F.m(e) + k * 3.5, ya, ya + (yb - ya) * (e - a) / (a2 - a), 0, 0.025, 0.16, FW_WHITE); }
        }
        along(a, a2, ma, mb, ya, yb, 0, 0.8, 0.5, FW_CONCRETE);   // the median barrier
      }
    }
    if (parts.ramp || parts.surface) {
      const la = rampLift(a), lb = rampLift(a2), lifted = Math.max(la, lb) > 0.05;
      if (parts.ramp && lifted) {
        // The flyover's deck under the road, on a fill near the ground, its parapets once it is up.
        along(a, a2, 0, 0, la, lb, -0.83, -0.13, 2 * RAMP_HALF, FW_CONCRETE);
        const lo = Math.min(la, lb);
        if (lo < 2.8) {
          const xa = F.px(a, 0), za = F.pz(a, 0), xb = F.px(a2, 0), zb = F.pz(a2, 0), top = (la + lb) / 2 - 0.5;
          if (top > 0.05) b.box((xa + xb) / 2 - ax, top / 2, (za + zb) / 2 - az, Math.hypot(xb - xa, zb - za) + 0.04, top, 2 * RAMP_HALF - 0.4, 0x8a867c, Math.atan2(-(zb - za), xb - xa));
        }
        if (lo > 0.5) for (const k of [-1, 1]) along(a, a2, k * (RAMP_HALF - 0.15), k * (RAMP_HALF - 0.15), la, lb, -0.13, 0.85, 0.3, FW_CONCRETE);
      }
      if (parts.surface && a >= -1) {
        // The road itself, as countryworld.ts draws it: widening to the gate street's width at the
        // gate; one way up on the flyover (a dashed white line), two ways on the ground.
        const w = fwEase((70 - (a + a2) / 2) / 70), half = 4.1 + 1.9 * w;
        along(a, a2, 0, 0, la, lb, -0.124, -0.004, 2 * half, 0x34353a);
        for (const k of [-1, 1]) {
          along(a, a2, k * (half + 0.9), k * (half + 0.9), la, lb, -0.125, -0.025, 1.8, 0x7a776c);
          along(a, a2, k * (half - 0.25), k * (half - 0.25), la, lb, -0.005, 0.015, 0.14, FW_WHITE);
        }
        if (Math.floor(a / 6) % 2 === 0) along(a, Math.min(a2, a + 5), 0, 0, la, la + (lb - la) * Math.min(1, 5 / (a2 - a)), -0.005, 0.015, lifted ? 0.14 : 0.24, lifted ? FW_WHITE : FW_YELLOW);
      }
    }
  }
  // Bents: every FW_BENT_STEP metres of d (the same spots whoever draws them), where the deck is up.
  if (parts.bents ?? parts.main) {
    for (let d = Math.ceil(d0 / FW_BENT_STEP) * FW_BENT_STEP; d < d1; d += FW_BENT_STEP) {
      const y = F.y(d), m = F.m(d);
      if (y < 4 || (d < F.near && d > F.far)) continue;   // (in town the street's own: city.ts)
      const cols = [-1, 1].map((k) => m + k * FW_COLS).filter((n) => columnOk ? columnOk(F.px(d, n), F.pz(d, n)) : fwEntryColumnOk(d, n));
      if (!cols.length) continue;
      const capY = y - 1.45 - 0.45;
      const xa = F.px(d, m - FW_COLS - 0.6), za = F.pz(d, m - FW_COLS - 0.6), xb = F.px(d, m + FW_COLS + 0.6), zb = F.pz(d, m + FW_COLS + 0.6);
      b.box((xa + xb) / 2 - ax, capY, (za + zb) / 2 - az, Math.hypot(xb - xa, zb - za), 0.9, 1.2, FW_CONCRETE, Math.atan2(-(zb - za), xb - xa));
      for (const n of cols) b.cyl(F.px(d, n) - ax, (capY - 0.45) / 2, F.pz(d, n) - az, 0.6, capY - 0.45 + 0.2, FW_CONCRETE, 10);
    }
    // The flyover's piers.
    if (parts.ramp) for (let d = Math.ceil((d0 - 15) / FW_BENT_STEP) * FW_BENT_STEP + 15; d < d1; d += FW_BENT_STEP) {
      const l = rampLift(d);
      if (d < d0 || l < 2.8) continue;
      b.cyl(F.px(d, 0) - ax, (l - 0.83) / 2, F.pz(d, 0) - az, 0.9, l - 0.83, FW_CONCRETE, 10);
      const xa = F.px(d, -4), za = F.pz(d, -4), xb = F.px(d, 4), zb = F.pz(d, 4);
      b.box((xa + xb) / 2 - ax, l - 1.2, (za + zb) / 2 - az, 8, 0.8, 1.4, FW_CONCRETE, Math.atan2(-(zb - za), xb - xa));
    }
  }
  b.dy = keep;
}

// The freeway in town along one street (city.ts, block-local: the street along x for axis 0, z
// for axis 1, from 0 to BLOCK): the deck, level. Its bents stand on the sidewalks (city.ts).
export function buildFreewayStreet(b: Batch, axis: number) {
  const F = axis === 0 ? new Frame(0, STREET / 2, Math.PI) : new Frame(STREET / 2, 0, Math.PI / 2);
  // (A frame with the line along +x (or along +z), level all the way: d from 0 to BLOCK.)
  const level = Object.assign(Object.create(Frame.prototype), F, { y: () => FW_TOP, m: () => 0 }) as Frame;
  buildFreeway(b, level, 0, BLOCK, 0, 0, { main: true, bents: false });
}
// The bent over a street at `at` along it (block-local), its two columns on the sidewalks.
export const FW_STREET_COLS = [STREET / 2 - FW_COLS, STREET / 2 + FW_COLS] as const;
export function freewayStreetBent(b: Batch, axis: number, at: number) {
  const capY = FW_TOP - 1.9;
  const [x, z, w, d] = axis === 0 ? [at, STREET / 2, 1.2, 2 * FW_COLS + 1.2] : [STREET / 2, at, 2 * FW_COLS + 1.2, 1.2];
  b.box(x, capY, z, w, 0.9, d, FW_CONCRETE);
  for (const c of FW_STREET_COLS) { const [cx, cz] = axis === 0 ? [at, c] : [c, at]; b.cyl(cx, (capY - 0.45) / 2, cz, 0.55, capY - 0.45 + 0.2, FW_CONCRETE, 10); }
}

// The freeway out of town either side of a city with one: built in pieces when the city starts
// (and when the roads it must keep clear of change). The pieces on the entry side are hidden while
// the road coming in draws them itself (cover).
export class FreewayReach {
  readonly group = new THREE.Group();
  frame: Frame | null = null;
  private key = "";
  private entry: { d0: number; d1: number; mesh: THREE.Object3D }[] = [];
  constructor(scene: THREE.Object3D, private material: THREE.Material) { scene.add(this.group); }

  update(plan: CityPlan, roads: { road: CountryRoad; dx: number; dz: number }[]) {
    const g = plan.freeway;
    const key = g ? `${plan.seed}/${CITY_LO}/${FW_GATE_KEY(g)}|${roads.map((r) => `${r.road.inp.city}:${r.road.inp.kind}:${r.road.inp.dEst}:${r.dx.toFixed(1)}:${r.dz.toFixed(1)}`).join(";")}` : "";
    if (key === this.key) return;
    this.key = key;
    this.clear();
    if (!g) { this.frame = null; return; }
    const F = this.frame = Frame.ofCity(plan, g);
    // Where the roads are (the far side keeps its columns off them, and comes down only where clear).
    const pts: number[] = [], q = { x: 0, z: 0, h: 0, k: 0 };
    for (const { road, dx, dz } of roads) for (let s = 0; s <= road.length; s += 4) { road.center(s, q); const x = q.x + dx, z = q.z + dz; if (F.dAt(x, z) < F.far + 40) pts.push(x, z); }
    const clear = (x: number, z: number, r: number) => { for (let i = 0; i < pts.length; i += 2) if (Math.hypot(pts[i] - x, pts[i + 1] - z) < r) return false; return true; };
    F.descendFar = true;
    for (let d = F.far - FW_REACH; d < F.far - FW_REACH + FW_END_RUN; d += 10) if (!clear(F.px(d, 0), F.pz(d, 0), 14)) F.descendFar = false;
    const piece = (d0: number, d1: number, entry: boolean) => {
      const b = new Batch(), ax = F.px(d0, 0), az = F.pz(d0, 0);
      buildFreeway(b, F, d0, d1, ax, az, { main: true, ramp: entry, surface: entry }, entry ? null : (x, z) => clear(x, z, 7.9));
      const mesh = b.build(this.material);
      if (!mesh) return;
      mesh.position.set(ax, 0, az); this.group.add(mesh);
      if (entry) this.entry.push({ d0, d1, mesh });
    };
    piece(F.near, 0, true);
    for (let d = 0; d < FW_REACH; d += 60) piece(d, Math.min(FW_REACH, d + 60), true);
    for (let d = F.far; d > F.far - FW_REACH; d -= 60) piece(Math.max(F.far - FW_REACH, d - 60), d, false);
  }
  // The road coming in draws the entry side out to `d` itself (0: it doesn't).
  cover(d: number) { for (const p of this.entry) p.mesh.visible = !(p.d0 >= 0 && p.d1 <= d + 0.01); }
  clear() {
    for (const m of [...this.group.children]) { this.group.remove(m); disposeTree(m); }
    this.entry = [];
  }
}
const FW_GATE_KEY = (g: Gate) => `${g.ix},${g.iz},${g.dir}`;

// Cars on the freeway: two lanes each way, at steady speeds, where they are a pure function of the
// journey's time. Only the ones near the camera are drawn.
const FW_CAR_COLORS = [0xc0392b, 0x2e6fb2, 0xe8e8e0, 0x2a2b2e, 0x8a9aa6, 0x2e8b57, 0xe0a020, 0xd8d8d0];
const FW_LANES = [{ n: 2.0, v: 27, dir: -1 }, { n: 5.4, v: 24, dir: -1 }, { n: -2.0, v: 29, dir: 1 }, { n: -5.4, v: 25, dir: 1 }];
const FW_PER_LANE = 16, FW_MAX_CARS = 40;
export class FreewayTraffic {
  private mesh: THREE.InstancedMesh;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler(); private v = new THREE.Vector3(); private one = new THREE.Vector3(1, 1, 1);
  constructor(scene: THREE.Object3D, material: THREE.Material) {
    const b = new Batch();
    b.box(0, 0.7, 0, 4.3, 0.75, 1.8, 0xffffff); b.box(-0.3, 1.35, 0, 2.2, 0.6, 1.62, 0x2a3440);
    for (const x of [-1.35, 1.35]) for (const z of [-0.73, 0.73]) b.cyl(x, 0.34, z, 0.34, 0.24, 0x1a1a1a, 8, Math.PI / 2);
    for (const z of [-0.6, 0.6]) { headLamp(b, 2.16, 0.75, z, 0.04, 0.16, 0.3); tailLamp(b, -2.16, 0.8, z, 0.04, 0.14, 0.3); }
    const m = b.build(material)!;
    this.mesh = new THREE.InstancedMesh(m.geometry, material, FW_MAX_CARS);
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    for (let i = 0; i < FW_MAX_CARS; i++) this.mesh.setColorAt(i, new THREE.Color(FW_CAR_COLORS[i % FW_CAR_COLORS.length]));
    scene.add(this.mesh);
  }
  // F: the freeway's frame now (null: none here); t: journey time; near: the camera; entryOnly:
  // only the stretch out on the entry side (the city beyond isn't there yet).
  update(F: Frame | null, t: number, near: { x: number; z: number }, entryOnly: boolean) {
    let n = 0;
    if (F) {
      const lo = (entryOnly ? -40 : F.far - FW_REACH + FW_END_RUN + 10), hi = FW_REACH - FW_END_RUN - 10, span = hi - lo;
      for (let li = 0; li < FW_LANES.length; li++) {
        const L = FW_LANES[li];
        for (let k = 0; k < FW_PER_LANE && n < FW_MAX_CARS; k++) {
          const phase = (k + hash2(k, li, 0x5ca, 0xf00)) / FW_PER_LANE * (FW_REACH * 2 + 3000);
          const raw = phase + L.dir * L.v * t, d = lo + (((raw % span) + span) % span);
          const nn = F.m(d) + L.n;
          const x = F.px(d, nn), z = F.pz(d, nn);
          if (Math.hypot(x - near.x, z - near.z) > 360) continue;
          const dm = (F.m(d + 1) - F.m(d - 1)) / 2, hx = F.ox + F.rx * dm, hz = F.oz + F.rz * dm;
          const heading = Math.atan2(-hz, hx) + (L.dir > 0 ? 0 : Math.PI);
          this.e.set(0, heading, 0); this.q.setFromEuler(this.e);
          this.m4.compose(this.v.set(x, F.y(d), z), this.q, this.one);
          this.mesh.setMatrixAt(n, this.m4);
          this.mesh.setColorAt(n, new THREE.Color(FW_CAR_COLORS[(k * 3 + li) % FW_CAR_COLORS.length]));
          n++;
        }
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
