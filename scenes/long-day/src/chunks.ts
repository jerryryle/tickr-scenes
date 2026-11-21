// Streams square world chunks around a focus point. A builder returns a chunk's content in
// chunk-local coordinates (origin at the chunk's min corner); the streamer positions it, which
// keeps vertex coordinates small for float32 precision however far the journey runs (three.js
// composes object and camera matrices in float64 on the CPU).
// Chunks within `radius` are built, nearest first, at most `budget` per frame; chunks beyond
// `radius + 1` leave the scene (hysteresis). The wanted set is only recomputed when the focus
// crosses into a new chunk. Chunk keys are numbers, so steady frames allocate nothing; they
// cover ±2^25 chunks per axis (over a million km at 40 m chunks).
// A builder may also be a generator that yields between stages of the work: the streamer then
// spreads one chunk over several frames, within a time budget per frame.
//
// Cache (cacheLimit > 0): a chunk that leaves the scene is kept, detached, instead of disposed,
// up to cacheLimit bytes of geometry, oldest dropped first; one wanted again comes straight back
// (builders are pure functions of the cell, so a kept chunk is the one a rebuild would make). A
// chunk's root may carry onStash / onRestore hooks for what it registers outside the scene graph
// (lamp sites, the occlusion map); `keepCached` says when something else is running short (sign
// atlas slots a kept chunk holds on to) and the cache sheds its oldest.
// Exact (for a timeline that scrubs): what is in the scene is a pure function of the focus cell,
// whatever came before: exactly the cells within `radius` (no hysteresis), all built before
// update returns, nothing built ahead into the scene (into the cache instead). Costs a hitch
// whenever the focus crosses into a new cell and something in range is not cached.
// Prefetch (setPrefetch): cells the caller expects to want soon (the cells round the truck's
// route) are built in frames with nothing in range left to build, straight into the cache.
import * as THREE from "three@0.187.0";

export type ChunkBuild = Generator<void, THREE.Object3D | null, void>;
type ChunkBuilder = (cx: number, cz: number) => THREE.Object3D | null | ChunkBuild;
const isChunkBuild = (v: unknown): v is ChunkBuild => !!v && typeof (v as any).next === "function" && typeof (v as any)[Symbol.iterator] === "function";
interface Chunk { cx: number; cz: number; obj: THREE.Object3D; bytes: number }
const CHUNK_KEY_OFFSET = 2 ** 25, CHUNK_KEY_SPAN = 2 ** 26;
export function chunkKey(cx: number, cz: number) { return (cx + CHUNK_KEY_OFFSET) * CHUNK_KEY_SPAN + (cz + CHUNK_KEY_OFFSET); }

// Bytes of vertex and index data a subtree owns (shared geometry not counted).
function geometryBytes(root: THREE.Object3D): number {
  let n = 0;
  root.traverse((o: any) => {
    const g = o.geometry; if (!g || g.userData?.shared) return;
    for (const a of Object.values(g.attributes) as any[]) n += a?.array?.byteLength ?? 0;
    n += g.index?.array?.byteLength ?? 0;
  });
  return n;
}

const CAM_KEEP = 1;   // cells either way of the camera's own kept and built, wherever it is (setCamera)
export class ChunkStreamer {
  readonly chunks = new Map<number, Chunk>();
  readonly cache = new Map<number, Chunk>();   // detached chunks, oldest first
  built = 0; disposed = 0; restored = 0; prefetched = 0;
  lastBuildMs = 0; maxBuildMs = 0;
  cacheBytes = 0;
  cacheLimit = 0;                               // bytes of geometry kept out of the scene (0: none)
  keepCached: () => boolean = () => true;       // false: shed cached chunks (something they hold runs short)
  exact = false;                                // see above
  private queue: [number, number][] = [];
  private fx = NaN; private fz = NaN;
  private prefetchList: [number, number][] = [];
  private prefetchKeys = new Set<number>();
  private prefetchAt = 0;
  private filling = false;
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
    this.budget = Infinity; this.frameMs = Infinity; this.filling = true;
    try { this.update(focus); } finally { this.budget = b; this.frameMs = ms; this.filling = false; }
  }
  // Each frame builds for about this long (at least one stage of one chunk), and when nothing in
  // range is left to build, builds ahead: prefetched cells, then the next ring out on the side
  // `ahead` points to.
  frameMs = 3;
  // (Behind: with cells in range still unbuilt, round the camera, each frame builds for up to this
  // long instead, so a board slow to draw catches up before the fog has to close in on the gap.)
  behindMs = 8;
  private job: { cx: number; cz: number; gen: ChunkBuild; ms: number } | null = null;
  get pending() { return this.queue.length + (this.job ? 1 : 0); }
  get prefetchPending() { return this.prefetchList.length - this.prefetchAt; }

  // The cells to build ahead of need, most urgent first (replaces the previous list).
  setPrefetch(cells: [number, number][]) {
    this.prefetchList = cells; this.prefetchAt = 0;
    this.prefetchKeys.clear();
    for (const [cx, cz] of cells) this.prefetchKeys.add(chunkKey(cx, cz));
  }

  // The camera's cell (setCamera): the cells round it are kept and built too, first, wherever it
  // is: a wide or high shot, or one swinging round as the truck turns, can put it blocks from the
  // truck, past what is streamed round the truck, where the fog would have to close right in.
  private cx0 = NaN; private cz0 = NaN;
  setCamera(x: number, z: number) { this.camX = Math.floor(x / this.size); this.camZ = Math.floor(z / this.size); }
  private camX = NaN; private camZ = NaN;
  private nearCam(cx: number, cz: number) { return Math.max(Math.abs(cx - this.camX), Math.abs(cz - this.camZ)) <= CAM_KEEP; }

  update(focus: THREE.Vector3, ahead: { x: number; z: number } | null = null) {
    const fx = Math.floor(focus.x / this.size), fz = Math.floor(focus.z / this.size);
    if (fx !== this.fx || fz !== this.fz || this.dirty || this.camX !== this.cx0 || this.camZ !== this.cz0) {
      this.fx = fx; this.fz = fz; this.cx0 = this.camX; this.cz0 = this.camZ; this.dirty = false;
      for (const [key, c] of this.chunks) if (!this.near(c.cx, c.cz)) this.retire(key, c);
      this.queue.length = 0;
      const want = (cx: number, cz: number) => {
        const key = chunkKey(cx, cz);
        if (this.chunks.has(key) || this.queue.some((q) => q[0] === cx && q[1] === cz)) return;
        if (this.cache.has(key)) this.restore(key);
        else this.queue.push([cx, cz]);
      };
      if (!Number.isNaN(this.camX)) for (let dz = -CAM_KEEP; dz <= CAM_KEEP; dz++) for (let dx = -CAM_KEEP; dx <= CAM_KEEP; dx++) want(this.camX + dx, this.camZ + dz);
      for (let dz = -this.radius; dz <= this.radius; dz++)
        for (let dx = -this.radius; dx <= this.radius; dx++) want(fx + dx, fz + dz);
      // (Nearest the camera or the truck first, whichever it is nearer.)
      const d2 = (q: [number, number]) => Math.min((q[0] - fx) ** 2 + (q[1] - fz) ** 2, Number.isNaN(this.camX) ? Infinity : (q[0] - this.camX) ** 2 + (q[1] - this.camZ) ** 2);
      this.queue.sort((a, b) => d2(a) - d2(b));
      this.trim();
    }
    if (this.exact) {   // everything in range, now
      while (this.job) { const j = this.job, r = j.gen.next(); if (r.done) { this.job = null; this.place(j.cx, j.cz, r.value, j.ms); } }
      for (let next = this.queue.shift(); next; next = this.queue.shift()) {
        const key = chunkKey(next[0], next[1]);
        if (this.chunks.has(key)) continue;
        if (this.cache.has(key)) { this.restore(key); continue; }
        const t0 = performance.now(), r = this.build(next[0], next[1]);
        let obj: THREE.Object3D | null;
        if (isChunkBuild(r)) { let x = r.next(); while (!x.done) x = r.next(); obj = x.value; } else obj = r;
        this.place(next[0], next[1], obj, performance.now() - t0);
      }
      ahead = null;   // (built ahead: prefetched cells only, into the cache)
    }
    const start = performance.now(), ms = this.queue.length && !this.filling ? Math.max(this.frameMs, this.behindMs) : this.frameMs;
    let started = 0;
    for (;;) {
      if (!this.job) {
        if (started >= this.budget) break;
        const next = (this.exact ? null : this.queue.shift()) ?? this.nextPrefetch() ?? (ahead ? this.aheadCell(ahead) : null);
        if (!next) break;
        const key = chunkKey(next[0], next[1]);
        if (this.chunks.has(key)) continue;
        if (this.cache.has(key)) { if (this.near(next[0], next[1])) this.restore(key); continue; }
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
      if (performance.now() - start >= ms) break;
    }
  }
  private get keepRadius() { return this.exact ? this.radius : this.radius + 1; }
  private near(cx: number, cz: number) { return Math.max(Math.abs(cx - this.fx), Math.abs(cz - this.fz)) <= this.keepRadius || (!Number.isNaN(this.camX) && this.nearCam(cx, cz)); }
  // A finished chunk: into the scene if it is in range, else (prefetched) into the cache.
  private place(cx: number, cz: number, obj: THREE.Object3D | null, ms: number) {
    const o = obj ?? new THREE.Group();
    this.lastBuildMs = ms; this.maxBuildMs = Math.max(this.maxBuildMs, ms);
    o.position.set(cx * this.size, 0, cz * this.size);
    const c: Chunk = { cx, cz, obj: o, bytes: geometryBytes(o) }, key = chunkKey(cx, cz);
    this.built++;
    if (this.near(cx, cz) || this.cacheLimit <= 0) { this.parent.add(o); this.chunks.set(key, c); return; }
    o.userData.onStash?.();
    this.cache.set(key, c); this.cacheBytes += c.bytes; this.prefetched++;
    this.trim();
  }
  // Out of the scene: kept in the cache, or disposed.
  private retire(key: number, c: Chunk) {
    this.parent.remove(c.obj); this.chunks.delete(key);
    if (this.cacheLimit > 0 && c.bytes > 0 && this.keepCached()) {   // (an empty cell costs nothing to make again)
      c.obj.userData.onStash?.();
      this.cache.delete(key); this.cache.set(key, c); this.cacheBytes += c.bytes;
    } else { disposeTree(c.obj); this.disposed++; }
  }
  private restore(key: number) {
    const c = this.cache.get(key)!;
    this.cache.delete(key); this.cacheBytes -= c.bytes;
    c.obj.userData.onRestore?.();
    this.parent.add(c.obj); this.chunks.set(key, c); this.restored++;
  }
  // Shed the oldest cached chunks while over the limit or short of what they hold: first those not
  // about to be wanted (prefetched), then any.
  private trim() {
    const over = () => this.cacheBytes > this.cacheLimit || (this.cache.size > 0 && !this.keepCached());
    for (const spare of [true, false]) {
      if (!over()) return;
      for (const [key, c] of this.cache) {
        if (spare && this.prefetchKeys.has(key)) continue;
        this.cache.delete(key); this.cacheBytes -= c.bytes; disposeTree(c.obj); this.disposed++;
        if (!over()) return;
      }
    }
  }
  // The next prefetch cell not yet built, kept or empty; null when there is none, or no room.
  private nextPrefetch(): [number, number] | null {
    if (this.filling || this.cacheLimit <= 0 || !this.keepCached()) return null;
    while (this.prefetchAt < this.prefetchList.length) {
      const c = this.prefetchList[this.prefetchAt++], key = chunkKey(c[0], c[1]);
      if (this.chunks.has(key) || this.cache.has(key) || this.voidCell?.(c[0], c[1])) continue;
      if (this.job && this.job.cx === c[0] && this.job.cz === c[1]) continue;
      return c;
    }
    return null;
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
  // (The next update recomputes what is in range. Where it is stays known meanwhile: cleared, the
  // view would close in to nothing (clearDistance) for a frame drawn before that update, a flash of
  // fog as the truck crosses the edge of town, turning along it, on the board.)
  setRadius(r: number) { if (r !== this.radius) { this.radius = r; this.dirty = true; } }
  private dirty = false;

  clear() {
    // An unfinished build is dropped, not finished (return() runs its finally blocks): a builder
    // holding something registered outside its own objects (sign slots, lamp sites, the occlusion
    // map) at a yield hands it back in a finally (main.ts withOcclusion).
    if (this.job) { this.job.gen.return(null); this.job = null; }
    for (const c of this.chunks.values()) { this.parent.remove(c.obj); disposeTree(c.obj); }
    for (const c of this.cache.values()) disposeTree(c.obj);
    this.chunks.clear(); this.cache.clear(); this.cacheBytes = 0; this.queue.length = 0; this.fx = this.fz = NaN;
    this.setPrefetch([]);
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
