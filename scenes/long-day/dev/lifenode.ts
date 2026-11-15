// Node: street-life cost of replaying a city, with and without it. Args: minutes [env-json]
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
import { StreetLife } from "../src/life.ts";

{
  const argv: string[] = (globalThis as any).process.argv.slice(2);
  const minutes = Number(argv[0] ?? 25);
  const cfg = readConfig(JSON.parse(argv[1] ?? '{"seed":1}') as SceneEnv);
  const now = () => (globalThis as any).performance.now();
  let t0 = now(); const a = new Journey(cfg, minutes * 60); const plain = now() - t0;
  const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial();
  const life = new StreetLife(new Traffic(scene, mat, null), new Crowd(scene, mat), new Ambient(scene, mat));
  const b = new Journey(cfg, 0);
  b.seekTo(minutes * 60 - 0.05);
  t0 = now(); b.attachLife(life); const withLife = now() - t0;
  // Determinism: seek back 40 s and play forward again; compare saved life.
  const ref = life.save();
  const t = b.st.simTime + b.frac;
  b.seekTo(t - 40); b.seekTo(t);
  const again = life.save();
  t0 = now(); b.seekTo(t - 3); const backMs = now() - t0;
  console.log(`replay ${minutes}min: journey ${plain.toFixed(0)}ms, with life ${withLife.toFixed(0)}ms; back seek ${backMs.toFixed(1)}ms; replay ${ref === again ? "identical" : "DIFFERS"} (${(ref.length / 1024).toFixed(0)}KB per keyframe)`);
}
