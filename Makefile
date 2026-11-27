# Build tickr scenes from scenes/<scene>/ into build/<scene>/ (git-ignored):
#
#   make                       build every scene
#   make long-day              build one scene
#   make check                 type-check, load-test and test every scene (+ tickr-scene check)
#   make check-long-day        the same, one scene
#   make test                  run every scene's tests (scenes/<scene>/test/*.ts)
#   make test-long-day         the same, one scene
#                              (tests run TEST_JOBS at a time: by default two fewer than the CPUs;
#                              e.g. TEST_JOBS=2 on a machine short of memory, TEST_JOBS=1 for one at
#                              a time; make's own -jN, when given, limits them instead)
#   make render-long-day       build, then render with tickr-scene
#   make scrub-long-day [SCRUB=20]
#                              render a scrub test (needs the toolkit): play, scrub back half way,
#                              play on, and check every replayed tick matches playing forward
#   make debug SCENE=long-day DEFINE="DEBUG_STYLE=metro DEBUG_HOUR=18"
#                              a build with constants overridden, in build/<scene>-debug/
#   make run SCENE=long-day TEST=journey ARGS=30 [DEFINE=...]
#                              run one test with arguments, showing its output
#   make tool SCENE=long-day TOOL=showroom [SECS=17 DEFINE=...]
#                              render a test scene from scenes/<scene>/tools/<tool>.ts (one frame a
#                              second) to build/<scene>-<tool>/, every frame tiled into <tool>.png
#   make stage [STAGE="reefer frozen drop door=0.2" VIEW=quarter FROM=0 SECS=12 SPEED=1]
#                              one stop of Long Day's staged on its own, its crew filmed from a fixed
#                              camera, to build/long-day-stage/stage.mp4 in seconds (tools/stage.ts)
#   make citymap SCENE=long-day [SEED=1 CITIES=4 DEFINE=...]
#                              draw the street graphs of a journey's first cities, top down, to
#                              build/<scene>-citymap/city<N>.png (needs ffmpeg)
#   make draft SCENE=long-day ARGS="<style> [candidates]"
#                              draft five new city files of a style into
#                              scenes/long-day/src/city-<style>/ (tools/draftcities.ts)
#   make draftroads SCENE=long-day [ARGS="<road id> ..."]
#                              draft the roads' maps into scenes/long-day/src/roads/
#                              (tools/draftroads.ts)
#   make clearstops SCENE=long-day [ARGS="<city id> ..."] [DOORS=1]
#                              move the pavements' furniture, trees and lamps out of every kerb
#                              stop's work area in the catalogue cities' files (tools/clearstops.ts);
#                              with DOORS=1, redraft the facilities' doors from their buildings instead
#   make tractorturns SCENE=long-day [ARGS="<city id> ..."]
#                              write the moves a tractor-trailer never takes into the catalogue
#                              cities' files (tools/tractorturns.ts)
#   make vicjunctions SCENE=long-day [ARGS="<city id> ..."]
#                              decide which of a Victorian city's junctions keep semaphores, have
#                              a constable or are all-way stops, into its file (tools/vicjunctions.ts)
#   make draftworld SCENE=long-day [ARGS="<seed>"]
#                              draft the world graph's roads into
#                              scenes/long-day/src/world-roads.ts (tools/draftworld.ts)
#   make maps SCENE=long-day [ARGS="<city id> ..."]
#                              write each catalogue city's layered SVG map into
#                              build/<scene>-maps/city-<style>/ (tools/maps.ts), TEST_JOBS at a time
#   make clean / distclean
#
# A modular scene's entry is scenes/<scene>/src/main.ts; scripts/flatten.ts follows its imports
# into one TypeScript scene.ts. A scene with scenes/<scene>/scene.ts instead is copied as is.
# A test is a Node program in scenes/<scene>/test/ that exits non-zero when it fails.
# check-<scene> also runs scrub-<scene> when the toolkit is installed and the scene has a
# DEBUG_SCRUBTEST constant (src/debug.ts).

# The tickr-scene toolkit, installed in the project (git-ignored); it runs on the Node it ships.
TICKR_HOME ?= $(CURDIR)/.tickr-scene
TICKR_BIN   = $(TICKR_HOME)/node_modules/.bin/tickr-scene
TICKR       = PATH="$(TICKR_HOME)/node/bin:$$PATH" $(TICKR_BIN)
BIN     := node_modules/.bin
DEPS    := node_modules/.package-lock.json
SCENES  := $(patsubst scenes/%/scene.json,%,$(wildcard scenes/*/scene.json))
FLATTEN  = node scripts/flatten.ts
DEFINES  = $(addprefix --define ,$(DEFINE))

# Bundle a built scene.ts for Node with esbuild: tickr's pinned specifiers ("three@0.187.0")
# are aliased to the devDependency of the same package. $(call node-bundle,in.ts,out.mjs)
node-bundle = $(BIN)/esbuild $(1) --bundle --platform=node --format=esm --log-level=error \
  $$(grep -oE '^import .* from "[^".][^"]*@[0-9][^"]*"' $(1) | sed -E 's/.*"(.+)@([^@"]+)"$$/--alias:\1@\2=\1/' | sort -u) \
  --outfile=$(2)

# A build's scene.json: the scene's own, with any assets a build step packed listed too
# (scripts/scenejson.ts). $(call scene-json,scenes/<scene>,dst)
scene-json = node scripts/scenejson.ts $(1) $(2)
# Copy a scene's assets for the toolkit, which finds each asset by its scene.json name with no
# extension (assets/logo.png -> assets/logo), and any a build step packed beside them
# (<src>-packed/: long-day's world asset). $(call copy-assets,src,dst)
copy-assets = rm -rf $(2) && mkdir -p $(2) && \
  for f in $(1)/* $(1)-packed/*; do [ -f "$$f" ] || continue; n=$$(basename "$$f"); case "$$n" in *.tmp) continue;; esac; d="$(2)/$${n%.*}"; \
    if [ -e "$$d" ]; then echo "$(1): two assets named $${n%.*} (extensions are dropped)" >&2; exit 1; fi; cp "$$f" "$$d"; done

.PHONY: all check clean distclean debug run test list tool citymap draft draftworld draftroads tractorturns clearstops vicjunctions maps FORCE $(SCENES) \
        $(addprefix check-,$(SCENES)) $(addprefix test-,$(SCENES)) $(addprefix render-,$(SCENES)) \
        $(addprefix scrub-,$(SCENES)) $(addprefix scrub-if-,$(SCENES)) $(addprefix toolkit-check-,$(SCENES))
.SECONDEXPANSION:
.DELETE_ON_ERROR:

all: $(SCENES)

list:
	@echo $(SCENES)

# A scene: its scene.ts, scene.json and assets.
$(SCENES): %: build/%/scene.ts
	@$(call scene-json,scenes/$*,build/$*)
	@$(call copy-assets,scenes/$*/assets,build/$*/assets)
	@echo "$* -> build/$*/"

# A built scene.ts is regenerated on every build (flattening takes well under a second) and
# replaced only when its content changes. Timestamps can't be trusted here: `tickr-scene pull`
# into build/<scene>/ rewrites scene.ts with the published source and a newer mtime, which would
# otherwise leave that published source in place and get it published again.
replace-if-changed = if cmp -s $(1).tmp $(1); then rm -f $(1).tmp; else mv -f $(1).tmp $(1); fi

build/%/scene.ts: scenes/%/src/main.ts $$(wildcard scenes/$$*/src/*.ts scenes/$$*/src/*/*.ts) scripts/flatten.ts FORCE | $(DEPS)
	@mkdir -p $(@D)
	@$(FLATTEN) $< --root scenes/$*/src > $@.tmp
	@$(call replace-if-changed,$@)

build/%/scene.ts: scenes/%/scene.ts FORCE
	@mkdir -p $(@D)
	@cp $< $@.tmp
	@$(call replace-if-changed,$@)

FORCE:

check: $(addprefix check-,$(SCENES))
	@$(BIN)/tsc -p tsconfig.json && echo "ok   scripts"

# (The built scene.ts alone, as tickr will see it: not the test, debug and tool builds beside it,
# which may be left over from older sources.)
$(addprefix check-,$(SCENES)): check-%: %
	@if [ -f scenes/$*/tsconfig.json ]; then $(BIN)/tsc -p scenes/$* && echo "ok   $*: modules"; fi
	@printf '{ "extends": "../tsconfig.base.json", "include": ["$*/scene.ts", "../types/tickr-scene.d.ts"] }\n' > build/tsconfig.$*.json
	@$(BIN)/tsc -p build/tsconfig.$*.json && echo "ok   $*: build/$*/scene.ts"
	@$(call node-bundle,build/$*/scene.ts,build/$*/load.mjs) && \
	 node --input-type=module -e 'await import("./build/$*/load.mjs")' && echo "ok   $*: loads (top-level code runs in order)"
	@$(MAKE) --no-print-directory -s $(if $(findstring jobserver,$(MAKEFLAGS)),,-j$$(( $(TEST_JOBS) + 2 ))) test-$* toolkit-check-$* scrub-if-$*

# (check-<scene>'s last three steps, run side by side: the tests, the toolkit's check, and the
# scrub cases when the scene has them.)
$(addprefix toolkit-check-,$(SCENES)): toolkit-check-%:
	@if [ -x "$(TICKR_BIN)" ]; then \
	   if $(TICKR) check build/$* > build/$*-toolkit-check.txt 2>&1; then grep -v '^no type errors$$' build/$*-toolkit-check.txt; echo "ok   $*: tickr-scene check"; \
	   else cat build/$*-toolkit-check.txt; echo "FAIL $*: tickr-scene check"; exit 1; fi; \
	 else echo "skip $*: tickr-scene check (no toolkit in $(TICKR_HOME); see README)"; fi
$(addprefix scrub-if-,$(SCENES)): scrub-if-%:
	@if [ -x "$(TICKR_BIN)" ] && grep -qs '^export const DEBUG_SCRUBTEST\b' scenes/$*/src/debug.ts; then $(MAKE) --no-print-directory -s scrub-$*; \
	 else echo "skip $*: scrub check (needs the toolkit and DEBUG_SCRUBTEST)"; fi

test: $(addprefix test-,$(SCENES))

# Each test is built from its own imports into build/<scene>-<test>/ and run, TEST_JOBS at a time
# (by default two fewer than the CPUs, leaving room for check's scrub renders); their results are
# reported in order once all are done, a test's output only when it fails.
TESTS = $(wildcard scenes/$*/test/*.ts)
TEST_JOBS ?= $(shell n=$$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 2); echo $$(( n > 3 ? n - 2 : 1 )))
$(addprefix test-,$(SCENES)): test-%: | $(DEPS)
	@$(MAKE) --no-print-directory -s $(if $(findstring jobserver,$(MAKEFLAGS)),,-j$(TEST_JOBS)) $(patsubst scenes/$*/test/%.ts,run-test/$*/%,$(TESTS))
	@fail=0; for t in $(TESTS); do \
	  n=$$(basename $$t .ts); out=build/$*-$$n; \
	  if [ "$$(cat $$out/status 2>/dev/null)" = 0 ]; then echo "ok   $*: test/$$n.ts"; \
	  else cat $$out/output.txt; echo "FAIL $*: test/$$n.ts"; fail=1; fi; \
	done; exit $$fail
# (One test, run-test/<scene>/<test>: its exit code to build/<scene>-<test>/status, for test-<scene>.)
run-test/%: FORCE | $(DEPS)
	@sc=$(firstword $(subst /, ,$*)); n=$(notdir $*); out=build/$$sc-$$n; mkdir -p $$out; echo running > $$out/status; \
	{ $(FLATTEN) scenes/$$sc/test/$$n.ts --root scenes/$$sc/src > $$out/scene.ts && $(call node-bundle,$$out/scene.ts,$$out/$$n.mjs) && \
	  node $$out/$$n.mjs; } > $$out/output.txt 2>&1; echo $$? > $$out/status

# Scrub tests: a build with DEBUG_SCRUBTEST=<s> plays s seconds, scrubs back to half way and plays
# on at 2.1x (main.ts scrubTestTime), logging every presentation tick; every tick played again
# after the scrub must log what it did the first time (scripts/scrubcheck.awk). The cases are the
# lines of scenes/<scene>/scrub.txt (the constants to build with, and `swap` when the trucks must
# change on the way), into build/<scene>-scrub<n>/; without that file, DEBUG_SCRUBTEST=$(SCRUB).
SCRUB ?= 20
$(addprefix scrub-,$(SCENES)): scrub-%: | $(DEPS)
	@test -x "$(TICKR_BIN)" || { echo "no tickr-scene toolkit in $(TICKR_HOME); see README" >&2; exit 1; }
	@$(call copy-assets,scenes/$*/assets,build/$*-scrub-assets)
	@cn=0; { if [ -f scenes/$*/scrub.txt ]; then grep -Ev '^[[:space:]]*(#|$$)' scenes/$*/scrub.txt; else echo "DEBUG_SCRUBTEST=$(SCRUB)"; fi; } | \
	{ while read -r line; do \
	  cn=$$((cn + 1)); out=build/$*-scrub$$cn; mkdir -p $$out; echo "FAIL $*: scrub check $$cn (did not finish)" > $$out/result.txt; \
	  { swap=0; defs=""; \
	    for w in $$line; do if [ "$$w" = swap ]; then swap=1; else defs="$$defs --define $$w"; fi; done; \
	    secs=$$(echo "$$line" | sed -nE 's/.*DEBUG_SCRUBTEST=([0-9]+).*/\1/p'); \
	    if [ -z "$$secs" ]; then echo "scenes/$*/scrub.txt: no DEBUG_SCRUBTEST in: $$line"; echo "FAIL $*: scrub check $$cn"; \
	    elif ! { $(FLATTEN) scenes/$*/src/main.ts --root scenes/$*/src $$defs > $$out/scene.ts && \
	             $(call scene-json,scenes/$*,$$out) && mkdir -p $$out/assets && cp build/$*-scrub-assets/* $$out/assets/; }; then \
	      echo "FAIL $*: scrub check $$cn, building $$line"; \
	    elif ! $(TICKR) render $$out --seconds $$(( secs * 5 / 4 + 1 )) --every 1000 > $$out/log.txt 2>&1; then \
	      tail -5 $$out/log.txt; echo "FAIL $*: scrub check $$cn, $$line (log: $$out/log.txt)"; \
	    elif r=$$(awk -v swap=$$swap -f scripts/scrubcheck.awk $$out/log.txt); then echo "ok   $*: scrub check $$cn ($$r)"; \
	    else echo "$$r"; echo "FAIL $*: scrub check $$cn, $$line (log: $$out/log.txt)"; fi; \
	  } > $$out/result.txt.new 2>&1 && mv $$out/result.txt.new $$out/result.txt & \
	done; wait; \
	fail=0; k=1; while [ $$k -le $$cn ]; do cat build/$*-scrub$$k/result.txt; grep -q '^FAIL' build/$*-scrub$$k/result.txt && fail=1; k=$$((k + 1)); done; \
	exit $$fail; }

$(addprefix render-,$(SCENES)): render-%: %
	@test -x "$(TICKR_BIN)" || { echo "no tickr-scene toolkit in $(TICKR_HOME); see README" >&2; exit 1; }
	$(TICKR) render build/$*

debug: | $(DEPS)
	@test -n "$(SCENE)" || { echo "usage: make debug SCENE=<scene> DEFINE='NAME=VALUE ...'" >&2; exit 2; }
	@mkdir -p build/$(SCENE)-debug
	$(FLATTEN) scenes/$(SCENE)/src/main.ts --root scenes/$(SCENE)/src $(DEFINES) > build/$(SCENE)-debug/scene.ts
	@$(call scene-json,scenes/$(SCENE),build/$(SCENE)-debug)
	@$(call copy-assets,scenes/$(SCENE)/assets,build/$(SCENE)-debug/assets)
	@echo "$(SCENE) debug build -> build/$(SCENE)-debug/"

# One test, with arguments and constant overrides, its output shown.
run: | $(DEPS)
	@test -f "scenes/$(SCENE)/test/$(TEST).ts" || { echo "usage: make run SCENE=<scene> TEST=<test> [ARGS=... DEFINE=...]" >&2; exit 2; }
	@mkdir -p build/$(SCENE)-$(TEST)
	@$(FLATTEN) scenes/$(SCENE)/test/$(TEST).ts --root scenes/$(SCENE)/src $(DEFINES) > build/$(SCENE)-$(TEST)/scene.ts
	@$(call node-bundle,build/$(SCENE)-$(TEST)/scene.ts,build/$(SCENE)-$(TEST)/$(TEST).mjs)
	@node build/$(SCENE)-$(TEST)/$(TEST).mjs $(ARGS)

# The drafting tool (scenes/<scene>/tools/draftcities.ts), run from the repo root with its
# arguments, its output shown.
draft: | $(DEPS)
	@test -f "scenes/$(SCENE)/tools/draftcities.ts" || { echo "usage: make draft SCENE=<scene> ARGS='<style> [candidates]'" >&2; exit 2; }
	@mkdir -p build/$(SCENE)-draft-$(firstword $(ARGS))
	@$(FLATTEN) scenes/$(SCENE)/tools/draftcities.ts --root scenes/$(SCENE)/src $(DEFINES) > build/$(SCENE)-draft-$(firstword $(ARGS))/scene.ts
	@$(call node-bundle,build/$(SCENE)-draft-$(firstword $(ARGS))/scene.ts,build/$(SCENE)-draft-$(firstword $(ARGS))/draft.mjs)
	@node build/$(SCENE)-draft-$(firstword $(ARGS))/draft.mjs $(ARGS)

# The world graph's drafting tool (scenes/<scene>/tools/draftworld.ts), run from the repo root.
draftworld: | $(DEPS)
	@mkdir -p build/$(SCENE)-draftworld
	@$(FLATTEN) scenes/$(SCENE)/tools/draftworld.ts --root scenes/$(SCENE)/src > build/$(SCENE)-draftworld/scene.ts
	@$(call node-bundle,build/$(SCENE)-draftworld/scene.ts,build/$(SCENE)-draftworld/draftworld.mjs)
	@node build/$(SCENE)-draftworld/draftworld.mjs $(ARGS)

# The road maps' drafting tool (scenes/<scene>/tools/draftroads.ts): each road in a process of its
# own, TEST_JOBS at a time (ARGS names the roads to draft again, else those with no map yet), then
# the road list rewritten without its drafting lengths, each road's length then being its map's.
draftroads: | $(DEPS)
	@mkdir -p build/$(SCENE)-draftroads
	@$(FLATTEN) scenes/$(SCENE)/tools/draftroads.ts --root scenes/$(SCENE)/src > build/$(SCENE)-draftroads/scene.ts
	@$(call node-bundle,build/$(SCENE)-draftroads/scene.ts,build/$(SCENE)-draftroads/draftroads.mjs)
	@{ if [ -n "$(ARGS)" ]; then printf '%s\n' $(ARGS); else node build/$(SCENE)-draftroads/draftroads.mjs --list; fi; } | \
	  xargs -P $(TEST_JOBS) -n 1 node build/$(SCENE)-draftroads/draftroads.mjs
	@node build/$(SCENE)-draftroads/draftroads.mjs --world

# Every kerb stop's pavement kept clear (scenes/<scene>/tools/clearstops.ts): the furniture, street
# trees and lamps in a stop's work area moved along their pavements, written into each catalogue
# city's files; with DOORS=1, the facilities' doors redrafted from their buildings instead. Run the
# two in turn until neither changes anything, then tractorturns.
#   make clearstops SCENE=long-day [ARGS="<city id> ..."] [DOORS=1]
clearstops: | $(DEPS)
	@mkdir -p build/$(SCENE)-clearstops
	@$(FLATTEN) scenes/$(SCENE)/tools/clearstops.ts --root scenes/$(SCENE)/src > build/$(SCENE)-clearstops/scene.ts
	@$(call node-bundle,build/$(SCENE)-clearstops/scene.ts,build/$(SCENE)-clearstops/clearstops.mjs)
	@{ if [ -n "$(ARGS)" ]; then printf '%s\n' $(ARGS); else node build/$(SCENE)-clearstops/clearstops.mjs --list; fi; } | \
	  xargs -P $(TEST_JOBS) -I{} node build/$(SCENE)-clearstops/clearstops.mjs {} $(if $(DOORS),--doors)

# The moves a tractor-trailer never takes (scenes/<scene>/tools/tractorturns.ts), written into each
# catalogue city's file, each city in a process of its own, TEST_JOBS at a time; ARGS names the
# cities, all of them by default.
tractorturns: | $(DEPS)
	@mkdir -p build/$(SCENE)-tractorturns
	@$(FLATTEN) scenes/$(SCENE)/tools/tractorturns.ts --root scenes/$(SCENE)/src > build/$(SCENE)-tractorturns/scene.ts
	@$(call node-bundle,build/$(SCENE)-tractorturns/scene.ts,build/$(SCENE)-tractorturns/tractorturns.mjs)
	@{ if [ -n "$(ARGS)" ]; then printf '%s\n' $(ARGS); else node build/$(SCENE)-tractorturns/tractorturns.mjs --list; fi; } | \
	  xargs -P $(TEST_JOBS) -n 1 node build/$(SCENE)-tractorturns/tractorturns.mjs

# How each Victorian catalogue city's junctions are controlled (scenes/<scene>/tools/vicjunctions.ts),
# written into its city file; ARGS names the cities, all the Victorian ones by default. Run
# clearstops (with and without DOORS=1) and then tractorturns afterwards.
vicjunctions: | $(DEPS)
	@mkdir -p build/$(SCENE)-vicjunctions
	@$(FLATTEN) scenes/$(SCENE)/tools/vicjunctions.ts --root scenes/$(SCENE)/src > build/$(SCENE)-vicjunctions/scene.ts
	@$(call node-bundle,build/$(SCENE)-vicjunctions/scene.ts,build/$(SCENE)-vicjunctions/vicjunctions.mjs)
	@{ if [ -n "$(ARGS)" ]; then printf '%s\n' $(ARGS); else node build/$(SCENE)-vicjunctions/vicjunctions.mjs --list; fi; } | \
	  xargs -n 1 node build/$(SCENE)-vicjunctions/vicjunctions.mjs

# The city maps (scenes/<scene>/tools/maps.ts), each city in a process of its own, TEST_JOBS at a
# time; ARGS names the cities to draw, all of them by default.
maps: | $(DEPS)
	@test -f "scenes/$(SCENE)/tools/maps.ts" || { echo "usage: make maps SCENE=<scene> [ARGS='<city id> ...']" >&2; exit 2; }
	@mkdir -p build/$(SCENE)-maps
	@$(FLATTEN) scenes/$(SCENE)/tools/maps.ts --root scenes/$(SCENE)/src > build/$(SCENE)-maps/scene.ts
	@$(call node-bundle,build/$(SCENE)-maps/scene.ts,build/$(SCENE)-maps/maps.mjs)
	@{ if [ -n "$(ARGS)" ]; then printf '%s\n' $(ARGS); else node build/$(SCENE)-maps/maps.mjs --list; fi; } | \
	  xargs -P $(TEST_JOBS) -n 1 node build/$(SCENE)-maps/maps.mjs

# One test scene from a scene's tools/, rendered a frame a second for SECS seconds, its frames
# tiled 2 across at 2x into one PNG (needs ffmpeg).
SECS     ?= 12
TOOL_OUT  = build/$(SCENE)-$(TOOL)
tool: | $(DEPS)
	@test -f "scenes/$(SCENE)/tools/$(TOOL).ts" || { echo "usage: make tool SCENE=<scene> TOOL=<tool> [SECS=... DEFINE=...]" >&2; exit 2; }
	@test -x "$(TICKR_BIN)" || { echo "no tickr-scene toolkit in $(TICKR_HOME); see README" >&2; exit 1; }
	@mkdir -p $(TOOL_OUT)
	@$(FLATTEN) scenes/$(SCENE)/tools/$(TOOL).ts --root scenes/$(SCENE)/src $(DEFINES) > $(TOOL_OUT)/scene.ts
	@$(call scene-json,scenes/$(SCENE),$(TOOL_OUT))
	@$(call copy-assets,scenes/$(SCENE)/assets,$(TOOL_OUT)/assets)
	@$(TICKR) render $(TOOL_OUT) --seconds $(SECS) --every 1000 | tail -1
	@ffmpeg -loglevel error -y -i $(TOOL_OUT)/dist/frames/frame-%03d.png -frames:v 1 \
	  -vf "scale=iw*2:ih*2:flags=neighbor,tile=2x$$(( ($(SECS) + 1) / 2 ))" $(TOOL_OUT)/$(TOOL).png
	@echo "$(SCENE) $(TOOL) -> $(TOOL_OUT)/$(TOOL).png"

# One stop staged on its own (scenes/long-day/tools/stage.ts): its crew filmed from a fixed camera,
# as a clip at 10 frames a second, build/long-day-stage/stage.mp4. The quick way to see a chore.
#   make stage STAGE="reefer frozen drop" VIEW=quarter FROM=20 SECS=40 SPEED=1
STAGE ?= box26 boxes drop
VIEW  ?= quarter
FROM  ?= 0
SPEED ?= 1
stage: | $(DEPS)
	@test -x "$(TICKR_BIN)" || { echo "no tickr-scene toolkit in $(TICKR_HOME); see README" >&2; exit 1; }
	@mkdir -p build/long-day-stage
	@$(FLATTEN) scenes/long-day/tools/stage.ts --root scenes/long-day/src --define 'STAGE_SPEC=$(STAGE)' --define STAGE_VIEW=$(VIEW) --define STAGE_FROM=$(FROM) --define STAGE_SPEED=$(SPEED) $(DEFINES) > build/long-day-stage/scene.ts
	@$(call scene-json,scenes/long-day,build/long-day-stage)
	@$(call copy-assets,scenes/long-day/assets,build/long-day-stage/assets)
	@rm -rf build/long-day-stage/dist
	@$(TICKR) render build/long-day-stage --seconds $(SECS) --every 100 | tail -1
	@ffmpeg -loglevel error -y -framerate 10 -i build/long-day-stage/dist/frames/frame-%03d.png -vf "scale=1152:384:flags=neighbor" -c:v libx264 -pix_fmt yuv420p -crf 18 build/long-day-stage/stage.mp4 2>/dev/null || \
	  ffmpeg -loglevel error -y -framerate 10 -i build/long-day-stage/dist/frames/frame-%04d.png -vf "scale=1152:384:flags=neighbor" -c:v libx264 -pix_fmt yuv420p -crf 18 build/long-day-stage/stage.mp4
	@echo "stage $(STAGE) -> build/long-day-stage/stage.mp4"

# Top-down maps of a journey's cities (scenes/<scene>/tools/citymap.ts).
SEED   ?= 1
CITIES ?= 4
citymap: | $(DEPS)
	@test -f "scenes/$(SCENE)/tools/citymap.ts" || { echo "usage: make citymap SCENE=<scene> [SEED=... CITIES=... DEFINE=...]" >&2; exit 2; }
	@mkdir -p build/$(SCENE)-citymap
	@$(FLATTEN) scenes/$(SCENE)/tools/citymap.ts --root scenes/$(SCENE)/src $(DEFINES) > build/$(SCENE)-citymap/scene.ts
	@$(call node-bundle,build/$(SCENE)-citymap/scene.ts,build/$(SCENE)-citymap/citymap.mjs)
	@node build/$(SCENE)-citymap/citymap.mjs build/$(SCENE)-citymap $(SEED) $(CITIES)
	@for f in build/$(SCENE)-citymap/city*.ppm; do ffmpeg -loglevel error -y -i $$f $$(dirname $$f)/$$(basename $$f .ppm).png; done
	@echo "$(SCENE) city maps -> build/$(SCENE)-citymap/"

# Install dev dependencies when package-lock.json changes.
$(DEPS): package-lock.json
	npm ci
	@touch $@

clean:
	rm -rf build

distclean: clean
	rm -rf node_modules
