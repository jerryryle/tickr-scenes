// The Ryder trucks: five models built from boxes and cylinders, with animated wheels, lights,
// doors, ramp, lift gate, articulating trailer, exhaust and a dashboard interior.
//
// Frame: the truck faces +x, +y is up, +z is the passenger (right) side, so the driver sits at
// -z. The origin is the rear axle centre on the ground (the tandem centre on the tractor), which
// suits bicycle-model steering. Units are metres. Static paint, liner and interior parts are
// merged into one vertex-coloured mesh; only moving parts and lights are separate meshes.
import * as THREE from "three@0.187.0";
import { canBakeTextures, makeCanvas } from "./canvas.ts";
import { Batch, keepWarm, quadGeometry } from "./geom.ts";
import type { Quad } from "./geom.ts";
import { loadFields, saveFields } from "./snap.ts";
import { applyDriverSpot } from "./cutaway.ts";
import type { CutBox } from "./cutaway.ts";
import { applyLampLight } from "./atmosphere.ts";
import { PuffSystem } from "./puffs.ts";
import { FIFTH_WHEEL, KINGPIN_TO_AXLES } from "./hitch.ts";
import { faceNormals, regionAt, toonCuts, toonRound, toonSlice } from "./toontruck.ts";
import type { ToonRegion } from "./toontruck.ts";


export type TruckModel = "box16" | "box26" | "reefer" | "tractor" | "flatbed";
const TRUCK_MODELS: TruckModel[] = ["box16", "box26", "reefer", "tractor", "flatbed"];
export type LiveryName = "liverySide26" | "liverySide16" | "liverySideTrailer" | "liveryRear" | "liveryCabDoor";
export const LIVERY_ASSETS: LiveryName[] = ["liverySide26", "liverySide16", "liverySideTrailer", "liveryRear", "liveryCabDoor"];

const TC = {
  white: 0xf4f4f0, frame: 0x1c1c1f, chrome: 0xb9bdc3, black: 0x121214, grille: 0x2b2d31,
  tire: 0x1b1b1b, rim: 0xc8ccd2, hub: 0x6e7278, plywood: 0xa9845a, deck: 0x5e4f3e, alu: 0xa7acb2,
  seat: 0x2c2f36, dash: 0x25272b, cabin: 0x8c9097, reefer: 0xd9dadc, skirt: 0x8d9298, mud: 0x0e0e0e,
  tank: 0xc2c6cc, step: 0x2a2a2a, wood: 0x7a5a3a, frost: 0xdcecff, mat: 0x1a1a1a, doorIn: 0xc4c8cc,
  skin: 0xd8a47f, cup: 0xe8dcc0, lid: 0x3a2a20, tree: 0x2fbf4f, paper: 0xf2f2ea, red: 0xce1126,
};
// The roll-up door's pull strap: how far outside the door plane it hangs, and the height above
// the street its end hangs at when the door is fully open.
export const STRAP_X = 0.04, STRAP_END = 1.7;
const STRAP_COLOR = 0xff6a13, STRAP_GLOW = 0xb04a10;
export interface DoorGeom { x: number; floor: number; open: number; lv: number; strap: number }

interface CargoSpec { kind: "box" | "flatbed"; x0: number; x1: number; floor: number; top: number; hw: number; livery: LiveryName }
export interface TruckSpec {
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

// The exhaust's puffs (puffs.ts PuffSystem.emit), in the truck's frame: launched at `vel` (a pipe's
// blow out sideways from its tip, briskly enough to stay clear of the box as it swings through a
// turn, forwards or backing into a bay; test/exhaust.ts), a light idle trickle or bigger, darker
// ones under acceleration (or braking in reverse).
export const PUFF_VEL = { pipe: [-0.3, 0.25, 3.6], stack: [-0.6, 1.1, 0] } as const;
export const PUFF_IDLE = { color: 0x8e8e90, size: 0.26, life: 1.2 }, PUFF_HARD = { color: 0x4c4c4e, size: 0.42, life: 1.6 };
// Where a pipe's puffs leave it, in the truck's frame: just past its tip (PIPE_MOUTH), the pipe
// running out under the bed, ahead of the rear wheels, to a tip just past the bed's side.
export const PIPE_MOUTH = 0.03;
const HORN_R0 = 0.3, HORN_LEN = 0.6, HORN_W = 0.16;   // m: the horn lines' start out from their fan's origin (past the truck), their length and width (honk)
const FLATBED_LOAD_TOP = 3.3;   // m: as high as a flatbed's load stands above its deck (a box body's roof)
// m: a day cab's side extenders, back from its cab's back, and its stacks behind the cab: how far
// back, their radius, out to either side, and up to (buildTractorExtras; hornBoxes clears them)
const EXTENDER_LEN = 0.25, STACK_BACK = 0.14, STACK_R = 0.075, STACK_Z = 1.0, STACK_TOP = 4.05;
export function pipeMouth(s: TruckSpec): [number, number, number] {
  return [Math.max(...s.rearAxles) + s.wheelR + 0.5, 0.45, (s.cargo ? s.cargo.hw : s.cabHW) + 0.03 + PIPE_MOUTH];
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
    doorLen: 1.15, cargo: null, fifthWheel: FIFTH_WHEEL, loader: "none", exhaust: "stack",
  },
};

// A dry van, its box 12.9 m long, in its own frame: origin at the kingpin, extending to -x. It is a
// city trailer, shorter than a 53 ft one. Its axles are 10 m behind the kingpin, so it clears a square
// corner on a wide right (docs/long-day-cities.md, "Tractor-trailers' turns").
export const TRAILER = { front: 0.9, rear: -12.0, floor: 1.25, top: 4.1, hw: 1.3, axles: [-9.4, -10.65], rearZ: 0.95, wheelR: 0.5, kingpinToAxles: KINGPIN_TO_AXLES };
// How far a trailer's swing door turns from shut to lying back along the side (rad).
export const LEAF_OPEN = 4.55;
// The height of its lock rods' handles over the road (m).
export const LEAF_HANDLE_Y = 1.42;
// The top of a trailer's underride guard, under its back (the crew steps on it climbing in).
export const UNDERRIDE_Y = 0.6;
// The pieces each roll-up door slat is cut into across the door (layoutSlats).
const SLAT_COLS = 12;

// Shared across every truck: materials, livery textures, the unit wheel geometry.
export class TruckKit {
  paint = new THREE.MeshLambertMaterial({ vertexColors: true });
  livery = {} as Record<LiveryName, THREE.MeshLambertMaterial>;
  // The rear doors carry the livery outside and are plain inside (doorInside, the face turned
  // into the box: the swing doors', seen lying open against the trailer's side too). A roll-up
  // door's inside (slatInside), rolled up under the roof, takes neither the dome light nor the
  // lamp pools, which lit it as bright as a lamp.
  doorInside: THREE.MeshLambertMaterial;
  slatInside: THREE.MeshLambertMaterial;
  wheelGeo: THREE.BufferGeometry;
  constructor(images: Record<LiveryName, CanvasImageSource>) {
    for (const name of LIVERY_ASSETS) {
      const tex = new THREE.Texture(images[name] as any);
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.needsUpdate = true;
      this.livery[name] = new THREE.MeshLambertMaterial({ map: tex });
    }
    this.doorInside = new THREE.MeshLambertMaterial({ color: TC.doorIn, side: THREE.BackSide });
    this.slatInside = new THREE.MeshLambertMaterial({ color: TC.doorIn, side: THREE.BackSide });
    for (const m of [this.paint, this.doorInside, ...Object.values(this.livery)]) { applyDriverSpot(m); applyLampLight(m); }   // cutaway.ts, atmosphere.ts
    applyDriverSpot(this.slatInside);
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

const HEAD_TOON_OFF = new THREE.Color();
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
  // (`toon`: how cartoonish the truck is. Its big round headlamps are cream when off.)
  set(head: boolean, brake: boolean, reverse: boolean, sigL: boolean, sigR: boolean, toon: number) {
    const m = this.mats;
    if (head) m.head.color.setHex(0xfffff0); else m.head.color.setHex(0x77776a).lerp(HEAD_TOON_OFF.setHex(0xfff3c8), toon);
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
// A part of a mesh the cartoon grows from nothing or shrinks to nothing (makeToon): its vertices
// from `start`, `count` of them, and its middle.
interface ToonPart { start: number; count: number; c: THREE.Vector3 }

// Length extents of a model along x from the rear axle (no instance needed): the nose, and the
// middle of the whole vehicle including a straight trailer (used to centre it on a kerb stop).
export function truckExtents(m: TruckModel) {
  const s = SPECS[m];
  const front = s.noseFront + 0.05;
  const rear = s.fifthWheel !== undefined ? s.fifthWheel + TRAILER.rear : s.cargo ? s.cargo.x0 - 0.1 : -1.4;
  // Where the driver stands to open the cab door and steps back to after shutting it: behind the
  // door's rear edge, clear of its swing (crew.ts climb); the cabDoorGround anchor.
  return { front, rear, center: (front + rear) / 2, doorX: s.cabFront - 0.07 - s.doorLen - 0.3, doorZ: -(s.cabHW + 0.45) };
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
// The lift gate's platform, from the bed's back to its outer end when out (m): deep enough for the
// driver and a loaded hand truck ahead of them (a penguin's crate on it too) to ride it together.
// Its last GATE_FLAP is a flip-over end, hinged to the deck and folded under it when stowed, so the
// deck that slides in under the floor stays clear of the mudflaps behind the rear wheels; out, the
// deck stops GATE_GAP short of the body, clear of the tail lamps and the sill.
export const GATE_LEN = 2.4, GATE_FLAP = 0.5, GATE_GAP = 0.075;

type TruckSave = { f: Record<string, unknown>; x: number; z: number };
// The straps over a load (each truck its own: it glows with the truck's headlights). One kept
// warm in the scene from the start (keepStrapsWarm; geom.ts keepWarm): the first load strapped
// down would otherwise draw them for the first time.
function strapMaterial() { const m = new THREE.MeshLambertMaterial({ color: STRAP_COLOR }); applyDriverSpot(m); applyLampLight(m); return m; }
export function keepStrapsWarm(scene: THREE.Object3D) { const b = new Batch(), m = strapMaterial(); b.box(0, 0, 0, 1, 1, 1, 0xffffff); keepWarm(scene, b.build(m)!.geometry, m); }

// ---- The storybook's cartoon look ------------------------------------------------------------
// In and near the storybook city (CountryRoad.storyAt) every truck goes cartoonish, by `toon`
// (0..1): soft and chunky, its cab, hood, box or trailer rounded off at their edges and puffed
// out (toontruck.ts), its hood shorter, big round headlamps on its nose, its tyres fat on pink
// rims, its trim in the storybook's colours (frame and grille plum, chrome gold, tank mint), its
// ride bouncier and its puffs little pastel clouds. The box's back is rounded at its edges like
// the rest, its doors and lamps with it, but the middle of the back, the floor, the wheels and the
// crew's places stay where they are, so it docks, loads and swaps the same. It is built as morph
// targets (makeToon), so it fades in and out continuously.
const TOON_TRIM: [number, number][] = [
  [TC.frame, 0x5a2a7a], [TC.mud, 0x3a1a5a], [TC.chrome, 0xffc94a], [TC.tank, 0x6fe0e8], [TC.grille, 0x6a3a8a],
  [TC.step, 0x5a2a7a], [TC.black, 0x3a1a5a], [TC.skirt, 0xff7fb5], [TC.alu, 0xf3e07a],
];
const TOON_RIM = 0xff7fb5, TOON_PUFFS = [0xffb8de, 0xd9b8ff, 0xb8f0e0, 0xfff0a8];
const TOON_HOOD = 0.7, TOON_CAB = 1.2;   // (These are the hood's length and the cab's height, as a cartoon's.)
// toonRegions gives the shells a model's cartoon rounds off, in the truck's frame (x forward from the rear axle).
function toonRegions(s: TruckSpec): ToonRegion[] {
  const R: ToonRegion[] = [];
  const conv = s.cab !== "cabover";
  R.push({ x0: s.cabBack, x1: s.cabFront, y0: s.cabFloor - 0.1, y1: s.cabTop + 0.06, hw: s.cabHW, top: 1.0, bottom: 0, front: 0.7, back: 0.55, side: 0.75,
    frontFrom: conv ? s.hoodTop : undefined, pillow: 0.09 });
  if (conv) R.push({ x0: s.cabFront, x1: s.noseFront + 0.12, y0: 0.3, y1: s.hoodTop, hw: s.cabHW + 0.08, top: 0.72, bottom: 0.18, front: 0.72, back: 0, side: 0.55, pillow: 0.09 });
  const c = s.cargo;
  if (c?.kind === "box") R.push({ x0: c.x0, x1: c.x1, y0: c.floor - 0.12, y1: c.top, hw: c.hw, top: 0.9, bottom: 0, front: 1.0, back: 0.45, side: 0.8, pillow: 0.08 });
  return R;
}
const TRAILER_REGION: ToonRegion[] = [{ x0: TRAILER.rear, x1: TRAILER.front, y0: 1.25 - 0.12, y1: 4.1, hw: 1.3, top: 0.95, bottom: 0, front: 1.2, back: 0.5, side: 0.85, pillow: 0.08 }];

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
  hazards = false; signal: -1 | 0 | 1 = 0; engineOn = true;
  // Headlights (and with them the tail and marker lamps' glow): set per frame by the scene, after
  // the ticks that update the truck, so a change shows at once rather than at the next update.
  private head = false;
  get headlights() { return this.head; }
  set headlights(on: boolean) { if (on !== this.head) { this.head = on; this.applyLights(); } }
  rearDoor = 0; ramp = 0; liftgate = 0; liftgateDrop = 0; cabDoor = 0; trailerLeafL = 0; trailerLeafR = 0;   // (the swing doors: 0 shut .. 1 round against the side, LEAF_OPEN)
  trailerYaw = 0;
  interiorView = false;
  private boxParent: THREE.Object3D | null = null; private boxSpec: CargoSpec | null = null;
  private ivTmp = new THREE.Vector3(); private ivTmp2 = new THREE.Vector3();
  cutaway = false;                     // hide the box's street-side wall (camera interior cutaway)
  private nearWall: THREE.Group | null = null;

  private lights = new LightSet();
  private glass = new THREE.MeshBasicMaterial({ color: 0x1d2a3a, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });
  private wheels: THREE.InstancedMesh;
  // toon is how cartoonish the truck is (0..1; see toonWarp), and the scene sets it each frame; toonMeshes
  // holds the meshes with a cartoon shape to morph to.
  toon = 0;
  private toonShown = 0;
  private toonMade = false;
  private toonMeshes: THREE.Mesh[] = [];
  private toonAnchors: [THREE.Object3D, THREE.Vector3, THREE.Vector3][] = [];
  private toonCol = new THREE.Color();
  private toonR: ToonRegion[];   // (the shells the cartoon rounds off: toonRegions)
  private wheelSlots: WheelSlot[] = [];
  private driverDoor = new THREE.Group();
  private rampGroup: THREE.Group | null = null;
  private liftGroup: THREE.Group | null = null;
  private liftFlap: THREE.Group | null = null;
  private trailer: THREE.Group | null = null;
  private trailerBody: THREE.Group | null = null;
  private trailerLeaves: THREE.Group[] = [];
  private slats: { geo: THREE.BufferGeometry; n: number; x: number; floor: number; track: number; open: number; halfW: number; last: number;
    lastToon: number; strap: THREE.Mesh; strapLen: number; region: ToonRegion | null } | null = null;
  private wheelPivot = new THREE.Group();
  private steeringWheel: THREE.Mesh | null = null;
  private needle = new THREE.Group();
  private bobbleHead = new THREE.Group();
  private freshener = new THREE.Group();
  private bob = { x: 0, z: 0, vx: 0, vz: 0 };
  private tabletMat = new THREE.MeshBasicMaterial({ map: placeholderTexture() });
  private strapMat = strapMaterial();
  private tabletCanvas: { canvas: any; g: CanvasRenderingContext2D } | null = null;
  private exhaust: THREE.Vector3[] = [];
  private puffTimer = 0;
  private time = 0;
  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private e = new THREE.Euler();
  private v3 = new THREE.Vector3(); private s3 = new THREE.Vector3(); private tm = new THREE.Matrix4();
  private puffVel = new THREE.Vector3(); private puffVel2 = new THREE.Color();   // (scratch: PuffSystem.emit copies it)

  constructor(private kit: TruckKit, readonly model: TruckModel, private puffs: PuffSystem | null = null) {
    this.spec = SPECS[model];
    const s = this.spec;
    this.toonR = toonRegions(s);
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

  // The boxes the camera's cutaway sees the truck through (cutaway.ts): the truck whole, or a
  // tractor's cab and its trailer apart, so the trailer's swing through a turn is followed.
  private cutBoxList: CutBox[] | null = null;
  get cutBoxes(): readonly CutBox[] {
    if (this.cutBoxList) return this.cutBoxList;
    const s = this.spec, c = s.cargo;
    if (this.trailer) {
      this.cutBoxList = [
        { obj: this.body, x0: -1.5, x1: this.frontX, y0: 0, y1: s.exhaust === "stack" ? STACK_TOP + 0.05 : s.cabTop, hw: s.cabHW },   // (up to the stacks' tops)
        { obj: this.trailer, x0: TRAILER.rear, x1: TRAILER.front, y0: 0, y1: TRAILER.top, hw: TRAILER.hw },
      ];
    } else {
      // (A flatbed's load stands above its deck: as high as a box body's roof.)
      const top = Math.max(s.cabTop, c ? (c.kind === "flatbed" ? FLATBED_LOAD_TOP : c.top) : 0);
      this.cutBoxList = [{ obj: this.body, x0: this.rearX, x1: this.frontX, y0: 0, y1: top, hw: Math.max(s.cabHW, c?.hw ?? 0) }];
    }
    return this.cutBoxList;
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

  private applyLights() {
    const blink = (this.time % 0.7) < 0.35;
    const brake = this.engineOn && (this.accel < -0.4 || Math.abs(this.speed) < 0.05);
    this.strapMat.emissive.setHex(this.head ? STRAP_GLOW : 0x000000);
    this.lights.set(this.head, brake, this.speed < -0.05,
      (this.signal === -1 || this.hazards) && blink, (this.signal === 1 || this.hazards) && blink, this.toon);
  }

  // The moving parts' state (main.ts: preview snapshots and part-ticks); the meshes follow from it.
  private static SAVED = ["speed", "accel", "steer", "distance", "heading", "hazards", "signal", "engineOn", "rearDoor", "ramp", "liftgate", "liftgateDrop",
    "cabDoor", "trailerLeafL", "trailerLeafR", "trailerYaw", "interiorView", "cutaway", "bob", "puffTimer", "time"] as const;
  // (`into`: an earlier save, of this truck or another, filled again in place.)
  save(into?: TruckSave): TruckSave {
    const s = into ?? { f: {}, x: 0, z: 0 };
    s.f = saveFields(this, Truck.SAVED, [], s.f); s.x = this.root.position.x; s.z = this.root.position.z;
    return s;
  }
  load(s: TruckSave) { loadFields(this, s.f); this.setPose(s.x, s.z, this.heading); this.update(0, this.time); }

  // Free GPU resources (truck swaps). Shared kit geometry and materials are kept.
  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o: any) => { if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose(); });
    for (const m of Object.values(this.lights.mats)) m.dispose();
    this.glass.dispose();
    this.tabletMat.map?.dispose(); this.tabletMat.dispose();
    this.strapMat.dispose();
    this.horn?.traverse((o: any) => o.material?.dispose());
  }

  // The horn (journey.ts honking): Tickr has no sound, so a cartoon's horn lines burst out from
  // the front corners of the cab with each blast, three short pale yellow strokes a side fanned
  // out up, level and down. They are drawn flat to the camera (sprites, placed as each is drawn:
  // hornFan, hornStroke), out across the picture from past the whole truck's outline, so they
  // never cross the cab, its box or its trailer, and read the same from any angle. `blast`:
  // seconds into the blast sounding, or -1.
  private horn: THREE.Group | null = null;
  private hornBlast = 0;
  honk(blast: number) {
    if (blast < 0) { if (this.horn) this.horn.visible = false; return; }
    if (!this.horn) {
      const g = new THREE.Group();
      for (const sz of [-1, 1]) for (const k of [-1, 0, 1]) {
        const m = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xfff0a0, fog: false, depthWrite: false }));
        m.frustumCulled = false; m.userData = { sz, k }; m.geometry.userData.shared = true;   // (three's one sprite geometry: not this truck's to dispose)
        m.onBeforeRender = (r, _s, cam) => this.hornStroke(m, r.info.render.frame, cam);
        g.add(m);
      }
      this.horn = g; this.body.add(g);
    }
    this.horn.visible = true; this.hornBlast = blast;
  }
  // (One stroke, `k` -1, 0, 1 down to up, on side `sz`, from its side's fan (hornFan) in the
  // render `frame` (three's count of renders); the strokes start HORN_R0 m out from the fan's
  // origin and move on out with the blast, lengthening quickly to HORN_LEN.)
  private hornStroke(m: THREE.Sprite, frame: number, cam: THREE.Camera) {
    const { sz, k } = m.userData, F = this.hornFan(sz, frame, cam);
    // (Hidden by its size: drawn now, it is too late to leave it out, and left out it is not asked again.)
    if (!F.show) { m.scale.set(0, 0, 1); m.updateMatrixWorld(); return; }
    const a = F.u + k * 0.7, b = this.hornBlast;
    const len = HORN_LEN * (k === 0 ? 1.15 : 1) * Math.min(1, 0.3 + b / 0.1), r = HORN_R0 + b * 1.1 + len / 2;
    // (In view space, then back to the body's frame, the sprite's parent.)
    this.hornE.set(F.x + Math.cos(a) * r, F.y + Math.sin(a) * r, F.z).applyMatrix4(cam.matrixWorld);
    m.position.copy(this.hornE).applyMatrix4(this.hornInv.copy(this.body.matrixWorld).invert());
    m.scale.set(len, HORN_W, 1); m.material.rotation = a;
    m.updateMatrixWorld();
  }
  // (A side's fan, worked out once a render for its three strokes: shown only from a front corner
  // on the cab's outline as the camera sees it, the front facing the camera and that side not, or
  // that side and not the front (with the front facing it, a side seen nearly edge on counts as
  // not; from behind, backing into a bay, any side turned its way does). It points out across the
  // picture, `u`, between sideways from the middle of the front, seen head on, and on ahead of the
  // nose, seen from the side; its origin, in view space at the corner's depth, is out that way past
  // the whole truck (hornBoxes), not just the corner: a box or trailer behind the cab, wider and
  // taller, stands out past it seen from a front quarter. None with the camera right up against
  // the truck, any of these points at or behind it: no way across.)
  private hornFans = [-1, 1].map(() => ({ frame: -1, cam: null as THREE.Camera | null, show: false, u: 0, x: 0, y: 0, z: 0 }));
  private hornFan(sz: number, frame: number, cam: THREE.Camera) {
    const F = this.hornFans[sz > 0 ? 1 : 0];
    if (F.frame === frame && F.cam === cam) return F;
    F.frame = frame; F.cam = cam; F.show = false;
    const s = this.spec, mw = this.body.matrixWorld, V = cam.matrixWorldInverse, y = s.hoodTop + 0.35;
    const P = this.v3.set(s.noseFront + 0.1, y, sz * s.cabHW).applyMatrix4(mw);
    const toCam = this.hornC.setFromMatrixPosition(cam.matrixWorld).sub(P).normalize();
    const f = this.hornN.set(1, 0, 0).transformDirection(mw).dot(toCam), side = this.hornN.set(0, 0, sz).transformDirection(mw).dot(toCam) > (f > 0 ? 0.35 : 0);
    if ((f > 0) === side) return F;
    // (Across the picture, in view space less perspective: out from the middle of the front, and
    // from 2 m back along the cab's middle to the front's.)
    const p = P.applyMatrix4(V), n = this.hornD.set(s.noseFront + 0.1, y, 0).applyMatrix4(mw).applyMatrix4(V), bk = this.hornN.set(s.noseFront - 1.9, y, 0).applyMatrix4(mw).applyMatrix4(V);
    if (Math.max(p.z, n.z, bk.z) > -0.1) return F;
    const px = p.x / -p.z, py = p.y / -p.z, nx = n.x / -n.z, ny = n.y / -n.z;
    const lx = px - nx, ly = py - ny, fx = nx - bk.x / -bk.z, fy = ny - bk.y / -bk.z;
    const ll = Math.hypot(lx, ly) || 1, fl = Math.hypot(fx, fy) || 1, w = Math.min(1, Math.max(0, f));
    const u = Math.atan2(ly / ll * w + fy / fl * (1 - w), lx / ll * w + fx / fl * (1 - w)), ux = Math.cos(u), uy = Math.sin(u);
    let out = 0;
    const E = this.hornE;
    for (const c of this.hornBoxes) for (let i = 0; i < 8; i++) {
      E.set(i & 1 ? c.x1 : c.x0, i & 2 ? c.y1 : c.y0, i & 4 ? c.hw : -c.hw).applyMatrix4(c.obj.matrixWorld).applyMatrix4(V);
      if (E.z > -0.1) return F;
      out = Math.max(out, (E.x / -E.z - px) * ux + (E.y / -E.z - py) * uy);
    }
    out *= -p.z;   // (across the picture to metres at the corner's depth)
    F.show = true; F.u = u; F.x = p.x + ux * out; F.y = p.y + uy * out; F.z = p.z;
    return F;
  }
  // (The truck's parts, as boxes in their own frames, for the horn to clear: the cab, its hood,
  // a tractor's extenders and stacks behind its cab, and the box or flatbed's load, or the
  // trailer. Closer than cutBoxes, whose one box for a box truck stands the body's roof out over
  // the hood.)
  private hornBoxList: CutBox[] | null = null;
  private get hornBoxes(): CutBox[] {
    if (this.hornBoxList) return this.hornBoxList;
    const s = this.spec, c = s.cargo, L: CutBox[] = [
      { obj: this.body, x0: s.cabBack, x1: s.cabFront, y0: 0, y1: s.cabTop, hw: s.cabHW },
      { obj: this.body, x0: s.cabFront, x1: this.frontX, y0: 0, y1: s.hoodTop, hw: s.cabHW },
    ];
    if (s.cab === "daycab") L.push({ obj: this.body, x0: s.cabBack - Math.max(EXTENDER_LEN, STACK_BACK + STACK_R), x1: s.cabBack, y0: 0, y1: STACK_TOP, hw: Math.max(s.cabHW, STACK_Z + STACK_R) });
    if (c) L.push({ obj: this.body, x0: c.x0, x1: c.x1, y0: 0, y1: c.kind === "flatbed" ? FLATBED_LOAD_TOP : c.top, hw: c.hw });
    if (this.trailer) L.push({ obj: this.trailer, x0: TRAILER.rear, x1: TRAILER.front, y0: 0, y1: TRAILER.top, hw: TRAILER.hw });
    return this.hornBoxList = L;
  }
  private hornD = new THREE.Vector3(); private hornC = new THREE.Vector3(); private hornN = new THREE.Vector3(); private hornInv = new THREE.Matrix4(); private hornE = new THREE.Vector3();

  // Air-brake hiss when parking.
  hiss() {
    if (!this.puffs) return;
    this.root.updateMatrixWorld();
    for (const sz of [-1, 1]) for (let k = 0; k < 3; k++) {
      this.v3.set(0.6 + k * 0.4, 0.45, sz * 1.0).applyMatrix4(this.root.matrixWorld);
      const vel = new THREE.Vector3(0, 0.4, sz * 1.2).applyQuaternion(this.root.quaternion);
      this.puffs.emit(this.v3, vel, 0xf0f0f0, 0.22, 0.9, this.toon >= 0.5);
    }
  }

  // Back to how a new truck shows what its saved fields leave out (main.ts: a truck brought back
  // into use): headlights off, the dash tablet blank.
  resetLooks() {
    this.headlights = false;
    if (this.tabletCanvas) { this.tabletMat.map?.dispose(); this.tabletMat.map = placeholderTexture(); this.tabletCanvas = null; }
  }

  // Dash tablet: shown once 2D canvases are available (from the first render frame on the board).
  setTablet(stop: string, cargo: string) {
    if (!canBakeTextures()) return false;
    if (!this.tabletCanvas) {
      this.tabletCanvas = makeCanvas(160, 104);
      const tex = new THREE.CanvasTexture(this.tabletCanvas.canvas);
      tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
      this.tabletMat.map?.dispose();   // (the blank placeholder)
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
    // (The cartoon is made the first time it is wanted: most trucks never meet a storybook city.)
    if (this.toon > 0 && !this.toonMade) { this.toonMade = true; this.makeToon(); }
    // Wheels (trailer pose first, so its wheels use this frame's articulation).
    let i = 0;
    if (this.trailer) { this.trailer.rotation.y = this.trailerYaw; this.trailer.updateMatrix(); }
    const tmat = this.trailer ? this.trailer.matrix : null;
    // (Cartoon tyres are a little bigger and much fatter, and a dual pair spreads to fit.)
    const K = this.toon, R = 1 + 0.08 * K, fat = 1 + 0.6 * K, spread = 0.08 * K;
    for (const w of this.wheelSlots) {
      const r = w.r * R, dual = w.steer ? 0 : Math.sign(Math.abs(w.z) - (w.trailer ? TRAILER.rearZ : s.rearZ)) * Math.sign(w.z) * spread;
      this.e.set(0, w.steer ? this.steer : 0, -this.distance / r);
      this.q.setFromEuler(this.e);
      this.m4.compose(this.v3.set(w.x, r, w.z + dual), this.q, this.s3.set(r, r, fat));
      if (w.trailer && tmat) this.m4.premultiply(tmat);
      this.wheels.setMatrixAt(i++, this.m4);
    }
    this.wheels.instanceMatrix.needsUpdate = true;
    if (K !== this.toonShown) {
      this.toonShown = K;
      this.toonCol.setHex(0xffffff).lerp(new THREE.Color(TOON_RIM), K);
      for (let j = 0; j < this.wheelSlots.length; j++) this.wheels.setColorAt(j, this.toonCol);
      this.wheels.instanceColor!.needsUpdate = true;
      for (const m of this.toonMeshes) m.morphTargetInfluences![0] = K;
      for (const [a, p0, p1] of this.toonAnchors) a.position.lerpVectors(p0, p1, K);
    }

    // Suspension: a little bounce with speed, pitch with acceleration (nose dips when braking).
    const moving = Math.min(Math.abs(this.speed) / 6, 1) * (1 + 2.5 * K);   // (a cartoon's ride is bouncier)
    this.body.position.y = 0.025 * moving * Math.sin(this.distance * 1.9) + 0.012 * moving * Math.sin(this.distance * 4.3);
    this.body.rotation.z = THREE.MathUtils.clamp(this.accel * 0.0025, -0.012, 0.012);
    // Roll away from the turn (a left turn leans the body toward +z).
    this.body.rotation.x = THREE.MathUtils.clamp(this.speed * this.speed * Math.tan(this.steer) / s.frontAxle * 0.004, -0.02, 0.02);

    this.applyLights();

    // Moving parts.
    this.driverDoor.rotation.y = -1.25 * ease(this.cabDoor);
    if (this.slats && (Math.abs(this.slats.last - this.rearDoor) > 1e-4 || this.slats.lastToon !== K)) this.layoutSlats(this.rearDoor);
    if (this.rampGroup && s.cargo) {
      const a = THREE.MathUtils.clamp(this.ramp / 0.65, 0, 1), b = THREE.MathUtils.clamp((this.ramp - 0.65) / 0.35, 0, 1);
      const len = this.rampGroup.userData.len as number, pivotY = s.cargo.floor - 0.16;
      this.rampGroup.position.set(s.cargo.x0 + len * (1 - ease(a)), pivotY, 0);
      this.rampGroup.rotation.z = Math.asin(Math.min(1, (pivotY - 0.02) / len)) * ease(b);
    }
    if (this.liftGroup && s.cargo) {
      const a = THREE.MathUtils.clamp(this.liftgate / 0.6, 0, 1), b = THREE.MathUtils.clamp((this.liftgate - 0.6) / 0.4, 0, 1);
      // (Stowed low enough that the deck, its brackets and the folded end slide out under the tail
      // lamps and the frame rails.)
      const len = GATE_LEN - GATE_FLAP - GATE_GAP, stowY = s.cargo.floor - 0.5;
      const y = stowY + (s.cargo.floor - stowY) * ease(b);
      this.liftGroup.position.set(s.cargo.x0 + len * (1 - ease(a)) - GATE_GAP * ease(a), y + (0.06 - y) * ease(this.liftgateDrop), 0);
      // (The flip-over end swings down and out from under the deck once it is clear of the body,
      // before the deck rises; folded back under it last of all.)
      if (this.liftFlap) this.liftFlap.rotation.z = Math.PI * (1 - ease((this.liftgate - 0.4) / 0.2));
    }
    if (this.trailer) {
      // (Each leaf as far round as the crew has it: ~260 degrees folds it back against the side.)
      if (this.trailerLeaves.length === 2) { this.trailerLeaves[0].rotation.y = this.trailerLeafR * LEAF_OPEN; this.trailerLeaves[1].rotation.y = -this.trailerLeafL * LEAF_OPEN; }
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
          const vel = this.puffVel.fromArray(PUFF_VEL[s.exhaust]).applyQuaternion(this.root.quaternion), k = hard ? PUFF_HARD : PUFF_IDLE;
          // (The cartoon's puffs are pastel clouds, their colours by turns.)
          const col = K > 0 ? this.toonCol.setHex(k.color).lerp(this.puffVel2.setHex(TOON_PUFFS[Math.floor(this.time * 5) % TOON_PUFFS.length]), K).getHex() : k.color;
          this.puffs.emit(this.v3, vel, col, k.size * (1 + 0.6 * K), k.life, K >= 0.5);
        }
      }
    }
  }

  // The cartoon shape and colours of every mesh of the truck that has them go in as a morph target:
  // each vertex goes where toonWarp puts it in the body's frame (a door or ramp in its own group as
  // it stands built: shut, stowed), and the trim's colours (TOON_TRIM) become the storybook's. (It
  // leaves out the roll-up door's slats, rebuilt as they move, and kit geometry shared between trucks.)
  // makeToon puts the cartoon as a morph target on every mesh of the truck (relative: it holds the change),
  // worked out in the frame of the truck (or its trailer): each part near a shell is cut into strips
  // across the bands that curve (toonSlice), every vertex goes where the rounded shell puts it (toonRound;
  // the hood is shortened after), the normals are worked out afresh, and the trim's colours become the
  // storybook's. The reefer's fridge unit, over the cab, keeps its place; the headlamps (toonEyes) grow
  // from nothing. (It leaves out the roll-up door's slats, rebuilt as they move, and shared kit geometry.)
  private makeToon() {
    this.toonEyes();
    // (It is worked out with the driver's door shut and the trailer straight, as the parts were built;
    // update() sets them back after.)
    this.driverDoor.rotation.y = 0;
    if (this.trailer) this.trailer.rotation.y = 0;
    for (const l of this.trailerLeaves) l.rotation.y = 0;
    this.root.updateMatrixWorld(true);
    const s = this.spec, bodyRegions = this.toonR;
    const invB = new THREE.Matrix4().copy(this.body.matrixWorld).invert(), invT = this.trailer ? new THREE.Matrix4().copy(this.trailer.matrixWorld).invert() : null;
    const M = new THREE.Matrix4(), Mi = new THREE.Matrix4(), v = new THREE.Vector3(), w = new THREE.Vector3();
    const trim = TOON_TRIM.map(([a, b]) => [new THREE.Color(a), new THREE.Color(b)] as const);
    const fridge = [TC.reefer, TC.grille, TC.black].map((h) => new THREE.Color(h)), cg = s.cargo;
    // (The cab and hood get taller, and the hood gets shorter.)
    // (The lift blends in behind the cab's back, so what spans it, a day cab's side extenders, stays straight.)
    const cabFrom = s.cargo ? s.cargo.x1 + 0.03 : s.cabBack - 0.3;
    const cabShape = (p: THREE.Vector3) => {
      if (p.y > s.cabFloor) p.y = s.cabFloor + (p.y - s.cabFloor) * (1 + (TOON_CAB - 1) * THREE.MathUtils.smoothstep(p.x, cabFrom, s.cabBack));
      if (s.cab !== "cabover" && p.x > s.cabFront) p.x = s.cabFront + (p.x - s.cabFront) * TOON_HOOD;
    };
    const lift = (TOON_CAB - 1) * (s.cabTop - s.cabFloor);   // (the reefer's fridge unit rises with the cab's roof)
    const isColour = (C: THREE.BufferAttribute | undefined, i: number, cs: THREE.Color[]) => !!C && cs.some((u) => Math.abs(u.r - C.getX(i)) + Math.abs(u.g - C.getY(i)) + Math.abs(u.b - C.getZ(i)) < 2e-3);
    // toon moves a point of the truck's frame (or the trailer's) to where the cartoon has it.
    const toon = (p: THREE.Vector3, regions: ToonRegion[], trailer: boolean) => {
      const R = regionAt(regions, p);
      if (R) toonRound(R, p);
      if (!trailer) cabShape(p);
      return p;
    };
    const visit = (o: any, trailer: boolean) => {
      if (!o.isMesh || o.isInstancedMesh || o.geometry.userData?.shared || o.geometry === this.slats?.geo || o === this.slats?.strap) return;
      const regions = trailer ? TRAILER_REGION : bodyRegions;
      M.multiplyMatrices(trailer ? invT! : invB, o.matrixWorld); Mi.copy(M).invert();
      const grow: ToonPart[] | undefined = o.userData.toonGrow, shrink: ToonPart[] | undefined = o.userData.toonShrink;
      // (The parts are cut across each region's curving bands, axis by axis.)
      if (!grow && !shrink) for (const R of regions) {
        const cuts = toonCuts(R);
        for (const axis of [0, 1, 2] as const) {
          const P0 = o.geometry.getAttribute("position") as THREE.BufferAttribute;
          const sliced = toonSlice(o.geometry, (i, out) => out.fromBufferAttribute(P0, i).applyMatrix4(M), axis, cuts[axis],
            (c) => c.x > R.x0 - 0.1 && c.x < R.x1 + 0.1 && c.y > R.y0 - 0.1 && c.y < R.y1 + 0.3 && Math.abs(c.z) < R.hw + 0.3);
          if (sliced.getAttribute("position").count !== P0.count) { o.geometry.dispose(); o.geometry = sliced; } else sliced.dispose();
        }
      }
      const g = o.geometry as THREE.BufferGeometry, P = g.getAttribute("position") as THREE.BufferAttribute, C = g.getAttribute("color") as THREE.BufferAttribute | undefined;
      const N = g.getAttribute("normal") as THREE.BufferAttribute | undefined;
      const full = new Float32Array(P.count * 3);
      let moved = false;
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i);
        const x = v.x, y = v.y, z = v.z;
        v.applyMatrix4(M);
        const keep = !trailer && !!cg && s.reefer === true && v.x > cg.x1 - 0.01 && v.x < cg.x1 + 0.5 && v.y > cg.top - 1.0 && isColour(C, i, fridge);
        if (!keep) toon(v, regions, trailer); else v.y += lift;
        v.applyMatrix4(Mi);
        full[i * 3] = v.x; full[i * 3 + 1] = v.y; full[i * 3 + 2] = v.z;
        if (Math.abs(v.x - x) + Math.abs(v.y - y) + Math.abs(v.z - z) > 1e-5) moved = true;
      }
      // (The headlamps move whole, as their middles do, and grow from nothing at their middles.)
      if (grow) for (const e of grow) {
        w.copy(e.c).applyMatrix4(M); toon(w, regions, trailer); w.applyMatrix4(Mi).sub(e.c);
        for (let i = e.start; i < e.start + e.count; i++) {
          full[i * 3] = P.getX(i) + w.x; full[i * 3 + 1] = P.getY(i) + w.y; full[i * 3 + 2] = P.getZ(i) + w.z;
          P.setXYZ(i, e.c.x, e.c.y, e.c.z);
        }
        P.needsUpdate = true; moved = true;
      }
      // (The truck's own headlamps shrink away to their middles.)
      if (shrink) for (const e of shrink) {
        w.copy(e.c).applyMatrix4(M); toon(w, regions, trailer); w.applyMatrix4(Mi);
        for (let i = e.start; i < e.start + e.count; i++) { full[i * 3] = w.x; full[i * 3 + 1] = w.y; full[i * 3 + 2] = w.z; }
        moved = true;
      }
      const pos = new Float32Array(P.count * 3);
      for (let i = 0; i < P.count; i++) { pos[i * 3] = full[i * 3] - P.getX(i); pos[i * 3 + 1] = full[i * 3 + 1] - P.getY(i); pos[i * 3 + 2] = full[i * 3 + 2] - P.getZ(i); }
      let nrm: Float32Array | null = null;
      if (N && moved && !g.index) {
        const fn = faceNormals(full, N.array, new Float32Array(N.count * 3));
        nrm = new Float32Array(N.count * 3);
        for (let i = 0; i < nrm.length; i++) nrm[i] = fn[i] - N.array[i];
      }
      let col: Float32Array | null = null, recol = false;
      if (C) {
        col = new Float32Array(C.count * 3);
        for (let i = 0; i < C.count; i++) {
          const r = C.getX(i), gg = C.getY(i), b = C.getZ(i);
          const hit = trim.find(([a]) => Math.abs(a.r - r) + Math.abs(a.g - gg) + Math.abs(a.b - b) < 2e-3);
          if (hit) { recol = true; col[i * 3] = hit[1].r - r; col[i * 3 + 1] = hit[1].g - gg; col[i * 3 + 2] = hit[1].b - b; }
        }
      }
      if (!moved && !recol) return;
      g.morphAttributes.position = [new THREE.BufferAttribute(pos, 3)];
      if (nrm) g.morphAttributes.normal = [new THREE.BufferAttribute(nrm, 3)];
      if (col) g.morphAttributes.color = [new THREE.BufferAttribute(col, 3)];
      g.morphTargetsRelative = true;
      g.computeBoundingSphere(); if (g.boundingSphere) g.boundingSphere.radius += 1;   // (this leaves room for the cartoon)
      o.updateMorphTargets(); o.morphTargetInfluences[0] = 0;
      this.toonMeshes.push(o);
    };
    this.body.traverse((o) => visit(o, !!this.trailer && isUnder(o, this.trailer)));
    if (this.trailer && !isUnder(this.trailer, this.body)) this.trailer.traverse((o) => visit(o, true));
    // (The crew's places in the cab move with it: its eyes, the tablet.)
    for (const a of [this.anchors.driverEye, this.anchors.passengerEye, this.anchors.tablet]) {
      const p0 = a.position.clone(), p1 = toon(a.position.clone(), bodyRegions, false);
      this.toonAnchors.push([a, p0, p1]);
    }
    this.wheels.setColorAt(0, this.toonCol.setHex(0xffffff));   // (the instance colours stay white until a cartoon)
    for (let j = 1; j < this.wheelSlots.length; j++) this.wheels.setColorAt(j, this.toonCol);
  }
  // toonEyes builds the cartoon's big round headlamps, a gold rim round a lens either side of its
  // nose, whole, and then shrinks them to their middles: the cartoon grows them. The lenses are the
  // headlamps' own (lit with them, cream when off: LightSet), and the truck's own lamps shrink away.
  private toonEyes() {
    const s = this.spec, P = new Batch(), Ln = new Batch(), grow: ToonPart[] = [], lens: ToonPart[] = [];
    const conv = s.cab !== "cabover";
    // (On a hood they stand proud on its front corners; on a cab-over's face they sit low in its corners.)
    const x = conv ? s.noseFront - 0.3 : s.cabFront + 0.05, y = conv ? s.hoodTop - 0.02 : s.cabFloor + 0.34, r = conv ? 0.4 : 0.34;
    for (const z of [-1, 1]) {
      const zc = z * (s.cabHW - (conv ? 0.42 : 0.38));
      const p0 = P.view().count; P.cyl(x, y, zc, r, 0.12, TC.chrome, 14, 0, Math.PI / 2);
      grow.push({ start: p0, count: P.view().count - p0, c: new THREE.Vector3(x, y, zc) });
      const l0 = Ln.view().count; Ln.cyl(x + 0.03, y, zc, r * 0.78, 0.12, 0xffffff, 14, 0, Math.PI / 2);
      lens.push({ start: l0, count: Ln.view().count - l0, c: new THREE.Vector3(x + 0.03, y, zc) });
    }
    const pm = P.build(this.kit.paint)!, lm = Ln.build(this.lights.mats.head)!;
    pm.userData.toonGrow = grow; lm.userData.toonGrow = lens;
    this.body.add(pm, lm);
  }

  // ---- construction --------------------------------------------------------------------------

  private lightBatches(): Record<LightKey, Batch> {
    const r = {} as Record<LightKey, Batch>;
    for (const k of LIGHT_KEYS) r[k] = new Batch();
    return r;
  }
  private addLights(parent: THREE.Object3D, lights: Record<LightKey, Batch>) {
    for (const k of LIGHT_KEYS) {
      const m = lights[k].build(this.lights.mats[k]);
      if (!m) continue;
      if (k === "head") m.userData.toonShrink = this.headLamps;
      parent.add(m);
    }
  }
  // A headlamp, a box from (x0, y0, z0) to (x1, y1, z1); the cartoon shrinks it away to its middle
  // (its own big round lamps light up in its place: toonEyes).
  private headLamps: ToonPart[] = [];
  private headLamp(B: Batch, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    const start = B.view().count;
    B.span(x0, y0, z0, x1, y1, z1);
    this.headLamps.push({ start, count: B.view().count - start, c: new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) });
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
    // (Out to a tip past the bed's side, so the puffs, which blow out sideways, then rise and swell,
    // clear the floor and the wall instead of coming up through them.)
    if (s.exhaust === "pipe") {
      const [px, py, pz] = pipeMouth(s), end = pz - PIPE_MOUTH;
      P.cyl(px, py, end - 0.2, 0.05, 0.4, TC.chrome, 6, Math.PI / 2);
      this.exhaust.push(new THREE.Vector3(px, py, pz));
    }
    if (!s.cargo && s.cab === "daycab") { // tractor tail lights on the frame end
      for (const z of [-1, 1]) {
        L.tail.span(rear - 0.06, ft - 0.2, z * 0.62, rear, ft - 0.05, z * 0.9);
        (z < 0 ? L.sigL : L.sigR).span(rear - 0.06, ft - 0.2, z * 0.92, rear, ft - 0.05, z * 1.05);
      }
    }
  }

  // The dome lights inside the cargo box and the cab (atmosphere.ts INTERIOR_LIGHT): for each, the
  // inside of the box in world space as (centre, yaw) and (half sizes, on), then the cartoon's
  // shape of it (domeShape). Only the faces inside a box catch its light, so the outside of the
  // truck stays as it is.
  interiorLight(out: THREE.Vector4[], cargoOn: boolean, cabOn: boolean) {
    const box = (i: number, parent: THREE.Object3D, x0: number, x1: number, y0: number, y1: number, hw: number, on: boolean, R: ToonRegion | null, stretch: number) => {
      parent.updateWorldMatrix(true, false);
      const c = this.ivTmp.set((x0 + x1) / 2, (y0 + y1) / 2, 0).applyMatrix4(parent.matrixWorld);
      const f = this.ivTmp2.set(1, 0, 0).transformDirection(parent.matrixWorld);
      out[i].set(c.x, c.y, c.z, Math.atan2(-f.z, f.x));
      // (w: off 0, on 2 + the body's pitch, so the box tilts with it up a ramp: atmosphere.ts.)
      out[i + 1].set((x1 - x0) / 2, (y1 - y0) / 2, hw, on ? 2 + Math.atan2(f.y, Math.hypot(f.x, f.z)) : 0);
      this.domeShape(out, i + 2, (x0 + x1) / 2, (y0 + y1) / 2, R, stretch);
    };
    const c = this.boxSpec, s = this.spec, K = this.toon;
    if (c && this.boxParent) box(0, this.boxParent, c.x0 + 0.12, c.x1 - 0.07,   // starts behind the closed rear door (x0 + 0.09), which is one sheet
       c.floor - 0.01, c.top - 0.07, c.hw - 0.06, cargoOn, this.trailer ? TRAILER_REGION[0] : this.toonR.find((R) => R.x0 === c.x0) ?? null, 1); else out[1].w = 0;
    box(5, this.body, s.cabBack + 0.06, s.cabFront - 0.03, s.cabFloor - 0.01, s.cabTop - 0.06, s.cabHW - 0.06, cabOn, this.toonR[0], 1 + (TOON_CAB - 1) * K);
  }
  // domeShape writes a dome-lit box's cartoon shape, by `toon`, into out[i..i+2], measured from the
  // box's middle (cx, cy): where each rounded band of its shell's region R starts (top, side, front,
  // back), each band's radius, then the height above which the front is rounded, how far the cab
  // is stretched up (stretch) and how much it is puffed out. The shader undoes the cartoon before it
  // tests the box (atmosphere.ts), so what the rounding pulls in past the box's walls, the shell
  // and the door's posts, stays out of the light.
  private domeShape(out: THREE.Vector4[], i: number, cx: number, cy: number, R: ToonRegion | null, stretch: number) {
    const k = R ? this.toon : 0;
    if (!R || k <= 0) { out[i].set(0, 0, 0, 0); out[i + 1].set(0, 0, 0, 0); out[i + 2].set(-1e3, 1, 0, 0); return; }
    out[i].set(R.y1 - R.top * k - cy, R.hw - R.side * k, R.x1 - R.front * k - cx, cx - R.x0 - R.back * k);
    out[i + 1].set(R.top * k, R.side * k, R.front * k, R.back * k);
    out[i + 2].set(R.frontFrom === undefined ? -1e3 : R.frontFrom - cy, stretch, R.pillow * k, 0);
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
      // Grab handles for climbing in: one outside on the pillar behind the door, one just inside the
      // door opening on the pillar ahead of it (crew.ts cabGeom).
      P.span(dxb - 0.1, yf + 0.12, z * (hw + 0.035), dxb - 0.06, belt + 0.32, z * (hw + 0.075), TC.chrome);
      for (const y of [yf + 0.14, belt + 0.3]) P.span(dxb - 0.1, y - 0.02, zo, dxb - 0.06, y + 0.02, z * (hw + 0.075), TC.chrome);
      P.span(dxf - 0.07, yf + 0.3, z * (hw - 0.14), dxf - 0.03, belt + 0.25, z * (hw - 0.1), TC.chrome);
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
        this.headLamp(L.head, nose - 0.02, R2 - 0.08, z * (hH - 0.22), nose + 0.01, R2 + 0.1, z * (hH + 0.05));
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
        this.headLamp(L.head, xf, yf + 0.16, z * (hw - 0.36), xf + 0.04, yf + 0.36, z * (hw - 0.08));
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
    this.anchors.cabDoorGround.position.set(dxb - 0.3, 0, -(hw + 0.45));   // (truckExtents doorX, doorZ)
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
    P.span(x0 - 0.055, yfl - 0.13, -hw + 0.125, x0 + 0.06, yfl + 0.02, hw - 0.125, TC.alu);   // rear sill, between the posts (its foot and back off the floor plate's and the doors' planes)
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
        leaf.add(new THREE.Mesh(geo, this.kit.livery.liveryRear), new THREE.Mesh(geo, this.kit.doorInside));
        const frame = new Batch(); frame.span(-0.04, yfl, side > 0 ? -wl : 0, 0, yfl + openH, side > 0 ? 0 : wl, TC.white);
        // Two lock rods down its face, each with its handle low down, swung in towards the hinge
        // (the crew lifts them: chores.ts leafAt), and their keepers top and bottom.
        for (const f of [0.42, 0.82]) {
          const z = -side * wl * f;
          frame.span(-0.085, yfl - 0.04, z - 0.022, -0.05, yfl + openH + 0.03, z + 0.022, TC.chrome);
          const hz0 = Math.min(z, z + side * 0.3), hz1 = Math.max(z, z + side * 0.3);
          frame.span(-0.11, LEAF_HANDLE_Y - 0.03, hz0, -0.08, LEAF_HANDLE_Y + 0.03, hz1, TC.chrome);
          for (const y of [yfl + 0.06, yfl + openH - 0.06]) frame.span(-0.1, y - 0.04, z - 0.05, -0.045, y + 0.04, z + 0.05, TC.frame);
        }
        leaf.add(frame.build(this.kit.paint)!);
        leaf.position.set(x0 - 0.02, 0, side * (hw - 0.02));
        parent.add(leaf);
        this.trailerLeaves.push(leaf);
      }
    } else {
      // (Each slat is cut into SLAT_COLS pieces across, so the cartoon can bend it round the box's corners.)
      const n = 10, m = SLAT_COLS, geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * m * 18), 3));
      const uv = new Float32Array(n * m * 12);
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
        const v0 = i / n, v1 = (i + 1) / n, u0 = j / m, u1 = (j + 1) / m;
        uv.set([u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1], (i * m + j) * 12);
      }
      geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(n * m * 18), 3));
      parent.add(new THREE.Mesh(geo, this.kit.livery.liveryRear), new THREE.Mesh(geo, this.kit.slatInside));
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
      this.slats = { geo, n, x: x0 + 0.09, floor: yfl, track: yt - 0.12, open: openH, halfW: hw - 0.12, last: NaN, lastToon: NaN, strap, strapLen,
        region: this.toonR.find((R) => R.x0 === x0) ?? null };
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

  // Roll-up door: slats ride a track up the door opening, then forward under the roof. In the
  // cartoon (toon) each point goes as far towards where the rounded box has it (toonRound) as the
  // rest of the truck's morph does, so the door curves with the box's back and, rolled up, with its
  // roof. Its normals are worked out from its faces: up under the roof they face down into the box.
  private layoutSlats(f: number) {
    const S = this.slats!, K = this.toon, R = K > 0 ? S.region : null; S.last = f; S.lastToon = K;
    const pos = S.geo.attributes.position.array as Float32Array, P = this.v3, Q = this.s3;
    const h = S.open / S.n, lv = S.track - S.floor, m = SLAT_COLS;
    const pt = (s: number): [number, number] => (s <= lv ? [S.x, S.floor + s] : [S.x + (s - lv), S.track]);
    let o = 0;
    const put = (x: number, y: number, z: number) => {
      P.set(x, y, z);
      if (R && regionAt([R], P)) P.lerp(toonRound(R, Q.copy(P)), K);
      pos[o++] = P.x; pos[o++] = P.y; pos[o++] = P.z;
    };
    for (let i = 0; i < S.n; i++) {
      const [xa, ya] = pt(i * h + f * S.open), [xb, yb] = pt((i + 1) * h + f * S.open);
      for (let j = 0; j < m; j++) {
        const z0 = S.halfW * (2 * j / m - 1), z1 = S.halfW * (2 * (j + 1) / m - 1);
        put(xa, ya, z0); put(xa, ya, z1); put(xb, yb, z1); put(xa, ya, z0); put(xb, yb, z1); put(xb, yb, z0);
      }
    }
    const N = S.geo.attributes.normal as THREE.BufferAttribute;
    faceNormals(pos, N.array, N.array as Float32Array);
    S.geo.attributes.position.needsUpdate = true; N.needsUpdate = true;
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
      P.span(xb - EXTENDER_LEN, s.cabFloor, z * (hw - 0.03), xb, yt + 0.75, z * hw, TC.white); // side extenders
      P.cyl(xb - STACK_BACK, (ft + STACK_TOP) / 2, z * STACK_Z, STACK_R, STACK_TOP - ft, TC.chrome, 8); // stacks
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
    const G = new Batch(), len = GATE_LEN - GATE_FLAP - GATE_GAP;
    G.span(-len, -0.085, -c.hw + 0.15, 0, -0.005, c.hw - 0.15, TC.alu);   // (5 mm off the planes of the chassis it folds under)
    for (let x = -len + 0.1; x < -0.05; x += 0.2) G.span(x, 0, -c.hw + 0.18, x + 0.06, 0.01, c.hw - 0.18, TC.hub);
    for (const z of [-1, 1]) G.span(-0.08, -0.08, z * (c.hw - 0.2), 0, 0.12, z * (c.hw - 0.12), TC.black);
    this.liftGroup = new THREE.Group();
    this.liftGroup.add(G.build(this.kit.paint)!);
    // The flip-over end: hinged at the deck's outer bottom edge (5 mm off its end), level with it
    // when out and folded flat under it when stowed.
    const F = new Batch(), f = GATE_FLAP - 0.005;
    F.span(-f, 0, -c.hw + 0.15, 0, 0.08, c.hw - 0.15, TC.alu);
    for (let x = -f + 0.08; x < -0.05; x += 0.2) F.span(x, 0.085, -c.hw + 0.18, x + 0.06, 0.095, c.hw - 0.18, TC.hub);
    this.liftFlap = new THREE.Group();
    this.liftFlap.position.set(-len - 0.005, -0.085, 0);
    this.liftFlap.rotation.z = Math.PI;
    this.liftFlap.add(F.build(this.kit.paint)!);
    this.liftGroup.add(this.liftFlap);
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
      P.span(-3.4, 0.48, z * (t.hw - 0.05), t.axles[0] + 1, t.floor - 0.12, z * (t.hw - 0.02), TC.skirt);   // (The skirt stops a metre short of the tandem.)
      P.span(t.axles[1] - 0.65, 0.62, z * 0.5, t.axles[0] + 0.6, t.floor - 0.12, z * 0.6, TC.frame);   // (The tandem's slider runs past its axles.)
    }
    P.span(-0.58, t.floor - 0.18, -0.9, 0.9, t.floor - 0.12, 0.9, TC.frame);   // (its front just behind the fifth wheel's)
    P.span(-0.05, t.floor - 0.3, -0.05, 0.05, t.floor - 0.18, 0.05, TC.chrome);   // kingpin
    // The underride guard under its back, a little out behind the doors: a bar across on two
    // struts down from the frame (the crew steps on it, its top UNDERRIDE_Y, climbing in).
    P.span(t.rear - 0.27, UNDERRIDE_Y - 0.13, -(t.hw - 0.14), t.rear - 0.13, UNDERRIDE_Y, t.hw - 0.14, TC.frame);
    for (const z of [-0.72, 0.72]) {
      P.span(t.rear - 0.24, UNDERRIDE_Y, z - 0.05, t.rear - 0.16, t.floor - 0.4, z + 0.05, TC.frame);   // (strut up, and back in under the floor)
      P.span(t.rear - 0.24, t.floor - 0.4, z - 0.05, t.rear + 0.3, t.floor - 0.3, z + 0.05, TC.frame);
    }
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
function isUnder(o: THREE.Object3D, p: THREE.Object3D) { for (let q: THREE.Object3D | null = o; q; q = q.parent) if (q === p) return true; return false; }
