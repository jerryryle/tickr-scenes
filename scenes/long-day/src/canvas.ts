// Offscreen 2D canvases for baking textures (signs, livery, atlases).
// Tickr exposes no canvas factory. In order of preference: OffscreenCanvas (a preview running
// in a worker), document (a preview on the page), or the class of the render ctx's own canvas,
// which constructs new canvases on the board. The last only becomes reachable on the first
// render frame, so texture baking happens there.
let canvasCtor: any = null;
export function captureCanvasClass(ctx: CanvasRenderingContext2D) {
  if (!canvasCtor) canvasCtor = (ctx.canvas as any).constructor;
}
export function canBakeTextures(): boolean {
  const g: any = globalThis;
  return typeof g.OffscreenCanvas === "function" || !!g.document || !!canvasCtor;
}
export function makeCanvas(w: number, h: number): { canvas: any; g: CanvasRenderingContext2D } {
  const glob: any = globalThis;
  let canvas: any;
  if (typeof glob.OffscreenCanvas === "function") canvas = new glob.OffscreenCanvas(w, h);
  else if (glob.document) canvas = Object.assign(glob.document.createElement("canvas"), { width: w, height: h });
  else if (canvasCtor) canvas = new canvasCtor(w, h);
  else throw new Error("makeCanvas called before the first render frame captured the canvas class");
  return { canvas, g: canvas.getContext("2d") as CanvasRenderingContext2D };
}

// WebGL ignores UNPACK_FLIP_Y for an ImageBitmap, which is what the browser preview loads image
// assets as, so textures made from them came out upside down there (the board loads images that
// honour it). Copied into a canvas, an image uploads the same way everywhere.
export function uploadable<T>(img: T): T {
  const g: any = globalThis;
  if (typeof g.ImageBitmap !== "function" || !(img instanceof g.ImageBitmap) || !canBakeTextures()) return img;
  const b = img as unknown as ImageBitmap, c = makeCanvas(b.width, b.height);
  c.g.drawImage(b, 0, 0);
  return c.canvas as T;
}
