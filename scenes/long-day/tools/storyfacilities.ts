// This test scene shows the storybook city's trades (facilities.ts, the sb trades) close up, for
// art direction at the board's resolution: each one's building on a lot of its own along a pink
// street, drawn by the function the town draws it with in the district it weighs most (an
// industrial trade's works and a park's pavilion as city.ts lotBuilding draws them, the rest as
// storyLotBuilding does), its front door where that function records it, drawn as the town draws
// one, and its emblem over it (src/city-storybook/storybook-trades.ts). It shows one a second from
// the pavement opposite with its label written in the corner, and last the whole row from further
// off, as the truck's camera sees a street. Build and render it with
//   make tool SCENE=long-day TOOL=storyfacilities SECS=40   -> build/long-day-storyfacilities/storyfacilities.png
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { mulberry32 } from "../src/rng.ts";
import { captureCanvasClass } from "../src/canvas.ts";
import { BAY, makeFacadeMaterial, setFacadeAtlas } from "../src/facade.ts";
import { paintFacadeAtlas } from "../src/facadeart.ts";
import { FAC, isStoryFacility } from "../src/facilities.ts";
import type { FacilityId } from "../src/facilities.ts";
import { STYLE_STORYBOOK } from "../src/city-storybook/storybook-style.ts";
import { SB_STREET, storyKerbDoor, storyLotBuilding, storyPavilion, storyWorks } from "../src/city-storybook/storybook-buildings-town.ts";
import { storyEmblem } from "../src/city-storybook/storybook-trades.ts";

const SF_Y0 = 0.15, SF_LOT = 16, SF_DOOR_H = 2.25;
const TRADES = (Object.keys(FAC) as FacilityId[]).filter(isStoryFacility);
type Shot = { pos: [number, number, number]; at: [number, number, number]; label: string };

export default function createScene({ sys }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera;
  let facadeMat: THREE.MeshLambertMaterial, atlas: { colour: any; mask: any } | null = null;
  const shots: Shot[] = [];
  return {
    setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(40, sys.width / sys.height, 0.3, 1200);
      const sun = new THREE.DirectionalLight(0xfff4e0, 2.3); sun.position.set(-40, 60, -50);
      scene.add(sun, new THREE.HemisphereLight(0xd8f4ff, 0x6a5a70, 1.9));
      facadeMat = makeFacadeMaterial();
      const g = new Batch(), s = new Batch(), W = TRADES.length * SF_LOT;
      g.box(W / 2, -0.05, 20, W + 80, 0.1, 80, STYLE_STORYBOOK.grass);
      g.box(W / 2, 0.0, -12, W + 80, 0.04, 12, SB_STREET.asphalt);
      g.box(W / 2, 0.075, -3, W + 80, 0.15, 6, SB_STREET.sidewalk);
      const C = STYLE_STORYBOOK, looks = { walls: C.walls, roofs: C.roofs, gables: C.gables, maxShopFloors: C.maxShopFloors };
      TRADES.forEach((id, k) => {
        const x0 = k * SF_LOT, mid = x0 + SF_LOT / 2, rnd = mulberry32(31 + k), w = (FAC[id] as { w: Record<string, number> }).w;
        const district = (Object.keys(w) as string[]).reduce((a, b) => (w[b] > w[a] ? b : a));
        g.box(mid, SF_Y0 - 0.01, 8, SF_LOT, 0.02, 16, SB_STREET.pavers);
        const b = { x0: x0 + 1.5, z0: 0.4, x1: x0 + SF_LOT - 1.5, z1: district === "park" ? 5.7 : 13 };
        let door: [number, number] = [mid, 0.4];
        const at = (dx0: number, dx1: number, n: number, painted = false) => { const bays = Math.max(1, Math.round((dx1 - dx0) / BAY)); door = [painted ? dx1 - (dx1 - dx0) * (Math.floor(bays / 2) + 0.5) / bays : bays > 1 ? dx0 + (dx1 - dx0) * Math.round(bays / 2) / bays : (dx0 + dx1) / 2, n]; };
        if (district === "industrial") { at(b.x0, b.x1, b.z0); storyWorks(s, b, SF_Y0, 7, C.walls.industrial, rnd); }
        else if (district === "park") { at(b.x0, b.x1, b.z0); storyPavilion(s, b, door[0], SF_Y0, C.walls.commercial[0], rnd); }
        else storyLotBuilding(s, b, SF_Y0, district, 0.6, looks, rnd, at, { tippy: id === "sbTippyTower" });
        // (The door as the chunk draws one, then the emblem.)
        storyKerbDoor(s, door[0], door[1], SF_Y0, 0.55, SF_DOOR_H, 0x23365e, 0xf2efe8, false);
        storyEmblem(s, id, door[0], door[1], SF_Y0, SF_Y0 + SF_DOOR_H);
        shots.push({ pos: [door[0] - 4.5, 1.8, -8], at: [door[0] + 0.4, 4.8, 0], label: `${id}: ${(FAC[id] as { label: string }).label}` });
      });
      shots.push({ pos: [W * 0.25 - 30, 6, -30], at: [W * 0.25, 4, 0], label: "street" }, { pos: [W * 0.75 - 30, 6, -30], at: [W * 0.75, 4, 0], label: "street" });
      scene.add(g.build(new THREE.MeshLambertMaterial({ vertexColors: true }))!, s.build(facadeMat)!);
    },
    render(ctx, f) {
      captureCanvasClass(ctx);
      if (!atlas) { atlas = paintFacadeAtlas(); setFacadeAtlas(facadeMat, atlas); }
      const sh = shots[Math.floor(f.t) % shots.length];
      cam.position.set(...sh.pos); cam.lookAt(...sh.at); cam.updateProjectionMatrix();
      r.setClearColor(STYLE_STORYBOOK.sky); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
      ctx.fillStyle = "#000000aa"; ctx.fillRect(0, 0, 384, 12); ctx.fillStyle = "#ffffff"; ctx.font = "10px sans-serif"; ctx.fillText(sh.label, 3, 10);
    },
  };
}
