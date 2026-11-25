// Test: on a block whose site is laid out on its anchor (citygraph.ts CBlock.anchor), the site's
// 42 m square lies inside the block (all but its edges), and the lots' ground round it (city.ts
// lotGround) covers exactly the rest of the block: nothing left bare, nothing laid over the site.
// Also: a block's ground (city.ts slab) covers just the block, concave ones too (a warped
// superblock's T-junction notch).
// Args (all optional): seed
import { CityPlan, lotGround, siteSquare, slab } from "../src/city.ts";
import { inPoly } from "../src/citygraph.ts";
import { citySeedOf } from "../src/country.ts";
import { journeyStyle } from "../src/styles.ts";
import type { Batch } from "../src/geom.ts";
const area = (p: [number, number][]) => { let A = 0; for (let i = 0; i < p.length; i++) { const [a, b] = p[i], [c, d] = p[(i + 1) % p.length]; A += a * d - c * b; } return Math.abs(A) / 2; };
// (slab's top, as triangles: a Batch that only records them, flat ones.)
const tops = (poly: [number, number][]) => {
  const tris: [number, number][][] = [];
  const rec = { tri: (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) => { if (ay === by && by === cy) tris.push([[ax, az], [bx, bz], [cx, cz]]); } };
  slab(rec as unknown as Batch, poly, 0, 0.15, 0);
  return tris;
};
{
  const proc = (globalThis as any).process, errs: string[] = [];
  for (const seed of proc.argv[2] ? [Number(proc.argv[2])] : [1, 11]) {
    let n = 0, blocks = 0;
    for (let N = 0; N < 12; N++) {
      const plan = new CityPlan(citySeedOf(seed, N), journeyStyle(seed, N)), G = plan.graph;
      for (const b of G.blocks) {
        if (!b.inCity) continue;
        const where = `seed ${seed} city ${N} block ${b.kx},${b.kz}`;
        // The block's ground: its area, every triangle inside it.
        const tris = tops(b.poly as [number, number][]), got = tris.reduce((s, t) => s + area(t), 0);
        blocks++;
        if (Math.abs(got - b.area) > 0.5) errs.push(`${where}: ground ${got.toFixed(1)} m2 for a block of ${b.area.toFixed(1)} m2`);
        else if (tris.some((t) => area(t) > 0.01 && !inPoly(b.poly, (t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3))) errs.push(`${where}: ground laid outside the block`);
        if (b.square || !b.anchor) continue;
        const { pieces, inside: rest } = lotGround(b.poly as [number, number][], siteSquare(G, b.anchor));
        const lots = pieces.reduce((s, p) => s + area(p), 0), inside = rest.length >= 3 ? area(rest) : 0;
        n++;
        if (Math.abs(lots + inside - b.area) > 1) errs.push(`${where}: lots' ground ${lots.toFixed(0)} m2 + site ${inside.toFixed(0)} m2, block ${b.area.toFixed(0)} m2`);
        // (The anchor's fit lets the square's edges, where a site has only fences, stand up to a
        // metre or two out of the block: at least a/n 10.2..49.8 by 0.5..40.2 is inside.)
        if (inside < 39.6 * 39.7) errs.push(`${where}: only ${inside.toFixed(0)} m2 of the site's square inside the block`);
      }
    }
    console.log(`sites: seed ${seed}, ${blocks} blocks, ${n} anchored`);
  }
  if (errs.length) { for (const e of errs.slice(0, 10)) console.error(e); if (errs.length > 10) console.error(`(+${errs.length - 10} more)`); proc.exit(1); }
}
