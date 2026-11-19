// A top-down map of cities' street graphs (citygraph.ts), for looking at layouts without
// rendering the scene: streets grey, blocks by district (water blue, superblock parks green),
// signalled intersections red. Writes one PPM per city to the directory given (ffmpeg turns them
// into PNGs: see the Makefile's `citymap` target).
// Args: outDir seed [cities]
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { CityPlan, setCityLimits } from "../src/city.ts";
import { citySeedOf } from "../src/country.ts";
import { journeyStyle } from "../src/styles.ts";
{
  const proc = (globalThis as any).process, fs = proc.getBuiltinModule("fs");
  const [outDir, seedArg, nArg] = proc.argv.slice(2);
  const seed = Number(seedArg ?? 1), n = Number(nArg ?? 4);
  const cfg = readConfig({ seed } as SceneEnv);
  void new Journey(cfg, 0, "autumn");   // (sets the city's limits and gates as the scene does)
  setCityLimits(cfg.cityMinutes);
  const DIST: Record<string, [number, number, number]> = { downtown: [150, 160, 190], commercial: [215, 190, 150], residential: [170, 210, 150], industrial: [190, 180, 170], park: [90, 170, 90] };
  for (let N = 0; N < n; N++) {
    const plan = new CityPlan(citySeedOf(seed, N), journeyStyle(seed, N)), G = plan.graph;
    const S = 0.5, pad = 40, { x0, z0, x1, z1 } = G.bounds;
    const W = Math.ceil((x1 - x0 + 2 * pad) * S), H = Math.ceil((z1 - z0 + 2 * pad) * S);
    const img = new Uint8Array(W * H * 3).fill(235);
    const px = (x: number) => (x - x0 + pad) * S, pz = (z: number) => (z - z0 + pad) * S;
    const fill = (poly: [number, number][], c: [number, number, number]) => {
      const P = poly.map(([x, z]) => [px(x), pz(z)]);
      const zs = P.map((p) => p[1]), lo = Math.max(0, Math.floor(Math.min(...zs))), hi = Math.min(H - 1, Math.ceil(Math.max(...zs)));
      for (let y = lo; y <= hi; y++) {
        const xs: number[] = [];
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [ax, ay] = P[j], [bx, by] = P[i]; if ((ay > y + 0.5) !== (by > y + 0.5)) xs.push(ax + (y + 0.5 - ay) * (bx - ax) / (by - ay)); }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) img.set(c, (y * W + x) * 3);
      }
    };
    // Streets: each a quad of its full width, then the blocks over them.
    for (const st of G.streets) {
      const a = G.streetPt(st.id, 0, -st.half), b = G.streetPt(st.id, st.len, -st.half), c = G.streetPt(st.id, st.len, st.half), d = G.streetPt(st.id, 0, st.half);
      fill([[a.x, a.z], [b.x, b.z], [c.x, c.z], [d.x, d.z]], st.inCity ? [120, 120, 125] : [160, 150, 120]);
    }
    for (const nd of G.nodes) if (nd.arms.length > 1) fill([[nd.x - 9, nd.z - 9], [nd.x + 9, nd.z - 9], [nd.x + 9, nd.z + 9], [nd.x - 9, nd.z + 9]], [120, 120, 125]);
    for (const b of G.blocks) fill(b.poly, b.water ? [70, 130, 200] : b.park ? DIST.park : DIST[plan.district(b.kx, b.kz)] ?? [200, 200, 200]);
    for (const nd of G.nodes) if (nd.control === "signal") fill([[nd.x - 3, nd.z - 3], [nd.x + 3, nd.z - 3], [nd.x + 3, nd.z + 3], [nd.x - 3, nd.z + 3]], [210, 60, 50]);
    const head = new TextEncoder().encode(`P6\n${W} ${H}\n255\n`), out = new Uint8Array(head.length + img.length);
    out.set(head); out.set(img, head.length);
    fs.writeFileSync(`${outDir}/city${N}.ppm`, out);
    console.log(`city ${N}: ${plan.style.id} ${plan.layout}, ${G.nodes.length} nodes, ${G.streets.length} streets, ${G.blocks.length} blocks (${G.blocks.filter((b) => b.water).length} water, ${G.blocks.filter((b) => b.park).length} superblock parks, ${G.blocks.filter((b) => !b.square && b.inCity).length} lotted, ${G.blocks.filter((b) => !b.square && b.inCity && b.anchor).length} of them with room for a site; ${G.streets.filter((s) => / Circle$/.test(s.name)).length / 8} circuses, ${G.streets.filter((s) => / Roundabout$/.test(s.name)).length / 8} roundabouts, ${new Set(G.streets.filter((s) => !/Circle|Roundabout/.test(s.name) && Math.abs(Math.abs(Math.cos(s.h0)) - Math.SQRT1_2) < 0.15).map((s) => s.name)).size} diagonal avenues; industrial blocks able to take a site ${G.blocks.filter((b) => plan.district(b.kx, b.kz) === "industrial" && (b.square || b.anchor)).length}/${G.blocks.filter((b) => plan.district(b.kx, b.kz) === "industrial").length})`);
  }
}
