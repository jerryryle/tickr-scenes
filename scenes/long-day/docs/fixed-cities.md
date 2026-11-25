# Fixed cities

Long Day's cities become a fixed catalogue of curated city files, joined by a fixed world graph of
country roads. The runtime stops generating layouts. A journey's seed chooses only the order in
which the truck visits cities and the dressing it sees in each one. This document records the
requirements and the storage format agreed for that change; none of it is built yet.

## Why fixed cities

Variety in street layout is barely noticeable on the board, while variety in building style,
vignettes, vehicles and colours is. A generator that must be correct for every seed spends most of
its complexity on layouts nobody tells apart, and fixing one city's defect means changing code that
every other city shares. A fixed catalogue makes the set of cities finite, so each can be tested and
hand-fixed on its own, and it frees the effort for the variety that shows.

Two alternatives lost. Curating known-good seeds keeps the generator in the scene, and any change to
the generator moves every curated city. Baking each city's meshes would cost several GB across the
catalogue by the estimate in "Rejected: baked geometry", and it would freeze the dressing that is
meant to change from visit to visit.

## Components

The design has seven parts, and the rest of this document uses these names for them.

1. A **city file** holds one city's plan: its streets, blocks, buildings, gates and pinned dressing.
2. The **catalogue** is the set of city files listed by the world file.
3. The **world graph** joins the cities with country roads. It lives in the **world file**,
   `src/world.ts`.
4. The **visit planner** chooses each next city from the seed.
5. The **drafting tools** run today's generators offline to write a first draft of a city file or
   of the world graph.
6. The **maps** are SVG views of each city and of the world graph.
7. A **visit** is everything that sets up one city of a journey, beyond the city file: which city,
   how the truck arrives, its weather and the seeds for what happens there. The "Visits"
   requirements define it.

## Requirements

### The catalogue

1. The catalogue holds 35 cities: five for each real style (coastal, metro, desert, brick,
   mainstreet and port) and five storybook towns. Each city has a stable id, `<style>-<slug>`, and
   its own name. The first catalogue uses the five names each real style already lists in
   `src/styles.ts`, and five of the storybook's six.
2. Each city's plan is stored in its city file. The runtime reads the plan and never generates a
   layout.
3. A city file decides whether its city has a freeway. Within each style, the catalogue keeps a mix
   of cities with and without one.
4. A city's size is whatever its file lays out, and `cityMinutes` does not change it. The setting
   changes only the time spent in a city, through the number of jobs and the length of the route.
5. Geometry is built at runtime by the existing chunk builder from the plan.
5a. Street furniture, signal poles and stop signs are pre-generated: each city file lists them,
    with their places, and the scene draws what the file lists. That covers lamps, hydrants,
    bins, benches, mailboxes, newspaper boxes, meters, shelters, bike racks, street trees, every
    signal pole and every stop sign's post. Drafting writes them out from today's rules, and from
    then on they are edited by hand like the rest of the file.

### What varies, and what does not

6. Seasons never change a city's street or building layout. A season may change which other
   vehicles appear and which vignettes are used, and it may close streets if street closures are
   ever added.
7. The visit's dressing seed (requirement 27) chooses the dressing that the plan leaves open:
   traffic, parked cars, vehicles, vignettes, the crowd, boats and colours. Season, weather and time
   of day vary as they do today, set by the visit.
8. A city file may pin dressing. A pin fixes a vignette, vehicle or colour at a place, optionally in
   chosen seasons only.

### The world graph

9. The world graph is connected. It is stored in the world file and changes only when cities are
   added or removed.
10. Each edge has one fixed country road with its own length in metres, which need not match any
    geographic distance. How long a drive takes follows from the length, the truck's speed and its
    stops on the way; a city's time is planned at an average 18 m/s (`DRIVE_PACE`), and the next
    city starts when the truck arrives. The drafted lengths (about 1,100 to 5,400 m) keep the
    average drive as long as the drive times they replaced. Each direction along a road is a fixed
    road of its own: its curves, biomes, set pieces and railroad crossing hash the edge's key and
    the direction, so a drive along one edge one way is the same every time, until stage 7 maps
    the roads out. Weather, season, traffic and the truck-stop swap still vary per drive. The
    `countrySeconds` setting is removed.
11. Each end of an edge uses its own gate of that city, and a gate serves exactly one edge. The two
    gates face different ways. A city has as many gates as its edges need. When an added city needs
    more edges, existing cities gain gates by hand edit. A freeway city's way in (gate `g0`, where
    the freeway runs out of town) takes one edge, driven only into that city.
12. Every city has at least four edges (five as drafted), and its neighbours span at least three styles. Any city can
    reach any other in four drives or fewer.

### The visit planner

13. The journey seed drives the visit planner, which picks each next city from the current city's
    neighbours and fills in the rest of that visit (requirement 27).
14. The planner keeps these guarantees. The numbers are starting values, to be tuned from the
    simulation in requirement 15.
    1. No two cities in a row share a style.
    2. No city comes back within 8 visits.
    3. A storybook town is never one of the first two cities and never comes within
       `STORYBOOK_GAP` (6) cities of the last one, and about one city in eight is a storybook town.
    4. Over a long day, each real city's visit count stays within 25% of the mean for its style.
    5. The planner never drives back along the edge it arrived by.
15. A test runs the planner over many seeds for long days, fails if any guarantee in requirement 14
    breaks, and reports the visit frequencies it saw.

### Authoring

16. A drafting tool wraps today's city generator and writes the first draft of a city file. A second
    drafting tool writes the first draft of the world graph and assigns gates to its edges. The
    generators leave the scene bundle and live on only in `tools/`.
17. City files and the world file are TypeScript data modules, checked against their types with
    `satisfies`. Once a city file exists, only hand edits change it, and no tool rewrites it.
    Replacing a city means drafting a new file.
18. `make check` validates every city file and the world file. It rejects a city whose streets are
    not strongly connected, whose gates or sites cannot be reached, or whose block labels do not
    match its blocks one to one. It rejects a world graph that breaks requirement 11 or 12.
19. Each city has a layered SVG map, drawn from its plan at 1 SVG unit per metre in world
    coordinates. Each layer is a top-level group, which Inkscape and Illustrator both open as a
    layer. The layers are:
    1. ground and districts
    2. water and shore
    3. streets and pavements
    4. street names
    5. junction controls (signals, stops and roundabouts), with every signal pole and stop sign
    6. lots
    7. buildings
    8. sites (docks, garages, rental lots and stands)
    9. trees and parks
    10. street furniture, by kind
    11. freeway and elevated lines
    12. gates, each labelled with its edge and neighbouring city
    13. pinned dressing
    14. an empty markup layer for notes
20. Each item in a city map carries its plan id as its SVG `id`, so markup can be traced to exact
    streets, lots and buildings. A map is a view of its plan and is never read back into it. Markup
    is a note for whoever edits the city file.
21. The world map shows only the graph. It has one node per city, labelled and coloured by style, and
    one line per country road, labelled with the road's id and length. Node positions are stored in
    the world file, so the map keeps its shape between regenerations.
22. The maps are build output: `make maps` writes every map into `build/long-day-maps/`, in a
    folder for each style, and none is committed. A city's map runs to a few MB, and the 35 to
    about 65 MB, too much to keep in the repo.

### Correctness and cost

23. Normal play is every catalogue city, every edge of the world graph, and every seed's visit order
    and dressing. The "Correct means correct in normal play" rule in `CLAUDE.md` changes to say so.
24. The scene stays within the 100 MB scene limit.
25. Frame rate, chunk cost (`test/chunkcost.ts`) and the time to prepare the next city are no worse
    than today.
26. Every value of `seed`, `timeOfDay`, `weather`, `humorFrequency` and `cityMinutes` still produces
    a correct day.

### Visits

27. A visit holds every parameter that sets up one city of a journey. Its parameters are these:
    1. It names the catalogue city.
    2. It names the road the truck arrives by, which fixes the gate it enters at.
    3. It names the truck the visit starts with, and when the next truck swap comes and to which
       truck.
    4. It sets the season and the weather. The time of day follows the journey's clock, and a
       render pins it with `DEBUG_HOUR`.
    5. Its jobs seed chooses the stops, cargo and loads.
    6. Its dressing seed chooses the traffic, parked cars, other vehicles, vignettes, crowd and
       boats.
    7. Its gag seed chooses the street vignettes. The clowns come when a jam holds the truck, and
       humorous cargo comes with the jobs at the rate `humorFrequency` sets.
    8. Its drive seed chooses the events on the country drive out, such as a train at a crossing
       and the weather along the road.
28. The scene picks the journey seed at random when it starts, unless the `seed` setting fixes it.
    The journey seed chooses the first city's place on the world graph and the first truck, and the
    visit planner derives every visit from the journey seed and the visit's number alone, so
    scrubbing replays the same visits.
29. Every parameter of a visit can be given directly. A test builds the visit its scenario needs,
    such as Grand Central in winter, arriving by gate `g2` in a tractor, and plays it without
    searching seeds for one that happens to produce it. A debug define does the same for a render.
30. A test that checks one scenario builds its visit. A test that checks variety still runs the
    planner over many journey seeds.

## Storage format

A city file stores its plan at three levels of detail.

1. **Structure is always explicit.** Nodes, streets, gates, block properties, the land outline, the
   sea and river, the freeway, junction controls, signal poles, stop signs and street furniture are
   written out in full, so no code change can move them.
2. **Lot detail is explicit or comes from a default rule.** A **default rule** is today's code
   working a value out from a stable hash key stored in the file. A block that lists its lots and
   buildings uses that list. Every other block gets today's lot rules, so a block is made explicit
   only when it is hand-shaped.
3. **Dressing comes from the visit's dressing seed unless pinned.** Level 2 follows the city's own
   keys and is the same on every visit; level 3 follows the visit and changes.

### Conventions

1. Nodes and streets carry integer ids that are never renumbered. A new street takes the next
   unused id, and the loader packs the ids into arrays.
2. Blocks are derived from the streets at load time, as `CityGraph.findBlocks` does today. A block's
   stored properties attach to a label point, `at: [x, z]`, inside it, so moving streets to split
   or merge blocks does not misattach them. Validation fails when a derived block holds no label
   point or more than one.
3. Coordinates are world metres, rounded to 1 cm.
4. A curved street stores `bend`, the distance in metres its middle sits off the straight line
   between its ends. The loader converts it to the heading and curvature `CStreet` uses.
5. Each node and block may carry a `key` for the default rules to hash. It defaults to the item's id.
6. A city names its style and may override any field of the style with a partial object.
7. A `seasons` section holds per-season street closures, pins and vignette sets. It never holds
   layout.
8. Each file carries `format: 1`, and the loader rejects a format it does not know.

### Example city file

```ts
import type { CityFile } from "../plan.ts";
export default {
  format: 1, id: "metro-grand-central", name: "Grand Central", style: "metro",
  styleOverrides: { trees: { greens: [0x3f7a3a, 0x4c8a40] } },
  nodes: [
    { id: 1, x: 9, z: 9, control: "signal" },
    { id: 2, x: 69, z: 9 },                       // the control comes from the default rule
  ],
  streets: [
    { id: 1, a: 1, b: 2, name: "5th Avenue", oneway: true, tags: ["elevated"] },
    { id: 2, a: 2, b: 7, name: "Canal St", bend: 4.5 },
  ],
  gates: [{ id: "n1", street: 40, out: "b" }],     // the world file joins roads to gate ids
  land: [[-720, -720], [700, -720] /* ... */],
  sea: { side: "west", shore: [[-640, -720] /* ... */] },
  freeway: { gate: "e2", curve: { /* as FwCurve */ } },
  blocks: [
    { at: [39, 39], district: "downtown", facility: "parcelHub",
      site: { street: 1, side: "right", at: 12 } },
    { at: [99, 39], district: "residential", close: true,
      lots: [{ street: 2, side: "left", a0: 9, a1: 21, depth: 14,
               building: { kind: "house", floors: 2, facade: "clapboard" } }] },
  ],
  pins: [{ kind: "vignette", id: "busker", at: [41, 12], seasons: ["summer"] }],
  seasons: { winter: { closed: [12, 13] } },
} satisfies CityFile;
```

### The world file

The world file imports every city file, and that import list is the catalogue. It lists each
city's position on the world map. It lists each road with its id, the `{ city, gate }` at either
end, its length in metres, its own hash key, and any set pieces placed explicitly at a distance
along it. It also holds the visit planner's settings from requirement 14.

### Road maps

A **road map** holds one country road as a physical road between two gates, and a drive either
way reads the same map. It holds the road's shape, heights and land, its set pieces, and every
item that stands beside it. It is a TypeScript data module in `src/roads/`, one per world road,
named `road-<id>.ts` and exporting `ROAD_<ID>`. The world file imports each one.

The map uses the road's own coordinates. The distance `s` runs from the end of gate a's street (0)
to the end of gate b's street (the road's `length`, in metres), and the offset `n` is to the right
looking from a to b. The map holds these fields.

1. Its `length`, which is the drive's length: the planner's drive time is the length over its
   pace, and the world file holds no length of its own.
2. Its centre line as a heading every 2 m, and its height and side-hill amount every 2 m. The
   samples run from 40 m before gate a to 40 m past gate b, or past the end of the freeway stretch
   on a freeway city's way in.
3. Its land every 10 m: how much of it is b's (the rest is a's), how much of the storybook's
   creeps in, and how much of it is coast. The coast's sea is on the left looking from a to b.
4. Its set pieces, each as `country.ts` RoadPiece has it, plus the way it faces.
5. Its items: trees, rocks, ponds, wind turbines, pylons, farms, grazing cows, utility poles and
   fence bays, each with its place and what it is.

A set piece's `way` says whose coordinates its fields use and which drivers it faces: 1 for a
driver from a to b, -1 for one from b to a. Signs that only make sense one way come in pairs, one
for each way: the leaving, distance and welcome signs. A weigh station serves only its own way, so
it is open only on a drive that way, and a tractor pulls out of its fields only ahead of a driver
its way. Every other piece is a single object that a driver from the other side sees from behind
or across the road. A ferry's two terminals are alike, so it serves both ways. A rail crossing, a
cattle crossing and a work zone stop or slow the truck from either side, and their warning signs
and a row of billboards stand at both ends of the piece, facing each way.

The land's noise, its colour bands and fields, the ferry water's wave streaks and the broken ends
of utility wires stay hashed from the map's key: they are the land's surface, not items. Weather,
seasons, oncoming cars, the herd crossing, the tractor's run, the train, the turbines' speeds and
whether a weigh station is open belong to the drive, as requirement 27 says, and hash its drive
seed.

A drive from b to a maps its distance `s` to `length - s` and its offset `n` to `-n`. The road's
drawing (`countryworld.ts`) always works in the map's coordinates, so both drives draw the same
road. What moves (the truck, the camera, oncoming cars, the herd, the tractor, the boat) works in
the drive's coordinates. The arrival straight that a seek into a city's slot needs is the last
stretch of the same map.

The drafting tool (`tools/draftroads.ts`) writes each road's map from today's rules, driven from a
to b with both cities' freeways considered, and records the items as the segment builder places
them. Like a city file, a road map is hand-owned once drafted.

## Folder layout

Everything below is under `scenes/long-day/src/`.

```
world.ts                                 the world graph, roads and planner settings
city-metro/
  metro-style.ts                         the metro style, moved out of styles.ts
  metro-city-grand-central.ts            a city file
  metro-grand-central-vignette-busker.ts an asset for this city alone
  metro-vehicle-tram.ts                  an asset shared by every metro city
city-coastal/  city-desert/  city-brick/  city-mainstreet/  city-port/
city-storybook/
  storybook-style.ts                     the storybook style
  storybook-buildings-town.ts            the town's buildings, trees and lamps, once storybook.ts
  storybook-landmark-knitting-works.ts   the knitting works, once works.ts
  storybook-city-wumbleton.ts
```

A city file is named `<style>-city-<slug>`, where the slug is the city's name in lower-case kebab
form: "Higgle-on-the-Wobble" becomes `higgle-on-the-wobble`. An asset shared by a style is named
`<style>-<asset type>-<asset name>`, and an asset for one city alone is named
`<style>-<city slug>-<asset type>-<asset name>`. The asset type is a word such as `vehicle`,
`vignette`, `landmark` or `buildings`. A style's own definition is `<style>-style.ts`. Assets every
style uses, such as `cars.ts` and `boats.ts`, stay where they are. What remains of `styles.ts` is
the shared `CityStyle` type and the list of the seven styles.

## Code changes

1. `citygen.ts`, the outline trim in `outline.ts`, the layout odds and the fallback chain in
   `CityPlan.buildGraph` move from the scene into the drafting tools.
2. `CityPlan` is built from a city file. Its seed-driven getters, such as `district`, `freeway`,
   `plaza` and `facilityAt` in `facilities.ts`, return the file's values or apply the default rule.
3. `buildLots` in `city.ts` decides a block's lots and draws them in one pass. It splits into a step
   that decides lots and a step that draws them, so a block's explicit lot list can replace the
   first step. This is the largest refactor in the change.
4. `CountryRoad` in `country.ts` takes its length and hash key from its world-graph edge in place of
   the journey seed, the city number and `countrySeconds`.
5. The visit planner replaces `journeyStyle` and `isStorybookCity` in `styles.ts`.
6. Per-city gates replace `GATE_SLOTS` and `entryGateOf` in `city.ts`, and `setCityLimits` no longer
   sizes the city.
7. The long-day README's description of the generator moves to the drafting tools' documentation.
8. A `Visit` type in `visits.ts` holds requirement 27's parameters. The journey takes its visits
   from the planner, or one a test gives it, and the code that hashes the city seed or the journey
   seed for jobs, dressing, gags and drives (in `journey.ts`, `traffic.ts`, `vignettes.ts`,
   `clowns.ts` and `country.ts`, among others) hashes the visit's seeds instead.
9. Street furniture, signal poles and stop signs (requirement 5a) are placed today as the chunk
   builder draws (`decor.ts` streetFurniture, `signals.ts` signalPoles and stopSignPosts). Their
   placing splits from their drawing, as `buildLots` does, so a file's list can take the place of
   the placing step. Walks, traffic and the tests read the same list.

## Build order

The change lands in eight stages, and the scene plays a correct day after
every stage.

1. **City files.** The `CityFile` type, its loader, the drafting tool and the 35 drafted cities, with
   each style moved into its folder. The journey takes each city's turn from the catalogue, and the
   city's hash key stands in for the old city seed wherever the seed was used, so every default rule
   gives the drafted city what the generator saw. `cityMinutes` stops sizing cities.
2. **Maps.** The layered city maps and `make maps`.
   The world map, and the gates' labels naming their roads and neighbouring cities, come in stage
   3 with the world graph they show. Until stage 6 gives blocks explicit lots, the lots,
   buildings and trees on a map are where the city's builders put them, and their ids number
   them within their block.
3. **World graph and visit planner.** Roads with fixed lengths, per-edge gates, the planner and
   its simulation test (`test/world.ts`), the world map, and gate labels on the city maps.
   `countrySeconds` is removed. The roads live in `src/world-roads.ts`, drafted by
   `tools/draftworld.ts`, beside the catalogue list in `src/world.ts`.
4. **Visits.** The `Visit` record and its seeds, so dressing varies between visits to one city, and
   tests that once searched for seeds build the visits they need (`Journey`'s `visits` argument,
   and `DEBUG_VISIT` for a render). The seeds' defaults are the values the journey used before,
   so a seed's jobs and drives play out as they did. `swap` still runs on seeds: no spec yet says
   which truck a visit's jobs swap into.
5. **Generator out of the scene.** The freeway (its gate slot, whether the truck comes in on it,
   its exit and its curve) and the sea (its side and its shore's depth every 5 m) become explicit
   fields. `citygen.ts`, the outline's land edges and gate checks (`tools/outlinegen.ts`), the
   freeway's layout rules (`tools/freewaygen.ts`) and the layout methods of `CityPlan`
   (`tools/generatedplan.ts`, a `CityPlan` with no file) move to `tools/`. The scene keeps
   `src/outline.ts` for the sea alone, and decides where to draw outskirts from the town's outer
   street edge. Elevated and cable-car lines need no field: their streets are tagged in the file.
6. **Explicit lots and street furniture.** `buildLots` and the furniture, signal-pole and stop-sign
   placing split from their drawing. Blocks may list their own lots and buildings, and every city
   file lists its furniture, signal poles and stop signs (requirement 5a). The maps already show
   all three, from today's rules, since stage 2.

   As built, a street's `furniture` lists hydrants, bins, benches, mailboxes, newspaper boxes,
   meters, shelters and bike racks, and a junction's `poles` and `stops` list its signal poles and
   stop-sign posts. Streetlights and street trees are still placed by rule as the chunk builder
   draws, so requirement 5a is met for everything but those two. The placing rules still run when a
   file lists its furniture, with their draws discarded, so the random draws after them (lots,
   buildings, trees) stay where they were. A block's `lots` replace the lots the rules pick on the
   kerb-layout path of `buildLots`, and each lot may fix its building's floors and wall colour;
   the building on it is still chosen by rule. A block's `doors` list its facility's front doors,
   at most one a side, where the scene once worked them out by probing its buildings
   (`city.ts` kerbDoors); `test/doors.ts` works them out again and checks the file still agrees
   with its buildings. `test/lots.ts` checks a listed lot, and
   `test/catalogue.ts` checks that every file reads back as it was written.
7. **Mapped country roads.** Each world road gets a map of its own, as a city has: its curves,
   biomes, trees, set pieces (truck stops, rail crossings, ferries, attractions, billboards) and
   roadside are pre-generated and stored for the road, and the scene draws what the map holds in
   place of hashing the road's key. A road's length is its map's, so `metres` goes from the world
   file. Its features are the same whichever way it is driven, and the drafting tool writes each
   road's map from today's rules as its first draft. What varies per drive (weather, season,
   traffic, the truck-stop swap, oncoming cars, cattle, the train) stays with the visit's drive
   seed. The build order's count of six stages becomes seven.

   As built, the 89 maps take 6.8 MB. Three choices were made along the way.
   1. A road's coast is on one side for its whole length. It is on the right looking from a to b
      when a is on the sea and the road meets it at a's way in (g0), where a's shore bends in to
      meet it, unless b's does the same; otherwise it is on the left, as every coast was before.
   2. A truck stop, an attraction, a fruit stand and a gas station keep their one sign, facing the
      way the map was drafted. A driver the other way sees its back.
   3. Under `DEBUG_STYLE` the made-up road between two cities of one style borrows a catalogue
      road's map that turns the same way, so its signs name that road's cities.
8. **Everything on the layout listed.** Every lot, building, site, tree and streetlight is listed
   in its city file, and the scene draws only what the file lists. "City contents" (below) has
   the design.

## City contents

A city file lists everything that stands on its layout, each as a recipe: what kind of thing it
is, where it stands, the choices that make it look as it does, and a seed of its own for the fine
detail. The scene draws each recipe as it is listed and decides nothing for itself, so any item
can be moved, changed or deleted by hand, and a new one added. Geometry that follows from the
layout stays derived from it: road markings, crosswalks and kerbs from the streets, the freeway,
elevated and cable-car structures from the street tags and the freeway curve, and the sea's
surface from the sea data. Editing a street moves those with it.

### What is listed

1. **Buildings**, per block. A building recipe holds its kind (which builder draws it), its
   footprint as a rectangle in a frame (the frame's world origin and heading), its floors, its
   wall and trim colours, its facade tiles, its roof (cap colour, water tank, clutter), its extras
   (awning and colour, neon, fire escape, ghost sign, crown, antenna, billboard) and its seed. The
   seed draws what no field names: a rooftop unit's place, a storybook pod's lean, a window's
   light. About twenty kinds cover today's builders, among them a lot's tower, shop, house and
   shed, a podium tower, a court, a detached house, a row house and a storybook tower, shop row
   and house.
2. **Lots**, per block, as the stage 6 `lots` field has them, now for every block. A building's
   frame is its lot's when it has one.
3. **Sites**, per block: a dock, rental lot, stand, container, garage or the knitting works, with
   the fields `facilities.ts` siteLayout hashes today (its side, its bays and their widths, which
   are active, its look) and its buildings and yard items as recipes. The town's plaza and town
   square are a block's site too.
4. **Trees**, rocks, ponds, sheds, fences, planters and container stacks: block items with a
   place, a size and a colour. A park's, a garden's, an infill's and a close's are all of these.
5. **Streetlights and street trees**, per street, as stage 6 lists its furniture: each a side and
   a distance along it.
6. **The countryside ring's trees and rocks**, per city, with their places.

### How it is built

The drafting tool runs today's builders once with recorders, as stage 6 recorded street
furniture: each builder makes a recipe, records it, and draws it with the recipe's drawer. In the
scene the recipes are read from the file and the same drawers draw them. The placing rules
(lot cutting, the grid builders' splits, infill fitting, the tree and footprint checks) then live
only in the drafting tools, as the street generator does since stage 5.

Each drawer draws from its recipe's own seed. Today one random stream per tile runs through the
streets, the blocks and the countryside in order, so moving or deleting one item changes every
item drawn after it; with a seed per recipe, an edit changes only the item edited. The drafting
redraws every city once with the new seeds, so every building's fine detail changes once.

Doors stay as stage 6 lists them. A building edited by hand needs its door edited to match, and
`test/doors.ts` reports a door left on no wall.

### Cost and order of work

Every builder in `city.ts`, `decor.ts` and the storybook files splits into its placing and its
drawing, which is the largest refactor in the change. A city file grows by about a few hundred
kilobytes, by an estimate from Midtown's lots and trees: 1,500 buildings at about 150 bytes and
5,000 trees and lights at about 30. The work lands in steps, each with the scene playing correctly:

1. Streetlights, street trees, and the trees, rocks and other items in parks, gardens, infill and
   the countryside ring.
2. Lots for every block, and the buildings on them (`buildLots` and `storyLot`).
3. The square-grid builders: downtown, commercial, residential, row houses and industrial.
4. Closes and infill.
5. Sites, the plaza and the town square.
6. The placing rules out of the scene, into the drafting tools.

### As built

Every city file lists its contents, and `test/contents.ts` checks that a city drawn from its list is
the city its rules draw, chunk by chunk, triangle for triangle (to 2 cm), for a city of each style.
Five choices were made along the way.

1. A recipe's seed is a hash of the recipe itself unless it carries its own (`s`), so nothing stores
   one, and an edit changes only the item edited. The builders no longer draw from the tile's random
   stream for an item's detail.
2. A city's contents live in a file of their own beside its city file,
   `<style>-<city>-contents-recipes.ts`, each recipe a row: its kind's fields in a fixed order
   (`contents.ts` FIELDS). The scene does not import those files. `tools/pack.ts` packs them into
   `src/contents-packed.ts` (build output) before every build, compressed by `src/pack.ts` from
   28.6 MB to 9.5 MB, and a city's contents are unpacked when the city is planned. As objects in
   the city files every city's recipes stayed in memory, 706 MB of heap after the start; packed, the
   scene is 36 MB, it holds 333 MB after the start (237 MB before this stage) and starts in 2.5 s.
   The contents files are left out of the type checker, which they took to 4.5 GB; the packer and
   `test/catalogue.ts` read every one.
3. A street's and the countryside's items name the tile that draws them, since a street's part can
   draw one just past its tile's edge.
4. Some recipes are coarse: a dock, rental lot, stand, garage, town square and park are each one
   recipe whose fields are their layout, and an industrial grid block's warehouse and yard is one.
   Their trees are recipes of their own.
5. The placing rules have not moved out of `city.ts`. A city whose file lists its contents never
   runs them; the drafting tools run them through the same builders.

The flattener (`scripts/flatten.ts`) joins every module into one scope and accepts no default
imports, so a city file exports a uniquely named constant, such as `CITY_METRO_GRAND_CENTRAL`, in
place of the `export default` the example under "Example city file" shows.

## Rejected: baked geometry

Shipping each city's finished meshes would remove the chunk builder's work, but the data is far too
large. `test/chunkcost.ts` measures a city chunk at 4,900 to 7,900 triangles on average, depending
on style. A city of 576 chunks therefore holds roughly 3 to 4.5 million triangles, which at an
estimated 50 to 100 bytes per triangle is 150 to 450 MB per city before compression. Baked meshes
would also fix the season, weather and dressing that are meant to vary per visit.
