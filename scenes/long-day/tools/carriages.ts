// This test scene shows the trucks' Victorian carriages (truck.ts carriage, carriage.ts) side by side, with
// each model at none, half and all of it, broadside and then the whole carriage close. The liveries
// are plain white because the tool has no assets. Build and render it with
//   make tool SCENE=long-day TOOL=carriages SECS=10   -> build/long-day-toons/carriages.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { LIVERY_ASSETS, Truck, TruckKit } from "../src/truck.ts";
import type { LiveryName, TruckModel } from "../src/truck.ts";

const MODELS: TruckModel[] = ["box16", "box26", "reefer", "flatbed", "tractor"];
const LEVELS = [0, 0.5, 1], GAP = 16;
const gapOf = (i: number) => MODELS[i] === "tractor" ? 26 : GAP;   // (a tractor's trailer is long)

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera;
  const rows: Truck[][] = [];
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); scene.background = new THREE.Color(0x8ac8f0);
      cam = new THREE.PerspectiveCamera(30, sys.width / sys.height, 0.5, 400);
      const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(40, 60, 50);
      scene.add(sun, new THREE.HemisphereLight(0xcfe6ff, 0x4a4030, 2.0));
      const lot = new Batch(); lot.box(0, -0.05, 100, 600, 0.1, 600, 0x6a6d72);
      scene.add(lot.build(new THREE.MeshLambertMaterial({ vertexColors: true }))!);
    },
    render(ctx, f) {
      try { draw(f.t); ctx.drawImage(r.domElement as any, 0, 0); } catch (e: any) { sys.log("carriages: " + (e?.stack ?? e)); }
    },
  };
  function draw(time: number) {
    {
      if (!rows.length) {
        // (The plain white liveries are put in after, because the 2D canvas isn't to be touched.)
        const kit = new TruckKit({} as Record<LiveryName, CanvasImageSource>);
        const white = new THREE.DataTexture(new Uint8Array([244, 244, 240, 255]), 1, 1); white.needsUpdate = true;
        for (const n of LIVERY_ASSETS) kit.livery[n].map = white;
        MODELS.forEach((m, i) => rows.push(LEVELS.map((k, j) => {
          const t = new Truck(kit, m); t.carriage = k; t.setPose(j * gapOf(i), i * 60, 0); t.update(0); scene.add(t.root); return t;
        })));
      }
      // (Each model: side on, all, half and none of it left to right as seen from the street; then
      // the whole carriage close from its front quarter on the street side, and from above on the
      // kerb side, into its seat.)
      const k = Math.floor(time) % (MODELS.length * 3), i = Math.floor(k / 3), view = k % 3, z = i * 60;
      const G = gapOf(i), tr = MODELS[i] === "tractor" ? -6 : 0, X = 2 * G;   // (a tractor's trailer runs far back)
      if (view === 0) { cam.fov = 42; cam.position.set(1.5 * G + 2 + tr, 2.4, z - 26 - (G - GAP)); cam.lookAt(1.5 * G + 2 + tr, 2, z); }
      else if (view === 1) { cam.fov = 30; cam.position.set(X + 15, 3.2, z - 9); cam.lookAt(X + 5, 1.8, z); }
      else { cam.fov = 40; cam.position.set(X + 6.5, 1.6, z - 5.5); cam.lookAt(X + 6, 1.1, z); }
      cam.updateProjectionMatrix();
      r.render(scene, cam);
    }
  }
}
