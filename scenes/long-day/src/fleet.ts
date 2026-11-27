// Parked rental trucks, baked into static geometry. Each model is built once as a template Truck
// (never added to the scene) and flattened to one vertex array per material in the truck's own
// frame; a rental lot then merges its stalls into one mesh per material (paint, each livery,
// glass), so a whole lot of trucks costs a handful of draw calls. Lamps, the dashboard screen
// and other unlit details are left out; parked trucks have their lights off anyway.
import * as THREE from "three@0.187.0";
import { SPECS, Truck, TruckKit } from "./truck.ts";
import { HorseTeam, teamLayout } from "./carriage.ts";
import { HORSE_COATS } from "./horse.ts";
import type { TruckModel } from "./truck.ts";
import type { StallPose } from "./city.ts";

interface FleetPart { material: THREE.Material; names: string[]; arrays: Float32Array[]; count: number }

export class FleetBaker {
  private glass: THREE.Material | null = null;   // (this holds the glass every template's trucks are baked with: see flatten)
  constructor(private kit: TruckKit) {}

  build(stalls: StallPose[]): THREE.Object3D | null {
    const groups = new Map<THREE.Material, { part: FleetPart; stalls: StallPose[] }[]>();
    for (const st of stalls)
      for (const part of this.partsFor(st.model, st.toon ?? 0, st.carriage ?? 0, false)) {
        let list = groups.get(part.material);
        if (!list) groups.set(part.material, (list = []));
        const entry = list.find((e) => e.part === part);
        if (entry) entry.stalls.push(st); else list.push({ part, stalls: [st] });
      }
    const root = new THREE.Group();
    for (const [material, list] of groups) {
      // Every part sharing a material has the same attributes (see flatten).
      const names = list[0].part.names;
      let total = 0;
      for (const e of list) total += e.part.count * e.stalls.length;
      const out = names.map((n) => new Float32Array(total * (n === "uv" ? 2 : 3)));
      let v = 0;
      for (const e of list)
        for (const st of e.stalls) {
          const c = Math.cos(st.h), s = Math.sin(st.h);
          names.forEach((n, ai) => {
            const src = e.part.arrays[ai], dst = out[ai];
            if (n === "position") for (let i = 0, o = v * 3; i < src.length; i += 3, o += 3) {
              const x = src[i], z = src[i + 2];
              dst[o] = st.x + x * c + z * s; dst[o + 1] = src[i + 1]; dst[o + 2] = st.z - x * s + z * c;
            } else if (n === "normal") for (let i = 0, o = v * 3; i < src.length; i += 3, o += 3) {
              const x = src[i], z = src[i + 2];
              dst[o] = x * c + z * s; dst[o + 1] = src[i + 1]; dst[o + 2] = -x * s + z * c;
            } else dst.set(src, v * (n === "uv" ? 2 : 3));
          });
          v += e.part.count;
        }
      const g = new THREE.BufferGeometry();
      names.forEach((n, ai) => g.setAttribute(n, new THREE.BufferAttribute(out[ai], n === "uv" ? 2 : 3)));
      g.computeBoundingSphere();
      root.add(new THREE.Mesh(g, material));
    }
    return root.children.length ? root : null;
  }

  // (A stall's `toon` is how cartoonish its truck is, in and near the storybook city (truck.ts
  // toonWarp), and its `carriage` how much it is a carriage, in and near the Victorian city (truck.ts
  // makeCarriage); each is baked in its quarters. A parked carriage stands unhitched, its shafts
  // down; one in traffic is `hitched`, its team drawn live: vehicle.)
  private parts = new Map<string, FleetPart[]>();
  private partsFor(model: TruckModel, toon: number, carriage: number, hitched: boolean): FleetPart[] {
    const q = (k: number) => Math.round(THREE.MathUtils.clamp(k, 0, 1) * 4) / 4, key = `${model}/${q(toon)}/${q(carriage)}/${hitched}`;
    let p = this.parts.get(key);
    if (!p) { const t = new Truck(this.kit, model); t.toon = q(toon); t.carriage = q(carriage); t.hitched = hitched; t.update(0); p = this.flatten(t); this.parts.set(key, p); }
    return p;
  }

  // A Ryder truck in traffic (traffic.ts): baked as a parked one is, and as a carriage, hitched to
  // its team, whose horses are drawn live (userData.team: pose them from how far it has come).
  vehicle(model: TruckModel, toon: number, carriage: number): THREE.Object3D | null {
    if (carriage <= 0) return this.build([{ model, x: 0, z: 0, h: 0, toon }]);
    const parts = this.partsFor(model, toon, carriage, true);
    const g = new THREE.Group();
    for (const part of parts) {
      const geo = new THREE.BufferGeometry();
      part.names.forEach((n, ai) => geo.setAttribute(n, new THREE.BufferAttribute(part.arrays[ai].slice(), n === "uv" ? 2 : 3)));
      geo.computeBoundingSphere();
      g.add(new THREE.Mesh(geo, part.material));
    }
    const L = teamLayout(SPECS[model]), team = new HorseTeam(this.kit.paint, HORSE_COATS[(model.length * 3) % HORSE_COATS.length], L.horses.length);
    g.add(...team.meshes);
    const base = new THREE.Matrix4(), sc = L.scale * carriage;
    g.userData.team = (odo: number, v: number, t: number, seed: number) => {
      L.horses.forEach(([x, z], j) => { base.makeScale(sc, sc, sc).setPosition(x, 0, z); team.pose(j, base, odo / sc + j * 0.4, v / sc, t, seed + j * 0.53); });
      team.commit();
    };
    return g;
  }

  // One vertex array per material, in the truck's frame (origin at the rear axle, x forward).
  private flatten(t: Truck): FleetPart[] {
    t.root.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, { names: string[]; chunks: Float32Array[][]; count: number }>();
    const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
    const keep = (mat: THREE.Material) => mat instanceof THREE.MeshLambertMaterial || (mat instanceof THREE.MeshBasicMaterial && mat.transparent && !mat.map);
    const tint = new THREE.Color();
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, world: THREE.Matrix4, infl: number[] | null = null, inst: THREE.Color | null = null) => {
      // (Every template's glass is the same see-through tint: one material is shared by all, so a lot whose
      // trucks come from different templates, as a country stop's cartoons do, draws its glass at once.)
      if (mat instanceof THREE.MeshBasicMaterial && mat.transparent && !mat.map) mat = this.glass ??= mat;
      const g = geo.index ? geo.toNonIndexed() : geo;
      // (A cartoon's or a carriage's shape and colours come from its morph targets, as far as the truck has each.)
      const morph = (n: string, a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number, k: number) => {
        const ms = (g.morphAttributes as Record<string, THREE.BufferAttribute[] | undefined>)[n];
        let b = a.getComponent(i, k);
        if (infl && ms) for (let j = 0; j < ms.length; j++) if (infl[j]) b += ms[j].getComponent(i, k) * infl[j];   // (the targets are relative)
        return b;
      };
      const names = ["position", "normal", "color", "uv"].filter((n) => g.getAttribute(n));
      if (!names.includes("position") || !names.includes("normal")) return;
      let entry = byMat.get(mat);
      if (!entry) byMat.set(mat, (entry = { names, chunks: names.map(() => []), count: 0 }));
      if (entry.names.some((n) => !g.getAttribute(n))) return;   // a stray part with fewer attributes
      nm.getNormalMatrix(world);
      const count = g.getAttribute("position").count;
      entry.names.forEach((n, ai) => {
        const a = g.getAttribute(n), size = n === "uv" ? 2 : 3, arr = new Float32Array(count * size);
        for (let i = 0; i < count; i++) {
          if (n === "position") { v.set(morph(n, a, i, 0), morph(n, a, i, 1), morph(n, a, i, 2)).applyMatrix4(world); arr.set([v.x, v.y, v.z], i * 3); }
          else if (n === "normal") { v.set(morph(n, a, i, 0), morph(n, a, i, 1), morph(n, a, i, 2)).applyMatrix3(nm).normalize(); arr.set([v.x, v.y, v.z], i * 3); }
          else for (let k = 0; k < size; k++) arr[i * size + k] = morph(n, a, i, k) * (inst && n === "color" ? (k === 0 ? inst.r : k === 1 ? inst.g : inst.b) : 1);   // (an instance's colour makes a cartoon's rims pink)
        }
        entry!.chunks[ai].push(arr);
      });
      entry.count += count;
      if (g !== geo) g.dispose();
    };
    t.root.traverseVisible((o: any) => {
      if (!o.isMesh || Array.isArray(o.material) || !keep(o.material) || o.userData.noBake) return;
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); if (o.instanceColor) o.getColorAt(i, tint); add(o.geometry, o.material, m.premultiply(o.matrixWorld), null, o.instanceColor ? tint : null); }
      } else add(o.geometry, o.material, o.matrixWorld, o.morphTargetInfluences ?? null);
    });
    const out: FleetPart[] = [];
    for (const [material, e] of byMat) {
      const arrays = e.names.map((_, ai) => {
        const parts = e.chunks[ai], len = parts.reduce((s, a) => s + a.length, 0), arr = new Float32Array(len);
        let o = 0; for (const a of parts) { arr.set(a, o); o += a.length; }
        return arr;
      });
      out.push({ material, names: e.names, arrays, count: e.count });
    }
    return out;
  }
}
