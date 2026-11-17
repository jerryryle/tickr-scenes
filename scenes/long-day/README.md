# Long Day

A delivery truck's working day, rendered in 3D (three.js): city legs, country runs, loading docks,
traffic and weather. Imported from the v135 source export.

```bash
make long-day           # -> build/long-day/
make check-long-day     # type-check, load-test and run the tests
```

## Source

`src/main.ts` is the entry; the other modules in `src/` are pulled in through its imports.
`src/grid.ts` and `src/facadetiles.ts` hold constants that other modules use while loading, so
they import nothing (most of the city, journey and rendering modules import each other in a
cycle, which is fine for code inside functions but not for top-level initializers).

`src/cars.ts` holds the car models (sedan, hatchback, wagon, SUV, pickup, van) that every car
in the scene uses: traffic, oncoming and freeway cars (`CarFleet`), and parked cars baked into
static geometry (`parkedCar`). Draw new cars with these rather than building them in place.
`tools/showroom.ts` is a test scene that lines them up (and a parking garage) for a close look:
`make tool SCENE=long-day TOOL=showroom SECS=17` renders it to `build/long-day-showroom/showroom.png`.

`src/vignettes.ts` holds the street vignettes (a dog at a "no dogs" sign, a dog walker towed by a
pack, a wet-paint bench, window washers, a crossing guard, a food truck's queue, snow and night
scenes and the rest), each chosen for its district, hour, weather and season and placed on real
pavement furniture or doors. `src/figure.ts` draws their people, dogs and props (and the crowd's).
To watch one in a test render:

```bash
make debug SCENE=long-day DEFINE="DEBUG_VIEW=vignette DEBUG_VIGNETTE=hydrant DEBUG_HOUR=14 DEBUG_CLIMATE=summer/clear DEBUG_SKIP_MINUTES=1"
```

`src/chunks.ts` streams the city's blocks round the truck. City chunks that leave the view are
kept, detached, in a cache (up to `CHUNK_CACHE_BYTES` of geometry, `src/main.ts`) instead of being
disposed, so streets driven again come straight back, and the blocks round the rest of the truck's
route and its next stops are built ahead into that cache in otherwise idle frames. A kept chunk
holds its sign and plate atlas slots, so the cache sheds its oldest chunks when either atlas runs
low. `DEBUG_MEMLOG` reports the cache's size and hits.

`src/facadeart.ts` paints the facade atlas on the first frame: the 16 facade kinds in
`src/facadetiles.ts`, four variants of each (each building gets one), at 128 px a tile, with a
mask saying which pixels take the building's colour, which are glass lit from inside after dark,
and how brightly. The `facades` asset (the old 16-tile atlas) is what the material starts with,
and stays in use if painting fails. To look at the atlas, bundle a script that captures a
canvas class with `captureCanvasClass` and writes `paintFacadeAtlas()`'s canvases to PNG.

`src/debug.ts` holds build-time debug constants (`DEBUG_SKIP_MINUTES`, `DEBUG_STYLE`,
`DEBUG_VIEW`, `DEBUG_HOUR`, `DEBUG_CLIMATE`, `DEBUG_CARGO`, `DEBUG_MEMLOG`, `DEBUG_SCRUBTEST`, `DEBUG_CAMLOG`).
Shipping builds use its defaults; a debug build overrides them, since the board only passes env
keys that are in the scene's schema:

```bash
make debug SCENE=long-day DEFINE="DEBUG_SKIP_MINUTES=40 DEBUG_STYLE=metro DEBUG_HOUR=18"
```

## Tests

`test/journey.ts` fast-forwards the journey (70 minutes, seed 0 by default) and checks its
invariants: the cargo ledger balances and never exceeds the truck's capacity, seeking forward or
back reproduces the state, the truck never jumps, halts abruptly or gets stuck, country hand-overs
match speed and heading, and it never crosses in front of a train. `make check` runs it. To run it with other arguments and see its report:

```bash
make run SCENE=long-day TEST=journey ARGS="30 '{\"seed\":2}'"
make run SCENE=long-day TEST=journey ARGS=30 DEFINE=DEBUG_CARGO=kegs
```
