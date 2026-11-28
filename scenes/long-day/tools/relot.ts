// This tool relots a catalogue city: it writes its lotted blocks' contents afresh into its contents
// file from today's rules (city.ts buildLots and what it builds behind the lots) and leaves
// everything else on file as it is. A **lotted block** is one of the city's shopping, downtown or residential blocks
// with its facility, if any, at the kerb, other than the town's plaza: its lots, their buildings,
// its ground and what stands behind the lots (back yards, garden squares, courts) are its contents.
// Its industry, parks, sites, plaza, streets and countryside keep the recipes on file.
// A rule's recipe takes its frame from the city file's layout, which is written to the centimetre,
// so every recipe of a lotted block comes out a little apart from the drafted one and draws its
// detail (contents.ts seedOf) afresh.
// With --sites it relots instead only the blocks, of any district, whose listed contents hold a
// site (a dock, a stand, a garage or a rental lot) where the rules now put a kerb stop, as when a
// city's facilities change, and leaves every other block's contents as listed.
// Then redraft the facilities' doors and the pavements' furniture, and the tractors' turns
// (docs/long-day-cities.md, "Authoring"):
//   make relot SCENE=long-day ARGS=<city id> [SITES=1]
//   make clearstops SCENE=long-day ARGS=<city id> DOORS=1, then without DOORS=1, in turn until neither changes anything
//   make tractorturns SCENE=long-day ARGS=<city id>
import { CityPlan, fileOf } from "../src/city.ts";
import type { CityFile, CityFileContents } from "../src/cityfile.ts";
import { rowOf } from "../src/contents.ts";
import { siteLayout } from "../src/facilities.ts";
import { STYLES } from "../src/styles.ts";
import { CATALOGUE } from "../src/world.ts";
import { unpackWorld } from "../src/worlddata.ts";
import { cityContentsOf, contentsFileText, contentsPath } from "./cityfiles.ts";

const rlProc = (globalThis as any).process, rlFs = rlProc.getBuiltinModule("node:fs");
const rlCity = CATALOGUE.find((c) => c.id === rlProc.argv[2]);
if (!rlCity) { console.error(`usage: relot <city id> (no city ${rlProc.argv[2]})`); rlProc.exit(2); }
const rlSites = rlProc.argv.includes("--sites"), RL_SITES = new Set(["dock", "stand", "garage", "rentalLot"]);
const rlFile = fileOf(rlCity!), rlListed = JSON.parse(unpackWorld("contents", rlFile.id)!) as CityFileContents;
// (The city by its rules: its file's contents left out.)
const rlRuled: CityFile = { ...rlFile, contents: () => null };
const rlPlan = new CityPlan(rlRuled.key, STYLES[rlRuled.style], rlRuled.key, rlRuled);
// (Its plaza where its contents put it: city.ts CityPlan.plaza.)
{ const k = rlFile.blocks.findIndex((_, i) => (rlListed.blocks[i] ?? []).some((r) => r[0] === "plaza")); if (k >= 0) rlPlan.listedPlaza = rlPlan.graph.blockAt(rlFile.blocks[k].at[0], rlFile.blocks[k].at[1])!.id; }
const rlNow = cityContentsOf(rlPlan);
const rlBlocks: CityFileContents["blocks"] = { ...rlListed.blocks };
let rlCount = 0;
rlFile.blocks.forEach((L, i) => {
  const B = rlPlan.graph.blockAt(L.at[0], L.at[1])!, d = rlPlan.district(B.kx, B.kz);
  if (B.id === rlPlan.plaza || siteLayout(rlPlan, B.kx, B.kz).kind !== "kerb") return;
  if (rlSites ? !(rlListed.blocks[i] ?? []).some((r) => RL_SITES.has(r[0] as string)) : d !== "residential" && d !== "commercial" && d !== "downtown") return;
  // (A block with nothing on it, as a river's, is left out, as tools/cityfiles.ts contentsRowsOf leaves it.)
  const rows = (rlNow.blocks.get(B.id) ?? []).map(rowOf);
  if (rows.length) rlBlocks[i] = rows; else delete rlBlocks[i];
  rlCount++;
});
rlFs.writeFileSync(contentsPath(rlFile), contentsFileText(rlFile, { blocks: rlBlocks, streets: rlListed.streets, outskirts: rlListed.outskirts }));
console.log(`${rlFile.id}: ${rlCount} blocks relotted (${contentsPath(rlFile)})`);
