# Dungeon Crawler King — repo guide

Design source of truth: `dungeon-crawler-king-prototype-brief.md`.
Phase 0 (spikes + calibration harness) is **complete** — read
`phase0/PHASE0-RESULTS.md` before touching anything engine-related; it
summarizes 12 verified spikes and the sweep results. **Phase 1 — the duel
vertical slice — is built and lives in `play/`** (hand-authored arena →
playable duel vs engine on a phone; placement UI, win/loss, promotion, live
Earthquakes; no overworld). See `play/README.md` for its layout and the arena
JSON schema. **The Board State Director (`play/js/director.mjs`) is CANON**
— Earthquakes (symmetric displacement + rare rising crumbles, NO repetition
rules) replaced the old crumble system in both the build and brief §4.5.
The §7 harness now runs the shipped Director, so its numbers describe the live
rules. Next per brief §10, a three-step Gods track before calibration resumes:
**Phase 1.1 — quake legibility ✅ done** (piece motion, sequenced quake
beats, persistent quake marks, + the landing-safety stopgap in
`play/js/threat.mjs`); **Phase 1.2 — the Gods debug overlay** (roll trace
with reason codes, candidate census, RNG-free probability getters, engine
eval delta per quake — build the instrument BEFORE changing what it
measures); **Phase 1.3 — redefine "symmetric"** (promote the stopgap to
"no new winning capture for either side", retune). Then **Phase 1.5 —
Director calibration** (the `harness/game.mjs` port is DONE; what remains is
the §6 promotion-reachability lint and settling the ramp numbers) — still gated
behind 1.3 so the sweeps are not burned twice — and finally **Phase 2 —
exploration slice**.

## Layout

- `play/` — the Phase 1 game (vanilla-JS ES modules, GitHub Pages). Phase 0
  modules are ported verbatim into `play/js/`; `play/vendor/` carries its own
  copy of the validated WASM builds; `coi-serviceworker.min.js` sits next to
  `play/index.html` (rule 10). `play/selftest.html` is the in-browser infra
  cross-check — keep it PASSing.
  `play/arenas/` holds the campaign ladder (`arena01`–`arena04`) and the test
  shelf (`test01`–`test15`: terrain structure, army shapes, and the scale
  extremes — 8×8 literal chess and the 12×10 FSF ceiling). **Arena validation
  is deliberately two-speed:** `loadArena` throws ONLY for what the engine or
  our own code cannot survive, and everything we merely believe about pacing
  and balance is a warning on `arena.warnings`. See the policy comment on
  `loadArena` before adding a check — the §4.2 patch caps and the gap cap were
  authoring guesses hardened into throws, and the gap cap was resting on
  retired-crumble-system sweep data this file already disowns.
  **Shelf terrain is GENERATED (`harness/gen-terrain.mjs`), never hand-drawn** —
  hand-drawn "random" walls come out symmetric, and the first pass proved it
  (nine scenarios with no walls, three mirror-symmetric, and a "rubble field"
  that was a period-3 lattice). The shelf holds density 0.143–0.300 and 48
  terrain-locked pawns across 14 of 15 scenarios, both deliberate: brief §6 puts
  generated density at 0.15–0.3 and says locked starts MUST stay in the test
  set. `verify-arena-schema.mjs` pins all of that. Campaign arenas are
  hand-tuned for a specific mate and are exempt.
- `phase0/lib/` — shared infra: `load.mjs` (Node loaders + UCI wrapper),
  `fen.mjs` (largeboard FEN editing: walls `*`, multi-digit runs, pockets),
  `variant.mjs` (duel variants.ini generator — the canonical rule baseline)
- `phase0/spikes/` — one runnable script per §9 spike (deterministic, exit 0 =
  pass). `crumbleFilter.mjs` is production-bound (validated §4.5 filter).
  `spike08-mobile/` is a static phone benchmark page (vendored WASM).
- `phase0/harness/` — §7 calibration harness: `sweep.mjs <config.json>` plays
  engine-vs-engine games, JSONL + summary out. **`game.mjs` drives the SHIPPED
  Director (`play/js/director.mjs`) — it is a structural mirror of
  `play/js/duel.mjs`'s pipeline, and must not diverge without a written
  reason.** Sweep configs take a `director` block; records carry `quakes` (not
  `crumbles`) plus the §7 metrics: quake eval-flip alarm rate, one-sided-stir
  count, and the locked-pawn trajectory (start→end — the Director's actual job,
  since only displacement can free a terrain-locked pawn).
  `harness/crumble.mjs` is RETIRED and imported by nothing; it survives only as
  the record of what the pre-Director sweeps in `results/` were measured under.
- `phase0/results/` — per-spike results docs + sweep outputs.

## Running things

```sh
cd phase0                      # npm deps live here (node_modules gitignored)
npm install                    # ffish + fairy-stockfish-nnue.wasm
node lib/selftest.mjs          # infra cross-check (ffish vs engine perft)
node harness/verify-arena-schema.mjs              # arena schema + validator policy (~50 ms, no engine)
node harness/verify-play-arenas.mjs               # encounter linter, campaign arenas (GATING)
node harness/verify-play-arenas.mjs --all         # + the 15 test scenarios (slow, informational)
node spikes/spike04-*.mjs      # any spike; PASS/FAIL lines, exit code
node harness/sweep.mjs harness/sweeps/tiny.json   # 2-game harness check
```

Engine stdout is huge — pipe through `tail`. Engine searches are CPU-bound;
run one sweep at a time.

## Hard-won rules (violating any of these reproduces a Phase 0 bug)

1. **Always `setoption Use NNUE false`** — it defaults to TRUE in this build;
   classical eval is a hard constraint (brief §2.3). `lib/load.mjs` does not
   do it for you.
2. **Never require the WASM packages directly** — use `loadFfish()`/
   `loadEngine()` (they hide global `fetch` during Emscripten init on Node 18+,
   and the engine package has no `main`).
3. **Duel rules come from `makeDuelVariantIni`** — its baseline carries the
   A-prime no-draw config (`nFoldRule=0` + `nFoldValue=loss`), the native
   bare-army extinction quartet (rule 4), per-color promotion AND double-step
   regions. Hand-written variant blocks silently lose these (unknown keys are
   silently ignored — validate).
4. **Game end = `numberLegalMoves() === 0`, and the side to move LOSES** —
   and the **bare-army rule is IN-GRAMMAR**: the baseline carries
   `extinctionPieceTypes=*` + `extinctionPieceCount=1` +
   `extinctionPseudoRoyal=false` (total-count semantics: down to your bare
   king = you lose), so the ENGINE plays for strips (scores them mate-1)
   and a bared side has zero legal moves — no game-layer check needed. The
   king stays fully royal (spike 4 finding 5); check/checkmate/stalemate
   are untouched; spikes 04+10 and selftest re-validated 25/25 + 32/32
   under this config. Consequences: (a) crumble candidates that would strip
   a side's LAST piece must be excluded (a crumble would instantly end the
   game); (b) test/spike fixtures must never use bare-king "victims" — such
   positions are decided at load (this bit four fixtures already); (c) the
   one state extinction cannot see — a captured king with material left
   (surgery-only) — is adjudicated at the game layer, termination
   `king-capture`. Never use ffish `isGameOver()`/`result()` to drive game
   end (see `phase0/results/sweep-starter-findings.md` for the full config
   history).
5. **Search calls need runaway guards**: pair limits (`go depth 22 movetime N`
   — see rule 11) and send `stop` if a movetime search overruns (~1.5s
   grace). Fortress positions otherwise hit MAX_PLY and never return
   (`lib/load.mjs.go()` has the watchdog).
6. **Recycle the engine instance every ~40 games / between duels** — the WASM
   instance corrupts under sustained multi-game use. Never call `quit()` in
   Node (Emscripten kills the whole process); drop the reference.
7. **Variant names are single-use** (redefinition silently no-ops). Use the
   dims-keyed catalog pattern: `duel_<files>x<ranks>`, all 50 loaded once at
   boot; everything else varies via FEN.
8. **Parse UCI squares with a regex** — rank-10 squares are 3 chars (`f10`).
9. **Quake surgery**: rewrite FEN (`setSquare` → `*` for a crumble, or
   from/to for a displacement; always `clearEp`), validate via
   `crumbleFilter.mjs`, then bare `position fen <new>` with `movesSinceBase`
   reset — the bare position alone resets engine history. Enumerate
   candidates EXHAUSTIVELY, never by random re-roll: sampling starves on
   late walled boards (3 observed failures in a 32-game sweep) and a full
   board sweep costs ~12 ms.
10. **Browser deployment**: pthread build needs SharedArrayBuffer →
    coi-serviceworker required, and it must sit NEXT TO index.html (service
    worker scope), not in a subdirectory. Ship `Threads=1`.
11. **Engine searches: cap at `depth 22`.** `movetime` does NOT bind on 4–6
    file arenas — the engine reaches depth 55+ and ultra-deep searches
    crash this WASM build's pthread (`index out of bounds`). Measured: d60
    crashed 1/30 searches, d22 crashed 0/110 and still returns <200 ms.
    Not a handicap; live play was reaching d22–23 anyway.
12. **Any long-lived auxiliary search needs its own recovery.** The duel's
    stall ladder only fires on the duel's own searches — the cheat/hint
    MultiPV probe had none and died permanently and silently when its
    instance went bad. Every search path needs a visible failure and a way
    back.
13. **The Director's guards are KING-safety guards — piece safety is
    separate, and it is per-COMPOSITE, not per-leg.** "No check given, no
    side left in check, no zero-legal-move result" says nothing about
    ordinary material, so a quake the code called symmetric handed over a
    free rook in live play (arena03: enemy rook stepped to b7 into a white
    rook on the open b-file). Symmetric meant symmetric in *count*.
    `play/js/threat.mjs` now prices every landing square by static exchange
    — and note the second half, which is the part that bites: filtering each
    leg on its own board is NOT enough. Leg 2 is enumerated on leg 1's
    board, so leg 1 → leg 2 is covered, but leg 2 → leg 1 is not; on the
    same position the pair (r a7→a6, R b5→a5) recreated the identical gift
    through the other ordering. Any new quake mechanic must be judged on the
    board the player actually receives.
14. **`director.quake()` is expensive and synchronous, and the cost is PIECE
    COUNT, not board area** — measured 300–720 ms per quake on 4×6–6×8
    arenas, but 956 ms on 8×8 with a classic 8×2 army and **1.46 s on 12×10
    with 12-wide armies**; a 12×10 board with a 3-piece army is back down to
    416 ms. It calls `displacementCandidates` twice, and that builds ~4 ffish
    Boards per candidate (`stuckCount` alone is 2, and only ever distinguishes
    tier B from tier C). Cheap filters belong BEFORE the ffish probes — that
    is why the landing-safety check runs on the grid. Do not add
    per-candidate ffish work without measuring. On a phone the big test
    scenarios will visibly freeze the UI mid-quake; `test13`/`test14`/`test15`
    exist partly to keep that number honest, and Phase 1.2's overlay is the
    instrument that should be reporting it.
15. **Crumbles are a REGRESSION-TO-PARITY force and they act against the
    player.** Crumble candidates are picked uniformly over legal squares, so
    the side with more pieces on the board absorbs proportionally more of them.
    Measured at ply 0, expected material lost per crumble: `test14-classic`
    (39v39, materially fair) **0.63 / 0.63 — exactly symmetric**; `arena01`
    (11v5) 0.50/0.23; `test09` (17v5) 0.31/0.09; `test13` (46v12)
    **0.73/0.19**. The damage ratio tracks the material ratio, which means
    crumbles erode precisely the advantage §13 hands the player. Consequence
    in play: results hold while a duel is short, and flip once ~20+ quakes
    accumulate — campaign arenas pass 30/32 over 8 seeds, and BOTH failures
    were long games (98 plies/61 quakes, 62 plies/29 quakes). This was
    invisible while the harness ran the retired crumble system. `play/README`
    already listed uniform crumble picking as a Phase 1.3 gap; it is not
    neutral noise, it is directional. **Do not "fix" it by inflating arena
    material** — the bleed is proportional, so a bigger edge bleeds faster in
    absolute terms; what shortens games is what helps.
16. **12×10 is the FSF largeboard ceiling, and exceeding it fails SILENTLY.**
    `loadVariantConfig` accepts an oversized `maxFile`/`maxRank` block without
    throwing, then omits the variant from `variants()`; the failure only
    surfaces as `memory access out of bounds` when a Board is constructed
    (verified for 13×10, 12×11, 14×12, 16×16). Same silent-failure family as
    rules 6 and 7. `makeDuelVariantIni`'s range check is the only guard —
    keep it. The catalog now spans the full supported range, files 2–12 ×
    ranks 2–10 (99 variants, 33 KB, 10.4 ms to load — the old 50-variant
    3–12 × 6–10 floor was ours, not FSF's, and cost 9.1 ms).
