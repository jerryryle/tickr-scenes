// Works out a catalogue city's moves a tractor-trailer never takes (tools/tractorsweep.ts) and
// writes them into its city file, each node's as its `noTractor` list (cityfile.ts), in place of
// any it had. It changes nothing else in the file. It reports what the bans leave the tractor: the
// streets it can no longer drive (reached in by every gate and left by one: citygraph.ts
// tractorReach, which the journey plans a tractor's jobs from) and the stops it can no longer reach. Run it again after a hand edit that moves a junction, a pole or the furniture.
// Args: a city's id, or --list (every catalogue city's id, one a line).
import { CityPlan } from "../src/city.ts";
import { STYLES } from "../src/styles.ts";
import { CATALOGUE } from "../src/world.ts";
import { siteLayout } from "../src/facilities.ts";
import { slugOf } from "./cityfiles.ts";
import { tractorClashes } from "./tractorsweep.ts";

const ttProc = (globalThis as any).process, ttFs = ttProc.getBuiltinModule("node:fs");
const ttArg: string = ttProc.argv[2] ?? "";
if (ttArg === "--list") for (const F of CATALOGUE) console.log(F.id);
else {
  const F = CATALOGUE.find((c) => c.id === ttArg);
  if (!F) { console.error(`usage: tractorturns <city id> | --list (no city ${ttArg})`); ttProc.exit(2); }
  const t0 = Date.now(), plan = new CityPlan(F!.key, STYLES[F!.style]), G = plan.graph;
  const byNode = new Map<number, [number, number][]>(), tally: Record<string, number> = { R: 0, L: 0, S: 0 };
  G.noTractor.clear();
  for (const c of tractorClashes(plan)) {
    const n = G.dedgeTo(c.din), bans = byNode.get(n) ?? byNode.set(n, []).get(n)!;
    G.noTractor.add(c.din * 65536 + c.dout);
    bans.push([c.din >> 1, c.dout >> 1]);
    tally[G.movesFrom(c.din).find((m) => m.to === c.dout)!.move]++;
  }
  for (const bans of byNode.values()) bans.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  // Into the file: each node's line, its list replaced or added at its end.
  const file = `scenes/long-day/src/city-${F!.style}/${slugOf(F!.name)}/${slugOf(F!.name)}.ts`;
  const lines: string[] = ttFs.readFileSync(file, "utf8").split("\n");
  let inNodes = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("  nodes: [")) { inNodes = true; continue; }
    if (inNodes && lines[i].startsWith("  ],")) break;
    const m = inNodes ? /^ {4}\{ id: (\d+), (.*) \},$/.exec(lines[i]) : null;
    if (!m) continue;
    const rest = m[2].replace(/, noTractor: \[.*\]$/, ""), bans = byNode.get(Number(m[1]));
    lines[i] = `    { id: ${m[1]}, ${rest}${bans ? `, noTractor: ${JSON.stringify(bans).replace(/,/g, ", ")}` : ""} },`;
  }
  ttFs.writeFileSync(file, lines.join("\n"));
  // What the tractor is left: what the journey plans its jobs from (citygraph.ts tractorReach).
  const ok = (d: number) => { const st = G.streets[d >> 1]; return (st.inCity || st.gate >= 0) && !(st.oneway && (d & 1)); };
  const reach = G.tractorReach(), can = (d: number) => reach.has(d);
  let streets = 0, lost = 0, stops = 0, stopsLost = 0;
  for (let d = 0; d < G.streets.length * 2; d++) if (ok(d) && G.streets[d >> 1].inCity) { streets++; if (!can(d)) lost++; }
  for (const B of G.blocks) {
    if (!B.inCity || B.water) continue;
    const L = siteLayout(plan, B.kx, B.kz);
    const faces = L.kind === "kerb" ? B.faces.filter((f) => G.hasFrontage(f) && G.drivable(f)) : [plan.face(B.kx, B.kz, L.side)].filter((f) => f >= 0);
    if (!faces.length) continue;
    stops++;
    if (!faces.some(can)) stopsLost++;
  }
  const gatesLost = G.gates.filter((g) => g && !reach.has(g.street * 2 + (g.out ^ 1))).length;
  console.log(`${F!.id}: banned ${tally.R} rights, ${tally.L} lefts, ${tally.S} straight on; cut off ${lost} of ${streets} ways along a street, ${stopsLost} of ${stops} stops, ${gatesLost} gates (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
