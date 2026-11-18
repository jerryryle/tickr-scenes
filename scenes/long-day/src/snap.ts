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
//
// The part-tick's save and restore run every frame, so both can work in place: a save given the
// last one (`into`) fills its vectors, arrays and objects again instead of making new ones, and a
// restore copies into the fields' own vectors, arrays and objects. (So two fields must not share
// one array or object: a restore fills it in turn from each field's saved copy.)
import * as THREE from "three@0.187.0";
import { DEBUG_CAMLOG, DEBUG_SCRUBTEST } from "./debug.ts";

export const SNAP_SKIPPED = new Set<string>();   // "Class.field", scrub-test builds only

const SKIP = Symbol("skip");
type Snap = Record<string, unknown>;

const isVector = (v: object) => v instanceof THREE.Vector3 || v instanceof THREE.Vector2 || v instanceof THREE.Vector4 || v instanceof THREE.Quaternion || v instanceof THREE.Euler || v instanceof THREE.Color;
const isPlain = (v: object) => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };
const own = Object.prototype.hasOwnProperty;

// A copy of plain data `v` (SKIP if it isn't plain data), made in `into` where that has the same
// shape (a vector of the same class, an array, a plain object), else new.
function snapCopy(v: unknown, into: unknown): unknown {
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === "number" || t === "string" || t === "boolean") return v;
  if (t !== "object") return SKIP;
  const o = v as any, w = into as any;
  if (isVector(o)) return w && typeof w === "object" && w.constructor === o.constructor ? w.copy(o) : o.clone();
  if (Array.isArray(o)) {
    const out: unknown[] = Array.isArray(w) ? w : new Array(o.length);
    out.length = o.length;
    for (let i = 0; i < o.length; i++) { const c = snapCopy(o[i], out[i]); if (c === SKIP) return SKIP; out[i] = c; }
    return out;
  }
  if (!isPlain(o)) return SKIP;
  const out: Snap = w && typeof w === "object" && !Array.isArray(w) && isPlain(w) ? w : {};
  for (const k in o) { const c = snapCopy(o[k], out[k]); if (c === SKIP) return SKIP; out[k] = c; }
  for (const k in out) if (!own.call(o, k)) delete out[k];
  return out;
}

// The plain-data fields of `obj` (all of them, or only `keys`), leaving out `skip`; in `into` (an
// earlier save of the same object) when given.
export function saveFields(obj: object, keys: readonly string[] | null = null, skip: readonly string[] = [], into?: Snap): Snap {
  const out: Snap = into ?? {}, o = obj as any;
  const one = (k: string) => {
    if (skip.includes(k)) return;
    const c = snapCopy(o[k], out[k]);
    if (c !== SKIP) out[k] = c;
    else { delete out[k]; if (DEBUG_SCRUBTEST || DEBUG_CAMLOG) SNAP_SKIPPED.add(`${obj.constructor.name}.${k}`); }
  };
  if (keys) for (let i = 0; i < keys.length; i++) one(keys[i]);
  else for (const k in o) one(k);
  return out;
}

// Put saved fields back, into the object's own vectors, arrays and plain objects where they have
// the same shape (other objects may hold them), else as new copies; the snapshot stays as it was,
// so it can be restored again.
export function loadFields(obj: object, s: Snap) {
  const o = obj as any;
  for (const k in s) o[k] = snapCopy(s[k], o[k]);
}
