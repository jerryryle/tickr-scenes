// City style profiles (concept doc, "City style profiles"): each city takes one, so consecutive
// cities feel like different places rather than reskins. A profile sets palettes, trees, how big
// downtown is and how tall it grows, the district mix, which facade tiles and residential forms
// it favours, how dense its signage is, a few signature features, and the skyline backdrop.
import { hash2 } from "./rng.ts";
import { cityByKey, visitOf } from "./visits.ts";
import { STYLE_COASTAL } from "./city-coastal/coastal-style.ts";
import { STYLE_METRO } from "./city-metro/metro-style.ts";
import { STYLE_DESERT } from "./city-desert/desert-style.ts";
import { STYLE_BRICK } from "./city-brick/brick-style.ts";
import { STYLE_MAINSTREET } from "./city-mainstreet/mainstreet-style.ts";
import { STYLE_PORT } from "./city-port/port-style.ts";
import { STYLE_STORYBOOK } from "./city-storybook/storybook-style.ts";
import { STYLE_VICTORIAN } from "./city-victorian/victorian-style.ts";

export type StyleId = "coastal" | "metro" | "desert" | "brick" | "mainstreet" | "port" | "storybook" | "victorian";
export type TreeKind = "broad" | "palm" | "conifer" | "tuft" | "pancake" | "droop" | "spiral";
type BackdropKind = "bridge" | "skyline" | "mesas" | "stacks" | "farmhills" | "evergreens" | "storyhills" | "spires";

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
  victorian?: boolean;                // it is set for the nineteenth-century city: terraces and spires, gas lamps, horse-drawn traffic, the steam brewery, and the trucks become carriages there
  snowTufts?: boolean;                // (it is set for a storybook city under snow: its trees keep their colours, capped with snow)
  // How likely each street layout is (city.ts CityPlan.layout): the square grid, a grid bent out
  // of square, an organic town with no grid. Relative weights; organic only where nothing needs a
  // straight line through town (no freeway, elevated line or cable car), else its share goes to
  // the other two.
  layouts: { grid: number; warp: number; organic: number };
}

// Each style is defined in its folder, beside its cities (docs/long-day-cities.md).
export const STYLES: Record<StyleId, CityStyle> = {
  coastal: STYLE_COASTAL,
  metro: STYLE_METRO,
  desert: STYLE_DESERT,
  brick: STYLE_BRICK,
  mainstreet: STYLE_MAINSTREET,
  port: STYLE_PORT,
  storybook: STYLE_STORYBOOK,
  victorian: STYLE_VICTORIAN,
};

// The storybook city comes now and then (visits.ts plans it): never one of the first two cities, never
// within STORYBOOK_GAP cities of the last one, and past that it comes due with STORYBOOK_ODDS at each
// city, about one city in eight over a long journey.
export const STORYBOOK_ODDS = 1 / 2, STORYBOOK_GAP = 6;
export function isStorybookCity(seed: number, city: number): boolean { return !!STYLES[visitOf(seed, city).city.style].storybook; }

// The style of city number `city` of a journey: its catalogue city's (visits.ts).
export function journeyStyle(seed: number, city: number): CityStyle { return STYLES[visitOf(seed, city).city.style]; }
// A city's name: a catalogue city's own (visits.ts), else one of its style's by hash.
export function cityName(seed: number, style: CityStyle) { return cityByKey(seed)?.name ?? style.names[Math.floor(hash2(seed, 9, 0, 0x4a3e) * style.names.length)]; }
