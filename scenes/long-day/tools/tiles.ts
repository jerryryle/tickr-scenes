// This test scene shows the storybook city's facade tiles (facadeart.ts) at their own size, three to
// a frame, one variant a second, and then their masks. The three are a variant's window tile, its
// shop front and its house door. In a mask, red marks where the building's colour tints it and green
// marks glass lit after dark. Build and render it with
//   make tool SCENE=long-day TOOL=tiles SECS=8   -> build/long-day-tiles/tiles.png
import { paintFacadeAtlas, FACADE_GRID, FACADE_TILE } from "../src/facadeart.ts";
import { FACADE, FACADE_KINDS } from "../src/facadetiles.ts";
import { captureCanvasClass } from "../src/canvas.ts";

export default function createScene(_: SceneInputs): Scene {
  let atlas: { colour: any; mask: any } | null = null;
  const kinds = [FACADE.STORYBOOK, FACADE.STORY_SHOP, FACADE.STORY_DOOR];
  return {
    render(ctx, f) {
      captureCanvasClass(ctx); atlas ??= paintFacadeAtlas();
      const k = Math.floor(f.t), v = k % 4, src = k >= 4 ? atlas.mask : atlas.colour;
      ctx.fillStyle = "#3a6a9a"; ctx.fillRect(0, 0, 384, 128);
      kinds.forEach((kind, i) => {
        const id = kind + FACADE_KINDS * v, sx = (id % FACADE_GRID) * FACADE_TILE, sy = Math.floor(id / FACADE_GRID) * FACADE_TILE;
        ctx.drawImage(src, sx, sy, FACADE_TILE, FACADE_TILE, i * 128, 0, 128, 128);
      });
    },
  };
}
