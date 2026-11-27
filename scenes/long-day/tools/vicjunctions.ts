// Decides how a Victorian catalogue city's junctions are controlled and writes it into its city
// file. A town of about 1870 had a semaphore signal at one or two junctions at most, a constable on
// point duty at its busy ones, and nothing at the rest, so of the junctions the file has signalled:
// 1. a few of the most central downtown crossings keep their semaphore columns (their `poles`);
// 2. the busy ones become a constable's (still signalled, their poles dropped: signals.ts
//    buildSignals draws a Victorian signal with no poles as a constable in the junction's middle);
// 3. the rest become all-way stops (`control: "stop"`), which the Victorian city draws nothing for.
// Every all-way stop's sign posts (`stops`) are dropped too. A junction is busy when it is at a
// gate, when a corner of it is downtown, or when it is a crossroads on a street that runs out of
// town by a gate (known by its name, which it keeps along its whole line) with shops or downtown on
// two corners or more. The rule reads only the junction's arms, its corners' districts and the
// streets' names, none of which this changes, so running it again changes nothing.
// Run tools/clearstops.ts (and with --doors) and then tools/tractorturns.ts afterwards: the poles
// and posts it takes away stood on the pavements.
// Args: a city's id, or --list (every Victorian catalogue city's id, one a line).
import { CityPlan } from "../src/city.ts";
import { STYLES } from "../src/styles.ts";
import { CATALOGUE } from "../src/world.ts";
import type { CNode } from "../src/citygraph.ts";
import { slugOf } from "./cityfiles.ts";

const vjProc = (globalThis as any).process, vjFs = vjProc.getBuiltinModule("node:fs");
const vjArg: string = vjProc.argv[2] ?? "";
// How many semaphores a city keeps, and the least distance (m) between two of them.
const SEMAPHORES = 4, SEMAPHORE_GAP = 150;
if (vjArg === "--list") { for (const F of CATALOGUE) if (F.style === "victorian") console.log(F.id); }
else {
  const F = CATALOGUE.find((c) => c.id === vjArg && c.style === "victorian");
  if (!F) { console.error(`usage: vicjunctions <Victorian city id> | --list (no Victorian city ${vjArg})`); vjProc.exit(2); }
  const plan = new CityPlan(F!.key, STYLES[F!.style]), G = plan.graph;
  const gateNodes = new Set(G.gates.flatMap((g) => (g ? [g.node] : [])));
  const gateNames = new Set(G.gates.flatMap((g) => (g ? [G.streets[g.street].name] : [])));
  // (A junction's corner blocks: the block on the same side of each arm, so each corner once.)
  const corners = (N: CNode) => N.arms.map((a) => G.faceBlock[a.street * 2 + a.end]).filter((b) => b >= 0).map((b) => G.blocks[b]);
  const districts = (N: CNode) => corners(N).map((B) => plan.district(B.kx, B.kz));
  const busy = (N: CNode) => {
    const ds = districts(N), shops = ds.filter((d) => d === "commercial" || d === "downtown").length;
    const main = N.arms.filter((a) => gateNames.has(G.streets[a.street].name)).length >= 2;
    return gateNodes.has(N.id) || ds.includes("downtown") || (N.arms.length === 4 && main && shops >= 2);
  };
  // The semaphores: crossroads with downtown on all four corners, the most central first (by their
  // corners' downtownHeight), each SEMAPHORE_GAP from those already chosen.
  const centrality = (N: CNode) => corners(N).reduce((s, B) => s + plan.downtownHeight(B.kx, B.kz), 0);
  const semaphores: CNode[] = [];
  for (const N of G.nodes.filter((N) => N.control === "signal" && N.arms.length === 4 && districts(N).every((d) => d === "downtown")).sort((a, b) => centrality(b) - centrality(a) || a.id - b.id))
    if (semaphores.length < SEMAPHORES && semaphores.every((S) => Math.hypot(S.x - N.x, S.z - N.z) >= SEMAPHORE_GAP)) semaphores.push(N);
  const kind = new Map<number, "semaphore" | "constable" | "stop">();
  for (const N of G.nodes) if (N.control === "signal") kind.set(N.id, semaphores.includes(N) ? "semaphore" : busy(N) ? "constable" : "stop");
  // Into the file: each node's line, its poles, stops and control rewritten.
  const file = `scenes/long-day/src/city-${F!.style}/${slugOf(F!.name)}/${slugOf(F!.name)}.ts`;
  const lines: string[] = vjFs.readFileSync(file, "utf8").split("\n");
  let inNodes = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("  nodes: [")) { inNodes = true; continue; }
    if (inNodes && lines[i].startsWith("  ],")) break;
    const m = inNodes ? /^ {4}\{ id: (\d+), (.*) \},$/.exec(lines[i]) : null;
    if (!m) continue;
    const k = kind.get(Number(m[1]));
    let rest = m[2].replace(/, stops: \[\[.*?\]\]/, "");
    if (k === "constable" || k === "stop") rest = rest.replace(/, poles: \[\[.*?\]\]/, "");
    if (k === "stop") rest = rest.replace(/^(.*?k: \[[^\]]*\])/, '$1, control: "stop"');
    lines[i] = `    { id: ${m[1]}, ${rest} },`;
  }
  vjFs.writeFileSync(file, lines.join("\n"));
  const count = (k: string) => [...kind.values()].filter((v) => v === k).length;
  console.log(`${F!.id}: ${count("semaphore")} semaphores (nodes ${semaphores.map((N) => N.id).join(", ")}), ${count("constable")} constables, ${count("stop")} signals made all-way stops`);
}
