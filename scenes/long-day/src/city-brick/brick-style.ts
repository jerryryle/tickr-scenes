// The brick style (styles.ts CityStyle): what every brick city is built from, and its odds
// for the generator's street layouts (tools/draftcities.ts).
import type { CityStyle } from "../styles.ts";
import { FACADE } from "../facadetiles.ts";

export const STYLE_BRICK: CityStyle = {
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
};
