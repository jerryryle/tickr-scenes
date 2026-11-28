// What stands between the camera and what it films, for the camera director (director.ts): a coarse
// height map of everything tall in the streamed world (buildings, trees, poles, parked trucks,
// the country road's scenery), in 2 m cells, kept per chunk or road segment as they are built.
// A line of sight is sampled against it, so a shot can be chosen (and nudged) to see the driver
// and the truck without the see-through spotlight (cutaway.ts) having to cut through much.
import * as THREE from "three@0.187.0";

const HF_CELL = 2;
const HF_TILE = 60;                // lookup tiles
const HF_MIN_Y = 0.9;              // lower things (kerbs, sidewalks, low walls) never block a view
interface HeightField { x0: number; z0: number; nx: number; nz: number; h: Float32Array; tiles: number[]; tag: string }
// A truck or other solid box that moves (checked as an oriented box).
export interface OccluderBox { x: number; z: number; h: number; ax0: number; ax1: number; hw: number; top: number }

class OcclusionMap {
  private byTile = new Map<number, HeightField[]>();
  private tileKey(tx: number, tz: number) { return (tx + 32768) * 65536 + (tz + 32768); }

  // Map the tall parts of `obj` (its meshes, except in `skip` materials) once it is placed at (ox, oz).
  add(obj: THREE.Object3D, ox: number, oz: number, skip: THREE.Material[], tag = ""): HeightField | null {
    obj.updateMatrixWorld(true);
    const tris: number[] = [];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const m = new THREE.Matrix4(), inv = new THREE.Matrix4().copy(obj.matrixWorld).invert(), v = new THREE.Vector3();
    obj.traverse((o: any) => {
      if (!o.isMesh || o.isInstancedMesh || skip.includes(o.material)) return;
      const pos = o.geometry?.attributes?.position;
      if (!pos || o.geometry.index) return;
      m.multiplyMatrices(inv, o.matrixWorld);   // in obj's own frame
      const ident = m.equals(IDENT4), a = pos.array as Float32Array;
      for (let i = 0; i + 8 < pos.count * 3; i += 9) {
        let ty0 = Infinity, ty1 = -Infinity, tx0 = Infinity, tx1 = -Infinity, tz0 = Infinity, tz1 = -Infinity;
        for (let k = 0; k < 9; k += 3) {
          let x = a[i + k], y = a[i + k + 1], z = a[i + k + 2];
          if (!ident) { v.set(x, y, z).applyMatrix4(m); x = v.x; y = v.y; z = v.z; }
          if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (z < tz0) tz0 = z; if (z > tz1) tz1 = z;
        }
        if (ty1 < HF_MIN_Y || tx1 - tx0 > 80 || tz1 - tz0 > 80) continue;
        tris.push(tx0 + ox, tz0 + oz, tx1 + ox, tz1 + oz, ty1);
        if (tx0 + ox < x0) x0 = tx0 + ox; if (tz0 + oz < z0) z0 = tz0 + oz; if (tx1 + ox > x1) x1 = tx1 + ox; if (tz1 + oz > z1) z1 = tz1 + oz;
      }
    });
    if (!tris.length) return null;
    x0 = Math.floor(x0 / HF_CELL) * HF_CELL; z0 = Math.floor(z0 / HF_CELL) * HF_CELL;
    const nx = Math.ceil((x1 - x0) / HF_CELL) + 1, nz = Math.ceil((z1 - z0) / HF_CELL) + 1;
    if (nx * nz > 40000) return null;
    const h = new Float32Array(nx * nz);
    for (let i = 0; i < tris.length; i += 5) {
      const i0 = Math.floor((tris[i] - x0) / HF_CELL), i1 = Math.floor((tris[i + 2] - x0) / HF_CELL);
      const k0 = Math.floor((tris[i + 1] - z0) / HF_CELL), k1 = Math.floor((tris[i + 3] - z0) / HF_CELL), top = tris[i + 4];
      for (let k = k0; k <= k1; k++) for (let j = i0; j <= i1; j++) { const c = k * nx + j; if (top > h[c]) h[c] = top; }
    }
    const f: HeightField = { x0, z0, nx, nz, h, tiles: [], tag };
    this.place(f);
    return f;
  }
  private place(f: HeightField) {
    const tx0 = Math.floor(f.x0 / HF_TILE), tz0 = Math.floor(f.z0 / HF_TILE);
    const tx1 = Math.floor((f.x0 + f.nx * HF_CELL) / HF_TILE), tz1 = Math.floor((f.z0 + f.nz * HF_CELL) / HF_TILE);
    for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = this.tileKey(tx, tz);
      let l = this.byTile.get(key);
      if (!l) this.byTile.set(key, (l = []));
      l.push(f); f.tiles.push(key);
    }
  }
  remove(f: HeightField | null | undefined) {
    if (!f) return;
    for (const key of f.tiles) { const l = this.byTile.get(key); if (l) { const i = l.indexOf(f); if (i >= 0) l.splice(i, 1); if (!l.length) this.byTile.delete(key); } }
    f.tiles = [];
  }
  // Put back a field taken out with remove() (a chunk back from ChunkStreamer's cache).
  restore(f: HeightField | null | undefined) { if (f && !f.tiles.length) this.place(f); }
  // Move the fields tagged `tag` by (dx, dz) (the road's scenery when the world is rebased).
  shift(tag: string, dx: number, dz: number) {
    const fs = new Set<HeightField>();
    for (const l of this.byTile.values()) for (const f of l) if (f.tag === tag) fs.add(f);
    for (const f of fs) { this.remove(f); f.x0 += dx; f.z0 += dz; this.place(f); }
  }
  clear(tag?: string) { if (tag === undefined) { this.byTile.clear(); return; } for (const l of [...this.byTile.values()]) for (const f of [...l]) if (f.tag === tag) this.remove(f); }

  heightAt(x: number, z: number): number {
    const l = this.byTile.get(this.tileKey(Math.floor(x / HF_TILE), Math.floor(z / HF_TILE)));
    if (!l) return 0;
    let best = 0;
    for (const f of l) {
      const j = Math.floor((x - f.x0) / HF_CELL), k = Math.floor((z - f.z0) / HF_CELL);
      if (j < 0 || k < 0 || j >= f.nx || k >= f.nz) continue;
      const hh = f.h[k * f.nx + j];
      if (hh > best) best = hh;
    }
    return best;
  }

  // Roughly how far `p` is from the nearest mapped tall thing (each sample a column from the
  // ground to its height), up to `r`: a camera kept this clear has no wall or tree crown against
  // its lens.
  clearance(p: THREE.Vector3, r: number): number {
    let best = r;
    for (let x = Math.floor(p.x - r); x <= Math.ceil(p.x + r); x++) for (let z = Math.floor(p.z - r); z <= Math.ceil(p.z + r); z++) {
      const h = this.heightAt(x + 0.5, z + 0.5);
      if (h < HF_MIN_Y) continue;
      const dh = Math.max(0, Math.hypot(p.x - x - 0.5, p.z - z - 0.5) - 0.5), dy = Math.max(0, p.y - h);
      best = Math.min(best, Math.hypot(dh, dy));
    }
    return best;
  }

  // How much of the line from `a` to `b` is hidden (0 clear .. 1 hidden all along), ignoring the
  // last `skipEnd` metres (what is filmed stands there) and `skipStart` at the camera.
  blocked(a: THREE.Vector3, b: THREE.Vector3, boxes: OccluderBox[] = [], skipEnd = 0.7, skipStart = 0.5): number {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz);
    if (L < skipEnd + skipStart + 0.5) return 0;
    const step = Math.max(0.8, L / 120);
    let n = 0, hit = 0;
    for (let s = skipStart; s < L - skipEnd; s += step) {
      const u = s / L, x = a.x + dx * u, y = a.y + dy * u, z = a.z + dz * u;
      n++;
      if (this.heightAt(x, z) > y) { hit++; continue; }
      for (const o of boxes) {
        if (y > o.top) continue;
        const rx = x - o.x, rz = z - o.z, fx = Math.cos(o.h), fz = -Math.sin(o.h);
        const al = rx * fx + rz * fz, ac = rx * fz - rz * fx;
        if (al > o.ax0 && al < o.ax1 && Math.abs(ac) < o.hw) { hit++; break; }
      }
    }
    return n ? Math.min(1, hit * step / 6) : 0;   // six metres of obstruction counts as fully hidden
  }
}
const IDENT4 = new THREE.Matrix4();
export const OCCLUSION = new OcclusionMap();
