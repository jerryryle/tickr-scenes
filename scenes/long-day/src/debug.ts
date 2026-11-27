// Build-time debug settings. Shipping builds use these values; test renders build with a
// generated replacement (see tools/build_test.sh) because the board only passes env keys that
// are in the scene's schema.
export const DEBUG_SKIP_MINUTES: number = 0;   // fast-forward the journey in setup()
export const DEBUG_CARGO = "";        // force every job to this cargo id (test renders only)
export const DEBUG_STYLE: string = "";    // force every city to this style id (test renders only)
export const DEBUG_VIEW: string = "";     // "jam" (one fixed shot out in front of the cab, set up as the truck is first held up: its honk, and the clowns if it is held long enough), "sea" (low on the shore of a town on the sea, looking out over the water), "wharf" (beside a port's container wharf), "exit" (over the freeway off-ramp's foot, high and low by turns), "aerial" (high over downtown, for the street layout), "fwBend" (a still shot of an organic town's freeway round its curve), "lineBend" (a still shot of the sharpest bend on the first elevated line, or a cable car's avenue), "block:kx,kz" (circling low over that block), "at:x,z" (circling low over that point; "at:x,z,h" from 16 m out along heading h), "orbit" or "street": a fixed tour camera on the nearest downtown (style renders); "rear", "door", "yard": close on the truck at a stop (the back, the front door, down on the yard or pavement beside it); "dock": over the bay it backs into; "dockIn", "dockSide": at a dock, from the platform's back by the building's wall out into the truck, or on the platform beside the bay; "top": straight down over the back of the truck and the pavement beside it, at a stop; "crewSide", "crewBack", "crewFront", "crewQ": close on the driver on foot at a stop with a long lens (from the street side, behind the truck, ahead, a rear quarter); "works", "worksVats", "worksSpools" show the storybook city's knitting works from across its street; "gate" looks from the road in, outside the entry gate, into town; "traffic" follows the vehicle nearest the truck from its front quarter and picks a new one every 8 s; "siteEdge": low in the street by the stop's site, when it is laid on a block's anchor, looking at the lots past either end
export const DEBUG_JAM_SHOT: string = "";   // DEBUG_VIEW "jam": "x,z,h", where the truck will stand held, to set the shot up there from the first frame
export const DEBUG_HOUR: number = -1;     // pin the hour of day, 0..24 (test renders only)
export const DEBUG_CLIMATE: string = "";  // "season/weather", e.g. "winter/snow", for every city (test renders only)
export const DEBUG_MEMLOG: number = 0;     // log GPU and heap counters every N scene seconds (test renders only)
export const DEBUG_VISIT: string = "";     // test renders: the first visits' specs (visits.ts VisitSpec), as "city=metro-midtown,truck=tractor,season=winter,weather=snow,arriveBy=r12,dressing=7", the next visit's after a "+"; or as JSON (visits.ts parseVisitSpecs), as journey.ts captureSpecs writes them
export const DEBUG_STOP: number = -1;      // test renders: start DEBUG_STOP_LEAD seconds before the dwell at this stop of the first visit (0, its first: journey.ts Journey.stopTime), instead of DEBUG_SKIP_MINUTES in
export const DEBUG_STOP_LEAD: number = 5;
export const DEBUG_SCENARIO: string = "";  // test renders: a named scenario (scenarios.ts), its visits and its stop to watch, as DEBUG_VISIT and DEBUG_STOP would give them
export const DEBUG_SEED: number = 0;       // test renders: this journey seed instead of the env's (0: the env's)
export const DEBUG_SCRUBTEST: number = 0;  // test renders: play forward this many seconds, scrub back half way and play again, logging every tick
export const DEBUG_VIGNETTE: string = "";  // test renders: spawn this street vignette (vignettes.ts VK) near the truck; DEBUG_VIEW "vignette" watches it
export const DEBUG_EXIT: string = "";     // test renders: every freeway city's off-ramp of this kind (route.ts ExitKind: "helix", "slip")
export const DEBUG_ONEWAY: string = "";   // test renders: "all" every city's downtown with one-way streets, "none" none
export const DEBUG_SEA: string = "";      // test renders: "none" leaves every city off the sea (outline.ts)
export const DEBUG_LAYOUT: string = "";   // test renders: every city laid out this way (CityPlan.layout: "grid", "warp"; "river": warped with a river; "round": warped with two roundabouts; "organic": no grid, where the city allows; "organicRiver" / "organicRound": organic with a river / two roundabouts)
// (DEBUG_VIEW "block:kx,kz": that block's key, parsed once.)
export const DEBUG_BLOCK: number[] | null = DEBUG_VIEW.startsWith("block:") ? DEBUG_VIEW.slice(6).split(",").map(Number) : null;
// (DEBUG_VIEW "at:x,z": circling low over that point, a junction say, its traffic about it; "at:x,z,h": from
// a fixed spot in the street 16 m out from it along heading h.)
export const DEBUG_AT: number[] | null = DEBUG_VIEW.startsWith("at:") ? DEBUG_VIEW.slice(3).split(",").map(Number) : null;
export const DEBUG_CLOWN_AFTER: number = 0;   // test renders and tests: the clowns come once the truck has stood held this many seconds (clowns.ts; 0: as they do)
export const DEBUG_CAMLOG: number = 0;     // test renders: log the camera, truck and shot at every tick (TICK lines)
