// Tile numbers in the facade atlas (see facade.ts). A module of its own with no imports, so the
// city styles can use them while modules are still loading.
export const FACADE = {
  OFFICE: 0, PUNCHED: 1, DECO: 2, RESIDENTIAL: 3, STOREFRONT: 4, INDUSTRIAL: 5, DOCK: 6, BLANK: 7,
  BRICK: 8, BRUTALIST: 9, CURTAIN: 10, APARTMENT: 11, SIDING: 12, DOOR: 13, LOBBY: 14, RIBBON: 15,
  // The storybook city's are round and arched windows in thick trim (STORYBOOK), an arched shop window
  // and round-topped door (STORY_SHOP), a house's arched door beside a porthole (STORY_DOOR).
  STORYBOOK: 16, STORY_SHOP: 17, STORY_DOOR: 18,
  // The Victorian city's are sash windows under lintels in brick or stucco (VICT_SASH), a painted
  // timber shopfront under its fascia (VICT_SHOP), a panelled front door under a fanlight
  // (VICT_DOOR), pointed Gothic windows (VICT_GOTHIC), a warehouse's stacked loading doors
  // (VICT_WAREHOUSE), a grand building's pedimented windows between pilasters (VICT_GRAND), a
  // mill's rows of arched iron-framed windows (VICT_MILL), and the shopfront's plate glass with no
  // door, for its other bays (VICT_SHOPWIN).
  // (Their variants come in pairs: 0 and 1 for brick, 2 and 3 for stucco or stone. The Victorian
  // buildings pick a wall's variants by what it is: victorian-buildings-town.ts.)
  VICT_SASH: 19, VICT_SHOP: 20, VICT_DOOR: 21, VICT_GOTHIC: 22, VICT_WAREHOUSE: 23, VICT_GRAND: 24, VICT_MILL: 25, VICT_SHOPWIN: 26,
} as const;
// The atlas has room for this many kinds (a tile's kind is its id modulo this; facadeart.ts).
export const FACADE_KINDS = 32;
// The tiles that paint a ground-floor door (facadeart.ts), and where in the tile (pixels of
// FACADE_TILE, y from the top) it is: [left, right, top], down to the tile's foot. (A lobby's
// doors are glass on glass: only their push bars and below read as a door.)
export const PAINTED_DOORS: Partial<Record<number, readonly [number, number, number]>> = {
  [FACADE.STOREFRONT]: [96, 124, 34], [FACADE.DOOR]: [40, 88, 20], [FACADE.LOBBY]: [40, 88, 76],
  [FACADE.STORY_SHOP]: [98, 122, 37], [FACADE.STORY_DOOR]: [44, 84, 24],
  [FACADE.VICT_SHOP]: [98, 122, 30], [FACADE.VICT_DOOR]: [42, 86, 38],
};
