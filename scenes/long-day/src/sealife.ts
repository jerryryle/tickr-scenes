// Life on the sea off a coastal or port town (outline.ts): boats under way, the harbour at work,
// surf running up the beach, and after dark their lights. Everything here is a function of journey
// time alone (as the elevated trains are), so a scrub finds it where it was.
// Offshore, boats cruise along the coast and back: sailboats leaning a little off the wind,
// cruisers faster, and off a port a container ship further out. Closer in, a few boats work loops
// out from the shore and back (off a port, harbour launches clear of its piers and a car ferry
// running out to sea and back; off a beach, jet skis). On a headland's point a lighthouse stands on
// its rock. In a port a crane on the container wharf works the ship moored there, a box at a time,
// and the boats moored along the quay and the piers (city.ts shoreMoorings) ride the swell. On a
// beach two lines of foam wash up the sand and back.
// The sea's surface (main.ts buildSea) and everything on it fog out over a longer way than the land
// (farFog): out there nothing streams in to be hidden, and the camera's far plane reaches on over it
// (engine.ts seaFar).
import * as THREE from "three@0.187.0";
import { Batch, keepWarm } from "./geom.ts";
import { hash2 } from "./rng.ts";
import { boatAt, boatExtent, boatSize, BOAT_PAINTS } from "./boats.ts";
import type { BoatKind } from "./boats.ts";
import { BEACH_W, CityPlan, SEA_Y, shoreMoorings, WHARF_SHIP_L } from "./city.ts";
import { CURB_H } from "./grid.ts";
import { LAMPS_ON } from "./atmosphere.ts";
import { ferryModel } from "./countryworld.ts";
import { WATER_DROP } from "./country.ts";
import { drain } from "./slices.ts";
import type { Steps } from "./slices.ts";

const OUT_X = [1, 0, -1, 0], OUT_Z = [0, -1, 0, 1];   // (out to sea from each side: 0 east, 1 north, 2 west, 3 south)
const SEA_TOP = SEA_Y;   // the sea's surface (main.ts buildSea)
const FOAM = 0xf2f5f4, WHITE_LIGHT = 0xfff4d8, RED_LIGHT = 0xff3020, GREEN_LIGHT = 0x30ff70, WINDOW = 0xffd88a;
const SHIP_L = WHARF_SHIP_L, SHIP_B = 13;
// How far along the coast past the town the sea reaches (main.ts buildSea), and the boats ply: out
// of sight of the road in along it before they turn.
export const SEA_ALONG = 1500;
const LIGHT_OUT = 46;   // the lighthouse's rock: this far out from the headland's shore
const seaStep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// A boat's way: a function of time to where it is and which way it heads.
type Way = (t: number, out: { x: number; z: number; h: number }) => void;
interface Mover { obj: THREE.Object3D; way: Way; bob: number }
interface Crane { a: number; trolley: THREE.Object3D; cable: THREE.Object3D; spreader: THREE.Object3D; box: THREE.Object3D }

export class SeaLife {
  readonly surface: THREE.Material;   // (main.ts buildSea too)
  private readonly lights: THREE.Material;
  private movers: Mover[] = [];
  private statics: THREE.Object3D[] = [];
  private cranes: Crane[] = [];
  private wharf: { x: number; z: number; nx: number; nz: number; ex: number; ez: number } | null = null;
  private beam: THREE.Object3D | null = null;
  private foam: THREE.Mesh | null = null;
  private edges: { ax: number; az: number; bx: number; bz: number; nx: number; nz: number }[] = [];
  private p = { x: 0, z: 0, h: 0 };
  constructor(private readonly world: THREE.Object3D, base: THREE.Material, share?: SeaLife) {
    this.surface = share?.surface ?? farFog(base.clone());
    // (Lights: unlit, and drawn only after dark: update.)
    this.lights = share?.lights ?? farFog(new THREE.MeshBasicMaterial({ vertexColors: true }));
    // The sea's materials kept warm from the start (geom.ts keepWarm), so the first town on the sea
    // isn't the frame that compiles them.
    if (!share) for (const m of [this.surface, this.lights]) { const b = new Batch(); b.box(0, 0, 0, 1, 1, 1, 0); keepWarm(world, b.build(m)!.geometry, m); }
  }

  clear() {
    const drop = (o: THREE.Object3D) => { this.world.remove(o); o.traverse((c) => { if (c instanceof THREE.Mesh) c.geometry.dispose(); }); };
    for (const m of this.movers) drop(m.obj);
    for (const o of this.statics) drop(o);
    for (const c of this.cranes) for (const o of [c.trolley, c.cable, c.spreader, c.box]) drop(o);
    if (this.foam) drop(this.foam);
    this.movers.length = 0; this.statics.length = 0; this.cranes.length = 0;
    this.foam = null; this.beam = null; this.wharf = null; this.edges = [];
  }

  // The boats, the harbour, the lighthouse and the beach's surf for the town (none off a town not
  // on the sea).
  build(plan: CityPlan) {
    const T = this.next;
    this.clear();
    if (T?.seed === plan.seed) { drain(T.job); this.adopt(T.life); }
    else drain(this.buildSteps(plan));
    this.next = null;
  }
  // Another town's, built ahead a few pieces at a time (slices.ts) out of the world, and taken in
  // by build when the journey gets there (main.ts). (Its plan's graph built first: CityPlan.prepare.)
  prepare(plan: CityPlan, pieces: number) {
    if (this.next?.seed !== plan.seed) { const life = new SeaLife(new THREE.Group(), this.surface, this); this.next = { seed: plan.seed, life, job: life.buildSteps(plan), done: false }; }
    const T = this.next;
    for (let i = 0; i < pieces && !T.done; i++) T.done = !!T.job.next().done;
  }
  private next: { seed: number; life: SeaLife; job: Steps<void>; done: boolean } | null = null;
  // (What another one built, into this one's world.)
  private adopt(o: SeaLife) {
    this.movers = o.movers; this.statics = o.statics; this.cranes = o.cranes; this.wharf = o.wharf; this.beam = o.beam; this.foam = o.foam; this.edges = o.edges;
    for (const c of [...o.world.children]) this.world.add(c);
  }
  private *buildSteps(plan: CityPlan): Steps<void> {
    const O = plan.outline, s = O.sea;
    if (s === null) return;
    const h = (k: number) => hash2(plan.seed, k, 0, 0x5ea1), port = plan.style.id === "port";
    // A point `o` out to sea from the shore line (outline.ts shore), `t` along the coast, and the
    // way along the coast (+t) and out (+o) as headings.
    const ew = s === 0 || s === 2, edge = s === 0 ? O.X1 : s === 1 ? O.Z0 : s === 2 ? O.X0 : O.Z1;
    const at = (t: number, o: number, P: { x: number; z: number }) => {
      const d = o - O.shore(t);
      if (ew) { P.x = edge + OUT_X[s] * d; P.z = t; } else { P.x = t; P.z = edge + OUT_Z[s] * d; }
    };
    const headOf = (dt: number, d0: number) => {   // (the heading of a way moving dt along and d0 out)
      const dx = ew ? OUT_X[s] * d0 : dt, dz = ew ? dt : OUT_Z[s] * d0;
      return Math.atan2(-dz, dx);
    };
    const lo = (ew ? O.Z0 : O.X0) - SEA_ALONG, span = (ew ? O.Z1 - O.Z0 : O.X1 - O.X0) + 2 * SEA_ALONG;
    // The lighthouse first: the boats keep clear of its rock.
    const light = this.lighthouse(plan, at), LP = { x: 0, z: 0 };
    yield;
    at(light, LIGHT_OUT, LP);
    // (Out round it: further out the nearer its point along the coast.)
    const clearOut = (t: number, o: number) => o + Math.max(0, LIGHT_OUT + 30 - o) * (1 - seaStep(40, 110, Math.abs(t - light)));
    // Cruising along the coast and back, out of sight at either end before it turns.
    const cruise = (i: number, kind: BoatKind, v: number, o0: number, scale = 1) => {
      const dir = h(i * 7 + 1) < 0.5 ? 1 : -1, ph = h(i * 7 + 2) * span, sway = 8 + 14 * h(i * 7 + 3), w = 0.02 + 0.03 * h(i * 7 + 4), w0 = h(i * 7 + 5) * 6;
      // (A sailboat holds a little off its course, as if beating along: its heading leans off the
      // line it makes good.)
      const lean = kind === "sailboat" ? (h(i * 7 + 6) < 0.5 ? 0.25 : -0.25) : 0;
      const pos = (t: number, Q: { x: number; z: number }) => {
        const u = ((ph + dir * v * t) % span + span) % span;
        at(lo + u, clearOut(lo + u, o0 + sway * Math.sin(w * t + w0)), Q);
      }, Q = { x: 0, z: 0 };
      this.add(this.boat(kind, BOAT_PAINTS[Math.floor(h(i * 7) * BOAT_PAINTS.length)], scale, v), (t, P) => {
        // (Heading the way it is going, round the lighthouse too; across the wrap at the run's
        // ends, out of sight, along the coast.)
        pos(t, P); pos(t + 0.25, Q);
        const dx = Q.x - P.x, dz = Q.z - P.z;
        P.h = (Math.hypot(dx, dz) < 10 ? Math.atan2(-dz, dx) : headOf(dir * v, sway * w * Math.cos(w * t + w0))) + lean;
      }, kind === "sailboat" ? 0.12 : 0.06);
    };
    // A loop out from the shore and back: out along one line, round, and in along another beside it.
    // (From a stretch of shore clear of the wharf.)
    const W = shoreMoorings(plan).wharf;
    yield;
    const E0 = plan.shore.filter((e) => Math.hypot(e.bx - e.ax, e.bz - e.az) > 25 && (!W || Math.hypot((e.ax + e.bx) / 2 - W.x, (e.az + e.bz) / 2 - W.z) > 90));
    const loop = (i: number, make: () => THREE.Object3D, v: number, n0: number, len: number, wide: number, bob = 0.05) => {
      // (Nor round the lighthouse's rock.)
      const E = E0.filter((e) => {
        const L = Math.hypot(e.bx - e.ax, e.bz - e.az), dx = LP.x - (e.ax + e.bx) / 2, dz = LP.z - (e.az + e.bz) / 2;
        const a = (dx * (e.bx - e.ax) + dz * (e.bz - e.az)) / L, o = dx * e.nx + dz * e.nz;
        return Math.abs(a) > wide / 2 + 18 || o < n0 - wide / 2 - 18 || o > n0 + len + wide / 2 + 18;
      });
      if (!E.length) return;
      const e = E[Math.floor(h(i * 11 + 1) * E.length)], mx = (e.ax + e.bx) / 2, mz = (e.az + e.bz) / 2;
      const L = Math.hypot(e.bx - e.ax, e.bz - e.az), ex = (e.bx - e.ax) / L, ez = (e.bz - e.az) / L, r = wide / 2;
      const per = 2 * len + 2 * Math.PI * r, ph = h(i * 11 + 2) * per;
      this.add(make(), (t, P) => {
        let u = ((ph + v * t) % per + per) % per, out: number, side: number, du: number, ds: number;
        if (u < len) { out = n0 + u; side = r; du = 1; ds = 0; }
        else if ((u -= len) < Math.PI * r) { const a = u / r; out = n0 + len + r * Math.sin(a); side = r * Math.cos(a); du = Math.cos(a); ds = -Math.sin(a); }
        else if ((u -= Math.PI * r) < len) { out = n0 + len - u; side = -r; du = -1; ds = 0; }
        else { const a = (u - len) / r; out = n0 - r * Math.sin(a); side = -r * Math.cos(a); du = -Math.cos(a); ds = Math.sin(a); }
        P.x = mx + e.nx * out + ex * side; P.z = mz + e.nz * out + ez * side;
        const dx = e.nx * du + ex * ds, dz = e.nz * du + ez * ds;
        P.h = Math.atan2(-dz, dx);
      }, bob);
    };
    // (Enough of them that one or two are usually in view: the coast they ply is some 5 km long.)
    const n = port ? 15 : 20;
    for (let i = 0; i < n; i++) {
      yield;
      const sail = h(i * 13 + 9) < (port ? 0.4 : 0.65);
      cruise(i, sail ? "sailboat" : "cruiser", sail ? 2.2 + 1.2 * h(i * 13 + 10) : 4.5 + 3 * h(i * 13 + 10), (port ? 70 : 35) + 140 * h(i * 13 + 11), sail && h(i * 13 + 12) < 0.4 ? 1.5 : 1);
    }
    if (port) {
      // A container ship well out; launches working out past the piers; a car ferry out to sea and
      // back; the wharf and its crane; the boats moored about the harbour.
      const ship = this.ship(true), dir = h(901) < 0.5 ? 1 : -1, ph = h(902) * span, o0 = 230 + 80 * h(903);
      this.add(ship, (t, P) => { const u = ((ph + dir * 3 * t) % span + span) % span; at(lo + u, o0, P); P.h = headOf(dir, 0); }, 0.02);
      yield;
      for (let i = 0; i < 2; i++) { loop(20 + i, () => this.boat("cruiser", BOAT_PAINTS[Math.floor(h(940 + i) * BOAT_PAINTS.length)], 1, 4), 3.5 + h(950 + i), 48, 160 + 120 * h(960 + i), 14); yield; }
      loop(25, () => this.ferry(), 5, 70, 300, 80, 0.03);
      yield;
      if (W) { this.harbour(W); yield; }
      for (const m of shoreMoorings(plan).boats) { this.add(this.boat(m.kind, m.paint, 1, 0), (_t, P) => { P.x = m.x; P.z = m.z; P.h = m.yaw; }, 0.07); yield; }
    } else {
      // Jet skis looping off the beach (in summer, in fair weather, as the umbrellas are out).
      const c = plan.climate, fair = !c || (c.season === "summer" && !/rain|storm|snow|fog/.test(c.weather));
      if (fair) for (let i = 0; i < 2; i++) { loop(30 + i, () => this.boat("jetski", BOAT_PAINTS[Math.floor(h(975 + i) * BOAT_PAINTS.length)], 1, 9), 8 + 3 * h(970 + i), 40, 70 + 60 * h(980 + i), 26); yield; }
      this.edges = plan.shore.slice();
      if (this.edges.length) { this.foam = foamMesh(this.edges.length * 2, this.surface); this.world.add(this.foam); }
    }
  }
  private add(obj: THREE.Object3D, way: Way, bob: number) { this.movers.push({ obj, way, bob }); this.world.add(obj); }
  private keep(obj: THREE.Object3D) { this.statics.push(obj); this.world.add(obj); }
  // A mesh of `b` in the sea's material, with `l`'s lights on it (if any).
  private meshOf(b: Batch, l?: Batch): THREE.Object3D {
    const g = new THREE.Group(), m = b.build(this.surface), lm = l?.build(this.lights);
    if (m) g.add(m);
    if (lm) g.add(lm);
    return g;
  }

  // A boat, its middle on the waterline at the origin, bow along +x: under way (v > 0), its wake, a
  // pale wedge spreading behind it (longer the faster it goes), and its running lights, a white one
  // at its masthead (or top) and at its stern, red to port and green to starboard. (Moored, none.)
  private boat(kind: BoatKind, paint: number, scale: number, v: number): THREE.Object3D {
    const b = new Batch(), l = new Batch();
    boatAt(b, kind, 0, 0, 0, 0, paint, { scale });
    const { len, beam } = boatSize(kind, { scale }), { hi } = boatExtent(kind, { scale });
    if (v > 0) {
      const k = Math.min(1, v / 6), back = len * 0.5 + 6 + 18 * k, w = 1.2 + 4 * k;
      b.tri(-len * 0.4, 0.02, -0.4, -back, 0.02, -w, -back, 0.02, w, FOAM);
      b.tri(-len * 0.4, 0.02, -0.4, -back, 0.02, w, -len * 0.4, 0.02, 0.4, FOAM);
    }
    const s = Math.max(0.12, 0.05 * len);
    if (v > 0) l.box(0, hi + s, 0, s, s, s, WHITE_LIGHT);
    if (v > 0 && kind !== "rowboat" && kind !== "canoe" && kind !== "kayak") {
      const y = Math.min(hi, 1.2 * scale);
      l.box(len * 0.3, y, -beam * 0.42, s, s, s, RED_LIGHT); l.box(len * 0.3, y, beam * 0.42, s, s, s, GREEN_LIGHT);
      l.box(-len * 0.45, y, 0, s, s, s, WHITE_LIGHT);
    }
    return this.meshOf(b, l);
  }
  // A container ship: a long dark hull, its bridge aft, rows of containers forward; its windows lit
  // after dark; under way, its wake and running lights at its masts and sides.
  private ship(underWay: boolean): THREE.Object3D {
    const b = new Batch(), l = new Batch(), L = SHIP_L, B = SHIP_B;
    b.box(0, 1.2, 0, L, 5.4, B, 0x1f2e45);
    b.box(0, -1.2, 0, L + 0.2, 0.6, B + 0.2, 0x8a2a22);   // (the boot-top at the waterline)
    b.box(L / 2 + 2, 1.6, 0, 4, 4.6, B * 0.6, 0x1f2e45);   // (the bow)
    b.box(-L / 2 + 6, 7.5, 0, 9, 7.5, B - 2, 0xf1f0ea);
    b.box(-L / 2 + 6, 11.6, 0, 11, 0.8, B, 0xf1f0ea);
    b.box(-L / 2 + 3, 13.2, 0, 2, 3.5, 2, 0xc0392b);
    b.box(L / 2 - 4, 7, 0, 0.4, 8, 0.4, 0xd8d8d8);   // (the foremast)
    const cols = [0xc0392b, 0x2a7fd4, 0x2e9a5a, 0xe8701a, 0x8a8f96, 0xd4a017];
    for (let x = -L / 2 + 14; x < L / 2 - 6; x += 6.4) for (let r = 0; r < 4; r++) for (let tier = 0; tier < 2; tier++)
      b.box(x, 4.6 + tier * 2.6, -B / 2 + 1.7 + r * 3.2, 6.1, 2.5, 2.9, cols[Math.floor(hash2(Math.round(x), r, tier, 0x5c1) * cols.length)]);
    if (underWay) {
      b.tri(-L / 2 - 2, 0.02, -B / 2, -L / 2 - 60, 0.02, -B, -L / 2 - 60, 0.02, B, FOAM);
      b.tri(-L / 2 - 2, 0.02, -B / 2, -L / 2 - 60, 0.02, B, -L / 2 - 2, 0.02, B / 2, FOAM);
    }
    for (const side of [-1, 1]) for (let row = 0; row < 3; row++) for (let k = 0; k < 4; k++)
      l.box(-L / 2 + 2.6 + k * 2.3, 5.2 + row * 2.1, side * ((B - 2) / 2 + 0.03), 1.2, 0.6, 0.05, WINDOW);
    for (let k = 0; k < 4; k++) l.box(-L / 2 + 10.6 + 0.03, 5.2 + Math.floor(k / 2) * 2.1, (k % 2 ? 1 : -1) * 1.6, 0.05, 0.6, 1.2, WINDOW);
    if (underWay) {
      l.box(L / 2 - 4, 11.2, 0, 0.4, 0.4, 0.4, WHITE_LIGHT); l.box(-L / 2 + 3, 15.2, 0, 0.4, 0.4, 0.4, WHITE_LIGHT);
      l.box(-L / 2 + 6, 11.9, -B / 2 - 0.1, 0.4, 0.4, 0.2, RED_LIGHT); l.box(-L / 2 + 6, 11.9, B / 2 + 0.1, 0.4, 0.4, 0.2, GREEN_LIGHT);
    }
    return this.meshOf(b, l);
  }
  // The car ferry (countryworld.ts's), its waterline brought up to the origin.
  private ferry(): THREE.Object3D {
    const b = new Batch(), l = new Batch();
    ferryModel(b, b, l);
    const g = this.meshOf(b, l);
    g.children.forEach((c) => (c as THREE.Mesh).geometry.translate(0, WATER_DROP - 0.03, 0));
    return g;
  }

  // A lighthouse on a rock off the point of the town's headland (where the sea comes in least along
  // its side of town), white with red bands; its lantern lit after dark, its beam sweeping round.
  // Where along the coast it stands (t).
  private lighthouse(plan: CityPlan, at: (t: number, o: number, P: { x: number; z: number }) => void): number {
    const O = plan.outline, ew = O.sea === 0 || O.sea === 2, t0 = ew ? O.Z0 : O.X0, t1 = ew ? O.Z1 : O.X1;
    let best = t0, bs = Infinity;
    // (Clear of a port's wharf, its ship and its cranes' booms reaching out over the water.)
    const W = shoreMoorings(plan).wharf, wt = W ? (ew ? W.z : W.x) : NaN;
    for (let t = t0 + 120; t <= t1 - 120; t += 10) {
      if (Math.abs(t - wt) < SHIP_L / 2 + 40) continue;
      const sh = O.shore(t); if (sh < bs) { bs = sh; best = t; }
    }
    const P = { x: 0, z: 0 };
    at(best, LIGHT_OUT, P);
    const b = new Batch(), l = new Batch(), y0 = SEA_TOP;
    b.ico(P.x, y0, P.z, 10, 0x7a746a, 0.45, 0.3); b.ico(P.x + 4, y0, P.z - 3, 6, 0x8a8478, 0.5, 1.2);
    for (let k = 0; k < 4; k++) b.cyl(P.x, y0 + 3 + 4 * k + 2, P.z, 1.6 - 0.12 * k, 4, k % 2 ? 0xc0392b : 0xf2f0ea, 12);
    b.cyl(P.x, y0 + 19.2, P.z, 2.2, 0.35, 0x2b2d31, 12);
    b.cyl(P.x, y0 + 20.6, P.z, 1.15, 2.4, 0x3a4a5a, 10);
    b.cyl(P.x, y0 + 22.2, P.z, 1.4, 0.8, 0xc0392b, 10);
    l.box(P.x, y0 + 20.6, P.z, 1.6, 1.6, 1.6, WHITE_LIGHT);
    this.keep(this.meshOf(b, l));
    // (The beam: two long pale blades crossing at the lantern, turned round it.)
    const k = new Batch();
    for (const sd of [-1, 1]) { k.tri(0, 0, 0, sd * 70, -2, -2.5, sd * 70, 2.5, 0, 0xfff2c8); k.tri(0, 0, 0, sd * 70, 2.5, 0, sd * 70, -2, 2.5, 0xfff2c8); }
    const beam = k.build(this.lights)!;
    beam.position.set(P.x, y0 + 20.6, P.z);
    this.beam = beam; this.keep(beam);
    return best;
  }

  // A port's container wharf (city.ts shoreMoorings): a deck on piles out from the quay, a ship
  // moored alongside, and two cranes straddling the deck, working boxes between them.
  private harbour(W: { x: number; z: number; nx: number; nz: number; ex: number; ez: number; len: number }) {
    this.wharf = W;
    const b = new Batch(), l = new Batch(), yaw = Math.atan2(-W.ez, W.ex), top = CURB_H - 0.02, D = 16;
    const pt = (a: number, n: number): [number, number] => [W.x + W.ex * a + W.nx * n, W.z + W.ez * a + W.nz * n];
    let [x, z] = pt(0, D / 2);
    b.box(x, top - 0.2, z, W.len, 0.4, D, 0x8f8b82, yaw);
    for (let a = -W.len / 2 + 2; a <= W.len / 2 - 2; a += 6) for (let n = 2; n <= D; n += 7) { [x, z] = pt(a, n); b.cyl(x, (SEA_Y - 0.3 + top - 0.4) / 2, z, 0.3, top - 0.4 - SEA_Y + 0.3, 0x4a4a46, 6); }
    for (const n of [2, 14]) { [x, z] = pt(0, n); b.box(x, top + 0.04, z, W.len, 0.08, 0.3, 0x5a5a58, yaw); }   // (the crane rails)
    // (Boxes parked on the deck, clear of where the cranes set theirs down: n 6 to 9 under each.)
    for (const [a, n, c] of [[-14.5, 6, 0x2a7fd4], [-14.5, 9, 0xe8701a], [15, 4, 0x2e9a5a], [15, 11.5, 0xc0392b]] as const) { [x, z] = pt(a, n); b.box(x, top + 1.3, z, 6.1, 2.5, 2.9, c, yaw); }
    for (const ca of [-6, 10]) {
      // A crane: four legs on the rails, beams across, a boom out over the ship, its house aft.
      for (const da of [-5, 5]) for (const n of [2, 14]) { [x, z] = pt(ca + da, n); b.box(x, top + 15, z, 0.9, 30, 0.9, 0xd8a01c, yaw); }
      for (const n of [2, 14]) { [x, z] = pt(ca, n); b.box(x, top + 26, z, 10.9, 1, 1, 0xd8a01c, yaw); b.box(x, top + 1.5, z, 10.9, 0.8, 0.9, 0xd8a01c, yaw); }
      for (const da of [-2, 2]) { [x, z] = pt(ca + da, 15); b.box(x, top + 31, z, 1, 1.2, 54, 0xd8a01c, yaw); }
      [x, z] = pt(ca, -6); b.box(x, top + 32.5, z, 4.96, 3, 6, 0xe8e6de, yaw);   // (its sides 2 cm inside the boom girders' outer faces: shared planes flicker)
      [x, z] = pt(ca, 42); l.box(x, top + 31.8, z, 0.5, 0.5, 0.5, RED_LIGHT);
      const part = (bb: Batch) => { const g = bb.build(this.surface)!; this.world.add(g); return g; };
      const tb = new Batch(); tb.box(0, 0, 0, 5, 1.6, 2.4, 0x5a5a58);
      const cb = new Batch(); cb.box(-0.8, -0.5, 0, 0.08, 1, 0.08, 0x2b2d31); cb.box(0.8, -0.5, 0, 0.08, 1, 0.08, 0x2b2d31);
      const sb = new Batch(); sb.box(0, 0.25, 0, 6.2, 0.5, 2.6, 0xd8a01c);
      const xb = new Batch(); xb.box(0, 1.25, 0, 6.1, 2.5, 2.9, [0x8a8f96, 0xd4a017, 0x2a7fd4][Math.abs(ca) % 3]);
      const c: Crane = { a: ca, trolley: part(tb), cable: part(cb), spreader: part(sb), box: part(xb) };
      for (const o of [c.trolley, c.cable, c.spreader, c.box]) o.rotation.y = yaw;
      this.cranes.push(c);
    }
    this.keep(this.meshOf(b, l));
    // (The ship alongside, riding a little.)
    const ship = this.ship(false), [sx, sz] = pt(2, D + 1 + SHIP_B / 2);
    this.add(ship, (_t, P) => { P.x = sx; P.z = sz; P.h = yaw; }, 0.02);
  }
  // Where each crane's trolley, spreader and box are at time t: every 40 s a box goes over, from
  // the ship's deck to the wharf or (the next time) back: the trolley runs out over the one, the
  // spreader comes down, lifts the box, the trolley runs back over the other and sets it down.
  private craneAt(c: Crane, time: number) {
    const W = this.wharf!, top = CURB_H - 0.02, CYC = 40, k = Math.floor((time + c.a * 3) / CYC), u = ((time + c.a * 3) / CYC) - k;
    const nShip = 16 + 1 + SHIP_B / 2, nWharf = 7.5, yShip = SEA_TOP + 8.5, yWharf = top, yHigh = top + 26;
    const fromShip = k % 2 === 0, n0 = fromShip ? nShip : nWharf, n1 = fromShip ? nWharf : nShip, y0 = fromShip ? yShip : yWharf, y1 = fromShip ? yWharf : yShip;
    const e = (x: number) => x * x * (3 - 2 * x), seg = (a: number, b: number) => e(Math.max(0, Math.min(1, (u - a) / (b - a))));
    // (Out to the box, down, up with it, across, down, up again; then a rest.)
    let n = n1 + (n0 - n1) * seg(0, 0.15), sy = yHigh + (y0 + 2.6 - yHigh) * seg(0.15, 0.27), carry = u >= 0.27 && u < 0.67, bx = n0, by = y0;
    if (u >= 0.27) sy = (y0 + 2.6) + (yHigh - y0 - 2.6) * seg(0.27, 0.39);
    if (u >= 0.39) n = n0 + (n1 - n0) * seg(0.39, 0.55);
    if (u >= 0.55) sy = yHigh + (y1 + 2.6 - yHigh) * seg(0.55, 0.67);
    if (u >= 0.67) { sy = (y1 + 2.6) + (yHigh - y1 - 2.6) * seg(0.67, 0.79); bx = n1; by = y1; }
    if (carry) { bx = n; by = sy - 2.6; }
    const pt = (a: number, nn: number, y: number, o: THREE.Object3D) => o.position.set(W.x + W.ex * a + W.nx * nn, y, W.z + W.ez * a + W.nz * nn);
    pt(c.a, n, top + 30, c.trolley);
    pt(c.a, n, top + 29.2, c.cable); c.cable.scale.y = Math.max(0.1, top + 29.2 - (sy + 0.5));
    pt(c.a, n, sy, c.spreader);
    pt(c.a, bx, by, c.box);
  }

  // Where everything is at journey time `time`.
  update(time: number) {
    const P = this.p;
    (this.lights as THREE.MeshBasicMaterial).visible = LAMPS_ON.value > 0.05;
    for (let i = 0; i < this.movers.length; i++) {
      const m = this.movers[i];
      m.way(time, P);
      m.obj.position.set(P.x, SEA_TOP + m.bob * Math.sin(time * 1.3 + i * 1.7), P.z);
      m.obj.rotation.set(m.bob * 0.6 * Math.sin(time * 1.1 + i), P.h, 0, "YXZ");
    }
    if (this.beam) this.beam.rotation.y = time * 0.9;
    for (const c of this.cranes) this.craneAt(c, time);
    if (this.foam) this.surf(time);
  }

  // The surf: two lines of foam on each stretch of beach, washing up the sand and back, each lying
  // on whichever is higher, the sand or the sea.
  private surf(time: number) {
    const g = this.foam!.geometry, pos = g.getAttribute("position") as THREE.BufferAttribute, a = pos.array as Float32Array;
    const sandY = (w: number) => CURB_H - 0.02 + (SEA_Y - 0.25 - CURB_H + 0.02) * (w / BEACH_W);
    const y = (w: number) => Math.max(sandY(w), SEA_TOP) + 0.03;
    let o = 0;
    for (const e of this.edges) for (let k = 0; k < 2; k++) {
      // (Up the beach and back every 7 s or so, the second line half a wave behind.)
      const ph = time * 0.9 + k * Math.PI + (e.ax + e.az) * 0.004, c = 15.2 + 1.7 * Math.sin(ph), w0 = c - 0.6, w1 = c + 0.6 + 0.4 * k;
      const q = [[e.ax + e.nx * w0, y(w0), e.az + e.nz * w0], [e.bx + e.nx * w0, y(w0), e.bz + e.nz * w0], [e.bx + e.nx * w1, y(w1), e.bz + e.nz * w1], [e.ax + e.nx * w1, y(w1), e.az + e.nz * w1]];
      // (Wound to face up, whichever way round the edge runs.)
      const up = (e.bz - e.az) * e.nx - (e.bx - e.ax) * e.nz > 0;
      for (const v of up ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) { a[o++] = q[v][0]; a[o++] = q[v][1]; a[o++] = q[v][2]; }
    }
    pos.needsUpdate = true;
    g.computeBoundingSphere();
  }
}

// A material that fogs out over 2.5 times the land's distance (engine.ts measures fog by distance
// from each vertex): the sea and what is on it, seen out past where the town is built.
function farFog<M extends THREE.Material>(m: M): M {
  const prev = m.onBeforeCompile.bind(m), prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, r) => {
    prev(shader, r);
    shader.vertexShader = shader.vertexShader.replace("#include <fog_vertex>", "#ifdef USE_FOG\n\tvFogDepth = 0.4 * length( mvPosition.xyz );\n#endif");
  };
  m.customProgramCacheKey = () => prevKey() + "|farFog";
  return m;
}
// The surf's mesh: `n` quads, filled in each frame (sealife's surf), white.
function foamMesh(n: number, m: THREE.Material): THREE.Mesh {
  const g = new THREE.BufferGeometry(), v = n * 6;
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(v * 3), 3));
  const nrm = new Float32Array(v * 3), col = new Float32Array(v * 3), c = new THREE.Color(FOAM);
  for (let i = 0; i < v; i++) { nrm[i * 3 + 1] = 1; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  return mesh;
}
