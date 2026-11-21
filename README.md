# tickr-scenes

Sources for my non-trivial [tickr](https://tickr.baton.io) scenes, one folder per scene.

## Setup

Needs Node 22.18 or later and GNU Make. `make` installs the npm dev dependencies (TypeScript,
esbuild, three.js and its types) on first use and whenever `package-lock.json` changes.

The tickr-scene toolkit (`check`, `render`, `thumbnail`, `pull`, `upload`) is separate. It lives
in `.tickr-scene/` in this project (git-ignored) with the Node it runs on (26.7.0, the board's).
Install or update it with the steps the tickr workspace's `toolkit_get` gives, putting
`<project>/.tickr-scene` wherever they say `$HOME/.tickr-scene`; never install it through
`package.json`. The Makefile runs it on its own Node; to run it by hand:

```bash
export PATH="$PWD/.tickr-scene/node_modules/.bin:$PWD/.tickr-scene/node/bin:$PATH"
```

`make check` skips the toolkit's own check when it isn't installed.

## Commands

```bash
make                      # build every scene
make long-day             # build one scene
make check                # type-check, load-test and test every scene (+ tickr-scene check)
make check-long-day       # the same, one scene
make test                 # just run the tests; make test-long-day for one scene
make render-long-day      # build, then render with tickr-scene
make debug SCENE=long-day DEFINE="DEBUG_STYLE=metro DEBUG_HOUR=18"  # -> build/long-day-debug/
make run SCENE=long-day TEST=journey ARGS=30           # one test, with arguments and its output
make tool SCENE=long-day TOOL=showroom SECS=17         # render a test scene from scenes/<scene>/tools/
make clean                # remove build/
make distclean            # also remove node_modules/
```

`DEFINE` overrides the value of a top-level `const NAME = ...;` in the build, for debugging; it
works with `debug`, `run` and `tool`. `ARGS` is split by the shell, so quote JSON for it:
`ARGS="70 '{\"seed\":2}'"`.

## Build output

Everything built goes under `build/`, which is git-ignored and safe to delete (`make clean`):

| path | what |
| --- | --- |
| `build/<scene>/` | the scene: `scene.ts`, `scene.json`, `assets/` (named without extensions, which the toolkit needs) |
| `build/<scene>/dist/` | what tickr-scene writes there: render frames, bundle, thumbnail |
| `build/<scene>/load.mjs` | the Node bundle `make check` loads |
| `build/<scene>-debug/` | `make debug` |
| `build/<scene>-<test>/` | a test: its `scene.ts`, the `<test>.mjs` bundle, and `output.txt` and its exit code (`status`) from `make check` |
| `build/<scene>-toolkit-check.txt` | what `tickr-scene check` said in `make check` |
| `build/<scene>-scrub<n>/` | scrub case n: its build, the render's `log.txt`, and `result.txt` |

`build/<scene>/` is a plain tickr scene directory, so every `tickr-scene` command runs on it.

## Layout

```
scenes/<scene>/
  scene.json        env schema, secret keys, asset list (as `tickr-scene pull` writes it)
  assets/           one file per asset: <scene.json name>.<ext>
  src/              the scene's ES modules; src/main.ts is the entry
  scene.ts          ...or a single-file scene instead of src/
  test/             tests: Node programs that exit non-zero on failure, run by `make check`
  tsconfig.json     the scene's TypeScript project (src/, test/ and tools/)
scripts/flatten.ts  joins a scene's modules into one TypeScript scene.ts
types/              the tickr scene API declarations
tsconfig.base.json  compiler settings shared by the scenes
tsconfig.json       type-checks scripts/
Makefile
```

## How a scene builds

The modules in `src/` are ordinary ES modules: each imports what it uses, from other modules
(`./city.ts`) and from npm packages pinned the way tickr wants them (`three@0.187.0`, which
`tsconfig.base.json` maps to the dev dependency so editors and `tsc` see its types).

tickr stores a scene as one `scene.ts` that may import only npm packages, and standard bundlers
emit JavaScript. So the one custom step is `scripts/flatten.ts`: from `src/main.ts` it follows
the imports in the order ES modules run (each module after what it imports), drops the local
imports and `export` keywords, and joins the modules into one readable TypeScript file, with
the package imports at the top. Everything else is standard: `tsc` checks the modules and the
result, esbuild bundles for Node, Make ties it together and rebuilds only when sources change.

Because the modules end up in one scope:
- no two modules may declare the same top-level name;
- local imports name things as declared (no `as`, `* as` or default imports);
- only the entry has `export default`;
- code that runs at load (top-level initializers) may only use modules that have already run.
  Modules can import each other in a cycle, but then load-time code inside the cycle can see
  an uninitialized value. `make check` catches this: `tsc` on the built file flags a constant
  used before its declaration, and the load test runs every module's top-level code in Node.
  The fix is to move what load-time code needs into a module outside the cycle (as
  `long-day/src/grid.ts` and `facadetiles.ts` are).

A test (`test/<name>.ts`) is built the same way from its own imports, so it pulls in only the
modules it uses; it is then bundled with esbuild and run under Node. It reports failure through
its exit code (`process.exitCode = 1`), and `make check` shows its output only then.

## Adding a scene

1. Pull it: `tickr-scene pull <url> scenes/<scene>`, or create `scenes/<scene>/scene.json`.
2. Add an extension (`.png`, ...) to each file in `assets/`, and delete `document.sha256`.
3. Keep `scene.ts` as a single-file scene, or split it into modules under `src/`, with the
   entry in `src/main.ts`, and add a `tsconfig.json` like `scenes/long-day/tsconfig.json`.
4. `make check-<scene>`.

## Publishing

This repo is the source of truth for its scenes: a publish overwrites the published scene with
the version built here, whatever has been published since. Don't edit scenes in the tickr editor;
any change made there is lost at the next publish.

Build, then follow the toolkit's publish flow on `build/<scene>/`. Pull the scene into
`build/<scene>/` first (`tickr-scene pull`) only so the `document.sha256` a publish needs as its
base is there; a rebuild replaces only `scene.ts`, `scene.json` and `assets/`, so it survives.
Every `make <scene>` regenerates `scene.ts` from `src/`, so building after a pull always gives
the current source, never the pulled one.
