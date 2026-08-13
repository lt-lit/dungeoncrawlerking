# Dungeon Crawler King — repo guide

Design source of truth: `dungeon-crawler-king-prototype-brief.md`.
Phase 0 (spikes + calibration harness) is **complete** — read
`phase0/PHASE0-RESULTS.md` before touching anything engine-related; it
summarizes 12 verified spikes and the sweep results. Next per brief §10:
**Phase 1 — duel vertical slice** (hand-authored arena → playable duel vs
engine on a phone; placement UI, win/loss, promotion; no overworld).

## Layout

- `phase0/lib/` — shared infra: `load.mjs` (Node loaders + UCI wrapper),
  `fen.mjs` (largeboard FEN editing: walls `*`, multi-digit runs, pockets),
  `variant.mjs` (duel variants.ini generator — the canonical rule baseline)
- `phase0/spikes/` — one runnable script per §9 spike (deterministic, exit 0 =
  pass). `crumbleFilter.mjs` is production-bound (validated §4.5 filter).
  `spike08-mobile/` is a static phone benchmark page (vendored WASM).
- `phase0/harness/` — §7 calibration harness: `sweep.mjs <config.json>` plays
  engine-vs-engine games with the full crumble system, JSONL + summary out.
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
   A-prime no-draw config (`nFoldRule=0` + `nFoldValue=loss`), the extinction
   trio, per-color promotion AND double-step regions. Hand-written variant
   blocks silently lose these (unknown keys are silently ignored — validate).
4. **Game end = `numberLegalMoves() === 0`, and the side to move LOSES.**
   Never use ffish `isGameOver()`/`result()` to drive or label game end — both
   mislabel bare-kings states as draws under our config.
5. **Search calls need runaway guards**: pair limits (`go depth 60 movetime N`)
   and send `stop` if a movetime search overruns (~1.5s grace). Fortress
   positions otherwise hit MAX_PLY and never return (`lib/load.mjs.go()` has
   the watchdog).
6. **Recycle the engine instance every ~40 games / between duels** — the WASM
   instance corrupts under sustained multi-game use. Never call `quit()` in
   Node (Emscripten kills the whole process); drop the reference.
7. **Variant names are single-use** (redefinition silently no-ops). Use the
   dims-keyed catalog pattern: `duel_<files>x<ranks>`, all 50 loaded once at
   boot; everything else varies via FEN.
8. **Parse UCI squares with a regex** — rank-10 squares are 3 chars (`f10`).
9. **Crumble surgery**: rewrite FEN (`setSquare` → `*`, `clearEp`), validate via
   `spikes/crumbleFilter.mjs`, then bare `position fen <new>` — that alone
   resets engine repetition history.
10. **Browser deployment**: pthread build needs SharedArrayBuffer →
    coi-serviceworker required, and it must sit NEXT TO index.html (service
    worker scope), not in a subdirectory. Ship `Threads=1`.
