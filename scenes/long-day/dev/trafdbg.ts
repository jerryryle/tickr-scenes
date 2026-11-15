// Node: cars that got stuck in traffic, per city. Args: minutes [env-json] [trace-car-id]
import * as THREE from "three@0.187.0";
import { readConfig } from "../src/env.ts";
import { Journey } from "../src/journey.ts";
import { Traffic } from "../src/traffic.ts";
import { Crowd } from "../src/crowd.ts";
import { Ambient } from "../src/ambient.ts";
import { StreetLife } from "../src/life.ts";

{
  const argv: string[] = (globalThis as any).process.argv.slice(2);
  const minutes = Number(argv[0] ?? 30);
  const cfg = readConfig(JSON.parse(argv[1] ?? '{"seed":1}') as SceneEnv);
  const scene = new THREE.Scene(), mat = new THREE.MeshBasicMaterial();
  const life = new StreetLife(new Traffic(scene, mat, null), new Crowd(scene, mat), new Ambient(scene, mat));
  const j = new Journey(cfg, 0);
  j.attachLife(life);
  const seen = new Map<string, any>();
  (globalThis as any).TRAFFIC_DEBUG = (o: any) => {
    const key = `${j.st.city}/${o.id}`;
    const e = { t: (j.st.simTime / 60).toFixed(2), mode: j.st.mode, tv: j.st.v.toFixed(1), tx: j.pose.x.toFixed(1), tz: j.pose.z.toFixed(1), th: j.pose.h.toFixed(2), ...o };
    if (!seen.has(key) || o.stillT > seen.get(key).stillT) seen.set(key, e);
  };
  const tr = Number(argv[2] ?? -1);
  if (tr >= 0) { (globalThis as any).TRACE_CAR = tr; j.advanceTo(minutes * 60 - 14); (globalThis as any).TRACE_ON = true; }
  j.advanceTo(minutes * 60);
  for (const [k, e] of seen) console.log(k, JSON.stringify(e));
  console.log("stuck cars:", seen.size);
}
