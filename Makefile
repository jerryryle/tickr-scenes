# Build tickr scenes from scenes/<scene>/ into build/<scene>/ (git-ignored):
#
#   make                       build every scene
#   make long-day              build one scene
#   make check                 type-check, load-test and test every scene (+ tickr-scene check)
#   make check-long-day        the same, one scene
#   make test                  run every scene's tests (scenes/<scene>/test/*.ts)
#   make test-long-day         the same, one scene
#   make render-long-day       build, then render with tickr-scene
#   make debug SCENE=long-day DEFINE="DEBUG_STYLE=metro DEBUG_HOUR=18"
#                              a build with constants overridden, in build/<scene>-debug/
#   make run SCENE=long-day TEST=journey ARGS=30 [DEFINE=...]
#                              run one test with arguments, showing its output
#   make clean / distclean
#
# A modular scene's entry is scenes/<scene>/src/main.ts; scripts/flatten.ts follows its imports
# into one TypeScript scene.ts. A scene with scenes/<scene>/scene.ts instead is copied as is.
# A test is a Node program in scenes/<scene>/test/ that exits non-zero when it fails.

TICKR   ?= $(HOME)/.tickr-scene/node_modules/.bin/tickr-scene
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

.PHONY: all check clean distclean debug run test list $(SCENES) \
        $(addprefix check-,$(SCENES)) $(addprefix test-,$(SCENES)) $(addprefix render-,$(SCENES))
.SECONDEXPANSION:
.DELETE_ON_ERROR:

all: $(SCENES)

list:
	@echo $(SCENES)

# A scene: its scene.ts, scene.json and assets.
$(SCENES): %: build/%/scene.ts
	@cp scenes/$*/scene.json build/$*/scene.json
	@rsync -a --delete scenes/$*/assets/ build/$*/assets/
	@echo "$* -> build/$*/"

build/%/scene.ts: scenes/%/src/main.ts $$(wildcard scenes/$$*/src/*.ts) scripts/flatten.ts | $(DEPS)
	@mkdir -p $(@D)
	$(FLATTEN) $< --root scenes/$*/src > $@

build/%/scene.ts: scenes/%/scene.ts
	@mkdir -p $(@D)
	cp $< $@

check: $(addprefix check-,$(SCENES))
	@$(BIN)/tsc -p tsconfig.json && echo "ok   scripts"

$(addprefix check-,$(SCENES)): check-%: %
	@if [ -f scenes/$*/tsconfig.json ]; then $(BIN)/tsc -p scenes/$* && echo "ok   $*: modules"; fi
	@$(BIN)/tsc -p tsconfig.build.json && echo "ok   $*: build/$*/scene.ts"
	@$(call node-bundle,build/$*/scene.ts,build/$*/load.mjs) && \
	 node --input-type=module -e 'await import("./build/$*/load.mjs")' && echo "ok   $*: loads (top-level code runs in order)"
	@$(MAKE) --no-print-directory -s test-$*
	@if [ -x "$(TICKR)" ]; then $(TICKR) check build/$*; \
	 else echo "skip $*: tickr-scene check (no toolkit at $(TICKR); set TICKR=)"; fi

test: $(addprefix test-,$(SCENES))

# Each test is built from its own imports into build/<scene>-<test>/ and run; its output is
# shown only when it fails.
$(addprefix test-,$(SCENES)): test-%: | $(DEPS)
	@set -e; for t in $(wildcard scenes/$*/test/*.ts); do \
	  n=$$(basename $$t .ts); out=build/$*-$$n; mkdir -p $$out; \
	  $(FLATTEN) $$t --root scenes/$*/src > $$out/scene.ts; \
	  $(call node-bundle,$$out/scene.ts,$$out/$$n.mjs); \
	  if node $$out/$$n.mjs > $$out/output.txt 2>&1; then echo "ok   $*: test/$$n.ts"; \
	  else cat $$out/output.txt; echo "FAIL $*: test/$$n.ts"; exit 1; fi; \
	done

$(addprefix render-,$(SCENES)): render-%: %
	@test -x "$(TICKR)" || { echo "tickr-scene not found at $(TICKR); install the toolkit or set TICKR=" >&2; exit 1; }
	$(TICKR) render build/$*

debug: | $(DEPS)
	@test -n "$(SCENE)" || { echo "usage: make debug SCENE=<scene> DEFINE='NAME=VALUE ...'" >&2; exit 2; }
	@mkdir -p build/$(SCENE)-debug
	$(FLATTEN) scenes/$(SCENE)/src/main.ts --root scenes/$(SCENE)/src $(DEFINES) > build/$(SCENE)-debug/scene.ts
	@cp scenes/$(SCENE)/scene.json build/$(SCENE)-debug/
	@rsync -a --delete scenes/$(SCENE)/assets/ build/$(SCENE)-debug/assets/
	@echo "$(SCENE) debug build -> build/$(SCENE)-debug/"

# One test, with arguments and constant overrides, its output shown.
run: | $(DEPS)
	@test -f "scenes/$(SCENE)/test/$(TEST).ts" || { echo "usage: make run SCENE=<scene> TEST=<test> [ARGS=... DEFINE=...]" >&2; exit 2; }
	@mkdir -p build/$(SCENE)-$(TEST)
	@$(FLATTEN) scenes/$(SCENE)/test/$(TEST).ts --root scenes/$(SCENE)/src $(DEFINES) > build/$(SCENE)-$(TEST)/scene.ts
	@$(call node-bundle,build/$(SCENE)-$(TEST)/scene.ts,build/$(SCENE)-$(TEST)/$(TEST).mjs)
	@node build/$(SCENE)-$(TEST)/$(TEST).mjs $(ARGS)

# Install dev dependencies when package-lock.json changes.
$(DEPS): package-lock.json
	npm ci
	@touch $@

clean:
	rm -rf build

distclean: clean
	rm -rf node_modules
