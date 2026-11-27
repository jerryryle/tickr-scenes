// A horse, for everything horse-drawn in the Victorian city: the carriages the trucks become there
// (truck.ts carriage) and its traffic (city-victorian/victorian-vehicles.ts). A horse is HORSE_PARTS
// rigid parts, each built once (horseParts) and placed every frame by a matrix (poseHorse), so a
// city's traffic can draw a part of every horse of a kind as one instanced mesh. Its pose comes from
// how far it has come (odo), how fast it goes (v), the time (t) and a number of its own (seed),
// alone, so scrubbing replays it: a walk, a trot when it goes faster, and standing, a horse shifts
// its weight, swishes its tail and tosses its head now and then.
//
// The horse's frame: +x forward, y up, z to its right; the origin on the ground under its withers
// (the top of its shoulders), where a collar's traces or a shaft's tug are hitched. Units are metres.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";

// A horse's size, in its frame: its length from rump to nose (behind and ahead of the origin), its
// withers' height and its width over the barrel; HITCH is where traces attach on its shoulder.
export const HORSE = { back: 1.45, front: 0.95, withers: 1.62, width: 0.62, hitch: [0.1, 1.15] as const };
export const HORSE_PARTS = 7;   // body, neck and head, tail, four legs (fore left, fore right, hind left, hind right)
export interface HorseState { odo: number; v: number; t: number; seed: number }
// A coat (the body's colour), its mane, tail and lower legs' colour, and its harness's.
export interface HorseLook { coat: number; mane: number; harness: number }
export const HORSE_COATS: readonly HorseLook[] = [
  { coat: 0x6a3e24, mane: 0x241812, harness: 0x1a1412 },   // bay
  { coat: 0x3a2618, mane: 0x16100c, harness: 0x1a1412 },   // dark brown
  { coat: 0x9a6a3a, mane: 0x4a2e1a, harness: 0x1a1412 },   // chestnut
  { coat: 0x8a8a86, mane: 0x3a3a3a, harness: 0x1a1412 },   // grey
  { coat: 0x1c1a1a, mane: 0x0e0c0c, harness: 0x3a1a12 },   // black
];

// The parts' builders, in their own frames (each leg hangs from its hip or shoulder at the origin).
export function horseParts(look: HorseLook): ((b: Batch) => void)[] {
  const leg = (b: Batch) => { b.box(0, -0.42, 0, 0.12, 0.84, 0.12, look.coat); b.box(0, -0.98, 0, 0.1, 0.28, 0.1, look.mane); };
  return [
    (b) => { b.box(-0.25, 1.25, 0, 1.6, 0.6, look.coat === 0 ? 0.6 : HORSE.width, look.coat); b.box(0.15, 1.2, 0, 0.12, 0.62, 0.7, look.harness); },
    (b) => { b.box(0.25, 0.25, 0, 0.5, 0.3, 0.26, look.coat); b.box(0.55, 0.05, 0, 0.45, 0.22, 0.22, look.coat); },
    (b) => { b.box(-0.05, -0.3, 0, 0.12, 0.6, 0.12, look.mane); },
    leg, leg, leg, leg,
  ];
}

const m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), ee = new THREE.Euler(), vv = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
const at = (o: THREE.Matrix4, x: number, y: number, z: number, rz = 0) => o.compose(vv.set(x, y, z), qq.setFromEuler(ee.set(0, 0, rz)), one);
// poseHorse writes its parts' matrices into out[i..i + HORSE_PARTS), each `base` (the horse's
// frame in its rig's) times the part's place in the horse's frame.
export function poseHorse(s: HorseState, base: THREE.Matrix4, out: THREE.Matrix4[], i: number) {
  const ph = s.odo / 1.6 * Math.PI * 2, k = Math.min(1, s.v / 1.5);
  const parts: [number, number, number, number][] = [
    [0, 0, 0, 0], [0.55, 1.4, 0, 0.5], [-1.05, 1.45, 0, 0],
    [0.45, 1.05, -0.17, 0.45 * k * Math.sin(ph)], [0.45, 1.05, 0.17, -0.45 * k * Math.sin(ph)],
    [-0.95, 1.05, -0.17, -0.45 * k * Math.sin(ph)], [-0.95, 1.05, 0.17, 0.45 * k * Math.sin(ph)],
  ];
  parts.forEach(([x, y, z, r], j) => out[i + j].multiplyMatrices(base, at(m4, x, y, z, r)));
}
