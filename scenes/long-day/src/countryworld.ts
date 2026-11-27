// The country world: the highway, the land along it and its set pieces (country.ts says where
// everything is), streamed in segments along the road around the truck, plus what moves with
// time: oncoming cars, the train and the crossing gates.
// Each segment is one group positioned at the road point where it starts, so its vertices stay
// small (float32) however far the drive goes. Built segments are a pure function of the road,
// so a seek simply rebuilds around the new position.
import * as THREE from "three@0.187.0";
import { hash2, hash3, mulberry32 } from "./rng.ts";
import { Batch, quadGeometry } from "./geom.ts";
import type { Quad } from "./geom.ts";
import { disposeTree } from "./chunks.ts";
import { OCCLUSION } from "./occlusion.ts";
import { applyCutaway, applyDriverSpot } from "./cutaway.ts";
import { applyLampGlow, applyLampLight, LAMPS_ON } from "./atmosphere.ts";
import type { TruckModel } from "./truck.ts";
import type { TreeKind } from "./styles.ts";
import { BARE, seasonGreens, seasonGround } from "./climate.ts";
import type { Climate } from "./climate.ts";
import { DC, waterTower } from "./decor.ts";
import { bareTree, shade } from "./city.ts";
import type { CityMaterials, FleetBuilder, Rand, StallPose } from "./city.ts";
import { AD_BATON, AD_BILLBOARD, AD_RYDER, PlateSet, signAtlas, SignAtlas } from "./signs.ts";
import type { SignMesh, SignStyle } from "./signs.ts";
import { BORE_H, BORE_HALF, COAST_N, CountryRoad, FERRY_LEN, LANE, MirrorView, PIECE_KINDS, TWO_WAY_SIGNS, CATTLE_X, ROAD_PAD, ONCOMING_SPEED, OVER_ABUT, OVER_DECK, OVER_HALF, pieceSigns, SEA_N, TRAIN_CAR, TRAIN_CARS, TRAIN_SPEED, tunnelTop,
  WEIGH_BACK, WEIGH_GREEN, FORECOURT, GAS_SIGN, GAS_SIGN_N, TS_SIGN_N, paveAt, piecePaving, WEIGH_LEN, WEIGH_LIGHT, WEIGH_N, WEIGH_OUT, WEIGH_SCALE, BOAT_L, BOAT_W, WATER_DROP } from "./country.ts";
import type { FerryPlan } from "./country.ts";
import { COW_GATE, herdDist, TRACTOR_B, TRACTOR_R } from "./country.ts";
import type { CattlePlan, HerdMember } from "./country.ts";
import { Cow, Horse, Tractor } from "./farm.ts";
import type { Coat } from "./farm.ts";
import type { BiomeId, RoadGeo, RoadPiece, RoadSign, RoadView } from "./country.ts";
import type { RoadItems, RoadMapPiece } from "./roadmap.ts";
import { storyTree } from "./city-storybook/storybook-buildings-town.ts";
import { vicFingerPost } from "./city-victorian/victorian-street.ts";
import { carriageAt } from "./carriage.ts";
import { applyPaintTint, CarFleet, carKindAt, carPaintAt, GLASS, headLamp, parkedCar, tailLamp } from "./cars.ts";
import type { CarKind } from "./cars.ts";
import { buildFreeway, FW_TIP } from "./freeway.ts";
import { vicRigs } from "./city-victorian/victorian-vehicles.ts";
import type { VicRig } from "./city-victorian/victorian-vehicles.ts";
import type { RigState } from "./storyvehicles.ts";
import { boatAt, deckW, hull, wedge } from "./boats.ts";
import type { Station } from "./boats.ts";

const ONCOMING_PAINTS = [0xc0392b, 0x2e6fb2, 0xe8e8e0, 0x2a2b2e, 0x8a9aa6, 0x2e8b57, 0xe0a020];
// Near a Victorian city (anywhere it has crept in, periodAt, where the truck meets it) what comes
// the other way is horse-drawn, one of these rigs (city-victorian/victorian-vehicles.ts) at its own
// pace, a repeat in the list making it likelier. A car met short of its reach runs no more than
// 200 m into it while in sight, where the road still has its markings (PERIOD_MODERN). Out of town
// the carts (the coal cart standing for a farm cart, the dray for a carrier's wagon), riders and
// four-wheelers to and from the station come most, the town's hansoms seldom; cyclists came out
// on the country roads.
const ONCOMING_RIGS = ["growler", "dray", "coalcart", "horseback", "coster", "growler", "coalcart", "dray", "horseback", "hansom", "pennyfarthing", "traction"];

// RoadRigs draws the rigs met on the road: a part of every rig of a kind is one instanced mesh,
// made the first time one is met, its pure white repainted per vehicle (cars.ts applyPaintTint).
class RoadRigs {
  private meshes = new Map<string, THREE.InstancedMesh[]>();
  private pose = Array.from({ length: 16 }, () => new THREE.Matrix4());
  private m = new THREE.Matrix4(); private col = new THREE.Color();
  constructor(private parent: THREE.Object3D, private material: THREE.Material, private cap: number) {}
  begin() { for (const ms of this.meshes.values()) for (const m of ms) m.count = 0; }
  add(rig: VicRig, base: THREE.Matrix4, s: RigState, paint: number) {
    let ms = this.meshes.get(rig.id);
    if (!ms) {
      ms = rig.parts.map((build) => {
        const b = new Batch(); build(b);
        const m = new THREE.InstancedMesh(b.build(this.material)!.geometry, this.material, this.cap);
        m.count = 0; m.frustumCulled = false;
        for (let i = 0; i < this.cap; i++) m.setColorAt(i, this.col.set(0xffffff));
        this.parent.add(m); return m;
      });
      this.meshes.set(rig.id, ms);
    }
    rig.pose(s, this.pose);
    ms.forEach((m, k) => { if (m.count < this.cap) { m.setMatrixAt(m.count, this.m.multiplyMatrices(base, this.pose[k])); m.setColorAt(m.count++, this.col.set(paint)); } });
  }
  end() { for (const ms of this.meshes.values()) for (const m of ms) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; } }
}
const SEG = 60;                  // segment length along the road (m); short, so building one never stalls a frame for long
const SEG_AHEAD = 480, SEG_BEHIND = 300;
const STORY_STEPS = 8;           // the storybook's creep into the real land near it goes in this many steps (storyLook)
const SIDE_W = 170;
// The roadside trees' kinds, as a map lists them (their index), and those with the darker greens.
const TREE_KINDS = ["broad", "palm", "conifer", "tuft", "pancake", "droop", "spiral", "cactus", "shrub", "cypress"];
const CGREEN = new Set(["conifer", "cypress", "cactus"]);              // scenery either side of the road
// The land's mesh: its columns across the road (each side), out past the fog. Field and beach
// edges fall on columns.
const LAND_N = [0, 6.8, 11, 14, 20, 28, 37, 47, -COAST_N, 66, -SEA_N, 88, 106, 128, 150, SIDE_W, 210, 260, 320];
const LAND_ROW = 6;
export const COUNTRY_CLEAR = 300;       // view distance in the country

interface BiomeLook {
  ground: number; ground2: number; trees: (TreeKind | "cactus" | "shrub" | "cypress")[]; greens: number[];
  density: number; rocks: number; fields?: number[]; fence?: boolean; water?: boolean; ponds?: boolean;
  turbines?: boolean; pylons?: boolean; barns?: boolean; cows?: boolean;
}
export const BIOMES: Record<BiomeId, BiomeLook> = {
  coastal: { ground: 0x6f9a48, ground2: 0xb9a85e, trees: ["cypress", "cypress", "broad", "shrub"], greens: [0x2f6a34, 0x3c7a46], density: 0.35, rocks: 0.15, water: true },
  forest: { ground: 0x3f7a3a, ground2: 0x4f8a3c, trees: ["conifer", "conifer", "conifer", "broad"], greens: [0x24592c, 0x2f6a30, 0x3c7a3a], density: 4.5, rocks: 0.2 },
  desert: { ground: 0xd4ac74, ground2: 0xc89a62, trees: ["cactus", "shrub", "shrub", "cactus"], greens: [0x5a7a3a, 0x6a8a44], density: 0.35, rocks: 0.6 },
  farmland: { ground: 0x6e9e44, ground2: 0x5d8a36, trees: ["broad", "broad", "conifer"], greens: [0x2f7d32, 0x3c7a46], density: 0.2, rocks: 0.05,
    fields: [0x8fb34a, 0x5d8a36, 0xd6bf66, 0x7a5a3a, 0x9ac05a], fence: true, barns: true },
  prairie: { ground: 0xb0b25c, ground2: 0x9aa64e, trees: ["broad", "shrub"], greens: [0x4f7a34, 0x5a8a3a], density: 0.12, rocks: 0.1, fence: true, turbines: true, cows: true },
  wetlands: { ground: 0x5a8a50, ground2: 0x6a9a58, trees: ["broad", "shrub", "shrub", "conifer"], greens: [0x3c6a3c, 0x4a7a40], density: 0.4, rocks: 0.05, ponds: true, pylons: true },
  // The storybook city's country is rolling hills in bands of lime, mint, butter and pink, dotted
  // with tuft trees, pancake trees and topiary (storybook-buildings-town.ts).
  storybook: { ground: 0x98dc62, ground2: 0x6fd38a, trees: ["tuft", "tuft", "pancake", "spiral"], greens: [0xff7fb5, 0xff9a2e, 0xf2c230, 0x9a6cf0, 0x6fe0e8], density: 0.6, rocks: 0,
    fields: [0xa6e05a, 0x5fcf8a, 0xf3e07a, 0x5fcf8a, 0xff9fc0] },
};
const CW = { asphalt: 0x34353a, shoulder: 0x7a776c, white: 0xe8e8e0, yellow: 0xf2c200, pole: 0x6b5a44, metal: 0x8d9296, dark: 0x1e2124,
  water: 0x2f78b8, sand: 0xd9c89a, rock: 0x8a8070, concrete: 0xa8a49a, green: 0x1e6b3a, red: 0xc0392b, ryder: 0xce1126, orange: 0xe8701a, wood: 0x8a5a34, trunk: 0x5a4030,
  macadam: 0x6e665a };
// Where a Victorian city has crept in further than this (CountryRoad.periodAt), the road keeps
// nothing modern by it: no painted lines, utility poles, pylons, wind turbines, steel silos or
// billboards, and its signs are finger posts (vicFingerPost). The truck turns into a carriage at the
// same point: its cab, back doors and exhaust change at half (truck.ts), as the oncoming traffic does.
const PERIOD_MODERN = 0.5;
// The colour a of the way to b by k (0..1), channel by channel.
function lerpColor(a: number, b: number, k: number) {
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - k) + ((b >> sh) & 255) * k) << sh;
  return ch(16) | ch(8) | ch(0);
}

// A double-ended car ferry, its car deck at the origin's height, facing +x (along the road),
// +z to the road's right (boats.ts lofts its hull): a navy hull, flared at its bluff ends, with a
// black fender belt at the deck and red below the water; white bulwarks along the sides, open
// at both ends for the ramps; a two-deck passenger cabin up the left side, its rows of windows
// lit after dark, a sun deck on it with twin funnels and a rescue boat on davits; the
// wheelhouse across the deck on two stair towers on the right, with bridge wings, a mast and
// radar; two lanes (cars waiting in the left one). `b` the hull, deck and cars (never thinned),
// `u` the superstructure (thinned by the cutaway), `glow` the navigation lights.
export function ferryModel(b: Batch, u: Batch, glow: Batch) {
  const L = BOAT_L, W = BOAT_W, NAVY = 0x1d3a6b, WHITE = 0xf2f2ee, RED = 0xc0392b, WIN = 0x1e2a38;
  const wl = -WATER_DROP + 0.03, e = L / 2 - 1.2;
  const st: Station[] = [
    { x: -e, wd: 5.4, yd: 0, wc: 4.8, yc: -1.9, wk: 2.6, yk: -3.0, rake: -1.2 },
    { x: -22, wd: 6.75, yd: 0, wc: 6.4, yc: -2.6, wk: 3.8, yk: -3.3 },
    { x: -12, wd: W / 2, yd: 0, wc: W / 2 - 0.3, yc: -2.7, wk: 4.0, yk: -3.4 },
    { x: 12, wd: W / 2, yd: 0, wc: W / 2 - 0.3, yc: -2.7, wk: 4.0, yk: -3.4 },
    { x: 22, wd: 6.75, yd: 0, wc: 6.4, yc: -2.6, wk: 3.8, yk: -3.3 },
    { x: e, wd: 5.4, yd: 0, wc: 4.8, yc: -1.9, wk: 2.6, yk: -3.0, rake: 1.2 },
  ];
  hull(b, st, { top: NAVY, stripe: WHITE, s0: -0.85, s1: -0.45, rail: 0x1a1b1d, bottom: 0x8a2a22, deck: 0x5d6166, wl });
  b.box(0, 0.006, -0.2, L - 6, 0.012, 0.14, 0xe8e8e0);   // the line between the lanes
  for (const x of [-L / 2 + 1.6, L / 2 - 1.6]) b.box(x, 0.006, 0, 0.3, 0.012, 9, 0xe0c020);   // yellow lines at each end
  // Bulwarks, white with a red cap, along each side between the ends' openings; bollards at the ends.
  for (const k of [-1, 1]) {
    for (let x = -23; x < 23; x += 2) {
      const z0 = k * (deckW(st, x) - 0.2), z1 = k * (deckW(st, x + 2) - 0.2), yaw = Math.atan2(-(z1 - z0), 2);
      b.box(x + 1, 0.55, (z0 + z1) / 2, Math.hypot(2, z1 - z0) + 0.02, 1.1, 0.3, WHITE, yaw);
      b.box(x + 1, 1.14, (z0 + z1) / 2, Math.hypot(2, z1 - z0) + 0.04, 0.1, 0.38, RED, yaw);
    }
    b.aux.set(0, 0, -3);   // (deck lamps along the bulwarks clear of the cabin: lit after dark)
    for (const x of [-22, -18.5, 18.5, 22]) b.box(x, 0.85, k * (deckW(st, x) - 0.37), 1.0, 0.25, 0.04, 0xd8d4c8);
    b.aux.set(0, 0, -1);
    for (const x of [-25.2, 25.2]) { b.cyl(x, 0.25, k * (deckW(st, x) - 0.6), 0.22, 0.5, 0x1c1d20, 8); b.cyl(x, 0.52, k * (deckW(st, x) - 0.6), 0.3, 0.06, 0x1c1d20, 8); }
  }
  // The passenger cabin up the left side: two decks, raked ends, windows (lit after dark), a sun deck.
  const cz = -(W / 2 - 1.6), cw = 2.6, X1 = 15, X2 = 12.5;
  u.box(0, 1.5, cz, 2 * X1, 3.0, cw, WHITE);
  u.box(0, 4.3, cz, 2 * X2, 2.6, cw, WHITE);
  for (const d of [-1, 1]) { wedge(u, d * X1, d * (X1 + 1.6), 0, 3.0, cw, WHITE, WHITE); wedge(u, d * X2, d * (X2 + 1.4), 3.0, 5.6, cw, WIN, WHITE); }
  u.box(0, 3.02, cz, 2 * X1 + 0.3, 0.08, cw + 0.3, 0xdedbd0); u.box(0, 5.64, cz, 2 * X2 + 0.3, 0.08, cw + 0.3, 0xdedbd0);
  u.aux.set(0, 0, -3);
  for (const zz of [cz - cw / 2 - 0.01, cz + cw / 2 + 0.01]) {
    for (let x = -13.5; x <= 13.6; x += 1.5) u.box(x, 1.9, zz, 1.0, 0.75, 0.02, WIN);
    for (let x = -11.2; x <= 11.3; x += 2.0) u.box(x, 4.4, zz, 1.6, 1.1, 0.02, WIN);
  }
  u.aux.set(0, 0, -1);
  for (const zz of [cz - cw / 2 - 0.02, cz + cw / 2 + 0.02]) u.box(0, 0.7, zz, 2 * X1 - 1, 0.12, 0.02, NAVY);   // a navy band along its foot
  for (const zz of [cz - cw / 2 + 0.06, cz + cw / 2 - 0.06]) for (let x = -12; x <= 12; x += 2) u.box(x, 6.15, zz, 0.04, 0.9, 0.04, 0x8d9296);
  for (const zz of [cz - cw / 2 + 0.06, cz + cw / 2 - 0.06]) u.box(0, 6.6, zz, 24, 0.05, 0.05, 0x8d9296);   // the sun deck's rail
  for (const x of [-7.5, 7.5]) { u.cyl(x, 7.4, cz, 0.85, 3.4, RED, 10); u.cyl(x, 9.2, cz, 0.88, 0.35, 0x1e1e1e, 10); }   // twin funnels
  // A rescue boat (boats.ts) on davits off the sun deck's outer edge.
  boatAt(u, "rowboat", -10.5, 6.4, -(W / 2 + 0.25), 0, 0xe86a1a, { scale: 1.2 });
  for (const x of [-12.1, -8.9]) { u.box(x, 6.9, -(W / 2 - 0.4), 0.12, 1.6, 0.12, 0x8d9296); u.box(x, 7.65, -(W / 2 + 0.1), 0.12, 0.12, 1.1, 0x8d9296); }
  // The wheelhouse across the deck, on the cabin and two stair towers on the right; bridge wings.
  for (const x of [-3, 3]) { u.box(x, 3.2, W / 2 - 0.9, 1.3, 6.4, 1.3, WHITE); u.box(x + (x < 0 ? 0.66 : -0.66), 1.0, W / 2 - 0.9, 0.02, 2.0, 0.8, 0x6b7076); }
  u.box(0, 7.6, 0, 7, 2.4, W - 1.0, WHITE); u.box(0, 6.0, cz, 7, 0.8, cw, WHITE);   // (on the cabin's roof on the left)
  u.aux.set(0, 0, -3);
  for (const d of [-1, 1]) u.box(d * 3.51, 7.95, 0, 0.02, 1.0, W - 1.6, WIN);
  for (const zz of [-(W - 1) / 2 - 0.01, (W - 1) / 2 + 0.01]) u.box(0, 7.95, zz, 6.2, 1.0, 0.02, WIN);
  u.aux.set(0, 0, -1);
  u.box(0, 8.86, 0, 7.8, 0.14, W + 1.6, 0xdedbd0);                                        // its roof, out over the wings
  for (const k of [-1, 1]) u.box(0, 6.45, k * (W / 2 + 0.3), 3.4, 0.12, 1.6, WHITE);       // the wings
  u.box(0, 10.3, 0, 0.2, 2.8, 0.2, 0x8d9296); u.box(0, 10.0, 0, 0.12, 0.12, 2.6, 0x8d9296); u.box(0.3, 9.25, 0, 0.12, 0.18, 2.0, 0x2b2d31);   // mast, yard, radar
  for (const x of [-2.2, 2.2]) u.cyl(x, 9.3, -2.5, 0.12, 0.6, WHITE, 6);                    // aerials
  // Cars in the left lane.
  const deck: [number, CarKind, number][] = [[-22.5, "sedan", 0xb22222], [-16.5, "suv", 0xc8ccd0], [-10.2, "van", 0xe8e8e8], [11.8, "hatch", 0xd4a017], [17.6, "wagon", 0x2e7d4f], [23.2, "pickup", 0x222428]];
  for (const [x, kind, paint] of deck) parkedCar(b, kind, x, 0, -2.6, 0, paint);
  // Navigation lights (port red, starboard green) at the wings' ends and the masthead light.
  glow.box(0, 6.75, -(W / 2 + 1.12), 0.3, 0.3, 0.1, 0xff3020); glow.box(0, 6.75, W / 2 + 1.12, 0.3, 0.3, 0.1, 0x30ff70);
  glow.box(0, 11.8, 0, 0.25, 0.25, 0.25, 0xfff6e0);
}

// A wind turbine, after a modern three-blade one (its hub at TURBINE_HUB, its rotor TURBINE_R
// across a blade), in two parts: `turbineTower` the still parts, standing at the origin with its
// nacelle facing along +x (the rotor's side), and `turbineRotor` the part that turns, centred on
// the hub, its axis along +y towards the wind (turbineRotorAt puts it on a tower).
export const TURBINE_HUB = 42, TURBINE_R = 22;
const TURB = { white: 0xe6e9ea, blade: 0xf2f4f4, grey: 0x9aa0a4, pad: 0xa8a49a, door: 0x5a6066, box: 0x6f7f6a };
const NAC_FWD = 3.0;   // the hub, ahead of the tower's axis
// The tower: a tapered tube (faceted), on a concrete pad, a door at its foot; a transformer
// beside it; the nacelle on top, longer behind than ahead, the spinner's base its front, an
// anemometer mast and the aviation light's housing at its back.
export const TURBINE_BOX: [number, number] = [4.4, -2.8];   // the transformer, in the tower's frame
// (`boxY`: the ground under the transformer, from the ground under the tower.)
export function turbineTower(b: Batch, boxY = 0) {
  const H = TURBINE_HUB - 1.5, r0 = 2.1, r1 = 1.2, N = 14, dy = b.dy;
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2;
    const p = (a: number, r: number, y: number): [number, number, number] => [Math.cos(a) * r, y + dy, Math.sin(a) * r];
    const face: [number, number, number] = [Math.cos(am), (r0 - r1) / H, Math.sin(am)];
    b.tri(...p(a0, r0, -0.5), ...p(a1, r0, -0.5), ...p(a1, r1, H), TURB.white, face);
    b.tri(...p(a0, r0, -0.5), ...p(a1, r1, H), ...p(a0, r1, H), TURB.white, face);
  }
  b.cyl(0, 0.1, 0, 3.4, 0.5, TURB.pad, 12);                  // the foundation's pad
  b.cyl(0, 0.55, 0, 2.15, 0.5, TURB.grey, 14);                // the flange at the foot
  b.box(2.06, 1.3, 0, 0.12, 2.2, 1.0, TURB.door);             // the door, under the rotor
  b.box(2.7, 0.45, 0, 1.2, 0.12, 1.4, TURB.grey);             // its step
  b.box(TURBINE_BOX[0], boxY + 0.95, TURBINE_BOX[1], 1.4, 1.6, 1.6, TURB.box);             // the transformer
  b.box(TURBINE_BOX[0], boxY + 0.0, TURBINE_BOX[1], 1.8, 0.4, 2.0, TURB.pad);              // on its plinth
  // The nacelle: a long box, a little narrower at the top, its back rounded off, on the yaw
  // bearing atop the tower (it bridges the tube's top to the nacelle's floor, 10 cm up).
  const yN = H + 1.7;
  b.cyl(0, H + 0.05, 0, r1 + 0.05, 0.12, TURB.grey, N);
  b.box(-1.4, yN, 0, 8.4, 3.2, 3.3, TURB.white);
  b.box(-1.4, yN + 1.75, 0, 7.6, 0.3, 2.7, TURB.white);
  b.box(-5.75, yN, 0, 0.5, 2.6, 2.8, TURB.white);
  b.cyl(NAC_FWD - 0.1, yN, 0, 1.2, 0.6, TURB.white, 12, 0, Math.PI / 2);   // the bearing collar the spinner turns on (narrower: its front end is inside the spinner, which turns)
  b.box(-4.6, yN + 2.6, 0.6, 0.1, 1.4, 0.1, TURB.grey);       // the anemometer mast
  b.box(-4.6, yN + 3.3, 0.6, 0.5, 0.06, 0.06, TURB.grey);
  b.box(-4.6, yN + 2.0, -0.5, 0.4, 0.2, 0.4, TURB.grey);      // the beacon's housing
}
// The red aviation light on the housing (in the tower's frame), lit after dark: sat on its top.
export const TURBINE_BEACON: [number, number, number] = [-4.6, TURBINE_HUB - 1.5 + 1.7 + 2.1 + 0.175, -0.5];
// The rotor: the spinner (a rounded nose, pointing +y), three slender blades round it in the
// x-z plane, widest a little out from the root and tapering to a narrow tip, twisted (pitched
// most at the root). Viewed from upwind (+y) it turns clockwise: rotate it by -angle about y.
export function turbineRotor(b: Batch) {
  b.cyl(0, 0, 0, 1.35, 1.4, TURB.white, 12);
  b.cone(0, 1.55, 0, 1.35, 1.7, TURB.white, 12);
  // Stations along a blade: r out from the hub, chord, thickness, pitch. The root is round-ish
  // (as thick as it is wide), the chord widest at the shoulder, then tapering to the tip.
  const ST: [number, number, number, number][] = [
    [0.9, 0.9, 0.85, 0.5], [2.4, 1.0, 0.75, 0.46], [4.6, 1.8, 0.5, 0.34], [8, 1.62, 0.36, 0.23],
    [12, 1.28, 0.26, 0.14], [16, 0.92, 0.18, 0.08], [19.5, 0.6, 0.13, 0.04], [TURBINE_R, 0.24, 0.07, 0.02],
  ];
  type V = [number, number, number];
  const q = (P: V, Q: V, R: V, S: V, n: V) => { b.tri(...P, ...Q, ...R, TURB.blade, n); b.tri(...P, ...R, ...S, TURB.blade, n); };
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2, er: V = [Math.sin(a), 0, Math.cos(a)];
    // Each station's corners: the leading edge (a third of the chord ahead of the pitch axis)
    // full thickness, the trailing edge thin; chord and thickness twisted out of the rotor's
    // plane by the pitch, the leading edge upwind (+y) of the trailing one, as the air meets it.
    const at = ([r, c, t, p]: [number, number, number, number]) => {
      const ec: V = [Math.cos(a) * Math.cos(p), -Math.sin(p), -Math.sin(a) * Math.cos(p)];
      const et: V = [Math.cos(a) * Math.sin(p), Math.cos(p), -Math.sin(a) * Math.sin(p)];
      const pt = (cc: number, tt: number): V => [er[0] * r + ec[0] * cc + et[0] * tt, -0.15 + ec[1] * cc + et[1] * tt, er[2] * r + ec[2] * cc + et[2] * tt];
      return { lt: pt(-0.33 * c, t / 2), lb: pt(-0.33 * c, -t / 2), tt: pt(0.67 * c, t * 0.12), tb: pt(0.67 * c, -t * 0.12), ec, et };
    };
    for (let i = 0; i + 1 < ST.length; i++) {
      const A = at(ST[i]), B = at(ST[i + 1]), { ec, et } = A, neg = (v: V): V => [-v[0], -v[1], -v[2]];
      q(A.lt, A.tt, B.tt, B.lt, et); q(A.lb, A.tb, B.tb, B.lb, neg(et));
      q(A.lt, A.lb, B.lb, B.lt, neg(ec)); q(A.tt, A.tb, B.tb, B.tt, ec);
      if (i + 2 === ST.length) q(B.lt, B.tt, B.tb, B.lb, er);
    }
  }
}
// Where the rotor turns on a tower at (x, y, z) facing `yaw` (the nacelle's +x turned by yaw, as
// Batch.box turns it), tilted up a little as real rotors are: put its mesh in this, spin the mesh.
export function turbineRotorAt(o: THREE.Object3D, x: number, y: number, z: number, yaw: number) {
  o.position.set(x + Math.cos(yaw) * (NAC_FWD + 0.6), y + TURBINE_HUB - 1.5 + 1.7, z - Math.sin(yaw) * (NAC_FWD + 0.6));
  o.rotation.set(0, yaw, -Math.PI / 2 + 0.09, "YZX");
}

// A turbine's rotor where it turns (turbineRotorAt), at w rad/s from phase ph, and its beacon.
interface TurbineSpin { at: THREE.Matrix4; w: number; ph: number; beacon: THREE.Vector3 }
// A segment's turbines: their rotors and beacons, one instanced mesh each (a draw call apiece,
// however many stand in it).
interface SegTurbines { spins: TurbineSpin[]; rotors: THREE.InstancedMesh; beacons: THREE.InstancedMesh }

export class CountryWorld {
  readonly group = new THREE.Group();
  private road: CountryRoad | null = null;
  private segs = new Map<number, THREE.Group>();
  private p = { x: 0, z: 0, h: 0, k: 0 };
  private q = { x: 0, z: 0, h: 0, k: 0 };
  // Things that move with time.
  private cars: CarFleet;
  private rigs: RoadRigs;   // (the horse-drawn ones near a Victorian city)
  private carPoses: number[] = [];   // oncoming cars: x, z, heading, height
  private carMat: THREE.MeshLambertMaterial;
  private train: THREE.Group | null = null;
  private gates: THREE.Group[] = [];
  private lights: THREE.Mesh[] = [];
  private weighLamps: THREE.Mesh[] = [];   // an open weigh station's flashers (k 0, 1) and its scale's signal (k 2 red, 3 green)
  private boat: THREE.Group | null = null; private foam: THREE.Mesh | null = null;
  private ramps: THREE.Group[] = [];   // the near quay's, the far quay's (each tips up about its hinge)
  // The boat's own materials, its windows lit after dark and the headlights falling on its deck:
  // its hull, deck and rails never thinned by the cutaway (shots on deck would see them
  // dithered); its superstructure thinned only where it stands between the camera and the
  // truck, as buildings are.
  private boatMat = (() => { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); applyDriverSpot(m); applyLampGlow(m); applyLampLight(m); return m; })();
  // The farm animals, the rider, the tractor and its driver: like the boat's hull, never thinned.
  private animMat = (() => { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); applyDriverSpot(m); applyLampGlow(m); applyLampLight(m); return m; })();
  private herd: { m: Cow | Horse; h: HerdMember; i: number }[] = [];
  private tractorObj: Tractor | null = null;
  private tp = { s: 0, n: 0, yaw: 0, v: 0, d: 0 };
  private boatTopMat = (() => { const m = new THREE.MeshLambertMaterial({ vertexColors: true }); applyCutaway(m); applyDriverSpot(m); applyLampGlow(m); applyLampLight(m); return m; })();
  private eul = new THREE.Euler();
  private m4 = new THREE.Matrix4(); private quat = new THREE.Quaternion(); private one = new THREE.Vector3(1, 1, 1); private v = new THREE.Vector3();
  // Per segment build state.
  private ox = 0; private oz = 0; private quads: Quad[] = []; private slots: number[] = []; private ads = false;

  constructor(scene: THREE.Scene, private mats: CityMaterials, private fleet: FleetBuilder | null) {
    scene.add(this.group);
    this.group.visible = false;
    const carMat = this.carMat = new THREE.MeshLambertMaterial({ vertexColors: true }); applyDriverSpot(carMat); applyLampGlow(carMat); applyLampLight(carMat); applyPaintTint(carMat);
    // The after-dark glow takes each car's own colour (a plain grey glow washed them all out).
    { const prev = carMat.onBeforeCompile.bind(carMat), prevKey = carMat.customProgramCacheKey.bind(carMat);
      carMat.onBeforeCompile = (shader, r) => { prev(shader, r); shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", "#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor.rgb;\n#endif\n#include <emissivemap_fragment>"); };
      carMat.customProgramCacheKey = () => prevKey() + "|cartint-v1"; }
    this.cars = new CarFleet(this.group, carMat, 10);
    this.rigs = new RoadRigs(this.group, carMat, 4);
    this.cars.keepWarm(scene);   // (in the scene: the road's group is hidden in town, where the first oncoming car's frame would come)
    // A wide plane under everything, following the truck, for the far land under the fog.
    // (Subdivided: fog is computed per vertex.)
    this.base = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000, 40, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6e9e44 }));
    this.base.position.y = -0.3;
    scene.add(this.base);   // under the city's countryside too (main.ts colours it there)
    // Never seen: keeps the crossing lights' material in the setup precompile.
    for (const m of [this.lightMat, this.boatMat, this.boatTopMat, this.animMat]) { const keep = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), m); keep.position.y = -5; this.group.add(keep); }   // (and the ferry boat's)
    // (And the instanced programs of the turbines' rotors and beacons.)
    for (const m of [this.mats.solid, this.lightMat]) { const keep = new THREE.InstancedMesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), m, 1); keep.position.y = -5; this.group.add(keep); }
  }
  private base: THREE.Mesh;

  lastBuildMs = 0; maxBuildMs = 0;
  // Exact (for a timeline that scrubs): the segments in the scene are a pure function of where the
  // truck is: exactly those in range, all built at once (no hysteresis, no one-a-frame catching up).
  exact = false;
  private lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });   // crossing lights, shared
  get active() { return this.road !== null; }
  // The road's place in the current frame (main.ts: the last city's road, still in view after the
  // next city takes over, is drawn moved into the new city's coordinates).
  setOffset(x: number, z: number) { this.group.position.set(x, 0, z); }
  get offset() { return this.group.position; }
  // The far land under everything, centred on (x, z), in a colour.
  setBase(x: number, z: number, color: number, y = -0.3) { this.base.position.set(x, y, z); (this.base.material as THREE.MeshLambertMaterial).color.setHex(color); }
  // The far land no higher than y (below a river town's water, the town in view from the road).
  lowerBase(y: number) { if (this.base.position.y > y) this.base.position.y = y; }
  // A biome's ground colour in a climate (for the land round a city).
  groundOf(id: BiomeId, c: Climate) { return this.lookOf(id, c).ground; }

  // A biome's look at (s, n), in the season there.
  private looks = new Map<string, BiomeLook & { cgreens: number[] }>();
  private tmpC = new THREE.Color();
  // (Near the storybook city its colours and trees creep into the real land too: storyLook.)
  private look(road: RoadView, sa: number, n = 0) {
    const id = road.biomeAt(sa, n), c = road.climateAt(sa, n);
    if (id === "storybook") return this.lookOf(id, c);
    const w = road.storyAt(sa);
    return w > 0.04 ? this.storyLook(id, c, Math.min(STORY_STEPS, Math.round(w * STORY_STEPS))) : this.lookOf(id, c);
  }
  // This gives a real biome's look with some of the storybook's in it (q of STORY_STEPS). Its ground and
  // fields grow brighter, towards the storybook's limes and pinks; candy-coloured crowns come among its
  // greens, a storybook tree stands here and there among its own, and its own trees thin to the
  // storybook's spacing.
  private storyLook(id: BiomeId, c: Climate, q: number) {
    const key = `${id}/${c.season}/${c.snowCover}/sb${q}`;
    let l = this.looks.get(key);
    if (!l) {
      const r = this.lookOf(id, c), sb = this.lookOf("storybook", c), w = q / STORY_STEPS;   // (sb is the storybook's look in the same climate: snowy where the real land is)
      const mix = (a: number, b: number, k: number) => this.tmpC.setHex(a).lerp(this.tmpC2.setHex(b), k).getHex();
      const candy = Math.round(w * 2 * r.greens.length);
      const greens = r.greens.map((g) => mix(g, 0x7ad04a, w * 0.5)), cgreens = r.cgreens.map((g) => mix(g, 0x7ad04a, w * 0.5));
      for (let i = 0; i < candy; i++) { const g = sb.greens[i % sb.greens.length]; greens.push(g); cgreens.push(g); }
      const odd = Math.round(w * 1.5 * r.trees.length), trees = [...r.trees];
      for (let i = 0; i < odd; i++) trees.push(sb.trees[i % sb.trees.length]);
      l = { ...r, ground: mix(r.ground, sb.ground, w * 0.8), ground2: mix(r.ground2, sb.ground2, w * 0.8), greens, cgreens, trees,
        density: r.density + (sb.density - r.density) * w,
        fields: r.fields?.map((f, i) => mix(f, sb.fields![i % sb.fields!.length], w * 0.8)) };
      this.looks.set(key, l);
    }
    return l;
  }
  private lookOf(id: BiomeId, c: Climate) {
    const key = `${id}/${c.season}/${c.snowCover}`;
    let l = this.looks.get(key);
    if (!l) {
      const b = BIOMES[id];
      // (The storybook country's trees keep their colours in every season, as its town's do.)
      const keep = id === "storybook";
      l = { ...b, ground: seasonGround(b.ground, c), ground2: seasonGround(b.ground2, c), greens: keep ? b.greens : seasonGreens(b.greens, c), cgreens: keep ? b.greens : seasonGreens(b.greens, c, true),
        fields: b.fields?.map((f) => seasonGround(f, c)) };
      this.looks.set(key, l);
    }
    return l;
  }

  setRoad(road: CountryRoad | null) {
    if (road === this.road) return;
    this.clear();
    this.road = road;
    this.group.visible = !!road;
    this.setOffset(0, 0);
    if (!road) return;
    // The train and the crossing gates, if this drive has a crossing.
    this.geo = road.geo;
    const railP = road.geo.pieces.find((p) => p.kind === "rail"), G = road.geo;
    if (railP) {
      const rs = this.railS = railP.way === 1 ? railP.s : G.length - railP.s;   // (the track, in the map's coordinates)
      this.train = this.buildTrain(G, rs);
      this.group.add(this.train);
      G.center(rs, this.p);
      for (const [ds, side] of [[-7, 1], [7, -1]] as const) {
        G.point(rs + ds, side * 6.2, this.q);
        const g = new THREE.Group(), b = new Batch();
        // The arm, along local -z (towards the road) from the pivot.
        for (let i = 0; i < 6; i++) b.box(0, 0, -0.5 - i, 0.12, 0.12, 1.0, i % 2 ? CW.red : 0xf2f2f2);
        g.add(b.build(this.mats.solid)!);
        g.position.set(this.q.x, 1.1 + G.heightAt(rs), this.q.z);
        g.rotation.order = "YXZ"; g.rotation.y = this.p.h + (side > 0 ? 0 : Math.PI);
        this.group.add(g); this.gates.push(g);
        for (const k of [-0.3, 0.3]) {
          const lb = new Batch(); lb.box(0, 0, 0, 0.3, 0.3, 0.1, 0xff3020);
          const l = lb.build(this.lightMat)!;
          G.point(rs + ds - Math.sign(ds) * 0.9, side * 6.6, this.q);
          l.position.set(this.q.x, 2.6 + G.heightAt(rs), this.q.z);
          l.position.x += Math.sin(this.p.h) * k * side; l.position.z += Math.cos(this.p.h) * k * side;
          l.rotation.y = this.p.h + Math.PI / 2 * Math.sign(ds);
          l.userData.k = k; this.group.add(l); this.lights.push(l);
        }
      }
    }
    if (road.ferry) {
      const F = road.ferry, y = road.baseAt(F.q0);
      this.boat = this.buildBoat(); this.group.add(this.boat);
      for (const [q, dir] of [[F.q0, 1], [F.q1, -1]] as const) {
        const b = new Batch();
        b.box(dir * 2.1, 0.09, 0, 4.2, 0.12, 7, 0x6a6e72);
        for (const k of [-3.41, 3.41]) b.box(dir * 2.1, 0.2, k, 4.18, 0.12, 0.2, CW.yellow);   // (a cm proud of the plate's sides, short of its ends: shared planes flicker)
        const pivot = new THREE.Group(); pivot.add(b.build(this.mats.solid)!); pivot.userData.dir = dir;
        const outer = new THREE.Group(); outer.add(pivot);
        road.center(q, this.p); outer.position.set(this.p.x, y, this.p.z); outer.rotation.y = this.p.h;
        this.group.add(outer); this.ramps.push(outer);
      }
    }
    if (road.cattle) this.buildHerd(road, road.cattle);
    if (road.tractor) { this.tractorObj = new Tractor(this.animMat, this.lightMat); this.group.add(this.tractorObj.root); }
    const weigh = road.pieces.find((p) => p.kind === "weigh" && p.open);
    if (weigh) {
      const lamp = (s: number, n: number, y: number, w: number, color: number, k: number) => {
        const lb = new Batch(); lb.box(0, 0, 0, 0.1, w, w, color);
        const l = lb.build(this.lightMat)!;
        road.point(s, n, this.q);
        l.position.set(this.q.x, y + road.baseAt(s), this.q.z); l.rotation.y = this.q.h;
        l.userData.k = k; l.visible = false; this.group.add(l); this.weighLamps.push(l);
      };
      const sg = pieceSigns(weigh)[0];
      for (const [k, d] of [[0, -3.9], [1, 3.9]]) lamp(sg.s - 0.25, sg.n + d, sg.y + 1.3, 0.38, 0xffa020, k);   // amber flashers over the board's ends
      lamp(weigh.s + WEIGH_LIGHT - 0.22, WEIGH_N + 3.2, 4.45, 0.3, 0xff3020, 2);
      lamp(weigh.s + WEIGH_LIGHT - 0.22, WEIGH_N + 3.2, 3.95, 0.3, 0x30ff70, 3);
    }
  }

  private geo: RoadGeo | null = null;
  private railS = 0;
  clear() {
    for (const g of this.segs.values()) { this.group.remove(g); disposeTree(g); }
    this.segs.clear();
    if (this.train) { this.group.remove(this.train); disposeTree(this.train); this.train = null; }
    // (The herd's and the tractor's geometry is shared between drives: removed, not disposed.)
    for (const h of this.herd) this.group.remove(h.m.root);
    if (this.tractorObj) this.group.remove(this.tractorObj.root);
    this.herd = []; this.tractorObj = null;
    for (const g of [...this.gates, ...this.lights, ...this.weighLamps, ...this.ramps, ...(this.boat ? [this.boat] : [])]) { this.group.remove(g); disposeTree(g); }
    this.gates = []; this.lights = []; this.weighLamps = []; this.ramps = []; this.boat = null; this.foam = null;
    this.cars.begin(); this.cars.end(); this.rigs.begin(); this.rigs.end();
  }

  // Stream segments around the truck (all at once after a jump) and move what moves.
  private tmpC2 = new THREE.Color();
  update(u: number, sTruck: number, jumped: boolean, baseToo = true) {
    const road = this.road;
    if (!road) return;
    // (Segments in the map's coordinates, the same whichever way the road is driven.)
    const sm = road.ds(sTruck), back = road.dir < 0;
    const i0 = Math.floor((sm - (back ? SEG_AHEAD : SEG_BEHIND)) / SEG), i1 = Math.floor((sm + (back ? SEG_BEHIND : SEG_AHEAD)) / SEG);
    const keep = this.exact ? 0 : 1;
    for (const [i, g] of this.segs) if (i < i0 - keep || i > i1 + keep) { this.group.remove(g); disposeTree(g); this.segs.delete(i); }
    let budget = jumped || this.exact ? Infinity : 1;
    // Nearest first: the one ahead of the truck, then outwards.
    const want: number[] = [];
    const iMax = Math.floor((Math.max(road.length, road.geo.length) - 0.01) / SEG);
    for (let i = i0; i <= i1; i++) if (i >= 0 && i <= iMax && !this.segs.has(i)) want.push(i);
    want.sort((a, b) => Math.abs(a * SEG + SEG / 2 - sm) - Math.abs(b * SEG + SEG / 2 - sm));
    for (const i of want) {
      if (budget-- <= 0) break;
      const t0 = performance.now();
      const g = this.buildSegment(road, i); this.segs.set(i, g); this.group.add(g);
      this.lastBuildMs = performance.now() - t0; if (!jumped) this.maxBuildMs = Math.max(this.maxBuildMs, this.lastBuildMs);
    }
    // The far land under the fog blends from one look to the next across the middle of the drive.
    if (baseToo) {
      road.center(THREE.MathUtils.clamp(sTruck, 0, road.length), this.p);
      const fromG = this.lookOf(road.fromBiome, road.inp.fromClimate).ground, toG = this.lookOf(road.toBiome, road.inp.toClimate).ground;
      this.tmpC.setHex(fromG).lerp(this.tmpC2.setHex(toG), road.blendAt(sTruck));
      this.setBase(this.p.x + this.group.position.x, this.p.z + this.group.position.z, this.tmpC.getHex(), Math.min(-0.3, road.lowBetween(sTruck - 340, sTruck + SEG_AHEAD + 120)));
    }
    this.updateCars(road, u, sTruck);
    this.updateCrossing(road, u);
    this.updateWeigh(road, u);
    this.updateFerry(road, u, sTruck);
    this.updateFarm(road, u);
    this.updateTurbines(u);
  }
  // The turbines' rotors turn (a pure function of the time, for a timeline that scrubs); their
  // beacons flash together after dark, 0.8 s on in every two.
  private updateTurbines(u: number) {
    const lit = LAMPS_ON.value > 0.5 && u - 2 * Math.floor(u / 2) < 0.8;
    for (const g of this.segs.values()) {
      const T = g.userData.turbines as SegTurbines | undefined;
      if (!T) continue;
      T.beacons.visible = lit;
      let moved = false;
      for (let i = 0; i < T.spins.length; i++) { const t = T.spins[i]; if (t.w) { this.rotorMatrix(t, u); T.rotors.setMatrixAt(i, this.m4); moved = true; } }
      if (moved) T.rotors.instanceMatrix.needsUpdate = true;
    }
  }
  // A rotor's matrix at time u, in m4: where it turns, spun about its axis (-angle about y).
  private rotorMatrix(t: TurbineSpin, u: number) {
    this.m4.makeRotationY(-((t.ph + t.w * u) % (Math.PI * 2))).premultiply(t.at);
  }

  // Headlight patches ahead of the oncoming cars nearest `at` (atmosphere.ts HEAD_LIGHTS).
  headlights(out: THREE.Vector4[], from: number, at: { x: number; z: number }, ys: number[]) {
    const d = this.carPoses, order: number[] = [];
    const ax = at.x - this.group.position.x, az = at.z - this.group.position.z;
    for (let i = 0; i < d.length; i += 4) if (Math.hypot(d[i] - ax, d[i + 1] - az) < 120) order.push(i);
    order.sort((a, b) => Math.hypot(d[a] - ax, d[a + 1] - az) - Math.hypot(d[b] - ax, d[b + 1] - az));
    for (let k = from; k < out.length; k++) {
      const i = order[k - from];
      if (i === undefined) { out[k].w = 0; continue; }
      const h = d[i + 2];
      out[k].set(d[i] + Math.cos(h) * 7.5 + this.group.position.x, d[i + 1] - Math.sin(h) * 7.5 + this.group.position.z, h, 0.7); ys[k] = d[i + 3];
    }
  }

  // ---- what moves ---------------------------------------------------------------------------
  private updateCars(road: CountryRoad, u: number, sTruck: number) {
    // After dark the bodies keep a faint glow, so an oncoming car reads as a car behind its lights.
    this.carMat.emissive.setScalar(0.22 * LAMPS_ON.value);
    let n = 0;
    this.carPoses.length = 0;
    this.cars.begin(); this.rigs.begin();
    for (let i = 0; i < road.meetings.length && n < 10; i++) {
      const tm = road.meetings[i];
      // (Horse-drawn where the meeting is in the Victorian city's reach, and slow: it still meets
      // the truck at tm.)
      const rig = road.periodAt(road.sAt(tm)) > 0 ? vicRigs().find((r) => r.id === ONCOMING_RIGS[Math.floor(hash2(i, 0x0d, 0xa7, 0x52) * ONCOMING_RIGS.length)])! : null;
      const sp = rig ? rig.vmax * 0.9 : ONCOMING_SPEED;
      const s = road.sAt(tm) - sp * (u - tm);
      if (Math.abs(s - sTruck) > 330 || s < road.landFrom || s > road.landTo) continue;
      road.point(s, -LANE, this.p);
      this.quat.setFromEuler(this.eul.set(0, this.p.h + Math.PI, -Math.atan(road.gradeAt(s))));   // (it drives down the road: its nose dips where the road climbs)
      this.m4.compose(this.v.set(this.p.x, road.heightAt(s), this.p.z), this.quat, this.one);
      if (rig) { this.rigs.add(rig, this.m4, { odo: 1000 + sp * (u - tm), v: sp, t: u, seed: i }, rig.colors[i % rig.colors.length]); n++; continue; }
      this.cars.add(carKindAt(hash2(i, 0x0c, 0xa7, 0x51)), this.m4, ONCOMING_PAINTS[i % ONCOMING_PAINTS.length]);
      this.carPoses.push(this.p.x, this.p.z, this.p.h + Math.PI, road.heightAt(s));
      n++;
    }
    this.cars.end(); this.rigs.end();
  }

  private updateCrossing(road: CountryRoad, u: number) {
    if (!this.train) return;
    const rail = road.stops.find((s) => s.kind === "rail");
    const tt = road.trainT;
    // Train front along the track (n, right of the road positive), and the gates around it.
    const front = tt < 0 ? -1e4 : -150 + TRAIN_SPEED * (u - tt);
    const len = (TRAIN_CARS + 1) * TRAIN_CAR;
    this.train.visible = front > -240 && front - len < 240;
    if (this.train.visible) {
      const G = road.geo, rs = this.railS;
      G.point(rs, front, this.p);
      this.train.position.set(this.p.x, G.heightAt(rs), this.p.z);
    }
    const down0 = rail ? rail.arrive - 7 : 1e9, up0 = tt + (150 + 8 + len) / TRAIN_SPEED + 0.5;
    const down = THREE.MathUtils.clamp(Math.min((u - down0) / 3, (up0 + 3 - u) / 3), 0, 1);
    for (const g of this.gates) g.rotation.x = (1 - down) * Math.PI / 2 * 0.95;   // up: the arm points to the sky
    const flash = down > 0 && Math.floor(u * 2) % 2 === 0;
    for (const l of this.lights) l.visible = down > 0 && (l.userData.k > 0 ? flash : !flash);
  }

  // An open weigh station: its flashers alternate; its signal is red, and goes green as the truck
  // on the scale is done with, for a while after it pulls off.
  private updateWeigh(road: CountryRoad, u: number) {
    if (!this.weighLamps.length) return;
    const stop = road.stops.find((x) => x.kind === "weigh"), go = stop ? stop.arrive + stop.dwell - WEIGH_GREEN : 1e9;
    const green = u >= go && u < go + 14, flash = Math.floor(u * 1.6) % 2;
    for (const l of this.weighLamps) { const k = l.userData.k; l.visible = k < 2 ? k === flash : k === 3 ? green : !green; }
  }

  // The ferry boat: where the truck is says where it is (country.ts boatRear); the ramps tip up
  // as it leaves a quay and down as it comes in; a wake while it is under way.
  private updateFerry(road: CountryRoad, u: number, sTruck: number) {
    if (!this.boat || !road.ferry) return;
    const F = road.ferry, rear = road.boatRear(sTruck);
    road.center(rear + BOAT_L / 2, this.p);
    this.boat.position.set(this.p.x, road.baseAt(F.q0), this.p.z); this.boat.rotation.y = this.p.h;
    const off = [rear - F.q0, F.q1 - BOAT_L - rear];
    this.ramps.forEach((r, k) => { const pv = r.children[0]; pv.rotation.z = pv.userData.dir * 0.45 * smooth01(off[k] / 3); });
    const v = road.aboardAt(u) ? road.vAt(u) : 0;
    if (this.foam) { this.foam.visible = v > 0.4; this.foam.scale.x = Math.max(0.05, v / 7); }
  }
  // The car ferry (ferryModel), its materials, and its wake.
  private buildBoat(): THREE.Group {
    const b = new Batch(), glow = new Batch();
    const u = new Batch();   // the superstructure (it may thin out between the camera and the truck)
    ferryModel(b, u, glow);
    const g = new THREE.Group();
    g.add(b.build(this.boatMat)!); g.add(u.build(this.boatTopMat)!); g.add(glow.build(this.lightMat)!);
    // The wake astern, just over the water.
    const fb = new Batch(); fb.box(-4, 0, 0, 8, 0.04, BOAT_W - 2, 0xeef4f8); fb.box(-9.25, 0.02, 0, 2.5, 0.04, BOAT_W - 5, 0xd8e6ee);
    const foam = fb.build(this.mats.ground)!; foam.position.set(-BOAT_L / 2, -1.57, 0); foam.visible = false;
    g.add(foam); this.foam = foam;
    return g;
  }
  // A ferry terminal (in the segment with its quay): the booth under a canopy, waiting lanes and
  // the terminal building on the right, the quay with the ramp's gantry and fenders. (The far one is
  // this turned half round: buildSegment.)
  private ferryNear(g: Batch, s: Batch, F: FerryPlan, y: number) {
    const Q = F.q0, S = F.s, CON = CW.concrete, WALL = 0x8a867c;
    this.rbox(g, Q - 14.995, 0, -0.1, 30.01, 0.1, 80, CON);   // (5 cm under the road, and a cm past its end)
    this.rbox(s, Q - 0.59, 0, -1.9, 1.22, 3.6, 80.02, WALL);   // (a cm past the apron's sides)   // (its top under the apron's, its face 2 cm proud of the apron's edge)
    for (const n of [-7.6, 7.6]) this.rbox(s, Q + 0.15, n, -0.9, 0.3, 1.4, 1.0, 0x222222);
    for (const n of [-30, -18, 18, 30]) { const [x, z] = this.L(Q - 1.2, n); s.cyl(x, 0.3, z, 0.25, 0.6, 0x2a2b2e, 8); }
    for (const n of [-5.2, 5.2]) this.rbox(s, Q - 1.2, n, 3.2, 0.5, 6.4, 0.5, CW.yellow);
    this.rbox(s, Q - 1.2, 0, 6.6, 0.7, 0.7, 11, CW.yellow);
    const B = F.booth + 6;
    this.rbox(s, B, -0.9, 1.3, 3, 2.6, 1.4, 0xe8e2d6); this.rbox(s, B, -0.9, 1.7, 3.1, 0.8, 1.5, 0x2a3440); this.rbox(s, B, -0.9, 2.75, 3.4, 0.3, 1.8, 0x1d3a6b);
    for (const a of [B - 3.6, B + 3.6]) for (const n of [-6.6, 6.6]) this.rbox(s, a, n, 2.7, 0.3, 5.4, 0.3, 0xdedbd0);
    this.rbox(s, B, 0, 5.6, 8.4, 0.5, 14, 0xf2f2ee); this.rbox(s, B, 0, 5.25, 8.5, 0.25, 14.1, 0x1d3a6b);
    const a0 = B + 6, a1 = Q - 31;
    this.rbox(g, (a0 + a1) / 2, 10, -0.045, a1 - a0, 0.1, 11.8, CW.asphalt);
    for (const n of [7, 10, 13]) this.rbox(g, (a0 + a1) / 2, n, 0.005, a1 - a0 - 1, 0.02, 0.14, CW.white);
    ([[a0 + 4, 8.5], [a0 + 11, 8.5], [a0 + 6, 11.5], [a0 + 20, 14.5]] as const).forEach(([a, n], k) => {
      const kk = k + (this.flip ? 4 : 0), [x, z, h] = this.L(a, n), r = hash2(kk, Math.round(F.s), 0xfe7, 0x31);   // (the far terminal's cars its own)
      parkedCar(s, carKindAt(r), x, 0.005, z, h, carPaintAt(hash2(kk, Math.round(F.s), 0xfe8, 0x32)));
    });
    this.rbox(s, S + 57, 26, 3.5, 34, 7, 12, 0xe8e2d6); this.rbox(s, S + 57, 26, 3.0, 34.1, 2.2, 12.1, 0x2a3440); this.rbox(s, S + 57, 26, 7.2, 34.6, 0.4, 12.6, 0x1d3a6b);
    const uv = this.slot("FERRY TERMINAL", { bg: "#1d3a6b", fg: "#ffffff", logo: false });
    if (uv) { const [x, z, h] = this.L(S + 57, 19.88); this.quads.push({ x, y: y + 5.6, z, w: 9.6, h: 1.2, rotY: Math.atan2(-Math.sin(h), -Math.cos(h)), ...uv }); }
  }
  // The herd: each cow walks from its spot in the pasture to the gate, across the road and through
  // the corral's gate to its spot there, reaching the pasture gate at the herd's time + its turn;
  // the rider brings up the rear and stops just inside the corral gate. Paths in road
  // coordinates (s, n), with the distance along them.
  private buildHerd(road: CountryRoad, _c: CattlePlan) {
    road.herd().forEach((h, i) => {
      const m = h.rider ? new Horse(this.animMat) : new Cow(this.animMat, h.coat as Coat);
      this.group.add(m.root);
      this.herd.push({ m, h, i });
    });
  }
  private herdAt(h: { pts: number[]; cum: number[] }, d: number): [number, number] {
    const { pts, cum } = h;
    d = THREE.MathUtils.clamp(d, 0, cum[cum.length - 1]);
    let k = 1; while (k < cum.length - 1 && cum[k] < d) k++;
    const f = (d - cum[k - 1]) / Math.max(1e-6, cum[k] - cum[k - 1]);
    return [pts[2 * k - 2] + (pts[2 * k] - pts[2 * k - 2]) * f, pts[2 * k - 1] + (pts[2 * k + 1] - pts[2 * k - 1]) * f];
  }
  private updateFarm(road: CountryRoad, u: number) {
    if (this.herd.length) {
      const T0 = road.herdT0;
      for (const { m, h, i } of this.herd) {
        const total = h.cum[h.cum.length - 1], tau = T0 === null ? 0 : u - T0 - h.leave, d = herdDist(h, tau);
        // (Heading: along the path, smoothed through its corners.)
        const [ps, pn] = this.herdAt(h, d), a = this.herdAt(h, Math.min(d, total - 2) - 1.2), b = this.herdAt(h, Math.min(d, total - 2) + 1.2);
        road.point(ps, pn, this.p);
        // How hard it is walking now (its pace, from the distance a moment either side).
        const sp = (herdDist(h, tau + 0.15) - herdDist(h, tau - 0.15)) / 0.3, walking = THREE.MathUtils.clamp(sp / 1.2, 0, 1);
        m.root.position.set(this.p.x, road.groundAt(ps, pn), this.p.z);
        m.root.rotation.y = this.p.h - Math.atan2(b[1] - a[1], b[0] - a[0]);
        const phase = d / (h.rider ? 1.7 : 1.35);
        if (m instanceof Cow) {
          const look = 0.5 + 0.5 * Math.sin(u * 0.37 + i * 1.7);
          m.pose(phase, walking, (1 - walking) * (look > 0.3 ? 1 : 0.15 + look * 2.8));
        } else m.pose(phase, walking);
      }
    }
    if (this.tractorObj && road.tractor) {
      const t = road.tractorPose(u, this.tp);
      road.point(t.s, t.n, this.p);
      this.tractorObj.root.position.set(this.p.x, road.groundAt(t.s, t.n), this.p.z);
      this.tractorObj.root.rotation.y = this.p.h + t.yaw;
      this.tractorObj.pose(t.d, Math.floor(u * 2.5) % 2 === 0);
    }
  }
  // A post-and-rail fence along the road (n across), from a0 to a1, open over the gaps; and one
  // across it at a, from n0 to n1. Each post stands on the ground there.
  private railFence(s: Batch, a0: number, a1: number, n: number, gaps: [number, number][]) {
    const open = (a: number) => gaps.some(([g0, g1]) => a > g0 && a < g1);
    const W = 0x8a6a48, step = 3.5, keep = s.dy;
    let prev: number | null = null;
    for (let a = Math.ceil(a0 / step) * step; a <= a1; a += step) {
      if (open(a)) { prev = null; continue; }
      const gy = this.V.groundAt(a, n);
      s.dy = gy; this.rbox(s, a, n, 0.6, 0.13, 1.2, 0.13, W);
      if (prev !== null && !open(a - step / 2)) for (const y of [0.55, 1.0]) this.rbox(s, a - step / 2, n, y, step, 0.08, 0.05, 0x9a7a56);
      prev = a;
    }
    s.dy = keep;
  }
  private crossFence(s: Batch, a: number, n0: number, n1: number) {
    const W = 0x8a6a48, keep = s.dy, sg = Math.sign(n1 - n0), step = 3.5, len = Math.abs(n1 - n0);
    for (let k = 0; k <= len / step; k++) {
      const n = n0 + sg * k * step;
      s.dy = this.V.groundAt(a, n); this.rbox(s, a, n, 0.6, 0.13, 1.2, 0.13, W);
      if (k > 0) for (const y of [0.55, 1.0]) this.rbox(s, a, n - sg * step / 2, y, 0.05, 0.08, step, 0x9a7a56);
    }
    s.dy = keep;
  }
  // A field gate's posts and its gate swung open into the field (at a, the fence along n).
  private fieldGate(s: Batch, a: number, n: number, half: number) {
    const sg = Math.sign(n);
    for (const k of [-half, half]) this.rbox(s, a + k, n, 0.75, 0.18, 1.5, 0.18, 0x6a4a30);
    for (const y of [0.35, 0.75, 1.15]) this.rbox(s, a + half + 0.12, n + sg * half, y, 0.05, 0.06, 2 * half - 0.3, 0xa8acb0);   // the gate, open (along the post)
    this.rbox(s, a + half + 0.12, n + sg * half, 0.75, 0.06, 0.95, 0.06, 0xa8acb0);
  }

  private buildTrain(road: RoadView, rs: number): THREE.Group {
    const b = new Batch();
    freightTrain(b);
    const g = new THREE.Group();
    g.add(b.build(this.mats.solid)!);
    road.center(rs, this.p);
    g.rotation.y = this.p.h - Math.PI / 2;   // local +x along the road's right
    return g;
  }

  // ---- segments -----------------------------------------------------------------------------
  // Local position of (s, n) in the segment being built, the road's heading there and the
  // ground's height.
  // (The view segments draw through: the map's coordinates, or turned half round about a piece's
  // middle for its other face, or about the road's for a piece facing b to a: mirrored.)
  private V!: RoadView;
  private flip = false;
  private mirrored(c: number, fn: () => void) {
    const keep = this.V, kf = this.flip;
    this.V = new MirrorView(keep, c); this.flip = !kf;
    try { fn(); } finally { this.V = keep; this.flip = kf; }
  }
  private L(s: number, n: number): [number, number, number, number] {
    this.V.point(s, n, this.q);
    return [this.q.x - this.ox, this.q.z - this.oz, this.q.h, this.V.groundAt(s, n)];
  }
  // A box aligned with the road at (s, n): `len` along it, `wid` across, tilted to `grade`.
  // (Its height is above the batch's dy.)
  private rbox(b: Batch, s: number, n: number, y: number, len: number, hgt: number, wid: number, color: number, yaw = 0, grade = 0) {
    const [x, z, h] = this.L(s, n);
    if (grade === 0) b.box(x, y, z, len, hgt, wid, color, h + yaw);
    else b.boxR(x, y, z, len, hgt, wid, color, 0, h + yaw, Math.atan(grade));
  }
  // A beam from one point to another (world heights: no dy).
  private beam(b: Batch, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, th: number, wd: number, color: number) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0, run = Math.hypot(dx, dz);
    const keep = b.dy; b.dy = 0;
    b.boxR((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.hypot(run, dy), th, wd, color, 0, Math.atan2(-dz, dx), Math.atan2(dy, run));
    b.dy = keep;
  }
  // The lowest ground within r of (s, n): what a building there stands on (sunk into the slope).
  private foot(s: number, n: number, r: number) {
    const G = (a: number, b: number) => this.V.groundAt(a, b);
    return Math.min(G(s, n), G(s - r, n), G(s + r, n), G(s, n - r), G(s, n + r)) - 0.15;
  }
  // A sign quad at (s, n) facing back down the road (towards the truck) or along it.
  private sign(s: number, n: number, y: number, w: number, hgt: number, uv: ReturnType<SignAtlas["uv"]>, facing = -1) {
    const [x, z, h] = this.L(s, n);
    const dx = Math.cos(h) * facing, dz = -Math.sin(h) * facing;
    this.quads.push({ x: x + dx * 0.08, y, z: z + dz * 0.08, w, h: hgt, rotY: Math.atan2(dx, dz), ...uv });
  }
  private signAt(g: RoadSign, uv: ReturnType<SignAtlas["uv"]>) { this.sign(g.s, g.n, g.y, g.w, g.h, uv); }
  private slot(text: string, style: SignStyle) {
    const k = signAtlas.alloc(text, style);
    if (k < 0) return null;
    this.slots.push(k);
    return signAtlas.uv(k);
  }

  // Drafting a road's map (tools/draftroads.ts): the roadside items are placed by today's rules and
  // recorded here, in place of being drawn from the map's lists.
  record: RoadItems | null = null;
  // Every segment of the road built once with the items placed by the rules, and what was placed.
  recordItems(road: CountryRoad): RoadItems {
    const rec: RoadItems = { trees: [], rocks: [], ponds: [], turbines: [], pylons: [], farms: [], cows: [], poles: [], fences: [] };
    this.setRoad(null); this.record = rec;
    try {
      this.setRoad(road);
      for (let i = 0; i <= Math.floor((road.length - 0.01) / SEG); i++) disposeTree(this.buildSegment(road, i));
    } finally { this.record = null; this.setRoad(null); }
    // (Each kind in order of s, then n.)
    const strides: Record<keyof RoadItems, number> = { trees: 4, rocks: 2, ponds: 2, turbines: 2, pylons: 1, farms: 2, cows: 2, poles: 1, fences: 2 };
    for (const k of Object.keys(strides) as (keyof RoadItems)[]) {
      const st = strides[k], A = rec[k], rows: number[][] = [];
      for (let i = 0; i < A.length; i += st) rows.push(A.slice(i, i + st));
      rows.sort((x, y) => x[0] - y[0] || (x[1] ?? 0) - (y[1] ?? 0));
      rec[k] = rows.flat();
    }
    return rec;
  }
  private buildSegment(road: CountryRoad, i: number): THREE.Group {
    const R = road.geo, s0 = i * SEG, s1 = s0 + SEG, key = R.key, LEN = R.length;
    this.V = R; this.flip = false;
    this.treesHere.length = 0;
    R.center(s0, this.p);
    this.ox = this.p.x; this.oz = this.p.z;
    this.quads = []; this.slots = []; this.ads = false; this.plates = new PlateSet();
    const g = new Batch(), s = new Batch(), glow = this.glow, spins: TurbineSpin[] = [];
    // Land: a mesh over the ground's heights, in rows across the road, coloured by cell: by
    // biome, in bands (fields in farm country), sand and sea on a coast.
    const land = (a: number) => a >= R.landFrom && a <= R.landTo;
    const r0 = Math.max(s0, R.landFrom), r1 = Math.min(s1, R.landTo);
    if (r1 > r0 + 0.01) {
      const rows: number[] = [];
      for (let a = r0; a < r1 - 0.01; a = Math.min(r1, (Math.floor(a / LAND_ROW) + 1) * LAND_ROW)) rows.push(a);
      rows.push(r1);
      // (A tunnel's portals are rows of their own, the land stepping up there from the road to
      // the hill over it: the land just short of the portal ends one quad, just past it starts the next.)
      const cliffs = R.cliffs;
      for (const e of cliffs) if (e > r0 + 0.01 && e < r1 - 0.01 && !rows.includes(e)) rows.push(e);
      rows.sort((x, y) => x - y);
      const portal = (a: number) => cliffs.some((e) => Math.abs(a - e) < 1e-6);
      const cols = [...LAND_N.slice(1).reverse().map((n) => -n), ...LAND_N];
      const rowAt = (a: number) => { const row: number[] = []; for (const n of cols) { const [x, z, , y] = this.L(a, n); row.push(x, y - 0.12, z); } return row; };
      let prev: number[] | null = null;
      for (let ri = 0; ri < rows.length; ri++) {
        const a = rows[ri], cut = portal(a);
        const row = cut ? rowAt(a - 1e-4) : rowAt(a);
        if (prev) {
          const pa = rows[ri - 1], sm = (pa + a) / 2;
          for (let c = 0; c + 1 < cols.length; c++) {
            let color = this.landColor(R, sm, pa, cols[c], cols[c + 1]);
            const A = c * 3, B = (c + 1) * 3;
            // Steep ground (a cutting, a hillside over a portal) is bare rock.
            const ys = [prev[A + 1], prev[B + 1], row[A + 1], row[B + 1]], rise = Math.max(...ys) - Math.min(...ys);
            if (rise > 0.75 * Math.min(cols[c + 1] - cols[c], a - pa) && rise > 1.5) color = shade(CW.rock, 0.92 + 0.16 * hash2(Math.floor(pa), c, key, 0x70c));
            g.tri(prev[A], prev[A + 1], prev[A + 2], prev[B], prev[B + 1], prev[B + 2], row[B], row[B + 1], row[B + 2], color);
            g.tri(prev[A], prev[A + 1], prev[A + 2], row[B], row[B + 1], row[B + 2], row[A], row[A + 1], row[A + 2], color);
          }
          // The sea, level, beyond a coast's beach.
          if (R.coastAt(sm) > 0.5) this.rbox(g, sm, -R.coastSide * (SEA_N - 320) / 2, -0.07, a - pa + 0.4 + Math.abs(R.center(sm, this.p).k) * (a - pa) * 320, 0.1, 320 + SEA_N, CW.water);
        }
        prev = cut ? rowAt(a + 1e-4) : row;
      }
    }
    // The road: asphalt, gravel shoulders, edge lines and the double yellow (dashed while passing
    // is allowed on the straights is overkill at this size: solid).
    // Near a gate it widens to a city street's carriageway, to meet the gate street.
    // (None across a ferry's water: each 6 m piece is cut back to the quays.)
    const Fy = R.ferry;
    for (let a = s0; a < s1 && a < LEN; a += 6) {
      const spans: [number, number][] = !Fy || a + 6.1 <= Fy.q0 || a - 0.1 >= Fy.q1 ? [[a - 0.1, a + 6.1]]
        : [[a - 0.1, Math.min(a + 6.1, Fy.q0)], [Math.max(a - 0.1, Fy.q1), a + 6.1]].filter(([b0, b1]) => b1 - b0 > 0.05) as [number, number][];
      for (const [b0, b1] of spans) {
        const sm = (b0 + b1) / 2, ln = b1 - b0, w = R.widthAt(sm), half = 4.1 + 1.9 * w, gr = R.gradeAt(sm);
        // (Near a Victorian city the road turns to macadam, unpainted, as the period creeps in.)
        const period = R.periodAt(sm), modern = period <= PERIOD_MODERN;
        g.dy = R.heightAt(sm);
        this.rbox(g, sm, 0, -0.064, ln, 0.12, half * 2, period > 0 ? lerpColor(CW.asphalt, CW.macadam, period) : CW.asphalt, 0, gr);   // 4 mm under a city street's asphalt, which it meets at the gate
        for (const k of [-1, 1]) { this.rbox(g, sm, k * (half + 0.9), -0.075, ln, 0.1, 1.8, CW.shoulder, 0, gr); if (modern) this.rbox(g, sm, k * (half - 0.25), 0.005, ln, 0.02, 0.14, CW.white, 0, gr); }
        if (modern && Math.floor(a / 6) % 2 === 0) this.rbox(g, sm, 0, 0.005, Math.max(0.05, ln - 0.2), 0.02, 0.24, CW.yellow, 0, gr);
      }
    }
    g.dy = 0;
    // Into a freeway city by its way in: the freeway, and the flyover the road comes up on
    // (freeway.ts), in 60 m stretches out from the gate end, each drawn with the segment its
    // middle is beside. (Only ever driven from a to b: the map's coordinates are the drive's.)
    if (road.inp.toFreeway) {
      const F = road.freewayFrame!, L = road.gateS;
      for (let d = 0; d < FW_TIP; d += 60) {
        const sc = L - (d + 30);
        if (sc < s0 || sc >= s1) continue;
        buildFreeway(g, F, d, Math.min(FW_TIP, d + 60), this.ox, this.oz, { main: true, ramp: true }, null, this.plates);   // (the ground batch: the truck's see-through spotlight leaves it be)
      }
    }
    // The roadside items: the map's, or (drafting) placed by the rules and recorded.
    const rec = this.record, items = rec ? null : R.map.items;
    // Utility poles on the right, every 50 m where the land is clear, with wires only between two
    // poles. Where the line stops, the wires either end at the last pole or, now and then, have
    // snapped and hang from its crossarm to the ground, the slack lying in the grass. (None where a
    // Victorian city has crept in.)
    const poleSet = items ? this.itemSet(R, "poles", 1, (v) => `${v[0]}`) : null;
    const hasPole = (a: number) => R.periodAt(a) <= PERIOD_MODERN && (poleSet ? poleSet.has(`${Math.round(a * 10)}`)
      : land(a) && (R.clearAt(a, 12) || R.pieces.some((q) => { const p = R.inMap(q); return p.kind === "billboards" && a > p.s - 40 && a < p.s + p.len + 40; })));
    const WIRE = 0x2a2a2a;
    const arm = (a: number, k: number): [number, number] => { const [x, z, h] = this.L(a, 12.5); return [x + Math.sin(h) * k, z + Math.cos(h) * k]; };
    for (let a = Math.ceil(s0 / 50) * 50; a < s1; a += 50) {
      if (!hasPole(a)) continue;
      rec?.poles.push(Math.round(a * 10));
      const [x, z, h, gy] = this.L(a, 12.5);
      s.dy = gy - 0.3;   // (a little into the ground: it stands on a slope)
      s.cyl(x, 4.8, z, 0.14, 9.6, CW.pole, 6); s.dy = gy; s.box(x, 8.4, z, 0.14, 0.14, 2.2, CW.pole, h);
      for (const dir of [1, -1]) {
        const b = a + dir * 50;
        if (dir > 0 && hasPole(b)) {
          const gb = R.groundAt(b, 12.5);
          for (const k of [-0.9, 0.9]) {
            const [ax, az] = arm(a, k), [bx, bz] = arm(b, k);
            this.beam(s, ax, gy + 8.2, az, bx, gb + 8.2, bz, 0.05, 0.05, WIRE);
          }
        } else if (!hasPole(b) && hash3(a, dir, 0, key, 0xd1e) < 0.35) {
          // Broken: each wire drops straight down from its end of the crossarm, and a few metres
          // of it trail off along the line on the ground.
          const fx = Math.cos(h) * dir, fz = -Math.sin(h) * dir;
          for (const k of [-0.9, 0.9]) {
            const [ax, az] = arm(a, k), tail = 2 + hash3(a, dir, k > 0 ? 1 : 2, key, 0x7a1) * 4;
            s.box(ax + fx * 0.05, 4.1, az + fz * 0.05, 0.05, 8.2, 0.05, WIRE, h);
            s.box(ax + fx * (0.05 + tail / 2), 0.03, az + fz * (0.05 + tail / 2), tail, 0.05, 0.05, WIRE, Math.atan2(-fz, fx) + (k > 0 ? 0.15 : -0.1));
          }
        }
      }
    }
    // Fences, by bay (each 6 m).
    const fenceSet = items ? this.itemSet(R, "fences", 2, (v) => `${v[0]}:${v[1]}`) : null;
    for (let a = s0; a < s1; a += 6) for (const side of [-1, 1] as const) if (land(a)) this.fence(s, R, a, side, land, fenceSet);
    // Scenery by biome.
    if (rec) this.placeScenery(R, s0, s1, g, s, spins, land, rec, road);
    else this.drawScenery(R, s0, s1, g, s, spins, road);
    // A ferry's water (in the stretch of it in this segment) and its terminals (each with the
    // segment its quay is in, so neither goes before the truck is well past it). The two are
    // alike, the far one the near one turned half round.
    if (Fy) {
      const w0 = Math.max(s0, Fy.q0), w1 = Math.min(s1, Fy.q1), wy = R.waterY;
      if (w1 > w0) {
        this.rbox(g, (w0 + w1) / 2, 0, wy - 0.05, w1 - w0, 0.1, 2000, CW.water);
        // Wave streaks, lighter and darker, scattered over it (each at a height of its own a
        // few cm up, so no two share a plane where they cross).
        const wr = mulberry32(Math.floor(hash3(i, 0, 11, key, 0x3a7e) * 4294967296));
        const n = Math.round((w1 - w0) * 1.4);
        for (let k = 0; k < n; k++) {
          const a = w0 + 3 + wr() * Math.max(0.1, w1 - w0 - 6), nn = (wr() - 0.5) * 520, ln = 2 + wr() * 6;
          if (Math.abs(nn) < 9 && wr() < 0.8) continue;   // (fewer in the boat's path)
          // (The two colours on heights of their own: one over another of the other colour at
          // the same height flickered.)
          const w = 0.25 + wr() * 0.35, light = wr() < 0.6;
          this.rbox(g, a, nn, wy + 0.02 + (k % 6) * 0.012 + (light ? 0 : 0.006), ln, 0.012, w, light ? 0x5a9ad2 : 0x245f98, (wr() - 0.5) * 0.3);
        }
      }
      for (const q of [Fy.q0, Fy.q1]) if (q >= s0 && q < s1) {
        const draw = () => { const y = this.V.baseAt(Fy.q0); g.dy = s.dy = y; this.ferryNear(g, s, Fy, y); g.dy = s.dy = 0; };
        if (q === Fy.q0) draw(); else this.mirrored(Fy.s + FERRY_LEN / 2, draw);
      }
    }
    // Each piece in its own way's coordinates: one facing b to a is drawn through the road turned
    // half round. (This segment's stretch, s0 to s1, in those coordinates: a0 to a1.)
    const inWay = (p: RoadMapPiece, fn: (a0: number, a1: number) => void) => { if (p.way === 1) fn(s0, s1); else this.mirrored(LEN / 2, () => fn(LEN - s1, LEN - s0)); };
    // The tractor's fields: a fence along the right of its stretch, open at the gate it pulls out
    // of and the one it turns into, each with a track into its field (built per segment: the
    // stretch is long).
    for (const p of R.pieces) if (p.kind === "tractor") inWay(p, (a0, a1) => {
      if (p.s >= a1 || p.s + p.len <= a0) return;
      const ts = p.s + 260, gA = ts - TRACTOR_R + 1, gB = ts + TRACTOR_B + TRACTOR_R - 1, N = 14.6;
      this.railFence(s, Math.max(a0, p.s), Math.min(a1, p.s + p.len) - 0.01, N, [[gA - 3.6, gA + 3.6], [gB - 3.6, gB + 3.6]]);
      for (const ga of [gA, gB]) if (ga >= a0 && ga < a1) {
        g.dy = s.dy = this.V.groundAt(ga, N);
        this.fieldGate(s, ga, N, 3.4);
        this.rbox(g, ga, N + 14, -0.04, 4.2, 0.1, 26, 0x7a6a4a);
        g.dy = s.dy = 0;
      }
    });
    // The pieces' paving: whatever of it lies in this segment, each at its piece's level.
    for (const p of R.pieces) {
      const [g0, g1] = R.groundOf(p);
      if (g1 > s0 && g0 < s1) inWay(p, (a0, a1) => this.pave(g, p, this.V.baseAt(p.s), a0, a1));
    }
    // Set pieces that start in this segment.
    // (Each on the level ground the road holds round it.)
    for (const p of R.pieces) {
      const at = p.way === 1 ? p.s : LEN - p.s;
      if (at < s0 || at >= s1) continue;
      inWay(p, () => {
        const q0 = this.quads.length, y = this.V.baseAt(p.s);
        g.dy = s.dy = glow.dy = y; this.pieceY = y;
        this.piece(g, s, p, road, mulberry32(Math.floor(hash3(Math.floor(p.s), PIECE_KINDS.indexOf(p.kind), p.way, key, 0x9e7) * 4294967296)));
        for (let k = q0; k < this.quads.length; k++) this.quads[k].y += y;
      });
    }
    g.dy = s.dy = glow.dy = 0;
    // Assemble.
    const group = new THREE.Group();
    group.position.set(this.ox, 0, this.oz);
    for (const [b, m] of [[g, this.mats.ground], [s, this.mats.solid], [glow, this.lightMat]] as const) { const mesh = b.build(m); if (mesh) group.add(mesh); }
    let turbines: SegTurbines | null = null;
    if (spins.length) {
      const rotors = new THREE.InstancedMesh(this.rotorGeometry(), this.mats.solid, spins.length);
      const beacons = new THREE.InstancedMesh(this.beaconGeometry(), this.lightMat, spins.length);
      spins.forEach((t, i) => { this.rotorMatrix(t, 0); rotors.setMatrixAt(i, this.m4); beacons.setMatrixAt(i, this.m4.makeTranslation(t.beacon)); });
      // (Bounds for culling, once: each rotor turns about its own centre, inside its sphere.)
      rotors.computeBoundingSphere(); beacons.computeBoundingSphere(); beacons.visible = false;
      group.add(rotors, beacons);
      group.userData.turbines = turbines = { spins, rotors, beacons };
    }
    const slots = this.slots;
    let sm: SignMesh | null = null;
    if (this.quads.length) {
      const mesh = new THREE.Mesh(quadGeometry(this.quads), signAtlas.material);
      group.add(mesh); sm = signAtlas.attach(mesh, slots, this.ads);
    }
    for (const f of this.fleetJobs) { const o = this.fleet?.(f.stalls); if (o) { o.position.y += f.y; group.add(o); } }
    this.fleetJobs = [];
    const pm = this.plates.build(); if (pm) group.add(pm.mesh);
    const hf = OCCLUSION.add(group, this.ox + this.group.position.x, this.oz + this.group.position.z, [this.mats.ground], "road");   // for the camera (occlusion.ts)
    group.userData.onDispose = () => { for (const k of slots) signAtlas.release(k); if (sm) signAtlas.detach(sm); pm?.dispose(); OCCLUSION.remove(hf); turbines?.rotors.dispose(); turbines?.beacons.dispose(); };
    return group;
  }
  // A map's items of one kind as a set of keys (kept per map).
  private itemSets = new WeakMap<object, Map<string, Set<string>>>();
  private itemSet(R: RoadGeo, kind: keyof RoadItems, stride: number, keyOf: (v: number[]) => string) {
    let m = this.itemSets.get(R.map);
    if (!m) this.itemSets.set(R.map, m = new Map());
    let set = m.get(kind);
    if (!set) {
      set = new Set();
      const A = R.map.items[kind];
      for (let i = 0; i < A.length; i += stride) set.add(keyOf(A.slice(i, i + stride)));
      m.set(kind, set);
    }
    return set;
  }
  // The items of one kind (stride numbers each, s first in decimetres) from s0 to s1.
  private *itemsIn(A: number[], stride: number, s0: number, s1: number) {
    let lo = 0, hi = A.length / stride;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (A[mid * stride] < s0 * 10) lo = mid + 1; else hi = mid; }
    for (let i = lo * stride; i < A.length && A[i] < s1 * 10; i += stride) yield i;
  }
  // An item's own draws (its shape and colours), from its place.
  private itemRnd(sdm: number, ndm: number, salt: number, key: number) { return mulberry32(Math.floor(hash3(sdm, ndm, salt, key, 0x17e) * 4294967296)); }

  // The roadside scenery by today's rules, recorded (drafting): what drawScenery draws from a map.
  private placeScenery(R: RoadGeo, s0: number, s1: number, g: Batch, s: Batch, spins: TurbineSpin[], land: (a: number) => boolean, rec: RoadItems, road: CountryRoad) {
    const key = R.key, rnd = mulberry32(Math.floor(hash3(Math.floor(s0 / SEG), 0, 7, key, 0x5e9) * 4294967296));
    const dm = (x: number) => Math.round(x * 10);
    for (let a = s0; a < s1; a += 6) for (const side of [-1, 1] as const) {
      if (!land(a)) continue;
      const bio = this.look(R, a, side * 40);
      const tries = bio.density * 2.2;
      for (let t = 0; t < tries; t++) {
        if (rnd() > tries - t) break;
        const n = dm(side * (15 + Math.pow(rnd(), 0.8) * (SIDE_W - 20))) / 10;
        if (bio.water && side === R.coastSide && Math.abs(n) > 55) continue;
        const sa = Math.min(dm(a + rnd() * 6), dm(a + 5.9)) / 10;
        if (!R.clearAt(sa, n)) continue;
        const kind = bio.trees[Math.floor(rnd() * bio.trees.length)], greens = CGREEN.has(kind) ? bio.cgreens : bio.greens, green = Math.floor(rnd() * greens.length);
        if (this.drawTree(R, s, sa, n, TREE_KINDS.indexOf(kind), green)) rec.trees.push(dm(sa), dm(n), TREE_KINDS.indexOf(kind), green);
      }
      if (rnd() < bio.rocks * 0.25) {
        const n = dm(side * (13 + rnd() * 120)) / 10, sa = dm(a + rnd() * 6) / 10;
        if (R.clearAt(sa, n)) { rec.rocks.push(dm(sa), dm(n)); this.drawRock(R, s, sa, n); }
      }
      if (bio.ponds && rnd() < 0.02) {
        const n = dm(side * (40 + rnd() * 90)) / 10, sa = dm(a + rnd() * 6) / 10;
        if (R.clearAt(sa, n)) { rec.ponds.push(dm(sa), dm(n)); this.drawPond(R, g, s, sa, n); }
      }
      if (bio.turbines && Math.floor(a / 6) % 25 === 0 && side > 0) {
        const n = dm(70 + rnd() * 70) / 10;
        if (R.clearAt(a, n)) { rec.turbines.push(dm(a), dm(n)); this.drawTurbine(R, s, a, n, spins, road); }
      }
      if (bio.pylons && Math.floor(a / 6) % 30 === 0 && side < 0) { rec.pylons.push(dm(a)); this.drawPylon(R, s, a); }
      if (bio.barns && Math.floor(a / 6) % 60 === 17 && rnd() < 0.7) {
        const n = dm(side * (45 + rnd() * 50)) / 10;
        if (R.clearAt(a, n)) { rec.farms.push(dm(a), dm(n)); this.drawFarm(R, s, a, n); }
      }
      if (bio.cows && rnd() < 0.05) {
        const n = dm(side * (25 + rnd() * 60)) / 10;
        if (R.clearAt(a, n)) { rec.cows.push(dm(a), dm(n)); this.drawCows(R, s, a, n); }
      }
    }
  }
  // The map's roadside items from s0 to s1.
  private drawScenery(R: RoadGeo, s0: number, s1: number, g: Batch, s: Batch, spins: TurbineSpin[], road: CountryRoad) {
    const I = R.map.items;
    for (const i of this.itemsIn(I.trees, 4, s0, s1)) this.drawTree(R, s, I.trees[i] / 10, I.trees[i + 1] / 10, I.trees[i + 2], I.trees[i + 3]);
    for (const i of this.itemsIn(I.rocks, 2, s0, s1)) this.drawRock(R, s, I.rocks[i] / 10, I.rocks[i + 1] / 10);
    for (const i of this.itemsIn(I.ponds, 2, s0, s1)) this.drawPond(R, g, s, I.ponds[i] / 10, I.ponds[i + 1] / 10);
    for (const i of this.itemsIn(I.turbines, 2, s0, s1)) this.drawTurbine(R, s, I.turbines[i] / 10, I.turbines[i + 1] / 10, spins, road);
    for (const i of this.itemsIn(I.pylons, 1, s0, s1)) this.drawPylon(R, s, I.pylons[i] / 10);
    for (const i of this.itemsIn(I.farms, 2, s0, s1)) this.drawFarm(R, s, I.farms[i] / 10, I.farms[i + 1] / 10);
    for (const i of this.itemsIn(I.cows, 2, s0, s1)) this.drawCows(R, s, I.cows[i] / 10, I.cows[i + 1] / 10);
  }
  // A tree of kind TREE_KINDS[kind] at (sa, n), its green the green'th of its land's there.
  // (False if it stood too close to one already in the segment: tree.)
  private drawTree(R: RoadGeo, s: Batch, sa: number, n: number, kind: number, green: number) {
    const bio = this.look(R, Math.floor(sa / 6) * 6, Math.sign(n) * 40), k = TREE_KINDS[kind], greens = CGREEN.has(k) ? bio.cgreens : bio.greens;
    const [x, z, , gy] = this.L(sa, n);
    s.dy = gy - 0.25;
    return this.tree(s, x, z, k, greens[green % greens.length], this.itemRnd(Math.round(sa * 10), Math.round(n * 10), 1, R.key));
  }
  private drawRock(R: RoadGeo, s: Batch, sa: number, n: number) {
    const r = this.itemRnd(Math.round(sa * 10), Math.round(n * 10), 2, R.key), [x, z, , gy] = this.L(sa, n), rad = 0.5 + r() * 1.6;
    s.dy = gy; s.ico(x, rad * 0.3, z, rad, r() < 0.5 ? 0x8a8478 : 0x9a8a72, 0.6, r() * 6);
  }
  private drawPond(R: RoadGeo, g: Batch, s: Batch, sa: number, n: number) {
    const r = this.itemRnd(Math.round(sa * 10), Math.round(n * 10), 3, R.key), [x, z, h] = this.L(sa, n);
    g.dy = s.dy = this.foot(sa, n, 14) + 0.15; g.box(x, -0.06, z, 18 + r() * 20, 0.1, 10 + r() * 14, CW.water, h + r());
    for (let k = 0; k < 6; k++) s.box(x + (r() - 0.5) * 20, 0.5, z + (r() - 0.5) * 14, 0.15, 1, 0.15, 0x7a8a3a);
    g.dy = 0;
  }
  // A wind turbine, facing the wind, the same way all along the drive (windYaw). In a breeze it
  // turns, 9 to 17 rpm with the wind (each a little different); in a calm, or one in a dozen
  // stopped for service, it stands still. (Its speed is the drive's.)
  // (None, nor a pylon, where a Victorian city has crept in.)
  private drawTurbine(R: RoadGeo, s: Batch, sa: number, n: number, spins: TurbineSpin[], road: CountryRoad) {
    if (R.periodAt(sa) > PERIOD_MODERN) return;
    const r =this.itemRnd(Math.round(sa * 10), Math.round(n * 10), 4, R.key), ph = r() * 6.3;
    const [x, z, h] = this.L(sa, n), c = R.climateAt(sa, n), wind = this.windIn(road, c), yaw = this.windYaw(road);
    const tk = Math.floor(sa / 6), stopped = hash3(tk, road.inp.city, 7, road.inp.driveSeed, 0x3ab3) < 0.08;
    const rpm = wind < 0.3 || stopped ? 0 : (9 + 8 * Math.min(1, (wind - 0.3) / 0.6)) * (0.94 + 0.12 * hash3(tk, road.inp.city, 8, road.inp.driveSeed, 0x3ab4));
    // (The transformer stands on the ground at its own spot, beside the tower's foot.)
    const [bx, bz] = TURBINE_BOX, cy = Math.cos(yaw), sy = Math.sin(yaw), dx = cy * bx + sy * bz, dz = -sy * bx + cy * bz;
    const bs = sa + dx * Math.cos(h) - dz * Math.sin(h), bn = n + dx * Math.sin(h) + dz * Math.cos(h);
    s.dy = this.foot(sa, n, 3.5); this.turbine(s, x, z, yaw, rpm * Math.PI / 30, ph, spins, this.foot(bs, bn, 1) - s.dy);
  }
  private drawPylon(R: RoadGeo, s: Batch, a: number) { if (R.periodAt(a) > PERIOD_MODERN) return; const [x, z, h] = this.L(a, -60); s.dy = this.foot(a, -60, 2); this.pylon(s, x, z, h); }
  private drawFarm(R: RoadGeo, s: Batch, a: number, n: number) { const [x, z, h] = this.L(a, n); s.dy = this.foot(a, n, 9); this.farm(s, x, z, h, this.itemRnd(Math.round(a * 10), Math.round(n * 10), 5, R.key), R.periodAt(a) > PERIOD_MODERN); }
  private drawCows(R: RoadGeo, s: Batch, a: number, n: number) {
    const r = this.itemRnd(Math.round(a * 10), Math.round(n * 10), 6, R.key), [x, z, , gy] = this.L(a, n);
    s.dy = gy - 0.1; for (let c = 0; c < 3; c++) this.cow(s, x + (r() - 0.5) * 12, z + (r() - 0.5) * 12, r() * 6.3);
  }
  private fleetJobs: { stalls: StallPose[]; y: number }[] = [];
  private pieceY = 0;
  private glow = new Batch();   // lamps that are always lit (a tunnel's), in the segment being built
  private plates = new PlateSet();   // the freeway's signs, in the segment being built

  // A cell of land between n0 and n1 across the road, at sm along it (its row starting at a):
  // the biome's ground in hashed bands, or a patchwork of fields (whole columns, 96 m long); sand
  // and sea on a coast.
  private landColor(road: RoadGeo, sm: number, a: number, n0: number, n1: number) {
    const nm = (n0 + n1) / 2, side = nm < 0 ? -1 : 1, an = Math.abs(nm), seed = road.key;
    const bio = this.look(road, sm, side * 50);
    if (side === road.coastSide && road.coastAt(sm) > 0.5) { if (-an < SEA_N) return CW.water; if (-an < COAST_N) return CW.sand; }
    if (an > SIDE_W) return bio.ground;
    if (bio.fields) {
      if (an < 14) return bio.ground;
      const f = Math.floor(hash3(Math.floor(a / 96), Math.floor(an / 20), side, seed, 0xf1e) * 97);
      return bio.fields[f % bio.fields.length];
    }
    const band = Math.min(3, Math.floor(an / (SIDE_W / 4)));
    return hash3(Math.floor((a + band * 17) / 36), band, side, seed, 0x6a) < 0.6 ? bio.ground : bio.ground2;
  }

  // ---- scenery ------------------------------------------------------------------------------
  // (Not within 1.6 m of a tree already in this segment: trees placed at random stood in each other,
  // their faces sharing planes.)
  // (Nor with its crown's underside within a hair of one near enough that their crowns overlap:
  // they would share a plane, and flicker.)
  private treesHere: number[] = [];
  private tree(s: Batch, x: number, z: number, kind: string, green: number, rnd: Rand) {
    const T = this.treesHere, near: number[] = [];
    for (let i = 0; i < T.length; i += 3) {
      const d = Math.hypot(T[i] - x, T[i + 1] - z);
      if (d < 1.6) return false;
      if (d < 5) near.push(T[i + 2]);
    }
    T.push(x, z, landTree(s, x, z, kind, green, rnd, near));
    return true;
  }
  // A post-and-rail fence along the land, 14.5 m out, in 6 m bays: bay i runs from 6i to 6i + 6.
  // Whether a bay stands is hashed from its index, so a segment can see its neighbours' bays and
  // every rail ends on a post. Now and then a bay has come down: its top rail has dropped to the
  // ground at one end and its lower rail lies in the grass, and at the end of a run the post that
  // held them lies beside its stump.
  private fence(s: Batch, road: RoadGeo, a: number, side: -1 | 1, land: (a: number) => boolean, bays: Set<string> | null) {
    const N = side * 14.5, seed = road.key, city = 0;
    const bay = (i: number) => {
      if (bays) return bays.has(`${i * 60}:${side}`);
      const b0 = i * 6, b1 = b0 + 6;
      return land(b0) && land(b1) && !!this.look(road, b0, side * 40).fence && road.clearAt(b0, side * 14) && road.clearAt(b1, side * 14)
        && hash3(i, side, city, seed, 0xfe1) < 0.5;
    };
    const broken = (i: number) => hash3(i, side, city, seed, 0xb70) < 0.05;
    const i = Math.round(a / 6);
    const prev = bay(i - 1), here = bay(i), next = here && bay(i + 1);
    if (here && !bays) this.record?.fences.push(i * 60, side);
    // A broken bay at the end of a run loses its free post; a broken bay inside a run hangs from
    // its posts. Which end gives way: the free one, else a coin toss.
    const dropsAt = (j: number, startFree: boolean, endFree: boolean) =>
      endFree ? 1 : startFree ? 0 : hash3(j, side, city, seed, 0xe9d) < 0.5 ? 0 : 1;
    // The post at a (the end of bay i - 1 and the start of bay i).
    if (prev || here) {
      const fallen = prev !== here && (prev ? broken(i - 1) : broken(i) && next);   // a run's end post, of a broken bay that drops there
      const [x, z, h, gy] = this.L(a, N);
      s.dy = gy;
      if (!fallen) s.box(x, 0.5, z, 0.12, 1.4, 0.12, CW.wood, h);   // (its foot a little in the ground)
      else {
        const t = hash3(i, side, city, seed, 0xfa1) - 0.5, dx = Math.sin(h + t) * side, dz = Math.cos(h + t) * side;
        s.box(x, 0.12, z, 0.12, 0.24, 0.12, CW.wood, h);                                          // the snapped stump
        s.box(x + dx * 0.65, 0.07, z + dz * 0.65, 1.0, 0.12, 0.12, CW.wood, Math.atan2(-dz, dx));   // the post, lying out from it
      }
    }
    if (!here) return;
    const [x0, z0, , g0] = this.L(a, N), [x1, z1, , g1] = this.L(a + 6, N);
    const yaw = Math.atan2(-(z1 - z0), x1 - x0), len = Math.hypot(x1 - x0, z1 - z0);
    if (!broken(i)) {
      for (const y of [0.85, 0.45]) this.beam(s, x0, g0 + y, z0, x1, g1 + y, z1, 0.08, 0.06, CW.wood);
      return;
    }
    s.dy = (g0 + g1) / 2;
    const end = dropsAt(i, !prev, !next);
    // The top rail, still nailed at the far end from `end`, its loose end on the ground.
    const [ax, az, bx, bz] = end ? [x0, z0, x1, z1] : [x1, z1, x0, z0];
    const drop = 0.8, run = Math.sqrt(len * len - drop * drop), ux = (bx - ax) / len, uz = (bz - az) / len;
    const ex = ax + ux * run, ez = az + uz * run;
    s.boxR((ax + ex) / 2, 0.85 - drop / 2, (az + ez) / 2, len, 0.08, 0.06, CW.wood, 0, Math.atan2(-uz, ux), -Math.atan2(drop, run));
    // The lower rail, lying in the grass just beyond the line, a little askew.
    const [, , h] = this.L(a + 3, N), ox = Math.sin(h) * side * 0.35, oz = Math.cos(h) * side * 0.35;
    s.box((x0 + x1) / 2 + ox, 0.04, (z0 + z1) / 2 + oz, len * 0.96, 0.06, 0.08, CW.wood, yaw + (hash3(i, side, city, seed, 0x10e) - 0.5) * 0.2);
  }
  // A wind turbine (turbineTower) facing `yaw`; its rotor (turbineRotor, one geometry shared by
  // all of them, instanced per segment) and beacon in `out`, the rotor turning at w rad/s from
  // phase ph (or still, in a calm or stopped).
  private turbine(s: Batch, x: number, z: number, yaw: number, w: number, ph: number, out: TurbineSpin[], boxY = 0) {
    const n0 = s.mark(), dy = s.dy;
    turbineTower(s, boxY);
    s.transformFrom(n0, { ox: x, oz: z, rot: yaw });
    const pivot = new THREE.Object3D();
    turbineRotorAt(pivot, x, dy, z, yaw); pivot.updateMatrix();
    const [bx, by, bz] = TURBINE_BEACON, c = Math.cos(yaw), sn = Math.sin(yaw);
    out.push({ at: pivot.matrix.clone(), w, ph, beacon: new THREE.Vector3(x + c * bx + sn * bz, dy + by, z - sn * bx + c * bz) });
  }
  private beaconGeo: THREE.BufferGeometry | null = null;
  private beaconGeometry() {
    if (!this.beaconGeo) { const b = new Batch(); b.box(0, 0, 0, 0.45, 0.35, 0.45, 0xff2a18); this.beaconGeo = b.build(this.lightMat)!.geometry; this.beaconGeo.userData.shared = true; }
    return this.beaconGeo;
  }
  private rotorGeo: THREE.BufferGeometry | null = null;
  private rotorGeometry() {
    if (!this.rotorGeo) {
      const b = new Batch(); turbineRotor(b); const g = this.rotorGeo = b.build(this.mats.solid)!.geometry; g.userData.shared = true;
      // (Its bounds on its axis, round every vertex: the same however far it has turned, as the
      // segment's instanced rotors keep the bounds they were built with. Centred on its box, they
      // were three blades' box, off the axis, and a tip turned away from it went outside.)
      g.computeBoundingBox(); const c = new THREE.Vector3(0, (g.boundingBox!.min.y + g.boundingBox!.max.y) / 2, 0), pos = g.attributes.position, v = new THREE.Vector3();
      let r = 0; for (let i = 0; i < pos.count; i++) r = Math.max(r, v.fromBufferAttribute(pos, i).distanceTo(c));
      g.boundingSphere = new THREE.Sphere(c, r);
    }
    return this.rotorGeo;
  }
  // Which way the turbines face this drive (their rotors' fronts, into the wind): one way for
  // the whole drive, as one wind blows over it, chosen across the road's overall direction (its
  // ends' chord) towards it from the right, where they stand, and turned by up to 30 degrees, so
  // from the road the rotors are mostly seen face on, more side on round the bends.
  private windFor: CountryRoad | null = null; private windYawV = 0;
  private windYaw(road: CountryRoad) {
    if (this.windFor !== road) {
      road.point(road.landFrom, 0, this.q); const x0 = this.q.x, z0 = this.q.z;
      road.point(road.landTo, 0, this.q);
      const H = Math.atan2(-(this.q.z - z0), this.q.x - x0);
      this.windFor = road; this.windYawV = H + Math.PI / 2 + (hash2(road.inp.city, 5, road.inp.driveSeed, 0x3ab2) - 0.5) * 1.05;
    }
    return this.windYawV;
  }
  // How windy it is in a climate, this drive (0 calm .. 1 a gale): by the weather, and a draw of
  // its own for each place (a clear day may be breezy or still; fog comes with still air).
  private windIn(road: CountryRoad, c: Climate) {
    const base = { clear: 0.45, cloudy: 0.6, overcast: 0.6, rain: 0.7, storm: 1.0, snow: 0.55, fog: 0.08 }[c.weather];
    const r = hash3(road.inp.city, c === road.inp.fromClimate ? 0 : 1, 3, road.inp.driveSeed, 0x3ab1);
    return THREE.MathUtils.clamp(base * (0.25 + r * 1.1), 0, 1);
  }
  private pylon(s: Batch, x: number, z: number, h: number) {
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.boxR(x + dx * 1.6, 9, z + dz * 1.6, 0.25, 18.5, 0.25, 0x9aa0a6, dz * 0.08, 0, -dx * 0.08);
    s.box(x, 18, z, 0.6, 0.5, 9, 0x9aa0a6, h); s.box(x, 14, z, 0.5, 0.4, 7, 0x9aa0a6, h); s.cone(x, 20, z, 1.2, 3, 0x9aa0a6, 4);
  }
  // (`period`: near a Victorian city, no steel silo, and hayricks in place of round bales.)
  private farm(s: Batch, x: number, z: number, h: number, rnd: Rand, period = false) {
    const c = Math.cos(h), sn = Math.sin(h);
    const at = (a: number, n: number): [number, number] => [x + c * a + sn * n, z - sn * a + c * n];
    let [bx, bz] = at(0, 0);
    s.box(bx, 3, bz, 12, 6, 9, 0xa83a2a, h); s.prism(bx, 7.2, bz, 12.4, 2.6, 9.6, 0x4a4f57, h);
    s.box(bx + Math.sin(h) * 4.55, 2, bz + Math.cos(h) * 4.55, 3.4, 4, 0.1, 0xf2ede0, h);
    [bx, bz] = at(9, 2);
    if (!period) { s.cyl(bx, 6, bz, 2.4, 12, 0xb8bcc0, 10); s.cone(bx, 12.8, bz, 2.5, 1.8, 0x8a9096, 10); }
    if (rnd() < 0.7) { [bx, bz] = at(-14, -4); s.box(bx, 2.2, bz, 8, 4.4, 6, 0xf2ede0, h); s.prism(bx, 5.4, bz, 8.4, 2, 6.6, 0x5b6470, h); }
    for (let k = 0; k < 4; k++) {
      [bx, bz] = at(-4 + k * 3.2, 10 + rnd() * 6);
      if (period) { if (k % 2 === 0) { s.cyl(bx, 1.0, bz, 1.5, 2.0, 0xc8a850, 8); s.cone(bx, 2.8, bz, 1.8, 1.8, 0xb89a48, 8); } }
      else s.cyl(bx, 0.7, bz, 0.7, 1.2, 0xd6b85a, 10, Math.PI / 2, h);
    }
  }
  private cow(s: Batch, x: number, z: number, h: number) {
    s.box(x, 0.95, z, 1.8, 0.8, 0.7, 0xf2f2ee, h); s.box(x + Math.cos(h) * 0.3, 1.0, z - Math.sin(h) * 0.3, 0.6, 0.6, 0.72, 0x222222, h);
    s.box(x + Math.cos(h) * 1.05, 1.2, z - Math.sin(h) * 1.05, 0.45, 0.45, 0.4, 0x222222, h);
    for (const a of [-0.65, 0.65]) for (const n of [-0.25, 0.25]) s.box(x + Math.cos(h) * a + Math.sin(h) * n, 0.3, z - Math.sin(h) * a + Math.cos(h) * n, 0.14, 0.6, 0.14, 0xe8e8e0, h);
  }

  // ---- set pieces ---------------------------------------------------------------------------
  // A piece's paving (country.ts piecePaving) within this segment (s0..s1): each band in quads
  // between its stations (cut to 8 m at most, so it follows the road's curve), its top at its
  // height over the piece's ground (y0), with a skirt down its edges to the land under it. (Laid
  // segment by segment, like the road, so a long slip lane comes and goes with the land under it.)
  private pave(g: Batch, p: RoadPiece, y0: number, s0: number, s1: number) {
    const COL = { drive: CW.asphalt, apron: CW.asphalt, lot: 0x45464b, gravel: 0x8f8778 };
    for (const v of piecePaving(p)) {
      const V0 = v.s[0], V1 = v.s[v.s.length - 1], a0 = Math.max(s0, V0), a1 = Math.min(s1, V1);
      if (a1 - a0 < 1e-6) continue;
      const y = y0 + v.top, col = COL[v.kind], sk = shade(col, 0.8), sd = v.side;
      const cuts = [a0, ...v.s.filter((a) => a > a0 + 1e-6 && a < a1 - 1e-6), a1], st: number[] = [];
      for (let i = 0; i + 1 < cuts.length; i++) {
        const k = Math.max(1, Math.ceil((cuts[i + 1] - cuts[i]) / 8));
        for (let j = 0; j < k; j++) st.push(cuts[i] + (cuts[i + 1] - cuts[i]) * j / k);
      }
      st.push(a1);
      const edge = st.map((a) => { const [lo, hi] = paveAt(v, a)!; return [this.L(a, sd * lo), this.L(a, sd * hi), lo, hi] as const; });
      for (let i = 0; i + 1 < edge.length; i++) {
        const [l0, h0, lo0, hi0] = edge[i], [l1, h1, lo1, hi1] = edge[i + 1];
        if (hi0 - lo0 > 1e-3) g.tri(l0[0], y, l0[1], h0[0], y, h0[1], h1[0], y, h1[1], col);
        if (hi1 - lo1 > 1e-3) g.tri(l0[0], y, l0[1], h1[0], y, h1[1], l1[0], y, l1[1], col);
        // The skirts: down from both edges, facing out (away from the other edge). (A drive's at its
        // edges, anything else's a cm in under its top: where a drive and a lot run along the same
        // edge, their skirts shared a plane and flickered.)
        for (const [a0, b0, o] of [[l0, l1, h0], [h0, h1, l0]] as const) {
          const fx = (a0[0] + b0[0]) / 2 - o[0], fz = (a0[1] + b0[1]) / 2 - o[1], fl = Math.hypot(fx, fz);
          if (fl < 1e-3) continue;
          const d = v.kind === "drive" ? 0 : Math.min(0.01, fl / 4), ix = -fx / fl * d, iz = -fz / fl * d;
          const a = [a0[0] + ix, a0[1] + iz], b = [b0[0] + ix, b0[1] + iz];
          g.tri(a[0], y, a[1], b[0], y, b[1], b[0], y - 0.14, b[1], sk, [fx, 0, fz]);
          g.tri(a[0], y, a[1], b[0], y - 0.14, b[1], a[0], y - 0.14, a[1], sk, [fx, 0, fz]);
        }
      }
      // And across its ends, where it has width there (its own ends, not where a segment cuts it).
      for (const [i, j, own] of [[0, 1, a0 === V0], [edge.length - 1, edge.length - 2, a1 === V1]] as const) {
        const [l, h, lo, hi] = edge[i], o = edge[j][0];
        if (!own || hi - lo < 1e-3) continue;
        const fx = (l[0] + h[0]) / 2 - o[0], fz = (l[1] + h[1]) / 2 - o[1];
        g.tri(l[0], y, l[1], h[0], y, h[1], h[0], y - 0.14, h[1], sk, [fx, 0, fz]);
        g.tri(l[0], y, l[1], h[0], y - 0.14, h[1], l[0], y - 0.14, l[1], sk, [fx, 0, fz]);
      }
    }
  }
  // A big overhead-height highway sign on two posts (big enough to read across the room).
  private greenSign(s: Batch, p: RoadPiece, text: string) {
    // (A Victorian city's, welcoming, leaving and the distance out of it, are cast-iron finger
    // posts, their arms lettered black on white: the town's name, its borough's bounds, or the
    // next town and the miles to it.)
    if (p.variant === 2) {
      const g = pieceSigns(p)[0], reach = 2.3, [x, z, h] = this.L(p.s - 0.05, g.n + reach), [rx, rz] = this.L(p.s - 0.05, g.n);
      vicFingerPost(s, x, z, 0, -Math.cos(h), Math.sin(h), rx - x, rz - z, g.y, g.w, g.h, reach);
      const words = p.kind === "welcome" ? text.replace(/^WELCOME TO /, "") : p.kind === "leave" ? `BOROUGH OF ${text.replace(/^LEAVING /, "")}` : text;
      const uv = this.slot(words, { bg: "#ece4cc", fg: "#1c1d20", logo: false });
      // (Lettered on both faces, as a finger post is: the drive the other way passes its back.)
      if (uv) { this.signAt(g, uv); this.sign(g.s - 0.06, g.n, g.y, g.w, g.h, uv, 1); }
      return;
    }
    // (The storybook city's own signs, welcoming and leaving, are magenta, edged in butter, on striped posts.)
    if ((p.kind === "welcome" || p.kind === "leave") && p.variant === 1) {
      const n = p.n ?? 11, uv = this.slot(text, { bg: "#d83a9a", fg: "#fff3dc", logo: false });
      for (const k of [-5.4, 5.4]) for (let i = 0; i < 10; i++) this.rbox(s, p.s + 0.27, n + k, 0.64 * (i + 0.5), 0.26 - (i % 2) * 0.02, 0.64, 0.26 - (i % 2) * 0.02, i % 2 ? 0xffffff : 0xe8333a);
      this.rbox(s, p.s + 0.08, n, 5.2, 0.1, 2.6, 13.4, 0xd83a9a);
      this.rbox(s, p.s + 0.08, n, 5.2, 0.08, 2.75, 13.6, 0xfbe58a);
      if (uv) this.signAt(pieceSigns(p)[0], uv);
      return;
    }
    const n = p.n ?? 11, uv = this.slot(text, { bg: "#1e6b3a", fg: "#ffffff", logo: false });
    for (const k of [-5.4, 5.4]) this.rbox(s, p.s + 0.27, n + k, 3.2, 0.25, 6.4, 0.25, 0x8d9296);   // behind the board
    this.rbox(s, p.s + 0.08, n, 5.2, 0.1, 2.6, 13.4, CW.green);
    this.rbox(s, p.s + 0.08, n, 5.2, 0.08, 2.75, 13.6, 0xf2f2ee);   // white border (its faces inside the board's: shared planes flicker)
    if (uv) this.signAt(pieceSigns(p)[0], uv);
  }

  private piece(g: Batch, s: Batch, p: RoadMapPiece, road: CountryRoad, rnd: Rand) {
    const S = p.s, side = p.side;
    // (A sign that faces both ways: drawn again turned half round about the piece's middle.)
    const both = (fn: () => void) => { fn(); if (TWO_WAY_SIGNS.has(p.kind)) this.mirrored(S + p.len / 2, fn); };
    switch (p.kind) {
      case "leave": case "distance": case "welcome": this.greenSign(s, p, p.text ?? ""); break;
      case "billboards": {
        if (this.V.periodAt(S) > PERIOD_MODERN) break;   // (the road's maps have none there: roadgen.ts)
        both(() => {
          for (let k = 0; k < 3; k++) {
            const a = S + 30 + k * 110, n = (k % 2 ? -1 : 1) * 22, sd = Math.sign(n);
            const pool = [...AD_BILLBOARD, ...AD_BATON, ...AD_BATON, ...AD_RYDER];
            const ad = pool[Math.floor(hash2(k + (this.flip ? 3 : 0), Math.floor(S), this.geo!.key, 0xad) * pool.length)];
            for (const d of [-3, 3]) this.rbox(s, a + 0.51, n + d * sd, 3.2, 0.3, 6.4, 0.3, 0x5a5f66);   // behind the board
            this.rbox(s, a + 0.2, n, 9.0, 0.3, 5.4, 15.4, 0x2a2b2e);
            this.rbox(s, a + 0.5, n, 6.3, 0.15, 0.15, 15, 0x5a5f66);   // catwalk
            const b = pieceSigns(p)[k], [x, z, h] = this.L(b.s, b.n);
            this.quads.push({ x, y: b.y, z, w: b.w, h: b.h, rotY: Math.atan2(-Math.cos(h), Math.sin(h)), ...signAtlas.adUV(ad) });
            this.ads = true;
          }
        });
        break;
      }
      case "truckstop": {
        // The apron lane beside the road, the store and canopy beyond it, Ryder trucks in the lot.
        // (Its apron and lots, and the drives off the road at either end: piecePaving, laid per segment.)
        for (let a = S - 100; a < S + 140; a += 6) this.rbox(g, a + 3, 24.6, 0.015, 3, 0.02, 0.14, CW.white);   // the apron's lane line
        this.rbox(s, S + 70, 45, 2.6, 22, 5.2, 10, 0xe8e2d6); this.rbox(s, S + 70, 39.9, 2.0, 21, 4, 0.1, 0x2a3440);
        this.rbox(s, S + 70, 45, 5.5, 22.6, 0.6, 10.6, CW.ryder);
        const uv = this.slot("RYDER TRUCK STOP", { bg: "#ce1126", fg: "#ffffff", logo: true });
        if (uv) { const [x, z, h] = this.L(S + 70, 39.6); this.quads.push({ x, y: 5.5, z, w: 9.6, h: 1.2, rotY: Math.atan2(-Math.sin(h), -Math.cos(h)), ...uv }); }
        // The tall sign at the road, readable from the approach.
        this.rbox(s, S - 59.24, TS_SIGN_N, 7, 0.6, 14, 0.6, 0x5a5f66);   // behind the board
        this.rbox(s, S - 59.7, TS_SIGN_N, 14.2, 0.3, 2.2, 9.4, CW.ryder);
        const uv2 = this.slot("RYDER TRUCK STOP", { bg: "#ce1126", fg: "#ffffff", logo: true });
        if (uv2) this.signAt(pieceSigns(p)[0], uv2);
        // Canopy and pumps.
        for (const a of [S + 10, S + 30]) for (const n of [31, 41]) this.rbox(s, a, n, 2.6, 0.4, 5.2, 0.4, 0xdedbd0);
        this.rbox(s, S + 20, 36, 5.4, 26, 0.6, 14, 0xf2f2ee); this.rbox(s, S + 20, 36, 5.0, 26.02, 0.3, 14.2, CW.ryder);   // (a cm round the fascia's ends too: shared planes flicker)
        for (const a of [S + 14, S + 26]) this.rbox(s, a, 36, 0.8, 1.0, 1.6, 0.8, 0x5a5f66);
        const stalls: StallPose[] = [];
        for (let k = 0; k < 3; k++) {
          const [x, z, h] = this.L(S + 95 + k * 9, 59);
          stalls.push({ model: (["box26", "box16", "tractor"] as TruckModel[])[k], x, z, h: h + Math.PI / 2, toon: this.V.storyAt(S + 95 + k * 9), carriage: carriageAt(this.V.periodAt(S + 95 + k * 9)) });
        }
        this.fleetJobs.push({ stalls, y: this.pieceY });
        break;
      }
      case "rail": {
        // Tracks across the road and the land, crossbucks and the gate posts.
        const [x, z, h] = this.L(S, 0);
        const ax = Math.sin(h), az = Math.cos(h);   // along the track
        g.box(x, -0.07, z, 4.2, 0.14, 2 * SIDE_W + 60, 0x8a8478, h);
        for (let n = -SIDE_W - 30; n < SIDE_W + 30; n += 0.9) s.box(x + ax * n, 0.04, z + az * n, 2.6, 0.08, 0.25, 0x5a4636, h);
        for (const k of [-0.72, 0.72]) s.box(x + Math.cos(h) * k, 0.12, z - Math.sin(h) * k, 0.1, 0.12, 2 * SIDE_W + 60, 0x9a9ea2, h);
        for (const [ds, sd] of [[-7, 1], [7, -1]] as const) {
          const [px, pz] = this.L(S + ds, sd * 6.6);
          s.cyl(px, 1.8, pz, 0.1, 3.6, 0xe8e8e0, 6);
          s.box(px, 3.3, pz, 0.06, 0.25, 1.8, 0xf2f2f2, h + 0.7 * sd); s.box(px, 3.3, pz, 0.06, 0.25, 1.8, 0xf2f2f2, h - 0.7 * sd);
          s.box(px, 2.6, pz, 0.15, 0.4, 1.0, 0x2a2b2e, h + Math.PI / 2);
          const [gx, gz] = this.L(S + ds, sd * 6.2); s.box(gx, 0.55, gz, 0.5, 1.1, 0.5, 0x5a5f66, h);
        }
        for (const k of [-1, 1]) this.rbox(g, S - 22 * k, LANE * k, 0.006, 0.5, 0.02, 3.4, CW.white);   // the stop lines, one each way
        break;
      }
      case "construction": {
        for (let a = S + 20; a < S + p.len - 20; a += 9) { const [x, z] = this.L(a, 4.4); s.cone(x, 0.4, z, 0.25, 0.8, CW.orange, 6); s.cyl(x, 0.35, z, 0.27, 0.12, 0xf2f2f2, 6); }
        both(() => {
          const uv = this.slot("ROAD WORK AHEAD", { bg: "#e8701a", fg: "#111111", logo: false });
          this.rbox(s, S + 0.15, 9, 1.2, 0.12, 2.4, 0.12, 0x8d9296);   // behind the board
          this.rbox(s, S + 0.05, 9, 2.6, 0.06, 1.0, 5.4, CW.orange);
          if (uv) this.signAt(pieceSigns(p)[0], uv);
        });
        // A roller and an excavator on the shoulder, and a stockpile.
        const [x, z, h] = this.L(S + p.len / 2, 12);
        s.box(x, 1.3, z, 3.4, 1.4, 1.8, 0xf2c200, h); s.cyl(x + Math.cos(h) * 2.1, 0.75, z - Math.sin(h) * 2.1, 0.75, 1.9, 0x5a5f66, 10, Math.PI / 2, -h);
        const [ex, ez] = this.L(S + p.len / 2 + 30, 14);
        s.box(ex, 1.0, ez, 3.2, 1.2, 2.4, 0x2a2b2e, h); s.box(ex, 2.3, ez, 2.6, 1.6, 2.2, 0xf2c200, h + 0.6);
        s.boxR(ex + 1.5, 3.4, ez - 0.8, 3.6, 0.4, 0.4, 0xf2c200, 0, h + 0.6, 0.5);
        const [mx, mz] = this.L(S + p.len / 2 + 55, 18); s.ico(mx, 0, mz, 3.5, 0x8a6a4a, 0.5);
        break;
      }
      case "attraction": {
        const n = side * 40, [x, z, h] = this.L(S + 50, n);
        for (let a = S + 25; a <= S + 75; a += 3.2) this.rbox(g, a, side * 28.5, 0.015, 0.12, 0.02, 5, CW.white);   // its bays, along the far side
        const face = h + (side > 0 ? Math.PI / 2 : -Math.PI / 2);   // facing the road
        const fx = Math.cos(face), fz = -Math.sin(face);
        const names = ["WORLD'S LARGEST COW", "DINO LAND", "WORLD'S LARGEST BALL OF TWINE", "GIANT DONUT"];
        const v = p.variant;
        if (v === 0) {   // a giant Holstein, side on to the road
          const yaw = h;
          const at = (a: number, y: number, b: number): [number, number, number] => [x + Math.cos(yaw) * a + Math.sin(yaw) * b, y, z - Math.sin(yaw) * a + Math.cos(yaw) * b];
          s.box(...at(0, 6, 0), 11, 5, 4.5, 0xf4f4f0, yaw);
          for (const [a, b, w] of [[-2.5, 2.27, 3], [2, 2.27, 2.4], [0.5, -2.27, 3.4]] as const) s.box(...at(a, 6.5, b), w, 2.4, 0.08, 0x1e1e1e, yaw);
          s.box(...at(6.5, 7.5, 0), 3, 3, 3, 0xf4f4f0, yaw); s.box(...at(8.1, 6.81, 0), 0.4, 1.6, 2.2, 0xf2a8b0, yaw);   // (its foot off the cab's underside's plane)
          for (const b of [-1.2, 1.2]) s.box(...at(6.4, 9.3, b), 0.4, 0.6, 0.4, 0xe8e0c8, yaw);
          for (const a of [-4, 4]) for (const b of [-1.6, 1.6]) s.box(...at(a, 1.8, b), 1, 3.6, 1, 0xf4f4f0, yaw);
          s.box(...at(0, 3.4, 0), 2, 0.9, 1.6, 0xf2a8b0, yaw);
        } else if (v === 1) {   // a green dinosaur
          const yaw = h, c = 0x4a9a4a;
          const at = (a: number, y: number, b: number): [number, number, number] => [x + Math.cos(yaw) * a + Math.sin(yaw) * b, y, z - Math.sin(yaw) * a + Math.cos(yaw) * b];
          s.ico(...at(0, 6, 0), 5, c, 0.7);
          for (let k = 0; k < 6; k++) s.ico(...at(4 + k * 1.6, 7 + k * 1.7, 0), 1.6 - k * 0.12, c);
          s.box(...at(14.5, 17.5, 0), 3.2, 1.8, 1.8, c, yaw);
          for (let k = 0; k < 7; k++) s.ico(...at(-4.5 - k * 1.8, 5.5 - k * 0.6, 0), 2 - k * 0.24, c);
          for (const a of [-2.5, 2.5]) for (const b of [-2, 2]) s.cyl(...at(a, 2, b), 0.9, 4, shade(c, 0.85), 6);
          for (let k = 0; k < 5; k++) s.cone(...at(-2 + k * 2, 10 - Math.abs(k - 2) * 0.4, 0), 0.8, 1.6, 0xd8742a, 4);
        } else if (v === 2) {   // a ball of twine on a plinth, under a little roof
          s.box(x, 0.5, z, 10, 1, 10, 0xb8b0a0, h);
          s.ico(x, 5.5, z, 4.6, 0xc8a46a, 1, 0.3); s.ico(x, 5.5, z, 4.5, 0xb89058, 1, 1.1);
          for (const [dx, dz] of [[-4.5, -4.5], [4.5, -4.5], [4.5, 4.5], [-4.5, 4.5]]) s.box(x + dx, 6, z + dz, 0.4, 10, 0.4, 0xf2ede0, h);
          s.prism(x, 11.5, z, 11, 2.4, 11, 0xa83a2a, h);
        } else {   // a giant donut on a post
          s.cyl(x, 4, z, 0.4, 8, 0x8d9296, 6);
          for (let k = 0; k < 16; k++) {
            const a = k / 16 * Math.PI * 2, ox = Math.cos(a) * 3.2, oy = Math.sin(a) * 3.2;
            const px = x + (-fz) * ox, pz = z + fx * ox;   // the ring's plane faces the road
            s.ico(px, 12 + oy, pz, 1.5, 0xd9a05a, 1, a);
            s.ico(px + fx * 0.5, 12 + oy, pz + fz * 0.5, 1.2, 0xf27aa8, 1, a);
          }
        }
        const uv = this.slot(names[v], { bg: "#f5c542", fg: "#5a1a0a", logo: false });
        const ns = side * 15;
        for (const k of [-2.8, 2.8]) this.rbox(s, S + 0.17, ns + k, 1.8, 0.16, 3.6, 0.16, CW.wood);   // behind the board
        this.rbox(s, S + 0.05, ns, 3.2, 0.06, 1.2, 7, 0xf5c542);
        if (uv) this.signAt(pieceSigns(p)[0], uv);
        break;
      }
      case "weigh": {
        // Its lane beside the road (the scale on it, the scale house beyond), paved over to the
        // road's shoulder where the lane leaves it and comes back.
        const N = WEIGH_N, open = p.way === road.dir && road.weighOpen;
        for (let a = S; a < S + WEIGH_LEN; a += 10) { this.rbox(g, a + 5, N, -0.045, 10.2, 0.1, 7, CW.asphalt); this.rbox(g, a + 5, N + 3.1, 0.005, 10, 0.02, 0.14, CW.white); }
        for (const [a0, a1] of [[S + WEIGH_OUT[0], S + WEIGH_OUT[1]], [S + WEIGH_BACK[0], S + WEIGH_BACK[1]]]) for (let a = a0; a < a1; a += 10) this.rbox(g, a + 5, 7.45, -0.05, 10.2, 0.1, 3.1, CW.asphalt);
        const sc = (WEIGH_SCALE[0] + WEIGH_SCALE[1]) / 2, sl = WEIGH_SCALE[1] - WEIGH_SCALE[0];
        this.rbox(g, S + sc, N, 0.01, sl, 0.04, 3.4, 0x8d9296);
        for (const a of WEIGH_SCALE) this.rbox(g, S + a, N, 0.02, 0.3, 0.04, 3.6, CW.yellow);
        this.rbox(s, S + sc, 22, 2, 8, 4, 6, 0xe8e2d6); this.rbox(s, S + sc, 22, 4.3, 8.6, 0.5, 6.6, 0x5b6470);
        this.rbox(s, S + sc, 18.9, 2.4, 6, 1.4, 0.1, 0x2a3440);
        // The scale's signal, on a post past its far end, facing the truck on it.
        this.rbox(s, S + WEIGH_LIGHT, N + 3.2, 2.0, 0.16, 4.0, 0.16, 0x5a5f66);
        this.rbox(s, S + WEIGH_LIGHT, N + 3.2, 4.2, 0.3, 1.1, 0.5, CW.dark);
        const uv = this.slot(open ? "WEIGH STATION · OPEN" : "WEIGH STATION · CLOSED", { bg: "#1e6b3a", fg: "#ffffff", logo: false });
        for (const k of [-3.6, 3.6]) this.rbox(s, S - 79.8, 10 + k, 2.4, 0.18, 4.8, 0.18, 0x8d9296);   // behind the board
        this.rbox(s, S - 79.94, 10, 4.0, 0.08, 2.0, 8.8, CW.green);
        if (open) for (const k of [-3.9, 3.9]) this.rbox(s, S - 79.85, 10 + k, 5.3, 0.3, 0.55, 0.55, CW.dark);   // the flashers' housings
        if (uv) this.signAt(pieceSigns(p)[0], uv);
        break;
      }
      case "ferry": {
        both(() => {
          const uv = this.slot((this.flip ? p.back : p.text) ?? "FERRY", { bg: "#1e6b3a", fg: "#ffffff", logo: false });
          for (const k of [-3.6, 3.6]) this.rbox(s, S - 149.8, 10 + k, 2.4, 0.18, 4.8, 0.18, 0x8d9296);   // behind the board
          this.rbox(s, S - 149.94, 10, 4.0, 0.08, 2.0, 8.8, CW.green);
          if (uv) this.signAt(pieceSigns(p)[0], uv);
        });
        break;
      }
      case "cattle": {
        const X = S + CATTLE_X, A = -side, B = -A;
        both(() => {
          const uv = this.slot(p.text ?? "CATTLE XING", { bg: "#f2c200", fg: "#111111", logo: false });
          this.rbox(s, S - 149.85, 9, 1.4, 0.12, 2.8, 0.12, 0x8d9296);   // behind the board
          this.rbox(s, S - 149.95, 9, 2.9, 0.06, 0.9, 4.6, 0xf2c200);
          if (uv) this.signAt(pieceSigns(p)[0], uv);
        });
        // The pasture (side A) and the corral (side B), each with its gate open onto the road.
        for (const n of [A * COW_GATE, B * COW_GATE]) { this.railFence(s, X - 44, X + 44, n, [[X - 3.4, X + 3.4]]); this.fieldGate(s, X, n, 3.2); }
        for (const a of [X - 44, X + 44]) this.crossFence(s, a, A * COW_GATE, A * 62);
        this.railFence(s, X - 44, X + 44, A * 62, []);
        for (const a of [X - 30, X + 30]) this.crossFence(s, a, B * COW_GATE, B * 52);
        this.railFence(s, X - 30, X + 30, B * 52, []);
        // Trodden ground through both gates, a trough in the corral, round bales in the pasture.
        for (const n of [A * (COW_GATE + 6), B * (COW_GATE + 6)]) this.rbox(g, X, n, -0.04, 6, 0.1, 12, 0x7a6a4a);
        this.rbox(s, X + 12, B * 32, 0.35, 3.2, 0.7, 0.8, 0x9aa0a6); this.rbox(s, X + 12, B * 32, 0.66, 3.0, 0.06, 0.6, 0x3a6a9a);
        for (const [da, dn] of [[-30, 50], [26, 44], [-18, 57]]) { const [bx, bz] = this.L(X + da, A * dn); s.cyl(bx, 0.75, bz, 0.75, 1.3, 0xc8b060, 10, Math.PI / 2); }
        // The barn behind the corral: red, white trim, a grey roof, its doors to the road.
        const [bx, bz, bh] = this.L(X, B * 62);
        this.rbox(s, X, B * 62, 3.6, 16, 7.2, 10, 0xa8322a);
        s.prism(bx, 8.4, bz, 16.4, 2.6, 10.6, 0x5b5f66, bh);
        this.rbox(s, X, B * 56.96, 2.3, 4.6, 4.6, 0.06, 0xf2f2ee); this.rbox(s, X, B * 56.93, 2.25, 4.0, 4.4, 0.06, 0x6a2a22);
        for (const r of [-1, 1]) this.rbox(s, X, B * 56.9, 2.25, 0.12, 6.0, 0.05, 0xf2f2ee, r * 0.76);
        break;
      }
      case "fruit": {
        const n = side * 13, [x, z, h] = this.L(S + 40, n);
        s.box(x, 1.4, z, 6, 2.8, 3.4, 0xc8a46a, h); s.box(x, 3.0, z, 7, 0.3, 4.4, 0xe8e2d6, h);
        for (let k = 0; k < 6; k++) { const ca = Math.cos(h) * (-2.4 + k * 0.95), cz = -Math.sin(h) * (-2.4 + k * 0.95); s.box(x + ca - Math.sin(h) * side * 2.2, 0.9, z + cz - Math.cos(h) * side * 2.2, 0.8, 0.5, 0.8, [0xe8701a, 0xc0392b, 0xf2c200, 0x7ab648][k % 4], h); }
        for (let k = 0; k < 7; k++) { const ca = Math.cos(h) * (-3 + k), cz = -Math.sin(h) * (-3 + k); s.box(x + ca - Math.sin(h) * side * 2.35, 3.4, z + cz - Math.cos(h) * side * 2.35, 1, 0.12, 0.5, k % 2 ? 0xf2f2f2 : CW.red, h); }
        const texts = ["FRESH PEACHES", "SWEET CORN", "CHERRIES · PIE", "PUMPKINS · CIDER"];
        const uv = this.slot(texts[p.variant], { bg: "#f2ede0", fg: "#a83a2a", logo: false });
        this.rbox(s, S + 0.14, side * 9.5, 0.8, 0.12, 1.6, 0.12, CW.wood);   // behind the board
        this.rbox(s, S + 0.04, side * 9.5, 1.6, 0.05, 0.8, 4.2, 0xf2ede0);
        if (uv) this.signAt(pieceSigns(p)[0], uv);
        // Orchard rows behind.
        for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) {
          const [tx, tz] = this.L(S + 10 + c * 10, side * (24 + r * 9)); s.cyl(tx, 0.6, tz, 0.15, 1.2, CW.trunk, 5); s.ico(tx, 2, tz, 1.4, 0x3c7a46);
        }
        break;
      }
      case "watertower": {
        const [x, z] = this.L(S + 45, side * 32);
        const towns = ["MAPLE CREEK", "PINE GROVE", "OAKDALE", "CEDAR FALLS"];
        DC.quads = this.quads;
        waterTower(s, x, z, this.slot(towns[p.variant], { bg: "#a8c4d8", fg: "#1d2f5a", logo: false }));
        // A few houses of the little town around it.
        for (let k = 0; k < 4; k++) {
          const [hx, hz, hh] = this.L(S + 10 + k * 22, side * (50 + (k % 2) * 14));
          s.box(hx, 1.6, hz, 7, 3.2, 6, [0xf2ede0, 0xd8eab0, 0xa9d4f2, 0xf7e3a1][k], hh); s.prism(hx, 4, hz, 7.4, 1.8, 6.6, 0x5b6470, hh);
        }
        break;
      }
      case "bridge": {
        // A river across the land, and a red covered bridge over it.
        const [x, z, h] = this.L(S + 60, 0);
        g.box(x, -0.065, z, 24, 0.1, 2 * SIDE_W + 39.98, CW.water, h);   // (its ends a cm short of the banks')
        for (const k of [-13, 13]) g.box(x + Math.cos(h) * k, -0.085, z - Math.sin(h) * k, 4, 0.1, 2 * SIDE_W + 40, 0x6a5a3a, h);   // (a cm under the road's shoulders: shared planes flicker)
        for (let k = 0; k < 10; k++) { const n = (k - 4.5) * 30 + (hash2(k, S, 3) - 0.5) * 10; if (Math.abs(n) < 20) continue; const [tx, tz] = this.L(S + 60 + (k % 2 ? 16 : -16), n); this.tree(s, tx, tz, "broad", 0x3c7a46, rnd); }
        for (const n of [-4.8, 4.8]) this.rbox(s, S + 60, n, 2.4, 30, 4.8, 0.25, 0xa83a2a);
        this.rbox(s, S + 60, -2.5, 6.0, 30.8, 1.9, 5.6, 0x4a4f57, 0); this.rbox(s, S + 60, 2.5, 6.0, 30.8, 1.9, 5.6, 0x4a4f57, 0);
        this.rbox(s, S + 60, 0, 6.6, 30.8, 0.6, 10.2, 0x4a4f57);
        // (The portals' faces short of the roof's ends, and the white posts' short of the portals':
        // shared planes flicker.)
        for (const a of [-15.2, 15.2]) { this.rbox(s, S + 60 + a, 0, 5.4, 0.38, 1.2, 10, 0xa83a2a); this.rbox(s, S + 60 + a, -4.6, 2.6, 0.34, 5.2, 0.6, 0xf2ede0); this.rbox(s, S + 60 + a, 4.6, 2.6, 0.34, 5.2, 0.6, 0xf2ede0); }
        for (let a = -14; a <= 14; a += 7) for (const n of [-4.8, 4.8]) this.rbox(s, S + 60 + a, n * 1.02, 2.2, 1.2, 0.9, 0.1, 0x2a2020);
        break;
      }
      case "tunnel": {
        // The bore: tiled walls with a walkway along each, a dark vault, a line of lamps along
        // each side of it; a concrete portal at each end, under the hill.
        // (Each stretch overlapping the next by 10 cm, but not out past the bore's ends into the
        // portals: there their faces shared the portals' planes and flickered.)
        for (let a = S; a < S + p.len - 0.01; a += 6) {
          const a0 = a === S ? S : a - 0.05, a1 = Math.min(a + 6, S + p.len) + (a + 6 < S + p.len - 0.01 ? 0.05 : 0), l = a1 - a0, am = (a0 + a1) / 2;
          for (const k of [-1, 1]) {
            this.rbox(s, am, k * (BORE_HALF + 0.15), 0.7, l, 1.4, 0.3, 0xcfcabb);
            this.rbox(s, am, k * (BORE_HALF + 0.15), 1.4 + (BORE_H - 1.4) / 2, l, BORE_H - 1.4, 0.3, 0x4f4d49);
            this.rbox(s, am, k * (BORE_HALF - 0.45), 0.15, l, 0.3, 0.9, 0x8d8a82);
            this.rbox(s, am, k * (BORE_HALF - 1.4), BORE_H - 0.25, l, 0.5, 2.2, 0x34332f);
          }
          this.rbox(s, am, 0, BORE_H + 0.15, l, 0.3, 2 * BORE_HALF + 0.6, 0x2c2b28);
          if (Math.round(a / 6) % 2 === 0) for (const k of [-1, 1]) this.rbox(this.glow, a + 3, k * (BORE_HALF - 0.6), BORE_H - 0.55, 2.4, 0.12, 0.3, 0xfff0c8);
        }
        const top = tunnelTop(p);
        for (const [e, f] of [[S - 0.5, -1], [S + p.len + 0.5, 1]] as const) {
          for (const k of [-1, 1]) this.rbox(s, e, k * (BORE_HALF + 4), (top + 0.8) / 2, 1.0, top + 0.8, 8, CW.concrete);
          this.rbox(s, e, 0, BORE_H + (top + 0.8 - BORE_H) / 2, 1.0, top + 0.8 - BORE_H, 2 * BORE_HALF + 0.1, CW.concrete);
          // (The band a cm clear of the opening's edges, which the portal's own faces line.)
          this.rbox(s, e + f * 0.55, 0, BORE_H + 0.36, 0.12, 0.7, 2 * BORE_HALF + 1.4, 0x6f6c64);   // the lintel's band
          for (const k of [-1, 1]) this.rbox(s, e + f * 0.55, k * (BORE_HALF + 0.36), BORE_H / 2, 0.12, BORE_H, 0.7, 0x6f6c64);
          this.rbox(s, e, 0, top + 1.0, 1.4, 0.4, 2 * BORE_HALF + 9, 0x8d8a82);   // its coping
        }
        break;
      }
      case "overpass": {
        // A cross road (or a railway) across the road on a bridge: its deck between two
        // abutments, on embankments out across the land either side.
        const C = S + p.len / 2, [, , h] = this.L(C, 0), rail = p.variant === 1;
        const across = (n0: number, n1: number, y: number, hgt: number, wid: number, color: number, ds = 0) => {
          const [x0, z0] = this.L(C + ds, n0), [x1, z1] = this.L(C + ds, n1);
          s.box((x0 + x1) / 2, y, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0), hgt, wid, color, h - Math.PI / 2);
        };
        const deckC = rail ? 0x6a3a2a : CW.concrete, W = 2 * OVER_HALF - 2;
        across(-OVER_ABUT - 1.5, OVER_ABUT + 1.5, OVER_DECK - 0.55, 1.1, W, deckC);
        for (const k of [-1, 1]) {
          this.rbox(s, C, k * (OVER_ABUT + 0.4), (OVER_DECK - 1.1) / 2, W + 2, OVER_DECK - 1.1, 0.8, CW.concrete);
          if (rail) across(-OVER_ABUT - 1.5, OVER_ABUT + 1.5, OVER_DECK + 0.6, 1.6, 0.35, deckC, k * (W / 2 - 0.2));
          else across(-OVER_ABUT - 1.5, OVER_ABUT + 1.5, OVER_DECK + 0.45, 0.9, 0.3, CW.concrete, k * (W / 2 - 0.2));
        }
        // The way over: on the deck, then down the embankments onto the land.
        const keep = s.dy; s.dy = 0;
        for (let n = -150; n < 150; n += 6) {
          const n1 = n + 6, y0 = this.V.groundAt(C, n), y1 = this.V.groundAt(C, n1);
          const onDeck = Math.abs(n + 3) < OVER_ABUT + 1.5, ya = onDeck ? this.pieceY + OVER_DECK : y0, yb = onDeck ? this.pieceY + OVER_DECK : y1;
          const [x0, z0] = this.L(C, n), [x1, z1] = this.L(C, n1), run = Math.hypot(x1 - x0, z1 - z0);
          const yaw = h - Math.PI / 2, pitch = Math.atan2(yb - ya, run);
          if (rail) {
            s.boxR((x0 + x1) / 2, (ya + yb) / 2 + 0.05, (z0 + z1) / 2, run + 0.2, 0.2, 3.6, 0x8a8478, 0, yaw, pitch);
            for (const k of [-0.72, 0.72]) {
              const ox = Math.cos(h) * k, oz = -Math.sin(h) * k;
              s.boxR((x0 + x1) / 2 + ox, (ya + yb) / 2 + 0.25, (z0 + z1) / 2 + oz, run + 0.1, 0.12, 0.1, 0x9a9ea2, 0, yaw, pitch);
            }
          } else {
            s.boxR((x0 + x1) / 2, (ya + yb) / 2 + 0.04, (z0 + z1) / 2, run + 0.2, 0.1, 7, CW.asphalt, 0, yaw, pitch);
            s.boxR((x0 + x1) / 2, (ya + yb) / 2 + 0.1, (z0 + z1) / 2, run, 0.02, 0.2, CW.yellow, 0, yaw, pitch);
          }
        }
        s.dy = keep;
        break;
      }
      case "gas": {
        const n = side * (FORECOURT + 6);
        this.rbox(s, S + 40, n, 4.6, 20, 0.5, 10, 0xf2f2ee); this.rbox(s, S + 40, n, 4.3, 20.2, 0.3, 10.2, 0x1f6fb2);
        for (const a of [-7, 7]) this.rbox(s, S + 40 + a, n, 2.2, 0.4, 4.4, 0.4, 0xdedbd0);
        for (const a of [-4, 4]) this.rbox(s, S + 40 + a, n, 0.75, 0.8, 1.5, 0.6, 0xc0392b);
        // (The shop 2 cm in from the paving's edges, which its skirts are a cm in from: shared planes
        // flicker. Its window 1 cm proud of its wall.)
        this.rbox(s, S + 75, side * (FORECOURT + 14), 2.2, 13.96, 4.4, 7.96, 0xe8e2d6); this.rbox(s, S + 75, side * (FORECOURT + 9.97), 1.8, 10, 2.4, 0.1, 0x2a3440);
        const uv = this.slot(`GAS  $${(3 + p.variant * 0.17 + 0.29).toFixed(2)}`, { bg: "#1f6fb2", fg: "#ffffff", logo: false });
        this.rbox(s, S + GAS_SIGN + 0.39, side * GAS_SIGN_N, 3.5, 0.3, 7, 0.3, 0x5a5f66);   // behind the board, on the island between the drives
        this.rbox(s, S + GAS_SIGN + 0.1, side * GAS_SIGN_N, 7.2, 0.25, 1.4, 4.8, 0x1f6fb2);
        if (uv) this.signAt(pieceSigns(p)[0], uv);
        break;
      }
    }
  }
}

// A freight train along +x, front at x = 0: a hood-unit locomotive and TRAIN_CARS cars (boxcars,
// tank cars and covered hoppers), TRAIN_CAR metres apart.
function freightTrain(b: Batch) {
  const L = TRAIN_CAR, DARK = 0x24262a, WHEEL = 0x161616, RAIL = 0xf2c200;
  const truck = (x: number, axles: number) => {
    b.box(x, 0.62, 0, axles * 1.2 + 0.6, 0.5, 2.3, DARK);
    for (let k = 0; k < axles; k++) for (const z of [-0.78, 0.78]) b.cyl(x + (k - (axles - 1) / 2) * 1.2, 0.48, z, 0.48, 0.14, WHEEL, 10, Math.PI / 2);
  };
  // Locomotive (a six-axle road diesel): pilot and plow, a walkway deck on the frame, a short nose
  // with headlights, the cab, and the long hood with a dynamic brake blister, the exhaust stack
  // and a flared radiator section with its fans at the back.
  const BLUE = 0x1f4f8f, NAVY = 0x173c6c, YEL = 0xf2c200, GREY = 0x3a3d42;
  const deckY = 1.45, top = 4.25;
  b.box(-L / 2, 1.24, 0, L - 0.6, 0.38, 3.0, DARK);                         // frame (its top under the deck's: shared planes flicker)
  b.box(-L / 2, deckY - 0.03, 0, L - 0.62, 0.06, 3.04, GREY);               // walkway deck (its ends a cm short of the frame's)
  b.box(-L / 2, 1.18, 0, L - 0.64, 0.16, 3.06, YEL);                        // sill safety stripe (short of the frame's ends)
  truck(-3.6, 3); truck(-L + 3.6, 3);
  for (const x of [-3.6, -L + 3.6]) for (const z of [-1, 1]) b.box(x, 0.7, z * 1.16, 3.8, 0.45, 0.08, 0x2e3034);   // truck side frames
  b.box(-L / 2, 0.95, 0, 5.4, 0.7, 2.3, GREY);                              // fuel tank
  // Pilot: plow, anticlimber, coupler; the same at the back.
  b.boxR(0.12, 0.62, 0, 0.12, 0.8, 2.9, DARK, 0, 0, 0.45);                // plow, leaning back
  for (let k = -2; k <= 2; k++) b.boxR(0.19, 0.62, k * 0.55, 0.04, 0.8, 0.22, YEL, 0, 0, 0.45);
  b.box(-0.15, 1.5, 0, 0.3, 0.25, 2.9, DARK); b.box(0.2, 1.05, 0, 0.6, 0.22, 0.32, DARK);
  b.box(-L + 0.45, 1.5, 0, 0.3, 0.25, 2.9, DARK); b.box(-L + 0.1, 1.05, 0, 0.6, 0.22, 0.32, DARK);
  // Short nose: narrower than the cab, chevrons, number boards, twin headlights.
  b.box(-1.15, 2.05, 0, 1.6, 1.2, 2.2, BLUE);
  b.boxR(-1.2, 2.72, 0, 1.7, 0.16, 2.2, BLUE, 0, 0, 0.12);
  for (const z of [-1, 1]) b.boxR(-0.34, 1.9, z * 0.55, 0.04, 0.16, 1.2, YEL, z * 0.55, 0, 0);
  b.box(-0.33, 2.55, 0, 0.04, 0.22, 0.9, 0x101010);
  b.aux.set(0, 0, -2);   // glowing after dark (the facade material's streetlight tag)
  for (const z of [-0.18, 0.18]) b.box(-0.32, 2.3, z, 0.05, 0.16, 0.22, 0xfff4d0);
  for (const z of [-1.25, 1.25]) b.box(-0.25, 1.62, z, 0.08, 0.14, 0.18, 0xfff4d0);   // ditch lights
  b.aux.set(0, 0, -1);
  // Cab: split windshield, side windows, a roof with a small overhang, the horn.
  b.box(-3.15, 2.85, 0, 2.6, 2.8, 3.0, BLUE);
  for (const z of [-0.65, 0.65]) b.box(-1.83, 3.55, z, 0.06, 0.85, 1.15, GLASS);
  for (const z of [-1.51, 1.51]) { b.box(-2.55, 3.55, z, 1.0, 0.8, 0.04, GLASS); b.box(-3.75, 3.55, z, 0.8, 0.8, 0.04, GLASS); }
  b.box(-3.1, top + 0.05, 0, 2.9, 0.1, 3.1, NAVY);
  b.cyl(-3.4, top + 0.25, 0.4, 0.07, 0.3, 0x5a5f66, 6);
  // Long hood.
  const h0 = -4.45, h1 = -L + 0.7, hw = 1.15;
  b.box((h0 + h1) / 2, 2.6, 0, h0 - h1, 2.3, 2 * hw, BLUE);
  b.box((h0 + h1) / 2, 2.2, 0, h0 - h1 + 0.02, 0.18, 2 * hw + 0.02, YEL);    // hood band
  for (let x = h0 - 0.8; x > h1 + 3.5; x -= 1.1) b.box(x, 2.55, 0, 0.05, 1.9, 2 * hw + 0.02, NAVY);   // door seams
  b.box(h0 - 2.6, 3.95, 0, 3.4, 0.45, 2.5, BLUE);                           // dynamic brake blister
  for (let k = 0; k < 3; k++) b.box(h0 - 1.6 - k * 1.0, 4.19, 0, 0.7, 0.04, 1.6, GREY);   // its grilles
  b.cyl(h0 - 5.5, 3.95, 0, 0.25, 0.6, 0x2a2b2e, 8);                         // exhaust stack
  b.box(h1 + 1.9, 3.1, 0, 3.6, 1.3, 2.8, BLUE);                             // radiator section, flared
  for (const z of [-1, 1]) b.box(h1 + 1.9, 3.0, z * 1.41, 3.2, 0.9, 0.03, GREY);   // radiator intakes
  for (const x of [h1 + 1.0, h1 + 2.8]) b.cyl(x, 3.78, 0, 0.6, 0.06, 0x1e2024, 12);  // fans
  // Handrails on stanchions, and steps at the corners.
  for (const z of [-1.45, 1.45]) {
    b.box(-L / 2 - 0.6, deckY + 1.0, z, L - 3.2, 0.05, 0.05, YEL);
    for (let x = -1.2; x > -L + 1.5; x -= 1.6) b.box(x, deckY + 0.5, z, 0.05, 1.0, 0.05, YEL);
    for (const x of [-0.7, -L + 1.3]) { b.box(x, 0.95, z * 1.02, 0.5, 0.06, 0.3, YEL); b.box(x, 0.6, z * 1.02, 0.5, 0.06, 0.3, YEL); }
  }
  // Cars.
  const BOX = [0x8a3a2a, 0x6a4a2a, 0x2e5b3a, 0x7a2e2e, 0x3a5a7a, 0xb5651d];
  for (let c = 0; c < TRAIN_CARS; c++) {
    const x = -(c + 1) * L - L / 2, kind = c % 3, len = L - 1.4;
    b.box(x, 1.15, 0, len, 0.3, 2.9, DARK);                                 // underframe
    truck(x - len / 2 + 2.2, 2); truck(x + len / 2 - 2.2, 2);
    b.box(x - len / 2 - 0.5, 1.15, 0, 0.7, 0.2, 0.3, DARK);                 // coupler
    if (kind === 0) {   // boxcar: ribbed sides, a sliding door, ladders, roof walk
      const col = BOX[c % BOX.length];
      b.box(x, 2.75, 0, len, 2.9, 2.9, col);
      for (let r = -len / 2 + 0.6; r < len / 2; r += 0.75) b.box(x + r, 2.75, 0, 0.08, 2.85, 2.94, shade(col, 0.82));
      for (const z of [-1, 1]) { b.box(x, 2.6, z * 1.48, 2.6, 2.5, 0.06, shade(col, 0.7)); b.box(x, 4.0, z * 1.47, 3.6, 0.08, 0.06, 0x3a3d42); }
      b.box(x, 4.25, 0, len - 0.02, 0.12, 2.6, shade(col, 0.9));   // roof walk (its ends a cm in from the body's: shared planes flicker)
      for (const e of [-1, 1]) for (let k = 0; k < 6; k++) b.box(x + e * (len / 2 - 0.3), 1.6 + k * 0.42, 1.48, 0.5, 0.04, 0.05, 0xd0d0d0);
    } else if (kind === 1) {   // tank car: barrel, end caps, dome, walkway
      const col = c % 2 ? 0x1c1c1e : 0xd8d8d0;
      b.cyl(x, 2.45, 0, 1.4, len - 0.6, col, 14, 0, Math.PI / 2);
      for (const e of [-1, 1]) b.cyl(x + e * (len / 2 - 0.3), 2.45, 0, 1.2, 0.3, shade(col, 0.85), 14, 0, Math.PI / 2);
      b.cyl(x, 3.95, 0, 0.5, 0.35, shade(col, 0.9), 10);
      b.box(x, 3.88, 0, 2.6, 0.06, 1.2, 0x5a5f66);
      b.box(x, 1.6, 0, len - 1, 0.1, 2.6, 0x5a5f66);
    } else {   // covered hopper: a tall body with sloped bays underneath
      const col = 0xb8b4a8;
      b.box(x, 3.0, 0, len, 2.4, 3.0, col);
      for (let k = 0; k < 3; k++) { const hx = x - len / 3 + k * len / 3; b.boxR(hx, 1.55, 0, 2.2, 1.0, 2.6, shade(col, 0.85), 0, 0, 0.0); b.box(hx, 1.0, 0, 0.8, 0.3, 1.0, shade(col, 0.7)); }
      for (let r = -len / 2 + 1; r < len / 2; r += 1.4) b.box(x + r, 3.0, 0, 0.1, 2.35, 3.04, shade(col, 0.88));
      b.box(x, 4.27, 0, len - 0.6, 0.12, 1.0, shade(col, 0.8));
    }
  }
}

// A tree (or cactus or shrub) of a biome's kind, on the ground at (x, z): the road's land and the
// countryside round a city (city.ts) share it.
// (`near`: the undersides of the crowns of trees close by, kept clear of. Returns its own.)
export function landTree(s: Batch, x: number, z: number, kind: string, green: number, rnd: Rand, near: number[] = []): number {
  const base = s.dy;   // (raised to the land's height there)
  // (Its size a little by where it stands too: neighbours that came out the same size, as in a
  // row planted from one stream, had their boughs' undersides in one plane, and flickered.)
  let k = 0.8 + rnd() * 0.6 + (Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1) * 0.03;
  // (The underside of its crown, by kind, kept clear of its neighbours'.)
  const under = (k: number) => kind === "conifer" ? 0.85 * k : kind === "cypress" ? 2.19 * k : kind === "broad" ? 1.5 * k : kind === "palm" ? 6.2 * k - 0.49 : 0.4 * k;
  for (let n = 0; n < 8 && near.some((q) => Math.abs(q - base - under(k)) < 0.006); n++) k += 0.013;
  if (BARE.includes(green) && (kind === "broad" || kind === "cypress" || kind === "palm" || kind === "shrub")) {
    if (kind === "shrub") s.ico(x, 0.35 * k, z, 0.7 * k, 0x6e5a48, 0.6, rnd() * 6); else bareTree(s, x, 0, z, 4.6 * k, rnd() * 6);
    return base + under(k);
  }
  if (kind === "tuft" || kind === "pancake" || kind === "spiral" || kind === "droop") { storyTree(s, kind, x, 0, z, 6 * k, 1.7 * k, green); return base + 0.4 * k; }
  switch (kind) {
    case "conifer": s.cyl(x, 0.6 * k, z, 0.2 * k, 1.2 * k, CW.trunk, 5); s.cone(x, 3.6 * k, z, 1.7 * k, 5.5 * k, green, 7, 0, x * 1.7 + z); break;   // (turned its own way: two alike side by side could share a plane, which flickers)
    case "cypress": s.cyl(x, 1 * k, z, 0.25 * k, 2 * k, CW.trunk, 5); s.ico(x, 3.4 * k, z, 2.2 * k, green, 0.55, rnd() * 6); s.ico(x + 0.8, 3.0 * k, z, 1.6 * k, shade(green, 1.1), 0.5, rnd() * 6); break;
    case "broad": s.cyl(x, 1.2 * k, z, 0.22 * k, 2.4 * k, CW.trunk, 5); s.ico(x, 3.3 * k, z, 1.8 * k, green, 1, rnd() * 6); break;
    case "palm": s.cyl(x, 3 * k, z, 0.2, 6 * k, CW.trunk, 5); s.ico(x, 6.2 * k, z, 1.4, green, 0.35); break;
    case "cactus": {
      s.cyl(x, 1.6 * k, z, 0.3 * k, 3.2 * k, green, 6);
      if (rnd() < 0.8) { s.box(x + 0.6 * k, 1.5 * k, z, 0.9 * k, 0.4 * k, 0.4 * k, green); s.cyl(x + 1.0 * k, 2.1 * k, z, 0.22 * k, 1.2 * k, green, 6); }
      if (rnd() < 0.6) { s.box(x - 0.55 * k, 1.9 * k, z, 0.8 * k, 0.35 * k, 0.35 * k, green); s.cyl(x - 0.9 * k, 2.4 * k, z, 0.2 * k, 1.0 * k, green, 6); }
      break;
    }
    case "shrub": s.ico(x, 0.4 * k, z, 0.8 * k, shade(green, 0.9 + rnd() * 0.3), 0.7, rnd() * 6); break;
  }
  return base + under(k);
}

function smooth01(x: number) { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); }
