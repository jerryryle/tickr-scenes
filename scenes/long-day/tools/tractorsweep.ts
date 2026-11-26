// Which moves through a city's junctions a tractor-trailer must never take (citygraph.ts
// noTractor). Each move is driven on the path a tractor's route gives it (route.ts, its rights
// wide ones), from just past the junction before to 40 m on, its trailer swung in behind it as
// journey.ts hitchStep swings it. A move is banned when the rig comes more than SWEEP_INTO_MAX past the
// back of a sidewalk, into a block, or when its cab or trailer passes through anything standing on
// the pavement near the junction: a signal pole, a stop sign's post, a streetlight, a street tree or
// a piece of street furniture, each by its own footprint.
//
// A tractor's trailer axles are 10 m behind its kingpin (hitch.ts KINGPIN_TO_AXLES), and on a turn
// they cut inside the path the tractor drives. Round a square corner they clear the kerb's tip;
// round an organic town's sharp bends (which the route counts as going straight on), and a few of
// its odd-angled rights, they run over a corner's sidewalk and through what stands there. A
// tractor goes round those by other ways.
import { pavementObstacles } from "../src/city.ts";
import type { CityPlan } from "../src/city.ts";
import type { CityGraph, CNode } from "../src/citygraph.ts";
import { Path } from "../src/route.ts";
import type { Pose } from "../src/route.ts";
import { SPECS, TRAILER, truckExtents } from "../src/truck.ts";
import { FIFTH_WHEEL, KINGPIN_TO_AXLES } from "../src/hitch.ts";

// m: the most the rig may come past the back of a sidewalk (test/offtrack.ts CUT_MAX).
const SWEEP_INTO_MAX = 0.3;
// The rig's reach that counts: within SWEEP_NEAR of the junction's middle.
const SWEEP_NEAR = 35;
// What stands on the pavement, by its kind (decor.ts PK): its own footprint's radius, smaller than
// the clearance walkers keep round it. (0: a pole or post, its own radius.)
const SWEEP_FOOT = [0.16, 0.16, 0.3, 0.25, 0.25, 0.2, 0.05, 0.3, 0.3, 0.15, 0.2];
// These are journey.ts truckNose and truckTail, for a tractor.
const SWEEP_NOSE = () => SPECS.tractor.noseFront + 0.05, SWEEP_TAIL = 1.5;

export interface TractorClash { din: number; dout: number; into: number; hits: string[] }

// Every move through the city's junctions the tractor may not take, with what it hits: each move
// driven on its own, in from just past the junction before it.
export function tractorClashes(plan: CityPlan): TractorClash[] {
  const G = plan.graph, out: TractorClash[] = [];
  for (const N of G.nodes) {
    if (N.arms.length < 2) continue;
    const near = sweepNear(plan, N);
    for (const a of N.arms) {
      const din = a.street * 2 + (a.end ^ 1);
      if (G.dedgeTo(din) !== N.id || !sweepDrives(G, din)) continue;
      for (const m of G.movesFrom(din)) {
        if (!sweepDrives(G, m.to)) continue;
        const c = sweepMove(G, N, near, [din, m.to]);
        if (c) out.push(c);
      }
    }
  }
  return out;
}

// The banned moves of a whole city, as citygraph.ts noTractor keys them.
export function tractorBans(plan: CityPlan): Set<number> {
  return new Set(tractorClashes(plan).map((c) => c.din * 65536 + c.dout));
}

// sweepNear gives what stands near a junction and the streets that could hold any point of the
// rig there.
function sweepNear(plan: CityPlan, N: CNode) {
  const G = plan.graph, obs = sweepPavement(plan, N);
  const nearSt = G.streets.filter((st) => {
    const A = G.nodes[st.n0], B = G.nodes[st.n1], vx = B.x - A.x, vz = B.z - A.z, t = Math.max(0, Math.min(1, ((N.x - A.x) * vx + (N.z - A.z) * vz) / (vx * vx + vz * vz)));
    return Math.hypot(A.x + vx * t - N.x, A.z + vz * t - N.z) < SWEEP_NEAR + st.half + (st.k ? st.len * st.len * Math.abs(st.k) / 8 : 0);
  }).map((st) => st.id);
  return { obs, nearSt };
}

// sweepDrives says whether the tractor drives through a junction on a street. It does on the town's
// own streets and the gates' streets, and not on the freeway.
function sweepDrives(G: CityGraph, d: number) {
  const st = G.streets[d >> 1];
  return (st.inCity || st.gate >= 0) && !(st.oneway && (d & 1)) && !st.tags.freeway;
}

// sweepPavement gives what stands on the pavements round a junction, from its blocks' probe builds.
function sweepPavement(plan: CityPlan, N: CNode) {
  const G = plan.graph, seen = new Set<string>(), out: { x: number; z: number; r: number; kind: number }[] = [];
  for (const a of N.arms) for (const f of [a.street * 2, a.street * 2 + 1]) {
    const b = G.faceBlock[f];
    if (b < 0 || !G.blocks[b].inCity || G.blocks[b].water) continue;
    for (const o of pavementObstacles(plan, G.blocks[b].kx, G.blocks[b].kz)) {
      const k = `${o.x.toFixed(2)},${o.z.toFixed(2)}`;
      if (seen.has(k) || Math.hypot(o.x - N.x, o.z - N.z) > SWEEP_NEAR + 5) continue;
      seen.add(k); out.push({ x: o.x, z: o.z, r: Math.min(o.r, SWEEP_FOOT[o.kind ?? 0] ?? 0.3), kind: o.kind ?? 0 });
    }
  }
  return out;
}

const SWEEP_KIND = ["post", "hydrant", "trash", "bench", "mailbox", "news", "meter", "shelter", "rack", "lamp", "tree"];
// A move, dedges `route` (from just past the junction before the first, to 40 m along the
// second), driven by the tractor: what it hits near junction N.
function sweepMove(G: CityGraph, N: CNode, near: { obs: { x: number; z: number; r: number; kind: number }[]; nearSt: number[] }, route: number[]): TractorClash | null {
  const { obs, nearSt } = near, d0 = route[0], dl = route[route.length - 1], sti = G.streets[d0 >> 1], sto = G.streets[dl >> 1];
  const before = Math.max(10, sti.len - G.faceEndMouth(d0 ^ 1) - 1), after = Math.max(5, Math.min(40, sto.len - G.faceEndMouth(dl) - 2));
  let path: Path;
  // (A move the route can't lay out is one the tractor doesn't take.)
  try { path = new Path(G, { d: d0, before, edges: route.slice(1), after, wide: true, nose: SWEEP_NOSE(), tail: SWEEP_TAIL }); }
  catch { return { din: route[0], dout: route[1], into: Infinity, hits: ["no path"] }; }
  const front = truckExtents("tractor").front, p: Pose = { x: 0, z: 0, h: 0, k: 0 };
  path.eval(0, p);
  let yaw = 0, px = p.x, pz = p.z, ph = p.h, into = 0;
  const hits = new Set<string>();
  for (let s = 0.5; s <= path.length; s += 0.5) {
    path.eval(s, p);
    const th0 = ph + yaw, ax = px + Math.cos(ph) * FIFTH_WHEEL - Math.cos(th0) * KINGPIN_TO_AXLES, az = pz - Math.sin(ph) * FIFTH_WHEEL + Math.sin(th0) * KINGPIN_TO_AXLES;
    const kx = p.x + Math.cos(p.h) * FIFTH_WHEEL, kz = p.z - Math.sin(p.h) * FIFTH_WHEEL, th = Math.atan2(-(kz - az), kx - ax);
    yaw = Math.max(-1.4, Math.min(1.4, Math.atan2(Math.sin(th - p.h), Math.cos(th - p.h))));
    px = p.x; pz = p.z; ph = p.h;
    if (Math.hypot(p.x - N.x, p.z - N.z) > SWEEP_NEAR + 10) continue;
    const fx = Math.cos(p.h), fz = -Math.sin(p.h), tx = Math.cos(p.h + yaw), tz = -Math.sin(p.h + yaw);
    // The cab's and the trailer's outlines, a point a metre: how far past every street's strip
    // (centre line to the back of the sidewalk) any comes.
    const outline = (x: number, z: number, ux: number, uz: number, a0: number, a1: number, w: number) => {
      for (let q = a0; q <= a1 + 1e-6; q += 1) for (const b of [-w, w]) {
        const ox = x + ux * q + uz * b, oz = z + uz * q - ux * b;
        if (Math.hypot(ox - N.x, oz - N.z) > SWEEP_NEAR) continue;
        let out = Infinity;
        for (const id of nearSt) {
          const st = G.streets[id], [s2, o] = G.toStreet(id, ox, oz), c = G.streetPt(id, s2, o);
          out = Math.min(out, Math.max(Math.abs(o) - st.half, Math.hypot(c.x - ox, c.z - oz) - st.half));
          if (out <= 0) break;
        }
        if (out > into) into = out;
      }
    };
    outline(p.x, p.z, fx, fz, -1.5, front, 1.25);
    outline(kx, kz, tx, tz, TRAILER.rear, TRAILER.front, TRAILER.hw);
    for (const o of obs) {
      const inBox = (x: number, z: number, ux: number, uz: number, a0: number, a1: number, w: number) => {
        const dx = o.x - x, dz = o.z - z, al = dx * ux + dz * uz, ac = dx * uz - dz * ux;
        return al > a0 - o.r && al < a1 + o.r && Math.abs(ac) < w + o.r;
      };
      if (inBox(p.x, p.z, fx, fz, -1.5, front, 1.25) || inBox(kx, kz, tx, tz, TRAILER.rear, TRAILER.front, TRAILER.hw)) hits.add(`${SWEEP_KIND[o.kind] ?? o.kind} at ${o.x.toFixed(1)}, ${o.z.toFixed(1)}`);
    }
  }
  return into > SWEEP_INTO_MAX || hits.size ? { din: route[0], dout: route[1], into, hits: [...hits] } : null;
}
