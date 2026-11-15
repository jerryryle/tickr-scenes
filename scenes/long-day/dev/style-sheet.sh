#!/bin/bash
# Render every city style at the same journey moment, for side-by-side comparison.
# Frames go to build/long-day-styles/<view>/<style>/. Needs the tickr-scene toolkit (TICKR).
# Usage: scenes/long-day/dev/style-sheet.sh <skip-minutes> <seconds> <every-ms> [seed] [view]
set -e
cd "$(dirname "$0")/../../.."
TICKR="${TICKR:-$HOME/.tickr-scene/node_modules/.bin/tickr-scene}"
T=build/long-day-test
VIEW="${5:-}"
for st in coastal metro desert brick mainstreet port; do
  make -s test SCENE=long-day DEFINE="DEBUG_SKIP_MINUTES=$1 DEBUG_STYLE=$st DEBUG_VIEW=$VIEW" >/dev/null
  echo "{\"seed\": ${4:-1}, \"timeOfDay\": \"day\", \"debugHud\": false}" > "$T/env.json"
  (cd "$T" && rm -rf dist && "$TICKR" render . --seconds "$2" --every "$3" --env env.json >/dev/null)
  D="build/long-day-styles/${VIEW:-drive}/$st"
  rm -rf "$D" && mkdir -p "$D" && cp "$T"/dist/frames/*.png "$D/"
  echo "$st done"
done
