// The city layout generator (cityGraph): a city's street graph (citygraph.ts) from its seed, as the
// edges of its blocks' cells, one point a block. With the points left on the grid's lattice it is
// the original square grid, node for node and street for street (node (ix, iz) at (ix*60 + 9,
// iz*60 + 9), every block 42 m square, gate streets running one block straight out of town); moved
// a little (a warped town) or a lot and evened out (an organic one), the streets move with them.
// Every feature (avenues, rings, parks, the river, one-ways...) is laid the same in any of them.
import { CityGraph, clipHalf, inPoly } from "./citygraph.ts";
import type { CGate, CStreet } from "./citygraph.ts";
import { BLOCK, STREET } from "./grid.ts";
import { hash2 } from "./rng.ts";

export interface GridGate { ix: number; iz: number; dir: number }
export interface GridOpts {
  lo: number; hi: number;                       // the city's blocks: [lo, hi] on both axes
  gates: GridGate[];                            // perimeter nodes and the way out of town (0 east, 1 north, 2 west, 3 south)
  nameEW: (iz: number) => string; nameNS: (ix: number) => string;
  elevatedRow: (iz: number) => boolean;         // an elevated line along the east-west street of node row iz
  cableColumn: (ix: number) => boolean;         // a cable-car line along the north-south street of node column ix
  // A one-way street the lattice segment from node (ix, iz) east (ew) or south should be: +1 driven
  // that way (east or south), -1 the other, 0 two-way. (cityGraph keeps it only where its line runs
  // on at both ends the same way, and only if every street can still reach every other.)
  oneway?: (ix: number, iz: number, ew: boolean) => number;
}
const GEN_DX = [1, 0, -1, 0], GEN_DZ = [0, -1, 0, 1];

// After finish: a roundabout gives way to traffic on its ring (no signals round it), and a
// circus's or roundabout's middle (the block round each point given) is a park.
function ringsDone(g: CityGraph, ringNodes: number[], middles: [number, number][]) {
  for (const id of ringNodes) { const N = g.nodes[id]; N.control = "none"; N.phases = 1; N.phaseOf.fill(0); }
  for (const [x, z] of middles) { const b = g.blockAt(x, z); if (b) b.park = true; }
}


// The organic preset of cityGraph: no grid underneath. Points scattered over the town (a jittered
// lattice a block apart, evened out) each take the land nearest them (a Voronoi cell, clipped to the town's square);
// the cells' edges are the streets, so junctions are mostly Y and T, at any angle, and blocks are
// irregular polygons. Edges shorter than MERGE_EDGE close up into one junction. The town's edge
// is a street all round, with the gates on it where the grid has them, and gate streets out.
const MERGE_EDGE = 24;
// An organic town's extras (OrganicOpts):
// `river`: a river winding across town from the west edge to the east, entering and leaving
// between gates: a chain of cells, each sharing a street with the next, that are water instead
// (their streets along it its quays). Of the streets across it, between one cell and the next,
// about one in three is a bridge (never three missing in a row); the rest are left out.
// `sea`: in a town on the sea (outline.ts), which side it is on and where: the river runs out into
// it instead, from the land's far edge (or, with the sea to the north or south, from the west or
// east edge, bending round to it), ending at the last cell short of the sea. The street between
// that cell and the sea's is its mouth: kept as the town's shore street, water both sides, a
// bridge (trimToOutline drops the sea's cells beyond).
// `rounds`: a roundabout each (its name), where it fits: a junction well inside town, away from
// the river and the sea, its cells laid out round it so its streets in are long enough; the
// junction gives way to a one-way ring (ORG_ROUND_R metres out) round a round park, with the
// streets running in.
// `avenues`: smooth lines laid first, each a street the whole way across town (an elevated line's,
// a cable car's: `tag`), from `from` on one edge to `to` on the other (world z on the west and east
// edges; with `ns`, world x on the north and south), bowing gently between (none at its ends, so it
// meets the edges square, on the line the grid's would run on). Pairs of points either side of it,
// a little over a block apart, make the cells' edges between them lie along it; the other streets
// meet it at junctions. (city.ts avenuesWhole checks each came through whole.)
// (`line`: its way given instead, as points; its pairs from `pairsFrom` metres along it on: a
// freeway's, straight through the grid's patch and on round its curve.)
export interface OrganicAvenue { ns: boolean; from: number; to: number; tag: "elevated" | "cable" | "freeway"; name: string; line?: [number, number][]; pairsFrom?: number; amp?: number }   // amp: its bow given (metres, either way), kept as given
// `patch`: a rectangle of the town (world x0..x1, z0..z1) laid out as the grid would be, its points
// the blocks' middles, so its streets and junctions are the grid's own, square and keyed as the
// grid's (the freeway's interchange is built on them); `cuts` leaves out its streets as the grid's
// (a slip ramp's superblock).
export interface OrganicOpts { river?: boolean; rounds?: string[]; sea?: { side: number; inSea: (x: number, z: number) => boolean }; avenues?: OrganicAvenue[];
  patch?: { x0: number; z0: number; x1: number; z1: number }; cuts?: { ix: number; iz: number; ew: boolean }[] }
const AV_SPACING = 52, AV_HALF = 30, AV_NEAR = 4;
const ORG_ROUND_R = 26;
type FE = { a: number; b: number; name?: string; ring?: boolean; wet?: [number, number][]; tag?: "elevated" | "cable" | "freeway"; twoWay?: boolean; av?: number };   // wet: a water cell's point on each side that is river
// A lattice segment: from node (ix, iz) east (ew) or south.
type Seg = { ix: number; iz: number; ew: boolean };

// ---- the town's outline (outline.ts) -----------------------------------------------------------
// Cuts a layout's graph (over the whole square) back to the town's outline: a block is kept if its
// middle is on the land (a river's water too), the rest dropped (beyond the land's edge, or in
// the sea). A street stays if it borders a kept block: so the land's edge streets stay, the
// shore's streets with the sea beyond them, and a river's bridges. Then each gate that can be open
// gets its street: straight in along its line from its outer end to the first street it meets,
// split there; or where that is within SPLIT_MIN of a node (a piece that short has no room for its
// junctions' corners), at that node, moved onto the line if it isn't on it (as an organic town's
// corners move onto its gates) where its streets are all straight. Closed if its street would
// cross the sea or meets nothing. Null if the town falls apart or the entry gate can't be reached.
export interface TrimOutline {
  inLand(x: number, z: number): boolean;
  inSea(x: number, z: number): boolean;
  gateLine(i: number): { x: number; z: number; dx: number; dz: number };
  gatePossible(i: number): boolean;
}
const SPLIT_MIN = 24, GATE_REACH = 4.5 * BLOCK;
export function trimToOutline(G: CityGraph, O: TrimOutline, gates: { ix: number; iz: number; dir: number }[], entry: number): CityGraph | null {
  const kind = G.blocks.map((b) => (O.inLand(b.cx, b.cz) ? (b.water ? 2 : 1) : 0));
  const keepSt = G.streets.map((st) => st.gate < 0 && [G.faceBlock[st.id * 2], G.faceBlock[st.id * 2 + 1]].some((b) => b >= 0 && kind[b] > 0));
  const g = new CityGraph(), nodeOf = new Map<number, number>();
  const node = (id: number) => { let n = nodeOf.get(id); if (n === undefined) { const N = G.nodes[id]; nodeOf.set(id, n = g.addNode(N.x, N.z, N.kx, N.kz)); } return n; };
  const opts = (st: CStreet) => ({ half: st.half, kerb: st.kerb, name: st.name, inCity: st.inCity, tags: st.tags, oneway: st.oneway, ring: st.ring, k: st.k, h0: st.h0, len: st.len });
  // (Kept streets, as a list we can split: [n0, n1, the old street, its s from..to].)
  type Piece = { a: number; b: number; st: CStreet; s0: number; s1: number };
  const pieces: Piece[] = [];
  G.streets.forEach((st, i) => { if (keepSt[i]) pieces.push({ a: node(st.n0), b: node(st.n1), st, s0: 0, s1: st.len }); });
  if (!pieces.length) return null;
  // Gate streets: the ray in along each gate's line, to the first piece it meets.
  const out: (CGate | null)[] = gates.map(() => null), gateSt: { i: number; inner: number; outer: number }[] = [];
  const P = { x: 0, z: 0, h: 0 };
  // (A piece's point at s: a straight one's between its nodes as they are now, one perhaps moved
  // onto an earlier gate's line; an arc's, whose nodes don't move, on its old street.)
  const ptOf = (pc: Piece, s: number) => {
    if (Math.abs(pc.st.k) > 1e-9) { G.streetPt(pc.st.id, s, 0, P); return; }
    const A = g.nodes[pc.a], B = g.nodes[pc.b], t = (s - pc.s0) / (pc.s1 - pc.s0);
    P.x = A.x + (B.x - A.x) * t; P.z = A.z + (B.z - A.z) * t;
  };
  gates.forEach((gt, i) => {
    if (!O.gatePossible(i)) return;
    const L = O.gateLine(i);
    let best = Infinity, bp = -1, bs = 0;
    pieces.forEach((pc, pi) => {
      // (The piece as a polyline: straight, or an arc in 4 m steps.)
      const n = Math.abs(pc.st.k) < 1e-9 ? 1 : Math.max(1, Math.ceil((pc.s1 - pc.s0) / 4));
      let px = 0, pz = 0;
      for (let k = 0; k <= n; k++) {
        const s = pc.s0 + (pc.s1 - pc.s0) * k / n;
        ptOf(pc, s);
        if (k > 0) {
          const ex = P.x - px, ez = P.z - pz, den = L.dx * ez - L.dz * ex;
          const wx = px - L.x, wz = pz - L.z;
          if (Math.abs(den) < 1e-9) {
            // (Along the line: its nearer end, if it lies on the line ahead.)
            if (Math.abs(wx * L.dz - wz * L.dx) < 0.5) for (const [qx, qz, qs] of [[px, pz, s - (pc.s1 - pc.s0) / n], [P.x, P.z, s]]) {
              const d = (qx - L.x) * L.dx + (qz - L.z) * L.dz;
              if (d >= 0 && d < best) { best = d; bp = pi; bs = qs; }
            }
          } else {
            const d = (wx * ez - wz * ex) / den, u = (wx * L.dz - wz * L.dx) / den;
            if (d >= 0 && u >= -1e-6 && u <= 1 + 1e-6 && d < best) { best = d; bp = pi; bs = s - (pc.s1 - pc.s0) / n + u * (pc.s1 - pc.s0) / n; }
          }
        }
        px = P.x; pz = P.z;
      }
    });
    if (bp < 0 || best > GATE_REACH || best < BLOCK - 1) return;
    for (let d = 0; d < best; d += 4) if (O.inSea(L.x + L.dx * d, L.z + L.dz * d)) return;
    // The inner end: a node of the piece if one is near (moved onto the line), else the piece split there.
    const pc = pieces[bp];
    let inner: number;
    if (bs - pc.s0 < SPLIT_MIN || pc.s1 - bs < SPLIT_MIN) {
      inner = bs - pc.s0 < pc.s1 - bs ? pc.a : pc.b;
      const N = g.nodes[inner], hx = L.x + L.dx * best, hz = L.z + L.dz * best;
      if (Math.hypot(N.x - hx, N.z - hz) > 0.5) {
        if (pieces.some((q) => (q.a === inner || q.b === inner) && Math.abs(q.st.k) > 1e-9) || gateSt.some((q) => q.inner === inner)) return;
        N.x = hx; N.z = hz;
      }
    } else {
      ptOf(pc, bs);
      inner = g.addNode(P.x, P.z, 7000 + i, 7000);
      pieces.splice(bp, 1, { ...pc, b: inner, s1: bs }, { ...pc, a: inner, s0: bs });
    }
    const outer = g.addNode(L.x, L.z, 8000 + i, 8000);
    gateSt.push({ i, inner, outer });
  });
  if (!gateSt.some((q) => q.i === entry)) return null;
  for (const pc of pieces) {
    G.streetPt(pc.st.id, pc.s0, 0, P);
    g.addStreet(pc.a, pc.b, { ...opts(pc.st), h0: P.h, len: pc.s1 - pc.s0 });
  }
  for (const q of gateSt) {
    const gt = gates[q.i], ew = gt.dir === 0 || gt.dir === 2, src = G.gates[q.i] ? G.streets[G.gates[q.i]!.street] : null;
    const sid = g.addStreet(q.inner, q.outer, { name: src?.name ?? (ew ? `${gt.iz}` : `${gt.ix}`), inCity: false });
    g.streets[sid].gate = q.i;
    out[q.i] = { node: q.inner, street: sid, out: 1 };
  }
  g.gates.push(...out);
  g.finish();
  // (Connected: every node reached from the entry gate's.)
  const adj = g.nodes.map(() => [] as number[]);
  for (const st of g.streets) { adj[st.n0].push(st.n1); adj[st.n1].push(st.n0); }
  const seen = new Set([out[entry]!.node]), todo = [out[entry]!.node];
  while (todo.length) for (const n of adj[todo.pop()!]) if (!seen.has(n)) { seen.add(n); todo.push(n); }
  if (seen.size !== g.nodes.length) return null;
  // The blocks' flags from the old graph's (a river's water, a park), and a block the kept streets
  // close round that was dropped: water if it lies in the sea, else land.
  for (const b of g.blocks) {
    const old = G.blockAt(b.cx, b.cz);
    if (old) { b.water = old.water; b.park = old.park; b.inCity = old.inCity; }
    if (O.inSea(b.cx, b.cz)) { b.water = true; b.inCity = false; }
    if (b.park || b.water) b.anchor = null;
  }
  // (Roundabouts give way: no signals round their rings.)
  const ringNodes = new Set<number>();
  for (const st of g.streets) if (st.ring) { ringNodes.add(st.n0); ringNodes.add(st.n1); }
  ringsDone(g, [...ringNodes], []);
  return g;
}

// ---- the one generator ------------------------------------------------------------------------
// Which streets are one way, and which way (+1 east or south along its run: its larger x, for one
// running more east-west than north-south, else its larger z), for streets at any angle (on the
// lattice, as downtown grids are: each line one way, the next the other). A street's line: the streets carrying straight on (within ONE_WAY_TURN) at
// each end, each the other's best; o.oneway asks by the lattice line it lies along and the block
// beside it. Kept only where its line runs on at both ends the same way (or two way); a block every
// side of which runs the wrong way for its kerb has its northernmost side two way; and none at all
// if then the streets aren't all reachable from one another, driving the right way.
const ONE_WAY_TURN = 20 * Math.PI / 180;
function oneWayDirs<E extends { a: number; b: number; k: string }>(o: GridOpts, es: E[], verts: [number, number][], cells: { c: [number, number]; sides: string[] }[]): Map<E, number> {
  const dirs = new Map<E, number>();
  if (!o.oneway) return dirs;
  const byKey = new Map(es.map((e) => [e.k, e])), at = new Map<number, E[]>();
  for (const e of es) for (const v of [e.a, e.b]) { let l = at.get(v); if (!l) at.set(v, l = []); l.push(e); }
  const ewOf = (e: E) => Math.abs(verts[e.b][0] - verts[e.a][0]) > Math.abs(verts[e.b][1] - verts[e.a][1]);
  // (Its heading leaving v.)
  const hOut = (e: E, v: number) => { const w = e.a === v ? e.b : e.a; return Math.atan2(verts[w][1] - verts[v][1], verts[w][0] - verts[v][0]); };
  const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  // (The street carrying straight on from e through v, if any: the straightest, each the other's.)
  const best = (e: E, v: number) => { let m: E | undefined, bt = ONE_WAY_TURN; for (const q of at.get(v) ?? []) { if (q === e || ewOf(q) !== ewOf(e)) continue; const t = Math.PI - turn(hOut(e, v), hOut(q, v)); if (t < bt) { bt = t; m = q; } } return m; };
  const onAt = (e: E, v: number) => { const q = best(e, v); return q && best(q, v) === e ? q : undefined; };
  // (Its ends: the one at its smaller x or z, along its run, first.)
  const ends = (e: E): [number, number] => { const A = verts[e.a], B = verts[e.b]; return (ewOf(e) ? A[0] <= B[0] : A[1] <= B[1]) ? [e.a, e.b] : [e.b, e.a]; };
  for (const e of es) {
    const [p, q] = ends(e), P = verts[p], Q = verts[q], ew = ewOf(e);
    // (Which lattice line it lies along, and the block it starts from along it.)
    const line = Math.round((((ew ? P[1] + Q[1] : P[0] + Q[0]) / 2) - STREET / 2) / BLOCK), from = Math.floor(((ew ? P[0] : P[1]) - STREET / 2) / BLOCK + 1e-6);
    const d = ew ? o.oneway(from, line, true) : o.oneway(line, from, false);
    if (d) dirs.set(e, Math.sign(d));
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const [e, d] of dirs) {
      const [p, q] = ends(e), runs = (n: E | undefined) => !!n && (dirs.get(n) ?? d) === d;
      if (!runs(onAt(e, p)) || !runs(onAt(e, q))) { dirs.delete(e); changed = true; }
    }
  }
  // (Nor a block every side of which runs the wrong way for its kerb, where the truck could never
  // stop: its northernmost side two way instead. A side's kerb is on the right of its traffic.)
  const kerbOk = (e: E, c: [number, number]) => {
    const d = dirs.get(e);
    if (!d) return true;
    const [p, q] = ends(e), [s, t] = d > 0 ? [p, q] : [q, p], S = verts[s], T = verts[t];
    // (The block on the right of traffic from S to T: z is south, so right is (-dz, dx) turned... (x east, z south: right of (dx, dz) is (-dz, dx)).)
    return (-(T[1] - S[1])) * (c[0] - S[0]) + (T[0] - S[0]) * (c[1] - S[1]) > 0;
  };
  const north = new Map<E, { c: [number, number]; sides: string[] }>();
  for (const cell of cells) {
    const sides = cell.sides.map((k) => byKey.get(k)).filter((e): e is E => !!e);
    if (!sides.length) continue;
    const n = sides.reduce((m, e) => (verts[e.a][1] + verts[e.b][1] < verts[m.a][1] + verts[m.b][1] ? e : m));
    north.set(n, cell);
  }
  for (const e of es) {
    const cell = north.get(e);
    if (!cell || !dirs.has(e)) continue;
    const sides = cell.sides.map((k) => byKey.get(k)).filter((q): q is E => !!q);
    if (sides.every((q) => dirs.has(q) && !kerbOk(q, cell.c))) dirs.delete(e);
  }
  if (!dirs.size) return dirs;
  // (Every corner reached from one, both driving the right way and against it: strongly connected.)
  const fwd = new Map<number, number[]>(), back = new Map<number, number[]>();
  const arc = (m: Map<number, number[]>, a: number, b: number) => { let l = m.get(a); if (!l) m.set(a, (l = [])); l.push(b); };
  for (const e of es) {
    const [p, q] = ends(e), d = dirs.get(e) ?? 0;
    if (d >= 0) { arc(fwd, p, q); arc(back, q, p); }
    if (d <= 0) { arc(fwd, q, p); arc(back, p, q); }
  }
  const all = new Set([...fwd.keys(), ...back.keys()]), start = all.values().next().value!;
  const reach = (m: Map<number, number[]>) => { const seen = new Set([start]), todo = [start]; while (todo.length) for (const n of m.get(todo.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); todo.push(n); } return seen.size; };
  if (reach(fwd) !== all.size || reach(back) !== all.size) dirs.clear();
  return dirs;
}

// A town's streets as the edges of its blocks' cells: one point a block, from the block's middle on
// the grid's lattice, each taking the land nearest it (a Voronoi cell, clipped to the town's
// square). Where the points stay on the lattice the cells are the grid's own blocks, their corners
// its junctions (snapped exactly onto it, keyed as the grid keys them, and added in the grid's
// order, so a grid town's streets, nodes and blocks are the grid's, id for id); where they move,
// the cells and their streets move with them, and corners closer than MERGE_EDGE become one.
// `move`: how far the point of block (bx, bz) moves from its middle; `relax`: how far, twice over,
// it then moves on towards its cell's middle (0 to 1: an organic town's cells even out).
// With them, all a town's features, each laid the same whatever the town (see CityOpts).
export interface CityRing { x: number; z: number; name: string; n?: number; r?: number; oneway?: boolean; arms?: number }   // n: points round it; r: the ring's radius; oneway: a roundabout (gives way, no signals); arms: the most streets in
export interface CityOpts extends OrganicOpts {
  move?: (bx: number, bz: number) => [number, number];
  relax?: (bx: number, bz: number) => number;
  riverLine?: [number, number][];                 // the river's line given (else, with `river`, one that meanders)
  rings?: CityRing[];                             // roundabouts and circuses, at (or near) their places: the first clear of the rest
  ringNames?: string[];                           // (with candidate places for rings: as many as these, named so in turn, three to five streets in)
  parks?: [number, number][];                     // superblock parks: four blocks each, (bx, bz) to (bx+1, bz+1), the streets between them left out
  diagonals?: { ix: number; iz: number; dx: number; dz: number; n: number; name: string }[];   // corner to corner across blocks, from junction (ix, iz)
  drop?: { p: (x: number, z: number, ew: boolean) => number; keep: (ax: number, az: number, bx: number, bz: number) => boolean };   // streets left out (big plots), never one `keep` refuses
}
export function cityGraph(o: GridOpts, seed: number, x: CityOpts = {}): CityGraph {
  type P = [number, number];
  const at = (i: number) => i * BLOCK + STREET / 2, X0 = at(o.lo), X1 = at(o.hi + 1), Z0 = X0, Z1 = X1;
  const h = (salt: number) => hash2(seed, 0x0c9, 0, salt);
  // The points: each block's middle, moved; `blk`: whose each is (a pair's or a ring's: none).
  let pts: P[] = [], blk: (P | null)[] = [];
  for (let bz = o.lo; bz <= o.hi; bz++) for (let bx = o.lo; bx <= o.hi; bx++) {
    const [dx, dz] = x.move?.(bx, bz) ?? [0, 0];
    pts.push([at(bx) + BLOCK / 2 + dx, at(bz) + BLOCK / 2 + dz]); blk.push([bx, bz]);
  }
  const keepPts = (ok: (p: P) => boolean) => { const np: P[] = [], nb: (P | null)[] = []; pts.forEach((p, i) => { if (ok(p)) { np.push(p); nb.push(blk[i]); } }); pts = np; blk = nb; };
  // Each point's cell: the town's square, cut by the bisector with each point near it.
  const cellsOf = () => pts.map(([px, pz]) => {
    let poly: P[] = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]];
    for (const [qx, qz] of pts) {
      if ((qx === px && qz === pz) || Math.abs(qx - px) > BLOCK * 3 || Math.abs(qz - pz) > BLOCK * 3) continue;
      const nx = qx - px, nz = qz - pz;
      poly = clipHalf(poly, nx, nz, (nx * (px + qx) + nz * (pz + qz)) / 2);
    }
    return poly;
  });
  // (Twice, each point moves on towards its cell's centroid, as far as `relax` says.)
  if (x.relax) for (let it = 0; it < 2; it++) cellsOf().forEach((c, i) => {
    const w = blk[i] ? x.relax!(blk[i]![0], blk[i]![1]) : 0;
    if (w <= 0) return;
    let A = 0, cx = 0, cz = 0;
    for (let k = 0; k < c.length; k++) { const [x0, z0] = c[k], [x1, z1] = c[(k + 1) % c.length], q = x0 * z1 - x1 * z0; A += q; cx += (x0 + x1) * q; cz += (z0 + z1) * q; }
    if (Math.abs(A) > 1) pts[i] = [pts[i][0] + (cx / (3 * A) - pts[i][0]) * w, pts[i][1] + (cz / (3 * A) - pts[i][1]) * w];
  });
  // The avenues' lines, sampled; and their points (the pairs either side) in place of those near.
  // (A line given with pairsFrom past its end lies along the lattice already: no pairs.)
  const avLines = (x.avenues ?? []).map((av, ai) => {
    if (av.line) return { av, line: av.line };
    const ha = (k: number) => hash2(seed, 0xa7e + ai, Math.round(av.from), k);
    const lo = (av.ns ? X0 : Z0) + 1.6 * BLOCK, hi = (av.ns ? X1 : Z1) - 1.6 * BLOCK;
    const amp = av.amp ?? (0.5 + 0.6 * ha(1)) * BLOCK * (ha(2) < 0.5 ? -1 : 1), sBend = ha(3) < 0.4;
    const line: P[] = [];
    for (let k = 0; k <= 96; k++) {
      const t = k / 96, u = t * t * (3 - 2 * t), env = Math.sin(Math.PI * t) ** 2;
      const bow = av.from + (av.to - av.from) * u + amp * env * (sBend ? 2 * Math.cos(Math.PI * t) : 1), off = av.amp !== undefined ? bow : Math.max(lo, Math.min(hi, bow));
      const along = (av.ns ? Z0 : X0) + ((av.ns ? Z1 - Z0 : X1 - X0) * t);
      line.push(av.ns ? [off, along] : [along, off]);
    }
    return { av, line };
  });
  const segD = (px: number, pz: number, [ax, az]: P, [bx, bz]: P) => { const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(px - ax - dx * t, pz - az - dz * t); };
  const avOff = (px: number, pz: number, L: P[]) => { let m = Infinity; for (let i = 0; i + 1 < L.length; i++) m = Math.min(m, segD(px, pz, L[i], L[i + 1])); return m; };
  const paired = avLines.filter(({ av, line }) => (av.pairsFrom ?? 0) < line.length * 1e6);
  const avNear = (px: number, pz: number) => paired.some(({ line }) => avOff(px, pz, line) < AV_NEAR);
  for (const { av, line } of paired) {
    const cum = [0];
    for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
    const L = cum[cum.length - 1], from = av.pairsFrom ?? 0;
    if (from >= L) continue;
    // (The points near it give way to its pairs: near the part of it they lie along, from pairsFrom on.)
    const i0 = Math.max(0, cum.findIndex((c) => c >= from) - 1), after = line.slice(i0);
    keepPts(([px, pz]) => avOff(px, pz, after) > BLOCK * 0.6);
    const n = Math.max(2, Math.round(L / AV_SPACING)), step = L / n;
    for (let k = 0; k < n; k++) {
      const sv = step * (k + 0.5);
      if (sv < from + step / 2) continue;
      let i = 0; while (i < line.length - 2 && cum[i + 1] < sv) i++;
      const [ax, az] = line[i], [bx, bz] = line[i + 1], f = (sv - cum[i]) / (cum[i + 1] - cum[i] || 1), l = Math.hypot(bx - ax, bz - az) || 1;
      const cx = ax + (bx - ax) * f, cz = az + (bz - az) * f, nx = -(bz - az) / l, nz = (bx - ax) / l;
      pts.push([cx + nx * AV_HALF, cz + nz * AV_HALF], [cx - nx * AV_HALF, cz - nz * AV_HALF]); blk.push(null, null);
    }
  }
  const PA = x.patch, inPatch = (px: number, pz: number, m = 0) => !!PA && px > PA.x0 - m && px < PA.x1 + m && pz > PA.z0 - m && pz < PA.z1 + m;
  // The grid's patch: its blocks' middles in place of whatever else is there (an avenue's pairs
  // crossing it: the avenue runs along its streets there).
  if (PA) {
    keepPts(([px, pz]) => !inPatch(px, pz, BLOCK * 0.6));
    for (let bz = Math.ceil((PA.z0 - STREET / 2 - BLOCK / 2) / BLOCK); bz * BLOCK + STREET / 2 + BLOCK / 2 < PA.z1; bz++)
      for (let bx = Math.ceil((PA.x0 - STREET / 2 - BLOCK / 2) / BLOCK); bx * BLOCK + STREET / 2 + BLOCK / 2 < PA.x1; bx++) { pts.push([at(bx) + BLOCK / 2, at(bz) + BLOCK / 2]); blk.push([bx, bz]); }
  }
  // (A junction of the lattice: within 0.6 m of one of its lines' crossings; where it is exactly.)
  const gridAt = (p: P): P | null => {
    const gx = Math.round((p[0] - STREET / 2) / BLOCK) * BLOCK + STREET / 2, gz = Math.round((p[1] - STREET / 2) / BLOCK) * BLOCK + STREET / 2;
    return Math.abs(gx - p[0]) < 0.6 && Math.abs(gz - p[1]) < 0.6 ? [gx, gz] : null;
  };
  // The river's line: given, or from the middle of a gap between gates on the west edge to one on
  // the east (the same gap or the next), meandering between (none at its ends, so it meets the
  // edges square); out to a sea to the north or south, bending round to run down to it.
  const gz = [...new Set(o.gates.filter((g) => g.dir === 0 || g.dir === 2).map((g) => at(g.iz)))].sort((p, q) => p - q);
  const gaps = gz.slice(1).map((z, i) => (z + gz[i]) / 2);
  const river = !!x.riverLine || (!!x.river && gaps.length > 0);
  const gi = Math.floor(h(1) * gaps.length), go = Math.max(0, Math.min(gaps.length - 1, gi + Math.floor(h(2) * 3) - 1));
  const zIn = gaps[gi] ?? 0, zOut = gaps[go] ?? 0, amp = (0.6 + 0.9 * h(3)) * BLOCK, waves = 1 + Math.floor(h(4) * 3), phase = h(5) * Math.PI * 2;
  const sea = x.sea, northSouth = !!sea && (sea.side === 1 || sea.side === 3);
  const gx = [...new Set(o.gates.filter((g) => g.dir === 1 || g.dir === 3).map((g) => at(g.ix)))].sort((p, q) => p - q);
  const gapsX = gx.slice(1).map((v, i) => (v + gx[i]) / 2);
  const fromEast = h(6) < 0.5, xOut = gapsX[Math.floor(h(7) * gapsX.length)] ?? (X0 + X1) / 2, zSea = sea?.side === 1 ? Z0 : Z1;
  let rLine: P[] = x.riverLine ?? [];
  if (!x.riverLine && river) {
    if (northSouth) for (let k = 0; k <= 32; k++) { const t = k / 32, ax = fromEast ? X1 : X0, u = 1 - t; rLine.push([u * u * ax + 2 * u * t * xOut + t * t * xOut, u * u * zIn + 2 * u * t * zIn + t * t * zSea]); }
    else for (let k = 0; k <= 64; k++) { const t = k / 64, z = zIn + (zOut - zIn) * t + amp * Math.sin(Math.PI * t) * Math.sin(Math.PI * waves * t + phase); rLine.push([X0 + (X1 - X0) * t, Math.max(Z0 + 2.5 * BLOCK, Math.min(Z1 - 2.5 * BLOCK, z))]); }
  }
  const riverOff = (px: number, pz: number) => avOff(px, pz, rLine);
  // The rings' places: kept clear of the river, the avenues, the patch, the sea and each other; the
  // points near each give way to n round it, so the cells' corner there is a junction of n streets.
  const sites: CityRing[] = [];
  // (`rounds`: roundabouts so named, at candidate places of their own, well inside town.)
  const ringNames = x.ringNames ?? x.rounds;
  const cands = x.rings ?? (x.rounds?.length ? Array.from({ length: 40 }, (_, t) => ({ x: X0 + 160 + h(100 + t) * (X1 - X0 - 320), z: Z0 + 160 + h(140 + t) * (Z1 - Z0 - 320), name: "" })) : []);
  for (const s0 of cands) {
    if (ringNames && sites.length >= ringNames.length) break;
    const k = sites.length, r = hash2(k, 0x70d, seed, 1);
    const s: CityRing = ringNames ? { ...s0, name: ringNames[k], n: (s0 as CityRing).n ?? (r < 0.7 ? 4 : r < 0.85 ? 3 : 5) } : s0;
    if (river && riverOff(s.x, s.z) < 150) continue;
    if (paired.some(({ line }) => avOff(s.x, s.z, line) < 160) || inPatch(s.x, s.z, 160)) continue;
    if (sea && [[0, 0], [150, 0], [-150, 0], [0, 150], [0, -150]].some(([dx, dz]) => sea.inSea(s.x + dx, s.z + dz))) continue;
    if (sites.some((q) => Math.hypot(q.x - s.x, q.z - s.z) < 340)) continue;
    sites.push(s);
  }
  for (const [k, s] of sites.entries()) {
    const n = s.n ?? 4, a0 = s.n === 8 ? Math.PI / 8 : hash2(k, 0x70d, seed, 2) * Math.PI * 2;
    keepPts(([px, pz]) => Math.hypot(px - s.x, pz - s.z) > 92);
    for (let i = 0; i < n; i++) { pts.push([s.x + Math.cos(a0 + (i * 2 * Math.PI) / n) * 60, s.z + Math.sin(a0 + (i * 2 * Math.PI) / n) * 60]); blk.push(null); }
  }
  const cells = cellsOf();
  const cellOf = new Map<string, number>();
  blk.forEach((b, i) => { if (b) cellOf.set(`${b[0]},${b[1]}`, i); });
  // Junctions: the cells' corners, merged where they coincide (cells share them; on the lattice,
  // exactly on it), then where the edge between them is short.
  const verts: P[] = [], key = new Map<string, number>();
  const vid = (p0: P) => {
    const p = gridAt(p0) ?? p0, kx = Math.round(p[0] * 2), kz = Math.round(p[1] * 2);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const i = key.get(`${kx + dx},${kz + dz}`);
      if (i !== undefined && Math.hypot(verts[i][0] - p[0], verts[i][1] - p[1]) < 0.5) return i;
    }
    const i = verts.length; verts.push([p[0], p[1]]); key.set(`${kx},${kz}`, i); return i;
  };
  const edges = new Map<string, [number, number]>(), cellEdges: [number, number][][] = cells.map(() => []);
  cells.forEach((c, ci) => {
    for (let i = 0; i < c.length; i++) {
      const a = vid(c[i]), b = vid(c[(i + 1) % c.length]);
      cellEdges[ci].push([a, b]);
      if (a !== b) edges.set(a < b ? `${a},${b}` : `${b},${a}`, a < b ? [a, b] : [b, a]);
    }
  });
  // (Union-find over merged corners; a corner on the town's edge keeps its place, on that edge; one
  // on the lattice, its place; one on an avenue, its line.)
  const parent = verts.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const onEdge = (p: P) => Math.min(Math.abs(p[0] - X0), Math.abs(p[0] - X1), Math.abs(p[1] - Z0), Math.abs(p[1] - Z1)) < 0.5;
  const corner = (p: P) => (Math.abs(p[0] - X0) < 0.5 || Math.abs(p[0] - X1) < 0.5) && (Math.abs(p[1] - Z0) < 0.5 || Math.abs(p[1] - Z1) < 0.5);
  // (Any two corners within a metre of each other, however they came there, become one: never two
  // junctions on the one spot, their streets meeting without one. Before merging, and again after.)
  const twins = () => {
    const atJ = new Map<string, number[]>();
    for (let i = 0; i < verts.length; i++) if (find(i) === i) {
      const kx = Math.floor(verts[i][0]), kz = Math.floor(verts[i][1]);
      let into = -1;
      for (let dz = -1; dz <= 1 && into < 0; dz++) for (let dx = -1; dx <= 1 && into < 0; dx++) for (const j of atJ.get(`${kx + dx},${kz + dz}`) ?? []) if (find(j) === j && Math.hypot(verts[j][0] - verts[i][0], verts[j][1] - verts[i][1]) < 1) { into = j; break; }
      // (An exact lattice corner keeps its place; so does one on the town's corner or edge.)
      if (into >= 0) { const I = verts[i], J = verts[into], gi = gridAt(I); if ((gi && gi[0] === I[0] && gi[1] === I[1]) || (corner(I) && !corner(J)) || (onEdge(I) && !onEdge(J))) verts[into] = I; parent[i] = into; continue; }
      const k = `${kx},${kz}`, l = atJ.get(k); if (l) l.push(i); else atJ.set(k, [i]);
    }
  };
  twins();
  // (The streets between distinct corners as they stand: built once a pass, kept up as merges are made.)
  let liveCache: number[][] | null = null;
  const liveEdges = () => (liveCache ??= [...edges.values()].map(([u, v]) => [find(u), find(v)]).filter(([u, v]) => u !== v));
  // (Whether merging corners a and b at m would have a street of either cross another.)
  const crosses = (a: number, b: number, m: P) => {
    const side = (p: P, q: P, r: P) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    const cut = (p: P, q: P, r: P, t: P) => side(p, q, r) * side(p, q, t) < 0 && side(r, t, p) * side(r, t, q) < 0;
    const live = liveEdges();
    for (const [u, v] of live) {
      if (!((u === a || u === b) !== (v === a || v === b))) continue;   // (a street of a or b's, not the one between them)
      const o = u === a || u === b ? v : u, Q = verts[o];
      for (const [x, y] of live) {
        if (x === a || x === b || y === a || y === b || x === o || y === o) continue;
        if (cut(m, Q, verts[x], verts[y])) return true;
      }
    }
    return false;
  };
  // (Pass after pass, while any merge is still made: a merged corner may leave a short street.)
  for (let pass = 0, more = true; pass < 12 && more; pass++) {
    more = false;
    const list = [...edges.values()].map(([a, b]) => [find(a), find(b)]).filter(([a, b]) => a !== b)
      .sort((p, q) => Math.hypot(verts[p[0]][0] - verts[p[1]][0], verts[p[0]][1] - verts[p[1]][1]) - Math.hypot(verts[q[0]][0] - verts[q[1]][0], verts[q[0]][1] - verts[q[1]][1]));
    for (const [a0, b0] of list) {
      const a = find(a0), b = find(b0);
      if (a === b) continue;
      const A = verts[a], B = verts[b];
      if (Math.hypot(A[0] - B[0], A[1] - B[1]) >= MERGE_EDGE) break;
      if (corner(A) && corner(B)) continue;
      const gA = gridAt(A), gB = gridAt(B);
      if (gA && gB) continue;
      const m: P = gA ?? gB ?? (corner(A) ? A : corner(B) ? B : onEdge(A) && !onEdge(B) ? A : onEdge(B) && !onEdge(A) ? B
        : avNear(A[0], A[1]) && !avNear(B[0], B[1]) ? A : avNear(B[0], B[1]) && !avNear(A[0], A[1]) ? B : [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]);
      // (Never so a street of either comes to cross another: then at the other corner, or between
      // them, if either is clear; else the two stay apart.)
      // (Only where neither is held to the lattice, the town's corner or its edge.)
      const held = !!(gA || gB) || corner(A) || corner(B) || onEdge(A) !== onEdge(B);
      const at2 = (held ? [m] : [m, A, B, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2] as P]).find((q) => !crosses(a, b, q));
      if (!at2) continue;
      verts[a] = [at2[0], at2[1]]; parent[b] = a; more = true; liveCache = null;
    }
  }
  // (Onto the lattice exactly; and twins again.)
  for (let i = 0; i < verts.length; i++) if (find(i) === i) { const g0 = gridAt(verts[i]); if (g0) verts[i] = g0; }
  twins();
  // The streets left: between distinct merged corners, once each. Which cells each borders
  // (two, or one round the town's edge), and which cells meet at each corner.
  const mk = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`);
  const sidesOf = new Map<string, Set<number>>(), cellsAt = new Map<number, Set<number>>();
  const addTo = <K>(m: Map<K, Set<number>>, k: K, v: number) => { let s = m.get(k); if (!s) m.set(k, s = new Set()); s.add(v); };
  cellEdges.forEach((l, ci) => { for (const [a0, b0] of l) { const a = find(a0), b = find(b0); addTo(cellsAt, a, ci); addTo(cellsAt, b, ci); if (a !== b) addTo(sidesOf, mk(a, b), ci); } });
  let fe: FE[] = [];
  const seen = new Set<string>();
  for (const [a0, b0] of edges.values()) {
    const a = find(a0), b = find(b0), k = mk(a, b);
    if (a !== b && !seen.has(k)) { seen.add(k); fe.push({ a, b }); }
  }
  // (A lattice segment's ends, (ix, iz) and the next junction east (ew) or south.)
  const latKey = (v: P): P | null => { const gq = gridAt(v); return gq && gq[0] === v[0] && gq[1] === v[1] ? [Math.round((v[0] - STREET / 2) / BLOCK), Math.round((v[1] - STREET / 2) / BLOCK)] : null; };
  const segOf = (e: FE): Seg | null => { const A = latKey(verts[e.a]), B = latKey(verts[e.b]); if (!A || !B || Math.abs(A[0] - B[0]) + Math.abs(A[1] - B[1]) !== 1) return null; const ew = A[1] === B[1]; return { ix: Math.min(A[0], B[0]), iz: Math.min(A[1], B[1]), ew }; };
  if (x.cuts?.length) fe = fe.filter((e) => { const sg = segOf(e); return !sg || !x.cuts!.some((c) => c.ix === sg.ix && c.iz === sg.iz && c.ew === sg.ew); });
  // Superblock parks: the streets between each one's four cells left out.
  const parkMid: P[] = [];
  for (const [px, pz] of x.parks ?? []) {
    const cs = [[px, pz], [px + 1, pz], [px, pz + 1], [px + 1, pz + 1]].map(([bx, bz]) => cellOf.get(`${bx},${bz}`));
    if (cs.some((c) => c === undefined)) continue;
    const set = new Set(cs as number[]);
    fe = fe.filter((e) => { const s = sidesOf.get(mk(e.a, e.b)); return !s || s.size < 2 || ![...s].every((c) => set.has(c)); });
    parkMid.push([(pts[cs[0]!][0] + pts[cs[3]!][0]) / 2, (pts[cs[0]!][1] + pts[cs[3]!][1]) / 2]);
  }
  // The river: the cheapest chain of cells from the cell nearest one end of its line to the one
  // nearest the other, each step costing its length, more the further the cell lies off the line
  // (none touching the north or south edge); its bridges, one in three or so.
  const water = new Set<number>();
  if (river && rLine.length > 1) {
    const adj = cells.map(() => new Set<number>());
    for (const s of sidesOf.values()) for (const i of s) for (const j of s) if (i !== j) adj[i].add(j);
    const along = (ci: number, v: number, ax: 0 | 1) => cells[ci].filter((p) => Math.abs(p[ax] - v) < 0.5).length >= 2;
    const wet = (ci: number) => !!sea && sea.inSea(pts[ci][0], pts[ci][1]);
    const banned = (ci: number) => along(ci, Z0, 1) || along(ci, Z1, 1) || wet(ci);
    const nearest = (p: P, edgeX: number | null) => { let best = -1, bd = Infinity; cells.forEach((_, ci) => { if (banned(ci) || (edgeX !== null && !along(ci, edgeX, 0))) return; const d = Math.hypot(pts[ci][0] - p[0], pts[ci][1] - p[1]); if (d < bd) { bd = d; best = ci; } }); return best; };
    const mouth = (px: number, pz: number) => { let best = -1, bd = Infinity; cells.forEach((_, ci) => { if (!banned(ci) && [...adj[ci]].some(wet)) { const d = Math.hypot(pts[ci][0] - px, pts[ci][1] - pz); if (d < bd) { bd = d; best = ci; } } }); return best; };
    const L0 = rLine[0], L1 = rLine[rLine.length - 1];
    // (A line given, as a warped town's along its row: from its own ends, out at the sea's mouth
    // only where one of them lies in the sea.)
    const given = !!x.riverLine, wetEnd = (p: P) => !!sea && sea.inSea(p[0], p[1]);
    const s0 = given ? (wetEnd(L0) ? mouth(L0[0], L0[1]) : nearest(L0, X0)) : !sea || sea.side === 0 ? nearest(L0, X0) : sea.side === 2 ? nearest(L1, X1) : nearest(L0, fromEast ? X1 : X0);
    const s1 = given ? (wetEnd(L1) ? mouth(L1[0], L1[1]) : nearest(L1, X1)) : !sea ? nearest(L1, X1) : sea.side === 0 ? mouth(L1[0], L1[1]) : sea.side === 2 ? mouth(L0[0], L0[1]) : mouth(xOut, zSea);
    if (s0 >= 0 && s1 >= 0) {
      const dist = cells.map(() => Infinity), prev = cells.map(() => -1), done = cells.map(() => false);
      dist[s0] = 0;
      for (;;) {
        let u = -1;
        for (let i = 0; i < cells.length; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
        if (u < 0 || u === s1) break;
        done[u] = true;
        for (const v of adj[u]) {
          if (done[v] || banned(v)) continue;
          const off = riverOff(pts[v][0], pts[v][1]) / 14, c = dist[u] + Math.hypot(pts[v][0] - pts[u][0], pts[v][1] - pts[u][1]) * (1 + off * off);
          if (c < dist[v]) { dist[v] = c; prev[v] = u; }
        }
      }
      const chain: number[] = [];
      if (dist[s1] < Infinity) for (let c = s1; c >= 0; c = prev[c]) chain.unshift(c);
      for (const c of chain) water.add(c);
      const bank = (v: number) => onEdge(verts[v]) || [...(cellsAt.get(v) ?? [])].some((c) => !water.has(c));
      const bridges = new Set<string>(), between = new Map<string, FE[]>();
      for (const e of fe) { const s = [...sidesOf.get(mk(e.a, e.b))!]; if (s.length === 2) { const k = mk(s[0], s[1]); between.set(k, [...(between.get(k) ?? []), e]); } }
      // (An avenue crossing it always on a bridge: its line passes between the two cells.)
      const avCross = (e: FE) => avLines.some(({ line }) => avOff((verts[e.a][0] + verts[e.b][0]) / 2, (verts[e.a][1] + verts[e.b][1]) / 2, line) < BLOCK * 0.6);
      let since = 0;
      for (let i = 0; i + 1 < chain.length; i++) for (const e of between.get(mk(chain[i], chain[i + 1])) ?? []) {
        if (!bank(e.a) || !bank(e.b)) continue;
        if (avCross(e)) { bridges.add(mk(e.a, e.b)); since = 0; continue; }
        if (since < 2 && hash2(i, 0x81d, seed, 0xb71) < 0.7) since++; else { since = 0; bridges.add(mk(e.a, e.b)); }
      }
      fe = fe.filter((e) => { const k = mk(e.a, e.b), s = sidesOf.get(k)!; return bridges.has(k) || s.size < 2 || ![...s].every((c) => water.has(c)); });
      for (const e of fe) { const w = [...sidesOf.get(mk(e.a, e.b))!].filter((c) => water.has(c)); if (w.length) e.wet = w.map((c) => pts[c]); }
    }
  }
  // Streets left out for big plots (drop): never along the town's edge, a quay or a street `keep`
  // refuses, only where each end keeps three streets, and never so the town splits in two.
  if (x.drop) {
    const deg = new Map<number, number>();
    for (const e of fe) for (const v of [e.a, e.b]) deg.set(v, (deg.get(v) ?? 0) + 1);
    const connected = () => {
      const adj = new Map<number, number[]>();
      for (const e of fe) { (adj.get(e.a) ?? adj.set(e.a, []).get(e.a)!).push(e.b); (adj.get(e.b) ?? adj.set(e.b, []).get(e.b)!).push(e.a); }
      const start = adj.keys().next().value!, seenV = new Set([start]), todo = [start];
      while (todo.length) for (const n of adj.get(todo.pop()!)!) if (!seenV.has(n)) { seenV.add(n); todo.push(n); }
      return seenV.size === adj.size;
    };
    const nearRing = (v: P) => sites.some((s) => Math.hypot(v[0] - s.x, v[1] - s.z) < (s.r ?? ORG_ROUND_R) + 2 * BLOCK);
    [...fe].forEach((e, i) => {
      const A = verts[e.a], B = verts[e.b], ew = Math.abs(B[0] - A[0]) > Math.abs(B[1] - A[1]);
      if (hash2(i, 7, seed, 0xd70) >= x.drop!.p((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, ew) || !x.drop!.keep(A[0], A[1], B[0], B[1])) return;
      if (e.wet || (onEdge(A) && onEdge(B)) || nearRing(A) || nearRing(B)) return;
      if ((deg.get(e.a) ?? 0) < 4 || (deg.get(e.b) ?? 0) < 4) return;
      const j = fe.indexOf(e);
      fe.splice(j, 1);
      if (!connected()) { fe.splice(j, 0, e); return; }
      deg.set(e.a, deg.get(e.a)! - 1); deg.set(e.b, deg.get(e.b)! - 1);
    });
  }
  const nameOf = (a: number, b: number) => {
    const [ax, az] = verts[a], [bx, bz] = verts[b];
    return Math.abs(bx - ax) > Math.abs(bz - az) ? o.nameEW(Math.round((((az + bz) / 2) - STREET / 2) / BLOCK)) : o.nameNS(Math.round((((ax + bx) / 2) - STREET / 2) / BLOCK));
  };
  // The rings: at the corner nearest each place, if its streets in are long enough, far enough
  // apart, and clear of the water and the town's edge. Its corners: one where each street comes
  // in, and more between so no side turns more than 60 degrees; anticlockwise seen from above.
  const ringVerts: number[] = [], islands: P[] = [], ringEdges: FE[] = [];
  for (const s of sites) {
    const R = s.r ?? ORG_ROUND_R, used = new Set(fe.flatMap((e) => [e.a, e.b])), n8 = (s.n ?? 4) >= 8;   // (a circus's eight arms are closer together)
    let v = -1, bd = 18;
    for (const r of used) { const d = Math.hypot(verts[r][0] - s.x, verts[r][1] - s.z); if (d < bd) { bd = d; v = r; } }
    if (v < 0) continue;
    const V = verts[v], arms = fe.filter((e) => e.a === v || e.b === v).map((e) => {
      const u = e.a === v ? e.b : e.a, U = verts[u];
      return { e, u, ang: Math.atan2(-(U[1] - V[1]), U[0] - V[0]), len: Math.hypot(U[0] - V[0], U[1] - V[1]) };
    }).sort((p, q) => p.ang - q.ang);
    const gapAfter = (i: number) => i + 1 < arms.length ? arms[i + 1].ang - arms[i].ang : arms[0].ang + 2 * Math.PI - arms[i].ang;
    const dry = (r: number) => ![...(cellsAt.get(r) ?? [])].some((c) => water.has(c));
    if (arms.length < 3 || arms.length > (s.arms ?? 6) || onEdge(V) || !dry(v) || arms.some((a, i) => a.len < R + 22 || gapAfter(i) < (n8 ? 0.55 : 0.8) || !dry(a.u) || onEdge(verts[a.u]))) continue;
    const segDist = ([ax, az]: P, [bx, bz]: P) => { const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((V[0] - ax) * dx + (V[1] - az) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(V[0] - ax - dx * t, V[1] - az - dz * t); };
    if (fe.some((e) => e.a !== v && e.b !== v && segDist(verts[e.a], verts[e.b]) < R + STREET)) continue;
    const drop = new Set(arms.map((a) => a.e));
    fe = fe.filter((e) => !drop.has(e));
    const ring: number[] = [], add = (ang: number) => { const i = verts.length; verts.push([V[0] + Math.cos(ang) * R, V[1] - Math.sin(ang) * R]); parent.push(i); ring.push(i); return i; };
    arms.forEach((a, i) => {
      fe.push({ a: add(a.ang), b: a.u, name: a.e.name ?? nameOf(a.e.a, a.e.b) });
      const g0 = gapAfter(i), n = Math.ceil(g0 / (Math.PI / 3)) - 1;
      for (let j = 1; j <= n; j++) add(a.ang + (g0 * j) / (n + 1));
    });
    ring.forEach((r, k) => { const e: FE = { a: r, b: ring[(k + 1) % ring.length], name: s.name, ring: true }; fe.push(e); ringEdges.push(e); if (s.oneway === false) e.twoWay = true; });
    if (s.oneway !== false) ringVerts.push(...ring);
    islands.push([V[0], V[1]]);
  }
  // Diagonals: corner to corner across a block, each step a street from one of its corners to the
  // one across it (inside the one cell, so crossing no street), named as its avenue.
  for (const dg of x.diagonals ?? []) for (let k = 0; k < dg.n; k++) {
    const near = (ix: number, iz: number) => { let best = -1, bd = 14; for (const r of new Set(fe.flatMap((e) => [e.a, e.b]))) { const d = Math.hypot(verts[r][0] - at(ix), verts[r][1] - at(iz)); if (d < bd) { bd = d; best = r; } } return best; };
    const a = near(dg.ix + dg.dx * k, dg.iz + dg.dz * k), b = near(dg.ix + dg.dx * (k + 1), dg.iz + dg.dz * (k + 1));
    if (a < 0 || b < 0) break;
    const shared = [...(cellsAt.get(a) ?? [])].filter((c) => cellsAt.get(b)?.has(c) && !water.has(c));
    if (!shared.length || fe.some((e) => mk(e.a, e.b) === mk(a, b))) break;
    fe.push({ a, b, name: dg.name });
  }
  // The gates: the town-edge corner nearest each gate's place, on the same side, moves onto it;
  // with none near, the edge street there gets a corner at it.
  const gatePos = o.gates.map((gt) => [at(gt.ix), at(gt.iz)] as P);
  const sameSide = (v: P, gp: P) => (Math.abs(gp[0] - X0) < 0.5 || Math.abs(gp[0] - X1) < 0.5) ? Math.abs(v[0] - gp[0]) < 0.5 : Math.abs(v[1] - gp[1]) < 0.5;
  for (const gp of gatePos) {
    const rs = [...new Set(fe.flatMap((e) => [e.a, e.b]))];
    let best = -1, bd = 30;
    for (const r of rs) { const v = verts[r]; if (corner(v) || !sameSide(v, gp)) continue; const d = Math.hypot(v[0] - gp[0], v[1] - gp[1]); if (d > 0.5 && avNear(v[0], v[1])) continue; if (d < bd) { bd = d; best = r; } }
    if (best >= 0) { verts[best] = [gp[0], gp[1]]; continue; }
    const i = fe.findIndex(({ a, b }) => sameSide(verts[a], gp) && sameSide(verts[b], gp) && Math.hypot(verts[a][0] - gp[0], verts[a][1] - gp[1]) + Math.hypot(verts[b][0] - gp[0], verts[b][1] - gp[1]) < Math.hypot(verts[a][0] - verts[b][0], verts[a][1] - verts[b][1]) + 0.5);
    if (i < 0) continue;
    const n = verts.length; verts.push([gp[0], gp[1]]); parent.push(n);
    const e = fe[i]; fe.splice(i, 1, { ...e, b: n }, { ...e, a: n });
  }
  // The avenues' streets: for each, the chain of streets from the corner nearest where its line
  // starts to the one nearest where it ends that keeps closest to its line: one unbroken run.
  for (const [ai, { av, line }] of avLines.entries()) {
    const adj = new Map<number, FE[]>();
    for (const e of fe) if (!e.ring) for (const v of [e.a, e.b]) { let l = adj.get(v); if (!l) adj.set(v, l = []); l.push(e); }
    const nearest = (p: P) => { let best = -1, bd = Infinity; for (const v of adj.keys()) { const d = Math.hypot(verts[v][0] - p[0], verts[v][1] - p[1]); if (d < bd) { bd = d; best = v; } } return best; };
    const s0 = nearest(line[0]), s1 = nearest(line[line.length - 1]);
    if (s0 < 0 || s1 < 0) continue;
    const cost = (e: FE) => { const A = verts[e.a], B = verts[e.b], off = Math.max(avOff(A[0], A[1], line), avOff(B[0], B[1], line), avOff((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, line)); return Math.hypot(B[0] - A[0], B[1] - A[1]) * (1 + (off / AV_NEAR) ** 2 * 4) + (e.av !== undefined && e.av !== ai ? 1e7 : 0); };   // (never along another avenue's street)
    const dist = new Map<number, number>([[s0, 0]]), prev = new Map<number, FE>(), done = new Set<number>();
    for (;;) {
      let u = -1, du = Infinity;
      for (const [v, d] of dist) if (!done.has(v) && d < du) { du = d; u = v; }
      if (u < 0 || u === s1) break;
      done.add(u);
      for (const e of adj.get(u) ?? []) { const w = e.a === u ? e.b : e.a, dw = du + cost(e); if (dw < (dist.get(w) ?? Infinity)) { dist.set(w, dw); prev.set(w, e); } }
    }
    for (let v = s1; v !== s0;) { const e = prev.get(v); if (!e) break; e.tag = av.tag; e.name = av.name; e.av = ai; v = e.a === v ? e.b : e.a; }
  }
  // One-way streets (oneWayDirs), the lattice's segments sorted first in the grid's order.
  type E = FE & { seg: Seg | null; k: string };
  const es: E[] = fe.filter((e) => !e.ring).map((e) => ({ ...e, seg: segOf(e), k: mk(e.a, e.b) }));
  const order = (e: E) => e.seg ? (e.seg.ew ? 0 : 1e9) + (e.seg.ew ? e.seg.iz * 1e5 + e.seg.ix : e.seg.ix * 1e5 + e.seg.iz) : 2e9;
  es.sort((p, q) => order(p) - order(q));
  const cellSides = cellEdges.map((l) => l.map(([a0, b0]) => mk(find(a0), find(b0))));
  const dirs = oneWayDirs(o, es, verts, cells.map((_, ci) => ({ c: pts[ci], sides: cellSides[ci] })));
  // The graph: the lattice's junctions first, row by row (as the grid adds them); then the rest,
  // keyed by the grid cell they fall in (gates by their own).
  const g = new CityGraph(), nodeOf = new Map<number, number>(), used = new Set<string>();
  const live = new Set(fe.flatMap((e) => [e.a, e.b]));
  const latIdx = [...live].map((i) => ({ i, k: latKey(verts[i]) })).filter((q) => q.k).sort((p, q) => p.k![1] - q.k![1] || p.k![0] - q.k![0]);
  for (const { i, k } of latIdx) { nodeOf.set(i, g.addNode(verts[i][0], verts[i][1], k![0], k![1])); used.add(`${k![0]},${k![1]}`); }
  o.gates.forEach((gt) => used.add(`${gt.ix},${gt.iz}`));
  const node = (r: number) => {
    let id = nodeOf.get(r);
    if (id === undefined) {
      const [vx, vz] = verts[r], gi = gatePos.findIndex((p) => Math.hypot(p[0] - vx, p[1] - vz) < 0.5);
      let kx = gi >= 0 ? o.gates[gi].ix : Math.floor((vx - STREET / 2) / BLOCK + 0.5), kz = gi >= 0 ? o.gates[gi].iz : Math.floor((vz - STREET / 2) / BLOCK + 0.5);
      if (gi < 0) { while (used.has(`${kx},${kz}`)) kz += 1000; used.add(`${kx},${kz}`); }
      id = g.addNode(vx, vz, kx, kz); nodeOf.set(r, id);
    }
    return id;
  };
  const streetEdge = new Map<number, FE>(), avTags = new Set(avLines.map(({ av }) => av.tag));
  for (const e of es) {
    if (e.wet) streetEdge.set(g.streets.length, e);
    const [ax, az] = verts[e.a], [bx, bz] = verts[e.b], ew = e.seg ? e.seg.ew : Math.abs(bx - ax) > Math.abs(bz - az);
    let [p, q] = ew ? (ax <= bx ? [e.a, e.b] : [e.b, e.a]) : (az <= bz ? [e.a, e.b] : [e.b, e.a]);
    const d = dirs.get(e) ?? 0;
    if (d < 0) [p, q] = [q, p];
    const name = e.name ?? (e.seg ? (e.seg.ew ? o.nameEW(e.seg.iz) : o.nameNS(e.seg.ix)) : nameOf(e.a, e.b));
    // (On the lattice, its line's tags as the grid gives them: unless an avenue carries that line here.)
    const tags = e.tag ? { [e.tag]: true } : e.seg ? (e.seg.ew ? (o.elevatedRow(e.seg.iz) && !avTags.has("elevated") ? { elevated: true } : {}) : (o.cableColumn(e.seg.ix) && !avTags.has("cable") ? { cable: true } : {})) : {};
    g.addStreet(node(p), node(q), { name, tags, oneway: d !== 0 });
  }
  // (A ring's sides are driven from a to b: one way round a roundabout, both ways round a circus.)
  for (const e of ringEdges) g.addStreet(node(e.a), node(e.b), { name: e.name, oneway: !e.twoWay, ring: !e.twoWay });
  // Gate streets: out to a node a block beyond the edge (outside the city: no blocks round it).
  o.gates.forEach((gt, i) => {
    const inner = g.node(gt.ix, gt.iz);
    if (!inner) return;
    const ox = gt.ix + GEN_DX[gt.dir], oz = gt.iz + GEN_DZ[gt.dir];
    const outer = g.node(ox, oz)?.id ?? g.addNode(at(ox), at(oz), ox, oz);
    const ew = gt.dir === 0 || gt.dir === 2;
    const sid = g.addStreet(inner.id, outer, { name: ew ? o.nameEW(gt.iz) : o.nameNS(gt.ix), inCity: false });
    g.streets[sid].gate = i;
    g.gates.push({ node: inner.id, street: sid, out: 1 });
  });
  g.finish();
  ringsDone(g, ringVerts.flatMap((r) => nodeOf.get(r) ?? []), islands);
  for (const [px, pz] of parkMid) { const b = g.blockAt(px, pz); if (b) b.park = true; }
  // The river's blocks: for each street along or over it, the block on its water side.
  for (const [sid, e] of streetEdge) for (const [wx, wz] of e.wet ?? []) {
    const st = g.streets[sid], A = g.nodes[st.n0], B = g.nodes[st.n1], mx = (A.x + B.x) / 2, mz = (A.z + B.z) / 2, L = st.len || 1;
    let nx = -(B.z - A.z) / L, nz = (B.x - A.x) / L;
    if (nx * (wx - mx) + nz * (wz - mz) < 0) { nx = -nx; nz = -nz; }
    const px = mx + nx * (st.half + 1), pz = mz + nz * (st.half + 1);
    for (const f of [sid * 2, sid * 2 + 1]) { const b = g.blocks[g.faceBlock[f]]; if (b && inPoly(b.poly, px, pz)) { b.water = true; b.inCity = false; } }
  }
  for (const b of g.blocks) if (b.park || b.water) b.anchor = null;
  return g;
}
