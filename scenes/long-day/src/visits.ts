// Which catalogue city (world.ts) each city of a journey is. The journey's style order
// (styles.ts journeyStyle) gives each city's style, and the cities of a style take their turns in
// a round from a place in it the seed picks, so no city of a style comes back before every other
// has had its turn. A pure function of the seed and the city's number.
import { hash2 } from "./rng.ts";
import { journeyStyle } from "./styles.ts";
import type { StyleId } from "./styles.ts";
import type { CityFile } from "./cityfile.ts";
import { CATALOGUE } from "./world.ts";

let byStyle: Map<StyleId, CityFile[]> | null = null;
let byKey: Map<number, CityFile> | null = null;
function index() {
  if (!byStyle) {
    byStyle = new Map(); byKey = new Map();
    for (const F of CATALOGUE) {
      if (byKey.has(F.key)) throw new Error(`world.ts: ${F.id} and ${byKey.get(F.key)!.id} share key ${F.key}`);
      byKey.set(F.key, F); byStyle.set(F.style, [...(byStyle.get(F.style) ?? []), F]);
    }
  }
  return { byStyle: byStyle!, byKey: byKey! };
}
// The catalogue's cities of a style, and the city a hash key belongs to.
export const citiesOfStyle = (id: StyleId): readonly CityFile[] => index().byStyle.get(id) ?? [];
export const cityByKey = (key: number): CityFile | undefined => index().byKey.get(key);

// The style counts of a journey's cities so far (cities 0 to N - 1), per seed.
const counts = new Map<number, Map<StyleId, number>[]>();
function turnOf(seed: number, N: number): number {
  let c = counts.get(seed);
  if (!c) { if (counts.size > 4) counts.clear(); counts.set(seed, c = [new Map()]); }
  while (c.length <= N) {
    const k = c.length - 1, m = new Map(c[k]), s = journeyStyle(seed, k).id;
    m.set(s, (m.get(s) ?? 0) + 1); c.push(m);
  }
  return c[N].get(journeyStyle(seed, N).id) ?? 0;
}

// City N of the journey with this seed.
export function cityFileOf(seed: number, N: number): CityFile {
  const style = journeyStyle(seed, N).id, list = citiesOfStyle(style);
  if (!list.length) throw new Error(`world.ts: no ${style} city`);
  let salt = 0;
  for (let i = 0; i < style.length; i++) salt = (salt * 31 + style.charCodeAt(i)) | 0;
  const at = Math.floor(hash2(seed, 0x5c17, salt, list.length) * list.length);
  return list[(at + turnOf(seed, N)) % list.length];
}
