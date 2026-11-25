// Test: a dock door (dockfx.ts DockFx) goes up as the truck backs into the bay and comes down as
// it pulls out without a jump: never shut for a moment while the truck waits in the bay for its
// route out (dockExit), and a tractor-trailer's, timed by its trailer, neither snapping open as
// it docks nor half down the moment it leaves. Steps journeys through a box truck's and a
// tractor's dock stops and checks the open doorway's height from one step to the next, that it
// lies between them half way through a step (as a frame between steps draws it), and that the
// door goes all the way up at every stop; and that the leveller's lip never comes, goes or moves
// to another bay within 40 m of the truck (it hangs ready before the truck arrives and after it
// leaves).
// Args (all optional): seed:minutes ... (the journeys to step; each must reach a dock stop)
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey, SIM_DT } from "../src/journey.ts";
import { DockFx } from "../src/dockfx.ts";
{
  const proc = (globalThis as any).process;
  const runs: string[] = proc.argv.length > 2 ? proc.argv.slice(2) : ["1:12", "4:13"];   // (seed 4's first tractor dock is at ~12 min)
  const errs: string[] = [];
  let problems = 0;
  const fail = (m: string) => { problems++; if (errs.length < 10) errs.push(m); };
  const docked: Record<string, number> = {};
  const MAX_STEP = 1.0;   // metres of doorway per 0.1 s step: backing in at walking pace moves it ~0.3
  for (const run of runs) {
    const [seed, minutes] = run.split(":").map(Number);
    const j = new Journey(readConfig({ seed } as SceneEnv), 0, "autumn");
    const fx = new DockFx(new THREE.Scene()), hole = (fx as any).hole as THREE.Mesh, lip = (fx as any).lip as THREE.Object3D;
    let prev = 0, pmode = j.st.mode, top = 0, plip = false, stops = 0;
    const lipAt = new THREE.Vector3();
    const near = (p: THREE.Vector3) => Math.hypot(j.pose.x - p.x, j.pose.z - p.z) < 40;
    const doorway = () => (hole.visible ? hole.scale.y : 0);
    for (let i = 0, n = Math.round(minutes * 600); i < n; i++) {
      j.step();
      j.frac = -SIM_DT / 2; fx.update(j); const mid = doorway();
      j.frac = 0; fx.update(j);
      const h = doorway(), st = j.st;
      if ((mid < Math.min(prev, h) - 1e-6 || mid > Math.max(prev, h) + 1e-6))
        fail(`seed ${seed} t${st.simTime.toFixed(1)} ${st.truck} ${pmode}->${st.mode}: half way through the step the doorway is ${mid.toFixed(3)} m, outside ${prev.toFixed(3)}..${h.toFixed(3)}`);
      if (Math.abs(h - prev) > MAX_STEP)
        fail(`seed ${seed} t${st.simTime.toFixed(1)} ${st.truck} ${pmode}->${st.mode}${st.dockExit ? " (in the bay)" : ""}: doorway ${prev.toFixed(2)} -> ${h.toFixed(2)} m`);
      if (st.mode === "dwell" && pmode === "reverse") { docked[st.truck] = (docked[st.truck] ?? 0) + 1; top = 0; stops++; }
      if (st.mode === "dwell") top = Math.max(top, h);
      if (pmode === "dwell" && st.mode !== "dwell" && st.dockExit && top < (st.dockExit.geom.door?.h ?? 0) - 1e-6)
        fail(`seed ${seed} t${st.simTime.toFixed(1)} ${st.truck}: the door only went ${top.toFixed(2)} m up of ${st.dockExit.geom.door!.h.toFixed(2)}`);
      const pop = plip && !lip.visible ? (near(lipAt) ? "goes" : "")
        : !plip && lip.visible ? (near(lip.position) ? "comes" : "")
        : plip && lip.visible && lip.position.distanceTo(lipAt) > 1 && (near(lipAt) || near(lip.position)) ? "moves to another bay" : "";
      if (pop) fail(`seed ${seed} t${st.simTime.toFixed(1)} ${st.truck} ${pmode}->${st.mode}: the leveller lip ${pop} beside the truck`);
      prev = h; pmode = st.mode; plip = lip.visible;
      if (plip) lipAt.copy(lip.position);
    }
    if (!stops) fail(`seed ${seed}: no dock stop in ${minutes} min`);
  }
  if (!proc.argv[2] && !(docked.tractor && Object.keys(docked).some((k) => k !== "tractor"))) fail("didn't reach both a box truck's and a tractor's dock stop");
  console.log(`dock doors: ${Object.entries(docked).map(([k, v]) => `${v} ${k}`).join(", ") || "no"} dock stops, ${problems} problems`);
  if (problems) { for (const e of errs) console.error(e); proc.exit(1); }
}
