// ---- the modern paving --------------------------------------------------------------------------
// A modern city's roads and junctions are asphalt, and its sidewalks poured concrete. city.ts tags
// their ground (aux.z PAVE_ASPHALT or PAVE_CONCRETE, aux.xy the way along the street in the world),
// and applyModernPaving draws the surface on the ground's material from the world position, as
// city-victorian/victorian-street.ts applySetts draws a Victorian street's setts.
// The asphalt is a dark mottle of wear with a fine aggregate grain, now and then a rectangle of
// patching laid square to the street, and stretches of tar-sealed cracks wandering across it. The
// concrete is laid in slabs across the sidewalk, each a little lighter or darker than the next, with
// a tooled joint between, a faint speckle and blotches of staining, and now and then a crack across
// one. Macadam (PAVE_MACADAM) is the asphalt's wear and grain, the grain stronger, with no patches
// or cracks. The pattern fades as applySetts' does, so a far street reads as even paving and never
// shimmers: grain, joints and cracks are drawn at least about a pixel wide and fade out where they
// come to less than a few pixels apart.
// Every other road is paved the same way. A modern city's car parks, loading yards, bare asphalt
// lots and a close's lane are asphalt, and its driveways concrete. The freeway's deck, its on-ramp
// and its off-ramp down into town (freeway.ts, interchange.ts) are asphalt. The country road between
// the cities (countryworld.ts) is asphalt, with its lay-bys and weigh stations; it is macadam where a
// Victorian city's period has crept in, and the storybook city's candy cobbles near that city
// (city-storybook/storybook-street.ts applyCandyPaving). Its gravel shoulders and pull-ins are
// macadam.
import * as THREE from "three@0.187.0";

export const PAVE_ASPHALT = -11, PAVE_CONCRETE = -12, PAVE_MACADAM = -13;
// In the rain (applySetts' SETT_WET, set each frame from the weather: main.ts) both darken as wet
// paving does and take a sheen of the sky's colour, strongest at a grazing look as the setts' is.
// Water stands in shallow puddles on the asphalt, dark and glassy, which mirror the sky from overhead
// too; the concrete has only a few small ones.
// (The asphalt's grain, m; its patches' grid along and across the street, m, and the share of cells
// with one; the slabs' length along the sidewalk, m; the pixel's share of a feature over which it
// fades; the sealed cracks' gate, the level of a slow noise over which a stretch of them fades in
// and out, and how much they darken; and the puddles' noise, a cycle per so many m, with the level
// each surface's stand over.)
const MP = { grain: 0.06, patchU: 9.0, patchV: 3.2, patchOdds: 0.07, crackGate: [0.74, 0.82], crackDark: 0.3, slab: 1.5, fade: [0.2, 0.5], puddleScale: 0.45, asphaltPuddle: 0.74, concretePuddle: 0.76 };
const mp3 = (x: number) => x.toFixed(3);
const MP_GLSL = `
// (A sealed crack along the isoline 0.5 of noise n: its darkness at this pixel, given n's change
// over the pixel, nw, and the pixel's size, m. A crack 4 cm wide is drawn a pixel wide at least,
// fading as it falls under a pixel.)
float mpCrack(float n, float nw, float px) {
  float d = abs(n - 0.5) / max(nw, 1e-5), hw = max(0.5, 0.02 / px);
  return (1.0 - smoothstep(hw, hw + 1.0, d)) * clamp(0.08 / px, 0.0, 1.0);
}`;
export function applyModernPaving(mat: THREE.Material) {
  const prev = mat.onBeforeCompile.bind(mat), prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    // (After applySetts, whose aux varyings, wetness, sky, hashes and noise this reads.)
    prev(shader, renderer);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", MP_GLSL + "\nvoid main() {")
      .replace("#include <color_fragment>", `#include <color_fragment>
  float mpShine = 0.0, mpFloor = 0.0;   // (the wet sheen's strength, and its share seen from overhead too: emissivemap_fragment below)
  {
    float mac = abs(vSettAux.z - (${mp3(PAVE_MACADAM)})) < 0.5 ? 1.0 : 0.0;
    float asp = max(mac, abs(vSettAux.z - (${mp3(PAVE_ASPHALT)})) < 0.5 ? 1.0 : 0.0), con = abs(vSettAux.z - (${mp3(PAVE_CONCRETE)})) < 0.5 ? 1.0 : 0.0;
    // (x along the street, y across it, m; a pixel's size on the ground the larger way, m; and the
    // noises whose change over a pixel the cracks and puddles use. All before the branch, as a
    // derivative is undefined in one.)
    vec2 d = length(vSettAux.xy) > 0.5 ? normalize(vSettAux.xy) : vec2(1.0, 0.0);
    vec2 p = vec2(dot(vSettXZ, d), dot(vSettXZ, vec2(-d.y, d.x)));
    vec2 dpx = dFdx(p), dpy = dFdy(p);
    float px = max(abs(dpx.x) + abs(dpy.x), abs(dpx.y) + abs(dpy.y)), pxu = abs(dpx.x) + abs(dpy.x);
    float cn = stNoise(vSettXZ * 0.45 + 13.0), cnw = fwidth(cn);
    float pn = 0.72 * stNoise(vSettXZ * ${mp3(MP.puddleScale)} + 57.0) + 0.28 * stNoise(vSettXZ * ${mp3(MP.puddleScale * 3.7)} + 3.0), pfw = max(fwidth(pn), 0.004);
    if (dot(normalize(vNormal), (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz) < 0.5) asp = con = 0.0;
    if (asp > 0.5) {
      // (The mottle of wear, a few metres across, and the grain, fading under a few pixels.)
      float tone = 0.86 + 0.38 * stNoise(p * 0.3 + 5.0);
      tone *= 0.92 + 0.16 * stNoise(p * 1.7 + 21.0);
      float gs = 1.0 - smoothstep(${mp3(MP.fade[0])}, ${mp3(MP.fade[1])}, px / ${mp3(MP.grain * 4)});
      tone *= mix(1.0, 0.7 + 0.6 * stHash2(floor(p / ${mp3(MP.grain)})), gs * (mac > 0.5 ? 1.0 : 0.7));
      // (A patch: in one cell of a grid laid square to the street, a rectangle of asphalt laid
      // later, darker and fresher, or one time in three paler and worn, its seam darker still.)
      vec2 cell = floor(p / vec2(${mp3(MP.patchU)}, ${mp3(MP.patchV)}));
      if (mac < 0.5 && stHash2(cell + 4.1) < ${mp3(MP.patchOdds)}) {
        vec2 sz = vec2(${mp3(MP.patchU)}, ${mp3(MP.patchV)}) * (0.35 + 0.45 * vec2(stHash2(cell + 8.3), stHash2(cell + 2.9)));
        vec2 c0 = (cell + 0.5) * vec2(${mp3(MP.patchU)}, ${mp3(MP.patchV)}) + (vec2(stHash2(cell + 6.7), stHash2(cell + 1.3)) - 0.5) * (vec2(${mp3(MP.patchU)}, ${mp3(MP.patchV)}) - sz);
        vec2 q = abs(p - c0) - 0.5 * sz;
        float e = -max(q.x, q.y), aw = max(px, 0.02);
        float inside = smoothstep(-0.5 * aw, 0.5 * aw, e);
        float ph = stHash2(cell + 9.9);
        tone *= mix(1.0, ph < 0.33 ? 1.18 : 0.76 + 0.08 * ph, inside);
        tone *= 1.0 - 0.2 * (1.0 - smoothstep(0.0, max(aw, 0.05), abs(e))) * clamp(0.1 / px, 0.0, 1.0);
      }
      // (The sealed cracks: faint glossy lines where they run, in a stretch now and then.)
      float crack = mpCrack(cn, cnw, px) * smoothstep(${mp3(MP.crackGate[0])}, ${mp3(MP.crackGate[1])}, stNoise(vSettXZ * 0.06 + 77.0)) * (1.0 - mac);
      tone *= 1.0 - ${mp3(MP.crackDark)} * crack;
      diffuseColor.rgb *= tone;
      if (uSettWet > 0.0) {
        // (The puddles' level falls as the rain sets in, so they spread.)
        float pth = ${mp3(MP.asphaltPuddle)} + 0.15 * (1.0 - smoothstep(0.15, 0.6, uSettWet));
        float puddle = smoothstep(pth - pfw, pth + pfw, pn);
        diffuseColor.rgb *= mix(1.0, 0.6 - 0.25 * puddle, uSettWet);
        mpShine = uSettWet * mix(0.5 + 0.4 * crack, 1.6, puddle);
        mpFloor = uSettWet * 0.15 * puddle;
      }
    } else if (con > 0.5) {
      // (The slabs along the sidewalk, each with a tone and cast of its own, their joints across it.)
      float k = floor(p.x / ${mp3(MP.slab)}), u = p.x - k * ${mp3(MP.slab)}, e = min(u, ${mp3(MP.slab)} - u);
      float h = stHash2(vec2(k, 3.7));
      float show = 1.0 - smoothstep(${mp3(MP.fade[0])}, ${mp3(MP.fade[1])}, pxu / ${mp3(MP.slab * 0.5)});
      vec3 tone = vec3(0.93 + 0.12 * h) * mix(vec3(1.03, 1.0, 0.95), vec3(0.97, 1.0, 1.03), stHash2(vec2(k, 9.1)));
      // (The speckle, fading under a few pixels, and the stains.)
      float gs = 1.0 - smoothstep(${mp3(MP.fade[0])}, ${mp3(MP.fade[1])}, px / ${mp3(MP.grain * 4)});
      tone *= mix(1.0, 0.9 + 0.2 * stHash2(floor(p / ${mp3(MP.grain)}) + 0.5), gs * 0.5);
      tone *= 1.0 - 0.12 * smoothstep(0.6, 0.85, stNoise(p * 0.9 + vec2(k * 3.1, 0.0)));
      float jw = max(0.015, 0.7 * pxu);
      float joint = (1.0 - smoothstep(jw * 0.5, jw * 1.25, e)) * (1.0 - smoothstep(${mp3(MP.fade[0])}, ${mp3(MP.fade[1])}, pxu / ${mp3(MP.slab)}));
      // (A crack across one slab in seven, from side to side at a slant.)
      float crack = 0.0;
      if (stHash2(vec2(k, 5.3)) > 0.86) {
        float slope = (stHash2(vec2(k, 7.7)) - 0.5) * 1.2, c = u - ${mp3(MP.slab)} * (0.25 + 0.5 * stHash2(vec2(k, 1.9))) - p.y * slope;
        float cw = max(0.006, 0.6 * px);
        crack = (1.0 - smoothstep(cw * 0.5, cw * 1.25, abs(c) / sqrt(1.0 + slope * slope))) * show * 0.7;
      }
      diffuseColor.rgb *= mix(vec3(1.0), tone, mix(0.4, 1.0, show)) * (1.0 - 0.45 * max(joint, crack));
      if (uSettWet > 0.0) {
        float puddle = smoothstep(${mp3(MP.concretePuddle)} - pfw, ${mp3(MP.concretePuddle)} + pfw, pn);
        diffuseColor.rgb *= mix(1.0, 0.68 - 0.2 * puddle, uSettWet);
        mpShine = uSettWet * mix(0.35, 1.4, puddle) * (1.0 - 0.5 * joint * (1.0 - puddle));
        mpFloor = uSettWet * 0.18 * puddle;
      }
    }
  }`)
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  if (mpShine > 0.0) totalEmissiveRadiance += uSettSky * (mpFloor + mpShine * (0.06 + 0.94 * pow(1.0 - max(dot(normal, normalize(vViewPosition)), 0.0), 4.0)));`);
  };
  mat.customProgramCacheKey = () => prevKey() + "|modern-paving-v1";
  mat.needsUpdate = true;
}
