# Spike 11 — Mid-game position surgery

**Verdict: PASS**

Builds: ffish.js `Fairy-Stockfish 010526 LB`; engine WASM `fairy-stockfish-nnue.wasm` (Fairy-Stockfish commit 5589ea54, largeboard), run with `Use NNUE = false` (classical eval only, §2.3).

Script: `spikes/spike11-position-surgery.mjs` (deterministic, seed 20260813). Uses the spike-12 filter `spikes/crumbleFilter.mjs` to vet collapse candidates — the same coupling live play will use.

## Question

Brief §9.11: "**Mid-game position surgery.** Edit FEN between plies (add walls, remove a piece, clear ep), reload, and confirm the engine continues sanely from arbitrary rewritten positions. Core infrastructure: live crumbles and §7's crumble simulation both stand on it."

## Method

- Generated a 9x8 duel variant (`[duel11:chess]` via `makeDuelVariantIni`: castling=false, stalemateValue=loss, nMoveRule=0, nFoldRule=0, extinction k + pseudo-royal, per-color promotion regions) with a 5-wide formation `startFen` containing **no walls**. Terrain walls `d4,f5` were injected only into the game FEN (`setSquare(fen, sq, '*')`).
- Engine self-play at depth 6 (depth 10 past ply 100), one `ucinewgame` per move for path-independence; an ffish `Board` tracked the game and was the sole FEN source of truth (`board.fen()`).
- From ply 20, a crumble cadence loop every 3 plies (every 2 past ply 80), alternating **wall-on-empty-square** and **eat-a-piece** (square → `*`, occupant removed), ep cleared each time; candidates vetted with `validateCrumbleCandidate`; ffish board rebuilt fresh from the rewritten FEN; engine re-fed via `position fen` + `go`.
- Wall-semantics and perft checks on constructed and surgered positions.

## Findings

- **Full crumble game, no crashes**: 110 plies, **35 surgeries** in one continuing game (25 wall-adds, 10 piece-eats, 0 skipped). Every one of the 110 engine bestmoves was legal per a fresh ffish board on the current (surgered) FEN; every score was finite/sane (110/110 `cp` within bounds or mate scores). ep field was `-` after all 35 surgeries.
- **The game completed by the §4.4 stalemate rule**: final FEN `****2***/1*1**1*2/3****1*/*1*2***1/1***2*2/1k**2***/1**n**1*1/K1*3*2 w - - 42 56` — white king out of moves on the eroded arena, `result() = 0-1`. This is the §4.5 termination guarantee working end-to-end: erosion + stalemateValue=loss provably ends the duel with no adjudication.
- **Walls are FEN-level, not config-level (load-bearing assumption confirmed)**: variant `startFen` had no walls; `validateFen` returned 1 for wall-bearing FENs of the same variant; `legalMoves`/`legalMovesSan` counts matched (18/18) with no move landing on a wall; `board.fen()` round-trips `*` squares exactly.
- **Wall semantics match pit fiction (§4.5 Notes)**, verified on constructed positions:
  - Rook on a1 under a surgered wall a4: a-file moves exactly `a1a2,a1a3` — blocked at the pit; no legal move of either side lands on a wall square.
  - Knight on d4 ringed by 8 surgered walls: all 8 jumps remain (`b3,b5,c2,c6,e2,e6,f3,f5`) — leapers jump clean over pits.
- **Engine and ffish agree exactly** (`go perft 1` vs `numberLegalMoves()`) on 8 surgered/constructed positions: start-with-walls 18=18, mid-game surgered 37=37, 35=35, 2=2, 17=17, final position 0=0, slider-block 10=10, knight-ring 13=13.
- **Pocket coexists with surgery**: on a drops variant (`pieceDrops=true, pocketSize=2, whiteDropRegion=*1 *2, blackDropRegion=*7 *8`), a FEN with pocket `[Nn]` **and** a surgered wall validated, generated 9 drop moves (`N@a1` etc.), and engine perft 1 matched ffish (25=25).
- Determinism: two consecutive runs produced the identical game line, surgery sequence, and final FEN.
- Minor observations (no lib bugs found):
  - `board.fen()` never exposed a set ep field during this game (FSF only records ep when relevant); `clearEp` is still applied unconditionally on every surgery, per §4.5.
  - ffish `result(false)`/`isGameOver(false)` adjudicate bare-kings insufficient material as an immediate `1/2-1/2` even with nMoveRule=0/nFoldRule=0 (see spike 12 findings). The game loop must treat "no legal moves" as the primary end condition and not blindly trust `isGameOver` — a K-vs-K arena is *not* over for our rules; crumbles keep eroding it until stalemate.
  - Harness note: when one crumble flavor has no filter-passing candidate (e.g. the only remaining eat would leave bare kings), fall back to the other flavor rather than stalling — the first version of this spike hit a livelock in K vs k+N exactly this way.

## Verdict

**PASS** — FEN surgery between plies is fully supported: the engine continues sanely from arbitrary rewritten positions (35 rewrites in one game), walls are pure FEN payload on an unchanged variant, wall semantics match the pit fiction, and engine/ffish move generation agree perfectly on surgered positions with and without pockets.

## Design implications

- The crumble pipeline is exactly: `newFen = clearEp(setSquare(board.fen(), sq, '*'))` → validate with the spike-12 filter → `new ffish.Board(variant, newFen)` → `position fen <newFen>` + `go`. No engine reload, no variant reload, no `ucinewgame` strictly required (we used it per-move for determinism; cheap either way).
- Ship one variants.ini block per duel with a wall-free `startFen`; walls (terrain and crumbles alike) live only in FENs. Baseline block (9x8 example, from `makeDuelVariantIni`):

  ```ini
  [duel11:chess]
  maxRank = 8
  maxFile = 9
  castling = false
  stalemateValue = loss
  nMoveRule = 0
  nFoldRule = 0
  extinctionValue = loss
  extinctionPieceTypes = k
  extinctionPseudoRoyal = true
  promotionRegionWhite = *8
  promotionRegionBlack = *1
  startFen = 2rnbkq2/2ppppp2/9/9/9/9/2PPPPP2/2RNBKQ2 w - - 0 1
  ```

- Game-end detection in the harness: check `numberLegalMoves() === 0` (then `result(false)` gives the winner) rather than trusting `isGameOver(false)`, which draw-adjudicates bare kings.
- The harness's crumble scheduler should re-roll within a flavor and fall back across flavors (pacing crumble can always place a wall even when no piece may be eaten).
- Reserve-slot upgrades (pockets) are compatible with crumble surgery — no special-casing needed.
