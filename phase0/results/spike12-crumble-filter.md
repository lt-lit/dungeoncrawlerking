# Spike 12 — Crumble legality filter

**Verdict: PASS**

Builds: ffish.js `Fairy-Stockfish 010526 LB` (filter is pure ffish — no engine involved).

Scripts: `spikes/crumbleFilter.mjs` (the reusable deliverable — the harness imports `validateCrumbleCandidate` / `collapseFen` / `resetCrumbleFilterCache` from it), `spikes/spike12-crumble-filter.mjs` (tests + benchmark, deterministic, seed 20260813). Spike 11's crumble game already uses this filter live.

## Question

Brief §9.12: "**Crumble legality filter.** Validate candidate collapse squares via ffish.js (§4.5): detect exposed-king and instant-end positions cheaply enough to re-roll in real time on a phone." Per §4.5: "Re-roll any candidate that would expose the side-not-to-move's king (an illegal position under king-capture rules — a duel must never be decided by a dice roll in one ply) or that would instantly end the game by mate or stalemate."

## Method

`validateCrumbleCandidate(ffish, variant, fen, square) → {ok, reason, collapsedFen?}`:

1. Structural rejects: off-board, already `*`, or either king's current square (occupant check on the FEN).
2. Collapse transform: `collapsedFen = clearEp(setSquare(fen, square, '*'))`; `validateFen` guard.
3. **Exposure**: flip the FEN's turn field; if the original side-not-to-move, put on the move, is `isCheck()`, their king was capturable by the actual mover → reject `exposes_king`.
4. **Instant end**: on the collapsed FEN, `numberLegalMoves() === 0` → reject `instant_checkmate` / `instant_stalemate` (split by `isCheck()`); else `result(false) !== '*'` → reject `instant_result(...)` (catch-all for any other immediate adjudication).

Tested against constructed positions on 8x8 duel variants (baseline + one with a `cannon` for the hopper case) and benchmarked on a 10x10, 6-wall midgame position (16 seeded-random plies from a `buildDuelBoard` start). 27/27 checks pass; exit 0.

## Findings

**API surface (why these calls):**

- Under `extinctionPseudoRoyal`, a position with the non-mover's king en prise is *not* an end state: `result(false) = '*'`, `isGameOver(false) = false`, and the king capture (e.g. `a8e8`) is simply one of the legal moves. So exposure **cannot** be detected via game-end APIs; scanning move targets for the king square would work but is string-parsing on largeboard coordinates. The **flipped-turn `isCheck()` probe** is one cheap board load and works because pseudo-royal keeps normal check semantics (verified: check/checkmate detection behaves classically on the duel config).
- `numberLegalMoves()` + `isCheck()` + `result(false)` cover every instant end. Under `stalemateValue=loss`, ffish correctly scores a constructed stalemate as `0-1` — both mate and stalemate are zero-move losses and both are rejected.

**Rejection tests (all pass):**

- *Exposure, in-play-reachable, empty candidate*: white cannon e1, empty e-file, black king e8 — collapsing empty **e4** gives the cannon a hurdle (walls **do** count as hoppers' hurdles in FSF) and puts the black king en prise → `exposes_king`.
- *Exposure, occupied candidate*: artificial already-exposed position (black king en prise to Ra8, white to move), candidate = an occupied pawn square → `exposes_king` (detector fires regardless of how the exposure arose).
- *Instant checkmate*: Ka1 in check from ra8, b2 already a pit, sole escape b1; collapsing **b1** → `instant_checkmate`.
- *Instant stalemate*: Ka1 vs kc2, sole move a2; collapsing **a2** → `instant_stalemate`.
- *Any-immediate-result*: eating the last non-king piece (K vs k+p, collapse the pawn) → `instant_result(1/2-1/2)` — **ffish adjudicates bare-kings insufficient material as an immediate draw even with `claimDraw=false`, `nMoveRule=0`, `nFoldRule=0`**. The filter's catch-all rejects the collapse, which is the right call (and keeps "no draws" true at the harness layer).
- *Structural*: both kings' squares, an existing wall, and an off-board square all rejected with distinct reasons.

**Acceptance tests (no over-rejection):**

- Normal empty square and normal occupied square (pacing crumble eating a pawn) accepted; returned `collapsedFen` has the wall, the occupant gone, and `ep = '-'`.
- A collapse that merely gives **check** to the side to move (cannon behind the new wall, escapes exist) is accepted — crumbles may pressure, only instant ends are barred.
- Repetition-crumble edge: after `g1f3`, the vacated **g1** is empty in the FEN and validates through the empty-square path. Both occupied and empty paths exercised throughout.

**A useful theorem (probe-verified by the shield test):** the collapse transform never reduces a square's occupancy (piece → wall, empty → wall), so for pure sliders/leapers the post-collapse attack set is a subset of the pre-collapse one — **piece-eating crumbles cannot expose a king through the eaten square, because the pit itself blocks the line** (verified: eating a knight shielding a rook's file is *accepted*, and the rook remains blocked by the wall). New attacks can only be *created* for hopper pieces (cannon family), whose attacks a new hurdle enables. With the baseline chess piece set the exposure check is pure defense-in-depth; it becomes load-bearing the moment cannon-like content ships. Keep it always-on — it costs ~40% of an already-cheap validation.

**Timing (10x10, 6 terrain walls, midgame, this Node environment):**

- Naive implementation (fresh `new ffish.Board` per probe): **7.7 ms/candidate** — dominated by ~4 ms fixed embind/alloc cost per Board construction (board-size independent).
- Final implementation (one cached Board per variant, `setFen()` reuse at ~0.013 ms): **0.42 ms/candidate, ~2,400 candidates/sec** (loaded 4-CPU box, timing conservative).
- Re-roll realism: 200 seeded crumbles resolved at **1.08 rolls/crumble** average, **0.40 ms per resolved crumble**.
- Phone budget at the assumed 5-10x slowdown: **~2-4 ms per candidate, ~4 ms per resolved crumble** worst case → a handful of re-rolls fits comfortably within a few ms. **The budget holds.**

## Verdict

**PASS** — all §4.5 rejection classes detected, no over-rejection, and the filter is ~25x under the phone budget after the Board-reuse optimization.

## Design implications

- Harness and live game should import `validateCrumbleCandidate` from `spikes/crumbleFilter.mjs` (promote to `lib/` when lib freezes) and use the returned `collapsedFen` directly as the post-crumble position — it already has the wall, the removal, and the ep clear.
- **Never construct throwaway `ffish.Board`s in hot paths**: construction costs ~4 ms flat; keep one Board per variant and `setFen()` it (the filter does this internally; call `resetCrumbleFilterCache(ffish)` if a variant name is ever re-registered with different rules).
- Game-end detection elsewhere in the harness must not treat `isGameOver(false)`/`result(false)` as gospel: ffish immediately adjudicates bare-kings as `1/2-1/2` regardless of the no-draw config. Primary end condition: `numberLegalMoves() === 0` (+ extinction). The filter's `instant_result` reject already prevents *crumbles* from ever creating that state.
- Pacing-crumble scheduler: re-roll on any reject; expect ~1.1 rolls per crumble midgame. If one crumble flavor has no valid candidate (endgame edge), fall back to the other flavor (see spike 11).
- The exposure check must stay enabled even for pure-chess piece sets (cheap defense-in-depth), and is mandatory before shipping any hopper/cannon piece — walls count as their hurdles, so a crumble can genuinely conjure an attack out of thin air.
- No changes to the baseline variants.ini block are needed for the filter; it works against the spike-4/11 config as-is (`stalemateValue=loss`, `extinctionValue=loss`, `extinctionPieceTypes=k`, `extinctionPseudoRoyal=true`, `nMoveRule=0`, `nFoldRule=0`).
