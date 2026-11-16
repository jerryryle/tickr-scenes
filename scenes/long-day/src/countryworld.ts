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
import { applyDriverSpot } from "./cutaway.ts";
import { applyLampGlow, applyLampLight, LAMPS_ON } from "./atmosphere.ts";
import type { TruckModel } from "./truck.ts";
import type { TreeKind } from "./styles.ts";
import { BARE, seasonGreens, seasonGround } from "./climate.ts";
import type { Climate } from "./climate.ts";
import { DC, waterTower } from "./decor.ts";
import { bareTree, shade } from "./city.ts";
import type { CityMaterials, FleetBuilder, Rand, StallPose } from "./city.ts";
import { AD_BATON, AD_BILLBOARD, AD_RYDER, signAtlas, SignAtlas } from "./signs.ts";
import type { SignMesh, SignStyle } from "./signs.ts";
import { CountryRoad, LANE, ONCOMING_SPEED, TRAIN_CAR, TRAIN_CARS, TRAIN_SPEED } from "./country.ts";
import type { BiomeId, RoadPiece } from "./country.ts";
import { GLASS, headLamp, tailLamp } from "./traffic.ts";

const SEG = 60;                  // segment length along the road (m); short, so building one never stalls a frame for long
const SEG_AHEAD = 480, SEG_BEHIND = 240;
const SIDE_W = 170;              // land built either side of the road (fog covers the rest)
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
};
const CW = { asphalt: 0x34353a, shoulder: 0x7a776c, white: 0xe8e8e0, yellow: 0xf2c200, pole: 0x6b5a44, metal: 0x8d9296, dark: 0x1e2124,
  water: 0x2f78b8, sand: 0xd9c89a, green: 0x1e6b3a, red: 0xc0392b, ryder: 0xce1126, orange: 0xe8701a, wood: 0x8a5a34, trunk: 0x5a4030 };

export class CountryWorld {
  readonly group = new THREE.Group();
  private road: CountryRoad | null = null;
  private segs = new Map<number, THREE.Group>();
  private p = { x: 0, z: 0, h: 0, k: 0 };
  private q = { x: 0, z: 0, h: 0, k: 0 };
  // Things that move with time.
  private cars: THREE.InstancedMesh;
  private carPoses: number[] = [];   // oncoming cars: x, z, heading
  private carMat: THREE.MeshLambertMaterial;
  private train: THREE.Group | null = null;
  private gates: THREE.Group[] = [];
  private lights: THREE.Mesh[] = [];
  private m4 = new THREE.Matrix4(); private quat = new THREE.Quaternion(); private one = new THREE.Vector3(1, 1, 1); private v = new THREE.Vector3();
  // Per segment build state.
  private ox = 0; private oz = 0; private quads: Quad[] = []; private slots: number[] = []; private ads = false;

  constructor(scene: THREE.Scene, private mats: CityMaterials, private fleet: FleetBuilder | null) {
    scene.add(this.group);
    this.group.visible = false;
    const b = new Batch();
    b.box(0, 0.7, 0, 4.3, 0.75, 1.8, 0xffffff); b.box(-0.3, 1.35, 0, 2.2, 0.6, 1.62, 0x2a3440);
    for (const x of [-1.35, 1.35]) for (const z of [-0.73, 0.73]) b.cyl(x, 0.34, z, 0.34, 0.24, 0x1a1a1a, 8, Math.PI / 2);   // inside the body's sides
    for (const z of [-0.6, 0.6]) { headLamp(b, 2.16, 0.75, z, 0.04, 0.16, 0.3); tailLamp(b, -2.16, 0.8, z, 0.04, 0.14, 0.3); }
    const carMat = this.carMat = new THREE.MeshLambertMaterial({ vertexColors: true }); applyDriverSpot(carMat); applyLampGlow(carMat); applyLampLight(carMat);
    // The after-dark glow takes each car's own colour (a plain grey glow washed them all out).
    { const prev = carMat.onBeforeCompile.bind(carMat), prevKey = carMat.customProgramCacheKey.bind(carMat);
      carMat.onBeforeCompile = (shader, r) => { prev(shader, r); shader.fragmentShader = shader.fragmentShader.replace("#include <emissivemap_fragment>", "#ifdef USE_COLOR\n  totalEmissiveRadiance *= vColor.rgb;\n#endif\n#include <emissivemap_fragment>"); };
      carMat.customProgramCacheKey = () => prevKey() + "|cartint-v1"; }
    const carMesh = b.build(carMat)!;
    this.cars = new THREE.InstancedMesh(carMesh.geometry, carMesh.material, 10);
    this.cars.count = 0; this.cars.frustumCulled = false;
    for (let i = 0; i < 10; i++) this.cars.setColorAt(i, new THREE.Color([0xc0392b, 0x2e6fb2, 0xe8e8e0, 0x2a2b2e, 0x8a9aa6, 0x2e8b57, 0xe0a020][i % 7]));
    this.group.add(this.cars);
    // A wide plane under everything, following the truck, for the far land under the fog.
    // (Subdivided: fog is computed per vertex.)
    this.base = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000, 40, 40).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6e9e44 }));
    this.base.position.y = -0.3;
    scene.add(this.base);   // under the city's countryside too (main.ts colours it there)
    // Never seen: keeps the crossing lights' material in the setup precompile.
    const keep = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), this.lightMat); keep.position.y = -5; this.group.add(keep);
  }
  private base: THREE.Mesh;

  lastBuildMs = 0; maxBuildMs = 0;
  private lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });   // crossing lights, shared
  get active() { return this.road !== null; }
  // The road's place in the current frame (main.ts: the last city's road, still in view after the
  // next city takes over, is drawn moved into the new city's coordinates).
  setOffset(x: number, z: number) { this.group.position.set(x, 0, z); }
  get offset() { return this.group.position; }
  // The far land under everything, centred on (x, z), in a colour.
  setBase(x: number, z: number, color: number) { this.base.position.x = x; this.base.position.z = z; (this.base.material as THREE.MeshLambertMaterial).color.setHex(color); }
  // A biome's ground colour in a climate (for the land round a city).
  groundOf(id: BiomeId, c: Climate) { return this.lookOf(id, c).ground; }

  // A biome's look at (s, n), in the season there.
  private looks = new Map<string, BiomeLook & { cgreens: number[] }>();
  private tmpC = new THREE.Color();
  private look(road: CountryRoad, sa: number, n = 0) { return this.lookOf(road.biomeAt(sa, n), road.climateAt(sa, n)); }
  private lookOf(id: BiomeId, c: Climate) {
    const key = `${id}/${c.season}/${c.snowCover}`;
    let l = this.looks.get(key);
    if (!l) {
      const b = BIOMES[id];
      l = { ...b, ground: seasonGround(b.ground, c), ground2: seasonGround(b.ground2, c), greens: seasonGreens(b.greens, c), cgreens: seasonGreens(b.greens, c, true),
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
    const rail = road.pieces.find((p) => p.kind === "rail");
    if (rail) {
      this.train = this.buildTrain(road, rail.s);
      this.group.add(this.train);
      road.center(rail.s, this.p);
      for (const [ds, side] of [[-7, 1], [7, -1]] as const) {
        road.point(rail.s + ds, side * 6.2, this.q);
        const g = new THREE.Group(), b = new Batch();
        // The arm, along local -z (towards the road) from the pivot.
        for (let i = 0; i < 6; i++) b.box(0, 0, -0.5 - i, 0.12, 0.12, 1.0, i % 2 ? CW.red : 0xf2f2f2);
        g.add(b.build(this.mats.solid)!);
        g.position.set(this.q.x, 1.1, this.q.z);
        g.rotation.order = "YXZ"; g.rotation.y = this.p.h + (side > 0 ? 0 : Math.PI);
        this.group.add(g); this.gates.push(g);
        for (const k of [-0.3, 0.3]) {
          const lb = new Batch(); lb.box(0, 0, 0, 0.3, 0.3, 0.1, 0xff3020);
          const l = lb.build(this.lightMat)!;
          road.point(rail.s + ds - Math.sign(ds) * 0.9, side * 6.6, this.q);
          l.position.set(this.q.x + Math.cos(this.p.h) * k * 0, 2.6, this.q.z);
          l.position.x += Math.sin(this.p.h) * k * side; l.position.z += Math.cos(this.p.h) * k * side;
          l.rotation.y = this.p.h + Math.PI / 2 * Math.sign(ds);
          l.userData.k = k; this.group.add(l); this.lights.push(l);
        }
      }
    }
  }

  clear() {
    for (const g of this.segs.values()) { this.group.remove(g); disposeTree(g); }
    this.segs.clear();
    if (this.train) { this.group.remove(this.train); disposeTree(this.train); this.train = null; }
    for (const g of [...this.gates, ...this.lights]) { this.group.remove(g); disposeTree(g); }
    this.gates = []; this.lights = [];
    this.cars.count = 0;
  }

  // Stream segments around the truck (all at once after a jump) and move what moves.
  private tmpC2 = new THREE.Color();
  update(u: number, sTruck: number, jumped: boolean, baseToo = true) {
    const road = this.road;
    if (!road) return;
    const i0 = Math.floor((sTruck - SEG_BEHIND) / SEG), i1 = Math.floor((sTruck + SEG_AHEAD) / SEG);
    for (const [i, g] of this.segs) if (i < i0 - 1 || i > i1 + 1) { this.group.remove(g); disposeTree(g); this.segs.delete(i); }
    let budget = jumped ? Infinity : 1;
    // Nearest first: the one ahead of the truck, then outwards.
    const want: number[] = [];
    const iMax = Math.floor((road.length - 0.01) / SEG);
    for (let i = i0; i <= i1; i++) if (i >= 0 && i <= iMax && !this.segs.has(i)) want.push(i);
    want.sort((a, b) => Math.abs(a * SEG + SEG / 2 - sTruck) - Math.abs(b * SEG + SEG / 2 - sTruck));
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
      this.setBase(this.p.x + this.group.position.x, this.p.z + this.group.position.z, this.tmpC.getHex());
    }
    this.updateCars(road, u, sTruck);
    this.updateCrossing(road, u);
  }

  // Headlight patches ahead of the oncoming cars nearest `at` (atmosphere.ts HEAD_LIGHTS).
  headlights(out: THREE.Vector4[], from: number, at: { x: number; z: number }) {
    const d = this.carPoses, order: number[] = [];
    const ax = at.x - this.group.position.x, az = at.z - this.group.position.z;
    for (let i = 0; i < d.length; i += 3) if (Math.hypot(d[i] - ax, d[i + 1] - az) < 120) order.push(i);
    order.sort((a, b) => Math.hypot(d[a] - ax, d[a + 1] - az) - Math.hypot(d[b] - ax, d[b + 1] - az));
    for (let k = from; k < out.length; k++) {
      const i = order[k - from];
      if (i === undefined) { out[k].w = 0; continue; }
      const h = d[i + 2];
      out[k].set(d[i] + Math.cos(h) * 7.5 + this.group.position.x, d[i + 1] - Math.sin(h) * 7.5 + this.group.position.z, h, 0.7);
    }
  }

  // ---- what moves ---------------------------------------------------------------------------
  private updateCars(road: CountryRoad, u: number, sTruck: number) {
    // After dark the bodies keep a faint glow, so an oncoming car reads as a car behind its lights.
    this.carMat.emissive.setScalar(0.22 * LAMPS_ON.value);
    let n = 0;
    this.carPoses.length = 0;
    for (let i = 0; i < road.meetings.length && n < 10; i++) {
      const tm = road.meetings[i];
      const s = road.sAt(tm) - ONCOMING_SPEED * (u - tm);
      if (Math.abs(s - sTruck) > 330 || s < road.landFrom || s > road.landTo) continue;
      road.point(s, -LANE, this.p);
      this.quat.setFromAxisAngle(this.v.set(0, 1, 0), this.p.h + Math.PI);
      this.m4.compose(this.v.set(this.p.x, 0, this.p.z), this.quat, this.one);
      this.cars.setMatrixAt(n, this.m4);
      this.carPoses.push(this.p.x, this.p.z, this.p.h + Math.PI);
      this.cars.setColorAt(n, new THREE.Color([0xc0392b, 0x2e6fb2, 0xe8e8e0, 0x2a2b2e, 0x8a9aa6, 0x2e8b57, 0xe0a020][i % 7]));
      n++;
    }
    this.cars.count = n;
    this.cars.instanceMatrix.needsUpdate = true;
    if (this.cars.instanceColor) this.cars.instanceColor.needsUpdate = true;
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
      const rs = road.pieces.find((p) => p.kind === "rail")!.s;
      road.point(rs, front, this.p);
      this.train.position.set(this.p.x, 0, this.p.z);
    }
    const down0 = rail ? rail.arrive - 7 : 1e9, up0 = tt + (150 + 8 + len) / TRAIN_SPEED + 0.5;
    const down = THREE.MathUtils.clamp(Math.min((u - down0) / 3, (up0 + 3 - u) / 3), 0, 1);
    for (const g of this.gates) g.rotation.x = (1 - down) * Math.PI / 2 * 0.95;   // up: the arm points to the sky
    const flash = down > 0 && Math.floor(u * 2) % 2 === 0;
    for (const l of this.lights) l.visible = down > 0 && (l.userData.k > 0 ? flash : !flash);
  }

  private buildTrain(road: CountryRoad, rs: number): THREE.Group {
    const b = new Batch();
    freightTrain(b);
    const g = new THREE.Group();
    g.add(b.build(this.mats.solid)!);
    road.center(rs, this.p);
    g.rotation.y = this.p.h - Math.PI / 2;   // local +x along the road's right
    return g;
  }

  // ---- segments -----------------------------------------------------------------------------
  // Local position of (s, n) in the segment being built.
  private L(s: number, n: number): [number, number, number] {
    this.road!.point(s, n, this.q);
    return [this.q.x - this.ox, this.q.z - this.oz, this.q.h];
  }
  // A box aligned with the road at (s, n): `len` along it, `wid` across.
  private rbox(b: Batch, s: number, n: number, y: number, len: number, hgt: number, wid: number, color: number, yaw = 0) {
    const [x, z, h] = this.L(s, n);
    b.box(x, y, z, len, hgt, wid, color, h + yaw);
  }
  // A sign quad at (s, n) facing back down the road (towards the truck) or along it.
  private sign(s: number, n: number, y: number, w: number, hgt: number, uv: ReturnType<SignAtlas["uv"]>, facing = -1) {
    const [x, z, h] = this.L(s, n);
    const dx = Math.cos(h) * facing, dz = -Math.sin(h) * facing;
    this.quads.push({ x: x + dx * 0.08, y, z: z + dz * 0.08, w, h: hgt, rotY: Math.atan2(dx, dz), ...uv });
  }
  private slot(text: string, style: SignStyle) {
    const k = signAtlas.alloc(text, style);
    if (k < 0) return null;
    this.slots.push(k);
    return signAtlas.uv(k);
  }

  private buildSegment(road: CountryRoad, i: number): THREE.Group {
    const s0 = i * SEG, s1 = s0 + SEG;
    road.center(s0, this.p);
    this.ox = this.p.x; this.oz = this.p.z;
    this.quads = []; this.slots = []; this.ads = false;
    const g = new Batch(), s = new Batch();
    const rnd = mulberry32(Math.floor(hash3(i, road.inp.city, 7, road.inp.seed, 0x5e9) * 4294967296));
    // Land: across the road in strips, coloured by biome (fields in farm country). On the outside
    // of a curve the strips fan apart, so each is lengthened to its outer edge's arc. Strips
    // overlap the next ones along the road, so alternate rows sit 1 cm apart: overlapping faces
    // at one height flicker against each other.
    const land = (a: number) => a >= road.landFrom && a <= road.landTo;
    for (let a = s0; a < s1; a += 12) {
      const sm = a + 6, k = Math.abs(road.center(sm, this.p).k), lift = (Math.round(a / 12) & 1) * 0.01;
      if (!land(sm)) continue;
      const strip = (n: number, w: number, y: number, color: number) => this.rbox(g, sm, n, y + lift, 12.4 + k * 12 * (Math.abs(n) + w / 2) * 1.3, 0.1, w, color);
      for (const side of [-1, 1] as const) {
        const bio = this.look(road, sm, side * 50);
        if (bio.fields) {
          let n = 14;
          let f = Math.floor(hash2(Math.floor(a / 96), side, road.inp.seed, 0xf1e) * 97);
          while (n < SIDE_W) { const w = 26 + (f % 4) * 9; strip(side * (n + w / 2), w, -0.12, bio.fields[f % bio.fields.length]); n += w; f = (f * 7 + 3) % 97; }
          strip(side * 7.5, 13, -0.12, bio.ground);
        } else {
          for (let band = 0; band < 4; band++) {
            const w = SIDE_W / 4, n = side * (w * band + w / 2);
            strip(n, w, -0.12, hash3(Math.floor((a + band * 17) / 36), band, side, road.inp.seed, 0x6a) < 0.6 ? bio.ground : bio.ground2);
          }
        }
        if (bio.water && side < 0) {   // the ocean beyond a beach on the left
          strip(-66, 18, -0.08, CW.sand);
          strip(-125, 100, -0.07, CW.water);
        }
      }
    }
    // The road: asphalt, gravel shoulders, edge lines and the double yellow (dashed while passing
    // is allowed on the straights is overkill at this size: solid).
    // Near a gate it widens to a city street's carriageway, to meet the gate street.
    for (let a = s0; a < s1 && a < road.length; a += 6) {
      const sm = a + 3, w = road.widthAt(sm), half = 4.1 + 1.9 * w;
      this.rbox(g, sm, 0, -0.064, 6.2, 0.12, half * 2, CW.asphalt);   // 4 mm under a city street's asphalt, which it meets at the gate
      for (const k of [-1, 1]) { this.rbox(g, sm, k * (half + 0.9), -0.075, 6.2, 0.1, 1.8, CW.shoulder); this.rbox(g, sm, k * (half - 0.25), 0.005, 6.2, 0.02, 0.14, CW.white); }
      if (Math.floor(a / 6) % 2 === 0) this.rbox(g, sm, 0, 0.005, 6.0, 0.02, 0.24, CW.yellow);
    }
    // Utility poles on the right, with the wires between them.
    for (let a = Math.ceil(s0 / 50) * 50; a < s1; a += 50) {
      if (!land(a) || !land(a + 50)) continue;
      if (!road.clearAt(a, 12) && !road.pieces.some((p) => p.kind === "billboards" && a > p.s - 40 && a < p.s + p.len + 40)) continue;
      const [x, z, h] = this.L(a, 12.5);
      s.cyl(x, 4.5, z, 0.14, 9, CW.pole, 6); s.box(x, 8.4, z, 0.14, 0.14, 2.2, CW.pole, h);
      const [x2, z2] = this.L(a + 50, 12.5);
      for (const k of [-0.9, 0.9]) {
        const ax = x + Math.sin(h) * k, az = z + Math.cos(h) * k, bx = x2 + Math.sin(h) * k, bz = z2 + Math.cos(h) * k;
        const mx = (ax + bx) / 2, mz = (az + bz) / 2, L = Math.hypot(bx - ax, bz - az);
        s.box(mx, 8.2, mz, L, 0.05, 0.05, 0x2a2a2a, Math.atan2(-(bz - az), bx - ax));
      }
    }
    // Scenery by biome.
    for (let a = s0; a < s1; a += 6) for (const side of [-1, 1] as const) {
      if (!land(a)) continue;
      const bio = this.look(road, a, side * 40);
      if (bio.fence && rnd() < 0.5 && road.clearAt(a, side * 14) && Math.floor(a / 6) % 1 === 0) {
        const [x, z, h] = this.L(a, side * 14.5);
        s.box(x, 0.6, z, 0.12, 1.2, 0.12, CW.wood, h); s.box(x + Math.cos(h) * 3, 0.85, z - Math.sin(h) * 3, 6, 0.08, 0.06, CW.wood, h); s.box(x + Math.cos(h) * 3, 0.45, z - Math.sin(h) * 3, 6, 0.08, 0.06, CW.wood, h);
      }
      const tries = bio.density * 2.2;
      for (let t = 0; t < tries; t++) {
        if (rnd() > tries - t) break;
        const n = side * (15 + Math.pow(rnd(), 0.8) * (SIDE_W - 20));
        if (bio.water && side < 0 && n < -55) continue;
        const sa = a + rnd() * 6;
        if (!road.clearAt(sa, n)) continue;
        const [x, z] = this.L(sa, n);
        const kind = bio.trees[Math.floor(rnd() * bio.trees.length)], greens = kind === "conifer" || kind === "cypress" || kind === "cactus" ? bio.cgreens : bio.greens;
        this.tree(s, x, z, kind, greens[Math.floor(rnd() * greens.length)], rnd);
      }
      if (rnd() < bio.rocks * 0.25) {
        const n = side * (13 + rnd() * 120), sa = a + rnd() * 6;
        if (road.clearAt(sa, n)) { const [x, z] = this.L(sa, n), r = 0.5 + rnd() * 1.6; s.ico(x, r * 0.3, z, r, rnd() < 0.5 ? 0x8a8478 : 0x9a8a72, 0.6, rnd() * 6); }
      }
      if (bio.ponds && rnd() < 0.02) {
        const n = side * (40 + rnd() * 90), sa = a + rnd() * 6;
        if (road.clearAt(sa, n)) { const [x, z, h] = this.L(sa, n); g.box(x, -0.06, z, 18 + rnd() * 20, 0.1, 10 + rnd() * 14, CW.water, h + rnd()); for (let r = 0; r < 6; r++) s.box(x + (rnd() - 0.5) * 20, 0.5, z + (rnd() - 0.5) * 14, 0.15, 1, 0.15, 0x7a8a3a); }
      }
      if (bio.turbines && Math.floor(a / 6) % 25 === 0 && side > 0) {
        const n = 70 + rnd() * 70, sa = a;
        if (road.clearAt(sa, n)) this.turbine(s, ...this.L(sa, n), rnd);
      }
      if (bio.pylons && Math.floor(a / 6) % 30 === 0 && side < 0) { const [x, z, h] = this.L(a, -60); this.pylon(s, x, z, h); }
      if (bio.barns && Math.floor(a / 6) % 60 === 17 && rnd() < 0.7) {
        const n = side * (45 + rnd() * 50);
        if (road.clearAt(a, n)) this.farm(s, ...this.L(a, n), rnd);
      }
      if (bio.cows && rnd() < 0.05) {
        const n = side * (25 + rnd() * 60);
        if (road.clearAt(a, n)) { const [x, z] = this.L(a, n); for (let c = 0; c < 3; c++) this.cow(s, x + (rnd() - 0.5) * 12, z + (rnd() - 0.5) * 12, rnd() * 6.3); }
      }
    }
    // Set pieces that start in this segment.
    for (const p of road.pieces) if (p.s >= s0 && p.s < s1) this.piece(g, s, p, rnd);
    // Assemble.
    const group = new THREE.Group();
    group.position.set(this.ox, 0, this.oz);
    for (const [b, m] of [[g, this.mats.ground], [s, this.mats.solid]] as const) { const mesh = b.build(m); if (mesh) group.add(mesh); }
    const slots = this.slots;
    let sm: SignMesh | null = null;
    if (this.quads.length) {
      const mesh = new THREE.Mesh(quadGeometry(this.quads), signAtlas.material);
      group.add(mesh); sm = signAtlas.attach(mesh, slots, this.ads);
    }
    for (const f of this.fleetJobs) { const o = this.fleet?.(f); if (o) group.add(o); }
    this.fleetJobs = [];
    const hf = OCCLUSION.add(group, this.ox + this.group.position.x, this.oz + this.group.position.z, [this.mats.ground], "road");   // for the camera (occlusion.ts)
    group.userData.onDispose = () => { for (const k of slots) signAtlas.release(k); if (sm) signAtlas.detach(sm); OCCLUSION.remove(hf); };
    return group;
  }
  private fleetJobs: StallPose[][] = [];

  // ---- scenery ------------------------------------------------------------------------------
  private tree(s: Batch, x: number, z: number, kind: string, green: number, rnd: Rand) { landTree(s, x, z, kind, green, rnd); }
  private turbine(s: Batch, x: number, z: number, _h: number, rnd: Rand) {
    s.cyl(x, 17, z, 0.7, 34, 0xeef0f0, 8);
    s.box(x, 34.3, z, 2.6, 1.2, 1.2, 0xeef0f0);
    const a0 = rnd() * 6.3;
    for (let k = 0; k < 3; k++) { const a = a0 + k * 2.094; s.boxR(x + 1.4, 34.3 + Math.sin(a) * 7, z + Math.cos(a) * 7, 0.15, 14, 0.8, 0xf4f6f6, a, 0, 0); }
  }
  private pylon(s: Batch, x: number, z: number, h: number) {
    for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.boxR(x + dx * 1.6, 9, z + dz * 1.6, 0.25, 18.5, 0.25, 0x9aa0a6, dz * 0.08, 0, -dx * 0.08);
    s.box(x, 18, z, 0.6, 0.5, 9, 0x9aa0a6, h); s.box(x, 14, z, 0.5, 0.4, 7, 0x9aa0a6, h); s.cone(x, 20, z, 1.2, 3, 0x9aa0a6, 4);
  }
  private farm(s: Batch, x: number, z: number, h: number, rnd: Rand) {
    const c = Math.cos(h), sn = Math.sin(h);
    const at = (a: number, n: number): [number, number] => [x + c * a + sn * n, z - sn * a + c * n];
    let [bx, bz] = at(0, 0);
    s.box(bx, 3, bz, 12, 6, 9, 0xa83a2a, h); s.prism(bx, 7.2, bz, 12.4, 2.6, 9.6, 0x4a4f57, h);
    s.box(bx + Math.sin(h) * 4.55, 2, bz + Math.cos(h) * 4.55, 3.4, 4, 0.1, 0xf2ede0, h);
    [bx, bz] = at(9, 2); s.cyl(bx, 6, bz, 2.4, 12, 0xb8bcc0, 10); s.cone(bx, 12.8, bz, 2.5, 1.8, 0x8a9096, 10);
    if (rnd() < 0.7) { [bx, bz] = at(-14, -4); s.box(bx, 2.2, bz, 8, 4.4, 6, 0xf2ede0, h); s.prism(bx, 5.4, bz, 8.4, 2, 6.6, 0x5b6470, h); }
    for (let k = 0; k < 4; k++) { [bx, bz] = at(-4 + k * 3.2, 10 + rnd() * 6); s.cyl(bx, 0.7, bz, 0.7, 1.2, 0xd6b85a, 10, Math.PI / 2, h); }
  }
  private cow(s: Batch, x: number, z: number, h: number) {
    s.box(x, 0.95, z, 1.8, 0.8, 0.7, 0xf2f2ee, h); s.box(x + Math.cos(h) * 0.3, 1.0, z - Math.sin(h) * 0.3, 0.6, 0.6, 0.72, 0x222222, h);
    s.box(x + Math.cos(h) * 1.05, 1.2, z - Math.sin(h) * 1.05, 0.45, 0.45, 0.4, 0x222222, h);
    for (const a of [-0.65, 0.65]) for (const n of [-0.25, 0.25]) s.box(x + Math.cos(h) * a + Math.sin(h) * n, 0.3, z - Math.sin(h) * a + Math.cos(h) * n, 0.14, 0.6, 0.14, 0xe8e8e0, h);
  }

  // ---- set pieces ---------------------------------------------------------------------------
  // A big overhead-height highway sign on two posts (big enough to read across the room).
  private greenSign(s: Batch, p: RoadPiece, text: string) {
    const n = 11, uv = this.slot(text, { bg: "#1e6b3a", fg: "#ffffff", logo: false });
    for (const k of [-5.4, 5.4]) this.rbox(s, p.s, n + k, 3.2, 0.25, 6.4, 0.25, 0x8d9296);
    this.rbox(s, p.s + 0.08, n, 5.2, 0.1, 2.6, 13.4, CW.green);
    this.rbox(s, p.s + 0.08, n, 5.2, 0.08, 2.75, 13.6, 0xf2f2ee);   // white border (its faces inside the board's: shared planes flicker)
    if (uv) this.sign(p.s, n, 5.2, 12.8, 1.6, uv);
  }

  private piece(g: Batch, s: Batch, p: RoadPiece, rnd: Rand) {
    const S = p.s, side = p.side;
    switch (p.kind) {
      case "leave": case "distance": case "welcome": this.greenSign(s, p, p.text ?? ""); break;
      case "billboards": {
        for (let k = 0; k < 3; k++) {
          const a = S + 30 + k * 110, n = (k % 2 ? -1 : 1) * 22, sd = Math.sign(n);
          const pool = [...AD_BILLBOARD, ...AD_BATON, ...AD_BATON, ...AD_RYDER];
          const ad = pool[Math.floor(hash2(k, Math.floor(S), this.road!.inp.seed, 0xad) * pool.length)];
          for (const d of [-3, 3]) this.rbox(s, a, n + d * sd, 3.2, 0.3, 6.4, 0.3, 0x5a5f66);
          this.rbox(s, a + 0.2, n, 9.0, 0.3, 5.4, 15.4, 0x2a2b2e);
          this.rbox(s, a + 0.5, n, 6.3, 0.15, 0.15, 15, 0x5a5f66);   // catwalk
          const [x, z, h] = this.L(a - 0.05, n);
          this.quads.push({ x, y: 9.0, z, w: 14.6, h: 5.0, rotY: Math.atan2(-Math.cos(h), Math.sin(h)), ...signAtlas.adUV(ad) });
          this.ads = true;
        }
        break;
      }
      case "truckstop": {
        // The apron lane beside the road, the store and canopy beyond it, Ryder trucks in the lot.
        for (let a = S - 120; a < S + 150; a += 10) this.rbox(g, a + 5, 13.5, -0.04, 10.2, 0.1, 9, CW.asphalt);
        for (let a = S - 40; a < S + 120; a += 10) this.rbox(g, a + 5, 30, -0.045, 10.2, 0.1, 26, 0x45464b);
        for (let a = S - 100; a < S + 140; a += 6) this.rbox(g, a + 3, 9.0, 0.006, 3, 0.02, 0.14, CW.white);
        this.rbox(s, S + 70, 38, 2.6, 22, 5.2, 10, 0xe8e2d6); this.rbox(s, S + 70, 32.9, 2.0, 21, 4, 0.1, 0x2a3440);
        this.rbox(s, S + 70, 38, 5.5, 22.6, 0.6, 10.6, CW.ryder);
        const uv = this.slot("RYDER TRUCK STOP", { bg: "#ce1126", fg: "#ffffff", logo: true });
        if (uv) { const [x, z, h] = this.L(S + 70, 32.6); this.quads.push({ x, y: 5.5, z, w: 9.6, h: 1.2, rotY: Math.atan2(-Math.sin(h), -Math.cos(h)), ...uv }); }
        // The tall sign at the road, readable from the approach.
        this.rbox(s, S - 60, 20, 7, 0.6, 14, 0.6, 0x5a5f66);
        this.rbox(s, S - 59.7, 20, 14.2, 0.3, 2.2, 9.4, CW.ryder);
        const uv2 = this.slot("RYDER TRUCK STOP", { bg: "#ce1126", fg: "#ffffff", logo: true });
        if (uv2) this.sign(S - 60, 20, 14.2, 9.0, 1.1, uv2);
        // Canopy and pumps.
        for (const a of [S + 10, S + 30]) for (const n of [24, 34]) this.rbox(s, a, n, 2.6, 0.4, 5.2, 0.4, 0xdedbd0);
        this.rbox(s, S + 20, 29, 5.4, 26, 0.6, 14, 0xf2f2ee); this.rbox(s, S + 20, 29, 5.0, 26, 0.3, 14.2, CW.ryder);
        for (const a of [S + 14, S + 26]) this.rbox(s, a, 29, 0.8, 1.0, 1.6, 0.8, 0x5a5f66);
        const stalls: StallPose[] = [];
        for (let k = 0; k < 3; k++) {
          const [x, z, h] = this.L(S + 95 + k * 9, 52);
          stalls.push({ model: (["box26", "box16", "tractor"] as TruckModel[])[k], x, z, h: h + Math.PI / 2 });
        }
        for (let a = S + 85; a < S + 130; a += 10) this.rbox(g, a + 5, 52, -0.045, 10.2, 0.1, 22, 0x45464b);
        this.fleetJobs.push(stalls);
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
        this.rbox(g, S - 22, LANE, 0.006, 0.5, 0.02, 3.4, CW.white);   // stop line
        break;
      }
      case "construction": {
        for (let a = S + 20; a < S + p.len - 20; a += 9) { const [x, z] = this.L(a, 4.4); s.cone(x, 0.4, z, 0.25, 0.8, CW.orange, 6); s.cyl(x, 0.35, z, 0.27, 0.12, 0xf2f2f2, 6); }
        const uv = this.slot("ROAD WORK AHEAD", { bg: "#e8701a", fg: "#111111", logo: false });
        this.rbox(s, S, 9, 1.2, 0.12, 2.4, 0.12, 0x8d9296);
        this.rbox(s, S + 0.05, 9, 2.6, 0.06, 1.0, 5.4, CW.orange);
        if (uv) this.sign(S, 9, 2.6, 5.2, 0.7, uv);
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
        const face = h + (side > 0 ? Math.PI / 2 : -Math.PI / 2);   // facing the road
        const fx = Math.cos(face), fz = -Math.sin(face);
        const names = ["WORLD'S LARGEST COW", "DINO LAND", "WORLD'S LARGEST BALL OF TWINE", "GIANT DONUT"];
        const v = p.variant;
        if (v === 0) {   // a giant Holstein, side on to the road
          const yaw = h;
          const at = (a: number, y: number, b: number): [number, number, number] => [x + Math.cos(yaw) * a + Math.sin(yaw) * b, y, z - Math.sin(yaw) * a + Math.cos(yaw) * b];
          s.box(...at(0, 6, 0), 11, 5, 4.5, 0xf4f4f0, yaw);
          for (const [a, b, w] of [[-2.5, 2.27, 3], [2, 2.27, 2.4], [0.5, -2.27, 3.4]] as const) s.box(...at(a, 6.5, b), w, 2.4, 0.08, 0x1e1e1e, yaw);
          s.box(...at(6.5, 7.5, 0), 3, 3, 3, 0xf4f4f0, yaw); s.box(...at(8.1, 6.8, 0), 0.4, 1.6, 2.2, 0xf2a8b0, yaw);
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
        for (const k of [-2.8, 2.8]) this.rbox(s, S, ns + k, 1.8, 0.16, 3.6, 0.16, CW.wood);
        this.rbox(s, S + 0.05, ns, 3.2, 0.06, 1.2, 7, 0xf5c542);
        if (uv) this.sign(S, ns, 3.2, 6.8, 0.85, uv);
        break;
      }
      case "weigh": {
        for (let a = S; a < S + p.len; a += 10) this.rbox(g, a + 5, 12.5, -0.045, 10.2, 0.1, 7, CW.asphalt);
        this.rbox(g, S + 100, 12.5, 0.01, 20, 0.04, 3.2, 0x8d9296);
        this.rbox(s, S + 100, 22, 2, 8, 4, 6, 0xe8e2d6); this.rbox(s, S + 100, 22, 4.3, 8.6, 0.5, 6.6, 0x5b6470);
        this.rbox(s, S + 100, 18.9, 2.4, 6, 1.4, 0.1, 0x2a3440);
        const uv = this.slot("WEIGH STATION · CLOSED", { bg: "#1e6b3a", fg: "#ffffff", logo: false });
        for (const k of [-3.6, 3.6]) this.rbox(s, S - 80, 10 + k, 2.4, 0.18, 4.8, 0.18, 0x8d9296);
        this.rbox(s, S - 79.94, 10, 4.0, 0.08, 2.0, 8.8, CW.green);
        if (uv) this.sign(S - 80, 10, 4.0, 8.4, 1.05, uv);
        break;
      }
      case "fruit": {
        const n = side * 13, [x, z, h] = this.L(S + 40, n);
        s.box(x, 1.4, z, 6, 2.8, 3.4, 0xc8a46a, h); s.box(x, 3.0, z, 7, 0.3, 4.4, 0xe8e2d6, h);
        for (let k = 0; k < 6; k++) { const ca = Math.cos(h) * (-2.4 + k * 0.95), cz = -Math.sin(h) * (-2.4 + k * 0.95); s.box(x + ca - Math.sin(h) * side * 2.2, 0.9, z + cz - Math.cos(h) * side * 2.2, 0.8, 0.5, 0.8, [0xe8701a, 0xc0392b, 0xf2c200, 0x7ab648][k % 4], h); }
        for (let k = 0; k < 7; k++) { const ca = Math.cos(h) * (-3 + k), cz = -Math.sin(h) * (-3 + k); s.box(x + ca - Math.sin(h) * side * 2.35, 3.4, z + cz - Math.cos(h) * side * 2.35, 1, 0.12, 0.5, k % 2 ? 0xf2f2f2 : CW.red, h); }
        const texts = ["FRESH PEACHES", "SWEET CORN", "CHERRIES · PIE", "PUMPKINS · CIDER"];
        const uv = this.slot(texts[p.variant], { bg: "#f2ede0", fg: "#a83a2a", logo: false });
        this.rbox(s, S, side * 9.5, 0.8, 0.12, 1.6, 0.12, CW.wood);
        this.rbox(s, S + 0.04, side * 9.5, 1.6, 0.05, 0.8, 4.2, 0xf2ede0);
        if (uv) this.sign(S, side * 9.5, 1.6, 4.0, 0.5, uv);
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
        g.box(x, -0.065, z, 24, 0.1, 2 * SIDE_W + 40, CW.water, h);
        for (const k of [-13, 13]) g.box(x + Math.cos(h) * k, -0.075, z - Math.sin(h) * k, 4, 0.1, 2 * SIDE_W + 40, 0x6a5a3a, h);
        for (let k = 0; k < 10; k++) { const n = (k - 4.5) * 30 + (hash2(k, S, 3) - 0.5) * 10; if (Math.abs(n) < 20) continue; const [tx, tz] = this.L(S + 60 + (k % 2 ? 16 : -16), n); this.tree(s, tx, tz, "broad", 0x3c7a46, rnd); }
        for (const n of [-4.8, 4.8]) this.rbox(s, S + 60, n, 2.4, 30, 4.8, 0.25, 0xa83a2a);
        this.rbox(s, S + 60, -2.5, 6.0, 30.8, 1.9, 5.6, 0x4a4f57, 0); this.rbox(s, S + 60, 2.5, 6.0, 30.8, 1.9, 5.6, 0x4a4f57, 0);
        this.rbox(s, S + 60, 0, 6.6, 30.8, 0.6, 10.2, 0x4a4f57);
        for (const a of [-15.2, 15.2]) { this.rbox(s, S + 60 + a, 0, 5.4, 0.4, 1.2, 10, 0xa83a2a); this.rbox(s, S + 60 + a, -4.6, 2.6, 0.4, 5.2, 0.6, 0xf2ede0); this.rbox(s, S + 60 + a, 4.6, 2.6, 0.4, 5.2, 0.6, 0xf2ede0); }
        for (let a = -14; a <= 14; a += 7) for (const n of [-4.8, 4.8]) this.rbox(s, S + 60 + a, n * 1.02, 2.2, 1.2, 0.9, 0.1, 0x2a2020);
        break;
      }
      case "gas": {
        const n = side * 22;
        for (let a = S; a < S + p.len; a += 10) this.rbox(g, a + 5, side * 18, -0.045, 10.2, 0.1, 18, 0x45464b);
        this.rbox(s, S + 40, n, 4.6, 20, 0.5, 10, 0xf2f2ee); this.rbox(s, S + 40, n, 4.3, 20.2, 0.3, 10.2, 0x1f6fb2);
        for (const a of [-7, 7]) this.rbox(s, S + 40 + a, n, 2.2, 0.4, 4.4, 0.4, 0xdedbd0);
        for (const a of [-4, 4]) this.rbox(s, S + 40 + a, n, 0.75, 0.8, 1.5, 0.6, 0xc0392b);
        this.rbox(s, S + 75, side * 30, 2.2, 14, 4.4, 8, 0xe8e2d6); this.rbox(s, S + 75, side * 25.95, 1.8, 10, 2.4, 0.1, 0x2a3440);
        const uv = this.slot(`GAS  $${(3 + p.variant * 0.17 + 0.29).toFixed(2)}`, { bg: "#1f6fb2", fg: "#ffffff", logo: false });
        this.rbox(s, S + 5, side * 11, 3.5, 0.3, 7, 0.3, 0x5a5f66);
        this.rbox(s, S + 5.1, side * 11, 7.2, 0.25, 1.4, 4.8, 0x1f6fb2);
        if (uv) this.sign(S + 5, side * 11, 7.2, 4.6, 0.6, uv);
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
  b.box(-L / 2, 1.25, 0, L - 0.6, 0.4, 3.0, DARK);                          // frame
  b.box(-L / 2, deckY - 0.03, 0, L - 0.6, 0.06, 3.04, GREY);                // walkway deck
  b.box(-L / 2, 1.18, 0, L - 0.6, 0.16, 3.06, YEL);                         // sill safety stripe
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
      b.box(x, 4.25, 0, len, 0.12, 2.6, shade(col, 0.9));
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
export function landTree(s: Batch, x: number, z: number, kind: string, green: number, rnd: Rand) {
  const k = 0.8 + rnd() * 0.6;
  if (BARE.includes(green) && (kind === "broad" || kind === "cypress" || kind === "palm" || kind === "shrub")) {
    if (kind === "shrub") s.ico(x, 0.35 * k, z, 0.7 * k, 0x6e5a48, 0.6, rnd() * 6); else bareTree(s, x, 0, z, 4.6 * k, rnd() * 6);
    return;
  }
  switch (kind) {
    case "conifer": s.cyl(x, 0.6 * k, z, 0.2 * k, 1.2 * k, CW.trunk, 5); s.cone(x, 3.6 * k, z, 1.7 * k, 5.5 * k, green, 7); break;
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
}
