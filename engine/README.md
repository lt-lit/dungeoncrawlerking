# The Forge — Phase 1.2.3 patch kit (capturable walls, `^`)

Canon: brief §4.6. Governance: CLAUDE.md rules 15–17. This directory is
the handoff from the 2026-08-23/25 feasibility spike: the reference diff,
the cross-check tests, the build recipe with every gotcha that bit, and
the exact line between PROVEN and OWED. `play/vendor/` still holds the
STOCK 1.1.11 / 0.7.9 pair — nothing here is vendored yet.

## Spike result (sandbox, Node)

Both WASM artifacts were built from ONE patch and agree with each other:

| check | result |
|---|---|
| ffish crate semantics (both sides capture the same `^`, sliders blocked, pawn diag-only, wall+crate coexist, FEN round-trip, 60-catalog registers) | 12/12 PASS |
| engine renders `^`, generates the capture, bestmove d12, no crash | PASS |
| ffish ↔ engine perft 1–3 on a `^` board (`2r2k/6/2^3/6/6/2R2K w`) | identical `[10,88,1024]`, same 10 moves incl. `c1c4` |
| patched engine vs vendored 1.1.11, perft 1–4, three `^`-free boards incl. one `*` wall | identical `[[9,94,1069,12203],[8,62,690,7100],[20,363,7110,134129]]` |

Build times: ffish 1m42s, engine 1m41s. Sizes: ffish.wasm 920,681 →
929,987; stockfish.wasm 1,636,293 → 1,646,391.

The agreement check CANNOT catch a bug in the shared patch (both binaries
carry it) — the `^`-free regression against the previous pair is the
other half of the gate. Always run both.

## Provenance (pin these)

- ffish tree: `fairy-stockfish/Fairy-Stockfish` master @ `6d9d0f5` (2026-08-23), emsdk **1.39.16**, `make -f src/Makefile_js build` → `tests/js/ffish.{js,wasm}`
- engine tree: `fairy-stockfish/fairy-stockfish.wasm` branch `nnue` @ `2e874fd`, emsdk **2.0.26**, `make -C src emscripten_build ARCH=wasm embedded_nnue=no` (but see gotcha 1)
- Rule-bearing files (`position.{h,cpp}`, `movegen.cpp`, `parser.cpp`, `variant.{h,cpp}`, `apiutil.h`, `piece.cpp`, `types.h`) are byte-identical between the two trees (engine tree differs only by 4 `position.cpp` lines — Misere SEE, irrelevant to duels). ONE patch feeds BOTH.
- Reference diff: `patches/pr29-dead-squares-full.diff` = the full src diff of Belzedar94/KOTH-Stockfish PR #29 (true feature commits are `pr29~5..pr29`; the design is FSF issue #609's `^` dead squares). **UNSTRIPPED** — see the port checklist.
- Unpatched rebuilds reproduced the vendored npm artifacts (worker byte-identical; js/wasm identical except two memory-layout constants), so the published packages are rebuildable with these pins.

## Port checklist (the 1.2.3 work)

1. Apply the reference diff to both trees. Two conflicts, both cosmetic — take UPSTREAM in both: `position.cpp` `operator<<` (upstream added a `~promoted` display branch) and the `variants.ini` tail (upstream `[mandala]` vs the PR's `fatalgiveaway`).
2. STRIP the baggage: `selfCapture`, `ironPieceTypes`, `deathOnCaptureTypes`, the `fatalgiveaway`/`captureanything`/`recycle` variants. Ship dead squares only.
3. FIX the two known movegen defects (performance, not correctness — perft is staged-picker-independent and agreed despite them):
   - `movegen.cpp` `captureTarget = target | pos.dead_squares()` has no GenType guard → dead-captures also emitted in the QUIET stage (measured 4,135/130,669 quiet-stage moves) and searched twice per node. Guard by GenType.
   - EVASIONS ORs in ALL dead squares even when the target is the check ray → illegal candidates generated then rejected by `legal()` (measured 547/5,178). Wasted work; tighten.
4. DROP the ~25 provable no-op `(pieces() | deadSquares)` rewrites — `pieces()` (= `byTypeBB[ALL_PIECES]`) already contains dead squares. Smaller patch, upstreamable patch.
5. Do NOT include the walled-passer eval fix (`evaluate.cpp` gates the free-to-advance passer bonus on `pos.empty(blockSq)`, which is true for walls — up to ~200 cp illusion). It breaks eval-equivalence with the shipped pair for zero play value. Upstream it as its own PR; adopt via upstream only.
6. Fixture discipline: never give a test side a bare king — `extinctionPieceTypes=*` decides the game at load and `legalMoves()` comes back empty (CLAUDE.md rule 4b). This bit the spike once.

## Build gotchas (each cost a cycle)

1. **`make -j` is UNSAFE for the engine**: `emscripten_build: build emscripten_copy_files` has unordered prerequisites — parallel make runs the copy BEFORE the link and publishes a STALE binary that looks fine and ignores `^`. Build serially: `make build && make emscripten_copy_files`, or copy by hand and…
2. **…the worker is a CONCATENATION**: `cat stockfish.worker.js emscripten/worker-postamble.js > public/stockfish.worker.js`. A plain `cp` yields "worker.js received unknown command custom" and the engine never answers `uci`.
3. **emsdk is stateful**: `./emsdk install 2.0.26` deactivates 1.39.16 in the same checkout. Build ffish FIRST, then the engine — or keep two emsdk dirs.
4. **Engine variant config goes through the virtual FS**: `sf.FS.writeFile('/variants.ini', ini)` + `setoption name VariantPath value /variants.ini` + `setoption name UCI_Variant value <name>`. Host paths silently no-op and without UCI_Variant you are playing 8×8 chess.
5. The engine Makefile tries to download a 47.7 MB NNUE net from tests.stockfishchess.org even with `embedded_nnue=no` — cache `nn-3475407dc199.nnue` next to the Makefile or the build needs that host reachable.

## Validation gate (rule 16) — proven vs owed

- [x] ffish crate semantics (Node)
- [x] ffish ↔ engine perft agreement on `^` boards (Node)
- [x] engine `^`-free perft equivalence vs vendored 1.1.11 (Node)
- [ ] **ffish** `^`-free perft equivalence vs vendored 0.7.9 — never run; the legality oracle deserves the same regression the engine got
- [ ] `play/selftest.html` + full 60-variant catalog under the new pair in a REAL browser — the spike ran Node only; SharedArrayBuffer / pthreads / coi-serviceworker are untested
- [ ] re-measure rule 11's depth cap on the new pair (d22 came from 110 searches on 1.1.11) and update CLAUDE.md
- [ ] phone feel check at `depth 22 movetime 10000` with ~6 `^` on board (search-cost numbers so far are desktop proxy measurements)

## Tests

Node, from repo root; point the env vars at a patched build:

```sh
FFISH_JS=/path/to/ffish.js node engine/tests/test-ffish.cjs     # 12 crate-semantics asserts
ENGINE_JS=/path/to/stockfish.js node engine/tests/test-engine.cjs  # engine sees ^, bestmove, perft
FFISH_JS=... ENGINE_JS=... node engine/tests/xcheck.cjs         # ffish↔engine perft agreement
ENGINE_JS=... node engine/tests/regress.cjs                     # ^-free equivalence vs play/vendor
```

`regress.cjs` reads the vendored engine via a repo-relative path; the
others take everything from the environment.

## Upstream (file, never wait)

- Dead squares → `fairy-stockfish/Fairy-Stockfish` issue #609 (the maintainer's own wishlist item; our stripped patch is the natural PR).
- Walled-passer eval fix → separate small PR (real bug in every walled variant).
- Context: rule 11's crash is `fairy-stockfish/fairy-stockfish.wasm` issue #14 ("pthread issue", open since 2024-01, undiagnosed) — a self-built pair neither fixes nor worsens it on current evidence (14/14 clean d60 searches per engine proves nothing at a 1/30 rate).
