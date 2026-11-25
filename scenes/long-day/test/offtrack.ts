// Test: a tractor-trailer never cuts through a corner's building as it turns. Fails if any part of
// it (its cab, or its trailer at its own angle) comes CUT_MAX past the back of the sidewalk into a
// block while it drives a city's streets. Seeds 0 and 3 drive one through a catalogue city about
// 12 minutes in. Generated cities once showed the fault (3.5 m and 3.3 m in): right turns kerb lane
// to kerb lane, on the 6.5 m radius a box truck takes, the trailer's axles 13 m back off-tracking
// across the corner's sidewalk and into the building on it. Its right turns are now wide ones
// (route.ts), from the inner lane round onto the inner lane's far side. A spare tractor parked for
// a swap stands back from the corner by the leg its wide right out needs (journey.ts). (Not covered
// here: pulling away from a kerb stop just short of a right, and a swing carried on through a close
// turn after; no natural seed found yet. DEBUG_CARGO=pallets sweeps over seeds 1-24 and 39 hit them.)
// Args (all optional): minutes seed...
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT } from "../src/journey.ts";
import { SPECS, TRAILER, truckExtents } from "../src/truck.ts";
import { TILE } from "../src/citygraph.ts";
{
  const proc = (globalThis as any).process, argv: string[] = proc.argv.slice(2), CUT_MAX = 0.3, errs: string[] = [];
  const minutes = Number(argv[0] ?? 25), seeds = argv.length > 1 ? argv.slice(1).map(Number) : [0, 3];
  const TILE_R = 5;
  for (const seed of seeds) {
    const j = new Journey(readConfig({ seed } as any), 0, "autumn");
    let driven = 0, worst = 0, where = "", lastMode = "", prevMode = "", scrubbed = false;
    for (let i = 0; i < minutes * 60 / SIM_DT; i++) {
      j.step();
      if (j.st.mode !== lastMode) { prevMode = lastMode; lastMode = j.st.mode; }
      // (Not while its trailer is still in a bay it pulled out of, or out on the road it came in by.)
      if (j.st.mode !== "drive" || j.st.truck !== "tractor" || !j.path || (j.path.dockOut > 0 && j.st.s < j.path.dockOut + 20) || (prevMode === "inbound" && j.st.s < 25)) continue;
      driven++;
      // (Scrubbed back a little and played on again, as a seek restores it from a keyframe and
      // rebuilds its path from its route: back where it was, wide turns and all.)
      if (!scrubbed && j.st.route?.wide && j.st.s > 30) {
        scrubbed = true;
        const t = j.st.simTime, x = j.pose.x, z = j.pose.z;
        j.seekTo(t - 5); j.advanceTo(t);
        if (Math.hypot(j.pose.x - x, j.pose.z - z) > 1e-6) errs.push(`seed ${seed}: scrubbed back and played on, the tractor is ${Math.hypot(j.pose.x - x, j.pose.z - z).toFixed(2)} m off`);
      }
      const G = j.plan.graph, h = j.pose.h, fx = Math.cos(h), fz = -Math.sin(h), fw = SPECS.tractor.fifthWheel!;
      const th = h + j.hitchYaw, tx = Math.cos(th), tz = -Math.sin(th), kx = j.pose.x + fx * fw, kz = j.pose.z + fz * fw;
      // (The cab's and the trailer's outlines, every half metre: (x, z) + forward * a + right * b.)
      const pts: [number, number][] = [];
      const outline = (x: number, z: number, ax: number, az: number, a0: number, a1: number, w: number) => {
        for (let a = a0; a <= a1 + 1e-6; a += 0.5) for (const b of [-w, w]) pts.push([x + ax * a + az * b, z + az * a - ax * b]);
      };
      outline(j.pose.x, j.pose.z, fx, fz, -1.5, truckExtents("tractor").front, 1.25);
      outline(kx, kz, tx, tz, TRAILER.rear, TRAILER.front, TRAILER.hw);
      for (const [x, z] of pts) {
        // (How far outside every street's strip, centre line to the back of the sidewalk; a street's
        // end opens into its junction's square.)
        let out = Infinity;
        const gx = Math.floor(x / TILE), gz = Math.floor(z / TILE);
        for (let dz = -TILE_R; dz <= TILE_R; dz++) for (let dx = -TILE_R; dx <= TILE_R; dx++)
          for (const id of G.tile(gx + dx, gz + dz).streets) {
            const st = G.streets[id], [s, o] = G.toStreet(id, x, z), p = G.streetPt(id, s, o);
            out = Math.min(out, Math.max(Math.abs(o) - st.half, Math.hypot(p.x - x, p.z - z) - st.half));
          }
        if (out > worst) { worst = out; where = `t${j.st.simTime.toFixed(0)} city ${j.st.city} at ${x.toFixed(1)},${z.toFixed(1)}`; }
      }
    }
    console.log(`seed ${seed}: ${driven} tractor steps driven, worst ${worst.toFixed(2)} m into a block${where ? ` (${where})` : ""}`);
    if (!driven) errs.push(`seed ${seed}: no tractor-trailer drove`);
    if (!scrubbed) errs.push(`seed ${seed}: no tractor route scrubbed`);
    if (worst > CUT_MAX) errs.push(`seed ${seed}: trailer ${worst.toFixed(2)} m into a block at ${where}`);
  }
  if (errs.length) { console.error(errs.join("\n")); proc.exit(1); }
  console.log("offtrack ok");
}
