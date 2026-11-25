// Test: every roadside business on the country drive (country.ts piecePaving: gas stations, truck
// stops, fruit stands, attractions) can be driven to: each of its lots is joined to the road through
// its drives (a drive starts at the asphalt's edge; pavings join where one's edge runs along the
// other's for a stretch), none laid over another. A gas station's or a truck stop's way in and way
// out are slip lanes at either end: each a lane's width all the way from its taper onto the lot,
// with no kink in it (its edges never turning more steeply than 1 in 2 from the road), a long one,
// with a grass island between the lot and the road. And the price sign stands on that island.
// On real drives, the paving lies on level ground (the road's level at the piece) that scenery
// keeps off. Checked on the pieces of real drives, and on each kind on both sides of the road.
// Args (all optional): seed
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { FORECOURT, GAS_SIGN, PAVE_EDGE, paveAt, pieceSigns, pieceSpan, piecePaving } from "../src/country.ts";
import type { RoadPave, RoadPiece } from "../src/country.ts";

const EPS = 1e-6, DS = 0.25;
// Over the stretch both span: how far along they touch (edge to edge) and how far they overlap.
function meet(A: RoadPave, B: RoadPave) {
  const a = Math.max(A.s[0], B.s[0]), b = Math.min(A.s[A.s.length - 1], B.s[B.s.length - 1]);
  let touch = 0, over = 0;
  if (A.side !== B.side) return { touch, over };
  for (let s = a + DS / 2; s < b; s += DS) {
    const x = paveAt(A, s)!, y = paveAt(B, s)!;
    if (x[1] - x[0] < 1e-3 || y[1] - y[0] < 1e-3) continue;
    const gap = Math.max(x[0], y[0]) - Math.min(x[1], y[1]);
    if (gap < 1e-4 && gap > -0.02) touch += DS;
    else if (gap <= -0.02) over += DS;
  }
  return { touch, over };
}

const errs: string[] = [];
function check(p: RoadPiece, where: string) {
  const V = piecePaving(p);
  if (!V.length) { errs.push(`${where}: ${p.kind} has no paving`); return; }
  for (const v of V) {
    if (v.side !== p.side) errs.push(`${where}: ${p.kind} paving across the road`);
    for (let i = 0; i < v.s.length; i++) {
      if (v.lo[i] < PAVE_EDGE - EPS || v.hi[i] < v.lo[i] - EPS) errs.push(`${where}: ${p.kind}'s ${v.kind} edges wrong at s${v.s[i].toFixed(1)}`);
      if (i && v.s[i] < v.s[i - 1]) errs.push(`${where}: ${p.kind}'s ${v.kind} stations out of order`);
    }
  }
  V.forEach((v, i) => V.forEach((w, j) => { if (j > i && meet(v, w).over > 0.5) errs.push(`${where}: ${p.kind}'s ${v.kind} ${i} laid over its ${w.kind} ${j}`); }));
  // From the road (drives that start at the asphalt's edge), out through whatever joins.
  const reached = new Set<number>(), road: number[] = [];
  V.forEach((v, i) => { if (v.kind !== "lot" && v.kind !== "apron" && v.lo.some((n, k) => Math.abs(n - PAVE_EDGE) < EPS && v.hi[k] - n > 3)) road.push(i); });
  const q = [...road]; for (const i of q) reached.add(i);
  while (q.length) { const i = q.pop()!; V.forEach((v, j) => { if (!reached.has(j) && meet(V[i], v).touch > 2) { reached.add(j); q.push(j); } }); }
  V.forEach((v, i) => { if (!reached.has(i)) errs.push(`${where}: ${p.kind}'s ${v.kind} ${i} can't be reached from the road`); });
  // A forecourt's slip lanes, in at one end and out at the other.
  if (p.kind === "gas" || p.kind === "truckstop") {
    if (road.length !== 2 || Math.abs(V[road[0]].s[0] - V[road[1]].s[0]) < 150) errs.push(`${where}: ${p.kind} hasn't a slip lane at each end`);
    for (const i of road) {
      const v = V[i], S0 = v.s[0], S1 = v.s[v.s.length - 1];
      if (S1 - S0 < 90) errs.push(`${where}: ${p.kind}'s slip lane only ${(S1 - S0).toFixed(0)} m long`);
      let full = 0, steep = 0, thin = 0;
      for (let s = S0; s < S1 - DS; s += DS) {
        const [lo, hi] = paveAt(v, s)!, [lo2, hi2] = paveAt(v, s + DS)!;
        steep = Math.max(steep, Math.abs(lo2 - lo) / DS, Math.abs(hi2 - hi) / DS);
        // (Its width square to its heading, where it is a whole lane: neither tapering off the
        // road nor running onto the lot.)
        const k = ((lo2 + hi2) - (lo + hi)) / 2 / DS, w = (hi - lo) / Math.hypot(1, k);
        if (lo > PAVE_EDGE + 0.05 && hi < FORECOURT - 0.05) { full += DS; if (w < 4.5) thin = Math.max(thin, 4.5 - w); }
      }
      if (steep > 0.5) errs.push(`${where}: ${p.kind}'s slip lane kinks (an edge turns 1 in ${(1 / steep).toFixed(1)})`);
      if (thin > 0.05) errs.push(`${where}: ${p.kind}'s slip lane narrows by ${thin.toFixed(2)} m on its curve`);
      if (full < 20) errs.push(`${where}: ${p.kind}'s slip lane hardly crosses its island (${full.toFixed(0)} m)`);
    }
  }
  // The gas station's sign: on the island, on no paving.
  if (p.kind === "gas") {
    const g = pieceSigns(p)[0], n = Math.abs(g.n);
    if (g.s !== p.s + GAS_SIGN || n < PAVE_EDGE + 2 || n > FORECOURT - 2) errs.push(`${where}: gas sign off its island`);
    for (const v of V) { const x = paveAt(v, g.s); if (x && v.side * g.n >= x[0] - 1 && v.side * g.n <= x[1] + 1) errs.push(`${where}: gas sign stands on its ${v.kind}`); }
  }
}
for (const kind of ["gas", "truckstop", "fruit", "attraction"] as const)
  for (const side of [1, -1] as const)
    check({ kind, s: 1000, side, len: kind === "gas" ? 110 : kind === "truckstop" ? 260 : kind === "fruit" ? 80 : 120, variant: 0 }, `${kind} side ${side}`);
// Real drives: their businesses, and no two pieces' stretches (drives and signs) overlapping.
{
  const proc = (globalThis as any).process;
  let n = 0;
  for (const seed of proc.argv[2] ? [Number(proc.argv[2])] : [1, 2, 3, 7, 11]) {
    const seen = new Set<string>();
    for (const m of [26, 55, 60, 85, 90, 115, 120]) {
      const road = new Journey(readConfig({ seed } as SceneEnv), m * 60, "autumn").country;
      if (!road || seen.has(road.key)) continue;
      seen.add(road.key);
      // (The road's own pieces, as its map has them: those facing a to b, in its coordinates.)
      const G = road.geo, own = G.pieces.filter((p) => p.way === 1);
      for (const p of own) if (p.kind === "gas" || p.kind === "truckstop" || p.kind === "fruit" || p.kind === "attraction") {
        const where = `seed ${seed} city ${road.inp.city} s${p.s.toFixed(0)}`;
        check(p, where); n++;
        // Its paving on level ground, the road's own level, with no scenery on it.
        let bad = 0, clear = 0;
        for (const v of piecePaving(p)) for (let s = v.s[0]; s <= v.s[v.s.length - 1]; s += 4) {
          const x = paveAt(v, s)!;
          for (let m = x[0]; m <= x[1]; m += 2) {
            if (Math.abs(G.groundAt(s, v.side * m) - G.baseAt(p.s)) > 0.05) bad++;
            if (Math.abs(m) >= 11 && G.clearAt(s, v.side * m)) clear++;
          }
        }
        if (bad) errs.push(`${where}: ${p.kind}'s paving on uneven ground at ${bad} points`);
        if (clear) errs.push(`${where}: ${p.kind}'s paving open to scenery at ${clear} points`);
      }
      const biz = own.filter((p) => piecePaving(p).length);
      for (const p of biz) for (const o of own) if (o !== p) {
        const [a, b] = pieceSpan(p), [c, d] = pieceSpan(o);
        if (a < d && c < b && o.kind !== "tractor" && o.kind !== "fwsign") errs.push(`seed ${seed} city ${road.inp.city}: ${p.kind} s${p.s.toFixed(0)} overlaps ${o.kind} s${o.s.toFixed(0)}`);
      }
    }
  }
  if (n < 10) errs.push(`only ${n} roadside businesses on the drives checked`);
  if (errs.length) { console.error(errs.slice(0, 40).join("\n")); proc.exit(1); }
  console.log(`roadside: ${n} businesses on real drives, and each kind both sides: all reachable from the road`);
}
