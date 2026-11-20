// The city as a street graph: intersections (nodes), streets between them (straight or circular
// arcs, two lanes each way), the blocks they enclose and the faces of those blocks along each
// street. Every other module asks the graph instead of doing grid arithmetic, so a city can take
// any layout a generator gives it (citygen.ts). The graph is built once per city from its seed
// and never changes, so everything derived from it stays a pure function of the seed (seeking
// and scrubbing rely on that).
//
// Conventions (as route.ts and Truck): heading h, forward (cos h, -sin h), right (sin h, cos h);
// h grows turning left. A street runs from node n0 (s = 0) to n1 (s = len); its own heading at s
// is h0 + k s (k = 0: straight). A directed edge ("dedge") is a street driven one way: 2 * street
// for n0 to n1, 2 * street + 1 for n1 to n0. Traffic keeps right.
//
// A face is a block's side along one street: the side to the right of a dedge, so faces and
// dedges share ids. Its frontage frame (a, n): a along the way the dedge runs, from the centre
// of the node it leaves; n across, from the back of the sidewalk (the block's edge, `half` from
// the centre line) into the block (negative: the sidewalk, then the street). On the old grid a
// face's usable frontage was a in [9, 51] and its kerb at n = -3: faceA0/faceA1 and the street's
// kerb width give those for any face.
//
// Map tiles: the city is streamed in TILE-metre squares (chunks.ts). Each node, street and block
// belongs to the tile that holds its anchor (its centre; a street's middle; a block's centroid),
// which on a regular grid is exactly the old one-block-per-chunk ownership.

export const TILE = 60;
export const MIN_FRONTAGE = 12;
export type GMove = "S" | "L" | "R";
export type Control = "signal" | "stop" | "none";

export interface Arm { street: number; end: 0 | 1; h: number; mouth: number }
export interface CNode {
  id: number; x: number; z: number;
  arms: Arm[];                  // by heading out of the node, anticlockwise from east
  control: Control;
  kx: number; kz: number;       // a key for seeded hashes (the old grid's ix, iz)
  phaseOf: number[];            // signal phase of each arm's approach (index into arms)
  phases: number;               // how many phases the signal cycles through (1: none)
}
export interface CStreet {
  id: number; n0: number; n1: number;
  x0: number; z0: number; h0: number; k: number; len: number;
  half: number;                 // centre line to the back of the sidewalk
  kerb: number;                 // sidewalk width
  name: string;
  inCity: boolean;              // drivable by the truck and traffic (city streets and gate streets)
  gate: number;                 // index into gates, or -1
  oneway: boolean;              // driven only from n0 to n1 (a roundabout's ring, or a one-way street downtown)
  ring?: boolean;               // a roundabout's ring (one-way, and round it is straight on)
  tags: { elevated?: boolean; cable?: boolean; freeway?: boolean };
}
export interface CBlock {
  id: number; faces: number[];  // in order round the block (each to the right of its dedge)
  sides: number[];              // the same faces as numbered sides: on a grid-like block the old
                                // grid's order (0 north, 1 south, 2 west, 3 east), else round it
  poly: [number, number][];     // its edge (the backs of the sidewalks), in face order (positive shoelace sum in x, z)
  cx: number; cz: number;       // centroid
  kx: number; kz: number;       // a key for seeded hashes (the old grid's bx, bz)
  inCity: boolean;
  area: number;
  square: boolean;              // the old grid's block: 42 m square, sides north, south, west and east (the grid's own builders and sites fit it)
  water: boolean;               // a river (citygen.ts): water between its quays, nothing built
  park: boolean;                // a superblock park (citygen.ts): several blocks' worth of green
  // Where the old grid's 42 m square block fits against one of its faces, for a site laid out
  // for it (a dock, garage, rental lot or stand): that face, and how far along it the square's
  // frontage starts past the grid's (a square's frontage a is the face's a - delta). Null on a
  // square block (it is the grid's own) or where none fits.
  anchor: { face: number; delta: number } | null;
}
export interface CGate { node: number; street: number; out: 0 | 1 }   // the perimeter node, its gate street, and which end of it is outside
export interface GPt { x: number; z: number; h: number }

const wrapPi = (a: number) => { a %= 2 * Math.PI; if (a <= -Math.PI) a += 2 * Math.PI; else if (a > Math.PI) a -= 2 * Math.PI; return a; };
export const angleDiff = wrapPi;

export class CityGraph {
  readonly nodes: CNode[] = [];
  readonly streets: CStreet[] = [];
  readonly blocks: CBlock[] = [];
  readonly gates: (CGate | null)[] = [];   // index-aligned with city.ts GATES: null where a gate is closed (outline.ts)
  // The edge round the outside of the town (the backs of its outermost sidewalks), the largest
  // such cycle: where the land ends (outline.ts), and along the sea, the shore.
  outer: [number, number][] | null = null;
  faceBlock: Int32Array = new Int32Array(0);   // face (dedge) -> block id, or -1 (outside)
  private nodeKey = new Map<string, number>();
  private blockKey = new Map<string, number>();
  private tiles = new Map<number, { nodes: number[]; streets: number[]; blocks: number[] }>();
  private blockGrid = new Map<number, number[]>();
  bounds = { x0: 0, z0: 0, x1: 0, z1: 0 };

  // ---- building (citygen.ts) -------------------------------------------------------------
  addNode(x: number, z: number, kx: number, kz: number): number {
    const id = this.nodes.length;
    this.nodes.push({ id, x, z, arms: [], control: "signal", kx, kz, phaseOf: [], phases: 1 });
    this.nodeKey.set(`${kx},${kz}`, id);
    return id;
  }
  // A straight street from node a to node b (k = 0), or an arc leaving a on heading h0 with
  // curvature k that ends at b (the caller makes sure it does).
  addStreet(a: number, b: number, opts: Partial<Pick<CStreet, "half" | "kerb" | "name" | "inCity" | "tags" | "oneway" | "ring">> & { k?: number; h0?: number; len?: number } = {}): number {
    const A = this.nodes[a], B = this.nodes[b], id = this.streets.length;
    let h0 = opts.h0 ?? Math.atan2(-(B.z - A.z), B.x - A.x), k = opts.k ?? 0, len = opts.len ?? Math.hypot(B.x - A.x, B.z - A.z);
    if (k === 0) { h0 = Math.atan2(-(B.z - A.z), B.x - A.x); len = Math.hypot(B.x - A.x, B.z - A.z); }
    this.streets.push({ id, n0: a, n1: b, x0: A.x, z0: A.z, h0, k, len, half: opts.half ?? 9, kerb: opts.kerb ?? 3, name: opts.name ?? "", inCity: opts.inCity ?? true, gate: -1, oneway: opts.oneway ?? false, ring: opts.ring || undefined, tags: opts.tags ?? {} });
    return id;
  }
  // Once every node and street is in: arms, mouths, blocks, faces, signal phases, tiles.
  finish() {
    for (const st of this.streets) {
      this.nodes[st.n0].arms.push({ street: st.id, end: 0, h: wrapPi(st.h0), mouth: 0 });
      this.nodes[st.n1].arms.push({ street: st.id, end: 1, h: wrapPi(st.h0 + st.k * st.len + Math.PI), mouth: 0 });
    }
    for (const n of this.nodes) {
      // Anticlockwise from east (h from -pi up to pi), ties by street id: deterministic.
      n.arms.sort((p, q) => (p.h - q.h) || (p.street - q.street));
      this.mouths(n);
      this.phasesOf(n);
    }
    this.findBlocks();
    this.anchors();
    this.indexTiles();
  }

  // Where each arm's street begins clear of the intersection: the kerb lines of neighbouring arms
  // (the backs of their sidewalks) cross that far out along it.
  private mouths(n: CNode) {
    const A = n.arms, m = A.length;
    for (const a of A) a.mouth = 0;
    if (m < 2) return;
    for (let i = 0; i < m; i++) {
      const a = A[i], b = A[(i + 1) % m];
      const gap = m === 2 && i === 1 ? wrapPi(A[0].h - A[1].h) + (wrapPi(A[0].h - A[1].h) < 0 ? 2 * Math.PI : 0) : (b.h - a.h + 2 * Math.PI) % (2 * Math.PI);
      if (gap >= Math.PI - 1e-6) continue;   // the outside of a bend: nothing to clear
      const ha = this.streets[a.street].half, hb = this.streets[b.street].half;
      // a's left kerb line and b's right kerb line meet where the corner is: along a by
      // (hb + ha cos g) / sin g, along b by (ha + hb cos g) / sin g.
      const s = Math.sin(gap), c = Math.cos(gap);
      a.mouth = Math.max(a.mouth, Math.min(3 * ha, (hb + ha * c) / s));
      b.mouth = Math.max(b.mouth, Math.min(3 * hb, (ha + hb * c) / s));
    }
  }

  // Signal phases: arms opposite each other (within 35 degrees of straight on) share a phase,
  // in the order their first arm comes round from east; any left over get one each. A node with
  // fewer than three arms has no signal.
  private phasesOf(n: CNode) {
    const m = n.arms.length;
    n.phaseOf = new Array(m).fill(-1);
    if (m < 3) { n.control = "none"; n.phases = 1; n.phaseOf.fill(0); return; }
    // Phases are numbered round from east (on the old grid: the east-west street first, axis 0,
    // then north-south).
    let p = 0;
    const order = [...n.arms.keys()].sort((i, j) => ((n.arms[i].h + 2 * Math.PI) % (2 * Math.PI)) - ((n.arms[j].h + 2 * Math.PI) % (2 * Math.PI)));
    for (const i of order) {
      if (n.phaseOf[i] >= 0) continue;
      n.phaseOf[i] = p;
      let best = -1, bd = 35 * Math.PI / 180;
      for (let j = 0; j < m; j++) if (j !== i && n.phaseOf[j] < 0) { const d = Math.abs(wrapPi(n.arms[j].h - n.arms[i].h - Math.PI)); if (d < bd) { bd = d; best = j; } }
      if (best >= 0) n.phaseOf[best] = p;
      p++;
    }
    n.phases = p;
  }

  // Blocks: walk each face's cycle (at a dedge's end, take the sharpest right turn), keeping the
  // cycles that wind anticlockwise round a bounded area; the one round the outside is no block.
  private findBlocks() {
    const D = this.streets.length * 2;
    this.faceBlock = new Int32Array(D).fill(-1);
    const seen = new Uint8Array(D);
    let outerArea = 0;
    this.outer = null;
    for (let d0 = 0; d0 < D; d0++) {
      if (seen[d0]) continue;
      const cyc: number[] = [];
      let d = d0, guard = 0;
      while (!seen[d] && guard++ < 4096) { seen[d] = 1; cyc.push(d); d = this.rightTurn(d); }
      if (d !== d0) continue;   // (never happens in a planar graph)
      const poly = this.cyclePoly(cyc);
      let area = 0, cx = 0, cz = 0;
      for (let i = 0; i < poly.length; i++) {
        const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length], c = x0 * z1 - x1 * z0;
        area += c; cx += (x0 + x1) * c; cz += (z0 + z1) * c;
      }
      // A cycle keeping its block on its right has a positive shoelace sum in (x, z) (east, then
      // south...); the one round the outside of the city, negative.
      if (area <= 1) { if (area < outerArea) { outerArea = area; this.outer = poly; } continue; }
      cx /= 3 * area; cz /= 3 * area; area /= 2;
      const id = this.blocks.length;
      // The key: the old grid's (bx, bz) from the centroid (a block centred at bx*60 + 39).
      let kx = Math.floor((cx - 9) / TILE), kz = Math.floor((cz - 9) / TILE);
      while (this.blockKey.has(`${kx},${kz}`)) kz += 1000;   // (two blocks in one cell: keep keys unique)
      this.blockKey.set(`${kx},${kz}`, id);
      this.blocks.push({ id, faces: cyc, sides: cyc, poly, cx, cz, kx, kz, inCity: true, area, square: false, water: false, park: false, anchor: null });
      for (const f of cyc) this.faceBlock[f] = id;
      const B = this.blocks[id];
      if (cyc.length === 4) { const old = [0, 1, 2, 3].map((k) => this.sideFace(B, k)); if (new Set(old).size === 4 && !old.includes(-1)) B.sides = old; }
      const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
      B.square = B.sides !== B.faces && Math.abs(Math.max(...xs) - Math.min(...xs) - 42) < 1e-6 && Math.abs(Math.max(...zs) - Math.min(...zs) - 42) < 1e-6 && Math.abs(area - 42 * 42) < 1e-3;
    }
  }
  // The faces' anchors (CBlock.anchor): the longest face first where the square fits inside.
  private anchors() {
    for (const B of this.blocks) {
      if (B.square || B.water || B.park) continue;
      const faces = B.faces.slice().sort((p, q) => (this.faceA1(q) - this.faceA0(q)) - (this.faceA1(p) - this.faceA0(p)) || p - q);
      for (const f of faces) {
        const A0 = this.faceA0(f), A1 = this.faceA1(f);
        // (A metre or so short is room enough: what a site puts at its very edges is fences and
        // the odd tree, and its buildings stand well inside.)
        if (A1 - A0 < 40) break;
        const delta = (A0 + A1) / 2 - 30;
        let ok = true;
        for (const a of [10.2, 30, 49.8]) for (const n of [0.5, 21, 40.2]) { const P = this.facePt(f, a + delta, n); if (!inPoly(B.poly, P.x, P.z)) ok = false; }
        if (ok) { B.anchor = { face: f, delta }; break; }
      }
    }
  }
  // A block's side number for face f (its index in sides), or -1.
  sideOf(f: number): number { const b = this.faceBlock[f]; return b < 0 ? -1 : this.blocks[b].sides.indexOf(f); }
  // The dedge after d round the block on its right: the sharpest right turn at its end (a dead
  // end turns back).
  rightTurn(d: number): number {
    const st = this.streets[d >> 1], fwd = (d & 1) === 0, N = this.nodes[fwd ? st.n1 : st.n0];
    const hin = this.dedgeEndH(d);
    let best = -1, ba = Infinity;
    for (const a of N.arms) {
      const out = a.street * 2 + (a.end === 0 ? 0 : 1);
      if (out === (d ^ 1)) continue;
      const t = wrapPi(a.h - hin);
      if (t < ba) { ba = t; best = out; }
    }
    return best < 0 ? d ^ 1 : best;
  }
  // A face cycle's corners (where consecutive faces' sidewalk backs meet), with points along any
  // curved face between them.
  private cyclePoly(cyc: number[]): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < cyc.length; i++) {
      const f = cyc[i], g = cyc[(i + 1) % cyc.length];
      const st = this.streets[f >> 1];
      if (st.k !== 0) {
        const L = st.len, a0 = this.faceA0(f), a1 = L - this.faceEndMouth(f), n = Math.max(2, Math.ceil(Math.abs(st.k) * L / 0.2));
        for (let j = 1; j < n; j++) { const p = this.facePt(f, a0 + (a1 - a0) * j / n, 0); out.push([p.x, p.z]); }
      }
      out.push(this.corner(f, g));
    }
    return out;
  }
  // Where face f's sidewalk back meets the next face g's, round the corner at f's end node.
  corner(f: number, g: number): [number, number] {
    const lf = this.faceLen(f), pf = this.facePt(f, lf, 0), pg = this.facePt(g, 0, 0);
    const hf = pf.h, hg = pg.h;
    const df = [Math.cos(hf), -Math.sin(hf)], dg = [Math.cos(hg), -Math.sin(hg)];
    const den = df[0] * dg[1] - df[1] * dg[0];
    if (Math.abs(den) < 1e-6) return [(pf.x + pg.x) / 2, (pf.z + pg.z) / 2];
    const t = ((pg.x - pf.x) * dg[1] - (pg.z - pf.z) * dg[0]) / den;
    return [pf.x + df[0] * t, pf.z + df[1] * t];
  }

  private indexTiles() {
    const tile = (x: number, z: number) => { const k = tileKey(Math.floor(x / TILE), Math.floor(z / TILE)); let t = this.tiles.get(k); if (!t) this.tiles.set(k, t = { nodes: [], streets: [], blocks: [] }); return t; };
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const n of this.nodes) { tile(n.x, n.z).nodes.push(n.id); x0 = Math.min(x0, n.x); z0 = Math.min(z0, n.z); x1 = Math.max(x1, n.x); z1 = Math.max(z1, n.z); }
    for (const s of this.streets) { const p = this.streetPt(s.id, s.len / 2, 0); tile(p.x, p.z).streets.push(s.id); }
    for (const b of this.blocks) {
      tile(b.cx, b.cz).blocks.push(b.id);
      let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
      for (const [x, z] of b.poly) { bx0 = Math.min(bx0, x); bz0 = Math.min(bz0, z); bx1 = Math.max(bx1, x); bz1 = Math.max(bz1, z); }
      for (let gx = Math.floor(bx0 / TILE); gx <= Math.floor(bx1 / TILE); gx++)
        for (let gz = Math.floor(bz0 / TILE); gz <= Math.floor(bz1 / TILE); gz++) {
          const k = tileKey(gx, gz); let l = this.blockGrid.get(k); if (!l) this.blockGrid.set(k, l = []); l.push(b.id);
        }
    }
    this.bounds = { x0, z0, x1, z1 };
  }

  // ---- lookups ---------------------------------------------------------------------------
  node(kx: number, kz: number): CNode | null { const i = this.nodeKey.get(`${kx},${kz}`); return i === undefined ? null : this.nodes[i]; }
  block(kx: number, kz: number): CBlock | null { const i = this.blockKey.get(`${kx},${kz}`); return i === undefined ? null : this.blocks[i]; }
  tile(cx: number, cz: number) { return this.tiles.get(tileKey(cx, cz)) ?? EMPTY_TILE; }
  // The blocks whose bounds overlap tile (cx, cz) (a big block's, or a river's, are in several).
  blocksOver(cx: number, cz: number): readonly number[] { return this.blockGrid.get(tileKey(cx, cz)) ?? []; }
  // The block whose edge encloses (x, z), if any.
  blockAt(x: number, z: number): CBlock | null {
    for (const id of this.blockGrid.get(tileKey(Math.floor(x / TILE), Math.floor(z / TILE))) ?? []) if (inPoly(this.blocks[id].poly, x, z)) return this.blocks[id];
    return null;
  }
  // The block whose edge encloses (x, z) or passes within `margin` of it, if any.
  blockNear(x: number, z: number, margin: number): CBlock | null {
    const inside = this.blockAt(x, z);
    if (inside || margin <= 0) return inside;
    const gx = Math.floor(x / TILE), gz = Math.floor(z / TILE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++)
      for (const id of this.blockGrid.get(tileKey(gx + dx, gz + dz)) ?? []) if (polyDist(this.blocks[id].poly, x, z) <= margin) return this.blocks[id];
    return null;
  }
  // The block nearest (x, z) by centroid among those round its tile (for "which block am I by").
  nearestBlock(x: number, z: number): CBlock | null {
    let best: CBlock | null = null, bd = Infinity;
    const gx = Math.floor(x / TILE), gz = Math.floor(z / TILE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++)
      for (const id of this.blockGrid.get(tileKey(gx + dx, gz + dz)) ?? []) { const b = this.blocks[id], d = Math.hypot(b.cx - x, b.cz - z); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  // ---- streets ---------------------------------------------------------------------------
  // The point s along a street, `off` to the right of its centre line, and the street's heading.
  streetPt(id: number, s: number, off: number, out: GPt = { x: 0, z: 0, h: 0 }): GPt {
    const st = this.streets[id], h = st.h0 + st.k * s;
    let x: number, z: number;
    if (Math.abs(st.k) < 1e-9) { x = st.x0 + Math.cos(st.h0) * s; z = st.z0 - Math.sin(st.h0) * s; }
    else { x = st.x0 + (Math.sin(h) - Math.sin(st.h0)) / st.k; z = st.z0 + (Math.cos(h) - Math.cos(st.h0)) / st.k; }
    out.x = x + Math.sin(h) * off; out.z = z + Math.cos(h) * off; out.h = h;
    return out;
  }
  // The street s and offset of (x, z) (nearest point on the centre line, clamped to the street).
  toStreet(id: number, x: number, z: number): [number, number] {
    const st = this.streets[id];
    if (Math.abs(st.k) < 1e-9) {
      const fx = Math.cos(st.h0), fz = -Math.sin(st.h0), dx = x - st.x0, dz = z - st.z0;
      return [Math.min(st.len, Math.max(0, dx * fx + dz * fz)), dx * Math.sin(st.h0) + dz * Math.cos(st.h0)];
    }
    // Arc: centre to the left of the start (k > 0) or right.
    const r = 1 / st.k, ccx = st.x0 - Math.sin(st.h0) * r, ccz = st.z0 - Math.cos(st.h0) * r;
    const ang0 = Math.atan2(st.z0 - ccz, st.x0 - ccx), ang = Math.atan2(z - ccz, x - ccx);
    let da = wrapPi(ang - ang0); const s = Math.min(st.len, Math.max(0, -da / st.k));
    const p = this.streetPt(id, s, 0);
    return [s, (x - p.x) * Math.sin(p.h) + (z - p.z) * Math.cos(p.h)];
  }
  // A dedge's street, its start and end nodes, its heading at its start and end.
  dedgeFrom(d: number) { const st = this.streets[d >> 1]; return (d & 1) === 0 ? st.n0 : st.n1; }
  dedgeTo(d: number) { const st = this.streets[d >> 1]; return (d & 1) === 0 ? st.n1 : st.n0; }
  dedgeEndH(d: number) { const st = this.streets[d >> 1]; return (d & 1) === 0 ? st.h0 + st.k * st.len : st.h0 + Math.PI; }
  dedgeStartH(d: number) { const st = this.streets[d >> 1]; return (d & 1) === 0 ? st.h0 : st.h0 + st.k * st.len + Math.PI; }
  // The arm a dedge leaves its start node by, and arrives by at its end.
  armOut(d: number): Arm { const st = this.streets[d >> 1], e = d & 1; return this.nodes[e ? st.n1 : st.n0].arms.find((a) => a.street === st.id && a.end === e)!; }
  armIn(d: number): Arm { const st = this.streets[d >> 1], e = (d & 1) ^ 1; return this.nodes[e ? st.n1 : st.n0].arms.find((a) => a.street === st.id && a.end === e)!; }
  armIndexIn(d: number) { const st = this.streets[d >> 1], e = (d & 1) ^ 1; return this.nodes[e ? st.n1 : st.n0].arms.findIndex((a) => a.street === st.id && a.end === e); }
  // The ways on from dedge d at its end node: each out dedge, its move (S, L or R by the turn
  // angle), and the angle (positive: left). No U-turns.
  movesFrom(d: number): { to: number; move: GMove; turn: number }[] {
    const N = this.nodes[this.dedgeTo(d)], hin = this.dedgeEndH(d), out: { to: number; move: GMove; turn: number }[] = [];
    for (const a of N.arms) {
      const to = a.street * 2 + a.end;
      if (to === (d ^ 1) || (this.streets[a.street].oneway && a.end === 1)) continue;   // (no U-turns, nor the wrong way up a one-way street)
      const t = wrapPi(a.h - hin);
      // (Round a roundabout's ring, one one-way street to the next, is straight on, whatever the
      // corner: it is a bend, not a turn off.)
      const ring = !!this.streets[d >> 1].ring && !!this.streets[a.street].ring;
      out.push({ to, move: ring || Math.abs(t) < Math.PI / 4 ? "S" : t > 0 ? "L" : "R", turn: t });
    }
    return out;
  }
  // The dedge a vehicle at (x, z) heading h is driving along (the street under it running its
  // way), and how far short of the dedge's end it is: {d, before}. Streets are searched round the
  // point's tile.
  locate(x: number, z: number, h: number): { d: number; before: number } {
    let best = -1, bs = 0, bd = Infinity;
    const gx = Math.floor(x / TILE), gz = Math.floor(z / TILE);
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++)
      for (const id of this.tile(gx + dx, gz + dz).streets) {
        const st = this.streets[id], [s, o] = this.toStreet(id, x, z);
        if (Math.abs(o) > st.half + 1) continue;
        const fwd = Math.cos(wrapPi(h - this.streetPt(id, s, 0).h)) >= 0, d = id * 2 + (fwd ? 0 : 1);
        const cost = Math.abs(o) + (s <= 0 || s >= st.len ? 5 : 0);
        if (cost < bd) { bd = cost; best = d; bs = fwd ? st.len - s : s; }
      }
    return { d: best, before: bs };
  }
  // The dedge leaving node n by the arm with heading nearest h (and within tol), if any.
  dedgeLeaving(n: number, h: number, tol = Math.PI / 4): number {
    let best = -1, bd = tol;
    for (const a of this.nodes[n].arms) { const d = Math.abs(wrapPi(a.h - h)); if (d < bd) { bd = d; best = a.street * 2 + a.end; } }
    return best;
  }

  // ---- faces -----------------------------------------------------------------------------
  faceLen(f: number) { return this.streets[f >> 1].len; }
  faceA0(f: number) { return this.armOut(f).mouth; }
  faceEndMouth(f: number) { return this.armIn(f).mouth; }
  faceA1(f: number) { return this.faceLen(f) - this.faceEndMouth(f); }
  // Whether a face is long enough to front onto (a truck can stop along it, a building faces it):
  // between close intersections a face can be a sliver.
  hasFrontage(f: number) { return this.faceA1(f) - this.faceA0(f) >= MIN_FRONTAGE; }
  // The point (a, n) of a face's frontage frame, and the heading along it (the dedge's).
  facePt(f: number, a: number, n: number, out: GPt = { x: 0, z: 0, h: 0 }): GPt {
    const st = this.streets[f >> 1];
    if ((f & 1) === 0) return this.streetPt(st.id, a, st.half + n, out);
    this.streetPt(st.id, st.len - a, -(st.half + n), out);
    out.h += Math.PI;
    return out;
  }
  // (x, z) in a face's frame: [a, n].
  toFace(f: number, x: number, z: number): [number, number] {
    const st = this.streets[f >> 1], [s, o] = this.toStreet(st.id, x, z);
    return (f & 1) === 0 ? [s, o - st.half] : [st.len - s, -o - st.half];
  }
  // The face of a block running nearest the old grid side's way (0 east, 1 west, 2 north, 3
  // south: the north, south, west and east sides of a grid block), or -1.
  sideFace(b: CBlock, side: number): number {
    const want = [0, Math.PI, Math.PI / 2, -Math.PI / 2][side];
    let best = -1, bd = Math.PI / 4;
    for (const f of b.faces) { const d = Math.abs(wrapPi(this.dedgeStartH(f) - want)); if (d < bd) { bd = d; best = f; } }
    return best;
  }
  nextFace(f: number) { return this.rightTurn(f); }
  // The shortest drive in metres from any of nodes `from` to every node, along the city's own
  // streets (inCity) and the right way up one-way ones; Infinity where none reaches. (Turns are
  // free: for rough timings, journey.ts estimate.) Cached by source, the last few.
  private dists = new Map<string, Float64Array>();
  driveDists(from: readonly number[]): Float64Array {
    const key = from.join(",");
    const hit = this.dists.get(key);
    if (hit) return hit;
    const dist = new Float64Array(this.nodes.length).fill(Infinity), done = new Uint8Array(this.nodes.length);
    // (A binary min-heap of nodes by dist at push; a node pushed again is skipped once done.)
    const hd: number[] = [], hv: number[] = [];
    const swap = (i: number, j: number) => { [hd[i], hd[j]] = [hd[j], hd[i]]; [hv[i], hv[j]] = [hv[j], hv[i]]; };
    const push = (d: number, v: number) => {
      let i = hd.push(d) - 1; hv.push(v);
      while (i > 0 && hd[(i - 1) >> 1] > hd[i]) { swap(i, (i - 1) >> 1); i = (i - 1) >> 1; }
    };
    for (const v of from) { dist[v] = 0; push(0, v); }
    while (hd.length) {
      const d = hd[0], v = hv[0], ld = hd.pop()!, lv = hv.pop()!;
      if (hd.length) {
        hd[0] = ld; hv[0] = lv;
        for (let i = 0; ;) {
          const l = i * 2 + 1, r = l + 1; let m = i;
          if (l < hd.length && hd[l] < hd[m]) m = l;
          if (r < hd.length && hd[r] < hd[m]) m = r;
          if (m === i) break;
          swap(i, m); i = m;
        }
      }
      if (done[v]) continue;
      done[v] = 1;
      for (const a of this.nodes[v].arms) {
        const st = this.streets[a.street];
        if (!st.inCity || (st.oneway && a.end === 1)) continue;
        const w = a.end === 0 ? st.n1 : st.n0, dw = d + st.len;
        if (dw < dist[w]) { dist[w] = dw; push(dw, w); }
      }
    }
    this.dists.set(key, dist);
    if (this.dists.size > 24) this.dists.delete(this.dists.keys().next().value!);
    return dist;
  }
  // Whether face f's kerb can be driven along (its dedge isn't the wrong way up a one-way street):
  // where a stop on that side can be.
  drivable(f: number) { const st = this.streets[f >> 1]; return !st.oneway || (f & 1) === 0; }
  prevFace(f: number) {
    const b = this.faceBlock[f];
    if (b < 0) return f;
    const F = this.blocks[b].faces, i = F.indexOf(f);
    return F[(i + F.length - 1) % F.length];
  }
  // The face across the street from f's end, reached by crossing the street ahead at f's end node
  // (the next face on the same side, past the intersection): the face continuing f's line.
  faceAcross(f: number): number {
    const mv = this.movesFrom(f).filter((m) => m.move === "S");
    if (!mv.length) return -1;
    mv.sort((p, q) => Math.abs(p.turn) - Math.abs(q.turn));
    return mv[0].to;
  }
}
const EMPTY_TILE = { nodes: [] as number[], streets: [] as number[], blocks: [] as number[] };
export const tileKey = (cx: number, cz: number) => (cx + 4096) * 8192 + (cz + 4096);
// The part of a polygon (convex, or else its pieces come out joined by zero-width seams) where nx*x + nz*z <= c.
export function clipHalf(poly: [number, number][], nx: number, nz: number, c: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = nx * a[0] + nz * a[1] - c, db = nx * b[0] + nz * b[1] - c;
    if (da <= 0) out.push(a);
    // (Only strictly across the line: a corner on it is pushed once, as itself.)
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
export function inPoly(poly: [number, number][], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
// Distance from (x, z) to a polygon's edge.
export function polyDist(poly: [number, number][], x: number, z: number) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, az] = poly[j], [bx, bz] = poly[i], dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
    const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
