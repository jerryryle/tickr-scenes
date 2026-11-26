// Named scenarios: a visit (or two) set up exactly by its specs (visits.ts VisitSpec), and the stop
// to watch, for tests (test/scenarios.ts) and test renders (debug.ts DEBUG_SCENARIO). Each plays the
// same with any journey seed. Write one by hand from a city's sites (make run SCENE=long-day
// TEST=scenarios ARGS="--sites <city id>"), or capture one from a seeded visit (journey.ts
// captureSpecs).
import type { VisitSpec } from "./visits.ts";

export interface Scenario {
  note: string;
  visits: Record<number, VisitSpec>;
  stop: number;   // the stop to watch: its number in the first visit (0, the first)
}

// A box truck in Grand Central on a snowy winter evening: two mattresses from the Lakeview
// furniture warehouse, a team lift through each front door.
const grandCentralMattresses: VisitSpec = {
  city: "metro-grand-central", arriveBy: "r53", truck: "box26", season: "winter", weather: "snow", snow: true, hour: 17.5, freight: "none",
  stops: [{ stops: [
    { kind: "pickup", at: "Lakeview Furniture Warehouse", cargo: "mattresses", units: 2 },
    { kind: "drop", at: "236 Pine Ave", cargo: "mattresses", units: 2 },
  ] }],
};

// A box truck in Saguaro Springs on a clear spring day: four mattresses out of the Dogpatch
// furniture warehouse's front door (no dock there), into a house two blocks along.
const saguaroMattresses: VisitSpec = {
  city: "desert-saguaro-springs", arriveBy: "r34", truck: "box26", season: "spring", weather: "clear", hour: 11, freight: "none",
  stops: [{ stops: [
    { kind: "pickup", at: "Dogpatch Furniture Warehouse", cargo: "mattresses", units: 4 },
    { kind: "drop", at: "3520 Folsom Ave", cargo: "mattresses", units: 4 },
  ] }],
};

export const SCENARIOS: Record<string, Scenario> = {
  "mattress-dock-pickup": { note: "mattresses taken up at a furniture warehouse's loading dock, team lift", visits: { 0: grandCentralMattresses }, stop: 0 },
  "mattress-drop": { note: "mattresses into an apartment's front door from along the pavement, team lift", visits: { 0: grandCentralMattresses }, stop: 1 },
  "mattress-door-pickup": { note: "mattresses out of a furniture warehouse's front door, team lift", visits: { 0: saguaroMattresses }, stop: 0 },
};
