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
Next per brief §10: **Phase 1.5 — Director calibration** (port
`harness/game.mjs` off the retired crumble system, add the §6 promotion
lint, settle ramp numbers), then **Phase 2 — exploration slice**.

## Layout

- `play/` — the Phase 1 game (vanilla-JS ES modules, GitHub Pages). Phase 0
  modules are ported verbatim into `play/js/`; `play/vendor/` carries its own
  copy of the validated WASM builds; `coi-serviceworker.min.js` sits next to
  `play/index.html` (rule 10). `play/selftest.html` is the in-browser infra
  cross-check — keep it PASSing.
- `phase0/lib/` — shared infra: `load.mjs` (Node loaders + UCI wrapper),
  `fen.mjs` (largeboard FEN editing: walls `*`, multi-digit runs, pockets),
  `variant.mjs` (duel variants.ini generator — the canonical rule baseline)
- `phase0/spikes/` — one runnable script per §9 spike (deterministic, exit 0 =
  pass). `crumbleFilter.mjs` is production-bound (validated §4.5 filter).
  `spike08-mobile/` is a static phone benchmark page (vendored WASM).
- `phase0/harness/` — §7 calibration harness: `sweep.mjs <config.json>` plays
  engine-vs-engine games, JSONL + summary out. **Still runs the RETIRED
  crumble system (`harness/crumble.mjs`, repetition + fixed-cadence pacing),
  not the shipped Director — porting it is Phase 1.5. Sweep numbers about
  arena regeneration are not trustworthy until that lands.**
- `phase0/results/` — per-spike results docs + sweep outputs.

## Running things

```sh
cd phase0                      # npm deps live here (node_modules gitignored)
npm install                    # ffish + fairy-stockfish-nnue.wasm
node lib/selftest.mjs          # infra cross-check (ffish vs engine perft)
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
