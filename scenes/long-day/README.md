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
