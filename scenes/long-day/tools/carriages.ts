// This test scene shows the trucks' Victorian carriages (truck.ts carriage, carriage.ts) side by side, with
// each model at none, half and all of it, broadside and then the whole carriage close. The liveries
// are plain white because the tool has no assets. Build and render it with
//   make tool SCENE=long-day TOOL=carriages SECS=15   -> build/long-day-carriages/carriages.png
// With CARRIAGE_CLIP set to a model it is instead a clip of that carriage trotting past, slowing to a
// walk and stopping, then standing, filmed from the street (CLIP_VIEW "side", or "front" from its
// front quarter): render it a frame every 100 ms, DEFINE="CARRIAGE_CLIP=box26 CLIP_VIEW=side".
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { LIVERY_ASSETS, Truck, TruckKit } from "../src/truck.ts";
import type { LiveryName, TruckModel } from "../src/truck.ts";

const CARRIAGE_CLIP: string = "";
const CLIP_VIEW: string = "side";
const MODELS: TruckModel[] = ["box16", "box26", "reefer", "flatbed", "tractor"];
// The clip's speed (m/s) at time t: a trot, slowing to a walk, walking on, pulling up and standing.
const clipV = (t: number) => t < 4 ? 4 : t < 6 ? 4 - 2.5 * (t - 4) / 2 : t < 9 ? 1.5 : t < 11 ? 1.5 * (11 - t) / 2 : 0;
const LEVELS = [0, 0.5, 1], GAP = 16;
const gapOf = (i: number) => MODELS[i] === "tractor" ? 26 : GAP;   // (a tractor's trailer is long)

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera;
  const rows: Truck[][] = [];
  let clip: Truck | null = null, cs = 0, ct = 0;
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); scene.background = new THREE.Color(0x8ac8f0);
      cam = new THREE.PerspectiveCamera(30, sys.width / sys.height, 0.5, 400);
      const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(40, 60, 50);
      scene.add(sun, new THREE.HemisphereLight(0xcfe6ff, 0x4a4030, 2.0));
      const lot = new Batch(); lot.box(0, -0.05, 100, 600, 0.1, 600, 0x6a6d72);
      for (let x = -40; x < 80; x += 2) lot.box(x, 0.06, 3.2, 1.0, 0.12, 0.4, 0x8a8c90);   // (kerb stones, to see it move against)
      scene.add(lot.build(new THREE.MeshLambertMaterial({ vertexColors: true }))!);
    },
    render(ctx, f) {
      try { draw(f.t); ctx.drawImage(r.domElement as any, 0, 0); } catch (e: any) { sys.log("carriages: " + (e?.stack ?? e)); }
    },
  };
  function drawClip(time: number) {
    if (!clip) {
      const kit = new TruckKit({} as Record<LiveryName, CanvasImageSource>);
      const white = new THREE.DataTexture(new Uint8Array([244, 244, 240, 255]), 1, 1); white.needsUpdate = true;
      for (const n of LIVERY_ASSETS) kit.livery[n].map = white;
      clip = new Truck(kit, CARRIAGE_CLIP as TruckModel); clip.carriage = 1; scene.add(clip.root);
    }
    // (Its distance from the speed, stepped finely from the last frame.)
    for (; ct < time; ct += 0.01) cs += clipV(ct) * 0.01;
    const v = clipV(time), a = (clipV(time + 0.05) - v) / 0.05, s0 = -30;
    clip.speed = v; clip.accel = a;
    clip.follow(s0 + cs, 0, 0, 0, s0 + cs - clip.root.position.x);
    clip.update(1 / 10, time);
    const hx = clip.root.position.x + 8.4;
    if (CLIP_VIEW === "front") { cam.fov = 34; cam.position.set(hx + 8, 2.4, -6); cam.lookAt(hx, 1.2, 0); }
    else { cam.fov = 26; cam.position.set(hx, 1.3, -6.5); cam.lookAt(hx, 1.0, 0); }
    cam.updateProjectionMatrix();
    r.render(scene, cam);
  }
  function draw(time: number) {
    if (CARRIAGE_CLIP) { drawClip(time); return; }
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
