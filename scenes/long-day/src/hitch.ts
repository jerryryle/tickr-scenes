// The tractor-trailer's hitch, shared by the truck (truck.ts SPECS.tractor, TRAILER) and the
// journey's reversing (journey.ts reversePose). (Its own module, imported by both: truck.ts is
// evaluated after journey.ts, so journey.ts can't read truck.ts's constants at load.)
export const FIFTH_WHEEL = 0.25;        // the tractor's fifth wheel ahead of its rear axle
export const KINGPIN_TO_AXLES = 13.0;   // the trailer's kingpin to its axles
