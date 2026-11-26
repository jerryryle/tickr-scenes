// The desert style (styles.ts CityStyle): what every desert city is built from, and its odds
// for the generator's street layouts (tools/draftcities.ts).
import type { CityStyle } from "../styles.ts";
import { FACADE } from "../facadetiles.ts";

export const STYLE_DESERT: CityStyle = {
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
};
