# Long Day

A delivery truck's working day, rendered in 3D (three.js): city legs, country runs, loading docks,
traffic and weather. Imported from the v135 source export.

```bash
make long-day           # -> build/long-day/
make check-long-day
```

## Source

`src/main.ts` is the entry; the other modules in `src/` are pulled in through its imports.
`src/grid.ts` and `src/facadetiles.ts` hold constants that other modules use while loading, so
they import nothing (most of the city, journey and rendering modules import each other in a
cycle, which is fine for code inside functions but not for top-level initializers).

`src/debug.ts` holds build-time debug constants (`DEBUG_SKIP_MINUTES`, `DEBUG_STYLE`,
`DEBUG_VIEW`, `DEBUG_HOUR`, `DEBUG_CLIMATE`, `DEBUG_CARGO`, `DEBUG_MEMLOG`, `DEBUG_SCRUBTEST`).
Shipping builds use its defaults; a test build overrides them, since the board only passes env
keys that are in the scene's schema:

```bash
make test SCENE=long-day DEFINE="DEBUG_SKIP_MINUTES=40 DEBUG_STYLE=metro DEBUG_HOUR=18"
```

## Dev entries

Each is built from its own imports. `make dev SCENE=long-day` lists them.

| entry | kind | what it does | example `ARGS` |
| --- | --- | --- | --- |
| `jtnode` | Node | fast-forwards the journey and checks invariants | `ARGS="70 '{\"seed\":2}'"` |
| `lifenode` | Node | street-life cost of replaying a city | `ARGS=25` |
| `trafdbg` | Node | cars that got stuck in traffic, per city | `ARGS=30` |
| `spread` | Node | per city, the truck's block extent and when it left | `ARGS=1,2,3` |
| `doorsdump` | Node | kerb door positions for seeds 1-3 | |
| `dbg1` | Node | one-off probe of cargo source and drop search | |
| `garage` | scene | vehicles on a turntable, for look development | builds `build/long-day-garage/` |

For example `make dev SCENE=long-day ENTRY=jtnode ARGS=30 DEFINE=DEBUG_CARGO=kegs`.

`dev/style-sheet.sh <skip-min> <seconds> <every-ms> [seed] [view]` renders every city style at the
same journey moment into `build/long-day-styles/<view>/<style>/`; it needs the tickr-scene toolkit.
