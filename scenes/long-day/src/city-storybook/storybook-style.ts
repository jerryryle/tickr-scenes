// The storybook style (styles.ts CityStyle): what every storybook city is built from, and its odds
// for the generator's street layouts (tools/draftcities.ts).
import type { CityStyle } from "../styles.ts";
import { FACADE } from "../facadetiles.ts";

export const STYLE_STORYBOOK: CityStyle = {
  // The fantasy town is a storybook place of bent, bulging towers in hats, crooked shop rows under
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
};
