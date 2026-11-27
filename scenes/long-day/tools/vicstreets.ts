// Test scene: the Victorian city's street pieces (victorian-street.ts) close up, for judging them at
// the board's resolution: the gas lamp by day and by night, the Westminster signal showing stop,
// caution and go, a constable on point duty in two of his poses, each piece of street furniture,
// and the finger post of the road in (its arm unlettered here). They stand along a kerb of York stone on granite setts, with a box
// truck's height (a 3.6 m post) at the end of the row for scale. It shows one view a second.
// Build and render it with
//   make tool SCENE=long-day TOOL=vicstreets SECS=18   -> build/long-day-vicstreets/vicstreets.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { makeLampMaterial, setSignalTime } from "../src/signals.ts";
import { vicBench, vicBollard, vicCabShelter, vicDustBin, vicConstable, vicFingerPost, vicHitchPost, vicLamp, vicNewsStand, vicPillarBox, vicSignal, vicStreetPump, vicTrough } from "../src/city-victorian/victorian-street.ts";
import type { VicPiece } from "../src/city-victorian/victorian-street.ts";
import { VIC_STREET } from "../src/city-victorian/victorian-buildings-town.ts";

const CURB = 0.15;
// Where each piece stands along the kerb (x), the kerb at z = 0, the pavement at z > 0.
const PIECES: [string, VicPiece, number][] = [
  ["pump", vicStreetPump, 0], ["bin", vicDustBin, 4], ["bench", vicBench, 8], ["pillar", vicPillarBox, 12],
  ["news", vicNewsStand, 16], ["hitch", vicHitchPost, 20], ["shelter", vicCabShelter, 25], ["trough", vicTrough, 31], ["bollard", vicBollard, 35],
];
const LAMP_X = -6, SIG_X = [40, 46, 52], BOBBY_X = 58, FINGER_X = 66;

// Night: what aux.z -5 (gas lantern glass) glows by, as the city's facade material does.
const NIGHT = { value: 0 };
function glowMaterial() {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = NIGHT;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute vec3 aAux;\nvarying float vTag;").replace("#include <begin_vertex>", "#include <begin_vertex>\nvTag = aAux.z;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vTag;\nuniform float uNight;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\n  if (vTag < -4.5) totalEmissiveRadiance += uNight * vec3(1.0, 0.66, 0.2) * 1.05;");
  };
  return mat;
}

// [camera x, y, z, look x, y, z, fov, night]
type View = [number, number, number, number, number, number, number, number];
const VIEWS: View[] = [
  [14, 4.5, -16, 14, 1.0, 1.5, 50, 0],
  [LAMP_X + 3, 2.6, -5, LAMP_X, 2.8, 0.8, 50, 0],
  [LAMP_X + 4, 2.2, -7, LAMP_X, 2.6, 0.8, 50, 1],
  [46, 3.5, -14, 46, 3.6, 0.6, 46, 0],
  [46, 3.5, -14, 46, 3.6, 0.6, 46, 1],
  [SIG_X[0] - 4, 4.8, -3.5, SIG_X[0], 4.6, 0.8, 50, 0],
  [BOBBY_X + 1.5, 1.6, -7.5, BOBBY_X + 1.5, 1.2, -3, 44, 0],
  ...PIECES.map(([, , x]): View => [x - 2.4, 1.8, -2.6, x, 0.7, 0.8, 44, 0]),
  [FINGER_X - 6, 2.2, -7, FINGER_X, 2.8, 0.8, 44, 0],
  [14, 4.5, -16, 14, 1.0, 1.5, 50, 1],
];

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, sun: THREE.DirectionalLight, sky: THREE.HemisphereLight;
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(46, sys.width / sys.height, 0.2, 400);
      sun = new THREE.DirectionalLight(0xfff4e0, 2.3); sun.position.set(-30, 50, -40);
      sky = new THREE.HemisphereLight(0xcfe0f0, 0x5a5048, 1.9);
      scene.add(sun, sky);
      const mat = glowMaterial(), lampMat = makeLampMaterial();
      const g = new Batch(), s = new Batch(), lamps = new Batch();
      // The road of setts in courses, the pavement of flags, the granite kerb.
      g.box(30, -0.05, -6, 120, 0.1, 12, VIC_STREET.asphalt);
      for (let x = -30, k = 0; x < 90; x += 0.45, k++) if ((k * 7) % 3 !== 0) g.box(x, 0.004, -6, 0.42, 0.01, 12, (k * 5) % 3 ? 0x625d56 : 0x56524c);
      g.box(30, CURB / 2, 2, 120, CURB, 4, VIC_STREET.sidewalk);
      for (let x = -30, k = 0; x < 90; x += 1.1, k++) for (const z of [0.25, 1.2, 2.3, 3.3]) if ((k + Math.round(z * 3)) % 3 === 0) g.box(x + (z > 2 ? 0.55 : 0), CURB + 0.003, z + 0.45, 1.06, 0.006, 0.9, 0xa8a290);
      g.box(30, CURB + 0.004, 0.15, 120, 0.008, 0.3, VIC_STREET.curb);
      for (const [, draw, x] of PIECES) draw(s, x, 0, 0, 1, CURB);
      vicLamp(s, LAMP_X, 0.6, LAMP_X, -1.0, CURB);
      // Three signals, one in each state (their lamps' offsets set so, at signal time 5 s, the first
      // shows green, the second caution and the third stop), for traffic heading +x.
      setSignalTime(5);
      SIG_X.forEach((x, i) => {
        const off = [0, 6, 13][i];
        vicSignal(s, lamps, x, 1.2, 1, 0, 0, -1, (k, hide) => lamps.aux.set((k + (hide ? 3 : 0)) * 64 + off, -1, 0));
      });
      lamps.aux.set(0, 0, -1);
      // (Side on and face on, each pose tagged to show at signal time 5 s: phase 0 with offset 0, phase 1 with 13.)
      vicConstable(lamps, BOBBY_X, -3, [{ yaw: 0, tag: () => lamps.aux.set(6 * 64, -1, 0) }]);
      vicConstable(lamps, BOBBY_X + 3, -3, [{ yaw: Math.PI / 2, tag: () => lamps.aux.set(6 * 64 + 13, -1, 1) }]);
      lamps.aux.set(0, 0, -1);
      vicFingerPost(s, FINGER_X, 1.5, CURB, -1, 0, 0, -1, 3.2, 4.0, 0.5, 2.3);
      s.box(80, 1.8, 1.5, 0.1, 3.6, 0.1, 0xff00ff);   // (a box truck's height, for scale)
      for (const [b, m] of [[g, mat], [s, mat], [lamps, lampMat]] as const) scene.add(b.build(m)!);
    },
    render(ctx, f) {
      const [x, y, z, lx, ly, lz, fov, night] = VIEWS[Math.floor(f.t) % VIEWS.length];
      NIGHT.value = night; sun.intensity = night ? 0.05 : 2.3; sky.intensity = night ? 0.25 : 1.9;
      cam.position.set(x, y, z); cam.lookAt(lx, ly, lz); cam.fov = fov; cam.updateProjectionMatrix();
      r.setClearColor(night ? 0x0b1222 : 0x9cc4e8); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
