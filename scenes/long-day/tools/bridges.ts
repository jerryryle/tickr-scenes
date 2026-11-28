// Test scene: Long Day's covered bridges on the country drive (countryworld.ts, piece "bridge"),
// with the drive's fog. It seeks a journey into the drives that have one and, for each bridge,
// holds four views a second each: from the road's edge at the bridge looking out along the river
// either way (a side-on tracking shot's view), high and oblique from short of it, and low from the
// bank downstream. Build and render it with
//   make tool SCENE=long-day TOOL=bridges SECS=16   -> build/long-day-bridges/bridges.png
import * as THREE from "three@0.187.0";
import "../src/engine.ts";   // (its fog by distance from the camera)
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { setWorldBytes } from "../src/worlddata.ts";
import { WORLD_ASSET } from "../src/world-packed.ts";
import { COUNTRY_CLEAR, CountryWorld } from "../src/countryworld.ts";
import type { CountryRoad, RoadPiece } from "../src/country.ts";

const SEED = 1, MINUTES = [54.4, 192.1, 389.1, 522.5];   // journey times on drives with a bridge (seed 1)
const SKY = 0x9cc4e8, FAR = COUNTRY_CLEAR * 0.95;        // (engine.ts setViewDistance)

export default function createScene({ sys, assets }: SceneInputs): Scene {
  setWorldBytes(assets[WORLD_ASSET].bytes);
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, world: CountryWorld;
  const shots: { road: CountryRoad; p: RoadPiece }[] = [];
  const P = { x: 0, z: 0, h: 0, k: 0 }, Q = { x: 0, z: 0, h: 0, k: 0 };
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); scene.fog = new THREE.Fog(SKY, FAR * 0.5, FAR);
      cam = new THREE.PerspectiveCamera(46, sys.width / sys.height, 0.5, COUNTRY_CLEAR * 1.05);
      const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(40, 60, 50);
      scene.add(sun, new THREE.HemisphereLight(0xcfe6ff, 0x4a4030, 2.0));
      const solid = new THREE.MeshLambertMaterial({ vertexColors: true });
      world = new CountryWorld(scene, { ground: solid, solid, lamp: solid }, null);
      world.exact = true;
      const seen = new Set<string>();
      for (const m of MINUTES) {
        const road = new Journey(readConfig({ seed: SEED } as SceneEnv), m * 60, "autumn").country;
        if (!road || seen.has(road.key)) continue;
        seen.add(road.key);
        for (const p of road.pieces) if (p.kind === "bridge") shots.push({ road, p });
      }
      sys.log(`bridges: ${shots.length}`);
    },
    render(ctx, f) {
      if (!shots.length) return;
      const k = Math.floor(f.t / 4) % shots.length, v = Math.floor(f.t) % 4, { road, p } = shots[k];
      const mid = p.s + 60, y = road.baseAt(mid);
      world.setRoad(road); world.update(0, mid, true, false);
      let cy: number, ty: number;
      if (v < 2) { const w = v === 0 ? 1 : -1; road.point(mid - 3, w * 7, P); road.point(mid, w * 120, Q); cy = y + 3.2; ty = y + 1; }
      else if (v === 2) { road.point(mid - 140, -50, P); road.point(mid, 0, Q); cy = y + 45; ty = y; }
      else { road.point(mid - 9, -60, P); road.point(mid, 0, Q); cy = y + 2; ty = y + 2; }
      cam.position.set(P.x, cy, P.z); cam.up.set(0, 1, 0); cam.lookAt(Q.x, ty, Q.z);
      r.setClearColor(SKY); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
