// The city grid's sizes: block pitch, street and kerb widths, kerb height, and how many blocks of
// countryside ring a city (see city.ts). A module of its own with no imports, so code anywhere
// can use them while modules are still loading.
export const BLOCK = 60, STREET = 18, KERB = 3, CURB_H = 0.15;
export const RING = 4;
