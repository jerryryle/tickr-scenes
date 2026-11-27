// Batches many coloured primitives into one untextured mesh with vertex colours, so a whole
// chunk is a single draw call. Vertices are written straight into growable typed arrays from
// cached unit templates: no per-primitive geometry objects, which keeps chunk builds cheap on
// the board's CPU. Coordinates passed in should be chunk-local (see ChunkStreamer); large
// world coordinates baked into vertices would lose float32 precision on the GPU.
// Textured meshes (livery, signs) do not go through Batch.
// Every vertex also carries a vec3 `aAux` attribute (written only when used): facade walls store
// (u, v, tile) for the facade atlas, primitives store `aux` (default (0, 0, -1) = untextured), and
// signal lamps store their timing tag. Materials that ignore it are unaffected.
import * as THREE from "three@0.187.0";

interface BatchTemplate { pos: Float32Array; nrm: Float32Array; count: number }
const batchTemplates = new Map<string, BatchTemplate>();
function batchTemplate(key: string, make: () => THREE.BufferGeometry): BatchTemplate {
  let t = batchTemplates.get(key);
  if (!t) {
    const src = make();
    const g = src.index ? src.toNonIndexed() : src;
    t = { pos: g.attributes.position.array as Float32Array, nrm: g.attributes.normal.array as Float32Array, count: g.attributes.position.count };
    batchTemplates.set(key, t);
    if (g !== src) src.dispose();
  }
  return t;
}

// A turned shape (Batch.lathe) is the profile turned round y, with smooth normals from the profile's
// slope, and only one triangle a step where the profile meets the axis (three.js's lathe makes two,
// one of them empty).
function latheGeometry(profile: readonly (readonly [number, number])[], seg: number): THREE.BufferGeometry {
  const pos: number[] = [], nrm: number[] = [], n = profile.length;
  // (The profile's normal at each point is its slope's perpendicular, averaged with the next.)
  const pn = profile.map((_, i) => {
    const [a0, b0] = profile[Math.max(0, i - 1)], [a1, b1] = profile[Math.min(n - 1, i + 1)];
    const dx = a1 - a0, dy = b1 - b0, l = Math.hypot(dx, dy) || 1;
    return [dy / l, -dx / l] as const;   // (it points outward, as the profile runs up)
  });
  const P = (i: number, k: number) => { const t = (k / seg) * Math.PI * 2, [r, y] = profile[i]; return [r * Math.sin(t), y, r * Math.cos(t)]; };
  const N = (i: number, k: number) => { const t = (k / seg) * Math.PI * 2, [nr, ny] = pn[i]; return [nr * Math.sin(t), ny, nr * Math.cos(t)]; };
  const v = (i: number, k: number) => { pos.push(...P(i, k)); nrm.push(...N(i, k)); };
  for (let i = 0; i + 1 < n; i++) for (let k = 0; k < seg; k++) {
    if (profile[i][0] > 1e-6) { v(i, k); v(i, k + 1); v(i + 1, k + 1); }
    if (profile[i + 1][0] > 1e-6) { v(i, k); v(i + 1, k + 1); v(i + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

// Vertices taken out of a Batch (Batch.take), to stamp copies of into others (Batch.stamp).
export interface BatchModel { pos: Float32Array; nrm: Float32Array; col: Float32Array; aux: Float32Array | null; count: number }

// Dry run: every Batch drops what it is given. For probe builds that only want to know where
// things go (city.ts pavementObstacles), not their geometry.
export const BATCH = { dry: false };
// A part's local frame (city.ts: a street, intersection or block drawn in its own axes): local
// (x, z) turned by `rot` about y (three.js's sense: local +x goes to (cos rot, -sin rot)), then
// moved by (ox, oz).
export interface Frame2 { ox: number; oz: number; rot: number }
export function frameApply(f: Frame2, x: number, z: number): [number, number] {
  const c = Math.cos(f.rot), s = Math.sin(f.rot);
  return [f.ox + c * x + s * z, f.oz - s * x + c * z];
}
// What a chunk build has placed so far, in its tile's coordinates, so later pieces keep out of it
// (city.ts cityBatches clears it; inFrame keeps `frames`, the parts' frames being drawn in, inner
// last): trees' trunks (x, z pairs) and buildings' footprints (four corners each, x, z pairs).
// (lots: each block lot's four corners in tile coordinates, city.ts buildLots, for the city maps: tools/mapsvg.ts.)
const TRI_PLAIN = { x: 0, y: 0, z: -1 };
export const PLACED = { frames: [] as Frame2[], trees: [] as number[], foot: [] as number[], lots: [] as number[] };
// (x, z) in the frame being drawn in, in the tile's coordinates.
export function toTile(x: number, z: number): [number, number] {
  for (let i = PLACED.frames.length - 1; i >= 0; i--) [x, z] = frameApply(PLACED.frames[i], x, z);
  return [x, z];
}

export class Batch {
  private pos = new Float32Array(36 * 3 * 64);
  private nrm = new Float32Array(36 * 3 * 64);
  private col = new Float32Array(36 * 3 * 64);
  private auxArr = new Float32Array(36 * 3 * 64);
  private auxUsed = false;
  // Aux value written with each primitive vertex; set it before emitting (see header).
  readonly aux = new THREE.Vector3(0, 0, -1);
  // Added to the height of every primitive (box, cyl, ...) emitted: the ground under it.
  dy = 0;
  private n = 0; // vertices written
  private m = new THREE.Matrix4();
  private nm = new THREE.Matrix3();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();
  private v = new THREE.Vector3();
  private c = new THREE.Color();

  box(x: number, y: number, z: number, w: number, h: number, d: number, color = 0xffffff, rotY = 0) {
    this.emit(batchTemplate("box", () => new THREE.BoxGeometry(1, 1, 1)), x, y, z, color, rotY, 0, 0, w, h, d);
  }
  // Box with full rotation (radians, XYZ order), for slopes and tilted parts.
  boxR(x: number, y: number, z: number, w: number, h: number, d: number, color: number, rotX: number, rotY: number, rotZ: number) {
    this.emit(batchTemplate("box", () => new THREE.BoxGeometry(1, 1, 1)), x, y, z, color, rotY, rotX, rotZ, w, h, d);
  }
  // Box from min/max corners, which reads more naturally for panels laid out by edges.
  span(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color = 0xffffff) {
    this.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), color);
  }
  cyl(x: number, y: number, z: number, r: number, h: number, color: number, seg = 8, rotX = 0, rotZ = 0, rotY = 0) {
    this.emit(batchTemplate("cyl" + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg)), x, y, z, color, rotY, rotX, rotZ, r, h, r);
  }
  // Points up; rotX = Math.PI turns it point down. rotY turns it about its axis; rotZ = -Math.PI / 2 lays it
  // down pointing along x.
  cone(x: number, y: number, z: number, r: number, h: number, color: number, seg = 8, rotX = 0, rotY = 0, rotZ = 0) {
    this.emit(batchTemplate("cone" + seg, () => new THREE.ConeGeometry(1, 1, seg)), x, y, z, color, rotY, rotX, rotZ, r, h, r);
  }
  // An open cylinder (it has no end caps) is for a piece of a chain whose ends are inside its neighbours or
  // under something (storybook-buildings-town.ts sbTube), and has half the triangles of a capped one.
  tubeSeg(x: number, y: number, z: number, r: number, h: number, color: number, seg = 8, rotX = 0, rotZ = 0, rotY = 0) {
    this.emit(batchTemplate("tube" + seg, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, true)), x, y, z, color, rotY, rotX, rotZ, r, h, r);
  }
  // This makes a turned shape, smooth-shaded: `profile` is [radius, height] pairs from the bottom up (radius 1
  // and height 1 at most), turned round y in `seg` steps, then r across and h up, its foot at y.
  // `key` names the profile (shapes are cached by it).
  lathe(key: string, profile: readonly (readonly [number, number])[], x: number, y: number, z: number, r: number, h: number, color: number, seg = 10, rotY = 0, rotX = 0, rotZ = 0) {
    this.emit(batchTemplate(`lathe:${key}:${seg}`, () => latheGeometry(profile, seg)), x, y, z, color, rotY, rotX, rotZ, r, h, r);
  }
  // Low-poly ball (tree crowns, bushes): an icosahedron of radius r, squashed by `sy`.
  ico(x: number, y: number, z: number, r: number, color: number, sy = 1, rotY = 0) {
    this.emit(batchTemplate("ico", () => new THREE.IcosahedronGeometry(1, 0)), x, y, z, color, rotY, 0, 0, r, r * sy, r);
  }
  // Gable roof: a triangular prism centred at (x, y, z) with the ridge along local x, `d` wide
  // at the eaves and `h` tall (y is the middle of the height), turned by rotY.
  prism(x: number, y: number, z: number, w: number, h: number, d: number, color: number, rotY = 0) {
    this.emit(batchTemplate("prism", gablePrism), x, y, z, color, rotY, 0, 0, w, h, d);
  }

  // A vertical wall quad from (x0, z0) to (x1, z1), y0..y1, facing (-dz, dx): list a footprint's
  // corners (x0,z1) (x1,z1) (x1,z0) (x0,z0) and every wall faces outward. aux.xy runs from
  // (u0, v0) by `uLen` across and `vLen` up, aux.z = `tile` (see FACADE in facade.ts).
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, color: number,
       tile: number, u0: number, uLen: number, v0: number, vLen: number) {
    if (BATCH.dry) return;
    this.reserve(6);
    this.auxUsed = true;
    const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;
    this.c.set(color);
    const { pos, nrm, col, auxArr } = this;
    const corner = [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]];
    let o = this.n * 3;
    for (const [s, t] of corner) {
      pos[o] = x0 + dx * s; pos[o + 1] = y0 + (y1 - y0) * t; pos[o + 2] = z0 + dz * s;
      nrm[o] = nx; nrm[o + 1] = 0; nrm[o + 2] = nz;
      col[o] = this.c.r; col[o + 1] = this.c.g; col[o + 2] = this.c.b;
      auxArr[o] = u0 + uLen * s; auxArr[o + 1] = v0 + vLen * t; auxArr[o + 2] = tile;
      o += 3;
    }
    this.n += 6;
  }

  // One flat-shaded triangle facing up (or towards `face`), wound so whatever order its corners
  // come in, as given: no dy.
  // (`tagged`: it carries the batch's aux, as the primitives do; else the untextured default.)
  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, color: number, face: [number, number, number] = [0, 1, 0], tagged = false) {
    if (BATCH.dry) return;
    this.reserve(3);
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = (nx * face[0] + ny * face[1] + nz * face[2] < 0 ? -1 : 1) * (Math.hypot(nx, ny, nz) || 1); nx /= l; ny /= l; nz /= l;
    if (l < 0) { [bx, by, bz, cx, cy, cz] = [cx, cy, cz, bx, by, bz]; }
    this.c.set(color);
    const { pos, nrm, col, auxArr } = this, A = tagged ? this.aux : TRI_PLAIN;
    if (tagged) this.auxUsed = true;
    let o = this.n * 3;
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = z; nrm[o] = nx; nrm[o + 1] = ny; nrm[o + 2] = nz;
      col[o] = this.c.r; col[o + 1] = this.c.g; col[o + 2] = this.c.b; auxArr[o] = A.x; auxArr[o + 1] = A.y; auxArr[o + 2] = A.z;
      o += 3;
    }
    this.n += 3;
  }

  private emit(t: BatchTemplate, x: number, y: number, z: number, color: number,
               rotY: number, rotX: number, rotZ: number, sx: number, sy: number, sz: number) {
    if (BATCH.dry) return;
    this.reserve(t.count);
    this.e.set(rotX, rotY, rotZ); this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(x, y + this.dy, z), this.q, this.s.set(sx, sy, sz));
    this.nm.getNormalMatrix(this.m);
    this.c.set(color);
    const { pos, nrm, col, auxArr } = this;
    const ax = this.aux.x, ay = this.aux.y, az = this.aux.z;
    if (ax !== 0 || ay !== 0 || az !== -1) this.auxUsed = true;
    let o = this.n * 3;
    for (let i = 0; i < t.count * 3; i += 3, o += 3) {
      this.v.set(t.pos[i], t.pos[i + 1], t.pos[i + 2]).applyMatrix4(this.m);
      pos[o] = this.v.x; pos[o + 1] = this.v.y; pos[o + 2] = this.v.z;
      this.v.set(t.nrm[i], t.nrm[i + 1], t.nrm[i + 2]).applyMatrix3(this.nm).normalize();
      nrm[o] = this.v.x; nrm[o + 1] = this.v.y; nrm[o + 2] = this.v.z;
      col[o] = this.c.r; col[o + 1] = this.c.g; col[o + 2] = this.c.b;
      auxArr[o] = ax; auxArr[o + 1] = ay; auxArr[o + 2] = az;
    }
    this.n += t.count;
  }
  private reserve(extra: number) {
    const need = (this.n + extra) * 3;
    if (need <= this.pos.length) return;
    const size = Math.max(need, this.pos.length * 2);
    const grow = (a: Float32Array) => { const b = new Float32Array(size); b.set(a.subarray(0, this.n * 3)); return b; };
    this.pos = grow(this.pos); this.nrm = grow(this.nrm); this.col = grow(this.col); this.auxArr = grow(this.auxArr);
  }

  // What has been emitted so far, as a model to stamp elsewhere (see stamp), and start afresh.
  take(): BatchModel {
    const k = this.n * 3;
    const m: BatchModel = { pos: this.pos.slice(0, k), nrm: this.nrm.slice(0, k), col: this.col.slice(0, k), aux: this.auxUsed ? this.auxArr.slice(0, k) : null, count: this.n };
    this.n = 0; this.auxUsed = false;
    return m;
  }
  // A model (from take) turned by `rotY` and set down at (x, y + dy, z). Pure white in it (paint
  // left for instanceColor) becomes `paint`; its aux tags are kept only with `aux`.
  stamp(m: BatchModel, x: number, y: number, z: number, rotY: number, paint = 0xffffff, aux = true) {
    if (BATCH.dry) return;
    this.reserve(m.count);
    const c = Math.cos(rotY), s = Math.sin(rotY), yy = y + this.dy;
    this.c.set(paint);
    const { pos, nrm, col, auxArr } = this, keepAux = aux && !!m.aux;
    if (keepAux) this.auxUsed = true;
    let o = this.n * 3;
    for (let i = 0; i < m.count * 3; i += 3, o += 3) {
      const px = m.pos[i], pz = m.pos[i + 2], nx = m.nrm[i], nz = m.nrm[i + 2];
      pos[o] = x + c * px + s * pz; pos[o + 1] = yy + m.pos[i + 1]; pos[o + 2] = z - s * px + c * pz;
      nrm[o] = c * nx + s * nz; nrm[o + 1] = m.nrm[i + 1]; nrm[o + 2] = -s * nx + c * nz;
      const white = m.col[i] === 1 && m.col[i + 1] === 1 && m.col[i + 2] === 1;
      col[o] = white ? this.c.r : m.col[i]; col[o + 1] = white ? this.c.g : m.col[i + 1]; col[o + 2] = white ? this.c.b : m.col[i + 2];
      if (keepAux) { auxArr[o] = m.aux![i]; auxArr[o + 1] = m.aux![i + 1]; auxArr[o + 2] = m.aux![i + 2]; }
      else { auxArr[o] = 0; auxArr[o + 1] = 0; auxArr[o + 2] = -1; }
    }
    this.n += m.count;
  }

  get empty() { return this.n === 0; }
  get vertexCount() { return this.n; }
  // Vertices written so far (a mark for transformFrom).
  mark() { return this.n; }
  // Put the vertices written since mark n0 into frame f (positions and normals).
  transformFrom(n0: number, f: Frame2) {
    const c = Math.cos(f.rot), s = Math.sin(f.rot), P = this.pos, N = this.nrm;
    for (let o = n0 * 3; o < this.n * 3; o += 3) {
      const x = P[o], z = P[o + 2], nx = N[o], nz = N[o + 2];
      P[o] = f.ox + c * x + s * z; P[o + 2] = f.oz - s * x + c * z;
      N[o] = c * nx + s * nz; N[o + 2] = -s * nx + c * nz;
    }
  }
  // The vertices written so far, in place: no copy, so read it before the batch is built or
  // written to again. `aux` is null when no wall was written.
  view(): { pos: Float32Array; aux: Float32Array | null; count: number } {
    const k = this.n * 3;
    return { pos: this.pos.subarray(0, k), aux: this.auxUsed ? this.auxArr.subarray(0, k) : null, count: this.n };
  }
  build(material: THREE.Material): THREE.Mesh | null {
    if (this.n === 0) return null;
    const g = new THREE.BufferGeometry();
    const k = this.n * 3;
    g.setAttribute("position", new THREE.BufferAttribute(this.pos.slice(0, k), 3));
    g.setAttribute("normal", new THREE.BufferAttribute(this.nrm.slice(0, k), 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col.slice(0, k), 3));
    if (this.auxUsed) g.setAttribute("aAux", new THREE.BufferAttribute(this.auxArr.slice(0, k), 3));
    g.computeBoundingSphere();
    this.n = 0; this.auxUsed = false;
    return new THREE.Mesh(g, material);
  }
}

// Unit triangular prism (ridge along x, base 1 wide in z, y from -0.5 to 0.5), flat-shaded.
function gablePrism(): THREE.BufferGeometry {
  // Cross-section corners as (z, y); faces are listed loosely and then wound outward by checking
  // each face normal against the direction from the prism's centroid.
  const A = [-0.5, -0.5], B = [0.5, -0.5], C = [0, 0.5];
  const faces = [
    [[0.5, A], [0.5, B], [0.5, C]], [[-0.5, A], [-0.5, B], [-0.5, C]],
    [[-0.5, B], [0.5, B], [0.5, C]], [[-0.5, B], [0.5, C], [-0.5, C]],
    [[-0.5, A], [0.5, A], [0.5, C]], [[-0.5, A], [0.5, C], [-0.5, C]],
  ] as [number, number[]][][];
  const v: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  const centroid = new THREE.Vector3(0, -1 / 6, 0);
  for (const f of faces) {
    const [p, q, r] = f.map(([x, [z, y]]) => new THREE.Vector3(x, y, z));
    n.crossVectors(b.subVectors(q, p), c.subVectors(r, p));
    a.copy(p).add(q).add(r).divideScalar(3).sub(centroid);
    const tri = n.dot(a) >= 0 ? [p, q, r] : [p, r, q];
    for (const t of tri) v.push(t.x, t.y, t.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

// Textured quads with explicit UV rectangles, merged into one geometry (one draw call per
// material). Used for livery panels and screens. A quad faces +z before `rotY` is applied, and
// its texture reads correctly from the side it faces.
export interface Quad { x: number; y: number; z: number; w: number; h: number; rotY?: number; u0?: number; v0?: number; u1?: number; v1?: number }
export function quadGeometry(quads: Quad[]): THREE.BufferGeometry {
  const pos = new Float32Array(quads.length * 18), nrm = new Float32Array(quads.length * 18), uv = new Float32Array(quads.length * 12);
  quads.forEach((q, i) => {
    const r = q.rotY ?? 0, c = Math.cos(r), s = Math.sin(r);
    const ax = c * q.w / 2, az = -s * q.w / 2, hy = q.h / 2;  // half-extent along the quad's local x (rotated) and y
    const nx = s, nz = c;                                     // local +z rotated
    const u0 = q.u0 ?? 0, v0 = q.v0 ?? 0, u1 = q.u1 ?? 1, v1 = q.v1 ?? 1;
    const corners = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, -1, u0, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
    corners.forEach(([sx, sy, u, v], k) => {
      const o = i * 18 + k * 3;
      pos[o] = q.x + sx * ax; pos[o + 1] = q.y + sy * hy; pos[o + 2] = q.z + sx * az;
      nrm[o] = nx; nrm[o + 1] = 0; nrm[o + 2] = nz;
      uv[i * 12 + k * 2] = u; uv[i * 12 + k * 2 + 1] = v;
    });
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}

// A speck of a material drawn with this geometry's vertex layout (instanced, with per-instance
// colours, if `instanced`), far under the ground: in the setup precompile, and drawn once (then
// hidden), so that shader and layout are compiled and warm from the start and the first time the
// real thing is drawn isn't a long frame, which on a board shows as the truck skipping ahead. (A
// material hidden at the start, as the sea's lights by day, is drawn the first time it shows.) The
// geometry is shared, not copied: pass one that lives as long as `parent`.
export function keepWarm(parent: THREE.Object3D, geometry: THREE.BufferGeometry, material: THREE.Material, instanced = false): THREE.Mesh {
  const k = instanced ? new THREE.InstancedMesh(geometry, material, 1) : new THREE.Mesh(geometry, material);
  if (k instanceof THREE.InstancedMesh) { k.setMatrixAt(0, new THREE.Matrix4()); k.setColorAt(0, new THREE.Color(0xffffff)); }
  k.position.y = -60; k.scale.setScalar(1e-3); k.frustumCulled = false;
  k.onAfterRender = () => { k.visible = false; };
  parent.add(k);
  return k;
}
