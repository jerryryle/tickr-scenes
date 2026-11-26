// The metro style (styles.ts CityStyle): what every metro city is built from, and its odds
// for the generator's street layouts (tools/draftcities.ts).
import type { CityStyle } from "../styles.ts";
import { FACADE } from "../facadetiles.ts";

export const STYLE_METRO: CityStyle = {
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
};
