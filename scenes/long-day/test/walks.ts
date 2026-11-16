// Test: at kerb stops the driver's walks go round what stands on the pavement (street trees,
// lights, furniture, sign posts). Runs the journey with the scene's door and pavement probes and
// fails if a walk on the ground passes through an obstacle that its route could have avoided.
// Args (all optional): minutes [env-json]
import { readConfig } from "../src/env.ts";
import { Journey, setDoorProbe, setPavementProbe } from "../src/journey.ts";
import { kerbDoors, pavementObstacles } from "../src/city.ts";
import { planChores } from "../src/chores.ts";

{
  const proc = (globalThis as any).process;
  const minutes = Number(proc.argv[2] ?? 30);
  const cfg = readConfig(JSON.parse(proc.argv[3] ?? "{}") as SceneEnv);
  setDoorProbe(kerbDoors); setPavementProbe(pavementObstacles);
  const j = new Journey(cfg, 0);
  const BODY = 0.32;
  // Walk legs that cut through an obstacle (not one the walk starts or ends inside).
  const crossings = (chores: any[], obs: { x: number; z: number; r: number }[]) => {
    let n = 0;
    for (const c of chores) {
      if (c.kind !== "walk" || !c.a || !c.b || c.linear || c.a[1] !== 0 || c.b[1] !== 0) continue;
      const [ax, , az] = c.a, [bx, , bz] = c.b, dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
      if (len < 0.3) continue;
      for (const o of obs) {
        const r = o.r + BODY - 0.02;
        if (Math.hypot(ax - o.x, az - o.z) < r + 0.02 || Math.hypot(bx - o.x, bz - o.z) < r + 0.02) continue;
        const t = Math.max(0, Math.min(len, ((o.x - ax) * dx + (o.z - az) * dz) / len));
        if (Math.hypot(ax + dx / len * t - o.x, az + dz / len * t - o.z) < r) n++;
      }
    }
    return n;
  };
  let stops = 0, withObs = 0, before = 0, after = 0, legs = 0, prevMode = j.st.mode;
  const errs: string[] = [];
  while (j.st.simTime < minutes * 60) {
    j.step();
    const st = j.st;
    if (st.mode === "dwell" && prevMode !== "dwell") {
      const stop = (j as any).dwellStop ?? st.stops[0];
      if (stop?.site && stop.kind !== "swap" && !j.isDockStop(stop)) {
        stops++;
        const h = j.pose.h, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
        const obs = pavementObstacles(j.plan, stop.site.bx, stop.site.bz).map((o) => {
          const px = o.x - j.pose.x, pz = o.z - j.pose.z;
          return { x: px * fx + pz * fz, z: px * rx + pz * rz, r: o.r };
        }).filter((o) => Math.abs(o.z) < 25);
        if (obs.length) withObs++;
        // The same stop planned straight (no obstacles), for comparison.
        const kd = j.kerbDoor;
        let door: { x: number; z: number; yaw: number } | null = null;
        if (kd) {
          const px = kd.x + kd.nx * 0.5 - j.pose.x, pz = kd.z + kd.nz * 0.5 - j.pose.z;
          door = { x: px * fx + pz * fz, z: px * rx + pz * rz, yaw: Math.atan2(-(-kd.nx * rx - kd.nz * rz), -kd.nx * fx - kd.nz * fz) };
        }
        const straight = planChores(st.truck, stop, null, stop.slot, null, null, door, []);
        before += crossings(straight, obs);
        const now = crossings(j.chores, obs);
        after += now;
        legs += j.chores.filter((c: any) => c.kind === "walk").length;
        if (now && errs.length < 10) errs.push(`t${st.simTime.toFixed(0)} ${stop.site.name ?? ""}: ${now} walk legs still through an obstacle`);
      }
    }
    prevMode = st.mode;
  }
  console.log(`walks: ${stops} kerb stops (${withObs} with pavement obstacles), crossings planned straight ${before}, routed ${after}, walk legs ${legs}`);
  if (!stops) errs.push("no kerb stops");
  if (errs.length) { for (const e of errs) console.error(e); proc.exit(1); }
}
