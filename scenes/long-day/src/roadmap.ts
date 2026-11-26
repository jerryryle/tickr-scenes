// A country road's map (docs/long-day-cities.md, "Road maps"): the road between two gates as one
// physical road, the same whichever way it is driven. Distances `s` run from the end of gate a's
// street (0) to the end of gate b's (`length`); offsets `n` are to the right looking from a to b.
// country.ts RoadGeo reads it; tools/draftroads.ts drafts it from today's rules.
import type { RoadPiece } from "./country.ts";
import type { WorldRoad } from "./world.ts";
import { PACKED_ROADS, ROAD_HEADS } from "./world-packed.ts";
import { unpackText } from "./pack.ts";

// What the scene reads of a road it is not driving (tools/pack.ts packs the rest): its length, and
// its heading at gate b (its map's last `heading`), which says which way it turns.
export interface RoadHead { length: number; end: number }
export function roadHead(r: WorldRoad): RoadHead {
  const H = ROAD_HEADS[r.map ?? r.id];
  if (!H) throw new Error(`road ${r.id}: no map in src/roads/`);
  return H;
}
// A road's map, unpacked from those the scene carries packed (docs/long-day-cities.md, "How the
// scene carries the cities"): for a drive along it, which holds it as long as it lives.
export function roadMapOf(r: WorldRoad): RoadMap {
  const p = PACKED_ROADS[r.map ?? r.id];
  if (!p) throw new Error(`road ${r.id}: no map in src/roads/`);
  return JSON.parse(unpackText(p)) as RoadMap;
}

// A set piece as country.ts has it, in the coordinates of the way it faces: `way` 1 for a driver
// from a to b, -1 for one from b to a (its s then runs from gate b, its n to that driver's right).
export type RoadMapPiece = RoadPiece & { way: 1 | -1 };

// The roadside items, each kind a flat list of numbers, a fixed count per item, in order of s.
// Distances and offsets are in decimetres. (What a kind's shape and colour details are, past
// these, hashes the item's place: country world.ts.)
export interface RoadItems {
  trees: number[];    // s, n, kind (TREE_KINDS), green (an index into its land's greens)
  rocks: number[];    // s, n
  ponds: number[];    // s, n
  turbines: number[]; // s, n
  pylons: number[];   // s (the line runs 60 m out on the left)
  farms: number[];    // s, n
  cows: number[];     // s, n
  poles: number[];    // s (the utility line runs 12.5 m out on the right; a wire joins two poles 50 m apart)
  fences: number[];   // s, side (-1 left, 1 right): each 6 m bay of post-and-rail fence 14.5 m out, from s
}

export interface RoadMap {
  id: string;
  key: number;        // what the land's surface hashes (its noise, its colour bands and fields)
  length: number;     // gate a's street end to gate b's (m)
  freeway?: true;     // gate b is a freeway city's way in: the road comes up beside the freeway
  // The centre line every 2 m from 40 m before gate a, to 40 m past gate b (past the freeway's
  // stretch into town, on a freeway way in): its heading (radians, gate a's way out at 0), its
  // height (cm) and how far the land beside it rises and falls (0..1).
  heading: number[]; height: number[]; hill: number[];
  // The land every 10 m from gate a: how much of it is b's (the rest a's), how much of the
  // storybook's look creeps in, and how much of it is coast, the sea on side `coastSide`.
  blend: number[]; story?: number[]; coast?: number[]; coastSide?: 1 | -1;
  biomes: [string, string];   // a's land and b's (country.ts BiomeId)
  pieces: RoadMapPiece[];
  items: RoadItems;
}
