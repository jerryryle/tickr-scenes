// This sketch scene shows the Victorian city's traffic (city-victorian/victorian-vehicles.ts) for art
// direction, as tools/storyrides.ts shows the storybook's. It shows one a second, each three times
// along a cobbled street a third of its stride apart (the copies show how it moves in one picture),
// from its front three-quarter, and then each close. With RIDES_CLIP 1, it shows each one alone
// going by for three seconds as a clip, rendered every 100 ms. Build and render it with
//   make tool SCENE=long-day TOOL=vicrides SECS=18   -> build/long-day-vicrides/vicrides.png
import * as THREE from "three@0.187.0";
import "../src/city-storybook/storybook-landmark-knitting-works.ts";   // (first, as in tools/storyrides.ts: victorian-vehicles.ts takes its rig type from storyvehicles.ts, which needs the storybook palette as it loads)
import { Batch } from "../src/geom.ts";
import { vicRigs } from "../src/city-victorian/victorian-vehicles.ts";
import type { VicRig } from "../src/city-victorian/victorian-vehicles.ts";

const RIDES_CLIP = 0;
const ROW = 14, COPIES = 3;
// RIDE_STRIDE holds a stride's length (m) for each, so the copies show three points in it.
const RIDE_STRIDE: Record<string, number> = { hansom: 1.6, growler: 1.6, omnibus: 1.6, dray: 1.8, coster: 1.0, coalcart: 1.7, horseback: 1.6, pennyfarthing: 4.4, traction: 1.4 };

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera;
  const rigs: { rig: VicRig; parts: THREE.Mesh[] }[][] = [];
  const tmp: THREE.Matrix4[] = Array.from({ length: 16 }, () => new THREE.Matrix4());
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(36, sys.width / sys.height, 0.3, 600);
      const sun = new THREE.DirectionalLight(0xfff0dc, 2.2); sun.position.set(-30, 60, 50);
      scene.add(sun, new THREE.HemisphereLight(0xd8e4f0, 0x5a5048, 2.0));
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true }), g = new Batch();
      g.box(40, -0.05, 0, 300, 0.1, 300, 0x5a8040);
      vicRigs().forEach((_, i) => {
        const z = i * ROW;
        g.box(40, 0.0, z, 300, 0.04, 7, 0x5a5650);
        for (let x = -100; x < 180; x += 0.6) g.box(x, 0.025, z, 0.05, 0.01, 7, 0x4e4a44);   // (the setts' courses)
        for (const s of [-1, 1]) { g.box(40, 0.08, z + s * 4.6, 300, 0.16, 2.2, 0x9a958a); g.box(40, 0.09, z + s * 3.55, 300, 0.18, 0.2, 0x8a8680); }
      });
      scene.add(g.build(mat)!);
      vicRigs().forEach((rig, i) => {
        const row: { rig: VicRig; parts: THREE.Mesh[] }[] = [];
        for (let c = 0; c < COPIES; c++) {
          const parts = rig.parts.map((build, k) => {
            const b = new Batch(); build(b);
            const m = b.build(mat)!;
            if (k === 0) { const col = m.geometry.getAttribute("color"), tint = new THREE.Color(rig.colors[c % rig.colors.length]);
              for (let v = 0; v < col.count; v++) if (col.getX(v) > 0.99 && col.getY(v) > 0.99 && col.getZ(v) > 0.99) col.setXYZ(v, tint.r, tint.g, tint.b); }
            m.matrixAutoUpdate = false; scene.add(m); return m;
          });
          row.push({ rig, parts });
        }
        rigs.push(row);
      });
    },
    render(ctx, f) {
      const n = vicRigs().length, i = RIDES_CLIP ? Math.floor(f.t / 3) % n : Math.floor(f.t) % n, z = i * ROW;
      rigs.forEach((row, ri) => row.forEach((o, c) => {
        const clip = !!RIDES_CLIP && ri === i, show = RIDES_CLIP ? clip && c === 0 : ri === i && (Math.floor(f.t) < n || c === 0);
        const speed = o.rig.vmax * 0.9;
        const odo = clip ? (f.t % 3) * speed : (c * RIDE_STRIDE[o.rig.id]) / COPIES, x = clip ? -speed * 1.5 + odo : c * (o.rig.len + 3.5);
        const t = clip ? f.t : 1.3 + c * 0.7;
        o.rig.pose({ odo, v: speed, t, seed: c * 1.7 + ri }, tmp);
        const base = new THREE.Matrix4().makeTranslation(x, 0, z);
        o.parts.forEach((m, k) => { m.visible = show; m.matrix.multiplyMatrices(base, tmp[k]); m.matrixWorldNeedsUpdate = true; });
      }));
      // (After the first round, each is shown again close, the first of its copies seen from its
      // front quarter.)
      const close = !RIDES_CLIP && Math.floor(f.t) >= n, mid = RIDES_CLIP || close ? 0 : (COPIES - 1) * (vicRigs()[i].len + 3.5) / 2;
      if (close) { const L = vicRigs()[i].len; cam.position.set(L * 0.5 + 3, 3.0, z - L * 0.5 - 4.5); cam.lookAt(-0.1 * L, 1.5, z); cam.fov = 30; }
      else if (RIDES_CLIP) { cam.position.set(1.5, 2.8, z - 12); cam.lookAt(0, 1.4, z); cam.fov = 34; }
      else { cam.position.set(mid + 4, 5.0, z - 17); cam.lookAt(mid, 1.6, z); cam.fov = 50; }
      cam.updateProjectionMatrix();
      r.setClearColor(0x9aaabb); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
