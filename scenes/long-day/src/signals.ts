// Traffic signals. Every signalled intersection cycles through its phases (one per pair of
// opposite approaches, citygraph.ts), each green for SIG_GREEN, yellow for SIG_YELLOW, then all
// red for the rest of its SIG_SLOT, with its own offset (a hash of its key), so a light's state is
// a pure function of journey time: the driving code asks signalState() and the lamps compute the
// same thing in their vertex shader. Lamps are ordinary geometry in each chunk's lamp batch,
// tagged with (offset, phase, phases, colour); nothing is updated per frame except uniforms. On
// the old grid (two phases): east-west green from 0 to 10 s, yellow to 12.5, all red to 13, then
// north-south the same, a 26 s cycle.
import type { PlateSet } from "./signs.ts";
import * as THREE from "three@0.187.0";
import { hash2 } from "./rng.ts";
import { Batch } from "./geom.ts";
import type { CityGraph, CNode } from "./citygraph.ts";

const SIG_GREEN = 10, SIG_YELLOW = 2.5, SIG_SLOT = 13;
export const SIGNAL_CYCLE = 2 * SIG_SLOT;            // a two-phase intersection's cycle
const SIGNAL_WRAP = 12 * SIG_SLOT;                   // what the lamps' time wraps at: a whole number of cycles of 2, 3 or 4 phases
export type SignalColor = "green" | "yellow" | "red";
export const signalCycle = (n: CNode) => Math.max(2, n.phases) * SIG_SLOT;
export function signalOffset(n: CNode, seed: number) { return hash2(n.kx, n.kz, seed, 0x51c) * signalCycle(n); }
// The colour of `phase` at node n with no priority request, `t` seconds into its cycle.
function cycleColor(n: CNode, phase: number, time: number, seed: number): [SignalColor, number] {
  const t = (time + signalOffset(n, seed)) % signalCycle(n), slot = Math.floor(t / SIG_SLOT), w = t - slot * SIG_SLOT;
  return slot !== phase ? ["red", w] : w < SIG_GREEN ? ["green", w] : w < SIG_GREEN + SIG_YELLOW ? ["yellow", w] : ["red", w];
}

// Signal priority for the truck: as it comes up to a red light, the light usually changes for it
// (the other phases go yellow, then red, and the truck's way turns green), so it waits at only
// some of the reds a fixed cycle would give it. The journey decides (a function of its state, so
// it replays the same); the lamps, cross traffic and pedestrians follow `signalPreempt`.
// `ext`: the truck's green is held (it would have turned yellow before the truck got there).
// (x, z): the node's centre, for the lamps.
export interface SignalPreempt { node: number; x: number; z: number; phase: number; p0: number; p1: number; was: SignalColor; ext?: boolean }
export const PREEMPT_CHANCE = 0.8;
export const PREEMPT_MAX = 3;            // requests held at once (the next lights come up fast)
let signalPreempt: SignalPreempt[] = [];
// The request in force at this node at `time`, if any.
const preemptAt = (prs: SignalPreempt[] | null, node: number, time: number) => prs?.find((p) => p.node === node && time >= p.p0 && time < p.p1 + 3) ?? null;
function preemptState(prs: SignalPreempt[] | null, node: number, phase: number, time: number): SignalColor | null {
  const pr = preemptAt(prs, node, time);
  if (!pr) return null;
  if (pr.ext) return phase === pr.phase ? (time < pr.p1 ? "green" : time < pr.p1 + 2.5 ? "yellow" : "red") : "red";
  if (phase === pr.phase) return time < pr.p0 + 3 ? "red" : time < pr.p1 ? "green" : time < pr.p1 + 2.5 ? "yellow" : "red";
  return time < pr.p0 + 2.5 && pr.was !== "red" ? "yellow" : "red";
}
const preemptUniforms = { uPre: { value: [0, 1, 2].map(() => new THREE.Vector4(0, 0, 0, 0)) } };
const COLOR_CODE: Record<SignalColor, number> = { red: 0, yellow: 1, green: 2 };
// Each frame: the journey's priority requests, for the lamps and everyone else.
// uPre[i] = (x, z, the requested phase's colour + 1 + 4 * phase, the other phases' colour + 1),
// or zeros when unused.
export function setSignalPreempt(prs: SignalPreempt[], time: number) {
  signalPreempt = prs;
  for (let i = 0; i < PREEMPT_MAX; i++) {
    const pr = prs[i], u = preemptUniforms.uPre.value[i];
    const a = pr && preemptState([pr], pr.node, pr.phase, time), b = pr && preemptState([pr], pr.node, pr.phase + 1, time);
    if (pr && a && b) u.set(pr.x, pr.z, COLOR_CODE[a] + 1 + 4 * pr.phase, COLOR_CODE[b] + 1); else u.set(0, 0, 0, 0);
  }
}

export function signalState(n: CNode, phase: number, time: number, seed: number, pr: SignalPreempt[] | null = signalPreempt): SignalColor {
  if (n.control !== "signal") return "green";
  const o = preemptState(pr, n.id, phase, time);
  if (o) return o;
  return cycleColor(n, phase, time, seed)[0];
}

// Seconds until this approach next turns green (0 if green now).
export function signalWait(n: CNode, phase: number, time: number, seed: number): number {
  if (n.control !== "signal") return 0;
  const C = signalCycle(n), t = (time + signalOffset(n, seed)) % C, start = phase * SIG_SLOT;
  if (t >= start && t < start + SIG_GREEN) return 0;
  return ((start - t) % C + C) % C;
}

// Seconds of green left for this approach (0 unless green now), with the truck's priority
// requests `pr` taken into account when given (as signalState does).
export function signalGreenLeft(n: CNode, phase: number, time: number, seed: number, pr: SignalPreempt[] | null = null): number {
  if (n.control !== "signal") return Infinity;
  const q = preemptAt(pr, n.id, time);
  if (q) return preemptState([q], n.id, phase, time) === "green" ? q.p1 - time : 0;
  const [c, w] = cycleColor(n, phase, time, seed);
  return c === "green" ? SIG_GREEN - w : 0;
}
// A cycle number for hashing decisions per pass of the lights.
export const signalCycleIndex = (n: CNode, time: number) => Math.floor(time / signalCycle(n));

// Lamp tags: aux.x = lamp (0 red, 1 yellow, 2 green) * 64 + offset; aux.z = phase + 4 * (phases - 2).
const lampTag = (lamp: 0 | 1 | 2, offset: number) => lamp * 64 + offset;

// Journey time modulo SIGNAL_WRAP, so the shader's float32 time stays exact on long runs.
const signalUniforms = { uSignalTime: { value: 0 } };
export function setSignalTime(time: number) { signalUniforms.uSignalTime.value = time % SIGNAL_WRAP; }

// The lamp batch also carries neon and flags, told apart by aux.y (signal lamps leave it 0):
//   1 neon, steady with a rare flicker (aux.x = a seed)
//   2 neon, blinking (aux.x = phase)
//   3 neon, chasing (aux.x = this segment's index, aux.z = segments in the chase)
//   4 flag cloth, waving (aux.x = distance from the pole, aux.z = the angle of the cloth's normal
//     in the xz plane, which it ripples along)
// uSignalTime wraps every SIGNAL_WRAP seconds, so the wave and blink periods divide it (they
// divide 26, which divides it).
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
    float lamp = floor(aAux.x / 64.0), off = aAux.x - lamp * 64.0;
    float phases = floor(aAux.z / 4.0) + 2.0, phase = aAux.z - (phases - 2.0) * 4.0;
    float t = mod(uSignalTime + off, phases * ${SIG_SLOT.toFixed(1)});
    float slot = floor(t / ${SIG_SLOT.toFixed(1)}), w = t - slot * ${SIG_SLOT.toFixed(1)};
    float state = abs(slot - phase) > 0.5 ? 0.0 : (w < ${SIG_GREEN.toFixed(1)} ? 2.0 : (w < ${(SIG_GREEN + SIG_YELLOW).toFixed(1)} ? 1.0 : 0.0));
    vec2 wxz = (modelMatrix * vec4(position, 1.0)).xz;
    for (int i = 0; i < 3; i++) if (uPre[i].z > 0.5 && distance(wxz, uPre[i].xy) < 16.0) {
      float pz = floor((uPre[i].z - 1.0) / 4.0), pc = uPre[i].z - 1.0 - pz * 4.0;
      state = abs(phase - pz) < 0.5 ? pc : uPre[i].w - 1.0;
    }
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
  mat.customProgramCacheKey = () => "signal-lamp-v4";
  return mat;
}

const LAMP_COLORS = [0xff2a1a, 0xffb000, 0x22ff66];
const POLE = 0x2b2f33, HOUSING = 0x15181a;

// Mast-arm signals for node n, drawn relative to (ox, oz) (its tile's origin). Each approach gets
// a pole on the far right corner of the intersection and an arm reaching over its two lanes, with
// a head per lane. Poles and heads go in `solid`; lamps (boxes that protrude, so their tops read
// from the overhead camera) go in `lamps`. `plates`: for the name plates on the mast arms, each
// naming the cross street to the traffic coming up to it.
export function buildSignals(solid: Batch, lamps: Batch, G: CityGraph, n: CNode, ox: number, oz: number, seed: number, plates: PlateSet | null = null) {
  if (n.control !== "signal") return;
  const offset = signalOffset(n, seed), armY = 6.2, cx = n.x - ox, cz = n.z - oz;
  n.arms.forEach((arm, i) => {
    const st = G.streets[arm.street];
    if (!st.inCity && st.gate < 0) return;
    // The traffic coming in along this arm heads h; its right is r.
    const h = arm.h + Math.PI, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
    // The far side: the mouth of the arm straight ahead (or this one's, if none).
    let far = arm.mouth;
    for (const b of n.arms) if (Math.abs(Math.atan2(Math.sin(b.h - h), Math.cos(b.h - h))) < Math.PI / 4) far = b.mouth;
    const px = cx + fx * (far - 1.4) + rx * (st.half - 1.4), pz = cz + fz * (far - 1.4) + rz * (st.half - 1.4);
    const toCentre = st.half - 1.4, reach = toCentre + 0.4;
    solid.cyl(px, armY / 2, pz, 0.16, armY, POLE, 6);
    // The arm reaches back over the lanes (to the traffic's left).
    const ax = -rx, az = -rz, armH = Math.atan2(-az, ax);
    solid.box(px + ax * reach / 2, armY - 0.01, pz + az * reach / 2, reach + 0.16, 0.18, 0.16, POLE, armH);
    if (plates) {
      // The cross street's name on a plate over the arm, near the pole, facing the traffic: the
      // street of the arm nearest square to this one in another phase.
      let cross = "", best = Infinity;
      n.arms.forEach((b, j) => { if (n.phaseOf[j] === n.phaseOf[i]) return; const d = Math.abs(Math.abs(Math.atan2(Math.sin(b.h - arm.h), Math.cos(b.h - arm.h))) - Math.PI / 2); if (d < best) { best = d; cross = G.streets[b.street].name; } });
      if (cross) {
        const sx = px + ax * 2.3, sz = pz + az * 2.3, y = armY + 0.42;
        solid.box(sx, y, sz, 2.5, 0.42, 0.05, 0x1e6b3a, armH);
        solid.box(sx, armY + 0.12, sz, 0.06, 0.12, 0.06, POLE);
        plates.put(cross.toUpperCase(), sx - fx * 0.035, y, sz - fz * 0.035, 2.4, 0.3, Math.atan2(-fx, -fz));
      }
    }
    // One head over each lane centre (1.5 m and 4.5 m from the centre line), lamps facing the
    // approaching traffic: red on top, then yellow, then green.
    for (const lane of [1.5, 4.5]) {
      const hx = px + ax * (toCentre - lane), hz = pz + az * (toCentre - lane);
      solid.box(hx, armY - 0.75, hz, 0.36, 1.25, 0.44, HOUSING, h);
      for (const k of [0, 1, 2] as const) {
        lamps.aux.set(lampTag(k, offset), 0, n.phaseOf[i] + 4 * (Math.max(2, n.phases) - 2));
        lamps.box(hx - fx * 0.22, armY - 0.36 - k * 0.38, hz - fz * 0.22, 0.16, 0.3, 0.3, LAMP_COLORS[k], h);
      }
    }
  });
  lamps.aux.set(0, 0, -1);
}
