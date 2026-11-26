// The coastal style (styles.ts CityStyle): what every coastal city is built from, and its odds
// for the generator's street layouts (tools/draftcities.ts).
import type { CityStyle } from "../styles.ts";
import { FACADE } from "../facadetiles.ts";

export const STYLE_COASTAL: CityStyle = {
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
};
