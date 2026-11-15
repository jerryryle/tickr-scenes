// Streams square world chunks around a focus point. A builder returns a chunk's content in
// chunk-local coordinates (origin at the chunk's min corner); the streamer positions it, which
// keeps vertex coordinates small for float32 precision however far the journey runs (three.js
// composes object and camera matrices in float64 on the CPU).
// Chunks within `radius` are built, nearest first, at most `budget` per frame; chunks beyond
// `radius + 1` are disposed (hysteresis). The wanted set is only recomputed when the focus
// crosses into a new chunk. Chunk keys are numbers, so steady frames allocate nothing; they
// cover ±2^25 chunks per axis (over a million km at 40 m chunks).
// A builder may also be a generator that yields between stages of the work: the streamer then
// spreads one chunk over several frames, within a time budget per frame.
import * as THREE from "three@0.187.0";

export type ChunkBuild = Generator<void, THREE.Object3D | null, void>;
type ChunkBuilder = (cx: number, cz: number) => THREE.Object3D | null | ChunkBuild;
const isChunkBuild = (v: unknown): v is ChunkBuild => !!v && typeof (v as any).next === "function" && typeof (v as any)[Symbol.iterator] === "function";
interface Chunk { cx: number; cz: number; obj: THREE.Object3D }
const CHUNK_KEY_OFFSET = 2 ** 25, CHUNK_KEY_SPAN = 2 ** 26;
function chunkKey(cx: number, cz: number) { return (cx + CHUNK_KEY_OFFSET) * CHUNK_KEY_SPAN + (cz + CHUNK_KEY_OFFSET); }

export class ChunkStreamer {
  readonly chunks = new Map<number, Chunk>();
  built = 0; disposed = 0;
  lastBuildMs = 0; maxBuildMs = 0;
  private queue: [number, number][] = [];
  private fx = NaN; private fz = NaN;
  constructor(
    private parent: THREE.Object3D,
    readonly size: number,
    private build: ChunkBuilder,
    public radius = 3,
    public budget = 2,
    private voidCell: ((cx: number, cz: number) => boolean) | null = null,   // cells that are always empty (they never limit the view)
  ) {}

  // Build everything in range at once (for setup, before the first frame).
  fill(focus: THREE.Vector3) {
    const b = this.budget, ms = this.frameMs;
    this.budget = Infinity; this.frameMs = Infinity; this.update(focus); this.budget = b; this.frameMs = ms;
  }
  // Each frame builds for about this long (at least one stage of one chunk), and when nothing in
  // range is left to build, builds ahead: the next ring out on the side `ahead` points to.
  frameMs = 3;
  private job: { cx: number; cz: number; gen: ChunkBuild; ms: number } | null = null;
  get pending() { return this.queue.length + (this.job ? 1 : 0); }

  update(focus: THREE.Vector3, ahead: { x: number; z: number } | null = null) {
    const fx = Math.floor(focus.x / this.size), fz = Math.floor(focus.z / this.size);
    if (fx !== this.fx || fz !== this.fz) {
      this.fx = fx; this.fz = fz;
      for (const [key, c] of this.chunks)
        if (Math.max(Math.abs(c.cx - fx), Math.abs(c.cz - fz)) > this.radius + 1) {
          this.parent.remove(c.obj); disposeTree(c.obj); this.chunks.delete(key); this.disposed++;
        }
      this.queue.length = 0;
      for (let dz = -this.radius; dz <= this.radius; dz++)
        for (let dx = -this.radius; dx <= this.radius; dx++)
          if (!this.chunks.has(chunkKey(fx + dx, fz + dz))) this.queue.push([fx + dx, fz + dz]);
      this.queue.sort((a, b) => ((a[0] - fx) ** 2 + (a[1] - fz) ** 2) - ((b[0] - fx) ** 2 + (b[1] - fz) ** 2));
    }
    const start = performance.now();
    let started = 0;
    for (;;) {
      if (!this.job) {
        if (started >= this.budget) break;
        const next = this.queue.shift() ?? (ahead ? this.aheadCell(ahead) : null);
        if (!next) break;
        if (this.chunks.has(chunkKey(next[0], next[1]))) continue;
        const t0 = performance.now(), r = this.build(next[0], next[1]);
        started++;
        if (isChunkBuild(r)) this.job = { cx: next[0], cz: next[1], gen: r, ms: performance.now() - t0 };
        else { this.place(next[0], next[1], r, performance.now() - t0); }
      }
      if (this.job) {
        const j = this.job, t0 = performance.now();
        const r = j.gen.next();
        j.ms += performance.now() - t0;
        if (r.done) { this.job = null; this.place(j.cx, j.cz, r.value, j.ms); }
      }
      if (performance.now() - start >= this.frameMs) break;
    }
  }
  private place(cx: number, cz: number, obj: THREE.Object3D | null, ms: number) {
    const o = obj ?? new THREE.Group();
    this.lastBuildMs = ms; this.maxBuildMs = Math.max(this.maxBuildMs, ms);
    o.position.set(cx * this.size, 0, cz * this.size);
    this.parent.add(o); this.chunks.set(chunkKey(cx, cz), { cx, cz, obj: o }); this.built++;
  }
  // The nearest unbuilt cell of the ring just outside the radius (kept, not disposed) on the side
  // the truck is heading, so the next row in is mostly built before it is needed.
  private aheadCell(ahead: { x: number; z: number }): [number, number] | null {
    const r = this.radius + 1, al = Math.hypot(ahead.x, ahead.z) || 1, ax = ahead.x / al, az = ahead.z / al;
    let best: [number, number] | null = null, bestD = Infinity;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const len = Math.hypot(dx, dz);
      if ((dx * ax + dz * az) / len < 0.5) continue;
      const cx = this.fx + dx, cz = this.fz + dz;
      if (this.chunks.has(chunkKey(cx, cz)) || this.voidCell?.(cx, cz) || (this.job && this.job.cx === cx && this.job.cz === cz)) continue;
      const d = len - (dx * ax + dz * az) * 0.5;
      if (d < bestD) { bestD = d; best = [cx, cz]; }
    }
    return best;
  }

  // Horizontal distance from (px, pz) to the nearest chunk cell that is not built: where the
  // world ends right now, counting chunks still queued. Exact for any point inside the built
  // area, because every cell in the ring at radius + 2 is unbuilt (disposed or never built).
  clearDistance(px: number, pz: number): number {
    if (Number.isNaN(this.fx)) return 0;
    const S = this.size, r = this.radius + 2;
    let best = Infinity;
    for (let cz = this.fz - r; cz <= this.fz + r; cz++)
      for (let cx = this.fx - r; cx <= this.fx + r; cx++) {
        if (this.chunks.has(chunkKey(cx, cz)) || this.voidCell?.(cx, cz)) continue;
        const dx = Math.max(cx * S - px, 0, px - (cx + 1) * S);
        const dz = Math.max(cz * S - pz, 0, pz - (cz + 1) * S);
        const d = Math.hypot(dx, dz);
        if (d < best) best = d;
      }
    return best;
  }

  // A new radius: the wanted set is worked out again on the next update.
  setRadius(r: number) { if (r !== this.radius) { this.radius = r; this.fx = this.fz = NaN; } }

  clear() {
    if (this.job) {   // (finished, so whatever it holds is released)
      let r = this.job.gen.next();
      while (!r.done) r = this.job.gen.next();
      if (r.value) disposeTree(r.value);
      this.job = null;
    }
    for (const c of this.chunks.values()) { this.parent.remove(c.obj); disposeTree(c.obj); }
    this.chunks.clear(); this.queue.length = 0; this.fx = this.fz = NaN;
  }
}

// Dispose geometries owned by a subtree. Materials and textures are shared from libraries,
// so they are only disposed when flagged with userData.owned. A root may carry an onDispose hook.
export function disposeTree(root: THREE.Object3D) {
  root.userData.onDispose?.();   // e.g. a chunk handing back its sign slot
  root.traverse((o: any) => {
    if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (m.userData?.owned) { m.map?.dispose(); m.dispose(); }
  });
}
