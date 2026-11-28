// Cutaway: thin out buildings between the camera and the truck so the overhead chase never
// loses the truck behind one. The cut region is exactly what stands between the camera and the
// truck: a fragment is thinned when the ray from the camera through it goes on to hit the truck
// (one box, or two for a tractor and its trailer, padded by CUT_PAD) and the fragment is nearer
// than where it enters, so nothing beside, above or behind the truck is touched. Done in the
// fragment shader (a ray-box slab test, a few dozen flops) so batched chunks stay one draw call
// each, as a screen-door dither (a checkerboard of dropped pixels) that reads as see-through on
// LEDs and keeps the occluder's silhouette.
// The test runs in view space (camera at the origin), which stays precise however far the
// journey has gone, and uses three's mvPosition, so instanced meshes are covered too.
// Only materials that can occlude get this (Engine.mats.solid): a shader containing `discard`
// can lose early depth testing on tile-based GPUs, so ground, roads and kerbs use a material
// without it.
import * as THREE from "three@0.187.0";

// The truck's boxes in view space (updateCutaway): centre, axes (three per box) and half sizes.
export const CUT_BOXES = 2;
const CUT_PAD = 0.6;   // m round the truck: a little of its surroundings shows through too
export const cutUniforms = {
  uCutC: { value: [new THREE.Vector3(), new THREE.Vector3()] },
  uCutAx: { value: Array.from({ length: CUT_BOXES * 3 }, () => new THREE.Vector3()) },
  uCutH: { value: [new THREE.Vector3(), new THREE.Vector3()] },
  uCutN: { value: 0 },
  uCutOn: { value: 1.0 },
};

// Chains onto any onBeforeCompile / program key the material already has (e.g. the facade atlas).
export function applyCutaway(mat: THREE.Material) {
  const prev = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, cutUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vCutView;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvCutView = mvPosition.xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vCutView;
uniform vec3 uCutC[${CUT_BOXES}]; uniform vec3 uCutAx[${CUT_BOXES * 3}]; uniform vec3 uCutH[${CUT_BOXES}];
uniform int uCutN; uniform float uCutOn;
// Whether the fragment at view position p hides box i: the ray from the camera (at s = 0) to p
// (at s = 1) meets the box, and only beyond p.
bool cutHides(vec3 p, int i) {
  vec3 c = uCutC[i], a0 = uCutAx[i * 3], a1 = uCutAx[i * 3 + 1], a2 = uCutAx[i * 3 + 2];
  vec3 o = -vec3(dot(c, a0), dot(c, a1), dot(c, a2));   // the camera, in the box's frame
  vec3 d = vec3(dot(p, a0), dot(p, a1), dot(p, a2));
  d = mix(d, vec3(1e-6), lessThan(abs(d), vec3(1e-6)));
  vec3 t1 = (-uCutH[i] - o) / d, t2 = (uCutH[i] - o) / d;
  vec3 tn = min(t1, t2), tf = max(t1, t2);
  float s0 = max(max(tn.x, tn.y), tn.z), s1 = min(min(tf.x, tf.y), tf.z);
  return s1 >= s0 && s0 > 1.0;
}`)
      .replace("void main() {", `void main() {
  if (uCutOn > 0.5) {
    bool hides = false;
    for (int i = 0; i < ${CUT_BOXES}; i++) {
      if (i >= uCutN) break;
      if (cutHides(vCutView, i)) { hides = true; break; }
    }
    if (hides) {
      vec2 cell = mod(floor(gl_FragCoord.xy), 2.0);
      if (cell.x == cell.y) discard;   // one even checkerboard: half the pixels, no rings
    }
  }`);
  };
  mat.customProgramCacheKey = () => prevKey() + "|cutaway-v9";
  mat.needsUpdate = true;
}

// A box to see the truck through: x0..x1 along, y0..y1 up and hw to either side, in obj's frame.
export interface CutBox { obj: THREE.Object3D; x0: number; x1: number; y0: number; y1: number; hw: number }
export const NO_CUT_BOXES: readonly CutBox[] = [];
const cutTmp = new THREE.Vector3(), cutM = new THREE.Matrix4();
// Call after the camera is placed for the frame, with the truck's boxes. `on` = false for shots
// inside or beside the truck (dashboard, side view), where nothing should be thinned out.
export function updateCutaway(camera: THREE.Camera, boxes: readonly CutBox[], on = true) {
  camera.updateMatrixWorld();
  const U = cutUniforms, n = on ? Math.min(boxes.length, CUT_BOXES) : 0;
  for (let i = 0; i < n; i++) {
    const b = boxes[i];
    b.obj.updateWorldMatrix(true, false);
    cutM.multiplyMatrices(camera.matrixWorldInverse, b.obj.matrixWorld);   // the box's frame to view space
    U.uCutC.value[i].set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0).applyMatrix4(cutM);
    for (let k = 0; k < 3; k++) U.uCutAx.value[i * 3 + k].setFromMatrixColumn(cutM, k).normalize();
    U.uCutH.value[i].set((b.x1 - b.x0) / 2 + CUT_PAD, (b.y1 - b.y0) / 2 + CUT_PAD, b.hw + CUT_PAD);
  }
  U.uCutN.value = n;
  U.uCutOn.value = n > 0 ? 1 : 0;
}

// The driver spotlight: a see-through hole, clear in the middle with a screen-door rim, on
// everything big that can hide the driver (the trucks, buildings and street furniture, cars, and
// the street vignettes' big props, but not passers-by: main.ts), in a narrow cone from the camera
// to the driver whenever the driver is out of the seat, so the driver stays in view working
// inside the box or walking behind the truck. A second spot, the same shape, follows the
// teammate on a team lift. The first follows the forklift instead while it is in a docked
// trailer and the driver directs it from the platform, at a radius that takes in the forklift and
// its load (main.ts).
const spotUniforms = {
  uSpotFocus: { value: [new THREE.Vector3(), new THREE.Vector3()] },  // the spots' middles in view space
  uSpotRadius: { value: [0, 0] },   // (0: that spot is off)
};
export function applyDriverSpot(mat: THREE.Material) {
  const prev = mat.onBeforeCompile.bind(mat);
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, spotUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vSpotView;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvSpotView = mvPosition.xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
varying vec3 vSpotView;
uniform vec3 uSpotFocus[2]; uniform float uSpotRadius[2];
// Whether this fragment is cut away by the spot on f, of radius rad.
bool spotCut(vec3 f, float rad) {
  if (rad <= 0.0) return false;
  float t = clamp(dot(vSpotView, f) / dot(f, f), 0.0, 1.0);
  float d = distance(vSpotView, f * t);
  // Widening from the camera to full radius over the last few metres before the focus.
  float r = rad * clamp(t * 1.6, 0.0, 1.0);
  // Only what is in front of the focus (nearer the camera than the front of the body), so walls,
  // floors and loads beside or behind it stay solid, but a load in the next column or a wall
  // half a metre away still clears.
  float flen = length(f);
  if (t * flen >= flen - 0.3 || d >= r) return false;
  // Clear in the middle (a dither there just speckles the figure at this resolution), with a
  // sparse rim, one pixel in nine, so the occluder's cut edge still reads.
  if (d < r * 0.8) return true;
  vec2 c3 = mod(floor(gl_FragCoord.xy), 3.0);
  return c3.x != 1.0 || c3.y != 1.0;
}`)
      .replace("void main() {", `void main() {
  if (spotCut(uSpotFocus[0], uSpotRadius[0]) || spotCut(uSpotFocus[1], uSpotRadius[1])) discard;`);
  };
  mat.customProgramCacheKey = () => prevKey() + "|spot-v6";
  mat.needsUpdate = true;
}
// The spots this frame, each its middle in world space and its radius, or null when off.
export function updateDriverSpot(camera: THREE.Camera, first: THREE.Vector3 | null, radius = 1.0, mate: THREE.Vector3 | null = null) {
  const F = spotUniforms.uSpotFocus.value, R = spotUniforms.uSpotRadius.value;
  R[0] = first ? radius : 0; R[1] = mate ? 1.0 : 0;
  if (first) F[0].copy(first).applyMatrix4(camera.matrixWorldInverse);
  if (mate) F[1].copy(mate).applyMatrix4(camera.matrixWorldInverse);
}
