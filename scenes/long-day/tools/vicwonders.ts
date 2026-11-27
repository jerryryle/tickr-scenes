// This test scene shows the Victorian city's goods (cargo.ts VIC_CARGO; cargomodels.ts). It shows
// each in up to four variants in a row, close, one a second, and then all together. Build and
// render it with
//   make tool SCENE=long-day TOOL=vicwonders SECS=19   -> build/long-day-vicwonders/vicwonders.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { CARGO_MODELS } from "../src/cargomodels.ts";
import { VIC_CARGO } from "../src/cargo.ts";

const IDS = [...VIC_CARGO], ROW = 3;
// (Each row's variants side by side, as far apart as the model is long.)
const gap = (id: string) => CARGO_MODELS[id].size[0] + 0.35;
export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera;
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(30, sys.width / sys.height, 0.1, 200);
      const sun = new THREE.DirectionalLight(0xfff0d8, 2.2); sun.position.set(-3, 6, 5);
      scene.add(sun, new THREE.HemisphereLight(0xc8d4e0, 0x5a5048, 2.0));
      const b = new Batch();
      b.box(0, -0.05, IDS.length * ROW / 2, 40, 0.1, IDS.length * ROW + 10, 0x8f8a80);
      IDS.forEach((id, k) => { for (let v = 0; v < 4; v++) CARGO_MODELS[id].build(b, (v - 1.5) * gap(id), 0, k * ROW, v); });
      scene.add(b.build(new THREE.MeshLambertMaterial({ vertexColors: true }))!);
    },
    render(ctx, f) {
      const k = Math.floor(f.t) % (IDS.length + 1);
      if (k < IDS.length) {
        const [, h] = CARGO_MODELS[IDS[k]].size, d = Math.max(1.6, gap(IDS[k]) * 1.25, h * 1.6);
        cam.position.set(d * 0.35, h * 0.5 + d * 0.55, k * ROW - d * 1.6); cam.lookAt(0, h * 0.45, k * ROW);
      } else { cam.position.set(16, 12, -8); cam.lookAt(0, 0.3, IDS.length * ROW / 2 - 2); }
      r.setClearColor(0x7a94b0); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
