// Test scene: the horse (src/horse.ts) close, standing, walking, trotting, trotting on and galloping
// on the spot, side on and from a front quarter. Build and render it with
//   make tool SCENE=long-day TOOL=horses SECS=8   -> build/long-day-horses/horses.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { HORSE_COATS, HORSE_PARTS, horseParts, poseHorse } from "../src/horse.ts";

const SPEEDS = [0, 1.5, 3.5, 8, 18];

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera;
  const meshes: THREE.InstancedMesh[] = [];
  const mats = Array.from({ length: HORSE_PARTS }, () => new THREE.Matrix4());
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); scene.background = new THREE.Color(0x8ac8f0);
      cam = new THREE.PerspectiveCamera(30, sys.width / sys.height, 0.2, 200);
      const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(20, 40, 30);
      scene.add(sun, new THREE.HemisphereLight(0xcfe6ff, 0x4a4030, 2.0));
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const g = new Batch(); g.box(0, -0.05, 0, 200, 0.1, 200, 0x6a6d72); scene.add(g.build(mat)!);
      const parts = horseParts(HORSE_COATS[0]);
      for (const p of parts) { const b = new Batch(); p(b); const m = new THREE.InstancedMesh(b.build(mat)!.geometry, mat, SPEEDS.length); m.frustumCulled = false; scene.add(m); meshes.push(m); }
    },
    render(ctx, f) {
      try {
        const t = f.t, base = new THREE.Matrix4();
        SPEEDS.forEach((v, k) => {
          base.makeTranslation(k * 3.4, 0, 0);
          poseHorse({ odo: v * t, v, t, seed: k * 0.37 + 0.1 }, base, mats, 0);
          for (let j = 0; j < HORSE_PARTS; j++) meshes[j].setMatrixAt(k, mats[j]);
        });
        for (const m of meshes) m.instanceMatrix.needsUpdate = true;
        const v = Math.floor(t / 2) % 4;
        if (v === 0) { cam.position.set(6.8, 1.2, -17); cam.lookAt(6.8, 1.0, 0); cam.fov = 34; }
        else if (v === 1) { cam.position.set(0, 1.3, -3.2); cam.lookAt(-0.2, 1.2, 0); cam.fov = 40; }
        else if (v === 2) { cam.position.set(2.4, 1.9, -2.4); cam.lookAt(0.2, 1.3, 0); cam.fov = 40; }
        else { cam.position.set(6.8, 1.3, -3.2); cam.lookAt(6.6, 1.0, 0); cam.fov = 40; }
        cam.updateProjectionMatrix();
        r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
      } catch (e: any) { sys.log("horses: " + (e?.stack ?? e)); }
    },
  };
}
