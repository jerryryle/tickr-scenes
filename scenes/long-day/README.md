# Long Day

A delivery truck's working day, rendered in 3D (three.js): city legs, country runs, loading docks,
traffic and weather. Imported from the v135 source export.

```bash
make long-day           # -> build/long-day/
make check-long-day     # type-check, load-test and run the tests
```

## Source

Every city is a catalogue city: a folder in `src/city-<style>/` listed in `src/world.ts`
(`docs/long-day-cities.md` describes how cities work). `src/cityfile.ts` reads a city file into its street
graph. Country roads join the cities' gates in a fixed world graph (`src/world-roads.ts`, drafted
by `tools/draftworld.ts` with `make draftworld`), and `src/visits.ts` plans each journey along it:
which city comes next, by which road, and so which gate the truck leaves and enters by.
`test/world.ts` checks the graph and runs the planner over many journeys. Each road has a map of
its own in `src/roads/` (`src/roadmap.ts`): its shape, heights, land, set pieces and every tree,
rock, pole and fence beside it, the same whichever way it is driven. `CountryRoad` in
`src/country.ts` drives a road's map from either end, and `src/countryworld.ts` draws it in the
map's coordinates (docs/long-day-cities.md, "Road maps"). `tools/draftroads.ts` drafts a road's map
from the generator's rules (`tools/roadgen.ts`):

```bash
make draftroads SCENE=long-day                # a map for every road that has none (ARGS="r12" drafts r12 again)
```
 Each city of a journey is a visit:
its city, its way in, and seeds for its jobs, its dressing (traffic, pedestrians, parked cars and
boats), its vignettes and its drive out. A test may build any visit (`Journey`'s `visits`
argument, `VisitSpec` in `src/visits.ts`), and a render its first one:

```bash
make debug SCENE=long-day DEFINE="DEBUG_VISIT=city=coastal-seacliff,truck=tractor,season=winter,weather=snow"
make debug SCENE=long-day DEFINE="DEBUG_VISIT=city=metro-midtown+city=brick-ironworks,arriveBy=r40"   # two visits: midtown, then along r40
make debug SCENE=long-day DEFINE="DEBUG_SCENARIO=mattress-drop DEBUG_VIEW=crewQ"   # a named scenario (src/scenarios.ts), from just before its stop
```

A spec can also fix the visit's stops, freight, snow and hour, and a visit captured from any seed
replays from its spec alone (docs/long-day-cities.md, "Visits"). A city file holds
the city's streets, gates and blocks, and its contents file beside it lists everything that
stands on them. `tools/draftcities.ts` drafts new city files with the
generator, and `test/catalogue.ts` checks every city loads, reads back as written and is fit
for play:

```bash
make draft SCENE=long-day ARGS="metro 40"   # five new metro cities into src/city-metro/ (never overwrites)
```

`make maps` draws each city's and each road's layered SVG map (`tools/mapsvg.ts`) into `build/long-day-maps/`, to
open in an editor and mark up on its markup layer: the plan's blocks, streets, junctions, sites
and gates, and the lots, buildings, trees, street furniture, signal poles, stop signs and doors where
the city's builders put them (`PLACED` in `src/geom.ts`, `PAVEMENT` in `src/decor.ts`). The
street furniture, signal poles, stop signs and facilities' front doors come from the city file,
and so does everything else that stands on the layout, as recipes in the city's contents file
beside it (`src/contents.ts`; docs/long-day-cities.md, "City contents"). The scene carries every city
and road packed in one binary asset and unpacks one only while it uses it: `tools/pack.ts` packs
them into `assets-packed/` before every build (docs/long-day-cities.md, "How the scene carries the
cities"). The maps are build output, too big to commit, and nothing reads them back:

```bash
make maps SCENE=long-day                      # every city's and road's map; ARGS="metro-midtown r40" for some
```

`src/citygraph.ts` is the city as a street graph: intersections, straight streets, the blocks
they enclose and each block's faces along its streets (a face's frontage frame, `facePt`, is
where everything along a street is placed). The generator that drafts a city's file lives in
`tools/` and is not part of the scene (`tools/generatedplan.ts`, `tools/citygen.ts`). From a seed
it lays out the
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

The generator's outline (`tools/outlinegen.ts`) shapes each town. Every layout is laid over the
whole square, then `trimToOutline` (`tools/citygen.ts`) cuts it back: each side's land edge stands in by up to a block
and a half (long, gentle swells, none where the freeway, an elevated line or a cable car runs out
of town), and every coastal and port town has the sea along one side, always the side on the
left of the way in, its shore 1 to 3.5 blocks in with bays and headlands. The gates keep their
twelve slots and outer ends; each gate's street runs straight in from its outer end to wherever
the streets begin, and a gate on the sea side (or out in the sea) is closed, which the way out
of town skips. A port's shore is a stone quay with boats and piers on piles; a coastal town's a
sandy beach below the promenade, with lifeguard towers and, in summer, umbrellas. The sea is one
plane under the town, and the land round it (the outskirts) stops at the water. In about two cities in three,
downtown's streets are one-way, alternate lattice lines each way (`oneWays` in `tools/generatedplan.ts`,
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

Nothing tries to untie a gridlock. Held standing in the street 14 s the truck honks, to no avail;
held 30 s, `src/clowns.ts` sends in a troupe of clowns. They run in along its way from out of sight,
crowd round whatever holds it up (a car, a bus, someone on foot: what comes into its way first, or
the car its junction booking waits for), lift it over their heads and carry it off along the
pavement and out of sight, where it is gone; still held, they come back for the next thing. They
and their load go through anything in their way. The director films the rescue in one held shot
(`director.ts`, beat "clowns"). `test/gridlock.ts` replays cities that once held the truck for good;
`DEBUG_CLOWN_AFTER` brings them sooner in a test render.

`src/boats.ts` holds the boat models in the same way (a motor cruiser, a narrowboat, a sailing
yacht, a rowing boat, a canoe, a kayak and a jet ski, their hulls lofted through stations): the
boats moored along a river town's quays, the upturned rowboat by a bait shack, and the boats
carried as cargo; the car ferry (`ferryModel` in `src/countryworld.ts`) lofts its hull with the
same code. The showroom's last frames line the boats up afloat and ashore, then show the ferry.

The storybook city is a fantasy town that now and then takes a real city's turn. It is never one
of the first two cities, and it never comes within `STORYBOOK_GAP` cities of the last one; past
that, each city is one with `STORYBOOK_ODDS` (`isStorybookCity` in `src/styles.ts`). Its town is
built in `src/city-storybook/storybook-buildings-town.ts` and its knitting works in `src/city-storybook/storybook-landmark-knitting-works.ts`.

Its streets are purple-grey with polka-dot centre lines, checkered pavements, shepherd's-crook
lamps and bunting, and the road in passes under a corkscrew arch. Its buildings are bent towers of
round pods in hats, crooked shop rows and pod houses. Their walls are facade tiles (`facadePrism` in
`src/facade.ts`), so a chunk costs about what other cities' chunks cost, and `test/chunkcost.ts`
holds it to `BUDGET` times the dearest real style. Its trees are tufts, pancakes, droops and
topiary, and its country rolls away in striped hills.

The drive to a storybook city changes the land slowly over its whole length, where other drives
change it around their middle. The road's map holds how much of the storybook there is every 10 m
(`story`, drafted by `tools/roadgen.ts`). From soon after the last city the real land brightens, and
candy-coloured crowns and the odd storybook tree turn up among its own trees (`storyLook` in
`src/countryworld.ts`). Patches of storybook land grow more common and the hills and sky come round,
until the arrival straight is all storybook. Leaving one, the drive runs the same way in reverse.

The trucks go cartoonish along with the land. `makeToon` in `src/truck.ts` builds the cartoon as
morph targets the first time a truck needs it, using the rounding in `src/toontruck.ts`. The cab,
hood, box or trailer is rounded off at the edges and puffed out, the cab is taller and the hood
shorter, and big round headlamps stand on the nose. The tyres are fat on pink rims and the trim is
plum and gold. The box's back, doors and floor and the wheels' places stay where they are, so
docking and loading work the same. Parked fleets are baked the same way (`src/fleet.ts`), and
`make tool SCENE=long-day TOOL=toons SECS=10` shows each model at none, half and all of it.

Its people wear hats and scarves of their own (`FIG_STYLE` in `src/figure.ts`), and one vignette,
a knitter, is found only there. Its traffic is its own contraptions and cartoon Ryder trucks. The
contraptions are a hamster wheel, a walking strider, a caterpillar bus, a pogo hopper, a unicycle
tower, a balloon, a spinning teacup and a snail (`src/storyvehicles.ts`). Each is posed from how
far it has come, so scrubbing replays them. `make tool SCENE=long-day TOOL=storyrides SECS=16`
shows them, and `DEBUG_VIEW=traffic` follows them in the scene.

One block is the knitting works (`CityPlan.worksBlock`). It is a shallow van dock under a
barrel-roofed spinning hall, with its process laid out in the yard beside it. The process runs from
an orchard of white tufts to spools on the hall's front and a knitting head on its roof, and
`KnittingWorksFx` turns its moving parts by scene time. The director holds a wide shot of the works
as the truck pulls up.

The works ships bolts of knitting and cloud cushions, and the city after a storybook one arrives
with a load of one or the other (`freightFor` in `src/journey.ts`). The town's other trades make
wonders of their own: bottled rainbows, giant lollipops, wind-up toys, balloon bunches and music
boxes. They are listed in `STORY_CARGO` in `src/cargo.ts`, and their models are in
`src/cargomodels.ts`. `pickCargo` draws them only when its caller asks for the storybook's, and only
a storybook city's job picks ask. `test/storycargo.ts` plays journeys through one and checks every
pickup, and `make tool SCENE=long-day TOOL=wonders SECS=8` shows the models.

`test/storybook.ts` checks the frequency and the works; to look at it:

```bash
make debug SCENE=long-day DEFINE="DEBUG_STYLE=storybook DEBUG_VIEW=worksHigh DEBUG_SKIP_MINUTES=2"
make tool SCENE=long-day TOOL=whimsy SECS=14     # the art-direction sketch it started from
```

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

`src/slices.ts` runs work a piece at a time. While the truck is in a city, the next city's street
graph (`CityPlan.prepare`), then its sea and the boats on it, are built a few pieces a frame
(`prepareNextCity` in `src/main.ts`), so neither the way out of town nor the hand-over to the next
city builds them all in one frame: on a board a frame that long shows as the truck skipping ahead.
The road out of town is built the same way, a few pieces a journey step over the 30 steps after
the way out is planned (`Journey.exitRoadAhead`), and is drawn from then on. A few materials are
kept compiled and warm from the start by specks far under the ground, drawn once and then hidden
(`keepWarm` in `src/geom.ts`), so the first oncoming car, strapped load or town on the sea isn't a
long frame. `test/slices.ts` checks that a graph or road built ahead is the same
as one built at once.

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
into them), and `test/crewmotion.ts` (the driver never moonwalks or puts their head in a load,
what two carry never goes through a tree or bin on the pavement or out through the truck's sides,
and the pallet jack, steered about its middle, never sinks into a floor, slides sideways or goes
through a wall or the truck), and `test/jackplan.ts` (every move the pallet jack's planner makes,
in a bed between loads, out of a doorway beside the truck, past a post, is clear, joined end to
end and timed at least as it must be), and `test/trailer.ts` (a tractor-trailer at the kerb pulls up
straight, its swing doors are walked round one leaf at a time clear of the driver (the kerb side's
part way past a tree in its way), its pallets are handed over with the forklift at the doors and
moved in the trailer on the pallet jack, the driver up in it, and nothing goes through the truck:
the driver's walks round it, their climb up into the trailer and down past its floor and
underride guard, or the forklift's tines and load). To run it with other arguments and see its report:

```bash
make run SCENE=long-day TEST=journey ARGS="30 '{\"seed\":2}'"
make run SCENE=long-day TEST=journey ARGS=30 DEFINE=DEBUG_CARGO=kegs
```
