// The Victorian style (styles.ts CityStyle): what every Victorian city is built from, and its odds
// for the generator's street layouts (tools/draftcities.ts).
import type { CityStyle } from "../styles.ts";
import { FACADE } from "../facadetiles.ts";

export const STYLE_VICTORIAN: CityStyle = {
  // The gaslit town is a nineteenth-century place of terraces in stock brick and stucco, painted
  // timber shopfronts, Gothic spires and banks with columns, mills and warehouses with hoists, gas
  // lamps over cobbled streets and a steam brewery. Its vehicles are horse-drawn, and the trucks
  // become carriages there (truck.ts, carriage). Its sky is the dun of coal smoke, and its stucco
  // and stone have dulled towards it.
  id: "victorian", victorian: true, layouts: { grid: 0.2, warp: 0.6, organic: 0.2 },
  names: ["Ravensgate", "Coalbridge", "Ashcombe", "Blackmoor", "Kingswell"],
  walls: {
    downtown: [0xd9cdb0, 0xc8b48e, 0xdbcfb4, 0xa8624a, 0xbfa57a, 0x9a8a78],
    commercial: [0xb8a27a, 0x8e4a34, 0xa65a40, 0xd8ccb2, 0xc4ad84, 0x7a4636],
    residential: [0xb8a27a, 0xc9b48c, 0x9a4a36, 0xd8ccb2, 0xa8936e, 0xd4c6a8],
    industrial: [0x8a3e2c, 0x9a4a34, 0x7a3a2a, 0xa8907a, 0x6e3a2e],
  },
  roofs: [0x4a5058, 0x3e444c, 0x585e66], gables: [0x4a5058, 0x3e444c, 0x6a4a3a, 0x585e66],
  awnings: [0x2e4a36, 0x6a1f2a, 0x2a3a5a, 0x8a6a2a],
  trees: { kinds: ["broad"], greens: [0x3e6a34, 0x4a7638, 0x35602e] },
  grass: 0x5a8040, pavers: 0x8f8a80,
  core: 2.0, towerScale: 0.55, maxShopFloors: 4, industrial: 0.42,
  towerTiles: [FACADE.VICT_GRAND, FACADE.VICT_GOTHIC], upperTiles: [FACADE.VICT_SASH],
  houses: "row", neon: 0, billboards: 0, ghostSigns: 0.35, waterTanks: 0, fireEscapes: false,
  backdrop: "spires", backdropColor: 0x6a6a72, sky: 0x88877e,
};
