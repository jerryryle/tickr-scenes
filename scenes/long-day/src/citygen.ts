// City layout generators: each makes a city's street graph (citygraph.ts) from its seed. `grid`
// is the original square grid, node for node and street for street: node (ix, iz) at
// (ix*60 + 9, iz*60 + 9), every block 42 m square, gate streets running one block straight out
// of town. The others (in stage 2 on) bend, drop and add streets.
import { CityGraph } from "./citygraph.ts";
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
  circuses?: { ix: number; iz: number; name: string }[];
  cuts?: { ix: number; iz: number; ew: boolean }[];   // segments left out whatever else (a slip ramp's superblock)
}
// A circus: lattice node (ix, iz) and the streets round it give way to a ring road round a round
// park, with eight streets running in to it: the four avenues that met there and four diagonals
// from the corners beyond. The ring:
// CIRCUS_R metres out, eight sides, an intersection where each street meets it.
const CIRCUS_R = 45;

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
    return warp!.jitter * (1 + 1.4 * Math.max(0, Math.min(1, (1.3 - d) / 0.5)));
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
      if (hash2(i, 7, warp.seed, 0xd70) >= warp.drop || !warp.keep(sg.ix, sg.iz, sg.ew) || !sg.on) return;
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
  for (const c of warp?.circuses ?? []) {
    const C = g.node(c.ix, c.iz)!, ring: number[] = [];
    for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; ring.push(g.addNode(C.x + Math.cos(a) * CIRCUS_R, C.z - Math.sin(a) * CIRCUS_R, c.ix * 100 + 50 + k, c.iz * 100 + 50)); }
    for (let k = 0; k < 8; k++) g.addStreet(ring[k], ring[(k + 1) % 8], { name: c.name });
    const out = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
    out.forEach(([dx, dz], k) => { const n = g.node(c.ix + dx, c.iz + dz); if (n) g.addStreet(ring[k], n.id, { name: k % 2 ? `${c.name} Diagonal` : (dx ? o.nameEW(c.iz) : o.nameNS(c.ix)) }); });
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
  for (const c of warp?.circuses ?? []) { const C = g.node(c.ix, c.iz)!; for (const b of g.blocks) if (Math.hypot(b.cx - C.x, b.cz - C.z) < CIRCUS_R / 2) b.park = true; }
  for (const [px, pz] of warp?.parks ?? []) { const n = g.node(px + 1, pz + 1)!; for (const b of g.blocks) if (Math.hypot(b.cx - n.x, b.cz - n.z) < 30) b.park = true; }
  if (warp?.river !== undefined) for (const b of g.blocks) if (Math.floor((b.cz - STREET / 2) / BLOCK) === warp.river) { b.water = true; b.inCity = false; }
  // Nodes outside the city (the gate streets' far ends) have no signal; perimeter nodes keep theirs.
  return g;
}
