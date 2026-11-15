// Loads: how the cargo models are arranged when the crew moves them, the load riding in the
// truck's bed, and walk-on animals.
//
// Carried loads are built once per cargo type into one mesh arranged for the cargo's handling:
// in the arms, stacked on the hand truck, on a pallet for the pallet jack, standing on edge to
// roll, on a dolly to push, or long between two people. A few carry small animations for the
// gag shots (a wobbling inflatable gorilla, a penguin peeking out of its crate, a portable
// toilet's door swinging).
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { Truck, truckLayout } from "./truck.ts";
import type { TruckModel } from "./truck.ts";
import { CARGO_BY_ID } from "./cargo.ts";
import { bedUnits } from "./chores.ts";
import type { Aboard } from "./journey.ts";
import { CARGO_MODELS } from "./cargomodels.ts";

export interface CarriedLoad {
  group: THREE.Group;
  size: [number, number, number];   // arrangement extents: length (x), height (y), width (z)
  round: boolean;                    // rolls about z (radius = height / 2)
  animate?: (t: number) => void;
}

const DOLLY_H = 0.12;

// `n`: units on this trip, for loads carried as a stack (a flat pair of mattresses, two small
// things in the arms); the hand truck and pallet jack keep their own arrangement.
export function buildCarried(id: string, material: THREE.Material, n = 1): CarriedLoad {
  const c = CARGO_BY_ID.get(id)!, m = CARGO_MODELS[id];
  const [l, h, w] = m.size;
  const b = new Batch();
  const group = new THREE.Group();
  let size: [number, number, number] = [l, h, w];
  switch (c.handling) {
    case "handTruck": {
      // As many units as stand up to ~1.25 m on the nose plate.
      const n = Math.max(1, Math.min(4, Math.floor(1.25 / h)));
      for (let k = 0; k < n; k++) m.build(b, 0, k * h, 0, k);
      size = [l, n * h, w];
      break;
    }
    case "palletJack": {
      if (m.palletized) m.build(b, 0, 0, 0, 0);
      else {
        // A pallet with a block of units on it.
        b.box(0, 0.07, 0, 1.2, 0.14, 1.0, 0xa47a4a);
        const nx = Math.max(1, Math.floor(1.15 / l)), nz = Math.max(1, Math.floor(0.95 / w)), ny = Math.max(1, Math.min(3, Math.floor(1.0 / h)));
        for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++)
          m.build(b, (x - (nx - 1) / 2) * l, 0.14 + y * h, (z - (nz - 1) / 2) * w, x + z + y);
        size = [1.2, 0.14 + ny * h, 1.0];
      }
      break;
    }
    case "push":
      if (id !== "motorcycles") { b.box(0, DOLLY_H / 2, 0, l + 0.1, DOLLY_H, w + 0.05, 0x333333); m.build(b, 0, DOLLY_H, 0, 0); size = [l, h + DOLLY_H, w]; }
      else m.build(b, 0, 0, 0, 0);
      break;
    default:
      // One, or a stack (small things in twos, mattresses in a flat pair).
      for (let k = 0; k < Math.max(1, n); k++) m.build(b, 0, k * h, 0, k);
      size = [l, Math.max(1, n) * h, w];
  }
  group.add(b.build(material)!);
  const load: CarriedLoad = { group, size, round: !!m.round };
  if (id === "frog") load.animate = (t) => { group.rotation.x = 0.1 * Math.sin(t * 2.7); group.position.y += 0.03 * Math.sin(t * 5.1); };
  if (id === "gorilla") load.animate = (t) => { group.rotation.x = 0.12 * Math.sin(t * 3.1); group.rotation.z = 0.08 * Math.sin(t * 2.3 + 1); };
  if (id === "penguin") {
    const pb = new Batch();
    pb.box(0, 0.16, 0, 0.26, 0.32, 0.22, 0x111111); pb.box(0.11, 0.14, 0, 0.05, 0.22, 0.16, 0xf4f4f4); pb.box(0.15, 0.22, 0, 0.08, 0.04, 0.06, 0xf39c12);
    const head = pb.build(material)!; group.add(head);
    load.animate = (t) => { head.position.set(0.1, 0.78 + Math.max(0, Math.sin(t * 2.2)) * 0.3, 0); };
  }
  if (id === "toilet") {
    const db = new Batch(); db.box(0, 0.95, 0.4, 0.04, 1.9, 0.8, 0x1f6ab8);
    const door = new THREE.Group(); door.add(db.build(material)!); door.position.set(0.56, 0, -0.4); group.add(door);
    load.animate = (t) => { door.rotation.y = -0.6 - 0.5 * Math.sin(t * 2.7); };
  }
  return load;
}

// ---- the bed ---------------------------------------------------------------------------------
// The load in the truck's bed, from the ledger, each unit where chores.ts bedUnits puts it. One
// mesh, rebuilt only when what is aboard changes, parented to the box body (or the trailer).
export class BedLoad {
  private mesh: THREE.Mesh | null = null;
  private key = "";
  private owner: Truck | null = null;
  constructor(private material: THREE.Material) {}

  update(truck: Truck, aboard: Aboard[]) {
    const key = truck.model + "|" + aboard.map((a) => `${a.cargo}:${a.units}@${a.slot}`).join(",");
    if (key === this.key && truck === this.owner) return;
    this.key = key; this.owner = truck;
    if (this.mesh) { this.mesh.removeFromParent(); this.mesh.geometry.dispose(); this.mesh = null; }
    const L = truckLayout(truck.model);
    if (!aboard.length || (!L.trailer && !truckSpecHasBed(truck.model))) return;
    const b = new Batch();
    for (const a of aboard) {
      const m = CARGO_MODELS[a.cargo];
      if (!m) continue;
      bedUnits(L, truck.model, a.cargo, a.units, a.slot).forEach((p, u) => m.build(b, p[0], p[1], p[2], u));
    }
    const mesh = b.build(this.material);
    if (!mesh) return;
    const bp = truck.bedParent;
    mesh.position.x = bp.offsetX;
    bp.parent.add(mesh);
    this.mesh = mesh;
  }
}
function truckSpecHasBed(m: TruckModel) { return m !== "tractor"; }

// ---- animals ---------------------------------------------------------------------------------
// Walk-on cargo: bodies with separately swinging legs. Goats come in a little line, and on the
// way one escapes for a lap round the driver before rejoining.
export class Herd {
  readonly animals: { root: THREE.Group; legs: THREE.Group[]; size: [number, number, number] }[] = [];
  readonly id: string;
  constructor(id: string, count: number, material: THREE.Material, scene: THREE.Scene) {
    this.id = id;
    const m = CARGO_MODELS[id], L = m.legs!;
    for (let i = 0; i < count; i++) {
      const root = new THREE.Group();
      const b = new Batch(); m.build(b, 0, 0, 0, i, true); root.add(b.build(material)!);
      const legs: THREE.Group[] = [];
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const lb = new Batch(); lb.box(0, -L.h / 2, 0, L.t, L.h, L.t, L.color(i));
        const leg = new THREE.Group(); leg.add(lb.build(material)!); leg.position.set(sx * L.lx, L.h, sz * L.lz);
        root.add(leg); legs.push(leg);
      }
      root.visible = false; scene.add(root);
      this.animals.push({ root, legs, size: m.size });
    }
  }
  // Place animal i at (x, y, z) facing yaw, legs at walk phase (cycles).
  pose(i: number, x: number, y: number, z: number, yaw: number, phase: number, walking: boolean) {
    const a = this.animals[i];
    a.root.visible = true;
    a.root.position.set(x, y + (walking ? 0.03 * Math.abs(Math.sin(phase * Math.PI * 2)) : 0), z);
    a.root.rotation.set(0, yaw, 0);
    a.legs.forEach((leg, k) => { leg.rotation.z = walking ? 0.5 * Math.sin((phase + (k === 0 || k === 3 ? 0 : 0.5)) * Math.PI * 2) : 0; });
  }
  hide() { for (const a of this.animals) a.root.visible = false; }
  dispose() { for (const a of this.animals) { a.root.removeFromParent(); a.root.traverse((o: any) => o.geometry?.dispose()); } }
}
