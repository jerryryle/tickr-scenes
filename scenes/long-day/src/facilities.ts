// Facilities: every block has one, chosen by its district (weighted, hashed from the seed and
// the block, so it never changes). `dock` facilities have a loading dock on one side of the
// block that trucks reverse into; Ryder rental lots have a lot of parked trucks on one side;
// the rest are kerb stops. siteLayout() is the single description of that street side, read by
// the chunk builder (city.ts) to build it and by the journey to drive to it.
import { hash2 } from "./rng.ts";
import { CARGO } from "./cargo.ts";
import type { TruckModel } from "./truck.ts";
import { CityPlan } from "./city.ts";
import type { District } from "./city.ts";

export type FacilityId = keyof typeof FAC;
export interface FacilityDef { label: string; w: Partial<Record<District, number>>; dock?: boolean }

export const FAC = {
  // Industrial sources and receivers.
  dc: { label: "Distribution Center", w: { industrial: 10 }, dock: true },
  ryderWarehouse: { label: "Ryder Warehouse", w: { industrial: 4 }, dock: true },
  parcelHub: { label: "Parcel Hub", w: { industrial: 4 }, dock: true },
  tireDist: { label: "Tire Distributor", w: { industrial: 3 }, dock: true },
  bottling: { label: "Bottling Plant", w: { industrial: 3 }, dock: true },
  brewery: { label: "Brewery", w: { industrial: 2.5, commercial: 0.6 }, dock: true },
  coldStorage: { label: "Cold Storage", w: { industrial: 3 }, dock: true },
  lumberYard: { label: "Lumber Yard", w: { industrial: 3 } },
  chemPlant: { label: "Chemical Plant", w: { industrial: 2 }, dock: true },
  factory: { label: "Factory", w: { industrial: 3 }, dock: true },
  mill: { label: "Mill & Garden Supply", w: { industrial: 2 }, dock: true },
  paperMill: { label: "Paper Mill", w: { industrial: 1.5 }, dock: true },
  applianceWh: { label: "Appliance Warehouse", w: { industrial: 2 }, dock: true },
  furnitureWh: { label: "Furniture Warehouse", w: { industrial: 3 }, dock: true },
  foodServiceWh: { label: "Food Service Warehouse", w: { industrial: 2 }, dock: true },
  motoDepot: { label: "Motorcycle Depot", w: { industrial: 1 }, dock: true },
  bikeWh: { label: "Bike Warehouse", w: { industrial: 1 }, dock: true },
  electronicsDC: { label: "Electronics DC", w: { industrial: 2 }, dock: true },
  plumbingSupply: { label: "Plumbing Supply", w: { industrial: 2 } },
  medicalDC: { label: "Medical DC", w: { industrial: 1.2 }, dock: true },
  outfitterDC: { label: "Outfitter DC", w: { industrial: 1 }, dock: true },
  vendingDepot: { label: "Vending Depot", w: { industrial: 1 }, dock: true },
  pianoMaker: { label: "Piano Maker", w: { industrial: 0.6 } },
  gameDist: { label: "Game Distributor", w: { industrial: 0.6 }, dock: true },
  spaWh: { label: "Spa Warehouse", w: { industrial: 0.6 }, dock: true },
  marineDealer: { label: "Marine Dealer", w: { industrial: 0.6 } },
  creamery: { label: "Creamery", w: { industrial: 0.6 }, dock: true },
  fitnessDC: { label: "Fitness DC", w: { industrial: 0.6 }, dock: true },
  artStorage: { label: "Art Storage", w: { industrial: 0.6 }, dock: true },
  partySupply: { label: "Party Supply", w: { industrial: 0.5, commercial: 0.4 } },
  signShop: { label: "Sign Shop", w: { industrial: 0.6 } },
  toyImporter: { label: "Toy Importer", w: { industrial: 0.6 }, dock: true },
  gardenDC: { label: "Garden Center DC", w: { industrial: 0.6 }, dock: true },
  bowlingSupply: { label: "Bowling Supply", w: { industrial: 0.5 } },
  aquariumTransfer: { label: "Aquarium Transfer", w: { industrial: 0.5 } },
  sanitationDepot: { label: "Sanitation Depot", w: { industrial: 0.6 } },
  dataCenter: { label: "Data Center", w: { industrial: 1 }, dock: true },
  ryderService: { label: "Ryder Service Bay", w: { industrial: 1.5 } },
  rentalLot: { label: "Ryder Rental", w: { industrial: 2.5 } },
  construction: { label: "Construction Site", w: { industrial: 1, commercial: 1, downtown: 1.5, residential: 0.6 } },
  // Shops, restaurants and services.
  retail: { label: "Retail", w: { commercial: 6 } },
  bigBox: { label: "Big-Box Store", w: { commercial: 3 }, dock: true },
  grocery: { label: "Grocery", w: { commercial: 4 }, dock: true },
  cornerStore: { label: "Corner Store", w: { commercial: 3, residential: 0.8 } },
  restaurant: { label: "Restaurant", w: { commercial: 4, downtown: 2 } },
  diner: { label: "Diner", w: { commercial: 2 } },
  bar: { label: "Bar", w: { commercial: 3, downtown: 1 } },
  sportsBar: { label: "Sports Bar", w: { commercial: 1 } },
  autoShop: { label: "Auto Shop", w: { commercial: 3, industrial: 1 } },
  dealership: { label: "Dealership", w: { commercial: 2 } },
  bakery: { label: "Bakery", w: { commercial: 2, residential: 0.4 } },
  hardware: { label: "Hardware", w: { commercial: 2 } },
  bikeShop: { label: "Bike Shop", w: { commercial: 1 } },
  electronicsStore: { label: "Electronics", w: { commercial: 1.5 } },
  florist: { label: "Florist", w: { commercial: 1.5 } },
  iceCream: { label: "Ice Cream", w: { commercial: 1 } },
  pharmacy: { label: "Pharmacy", w: { commercial: 1.5 } },
  outfitter: { label: "Outfitters", w: { commercial: 1 } },
  arcade: { label: "Arcade", w: { commercial: 0.8 } },
  deli: { label: "Deli", w: { commercial: 1 } },
  gym: { label: "Gym", w: { commercial: 1 } },
  musicStore: { label: "Music", w: { commercial: 0.8 } },
  trophyShop: { label: "Trophies", w: { commercial: 0.5 } },
  toyStore: { label: "Toys", w: { commercial: 1 } },
  gardenCenter: { label: "Garden Center", w: { commercial: 1 } },
  bowlingAlley: { label: "Lanes", w: { commercial: 0.7 } },
  doughnutShop: { label: "Doughnuts", w: { commercial: 0.8 } },
  goatYoga: { label: "Goat Yoga", w: { commercial: 0.5 } },
  cafe: { label: "Coffee", w: { commercial: 2, downtown: 1 } },
  dentist: { label: "Dental", w: { commercial: 1.2, downtown: 0.4 } },
  motel: { label: "Motel", w: { commercial: 0.8 } },
  barber: { label: "Barbers", w: { commercial: 1 } },
  pawnShop: { label: "Pawn", w: { commercial: 0.6 } },
  laundromat: { label: "Laundromat", w: { commercial: 0.8, residential: 0.3 } },
  petGroomer: { label: "Dog Spa", w: { commercial: 0.5 } },
  theater: { label: "Theater", w: { downtown: 0.8, commercial: 0.3 } },
  // Downtown.
  office: { label: "Offices", w: { downtown: 5, commercial: 1.5 } },
  officeTower: { label: "Tower", w: { downtown: 6 }, dock: true },
  hotel: { label: "Hotel", w: { downtown: 3 } },
  concertHall: { label: "Concert Hall", w: { downtown: 1 } },
  museum: { label: "Museum", w: { downtown: 1 } },
  aquarium: { label: "Aquarium", w: { downtown: 0.7 } },
  hospital: { label: "Hospital", w: { downtown: 1.5, commercial: 0.4 }, dock: true },
  stadium: { label: "Stadium", w: { downtown: 0.6 } },
  courthouse: { label: "Courthouse", w: { downtown: 0.8 } },
  lawOffice: { label: "Law Office", w: { downtown: 1 } },
  ryderOffice: { label: "Ryder Office", w: { downtown: 0.6 } },
  // Homes.
  residence: { label: "Residence", w: { residential: 12 } },
  apartment: { label: "Apartments", w: { residential: 4 } },
  school: { label: "School", w: { residential: 1.2 } },
  // Parks stand in for the city's edge until phase 10 adds the country.
  weddingVenue: { label: "Wedding Venue", w: { park: 1, downtown: 0.4 } },
  countyFair: { label: "County Fair", w: { park: 1 } },
  pettingZoo: { label: "Petting Zoo", w: { park: 1 } },
  marina: { label: "Marina", w: { park: 1 } },
  farm: { label: "Farm", w: { park: 1.5 } },
  farmCoop: { label: "Farm Co-op", w: { park: 1 } },
  treeFarm: { label: "Tree Farm", w: { park: 0.8 } },
  greenhouse: { label: "Greenhouse", w: { park: 1 } },
  pumpkinPatch: { label: "Pumpkin Patch", w: { park: 0.8 } },
  treeLot: { label: "Tree Lot", w: { park: 0.6, commercial: 0.3 } },
  boatyard: { label: "Boatyard", w: { park: 0.7 } },
  // The waterfront's own (waterfrontAt: on blocks by the sea only, never drawn by district).
  fishMarket: { label: "Fish Market", w: {}, dock: true },
  shipChandler: { label: "Ship Chandler", w: {} },
  seafood: { label: "Seafood", w: {} },
  surfShop: { label: "Surf Shop", w: {} },
} satisfies Record<string, FacilityDef>;

const FAC_IDS = Object.keys(FAC) as FacilityId[];
const FAC_BY_DISTRICT = new Map<District, { ids: FacilityId[]; cum: number[]; total: number }>();
for (const d of ["downtown", "commercial", "residential", "industrial", "park"] as District[]) {
  const ids: FacilityId[] = [], cum: number[] = [];
  let total = 0;
  for (const id of FAC_IDS) {
    const w = (FAC[id] as FacilityDef).w[d] ?? 0;
    if (w > 0) { total += w; ids.push(id); cum.push(total); }
  }
  FAC_BY_DISTRICT.set(d, { ids, cum, total });
}

export function facilityAt(plan: CityPlan, bx: number, bz: number): FacilityId {
  const park = !!plan.blockOf(bx, bz)?.park, wf = park ? null : waterfrontAt(plan, bx, bz);
  if (wf) return wf;
  const t = FAC_BY_DISTRICT.get(park ? "park" : plan.district(bx, bz))!;
  const r = hash2(bx, bz, plan.seed, 0xfac) * t.total;
  let i = 0;
  while (i < t.cum.length - 1 && t.cum[i] <= r) i++;
  return t.ids[i];
}
const isDock = (id: FacilityId) => (FAC[id] as FacilityDef).dock === true;
// By the sea (outline.ts nearShore), some blocks are the waterfront's trades: in a port, among its
// docks, fish markets (where the reefers load) and ship chandlers, and seafood places among its
// shops; in a seaside town, seafood places and surf shops along the promenade.
function waterfrontAt(plan: CityPlan, bx: number, bz: number): FacilityId | null {
  const port = plan.style.id === "port";
  if (!port && plan.style.id !== "coastal") return null;
  if (!plan.shoreLine.nearShore(bx, bz, 1.3)) return null;
  const d = plan.district(bx, bz), r = hash2(bx, bz, plan.seed, 0xfa7);
  if (port && d === "industrial") return r < 0.3 ? "fishMarket" : r < 0.5 ? "shipChandler" : null;
  if (d !== "commercial") return null;
  return port ? (r < 0.35 ? "seafood" : null) : r < 0.3 ? "seafood" : r < 0.5 ? "surfShop" : null;
}

// ---- names ----------------------------------------------------------------------------------
const PLACES = ["Hayes Valley", "Mission", "Dogpatch", "Potrero", "Sunset", "Riverside", "Harbor", "Elm Park",
  "Northgate", "Lakeview", "Old Town", "Westside", "Union", "Cedar Hill", "Bayshore", "Summit"];
const PEOPLE = ["Big Al's", "Rosa's", "Mike's", "Patel's", "Dot's", "Lou's", "Kim's", "Hank's", "Nana's", "Gus's", "Bea's", "Sal's"];
const AVENUES = ["Oak", "Maple", "Pine", "Cedar", "Birch", "Walnut", "Elm", "Spruce", "Ash", "Willow", "Laurel", "Juniper",
  "Market", "Mission", "Valencia", "Folsom", "Harrison", "Bryant", "Fillmore", "Octavia"];
// Small chance of an in-joke name for these facilities.
const IN_JOKES: Partial<Record<FacilityId, string[]>> = {
  officeTower: ["Baton Tower"], office: ["Baton Labs", "Harmony Data Co."], partySupply: ["GoatBox Party Supply", "Frog Week Party Supply"],
  grocery: ["Hayes Valley Grocers"], diner: ["Anton's Diner"], plumbingSupply: ["Diameter Pipe & Supply"],
  bar: ["The Function Pointer"], ryderOffice: ["Ryder HQ"], trophyShop: ["Ever Better Trophies"],
  bakery: ["Function Pointers Bakery"], dentist: ["Additional Teeth Dental"], cafe: ["Extraction Ratio Coffee", "18 Grams Coffee"],
  theater: ["The Tickr Theater"], petGroomer: ["Belle's Dog Spa"], musicStore: ["Harmony Music"], pawnShop: ["Jar of Teeth Pawn"],
  laundromat: ["Live Above the Lint"], barber: ["Extreme Ownership Barbers"], tireDist: ["Radius Tire & Wheel"],
  toyStore: ["Red Panda Toys"], hardware: ["JerryCo Walls & Hardware"], restaurant: ["Respect the Pasta"],
};
const POSSESSIVE = new Set<FacilityId>(["tireDist", "autoShop", "diner", "deli", "bakery", "hardware", "bar", "cornerStore",
  "bikeShop", "musicStore", "trophyShop", "doughnutShop", "iceCream", "florist", "restaurant", "toyStore", "barber", "cafe", "pawnShop"]);

const ordinal = (n: number) => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
const wrapIndex = (n: number, len: number) => ((n % len) + len) % len;
export const streetNameEW = (iz: number) => `${ordinal(wrapIndex(iz, 48) + 1)} St`;
export const streetNameNS = (ix: number) => `${AVENUES[wrapIndex(ix, AVENUES.length)]} Ave`;

export function facilityName(plan: CityPlan, id: FacilityId, bx: number, bz: number): string {
  const h = (salt: number) => hash2(bx, bz, plan.seed, salt);
  const label = (FAC[id] as FacilityDef).label;
  const jokes = IN_JOKES[id];
  if (jokes && h(1) < 0.12) return jokes[Math.floor(h(2) * jokes.length)];
  if (id === "rentalLot" || id === "ryderWarehouse" || id === "ryderService" || id === "ryderOffice") return label;
  if (id === "residence" || id === "apartment") {
    const num = 100 + wrapIndex(bx, 40) * 100 + Math.floor(h(3) * 40) * 2;
    return `${num} ${streetNameNS(bx + 1)}`;
  }
  if (POSSESSIVE.has(id) && h(4) < 0.5) return `${PEOPLE[Math.floor(h(5) * PEOPLE.length)]} ${label}`;
  return `${PLACES[Math.floor(h(6) * PLACES.length)]} ${label}`;
}

// ---- site layouts ---------------------------------------------------------------------------
// Positions on a block side ("frontage") are in the frame of that side's kerbside goal
// (route.ts blockGoals; `side` indexes it): `a` metres past the goal node's centre in the
// direction of travel (the block spans a in [9, 51]) and `n` metres into the block from its
// edge, the back of the sidewalk. The kerb lane's centre is at n = -4.5, the kerb face at n = -3.
export interface DockLayout {
  kind: "dock"; side: number;
  deep: boolean;        // a yard deep enough for a tractor-trailer (industrial, and stores that take them)
  edge: number;         // n of the dock platform's edge, where a truck's rear stops
  wall: number;         // n of the building wall behind the platform
  a0: number; a1: number;   // the dock building's frontage
  bays: number[];       // door centres (a)
  active: number;       // the bay a tractor-trailer uses (its neighbours stay clear for the swing in)
  activeBox: number;    // the bay a box truck uses (it can be further along: a shorter pull past)
  stair: "left" | "right" | "end";   // the steps up to the platform: beside the bay on either side, or at the platform's end
  look: number;         // a per-site random for the dock's dressing (doors, shelters, clutter)
}
// Where the steps are for a truck at bay a, as an offset in a from the bay (negative: to the
// truck's left as it stands in the bay, which is the driver's side).
export function dockStair(L: DockLayout, a: number): number {
  if (L.stair === "left") return a - DOCK_STAIR - 0.6 > L.a0 ? -DOCK_STAIR : DOCK_STAIR;   // the platform must reach them
  if (L.stair === "right") return a + DOCK_STAIR + 0.6 < L.a1 ? DOCK_STAIR : -DOCK_STAIR;
  return a - L.a0 < L.a1 - a ? L.a0 + 0.8 - a : L.a1 - 0.8 - a;   // the nearer end of the platform
}
// The dock doors' size at a site (the same at every bay).
export const dockDoorH = (L: DockLayout) => 3.0 + 0.5 * ((L.look * 7.31) % 1);
export const dockDoorW = (L: DockLayout) => (L.bays.length > 1 ? L.bays[1] - L.bays[0] : L.a1 - L.a0) * 0.41;
export const dockBayFor = (L: DockLayout, model: TruckModel) => L.bays[model === "tractor" ? L.active : L.activeBox];
// The bays trucks use at a dock (a shallow one never sees a tractor-trailer).
export const dockUsedBays = (L: DockLayout) => L.deep && L.active !== L.activeBox ? [L.active, L.activeBox] : [L.activeBox];
export interface LotLayout { kind: "lot"; side: number; stalls: { a: number; model: TruckModel | null }[]; tractorA: number }
interface KerbLayout { kind: "kerb" }
// A park facility has no building to deliver to, so it gets a small structure of its own on one
// side, beside the park's entrance path, with a door at frontage `a` (see city.ts buildStand);
// trucks stop on that side. An industrial yard's warehouse is set back behind its yard, so every
// industrial kerb facility (a Ryder service bay, a lumber yard...) gets a shipping container at
// the kerb the same way.
export type StandKind = "farmStand" | "pottingShed" | "salesHut" | "ticketBooth" | "baitShack" | "pavilion" | "container";
// `forklift`: a flatbed's forklift drives out of it and parks inside, so it's deeper: a container
// stands end-on to the street, its cargo doors facing the kerb, in a deeper gap before the
// warehouse; a park's building goes further back.
export interface StandLayout { kind: "stand"; side: number; a: number; stand: StandKind; look: number; forklift: boolean }
// A parking garage with a rooftop stop (garage.ts): trucks come along `side`, drive up onto its
// roof and leave down its far ramp.
export interface GarageLayout { kind: "garage"; side: number }
// A freeway's off-ramp, spiralling down in the block beside it (interchange.ts): no facility.
export interface InterchangeLayout { kind: "interchange"; side: number }
export type SiteLayout = DockLayout | LotLayout | KerbLayout | StandLayout | GarageLayout | InterchangeLayout;
const STANDS: Partial<Record<FacilityId, StandKind>> = {
  farm: "farmStand", farmCoop: "farmStand", greenhouse: "pottingShed", treeFarm: "pottingShed",
  pumpkinPatch: "salesHut", treeLot: "salesHut", countyFair: "ticketBooth", pettingZoo: "ticketBooth",
  marina: "baitShack", boatyard: "baitShack", weddingVenue: "pavilion",
};
export const STAND_DOOR_A = 25;   // the door's frontage: near where a kerb stop leaves the truck's back

export const DOCK_PLATFORM = 1.25;   // dock height: a trailer's floor
export const DOCK_DEPTH = 2;         // platform depth in front of the doors
const DOCK_STAIR = 2.9;       // stairs up to the platform, this far to the truck's left of the bay
export const LOT_STALL_REAR = 15;    // n of the parked trucks' rears in a rental lot (noses to the street)
export const LOT_TRACTOR_N = 33;     // n of the tractor-trailer parked along the back of the lot
const FLEET: TruckModel[] = ["box16", "box26", "box26", "reefer", "flatbed", "box16", "box26"];

export function siteLayout(plan: CityPlan, bx: number, bz: number): SiteLayout {
  if (plan.interchangeAt(bx, bz)) return { kind: "interchange", side: plan.interchange!.side };
  // A block not of the old grid's shape is lotted (city.ts buildLots): its facility is at the
  // kerb, unless the grid's square block fits against one of its faces (its anchor), where a
  // site laid out for the grid's block goes, on that side.
  // (Never on the far side of a one-way street, whose kerb the truck can't drive along: the next
  // side round instead, or, anchored there, at the kerb.)
  const blk = plan.blockOf(bx, bz), G = plan.graph, anchored = !!blk && !blk.square && !!blk.anchor;
  if (blk && !blk.square && (!anchored || !G.drivable(blk.anchor!.face))) return { kind: "kerb" };
  const fac = facilityAt(plan, bx, bz);
  const h = (salt: number) => hash2(bx, bz, plan.seed, salt);
  let side = anchored ? blk!.sides.indexOf(blk!.anchor!.face) : Math.floor(h(0x51de) * 4);
  if (blk && !anchored) for (let k = 0; k < 4 && blk.sides[side] !== undefined && !G.drivable(blk.sides[side]); k++) side = (side + 1) % 4;
  if (fac === "rentalLot") {
    const stalls: LotLayout["stalls"] = [];
    for (let i = 0; i < 6; i++)
      stalls.push({ a: 14.5 + i * 4.2, model: h(0x57a1 + i) < 0.8 ? FLEET[Math.floor(h(0x57b1 + i) * FLEET.length)] : null });
    return { kind: "lot", side, stalls, tractorA: 33 };
  }
  if (!isDock(fac)) {
    const district = plan.district(bx, bz);
    if (district === "industrial") return { kind: "stand", side, a: STAND_DOOR_A, stand: "container", look: h(0x57d), forklift: WIDE_DOOR.has(fac) };
    if ((district === "downtown" || district === "commercial") && h(0x6a7a) < 0.2) return { kind: "garage", side };
    if (district !== "park") return { kind: "kerb" };
    return { kind: "stand", side, a: STAND_DOOR_A, stand: STANDS[fac] ?? "farmStand", look: h(0x57d), forklift: WIDE_DOOR.has(fac) };
  }
  // Stores that take pallets by tractor-trailer have a truck yard as deep as an industrial one.
  const deep = plan.district(bx, bz) === "industrial" || fac === "bigBox" || fac === "grocery";
  const edge = deep ? 22.5 : 12;
  const a0 = 11.5, a1 = deep ? 48.5 : 29.5;
  // Bay spacing varies by site: tight van docks to wide truck bays.
  const bayW = [3.4, 3.9, 4.6][Math.floor(h(0xbaa) * 3)];
  const n = Math.max(1, Math.round((a1 - a0) / bayW)), bw = (a1 - a0) / n;
  const bays = Array.from({ length: n }, (_, i) => a0 + (i + 0.5) * bw);
  // Where a truck can use the bay: far enough in to clear the corner, near enough to the start
  // of the block that, pulling past it to reverse in, it stays clear of the next intersection
  // (a tractor-trailer needs much more room than a box truck).
  const pickBay = (hi: number, salt: number) => {
    const ok = bays.map((_, i) => i).filter((i) => bays[i] >= 13 && bays[i] <= hi);
    return ok.length ? ok[Math.floor(h(salt) * ok.length)] : 0;
  };
  const active = pickBay(19, 0xba7), activeBox = pickBay(deep ? 31 : 26, 0xba8);
  const sk = h(0x57a1);
  const stair: DockLayout["stair"] = sk < 0.45 ? "left" : sk < 0.75 ? "right" : "end";
  return { kind: "dock", side, deep, edge, wall: edge + DOCK_DEPTH, a0, a1, bays, active, activeBox, stair, look: h(0x100c) };
}

// Name signs: which facilities get one, and Ryder's own (the logo on a red board).
// Where loads go on and off a flatbed by forklift: the forklift comes out of the front door and
// goes back in through it, so these facilities have wide double service doors (city.ts kerbDoors).
const WIDE_DOOR = new Set<FacilityId>(["lumberYard", "plumbingSupply", "construction", "signShop", "doughnutShop", "sanitationDepot",
  "treeFarm", "treeLot", "boatyard", "marina"]);
// And where loads go in and out on the pallet jack, through the front door with a pallet on its
// forks (not a house: a hot tub delivered there is no less wide for a wide door, and every house
// in town would have one).
let PALLET_DOOR: Set<FacilityId> | null = null;
const palletDoor = (id: FacilityId) => {
  if (!PALLET_DOOR) {
    PALLET_DOOR = new Set();
    for (const c of CARGO) if (c.handling === "palletJack") for (const f of [...c.from, ...c.to]) if (f !== "residence") PALLET_DOOR.add(f);
  }
  return PALLET_DOOR.has(id);
};
export const wideDoor = (id: FacilityId) => WIDE_DOOR.has(id) || palletDoor(id);
export const isRyderFacility = (id: FacilityId) => id === "rentalLot" || id === "ryderWarehouse" || id === "ryderService" || id === "ryderOffice";
export const hasSign = (id: FacilityId) => id !== "residence" && id !== "apartment";
