// Parked rental trucks, baked into static geometry. Each model is built once as a template Truck
// (never added to the scene) and flattened to one vertex array per material in the truck's own
// frame; a rental lot then merges its stalls into one mesh per material (paint, each livery,
// glass), so a whole lot of trucks costs a handful of draw calls. Lamps, the dashboard screen
// and other unlit details are left out; parked trucks have their lights off anyway.
import * as THREE from "three@0.187.0";
import { Truck, TruckKit } from "./truck.ts";
import type { TruckModel } from "./truck.ts";
import type { StallPose } from "./city.ts";

interface FleetPart { material: THREE.Material; names: string[]; arrays: Float32Array[]; count: number }

export class FleetBaker {
  constructor(private kit: TruckKit) {}

  build(stalls: StallPose[]): THREE.Object3D | null {
    const groups = new Map<THREE.Material, { part: FleetPart; stalls: StallPose[] }[]>();
    for (const st of stalls)
      for (const part of this.partsFor(st.model, st.toon ?? 0)) {
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

  // (A stall's `toon`: how cartoonish its truck is, in and near the storybook city (truck.ts
  // toonWarp), baked in its quarters.)
  private parts = new Map<string, FleetPart[]>();
  private partsFor(model: TruckModel, toon: number): FleetPart[] {
    const q = Math.round(THREE.MathUtils.clamp(toon, 0, 1) * 4) / 4, key = `${model}/${q}`;
    let p = this.parts.get(key);
    if (!p) { const t = new Truck(this.kit, model); t.toon = q; t.update(0); p = this.flatten(t); this.parts.set(key, p); }
    return p;
  }

  // One vertex array per material, in the truck's frame (origin at the rear axle, x forward).
  private flatten(t: Truck): FleetPart[] {
    t.root.updateMatrixWorld(true);
    const byMat = new Map<THREE.Material, { names: string[]; chunks: Float32Array[][]; count: number }>();
    const m = new THREE.Matrix4(), nm = new THREE.Matrix3(), v = new THREE.Vector3();
    const keep = (mat: THREE.Material) => mat instanceof THREE.MeshLambertMaterial || (mat instanceof THREE.MeshBasicMaterial && mat.transparent && !mat.map);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, world: THREE.Matrix4, toon = 0) => {
      const g = geo.index ? geo.toNonIndexed() : geo;
      // (A cartoon's shape and colours: its morph target, as far as the truck has it.)
      const morph = (n: string, a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, i: number, k: number) => {
        const m = toon > 0 ? (g.morphAttributes as Record<string, THREE.BufferAttribute[] | undefined>)[n]?.[0] : undefined, b = a.getComponent(i, k);
        return m ? b + m.getComponent(i, k) * toon : b;   // (relative targets)
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
          else for (let k = 0; k < size; k++) arr[i * size + k] = morph(n, a, i, k);
        }
        entry!.chunks[ai].push(arr);
      });
      entry.count += count;
      if (g !== geo) g.dispose();
    };
    t.root.traverseVisible((o: any) => {
      if (!o.isMesh || Array.isArray(o.material) || !keep(o.material)) return;
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); add(o.geometry, o.material, m.premultiply(o.matrixWorld)); }
      } else add(o.geometry, o.material, o.matrixWorld, o.morphTargetInfluences?.[0] ?? 0);
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
