// Test: on the road between cities, the truck makes each stop where it was planned, at a level
// crossing stopped while the train passes. The drive out takes as long as its road needs, its
// stops included (country.ts fitDuration), the next city waiting for it: seed 500's road out of
// city 2 was laid 592 m too long for its 222 s, and the truck was eased on through the crossing,
// 450 m past it, as the train went by.
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
{
  const proc = (globalThis as any).process, errs: string[] = [];
  for (const [seed, city] of [[500, 2]]) {
    const period = new Journey(readConfig({ seed } as any), 0, "autumn").period;
    const j = new Journey(readConfig({ seed } as any), city * period, "autumn") as any;
    let pm = j.st.mode, seen = false;
    while (j.st.simTime < (city + 1) * period && !seen) {
      j.step();
      if (j.st.mode === "country" && pm !== "country") {
        seen = true;
        const r = j.country, rail = r.stops.find((x: any) => x.kind === "rail");
        // (Each stop made where it was planned: the truck there when it arrives and all the while.)
        for (const x of r.stops) for (let t = x.arrive; t <= x.arrive + x.dwell; t += 1) {
          const d = r.sAt(t) - x.s;
          if (Math.abs(d) > 1) { errs.push(`seed ${seed} city ${city}: ${d.toFixed(0)} m off its ${x.kind} stop ${(t - x.arrive).toFixed(0)} s into it`); break; }
        }
        console.log(`roadstops: seed ${seed} city ${city}, stops ${r.stops.map((x: any) => x.kind).join(", ")}, train ${rail ? "at " + r.trainT.toFixed(0) + " s" : "none"}`);
      }
      pm = j.st.mode;
    }
    if (!seen) errs.push(`seed ${seed} city ${city}: never left for the country`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
