// Test: the truck's body keeps off the sidewalks as it drives along a street (clear of its
// junctions): never more than KERB_MAX past the kerb. Its path is its rear axle's, and on its way
// over to the kerb lane its nose, 8.6 m on, once swung up to 2.5 m over the kerb (route.ts
// Route.nose), through stop signs; away from it, its tail did (Route.tail). (A tractor's cab: its
// trailer swinging is offtrack.ts's to check.)
// Args (all optional): minutes seeds...
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT } from "../src/journey.ts";
import { truckExtents, SPECS } from "../src/truck.ts";
const KERB_MAX = 0.05;   // m
{
  const proc = (globalThis as any).process, argv: string[] = proc.argv.slice(2), errs: string[] = [];
  const mins = Number(argv[0] ?? 15), seeds = argv.length > 1 ? argv.slice(1).map(Number) : [3, 8];
  for (const seed of seeds) {
  const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
  const ev: Record<string, { n: number; worst: number; at: string }> = {};
  for (let i = 0; i < mins * 60 / SIM_DT; i++) {
    j.step();
    if (j.st.mode !== "drive" || !j.path || j.st.city < 0) continue;
    const P: any = j.path, pc = P.pieces.find((q: any) => j.st.s >= q.s0 && j.st.s < q.s0 + q.len);
    // (A street's own lanes: not a ramp's shift off it, nor out of a bay.)
    if (!pc || pc.kind !== "line" || Math.max(Math.abs(pc.o0), Math.abs(pc.o1)) > 4.5 || (P.dockOut > 0 && j.st.s < P.dockOut + 20)) continue;
    const G = j.plan.graph, m = j.st.truck, E = truckExtents(m, !!j.plan.style.victorian), h = j.pose.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
    const { d, before } = G.locate(j.pose.x, j.pose.z, h);
    if (d < 0) continue;
    const id = d >> 1, st = G.streets[id];
    let worst = -Infinity;
    const front = E.front, rear = SPECS[m].fifthWheel !== undefined ? -1.5 : E.rear;   // (a tractor's cab: its trailer is offtrack.ts's)
    for (const a of [rear, front]) for (const b of [-1.25, 1.25]) {
      const x = j.pose.x + fx * a + rx * b, z = j.pose.z + fz * a + rz * b, [s, o] = G.toStreet(id, x, z);
      if (s <= G.armOut(d & ~1).mouth || s >= st.len - G.armIn(d & ~1).mouth) continue;   // (only along the street, clear of its junctions)
      worst = Math.max(worst, Math.abs(o) - (st.half - st.kerb));
    }
    if (worst <= KERB_MAX) continue;
    const u = j.st.s - pc.s0, changing = pc.tc > 0 && u >= pc.c0 - 10 && u <= pc.c0 + pc.tc + 10;
    const k = `${m} ${changing ? `lane change ${pc.o0}->${pc.o1} over ${pc.tc.toFixed(0)} m` : `no lane change (o ${pc.o0}->${pc.o1})`}`;
    const e = ev[k] ?? (ev[k] = { n: 0, worst: 0, at: "" });
    e.n++; if (worst > e.worst) { e.worst = worst; e.at = `t${j.st.simTime.toFixed(0)}`; }
  }
  for (const [k, e] of Object.entries(ev)) errs.push(`seed ${seed}: ${k}: ${e.n} steps over the kerb, worst ${e.worst.toFixed(2)} m (${e.at})`);
  console.log(`kerb: seed ${seed}, ${mins} min: ${Object.keys(ev).length ? "over the kerb" : "never over the kerb"}`);
  }
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
