// Writing and checking city files (src/cityfile.ts): the drafting tool (tools/draftcities.ts)
// writes a generated city's plan out with cityFileOfPlan, and it and test/catalogue.ts check a
// city with cityProblems.
import { CityPlan } from "../src/city.ts";
import { insidePoint, STREET_HALF, STREET_KERB } from "../src/cityfile.ts";
import type { CityFile, CityFileBlock, CityFileFreeway, CityFileGate, CityFileNode, CityFileStreet, StreetTag } from "../src/cityfile.ts";
import { inPoly } from "../src/citygraph.ts";
import { facilityAt, siteLayout } from "../src/facilities.ts";
import type { StyleId } from "../src/styles.ts";

const cm = (v: number) => Math.round(v * 100) / 100;

// A city's plan as a city file, its structure as the plan has it.
export function cityFileOfPlan(plan: CityPlan, id: string, name: string): CityFile {
  const G = plan.graph, O = plan.outline;
  const nodes: CityFileNode[] = G.nodes.map((N) => ({ id: N.id, x: cm(N.x), z: cm(N.z), k: [N.kx, N.kz], ...(N.control !== "signal" ? { control: N.control } : {}) }));
  const streets: CityFileStreet[] = G.streets.map((st) => {
    const A = G.nodes[st.n0], B = G.nodes[st.n1], out: CityFileStreet = { id: st.id, a: st.n0, b: st.n1 };
    if (st.name) out.name = st.name;
    if (st.k !== 0) {
      const M = G.streetPt(st.id, st.len / 2, 0), hc = Math.atan2(-(B.z - A.z), B.x - A.x);
      const bend = cm((M.x - (A.x + B.x) / 2) * -Math.sin(hc) + (M.z - (A.z + B.z) / 2) * -Math.cos(hc));
      if (bend !== 0) out.bend = bend;
    }
    if (st.half !== STREET_HALF) out.half = cm(st.half);
    if (st.kerb !== STREET_KERB) out.kerb = cm(st.kerb);
    if (!st.inCity) out.outside = true;
    if (st.oneway) out.oneway = true;
    if (st.ring) out.ring = true;
    const tags = (["elevated", "cable", "freeway"] as StreetTag[]).filter((t) => st.tags[t]);
    if (tags.length) out.tags = tags;
    return out;
  });
  const gates: (CityFileGate | null)[] = G.gates.map((g, i) => g ? { id: `g${i}`, street: g.street, out: g.out ? "b" : "a", dir: g.dir, x: cm(g.x), z: cm(g.z) } : null);
  const blocks: CityFileBlock[] = G.blocks.map((B) => {
    const p = insidePoint(B.poly, B.cx, B.cz), q: [number, number] = [cm(p[0]), cm(p[1])];
    const out: CityFileBlock = { at: inPoly(B.poly, q[0], q[1]) ? q : p, k: [B.kx, B.kz], district: plan.district(B.kx, B.kz) };
    if (B.inCity && !B.water) out.facility = facilityAt(plan, B.kx, B.kz);
    if (B.water) out.water = true;
    if (B.park) out.park = true;
    if (!B.inCity) out.outside = true;
    return out;
  });
  // (Its sea as the outline holds it; its freeway's gate slot, whether the truck comes in on it and
  // by which exit, and its curve through an organic town, to the millimetre.)
  const cut = plan.outlineCut, fw = plan.freeway, c = plan.fwCurve, r3 = (v: number) => Math.round(v * 1000) / 1000;
  const freeway: CityFileFreeway | undefined = fw ? { gate: { ix: fw.ix, iz: fw.iz, dir: fw.dir }, merge: plan.freewayMerge,
    ...(plan.interchange ? { exit: plan.interchange.kind } : {}),
    ...(c ? { curve: { ...c, pts: c.pts.map(([x, z]) => [r3(x), r3(z)] as [number, number]), cum: c.cum.map(r3), len: r3(c.len), ex: r3(c.ex), ez: r3(c.ez), dx: r3(c.dx), dz: r3(c.dz) } } : {}) } : undefined;
  return { format: 1, id, name, style: plan.style.id, key: plan.seed, layout: plan.layout,
    outline: { scale: cut.scale, ...(cut.seaOff ? { seaOff: true as const } : {}) }, sea: O.data, ...(freeway ? { freeway } : {}), nodes, streets, gates, blocks };
}

// What is wrong with a city, for normal play: an empty list when nothing is. Its streets must let
// the truck and traffic get from every node to every other, and every site's kerb must be one the
// truck can drive along.
export function cityProblems(plan: CityPlan): string[] {
  const G = plan.graph, out: string[] = [];
  const fwd = G.nodes.map(() => [] as number[]), back = G.nodes.map(() => [] as number[]);
  const drive = (a: number, b: number) => { fwd[a].push(b); back[b].push(a); };
  const used = new Set<number>();
  for (const st of G.streets) {
    if (!st.inCity && st.gate < 0) continue;
    used.add(st.n0); used.add(st.n1);
    drive(st.n0, st.n1);
    if (!st.oneway) drive(st.n1, st.n0);
  }
  const reach = (adj: number[][], from: number) => {
    const seen = new Set([from]), todo = [from];
    while (todo.length) for (const n of adj[todo.pop()!]) if (!seen.has(n)) { seen.add(n); todo.push(n); }
    return seen;
  };
  const entry = G.gates[0];
  if (!entry) return ["no way in"];
  const there = reach(fwd, entry.node), back0 = reach(back, entry.node);
  const stuck = [...used].filter((n) => !there.has(n) || !back0.has(n));
  if (stuck.length) out.push(`${stuck.length} nodes not reachable both ways from the way in (first at ${G.nodes[stuck[0]].x.toFixed(0)}, ${G.nodes[stuck[0]].z.toFixed(0)})`);
  G.gates.forEach((g, i) => { if (g && (!there.has(g.node) || !back0.has(g.node))) out.push(`gate ${i} cut off`); });
  for (const B of G.blocks) {
    if (!B.inCity || B.water) continue;
    const L = siteLayout(plan, B.kx, B.kz);
    if (L.kind === "kerb" || L.kind === "interchange") continue;
    const f = plan.face(B.kx, B.kz, L.side);
    if (f < 0 || !G.drivable(f)) out.push(`block ${B.kx},${B.kz}: its ${L.kind}'s kerb cannot be driven along`);
  }
  return out;
}

// Counts that tell a drafted city's character, for choosing among drafts.
export function cityTraits(plan: CityPlan) {
  const G = plan.graph;
  let docks = 0, lots = 0;
  for (const B of G.blocks) {
    if (!B.inCity || B.water) continue;
    const k = siteLayout(plan, B.kx, B.kz).kind;
    if (k === "dock") docks++;
    else if (k === "lot") lots++;
  }
  return { layout: plan.layout, freeway: !!plan.freeway, merge: plan.freewayMerge, river: plan.hasRiver, sea: plan.outline.sea !== null,
    oneWays: G.streets.some((st) => st.oneway && !st.ring), rounds: G.streets.some((st) => st.ring), docks, lots, blocks: G.blocks.length };
}

// A city's file name and constant: <style>-city-<slug> and CITY_<STYLE>_<SLUG>.
export const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const constOf = (style: StyleId, name: string) => `CITY_${style.toUpperCase()}_${slugOf(name).toUpperCase().replace(/-/g, "_")}`;
