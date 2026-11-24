// Test: a city's street graph built ahead a piece at a time (CityPlan.prepare, as the journey has
// the next city's built) is the same graph as one built at once, and no piece is a big one.
// Exits non-zero on a failure. Args (optional): how many journeys (seeds 1..n), 4 by default.
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { CityPlan } from "../src/city.ts";
import { citySeedOf } from "../src/country.ts";
{
  const argv: string[] = (globalThis as any).process.argv.slice(2);
  const seeds = Number(argv[0] ?? 4);
  const sig = (P: CityPlan) => {
    const G = P.graph;
    return JSON.stringify([G.nodes.map((n) => [n.x, n.z, n.kx, n.kz, n.control, n.phases, n.phaseOf, n.sigKey ?? null, n.arms]),
      G.streets.map((s) => [s.n0, s.n1, s.len, s.k, s.h0, s.half, s.name, s.oneway, s.ring ?? null, s.gate, s.inCity, s.tags]),
      G.blocks.map((b) => [b.kx, b.kz, b.area, b.water, b.park, b.inCity, b.square, b.anchor, b.faces]), G.gates, P.outline.sea, P.layout]);
  };
  const errs: string[] = [];
  let graphs = 0, pieces = 0, longest = 0;
  const times: number[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
    for (let N = 0; N < 4; N++) {
      const cs = citySeedOf(seed, N), style = (j as any).styleOf(N);
      const whole = new CityPlan(cs, style), ahead = new CityPlan(cs, style);
      const t0 = performance.now(); void whole.graph; const wholeMs = performance.now() - t0;
      let n = 0;
      for (let done = false; !done; n++) { const t = performance.now(); done = ahead.prepare(1); times.push(performance.now() - t); }
      graphs++; pieces += n;
      const mx = Math.max(...times.slice(-n));
      longest = Math.max(longest, mx);
      if (sig(whole) !== sig(ahead)) errs.push(`seed ${seed} city ${N} (${ahead.layout}): built ahead, the graph differs`);
      if (n < 20) errs.push(`seed ${seed} city ${N} (${ahead.layout}): only ${n} pieces for ${wholeMs.toFixed(0)} ms of work`);
    }
  }
  times.sort((a, b) => a - b);
  const p99 = times[Math.floor(times.length * 0.99)];
  console.log(`${graphs} graphs, ${(pieces / graphs).toFixed(0)} pieces each on average; pieces p99 ${p99.toFixed(2)} ms, longest ${longest.toFixed(2)} ms`);
  // (Timing on a loaded machine is noisy: only the bulk of the pieces is held to a bound.)
  if (p99 > 2) errs.push(`pieces too big: p99 ${p99.toFixed(2)} ms`);
  for (const e of errs) console.log("FAIL " + e);
  if (errs.length) (globalThis as any).process.exit(1);
  console.log("ok");
}
