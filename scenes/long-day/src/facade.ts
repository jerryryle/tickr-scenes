// Building facades from one 4x4 texture atlas (tools/make_facades.py, asset "facades").
// Walls are Batch.wall quads whose aAux holds (u, v, tile): u counts bays across the wall, v
// counts floors up it, and the shader repeats the tile with fract(). The atlas is 512x256: colour
// tiles on the left, a tint mask in the same layout on the right saying what the building's vertex
// colour tints (wall) and what keeps its own colour (glass, frames, doors), so one tile serves
// every wall colour. Primitives in the same batch keep aux.z = -1 and render as
// plain vertex colour, so a chunk's buildings, roofs and trim are a single draw call.
import * as THREE from "three@0.187.0";
import { Batch } from "./geom.ts";
import { NIGHT_GLOW } from "./atmosphere.ts";

export function makeFacadeMaterial(atlas: CanvasImageSource): THREE.MeshLambertMaterial {
  const tex = new THREE.Texture(atlas as any);
  // Uploaded as plain RGBA8 and decoded to linear in the shader: mipmap generation for sRGB8
  // textures is unreliable on some GL implementations (missing levels sample as black).
  tex.colorSpace = THREE.NoColorSpace;
  tex.magFilter = THREE.NearestFilter;            // crisp up close (dashboard and side shots)
  tex.minFilter = THREE.LinearMipmapLinearFilter; // no shimmer in the moving overhead chase
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const uFacade = { value: tex };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFacade = uFacade;
    shader.uniforms.uNight = NIGHT_GLOW;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aAux;\nvarying vec3 vAux;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvAux = aAux;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vAux;\nuniform sampler2D uFacade;\nuniform float uNight;")
      .replace("#include <color_fragment>", `
  // Gradients and samples are taken unconditionally: derivatives inside non-uniform control flow
  // are undefined in GLSL, and some GPUs return garbage there.
  vec2 gx = dFdx(vAux.xy) * vec2(0.125, 0.25), gy = dFdy(vAux.xy) * vec2(0.125, 0.25);
  float tileId = floor(max(vAux.z, 0.0) + 0.5); // interpolation can turn 8.0 into 7.9999
  // Tile i sits at column i%4, row i/4 from the top of the image (flipY puts row 0 at v=0.75).
  vec2 cell = vec2(mod(tileId, 4.0), 3.0 - floor(tileId / 4.0));
  // Keep half a texel inside the tile so filtering never picks up the neighbour; gradients come
  // from the unwrapped coordinates, so fract() seams don't drop to the smallest mip.
  vec2 st = (cell + clamp(fract(vAux.xy), 0.5 / 64.0, 1.0 - 0.5 / 64.0)) * vec2(0.125, 0.25);
  vec4 fac = vec4(sRGBTransferEOTF(textureGrad(uFacade, st, gx, gy)).rgb, textureGrad(uFacade, st + vec2(0.5, 0.0), gx, gy).r);
  if (vAux.z < 0.0) fac = vec4(1.0);
#ifdef USE_COLOR
  diffuseColor.rgb *= mix(fac.rgb, fac.rgb * vColor.rgb, fac.a);
#endif`)
      // After dark (atmosphere.ts): about half the windows lit, one pane per bay and floor, and
      // the streetlight heads (aux.z = -2) glowing.
      .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
  {
    float glass = vAux.z >= 0.0 ? (1.0 - fac.a) * step(fac.r + 0.04, fac.b) : 0.0;
    vec2 cid = floor(vAux.xy) + vec2(tileId * 7.13, tileId * 3.7);
    float lit = step(0.5, fract(sin(dot(cid, vec2(12.9898, 78.233))) * 43758.5453));
    totalEmissiveRadiance += uNight * glass * lit * vec3(1.0, 0.75, 0.4) * 0.85;
    if (vAux.z < -1.5) totalEmissiveRadiance += uNight * vec3(1.0, 0.86, 0.55) * 1.3;
  }`);
  };
  mat.customProgramCacheKey = () => "facade-v5";
  return mat;
}

// A band of identical storeys. `tile` may instead list one tile per side (+z, +x, -z, -x), e.g.
// dock doors on a warehouse's yard side only.
export interface FacadeBand { tile: number | readonly number[]; floors: number; floorH: number }

export const BAY = 3.4; // target bay width in metres; walls round to whole bays

// Wall a box footprint with facade bands stacked from y0: e.g. a storefront band then office
// floors. `doorSide` (0..3 in the order +z, +x, -z, -x) gets `doorTile` in the middle bay of the
// first band, for houses and lobbies. Returns the top height.
export function facadeBox(b: Batch, x0: number, z0: number, x1: number, z1: number, y0: number,
                          bands: FacadeBand[], color: number, doorSide = -1, doorTile = -1): number {
  const corners = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
  let y = y0;
  bands.forEach((band, bi) => {
    const h = band.floors * band.floorH;
    for (let s = 0; s < 4; s++) {
      const tile = typeof band.tile === "number" ? band.tile : band.tile[s];
      const [ax, az] = corners[s], [bx, bz] = corners[(s + 1) % 4];
      const len = Math.hypot(bx - ax, bz - az);
      const bays = Math.max(1, Math.round(len / BAY));
      if (bi === 0 && s === doorSide && doorTile >= 0 && bays >= 1) {
        // Split the first band's wall into [0,k) door [k+1,n) so the door is a whole bay.
        const k = Math.floor(bays / 2), f0 = k / bays, f1 = (k + 1) / bays;
        const lerp = (f: number) => [ax + (bx - ax) * f, az + (bz - az) * f];
        const [px, pz] = lerp(f0), [qx, qz] = lerp(f1);
        if (k > 0) b.wall(ax, az, px, pz, y, y + h, color, tile, 0, k, 0, band.floors);
        b.wall(px, pz, qx, qz, y, y + band.floorH, color, doorTile, 0, 1, 0, 1);
        if (band.floors > 1) b.wall(px, pz, qx, qz, y + band.floorH, y + h, color, tile, 0, 1, 1, band.floors - 1);
        if (bays - k - 1 > 0) b.wall(qx, qz, bx, bz, y, y + h, color, tile, 0, bays - k - 1, 0, band.floors);
      } else {
        b.wall(ax, az, bx, bz, y, y + h, color, tile, 0, bays, 0, band.floors);
      }
    }
    y += h;
  });
  return y;
}
