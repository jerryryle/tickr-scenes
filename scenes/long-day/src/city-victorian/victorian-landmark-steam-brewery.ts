// The Victorian city's steam brewery (facilities.ts steamBrewery; CityPlan.worksBlock): a shallow
// dock where the carriage backs in under a brewhouse tower, with its process laid out in the yard
// beside it. It imports only geometry and types, so city.ts can import it at load.
import { Batch } from "../geom.ts";
import { facadeBox } from "../facade.ts";
import { FACADE } from "../facadetiles.ts";
import type { DockLayout } from "../facilities.ts";
import { VIC } from "./victorian-buildings-town.ts";

// A frame to draw in (as the knitting works' WorksFrame): P maps (a, n) along the site's frontage
// and in from it to (x, z); al and in are the unit vectors along the frontage and in from it.
export interface BreweryFrame { P: (a: number, n: number) => [number, number]; al: [number, number]; inn: [number, number] }
export const BREWERY = { hallTop: 11 };

// buildBreweryStatic draws the brewery's still parts over and beside the dock (from its wall back
// to n = 39.5) in the block's grid frame (city.ts buildDockSite: P is frontPt on the site's side),
// and returns the dock building's top.
export function buildBreweryStatic(s: Batch, F: BreweryFrame, L: DockLayout): number {
  const c0 = F.P(L.a0, L.wall), c1 = F.P(L.a1, 39.5);
  const top = facadeBox(s, Math.min(c0[0], c1[0]), Math.min(c0[1], c1[1]), Math.max(c0[0], c1[0]), Math.max(c0[1], c1[1]), 0,
    [{ tile: FACADE.VICT_WAREHOUSE, floors: 1, floorH: 3.2 }, { tile: FACADE.VICT_MILL, floors: 2, floorH: (BREWERY.hallTop - 3.2) / 2 }], VIC.red);
  return top;
}
