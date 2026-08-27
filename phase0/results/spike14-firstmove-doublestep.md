# Spike 14 — first-move-only pawn double-step → the CAMP LINE

**Status: PASS (20/20).** Runnable: `node spikes/spike14-firstmove-doublestep.mjs`.

**Final rule (designer, 2026-08-21, third pass):** the shipped semantics
are ROW-based — each side's **camp line is the rank holding the most of
its dealt pawns, ties resolved toward the enemy**, and the leap zone is
that rank plus everything behind it. The line sits where the position
LOOKS like the starting line (the pawn wall): chess's own double-step is
row-based too, and equals first-move-only there only because nothing can
move a pawn backward — quakes CAN, and where the readings diverge the
row wins, because a player can see a line and cannot see a pawn's move
history. Front-most-rank was the second pass and failed the same reading
test from the other side: molding routinely bumps one or two pawns past
the wall (mixed piece/pawn rows), and a lone straggler dragged the whole
zone forward — under mode-row it reads, and plays, as already advanced.
Designer-accepted consequences: pawns dealt ahead of the line never leap
(~10.5% of dealt pawns across the 33-stage bed; about half of deals have
one; worst sampled deal 40%); knocked-back moved pawns regain the jump;
rear pawns behind the line can single-step then double once lanes open
(tied stacks put the line at the front wall — the whole mass has
access); all-scattered terrain resolves generous. The exact-dealt-squares
variant below remains verified as the tighter-but-illegible alternative.

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

`variant.mjs → dealVariant(files, ranks, whiteLineRank, blackLineRank)`
builds the per-deal block (`duel_<f>x<r>__w<line>__b<line>`, regions =
rank spans from each home edge to the line); `armygen.dealMatchup`
derives the camp lines from the molded layouts (the MODE pawn rank per
side, ties toward the enemy — `[corrected]`: this line originally said
"front-most pawn rank", the second formulation, which the designer
rejected on the straggler reading — see the header; `campLineRank` has
always shipped mode-rank), registers the variant in ffish before its own
FEN lint, and
returns `variantName` + `variantIni`; the game appends the block to its
cumulative ini and reloads the engine per duel (recycle paths reload the
same cumulative text, so a mid-duel engine swap keeps the live variant).
The 60-variant catalog is untouched — deal variants ride alongside it.
