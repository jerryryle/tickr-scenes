// Traffic signals. Every intersection runs the same fixed cycle with its own offset (a hash of
// its grid position), so a light's state is a pure function of journey time: the driving code
// asks signalState() and the lamps compute the same thing in their vertex shader. Lamps are
// ordinary geometry in each chunk's lamp batch, tagged with (offset, axis, colour); nothing is
// updated per frame except one uniform.
//   t in [0, 10)      east-west green   north-south red
//   t in [10, 12.5)   east-west yellow
//   t in [12.5, 13)   all red
//   t in [13, 23)     north-south green
//   t in [23, 25.5)   north-south yellow
//   t in [25.5, 26)   all red
import * as THREE from "three@0.187.0";
import { hash2 } from "./rng.ts";
import { Batch } from "./geom.ts";
import { nodeX, nodeZ } from "./route.ts";

export const SIGNAL_CYCLE = 26;
const SIG_GREEN = 10, SIG_YELLOW = 2.5, SIG_HALF = SIGNAL_CYCLE / 2;
export type SignalAxis = 0 | 1;          // 0 = east-west traffic, 1 = north-south traffic
export type SignalColor = "green" | "yellow" | "red";

export function signalOffset(ix: number, iz: number, seed: number) { return hash2(ix, iz, seed, 0x51c) * SIGNAL_CYCLE; }

// Signal priority for the truck: as it comes up to a red light, the light usually changes for it
// (the cross street goes yellow, then red, and the truck's way turns green), so it waits at only
// some of the reds a fixed cycle would give it. The journey decides (a function of its state, so
// it replays the same); the lamps, cross traffic and pedestrians follow `signalPreempt`.
// `ext`: the truck's green is held (it would have turned yellow before the truck got there).
export interface SignalPreempt { ix: number; iz: number; axis: SignalAxis; p0: number; p1: number; was: SignalColor; ext?: boolean }
export const PREEMPT_CHANCE = 0.8;
export const PREEMPT_MAX = 3;            // requests held at once (the next lights come up fast)
let signalPreempt: SignalPreempt[] = [];
function preemptState(prs: SignalPreempt[] | null, ix: number, iz: number, axis: SignalAxis, time: number): SignalColor | null {
  const pr = prs?.find((p) => p.ix === ix && p.iz === iz && time >= p.p0 && time < p.p1 + 3);
  if (!pr) return null;
  if (pr.ext) return axis === pr.axis ? (time < pr.p1 ? "green" : time < pr.p1 + 2.5 ? "yellow" : "red") : "red";
  if (axis === pr.axis) return time < pr.p0 + 3 ? "red" : time < pr.p1 ? "green" : time < pr.p1 + 2.5 ? "yellow" : "red";
  return time < pr.p0 + 2.5 && pr.was !== "red" ? "yellow" : "red";
}
const preemptUniforms = { uPre: { value: [0, 1, 2].map(() => new THREE.Vector4(0, 0, 0, 0)) } };
const COLOR_CODE: Record<SignalColor, number> = { red: 0, yellow: 1, green: 2 };
// Each frame: the journey's priority request, for the lamps and everyone else.
// uPre[i] = (x, z, axis-0 colour + 1, axis-1 colour + 1), or zeros when unused.
export function setSignalPreempt(prs: SignalPreempt[], time: number) {
  signalPreempt = prs;
  for (let i = 0; i < PREEMPT_MAX; i++) {
    const pr = prs[i], u = preemptUniforms.uPre.value[i];
    const a = pr && preemptState([pr], pr.ix, pr.iz, 0, time), b = pr && preemptState([pr], pr.ix, pr.iz, 1, time);
    if (pr && a && b) u.set(nodeX(pr.ix), nodeZ(pr.iz), COLOR_CODE[a] + 1, COLOR_CODE[b] + 1); else u.set(0, 0, 0, 0);
  }
}

export function signalState(ix: number, iz: number, axis: SignalAxis, time: number, seed: number, pr: SignalPreempt[] | null = signalPreempt): SignalColor {
  const o = preemptState(pr, ix, iz, axis, time);
  if (o) return o;
  let t = (time + signalOffset(ix, iz, seed)) % SIGNAL_CYCLE;
  if (axis === 1) t = (t + SIG_HALF) % SIGNAL_CYCLE;
  return t < SIG_GREEN ? "green" : t < SIG_GREEN + SIG_YELLOW ? "yellow" : "red";
}

// Seconds until this approach next turns green (0 if green now).
export function signalWait(ix: number, iz: number, axis: SignalAxis, time: number, seed: number): number {
  let t = (time + signalOffset(ix, iz, seed)) % SIGNAL_CYCLE;
  if (axis === 1) t = (t + SIG_HALF) % SIGNAL_CYCLE;
  return t < SIG_GREEN ? 0 : SIGNAL_CYCLE - t;
}

// Seconds of green left for this approach (0 unless green now).
export function signalGreenLeft(ix: number, iz: number, axis: SignalAxis, time: number, seed: number): number {
  let t = (time + signalOffset(ix, iz, seed)) % SIGNAL_CYCLE;
  if (axis === 1) t = (t + SIG_HALF) % SIGNAL_CYCLE;
  return t < SIG_GREEN ? SIG_GREEN - t : 0;
}

// Lamp tag (Batch.aux.x): lamp code * 32 + offset, where code = axis * 3 + (0 red, 1 yellow, 2 green).
function lampTag(axis: SignalAxis, lamp: 0 | 1 | 2, offset: number) { return (axis * 3 + lamp) * 32 + offset; }

// Journey time modulo the cycle, so the shader's float32 time stays exact on long runs.
const signalUniforms = { uSignalTime: { value: 0 } };
export function setSignalTime(time: number) { signalUniforms.uSignalTime.value = time % SIGNAL_CYCLE; }

// The lamp batch also carries neon and flags, told apart by aux.y (signal lamps leave it 0):
//   1 neon, steady with a rare flicker (aux.x = a seed)
//   2 neon, blinking (aux.x = phase)
//   3 neon, chasing (aux.x = this segment's index, aux.z = segments in the chase)
//   4 flag cloth, waving (aux.x = distance from the pole, aux.z = the angle of the cloth's normal
//     in the xz plane, which it ripples along)
// uSignalTime wraps every SIGNAL_CYCLE seconds, so the wave and blink periods divide it.
export const NEON_STEADY = 1, NEON_BLINK = 2, NEON_CHASE = 3, FLAG_WAVE = 4;

export function makeLampMaterial(): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, signalUniforms, preemptUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec3 aAux;
uniform float uSignalTime;
uniform vec4 uPre[${3}];
varying float vLit;
float lampHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
  if (aAux.y < 0.5) {
    float code = floor(aAux.x / 32.0);
    float t = mod(uSignalTime + (aAux.x - code * 32.0), ${SIGNAL_CYCLE.toFixed(1)});
    float axis = floor(code / 3.0), lamp = code - axis * 3.0;
    if (axis > 0.5) t = mod(t + ${SIG_HALF.toFixed(1)}, ${SIGNAL_CYCLE.toFixed(1)});
    float state = t < ${SIG_GREEN.toFixed(1)} ? 2.0 : (t < ${(SIG_GREEN + SIG_YELLOW).toFixed(1)} ? 1.0 : 0.0);
    vec2 wxz = (modelMatrix * vec4(position, 1.0)).xz;
    for (int i = 0; i < 3; i++) if (uPre[i].z > 0.5 && distance(wxz, uPre[i].xy) < 16.0) state = (axis > 0.5 ? uPre[i].w : uPre[i].z) - 1.0;
    vLit = abs(state - lamp) < 0.5 ? 1.0 : 0.0;
  } else if (aAux.y < 1.5) {
    vLit = lampHash(floor(uSignalTime * 9.0) + aAux.x * 7.13) > 0.975 ? 0.25 : 1.0;
  } else if (aAux.y < 2.5) {
    vLit = mod(uSignalTime + aAux.x, 1.3) < 0.85 ? 1.0 : 0.15;
  } else if (aAux.y < 3.5) {
    vLit = abs(mod(floor(uSignalTime * 4.0), max(aAux.z, 1.0)) - aAux.x) < 0.5 ? 1.0 : 0.2;
  } else {
    transformed += vec3(cos(aAux.z), 0.0, sin(aAux.z)) * sin(uSignalTime * 4.8332 - aAux.x * 2.2) * 0.12 * aAux.x;
    vLit = 1.0;
  }`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vLit;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb *= mix(0.12, 1.0, vLit);");
  };
  mat.customProgramCacheKey = () => "signal-lamp-v3";
  return mat;
}

const LAMP_COLORS = [0xff2a1a, 0xffb000, 0x22ff66];
const POLE = 0x2b2f33, HOUSING = 0x15181a;

// Mast-arm signals for the intersection occupying local [0, w) x [0, w) of a chunk, on a street
// with lanes from `kerb` to `w - kerb`. Each approach gets a pole on its far-right corner and an
// arm reaching over its two lanes with a head per lane. Poles and heads go in `solid`; lamps
// (boxes that protrude, so their tops read from the overhead camera) go in `lamps`.
export function buildSignals(solid: Batch, lamps: Batch, w: number, kerb: number, offset: number) {
  const c = w / 2;
  // Approaches: heading (unit dx, dz), the pole corner, the arm's direction, and the axis.
  // Facing the approaching traffic means the head's lamps point along -heading.
  const approaches: { hx: number; hz: number; px: number; pz: number; ax: number; az: number; axis: SignalAxis }[] = [
    { hx: 1, hz: 0, px: w - 1.4, pz: w - 1.4, ax: 0, az: -1, axis: 0 },   // eastbound, lanes c..w-kerb
    { hx: -1, hz: 0, px: 1.4, pz: 1.4, ax: 0, az: 1, axis: 0 },           // westbound
    { hx: 0, hz: 1, px: 1.4, pz: w - 1.4, ax: 1, az: 0, axis: 1 },        // southbound (+z)
    { hx: 0, hz: -1, px: w - 1.4, pz: 1.4, ax: -1, az: 0, axis: 1 },      // northbound (-z)
  ];
  const armY = 6.2;
  for (const a of approaches) {
    const toCentre = a.ax !== 0 ? Math.abs(a.px - c) : Math.abs(a.pz - c);
    const reach = toCentre + 0.4;                  // pole to just past the centre line
    const ew = a.hx !== 0;                         // head faces along x
    solid.cyl(a.px, armY / 2, a.pz, 0.16, armY, POLE, 6);
    const ex = a.px + a.ax * reach, ez = a.pz + a.az * reach;
    solid.span(Math.min(a.px, ex) - 0.08, armY - 0.1, Math.min(a.pz, ez) - 0.08,
               Math.max(a.px, ex) + 0.08, armY + 0.08, Math.max(a.pz, ez) + 0.08, POLE);
    // One head over each lane centre (1.5 m and 4.5 m from the centre line), lamps facing
    // the approaching traffic: red on top, then yellow, then green.
    for (const lane of [1.5, 4.5]) {
      const hx = a.px + a.ax * (toCentre - lane), hz = a.pz + a.az * (toCentre - lane);
      solid.box(hx, armY - 0.75, hz, ew ? 0.36 : 0.44, 1.25, ew ? 0.44 : 0.36, HOUSING);
      for (const k of [0, 1, 2] as const) {
        lamps.aux.set(lampTag(a.axis, k, offset), 0, 0);
        lamps.box(hx - a.hx * 0.22, armY - 0.36 - k * 0.38, hz - a.hz * 0.22, ew ? 0.16 : 0.3, 0.3, ew ? 0.3 : 0.16, LAMP_COLORS[k]);
      }
    }
  }
  lamps.aux.set(0, 0, -1);
}
