// City files (docs/long-day-cities.md): each catalogue city's plan, written out as data in
// src/city-<style>/<slug>/<slug>.ts and read here into its street graph. A file holds the
// city's structure explicitly: its nodes, streets, gates and each block's properties. What stands
// on that layout is listed in the city's contents file beside it (contents.ts).
//
// Nodes and streets carry ids that are never renumbered; the graph numbers them in file order.
// Blocks are found from the streets (CityGraph.findBlocks), and each block's properties attach to
// a label point inside it, so moving streets does not misattach them. A curved street stores its
// bend: how far its middle lies to the left of the line from its first node to its second, driving
// that way (negative: to the right), in metres. Coordinates are world metres.
import { CityGraph, inPoly } from "./citygraph.ts";
import type { RecipeRow } from "./contents.ts";
import type { Control } from "./citygraph.ts";
import { presetJunctionPosts } from "./signals.ts";
import type { SignalPole } from "./signals.ts";
import type { District } from "./city.ts";
import type { FacilityId } from "./facilities.ts";
import type { StyleId } from "./styles.ts";
import type { Steps } from "./slices.ts";
import type { SeaData } from "./outline.ts";
import type { FwCurve } from "./freeway.ts";
import type { ExitKind } from "./route.ts";

export interface CityFile {
  format: 1;
  id: string;                     // (It is <style>-<slug>, as in the file's name.)
  name: string;
  style: StyleId;
  key: number;                    // (The default rules hash it. It is the seed the city was drafted from.)
  layout: "grid" | "warp" | "organic";
  outline: { scale: number; seaOff?: true };   // (It says how the town's outline was cut, outline.ts.)
  sea?: SeaData | null;           // (The town's sea, outline.ts SeaData; null on no sea.)
  freeway?: CityFileFreeway;      // (The town's freeway, if it has one.)
  nodes: CityFileNode[];
  streets: CityFileStreet[];
  gates: (CityFileGate | null)[]; // (The way in comes first, then the ways out; null stands for a gate the sea closed.)
  blocks: CityFileBlock[];
  // Its contents in place of those its own contents file lists (docs/long-day-cities.md, "City
  // contents"), or (null) none: tests and the drafting tools give a city by its rules this way.
  contents?: () => CityFileContents | null;
}
// A city's contents: each block's items (by its place in the file's `blocks`), each street's (by
// its id) and the countryside ring's, each a recipe's row (contents.ts rowOf).
export interface CityFileContents { blocks: Record<number, RecipeRow[]>; streets: Record<number, RecipeRow[]>; outskirts: RecipeRow[] }
// A town's freeway (freeway.ts): the gate slot whose line it runs out along (its way in, gate g0),
// whether the truck comes in on it (merge) and by which kind of exit, and its curve through an
// organic town.
export interface CityFileFreeway { gate: { ix: number; iz: number; dir: number }; merge: boolean; exit?: ExitKind; curve?: FwCurve }
export interface CityFileNode {
  id: number; x: number; z: number;
  k: [number, number];            // (It is the node's hash key, the old grid's ix and iz.)
  control?: Control;              // (It is "stop" or "none" where the junction has no signals.)
  poles?: [number, number, number, number, number][];   // (Its signal poles: each [arm, x, z, heading, mast reach], signals.ts SignalPole.)
  stops?: [number, number, number][];                   // (Its stop signs' posts: each [arm, x, z].)
}
export type StreetTag = "elevated" | "cable" | "freeway";
export interface CityFileStreet {
  id: number; a: number; b: number;
  name?: string;
  bend?: number;
  half?: number;                  // (It runs from the centre line to the back of the sidewalk, when not 9.)
  kerb?: number;                  // (It is the sidewalk's width, when not 3.)
  outside?: true;                 // (The street lies beyond the town, and nothing drives it.)
  oneway?: true;                  // (Traffic drives it only from a to b.)
  ring?: true;                    // (It is part of a roundabout's ring.)
  tags?: StreetTag[];
  furniture?: [string, "l" | "r", number][];   // (Its pavements' furniture: each [kind, the side it stands on looking from a to b, metres along from a].)
}
export interface CityFileGate {
  id: string;
  street: number;                 // (It is the gate's street, which runs out of town.)
  out: "a" | "b";                 // (It names the end of that street that lies outside.)
  dir: number;                    // (It is the way out: 0 east, 1 north, 2 west, 3 south.)
  x: number; z: number;           // (They are the gate street's outer end.)
}
export interface CityFileBlock {
  at: [number, number];           // (It is a point inside the block.)
  k: [number, number];            // (It is the block's hash key.)
  district: District;
  facility?: FacilityId;          // (Water and the outskirts have none.)
  water?: true; park?: true;
  outside?: true;                 // (The block is not part of the town.)
  lots?: CityFileLot[];           // (Its lots, when it is hand-shaped: in place of those the rules pick, city.ts buildLots.)
  doors?: CityFileDoor[];         // (Its facility's front doors, at most one a side; an empty list when it has none: city.ts kerbDoors.)
}
// A facility's front door on side `side` of its block (the side's index in the block's faces, as
// the city's graph numbers them): `a` metres along that side's frontage and `n` metres in from its
// edge, its frame's and panel's colours, its half width and height, whether its facade paints it
// itself (`plain`), whether it is a wide service door, and its sill's height when that is not the
// kerb's (a garage roof's stair tower).
export interface CityFileDoor { side: number; a: number; n: number; frame: number; panel: number; half: number; h: number; plain?: true; wide?: true; y?: number }
// A lot of a hand-shaped block: on the face along `street` on its `side` looking from its first node
// to its second, from `a0` to `a1` metres along that face's frontage (from the node it starts at:
// the first node for the right side, the second for the left) and `depth` metres in. Its building
// may give its floors and its walls' colour; the rest is its district's, as on any lot.
export interface CityFileLot { street: number; side: "l" | "r"; a0: number; a1: number; depth: number; floors?: number; wall?: number }

export const STREET_HALF = 9, STREET_KERB = 3;

// A curved street's heading, curvature and length from its ends and its bend.
export function arcOf(ax: number, az: number, bx: number, bz: number, bend: number): { h0: number; k: number; len: number } {
  const c = Math.hypot(bx - ax, bz - az), hc = Math.atan2(-(bz - az), bx - ax);
  const phi = 4 * Math.atan(2 * Math.abs(bend) / c), R = c / (2 * Math.sin(phi / 2)), sign = Math.sign(bend);
  return { h0: hc + sign * phi / 2, k: -sign / R, len: R * phi };
}

// The city's street graph, a few pieces at a time (slices.ts). It throws on a file whose blocks
// and labels do not pair one to one.
export function* graphOfFile(F: CityFile): Steps<CityGraph> {
  const G = new CityGraph(), node = new Map<number, number>(), street = new Map<number, number>();
  for (const n of F.nodes) node.set(n.id, G.addNode(n.x, n.z, n.k[0], n.k[1]));
  for (const s of F.streets) {
    const a = node.get(s.a)!, b = node.get(s.b)!, A = G.nodes[a], B = G.nodes[b];
    const arc = s.bend ? arcOf(A.x, A.z, B.x, B.z, s.bend) : {};
    const tags: CityGraph["streets"][number]["tags"] = {};
    for (const t of s.tags ?? []) tags[t] = true;
    street.set(s.id, G.addStreet(a, b, { ...arc, name: s.name ?? "", half: s.half ?? STREET_HALF, kerb: s.kerb ?? STREET_KERB,
      inCity: !s.outside, oneway: !!s.oneway, ring: !!s.ring, tags }));
  }
  // (Each junction's signal poles and stop signs' posts, as the file lists them.)
  const poles = new Map<number, SignalPole[]>(), stops = new Map<number, Map<number, [number, number]>>();
  for (const n of F.nodes) {
    const id = node.get(n.id)!;
    poles.set(id, (n.poles ?? []).map(([i, px, pz, h, toCentre]) => ({ i, px, pz, h, toCentre })));
    stops.set(id, new Map((n.stops ?? []).map(([arm, x, z]) => [arm, [x, z] as [number, number]])));
  }
  presetJunctionPosts(G, poles, stops);
  F.gates.forEach((g, i) => {
    if (!g) { G.gates.push(null); return; }
    const sid = street.get(g.street)!, st = G.streets[sid], out = g.out === "b" ? 1 : 0;
    st.gate = i;
    G.gates.push({ node: out ? st.n0 : st.n1, street: sid, out, dir: g.dir, x: g.x, z: g.z });
  });
  yield;
  yield* G.finishSteps();
  for (const n of F.nodes) if (n.control && n.control !== "signal") { const N = G.nodes[node.get(n.id)!]; N.control = n.control; N.phases = 1; N.phaseOf.fill(0); }
  const keys: [number, number][] = new Array(G.blocks.length);
  for (const L of F.blocks) {
    const B = G.blockAt(L.at[0], L.at[1]);
    if (!B) throw new Error(`${F.id}: block label at ${L.at} is in no block`);
    if (keys[B.id]) throw new Error(`${F.id}: two block labels in one block, at ${L.at}`);
    keys[B.id] = L.k;
    if (L.water) B.water = true;
    if (L.park) B.park = true;
    if (L.outside) B.inCity = false;
    if (B.park || B.water) B.anchor = null;
  }
  const bare = G.blocks.findIndex((_, i) => !keys[i]);
  if (bare >= 0) throw new Error(`${F.id}: block ${bare} (round ${G.blocks[bare].cx.toFixed(1)}, ${G.blocks[bare].cz.toFixed(1)}) has no label`);
  G.setBlockKeys(keys);
  return G;
}

// A point inside a polygon: its centroid when that is inside, else the middle of the widest run
// of a line across it through the centroid's z.
export function insidePoint(poly: [number, number][], cx: number, cz: number): [number, number] {
  if (inPoly(poly, cx, cz)) return [cx, cz];
  for (const dz of [0, 1, -1, 2, -2, 4, -4, 8, -8]) {
    const z = cz + dz, xs: number[] = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [x0, z0] = poly[j], [x1, z1] = poly[i];
      if ((z0 > z) !== (z1 > z)) xs.push(x0 + (z - z0) / (z1 - z0) * (x1 - x0));
    }
    xs.sort((p, q) => p - q);
    let best = -1, bx = 0;
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > best) { best = xs[i + 1] - xs[i]; bx = (xs[i] + xs[i + 1]) / 2; }
    if (best > 0.5 && inPoly(poly, bx, z)) return [bx, z];
  }
  return [cx, cz];
}
