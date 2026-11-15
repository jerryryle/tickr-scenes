// Scene: vehicles on a turntable, for look development. Render build/long-day-garage.
import * as THREE from "three@0.187.0";
import { uploadable } from "../src/canvas.ts";
import { Batch } from "../src/geom.ts";
import { Engine } from "../src/engine.ts";
import { PuffSystem } from "../src/puffs.ts";
import { LIVERY_ASSETS, Truck, truckExtents, TruckKit } from "../src/truck.ts";
import type { LiveryName, TruckModel } from "../src/truck.ts";
import { carBody, HATCH, pickupBody, SEDAN, SUV, vanBody } from "../src/traffic.ts";

const GARAGE_TRUCKS: TruckModel[] = [];
export default function createScene({ sys, assets }: SceneInputs): Scene {
  let engine: Engine;
  const items: { m: THREE.Object3D; fx: number; d: number }[] = [];
  return {
    async setup() {
      engine = new Engine(sys);
      const g = new Batch(); for (let x = -200; x < 200; x += 20) for (let z = -100; z < 400; z += 20) g.box(x, -0.05, z, 20, 0.1, 20, 0x5a5b60);
      const gm = g.build(engine.mats.ground)!; engine.scene.add(gm);
      const images = {} as Record<LiveryName, CanvasImageSource>;
      for (const n of LIVERY_ASSETS) images[n] = uploadable(await assets[n].loadImage());
      const kit = new TruckKit(images), puffs = new PuffSystem(engine.scene);
      const cars: [(b: Batch) => void, number][] = [[(b) => carBody(b, 4.6, 1.8, 1.45, SEDAN, 0xc0392b), 0], [(b) => carBody(b, 4.0, 1.75, 1.5, HATCH, 0x2e6fb2), 0], [(b) => carBody(b, 4.8, 1.95, 1.8, SUV, 0x8a9aa6), 0], [(b) => { pickupBody(b); }, 0], [(b) => { vanBody(b); }, 0]];
      cars.forEach(([f], k) => { const b = new Batch(); f(b); const m = b.build(engine.mats.ground)!; m.position.set(k * 12, 0, -40); engine.scene.add(m); items.push({ m, fx: 0, d: 6.5 }); });
      GARAGE_TRUCKS.forEach((model, k) => {
        const t = new Truck(kit, model, puffs); engine.scene.add(t.root);
        t.follow(0, k * 60, 0, 0, 0); t.update(0);
        items.push({ m: t.root, fx: truckExtents(model).front - 2.2, d: 8 });
      });
      engine.fog.near = 300; engine.fog.far = 400;
    },
    render(ctx, { t }) {
      const i = Math.min(items.length - 1, Math.floor(t / 4)), a = (t % 4) * 0.55 - 0.2, it = items[i];
      const cx = it.m.position.x + it.fx, cz = it.m.position.z;
      engine.camera.position.set(cx + Math.cos(a) * it.d, it.d < 7 ? 2.2 : 3.2, cz + Math.sin(a) * it.d);
      engine.camera.lookAt(cx, it.d < 7 ? 0.8 : 1.6, cz);
      engine.followSun(it.m.position);
      engine.draw(ctx);
    },
  };
}
