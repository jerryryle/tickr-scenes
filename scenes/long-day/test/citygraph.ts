// Test: the street generator (citygen.ts cityGraph) with its points unmoved reproduces the old square grid
// exactly: one block per grid block with the same key, its four faces in the old side order with
// the same frontage frame (city.ts frontPt), usable frontage [9, 51], and two signal phases at
// every four-way node, east-west first. Also checks blocks and faces are consistent in general.
import { cityGraph, trimToOutline } from "../src/citygen.ts";
import type { CityOpts } from "../src/citygen.ts";
// (The organic preset: each block's point moved up to 40% of a block, then evened out; CityPlan's.)
const organicGraph = (o: Parameters<typeof cityGraph>[0], seed: number, x: CityOpts = {}) => cityGraph(o, seed, { move: (bx, bz) => [(hash2(bx, bz, seed, 0x0a1) - 0.5) * 48, (hash2(bx, bz, seed, 0x0a2) - 0.5) * 48], relax: () => 1, ...x });
// (A warped one: each point moved up to j metres either way.)
const warpGraph = (o: Parameters<typeof cityGraph>[0], seed: number, j: number, x: CityOpts = {}) => cityGraph(o, seed, { move: (bx, bz) => [(hash2(bx, bz, seed, 0x5e1) - 0.5) * 2 * j, (hash2(bx, bz, seed, 0x5e2) - 0.5) * 2 * j], ...x });
const riverRow = (iz: number, lo: number, hi: number): [number, number][] => [[lo * BLOCK + 9, iz * BLOCK + 39], [(hi + 1) * BLOCK + 9, iz * BLOCK + 39]];
import { CityOutline } from "../src/outline.ts";
import { entryGateOf, GATES, setCityLimits } from "../src/city.ts";
import { STYLES } from "../src/styles.ts";
import { Path, planRoute } from "../src/route.ts";
import { hash2 } from "../src/rng.ts";
import { frontPt } from "../src/city.ts";
import { BLOCK } from "../src/grid.ts";
{
  const proc = (globalThis as any).process;
  const errs: string[] = [];
  const err = (m: string) => { if (errs.length < 30) errs.push(m); };
  const lo = -6, hi = 5, at = 3;
  const gates = [-at, 0, at].flatMap((g) => [{ ix: hi + 1, iz: g, dir: 0 }, { ix: g, iz: lo, dir: 1 }, { ix: lo, iz: g, dir: 2 }, { ix: g, iz: hi + 1, dir: 3 }]);
  const G = cityGraph({ lo, hi, gates, nameEW: (i) => `E${i}`, nameNS: (i) => `N${i}`, elevatedRow: () => false, cableColumn: () => false }, 1);
  const n = hi - lo + 1;
  if (G.blocks.length !== n * n) err(`blocks: ${G.blocks.length}, want ${n * n}`);
  for (let bx = lo; bx <= hi; bx++) for (let bz = lo; bz <= hi; bz++) {
    const b = G.block(bx, bz);
    if (!b) { err(`no block ${bx},${bz}`); continue; }
    if (Math.abs(b.area - 42 * 42) > 1e-6) err(`block ${bx},${bz} area ${b.area}`);
    if (b.faces.length !== 4) { err(`block ${bx},${bz} has ${b.faces.length} faces`); continue; }
    for (let side = 0; side < 4; side++) {
      const f = G.sideFace(b, side);
      if (f < 0) { err(`block ${bx},${bz} side ${side}: no face`); continue; }
      if (Math.abs(G.faceA0(f) - 9) > 1e-9 || Math.abs(G.faceA1(f) - 51) > 1e-9) err(`face ${bx},${bz}/${side}: a ${G.faceA0(f)}..${G.faceA1(f)}`);
      for (const [a, nn] of [[9, 0], [30, -3], [51, 20], [0, -9], [60, 42], [25, -4.5]]) {
        const p = G.facePt(f, a, nn), [lx, lz] = frontPt(side, a, nn), wx = bx * BLOCK + lx, wz = bz * BLOCK + lz;
        if (Math.hypot(p.x - wx, p.z - wz) > 1e-6) err(`face ${bx},${bz}/${side} (${a},${nn}): ${p.x.toFixed(3)},${p.z.toFixed(3)} want ${wx},${wz}`);
        const [ba, bn] = G.toFace(f, wx, wz);
        if (Math.abs(ba - Math.min(60, Math.max(0, a))) > 1e-6 || Math.abs(bn - nn) > 1e-6) err(`toFace ${bx},${bz}/${side} (${a},${nn}): ${ba},${bn}`);
      }
      if (G.faceBlock[f] !== b.id) err(`face ${f} block ${G.faceBlock[f]} not ${b.id}`);
    }
    if (G.blockAt(b.cx, b.cz)?.id !== b.id) err(`blockAt centroid of ${bx},${bz}`);
  }
  for (const N of G.nodes) {
    if (N.arms.length !== 4) continue;
    const ew = N.arms.filter((a) => Math.abs(Math.cos(a.h)) > 0.9), ns = N.arms.filter((a) => Math.abs(Math.sin(a.h)) > 0.9);
    for (const a of ew) if (N.phaseOf[N.arms.indexOf(a)] !== 0) err(`node ${N.kx},${N.kz}: east-west arm not phase 0`);
    for (const a of ns) if (N.phaseOf[N.arms.indexOf(a)] !== 1) err(`node ${N.kx},${N.kz}: north-south arm not phase 1`);
    for (const a of N.arms) if (Math.abs(a.mouth - 9) > 1e-9) err(`node ${N.kx},${N.kz}: mouth ${a.mouth}`);
  }
  for (const [i, gt] of G.gates.entries()) {
    if (!gt) { err(`gate ${i}: closed on the square`); continue; }
    const st = G.streets[gt.street];
    if (G.faceBlock[st.id * 2] >= 0 || G.faceBlock[st.id * 2 + 1] >= 0) err(`gate ${i}: its street borders a block`);
  }
  // Warped and river layouts: every face is a block's or the outside's, blocks wind the right
  // way and don't overlap, every street is reachable both ways from a gate.
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const W = warpGraph({ lo, hi, gates, nameEW: (i) => `E${i}`, nameNS: (i) => `N${i}`, elevatedRow: () => false, cableColumn: () => false }, seed, 10,
      { drop: { p: () => 0.15, keep: () => true }, riverLine: seed % 2 ? riverRow(1, lo, hi) : undefined });
    const outside = [...W.faceBlock].filter((b) => b < 0).length;
    if (W.blocks.some((b) => b.area < 200)) err(`warp ${seed}: a tiny block`);
    for (const b of W.blocks) if (!b.water && W.blockAt(b.cx, b.cz)?.id !== b.id) err(`warp ${seed}: block ${b.kx},${b.kz} centroid outside it`);
    const g0 = W.streets[W.gates[0]!.street], from = g0.id * 2 + 1;
    for (let k = 0; k < 12; k++) {
      const s = Math.floor(hash2(k, seed, 0, 1) * W.streets.length), d = s * 2 + (k % 2);
      if (!W.streets[s].inCity) continue;
      const r = planRoute(W, from, 20, [{ d, after: W.faceLen(d) / 2 }], 20000, (e) => W.streets[e >> 1].inCity);
      if (!r) err(`warp ${seed}: no route from gate 0 to street ${s}`);
    }
    if (seed === 1) console.log(`warp: ${W.nodes.length} nodes, ${W.streets.length} streets, ${W.blocks.length} blocks (${W.blocks.filter((b) => b.water).length} water), ${outside} outer faces`);
  }
  // A circus: every street round its ring reachable both ways, and the paths there smooth (finite,
  // no jumps between samples).
  {
    const W = warpGraph({ lo, hi, gates, nameEW: (i) => `E${i}`, nameNS: (i) => `N${i}`, elevatedRow: () => false, cableColumn: () => false }, 9, 6,
      { rings: [{ x: 9, z: 9, name: "Circle", n: 8, r: 45, oneway: false, arms: 8 }] });
    const ring = W.streets.filter((st) => st.name === "Circle");
    // (Eight streets in, four of them its diagonals: so eight sides round it at the least.)
    if (ring.length < 8) err(`circus: ${ring.length} ring streets`);
    if (!W.blocks.some((b) => b.park)) err("circus: no park in the middle");
    const from = W.streets[W.gates[0]!.street].id * 2 + 1, q = { x: 0, z: 0, h: 0, k: 0 };
    for (const st of ring) for (const d of [st.id * 2, st.id * 2 + 1]) {
      const r = planRoute(W, from, 20, [{ d, after: W.faceLen(d) / 2 }], 20000, (e) => W.streets[e >> 1].inCity);
      if (!r) { err(`circus: no route to ring street ${st.id} (${d & 1})`); continue; }
      const P = new Path(W, r);
      let px = NaN, pz = NaN;
      for (let t = 0; t <= P.length; t += 0.5) {
        P.eval(t, q);
        if (!Number.isFinite(q.x + q.z + q.h)) { err(`circus: path to ${d} not finite at ${t}`); break; }
        if (Number.isFinite(px) && Math.hypot(q.x - px, q.z - pz) > 0.8) { err(`circus: path to ${d} jumps at ${t.toFixed(1)}`); break; }
        px = q.x; pz = q.z;
      }
    }
  }
  // A warped town's river along its row stays along it with the sea to the north (its ends its own,
  // not bent off to a mouth on that sea); an organic town's grid patch keeps its junctions exactly
  // on the lattice (the interchange is built on them).
  {
    const go = { lo, hi, gates, nameEW: (i: number) => `E${i}`, nameNS: (i: number) => `N${i}`, elevatedRow: () => false, cableColumn: () => false };
    const Z0 = lo * BLOCK + 9, rowZ = 1 * BLOCK + 39;
    const W = warpGraph(go, 4, 10, { riverLine: riverRow(1, lo, hi), sea: { side: 1, inSea: (_x, z) => z < Z0 + 40 } });
    const wet = W.blocks.filter((b) => b.water);
    if (!wet.length) err("river by a north sea: no water");
    for (const b of wet) if (Math.abs(b.cz - rowZ) > BLOCK) { err(`river by a north sea: water block at z ${b.cz.toFixed(0)}, its row at ${rowZ}`); break; }
    const P = { x0: lo * BLOCK + 9, x1: (lo + 4) * BLOCK + 9, z0: (lo + 2) * BLOCK + 9, z1: (lo + 6) * BLOCK + 9 };
    const inP = (bx: number, bz: number) => bx * BLOCK + 39 > P.x0 && bx * BLOCK + 39 < P.x1 && bz * BLOCK + 39 > P.z0 && bz * BLOCK + 39 < P.z1;
    for (const seed of [1, 2, 3, 4]) {
      const O = organicGraph(go, seed, { patch: P, move: (bx, bz) => (inP(bx, bz) ? [0, 0] : [(hash2(bx, bz, seed, 0x0a1) - 0.5) * 48, (hash2(bx, bz, seed, 0x0a2) - 0.5) * 48]), relax: (bx, bz) => (inP(bx, bz) ? 0 : 1) });
      for (const N of O.nodes) {
        if (N.x <= P.x0 + BLOCK || N.x >= P.x1 - BLOCK || N.z <= P.z0 + BLOCK || N.z >= P.z1 - BLOCK) continue;
        if ((N.x - 9) % BLOCK !== 0 || (N.z - 9) % BLOCK !== 0) { err(`patch ${seed}: junction ${N.x.toFixed(2)},${N.z.toFixed(2)} off the lattice`); break; }
      }
    }
  }
  // Organic towns: no two streets cross (the graph stays planar after short edges close up), every
  // block is sound, every gate has its street, and the streets are all reachable from gate 0.
  // (Twenty towns: gate snapping moves a corner up to 30 m, which could cross streets in any one.)
  // Odd towns have a river, and half of them roundabouts: the river's water reaches both edges,
  // with a bridge or more over it, and a roundabout is a one-way ring round a park, every side of
  // it reachable.
  let rivers = 0, bridges = 0, rings = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const opts = { river: seed % 2 === 1, rounds: seed % 4 < 2 ? ["R1", "R2"] : [] };
    const O = organicGraph({ lo, hi, gates, nameEW: (i) => `E${i}`, nameNS: (i) => `N${i}`, elevatedRow: () => false, cableColumn: () => false }, seed, opts);
    // (A corner by the town's edge is on it: merging never pulls one a little way in or out.)
    const E0 = lo * BLOCK + 9, E1 = (hi + 1) * BLOCK + 9;
    for (const N of O.nodes) { const d = Math.min(Math.abs(N.x - E0), Math.abs(N.x - E1), Math.abs(N.z - E0), Math.abs(N.z - E1)); if (d > 1e-6 && d < 1.5) { err(`organic ${seed}: corner ${N.x.toFixed(2)},${N.z.toFixed(2)} ${d.toFixed(2)} m off the edge`); break; } }
    const wet = O.blocks.filter((b) => b.water);
    if (opts.river) {
      if (!wet.length) err(`organic ${seed}: no river`); else rivers++;
      const xs = wet.flatMap((b) => b.poly.map((p) => p[0]));
      if (wet.length && (Math.min(...xs) > lo * BLOCK + 40 || Math.max(...xs) < (hi + 1) * BLOCK - 20)) err(`organic ${seed}: the river doesn't cross town`);
      const br = O.streets.filter((st) => [0, 1].every((s) => { const b = O.faceBlock[st.id * 2 + s]; return b >= 0 && O.blocks[b].water; })).length;
      if (wet.length && !br) err(`organic ${seed}: no bridge`);
      bridges += br;
    } else if (wet.length) err(`organic ${seed}: water without a river`);
    for (const st of O.streets) if (st.inCity && O.faceBlock[st.id * 2] < 0 && O.faceBlock[st.id * 2 + 1] < 0) err(`organic ${seed}: street ${st.id} borders no block`);
    for (const name of opts.rounds) {
      const ring = O.streets.filter((st) => st.name === name);
      if (!ring.length) continue;
      rings++;
      if (!ring.every((st) => st.ring && st.oneway)) err(`organic ${seed}: ${name} not one-way`);
      if (ring.some((st) => O.nodes[st.n0].control !== "none")) err(`organic ${seed}: ${name} has signals`);
      const from = O.streets[O.gates[0]!.street].id * 2 + 1;
      for (const st of ring) if (!planRoute(O, from, 20, [{ d: st.id * 2, after: st.len / 2 }], 30000, (e) => O.streets[e >> 1].inCity)) err(`organic ${seed}: no route round ${name}`);
      const N = O.nodes[ring[0].n0], mid = ring.reduce((m, st) => [m[0] + O.nodes[st.n0].x / ring.length, m[1] + O.nodes[st.n0].z / ring.length], [0, 0]);
      const isl = O.blockAt(mid[0], mid[1]);
      if (!isl?.park) err(`organic ${seed}: ${name} has no park in the middle (${N.x.toFixed(0)},${N.z.toFixed(0)})`);
      // (Its island's kerbs are all on the ring's far side: no stop there, journey.ts skips it.)
      else if (isl.faces.some((f) => O.drivable(f))) err(`organic ${seed}: ${name}'s island has a kerb the truck can stop at`);
    }
    const segs = O.streets.map((st) => { const a = O.nodes[st.n0], b = O.nodes[st.n1]; return [a.x, a.z, b.x, b.z, st.n0, st.n1]; });
    let crossings = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const [ax, az, bx, bz, a0, a1] = segs[i], [cx, cz, dx, dz, c0, c1] = segs[j];
      if (a0 === c0 || a0 === c1 || a1 === c0 || a1 === c1) continue;
      const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
      if (o(ax, az, bx, bz, cx, cz) * o(ax, az, bx, bz, dx, dz) < 0 && o(cx, cz, dx, dz, ax, az) * o(cx, cz, dx, dz, bx, bz) < 0) crossings++;
    }
    if (crossings) err(`organic ${seed}: ${crossings} pairs of streets cross`);
    if (O.gates.length !== gates.length) err(`organic ${seed}: ${O.gates.length} gates of ${gates.length}`);
    if (O.blocks.some((b) => b.area < 150)) err(`organic ${seed}: a block of ${Math.min(...O.blocks.map((b) => b.area)).toFixed(0)} m2`);
    const from = O.streets[O.gates[0]!.street].id * 2 + 1;
    for (let k = 0; k < 10; k++) {
      const s = Math.floor(hash2(k, seed, 0, 2) * O.streets.length), d = s * 2 + (O.streets[s].oneway ? 0 : k % 2);   // (a ring's sides, driven their own way)
      if (!O.streets[s].inCity) continue;
      if (!planRoute(O, from, 20, [{ d, after: O.faceLen(d) / 2 }], 30000, (e) => O.streets[e >> 1].inCity)) err(`organic ${seed}: no route to street ${s}`);
    }
    if (seed === 1) console.log(`organic: ${O.nodes.length} nodes, ${O.streets.length} streets, ${O.blocks.length} blocks, shortest street ${Math.min(...O.streets.map((s) => s.len)).toFixed(1)} m`);
  }
  console.log(`organic: ${rivers} of 10 rivers (${bridges} bridges), ${rings} of 20 roundabouts`);
  if (rings < 10) err(`organic: only ${rings} of 20 roundabouts fit`);
  // Outlines (outline.ts, citygen.ts trimToOutline): every layout cut back to an uneven outline, in
  // coastal and port towns with the sea along one side. No two streets cross; the town hangs
  // together from the entry gate; every open gate's street runs straight in from its outer end,
  // none on the sea side; no kept block lies off the land or in the sea; and the shore's streets
  // have the sea on one side only.
  setCityLimits(5);   // (12 blocks square: lo -6, hi 5, gates at 3, as above)
  let trimmed = 0, seas = 0, closed = 0;
  for (let seed = 1; seed <= 18; seed++) {
    const style = [STYLES.coastal, STYLES.port, STYLES.brick][seed % 3], O = new CityOutline(seed * 7919, style, { freeway: null, straightRows: [], straightCols: [] });
    const go = { lo, hi, gates: GATES, nameEW: (i: number) => `E${i}`, nameNS: (i: number) => `N${i}`, elevatedRow: () => false, cableColumn: () => false };
    const L = seed % 3 === 0 ? organicGraph(go, seed, { river: seed % 2 === 0 }) : seed % 3 === 1 ? cityGraph(go, seed) : warpGraph(go, seed, 10, { drop: { p: () => 0.1, keep: () => true }, riverLine: riverRow(1, lo, hi) });
    const entry = GATES.indexOf(entryGateOf(seed * 7919)), T = trimToOutline(L, O, GATES, entry);
    if (!T) { err(`outline ${seed}: the trim failed`); continue; }
    trimmed++;
    if (O.sea !== null) seas++;
    const segs = T.streets.map((st) => { const a = T.nodes[st.n0], b = T.nodes[st.n1]; return [a.x, a.z, b.x, b.z, st.n0, st.n1, st.k]; });
    let crossings = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const [ax, az, bx, bz, a0, a1, ka] = segs[i], [cx, cz, dx, dz, c0, c1, kc] = segs[j];
      if (ka || kc || a0 === c0 || a0 === c1 || a1 === c0 || a1 === c1) continue;
      const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
      if (o(ax, az, bx, bz, cx, cz) * o(ax, az, bx, bz, dx, dz) < 0 && o(cx, cz, dx, dz, ax, az) * o(cx, cz, dx, dz, bx, bz) < 0) crossings++;
    }
    if (crossings) err(`outline ${seed}: ${crossings} pairs of streets cross`);
    T.gates.forEach((gt, i) => {
      if (!gt) { closed++; if (i === entry) err(`outline ${seed}: the entry gate is closed`); return; }
      if (GATES[i].dir === O.sea) err(`outline ${seed}: gate ${i} open on the sea side`);
      const st = T.streets[gt.street], L2 = O.gateLine(i), far = T.nodes[st.n1];
      if (Math.hypot(far.x - L2.x, far.z - L2.z) > 0.5) err(`outline ${seed}: gate ${i}'s street doesn't reach its outer end`);
      if (st.inCity || st.k !== 0) err(`outline ${seed}: gate ${i}'s street isn't a straight way out`);
    });
    for (const b of T.blocks) if (b.inCity && (O.inSea(b.cx, b.cz) || !O.inLand(b.cx, b.cz))) err(`outline ${seed}: block ${b.kx},${b.kz} off the land`);
    for (const st of T.streets) {
      if (!st.inCity) continue;
      const wet = [0, 1].map((k) => { const b = T.faceBlock[st.id * 2 + k]; if (b >= 0) return T.blocks[b].water; const p = T.facePt(st.id * 2 + k, st.len / 2, 8); return O.inSea(p.x, p.z); });
      if (wet[0] && wet[1] && [0, 1].every((k) => T.faceBlock[st.id * 2 + k] < 0)) err(`outline ${seed}: street ${st.id} out in the sea`);
    }
    const from = T.streets[T.gates[entry]!.street].id * 2 + 1;
    for (let k = 0; k < 10; k++) {
      const s2 = Math.floor(hash2(k, seed, 0, 3) * T.streets.length), d = s2 * 2 + (T.streets[s2].oneway ? 0 : k % 2);
      if (!T.streets[s2].inCity) continue;
      if (!planRoute(T, from, 20, [{ d, after: T.faceLen(d) / 2 }], 30000, (e) => T.streets[e >> 1].inCity)) err(`outline ${seed}: no route to street ${s2}`);
    }
  }
  console.log(`outlines: ${trimmed} of 18 trimmed, ${seas} on the sea, ${closed} gates closed`);
  setCityLimits(30);
  console.log(`citygraph: ${G.nodes.length} nodes, ${G.streets.length} streets, ${G.blocks.length} blocks, ${errs.length} errors`);
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
