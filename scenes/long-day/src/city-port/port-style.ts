// The port style (styles.ts CityStyle): what every port city is built from, and its odds
// for the generator's street layouts (tools/draftcities.ts).
import type { CityStyle } from "../styles.ts";
import { FACADE } from "../facadetiles.ts";

export const STYLE_PORT: CityStyle = {
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
};
