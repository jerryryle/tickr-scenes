// This file draws the Victorian city's street pieces (styles.ts, `victorian`): its gas lamps, and
// (signals.ts, decor.ts) its signal posts, stop posts and street furniture.
// The file imports only geometry, so city.ts and the others can import it at load.
import { Batch } from "../geom.ts";
import { VIC } from "./victorian-buildings-town.ts";

// vicLamp draws a gas lamp at the back of the kerb (px, pz), its lantern towards the road (hx, hz)
// (where another city's streetlight has its head), on ground y0, and gives where its light is.
export function vicLamp(s: Batch, px: number, pz: number, _hx: number, _hz: number, y0: number): [number, number, number] {
  s.cyl(px, y0 + 1.8, pz, 0.08, 3.6, VIC.black, 6);
  s.aux.set(0, 0, -2); s.box(px, y0 + 3.85, pz, 0.36, 0.5, 0.36, VIC.lamp); s.aux.set(0, 0, -1);
  return [px, y0 + 3.85, pz];
}
