// This file draws the Victorian city's buildings (styles.ts, `victorian`) into the city's batches
// like any other city's: its terraces, shop rows, grand buildings and churches, warehouses and
// mills, back yards, garden squares, industrial yards and the toll gate on the road in. city.ts
// places each as a recipe (vicLot, vicTower, vicWorks, vicYard, vicSquare; garden, shed and
// planter drawn the Victorian way) and calls these to draw them.
// Walls are facade tiles (facadeart.ts, the VICT_ kinds): windows, doors and shopfronts are paint,
// and the geometry is spent on what makes the silhouette on the board: slate roofs, chimney stacks
// with their pots, canted bays, dormers, spires, domes and mill chimneys.
// The file imports only geometry, so city.ts and the others can import it at load.
import { Batch, PLACED, toTile } from "../geom.ts";
import { BAY, facadePrism } from "../facade.ts";
import { FACADE, FACADE_KINDS } from "../facadetiles.ts";

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
  slateDark: 0x3c4148, lead: 0x6a7078, brickDark: 0x6a3024, oak: 0x7a5434, coal: 0x222226, canvas: 0xd8ceb4,
  bronze: 0x3e5e4a, copper: 0x5e9a84, gravel: 0xbcae8e, flag: 0x9c968a, white: 0xeee8da, sack: 0xb8a078,
};
// These are the street's colours, laid over city.ts's C while a Victorian city is built
// (setCityStyle): granite setts for the road, York stone flags for the pavements, granite kerbs,
// no painted markings to speak of, black iron poles and warm gas lamps.
export const VIC_STREET = { asphalt: 0x5a5650, sidewalk: 0x9a958a, curb: 0x8a8680, white: 0xd8d2c4, yellow: 0xc8b070, pole: 0x1c1d20, lampHead: 0xffd27a,
  pavers: 0x8f8a80, plaza: 0xa8a294, path: 0xb8a888, concrete: 0x7a766e };

// ---- helpers ----------------------------------------------------------------------------------
const vPick = <T,>(r: VicRand, a: readonly T[]) => a[Math.floor(r() * a.length)];
const vRange = (r: VicRand, a: number, b: number) => a + (b - a) * r();
const vClamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const vicShade = (c: number, f: number) => ((Math.min(255, Math.round(((c >> 16) & 255) * f)) << 16) | (Math.min(255, Math.round(((c >> 8) & 255) * f)) << 8) | Math.min(255, Math.round((c & 255) * f))) >>> 0;
const VIC_SLATES = [VIC.slate, VIC.slateDark, 0x52585f];
// (Brick and stone tell apart by how warm they are: a wall's tiles are the brick variants or the
// rendered ones, facadeart.ts.)
const vIsRender = (c: number) => ((c >> 16) & 255) > 0xd0 && ((c >> 8) & 255) > 0xc0;

// A facade band: `floors` storeys of `tile` in variant `v`, `floorH` each, in its own colour or the
// building's.
interface VicBand { tile: number; v: number; floors: number; floorH: number; color?: number }
// A bay of the front wall (counted from x1, the left as seen from the street) given a tile of its
// own: on the first band's ground floor only (a door), or up every band (a column of loading doors).
interface VicSpecial { k: number; tile: number; v: number; all?: boolean }
// vbox walls a box footprint with bands stacked from y0, as facade.ts facadeBox does, but with its
// variants and its front's special bays chosen by the caller. It returns the top's height.
function vicBox(s: Batch, x0: number, z0: number, x1: number, z1: number, y0: number, bands: VicBand[], color: number, special: VicSpecial[] = []): number {
  for (const [x, z] of [[x0, z1], [x1, z1], [x1, z0], [x0, z0]]) PLACED.foot.push(...toTile(x, z));
  const corners = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
  let y = y0;
  bands.forEach((band, bi) => {
    const h = band.floors * band.floorH, col = band.color ?? color, tile = band.tile + FACADE_KINDS * band.v;
    for (let sd = 0; sd < 4; sd++) {
      const [ax, az] = corners[sd], [bx, bz] = corners[(sd + 1) % 4];
      const bays = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / BAY));
      const at = (j: number): [number, number] => [ax + (bx - ax) * j / bays, az + (bz - az) * j / bays];
      const sp = sd === 2 ? special.filter((q) => q.k < bays && (q.all || bi === 0)) : [];
      let j0 = 0;
      const run = (j1: number) => { if (j1 > j0) { const [px, pz] = at(j0), [qx, qz] = at(j1); s.wall(px, pz, qx, qz, y, y + h, col, tile, 0, j1 - j0, 0, band.floors); } };
      for (let j = 0; j < bays; j++) {
        const q = sp.filter((o) => o.k === j);
        if (!q.length) continue;
        run(j); j0 = j + 1;
        const [px, pz] = at(j), [qx, qz] = at(j + 1), door = q.find((o) => !o.all), colm = q.find((o) => o.all);
        const upper = colm ? colm.tile + FACADE_KINDS * colm.v : tile;
        if (door && bi === 0) {
          s.wall(px, pz, qx, qz, y, y + band.floorH, col, door.tile + FACADE_KINDS * door.v, 0, 1, 0, 1);
          if (band.floors > 1) s.wall(px, pz, qx, qz, y + band.floorH, y + h, col, upper, 0, 1, 1, band.floors - 1);
        } else s.wall(px, pz, qx, qz, y, y + h, col, upper, 0, 1, 0, band.floors);
      }
      run(bays);
    }
    y += h;
  });
  return y;
}
// The span of front bay k (from x1) of a wall x0..x1.
function vicBayX(x0: number, x1: number, k: number): [number, number] {
  const n = Math.max(1, Math.round((x1 - x0) / BAY)), w = (x1 - x0) / n;
  return [x1 - (k + 1) * w, x1 - k * w];
}
const vicBays = (x0: number, x1: number) => Math.max(1, Math.round((x1 - x0) / BAY));

// A quad of two flat triangles, corners in order round it, facing `face` (one of them dropped where
// two corners meet, as at a hip's end).
type VicP3 = [number, number, number];
function vicQuad(s: Batch, a: VicP3, b: VicP3, c: VicP3, d: VicP3, col: number, face: [number, number, number]) {
  const area = (p: VicP3, q: VicP3, r: VicP3) => { const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], vx = r[0] - p[0], vy = r[1] - p[1], vz = r[2] - p[2]; return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); };
  if (area(a, b, c) > 1e-5) s.tri(...a, ...b, ...c, col, face);
  if (area(a, c, d) > 1e-5) s.tri(...a, ...c, ...d, col, face);
}
// frustum draws a roof from the rectangle (x0, z0)-(x1, z1) at y0 up to the rectangle t at y1 (a line
// for a hip, a point for a pyramid), with its underside and, where t has room, a flat top.
function vicFrustum(s: Batch, x0: number, z0: number, x1: number, z1: number, y0: number, t: [number, number, number, number], y1: number, col: number, under = true) {
  const [tx0, tz0, tx1, tz1] = t, A: VicP3 = [x0, y0, z0], B: VicP3 = [x1, y0, z0], C: VicP3 = [x1, y0, z1], D: VicP3 = [x0, y0, z1];
  const a: VicP3 = [tx0, y1, tz0], b: VicP3 = [tx1, y1, tz0], c: VicP3 = [tx1, y1, tz1], d: VicP3 = [tx0, y1, tz1];
  vicQuad(s, A, B, b, a, col, [0, 0.4, -1]); vicQuad(s, B, C, c, b, col, [1, 0.4, 0]); vicQuad(s, C, D, d, c, col, [0, 0.4, 1]); vicQuad(s, D, A, a, d, col, [-1, 0.4, 0]);
  if (tx1 - tx0 > 0.01 && tz1 - tz0 > 0.01) vicQuad(s, a, b, c, d, col, [0, 1, 0]);
  if (under) vicQuad(s, A, B, C, D, vicShade(col, 0.6), [0, -1, 0]);
}
// A hipped roof h high over a rectangle (a pyramid over a square).
function vicHip(s: Batch, x0: number, z0: number, x1: number, z1: number, y: number, h: number, col: number) {
  const w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  vicFrustum(s, x0, z0, x1, z1, y, w >= d ? [x0 + d / 2, cz, x1 - d / 2, cz] : [cx, z0 + w / 2, cx, z1 - w / 2], y + h, col);
}
// A mansard: a steep slate storey h high stepped in by `inset`, under a low hip. It returns the steep
// part's top.
function vicMansard(s: Batch, x0: number, z0: number, x1: number, z1: number, y: number, h: number, inset: number, col: number): number {
  vicFrustum(s, x0, z0, x1, z1, y, [x0 + inset, z0 + inset, x1 - inset, z1 - inset], y + h, col);
  vicHip(s, x0 + inset, z0 + inset, x1 - inset, z1 - inset, y + h, Math.min(1.2, (Math.min(x1 - x0, z1 - z0) / 2 - inset) * 0.35), vicShade(col, 0.9));
  return y + h;
}
// A pitched roof over a rectangle: its ridge along x (or, `across`, along z: its gable to the
// street), h high, its gable ends' triangles in `end` (the wall's colour).
function vicGable(s: Batch, x0: number, z0: number, x1: number, z1: number, y: number, h: number, col: number, end: number, across = false, eave = 0.3) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (!across) {
    s.prism(cx, y + h / 2, cz, x1 - x0, h, z1 - z0 + 2 * eave, col);
    for (const [x, f] of [[x0 - 0.006, -1], [x1 + 0.006, 1]] as const) s.tri(x, y, z0, x, y, z1, x, y + h * (z1 - z0) / (z1 - z0 + 2 * eave), cz, end, [f, 0, 0]);
  } else {
    s.prism(cx, y + h / 2, cz, z1 - z0, h, x1 - x0 + 2 * eave, col, Math.PI / 2);
    for (const [z, f] of [[z0 - 0.006, -1], [z1 + 0.006, 1]] as const) s.tri(x0, y, z, x1, y, z, cx, y + h * (x1 - x0) / (x1 - x0 + 2 * eave), z, end, [0, 0, f]);
  }
}
// A chimney stack on a roof: w across x, d along z, h tall from y, a capping band and a row of pots
// along its longer side.
function vicStack(s: Batch, x: number, z: number, y: number, w: number, d: number, h: number, col: number, pots: number) {
  s.box(x, y + h / 2, z, w, h, d, col);
  s.box(x, y + h - 0.1, z, w + 0.14, 0.18, d + 0.14, vicShade(col, 0.78));
  const along = d >= w, L = along ? d : w;
  for (let i = 0; i < pots; i++) {
    const t = (i + 0.5) / pots - 0.5, px = along ? x : x + t * L * 0.9, pz = along ? z + t * L * 0.9 : z;
    s.tubeSeg(px, y + h + 0.24, pz, 0.12, 0.5, i % 3 === 2 ? VIC.soot : VIC.chimneyPot, 5, 0, 0, px + pz);
  }
}
// A canted bay window on the front wall at z (the street at -z), across x0..x1, `out` proud of the
// wall, `floors` storeys of floorH from y: three facade walls cropped to the tile's window, and a
// lead roof.
function vicBayWindow(s: Batch, x0: number, x1: number, z: number, y: number, floors: number, floorH: number, out: number, color: number, tile: number, v: number, lid: number) {
  const t = tile + FACADE_KINDS * v, k = Math.min(out * 0.6, (x1 - x0) * 0.25), fz = z - out, top = y + floors * floorH;
  s.wall(x1 - k, fz, x0 + k, fz, y, top, color, t, 0.2, 0.6, 0, floors);
  s.wall(x1, z, x1 - k, fz, y, top, color, t, 0.4, 0.2, 0, floors);
  s.wall(x0 + k, fz, x0, z, y, top, color, t, 0.4, 0.2, 0, floors);
  vicFrustum(s, x0 - 0.05, fz - 0.08, x1 + 0.05, z, top, [x0 + k * 0.6, fz + out * 0.55, x1 - k * 0.6, z], top + 0.45, lid);
}
// Railings: a top and a bottom rail and a comb of thin bars (each a flat quad facing out), from
// (ax, az) to (bx, bz), h high, with gaps (distances along it) left open; facing (-dz, dx), the
// side a wall drawn the same way faces.
function vicRailings(s: Batch, ax: number, az: number, bx: number, bz: number, y: number, h: number, col: number, gaps: [number, number][] = [], step = 0.42) {
  const L = Math.hypot(bx - ax, bz - az); if (L < 0.2) return;
  const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx, rot = Math.atan2(-tz, tx);
  const open = (t: number) => gaps.some(([g0, g1]) => t > g0 && t < g1);
  // (The rails run between the gaps.)
  const cuts = [0, ...gaps.flat().map((v) => vClamp(v, 0, L)), L].sort((p, q) => p - q);
  for (let i = 0; i + 1 < cuts.length; i += 2) {
    const t0 = cuts[i], t1 = cuts[i + 1]; if (t1 - t0 < 0.1) continue;
    const m = (t0 + t1) / 2;
    s.box(ax + tx * m, y + h - 0.04, az + tz * m, t1 - t0, 0.06, 0.06, col, rot);
    s.box(ax + tx * m, y + 0.12, az + tz * m, t1 - t0, 0.05, 0.05, col, rot);
  }
  for (let t = step / 2; t < L; t += step) {
    if (open(t)) continue;
    const px = ax + tx * t + nx * 0.035, pz = az + tz * t + nz * 0.035, w = 0.025;
    vicQuad(s, [px - tx * w, y, pz - tz * w], [px + tx * w, y, pz + tz * w], [px + tx * w, y + h + 0.1, pz + tz * w], [px - tx * w, y + h + 0.1, pz - tz * w], col, [nx, 0, nz]);
  }
}
// A gas lantern glowing after dark (aux -2, as every city's lamp heads), its cap and finial.
function vicLantern(s: Batch, x: number, y: number, z: number, r = 0.2) {
  s.aux.set(0, 0, -2); s.box(x, y, z, r * 1.6, r * 2.4, r * 1.6, VIC.lamp); s.aux.set(0, 0, -1);
  s.cone(x, y + r * 1.6, z, r * 1.2, r * 0.9, VIC.black, 4, 0, Math.PI / 4);
}
// A dormer on a slope: its front wall (a window from the sash tile) at z, w across, h tall from y.
function vicDormer(s: Batch, x: number, z: number, y: number, w: number, h: number, wall: number, roof: number, back = 1.4) {
  s.box(x, y + h / 2, z + back / 2, w, h, back, wall);
  s.wall(x + w / 2, z - 0.01, x - w / 2, z - 0.01, y + 0.05, y + h - 0.05, wall, FACADE.VICT_SASH, 0.2, 0.6, 0.15, 0.7);
  s.prism(x, y + h + w * 0.22, z + back / 2 - 0.05, back + 0.2, w * 0.44, w + 0.25, roof, Math.PI / 2);
}

// ---- lots -------------------------------------------------------------------------------------
// vicLot draws a lot's building on b (in its face's frame, the street at -z, the ground at y0) for
// its district: a terrace house behind its area railings, a shop under its fascia, a grand
// building downtown (as tall as hs, downtown's height there, allows), a warehouse or mill in
// industry, a park's bandstand or pavilion. It records its front door with `door`.
export function vicLot(s: Batch, b: VicRect, y0: number, district: VicDistrict, hs: number, walls: readonly number[], rnd: VicRand, door: VicDoor) {
  if (district === "industrial") { vicWorks(s, b, y0, vRange(rnd, 6, 9), vPick(rnd, walls), rnd, door); return; }
  if (district === "park") { vicParkLot(s, b, y0, rnd, door); return; }
  if (district === "commercial") { vicShopRow(s, b, y0, walls, rnd, door); return; }
  if (district === "downtown") { vicGrandLot(s, b, y0, hs, walls, rnd, door); return; }
  if (b.x1 - b.x0 < 9.4 && rnd() < 0.55) vicVilla(s, b, y0, walls, rnd, door);
  else vicTerrace(s, b, y0, walls, rnd, door);
}

// A terrace: one or two houses across the lot (two when it is 10 m wide), each with its door beside
// the party wall it shares with the next, a canted bay in the other bay, two or three storeys of
// sash windows, the ground floor often stuccoed. A sunken area with railings lies in front, bridged
// to each door by a step; a slate roof with its ridge along the street, a chimney stack on each party
// wall and now and then a dormer.
function vicTerrace(s: Batch, b: VicRect, y0: number, walls: readonly number[], rnd: VicRand, door: VicDoor) {
  const X0 = b.x0 - 0.26, X1 = b.x1 + 0.26, W = X1 - X0, D = b.z1 - b.z0;
  const area = D >= 7 ? 1.4 : D >= 5.5 ? 0.9 : 0, zf = b.z0 + area, hd = Math.min(D - area, 9.5), zb = zf + hd;
  const n = W >= 10 ? 2 : 1, hw = W / n, storeys = rnd() < 0.5 ? 3 : 2, fh = 3.15 + (rnd() - 0.5) * 0.1;
  const brick = vPick(rnd, walls), render = vIsRender(brick), stuccoGround = !render && rnd() < 0.6;
  const groundCol = stuccoGround ? VIC.stucco : brick, vUp = (render ? 2 : 0) + (rnd() < 0.5 ? 1 : 0), vGround = (render || stuccoGround ? 2 : 0) + (rnd() < 0.5 ? 1 : 0);
  const roof = vPick(rnd, VIC_SLATES), bays2 = rnd() < 0.75, dormers = storeys === 2 && rnd() < 0.5;
  const doors: number[] = [], rec = Math.floor(rnd() * n);
  let top = y0;
  for (let i = 0; i < n; i++) {
    const hx0 = X0 + i * hw, hx1 = hx0 + hw, bays = vicBays(hx0, hx1);
    // (Paired: the first house's door is at its x1 end, the second's at its x0 end, beside each other.)
    const dk = bays >= 3 ? Math.floor(bays / 2) : n === 2 ? (i === 0 ? 0 : bays - 1) : bays - 1;
    const bands: VicBand[] = [{ tile: FACADE.VICT_SASH, v: vGround, floors: 1, floorH: fh + 0.25, color: groundCol }, { tile: FACADE.VICT_SASH, v: vUp, floors: storeys - 1, floorH: fh }];
    top = vicBox(s, hx0, zf, hx1, zb, y0, bands, brick, [{ k: dk, tile: FACADE.VICT_DOOR, v: vGround }]);
    const [d0, d1] = vicBayX(hx0, hx1, dk), dm = (d0 + d1) / 2;
    doors.push(dm);
    if (i === rec) door(d0, d1, zf);
    // the bay windows in the other bays
    for (let k = 0; k < bays; k++) {
      if (k === dk || bays < 2) continue;
      const [a0, a1] = vicBayX(hx0, hx1, k);
      vicBayWindow(s, a0 + 0.2, a1 - 0.2, zf, y0, bays2 ? 2 : 1, fh + (bays2 ? 0 : 0.25), Math.min(0.75, area > 0 ? area - 0.3 : 0.6), groundCol, FACADE.VICT_SASH, vGround, VIC.lead);
    }
    // the step to the door, bridging the area, and the door's flags
    s.box(dm, y0 + 0.07, (b.z0 + zf) / 2 - 0.05, 1.3, 0.14, zf - b.z0 + 0.1, VIC.flag);
    if (dormers) vicDormer(s, (vicBayX(hx0, hx1, dk === 0 ? bays - 1 : 0)[0] + vicBayX(hx0, hx1, dk === 0 ? bays - 1 : 0)[1]) / 2, zf + 0.9, top + 0.25, 1.3, 1.3, VIC.white, roof);
  }
  // the cornice, the roof and the stacks on the party walls (clear of the neighbours' at the lot's ends)
  s.box((X0 + X1) / 2, top - 0.15, zf - 0.12, W - 0.02, 0.3, 0.3, vicShade(render ? brick : VIC.stucco, 0.92));
  const rh = Math.min(3.4, hd * 0.38);
  vicGable(s, X0, zf, X1, zb, top, rh, roof, brick);
  for (let i = 0; i <= n; i++) {
    const x = vClamp(X0 + i * hw, X0 + 0.5, X1 - 0.5);
    vicStack(s, x, zf + hd / 2, top + rh * 0.55, 0.7, 1.5, rh * 0.45 + 1.2, brick, 2 + Math.floor(rnd() * 3));
  }
  // the area, sunk, behind its railings
  if (area > 0) {
    s.box((X0 + X1) / 2, y0 + 0.012, (b.z0 + zf) / 2 + 0.05, W - 0.1, 0.02, zf - b.z0 - 0.1, VIC.soot);
    vicRailings(s, X1 - 0.08, b.z0 + 0.1, X0 + 0.08, b.z0 + 0.1, y0, 1.0, VIC.black, doors.map((x) => [X1 - 0.08 - x - 0.75, X1 - 0.08 - x + 0.75] as [number, number]));
  }
}
// A villa: a detached house set back behind a garden wall and railings, double-fronted (its door
// in the middle under a gabled porch), two-storey canted bays either side, a hipped or front-gabled
// slate roof with tall stacks at the ends.
function vicVilla(s: Batch, b: VicRect, y0: number, walls: readonly number[], rnd: VicRand, door: VicDoor) {
  const W = b.x1 - b.x0, D = b.z1 - b.z0, set = D >= 8 ? 2.2 : D >= 6 ? 1.2 : 0;
  const x0 = b.x0 + 0.4, x1 = b.x1 - 0.4, zf = b.z0 + set + 0.8, zb = Math.min(b.z1, zf + 8);
  const wall = vPick(rnd, walls), render = vIsRender(wall), v = (render ? 2 : 0) + (rnd() < 0.5 ? 1 : 0), fh = 3.2 + (rnd() - 0.5) * 0.1;
  const roof = vPick(rnd, VIC_SLATES), bays = vicBays(x0, x1), dk = Math.floor(bays / 2);
  const top = vicBox(s, x0, zf, x1, zb, y0, [{ tile: FACADE.VICT_SASH, v, floors: 2, floorH: fh }], wall, [{ k: dk, tile: FACADE.VICT_DOOR, v }]);
  const [d0, d1] = vicBayX(x0, x1, dk);
  door(d0, d1, zf);
  for (const k of [0, bays - 1]) {
    if (k === dk) continue;
    const [a0, a1] = vicBayX(x0, x1, k);
    vicBayWindow(s, a0 + 0.15, a1 - 0.15, zf, y0, 2, fh, 0.85, wall, FACADE.VICT_SASH, v, roof);
  }
  // the porch over the door: a little gable on two brackets
  const dm = (d0 + d1) / 2;
  vicGable(s, dm - 0.85, zf - 1.0, dm + 0.85, zf, y0 + 2.75, 0.7, roof, VIC.white, true, 0.1);
  s.box(dm, y0 + 0.08, zf - 0.5, 1.6, 0.16, 1.0, VIC.flag);
  // the roof: a gable to the street on half of them, else hipped
  const w = x1 - x0, d = zb - zf;
  if (rnd() < 0.5) {
    vicGable(s, x0, zf, x1, zb, top, w * 0.42, roof, wall, true, 0.35);
    s.box((x0 + x1) / 2, top + 0.2, zf - 0.38, w * 0.85, 0.14, 0.06, VIC.white);   // the bargeboard's foot
  } else vicHip(s, x0 - 0.3, zf - 0.3, x1 + 0.3, zb + 0.3, top, Math.min(w, d) * 0.42, roof);
  for (const x of [x0 + 0.5, x1 - 0.5]) vicStack(s, x, (zf + zb) / 2 + 1, top, 0.7, 1.3, Math.min(w, d) * 0.42 + 1.0, wall, 2);
  // the front garden: a low wall with railings on it, a gap at the path, the path
  if (set > 0) {
    const gz = b.z0 + 0.12, gaps: [number, number][] = [[x1 + 0.4 - dm - 0.8, x1 + 0.4 - dm + 0.8]];
    for (const [t0, t1] of [[0, gaps[0][0]], [gaps[0][1], W]]) s.box(x1 + 0.4 - (t0 + t1) / 2, y0 + 0.25, gz, t1 - t0, 0.5, 0.3, render ? VIC.stucco : wall);
    vicRailings(s, b.x1, gz, b.x0, gz, y0 + 0.5, 0.75, VIC.black, gaps, 0.5);
    s.box(dm, y0 + 0.01, (gz + zf) / 2, 1.4, 0.02, zf - gz, VIC.flag);
  }
}

// A shop row: one or two shops across the lot under one cornice, each with its painted timber
// shopfront (a fascia over plate glass, its door at one end), two or three storeys of sash windows
// over it, a parapet and a slate roof behind, stacks on the party walls; a striped blind out over
// the pavement now and then. Now and then it is a public house instead: glazed tiles in a dark
// colour round its windows, a gilt fascia, its lamp on an iron bracket and its sign.
function vicShopRow(s: Batch, b: VicRect, y0: number, walls: readonly number[], rnd: VicRand, door: VicDoor) {
  const X0 = b.x0 - 0.26, X1 = b.x1 + 0.26, W = X1 - X0, D = b.z1 - b.z0, zf = b.z0, hd = Math.min(D, 12), zb = zf + hd;
  const pub = rnd() < 0.17, n = !pub && W >= 10 ? 2 : 1, uw = W / n, uppers = pub ? 2 : 1 + Math.floor(rnd() * 2.6);
  const wall = vPick(rnd, walls), render = vIsRender(wall), vUp = (render ? 2 : 0) + (rnd() < 0.5 ? 1 : 0), roof = vPick(rnd, VIC_SLATES);
  const gH = 4.1 + (rnd() - 0.5) * 0.1, fh = 3.3;
  const rec = Math.floor(rnd() * n), mans = !pub && uppers >= 2 && rnd() < 0.3;
  let top = y0;
  for (let i = 0; i < n; i++) {
    const ux0 = X0 + i * uw, ux1 = ux0 + uw, bays = vicBays(ux0, ux1);
    const dk = n === 2 ? (i === 0 ? 0 : bays - 1) : rnd() < 0.5 ? 0 : bays - 1;
    const vS = Math.floor(rnd() * 4), gc = pub ? vPick(rnd, [VIC.maroon, VIC.green, VIC.navy, 0x3a2a22]) : undefined;
    const bands: VicBand[] = [{ tile: FACADE.VICT_SHOPWIN, v: vS, floors: 1, floorH: gH, color: gc }, { tile: FACADE.VICT_SASH, v: vUp, floors: uppers, floorH: fh }];
    top = vicBox(s, ux0, zf, ux1, zb, y0, bands, wall, [{ k: dk, tile: FACADE.VICT_SHOP, v: vS }]);
    const [d0, d1] = vicBayX(ux0, ux1, dk);
    if (i === rec) door(d0, d1, zf);
    // the shop's blind, rolled out over the pavement: canvas in stripes on a sloping frame
    if (!pub && rnd() < 0.45) {
      const c = vPick(rnd, [VIC.green, VIC.maroon, VIC.navy, 0x8a6a2a, 0x7a3a2a]), ns = Math.max(4, Math.round((uw - 0.4) / 0.62)), sw = (uw - 0.4) / ns;
      for (let k = 0; k < ns; k++) s.boxR(ux0 + 0.2 + (k + 0.5) * sw, y0 + gH - 1.05, zf - 0.78, sw - 0.004, 0.05, 1.6, k % 2 ? VIC.canvas : c, -0.36, 0, 0);
      s.box((ux0 + ux1) / 2, y0 + gH - 1.45, zf - 1.52, uw - 0.4, 0.22, 0.03, c);
    }
  }
  // the cornice and the parapet over it, the roof behind and the stacks
  const cc = vicShade(render ? wall : VIC.stone, 0.95);
  s.box((X0 + X1) / 2, top - 0.2, zf - 0.15, W - 0.02, 0.36, 0.34, cc);
  if (mans) {
    const t2 = vicMansard(s, X0 + 0.02, zf + 0.25, X1 - 0.02, zb - 0.02, top, 2.6, 0.75, roof);
    for (let i = 0; i < vicBays(X0, X1); i++) { const [a0, a1] = vicBayX(X0, X1, i); vicDormer(s, (a0 + a1) / 2, zf + 0.45, top + 0.5, 1.2, 1.5, VIC.white, roof, 0.9); }
    void t2;
  } else {
    s.box((X0 + X1) / 2, top + 0.4, zf + 0.12, W - 0.02, 0.8, 0.24, wall);
    vicGable(s, X0, zf + 0.3, X1, zb, top, Math.min(3, (hd - 0.3) * 0.32), roof, wall, false, 0.1);
  }
  const rh = mans ? 3.2 : Math.min(3, (hd - 0.3) * 0.32);
  for (let i = 0; i <= n; i++) vicStack(s, vClamp(X0 + i * uw, X0 + 0.5, X1 - 0.5), zf + hd * 0.55, top + rh * 0.4, 0.7, 1.6, rh * 0.6 + 1.1, wall, 2 + Math.floor(rnd() * 3));
  if (pub) {
    // the pub's lamp on its bracket at the corner, and its sign hung from an iron arm above
    const x = rnd() < 0.5 ? X0 + 0.4 : X1 - 0.4, sx = x === X0 + 0.4 ? -1 : 1;
    s.box(x, y0 + gH + 0.35, zf - 0.45, 0.06, 0.06, 0.9, VIC.black);
    vicLantern(s, x, y0 + gH + 0.05, zf - 0.9, 0.24);
    s.box(x - sx * 0.2, y0 + gH + fh * 0.8, zf - 0.7, 0.06, 0.06, 1.4, VIC.black);
    s.box(x - sx * 0.2, y0 + gH + fh * 0.8 - 0.62, zf - 0.95, 0.07, 1.05, 0.9, vPick(rnd, [VIC.maroon, VIC.green, VIC.navy]));
    s.box(x - sx * 0.2, y0 + gH + fh * 0.8 - 0.62, zf - 0.95, 0.05, 1.15, 1.0, VIC.gilt);
  }
}

// Downtown's grand buildings, as tall as hs allows: a bank behind its portico of columns under a
// pediment, a department store with a dome on its corner, a Gothic office front of pointed windows
// under gablets and a turret, or chambers in stone under a mansard with its dormers.
function vicGrandLot(s: Batch, b: VicRect, y0: number, hs: number, walls: readonly number[], rnd: VicRand, door: VicDoor) {
  const X0 = b.x0 - 0.26, X1 = b.x1 + 0.26, W = X1 - X0, D = b.z1 - b.z0;
  const floors = vClamp(Math.round(3 + hs * 3 + (rnd() - 0.4) * 1.4), 3, 6), r = rnd();
  const kind = W >= 15 && r < 0.28 ? "bank" : r < 0.5 ? "store" : r < 0.75 ? "gothic" : "chambers";
  const roof = vPick(rnd, VIC_SLATES), lightWalls = walls.filter(vIsRender), stoneC = lightWalls.length ? vPick(rnd, lightWalls) : VIC.stone;
  if (kind === "bank") {
    // (Stone, two tall storeys and an attic, the portico before its middle bays.)
    const zf = b.z0 + 2.0, zb = Math.min(b.z1, zf + 14), bays = vicBays(X0, X1), dk = Math.floor(bays / 2), v = Math.floor(rnd() * 4);
    const top = vicBox(s, X0, zf, X1, zb, y0, [{ tile: FACADE.VICT_GRAND, v, floors: 1, floorH: 5.2 }, { tile: FACADE.VICT_GRAND, v, floors: Math.max(1, floors - 2), floorH: 4.4 }], stoneC, [{ k: dk, tile: FACADE.VICT_DOOR, v: 2 + (v % 2) }]);
    const [d0, d1] = vicBayX(X0, X1, dk);
    door(d0, d1, zf);
    const pw = Math.min(W - 1, (bays >= 5 ? 3 : bays >= 3 ? 3 : 1) * (W / bays) + 0.6), pc = (d0 + d1) / 2, ph = 5.2 + 4.4 - 0.4;
    s.box(pc, y0 + 0.15, zf - 1.0, pw + 0.6, 0.3, 2.1, vicShade(stoneC, 0.92));
    const nc = pw > 9 ? 6 : 4;
    for (let i = 0; i < nc; i++) {
      const x = pc - pw / 2 + 0.4 + (pw - 0.8) * i / (nc - 1);
      s.cyl(x, y0 + 0.3 + (ph - 0.3) / 2, zf - 1.55, 0.32, ph - 0.3, vicShade(stoneC, 1.04), 8);
      s.box(x, y0 + ph - 0.15, zf - 1.55, 0.85, 0.3, 0.85, vicShade(stoneC, 0.95));
    }
    s.box(pc, y0 + ph + 0.45, zf - 1.0, pw + 0.3, 0.9, 2.2, vicShade(stoneC, 0.97));
    vicGable(s, pc - pw / 2 - 0.1, zf - 2.05, pc + pw / 2 + 0.1, zf + 0.2, y0 + ph + 0.9, 1.6, vicShade(stoneC, 0.9), stoneC, true, 0.0);
    // the balustrade and the low roof behind it
    s.box((X0 + X1) / 2, top + 0.5, zf + 0.12, W - 0.02, 1.0, 0.25, vicShade(stoneC, 0.97));
    s.box((X0 + X1) / 2, top - 0.25, zf - 0.12, W - 0.02, 0.4, 0.3, vicShade(stoneC, 0.9));
    vicHip(s, X0 + 0.3, zf + 0.4, X1 - 0.3, zb - 0.3, top, 2.2, roof);
    return;
  }
  const zf = b.z0, zb = Math.min(b.z1, zf + 15), bays = vicBays(X0, X1);
  if (kind === "store") {
    // (Shopfronts all along, three to five storeys over, a mansard, and on one corner a dome.)
    const wall = vPick(rnd, walls), dk = Math.floor(bays / 2), vS = Math.floor(rnd() * 4), v = Math.floor(rnd() * 4);
    const up = Math.max(2, floors - 1);
    const top = vicBox(s, X0, zf, X1, zb, y0, [{ tile: FACADE.VICT_SHOPWIN, v: vS, floors: 1, floorH: 4.6 }, { tile: rnd() < 0.5 ? FACADE.VICT_GRAND : FACADE.VICT_SASH, v, floors: up, floorH: 3.7 }], wall, [{ k: dk, tile: FACADE.VICT_SHOP, v: vS }]);
    const [d0, d1] = vicBayX(X0, X1, dk);
    door(d0, d1, zf);
    s.box((X0 + X1) / 2, top - 0.25, zf - 0.2, W - 0.02, 0.5, 0.44, VIC.stone);
    const m = vicMansard(s, X0 + 0.02, zf + 0.02, X1 - 0.02, zb - 0.02, top, 3.0, 0.9, roof);
    for (let i = 0; i < bays; i++) { const [a0, a1] = vicBayX(X0, X1, i); if (i === 0 || i === bays - 1) continue; vicDormer(s, (a0 + a1) / 2, zf + 0.35, top + 0.4, 1.3, 1.8, VIC.stone, roof, 1.0); }
    // the corner dome: a drum, the dome in copper gone green, a lantern and its finial
    const cx = rnd() < 0.5 ? X0 + 2.4 : X1 - 2.4, cz = zf + 2.4;
    s.cyl(cx, top + 1.6, cz, 2.5, 3.2, VIC.stone, 10);
    s.cyl(cx, top + 3.3, cz, 2.75, 0.25, vicShade(VIC.stone, 0.9), 10);
    s.lathe("vicDome", VIC_DOME, cx, top + 3.4, cz, 2.5, 3.4, VIC.copper, 10);
    s.cyl(cx, top + 7.1, cz, 0.5, 1.0, VIC.stone, 6); s.cone(cx, top + 8.0, cz, 0.55, 0.8, VIC.copper, 6); s.cyl(cx, top + 8.9, cz, 0.05, 1.2, VIC.black, 4);
    void m;
    return;
  }
  if (kind === "gothic") {
    // (Red or stock brick, pointed windows, a steep roof with a gablet over each pair of bays, a
    // turret with its spire on one corner.)
    const wall = vPick(rnd, walls.filter((c) => !vIsRender(c)).concat([VIC.red])), v = Math.floor(rnd() * 4), dk = Math.floor(bays / 2);
    const top = vicBox(s, X0, zf, X1, zb, y0, [{ tile: FACADE.VICT_GOTHIC, v, floors: 1, floorH: 4.4 }, { tile: FACADE.VICT_GOTHIC, v, floors: floors - 1, floorH: 3.7 }], wall, [{ k: dk, tile: FACADE.VICT_DOOR, v: v % 2 }]);
    const [d0, d1] = vicBayX(X0, X1, dk);
    door(d0, d1, zf);
    const rh = Math.min(6, (zb - zf) * 0.45);
    vicGable(s, X0, zf, X1, zb, top, rh, roof, wall, false, 0.2);
    const bw = W / bays;
    for (let i = 0; i + 1 < bays; i += 2) {
      const gx0 = X1 - (i + 2) * bw + 0.3, gx1 = X1 - i * bw - 0.3;
      s.box((gx0 + gx1) / 2, top + 0.9, zf + 0.05, gx1 - gx0, 1.8, 0.3, wall);
      vicGable(s, gx0, zf - 0.1, gx1, zf + 2.6, top + 1.8, (gx1 - gx0) * 0.6, roof, wall, true, 0.15);
    }
    const tx = rnd() < 0.5 ? X0 + 1.2 : X1 - 1.2;
    s.cyl(tx, top + 1.5, zf + 1.2, 1.3, 3.0 + 3, wall, 8);
    s.cone(tx, top + 4.5 + 2.6, zf + 1.2, 1.5, 5.2, roof, 8);
    s.cyl(tx, top + 4.5 + 5.6, zf + 1.2, 0.05, 1.0, VIC.black, 4);
    return;
  }
  // chambers: stone or stucco, the grand windows, a heavy cornice, a mansard with dormers
  const v = Math.floor(rnd() * 4), dk = Math.floor(bays / 2);
  const top = vicBox(s, X0, zf, X1, zb, y0, [{ tile: FACADE.VICT_GRAND, v, floors: 1, floorH: 4.6 }, { tile: FACADE.VICT_GRAND, v, floors: floors - 1, floorH: 3.8 }], stoneC, [{ k: dk, tile: FACADE.VICT_DOOR, v: 2 + (v % 2) }]);
  const [d0, d1] = vicBayX(X0, X1, dk);
  door(d0, d1, zf);
  s.box((X0 + X1) / 2, top - 0.25, zf - 0.22, W - 0.02, 0.5, 0.5, vicShade(stoneC, 0.9));
  vicMansard(s, X0 + 0.02, zf + 0.02, X1 - 0.02, zb - 0.02, top, 3.0, 0.95, roof);
  for (let i = 0; i < bays; i++) { const [a0, a1] = vicBayX(X0, X1, i); vicDormer(s, (a0 + a1) / 2, zf + 0.45, top + 0.45, 1.2, 1.7, stoneC, roof, 1.0); }
  for (const x of [X0 + 0.8, X1 - 0.8]) vicStack(s, x, (zf + zb) / 2, top + 2.0, 0.8, 2.2, 2.6, stoneC, 4);
}
// A dome's profile (Batch.lathe): a little upright at its foot, then round to the lantern's ring.
const VIC_DOME: readonly (readonly [number, number])[] = [[1, 0], [1, 0.12], [0.94, 0.38], [0.78, 0.62], [0.5, 0.86], [0.22, 1]];
// A bandstand's roof (Batch.lathe): an ogee, swept out at the eaves and up to a point.
const VIC_OGEE: readonly (readonly [number, number])[] = [[1, 0], [0.86, 0.14], [0.62, 0.32], [0.46, 0.54], [0.3, 0.8], [0.06, 1]];

// A park's lot: a cast-iron bandstand's roof over a kiosk for refreshments (its door to the path),
// or a pavilion with a veranda along its front and a clock in its gable.
function vicParkLot(s: Batch, b: VicRect, y0: number, rnd: VicRand, door: VicDoor) {
  const W = b.x1 - b.x0, D = b.z1 - b.z0, cx = (b.x0 + b.x1) / 2;
  if (rnd() < 0.55) {
    const R = vClamp(Math.min(W, D) / 2 - 0.9, 1.9, 2.8), n = 8, step = Math.PI * 2 / n, rot = -Math.PI / 2 - step / 2, cz = b.z0 + 1.1 + R;
    const top = facadePrism(s, cx, cz, R, n, rot, y0 + 0.35, [{ tile: FACADE.VICT_SHOPWIN, floors: 1, floorH: 2.9 }], VIC.green, 0, FACADE.VICT_DOOR);
    s.cyl(cx, y0 + 0.17, cz, R + 1.15, 0.34, VIC.flag, 8, 0, 0, Math.PI / 2 - rot);
    const front = cz - R * Math.cos(Math.PI / n);
    door(cx - 0.5, cx + 0.5, front);
    // the iron columns round it, the frieze and the roof
    for (let i = 0; i < n; i++) { const a = rot + i * step; s.cyl(cx + Math.cos(a) * (R + 0.95), y0 + 0.35 + 1.6, cz + Math.sin(a) * (R + 0.95), 0.07, 3.2, VIC.green, 4); }
    s.cyl(cx, top + 0.45, cz, R + 1.2, 0.35, VIC.cream, 8, 0, 0, Math.PI / 2 - rot);
    s.lathe("vicOgee", VIC_OGEE, cx, top + 0.62, cz, R + 1.35, 2.6, VIC.green, 8, Math.PI / 8 - rot);
    s.cyl(cx, top + 3.4, cz, 0.05, 0.9, VIC.gilt, 4); s.ico(cx, top + 3.9, cz, 0.16, VIC.gilt);
    return;
  }
  const x0 = b.x0 + 0.2, x1 = b.x1 - 0.2, zf = b.z0 + 1.6, zb = Math.min(b.z1 + 0.3, zf + 4.6);
  const bays = vicBays(x0, x1), dk = Math.floor(bays / 2), wall = vPick(rnd, [VIC.cream, VIC.stucco, 0xd8c8a0]);
  const top = vicBox(s, x0, zf, x1, zb, y0 + 0.3, [{ tile: FACADE.VICT_SHOPWIN, v: Math.floor(rnd() * 4), floors: 1, floorH: 3.3 }], wall, [{ k: dk, tile: FACADE.VICT_DOOR, v: 2 }]);
  const [d0, d1] = vicBayX(x0, x1, dk);
  door(d0, d1, zf);
  s.box((x0 + x1) / 2, y0 + 0.15, zf - 0.8, x1 - x0 + 0.4, 0.3, 1.8, VIC.oak);
  // the veranda: a sloping roof on iron posts, the main roof, a gable over the door with a clock
  for (let i = 0; i <= bays; i++) s.cyl(x0 + (x1 - x0) * i / bays, y0 + 0.3 + 1.4, zf - 1.5, 0.06, 2.8, VIC.green, 4);
  s.boxR((x0 + x1) / 2, y0 + 3.25, zf - 0.8, x1 - x0 + 0.4, 0.1, 1.9, VIC.green, -0.28, 0, 0);
  vicHip(s, x0 - 0.3, zf - 0.2, x1 + 0.3, zb + 0.3, top, 2.2, vPick(rnd, VIC_SLATES));
  const dm = (d0 + d1) / 2;
  vicGable(s, dm - 1.4, zf - 0.3, dm + 1.4, zf + 2.2, top - 0.1, 1.9, VIC.slateDark, wall, true, 0.15);
  s.cyl(dm, top + 0.6, zf - 0.35, 0.42, 0.06, VIC.white, 12, Math.PI / 2);
  s.box(dm + 0.12, top + 0.62, zf - 0.39, 0.22, 0.04, 0.02, VIC.black); s.box(dm, top + 0.72, zf - 0.39, 0.04, 0.22, 0.02, VIC.black);
  s.cyl(dm, top + 2.4, zf + 1.0, 0.04, 1.1, VIC.black, 4);
}

// ---- block middles ----------------------------------------------------------------------------
// vicTower draws a downtown block's middle building, standing on its own on b (no door): a
// grand civic building, a church with its spire or a department store with its corner dome.
export function vicTower(s: Batch, b: VicRect, y0: number, hs: number, walls: readonly number[], rnd: VicRand) {
  const r = rnd();
  if (r < 0.42) vicChurch(s, b, y0, rnd);
  else if (r < 0.7) vicTownHall(s, b, y0, hs, walls, rnd);
  else vicGrandBlock(s, b, y0, hs, walls, rnd);
}
// A church: its nave under a steep slate roof, lower aisles either side, a chancel at the east end,
// and at the west end its tower with a broach spire, pinnacles at the corners and a weathercock.
function vicChurch(s: Batch, b: VicRect, y0: number, rnd: VicRand) {
  const W = b.x1 - b.x0, D = b.z1 - b.z0, along = D >= W, L = Math.min(along ? D : W, 34) - 1, B = Math.min(along ? W : D, 18) - 1;
  const stone = vPick(rnd, [VIC.stone, 0xc8b48e, 0xb8a888, 0xa89880]), roof = vPick(rnd, VIC_SLATES), v = Math.floor(rnd() * 4);
  // (Drawn along x from -L/2, the tower's end, then turned to lie along the block's longer side.)
  const F = { ox: (b.x0 + b.x1) / 2, oz: (b.z0 + b.z1) / 2, rot: along ? Math.PI / 2 : 0 }, n0 = s.mark(), nave = Math.min(9.5, B * 0.55), aisle = Math.min(3.6, (B - nave) / 2), tw = 5.2, x0 = -L / 2 + tw, xc = L / 2 - 6;
  PLACED.frames.push(F);   // (so the footprints it leaves for the trees are where it ends up)
  const nh = 9.6, top = vicBox(s, x0, -nave / 2, xc, nave / 2, y0, [{ tile: FACADE.VICT_GOTHIC, v, floors: 2, floorH: nh / 2 }], stone);
  vicGable(s, x0, -nave / 2, xc, nave / 2, top, nave * 0.75, roof, stone, false, 0.3);
  if (aisle > 1.5) for (const k of [-1, 1]) {
    const za = k * (nave / 2 + aisle / 2);
    vicBox(s, x0 + 0.5, za - aisle / 2, xc - 0.5, za + aisle / 2, y0, [{ tile: FACADE.VICT_GOTHIC, v, floors: 1, floorH: 4.6 }], stone);
    s.boxR((x0 + xc) / 2, y0 + 4.6 + 0.85, za + k * 0.15, xc - x0 - 0.6, 0.12, aisle + 0.6, roof, k * 0.48, 0, 0);
  }
  const cw = nave * 0.7, ch = 7;
  vicBox(s, xc, -cw / 2, L / 2, cw / 2, y0, [{ tile: FACADE.VICT_GOTHIC, v, floors: 1, floorH: ch }], stone);
  vicGable(s, xc, -cw / 2, L / 2, cw / 2, y0 + ch, cw * 0.75, roof, stone, false, 0.25);
  // the tower: three stages, the belfry's louvres, a parapet, pinnacles and the spire
  const tx = -L / 2 + tw / 2, th = Math.min(26, 18 + B * 0.5);
  const tt = vicBox(s, tx - tw / 2, -tw / 2, tx + tw / 2, tw / 2, y0, [{ tile: FACADE.VICT_GOTHIC, v, floors: 3, floorH: th / 3 }], stone);
  s.box(tx, tt + 0.4, 0, tw + 0.4, 0.8, tw + 0.4, vicShade(stone, 0.9));
  for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { s.box(tx + px * tw / 2, tt + 1.2, pz * tw / 2, 0.5, 1.6, 0.5, stone); s.cone(tx + px * tw / 2, tt + 2.8, pz * tw / 2, 0.38, 1.8, stone, 4, 0, Math.PI / 4); }
  const sh = th * 1.05;
  s.cone(tx, tt + 0.8 + sh / 2, 0, tw * 0.5, sh, roof, 8, 0, Math.PI / 8);
  s.cyl(tx, tt + 0.8 + sh + 0.5, 0, 0.05, 1.4, VIC.black, 4); s.box(tx + 0.25, tt + 0.8 + sh + 1.0, 0, 0.6, 0.25, 0.05, VIC.gilt);
  PLACED.frames.pop();
  s.transformFrom(n0, F);
}
// A town hall: three storeys of stone with grand windows, a mansard, and in the middle of its front
// a clock tower rising through the roof to an open belfry under a dome.
function vicTownHall(s: Batch, b: VicRect, y0: number, hs: number, walls: readonly number[], rnd: VicRand) {
  const W = Math.min(b.x1 - b.x0, 40), D = Math.min(b.z1 - b.z0, 26), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2;
  const lw = walls.filter(vIsRender), stone = lw.length ? vPick(rnd, lw) : VIC.stone, roof = vPick(rnd, VIC_SLATES), v = Math.floor(rnd() * 4);
  const floors = 3 + (hs > 0.6 ? 1 : 0);
  const top = vicBox(s, x0, z0, x1, z1, y0, [{ tile: FACADE.VICT_GRAND, v, floors: 1, floorH: 5, color: vicShade(stone, 0.86) }, { tile: FACADE.VICT_GRAND, v, floors: floors - 1, floorH: 4.4 }], stone);
  s.box(cx, top - 0.25, cz, W + 0.4, 0.5, D + 0.4, vicShade(stone, 0.9));
  s.box(cx, y0 + 5.0, cz, W + 0.24, 0.3, D + 0.24, vicShade(stone, 0.92));   // the string course over the rusticated ground floor
  vicMansard(s, x0 + 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2, top, 3.2, 1.1, roof);
  // the clock tower, square, its clock on each face, the belfry and the dome
  const t = 6.2, ty = vicBox(s, cx - t / 2, z0 - 0.6, cx + t / 2, z0 - 0.6 + t, y0, [{ tile: FACADE.VICT_GRAND, v, floors: 1, floorH: 5, color: vicShade(stone, 0.86) }, { tile: FACADE.VICT_GRAND, v, floors: floors + 2, floorH: 4.4 }], stone);
  const tzc = z0 - 0.6 + t / 2, cy = ty + 1.8;
  vicBox(s, cx - t / 2 + 0.1, tzc - t / 2 + 0.1, cx + t / 2 - 0.1, tzc + t / 2 - 0.1, ty, [{ tile: FACADE.VICT_GRAND, v, floors: 1, floorH: 3.6 }], stone);
  for (const [nx, nz] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
    const fx = cx + nx * (t / 2 + 0.02), fz = tzc + nz * (t / 2 + 0.02), rot = nx !== 0 ? Math.PI / 2 : 0;
    s.cyl(fx, cy, fz, 1.5, 0.08, VIC.gilt, 16, Math.PI / 2, 0, rot);
    s.cyl(fx + nx * 0.03, cy, fz + nz * 0.03, 1.3, 0.08, VIC.white, 16, Math.PI / 2, 0, rot);
    s.box(fx + nx * 0.08 + (nz !== 0 ? 0.3 : 0), cy + 0.1, fz + nz * 0.08 + (nx !== 0 ? 0.3 : 0), nz !== 0 ? 0.7 : 0.03, 0.1, nx !== 0 ? 0.7 : 0.03, VIC.black);
    s.box(fx + nx * 0.08, cy + 0.45, fz + nz * 0.08, nz !== 0 ? 0.08 : 0.03, 0.95, nx !== 0 ? 0.08 : 0.03, VIC.black);
  }
  const by = ty + 3.6;
  s.box(cx, by + 0.2, tzc, t + 0.3, 0.4, t + 0.3, vicShade(stone, 0.9));
  for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.box(cx + px * (t / 2 - 0.5), by + 2.0, tzc + pz * (t / 2 - 0.5), 0.8, 3.2, 0.8, stone);
  s.box(cx, by + 3.8, tzc, t, 0.5, t, vicShade(stone, 0.92));
  s.lathe("vicDome", VIC_DOME, cx, by + 4.05, tzc, t / 2 - 0.2, 4.2, VIC.copper, 10);
  s.cyl(cx, by + 8.4, tzc, 0.05, 1.6, VIC.black, 4); s.ico(cx, by + 9.3, tzc, 0.22, VIC.gilt);
}
// A grand block (an hotel, an exchange): five or six storeys of grand windows in stone or stucco,
// a mansard, and a pavilion at each end of its front rising a storey higher to a tall pavilion roof
// with iron cresting.
function vicGrandBlock(s: Batch, b: VicRect, y0: number, hs: number, walls: readonly number[], rnd: VicRand) {
  const W = Math.min(b.x1 - b.x0, 44), D = Math.min(b.z1 - b.z0, 28), cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  const x0 = cx - W / 2, x1 = cx + W / 2, z0 = cz - D / 2, z1 = cz + D / 2;
  const wall = vPick(rnd, walls), roof = vPick(rnd, VIC_SLATES), v = Math.floor(rnd() * 4), floors = vClamp(Math.round(4 + hs * 2), 4, 6);
  const ground = vIsRender(wall) ? vicShade(wall, 0.86) : VIC.stone;
  const top = vicBox(s, x0, z0, x1, z1, y0, [{ tile: FACADE.VICT_GRAND, v, floors: 1, floorH: 4.8, color: ground }, { tile: FACADE.VICT_GRAND, v, floors: floors - 1, floorH: 3.8 }], wall);
  s.box(cx, top - 0.25, cz, W + 0.45, 0.5, D + 0.45, vicShade(VIC.stone, 0.95));
  s.box(cx, y0 + 4.8, cz, W + 0.24, 0.3, D + 0.24, vicShade(VIC.stone, 0.92));   // the string course over the ground floor
  vicMansard(s, x0 + 0.2, z0 + 0.2, x1 - 0.2, z1 - 0.2, top, 3.0, 1.0, roof);
  const pw = Math.min(8, W / 4);
  for (const px of [x0 + pw / 2, x1 - pw / 2]) for (const pz of [z0 + pw / 2, z1 - pw / 2]) {
    const pt = vicBox(s, px - pw / 2 - 0.02, pz - pw / 2 - 0.02, px + pw / 2 + 0.02, pz + pw / 2 + 0.02, top, [{ tile: FACADE.VICT_GRAND, v, floors: 1, floorH: 3.8 }], wall);
    s.box(px, pt - 0.2, pz, pw + 0.4, 0.4, pw + 0.4, vicShade(VIC.stone, 0.95));
    vicFrustum(s, px - pw / 2, pz - pw / 2, px + pw / 2, pz + pw / 2, pt, [px - 1.2, pz - 1.2, px + 1.2, pz + 1.2], pt + 4.2, roof);
    s.box(px, pt + 4.35, pz, 2.6, 0.3, 2.6, VIC.black);
    s.cyl(px, pt + 5.0, pz, 0.05, 1.2, VIC.black, 4);
  }
}

// vicWorks draws an industrial building on b: a warehouse with its stacked loading doors and hoist,
// or a mill with rows of arched windows and its chimney, its one tall storey floorH high. A lot's
// records its front door with `door`; a block middle's has none.
// (floorH, from 6 to 9 m, sets how many storeys it has: two to five.)
export function vicWorks(s: Batch, b: VicRect, y0: number, floorH: number, wall: number, rnd: VicRand, door: VicDoor | null = null) {
  const lot = !!door, X0 = lot ? b.x0 - 0.26 : b.x0, X1 = lot ? b.x1 + 0.26 : b.x1, W = X1 - X0, D = b.z1 - b.z0;
  const storeys = vClamp(2 + Math.round((floorH - 6) / 1.5) + (rnd() < 0.5 ? 1 : 0), 2, 5), roof = vPick(rnd, VIC_SLATES), v = rnd() < 0.5 ? 0 : 1;
  const mill = rnd() < 0.45 && D >= 12;
  if (!mill) {
    // A warehouse: its ridge along the street, a column of loading doors under a cathead with its
    // hoist (two on a wide one), windows in the other bays.
    const zf = b.z0, zb = b.z1, bays = vicBays(X0, X1), fh = 3.1;
    const cols = bays >= 6 ? [1, bays - 2] : [Math.floor(bays / 2)];
    const top = vicBox(s, X0, zf, X1, zb, y0, [{ tile: FACADE.VICT_MILL, v: 2 + v, floors: storeys, floorH: fh }], wall, cols.map((k) => ({ k, tile: FACADE.VICT_WAREHOUSE, v: Math.floor(rnd() * 4), all: true })));
    if (door) { const k = bays >= 3 ? (cols[0] === 0 ? 1 : cols[0] - 1) : 0, [d0, d1] = vicBayX(X0, X1, k); door(d0, d1, zf); }
    const rh = Math.min(4.5, (zb - zf) * 0.3);
    vicGable(s, X0, zf, X1, zb, top, rh, roof, wall, false, 0.2);
    for (const k of cols) {
      const [a0, a1] = vicBayX(X0, X1, k), m = (a0 + a1) / 2;
      // the cathead: a gabled hood out over the doors, its beam, the chain and hook
      s.box(m, top + 0.5, zf - 0.1, 2.2, 2.2, 2.2, wall);
      vicGable(s, m - 1.1, zf - 1.2, m + 1.1, zf + 1.0, top + 1.6, 1.1, roof, wall, true, 0.12);
      s.box(m, top - 0.2, zf - 1.7, 0.24, 0.24, 1.3, VIC.oak);
      s.cyl(m, top - 2.0, zf - 2.25, 0.03, 3.6, VIC.black, 4);
      s.box(m, top - 3.9, zf - 2.25, 0.2, 0.3, 0.08, VIC.black);
    }
    vicStack(s, X0 + 1.2, zb - 2, top + rh * 0.3, 1.0, 1.0, rh * 0.7 + 1.8, wall, 1);
    return;
  }
  // A mill: four or five storeys of arched windows, a stair tower at one end a storey higher under a
  // pyramid roof with its water tank, a low roof, and the chimney behind on its square base.
  const zf = b.z0, zb = b.z1 - 4.5, fh = 3.3, n = Math.max(storeys, 3);
  const top = vicBox(s, X0, zf, X1, zb, y0, [{ tile: FACADE.VICT_MILL, v, floors: n, floorH: fh }], wall);
  if (door) { const bays = vicBays(X0, X1), [d0, d1] = vicBayX(X0, X1, Math.floor(bays / 2)); door(d0, d1, zf); }
  s.box((X0 + X1) / 2, top - 0.2, (zf + zb) / 2, W + 0.3, 0.4, zb - zf + 0.3, vicShade(wall, 0.8));
  vicGable(s, X0, zf, X1, zb, top, Math.min(2.2, (zb - zf) * 0.18), roof, wall, false, 0.15);
  const end = rnd() < 0.5, tx0 = end ? X0 - 0.02 : X1 - 4.2, tx1 = tx0 + 4.22;
  const tt = vicBox(s, tx0, zf - 0.6, tx1, zf + 4.2, y0, [{ tile: FACADE.VICT_MILL, v, floors: n + 1, floorH: fh }], wall);
  s.box((tx0 + tx1) / 2, tt + 0.2, zf + 1.8, 4.6, 0.4, 5.2, vicShade(wall, 0.8));
  vicFrustum(s, tx0 - 0.1, zf - 0.7, tx1 + 0.1, zf + 4.3, tt + 0.4, [(tx0 + tx1) / 2, zf + 1.8, (tx0 + tx1) / 2, zf + 1.8], tt + 3.4, roof);
  s.cyl((tx0 + tx1) / 2, tt + 4.0, zf + 1.8, 0.04, 1.2, VIC.black, 4);
  // the chimney: a square plinth, a round tapering shaft and its cap
  const cx = end ? X1 - 2.5 : X0 + 2.5, cz = b.z1 - 2.2, ch = 20 + n * 2.5 + rnd() * 6;
  s.box(cx, y0 + 1.6, cz, 3.0, 3.2, 3.0, vicShade(wall, 0.9));
  s.lathe("vicChimney", VIC_CHIMNEY, cx, y0 + 3.2, cz, 1.25, ch, wall, 8);
  s.cyl(cx, y0 + 3.2 + ch - 0.4, cz, 1.0, 0.8, vicShade(wall, 0.6), 8);
  s.cyl(cx, y0 + 3.2 + ch - 1.6, cz, 0.95, 0.35, vicShade(wall, 0.75), 8);
}
const VIC_CHIMNEY: readonly (readonly [number, number])[] = [[1, 0], [0.62, 1], [0, 1]];

// vicYard dresses an industrial yard w by d (centred on its frame's origin) in place of another
// city's containers: barrels, crates, timber, sacks and coal.
// (Its ground is laid out in cells about 4 m square, each a pile of one kind, some left bare for
// the carts; a timber yard's derrick crane over one now and then.)
export function vicYard(s: Batch, w: number, d: number, y0: number, rnd: VicRand) {
  const nx = Math.max(1, Math.floor(w / 4.2)), nz = Math.max(1, Math.floor(d / 4.2)), cw = w / nx, cd = d / nz;
  let n = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    if (rnd() < 0.3 || n >= 12) continue;
    n++;
    const x = -w / 2 + (i + 0.5) * cw, z = -d / 2 + (j + 0.5) * cd, k = rnd();
    if (k < 0.24) {   // barrels, standing, a few stacked on their sides on top
      for (let a = 0; a < 3; a++) for (let c = 0; c < 2; c++) if (rnd() < 0.85) s.cyl(x - 1 + a, y0 + 0.5, z - 0.5 + c, 0.38, 1.0, rnd() < 0.5 ? VIC.oak : 0x5e3e26, 6);
      if (rnd() < 0.6) s.cyl(x, y0 + 1.4, z, 0.38, 1.0, VIC.oak, 6, 0, Math.PI / 2);
    } else if (k < 0.46) {   // crates, stacked
      for (let c = 0; c < 4; c++) { const h = rnd() < 0.5 ? 2 : 1; for (let l = 0; l < h; l++) s.box(x - 0.8 + (c % 2) * 1.6, y0 + 0.45 + l * 0.92, z - 0.7 + Math.floor(c / 2) * 1.4, 1.3, 0.9, 1.1, vicShade(0x9a7a50, 0.85 + rnd() * 0.3), (rnd() - 0.5) * 0.2); }
    } else if (k < 0.66) {   // timber, in stacks of baulks with spacers
      const L = Math.min(cw, cd) - 0.6;
      for (let l = 0; l < 3; l++) { s.box(x, y0 + 0.2 + l * 0.5, z, L, 0.35, 2.4 - l * 0.4, vicShade(0xa88a5a, 0.9 + l * 0.05)); s.box(x, y0 + 0.42 + l * 0.5, z, 0.1, 0.1, 2.5 - l * 0.4, VIC.oak); }
      if (rnd() < 0.3) {   // a derrick: its mast, its jib and the stay
        s.cyl(x + L / 2, y0 + 4, z + 1.5, 0.12, 8, VIC.oak, 5);
        s.boxR(x + L / 2 - 2.2, y0 + 5.2, z + 1.5, 5.2, 0.16, 0.16, VIC.oak, 0, 0, -0.45);
        s.cyl(x + L / 2 - 4.4, y0 + 3.6, z + 1.5, 0.02, 3.2, VIC.black, 3);
      }
    } else if (k < 0.82) {   // coal, heaped in a bay of three brick walls
      s.cone(x, y0 + 0.7, z + 0.2, Math.min(cw, cd) * 0.42, 1.4, VIC.coal, 7);
      s.box(x, y0 + 0.6, z + Math.min(cw, cd) * 0.48, Math.min(cw, cd) - 0.4, 1.2, 0.3, VIC.brickDark);
      for (const sx of [-1, 1]) s.box(x + sx * (Math.min(cw, cd) / 2 - 0.35), y0 + 0.6, z, 0.3, 1.2, Math.min(cw, cd) * 0.95, VIC.brickDark);
    } else {   // sacks, in a heap, and a hand cart
      for (let c = 0; c < 6; c++) s.ico(x - 0.8 + (c % 3) * 0.8, y0 + 0.3 + (c >= 3 ? 0.45 : 0), z + (c >= 3 ? 0 : 0.4) - 0.3, 0.42, VIC.sack, 0.6, c);
      s.box(x + 0.4, y0 + 0.65, z + 1.3, 1.4, 0.15, 0.9, VIC.oak);
      for (const sz of [-1, 1]) s.cyl(x + 0.4, y0 + 0.45, z + 1.3 + sz * 0.5, 0.45, 0.06, VIC.oak, 8, Math.PI / 2);
    }
  }
}
// vicBackYard draws a terrace house's back yard (a0, n0)-(a1, n1) in its face's frame: walled in
// brick, flagged or a patch of grass, perhaps a privy or coal shed at the back and a washing line.
export function vicBackYard(s: Batch, g: Batch, a0: number, n0: number, a1: number, n1: number, y0: number, grass: number, rnd: VicRand) {
  const wall = rnd() < 0.6 ? VIC.stock : 0x9a4a36, wh = 1.8;
  for (const a of [a0, a1]) s.box(a, y0 + wh / 2, (n0 + n1) / 2, 0.22, wh, n1 - n0, wall);
  s.box((a0 + a1) / 2, y0 + wh / 2, n1, a1 - a0, wh, 0.22, wall);
  const flagged = rnd() < 0.55;
  g.box((a0 + a1) / 2, y0 + 0.01, (n0 + n1) / 2, a1 - a0, 0.02, n1 - n0, flagged ? VIC.flag : grass);
  if (a1 - a0 > 3.5 && n1 - n0 > 3.5) {
    if (rnd() < 0.7) {   // the privy, or the coal shed, in the back corner: a lean-to under slate
      const left = rnd() < 0.5, px = left ? a0 + 0.95 : a1 - 0.95, pz = n1 - 0.85;
      s.box(px, y0 + 1.0, pz, 1.4, 2.0, 1.4, wall);
      s.boxR(px, y0 + 2.2, pz, 1.6, 0.1, 1.7, VIC.slate, 0.35, 0, 0);
      s.box(px, y0 + 0.9, pz - 0.71, 0.7, 1.7, 0.03, vPick(rnd, [VIC.green, VIC.black, 0x6a4a30]));
    }
    if (rnd() < 0.6) {   // a washing line from the house's back to a pole, something on it
      const x = a0 + (a1 - a0) * vRange(rnd, 0.35, 0.65), za = n0 + 0.5, zb = n1 - 1.8, L = zb - za;
      s.cyl(x, y0 + 1.2, zb, 0.04, 2.4, VIC.oak, 4);
      s.box(x, y0 + 2.3, (za + zb) / 2, 0.02, 0.02, L, VIC.white);
      for (let i = 0; i < 3; i++) if (rnd() < 0.8) s.box(x, y0 + 1.9, za + L * (i + 0.6) / 3.4, 0.03, 0.75, 0.7, vPick(rnd, [VIC.white, VIC.cream, 0x8a9ab0, 0xb04a3a, VIC.white]));
    }
  }
}
// vicShed draws a block middle's outbuilding (a privy, a coal shed or a workshop), centred on its
// frame's origin, in its wall's colour.
export function vicShed(s: Batch, y0: number, wall: number, rnd: VicRand) {
  s.box(0, y0 + 1.1, 0, 2.4, 2.2, 2.0, wall);
  vicGable(s, -1.2, -1.0, 1.2, 1.0, y0 + 2.2, 0.9, vPick(rnd, VIC_SLATES), wall, false, 0.15);
  s.box(-0.3, y0 + 0.9, -1.01, 0.8, 1.7, 0.03, vPick(rnd, [VIC.green, VIC.black, VIC.oak]));
  if (rnd() < 0.4) vicStack(s, 0.8, 0, y0 + 2.2, 0.45, 0.45, 1.3, wall, 1);
}
// vicSquare draws a garden square w by d (centred on its frame's origin) in place of a car park:
// lawns inside iron railings, gravel walks, and in a big one (`big`) a statue or a fountain in the
// middle. Its trees are trees of their own.
export function vicSquare(s: Batch, g: Batch, w: number, d: number, y0: number, big: boolean, grass: number, rnd: VicRand) {
  g.box(0, y0 + 0.01, 0, w, 0.02, d, grass);
  // the walks: one all round inside the railings, and across from gate to gate
  const p = 1.6, gw = VIC.gravel;
  for (const [x, z, ww, dd] of [[0, -d / 2 + 1.4, w - 1.2, p], [0, d / 2 - 1.4, w - 1.2, p], [-w / 2 + 1.4, 0, p, d - 1.2], [w / 2 - 1.4, 0, p, d - 1.2], [0, 0, w - 1.2, p], [0, 0, p, d - 1.2]] as const)
    g.box(x, y0 + 0.022, z, ww, 0.02, dd, gw);
  // the railings round it, a gate's gap in the middle of each side
  const hw = w / 2 - 0.3, hd = d / 2 - 0.3, gate = 1.0;
  vicRailings(s, -hw, -hd, hw, -hd, y0, 1.15, VIC.black, [[hw - gate, hw + gate]], 0.5);
  vicRailings(s, hw, hd, -hw, hd, y0, 1.15, VIC.black, [[hw - gate, hw + gate]], 0.5);
  vicRailings(s, -hw, hd, -hw, -hd, y0, 1.15, VIC.black, [[hd - gate, hd + gate]], 0.5);
  vicRailings(s, hw, -hd, hw, hd, y0, 1.15, VIC.black, [[hd - gate, hd + gate]], 0.5);
  for (const [x, z] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) { s.box(x, y0 + 0.7, z, 0.3, 1.4, 0.3, VIC.stone); s.ico(x, y0 + 1.5, z, 0.16, VIC.stone); }
  if (!big) return;
  g.cyl(0, y0 + 0.024, 0, Math.min(w, d) * 0.22, 0.02, gw, 16);
  if (rnd() < 0.5) {
    // a statue: a gentleman in bronze on his stepped stone plinth
    s.box(0, y0 + 0.25, 0, 2.6, 0.5, 2.6, VIC.stone); s.box(0, y0 + 1.5, 0, 1.6, 2.0, 1.6, VIC.stone); s.box(0, y0 + 2.6, 0, 1.9, 0.25, 1.9, vicShade(VIC.stone, 0.9));
    s.cone(0, y0 + 3.55, 0, 0.5, 1.7, VIC.bronze, 6); s.box(0, y0 + 3.9, 0, 0.6, 0.9, 0.42, VIC.bronze); s.ico(0, y0 + 4.55, 0, 0.23, VIC.bronze);
    s.boxR(0.38, y0 + 4.15, -0.1, 0.14, 0.75, 0.14, VIC.bronze, 0.5, 0, -0.5);
  } else {
    // a fountain: its basin, a bowl on a pedestal, a smaller one over it, water in each
    s.cyl(0, y0 + 0.3, 0, 3.0, 0.6, VIC.stone, 14); s.cyl(0, y0 + 0.56, 0, 2.7, 0.06, 0x4a7a98, 14);
    s.cyl(0, y0 + 1.3, 0, 0.35, 1.8, VIC.stone, 8); s.cone(0, y0 + 2.35, 0, 1.4, 0.5, VIC.stone, 12, Math.PI); s.cyl(0, y0 + 2.58, 0, 1.25, 0.05, 0x5a8aa8, 12);
    s.cyl(0, y0 + 3.0, 0, 0.18, 0.9, VIC.stone, 6); s.cone(0, y0 + 3.5, 0, 0.7, 0.3, VIC.stone, 10, Math.PI); s.ico(0, y0 + 3.85, 0, 0.18, VIC.stone);
  }
}
// vicPlanter draws a street tree's iron guard on a paved block middle, in place of a planter: a cage
// of bars round the trunk with a ring at its top, on an iron grate.
export function vicPlanter(s: Batch, y0: number) {
  s.cyl(0, y0 + 0.02, 0, 0.75, 0.04, VIC.iron, 8);
  s.tubeSeg(0, y0 + 0.8, 0, 0.42, 1.6, VIC.iron, 6);
  s.tubeSeg(0, y0 + 1.55, 0, 0.46, 0.08, VIC.iron, 6, 0, 0, Math.PI / 6);
}
// vicGate draws the toll gate over the road in, at (x, z), its road heading (fx, fz) and its half
// width `half`: a toll house beside a five-barred gate swung open, with its board of tolls.
// (The toll house is a lodge of one storey with its canted front to the road, so the keeper sees
// both ways; the gate hangs from a post at the road's edge on the same side and lies open along it.)
export function vicGate(s: Batch, x: number, z: number, fx: number, fz: number, half: number, y0 = 0) {
  const F = { ox: x, oz: z, rot: Math.atan2(-fz, fx) }, n0 = s.mark();
  // (Drawn with the road along +x and the toll house's side at +z, then turned into place.)
  PLACED.frames.push(F);
  const hz = half + 6.5, hw = 3.4;
  const top = facadePrism(s, 0, hz, hw, 6, Math.PI / 6, y0, [{ tile: FACADE.VICT_SASH, floors: 1, floorH: 3.4 }], VIC.stucco, 4, FACADE.VICT_DOOR);
  s.cone(0, top + 1.3, hz, hw * 1.12, 2.6, VIC.slate, 6, 0, Math.PI / 6 + Math.PI / 2);
  vicStack(s, 0, hz + 0.6, top + 0.9, 0.7, 0.7, 2.2, VIC.stock, 2);
  // the board of tolls on its front, gilt letters on black (lines of paint, read at a distance)
  const bz = hz - hw * Math.cos(Math.PI / 6) - 0.06;
  s.box(0, y0 + 2.3, bz, 2.2, 1.3, 0.06, VIC.black);
  for (let i = 0; i < 4; i++) s.box(-0.2 + (i % 2) * 0.1, y0 + 2.75 - i * 0.28, bz - 0.04, 1.4 - (i % 2) * 0.3, 0.07, 0.02, VIC.gilt);
  s.box(0, y0 + 2.75 + 0.22, bz - 0.04, 1.8, 0.1, 0.02, VIC.gilt);
  vicLantern(s, 1.6, y0 + 3.0, bz - 0.2, 0.2);
  // the gate: a post each side of the road, the gate swung open back along the verge from its own
  for (const k of [-1, 1]) { s.box(0, y0 + 0.9, k * (half - 0.3), 0.32, 1.8, 0.32, VIC.white); s.box(0, y0 + 1.85, k * (half - 0.3), 0.4, 0.1, 0.4, VIC.white); }
  const gl = 5.2, gz = half - 0.6;
  for (let i = 0; i < 5; i++) s.box(-gl / 2 - 0.2, y0 + 0.35 + i * 0.3, gz, gl, 0.13, 0.1, VIC.white);
  s.box(-gl - 0.15, y0 + 0.95, gz, 0.16, 1.45, 0.12, VIC.white); s.box(-0.3, y0 + 0.95, gz, 0.16, 1.45, 0.12, VIC.white);
  s.boxR(-gl / 2 - 0.2, y0 + 0.95, gz, gl * 1.05, 0.13, 0.1, VIC.white, 0, 0, 0.22);
  PLACED.frames.pop();
  s.transformFrom(n0, F);
}

// ---- the town's square ------------------------------------------------------------------------
// vicMonument draws the middle of the town's square (city.ts buildPlaza) at (x, y, z), R across:
// inside a ring of iron railings, either the Queen in bronze on a tall stepped plinth with lamps at
// its corners, or a drinking fountain under a Gothic canopy of four columns and a spire.
export function vicMonument(s: Batch, x: number, y: number, z: number, R: number, rnd: VicRand) {
  const rr = R + 1.2;
  for (let i = 0; i < 4; i++) {   // the railings' four quarters, a gate's gap between each
    const a0 = (i / 4) * Math.PI * 2 + 0.22, a1 = ((i + 1) / 4) * Math.PI * 2 - 0.22, k = 6;
    for (let j = 0; j < k; j++) {
      const t0 = a0 + (a1 - a0) * j / k, t1 = a0 + (a1 - a0) * (j + 1) / k;
      vicRailings(s, x + Math.cos(t1) * rr, z + Math.sin(t1) * rr, x + Math.cos(t0) * rr, z + Math.sin(t0) * rr, y, 1.1, VIC.black, [], 0.5);
    }
  }
  s.cyl(x, y + 0.12, z, R, 0.24, VIC.flag, 16);
  if (rnd() < 0.5) {
    // the statue: steps, a pedestal with its cornice, the figure in her robes and crown, an orb
    s.box(x, y + 0.45, z, 4.2, 0.4, 4.2, VIC.stone); s.box(x, y + 0.85, z, 3.4, 0.4, 3.4, VIC.stone);
    s.box(x, y + 2.6, z, 2.2, 3.1, 2.2, VIC.stone); s.box(x, y + 4.25, z, 2.6, 0.3, 2.6, vicShade(VIC.stone, 0.9));
    s.cone(x, y + 5.6, z, 0.9, 2.6, VIC.bronze, 8); s.box(x, y + 6.6, z, 0.9, 1.0, 0.6, VIC.bronze);
    s.ico(x, y + 7.35, z, 0.32, VIC.bronze); s.cyl(x, y + 7.72, z, 0.24, 0.18, VIC.gilt, 6);
    s.ico(x + 0.55, y + 6.4, z - 0.25, 0.16, VIC.gilt); s.cyl(x - 0.55, y + 6.6, z - 0.1, 0.04, 1.6, VIC.bronze, 4);
    for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { s.cyl(x + px * 1.9, y + 2.0, z + pz * 1.9, 0.09, 2.4, VIC.black, 5); vicLantern(s, x + px * 1.9, y + 3.4, z + pz * 1.9, 0.2); }
  } else {
    // the drinking fountain: a granite basin, four columns, the arches' block and a spire with its cross
    s.cyl(x, y + 0.5, z, 1.6, 0.8, 0x8a8680, 10); s.cyl(x, y + 0.92, z, 1.4, 0.06, 0x4a7a98, 10);
    s.cyl(x, y + 1.6, z, 0.4, 1.3, 0x8a8680, 8);
    for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.cyl(x + px * 1.9, y + 2.1, z + pz * 1.9, 0.18, 4.0, 0xa83a2a, 8);
    s.box(x, y + 4.6, z, 4.6, 1.0, 4.6, VIC.stone);
    for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) s.cone(x + px * 2.1, y + 5.6, z + pz * 2.1, 0.3, 1.4, VIC.stone, 4, 0, Math.PI / 4);
    s.cone(x, y + 8.1, z, 2.2, 6.0, VIC.slate, 8, 0, Math.PI / 8);
    s.box(x, y + 11.4, z, 0.08, 0.8, 0.08, VIC.gilt); s.box(x, y + 11.55, z, 0.4, 0.08, 0.08, VIC.gilt);
  }
}
