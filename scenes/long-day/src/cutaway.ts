// Cutaway: thin out buildings between the camera and the truck so the overhead chase never
// loses the truck behind one. The cut region is the cone from the camera to the truck (zero
// radius at the camera, uCutRadius at the truck), i.e. the part of the world that actually hides
// the truck; a cylinder would punch a huge disc through anything close to the camera. Done in the fragment shader so batched chunks stay one draw call
// each, as a screen-door dither (a checkerboard of dropped pixels) that reads as see-through on
// LEDs and keeps the occluder's silhouette.
// The test runs in view space (camera at the origin), which stays precise however far the
// journey has gone, and uses three's mvPosition, so instanced meshes are covered too.
// Only materials that can occlude get this (Engine.mats.solid): a shader containing `discard`
// can lose early depth testing on tile-based GPUs, so ground, roads and kerbs use a material
// without it.
import * as THREE from "three@0.187.0";

export const cutUniforms = {
  uCutFocus: { value: new THREE.Vector3() }, // truck position in view space
  uCutRadius: { value: 7.0 },  // at the truck: half its length and a margin (set per frame in main)
  uCutOn: { value: 1.0 },
  // Anything closer to the camera than this is not drawn, so a shot that ends up in a tree crown,
  // against a wall or behind a pole still sees past it.
  uNearClip: { value: 3.0 },
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
uniform vec3 uCutFocus; uniform float uCutRadius; uniform float uCutOn; uniform float uNearClip;`)
      .replace("void main() {", `void main() {
  {
    float dc = length(vCutView);
    if (dc < uNearClip) discard;   // gone outright: a dithered pole would streak across the frame
  }
  if (uCutOn > 0.5) {
    float t = clamp(dot(vCutView, uCutFocus) / dot(uCutFocus, uCutFocus), 0.0, 1.0);
    float d = distance(vCutView, uCutFocus * t);
    // Stop short of the truck so its own surroundings on the far side stay solid.
    if (t < 0.93 && d < uCutRadius * t) {
      vec2 cell = mod(floor(gl_FragCoord.xy), 2.0);
      if (cell.x == cell.y) discard;   // one even checkerboard: half the pixels, no rings
    }
  }`);
  };
  mat.customProgramCacheKey = () => prevKey() + "|cutaway-v7";
  mat.needsUpdate = true;
}

const cutTmp = new THREE.Vector3();
// Call after the camera is placed for the frame. `on` = false for shots inside or beside the
// truck (dashboard, side view), where nothing should be thinned out.
export function updateCutaway(camera: THREE.Camera, focus: THREE.Vector3, on = true) {
  camera.updateMatrixWorld();
  cutTmp.copy(focus); cutTmp.y += 2.0;
  cutUniforms.uCutFocus.value.copy(cutTmp.applyMatrix4(camera.matrixWorldInverse));
  cutUniforms.uCutOn.value = on ? 1 : 0;
}

// The driver spotlight: the same screen-door see-through, on everything that can hide the driver
// (the trucks, buildings and street furniture, cars and passers-by), in a narrow cone from the camera to the driver whenever the driver is out of the seat,
// so the driver stays in view working inside the box or walking behind the truck.
const spotUniforms = {
  uSpotFocus: { value: new THREE.Vector3() },  // the driver's chest in view space
  uSpotRadius: { value: 1.0 },
  uSpotOn: { value: 0.0 },
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
uniform vec3 uSpotFocus; uniform float uSpotRadius; uniform float uSpotOn;`)
      .replace("void main() {", `void main() {
  if (uSpotOn > 0.5) {
    float t = clamp(dot(vSpotView, uSpotFocus) / dot(uSpotFocus, uSpotFocus), 0.0, 1.0);
    float d = distance(vSpotView, uSpotFocus * t);
    // Widening from the camera to full radius over the last few metres before the driver.
    float r = uSpotRadius * clamp(t * 1.6, 0.0, 1.0);
    // Only what is in front of the driver (nearer the camera than the front of the body), so
    // walls, floors and loads beside or behind the driver stay solid, but a load in the next
    // column or a wall half a metre away still clears.
    float flen = length(uSpotFocus);
    if (t * flen < flen - 0.3 && d < r) {
      // Mostly see-through: one pixel in nine kept in the middle, one in four towards the rim.
      if (d < r * 0.7) { vec2 c3 = mod(floor(gl_FragCoord.xy), 3.0); if (c3.x != 1.0 || c3.y != 1.0) discard; }
      else { vec2 cell = mod(floor(gl_FragCoord.xy), 2.0); if (cell.x != 0.0 || cell.y != 0.0) discard; }
    }
  }`);
  };
  mat.customProgramCacheKey = () => prevKey() + "|spot-v4";
  mat.needsUpdate = true;
}
export function updateDriverSpot(camera: THREE.Camera, chest: THREE.Vector3 | null) {
  spotUniforms.uSpotOn.value = chest ? 1 : 0;
  if (chest) spotUniforms.uSpotFocus.value.copy(cutTmp.copy(chest).applyMatrix4(camera.matrixWorldInverse));
}
