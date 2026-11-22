// Test scene: Long Day's wind turbine (countryworld.ts turbineTower, turbineRotor) on a field,
// a row of three facing the camera's side, their rotors turning at 15 rpm. The camera holds each
// view for two seconds: from the road at the distance the country drive puts them, closer, from
// the side, close on the nacelle and hub, and from behind. Build and render it with
//   make tool SCENE=long-day TOOL=turbines SECS=10   -> build/long-day-turbines/turbines.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { turbineRotor, turbineRotorAt, turbineTower } from "../src/countryworld.ts";

const GAP = 160, YAW = -Math.PI / 2 + 0.3;  // the rotors facing +z (the camera's side), turned a little
// [camera x, y, z, look x, y, z, fov] for each view.
const VIEWS = [
  [-60, 2.5, 110, 0, 28, 0, 46], [30, 2.5, 60, 0, 32, 0, 50], [70, 20, -10, 0, 34, 0, 50],
  [12, 44, 14, 0, 41, 0, 50], [-30, 20, -70, 0, 34, 0, 50],
];

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera;
  const rotors: THREE.Mesh[] = [];
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(46, sys.width / sys.height, 0.5, 900);
      scene.fog = new THREE.Fog(0x9cc4e8, 150, 700);
      const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(40, 60, 50);
      scene.add(sun, new THREE.HemisphereLight(0xcfe6ff, 0x4a4030, 2.0));
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const land = new Batch(); land.box(0, -0.05, 0, 1400, 0.1, 1400, 0xb0b25c);
      scene.add(land.build(mat)!);
      for (const x of [0, -GAP, GAP]) {
        const t = new Batch(); turbineTower(t); const m = t.build(mat)!; m.position.x = x; m.rotation.y = YAW; scene.add(m);
        const rb = new Batch(); turbineRotor(rb);
        const pivot = new THREE.Group(), rotor = rb.build(mat)!;
        turbineRotorAt(pivot, x, 0, 0, YAW); pivot.add(rotor); scene.add(pivot); rotors.push(rotor);
      }
    },
    render(ctx, f) {
      rotors.forEach((m, i) => (m.rotation.y = -(i * 1.3 + f.t * 15 * Math.PI / 30)));
      const [x, y, z, lx, ly, lz, fov] = VIEWS[Math.floor(f.t / 2) % VIEWS.length];
      cam.position.set(x, y, z); cam.lookAt(lx, ly, lz); cam.fov = fov; cam.updateProjectionMatrix();
      r.setClearColor(0x9cc4e8); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
