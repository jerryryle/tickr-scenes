// City layout generators: each makes a city's street graph (citygraph.ts) from its seed. `grid`
// is the original square grid, node for node and street for street: node (ix, iz) at
// (ix*60 + 9, iz*60 + 9), every block 42 m square, gate streets running one block straight out
// of town. The others (in stage 2 on) bend, drop and add streets.
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
  // that way (east or south), -1 the other, 0 two-way. (gridGraph keeps it only where its line runs
  // on at both ends the same way, and only if every street can still reach every other.)
  oneway?: (ix: number, iz: number, ew: boolean) => number;
}
const GEN_DX = [1, 0, -1, 0], GEN_DZ = [0, -1, 0, 1];

// A grid bent out of square (`warp`): the same lattice of intersections, each but the fixed ones
// moved by up to `jitter` metres (smooth noise, so neighbouring streets lean together), and some
// street segments left out (`drop`: blocks merge, four-way crossings become T-junctions). Fixed:
// the city's edge, the gates, and whatever the caller keeps straight (the freeway's line, elevated
// and cable-car lines); a segment is only dropped where the network stays connected and every
// intersection keeps three streets or none.
// `river`: the row of blocks (iz) that is a river instead, its streets either side its quays, and
// about one in three of the streets across it bridges (the rest left out). `mouth`: the column (ix)
// of the street across it at its mouth, in a town on the sea to the east or west: always a bridge,
// the river ending there (the blocks beyond are the sea's: trimToOutline).
// `parks`: superblock parks, each four blocks (ix..ix+1, iz..iz+1) with the streets between them
// left out.
// `diagonals`: avenues cutting corner to corner across blocks, each from lattice node (ix, iz) by
// (dx, dz) = (+-1, +-1) for `n` blocks (through the intersections, so they cross no street between).
// `oldTown`: a district (centre and radius, in blocks) of streets bent much further out of square.
// `sweep`: long avenues bowed into gentle curves (metres of bow, and the wavelength in blocks).
export interface WarpOpts {
  seed: number; jitter: number; drop: number; fixed: (ix: number, iz: number) => boolean; keep: (ix: number, iz: number, ew: boolean) => boolean;
  river?: number; mouth?: number; parks?: [number, number][]; diagonals?: { ix: number; iz: number; dx: number; dz: number; n: number; name: string }[];
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

// After finish: a roundabout gives way to traffic on its ring (no signals round it), and a
// circus's or roundabout's middle (the block round each point given) is a park.
function ringsDone(g: CityGraph, ringNodes: number[], middles: [number, number][]) {
  for (const id of ringNodes) { const N = g.nodes[id]; N.control = "none"; N.phases = 1; N.phaseOf.fill(0); }
  for (const [x, z] of middles) { const b = g.blockAt(x, z); if (b) b.park = true; }
}

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
      if (sg.ix === warp.mouth) { since = 0; return; }
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
  const dirs = oneWays(o, segs);
  for (const sg of segs) if (sg.on) {
    // (A one-way street driven west or north runs from its far node: one-way streets are driven
    // from n0 to n1.)
    const d = dirs.get(sg) ?? 0, [a, b] = sg.ew ? [id(sg.ix, sg.iz), id(sg.ix + 1, sg.iz)] : [id(sg.ix, sg.iz), id(sg.ix, sg.iz + 1)], [n0, n1] = d < 0 ? [b, a] : [a, b];
    if (sg.ew) g.addStreet(n0, n1, { name: o.nameEW(sg.iz), tags: o.elevatedRow(sg.iz) ? { elevated: true } : {}, oneway: d !== 0 });
    else g.addStreet(n0, n1, { name: o.nameNS(sg.ix), tags: o.cableColumn(sg.ix) ? { cable: true } : {}, oneway: d !== 0 });
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
    for (let k = 0; k < 8; k++) g.addStreet(ring[k], ring[(k + 1) % 8], { name: c.name, oneway: !!c.round, ring: !!c.round });
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
  ringsDone(g, ringNodes, (warp?.circuses ?? []).map((c) => { const C = g.node(c.ix, c.iz)!; return [C.x, C.z]; }));
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
export interface OrganicOpts { river?: boolean; rounds?: string[]; sea?: { side: number; inSea: (x: number, z: number) => boolean } }
const ORG_ROUND_R = 26;
type FE = { a: number; b: number; name?: string; ring?: boolean; wet?: [number, number][] };   // wet: a water cell's point on each side that is river
export function organicGraph(o: GridOpts, seed: number, x: OrganicOpts = {}): CityGraph {
  const at = (i: number) => i * BLOCK + STREET / 2, X0 = at(o.lo), X1 = at(o.hi + 1), Z0 = X0, Z1 = X1;
  const h = (salt: number) => hash2(seed, 0x0c9, 0, salt);
  // The points: a lattice SP apart, each moved up to 40% of SP at random.
  const SP = 64;
  let pts: [number, number][] = [];
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
  // The river's line: from the middle of a gap between gates on the west edge to one on the east
  // (the same gap or the next), meandering between (none at its ends, so it meets the edges square).
  const gz = [...new Set(o.gates.filter((g) => g.dir === 0 || g.dir === 2).map((g) => at(g.iz)))].sort((p, q) => p - q);
  const gaps = gz.slice(1).map((z, i) => (z + gz[i]) / 2);
  const river = !!x.river && gaps.length > 0;
  const gi = Math.floor(h(1) * gaps.length), go = Math.max(0, Math.min(gaps.length - 1, gi + Math.floor(h(2) * 3) - 1));
  const zIn = gaps[gi] ?? 0, zOut = gaps[go] ?? 0, amp = (0.6 + 0.9 * h(3)) * BLOCK, waves = 1 + Math.floor(h(4) * 3), phase = h(5) * Math.PI * 2;
  const riverZ = (px: number) => {
    const t = Math.max(0, Math.min(1, (px - X0) / (X1 - X0)));
    const z = zIn + (zOut - zIn) * t + amp * Math.sin(Math.PI * t) * Math.sin(Math.PI * waves * t + phase);
    return Math.max(Z0 + 2.5 * SP, Math.min(Z1 - 2.5 * SP, z));
  };
  // (Out to a sea to the north or south: from the west or east edge at zIn, bending round to run
  // down to the sea's edge at xOut, between two gates on it: a curve, sampled.)
  const sea = x.sea, northSouth = !!sea && (sea.side === 1 || sea.side === 3);
  const gx = [...new Set(o.gates.filter((g) => g.dir === 1 || g.dir === 3).map((g) => at(g.ix)))].sort((p, q) => p - q);
  const gapsX = gx.slice(1).map((v, i) => (v + gx[i]) / 2);
  const fromEast = h(6) < 0.5, xOut = gapsX[Math.floor(h(7) * gapsX.length)] ?? (X0 + X1) / 2, zSea = sea?.side === 1 ? Z0 : Z1;
  const curve: [number, number][] = [];
  if (northSouth) for (let k = 0; k <= 32; k++) {
    const t = k / 32, ax = fromEast ? X1 : X0, u = 1 - t;
    curve.push([u * u * ax + 2 * u * t * xOut + t * t * xOut, u * u * zIn + 2 * u * t * zIn + t * t * zSea]);
  }
  // How far (x, z) lies off the river's line.
  const riverOff = (px: number, pz: number) => northSouth ? Math.min(...curve.map(([cx, cz]) => Math.hypot(px - cx, pz - cz))) : Math.abs(pz - riverZ(px));
  // The roundabouts' places: well inside town, clear of the river and of each other. The points
  // near each give way to four (or three, or five) round it, so the cells' corner there is a
  // junction of that many streets, each running well out.
  const sites: { x: number; z: number; name: string }[] = [];
  for (let t = 0; t < 40 && sites.length < (x.rounds?.length ?? 0); t++) {
    const sx = X0 + 160 + h(100 + t) * (X1 - X0 - 320), sz = Z0 + 160 + h(140 + t) * (Z1 - Z0 - 320);
    if (river && riverOff(sx, sz) < 150) continue;
    if (sea && [[0, 0], [150, 0], [-150, 0], [0, 150], [0, -150]].some(([dx, dz]) => sea.inSea(sx + dx, sz + dz))) continue;   // (nor by the sea)
    if (sites.some((s) => Math.hypot(s.x - sx, s.z - sz) < 340)) continue;
    sites.push({ x: sx, z: sz, name: x.rounds![sites.length] });
  }
  for (const [k, s] of sites.entries()) {
    const r = hash2(k, 0x70d, seed, 1), n = r < 0.7 ? 4 : r < 0.85 ? 3 : 5, a0 = hash2(k, 0x70d, seed, 2) * Math.PI * 2;
    pts = pts.filter(([px, pz]) => Math.hypot(px - s.x, pz - s.z) > 92);
    for (let i = 0; i < n; i++) pts.push([s.x + Math.cos(a0 + (i * 2 * Math.PI) / n) * 60, s.z + Math.sin(a0 + (i * 2 * Math.PI) / n) * 60]);
  }
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
  const edges = new Map<string, [number, number]>(), cellEdges: [number, number][][] = cells.map(() => []);
  cells.forEach((c, ci) => {
    for (let i = 0; i < c.length; i++) {
      const a = vid(c[i]), b = vid(c[(i + 1) % c.length]);
      cellEdges[ci].push([a, b]);
      if (a !== b) edges.set(a < b ? `${a},${b}` : `${b},${a}`, a < b ? [a, b] : [b, a]);
    }
  });
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
  // The river: the cheapest chain of cells from the west edge's cell nearest its line to the east
  // edge's, each step costing its length, more the further the cell lies off the line (and none
  // touching the north or south edge).
  const water = new Set<number>();
  if (river) {
    const adj = cells.map(() => new Set<number>());
    for (const s of sidesOf.values()) for (const i of s) for (const j of s) if (i !== j) adj[i].add(j);
    const along = (ci: number, v: number, ax: 0 | 1) => cells[ci].filter((p) => Math.abs(p[ax] - v) < 0.5).length >= 2;
    const wet = (ci: number) => !!sea && sea.inSea(pts[ci][0], pts[ci][1]);
    const banned = (ci: number) => along(ci, Z0, 1) || along(ci, Z1, 1) || wet(ci);
    const ends = (v: number, z: number) => { let best = -1, bd = Infinity; cells.forEach((_, ci) => { if (along(ci, v, 0) && !banned(ci) && Math.abs(pts[ci][1] - z) < bd) { bd = Math.abs(pts[ci][1] - z); best = ci; } }); return best; };
    // (Out into the sea: the land cell beside one of the sea's nearest where the river's line meets it.)
    const mouth = (px: number, pz: number) => { let best = -1, bd = Infinity; cells.forEach((_, ci) => { if (!banned(ci) && [...adj[ci]].some(wet)) { const d = Math.hypot(pts[ci][0] - px, pts[ci][1] - pz); if (d < bd) { bd = d; best = ci; } } }); return best; };
    const s0 = !sea || sea.side === 0 ? ends(X0, zIn) : sea.side === 2 ? ends(X1, zOut) : ends(fromEast ? X1 : X0, zIn);
    const s1 = !sea ? ends(X1, zOut) : sea.side === 0 ? mouth(X1, zOut) : sea.side === 2 ? mouth(X0, zIn) : mouth(xOut, zSea);
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
      // The bridges: of the streets between one cell and the next (with land at both ends), one in
      // three or so; never more than two in a row left out.
      const bank = (v: number) => onEdge(verts[v]) || [...(cellsAt.get(v) ?? [])].some((c) => !water.has(c));
      const bridges = new Set<string>(), between = new Map<string, FE[]>();
      for (const e of fe) { const s = [...sidesOf.get(mk(e.a, e.b))!]; if (s.length === 2) { const k = mk(s[0], s[1]); between.set(k, [...(between.get(k) ?? []), e]); } }
      let since = 0;
      for (let i = 0; i + 1 < chain.length; i++) for (const e of between.get(mk(chain[i], chain[i + 1])) ?? []) {
        if (!bank(e.a) || !bank(e.b)) continue;
        if (since < 2 && hash2(i, 0x81d, seed, 0xb71) < 0.7) since++; else { since = 0; bridges.add(mk(e.a, e.b)); }
      }
      // (Streets with water both sides and no bridge are left out: the river runs on there.)
      fe = fe.filter((e) => { const k = mk(e.a, e.b), s = sidesOf.get(k)!; return bridges.has(k) || s.size < 2 || ![...s].every((c) => water.has(c)); });
      for (const e of fe) { const w = [...sidesOf.get(mk(e.a, e.b))!].filter((c) => water.has(c)); if (w.length) e.wet = w.map((c) => pts[c]); }
    }
  }
  // (Streets named by the way they run: east-west ones as streets, the rest as avenues.)
  const nameOf = (a: number, b: number) => {
    const [ax, az] = verts[a], [bx, bz] = verts[b];
    return Math.abs(bx - ax) > Math.abs(bz - az) ? o.nameEW(Math.round((((az + bz) / 2) - STREET / 2) / BLOCK)) : o.nameNS(Math.round((((ax + bx) / 2) - STREET / 2) / BLOCK));
  };
  // The roundabouts: at the corner nearest each place, if its streets in are long enough, far
  // enough apart, and clear of the water and the town's edge. Its ring's corners: one where each
  // street comes in, and more between so no side turns more than 60 degrees; anticlockwise seen
  // from above (as the grid's), one way.
  const ringVerts: number[] = [], islands: P[] = [];
  for (const s of sites) {
    const used = new Set(fe.flatMap((e) => [e.a, e.b]));
    let v = -1, bd = 18;
    for (const r of used) { const d = Math.hypot(verts[r][0] - s.x, verts[r][1] - s.z); if (d < bd) { bd = d; v = r; } }
    if (v < 0) continue;
    const V = verts[v], arms = fe.filter((e) => e.a === v || e.b === v).map((e) => {
      const u = e.a === v ? e.b : e.a, U = verts[u];
      return { e, u, ang: Math.atan2(-(U[1] - V[1]), U[0] - V[0]), len: Math.hypot(U[0] - V[0], U[1] - V[1]) };
    }).sort((p, q) => p.ang - q.ang);
    const gapAfter = (i: number) => i + 1 < arms.length ? arms[i + 1].ang - arms[i].ang : arms[0].ang + 2 * Math.PI - arms[i].ang;
    const dry = (r: number) => ![...(cellsAt.get(r) ?? [])].some((c) => water.has(c));
    if (arms.length < 3 || arms.length > 6 || onEdge(V) || !dry(v) || arms.some((a, i) => a.len < ORG_ROUND_R + 22 || gapAfter(i) < 0.8 || !dry(a.u) || onEdge(verts[a.u]))) continue;
    // (And every other street a street's width clear of the ring: none crosses it or runs into it.)
    const segDist = ([ax, az]: P, [bx, bz]: P) => { const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((V[0] - ax) * dx + (V[1] - az) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(V[0] - ax - dx * t, V[1] - az - dz * t); };
    if (fe.some((e) => e.a !== v && e.b !== v && segDist(verts[e.a], verts[e.b]) < ORG_ROUND_R + STREET)) continue;
    const drop = new Set(arms.map((a) => a.e));
    fe = fe.filter((e) => !drop.has(e));
    const ring: number[] = [], add = (ang: number) => { const i = verts.length; verts.push([V[0] + Math.cos(ang) * ORG_ROUND_R, V[1] - Math.sin(ang) * ORG_ROUND_R]); parent.push(i); ring.push(i); return i; };
    arms.forEach((a, i) => {
      fe.push({ a: add(a.ang), b: a.u, name: a.e.name ?? nameOf(a.e.a, a.e.b) });
      const g = gapAfter(i), n = Math.ceil(g / (Math.PI / 3)) - 1;
      for (let j = 1; j <= n; j++) add(a.ang + (g * j) / (n + 1));
    });
    ring.forEach((r, k) => fe.push({ a: r, b: ring[(k + 1) % ring.length], name: s.name, ring: true }));
    ringVerts.push(...ring); islands.push([V[0], V[1]]);
  }
  // The gates: the town-edge corner nearest each gate's place, on the same side, moves onto it;
  // with none near, the edge street there gets a corner at it.
  const gatePos = o.gates.map((gt) => [at(gt.ix), at(gt.iz)] as P);
  const sameSide = (v: P, gp: P) => (Math.abs(gp[0] - X0) < 0.5 || Math.abs(gp[0] - X1) < 0.5) ? Math.abs(v[0] - gp[0]) < 0.5 : Math.abs(v[1] - gp[1]) < 0.5;
  for (const gp of gatePos) {
    const rs = [...new Set(fe.flatMap((e) => [e.a, e.b]))];
    let best = -1, bd = 30;
    for (const r of rs) { const v = verts[r]; if (corner(v) || !sameSide(v, gp)) continue; const d = Math.hypot(v[0] - gp[0], v[1] - gp[1]); if (d < bd) { bd = d; best = r; } }
    if (best >= 0) { verts[best] = [gp[0], gp[1]]; continue; }
    const i = fe.findIndex(({ a, b }) => sameSide(verts[a], gp) && sameSide(verts[b], gp) && Math.hypot(verts[a][0] - gp[0], verts[a][1] - gp[1]) + Math.hypot(verts[b][0] - gp[0], verts[b][1] - gp[1]) < Math.hypot(verts[a][0] - verts[b][0], verts[a][1] - verts[b][1]) + 0.5);
    if (i < 0) continue;
    const n = verts.length; verts.push([gp[0], gp[1]]); parent.push(n);
    const e = fe[i]; fe.splice(i, 1, { ...e, b: n }, { ...e, a: n });
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
  const streetEdge = new Map<number, FE>();
  for (const e of fe) {
    // (A ring's sides are driven from a to b; other streets run east or south from n0.)
    if (e.ring) { g.addStreet(node(e.a), node(e.b), { name: e.name, oneway: true, ring: true }); continue; }
    if (e.wet) streetEdge.set(g.streets.length, e);
    const [ax, az] = verts[e.a], [bx, bz] = verts[e.b], ew = Math.abs(bx - ax) > Math.abs(bz - az);
    const [p, q] = ew ? (ax <= bx ? [e.a, e.b] : [e.b, e.a]) : (az <= bz ? [e.a, e.b] : [e.b, e.a]);
    g.addStreet(node(p), node(q), { name: e.name ?? nameOf(e.a, e.b) });
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
  ringsDone(g, ringVerts.flatMap((r) => nodeOf.get(r) ?? []), islands);
  // The river's blocks: for each street along or over it, the block on its water side (just past
  // the sidewalk, towards a water cell's point: the side of a street, which merging corners can't move).
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

// The lattice segments that are one-way streets, and which way (o.oneway): only those whose line
// runs on from both ends (each next segment along it there, one-way the same way or two-way), so
// none ends at a node it can't be driven on from; and none at all if then some segment can't be
// reached from another, driving the right way (the junctions all keep a way in and out).
type Seg = { ix: number; iz: number; ew: boolean; on: boolean };
function oneWays(o: GridOpts, segs: Seg[]): Map<Seg, number> {
  const dirs = new Map<Seg, number>();
  if (!o.oneway) return dirs;
  const key = (ew: boolean, ix: number, iz: number) => `${ew ? 1 : 0},${ix},${iz}`, at = new Map<string, Seg>();
  for (const sg of segs) at.set(key(sg.ew, sg.ix, sg.iz), sg);
  for (const sg of segs) if (sg.on) { const d = o.oneway(sg.ix, sg.iz, sg.ew); if (d) dirs.set(sg, Math.sign(d)); }
  for (let changed = true; changed;) {
    changed = false;
    for (const [sg, d] of dirs) {
      const prev = at.get(sg.ew ? key(true, sg.ix - 1, sg.iz) : key(false, sg.ix, sg.iz - 1)), next = at.get(sg.ew ? key(true, sg.ix + 1, sg.iz) : key(false, sg.ix, sg.iz + 1));
      const runs = (n: Seg | undefined) => !!n && n.on && (dirs.get(n) ?? d) === d;
      if (!runs(prev) || !runs(next)) { dirs.delete(sg); changed = true; }
    }
  }
  // (Nor a block every side of which runs the wrong way for its kerb, where the truck could never
  // stop: its north side two-way instead. A side's kerb is on the right of its traffic: the north
  // side's driven east, the south's west, the west's north, the east's south.)
  for (const sg of segs) if (sg.ew && dirs.get(sg) === -1) {
    const S = at.get(key(true, sg.ix, sg.iz + 1)), W = at.get(key(false, sg.ix, sg.iz)), E = at.get(key(false, sg.ix + 1, sg.iz));
    if (S && W && E && S.on && W.on && E.on && dirs.get(S) === 1 && dirs.get(W) === 1 && dirs.get(E) === -1) dirs.delete(sg);
  }
  if (!dirs.size) return dirs;
  // (Every node reached from one, both driving the right way and against it: strongly connected.)
  const nk = (x: number, z: number) => `${x},${z}`, fwd = new Map<string, string[]>(), back = new Map<string, string[]>();
  const arc = (m: Map<string, string[]>, a: string, b: string) => { let l = m.get(a); if (!l) m.set(a, (l = [])); l.push(b); };
  for (const sg of segs) if (sg.on) {
    const a = nk(sg.ix, sg.iz), b = sg.ew ? nk(sg.ix + 1, sg.iz) : nk(sg.ix, sg.iz + 1), d = dirs.get(sg) ?? 0;
    if (d >= 0) { arc(fwd, a, b); arc(back, b, a); }
    if (d <= 0) { arc(fwd, b, a); arc(back, a, b); }
  }
  const all = new Set([...fwd.keys(), ...back.keys()]), start = all.values().next().value!;
  const reach = (m: Map<string, string[]>) => { const seen = new Set([start]), todo = [start]; while (todo.length) for (const n of m.get(todo.pop()!) ?? []) if (!seen.has(n)) { seen.add(n); todo.push(n); } return seen.size; };
  if (reach(fwd) !== all.size || reach(back) !== all.size) dirs.clear();
  return dirs;
}

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
