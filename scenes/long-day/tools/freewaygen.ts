// The freeway as the generator lays it out (drafting only: docs/fixed-cities.md). The city file
// holds what it lays out (cityfile.ts CityFileFreeway), which is all the scene reads.
import { BLOCK, STREET } from "../src/grid.ts";
import { hash2 } from "../src/rng.ts";
import { CITY_HI, CITY_LO } from "../src/city.ts";
import type { Gate } from "../src/city.ts";
import type { CityStyle } from "../src/styles.ts";
import { FW_STRAIGHT } from "../src/freeway.ts";
import type { FwCurve } from "../src/freeway.ts";
import { entryGateOf } from "./outlinegen.ts";

// Whether a city has a freeway, and through which gate: about half of them (never in a small
// Main Street town, nor across a metro's elevated lines). A pure function of the city's seed.
export function ruleFreewayGate(citySeed: number, style: CityStyle): Gate | null {
  if (style.id === "mainstreet" || style.storybook) return null;
  const g = entryGateOf(citySeed);
  if (style.elevated && (g.dir === 1 || g.dir === 3)) return null;
  return hash2(citySeed, 0xf3e, 0, 0x7a2) < 0.55 ? g : null;
}
// Whether the truck takes the freeway into a freeway city (about half of them).
export function ruleFreewayMerge(citySeed: number) { return hash2(citySeed, 0x3e6, 0, 0x7a3) < 0.5; }

// An organic town's freeway (CityPlan.layout: none other has one that bends): straight in from its
// gate past the interchange (FW_STRAIGHT blocks: the grid's patch round it, citygen.ts), then on
// through town along a smooth curve, either an S over to the far side (`s`: some blocks to one
// side) or a long bend out through the side to its right (`bend`: never towards the sea, on the
// left), leaving town square to that edge on one of the grid's lines, clear of its gates. From the
// city's seed and gate alone (a country road needs it before the town is laid out), or null: a
// town too small for it (the straight leaves too little), or with no room clear of the gates.
export function freewayCurveOf(seed: number, g: Gate, gates: readonly Gate[], seaward: boolean): FwCurve | null {
  const span = CITY_HI + 1 - CITY_LO;
  if (span < 18) return null;
  const at = (i: number) => i * BLOCK + STREET / 2, X0 = at(CITY_LO), X1 = at(CITY_HI + 1);
  const I = [[-1, 0], [0, 1], [1, 0], [0, -1]][g.dir], R = [-I[1], I[0]], N0 = [at(g.ix), at(g.iz)];
  const dot = (x: number, z: number, v: number[]) => (x - N0[0]) * v[0] + (z - N0[1]) * v[1];
  // (How far the town reaches either side of the line, and where its gates are along each edge.)
  const room = (v: number[]) => v[0] ? ((v[0] > 0 ? X1 : X0) - N0[0]) * v[0] : ((v[1] > 0 ? X1 : X0) - N0[1]) * v[1];
  const right = room(R), left = room([-R[0], -R[1]]), h = (k: number) => hash2(seed, 0xc7a, 0, k);
  const gatesOn = (dir: number) => gates.filter((q) => q.dir === dir);
  // S: over to the opposite edge, 3 to 6 blocks to one side, clear of its gates (and of the sea).
  const opp = gatesOn((g.dir + 2) % 4).map((q) => dot(at(q.ix), at(q.iz), R));
  const sCands: number[] = [];
  for (let k = -6; k <= 6; k++) {
    const lat = k * BLOCK;
    if (Math.abs(k) < 3 || lat > right - 3 * BLOCK || -lat > left - (seaward ? 5 : 3) * BLOCK || opp.some((o) => Math.abs(o - lat) < 1.5 * BLOCK)) continue;
    sCands.push(lat);
  }
  // Bend: out through the right-hand edge, a good way on in from the straight, clear of its gates.
  const side = gatesOn((g.dir + 1) % 4).map((q) => dot(at(q.ix), at(q.iz), I));   // (the right-hand edge's gates: they face R)
  const bCands: number[] = [];
  if (right >= 5 * BLOCK) for (let m = FW_STRAIGHT + 5; m <= span - 3; m++) if (side.every((o) => Math.abs(o - m * BLOCK) >= 1.5 * BLOCK)) bCands.push(m * BLOCK);
  const bend = bCands.length > 0 && (h(1) < 0.5 || !sCands.length);
  if (!bend && !sCands.length) return null;
  const P1 = [N0[0] + I[0] * FW_STRAIGHT * BLOCK, N0[1] + I[1] * FW_STRAIGHT * BLOCK];
  let E: number[], D: number[];
  if (bend) { const m = bCands[Math.floor(h(2) * bCands.length) % bCands.length]; E = [N0[0] + I[0] * m + R[0] * right, N0[1] + I[1] * m + R[1] * right]; D = R; }
  else { const lat = sCands[Math.floor(h(3) * sCands.length) % sCands.length]; E = [N0[0] + I[0] * span * BLOCK + R[0] * lat, N0[1] + I[1] * span * BLOCK + R[1] * lat]; D = I; }
  // (A cubic from P1 heading in to E heading out, sampled finely.)
  const c = Math.hypot(E[0] - P1[0], E[1] - P1[1]) * 0.42, C1 = [P1[0] + I[0] * c, P1[1] + I[1] * c], C2 = [E[0] - D[0] * c, E[1] - D[1] * c];
  const pts: [number, number][] = [], cum: number[] = [0], N = 400;
  for (let i = 0; i <= N; i++) {
    const t = i / N, u = 1 - t, b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
    pts.push([b0 * P1[0] + b1 * C1[0] + b2 * C2[0] + b3 * E[0], b0 * P1[1] + b1 * C1[1] + b2 * C2[1] + b3 * E[1]]);
    if (i) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return { pts, cum, len: cum[N], ex: E[0], ez: E[1], dx: D[0], dz: D[1], kind: bend ? "bend" : "s" };
}

