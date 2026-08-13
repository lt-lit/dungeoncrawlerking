# Spike 7 — Clipped/asymmetric formations

**Question (§9.7):** "Off-center kings, unequal patch widths, non-mirrored
positions — confirm nothing about eval or move-gen assumes symmetry."

**Script:** `spikes/spike07-asymmetric-formations.mjs` (52/52 checks pass).
**Builds:** ffish.js `010526 LB`; engine `5589ea54 LB`; classical eval.

## Verdict: PASS — with one real generator fix discovered (pawn double-step).

## Findings

1. **10 seeded fully-asymmetric setups** (6–10 files × 6–10 ranks, patch widths
   3–5 at random offsets, off-center kings, random material at ~80% slot fill,
   non-mirrored walls): every position validates, perft(1) matches ffish, and the
   engine returns a legal move with a finite score from BOTH colors. No symmetry
   assumption anywhere in move-gen or eval.
2. **Eval tracks material/position asymmetry correctly** (Q+R vs N+B on identical
   geometry: +892 cp for the strong side; scores across the batch consistently
   favor the materially better army).
3. **No castling residue:** zero `O-O` moves across every generated position
   (`castling=false` + `-` FEN field is sufficient; no e1/e8 assumptions leak).
4. **THE FIND — pawn double-step asymmetry on non-8-rank boards:** FSF's default
   `doubleStepRegionBlack` is the literal region `*7`. On 6-, 7-, 9-, 10-rank
   boards black's pawn row is NOT rank 7, so black silently loses all double-steps
   while white (row on rank 2, default `*2`) keeps them. Demonstrated: 7-rank
   board, white 3 double-steps, black 0. **Fix baked into `lib/variant.mjs`:**
   every generated variant now emits `doubleStepRegionWhite = *2` and
   `doubleStepRegionBlack = *<ranks-1>`; verified symmetric (3/3) on 6, 7, 8, and
   10 ranks. Without this, every non-8-rank duel would have carried a hidden
   tempo bias against one army.
5. **Mini §7 rehearsal:** three full engine-vs-engine games from asymmetric starts
   (via the harness game loop, crumbles enabled) all terminated decisively:
   33–39 plies for tight arenas (inside the 20–40 pacing target), 102 plies for a
   gap-6 arena (6 crumbles) — early evidence that gap size drives game length,
   exactly what the calibration sweep will quantify.

## Design implications

- Formation generation is free to clip, offset, and unbalance patches arbitrarily.
- The double-step regions are now part of the standard duel config — any future
  hand-written variant block must include them (or inherit via the generator).
- En-passant remains live wherever double-steps exist; crumble surgery already
  clears ep rights (§4.5), so no interaction issue.
