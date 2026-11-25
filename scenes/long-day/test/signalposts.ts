// Test: no traffic signal's pole (signals.ts signalPoles) stands where a vehicle drives, nor a stop
// sign's post (stopSignPosts), which keeps clear of every way through too, its sign's plate and all
// (STOP_POST_CLEAR). In every signalled junction of many towns: every approach has its pole;
// neither it nor its mast arm is in a block (among its buildings); no pole stands on a roadway (it
// is POLE_CLEAR back from the kerb at the least); and every way through (each approach, each move,
// from either lane, and a tractor-trailer's wide rights), there and at any junction within 40 m,
// keeps its path's centre line POLE_PATH_CLEAR from every pole: half the widest vehicle, and a
// little. (A street bending on across a junction is driven as one curve, its kerb lane over the
// inside corner's kerb: poles once stood there, and at the far side of a T, out in the street the
// stem met.) Then the journey is driven and the truck's body (its trailer at its own angle) never
// comes to a pole. (Not covered: a tractor-trailer pulling out of a dock or a kerb stop just short
// of a right, too short a leg to swing wide, whose trailer drags in across the corner's sidewalk,
// pole and all, as offtrack.ts notes: seed 11, 11 minutes in.)
// Args (all optional): towns (seeds 1..towns, each its first three cities), minutes driven, seeds driven...
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { CityPlan, pavementObstacles } from "../src/city.ts";
import { citySeedOf } from "../src/country.ts";
import { journeyStyle } from "../src/styles.ts";
import { Path, LANE_KERB, LANE_INNER } from "../src/route.ts";
import { signalPoles, stopSignPosts, POLE_PATH_CLEAR, STOP_POST_CLEAR, STOP_PLATE } from "../src/signals.ts";
import { SIM_DT } from "../src/journey.ts";
import { SPECS, TRAILER, truckExtents } from "../src/truck.ts";
import type { CityGraph } from "../src/citygraph.ts";
import { inPoly, polyDist } from "../src/citygraph.ts";

{
  const proc = (globalThis as any).process, argv: string[] = proc.argv.slice(2), errs: string[] = [];
  const towns = Number(argv[0] ?? 12), minutes = Number(argv[1] ?? 12), driveSeeds = argv.length > 2 ? argv.slice(2).map(Number) : [8, 12, 3];
  const CLEAR = POLE_PATH_CLEAR - 0.01;
  const q = { x: 0, z: 0, h: 0, k: 0 };
  let poles = 0, worst = Infinity, bad = 0, stopPosts = 0, furnChecked = 0;
  const misses = { none: 0, paths: 0 }, stopMisses = { none: 0, paths: 0 };
  for (let seed = 1; seed <= towns; seed++) {
    const cfg = readConfig({ seed } as SceneEnv);
    for (let city = 0; city < 3; city++) {
      const P = new CityPlan(citySeedOf(seed, city), journeyStyle(seed, city)), G = P.graph;
      // (A post or pole of radius r at (x, z) clear of the sidewalk's furniture, streetlights and
      // trees, its own pavement obstacle aside: the first towns' first cities, as the probe builds are slow.)
      const furnished = (x: number, z: number, r: number, what: string) => {
        if (seed > 3 || city > 0) return;
        furnChecked++;
        for (const b of G.blocks.filter((b) => b.inCity && Math.hypot(b.cx - x, b.cz - z) < 60)) for (const o of pavementObstacles(P, b.kx, b.kz)) {
          const d = Math.hypot(o.x - x, o.z - z);
          if (d > 1e-6 && d < o.r + r + 0.1 && errs.length < 400) { errs.push(`seed ${seed} city ${city}: ${what} at (${x.toFixed(1)}, ${z.toFixed(1)}) in the sidewalk's furniture (kind ${o.kind}, ${d.toFixed(2)} m from it)`); return; }
        }
      };
      for (const n of G.nodes) {
        // (An all-way stop's sign posts, too: clear of every way through.)
        if (n.control === "stop") {
          const posts = [...stopSignPosts(G, n, stopMisses).values()], q2 = { x: 0, z: 0, h: 0, k: 0 };
          stopPosts += posts.length;
          // (None past its street's far mouth, in the next junction; and, in the first towns, none
          // in the sidewalk's furniture: furnished, below.)
          for (const [i, [x, z]] of stopSignPosts(G, n)) {
            const arm = n.arms[i], sa = G.streets[arm.street], far = G.nodes[arm.end === 0 ? sa.n1 : sa.n0].arms.find((b) => b.street === arm.street && b.end !== arm.end)?.mouth ?? 0;
            if ((x - n.x) * Math.cos(arm.h) - (z - n.z) * Math.sin(arm.h) > sa.len - far && errs.length < 400) errs.push(`seed ${seed} city ${city}: node ${n.id}'s stop sign post at (${x.toFixed(1)}, ${z.toFixed(1)}) past ${sa.name}'s far mouth, in the next junction`);
            furnished(x, z, 0.05, `node ${n.id}'s stop sign post`);
          }
          // (Through this junction and any other within 40 m: on a short street, the next one's turns.)
          const around = G.nodes.filter((m) => m === n || (m.arms.length >= 2 && Math.hypot(m.x - n.x, m.z - n.z) < 40));
          for (const arm of around.flatMap((m) => m.arms)) {
            const d = arm.street * 2 + (arm.end ^ 1);
            if (!G.streets[arm.street].inCity || !G.drivable(d)) continue;
            for (const mv of G.movesFrom(d)) for (const lane of [LANE_KERB, LANE_INNER]) {
              if (!G.streets[mv.to >> 1].inCity) continue;
              const path = new Path(G, { d, before: Math.min(30, G.faceLen(d) / 2), edges: [mv.to], after: Math.min(30, G.faceLen(mv.to) / 2), lane });
              for (let s = 0; s <= path.length; s += 0.25) {
                path.eval(s, q2);
                for (const [x, z] of posts) if (Math.hypot(q2.x - x, q2.z - z) < STOP_POST_CLEAR - 0.01 && errs.length < 400) errs.push(`seed ${seed} city ${city}: node ${n.id}'s stop sign post at (${x.toFixed(1)}, ${z.toFixed(1)}) ${Math.hypot(q2.x - x, q2.z - z).toFixed(2)} m from the path of ${mv.move} from street ${G.streets[arm.street].name}`);
              }
            }
          }
        }
        if (n.control !== "signal") continue;
        const ps = signalPoles(G, n, misses);
        poles += ps.length;
        for (const p of ps) {
          const st = G.streets[n.arms[p.i].street];
          if (!st.inCity) continue;
          furnished(p.px, p.pz, 0.16, `node ${n.id}'s pole for ${st.name}`);
          // (Neither the pole nor its mast arm in a block, past the back of the sidewalk, among its buildings.)
          const blocks = G.blocks.filter((b) => Math.hypot(b.cx - p.px, b.cz - p.pz) < 200);
          const inBlock = (x: number, z: number) => blocks.some((b) => inPoly(b.poly, x, z) && polyDist(b.poly, x, z) > 0.2);
          const ax = -Math.sin(p.h), az = -Math.cos(p.h);
          for (let d = 0; d <= p.toCentre + 0.4; d += 0.5) if (inBlock(p.px + ax * d, p.pz + az * d)) {
            if (errs.length < 400) errs.push(`seed ${seed} city ${city}: node ${n.id}'s pole for ${st.name} ${d ? `has its mast arm in a block ${d} m out` : "stands in a block"}`);
            break;
          }
          for (const a of n.arms) {
            const sa = G.streets[a.street], [sp] = G.toStreet(a.street, p.px, p.pz), c = G.streetPt(a.street, sp, 0), d = Math.hypot(c.x - p.px, c.z - p.pz);
            if (d < sa.half - sa.kerb + 0.5 && errs.length < 400) errs.push(`seed ${seed} city ${city}: node ${n.id}'s pole for ${st.name} on ${sa.name}'s roadway (${d.toFixed(2)} m from its centre line)`);
          }
        }
        // (The ways through this junction, and through any other within 40 m: a pole down a short
        // street stands by the next junction too.)
        const near = ps.map(() => ({ d: Infinity, what: "" }));
        const around = G.nodes.filter((m) => m === n || (m.arms.length >= 2 && Math.hypot(m.x - n.x, m.z - n.z) < 40));
        for (const arm of around.flatMap((m) => m.arms)) {
          const d = arm.street * 2 + (arm.end ^ 1), st = G.streets[arm.street];   // (the dedge coming in along this arm)
          if (!st.inCity || !G.drivable(d)) continue;
          for (const mv of G.movesFrom(d)) {
            if (!G.streets[mv.to >> 1].inCity) continue;
            for (const lane of [LANE_KERB, LANE_INNER]) for (const wide of [false, true]) {
              let path: Path;
              try { path = new Path(G, { d, before: Math.min(30, G.faceLen(d) / 2), edges: [mv.to], after: Math.min(30, G.faceLen(mv.to) / 2), lane, wide }); }
              catch { errs.push(`seed ${seed} city ${city}: no path for ${mv.move} from street ${st.name}`); continue; }
              for (let s = 0; s <= path.length; s += 0.25) {
                path.eval(s, q);
                ps.forEach((p, k) => {
                  const e = Math.hypot(q.x - p.px, q.z - p.pz);
                  if (e < near[k].d) near[k] = { d: e, what: `${mv.move} from street ${st.name} lane ${lane}${wide ? " wide" : ""}` };
                });
              }
            }
          }
        }
        ps.forEach((p, k) => {
          worst = Math.min(worst, near[k].d);
          if (near[k].d >= CLEAR) return;
          bad++;
          if (errs.length < 400) errs.push(`seed ${seed} city ${city}: node ${n.id} (${n.x.toFixed(0)}, ${n.z.toFixed(0)}, ${n.arms.length} arms), pole for ${G.streets[n.arms[p.i].street].name} at (${p.px.toFixed(1)}, ${p.pz.toFixed(1)}) ${near[k].d.toFixed(2)} m from the path of ${near[k].what}`);
        });
      }
    }
  }
  if (misses.none) errs.push(`${misses.none} approaches have no pole`);
  if (stopMisses.none) errs.push(`${stopMisses.none} stop sign posts found nowhere clear of the traffic`);
  if (stopMisses.paths) errs.push(`${stopMisses.paths} ways through all-way stops had no path to keep posts off`);
  if (misses.paths) errs.push(`${misses.paths} ways through signalled junctions had no path to keep poles off`);
  // Driven: the truck's outline (its trailer at its own angle) never within a pole's radius of one,
  // nor within a stop sign's half width of its post (the sign hangs at the body's height).
  const POLE_R = 0.16, cellOf = (x: number, z: number) => `${Math.floor(x / 40)},${Math.floor(z / 40)}`;
  for (const seed of driveSeeds) {
    const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
    let G: CityGraph | null = null, grid = new Map<string, { px: number; pz: number; r: number; what: string }[]>(), steps = 0, nearest = Infinity;
    for (let i = 0; i < minutes * 60 / SIM_DT; i++) {
      j.step();
      if (j.st.mode !== "drive" || !j.path) continue;
      if (j.plan.graph !== G) {
        G = j.plan.graph; grid = new Map();
        const put = (px: number, pz: number, r: number, what: string) => { const k = cellOf(px, pz), e = { px, pz, r, what }; grid.get(k)?.push(e) ?? grid.set(k, [e]); };
        for (const n of G.nodes) {
          if (n.control === "signal") for (const p of signalPoles(G, n)) put(p.px, p.pz, POLE_R, "a signal pole");
          if (n.control === "stop") for (const [x, z] of stopSignPosts(G, n).values()) put(x, z, STOP_PLATE, "a stop sign");
        }
      }
      steps++;
      const m = j.st.truck, E = truckExtents(m), h = j.pose.h, fx = Math.cos(h), fz = -Math.sin(h);
      // (Boxes: centre, forward, half length, half width.)
      const boxes: [number, number, number, number, number, number][] = [];
      const fw = SPECS[m].fifthWheel;
      if (fw !== undefined) {
        const th = h + j.hitchYaw, tx = Math.cos(th), tz = -Math.sin(th), kx = j.pose.x + fx * fw, kz = j.pose.z + fz * fw, c = (TRAILER.front + TRAILER.rear) / 2;
        boxes.push([j.pose.x + fx * (E.front + fw) / 2, j.pose.z + fz * (E.front + fw) / 2, fx, fz, (E.front - fw) / 2 + 0.5, 1.25]);
        boxes.push([kx + tx * c, kz + tz * c, tx, tz, (TRAILER.front - TRAILER.rear) / 2, TRAILER.hw]);
      } else boxes.push([j.pose.x + fx * E.center, j.pose.z + fz * E.center, fx, fz, (E.front - E.rear) / 2, 1.25]);
      const gx = Math.floor(j.pose.x / 40), gz = Math.floor(j.pose.z / 40);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const p of grid.get(`${gx + dx},${gz + dz}`) ?? []) for (const [cx, cz, ax, az, L, W] of boxes) {
        const u = (p.px - cx) * ax + (p.pz - cz) * az, v = (p.px - cx) * az - (p.pz - cz) * ax;
        const d = Math.hypot(Math.max(0, Math.abs(u) - L), Math.max(0, Math.abs(v) - W)) - p.r;
        nearest = Math.min(nearest, d);
        if (d <= 0 && errs.length < 400) errs.push(`seed ${seed}: t${j.st.simTime.toFixed(1)} the ${m} drove through ${p.what} at (${p.px.toFixed(1)}, ${p.pz.toFixed(1)}), city ${j.st.city}`);
      }
    }
    console.log(`signalposts: seed ${seed} driven ${minutes} min (${steps} steps), nearest a pole or post came to the truck ${nearest.toFixed(2)} m`);
    if (!steps) errs.push(`seed ${seed}: never drove`);
  }
  console.log(`signalposts: ${misses.none} approaches without; ${poles} poles and ${stopPosts} stop sign posts in ${towns * 3} cities (${furnChecked} checked against the furniture), ${bad} in the way, nearest path ${worst.toFixed(2)} m (needs ${CLEAR.toFixed(2)})`);
  if (!poles) errs.push("no signal poles");
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
