// Node: one-off probe of cargo source and drop search for seed 1.
import { readConfig } from "../src/env.ts";
import { cargoSeason } from "../src/climate.ts";
import { insideCity } from "../src/city.ts";
import { CARGO, CARGO_BY_ID, pickCargo } from "../src/cargo.ts";
import { Journey } from "../src/journey.ts";

{
  const cfg = readConfig({ seed: 1 } as any);
  const j = new Journey(cfg, 0);
  j.seekTo(j.period + 215);
  const jj: any = j;
  const c = CARGO_BY_ID.get("boxes") ?? CARGO[0];
  console.log("cargo", c.id, c.from, c.to);
  const src = jj.findNear(c.from, 11, 6, 9, new Set(["11,6"]), 2);
  console.log("sources", src.length, src.slice(0, 3).map((s: any) => s.name + " " + s.bx + "," + s.bz));
  if (src.length) { const d = jj.findNear(c.to, src[0].bx, src[0].bz, 6, new Set(), 1); console.log("drops", d.length); }
  console.log("insideCity(11,6)", insideCity(11, 6), "pick", JSON.stringify(pickCargo(0.3, 0.5, cfg.humorFrequency, cargoSeason(j.climate))?.id));
}
