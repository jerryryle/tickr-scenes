// Test scene: Long Day's car models (cars.ts) lined up on a lot, for judging them up close at the
// board's resolution. Each second the camera moves to the next car, round the line from the front
// three-quarter, then from the rear, then a wide shot, then round a parking garage (garage.ts)
// with its parked cars, then along the boat models (boats.ts) afloat, one a second, the cargo
// boats and an upturned rowboat ashore, and last the car ferry (countryworld.ts ferryModel) from
// either side and end-on. Build and render it with
//   make tool SCENE=long-day TOOL=showroom SECS=28   -> build/long-day-showroom/showroom.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { CAR_KINDS, carModel, parkedCar } from "../src/cars.ts";
import { buildGarage } from "../src/garage.ts";
import { boatAt, boatExtent, boatSize } from "../src/boats.ts";
import type { BoatKind } from "../src/boats.ts";
import { CARGO_MODELS } from "../src/cargomodels.ts";
import { ferryModel } from "../src/countryworld.ts";
import { WATER_DROP } from "../src/country.ts";
import { mulberry32 } from "../src/rng.ts";

const PAINTS = [0xb22222, 0x1f4fa0, 0xe8e8e8, 0x222428, 0xd4a017, 0x2e7d4f];
const GAP = 6.5;
// Round the garage: [dx, height, dz from its middle, height looked at, fov].
const BOATS: [BoatKind, number][] = [["cruiser", 0x1f3f6a], ["narrowboat", 0x2f5a3a], ["sailboat", 0x8a2a22], ["rowboat", 0x2a6fa8], ["canoe", 0xd35400], ["kayak", 0x27ae60], ["jetski", 0xf2c200]];
const FERRY_Z = 260, FERRY_VIEWS = [[30, 10, 24], [-27, 8, -24], [46, 6, 6]];
const BOAT_Z = 120, BOAT_STEP = 20;
const GARAGE_VIEWS = [[40, 30, 40, 0, 40], [-40, 30, 40, 0, 40], [22, 9, 4, 4.8, 44], [26, 2.0, -8, 1.2, 44]];

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera;
  const garage = new THREE.Group(), gc = new THREE.Vector3();   // the garage, off to the side, and its middle
  const n = CAR_KINDS.length, x0 = -(n - 1) * GAP / 2;
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(38, sys.width / sys.height, 0.5, 400);
      const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(40, 60, 50);
      scene.add(sun, new THREE.HemisphereLight(0xcfe6ff, 0x4a4030, 2.0));
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const b = new Batch(), lot = new Batch();
      CAR_KINDS.forEach((k, i) => {
        const x = x0 + i * GAP;
        carModel(b, k, PAINTS[i % PAINTS.length]);   // (built at the origin: moved below)
        const m = b.build(mat)!; m.position.x = x; scene.add(m);
        parkedCar(lot, k, x, 0, -6, Math.PI, PAINTS[(i + 3) % PAINTS.length]);   // a parked copy behind, facing the other way
      });
      lot.box(0, -0.05, 0, 80, 0.1, 40, 0x55585c);
      scene.add(lot.build(mat)!);
      const ground = new Batch(), solid = new Batch();
      buildGarage(ground, solid, 0, mulberry32(7), 7);
      for (const m of [ground.build(mat)!, solid.build(mat)!]) garage.add(m);
      garage.position.set(0, 0, -120); scene.add(garage);
      new THREE.Box3().setFromObject(garage).getCenter(gc);
      // The boats afloat on a pond, in a row along x; ashore past them, the cargo boats and an upturned rowboat.
      const water = new Batch(), boats = new Batch();
      water.box(60, -0.05, BOAT_Z, 220, 0.1, 40, 0x2f6f9a); water.box(60, -0.05, BOAT_Z - 26, 220, 0.4, 12, 0x8f8a7e);
      BOATS.forEach(([k, paint], i) => boatAt(boats, k, i * BOAT_STEP, 0, BOAT_Z, 0, paint));
      let x = BOATS.length * BOAT_STEP;
      for (const [id, v] of [["sailboat", 0], ["canoes", 0], ["canoes", 2], ["jetSki", 0]] as [string, number][]) { CARGO_MODELS[id].build(boats, x, 0.15, BOAT_Z - 26, v); x += 7; }
      boatAt(boats, "rowboat", x, 0.15 - boatExtent("rowboat", { upturned: true }).lo, BOAT_Z - 26, 0, 0x2d5f9a, { upturned: true });
      for (const m of [water.build(mat)!, boats.build(mat)!]) scene.add(m);
      // The ferry, its deck WATER_DROP over the water, on a pond of its own further out.
      const fw = new Batch(), fb = new Batch(), fu = new Batch(), fg = new Batch();
      fw.box(0, -0.05, FERRY_Z, 160, 0.1, 80, 0x2f6f9a); scene.add(fw.build(mat)!);
      ferryModel(fb, fu, fg);
      for (const m of [fb.build(mat)!, fu.build(mat)!, fg.build(mat)!]) { m.position.set(0, WATER_DROP, FERRY_Z); scene.add(m); }
    },
    render(ctx, f) {
      const k = Math.floor(f.t) % (2 * n + 1 + GARAGE_VIEWS.length + BOATS.length + 1 + FERRY_VIEWS.length);
      if (k >= 2 * n + 1 + GARAGE_VIEWS.length + BOATS.length + 1) {
        const [dx, y, dz] = FERRY_VIEWS[k - (2 * n + 1 + GARAGE_VIEWS.length + BOATS.length + 1)];
        cam.position.set(dx, y, FERRY_Z + dz); cam.lookAt(0, 4, FERRY_Z); cam.fov = 44;
      } else if (k >= 2 * n + 1 + GARAGE_VIEWS.length) {
        const j = k - 2 * n - 1 - GARAGE_VIEWS.length;
        if (j < BOATS.length) { const L = boatSize(BOATS[j][0]).len, x = j * BOAT_STEP; cam.position.set(x + L * 0.55, L * 0.32 + 1.2, BOAT_Z + L * 0.75 + 2); cam.lookAt(x, BOATS[j][0] === "sailboat" ? 2.6 : 0.6, BOAT_Z); }
        else { const x = BOATS.length * BOAT_STEP + 14; cam.position.set(x + 2, 4.5, BOAT_Z - 16); cam.lookAt(x, 0.6, BOAT_Z - 26); }
        cam.fov = j < BOATS.length ? 40 : 75;
      } else if (k > 2 * n) { const [dx, y, dz, ly, fov] = GARAGE_VIEWS[k - 2 * n - 1]; cam.position.set(gc.x + dx, y, gc.z + dz); cam.lookAt(gc.x, ly, gc.z); cam.fov = fov; }
      else if (k === 2 * n) { cam.position.set(0, 14, 26); cam.lookAt(0, 0, -3); cam.fov = 34; }
      else {
        const i = k % n, side = k < n ? 1 : -1, x = x0 + i * GAP;
        cam.position.set(x + 4.6 * side, 2.4, 5.4); cam.lookAt(x, 0.75, 0); cam.fov = 38;
      }
      cam.updateProjectionMatrix();
      r.setClearColor(0x0b4fc4); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
