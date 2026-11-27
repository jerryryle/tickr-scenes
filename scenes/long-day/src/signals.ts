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
import { inPoly, polyDist, sidewalkCorner } from "./citygraph.ts";
import { STOP_BACK, Path, LANE_KERB, LANE_INNER } from "./route.ts";
import { SPECS } from "./truck.ts";
import { SB } from "./city-storybook/storybook-buildings-town.ts";
import { vicConstable, vicSignal } from "./city-victorian/victorian-street.ts";
import { NIGHT_GLOW } from "./atmosphere.ts";

const SIG_GREEN = 10, SIG_YELLOW = 2.5, SIG_SLOT = 13;
export const SIGNAL_CYCLE = 2 * SIG_SLOT;            // a two-phase intersection's cycle
const SIGNAL_WRAP = 12 * SIG_SLOT;                   // what the lamps' time wraps at: a whole number of cycles of 2, 3 or 4 phases
export type SignalColor = "green" | "yellow" | "red";
export const signalCycle = (n: CNode) => Math.max(2, n.phases) * SIG_SLOT;
export function signalOffset(n: CNode, seed: number) {
  const k = n.sigKey, C = signalCycle(n);
  return k ? (hash2(k[0], k[1], seed, 0x51c) * C + k[2]) % C : hash2(n.kx, n.kz, seed, 0x51c) * C;
}
// Lights too close together to stop between (the street between them shorter than a bus and a
// little: one stopped at the far light has its tail in the near junction, traffic.ts redBeyond)
// work as one: the far one's phase for that street green with the near one's, both ways along it,
// as one controller runs them. (Apart, each with its own offset, their greens may never meet, and
// a car waits through two lights' cycles at the first, its queue behind it.) Only lights of as many
// phases: their cycles must be the same length to keep in step. Linked in a chain
// from the first of each, each keyed by that one's key, its offset on by the phases between.
// Whether light a's phase pa and light b's phase pb are green together, always: lights of as many
// phases whose offsets differ by the phases between (linkSignals lines a short street's two ends up
// so). Two lights merely in one chain aren't: a third short street between two of them isn't lined up.
export function signalsInStep(a: CNode, pa: number, b: CNode, pb: number, seed: number) {
  if (a === b || a.phases !== b.phases || (!a.sigKey && !b.sigKey)) return false;
  const C = signalCycle(a), d = ((signalOffset(b, seed) - signalOffset(a, seed) - (pb - pa) * SIG_SLOT) % C + C) % C;
  return d < 1e-6 || C - d < 1e-6;
}
const LINK_ROOM = 18;   // m: the most clear street between the two junctions' mouths for which they are linked
export function linkSignals(G: CityGraph) {
  for (const N of G.nodes) if (N.control === "signal") delete N.sigKey;
  const root = new Map<number, [number, number, number]>();   // node -> its chain's first key, and seconds on from it
  for (const A of G.nodes) {
    if (A.control !== "signal") continue;
    for (const [ai, a] of A.arms.entries()) {
      const st = G.streets[a.street], B = G.nodes[a.end === 0 ? st.n1 : st.n0];
      if (B === A || B.control !== "signal" || B.phases !== A.phases || !st.inCity || st.ring) continue;
      const bi = B.arms.findIndex((b) => b.street === a.street && b.end !== a.end);
      if (bi < 0 || st.len - a.mouth - B.arms[bi].mouth > LINK_ROOM) continue;
      if (root.has(B.id)) continue;   // (B already in a chain, or the first of one: left as it is)
      const rA = root.get(A.id) ?? [A.kx, A.kz, 0];
      root.set(A.id, rA);
      const k: [number, number, number] = [rA[0], rA[1], rA[2] + (B.phaseOf[bi] - A.phaseOf[ai]) * SIG_SLOT + signalCycle(A) * 4];
      root.set(B.id, k); B.sigKey = k;
    }
  }
}
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
// `from`: the phase that was showing green or yellow when it was asked for (it goes yellow, then
// red; every other phase stays red), or absent (older saves: `was`, then, for all the others).
export interface SignalPreempt { node: number; x: number; z: number; phase: number; p0: number; p1: number; was: SignalColor; from?: number; ext?: boolean }
export const PREEMPT_CHANCE = 0.8;
export const PREEMPT_MAX = 3;            // requests held at once (the next lights come up fast)
let signalPreempt: SignalPreempt[] = [];
export const PREEMPT_CLEAR = 5;   // s from a priority request to the truck's green: 2.5 s yellow, 2.5 s all-red
// The request in force at this node at `time`, if any.
const preemptAt = (prs: SignalPreempt[] | null, node: number, time: number) => prs?.find((p) => p.node === node && time >= p.p0 && time < p.p1 + 3) ?? null;
function preemptState(prs: SignalPreempt[] | null, node: number, phase: number, time: number): SignalColor | null {
  const pr = preemptAt(prs, node, time);
  if (!pr) return null;
  if (pr.ext) return phase === pr.phase ? (time < pr.p1 ? "green" : time < pr.p1 + 2.5 ? "yellow" : "red") : "red";
  // (The truck's own phase turns green PREEMPT_CLEAR after the request: the others' yellow, then
  // an all-red while what crossed on the yellow clears the junction.)
  if (phase === pr.phase) return time < pr.p0 + PREEMPT_CLEAR ? "red" : time < pr.p1 ? "green" : time < pr.p1 + 2.5 ? "yellow" : "red";
  return time < pr.p0 + 2.5 && (pr.from === undefined ? pr.was !== "red" : phase === pr.from) ? "yellow" : "red";
}
const preemptUniforms = { uPre: { value: [0, 1, 2].map(() => new THREE.Vector4(0, 0, 0, 0)) } };
const COLOR_CODE: Record<SignalColor, number> = { red: 0, yellow: 1, green: 2 };
// Each frame: the journey's priority requests, for the lamps and everyone else.
// uPre[i] = (x, z, the requested phase's colour + 1 + 4 * phase + 16 * (its node's id + 1), the
// phase it was taken from's colour + 1 + 4 * (that phase + 1)), or zeros when unused. (That phase
// -1, unknown: the colour is every other phase's.) The lamps take it by their node's id (lampTag),
// not by how near they hang: a mast arm may reach as near another junction as its own.
export function setSignalPreempt(prs: SignalPreempt[], time: number) {
  signalPreempt = prs;
  for (let i = 0; i < PREEMPT_MAX; i++) {
    const pr = prs[i], u = preemptUniforms.uPre.value[i];
    const from = pr?.from ?? -1;
    const a = pr && preemptState([pr], pr.node, pr.phase, time), b = pr && preemptState([pr], pr.node, from >= 0 ? from : pr.phase + 1, time);
    if (pr && a && b) u.set(pr.x, pr.z, COLOR_CODE[a] + 1 + 4 * pr.phase + 16 * (pr.node + 1), COLOR_CODE[b] + 1 + 4 * (from + 1)); else u.set(0, 0, 0, 0);
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

// Lamp tags: aux.x = lamp (0 red, 1 yellow, 2 green) * 64 + offset; aux.y = -(its node's id + 1);
// aux.z = phase + 4 * (phases - 2). With `hide`, the lamp is 3 more: geometry drawn only while its
// state shows (a Victorian signal's semaphore arm in each of its positions) instead of dimmed.
// A pose (lamp LAMP_POSE) is geometry drawn only while its phase has the junction: from the start
// of its green to the start of the next phase's, through its yellow and all-red (a Victorian
// constable's pose for that phase). It is shaded as if lit, by a fixed light and darker after dark.
const LAMP_POSE = 6, POSE_NIGHT = 0.3;   // (POSE_NIGHT: how bright a pose is after dark, by NIGHT_GLOW)
const lampTag = (lamp: 0 | 1 | 2 | typeof LAMP_POSE, offset: number, hide = false) => (lamp + (hide ? 3 : 0)) * 64 + offset;

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
    Object.assign(shader.uniforms, signalUniforms, preemptUniforms, { uNight: NIGHT_GLOW });
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
attribute vec3 aAux;
uniform float uSignalTime;
uniform float uNight;
uniform vec4 uPre[${3}];
varying float vLit;
varying float vShade;
float lampHash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
  vShade = 1.0;
  if (aAux.y < 0.5) {
    float lamp = floor(aAux.x / 64.0), off = aAux.x - lamp * 64.0, pose = lamp > ${(LAMP_POSE - 0.5).toFixed(1)} ? 1.0 : 0.0, hide = lamp > 2.5 ? 1.0 : 0.0;
    lamp -= hide * 3.0;
    float phases = floor(aAux.z / 4.0) + 2.0, phase = aAux.z - (phases - 2.0) * 4.0;
    float t = mod(uSignalTime + off, phases * ${SIG_SLOT.toFixed(1)});
    float slot = floor(t / ${SIG_SLOT.toFixed(1)}), w = t - slot * ${SIG_SLOT.toFixed(1)};
    float state = abs(slot - phase) > 0.5 ? 0.0 : (w < ${SIG_GREEN.toFixed(1)} ? 2.0 : (w < ${(SIG_GREEN + SIG_YELLOW).toFixed(1)} ? 1.0 : 0.0));
    float holds = abs(slot - phase) < 0.5 ? 1.0 : 0.0;
    vec2 wxz = (modelMatrix * vec4(position, 1.0)).xz;
    for (int i = 0; i < 3; i++) {
      float tag = floor(uPre[i].z / 16.0), code = uPre[i].z - tag * 16.0;
      // (Its own node's request: by id, and near, as the next city's nodes number from 0 again.)
      if (code < 0.5 || abs(tag + aAux.y) > 0.5 || distance(wxz, uPre[i].xy) > 60.0) continue;
      float pz = floor((code - 1.0) / 4.0), pc = code - 1.0 - pz * 4.0;
      float fz = floor((uPre[i].w - 1.0) / 4.0) - 1.0, fc = uPre[i].w - 1.0 - (fz + 1.0) * 4.0;
      state = abs(phase - pz) < 0.5 ? pc : (fz < -0.5 || abs(phase - fz) < 0.5 ? fc : 0.0);
      // (The requested phase has the junction once the phase it was taken from shows red.)
      holds = abs(phase - pz) < 0.5 ? step(fc, 0.5) : (fz < -0.5 || abs(phase - fz) < 0.5 ? step(0.5, fc) : 0.0);
    }
    vLit = pose > 0.5 ? holds : (abs(state - lamp) < 0.5 ? 1.0 : 0.0);
    if (hide > 0.5 && vLit < 0.5) transformed = vec3(0.0);
    if (pose > 0.5) vShade = (0.55 + 0.45 * max(dot(normal, vec3(0.32, 0.84, 0.43)), 0.0)) * mix(1.0, ${POSE_NIGHT.toFixed(2)}, uNight);
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
      .replace("#include <common>", "#include <common>\nvarying float vLit;\nvarying float vShade;")
      .replace("#include <color_fragment>", "#include <color_fragment>\n  diffuseColor.rgb *= mix(0.12, 1.0, vLit) * vShade;");
  };
  mat.customProgramCacheKey = () => "signal-lamp-v7";
  return mat;
}

const LAMP_COLORS = [0xff2a1a, 0xffb000, 0x22ff66];
const POLE = 0x2b2f33, HOUSING = 0x15181a;
// The storybook city's (`story`) are sweets: candy-striped poles with gumball tops, round housings
// with round lamps, and stop signs like iced biscuits on peppermint posts.
// (A candy pole's stripes are open tubes, `band` long: its top is capped by what stands on it.)
const candyPole = (b: Batch, x: number, z: number, y0: number, y1: number, r: number, band: number, a: number, c: number) => {
  for (let y = y0, k = 0; y < y1 - 1e-6; y += band, k++) { const h = Math.min(band, y1 - y); b.tubeSeg(x, y + h / 2, z, r, h, k % 2 ? a : c, 6); }
};

// An all-way stop's signs for node n (control "stop"), relative to (ox, oz): on each approach, a
// stop sign on a post on the right-hand sidewalk, just short of the stop line, facing
// the traffic coming up to it. The sign is a red octagon 75 cm across with a white rim and STOP in
// white, bolted to the front of its post (the post hidden behind it, seen only below it), with a
// plain grey back.
const STOP_GLYPHS = [["###", "#..", "###", "..#", "###"], ["###", ".#.", ".#.", ".#.", ".#."], ["###", "#.#", "#.#", "#.#", "###"], ["###", "#.#", "###", "#..", "#.."]];
// (Where its posts stand, world (x, z), one per approach: stopSignPosts.) The Victorian city
// (`vic`) has no signs: its all-way stops are unmarked junctions, where traffic gives way in turn.
export function buildStopSigns(solid: Batch, G: CityGraph, n: CNode, ox: number, oz: number, story = false, vic = false) {
  if (n.control !== "stop" || vic) return;
  const y0 = 2.15, post = 0.04, posts = stopSignPosts(G, n);
  n.arms.forEach((arm, i) => {
    const at = posts.get(i);
    if (!at) return;
    // Out along the arm: (ux, uz), towards the traffic coming in, is the way the sign faces; that
    // traffic's right is (rx, rz).
    const ux = Math.cos(arm.h), uz = -Math.sin(arm.h), rx = -uz, rz = ux;
    const px = at[0] - ox, pz = at[1] - oz;
    if (story) { candyPole(solid, px, pz, 0, y0 + 0.45, post + 0.02, 0.6, SB.red, SB.cream); solid.ico(px, y0 + 0.5, pz, 0.08, SB.mustard); }
    else solid.cyl(px, (y0 + 0.2) / 2, pz, post, y0 + 0.2, POLE, 6);
    // A polygon of `sides` and circumradius R, d in front of the post's axis, facing (fx, fz). With
    // `crinkle`, every other corner is that much further in, and the polygon is fanned from its
    // middle because a fan from a corner would fill the notches beside that corner.
    const polygon = (sides: number, R: number, d: number, color: number, fx: number, fz: number, crinkle = 0) => {
      const qx = px + ux * d, qz = pz + uz * d, pts: [number, number, number][] = [];
      for (let k = 0; k < sides; k++) { const a = Math.PI / sides + k * 2 * Math.PI / sides, r = R - (k % 2) * crinkle; pts.push([qx + rx * r * Math.cos(a), y0 + r * Math.sin(a), qz + rz * r * Math.cos(a)]); }
      if (crinkle > 0) for (let k = 0; k < sides; k++) solid.tri(qx, y0, qz, ...pts[k], ...pts[(k + 1) % sides], color, [fx, 0, fz]);
      else for (let k = 1; k + 1 < sides; k++) solid.tri(...pts[0], ...pts[k], ...pts[k + 1], color, [fx, 0, fz]);
    };
    if (story) {
      // (A round biscuit with a crinkled white rim of icing, all within STOP_PLATE of the post.)
      const R = STOP_PLATE;
      polygon(24, R, post + 0.01, SB.cream, -ux, -uz, 0.035);
      polygon(24, R, post + 0.02, SB.white, ux, uz, 0.035);
      polygon(16, 0.29, post + 0.025, SB.red, ux, uz);
    } else {
      const R = 0.375 / Math.cos(Math.PI / 8);   // (75 cm across the flats)
      polygon(8, R, post + 0.01, 0x8a8f94, -ux, -uz);          // the back
      polygon(8, R, post + 0.02, 0xf2f2f2, ux, uz);            // the white rim
      polygon(8, R * 0.88, post + 0.025, 0xc81e1e, ux, uz);    // the red face
    }
    // STOP in white, a 3 x 5 block letter each, reading left to right for the traffic facing it
    // (whose right is (-rx, -rz)).
    const cell = 0.035, yaw = Math.atan2(-rz, rx);
    STOP_GLYPHS.forEach((rows, i) => rows.forEach((row, r) => { for (let c = 0; c < 3; c++) {
      if (row[c] !== "#") continue;
      const l = -0.2625 + i * 0.14 + (c + 0.5) * cell, y = y0 + 2.5 * cell - (r + 0.5) * cell;
      solid.box(px + ux * (post + 0.03) - rx * l, y, pz + uz * (post + 0.03) - rz * l, cell, cell, 0.01, 0xf2f2f2, yaw);
    } }));
  });
}
// An all-way stop's sign posts, by approach (arm index): on the right-hand sidewalk STOP_POST_IN
// in from the kerb, just short of the stop line; or, where a way through the junction passes too near (a
// street bending on across it, its kerb lane over the corner), the nearest spot along the sidewalk
// that is clear of it, from in on the corner to a little past where it would stand, and only then
// further out. Where none is, it stays put (tests: counted in `misses.none`). Memoised (the graph
// doesn't change once built); with `misses`, worked out afresh.
export const STOP_POST_REACH = STOP_BACK - 0.9 + 1.2;   // m from the mouth: a little past where it stands
export const STOP_PLATE = 0.375;             // m: half the sign's width, across the street, at 2.15 m
// m: a stop post in from the kerb, toward the sidewalk's back: its sign clear of what overhangs the
// kerb (the box truck's nose, swung out in a lane change up to the stop: up to 0.94 m over it), and
// behind the line of street trees, 1.4 m in (city.ts), clear of the building line by a little.
const STOP_POST_IN = 2.3;
const STOP_POSTS = new WeakMap<CityGraph, Map<number, Map<number, [number, number]>>>();
export function stopSignPosts(G: CityGraph, n: CNode, misses: { none: number; paths: number } | null = null): Map<number, [number, number]> {
  let byNode = STOP_POSTS.get(G);
  if (!byNode) STOP_POSTS.set(G, byNode = new Map());
  const hit = byNode.get(n.id);
  if (hit && !misses) return hit;
  const out = new Map<number, [number, number]>();
  if (n.control === "stop") {
    const clear = junctionTraffic(G, n, misses, STOP_POST_CLEAR), corners = n.arms.map((_, j) => sidewalkCorner(G, n, j).pts);
    n.arms.forEach((arm, i) => {
      const st = G.streets[arm.street];
      if (!st.inCity) return;
      const ux = Math.cos(arm.h), uz = -Math.sin(arm.h), rx = -uz, rz = ux, side = st.half - st.kerb + STOP_POST_IN;
      const at = (t: number): [number, number] => [n.x + ux * t - rx * side, n.z + uz * t - rz * side];
      const t0 = arm.mouth + STOP_BACK - 0.9;
      let t = NaN;
      // (On the sidewalk: past the mouth, or in on the corner before it, the plate's width in from its kerb.)
      const onWalk = (c: number) => c >= arm.mouth + 0.3 || corners.some((q) => { const [x, z] = at(c); return inPoly(q, x, z) && polyDist(q, x, z) >= STOP_PLATE; });
      // (Not past the street's far mouth, into the next junction; and clear of its traffic too, on a
      // street short enough that its turns reach back along this one.)
      const end = G.nodes[arm.end === 0 ? st.n1 : st.n0], farMouth = end.arms.find((b) => b.street === arm.street && b.end !== arm.end)?.mouth ?? 0, last = st.len - farMouth - 0.3;
      // (Its traffic only where it is near enough to reach back here: swept when first asked.)
      let farClear: ((x: number, z: number) => boolean) | null | undefined = end !== n && end.arms.length >= 2 && Math.hypot(end.x - n.x, end.z - n.z) < 40 ? undefined : null;
      const farOk = (x: number, z: number) => { if (farClear === undefined) farClear = junctionTraffic(G, end, null, STOP_POST_CLEAR); return !farClear || farClear(x, z); };
      const ok = (c: number) => c <= last && clear(...at(c)) && farOk(...at(c));
      for (let d = 0; d <= STOP_BACK + 4 && Number.isNaN(t); d += 0.25)
        for (const c of [t0 - d, t0 + d]) if (c > 0 && c <= arm.mouth + STOP_POST_REACH && onWalk(c) && ok(c)) { t = c; break; }
      // (Failing that, further out along the sidewalk, as near as will do: where a street bends on
      // across the junction, its curve can run over this corner's sidewalk for a dozen metres.)
      for (let c = arm.mouth + STOP_POST_REACH; Number.isNaN(t) && c <= t0 + 12; c += 0.25) if (ok(c)) t = c;
      if (Number.isNaN(t)) { if (misses) misses.none++; t = t0; }
      out.set(i, at(t));
    });
  }
  byNode.set(n.id, out);
  return out;
}

// Where node n's signal poles stand (world x, z), one per approach (arm i): on the far right
// corner of the intersection for the traffic coming in along it (heading h), and how far to the
// right of that street's centre line it stands, which its mast arm reaches back over.
// Always on a sidewalk, never where a vehicle drives: clear of every roadway there by POLE_CLEAR
// (signalPoleOk) and of every way through the junction by POLE_PATH_CLEAR, its heads over a
// roadway and its arm clear of the blocks. Where the corner is a plain one, 1.4 m in from the
// backs of the sidewalks; where the street bends on across the junction, or none carries straight
// on (the stem of a T, a skewed junction), where the line 1.4 m in from this street's right
// sidewalk's back, carried on across, comes up onto the sidewalk on the far side; failing that, on
// the sidewalk of the way straight on (or the arms nearest it) just past its mouth; and last on
// the near side, before the junction. An approach with nowhere for its pole has no signal (none
// in the test's towns).
export interface SignalPole { i: number; px: number; pz: number; h: number; toCentre: number }
const POLE_CLEAR = 0.6;    // m: the least from a pole's axis to a roadway's edge (the kerb's face)
// m: the least from a pole's axis to the line a vehicle drives along: half the widest of the
// traffic (a bus or a box truck, 2.5 m), the pole's radius, and a little.
export const POLE_PATH_CLEAR = 2.5 / 2 + 0.16 + 0.1;
// m: from a path's centre line to a stop post's axis: a signal pole's clearance, the sign's half
// width for the pole's radius (the sign hangs at a bus's or a box truck's side).
export const STOP_POST_CLEAR = POLE_PATH_CLEAR - 0.16 + STOP_PLATE;
const ARM_MAX = 13;   // m: a mast arm's longest reach, but where nothing shorter will do
// Whether a post at (x, z) is clear of every way vehicles drive through node n: from each
// approach, each move, from either lane, a tractor-trailer's wide rights too, kept POLE_PATH_CLEAR
// from the line of a vehicle's body along each path near the junction. (A street bending on across it is driven as one
// smooth curve, whose kerb lane cuts over the inside corner's kerb a little: no post there.)
// (Not kept: what is placed by it, signalPoles and stopSignPosts, is.) `misses.paths`: ways a
// path couldn't be made for. `clearance`: from the path's centre line to the post's axis.
const BODY_BACK = 11.5 / 2;   // m: half the longest of the traffic, a bus, behind its path's point
// m: the truck's nose ahead of its rear axle (truck.ts truckExtents), the longest of its models.
// (Asked for at first use: SPECS may not be set yet while this module loads.)
let bodyFront = NaN;
const BODY_FRONT_OF = () => Number.isNaN(bodyFront) ? (bodyFront = Math.max(...Object.values(SPECS).map((s) => s.noseFront)) + 0.05) : bodyFront;
export function junctionTraffic(G: CityGraph, n: CNode, misses: { paths: number } | null = null, clearance = POLE_PATH_CLEAR): (x: number, z: number) => boolean {
  const A = n.arms, R = 4 * Math.max(...A.map((a) => Math.max(a.mouth, G.streets[a.street].half))) + 10;
  const driven: number[] = [], q = { x: 0, z: 0, h: 0, k: 0 }, front = BODY_FRONT_OF();
  for (const arm of A) {
    const d = arm.street * 2 + (arm.end ^ 1);
    if (!G.streets[arm.street].inCity || !G.drivable(d)) continue;
    for (const mv of G.movesFrom(d)) {
      if (!G.streets[mv.to >> 1].inCity) continue;
      for (const lane of [LANE_KERB, LANE_INNER]) for (const wide of [false, true]) {
        let path: Path;
        try { path = new Path(G, { d, before: Math.min(30, G.faceLen(d) / 2), edges: [mv.to], after: Math.min(30, G.faceLen(mv.to) / 2), lane, wide }); }
        catch { if (misses) misses.paths++; continue; }
        // (Each metre along it, the body's length on its heading there: from half a bus behind,
        // traffic being centred on its path, to the truck's nose ahead, the truck's path being its
        // rear axle's. A long body's ends swing out of a bend: no post where they do.)
        // (And the path itself, metre to metre: round a tight turn it bows out past the bodies.)
        let px = NaN, pz = NaN;
        for (let s = 0; s <= path.length; s += 1) {
          path.eval(s, q);
          const near = Math.hypot(q.x - n.x, q.z - n.z) < R, fx = Math.cos(q.h), fz = -Math.sin(q.h);
          if (near) driven.push(q.x - fx * BODY_BACK, q.z - fz * BODY_BACK, q.x + fx * front, q.z + fz * front);
          if (near && !Number.isNaN(px)) driven.push(px, pz, q.x, q.z);
          px = q.x; pz = q.z;
        }
      }
    }
  }
  const clear = (x: number, z: number) => {
    for (let k = 0; k < driven.length; k += 4) {
      const ax = driven[k], az = driven[k + 1], dx = driven[k + 2] - ax, dz = driven[k + 3] - az, L = dx * dx + dz * dz;
      const t = L > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < clearance) return false;
    }
    return true;
  };
  return clear;
}
// (None but at a signalled node. Tests: `misses` counts approaches left without a pole, and ways
// through it a path couldn't be made for; given, the poles are worked out afresh.) Memoised: the
// graph doesn't change once built.
const POLES = new WeakMap<CityGraph, Map<number, SignalPole[]>>();
// A city file's signal poles and stop-sign posts (cityfile.ts), node by node, in place of placing
// them: what signalPoles and stopSignPosts give for that graph from then on (but when a test asks
// for the rule's own, with `misses`).
export function presetJunctionPosts(G: CityGraph, poles: Map<number, SignalPole[]>, stops: Map<number, Map<number, [number, number]>>) {
  POLES.set(G, poles); STOP_POSTS.set(G, stops);
}
export function signalPoles(G: CityGraph, n: CNode, misses: { none: number; paths: number } | null = null): SignalPole[] {
  let byNode = POLES.get(G);
  if (!byNode) POLES.set(G, byNode = new Map());
  const hit = byNode.get(n.id);
  if (hit && !misses) return hit;
  const out: SignalPole[] = [], A = n.arms;
  if (n.control !== "signal") return out;
  // The streets round here: this node's, and those at their far ends (a junction just along).
  const near = new Set<number>();
  for (const a of A) { near.add(a.street); const st = G.streets[a.street]; for (const e of [st.n0, st.n1]) for (const b of G.nodes[e].arms) near.add(b.street); }
  const pt = (j: number, t: number, o: number): [number, number] => { const h = A[j].h; return [n.x + Math.cos(h) * t + Math.sin(h) * o, n.z - Math.sin(h) * t + Math.cos(h) * o]; };
  // (The sidewalk corners, as city.ts buildNode lays them.)
  const corners = A.map((_, j) => sidewalkCorner(G, n, j).pts);
  // On a sidewalk: in one of the junction's corners, or along an arm's own sidewalk past its mouth.
  const onSidewalk = (x: number, z: number) => {
    if (corners.some((c) => inPoly(c, x, z))) return true;
    return A.some((a, j) => {
      const st = G.streets[a.street], h = a.h, dx = x - n.x, dz = z - n.z;
      const t = dx * Math.cos(h) - dz * Math.sin(h), o = Math.abs(dx * Math.sin(h) + dz * Math.cos(h));
      return t >= A[j].mouth && t <= A[j].mouth + 15 && o >= st.half - st.kerb && o <= st.half;
    });
  };
  const clearOfTraffic = junctionTraffic(G, n, misses);
  const blocks = G.blocks.filter((b) => Math.hypot(b.cx - n.x, b.cz - n.z) < 200);
  const inBlock = (x: number, z: number) => blocks.some((b) => inPoly(b.poly, x, z) && polyDist(b.poly, x, z) > 0.1);
  // (Not past an arm's street's far mouth, at the next junction along: where the street is short.)
  const lastOf = A.map((a) => { const st = G.streets[a.street], e = G.nodes[a.end === 0 ? st.n1 : st.n0]; return st.len - (e.arms.find((b) => b.street === a.street && b.end !== a.end)?.mouth ?? 0); });
  const pastFar = (x: number, z: number) => A.some((a, j) => {
    const st = G.streets[a.street], dx = x - n.x, dz = z - n.z, t = dx * Math.cos(a.h) - dz * Math.sin(a.h), o = Math.abs(dx * Math.sin(a.h) + dz * Math.cos(a.h));
    return o <= st.half && t > lastOf[j];
  });
  const ok = (x: number, z: number) => onSidewalk(x, z) && !pastFar(x, z) && signalPoleOk(G, near, x, z) && clearOfTraffic(x, z);
  A.forEach((arm, i) => {
    const st = G.streets[arm.street];
    if (!st.inCity && st.gate < 0) return;
    // The traffic coming in along this arm heads h; its right is r.
    const h = arm.h + Math.PI, fx = Math.cos(h), fz = -Math.sin(h), rx = Math.sin(h), rz = Math.cos(h);
    const side = st.half - 1.4;
    // The arm straight ahead, if any.
    const off = (j: number) => Math.abs(Math.atan2(Math.sin(A[j].h - h), Math.cos(A[j].h - h)));
    const ahead = A.map((_, j) => j).filter((j) => j !== i).sort((a, b) => off(a) - off(b));
    const S = ahead.length && off(ahead[0]) < Math.PI / 4 ? ahead[0] : -1;
    const cands: [number, number][] = [];
    // A plain corner: 1.4 m in from the backs of both sidewalks, just short of the far mouth.
    const far = S >= 0 ? A[S].mouth : arm.mouth;
    cands.push([n.x + fx * (far - 1.4) + rx * side, n.z + fz * (far - 1.4) + rz * side]);
    if (S >= 0) cands.push(pt(S, A[S].mouth - 1.4, G.streets[A[S].street].half - 1.4));
    // Along the line `side` to the right, out across the junction: 1.4 m up onto the sidewalk
    // past where it first comes up onto it (beyond the junction's middle).
    let t0 = NaN;
    for (let t = 0; t < 4 * Math.max(far, st.half) + 10; t += 0.1) {
      const x = n.x + fx * t + rx * side, z = n.z + fz * t + rz * side;
      if (onSidewalk(x, z) && signalPoleOk(G, near, x, z)) { if (Number.isNaN(t0)) t0 = t; }
      else if (!Number.isNaN(t0)) { if (t - t0 < 1) t0 = NaN; else break; }
      if (!Number.isNaN(t0) && t - t0 >= 1.4) break;
    }
    if (!Number.isNaN(t0)) for (const d of [1.4, 1, 0.6, 0.3]) cands.push([n.x + fx * (t0 + d) + rx * side, n.z + fz * (t0 + d) + rz * side]);
    // The sidewalk of the way straight on (or of the arms nearest it), on the right, just past its mouth.
    for (const J of ahead) { const sj = G.streets[A[J].street]; for (const d of [0.5, 1.5, 3, 4.5, 6]) cands.push(pt(J, A[J].mouth + d, sj.half - 1.4)); }
    // Last, the near side: on this street's own sidewalk, between its stop line and the junction.
    for (const d of [1, 2.5, 4]) cands.push(pt(i, arm.mouth + d, -side));
    // (Where the junction is a wide one, its mouths far out: in on the corner, nearer its middle.)
    for (let t = arm.mouth; t > 0; t -= 1) cands.push(pt(i, t, -side));
    // (Its arm reaches back over this street's lanes, to the traffic's left, from where it stands:
    // that far right of the centre line, carried on; so right of them, past the kerb lane.)
    const toCentre = ([x, z]: [number, number]) => (x - n.x) * rx + (z - n.z) * rz;
    // (And its heads, over this street's lanes carried on, over this junction's roadway: not over
    // the corner, nor out over the next junction's.)
    const own = A.map((a) => a.street);
    const overRoad = (x: number, z: number) => !signalPoleOk(G, own, x, z, 0);
    const headsOver = (p: [number, number]) => [1.5, 4.5].every((l) => overRoad(p[0] - rx * (toCentre(p) - l), p[1] - rz * (toCentre(p) - l)));
    // (A mast arm longer than ARM_MAX only where nowhere nearer will do.)
    // (Nor its arm out over a block, through whatever is built there.)
    const armClear = (p: [number, number]) => { for (let d = 0, L = toCentre(p) + 0.4; d <= L; d += 0.5) if (inBlock(p[0] - rx * d, p[1] - rz * d)) return false; return true; };
    const fits = (p: [number, number]) => toCentre(p) >= st.half - st.kerb && ok(p[0], p[1]) && headsOver(p) && armClear(p);
    const c = cands.find((p) => toCentre(p) <= ARM_MAX && fits(p)) ?? cands.find(fits);
    if (!c) { if (misses) misses.none++; return; }
    out.push({ i, px: c[0], pz: c[1], h, toCentre: toCentre(c) });
  });
  byNode.set(n.id, out);
  return out;
}
// Whether a pole at (x, z) is clear of the roadways of the streets `near` by `clear`.
export function signalPoleOk(G: CityGraph, near: Iterable<number>, x: number, z: number, clear = POLE_CLEAR) {
  for (const id of near) {
    const st = G.streets[id], [s] = G.toStreet(id, x, z), p = G.streetPt(id, s, 0);
    if (Math.hypot(x - p.x, z - p.z) < st.half - st.kerb + clear) return false;
  }
  return true;
}

// Mast-arm signals for node n, drawn relative to (ox, oz) (its tile's origin). Each approach gets
// a pole on the far right corner of the intersection and an arm reaching over its two lanes, with
// a head per lane. Poles and heads go in `solid`, and lamps go in `lamps`. Each lamp stands out of
// its head's face, a box or in the storybook (`story`) a ball, so its top reads from the overhead
// camera. `plates`: for the name plates on the mast arms, each
// naming the cross street to the traffic coming up to it.
// The Victorian city's (`vic`) are of the Westminster kind of 1868, each standing where a pole
// would, with no mast arm and no name plate: a tall iron column with red and green gas lamps and a
// semaphore arm out over the kerb (victorian-street.ts vicSignal), tagged as the heads' lamps are.
// A Victorian junction whose city file gives it no poles has a constable on point duty in its
// middle instead (vicConstable), in a pose for each phase: facing out along the first arm not in
// that phase, whose traffic he holds while that phase goes.
export function buildSignals(solid: Batch, lamps: Batch, G: CityGraph, n: CNode, ox: number, oz: number, seed: number, plates: PlateSet | null = null, story = false, vic = false) {
  if (n.control !== "signal") return;
  const offset = signalOffset(n, seed), armY = 6.2, poles = signalPoles(G, n), phases = Math.max(2, n.phases);
  if (vic && !poles.length) {
    const poses = [];
    for (let p = 0; p < phases; p++) {
      const held = n.arms.find((_, j) => n.phaseOf[j] !== p);
      if (held) poses.push({ yaw: held.h, tag: () => lamps.aux.set(lampTag(LAMP_POSE, offset), -(n.id + 1), p + 4 * (phases - 2)) });
    }
    vicConstable(lamps, n.x - ox, n.z - oz, poses);
    lamps.aux.set(0, 0, -1);
    return;
  }
  for (const { i, px: wx, pz: wz, h, toCentre } of poles) {
    const arm = n.arms[i], px = wx - ox, pz = wz - oz;
    const fx = Math.cos(h), fz = -Math.sin(h), reach = toCentre + 0.4;
    // The arm reaches back over the lanes (to the traffic's left).
    const ax = -Math.sin(h), az = -Math.cos(h), armH = Math.atan2(-az, ax);
    if (vic) {
      vicSignal(solid, lamps, px, pz, fx, fz, ax, az, (k, hide) => lamps.aux.set(lampTag(k, offset, hide), -(n.id + 1), n.phaseOf[i] + 4 * (Math.max(2, n.phases) - 2)));
      continue;
    }
    if (story) {
      candyPole(solid, px, pz, 0, armY + 0.1, 0.16, 1.0, SB.pink, SB.cream);
      solid.ico(px, armY + 0.3, pz, 0.26, SB.mustard);
      solid.box(px + ax * reach / 2, armY - 0.01, pz + az * reach / 2, reach + 0.16, 0.18, 0.16, SB.plum, armH);
      solid.ico(px + ax * (reach + 0.12), armY - 0.01, pz + az * (reach + 0.12), 0.16, SB.mustard);
    } else {
      solid.cyl(px, armY / 2, pz, 0.16, armY, POLE, 6);
      solid.box(px + ax * reach / 2, armY - 0.01, pz + az * reach / 2, reach + 0.16, 0.18, 0.16, POLE, armH);
    }
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
      if (story) {
        // (A round teal body with a cream face its round lamps stand out of.)
        solid.cyl(hx, armY - 0.75, hz, 0.25, 1.2, SB.teal, 8);
        solid.box(hx - fx * 0.27, armY - 0.74, hz - fz * 0.27, 0.04, 1.14, 0.38, SB.cream, h);
      } else solid.box(hx, armY - 0.75, hz, 0.36, 1.25, 0.44, HOUSING, h);
      for (const k of [0, 1, 2] as const) {
        lamps.aux.set(lampTag(k, offset), -(n.id + 1), n.phaseOf[i] + 4 * (Math.max(2, n.phases) - 2));
        if (story) lamps.ico(hx - fx * 0.3, armY - 0.36 - k * 0.38, hz - fz * 0.3, 0.15, LAMP_COLORS[k]);
        else lamps.box(hx - fx * 0.22, armY - 0.36 - k * 0.38, hz - fz * 0.22, 0.16, 0.3, 0.3, LAMP_COLORS[k], h);
      }
    }
  }
  lamps.aux.set(0, 0, -1);
}
