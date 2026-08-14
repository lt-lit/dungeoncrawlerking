# Spike 4 — Dual loss condition: checkmate OR king capture

> **Superseded post-Phase-1:** the shipped baseline is now the native
> bare-army quartet (`extinctionPieceTypes=*`, `extinctionPieceCount=1`,
> `extinctionPseudoRoyal=false`) — army extinction replaced king capture as
> the second loss condition, and the engine plays for strips. The spike was
> re-run 25/25 under the new config (fixtures un-bared — bare-king victims
> are decided at load). Finding 3's "capture ends the game immediately" was
> also found to hold only for bare victims; kingless-with-material states
> are adjudicated at the game layer. See
> `results/sweep-starter-findings.md`. Historical record below.

**Question (§9.4):** "Find the cleanest config (check rules vs. extinction-style king
capture) and verify the engine plays sanely under it. Expected answer:
`extinctionValue = loss` + `extinctionPieceTypes = k` + `extinctionPseudoRoyal = true`."

**Script:** `spikes/spike04-dual-loss-condition.mjs` (25/25 checks pass).
**Builds:** ffish.js `Fairy-Stockfish 010526 LB`; engine WASM `Fairy-Stockfish 5589ea54 LB`; classical eval (`Use NNUE=false`).

## Verdict: PASS — the expected config is confirmed and fully characterized.

## Findings

1. **King-safety semantics under the pseudo-royal trio are exactly normal chess:**
   moving into check is illegal, pins are enforced, `isCheck()` works, in-check
   positions only offer evasions. The player-facing duel feels like chess.
2. **Checkmate path:** SAN renders `#`; the engine reports `score mate N` and finds
   mate-in-1; after mate `numberLegalMoves()===0` and `result(false)` returns the
   decisive result. Verified from both colors.
3. **King capture path (the §4.5 post-surgery safety net):** ffish *accepts*
   king-en-prise positions (`validateFen=1`, position "ongoing"), king capture is
   simply a legal move, and after `QxK` the game is immediately over with the
   extinction result (`numberLegalMoves()===0`, correct `result`). The engine plays
   the capture and scores it `mate 1`. **Failure mode if spike 12's crumble filter
   ever misses an exposure: the game degrades to an instant, correctly-attributed
   win — no crash, no corruption.**
4. **In normal play king capture is unreachable** (into-check remains illegal), so
   "checkmate OR king capture" = chess semantics + a graceful terminal state for
   surgered positions. Exactly what the brief wanted.
5. **No middle ground exists:** `extinctionPseudoRoyal=false` does NOT de-royalize
   the king (into-check stays illegal — the chess template's king is inherently
   royal). A true capture-the-king variant would require redefining the king as a
   commoner (`king = -`, `commoner = k`, as FSF's shipped `extinction` variant
   does), discarding check/checkmate semantics wholesale. Not what we want.
6. **Stalemate = loss works end-to-end:** corner stalemates return decisive
   results for both colors; the engine *scores delivering stalemate as `mate 1`*
   (proven via `searchmoves` restricted to the stalemating move). The engine will
   actively steer into stalemating a cornered king — the "floor gives way" rule
   (§4.4/§4.5) is real for the engine, not just the adjudicator.

## Design implications

- Ship the baseline as `lib/variant.mjs` emits it: `extinctionValue=loss`,
  `extinctionPieceTypes=k`, `extinctionPseudoRoyal=true`, `stalemateValue=loss`.
- Harness/game code should treat `numberLegalMoves()===0` → `result(false)` as the
  game-end protocol (see spike 11 for why `isGameOver()` must not drive the loop).
- The threat-display/tutorial layer can present duels as ordinary chess: check,
  checkmate, and stalemate-as-loss are the only player-visible rules.
