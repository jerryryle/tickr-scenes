// Test: what is built ahead a piece at a time is the same as built at once: a city's street graph
// (CityPlan.prepare, as the journey has the next city's built), in a good many pieces, and the road
// out of town (Journey.exitRoadAhead); and a seek past a road out half built doesn't draw it.
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
  // The road out, built ahead a piece at a time over the steps after the way out is planned
  // (Journey.exitRoadAhead), is the same road as one built at once; and a seek into the next city
  // while it is half built doesn't hand it on as the road just driven (previousExit).
  const roadSig = (r: any) => JSON.stringify([r.SB, r.length, r.gateS, r.pieces, r.stops, r.duration, Array.from(r.S), Array.from(r.V), r.geo.map.id, r.dir, r.meetings, r.trainT]);
  let roads = 0, seeks = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const j: any = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
    j.keyframing = true;
    let seen = "", sought = false;
    while (j.st.city < 2) {
      j.step();
      const st = j.st;
      if (!st.exit || st.departAt >= 0) continue;
      const key = `${st.city}/${st.exit.gate}/${st.exit.dEst}`;
      if (key !== seen) {
        seen = key; roads++;
        const A = j.makeExitRoad(st.city, st.exit.gate, st.exit.dEst, st.truck, true), B = j.makeExitRoad(st.city, st.exit.gate, st.exit.dEst, st.truck);
        let n = 0; while (!A.prepare(1)) n++;
        if (n < 4) errs.push(`seed ${seed} city ${st.city}: the road out in only ${n} pieces`);
        if (roadSig(A) !== roadSig(B)) errs.push(`seed ${seed} city ${st.city}: the road out built ahead differs`);
      }
      // (A step after the way out is planned: a road out from its map takes a few steps' pieces.)
      if (!sought && st.city === 0 && st.step === (st.exitStep ?? -9) + 1 && !j.exitCache.road.built) {
        sought = true; seeks++;
        const k: any = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
        k.keyframing = true;
        k.seekTo(st.simTime); k.seekTo(k.period + 30);
        const r = k.previousExit;
        if (r && !r.built) errs.push(`seed ${seed}: after a seek, previousExit is a road not yet built`);
      }
    }
  }
  console.log(`${roads} roads out built ahead; ${seeks} seeks past one half built`);
  if (!seeks) errs.push("no seek past a road out half built was tried");
  times.sort((a, b) => a - b);
  const p99 = times[Math.floor(times.length * 0.99)];
  console.log(`${graphs} graphs, ${(pieces / graphs).toFixed(0)} pieces each on average; pieces p99 ${p99.toFixed(2)} ms, longest ${longest.toFixed(2)} ms`);
  // (The times are reported, not held to a bound: make check runs tests side by side, and wall time
  // on a loaded machine says little.)
  for (const e of errs) console.log("FAIL " + e);
  if (errs.length) (globalThis as any).process.exit(1);
  console.log("ok");
}
