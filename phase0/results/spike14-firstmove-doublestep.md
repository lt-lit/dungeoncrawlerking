# Spike 14 — first-move-only pawn double-step

**Status: PASS (14/14).** Runnable: `node spikes/spike14-firstmove-doublestep.mjs`.

## The problem

§4.4's universal double-step (spike 13) shipped with the caveat "region
semantics are every-visit" — a pawn could decline its double-step and fire
it later from mid-board. The designer rejected that reading outright
(2026-08-21): the double-step belongs to a pawn's **first move only**,
whatever square it starts on. The caveat had been recorded in canon but
its concrete consequence ("a pawn can save the jump for later") was never
put in front of the designer as a decision — a process failure this spike
closes.

## The constraint

FSF tracks no per-pawn move history, and OUR architecture could never use
one anyway: quake surgery reloads bare FENs (rule 9), which resets
history by design. So "has this pawn moved?" must be a function of the
POSITION. Pawns never move backward, so **a pawn is provably unmoved iff
it stands on the square it was dealt onto.**

## Findings

1. **Variant registration is incremental** in both libraries. Rule 7
   ("names are single-use") bans REdefinition — silent no-op — but new
   names load fine after the catalog, in ffish (`loadVariantConfig`) and
   in the engine (cumulative `loadVariantsIni` rewrite + re-set
   VariantPath on the same instance; perft parity holds; repeated
   reloads fine). Deal variants are named BY their config
   (`duel_<f>x<r>__w<squares>__b<squares>`), so a name collision is
   always an identical config — re-registration can never silently
   change rules. ~50-char names load fine.
2. **`doubleStepRegion` accepts explicit square lists**, and the
   semantics are exactly "double-step iff standing on a listed square":
   available on a dealt square at any rank, gone one step later, black
   mirrored, en passant works against it with the correct ep square.
3. **Betza `i` ("initial") is region-gated, not move-tracked** —
   `z:fmWfceFifmnD` offers the double exactly on `doubleStepRegion`
   squares. There is no deeper first-move mechanism in this build;
   start-square regions are the expressibility ceiling.
4. **Residual, accepted as engine grammar**: a pawn that arrives on a
   COMRADE's dealt square regains the option once. Reaching one takes
   stacked-file molding (two pawns dealt in one file — only when army
   width exceeds the deployment window) plus the rear pawn declining its
   own double first; quake displacement onto/off a dealt square is the
   same class. Everywhere else the rule is exact first-move-only.

## Production shape

`variant.mjs → dealVariant(files, ranks, whitePawnSquares,
blackPawnSquares)` builds the per-deal block; `armygen.dealMatchup`
derives the pawn squares from the molded layouts, registers the variant
in ffish before its own FEN lint, and returns `variantName` +
`variantIni`; the game appends the block to its cumulative ini and
reloads the engine per duel (recycle paths reload the same cumulative
text, so a mid-duel engine swap keeps the live variant). The 60-variant
catalog is untouched — deal variants ride alongside it.
