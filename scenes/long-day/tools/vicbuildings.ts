// This test scene shows the Victorian city's buildings (src/city-victorian/victorian-buildings-town.ts)
// close up, for art direction at the board's resolution. It lays every kind out on its own lots
// along a granite-setted street, with the facade atlas and the city's own facade material, and
// shows one view a second: first its facade tiles (three frames of colour, one of masks), then each
// kind from the pavement and from above, then a few of them after dark with their windows and lamps
// lit, and last the "spires" backdrop round the horizon, two ways. Build and render it with
//   make tool SCENE=long-day TOOL=vicbuildings SECS=32   -> build/long-day-vicbuildings/vicbuildings.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { mulberry32 } from "../src/rng.ts";
import { captureCanvasClass } from "../src/canvas.ts";
import { makeFacadeMaterial, setFacadeAtlas } from "../src/facade.ts";
import { paintFacadeAtlas, FACADE_GRID, FACADE_TILE } from "../src/facadeart.ts";
import { FACADE, FACADE_KINDS } from "../src/facadetiles.ts";
import { NIGHT_GLOW } from "../src/atmosphere.ts";
import { Backdrop } from "../src/backdrop.ts";
import { STYLE_VICTORIAN } from "../src/city-victorian/victorian-style.ts";
import { VIC, VIC_STREET, vicBackYard, vicGate, vicLot, vicPlanter, vicShed, vicSquare, vicTower, vicWorks, vicYard } from "../src/city-victorian/victorian-buildings-town.ts";
import type { VicDistrict, VicRect } from "../src/city-victorian/victorian-buildings-town.ts";

const Y0 = 0.15;
// (A seed whose recipe's first draw lands in [lo, hi): to show a given kind of a function that
// picks its kind from its first draw.)
function seedFor(lo: number, hi: number, from = 1): number { for (let k = from; ; k++) { const v = mulberry32(k)(); if (v >= lo && v < hi) return k; } }
type Shot = { pos: [number, number, number]; at: [number, number, number]; fov?: number; night?: boolean };

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, sun: THREE.DirectionalLight, hemi: THREE.HemisphereLight;
  let facadeMat: THREE.MeshLambertMaterial, atlas: { colour: any; mask: any } | null = null, backdrop: Backdrop;
  const shots: Shot[] = [], doors: number[] = [];
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false); r.autoClear = false;
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(40, sys.width / sys.height, 0.3, 1200);
      sun = new THREE.DirectionalLight(0xfff0dc, 2.3); sun.position.set(-40, 60, -50);
      hemi = new THREE.HemisphereLight(0xcfe0f0, 0x4a4030, 1.9);
      scene.add(sun, hemi);
      facadeMat = makeFacadeMaterial();
      const g = new Batch(), s = new Batch(), ground = new THREE.MeshLambertMaterial({ vertexColors: true });
      g.box(200, -0.05, 40, 900, 0.1, 400, 0x5a8040);
      // The street along x at z < 0: setts, a kerb and a flagged pavement on its far side.
      g.box(200, 0.0, -12, 900, 0.04, 12, VIC_STREET.asphalt);
      g.box(200, 0.075, -3, 900, 0.15, 6, VIC_STREET.sidewalk);
      const door = (x0: number, x1: number, n: number) => { doors.push((x0 + x1) / 2, n); };
      const lot = (x: number, w: number, d: number, district: VicDistrict, seed: number, hs = 0.6) => {
        const b: VicRect = { x0: x + 0.3, z0: 0.4, x1: x + w - 0.3, z1: d - 0.3 };
        g.box(x + w / 2, Y0 - 0.01, d / 2, w, 0.02, d, VIC_STREET.pavers);
        vicLot(s, b, Y0, district, hs, STYLE_VICTORIAN.walls[district === "park" ? "commercial" : district], mulberry32(seed), door);
      };
      // Each run of lots starts at x0; the shots look at each from the pavement and from above.
      const run = (x0: number, n: number, w: [number, number], d: number, district: VicDistrict, seed: number, hs = 0.6) => {
        let x = x0; const r0 = mulberry32(seed);
        for (let i = 0; i < n; i++) { const ww = w[0] + (w[1] - w[0]) * r0(); lot(x, ww, d, district, seed * 31 + i, hs); x += ww; }
        return x;
      };
      const xr = run(0, 7, [9, 12], 11, "residential", 3);
      const xc = run(100, 6, [8, 14], 13, "commercial", 5);
      const xd = run(200, 4, [16, 26], 15, "downtown", 7, 0.9);
      const xi = run(320, 3, [18, 30], 17, "industrial", 11);
      const xp = run(420, 3, [7, 9], 6, "park", 13);
      // Behind the lots: the block middles (a church, a town hall, a grand block; a warehouse and a
      // mill), a yard, back yards and a shed, two garden squares, tree guards and the toll gate.
      const mid = (x: number, z: number, w: number, d: number, f: (b: VicRect) => void) => { g.box(x, Y0 - 0.01, z, w, 0.02, d, VIC_STREET.pavers); f({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 }); };
      mid(20, 45, 36, 24, (b) => vicTower(s, b, Y0, 0.8, STYLE_VICTORIAN.walls.downtown, mulberry32(seedFor(0, 0.42))));
      mid(65, 45, 38, 26, (b) => vicTower(s, b, Y0, 0.8, STYLE_VICTORIAN.walls.downtown, mulberry32(seedFor(0.42, 0.7))));
      mid(115, 45, 40, 28, (b) => vicTower(s, b, Y0, 0.8, STYLE_VICTORIAN.walls.downtown, mulberry32(seedFor(0.7, 1))));
      mid(170, 45, 34, 22, (b) => vicWorks(s, b, Y0, 8, 0x8a3e2c, mulberry32(seedFor(0, 1, 40))));
      mid(215, 45, 34, 22, (b) => vicWorks(s, b, Y0, 8, 0x9a4a34, mulberry32(seedFor(0, 1, 90))));
      { const n0 = s.mark(); vicYard(s, 26, 18, Y0, mulberry32(21)); s.transformFrom(n0, { ox: 270, oz: 45, rot: 0 }); g.box(270, Y0 - 0.01, 45, 26, 0.02, 18, VIC.flag); }
      for (let i = 0; i < 3; i++) { const n0 = s.mark(), m0 = g.mark(); vicBackYard(s, g, -2.6, 0, 2.6, 9, Y0, STYLE_VICTORIAN.grass, mulberry32(30 + i)); s.transformFrom(n0, { ox: 305 + i * 5.4, oz: 38, rot: 0 }); g.transformFrom(m0, { ox: 305 + i * 5.4, oz: 38, rot: 0 }); }
      { const n0 = s.mark(); vicShed(s, Y0, 0xb8a27a, mulberry32(5)); s.transformFrom(n0, { ox: 326, oz: 42, rot: 0 }); }
      for (const [x, w, d, big] of [[360, 36, 24, true], [400, 20, 14, false]] as const) { const n0 = s.mark(), m0 = g.mark(); vicSquare(s, g, w, d, Y0, big, STYLE_VICTORIAN.grass, mulberry32(x)); s.transformFrom(n0, { ox: x, oz: 45, rot: 0 }); g.transformFrom(m0, { ox: x, oz: 45, rot: 0 }); }
      for (let i = 0; i < 3; i++) { const n0 = s.mark(); vicPlanter(s, Y0); s.transformFrom(n0, { ox: 430 + i * 4, oz: 40, rot: 0 }); }
      g.box(480, 0.0, 45, 60, 0.04, 18, VIC_STREET.asphalt);
      vicGate(s, 480, 45, 1, 0, 9 + 1.6, 0);
      scene.add(g.build(ground)!, s.build(facadeMat)!);
      backdrop = new Backdrop(); backdrop.build(STYLE_VICTORIAN, 7);
      // The shots: each run from the pavement opposite and from above, the middles, then night.
      const street = (x: number, z = 0, h = 2.2, dx = 18): Shot => ({ pos: [x - dx, h, -13], at: [x + 4, 5 + z * 0, 4] });
      const above = (x: number, z: number, d = 26): Shot => ({ pos: [x - d * 0.7, d * 0.75, z - d], at: [x, 3, z] });
      shots.push(street(14), street(44), above(30, 6), street(118), street(146), above(130, 6),
        { pos: [196, 2.2, -14], at: [215, 9, 4] }, { pos: [228, 2.0, -14], at: [250, 10, 4] }, above(240, 8, 34),
        street(338, 0, 2.2, 22), street(434, 0, 2, 12), above(xp - 14, 4, 14),
        { pos: [-6, 5, 14], at: [20, 13, 45] }, { pos: [42, 4, 12], at: [65, 13, 45] }, { pos: [88, 5, 8], at: [115, 14, 45] },
        { pos: [150, 4, 16], at: [180, 10, 45] }, above(270, 45, 26), { pos: [300, 7, 30], at: [313, 1, 43] },
        above(380, 45, 34), { pos: [462, 5, 38], at: [482, 2, 54] }, { pos: [452, 2.0, 44], at: [485, 3, 52] },
        { ...street(30), night: true }, { ...street(130), night: true }, { ...street(220), night: true }, { ...above(30, 6), night: true },
        { pos: [200, 2, -60], at: [200, 12, -900], fov: 40 }, { pos: [200, 2, -60], at: [900, 12, -60], fov: 40 });
      void xr; void xc; void xd; void xi;
    },
    render(ctx, f) {
      captureCanvasClass(ctx);
      if (!atlas) { atlas = paintFacadeAtlas(); setFacadeAtlas(facadeMat, atlas); }
      const k = Math.floor(f.t);
      if (k < 4) {
        // The Victorian tiles, all four variants of each kind, at half size, twelve a frame (the
        // fourth frame: the first twelve's masks).
        const src = k === 3 ? atlas.mask : atlas.colour, kinds = [FACADE.VICT_SASH, FACADE.VICT_DOOR, FACADE.VICT_SHOP, FACADE.VICT_SHOPWIN, FACADE.VICT_GOTHIC, FACADE.VICT_GRAND, FACADE.VICT_MILL, FACADE.VICT_WAREHOUSE];
        ctx.fillStyle = "#3a6a9a"; ctx.fillRect(0, 0, 384, 128);
        const ids = kinds.flatMap((kind) => [0, 1, 2, 3].map((v) => kind + FACADE_KINDS * v)).slice((k % 3) * 12, (k % 3) * 12 + 12);
        ids.forEach((id, i) => { const sx = (id % FACADE_GRID) * FACADE_TILE, sy = Math.floor(id / FACADE_GRID) * FACADE_TILE; ctx.drawImage(src, sx, sy, FACADE_TILE, FACADE_TILE, (i % 6) * 64, Math.floor(i / 6) * 64, 64, 64); });
        return;
      }
      const sh = shots[(k - 4) % shots.length];
      const night = !!sh.night;
      NIGHT_GLOW.value = night ? 1 : 0;
      sun.intensity = night ? 0.15 : 2.3; hemi.intensity = night ? 0.35 : 1.9;
      cam.position.set(...sh.pos); cam.lookAt(...sh.at); cam.fov = sh.fov ?? 40; cam.updateProjectionMatrix();
      r.setClearColor(night ? 0x0c1220 : 0x8aa4bc); r.clear();
      if (!night) { backdrop.camera.quaternion.copy(cam.quaternion); backdrop.camera.fov = cam.fov; backdrop.camera.aspect = cam.aspect; backdrop.camera.updateProjectionMatrix(); r.render(backdrop.scene, backdrop.camera); r.clearDepth(); }
      r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
