// This test scene shows the storybook city's goods (cargo.ts STORY_CARGO; cargomodels.ts). It
// shows each in four variants in a row, close, one a second, and then all together. Build and
// render it with
//   make tool SCENE=long-day TOOL=wonders SECS=27   -> build/long-day-wonders/wonders.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { CARGO_MODELS } from "../src/cargomodels.ts";
import { STORY_CARGO } from "../src/cargo.ts";

const IDS = [...STORY_CARGO];
export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera;
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(30, sys.width / sys.height, 0.1, 200);
      const sun = new THREE.DirectionalLight(0xfff4e0, 2.2); sun.position.set(-3, 6, 5);
      scene.add(sun, new THREE.HemisphereLight(0xd8f4ff, 0x6a5a70, 2.1));
      const b = new Batch();
      b.box(0, -0.05, IDS.length * 1.25, 40, 0.1, IDS.length * 2.5 + 20, 0xffd9e0);
      IDS.forEach((id, k) => { const L = Math.max(1.1, CARGO_MODELS[id].size[0] + 0.3); for (let v = 0; v < 4; v++) CARGO_MODELS[id].build(b, (v - 1.5) * L, 0, k * 2.5, v); });
      scene.add(b.build(new THREE.MeshLambertMaterial({ vertexColors: true }))!);
    },
    render(ctx, f) {
      const k = Math.floor(f.t) % (IDS.length + 1);
      if (k < IDS.length) { const L = Math.max(1.1, CARGO_MODELS[IDS[k]].size[0] + 0.3) / 1.1; cam.position.set(1.2 * L, 1.5 * L, k * 2.5 - 3.6 * L); cam.lookAt(0, 0.35, k * 2.5); }
      else { cam.position.set(16, 14, -8); cam.lookAt(0, 0.3, IDS.length * 1.25); }
      r.setClearColor(0x8ad8f0); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
