// Node: kerb door positions for seeds 1-3, every block, at the start of three journey periods.
import { readConfig } from "../src/env.ts";
import { kerbDoors } from "../src/city.ts";
import { Journey } from "../src/journey.ts";

{
  const out: string[] = [];
  const t0 = (globalThis as any).performance.now();
  for (const seed of [1, 2, 3]) {
    const cfg = readConfig({ seed } as SceneEnv);
    const j = new Journey(cfg, 0);
    for (let N = 0; N < 3; N++) {
      j.seekTo(N * j.period + 1);
      const plan = j.plan;
      for (let bz = -8; bz <= 7; bz++) for (let bx = -8; bx <= 7; bx++) out.push(`${seed}/${N}/${bx},${bz} ${JSON.stringify(kerbDoors(plan, bx, bz))}`);
    }
  }
  console.log(out.join("\n"));
  console.error(`ms ${((globalThis as any).performance.now() - t0).toFixed(0)}`);
}
