# Third-party notices — play/vendor/

This directory redistributes the following GPL-licensed binaries. The
full license text is in `LICENSE` (GNU GPL v3); both projects are
licensed GPL-3.0-or-later.

**These are PATCHED builds (since 2026-08-26, Phase 1.2.3):** built from
the pinned upstream commits below plus this project's dead-squares patch
(`engine/patches/dead-squares.patch` — capturable neutral `^` squares,
brief §4.6). Corresponding source = the pinned upstream commit + that
patch; build recipe and validation evidence in `engine/README.md`.

## Fairy-Stockfish (WASM engine)
- Files: `stockfish.js`, `stockfish.wasm`, `stockfish.worker.js`
- Built from: https://github.com/fairy-stockfish/fairy-stockfish.wasm
  branch `nnue` @ `2e874fd` + `engine/patches/dead-squares.patch`
  (emsdk 2.0.26, `ARCH=wasm embedded_nnue=no`; previously the unmodified
  npm package `fairy-stockfish-nnue.wasm` 1.1.11)
- Derived from Stockfish, © 2004–2022 the Stockfish developers, and
  Fairy-Stockfish, © Fabian Fichter and contributors.

## ffish.js (rules/legality library)
- Files: `ffish.js`, `ffish.wasm`
- Built from: https://github.com/fairy-stockfish/Fairy-Stockfish
  master @ `6d9d0f5` + `engine/patches/dead-squares.patch`
  (`src/ffishjs.cpp` via `src/Makefile_js`, emsdk 1.39.16; previously
  the unmodified npm package `ffish` 0.7.9)

The game's own code in this repository is © its author. Engine searches
run with `Use NNUE false`; no NNUE network files are redistributed.
