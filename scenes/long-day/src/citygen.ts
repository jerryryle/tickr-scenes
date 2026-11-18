// City layout generators: each makes a city's street graph (citygraph.ts) from its seed. `grid`
// is the original square grid, node for node and street for street: node (ix, iz) at
// (ix*60 + 9, iz*60 + 9), every block 42 m square, gate streets running one block straight out
// of town. The others (in stage 2 on) bend, drop and add streets.
import { CityGraph, clipHalf } from "./citygraph.ts";
import { BLOCK, STREET } from "./grid.ts";
import { hash2 } from "./rng.ts";

export interface GridGate { ix: number; iz: number; dir: number }
export interface GridOpts {
  lo: number; hi: number;                       // the city's blocks: [lo, hi] on both axes
  gates: GridGate[];                            // perimeter nodes and the way out of town (0 east, 1 north, 2 west, 3 south)
  nameEW: (iz: number) => string; nameNS: (ix: number) => string;
  elevatedRow: (iz: number) => boolean;         // an elevated line along the east-west street of node row iz
  cableColumn: (ix: number) => boolean;         // a cable-car line along the north-south street of node column ix
}
const GEN_DX = [1, 0, -1, 0], GEN_DZ = [0, -1, 0, 1];

// A grid bent out of square (`warp`): the same lattice of intersections, each but the fixed ones
// moved by up to `jitter` metres (smooth noise, so neighbouring streets lean together), and some
// street segments left out (`drop`: blocks merge, four-way crossings become T-junctions). Fixed:
// the city's edge, the gates, and whatever the caller keeps straight (the freeway's line, elevated
// and cable-car lines); a segment is only dropped where the network stays connected and every
// intersection keeps three streets or none.
// `river`: the row of blocks (iz) that is a river instead, its streets either side its quays, and
// about one in three of the streets across it bridges (the rest left out).
// `parks`: superblock parks, each four blocks (ix..ix+1, iz..iz+1) with the streets between them
// left out.
// `diagonals`: avenues cutting corner to corner across blocks, each from lattice node (ix, iz) by
// (dx, dz) = (+-1, +-1) for `n` blocks (through the intersections, so they cross no street between).
// `oldTown`: a district (centre and radius, in blocks) of streets bent much further out of square.
// `sweep`: long avenues bowed into gentle curves (metres of bow, and the wavelength in blocks).
export interface WarpOpts {
  seed: number; jitter: number; drop: number; fixed: (ix: number, iz: number) => boolean; keep: (ix: number, iz: number, ew: boolean) => boolean;
  river?: number; parks?: [number, number][]; diagonals?: { ix: number; iz: number; dx: number; dz: number; n: number; name: string }[];
  oldTown?: { ix: number; iz: number; r: number }; sweep?: { bow: number; wave: number };
  circuses?: { ix: number; iz: number; name: string; round?: boolean }[];   // round: a one-way roundabout (smaller, four streets in, no signals)
  cuts?: { ix: number; iz: number; ew: boolean }[];   // segments left out whatever else (a slip ramp's superblock)
  dropMore?: (ix: number, iz: number, ew: boolean) => number;   // extra chance a segment is left out (big plots: industry)
  bend?: (ix: number, iz: number) => number;                     // how much a node may move, as a share of the jitter (1 by default)
}
// A circus: lattice node (ix, iz) and the streets round it give way to a ring road round a round
// park, with eight streets running in to it: the four avenues that met there and four diagonals
// from the corners beyond. The ring:
// CIRCUS_R metres out, eight sides, an intersection where each street meets it.
const CIRCUS_R = 45, ROUND_R = 30;

export function gridGraph(o: GridOpts, warp: WarpOpts | null = null): CityGraph {
  const g = new CityGraph(), at = (i: number) => i * BLOCK + STREET / 2;
  const edge = (ix: number, iz: number) => ix <= o.lo || ix >= o.hi + 1 || iz <= o.lo || iz >= o.hi + 1;
  // Smooth jitter: value noise over a 3-block lattice, per axis.
  const noise = (x: number, z: number, salt: number) => {
    const gx = x / 3, gz = z / 3, ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz), h = (a: number, b: number) => hash2(a, b, warp!.seed, salt) * 2 - 1;
    const p = h(ix, iz) + (h(ix + 1, iz) - h(ix, iz)) * sx, q = h(ix, iz + 1) + (h(ix + 1, iz + 1) - h(ix, iz + 1)) * sx;
    return (p + (q - p) * sz) * 0.6 + (hash2(x, z, warp!.seed, salt + 1) * 2 - 1) * 0.4;
  };
  const moved = (ix: number, iz: number) => !!warp && warp.jitter > 0 && !edge(ix, iz) && !warp.fixed(ix, iz);
  // How far a node may move: its jitter, more in the old town (fading out over its edge), and the
  // sweep's bow, faded in from the city's edge so its perimeter stays square.
  const amp = (ix: number, iz: number) => {
    const t = warp!.oldTown, d = t ? Math.hypot(ix - t.ix, iz - t.iz) / t.r : 9;
    return warp!.jitter * (1 + 1.4 * Math.max(0, Math.min(1, (1.3 - d) / 0.5))) * (warp!.bend?.(ix, iz) ?? 1);
  };
  const inset = (ix: number, iz: number) => Math.min(1, (Math.min(ix - o.lo, o.hi + 1 - ix, iz - o.lo, o.hi + 1 - iz)) / 3);
  for (let iz = o.lo; iz <= o.hi + 1; iz++) for (let ix = o.lo; ix <= o.hi + 1; ix++) {
    let dx = 0, dz = 0;
    if (moved(ix, iz)) {
      dx = noise(ix, iz, 0x5e1) * amp(ix, iz); dz = noise(ix, iz, 0x5e2) * amp(ix, iz);
      const sw = warp!.sweep;
      if (sw) { const k = inset(ix, iz) * sw.bow; dx += Math.sin((iz / sw.wave) * Math.PI * 2 + warp!.seed % 7) * k; dz += Math.sin((ix / sw.wave) * Math.PI * 2 + (warp!.seed >> 3) % 7) * k * 0.6; }
    }
    g.addNode(at(ix) + dx, at(iz) + dz, ix, iz);
  }
  const id = (ix: number, iz: number) => g.node(ix, iz)!.id;
  // The segments: east-west (heading east) from (ix, iz), then north-south (heading south).
  const segs: { ix: number; iz: number; ew: boolean; on: boolean }[] = [];
  for (let iz = o.lo; iz <= o.hi + 1; iz++) for (let ix = o.lo; ix <= o.hi; ix++) segs.push({ ix, iz, ew: true, on: true });
  for (let ix = o.lo; ix <= o.hi + 1; ix++) for (let iz = o.lo; iz <= o.hi; iz++) segs.push({ ix, iz, ew: false, on: true });
  for (const c of warp?.cuts ?? []) for (const sg of segs) if (sg.ix === c.ix && sg.iz === c.iz && sg.ew === c.ew) sg.on = false;
  // (A circus's own node loses its four streets: the ring takes them.)
  // (And the square of streets round it: the avenues run straight on in to the ring, and the
  // diagonals from the corners beyond.)
  for (const c of warp?.circuses ?? [])
    for (const sg of segs) if (sg.ew ? Math.abs(sg.iz - c.iz) <= 1 && (sg.ix === c.ix || sg.ix === c.ix - 1) : Math.abs(sg.ix - c.ix) <= 1 && (sg.iz === c.iz || sg.iz === c.iz - 1)) sg.on = false;
  const nearCircus = (x: number, z: number) => (warp?.circuses ?? []).some((c) => Math.abs(c.ix - x) <= 1 && Math.abs(c.iz - z) <= 1);
  for (const [px, pz] of warp?.parks ?? [])
    for (const sg of segs) if ((sg.ew && sg.iz === pz + 1 && (sg.ix === px || sg.ix === px + 1)) || (!sg.ew && sg.ix === px + 1 && (sg.iz === pz || sg.iz === pz + 1))) sg.on = false;
  if (warp && warp.river !== undefined) {
    // Across the river: a bridge every few streets (never two missing in a row at the city's edge).
    let since = 0;
    segs.forEach((sg) => {
      if (sg.ew || sg.iz !== warp.river || sg.ix <= o.lo || sg.ix >= o.hi + 1 || !warp.keep(sg.ix, sg.iz, false)) { if (!sg.ew && sg.iz === warp.river) since = 0; return; }
      if (since < 2 && hash2(sg.ix, 0x81d, warp.seed, 0xb71) < 0.7) { sg.on = false; since++; } else since = 0;
    });
  }
  if (warp && warp.drop > 0) {
    const deg = new Map<string, number>(), k = (x: number, z: number) => `${x},${z}`;
    const ends = (sg: typeof segs[0]) => [[sg.ix, sg.iz], sg.ew ? [sg.ix + 1, sg.iz] : [sg.ix, sg.iz + 1]];
    for (const sg of segs) if (sg.on) for (const [x, z] of ends(sg)) deg.set(k(x, z), (deg.get(k(x, z)) ?? 0) + 1);
    const connected = () => {
      const adj = new Map<string, string[]>();
      for (const sg of segs) if (sg.on) { const [a, b] = ends(sg).map(([x, z]) => k(x, z)); (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a); }
      const start = adj.keys().next().value!, seen = new Set([start]), todo = [start];
      while (todo.length) for (const n of adj.get(todo.pop()!)!) if (!seen.has(n)) { seen.add(n); todo.push(n); }
      return seen.size === adj.size;
    };
    segs.forEach((sg, i) => {
      if (hash2(i, 7, warp.seed, 0xd70) >= warp.drop + (warp.dropMore?.(sg.ix, sg.iz, sg.ew) ?? 0) || !warp.keep(sg.ix, sg.iz, sg.ew) || !sg.on) return;
      if (warp.river !== undefined && (sg.iz === warp.river || sg.iz === warp.river + 1)) return;   // (the quays and bridges stay)
      const [[ax, az], [bx, bz]] = ends(sg);
      if (nearCircus(ax, az) || nearCircus(bx, bz)) return;   // (nor round a circus)
      if (edge(ax, az) && edge(bx, bz)) return;   // (not round the city's edge)
      if ((deg.get(k(ax, az)) ?? 0) < 4 || (deg.get(k(bx, bz)) ?? 0) < 4) return;   // (each end keeps three)
      sg.on = false;
      if (!connected()) { sg.on = true; return; }
      deg.set(k(ax, az), deg.get(k(ax, az))! - 1); deg.set(k(bx, bz), deg.get(k(bx, bz))! - 1);
    });
  }
  for (const sg of segs) if (sg.on) {
    if (sg.ew) g.addStreet(id(sg.ix, sg.iz), id(sg.ix + 1, sg.iz), { name: o.nameEW(sg.iz), tags: o.elevatedRow(sg.iz) ? { elevated: true } : {} });
    else g.addStreet(id(sg.ix, sg.iz), id(sg.ix, sg.iz + 1), { name: o.nameNS(sg.ix), tags: o.cableColumn(sg.ix) ? { cable: true } : {} });
  }
  // Diagonal avenues, one block at a time between the intersections they pass through.
  for (const dg of warp?.diagonals ?? []) for (let k = 0; k < dg.n; k++) {
    const ax = dg.ix + dg.dx * k, az = dg.iz + dg.dz * k, bx = ax + dg.dx, bz = az + dg.dz;
    if (!g.node(ax, az) || !g.node(bx, bz)) break;
    g.addStreet(id(ax, az), id(bx, bz), { name: dg.name });
  }
  // Circuses: the ring's eight corners, the ring, and the streets in (keys well clear of the lattice's).
  const ringNodes: number[] = [];
  for (const c of warp?.circuses ?? []) {
    // (A roundabout's ring runs anticlockwise seen from above, one way: traffic keeps right.)
    const C = g.node(c.ix, c.iz)!, ring: number[] = [], R = c.round ? ROUND_R : CIRCUS_R;
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; ring.push(g.addNode(C.x + Math.cos(a) * R, C.z - Math.sin(a) * R, c.ix * 100 + 50 + k, c.iz * 100 + 50)); }
    for (let k = 0; k < 8; k++) g.addStreet(ring[k], ring[(k + 1) % 8], { name: c.name, oneway: !!c.round });
    const out = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
    out.forEach(([dx, dz], k) => {
      if (c.round && k % 2) return;
      const n = g.node(c.ix + dx, c.iz + dz); if (n) g.addStreet(ring[k], n.id, { name: k % 2 ? `${c.name} Diagonal` : (dx ? o.nameEW(c.iz) : o.nameNS(c.ix)) });
    });
    if (c.round) ringNodes.push(...ring);
  }
  // Gate streets: out to a node a block beyond the edge (outside the city: no blocks round it).
  o.gates.forEach((gt, i) => {
    const ox = gt.ix + GEN_DX[gt.dir], oz = gt.iz + GEN_DZ[gt.dir];
    const outer = g.node(ox, oz)?.id ?? g.addNode(at(ox), at(oz), ox, oz);
    const ew = gt.dir === 0 || gt.dir === 2;
    // (Built from the perimeter node outward, so the gate street's far end, n1, is the one outside.)
    const sid = g.addStreet(id(gt.ix, gt.iz), outer, { name: ew ? o.nameEW(gt.iz) : o.nameNS(gt.ix), inCity: false });
    g.streets[sid].gate = i;
    g.gates.push({ node: id(gt.ix, gt.iz), street: sid, out: 1 });
  });
  g.finish();
  // (A roundabout gives way to traffic on it: no signals round its ring.)
  for (const id of ringNodes) { const N = g.nodes[id]; N.control = "none"; N.phases = 1; N.phaseOf.fill(0); }
  for (const c of warp?.circuses ?? []) { const C = g.node(c.ix, c.iz)!; for (const b of g.blocks) if (Math.hypot(b.cx - C.x, b.cz - C.z) < CIRCUS_R / 2) b.park = true; }
  for (const [px, pz] of warp?.parks ?? []) { const n = g.node(px + 1, pz + 1)!; for (const b of g.blocks) if (Math.hypot(b.cx - n.x, b.cz - n.z) < 30) b.park = true; }
  if (warp?.river !== undefined) for (const b of g.blocks) if (Math.floor((b.cz - STREET / 2) / BLOCK) === warp.river) { b.water = true; b.inCity = false; }
  // (Parks and the river are marked only now, after finish fitted anchors: no site on them.)
  for (const b of g.blocks) if (b.park || b.water) b.anchor = null;
  // Nodes outside the city (the gate streets' far ends) have no signal; perimeter nodes keep theirs.
  return g;
}

// An organic town: no grid underneath. Points scattered over the town (a jittered lattice about a
// block apart) each take the land nearest them (a Voronoi cell, clipped to the town's square);
// the cells' edges are the streets, so junctions are mostly Y and T, at any angle, and blocks are
// irregular polygons. Edges shorter than MERGE_EDGE close up into one junction. The town's edge
// is a street all round, with the gates on it where the grid has them, and gate streets out.
const MERGE_EDGE = 24;
export function organicGraph(o: GridOpts, seed: number): CityGraph {
  const at = (i: number) => i * BLOCK + STREET / 2, X0 = at(o.lo), X1 = at(o.hi + 1), Z0 = X0, Z1 = X1;
  // The points: a lattice SP apart, each moved up to 40% of SP at random.
  const SP = 64, pts: [number, number][] = [];
  for (let z = Z0 + SP / 2; z < Z1; z += SP) for (let x = X0 + SP / 2; x < X1; x += SP)
    pts.push([x + (hash2(x, z, seed, 0x0a1) - 0.5) * SP * 0.8, z + (hash2(x, z, seed, 0x0a2) - 0.5) * SP * 0.8]);
  type P = [number, number];
  // Each point's cell: the town's square, cut by the bisector with each point near it.
  const cellsOf = () => pts.map(([px, pz]) => {
    let poly: P[] = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]];
    for (const [qx, qz] of pts) {
      if ((qx === px && qz === pz) || Math.hypot(qx - px, qz - pz) > SP * 3) continue;
      const nx = qx - px, nz = qz - pz;
      poly = clipHalf(poly, nx, nz, (nx * (px + qx) + nz * (pz + qz)) / 2);
    }
    return poly;
  });
  // (Twice, each point moves to its cell's centroid: the cells even out, fewer slivers of street.)
  for (let it = 0; it < 2; it++) cellsOf().forEach((c, i) => {
    let A = 0, cx = 0, cz = 0;
    for (let k = 0; k < c.length; k++) { const [x0, z0] = c[k], [x1, z1] = c[(k + 1) % c.length], w = x0 * z1 - x1 * z0; A += w; cx += (x0 + x1) * w; cz += (z0 + z1) * w; }
    if (Math.abs(A) > 1) pts[i] = [cx / (3 * A), cz / (3 * A)];
  });
  const cells = cellsOf();
  // Junctions: the cells' corners, merged where they coincide (cells share them), then where
  // the edge between them is short.
  const verts: P[] = [], key = new Map<string, number>();
  // (Neighbouring cells' copies of a corner can round into adjacent half-metre cells: look in those too.)
  const vid = (p: P) => {
    const kx = Math.round(p[0] * 2), kz = Math.round(p[1] * 2);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const i = key.get(`${kx + dx},${kz + dz}`);
      if (i !== undefined && Math.hypot(verts[i][0] - p[0], verts[i][1] - p[1]) < 0.5) return i;
    }
    const i = verts.length; verts.push([p[0], p[1]]); key.set(`${kx},${kz}`, i); return i;
  };
  const edges = new Map<string, [number, number]>();
  for (const c of cells) for (let i = 0; i < c.length; i++) {
    const a = vid(c[i]), b = vid(c[(i + 1) % c.length]);
    if (a !== b) edges.set(a < b ? `${a},${b}` : `${b},${a}`, a < b ? [a, b] : [b, a]);
  }
  // (Union-find over merged corners; a corner on the town's edge keeps its place, on that edge.)
  const parent = verts.map((_, i) => i), find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const onEdge = (p: P) => Math.min(Math.abs(p[0] - X0), Math.abs(p[0] - X1), Math.abs(p[1] - Z0), Math.abs(p[1] - Z1)) < 0.5;
  const corner = (p: P) => (Math.abs(p[0] - X0) < 0.5 || Math.abs(p[0] - X1) < 0.5) && (Math.abs(p[1] - Z0) < 0.5 || Math.abs(p[1] - Z1) < 0.5);
  for (let pass = 0; pass < 4; pass++) {
    const list = [...edges.values()].map(([a, b]) => [find(a), find(b)]).filter(([a, b]) => a !== b)
      .sort((p, q) => Math.hypot(verts[p[0]][0] - verts[p[1]][0], verts[p[0]][1] - verts[p[1]][1]) - Math.hypot(verts[q[0]][0] - verts[q[1]][0], verts[q[0]][1] - verts[q[1]][1]));
    for (const [a0, b0] of list) {
      const a = find(a0), b = find(b0);
      if (a === b) continue;
      const A = verts[a], B = verts[b];
      if (Math.hypot(A[0] - B[0], A[1] - B[1]) >= MERGE_EDGE) break;
      if (corner(A) && corner(B)) continue;
      // The merged corner: on the town's edge if either is (a square corner stays put).
      const m: P = corner(A) ? A : corner(B) ? B : onEdge(A) && !onEdge(B) ? A : onEdge(B) && !onEdge(A) ? B : [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      verts[a] = [m[0], m[1]]; parent[b] = a;
    }
  }
  // The streets left: between distinct merged corners, once each.
  const fe: [number, number][] = [], seen = new Set<string>();
  for (const [a0, b0] of edges.values()) {
    const a = find(a0), b = find(b0), k = a < b ? `${a},${b}` : `${b},${a}`;
    if (a !== b && !seen.has(k)) { seen.add(k); fe.push([a, b]); }
  }
  // The gates: the town-edge corner nearest each gate's place, on the same side, moves onto it;
  // with none near, the edge street there gets a corner at it.
  const gatePos = o.gates.map((gt) => [at(gt.ix), at(gt.iz)] as P);
  const sameSide = (v: P, gp: P) => (Math.abs(gp[0] - X0) < 0.5 || Math.abs(gp[0] - X1) < 0.5) ? Math.abs(v[0] - gp[0]) < 0.5 : Math.abs(v[1] - gp[1]) < 0.5;
  for (const gp of gatePos) {
    const rs = [...new Set(fe.flat())];
    let best = -1, bd = 30;
    for (const r of rs) { const v = verts[r]; if (corner(v) || !sameSide(v, gp)) continue; const d = Math.hypot(v[0] - gp[0], v[1] - gp[1]); if (d < bd) { bd = d; best = r; } }
    if (best >= 0) { verts[best] = [gp[0], gp[1]]; continue; }
    const i = fe.findIndex(([a, b]) => sameSide(verts[a], gp) && sameSide(verts[b], gp) && Math.hypot(verts[a][0] - gp[0], verts[a][1] - gp[1]) + Math.hypot(verts[b][0] - gp[0], verts[b][1] - gp[1]) < Math.hypot(verts[a][0] - verts[b][0], verts[a][1] - verts[b][1]) + 0.5);
    if (i < 0) continue;
    const n = verts.length; verts.push([gp[0], gp[1]]); parent.push(n);
    const [a, b] = fe[i]; fe.splice(i, 1, [a, n], [n, b]);
  }
  // The graph: nodes for the merged corners (keyed by the grid cell they fall in), streets for
  // the edges left between distinct ones.
  const g = new CityGraph(), nodeOf = new Map<number, number>(), used = new Set<string>();
  const keyed = (x: number, z: number): [number, number] => {
    let kx = Math.floor((x - STREET / 2) / BLOCK + 0.5), kz = Math.floor((z - STREET / 2) / BLOCK + 0.5);
    while (used.has(`${kx},${kz}`)) kz += 1000;
    used.add(`${kx},${kz}`); return [kx, kz];
  };
  // (Gate corners take the grid's own keys for their places.)
  o.gates.forEach((gt) => used.add(`${gt.ix},${gt.iz}`));
  const node = (r: number) => {
    let id = nodeOf.get(r);
    if (id === undefined) {
      const [x, z] = verts[r], gi = gatePos.findIndex((p) => Math.hypot(p[0] - x, p[1] - z) < 0.5);
      const [kx, kz] = gi >= 0 ? [o.gates[gi].ix, o.gates[gi].iz] : keyed(x, z);
      id = g.addNode(x, z, kx, kz); nodeOf.set(r, id);
    }
    return id;
  };
  // (Streets named by the way they run: east-west ones as streets, the rest as avenues.)
  for (const [a, b] of fe) {
    const [ax, az] = verts[a], [bx, bz] = verts[b], ew = Math.abs(bx - ax) > Math.abs(bz - az);
    const [p, q] = ew ? (ax <= bx ? [a, b] : [b, a]) : (az <= bz ? [a, b] : [b, a]);
    g.addStreet(node(p), node(q), { name: ew ? o.nameEW(Math.round((((az + bz) / 2) - STREET / 2) / BLOCK)) : o.nameNS(Math.round((((ax + bx) / 2) - STREET / 2) / BLOCK)) });
  }
  // Gate streets out of town, as on the grid.
  o.gates.forEach((gt, i) => {
    const inner = g.node(gt.ix, gt.iz);
    if (!inner) return;
    const ox = gt.ix + GEN_DX[gt.dir], oz = gt.iz + GEN_DZ[gt.dir], outer = g.addNode(at(ox), at(oz), ox * 1000 + 999, oz * 1000 + 999);
    const ew = gt.dir === 0 || gt.dir === 2;
    const sid = g.addStreet(inner.id, outer, { name: ew ? o.nameEW(gt.iz) : o.nameNS(gt.ix), inCity: false });
    g.streets[sid].gate = i;
    g.gates.push({ node: inner.id, street: sid, out: 1 });
  });
  g.finish();
  return g;
}
