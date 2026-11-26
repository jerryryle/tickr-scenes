// The world asset (docs/long-day-cities.md, "How the scene carries the cities"): every city's layout
// and contents and every road's map, packed one after another by tools/pack.ts, which records
// where each lies (world-packed.ts WORLD_INDEX). The scene is given the asset's bytes when it starts
// (main.ts); a test or a tool, run in Node with no assets, reads the file the packer wrote.
import { WORLD_ASSET, WORLD_FILE, WORLD_INDEX } from "./world-packed.ts";
import { unpackBytes } from "./pack.ts";

let worldBytes: Uint8Array | null = null;
export function setWorldBytes(b: Uint8Array) { worldBytes = b; }
function worldData(): Uint8Array {
  if (!worldBytes) {
    const fs = (globalThis as any).process?.getBuiltinModule?.("node:fs");
    if (!fs) throw new Error(`no world asset ${WORLD_ASSET}: main.ts gives it when the scene starts`);
    worldBytes = new Uint8Array(fs.readFileSync(WORLD_FILE));
  }
  return worldBytes!;
}
// An item's JSON, unpacked: a city's layout or contents, or a road's map, by its id; null when the
// asset holds none.
export function unpackWorld(kind: "layouts" | "contents" | "roads", id: string): string | null {
  const at = WORLD_INDEX[kind][id];
  return at ? unpackBytes(worldData().subarray(at[0], at[0] + at[1])) : null;
}
