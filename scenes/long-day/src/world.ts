// The world (docs/long-day-cities.md): every catalogue city, and the country roads joining them
// (world-roads.ts). This list is the catalogue: a city is in it once its folder is in
// src/city-<style>/ and its id is listed here.
import type { CityHead } from "./cityfile.ts";
import { CITY_HEADS } from "./world-packed.ts";

// A country road (docs/long-day-cities.md, "The world graph"): it joins gate `a.gate` of city `a.city` to gate `b.gate`
// of `b.city`, each gate serving this road alone. Its map, src/roads/road-<id>.ts, is the road
// itself, its length among it (roadmap.ts roadHead, roadMapOf); how long the drive takes follows
// from the truck's speed and its stops on the way (country.ts). `key`: what the drafting tool's
// rules hashed. `oneway`: driven only from a to b (into a freeway city's way in, where the freeway
// runs out of town). `map`: the road whose map it drives, when not its own (a road made up under
// DEBUG_STYLE: visits.ts debugWay).
export interface WorldRoad { id: string; a: { city: string; gate: string }; b: { city: string; gate: string }; key: number; oneway?: true; map?: string }

// The catalogue in its fixed order, by id: the visit planner picks from it by position, so a
// city added goes at the end. Each is a city's head (cityfile.ts CityHead) as tools/pack.ts packs
// it, its layout and contents left packed until the city is planned.
export const CATALOGUE: CityHead[] = [
  "coastal-bayview",
  "coastal-fogcrest",
  "coastal-golden-hollow",
  "coastal-seacliff",
  "coastal-twin-peaks-bay",
  "metro-empire-point",
  "metro-grand-central",
  "metro-metropolis-heights",
  "metro-midtown",
  "metro-new-harbor-city",
  "desert-dry-gulch",
  "desert-palm-vista",
  "desert-red-rock",
  "desert-saguaro-springs",
  "desert-sun-mesa",
  "brick-brickport",
  "brick-foundry-falls",
  "brick-ironworks",
  "brick-millbrook",
  "brick-steelton",
  "mainstreet-cedar-junction",
  "mainstreet-elm-grove",
  "mainstreet-maple-falls",
  "mainstreet-pleasantville",
  "mainstreet-willow-creek",
  "port-ferryport",
  "port-gray-haven",
  "port-north-harbor",
  "port-puget-point",
  "port-rainier-bay",
  "storybook-fizzlebury",
  "storybook-higgle-on-the-wobble",
  "storybook-snickerwick",
  "storybook-tumbledown-tuft",
  "storybook-wumbleton",
].map((id) => {
  const F = CITY_HEADS[id];
  if (!F) throw new Error(`world.ts: no city ${id} in src/city-*/`);
  return F;
});
