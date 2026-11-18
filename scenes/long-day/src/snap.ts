// Saving and restoring the state of the presentation (the camera director, the trucks' moving
// parts, the crew's springs, the puffs): main.ts keeps a snapshot every 10 s of journey in the
// preview, so a scrub back restores the nearest one and replays the fixed ticks from there; every
// frame it also saves and restores around the part-tick that draws the moment between two ticks.
//
// A field's value is copied when it is plain data: numbers, strings, booleans, null, three.js
// vectors, quaternions, eulers and colours, and arrays and plain objects of those. Anything else
// (meshes, materials, functions, maps, other objects) is a reference the snapshot leaves alone.
// That is silent, so a new stateful field that isn't plain data (an Rng, a Map) would drop out of
// the snapshots unnoticed: the scrub-test builds record every field left out (SNAP_SKIPPED, which
// main.ts logs once each), to check against what is meant to be a reference.
import * as THREE from "three@0.187.0";
import { DEBUG_CAMLOG, DEBUG_SCRUBTEST } from "./debug.ts";

export const SNAP_SKIPPED = new Set<string>();   // "Class.field", scrub-test builds only

const SKIP = Symbol("skip");
type Snap = Record<string, unknown>;

function snapClone(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean") return v;
  if (t !== "object") return SKIP;
  if (v instanceof THREE.Vector3 || v instanceof THREE.Vector2 || v instanceof THREE.Vector4 || v instanceof THREE.Quaternion || v instanceof THREE.Euler || v instanceof THREE.Color) return (v as any).clone();
  if (Array.isArray(v)) {
    const out = new Array(v.length);
    for (let i = 0; i < v.length; i++) { const c = snapClone(v[i]); if (c === SKIP) return SKIP; out[i] = c; }
    return out;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return SKIP;
  const out: Snap = {};
  for (const k of Object.keys(v as object)) { const c = snapClone((v as any)[k]); if (c === SKIP) return SKIP; out[k] = c; }
  return out;
}

// The plain-data fields of `obj` (all of them, or only `keys`), leaving out `skip`.
export function saveFields(obj: object, keys: readonly string[] | null = null, skip: readonly string[] = []): Snap {
  const out: Snap = {};
  for (const k of keys ?? Object.keys(obj)) {
    if (skip.includes(k)) continue;
    const c = snapClone((obj as any)[k]);
    if (c !== SKIP) out[k] = c;
    else if (DEBUG_SCRUBTEST || DEBUG_CAMLOG) SNAP_SKIPPED.add(`${obj.constructor.name}.${k}`);
  }
  return out;
}

// Put saved fields back: vectors and the like are copied into the object's own (other objects may
// hold them), everything else gets a fresh copy (so the snapshot can be restored again).
export function loadFields(obj: object, s: Snap) {
  const o = obj as any;
  for (const k of Object.keys(s)) {
    const v = s[k], cur = o[k];
    if (v && cur && typeof cur.copy === "function" && cur.constructor === (v as any).constructor) cur.copy(v);
    else o[k] = snapClone(v);
  }
}
