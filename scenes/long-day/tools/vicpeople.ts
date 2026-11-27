// This test scene shows Ravensgate's people (figure.ts vicPerson) and the crew in carter's dress
// (character.ts CARTER_DRIVER, CARTER_MATE). The front row is a line-up of every Victorian dress,
// standing; the row behind it is the same line-up walking; the back row is a crowd dressed from
// their own colours, walking. The crew stand beside them in both dresses, walking and seated. Each
// second is another view, and the last few are at the distances the scene's cameras watch from.
// Build and render it with
//   make tool SCENE=long-day TOOL=vicpeople SECS=10   -> build/long-day-vicpeople/vicpeople.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { FIG_STYLE, Figures, HAIRS, PANTS, SHIRTS, SKINS, VIC_PARASOLS, VIC_UMBRELLAS, walkSwing } from "../src/figure.ts";
import type { Body, VicDress, VicHat } from "../src/figure.ts";
import { CARTER_DRIVER, CARTER_MATE, Character, DRIVER_LOOK, HIP_Y, restPose, seatedPose, walkPose, WORKER_LOOK } from "../src/character.ts";
import { mulberry32 } from "../src/rng.ts";
import { CURB_H } from "../src/grid.ts";

// The line-up: each dress in its own colours (shirt: the coat or bodice; pants: the trousers or
// skirt; coat: the waistcoat, apron or shawl), with a hat and a parasol or umbrella here and there.
const LINEUP: (Partial<Body> & { dress: VicDress; vicHat?: VicHat })[] = [
  { dress: "frock", shirt: 0x1e1e24, pants: 0x4a4844, coat: 0x7a2a2a },
  { dress: "sack", shirt: 0x4a4236, pants: 0x5e5646, coat: 0xa08a5a },
  { dress: "sack", vicHat: "top", shirt: 0x283244, pants: 0x2a2a2c, coat: 0x2a2a2a },
  { dress: "cap", shirt: 0x3a3226, pants: 0x34302a },
  { dress: "sleeves", shirt: 0xece6da, pants: 0x3a3a42, coat: 0x3a4a3a },
  { dress: "woman", vicHat: "bonnet", shirt: 0x2a3a5a, pants: 0x2a3a5a, hat: 0xd8c08a },
  { dress: "woman", vicHat: "wide", shirt: 0x8a7a9a, pants: 0x8a7a9a, hat: 0xe8e0d0, parasol: VIC_PARASOLS[1] },
  { dress: "woman", vicHat: "bonnet", shirt: 0x7a2a32, pants: 0x5a2a4a, coat: 0xc8b89a, hat: 0x2a2a2a },
  { dress: "woman", vicHat: "none", shirt: 0x3a5a4a, pants: 0x6a5a3a, coat: 0x8a3a3a },
  { dress: "boy", s: 0.62, shirt: 0x4a4238, pants: 0x34302a, hat: 0x3a3a3a },
  { dress: "girl", s: 0.6, shirt: 0x9a6a4a, pants: 0x8a3a2a },
  { dress: "bobby", shirt: 0, pants: 0 },
];
const GAP = 1.1;
// The views: eye, target, field of view.
const VIEWS: [number, number, number, number, number, number, number][] = [
  [2.2, 1.5, -3.2, 2.2, 1.0, 0, 46],     // the men, close
  [7.1, 1.5, -3.2, 7.1, 1.0, 0, 46],     // the women, close
  [11.6, 1.4, -3.4, 12.6, 0.9, 0, 50],   // the children, the bobby and the crew
  [-3, 1.2, 1.5, 6, 1.0, 1.5, 36],       // side on to the walking row: skirts and tails
  [6.5, 1.6, -6.5, 6.5, 1.0, 3, 40],     // the crowd row behind
  [15.6, 1.4, -3.6, 15.6, 0.9, 0.8, 46], // the crew, close: carter's dress
  [8, 4, -12, 8, 1.0, 1.5, 34],          // the whole set at street-camera distance
  [8, 9, -20, 8, 1.0, 1.5, 30],          // further, from above, as the chase camera sees the pavement
  [4, 1.7, -3, 7, 1.0, 1.5, 50],         // three-quarter, down the rows
  [14.5, 2.2, 4, 14.5, 1.0, 0, 44],      // the crew from behind
];

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, F: Figures;
  const crew: { c: Character; pose: "rest" | "walk" | "seat"; x: number; z: number }[] = [];
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); scene.background = new THREE.Color(0x9aaec0);
      cam = new THREE.PerspectiveCamera(40, sys.width / sys.height, 0.3, 300);
      const sun = new THREE.DirectionalLight(0xfff2e0, 2.3); sun.position.set(-30, 50, -40);
      scene.add(sun, new THREE.HemisphereLight(0xd8e4f0, 0x5a5048, 1.9));
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      const g = new Batch();
      g.box(8, CURB_H / 2, 2, 40, CURB_H, 12, 0x8f8a80);   // the flagstones
      g.box(8, -0.05, -8, 40, 0.1, 8, 0x5a524a);           // the setts
      g.box(17.6, 0.25 + CURB_H, 1.75, 1.2, 0.5, 0.4, 0x5a3a22); // a crate to sit on (the seated crew)
      scene.add(g.build(mat)!);
      FIG_STYLE.victorian = true;
      F = new Figures(scene, mat, 3000);
      const add = (look: typeof DRIVER_LOOK, pl: typeof CARTER_DRIVER, period: boolean, pose: "rest" | "walk" | "seat", x: number, z: number) => {
        const c = new Character(mat, look, false, pl); c.period = period; scene.add(c.root); crew.push({ c, pose, x, z });
      };
      add(DRIVER_LOOK, CARTER_DRIVER, true, "rest", 14, 0); add(WORKER_LOOK, CARTER_MATE, true, "rest", 15.1, 0);
      add(DRIVER_LOOK, CARTER_DRIVER, true, "walk", 14, 1.6); add(WORKER_LOOK, CARTER_MATE, true, "walk", 15.1, 1.6);
      add(DRIVER_LOOK, CARTER_DRIVER, false, "rest", 16.4, 0); add(DRIVER_LOOK, CARTER_DRIVER, true, "seat", 17.6, 1.7);
    },
    render(ctx, f) {
      try { draw(f.t); ctx.drawImage(r.domElement as any, 0, 0); } catch (e: any) { sys.log("vicpeople: " + (e?.stack ?? e)); }
    },
  };
  function draw(time: number) {
    const ph = time * 1.3;
    F.begin();
    // The front row stands, facing the camera (-z); the second row walks along +x.
    LINEUP.forEach((p, i) => {
      const base = { skin: SKINS[i % SKINS.length], hair: HAIRS[(i * 2) % HAIRS.length], ...p } as Body;
      F.person({ ...base, x: i * GAP, z: 0, yaw: Math.PI / 2 - 0.25, arms: [0.05, -0.05] });
      const w = walkSwing(ph + i * 0.7);
      F.person({ ...base, x: i * GAP, z: 1.5, yaw: 0, y: CURB_H + w.bob, legs: w.legs, arms: w.arms });
    });
    // The back row: a crowd dressed from their own colours, as the scene's walkers are, one with an umbrella.
    const rnd = mulberry32(7);
    for (let i = 0; i < 14; i++) {
      const s = rnd() < 0.15 ? 0.62 : 1, w = walkSwing(ph * (s < 1 ? 1.2 : 1) + i), umb = i === 3;
      const b: Body = { x: i * 0.95, z: 3, yaw: i % 2 ? 0 : Math.PI, s, y: CURB_H + w.bob, legs: w.legs, arms: umb ? [w.arms[0], 0.55] : w.arms, fore: umb ? [w.arms[0], 2.2] : undefined,
        shirt: SHIRTS[Math.floor(rnd() * SHIRTS.length)], pants: PANTS[Math.floor(rnd() * PANTS.length)], skin: SKINS[Math.floor(rnd() * SKINS.length)], hair: HAIRS[Math.floor(rnd() * HAIRS.length)], parasol: VIC_PARASOLS[i % VIC_PARASOLS.length] };
      F.person(b);
      if (umb) { const hd = F.handR; F.umbrella(hd[0], F.head[1] + 0.42 * s, hd[2], hd, VIC_UMBRELLAS[0], 0, Math.PI / 4); }
    }
    F.end_();
    // The crew, at a third of the crowd's walking pace in cycles (walkPose: a cycle is two steps).
    for (const k of crew) {
      const P = k.pose === "walk" ? walkPose(time * 0.8, restPose()) : k.pose === "seat" ? seatedPose(restPose(), 0) : restPose();
      k.c.apply(P);
      k.c.root.position.set(k.x, k.pose === "seat" ? CURB_H + 0.56 - HIP_Y : CURB_H, k.z);
      k.c.root.rotation.y = k.pose === "walk" ? 0 : k.pose === "seat" ? Math.PI / 2 : Math.PI / 2 - 0.25;
    }
    const v = VIEWS[Math.floor(time) % VIEWS.length];
    cam.position.set(v[0], v[1], v[2]); cam.lookAt(v[3], v[4], v[5]); cam.fov = v[6]; cam.updateProjectionMatrix();
    r.render(scene, cam);
  }
}
