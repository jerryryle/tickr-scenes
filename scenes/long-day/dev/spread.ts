// Node: per city, the truck's block extent and when it left. Args: seeds (e.g. 1,2,3)
import { readConfig } from "../src/env.ts";
import { BLOCK } from "../src/grid.ts";
import { Journey } from "../src/journey.ts";

{
  const argv: string[] = (globalThis as any).process.argv.slice(2);
  for (const seed of argv[0].split(",").map(Number)) {
    const cfg = readConfig({ seed } as any);
    const j = new Journey(cfg, 0);
    const n = Math.round(3 * j.period / 0.1);
    let city = -1, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, pm = "";
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      j.step();
      const st = j.st;
      if (st.city !== city) { if (city >= 0) out.push(`c${city} bx[${x0},${x1}] bz[${z0},${z1}]`); city = st.city; x0 = 1e9; x1 = -1e9; z0 = 1e9; z1 = -1e9; }
      if (st.mode !== "country") { const bx = Math.floor(j.pose.x / BLOCK), bz = Math.floor(j.pose.z / BLOCK); x0 = Math.min(x0, bx); x1 = Math.max(x1, bx); z0 = Math.min(z0, bz); z1 = Math.max(z1, bz); }
      if (st.mode === "country" && pm !== "country") out.push(`left ${(st.departAt / 60).toFixed(2)}min at b${Math.floor(j.pose.x / BLOCK)},${Math.floor(j.pose.z / BLOCK)}`);
      pm = st.mode;
    }
    console.log(`seed ${seed}: ${out.join(" | ")}`);
  }
}
