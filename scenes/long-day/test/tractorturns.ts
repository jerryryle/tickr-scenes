// Test: a tractor-trailer never drives its trailer across a corner (citygraph.ts noTractor,
// tools/tractorsweep.ts). Three parts.
//  1. Each city named (by default one of each style, the grid's and an organic town's among them)
//     lists the moves the sweep bans, no more and no fewer: a hand edit that moved a pole, a piece
//     of furniture or a junction since tools/tractorturns.ts wrote them shows here.
//  2. In every catalogue city, the tractor can drive in by any gate to every street it is left
//     (citygraph.ts tractorReach) and out by any gate from each.
//  3. A tractor driven through two towns (Midtown, a grid; Millbrook, an organic town) never takes a
//     banned move, and its body (its trailer at its own angle) never comes to a signal pole or a
//     stop sign's post. The 13 m trailer it had went through the corner's pole on nearly every right
//     turn, 10 times in Midtown's first 15 minutes. Midtown now bans no move, so its run checks the
//     shorter trailer, and Millbrook's checks the bans. test/signalposts.ts drives no tractor.
// Args (optional): city ids, for part 1.
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT } from "../src/journey.ts";
import { CityPlan } from "../src/city.ts";
import { STYLES } from "../src/styles.ts";
import { CATALOGUE } from "../src/world.ts";
import { parseVisitSpec } from "../src/visits.ts";
import { signalPoles, stopSignPosts, STOP_PLATE } from "../src/signals.ts";
import { SPECS, TRAILER, truckExtents } from "../src/truck.ts";
import { tractorBans } from "../tools/tractorsweep.ts";
{
  const proc = (globalThis as any).process, argv: string[] = proc.argv.slice(2), errs: string[] = [];
  const named = argv.length ? argv : ["metro-midtown", "coastal-golden-hollow", "desert-dry-gulch", "brick-millbrook", "mainstreet-cedar-junction", "port-rainier-bay", "storybook-wumbleton"];
  // 1. The file's bans are the sweep's.
  for (const id of named) {
    const F = CATALOGUE.find((c) => c.id === id);
    if (!F) { errs.push(`no city ${id}`); continue; }
    const plan = new CityPlan(F.key, STYLES[F.style]), G = plan.graph, swept = tractorBans(plan);
    const missing = [...swept].filter((k) => !G.noTractor.has(k)), extra = [...G.noTractor].filter((k) => !swept.has(k));
    const name = (k: number) => { const d = Math.floor(k / 65536), e = k % 65536; return `node ${G.dedgeTo(d)}, street ${d >> 1} to ${e >> 1}`; };
    if (missing.length) errs.push(`${id}: ${missing.length} moves the sweep bans are not in its file (${missing.slice(0, 3).map(name).join("; ")}): make tractorturns ARGS=${id}`);
    if (extra.length) errs.push(`${id}: ${extra.length} moves its file bans are clear now (${extra.slice(0, 3).map(name).join("; ")}): make tractorturns ARGS=${id}`);
    console.log(`tractorturns: ${id}: ${swept.size} moves banned, ${missing.length + extra.length} out of step with its file`);
  }
  // 2. In by any gate, a tractor reaches all it is left; and it leaves by any gate from there.
  for (const F of CATALOGUE) {
    const G = new CityPlan(F.key, STYLES[F.style]).graph, reach = G.tractorReach();
    const ok = (d: number) => { const st = G.streets[d >> 1]; return (st.inCity || st.gate >= 0) && !(st.oneway && (d & 1)); };
    G.gates.forEach((g, i) => {
      if (!g) return;
      if (!reach.has(g.street * 2 + (g.out ^ 1))) errs.push(`${F.id}: a tractor can't leave by gate ${i}`);
      // (A gate no vehicle can drive in by is one tractorReach skips too.)
      if (!ok(g.street * 2 + g.out)) return;
      const seen = new Set([g.street * 2 + g.out]), todo = [...seen];
      while (todo.length) { const d = todo.pop()!; for (const m of G.movesFrom(d)) if (ok(m.to) && G.tractorMove(d, m.to) && !seen.has(m.to)) { seen.add(m.to); todo.push(m.to); } }
      const short = [...reach].filter((d) => G.streets[d >> 1].inCity && !seen.has(d)).length;
      if (short) errs.push(`${F.id}: in by gate ${i}, a tractor can't reach ${short} of the ${reach.size} ways along a street it is left`);
    });
  }
  // 3. Driven.
  for (const spec of ["city=metro-midtown,truck=tractor", "city=brick-millbrook,truck=tractor"]) {
    const j = new Journey(readConfig({ seed: 1 } as SceneEnv), 0, "autumn", { 0: parseVisitSpec(spec) });
    let G: CityPlan["graph"] | null = null, posts: { x: number; z: number; r: number; what: string }[] = [], steps = 0, nearest = Infinity, route: unknown = null;
    for (let i = 0; i < 12 * 60 / SIM_DT; i++) {
      j.step();
      if (j.st.mode !== "drive" || !j.path || j.st.truck !== "tractor") continue;
      if (j.plan.graph !== G) {
        G = j.plan.graph; posts = [];
        for (const n of G.nodes) {
          if (n.control === "signal") for (const p of signalPoles(G, n)) posts.push({ x: p.px, z: p.pz, r: 0.16, what: "a signal pole" });
          if (n.control === "stop") for (const [x, z] of stopSignPosts(G, n).values()) posts.push({ x, z, r: STOP_PLATE, what: "a stop sign" });
        }
      }
      if (j.st.route !== route) {
        route = j.st.route;
        for (const nd of j.path.nodes) if (!G.tractorMove(nd.from, nd.to)) errs.push(`${spec}: t${j.st.simTime.toFixed(0)} its route takes a banned move at node ${nd.node}`);
      }
      steps++;
      const E = truckExtents("tractor"), h = j.pose.h, fx = Math.cos(h), fz = -Math.sin(h), fw = SPECS.tractor.fifthWheel!;
      const th = h + j.hitchYaw, tx = Math.cos(th), tz = -Math.sin(th), kx = j.pose.x + fx * fw, kz = j.pose.z + fz * fw, c = (TRAILER.front + TRAILER.rear) / 2;
      const boxes = [[j.pose.x + fx * (E.front + fw) / 2, j.pose.z + fz * (E.front + fw) / 2, fx, fz, (E.front - fw) / 2 + 0.5, 1.25], [kx + tx * c, kz + tz * c, tx, tz, (TRAILER.front - TRAILER.rear) / 2, TRAILER.hw]];
      for (const p of posts) {
        if (Math.abs(p.x - j.pose.x) > 25 || Math.abs(p.z - j.pose.z) > 25) continue;
        for (const [cx, cz, ax, az, L, W] of boxes) {
          const u = (p.x - cx) * ax + (p.z - cz) * az, v = (p.x - cx) * az - (p.z - cz) * ax;
          const d = Math.hypot(Math.max(0, Math.abs(u) - L), Math.max(0, Math.abs(v) - W)) - p.r;
          nearest = Math.min(nearest, d);
          if (d <= 0 && errs.length < 40) errs.push(`${spec}: t${j.st.simTime.toFixed(1)} the tractor drove through ${p.what} at (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`);
        }
      }
    }
    console.log(`tractorturns: ${spec}: ${steps} tractor steps driven, nearest a pole or post came ${nearest.toFixed(2)} m`);
    if (!steps) errs.push(`${spec}: no tractor drove`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
  console.log("tractorturns ok");
}
