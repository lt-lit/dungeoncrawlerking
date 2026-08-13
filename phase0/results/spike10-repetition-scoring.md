# Spike 10 — In-search repetition scoring

**Script:** `spikes/spike10-repetition-scoring.mjs` (deterministic, no RNG; 32/32 checks, exit 0)
**Builds:** ffish.js = `Fairy-Stockfish 010526 LB`; engine WASM = `Fairy-Stockfish [commit: 5589ea54, emscripten: 2.0.26] LB`. Classical eval only (`Use NNUE = false` set before every search; §2.3).

## Question

Brief §9.10: *"In-search repetition scoring `[load-bearing — do first]`. With `nFoldRule = 0`, confirm the engine does not privately score repetition lines as draws inside search (Stockfish-lineage cycle detection is separate from the rule). If that belief survives config, a losing engine will deliberately loop and farm crumbles — the exact failure §4.5 forbids. Plan B if un-disableable: set `nFoldValue = loss` so the engine believes looping loses, and fire the repetition crumble at the second occurrence — history resets before the in-engine rule can ever adjudicate a third."*

## Method

Two hand-built positions where the side to move is dead lost but holds a **fully forced** perpetual (verified: the defender has exactly one legal reply to every check, cross-checked ffish `legalMoves()` vs engine `go perft 1`):

- **Knight loop** (8×8 duel arena, walls `a7 b7 c7 c8` box the black king onto a8/b8; only a leaper can check — walls block all slider lines):
  `k1*5/***N4/8/7r/6rq/8/K7/8 w - - 0 1` — White Ka2+Nd7 vs Black Ka8+Qh4+Rg4+Rh5 (White down ~16 pawns). Forced loop `Nb6+ Kb8 Nd7+ Ka8` (4-ply cycle). Position classes: S=(Nd7,Ka8,w) root, A′=(Nb6,Ka8,b), W1=(Nb6,Kb8,w), B1=(Nd7,Kb8,b).
- **Queen perpetual** (plain 8×8, also runs on built-in `chess` as control):
  `6k1/6p1/8/8/1r6/8/4Q2K/q7 w - - 0 1` — White Kh2+Qe2 vs Black Kg8+g7+Qa1+Rb4 (down a rook). Forced `Qe8+ Kh7 Qh5+ Kg8 …`.

Config matrix as generated variants (all on the `makeDuelVariantIni` baseline: `stalemateValue=loss`, `nMoveRule=0`, extinction trio, castling off): `duela` = brief's Plan A (`nFoldRule=0`, value default draw); `duelctl` = control (`nFoldRule=3, nFoldValue=draw`); `duelb` = brief's Plan B as written (`nFoldRule=3, nFoldValue=loss`); `duelb0` = `nFoldRule=0, nFoldValue=loss`; `duelbabs`/`duelbabswin` = `nFoldRule=3, nFoldValueAbsolute=true, nFoldValue=loss/win`. Searches at depths 8–16, both full search and `go … searchmoves <loop-entry>` to isolate the loop line's score; game-history variants fed via `position fen … moves <cycles>`; ffish adjudication stepped ply-by-ply.

## Findings

**1. Plan A as specified is DEAD.** Under `duela` (`nFoldRule = 0`) the losing side scores its forced loop **cp 0 at every depth (8, 10, 12, 14, 16)**, PV is exactly the loop, and full search *prefers* it (`bestmove d7b6` / `e2e8`) from a −16 position. Identical with game history holding a 2nd real occurrence. There is no UCI option to switch this off (scanned `uci` output for fold/repetition/draw/cycle: none). Stockfish-lineage in-search repetition/cycle draw-scoring is active regardless of `nFoldRule` — the exact crumble-farming failure §4.5 forbids: engine shuffles forever "holding" 0.00.

**2. Controls validate the method.** Built-in `chess` and `duelctl` (rep draws live) score the same loops cp 0 — so the harness detects draw-seeking when it exists; and `duelctl` proves the walled-arena loop behaves like the classical one.

**3. Plan B as written in the brief (symmetric `nFoldValue = loss`, `nFoldRule = 3`) is WORSE than Plan A — do not ship it.**
- Real-game semantics (ffish, `duelb`): adjudication at the 3rd occurrence of a position (ply 8 of the loop); result `0-1` with White to move, `1-0` in the mirrored loop with Black to move ⇒ **the side to move in the thrice-occurred position loses; the mover who completes the 3rd occurrence wins**. It is an *optional* end: `result(claimDraw=true)` reports it, `result()` reports `*`.
- In-search semantics: FSF adjudicates at the **first 2-fold whose earlier occurrence lies inside the search tree** (upstream 2-fold-repetition scoring, generalized to `nFoldValue`), and the mover completing the repeat controls the parity. Measured: the dead-lost side scores its own forced loop **mate +3** and full search **chases it** (`bestmove d7b6`, "mate 3" while down Q+2R). With a live-reachable history containing one old occurrence of an opponent-to-move position, the lost engine finds "mate 3 via b6d7" — it would actively steer into repetitions, farming a crumble on every attempt.
- `nFoldValueAbsolute = true` fixes the parity exploit: any repetition = fixed White-POV result (`0-1` under `loss`, `1-0` under `win`, confirmed in ffish for both loop parities). Engine test: same hazard history under `duelbabs` flips mate +3 to **mate −6** — the engine now treats every loop as losing and stops chasing. Winning side is unaffected (KQ vs K: mate found normally under both Plan B configs).

**4. THE FIX — "Plan A-prime": `nFoldRule = 0` + `nFoldValue = loss`.** Discovered via the config matrix:
- `nFoldRule = 0` disables repetition **adjudication** entirely (ffish: `isGameOver` false through 3 full cycles — `nFoldValue` is dead as a *rule* when `nFoldRule = 0`), preserving §4.4's LOCKED "repetition never adjudicates".
- A non-draw `nFoldValue` disables the **in-search draw-scoring path** (the cycle-detection/2-fold draw machinery only fires when the repetition value is a draw).
- Net effect: the engine **searches straight through repetition loops and returns the honest eval**. Measured (`duelb0`): knight loop cp **−1815/−1838/−1838** at depths 10/12/14 (PV is the loop, honestly labeled lost); queen perpetual cp **−707 to −715**; unchanged with occ2 or even occ3 already in game history; the symmetric-hazard history produces no chasing (cp −1838); KQ vs K still mates (mate 5). Every requirement of the brief's Plan A, achieved with one extra line.

**5. History reset on position surgery (crumble mechanics, engine side).** Same board position (B1), `duelb` config: reached via 7 plies of real history → **mate +1** (forced reply completes a real 3-fold); as a bare `position fen` root → **mate +6**. Sending the 7-ply history and then immediately a bare `position fen` **without `ucinewgame`** gives mate +6 ⇒ **a bare `position fen` fully resets repetition history**. TT probe: no-clear vs clean-hash searches agree — no stale adjudication leaked through the transposition table in this test.

**6. lib note:** RESOLVED — `lib/variant.mjs makeDuelVariantIni` now emits `nFoldValue = loss` in the baseline (A-prime is the default for every generated duel variant). The spike script pins its Plan A demonstration variant to the historical config (`extra: { nFoldValue: 'draw' }`) so the dead-config evidence keeps reproducing.

## Verdict

## Post-spike addendum (harness sweep, 2026-08-13)

**Operational hazard found in live sweeps — the A-prime search-runaway.** In a
shuttle-fortress position (bare-ish kings bouncing `a3a2/a7a8`, cp −69), the
absence of any repetition bound let iterative deepening race to depth 245
(MAX_PLY) inside the movetime, after which this WASM build **never emitted
`bestmove`** for `go movetime 150` — the search completed iterations in ~118 ms
and stalled at the depth ceiling. This never appeared in this spike's own tests
because they used bounded `go depth N` searches.

Fix (implemented in `lib/load.mjs` + sweep configs, required in live-game code):

1. **Watchdog:** if a `movetime` search overruns its budget by ~1.5 s, send UCI
   `stop` — the engine then emits its bestmove immediately.
2. **Belt-and-braces:** pair limits — `go depth 60 movetime N` — so degenerate
   positions stop at the depth cap long before MAX_PLY.

Design-level note: the position that triggered this is precisely the fortress
scenario §4.5's crumble system exists to demolish; the game design needs no
change, only the engine-interface guard.

**PASS_WITH_CAVEATS.** The brief's belief is refuted — in-search repetition draw-scoring survives `nFoldRule = 0` and cannot be switched off — and the brief's written Plan B is actively dangerous (losing engine chases repetitions as wins). But the design's intent is fully recoverable: **Plan A-prime (`nFoldRule = 0` + `nFoldValue = loss`) delivers exactly the specified Plan A semantics**, keeping §4.4 and the §4.5 crumble design unchanged.

## Design implications — definitive recommendation

**Ship this in every generated duel variant (harness and live game):**

```ini
nMoveRule = 0
nFoldRule = 0        # repetition never adjudicates a result (§4.4 LOCKED)
nFoldValue = loss    # dead as a rule (nFoldRule=0 kills adjudication), but its presence
                     # disables the engine's in-search repetition DRAW-scoring, so loops
                     # are searched through and scored honestly
```

- **Crumble-fire rule: 3rd occurrence** of a position (original Plan A rule, §4.5 unchanged). Position-history bookkeeping lives entirely in the harness (ffish will never report repetition game-ends under this config — track FEN-key occurrence counts yourself).
- **After every crumble:** send a bare `position fen <rewritten>` (no `moves`) — this alone resets the engine's repetition history (E5b); `ucinewgame` is not required (E5c), though harmless.
- **Update `lib/variant.mjs`** (coordinated, not done in this spike): add `nFoldValue: 'loss'` to the `makeDuelVariantIni` baseline.
- **Do NOT use** `nFoldValue = loss` with `nFoldRule = 3` (symmetric Plan B as the brief sketched it): in-search 2-fold adjudication + mover-controlled parity turns every forced loop into a believed WIN for the shuffler.
- **Fallback** if a future FSF build changes the `nFoldValue`/cycle-detection interaction (re-run this spike per engine upgrade — it is the regression test): **Plan B-absolute**, generated per duel so any repetition = engine side loses: `nFoldRule = 3`, `nFoldValueAbsolute = true`, `nFoldValue = loss` when the engine plays White / `win` when it plays Black; crumble at the **2nd** occurrence, and history-reset before any real 3rd occurrence can be adjudicated.

**Residual risks:**
1. Plan A-prime's key behavior (`nFoldValue` gating the in-search draw path) is an interaction of internals, not documented API — pin it with this spike on every engine/ffish upgrade.
2. Under A-prime a dead-lost engine may still *play* the perpetual (its PV is the loop at cp −1838 — nothing better exists). That is the design's sanctioned outcome: the eval is honest, the 3rd occurrence fires a crumble, history resets, each loop costs a square, and §4.5's termination guarantee does the rest. It is not the forbidden failure (holding 0.00 / believing it saves the game).
3. TT leak-through after history reset was clean in one probe (E5c) but was not stress-tested across many surgeries; if sweeps (spike 11 / §7) ever see stale mate scores after crumbles, add `ucinewgame` + `isready` per crumble as the cheap cure.
