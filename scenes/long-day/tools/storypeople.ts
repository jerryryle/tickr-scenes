// This test scene shows the storybook city's people (figure.ts storyPerson) and the crew in
// storybook dress (character.ts STORY_DRIVER, STORY_MATE). The front row stands about, fidgeting
// (standIdle); the row behind walks the storybook walk (walkSwing) side on to the camera; the crew
// walk and stand beside them. Each view is held three seconds, so a clip of it shows the motion.
// Build and render it with
//   make tool SCENE=long-day TOOL=storypeople SECS=18   -> build/long-day-storypeople/storypeople.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { FIG_STYLE, Figures, HAIRS, PANTS, SHIRTS, SKINS, standIdle, walkSwing } from "../src/figure.ts";
import type { Body } from "../src/figure.ts";
import { CARTER_DRIVER, CARTER_MATE, Character, CREW_GAIT, DRIVER_LOOK, restPose, STORY_DRIVER, STORY_MATE, walkPose, WORKER_LOOK } from "../src/character.ts";
import { crouchLegs } from "../src/crew.ts";
import { flossCart, tuba } from "../src/crowd.ts";
import { mulberry32 } from "../src/rng.ts";
import { CURB_H } from "../src/grid.ts";

const N = 12, GAP = 1.1;
// The views: eye, target, field of view.
const VIEWS: [number, number, number, number, number, number, number][] = [
  [3.0, 1.4, -4.0, 3.0, 1.0, 0, 46],       // the standing row, close
  [9.0, 1.4, -4.0, 9.0, 1.0, 0, 46],       // the rest of it
  [5.0, 1.3, 6.8, 5.0, 1.0, 2.0, 44],      // the walkers side on, from behind them
  [15.0, 1.5, -3.6, 15.0, 1.1, 1, 40],     // the crew, close
  [-3.3, 1.8, -4.5, -3.3, 1.2, 0, 46],     // the seller and the busker
  [7, 4, -14, 7, 1.0, 1.5, 34],            // the whole set at street-camera distance
];

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, F: Figures;
  const crew: { c: Character; walk: boolean; x: number; z: number }[] = [];
  const rnd = mulberry32(11), look: Body[] = [];
  for (let i = 0; i < 2 * N; i++) look.push({ x: 0, z: 0, yaw: 0, s: i % 7 === 3 ? 0.62 : 1, shirt: SHIRTS[Math.floor(rnd() * SHIRTS.length)], pants: PANTS[Math.floor(rnd() * PANTS.length)], skin: SKINS[Math.floor(rnd() * SKINS.length)], hair: HAIRS[Math.floor(rnd() * HAIRS.length)] });
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); scene.background = new THREE.Color(0x3f8fe0);
      cam = new THREE.PerspectiveCamera(40, sys.width / sys.height, 0.3, 300);
      const sun = new THREE.DirectionalLight(0xfff2e0, 2.3); sun.position.set(-30, 50, -40);
      scene.add(sun, new THREE.HemisphereLight(0xd8e4f0, 0x5a5048, 1.9));
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const g = new Batch();
      g.box(8, CURB_H / 2, 2, 40, CURB_H, 12, 0xd9a9b8);   // the pavement
      g.box(8, -0.05, -8, 40, 0.1, 8, 0x5a4a6e);           // the street
      scene.add(g.build(mat)!);
      FIG_STYLE.storybook = true; CREW_GAIT.story = true;
      F = new Figures(scene, mat, 4000);
      const add = (look: typeof DRIVER_LOOK, pl: typeof CARTER_DRIVER, sl: typeof STORY_DRIVER, walk: boolean, x: number, z: number) => {
        const c = new Character(mat, look, false, pl, sl); c.story = true; scene.add(c.root); crew.push({ c, walk, x, z });
      };
      add(DRIVER_LOOK, CARTER_DRIVER, STORY_DRIVER, false, 14.2, 0); add(WORKER_LOOK, CARTER_MATE, STORY_MATE, false, 15.4, 0);
      add(DRIVER_LOOK, CARTER_DRIVER, STORY_DRIVER, true, 14.2, 1.8); add(WORKER_LOOK, CARTER_MATE, STORY_MATE, true, 15.4, 1.8);
    },
    render(ctx, f) {
      try { draw(f.t); ctx.drawImage(r.domElement as any, 0, 0); } catch (e: any) { sys.log("storypeople: " + (e?.stack ?? e)); }
    },
  };
  function draw(time: number) {
    F.begin();
    for (let i = 0; i < N; i++) {
      // Standing, facing the camera, fidgeting.
      const a: Body = { ...look[i], x: i * GAP, z: 0, yaw: Math.PI / 2 - 0.25, y: CURB_H };
      standIdle(a, time, i * 1.37);
      F.person(a);
      // Walking along +x at 1.2 m/s, on a treadmill.
      const L = look[N + i], s = L.s ?? 1, w = walkSwing(time * 1.2 / s + i * 0.7);
      F.person({ ...L, x: i * GAP, z: 2.0, yaw: 0, y: CURB_H + w.bob * s, legs: w.legs, shins: w.shins, hip: (w.hip ?? 0.86) * s, arms: w.arms, fore: w.fore, tilt: w.tilt, lean: w.lean, nod: w.nod, jig: w.jig });
    }
    // A candy-floss seller at their cart and a busker with a tuba, as the crowd has them.
    const seller: Body = { ...look[1], x: -2.5, z: 0.6, yaw: Math.PI / 2 }, busker: Body = { ...look[5], x: -4.2, z: 0.4, yaw: Math.PI / 2 - 0.3 };
    standIdle(seller, time, 3); const m = 0.3 + 0.2 * Math.sin(time * 1.3); seller.arms = [-m, m]; F.person(seller); flossCart(F, -2.5, -0.4, Math.PI / 2);
    standIdle(busker, time, 5); const mm = 0.9 + 0.25 * Math.sin(time * 7); busker.arms = [-mm, mm]; F.person(busker); tuba(F, { x: -4.2, z: 0.4, h: Math.PI / 2 - 0.3, phase: time }, busker);
    F.end_();
    for (const k of crew) {
      const P = k.walk ? walkPose(time * 0.75, restPose()) : restPose();
      if (k.walk) { const [hc, kc] = crouchLegs(P.drop); P.hipL += hc; P.hipR += hc; P.knL += kc; P.knR += kc; }   // (as the crew's walk is: crew.ts)
      k.c.apply(P);
      k.c.root.position.set(k.x, CURB_H, k.z);
      k.c.root.rotation.y = k.walk ? 0 : Math.PI / 2 - 0.25;
    }
    const v = VIEWS[Math.floor(time / 3) % VIEWS.length];
    cam.position.set(v[0], v[1], v[2]); cam.lookAt(v[3], v[4], v[5]); cam.fov = v[6]; cam.updateProjectionMatrix();
    r.render(scene, cam);
  }
}
