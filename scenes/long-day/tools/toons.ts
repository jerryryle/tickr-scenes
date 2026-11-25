// Test scene: the trucks' storybook cartoon look (truck.ts toonWarp) side by side, each model at
// none, half and all of it, broadside and then the whole cartoon close (plain white liveries:
// the tool has no assets). Build and render it with
//   make tool SCENE=long-day TOOL=toons SECS=10   -> build/long-day-toons/toons.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { LIVERY_ASSETS, Truck, TruckKit } from "../src/truck.ts";
import type { LiveryName, TruckModel } from "../src/truck.ts";

const MODELS: TruckModel[] = ["box16", "box26", "reefer", "flatbed", "tractor"];
const LEVELS = [0, 0.5, 1], GAP = 16;

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
      try { draw(f.t); ctx.drawImage(r.domElement as any, 0, 0); } catch (e: any) { sys.log("toons: " + (e?.stack ?? e)); }
    },
  };
  function draw(time: number) {
    {
      if (!rows.length) {
        // (Plain white liveries, put in after: the 2D canvas isn't to be touched.)
        const kit = new TruckKit({} as Record<LiveryName, CanvasImageSource>);
        const white = new THREE.DataTexture(new Uint8Array([244, 244, 240, 255]), 1, 1); white.needsUpdate = true;
        for (const n of LIVERY_ASSETS) kit.livery[n].map = white;
        kit.liveryRearDS.map = white;
        MODELS.forEach((m, i) => rows.push(LEVELS.map((k, j) => {
          const t = new Truck(kit, m); t.toon = k; t.setPose(j * GAP, i * 60, 0); t.update(0); scene.add(t.root); return t;
        })));
      }
      const k = Math.floor(time) % (MODELS.length * 2), i = Math.floor(k / 2), rear = k % 2 === 1, z = i * 60;
      // (Broadside, all, half and none of it left to right; then the whole cartoon close, from its
      // front three-quarter.)
      const tr = i === MODELS.length - 1 ? -6 : 0;   // (a tractor's trailer runs far back)
      if (!rear) { cam.fov = 40; cam.position.set(GAP + 2 + tr, 5, z - 30); cam.lookAt(GAP + 2 + tr, 1.6, z); }
      else { cam.fov = 34; cam.position.set(2 * GAP + 14, 4.5, z - 12); cam.lookAt(2 * GAP + 1, 1.8, z); }
      cam.updateProjectionMatrix();
      r.render(scene, cam);
    }
  }
}
