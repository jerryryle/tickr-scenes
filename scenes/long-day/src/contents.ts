// A city's contents (docs/long-day-cities.md, "City contents"): everything that stands on its layout,
// each item a recipe the city file lists and the scene draws as listed. A recipe is its kind (`k`,
// which drawer draws it), its frame (`at`: the world x and z of its origin, and its heading), the
// fields its kind names, and a seed of its own (`s`) for the detail no field names.
//
// The builders in city.ts make recipes with `place`: drafting (CONTENTS.out set), each is
// recorded with what owns it (a block, a street, the countryside ring) and drawn; in a city whose
// file lists its contents, the builders are not run, and each listed recipe is drawn by the same
// drawer (drawRecipe).
import { mulberry32 } from "./rng.ts";
import type { Batch, Frame2 } from "./geom.ts";
import { frameApply, PLACED } from "./geom.ts";

export interface Recipe { k: string; at?: [number, number, number]; s?: number; [field: string]: unknown }
// A kind's drawer: its recipe's fields in the recipe's own frame, with its own random stream.
export type Drawer = (r: Recipe, g: Batch, s: Batch, rnd: () => number) => void;
export const DRAW: Record<string, Drawer> = {};

// The recorder (drafting): each recipe made, under what owns it ("b<block id>", "s<street id>",
// "o" for the countryside ring); and the tile being built, whose origin frames are drawn from.
export const CONTENTS = { out: null as Map<string, Recipe[]> | null, owner: "", ox: 0, oz: 0, tile: null as [number, number] | null };

const rcm = (v: number) => Math.round(v * 100) / 100;
// The frame being drawn in, as a world frame: its origin and heading.
function frameNow(): [number, number, number] {
  let x = 0, z = 0, rot = 0;
  for (let i = PLACED.frames.length - 1; i >= 0; i--) { [x, z] = frameApply(PLACED.frames[i], x, z); rot += PLACED.frames[i].rot; }
  return [rcm(CONTENTS.ox + x), rcm(CONTENTS.oz + z), Math.round(rot * 1e6) / 1e6];
}

// Make a recipe of kind `k` with `fields` in the frame being drawn in; record it when drafting;
// draw it. (`_rnd`, the builder's stream, is not drawn from: a recipe's own draws come from its seed.)
export function place(k: string, fields: Record<string, unknown>, g: Batch, s: Batch, _rnd: () => number): Recipe {
  // (A street's and the countryside's items name the tile that draws them: a street's part can draw
  // one just past its tile's edge.)
  // (Its frame left out when it is its tile's own, unturned.)
  const at = frameNow(), T = CONTENTS.tile, own = !!T && at[0] === CONTENTS.ox && at[1] === CONTENTS.oz && at[2] === 0;
  const r: Recipe = { k, ...(own ? {} : { at }), ...(T ? { t: T } : {}), ...fields };
  if (CONTENTS.out) { let a = CONTENTS.out.get(CONTENTS.owner); if (!a) CONTENTS.out.set(CONTENTS.owner, a = []); a.push(r); }
  drawHere(r, g, s);
  return r;
}
// A recipe drawn in the frame being drawn in (place: it was made there).
function drawHere(r: Recipe, g: Batch, s: Batch) {
  const d = DRAW[r.k];
  if (!d) throw new Error(`no drawer for a ${r.k}`);
  d(r, g, s, mulberry32(seedOf(r)));
}
// A recipe's seed: its own (`s`, set by hand to change its detail), or else a hash of what it is
// and where (so it needs no storing, and an edit to one recipe changes none of the others').
export function seedOf(r: Recipe): number {
  if (r.s !== undefined) return r.s;
  const t = JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));   // (in a fixed order: a file may list its fields in any)
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// A listed recipe, drawn in its own frame in the tile being built (tile-local: `inFrame` turns and
// moves what it draws into place).
export function drawRecipe(r: Recipe, g: Batch, s: Batch, inFrame: (f: Frame2, fn: () => void) => void) {
  const at = r.at ?? [CONTENTS.ox, CONTENTS.oz, 0];   // (none: its tile's frame)
  const f: Frame2 = { ox: at[0] - CONTENTS.ox, oz: at[1] - CONTENTS.oz, rot: at[2] };
  inFrame(f, () => drawHere(r, g, s));
}

// A recipe as a city file stores it: a row, [kind, frame or 0, tile or 0, then its kind's fields in
// FIELDS' order], a field it lacks null (and those it lacks at the end left off). As objects with
// their field names, every city's tens of thousands of recipes made the files twice the size and
// the type checker run out of memory.
export type RecipeRow = unknown[];
export const FIELDS: Record<string, string[]> = {
  tree: ["x", "z", "h", "r", "kind", "g", "y", "c", "pit"],
  lamp: ["x", "z", "hx", "hz"],
  pit: ["x", "z"],
  bunting: ["x", "z", "bx", "bz", "salt"],
  landTree: ["x", "z", "kind", "g"],
  rock: ["x", "z", "r"],
  ground: ["pts", "top", "c"],
  plaza: ["pts"],
  storyLot: ["side", "rect", "district", "hs"],
  lotBuilding: ["use", "side", "rect", "wall", "floors", "ground", "tile", "awning", "floorH"],
  garden: ["rect", "fence", "patio", "shed"],
  storyGarden: ["w", "d", "fountain"],
  carPark: ["w", "d", "cars"],
  planter: [],
  shed: ["wall", "x", "z"],
  containers: ["n", "rows", "stacks"],
  storyTower: ["r", "storeys"],
  close: ["x", "z", "lane", "verge"],
  closeHouse: ["wall", "floors"],
  paving: ["rect", "c"],
  cornerPlaza: ["rect"],
  podiumTower: ["rect", "wall", "pod", "ground", "podTile", "front", "sign", "inset", "floors", "towerWall", "tile", "crown"],
  antenna: ["x", "z", "y"],
  shop: ["rect", "floors", "wall", "side", "tile", "awning", "neon", "fireEscape"],
  parkingLot: ["rect", "cars"],
  court: ["rect", "wall", "floors", "side", "tile"],
  house: ["rect", "lot", "front", "wall", "floors", "bungalow", "gravel", "gable", "chimney"],
  pool: ["rect"],
  conifer: ["x", "z", "h", "c"],
  rowHouse: ["side", "a0", "a1", "n0", "wall", "floors", "tile", "gable", "alt"],
  stoops: ["side", "n0", "steps"],
  doorSpot: ["side", "a", "n"],
  warehouse: ["lot", "rect", "yardSide", "wall", "height", "trailers", "ghost", "special", "extra", "annex"],
  park: ["rect", "pond"],
  asphalt: [],
  garage: ["side", "open"],
  dock: ["L", "district", "hs"],
  rentalLot: ["L"],
  stand: ["L"],
  townSquare: ["rect"],
  bladeSigns: [],
  waterTower: ["x", "z"],
  billboard: ["r", "top", "side", "ad"],
};
export function rowOf(r: Recipe): RecipeRow {
  const F = FIELDS[r.k];
  if (!F) throw new Error(`no fields for a ${r.k}`);
  for (const k of Object.keys(r)) if (k !== "k" && k !== "at" && k !== "t" && k !== "s" && !F.includes(k)) throw new Error(`a ${r.k}'s ${k} is not among its fields`);
  const row: unknown[] = [r.k, r.at ?? 0, r.t ?? 0, ...F.map((f) => r[f] ?? null), ...(r.s !== undefined ? [{ s: r.s }] : [])];
  while (row.length > 3 && row[row.length - 1] === null) row.pop();
  return row;
}
export function recipeOf(row: RecipeRow): Recipe {
  const [k, at, t, ...v] = row, F = FIELDS[k as string], r: Recipe = { k: k as string };
  if (at) r.at = at as [number, number, number];
  if (t) r.t = t;
  F.forEach((f, i) => { if (v[i] !== null && v[i] !== undefined) r[f] = v[i]; });
  const last = v[F.length] as { s?: number } | undefined;
  if (last?.s !== undefined) r.s = last.s;
  return r;
}
