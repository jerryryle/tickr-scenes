// Test scene: Long Day's car models (cars.ts) lined up on a lot, for judging them up close at the
// board's resolution. Each second the camera moves to the next car, round the line from the front
// three-quarter, then from the rear, then a wide shot, then round a parking garage (garage.ts)
// with its parked cars. Build and render it with
//   make tool SCENE=long-day TOOL=showroom SECS=17   -> build/long-day-showroom/showroom.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { CAR_KINDS, carModel, parkedCar } from "../src/cars.ts";
import { buildGarage } from "../src/garage.ts";
import { mulberry32 } from "../src/rng.ts";

const PAINTS = [0xb22222, 0x1f4fa0, 0xe8e8e8, 0x222428, 0xd4a017, 0x2e7d4f];
const GAP = 6.5;
// Round the garage: [dx, height, dz from its middle, height looked at, fov].
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
    },
    render(ctx, f) {
      const k = Math.floor(f.t) % (2 * n + 1 + GARAGE_VIEWS.length);
      if (k > 2 * n) { const [dx, y, dz, ly, fov] = GARAGE_VIEWS[k - 2 * n - 1]; cam.position.set(gc.x + dx, y, gc.z + dz); cam.lookAt(gc.x, ly, gc.z); cam.fov = fov; }
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
