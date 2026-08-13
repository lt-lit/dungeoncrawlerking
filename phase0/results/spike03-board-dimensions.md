# Spike 3 — Variable board dimensions per duel

**Verdict: PASS**

Builds: ffish.js `Fairy-Stockfish 010526 LB by Fabian Fichter`; engine WASM `fairy-stockfish-nnue.wasm` (`id name Fairy-Stockfish [commit: 5589ea54, upstream: , emscripten: 2.0.26] LB`), run with `Use NNUE = false` (classical eval only, §2.3).

Script: `spikes/spike03-board-dimensions.mjs` (deterministic — fixed formations, fixed-depth single-threaded searches).

## Question

Brief §9.3: "**Variable board dimensions per duel** (3–12 files x 6–10 ranks), including the small/clipped end. Confirm the shipped WASM artifact is the **largeboard** flavor (the pychess build is; 8x8-only builds float around)."

## Method

- **Sweep**: all 24 combos of files {3,4,5,8,10,12} x ranks {6,7,8,10}. Each combo: generated `[dFxR:chess]` variant via `makeDuelVariantIni` (baseline §4.4 rules, `startFen` included, e.g. `maxFile = 12` / `maxRank = 10` / `promotionRegionWhite = *10` / `promotionRegionBlack = *1`), a clipped centered formation (patch width min(files,5): 3-wide = N,K,B; 4-wide = R,N,K,B; 5-wide = R,N,K,B,Q; automatic pawn rows), FEN-level `*` walls mid-gap on boards ≥6 files & ≥8 ranks. Checks per combo: `validateFen` == 1, ffish `legalMoves()` count == engine `go perft 1`, depth-6 search returns an ffish-legal bestmove and a sane score.
- **Gap band (§4.4/§5.3)**: 2+2 formations on 8x10 and 8x6, gap measured from the FEN (empty ranks between the pawn rows), then 12 plies of engine self-play at depth 6 with every move legality-checked by ffish.
- **Degenerate probes** on a fresh "risk" engine instance (so a crash could not poison the sweep): within-caps 2x8, 1x8, 8x5 (gap 1), 8x4 (gap 0), 8x3; beyond-caps `maxFile = 13` and `maxRank = 11` in both libraries, followed by health checks.

## Findings

### Largeboard confirmed (experiment 3)

- ffish version string: `Fairy-Stockfish 010526 LB`; engine: `Fairy-Stockfish [commit: 5589ea54 ...] LB` — both carry the LB (largeboard) tag.
- Working 12x10: `d12x10` with two walls validated, ffish 24 == perft-1 24, depth-6 bestmove `d1b1`, score cp 46. (Spike 1 additionally perft-2'd a 12x10 at 456=456.)

### Dimension sweep: 24/24 combos PASS

Every combo: `validateFen=1`, ffish count == engine perft-1, legal bestmove, plausible near-balanced score (symmetric formations):

| files x ranks | walls | legal moves | bestmove | score (cp, mover POV, depth 6) |
|---|---|---|---|---|
| 3x6 | - | 7 | b2b3 | 38 |
| 3x7 | - | 7 | b2b4 | 84 |
| 3x8 | - | 7 | b2b4 | 15 |
| 3x10 | - | 7 | b2b4 | 46 |
| 4x6 | - | 10 | c2c3 | 38 |
| 4x7 | - | 10 | a2a4 | 53 |
| 4x8 | - | 10 | a2a4 | 7 |
| 4x10 | - | 10 | c2c4 | 15 |
| 5x6 | - | 12 | a2a4 | 53 |
| 5x7 | - | 12 | b1c3 | 69 |
| 5x8 | - | 12 | a2a4 | 7 |
| 5x10 | - | 12 | a2a4 | 69 |
| 8x6 | - | 18 | f2f4 | 146 |
| 8x7 | - | 18 | b1a1 | 130 |
| 8x8 | e5+c5 | 18 | b1a1 | 69 |
| 8x10 | e6+c6 | 18 | b1a1 | 92 |
| 10x6 | - | 21 | g2g4 | 53 |
| 10x7 | - | 21 | c1a1 | 53 |
| 10x8 | f5+d5 | 21 | e2e3 | 23 |
| 10x10 | f6+d6 | 21 | e2e3 | 61 |
| 12x6 | - | 24 | h2h4 | 76 |
| 12x7 | - | 24 | e1f3 | 53 |
| 12x8 | g5+e5 | 24 | d1b1 | 38 |
| 12x10 | g6+e6 | 24 | d1b1 | 46 |

- **The 3-wide floor (§5.3) works everywhere**: 3x6 through 3x10 all validate, cross-check, and search sanely. Scores in the whole sweep stay in cp 7–146 from symmetric starts — no eval blow-ups at any size.

### Gap band (experiment 4)

- 8x10, 2+2 formations at both walls: FEN `1rnkbq2/1ppppp2/8/8/8/8/8/8/1PPPPP2/1RNKBQ2` — measured **gap = 6** exactly as §4.4 promises at the 10-rank cap. 12/12 self-play plies legal (line `b1a1 c10d8 f1h3 f9f8 c1d3 f10f9 h3g3 b9b8 f2f3 f9d7 g3g4 d7g4`) — note ranks 9/10 move notation works fine.
- 8x6: FEN `1rnkbq2/1ppppp2/8/8/1PPPPP2/1RNKBQ2` — measured **gap = 2**, the trigger-condition floor (§5.3 kings ≥5 tiles apart → gap ≥2). 12/12 self-play plies legal.
- Both extremes of the §4.4 band (gap 2 ambush-sharp, gap 6 ranged-friendly) fit FSF and play out under one ruleset.

### FSF's actual hard limits (experiment 2)

- **Beyond caps → silent rejection, no crash, no error message.** `maxFile = 13` and `maxRank = 11` (as `[bad13:chess]` / `[bad11:chess]`): engine emitted **no** chatter on the VariantPath load, returned `readyok` normally, and the variant simply **never appears** in the `UCI_Variant` combo (re-`uci` confirms). ffish `loadVariantConfig` likewise: no exception, no console output, name absent from `ffish.variants()`. Both libraries stayed fully healthy afterwards (fresh 4x6 / 5x7 variants loaded and perft-matched: 10=10, 12 legal). **Exact failure mode: config silently dropped** — the only detection is checking for the variant's presence after load.
- **No meaningful lower limit.** Everything below the design floor still works mechanically, cross-checks exactly, and searches sanely:
  - 2x8 (K,R + 2 pawns each): 4=4, best `b2b4`, cp 15.
  - 1x8 (`k/1/1/1/*/1/1/K`, wall mid-file): 1=1 (the single legal king step), best `a1a2`, cp 0.
  - 8x5 (full formations, gap 1): 13=13, best `d2d3`, cp 130.
  - 8x4 (full formations, gap 0 — pawn rows in contact): 16=16, and the engine announces **mate 1** (`b2c3`) from the symmetric start: gap-0 boards are decided on the spot.
  - 8x3 (back ranks 1 rank apart, pieces only): 11=11, best `d1d2`, cp 15.
  - So FSF supports 1..12 files x 1..10 ranks; the 3-wide duelable floor and the gap ≥ 2 trigger are **design** rules, not engine limits — and the 8x4 mate-in-1 is direct evidence the gap ≥ 2 trigger is load-bearing.

## Verdict

**PASS** — both shipped artifacts are largeboard; every dimension in the design envelope (3–12 files x 6–10 ranks) validates, cross-checks exactly between ffish and the engine, and searches sanely, including the 3-wide clipped floor and 12x10 max with walls; the §4.4 gap math (gap 2 at 6 ranks, gap 6 at 10 ranks) is exactly realized and playable at both extremes.

## Design implications

1. The full §4.1/§4.2 envelope is safe: harness may generate any `maxFile` ∈ [3,12] x `maxRank` ∈ [6,10] freely. Exact config lines per duel (from `makeDuelVariantIni`), e.g. the 12x10 max:
   ```
   [duel_n:chess]
   maxRank = 10
   maxFile = 12
   castling = false
   stalemateValue = loss
   nMoveRule = 0
   nFoldRule = 0
   extinctionValue = loss
   extinctionPieceTypes = k
   extinctionPseudoRoyal = true
   promotionRegionWhite = *10
   promotionRegionBlack = *1
   startFen = <generated formation FEN>
   ```
2. **Clamp dims at generation time and verify presence after load.** Out-of-range dims are dropped *silently* by both libraries — the failure would otherwise surface later as "unknown variant" at `UCI_Variant`/`Board` time. Keep the hard throw in `makeDuelVariantIni` (already there) and add an `ffish.variants().includes(name)` assert per load (same guard recommended in spike 1).
3. The linter/trigger (§5.3, §6) is the sole guardian of the small end: FSF happily plays 1- and 2-wide boards, so nothing downstream will error if a crawlspace duel slips through — it will just be a degenerate fight. Keep the ≥3-wide rule enforced in game code.
4. Gap ≥ 2 is confirmed load-bearing: at gap 0 a symmetric formation start is mate-in-1 for White. Never generate below gap 2 (§5.3's ≥5-tile king distance guarantees this).
5. Depth-6 search cost was interactive-fast across the whole envelope on desktop-class WASM (all 24 sweep searches + 24 self-play plies completed in seconds total); phone-side numbers are spike 8's job.
