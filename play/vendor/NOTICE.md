# Third-party notices — play/vendor/

This directory redistributes the following GPL-licensed binaries. The
full license text is in `LICENSE` (GNU GPL v3); both projects are
licensed GPL-3.0-or-later.

## Fairy-Stockfish (WASM engine)
- Files: `stockfish.js`, `stockfish.wasm`, `stockfish.worker.js`
- Package: `fairy-stockfish-nnue.wasm` 1.1.11 (npm), unmodified
- Source: https://github.com/fairy-stockfish/fairy-stockfish.wasm (branch `nnue`)
- Derived from Stockfish, © 2004–2022 the Stockfish developers, and
  Fairy-Stockfish, © Fabian Fichter and contributors.

## ffish.js (rules/legality library)
- Files: `ffish.js`, `ffish.wasm`
- Package: `ffish` 0.7.9 (npm), unmodified
- Source: https://github.com/fairy-stockfish/Fairy-Stockfish
  (`src/ffishjs.cpp`, built via `src/Makefile_js`)

Corresponding source for these unmodified binaries is the upstream
repositories and npm packages named above. If/when this project vendors
patched builds (brief §4.6, Phase 1.2.3), the corresponding source
becomes: the pinned upstream commits plus the patches in
`engine/patches/`, with the build recipe in `engine/README.md` — keep
this notice updated when that lands.

The game's own code in this repository is © its author. Engine searches
run with `Use NNUE false`; no NNUE network files are redistributed.
