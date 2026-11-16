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
import { Batch, BATCH, quadGeometry } from "./geom.ts";
import type { Quad } from "./geom.ts";
import type { ChunkBuild } from "./chunks.ts";
import { LAMP_SITES, PoolBuilder } from "./atmosphere.ts";
import { truckExtents } from "./truck.ts";
import type { TruckModel } from "./truck.ts";
import { BAY, facadeBox } from "./facade.ts";
import { FACADE } from "./facadetiles.ts";
import type { FacadeBand } from "./facade.ts";
import { buildSignals, signalOffset } from "./signals.ts";
import { cityName, STYLES } from "./styles.ts";
import type { CityStyle } from "./styles.ts";
import { BARE, seasonGreens, seasonGround, SNOW } from "./climate.ts";
import type { Climate } from "./climate.ts";
import { buildGarage, GARAGE_DOOR, GARAGE_DRIVE } from "./garage.ts";
import { buildInterchange, INTERCHANGE_CLEAR, INTERCHANGE_DRIVE, INTERCHANGE_OPEN } from "./interchange.ts";
import { GARAGE_H } from "./route.ts";
import { buildFreewayStreet, Frame, freewayGate, freewayMerge, FW_OFF_K, FW_STREET_COLS, freewayStreetBent } from "./freeway.ts";
import { batonCrown, buildCableTracks, buildElevated, buildTownSquare, cableColumn, chessStatues, DC, EL_COLUMNS, ELEVATED_Y, elevatedBent, elevatedLine, fireEscape, flagpole, ghostSign, marqueeCanopy, PAVEMENT, pavementObstacle, portCrane, railSpur, roofBillboard, ryderRoofSign, shopNeon, streetFurniture, waterTower } from "./decor.ts";
import { DOCK_PLATFORM, dockDoorH, dockStair, dockUsedBays, facilityAt, facilityName, hasSign, LOT_STALL_REAR, LOT_TRACTOR_N, siteLayout, wideDoor } from "./facilities.ts";
import type { DockLayout, LotLayout, SiteLayout, StandLayout } from "./facilities.ts";
import { facilitySign, marquee, signAtlas, SignAtlas } from "./signs.ts";
import type { SignMesh, SignStyle } from "./signs.ts";
import { BIOME_OF } from "./country.ts";
import { BIOMES, landTree } from "./countryworld.ts";
import { BLOCK, STREET, KERB, CURB_H, RING } from "./grid.ts";

const LANE_EAST_OUTER = 13.5; // local z of the eastbound kerb lane's centre

export type District = "downtown" | "commercial" | "residential" | "industrial" | "park";

const CORE_CELL = 14; // blocks between downtown cores

// City limits: the city is the square of blocks [CITY_LO, CITY_HI] on both axes, ringed by RING
// blocks of countryside (the highway's own land takes over beyond). Its streets are those beside
// at least one block of the city, so the outermost ones run round its edge. The highway leaves
// and enters through gates: perimeter nodes with a street running straight out of town for one
// block (the gate street), where the country road begins (country.ts). Three gates a side.
export let CITY_LO = -12, CITY_HI = 11;
export interface Gate { ix: number; iz: number; dir: number }   // the perimeter node, and the way out of town
export const GATES: Gate[] = [];
// The city's size follows how long the truck spends in it (a short stay can't cross a big town):
// 24 blocks square for 20 minutes or more, 18 from 10, 12 below that.
export function setCityLimits(cityMinutes: number) {
  const half = cityMinutes >= 20 ? 12 : cityMinutes >= 10 ? 9 : 6, at = Math.round(half * 0.58);
  CITY_LO = -half; CITY_HI = half - 1;
  GATES.length = 0;
  for (const g of [-at, 0, at]) GATES.push({ ix: CITY_HI + 1, iz: g, dir: 0 }, { ix: g, iz: CITY_LO, dir: 1 }, { ix: CITY_LO, iz: g, dir: 2 }, { ix: g, iz: CITY_HI + 1, dir: 3 });
}
setCityLimits(30);
export const insideCity = (bx: number, bz: number) => bx >= CITY_LO && bx <= CITY_HI && bz >= CITY_LO && bz <= CITY_HI;
// The two blocks beside the street leaving node (ix, iz) in direction dir (0 east, 1 north, 2 west, 3 south).
function streetBlocks(ix: number, iz: number, dir: number): [number, number, number, number] {
  return dir === 0 ? [ix, iz - 1, ix, iz] : dir === 2 ? [ix - 1, iz - 1, ix - 1, iz] : dir === 1 ? [ix - 1, iz - 1, ix, iz - 1] : [ix - 1, iz, ix, iz];
}
// A city street (the truck and traffic drive only on these, plus the gate streets out of town).
export function cityStreet(ix: number, iz: number, dir: number) {
  const [ax, az, bx, bz] = streetBlocks(ix, iz, dir);
  return insideCity(ax, az) || insideCity(bx, bz);
}
const nodeInCity = (ix: number, iz: number) => ix >= CITY_LO && ix <= CITY_HI + 1 && iz >= CITY_LO && iz <= CITY_HI + 1;
// The gate whose gate street leaves node (ix, iz) in direction dir, if any.
const gateAt = (ix: number, iz: number, dir: number) => GATES.find((g) => g.ix === ix && g.iz === iz && g.dir === dir) ?? null;
// Distance in blocks (Chebyshev) from block (bx, bz) to the city; 0 inside.
export const cityDistance = (bx: number, bz: number) => Math.max(CITY_LO - bx, bx - CITY_HI, CITY_LO - bz, bz - CITY_HI, 0);
export function entryGateOf(citySeed: number): Gate { return GATES[Math.floor(hash2(citySeed, 5, 0, 0x6a7e) * GATES.length)]; }
// The gate street's outer end, where the country road starts (centre line), and the way out.
export function gateEnd(g: Gate): { x: number; z: number; h: number } {
  const d = BLOCK - STREET / 2;
  return { x: g.ix * BLOCK + STREET / 2 + [1, 0, -1, 0][g.dir] * d, z: g.iz * BLOCK + STREET / 2 + [0, -1, 0, 1][g.dir] * d, h: g.dir * Math.PI / 2 };
}

export class CityPlan {
  readonly name: string;
  climate: Climate | null = null;   // the city's season and weather (journey.ts), for the countryside round it
  constructor(readonly seed: number, readonly style: CityStyle = STYLES.coastal) { this.name = cityName(seed, style); }
  // The gate the highway comes in through: pure, from the city's seed.
  get entryGate(): Gate { return entryGateOf(this.seed); }
  // The gate whose street line the freeway runs along, if the city has one (freeway.ts).
  private fw: Gate | null | undefined;
  get freeway(): Gate | null { if (this.fw === undefined) this.fw = freewayGate(this.seed, this.style); return this.fw; }
  get freewayMerge(): boolean { return !!this.freeway && freewayMerge(this.seed); }
  // Where the truck comes off the freeway (interchange.ts), in a city it takes it into: the block
  // on the right a couple of blocks in, the side of it along the freeway (FRONT_NODE's), the node
  // the off-ramp leaves past and the way in.
  private ic: { bx: number; bz: number; side: number; ix: number; iz: number; dir: number } | null | undefined;
  get interchange() {
    if (this.ic !== undefined) return this.ic;
    const g = this.freeway;
    if (!g || !this.freewayMerge) return (this.ic = null);
    const d = (g.dir + 2) % 4, ix = g.ix + [1, 0, -1, 0][d] * FW_OFF_K, iz = g.iz + [0, -1, 0, 1][d] * FW_OFF_K;
    const [bx, bz] = d === 0 ? [ix, iz] : d === 2 ? [ix - 1, iz - 1] : d === 1 ? [ix, iz - 1] : [ix - 1, iz];
    return (this.ic = { bx, bz, side: [0, 2, 1, 3][d], ix, iz, dir: d });
  }
  interchangeAt(bx: number, bz: number) { const c = this.interchange; return !!c && c.bx === bx && c.bz === bz; }
  // On the freeway's street beside the interchange (the chunk's street along `axis`): where along
  // it (street-local) the deck's parapet opens for the off-ramp (and on which side, as
  // buildFreewayStreet's k), and where the way down crosses the sidewalk (no bents there).
  interchangeStreet(axis: number, cx: number, cz: number): { open: [number, number]; clear: [number, number]; k: number } | null {
    const c = this.interchange;
    if (!c) return null;
    const d = c.dir, [sx, sz, sa] = d === 0 ? [c.ix, c.iz, 0] : d === 2 ? [c.ix - 1, c.iz, 0] : d === 1 ? [c.ix, c.iz - 1, 1] : [c.ix, c.iz, 1];
    if (sx !== cx || sz !== cz || sa !== axis) return null;
    const at = (a: number) => (d === 0 || d === 3 ? 9 + a : 69 - a), span = (a0: number, a1: number): [number, number] => [Math.min(at(a0), at(a1)), Math.max(at(a0), at(a1))];
    return { open: span(INTERCHANGE_OPEN[0], INTERCHANGE_OPEN[1]), clear: span(INTERCHANGE_CLEAR[0], INTERCHANGE_CLEAR[1]), k: d === 0 || d === 3 ? -1 : 1 };
  }
  private fwFrame: Frame | null | undefined;
  get freewayFrame(): Frame | null { if (this.fwFrame === undefined) this.fwFrame = this.freeway ? Frame.ofCity(this, this.freeway) : null; return this.fwFrame; }
  // Whether the street leaving node (ix, iz) along axis (0: east, 1: south) is under the freeway.
  freewayStreet(axis: number, ix: number, iz: number) {
    const g = this.freeway;
    if (!g || !insideCity(ix, iz)) return false;
    return axis === 0 ? (g.dir === 0 || g.dir === 2) && iz === g.iz : (g.dir === 1 || g.dir === 3) && ix === g.ix;
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

  // Distance in blocks to the nearest downtown core (one jittered core per CORE_CELL square).
  coreDistance(bx: number, bz: number) {
    const cx = Math.floor(bx / CORE_CELL), cz = Math.floor(bz / CORE_CELL);
    let best = Infinity;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const gx = cx + dx, gz = cz + dz;
        const px = (gx + 0.25 + 0.5 * hash2(gx, gz, this.seed, 21)) * CORE_CELL;
        const pz = (gz + 0.25 + 0.5 * hash2(gx, gz, this.seed, 22)) * CORE_CELL;
        best = Math.min(best, Math.hypot(bx + 0.5 - px, bz + 0.5 - pz));
      }
    return best;
  }

  district(bx: number, bz: number): District {
    const d = this.coreDistance(bx, bz);
    const core = this.style.core;
    if (d < core) return "downtown";
    if (d > core - 0.4 && hash2(bx, bz, this.seed, 11) < 0.07) return "park";
    if (d < core + 2.2) return hash2(bx, bz, this.seed, 12) < 0.8 ? "commercial" : "residential";
    const n = this.noise(bx, bz, 5, 13);
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

export type Rand = () => number;
export const pick = <T,>(r: Rand, a: readonly T[]) => a[Math.floor(r() * a.length)];
export const range = (r: Rand, lo: number, hi: number) => lo + (hi - lo) * r();
export const irange = (r: Rand, lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * r());

export interface CityMaterials { ground: THREE.Material; solid: THREE.Material; lamp: THREE.Material }
// Parked trucks for a rental lot, in chunk-local coordinates (main.ts bakes them from the real
// truck models; absent in tests).
export interface StallPose { model: TruckModel; x: number; z: number; h: number }
export type FleetBuilder = (stalls: StallPose[]) => THREE.Object3D | null;

// Everything a city chunk is made of, as batches (`takeSlot` null: no sign atlas use, for probes).
function cityBatches(plan: CityPlan, cx: number, cz: number, takeSlot: ((text: string, style: SignStyle) => ReturnType<SignAtlas["uv"]> | null) | null) {
  const seed = plan.seed;
  CS = plan.style;
  const ground = new Batch(), solid = new Batch(), lamps = new Batch();
  const rnd = mulberry32(Math.floor(hash2(cx, cz, seed, 99) * 4294967296));
  const district = plan.district(cx, cz);
  if (!insideCity(cx, cz)) {
    Object.assign(DC, { lamps, quads: [], ads: false, mquads: [], roofs: [], fac: "residence", plan, cx, cz, pools: new PoolBuilder(), lampSites: [] as number[] });
    buildOutskirts(ground, solid, lamps, plan, cx, cz, rnd);
    return { ground, solid, lamps, stalls: [] as StallPose[], district, site: { kind: "kerb" } as SiteLayout };
  }
  const site = siteLayout(plan, cx, cz);
  Object.assign(DC, { lamps, quads: [], ads: false, mquads: [], roofs: [], fac: facilityAt(plan, cx, cz), plan, cx, cz, pools: new PoolBuilder(), lampSites: [] as number[] });
  const sign = takeSlot ? facilitySign(plan, cx, cz) : null;
  const uv = sign && takeSlot ? takeSlot(sign.text, sign.style) : null;
  // Base asphalt under everything; streets are what's left uncovered.
  ground.box(BLOCK / 2, -0.05, BLOCK / 2, BLOCK, 0.1, BLOCK, C.asphalt);
  // Each street's two sidewalks front this block and a neighbour (see streetFrontage).
  buildStreet(ground, solid, 0, district, rnd, streetFrontage(plan, cx, cz - 1, 1), streetFrontage(plan, cx, cz, 0));
  buildStreet(ground, solid, 1, district, rnd, streetFrontage(plan, cx - 1, cz, 3), streetFrontage(plan, cx, cz, 2));
  buildCorners(ground); buildMouths(ground, cx, cz);
  buildSignals(solid, lamps, STREET, KERB, signalOffset(cx, cz, seed));
  if (elevatedLine(CS, cz)) buildElevated(solid);
  for (const axis of [0, 1]) if (plan.freewayStreet(axis, cx, cz)) { const ic = plan.interchangeStreet(axis, cx, cz); buildFreewayStreet(solid, axis, ic ? { a0: ic.open[0], a1: ic.open[1], k: ic.k } : null); }
  if (CS.cableCar && cableColumn(cx)) buildCableTracks(ground);
  const B = { x0: STREET, z0: STREET, x1: BLOCK, z1: BLOCK };
  let stalls: StallPose[] = [];
  if (site.kind === "garage") buildGarage(ground, solid, site.side, rnd, plan.seed);
  else if (site.kind === "interchange") buildInterchange(ground, solid, site.side, plan.seed);
  else if (site.kind === "dock") buildDockSite(ground, solid, site, district, plan.downtownHeight(cx, cz), rnd, DC.quads, uv);
  else if (site.kind === "lot") stalls = buildRentalLot(ground, solid, site, rnd, DC.quads, uv);
  else if (CS.townSquare && district === "downtown" && plan.coreDistance(cx, cz) < 0.8) buildTownSquare(ground, solid, B, rnd);
  else {
    switch (district) {
      case "downtown": buildDowntown(ground, solid, B, plan.downtownHeight(cx, cz), rnd); break;
      case "commercial": buildCommercial(ground, solid, B, rnd); break;
      case "residential": buildResidential(ground, solid, B, rnd); break;
      case "industrial": buildIndustrial(ground, solid, B, rnd, site.kind === "stand" ? site : null); break;
      case "park": buildPark(ground, solid, B, rnd, site.kind === "stand" ? standKeepOut(site) : null); break;
    }
    if (site.kind === "stand") buildStand(ground, solid, site, rnd);
    if (uv) for (let side = 0; side < 4; side++) bladeSign(solid, side, DC.quads, uv);
    // Main Street towns have a water tower with the town's name, over a back garden.
    if (CS.townSquare && district === "residential" && hash2(cx, cz, seed, 0x77e) < 0.06)
      waterTower(solid, 39, 39, takeSlot ? takeSlot(plan.name.toUpperCase(), { bg: "#a8c4d8", fg: "#1d2f5a", logo: false }) : null);
  }
  if ((district === "commercial" || district === "downtown" || district === "industrial") && rnd() < CS.billboards) roofBillboard(solid, B, rnd);
  return { ground, solid, lamps, stalls, district, site };
}

// A generator (see ChunkStreamer): the doors in one stage, the block in the next. (Each stage
// runs whole: cityBatches works through module state, CS and DC, that a stage leaves as it found
// it for whatever runs between stages.)
export function makeCityChunkBuilder(mats: CityMaterials, plan: CityPlan, fleet: FleetBuilder | null = null): (cx: number, cz: number) => ChunkBuild {
  return function* (cx, cz) {
    // The entrance doors of a kerb facility (one per side, where kerbDoors found the building).
    const doors = insideCity(cx, cz) ? kerbDoors(plan, cx, cz) : [];
    yield;
    const slots: number[] = [];
    const takeSlot = (text: string, style: SignStyle) => { const k = signAtlas.alloc(text, style); if (k >= 0) slots.push(k); return k >= 0 ? signAtlas.uv(k) : null; };
    const { ground, solid, lamps, stalls, district } = cityBatches(plan, cx, cz, takeSlot);
    doors.forEach((d) => { if (d) entranceDoor(solid, d); });
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
    const pools = DC.pools.build(); if (pools) group.add(pools);
    if (DC.lampSites.length) LAMP_SITES.set(group, DC.lampSites.slice());   // their light: applyLampLight
    group.userData.onDispose = () => { for (const k of slots) signAtlas.release(k); if (signMesh) signAtlas.detach(signMesh); LAMP_SITES.delete(group); };
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
// `plain`: a container's cargo doors (locking bars, no windows or light).
export interface KerbDoor { side: number; a: number; n: number; x: number; z: number; nx: number; nz: number; frame: number; panel: number; half: number; h: number; plain: boolean; y?: number }   // (y: its sill, when not at the kerb's height)   // world centre of its foot, outward normal, colours, half width and height
const KERB_DOORS = new Map<string, (KerbDoor | null)[]>();
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
export interface PavementObstacle { x: number; z: number; r: number }
const PAVEMENT_CACHE = new Map<string, PavementObstacle[]>();
let pavementSeed = NaN;
export function pavementObstacles(plan: CityPlan, bx: number, bz: number): PavementObstacle[] {
  if (plan.seed !== pavementSeed) { PAVEMENT_CACHE.clear(); pavementSeed = plan.seed; }
  const key = `${plan.seed}|${plan.style.id}|${bx},${bz}`;
  const hit = PAVEMENT_CACHE.get(key);
  if (hit) return hit;
  const out: PavementObstacle[] = [];
  // The block's own chunk holds its north and west streets; the next chunks east and south
  // hold the other two.
  for (const [cx, cz] of [[bx, bz], [bx + 1, bz], [bx, bz + 1]]) {
    const rec: number[] = [];
    PAVEMENT.out = rec; BATCH.dry = true;   // placement only: no geometry
    try { cityBatches(plan, cx, cz, null); } finally { PAVEMENT.out = null; BATCH.dry = false; }
    for (let i = 0; i < rec.length; i += 3) out.push({ x: cx * BLOCK + rec[i], z: cz * BLOCK + rec[i + 1], r: rec[i + 2] });
  }
  PAVEMENT_CACHE.set(key, out);
  return out;
}

export function kerbDoors(plan: CityPlan, bx: number, bz: number): (KerbDoor | null)[] {
  if (plan.seed !== kerbDoorsSeed) { KERB_DOORS.clear(); kerbDoorsSeed = plan.seed; }   // one city's doors at a time
  const key = `${plan.seed}|${plan.style.id}|${bx},${bz}`;
  const hit = KERB_DOORS.get(key);
  if (hit) return hit;
  const none: (KerbDoor | null)[] = [null, null, null, null];
  const fac = facilityAt(plan, bx, bz), site = siteLayout(plan, bx, bz);
  if (fac && site.kind === "garage") {
    // On the roof: the stair tower's door, beside the lane where trucks stop.
    const [a, n] = GARAGE_DOOR, [fx, fz] = frontPt(site.side, a, n), [rx, rz] = RIGHT[FRONT_NODE[site.side][2]], out = none.slice();
    out[site.side] = { side: site.side, a, n, x: bx * BLOCK + fx, z: bz * BLOCK + fz, nx: -rx, nz: -rz, frame: 0xf2efe8, panel: 0x23365e, half: DOOR_HALF, h: DOOR_H, plain: false, y: GARAGE_H };
    KERB_DOORS.set(key, out); return out;
  }
  if (!fac || (site.kind !== "kerb" && site.kind !== "stand")) { KERB_DOORS.set(key, none); return none; }
  const spots: number[] = [];
  DOOR_SPOTS.out = spots;
  let built: ReturnType<typeof cityBatches>;
  try { built = cityBatches(plan, bx, bz, null); } finally { DOOR_SPOTS.out = null; }
  const out = none.slice();
  // A facility that loads flatbeds by forklift has wide double service doors.
  const [half, dh] = wideDoor(fac) ? [WIDE_DOOR_HALF, WIDE_DOOR_H] : [DOOR_HALF, DOOR_H];
  const door = (side: number, a: number, n: number): KerbDoor => {
    const [fx, fz] = frontPt(side, a, n), [rx, rz] = RIGHT[FRONT_NODE[side][2]];
    const r = (salt: number) => hash2(bx * 7 + side, bz, plan.seed, salt);
    return { side, a, n, x: bx * BLOCK + fx, z: bz * BLOCK + fz, nx: -rx, nz: -rz,
      frame: [0xf2efe8, 0x2a2b2e, 0x5b4636][Math.floor(r(1) * 3)], panel: [0x7a2b22, 0x23365e, 0x2e5a3a, 0x5b4636, 0xd8d2c4, 0x3a3c40][Math.floor(r(2) * 6)], half, h: dh, plain: false };
  };
  // Doors the builders placed themselves (row houses, park stands): the one nearest the truck's back.
  for (let i = 0; i < spots.length; i += SPOT) {
    const side = spots[i], a = spots[i + 1], cur = out[side];
    if (cur && Math.abs(a - 25) >= Math.abs(cur.a - 25)) continue;
    const dd = out[side] = door(side, a, spots[i + 2]), [, , , h, hf, panel, frame, plain] = spots.slice(i, i + SPOT);
    if (h) dd.h = h;
    if (hf) dd.half = hf;
    if (panel >= 0) dd.panel = panel;
    if (frame >= 0) dd.frame = frame;
    dd.plain = plain > 0;
  }
  // Elsewhere, look for a wall to put one in (a park has none).
  const mesh = site.kind === "kerb" && out.some((d) => !d) ? built.solid.build(DOOR_PROBE_MAT) : null;
  if (mesh) {
    const probe = new LevelProbe(mesh.geometry.getAttribute("position").array, 24), o = new THREE.Vector3(), dir = new THREE.Vector3();
    for (let side = 0; side < 4; side++) {
      if (out[side]) continue;
      const d = FRONT_NODE[side][2], [rx, rz] = RIGHT[d];
      for (let k = 0; k <= 30; k++) {
        let a = 25 + (k % 2 ? -1 : 1) * Math.ceil(k / 2);   // 25, 24, 26, 23, ... out to 10 and 40
        // From the middle of the pavement (n is measured from the block's edge, the back of the
        // pavement), in towards the block: the first wall facing the street at or behind the
        // block's edge (trees, poles and signs on the pavement don't count), not too far back.
        const [px, pz] = frontPt(side, a, -1.8);
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
          const [qx, qz] = frontPt(side, aa, -1.8);
          o.set(qx, 1.0, qz);
          const h2 = probe.first(o, dir);
          return h2 ? -1.8 + h2.distance : 99;
        };
        let w0 = a, w1 = a;
        while (w0 > 9 && Math.abs(at(w0 - 0.25) - n) < 0.05) w0 -= 0.25;
        while (w1 < 51 && Math.abs(at(w1 + 0.25) - n) < 0.05) w1 += 0.25;
        const len = w1 - w0, bays = Math.max(1, Math.round(len / BAY));
        // (A wide service door takes a whole bay, over its window.)
        const wideD = half > DOOR_HALF;
        if (wideD ? len < 2 * half + 0.6 : bays < 2) continue;    // one window, nowhere to put a door
        let best = -1;
        for (let i = wideD ? 0 : 1; i < bays; i++) { const b = w0 + (len * (wideD ? i + 0.5 : i)) / bays; if (best < 0 || Math.abs(b - 25) < Math.abs(best - 25)) best = b; }
        a = best;
        // Room for the door: the wall is there a door's width either side too.
        let wide = true;
        for (const da of [-half - 0.1, half + 0.1]) {
          const [qx, qz] = frontPt(side, a + da, n - 0.4);
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
  KERB_DOORS.set(key, out);
  return out;
}
// A builder's own door for a block side (frontage a, n: the wall's face, and a height when it
// can't take the usual one), for kerbDoors.
const DOOR_SPOTS: { out: number[] | null } = { out: null };
interface SpotLook { h?: number; half?: number; panel?: number; frame?: number; plain?: boolean }
const SPOT = 8;
const doorSpot = (side: number, a: number, n: number, o: SpotLook = {}) => {
  DOOR_SPOTS.out?.push(side, a, n, o.h ?? 0, o.half ?? 0, o.panel ?? -1, o.frame ?? -1, o.plain ? 1 : 0);
};
// A front door on the wall: frame, panel with a window, a step and a light over it. A wide service
// door: two leaves with a window each, a flush sill for the forklift instead of the step.
function entranceDoor(s: Batch, d: KerbDoor) {
  const side = d.side, a = d.a, n = d.n, frame = d.frame, panel = d.panel, H = d.half, DH = d.h, wide = H > DOOR_HALF;
  const y0 = CURB_H;
  fspan(s, side, a - H - 0.1, a + H + 0.1, y0, y0 + DH + 0.12, n - 0.06, n + 0.01, frame);
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
    fspan(s, side, a - H, a + H, y0, y0 + 0.02, n - 0.14, n, 0x9d9a91);                                           // sill
  } else {
    fspan(s, side, a - H + 0.15, a + H - 0.15, y0 + 1.25, y0 + 1.9, n - 0.1, n - 0.09, 0x2a3644);   // window
    fspan(s, side, a - H - 0.25, a + H + 0.25, 0, y0 + 0.03, n - 0.5, n, 0x9d9a91);                 // step (above a garden path's top: shared planes flicker)
  }
  fspan(s, side, a - 0.12, a + 0.12, y0 + DH + 0.3, y0 + DH + 0.45, n - 0.2, n, 0x2a2b2e);                 // light
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
interface Frontage { side: number; drive: [number, number] | null; sign: number | null; clear?: [number, number] }
const BLADE_A = 31.5;
// The block side whose frontage ends at the corner where side i's begins. A dock's bay is near
// that corner, and the side view of a truck working there looks back across it, so that side
// keeps most of its length free of street trees and lights.
const PREV_SIDE = [2, 3, 1, 0];
function streetFrontage(plan: CityPlan, bx: number, bz: number, side: number): Frontage {
  if (!insideCity(bx, bz)) return { side, drive: null, sign: null };   // countryside
  const L = siteLayout(plan, bx, bz);
  if (L.kind === "dock") return { side, drive: L.side === side ? [Math.min(...dockUsedBays(L).map((i) => L.bays[i])) - 4.5, Math.max(...dockUsedBays(L).map((i) => L.bays[i])) + 18] : null, sign: null,
    clear: PREV_SIDE[L.side] === side ? [16, 51] : undefined };
  if (L.kind === "garage") return { side, drive: L.side === side ? GARAGE_DRIVE : null, sign: null };
  if (L.kind === "interchange") return { side, drive: L.side === side ? INTERCHANGE_DRIVE : null, sign: null };
  if (L.kind === "kerb" && hasSign(facilityAt(plan, bx, bz))) return { side, drive: null, sign: BLADE_A };
  if (L.kind === "stand") { const b = standBox(L); return { side, drive: null, sign: BLADE_A, clear: L.side === side ? [b.a0 - 1, b.a1 + 0.5] : undefined }; }
  return { side, drive: null, sign: null };
}
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
function buildStreet(g: Batch, s: Batch, axis: 0 | 1, district: District, rnd: Rand, loF: Frontage, hiF: Frontage) {
  const box = (b: Batch, al: number, y: number, ac: number, lal: number, h: number, lac: number, color: number) =>
    axis === 0 ? b.box(al, y, ac, lal, h, lac, color) : b.box(ac, y, al, lac, h, lal, color);
  const a0 = STREET, a1 = BLOCK, len = a1 - a0, mid = (a0 + a1) / 2, cl = STREET / 2;
  // The frontages in this segment's `along` coordinate.
  const drive = (f: Frontage): [number, number] | null => {
    if (!f.drive) return null;
    const p = frontAlong(f.side, f.drive[0]), q = frontAlong(f.side, f.drive[1]);
    return [Math.max(a0, Math.min(p, q)), Math.min(a1, Math.max(p, q))];
  };
  const loD = drive(loF), hiD = drive(hiF);
  const clear = (f: Frontage): [number, number] | null => {
    if (!f.clear) return null;
    const p = frontAlong(f.side, f.clear[0]), q = frontAlong(f.side, f.clear[1]);
    return [Math.min(p, q), Math.max(p, q)];
  };
  const loC = clear(loF), hiC = clear(hiF);
  const loS = loF.sign !== null ? frontAlong(loF.side, loF.sign) : null, hiS = hiF.sign !== null ? frontAlong(hiF.side, hiF.sign) : null;
  const inDrive = (d: [number, number] | null, p: number, m: number) => !!d && p > d[0] - m && p < d[1] + m;
  // Sidewalks with a pale kerb edge on the road side; a dock driveway drops to road level.
  for (const [lo, hi, edge, d] of [[0, KERB, KERB - 0.25, loD], [STREET - KERB, STREET, STREET - KERB, hiD]] as const) {
    const parts: [number, number][] = d ? [[a0, d[0]], [d[1], a1]] : [[a0, a1]];
    for (const [p0, p1] of parts) {
      if (p1 - p0 < 0.05) continue;
      box(g, (p0 + p1) / 2, CURB_H / 2, (lo + hi) / 2, p1 - p0, CURB_H, hi - lo, C.sidewalk);
      box(g, (p0 + p1) / 2, CURB_H + 0.004, edge + 0.125, p1 - p0, 0.008, 0.25, C.curb);
    }
    if (d) box(g, (d[0] + d[1]) / 2, 0.015, (lo + hi) / 2, d[1] - d[0], 0.03, hi - lo, 0x8f8b80);
  }
  // Markings. Forward (+along) traffic keeps right: on an east-west street that is the +z half,
  // on a north-south street (heading +z, right hand is -x) the low-x half.
  const fwdLo = axis === 0 ? cl : KERB, fwdHi = axis === 0 ? STREET - KERB : cl;
  const backLo = axis === 0 ? KERB : cl, backHi = axis === 0 ? cl : STREET - KERB;
  const M = 0.012, MH = 0.02;
  box(g, mid, M, cl - 0.15, len - 8, MH, 0.12, C.yellow);
  box(g, mid, M, cl + 0.15, len - 8, MH, 0.12, C.yellow);
  for (const lane of [cl - 3, cl + 3])
    for (let p = a0 + 6; p + 3 <= a1 - 6; p += 9) box(g, p + 1.5, M, lane, 3, MH, 0.12, C.white);
  // Stop lines (forward traffic stops before the next intersection at a1, backward before a0),
  // then continental crosswalks at both ends.
  // (Short of the yellow centre lines: overlapping markings flicker.)
  box(g, a1 - 3.9, M, (fwdLo + fwdHi) / 2, 0.4, MH, fwdHi - fwdLo - 0.5, C.white);
  box(g, a0 + 3.9, M, (backLo + backHi) / 2, 0.4, MH, backHi - backLo - 0.5, C.white);
  for (const c0 of [a0 + 0.3, a1 - 3.3])
    for (let ac = KERB + 0.6; ac < STREET - KERB - 0.4; ac += 1.0) box(g, c0 + 1.4, M, ac, 2.8, MH, 0.5, C.white);
  // Streetlights on both sidewalks, staggered; street trees where the district has them.
  for (const [side, at, d, c] of [[KERB - 0.6, a0 + 10, loD, loC], [STREET - KERB + 0.6, a0 + 31, hiD, hiC]] as const) {
    if (inDrive(d, at, 2) || inDrive(c, at, 0)) continue;
    const dir = side < cl ? 1 : -1; // arm reaches over the road
    const [px, pz] = axis === 0 ? [at, side] : [side, at];
    s.cyl(px, 3.75, pz, 0.1, 7.5, C.pole, 6); pavementObstacle(px, pz, 0.15);
    const [hx, hz] = axis === 0 ? [px, side + dir * 1.6] : [side + dir * 1.6, pz];
    s.span(Math.min(px, hx) - 0.06, 7.35, Math.min(pz, hz) - 0.06, Math.max(px, hx) + 0.06, 7.47, Math.max(pz, hz) + 0.06, C.pole);
    s.aux.set(0, 0, -2); s.box(hx, 7.3, hz, axis === 0 ? 0.35 : 0.7, 0.16, axis === 0 ? 0.7 : 0.35, C.lampHead); s.aux.set(0, 0, -1);
    DC.lampSites.push(hx, 7.2, hz);
  }
  // What the furniture must keep clear of, per sidewalk.
  const busy: [number[][], number[][]] = [[], []];
  for (const [i, at, d] of [[0, a0 + 10, loD], [1, a0 + 31, hiD]] as const) if (!inDrive(d, at, 2)) busy[i].push([at - 0.6, at + 0.6]);
  for (const [i, d, sg] of [[0, loD, loS], [1, hiD, hiS]] as const) {
    if (d) busy[i].push([d[0] - 1, d[1] + 1]);
    if (sg !== null) busy[i].push([sg - 1.4, sg + 1.4]);
  }
  // Under an elevated line (on an east-west street: elevatedLine), its bents: about every 17 m, at
  // the first spot near each where neither sidewalk has a driveway, streetlight or sign in the way
  // (a dock's side view is kept clear too, unless there is nowhere else). No street trees here.
  const el = axis === 0 && elevatedLine(CS, DC.cz), fw = DC.plan.freewayStreet(axis, DC.cx, DC.cz);
  if (el || fw) {
    const icClear = fw ? DC.plan.interchangeStreet(axis, DC.cx, DC.cz)?.clear ?? null : null;
    const ok = (p: number, soft: boolean) => !(icClear && p > icClear[0] - 1.5 && p < icClear[1] + 1.5) && !inDrive(loD, p, 1.5) && !inDrive(hiD, p, 1.5) && Math.abs(p - (a0 + 10)) > 1.5 && Math.abs(p - (a0 + 31)) > 1.5
      && (loS === null || Math.abs(p - loS) > 2) && (hiS === null || Math.abs(p - hiS) > 2) && (!soft || (!inDrive(loC, p, 0.5) && !inDrive(hiC, p, 0.5)));
    let last = -Infinity;
    for (const base of fw ? [26, 50] : [22, 39, 56]) {
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
  if (district !== "industrial" && !el && !fw) {
    const step = district === "downtown" ? 12 : 9;
    for (const side of [1.6, STREET - 1.6]) {
      const d = side < cl ? loD : hiD, sg = side < cl ? loS : hiS, cz = side < cl ? loC : hiC;
      for (let p = a0 + 6.5 + (side > cl ? 4 : 0); p < a1 - 5; p += step) {
        if (Math.abs(p - (a0 + 10)) < 2.5 || Math.abs(p - (a0 + 31)) < 2.5) continue; // clear of lights
        if (inDrive(d, p, 2) || inDrive(cz, p, 0) || (sg !== null && Math.abs(p - sg) < 3.4)) continue;   // driveways, signs, dock corners
        const [tx, tz] = axis === 0 ? [p, side] : [side, p];
        g.box(tx, CURB_H + 0.01, tz, 1.4, 0.02, 1.4, 0x5a4a38); // tree pit
        busy[side < cl ? 0 : 1].push([p - 1.0, p + 1.0]);
        cityTree(s, tx, CURB_H, tz, range(rnd, 6.5, 8), range(rnd, 1.5, 2.0), pick(rnd, CS.trees.greens), rnd);
      }
    }
  }
  streetFurniture(s, g, district, KERB, -1, axis, busy[0], rnd);
  streetFurniture(s, g, district, STREET - KERB, 1, axis, busy[1], rnd);
}

// Sidewalk corners at the intersection's four corners.
function buildCorners(g: Batch) {
  for (const x of [0, STREET - KERB])
    for (const z of [0, STREET - KERB]) g.box(x + KERB / 2, CURB_H / 2, z + KERB / 2, KERB, CURB_H, KERB, C.sidewalk);
}

// Where a node's street doesn't exist (the edge of town), the sidewalk runs on across its mouth.
const ARM_ALL = (ix: number, iz: number, d: number) => cityStreet(ix, iz, d) || !!gateAt(ix, iz, d) || !!gateAt(ix + [1, 0, -1, 0][d], iz + [0, -1, 0, 1][d], (d + 2) % 4);
function buildMouths(g: Batch, ix: number, iz: number) {
  if (!nodeInCity(ix, iz)) return;
  const span = STREET - 2 * KERB, mid = STREET / 2;
  const mouths: [number, number, number, number, number][] = [   // dir, x, z, size x, size z
    [0, STREET - KERB / 2, mid, KERB, span], [2, KERB / 2, mid, KERB, span], [1, mid, KERB / 2, span, KERB], [3, mid, STREET - KERB / 2, span, KERB]];
  for (const [d, x, z, w, l] of mouths) {
    if (ARM_ALL(ix, iz, d)) continue;
    g.box(x, CURB_H / 2, z, w, CURB_H, l, C.sidewalk);
    const ex = d === 0 ? STREET - KERB + 0.125 : d === 2 ? KERB - 0.125 : x, ez = d === 1 ? KERB - 0.125 : d === 3 ? STREET - KERB + 0.125 : z;
    g.box(ex, CURB_H + 0.004, ez, d % 2 === 0 ? 0.25 : span, 0.008, d % 2 === 0 ? span : 0.25, C.curb);
  }
}

// ---- the countryside round the city -------------------------------------------------------------
// Chunks outside the city's limits, out to RING blocks: the city's outermost streets and its gate
// streets where they run, and the rest farmland or wild land of the city's biome (countryworld.ts
// looks). The highway's corridor out of each gate stays clear: the country road is drawn there.
function inGateCorridor(wx: number, wz: number, margin = 13) {
  for (const g of GATES) {
    const e = gateEnd(g), fx = Math.cos(e.h), fz = -Math.sin(e.h);
    const along = (wx - e.x) * fx + (wz - e.z) * fz, across = Math.abs((wx - e.x) * -fz + (wz - e.z) * fx);
    if (along > -2 && along < (RING + 1) * BLOCK && across < margin) return true;
  }
  return false;
}
const PLAIN_FRONT = (side: number): Frontage => ({ side, drive: null, sign: null });
function buildOutskirts(ground: Batch, solid: Batch, lamps: Batch, plan: CityPlan, cx: number, cz: number, rnd: Rand) {
  const ew = ARM_ALL(cx, cz, 0), ns = ARM_ALL(cx, cz, 3), node = nodeInCity(cx, cz);
  const front = (bx: number, bz: number, side: number) => insideCity(bx, bz) ? streetFrontage(plan, bx, bz, side) : PLAIN_FRONT(side);
  if (node) { ground.box(STREET / 2, -0.05, STREET / 2, STREET, 0.1, STREET, C.asphalt); buildCorners(ground); buildMouths(ground, cx, cz); buildSignals(solid, lamps, STREET, KERB, signalOffset(cx, cz, plan.seed)); }
  if (ew) { ground.box((STREET + BLOCK) / 2, -0.05, STREET / 2, BLOCK - STREET, 0.1, STREET, C.asphalt); buildStreet(ground, solid, 0, "residential", rnd, front(cx, cz - 1, 1), front(cx, cz, 0)); }
  if (ns) { ground.box(STREET / 2, -0.05, (STREET + BLOCK) / 2, STREET, 0.1, BLOCK - STREET, C.asphalt); buildStreet(ground, solid, 1, "residential", rnd, front(cx - 1, cz, 3), front(cx, cz, 2)); }
  if (cityDistance(cx, cz) > RING) return;
  const rects: Rect[] = [{ x0: STREET, z0: STREET, x1: BLOCK, z1: BLOCK }];
  if (!ew) rects.push({ x0: STREET, z0: 0, x1: BLOCK, z1: STREET });
  if (!ns) rects.push({ x0: 0, z0: STREET, x1: STREET, z1: BLOCK });
  if (!node) rects.push({ x0: 0, z0: 0, x1: STREET, z1: STREET });
  const c = plan.climate, id = BIOME_OF[plan.style.id], b = BIOMES[id];
  const g0 = c ? seasonGround(b.ground, c) : b.ground, g1 = c ? seasonGround(b.ground2, c) : b.ground2;
  const fields = b.fields?.map((f) => c ? seasonGround(f, c) : f);
  const greens = c ? seasonGreens(b.greens, c) : b.greens, cgreens = c ? seasonGreens(b.greens, c, true) : b.greens;
  const ox = cx * BLOCK, oz = cz * BLOCK, line = elevatedLine(CS, cz);
  for (const r of rects) {
    // Ground in 12 m cells: fields in farm country, patchy grass elsewhere. A few cm below the
    // country road's land (countryworld.ts), which overlaps this ring where they meet: at the
    // same height the two flickered against each other.
    for (let x = r.x0; x < r.x1 - 0.01; x += 12) for (let z = r.z0; z < r.z1 - 0.01; z += 12) {
      const w = Math.min(12, r.x1 - x), d = Math.min(12, r.z1 - z), wx = ox + x + w / 2, wz = oz + z + d / 2;
      const col = fields ? fields[Math.floor(hash2(Math.floor(wx / 48), Math.floor(wz / 36), plan.seed, 0xf1e) * fields.length)]
        : hash2(Math.floor(wx / 36), Math.floor(wz / 36), plan.seed, 0x6a) < 0.6 ? g0 : g1;
      ground.box(x + w / 2, -0.16, z + d / 2, w, 0.1, d, col);
    }
    // Trees and rocks, clear of the highway out of town and of the streets' edges.
    const area = (r.x1 - r.x0) * (r.z1 - r.z0), n = Math.floor(b.density * 0.0024 * area + rnd());
    for (let k = 0; k < n; k++) {
      const x = r.x0 + 2 + rnd() * (r.x1 - r.x0 - 4), z = r.z0 + 2 + rnd() * (r.z1 - r.z0 - 4);
      if (inGateCorridor(ox + x, oz + z) || (line && Math.abs(z - 9) < 7) || plan.freewayFrame?.corridor(ox + x, oz + z)) continue;   // (nor under an elevated line, nor the freeway)
      const kind = b.trees[Math.floor(rnd() * b.trees.length)], gs = kind === "conifer" || kind === "cypress" || kind === "cactus" ? cgreens : greens;
      landTree(solid, x, z, kind, gs[Math.floor(rnd() * gs.length)], rnd);
    }
    if (rnd() < b.rocks) { const x = r.x0 + rnd() * (r.x1 - r.x0), z = r.z0 + rnd() * (r.z1 - r.z0); if (!inGateCorridor(ox + x, oz + z) && !(line && Math.abs(z - 9) < 7) && !plan.freewayFrame?.corridor(ox + x, oz + z)) { const rr = 0.5 + rnd() * 1.4; solid.ico(x, rr * 0.3, z, rr, 0x8a8478, 0.6, rnd() * 6); } }
  }
}

// ---- shared pieces --------------------------------------------------------------------------
function tree(s: Batch, x: number, y: number, z: number, h: number, r: number, color: number) {
  if (BARE.includes(color)) { bareTree(s, x, y, z, h, x * 1.7 + z); return; }
  s.cyl(x, y + h * 0.3, z, 0.16, h * 0.6, C.trunk, 5);
  s.ico(x, y + h * 0.68, z, r, color, 0.9, x * 1.7);
  s.ico(x + r * 0.35, y + h * 0.82, z - r * 0.25, r * 0.6, shade(color, 1.18), 0.9, z);
}
// A tree of the city's kind: broadleaf, conifer or palm.
export function cityTree(s: Batch, x: number, y: number, z: number, h: number, r: number, color: number, rnd: Rand) {
  const kind = pick(rnd, CS.trees.kinds);
  pavementObstacle(x, z, 0.45);   // the trunk (and a street tree's pit), for the driver's walks
  if (kind === "palm") palm(s, x, y, z, h * 1.25, rnd);
  else if (kind === "conifer") conifer(s, x, y, z, h, BARE.includes(color) ? 0x2c4a34 : shade(color, 0.8), BARE.includes(color));
  else tree(s, x, y, z, h, r, color);
}
// Palm: a gently leaning ringed trunk and a crown of drooping fronds.
function palm(s: Batch, x: number, y: number, z: number, h: number, rnd: Rand) {
  const lean = range(rnd, 0.04, 0.1), dir = rnd() * Math.PI * 2, lx = Math.cos(dir), lz = Math.sin(dir);
  const seg = 5;
  for (let k = 0; k < seg; k++) {
    const f = (k + 0.5) / seg, off = lean * h * f * f;
    s.cyl(x + lx * off, y + h * f, z + lz * off, 0.19 - 0.05 * f + (k % 2) * 0.02, h / seg + 0.02, k % 2 ? 0x8a6a48 : 0x7a5c3e, 6);   // (alternate rings fatter: overlapping segments of near-equal radius flicker)
  }
  const tx = x + lx * lean * h, tz = z + lz * lean * h, ty = y + h;
  const green = pick(rnd, [0x3f8a32, 0x4a9a3a, 0x357a2c]);
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2 + rnd() * 0.4;
    s.boxR(tx + Math.cos(a) * 1.1, ty - 0.25, tz + Math.sin(a) * 1.1, 2.4, 0.08, 0.55, green, 0, -a, -0.5);
  }
  s.ico(tx, ty, tz, 0.35, 0x5a4a30);
}
function conifer(s: Batch, x: number, y: number, z: number, h: number, color: number, snow = false) {
  pavementObstacle(x, z, 0.6);
  s.cyl(x, y + 0.5, z, 0.14, 1, C.trunk, 5);
  s.cone(x, y + 0.8 + h * 0.4, z, h * 0.28, h * 0.8, color, 7);
  if (snow) s.cone(x, y + 0.8 + h * 0.62, z, h * 0.15, h * 0.36, SNOW, 7);
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
  if (rnd() < CS.waterTanks && r.x1 - r.x0 > 7 && r.z1 - r.z0 > 7) {   // a wooden water tank on legs
    const ux = r.x0 + 2.4, uz = r.z1 - 2.4;
    s.cyl(ux, top + 3.2, uz, 1.3, 2.4, 0x7a5236, 10); s.cone(ux, top + 4.9, uz, 1.4, 1.0, 0x4a3424, 10);
    for (const [lx, lz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) s.box(ux + lx, top + 1, uz + lz, 0.14, 2, 0.14, C.dark);
  }
  const p = 0.3, ph = 0.6, pc = shade(wall, 0.82), po = inset(r, 0.02);
  s.span(po.x0, top, po.z0, po.x1, top + ph, r.z0 + p, pc);
  s.span(po.x0, top, r.z1 - p, po.x1, top + ph, po.z1, pc);
  s.span(po.x0, top, po.z0, r.x0 + p, top + ph, po.z1, pc);
  s.span(r.x1 - p, top, po.z0, po.x1, top + ph, po.z1, pc);
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  for (let i = 0; i < clutter; i++) {
    if (w < 5 || d < 5) break;
    const ux = range(rnd, r.x0 + 1.5, r.x1 - 1.5), uz = range(rnd, r.z0 + 1.5, r.z1 - 1.5);
    const k = rnd();
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
  g.span(B.x0, 0, B.z0, B.x1, CURB_H, B.z1, CS.pavers);
  const lots = splitLots(B, rnd() < 0.35 ? 1 : rnd() < 0.6 ? 2 : 4, rnd);
  let tallest = 0, tallestAt: [number, number] = [0, 0], marqueeDone = false, plazaDone = false;
  for (const lot of lots) {
    // A plaza takes one corner lot at most: a whole block side without a building has no front
    // door for a delivery (kerbDoors).
    if (lots.length > 1 && rnd() < 0.12 && lots.length === 4 && !plazaDone) { plaza(g, s, lot, rnd); plazaDone = true; continue; }
    const r = inset(lot, 0.4);
    const wall = pick(rnd, CS.walls.downtown);
    const podFloors = irange(rnd, 2, 4);
    const groundTile = rnd() < 0.5 ? FACADE.LOBBY : FACADE.STOREFRONT;
    const podTop = facadeBox(s, r.x0, r.z0, r.x1, r.z1, CURB_H,
      [{ tile: groundTile, floors: 1, floorH: 5 }, { tile: pick(rnd, [FACADE.PUNCHED, FACADE.BRICK, FACADE.DECO]), floors: podFloors - 1, floorH: 3.6 }], wall);
    const front = streetSide(r, B, 3);
    if (front >= 0 && !marqueeDone && wantsMarquee()) { marqueeCanopy(s, r, front); marqueeDone = true; }
    else if (front >= 0 && rnd() < CS.neon * 0.5) shopNeon(s, r, front, rnd);
    const tw = inset(r, range(rnd, 2.2, 4.5));
    const floors = Math.round((5 + hs * range(rnd, 5, 14)) * CS.towerScale);
    if (tw.x1 - tw.x0 < 6 || tw.z1 - tw.z0 < 6 || floors < 6) { flatRoof(s, r, podTop, wall, rnd, 3); continue; }
    { const ci = inset(r, 0.04); s.span(ci.x0, podTop - 0.05, ci.z0, ci.x1, podTop + 0.05, ci.z1, C.roofLight); }   // inside the walls (see flatRoof)
    const towerWall = rnd() < 0.5 ? wall : pick(rnd, CS.walls.downtown);
    const tile = pick(rnd, CS.towerTiles);
    let top = facadeBox(s, tw.x0, tw.z0, tw.x1, tw.z1, podTop, [{ tile, floors, floorH: 3.6 }], towerWall);
    let roofRect = tw;
    if (rnd() < 0.35 && tw.x1 - tw.x0 > 12) { // setback crown
      const cr = inset(tw, 2.5);
      { const ci = inset(tw, 0.04); s.span(ci.x0, top - 0.05, ci.z0, ci.x1, top + 0.05, ci.z1, C.roofLight); }
      top = facadeBox(s, cr.x0, cr.z0, cr.x1, cr.z1, top, [{ tile, floors: irange(rnd, 2, 4), floorH: 3.6 }], towerWall);
      roofRect = cr;
    }
    flatRoof(s, roofRect, top, towerWall, rnd, 2);
    if (top > tallest) { tallest = top; tallestAt = [(roofRect.x0 + roofRect.x1) / 2, (roofRect.z0 + roofRect.z1) / 2]; }
  }
  if (tallest > 45) { // antenna with a red tip on the block's tallest tower
    s.cyl(tallestAt[0], tallest + 4, tallestAt[1], 0.12, 8, C.metal, 5);
    s.box(tallestAt[0], tallest + 8.1, tallestAt[1], 0.35, 0.35, 0.35, 0xff2a1a);
  }
}

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
  return out;
}

function buildCommercial(g: Batch, s: Batch, B: Rect, rnd: Rand) {
  g.span(B.x0, 0, B.z0, B.x1, CURB_H, B.z1, CS.pavers);
  const nx = irange(rnd, 2, 3), nz = irange(rnd, 2, 3);
  for (const { r, edge } of gridLots(B, nx, nz)) {
    if (!edge) { parkingLot(g, s, r, rnd); continue; }
    const floors = Math.min(CS.maxShopFloors, Math.max(CS.id === "mainstreet" ? 2 : 1, 1 + Math.floor(rnd() * rnd() * 5)));
    const wall = pick(rnd, CS.walls.commercial);
    const b = inset(r, 0.15);
    const bands: FacadeBand[] = [{ tile: FACADE.STOREFRONT, floors: 1, floorH: 4.2 }];
    if (floors > 1) bands.push({ tile: pick(rnd, CS.upperTiles), floors: floors - 1, floorH: 3.4 });
    const top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, CURB_H, bands, wall);
    flatRoof(s, b, top, wall, rnd, floors > 2 ? 2 : 1);
    // Awning over the storefront on the street side.
    const side = streetSide(b, B, 1);
    if (side >= 0 && rnd() < 0.7) awning(s, b, side, pick(rnd, CS.awnings));
    if (side >= 0 && rnd() < CS.neon) shopNeon(s, b, side, rnd);
    if (side >= 0 && CS.fireEscapes && floors >= 3 && rnd() < 0.5) fireEscape(s, b, side, floors, 4.2, 3.4, rnd);
  }
}

function awning(s: Batch, b: Rect, side: number, color: number) {
  const y = CURB_H + 3.3, dep = 1.3, t = 0.12;
  if (side === 0) s.span(b.x0 + 0.6, y, b.z1, b.x1 - 0.6, y + t, b.z1 + dep, color);
  else if (side === 1) s.span(b.x1, y, b.z0 + 0.6, b.x1 + dep, y + t, b.z1 - 0.6, color);
  else if (side === 2) s.span(b.x0 + 0.6, y, b.z0 - dep, b.x1 - 0.6, y + t, b.z0, color);
  else s.span(b.x0 - dep, y, b.z0 + 0.6, b.x0, y + t, b.z1 - 0.6, color);
}

function parkingLot(g: Batch, s: Batch, r: Rect, rnd: Rand) {
  g.span(r.x0, CURB_H, r.z0, r.x1, CURB_H + 0.01, r.z1, C.asphalt);
  for (let x = r.x0 + 1; x < r.x1 - 1; x += 2.6) g.box(x, CURB_H + 0.02, (r.z0 + r.z1) / 2, 0.1, 0.01, (r.z1 - r.z0) * 0.7, C.white);
  for (let i = 0; i < 4; i++) // a few parked cars, as simple blocks until phase 9 brings real ones
    if (rnd() < 0.6) {
      const x = r.x0 + 2.3 + i * 2.6 * 1.5, z = (r.z0 + r.z1) / 2 + (rnd() < 0.5 ? -2 : 2);
      if (x > r.x1 - 1.5) break;
      const col = pick(rnd, [0xb22222, 0x1f4fa0, 0xe8e8e8, 0x222428, 0x7a7f86, 0xd4a017]);
      s.box(x, CURB_H + 0.55, z, 1.8, 0.8, 4.2, col);
      s.box(x, CURB_H + 1.2, z + 0.2, 1.6, 0.55, 2.2, 0x2a3440);
    }
}

function buildResidential(g: Batch, s: Batch, B: Rect, rnd: Rand) {
  g.span(B.x0, 0, B.z0, B.x1, CURB_H, B.z1, CS.grass);
  if (rnd() < 0.25) { // apartment courts
    for (const { r, edge } of gridLots(B, 2, 2)) {
      void edge;
      const b = inset(r, 2.2);
      const wall = pick(rnd, CS.walls.residential.concat(CS.walls.commercial.slice(0, 3)));
      const floors = irange(rnd, 3, 5);
      const side = streetSide(b, B, 4);
      const top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, CURB_H,
        [{ tile: FACADE.PUNCHED, floors: 1, floorH: 3.4 }, { tile: pick(rnd, [FACADE.APARTMENT, FACADE.BRICK, FACADE.RESIDENTIAL]), floors: floors - 1, floorH: 3.2 }],
        wall, side, FACADE.DOOR);
      flatRoof(s, b, top, wall, rnd, 2);
      cityTree(s, (r.x0 + r.x1) / 2 + range(rnd, -6, 6), CURB_H, side % 2 ? (r.z0 + r.z1) / 2 : (side === 0 ? r.z1 - 1.2 : r.z0 + 1.2), range(rnd, 5, 7), 1.6, pick(rnd, CS.trees.greens), rnd);
    }
    return;
  }
  if (CS.houses === "row") { buildRowHouses(g, s, rnd); return; }
  // Houses on a 4x4 lot grid; the middle four cells are back gardens.
  const lots = gridLots(B, 4, 4);
  for (const { r, edge } of lots) {
    if (!edge) {
      if (rnd() < 0.6) cityTree(s, range(rnd, r.x0 + 2, r.x1 - 2), CURB_H, range(rnd, r.z0 + 2, r.z1 - 2), range(rnd, 5, 8), range(rnd, 1.5, 2.3), pick(rnd, CS.trees.greens), rnd);
      else if (rnd() < 0.3) g.span(r.x0 + 3, CURB_H, r.z0 + 3, r.x1 - 3, CURB_H + 0.03, r.z1 - 4, 0x3aa0d0); // pool
      else s.box((r.x0 + r.x1) / 2, CURB_H + 1.1, (r.z0 + r.z1) / 2, 2.4, 2.2, 2.0, pick(rnd, CS.walls.residential)); // shed
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
    const top = facadeBox(s, h.x0, h.z0, h.x1, h.z1, CURB_H, [{ tile: bungalow ? FACADE.PUNCHED : FACADE.SIDING, floors, floorH: 3.0 }], wall, front, FACADE.DOOR);
    if (bungalow) {
      // Flat-roofed stucco with a parapet, a gravel yard and a palm or two.
      flatRoof(s, h, top, wall, rnd, 1);
      if (rnd() < 0.6) g.span(h.x0 - 1, CURB_H, h.z0 - 1, h.x1 + 1, CURB_H + 0.015, h.z1 + 1, 0xc8b08a);
    } else {
    // Gable roof with the ridge parallel to the street.
    const ridgeX = front % 2 === 0;
    const rw = (ridgeX ? h.x1 - h.x0 : h.z1 - h.z0) + 0.5, rd = (ridgeX ? h.z1 - h.z0 : h.x1 - h.x0) + 0.8;
    const rh = rd * 0.36;
    s.prism((h.x0 + h.x1) / 2, top + rh / 2, (h.z0 + h.z1) / 2, rw, rh, rd, pick(rnd, CS.gables), ridgeX ? 0 : Math.PI / 2);
    if (rnd() < 0.5) { // chimney
      const chx = ridgeX ? h.x0 + 1.2 : (h.x0 + h.x1) / 2, chz = ridgeX ? (h.z0 + h.z1) / 2 : h.z0 + 1.2;
      s.box(chx, top + rh * 0.9, chz, 0.7, rh * 1.2, 0.7, 0x8a4a3a);
    }
    }
    // Front path and a yard tree.
    const fx = (h.x0 + h.x1) / 2, fz = (h.z0 + h.z1) / 2;
    if (front === 0) g.span(fx - 0.6, CURB_H, h.z1, fx + 0.6, CURB_H + 0.02, r.z1, C.path);
    else if (front === 2) g.span(fx - 0.6, CURB_H, r.z0, fx + 0.6, CURB_H + 0.02, h.z0, C.path);
    else if (front === 1) g.span(h.x1, CURB_H, fz - 0.6, r.x1, CURB_H + 0.02, fz + 0.6, C.path);
    else g.span(r.x0, CURB_H, fz - 0.6, h.x0, CURB_H + 0.02, fz + 0.6, C.path);
    if (rnd() < 0.45) {
      const tz = front % 2 ? (rnd() < 0.5 ? r.z0 + 1.3 : r.z1 - 1.3) : fz, tx = front % 2 ? fx : (rnd() < 0.5 ? r.x0 + 1.3 : r.x1 - 1.3);
      (rnd() < 0.3 ? conifer(s, tx, CURB_H, tz, range(rnd, 5, 7), 0x1f5a34) : cityTree(s, tx, CURB_H, tz, range(rnd, 4.5, 6), range(rnd, 1.2, 1.7), pick(rnd, CS.trees.greens), rnd));
    }
  }
}

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
    const stoops: number[] = [];
    let doorAt = -1, doorD = Infinity;
    while (hi - a > 4.2) {
      const w = Math.min(hi - a, hi - a < 9 ? hi - a : range(rnd, 4.8, 6.4));
      const r = frontRect(side, a, a + w, n0, n1);
      const wall = pick(rnd, CS.walls.residential);
      const floors = victorian ? irange(rnd, 2, 3) : irange(rnd, 3, 4);
      const tile = victorian ? FACADE.SIDING : pick(rnd, [FACADE.BRICK, FACADE.RESIDENTIAL, FACADE.APARTMENT]);
      const top = facadeBox(s, r.x0, r.z0, r.x1, r.z1, CURB_H, [{ tile, floors, floorH: 3.1 }], wall, FACE_OF[side], FACADE.DOOR);
      // The painted door's bay (facadeBox: the middle bay of the street wall, in its corner order).
      { const da = doorBayA(side, a, w); if (Math.abs(da - 25) < doorD) { doorD = Math.abs(da - 25); doorAt = da; } }
      if (victorian) {
        // Gable to the street, and a bay window on the upper floor.
        const d = FRONT_NODE[side][2], ridgeAlongX = RIGHT[d][0] !== 0;
        // (Neighbours' gables overlap; alternate lengths keep their end faces off one plane.)
        s.prism((r.x0 + r.x1) / 2, top + w * 0.27, (r.z0 + r.z1) / 2, depth + 0.4 + (alt++ & 1) * 0.04, w * 0.54, w + 0.25, pick(rnd, CS.gables), ridgeAlongX ? 0 : Math.PI / 2);
        fspan(s, side, a + w * 0.25, a + w * 0.75, CURB_H + 3.3, CURB_H + 3.1 * floors - 0.3, n0 - 0.7, n0, shade(wall, 1.06));
        fspan(s, side, a + w * 0.2, a + w * 0.8, CURB_H + 3.1 * floors - 0.3, CURB_H + 3.1 * floors - 0.1, n0 - 0.8, n0, 0xf2f2ea);
      } else {
        flatRoof(s, r, top, wall, rnd, 0);
        fspan(s, side, a, a + w, top - 0.35, top + 0.1, n0 - 0.35, n0, shade(wall, 0.7));   // cornice
        stoops.push(a + w / 2);
      }
      a += w;
    }
    // The stoops, but not at the house whose door the driver uses (its own step: entranceDoor).
    for (const sa of stoops) if (doorAt < 0 || Math.abs(sa - doorAt) > 2.6) fspan(s, side, sa - 0.9, sa + 0.9, CURB_H, CURB_H + 0.9, n0 - 1.6, n0, 0x8a8278);
    if (doorAt >= 0) doorSpot(side, doorAt, n0);
  }
  // Back gardens.
  for (let i = 0; i < 4; i++) {
    const [x, z] = frontPt(0, range(rnd, 22, 38), range(rnd, 13, 29));
    if (rnd() < 0.7) cityTree(s, x, CURB_H, z, range(rnd, 5, 7), range(rnd, 1.4, 2), pick(rnd, CS.trees.greens), rnd);
  }
}

// `stand`: a service bay's container at the kerb (buildStand); no yard faces it.
function buildIndustrial(g: Batch, s: Batch, B: Rect, rnd: Rand, stand: StandLayout | null = null) {
  g.span(B.x0, 0, B.z0, B.x1, CURB_H, B.z1, C.concrete);
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
    if (r.x1 - r.x0 < 8 || r.z1 - r.z0 < 8) continue;
    const wall = pick(rnd, CS.walls.industrial);
    const tiles = [0, 1, 2, 3].map((k) => (k === yardSide ? FACADE.DOCK : FACADE.INDUSTRIAL));
    const height = range(rnd, 9, 12);
    const top = facadeBox(s, r.x0, r.z0, r.x1, r.z1, CURB_H,
      [{ tile: tiles, floors: 1, floorH: 5 }, { tile: FACADE.INDUSTRIAL, floors: 1, floorH: height - 5 }], wall);
    flatRoof(s, r, top, wall, rnd, 0);
    const street = streetSide(r, lot, 6);
    if (street >= 0 && street !== yardSide && rnd() < CS.ghostSigns) ghostSign(r, street, CURB_H + 5 + (height - 5) / 2, rnd);
    // Roof vents in a row.
    const vx = (r.x0 + r.x1) / 2;
    for (let z = r.z0 + 3; z < r.z1 - 2; z += 6) s.cyl(vx, top + 0.6, z, 0.5, 1.2, C.metal, 6);
    // Yard: dock apron stripes, parked trailers, sometimes a tank or stack.
    const yd = (lot: Rect): Rect => yardSide === 0 ? { ...lot, z0: r.z1 } : yardSide === 1 ? { ...lot, x0: r.x1 } : yardSide === 2 ? { ...lot, z1: r.z0 } : { ...lot, x1: r.x0 };
    const Y = yd(inset(lot, 0.5));
    g.span(Y.x0, CURB_H, Y.z0, Y.x1, CURB_H + 0.01, Y.z1, 0x5c5c58);
    const along = yardSide % 2 === 0; // dock wall runs along x
    // A port yard holds containers under a gantry crane; an old brick one has a rail spur.
    let special = CS.cranes && rnd() < 0.45 ? "crane" : CS.rail && rnd() < 0.45 ? "rail" : "";
    if (stand) special = "";   // a yard can reach the kerb at the block's corners
    if (special === "crane") portCrane(s, Y, along, rnd);
    else if (special === "rail") railSpur(g, s, Y, along, rnd);
    const n = special ? 0 : Math.floor(((along ? r.x1 - r.x0 : r.z1 - r.z0) - 2) / 4.5);
    for (let i = 0; i < n; i++) {
      if (rnd() > 0.45) continue;
      const p = (along ? r.x0 : r.z0) + 2.5 + i * 4.5;
      const L = 12, col = pick(rnd, [0xeeeeea, 0xeeeeea, 0xb03a2e, 0x2d5f9a, 0x8a8f94]);
      if (yardSide === 0) s.span(p - 1.25, CURB_H + 1.1, r.z1 + 0.3, p + 1.25, CURB_H + 4.0, r.z1 + 0.3 + Math.min(L, Y.z1 - r.z1 - 0.5), col);
      else if (yardSide === 2) s.span(p - 1.25, CURB_H + 1.1, r.z0 - 0.3 - Math.min(L, r.z0 - Y.z0 - 0.5), p + 1.25, CURB_H + 4.0, r.z0 - 0.3, col);
      else if (yardSide === 1) s.span(r.x1 + 0.3, CURB_H + 1.1, p - 1.25, r.x1 + 0.3 + Math.min(L, Y.x1 - r.x1 - 0.5), CURB_H + 4.0, p + 1.25, col);
      else s.span(r.x0 - 0.3 - Math.min(L, r.x0 - Y.x0 - 0.5), CURB_H + 1.1, p - 1.25, r.x0 - 0.3, CURB_H + 4.0, p + 1.25, col);
    }
    if (rnd() < 0.35) { // storage tanks at a far corner
      const tx = r.x0 + 3, tz = r.z0 + 3;
      for (let k = 0; k < 2; k++) s.cyl(tx + k * 5, top + 2.5, tz, 2, 5, 0xd8d8d0, 10);
    } else if (rnd() < 0.3) {
      s.cyl(r.x1 - 2.5, top + 6, r.z1 - 2.5, 0.9, 12, 0x8a4a3a, 8); // brick stack
      s.cyl(r.x1 - 2.5, top + 11.5, r.z1 - 2.5, 0.95, 0.6, 0xf2f2ea, 8);
    }
    // Small office annex with a ribbon window at one end of the street side.
    if (rnd() < 0.6) {
      const side = streetSide(r, lot, 4);
      const o: Rect = side === 2 ? { x0: r.x0 + 1, x1: r.x0 + 9, z0: r.z0 - 4.5, z1: r.z0 }
        : side === 0 ? { x0: r.x0 + 1, x1: r.x0 + 9, z0: r.z1, z1: r.z1 + 4.5 }
        : side === 3 ? { z0: r.z0 + 1, z1: r.z0 + 9, x0: r.x0 - 4.5, x1: r.x0 }
        : side === 1 ? { z0: r.z0 + 1, z1: r.z0 + 9, x0: r.x1, x1: r.x1 + 4.5 } : null as unknown as Rect;
      if (o && o.x0 >= lot.x0 && o.z0 >= lot.z0 && o.x1 <= lot.x1 && o.z1 <= lot.z1 && side !== yardSide) {
        const ow = pick(rnd, CS.walls.downtown);
        const ot = facadeBox(s, o.x0, o.z0, o.x1, o.z1, CURB_H, [{ tile: FACADE.RIBBON, floors: 2, floorH: 3.3 }], ow, side, FACADE.LOBBY);
        flatRoof(s, o, ot, ow, rnd, 0);
      }
    }
  }
}

function buildPark(g: Batch, s: Batch, B: Rect, rnd: Rand, keep: Rect | null = null) {
  g.span(B.x0, 0, B.z0, B.x1, CURB_H, B.z1, CS.grass);
  const cx = (B.x0 + B.x1) / 2, cz = (B.z0 + B.z1) / 2, w = B.x1 - B.x0;
  // Cross paths and a ring.
  g.span(B.x0, CURB_H, cz - 1.2, B.x1, CURB_H + 0.02, cz + 1.2, C.path);
  g.span(cx - 1.2, CURB_H, B.z0, cx + 1.2, CURB_H + 0.02, B.z1, C.path);
  // (No pond where it would reach a deep stand's back.)
  const pond = rnd() < 0.4 && !(keep && Math.max(keep.x0 - (cx + w * 0.22), 0, (cx + w * 0.22) - keep.x1) ** 2 + Math.max(keep.z0 - (cz + w * 0.22), 0, (cz + w * 0.22) - keep.z1) ** 2 < 6.3 ** 2);
  if (pond) {
    const px = cx + w * 0.22, pz = cz + w * 0.22;
    s.cyl(px, CURB_H + 0.02, pz, 6.2, 0.06, 0xcabf9e, 14);
    s.cyl(px, CURB_H + 0.05, pz, 5.6, 0.06, C.water, 14);
  } else {
    s.cyl(cx, CURB_H + 0.25, cz, 3.2, 0.5, 0xc8c2b4, 14);
    g.box(cx, CURB_H + 0.52, cz, 4.4, 0.02, 4.4, C.water);
    s.cyl(cx, CURB_H + 1.2, cz, 0.35, 1.6, 0xc8c2b4, 8);
  }
  const n = irange(rnd, 16, 26);
  for (let i = 0; i < n; i++) {
    const x = range(rnd, B.x0 + 2, B.x1 - 2), z = range(rnd, B.z0 + 2, B.z1 - 2);
    if (Math.abs(x - cx) < 2.6 || Math.abs(z - cz) < 2.6) continue;
    if (pond && Math.hypot(x - (cx + w * 0.22), z - (cz + w * 0.22)) < 7.5) continue;
    if (keep && x > keep.x0 && x < keep.x1 && z > keep.z0 && z < keep.z1) continue;   // the stand's corner of the park
    if (rnd() < 0.25) conifer(s, x, CURB_H, z, range(rnd, 6, 9), pick(rnd, [0x1f5a34, 0x24663a]));
    else cityTree(s, x, CURB_H, z, range(rnd, 5.5, 9), range(rnd, 1.6, 2.6), pick(rnd, CS.trees.greens), rnd);
  }
  for (const [bx, bz, rot] of [[cx - 6, cz + 1.9, 0], [cx + 6, cz - 1.9, 0]] as const) // benches
    s.box(bx, CURB_H + 0.45, bz, 1.8, 0.1, 0.5, 0x7a5232, rot);
}

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
const standBox = (L: StandLayout) => L.stand !== "container" ? { a0: 23.2, a1: 28.3, n0: 0.9, n1: L.forklift ? 6.6 : 4.1 }
  : L.forklift ? { a0: L.a - 1.22, a1: L.a + 1.22, n0: 0.03, n1: 6.09 } : { a0: 23.0, a1: 29.06, n0: 0.03, n1: 2.47 };
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
  for (const [p, q] of [[a0 - 0.06, a0 + 0.12], [a1 - 0.12, a1 + 0.06]]) fspan(s, side, p, q, y0, top, n0 - 0.06, n0 + 0.12, look.trim);
  fspan(s, side, a0 - 0.06, a1 + 0.06, top - 0.18, top, n0 - 0.07, n1 + 0.07, look.trim);
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
      if (DC.fac === "treeLot") for (let i = 0; i < 4; i++) { const [x, z] = at(a0 - 0.6 - (i % 2) * 0.9, n0 + 0.6 + Math.floor(i / 2) * 1.1); conifer(s, x, y0, z, range(rnd, 1.6, 2.2), 0x1f5a34); }
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
      fspan(s, side, a0 - 2.4, a0 - 0.2, y0, y0 + 0.45, n0 + 0.4, n0 + 1.3, 0x2d5f9a);
      fspan(s, side, a0 - 2.3, a0 - 0.3, y0 + 0.45, y0 + 0.55, n0 + 0.5, n0 + 1.2, 0xf2efe8);
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
  // (A wide service door, for the forklift, is lower than usual: the light over it stays under the roof.)
  const wide = wideDoor(DC.fac), dHalf = wide ? WIDE_DOOR_HALF : DOOR_HALF;
  const door0 = L.a - dHalf - 0.2, door1 = L.a + dHalf + 0.2, w0 = door1 + 0.35, w1 = Math.min(w0 + 1.3, a1 - 0.5);
  for (let a = a0 + 0.35; a < a1 - 0.3; a += 0.3) {
    if (!(a > door0 - 0.08 && a < w1 + 0.08)) fspan(s, side, a - 0.05, a + 0.05, y1 + 0.16, top - 0.14, n0 - 0.035, n0 + 0.02, shade(look.wall, 0.86));
    fspan(s, side, a - 0.05, a + 0.05, y1 + 0.16, top - 0.14, n1 - 0.02, n1 + 0.035, shade(look.wall, 0.86));
  }
  // The window, framed, and a canopy over door and window.
  fspan(s, side, w0 - 0.06, w1 + 0.06, y0 + 1.04, y0 + 2.06, n0 - 0.03, n0 + 0.02, 0xd8d4c8);
  fspan(s, side, w0, w1, y0 + 1.1, y0 + 2.0, n0 - 0.05, n0 + 0.02, look.win);
  fspan(s, side, door0 - 0.2, w1 + 0.25, top - 0.02, top + 0.05, n0 - 0.8, n0 + 0.02, 0xd8d4c8);   // above the door's light
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
      s.cyl(tx, top + th / 2, tz, 1.4, th, tc, 12); s.cone(tx, top + th + 0.35, tz, 1.45, 0.7, shade(tc, 0.8), 12);
    }
  }
  if (STACKS.has(fac) && rnd() < 0.8) {
    const [sx, sz] = frontPt(side, L.a1 - 3, 36), sh = range(rnd, 12, 20);
    s.cyl(sx, top + sh / 2, sz, 0.75, sh, 0x8a5a48, 10);
    for (const f of [0.78, 0.9]) s.cyl(sx, top + sh * f, sz, 0.8, 0.9, f > 0.85 ? 0xb03a2e : 0xe8e4dc, 10);   // painted bands
  }
  if (fac === "coldStorage" || fac === "creamery") {
    for (let i = 0; i < 3; i++) {   // refrigeration units with their fans
      const [ux, uz] = frontPt(side, L.a0 + 3 + i * 4, L.wall + 6);
      s.box(ux, top + 0.8, uz, 2.6, 1.6, 2.6, 0xd8dadc); s.cyl(ux, top + 1.62, uz, 0.9, 0.06, 0x2a2b2e, 10);
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
    for (let a = L.a0 + 2; a < L.a1 - 1; a += 6) fspan(s, side, a - 0.05, a + 0.05, P + 4.0, P + 4.5, L.wall - 1.2, L.wall, C.dark);   // brackets
  }
  // Vertical ribs up the cladding on plain walls: a little relief either side of the yard face.
  if (cladding === FACADE.BLANK || cladding === FACADE.SIDING) {
    for (let a = L.a0 + 1.5; a < L.a1 - 1; a += 3) fspan(s, side, a - 0.08, a + 0.08, P + 4.6, top - 0.95, L.wall - 0.06, L.wall, shade(wall, 0.85));
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
  fspan(g, side, 9, 51, 0, CURB_H, L.edge + 0.02, 42, pave);   // (just behind the platform's face: shared planes flicker)
  if (yardA1 < 51) fspan(g, side, yardA1, 51, 0, CURB_H, 0, L.edge, pave);
  fspan(g, side, 9, yardA1, 0, 0.02, 0, L.edge, 0x66655f);
  for (const b of L.bays) for (const k of [-1.7, 1.7]) fspan(g, side, b + k - 0.06, b + k + 0.06, 0.02, 0.03, 1.5, L.edge, C.yellow);

  // The dock building: a plinth up to platform height, a band of dock doors on the yard side,
  // then a building of its own (warehouseLook): wall colour and cladding, height, roof, an accent
  // colour and what the business adds (tanks, a stack, a rooftop office, a canopy...).
  const r = frontRect(side, L.a0, L.a1, L.wall, 39.5);
  const top = buildWarehouse(s, side, face, L, r, district, rnd);
  if (DC.fac === "ryderWarehouse" && uv) ryderRoofSign(s, r, top, face, uv);

  // Platform and its edge, bumpers, a door at every bay (the site's own style), the leveller,
  // seal and dock light at the bays trucks use, wall packs, the steps, and some dressing.
  const used = dockUsedBays(L), usedA = used.map((i) => L.bays[i]);
  const near = (i: number, k = 1) => used.some((u) => Math.abs(u - i) <= k);
  const lr = (salt: number) => hash2(Math.floor(L.look * 1e6), salt, 0x77, 0);   // the dressing's own randoms (stable per site)
  fspan(s, side, L.a0, L.a1, 0, P, L.edge, L.wall, 0x9d9a91);
  fspan(s, side, L.a0, L.a1, P - 0.08, P + 0.004, L.edge - 0.01, L.edge + 0.1, C.yellow);
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
    if (open > 0) fspan(s, side, b - dw, b + dw, P, y0, L.wall - 0.07, L.wall - 0.04, 0x121416);              // dark inside
    fspan(s, side, b - dw, b + dw, y0, P + doorH, L.wall - 0.09, L.wall - 0.05, doorC);
    if (ribs) for (let y = y0 + 0.45; y < P + doorH - 0.1; y += 0.5) fspan(s, side, b - dw, b + dw, y, y + 0.04, L.wall - 0.1, L.wall - 0.09, shade(doorC, 0.75));
    if (windows && P + 1.7 > y0) fspan(s, side, b - dw + 0.2, b + dw - 0.2, P + 1.6, P + 1.85, L.wall - 0.1, L.wall - 0.09, 0x2a3644);
    if (shelter) {
      fspan(s, side, b - dw - 0.5, b - dw - 0.12, P, P + doorH + 0.4, L.wall - 0.55, L.wall, 0x232426);
      fspan(s, side, b + dw + 0.12, b + dw + 0.5, P, P + doorH + 0.4, L.wall - 0.55, L.wall, 0x232426);
      fspan(s, side, b - dw - 0.5, b + dw + 0.5, P + doorH + 0.15, P + doorH + 0.5, L.wall - 0.55, L.wall, 0x232426);
    }
    if (isUsed) {
      fspan(s, side, b - 1.05, b + 1.05, P, P + 0.025, L.edge, L.edge + 1.6, 0x70757a);                       // leveller plate
      fspan(s, side, b + dw + 0.55, b + dw + 0.85, P + 2.6, P + 2.9, L.wall - 0.2, L.wall, 0xf2b200);          // dock light
      for (const k of [-1, 1]) fspan(s, side, b + k * (dw + 0.35) - 0.09, b + k * (dw + 0.35) + 0.09, P, P + 1.1, L.wall - 0.4, L.wall - 0.22, C.yellow);   // bollards
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
    fspan(s, side, lb - hw, lb + hw, P + doorH + 0.7, P + doorH + 0.95, L.wall - 0.35, L.wall, 0x2a2b2e);
    const ax = s.aux.clone(); s.aux.set(0, 0, -2); fspan(s, side, lb - hw + 0.05, lb + hw - 0.05, P + doorH + 0.63, P + doorH + 0.71, L.wall - 0.32, L.wall - 0.03, C.lampHead); s.aux.copy(ax);
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
    fspan(s, side, ra - 0.03, ra + 0.03, 0, P + 1.0, L.edge - 0.13, L.edge - 0.07, C.yellow);
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
  if (lr(902) < 0.5) {
    const a = L.a1 - 2.2;
    if (!stairBlocked(a) && !usedA.some((u) => Math.abs(u - a) < 4)) {
      const c = pick(rnd, [0x2e5e3a, 0x2d4f7a, 0x6a6e72]);
      fspan(s, side, a - 1.6, a + 1.6, 0.25, 1.5, L.edge - 1.8, L.edge - 0.1, c);
      fspan(s, side, a - 1.65, a + 1.65, 1.5, 1.6, L.edge - 1.85, L.edge - 0.05, shade(c, 0.7));
    }
  }

  // Parked at other bays (never beside a used one, which trucks swing through): trailers in a
  // deep yard, another firm's box truck at some shallow docks.
  {
    const d = FRONT_NODE[side][2], alongX = FWD[d][0] !== 0;
    const wheel = (b: number, n: number) => { const [wx, wz] = frontPt(side, b, n); s.cyl(wx, 0.5, wz, 0.5, 2.3, 0x1b1b1b, 10, alongX ? 0 : Math.PI / 2, alongX ? Math.PI / 2 : 0); };
    L.bays.forEach((b, i) => {
      if (used.some((u) => i >= u - 1 && i <= u + 2)) return;
      if (L.deep) {
        if (rnd() > 0.45) return;
        const col = pick(rnd, [0xeeeeea, 0xeeeeea, 0xb03a2e, 0x2d5f9a, 0x8a8f94]);
        const rear = L.edge - 0.25, front = rear - 14.6;
        fspan(s, side, b - 1.3, b + 1.3, 1.15, 4.1, front, rear, col);
        fspan(s, side, b - 1.25, b + 1.25, 0.95, 1.15, front, rear, C.dark);
        for (const n of [rear - 1.9, rear - 3.1]) wheel(b, n);
        for (const k of [-0.9, 0.9]) fspan(s, side, b + k - 0.08, b + k + 0.08, 0, 1.0, front + 3.4, front + 3.6, 0x55585c);
      } else if (lr(500 + i) < 0.3) {
        const col = pick(rnd, [0xf2f2ee, 0xf2f2ee, 0x2d5f9a, 0xc8a020, 0x3d6b3a]), cab = pick(rnd, [0xf2f2ee, 0x2a2b2e, col]);
        const rear = L.edge - 0.15, boxF = rear - 6.2;
        fspan(s, side, b - 1.2, b + 1.2, 1.0, 3.6, boxF, rear, col);                       // box
        fspan(s, side, b - 1.15, b + 1.15, 0.7, 1.0, boxF - 2.4, rear, C.dark);            // chassis
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

  // A shallow dock sits beside the store or tower that fronts the rest of the street.
  if (!L.deep) {
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
    if (L.deep) {
      const y = P + 4.6 + 1.1;
      fspan(s, side, 25, 35, y - 0.72, y + 0.72, L.wall - 0.12, L.wall, C.dark);
      signQuad(quads, uv, side, 30, L.wall - 0.13, y, 9.6, 1.2, ox, oz);
    } else {
      const y = CURB_H + 4.2 + 1.3;
      fspan(s, side, 34.2, 43.8, y - 0.65, y + 0.65, 1.88, 2, C.dark);
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
