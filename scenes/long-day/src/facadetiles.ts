// Tile numbers in the facade atlas (see facade.ts). A module of its own with no imports, so the
// city styles can use them while modules are still loading.
export const FACADE = {
  OFFICE: 0, PUNCHED: 1, DECO: 2, RESIDENTIAL: 3, STOREFRONT: 4, INDUSTRIAL: 5, DOCK: 6, BLANK: 7,
  BRICK: 8, BRUTALIST: 9, CURTAIN: 10, APARTMENT: 11, SIDING: 12, DOOR: 13, LOBBY: 14, RIBBON: 15,
} as const;
