# Long Day's cities

Long Day plays a fixed catalogue of 35 cities, joined by a fixed world graph of country roads.
Every city and every road is data in the repo, written once by a drafting tool and edited by hand
from then on, and the scene draws what that data says. A journey's seed chooses only the order in
which the truck visits the cities and the dressing it sees in each: the traffic, the crowd, the
vignettes, the weather.

Three ideas carry the rest of this document. A city is two files, its **city file** (the layout)
and its **contents file** (everything that stands on the layout), described under "The city file"
and "City contents". The cities are joined by **roads**, each with a map of its own, described
under "The world graph" and "Road maps". And each city of a journey is a **visit**, which the
**visit planner** chooses, described under "Visits".

## Parts

These are the parts, and the rest of this document uses these names for them.

1. A **city file** holds one city's layout: its streets, junctions, gates and blocks, with the
   street furniture, signal poles, stop signs and front doors placed on them.
2. A **contents file** lists everything else that stands on a city's layout as **recipes**: its
   lots, buildings, sites, trees, streetlights and the countryside ring around the town.
3. The **catalogue** is the list of cities, by id, in the **world file**, `src/world.ts`.
4. The **world graph** joins the cities with country roads. Its roads are listed in
   `src/world-roads.ts`.
5. A **road map** holds one country road: its shape, its land, its set pieces and everything
   beside it. The road maps live in `src/roads/`.
6. A **visit** is everything that sets up one city of a journey beyond its files: which city, the
   road the truck arrives by, and the seeds for what happens there.
7. The **visit planner** (`src/visits.ts`) chooses each visit from the journey seed.
8. The **drafting tools** in `tools/` run the old generators offline to write a first draft of a
   city, the world graph or a road map. The generators are not part of the scene.
9. The **maps** are layered SVG views of each city and each road, for reading and marking up.

## Why the cities are fixed

The cities are fixed because variety in street layout is barely noticeable on the board, while
variety in building style, vignettes, vehicles and colours is. A generator that must be correct
for every seed spends most of its complexity on layouts nobody tells apart, and fixing one city's
defect means changing code every other city shares. A finite catalogue can be tested city by city
and fixed by hand, one file at a time.

Three alternatives lost.

1. Curating known-good seeds kept the generator in the scene, and any change to the generator
   moved every curated city.
2. Baking each city's meshes is far too large. `test/chunkcost.ts` measures a city chunk at 4,900
   to 7,900 triangles on average, so a city of 576 chunks holds 3 to 4.5 million triangles, which
   at an estimated 50 to 100 bytes a triangle is 150 to 450 MB per city before compression. Baked
   meshes would also freeze the season, weather and dressing that change from visit to visit.
3. Listing a city's contents as objects in its city file held every city's recipes in memory at
   once (706 MB of heap after the start). The cities are packed instead, as "How the scene
   carries the cities" describes.

## The catalogue

The catalogue holds 35 cities: five for each real style (coastal, metro, desert, brick,
mainstreet and port), four storybook towns, and Ravensgate, the one Victorian town, which took
the fifth storybook town's place on its roads. The Victorian style is a real style to the visit
planner, so Ravensgate comes up as often as any other real city. A city's id is `<style>-<slug>`, where the slug is
its name in lower-case kebab form, so "Higgle-on-the-Wobble" is `storybook-higgle-on-the-wobble`.
A city is in the catalogue once its folder is in `src/city-<style>/` and `src/world.ts` lists its id.
The visit planner picks from the list by position, so a new city goes at the end of it.

A city's file decides whether it has a freeway, and each style keeps a mix of cities with and
without one. A city's size is whatever its file lays out. The `cityMinutes` setting changes only
the time the truck spends in a city, through the number of jobs and the length of its route.

## Files and folders

Each style has a folder, `src/city-<style>/`, and each of its cities has a folder of its own
inside it. Every file's name starts with what it belongs to: the city's slug for a city's files,
the style's id for the style's. A city's files therefore sort together in its folder, and the
style's files are the plain files beside the cities' folders.

```
src/
  world.ts                               the catalogue
  world-roads.ts                         the world graph's roads and the world map's layout
  roads/road-r12.ts                      a road map
  city-metro/
    metro-style.ts                       the metro style
    grand-central/
      grand-central.ts                   a city file
      grand-central-contents.ts          its contents file
  city-storybook/
    storybook-style.ts                   the storybook style
    storybook-buildings-town.ts          the town's buildings, trees and lamps
    storybook-landmark-knitting-works.ts the knitting works
    wumbleton/
      wumbleton.ts
      wumbleton-contents.ts
```

A city file is `<slug>.ts` and its contents file `<slug>-contents.ts`. An asset for one city alone
is `<slug>-<asset type>-<asset name>.ts` in the city's folder, and an asset a style shares is
`<style>-<asset type>-<asset name>.ts` in the style's folder. The asset type is a word such as
`vehicle`, `vignette`, `landmark` or `buildings`. A style's own definition is `<style>-style.ts`,
and `src/styles.ts` holds the shared `CityStyle` type and the list of the eight styles. Assets every
style uses, such as `cars.ts` and `boats.ts`, sit in `src/` itself.

Every file exports a uniquely named constant, such as `CITY_METRO_GRAND_CENTRAL` or
`CONTENTS_METRO_GRAND_CENTRAL`, because the flattener (`scripts/flatten.ts`) joins every module
into one scope and accepts no default imports.

## The city file

A city file holds a city's layout explicitly, so no code change can move it. Its type is
`CityFile` in `src/cityfile.ts`, which also reads it into the city's street graph.

```ts
export const CITY_METRO_GRAND_CENTRAL: CityFile = {
  format: 1, id: "metro-grand-central", name: "Grand Central", style: "metro", key: 1071104322,
  layout: "grid", outline: { scale: 1 },
  sea: null,
  freeway: { gate: { ix: 12, iz: 7, dir: 0 }, merge: false },
  nodes: [
    { id: 0, x: -711, z: -711, k: [-12, -12], control: "none" },
    { id: 1, x: -651, z: -711, k: [-11, -12], poles: [[0, -641.5, -703.4, 1.5708, 9.5], /* ... */] },
  ],
  streets: [
    { id: 0, a: 0, b: 1, name: "37th St", furniture: [["trash", "r", 17.59], ["hydrant", "r", 27.02]] },
  ],
  gates: [/* the way in first, then the ways out */],
  blocks: [
    { at: [-681, -681], k: [-12, -12], district: "residential", facility: "residence",
      doors: [{ side: 0, a: 21.62, n: 0.6, frame: 15921128, panel: 5981750, half: 0.55, h: 2.52 }] },
  ],
};
```

The file holds these parts.

1. **Nodes** are the junctions, each with its place, its control (signals unless it says `stop` or
   `none`), its signal poles, its stop signs' posts and the moves through it a tractor-trailer
   never takes (`noTractor`). Each move is a street in and a street out, as "Tractor-trailers'
   turns" describes.
2. **Streets** join two nodes. A street may be named, curved, one-way, part of a roundabout's
   ring, tagged as carrying an elevated line, a cable car or the freeway, or lie outside the town.
   Its `furniture` lists its hydrants, bins, benches, mailboxes, newspaper boxes, meters, shelters
   and bike racks, each with its side and its distance along the street.
3. **Gates** are where country roads meet the town: the way in first, then the ways out, each the
   outer end of a street. A gate the sea closed is `null`.
4. **Blocks** carry their district, their facility, whether they are water or a park, and their
   facility's front doors, at most one a side. A hand-shaped block may list its own `lots`.
5. The town's **sea**, if it has one, gives its side and its shore's depth every 5 m, and its
   **freeway**, if it has one, gives the gate it runs out along, whether the truck comes in on it,
   the kind of exit and, in an organic town, its curve.

The file follows these conventions.

1. Nodes and streets carry integer ids that are never renumbered. A new street takes the next
   unused id.
2. Blocks are found from the streets when the file is read (`CityGraph.findBlocks`). A block's
   properties attach to a label point, `at`, inside it, so moving streets does not misattach them.
   Reading fails when a block holds no label point or more than one.
3. Coordinates are world metres, rounded to 1 cm.
4. A curved street stores `bend`: how far its middle lies to the left of the line from its first
   node to its second, driving that way, in metres.
5. Each node and block carries `k`, its hash key, and the city carries `key`, the seed it was
   drafted from. The key still seeds what the scene derives from the layout, such as the signals'
   timing and the colours of the fields round the town.
6. Each file carries `format: 1`.

Some geometry follows from the layout and is never listed: road markings, crosswalks and kerbs
from the streets, the freeway's, elevated lines' and cable cars' structures from the street tags
and the freeway's curve, and the sea's surface from the sea data. Editing a street moves them with
it.

## City contents

A contents file lists everything that stands on a city's layout as recipes, and the scene draws
each recipe as listed and decides nothing for itself. Any item can be moved, changed or deleted
by hand, and a new one added.

A **recipe** is an item's kind, its frame, its kind's fields and, optionally, a seed of its own.
The kind names the drawer that draws it (`DRAW` in `src/contents.ts`). The frame is the world
origin and heading the item is drawn in; an item drawn in its tile's own frame leaves it out. The
fields are the choices that make the item look as it does, such as a building's footprint, floors,
wall colour, facade tiles and awning. The seed draws the fine detail no field names, such as a
rooftop unit's place or a window's light. A recipe's seed is a hash of the recipe itself unless it
carries its own (`s`), so an edit to one recipe changes no other recipe's detail.

The contents are listed under what owns them.

1. A **block** owns its lots, buildings, sites, paving, trees, sheds, fences, planters and
   container stacks. A site (a dock, rental lot, stand, garage, the plaza, the town square or the
   knitting works) is one coarse recipe whose fields are its layout, with its trees as recipes of
   their own. An industrial block's warehouse and yard are one recipe too.
2. A **street** owns its streetlights and street trees. Each of its items also names the tile that
   draws it, since a street's part can draw one just past its tile's edge.
3. The **outskirts** own the countryside ring's trees and rocks.

A contents file stores each recipe as a row: its kind, its frame or 0, its tile or 0, then its
kind's fields in the order `FIELDS` in `src/contents.ts` gives them, with a trailing `{ s }` when it
carries a seed. As objects with their field names, the recipes made the files twice the size and
the type checker ran out of memory.

```ts
export const CONTENTS_METRO_GRAND_CENTRAL: CityFileContents = {
  blocks: {
    0: [
      ["asphalt", [-720, -720, 0], 0],
      ["rowHouse", [-720, -720, 0], 0, 0, 9.4, 14.94, 0.6, 10709580, 3, 11],
    ],
  },
  streets: { /* by street id */ },
  outskirts: [ /* ... */ ],
};
```

The scene carries the contents packed, as "How the scene carries the cities" describes. The
contents files are left out of the type checker, which they took to 4.5 GB; the packer and
`test/catalogue.ts` read every one.

A building edited by hand may need its block's doors edited to match, and `test/doors.ts` reports
a door left on no wall. The rules that once placed the contents (lot cutting, the grid builders'
splits, infill fitting) still sit in `src/city.ts`, behind the same builders that make the
recipes. A city whose file lists its contents never runs them; the drafting tools do, through
`place()` in `src/contents.ts`, which records each recipe as it draws it.

## How the scene carries the cities

The scene carries every city's layout and contents and every road's map packed in one binary
asset, the **world asset**, and unpacks a city's only while it has the city planned and a road's
only while it has a drive along it. Every other city is a small **head**: its city file without
its nodes, streets and blocks (`CityHead` in `src/cityfile.ts`), which is all the visit planner
and the country roads read of it. Every other road is its entry in `src/world-roads.ts` and its
head, its length and its heading at gate b (`RoadHead` in `src/roadmap.ts`), which is all a
city's time and the planner read of it.

The world asset keeps the packed data out of the scene's source. tickr takes an editor draft of at
most 6 MB, and with the data in the source it was 20.8 MB; with the data in the asset it is
2.4 MB.

The scene never imports the city files, the contents files or the road maps. Before every build of
the scene, a test or a tool, `tools/pack.ts` reads every city's folder and every road map and
writes two files, both build output and not committed.

1. `src/world-packed.ts` holds each city's and road's head, the world asset's name, and where each
   packed item lies in it (`WORLD_INDEX`).
2. `assets-packed/<name>` is the world asset: each city's layout and contents and each road's map
   as JSON compressed by `src/pack.ts`, one after another, 49.9 MB packed to 13.2 MB. Its name is
   `world_` and a hash of its bytes, so a new world asset is added beside an old one and never
   replaces one that a published version reads.

The Makefile copies the world asset in among each build's assets and lists it in the build's
`scene.json` (`scripts/scenejson.ts`). `main.ts` hands its bytes to `src/worlddata.ts` when the
scene starts; a test or a tool, run in Node without assets, reads the file the packer wrote.

1. `fileOf` in `src/city.ts` unpacks a city's layout when its plan builds the city's graph, and
   the plan unpacks its contents at the same time. The journey keeps the plans of the last three
   cities, so the current city, the next and one before it are unpacked at most.
2. `roadMapOf` in `src/roadmap.ts` unpacks a road's map when the journey sets up a drive along it,
   and the drive (`CountryRoad` in `src/country.ts`) holds it as long as it lives.
3. Nothing keeps an unpacked layout or map on its head, since a long day would then come to hold
   every city's and every road's.

To put a build in the editor or publish it, upload its world asset first (`asset_add` under its
name), then the source. Adding an asset changes the scene's draft only: the published version keeps
the assets it was published with. An old world asset can be deleted from the draft once its source
no longer names it.

Measured by a 60 s render of the default build (2026-11-25), the scene holds 36.3 MB of heap after
the start, peaks at 598 MB resident and starts in 2.6 s. With everything packed into the source it
held 136.0 MB and peaked at 833 MB; before the layouts and road maps were packed, with only the
contents packed, it held 334.8 MB and peaked at 1716 MB.

## What varies between visits

A city's layout and contents are the same on every visit, in every season. What changes is
chosen by the visit's seeds ("Visits" lists them): the traffic, parked cars, other vehicles,
vignettes, crowd and boats, and the jobs. Season and weather vary as the visit sets them, and the
time of day follows the board's clock unless the visit's spec pins it.

## The world graph

The world graph is a fixed, connected graph whose nodes are the catalogue's cities and whose edges
are country roads. `src/world-roads.ts` lists each road with its id, the city and gate at either
end, its hash key and whether it is one way, and it gives each city's place on the world map. Each
road's map is its own file, `src/roads/road-<id>.ts` ("Road maps"). It changes only
when cities are added or removed.

The graph keeps these properties, which `test/world.ts` checks.

1. Every road joins two cities of different styles.
2. Each end of a road uses its own gate of that city, and a gate serves exactly one road. The two
   gates face different ways.
3. A freeway city's way in, gate `g0` where the freeway runs out of town, takes one road, driven
   only into that city.
4. Every city has at least four roads (five as drafted), to cities of at least three styles.
5. Any city can reach any other in four drives or fewer.

A road's length is its map's, between about 1,100 and 5,400 m as drafted. How long a drive takes
follows from the length, the truck's speed and its stops on the way, and the next city starts when
the truck arrives. A city's time is planned at an average 18 m/s (`DRIVE_PACE` in
`src/journey.ts`). When a city gains a road, it gains a gate by hand edit.

## Road maps

A **road map** holds one country road as a physical road between two gates, and a drive either
way reads the same map. It holds the road's shape, heights and land, its set pieces, and every
item that stands beside it. It is a TypeScript data module in `src/roads/`, one per world road,
named `road-<id>.ts` and exporting `ROAD_<ID>`. The 89 maps take 6.8 MB, and the scene carries
them packed ("How the scene carries the cities").

The map uses the road's own coordinates. The distance `s` runs from the end of gate a's street (0)
to the end of gate b's street (the road's `length`, in metres), and the offset `n` is to the right
looking from a to b. The map holds these fields.

1. Its `length`, which is the drive's length.
2. Its centre line as a heading every 2 m, and its height and side-hill amount every 2 m. The
   samples run from 40 m before gate a to 40 m past gate b, or past the end of the freeway stretch
   on a freeway city's way in.
3. Its land every 10 m: how much of it is b's (the rest is a's), how much of the storybook's
   creeps in, how much of a Victorian city's has (`period`, which turns the trucks into carriages
   over the last 900 m before one), and how much of it is coast.
4. Its set pieces, each as `RoadPiece` in `src/country.ts` has it, plus the way it faces.
5. Its items: trees, rocks, ponds, wind turbines, pylons, farms, grazing cows, utility poles and
   fence bays, each with its place and what it is.

A drive from b to a maps its distance `s` to `length - s` and its offset `n` to `-n`. The road's
drawing (`src/countryworld.ts`) always works in the map's coordinates, so both drives draw the
same road. What moves (the truck, the camera, oncoming cars, the herd, the tractor, the boat)
works in the drive's coordinates, through `CountryRoad` in `src/country.ts`. The arrival straight
that a seek into a city needs is the last stretch of the same map.

A set piece's `way` says whose coordinates its fields use and which drivers it faces: 1 for a
driver from a to b, -1 for one from b to a.

1. Signs that only make sense one way come in pairs, one for each way: the leaving, distance and
   welcome signs.
2. A weigh station serves only its own way, so it is open only on a drive that way, and a tractor
   pulls out of its fields only ahead of a driver its way.
3. A truck stop, an attraction, a fruit stand and a gas station keep their one sign, facing the
   way the map was drafted. A driver the other way sees its back.
4. A ferry's two terminals are alike, so it serves both ways. A rail crossing, a cattle crossing
   and a work zone stop or slow the truck from either side, and their warning signs and a row of
   billboards stand at both ends of the piece, facing each way.

A road's coast is on one side for its whole length. It is on the right looking from a to b when a
is on the sea and the road meets it at a's way in (`g0`), where a's shore bends in to meet it,
unless b's does the same; otherwise it is on the left.

The land's noise, its colour bands and fields, the ferry water's wave streaks and the broken ends
of utility wires stay hashed from the map's key, because they are the land's surface. Weather,
season, oncoming cars, the herd crossing, the tractor's run, the train, the turbines' speeds and
whether a weigh station is open belong to the drive and hash the visit's drive seed. Under
`DEBUG_STYLE`, the made-up road between two cities of one style borrows a catalogue road's map
that turns the same way, so its signs name that road's cities.

## Visits

A visit holds every parameter that sets up one city of a journey (`Visit` in `src/visits.ts`).

1. Its **city** is a catalogue city.
2. Its **arrival** is the road the truck arrives by and the way it drives it, which fixes the gate
   it enters at.
3. Its **jobs seed** chooses the stops, cargo and loads.
4. Its **dressing seed** chooses the traffic, parked cars, other vehicles, vignettes, crowd and
   boats. It hashes the city's key, the visit's number and the journey seed, so two visits to one
   city differ.
5. Its **gag seed** chooses the street vignettes. The clowns come when a jam holds the truck, and
   humorous cargo comes with the jobs at the rate `humorFrequency` sets.
6. Its **drive seed** chooses the events on the country drive out, such as a train at a crossing
   and the weather along the road.

The scene picks the journey seed at random when it starts, unless the `seed` setting fixes it. The
planner derives every visit from the journey seed and the visit's number alone, so scrubbing
replays the same visits.

Any visit can be set up exactly by a **visit spec** (`VisitSpec` in `src/visits.ts`), and one that
gives everything plays the same under any journey seed and at any place in a journey. A test builds
the visit its scenario needs through `Journey`'s `visits` argument, and a render does the same
through `DEBUG_VISIT` or `DEBUG_SCENARIO`, so neither searches seeds for one that happens to
produce it. A test of variety still runs the planner over many journey seeds, and turns what it
finds into a spec by capturing it.

A spec may give each of these, and the journey draws whatever it leaves out:

1. The city, the road it arrives by, and the truck it starts in.
2. The season, the weather, and whether snow lies on the ground.
3. The **freight** it arrives with, or `"none"`. The visit before it picks this up last.
4. The hour of day it arrives at. The board's clock sets the hour otherwise.
5. Its seeds: jobs, dressing, gags and drive.
6. Its **stops**, as batches. The journey plans stops a batch at a time whenever its queue runs
   dry (`planStops` in `src/journey.ts`), and a spec's batches are taken in turn before any are
   drawn. Each stop names its site by name, or by block as `"bx,bz"` where a name is shared, and
   the journey checks it against the city: a pickup's site must be one its cargo comes from.
7. Its **index** and **clock**, which make the spec independent of where it is played. The job
   draws are keyed by the jobs seed and the index, which is the visit's own number unless given.
   The lights, the street life and the crew's idle motion run on the visit's clock, which starts
   from the journey time the visit began unless given. Both defaults reproduce a seeded journey
   exactly.

`Journey.captureSpecs` writes out the spec of the visit being played, with the stops drawn so far,
together with the next visit's city, road and freight, which set this visit's way out and last
pickup. `test/visitspec.ts` plays a seeded visit with its street life and crew, captures it, plays
the capture as the first visit of a journey with another seed, and requires every step to match.

**Scenarios** (`src/scenarios.ts`) name a spec and the stop to watch. `test/scenarios.ts` plays
each under two journey seeds to that stop, requires the two to agree with each other and with the
stops written, and checks a team lift's load through the doorway. It also lists a city's sites for
writing one (`ARGS="--sites <city id>"`). `Journey.stopTime` finds when a stop's dwell begins,
which a render uses to start just before it (`DEBUG_STOP`, or a scenario's stop).

## The visit planner

The visit planner picks each next city from the current city's roads, as a pure function of the
journey seed and the visit's number. The first city is any real city, entered by one of its roads.
From each city the planner takes a road other than the one it came in by, to a city of another
style, and among those it prefers, in turn:

1. a storybook town when one is due, and no storybook town otherwise;
2. a city not among the last `RECENT` (8) visited, if there is one;
3. the city whose onward roads lead to the most cities not visited lately, looking four visits
   on, then the one visited fewest times so far, then the one visited longest ago.

A storybook town is never one of the first two cities and never comes within `STORYBOOK_GAP` (6)
cities of the last one. Past that it comes due with `STORYBOOK_ODDS` at each city, and once due it
stays due until the journey reaches one. Both settings are in `src/styles.ts`.

`test/world.ts` runs the planner over many long journeys and fails if a visit breaks these rules:
two cities in a row share a style, a city comes back within `RECENT` visits, the truck drives back
along the road it came in by, the storybook towns break their gap or fall outside one city in ten
to one in seven, a real city's visits stray more than 25% from its style's mean, or two visits to
one city share their dressing. It prints the frequencies it saw.

## Authoring

A city, the world graph and a road map are each drafted once by a tool and owned by hand from then
on: no tool rewrites a file that exists. Replacing a city means drafting a new one.

1. `make draft SCENE=long-day ARGS="<style> [candidates]"` runs `tools/draftcities.ts`. It
   generates candidate cities of one style with the old generator (`tools/generatedplan.ts`,
   `tools/citygen.ts`, `tools/outlinegen.ts`, `tools/freewaygen.ts`), keeps those
   `cityProblems` in `tools/cityfiles.ts` finds fit for play, and writes the five that differ most
   as new city folders, each with its city file and contents file. It names them from the style's
   list of names in its style file. Once they are in `src/world.ts`, `make tractorturns` (step 4)
   writes their tractor bans.
2. `make draftworld SCENE=long-day` runs `tools/draftworld.ts`, which drafts the world graph's
   roads and assigns gates to them.
3. `make draftroads SCENE=long-day` runs `tools/draftroads.ts`, which drafts a map for every road
   that has none from the generator's rules (`tools/roadgen.ts`).
4. `make tractorturns SCENE=long-day [ARGS="<city id> ..."]` runs `tools/tractorturns.ts`, which
   writes each city's `noTractor` lists afresh and changes nothing else in its file. Run it after a
   hand edit that moves a junction, a signal pole, a stop sign or a piece of street furniture.

`test/tractorturns.ts` checks that a city of each style lists the moves the sweep bans, that a
tractor can still get in and out by every gate, and that a tractor driven through two towns keeps
to its moves and clear of every pole.

`test/catalogue.ts` checks that every catalogue city loads, is fit for normal play (its streets let
the truck and traffic get from every node to every other, and every site's kerb is drivable),
reads back as written with its contents, and has an id matching its style and name.
`test/contents.ts` checks that a city drawn from its listed recipes is the city the rules draw,
chunk by chunk and triangle for triangle (to 2 cm), for a city of each style. `test/roads.ts`
checks every road map, and `test/world.ts` the world graph and the planner.

## Tractor-trailers' turns

A tractor-trailer never takes a move through a junction that would drag its trailer across a
corner. Its trailer's axles are 10 m behind its kingpin (`KINGPIN_TO_AXLES` in `src/hitch.ts`), and
on a turn they cut inside the path the tractor drives. Round a grid city's square corners, its
right turns swung wide (`src/route.ts`), they clear every corner. In organic and warped towns they
run over a corner's sidewalk on many sharp bends (which the route counts as going straight on) and
on some odd-angled rights, and a tractor goes round those by other ways.

`tools/tractorsweep.ts` decides which moves are banned. It drives each move on the path a tractor's
route gives it, in from just past the junction before, its trailer swung as `hitchStep` in
`src/journey.ts` swings it, and bans the move if the rig comes more than 0.3 m into a block or
passes through anything on the pavement near the junction. The city file lists the banned moves
(`noTractor`), so the scene does no sweeping. `planRoute` keeps a tractor's routes off them, and a
tractor's jobs go only to blocks it can drive to and away from (`tractorReach` in
`src/citygraph.ts`); `tools/tractorturns.ts` reports what each city leaves it.

The trailer is 10 m from kingpin to axles because at that length the grid cities need no bans at
all and a tractor still reaches 99.8% of the catalogue's street directions, and 98.8% in the city
that loses most. With its 13.2 m box the rig is 18.2 m overall, still the longest vehicle in town. The 26 ft box truck is 11.35 m (`truckExtents` in
`src/truck.ts`). The trailer was 13 m from kingpin to axles, a 53 ft trailer, and two things made
that length unworkable. The sweep banned 1,119 to 2,063 right turns in every city, nearly all of
them. Even then, a move clear on its own could hit a pole as part of a route, because a turn just
before or after it changed its path, and sweeping each move in those contexts took over 20 minutes
for an organic town.

## Maps

`make maps SCENE=long-day` draws each city's and each road's layered SVG map into
`build/long-day-maps/`, with `ARGS="metro-midtown r40"` for some. A map is a view of its data,
drawn at 1 SVG unit per metre in world coordinates, and nothing reads it back. Its markup layer is
for notes to whoever edits the file. The maps are build output: a city's runs to a few MB, too
much to commit.

A city's map has these layers, each a top-level group that Inkscape and Illustrator open as a
layer: ground and districts, water and shore, streets and pavements, street names, junction
controls (with every signal pole and stop sign), lots, buildings, sites, doors, trees and parks,
street furniture, freeway and elevated lines, gates (each labelled with its road and neighbouring
city), pinned dressing (empty, since no city pins any) and markup. Each item carries its id in the
city's data as its SVG `id`, so markup can be traced to exact streets, lots and buildings.

A road's map has layers for its land, the road, set pieces, signs, trees, other items, the lines of
poles, pylons, turbines and fences, and markup. The world map shows only the graph: one node per
city, labelled and coloured by style at its place in `src/world-roads.ts`, and one line per road,
labelled with its id and length.
