// City style profiles (concept doc, "City style profiles"): each city takes one, so consecutive
// cities feel like different places rather than reskins. A profile sets palettes, trees, how big
// downtown is and how tall it grows, the district mix, which facade tiles and residential forms
// it favours, how dense its signage is, a few signature features, and the skyline backdrop.
import { hash2, mulberry32 } from "./rng.ts";
import { DEBUG_STYLE } from "./debug.ts";
import { FACADE } from "./facadetiles.ts";

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
  storybook?: boolean;                // the fantasy city: bent towers, tuft trees, striped hills, the knitting works
  snowTufts?: boolean;                // (a storybook city under snow: its trees keep their colours, capped with snow)
  // How likely each street layout is (city.ts CityPlan.layout): the square grid, a grid bent out
  // of square, an organic town with no grid. Relative weights; organic only where nothing needs a
  // straight line through town (no freeway, elevated line or cable car), else its share goes to
  // the other two.
  layouts: { grid: number; warp: number; organic: number };
}

export const STYLES: Record<StyleId, CityStyle> = {
  coastal: {
    id: "coastal", layouts: { grid: 0.15, warp: 0.45, organic: 0.4 }, names: ["Bayview", "Fogcrest", "Golden Hollow", "Seacliff", "Twin Peaks Bay"],
    walls: {
      downtown: [0xd8d2c4, 0xc9b79a, 0xe6e1d6, 0x9aa7b0, 0xb08d6e],
      commercial: [0xe7b7a3, 0xa8d0c8, 0xf0d58c, 0xc7a6d6, 0x9fc3e0, 0xe89a7a],
      residential: [0xf4c6c6, 0xb9e0d0, 0xf7e3a1, 0xc9c1ec, 0xa9d4f2, 0xf2b98f, 0xd8eab0],
      industrial: [0xc9c5b8, 0x9aa7b0, 0xb5a58a],
    },
    roofs: [0x75787a, 0xa9aba7, 0xc6c3b8], gables: [0x4a4f57, 0x2f3a45, 0x7a3b2e, 0x5b6470],
    awnings: [0x1f6fb2, 0x2e8b57, 0xc0392b, 0xe0a020],
    trees: { kinds: ["broad", "broad", "conifer"], greens: [0x2f7d32, 0x3c7a46, 0x4f8f3a] },
    grass: 0x5a9a46, pavers: 0xa9a294,
    core: 2.2, towerScale: 1.0, maxShopFloors: 4, industrial: 0.3,
    towerTiles: [FACADE.DECO, FACADE.OFFICE, FACADE.CURTAIN], upperTiles: [FACADE.RESIDENTIAL, FACADE.APARTMENT, FACADE.PUNCHED],
    houses: "row", neon: 0.15, billboards: 0.12, ghostSigns: 0.05, waterTanks: 0.1, fireEscapes: true,
    backdrop: "bridge", backdropColor: 0x6f86a8, sky: 0x0b4fc4, cableCar: true,
  },
  metro: {
    id: "metro", layouts: { grid: 0.5, warp: 0.4, organic: 0.1 }, names: ["Metropolis Heights", "New Harbor City", "Grand Central", "Midtown", "Empire Point"],
    walls: {
      downtown: [0x7d8a96, 0x5f7f99, 0x9aa7b0, 0x3f5568, 0xd8d2c4, 0x8fa3b5, 0x2f4a62],
      commercial: [0xb5553c, 0x8f4a3a, 0xc0c4b8, 0x6d8f8a, 0xd9c7a0, 0x9b6fa0],
      residential: [0xb5553c, 0xc98b5a, 0x8f4a3a, 0xd9c7a0, 0xa36a4c],
      industrial: [0xb8bcb8, 0x8e9aa3, 0x9a6b4f],
    },
    roofs: [0x55585c, 0x75787a, 0x8f8676], gables: [0x4a4f57, 0x2f3a45],
    awnings: [0xc0392b, 0x222222, 0x1f6fb2, 0x7a3e9d],
    trees: { kinds: ["broad"], greens: [0x2f7d32, 0x2a6b3a] },
    grass: 0x4f8a3a, pavers: 0x9e978a,
    core: 3.3, towerScale: 1.6, maxShopFloors: 6, industrial: 0.3,
    towerTiles: [FACADE.CURTAIN, FACADE.OFFICE, FACADE.RIBBON, FACADE.CURTAIN, FACADE.BRUTALIST], upperTiles: [FACADE.BRICK, FACADE.APARTMENT, FACADE.PUNCHED],
    houses: "row", neon: 0.3, billboards: 0.35, ghostSigns: 0.1, waterTanks: 0.45, fireEscapes: true,
    backdrop: "skyline", backdropColor: 0x5a6f8f, sky: 0x0a49b8, elevated: true,
  },
  desert: {
    id: "desert", layouts: { grid: 0.45, warp: 0.3, organic: 0.25 }, names: ["Sun Mesa", "Dry Gulch", "Saguaro Springs", "Red Rock", "Palm Vista"],
    walls: {
      downtown: [0xe6d3b3, 0xd9b48f, 0xc9a37a, 0xe8c8a0, 0xb88a6a],
      commercial: [0xf0d0a8, 0xe8a87c, 0xd98a6a, 0xf2e2c4, 0x6fb5a8, 0xe0c060],
      residential: [0xf2dcc0, 0xe8c4a0, 0xf0b8a0, 0xe0d0b0, 0xc8d8c0],
      industrial: [0xd8c8a8, 0xc0a888, 0xb89878],
    },
    roofs: [0xc9b49a, 0xd8c8b0, 0xb06a4a], gables: [0xb0583a, 0xc06a40, 0x9a4a30],
    awnings: [0x2aa198, 0xe0a020, 0xc0392b, 0x1f6fb2],
    trees: { kinds: ["palm", "palm", "broad"], greens: [0x5a8a3a, 0x6a9a3a, 0x4a7a3a] },
    grass: 0xb8a070, pavers: 0xc4b294,
    core: 1.9, towerScale: 0.75, maxShopFloors: 2, industrial: 0.36,
    towerTiles: [FACADE.RIBBON, FACADE.OFFICE, FACADE.PUNCHED], upperTiles: [FACADE.PUNCHED, FACADE.RESIDENTIAL],
    houses: "bungalow", neon: 0.45, billboards: 0.25, ghostSigns: 0.05, waterTanks: 0.05, fireEscapes: false,
    backdrop: "mesas", backdropColor: 0xb46a4a, sky: 0x0a58d0,
  },
  brick: {
    id: "brick", layouts: { grid: 0.25, warp: 0.45, organic: 0.3 }, names: ["Ironworks", "Millbrook", "Foundry Falls", "Steelton", "Brickport"],
    walls: {
      downtown: [0x9a5a3e, 0x7f4a34, 0xb06a48, 0xc9b79a, 0x8a6a5a],
      commercial: [0xa0523a, 0x8f4a3a, 0xb5653c, 0x7a3e2e, 0xc98b5a],
      residential: [0xa0523a, 0xb87050, 0x8f5a44, 0xd9c7a0, 0xc4a080],
      industrial: [0x9a5a3e, 0x8a4a32, 0xa86a4a, 0x7a4a3a, 0xb8bcb8],
    },
    roofs: [0x55585c, 0x75787a, 0x4a4440], gables: [0x3a3a40, 0x4a3a30, 0x5b4636],
    awnings: [0x2e8b57, 0x222222, 0xc0392b],
    trees: { kinds: ["broad"], greens: [0x3a6a32, 0x4a7a3a] },
    grass: 0x56803e, pavers: 0x8e877c,
    core: 2.0, towerScale: 0.8, maxShopFloors: 4, industrial: 0.55,
    towerTiles: [FACADE.BRICK, FACADE.DECO, FACADE.PUNCHED], upperTiles: [FACADE.BRICK, FACADE.PUNCHED],
    houses: "row", neon: 0.12, billboards: 0.15, ghostSigns: 0.5, waterTanks: 0.35, fireEscapes: true,
    backdrop: "stacks", backdropColor: 0x6a5a58, sky: 0x0b4fc4, rail: true,
  },
  mainstreet: {
    id: "mainstreet", layouts: { grid: 0.15, warp: 0.3, organic: 0.55 }, names: ["Maple Falls", "Pleasantville", "Elm Grove", "Cedar Junction", "Willow Creek"],
    walls: {
      downtown: [0xd9c7a0, 0xb5553c, 0xc98b5a, 0xe6e1d6],
      commercial: [0xb5553c, 0xd9c7a0, 0x6d8f8a, 0xe0b85c, 0xc0c4b8, 0x8f4a3a, 0x9fb7e0],
      residential: [0xf0e6cf, 0xb7d0d9, 0xffffff, 0xa8c49a, 0xe8d38a, 0xe0a890],
      industrial: [0xb8bcb8, 0xc9b98f, 0x9a6b4f],
    },
    roofs: [0x75787a, 0xa9aba7], gables: [0x7a3b2e, 0x4a4f57, 0x5b4636, 0x2f3a45],
    awnings: [0xc0392b, 0x1f6fb2, 0x2e8b57, 0xe0a020],
    trees: { kinds: ["broad", "broad", "conifer"], greens: [0x2f7d32, 0x3f8f2f, 0x5a9a2a] },
    grass: 0x5a9a3c, pavers: 0xa49c8e,
    core: 1.3, towerScale: 0.35, maxShopFloors: 2, industrial: 0.28,
    towerTiles: [FACADE.DECO, FACADE.BRICK], upperTiles: [FACADE.RESIDENTIAL, FACADE.BRICK],
    houses: "detached", neon: 0.1, billboards: 0.1, ghostSigns: 0.2, waterTanks: 0.05, fireEscapes: false,
    backdrop: "farmhills", backdropColor: 0x5f8a5a, sky: 0x0c55cc, townSquare: true,
  },
  port: {
    id: "port", layouts: { grid: 0.2, warp: 0.5, organic: 0.3 }, names: ["North Harbor", "Rainier Bay", "Puget Point", "Gray Haven", "Ferryport"],
    walls: {
      downtown: [0x7d8a96, 0x5f6f7a, 0x8a9aa0, 0xc9b79a, 0x4a5a66],
      commercial: [0x6d8f8a, 0x8f4a3a, 0x4a6a7a, 0xc0c4b8, 0x7a6a5a],
      residential: [0x8aa0a8, 0x6a8a7a, 0xc8c0b0, 0x5a6a7a, 0xa89878],
      industrial: [0x6a7a84, 0x8a4a3a, 0x4a6a8a, 0xb8bcb8, 0xc04030],
    },
    roofs: [0x4a4f54, 0x5a5e62], gables: [0x2f3a45, 0x3a3a40, 0x4a5a4a],
    awnings: [0x1f6fb2, 0x2e8b57, 0x222222],
    trees: { kinds: ["conifer", "conifer", "broad"], greens: [0x1f5a34, 0x24663a, 0x2a6b3a] },
    grass: 0x3f7a3a, pavers: 0x8a8c88,
    core: 2.3, towerScale: 1.1, maxShopFloors: 4, industrial: 0.45,
    towerTiles: [FACADE.CURTAIN, FACADE.OFFICE, FACADE.BRUTALIST], upperTiles: [FACADE.APARTMENT, FACADE.PUNCHED, FACADE.SIDING],
    houses: "detached", neon: 0.2, billboards: 0.15, ghostSigns: 0.1, waterTanks: 0.1, fireEscapes: false,
    backdrop: "evergreens", backdropColor: 0x2f5a4a, sky: 0x0b4cb8, cranes: true,
  },
  storybook: {
    // The fantasy town: a storybook place of bent, bulging towers in hats, crooked shop rows under
    // scalloped awnings, tuft trees on striped trunks, striped contour hills and a knitting works.
    id: "storybook", storybook: true, layouts: { grid: 0, warp: 0.35, organic: 0.65 },
    names: ["Wumbleton", "Fizzlebury", "Snickerwick", "Tumbledown Tuft", "Higgle-on-the-Wobble", "Puddlewump"],
    walls: {
      downtown: [0xff5a4e, 0xff7fb5, 0xf2c230, 0x5fd3a0, 0x1fb5b0, 0x9a6cf0, 0x6fe0e8, 0xff9a2e],
      commercial: [0xff5a4e, 0xff7fb5, 0xf2c230, 0x5fd3a0, 0x9a6cf0, 0xff9a2e, 0xa6e05a, 0xd83a9a],
      residential: [0xfbe58a, 0xff7fb5, 0x6fe0e8, 0xa6e05a, 0xff9a2e, 0x9a6cf0, 0x5fd3a0],
      industrial: [0xfff3dc, 0xe8333a, 0x1fb5b0, 0xf2c230],
    },
    roofs: [0x9a6cf0, 0x1fb5b0, 0xe8333a], gables: [0xe8333a, 0x6a3a9a, 0x1fb5b0, 0xf2c230, 0xff7fb5],
    awnings: [0xe8333a, 0x1fb5b0, 0x9a6cf0, 0xff9a2e],
    trees: { kinds: ["tuft", "tuft", "pancake", "droop", "spiral"], greens: [0xff7fb5, 0xff9a2e, 0xf2c230, 0x9a6cf0, 0xd83a9a, 0x6fe0e8] },
    grass: 0x92d85c, pavers: 0xffe2dc,
    core: 1.8, towerScale: 0.6, maxShopFloors: 3, industrial: 0.3,
    towerTiles: [FACADE.STORYBOOK], upperTiles: [FACADE.STORYBOOK],
    houses: "detached", neon: 0, billboards: 0, ghostSigns: 0, waterTanks: 0, fireEscapes: false,
    backdrop: "storyhills", backdropColor: 0x5fcf8a, sky: 0x34b6e0,
  },
};
const STYLE_IDS = (Object.keys(STYLES) as StyleId[]).filter((id) => !STYLES[id].storybook);   // the real cities' styles

// The storybook city: now and then a city of the journey is the fantasy town in place of the real
// style its turn would have had. Never the first two cities (the journey starts somewhere real),
// never within STORYBOOK_GAP cities of the last one, and otherwise with STORYBOOK_ODDS: about one
// city in eight over a long journey. A pure function of the seed.
export const STORYBOOK_ODDS = 1 / 2, STORYBOOK_GAP = 6;
export function isStorybookCity(seed: number, city: number): boolean {
  let last = -Infinity;
  for (let k = 2; k <= city; k++) if (k - last > STORYBOOK_GAP && hash2(seed, k, 0x5b, 0x5e055) < STORYBOOK_ODDS) last = k;
  return last === city;
}

// The style for city number `city` of a journey: the journey cycles through the six real styles in
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
export function cityName(seed: number, style: CityStyle) { return style.names[Math.floor(hash2(seed, 9, 0, 0x4a3e) * style.names.length)]; }
