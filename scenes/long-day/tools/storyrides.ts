// This sketch scene shows the storybook city's own vehicles (storyvehicles.ts) for art direction.
// It shows one a second, each three times along a pastel street at a third of its stride apart
// (the copies show how it moves in one picture), from its front three-quarter, and then each close.
// With RIDES_CLIP 1, it shows each one alone going by for three seconds as a clip, rendered every
// 100 ms. Build and render it with
//   make tool SCENE=long-day TOOL=storyrides SECS=16   -> build/long-day-storyrides/storyrides.png
import * as THREE from "three@0.187.0";
import "../src/city-storybook/storybook-landmark-knitting-works.ts";   // (first: storybook-buildings-town.ts and storybook-landmark-knitting-works.ts import each other round about, and storybook-landmark-knitting-works.ts needs the palette as it loads)
import { Batch } from "../src/geom.ts";
import { storyRigColors, storyRigs } from "../src/storyvehicles.ts";
import type { StoryRig } from "../src/storyvehicles.ts";

const RIDES_CLIP = 0;
const ROW = 14, COPIES = 3, SPEED = 4;
// STRIDE holds a stride's length (m) for each, so the copies show three points in it.
const STRIDE: Record<string, number> = { hamster: 3.0, strider: 2.4, caterpillar: 2.2, pogo: 2.6, unicycle: 2.5, balloon: 3, teacup: 3, snail: 1.2 };

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera;
  const rigs: { rig: StoryRig; parts: THREE.Mesh[] }[][] = [];
  const tmp: THREE.Matrix4[] = Array.from({ length: 16 }, () => new THREE.Matrix4());
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(36, sys.width / sys.height, 0.3, 600);
      const sun = new THREE.DirectionalLight(0xfff4e0, 2.2); sun.position.set(-30, 60, 50);
      scene.add(sun, new THREE.HemisphereLight(0xd8f4ff, 0x6a5a70, 2.1));
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true }), g = new Batch();
      g.box(40, -0.05, 0, 300, 0.1, 300, 0x98dc62);
      storyRigs().forEach((_, i) => {
        const z = i * ROW;
        g.box(40, 0.0, z, 300, 0.04, 7, 0x5e5070);
        for (let x = -100; x < 180; x += 3) g.box(x, 0.03, z, 1.4, 0.02, 0.18, 0xff7fb5);
        for (const s of [-1, 1]) g.box(40, 0.08, z + s * 4.6, 300, 0.16, 2.2, 0xffd9e0);
      });
      scene.add(g.build(mat)!);
      storyRigs().forEach((rig, i) => {
        const row: { rig: StoryRig; parts: THREE.Mesh[] }[] = [];
        for (let c = 0; c < COPIES; c++) {
          const parts = rig.parts.map((build, k) => {
            const b = new Batch(); build(b);
            const m = b.build(mat)!;
            if (k === 0) { const col = m.geometry.getAttribute("color"), tint = new THREE.Color(storyRigColors()[i]);
              for (let v = 0; v < col.count; v++) if (col.getX(v) > 0.99 && col.getY(v) > 0.99 && col.getZ(v) > 0.99) col.setXYZ(v, tint.r, tint.g, tint.b); }
            m.matrixAutoUpdate = false; scene.add(m); return m;
          });
          row.push({ rig, parts });
        }
        rigs.push(row);
      });
    },
    render(ctx, f) {
      const n = storyRigs().length, i = RIDES_CLIP ? Math.floor(f.t / 3) % n : Math.floor(f.t) % n, z = i * ROW;
      rigs.forEach((row, ri) => row.forEach((o, c) => {
        const clip = !!RIDES_CLIP && ri === i, show = RIDES_CLIP ? clip && c === 0 : ri === i && (Math.floor(f.t) < n || c === 0);
        const odo = clip ? (f.t % 3) * SPEED : (c * STRIDE[o.rig.id]) / COPIES, x = clip ? -6 + odo : c * (o.rig.len + 3.5);
        const t = clip ? f.t : 1.3 + c * 0.7;
        o.rig.pose({ odo, v: SPEED, t, seed: c * 1.7 + ri }, tmp);
        const base = new THREE.Matrix4().makeTranslation(x, 0, z);
        o.parts.forEach((m, k) => { m.visible = show; m.matrix.multiplyMatrices(base, tmp[k]); m.matrixWorldNeedsUpdate = true; });
      }));
      // (After the first round, each is shown again close, with the first of its copies seen from its
      // front quarter.)
      const close = !RIDES_CLIP && Math.floor(f.t) >= n, mid = RIDES_CLIP || close ? 0 : (COPIES - 1) * (storyRigs()[i].len + 3.5) / 2;
      if (close) { const L = storyRigs()[i].len; cam.position.set(L * 0.7 + 3, 2.0, z - L * 0.9 - 4); cam.lookAt(0, 1.2, z); cam.fov = 40; }
      else { cam.position.set(mid + 7.5, 3.6, z - 10.5); cam.lookAt(mid, 1.7, z); cam.fov = RIDES_CLIP ? 34 : 44; }
      cam.updateProjectionMatrix();
      r.setClearColor(0x8ad8f0); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
