// Test: every roadside business on the country drive (country.ts piecePaving: gas stations, truck
// stops, fruit stands, attractions) can be driven to: each of its lots is joined to the road through
// its drives (a drive starts at the asphalt's edge; pavings that share an edge or overlap join), a
// gas station and a truck stop have a way in at one end and a way out at the other, and its price
// sign stands clear of where cars drive. Checked on the pieces of real drives, and on each kind on
// both sides of the road.
// Args (all optional): seed
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { GAS_SIGN, PAVE_EDGE, pieceSigns, pieceSpan, piecePaving } from "../src/country.ts";
import type { RoadPiece } from "../src/country.ts";

type Pt = [number, number];
const EPS = 1e-6;
const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function inside(p: Pt, P: Pt[]) {   // (convex, either winding; on the edge counts)
  let pos = false, neg = false;
  for (let i = 0; i < P.length; i++) { const c = cross(P[i], P[(i + 1) % P.length], p); if (c > EPS) pos = true; if (c < -EPS) neg = true; }
  return !(pos && neg);
}
// Two pavings join along more than a point: an edge of one runs along an edge of the other for a
// stretch, or they overlap.
function join(A: Pt[], B: Pt[]) {
  for (let i = 0; i < A.length; i++) for (let j = 0; j < B.length; j++) {
    const a = A[i], b = A[(i + 1) % A.length], c = B[j], d = B[(j + 1) % B.length];
    if (Math.abs(cross(a, b, c)) < EPS && Math.abs(cross(a, b, d)) < EPS) {   // collinear: how much they share
      const ux = b[0] - a[0], uy = b[1] - a[1], L = Math.hypot(ux, uy), t = (p: Pt) => ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / L;
      if (Math.min(L, Math.max(t(c), t(d))) - Math.max(0, Math.min(t(c), t(d))) > 2) return true;
    }
  }
  const mid = (P: Pt[]): Pt => [P.reduce((m, q) => m + q[0], 0) / P.length, P.reduce((m, q) => m + q[1], 0) / P.length];
  return inside(mid(A), B) || inside(mid(B), A);
}

const errs: string[] = [];
function check(p: RoadPiece, where: string) {
  const V = piecePaving(p);
  if (!V.length) { errs.push(`${where}: ${p.kind} has no paving`); return; }
  for (const v of V) for (const [, n] of v.pts) if (Math.sign(n) !== p.side && Math.abs(n) > EPS) errs.push(`${where}: ${p.kind} paving across the road`);
  // From the road (drives that start at the asphalt's edge), out through whatever joins.
  const reached = new Set<number>(), road: number[] = [];
  V.forEach((v, i) => { if (v.kind !== "lot" && v.kind !== "apron" && v.pts.some(([, n]) => Math.abs(Math.abs(n) - PAVE_EDGE) < EPS)) road.push(i); });
  const q = [...road]; for (const i of q) reached.add(i);
  while (q.length) { const i = q.pop()!; V.forEach((v, j) => { if (!reached.has(j) && join(V[i].pts, v.pts)) { reached.add(j); q.push(j); } }); }
  V.forEach((v, i) => { if (!reached.has(i)) errs.push(`${where}: ${p.kind}'s ${v.kind} ${i} can't be reached from the road`); });
  // A way in and a way out, apart, for a forecourt.
  if (p.kind === "gas" || p.kind === "truckstop") {
    const mids = road.map((i) => V[i].pts.reduce((m, q) => m + q[0], 0) / V[i].pts.length).sort((a, b) => a - b);
    if (mids.length < 2 || mids[mids.length - 1] - mids[0] < 60) errs.push(`${where}: ${p.kind} hasn't separate drives in and out`);
  }
  // The gas station's sign: not on any paving.
  if (p.kind === "gas") {
    const g = pieceSigns(p)[0];
    if (g.s !== p.s + GAS_SIGN) errs.push(`${where}: gas sign moved`);
    for (const v of V) if (inside([g.s, g.n], v.pts)) errs.push(`${where}: gas sign stands on its ${v.kind}`);
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
      for (const p of road.pieces) if (p.kind === "gas" || p.kind === "truckstop" || p.kind === "fruit" || p.kind === "attraction") { check(p, `seed ${seed} city ${road.inp.city} s${p.s.toFixed(0)}`); n++; }
      const biz = road.pieces.filter((p) => piecePaving(p).length);
      for (const p of biz) for (const o of road.pieces) if (o !== p) {
        const [a, b] = pieceSpan(p), [c, d] = pieceSpan(o);
        if (a < d && c < b && o.kind !== "tractor" && o.kind !== "fwsign") errs.push(`seed ${seed} city ${road.inp.city}: ${p.kind} s${p.s.toFixed(0)} overlaps ${o.kind} s${o.s.toFixed(0)}`);
      }
    }
  }
  if (n < 10) errs.push(`only ${n} roadside businesses on the drives checked`);
  if (errs.length) { console.error(errs.slice(0, 40).join("\n")); proc.exit(1); }
  console.log(`roadside: ${n} businesses on real drives, and each kind both sides: all reachable from the road`);
}
