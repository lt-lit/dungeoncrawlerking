# Spike 2 — Static wall squares at density: classical eval behavior

**Question (§9.2):** "Static wall squares (`*`) in startFen on custom variants, at
various densities. Sanity-check classical eval behavior with heavy walls."
(Support itself is shipping-grade — crossderby precedent; this spike is about eval.)

**Script:** `spikes/spike02-wall-density-eval.mjs` (56/56 checks pass).
**Builds:** ffish.js `010526 LB`; engine `5589ea54 LB`; classical eval.

## Verdict: PASS — classical eval is trustworthy under walls at every density tested.

## Findings

1. **Mirrored arenas stay near equality at 0–40% wall density** on 8x8, 10x8, and
   12x10 (seeded symmetric wall layouts): evals ranged −38..+92 cp — i.e. small
   first-move-advantage noise, no density-correlated drift. perft(1) matched ffish
   on every position.
2. **Color-flip consistency is exact** on asymmetric walled positions (side-to-move
   POV scores equal under flip: diffs 0, 30, 7 cp at depth 10). No eval term
   mishandles walls asymmetrically.
3. **Perf:** walls shrink mobility and *speed up* search (306k nps open vs 375k nps
   at 30% walls, depth 12 on 10x8). No cliff.
4. **Pathologies degrade gracefully, but one is a real design risk:**
   - **Disconnected arena** (solid wall line, armies can't reach each other):
     finite eval (~+7 cp), legal moves, no crash — but no progress is possible and
     the no-draw config means no rescue. Live: pacing crumbles would eventually
     open the wall line or grind to stalemate; still, **the §6 linter must forbid
     disconnected duel arenas at generation time** (harness `arena.mjs` already
     BFS-checks connectivity).
   - Sealed-king pockets: finite eval, playable.
   - **Walled-off passed pawn:** eval does NOT overvalue a passer whose path is
     permanently walled (blocked 146 cp vs free-path 138 cp — noise-level
     difference). Classical passed-pawn terms don't misfire next to walls in the
     cases tested; worth re-checking during Phase 1 tuning with more positions.

## Design implications

- Terrain-as-walls needs no eval mitigation at any plausible arena density.
- Arena generation must guarantee connectivity (linter rule, already prototyped in
  the harness); everything else about walls is safe to lean on.
