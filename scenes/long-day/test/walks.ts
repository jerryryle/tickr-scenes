// Test: at docks the driver's walks go round the vehicles parked in the yard, and every stand at
// the kerb has a door for the driver. Runs the journey with the scene's door, pavement and
// parked-vehicle probes and fails if a walk on the ground at a dock passes through a parked
// vehicle. (At the kerb the walks take no notice of what stands on the pavement: the city files
// keep each stop's work area clear, tools/clearstops.ts.)
// Args (all optional): minutes [env-json]. With none, two runs: seed 0 for 30 minutes, and seed
// 12 for 45, whose Lakeview Grocery dock has its steps past trailers parked in the yard.
import { readConfig } from "../src/env.ts";
import { Journey, setDoorProbe, setParkedProbe, setPavementProbe } from "../src/journey.ts";
import { kerbDoors, parkedObstacles, pavementObstacles } from "../src/city.ts";
import { siteLayout } from "../src/facilities.ts";

const proc = (globalThis as any).process;
setDoorProbe(kerbDoors); setPavementProbe(pavementObstacles); setParkedProbe(parkedObstacles);
const runs: [number, string][] = proc.argv.length > 2 ? [[Number(proc.argv[2]), proc.argv[3] ?? "{}"]] : [[30, "{}"], [45, '{"seed":12}']];
let failed = false;
for (const [minutes, envJson] of runs) {
  const cfg = readConfig(JSON.parse(envJson) as SceneEnv);
  const j = new Journey(cfg, 0, "autumn");
  const BODY = 0.32;
  // Walk legs on the ground that pass through a parked vehicle (world-axis boxes, in the truck's
  // frame by heading h): sampled every 10 cm, ignoring boxes a leg starts or ends beside.
  const throughParked = (chores: any[], boxes: { x: number; z: number; hx: number; hz: number }[], h: number) => {
    const ax = Math.cos(h), az = Math.sin(h);
    const inBox = (o: any, x: number, z: number, m: number) => { const dx = x - o.x, dz = z - o.z; return Math.abs(dx * ax + dz * az) < o.hx + m && Math.abs(-dx * az + dz * ax) < o.hz + m; };
    let n = 0;
    for (const c of chores) {
      if (c.kind !== "walk" || !c.a || !c.b || c.linear || c.a[1] !== 0 || c.b[1] !== 0) continue;
      const [x0, , z0] = c.a, [x1, , z1] = c.b, steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.1);
      for (const o of boxes) {
        if (inBox(o, x0, z0, BODY) || inBox(o, x1, z1, BODY)) continue;
        for (let i = 1; i < steps; i++) if (inBox(o, x0 + (x1 - x0) * i / steps, z0 + (z1 - z0) * i / steps, BODY - 0.08)) { n++; break; }
      }
    }
    return n;
  };
  let docks = 0, docksParked = 0, parkedHits = 0;
  let stands = 0, stops = 0, prevMode = j.st.mode;
  const errs: string[] = [];
  while (j.st.simTime < minutes * 60) {
    j.step();
    const st = j.st;
    if (st.mode === "dwell" && prevMode !== "dwell") {
      const stop = (j as any).dwellStop ?? st.stops[0];
      if (stop?.site && stop.kind !== "swap" && j.isDockStop(stop)) {
        docks++;
        const h = j.pose.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
        const boxes = parkedObstacles(j.plan, stop.site.bx, stop.site.bz).map((o) => {
          const px = o.x - j.pose.x, pz = o.z - j.pose.z;
          return { x: px * fx + pz * fz, z: px * rx + pz * rz, hx: o.hx, hz: o.hz };
        });
        if (boxes.length) docksParked++;
        const now = throughParked(j.chores, boxes, h);
        parkedHits += now;
        if (now && errs.length < 10) errs.push(`t${st.simTime.toFixed(0)} ${stop.site.name ?? ""}: ${now} walk legs through a parked vehicle at the dock`);
      }
      if (stop?.site && stop.kind !== "swap" && !j.isDockStop(stop)) {
        stops++;
        // A stand (park building, service bay container) always has a door for the driver (things don't appear from thin air).
        if (siteLayout(j.plan, stop.site.bx, stop.site.bz).kind === "stand") { stands++; if (!j.kerbDoor) errs.push(`t${st.simTime.toFixed(0)} ${stop.site.name ?? ""}: no door at the stand`); }
      }
    }
    prevMode = st.mode;
  }
  console.log(`${envJson} ${minutes} min`);
  console.log(`walks: ${stops} kerb stops (${stands} at stands)`);
  console.log(`docks: ${docks} dock stops (${docksParked} with vehicles parked in the yard), legs through them ${parkedHits}`);
  if (!stops) errs.push("no kerb stops");
  if (errs.length) { for (const e of errs) console.error(e); failed = true; }
}
if (failed) proc.exit(1);
