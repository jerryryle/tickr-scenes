// The goods catalog (concept doc, "Goods catalog"): 57 cargo types in four rarity tiers. Each
// type says where it comes from, where it may go, which truck carries it, how many units a
// consignment has and how many pallet slots one unit takes. Phase 7 adds the 3D shapes and the
// driver's handling animation; `handling` is recorded here for it.
import type { TruckModel } from "./truck.ts";
import type { FacilityId } from "./facilities.ts";

type Tier = "common" | "uncommon" | "rare" | "humorous";
export type Handling = "carry" | "handTruck" | "palletJack" | "roll" | "walkOn" | "push" | "teamLift" | "flatbed" | "tow";
interface CargoType {
  id: string; name: string; tier: Tier; handling: Handling;
  from: FacilityId[]; to: FacilityId[];
  truck: TruckModel;             // the truck it needs (box16 loads also fit a box26)
  units: [number, number];       // units per consignment
  slots: number;                 // pallet slots per unit
  season?: "winter" | "autumn";
}

const cargoType = (id: string, name: string, tier: Tier, handling: Handling, from: FacilityId[], to: FacilityId[],
           truck: TruckModel, units: [number, number], slots: number, season?: CargoType["season"]): CargoType =>
  ({ id, name, tier, handling, from, to, truck, units, slots, season });

export const CARGO: CargoType[] = [
  // Common (about 70% of loads).
  cargoType("boxes", "Boxes", "common", "handTruck", ["dc"], ["retail", "office", "residence"], "box26", [6, 16], 0.5),
  cargoType("parcels", "Parcels", "common", "carry", ["parcelHub"], ["residence", "office", "apartment"], "box16", [4, 12], 0.25),
  cargoType("pallets", "Pallets", "common", "palletJack", ["dc", "ryderWarehouse"], ["bigBox", "grocery"], "tractor", [8, 14], 1),
  cargoType("carTires", "Car tires", "common", "roll", ["tireDist"], ["autoShop", "dealership"], "box26", [8, 24], 0.25),
  cargoType("truckTires", "Truck tires", "common", "roll", ["tireDist"], ["ryderService"], "box26", [4, 10], 0.5),
  cargoType("drums", "Steel drums", "common", "roll", ["chemPlant"], ["factory", "autoShop"], "box26", [4, 10], 0.5),
  cargoType("beverages", "Beverages", "common", "handTruck", ["bottling"], ["grocery", "cornerStore"], "box26", [8, 20], 0.5),
  cargoType("kegs", "Beer kegs", "common", "handTruck", ["brewery"], ["bar", "stadium", "sportsBar"], "box26", [6, 16], 0.25),
  cargoType("produce", "Produce", "common", "handTruck", ["farmCoop"], ["grocery", "restaurant"], "box26", [6, 14], 0.5),
  cargoType("bagged", "Bagged goods", "common", "palletJack", ["mill"], ["bakery", "hardware", "construction"], "box26", [2, 6], 1),
  cargoType("paper", "Paper & supplies", "common", "handTruck", ["paperMill"], ["officeTower", "office"], "box26", [6, 14], 0.5),
  cargoType("appliances", "Appliances", "common", "handTruck", ["applianceWh"], ["residence", "apartment"], "box26", [2, 5], 1),
  cargoType("mattresses", "Mattresses", "common", "teamLift", ["furnitureWh"], ["residence", "hotel", "apartment"], "box26", [2, 6], 2),   // laid flat across the bed, one to a row
  cargoType("restaurantSupply", "Restaurant supply", "common", "handTruck", ["foodServiceWh"], ["restaurant", "diner"], "box16", [4, 10], 0.5),
  // Uncommon (20%).
  cargoType("motorcycles", "Motorcycles", "uncommon", "push", ["motoDepot"], ["dealership", "residence"], "box26", [1, 4], 1),
  cargoType("bicycles", "Bicycles", "uncommon", "carry", ["bikeWh"], ["bikeShop"], "box16", [4, 10], 0.25),
  cargoType("sofa", "Sofa", "uncommon", "teamLift", ["furnitureWh"], ["residence", "apartment"], "box26", [1, 2], 2),
  cargoType("tvs", "Big-screen TVs", "uncommon", "carry", ["electronicsDC"], ["electronicsStore", "sportsBar"], "box26", [3, 8], 0.5),
  cargoType("lumber", "Lumber", "uncommon", "flatbed", ["lumberYard"], ["construction"], "flatbed", [2, 4], 2),
  cargoType("pipe", "Pipe bundles", "uncommon", "flatbed", ["plumbingSupply"], ["construction"], "flatbed", [2, 4], 2),
  cargoType("serverRacks", "Server racks", "uncommon", "push", ["electronicsDC"], ["dataCenter"], "box26", [2, 6], 1),
  cargoType("xmasTrees", "Christmas trees", "uncommon", "carry", ["treeFarm"], ["treeLot"], "flatbed", [8, 20], 0.25, "winter"),
  cargoType("pumpkins", "Pumpkins", "uncommon", "palletJack", ["farm", "pumpkinPatch"], ["grocery", "pumpkinPatch"], "box26", [2, 6], 1, "autumn"),
  cargoType("flowers", "Flowers", "uncommon", "carry", ["greenhouse"], ["florist", "weddingVenue"], "box16", [4, 12], 0.25),
  cargoType("frozen", "Frozen goods", "uncommon", "handTruck", ["coldStorage"], ["grocery", "iceCream"], "reefer", [6, 14], 0.5),
  cargoType("medical", "Medical supplies", "uncommon", "handTruck", ["medicalDC"], ["hospital", "pharmacy"], "box16", [4, 10], 0.5),
  cargoType("canoes", "Canoes & kayaks", "uncommon", "teamLift", ["outfitterDC"], ["outfitter", "marina"], "box26", [2, 5], 1),
  // (By the sea: facilities.ts waterfrontAt. SEA_CARGO.)
  cargoType("seafood", "Fresh seafood", "uncommon", "handTruck", ["fishMarket", "coldStorage"], ["restaurant", "grocery", "seafood"], "reefer", [6, 14], 0.5),
  cargoType("shipStores", "Ship's stores", "uncommon", "palletJack", ["foodServiceWh", "dc"], ["shipChandler"], "box26", [2, 5], 1),
  cargoType("surfboards", "Surfboards", "uncommon", "carry", ["outfitterDC", "dc"], ["surfShop"], "box16", [3, 8], 0.25),
  cargoType("nets", "Nets & rope", "uncommon", "handTruck", ["shipChandler"], ["fishMarket", "marina", "boatyard"], "box16", [3, 8], 0.5),
  cargoType("vending", "Vending machines", "uncommon", "push", ["vendingDepot"], ["office", "school"], "box26", [1, 3], 1),
  // Rare (8%).
  cargoType("grandPiano", "Grand piano", "rare", "push", ["pianoMaker"], ["concertHall"], "box26", [1, 1], 3),
  cargoType("upright", "Upright piano", "rare", "push", ["musicStore"], ["residence", "school"], "box26", [1, 1], 1),
  cargoType("arcade", "Arcade cabinets", "rare", "push", ["gameDist"], ["arcade", "bar"], "box26", [2, 5], 1),
  cargoType("hotTub", "Hot tub", "rare", "palletJack", ["spaWh"], ["residence"], "box26", [1, 1], 4),
  cargoType("jetSki", "Jet ski", "rare", "push", ["marineDealer"], ["marina"], "box26", [1, 2], 2),
  cargoType("cheese", "Giant cheese wheel", "rare", "roll", ["creamery"], ["deli"], "reefer", [1, 1], 1),
  cargoType("cake", "Wedding cake", "rare", "carry", ["bakery"], ["weddingVenue"], "reefer", [1, 1], 1),
  cargoType("gym", "Gym equipment", "rare", "push", ["fitnessDC"], ["gym"], "box26", [3, 8], 1),
  cargoType("museumCrate", "Museum crate", "rare", "palletJack", ["artStorage"], ["museum"], "box26", [1, 2], 2),
  // Humorous (2%, tunable with humorFrequency).
  cargoType("cow", "A cow", "humorous", "walkOn", ["farm"], ["pettingZoo", "countyFair"], "box26", [1, 1], 3),
  cargoType("goats", "Goats", "humorous", "walkOn", ["farm"], ["goatYoga"], "box26", [3, 5], 0.5),
  cargoType("gorilla", "Inflatable gorilla", "humorous", "teamLift", ["partySupply"], ["dealership"], "box26", [1, 1], 4),
  cargoType("doughnut", "Giant doughnut sign", "humorous", "flatbed", ["signShop"], ["doughnutShop"], "flatbed", [1, 1], 4),
  cargoType("ducks", "Rubber ducks", "humorous", "palletJack", ["toyImporter"], ["toyStore"], "box26", [1, 1], 2),
  cargoType("gnomes", "Garden gnomes (40)", "humorous", "palletJack", ["gardenDC"], ["gardenCenter"], "box26", [1, 1], 1),
  cargoType("bowling", "Bowling balls", "humorous", "roll", ["bowlingSupply"], ["bowlingAlley"], "box16", [1, 2], 1),
  cargoType("penguin", "Penguin crate", "humorous", "handTruck", ["aquariumTransfer"], ["aquarium"], "reefer", [1, 1], 1),   // (on the hand truck: the reefer's lift gate is too short for a pallet jack and the driver)
  cargoType("trophy", "World's Best Driver trophy", "humorous", "carry", ["trophyShop"], ["ryderOffice"], "box16", [1, 1], 0.25),
  cargoType("envelope", "One tiny envelope", "humorous", "carry", ["lawOffice"], ["courthouse"], "box26", [1, 1], 12),
  cargoType("sailboat", "Sailboat", "humorous", "tow", ["boatyard"], ["marina"], "flatbed", [1, 1], 4),
  cargoType("toilet", "Portable toilet", "humorous", "teamLift", ["sanitationDepot"], ["construction"], "flatbed", [1, 2], 2),
  // The storybook city's cargo includes the knitting works' striped bolts of knitting, rolled out (journey.ts makeJob).
  cargoType("knitwear", "Bolts of knitting", "uncommon", "roll", ["knittingWorks"], ["retail", "outfitter", "toyStore", "cornerStore", "bigBox", "laundromat", "partySupply"], "box26", [4, 10], 0.5),
  // And its other wonders are made only there (STORY_CARGO is never drawn outside a storybook city), and are
  // carried about it, or out to the next city as freight (journey.ts freightFor).
  cargoType("rainbowJars", "Bottled rainbows", "uncommon", "handTruck", ["pharmacy", "florist"], ["cafe", "restaurant", "retail", "bakery", "hotel"], "box26", [4, 10], 0.5),
  cargoType("lollipops", "Giant lollipops", "uncommon", "carry", ["bakery", "iceCream"], ["iceCream", "toyStore", "cornerStore", "partySupply", "school"], "box16", [2, 6], 0.25),
  cargoType("cloudCushions", "Cloud cushions", "uncommon", "carry", ["knittingWorks"], ["hotel", "residence", "retail", "apartment", "outfitter"], "box26", [3, 8], 0.5),
  cargoType("windupToys", "Wind-up toys", "uncommon", "handTruck", ["hardware", "toyStore"], ["toyStore", "retail", "school", "partySupply"], "box26", [4, 10], 0.5),
  cargoType("balloons", "Balloon bunches", "uncommon", "carry", ["partySupply", "toyStore"], ["school", "theater", "cafe", "residence", "hotel"], "box16", [2, 6], 0.5),
  cargoType("musicBoxes", "Music boxes", "uncommon", "carry", ["musicStore", "toyStore"], ["theater", "hotel", "residence", "museum", "retail"], "box16", [2, 6], 0.25),
  // Baton in-jokes.
  cargoType("teeth", "Jar of additional teeth", "humorous", "carry", ["pawnShop"], ["dentist"], "box16", [1, 1], 0.25),
  cargoType("redPanda", "Giant stuffed red panda", "humorous", "teamLift", ["toyStore", "partySupply"], ["office", "officeTower"], "box26", [1, 1], 3),
  cargoType("capybara", "Giant stuffed capybara", "humorous", "teamLift", ["toyStore", "partySupply"], ["office", "officeTower"], "box26", [1, 1], 3),
  cargoType("frog", "Giant inflatable frog (for Frog Week)", "humorous", "teamLift", ["partySupply"], ["office", "school"], "box26", [1, 1], 3),
];

export const CARGO_BY_ID = new Map(CARGO.map((c) => [c.id, c]));

// Pallet slots per truck (concept doc: box truck 12, tractor-trailer 26). The tractor's trailer has
// a 13.2 m box (truck.ts TRAILER), shorter than the concept's, so it has 20 slots in rows as long.
export const TRUCK_SLOTS: Record<TruckModel, number> = { box16: 8, box26: 12, reefer: 10, flatbed: 8, tractor: 20 };

// Where loads sit in the bed. Every aboard entry keeps the pallet slot it was stowed at (`slot`),
// so a load stays put while others come and go. Units of a slot or more take whole slots (two or
// more slots: a pair across the bed, starting on an even slot); smaller units share slots.
export function slotAlign(spu: number, s: number) {
  let k = Math.ceil(s - 1e-6);
  if (Math.ceil(spu) >= 2 && k % 2) k++;
  return k;
}
export function slotEnd(spu: number, units: number, start: number) {
  if (spu < 1) return start + units * spu;
  const span = Math.ceil(spu);
  let s = start;
  for (let u = 0; u < units; u++) s = slotAlign(spu, s) + span;
  return s;
}
// First free run from the front wall for `units` of size `spu`, among `aboard`; -1 if none.
// (`from`: no nearer the front than this slot.)
export function slotFind(aboard: { slot: number; slotsPerUnit: number; units: number }[], spu: number, units: number, slots: number, from = 0) {
  const used = aboard.map((a) => [a.slot, Math.ceil(slotEnd(a.slotsPerUnit, a.units, a.slot) - 1e-6)]).sort((p, q) => p[0] - q[0]);
  for (const c of [from, ...used.map((u) => u[1]).filter((u) => u >= from)].sort((p, q) => p - q)) {
    const k = slotAlign(spu, c), e = slotEnd(spu, units, k);
    if (e > slots + 1e-6) continue;
    if (used.every(([a, b]) => e <= a + 1e-6 || k >= b - 1e-6)) return k;
  }
  return -1;
}
// Close the gaps: everything aboard slides to the front, in its current order. Only when a new
// load would not otherwise fit, or the load moves to another truck; done with the doors shut.
export function slotCompact(aboard: { slot: number; slotsPerUnit: number; units: number; cargo?: string }[]) {
  let s = 0;
  for (const a of [...aboard].sort((p, q) => p.slot - q.slot)) { a.slot = slotAlign(a.slotsPerUnit, s); s = slotEnd(a.slotsPerUnit, a.units, a.slot); }
}

// Whether `truck` can carry cargo that asks for `need`.
export function truckCarries(truck: TruckModel, need: TruckModel) {
  return truck === need || (need === "box16" && truck === "box26");
}

const TIER_WEIGHT: Record<Tier, number> = { common: 0.70, uncommon: 0.20, rare: 0.08, humorous: 0.02 };

// Pick a cargo type: a tier by weight (humorous scaled by humorFrequency, default 0.02), then a
// type within it. `r1`, `r2` are uniform randoms; seasonal types are skipped out of season, and
// types `allow` (when given) refuses are skipped too, as are tiers left with none. Null when
// nothing is left.
// The waterfront's cargo (facilities.ts waterfrontAt), which a town on the sea favours (journey.ts makeJob).
export const SEA_CARGO = new Set(["seafood", "shipStores", "surfboards", "nets"]);
// The storybook city's cargo is made only there. It is never drawn but where allowed for it (pickCargo),
// which is only ever in a storybook city or as its freight out (journey.ts makeJob, freightFor).
export const STORY_CARGO = new Set(["knitwear", "rainbowJars", "lollipops", "cloudCushions", "windupToys", "balloons", "musicBoxes"]);
// Those the knitting works makes (which every storybook city has) are what one sends on as freight.
export const STORY_FREIGHT = ["knitwear", "cloudCushions"];
// (Whatever `allow` says, the storybook city's are drawn only with `story`, which only its own job picks pass.)
export function pickCargo(r1: number, r2: number, humor: number, season: "winter" | "autumn" | null, allow?: (c: CargoType) => boolean, story = false): CargoType | null {
  const ok = (c: CargoType) => (!c.season || c.season === season) && (story || !STORY_CARGO.has(c.id)) && (!allow || allow(c));
  const tiers = (["common", "uncommon", "rare", "humorous"] as Tier[]).filter((t) => CARGO.some((c) => c.tier === t && ok(c)));
  const w = { ...TIER_WEIGHT, humorous: humor };
  const total = tiers.reduce((a, t) => a + w[t], 0);
  let x = r1 * total;
  let tier: Tier = tiers[0];
  for (const t of tiers) { if (x < w[t]) { tier = t; break; } x -= w[t]; }
  if (!tier) return null;
  const list = CARGO.filter((c) => c.tier === tier && ok(c));
  return list[Math.floor(r2 * list.length)];
}
