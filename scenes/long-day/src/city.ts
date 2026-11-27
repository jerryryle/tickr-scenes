// City v1: a street grid with one 60 m block per chunk. Each chunk owns, in local coordinates,
//   the intersection          [0, 18) x [0, 18)
//   an east-west street        x in [18, 60), z in [0, 18)
//   a north-south street       x in [0, 18),  z in [18, 60)
//   the block                  [18, 60) x [18, 60)
// Streets are four 3 m lanes (two each way) between 3 m sidewalks raised 0.15 m. Traffic keeps
// right: eastbound (+x) uses z in [9, 15) of its street, southbound (+z) uses x in [3, 9).
// Every intersection is signalised (signals.ts). Districts come from CityPlan, and every
// choice is hashed from the seed and the block, so a block is identical whenever it is rebuilt.
import * as THREE from "three@0.187.0";
import { hash2, mulberry32 } from "./rng.ts";
import { Batch, BATCH, frameApply, PLACED, quadGeometry, toTile } from "./geom.ts";
import { CONTENTS, DRAW, drawRecipe, place, recipeOf } from "./contents.ts";
import { unpackWorld } from "./worlddata.ts";
import type { Recipe } from "./contents.ts";
import type { Frame2, Quad } from "./geom.ts";
import type { ChunkBuild } from "./chunks.ts";
import { LAMP_SITES, PoolBuilder } from "./atmosphere.ts";
import { truckExtents } from "./truck.ts";
import type { TruckModel } from "./truck.ts";
import { BAY, facadeBox, setFacadeChunk } from "./facade.ts";
import { FACADE, FACADE_KINDS, PAINTED_DOORS } from "./facadetiles.ts";
import { buildWorksStatic, worksFrameOf, WORKS } from "./city-storybook/storybook-landmark-knitting-works.ts";
import { VIC_STREET, vicBackYard, vicGate, vicLot, vicPlanter, vicShed, vicSquare, vicTower, vicWorks, vicYard } from "./city-victorian/victorian-buildings-town.ts";
import { vicBench, vicLamp } from "./city-victorian/victorian-street.ts";
import { buildBreweryStatic } from "./city-victorian/victorian-landmark-steam-brewery.ts";
import { SB, SB_STREET, storyGate, storyLamp, bunting, storyTower, storyShopRow, storyHouse, storyFountain, sbFootSides, storyTree, storyWorkshop } from "./city-storybook/storybook-buildings-town.ts";
import { FACADE_TILE } from "./facadeart.ts";
import type { FacadeBand } from "./facade.ts";
import { buildSignals, buildStopSigns, linkSignals, signalPoles, stopSignPosts, STOP_PLATE } from "./signals.ts";
import { cityName, STYLES } from "./styles.ts";
import type { CityStyle } from "./styles.ts";
import { BARE, seasonGreens, seasonGround, SNOW } from "./climate.ts";
import type { Climate } from "./climate.ts";
import { PlateSet } from "./signs.ts";
import { carKindAt, carPaintAt, parkedCar } from "./cars.ts";
import { boatAt, boatExtent, BOAT_PAINTS, boatSize } from "./boats.ts";
import type { BoatKind } from "./boats.ts";
import type { CarKind } from "./cars.ts";
import { buildGarage, GARAGE_DOOR, GARAGE_DRIVE } from "./garage.ts";
import { buildInterchange, interchangeClear, interchangeDrive, interchangeFace, interchangeOpen } from "./interchange.ts";
import { isExitKind, STOP_BACK } from "./route.ts";
import type { ExitKind } from "./route.ts";
import { GARAGE_H } from "./route.ts";
import { buildFreewayStreet, Frame, FW_HALF, FW_OFF_K, FW_STRAIGHT, FW_STREET_COLS, freewayStreetBent } from "./freeway.ts";
import type { FwCurve } from "./freeway.ts";
import { batonCrown, buildCableTracks, buildElevated, keepClear, buildTownSquare, cableColumn, chessStatues, DC, EL_COLUMNS, ELEVATED_Y, elevatedBent, elevatedLine, fireEscape, flagpole, ghostSign, marqueeCanopy, parkedObstacle, PAVEMENT, pavementObstacle, PK, portCrane, railSpur, billboardSpot, drawBillboard, ryderRoofSign, shopNeon, streetFurniture, waterTower, FURNITURE } from "./decor.ts";
import type { FurnitureItem } from "./decor.ts";
import { DOCK_PLATFORM, dockDoorH, dockStair, dockUsedBays, facilityAt, facilityName, hasSign, LOT_STALL_REAR, LOT_TRACTOR_N, siteLayout, streetNameEW, streetNameNS, wideDoor } from "./facilities.ts";
import type { DockLayout, FacilityId, LotLayout, SiteLayout, StandLayout } from "./facilities.ts";
import { graphOfFile } from "./cityfile.ts";
import type { CityFile, CityFileContents, CityFileDoor, CityFileLot, CityHead, CityLayout } from "./cityfile.ts";
import { cityByKey } from "./visits.ts";
import { facilitySign, marquee, signAtlas, SignAtlas } from "./signs.ts";
import type { SignMesh, SignStyle } from "./signs.ts";
import { BIOME_OF } from "./country.ts";
import { BIOMES, landTree } from "./countryworld.ts";
import { BLOCK, STREET, KERB, CURB_H, LOT_TOP, RING } from "./grid.ts";
import { angleDiff, CityGraph, clipHalf, inPoly, polyDist, sidewalkCorner } from "./citygraph.ts";
import type { CBlock, CGate, CNode, CStreet } from "./citygraph.ts";
import { drain } from "./slices.ts";
import type { Steps } from "./slices.ts";
import { CityOutline } from "./outline.ts";
import { DEBUG_EXIT, DEBUG_SEA } from "./debug.ts";

const LANE_EAST_OUTER = 13.5; // local z of the eastbound kerb lane's centre

export type District = "downtown" | "commercial" | "residential" | "industrial" | "park";

const CORE_CELL = 14; // blocks between downtown cores
export const at0 = (i: number) => i * BLOCK + STREET / 2;   // (the grid's line i, as world x or z)

// City limits: the city is the square of blocks [CITY_LO, CITY_HI] on both axes, ringed by RING
// blocks of countryside (the highway's own land takes over beyond). Its streets are those beside
// at least one block of the city, so the outermost ones run round its edge. The highway leaves
// and enters through gates: perimeter nodes with a street running straight out of town (the gate
// street), where the country road begins (country.ts). The way in is on one of GATE_SLOTS (three a
// side), chosen by the city's seed before the town is laid out; the ways out are wherever the
// town's own streets meet its edge (tools/citygen.ts trimToOutline), in its graph's gates.
export let CITY_LO = -12, CITY_HI = 11;
export interface Gate { ix: number; iz: number; dir: number }   // a gate slot: the perimeter node, and the way out of town
export const GATE_SLOTS: Gate[] = [];
export const ROUND_NAMES = ["Market Roundabout", "Town Roundabout", "Elm Roundabout", "Mill Roundabout"];   // (a roundabout's, warped or organic)
// The generator's city size by how long a stay it is laid out for: 24 blocks square for 20
// minutes or more, 18 from 10, 12 below that. Catalogue cities (cityfile.ts) were all drafted at
// 24, and the scene keeps that size whatever its cityMinutes; tests of the generator set others.
export function setCityLimits(cityMinutes: number) {
  const half = cityMinutes >= 20 ? 12 : cityMinutes >= 10 ? 9 : 6, at = Math.round(half * 0.58);
  CITY_LO = -half; CITY_HI = half - 1;
  GATE_SLOTS.length = 0;
  for (const g of [-at, 0, at]) GATE_SLOTS.push({ ix: CITY_HI + 1, iz: g, dir: 0 }, { ix: g, iz: CITY_LO, dir: 1 }, { ix: CITY_LO, iz: g, dir: 2 }, { ix: g, iz: CITY_HI + 1, dir: 3 });
}
setCityLimits(30);
export const insideCity = (bx: number, bz: number) => bx >= CITY_LO && bx <= CITY_HI && bz >= CITY_LO && bz <= CITY_HI;
// Distance in blocks (Chebyshev) from block (bx, bz) to the city; 0 inside.
export const cityDistance = (bx: number, bz: number) => Math.max(CITY_LO - bx, bx - CITY_HI, CITY_LO - bz, bz - CITY_HI, 0);
// A gate street's outer end, where the country road starts (centre line), and the way out.
export function gateEnd(g: CGate): { x: number; z: number; h: number } {
  return { x: g.x - [1, 0, -1, 0][g.dir] * STREET / 2, z: g.z - [0, -1, 0, 1][g.dir] * STREET / 2, h: g.dir * Math.PI / 2 };
}
// (The same for a gate slot's: the way in, which the road in arrives at before the town is built.)
export function gateEndSlot(g: Gate): { x: number; z: number; h: number } {
  const d = BLOCK - STREET / 2;
  return { x: g.ix * BLOCK + STREET / 2 + [1, 0, -1, 0][g.dir] * d, z: g.iz * BLOCK + STREET / 2 + [0, -1, 0, 1][g.dir] * d, h: g.dir * Math.PI / 2 };
}

// A city's whole file: its head with its layout, as given or else unpacked from the world asset
// (worlddata.ts). (Not kept on the head: a long day would come to hold every city's.)
export function fileOf(F: CityHead): CityFile {
  if (F.nodes && F.streets && F.blocks) return F as CityFile;
  const layout = unpackWorld("layouts", F.id);
  if (!layout) throw new Error(`city ${F.id}: no layout`);
  return { ...F, ...(JSON.parse(layout) as CityLayout) };
}
export class CityPlan {
  readonly name: string;
  climate: Climate | null = null;   // the city's season and weather (journey.ts), for the countryside round it
  // A catalogue city's file (cityfile.ts), when the seed is one's key: the city is read from it.
  // Without one (the drafting tool, and tests of the generator), the city is generated from the seed.
  // The catalogue's is its head (cityfile.ts CityHead); its layout is unpacked as its graph is
  // built and held only by `full`, for as long as the plan lives.
  readonly file: CityHead | null;
  private fullFile: CityFile | null = null;
  get full(): CityFile | null { return this.fullFile; }
  // `dressing`: its visit's dressing seed (visits.ts), which the parked cars along its kerbs and the
  // boats moored on its river hash; the city itself is the same whatever it is.
  // (`file`: the catalogue's by default; a test may give one of its own.)
  constructor(readonly seed: number, readonly style: CityStyle = STYLES.coastal, readonly dressing: number = seed, file: CityHead | null = cityByKey(seed) ?? null) { this.file = file; this.name = file?.name ?? cityName(seed, style); }
  // The street graph (citygraph.ts): built on first use, from the city's limits and gates.
  protected g: CityGraph | null = null;
  get graph(): CityGraph { return this.g ?? drain(this.graphJob()); }
  // Building it ahead, a few pieces at a time (slices.ts), so no one frame takes it all: the
  // journey has the next city's built this way while the truck is still in this one. Whatever is
  // left is done at first use. True once it is built.
  prepare(pieces: number): boolean {
    if (this.g) return true;
    const J = this.graphJob();
    for (let i = 0; i < pieces; i++) if (J.next().done) return true;
    return false;
  }
  protected job: Steps<CityGraph> | null = null;
  private graphJob(): Steps<CityGraph> {
    if (!this.job) {
      const self = this;
      this.job = (function* () {
        try {
          const F = self.file ? self.fullFile = fileOf(self.file) : null;
          const G = F ? yield* graphOfFile(F) : yield* self.generate();
          if (F) { self.g = G; self.ol = self.outlineAt(F.outline.scale, !!F.outline.seaOff); if (F.outline.seaOff) self.shoreOl = self.ol; self.fileBlocks(G, F); }
          linkSignals(G);
          return G;
        } finally { self.job = null; }   // (done, or thrown: a throw is thrown again at the next use, as it was)
      })();
    }
    return this.job;
  }
  // The town's outline: as the graph was cut to (outline, after the graph), or as first drawn
  // (shore: the sea's line, which the layout's districts ask before there is a graph).
  protected ol: CityOutline | null = null;
  protected shoreOl: CityOutline | null = null;
  // A city with no file is laid out by the drafting tools' generator (tools/generatedplan.ts);
  // the scene has none.
  protected *generate(): Steps<CityGraph> { throw new Error(`city ${this.seed}: no city file, and no generator in the scene`); }
  get outline(): CityOutline { void this.graph; return this.ol!; }
  get shoreLine(): CityOutline { return this.shoreOl ??= this.outlineAt(1); }
  // The town's sea, as its file holds it (outline.ts).
  protected outlineAt(_scale: number, _seaOff = false): CityOutline { return new CityOutline(DEBUG_SEA === "none" ? null : this.file?.sea ?? null); }
  // Whether the town has gate i (its graph's gates: 0 the way in, then the ways out).
  gateOpen(i: number): boolean { return !!this.graph.gates[i]; }
  // Whether the town has a river across it (tools/citygen.ts: its blocks are water).
  private river?: boolean;
  get hasRiver(): boolean { return this.river ??= this.graph.blocks.some((b) => b.water); }
  // Whether the town has water below its streets' level in view: a river, or the sea (outline.ts).
  get lowWater(): boolean { return this.hasRiver || this.outline.sea !== null; }
  // The shore: the stretches of the town's outer edge (citygraph.ts outer, the backs of its
  // outermost sidewalks) with the sea beyond them, each with the way out to sea (nx, nz).
  private shoreE: { ax: number; az: number; bx: number; bz: number; nx: number; nz: number }[] | undefined;
  get shore() {
    if (this.shoreE) return this.shoreE;
    const out: { ax: number; az: number; bx: number; bz: number; nx: number; nz: number }[] = [], O = this.outline, poly = this.graph.outer;
    if (O.sea !== null && poly) for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      let nx = -(bz - az) / L, nz = (bx - ax) / L;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, sea = (k: number) => O.inSea(mx + nx * k, mz + nz * k);
      if (!sea(10)) { nx = -nx; nz = -nz; if (!sea(10)) continue; }
      if (sea(-6)) continue;   // (out in the sea both ways: not the shore)
      out.push({ ax, az, bx, bz, nx, nz });
    }
    return this.shoreE = out;
  }
  // Whether an avenue (a two-way street named one) downtown or in the shops has a planted median:
  // in about half of a city's avenues, the whole avenue alike (by its name), at least 50 m long,
  // not under an elevated line, cable car or freeway. (At least 50 m: a grid block.)
  avenueMedian(st: CStreet, district: District): boolean {
    if (st.oneway || !st.inCity || st.len < 50 || st.tags.elevated || st.tags.cable || st.tags.freeway || !/ Ave$/.test(st.name)) return false;
    if (district !== "downtown" && district !== "commercial") return false;
    let h = 0;
    for (let i = 0; i < st.name.length; i++) h = (h * 31 + st.name.charCodeAt(i)) | 0;
    return hash2(h, 0xa7e, this.seed, 1) < 0.5;
  }
  // The storybook city's knitting works (and the Victorian city's steam brewery) stands on the block nearest the middle of town (industrial ones first,
  // then shops) whose shape fits a dock site against a face the truck can drive along. worksBlock is its block
  // id, or -1 in any other city or when none fits.
  private worksId: number | undefined;
  get worksBlock(): number {
    if (this.worksId !== undefined) return this.worksId;
    this.worksId = -1;
    if (!this.style.storybook && !this.style.victorian) return -1;
    const G = this.graph, works = this.style.victorian ? "steamBrewery" : "knittingWorks";
    // (A catalogue city's is where its file has the works.)
    if (this.file) return this.worksId = G.blocks.find((B) => this.facilities?.get((B.kx + 4096) * 1e7 + (B.kz + 5e6)) === works)?.id ?? -1;
    let best = Infinity;
    for (const B of G.blocks) {
      if (!B.inCity || B.water || B.park || B.square || !B.anchor || !G.drivable(B.anchor.face) || this.interchangeAt(B.kx, B.kz)) continue;
      const d = this.district(B.kx, B.kz), pen = d === "industrial" ? 0 : d === "commercial" ? 4 : d === "residential" ? 8 : 12;
      const c = pen + this.coreDistance(B.kx, B.kz) + hash2(B.kx, B.kz, this.seed, 0x4417) * 0.5;
      if (c < best) { best = c; this.worksId = B.id; }
    }
    return this.worksId;
  }
  // The town's plaza, a whole block of paving with a fountain and trees in place of buildings: the
  // most central block downtown or in the shops whose facility is at the kerb (no site laid out on
  // it), in a city without a Main Street town square. Its block id, or -1.
  private plazaId: number | undefined;
  get plaza(): number {
    if (this.plazaId !== undefined) return this.plazaId;
    this.plazaId = -1;
    if (this.style.townSquare) return this.plazaId;
    const G = this.graph;
    let best = Infinity;
    for (const B of G.blocks) {
      if (!B.inCity || B.water || B.park || B.area < 1200 || B.area > 4000) continue;
      const d = this.district(B.kx, B.kz);
      if (d !== "downtown" && d !== "commercial") continue;
      if (this.interchangeAt(B.kx, B.kz) || siteLayout(this, B.kx, B.kz).kind !== "kerb") continue;
      const c = this.coreDistance(B.kx, B.kz) + hash2(B.kx, B.kz, this.seed, 0x91a) * 0.3;
      if (c < best) { best = c; this.plazaId = B.id; }
    }
    return this.plazaId;
  }
  // How this city's streets were laid out, as its file says: the old square grid, one bent out of
  // square, or an organic town (tools/citygen.ts).
  get layout(): "grid" | "warp" | "organic" { return this.file?.layout ?? "grid"; }
  // How the town's outline was cut, as its file has it (the generator's own: tools/generatedplan.ts).
  get outlineCut(): { scale: number; seaOff: boolean } { return { scale: this.file?.outline.scale ?? 1, seaOff: !!this.file?.outline.seaOff }; }
  // The elevated lines: each the row it leaves town by to the west and to the east (ElevatedReach
  // runs it on from there), and its way through town from west to east (the trains): along the
  // streets tagged for it (straight along its row on a grid, bowed in an organic town).
  get elevatedLines(): { w: number; e: number; pts: [number, number][] }[] {
    if (this.elLines) return this.elLines;
    // (Each line's streets, from its west end, the end nearest its row's on the west edge.)
    const out: { w: number; e: number; pts: [number, number][] }[] = [], G = this.graph, row = (v: number) => Math.round((v - STREET / 2) / BLOCK);
    const sts = G.streets.filter((st) => st.inCity && st.tags.elevated), arms = new Map<number, number[]>();
    for (const st of sts) for (const n of [st.n0, st.n1]) arms.set(n, [...(arms.get(n) ?? []), st.id]);
    for (let r = CITY_LO; r <= CITY_HI; r++) {
      if (!this.style.elevated || !elevatedLine(this.style, r)) continue;
      let n = -1, bd = BLOCK;
      for (const [k, l] of arms) if (l.length === 1) { const N = G.nodes[k], d = Math.hypot(N.x - at0(CITY_LO), N.z - at0(r)); if (d < bd) { bd = d; n = k; } }
      const pts: [number, number][] = [], seen = new Set<number>();
      for (let prev = -1; n >= 0;) {
        pts.push([G.nodes[n].x, G.nodes[n].z]);
        const next = (arms.get(n) ?? []).find((id) => id !== prev && !seen.has(id));
        if (next === undefined) break;
        seen.add(next); prev = next; const st = G.streets[next]; n = st.n0 === n ? st.n1 : st.n0;
      }
      if (pts.length > 1) out.push({ w: row(pts[0][1]), e: row(pts[pts.length - 1][1]), pts });
    }
    return this.elLines = out;
  }
  private elLines: { w: number; e: number; pts: [number, number][] }[] | null = null;
  // The sides (-1 west, 1 east) an elevated line runs on out of town from row cz.
  elevatedSides(cz: number): number[] { return this.elevatedLines.flatMap((l) => [...(l.w === cz ? [-1] : []), ...(l.e === cz ? [1] : [])]); }
  // The block with key (bx, bz), its face on side `side`, and that face's frontage point.
  blockOf(bx: number, bz: number) { return this.graph.block(bx, bz); }
  face(bx: number, bz: number, side: number) { const b = this.graph.block(bx, bz); return b ? b.sides[side] ?? -1 : -1; }
  // How far along its face a block's site frontage is past the grid's (siteLayout's a, 9 to 51
  // on a grid block): 0 on the grid's own blocks, the anchor's offset on others.
  siteDelta(bx: number, bz: number) { const b = this.graph.block(bx, bz); return b && !b.square && b.anchor ? b.anchor.delta : 0; }
  // The gate whose street line the freeway runs along, if the city has one (freeway.ts).
  get freeway(): Gate | null { return this.file?.freeway?.gate ?? null; }
  get freewayMerge(): boolean { return !!this.freeway && !!this.file?.freeway?.merge; }
  // The kind of off-ramp its interchange has.
  protected exitKind(): ExitKind { return this.file?.freeway?.exit ?? "helix"; }
  // Where the truck comes off the freeway (interchange.ts), in a city it takes it into: the block
  // on the right a couple of blocks in (the grid's key), the side of it along the freeway, the node
  // the off-ramp leaves past and the way in, and the kind of off-ramp: a loop in that block, or
  // a slip ramp down beside the freeway across it and the next two (one superblock).
  private ic: { bx: number; bz: number; side: number; ix: number; iz: number; dir: number; kind: ExitKind } | null | undefined;
  get interchange() {
    if (this.ic !== undefined) return this.ic;
    const g = this.freeway;
    if (!g || !this.freewayMerge) return (this.ic = null);
    const d = (g.dir + 2) % 4, ix = g.ix + [1, 0, -1, 0][d] * FW_OFF_K, iz = g.iz + [0, -1, 0, 1][d] * FW_OFF_K;
    const [bx, bz] = d === 0 ? [ix, iz] : d === 2 ? [ix - 1, iz - 1] : d === 1 ? [ix, iz - 1] : [ix - 1, iz];
    const kind: ExitKind = isExitKind(DEBUG_EXIT) ? DEBUG_EXIT : this.exitKind();
    return (this.ic = { bx, bz, side: [0, 2, 1, 3][d], ix, iz, dir: d, kind });
  }
  // The interchange's block: the grid's own, or the superblock it is part of.
  private icKey: [number, number] | null | undefined;
  interchangeAt(bx: number, bz: number) {
    const c = this.interchange;
    if (!c) return false;
    if (this.icKey === undefined) {
      const P = this.graph.facePt(interchangeFace(this), 30, 21), b = this.graph.blockAt(P.x, P.z);
      this.icKey = b ? [b.kx, b.kz] : null;
    }
    return !!this.icKey && this.icKey[0] === bx && this.icKey[1] === bz;
  }
  // On the freeway's street beside the interchange (the chunk's street along `axis`): where along
  // it (street-local) the deck's parapet opens for the off-ramp (and on which side, as
  // buildFreewayStreet's k), and where the way down crosses the sidewalk (no bents there).
  interchangeStreet(axis: number, cx: number, cz: number): { open: [number, number]; clear: [number, number]; k: number; gantry: number | null; face: number } | null {
    const c = this.interchange;
    if (!c) return null;
    // The street from the node before the interchange's (the deceleration lane starts there) and
    // from its own: each in the chunk of the node it leaves (heading east or south) or arrives at.
    const d = c.dir, [dx, dz] = [[1, 0], [0, -1], [-1, 0], [0, 1]][d];
    for (const back of [1, 0, -1, -2]) {
      const ix = c.ix - dx * back, iz = c.iz - dz * back;
      const [sx, sz, sa] = d === 0 ? [ix, iz, 0] : d === 2 ? [ix - 1, iz, 0] : d === 1 ? [ix, iz - 1, 1] : [ix, iz, 1];
      if (sx !== cx || sz !== cz || sa !== axis) continue;
      const off = back * BLOCK, at = (a: number) => (d === 0 || d === 3 ? 9 + a + off : 69 - a - off);
      const span = (a0: number, a1: number): [number, number] => [Math.max(0, Math.min(at(a0), at(a1))), Math.min(BLOCK, Math.max(at(a0), at(a1)))];
      const cl = span(...interchangeClear(c.kind));
      const op = interchangeOpen(), g = at(op[0] + 4);
      // (The exit's gantry where its lane opens, facing the traffic coming along it.)
      const o = span(op[0], op[1]);
      return { open: o[1] > o[0] ? o : [-99, -99], clear: cl[1] > cl[0] ? cl : [-99, -99], k: d === 0 || d === 3 ? -1 : 1,
        gantry: g > 1 && g < BLOCK - 1 ? g : null, face: d === 0 || d === 3 ? -1 : 1 };
    }
    return null;
  }
  // The freeway's curve, if it may have one (whatever the layout), and if it has one (an organic town).
  protected fwc: FwCurve | null | undefined;
  protected fwCurveOf(): FwCurve | null { if (this.fwc === undefined) this.fwc = this.file?.freeway?.curve ?? null; return this.fwc; }
  get fwCurve(): FwCurve | null { return this.freeway && this.layout === "organic" ? this.fwCurveOf() : null; }
  private fwFrame: Frame | null | undefined;
  get freewayFrame(): Frame | null { if (this.fwFrame === undefined) this.fwFrame = this.freeway ? Frame.ofCity(this, this.freeway) : null; return this.fwFrame; }
  // Whether the street leaving node (ix, iz) along axis (0: east, 1: south) is under the freeway.
  freewayStreet(axis: number, ix: number, iz: number) {
    const g = this.freeway;
    if (!g || !insideCity(ix, iz)) return false;
    const on = axis === 0 ? (g.dir === 0 || g.dir === 2) && iz === g.iz : (g.dir === 1 || g.dir === 3) && ix === g.ix;
    // (In an organic town only along its straight, through the grid's patch: on round its curve,
    // its own streets carry it, tagged.)
    if (!on || !this.fwCurve) return on;
    const I = [[-1, 0], [0, 1], [1, 0], [0, -1]][g.dir], al = (x: number, z: number) => (x - g.ix) * I[0] + (z - g.iz) * I[1];
    const a0 = al(ix, iz), a1 = axis === 0 ? al(ix + 1, iz) : al(ix, iz + 1);
    return Math.min(a0, a1) >= 0 && Math.max(a0, a1) <= FW_STRAIGHT;
  }

  // Smooth value noise on a grid of `scale` blocks, in [0, 1).
  private noise(bx: number, bz: number, scale: number, salt: number) {
    const gx = bx / scale, gz = bz / scale, ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const h = (x: number, z: number) => hash2(x, z, this.seed, salt);
    const a = h(ix, iz) + (h(ix + 1, iz) - h(ix, iz)) * sx;
    const b = h(ix, iz + 1) + (h(ix + 1, iz + 1) - h(ix, iz + 1)) * sx;
    return a + (b - a) * sz;
  }

  // Where block (bx, bz) is, in blocks (a block's middle at bx + 0.5): its centroid once the street
  // graph has its blocks (a bowed, merged or cut block's middle isn't its old grid cell's), else
  // the grid cell's middle (for the layout, which asks before there is a graph).
  private blockPos(bx: number, bz: number): [number, number] {
    const B = this.g?.block(bx, bz);
    return B ? [(B.cx - 9) / BLOCK, (B.cz - 9) / BLOCK] : [bx + 0.5, bz + 0.5];
  }

  // Distance in blocks to the nearest downtown core (one jittered core per CORE_CELL square).
  coreDistance(bx: number, bz: number) { const [ux, uz] = this.blockPos(bx, bz); return this.coreDistanceAt(ux, uz); }
  // The same from a point in blocks (x / BLOCK).
  private coreDistanceAt(ux: number, uz: number) {
    const cx = Math.floor(ux / CORE_CELL), cz = Math.floor(uz / CORE_CELL);
    let best = Infinity;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx, gz = cz + dz;
        const px = (gx + 0.25 + 0.5 * hash2(gx, gz, this.seed, 21)) * CORE_CELL;
        const pz = (gz + 0.25 + 0.5 * hash2(gx, gz, this.seed, 22)) * CORE_CELL;
        best = Math.min(best, Math.hypot(ux - px, uz - pz));
      }
    return best;
  }

  // A block's district, judged where the block actually is (blockPos): how far its middle is from
  // the core, whether it's by the sea, the industrial noise there. (The dice for parks and mixes
  // are the block's own, by its key.) Cached once the graph is in: every lot, car and vignette asks.
  // (A catalogue city's are its file's, by block key, with its facilities: fileBlocks.)
  private districts = new Map<number, District>();
  private facilities: Map<number, FacilityId> | null = null;
  private lotsOf = new Map<number, CityFileLot[]>();
  private doorsOf = new Map<number, CityFileDoor[]>();
  // A city that lists its contents: each block's items, and the streets' and the countryside's by
  // the tile each stands in (contents.ts). Null for a city drawn by the rules.
  contents: { blocks: Map<number, Recipe[]>; tiles: Map<string, Recipe[]>; streets: Map<number, Recipe[]>; outskirts: Recipe[] } | null = null;
  private fileBlocks(G: CityGraph, F: CityFile) {
    this.facilities = new Map();
    // (A city's contents as its contents file lists them, packed into the scene: unpacked here,
    // when the city is planned.)
    const packed = F.contents ? null : unpackWorld("contents", F.id), listed = F.contents ? F.contents() : packed ? JSON.parse(packed) as CityFileContents : null;
    if (listed) {
      const C = this.contents = { blocks: new Map<number, Recipe[]>(), tiles: new Map<string, Recipe[]>(), streets: new Map(F.streets.map((st) => [st.id, (listed.streets[st.id] ?? []).map(recipeOf)])), outskirts: listed.outskirts.map(recipeOf) };
      for (const r of [...[...C.streets.values()].flat(), ...C.outskirts]) {
        const t = r.t as [number, number], key = `${t[0]},${t[1]}`;
        let a = C.tiles.get(key); if (!a) C.tiles.set(key, a = []); a.push(r);
      }
    }
    for (const L of F.blocks) {
      const B = G.blockAt(L.at[0], L.at[1])!, key = (B.kx + 4096) * 1e7 + (B.kz + 5e6);
      if (L.lots) this.lotsOf.set(B.id, L.lots);
      if (L.doors) this.doorsOf.set(B.id, L.doors);
      if (this.contents) this.contents.blocks.set(B.id, (listed!.blocks[F.blocks.indexOf(L)] ?? []).map(recipeOf));
      this.districts.set(key, L.district);
      if (L.facility) this.facilities.set(key, L.facility);
    }
  }
  // A hand-shaped block's lots, as its file lists them (buildLots), or undefined.
  fileLots(block: number): CityFileLot[] | undefined { void this.graph; return this.lotsOf.get(block); }
  // A block's facility's doors, as its file lists them (kerbDoors), or undefined.
  fileDoors(block: number): CityFileDoor[] | undefined { void this.graph; return this.doorsOf.get(block); }
  // A catalogue city's facility on block (bx, bz), as its file has it (facilities.ts facilityAt).
  fileFacility(bx: number, bz: number): FacilityId | undefined { void this.graph; return this.facilities?.get((bx + 4096) * 1e7 + (bz + 5e6)); }
  district(bx: number, bz: number): District {
    const key = (bx + 4096) * 1e7 + (bz + 5e6);   // (bz: a block key bumped by 1000s, citygraph.ts findBlocks)
    if (this.file) void this.graph;
    if (this.g) { const d = this.districts.get(key); if (d) return d; }
    const [ux, uz] = this.blockPos(bx, bz), d = this.districtAt(ux, uz, bx, bz);
    if (this.g) this.districts.set(key, d);
    return d;
  }
  private districtAt(ux: number, uz: number, bx: number, bz: number): District {
    const d = this.coreDistanceAt(ux, uz);
    const core = this.style.core;
    if (d < core) return "downtown";
    // (By the sea, outline.ts: a port's waterfront is its docks, a coastal town's its promenade.)
    if (this.shoreLine.nearShoreAt(ux * BLOCK + 9, uz * BLOCK + 9)) return this.style.id === "port" ? (hash2(bx, bz, this.seed, 15) < 0.85 ? "industrial" : "commercial") : hash2(bx, bz, this.seed, 15) < 0.55 ? "commercial" : "residential";
    if (d > core - 0.4 && hash2(bx, bz, this.seed, 11) < 0.07) return "park";
    if (d < core + 2.2) return hash2(bx, bz, this.seed, 12) < 0.8 ? "commercial" : "residential";
    const n = this.noise(ux - 0.5, uz - 0.5, 5, 13);
    if (n < this.style.industrial) return "industrial";
    return hash2(bx, bz, this.seed, 14) < 0.12 ? "commercial" : "residential";
  }

  // 0 at the edge of downtown, 1 at the core: drives tower heights.
  downtownHeight(bx: number, bz: number) { return THREE.MathUtils.clamp(1 - this.coreDistance(bx, bz) / this.style.core, 0, 1); }
}

// ---- palette (sRGB; LED-friendly, saturated but not neon) ---------------------------------
export const C = {
  asphalt: 0x2e2f33, sidewalk: 0xb0ada2, curb: 0xd4d1c6, white: 0xe8e8e0, yellow: 0xf2c200,
  pavers: 0x9e978a, plaza: 0xb9b2a2, grass: 0x4f8a3a, parkGrass: 0x4c9a3c, concrete: 0x77766f,
  path: 0xcdbf9a, water: 0x2f7fbf, roof: 0x55585c, roofLight: 0x75787a, metal: 0x8d9296,
  pole: 0x3a3d40, lampHead: 0xdedbd0, trunk: 0x5a4030, dark: 0x1e2124,
};
// The city being built (set by the chunk builder; building is synchronous, so the district
// builders read their palettes, trees and sign batches from here rather than threading them).
export let CS: CityStyle = STYLES.coastal;
// The storybook city lays its own street colours over C while it is built (storybook-buildings-town.ts
// SB_STREET); every other city has C as above.
const C_BASE = { ...C };
function setCityStyle(style: CityStyle) { CS = style; Object.assign(C, C_BASE, style.storybook ? SB_STREET : style.victorian ? VIC_STREET : {}); }

export type Rand = () => number;
export const pick = <T,>(r: Rand, a: readonly T[]) => a[Math.floor(r() * a.length)];
export const range = (r: Rand, lo: number, hi: number) => lo + (hi - lo) * r();
export const irange = (r: Rand, lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * r());

export interface CityMaterials { ground: THREE.Material; solid: THREE.Material; lamp: THREE.Material }
// Parked trucks for a rental lot, in chunk-local coordinates (main.ts bakes them from the real
// truck models; absent in tests).
export interface StallPose { model: TruckModel; x: number; z: number; h: number; toon?: number }   // (fleet.ts describes toon)
export type FleetBuilder = (stalls: StallPose[]) => THREE.Object3D | null;

// Everything a city tile is made of, as batches (`takeSlot` null: no sign atlas use, for
// probes): the intersections, streets and blocks the street graph anchors in it (citygraph.ts),
// each drawn in its own frame, and the countryside's land where the tile has no city block.
function cityBatches(plan: CityPlan, cx: number, cz: number, takeSlot: ((text: string, style: SignStyle) => ReturnType<SignAtlas["uv"]> | null) | null) {
  const seed = plan.seed, G = plan.graph, T = G.tile(cx, cz), ox = cx * BLOCK, oz = cz * BLOCK;
  setCityStyle(plan.style);
  const ground = new Batch(), solid = new Batch(), lamps = new Batch();
  const rnd = mulberry32(Math.floor(hash2(cx, cz, seed, 99) * 4294967296));
  setFacadeChunk(cx, cz, seed);
  const district = plan.district(cx, cz);
  const plates = takeSlot ? new PlateSet() : null;
  const city = T.blocks.map((b) => G.blocks[b]).filter((b) => b.inCity), water = T.blocks.map((b) => G.blocks[b]).filter((b) => b.water);
  PLACED.frames.length = 0; PLACED.trees.length = 0; PLACED.foot.length = 0; PLACED.lots.length = 0;
  Object.assign(DC, { takeSlot, stalls: [], plates, lamps, quads: [], ads: false, mquads: [], roofs: [], fac: city.length ? facilityAt(plan, city[0].kx, city[0].kz) : "residence", plan, cx, cz, pools: new PoolBuilder(), lampSites: [] as number[] });
  CONTENTS.ox = ox; CONTENTS.oz = oz;
  for (const n of T.nodes) buildNode(ground, solid, lamps, plan, G.nodes[n], ox, oz, plates);
  // (Each owner's recipes afresh each time its tile is built: a probe build of the tile makes the same.)
  const own = (o: string, tiled = false) => { CONTENTS.owner = o; CONTENTS.tile = tiled ? [cx, cz] : null; CONTENTS.out?.delete(o); };
  for (const sid of T.streets) { own(`s${sid}@${cx},${cz}`, true); buildStreetPart(ground, solid, plan, G.streets[sid], ox, oz, city.length ? district : "residential", rnd); }
  // (A city that lists its contents: the streets' and the countryside's items standing in this tile.)
  if (plan.contents) for (const r of plan.contents.tiles.get(`${cx},${cz}`) ?? []) {
    PAVEMENT.tag = r;   // (what drew its obstacles, for tools/clearstops.ts)
    try { drawRecipe(r, ground, solid, (f, fn) => inFrame(f, [ground, solid, lamps], fn)); } finally { PAVEMENT.tag = null; }
  }
  let stalls: StallPose[] = [], site: SiteLayout = { kind: "kerb" } as SiteLayout;
  for (const b of city) { own(`b${b.id}`); ({ stalls, site } = buildBlockPart(ground, solid, plan, b, ox, oz, rnd, takeSlot)); }
  own(`o@${cx},${cz}`, true);
  for (const id of G.blocksOver(cx, cz)) { const b = G.blocks[id]; if (b.water) { buildRiver(ground, b, ox, oz); buildBoats(solid, b, ox, oz, plan.dressing, G); } }
  // (Not inside the city's limits, nor where the tile lies inside a block anchored in another
  // tile: a big block, or a river's stretch, drawn whole from there.)
  if (plan.shore.length) buildShore(ground, solid, plan, ox, oz);
  // (Outside the town's land, or where its edge crosses the tile: its land is inside the town's
  // outer edge, citygraph.ts outer, and off the sea.)
  const O = plan.outline, outer = plan.graph.outer, inLand = (x: number, z: number) => !!outer && inPoly(outer, x, z) && !O.inSea(x, z);
  if (!insideCity(cx, cz) || ![[1, 1], [BLOCK - 1, 1], [1, BLOCK - 1], [BLOCK - 1, BLOCK - 1], [BLOCK / 2, BLOCK / 2]].every(([x, z]) => inLand(ox + x, oz + z))) buildOutskirts(ground, solid, plan, cx, cz, rnd);
  return { ground, solid, lamps, stalls, district, site };
}

// A part drawn in its own frame `f` (tile-local): what it adds to the batches and to the chunk's
// other lists (signs, plates, lamps, light pools, the probes' obstacles) is turned and moved into
// place afterwards.
function inFrame(f: Frame2, bs: Batch[], fn: () => void) {
  if (f.ox === 0 && f.oz === 0 && f.rot === 0) { fn(); return; }
  const marks = bs.map((b) => b.mark()), q0 = DC.quads.length, m0 = DC.mquads.length, p0 = DC.plates?.quads.length ?? 0, l0 = DC.lampSites.length;
  const pl0 = DC.pools.mark(), r0 = PAVEMENT.out?.length ?? 0, x0 = PAVEMENT.boxes?.length ?? 0, k0 = PAVEMENT.keep?.length ?? 0, roofs0 = DC.roofs.length;
  PLACED.frames.push(f);
  try { fn(); } finally { PLACED.frames.pop(); }
  bs.forEach((b, i) => b.transformFrom(marks[i], f));
  const tq = (q: Quad) => { [q.x, q.z] = frameApply(f, q.x, q.z); q.rotY = (q.rotY ?? 0) + f.rot; };
  for (let i = q0; i < DC.quads.length; i++) tq(DC.quads[i]);
  for (let i = m0; i < DC.mquads.length; i++) tq(DC.mquads[i]);
  if (DC.plates) for (let i = p0; i < DC.plates.quads.length; i++) tq(DC.plates.quads[i]);
  for (let i = l0; i < DC.lampSites.length; i += 3) [DC.lampSites[i], DC.lampSites[i + 2]] = frameApply(f, DC.lampSites[i], DC.lampSites[i + 2]);
  DC.pools.transformFrom(pl0, f);
  const R = PAVEMENT.out;
  if (R) for (let i = r0; i < R.length; i += 4) [R[i], R[i + 1]] = frameApply(f, R[i], R[i + 1]);
  const K = PAVEMENT.keep;
  if (K) for (let i = k0; i < K.length; i += 3) [K[i], K[i + 1]] = frameApply(f, K[i], K[i + 1]);
  const X = PAVEMENT.boxes;
  if (X) for (let i = x0; i < X.length; i += 4) {
    const c = [frameApply(f, X[i], X[i + 1]), frameApply(f, X[i + 2], X[i + 1]), frameApply(f, X[i], X[i + 3]), frameApply(f, X[i + 2], X[i + 3])];
    X[i] = Math.min(...c.map((p) => p[0])); X[i + 1] = Math.min(...c.map((p) => p[1])); X[i + 2] = Math.max(...c.map((p) => p[0])); X[i + 3] = Math.max(...c.map((p) => p[1]));
  }
  DC.roofs.length = roofs0;   // (a part's roofs are its own: billboards go up within it)
}

// A site's 42 m square on a block's anchor (the grid's block frontage a 9..51, n 0..42, `delta`
// along the anchor's face), world x, z.
export function siteSquare(G: CityGraph, anchor: { face: number; delta: number }): [number, number][] {
  return [[9, 0], [51, 0], [51, 42], [9, 42]].map(([a, n]) => { const P = G.facePt(anchor.face, a + anchor.delta, n); return [P.x, P.z] as [number, number]; });
}
// A block's ground round a site's square (`keep`, convex): the block less the square, as pieces
// (past each of the square's sides in turn, what is left of the block beyond it), and the part
// of the block inside the square.
export function lotGround(poly: [number, number][], keep: [number, number][]) {
  let kx = 0, kz = 0; for (const [x, z] of keep) { kx += x / keep.length; kz += z / keep.length; }
  const pieces: [number, number][][] = [];
  let rest = poly;
  for (let i = 0; i < keep.length && rest.length >= 3; i++) {
    const [ax, az] = keep[i], [bx, bz] = keep[(i + 1) % keep.length];
    let nx = bz - az, nz = -(bx - ax); if (nx * (kx - ax) + nz * (kz - az) > 0) { nx = -nx; nz = -nz; }   // (pointing out of the square)
    const c = nx * ax + nz * az, out = clipHalf(rest, -nx, -nz, -c);
    if (out.length >= 3) pieces.push(out);
    rest = clipHalf(rest, nx, nz, c);
  }
  return { pieces, inside: rest };
}
// A flat polygon slab from y0 up to y1 (its top and its sides), its corners in order.
// A polygon drawn d (2 cm) inside its edges: each edge moved in by d, its corners where the moved
// edges meet.
function pullIn(poly: [number, number][], d = 0.02): [number, number][] {
  const n = poly.length;
  let A = 0; for (let i = 0; i < n; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n]; A += x0 * z1 - x1 * z0; }
  const sgn = A > 0 ? 1 : -1;
  // (The inward normal of the edge from corner i to the next.)
  const nrm = (i: number) => { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % n], l = Math.hypot(x1 - x0, z1 - z0) || 1; return [-(z1 - z0) / l * sgn, (x1 - x0) / l * sgn]; };
  return poly.map(([x, z], i) => {
    const a = nrm((i + n - 1) % n), b = nrm(i), k = 1 + a[0] * b[0] + a[1] * b[1];
    return k < 0.2 ? [x + b[0] * d, z + b[1] * d] : [x + (a[0] + b[0]) / k * d, z + (a[1] + b[1]) / k * d];
  });
}
export function slab(b: Batch, pts: [number, number][], y0: number, y1: number, color: number) {
  // The top: a fan from the first corner where the polygon is convex; otherwise ear-clipped (a
  // fan would cross a notch), each triangle wound as the polygon is.
  let sgn = 0, convex = true, A = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length], r = pts[(i + 2) % pts.length];
    A += p[0] * q[1] - q[0] * p[1];
    const cr = (q[0] - p[0]) * (r[1] - q[1]) - (q[1] - p[1]) * (r[0] - q[0]);
    if (Math.abs(cr) > 1e-6) { const s = Math.sign(cr); if (sgn && s !== sgn) convex = false; sgn = s; }
  }
  if (convex) for (let i = 1; i + 1 < pts.length; i++) b.tri(pts[0][0], y1, pts[0][1], pts[i][0], y1, pts[i][1], pts[i + 1][0], y1, pts[i + 1][1], color);
  else for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), [])) {
    const [p, q, r] = [pts[i], pts[j], pts[k]], t = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    if (t * A >= 0) b.tri(p[0], y1, p[1], q[0], y1, q[1], r[0], y1, r[1], color);
    else b.tri(p[0], y1, p[1], r[0], y1, r[1], q[0], y1, q[1], color);
  }
  if (y1 - y0 < 1e-6) return;
  // (Each wall faces out of the polygon: a hair off its middle that way is outside. Concave
  // polygons too, whose walls in a notch face back towards the middle.)
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length], l = Math.hypot(bx - ax, bz - az) || 1;
    let nx = (bz - az) / l, nz = -(bx - ax) / l;
    if (inPoly(pts, (ax + bx) / 2 + nx * 0.01, (az + bz) / 2 + nz * 0.01)) { nx = -nx; nz = -nz; }
    b.tri(ax, y0, az, bx, y0, bz, bx, y1, bz, color, [nx, 0, nz]); b.tri(ax, y0, az, bx, y1, bz, ax, y1, az, color, [nx, 0, nz]);
  }
}

// An intersection (tile-local, about its node): its asphalt, sidewalk corners between its arms
// (the sidewalk running on straight across where no street leaves), and its signals.
function buildNode(g: Batch, solid: Batch, lamps: Batch, plan: CityPlan, n: CNode, ox: number, oz: number, plates: PlateSet | null) {
  const G = plan.graph, A = n.arms, cx = n.x - ox, cz = n.z - oz;
  if (A.length >= 2) {
    // Points at distance `t` along arm i, `o` to its right (negative: left).
    const pt = (i: number, t: number, o: number): [number, number] => { const h = A[i].h; return [cx + Math.cos(h) * t + Math.sin(h) * o, cz - Math.sin(h) * t + Math.cos(h) * o]; };
    const ring: [number, number][] = [];
    for (let i = 0; i < A.length; i++) {
      const j = (i + 1) % A.length, si = G.streets[A[i].street], sj = G.streets[A[j].street];
      const ri = si.half - si.kerb, rj = sj.half - sj.kerb;
      ring.push(pt(i, A[i].mouth, ri), pt(i, A[i].mouth, -ri));
      // The sidewalk between them, out to each street's mouth (where its own sidewalk starts), at
      // any angle, on the outside of a bend too: round the corner where the kerb lines meet (the
      // asphalt's corner) and the sidewalks' backs (the block's); or straight on across, with its
      // kerb (citygraph.ts sidewalkCorner).
      const sc = sidewalkCorner(G, n, i), local = sc.pts.map(([x, z]): [number, number] => [x - ox, z - oz]);
      if (sc.corner) {
        ring.push(local[5]);
        slab(g, local, 0, CURB_H, C.sidewalk);
      } else {
        const [a, , , d] = local;
        slab(g, local, 0, CURB_H, C.sidewalk);
        const e0 = pt(i, A[i].mouth, -ri - 0.25), e1 = pt(j, A[j].mouth, rj + 0.25);
        slab(g, [a, e0, e1, d], CURB_H + 0.004, CURB_H + 0.012, C.curb);
      }
    }
    for (let i = 1; i < ring.length; i++) g.tri(cx, 0, cz, ring[i - 1][0], 0, ring[i - 1][1], ring[i][0], 0, ring[i][1], C.asphalt);
    g.tri(cx, 0, cz, ring[ring.length - 1][0], 0, ring[ring.length - 1][1], ring[0][0], 0, ring[0][1], C.asphalt);
  }
  buildSignals(solid, lamps, G, n, ox, oz, plan.seed, plates, !!CS.storybook, !!CS.victorian);
  buildStopSigns(solid, G, n, ox, oz, !!CS.storybook, !!CS.victorian);
  // (Their poles and posts, for the driver's walks and the street life.)
  for (const p of signalPoles(G, n)) pavementObstacle(p.px - ox, p.pz - oz, 0.16);
  for (const [x, z] of stopSignPosts(G, n).values()) pavementObstacle(x - ox, z - oz, 0.05);
}

// A street between two intersections (tile-local), drawn by buildStreet in the street's own
// frame: local (9, 9) its first node's centre, x along it, z to its right. (An east-west or
// north-south street draws in the tile's own axes, as the grid always did.)
// How far an elevated line's or cable car's street draws on past its end `end` (0: n0, 1: n1): where
// the line bends on into another street of the same kind there, enough to close the bend's outside
// at half-width w (and a hair more); where it ends, on over the junction (as the grid's lines do).
function lineExt(G: CityGraph, st: CStreet, end: 0 | 1, tag: "elevated" | "cable" | "freeway", w: number) {
  const N = G.nodes[end === 0 ? st.n0 : st.n1], hOut = end === 0 ? G.dedgeStartH(st.id * 2 + 1) + Math.PI : G.dedgeEndH(st.id * 2);
  for (const a of N.arms) {
    if (a.street === st.id || !G.streets[a.street].tags[tag]) continue;
    const turn = Math.abs(angleDiff(a.h - hOut)), o = G.streets[a.street];
    // (Meeting the grid's own: a freeway's straight, drawn a block from 9 m short of its node, as
    // buildFreewayStreet does on the grid: on over the junction to it.)
    const gridOwn = tag === "freeway" && (Math.abs(angleDiff(o.h0)) < 1e-9 || Math.abs(angleDiff(o.h0 + Math.PI / 2)) < 1e-9);
    return Math.max(gridOwn ? 9 : 0, w * Math.tan(Math.min(turn, 1.2) / 2) + 0.15);
  }
  return 9;
}
// The signal poles and stop sign posts of the junctions at either end that stand on street st's
// sidewalks (signals.ts), for its furniture and street trees to keep clear of: whether on the
// right of the way from n0 to n1, how far along (from n0), and how far each way along they reach (a
// pole's radius, a stop sign's half width).
function junctionPosts(G: CityGraph, st: CStreet): { right: boolean; s: number; r: number }[] {
  const out: { right: boolean; s: number; r: number }[] = [];
  const put = (x: number, z: number, r: number) => {
    const [s, o] = G.toStreet(st.id, x, z);
    if (s > 0 && s < st.len && Math.abs(o) >= st.half - st.kerb && Math.abs(o) <= st.half) out.push({ right: o > 0, s, r });
  };
  for (const n of [G.nodes[st.n0], G.nodes[st.n1]]) {
    for (const p of signalPoles(G, n)) put(p.px, p.pz, 0.16);
    for (const [x, z] of stopSignPosts(G, n).values()) put(x, z, STOP_PLATE);
  }
  return out;
}
// A street's furniture as its city file lists it (cityfile.ts), for each side in the street's
// frame (lo: across < 9, the street's right looking from its first node to its second on a
// north-south grid street, its left on any other), each piece at 9 + its distance along; null for
// a generated city, whose furniture is placed as it is drawn (decor.ts streetFurniture).
const FURNITURE_KIND: Record<string, number> = { hydrant: PK.hydrant, trash: PK.trash, bench: PK.bench, mailbox: PK.mailbox, news: PK.news, meter: PK.meter, shelter: PK.shelter, rack: PK.rack };
function fileFurniture(plan: CityPlan, st: CStreet, axis: 0 | 1): [FurnitureItem[], FurnitureItem[]] | null {
  const F = plan.full?.streets[st.id];
  if (!F) return null;
  const lo: FurnitureItem[] = [], hi: FurnitureItem[] = [], loSide = axis === 1 ? "r" : "l";
  for (const [kind, side, at] of F.furniture ?? []) (side === loSide ? lo : hi).push([FURNITURE_KIND[kind], 9 + at]);
  return [lo, hi];
}
function buildStreetPart(g: Batch, s: Batch, plan: CityPlan, st: CStreet, ox: number, oz: number, district: District, rnd: Rand) {
  const G = plan.graph, A = G.nodes[st.n0];
  const mA = G.armOut(st.id * 2).mouth, mB = G.armIn(st.id * 2).mouth;
  const south = Math.abs(angleDiff(st.h0 + Math.PI / 2)) < 1e-9, east = Math.abs(angleDiff(st.h0)) < 1e-9;
  const axis: 0 | 1 = south ? 1 : 0, rot = south || east ? 0 : st.h0;
  const [rx, rz] = frameApply({ ox: 0, oz: 0, rot }, 9, 9);
  const f: Frame2 = { ox: A.x - ox - rx, oz: A.z - oz - rz, rot };
  // The faces either side: `hi` across (z > 9 in the street's frame; east of a north-south street's x), `lo` the other.
  const fwd = st.id * 2, back = fwd + 1, [loFace, hiFace] = axis === 1 ? [fwd, back] : [back, fwd];
  const front = (face: number): Frontage => {
    const b = G.faceBlock[face], side = G.sideOf(face);
    return b >= 0 && G.blocks[b].inCity ? streetFrontage(plan, G.blocks[b].kx, G.blocks[b].kz, side) : PLAIN_FRONT(side);
  };
  const along = (face: number) => (a: number) => (face === fwd ? 9 + a : 9 + st.len - a);
  // Water either side: a bridge (both), or a quay (one).
  // (The sea too: a face with no block that looks out over it, outline.ts.)
  const water = (face: number) => { const b = G.faceBlock[face]; if (b >= 0) return G.blocks[b].water; if (plan.outline.sea === null) return false; const p = G.facePt(face, st.len / 2, 8); return plan.outline.inSea(p.x, p.z); };
  // Downtown and commercial kerbs the truck can stop at have a loading zone at the middle of the
  // side, where it stops (journey.ts: centred on the side): not by a driveway.
  const zone = (face: number) => {
    const b = G.faceBlock[face], B = b >= 0 ? G.blocks[b] : null;
    if (!B || !B.inCity || B.water || !G.drivable(face) || front(face).drive) return null;
    const dd = plan.district(B.kx, B.kz);
    return dd === "downtown" || dd === "commercial" ? along(face)((G.faceA0(face) + G.faceA1(face)) / 2) : null;
  };
  // Features along it: an elevated line, a cable car's tracks, the freeway overhead (on the old grid's axes).
  const gridAxis = south || east;
  const fw = gridAxis && plan.freewayStreet(axis, A.kx, A.kz);
  // (An organic town's freeway round its curve: its own streets, at any angle, tagged.)
  const fwCurve = !fw && !!st.tags.freeway && axis === 0;
  const ic = fw ? plan.interchangeStreet(axis, A.kx, A.kz) : null;
  FURNITURE.street = st.id;
  inFrame(f, [g, s, DC.lamps], () => {
    buildStreet(g, s, axis, district, rnd, front(loFace), front(hiFace), along(loFace), along(hiFace), 9 + mA, 9 + st.len - mB,
      { el: !!st.tags.elevated && axis === 0, fw: !!fw || fwCurve, icClear: ic?.clear ?? null, oneway: st.oneway, ring: !!st.ring, loading: [zone(loFace), zone(hiFace)], wet: [water(loFace), water(hiFace)], median: plan.avenueMedian(st, district) && !front(loFace).drive && !front(hiFace).drive, salt: st.id * 31 + plan.seed,
        posts: junctionPosts(G, st), furniture: fileFurniture(plan, st, axis) });
    // (Node to node, a little on past each end where the line bends on along the next street, so the
    // two close up on the outside of the bend; at the line's end, on over the junction as on the grid.)
    if (st.tags.elevated && axis === 0) buildElevated(s, 9 - lineExt(G, st, 0, "elevated", 4.6), 9 + st.len + lineExt(G, st, 1, "elevated", 4.6));
    if (st.tags.cable) { if (axis === 1) buildCableTracks(g); else buildCableTracks(g, 9 - lineExt(G, st, 0, "cable", 3), 9 + st.len + lineExt(G, st, 1, "cable", 3)); }
    if (fwCurve) buildFreewayStreet(g, 0, null, null, 9 - lineExt(G, st, 0, "freeway", FW_HALF + 0.4), 9 + st.len + lineExt(G, st, 1, "freeway", FW_HALF + 0.4));
    if (fw) {
      const F = plan.freewayFrame!;
      const gantry = ic?.gantry != null && DC.plates ? { at: ic.gantry, face: ic.face, k: ic.k, text: `EXIT ${F.exitNo} · ${F.name} CENTER`, other: `I-${F.route} ${F.wayOut}`, plates: DC.plates } : null;
      buildFreewayStreet(g, axis, ic ? { a0: ic.open[0], a1: ic.open[1], k: ic.k } : null, gantry);
    }   // (the ground batch: the truck's see-through spotlight leaves it be)
  });
}

// A block of any shape (tile-local): its ground, then lots along each face, each a building of
// its district drawn in the face's frame (its frontage at the back of the sidewalk, as on the
// grid, so the door probe finds it), and what is left in the middle a yard or garden. Faces are
// lotted longest first, so where two meet at a corner the longer one gets it; a lot must fit inside
// the block and clear of the others.
const LOT_DEPTH: Record<District, number> = { downtown: 15, commercial: 13, residential: 11, industrial: 17, park: 0 };
const LOT_WIDTH: Record<District, [number, number]> = { downtown: [16, 26], commercial: [8, 14], residential: [9, 12], industrial: [18, 30], park: [0, 0] };
// `keep`: an area (a site's square, tile-local) the lots keep out of; their ground is laid round
// it, leaving the site's own ground (at street level) to show.
function buildLots(g: Batch, s: Batch, plan: CityPlan, blk: CBlock, ox: number, oz: number, district: District, rnd: Rand, keep: [number, number][] | null = null) {
  const G = plan.graph, poly = blk.poly.map(([x, z]) => [x - ox, z - oz] as [number, number]);
  const groundC = district === "residential" || district === "park" ? CS.grass : CS.pavers;
  // (Their ground drawn 2 cm in from its edges, and a cm under a district's or a site's own ground
  // laid over it: where they met the kerb, a site's yard or that ground in one plane, upright or
  // flat, they flickered.)
  const top = LOT_TOP - 0.01;
  if (blk.id === plan.plaza) { place("ground", { pts: cmPts(pullIn(poly)), top, c: "pavers" }, g, s, rnd); place("plaza", { pts: cmPts(poly) }, g, s, rnd); return; }
  for (const piece of keep ? lotGround(poly, keep).pieces : [poly]) place("ground", { pts: cmPts(pullIn(piece)), top, c: groundC === CS.grass ? "grass" : "pavers" }, g, s, rnd);
  // A park: trees scattered clear of the edges, and (when a facility has its door here) a
  // pavilion on each side.
  const pavilions = district === "park" && hasSign(DC.fac);
  if (district === "park") {
    for (let k = 0; k < Math.floor(blk.area / 90); k++) {
      const x = blk.cx - ox + range(rnd, -25, 25), z = blk.cz - oz + range(rnd, -25, 25);
      if (inPoly(poly, x, z) && polyDist(poly, x, z) > (pavilions ? 12 : 3) && !(keep && (inPoly(keep, x, z) || polyDist(keep, x, z) < 3))) plantTree(s, x, CURB_H, z, range(rnd, 5, 8), range(rnd, 1.5, 2.3), pick(rnd, CS.trees.greens), rnd);
    }
    if (!pavilions) return;
  }
  const depth = pavilions ? 6 : LOT_DEPTH[district], [w0, w1] = pavilions ? [7, 9] : LOT_WIDTH[district], hs = plan.downtownHeight(blk.kx, blk.kz);
  type Lot = { f: number; a0: number; a1: number; d: number; pts: [number, number][]; floors?: number; wall?: number };
  const lots: Lot[] = [];
  const corners = (f: number, a0: number, a1: number, d: number) => [[a0, 0.3], [a1, 0.3], [a1, d], [a0, d]].map(([a, n]) => { const p = G.facePt(f, a, n); return [p.x - ox, p.z - oz] as [number, number]; });
  const overlaps = (p: [number, number][], q: [number, number][]) => {
    for (const P of [p, q]) for (let i = 0; i < 4; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % 4], nx = bz - az, nz = -(bx - ax);
      const pr = (R: [number, number][]) => R.map(([x, z]) => x * nx + z * nz);
      const A = pr(p), B = pr(q);
      if (Math.max(...A) <= Math.min(...B) + 0.05 || Math.max(...B) <= Math.min(...A) + 0.05) return false;
    }
    return true;
  };
  const faces = blk.faces.slice().sort((p, q) => (G.faceA1(q) - G.faceA0(q)) - (G.faceA1(p) - G.faceA0(p)) || p - q);
  // A cul-de-sac (a close) into a big block where people live, in about half of those with room:
  // off the middle of its longest side, a lane in to a turning circle, and houses round it facing
  // in. Its lane's span of that side has no lot.
  const close = district === "residential" && !keep ? closeOf(G, blk, poly, ox, oz, faces[0], plan.seed) : null;
  // (A lot that won't fit is tried shallower, then narrower; a park's pavilion goes mid-side.)
  const tryLot = (f: number, a0: number, a1: number, d: number) => {
    for (const k of [1, 0.65, 0.4]) {
      const pts = corners(f, a0, a1, Math.max(5, d * k));
      if (pts.every(([x, z]) => inPoly(poly, x, z)) && !lots.some((l) => overlaps(l.pts, pts)) && !(keep && overlaps(keep, pts))) { lots.push({ f, a0, a1, d: Math.max(5, d * k), pts }); return true; }
    }
    return false;
  };
  for (const f of faces) {
    const A0 = G.faceA0(f), A1 = G.faceA1(f);
    if (pavilions) { const m = (A0 + A1) / 2, w = range(rnd, w0, w1); tryLot(f, m - w / 2, m + w / 2, depth); continue; }
    let a = A0 + 0.5;
    while (a + w0 <= A1 - 0.5) {
      const w = Math.min(range(rnd, w0, w1), A1 - 0.5 - a), d = depth * range(rnd, 0.8, 1.1);
      if (close && f === close.f && a + w > close.m - 5 && a < close.m + 5) { a = close.m + 5; continue; }
      // (Where it won't fit, as against a lot round a corner, narrower; failing that, a little on.)
      const fitW = [w, w * 0.66, w * 0.45].find((ww) => (ww === w || ww >= 5) && tryLot(f, a, a + ww, d));
      a += fitW ?? 2;
    }
    // Every side has a building at least (its facility's front door is on each).
    if (!lots.some((l) => l.f === f)) for (const w of [w0, 7, 5, 3.6]) { const m = (A0 + A1) / 2; if (A1 - A0 > w + 1 && tryLot(f, m - w / 2, m + w / 2, depth)) break; }
    // Still none: a small one mid-side, in place of corner lots of sides that have others.
    if (!lots.some((l) => l.f === f) && A1 - A0 > 7) {
      const m = (A0 + A1) / 2, pts = corners(f, m - 3, m + 3, 6);
      // (Trimmed shorter from either end until clear; dropped only if it can't be.)
      const hit = lots.filter((l) => overlaps(l.pts, pts));
      const trimmed = hit.map((h) => {
        for (let k = 1; h.a1 - h.a0 - k >= 5; k++) for (const [t0, t1] of [[h.a0 + k, h.a1], [h.a0, h.a1 - k]]) {
          const q = corners(h.f, t0, t1, h.d);
          if (!overlaps(q, pts)) return { ...h, a0: t0, a1: t1, pts: q };
        }
        return null;
      });
      if (pts.every(([x, z]) => inPoly(poly, x, z)) && !(keep && overlaps(keep, pts))) {
        hit.forEach((h, i) => { const t = trimmed[i]; lots.splice(lots.indexOf(h), 1, ...(t ? [t] : [])); });
        lots.push({ f, a0: m - 3, a1: m + 3, d: 6, pts });
      }
    }
  }
  // (A hand-shaped block's lots, as its file lists them, in place of those picked above. The picking
  // still ran, so the random draws after it are as they were.)
  const own = plan.fileLots(blk.id);
  if (own) lots.splice(0, lots.length, ...own.map((o): Lot => { const f = o.street * 2 + (o.side === "r" ? 0 : 1); return { f, a0: o.a0, a1: o.a1, d: o.depth, pts: corners(f, o.a0, o.a1, o.depth), floors: o.floors, wall: o.wall }; }));
  // The buildings, each in its face's frame: x along the face, z in from it (the street at z < 0),
  // each a recipe (lotBuilding) with its door.
  for (const L of lots) {
    for (const [x, z] of L.pts) PLACED.lots.push(...toTile(x, z));
    const P = G.facePt(L.f, 0, 0), fr: Frame2 = { ox: P.x - ox, oz: P.z - oz, rot: P.h }, side = blk.sides.indexOf(L.f);
    inFrame(fr, [g, s, DC.lamps], () => {
      const b: Rect = { x0: L.a0 + 0.3, z0: 0.4, x1: L.a1 - 0.3, z1: L.d - 0.3 }, rect = [cm2(b.x0), cm2(b.z0), cm2(b.x1), cm2(b.z1)];
      if (CS.storybook && !pavilions && district !== "industrial") { place("storyLot", { side, rect, district, hs: cm2(hs) }, g, s, rnd); return; }
      if (CS.victorian) { place("vicLot", { side, rect, district: pavilions ? "park" : district, hs: cm2(hs) }, g, s, rnd); return; }
      if (district === "downtown") {
        const w0 = pick(rnd, CS.walls.downtown), f0 = Math.max(3, Math.round((3 + hs * range(rnd, 4, 14)) * CS.towerScale));
        place("lotBuilding", { use: "tower", side, rect, wall: L.wall ?? w0, floors: L.floors ?? f0, ground: rnd() < 0.5 ? FACADE.LOBBY : FACADE.STOREFRONT, tile: pick(rnd, CS.towerTiles) }, g, s, rnd);
      } else if (district === "commercial") {
        const f0 = Math.min(CS.maxShopFloors, Math.max(1, 1 + Math.floor(rnd() * rnd() * 5))), w0 = pick(rnd, CS.walls.commercial), floors = L.floors ?? f0;
        const tile = floors > 1 ? pick(rnd, CS.upperTiles) : undefined, awn = rnd() < 0.7 ? pick(rnd, CS.awnings) : undefined;
        place("lotBuilding", { use: "shop", side, rect, wall: L.wall ?? w0, floors, ...(tile !== undefined ? { tile } : {}), ...(awn !== undefined ? { awning: awn } : {}) }, g, s, rnd);
      } else if (pavilions) {
        place("lotBuilding", { use: "pavilion", side, rect, wall: pick(rnd, CS.walls.commercial) }, g, s, rnd);
      } else if (district === "residential") {
        const set = range(rnd, 2.2, 3.2), w0 = pick(rnd, CS.walls.residential), f0 = irange(rnd, 1, 2);
        const h = [cm2(b.x0 + 0.8), cm2(b.z0 + set), cm2(b.x1 - 0.8), cm2(Math.min(b.z1, b.z0 + 10))];
        place("lotBuilding", { use: "house", side, rect: h, wall: L.wall ?? w0, floors: L.floors ?? f0 }, g, s, rnd);
        if (rnd() < 0.5) plantTree(s, (h[0] + h[2]) / 2 + range(rnd, -2, 2), CURB_H, h[3] + 2.5, range(rnd, 5, 7), 1.6, pick(rnd, CS.trees.greens), rnd);
      } else {
        place("lotBuilding", { use: "works", side, rect, wall: L.wall ?? pick(rnd, CS.walls.industrial), floorH: cm2(range(rnd, 6, 9)) }, g, s, rnd);
      }
    });
  }
  const extra = close ? drawClose(g, s, G, close, poly, ox, oz, lots.map((l) => l.pts), rnd) : [];
  buildInfill(g, s, plan, blk, poly, ox, oz, district, lots, keep, hs, extra);
}
// A lot's building (buildLots), in its face's frame (x along the face, z in from it), on `rect`
// (x0, z0, x1, z1), its front door between two of its bays on side `side` of its block: a `tower`
// (downtown: its ground floor's tile, its tower's tile and floors), a `shop` (its floors, its
// upper floors' tile, an awning's colour), a park's `pavilion`, a `house` (set back behind its
// front garden) or industrial `works` (its one tall floor's height). Its wall's colour; the roof's
// cap and clutter from its own draws.
// Its detail follows its style as the grid's buildings do, drawn from its own seed so the city
// files name none of it: a house is the style's kind (CityStyle houses), gabled with perhaps a
// chimney where detached (and where a coastal town's Victorians are), a punched-window bungalow
// in the desert, else a brick or apartment front under a cornice; a shop may have neon and, three
// floors up or more, a fire escape (CityStyle neon, fireEscapes); a tall, wide tower may step in
// to a crown of a few floors.
DRAW.lotBuilding = (R, _g, s, rnd) => {
  const [x0, z0, x1, z1] = R.rect as number[], b: Rect = { x0, z0, x1, z1 }, wall = R.wall as number, side = R.side as number;
  const door = (dx0: number, dx1: number, n: number, painted = false) => {
    const bays = Math.max(1, Math.round((dx1 - dx0) / BAY));
    const a = painted ? dx1 - (dx1 - dx0) * (Math.floor(bays / 2) + 0.5) / bays : bays > 1 ? dx0 + (dx1 - dx0) * Math.round(bays / 2) / bays : (dx0 + dx1) / 2;
    if (side >= 0) doorSpot(side, a, n);
  };
  switch (R.use) {
    case "tower": {
      door(b.x0, b.x1, b.z0);
      const floors = R.floors as number, tile = R.tile as number;
      // (A crown: its top few floors stepped in 2.5 m all round, where there is room for one.)
      const crown = floors >= 8 && b.x1 - b.x0 >= 12 && b.z1 - b.z0 >= 10 && rnd() < 0.5 ? irange(rnd, 2, 4) : 0;
      let top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, CURB_H, [{ tile: R.ground as number, floors: 1, floorH: 5 }, { tile, floors: floors - crown, floorH: 3.6 }], wall);
      if (crown) {
        { const ci = inset(b, 0.04); s.span(ci.x0, top - 0.05, ci.z0, ci.x1, top + 0.05, ci.z1, C.roofLight); }   // (inside the walls: flatRoof)
        const cr = inset(b, 2.5);
        top = facadeBox(s, cr.x0, cr.z0, cr.x1, cr.z1, top, [{ tile, floors: crown, floorH: 3.6 }], wall);
        flatRoof(s, cr, top, wall, rnd, 2);
      } else flatRoof(s, b, top, wall, rnd, 3);
      break;
    }
    case "shop": {
      door(b.x0, b.x1, b.z0);
      const floors = R.floors as number, bands: FacadeBand[] = [{ tile: FACADE.STOREFRONT, floors: 1, floorH: 4.2 }];
      if (floors > 1) bands.push({ tile: R.tile as number, floors: floors - 1, floorH: 3.4 });
      const top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, CURB_H, bands, wall);
      flatRoof(s, b, top, wall, rnd, floors > 2 ? 2 : 1);
      if (R.awning !== undefined) awning(s, b, 2, R.awning as number);
      if (rnd() < CS.neon) shopNeon(s, b, 2, rnd);
      if (CS.fireEscapes && floors >= 3 && rnd() < 0.5) fireEscape(s, b, 2, floors, 4.2, 3.4, rnd);
      break;
    }
    case "pavilion": {
      door(b.x0, b.x1, b.z0);
      const top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, CURB_H, [{ tile: FACADE.STOREFRONT, floors: 1, floorH: 4 }], wall);
      flatRoof(s, b, top, wall, rnd, 0);
      break;
    }
    case "house": {
      door(b.x0, b.x1, b.z0, true);
      const kind = CS.houses === "row" && CS.id !== "coastal" ? "row" : CS.houses === "bungalow" ? "bungalow" : "gabled";
      const tile = kind === "gabled" ? FACADE.SIDING : kind === "bungalow" ? FACADE.PUNCHED : pick(rnd, [FACADE.BRICK, FACADE.RESIDENTIAL, FACADE.APARTMENT]);
      const top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, CURB_H, [{ tile, floors: R.floors as number, floorH: 3.1 }], wall, 2, FACADE.DOOR);
      if (kind === "gabled") {
        // (Its ridge along the street, as the grid's detached houses have theirs.)
        const rd = b.z1 - b.z0 + 0.8, rh = rd * 0.36;
        s.prism((b.x0 + b.x1) / 2, top + rh / 2, (b.z0 + b.z1) / 2, b.x1 - b.x0 + 0.5, rh, rd, pick(rnd, CS.gables), 0);
        if (rnd() < 0.5) s.box(b.x0 + 1.2, top + rh * 0.9, (b.z0 + b.z1) / 2, 0.7, rh * 1.2, 0.7, 0x8a4a3a);
      } else {
        flatRoof(s, b, top, wall, rnd, kind === "bungalow" ? 1 : 0);
        if (kind === "row") s.span(b.x0, top - 0.35, b.z0 - 0.35, b.x1, top + 0.1, b.z0, shade(wall, 0.7));   // a cornice along its front
      }
      break;
    }
    default: {
      door(b.x0, b.x1, b.z0);
      const top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, CURB_H, [{ tile: FACADE.INDUSTRIAL, floors: 1, floorH: R.floorH as number }], wall);
      flatRoof(s, b, top, wall, rnd, 1);
      if (CS.storybook) storyWorkshop(s, b, top, rnd);
    }
  }
};
// A storybook lot's buildings (storyLot), on `rect` in its face's frame, by its district.
DRAW.storyLot = (R, _g, s, rnd) => {
  const [x0, z0, x1, z1] = R.rect as number[], side = R.side as number;
  storyLot(s, { x0, z0, x1, z1 }, side, R.district as District, R.hs as number, rnd, (_f, dx0, dx1, n, painted = false) => {
    const bays = Math.max(1, Math.round((dx1 - dx0) / BAY));
    doorSpot(side, painted ? dx1 - (dx1 - dx0) * (Math.floor(bays / 2) + 0.5) / bays : bays > 1 ? dx0 + (dx1 - dx0) * Math.round(bays / 2) / bays : (dx0 + dx1) / 2, n);
  });
};
// A Victorian lot's building (vicLot), on `rect` in its face's frame, by its district (a park's
// pavilion where the district is "park"): victorian-buildings-town.ts.
DRAW.vicLot = (R, _g, s, rnd) => {
  const [x0, z0, x1, z1] = R.rect as number[], side = R.side as number, d = R.district as District;
  const walls = d === "park" ? CS.walls.commercial : CS.walls[d as "downtown" | "commercial" | "residential" | "industrial"];
  vicLot(s, { x0, z0, x1, z1 }, CURB_H, d, R.hs as number, walls, rnd, (dx0, dx1, n, painted = false) => {
    const bays = Math.max(1, Math.round((dx1 - dx0) / BAY));
    doorSpot(side, painted ? dx1 - (dx1 - dx0) * (Math.floor(bays / 2) + 0.5) / bays : bays > 1 ? dx0 + (dx1 - dx0) * Math.round(bays / 2) / bays : (dx0 + dx1) / 2, n);
  });
};
// A Victorian block middle's buildings and yards (buildInfill): a grand building downtown
// (vicTower), a warehouse or mill elsewhere (vicWorks), an industrial yard's stacks (vicYard) and
// a garden square in place of a car park (vicSquare).
DRAW.vicTower = (R, _g, s, rnd) => { const [x0, z0, x1, z1] = R.rect as number[]; vicTower(s, { x0, z0, x1, z1 }, CURB_H, R.hs as number, CS.walls.downtown, rnd); };
DRAW.vicWorks = (R, _g, s, rnd) => { const [x0, z0, x1, z1] = R.rect as number[]; vicWorks(s, { x0, z0, x1, z1 }, CURB_H, R.floorH as number, R.wall as number, rnd); };
DRAW.vicYard = (R, _g, s, rnd) => { vicYard(s, R.w as number, R.d as number, CURB_H, rnd); };
DRAW.vicSquare = (R, g, s, rnd) => { vicSquare(s, g, R.w as number, R.d as number, CURB_H, !!R.big, CS.grass, rnd); };
// A block's ground (`pts`, its top at `top`): grass or paving, as the season colours it.
DRAW.ground = (R, g) => { slab(g, R.pts as [number, number][], 0, R.top as number, R.c === "grass" ? CS.grass : CS.pavers); };
// The town's plaza over its block `pts` (buildPlaza).
DRAW.plaza = (R, g, s, rnd) => { buildPlaza(g, s, R.pts as [number, number][], rnd); };
// (A polygon's corners to the centimetre.)
const cmPts = (pts: [number, number][]) => pts.map(([x, z]) => [cm2(x), cm2(z)] as [number, number]);
// This builds the storybook city's buildings on a lot b (in its face's frame, with the street at -z): downtown gets a
// bent tower or two of round pods in hats, shops stand in crooked rows (now and then with a short tower), and
// houses are squat pods or crooked gables. `door` records the front door for kerbDoors, as for any
// city's lot (x0..x1 is the wall it is in, n its depth).
function storyLot(s: Batch, b: Rect, f: number, district: District, hs: number, rnd: Rand, door: (f: number, x0: number, x1: number, n: number, painted?: boolean) => void) {
  const w = b.x1 - b.x0, d = b.z1 - b.z0, roofs = CS.roofs;
  if (district === "downtown" || (district === "commercial" && rnd() < 0.3)) {
    const two = w > 1.7 * d, cw = two ? w / 2 : w, R = Math.max(2.4, Math.min(cw / 2, d / 2) - 0.4), n = sbFootSides(R);
    const look = { walls: district === "downtown" ? CS.walls.downtown : CS.walls.commercial, roofs, ground: FACADE.STORY_SHOP, upper: FACADE.STORYBOOK, storeys: 0 };
    for (let k = 0; k < (two ? 2 : 1); k++) {
      const cx = two ? b.x0 + cw * (k + 0.5) : (b.x0 + b.x1) / 2, cz = b.z0 + R * Math.cos(Math.PI / n);
      const storeys = district === "downtown" ? Math.max(3, Math.min(9, Math.round(3 + hs * range(rnd, 2, 9)))) : irange(rnd, 2, 3);
      storyTower(s, cx, cz, R, { x: cw / 2 - 0.55, zf: R + 1.2, zb: d - R + 0.4 }, CURB_H, { ...look, storeys }, rnd);   // (its trims stay clear of the next lot's, or the other tower's)
      if (k === 0) door(f, cx - 0.5, cx + 0.5, b.z0);
    }
    return;
  }
  if (district === "commercial") {
    door(f, b.x0, b.x1, b.z0);
    storyShopRow(s, b, CURB_H, Math.min(CS.maxShopFloors, irange(rnd, 1, 3)), { walls: CS.walls.commercial, roofs, ground: FACADE.STORY_SHOP, upper: FACADE.STORYBOOK, storeys: 0 }, rnd);
    return;
  }
  // a house is set back behind its front garden, with its tree behind it
  const h: Rect = { x0: b.x0 + 0.8, z0: b.z0 + range(rnd, 2.2, 3.2), x1: b.x1 - 0.8, z1: Math.min(b.z1, b.z0 + 10) };
  const R = Math.max(2.6, Math.min((h.x1 - h.x0) / 2, (h.z1 - h.z0) / 2) - 0.2), cx = (h.x0 + h.x1) / 2, cz = h.z0 + R;
  const r = storyHouse(s, cx, cz, R, CURB_H, { walls: CS.walls.residential, roofs: CS.gables, ground: FACADE.STORYBOOK, upper: FACADE.STORYBOOK, door: FACADE.STORY_DOOR, storeys: 0 }, rnd);
  door(f, r.door[0], r.door[1], r.front, true);
  if (rnd() < 0.5) cityTree(s, cx + range(rnd, -2, 2), CURB_H, cz + R + 2.8, range(rnd, 5, 7), 1.6, pick(rnd, CS.trees.greens), rnd);
}
// A close into block blk off face f (its longest side), or null: where a turning circle (9 m, and
// a pavement round it) fits 20 to 40 m in from the middle of the side, 12 m clear of the block's
// edge, the side being 50 m long at least. m: the lane's place along the side; D: how far in its
// circle starts; (cx, cz): the circle's middle (tile-local).
type Close = { f: number; m: number; D: number; cx: number; cz: number };
function closeOf(G: CityGraph, blk: CBlock, poly: [number, number][], ox: number, oz: number, f: number, seed: number): Close | null {
  const A0 = G.faceA0(f), A1 = G.faceA1(f);
  if (A1 - A0 < 50 || hash2(blk.kx, blk.kz, seed, 0xc1d) >= 0.5) return null;
  const m = (A0 + A1) / 2;
  for (let D = 40; D >= 20; D -= 2) {
    const P = G.facePt(f, m, D + 9), cx = P.x - ox, cz = P.z - oz;
    if (inPoly(poly, cx, cz) && polyDist(poly, cx, cz) >= 12) return { f, m, D, cx, cz };
  }
  return null;
}
// The close's lane, its circle and the houses round it (each fitted inside the block, clear of the
// lots and each other); what it covers, for the block's infill to keep clear of.
function drawClose(g: Batch, s: Batch, G: CityGraph, c: Close, poly: [number, number][], ox: number, oz: number, lots: [number, number][][], rnd: Rand): [number, number][][] {
  const y = CURB_H, at = (a: number, n: number): [number, number] => { const P = G.facePt(c.f, a, n); return [P.x - ox, P.z - oz]; };
  const lane = [at(c.m - 3.5, 0), at(c.m + 3.5, 0), at(c.m + 3.5, c.D + 3), at(c.m - 3.5, c.D + 3)], verge = [at(c.m - 4.7, 0.01), at(c.m + 4.7, 0.01), at(c.m + 4.7, c.D + 2), at(c.m - 4.7, c.D + 2)];   // (its end a cm in from the lane's: shared planes flicker)
  place("close", { lane: cmPts(lane), verge: cmPts(verge), x: cm2(c.cx), z: cm2(c.cz) }, g, s, rnd);
  plantTree(s, c.cx, y + 0.2, c.cz, range(rnd, 5, 7), 1.7, pick(rnd, CS.trees.greens), rnd);
  const covered: [number, number][][] = [verge, [[c.cx - 11, c.cz - 11], [c.cx + 11, c.cz - 11], [c.cx + 11, c.cz + 11], [c.cx - 11, c.cz + 11]]];
  // (In from the side to the circle's middle: the houses at angles round from straight on.)
  const [mx, mz] = at(c.m, 0), il = Math.hypot(c.cx - mx, c.cz - mz), ix = (c.cx - mx) / il, iz = (c.cz - mz) / il;
  const sep = (p: [number, number][], q: [number, number][]) => {
    for (const P of [p, q]) for (let i = 0; i < 4; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % 4], nx = bz - az, nz = -(bx - ax), A = p.map(([x, z]) => x * nx + z * nz), B = q.map(([x, z]) => x * nx + z * nz);
      if (Math.max(...A) <= Math.min(...B) + 0.3 || Math.max(...B) <= Math.min(...A) + 0.3) return true;
    }
    return false;
  };
  const houses: [number, number][][] = [];
  for (const deg of [0, -50, 50, -100, 100, -140, 140]) {
    const t = deg * Math.PI / 180, ux = ix * Math.cos(t) - iz * Math.sin(t), uz = ix * Math.sin(t) + iz * Math.cos(t);
    const fr: Frame2 = { ox: c.cx + ux * 10.5, oz: c.cz + uz * 10.5, rot: Math.atan2(ux, uz) };
    const pts = ([[-4.5, 0], [4.5, 0], [4.5, 10.5], [-4.5, 10.5]] as [number, number][]).map(([x, z]) => frameApply(fr, x, z));
    if (!pts.every(([x, z]) => inPoly(poly, x, z) && polyDist(poly, x, z) > 0.5) || lots.some((l) => !sep(l, pts)) || houses.some((h) => !sep(h, pts))) continue;
    houses.push(pts);
    inFrame(fr, [g, s, DC.lamps], () => { const wall = pick(rnd, CS.walls.residential); place("closeHouse", { wall, floors: irange(rnd, 1, 2) }, g, s, rnd); });
  }
  return [...covered, ...houses];
}

// A close's lane and its verge (polygons), and its turning circle round (x, z) with the kerbed
// bed in its middle (its tree is a tree of its own).
DRAW.close = (R, g, s) => {
  const y = CURB_H, x = R.x as number, z = R.z as number;
  slab(g, R.verge as [number, number][], y, y + 0.012, CS.pavers);
  slab(g, R.lane as [number, number][], y, y + 0.025, C.asphalt);
  g.cyl(x, y + 0.012, z, 10.5, 0.024, CS.pavers, 24);
  g.cyl(x, y + 0.025, z, 9, 0.05, C.asphalt, 24);
  s.cyl(x, y + 0.1, z, 2.2, 0.2, C.curb, 16);
  g.cyl(x, y + 0.21, z, 2.0, 0.02, CS.grass, 16);
};
// A house round a close, facing in to it from its own frame: its path, its wall and floors.
DRAW.closeHouse = (R, g, s, rnd) => {
  const y = CURB_H, h: Rect = { x0: -4, z0: 2.5, x1: 4, z1: 10 }, wall = R.wall as number;
  if (CS.victorian) { g.box(0, y + 0.02, 1.25, 1.2, 0.02, 2.5, CS.pavers); vicLot(s, h, y, "residential", 0, [wall], rnd, () => {}); return; }   // (a villa: victorian-buildings-town.ts)
  g.box(0, y + 0.02, 1.25, 1.2, 0.02, 2.5, CS.pavers);
  const top = facadeBox(s, h.x0, h.z0, h.x1, h.z1, y, [{ tile: FACADE.RESIDENTIAL, floors: R.floors as number, floorH: 3.1 }], wall, 2, FACADE.DOOR);
  flatRoof(s, h, top, wall, rnd, 0);
};
// What fills a big block's middle, deeper than its lots reach (tile-local `poly`): set-back
// towers downtown, car parks and the odd low building commercially, sheds in industry, back-garden
// trees and sheds where people live, behind each house its own fenced garden. Each piece is
// centred on a grid point, square to the street nearest it (so it follows a bent block round),
// inside the block, clear of the lots and a site's square (`keep`), and 2 m deeper than the
// district's lots from every street (in industry, 5 m: its yards reach the street; car parks
// anywhere clear of the shops, up to the sidewalk where there are none).
// (kerbDoors only looks for a wall to put a door in on a side with no lot, and every side has one
// where it can.) Its own random stream, so the rest of the block is drawn as it was.
type InfillLot = { f: number; a0: number; a1: number; d: number; pts: [number, number][] };
function buildInfill(g: Batch, s: Batch, plan: CityPlan, blk: CBlock, poly: [number, number][], ox: number, oz: number, district: District, lots: InfillLot[], keep: [number, number][] | null, hs: number, extra: [number, number][][] = []) {
  if (district === "park") return;
  // (Industry's yards come up near the street: sheds and stacked containers behind a fence line.)
  const G = plan.graph, rnd = mulberry32(hash2(blk.kx, blk.kz, plan.seed, 0x1f11)), taken = lots.map((l) => l.pts);
  const depth = district === "industrial" ? 5 : LOT_DEPTH[district] + 2;
  const deep = (x: number, z: number, dep = depth) => inPoly(poly, x, z) && polyDist(poly, x, z) >= dep;
  const sep = (p: [number, number][], q: [number, number][], gap = 2) => {   // (separated, `gap` apart at least)
    for (const P of [p, q]) for (let i = 0; i < 4; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % 4], l = Math.hypot(bx - ax, bz - az), nx = (bz - az) / l, nz = -(bx - ax) / l;
      const A = p.map(([x, z]) => x * nx + z * nz), B = q.map(([x, z]) => x * nx + z * nz);
      if (Math.max(...A) + gap <= Math.min(...B) + 1e-6 || Math.max(...B) + gap <= Math.min(...A) + 1e-6) return true;
    }
    return false;
  };
  // The way along the street nearest (x, z): the block's nearest edge.
  const along = (x: number, z: number): [number, number] => {
    let best = Infinity, ex = 1, ez = 0;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(ax + dx * t - x, az + dz * t - z);
      if (d < best) { best = d; const l = Math.sqrt(l2); ex = dx / l; ez = dz / l; }
    }
    return [ex, ez];
  };
  const placed: [number, number][][] = [...extra];
  // (A piece whose corners are all inside a concave block can still span its notch: none of the
  // block's own corners may be inside the piece.)
  const spans = (pts: [number, number][]) => poly.some(([x, z]) => inPoly(pts, x, z));
  // A w by d rectangle centred on (x, z), w along (ex, ez), if it fits: its corners deep inside, clear of the rest.
  const fit = (x: number, z: number, ex: number, ez: number, w: number, d: number, gap = 2, dep = depth) => {
    const nx = -ez, nz = ex, pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + ex * a * w / 2 + nx * b * d / 2, z + ez * a * w / 2 + nz * b * d / 2] as [number, number]);
    if (!pts.every(([px, pz]) => deep(px, pz, dep)) || spans(pts)) return false;
    if (taken.some((t) => !sep(t, pts, gap)) || placed.some((t) => !sep(t, pts, gap)) || (keep && !sep(keep, pts, 2))) return false;
    placed.push(pts);
    return true;
  };
  if (district === "residential") {
    // Behind each house its garden, as wide as its lot and as deep as the block allows (14 m at
    // most), fenced on three sides; in it a tree, perhaps a shed at the back, perhaps a patio.
    for (const L of lots) for (const gd of [14, 11, 8, 5]) {
      const A0 = L.a0 + 0.3, A1 = L.a1 - 0.3, pts = [[A0, L.d], [A1, L.d], [A1, L.d + gd], [A0, L.d + gd]].map(([a, n]) => { const P = G.facePt(L.f, a, n); return [P.x - ox, P.z - oz] as [number, number]; });
      if (!pts.every(([x, z]) => inPoly(poly, x, z) && polyDist(poly, x, z) > 0.3) || spans(pts)) continue;
      if (lots.some((o) => o !== L && !sep(o.pts, pts, 0)) || placed.some((t) => !sep(t, pts, 0.3)) || (keep && !sep(keep, pts, 1))) continue;   // (other gardens a little off: their fences never coincide)
      placed.push(pts);
      const P = G.facePt(L.f, 0, 0), fence = rnd() < 0.5 ? 0xece8dc : 0x8a6a48, n0 = L.d, n1 = L.d + gd;
      inFrame({ ox: P.x - ox, oz: P.z - oz, rot: P.h }, [g, s, DC.lamps], () => {
        const patio = rnd() < 0.35, shed = gd >= 8 && rnd() < 0.3;
        place("garden", { rect: [cm2(A0), cm2(n0), cm2(A1), cm2(n1)], fence, ...(patio ? { patio: true } : {}), ...(shed ? { shed: pick(rnd, CS.walls.residential) } : {}) }, g, s, rnd);
        // (The tree clear of the shed: in front of it, a crown's width off.)
        if (rnd() < 0.75) plantTree(s, range(rnd, A0 + 1.5, Math.max(A0 + 1.5, A1 - 3.5)), CURB_H, range(rnd, n0 + 4, Math.max(n0 + 4, n1 - (shed ? 5 : 2))), range(rnd, 5, 8), range(rnd, 1.4, 2.2), pick(rnd, CS.trees.greens), rnd);
      });
      break;
    }
  }
  if (district === "commercial") {
    // Car parks first, as big as the space allows (a row of bays and its aisle 11 m deep, up to
    // two pairs of rows), anywhere clear of the shops: where a side has none, up to the sidewalk.
    const PARK = 3;
    const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    for (let z = Math.min(...zs) + PARK; z <= Math.max(...zs) - PARK; z += 3) for (let x = Math.min(...xs) + PARK; x <= Math.max(...xs) - PARK; x += 3) {
      // (The smallest car park, 11 m deep, needs its middle PARK + 5.5 m in from the block's edge;
      // and not in a car park already.)
      if (!deep(x, z, PARK + 5.5) || placed.some((t) => inPoly(t, x, z))) continue;
      const [ex, ez] = along(x, z);
      let wd: [number, number] | null = null;
      for (const d of [27, 22, 16, 11]) { for (const w of [44, 36, 28, 20, 13]) if (fit(x, z, ex, ez, w, d, 0.6, PARK)) { wd = [w, d]; break; } if (wd) break; }
      if (!wd) continue;
      const [w, d] = wd, b: Rect = { x0: -w / 2, z0: -d / 2, x1: w / 2, z1: d / 2 };
      if (CS.victorian) {
        // The Victorian city has garden squares where others park, trees of its own over the lawns.
        inFrame({ ox: x, oz: z, rot: Math.atan2(-ez, ex) }, [g, s, DC.lamps], () => {
          const big = w >= 20 && d >= 16;
          place("vicSquare", { w, d, ...(big ? { big: true } : {}) }, g, s, rnd);
          for (let k = 0; k < Math.floor(w * d / 70); k++) {
            const tx = range(rnd, b.x0 + 3, b.x1 - 3), tz = range(rnd, b.z0 + 3, b.z1 - 3);
            if (big && Math.hypot(tx, tz) < Math.min(w, d) / 2 - 1) continue;
            plantTree(s, tx, CURB_H + 0.04, tz, range(rnd, 7, 11), range(rnd, 2, 3), pick(rnd, CS.trees.greens), rnd);
          }
        });
        continue;
      }
      if (CS.storybook) {
        // The storybook city has gardens where others park: a lawn ringed by a path, trees of its
        // kinds dotted over it, a bowl fountain in the middle of a big one.
        inFrame({ ox: x, oz: z, rot: Math.atan2(-ez, ex) }, [g, s, DC.lamps], () => {
          const big = w >= 20 && d >= 16;
          place("storyGarden", { w, d, ...(big ? { fountain: true } : {}) }, g, s, rnd);
          for (let k = 0; k < Math.floor(w * d / 45); k++) {
            const tx = range(rnd, b.x0 + 3, b.x1 - 3), tz = range(rnd, b.z0 + 3, b.z1 - 3);
            if (big && Math.hypot(tx, tz) < Math.min(w, d) / 2 - 1) continue;
            plantTree(s, tx, CURB_H + 0.04, tz, range(rnd, 4.5, 7), range(rnd, 1.3, 2), pick(rnd, CS.trees.greens), rnd);
          }
        });
        continue;
      }
      inFrame({ ox: x, oz: z, rot: Math.atan2(-ez, ex) }, [g, s, DC.lamps], () => {
        // (Its bays' cars: a colour for each bay with one in, 0 for an empty bay, row by row.)
        const cars: number[] = [];
        for (let zz = b.z0 + 0.3, k = 0; zz + 5 <= b.z1 - 0.3; zz += k % 2 ? 5 : 11, k++) for (let xx = b.x0 + 0.3; xx + 2.6 <= b.x1 - 0.3; xx += 2.6) cars.push(rnd() < 0.5 ? pick(rnd, PARKED_COLORS) : 0);
        place("carPark", { w, d, cars }, g, s, rnd);
      });
    }
    // Then what paving is left, too narrow for a car park: trees in kerbed planters, every 6 m or so.
    for (let z = Math.min(...zs) + PARK; z <= Math.max(...zs) - PARK; z += 6) for (let x = Math.min(...xs) + PARK; x <= Math.max(...xs) - PARK; x += 6) {
      if (!deep(x, z, PARK)) continue;
      const [ex, ez] = along(x, z);
      if (!fit(x, z, ex, ez, 2.2, 2.2, 0.8, PARK)) continue;
      inFrame({ ox: x, oz: z, rot: Math.atan2(-ez, ex) }, [g, s, DC.lamps], () => {
        place("planter", {}, g, s, rnd);
        plantTree(s, 0, CURB_H + 0.35, 0, range(rnd, 4.5, 6.5), range(rnd, 1.3, 1.9), pick(rnd, CS.trees.greens), rnd);
      });
    }
  }
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]), step = district === "residential" ? 4 : 3;
  for (let z = Math.min(...zs) + depth; z <= Math.max(...zs) - depth; z += step) for (let x = Math.min(...xs) + depth; x <= Math.max(...xs) - depth; x += step) {
    if (!deep(x, z)) continue;
    const [ex, ez] = along(x, z), fr: Frame2 = { ox: x, oz: z, rot: Math.atan2(-ez, ex) };
    if (district === "residential") {
      // Back gardens: a tree here and there, now and then a shed.
      if (rnd() < 0.6 && fit(x, z, ex, ez, 2.5, 2.5)) inFrame(fr, [g, s, DC.lamps], () => {
        if (rnd() < 0.15) place("shed", { wall: pick(rnd, CS.walls.residential) }, g, s, rnd);
        else plantTree(s, range(rnd, -1, 1), CURB_H, range(rnd, -1, 1), range(rnd, 5, 8), range(rnd, 1.4, 2.2), pick(rnd, CS.trees.greens), rnd);
      });
      continue;
    }
    const [w, d] = district === "industrial" ? [range(rnd, 18, 30), range(rnd, 12, 20)] : district === "downtown" ? [range(rnd, 14, 20), range(rnd, 12, 18)] : [range(rnd, 14, 24), range(rnd, 8, 14)];
    let built = false;
    for (const k of district === "industrial" ? [1, 0.75, 0.55, 0.45] : [1, 0.75, 0.55]) {
      if (!fit(x, z, ex, ez, w * k, d * k)) continue;
      const b: Rect = { x0: -w * k / 2, z0: -d * k / 2, x1: w * k / 2, z1: d * k / 2 };
      inFrame(fr, [g, s, DC.lamps], () => {
        const rect = [cm2(b.x0), cm2(b.z0), cm2(b.x1), cm2(b.z1)];
        if (CS.victorian) {
          if (district === "downtown") place("vicTower", { rect, hs: cm2(hs) }, g, s, rnd);
          else place("vicWorks", { rect, wall: pick(rnd, district === "industrial" ? CS.walls.industrial : CS.walls.commercial), floorH: cm2(range(rnd, 6, 9)) }, g, s, rnd);
        } else if (district === "downtown" && CS.storybook) place("storyTower", { r: cm2(Math.min(b.x1 - b.x0, b.z1 - b.z0) / 2 - 0.3), storeys: Math.max(4, Math.min(11, Math.round(4 + hs * range(rnd, 3, 10)))) }, g, s, rnd);
        else if (district === "downtown") {
          const wall = pick(rnd, CS.walls.downtown), floors = Math.max(4, Math.round((5 + hs * range(rnd, 6, 18)) * CS.towerScale));
          place("lotBuilding", { use: "tower", side: -1, rect, wall, floors, ground: FACADE.LOBBY, tile: pick(rnd, CS.towerTiles) }, g, s, rnd);
        } else place("lotBuilding", { use: "works", side: -1, rect, wall: pick(rnd, district === "industrial" ? CS.walls.industrial : CS.walls.commercial), floorH: cm2(range(rnd, 6, 9)) }, g, s, rnd);
      });
      built = true;
      break;
    }
    // (An industrial yard with no room for a shed: shipping containers, in a row or two, stacked.)
    if (!built && district === "industrial" && rnd() < 0.7) {
      const rows = rnd() < 0.5 ? 2 : 1, n = 2 + Math.floor(rnd() * 3), W = n * 2.6, D = rows * 6.3;
      if (fit(x, z, ex, ez, W, D)) inFrame(fr, [g, s, DC.lamps], () => {
        // (Each stack's containers' colours, bottom up: n along, `rows` deep.)
        const stacks: number[][] = [];
        for (let i = 0; i < n; i++) for (let j = 0; j < rows; j++) { const hgt = 1 + Math.floor(rnd() * 2), st: number[] = []; for (let lv = 0; lv < hgt; lv++) st.push(pick(rnd, CONTAINER_COLORS)); stacks.push(st); }
        if (CS.victorian) place("vicYard", { w: cm2(W), d: cm2(D) }, g, s, rnd);
        else place("containers", { n, rows, stacks }, g, s, rnd);
      });
    }
  }
}
const CONTAINER_COLORS = [0x9b2f24, 0x2f5d8a, 0x3f7a4a, 0xc78a2c, 0x6d6f73, 0x8a4f2a];
// A house's back garden (buildInfill), `rect` (a0, n0, a1, n1) in its face's frame: fenced on
// three sides in `fence`, perhaps a patio, perhaps a shed (its wall's colour) at the back.
DRAW.garden = (R, g, s, rnd) => {
  const [A0, n0, A1, n1] = R.rect as number[], fence = R.fence as number, gd = n1 - n0;
  if (CS.victorian) { vicBackYard(s, g, A0, n0, A1, n1, CURB_H, CS.grass, rnd); return; }   // (a back yard walled in brick: victorian-buildings-town.ts)
  for (const a of [A0, A1]) s.box(a, CURB_H + 0.6, (n0 + n1) / 2, 0.08, 1.2, gd, fence);
  s.box((A0 + A1) / 2, CURB_H + 0.6, n1, A1 - A0, 1.2, 0.08, fence);
  if (R.patio) slab(g, [[A0 + 0.5, n0], [A1 - 0.5, n0], [A1 - 0.5, n0 + 3], [A0 + 0.5, n0 + 3]], CURB_H, CURB_H + 0.03, CS.pavers);
  if (R.shed !== undefined) { const sx = A1 - 1.8; s.box(sx, CURB_H + 1.1, n1 - 1.5, 2.4, 2.2, 2.0, R.shed as number); s.box(sx, CURB_H + 2.3, n1 - 1.5, 2.7, 0.2, 2.3, 0x5a4a3a); }
};
// A garden shed, its wall's colour.
DRAW.shed = (R, _g, s, rnd) => {
  const x = (R.x as number | undefined) ?? 0, z = (R.z as number | undefined) ?? 0;
  if (CS.victorian && R.x === undefined) { vicShed(s, CURB_H, R.wall as number, rnd); return; }
  s.box(x, CURB_H + 1.1, z, 2.4, 2.2, 2.0, R.wall as number);
  if (R.x === undefined) s.box(x, CURB_H + 2.3, z, 2.7, 0.2, 2.3, 0x5a4a3a);   // (a back garden's has a roof; a grid block's middle's, as it always was, none)
};
// The storybook city's garden where others park: a lawn ringed by a path, w by d, a bowl
// fountain in the middle of a big one (its trees are trees of their own).
DRAW.storyGarden = (R, g, s) => {
  const w = R.w as number, d = R.d as number, b: Rect = { x0: -w / 2, z0: -d / 2, x1: w / 2, z1: d / 2 };
  slab(g, [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]], CURB_H, CURB_H + 0.02, C.path);
  slab(g, [[b.x0 + 1.4, b.z0 + 1.4], [b.x1 - 1.4, b.z0 + 1.4], [b.x1 - 1.4, b.z1 - 1.4], [b.x0 + 1.4, b.z1 - 1.4]], CURB_H + 0.02, CURB_H + 0.04, CS.grass);
  if (R.fountain) storyFountain(s, 0, CURB_H + 0.04, 0, Math.min(w, d) / 2 - 3);
};
// A car park w by d: rows of bays 5 m deep, 2.6 m wide, with 6 m aisles between, each row facing
// its aisle (rows 0, 2... have it on their +z side, rows 1, 3... on their -z side, so their cars
// are mirrored, cabin set back from the aisle); `cars` a colour for each bay with a car in.
DRAW.carPark = (R, g, s) => {
  const w = R.w as number, d = R.d as number, cars = R.cars as number[], b: Rect = { x0: -w / 2, z0: -d / 2, x1: w / 2, z1: d / 2 };
  slab(g, [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]], CURB_H, CURB_H + 0.02, C.asphalt);
  let bay = 0;
  for (let zz = b.z0 + 0.3, k = 0; zz + 5 <= b.z1 - 0.3; zz += k % 2 ? 5 : 11, k++) {
    const back = k % 2 ? -1 : 1;
    let xx = b.x0 + 0.3;
    for (; xx + 2.6 <= b.x1 - 0.3; xx += 2.6) {
      g.box(xx, CURB_H + 0.03, zz + 2.5, 0.12, 0.01, 5, C.white);
      const cc = cars[bay++] ?? 0;
      if (cc) { const cx = xx + 1.3, cz = zz + 2.5; s.box(cx, CURB_H + 0.62, cz, 1.8, 0.75, 4.3, cc); s.box(cx, CURB_H + 1.25, cz - 0.2 * back, 1.6, 0.55, 2.2, cc); s.box(cx, CURB_H + 1.25, cz - 0.2 * back, 1.62, 0.4, 1.4, 0x2a3440); }
    }
    g.box(xx, CURB_H + 0.03, zz + 2.5, 0.12, 0.01, 5, C.white);   // (the last bay's other line)
  }
};
// A kerbed planter (its tree is a tree of its own).
DRAW.planter = (_R, g, s) => {
  if (CS.victorian) { vicPlanter(s, CURB_H); return; }
  slab(s, [[-1.1, -1.1], [1.1, -1.1], [1.1, 1.1], [-1.1, 1.1]], CURB_H, CURB_H + 0.35, C.curb);
  slab(g, [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]], CURB_H + 0.36, CURB_H + 0.36, 0x4a3a2a);
};
// Shipping containers in an industrial yard: n along, `rows` deep, each stack's colours bottom up.
DRAW.containers = (R, _g, s) => {
  const n = R.n as number, rows = R.rows as number, stacks = R.stacks as number[][], W = n * 2.6, D = rows * 6.3;
  for (let i = 0; i < n; i++) for (let j = 0; j < rows; j++) (stacks[i * rows + j] ?? []).forEach((c, lv) => s.box(-W / 2 + 1.3 + i * 2.6, CURB_H + 1.3 + lv * 2.6, -D / 2 + 3.15 + j * 6.3, 2.44, 2.59, 6.06, c));
};
// A storybook tower standing on its own (an infill's), its radius and storeys.
DRAW.storyTower = (R, _g, s, rnd) => {
  const r = R.r as number;
  storyTower(s, 0, 0, r, { x: r + 0.4, zf: r + 0.4, zb: r + 0.4 }, CURB_H, { walls: CS.walls.downtown, roofs: CS.roofs, ground: FACADE.STORYBOOK, upper: FACADE.STORYBOOK, storeys: R.storeys as number }, rnd);
};
const PARKED_COLORS = [0xb8bcc2, 0x2a2c30, 0xe8e6e0, 0x8a1e22, 0x24426e, 0x5a6066, 0x6e5a3a];

// A river's stretch of water between its quays, the part of it in this tile (tile-local: a
// winding stretch is drawn by every tile it covers, so whichever of them has streamed in shows
// its part): the water a metre and a half down, and the quay walls round it, faced in stone.
const RIVER = 0x2f6f9a, QUAY = 0x8f8a7e;
const inTile = (x: number, z: number) => x >= 0 && x < BLOCK && z >= 0 && z < BLOCK;
// (Its triangles, in world coordinates, worked out once per block: each tile clips them.)
const riverTris = new WeakMap<CBlock, [number, number][][]>();
function buildRiver(g: Batch, blk: CBlock, ox: number, oz: number) {
  const poly = blk.poly.map(([x, z]) => [x - ox, z - oz] as [number, number]), y = -1.5;
  const w = winding(poly);
  let tris = riverTris.get(blk);
  if (!tris) riverTris.set(blk, tris = THREE.ShapeUtils.triangulateShape(blk.poly.map(([x, z]) => new THREE.Vector2(x, z)), []).map((ix) => ix.map((i) => blk.poly[i])));
  for (const tri of tris) {
    let t = tri.map(([x, z]) => [x - ox, z - oz] as [number, number]);
    for (const [nx, nz, c] of [[1, 0, BLOCK], [-1, 0, 0], [0, 1, BLOCK], [0, -1, 0]]) t = clipHalf(t, nx, nz, c);
    // (Each triangle wound as the polygon is, as slab does.)
    for (let m = 1; m + 1 < t.length; m++) {
      const [p, q, r] = [t[0], t[m], t[m + 1]], cr = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      if (cr * w >= 0) g.tri(p[0], y, p[1], q[0], y, q[1], r[0], y, r[1], RIVER); else g.tri(p[0], y, p[1], r[0], y, r[1], q[0], y, q[1], RIVER);
    }
  }
  for (let i = 0; i < poly.length; i++) {
    const [px, pz] = poly[i], [qx, qz] = poly[(i + 1) % poly.length], c = clipToTile(px, pz, qx, qz);
    if (!c) continue;
    const nx = -(qz - pz) * w, nz = (qx - px) * w, nl = Math.hypot(nx, nz) || 1;   // (facing the water)
    // (A cm out over the water: the streets' and sidewalks' ends at the bank face the same way.)
    const ax = c[0] + nx / nl * 0.01, az = c[1] + nz / nl * 0.01, bx = c[2] + nx / nl * 0.01, bz = c[3] + nz / nl * 0.01;
    g.tri(ax, y, az, bx, y, bz, bx, CURB_H, bz, QUAY, [nx, 0, nz]); g.tri(ax, y, az, bx, CURB_H, bz, ax, CURB_H, az, QUAY, [nx, 0, nz]);
  }
}
// The part of the segment p..q (tile-local) in this tile, or null. One lying along a tile's edge
// belongs to the tile on its far side, as inTile has it (x < BLOCK).
function clipToTile(px: number, pz: number, qx: number, qz: number): [number, number, number, number] | null {
  let t0 = 0, t1 = 1;
  for (const [d, v] of [[qx - px, px], [qz - pz, pz]]) for (const [lim, sgn] of [[0, -1], [BLOCK, 1]]) {
    const num = sgn * (lim - v), den = sgn * d;
    if (Math.abs(den) < 1e-9) { if (num < 0 || (sgn > 0 && num < 1e-6)) t1 = -1; continue; }
    const t = num / den;
    if (den > 0) t1 = Math.min(t1, t); else t0 = Math.max(t0, t);
  }
  return t1 <= t0 ? null : [px + (qx - px) * t0, pz + (qz - pz) * t0, px + (qx - px) * t1, pz + (qz - pz) * t1];
}

// ---- the sea's shore (outline.ts) ---------------------------------------------------------------
// Along the shore (CityPlan.shore), the part in this tile (tile-local, as the river's walls). A
// port's: a stone quay wall down to the water, boats moored along it, and here and there a pier
// out into the sea on piles with boats along both sides. A coastal town's: a sandy beach sloping
// from the promenade's kerb down under the water, lifeguard towers along it, and in summer (not in
// rain) umbrellas and towels. The sea itself is one plane under the whole town (main.ts).
const SAND = 0xe2cf9a, SAND_WET = 0xc9b27a, PIER = 0x8a6a48, PILE = 0x4a3a2c;
export const BEACH_W = 18, SEA_Y = -1.5;   // (sealife.ts: its surf runs up this beach)
export const SEA_COLOR = 0x2f78b8;          // the sea (main.ts buildSea), as the country road's (countryworld.ts CW.water)
function buildShore(g: Batch, s: Batch, plan: CityPlan, ox: number, oz: number) {
  const port = plan.style.id === "port", c = plan.climate, sunny = !!c && c.season === "summer" && !/rain|storm|snow|fog/.test(c.weather);
  const E = plan.shore;
  E.forEach((e, i) => {
    const ax = e.ax - ox, az = e.az - oz, bx = e.bx - ox, bz = e.bz - oz, L = Math.hypot(bx - ax, bz - az), { nx, nz } = e;
    // (Nothing of an edge's comes more than its beach's width from it: none of it here if it
    // passes further than that from the tile.)
    if (Math.max(ax, bx) < -BEACH_W - 2 || Math.min(ax, bx) > BLOCK + BEACH_W + 2 || Math.max(az, bz) < -BEACH_W - 2 || Math.min(az, bz) > BLOCK + BEACH_W + 2) return;
    const ex = (bx - ax) / L, ez = (bz - az) / L, cl = clipToTile(ax, az, bx, bz);
    if (port) {
      // (The quay's face a cm out from the shore's line, where the streets' and sidewalks' ends stop
      // facing the same way: shared planes flicker.)
      if (cl) { const o = 0.01, [px, pz, qx, qz] = [cl[0] + nx * o, cl[1] + nz * o, cl[2] + nx * o, cl[3] + nz * o]; g.tri(px, SEA_Y, pz, qx, SEA_Y, qz, qx, CURB_H, qz, QUAY, [nx, 0, nz]); g.tri(px, SEA_Y, pz, qx, CURB_H, qz, px, CURB_H, pz, QUAY, [nx, 0, nz]); }
      // Its piers, by the tile their root is in (shoreMoorings: the boats moored along the quay and
      // the piers ride the swell, sealife.ts).
      for (const p of shoreMoorings(plan).piers) if (p.edge === i && inTile(p.x - ox, p.z - oz)) pier(s, p.x - ox, p.z - oz, nx, nz, ex, ez);
      return;
    }
    // The beach: from the sidewalk's back down to under the water, BEACH_W out.
    const y1 = SEA_Y - 0.25;
    if (cl) {
      const [px, pz, qx, qz] = cl, w = BEACH_W * 0.75;
      quadTri(g, [px, CURB_H - 0.02, pz], [qx, CURB_H - 0.02, qz], [qx + nx * BEACH_W, y1, qz + nz * BEACH_W], [px + nx * BEACH_W, y1, pz + nz * BEACH_W], SAND);
      quadTri(g, [px + nx * w, SEA_Y + 0.06, pz + nz * w], [qx + nx * w, SEA_Y + 0.06, qz + nz * w], [qx + nx * BEACH_W, y1 + 0.01, qz + nz * BEACH_W], [px + nx * BEACH_W, y1 + 0.01, pz + nz * BEACH_W], SAND_WET);
    }
    // (Where the shore turns, the gap between two edges' sand filled.)
    const nxt = E[(i + 1) % E.length];
    if (inTile(bx, bz) && Math.hypot(nxt.ax - e.bx, nxt.az - e.bz) < 0.5 && Math.abs(nx * nxt.nz - nz * nxt.nx) > 1e-3)
      g.tri(bx, CURB_H - 0.02, bz, bx + nx * BEACH_W, y1, bz + nz * BEACH_W, bx + nxt.nx * BEACH_W, y1, bz + nxt.nz * BEACH_W, SAND);
    for (let k = 0; k < Math.floor(L / 12); k++) {
      const t = (k + 0.5) / Math.floor(L / 12), d = 4 + 9 * hash2(i, k, plan.seed, 0xbea1), x = ax + (bx - ax) * t + nx * d, z = az + (bz - az) * t + nz * d, r = hash2(i, k, plan.seed, 0xbea2);
      if (!inTile(x, z)) continue;
      const y = CURB_H - 0.02 + (y1 - CURB_H) * (d / BEACH_W);
      if (r < 0.05) lifeguardTower(s, x, y, z, Math.atan2(-nz, nx));
      else if (sunny && r < 0.45) {
        const col = [0xe0402a, 0xf2c200, 0x2a7fd4, 0xf2f0ea, 0x2e9a5a][Math.floor(r * 50) % 5];
        s.cyl(x, y + 1.0, z, 0.03, 2.0, 0xd8d8d8, 4); s.cone(x, y + 2.05, z, 1.1, 0.35, col, 8);
        s.box(x + ex * 1.2, y + 0.02, z + ez * 1.2, 1.7, 0.03, 0.8, [0x2a7fd4, 0xe86a9a, 0xf2c200][Math.floor(r * 70) % 3], Math.atan2(-ez, ex));
      }
    }
  });
}
function quadTri(g: Batch, p: number[], q: number[], r: number[], t: number[], color: number) {
  g.tri(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2], color);
  g.tri(p[0], p[1], p[2], r[0], r[1], r[2], t[0], t[1], t[2], color);
}
// A pier from the quay at (x, z) out to sea along (nx, nz), across (ex, ez): a plank deck on piles,
// bollards along it, boats lying alongside.
function pier(s: Batch, x: number, z: number, nx: number, nz: number, ex: number, ez: number) {
  const len = PIER_LEN, w = PIER_W, yaw = Math.atan2(-nz, nx), top = CURB_H - 0.02;
  s.box(x + nx * len / 2, top - 0.15, z + nz * len / 2, len, 0.3, w, PIER, yaw);
  for (let d = 4; d <= len; d += 6) for (const sd of [-1, 1]) {
    const px = x + nx * d + ex * sd * (w / 2 - 0.3), pz = z + nz * d + ez * sd * (w / 2 - 0.3);
    s.cyl(px, (SEA_Y - 0.2 + top - 0.3) / 2, pz, 0.18, top - 0.3 - SEA_Y + 0.2, PILE, 6);
    if (d % 12 === 4) s.cyl(px, top + 0.2, pz, 0.12, 0.4, 0x2b2d31, 6);
  }
}
// A port's harbour along its shore (CityPlan.shore), in world coordinates: a container wharf on its
// longest stretch, where a crane works a ship (sealife.ts), then every 30 m or so along the quay a
// pier (buildShore) or a boat moored alongside, and boats along both sides of each pier (sealife.ts
// floats them). The same for every tile and for the sea's life: hashed from the city.
export interface Mooring { kind: BoatKind; x: number; z: number; yaw: number; paint: number }
export interface Wharf { x: number; z: number; nx: number; nz: number; ex: number; ez: number; len: number }
const PIER_LEN = 34, PIER_W = 5, WHARF_LEN = 36;   // (a wharf fits a stretch of quay between two streets' corners)
export const WHARF_SHIP_L = 84;   // the ship moored at it (sealife.ts), overhanging the wharf's stretch both ways
const harbours = new WeakMap<CityPlan, { piers: { edge: number; x: number; z: number }[]; boats: Mooring[]; wharf: Wharf | null }>();
export function shoreMoorings(plan: CityPlan) {
  let H = harbours.get(plan);
  if (H) return H;
  H = { piers: [], boats: [], wharf: null };
  harbours.set(plan, H);
  if (plan.style.id !== "port") return H;
  const E = plan.shore;
  let wi = -1, wl = WHARF_LEN + 4;
  E.forEach((e, i) => { const L = Math.hypot(e.bx - e.ax, e.bz - e.az); if (L > wl) { wl = L; wi = i; } });
  if (wi >= 0) {
    const e = E[wi], L = Math.hypot(e.bx - e.ax, e.bz - e.az);
    H.wharf = { x: (e.ax + e.bx) / 2, z: (e.az + e.bz) / 2, nx: e.nx, nz: e.nz, ex: (e.bx - e.ax) / L, ez: (e.bz - e.az) / L, len: WHARF_LEN };
  }
  const W = H.wharf;
  // (No pier out across the wharf's ship, where it overhangs the stretches either side.)
  const byShip = (x: number, z: number) => !!W && Math.abs((x - W.x) * W.ex + (z - W.z) * W.ez) < WHARF_SHIP_L / 2 + PIER_W + 4 && (x - W.x) * W.nx + (z - W.z) * W.nz > -PIER_LEN;
  E.forEach((e, i) => {
    if (i === wi) return;   // (the wharf's stretch: nothing else moored there)
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az), ex = (e.bx - e.ax) / L, ez = (e.bz - e.az) / L, { nx, nz } = e, yaw = Math.atan2(-ez, ex);
    const paint = (r: number) => BOAT_PAINTS[Math.floor(r * 97) % BOAT_PAINTS.length];
    for (let k = 0; k < Math.floor(L / 30); k++) {
      const t = (k + 0.5) / Math.floor(L / 30), rx = e.ax + (e.bx - e.ax) * t, rz = e.az + (e.bz - e.az) * t, r = hash2(i, k, plan.seed, 0x91e7);
      if (L >= 45 && r < 0.33 && !byShip(rx, rz)) {
        H!.piers.push({ edge: i, x: rx, z: rz });
        const seed = plan.seed + i * 31 + k, py = Math.atan2(-nz, nx);
        for (const sd of [-1, 1]) for (let k2 = 0; k2 < 2; k2++) {
          const r2 = hash2(seed, k2 * 2 + (sd > 0 ? 1 : 0), 0, 0x9e1);
          if (r2 > 0.7) continue;
          const kind: BoatKind = r2 < 0.3 ? "cruiser" : r2 < 0.5 ? "sailboat" : "rowboat", { beam, len: bl } = boatSize(kind), d = 9 + k2 * 15, off = PIER_W / 2 + 0.8 + beam / 2;
          if (d + bl / 2 > PIER_LEN + 2) continue;
          H!.boats.push({ kind, x: rx + nx * d + ex * sd * off, z: rz + nz * d + ez * sd * off, yaw: py + (r2 < 0.4 ? Math.PI : 0), paint: paint(r2) });
        }
      } else if (r < 0.75) {
        const kind: BoatKind = r < 0.45 ? "cruiser" : r < 0.6 ? "sailboat" : "rowboat", { beam } = boatSize(kind);
        H!.boats.push({ kind, x: rx + nx * (1 + beam / 2), z: rz + nz * (1 + beam / 2), yaw: yaw + (r < 0.55 ? Math.PI : 0), paint: paint(r) });
      }
    }
  });
  return H;
}
// A lifeguard tower on the sand, facing the sea (yaw): legs, a hut with a red roof, a ramp.
function lifeguardTower(s: Batch, x: number, y: number, z: number, yaw: number) {
  const c = Math.cos(yaw), sn = Math.sin(yaw), at = (u: number, v: number): [number, number] => [x + c * u + sn * v, z - sn * u + c * v];
  for (const [u, v] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) { const [px, pz] = at(u, v); s.box(px, y + 1.0, pz, 0.12, 2.0, 0.12, 0xf2f0ea, yaw); }
  const [hx, hz] = at(0, 0); s.box(hx, y + 2.6, hz, 2.0, 1.2, 2.0, 0xf2f0ea, yaw); s.prism(hx, y + 3.45, hz, 2.3, 0.5, 2.3, 0xc0392b, yaw);
  const [wx, wz] = at(1.01, 0); s.box(wx, y + 2.75, wz, 0.02, 0.5, 1.4, 0x26313d, yaw);
  const [rx, rz] = at(-2.0, 0); s.boxR(rx, y + 1.0, rz, 2.6, 0.08, 0.8, 0xc8b8a0, 0, yaw, 0.75);
}

// Which way a polygon winds: +1 if its inside is on the left of each edge, (-z, x) from its
// direction (a positive shoelace sum in x, z), else -1. (A winding river's middle can lie outside
// it: this says which side of each edge is the water.)
function winding(poly: [number, number][]) {
  let A = 0;
  for (let i = 0; i < poly.length; i++) { const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]; A += x0 * z1 - x1 * z0; }
  return A >= 0 ? 1 : -1;
}
// Boats moored along a river stretch's long quays (s: the solid batch, boats.ts models): now and
// then a cruiser, a narrowboat, a yacht or a rowing boat lying alongside, a metre off the wall.
// (None along a bridge's side: water across the street there, or no block at all where the
// town's edge street crosses the river.)
// Boats moored along the river's banks (world coordinates), by water block: every bank's laid out
// together, then any that would lie in one laid out before it left out (round a bend, across a
// narrow stretch from the far bank, where two blocks' banks meet). Worked out once a city.
interface RiverBoat { kind: BoatKind; x: number; z: number; yaw: number; paint: number; r: number }
const RIVER_BOATS = new WeakMap<CityGraph, Map<number, RiverBoat[]>>();
function riverBoats(G: CityGraph, seed: number): Map<number, RiverBoat[]> {
  let out = RIVER_BOATS.get(G);
  if (out) return out;
  out = new Map();
  const kept: RiverBoat[] = [];
  for (const blk of G.blocks) {
    if (!blk.water) continue;
    const poly = blk.poly, wd = winding(poly), mine: RiverBoat[] = [];
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 30) continue;
      const across = G.blockAt((ax + bx) / 2 + (bz - az) / L * wd * 24, (az + bz) / 2 - (bx - ax) / L * wd * 24);
      if (!across || across.water) continue;
      for (let k = 0; k < Math.floor(L / 25); k++) {
        const r = hash2(blk.id * 31 + i, k, seed, 0xb0a7);
        if (r > 0.45) continue;
        const t = (k + 0.5) / Math.floor(L / 25), ex = (bx - ax) / L, ez = (bz - az) / L;
        const nx = -ez * wd, nz = ex * wd;
        // (The Victorian city has no motor cruisers: narrowboats in their place.)
        const kind: BoatKind = r < 0.1 ? "narrowboat" : r < 0.25 ? (CS.victorian ? "narrowboat" : "cruiser") : r < 0.37 ? "sailboat" : "rowboat", { beam, len } = boatSize(kind);
        const b: RiverBoat = { kind, x: ax + (bx - ax) * t + nx * (1 + beam / 2), z: az + (bz - az) * t + nz * (1 + beam / 2),
          yaw: Math.atan2(-ez, ex) + (hash2(blk.id, i * 7 + k, seed, 0xb0a8) < 0.5 ? Math.PI : 0), paint: BOAT_PAINTS[Math.floor(r * 97) % BOAT_PAINTS.length], r: Math.hypot(len, beam) / 2 };
        if (kept.some((o) => Math.hypot(o.x - b.x, o.z - b.z) < o.r + b.r + 0.5)) continue;
        kept.push(b); mine.push(b);
      }
    }
    out.set(blk.id, mine);
  }
  RIVER_BOATS.set(G, out);
  return out;
}
function buildBoats(s: Batch, blk: CBlock, ox: number, oz: number, seed: number, G: CityGraph) {
  for (const b of riverBoats(G, seed).get(blk.id) ?? []) if (inTile(b.x - ox, b.z - oz)) boatAt(s, b.kind, b.x - ox, -1.5, b.z - oz, b.yaw, b.paint);   // (each boat by the tile it lies in)
}

// A city block (tile-local): its site or district buildings. A block of the old grid's shape (a
// 42 m square, sides north, south, west and east) is drawn by the grid's builders in the tile's
// own axes; others, as a plain lot for now.
function buildBlockPart(ground: Batch, solid: Batch, plan: CityPlan, blk: CBlock, ox: number, oz: number, rnd: Rand, takeSlot: ((text: string, style: SignStyle) => ReturnType<SignAtlas["uv"]> | null) | null) {
  const cx = blk.kx, cz = blk.kz, seed = plan.seed, district: District = blk.park ? "park" : plan.district(cx, cz);
  // The freeway's off-ramp and its (super)block: drawn on the freeway's line, whatever its shape.
  if (plan.interchangeAt(cx, cz)) { buildInterchange(ground, solid, plan, blk, ox, oz); return { stalls: [] as StallPose[], site: siteLayout(plan, cx, cz) }; }
  // A city that lists its contents: the block's recipes, as listed.
  if (plan.contents) {
    const dcx = DC.cx, dcz = DC.cz;
    DC.cx = cx; DC.cz = cz; DC.fac = facilityAt(plan, cx, cz); DC.stalls = [];
    // (A site on an anchored block: what is drawn in its frame has its door spots on the anchor's
    // side, as the rules draw it.)
    const site = siteLayout(plan, cx, cz);
    let at: [number, number, number] | null = null, map: typeof DOOR_SPOTS.map = null;
    if (blk.anchor && (site.kind === "dock" || site.kind === "garage" || site.kind === "lot" || site.kind === "stand")) {
      const { face, delta } = blk.anchor, W = plan.graph.facePt(face, delta, 0), [rx, rz] = frameApply({ ox: 0, oz: 0, rot: W.h }, 9, 18), real = blk.sides.indexOf(face);
      at = [W.x - rx, W.z - rz, W.h]; map = (side, a) => (side === 0 ? [real, a + delta] : null);
    }
    const inSite = (r: Recipe) => !!at && !!r.at && Math.abs(r.at[0] - at[0]) < 0.02 && Math.abs(r.at[1] - at[1]) < 0.02;
    for (const r of plan.contents.blocks.get(blk.id) ?? []) {
      DOOR_SPOTS.map = inSite(r) ? map : null;
      try { drawRecipe(r, ground, solid, (fr, fn) => inFrame(fr, [ground, solid, DC.lamps], fn)); } finally { DOOR_SPOTS.map = null; }
    }
    DC.cx = dcx; DC.cz = dcz;
    return { stalls: DC.stalls, site };
  }
  const x0 = Math.min(...blk.poly.map((p) => p[0])), z0 = Math.min(...blk.poly.map((p) => p[1]));
  // (The storybook city's blocks are all built by their lots, whatever their shape; so is a
  // hand-shaped block, square or not, but for a square one with a site, which keeps the grid's.)
  if (!blk.square || CS.storybook || CS.victorian || (plan.fileLots(blk.id) && siteLayout(plan, cx, cz).kind === "kerb")) {
    const dcx = DC.cx, dcz = DC.cz, site = siteLayout(plan, cx, cz);
    DC.cx = cx; DC.cz = cz; DC.fac = facilityAt(plan, cx, cz);
    let stalls: StallPose[] = [];
    if (blk.anchor && (site.kind === "dock" || site.kind === "garage" || site.kind === "lot" || site.kind === "stand")) {
      // A site on its anchor: drawn as on the grid's block (its side 0 against the anchor's
      // face, `delta` along), in that frame; lots round it.
      const { face, delta } = blk.anchor, G = plan.graph, W = G.facePt(face, delta, 0), [rx, rz] = frameApply({ ox: 0, oz: 0, rot: W.h }, 9, 18);
      const fr: Frame2 = { ox: W.x - ox - rx, oz: W.z - oz - rz, rot: W.h }, real = blk.sides.indexOf(face);
      const keep = siteSquare(G, blk.anchor).map(([x, z]) => [x - ox, z - oz] as [number, number]);
      buildLots(ground, solid, plan, blk, ox, oz, district, rnd, keep);
      const L = { ...site, side: 0 } as typeof site;
      DOOR_SPOTS.map = (side, a) => (side === 0 ? [real, a + delta] : null);
      DC.stalls = [];
      try {
        inFrame(fr, [ground, solid, DC.lamps], () => {
          place("asphalt", {}, ground, solid, rnd);
          if (L.kind === "garage") place("garage", { side: 0, open: !CS.storybook }, ground, solid, rnd);
          else if (L.kind === "dock") place("dock", { L: plainOf(L), district, hs: cm2(plan.downtownHeight(cx, cz)) }, ground, solid, rnd);
          else if (L.kind === "lot") place("rentalLot", { L: plainOf(L) }, ground, solid, rnd);
          else if (L.kind === "stand") {
            // (A stand stands in its district's ground, as on the grid's block: a park round it, or
            // an industrial yard with its warehouse behind; not on bare asphalt.)
            const B = { x0: STREET, z0: STREET, x1: BLOCK, z1: BLOCK };
            if (district === "industrial") buildIndustrial(ground, solid, B, rnd, L);
            else if (district === "park") buildPark(ground, solid, B, rnd, standKeepOut(L));
            place("stand", { L: plainOf(L) }, ground, solid, rnd);
          }
        });
      } finally { DOOR_SPOTS.map = null; }
      stalls = DC.stalls;
    } else buildLots(ground, solid, plan, blk, ox, oz, district, rnd);
    DC.cx = dcx; DC.cz = dcz;
    return { stalls, site };
  }
  const f: Frame2 = { ox: x0 - STREET - ox, oz: z0 - STREET - oz, rot: 0 };
  let stalls: StallPose[] = [];
  const site = siteLayout(plan, cx, cz);
  const dcx = DC.cx, dcz = DC.cz;
  DC.cx = cx; DC.cz = cz; DC.fac = facilityAt(plan, cx, cz);
  DC.stalls = [];
  inFrame(f, [ground, solid, DC.lamps], () => {
    // Asphalt under the block (where its buildings leave it bare).
    place("asphalt", {}, ground, solid, rnd);
    const B = { x0: STREET, z0: STREET, x1: BLOCK, z1: BLOCK }, square: [number, number][] = [[B.x0, B.z0], [B.x1, B.z0], [B.x1, B.z1], [B.x0, B.z1]];
    if (site.kind === "garage") place("garage", { side: site.side, open: !CS.storybook }, ground, solid, rnd);
    else if (site.kind === "dock") place("dock", { L: plainOf(site), district, hs: cm2(plan.downtownHeight(cx, cz)) }, ground, solid, rnd);
    else if (site.kind === "lot") place("rentalLot", { L: plainOf(site) }, ground, solid, rnd);
    else if (CS.townSquare && district === "downtown" && plan.coreDistance(cx, cz) < 0.8) place("townSquare", { rect: rectOf(B) }, ground, solid, rnd);
    else if (plan.graph.block(cx, cz)?.id === plan.plaza) { place("ground", { pts: square, top: LOT_TOP, c: "pavers" }, ground, solid, rnd); place("plaza", { pts: square }, ground, solid, rnd); }
    else {
      switch (district) {
        case "downtown": buildDowntown(ground, solid, B, plan.downtownHeight(cx, cz), rnd); break;
        case "commercial": buildCommercial(ground, solid, B, rnd); break;
        case "residential": buildResidential(ground, solid, B, rnd); break;
        case "industrial": buildIndustrial(ground, solid, B, rnd, site.kind === "stand" ? site : null); break;
        case "park": buildPark(ground, solid, B, rnd, site.kind === "stand" ? standKeepOut(site) : null); break;
      }
      if (site.kind === "stand") place("stand", { L: plainOf(site) }, ground, solid, rnd);
      if (facilitySign(plan, cx, cz)) place("bladeSigns", {}, ground, solid, rnd);
      // Main Street towns have a water tower with the town's name, over a back garden.
      if (CS.townSquare && district === "residential" && hash2(cx, cz, seed, 0x77e) < 0.06) place("waterTower", { x: 39, z: 39 }, ground, solid, rnd);
    }
    if ((district === "commercial" || district === "downtown" || district === "industrial") && rnd() < CS.billboards) {
      const sp = billboardSpot(B, rnd);
      if (sp) place("billboard", { r: rectOf(sp.r), top: cm2(sp.top), side: sp.side, ad: sp.ad }, ground, solid, rnd);
    }
  });
  stalls = DC.stalls;
  DC.cx = dcx; DC.cz = dcz;
  return { stalls, site };
}

// (A site's layout as plain data, for its recipe.)
const plainOf = <T,>(L: T): T => JSON.parse(JSON.stringify(L));
// The facility's sign's slot in the sign atlas (null in probe builds, or with no sign).
function facilityUV() {
  const sign = DC.takeSlot ? facilitySign(DC.plan, DC.cx, DC.cz) : null;
  return sign ? DC.takeSlot!(sign.text, sign.style) : null;
}
// The rotation of the frame being drawn in, from the tile's.
function frameRot() { let r = 0; for (const f of PLACED.frames) r += f.rot; return r; }
// The asphalt under a grid block or a site's square (where its buildings leave it bare).
DRAW.asphalt = (_R, g) => { g.box((STREET + BLOCK) / 2, -0.05, (STREET + BLOCK) / 2, BLOCK - STREET, 0.1, BLOCK - STREET, C.asphalt); };
// A parking garage (garage.ts), its ramp on side `side`; `open`, its top deck open.
DRAW.garage = (R, g, s, rnd) => { buildGarage(g, s, R.side as number, rnd, DC.plan.seed, !!R.open); };
// A dock site (facilities.ts DockLayout `L`): its warehouse (or the knitting works) and yard.
DRAW.dock = (R, g, s, rnd) => { buildDockSite(g, s, R.L as DockLayout, R.district as District, R.hs as number, rnd, DC.quads, facilityUV()); };
// A rental lot (facilities.ts LotLayout `L`): its office and stalls; the stalls' trucks' places,
// tile-local, for the fleet.
DRAW.rentalLot = (R, g, s, rnd) => {
  const rot = frameRot();
  for (const p of buildRentalLot(g, s, R.L as LotLayout, rnd, DC.quads, facilityUV())) { [p.x, p.z] = toTile(p.x, p.z); p.h += rot; DC.stalls.push(p); }
};
// A park's or a yard's stand (facilities.ts StandLayout `L`).
DRAW.stand = (R, g, s, rnd) => { buildStand(g, s, R.L as StandLayout, rnd); };
// The Main Street town's square on `rect` (decor.ts buildTownSquare).
DRAW.townSquare = (R, g, s, rnd) => { buildTownSquare(g, s, rectFrom(R.rect), rnd); };
// A facility's blade signs, one on each side of its grid block.
DRAW.bladeSigns = (_R, _g, s) => { const uv = facilityUV(); if (uv) for (let side = 0; side < 4; side++) bladeSign(s, side, DC.quads, uv); };
// The town's water tower with its name, at (x, z).
DRAW.waterTower = (R, _g, s) => { waterTower(s, R.x as number, R.z as number, DC.takeSlot ? DC.takeSlot(DC.plan.name.toUpperCase(), { bg: "#a8c4d8", fg: "#1d2f5a", logo: false }) : null); };
// A billboard on the roof `r` (its top `top`), facing side `side`, its ad (decor.ts AD_POOLS).
DRAW.billboard = (R, _g, s) => { drawBillboard(s, rectFrom(R.r), R.top as number, R.side as number, R.ad as [string, number]); };

// A generator (see ChunkStreamer): the doors in one stage, the block in the next. (Each stage
// runs whole: cityBatches works through module state, CS and DC, that a stage leaves as it found
// it for whatever runs between stages. Sign slots and lamp sites are taken only in the last stage,
// after the last yield, so a build dropped at a yield, ChunkStreamer.clear, holds nothing.)
export function makeCityChunkBuilder(mats: CityMaterials, plan: CityPlan, fleet: FleetBuilder | null = null): (cx: number, cz: number) => ChunkBuild {
  return function* (cx, cz) {
    // The entrance doors of the tile's kerb facilities (one per side, where kerbDoors found the building).
    const G = plan.graph, doors = G.tile(cx, cz).blocks.map((b) => G.blocks[b]).filter((b) => b.inCity).flatMap((b) => kerbDoors(plan, b.kx, b.kz).map((d, side) => d && { d, f: b.sides[side] }));
    yield;
    const slots: number[] = [];
    const takeSlot = (text: string, style: SignStyle) => { const k = signAtlas.alloc(text, style); if (k >= 0) slots.push(k); return k >= 0 ? signAtlas.uv(k) : null; };
    const { ground, solid, lamps, stalls, district } = cityBatches(plan, cx, cz, takeSlot);
    // (Each drawn as on the grid's side 0, in a frame on its face: local (a + 9, n + 18) is the face's (a, n).)
    doors.forEach((e) => {
      if (!e) return;
      const P = G.facePt(e.f, 0, 0), [rx, rz] = frameApply({ ox: 0, oz: 0, rot: P.h }, 9, 18);
      inFrame({ ox: P.x - cx * BLOCK - rx, oz: P.z - cz * BLOCK - rz, rot: P.h }, [solid, ground, lamps], () => entranceDoor(solid, { ...e.d, side: 0 }));
    });
    const group = new THREE.Group();
    for (const [b, m] of [[ground, mats.ground], [solid, mats.solid], [lamps, mats.lamp]] as const) {
      const mesh = b.build(m);
      if (mesh) group.add(mesh);
    }
    let signMesh: SignMesh | null = null;
    if (DC.quads.length) {
      const mesh = new THREE.Mesh(quadGeometry(DC.quads), signAtlas.material);
      group.add(mesh); signMesh = signAtlas.attach(mesh, slots, DC.ads);
    }
    if (DC.mquads.length) group.add(new THREE.Mesh(quadGeometry(DC.mquads), marquee.material));
    const plateMesh = DC.plates?.build() ?? null;
    if (plateMesh) group.add(plateMesh.mesh);
    const pools = DC.pools.build(); if (pools) group.add(pools);
    const lampSites = DC.lampSites.slice();
    if (lampSites.length) LAMP_SITES.set(group, lampSites);   // their light: applyLampLight
    group.userData.onDispose = () => { for (const k of slots) signAtlas.release(k); if (signMesh) signAtlas.detach(signMesh); plateMesh?.dispose(); LAMP_SITES.delete(group); };
    // Kept out of the scene (ChunkStreamer's cache): its lamps light nothing meanwhile. Its sign and
    // plate slots stay held, so it comes back as it was.
    group.userData.onStash = () => { LAMP_SITES.delete(group); };
    group.userData.onRestore = () => { if (lampSites.length) LAMP_SITES.set(group, lampSites); };
    if (stalls.length && fleet) { const f = fleet(stalls); if (f) group.add(f); }
    group.userData.district = district;
    return group;
  };
}

// ---- entrance doors -----------------------------------------------------------------------------
// Where a kerb facility's front door is on each side of its block: found by building the block
// (without signs) and looking in from the sidewalk at head height for the first wall that faces
// the street, near where a truck stopping on that side has its back. The chunk draws a door
// there (entranceDoor), the driver walks to it (journey.ts DOOR_PROBE), and FrontDoorFx opens it.
// Cached per block: a pure function of the city.
// `plain`: a container's cargo doors (locking bars, no windows or light). `wide`: a service door's
// two leaves (set as it is made: a door widened over a painted one keeps its single leaf).
export interface KerbDoor { side: number; a: number; n: number; x: number; z: number; nx: number; nz: number; frame: number; panel: number; half: number; h: number; plain: boolean; wide: boolean; y?: number }   // (y: its sill, when not at the kerb's height)   // world centre of its foot, outward normal, colours, half width and height
const KERB_DOORS = new Map<string, (KerbDoor | null)[]>();
// (Tests: when `out` is set, kerbDoors adds a line for each painted door it leaves showing beside a
// real one. Only blocks worked out while it is set: the doors are cached.)
export const DOOR_CLASHES: { out: string[] | null } = { out: null };
let kerbDoorsSeed = NaN;
const DOOR_PROBE_MAT = new THREE.MeshBasicMaterial();
// The probe's rays, all level: the same test three.js's raycaster makes against a front-side mesh
// (ray.intersectTriangle with back faces culled, hits in order of distance, the face's normal),
// but only against the triangles that reach the ray's height, found once per height. The
// raycaster tries every triangle in the block for every ray, which made a block's doors cost
// several times the block itself.
class LevelProbe {
  private byY = new Map<number, number[]>();
  private ray = new THREE.Ray(); private a = new THREE.Vector3(); private b = new THREE.Vector3(); private c = new THREE.Vector3();
  private p = new THREE.Vector3(); private nrm = new THREE.Vector3();
  constructor(private pos: ArrayLike<number>, private far: number) {}
  private trisAt(y: number) {
    let t = this.byY.get(y);
    if (t) return t;
    t = [];
    const P = this.pos;
    for (let i = 0; i + 8 < P.length; i += 9) {
      const y0 = P[i + 1], y1 = P[i + 4], y2 = P[i + 7];
      if (Math.min(y0, y1, y2) <= y + 1e-6 && Math.max(y0, y1, y2) >= y - 1e-6) t.push(i);
    }
    this.byY.set(y, t);
    return t;
  }
  // Every hit along the ray from `o` in direction `d` (level), nearest first: distance and the face normal's x and z.
  hits(o: THREE.Vector3, d: THREE.Vector3): { distance: number; nx: number; nz: number }[] {
    const out: { distance: number; nx: number; nz: number }[] = [], P = this.pos;
    this.ray.set(o, d);
    for (const i of this.trisAt(o.y)) {
      this.a.set(P[i], P[i + 1], P[i + 2]); this.b.set(P[i + 3], P[i + 4], P[i + 5]); this.c.set(P[i + 6], P[i + 7], P[i + 8]);
      if (!this.ray.intersectTriangle(this.a, this.b, this.c, true, this.p)) continue;
      const distance = o.distanceTo(this.p);
      if (distance > this.far) continue;
      THREE.Triangle.getNormal(this.a, this.b, this.c, this.nrm);
      out.push({ distance, nx: this.nrm.x, nz: this.nrm.z });
    }
    return out.sort((x, y) => x.distance - y.distance);
  }
  first(o: THREE.Vector3, d: THREE.Vector3) { const h = this.hits(o, d); return h.length ? h[0] : null; }
}
// What stands on the pavements round block (bx, bz) and in front of its buildings (street trees,
// lights, furniture, sign posts, yard trees), as world circles, for the driver's walks
// (chores.ts): found by building the chunks that hold the block and its four streets with the
// recorder on. Cached per block, like the doors: a pure function of the city.
export interface PavementObstacle { x: number; z: number; r: number; kind?: number }   // kind: decor.ts PK
// A vehicle parked in a dock's yard, axis-aligned: its middle and half its size along x and z.
export interface ParkedObstacle { x: number; z: number; hx: number; hz: number }
const PAVEMENT_CACHE = new Map<string, PavementObstacle[]>();
let pavementSeed = NaN;
export function pavementObstacles(plan: CityPlan, bx: number, bz: number): PavementObstacle[] {
  if (plan.dressing !== pavementSeed) { PAVEMENT_CACHE.clear(); PARKED_CACHE.clear(); pavementSeed = plan.dressing; }
  const key = `${plan.seed}|${plan.dressing}|${plan.style.id}|${bx},${bz}`;
  const hit = PAVEMENT_CACHE.get(key);
  if (hit) return hit;
  const out: PavementObstacle[] = [], parked: ParkedObstacle[] = [];
  // The tiles that draw the block and its streets (on the grid: its own, which holds its north
  // and west streets, and the next ones east and south).
  const G = plan.graph, blk = plan.blockOf(bx, bz);
  if (!blk) { PAVEMENT_CACHE.set(key, []); PARKED_CACHE.set(key, []); return []; }
  const own = [Math.floor(blk.cx / BLOCK), Math.floor(blk.cz / BLOCK)], tiles = [own];
  for (const f of blk.faces) { const p = G.streetPt(f >> 1, G.streets[f >> 1].len / 2, 0), t = [Math.floor(p.x / BLOCK), Math.floor(p.z / BLOCK)]; if (!tiles.some((q) => q[0] === t[0] && q[1] === t[1])) tiles.push(t); }
  for (const [cx, cz] of tiles) {
    const rec: number[] = [], boxes: number[] = [];
    PAVEMENT.out = rec; PAVEMENT.boxes = boxes; BATCH.dry = true;   // placement only: no geometry (its yard's vehicles, and those parked in its streets)
    try { cityBatches(plan, cx, cz, null); } finally { PAVEMENT.out = PAVEMENT.boxes = null; BATCH.dry = false; }
    for (let i = 0; i < rec.length; i += 4) out.push({ x: cx * BLOCK + rec[i], z: cz * BLOCK + rec[i + 1], r: rec[i + 2], kind: rec[i + 3] });
    for (let i = 0; i < boxes.length; i += 4)
      parked.push({ x: cx * BLOCK + (boxes[i] + boxes[i + 2]) / 2, z: cz * BLOCK + (boxes[i + 1] + boxes[i + 3]) / 2, hx: Math.abs(boxes[i + 2] - boxes[i]) / 2, hz: Math.abs(boxes[i + 3] - boxes[i + 1]) / 2 });
  }
  PAVEMENT_CACHE.set(key, out); PARKED_CACHE.set(key, parked);
  return out;
}
// The vehicles parked in a block's dock yard (world space), from the same probe build.
const PARKED_CACHE = new Map<string, ParkedObstacle[]>();
export function parkedObstacles(plan: CityPlan, bx: number, bz: number): ParkedObstacle[] {
  pavementObstacles(plan, bx, bz);
  return PARKED_CACHE.get(`${plan.seed}|${plan.dressing}|${plan.style.id}|${bx},${bz}`) ?? [];
}

export function kerbDoors(plan: CityPlan, bx: number, bz: number): (KerbDoor | null)[] {
  if (plan.seed !== kerbDoorsSeed) { KERB_DOORS.clear(); kerbDoorsSeed = plan.seed; }   // one city's doors at a time
  const G = plan.graph, blk = plan.blockOf(bx, bz), own = blk ? plan.fileDoors(blk.id) : undefined;
  const key = `${plan.seed}|${plan.style.id}|${bx},${bz}${own ? "|file" : ""}`;   // (a file's doors apart from those worked out: test/doors.ts compares them)
  const hit = KERB_DOORS.get(key);
  if (hit) return hit;
  const none: (KerbDoor | null)[] = (blk?.sides ?? [0, 0, 0, 0]).map(() => null);
  const fac = facilityAt(plan, bx, bz), site = siteLayout(plan, bx, bz);
  if (!blk) { KERB_DOORS.set(key, none); return none; }
  // A side's frontage point (world) and the way out of the block to the street there.
  const fp = (side: number, a: number, n: number) => G.facePt(blk.sides[side], a, n);
  const outward = (side: number, a: number): [number, number] => { const h = fp(side, a, 0).h; return [-Math.sin(h), -Math.cos(h)]; };
  // A catalogue city's doors: its file's. (Only a city with none listed for the block works them
  // out from its buildings, below: the drafting tool, tools/cityfiles.ts.)
  if (own) {
    const out = none.map((_, side) => {
      const d = own.find((o) => o.side === side);
      if (!d) return null;
      const P = fp(side, d.a, d.n), [nx, nz] = outward(side, d.a);
      return { side, a: d.a, n: d.n, x: P.x, z: P.z, nx, nz, frame: d.frame, panel: d.panel, half: d.half, h: d.h, plain: !!d.plain, wide: !!d.wide, ...(d.y !== undefined ? { y: d.y } : {}) };
    });
    KERB_DOORS.set(key, out); return out;
  }
  if (fac && site.kind === "garage") {
    // On the roof: the stair tower's door, beside the lane where trucks stop.
    const [a0, n] = GARAGE_DOOR, a = a0 + plan.siteDelta(bx, bz), P = fp(site.side, a, n), [nx, nz] = outward(site.side, a), out = none.slice();
    out[site.side] = { side: site.side, a, n, x: P.x, z: P.z, nx, nz, frame: 0xf2efe8, panel: 0x23365e, half: DOOR_HALF, h: DOOR_H, plain: false, wide: false, y: GARAGE_H };
    KERB_DOORS.set(key, out); return out;
  }
  if (!fac || (site.kind !== "kerb" && site.kind !== "stand")) { KERB_DOORS.set(key, none); return none; }
  // (The block is drawn by the tile its centroid is in, in that tile's coordinates.)
  const tx = Math.floor(blk.cx / BLOCK), tz = Math.floor(blk.cz / BLOCK), ox = tx * BLOCK, oz = tz * BLOCK;
  const spots: number[] = [];
  DOOR_SPOTS.out = spots; DOOR_SPOTS.bx = bx; DOOR_SPOTS.bz = bz;
  let built: ReturnType<typeof cityBatches>;
  try { built = cityBatches(plan, tx, tz, null); } finally { DOOR_SPOTS.out = null; }
  const out = none.slice();
  // A facility that loads flatbeds by forklift, or takes pallets in and out on the pallet jack,
  // has wide double service doors (facilities.ts wideDoor).
  const [half, dh] = wideDoor(fac) ? [WIDE_DOOR_HALF, WIDE_DOOR_H] : [DOOR_HALF, DOOR_H];
  const door = (side: number, a: number, n: number): KerbDoor => {
    const P = fp(side, a, n), [nx, nz] = outward(side, a);
    const r = (salt: number) => hash2(bx * 7 + side, bz, plan.seed, salt);
    return { side, a, n, x: P.x, z: P.z, nx, nz,
      frame: [0xf2efe8, 0x2a2b2e, 0x5b4636][Math.floor(r(1) * 3)], panel: [0x7a2b22, 0x23365e, 0x2e5a3a, 0x5b4636, 0xd8d2c4, 0x3a3c40][Math.floor(r(2) * 6)], half, h: dh, plain: false, wide: half > DOOR_HALF };
  };
  // Where the truck's back is, stopped centred on a side.
  const back = (side: number) => (G.faceA0(blk.sides[side]) + G.faceA1(blk.sides[side])) / 2 - 5;
  // Doors the builders placed themselves (row houses, park stands): the one nearest the truck's back.
  for (let i = 0; i < spots.length; i += SPOT) {
    const side = spots[i], a = spots[i + 1], cur = out[side];
    if (cur && Math.abs(a - back(side)) >= Math.abs(cur.a - back(side))) continue;
    const dd = out[side] = door(side, a, spots[i + 2]), [, , , h, hf, panel, frame, plain] = spots.slice(i, i + SPOT);
    if (h) dd.h = h;
    if (hf) { dd.half = hf; dd.wide = hf > DOOR_HALF; }
    if (panel >= 0) dd.panel = panel;
    if (frame >= 0) dd.frame = frame;
    dd.plain = plain > 0;
  }
  // The walls the tile's facades paint a door on (overPaintedDoor), taken before the probe's mesh
  // takes the batch.
  const walls = paintedDoorWalls(built.solid.view());
  // Elsewhere, look for a wall to put one in (a park has none).
  const mesh = site.kind === "kerb" && out.some((d) => !d) ? built.solid.build(DOOR_PROBE_MAT) : null;
  if (mesh) {
    const probe = new LevelProbe(mesh.geometry.getAttribute("position").array, 24), o = new THREE.Vector3(), dir = new THREE.Vector3();
    // (In the tile's coordinates, as the probe mesh is.)
    const lp = (side: number, a: number, n: number): [number, number] => { const P = fp(side, a, n); return [P.x - ox, P.z - oz]; };
    for (let side = 0; side < out.length; side++) {
      if (out[side]) continue;
      const f = blk.sides[side], A0 = G.faceA0(f), A1 = G.faceA1(f), a25 = back(side);
      for (let k = 0; k <= 30; k++) {
        let a = a25 + (k % 2 ? -1 : 1) * Math.ceil(k / 2);   // 25, 24, 26, 23, ... out to 10 and 40 (on the grid)
        // From the middle of the pavement (n is measured from the block's edge, the back of the
        // pavement), in towards the block: the first wall facing the street at or behind the
        // block's edge (trees, poles and signs on the pavement don't count), not too far back.
        const [px, pz] = lp(side, a, -1.8), [onx, onz] = outward(side, a), rx = -onx, rz = -onz;
        o.set(px, 2.0, pz); dir.set(rx, 0, rz);
        let n = -99;
        for (const h of probe.hits(o, dir)) {
          const nn = -1.8 + h.distance;
          if (nn < -0.3) continue;
          if (h.nx * rx + h.nz * rz > -0.7) break;   // something else in the way
          n = nn; break;
        }
        if (n < -0.3 || n > 16) continue;
        // The facade's windows are painted one to a bay, centred, so the door goes between two
        // of them: find the wall's ends (where the ray stops meeting it at the same depth), split
        // it into bays as facadeBox does, and take the bay boundary nearest the truck's back.
        const at = (aa: number) => {
          const [qx, qz] = lp(side, aa, -1.8);
          o.set(qx, 1.0, qz);
          const h2 = probe.first(o, dir);
          return h2 ? -1.8 + h2.distance : 99;
        };
        let w0 = a, w1 = a;
        while (w0 > A0 && Math.abs(at(w0 - 0.25) - n) < 0.05) w0 -= 0.25;
        while (w1 < A1 && Math.abs(at(w1 + 0.25) - n) < 0.05) w1 += 0.25;
        const len = w1 - w0, bays = Math.max(1, Math.round(len / BAY));
        // (A wide service door takes a whole bay, over its window.)
        const wideD = half > DOOR_HALF;
        if (wideD ? len < 2 * half + 0.6 : bays < 2) continue;    // one window, nowhere to put a door
        let best = -1;
        for (let i = wideD ? 0 : 1; i < bays; i++) { const b = w0 + (len * (wideD ? i + 0.5 : i)) / bays; if (best < 0 || Math.abs(b - a25) < Math.abs(best - a25)) best = b; }
        a = best;
        // Room for the door: the wall is there a door's width either side too.
        let wide = true;
        for (const da of [-half - 0.1, half + 0.1]) {
          const [qx, qz] = lp(side, a + da, n - 0.4);
          o.set(qx, 1.2, qz);
          const h2 = probe.first(o, dir);
          if (!h2 || h2.distance > 0.6) { wide = false; break; }
        }
        if (!wide) continue;
        out[side] = door(side, a, n);
        break;
      }
    }
    mesh.geometry.dispose();
  }
  for (let side = 0; side < out.length; side++) { const d = out[side]; if (d && !d.plain) out[side] = overPaintedDoor(walls, d, fp, ox, oz); }
  // (Tests: a painted door left within a metre of a door it doesn't cover. A wide door can't
  // cover the next shop's door 3.4 m on, and doesn't try.)
  if (DOOR_CLASHES.out) for (const d of out) {
    if (!d || d.plain || d.wide) continue;
    const F = d.half + 0.1;
    for (const p of paintedDoorsAlong(walls, d, fp, ox, oz)) {
      if (p.l >= -F - 0.01 && p.r <= F + 0.01) continue;
      const gap = Math.max(-F - p.r, p.l - F);
      if (gap < 1) DOOR_CLASHES.out.push(`block ${bx},${bz} side ${d.side}: a painted door ${gap.toFixed(2)} m from the real one at a=${d.a.toFixed(2)}`);
    }
  }
  KERB_DOORS.set(key, out);
  return out;
}
// The wall quads in a batch's vertices whose tile paints a door (PAINTED_DOORS): corners (a, b) in
// plan, foot ay and top y1, and its tile coordinates u0..u1 across, v0..v1 up.
interface DoorWall { ax: number; ay: number; az: number; bx: number; bz: number; y1: number; u0: number; u1: number; v0: number; v1: number; pd: readonly [number, number, number] }
function paintedDoorWalls(v: ReturnType<Batch["view"]>): DoorWall[] {
  const { pos, aux, count } = v, out: DoorWall[] = [];
  if (!aux) return out;
  // (A wall is six vertices, the first three its corners (0,0), (1,0), (1,1); primitives' aux.z < 0.)
  for (let i = 0; i < count;) {
    const k = i * 3, tile = aux[k + 2];
    if (tile < 0) { i++; continue; }
    i += 6;
    const pd = PAINTED_DOORS[tile % FACADE_KINDS];
    if (pd) out.push({ ax: pos[k], ay: pos[k + 1], az: pos[k + 2], bx: pos[k + 3], bz: pos[k + 5], y1: pos[k + 7], u0: aux[k], u1: aux[k + 3], v0: aux[k + 1], v1: aux[k + 7], pd });
  }
  return out;
}
// A door the facade paints where the real one goes (a house's front door, a shop's, a lobby's:
// PAINTED_DOORS) would show beside or behind it. Find the nearest on the same wall's ground floor
// (in `walls`, in the block's tile's coordinates, origin (ox, oz) in the world) within REACH of
// the real door, and move the real door over it, big enough to hide it: kept inside the
// painted door's bay where it fits, so it covers no more of the next bay's window than it must.
// (How far beyond the real door's frame a painted one still reads as a second door beside it.)
const REACH = 1.5;
function overPaintedDoor(walls: DoorWall[], d: KerbDoor, fp: FacePt, ox: number, oz: number): KerbDoor {
  const sill = d.y ?? CURB_H, F = d.half + 0.1;   // (F: the frame's half width)
  let best: PaintedDoor | null = null;
  for (const p of paintedDoorsAlong(walls, d, fp, ox, oz)) {
    if (p.r < -F - REACH || p.l > F + REACH) continue;
    if (!best || Math.abs(p.l + p.r) < Math.abs(best.l + best.r)) best = p;
  }
  if (!best) return d;
  const { l, r, top, b0, b1 } = best, G = Math.max(F, (r - l) / 2 + 0.03), pc = (l + r) / 2;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const lo = Math.max(r - G, b0 + G), hi = Math.min(l + G, b1 - G);
  const c = lo <= hi ? clamp(pc, lo, hi) : clamp(pc, r - G, l + G);
  const a = d.a + c, P = fp(d.side, a, d.n);
  return { ...d, a, x: P.x, z: P.z, half: G - 0.1, h: Math.max(d.h, top - sill - 0.1) };
}
// The doors painted on the ground floor of door d's wall (in `walls`): each one's span l..r along
// the frontage from d's middle, its bay's b0..b1, and the height of its top.
type FacePt = (side: number, a: number, n: number) => { x: number; z: number };
interface PaintedDoor { l: number; r: number; top: number; b0: number; b1: number }
function paintedDoorsAlong(walls: DoorWall[], d: KerbDoor, fp: FacePt, ox: number, oz: number): PaintedDoor[] {
  const P0 = fp(d.side, d.a, d.n), P1 = fp(d.side, d.a + 1, d.n), cx = P0.x - ox, cz = P0.z - oz;
  const tl = Math.hypot(P1.x - P0.x, P1.z - P0.z) || 1, tx = (P1.x - P0.x) / tl, tz = (P1.z - P0.z) / tl;
  const along = (x: number, z: number) => (x - cx) * tx + (z - cz) * tz;
  const sill = d.y ?? CURB_H, out: PaintedDoor[] = [];
  for (const { ax, ay, az, bx, bz, y1, u0, u1, v0, v1, pd } of walls) {
    const wx = bx - ax, wz = bz - az, wl = Math.hypot(wx, wz);
    if (wl < 0.01 || u1 <= u0 || v1 <= v0) continue;
    // Facing the street as the door does, in its plane, with a row of tiles at its sill.
    if ((-wz * d.nx + wx * d.nz) / wl < 0.95 || Math.abs((ax - cx) * d.nx + (az - cz) * d.nz) > 0.2) continue;
    const fh = (y1 - ay) / (v1 - v0), j = Math.ceil(v0 - 1e-6), yb = ay + (j - v0) * fh;
    if (j >= v1 || Math.abs(yb - sill) > 0.4) continue;
    const top = yb + fh * (1 - pd[2] / FACADE_TILE);
    const at = (u: number) => { const s = (u - u0) / (u1 - u0); return along(ax + wx * s, az + wz * s); };
    for (let m = Math.floor(u0); m < u1; m++) {
      const p0 = at(m + pd[0] / FACADE_TILE), p1 = at(m + pd[1] / FACADE_TILE), q0 = at(m), q1 = at(m + 1);
      const l = Math.min(p0, p1), r = Math.max(p0, p1);
      if (m + pd[1] / FACADE_TILE <= u0 || m + pd[0] / FACADE_TILE >= u1) continue;   // (the tile's door is off this piece of wall)
      out.push({ l, r, top, b0: Math.min(q0, q1), b1: Math.max(q0, q1) });
    }
  }
  return out;
}
// A builder's own door for a block side (frontage a, n: the wall's face, and a height when it
// can't take the usual one), for kerbDoors.
// (`map`: while a site is drawn in the grid's frame on an anchored block, its side 0 is that
// block's anchor side, its frontage `delta` further on; its other sides are inside the block.)
// (`bx`, `bz`: the block whose doors are wanted; a tile draws others too, whose spots are not its.)
const DOOR_SPOTS: { out: number[] | null; bx: number; bz: number; map: ((side: number, a: number) => [number, number] | null) | null } = { out: null, bx: 0, bz: 0, map: null };
interface SpotLook { h?: number; half?: number; panel?: number; frame?: number; plain?: boolean }
const SPOT = 8;
const doorSpot = (side: number, a: number, n: number, o: SpotLook = {}) => {
  if (!DOOR_SPOTS.out || DC.cx !== DOOR_SPOTS.bx || DC.cz !== DOOR_SPOTS.bz) return;
  if (DOOR_SPOTS.map) { const m = DOOR_SPOTS.map(side, a); if (!m) return; [side, a] = m; }
  DOOR_SPOTS.out?.push(side, a, n, o.h ?? 0, o.half ?? 0, o.panel ?? -1, o.frame ?? -1, o.plain ? 1 : 0);
};
// A front door on the wall: frame, panel with a window, a step and a light over it. A wide service
// door: two leaves with a window each, a flush sill for the forklift instead of the step.
function entranceDoor(s: Batch, d: KerbDoor) {
  const side = d.side, a = d.a, n = d.n, frame = d.frame, panel = d.panel, H = d.half, DH = d.h, wide = d.wide;
  const y0 = CURB_H;
  fspan(s, side, a - H - 0.09, a + H + 0.09, y0, y0 + DH + 0.12, n - 0.06, n + 0.01, frame);   // (a cm short of a wall's end it may be set against: shared planes flicker)
  fspan(s, side, a - H, a + H, y0, y0 + DH, n - 0.09, n - 0.05, panel);
  if (d.plain) {
    // Cargo doors: four locking bars with their cams (inside the doorway's own depth, so they go
    // with the leaves when it opens: FrontDoorFx), no windows, no light.
    for (const k of [-0.62, -0.22, 0.22, 0.62]) fspan(s, side, a + k * H - 0.025, a + k * H + 0.025, y0 + 0.15, y0 + DH - 0.15, n - 0.1, n - 0.09, 0x8d9296);
    fspan(s, side, a - 0.025, a + 0.025, y0, y0 + DH, n - 0.1, n - 0.09, shade(panel, 0.6));
    return;
  }
  if (wide) {
    fspan(s, side, a - 0.03, a + 0.03, y0, y0 + DH, n - 0.1, n - 0.09, shade(panel, 0.6));                        // the leaves' meeting line
    for (const k of [-1, 1]) fspan(s, side, a + k * H / 2 - 0.3, a + k * H / 2 + 0.3, y0 + 1.5, y0 + 2.1, n - 0.1, n - 0.09, 0x2a3644);
    fspan(s, side, a - H, a + H, y0, y0 + 0.035, n - 0.14, n, 0x9d9a91);                                          // sill (above a garden path's top: shared planes flicker)
  } else {
    fspan(s, side, a - H + 0.15, a + H - 0.15, y0 + 1.25, y0 + 1.9, n - 0.1, n - 0.09, 0x2a3644);   // window
    fspan(s, side, a - H - 0.25, a + H + 0.25, 0, y0 + 0.03, n - 0.5, n, 0x9d9a91);                 // step (above a garden path's top: shared planes flicker)
  }
  // (Off a shop's awning, 3.3 to 3.42 m up, over a door made tall to hide a painted one: just
  // under it where the door leaves room, else just over it.)
  let ly = y0 + DH + 0.3;
  if (ly + 0.15 > y0 + AWNING_Y && ly < y0 + AWNING_Y + AWNING_T) ly = y0 + (DH + 0.12 + 0.15 <= AWNING_Y ? AWNING_Y - 0.15 : AWNING_Y + AWNING_T + 0.02);
  fspan(s, side, a - 0.12, a + 0.12, ly, ly + 0.15, n - 0.2, n - 0.005, 0x2a2b2e);                         // light (its back off the wall's plane, which a marquee's shares)
}
export const DOOR_HALF = 0.55, DOOR_H = 2.25, WIDE_DOOR_HALF = 1.2, WIDE_DOOR_H = 2.7;

// ---- frontages ------------------------------------------------------------------------------
// A block side in its goal's frame (facilities.ts, "site layouts"): node centre in chunk-local
// coordinates and the direction of travel. The right of travel (into the block) is
// RIGHT[dir]; FACE_OF gives the facadeBox side (+z, +x, -z, -x) that looks out to the street.
export const FRONT_NODE: [number, number, number][] = [[9, 9, 0], [69, 69, 2], [9, 69, 1], [69, 9, 3]];
const FWD: [number, number][] = [[1, 0], [0, -1], [-1, 0], [0, 1]];
const RIGHT: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const FACE_OF = [2, 0, 3, 1];
export function frontPt(side: number, a: number, n: number): [number, number] {
  const [x, z, d] = FRONT_NODE[side];
  return [x + FWD[d][0] * a + RIGHT[d][0] * (9 + n), z + FWD[d][1] * a + RIGHT[d][1] * (9 + n)];
}
function frontRect(side: number, a0: number, a1: number, n0: number, n1: number): Rect {
  const [x0, z0] = frontPt(side, a0, n0), [x1, z1] = frontPt(side, a1, n1);
  return { x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) };
}
function fspan(b: Batch, side: number, a0: number, a1: number, y0: number, y1: number, n0: number, n1: number, color: number) {
  const r = frontRect(side, a0, a1, n0, n1);
  b.span(r.x0, y0, r.z0, r.x1, y1, r.z1, color);
}
// Yaw that turns a quad (facing +z) to face direction (dx, dz).
export const faceYaw = (dx: number, dz: number) => Math.atan2(dx, dz);
// A sign quad on side `side` at frontage (a, n), facing (dx, dz) in chunk axes.
function signQuad(quads: Quad[], uv: ReturnType<SignAtlas["uv"]>, side: number, a: number, n: number, y: number, w: number, h: number, dx: number, dz: number) {
  const [x, z] = frontPt(side, a, n);
  quads.push({ x, z, y, w, h, rotY: faceYaw(dx, dz), ...uv });
}

// What a sidewalk must leave room for: a dock's driveway (no kerb, trees or lights) and a blade
// sign (no tree under it), in frontage `a` of block (bx, bz)'s side `side`.
// `clear`: a stretch kept free of street trees and lights; `free`: of the bins and hydrants too
// (where the truck's crew walks to a stand's counter).
export interface Frontage { side: number; drive: [number, number] | null; sign: number | null; clear?: [number, number]; free?: boolean }
export const BLADE_A = 31.5;
// The block side whose frontage ends at the corner where side i's begins. A dock's bay is near
// that corner, and the side view of a truck working there looks back across it, so that side
// keeps most of its length free of street trees and lights.
const PREV_SIDE = [2, 3, 1, 0];
export function streetFrontage(plan: CityPlan, bx: number, bz: number, side: number): Frontage {
  const blk = plan.blockOf(bx, bz);
  if (!blk?.inCity) return { side, drive: null, sign: null };   // countryside
  const L = siteLayout(plan, bx, bz), dl = plan.siteDelta(bx, bz), mv = (r: [number, number]): [number, number] => [r[0] + dl, r[1] + dl];
  if (L.kind === "dock") return { side, drive: L.side === side ? mv([Math.min(...dockUsedBays(L).map((i) => L.bays[i])) - 4.5, Math.max(...dockUsedBays(L).map((i) => L.bays[i])) + 18]) : null, sign: null,
    clear: blk.square && PREV_SIDE[L.side] === side ? [16, 51] : undefined };
  if (L.kind === "garage") return { side, drive: L.side === side ? mv(GARAGE_DRIVE) : null, sign: null };
  if (L.kind === "interchange") {
    // The kerb cut where the way down crosses this side's sidewalk, if it does: in the freeway
    // line's frontage, moved to this face's (whose start is that far along the line).
    const G = plan.graph, f = plan.blockOf(bx, bz)?.sides[side] ?? -1, ic = plan.interchange!;
    if (f < 0) return { side, drive: null, sign: null };
    // (Measured along the line itself, not clamped to its first face: the ramp's foot is on the third.)
    const f0 = interchangeFace(plan), N = G.nodes[G.dedgeFrom(f)], P0 = G.facePt(f0, 0, -STREET / 2);
    const off = (N.x - P0.x) * Math.cos(P0.h) - (N.z - P0.z) * Math.sin(P0.h), n = (N.x - P0.x) * Math.sin(P0.h) + (N.z - P0.z) * Math.cos(P0.h) - STREET / 2;
    const along = Math.abs(angleDiff(G.dedgeStartH(f) - G.dedgeStartH(f0))) < 0.01 && Math.abs(n + STREET / 2) < 0.5;   // (a face on the line)
    const [d0, d1] = interchangeDrive(plan), drive: [number, number] = [d0 - off, d1 - off];
    return { side, drive: along && drive[1] > 0 && drive[0] < G.faceLen(f) ? drive : null, sign: null };
  }
  if (L.kind === "kerb" && hasSign(facilityAt(plan, bx, bz))) return { side, drive: null, sign: BLADE_A };
  // (On the stand's own side, its sign moves along with it, as its clear stretch does: else, on an
  // anchored block, the post could stand in the stand's way.)
  if (L.kind === "stand") { const b = standBox(L); return { side, drive: null, sign: L.side === side ? BLADE_A + dl : BLADE_A, clear: L.side === side ? mv([b.a0 - 1, b.a1 + 0.5]) : undefined, free: L.side === side }; }
  return { side, drive: null, sign: null };
}
// Where a block side's blade sign hangs (its frontage a), or null: as buildStreet draws it.
export function bladeSignA(plan: CityPlan, bx: number, bz: number, side: number): number | null { return streetFrontage(plan, bx, bz, side).sign; }
// Frontage `a` to the street segment's own `along` coordinate (see buildStreet).
const frontAlong = (side: number, a: number) => (side === 0 || side === 3 ? 9 + a : 69 - a);

// A double-sided blade sign over the sidewalk, hung from a post at the back of it.
function bladeSign(s: Batch, side: number, quads: Quad[], uv: ReturnType<SignAtlas["uv"]>) {
  const a = BLADE_A, d = FRONT_NODE[side][2], [fx, fz] = FWD[d];
  const y0 = CURB_H + 4.15, y1 = y0 + 0.4;
  fspan(s, side, a - 0.07, a + 0.07, CURB_H, y1 + 0.25, -0.32, -0.18, C.pole);
  { const [px, pz] = frontPt(side, a, -0.25); pavementObstacle(px, pz, 0.12); }
  fspan(s, side, a - 0.05, a + 0.05, y1 + 0.12, y1 + 0.2, -2.6, -0.18, C.pole);
  fspan(s, side, a - 0.04, a + 0.04, y0 - 0.04, y1 + 0.04, -2.55, -0.35, C.dark);
  for (const k of [1, -1]) signQuad(quads, uv, side, a + k * 0.05, -1.45, (y0 + y1) / 2, 2.1, 0.4, fx * k, fz * k);
}

// ---- streets --------------------------------------------------------------------------------
// One street segment of the chunk: axis 0 runs east-west (x in [18, 60), z in [0, 18)), axis 1
// north-south (z in [18, 60), x in [0, 18)). `along`/`across` are the segment's own coordinates.
// `loAl`/`hiAl`: each side's frontage a to this segment's along; [a0, a1]: the segment between the
// intersections' mouths; `feat`: an elevated line or the freeway overhead (their bents), and where
// the freeway's off-ramp crosses the sidewalk.
// A town's plaza over a whole block (poly, local): a fountain in the middle (a stone basin, water,
// a tiered spire), a ring of trees round it, benches facing it between them, a streetlight at each
// quarter; all clear of the block's edge.
function buildPlaza(g: Batch, s: Batch, poly: [number, number][], rnd: Rand) {
  let A = 0, cx = 0, cz = 0;
  for (let k = 0; k < poly.length; k++) { const [x0, z0] = poly[k], [x1, z1] = poly[(k + 1) % poly.length], w = x0 * z1 - x1 * z0; A += w; cx += (x0 + x1) * w; cz += (z0 + z1) * w; }
  cx /= 3 * A; cz /= 3 * A;
  const room = polyDist(poly, cx, cz), R = Math.min(5, room * 0.25), y = CURB_H;
  // (A border of darker paving round the fountain, its basin, water, and the spire's tiers.)
  g.cyl(cx, y + 0.01, cz, R + 2.2, 0.02, shade(CS.pavers, 0.85), 24);
  s.cyl(cx, y + 0.3, cz, R, 0.6, 0xbab2a2, 24);
  s.cyl(cx, y + 0.55, cz, R - 0.35, 0.06, 0x4a7fa8, 24);
  s.cyl(cx, y + 1.0, cz, 0.45, 1.6, 0xbab2a2, 10);
  s.cyl(cx, y + 1.85, cz, 1.4, 0.18, 0xbab2a2, 16);
  s.cyl(cx, y + 2.3, cz, 0.25, 0.9, 0xbab2a2, 8);
  s.cyl(cx, y + 2.8, cz, 0.7, 0.12, 0xbab2a2, 12);
  // (The ring of trees, as many as fit clear of the edge; a bench between each two, facing in.)
  const rr = Math.min(room - 3, R + 7.5), n = Math.max(4, Math.min(10, Math.floor(rr * Math.PI * 2 / 7)));
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
    if (inPoly(poly, x, z) && polyDist(poly, x, z) > 2.5) { g.cyl(x, y + 0.01, z, 1.1, 0.02, 0x5a4a3a, 10); cityTree(s, x, y, z, range(rnd, 6, 8), range(rnd, 1.8, 2.4), pick(rnd, CS.trees.greens), rnd); }
    const b = a + Math.PI / n, bx = cx + Math.cos(b) * (rr - 1.5), bz = cz + Math.sin(b) * (rr - 1.5);
    if (!inPoly(poly, bx, bz) || polyDist(poly, bx, bz) < 2) continue;
    const ux = Math.cos(b), uz = Math.sin(b), tx = -uz, tz = ux;   // (out from the fountain, and along the bench)
    for (const [w, h, d, up] of [[1.8, 0.08, 0.45, 0.45], [1.8, 0.4, 0.08, 0.7]] as const) {
      const ox = up > 0.6 ? ux * 0.22 : 0, oz = up > 0.6 ? uz * 0.22 : 0;
      s.box(bx + ox, y + up, bz + oz, w, h, d, 0x7a5a3a, Math.atan2(-tz, tx));
    }
    pavementObstacle(bx, bz, 1.0, PK.bench);
  }
  for (let k = 0; k < 4; k++) {
    const a = (k + 0.5) * Math.PI / 2, x = cx + Math.cos(a) * (rr + 3), z = cz + Math.sin(a) * (rr + 3);
    if (!inPoly(poly, x, z) || polyDist(poly, x, z) < 1.5) continue;
    pavementObstacle(x, z, 0.15, PK.lamp);
    // (The Victorian city's is a gas lamp: victorian-street.ts.)
    if (CS.victorian) { const l = vicLamp(s, x, z, cx, cz, y); DC.lampSites.push(l[0], l[1], l[2]); continue; }
    s.cyl(x, y + 2.2, z, 0.08, 4.4, C.pole, 6); s.aux.set(0, 0, -2); s.cyl(x, y + 4.5, z, 0.28, 0.4, C.lampHead, 8); s.aux.set(0, 0, -1);
    DC.lampSites.push(x, y + 4.4, z);
  }
}
// A one-way street's markings (driven +along: its traffic in the forward half, to the right): a
// solid edge line down the middle and a dashed line between its two lanes; and in the other half a
// green bike lane beside the traffic, and by the kerb a loading lane of 6.5 m bays, some with a
// van or car parked in them, every third a loading zone (yellow kerb), all clear of the corners.
type BoxFn = (b: Batch, al: number, y: number, ac: number, lal: number, h: number, lac: number, color: number) => void;
function oneWayMarkings(g: Batch, s: Batch, box: BoxFn, axis: 0 | 1, a0: number, a1: number, salt: number) {
  const cl = STREET / 2, sg = axis === 0 ? 1 : -1, M = 0.012, MH = 0.02, len = a1 - a0, mid = (a0 + a1) / 2;
  box(g, mid, M, cl + sg * 0.1, len - 8, MH, 0.12, C.white);
  for (let p = a0 + 6; p + 3 <= a1 - 6; p += 9) box(g, p + 1.5, M, cl + sg * 3, 3, MH, 0.12, C.white);
  // (The bike lane: green, edged white on its kerb side.)
  box(g, mid, M * 0.6, cl - sg * 1.0, len - 8, MH * 0.6, 1.6, 0x3d7a52);
  box(g, mid, M, cl - sg * 1.9, len - 8, MH, 0.12, C.white);
  // (The loading lane: its bays between 12 m clear of either end.)
  const lane = cl - sg * 4.6, kerb = cl - sg * 5.9, b0 = a0 + 12, n = Math.floor((a1 - 12 - b0) / 6.5);
  for (let i = 0; i <= n; i++) box(g, b0 + i * 6.5, M, lane, 0.12, MH, 2.2, C.white);
  for (let i = 0; i < n; i++) {
    const p = b0 + (i + 0.5) * 6.5, r = hash2(Math.round(p * 10), salt, (0x10ad + DC.plan.dressing) | 0, Math.round(a0));
    if (i % 3 === 1) box(g, p, CURB_H + 0.01, kerb + sg * 0.05, 6.3, 0.02, 0.1, C.yellow);
    if (r < 0.55 && !CS.storybook && !CS.victorian) {   // (the storybook city has none: it has only its own vehicles, storyvehicles.ts)
      // (Parked facing the traffic's way: +along.)
      const kind: CarKind = i % 3 === 1 ? "van" : carKindAt(r * 7 % 1, false), [x, z] = axis === 0 ? [p, lane] : [lane, p];
      parkedCar(s, kind, x, 0.005, z, axis === 0 ? 0 : -Math.PI / 2, carPaintAt(r));
      // (For a driver's walk across the street to go round, the far kerb's: its footprint, a little over.)
      const hl = kind === "van" ? 2.6 : 2.3, hw = 1.0;
      if (axis === 0) parkedObstacle(x - hl, z - hw, x + hl, z + hw); else parkedObstacle(x - hw, z - hl, x + hw, z + hl);
    }
  }
}
// The Victorian city's setts are laid in courses SETT_COURSE across (m), its pavement flags FLAG_LEN long.
const SETT_COURSE = 0.6, FLAG_LEN = 1.2;
function buildStreet(g: Batch, s: Batch, axis: 0 | 1, district: District, rnd: Rand, loF: Frontage, hiF: Frontage,
  loAl: (a: number) => number, hiAl: (a: number) => number, a0: number, a1: number, feat: { el: boolean; fw: boolean; icClear: [number, number] | null; oneway?: boolean; ring?: boolean; loading?: (number | null)[]; median?: boolean; wet?: boolean[]; salt?: number; posts?: { right: boolean; s: number; r: number }[]; furniture?: [FurnitureItem[], FurnitureItem[]] | null }) {
  const box = (b: Batch, al: number, y: number, ac: number, lal: number, h: number, lac: number, color: number) =>
    axis === 0 ? b.box(al, y, ac, lal, h, lac, color) : b.box(ac, y, al, lac, h, lal, color);
  const len = a1 - a0, mid = (a0 + a1) / 2, cl = STREET / 2;
  // A flat quad on the ground batch, from u0 to u1 along and v0 to v1 across, at height y.
  const flat = (u0: number, u1: number, v0: number, v1: number, y: number, color: number) => {
    const P = (u: number, v: number): [number, number] => axis === 0 ? [u, v] : [v, u];
    const [ax, az] = P(u0, v0), [bx, bz] = P(u1, v0), [cx, cz] = P(u1, v1), [dx, dz] = P(u0, v1);
    g.tri(ax, y, az, bx, y, bz, cx, y, cz, color); g.tri(ax, y, az, cx, y, cz, dx, y, dz, color);
  };
  // The street's asphalt (kerb to kerb, and under the sidewalks).
  box(g, mid, -0.05, cl, len, 0.1, STREET, C.asphalt);
  // The Victorian city's road is granite setts (C.asphalt their middle tone), laid in courses
  // across the road. Each course is laid in two halves, each a patch of its own tone, lighter,
  // darker or the middle one; and there is a channel of flat granite along each kerb.
  if (CS.victorian) {
    for (let k = Math.ceil(a0 / SETT_COURSE); (k + 1) * SETT_COURSE <= a1; k++) for (const h of [0, 1]) {
      const r = hash2(k, h + Math.round(cl * 10), (DC.plan as CityPlan).seed, 0x5e7);
      if (r < 0.5) continue;
      const v0 = h ? cl + (k % 2 ? 1.3 : -1.3) : KERB + 0.4, v1 = h ? STREET - KERB - 0.4 : cl + (k % 2 ? 1.3 : -1.3);
      flat(k * SETT_COURSE + 0.01, (k + 1) * SETT_COURSE - 0.01, v0 + 0.01, v1 - 0.01, 0.003, shade(C.asphalt, r < 0.75 ? 1.08 : 0.92));
    }
    for (const v of [KERB, STREET - KERB - 0.4]) flat(a0, a1, v, v + 0.4, 0.004, shade(C.curb, 0.82));
  }
  // The frontages in this segment's `along` coordinate.
  const alOf = (f: Frontage) => (f === loF ? loAl : hiAl);
  const drive = (f: Frontage): [number, number] | null => {
    if (!f.drive) return null;
    const p = alOf(f)(f.drive[0]), q = alOf(f)(f.drive[1]);
    return [Math.max(a0, Math.min(p, q)), Math.min(a1, Math.max(p, q))];
  };
  const loD = drive(loF), hiD = drive(hiF);
  const clear = (f: Frontage): [number, number] | null => {
    if (!f.clear) return null;
    const p = alOf(f)(f.clear[0]), q = alOf(f)(f.clear[1]);
    return [Math.min(p, q), Math.max(p, q)];
  };
  const loC = clear(loF), hiC = clear(hiF);
  const loS = loF.sign !== null ? loAl(loF.sign) : null, hiS = hiF.sign !== null ? hiAl(hiF.sign) : null;
  // (For tools/clearstops.ts: where nothing may be moved to, each side's driveway, the stretch it
  // keeps clear and its sign, where its furniture stands.)
  if (PAVEMENT.keep) for (const [ac, d, c, sg] of [[KERB - 0.7, loD, loC, loS], [STREET - KERB + 0.7, hiD, hiC, hiS]] as const) {
    const mark = (p: number, r: number) => (axis === 0 ? keepClear(p, ac, r) : keepClear(ac, p, r));
    for (const R of [d, c]) if (R) for (let p = R[0]; p <= R[1] + 1e-6; p += 0.5) mark(p, 0.6);
    if (sg !== null) mark(sg, 1.4);
  }
  const inDrive = (d: [number, number] | null, p: number, m: number) => !!d && p > d[0] - m && p < d[1] + m;
  // Sidewalks with a pale kerb edge on the road side; a dock driveway drops to road level.
  for (const [lo, hi, edge, d] of [[0, KERB, KERB - 0.25, loD], [STREET - KERB, STREET, STREET - KERB, hiD]] as const) {
    const parts: [number, number][] = d ? [[a0, d[0]], [d[1], a1]] : [[a0, a1]];
    for (const [p0, p1] of parts) {
      if (p1 - p0 < 0.05) continue;
      box(g, (p0 + p1) / 2, CURB_H / 2, (lo + hi) / 2, p1 - p0, CURB_H, hi - lo, C.sidewalk);
      box(g, (p0 + p1) / 2, CURB_H + 0.004, edge + 0.125, p1 - p0, 0.008, 0.25, C.curb);
      if (CS.storybook) {
        // The sidewalk is checkered with cream squares laid on the pink, two across, clear of the kerb's edge strip.
        const c0 = lo === 0 ? 0 : edge + 0.25, c1 = lo === 0 ? edge : STREET, cw = (c1 - c0) / 2, y = CURB_H + 0.002;
        for (let k = Math.floor(p0 / 1.5); k * 1.5 < p1; k++) for (let j = 0; j < 2; j++) {
          if ((k + j) % 2) continue;
          const u0 = Math.max(p0, k * 1.5) + 0.01, u1 = Math.min(p1, (k + 1) * 1.5) - 0.01;
          if (u1 - u0 > 0.05) flat(u0, u1, c0 + j * cw + 0.01, c0 + (j + 1) * cw - 0.01, y, SB.cream);
        }
      } else if (CS.victorian) {
        // The pavement is York stone flags, two rows across with their joints staggered, clear of
        // the kerb's edge strip; a flag here and there is a shade paler or darker than the rest.
        const c0 = lo === 0 ? 0 : edge + 0.25, c1 = lo === 0 ? edge : STREET, cw = (c1 - c0) / 2, y = CURB_H + 0.002;
        for (let j = 0; j < 2; j++) for (let k = Math.floor(p0 / FLAG_LEN - j / 2); (k + j / 2) * FLAG_LEN < p1; k++) {
          const r = hash2(k, j + Math.round(c0), (DC.plan as CityPlan).seed, 0xf1a6);
          if (r > 0.36) continue;
          const u0 = Math.max(p0, (k + j / 2) * FLAG_LEN) + 0.015, u1 = Math.min(p1, (k + 1 + j / 2) * FLAG_LEN) - 0.015;
          if (u1 - u0 > 0.05) flat(u0, u1, c0 + j * cw + 0.015, c0 + (j + 1) * cw - 0.015, y, shade(C.sidewalk, r < 0.2 ? 1.1 : 0.9));
        }
        // (The granite kerb's face, under its edge strip.)
        box(g, (p0 + p1) / 2, CURB_H / 2, lo === 0 ? KERB + 0.003 : STREET - KERB - 0.003, p1 - p0, CURB_H, 0.006, C.curb);
      }
    }
    if (d) box(g, (d[0] + d[1]) / 2, 0.015, (lo + hi) / 2, d[1] - d[0] - 0.02, 0.03, hi - lo - 0.02, 0x8f8b80);   // (a cm short all round: shared planes flicker)
  }
  // Markings. Forward (+along) traffic keeps right: on an east-west street that is the +z half,
  // on a north-south street (heading +z, right hand is -x) the low-x half.
  const fwdLo = axis === 0 ? cl : KERB, fwdHi = axis === 0 ? STREET - KERB : cl;
  const backLo = axis === 0 ? KERB : cl, backHi = axis === 0 ? cl : STREET - KERB;
  const M = 0.012, MH = 0.02;
  // (A roundabout's ring has lane lines only: no centre line, no stop lines, no crosswalks across
  // it.)
  if (feat.oneway && !feat.ring) oneWayMarkings(g, s, box, axis, a0, a1, feat.salt ?? 0);
  else if (feat.median && len > 2 * (STOP_BACK + 4) + 12) {
    // An avenue's median, in place of the centre lines: a narrow raised strip of grass and low
    // shrubs (clear of a truck's inner wheels in the inner lane), ending short of the crosswalks,
    // with a double-armed streetlight every 30 m or so reaching over both ways.
    const m0 = a0 + STOP_BACK + 4, m1 = a1 - STOP_BACK - 4, mm = (m0 + m1) / 2;
    box(g, mm, CURB_H / 2, cl, m1 - m0, CURB_H, 0.6, C.curb);
    box(g, mm, CURB_H + 0.01, cl, m1 - m0 - 0.4, 0.02, 0.44, CS.grass);
    const nL = Math.max(1, Math.round((m1 - m0) / 30)), poles = Array.from({ length: nL }, (_, k) => m0 + (m1 - m0) * (k + 0.5) / nL);
    // (No shrub round a streetlight's pole: the pole stood in it.)
    for (let p = m0 + 1.5; p < m1 - 1; p += 2.2) { const c = hash2(Math.round(p * 10), Math.round(cl * 10), (DC.plan as CityPlan).seed, 0x5b1) < 0.5 ? 0x3e6b34 : 0x4b7a3a; if (poles.every((q) => Math.abs(q - p) > 0.8)) box(s, p, CURB_H + 0.22, cl, 1.3, 0.44, 0.4, c); }
    for (let k = 0; k < nL; k++) {
      const p = m0 + (m1 - m0) * (k + 0.5) / nL, [px, pz] = axis === 0 ? [p, cl] : [cl, p];
      // (The Victorian city's is a gas lamp: victorian-street.ts.)
      if (CS.victorian) { const l = vicLamp(s, px, pz, axis === 0 ? px : px + 1, axis === 0 ? pz + 1 : pz, CURB_H); DC.lampSites.push(l[0], l[1], l[2]); continue; }
      s.cyl(px, CURB_H + 3.75, pz, 0.1, 7.5, C.pole, 6);
      for (const d of [-1, 1]) {
        const [hx, hz] = axis === 0 ? [px, cl + d * 1.6] : [cl + d * 1.6, pz];
        s.span(Math.min(px, hx) - 0.06, CURB_H + 7.35, Math.min(pz, hz) - 0.06, Math.max(px, hx) + 0.06, CURB_H + 7.47, Math.max(pz, hz) + 0.06, C.pole);
        s.aux.set(0, 0, -2); s.box(hx, CURB_H + 7.3, hz, axis === 0 ? 0.35 : 0.7, 0.16, axis === 0 ? 0.7 : 0.35, C.lampHead); s.aux.set(0, 0, -1);
        DC.lampSites.push(hx, CURB_H + 7.2, hz);
      }
    }
  } else if (CS.victorian) {
    // (The Victorian city's setts carry no painted lines.)
  } else if (!feat.oneway && CS.storybook) {
    // The storybook city's centre line is a row of polka dots, pink and gold by turns.
    for (let p = a0 + 4.5, k = 0; p < a1 - 4; p += 2.2, k++) {
      const [x, z] = axis === 0 ? [p, cl] : [cl, p], y = M + 0.004, c = k % 2 ? SB.mustard : C.yellow;
      for (let i = 0; i < 6; i++) {   // (each dot is flat, a hexagon of six triangles, which is all a dot needs from above)
        const a0 = p * 0.37 + i * Math.PI / 3, a1 = a0 + Math.PI / 3;
        g.tri(x, y, z, x + Math.cos(a1) * 0.3, y, z + Math.sin(a1) * 0.3, x + Math.cos(a0) * 0.3, y, z + Math.sin(a0) * 0.3, c);
      }
    }
  } else if (!feat.oneway) {
    // (Yellow 4 mm under the white, which can cross it where streets meet: shared planes flicker.)
    box(g, mid, M - 0.002, cl - 0.15, len - 8, MH - 0.004, 0.12, C.yellow);
    box(g, mid, M - 0.002, cl + 0.15, len - 8, MH - 0.004, 0.12, C.yellow);
  }
  // Loading zones (lo side, hi side): 16 m of yellow kerb, inside the street's ends, and no
  // markings on the road.
  // (The Victorian city paints no kerbs.)
  if (!CS.victorian) feat.loading?.forEach((at, i) => {
    if (at === null || at === undefined) return;
    const c = Math.max(a0 + 14, Math.min(a1 - 14, at)), kerbE = i ? STREET - KERB : KERB;
    if (a1 - a0 < 30) return;
    box(g, c, CURB_H + 0.012, kerbE + (i ? 0.055 : -0.055), 16, 0.02, 0.13, C.yellow);   // (a cm proud of the kerb's face, which the kerb's edge strip shares)
  });
  if (!CS.victorian && (!feat.oneway || feat.ring)) for (const lane of feat.oneway ? [cl, cl + 3] : [cl - 3, cl + 3])
    for (let p = a0 + 6; p + 3 <= a1 - 6; p += 9) box(g, p + 1.5, M, lane, 3, MH, 0.12, C.white);
  // Stop lines (forward traffic stops before the next intersection at a1, backward before a0),
  // then continental crosswalks at both ends.
  // (Short of the yellow centre lines: overlapping markings flicker.)
  if (!feat.ring && !CS.victorian) {
    box(g, a1 - (STOP_BACK - 0.2), M, (fwdLo + fwdHi) / 2, 0.4, MH, fwdHi - fwdLo - 0.5, C.white);
    if (!feat.oneway) box(g, a0 + (STOP_BACK - 0.2), M, (backLo + backHi) / 2, 0.4, MH, backHi - backLo - 0.5, C.white);
    for (const c0 of [a0 + 0.3, a1 - 3.3])
      for (let ac = KERB + 0.6, k = 0; ac < STREET - KERB - 0.4; ac += 1.0, k++) box(g, c0 + 1.4, M, ac, 2.8, MH, 0.5, CS.storybook && k % 2 ? SB.pink : C.white);
  } else if (!feat.ring) {
    // The Victorian city's crossings are strips of flat stone laid across the setts, two flags wide.
    for (const c0 of [a0 + 0.8, a1 - 2.8]) for (const [u0, u1] of [[c0, c0 + 0.99], [c0 + 1.01, c0 + 2]]) flat(u0, u1, KERB + 0.4, STREET - KERB - 0.4, 0.006, shade(C.sidewalk, 0.9));
  }
  // Streetlights on both sidewalks, staggered; street trees where the district has them. (A city
  // whose file lists its contents: its own, drawn with the tile's.)
  const listed = !!(DC.plan as CityPlan).contents;
  for (const [side, at, d, c] of [[KERB - 0.6, a0 + 10, loD, loC], [STREET - KERB + 0.6, a0 + 31, hiD, hiC]] as const) {
    // (Not up against the far end, where a short street's next junction has its signal's pole and
    // mast arm, or a stop sign: they stood in each other.)
    if (listed || inDrive(d, at, 2) || inDrive(c, at, 0) || at > a1 - 7) continue;
    const dir = side < cl ? 1 : -1; // arm reaches over the road
    const [px, pz] = axis === 0 ? [at, side] : [side, at], reach = CS.storybook ? 1.5 : 1.6;
    const [hx, hz] = axis === 0 ? [px, side + dir * reach] : [side + dir * reach, pz];
    place("lamp", { x: cm2(px), z: cm2(pz), hx: cm2(hx), hz: cm2(hz) }, g, s, rnd);
  }
  // What the furniture must keep clear of, per sidewalk.
  const busy: [number[][], number[][]] = [[], []];
  for (const [i, at, d] of [[0, a0 + 10, loD], [1, a0 + 31, hiD]] as const) if (!inDrive(d, at, 2)) busy[i].push([at - 0.6, at + 0.6]);
  // The storybook city hangs bunting across some of its streets, between striped poles at the backs of
  // the sidewalks (clear of driveways, signs and the streetlights).
  if (CS.storybook && !listed && len > 30 && district !== "industrial" && rnd() < (district === "residential" ? 0.25 : 0.6)) {
    const p = a0 + 20.5 + (rnd() - 0.5) * 6;
    const ok = [loD, hiD, loC, hiC].every((d) => !inDrive(d, p, 1.5)) && [loS, hiS].every((sg) => sg === null || Math.abs(sg - p) > 2);
    if (ok) {
      const [ax, az] = axis === 0 ? [p, 0.4] : [0.4, p], [bx, bz] = axis === 0 ? [p, STREET - 0.4] : [STREET - 0.4, p];
      place("bunting", { x: cm2(ax), z: cm2(az), bx: cm2(bx), bz: cm2(bz), salt: Math.floor(p * 7) }, g, s, rnd);
      busy[0].push([p - 0.5, p + 0.5]); busy[1].push([p - 0.5, p + 0.5]);
    }
  }
  for (const [i, d, sg, F, cz] of [[0, loD, loS, loF, loC], [1, hiD, hiS, hiF, hiC]] as const) {
    if (d) busy[i].push([d[0] - 1, d[1] + 1]);
    if (sg !== null) busy[i].push([sg - 1.4, sg + 1.4]);
    if (F.free && cz) busy[i].push(cz);
  }
  // The junctions' signal poles and stop sign posts that stand on these sidewalks (junctionPosts):
  // the right of the way from the first node to the next is the +z half on an east-west street,
  // the low-x half on a north-south one; `along` 9 m on from the first node.
  const fwdRight = axis === 0 ? 1 : 0;
  const posts = (feat.posts ?? []).map((p) => ({ i: p.right ? fwdRight : 1 - fwdRight, a: 9 + p.s, r: p.r }));
  for (const p of posts) busy[p.i].push([p.a - p.r - 0.6, p.a + p.r + 0.6]);
  // Under an elevated line (on an east-west street: elevatedLine), its bents: about every 17 m, at
  // the first spot near each where neither sidewalk has a driveway, streetlight or sign in the way
  // (a dock's side view is kept clear too, unless there is nowhere else). No street trees here.
  const el = feat.el, fw = feat.fw;
  if (el || fw) {
    const icClear = feat.icClear;
    const ok = (p: number, soft: boolean) => !(icClear && p > icClear[0] - 1.5 && p < icClear[1] + 1.5) && !inDrive(loD, p, 1.5) && !inDrive(hiD, p, 1.5) && Math.abs(p - (a0 + 10)) > 1.5 && Math.abs(p - (a0 + 31)) > 1.5
      && (loS === null || Math.abs(p - loS) > 2) && (hiS === null || Math.abs(p - hiS) > 2) && (!soft || (!inDrive(loC, p, 0.5) && !inDrive(hiC, p, 0.5)));
    let last = -Infinity;
    // (The elevated line's every 17 m from the first, as far as the street goes: three on the grid's.)
    const elBases: number[] = [];
    for (let b = a0 + 4; b <= a1 - 2.5; b += 17) elBases.push(b);
    // (The freeway's every 24 m: two on the grid's.)
    const fwBases: number[] = [];
    for (let b = a0 + 8; b <= a1 - 2.5; b += 24) fwBases.push(b);
    for (const base of fw ? fwBases : elBases) {
      let at = NaN;
      for (const soft of [true, false]) {
        for (const o of [0, 2, -2, 4, -4, 6]) {
          const p = base + o;
          if (p > last + 10 && p >= a0 + 3 && p <= a1 - 2.5 && ok(p, soft)) { at = p; break; }
        }
        if (!Number.isNaN(at)) break;
      }
      if (Number.isNaN(at)) continue;
      last = at;
      if (fw) {
        freewayStreetBent(s, axis, at);
        FW_STREET_COLS.forEach((c, i) => { busy[i].push([at - 0.9, at + 0.9]); if (axis === 0) pavementObstacle(at, c, 0.6); else pavementObstacle(c, at, 0.6); });
      } else {
        elevatedBent(s, at, ELEVATED_Y + 0.5);
        EL_COLUMNS.forEach((z, i) => { busy[i].push([at - 0.9, at + 0.9]); pavementObstacle(at, z, 0.5); });
      }
    }
  }
  const wet = feat.wet ?? [false, false], bridge = wet[0] && wet[1];
  if (wet[0] || wet[1]) waterEdges(s, box, axis, a0, a1, wet, busy);
  if (district !== "industrial" && !el && !fw && !listed) {
    const step = district === "downtown" ? 12 : 9;
    for (const side of [1.6, STREET - 1.6]) {
      if (wet[side < cl ? 0 : 1]) continue;   // (none on a bridge, nor on a quay's river side)
      const d = side < cl ? loD : hiD, sg = side < cl ? loS : hiS, cz = side < cl ? loC : hiC;
      for (let p = a0 + 6.5 + (side > cl ? 4 : 0); p < a1 - 5; p += step) {
        if (Math.abs(p - (a0 + 10)) < 2.5 || Math.abs(p - (a0 + 31)) < 2.5) continue; // clear of lights
        if (inDrive(d, p, 2) || inDrive(cz, p, 0) || (sg !== null && Math.abs(p - sg) < 3.4)) continue;   // driveways, signs, dock corners
        if (posts.some((q) => q.i === (side < cl ? 0 : 1) && Math.abs(q.a - p) < q.r + 1.3)) continue;   // a junction's pole or post
        const [tx, tz] = axis === 0 ? [p, side] : [side, p];
        busy[side < cl ? 0 : 1].push([p - 1.0, p + 1.0]);
        plantTree(s, tx, CURB_H, tz, range(rnd, 6.5, 8), range(rnd, 1.5, 2.0), pick(rnd, CS.trees.greens), rnd, g);
      }
    }
  }
  if (!bridge) {
    streetFurniture(s, g, district, KERB, -1, axis, busy[0], rnd, a0, a1, feat.furniture?.[0] ?? null);
    streetFurniture(s, g, district, STREET - KERB, 1, axis, busy[1], rnd, a0, a1, feat.furniture?.[1] ?? null);
  }
}
// The river's side of a street (wet: lo side, hi side). A bridge: a stone parapet along each side's
// outer edge with a lantern on it every 15 m or so, and the deck's stone fascia down to the water.
// A quay: an iron railing along the river side, with a bench facing the water every 20 m.
function waterEdges(s: Batch, box: BoxFn, axis: 0 | 1, a0: number, a1: number, wet: boolean[], busy: number[][][]) {
  const bridge = wet[0] && wet[1], len = a1 - a0, mid = (a0 + a1) / 2, STONE = 0x9c968a, IRON = 0x2b2e33;
  for (const i of [0, 1]) {
    if (!wet[i]) continue;
    const edge = i ? STREET - 0.2 : 0.2, out = i ? 1 : -1;
    if (bridge) {
      box(s, mid, CURB_H + 0.5, edge, len, 1.0, 0.4, STONE);
      box(s, mid, CURB_H + 1.03, edge, len, 0.08, 0.52, shade(STONE, 1.08));
      box(s, mid, -0.7, edge + out * 0.3, len, 1.6, 0.3, shade(STONE, 0.8));
      const n = Math.max(1, Math.round(len / 15));
      for (let k = 0; k <= n; k++) {
        const p = a0 + 1 + (len - 2) * k / n, [x, z] = axis === 0 ? [p, edge] : [edge, p];
        // (The Victorian city's is a gas lamp standing on the parapet: victorian-street.ts.)
        if (CS.victorian) { const l = vicLamp(s, x, z, axis === 0 ? x : x - out, axis === 0 ? z - out : z, CURB_H + 1.07); DC.lampSites.push(l[0], l[1], l[2]); continue; }
        s.cyl(x, CURB_H + 1.0 + 1.3, z, 0.07, 2.6, IRON, 6);
        s.aux.set(0, 0, -2); s.box(x, CURB_H + 3.75, z, 0.36, 0.5, 0.36, C.lampHead); s.aux.set(0, 0, -1);
        DC.lampSites.push(x, CURB_H + 3.7, z);
      }
    } else {
      for (let p = a0 + 1; p <= a1 - 1; p += 2.4) { const [x, z] = axis === 0 ? [p, edge] : [edge, p]; s.cyl(x, CURB_H + 0.5, z, 0.035, 1.0, IRON, 4); }
      box(s, mid, CURB_H + 1.0, edge, len - 2, 0.06, 0.06, IRON);
      box(s, mid, CURB_H + 0.55, edge, len - 2, 0.04, 0.04, IRON);
      for (let p = a0 + 10; p < a1 - 6; p += 20) {
        // (A bench a metre in from the railing, its back to the street.)
        const ac = edge - out * 1.1;
        // (The Victorian city's is of cast iron, its seat a little nearer the water: victorian-street.ts.)
        if (CS.victorian) { if (axis === 0) vicBench(s, p, ac + out * 0.82, 0, -out, CURB_H); else vicBench(s, ac + out * 0.82, p, -out, 0, CURB_H); }
        else {
          box(s, p, CURB_H + 0.45, ac, 1.8, 0.08, 0.45, 0x7a5a3a);
          box(s, p, CURB_H + 0.7, ac - out * 0.22, 1.8, 0.4, 0.08, 0x7a5a3a);
        }
        const [x, z] = axis === 0 ? [p, ac] : [ac, p];
        pavementObstacle(x, z, 1.0, PK.bench);
        busy[i].push([p - 1.3, p + 1.3]);   // (the street furniture keeps off it)
      }
    }
  }
}

// Sidewalk corners at the intersection's four corners.
function buildCorners(g: Batch) {
  for (const x of [0, STREET - KERB])
    for (const z of [0, STREET - KERB]) g.box(x + KERB / 2, CURB_H / 2, z + KERB / 2, KERB, CURB_H, KERB, C.sidewalk);
}

// ---- the countryside round the city -------------------------------------------------------------
// Chunks outside the town's land (outline.ts), out to RING blocks past the square: the land under
// the town's outermost streets and its gate streets where they run, farmland or wild land of the
// city's biome (countryworld.ts looks), and none in the sea. The highway's corridor out of each gate stays clear: the country road is drawn there.
function inGateCorridor(plan: CityPlan, wx: number, wz: number, margin = 13) {
  for (const g of plan.graph.gates) {
    if (!g) continue;
    const e = gateEnd(g), fx = Math.cos(e.h), fz = -Math.sin(e.h);
    const along = (wx - e.x) * fx + (wz - e.z) * fz, across = Math.abs((wx - e.x) * -fz + (wz - e.z) * fx);
    if (along > -2 && along < (RING + 1) * BLOCK && across < margin) return true;
  }
  return false;
}
const PLAIN_FRONT = (side: number): Frontage => ({ side, drive: null, sign: null });
// (Its streets and intersections are the graph's: cityBatches draws them; this is the land.)
function buildOutskirts(ground: Batch, solid: Batch, plan: CityPlan, cx: number, cz: number, rnd: Rand) {
  if (cityDistance(cx, cz) > RING) return;
  const G = plan.graph, O = plan.outline, c = plan.climate, id = BIOME_OF[plan.style.id], b = BIOMES[id];
  const g0 = c ? seasonGround(b.ground, c) : b.ground, g1 = c ? seasonGround(b.ground2, c) : b.ground2;
  const fields = b.fields?.map((f) => c ? seasonGround(f, c) : f);
  const keep = id === "storybook", greens = c && !keep ? seasonGreens(b.greens, c) : b.greens, cgreens = c && !keep ? seasonGreens(b.greens, c, true) : b.greens;
  const ox = cx * BLOCK, oz = cz * BLOCK, line = plan.elevatedSides(cz).includes(cx < (CITY_LO + CITY_HI) / 2 ? -1 : 1);
  // The storybook city's gate is its arch over the street in, just inside where the road arrives.
  // (The Victorian city has a toll gate in the same place on every road out of town.)
  for (const eg of plan.style.victorian ? G.gates : plan.style.storybook ? [G.gates[0]] : []) {
    if (!eg) continue;
    const e = gateEnd(eg), fx = Math.cos(e.h), fz = -Math.sin(e.h), x = e.x - fx * 6, z = e.z - fz * 6;
    if (Math.floor(x / BLOCK) === cx && Math.floor(z / BLOCK) === cz) (plan.style.victorian ? vicGate : storyGate)(solid, x - ox, z - oz, fx, fz, STREET / 2 + 1.6, 0);
  }
  // (Covered: a city block's, or a river's, over it. Streets lie over the land, which runs under them.)
  const covered = (wx: number, wz: number) => { const B = G.blockAt(wx, wz); return !!B && (B.inCity || B.water); };
  // Ground in 12 m cells: fields in farm country, patchy grass elsewhere, none where a block covers
  // it or out in the sea; beside the sea a cell goes down to the water, a solid edge. A few cm below
  // the country road's land (countryworld.ts), which overlaps this ring where they meet: at the
  // same height the two flickered against each other.
  let land = 0;
  for (let x = 0; x < BLOCK - 0.01; x += 12) for (let z = 0; z < BLOCK - 0.01; z += 12) {
    const wx = ox + x + 6, wz = oz + z + 6;
    if (O.seaward(wx, wz) || covered(wx, wz)) continue;
    land++;
    const col = fields ? fields[Math.floor(hash2(Math.floor(wx / 48), Math.floor(wz / 36), plan.seed, 0xf1e) * fields.length)]
      : hash2(Math.floor(wx / 36), Math.floor(wz / 36), plan.seed, 0x6a) < 0.6 ? g0 : g1;
    const coast = O.sea !== null && [[12, 0], [-12, 0], [0, 12], [0, -12]].some(([dx, dz]) => O.seaward(wx + dx, wz + dz));
    // (A coastal town's coast is sand, as the country road's is: countryworld.ts.)
    if (coast) ground.box(x + 6, (-0.11 + SEA_Y - 0.1) / 2, z + 6, 12, -0.11 - SEA_Y + 0.1, 12, plan.style.id === "coastal" ? SAND : col);
    else ground.box(x + 6, -0.16, z + 6, 12, 0.1, 12, col);
  }
  if (!land || plan.contents) return;   // (a city whose file lists its contents: its own trees and rocks, drawn with the tile's)
  // Trees and rocks, clear of the highway out of town (nor under an elevated line, nor the
  // freeway), the streets and blocks, and the sea.
  const clear = (x: number, z: number) => !O.seaward(ox + x, oz + z) && !G.blockNear(ox + x, oz + z, 3) && !nearStreet(G, ox + x, oz + z, 3) && !inGateCorridor(plan, ox + x, oz + z) && !(line && Math.abs(z - 9) < 7) && !plan.freewayFrame?.corridor(ox + x, oz + z);
  const n = Math.floor(b.density * 0.0024 * 144 * land + rnd());
  for (let k = 0; k < n; k++) {
    const x = 2 + rnd() * (BLOCK - 4), z = 2 + rnd() * (BLOCK - 4);
    if (!clear(x, z)) continue;
    const kind = b.trees[Math.floor(rnd() * b.trees.length)], gs = kind === "conifer" || kind === "cypress" || kind === "cactus" ? cgreens : greens;
    place("landTree", { x: cm2(x), z: cm2(z), kind, g: Math.floor(rnd() * gs.length) }, ground, solid, rnd);
  }
  if (rnd() < b.rocks) { const x = rnd() * BLOCK, z = rnd() * BLOCK; if (clear(x, z)) place("rock", { x: cm2(x), z: cm2(z), r: cm2(0.5 + rnd() * 1.4) }, ground, solid, rnd); }
}
// A tree of the countryside round the town (countryworld.ts landTree): its kind, and its green
// (the g'th of its land's greens, or of its darker ones for a conifer, cypress or cactus, as the
// season colours them).
DRAW.landTree = (R, _g, s, rnd) => {
  const plan = DC.plan as CityPlan, c = plan.climate, id = BIOME_OF[plan.style.id], b = BIOMES[id], keep = id === "storybook", kind = R.kind as string;
  const dark = kind === "conifer" || kind === "cypress" || kind === "cactus", gs = c && !keep ? seasonGreens(b.greens, c, dark) : b.greens;
  landTree(s, R.x as number, R.z as number, kind, gs[(R.g as number) % gs.length], rnd);
};
DRAW.rock = (R, _g, s, rnd) => { const rr = R.r as number; s.ico(R.x as number, rr * 0.3, R.z as number, rr, 0x8a8478, 0.6, rnd() * 6); };
// Whether (x, z) is within `m` of a street's edge (its sidewalk's back).
function nearStreet(G: CityGraph, x: number, z: number, m: number) {
  const gx = Math.floor(x / BLOCK), gz = Math.floor(z / BLOCK);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const id of G.tile(gx + dx, gz + dz).streets) {
    const st = G.streets[id], [a, off] = G.toStreet(id, x, z);
    if (a > -m && a < st.len + m && Math.abs(off) < st.half + m) return true;
  }
  return false;
}

// ---- shared pieces --------------------------------------------------------------------------
function tree(s: Batch, x: number, y: number, z: number, h: number, r: number, color: number) {
  if (BARE.includes(color)) { bareTree(s, x, y, z, h, x * 1.7 + z); return; }
  s.cyl(x, y + h * 0.3, z, 0.16, h * 0.6, C.trunk, 5, 0, 0, x * 1.7 + z);   // (turned its own way: a face square to a wall beside it could share its plane)
  // (Each crown turned by a hash of where it stands: turned by its position, trees in a row could
  // come out turned alike, as the crowns are symmetric, and their faces share planes.)
  const turn = (k: number) => { const v = Math.sin(x * 12.9898 + z * 78.233 + k) * 43758.5453; return (v - Math.floor(v)) * Math.PI * 2; };
  // (The second, smaller crown set off from the first in the tree's own turn, and turned 1.12 rad
  // further: at that, no face of one is within 20 degrees of parallel to any of the other's, so
  // they never share a plane.)
  const t = turn(0), c = Math.cos(t), sn = Math.sin(t), dx = r * 0.35, dz = -r * 0.25;
  s.ico(x, y + h * 0.68, z, r, color, 0.9, t);
  s.ico(x + c * dx + sn * dz, y + h * 0.82, z - sn * dx + c * dz, r * 0.6, shade(color, 1.18), 0.9, t + 1.12);
}
// A tree of the city's kind: broadleaf, conifer or palm.
// Whether a tree's trunk can stand at (x, z), in the frame being drawn in: not within 1.6 m of
// another's, nor in a building or within 0.4 m of its walls (PLACED). Where it can, it is taken.
// (Trees placed at random stood in each other and in houses, their faces sharing planes.)
function treeRoom(x: number, z: number): boolean {
  const [tx, tz] = toTile(x, z), T = PLACED.trees, F = PLACED.foot;
  for (let i = 0; i < T.length; i += 2) if (Math.hypot(T[i] - tx, T[i + 1] - tz) < 1.6) return false;
  for (let i = 0; i < F.length; i += 8) {
    const q: [number, number][] = [[F[i], F[i + 1]], [F[i + 2], F[i + 3]], [F[i + 4], F[i + 5]], [F[i + 6], F[i + 7]]];
    if (inPoly(q, tx, tz) || polyDist(q, tx, tz) < 0.4) return false;
  }
  T.push(tx, tz);
  return true;
}
// A tree a builder plants: a recipe of its own (tree).
// (`pit`: a street tree's, in its pit; one with no room for its tree is its pit alone.)
function plantTree(s: Batch, x: number, y: number, z: number, h: number, r: number, color: number, rnd: Rand, pit: Batch | null = null) {
  const kind = pick(rnd, CS.trees.kinds);
  if (!treeRoom(x, z)) { if (pit) place("pit", { x: cm2(x), z: cm2(z) }, pit, s, rnd); return; }
  const gi = CS.trees.greens.indexOf(color);
  place("tree", { x: cm2(x), ...(y !== CURB_H ? { y: cm2(y) } : {}), z: cm2(z), h: cm2(h), r: cm2(r), kind: CS.trees.kinds.indexOf(kind), ...(gi >= 0 ? { g: gi } : { c: color }), ...(pit ? { pit: true } : {}) }, pit ?? s, s, rnd);
}
// (A recipe's lengths to the centimetre.)
const cm2 = (v: number) => Math.round(v * 100) / 100;
// A tree drawn as part of another recipe (its yard's, its close's), where there is room for it.
export function cityTree(s: Batch, x: number, y: number, z: number, h: number, r: number, color: number, rnd: Rand) {
  const kind = pick(rnd, CS.trees.kinds);
  if (!treeRoom(x, z)) return;
  drawTree(s, x, y, z, h, r, kind, color, rnd);
}
// A city tree's recipe (plantTree): its place (x, y, z), height, crown, kind (CS.trees.kinds) and green
// (CS.trees.greens, as the season colours it; or its own colour, c).
DRAW.tree = (R, g, s, rnd) => {
  const greens = CS.trees.greens;
  if (R.pit) DRAW.pit(R, g, s, rnd);
  PLACED.trees.push(...toTile(R.x as number, R.z as number));   // (its trunk's place, for trees drawn by rule after it: treeRoom)
  drawTree(s, R.x as number, (R.y as number | undefined) ?? CURB_H, R.z as number, R.h as number, R.r as number, CS.trees.kinds[R.kind as number] ?? CS.trees.kinds[0], R.g !== undefined ? greens[(R.g as number) % greens.length] : R.c as number, rnd);
};
function drawTree(s: Batch, x: number, y: number, z: number, h: number, r: number, kind: string, color: number, rnd: Rand) {
  if (CS.storybook) { if (kind !== "spiral") pavementObstacle(x, z, 0.45, PK.tree); else pavementObstacle(x, z, 0.8, PK.tree); storyTree(s, kind, x, y, z, h, r, color, !!CS.snowTufts); return; }
  if (kind !== "conifer") pavementObstacle(x, z, 0.45, PK.tree);   // the trunk (and a street tree's pit), for the driver's walks (a conifer's own, its boughs low)
  if (kind === "palm") palm(s, x, y, z, h * 1.25, rnd);
  else if (kind === "conifer") conifer(s, x, y, z, h, BARE.includes(color) ? 0x2c4a34 : shade(color, 0.8), BARE.includes(color), true);
  else tree(s, x, y, z, h, r, color);
}
// A streetlight (x, z), its lamp at the end of its arm over the road (hx, hz); in the storybook
// city a shepherd's crook.
DRAW.lamp = (R, _g, s) => {
  const px = R.x as number, pz = R.z as number, hx = R.hx as number, hz = R.hz as number;
  pavementObstacle(px, pz, 0.15, PK.lamp);
  if (CS.storybook) { const l = storyLamp(s, px, pz, hx, hz, 0); DC.lampSites.push(l[0], l[1], l[2]); return; }
  if (CS.victorian) { const l = vicLamp(s, px, pz, hx, hz, 0); DC.lampSites.push(l[0], l[1], l[2]); return; }
  const along = Math.abs(hz - pz) > Math.abs(hx - px);   // (the arm across an east-west street: along z)
  s.cyl(px, 3.75, pz, 0.1, 7.5, C.pole, 6);
  s.span(Math.min(px, hx) - 0.06, 7.35, Math.min(pz, hz) - 0.06, Math.max(px, hx) + 0.06, 7.47, Math.max(pz, hz) + 0.06, C.pole);
  s.aux.set(0, 0, -2); s.box(hx, 7.3, hz, along ? 0.35 : 0.7, 0.16, along ? 0.7 : 0.35, C.lampHead); s.aux.set(0, 0, -1);
  DC.lampSites.push(hx, 7.2, hz);
};
// A street tree's pit (the tree itself is a tree of its own).
DRAW.pit = (R, g) => { g.box(R.x as number, CURB_H + 0.0125, R.z as number, 1.4, 0.025, 1.4, 0x5a4a38); };   // (its top over a path's it can meet: shared planes flicker)
// The storybook city's bunting across a street, between striped poles at (x, z) and (bx, bz).
DRAW.bunting = (R, _g, s) => {
  const ax = R.x as number, az = R.z as number, bx = R.bx as number, bz = R.bz as number;
  bunting(s, ax, az, bx, bz, 0, R.salt as number);
  pavementObstacle(ax, az, 0.15, PK.lamp); pavementObstacle(bx, bz, 0.15, PK.lamp);
};
// Palm: a gently leaning ringed trunk and a crown of drooping fronds.
function palm(s: Batch, x: number, y: number, z: number, h: number, rnd: Rand) {
  const lean = range(rnd, 0.04, 0.1), dir = rnd() * Math.PI * 2, lx = Math.cos(dir), lz = Math.sin(dir);
  const seg = 5;
  for (let k = 0; k < seg; k++) {
    const f = (k + 0.5) / seg, off = lean * h * f * f;
    s.cyl(x + lx * off, y + h * f, z + lz * off, 0.19 - 0.05 * f + (k % 2) * 0.02, h / seg + 0.02, k % 2 ? 0x8a6a48 : 0x7a5c3e, 6, 0, 0, x * 1.7 + z + k * 0.5);   // (alternate rings fatter, each turned its own way: overlapping segments, or a face square to a wall beside it, flicker)
  }
  const tx = x + lx * lean * h, tz = z + lz * lean * h, ty = y + h;
  const green = pick(rnd, [0x3f8a32, 0x4a9a3a, 0x357a2c]);
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2 + rnd() * 0.4;
    s.boxR(tx + Math.cos(a) * 1.1, ty - 0.25, tz + Math.sin(a) * 1.1, 2.4, 0.08, 0.55, green, 0, -a, -0.5);
  }
  s.ico(tx, ty, tz, 0.35, 0x5a4a30, 1, x * 1.7 + z + (seg - 1) * 0.5 + 0.525);   // (turned 0.525 rad from the top ring: then none of its faces is within 20 degrees of parallel to the ring's)
}
// (Each turned its own way, by where it stands: neighbours' boughs overlap, and two turned alike
// could put faces on one plane, which flicker.)
function conifer(s: Batch, x: number, y: number, z: number, h: number, color: number, snow = false, roomed = false) {
  if (!roomed && !treeRoom(x, z)) return;
  pavementObstacle(x, z, 0.6);
  s.cyl(x, y + 0.5, z, 0.14, 1, C.trunk, 5, 0, 0, x * 1.7 + z);
  s.cone(x, y + 0.8 + h * 0.4, z, h * 0.28, h * 0.8, color, 7, 0, x * 1.7 + z);
  if (snow) s.cone(x, y + 0.8 + h * 0.62, z, h * 0.15, h * 0.36, SNOW, 7, 0, x * 1.7 + z);
}
// A leafless tree (a snowy winter): a trunk forking into a few branches angled up and out.
export function bareTree(s: Batch, x: number, y: number, z: number, h: number, seed: number) {
  const bark = 0x5a4636, twig = 0x6e5a48;
  s.cyl(x, y + h * 0.35, z, 0.15, h * 0.7, bark, 5);
  for (let k = 0; k < 5; k++) {
    const a = seed + k * 1.257, up = 0.55 + 0.25 * ((k * 7) % 3) / 2, L = h * (0.32 + 0.06 * (k % 3));
    const bx = x + Math.cos(a) * L * 0.35, bz = z + Math.sin(a) * L * 0.35, by = y + h * (0.5 + 0.08 * (k % 3)) + Math.sin(up) * L * 0.35;
    s.boxR(bx, by, bz, L, 0.09, 0.09, k % 2 ? bark : twig, 0, -a, up);
  }
  s.boxR(x, y + h * 0.82, z, 0.08, h * 0.32, 0.08, twig, 0.15, seed, 0.1);
}
export function shade(c: number, f: number) {
  const r = Math.min(255, ((c >> 16) & 255) * f), g = Math.min(255, ((c >> 8) & 255) * f), b = Math.min(255, (c & 255) * f);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export interface Rect { x0: number; z0: number; x1: number; z1: number }
export const inset = (r: Rect, d: number): Rect => ({ x0: r.x0 + d, z0: r.z0 + d, x1: r.x1 - d, z1: r.z1 - d });

// Flat roof cap, parapet and rooftop clutter for a box ending at `top`.
function flatRoof(s: Batch, r: Rect, top: number, wall: number, rnd: Rand, clutter = 2) {
  DC.roofs.push({ r, top });
  // (The parapet stands 2 cm inside the walls and the cap inside that: faces that share a plane
  // flicker against each other, here the walls below, a tower's walls where it rises flush from
  // a podium's edge, and the parapet of the row house next door.)
  const ci = inset(r, 0.04);
  s.span(ci.x0, top - 0.05, ci.z0, ci.x1, top + 0.05, ci.z1, pick(rnd, CS.roofs));
  const tank = rnd() < CS.waterTanks && r.x1 - r.x0 > 7 && r.z1 - r.z0 > 7;
  if (tank) {   // a wooden water tank on legs
    const ux = r.x0 + 2.4, uz = r.z1 - 2.4;
    s.cyl(ux, top + 3.2, uz, 1.3, 2.4, 0x7a5236, 10); s.cone(ux, top + 4.9, uz, 1.4, 1.0, 0x4a3424, 10);
    for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) s.box(ux + lx, top + 1, uz + lz, 0.14, 2, 0.14, C.dark);
  }
  // (The parapet's height a little different on each building, by where it stands: neighbours
  // whose walls overlap a few cm had their parapets' tops in one plane, and flickered.)
  const hv = Math.sin(r.x0 * 12.9898 + r.z0 * 78.233) * 43758.5453;
  const p = 0.3, ph = 0.58 + (hv - Math.floor(hv)) * 0.05, pc = shade(wall, 0.82), po = inset(r, 0.02);
  // (From 2.5 cm down in the walls' top: a neighbour's cap's underside could share their foot's plane.)
  const pb = top - 0.025;
  s.span(po.x0, pb, po.z0, po.x1, top + ph, r.z0 + p, pc);
  s.span(po.x0, pb, r.z1 - p, po.x1, top + ph, po.z1, pc);
  s.span(po.x0, pb, po.z0, r.x0 + p, top + ph, po.z1, pc);
  s.span(r.x1 - p, pb, po.z0, po.x1, top + ph, po.z1, pc);
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const placed: [number, number][] = [];
  for (let i = 0; i < clutter; i++) {
    if (w < 5 || d < 5) break;
    const ux = range(rnd, r.x0 + 1.5, r.x1 - 1.5), uz = range(rnd, r.z0 + 1.5, r.z1 - 1.5);
    const k = rnd();
    // (Not in the water tank's corner, nor in another piece: they stood in each other, and their
    // faces could share planes.)
    if (tank && ux < r.x0 + 5 && uz > r.z1 - 5) continue;
    if (placed.some(([px, pz]) => Math.abs(px - ux) < 2.8 && Math.abs(pz - uz) < 2.8)) continue;
    placed.push([ux, uz]);
    if (k < 0.55) s.box(ux, top + 0.6, uz, range(rnd, 1.2, 2.4), 1.2, range(rnd, 1.2, 2.4), C.metal);  // AC unit
    else if (k < 0.8) s.box(ux, top + 1.2, uz, 2.2, 2.4, 2.6, shade(wall, 0.7));                       // stair bulkhead
    else { s.cyl(ux, top + 2.6, uz, 1.1, 2.2, 0x6b4a32, 8); s.cone(ux, top + 4.1, uz, 1.2, 0.8, 0x4a3424, 8); // water tank
      for (const [lx, lz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) s.box(ux + lx, top + 0.75, uz + lz, 0.12, 1.5, 0.12, C.dark); }
  }
}

// Which street a lot edge faces: side index in facadeBox order (+z, +x, -z, -x), or -1.
export function streetSide(r: Rect, B: Rect, eps = 6): number {
  const d = [B.z1 - r.z1, B.x1 - r.x1, r.z0 - B.z0, r.x0 - B.x0];
  let best = -1, bd = eps;
  d.forEach((v, i) => { if (v < bd) { bd = v; best = i; } });
  return best;
}

// ---- districts ------------------------------------------------------------------------------
function buildDowntown(g: Batch, s: Batch, B: Rect, hs: number, rnd: Rand) {
  place("paving", { rect: rectOf(B), c: "pavers" }, g, s, rnd);
  const lots = splitLots(B, rnd() < 0.35 ? 1 : rnd() < 0.6 ? 2 : 4, rnd);
  let marqueeDone = false, plazaDone = false;
  const towers: Recipe[] = [];
  for (const lot of lots) {
    // A plaza takes one corner lot at most: a whole block side without a building has no front
    // door for a delivery (kerbDoors).
    if (lots.length > 1 && rnd() < 0.12 && lots.length === 4 && !plazaDone) { place("cornerPlaza", { rect: rectOf(lot) }, g, s, rnd); plazaDone = true; continue; }
    const r = inset(lot, 0.4);
    const wall = pick(rnd, CS.walls.downtown);
    const pod = irange(rnd, 2, 4);
    const ground = rnd() < 0.5 ? FACADE.LOBBY : FACADE.STOREFRONT, podTile = pick(rnd, [FACADE.PUNCHED, FACADE.BRICK, FACADE.DECO]);
    const front = streetSide(r, B, 3);
    let sign: string | undefined;
    if (front >= 0 && !marqueeDone && wantsMarquee()) { sign = "marquee"; marqueeDone = true; }
    else if (front >= 0 && rnd() < CS.neon * 0.5) sign = "neon";
    const twIn = range(rnd, 2.2, 4.5), tw = inset(r, twIn);
    const floors = Math.round((5 + hs * range(rnd, 5, 14)) * CS.towerScale);
    const fields: Record<string, unknown> = { rect: rectOf(r), wall, pod, ground, podTile, front, ...(sign ? { sign } : {}) };
    if (!(tw.x1 - tw.x0 < 6 || tw.z1 - tw.z0 < 6 || floors < 6)) {
      const towerWall = rnd() < 0.5 ? wall : pick(rnd, CS.walls.downtown), tile = pick(rnd, CS.towerTiles);
      Object.assign(fields, { inset: cm2(twIn), floors, towerWall, tile });
      if (rnd() < 0.35 && tw.x1 - tw.x0 > 12) fields.crown = irange(rnd, 2, 4);   // a setback crown
    }
    towers.push(place("podiumTower", fields, g, s, rnd));
  }
  // An antenna with a red tip on the block's tallest tower, over 45 m (its recipe's `antenna`).
  let tallest = 45, top: Recipe | null = null;
  for (const t of towers) { const h = podiumTop(t); if (h > tallest) { tallest = h; top = t; } }
  if (top) place("antenna", { x: cm2(podiumRoof(top)[0]), z: cm2(podiumRoof(top)[1]), y: cm2(tallest) }, g, s, rnd);
}
// A podium tower's top, from its recipe: its podium's floors, its tower's and its crown's.
function podiumTop(R: Recipe) {
  const pod = CURB_H + 5 + ((R.pod as number) - 1) * 3.6;
  return R.floors === undefined ? pod : pod + (R.floors as number) * 3.6 + ((R.crown as number | undefined) ?? 0) * 3.6;
}
// The middle of its roof.
function podiumRoof(R: Recipe): [number, number] { const [x0, z0, x1, z1] = R.rect as number[]; return [(x0 + x1) / 2, (z0 + z1) / 2]; }
const rectOf = (r: Rect) => [cm2(r.x0), cm2(r.z0), cm2(r.x1), cm2(r.z1)];
const rectFrom = (a: unknown): Rect => { const [x0, z0, x1, z1] = a as number[]; return { x0, z0, x1, z1 }; };
// A downtown block's tower on its podium (buildDowntown), `rect` the podium's footprint: its wall,
// the podium's floors (`pod`, the first its `ground` tile, the rest `podTile`), a marquee or
// neon (`sign`) on its street side (`front`); the tower set in by `inset`, its floors, wall and
// tile, perhaps a setback `crown` of more floors; or no tower (no `floors`).
DRAW.podiumTower = (R, _g, s, rnd) => {
  const r = rectFrom(R.rect), wall = R.wall as number, front = R.front as number;
  const podTop = facadeBox(s, r.x0, r.z0, r.x1, r.z1, CURB_H,
    [{ tile: R.ground as number, floors: 1, floorH: 5 }, { tile: R.podTile as number, floors: (R.pod as number) - 1, floorH: 3.6 }], wall);
  if (R.sign === "marquee") marqueeCanopy(s, r, front);
  else if (R.sign === "neon") shopNeon(s, r, front, rnd);
  if (R.floors === undefined) { flatRoof(s, r, podTop, wall, rnd, 3); return; }
  const tw = inset(r, R.inset as number), towerWall = R.towerWall as number, tile = R.tile as number;
  { const ci = inset(r, 0.04); s.span(ci.x0, podTop - 0.05, ci.z0, ci.x1, podTop + 0.05, ci.z1, C.roofLight); }   // inside the walls (see flatRoof)
  let top = facadeBox(s, tw.x0, tw.z0, tw.x1, tw.z1, podTop, [{ tile, floors: R.floors as number, floorH: 3.6 }], towerWall);
  let roofRect = tw;
  if (R.crown !== undefined) {
    const cr = inset(tw, 2.5);
    { const ci = inset(tw, 0.04); s.span(ci.x0, top - 0.05, ci.z0, ci.x1, top + 0.05, ci.z1, C.roofLight); }
    top = facadeBox(s, cr.x0, cr.z0, cr.x1, cr.z1, top, [{ tile, floors: R.crown as number, floorH: 3.6 }], towerWall);
    roofRect = cr;
  }
  flatRoof(s, roofRect, top, towerWall, rnd, 2);
};
// An antenna with a red tip, standing at (x, z) on a roof `y` up.
DRAW.antenna = (R, _g, s) => {
  const x = R.x as number, z = R.z as number, y = R.y as number;
  s.cyl(x, y + 4, z, 0.12, 8, C.metal, 5);
  s.box(x, y + 8.1, z, 0.35, 0.35, 0.35, 0xff2a1a);
};
// A block's paving over `rect`: paving, or grass (as the season colours it).
DRAW.paving = (R, g) => { const r = rectFrom(R.rect); g.span(r.x0, 0, r.z0, r.x1, LOT_TOP, r.z1, R.c === "grass" ? CS.grass : CS.pavers); };
// A downtown corner lot's plaza (plaza).
DRAW.cornerPlaza = (R, g, s, rnd) => plaza(g, s, rectFrom(R.rect), rnd);

// Theatres, the concert hall and Baton Tower get a scrolling marquee.
function wantsMarquee() {
  const f = DC.fac;
  return f === "theater" || f === "concertHall" || (f === "officeTower" && facilityName(DC.plan, f, DC.cx, DC.cz) === "Baton Tower");
}

function plaza(g: Batch, s: Batch, r: Rect, rnd: Rand) {
  g.span(r.x0 + 0.5, CURB_H, r.z0 + 0.5, r.x1 - 0.5, CURB_H + 0.02, r.z1 - 0.5, C.plaza);
  const cx = (r.x0 + r.x1) / 2, cz = (r.z0 + r.z1) / 2;
  if (rnd() < 0.5) chessStatues(s, cx, cz, rnd() * Math.PI * 2);   // the giant red panda and capybara, mid-game
  else {
    s.cyl(cx, CURB_H + 0.3, cz, 2.6, 0.6, 0xc8c2b4, 12);
    g.box(cx, CURB_H + 0.62, cz, 3.6, 0.02, 3.6, C.water);
    s.cyl(cx, CURB_H + 1.2, cz, 0.3, 1.4, 0xc8c2b4, 8);
  }
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    cityTree(s, cx + dx * (r.x1 - r.x0) * 0.32, CURB_H, cz + dz * (r.z1 - r.z0) * 0.32, range(rnd, 6, 8), range(rnd, 1.6, 2.2), pick(rnd, CS.trees.greens), rnd);
}

// Split a block into 1, 2 or 4 lots.
function splitLots(B: Rect, n: number, rnd: Rand): Rect[] {
  if (n === 1) return [B];
  const fx = range(rnd, 0.4, 0.6), fz = range(rnd, 0.4, 0.6);
  const mx = B.x0 + (B.x1 - B.x0) * fx, mz = B.z0 + (B.z1 - B.z0) * fz;
  if (n === 2) return rnd() < 0.5
    ? [{ ...B, x1: mx }, { ...B, x0: mx }]
    : [{ ...B, z1: mz }, { ...B, z0: mz }];
  return [{ x0: B.x0, z0: B.z0, x1: mx, z1: mz }, { x0: mx, z0: B.z0, x1: B.x1, z1: mz },
          { x0: B.x0, z0: mz, x1: mx, z1: B.z1 }, { x0: mx, z0: mz, x1: B.x1, z1: B.z1 }];
}

// Grid lots along the block's edges; the interior cells (not touching a street) come back flagged.
function gridLots(B: Rect, nx: number, nz: number): { r: Rect; edge: boolean }[] {
  const out: { r: Rect; edge: boolean }[] = [];
  const w = (B.x1 - B.x0) / nx, d = (B.z1 - B.z0) / nz;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++)
      out.push({ r: { x0: B.x0 + i * w, z0: B.z0 + j * d, x1: B.x0 + (i + 1) * w, z1: B.z0 + (j + 1) * d },
                 edge: i === 0 || j === 0 || i === nx - 1 || j === nz - 1 });
  for (const { r } of out) for (const [x, z] of [[r.x0, r.z1], [r.x1, r.z1], [r.x1, r.z0], [r.x0, r.z0]]) PLACED.lots.push(...toTile(x, z));   // (for the city maps)
  return out;
}

function buildCommercial(g: Batch, s: Batch, B: Rect, rnd: Rand) {
  place("paving", { rect: rectOf(B), c: "pavers" }, g, s, rnd);
  const nx = irange(rnd, 2, 3), nz = irange(rnd, 2, 3);
  for (const { r, edge } of gridLots(B, nx, nz)) {
    if (!edge) {
      // (A few parked cars, nose in or backed in: each its side of the aisle and its look, one draw.)
      const cars: (number[] | 0)[] = [];
      for (let i = 0; i < 4; i++) if (rnd() < 0.6) { const side = rnd() < 0.5 ? -2 : 2; cars.push([side, Math.round(rnd() * 1e6) / 1e6]); } else cars.push(0);
      place("parkingLot", { rect: rectOf(r), cars }, g, s, rnd);
      continue;
    }
    const floors = Math.min(CS.maxShopFloors, Math.max(CS.id === "mainstreet" ? 2 : 1, 1 + Math.floor(rnd() * rnd() * 5)));
    const wall = pick(rnd, CS.walls.commercial), b = inset(r, 0.15);
    const tile = floors > 1 ? pick(rnd, CS.upperTiles) : undefined;
    // Awning over the storefront on the street side; neon; a fire escape up a tall one.
    const side = streetSide(b, B, 1), awn = side >= 0 && rnd() < 0.7 ? pick(rnd, CS.awnings) : undefined;
    const neon = side >= 0 && rnd() < CS.neon, esc = side >= 0 && CS.fireEscapes && floors >= 3 && rnd() < 0.5;
    place("shop", { rect: rectOf(b), floors, wall, side, ...(tile !== undefined ? { tile } : {}), ...(awn !== undefined ? { awning: awn } : {}), ...(neon ? { neon: true } : {}), ...(esc ? { fireEscape: true } : {}) }, g, s, rnd);
  }
}
// A grid block's shop (buildCommercial) on `rect`: its floors (above its storefront, the upper
// floors' `tile`), its wall, its street side (`side`, -1 none) and there an awning's colour,
// neon and a fire escape.
DRAW.shop = (R, _g, s, rnd) => {
  const b = rectFrom(R.rect), floors = R.floors as number, wall = R.wall as number, side = R.side as number;
  const bands: FacadeBand[] = [{ tile: FACADE.STOREFRONT, floors: 1, floorH: 4.2 }];
  if (floors > 1) bands.push({ tile: R.tile as number, floors: floors - 1, floorH: 3.4 });
  const top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, CURB_H, bands, wall);
  flatRoof(s, b, top, wall, rnd, floors > 2 ? 2 : 1);
  if (R.awning !== undefined) awning(s, b, side, R.awning as number);
  if (R.neon) shopNeon(s, b, side, rnd);
  if (R.fireEscape) fireEscape(s, b, side, floors, 4.2, 3.4, rnd);
};
// A car park in a grid block's middle: its bays, and in the first four a car each (its side of
// the aisle and its look) or none.
DRAW.parkingLot = (R, g, s) => {
  const r = rectFrom(R.rect), cars = R.cars as (number[] | 0)[];
  g.span(r.x0, CURB_H, r.z0, r.x1, CURB_H + 0.01, r.z1, C.asphalt);
  for (let x = r.x0 + 1; x < r.x1 - 1; x += 2.6) g.box(x, CURB_H + 0.02, (r.z0 + r.z1) / 2, 0.1, 0.01, (r.z1 - r.z0) * 0.7, C.white);
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    if (!c) continue;
    const x = r.x0 + 2.3 + i * 2.6 * 1.5, z = (r.z0 + r.z1) / 2 + c[0], h = c[1];
    if (x > r.x1 - 1.5) break;
    parkedCar(s, carKindAt(h * 7 % 1, false), x, CURB_H + 0.01, z, (h * 13 % 1 < 0.5 ? 1 : -1) * Math.PI / 2, carPaintAt(h));
  }
};

const AWNING_Y = 3.3, AWNING_T = 0.12;   // (above the kerb)
function awning(s: Batch, b: Rect, side: number, color: number) {
  const y = CURB_H + AWNING_Y, dep = 1.3, t = AWNING_T;
  if (side === 0) s.span(b.x0 + 0.6, y, b.z1, b.x1 - 0.6, y + t, b.z1 + dep, color);
  else if (side === 1) s.span(b.x1, y, b.z0 + 0.6, b.x1 + dep, y + t, b.z1 - 0.6, color);
  else if (side === 2) s.span(b.x0 + 0.6, y, b.z0 - dep, b.x1 - 0.6, y + t, b.z0, color);
  else s.span(b.x0 - dep, y, b.z0 + 0.6, b.x0, y + t, b.z1 - 0.6, color);
}

function buildResidential(g: Batch, s: Batch, B: Rect, rnd: Rand) {
  place("paving", { rect: rectOf(B), c: "grass" }, g, s, rnd);
  if (rnd() < 0.25) { // apartment courts
    for (const { r } of gridLots(B, 2, 2)) {
      const b = inset(r, 2.2);
      const wall = pick(rnd, CS.walls.residential.concat(CS.walls.commercial.slice(0, 3)));
      const floors = irange(rnd, 3, 5), side = streetSide(b, B, 4);
      place("court", { rect: rectOf(b), wall, floors, side, tile: pick(rnd, [FACADE.APARTMENT, FACADE.BRICK, FACADE.RESIDENTIAL]) }, g, s, rnd);
      plantTree(s, (r.x0 + r.x1) / 2 + range(rnd, -6, 6), CURB_H, side % 2 ? (r.z0 + r.z1) / 2 : (side === 0 ? r.z1 - 1.2 : r.z0 + 1.2), range(rnd, 5, 7), 1.6, pick(rnd, CS.trees.greens), rnd);
    }
    return;
  }
  if (CS.houses === "row") { buildRowHouses(g, s, rnd); return; }
  // Houses on a 4x4 lot grid; the middle four cells are back gardens.
  const lots = gridLots(B, 4, 4);
  for (const { r, edge } of lots) {
    if (!edge) {
      if (rnd() < 0.6) plantTree(s, range(rnd, r.x0 + 2, r.x1 - 2), CURB_H, range(rnd, r.z0 + 2, r.z1 - 2), range(rnd, 5, 8), range(rnd, 1.5, 2.3), pick(rnd, CS.trees.greens), rnd);
      else if (rnd() < 0.3) place("pool", { rect: rectOf({ x0: r.x0 + 3, z0: r.z0 + 3, x1: r.x1 - 3, z1: r.z1 - 4 }) }, g, s, rnd);
      else place("shed", { x: cm2((r.x0 + r.x1) / 2), z: cm2((r.z0 + r.z1) / 2), wall: pick(rnd, CS.walls.residential) }, g, s, rnd);
      continue;
    }
    const front = streetSide(r, B, 1);
    const lw = r.x1 - r.x0, ld = r.z1 - r.z0;
    // House footprint: wide along the frontage, set back from it.
    const along = Math.min(range(rnd, 6.5, 8.5), (front % 2 ? ld : lw) - 1.6);
    const deep = range(rnd, 6.5, 8);
    const setback = range(rnd, 2.2, 3.2);
    const ca = front % 2 ? (r.z0 + r.z1) / 2 + range(rnd, -0.6, 0.6) : (r.x0 + r.x1) / 2 + range(rnd, -0.6, 0.6);
    let h: Rect;
    if (front === 0) h = { x0: ca - along / 2, x1: ca + along / 2, z1: r.z1 - setback, z0: r.z1 - setback - deep };
    else if (front === 2) h = { x0: ca - along / 2, x1: ca + along / 2, z0: r.z0 + setback, z1: r.z0 + setback + deep };
    else if (front === 1) h = { z0: ca - along / 2, z1: ca + along / 2, x1: r.x1 - setback, x0: r.x1 - setback - deep };
    else h = { z0: ca - along / 2, z1: ca + along / 2, x0: r.x0 + setback, x1: r.x0 + setback + deep };
    const wall = pick(rnd, CS.walls.residential);
    const bungalow = CS.houses === "bungalow";
    const floors = bungalow ? 1 : rnd() < 0.55 ? 2 : 1;
    const fields: Record<string, unknown> = { rect: rectOf(h), lot: rectOf(r), front, wall, floors };
    if (bungalow) { fields.bungalow = true; if (rnd() < 0.6) fields.gravel = true; }
    else { fields.gable = pick(rnd, CS.gables); if (rnd() < 0.5) fields.chimney = true; }
    place("house", fields, g, s, rnd);
    // A yard tree.
    if (rnd() < 0.45) {
      const fx = (h.x0 + h.x1) / 2, fz = (h.z0 + h.z1) / 2;
      const tz = front % 2 ? (rnd() < 0.5 ? r.z0 + 1.3 : r.z1 - 1.3) : fz, tx = front % 2 ? fx : (rnd() < 0.5 ? r.x0 + 1.3 : r.x1 - 1.3);
      if (rnd() < 0.3) place("conifer", { x: cm2(tx), z: cm2(tz), h: cm2(range(rnd, 5, 7)) }, g, s, rnd);
      else plantTree(s, tx, CURB_H, tz, range(rnd, 4.5, 6), range(rnd, 1.2, 1.7), pick(rnd, CS.trees.greens), rnd);
    }
  }
}
// An apartment court (buildResidential) on `rect`: its wall, floors (the first PUNCHED, the rest
// `tile`), its door on its street side (`side`).
DRAW.court = (R, _g, s, rnd) => {
  const b = rectFrom(R.rect), wall = R.wall as number;
  const top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, CURB_H,
    [{ tile: FACADE.PUNCHED, floors: 1, floorH: 3.4 }, { tile: R.tile as number, floors: (R.floors as number) - 1, floorH: 3.2 }], wall, R.side as number, FACADE.DOOR);
  flatRoof(s, b, top, wall, rnd, 2);
};
// A detached house (buildResidential) on `rect` in its `lot`, facing `front`: its wall and floors;
// a flat-roofed bungalow (perhaps a gravel yard) or a gable roof (its colour, perhaps a chimney)
// with its ridge along the street; a path from its door to the street.
DRAW.house = (R, g, s, rnd) => {
  const h = rectFrom(R.rect), r = rectFrom(R.lot), front = R.front as number, wall = R.wall as number, floors = R.floors as number;
  const top = facadeBox(s, h.x0, h.z0, h.x1, h.z1, CURB_H, [{ tile: R.bungalow ? FACADE.PUNCHED : FACADE.SIDING, floors, floorH: 3.0 }], wall, front, FACADE.DOOR);
  if (R.bungalow) {
    flatRoof(s, h, top, wall, rnd, 1);
    if (R.gravel) g.span(h.x0 - 1, CURB_H, h.z0 - 1, h.x1 + 1, CURB_H + 0.015, h.z1 + 1, 0xc8b08a);
  } else {
    const ridgeX = front % 2 === 0;
    const rw = (ridgeX ? h.x1 - h.x0 : h.z1 - h.z0) + 0.5, rd = (ridgeX ? h.z1 - h.z0 : h.x1 - h.x0) + 0.8, rh = rd * 0.36;
    s.prism((h.x0 + h.x1) / 2, top + rh / 2, (h.z0 + h.z1) / 2, rw, rh, rd, R.gable as number, ridgeX ? 0 : Math.PI / 2);
    if (R.chimney) {
      const chx = ridgeX ? h.x0 + 1.2 : (h.x0 + h.x1) / 2, chz = ridgeX ? (h.z0 + h.z1) / 2 : h.z0 + 1.2;
      s.box(chx, top + rh * 0.9, chz, 0.7, rh * 1.2, 0.7, 0x8a4a3a);
    }
  }
  const fx = (h.x0 + h.x1) / 2, fz = (h.z0 + h.z1) / 2;
  if (front === 0) g.span(fx - 0.6, CURB_H, h.z1, fx + 0.6, CURB_H + 0.02, r.z1, C.path);
  else if (front === 2) g.span(fx - 0.6, CURB_H, r.z0, fx + 0.6, CURB_H + 0.02, h.z0, C.path);
  else if (front === 1) g.span(h.x1, CURB_H, fz - 0.6, r.x1, CURB_H + 0.02, fz + 0.6, C.path);
  else g.span(r.x0, CURB_H, fz - 0.6, h.x0, CURB_H + 0.02, fz + 0.6, C.path);
};
// A back garden's pool on `rect`.
DRAW.pool = (R, g) => { const r = rectFrom(R.rect); g.span(r.x0, CURB_H, r.z0, r.x1, CURB_H + 0.03, r.z1, 0x3aa0d0); };
// A dark conifer (a yard's), `h` tall.
DRAW.conifer = (R, _g, s) => { conifer(s, R.x as number, CURB_H, R.z as number, R.h as number, (R.c as number | undefined) ?? 0x1f5a34); };

// Row houses along every street side, touching, with gardens behind: painted Victorians with
// bay windows and street-facing gables in a coastal city, brick and brownstone with flat roofs
// and cornices elsewhere.
function buildRowHouses(g: Batch, s: Batch, rnd: Rand) {
  const victorian = CS.id === "coastal";
  const depth = 10, setback = victorian ? 1.2 : 0.6;
  for (let side = 0; side < 4; side++) {
    // The north and south rows run the full block; east and west rows fill between them.
    const [lo, hi] = side < 2 ? [9.4, 50.6] : [9 + setback + depth + 0.6, 51 - setback - depth - 0.6];
    const n0 = setback, n1 = setback + depth;
    let a = lo, alt = 0;
    const stoops: number[] = [];   // (door a, bay width) of each
    let doorAt = -1, doorD = Infinity;
    while (hi - a > 4.2) {
      const w = Math.min(hi - a, hi - a < 9 ? hi - a : range(rnd, 4.8, 6.4));
      const wall = pick(rnd, CS.walls.residential);
      const floors = victorian ? irange(rnd, 2, 3) : irange(rnd, 3, 4);
      const tile = victorian ? FACADE.SIDING : pick(rnd, [FACADE.BRICK, FACADE.RESIDENTIAL, FACADE.APARTMENT]);
      // The painted door's bay (facadeBox: the middle bay of the street wall, in its corner order).
      { const da = doorBayA(side, a, w); if (Math.abs(da - 25) < doorD) { doorD = Math.abs(da - 25); doorAt = da; } }
      // (Its two ends, each to the centimetre, so its wall and its neighbour's meet exactly.)
      const e0 = cm2(a), e1 = cm2(a + w);
      place("rowHouse", { side, a0: e0, a1: e1, n0: cm2(n0), wall, floors, tile, ...(victorian ? { gable: pick(rnd, CS.gables), alt: alt++ & 1 } : {}) }, g, s, rnd);
      if (!victorian) stoops.push(doorBayA(side, e0, e1 - e0), (e1 - e0) / Math.max(1, Math.round((e1 - e0) / BAY)));
      a += w;
    }
    // A step at each painted door, as entranceDoor gives the real one (its half width from the
    // painted frame's: PAINTED_DOORS), but not at the house whose door the driver uses, on a block
    // that has one (kerbDoors: a facility's, at a kerb or a stand), which has its own step.
    const pd = PAINTED_DOORS[FACADE.DOOR]!, kind = siteLayout(DC.plan, DC.cx, DC.cz).kind;
    const real = doorAt >= 0 && !!DC.fac && (kind === "kerb" || kind === "stand"), steps: number[] = [];
    for (let i = 0; i < stoops.length; i += 2) {
      const sa = stoops[i], hw = stoops[i + 1] * (pd[1] - pd[0]) / 2 / FACADE_TILE + 0.15;
      if (!real || Math.abs(sa - doorAt) > 0.5) steps.push(cm2(sa - hw), cm2(sa + hw));
    }
    if (steps.length) place("stoops", { side, n0: cm2(n0), steps }, g, s, rnd);
    if (doorAt >= 0) place("doorSpot", { side, a: cm2(doorAt), n: cm2(n0) }, g, s, rnd);
  }
  // Back gardens.
  for (let i = 0; i < 4; i++) {
    const [x, z] = frontPt(0, range(rnd, 22, 38), range(rnd, 13, 29));
    if (rnd() < 0.7) plantTree(s, x, CURB_H, z, range(rnd, 5, 7), range(rnd, 1.4, 2), pick(rnd, CS.trees.greens), rnd);
  }
}

// A row house (buildRowHouses) on block side `side`, from `a0` to `a1` along it, its front `n0` in:
// its wall, floors and tile; a Victorian's gable (its colour; `alt` keeps neighbours' end faces
// apart) and bay window, or else a flat roof and a cornice.
DRAW.rowHouse = (R, _g, s, rnd) => {
  const side = R.side as number, a = R.a0 as number, a1 = R.a1 as number, w = a1 - a, n0 = R.n0 as number, depth = 10, wall = R.wall as number, floors = R.floors as number;
  const r = frontRect(side, a, a1, n0, n0 + depth);
  const top = facadeBox(s, r.x0, r.z0, r.x1, r.z1, CURB_H, [{ tile: R.tile as number, floors, floorH: 3.1 }], wall, FACE_OF[side], FACADE.DOOR);
  if (R.gable !== undefined) {
    const d = FRONT_NODE[side][2], ridgeAlongX = RIGHT[d][0] !== 0;
    s.prism((r.x0 + r.x1) / 2, top + w * 0.27, (r.z0 + r.z1) / 2, depth + 0.4 + (R.alt as number) * 0.04, w * 0.54, w + 0.25, R.gable as number, ridgeAlongX ? 0 : Math.PI / 2);
    fspan(s, side, a + w * 0.25, a + w * 0.75, CURB_H + 3.3, CURB_H + 3.1 * floors - 0.3, n0 - 0.7, n0, shade(wall, 1.06));
    fspan(s, side, a + w * 0.2, a + w * 0.8, CURB_H + 3.1 * floors - 0.3, CURB_H + 3.1 * floors - 0.1, n0 - 0.8, n0, 0xf2f2ea);
  } else {
    flatRoof(s, r, top, wall, rnd, 0);
    fspan(s, side, a, a1, top - 0.35, top + 0.1, n0 - 0.35, n0, shade(wall, 0.7));   // cornice
  }
};
// Where a facility's driver uses a block's side's door (kerbDoors), when its builder knows: a row's.
DRAW.doorSpot = (R) => { doorSpot(R.side as number, R.a as number, R.n as number); };
// The steps up to a row's painted doors (`steps`: each its two ends along side `side`).
DRAW.stoops = (R, _g, s) => {
  const side = R.side as number, n0 = R.n0 as number, st = R.steps as number[];
  for (let i = 0; i < st.length; i += 2) fspan(s, side, st[i], st[i + 1], 0, CURB_H + 0.03, n0 - 0.5, n0, 0x9d9a91);
};

// `stand`: a service bay's container at the kerb (buildStand); no yard faces it.
function buildIndustrial(g: Batch, s: Batch, B: Rect, rnd: Rand, stand: StandLayout | null = null) {
  place("paving", { rect: rectOf(B), c: "concrete" }, g, s, rnd);
  const two = rnd() < 0.45;
  const lots = two ? splitLots(B, 2, rnd) : [B];
  for (const lot of lots) {
    // Warehouse set back from the streets with a yard on one side for the docks.
    let yardSide = irange(rnd, 0, 3);
    if (stand && yardSide === FACE_OF[stand.side]) yardSide = (yardSide + 1) % 4;
    const yard = range(rnd, 11, 15);
    const r = inset(lot, 2.5);
    // (Further back behind an end-on container, on its side of the block.)
    if (stand?.forklift) {
      const f = FACE_OF[stand.side], gap = END_ON_DEPTH + 0.6;
      if (f === 0 && lot.z1 === B.z1) r.z1 = B.z1 - gap; else if (f === 1 && lot.x1 === B.x1) r.x1 = B.x1 - gap;
      else if (f === 2 && lot.z0 === B.z0) r.z0 = B.z0 + gap; else if (f === 3 && lot.x0 === B.x0) r.x0 = B.x0 + gap;
    }
    if (yardSide === 0) r.z1 -= yard; else if (yardSide === 1) r.x1 -= yard; else if (yardSide === 2) r.z0 += yard; else r.x0 += yard;
    // (Clear of a side-on container by 20 cm, its corner posts and rails included: where the
    // building's end met them, the two shared planes and flickered.)
    if (stand && !stand.forklift) {
      const b = standBox(stand), c = frontRect(stand.side, b.a0 - 0.25, b.a1 + 0.25, b.n0 - 0.25, b.n1 + 0.25);
      if (r.x0 < c.x1 && r.x1 > c.x0 && r.z0 < c.z1 && r.z1 > c.z0) {
        const cut = [c.x1 - r.x0, r.x1 - c.x0, c.z1 - r.z0, r.z1 - c.z0], k = cut.indexOf(Math.min(...cut));
        if (k === 0) r.x0 = c.x1; else if (k === 1) r.x1 = c.x0; else if (k === 2) r.z0 = c.z1; else r.z1 = c.z0;
      }
    }
    if (r.x1 - r.x0 < 8 || r.z1 - r.z0 < 8) continue;
    const wall = pick(rnd, CS.walls.industrial), height = range(rnd, 9, 12);
    const street = streetSide(r, lot, 6), ghost = street >= 0 && street !== yardSide && rnd() < CS.ghostSigns;
    const along = yardSide % 2 === 0; // dock wall runs along x
    // A port yard holds containers under a gantry crane; an old brick one has a rail spur.
    // (More often on the waterfront: outline.ts.)
    const quay = !!DC.plan?.shoreLine.nearShore(DC.cx, DC.cz);
    let special = CS.cranes && rnd() < (quay ? 0.85 : 0.45) ? "crane" : CS.rail && rnd() < 0.45 ? "rail" : "";
    if (stand) special = "";   // a yard can reach the kerb at the block's corners
    // (Its parked trailers: a colour for each dock, 0 for none.)
    const n = special ? 0 : Math.floor(((along ? r.x1 - r.x0 : r.z1 - r.z0) - 2) / 4.5), trailers: number[] = [];
    for (let i = 0; i < n; i++) trailers.push(rnd() > 0.45 ? 0 : pick(rnd, [0xeeeeea, 0xeeeeea, 0xb03a2e, 0x2d5f9a, 0x8a8f94]));
    const extra = rnd() < 0.35 ? "tanks" : rnd() < 0.3 ? "stack" : "";
    // A small office annex with a ribbon window at one end of the street side.
    let annex: Record<string, unknown> | null = null;
    if (rnd() < 0.6) {
      const side = streetSide(r, lot, 4);
      const o: Rect = side === 2 ? { x0: r.x0 + 1, x1: r.x0 + 9, z0: r.z0 - 4.5, z1: r.z0 }
        : side === 0 ? { x0: r.x0 + 1, x1: r.x0 + 9, z0: r.z1, z1: r.z1 + 4.5 }
        : side === 3 ? { z0: r.z0 + 1, z1: r.z0 + 9, x0: r.x0 - 4.5, x1: r.x0 }
        : side === 1 ? { z0: r.z0 + 1, z1: r.z0 + 9, x0: r.x1, x1: r.x1 + 4.5 } : null as unknown as Rect;
      if (o && o.x0 >= lot.x0 && o.z0 >= lot.z0 && o.x1 <= lot.x1 && o.z1 <= lot.z1 && side !== yardSide) annex = { rect: rectOf(o), wall: pick(rnd, CS.walls.downtown), side };
    }
    place("warehouse", { lot: rectOf(lot), rect: rectOf(r), yardSide, wall, height: cm2(height), ...(ghost ? { ghost: street } : {}), ...(special ? { special } : {}), trailers, ...(extra ? { extra } : {}), ...(annex ? { annex } : {}) }, g, s, rnd);
  }
}
// An industrial grid block's warehouse (buildIndustrial) on `rect` in its `lot`, its docks' yard on
// side `yardSide`: its wall and height, a ghost sign on its street side (`ghost`), a gantry crane
// or a rail spur in its yard (`special`) or else trailers at its docks (a colour each, 0 none),
// storage tanks or a brick stack (`extra`), an office `annex`.
DRAW.warehouse = (R, g, s, rnd) => {
  const lot = rectFrom(R.lot), r = rectFrom(R.rect), yardSide = R.yardSide as number, wall = R.wall as number, height = R.height as number;
  const tiles = [0, 1, 2, 3].map((k) => (k === yardSide ? FACADE.DOCK : FACADE.INDUSTRIAL));
  const top = facadeBox(s, r.x0, r.z0, r.x1, r.z1, CURB_H, [{ tile: tiles, floors: 1, floorH: 5 }, { tile: FACADE.INDUSTRIAL, floors: 1, floorH: height - 5 }], wall);
  flatRoof(s, r, top, wall, rnd, 0);
  if (R.ghost !== undefined) ghostSign(r, R.ghost as number, CURB_H + 5 + (height - 5) / 2, rnd);
  // Roof vents in a row.
  const vx = (r.x0 + r.x1) / 2;
  for (let z = r.z0 + 3; z < r.z1 - 2; z += 6) s.cyl(vx, top + 0.6, z, 0.5, 1.2, C.metal, 6);
  // Yard: dock apron, and what stands in it.
  const yd = (l: Rect): Rect => yardSide === 0 ? { ...l, z0: r.z1 } : yardSide === 1 ? { ...l, x0: r.x1 } : yardSide === 2 ? { ...l, z1: r.z0 } : { ...l, x1: r.x0 };
  const Y = yd(inset(lot, 0.5)), apron = inset(Y, 0.01);   // (the apron a cm short of the yard's edges: a stand's container's sleepers stood on one)
  g.span(apron.x0, CURB_H, apron.z0, apron.x1, CURB_H + 0.01, apron.z1, 0x5c5c58);
  const along = yardSide % 2 === 0;
  if (R.special === "crane") portCrane(s, Y, along, rnd);
  else if (R.special === "rail") railSpur(g, s, Y, along, rnd);
  (R.trailers as number[]).forEach((col, i) => {
    if (!col) return;
    const p = (along ? r.x0 : r.z0) + 2.5 + i * 4.5, L = 12;
    if (yardSide === 0) s.span(p - 1.25, CURB_H + 1.1, r.z1 + 0.3, p + 1.25, CURB_H + 4.0, r.z1 + 0.3 + Math.min(L, Y.z1 - r.z1 - 0.5), col);
    else if (yardSide === 2) s.span(p - 1.25, CURB_H + 1.1, r.z0 - 0.3 - Math.min(L, r.z0 - Y.z0 - 0.5), p + 1.25, CURB_H + 4.0, r.z0 - 0.3, col);
    else if (yardSide === 1) s.span(r.x1 + 0.3, CURB_H + 1.1, p - 1.25, r.x1 + 0.3 + Math.min(L, Y.x1 - r.x1 - 0.5), CURB_H + 4.0, p + 1.25, col);
    else s.span(r.x0 - 0.3 - Math.min(L, r.x0 - Y.x0 - 0.5), CURB_H + 1.1, p - 1.25, r.x0 - 0.3, CURB_H + 4.0, p + 1.25, col);
  });
  if (R.extra === "tanks") { const tx = r.x0 + 3, tz = r.z0 + 3; for (let k = 0; k < 2; k++) s.cyl(tx + k * 5, top + 2.5, tz, 2, 5, 0xd8d8d0, 10); }
  else if (R.extra === "stack") { s.cyl(r.x1 - 2.5, top + 6, r.z1 - 2.5, 0.9, 12, 0x8a4a3a, 8); s.cyl(r.x1 - 2.5, top + 11.5, r.z1 - 2.5, 0.95, 0.6, 0xf2f2ea, 8); }
  const A = R.annex as { rect: number[]; wall: number; side: number } | undefined;
  if (A) { const o = rectFrom(A.rect), ot = facadeBox(s, o.x0, o.z0, o.x1, o.z1, CURB_H, [{ tile: FACADE.RIBBON, floors: 2, floorH: 3.3 }], A.wall, A.side, FACADE.LOBBY); flatRoof(s, o, ot, A.wall, rnd, 0); }
};

function buildPark(g: Batch, s: Batch, B: Rect, rnd: Rand, keep: Rect | null = null) {
  const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, w = B.x1 - B.x0;
  // (No pond where it would reach a deep stand's back.)
  const pond = rnd() < 0.4 && !(keep && Math.max(keep.x0 - (cx + w * 0.22), 0, (cx + w * 0.22) - keep.x1) ** 2 + Math.max(keep.z0 - (cz + w * 0.22), 0, (cz + w * 0.22) - keep.z1) ** 2 < 6.3 ** 2);
  place("park", { rect: rectOf(B), ...(pond ? { pond: true } : {}) }, g, s, rnd);
  const n = irange(rnd, 16, 26);
  for (let i = 0; i < n; i++) {
    const x = range(rnd, B.x0 + 2, B.x1 - 2), z = range(rnd, B.z0 + 2, B.z1 - 2);
    if (Math.abs(x - cx) < 2.6 || Math.abs(z - cz) < 2.6) continue;
    if (pond && Math.hypot(x - (cx + w * 0.22), z - (cz + w * 0.22)) < 7.5) continue;
    if (keep && x > keep.x0 && x < keep.x1 && z > keep.z0 && z < keep.z1) continue;   // the stand's corner of the park
    if (rnd() < 0.25) { const h = range(rnd, 6, 9); place("conifer", { x: cm2(x), z: cm2(z), h: cm2(h), c: pick(rnd, [0x1f5a34, 0x24663a]) }, g, s, rnd); }
    else plantTree(s, x, CURB_H, z, range(rnd, 5.5, 9), range(rnd, 1.6, 2.6), pick(rnd, CS.trees.greens), rnd);
  }
}
// A park on a grid block's `rect` (buildPark): its grass, cross paths, a pond or a fountain in the
// middle, two benches (its trees are trees of their own).
DRAW.park = (R, g, s) => {
  const B = rectFrom(R.rect), cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, w = B.x1 - B.x0;
  g.span(B.x0, 0, B.z0, B.x1, LOT_TOP, B.z1, CS.grass);
  g.span(B.x0, CURB_H, cz - 1.2, B.x1, CURB_H + 0.02, cz + 1.2, C.path);
  g.span(cx - 1.2, CURB_H, B.z0, cx + 1.2, CURB_H + 0.02, B.z1, C.path);
  if (R.pond) {
    const px = cx + w * 0.22, pz = cz + w * 0.22;
    s.cyl(px, CURB_H + 0.02, pz, 6.2, 0.06, 0xcabf9e, 14);
    s.cyl(px, CURB_H + 0.05, pz, 5.6, 0.06, C.water, 14);
  } else {
    s.cyl(cx, CURB_H + 0.25, cz, 3.2, 0.5, 0xc8c2b4, 14);
    g.box(cx, CURB_H + 0.52, cz, 4.4, 0.02, 4.4, C.water);
    s.cyl(cx, CURB_H + 1.2, cz, 0.35, 1.6, 0xc8c2b4, 8);
  }
  for (const [bx, bz, rot] of [[cx - 6, cz + 1.9, 0], [cx + 6, cz - 1.9, 0]] as const) s.box(bx, CURB_H + 0.45, bz, 1.8, 0.1, 0.5, 0x7a5232, rot);   // benches
};

// The frontage `a` of the painted door on a row house spanning [a, a + w] (facadeBox puts it in
// bay floor(bays / 2) of the street wall, counted along the wall's corner order).
function doorBayA(side: number, a: number, w: number): number {
  const bays = Math.max(1, Math.round(w / BAY)), f = (Math.floor(bays / 2) + 0.5) / bays;
  // Corner order runs +z x0->x1, +x z1->z0, -z x1->x0, -x z0->z1: with the frontage or against it.
  const face = FACE_OF[side], dirs: [number, number][] = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  const [fx, fz] = FWD[FRONT_NODE[side][2]], along = dirs[face][0] * fx + dirs[face][1] * fz > 0;
  return along ? a + w * f : a + w * (1 - f);
}

// ---- park stands ---------------------------------------------------------------------------
// A park facility's own small building (facilities.ts StandLayout): on one side, just behind the
// pavement and left of the park's entrance path (a = 30), with its door at L.a facing the street
// for the driver (kerbDoors finds it through doorSpot; the chunk draws the door, entranceDoor).
// Each kind dresses it for the business: a farm stand, a potting shed, a pumpkin or tree-lot
// hut, a fair's ticket booth, a marina's bait shack, a wedding venue's caterer's cottage.
// Its footprint in frontage: a shed beside the park path; a 20 ft container (6.06 x 2.44 m) right
// at the back of the pavement, in front of a warehouse set 2.5 m back.
export const END_ON_HALF = 1.22;   // half the end-on container's width (crew.ts stackPlan keeps the stack clear of it)
const standBox = (L: StandLayout) => L.stand !== "container" ? { a0: 23.2, a1: 28.3, n0: 0.9, n1: L.forklift ? 6.6 : 4.1 }
  : L.forklift ? { a0: L.a - END_ON_HALF, a1: L.a + END_ON_HALF, n0: 0.03, n1: 6.09 } : { a0: 23.0, a1: 29.06, n0: 0.03, n1: 2.47 };
export const END_ON_DEPTH = 6.06;   // room behind an end-on container's doors (crew.ts parks the forklift in it)
const standKeepOut = (L: StandLayout): Rect => { const b = standBox(L); return frontRect(L.side, b.a0 - 3.5, b.a1 + 2.5, -1, b.n1 + 3); };
interface StandLook { wall: number; trim: number; roof: number; win: number; pitch: number }
const STAND_LOOKS: Record<StandLayout["stand"], StandLook[]> = {
  farmStand: [{ wall: 0x9b2f26, trim: 0xf2efe8, roof: 0x3d4440, win: 0x2a3644, pitch: 1.5 }, { wall: 0x8a3a2a, trim: 0xe8e2d0, roof: 0x5b4636, win: 0x2a3644, pitch: 1.5 }],
  pottingShed: [{ wall: 0x6f8f6a, trim: 0xf2efe8, roof: 0x8d9296, win: 0xbfe0d8, pitch: 1.1 }, { wall: 0x4f6f5a, trim: 0xe8e2d0, roof: 0x6b6f72, win: 0xbfe0d8, pitch: 1.1 }],
  salesHut: [{ wall: 0xa87a4a, trim: 0x6a4a2a, roof: 0x5b3a22, win: 0x2a3644, pitch: 0.9 }, { wall: 0xb88a5a, trim: 0x5b4636, roof: 0x3d4440, win: 0x2a3644, pitch: 0.9 }],
  ticketBooth: [{ wall: 0xf2efe8, trim: 0xc0392b, roof: 0xc0392b, win: 0x2a3644, pitch: 1.6 }, { wall: 0xf2efe8, trim: 0x2d5f9a, roof: 0x2d5f9a, win: 0x2a3644, pitch: 1.6 }],
  baitShack: [{ wall: 0x5b7a8c, trim: 0xf2efe8, roof: 0x6b6f72, win: 0x2a3644, pitch: 1.2 }, { wall: 0x8a9a8a, trim: 0xf2efe8, roof: 0x4f5d6e, win: 0x2a3644, pitch: 1.2 }],
  container: [{ wall: 0xb03a2e, trim: 0x7a2820, roof: 0, win: 0x2a3644, pitch: 0 }, { wall: 0x2d5f9a, trim: 0x1f4270, roof: 0, win: 0x2a3644, pitch: 0 },
    { wall: 0xc4c8cc, trim: 0x8a8f94, roof: 0, win: 0x2a3644, pitch: 0 }, { wall: 0x3d6b3a, trim: 0x2a4a28, roof: 0, win: 0x2a3644, pitch: 0 }],
  pavilion: [{ wall: 0xf2efe8, trim: 0xd8c89a, roof: 0x8aa0b0, win: 0x2a3644, pitch: 1.4 }, { wall: 0xeae4d8, trim: 0xb5a58a, roof: 0x6a7a8a, win: 0x2a3644, pitch: 1.4 }],
};
function buildStand(g: Batch, s: Batch, L: StandLayout, rnd: Rand) {
  const side = L.side, k = L.stand, look = STAND_LOOKS[k][Math.floor(L.look * STAND_LOOKS[k].length)];
  if (k === "container") { buildContainer(s, L, look); return; }
  const { a0, a1, n0, n1 } = standBox(L), y0 = CURB_H;
  const [dHalf, dH] = wideDoor(DC.fac) ? [WIDE_DOOR_HALF, WIDE_DOOR_H] : [DOOR_HALF, DOOR_H];
  const top = y0 + dH + 0.75;   // room over the door for its frame and light
  const d = FRONT_NODE[side][2], ridgeX = FWD[d][0] !== 0;
  const at = (a: number, n: number) => frontPt(side, a, n);
  // Body, corner boards and a fascia under the eaves (proud of the wall: shared planes flicker).
  fspan(s, side, a0, a1, y0, top, n0, n1, look.wall);
  for (const [p, q] of [[a0 - 0.06, a0 + 0.12], [a1 - 0.12, a1 + 0.06]]) fspan(s, side, p, q, y0, top - 0.18, n0 - 0.06, n0 + 0.12, look.trim);   // (up to the fascia)
  fspan(s, side, a0 - 0.06, a1 + 0.06, top - 0.18, top + 0.02, n0 - 0.07, n1 + 0.07, look.trim);   // (its top just above the walls': shared planes flicker)
  // A path in from the pavement to the door.
  fspan(g, side, L.a - 0.7, L.a + 0.7, CURB_H, CURB_H + 0.02, 0, n0, C.path);
  // The window right of the door, with a sill.
  const w0 = L.a + dHalf + 0.45, w1 = a1 - 0.4;
  fspan(s, side, w0, w1, y0 + 1.0, y0 + 2.0, n0 - 0.05, n0 + 0.02, look.win);
  fspan(s, side, w0 - 0.08, w1 + 0.08, y0 + 0.92, y0 + 1.0, n0 - 0.14, n0 + 0.02, look.trim);
  // The roof: a gable with its ridge along the street, overhanging the walls.
  { const [cx, cz] = at((a0 + a1) / 2, (n0 + n1) / 2);
    s.prism(cx, top + look.pitch / 2, cz, a1 - a0 + 0.5, look.pitch, n1 - n0 + 0.7, look.roof, ridgeX ? 0 : Math.PI / 2); }
  doorSpot(side, L.a, n0);
  const awning = (c0: number, c1: number) => {   // striped, over the window
    for (let i = 0, n = 5; i < n; i++) {
      const p = w0 - 0.2 + ((w1 - w0 + 0.4) * i) / n, q = w0 - 0.2 + ((w1 - w0 + 0.4) * (i + 1)) / n;
      fspan(s, side, p, q, y0 + 2.12, y0 + 2.22, n0 - 0.85, n0 + 0.02, i % 2 ? c1 : c0);
    }
  };
  const obstacle = (a: number, n: number, r: number) => { const [x, z] = at(a, n); pavementObstacle(x, z, r); };
  switch (k) {
    case "farmStand": {
      // Crates of produce on a bench at the side.
      fspan(s, side, a0 - 1.6, a0 - 0.1, y0, y0 + 0.75, n0 + 0.3, n0 + 1.3, 0x7a5232);
      for (let i = 0; i < 3; i++) {
        const c = [0xc0392b, 0x6aa84f, 0xe0a020, 0x8a4a8a][Math.floor(rnd() * 4)];
        fspan(s, side, a0 - 1.5 + i * 0.47, a0 - 1.1 + i * 0.47, y0 + 0.75, y0 + 1.05, n0 + 0.4, n0 + 1.2, 0xa87a4a);
        fspan(s, side, a0 - 1.45 + i * 0.47, a0 - 1.15 + i * 0.47, y0 + 1.05, y0 + 1.15, n0 + 0.45, n0 + 1.15, c);
      }
      break;
    }
    case "pottingShed": {
      // Glazing along the side, and terracotta pots out front of it.
      fspan(s, side, a0 + 0.4, a1 - 0.4, y0 + 1.0, top - 0.3, n1 - 0.02, n1 + 0.05, look.win);
      for (let i = 0; i < 4; i++) { const [x, z] = at(a0 - 0.5 - (i % 2) * 0.55, n0 + 0.5 + Math.floor(i / 2) * 0.7); s.cyl(x, y0 + 0.2, z, 0.2 + rnd() * 0.06, 0.4, 0xb5562e, 8); s.ico(x, y0 + 0.55, z, 0.26, pick(rnd, CS.trees.greens)); }
      break;
    }
    case "salesHut": {
      // A striped awning over the window, and the stock by the side: pumpkins or cut trees.
      awning(0xc0392b, 0xf2efe8);
      if (DC.fac === "treeLot") for (let i = 0; i < 4; i++) { const [x, z] = at(a0 - 0.6 - (i % 2) * 0.9, n0 + 0.6 + Math.floor(i / 2) * 1.1); conifer(s, x, y0, z, range(rnd, 1.6, 2.2), 0x1f5a34, false, true); }
      else for (let i = 0; i < 6; i++) { const [x, z] = at(a0 - 0.4 - range(rnd, 0, 1.6), n0 + range(rnd, 0.2, 2.6)); s.ico(x, y0 + 0.2, z, range(rnd, 0.2, 0.3), 0xe07a1f, 0.75); }
      break;
    }
    case "ticketBooth": {
      // A striped awning in the booth's colour, and a pennant on the ridge.
      awning(look.trim, 0xf2efe8);
      const [px, pz] = at((a0 + a1) / 2, (n0 + n1) / 2);
      s.cyl(px, top + look.pitch + 0.6, pz, 0.04, 1.2, C.pole, 5);
      const [fx, fz] = at((a0 + a1) / 2 + 0.35, (n0 + n1) / 2);
      s.box(fx, top + look.pitch + 1.0, fz, ridgeX ? 0.6 : 0.03, 0.35, ridgeX ? 0.03 : 0.6, 0xf2c200);
      break;
    }
    case "baitShack": {
      // A life ring on the wall beside the door (where it fits), an upturned rowboat at the side, a mooring post.
      if (L.a - dHalf - 0.1 - (a0 + 0.12) > 0.75) { const [x, z] = at((a0 + 0.12 + L.a - dHalf - 0.1) / 2, n0 - 0.04), rx = RIGHT[d][0] !== 0;
        s.cyl(x, y0 + 1.7, z, 0.34, 0.07, 0xe0601e, 10, rx ? 0 : Math.PI / 2, rx ? Math.PI / 2 : 0);
        s.cyl(x, y0 + 1.7, z, 0.17, 0.09, look.wall, 10, rx ? 0 : Math.PI / 2, rx ? Math.PI / 2 : 0); }
      { const [x, z] = at(a0 - 1.3, n0 + 0.85), [fx, fz] = at(a0 - 0.2, n0 + 0.85), o = { scale: 0.62, upturned: true };   // (along the wall, its bow towards the door)
        boatAt(s, "rowboat", x, y0 - boatExtent("rowboat", o).lo, z, Math.atan2(-(fz - z), fx - x), 0x2d5f9a, o); }
      { const [x, z] = at(a0 - 2.9, n0 + 0.6); s.cyl(x, y0 + 0.9, z, 0.08, 1.8, 0x7a5232, 5); }   // a mooring post
      break;
    }
    case "pavilion": {
      // Potted topiaries either side of the door, and a lantern on a post by the path.
      for (const da of [-1.15, 1.15]) {
        const [x, z] = at(L.a + da, n0 - 0.35);
        s.cyl(x, y0 + 0.25, z, 0.24, 0.5, 0xd8d2c4, 8); s.ico(x, y0 + 0.85, z, 0.36, 0x2e5a3a, 1.2);
        obstacle(L.a + da, n0 - 0.35, 0.36);
      }
      break;
    }
  }
}

// A shipping container fitted out as a site office or yard store: a door (man or service) cut into its long side facing the
// street, a window beside it with a little canopy over both, corrugated walls (ribs proud of the
// sides, except where the door and window are cut), corner posts and a pair of cargo doors at
// one end, on timber sleepers.
function buildContainer(s: Batch, L: StandLayout, look: StandLook) {
  if (L.forklift) { buildContainerEndOn(s, L, look); return; }
  const side = L.side, { a0, a1, n0, n1 } = standBox(L), y0 = CURB_H, top = y0 + 2.9, y1 = y0 + 0.1;   // high cube, on sleepers
  for (const a of [a0 + 0.5, (a0 + a1) / 2, a1 - 0.5]) fspan(s, side, a - 0.12, a + 0.12, y0, y1, n0 + 0.1, n1 - 0.1, 0x5a4030);
  fspan(s, side, a0, a1, y1, top, n0, n1, look.wall);
  // Corner posts, top and bottom rails (proud of the walls).
  for (const a of [a0, a1 - 0.16]) for (const n of [n0 - 0.03, n1 - 0.13]) fspan(s, side, a - 0.02, a + 0.18, y1, top + 0.02, n, n + 0.16, look.trim);
  for (const [p, q] of [[y1, y1 + 0.16], [top - 0.14, top + 0.01]]) {
    fspan(s, side, a0 + 0.1, a1 - 0.1, p, q, n0 - 0.04, n0 + 0.1, look.trim);
    fspan(s, side, a0 + 0.1, a1 - 0.1, p, q, n1 - 0.1, n1 + 0.04, look.trim);
  }
  // Ribs on both long sides; the street side's stop short of the door and the window.
  // (A wide service door, for the forklift or the pallet jack, is lower than usual: the light over it
  // stays under the roof.)
  const wide = wideDoor(DC.fac), dHalf = wide ? WIDE_DOOR_HALF : DOOR_HALF;
  const door0 = L.a - dHalf - 0.2, door1 = L.a + dHalf + 0.2, w0 = door1 + 0.35, w1 = Math.min(w0 + 1.3, a1 - 0.5);
  for (let a = a0 + 0.35; a < a1 - 0.3; a += 0.3) {
    if (!(a > door0 - 0.08 && a < w1 + 0.08)) fspan(s, side, a - 0.05, a + 0.05, y1 + 0.16, top - 0.14, n0 - 0.035, n0 + 0.02, shade(look.wall, 0.86));
    fspan(s, side, a - 0.05, a + 0.05, y1 + 0.16, top - 0.14, n1 - 0.02, n1 + 0.035, shade(look.wall, 0.86));
  }
  // The window, framed, and a canopy over door and window.
  // (Their backs short of the ribs', 2 cm into the wall: shared planes flicker.)
  fspan(s, side, w0 - 0.06, w1 + 0.06, y0 + 1.04, y0 + 2.06, n0 - 0.03, n0 + 0.015, 0xd8d4c8);
  fspan(s, side, w0, w1, y0 + 1.1, y0 + 2.0, n0 - 0.05, n0 + 0.01, look.win);
  fspan(s, side, door0 - 0.2, w1 + 0.25, top - 0.02, top + 0.05, n0 - 0.8, n0 + 0.015, 0xd8d4c8);   // above the door's light
  // Cargo doors at the far end: two leaves and their locking bars.
  const a = a1 + 0.03;
  fspan(s, side, a - 0.03, a + 0.01, y1 + 0.16, top - 0.14, n0 + 0.13, n1 - 0.13, shade(look.wall, 0.94));
  for (const n of [n0 + 0.45, n0 + 0.85, n1 - 0.85, n1 - 0.45]) fspan(s, side, a, a + 0.04, y1 + 0.2, top - 0.18, n - 0.025, n + 0.025, C.metal);
  doorSpot(side, L.a, n0, { h: wide ? 2.4 : 0 });
}
// End-on to the street, for a flatbed yard: its own cargo doors face the kerb and are the door,
// with room inside for the forklift and what it carries. Ribs along both long sides, corner
// posts and rails, plain cargo doors at the back too.
function buildContainerEndOn(s: Batch, L: StandLayout, look: StandLook) {
  const side = L.side, { a0, a1, n0, n1 } = standBox(L), y0 = CURB_H, top = y0 + 2.9, y1 = y0 + 0.1, rib = shade(look.wall, 0.86);
  for (const n of [n0 + 0.5, (n0 + n1) / 2, n1 - 0.5]) fspan(s, side, a0 + 0.1, a1 - 0.1, y0, y1, n - 0.12, n + 0.12, 0x5a4030);   // sleepers
  fspan(s, side, a0, a1, y1, top, n0, n1, look.wall);
  for (const a of [a0 - 0.03, a1 - 0.13]) for (const n of [n0 - 0.02, n1 - 0.16]) fspan(s, side, a, a + 0.16, y1, top + 0.02, n, n + 0.18, look.trim);
  for (const [p, q] of [[y1, y1 + 0.16], [top - 0.14, top + 0.01]]) {
    fspan(s, side, a0 - 0.04, a0 + 0.1, p, q, n0 + 0.1, n1 - 0.1, look.trim);
    fspan(s, side, a1 - 0.1, a1 + 0.04, p, q, n0 + 0.1, n1 - 0.1, look.trim);
    fspan(s, side, a0 + 0.1, a1 - 0.1, p, q, n0 - 0.04, n0 + 0.05, look.trim);   // over and under the doors
  }
  for (let n = n0 + 0.35; n < n1 - 0.3; n += 0.3)
    for (const [p, q] of [[a0 - 0.035, a0 + 0.02], [a1 - 0.02, a1 + 0.035]]) fspan(s, side, p, q, y1 + 0.16, top - 0.14, n - 0.05, n + 0.05, rib);
  // The back doors (never opened) and their bars.
  fspan(s, side, a0 + 0.13, a1 - 0.13, y1 + 0.16, top - 0.14, n1 - 0.01, n1 + 0.03, shade(look.wall, 0.94));
  for (const a of [a0 + 0.45, a0 + 0.85, a1 - 0.85, a1 - 0.45]) fspan(s, side, a - 0.025, a + 0.025, y1 + 0.2, top - 0.18, n1, n1 + 0.04, C.metal);
  doorSpot(side, L.a, n0, { h: top - 0.16 - y0 - 0.02, half: (a1 - a0) / 2 - 0.16, panel: shade(look.wall, 0.94), frame: look.trim, plain: true });
}

// ---- warehouses ----------------------------------------------------------------------------
// Each dock building has a look of its own, drawn from the chunk's random stream and the business
// it houses: cladding and colour, height, roof (flat, sawtooth or barrel), an accent colour on
// the parapet band and the canopy, and extras such as rooftop tanks, a smokestack, a rooftop
// office or refrigeration units. Returns the main roof's height.
const WAREHOUSE_WALLS = [0xd6d0c4, 0xc9c5b8, 0x9aa7b0, 0x7d8a96, 0x5f6f62, 0xc8b89a, 0xa0a4a8, 0x8a5a48, 0xe2ddd2, 0x6a7a8a, 0xb5a58a, 0x8e9aa3, 0x9a6b4f, 0x4f5d6e];
const WAREHOUSE_ACCENTS = [0x2d5f9a, 0xb03a2e, 0x2e7d4f, 0xe0a020, 0x3a3d40, 0xd8d4c8, 0x7a2e5a, 0x1f8a8a, 0xd0631e];
const TANKS = new Set(["bottling", "brewery", "creamery", "chemPlant", "mill", "foodServiceWh", "vendingDepot"]);
const STACKS = new Set(["factory", "paperMill", "chemPlant", "brewery", "mill"]);
function buildWarehouse(s: Batch, side: number, face: number, L: DockLayout, r: Rect, district: District, rnd: Rand): number {
  const P = DOCK_PLATFORM, fac = DC.fac ?? "";
  const wall = district === "industrial" ? (rnd() < 0.7 ? pick(rnd, WAREHOUSE_WALLS) : pick(rnd, CS.walls.industrial))
    : pick(rnd, district === "downtown" ? CS.walls.downtown : CS.walls.commercial);
  const accent = pick(rnd, WAREHOUSE_ACCENTS);
  const cladding = pick(rnd, [FACADE.INDUSTRIAL, FACADE.INDUSTRIAL, FACADE.SIDING, FACADE.BRICK, FACADE.RIBBON, FACADE.BLANK]);
  const height = L.deep ? range(rnd, 8.5, 14) : range(rnd, 8.5, 10.5);
  const tiles = [0, 1, 2, 3].map((k) => (k === face ? FACADE.BLANK : cladding));   // the dock doors are modelled (buildDockSite)
  const top = facadeBox(s, r.x0, r.z0, r.x1, r.z1, 0,
    [{ tile: FACADE.BLANK, floors: 1, floorH: P }, { tile: tiles, floors: 1, floorH: 4.6 }, { tile: cladding, floors: 1, floorH: height - P - 4.6 }], wall);
  // A painted band round the top on about half of them.
  if (rnd() < 0.5) s.span(r.x0 - 0.06, top - 0.9, r.z0 - 0.06, r.x1 + 0.06, top - 0.3, r.z1 + 0.06, accent);
  // Roof.
  const roofK = rnd(), saw = (fac === "factory" || fac === "mill" || fac === "paperMill" || fac === "tireDist") ? roofK < 0.7 : roofK < 0.2;
  if (saw) {
    // Sawtooth: rows of north lights across the building.
    DC.roofs.push({ r, top: top + 1.6 });
    { const ci = inset(r, 0.04); s.span(ci.x0, top - 0.05, ci.z0, ci.x1, top + 0.05, ci.z1, pick(rnd, CS.roofs)); }   // inside the walls (see flatRoof)
    const roofC = shade(wall, 0.75);
    for (let a = L.a0 + 0.5; a < L.a1 - 3; a += 4.5) {
      fspan(s, side, a, a + 3.6, top, top + 0.8, L.wall + 0.3, 39.2, roofC);
      fspan(s, side, a + 3.6, a + 4.1, top, top + 1.7, L.wall + 0.3, 39.2, 0x34465a);   // the glazing
      fspan(s, side, a + 2.2, a + 3.6, top + 0.8, top + 1.4, L.wall + 0.3, 39.2, roofC);
    }
  } else if (roofK > 0.82 && !L.deep) {
    // Barrel vault: stepped arcs along the depth.
    DC.roofs.push({ r, top: top + 2.2 });
    const roofC = pick(rnd, [0x8a9096, 0x6f7b85, 0xa8a49a, shade(wall, 0.8)]);
    const span = L.a1 - L.a0;
    for (let k = 0; k < 4; k++) {
      const inset = span * [0, 0.12, 0.25, 0.38][k], y = top + [0, 0.9, 1.6, 2.05][k];
      fspan(s, side, L.a0 + inset, L.a1 - inset, k ? y - 0.05 : y, y + 0.9, L.wall, 39.5, roofC);   // the first from the walls' top, not overlapping them
    }
  } else {
    flatRoof(s, r, top, wall, rnd, L.deep ? 1 : 2);
  }
  // Extras by business.
  const mid = (L.a0 + L.a1) / 2;
  if (TANKS.has(fac) && !saw) {
    const n = 2 + Math.floor(rnd() * 3), tc = pick(rnd, [0xd8d8d4, 0xb8bcc0, 0x9aa4ac, accent]);
    for (let i = 0; i < n; i++) {
      const [tx, tz] = frontPt(side, L.a0 + 3 + i * 3.4, 34);
      const th = range(rnd, 4, 7);
      s.cyl(tx, top + th / 2 + 0.01, tz, 1.4, th, tc, 12); s.cone(tx, top + th + 0.35, tz, 1.45, 0.7, shade(tc, 0.8), 12);
    }
  }
  if (STACKS.has(fac) && rnd() < 0.8) {
    const [sx, sz] = frontPt(side, L.a1 - 3, 36), sh = range(rnd, 12, 20);
    s.cyl(sx, top + sh / 2 - 0.02, sz, 0.75, sh, 0x8a5a48, 10);   // (its foot down in the roof, off the plane other rooftop things stand on)
    for (const f of [0.78, 0.9]) s.cyl(sx, top + sh * f, sz, 0.8, 0.9, f > 0.85 ? 0xb03a2e : 0xe8e4dc, 10);   // painted bands
  }
  if (fac === "coldStorage" || fac === "creamery") {
    for (let i = 0; i < 3; i++) {   // refrigeration units with their fans
      const [ux, uz] = frontPt(side, L.a0 + 3 + i * 4, L.wall + 6);
      s.box(ux, top + 0.81, uz, 2.6, 1.6, 2.6, 0xd8dadc); s.cyl(ux, top + 1.62, uz, 0.9, 0.06, 0x2a2b2e, 10);
    }
  }
  // A rooftop office with a strip of windows at one end, on some of the bigger ones.
  if (L.deep ? rnd() < 0.45 : rnd() < 0.2) {
    const end = rnd() < 0.5, oa0 = end ? L.a1 - 9 : L.a0 + 0.05, oa1 = end ? L.a1 - 0.05 : L.a0 + 9;   // (off the roof's end and parapet planes: shared planes flicker)
    const o = frontRect(side, oa0, oa1, L.wall + 0.5, L.wall + 9);
    const otop = facadeBox(s, o.x0, o.z0, o.x1, o.z1, top, [{ tile: FACADE.RIBBON, floors: 1, floorH: 3.6 }], pick(rnd, [wall, 0xe2ddd2, 0x4f5d6e, accent]));
    s.span(o.x0 - 0.05, otop - 0.05, o.z0 - 0.05, o.x1 + 0.05, otop + 0.25, o.z1 + 0.05, shade(wall, 0.7));
  }
  // A canopy over the bays on about half (it clears a trailer's roof).
  if (rnd() < 0.5) {
    fspan(s, side, L.a0 + 0.3, L.a1 - 0.3, P + 4.5, P + 4.68, L.edge - 0.5, L.wall, accent);
    for (let a = L.a0 + 2; a < L.a1 - 1; a += 6) fspan(s, side, a - 0.06, a + 0.06, P + 4.0, P + 4.5, L.wall - 1.2, L.wall, C.dark);   // brackets (12 cm: at 10 their ends could share a lamp's planes)
  }
  // Vertical ribs up the cladding on plain walls: a little relief either side of the yard face.
  if (cladding === FACADE.BLANK || cladding === FACADE.SIDING) {
    for (let a = L.a0 + 1.5; a < L.a1 - 1; a += 3) fspan(s, side, a - 0.08, a + 0.08, P + 4.6, top - 0.95, L.wall - 0.06, L.wall - 0.005, shade(wall, 0.85));   // (off the wall's plane, which the canopy's back shares)
  }
  void mid;
  return top;
}

// ---- loading docks --------------------------------------------------------------------------
// A dock facility (facilities.ts siteLayout): a yard at street level on one side of the block,
// a platform at trailer-floor height along the building's dock wall, and doors on bays. Trucks
// use the active bay (its door stands open); in a deep industrial yard some other bays have
// trailers parked. Commercial and downtown docks are shallow (box trucks only) beside a store
// or tower that fronts the rest of the street.
function buildDockSite(g: Batch, s: Batch, L: DockLayout, district: District, hs: number, rnd: Rand,
                       quads: Quad[], uv: ReturnType<SignAtlas["uv"]> | null) {
  const side = L.side, face = FACE_OF[side], P = DOCK_PLATFORM;
  const bw = L.bays.length > 1 ? L.bays[1] - L.bays[0] : L.a1 - L.a0;
  const yardA1 = L.deep ? 51 : 31;
  const pave = district === "industrial" ? C.concrete : CS.pavers;
  // Ground: the block's raised base behind the yard (and beside a shallow one), the yard itself
  // at road level so trucks drive straight in.
  fspan(g, side, 9, 51, 0, LOT_TOP, L.edge + 0.02, 42, pave);   // (just behind the platform's face: shared planes flicker)
  // (Both up to the raised base's face, where theirs meet it back to back: a gap there is a slit
  // to the void that glints at a distance.)
  if (yardA1 < 51) fspan(g, side, yardA1, 51, 0, LOT_TOP, 0, L.edge + 0.02, pave);
  fspan(g, side, 9, yardA1, 0, 0.02, 0, L.edge + 0.02, 0x66655f);
  for (const b of L.bays) for (const k of [-1.7, 1.7]) fspan(g, side, b + k - 0.06, b + k + 0.06, 0.02, 0.03, 1.5, L.edge, C.yellow);

  // The dock building: a plinth up to platform height, a band of dock doors on the yard side,
  // then a building of its own (warehouseLook): wall colour and cladding, height, roof, an accent
  // colour and what the business adds (tanks, a stack, a rooftop office, a canopy...).
  const r = frontRect(side, L.a0, L.a1, L.wall, 39.5);
  // (storybook-landmark-knitting-works.ts builds the storybook city's knitting works: its hall and its process beside it.)
  // (victorian-landmark-steam-brewery.ts builds the Victorian city's steam brewery.)
  const top = DC.fac === "knittingWorks" ? buildWorksStatic(s, worksFrameOf((a, n) => frontPt(side, a, n)), L)
    : DC.fac === "steamBrewery" ? buildBreweryStatic(s, worksFrameOf((a, n) => frontPt(side, a, n)), L) : buildWarehouse(s, side, face, L, r, district, rnd);
  if (DC.fac === "ryderWarehouse" && uv) ryderRoofSign(s, r, top, face, uv);

  // Platform and its edge, bumpers, a door at every bay (the site's own style), the leveller,
  // seal and dock light at the bays trucks use, wall packs, the steps, and some dressing.
  const used = dockUsedBays(L), usedA = used.map((i) => L.bays[i]);
  const near = (i: number, k = 1) => used.some((u) => Math.abs(u - i) <= k);
  const lr = (salt: number) => hash2(Math.floor(L.look * 1e6), salt, 0x77, 0);   // the dressing's own randoms (stable per site)
  fspan(s, side, L.a0, L.a1, 0, P, L.edge, L.wall, 0x9d9a91);
  fspan(s, side, L.a0, L.a1, P - 0.08, P + 0.01, L.edge - 0.01, L.edge + 0.1, C.yellow);   // (1 cm proud of the platform's top: nearer, they flicker)
  for (const b of L.bays) for (const k of [-1.0, 1.0]) fspan(s, side, b + k - 0.14, b + k + 0.14, 0.6, 1.1, L.edge - 0.14, L.edge + 0.01, C.dark);   // (into the platform, off the steps' plane)
  const dw = bw * 0.41;
  const doorC = pick(rnd, [0xc4c8cc, 0xc4c8cc, 0x2d5f9a, 0xd8d2c4, 0x9b2a24, 0x3d6b3a, 0x5b6470, 0xe0b02a]);
  const doorH = dockDoorH(L), ribs = rnd() < 0.7, windows = rnd() < 0.35, shelter = rnd() < 0.4, frameC = rnd() < 0.5 ? C.dark : shade(doorC, 0.6);
  L.bays.forEach((b, i) => {
    // A roll-up door: panel, grooves, a strip of windows on some; a padded shelter round it on some
    // sites; a few doors left part open (never next to a used bay).
    const isUsed = used.includes(i);
    const open = !isUsed && !near(i) && lr(i) < 0.18 ? range(rnd, 0.3, 0.7) : 0;
    const y0 = P + doorH * open;
    fspan(s, side, b - dw - 0.12, b + dw + 0.12, P, P + doorH + 0.15, L.wall - 0.05, L.wall + 0.01, frameC);   // frame
    if (open > 0) fspan(s, side, b - dw, b + dw, P + 0.005, y0, L.wall - 0.07, L.wall - 0.04, 0x121416);      // dark inside (its foot off the frame's: shared planes flicker)
    fspan(s, side, b - dw, b + dw, y0, P + doorH, L.wall - 0.09, L.wall - 0.05, doorC);
    // (The window strip is on a panel of the door, so it rides up with it, between two ribs; on a
    // door part way up it may have rolled away into the head.)
    if (ribs) for (let y = y0 + 0.45; y < P + doorH - 0.1; y += 0.5) fspan(s, side, b - dw, b + dw, y, y + 0.04, L.wall - 0.1, L.wall - 0.09, shade(doorC, 0.75));
    if (windows && y0 + 1.85 < P + doorH - 0.1) fspan(s, side, b - dw + 0.2, b + dw - 0.2, y0 + 1.6, y0 + 1.85, L.wall - 0.1, L.wall - 0.09, 0x2a3644);
    if (shelter) {
      fspan(s, side, b - dw - 0.5, b - dw - 0.12, P, P + doorH + 0.4, L.wall - 0.55, L.wall, 0x232426);
      fspan(s, side, b + dw + 0.12, b + dw + 0.5, P, P + doorH + 0.4, L.wall - 0.55, L.wall, 0x232426);
      fspan(s, side, b - dw - 0.5, b + dw + 0.5, P + doorH + 0.15, P + doorH + 0.5, L.wall - 0.55, L.wall, 0x232426);
    }
    if (isUsed) {
      fspan(s, side, b - 1.05, b + 1.05, P, P + 0.025, L.edge, L.edge + 1.6, 0x70757a);                       // leveller plate
      fspan(s, side, b + dw + 0.55, b + dw + 0.85, P + 2.6, P + 2.9, L.wall - 0.2, L.wall - 0.005, 0xf2b200);  // dock light
      const bn = shelter ? L.wall - 0.6 : L.wall - 0.22;   // (out in front of a shelter where there is one, else by the wall)
      for (const k of [-1, 1]) fspan(s, side, b + k * (dw + 0.35) - 0.09, b + k * (dw + 0.35) + 0.09, P, P + 1.1, bn - 0.18, bn, C.yellow);   // bollards
    }
  });
  // Lights over the bays: a wall pack each, or a row of strip lights on some sites. Lit at night;
  // their light falls on the yard, the platform, the driver and the load (applyLampLight).
  const strip = lr(901) < 0.35;
  L.bays.forEach((b, i) => {
    if (strip && i % 2) return;
    const lb = used.includes(i) && !strip ? b + dw + 1.4 : b;   // clear of the used door's seal
    const [lx, lz] = frontPt(side, lb, L.wall - 0.25);
    const hw = strip ? 0.9 : 0.25;
    // (A little higher where its underside would come level with a canopy bracket's, 4 m over the
    // platform: shared planes flicker.)
    const ly = P + doorH + (Math.abs(doorH + 0.63 - 4) < 0.01 || Math.abs(doorH + 0.7 - 4) < 0.01 ? 0.025 : 0);
    fspan(s, side, lb - hw, lb + hw, ly + 0.7, ly + 0.95, L.wall - 0.35, L.wall - 0.005, 0x2a2b2e);   // (its back off the wall's plane, which the canopy's brackets share)
    const ax = s.aux.clone(); s.aux.set(0, 0, -2); fspan(s, side, lb - hw + 0.05, lb + hw - 0.05, ly + 0.63, ly + 0.71, L.wall - 0.32, L.wall - 0.03, C.lampHead); s.aux.copy(ax);
    DC.lampSites.push(lx, P + doorH + 0.6, lz);
  });
  // The steps (and a handrail on their outer side) for each used bay; one flight serves both
  // when they share the platform's end.
  const flights = new Set<number>();
  for (const p of usedA) flights.add(Math.round((p + dockStair(L, p)) * 10) / 10);
  for (const aS of flights) {
    for (let k = 0; k < 5; k++) fspan(s, side, aS - 0.55, aS + 0.55, 0, (k + 1) * P / 5, L.edge - 2.6 + k * 0.52, L.edge, 0x8f8c84);
    const out = aS < (L.a0 + L.a1) / 2 ? -1 : 1, ra = aS + out * 0.6;
    fspan(s, side, ra - 0.03, ra + 0.03, 0, 1.0, L.edge - 2.53, L.edge - 2.47, C.yellow);
    fspan(s, side, ra - 0.035, ra + 0.035, 0, P + 1.0, L.edge - 0.13, L.edge - 0.07, C.yellow);   // (wider than the rail: a bumper's side can share a plane with its)
    const d = FRONT_NODE[side][2], [mx, mz] = frontPt(side, ra, L.edge - 1.3), [rx, rz] = RIGHT[d];
    const run = 2.4, len = Math.hypot(run, P), th = Math.atan2(P, run);
    // Tilt a box lying along n so it rises towards the platform (+n).
    if (rx === 0) s.boxR(mx, 1.0 + P / 2, mz, 0.06, 0.06, len, C.yellow, -th * rz, 0, 0);
    else s.boxR(mx, 1.0 + P / 2, mz, len, 0.06, 0.06, C.yellow, 0, 0, th * rx);
  }
  const stairBlocked = (a: number) => [...flights].some((f) => Math.abs(f - a) < 1.6);
  // On the platform, away from the used bays and the steps: pallets, wrapped loads, cartons,
  // a parked pallet jack.
  L.bays.forEach((b, i) => {
    if (near(i) || lr(300 + i) > 0.45) return;
    for (const off of [-0.9, 0.9]) {
      const a = b + off;
      if (stairBlocked(a) || a < L.a0 + 0.6 || a > L.a1 - 0.6) continue;
      const k = lr(400 + i * 2 + (off > 0 ? 1 : 0)), n0 = L.edge + 0.5, n1 = L.edge + 1.5;
      if (k < 0.35) { fspan(s, side, a - 0.55, a + 0.55, P, P + 0.14, n0, n1, 0xa47a4a); fspan(s, side, a - 0.5, a + 0.5, P + 0.14, P + 1.2, n0 + 0.05, n1 - 0.05, 0xe8e8e2); }   // shrink-wrapped pallet
      else if (k < 0.6) { for (let y = 0; y < 4; y++) fspan(s, side, a - 0.55, a + 0.55, P + y * 0.15, P + y * 0.15 + 0.12, n0, n1, 0xa47a4a); }                          // empty pallets
      else if (k < 0.8) { fspan(s, side, a - 0.45, a + 0.45, P, P + 0.7, n0 + 0.1, n1 - 0.1, 0xb07a45); fspan(s, side, a - 0.3, a + 0.3, P + 0.7, P + 1.1, n0 + 0.2, n1 - 0.3, 0xb07a45); }   // cartons
      else if (k < 0.9) { fspan(s, side, a - 0.15, a + 0.15, P, P + 0.25, n0, n1 + 0.1, 0xe0a020); fspan(s, side, a - 0.02, a + 0.02, P + 0.25, P + 1.2, n1 + 0.05, n1 + 0.1, 0x222222); }   // pallet jack
    }
  });
  // A dumpster at the far end of the yard on some, against the platform.
  let dumpA = NaN;
  if (lr(902) < 0.5) {
    const a = L.a1 - 2.2;
    if (!stairBlocked(a) && !usedA.some((u) => Math.abs(u - a) < 4)) {
      const c = pick(rnd, [0x2e5e3a, 0x2d4f7a, 0x6a6e72]);
      dumpA = a;
      fspan(s, side, a - 1.6, a + 1.6, 0.25, 1.5, L.edge - 1.8, L.edge - 0.1, c);
      fspan(s, side, a - 1.65, a + 1.65, 1.5, 1.6, L.edge - 1.85, L.edge - 0.05, shade(c, 0.7));
    }
  }

  // Parked at other bays (never beside a used one, which trucks swing through): trailers in a
  // deep yard, another firm's box truck at some shallow docks.
  {
    const d = FRONT_NODE[side][2], alongX = FWD[d][0] !== 0;
    // (Recorded for the driver's walks, who goes round them: parkedObstacles.)
    const parked = (a0: number, a1: number, n0: number, n1: number) => { const r = frontRect(side, a0, a1, n0, n1); parkedObstacle(r.x0, r.z0, r.x1, r.z1); };
    // (The wheels' outer faces just past the chassis's sides: shared planes flicker.)
    const wheel = (b: number, n: number) => { const [wx, wz] = frontPt(side, b, n); s.cyl(wx, 0.5, wz, 0.5, 2.32, 0x1b1b1b, 10, alongX ? 0 : Math.PI / 2, alongX ? Math.PI / 2 : 0); };
    L.bays.forEach((b, i) => {
      if (used.some((u) => i >= u - 1 && i <= u + 2)) return;
      if (Math.abs(b - dumpA) < 3.2) return;   // (not into the dumpster)
      if (L.deep) {
        if (rnd() > 0.45) return;
        const col = pick(rnd, [0xeeeeea, 0xeeeeea, 0xb03a2e, 0x2d5f9a, 0x8a8f94]);
        const rear = L.edge - 0.25, front = rear - 14.6;
        parked(b - 1.3, b + 1.3, front - 0.3, rear);   // (and its landing gear)
        fspan(s, side, b - 1.3, b + 1.3, 1.15, 4.1, front, rear, col);
        fspan(s, side, b - 1.25, b + 1.25, 0.95, 1.15, front, rear, C.dark);
        for (const n of [rear - 1.9, rear - 3.1]) wheel(b, n);
        for (const k of [-0.9, 0.9]) fspan(s, side, b + k - 0.08, b + k + 0.08, 0, 1.0, front + 3.4, front + 3.6, 0x55585c);
      } else if (lr(500 + i) < 0.3) {
        const col = pick(rnd, [0xf2f2ee, 0xf2f2ee, 0x2d5f9a, 0xc8a020, 0x3d6b3a]), cab = pick(rnd, [0xf2f2ee, 0x2a2b2e, col]);
        const rear = L.edge - 0.15, boxF = rear - 6.2;
        parked(b - 1.2, b + 1.2, boxF - 2.4, rear);
        fspan(s, side, b - 1.2, b + 1.2, 1.0, 3.6, boxF, rear, col);                       // box
        fspan(s, side, b - 1.1, b + 1.1, 0.7, 1.0, boxF - 2.4, rear, C.dark);              // chassis (inside the cab's sides)
        fspan(s, side, b - 1.15, b + 1.15, 0.8, 2.9, boxF - 2.3, boxF - 0.05, cab);       // cab
        fspan(s, side, b - 1.0, b + 1.0, 2.0, 2.7, boxF - 2.32, boxF - 2.25, 0x2a3644);    // windscreen
        for (const n of [rear - 1.4, boxF - 1.6]) wheel(b, n);
      }
    });
  }

  // Fence along the street, open across the driveway.
  const posts = (from: number, to: number) => {
    for (let a = from; a <= to + 0.01; a += 2.5) fspan(s, side, a - 0.05, a + 0.05, 0, 1.9, 0.3, 0.4, 0x8a8f94);
    if (to - from > 0.5) for (const y of [1.0, 1.85]) fspan(s, side, from, to, y, y + 0.05, 0.32, 0.38, 0x8a8f94);
  };
  const pLo = Math.min(...usedA), pHi = Math.max(...usedA);
  if (pLo - 4.5 > 9.5) posts(9.2, pLo - 4.5);
  if (L.deep && pHi + 18 < 50.5) posts(pHi + 18, 50.8);

  // A shallow dock sits beside the store or tower that fronts the rest of the street (the knitting
  // works' yard is its process instead: storybook-landmark-knitting-works.ts).
  if (!L.deep && DC.fac !== "knittingWorks" && DC.fac !== "steamBrewery") {
    const sr = frontRect(side, L.a1, 48.5, 2, 39.5);
    if (district === "downtown") {
      const wall = pick(rnd, CS.walls.downtown);
      const pod = facadeBox(s, sr.x0, sr.z0, sr.x1, sr.z1, CURB_H, [{ tile: FACADE.LOBBY, floors: 1, floorH: 5 }, { tile: FACADE.PUNCHED, floors: 2, floorH: 3.6 }], wall);
      const tw = inset(sr, 2.5);
      const t2 = facadeBox(s, tw.x0, tw.z0, tw.x1, tw.z1, pod, [{ tile: pick(rnd, [FACADE.OFFICE, FACADE.CURTAIN, FACADE.RIBBON]), floors: Math.round(6 + hs * 10), floorH: 3.6 }], wall);
      { const ci = inset(sr, 0.04); s.span(ci.x0, pod - 0.05, ci.z0, ci.x1, pod + 0.05, ci.z1, C.roofLight); }   // inside the walls (see flatRoof)
      if (wantsMarquee()) marqueeCanopy(s, sr, face);
      if (uv && DC.fac === "officeTower" && facilityName(DC.plan, "officeTower", DC.cx, DC.cz) === "Baton Tower") batonCrown(s, tw, t2);
      else flatRoof(s, tw, t2, wall, rnd, 2);
    } else {
      const wall = pick(rnd, CS.walls.commercial);
      const t2 = facadeBox(s, sr.x0, sr.z0, sr.x1, sr.z1, CURB_H, [{ tile: FACADE.STOREFRONT, floors: 1, floorH: 4.2 }, { tile: FACADE.PUNCHED, floors: 1, floorH: 3.4 }], wall);
      flatRoof(s, sr, t2, wall, rnd, 2);
      awning(s, sr, face, pick(rnd, CS.awnings));
    }
  }

  // The name sign: across the dock wall above the doors, or on the store front.
  if (uv) {
    const d = FRONT_NODE[side][2], ox = -RIGHT[d][0], oz = -RIGHT[d][1];   // out towards the street
    if (DC.fac === "knittingWorks") {   // the sign goes up on the hall's gable, under the barrel roof's front
      const y = WORKS.hallTop + 3.4, n = L.wall + 0.28;
      fspan(s, side, 15.7, 25.3, y - 0.72, y + 0.72, n - 0.1, n, SB.ink);
      signQuad(quads, uv, side, 20.5, n - 0.11, y, 9.2, 1.15, ox, oz);
    } else if (L.deep) {
      const y = P + 4.6 + 1.1;
      fspan(s, side, 25, 35, y - 0.72, y + 0.72, L.wall - 0.12, L.wall - 0.012, C.dark);   // (off the wall's plane, and the ribs')
      signQuad(quads, uv, side, 30, L.wall - 0.13, y, 9.6, 1.2, ox, oz);
    } else {
      const y = CURB_H + 4.2 + 1.3;
      fspan(s, side, 34.2, 43.8, y - 0.65, y + 0.65, 1.88, 1.995, C.dark);
      signQuad(quads, uv, side, 39, 1.87, y, 9.2, 1.15, ox, oz);
    }
  }
}

// ---- Ryder rental lot -------------------------------------------------------------------------
// A lot of rental trucks parked nose to the street (main.ts bakes the real models in), a
// tractor-trailer along the back, the rental office on the front corner and a pylon sign. Swaps
// happen at the kerb in front, where the next truck waits.
function buildRentalLot(g: Batch, s: Batch, L: LotLayout, rnd: Rand, quads: Quad[], uv: ReturnType<SignAtlas["uv"]> | null): StallPose[] {
  const side = L.side, d = FRONT_NODE[side][2], face = FACE_OF[side];
  const ox = -RIGHT[d][0], oz = -RIGHT[d][1];
  fspan(g, side, 9, 51, 0, 0.02, 0, 42, 0x3b3c40);
  for (const st of L.stalls) for (const k of [-2.1, 2.1]) fspan(g, side, st.a + k - 0.06, st.a + k + 0.06, 0.02, 0.03, 3, LOT_STALL_REAR + 0.6, C.white);
  fspan(g, side, 13, 41, 0.02, 0.03, LOT_TRACTOR_N - 1.9, LOT_TRACTOR_N - 1.8, C.white);
  // Office: white with a Ryder-red fascia.
  const o = frontRect(side, 38.6, 48.5, 3, 13);
  const top = facadeBox(s, o.x0, o.z0, o.x1, o.z1, 0, [{ tile: FACADE.STOREFRONT, floors: 1, floorH: 4.2 }], 0xf2f2ee, face, FACADE.LOBBY);
  s.span(o.x0 - 0.06, top, o.z0 - 0.06, o.x1 + 0.06, top + 0.7, o.z1 + 0.06, 0xce1126);
  flatRoof(s, o, top + 0.7, 0xf2f2ee, rnd, 1);
  // Pylon sign by the street corner.
  const [px, pz] = frontPt(side, 11.4, 1.0);
  s.cyl(px, 3.6, pz, 0.2, 7.2, 0x8a8f94, 8);
  fspan(s, side, 9.2, 13.6, 6.9, 8.3, 0.75, 1.25, 0xce1126);
  // Fence round the back and sides.
  const fence = (a0: number, a1: number, n0: number, n1: number) => {
    const len = Math.hypot(a1 - a0, n1 - n0), k = Math.max(1, Math.round(len / 2.5));
    for (let i = 0; i <= k; i++) { const a = a0 + (a1 - a0) * i / k, n = n0 + (n1 - n0) * i / k; fspan(s, side, a - 0.05, a + 0.05, 0, 1.9, n - 0.05, n + 0.05, 0x8a8f94); }
    for (const y of [1.0, 1.85]) fspan(s, side, Math.min(a0, a1) - 0.03, Math.max(a0, a1) + 0.03, y, y + 0.05, Math.min(n0, n1) - 0.03, Math.max(n0, n1) + 0.03, 0x8a8f94);
  };
  fence(9.3, 50.7, 41.6, 41.6); fence(9.3, 9.3, 2, 41.6); fence(50.7, 50.7, 14, 41.6);
  for (const k of [0, 1, 2]) { const [fx, fz] = frontPt(side, 15 + k * 1.8, 0.6); flagpole(s, fx, fz, 7.5, k === 1 ? [0xffffff, 0xce1126] : [0xce1126, 0xffffff], d * Math.PI / 2); }
  if (uv) {
    for (const k of [1, -1]) signQuad(quads, uv, side, 11.4, 1.0 - k * 0.26, 7.6, 4.2, 0.52, ox * k, oz * k);
    signQuad(quads, uv, side, 43.55, 2.88, top + 0.35, 5.2, 0.65, ox, oz);
  }
  // Parked trucks: noses to the street, and the tractor along the back.
  const out: StallPose[] = [];
  const hOut = ((d + 1) % 4) * Math.PI / 2, hAlong = d * Math.PI / 2;
  for (const st of L.stalls) {
    if (!st.model) continue;
    const [x, z] = frontPt(side, st.a, LOT_STALL_REAR + truckExtents(st.model).rear);
    out.push({ model: st.model, x, z, h: hOut });
  }
  const [tx, tz] = frontPt(side, L.tractorA, LOT_TRACTOR_N);
  out.push({ model: "tractor", x: tx, z: tz, h: hAlong });
  return out;
}
