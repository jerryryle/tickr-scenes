// The city grid's sizes: block pitch, street and kerb widths, kerb height, and how many blocks of
// countryside ring a city (see city.ts). A module of its own with no imports, so code anywhere
// can use them while modules are still loading.
export const BLOCK = 60, STREET = 18, KERB = 3, CURB_H = 0.15;
// The top of a block's own ground (its lots, park, yard): just under the sidewalks' (CURB_H).
// They overlap at the edges (a warped block's corners reach under its streets' sidewalks), and
// at one height the two flickered against each other.
export const LOT_TOP = CURB_H - 0.02;
export const RING = 4;
