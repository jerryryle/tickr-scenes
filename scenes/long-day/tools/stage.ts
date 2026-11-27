// Test scene: one stop staged on its own (src/stage.ts), the crew working it at the kerb by a
// building's door, filmed from a fixed camera, to see the chores quickly without a journey round
// them. Build and render it (and a clip of it) with
//   make stage [STAGE="box26 boxes drop"] [VIEW=quarter] [FROM=0] [SECS=12] [SPEED=1]
//     -> build/long-day-stage/stage.mp4
// STAGE: model cargo kind [nodoor | door=x (the door's middle along the truck)] [vic (in the
// Victorian city: the truck a carriage, the street of setts and stone, truck.ts makeCarriage)]; VIEW: quarter (from behind, by the street), side (along the
// truck's kerb side), rear (straight behind), top (straight down), corner (fixed on its back from the street side), into (fixed, in through its back), climb (fixed, side on to its back, close); FROM: seconds into the stop.
import * as THREE from "three@0.187.0";
import { Batch } from "../src/geom.ts";
import { Crew } from "../src/crew.ts";
import { SPECS, Truck, TruckKit, LIVERY_ASSETS, truckLayout } from "../src/truck.ts";
import type { LiveryName, TruckModel } from "../src/truck.ts";
import { CURB_H } from "../src/grid.ts";
import { makeStage, stageSpec } from "../src/stage.ts";
import { uploadable } from "../src/canvas.ts";
import { FrontDoorFx } from "../src/dockfx.ts";

const STAGE_SPEC: string = "box26 boxes drop";
const STAGE_VIEW: string = "quarter";
const STAGE_FROM: number = 0;
const STAGE_SPEED: number = 1;

export default function createScene({ sys, assets }: SceneInputs): Scene {
  let r: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.PerspectiveCamera, crew: Crew, truck: Truck;
  let door: FrontDoorFx | null = null, shut: THREE.Mesh | null = null;
  const words = STAGE_SPEC.split(/\s+/), vic = words.includes("vic");
  const spec = { ...stageSpec(words.filter((w) => w !== "vic")), victorian: vic }, S = makeStage(spec), model = spec.model;
  // (The street's, the pavement's and the building's colours: the Victorian city's setts, flags and brick.)
  const STREET = vic ? 0x5c5852 : 0x34363a, PAVE = vic ? 0x8f897c : 0x9a9890, WALL = vic ? 0x8a4632 : 0x7a5040;
  let last = -1;
  return {
    async setup() {
      const gl = sys.gl({ antialias: true });
      r = new THREE.WebGLRenderer({ canvas: gl.canvas as any, context: gl }); r.setSize(sys.width, sys.height, false);
      scene = new THREE.Scene(); cam = new THREE.PerspectiveCamera(40, sys.width / sys.height, 0.2, 300);
      const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(-30, 50, -20);
      scene.add(sun, new THREE.HemisphereLight(0xcfe6ff, 0x4a4030, 1.8));
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      // The street, the pavement up its kerb, and the building's front with its doorway into a dark
      // room (the driver turns round in there, out of sight).
      const b = new Batch(), W = S.wallZ, d = S.kerbDoor;
      b.box(0, -0.05, 0, 80, 0.1, 30, STREET);
      b.box(0, CURB_H / 2, (S.kerbZ + W + 8) / 2, 80, CURB_H, W + 8 - S.kerbZ, PAVE);
      const x0 = -40, x1 = 40, dx0 = d ? d.x - d.half : 0, dx1 = d ? d.x + d.half : 0, H = 6, T = 6;
      if (d) {
        b.box((x0 + dx0) / 2, H / 2, W + T / 2, dx0 - x0, H, T, WALL);
        b.box((dx1 + x1) / 2, H / 2, W + T / 2, x1 - dx1, H, T, WALL);
        b.box(d.x, (d.h + H) / 2, W + 0.15, 2 * d.half, H - d.h, 0.3, WALL);
        // (The room: a floor at the pavement's height, its walls and ceiling dark.)
        // (Deep enough for a line of goats led in behind the driver: chores.ts flipIn.)
        b.box(d.x, d.h + 0.05, W + 4.5, 2 * d.half + 6, 0.1, 9, 0x111111);
        b.box(d.x, CURB_H, W + 4.5, 2 * d.half + 6, 0.02, 9, 0x222222);
        for (const s of [-1, 1]) b.box(d.x + s * (d.half + 3), H / 2, W + 4.5, 0.1, H, 9, 0x111111);
        b.box(d.x, H / 2, W + 8.95, 2 * d.half + 6, H, 0.1, 0x111111);
      } else b.box(0, H / 2, W + T / 2, 80, H, T, WALL);
      scene.add(b.build(mat)!);
      const images = {} as Record<LiveryName, CanvasImageSource>;
      const imgs = await Promise.all(LIVERY_ASSETS.map((n) => (assets as any)[n].loadImage()));
      LIVERY_ASSETS.forEach((n, i) => { images[n] = uploadable(imgs[i]); });
      truck = new Truck(new TruckKit(images), model, null); scene.add(truck.root);
      if (vic) truck.carriage = 1;
      truck.follow(0, 0, 0, 0, 0);
      crew = new Crew(scene, new THREE.MeshLambertMaterial({ vertexColors: true }));
      // (The front door: swung open as the journey has it (FrontDoorFx), and shut, its panel.)
      if (d) {
        door = new FrontDoorFx(scene);
        shut = new THREE.Mesh(new THREE.BoxGeometry(2 * d.half, d.h, 0.06), new THREE.MeshLambertMaterial({ color: d.panel }));
        shut.position.set(d.x, CURB_H + d.h / 2, W - 0.02); scene.add(shut);
      }
    },
    render(ctx, f) {
      const t = STAGE_FROM + f.t * STAGE_SPEED, dt = last < 0 ? 0 : Math.max(0, t - last);
      last = t;
      S.setTime(Math.min(t, S.length));
      crew.update(dt, S.journey, truck, null, cam);
      truck.update(dt);
      if (door && shut) { door.update(S.journey, crew.workerRoot); shut.visible = !door.shown; }
      // The camera: on the action, the driver, held level.
      const p = crew.driver.root.getWorldPosition(new THREE.Vector3());
      // (Along the truck no further back than a little behind its tail: a trailer's is 15 m back.)
      const R = truckLayout(model).bedRear, fx = THREE.MathUtils.clamp(p.x, Math.min(-12, R - 4), 4), fz = THREE.MathUtils.clamp(p.z, -1, S.wallZ);
      if (STAGE_VIEW === "top") { cam.position.set(fx, 16, fz + 0.01); cam.lookAt(fx, 0, fz); cam.fov = 40; }
      else if (STAGE_VIEW === "side") { cam.position.set(fx - 7, 2.2, S.kerbZ + 1.2); cam.lookAt(fx, 1.0, fz); cam.fov = 48; }
      else if (STAGE_VIEW === "rear") { cam.position.set(R - 9, 3.2, 1.5); cam.lookAt(fx, 1.0, fz); cam.fov = 34; }
      else if (STAGE_VIEW === "cab") { const xf = SPECS[model].cabFront; cam.position.set(xf + 0.6, 2.4, -4.6); cam.lookAt(xf - 0.2, 1.4, -0.6); cam.fov = 40; }   // (fixed, on the cab and the team from the street side)
      else if (STAGE_VIEW === "climb") { cam.position.set(R - 0.2, 1.3, -6.0); cam.lookAt(R - 0.2, 1.1, -0.35); cam.fov = 22; }   // (fixed, side on to its back, close: climbing in)
      else if (STAGE_VIEW === "into") { cam.position.set(R - 3.6, 3.4, -0.6); cam.lookAt(R + 3.5, 1.2, 0.1); cam.fov = 58; }   // (fixed, in through its back)
      else if (STAGE_VIEW === "corner") { cam.position.set(R - 4.6, 3.0, -4.2); cam.lookAt(R + 0.4, 1.3, 0); cam.fov = 50; }   // (fixed, on the back of the truck from the street side)
      else { cam.position.set(fx - 7.5, 3.4, -5.5); cam.lookAt(fx, 1.0, fz); cam.fov = 40; }
      cam.updateProjectionMatrix();
      r.setClearColor(0x7aa7d9); r.render(scene, cam); ctx.drawImage(r.domElement as any, 0, 0);
    },
  };
}
