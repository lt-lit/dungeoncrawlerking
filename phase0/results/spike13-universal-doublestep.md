# Spike 13 — universal pawn double-step (multi-rank doubleStepRegion)

**PASS (9/9). Yes — FSF supports it,** with one semantic caveat the design
must own.

Question (slice-refresh decision 1): molding means pawns start on arbitrary
ranks; the designer wants the double-step available regardless of starting
position. FSF grants double-step by REGION membership and tracks no
per-pawn "has moved" state, so the region is the only lever.

## Findings

1. **Multi-rank regions parse and work** in both ffish and the engine's own
   ini reader: `doubleStepRegionWhite = *2 *3 *4 *5 *6 *7` (space-separated
   rank tokens) gives a pawn on rank 3 the c3c5 push; the baseline `*2`
   control does not. No rule-3 silent no-op.
2. **Semantics: every-visit, not first-move.** A pawn that has already
   moved and sits in the region gets the double-step again. Region = all
   pawn-legal ranks therefore means EVERY pawn ALWAYS has a two-square
   push available — a real rules change beyond "keep your first move"
   (pawn tempo, storms, and escapes all speed up). Accepted by design:
   simple, consistent, dungeon-flavored. There is no FSF way to express
   "first move only" for arbitrary start ranks.
3. **Walls block it correctly**: a wall on the jumped square kills both
   pushes; a wall on the landing square kills only the double.
4. **En passant works against non-native double-steps**: after c3c5 the
   FEN carries `c4` as the ep square and b5xc4 is legal. (Under live
   quakes ep rights are still cleared board-wide per §4.5 — ep stays a
   rare mechanic regardless.)
5. **The engine searches the variant normally** and accepts the new pushes
   as played moves.

## Consequence for the slice refresh

`makeDuelVariantIni` gains the universal region as part of the duel
baseline when the refresh lands (all ranks 2..ranks-1 per color). This is
a canon rules change → brief §4.4 note alongside the §4.2 rewrite, with
designer sign-off. Runnable: `node spikes/spike13-universal-doublestep.mjs`.
