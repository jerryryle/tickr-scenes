# Compare the ticks a scrub-test render played twice (make scrub-<scene>): a build with
# DEBUG_SCRUBTEST logs `TICK <k> <camera, truck, shot...>` at every presentation tick, playing
# forward, scrubbing back half way and playing on, so each tick after the scrub point is logged
# once played forward and once replayed from a snapshot. The two must match exactly.
#
# With -v swap=1, the replayed ticks must also show the trucks changing (a TICK line's last field
# is the driven truck and the second one), or the case has stopped covering a swap.
#
#   awk [-v swap=1] -f scripts/scrubcheck.awk <render log>
{
  i = index($0, "TICK ")
  if (!i) next
  line = substr($0, i + 5)
  nf = split(line, f, " ")
  k = f[1]
  if (k in seen) {
    twice++
    if (!(f[nf] in trucks)) { trucks[f[nf]] = 1; kinds++ }
    if (seen[k] != line) {
      bad++
      if (bad <= 5) printf "tick %s differs:\n  forward  %s\n  scrubbed %s\n", k, seen[k], line
    }
  } else seen[k] = line
}
END {
  if (!twice) { print "scrub check: no tick was played twice (did the render reach the scrub?)"; exit 1 }
  if (bad) { printf "scrub check: %d of %d replayed ticks differ\n", bad, twice; exit 1 }
  if (swap && kinds < 2) { print "scrub check: the trucks never change in the replayed ticks (no longer a swap case)"; exit 1 }
  printf "%d replayed ticks match\n", twice
}
