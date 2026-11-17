// The Ryder trucks: five models built from boxes and cylinders, with animated wheels, lights,
// doors, ramp, lift gate, articulating trailer, exhaust and a dashboard interior.
//
// Frame: the truck faces +x, +y is up, +z is the passenger (right) side, so the driver sits at
// -z. The origin is the rear axle centre on the ground (the tandem centre on the tractor), which
// suits bicycle-model steering. Units are metres. Static paint, liner and interior parts are
// merged into one vertex-coloured mesh; only moving parts and lights are separate meshes.
import * as THREE from "three@0.187.0";
import { canBakeTextures, makeCanvas } from "./canvas.ts";
import { Batch, quadGeometry } from "./geom.ts";
import type { Quad } from "./geom.ts";
import { loadFields, saveFields } from "./snap.ts";
import { applyDriverSpot } from "./cutaway.ts";
import { applyLampLight } from "./atmosphere.ts";
import { PuffSystem } from "./puffs.ts";


export type TruckModel = "box16" | "box26" | "reefer" | "tractor" | "flatbed";
const TRUCK_MODELS: TruckModel[] = ["box16", "box26", "reefer", "tractor", "flatbed"];
export type LiveryName = "liverySide26" | "liverySide16" | "liverySideTrailer" | "liveryRear" | "liveryCabDoor";
export const LIVERY_ASSETS: LiveryName[] = ["liverySide26", "liverySide16", "liverySideTrailer", "liveryRear", "liveryCabDoor"];

const TC = {
  white: 0xf4f4f0, frame: 0x1c1c1f, chrome: 0xb9bdc3, black: 0x121214, grille: 0x2b2d31,
  tire: 0x1b1b1b, rim: 0xc8ccd2, hub: 0x6e7278, plywood: 0xa9845a, deck: 0x5e4f3e, alu: 0xa7acb2,
  seat: 0x2c2f36, dash: 0x25272b, cabin: 0x8c9097, reefer: 0xd9dadc, skirt: 0x8d9298, mud: 0x0e0e0e,
  tank: 0xc2c6cc, step: 0x2a2a2a, wood: 0x7a5a3a, frost: 0xdcecff, mat: 0x1a1a1a,
  skin: 0xd8a47f, cup: 0xe8dcc0, lid: 0x3a2a20, tree: 0x2fbf4f, paper: 0xf2f2ea, red: 0xce1126,
};
// The roll-up door's pull strap: how far outside the door plane it hangs, and the height above
// the street its end hangs at when the door is fully open.
export const STRAP_X = 0.04, STRAP_END = 1.7;
const STRAP_COLOR = 0xff6a13, STRAP_GLOW = 0xb04a10;
export interface DoorGeom { x: number; floor: number; open: number; lv: number; strap: number }

interface CargoSpec { kind: "box" | "flatbed"; x0: number; x1: number; floor: number; top: number; hw: number; livery: LiveryName }
interface TruckSpec {
  cab: "conventional" | "cabover" | "daycab";
  wheelR: number;
  frontAxle: number;           // x of the front axle
  rearAxles: number[];         // x of each rear axle (duals)
  frontZ: number; rearZ: number; // wheel-centre half track: front singles, rear dual pair centre
  cabBack: number; cabFront: number; noseFront: number;
  cabFloor: number; cabTop: number; hoodTop: number; frameTop: number; cabHW: number;
  doorLen: number;
  cargo: CargoSpec | null;
  reefer?: boolean;
  fifthWheel?: number;
  loader: "ramp" | "liftgate" | "none";
  exhaust: "stack" | "pipe";
}

export const SPECS: Record<TruckModel, TruckSpec> = {
  box16: {
    cab: "cabover", wheelR: 0.42, frontAxle: 4.0, rearAxles: [0], frontZ: 0.92, rearZ: 0.85,
    cabBack: 3.3, cabFront: 5.1, noseFront: 5.1, cabFloor: 0.95, cabTop: 2.75, hoodTop: 1.65, frameTop: 0.8, cabHW: 1.05,
    doorLen: 1.0, cargo: { kind: "box", x0: -1.7, x1: 3.2, floor: 0.85, top: 3.25, hw: 1.15, livery: "liverySide16" },
    loader: "ramp", exhaust: "pipe",
  },
  box26: {
    cab: "conventional", wheelR: 0.5, frontAxle: 6.6, rearAxles: [0], frontZ: 1.03, rearZ: 0.92,
    cabBack: 5.45, cabFront: 7.25, noseFront: 8.6, cabFloor: 1.05, cabTop: 2.9, hoodTop: 1.8, frameTop: 0.95, cabHW: 1.2,
    doorLen: 1.15, cargo: { kind: "box", x0: -2.6, x1: 5.3, floor: 1.15, top: 3.85, hw: 1.27, livery: "liverySide26" },
    loader: "ramp", exhaust: "pipe",
  },
  reefer: {
    cab: "conventional", wheelR: 0.5, frontAxle: 6.6, rearAxles: [0], frontZ: 1.03, rearZ: 0.92,
    cabBack: 5.45, cabFront: 7.25, noseFront: 8.6, cabFloor: 1.05, cabTop: 2.9, hoodTop: 1.8, frameTop: 0.95, cabHW: 1.2,
    doorLen: 1.15, cargo: { kind: "box", x0: -2.6, x1: 5.3, floor: 1.15, top: 3.85, hw: 1.27, livery: "liverySide26" },
    reefer: true, loader: "liftgate", exhaust: "pipe",
  },
  flatbed: {
    cab: "conventional", wheelR: 0.5, frontAxle: 6.6, rearAxles: [0], frontZ: 1.03, rearZ: 0.92,
    cabBack: 5.45, cabFront: 7.25, noseFront: 8.6, cabFloor: 1.05, cabTop: 2.9, hoodTop: 1.8, frameTop: 0.95, cabHW: 1.2,
    doorLen: 1.15, cargo: { kind: "flatbed", x0: -2.6, x1: 5.25, floor: 1.3, top: 1.3, hw: 1.27, livery: "liverySide26" },
    loader: "none", exhaust: "pipe",
  },
  tractor: {
    cab: "daycab", wheelR: 0.5, frontAxle: 4.9, rearAxles: [-0.65, 0.65], frontZ: 1.05, rearZ: 0.92,
    cabBack: 2.6, cabFront: 4.6, noseFront: 6.4, cabFloor: 1.15, cabTop: 3.05, hoodTop: 1.9, frameTop: 1.05, cabHW: 1.22,
    doorLen: 1.15, cargo: null, fifthWheel: 0.25, loader: "none", exhaust: "stack",
  },
};

// 53 ft dry van, in its own frame: origin at the kingpin, extending to -x.
const TRAILER = { front: 0.9, rear: -15.25, floor: 1.25, top: 4.1, hw: 1.3, axles: [-12.4, -13.65], rearZ: 0.95, wheelR: 0.5, kingpinToAxles: 13.0 };

// Shared across every truck: materials, livery textures, the unit wheel geometry.
export class TruckKit {
  paint = new THREE.MeshLambertMaterial({ vertexColors: true });
  livery = {} as Record<LiveryName, THREE.MeshLambertMaterial>;
  liveryRearDS: THREE.MeshLambertMaterial;
  wheelGeo: THREE.BufferGeometry;
  constructor(images: Record<LiveryName, CanvasImageSource>) {
    for (const name of LIVERY_ASSETS) {
      const tex = new THREE.Texture(images[name] as any);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.needsUpdate = true;
      this.livery[name] = new THREE.MeshLambertMaterial({ map: tex });
    }
    // Roll-up slats and swing doors are seen from inside the box too.
    this.liveryRearDS = new THREE.MeshLambertMaterial({ map: this.livery.liveryRear.map, side: THREE.DoubleSide });
    for (const m of [this.paint, this.liveryRearDS, ...Object.values(this.livery)]) { applyDriverSpot(m); applyLampLight(m); }   // cutaway.ts, atmosphere.ts
    // Unit wheel (radius 1, real width), axis along z; scaled per truck by the instance matrix.
    const w = new Batch();
    w.cyl(0, 0, 0, 1, 0.28, TC.tire, 14, Math.PI / 2);
    w.cyl(0, 0, 0, 0.62, 0.3, TC.rim, 12, Math.PI / 2);
    w.cyl(0, 0, 0, 0.24, 0.33, TC.hub, 8, Math.PI / 2);
    for (let k = 0; k < 4; k++) { // lug blocks on both faces, so rotation reads on the wall
      const a = k * Math.PI / 2;
      w.box(Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0, 0.13, 0.13, 0.34, TC.hub);
    }
    this.wheelGeo = w.build(this.paint)!.geometry;
    this.wheelGeo.userData.shared = true;
  }
}

class LightSet {
  readonly mats = {
    head: new THREE.MeshBasicMaterial({ color: 0x77776a }),
    tail: new THREE.MeshBasicMaterial({ color: 0x4a0606 }),
    reverse: new THREE.MeshBasicMaterial({ color: 0x5a5a5a }),
    sigL: new THREE.MeshBasicMaterial({ color: 0x5a3a00 }),
    sigR: new THREE.MeshBasicMaterial({ color: 0x5a3a00 }),
    clrA: new THREE.MeshBasicMaterial({ color: 0x5a3a00 }),
    clrR: new THREE.MeshBasicMaterial({ color: 0x3a0505 }),
    gauge: new THREE.MeshBasicMaterial({ color: 0x9fb4c8 }),
  };
  set(head: boolean, brake: boolean, reverse: boolean, sigL: boolean, sigR: boolean) {
    const m = this.mats;
    m.head.color.setHex(head ? 0xfffff0 : 0x77776a);
    m.tail.color.setHex(brake ? 0xff2020 : head ? 0xa01010 : 0x4a0606);
    m.reverse.color.setHex(reverse ? 0xffffff : 0x5a5a5a);
    m.sigL.color.setHex(sigL ? 0xffaa00 : 0x5a3a00);
    m.sigR.color.setHex(sigR ? 0xffaa00 : 0x5a3a00);
    m.clrA.color.setHex(head ? 0xffaa00 : 0x5a3a00);
    m.clrR.color.setHex(head ? 0xdd1010 : 0x3a0505);
    m.gauge.color.setHex(head ? 0xbfe6ff : 0x9fb4c8);
  }
}
type LightKey = Exclude<keyof LightSet["mats"], "gauge">;
const LIGHT_KEYS: LightKey[] = ["head", "tail", "reverse", "sigL", "sigR", "clrA", "clrR"];

interface WheelSlot { x: number; z: number; steer: boolean; trailer: boolean; r: number }

// Length extents of a model along x from the rear axle (no instance needed): the nose, and the
// middle of the whole vehicle including a straight trailer (used to centre it on a kerb stop).
export function truckExtents(m: TruckModel) {
  const s = SPECS[m];
  const front = s.noseFront + 0.05;
  const rear = s.fifthWheel !== undefined ? s.fifthWheel + TRAILER.rear : s.cargo ? s.cargo.x0 - 0.1 : -1.4;
  // Where the driver steps down: the cabDoorGround anchor (x along the truck, z to the left).
  return { front, rear, center: (front + rear) / 2, doorX: s.cabFront - 0.62, doorZ: -(s.cabHW + 0.75) };
}

// Loading geometry of a model in its rear-axle frame (x forward, z to the right), for the
// driver's chores (chores.ts): where the bed ends, its floor height and half-width, the loader,
// the walk-ramp's run on the ground, the cab door and the driver's seat.
export function truckLayout(m: TruckModel) {
  const s = SPECS[m], e = truckExtents(m), c = s.cargo;
  const trailer = s.fifthWheel !== undefined;
  const floor = trailer ? TRAILER.floor : c ? c.floor : 1.0;
  const rampLen = floor > 1 ? 3.6 : 3.0, pivotY = floor - 0.16;
  return {
    ...e, loader: s.loader, trailer, flatbed: c?.kind === "flatbed",
    bedRear: trailer ? s.fifthWheel! + TRAILER.rear : c ? c.x0 : e.rear,
    bedFront: trailer ? s.fifthWheel! + TRAILER.front : c ? c.x1 : e.rear,
    floor, hw: trailer ? TRAILER.hw : c ? c.hw : s.cabHW,
    doorTop: c && !trailer && c.kind === "box" ? c.top - 0.28 : floor,   // the roll-up door's bottom edge, fully open
    rampRun: Math.sqrt(rampLen * rampLen - pivotY * pivotY),
    cabFloor: s.cabFloor, cabHW: s.cabHW,
    seat: { x: s.cabFront - 1.445, y: s.cabFloor + 0.5, z: -0.55 },   // hips, seated (5 mm off the seat's faces: shared planes flicker)
  };
}
export type TruckLayout = ReturnType<typeof truckLayout>;

export class Truck {
  readonly spec: TruckSpec;
  readonly root = new THREE.Group();   // world pose
  readonly body = new THREE.Group();   // suspension bob and pitch
  readonly anchors = {
    driverEye: new THREE.Object3D(), passengerEye: new THREE.Object3D(), tablet: new THREE.Object3D(),
    cabDoorGround: new THREE.Object3D(), rearGround: new THREE.Object3D(), cargoSill: new THREE.Object3D(),
  };
  // Motion state (drive() integrates it; phase 4 may set it directly).
  speed = 0; accel = 0; steer = 0; distance = 0; heading = 0;
  // Controls.
  headlights = false; hazards = false; signal: -1 | 0 | 1 = 0; engineOn = true;
  rearDoor = 0; ramp = 0; liftgate = 0; liftgateDrop = 0; cabDoor = 0; trailerDoors = 0;
  trailerYaw = 0;
  interiorView = false;
  private boxParent: THREE.Object3D | null = null; private boxSpec: CargoSpec | null = null;
  private ivTmp = new THREE.Vector3(); private ivTmp2 = new THREE.Vector3();
  cutaway = false;                     // hide the box's street-side wall (camera interior cutaway)
  private nearWall: THREE.Group | null = null;

  private lights = new LightSet();
  private glass = new THREE.MeshBasicMaterial({ color: 0x1d2a3a, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });
  private wheels: THREE.InstancedMesh;
  private wheelSlots: WheelSlot[] = [];
  private driverDoor = new THREE.Group();
  private rampGroup: THREE.Group | null = null;
  private liftGroup: THREE.Group | null = null;
  private trailer: THREE.Group | null = null;
  private trailerBody: THREE.Group | null = null;
  private trailerLeaves: THREE.Group[] = [];
  private slats: { geo: THREE.BufferGeometry; n: number; x: number; floor: number; track: number; open: number; halfW: number; last: number;
    strap: THREE.Mesh; strapLen: number } | null = null;
  private wheelPivot = new THREE.Group();
  private steeringWheel: THREE.Mesh | null = null;
  private needle = new THREE.Group();
  private bobbleHead = new THREE.Group();
  private freshener = new THREE.Group();
  private bob = { x: 0, z: 0, vx: 0, vz: 0 };
  private tabletMat = new THREE.MeshBasicMaterial({ map: placeholderTexture() });
  private strapMat = (() => { const m = new THREE.MeshLambertMaterial({ color: STRAP_COLOR }); applyDriverSpot(m); applyLampLight(m); return m; })();
  private tabletCanvas: { canvas: any; g: CanvasRenderingContext2D } | null = null;
  private exhaust: THREE.Vector3[] = [];
  private puffTimer = 0;
  private time = 0;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private v3 = new THREE.Vector3(); private s3 = new THREE.Vector3(); private tm = new THREE.Matrix4();

  constructor(private kit: TruckKit, readonly model: TruckModel, private puffs: PuffSystem | null = null) {
    this.spec = SPECS[model];
    const s = this.spec;
    this.root.add(this.body);
    const paint = new Batch();
    const lights = this.lightBatches();
    const glass: Quad[] = [];
    const decals: Quad[] = [];

    this.buildChassis(paint, lights);
    this.buildCab(paint, lights, glass, decals);
    this.buildInterior(paint);
    if (s.cargo?.kind === "box") this.buildBox(paint, lights, s.cargo, this.body, s.reefer ?? false);
    if (s.cargo?.kind === "flatbed") this.buildFlatbed(paint, lights, s.cargo);
    if (s.cab === "daycab") this.buildTractorExtras(paint, lights);
    if (s.loader === "ramp" && s.cargo) this.buildRamp(s.cargo);
    if (s.loader === "liftgate" && s.cargo) this.buildLiftgate(s.cargo);

    this.body.add(paint.build(kit.paint)!);
    this.addLights(this.body, lights);
    if (glass.length) this.body.add(new THREE.Mesh(quadGeometry(glass), this.glass));
    if (decals.length) this.body.add(new THREE.Mesh(quadGeometry(decals), kit.livery.liveryCabDoor));
    if (s.fifthWheel !== undefined) this.buildTrailer(s.fifthWheel);

    // Wheels: one instanced mesh in root space (they don't bob with the body).
    for (const x of [s.frontAxle]) for (const z of [-s.frontZ, s.frontZ]) this.wheelSlots.push({ x, z, steer: true, trailer: false, r: s.wheelR });
    for (const x of s.rearAxles) for (const z of [-s.rearZ - 0.17, -s.rearZ + 0.17, s.rearZ - 0.17, s.rearZ + 0.17])
      this.wheelSlots.push({ x, z, steer: false, trailer: false, r: s.wheelR });
    if (this.trailer) for (const x of TRAILER.axles) for (const z of [-TRAILER.rearZ - 0.17, -TRAILER.rearZ + 0.17, TRAILER.rearZ - 0.17, TRAILER.rearZ + 0.17])
      this.wheelSlots.push({ x, z, steer: false, trailer: true, r: TRAILER.wheelR });
    this.wheels = new THREE.InstancedMesh(kit.wheelGeo, kit.paint, this.wheelSlots.length);
    this.wheels.frustumCulled = false;
    this.root.add(this.wheels);
    for (const a of Object.values(this.anchors)) this.body.add(a);
    this.update(0);
  }

  // Overall extents along x (for parking and docking), including a trailer when straight.
  get frontX() { return this.spec.noseFront + 0.05; }
  get rearX() { return this.trailer ? (this.spec.fifthWheel ?? 0) + TRAILER.rear : this.spec.cargo ? this.spec.cargo.x0 - 0.1 : -1.4; }
  get wheelbase() { return this.spec.frontAxle; }

  // The road's height under the rear axle and its grade (out of town: country.ts hills).
  setGrade(y: number, grade: number) { this.root.position.y = y; this.root.rotation.z = Math.atan(grade); }

  setPose(x: number, z: number, heading: number) {
    this.root.position.set(x, this.root.position.y, z); this.heading = heading; this.root.rotation.y = heading;
  }

  // Bicycle-model integration from speed and steer (positive steer turns left).
  drive(dt: number) {
    const d = this.speed * dt;
    const x0 = this.root.position.x, z0 = this.root.position.z, h0 = this.heading;
    this.distance += d;
    this.heading += (d / this.spec.frontAxle) * Math.tan(this.steer);
    this.root.position.x += Math.cos(this.heading) * d;
    this.root.position.z -= Math.sin(this.heading) * d;
    this.root.rotation.y = this.heading;
    this.hitch(x0, z0, h0);
  }

  // The trailer from the tractor's move since (x0, z0, h0): its axles are dragged (or pushed)
  // along the line to the kingpin, so through a turn they cut inside the tractor's path and the
  // trailer swings in behind it (a tractrix), rather than turning rigidly with the cab.
  private hitch(x0: number, z0: number, h0: number) {
    if (!this.trailer) return;
    const fw = this.spec.fifthWheel ?? 0, Lk = TRAILER.kingpinToAxles;
    const th0 = h0 + this.trailerYaw;
    // Old kingpin and trailer axles, then the new kingpin (world x/z; heading h points along (cos h, -sin h)).
    const kx0 = x0 + Math.cos(h0) * fw, kz0 = z0 - Math.sin(h0) * fw;
    const ax = kx0 - Math.cos(th0) * Lk, az = kz0 + Math.sin(th0) * Lk;
    const kx = this.root.position.x + Math.cos(this.heading) * fw, kz = this.root.position.z - Math.sin(this.heading) * fw;
    const th = Math.atan2(-(kz - az), kx - ax);
    const yaw = Math.atan2(Math.sin(th - this.heading), Math.cos(th - this.heading));
    this.trailerYaw = THREE.MathUtils.clamp(yaw, -1.4, 1.4);
  }

  // Where the load sits: the trailer's body for a tractor (its frame starts at the fifth wheel),
  // otherwise the truck body. `offsetX` converts rear-axle-frame x to the parent's frame.
  get bedParent(): { parent: THREE.Object3D; offsetX: number } {
    return this.trailerBody ? { parent: this.trailerBody, offsetX: -(this.spec.fifthWheel ?? 0) } : { parent: this.body, offsetX: 0 };
  }

  // Path following (journey simulation): the rear axle is placed on the path and steering is
  // derived from the path's curvature, so the wheels, body roll and trailer behave as if driven.
  // `d` is the signed distance moved this step (negative when reversing).
  follow(x: number, z: number, heading: number, curvature: number, d: number) {
    const x0 = this.root.position.x, z0 = this.root.position.z, h0 = this.heading;
    this.distance += d;
    this.steer = THREE.MathUtils.clamp(Math.atan(curvature * this.spec.frontAxle), -0.75, 0.75);
    this.setPose(x, z, heading);
    if (d !== 0) this.hitch(x0, z0, h0);
  }

  // The moving parts' state (main.ts: preview snapshots and part-ticks); the meshes follow from it.
  private static SAVED = ["speed", "accel", "steer", "distance", "heading", "hazards", "signal", "engineOn", "rearDoor", "ramp", "liftgate", "liftgateDrop",
    "cabDoor", "trailerDoors", "trailerYaw", "interiorView", "cutaway", "bob", "puffTimer", "time"] as const;
  save() { return { f: saveFields(this, Truck.SAVED), x: this.root.position.x, z: this.root.position.z }; }
  load(s: ReturnType<Truck["save"]>) { loadFields(this, s.f); this.setPose(s.x, s.z, this.heading); this.update(0, this.time); }

  // Free GPU resources (truck swaps). Shared kit geometry and materials are kept.
  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o: any) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); });
    for (const m of Object.values(this.lights.mats)) m.dispose();
    this.glass.dispose();
    this.tabletMat.map?.dispose(); this.tabletMat.dispose();
    this.strapMat.dispose();
  }

  // Air-brake hiss when parking.
  hiss() {
    if (!this.puffs) return;
    this.root.updateMatrixWorld();
    for (const sz of [-1, 1]) for (let k = 0; k < 3; k++) {
      this.v3.set(0.6 + k * 0.4, 0.45, sz * 1.0).applyMatrix4(this.root.matrixWorld);
      const vel = new THREE.Vector3(0, 0.4, sz * 1.2).applyQuaternion(this.root.quaternion);
      this.puffs.emit(this.v3, vel, 0xf0f0f0, 0.22, 0.9);
    }
  }

  // Dash tablet: shown once 2D canvases are available (from the first render frame on the board).
  setTablet(stop: string, cargo: string) {
    if (!canBakeTextures()) return false;
    if (!this.tabletCanvas) {
      this.tabletCanvas = makeCanvas(160, 104);
      const tex = new THREE.CanvasTexture(this.tabletCanvas.canvas);
      tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
      this.tabletMat.map = tex;
    }
    const { g } = this.tabletCanvas;
    g.fillStyle = "#06142b"; g.fillRect(0, 0, 160, 104);
    g.fillStyle = "#ce1126"; g.fillRect(0, 0, 160, 24);
    g.fillStyle = "#ffffff"; g.font = "bold 15px sans-serif"; g.textBaseline = "middle";
    g.fillText("NEXT STOP", 8, 13);
    g.font = "bold 18px sans-serif"; g.fillText(fitText(g, stop.toUpperCase(), 146), 8, 46);
    g.fillStyle = "#ffd23a"; g.fillText(fitText(g, cargo.toUpperCase(), 146), 8, 78);
    this.tabletMat.map!.needsUpdate = true;
    return true;
  }

  // `time` (journey time, when given) keeps the blinkers in step after a scrub.
  update(dt: number, time?: number) {
    this.time = time ?? this.time + dt;
    const s = this.spec;
    // Wheels (trailer pose first, so its wheels use this frame's articulation).
    let i = 0;
    if (this.trailer) { this.trailer.rotation.y = this.trailerYaw; this.trailer.updateMatrix(); }
    const tmat = this.trailer ? this.trailer.matrix : null;
    for (const w of this.wheelSlots) {
      this.e.set(0, w.steer ? this.steer : 0, -this.distance / w.r);
      this.q.setFromEuler(this.e);
      this.m4.compose(this.v3.set(w.x, w.r, w.z), this.q, this.s3.set(w.r, w.r, 1));
      if (w.trailer && tmat) this.m4.premultiply(tmat);
      this.wheels.setMatrixAt(i++, this.m4);
    }
    this.wheels.instanceMatrix.needsUpdate = true;

    // Suspension: a little bounce with speed, pitch with acceleration (nose dips when braking).
    const moving = Math.min(Math.abs(this.speed) / 6, 1);
    this.body.position.y = 0.025 * moving * Math.sin(this.distance * 1.9) + 0.012 * moving * Math.sin(this.distance * 4.3);
    this.body.rotation.z = THREE.MathUtils.clamp(this.accel * 0.0025, -0.012, 0.012);
    // Roll away from the turn (a left turn leans the body toward +z).
    this.body.rotation.x = THREE.MathUtils.clamp(this.speed * this.speed * Math.tan(this.steer) / s.frontAxle * 0.004, -0.02, 0.02);

    // Lights.
    const blink = (this.time % 0.7) < 0.35;
    const brake = this.engineOn && (this.accel < -0.4 || Math.abs(this.speed) < 0.05);
    this.strapMat.emissive.setHex(this.headlights ? STRAP_GLOW : 0x000000);
    this.lights.set(this.headlights, brake, this.speed < -0.05,
      (this.signal === -1 || this.hazards) && blink, (this.signal === 1 || this.hazards) && blink);

    // Moving parts.
    this.driverDoor.rotation.y = -1.25 * ease(this.cabDoor);
    if (this.slats && Math.abs(this.slats.last - this.rearDoor) > 1e-4) this.layoutSlats(this.rearDoor);
    if (this.rampGroup && s.cargo) {
      const a = THREE.MathUtils.clamp(this.ramp / 0.65, 0, 1), b = THREE.MathUtils.clamp((this.ramp - 0.65) / 0.35, 0, 1);
      const len = this.rampGroup.userData.len as number, pivotY = s.cargo.floor - 0.16;
      this.rampGroup.position.set(s.cargo.x0 + len * (1 - ease(a)), pivotY, 0);
      this.rampGroup.rotation.z = Math.asin(Math.min(1, (pivotY - 0.02) / len)) * ease(b);
    }
    if (this.liftGroup && s.cargo) {
      const a = THREE.MathUtils.clamp(this.liftgate / 0.6, 0, 1), b = THREE.MathUtils.clamp((this.liftgate - 0.6) / 0.4, 0, 1);
      const len = 1.5, stowY = s.cargo.floor - 0.32;
      const y = stowY + (s.cargo.floor - stowY) * ease(b);
      this.liftGroup.position.set(s.cargo.x0 + len * (1 - ease(a)), y + (0.06 - y) * ease(this.liftgateDrop), 0);
    }
    if (this.trailer) {
      const open = ease(this.trailerDoors) * 4.55; // ~260 degrees, folded back against the sides
      if (this.trailerLeaves.length === 2) { this.trailerLeaves[0].rotation.y = open; this.trailerLeaves[1].rotation.y = -open; }
      if (this.trailerBody) this.trailerBody.position.y = this.body.position.y * 0.6;
    }

    // Interior: speedometer, steering wheel, bobblehead and air freshener on springs.
    this.needle.rotation.x = -THREE.MathUtils.clamp(Math.abs(this.speed) / 30, 0, 1) * 4.2;
    if (this.steeringWheel) this.steeringWheel.rotation.z = this.steer * 14;
    const lateral = this.speed * this.speed * Math.tan(this.steer) / s.frontAxle;
    if (dt > 0) {
      const n = Math.max(1, Math.ceil(dt * 30 - 1e-6)), h = Math.min(dt, 0.2) / n, b = this.bob;
      for (let i = 0; i < n; i++) {
        b.vx += (-60 * b.x - 6 * b.vx - this.accel * 2.5) * h; b.x += b.vx * h;
        b.vz += (-60 * b.z - 6 * b.vz + lateral * 2.5) * h; b.z += b.vz * h;
      }
    }
    this.bobbleHead.rotation.set(THREE.MathUtils.clamp(this.bob.z * 0.2, -0.5, 0.5), 0, THREE.MathUtils.clamp(-this.bob.x * 0.2, -0.5, 0.5));
    this.freshener.rotation.set(THREE.MathUtils.clamp(this.bob.z * 0.35, -0.8, 0.8), 0, THREE.MathUtils.clamp(-this.bob.x * 0.35, -0.8, 0.8));
    this.glass.opacity = this.interiorView ? 0.22 : 0.72;
    if (this.nearWall) this.nearWall.visible = !this.cutaway;

    // Exhaust: a light idle trickle, darker and faster under acceleration.
    if (this.puffs && this.engineOn && dt > 0) {
      const hard = this.accel > 0.3;
      this.puffTimer -= dt * (hard ? 11 : 2.2);
      if (this.puffTimer <= 0) {
        this.puffTimer += 1;
        this.root.updateMatrixWorld();
        for (const p of this.exhaust) {
          this.v3.copy(p).applyMatrix4(this.body.matrixWorld);
          const up = s.exhaust === "stack" ? 1.1 : 0.35;
          const vel = new THREE.Vector3(-0.6, up, s.exhaust === "pipe" ? 0.5 : 0).applyQuaternion(this.root.quaternion);
          this.puffs.emit(this.v3, vel, hard ? 0x4c4c4e : 0x8e8e90, hard ? 0.42 : 0.26, hard ? 1.6 : 1.2);
        }
      }
    }
  }

  // ---- construction --------------------------------------------------------------------------

  private lightBatches(): Record<LightKey, Batch> {
    const r = {} as Record<LightKey, Batch>;
    for (const k of LIGHT_KEYS) r[k] = new Batch();
    return r;
  }
  private addLights(parent: THREE.Object3D, lights: Record<LightKey, Batch>) {
    for (const k of LIGHT_KEYS) { const m = lights[k].build(this.lights.mats[k]); if (m) parent.add(m); }
  }

  private buildChassis(P: Batch, L: Record<LightKey, Batch>) {
    const s = this.spec, ft = s.frameTop;
    const rear = s.cargo ? s.cargo.x0 + 0.1 : -1.35;
    for (const z of [-1, 1]) P.span(rear, ft - 0.24, z * 0.36, s.noseFront - 0.15, ft, z * 0.48, TC.frame); // rails
    for (let x = rear + 0.3; x < s.cabBack; x += 1.1) P.span(x, ft - 0.2, -0.36, x + 0.08, ft - 0.04, 0.36, TC.frame);
    // Fuel tank (passenger side) and battery box (driver side), between the axles.
    const tx = Math.min(s.cabBack, s.frontAxle - 0.9) - 0.6;
    P.cyl(tx, ft - 0.36, 0.86, 0.25, 1.0, TC.tank, 10, 0, Math.PI / 2);
    P.span(tx - 0.45, 0.38, -1.08, tx + 0.35, 0.86, -0.62, TC.frame);
    // Mudflaps behind the rear wheels.
    const mx = Math.min(...s.rearAxles) - s.wheelR - 0.12;
    for (const z of [-1, 1]) P.span(mx - 0.03, 0.18, z * 0.72, mx + 0.01, 0.9, z * 1.18, TC.mud);
    // Exhaust.
    if (s.exhaust === "pipe") {
      const px = Math.max(...s.rearAxles) + s.wheelR + 0.5;
      P.cyl(px, 0.45, 0.95, 0.05, 0.4, TC.chrome, 6, Math.PI / 2);
      this.exhaust.push(new THREE.Vector3(px, 0.45, 1.18));
    }
    if (!s.cargo && s.cab === "daycab") { // tractor tail lights on the frame end
      for (const z of [-1, 1]) {
        L.tail.span(rear - 0.06, ft - 0.2, z * 0.62, rear, ft - 0.05, z * 0.9);
        (z < 0 ? L.sigL : L.sigR).span(rear - 0.06, ft - 0.2, z * 0.92, rear, ft - 0.05, z * 1.05);
      }
    }
  }

  // The dome lights inside the cargo box and the cab (atmosphere.ts INTERIOR_LIGHT): for each, the
  // inside of the box in world space as (centre, yaw) and (half sizes, on). Only the faces inside
  // a box catch its light, so the outside of the truck stays as it is.
  interiorLight(out: THREE.Vector4[], cargoOn: boolean, cabOn: boolean) {
    const box = (i: number, parent: THREE.Object3D, x0: number, x1: number, y0: number, y1: number, hw: number, on: boolean) => {
      parent.updateWorldMatrix(true, false);
      const c = this.ivTmp.set((x0 + x1) / 2, (y0 + y1) / 2, 0).applyMatrix4(parent.matrixWorld);
      const f = this.ivTmp2.set(1, 0, 0).transformDirection(parent.matrixWorld);
      out[i].set(c.x, c.y, c.z, Math.atan2(-f.z, f.x));
      // (w: off 0, on 2 + the body's pitch, so the box tilts with it up a ramp: atmosphere.ts.)
      out[i + 1].set((x1 - x0) / 2, (y1 - y0) / 2, hw, on ? 2 + Math.atan2(f.y, Math.hypot(f.x, f.z)) : 0);
    };
    const c = this.boxSpec;
    if (c && this.boxParent) box(0, this.boxParent, c.x0 + 0.12, c.x1 - 0.07,   // starts behind the closed rear door (x0 + 0.09), which is one double-sided sheet
       c.floor - 0.01, c.top - 0.07, c.hw - 0.06, cargoOn); else out[1].w = 0;
    const s = this.spec;
    box(2, this.body, s.cabBack + 0.06, s.cabFront - 0.03, s.cabFloor - 0.01, s.cabTop - 0.06, s.cabHW - 0.06, cabOn);
  }

  private buildCab(P: Batch, L: Record<LightKey, Batch>, glass: Quad[], decals: Quad[]) {
    const s = this.spec, xb = s.cabBack, xf = s.cabFront, xn = s.noseFront, yf = s.cabFloor, yt = s.cabTop, hw = s.cabHW;
    const conventional = s.cab !== "cabover";
    const belt = yf + (conventional ? 0.88 : 0.92), winTop = yt - 0.16;
    const yh = conventional ? s.hoodTop : belt - 0.12;     // windshield sill
    const dxf = xf - 0.07, dxb = dxf - s.doorLen;
    P.span(xb, yf - 0.1, -hw, xf, yf, hw, TC.frame);                 // cab floor
    P.span(xb, yf, -hw, xb + 0.07, yt, hw, TC.white);                // back wall
    P.span(xb, yt - 0.07, -hw, xf, yt, hw, TC.white);                // roof
    P.span(xf - 0.07, yf, -hw, xf, yh, hw, TC.white);                // front below the windshield
    for (const z of [-1, 1]) P.span(xf - 0.07, yh, z * hw, xf, yt, z * (hw - 0.11), TC.white); // A-pillars
    P.span(xf - 0.07, winTop, -hw, xf, yt, hw, TC.white);            // windshield header
    glass.push({ x: xf - 0.035, y: (yh + winTop) / 2, z: 0, w: 2 * (hw - 0.11), h: winTop - yh, rotY: Math.PI / 2 });
    for (const z of [-1, 1]) {
      const zo = z * hw, zi = z * (hw - 0.07);
      P.span(xb + 0.07, yf, zo, dxb, yt - 0.07, zi, TC.white);       // rear quarter and B-pillar
      if (z > 0) { // passenger door: static
        P.span(dxb, yf, zo, dxf, belt, zi, TC.white);
        P.span(dxb, winTop, zo, dxf, yt - 0.07, zi, TC.white);
        P.span(dxf - 0.06, belt, zo, dxf, winTop, zi, TC.white);
        glass.push({ x: (dxb + dxf - 0.06) / 2, y: (belt + winTop) / 2, z: z * (hw - 0.035), w: dxf - 0.06 - dxb, h: winTop - belt });
        decals.push({ x: (dxb + dxf) / 2, y: (yf + belt) / 2, z: zo + 0.004, w: dxf - dxb, h: belt - yf });
      }
      P.span(dxf, yf, zo, xf - 0.07, yt - 0.07, zi, TC.white);       // strip ahead of the door
      // Steps and mirrors.
      P.span(dxb + 0.15, 0.5, z * (hw - 0.05), dxf - 0.25, 0.57, z * (hw + 0.16), TC.step);
      P.span(dxb + 0.15, yf - 0.32, z * (hw - 0.05), dxf - 0.25, yf - 0.25, z * (hw + 0.12), TC.step);
      P.span(xf - 0.2, belt + 0.38, zo, xf - 0.12, belt + 0.43, z * (hw + 0.24), TC.black);
      P.span(xf - 0.25, belt + 0.12, z * (hw + 0.2), xf - 0.11, belt + 0.62, z * (hw + 0.32), TC.black);
    }
    for (const z of [-0.3, 0, 0.3]) L.clrA.box(xf - 0.1, yt + 0.035, z, 0.08, 0.07, 0.12); // cab marker lights (taller than the roof cap)

    // Driver door (hinged at its front edge, swings out to -z).
    const D = new Batch(), dl = s.doorLen;
    D.span(-dl, yf, 0, 0, belt, 0.07, TC.white);
    D.span(-dl, winTop, 0, 0, yt - 0.07, 0.07, TC.white);
    D.span(-0.06, belt, 0, 0, winTop, 0.07, TC.white);
    D.span(-dl, belt, 0, -dl + 0.06, winTop, 0.07, TC.white);
    D.span(-dl + 0.05, yf + 0.05, 0.07, -0.05, belt, 0.09, TC.cabin);   // inner trim
    D.span(-dl + 0.12, belt - 0.15, -0.02, -dl + 0.3, belt - 0.1, 0, TC.black); // handle
    this.driverDoor.add(D.build(this.kit.paint)!);
    this.driverDoor.add(new THREE.Mesh(quadGeometry([{ x: -(dl - 0.06) / 2 - 0.06, y: (belt + winTop) / 2, z: 0.035, w: dl - 0.12, h: winTop - belt, rotY: Math.PI }]), this.glass));
    this.driverDoor.add(new THREE.Mesh(quadGeometry([{ x: -dl / 2, y: (yf + belt) / 2, z: -0.004, w: dl, h: belt - yf, rotY: Math.PI }]), this.kit.livery.liveryCabDoor));
    this.driverDoor.position.set(dxf, 0, -hw);
    this.body.add(this.driverDoor);

    // Roof cap and a sun visor over the windshield; wipers at its base.
    P.span(xb + 0.12, yt, -hw + 0.14, xf - 0.12, yt + 0.06, hw - 0.14, TC.white);
    P.span(xf - 0.04, winTop + 0.02, -hw + 0.06, xf + 0.14, winTop + 0.07, hw - 0.06, TC.black);
    for (const z of [-0.45, 0.35]) P.boxR(xf + 0.01, yh + 0.12, z, 0.03, 0.03, 0.62, TC.black, 0.35, 0, 0);
    const R2 = 2 * s.wheelR, fa = s.frontAxle;
    if (conventional) {
      // Hood: nearly as wide as the cab, its top sloping down to the grille.
      const hH = hw - 0.1, hl = xn - xf, drop = 0.2, nose = xn - 0.1;
      P.span(xf, 0.7, -hH, nose - 0.12, yh - drop - 0.06, hH, TC.white);
      P.boxR(xf + hl / 2 - 0.05, yh - drop / 2 - 0.1, 0, hl + 0.04, 0.2, 2 * hH, TC.white, 0, 0, -Math.atan(drop / hl));
      // Grille: a chrome surround, dark mesh recessed behind it, horizontal bars.
      const gy0 = 0.78, gy1 = yh - drop - 0.1, gz = 0.62;
      P.span(nose - 0.1, gy0, -gz + 0.06, nose - 0.04, gy1, gz - 0.06, TC.grille);
      P.span(nose - 0.06, gy1 - 0.05, -gz, nose + 0.02, gy1 + 0.04, gz, TC.chrome);
      P.span(nose - 0.06, gy0 - 0.04, -gz, nose + 0.02, gy0 + 0.04, gz, TC.chrome);
      for (const z of [-1, 1]) P.span(nose - 0.06, gy0, z * (gz - 0.06), nose + 0.02, gy1, z * gz, TC.chrome);
      for (let k = 1; k < 4; k++) { const y = gy0 + (gy1 - gy0) * k / 4; P.span(nose - 0.07, y - 0.015, -gz + 0.07, nose - 0.02, y + 0.015, gz - 0.07, TC.alu); }
      for (const z of [-1, 1]) {
        // Fender: a flare over the wheel and a corner running forward to the nose, carrying the
        // headlamp and the turn signal; a black liner in the wheel well.
        const zo = z * (hw + 0.08), zi = z * (hH - 0.32);
        P.span(fa - 0.72, R2 + 0.04, zi, fa + 0.6, R2 + 0.2, zo, TC.white);
        P.boxR(fa - 0.84, R2 - 0.12, (zi + zo) / 2, 0.36, 0.14, Math.abs(zo - zi), TC.white, 0, 0, 0.9);
        P.span(fa + 0.5, 0.7, zi, nose, R2 + 0.2, zo * 0.99, TC.white);
        P.span(nose - 0.3, R2 + 0.2, z * gz, nose - 0.04, yh - drop - 0.06, z * (hH - 0.02), TC.white);   // beside the grille
        P.span(fa - 0.7, R2 - 0.1, z * (hw - 0.45), fa + 0.5, R2 + 0.04, z * (hw - 0.05), TC.mud);
        L.head.span(nose - 0.02, R2 - 0.08, z * (hH - 0.22), nose + 0.01, R2 + 0.1, z * (hH + 0.05));
        (z < 0 ? L.sigL : L.sigR).span(nose - 0.03, R2 - 0.08, z * (hH + 0.07), nose + 0.01, R2 + 0.1, z * (hw + 0.06));   // proud of the fender
      }
      // Bumper tight under the nose, a black valance below it.
      P.span(nose - 0.04, 0.44, -hw + 0.02, nose + 0.1, 0.7, hw - 0.02, TC.chrome);
      P.span(nose - 0.12, 0.3, -hw + 0.12, nose + 0.04, 0.44, hw - 0.12, TC.black);
    } else {
      // Cab-over face: a dark grille band with chrome slats, lamps in the corners, a wrapped bumper.
      P.span(xf - 0.02, yf + 0.12, -0.78, xf + 0.02, belt - 0.28, 0.78, TC.grille);
      for (let k = 0; k < 3; k++) { const y = yf + 0.2 + k * ((belt - 0.4 - yf - 0.2) / 2); P.span(xf, y - 0.02, -0.74, xf + 0.035, y + 0.02, 0.74, TC.chrome); }
      for (const z of [-1, 1]) {
        P.span(xf - 0.02, yf + 0.12, z * 0.78, xf + 0.02, belt - 0.28, z * (hw - 0.02), TC.white);
        L.head.span(xf, yf + 0.16, z * (hw - 0.36), xf + 0.04, yf + 0.36, z * (hw - 0.08));
        (z < 0 ? L.sigL : L.sigR).span(xf - 0.2, yf + 0.16, z * (hw - 0.02), xf - 0.02, yf + 0.36, z * (hw + 0.01));
        // Wheel arch: a white flare over a black liner.
        P.span(fa - 0.62, R2 + 0.03, z * (hw - 0.3), fa + 0.62, R2 + 0.16, z * (hw + 0.03), TC.white);
        P.span(fa - 0.6, R2 - 0.15, z * (hw - 0.4), fa + 0.6, R2 + 0.03, z * (hw - 0.05), TC.mud);
      }
      P.span(xf, 0.42, -hw + 0.04, xf + 0.12, 0.66, hw - 0.04, TC.chrome);
      for (const z of [-1, 1]) P.span(xf - 0.3, 0.42, z * (hw - 0.04), xf + 0.06, 0.66, z * (hw + 0.02), TC.black);   // bumper ends
    }

    this.anchors.driverEye.position.set(xf - 1.25, yf + 1.22, -0.55);
    this.anchors.passengerEye.position.set(xf - 1.25, yf + 1.22, 0.55);
    this.anchors.cabDoorGround.position.set(dxf - 0.55, 0, -(hw + 0.75));
  }

  private buildInterior(P: Batch) {
    const s = this.spec, xb = s.cabBack, xf = s.cabFront, yf = s.cabFloor, yt = s.cabTop, hw = s.cabHW;
    const belt = yf + (s.cab === "cabover" ? 0.92 : 0.88), yd = belt - 0.05, winTop = yt - 0.16;
    P.span(xb + 0.09, yf, -hw + 0.07, xf - 0.07, yf + 0.01, hw - 0.09, TC.mat);                 // floor mat, clear of the trims
    P.span(xb + 0.07, yf, -hw + 0.07, xb + 0.09, yt - 0.07, hw - 0.07, TC.cabin);      // back wall trim
    P.span(xb + 0.07, yt - 0.09, -hw + 0.07, xf - 0.07, yt - 0.07, hw - 0.07, TC.cabin); // headliner
    P.span(xb + 0.07, yf, hw - 0.09, xf - 0.07, belt, hw - 0.07, TC.cabin);              // passenger side trim
    P.span(xf - 0.66, yd - 0.42, -hw + 0.08, xf - 0.07, yd, hw - 0.08, TC.dash);          // dashboard
    P.span(xf - 0.72, yd, -0.88, xf - 0.46, yd + 0.11, -0.22, TC.dash);                   // gauge hood
    P.span(xf - 1.42, yf, -0.18, xf - 0.66, yf + 0.44, 0.18, TC.dash);                    // console
    for (const z of [-1, 1]) {                                                            // seats
      P.span(xf - 1.48, yf + 0.36, z * 0.25, xf - 0.96, yf + 0.5, z * 0.86, TC.seat);
      P.span(xf - 1.53, yf + 0.5, z * 0.27, xf - 1.4, yf + 1.22, z * 0.84, TC.seat);
      P.span(xf - 1.53, yf + 1.26, z * 0.38, xf - 1.43, yf + 1.46, z * 0.72, TC.seat);
      P.span(xf - 0.36, winTop - 0.05, z * 0.18, xf - 0.1, winTop, z * 0.94, TC.cabin);   // sun visors
    }
    // Coffee cup, clipboard, rear-view mirror.
    P.cyl(xf - 0.95, yf + 0.51, 0.0, 0.045, 0.13, TC.cup, 8);
    P.cyl(xf - 0.95, yf + 0.585, 0.0, 0.048, 0.02, TC.lid, 8);
    P.span(xf - 1.35, yf + 0.5, 0.35, xf - 1.05, yf + 0.52, 0.62, TC.wood);
    P.span(xf - 1.32, yf + 0.52, 0.38, xf - 1.08, yf + 0.53, 0.59, TC.paper);
    P.span(xf - 0.16, winTop - 0.12, -0.14, xf - 0.11, winTop - 0.05, 0.14, TC.black);
    P.span(xf - 0.14, winTop - 0.05, -0.01, xf - 0.12, winTop, 0.01, TC.black);

    // Gauges (lit) and speedometer needle.
    const G = new Batch();
    for (const z of [-0.68, -0.42]) G.cyl(xf - 0.715, yd + 0.02, z, 0.085, 0.02, 0xffffff, 12, 0, Math.PI / 2);   // faces 5 mm proud of the hood
    this.body.add(G.build(this.lights.mats.gauge)!);
    const N = new Batch(); N.span(-0.006, 0, -0.004, 0.006, 0.07, 0.004, TC.red);
    this.needle.add(N.build(this.kit.paint)!);
    this.needle.position.set(xf - 0.725, yd + 0.02, -0.68);
    this.body.add(this.needle);

    // Steering wheel: a ring of short segments, three spokes, a red hub.
    const W = new Batch();
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      W.boxR(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0, 0.1, 0.035, 0.035, TC.black, 0, 0, a + Math.PI / 2);
    }
    for (const a of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) W.boxR(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0, 0.2, 0.03, 0.025, TC.black, 0, 0, a);
    W.cyl(0, 0, 0, 0.055, 0.04, TC.red, 10, Math.PI / 2);
    this.steeringWheel = W.build(this.kit.paint)!;
    this.wheelPivot.add(this.steeringWheel);
    this.wheelPivot.position.set(xf - 0.92, yd + 0.02, -0.55);
    this.wheelPivot.rotation.set(-0.5, -Math.PI / 2, 0, "YXZ"); // face the driver (-x), top tilted toward the dash
    this.body.add(this.wheelPivot);
    P.boxR(xf - 0.78, yd - 0.06, -0.55, 0.32, 0.07, 0.07, TC.black, 0, 0, -0.5);          // column

    // Tablet on a dash mount, angled toward the driver.
    const tablet = new THREE.Group();
    const T = new Batch(); T.span(0.005, -0.1, -0.15, 0.03, 0.1, 0.15, TC.black);
    tablet.add(T.build(this.kit.paint)!);
    tablet.add(new THREE.Mesh(quadGeometry([{ x: 0, y: 0, z: 0, w: 0.27, h: 0.175, rotY: -Math.PI / 2 }]), this.tabletMat));
    tablet.position.set(xf - 0.6, yd + 0.17, -0.05);
    tablet.rotation.z = -0.3;
    this.body.add(tablet);
    P.span(xf - 0.6, yd, -0.06, xf - 0.56, yd + 0.08, -0.04, TC.black);
    this.anchors.tablet.position.copy(tablet.position);

    // Bobblehead on the dash (passenger side) and a pine-tree air freshener on the mirror.
    const BB = new Batch();
    BB.cyl(0, 0.05, 0, 0.03, 0.1, 0x2050c0, 6);
    this.body.add(BB.build(this.kit.paint)!.translateX(xf - 0.3).translateY(yd).translateZ(0.72));
    const H = new Batch(); H.box(0, 0.045, 0, 0.07, 0.07, 0.07, TC.skin); H.box(0, 0.088, 0, 0.075, 0.02, 0.075, TC.red);
    this.bobbleHead.add(H.build(this.kit.paint)!);
    this.bobbleHead.position.set(xf - 0.3, yd + 0.1, 0.72);
    this.body.add(this.bobbleHead);
    const F = new Batch(); F.span(-0.002, -0.06, -0.002, 0.002, 0, 0.002, TC.paper); F.cone(0, -0.11, 0, 0.035, 0.09, TC.tree, 4);
    this.freshener.add(F.build(this.kit.paint)!);
    this.freshener.position.set(xf - 0.135, winTop - 0.12, 0.08);
    this.body.add(this.freshener);
  }

  private buildBox(P: Batch, L: Record<LightKey, Batch>, c: CargoSpec, parent: THREE.Object3D, reefer: boolean, swing = false) {
    const { x0, x1, floor: yfl, top: yt, hw } = c;
    this.boxParent = parent; this.boxSpec = c;
    // (Parts that meet are kept off each other's planes: faces sharing a plane flicker.)
    P.span(x0, yfl - 0.12, -hw + 0.06, x1, yfl, hw - 0.06, TC.frame);           // floor plate, inside the walls
    // The street-side (left) wall is its own group so the camera's interior cutaway can hide it.
    const W = new Batch();
    for (const z of [-1, 1]) (z < 0 ? W : P).span(x0, yfl - 0.12, z * (hw - 0.05), x1, yt, z * hw, TC.white);
    P.span(x0, yt - 0.06, -hw, x1, yt, hw, TC.white);                           // roof
    P.span(x1 - 0.06, yfl, -hw, x1, yt, hw, TC.white);                          // front wall
    for (const z of [-1, 1]) P.span(x0 - 0.04, yfl - 0.12, z * (hw - 0.12), x0 + 0.06, yt, z * hw, TC.white); // rear posts
    P.span(x0 - 0.04, yt - 0.28, -hw, x0 + 0.06, yt, hw, TC.white);             // rear header
    P.span(x0 - 0.06, yfl - 0.12, -hw + 0.125, x0 + 0.06, yfl + 0.02, hw - 0.125, TC.alu);   // rear sill, between the posts
    for (let x = x0 + 0.3; x < x1; x += 0.6) P.span(x, yfl - 0.3, -hw + 0.06, x + 0.08, yfl - 0.12, hw - 0.06, TC.frame);
    // Under-ride guard.
    P.span(x0 + 0.05, 0.42, -hw + 0.12, x0 + 0.16, 0.58, hw - 0.12, TC.black);
    for (const z of [-1, 1]) P.span(x0 + 0.08, 0.58, z * (hw - 0.45), x0 + 0.14, yfl - 0.3, z * (hw - 0.35), TC.black);
    // Interior liner, floor and E-track.
    for (const z of [-1, 1]) {
      const B = z < 0 ? W : P;
      B.span(x0 + 0.06, yfl, z * (hw - 0.07), x1 - 0.06, yt - 0.06, z * (hw - 0.05), TC.plywood);
      for (const y of [yfl + 0.9, yfl + 1.6]) B.span(x0 + 0.1, y, z * (hw - 0.075), x1 - 0.1, y + 0.08, z * (hw - 0.07), TC.frame);
    }
    P.span(x0 + 0.06, yt - 0.08, -hw + 0.07, x1 - 0.06, yt - 0.06, hw - 0.07, TC.plywood);
    P.span(x1 - 0.08, yfl, -hw + 0.07, x1 - 0.06, yt - 0.06, hw - 0.07, TC.plywood);
    P.span(x0 + 0.02, yfl, -hw + 0.07, x1 - 0.06, yfl + 0.012, hw - 0.07, TC.deck);
    if (reefer) {
      P.span(x1, yt - 0.95, -0.85, x1 + 0.42, yt - 0.05, 0.85, TC.reefer);
      P.span(x1 + 0.42, yt - 0.85, -0.7, x1 + 0.44, yt - 0.15, 0.7, TC.grille);
      for (const z of [-0.35, 0.35]) P.cyl(x1 + 0.445, yt - 0.5, z, 0.22, 0.01, TC.black, 10, 0, Math.PI / 2);
      for (const z of [-1, 1]) P.span(x0 + 0.06, yfl + 0.02, z * (hw - 0.13), x0 + 0.08, yt - 0.29, z * (hw - 0.11), TC.frost);
      P.span(x0 + 0.06, yt - 0.31, -hw + 0.12, x0 + 0.08, yt - 0.29, hw - 0.12, TC.frost);
    }
    // Lights.
    for (const z of [-1, 1]) {
      L.tail.span(x0 - 0.07, yfl - 0.36, z * (hw - 0.32), x0, yfl - 0.16, z * (hw - 0.06));
      L.reverse.span(x0 - 0.07, yfl - 0.36, z * (hw - 0.46), x0, yfl - 0.16, z * (hw - 0.34));
      (z < 0 ? L.sigL : L.sigR).span(x0 - 0.07, yfl - 0.36, z * (hw - 0.62), x0, yfl - 0.16, z * (hw - 0.48));
      L.clrA.box(x1 + 0.02, yt - 0.1, z * (hw - 0.05), 0.06, 0.08, 0.08);
      L.clrR.box(x0 - 0.06, yt - 0.12, z * (hw - 0.06), 0.06, 0.08, 0.08);
      L.clrA.box(x1 - 0.25, yfl + 0.02, z * (hw + 0.01), 0.12, 0.07, 0.03);
      L.clrR.box(x0 + 0.25, yfl + 0.02, z * (hw + 0.01), 0.12, 0.07, 0.03);
    }
    for (const z of [-0.25, 0, 0.25]) L.clrR.box(x0 - 0.06, yt - 0.14, z, 0.06, 0.07, 0.1);
    // Side livery.
    const sideH = yt - (yfl - 0.12), sideY = (yt + yfl - 0.12) / 2;
    parent.add(new THREE.Mesh(quadGeometry([{ x: (x0 + x1) / 2, y: sideY, z: hw + 0.004, w: x1 - x0, h: sideH }]), this.kit.livery[c.livery]));
    const near = new THREE.Group();
    near.add(W.build(this.kit.paint)!);
    near.add(new THREE.Mesh(quadGeometry([{ x: (x0 + x1) / 2, y: sideY, z: -hw - 0.004, w: x1 - x0, h: sideH, rotY: Math.PI }]), this.kit.livery[c.livery]));
    parent.add(near);
    this.nearWall = near;
    const openH = (yt - 0.28) - yfl;   // (truckLayout's doorTop - floor)
    if (swing) {
      // Two leaves hinged at the rear corners; each carries half of the rear livery.
      const wl = hw - 0.04;
      for (const side of [1, -1]) {
        const leaf = new THREE.Group();
        // In the leaf's own frame (origin at the hinge): x along the trailer, z across it.
        const geo = quadGeometry([{ x: -0.045, y: yfl + openH / 2, z: side > 0 ? -wl / 2 : wl / 2, w: wl, h: openH, rotY: -Math.PI / 2,
          u0: side > 0 ? 0.5 : 0, u1: side > 0 ? 1 : 0.5 }]);
        leaf.add(new THREE.Mesh(geo, this.kit.liveryRearDS));
        const frame = new Batch(); frame.span(-0.04, yfl, side > 0 ? -wl : 0, 0, yfl + openH, side > 0 ? 0 : wl, TC.white);
        leaf.add(frame.build(this.kit.paint)!);
        leaf.position.set(x0 - 0.02, 0, side * (hw - 0.02));
        parent.add(leaf);
        this.trailerLeaves.push(leaf);
      }
    } else {
      const n = 10, geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 18), 3));
      const uv = new Float32Array(n * 12), nrm = new Float32Array(n * 18);
      for (let i = 0; i < n; i++) {
        const v0 = i / n, v1 = (i + 1) / n;
        uv.set([0, v0, 1, v0, 1, v1, 0, v0, 1, v1, 0, v1], i * 12);
        for (let k = 0; k < 6; k++) nrm.set([-1, 0, 0], i * 18 + k * 3);
      }
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      parent.add(new THREE.Mesh(geo, this.kit.liveryRearDS));
      // The pull strap: a webbing strip hanging from the middle of the door's bottom edge, just
      // outside it, long enough that its end is in reach from the street when the door is up.
      // Below the floor it is folded over the sill (hidden), so it is only seen once the door opens.
      const strapLen = Math.max(0.6, yfl + openH - STRAP_END);
      // Safety orange with a reflective weave: it shows against the dark street and the lit bed
      // alike, glowing faintly once the lights are on.
      const SB = new Batch();
      SB.span(-0.006, -1, -0.04, 0.006, 0, 0.04, 0xffffff);
      const strap = SB.build(this.strapMat)!;
      parent.add(strap);
      this.slats = { geo, n, x: x0 + 0.09, floor: yfl, track: yt - 0.12, open: openH, halfW: hw - 0.12, last: NaN, strap, strapLen };
      this.layoutSlats(0);
    }
    this.anchors.rearGround.position.set(x0 - 0.9, 0, 0);
    this.anchors.cargoSill.position.set(x0 + 0.2, yfl, 0);
  }

  // The roll-up door in the truck frame: the plane of the closed door (x), and its bottom edge's
  // height when open by f: floor + min(f * open, lv) (above lv the slats run forward under the
  // roof). Null for bodies without one.
  // `strap`: how far the pull strap hangs below that edge, at STRAP_X behind the door plane.
  doorGeom(): DoorGeom | null {
    const S = this.slats;
    return S ? { x: S.x, floor: S.floor, open: S.open, lv: S.track - S.floor, strap: S.strapLen } : null;
  }

  // Roll-up door: slats ride a track up the door opening, then forward under the roof.
  private layoutSlats(f: number) {
    const S = this.slats!; S.last = f;
    const pos = S.geo.attributes.position.array as Float32Array;
    const h = S.open / S.n, lv = S.track - S.floor;
    const pt = (s: number): [number, number] => (s <= lv ? [S.x, S.floor + s] : [S.x + (s - lv), S.track]);
    for (let i = 0; i < S.n; i++) {
      const [xa, ya] = pt(i * h + f * S.open), [xb, yb] = pt((i + 1) * h + f * S.open);
      const z0 = -S.halfW, z1 = S.halfW;
      pos.set([xa, ya, z0, xa, ya, z1, xb, yb, z1, xa, ya, z0, xb, yb, z1, xb, yb, z0], i * 18);
    }
    S.geo.attributes.position.needsUpdate = true;
    S.geo.computeBoundingSphere();
    // The strap hangs straight down from the bottom edge (the driver's hands hold it on that line).
    const edge = S.floor + Math.min(f * S.open, lv), hang = Math.min(S.strapLen, edge - S.floor);
    S.strap.visible = hang > 0.02;
    S.strap.position.set(S.x - STRAP_X, edge, 0);
    S.strap.scale.y = Math.max(hang, 0.001);
  }

  private buildFlatbed(P: Batch, L: Record<LightKey, Batch>, c: CargoSpec) {
    const { x0, x1, floor: yfl, hw } = c;
    P.span(x0, yfl - 0.15, -hw, x1, yfl, hw, TC.wood);
    for (const z of [-1, 1]) {
      P.span(x0, yfl - 0.2, z * (hw - 0.03), x1, yfl - 0.02, z * (hw + 0.03), TC.black);
      for (let x = x0 + 0.3; x < x1; x += 0.6) P.span(x, yfl - 0.24, z * (hw + 0.02), x + 0.07, yfl - 0.02, z * (hw + 0.06), TC.black);
      P.span(x1 - 0.1, yfl, z * (hw - 0.12), x1 - 0.02, yfl + 1.55, z * (hw - 0.04), TC.black);
    }
    for (let y = yfl + 0.3; y < yfl + 1.6; y += 0.3) P.span(x1 - 0.1, y, -hw + 0.04, x1 - 0.02, y + 0.06, hw - 0.04, TC.black);
    for (let x = x0 + 0.3; x < x1; x += 0.6) P.span(x, yfl - 0.34, -hw + 0.1, x + 0.08, yfl - 0.15, hw - 0.1, TC.frame);
    for (const z of [-1, 1]) {
      L.tail.span(x0 - 0.06, yfl - 0.22, z * (hw - 0.32), x0, yfl - 0.05, z * (hw - 0.06));
      L.reverse.span(x0 - 0.06, yfl - 0.22, z * (hw - 0.46), x0, yfl - 0.05, z * (hw - 0.34));
      (z < 0 ? L.sigL : L.sigR).span(x0 - 0.06, yfl - 0.22, z * (hw - 0.62), x0, yfl - 0.05, z * (hw - 0.48));
    }
    P.span(x0 + 0.05, 0.42, -hw + 0.12, x0 + 0.16, 0.58, hw - 0.12, TC.black);
    this.anchors.rearGround.position.set(x0 - 0.9, 0, 0);
    this.anchors.cargoSill.position.set(x0 + 0.4, yfl, 0);
  }

  private buildTractorExtras(P: Batch, L: Record<LightKey, Batch>) {
    const s = this.spec, xb = s.cabBack, xf = s.cabFront, yt = s.cabTop, hw = s.cabHW, ft = s.frameTop;
    // Roof fairing: a smooth ramp from the windshield header up to the trailer's height.
    const ax = xf - 0.15, ay = yt + 0.04, bx = xb + 0.05, by = yt + 0.82;
    const len = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax);
    P.boxR((ax + bx) / 2, (ay + by) / 2 - 0.04, 0, len, 0.08, 2 * hw - 0.16, TC.white, 0, 0, ang);
    P.span(xb, yt, -hw + 0.1, xb + 0.4, by, hw - 0.1, TC.white);                       // its back
    for (let k = 0; k < 4; k++) {                                                        // sides, filled under the ramp
      const x0 = bx + (ax - bx) * k / 4, x1 = bx + (ax - bx) * (k + 1) / 4, top = by + (ay - by) * (k + 0.5) / 4;
      P.span(Math.min(x0, x1), yt, -hw + 0.1, Math.max(x0, x1), top, hw - 0.1, TC.white);
    }
    for (const z of [-1, 1]) {
      P.span(xb - 0.25, s.cabFloor, z * (hw - 0.03), xb, yt + 0.75, z * hw, TC.white); // side extenders
      P.cyl(xb - 0.14, (ft + 4.05) / 2, z * 1.0, 0.075, 4.05 - ft, TC.chrome, 8);       // stacks
      P.span(xb - 0.24, ft + 0.6, z * 0.93, xb - 0.2, ft + 1.6, z * 1.07, TC.chrome);   // heat shields
      P.span(-1.15, 2 * s.wheelR + 0.04, z * 0.72, 1.15, 2 * s.wheelR + 0.1, z * 1.28, TC.black); // quarter fenders
      this.exhaust.push(new THREE.Vector3(xb - 0.14, 4.1, z * 1.0));
    }
    const fw = s.fifthWheel ?? 0;
    P.span(fw - 0.6, ft, -0.95, fw + 0.6, ft + 0.14, 0.95, TC.black);
    P.span(fw - 0.62, ft + 0.14, -0.1, fw + 0.1, ft + 0.15, 0.1, TC.frame);
    P.span(xb - 1.2, ft, -0.5, xb - 0.3, ft + 0.05, 0.5, TC.alu);
    void L;
  }

  private buildRamp(c: CargoSpec) {
    const len = c.floor > 1 ? 3.6 : 3.0;
    const R = new Batch();
    R.span(-len, -0.04, -0.45, 0, 0, 0.45, TC.alu);
    for (const z of [-1, 1]) R.span(-len, 0, z * 0.45, 0, 0.07, z * 0.39, TC.chrome);
    for (let x = -len + 0.15; x < -0.1; x += 0.3) R.span(x, 0, -0.39, x + 0.05, 0.012, 0.39, TC.hub);
    this.rampGroup = new THREE.Group();
    this.rampGroup.add(R.build(this.kit.paint)!);
    this.rampGroup.userData.len = len;
    this.body.add(this.rampGroup);
  }

  private buildLiftgate(c: CargoSpec) {
    const G = new Batch(), len = 1.5;
    G.span(-len, -0.08, -c.hw + 0.15, 0, 0, c.hw - 0.15, TC.alu);
    for (let x = -len + 0.1; x < -0.05; x += 0.2) G.span(x, 0, -c.hw + 0.18, x + 0.06, 0.01, c.hw - 0.18, TC.hub);
    for (const z of [-1, 1]) G.span(-0.08, -0.08, z * (c.hw - 0.2), 0, 0.12, z * (c.hw - 0.12), TC.black);
    this.liftGroup = new THREE.Group();
    this.liftGroup.add(G.build(this.kit.paint)!);
    this.body.add(this.liftGroup);
  }

  private buildTrailer(fifthWheel: number) {
    const t = TRAILER, P = new Batch(), L = this.lightBatches();
    this.trailer = new THREE.Group();
    this.trailer.position.set(fifthWheel, 0, 0);
    this.trailerBody = new THREE.Group();
    this.trailer.add(this.trailerBody);
    const c: CargoSpec = { kind: "box", x0: t.rear, x1: t.front, floor: t.floor, top: t.top, hw: t.hw, livery: "liverySideTrailer" };
    this.buildBox(P, L, c, this.trailerBody, false, true);
    // Landing gear, upper coupler, skirts, sliding tandem.
    for (const z of [-1, 1]) {
      P.span(-2.0, 0.28, z * 0.55, -1.86, t.floor - 0.1, z * 0.66, TC.frame);
      P.span(-2.08, 0.2, z * 0.5, -1.78, 0.28, z * 0.72, TC.frame);
      P.span(-3.4, 0.48, z * (t.hw - 0.05), -11.4, t.floor - 0.12, z * (t.hw - 0.02), TC.skirt);
      P.span(-14.3, 0.62, z * 0.5, -11.8, t.floor - 0.12, z * 0.6, TC.frame);
    }
    P.span(-0.6, t.floor - 0.18, -0.9, 0.9, t.floor - 0.12, 0.9, TC.frame);
    P.span(-0.05, t.floor - 0.3, -0.05, 0.05, t.floor - 0.18, 0.05, TC.chrome);   // kingpin
    this.trailerBody.add(P.build(this.kit.paint)!);
    this.addLights(this.trailerBody, L);
    this.root.add(this.trailer);
    this.anchors.rearGround.position.set(fifthWheel + t.rear - 0.9, 0, 0);
    this.anchors.cargoSill.position.set(fifthWheel + t.rear + 0.2, t.floor, 0);
  }
}

export function ease(x: number) { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); }
function placeholderTexture() {
  const t = new THREE.DataTexture(new Uint8Array([6, 20, 43, 255]), 1, 1);
  t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}
function fitText(g: CanvasRenderingContext2D, text: string, max: number) {
  let s = text;
  while (s.length > 1 && g.measureText(s).width > max) s = s.slice(0, -1);
  return s === text ? s : s.slice(0, -1) + "…";
}
