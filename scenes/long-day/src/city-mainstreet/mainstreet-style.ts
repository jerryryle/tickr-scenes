// The mainstreet style (styles.ts CityStyle): what every mainstreet city is built from, and its odds
// for the generator's street layouts (tools/draftcities.ts).
import type { CityStyle } from "../styles.ts";
import { FACADE } from "../facadetiles.ts";

export const STYLE_MAINSTREET: CityStyle = {
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
};
