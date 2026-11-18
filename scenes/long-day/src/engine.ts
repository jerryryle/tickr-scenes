// Fog by distance from the camera rather than by depth along the view axis (three's default).
// The strip is ~92 degrees wide, so at the frame's edge depth is only ~0.7x the true distance:
// depth fog would leave the streamed world's edge visible at the sides of open views.
// Set once, before any material compiles; every fogged material picks it up.
import * as THREE from "three@0.187.0";
import { applyCutaway, applyDriverSpot } from "./cutaway.ts";
import { Backdrop, hazeColor } from "./backdrop.ts";

THREE.ShaderChunk.fog_vertex = "#ifdef USE_FOG\n\tvFogDepth = length( mvPosition.xyz );\n#endif\n";

// Renderer, scene graph, camera and lighting shared by every system.
// Rendering is at native LED resolution (1 canvas pixel = 1 LED), antialiased (4x MSAA on the
// board) to calm edge shimmer as the camera moves; nothing is scaled between the buffer and the
// wall.
export class Engine {
  gl: WebGL2RenderingContext;
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  world = new THREE.Group();          // streamed content lives here
  // Intensities are physical (three divides diffuse by pi), so daylight needs values well above 1
  // for white paint to read as white rather than mid-grey. Phase 11 animates these.
  static readonly DAY = { sun: 2.4, hemi: 2.0, sunDir: new THREE.Vector3(40, 60, 50) };
  sun = new THREE.DirectionalLight(0xffffff, Engine.DAY.sun);
  hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a4030, Engine.DAY.hemi);
  fog: THREE.Fog;
  readonly sunDir = Engine.DAY.sunDir.clone();   // set by the atmosphere
  readonly sky = new THREE.Color();
  backdrop: Backdrop | null = null;      // drawn first, behind the world (backdrop.ts)
  // Shared vertex-coloured materials for Batch meshes, so a chunk costs one draw call each.
  // `solid` can be thinned out by the cutaway (buildings and anything tall); `ground` cannot
  // (terrain, roads, kerbs, markings), which keeps `discard` out of most of the screen.
  mats = {
    solid: new THREE.MeshLambertMaterial({ vertexColors: true }),
    ground: new THREE.MeshLambertMaterial({ vertexColors: true }),
  };

  constructor(public sys: SceneSys) {
    this.gl = sys.gl({ antialias: true });
    this.renderer = new THREE.WebGLRenderer({ canvas: this.gl.canvas as any, context: this.gl });
    this.renderer.setSize(sys.width, sys.height, false);
    this.camera = new THREE.PerspectiveCamera(38, sys.width / sys.height, 0.5, 400);
    this.scene.add(this.world, this.hemi, this.sun, this.sun.target);
    this.sun.position.copy(Engine.DAY.sunDir);
    const sky = 0x0b4fc4; // deep saturated day sky (LED-friendly)
    this.sky.setHex(sky);
    this.fog = new THREE.Fog(sky, 60, 130);
    this.scene.fog = this.fog;
    applyCutaway(this.mats.solid); applyDriverSpot(this.mats.solid);
  }

  // Fit fog to the world that exists. `clear` is the distance from the camera to the nearest
  // ground that is not built; fog reaches full strength just before it, so the world's edge and
  // chunks popping in beyond it are never seen. `keepClear` is a distance (normally the truck's)
  // that should stay unfogged where possible.
  setViewDistance(clear: number, keepClear = 0) {
    // (The streamer says 0 before anything is built round the camera and Infinity when nothing
    // round it is unbuilt: keep the camera's far plane finite and past its near one.)
    clear = Number.isFinite(clear) ? Math.max(clear, 20) : 400;
    const far = Math.max(20, clear * 0.95);
    this.fog.far = far;
    this.fog.near = Math.min(far - 12, Math.max(far * 0.5, keepClear + 8));
    if (Math.abs(this.camera.far - clear * 1.05) > 1) {
      this.camera.far = clear * 1.05;
      this.camera.updateProjectionMatrix();
    }
  }

  // Keep the sun's light direction fixed relative to the camera's neighbourhood.
  followSun(focus: THREE.Vector3) {
    this.sun.position.copy(focus).add(this.sunDir);
    this.sun.target.position.copy(focus);
  }

  // Compile every material currently in the scene (call in setup, so the first frame doesn't).
  precompile() { this.renderer.compile(this.scene, this.camera); }

  // The sky (clear colour) and the horizon haze the world fades into (fog), which the backdrop's
  // ground shares, so the streamed city's edge melts into the distance below the skyline.
  setSky(color: number) { this.sky.setHex(color); this.fog.color.copy(hazeColor(color)); }

  draw(ctx: CanvasRenderingContext2D) {
    const r = this.renderer;
    r.autoClear = false;
    r.setClearColor(this.sky, 1);
    r.clear();
    if (this.backdrop) { this.backdrop.sync(this.camera); r.render(this.backdrop.scene, this.backdrop.camera); r.clearDepth(); }
    r.render(this.scene, this.camera);
    ctx.drawImage(this.gl.canvas, 0, 0);
  }
}
