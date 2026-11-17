// The car models every car in Long Day is drawn with: ambient traffic (traffic.ts), oncoming cars
// in the country (countryworld.ts), freeway traffic (freeway.ts), and parked cars in parking lots,
// the garage and on and around the ferry. Use these rather than building cars in place.
//
// A car is x forward, its origin on the ground at its middle. The body above the wheel arches is
// lofted through cross-sections along its length (a sloped hood, raked glass, a roof drawn in from
// the sides, rounded ends), flat-shaded; under it a lower body cut away over the wheels, bumpers,
// lamps and plates. Paint is pure white unless given, so instanceColor can tint it (Batch.stamp
// repaints it the same way); glass, tyres and trim stay dark.
import * as THREE from "three@0.187.0";
import { Batch, BATCH } from "./geom.ts";
import type { BatchModel } from "./geom.ts";

export const GLASS = 0x26313d, TYRE = 0x161616;
const GLASS_TOP = 0x33455a;   // windscreen and rear glass, catching the sky
const TRIM = 0x23262b, CHROME = 0xb8bcc0, PLASTIC = 0x2b2d31, WELL = 0x0e0f11, PLATE = 0xe6e4da;

// Lamps tagged for the night glow (applyLampGlow): aux.z -3 headlamps, -4 tail lamps. Parked cars
// are built with `lit` off: their lamps are just coloured.
let LIT = true;
export function headLamp(b: Batch, x: number, y: number, z: number, w: number, h: number, d: number) {
  if (LIT) b.aux.set(0, 0, -3);
  b.box(x, y, z, w, h, d, 0xfff4d0); b.aux.set(0, 0, -1);
}
export function tailLamp(b: Batch, x: number, y: number, z: number, w: number, h: number, d: number) {
  if (LIT) b.aux.set(0, 0, -4);
  b.box(x, y, z, w, h, d, 0xc01818); b.aux.set(0, 0, -1);
}

export type CarKind = "sedan" | "hatch" | "wagon" | "suv" | "pickup" | "van";
export const CAR_KINDS: CarKind[] = ["sedan", "hatch", "wagon", "suv", "pickup", "van"];
export const CAR_PAINTS = [0xb22222, 0x1f4fa0, 0xe8e8e8, 0x222428, 0x7a7f86, 0xd4a017, 0x2e7d4f, 0x8a3fa0, 0xe8e0d0, 0x5a2a1a, 0x3a8ac8, 0xc8ccd0];

// A cross-section of the upper body at `x`: half-widths and heights of the body's side at the
// bottom (wl, at the arch tops), the belt line (wb, yb) and the top edge (wt, yt); the roof (or
// hood, or trunk lid) is drawn in a little from the top edge. `seg` paints the stretch from here
// to the next section: b body, g side glass under the roof, w / r windscreen / rear glass (side
// glass too), p a pillar.
type Section = [x: number, wl: number, wb: number, yb: number, wt: number, yt: number, seg: string];
interface CarSpec {
  len: number; width: number;
  r: number; wheelIn: number; clear: number;   // wheel radius, axle in from each end, the body's bottom
  sections: Section[];
  extra?: (b: Batch, s: CarSpec, paint: number) => void;
}

const F = (L: number) => L / 2;
export const CAR_SPECS: Record<CarKind, CarSpec> = {
  sedan: { len: 4.6, width: 1.8, r: 0.33, wheelIn: 0.92, clear: 0.27, sections: ((f) => [
    [-f, 0.84, 0.80, 0.86, 0.70, 0.90, "b"], [-f + 0.15, 0.89, 0.88, 0.93, 0.78, 0.98, "b"],
    [-f + 0.85, 0.90, 0.90, 0.95, 0.80, 1.00, "r"], [-f + 1.42, 0.90, 0.90, 0.96, 0.70, 1.42, "g"],
    [-0.12, 0.90, 0.90, 0.96, 0.69, 1.45, "p"], [-0.02, 0.90, 0.90, 0.96, 0.69, 1.45, "g"],
    [0.55, 0.90, 0.90, 0.96, 0.70, 1.42, "w"], [f - 1.12, 0.90, 0.90, 0.95, 0.80, 1.00, "b"],
    [f - 0.15, 0.89, 0.87, 0.88, 0.76, 0.91, "b"], [f, 0.84, 0.80, 0.82, 0.68, 0.84, "b"],
  ] as Section[])(F(4.6)) },
  hatch: { len: 4.0, width: 1.75, r: 0.32, wheelIn: 0.75, clear: 0.27, sections: ((f) => [
    [-f, 0.83, 0.80, 0.88, 0.70, 0.95, "b"], [-f + 0.08, 0.86, 0.85, 0.94, 0.75, 1.00, "r"],
    [-f + 0.32, 0.875, 0.87, 0.96, 0.69, 1.46, "g"], [-0.32, 0.875, 0.87, 0.96, 0.68, 1.50, "p"],
    [-0.22, 0.875, 0.87, 0.96, 0.68, 1.50, "g"], [0.32, 0.875, 0.87, 0.96, 0.69, 1.47, "w"],
    [f - 0.98, 0.875, 0.87, 0.95, 0.78, 1.00, "b"], [f - 0.14, 0.86, 0.85, 0.88, 0.74, 0.90, "b"],
    [f, 0.82, 0.78, 0.82, 0.66, 0.84, "b"],
  ] as Section[])(F(4.0)) },
  wagon: { len: 4.7, width: 1.8, r: 0.33, wheelIn: 0.92, clear: 0.27, sections: ((f) => [
    [-f, 0.84, 0.81, 0.88, 0.71, 0.96, "b"], [-f + 0.1, 0.88, 0.87, 0.94, 0.75, 1.02, "r"],
    [-f + 0.38, 0.90, 0.90, 0.96, 0.70, 1.44, "g"], [-0.95, 0.90, 0.90, 0.96, 0.69, 1.46, "p"],
    [-0.85, 0.90, 0.90, 0.96, 0.69, 1.46, "g"], [-0.12, 0.90, 0.90, 0.96, 0.69, 1.47, "p"],
    [-0.02, 0.90, 0.90, 0.96, 0.69, 1.47, "g"], [0.58, 0.90, 0.90, 0.96, 0.70, 1.44, "w"],
    [f - 1.12, 0.90, 0.90, 0.95, 0.80, 1.00, "b"], [f - 0.15, 0.89, 0.87, 0.88, 0.76, 0.91, "b"],
    [f, 0.84, 0.80, 0.82, 0.68, 0.84, "b"],
  ] as Section[])(F(4.7)) },
  suv: { len: 4.8, width: 1.95, r: 0.38, wheelIn: 0.95, clear: 0.32, sections: ((f) => [
    [-f, 0.93, 0.92, 1.00, 0.82, 1.10, "b"], [-f + 0.1, 0.965, 0.96, 1.06, 0.86, 1.16, "r"],
    [-f + 0.3, 0.975, 0.97, 1.08, 0.80, 1.76, "g"], [-0.95, 0.975, 0.97, 1.08, 0.79, 1.79, "p"],
    [-0.83, 0.975, 0.97, 1.08, 0.79, 1.79, "g"], [-0.14, 0.975, 0.97, 1.08, 0.79, 1.80, "p"],
    [-0.02, 0.975, 0.97, 1.08, 0.79, 1.80, "g"], [0.72, 0.975, 0.97, 1.08, 0.80, 1.76, "w"],
    [f - 1.15, 0.975, 0.97, 1.07, 0.88, 1.17, "b"], [f - 0.12, 0.96, 0.95, 1.02, 0.84, 1.09, "b"],
    [f, 0.92, 0.90, 0.98, 0.80, 1.01, "b"],
  ] as Section[])(F(4.8)), extra: (b) => {
    for (const z of [-0.7, 0.7]) b.box(-0.55, 1.84, z, 2.3, 0.06, 0.06, TRIM);   // roof rails
  } },
  pickup: { len: 5.4, width: 2.0, r: 0.38, wheelIn: 1.05, clear: 0.32, sections: ((f) => [
    [-0.62, 1.0, 1.0, 1.04, 0.84, 1.80, "p"], [-0.50, 1.0, 1.0, 1.04, 0.83, 1.83, "g"],
    [0.10, 1.0, 1.0, 1.04, 0.83, 1.83, "p"], [0.20, 1.0, 1.0, 1.04, 0.83, 1.83, "g"],
    [0.66, 1.0, 1.0, 1.04, 0.84, 1.80, "w"], [f - 1.3, 1.0, 1.0, 1.04, 0.92, 1.13, "b"],
    [f - 0.12, 0.99, 0.98, 1.00, 0.90, 1.05, "b"], [f, 0.95, 0.93, 0.96, 0.84, 0.99, "b"],
  ] as Section[])(F(5.4)), extra: (b, s, P) => {
    const f = s.len / 2, y0 = 2 * s.r + 0.02, top = 1.3, bx0 = -f, bx1 = -0.66;
    b.box(-0.635, 1.48, 0, 0.04, 0.32, 1.3, GLASS);                              // the cab's back window
    for (const z of [-1, 1]) b.box((bx0 + bx1) / 2, (y0 + top) / 2, z * 0.955, bx1 - bx0, top - y0, 0.09, P);   // bed sides
    b.box(bx0 + 0.05, (y0 + top) / 2, 0, 0.1, top - y0, 1.82, P);                  // tailgate
    b.box(bx1 - 0.03, (y0 + top) / 2, 0, 0.06, top - y0, 1.82, P);                 // the bed's front wall
    b.box((bx0 + bx1) / 2, y0 + 0.04, 0, bx1 - bx0 - 0.1, 0.04, 1.82, 0x2a2a2a);  // the bed's floor
    for (const z of [-1, 1]) b.box((bx0 + bx1) / 2, top + 0.015, z * 0.955, bx1 - bx0, 0.03, 0.11, TRIM);   // bed rail caps
    b.box(bx0 - 0.005, top - 0.12, 0, 0.01, 0.06, 0.5, TRIM);                      // tailgate handle
  } },
  van: { len: 5.6, width: 2.0, r: 0.36, wheelIn: 0.95, clear: 0.3, sections: ((f) => [
    [-f, 0.99, 0.99, 1.10, 0.95, 2.02, "b"], [-f + 0.08, 1.0, 1.0, 1.10, 0.96, 2.07, "b"],
    [f - 1.55, 1.0, 1.0, 1.10, 0.96, 2.07, "g"], [f - 0.95, 1.0, 1.0, 1.10, 0.94, 1.97, "w"],
    [f - 0.36, 1.0, 1.0, 1.08, 0.92, 1.22, "b"], [f - 0.08, 0.99, 0.98, 1.03, 0.90, 1.11, "b"],
    [f, 0.95, 0.93, 0.98, 0.84, 1.03, "b"],
  ] as Section[])(F(5.6)), extra: (b, s) => {
    const f = s.len / 2;
    for (const z of [-1, 1]) { b.box(f - 1.6, 1.15, z * 1.004, 0.02, 1.7, 0.01, TRIM); b.box(0.3, 1.25, z * 1.004, 0.02, 1.5, 0.01, TRIM); b.box(-0.9, 1.9, z * 1.004, 2.2, 0.02, 0.01, TRIM); }
    b.box(-f - 0.004, 1.3, 0, 0.01, 1.4, 0.02, TRIM);                              // the rear doors' split
    for (const z of [-0.45, 0.45]) b.box(-f - 0.004, 1.65, z, 0.01, 0.5, 0.7, GLASS);   // rear door windows
  } },
};

// The upper body, lofted through `sec`, from the arch tops (y0) up, with end caps.
function loft(b: Batch, sec: Section[], y0: number, paint: number) {
  const ring = (s: Section): [number, number][] => {
    const [, wl, wb, yb, wt, yt] = s, wr = Math.max(0.05, wt - (yt - yb > 0.2 ? 0.07 : 0.14)), yr = yt + (yt - yb > 0.2 ? 0.015 : 0.03);
    return [[wl, y0], [wb, yb], [wt, yt], [wr, yr], [-wr, yr], [-wt, yt], [-wb, yb], [-wl, y0]];
  };
  const axisY = y0 + 0.15;
  for (let i = 0; i + 1 < sec.length; i++) {
    const a = ring(sec[i]), c = ring(sec[i + 1]), xa = sec[i][0], xc = sec[i + 1][0], seg = sec[i][6];
    for (let k = 0; k + 1 < a.length; k++) {
      // bands: 0 / 6 lower sides, 1 / 5 upper sides, 2 / 4 roof edges, 3 the top
      const band = Math.min(k, 6 - k);
      const color = band === 0 || band === 2 ? paint
        : band === 1 ? (seg === "g" || seg === "w" || seg === "r" ? GLASS : paint)
        : (seg === "w" || seg === "r" ? GLASS_TOP : paint);
      const p = a[k], q = a[k + 1], u = c[k], v = c[k + 1];
      const mz = (p[0] + q[0] + u[0] + v[0]) / 4, my = (p[1] + q[1] + u[1] + v[1]) / 4;
      const face: [number, number, number] = band === 3 ? [0, 1, 0] : [0, my - axisY, mz];
      b.tri(xa, p[1], p[0], xa, q[1], q[0], xc, v[1], v[0], color, face);
      b.tri(xa, p[1], p[0], xc, v[1], v[0], xc, u[1], u[0], color, face);
    }
  }
  // End caps: fans from the middle of each end's section.
  for (const [s, dir] of [[sec[0], -1], [sec[sec.length - 1], 1]] as const) {
    const r = ring(s), x = s[0], cy = (y0 + s[5]) / 2;
    for (let k = 0; k < r.length; k++) {
      const p = r[k], q = r[(k + 1) % r.length];
      b.tri(x, cy, 0, x, p[1], p[0], x, q[1], q[0], paint, [dir, 0, 0]);
    }
  }
}

// The lower body under the loft: cut away over open arches with the tyres in them, bumpers,
// grille, lamps and plates.
function lower(b: Batch, s: CarSpec, paint: number) {
  const L = s.len, W = s.width, f = L / 2, r = s.r, y0 = 2 * r + 0.02, yr = s.clear;
  const wf = f - s.wheelIn, wr = -f + s.wheelIn, arch = r + 0.07, hw = W / 2;
  const first = s.sections[0];
  const xr = first[0];   // where the loft starts (a pickup's at the cab)
  const piece = (x0: number, x1: number, w: number) => b.box((x0 + x1) / 2, (yr + y0) / 2, 0, x1 - x0, y0 - yr, w, paint);
  piece(wf + arch, f - 0.15, W); piece(f - 0.15, f, W - 0.12);
  piece(wr + arch, wf - arch, W);
  piece(-f + 0.15, wr - arch, W); piece(-f, -f + 0.15, W - 0.12);
  for (const x of [wf, wr]) for (const z of [-1, 1]) {
    b.box(x, y0 - 0.12, z * (hw - 0.25), arch * 2, 0.26, 0.4, WELL);                     // the well, in shadow
    b.cyl(x, r, z * (hw - 0.15), r, 0.2, TYRE, 12, Math.PI / 2);
    b.cyl(x, r, z * (hw - 0.045), r * 0.58, 0.02, CHROME, 10, Math.PI / 2);              // wheel
    b.cyl(x, r, z * (hw - 0.04), r * 0.2, 0.02, TRIM, 6, Math.PI / 2);                   // hub
  }
  for (const z of [-1, 1]) b.box(0, yr + 0.05, z * (hw + 0.004), wf - wr - 2 * arch, 0.1, 0.01, PLASTIC);   // sills
  // Front: bumper and air dam, grille between the headlamps, plate.
  b.box(f - 0.03, yr + 0.09, 0, 0.1, 0.18, W - 0.16, PLASTIC);
  b.box(f + 0.004, y0 - 0.07, 0, 0.01, 0.14, W * 0.4, TRIM);
  b.box(f + 0.006, yr + 0.3, 0, 0.01, 0.11, 0.42, PLATE);
  for (const z of [-1, 1]) headLamp(b, f + 0.006, y0 - 0.02, z * (hw - 0.27), 0.02, 0.13, 0.36);
  // Rear: bumper, plate, tail lamps wrapping round the corners.
  b.box(-f + 0.03, yr + 0.07, 0, 0.1, 0.14, W - 0.16, PLASTIC);
  b.box(-f - 0.006, yr + 0.3, 0, 0.01, 0.11, 0.42, PLATE);
  const ty = Math.min(xr > -f + 0.5 ? y0 + 0.2 : first[3] - 0.05, y0 + 0.25);
  for (const z of [-1, 1]) {
    tailLamp(b, -f - 0.006, ty, z * (hw - 0.22), 0.02, 0.15, 0.34);
    tailLamp(b, -f + 0.1, ty, z * (hw - 0.065), 0.12, 0.15, 0.02);
  }
  // Mirrors at the foot of the windscreen, and door shut lines.
  const ws = s.sections.find((q) => q[6] === "w")!;
  for (const z of [-1, 1]) {
    b.box(ws[0] + 0.12, ws[3] + 0.09, z * (ws[2] + 0.07), 0.12, 0.11, 0.14, paint);
    b.box(ws[0] + 0.04, (yr + 0.1 + ws[3]) / 2, z * (hw + 0.004), 0.02, ws[3] - yr - 0.12, 0.01, TRIM);
    for (const p of s.sections) if (p[6] === "p" && p !== first) b.box(p[0] + 0.05, (yr + 0.1 + p[3]) / 2, z * (hw + 0.004), 0.02, p[3] - yr - 0.12, 0.01, TRIM);
  }
}

// One car of `kind` at the origin into `b`. `lit`: lamps tagged for the night glow.
export function carModel(b: Batch, kind: CarKind, paint = 0xffffff, lit = true) {
  const s = CAR_SPECS[kind];
  LIT = lit;
  lower(b, s, paint);
  loft(b, s.sections, 2 * s.r + 0.02, paint);
  s.extra?.(b, s, paint);
  LIT = true;
}

// A car's geometry for an InstancedMesh, painted white for instanceColor.
export function carGeometry(kind: CarKind, material: THREE.Material): THREE.BufferGeometry {
  const b = new Batch(); carModel(b, kind);
  return b.build(material)!.geometry;
}

// A parked car (lamps unlit) baked into a static batch: `x, y, z` the middle of it on the ground,
// `yaw` its heading (its nose along +x turned by yaw, as Batch.box's rotY).
const parkedModels = new Map<CarKind, BatchModel>();
export function parkedCar(b: Batch, kind: CarKind, x: number, y: number, z: number, yaw: number, paint: number) {
  let m = parkedModels.get(kind);
  if (!m) {
    // (Built for real even in a dry run: a probe build can be the first to ask, and the model is kept.)
    const dry = BATCH.dry, t = new Batch();
    BATCH.dry = false; carModel(t, kind, 0xffffff, false); BATCH.dry = dry;
    m = t.take(); parkedModels.set(kind, m);
  }
  b.stamp(m, x, y, z, yaw, paint, false);
}

// A kind and a paint for a parked or passing car from a hash in [0, 1): mostly sedans and
// hatchbacks, then wagons and SUVs, a few pickups and vans. `big` false leaves out the long
// ones (pickups and vans), for bays sized for cars.
export function carKindAt(h: number, big = true): CarKind {
  const w: [CarKind, number][] = [["sedan", 5], ["hatch", 4], ["wagon", 2], ["suv", 3], ["pickup", big ? 1.5 : 0], ["van", big ? 1 : 0]];
  let t = h * w.reduce((a, [, x]) => a + x, 0);
  for (const [k, x] of w) { if (t < x) return k; t -= x; }
  return "sedan";
}
export const carPaintAt = (h: number) => CAR_PAINTS[Math.min(CAR_PAINTS.length - 1, Math.floor(h * CAR_PAINTS.length))];

// Cars drawn as InstancedMeshes, one per kind: begin() each frame, add() each car, end().
export class CarFleet {
  private meshes = new Map<CarKind, THREE.InstancedMesh>();
  private col = new THREE.Color();
  constructor(parent: THREE.Object3D, material: THREE.Material, cap: number, kinds: CarKind[] = CAR_KINDS) {
    for (const k of kinds) {
      const m = new THREE.InstancedMesh(carGeometry(k, material), material, cap);
      m.count = 0; m.frustumCulled = false;
      for (let i = 0; i < cap; i++) m.setColorAt(i, this.col.set(0xffffff));
      parent.add(m); this.meshes.set(k, m);
    }
  }
  begin() { for (const m of this.meshes.values()) m.count = 0; }
  add(kind: CarKind, matrix: THREE.Matrix4, paint: number) {
    const m = this.meshes.get(kind) ?? this.meshes.values().next().value!;
    if (m.count >= m.instanceMatrix.count) return;
    m.setMatrixAt(m.count, matrix); m.setColorAt(m.count, this.col.set(paint)); m.count++;
  }
  end() {
    for (const m of this.meshes.values()) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }
}
