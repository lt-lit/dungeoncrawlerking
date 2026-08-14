# Starter-army sweep — findings

**Question:** is the 3×2 starter army (K+R+N + 3 pawns, value 11) viable as the
run's opening kit against small "scrub" armies, at puzzle pacing (mates in
~10–20 plies under good play), across gaps 2–4 and both initiative colors?

**Answer: yes, cleanly.** 90/90 games decisive, zero errors, zero anomalies,
and the starter converted **all 90** — as White and as Black alike. Full table:
`sweep-starter-summary.md`; raw games: `sweep-starter.jsonl` (seeded, exact
replays). Run: `depth 60 movetime 150`, crumble onset 40 / cadence 8, seeds
3000–3002, engine-vs-engine at full strength both sides (so ply counts are
best-play conversion lengths — the "if you know what you're doing" number).

## Roster

| label | army | width | value |
|---|---|---|---|
| startRN | K+R+N + 3P | 3 | 11 |
| scrubN | K+N + 2P | 2 | 5 |
| scrubB | K+B + 2P | 2 | 5 |
| eliteR | K+R + 2P | 2 | 7 |
| tinyN | K+N + P | 2 | 4 |
| scrapNB | K+N+B, pawnless | 3 | 6 |

## Findings

1. **Gap 2 is the puzzle band.** Every gap-2 matchup resolved in 17–29 plies
   (mates in ~9–15 moves). The 3-unit tinyN dies in 17; scrubB in ~20. Gap 3
   runs ~26–36; gap 4 ~27–48 for everything except the rook elite.
2. **Initiative does not rescue small armies.** The 67% White edge measured on
   mirrored smoke configs vanishes at a 4–7 point material edge: scrub-as-White
   games lasted within ±2 plies of the reversed color. Being ambushed by a
   scrub is the same puzzle with a different move order — the ambush cost the
   design should price is formation/facing (Phase 2), not initiative per se.
3. **The rook elite marks the grind boundary.** eliteR (K+R+2P) at gaps 2–3 is
   fine (24–50 plies). At gap 4 it has room to run and harass: 66–121 plies,
   32 crumbles across 6 games, 6 pieces lost to collapses — the only cell in
   the sweep where the crumble system did real work. Consequences: the gap ≤ 4
   trigger cap is confirmed as the ceiling (gaps 5–6 were already 100+-ply
   grinds in the smoke sweep), and rook-bearing enemies play best at gap ≤ 3 —
   or accept that elite fights run long, which may be right for elites.
4. **Crumbles are now pure failsafe.** Sub-40-ply games never reach onset 40;
   crumble-alarm rate was 0 in every cell (no eval flips, ever). The puzzle
   pacing quietly resolves the §7 crumble-calibration problem: onset/cadence
   only matter in botched grinds, which is exactly the §4.5 design intent
   ("late and rare").

## Arena verification (encounter linter v0)

`harness/verify-play-arenas.mjs` plays the four `play/arenas/*.json` from
their default placement, 3 seeded games each — results in the table below
(engine-vs-engine; PASS = decisive, error-free, player side wins).

| arena | board | enemy | plies (3 games) | verdict |
|---|---|---|---|---|
| arena01-first-duel | 4×6 g2 | scrubN | 17, 25, 25 | PASS ×3 — the teaching puzzle |
| arena02-ambush | 5×7 g3, pillars | scrubB (moves first) | 36, 36, 42 | PASS ×3 — player converts as Black |
| arena03-clipped-vault | 5×7 g3, clip + pillar | eliteR | 25, 49, 75 | PASS ×3 — fat tail, now capped by the strip |
| arena04-long-stair | 3×8 g4 | scrapNB | 31, 33, 39 | PASS ×3 — after the wall fix below |

(Historical: those numbers were measured under the game-layer adjudication
era. Current per-arena numbers under the NATIVE config are in the REVERSAL
section below — tighter across the board.)

Two lessons the linter earned its keep on, first run out:

- **arena04 as first authored had a center wall (b5) and the ENEMY WON a
  seed** (178 plies, 15 crumbles, crumble-decided). A wall on a 3-file board
  leaves two 1-file channels — near-crawlspace geometry a pawnless K+N+B holds
  indefinitely. Removing the wall matches the sweep's clean wall-free cell
  (35 plies). **Authoring rule: no walls on 3-file arenas** — one wall costs a
  third of a rank's cross-section; the narrowest boards must stay open.
- **Engine-vs-engine games are NOT replay-deterministic across runs** (the
  crumble RNG is seeded, but `movetime` search is timing-sensitive), so
  verifier plies are samples from a distribution, not fixed numbers —
  arena03's tail showed 35–103 plies across two runs. Judge arenas on the
  distribution over ≥3 games, and re-run before trusting a borderline verdict.

Wins terminate as both `checkmate` and `stalemate-or-extinction` — the
suffocation win (stalemateValue=loss) is doing real work in cramped small-army
duels, exactly as the no-draw config intends.

## Bare-army adjudication ("a side stripped to a bare king loses")

**Rule:** the moment a side has no non-king material, it loses — no lone-king
chases. Shipped as a game-layer adjudication (harness `opts.bareKingLoses`,
always-on in `play/js/duel.mjs`, termination `army-extinct`), ordered after
the mover-loses check so mating captures still read as checkmate. Crumble
candidates that would strip a side's last piece are re-rolled.

**Why not in the variant config (probed, refuted):** FSF's
`extinctionPieceTypes = *` + `extinctionPieceCount = 1` genuinely is
total-count bare-king semantics (probe: K+2P vs K+Q plays on; bare K
adjudicates 0-1 — so `*` counts totals, unlike per-type letter lists, which
fire instantly for any side missing a listed type). But the route fails for two probed reasons (a RETRACTION is folded in below):

- **The count rule is inert under the validated pseudo-royal config.** With
  `extinctionPseudoRoyal = true` (spike 4's shipped trio), a bare king under
  (`*`, 1) simply plays on — "the last extinction piece is treated like a
  royal piece" suppresses the adjudication. Making it fire requires
  `extinctionPseudoRoyal = false`.
- **The extinction options are a single (types, count) pair, and the two
  rules need different measurements.** `types=k` counts KINGS — it cannot
  see bareness (a bare king still counts 1). `types=*` counts TOTALS — it
  cannot see king capture (probed: under (`*`,1,false), capturing a king
  whose army still stands satisfies NO rule; the kingless, unmateable army
  plays on — a "kingless zombie" — and the game can only end by grinding it
  to ≤1 piece). One slot, two incompatible metrics: adopting bare-king
  in-grammar forfeits §4.4's king-capture terminal.

**Retraction:** an earlier revision claimed the (`*`,1,false) config charged
exposed-king losses to the WRONG side via empty movegen. That was an
artifact of a contaminated probe (the test position's king was accidentally
bare, so its zero legal moves were the bareness adjudication — correctly
scored 1-0 — not movegen breakage). Re-probed cleanly: exposed-king movegen
is IDENTICAL in both configs, king capture included, and spike 4 finding 5
already recorded that `pseudoRoyal=false` does not de-royalize the chess
template's king. The refutation of the in-grammar route is the two bullets
above, not wrong-side scoring.

**Discovered while correcting — the shipped config has a milder zombie of
its own:** spike 4 verified "capture ends the game immediately" only for a
victim with a bare king. Probed with material remaining: after RxK, ffish
answers `result(false) = *` and the kingless side keeps generating moves.
The ENGINE is sound here (scores kingless as a forced loss, mate-in-a-few,
and plays toward it), so self-play converges — but both game loops now
adjudicate kingless positions IMMEDIATELY at the game layer (termination
`king-capture`), making the §4.5 filter-miss terminal instant at every
material count.

Also probed, standing: **crumbles cannot create exposed kings with standard
pieces** — a collapsed square becomes a wall, and walls only ever BLOCK
slider lines; removing a piece removes attacks, never adds them. The §4.5
filter's exposure clause is cheap insurance; its instant-mate /
instant-stalemate clauses are the live ones (walls delete escape squares).
The real sources of exposed-king states are other position surgery: the
Phase 2 projection input class, enemy-editor states, and surgery bugs.

The belt stays on; the game layer adjudicates — bare armies and kingless
armies both.

## REVERSAL: bare-army moved IN-GRAMMAR (the native config)

The game-layer verdict above did not survive designer review, and the
designer was right. The game-layer route left the ENGINE rule-blind, with a
measurable pathology: on K+R vs k+p the shipped config's engine recommended
a king shuffle at mate-7 while the actual best move — capture the pawn,
army extinct, win NOW — went unrecommended (it surfaced live in Cheater
Mode hints as "why is it telling me to push a pawn instead of taking the
strip-win"). That also means every ply figure in the tables above was
measured by an engine playing a slightly different game than the one
shipped. The blocker that had justified game-layer-only — the kingless
zombie — is itself game-layer-adjudicated since this session, dissolving
the objection.

**The native baseline** (now in `lib/variant.mjs` + `play/js/variant.mjs`):
`extinctionValue=loss`, `extinctionPieceTypes=*`, `extinctionPieceCount=1`,
`extinctionPseudoRoyal=false`. Decisive probe, K+R vs k+p, white to move:

| config | engine bestmove | score |
|---|---|---|
| shipped (k/0/pseudo-royal) | a1b2 — a king shuffle | mate 7 |
| native (*/1/false) | c2c5 — takes the pawn | **mate 1** |

Defender's view under native: mate −1 (knows bareness is death). The king
stays fully royal (spike 4 finding 5); check/checkmate/stalemate untouched.

**Revalidation:** `lib/selftest.mjs` PASS (perft parity unchanged — movegen
is identical in live positions); spike 04 25/25; spike 10 32/32 (A-prime
no-draw behavior intact: honest evals through loops, no repetition-chasing,
no adjudication). Four spike fixtures needed un-baring — bare-king "victim"
positions are decided at load under the native rule, a trap future tests
must avoid (CLAUDE.md rule 4).

**What remains game-layer:** exactly one adjudication — kingless states
(surgery-only; extinction on totals cannot see them). The bare-army
game-layer check was deleted as dead code (a bared side now has zero legal
moves, so the standard mover-loses protocol covers it); terminations label
as `army-extinct`/`bare-king` when the loser is bare. The crumble guard
(never collapse a last piece) is now UNCONDITIONAL — under the native
config such a crumble would end the game by dice roll.

**Cheater Mode is truthful for free:** hints and the eval bar are raw
engine output, so strip-wins now surface as mate-1 arrows with no
hint-layer special-casing.

**The unpoisoned numbers** (`sweep-starter-native.jsonl`, same 90-game grid,
third run of the series — plies med/mean/max):

| gap | shipped (rule-blind) | game-layer adjudicated | NATIVE (engine-aware) |
|---|---|---|---|
| 2 | 24 / 23.3 / 29 | 19 / 19.0 / 29 | **15 / 15.5 / 26** |
| 3 | 31 / 31.2 / 50 | 27 / 27.6 / 60 | **25 / 24.2 / 36** |
| 4 | 35 / 43.4 / 121 | 35 / 42.1 / 156 | **32 / 31.9 / 46** |

- **90/90 decisive, zero errors, zero starter losses.** The two
  crumble-lottery losses from the game-layer run are gone — games end
  before crumble onset ever arrives (zero crumbles fired in the entire
  sweep, and in the arena verification below).
- **The gap-4 grind was an artifact of the rule-blind engine.** Max ply at
  gap 4 fell from 121–156 to 46: a strip-hunting winner closes before the
  eliteR siege can develop. The "reserve gap 4 for pawnless enemies" knob
  recorded earlier is largely obsolete — retained only as a soft preference.
- **Sub-20-ply games: 5 → 29 → 37 of 90.** Terminations: 59 bare-king,
  27 checkmate, 4 stalemate — stripping is the canonical duel ending, mate
  the sharp exception, exactly the design fiction.
- Arena verification under native: ALL PASS, dramatically tighter — first
  duel 21/21/21 plies, ambush 26–30, clipped vault 27/27/27 (the fat tail
  that once reached 103 is gone), long stair 27–33. Zero crumbles.

Methodological lesson, recorded for §7: **calibration data is only valid if
the sweep engine plays under the exact shipped ruleset.** Two full sweep
generations were measured under rules that differed from the live game
(rule-blind, then game-layer-adjudicated); both are superseded by
`sweep-starter-native` and kept only as the before/after record.
 This is a result-level carve-out in the §2 crumble family: every
position the engine sees remains FSF-pure, and under the no-draw config the
adjudicated result matches the game-theoretic one (a bare king cannot win —
only a filter-miss-grade anomaly could save it).

**Measured effect** (`sweep-starter-bk.jsonl`, same 90-game grid):

| gap | plies med/mean/max (old) | plies med/mean/max (bare-king) |
|---|---|---|
| 2 | 24 / 23.3 / 29 | **19 / 19.0** / 29 |
| 3 | 31 / 31.2 / 50 | **27 / 27.6** / 60 |
| 4 | 35 / 43.4 / 121 | 35 / 42.1 / 156 |

- **64/90 games ended by the adjudication** — stripping the army is now the
  normal way duels end, which is exactly the fiction (the army IS the
  summoning).
- **Sub-20-ply games went from 5/90 to 29/90.** Pawnless scraps die fastest
  (one game: 5 plies — rook eats both pieces, done). The under-10-moves
  puzzle target is now the common case at gap 2, not the lower tail.
- **Gap 4 is untouched** — its grind happens while both sides still have
  material, before any strip. The rule cuts chases, not sieges.
- **The engine chases no phantom outcomes under the adjudication** (probed):
  K+N vs bare K under the duel config reads **mate-in-11** to the engine —
  walls + stalemate-as-loss make even chess's "book draw" endings forced
  wins in-grammar, so there is no insufficient-material draw-scoring path.
  The engine's rulebook and the adjudicated game disagree only about WHEN a
  stripped side dies, never about who is winning.

**The two starter losses (2/90, both g4 vs eliteR) are crumble-lottery, not
rule artifacts:** in both, a pacing crumble ate the STARTER'S ROOK (R@a2
ply 64; r@b6 ply 40) and the eval flipped to mate-against on the spot; one
game then ended by adjudication, the other by the classic path. Cause:
onset 40 is "late and rare" for a 25-ply puzzle but MID-GAME for a gap-4
rook fight. Knobs, designer's choice: (a) reserve gap 4 for pawnless/light
enemies (the shipped arena04 matchup is clean there — pawnless armies
can't outlive onset), keeping rook-bearing enemies at gap ≤ 3 (shipped
arena03 already is); (b) scale crumble onset with gap in Phase 2's
generated duels (e.g. onset ≈ 40 + 10·(gap−2)); (c) tighten the trigger cap
to gap ≤ 3 and drop the long-gap encounter class entirely.
