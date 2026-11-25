// City files (docs/fixed-cities.md): each catalogue city's plan, written out as data in
// src/city-<style>/<style>-city-<slug>.ts and read here into its street graph. A file holds the
// city's structure explicitly: its nodes, streets, gates and each block's properties. Everything
// else comes from the default rules in city.ts and facilities.ts, which hash the file's `key`.
//
// Nodes and streets carry ids that are never renumbered; the graph numbers them in file order.
// Blocks are found from the streets (CityGraph.findBlocks), and each block's properties attach to
// a label point inside it, so moving streets does not misattach them. A curved street stores its
// bend: how far its middle lies to the left of the line from its first node to its second, driving
// that way (negative: to the right), in metres. Coordinates are world metres.
import { CityGraph, inPoly } from "./citygraph.ts";
import type { Control } from "./citygraph.ts";
import type { District } from "./city.ts";
import type { FacilityId } from "./facilities.ts";
import type { StyleId } from "./styles.ts";
import type { Steps } from "./slices.ts";

export interface CityFile {
  format: 1;
  id: string;                     // (It is <style>-<slug>, as in the file's name.)
  name: string;
  style: StyleId;
  key: number;                    // (The default rules hash it. It is the seed the city was drafted from.)
  layout: "grid" | "warp" | "organic";
  outline: { scale: number; seaOff?: true };   // (It says how the town's outline was cut, outline.ts.)
  nodes: CityFileNode[];
  streets: CityFileStreet[];
  gates: (CityFileGate | null)[]; // (The way in comes first, then the ways out; null stands for a gate the sea closed.)
  blocks: CityFileBlock[];
}
export interface CityFileNode {
  id: number; x: number; z: number;
  k: [number, number];            // (It is the node's hash key, the old grid's ix and iz.)
  control?: Control;              // (It is "stop" or "none" where the junction has no signals.)
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
}

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
