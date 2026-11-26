// A city laid out by the generator (drafting only: docs/long-day-cities.md): the scene's CityPlan
// with no city file, its streets laid out from its seed (citygen.ts) and cut back to its outline
// (outlinegen.ts), its freeway, sea and layout by the rules here. tools/draftcities.ts writes one
// out as a city file (cityfiles.ts cityFileOfPlan), which is all the scene reads.
import { at0, CITY_HI, CITY_LO, CityPlan, GATE_SLOTS, ROUND_NAMES } from "../src/city.ts";
import type { Gate } from "../src/city.ts";
import { CityGraph } from "../src/citygraph.ts";
import { cableColumn, elevatedLine } from "../src/decor.ts";
import { DEBUG_LAYOUT, DEBUG_ONEWAY } from "../src/debug.ts";
import { streetNameEW, streetNameNS } from "../src/facilities.ts";
import { FW_STRAIGHT } from "../src/freeway.ts";
import type { FwCurve } from "../src/freeway.ts";
import { BLOCK, STREET } from "../src/grid.ts";
import { hash2 } from "../src/rng.ts";
import type { ExitKind } from "../src/route.ts";
import type { Steps } from "../src/slices.ts";
import type { CityOutline } from "../src/outline.ts";
import { cityGraphSteps, trimToOutlineSteps } from "./citygen.ts";
import type { OrganicAvenue } from "./citygen.ts";
import { entryGateOf, ruleSeaSide, TrimOutline } from "./outlinegen.ts";
import { freewayCurveOf, ruleFreewayGate, ruleFreewayMerge } from "./freewaygen.ts";

export class GeneratedPlan extends CityPlan {
  private organicFailed = false;   // (an organic town was tried and lost a gate: see graph)
  private avs: OrganicAvenue[] | null = null;
  // The layout, cut back to its outline, with its all-way stops.
  protected *generate(): Steps<CityGraph> { const G = yield* this.buildGraph(); this.stopSigns(G); return G; }
  // The town's outline as the generator lays it out (outlinegen.ts): its sea, and its land's edges
  // standing in `scale` as far as drawn (trimToOutline's retries), or with no sea at all.
  protected outlineAt(scale: number, seaOff = false): CityOutline {
    const rows: number[] = [], cols: number[] = [];
    for (let k = CITY_LO; k <= CITY_HI + 1; k++) { if (elevatedLine(this.style, k)) rows.push(k); if (this.style.cableCar && cableColumn(k)) cols.push(k); }
    // (And where an organic town's freeway leaves it, round its curve.)
    const C = this.fwCurve;
    if (C) { if (C.dx) rows.push(Math.round((C.ez - STREET / 2) / BLOCK)); else cols.push(Math.round((C.ex - STREET / 2) / BLOCK)); }
    return new TrimOutline(this.seed, this.style, { freeway: this.freeway, straightRows: rows, straightCols: cols, insetScale: scale, seaOff });
  }
  // How the outline was cut (the city file's `outline`).
  get outlineCut(): { scale: number; seaOff: boolean } { const O = this.outline as TrimOutline; return { scale: O.insetScale, seaOff: O.seaOff }; }
  // How this city's streets are laid out (citygen.ts): the old square grid, one bent out of square,
  // or an organic town, by the style's odds. An organic town only where its freeway, if it has
  // one, can curve through it (freewaygen.ts freewayCurveOf: the grid kept round its interchange).
  get layout(): "grid" | "warp" | "organic" {
    const organicOk = (!this.freeway || !!this.fwCurveOf()) && !this.organicFailed;
    if (DEBUG_LAYOUT === "grid" || DEBUG_LAYOUT === "warp") return DEBUG_LAYOUT;
    if (DEBUG_LAYOUT.startsWith("organic")) return organicOk ? "organic" : "warp";
    if (DEBUG_LAYOUT === "river" || DEBUG_LAYOUT === "round") return "warp";
    const L = this.style.layouts, o = organicOk ? L.organic : 0, r = hash2(this.seed, 0x1a7, 0, 0) * (L.grid + L.warp + o);
    return r < o ? "organic" : r < o + L.warp ? "warp" : "grid";
  }
  private fwGate: Gate | null | undefined;
  get freeway(): Gate | null { if (this.fwGate === undefined) this.fwGate = ruleFreewayGate(this.seed, this.style); return this.fwGate; }
  get freewayMerge(): boolean { return !!this.freeway && ruleFreewayMerge(this.seed); }
  protected exitKind(): ExitKind { return hash2(this.seed, 0x5e7, 0, 0x1c) < 0.5 ? "helix" : "slip"; }
  protected fwCurveOf(): FwCurve | null { if (this.fwc === undefined) this.fwc = this.freeway ? freewayCurveOf(this.seed, this.freeway, GATE_SLOTS, ruleSeaSide(this.seed, this.style) !== null) : null; return this.fwc; }

  // All-way stops: in every town, most junctions of three or more streets that lie wholly among
  // houses and parks have stop signs instead of lights (not one at a gate, nor on a roundabout,
  // nor where an elevated line, cable car or freeway runs).
  private stopSigns(G: CityGraph) {
    const gateNodes = new Set(G.gates.flatMap((g) => (g ? [g.node] : [])));
    for (const N of G.nodes) {
      if (N.control !== "signal" || N.arms.length < 3 || gateNodes.has(N.id)) continue;
      let quiet = true;
      for (const a of N.arms) {
        const st = G.streets[a.street], t = st.tags;
        if (!st.inCity || st.oneway || t.elevated || t.cable || t.freeway) { quiet = false; break; }
        for (const f of [a.street * 2 + a.end, (a.street * 2 + a.end) ^ 1]) {
          const b = G.faceBlock[f];
          if (b < 0) continue;
          const B = G.blocks[b], d = this.district(B.kx, B.kz);
          if (B.water || (d !== "residential" && d !== "park")) { quiet = false; break; }
        }
        if (!quiet) break;
      }
      if (quiet && hash2(N.kx, N.kz, this.seed, 0x5709) < 0.7) { N.control = "stop"; N.phases = 1; N.phaseOf.fill(0); }
    }
  }
  // The layout over the whole square (buildLayout), cut back to the town's outline (outline.ts,
  // citygen.ts trimToOutline): with the land's edges as drawn, then half as far in, then square;
  // and if even that fails (it shouldn't), the whole square and no sea.
  private *buildGraph(): Steps<CityGraph> {
    const L = yield* this.buildLayout();
    for (const sc of [1, 0.5, 0]) {
      yield;
      const O = this.outlineAt(sc) as TrimOutline, T = yield* trimToOutlineSteps(L, O, this.entryGate, this.seed);
      if (T) { this.ol = O; return this.g = T; }
    }
    // (Laid out again without the sea: the districts by the shore, and the layout's streets
    // round them, asked shoreLine.)
    this.ol = this.shoreOl = this.outlineAt(0, true);
    return this.g = yield* this.buildLayout();
  }
  private *buildLayout(): Steps<CityGraph> {
    let river: number | undefined;
    const opts = { lo: CITY_LO, hi: CITY_HI, gates: [this.entryGate], slots: GATE_SLOTS, nameEW: streetNameEW, nameNS: streetNameNS,
      elevatedRow: (iz: number) => elevatedLine(this.style, iz), cableColumn: (ix: number) => !!this.style.cableCar && cableColumn(ix),
      oneway: (ix: number, iz: number, ew: boolean) => this.oneWayDir(ix, iz, ew, river) };
    // (An organic town that could not put a junction at its way in is laid out warped instead.)
    if (this.layout === "organic") {
      // (A river through town in the same styles and odds as a warped one's, and roundabouts as
      // often as a warped town has circuses.)
      const h = (salt: number) => hash2(this.seed, 0x1a7, 0, salt), f = (k: number) => hash2(this.seed, 0xf10, 0, k);
      const river = DEBUG_LAYOUT === "organicRiver" || (DEBUG_LAYOUT !== "organicRound" && this.riverStyle && h(3) < 0.5);
      const nr = DEBUG_LAYOUT === "organicRound" ? 2 : f(11) < 0.6 ? (f(12) < 0.4 ? 2 : 1) : 0, names = ROUND_NAMES;
      const r0 = Math.floor(f(13) * names.length), rounds = Array.from({ length: nr }, (_, i) => names[(r0 + i) % names.length]);
      const SL = this.shoreLine, sea = SL.sea === null ? undefined : { side: SL.sea, inSea: (x: number, z: number) => SL.inSea(x, z) };
      const avenues = this.avenues, fw = this.fwRoute();
      // (Its points: each block's moved up to 40% of a block either way, then evened out; none in
      // the grid's patch round a freeway's interchange. Its roundabouts' candidate places, well
      // inside town: citygen.ts keeps the first clear of everything.)
      const P = fw?.patch, inP = (bx: number, bz: number) => !!P && at0(bx) + BLOCK / 2 > P.x0 && at0(bx) + BLOCK / 2 < P.x1 && at0(bz) + BLOCK / 2 > P.z0 && at0(bz) + BLOCK / 2 < P.z1;
      const og = yield* cityGraphSteps(opts, this.seed, { river: river && !fw,   /* (with avenues too: one crossing it always does on a bridge) */ sea, avenues: fw ? [fw.avenue, ...avenues] : avenues,   /* (the freeway's laid first: the others keep off its streets) */ patch: P, cuts: this.slipCuts(),
        move: (bx, bz) => inP(bx, bz) ? [0, 0] : [(hash2(bx, bz, this.seed, 0x0a1) - 0.5) * BLOCK * 0.8, (hash2(bx, bz, this.seed, 0x0a2) - 0.5) * BLOCK * 0.8],
        relax: (bx, bz) => (inP(bx, bz) ? 0 : 1), rounds: fw ? [] : rounds });
      if (og.gates.length === 1 && this.avenuesWhole(og)) return og;
      this.organicFailed = true;
      yield;
    }
    const cuts = this.slipCuts();
    if (this.layout === "grid") return yield* cityGraphSteps(opts, this.seed, { cuts });
    // A river across town, in some styles: a row of blocks clear of the freeway's line, elevated
    // lines and gate rows.
    if (this.riverStyle || DEBUG_LAYOUT === "river") {
      const rows = [];
      // (Nor along the shore of a sea to the north or south, which it would run beside: a couple of
      // blocks clear of it. One to the east or west it runs out into: its mouth, below.)
      const SL = this.shoreLine, alongShore = (iz: number) => (SL.sea === 1 || SL.sea === 3) && Array.from({ length: CITY_HI - CITY_LO + 1 }, (_, k) => CITY_LO + k).some((bx) => SL.nearShore(bx, iz, 2.5));
      for (let iz = CITY_LO + 2; iz <= CITY_HI - 2; iz++) if (!alongShore(iz) && ![iz, iz + 1].some((r) => opts.elevatedRow(r) || GATE_SLOTS.some((g) => (g.dir === 0 || g.dir === 2) && g.iz === r) || (this.freeway && (this.freeway.dir === 0 || this.freeway.dir === 2) && Math.abs(this.freeway.iz - r) <= 1))) rows.push(iz);
      if (rows.length && (DEBUG_LAYOUT === "river" || hash2(this.seed, 0x1a7, 0, 3) < 0.5)) river = rows[Math.floor(hash2(this.seed, 0x1a7, 0, 4) * rows.length)];
    }
    // Kept straight: the freeway's line and the blocks either side of it (its off-ramp's), and the
    // elevated and cable-car lines.
    const fw = this.freeway, onFw = (ix: number, iz: number) => !!fw && (fw.dir === 0 || fw.dir === 2 ? Math.abs(iz - fw.iz) <= 1 : Math.abs(ix - fw.ix) <= 1);
    const straight = (ix: number, iz: number) => onFw(ix, iz) || opts.elevatedRow(iz) || opts.cableColumn(ix);
    const h = (salt: number) => hash2(this.seed, 0x1a7, 0, salt);
    const fl = this.flourishes(straight, river);
    // A warped town: each block's point moved by smooth noise (more in the old town, less among
    // industry, whose plots want depth), and bowed with the sweep, faded in from the edge; none
    // beside what is kept straight (the freeway's line and two rows of blocks either side, where its
    // interchange stands; the elevated and cable-car lines), so those lines and their junctions lie
    // exactly on the grid's. Its flourishes, parks, river and dropped streets laid on the cells.
    const J = 5 + 5 * h(1), sw = fl.sweep, ot = fl.oldTown, seed = this.seed;
    const nz = (xx: number, zz: number, salt: number) => {
      const gx = xx / 3, gz = zz / 3, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
      const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz), hh = (a: number, b: number) => hash2(a, b, seed, salt) * 2 - 1;
      const p = hh(ix, iz) + (hh(ix + 1, iz) - hh(ix, iz)) * sx, q = hh(ix, iz + 1) + (hh(ix + 1, iz + 1) - hh(ix, iz + 1)) * sx;
      return (p + (q - p) * sz) * 0.6 + (hash2(xx, zz, seed, salt + 1) * 2 - 1) * 0.4;
    };
    const fixedB = (bx: number, bz: number) => (!!fw && (fw.dir === 0 || fw.dir === 2 ? bz >= fw.iz - 2 && bz <= fw.iz + 1 : bx >= fw.ix - 2 && bx <= fw.ix + 1))
      || opts.elevatedRow(bz) || opts.elevatedRow(bz + 1) || opts.cableColumn(bx) || opts.cableColumn(bx + 1);
    const inset = (bx: number, bz: number) => Math.min(1, (Math.min(bx - CITY_LO, CITY_HI - bx, bz - CITY_LO, CITY_HI - bz) + 0.5) / 3);
    const move = (bx: number, bz: number): [number, number] => {
      if (fixedB(bx, bz)) return [0, 0];
      const d = ot ? Math.hypot(bx + 0.5 - ot.ix, bz + 0.5 - ot.iz) / ot.r : 9, amp = J * (1 + 1.4 * Math.max(0, Math.min(1, (1.3 - d) / 0.5))) * (this.district(bx, bz) === "industrial" ? 0.3 : 1);
      let dx = nz(bx, bz, 0x5e1) * amp, dz = nz(bx, bz, 0x5e2) * amp;
      if (sw) { const k = inset(bx, bz) * sw.bow; dx += Math.sin(((bz + 0.5) / sw.wave) * Math.PI * 2 + seed % 7) * k; dz += Math.sin(((bx + 0.5) / sw.wave) * Math.PI * 2 + (seed >> 3) % 7) * k * 0.6; }
      return [dx, dz];
    };
    const li = (v: number) => (v - STREET / 2) / BLOCK, SLs = this.shoreLine;
    const seaW = SLs.sea === null ? undefined : { side: SLs.sea, inSea: (xx: number, zz: number) => SLs.inSea(xx, zz) };
    return yield* cityGraphSteps(opts, seed, { move, cuts, sea: seaW,
      riverLine: river === undefined ? undefined : [[at0(CITY_LO), at0(river) + BLOCK / 2], [at0(CITY_HI + 1), at0(river) + BLOCK / 2]],
      // (The river runs west to east: across a freeway coming in from the north or south, and its
      // band either side, and across a cable car's column, always on a bridge.)
      bridge: (mx, mz) => { const ix = Math.round(li(mx)), iz = Math.round(li(mz)); return onFw(ix, iz) || opts.cableColumn(ix); },
      parks: this.superParks(straight, river, fl.circuses), diagonals: fl.diagonals,
      rings: fl.circuses.map((c) => ({ x: at0(c.ix), z: at0(c.iz), name: c.name, n: c.round ? 4 : 8, r: c.round ? 30 : 45, oneway: !!c.round, arms: 8 })),
      drop: {
        // (Industry's plots are big: between two of its blocks, a street is left out half the time.)
        p: (mx, mz, ew) => { const ix = Math.floor(li(mx)), iz = Math.round(li(mz)), jx = Math.round(li(mx)), jz = Math.floor(li(mz)); return 0.05 + 0.1 * h(2) + ((ew ? [[ix, iz - 1], [ix, iz]] : [[jx - 1, jz], [jx, jz]]).every(([bx, bz]) => this.district(bx, bz) === "industrial") ? 0.45 : 0); },
        // (Never along the freeway's line, its band's streets, the elevated or cable lines.)
        keep: (ax, az, bx, bz) => { const ew = Math.abs(bx - ax) > Math.abs(bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2, ix = Math.round(li(mx)), iz = Math.round(li(mz));
          return !(ew ? opts.elevatedRow(iz) : opts.cableColumn(ix)) && !onFw(Math.round(li(ax)), Math.round(li(az))) && !onFw(Math.round(li(bx)), Math.round(li(bz))); },
      } });
  }
  // Whether the town's style may have a river through it (in half its towns, warped or organic).
  private get riverStyle(): boolean { return this.style.id === "port" || this.style.id === "brick" || this.style.id === "coastal"; }
  // One-way streets downtown, in about two cities in three: between two downtown blocks, each
  // lattice line one way, the next the other (as downtown grids are), clear of the gate streets'
  // lines, the elevated and cable-car lines, the freeway's line and the river's quays. +1: driven
  // east or south, -1 the other way, 0 two-way (cityGraph decides which it keeps).
  get oneWays(): boolean { return DEBUG_ONEWAY === "all" || (DEBUG_ONEWAY !== "none" && hash2(this.seed, 0x1e7a, 0, 1) < 0.65); }
  private oneWayDir(ix: number, iz: number, ew: boolean, river: number | undefined): number {
    if (!this.oneWays) return 0;
    const sides = ew ? [[ix, iz - 1], [ix, iz]] : [[ix - 1, iz], [ix, iz]];
    if (!sides.every(([bx, bz]) => this.district(bx, bz) === "downtown")) return 0;
    if (ew ? elevatedLine(this.style, iz) || GATE_SLOTS.some((g) => (g.dir === 0 || g.dir === 2) && g.iz === iz) : (!!this.style.cableCar && cableColumn(ix)) || GATE_SLOTS.some((g) => (g.dir === 1 || g.dir === 3) && g.ix === ix)) return 0;
    const fw = this.freeway;
    if (fw && (ew ? (fw.dir === 0 || fw.dir === 2) && Math.abs(iz - fw.iz) <= 1 : (fw.dir === 1 || fw.dir === 3) && Math.abs(ix - fw.ix) <= 1)) return 0;
    if (river !== undefined && ew && (iz === river || iz === river + 1)) return 0;
    return ((ew ? iz : ix) & 1) === 0 ? 1 : -1;
  }
  // A superblock park or two (four blocks each, the streets between them gone), clear of
  // whatever is kept straight, the river, the gates and the city's edge.
  private superParks(straight: (ix: number, iz: number) => boolean, river: number | undefined, circuses: { ix: number; iz: number }[]): [number, number][] {
    const out: [number, number][] = [], n = Math.floor(hash2(this.seed, 0x1a7, 0, 5) * 3);
    for (let k = 0; k < 40 && out.length < n; k++) {
      const px = CITY_LO + 2 + Math.floor(hash2(k, 1, this.seed, 0x5b1) * (CITY_HI - CITY_LO - 4)), pz = CITY_LO + 2 + Math.floor(hash2(k, 2, this.seed, 0x5b1) * (CITY_HI - CITY_LO - 4));
      let ok = true;
      for (let x = px; x <= px + 2 && ok; x++) for (let z = pz; z <= pz + 2 && ok; z++) if (straight(x, z) || GATE_SLOTS.some((g) => g.ix === x || g.iz === z)) ok = false;
      if (river !== undefined && pz <= river + 1 && pz + 2 >= river) ok = false;
      if (out.some(([x, z]) => Math.abs(x - px) < 4 && Math.abs(z - pz) < 4)) ok = false;
      if (circuses.some((c) => c.ix >= px - 2 && c.ix <= px + 4 && c.iz >= pz - 2 && c.iz <= pz + 4)) ok = false;
      if (ok) out.push([px, pz]);
    }
    return out;
  }
  // A warped city's larger moves (citygen.ts): a diagonal avenue or two across town, an old town
  // of crooked streets, long avenues bowed into curves; each by chance, from the seed. Diagonals
  // keep clear of what stays straight, the river and the gates, and cross no other.
  private flourishes(straight: (ix: number, iz: number) => boolean, river: number | undefined) {
    const h = (k: number) => hash2(this.seed, 0xf10, 0, k), span = CITY_HI - CITY_LO;
    const diagonals: { ix: number; iz: number; dx: number; dz: number; n: number; name: string }[] = [], used = new Set<string>();
    // A circus or two first: a node whose whole neighbourhood is free to bend, its four blocks
    // kept off the diagonals.
    // (Some are roundabouts instead: smaller, one way round, four streets in.)
    const circuses: { ix: number; iz: number; name: string; round?: boolean }[] = [], nc = DEBUG_LAYOUT === "round" ? 2 : h(11) < 0.6 ? (h(12) < 0.4 ? 2 : 1) : 0;
    for (let t = 0; t < 40 && circuses.length < nc; t++) {
      const ix = CITY_LO + 3 + Math.floor(h(300 + t) * (span - 5)), iz = CITY_LO + 3 + Math.floor(h(340 + t) * (span - 5));
      let ok = !circuses.some((c) => Math.abs(c.ix - ix) < 5 && Math.abs(c.iz - iz) < 5) && !(river !== undefined && iz >= river - 1 && iz <= river + 2);
      for (let x = ix - 2; x <= ix + 2 && ok; x++) for (let z = iz - 2; z <= iz + 2 && ok; z++) if (straight(x, z) || GATE_SLOTS.some((g) => g.ix === x || g.iz === z)) ok = false;
      if (!ok) continue;
      const round = DEBUG_LAYOUT === "round" || hash2(ix, iz, this.seed, 0x70d) < 0.5;
      // (Its name by hash, or the next one no other circus in town has.)
      const list = round ? ROUND_NAMES : ["Columbus Circle", "Union Circle", "Dupont Circle", "Logan Circle", "Grand Circle"];
      let ni = Math.floor(h(380 + t) * list.length);
      while (circuses.some((c) => c.name === list[ni % list.length])) ni++;
      circuses.push({ ix, iz, round, name: list[ni % list.length] });
      for (let x = ix - 1; x <= ix; x++) for (let z = iz - 1; z <= iz; z++) used.add(`${x},${z}`);
    }
    // A diagonal from lattice node (ix, iz) by (dx, dz), as far as it can go up to `max` blocks
    // (clear of what stays straight, the river, the gates' lines and other diagonals).
    const trace = (ix: number, iz: number, dx: number, dz: number, max: number) => {
      let n = 0;
      const blocks: string[] = [];
      for (; n < max; n++) {
        const ax = ix + dx * n, az = iz + dz * n, bx = ax + dx, bz = az + dz, kb = `${Math.min(ax, bx)},${Math.min(az, bz)}`;
        if (bx <= CITY_LO || bx >= CITY_HI + 1 || bz <= CITY_LO || bz >= CITY_HI + 1 || straight(ax, az) || straight(bx, bz) || used.has(kb)) break;
        if (river !== undefined && (Math.min(az, bz) === river)) break;
        if (GATE_SLOTS.some((g) => g.ix === bx || g.iz === bz)) break;
        blocks.push(kb);
      }
      return { n, blocks };
    };
    const NAMES = ["Broadway", "Grand Diagonal", "Park Ave", "Bay Ave", "Diagonal St", "Avenue of the Arts", "Pennsylvania Ave", "Liberty Ave"];
    // (A name from the first `n`, by the hash at `salt`, or the next not yet taken: no two avenues
    // that aren't one line share a name. One running on through a circus, its two halves, does.)
    const named = new Map<string, string>();
    const nameOf = (salt: number, n: number, line: string) => {
      const had = named.get(line);
      if (had) return had;
      const taken = new Set(named.values());
      let i = Math.floor(h(salt) * n);
      for (let k = 0; k < NAMES.length && taken.has(NAMES[i % NAMES.length]); k++) i++;
      const nm = NAMES[i % NAMES.length];
      named.set(line, nm); return nm;
    };
    // A radial centre: a circus's diagonals carry on out as avenues, a star of streets round it.
    circuses.forEach((c, t) => {
      if (c.round || h(500 + t) >= 0.65) return;
      for (const [dx, dz] of [[1, -1], [-1, -1], [-1, 1], [1, 1]]) {
        const { n, blocks } = trace(c.ix + dx, c.iz + dz, dx, dz, 7);
        if (n < 2) continue;
        for (const k of blocks) used.add(k);
        diagonals.push({ ix: c.ix + dx, iz: c.iz + dz, dx, dz, n, name: nameOf(520 + t * 8 + 4 + dx + 2 * dz, NAMES.length, `${c.ix},${c.iz},${dx * dz}`) });   // (8 salts a circus; opposite avenues are one line through it)
      }
    });
    const nd = h(1) < 0.55 ? (h(2) < 0.35 ? 2 : 1) : 0;
    for (let t = 0, made = 0; t < 30 && made < nd; t++) {
      const dx = h(10 + t) < 0.5 ? 1 : -1, dz = h(40 + t) < 0.5 ? 1 : -1;
      const ix = CITY_LO + 2 + Math.floor(h(70 + t) * (span - 3)), iz = CITY_LO + 2 + Math.floor(h(100 + t) * (span - 3));
      const { n, blocks } = trace(ix, iz, dx, dz, 12);
      if (n < 4) continue;
      for (const k of blocks) used.add(k);
      diagonals.push({ ix, iz, dx, dz, n, name: nameOf(200 + t, 5, `d${t}`) });
      made++;
    }
    const oldTown = h(3) < 0.5 ? { ix: Math.round(CITY_LO + span * (0.25 + 0.5 * h(4))), iz: Math.round(CITY_LO + span * (0.25 + 0.5 * h(5))), r: 3 + 3 * h(6) } : undefined;
    const sweep = h(7) < 0.5 ? { bow: 12 + 18 * h(8), wave: 6 + 8 * h(9) } : undefined;
    return { diagonals, oldTown, sweep, circuses };
  }
  // An organic town's avenues (citygen.ts OrganicAvenue): in a town with an elevated line, one
  // along every elevated row, west edge to east; with a cable car, one along every cable column
  // clear of the sea, north edge to south. Where the lines run on out of town (ElevatedReach) and in from (outline.ts).
  get avenues(): OrganicAvenue[] {
    if (this.avs) return this.avs;
    // (Every one of the town's lines, as on the grid: each bowed a little, less near the edges, so
    // it meets them square on its own row or column, where it runs on out of town.)
    const out: OrganicAvenue[] = [], h = (k: number) => hash2(this.seed, 0xa7f, 0, k), at = (i: number) => i * BLOCK + STREET / 2;
    const fade = (i: number) => Math.max(0, Math.min(1, (Math.min(i - CITY_LO, CITY_HI + 1 - i) - 1) / 3));
    if (this.style.elevated) for (let r = CITY_LO; r <= CITY_HI; r++) if (elevatedLine(this.style, r))
      out.push({ ns: false, from: at(r), to: at(r), tag: "elevated", name: streetNameEW(r), amp: (h(r * 2) < 0.5 ? -1 : 1) * (0.4 + 0.5 * h(r * 2 + 1)) * BLOCK * fade(r) });
    if (this.style.cableCar) {
      const SL = this.shoreLine, dry = (c: number) => [0.3, 0.5, 0.7].every((t) => !SL.inSea(at(c), at(CITY_LO) + t * (CITY_HI + 1 - CITY_LO) * BLOCK));
      for (let c = CITY_LO + 1; c <= CITY_HI; c++) if (cableColumn(c) && dry(c))
        out.push({ ns: true, from: at(c), to: at(c), tag: "cable", name: streetNameNS(c), amp: (h(c * 2 + 100) < 0.5 ? -1 : 1) * (0.3 + 0.3 * h(c * 2 + 101)) * BLOCK * fade(c) });
    }
    return this.avs = out;
  }
  // Whether each avenue came through whole: its streets one unbroken run from edge to edge.
  private avenuesWhole(G: CityGraph): boolean {
    for (const tag of ["elevated", "cable", "freeway"] as const) {
      const want = tag === "freeway" ? (this.fwRoute() ? 1 : 0) : this.avenues.filter((a) => a.tag === tag).length;
      if (!want) continue;
      const sts = G.streets.filter((st) => st.inCity && st.tags[tag]), deg = new Map<number, number>();
      for (const st of sts) for (const n of [st.n0, st.n1]) deg.set(n, (deg.get(n) ?? 0) + 1);
      if ([...deg.values()].some((d) => d > 2)) return false;
      // (Each run's two ends on the town's edge, as many runs as avenues.)
      const ends = [...deg.entries()].filter(([, d]) => d === 1).map(([n]) => G.nodes[n]);
      const { x0, z0, x1, z1 } = { x0: at0(CITY_LO), z0: at0(CITY_LO), x1: at0(CITY_HI + 1), z1: at0(CITY_HI + 1) };
      if (ends.length !== 2 * want || ends.some((n) => Math.min(Math.abs(n.x - x0), Math.abs(n.x - x1), Math.abs(n.z - z0), Math.abs(n.z - z1)) > 1)) return false;
    }
    return true;
  }
  // The gate the highway comes in through: pure, from the city's seed.
  get entryGate(): Gate { return entryGateOf(this.seed); }
  // The streets left out for a slip ramp's superblock: the two that would cross it, running in
  // from the freeway's line at the next two nodes (as cityGraph's cuts).
  private slipCuts(): { ix: number; iz: number; ew: boolean }[] {
    const c = this.interchange;
    if (!c || c.kind !== "slip") return [];
    const DX = [1, 0, -1, 0], DZ = [0, -1, 0, 1], r = (c.dir + 3) % 4;
    return [1, 2].map((k) => {
      const nx = c.ix + DX[c.dir] * k, nz = c.iz + DZ[c.dir] * k;
      return r === 0 ? { ix: nx, iz: nz, ew: true } : r === 2 ? { ix: nx - 1, iz: nz, ew: true } : r === 3 ? { ix: nx, iz: nz, ew: false } : { ix: nx, iz: nz - 1, ew: false };
    });
  }
  // An organic town's freeway, for laying it out (citygen.ts): its way as an avenue, straight in
  // from its gate through the grid's patch round the interchange (FW_STRAIGHT blocks in, three
  // either side) and on round its curve; its streets carry the deck.
  private fwRoute(): { avenue: OrganicAvenue; patch: { x0: number; z0: number; x1: number; z1: number } } | null {
    const C = this.fwCurveOf(), g = this.freeway;
    if (!C || !g) return null;
    const I = [[-1, 0], [0, 1], [1, 0], [0, -1]][g.dir], R = [-I[1], I[0]], N0 = [at0(g.ix), at0(g.iz)];
    const corners = [[0, -3], [0, 3], [FW_STRAIGHT, -3], [FW_STRAIGHT, 3]].map(([a, b]) => [N0[0] + (I[0] * a + R[0] * b) * BLOCK, N0[1] + (I[1] * a + R[1] * b) * BLOCK]);
    const patch = { x0: Math.min(...corners.map((c) => c[0])), x1: Math.max(...corners.map((c) => c[0])), z0: Math.min(...corners.map((c) => c[1])), z1: Math.max(...corners.map((c) => c[1])) };
    const line: [number, number][] = [[N0[0], N0[1]], ...C.pts];
    return { avenue: { ns: g.dir === 1 || g.dir === 3, from: 0, to: 0, tag: "freeway", name: g.dir === 0 || g.dir === 2 ? streetNameEW(g.iz) : streetNameNS(g.ix), line, pairsFrom: FW_STRAIGHT * BLOCK }, patch };
  }
}
