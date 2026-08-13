# Phase 0 — Spikes + harness skeleton: results

Phase 0 per brief §10: everything in §9, plus a calibration harness able to run
one sweep end-to-end. **Status: complete.** All 12 spikes have runnable,
deterministic scripts under `spikes/` (each exits 0 on pass) and per-spike
results docs under `results/`. The harness ran a 162-game sweep end-to-end.

**Builds validated throughout:** ffish.js 0.7.9 (`Fairy-Stockfish 010526 LB`),
engine `fairy-stockfish-nnue.wasm` 1.1.11 (`Fairy-Stockfish 5589ea54 LB`) — both
**largeboard**, both run client-side-compatible WASM, classical eval only
(`Use NNUE = false` — note it defaults to *true* in this build; the game must
always set it).

## Verdict per spike (§9)

| # | Spike | Verdict | Doc |
|---|---|---|---|
| 1 | Per-duel runtime variant loading | PASS | `results/spike01-runtime-variant-loading.md` |
| 2 | Wall squares at density (eval) | PASS | `results/spike02-wall-density-eval.md` |
| 3 | Variable board dimensions | PASS | `results/spike03-board-dimensions.md` |
| 4 | Dual loss condition | PASS | `results/spike04-dual-loss-condition.md` |
| 5 | Per-color promotionRegion | PASS | `results/spike05-promotion-region.md` |
| 6 | capturesToHand per-color? | PASS (answer: variant-wide only) | `results/spike06-captures-to-hand.md` |
| 7 | Clipped/asymmetric formations | PASS | `results/spike07-asymmetric-formations.md` |
| 8 | Mobile perf | PASS as proxy; device run pending | `results/spike08-mobile-perf.md` |
| 9 | Reserve-slot drop | PASS | `results/spike09-reserve-drop.md` |
| 10 | In-search repetition scoring | **PASS_WITH_CAVEATS — design-impacting** | `results/spike10-repetition-scoring.md` |
| 11 | Mid-game position surgery | PASS | `results/spike11-position-surgery.md` |
| 12 | Crumble legality filter | PASS | `results/spike12-crumble-filter.md` |

## The one design-impacting result: repetition (spike 10)

The brief's Plan A belief is **refuted**: with `nFoldRule = 0` alone, the engine
still privately scores repetition lines as draws inside search — a dead-lost
engine holds cp 0 by shuffling and would farm crumbles, the exact §4.5 failure.
The brief's written Plan B (`nFoldRule=3` + `nFoldValue=loss`) is **worse**: a
parity exploit makes the losing engine *chase* repetitions as forced wins.

**The fix ("A-prime") is one extra ini line: `nFoldRule = 0` + `nFoldValue = loss`.**
Rule 0 kills adjudication (§4.4's "repetition never adjudicates" stays LOCKED);
the non-draw value disables the in-search draw-scoring path. Verified: honest
evals through loops (cp −1815 while down material, no draw-holding), no
repetition-chasing, KQvK still mates, and a bare `position fen` resets engine
repetition history — which is exactly what crumble surgery sends. Crumble fires
on the **3rd occurrence** as originally designed. This config is now the
`lib/variant.mjs` baseline. §4.4/§4.5 of the brief need only a small annotation;
no design change.

## Other findings the brief should absorb

- **Variant names are single-use** (spike 1): same-name redefinition silently
  fails in BOTH libraries. But this doesn't matter, because…
- **The whole game needs only a fixed 50-variant catalog** (spikes 1, 3, 8):
  every rule except board dims lives in the FEN, so `duel_3x6`…`duel_12x10`
  (files 3–12 × ranks 6–10) covers every possible arena. One variants.ini,
  loaded once at boot in <1 s combined. Per-duel loading cost: zero.
- **Game end protocol: `numberLegalMoves() === 0` → the side to move loses.**
  Spike 11 found `isGameOver()` draw-adjudicates bare-kings insufficient
  material under the no-draw config; the sweep then showed `result(false)` does
  too — it labels a walls-sealed bare-king stalemate "1/2-1/2", masking
  `stalemateValue=loss`. But under the duel config every zero-moves state is a
  mover-loss (checkmate, stalemate-as-loss, post-king-capture alike), so game
  code derives the result itself and ignores ffish's draw labels entirely.
  Note the positive side of the same sweep games: open K-vs-K *keeps generating
  moves*, the duels continued under crumble pressure, and each ended when a
  crumble sealed a king — the §4.5 termination guarantee observed working
  end-to-end, three times.
- **King-en-prise states degrade gracefully** (spike 4): if the crumble filter
  ever misses an exposure, the position is "ongoing", king capture is a legal
  move, and capturing ends the game with the correct extinction result. Belt and
  braces confirmed.
- **Pawn double-step was silently asymmetric on non-8-rank boards** (spike 7):
  FSF's `doubleStepRegionBlack` default is the literal rank 7. Every generated
  variant now emits explicit per-color regions. Without this, most duels would
  have a hidden tempo bias.
- **Unknown config keys are silently ignored** (spike 6): a typo in a generated
  variant block produces legal-looking wrong rules. Generation-time key
  validation is cheap insurance.
- **Classical eval is trustworthy under walls** (spike 2): mirrored arenas stay
  within ±92 cp at 0–40% density, color-flips are exact, walls speed up search.
  The one real hazard is **disconnected arenas** (finite eval, no progress
  possible, no draw rule) — a §6 linter obligation, already prototyped as a
  BFS connectivity check in the harness.
- **UCI squares are 3 chars on rank 10** (`f10`): move parsing must use a square
  regex, not fixed offsets. (Bit the harness once; fixed.)
- **A-prime search-runaway guard is mandatory** (found by the sweep, addendum in
  the spike 10 doc): with no repetition bound, shuttle-fortress positions drive
  iterative deepening to MAX_PLY and `go movetime` may never return in this WASM
  build. Live code must pair limits (`go depth 60 movetime N`) and watchdog-`stop`
  an overrunning search (implemented in `lib/load.mjs`).
- **Threading: ship Threads=1** (spike 8): lazy-SMP is a net loss at duel search
  sizes. coi-serviceworker is still required (pthread build needs
  SharedArrayBuffer), and it must sit next to index.html (service-worker scope),
  not in a subdirectory.
- **Boss/upgrade shelf is engineering-ready** (spikes 6, 9): symmetric
  Necromancer (`pieceDrops` + `capturesToHand`) and one-shot reserve drop
  (`dropRegion<Color> = *1 *2`, pocket in FEN, captures do NOT refill) both
  validated including engine play and perft cross-checks.

## Harness (§7) — skeleton complete, one sweep run end-to-end

`harness/` runs engine-vs-engine self-play over a config grid: patch widths 3–5,
gaps 2–6, wall densities, per-side composition + arrangement archetypes
(balanced / queenCorner / rookFlanks / knightCore / scrambled). Per game:
seeded arena + crumble RNG (exact replays), full §4.5 crumble system (repetition
+ pacing triggers through spike 12's validated legality filter), eval tracking,
JSONL logging, and per-config summaries incl. the ply-length distribution vs the
20–40 target band and the **crumble alarm metric** (fraction of games where a
crumble flips the eval sign).

Sweep results: see `results/sweep-smoke-summary.md` (numbers below are from the
162-game smoke sweep at `movetime 150`, crumble onset 40 / cadence 8).

<!-- SWEEP-SUMMARY -->

## What Phase 0 explicitly did not settle

- Real-device numbers for spike 8 (page is ready: `spikes/spike08-mobile/`).
- Crumble onset/cadence calibration (P, k) — the smoke sweep is a pipeline
  proof, not a calibration; §7's real sweeps are Phase 1+ work once material
  budgets are being tuned.
- MultiPV variety, weakened-FSF winnability proxy (§7 items) — harness hooks
  exist but are unimplemented.

## Phase 1 go/no-go

**Go.** Every load-bearing §9 assumption held or was repaired with config-level
fixes. The Prime Directive survives intact: every duel state the engine sees is
expressible as variants.ini + FEN, crumbles included.
