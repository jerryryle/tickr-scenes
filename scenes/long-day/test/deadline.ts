// Test: a city running late never puts the truck on the road with a jump. A city's time is a
// guideline (journey.ts): late, the truck finishes what it is doing and drives out, and the next
// city waits for it. Seed 1457485684's city 9 (unloading kegs as the old fixed slot ran out) and
// seed 3's city 3 (a final pickup that ran long, 16 blocks out with 66 s left) were put on the road
// at a gate, 588 m and 400 m in one step; seed 500's city 11 jumped 3 m across, up into a garage
// out of the inner lane (route.ts). Replays such cities from their start through the hand-over to
// the next; fails on a forced leave, or the truck moving further in one step than it can.
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
{
  const proc = (globalThis as any).process, errs: string[] = [];
  for (const [seed, city] of [[1457485684, 9], [3, 3], [500, 11]]) {
    const period = new Journey(readConfig({ seed } as any), 0, "autumn").period;
    const j = new Journey(readConfig({ seed } as any), city * period, "autumn");
    let forced = 0, px = j.pose.x, pz = j.pose.z, pm = j.st.mode, pt = j.st.truck;
    j.onEvent = (l) => { if (/forced onto the road/.test(l)) forced++; };
    while (j.st.city === city && j.st.simTime < (city + 3) * period) {
      j.step();
      const d = Math.hypot(j.pose.x - px, j.pose.z - pz);
      // (Not into the next city's frame: the world is moved under the truck there, country -> inbound;
      // nor at a swap, the new truck's pose its own rear axle.)
      // (Further than its step along its way, by a margin: a lane change's shift sideways, rounding.)
      if (d > Math.abs(j.lastStep) * 1.5 + 0.5 && !(pm === "country" && j.st.mode === "inbound") && pt === j.st.truck && errs.length < 10) errs.push(`seed ${seed} city ${city}: the truck jumped ${d.toFixed(0)} m, ${pm} -> ${j.st.mode} (at ${(j.st.simTime - city * period).toFixed(1)} s)`);
      px = j.pose.x; pz = j.pose.z; pm = j.st.mode; pt = j.st.truck;
    }
    console.log(`deadline: seed ${seed} city ${city}, ${forced} forced onto the road`);
    if (forced) errs.push(`seed ${seed} city ${city}: forced onto the road ${forced} time(s)`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
