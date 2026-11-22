# Long Day

A delivery truck's working day, rendered in 3D (three.js): city legs, country runs, loading docks,
traffic and weather. Imported from the v135 source export.

```bash
make long-day           # -> build/long-day/
make check-long-day     # type-check, load-test and run the tests
```

## Source

`src/citygraph.ts` is the city as a street graph: intersections, straight streets, the blocks
they enclose and each block's faces along its streets (a face's frontage frame, `facePt`, is
where everything along a street is placed). `src/citygen.ts` makes it from the city's seed: the
square grid; one bent out of square, with dropped streets, rivers, superblock parks, diagonal
avenues, old towns, sweeping avenues, radial circuses and one-way roundabouts (where traffic
yields on entry); or, in towns without a freeway, an organic town with no grid at all (a relaxed
Voronoi of streets), which may have a river winding through it (a chain of its cells turned to
water, bridged every third crossing or so) and a roundabout or two (the cells round each laid out
so its streets in run long enough). Each style has its own odds for the three (`layouts` in `src/styles.ts`).
Outside the grid's own cities, most junctions among houses and parks are all-way stops: the
truck and traffic stop at the line, wait a moment, then go in turn. Sites (docks, garages,
rental lots, stands) are drawn on any block with room for their 42 m layout, anchored to one face
and turned to it, with lots filling the rest; curved streets are chains of straight segments. A
big block's middle, past its lots, is filled for its district: set-back towers downtown; car parks
(with cars in) and trees in planters commercially; sheds and stacked containers in industry; and
where people live, a fenced back garden behind each house, with trees beyond. Routing, signals,
traffic, the crowd and the city's drawing all work from the graph.

`src/outline.ts` gives each town its outline. Every layout is laid over the whole square, then
`trimToOutline` (`src/citygen.ts`) cuts it back: each side's land edge stands in by up to a block
and a half (long, gentle swells, none where the freeway, an elevated line or a cable car runs out
of town), and every coastal and port town has the sea along one side, always the side on the
left of the way in, its shore 1 to 3.5 blocks in with bays and headlands. The gates keep their
twelve slots and outer ends; each gate's street runs straight in from its outer end to wherever
the streets begin, and a gate on the sea side (or out in the sea) is closed, which the way out
of town skips. A port's shore is a stone quay with boats and piers on piles; a coastal town's a
sandy beach below the promenade, with lifeguard towers and, in summer, umbrellas. The sea is one
plane under the town, and the land round it (the outskirts) stops at the water. In about two cities in three,
downtown's streets are one-way, alternate lattice lines each way (`oneWays` in `src/citygen.ts`,
kept only where the network stays strongly connected): traffic keeps to the right half, and the
other half is a green bike lane and a loading lane of parked vans and cars. Sites never face the
far side of a one-way street, whose kerb the truck can't drive along. Downtown and commercial
kerbs have a loading zone where the truck stops; some avenues there have a planted median; the
most central kerb-only block downtown is a plaza with a fountain; big residential blocks may
have a cul-de-sac with houses round its turning circle; and a river town's bridges have parapets
and lanterns, its quays railings and benches, and boats lie moored along them. To see a journey's layouts
from above:

```bash
make citymap SCENE=long-day SEED=11 CITIES=4    # -> build/long-day-citymap/city<N>.png
```

`src/main.ts` is the entry; the other modules in `src/` are pulled in through its imports.
`src/grid.ts` and `src/facadetiles.ts` hold constants that other modules use while loading, so
they import nothing (most of the city, journey and rendering modules import each other in a
cycle, which is fine for code inside functions but not for top-level initializers).

`src/cars.ts` holds the car models (sedan, hatchback, wagon, SUV, pickup, van) that every car
in the scene uses: traffic, oncoming and freeway cars (`CarFleet`), and parked cars baked into
static geometry (`parkedCar`). Draw new cars with these rather than building them in place.
`tools/showroom.ts` is a test scene that lines them up (and a parking garage) for a close look:
`make tool SCENE=long-day TOOL=showroom SECS=28` renders it to `build/long-day-showroom/showroom.png`.

`src/traffic.ts` drives the cars, and the truck takes part as one more road user. Each vehicle
books its way through a junction before it crosses the line: its path through as a footprint,
and a conflict zone with every earlier booking it comes near. Later bookings wait short of a
zone until the earlier vehicle has left it, so the order of bookings is the order of right of
way and nobody waits on each other. Who books when follows the rules of the road: with right of
way (straight or right on a green, on round a roundabout; the truck any way on its green, the
lights held for it, and at an unmarked junction) a vehicle books on its approach; giving way (a
left turn on a green, right on red, an all-way stop once stopped, joining a roundabout) it books
at its line once the bookings ahead leave it a gap.
The truck's footprint is its body's real sweep (the nose swinging wide, a trailer cutting in),
and it waits its turn behind a car holding at the line in its lane. Where the next junction's line
lies inside the one it is going through (close junctions in an organic town), it books the two
as one. Drivers follow with the IDM,
each with their own following time, gap acceptance and pace. Pedestrians cross in the same
system: cars give way to anyone on the crosswalk ahead, people wait for a gap in the traffic
before stepping out (at a light, on their green, for cars turning across), and someone about to
walk into a vehicle stops. The journey's driving asks street life
(`src/life.ts`, `truckStop`) where to stop: short of people, vehicles in its body's way ahead
(its trailer's too), its booking's zones, and, pulling out of a dock, a gap in the traffic it
joins, waiting with its nose 3 m clear of the lane (after 12 s, before a gridlock would honk, it
noses out and the traffic stops for it; that wait is no gridlock). So the journey depends on the
street life, and scrubbing replays both together.

`src/boats.ts` holds the boat models in the same way (a motor cruiser, a narrowboat, a sailing
yacht, a rowing boat, a canoe, a kayak and a jet ski, their hulls lofted through stations): the
boats moored along a river town's quays, the upturned rowboat by a bait shack, and the boats
carried as cargo; the car ferry (`ferryModel` in `src/countryworld.ts`) lofts its hull with the
same code. The showroom's last frames line the boats up afloat and ashore, then show the ferry.

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
and how brightly. To look at the atlas, bundle a script that captures a
canvas class with `captureCanvasClass` and writes `paintFacadeAtlas()`'s canvases to PNG.

`src/debug.ts` holds build-time debug constants (`DEBUG_SKIP_MINUTES`, `DEBUG_STYLE`,
`DEBUG_VIEW`, `DEBUG_HOUR`, `DEBUG_CLIMATE`, `DEBUG_CARGO`, `DEBUG_MEMLOG`, `DEBUG_SCRUBTEST`, `DEBUG_LAYOUT`, `DEBUG_EXIT`, `DEBUG_CAMLOG`, `DEBUG_ONEWAY`).
Shipping builds use its defaults; a debug build overrides them, since the board only passes env
keys that are in the scene's schema:

```bash
make debug SCENE=long-day DEFINE="DEBUG_SKIP_MINUTES=40 DEBUG_STYLE=metro DEBUG_HOUR=18"
```

## Tests

`test/journey.ts` fast-forwards the journey (70 minutes, seed 0 by default) and checks its
invariants: the cargo ledger balances and never exceeds the truck's capacity, seeking forward or
back reproduces the state, the truck never jumps, halts abruptly or gets stuck, country hand-overs
match speed and heading, and it never crosses in front of a train. `make check` runs it, and the
street-life tests: `test/truck.ts` (the truck never drives through a vehicle or anyone on foot,
and never stands in the street for long), `test/junctions.ts` (traffic alone round busy
junctions never overlaps or deadlocks) and `test/crossings.ts` (people cross, and nobody runs
into them), and `test/crewmotion.ts` (the driver never moonwalks, and the pallet jack, steered
about its middle, never sinks into a floor, slides sideways or goes through a wall or the truck). To run it with other arguments and see its report:

```bash
make run SCENE=long-day TEST=journey ARGS="30 '{\"seed\":2}'"
make run SCENE=long-day TEST=journey ARGS=30 DEFINE=DEBUG_CARGO=kegs
```
