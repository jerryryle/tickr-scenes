// City style profiles (concept doc, "City style profiles"): each city takes one, so consecutive
// cities feel like different places rather than reskins. A profile sets palettes, trees, how big
// downtown is and how tall it grows, the district mix, which facade tiles and residential forms
// it favours, how dense its signage is, a few signature features, and the skyline backdrop.
import { hash2, mulberry32 } from "./rng.ts";
import { DEBUG_STYLE } from "./debug.ts";
import { cityByKey } from "./visits.ts";
import { STYLE_COASTAL } from "./city-coastal/coastal-style.ts";
import { STYLE_METRO } from "./city-metro/metro-style.ts";
import { STYLE_DESERT } from "./city-desert/desert-style.ts";
import { STYLE_BRICK } from "./city-brick/brick-style.ts";
import { STYLE_MAINSTREET } from "./city-mainstreet/mainstreet-style.ts";
import { STYLE_PORT } from "./city-port/port-style.ts";
import { STYLE_STORYBOOK } from "./city-storybook/storybook-style.ts";

export type StyleId = "coastal" | "metro" | "desert" | "brick" | "mainstreet" | "port" | "storybook";
export type TreeKind = "broad" | "palm" | "conifer" | "tuft" | "pancake" | "droop" | "spiral";
type BackdropKind = "bridge" | "skyline" | "mesas" | "stacks" | "farmhills" | "evergreens" | "storyhills";

export interface CityStyle {
  id: StyleId;
  names: string[];                    // city names for signs and the tablet
  walls: Record<"downtown" | "commercial" | "residential" | "industrial", number[]>;
  roofs: number[]; gables: number[]; awnings: number[];
  trees: { kinds: TreeKind[]; greens: number[] };
  grass: number; pavers: number;
  core: number;                       // downtown radius in blocks (default 2.4)
  towerScale: number;                 // downtown height multiplier
  maxShopFloors: number;              // commercial buildings top out here
  industrial: number;                 // noise threshold for industrial (default 0.36)
  towerTiles: number[]; upperTiles: number[];
  houses: "detached" | "row" | "bungalow";
  neon: number;                       // chance a shop gets a neon sign
  billboards: number;                 // chance a block gets a billboard
  ghostSigns: number;                 // chance a blank side wall gets a painted ghost sign
  waterTanks: number;                 // chance of a rooftop water tank on a flat roof
  fireEscapes: boolean;
  backdrop: BackdropKind; backdropColor: number; sky: number;
  elevated?: boolean;                 // an elevated train line along some streets
  cableCar?: boolean;                 // cable car tracks down some streets
  cranes?: boolean;                   // container cranes and stacks in industrial blocks
  rail?: boolean;                     // rail spurs through industrial yards
  townSquare?: boolean;               // courthouse clock tower and a water tower with the town name
  storybook?: boolean;                // it is set for the fantasy city: bent towers, tuft trees, striped hills, the knitting works
  snowTufts?: boolean;                // (it is set for a storybook city under snow: its trees keep their colours, capped with snow)
  // How likely each street layout is (city.ts CityPlan.layout): the square grid, a grid bent out
  // of square, an organic town with no grid. Relative weights; organic only where nothing needs a
  // straight line through town (no freeway, elevated line or cable car), else its share goes to
  // the other two.
  layouts: { grid: number; warp: number; organic: number };
}

// Each style is defined in its folder, beside its cities (docs/fixed-cities.md).
export const STYLES: Record<StyleId, CityStyle> = {
  coastal: STYLE_COASTAL,
  metro: STYLE_METRO,
  desert: STYLE_DESERT,
  brick: STYLE_BRICK,
  mainstreet: STYLE_MAINSTREET,
  port: STYLE_PORT,
  storybook: STYLE_STORYBOOK,
};
const STYLE_IDS = (Object.keys(STYLES) as StyleId[]).filter((id) => !STYLES[id].storybook);   // these are the real cities' styles

// The storybook city comes now and then: a city of the journey is the fantasy town in place of the real
// style its turn would have had. It is never one of the first two cities (the journey starts somewhere real),
// never within STORYBOOK_GAP cities of the last one, and otherwise comes with STORYBOOK_ODDS: about one
// city in eight over a long journey. isStorybookCity is a pure function of the seed.
export const STORYBOOK_ODDS = 1 / 2, STORYBOOK_GAP = 6;
export function isStorybookCity(seed: number, city: number): boolean {
  let last = -Infinity;
  for (let k = 2; k <= city; k++) if (k - last > STORYBOOK_GAP && hash2(seed, k, 0x5b, 0x5e055) < STORYBOOK_ODDS) last = k;
  return last === city;
}

// This picks the style for city number `city` of a journey: the journey cycles through the six real styles in
// an order shuffled from its seed, so no two cities in a row share a style and each style comes
// round every six cities; now and then (isStorybookCity) the storybook city takes a city's turn.
export function journeyStyle(seed: number, city: number): CityStyle {
  if (DEBUG_STYLE && DEBUG_STYLE in STYLES) return STYLES[DEBUG_STYLE as StyleId];
  if (isStorybookCity(seed, city)) return STYLES.storybook;
  const order = [...STYLE_IDS];   // every style once per six cities, in a shuffled order
  const r = mulberry32(seed ^ 0x57f1e5);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return STYLES[order[((city % 6) + 6) % 6]];
}
// A city's name: a catalogue city's own (visits.ts), else one of its style's by hash.
export function cityName(seed: number, style: CityStyle) { return cityByKey(seed)?.name ?? style.names[Math.floor(hash2(seed, 9, 0, 0x4a3e) * style.names.length)]; }
