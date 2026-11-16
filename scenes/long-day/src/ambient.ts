// Ambient motion overhead: the elevated train in a metro city, and a blimp drifting over every
// city with an ad on its side (it is always Frog Week next week).
import * as THREE from "three@0.187.0";
import { Batch, quadGeometry } from "./geom.ts";
import type { Quad } from "./geom.ts";
import { ELEVATED_REACH, elevatedLine } from "./decor.ts";
import { elevatedTrackY } from "./elevated.ts";
import { CITY_HI, CITY_LO, CityPlan } from "./city.ts";
import { BLOCK } from "./grid.ts";
import { signAtlas } from "./signs.ts";
import { SIM_DT } from "./journey.ts";
import { GLASS } from "./traffic.ts";

const TRAINS = 4, EL_CARS = 4, EL_CAR_PITCH = 14.4;
export class Ambient {
  private trains: THREE.Mesh[][] = [];
  readonly trainX: number[] = [];        // where each train's middle is (test renders follow one)   // each train's cars, placed one by one so they follow the ramps
  private blimp: THREE.Group;
  private blimpX = NaN; private blimpZ = 0; private blimpPX = NaN;   // stepped with the journey (StreetLife)

  constructor(scene: THREE.Scene, material: THREE.Material) {
    const b = new Batch();
    const cars = Array.from({ length: EL_CARS }, (_, i) => { elevatedCar(b, i); return b.build(material)!.geometry; });
    for (let k = 0; k < TRAINS; k++) {
      const train = cars.map((g) => { const m = new THREE.Mesh(g, material); m.visible = false; scene.add(m); return m; });
      this.trains.push(train);
    }
    // Blimp: a silver envelope, fins, a gondola, and the ad on both sides.
    const k = new Batch();
    k.ico(0, 0, 0, 1, 0xd8dadc); k.ico(0, -0.05, 0, 0.98, 0xc8ccd0);
    for (const [y, z] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9]]) k.box(-0.85, y * 0.55, z * 0.55, 0.3, y ? 0.5 : 0.04, z ? 0.5 : 0.04, 0xce1126);
    k.box(0.1, -0.95, 0, 0.32, 0.12, 0.12, 0x2a2c30);
    const env = k.build(material)!; env.scale.set(15, 4.6, 4.6);
    this.blimp = new THREE.Group(); this.blimp.add(env);
    const uv = signAtlas.adUV(4);
    const quads: Quad[] = [{ x: 0, y: 0, z: 4.62, w: 14, h: 5.2, ...uv }, { x: 0, y: 0, z: -4.62, w: 14, h: 5.2, rotY: Math.PI, ...uv }];
    this.blimp.add(new THREE.Mesh(quadGeometry(quads), signAtlas.material));
    this.blimp.visible = false; scene.add(this.blimp);
  }

  // The blimp's drift, one journey step at a time: it drifts east high overhead and reappears
  // upwind once it is well past.
  resetBlimp() { this.blimpX = this.blimpPX = NaN; }
  stepBlimp(focus: { x: number; z: number }, simTime: number) {
    this.blimpPX = this.blimpX;
    if (Number.isNaN(this.blimpX) || this.blimpX - focus.x > 260) { this.blimpX = this.blimpPX = focus.x - 240; this.blimpZ = focus.z + 60 + (Math.sin(simTime) * 40); }
    this.blimpX += SIM_DT * 4.5;
  }
  saveBlimp() { return Number.isNaN(this.blimpX) ? null : [this.blimpX, this.blimpZ, this.blimpPX]; }
  loadBlimp(o: number[] | null) { if (o) [this.blimpX, this.blimpZ, this.blimpPX] = o; else this.resetBlimp(); }

  // `time` is journey time, so the trains are where they would be after a scrub too.
  update(time: number, alpha: number, plan: CityPlan, focus: THREE.Vector3, active: boolean) {
    this.blimp.visible = active && !Number.isNaN(this.blimpX);
    // Elevated trains on the line nearest the focus: TRAINS of them, evenly spaced round a loop
    // out along one track to the far end of the line (ElevatedReach, well out of sight) and back
    // along the other, so one comes through every few minutes each way.
    let cz = Math.round((focus.z / BLOCK - 1) / 4) * 4 + 1;
    while (cz > CITY_HI) cz -= 4;
    while (cz < CITY_LO) cz += 4;
    let line = elevatedLine(plan.style, cz) ? cz : NaN;
    if (Number.isNaN(line)) for (const d of [4, -4, 8, -8]) if (elevatedLine(plan.style, cz + d)) { line = cz + d; break; }
    const z = line * BLOCK + 9, shown = !Number.isNaN(line) && Math.abs(z - focus.z) < 220;
    const lo = CITY_LO * BLOCK - ELEVATED_REACH + 80, hi = (CITY_HI + 1) * BLOCK + ELEVATED_REACH - 80, len = hi - lo;
    const half = len / 14, lap = 2 * half;
    for (let k = 0; k < this.trains.length; k++) {
      const t = (((time + (k * lap) / this.trains.length) % lap) + lap) % lap, east = t < half, u = (east ? t : t - half) / half;
      const dir = east ? 1 : -1, x = east ? lo + len * u : hi - len * u;
      this.trainX[k] = x;
      this.trains[k].forEach((car, i) => {
        car.visible = shown;
        if (!shown) return;
        // Each car on the track where it is (out of town the line ramps down to the ground and
        // back up over roads), pitched to its slope, facing the way the train runs.
        const cx = x + dir * (i - (EL_CARS - 1) / 2) * EL_CAR_PITCH, cy = elevatedTrackY(line, cx);
        const slope = (elevatedTrackY(line, cx + 3) - elevatedTrackY(line, cx - 3)) / 6;
        car.position.set(cx, cy + 0.05, z + dir * 2.0);
        car.rotation.set(0, east ? 0 : Math.PI, Math.atan(slope * dir));
      });
    }
    if (!active) return;
    this.blimp.position.set(this.blimpPX + (this.blimpX - this.blimpPX) * alpha, 62, this.blimpZ);
    this.blimp.rotation.set(0, 0, 0.04 * Math.sin(time * 0.4));
  }
}

// Car i of a four-car metro train running along +x, 14 m long, its origin at the middle of its
// floor-level base: stainless bodies with a window band, three doors a side, a red stripe, bogies
// underneath, a gangway towards the next car and a cab on the first (-x) and last (+x).
function elevatedCar(b: Batch, i: number) {
  const L = 14, W = 2.8, STEEL = 0xc8ccd2, DARK = 0x2a2d33, DOOR = 0x9aa2aa;
  {
    const x = 0;
    b.box(x, 1.7, 0, L, 2.6, W, STEEL);                                   // body
    b.box(x, 3.08, 0, L - 0.3, 0.2, W - 0.4, STEEL); b.box(x, 3.22, 0, L - 0.8, 0.1, W - 1.0, 0xa8adb4);   // rounded roof
    b.box(x, 2.25, 0, L - 0.8, 0.85, W + 0.02, GLASS);                   // window band
    for (let k = -3; k <= 3; k++) b.box(x + k * 1.9, 2.25, 0, 0.16, 0.87, W + 0.04, STEEL);
    b.box(x, 1.15, 0, L + 0.01, 0.22, W + 0.03, 0xce1126);                // stripe
    for (let k = 0; k < 7; k++) b.box(x, 0.6 + k * 0.07, 0, L + 0.02, 0.02, W + 0.035, 0xb4b9c0);   // fluting (1 cm proud of the ends: near-shared planes flicker)
    for (const dx of [-4.6, 0, 4.6]) for (const z of [-1, 1]) {           // doors
      b.box(x + dx, 1.75, z * (W / 2 + 0.01), 1.5, 2.3, 0.03, DOOR);
      b.box(x + dx, 2.15, z * (W / 2 + 0.025), 1.2, 0.8, 0.02, GLASS);
      b.box(x + dx, 1.75, z * (W / 2 + 0.03), 0.04, 2.25, 0.02, DARK);
    }
    for (const dx of [-4.8, 4.8]) {                                       // bogies
      b.box(x + dx, 0.45, 0, 2.6, 0.5, W - 0.5, DARK);
      for (const ax of [-0.8, 0.8]) for (const z of [-1, 1]) b.cyl(x + dx + ax, 0.35, z * (W / 2 - 0.4), 0.35, 0.12, 0x161616, 10, Math.PI / 2);
    }
    if (i < 3) b.box(x + 7.1, 1.8, 0, 0.3, 2.3, 1.6, DARK);              // gangway to the next car
    if (i === 0 || i === 3) {                                             // cab end
      const e = i === 0 ? -1 : 1, ex = x + e * (L / 2 + 0.05);
      b.box(ex, 1.7, 0, 0.12, 2.56, W - 0.1, 0xb4b9c0);   // (inside the body's top and bottom)
      b.box(ex + e * 0.02, 2.3, 0, 0.1, 0.8, W - 0.5, GLASS);
      b.box(ex + e * 0.03, 3.0, 0, 0.06, 0.2, 1.2, 0x101010); b.box(ex + e * 0.055, 3.0, 0, 0.02, 0.12, 0.9, 0xffb000);   // route sign (its face proud of the board's)
      for (const z of [-0.95, 0.95]) b.box(ex + e * 0.045, 1.0, z, 0.04, 0.16, 0.3, e > 0 ? 0xfff4d0 : 0xc01818);   // lamps, proud of the cab end
    }
  }
}
