// Build-time debug settings. Shipping builds use these values; test renders build with a
// generated replacement (see tools/build_test.sh) because the board only passes env keys that
// are in the scene's schema.
export const DEBUG_SKIP_MINUTES = 0;   // fast-forward the journey in setup()
export const DEBUG_CARGO = "";        // force every job to this cargo id (test renders only)
export const DEBUG_STYLE: string = "";    // force every city to this style id (test renders only)
export const DEBUG_VIEW: string = "";     // "orbit" or "street": a fixed tour camera on the nearest downtown (style renders); "rear", "door", "yard": close on the truck at a stop (the back, the front door, down on the yard or pavement beside it); "dock": over the bay it backs into
export const DEBUG_HOUR: number = -1;     // pin the hour of day, 0..24 (test renders only)
export const DEBUG_CLIMATE: string = "";  // "season/weather", e.g. "winter/snow", for every city (test renders only)
export const DEBUG_MEMLOG: number = 0;     // log GPU and heap counters every N scene seconds (test renders only)
export const DEBUG_SCRUBTEST: number = 0;  // test renders: play forward this many seconds, scrub back half way and play again, logging every tick
export const DEBUG_VIGNETTE: string = "";  // test renders: spawn this street vignette (vignettes.ts VK) near the truck; DEBUG_VIEW "vignette" watches it
export const DEBUG_CAMLOG: number = 0;     // test renders: log the camera, truck and shot at every tick (TICK lines)
