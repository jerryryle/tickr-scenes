// The storybook style (styles.ts CityStyle): what every storybook city is built from, and its odds
// for the generator's street layouts (tools/draftcities.ts).
import type { CityStyle } from "../styles.ts";
import { FACADE } from "../facadetiles.ts";

export const STYLE_STORYBOOK: CityStyle = {
  // The fantasy town is a storybook place of bent, bulging towers in hats, crooked shop rows under
  // scalloped awnings, tuft trees on striped trunks, striped contour hills and a knitting works.
  id: "storybook", storybook: true, layouts: { grid: 0, warp: 0.35, organic: 0.65 },
  names: ["Wumbleton", "Fizzlebury", "Snickerwick", "Tumbledown Tuft", "Higgle-on-the-Wobble", "Puddlewump"],
  // Each district's walls are a family of candy bodies (storybook-buildings-town.ts SB_BODY), and its
  // roofs, gables and awnings take the saturated accents (SB_ACCENT): downtown coral, pink, mint, violet,
  // orange, sky and butter; the shops those and lime; houses lime, mint, sky, butter, rose and lilac;
  // the works cream, coral, mint and butter. The trees' crowns are accents too, so a tree stands out against a wall.
  walls: {
    downtown: [0xff5a4e, 0xff7fb5, 0x86e6b4, 0x9a6cf0, 0xffa860, 0x7fd0f0, 0xffd84a],
    commercial: [0xff5a4e, 0xff7fb5, 0xffd84a, 0x86e6b4, 0x9a6cf0, 0xffa860, 0xa6e05a, 0x7fd0f0],
    residential: [0xa6e05a, 0x86e6b4, 0x7fd0f0, 0xffd84a, 0xff8fb5, 0xb48cf0],
    industrial: [0xfbeedd, 0xff5a4e, 0x86e6b4, 0xffd84a],
  },
  roofs: [0xe8333a, 0xf2c230, 0x7a4fd8, 0x14a3a0], gables: [0xff8a1e, 0xd83a9a, 0xe8333a, 0x14a3a0, 0x7a4fd8],
  awnings: [0xe8333a, 0x14a3a0, 0x7a4fd8, 0xff8a1e],
  // (Six crowns: a city file's tree names its crown by its place in this list.)
  trees: { kinds: ["tuft", "tuft", "pancake", "droop", "spiral"], greens: [0xff8a1e, 0xd83a9a, 0xf2c230, 0x7a4fd8, 0xe8333a, 0xff5a9e] },
  grass: 0x92d85c, pavers: 0xe8c4c0,
  core: 1.8, towerScale: 0.6, maxShopFloors: 3, industrial: 0.3,
  towerTiles: [FACADE.STORYBOOK], upperTiles: [FACADE.STORYBOOK],
  houses: "detached", neon: 0, billboards: 0, ghostSigns: 0, waterTanks: 0, fireEscapes: false,
  backdrop: "storyhills", backdropColor: 0x5fcf8a, sky: 0x3f8fe0,
};
