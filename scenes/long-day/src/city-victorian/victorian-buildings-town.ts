// This file draws the Victorian city's buildings (styles.ts, `victorian`) into the city's batches
// like any other city's: its terraces, shop rows, grand buildings and churches, warehouses and
// mills, back yards, garden squares, industrial yards and the toll gate on the road in. city.ts
// places each as a recipe (vicLot, vicTower, vicWorks, vicYard, vicSquare; garden, shed and
// planter drawn the Victorian way) and calls these to draw them.
// The file imports only geometry, so city.ts and the others can import it at load.
import { Batch } from "../geom.ts";
import { facadeBox } from "../facade.ts";
import { FACADE } from "../facadetiles.ts";

export type VicRand = () => number;
export interface VicRect { x0: number; z0: number; x1: number; z1: number }
export type VicDistrict = "downtown" | "commercial" | "residential" | "industrial" | "park";
// A lot's front door, recorded for the city's kerb doors (city.ts doorSpot): in the wall from x0 to
// x1 at depth n (the street side's z), its middle bay; `painted` puts it in the bay a facade's
// painted door is in (facadeBox).
export type VicDoor = (x0: number, x1: number, n: number, painted?: boolean) => void;

// The palette: stock brick, red brick, stucco, Portland stone, slate, soot, cast iron painted
// green or black, gilt, and the gas lamps' warm light.
export const VIC = {
  stock: 0xb8a27a, red: 0x8e3b2a, stucco: 0xe8dfc8, stone: 0xd2c7ac, slate: 0x4a5058, soot: 0x3a3632,
  iron: 0x23302a, black: 0x1c1d20, green: 0x2e4a36, maroon: 0x6a1f2a, navy: 0x24324e, gilt: 0xc9a44a,
  timber: 0x6a4a30, cream: 0xefe6cf, lamp: 0xffd27a, chimneyPot: 0xa8583a, glass: 0x2a3440,
};
// These are the street's colours, laid over city.ts's C while a Victorian city is built
// (setCityStyle): granite setts for the road, York stone flags for the pavements, granite kerbs,
// no painted markings to speak of, black iron poles and warm gas lamps.
export const VIC_STREET = { asphalt: 0x5a5650, sidewalk: 0x9a958a, curb: 0x8a8680, white: 0xd8d2c4, yellow: 0xc8b070, pole: 0x1c1d20, lampHead: 0xffd27a,
  pavers: 0x8f8a80, plaza: 0xa8a294, path: 0xb8a888, concrete: 0x7a766e };

// vicLot draws a lot's building on b (in its face's frame, the street at -z, the ground at y0) for
// its district: a terrace house behind its area railings, a shop under its fascia, a grand
// building downtown (as tall as hs, downtown's height there, allows), a warehouse or mill in
// industry, a park's bandstand or pavilion. It records its front door with `door`.
export function vicLot(s: Batch, b: VicRect, y0: number, district: VicDistrict, hs: number, walls: readonly number[], rnd: VicRand, door: VicDoor) {
  const wall = walls[Math.floor(rnd() * walls.length)];
  if (district === "industrial") { vicWorks(s, b, y0, 7, wall, rnd, door); return; }
  const floors = district === "downtown" ? Math.max(3, Math.round(3 + hs * 4)) : district === "park" ? 1 : district === "commercial" ? 3 : 2;
  const tile = district === "downtown" ? FACADE.VICT_GRAND : FACADE.VICT_SASH, ground = district === "residential" ? FACADE.VICT_DOOR : FACADE.VICT_SHOP;
  door(b.x0, b.x1, b.z0, district === "residential");
  const top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, y0, [{ tile: ground, floors: 1, floorH: 3.6 }, ...(floors > 1 ? [{ tile, floors: floors - 1, floorH: 3.4 }] : [])], wall);
  s.span(b.x0, top, b.z0, b.x1, top + 0.3, b.z1, VIC.slate);
}
// vicTower draws a downtown block's middle building, standing on its own on b (no door): a
// grand civic building, a church with its spire or a department store with its corner dome.
export function vicTower(s: Batch, b: VicRect, y0: number, hs: number, walls: readonly number[], rnd: VicRand) {
  const wall = walls[Math.floor(rnd() * walls.length)];
  const top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, y0, [{ tile: FACADE.VICT_GRAND, floors: Math.max(3, Math.round(4 + hs * 4)), floorH: 3.8 }], wall);
  s.span(b.x0, top, b.z0, b.x1, top + 0.3, b.z1, VIC.slate);
}
// vicWorks draws an industrial building on b: a warehouse with its stacked loading doors and hoist,
// or a mill with rows of arched windows and its chimney, its one tall storey floorH high. A lot's
// records its front door with `door`; a block middle's has none.
export function vicWorks(s: Batch, b: VicRect, y0: number, floorH: number, wall: number, _rnd: VicRand, door: VicDoor | null = null) {
  if (door) door(b.x0, b.x1, b.z0);
  const top = facadeBox(s, b.x0, b.z0, b.x1, b.z1, y0, [{ tile: FACADE.VICT_WAREHOUSE, floors: 1, floorH }], wall);
  s.span(b.x0, top, b.z0, b.x1, top + 0.3, b.z1, VIC.slate);
}
// vicYard dresses an industrial yard w by d (centred on its frame's origin) in place of another
// city's containers: barrels, crates, timber, sacks and coal.
export function vicYard(s: Batch, w: number, d: number, y0: number, _rnd: VicRand) {
  s.box(0, y0 + 0.6, 0, w * 0.6, 1.2, d * 0.6, VIC.timber);
}
// vicBackYard draws a terrace house's back yard (a0, n0)-(a1, n1) in its face's frame: walled in
// brick, flagged or a patch of grass, perhaps a privy or coal shed at the back and a washing line.
export function vicBackYard(s: Batch, g: Batch, a0: number, n0: number, a1: number, n1: number, y0: number, grass: number, _rnd: VicRand) {
  for (const a of [a0, a1]) s.box(a, y0 + 0.9, (n0 + n1) / 2, 0.22, 1.8, n1 - n0, VIC.stock);
  s.box((a0 + a1) / 2, y0 + 0.9, n1, a1 - a0, 1.8, 0.22, VIC.stock);
  g.box((a0 + a1) / 2, y0 + 0.01, (n0 + n1) / 2, a1 - a0, 0.02, n1 - n0, grass);
}
// vicShed draws a block middle's outbuilding (a privy, a coal shed or a workshop), centred on its
// frame's origin, in its wall's colour.
export function vicShed(s: Batch, y0: number, wall: number, _rnd: VicRand) {
  s.box(0, y0 + 1.1, 0, 2.4, 2.2, 2.0, wall); s.box(0, y0 + 2.3, 0, 2.7, 0.2, 2.3, VIC.slate);
}
// vicSquare draws a garden square w by d (centred on its frame's origin) in place of a car park:
// lawns inside iron railings, gravel walks, and in a big one (`big`) a statue or a fountain in the
// middle. Its trees are trees of their own.
export function vicSquare(s: Batch, g: Batch, w: number, d: number, y0: number, big: boolean, grass: number, _rnd: VicRand) {
  g.box(0, y0 + 0.01, 0, w, 0.02, d, grass);
  if (big) s.box(0, y0 + 1.5, 0, 1.2, 3, 1.2, VIC.stone);
}
// vicPlanter draws a street tree's iron guard on a paved block middle, in place of a planter.
export function vicPlanter(s: Batch, y0: number) { s.cyl(0, y0 + 0.6, 0, 0.5, 1.2, VIC.iron, 8); }
// vicGate draws the toll gate over the road in, at (x, z), its road heading (fx, fz) and its half
// width `half`: a toll house beside a five-barred gate swung open, with its board of tolls.
export function vicGate(s: Batch, x: number, z: number, fx: number, fz: number, half: number, y0 = 0) {
  for (const k of [-1, 1]) s.box(x - fz * k * (half + 0.4), y0 + 1.6, z + fx * k * (half + 0.4), 0.5, 3.2, 0.5, VIC.stone);
}
