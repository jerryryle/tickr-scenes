// Test scene: Long Day's horn (truck.ts honk) on a tractor and a box truck standing in a street,
// sounding the whole time. Each second the camera moves on: through a blast at four moments from
// the jam shot (director.ts JAM_AHEAD, JAM_SIDE, JAM_UP: out ahead of the cab, to its left, up
// over the street), then front three-quarter, from the side, low, and from a rear quarter (the
// backup shot, honking while it backs into a bay). Build and render it with
//   make tool SCENE=long-day TOOL=horn SECS=16   -> build/long-day-horn/horn.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { LIVERY_ASSETS, SPECS, Truck, TruckKit } from "../src/truck.ts";
import type { LiveryName, TruckModel } from "../src/truck.ts";
import { captureCanvasClass, makeCanvas } from "../src/canvas.ts";

const MODELS: TruckModel[] = ["tractor", "box26"];
const BLASTS = [0.02, 0.12, 0.3, 0.55];   // (seconds into a blast)
// [ahead of the nose, to the right, height, fov]
const VIEWS = [[18, -5, 6, 40], [18, -5, 6, 40], [18, -5, 6, 40], [18, -5, 6, 40], [6, 5, 2.2, 44], [2, 9, 2, 44], [10, -3, 2.0, 30], [-26, 6, 3, 40]];

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera;
  const trucks: Truck[] = [];
  // (The trucks, on the first frame: a canvas for their livery only then (canvas.ts).)
  const build = (ctx: CanvasRenderingContext2D) => {
    captureCanvasClass(ctx);
    const c = makeCanvas(8, 8); c.g.fillStyle = "#e8e8e8"; c.g.fillRect(0, 0, 8, 8);
    const kit = new TruckKit(Object.fromEntries(LIVERY_ASSETS.map((n) => [n, c.canvas])) as Record<LiveryName, CanvasImageSource>);
    MODELS.forEach((m, i) => { const t = new Truck(kit, m); t.root.position.set(-SPECS[m].noseFront, 0, -2 + i * 60); scene.add(t.root); trucks.push(t); });
  };
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(40, sys.width / sys.height, 0.3, 400);
      const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(40, 60, 50);
      scene.add(sun, new THREE.HemisphereLight(0x8090b0, 0x302820, 1.2));
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const st = new Batch(); st.box(0, -0.05, 0, 200, 0.1, 200, 0x2a2c30);
      for (let x = -60; x < 60; x += 6) st.box(x, 0.01, 0, 3, 0.02, 0.15, 0xd8b020);
      st.box(0, 0.1, 9, 200, 0.2, 4, 0x6a6a6a); st.box(0, 6, 14, 200, 12, 6, 0x3a3f58);
      scene.add(st.build(mat)!);
    },
    render(ctx, f) {
      if (!trucks.length) build(ctx);
      const k = Math.floor(f.t), ti = Math.floor(k / VIEWS.length) % MODELS.length, v = k % VIEWS.length;
      const t = trucks[ti], [ahead, right, y, fov] = VIEWS[v], z0 = t.root.position.z;
      t.update(0, 0); t.honk(BLASTS[v % 4]);
      cam.position.set(ahead, y, z0 + right); cam.lookAt(-1, 1.8, z0); cam.fov = fov; cam.updateProjectionMatrix();
      r.setClearColor(0x101828); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
