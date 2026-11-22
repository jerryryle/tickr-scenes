// Test scene: Long Day's roadside businesses on the country drive (countryworld.ts: gas
// stations, truck stops, fruit stands, attractions), each with its lot and the drives that take
// it off the road and back on. It seeks a journey into a few of its country drives and, for each
// such piece, holds two views a second each: high and oblique from short of it across the road,
// then straight down on it. Build and render it with
//   make tool SCENE=long-day TOOL=roadside SECS=24   -> build/long-day-roadside/roadside.png
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { CountryWorld } from "../src/countryworld.ts";
import type { CountryRoad, RoadPiece } from "../src/country.ts";

const SEED = 1, MINUTES = [26.3, 59.9, 89.5, 120];   // journey times on its first drives (seed 1)
const KINDS = new Set(["gas", "truckstop", "fruit", "attraction"]);

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, world: CountryWorld;
  const shots: { road: CountryRoad; p: RoadPiece }[] = [];
  const P = { x: 0, z: 0, h: 0, k: 0 }, Q = { x: 0, z: 0, h: 0, k: 0 };
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(46, sys.width / sys.height, 0.5, 1200);
      const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(40, 60, 50);
      scene.add(sun, new THREE.HemisphereLight(0xcfe6ff, 0x4a4030, 2.0));
      const solid = new THREE.MeshLambertMaterial({ vertexColors: true });
      world = new CountryWorld(scene, { ground: solid, solid, lamp: solid }, null);
      world.exact = true;
      const seen = new Set<string>();
      for (const m of MINUTES) {
        const j = new Journey(readConfig({ seed: SEED } as SceneEnv), m * 60, "autumn"), road = j.country;
        if (!road || seen.has(road.key)) continue;
        seen.add(road.key);
        for (const p of road.pieces) if (KINDS.has(p.kind)) shots.push({ road, p });
      }
    },
    render(ctx, f) {
      if (!shots.length) return;
      const k = Math.floor(f.t / 2) % shots.length, top = Math.floor(f.t) % 2 === 1, { road, p } = shots[k];
      const lo = p.kind === "truckstop" ? p.s - 130 : p.s - 40, hi = p.kind === "truckstop" ? p.s + 160 : p.s + p.len + 40, mid = (lo + hi) / 2;
      world.setRoad(road); world.update(0, mid, true, false);
      const y = road.baseAt(mid);
      road.point(mid, p.side * 14, Q);
      if (top) road.point(mid, p.side * 14, P); else road.point(lo - 10, -p.side * 26, P);
      cam.position.set(P.x, y + (top ? (hi - lo) * 0.62 : 30), P.z);
      if (top) cam.up.set(p.side * Math.sin(Q.h), 0, p.side * Math.cos(Q.h)); else cam.up.set(0, 1, 0);   // (top down: the road across the frame, the business above it)
      cam.lookAt(Q.x, y, Q.z);
      r.setClearColor(0x9cc4e8); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
