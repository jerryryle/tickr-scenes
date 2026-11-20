// Build-time debug settings. Shipping builds use these values; test renders build with a
// generated replacement (see tools/build_test.sh) because the board only passes env keys that
// are in the scene's schema.
export const DEBUG_SKIP_MINUTES = 0;   // fast-forward the journey in setup()
export const DEBUG_CARGO = "";        // force every job to this cargo id (test renders only)
export const DEBUG_STYLE: string = "";    // force every city to this style id (test renders only)
export const DEBUG_VIEW: string = "";     // "exit" (over the freeway off-ramp's foot, high and low by turns), "aerial" (high over downtown, for the street layout), "block:kx,kz" (circling low over that block), "orbit" or "street": a fixed tour camera on the nearest downtown (style renders); "rear", "door", "yard": close on the truck at a stop (the back, the front door, down on the yard or pavement beside it); "dock": over the bay it backs into; "siteEdge": low in the street by the stop's site, when it is laid on a block's anchor, looking at the lots past either end
export const DEBUG_HOUR: number = -1;     // pin the hour of day, 0..24 (test renders only)
export const DEBUG_CLIMATE: string = "";  // "season/weather", e.g. "winter/snow", for every city (test renders only)
export const DEBUG_MEMLOG: number = 0;     // log GPU and heap counters every N scene seconds (test renders only)
export const DEBUG_SEED: number = 0;       // test renders: this journey seed instead of the env's (0: the env's)
export const DEBUG_SCRUBTEST: number = 0;  // test renders: play forward this many seconds, scrub back half way and play again, logging every tick
export const DEBUG_VIGNETTE: string = "";  // test renders: spawn this street vignette (vignettes.ts VK) near the truck; DEBUG_VIEW "vignette" watches it
export const DEBUG_EXIT: string = "";     // test renders: every freeway city's off-ramp of this kind (route.ts ExitKind: "helix", "slip")
export const DEBUG_ONEWAY: string = "";   // test renders: "all" every city's downtown with one-way streets, "none" none
export const DEBUG_LAYOUT: string = "";   // test renders: every city laid out this way (CityPlan.layout: "grid", "warp"; "river": warped with a river; "round": warped with two roundabouts; "organic": no grid, where the city allows; "organicRiver" / "organicRound": organic with a river / two roundabouts)
// (DEBUG_VIEW "block:kx,kz": that block's key, parsed once.)
export const DEBUG_BLOCK: number[] | null = DEBUG_VIEW.startsWith("block:") ? DEBUG_VIEW.slice(6).split(",").map(Number) : null;
export const DEBUG_CAMLOG: number = 0;     // test renders: log the camera, truck and shot at every tick (TICK lines)
