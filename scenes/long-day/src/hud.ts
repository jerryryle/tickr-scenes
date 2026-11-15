// Debug overlay (env.debugHud): frame timing, GPU counters and simulation status lines.
import * as THREE from "three@0.187.0";

export class Hud {
  private fpsAvg = 60;
  draw(ctx: CanvasRenderingContext2D, renderer: THREE.WebGLRenderer, dt: number, extra: string[]) {
    if (dt > 0) this.fpsAvg += (1 / dt - this.fpsAvg) * 0.05;
    const i = renderer.info;
    const rows = [
      `fps ${this.fpsAvg.toFixed(0)}  calls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(1)}k`,
      `geo ${i.memory.geometries}  tex ${i.memory.textures}  prog ${i.programs?.length ?? 0}`,
      ...extra,
    ];
    ctx.font = "bold 9px monospace";
    let w = 0;
    for (const r of rows) w = Math.max(w, ctx.measureText(r).width);
    ctx.fillStyle = "rgba(0,0,0,0.75)";
    ctx.fillRect(0, 0, Math.ceil(w) + 6, rows.length * 10 + 3);
    ctx.fillStyle = "#7fff7f";
    rows.forEach((r, k) => ctx.fillText(r, 3, 9 + k * 10));
  }
}
