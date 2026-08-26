# The Forge — Phase 1.2.3 patch kit (capturable walls, `^`)

Canon: brief §4.6. Governance: CLAUDE.md rules 15–17.

**Status 2026-08-26: PHASE 1.2.3 COMPLETE.** `play/vendor/` carries the
patched pair (built from the pins below + `patches/dead-squares.patch`,
emsdk 1.39.16 / 2.0.26); the rule-16 gate ran green end to end — Node
suite, headless-Chromium `play/selftest.html` 29/29 with SharedArrayBuffer
live, depth-cap re-measure, spike10 rerun — and the designer's phone feel
check passed (2026-08-26; duel feel unchanged, selftest green on device).
The "~6 crates in a live duel" feel reading arrives with Phase 1.2.4's
stage support — nothing can author `^` into a playable board until then.

`patches/dead-squares.patch` is the patch of record — written from scratch
against the pinned trees, informed by a hunk-by-hunk audit of the reference
diff. `patches/pr29-dead-squares-full.diff` (KOTH-Stockfish PR #29) is
**reference only**: internet code, three known defects (below), do not port
from it.

**phase0 caveat:** `phase0/` loads the pair from npm (`npm install` →
STOCK 1.1.11/0.7.9). Any phase0 run that must play the SHIPPED rules —
the 1.2.5 corpus above all (the meter-lab law: calibration is only valid
under the exact shipped ruleset) — must first overlay the vendored
artifacts: `cp play/vendor/ffish.{js,wasm} phase0/node_modules/ffish/ &&
cp play/vendor/stockfish.{js,wasm,worker.js}
phase0/node_modules/fairy-stockfish-nnue.wasm/`. The 2026-08-26 gate ran
`lib/selftest.mjs` and spike10 under exactly this overlay.

## The authored patch (`patches/dead-squares.patch`)

73 insertions / 22 deletions across exactly four files — `position.h`,
`position.cpp`, `movegen.cpp`, `apiutil.h` (vs. the reference's 945-line
diff; the audit classified ~25 of its rewrites as provable no-ops and most
of the rest as selfCapture/ironPieces/deathOnCapture baggage). Applies to
BOTH pinned trees (`git apply --check` clean; one hunk lands at offset −2 in
the wasm tree — that is the known 4-line Misère-SEE divergence, untouched).

Design: a dead square lives in `StateInfo::deadSquares` AND in
`byTypeBB[ALL_PIECES]` (the exact stock idiom for `*` walls) but in no
color/piece bitboard, with `board[]` at `NO_PIECE`. Because `pieces()` IS
that occupancy, slider blocking, pawn-push blocking, double-step blocking,
king evasions onto crates, and NON_EVASIONS generation all fall out with
zero code. The load-bearing changes:

- FEN parse/emit/validate for `^` (parse mirrors the wall branch; emit
  distinguishes `^` from `*`, with fog masking preserved).
- `Zobrist::dead[]` + a `set_state` branch — a crate and a wall on the same
  square must hash and round-trip differently.
- `do_move`: on a move onto a dead square, clear it from `deadSquares` and
  from the occupancy (so `move_piece`'s XOR composes), hash it out, reset
  rule50 (irreversible). `undo_move`: one mirror XOR placed at the END,
  just before `st = st->previous` — see defect 3 below for why the wall
  mirror's top-of-function position is NOT correct for dead squares.
- `capture(m)` / `capture_or_promotion(m)`: additive terms only — a move
  onto a dead square is a capture (movepick staging, SEE, SAN `x`, TT-move
  validation all key on this). New `piece_capture(m)` = capture of an
  actual piece.
- **Terrain is not a victim** (designer ruling 2026-08-25, brief §4.6):
  rules that reward or compel *capturing* mean enemy pieces, never
  furniture. `mustCapture` (legal() + `has_capture()`) neither forces a
  crate capture nor is satisfied by one; capture-gated promotion
  (`piecePromotionOnCapture` masks in movegen + pseudo_legal) gives no
  promotion credit for a crate; petrify-on-capture does not trigger (SEE
  guard matched to do_move, which never petrifies a victimless capture).
  All unreachable in duel variants; implemented engine-wide for coherence.
- movegen: three one-liners — pawn `capturable |= dead`, CAPTURES target
  `|= dead`, drop targets `&= ~dead` — plus the promotion-on-capture masks
  above. NO captureTarget parameter, NO EVASIONS changes (a crate can never
  sit on a slider check ray — the checker would be blocked; king-takes-crate
  evasions are stock behavior; hopper-screen evasions likewise).

With `deadSquares` empty every changed expression reduces to the stock one
— verified empirically below, node-for-node.

Known non-goal: atomic/blast × dead squares. `do_move` never blasts a
victimless capture (correct), but `blast_see` prices crate captures as
blasting. Our variants have neither; do not combine them without work.

## Reference-diff defects (why it was not ported)

1. **QUIET-stage double emission** — its unguarded `captureTarget = target |
   dead_squares()` emits every crate capture in the QUIET stage too;
   movepick has no cross-stage dedupe, so each is searched twice per node
   (measured 4,135/130,669 quiet-stage moves). An artifact of its
   selfCapture plumbing; the authored patch has no captureTarget parameter
   and is immune by construction.
2. **EVASIONS over-generation** — it ORs ALL dead squares into the evasion
   capture target; every candidate is then rejected by `legal()` (measured
   547/5,178). Same origin, same resolution.
3. **Promotion-capture undo corruption** (found 2026-08-25, NOT in the
   spike's list — its fixtures had no pawns near promotion). The reference
   restores dead-square occupancy at the TOP of `undo_move`, mirroring the
   wall reset. Walls are never on a moved-to square; a captured crate
   always is — and undoing a PROMOTION lands `remove_piece` (XOR) and
   `put_piece` (OR) on that same square, which does not commute with the
   early mirror. Net effect: undoing a pawn-captures-crate-and-promotes
   move (§4.6: legal, intended) leaves the crate in `deadSquares` but OUT
   of the occupancy — sliders see through it, pawns push onto it.
   Empirically: on the mirror-pair promo fixtures below the reference build
   diverges from depth 2 (177 vs 214) and **fails color-mirror
   self-consistency** (white-to-move 686,703 vs mirrored black-to-move
   683,674 at depth 5 — a correct movegen must be mirror-exact). Perft
   missed it in the spike because `go perft` uses `generate<LEGAL>` only —
   it never exercises the staged picker either (defect 1's hiding place).
   Also of record: its `capture_or_promotion` restructure changes pass-move
   (`from==to`) classification — a behavior delta on `^`-free boards in
   pass variants — and its `captures_to_hand`/`nonPawnMaterial` rewrites
   are selfCapture-only semantics changes.

## Native validation (2026-08-25, this container)

Three native builds from the pinned mainline tree (`largeboards=yes`,
classical eval): STOCK (clean), AUTHORED (`dead-squares.patch`), REFERENCE
(PR #29 diff minus its two cosmetic rejects). Driver:
`go perft` / fixed-depth `go depth 12` over UCI, variants from the same
crate6x6 config the WASM tests use.

| check | result |
|---|---|
| `^`-free perft 1–5, stock vs authored, 3 fixtures incl. a `*` wall | **identical** (9,94,1069,12203,142515 / 8,62,690,7100,79593 / 20,363,7110,134129,2696270) |
| `^`-free fixed-depth-12 search transcript, stock vs authored | **node-for-node identical** — same bestmove, nodes (19459/48847/38144), score, PV on all 3 |
| crate fixtures perft 1–4/5 (both sides capture, pawn diag-only, wall+crate) | authored **agrees with the independently-implemented reference** on every non-promotion board, incl. the spike's `[10,88,1024]` extended to d5 = 126,149 |
| promo-capture-of-crate mirror pair (`r^1^1k/2P3/6/6/6/R4K w` / mirrored `b`) | authored: d1=24 **hand-verified**, perft 1–5 = 24,177,3345,31370,562700, **mirror-exact**; reference: diverges from d2, mirror-broken (defect 3) |
| mustCapture ruling (`crate6x6mc`) | lone crate "capture" forces nothing (d1=10, same as without mustCapture); with a real capture on the board the crate capture is illegal (d1=1). Reference: forces terrain captures (d1=1 / d1=2) |
| depth-12 search on crate boards | sane play, crates priced; on the promo fixture finds the bare-army strip mate-in-1 (`a1a6`) — A-prime extinction intact |
| board display / FEN | `d` renders `^` distinct from `*`; FEN round-trips exactly, wall+crate coexist |

Compilation: zero warnings from the changed files under `-Wall -Wextra
-Wshadow` in both trees.

## Provenance (pin these)

- ffish tree: `fairy-stockfish/Fairy-Stockfish` master @ `6d9d0f5` (2026-08-23), emsdk **1.39.16**, `make -f src/Makefile_js build` → `tests/js/ffish.{js,wasm}`
- engine tree: `fairy-stockfish/fairy-stockfish.wasm` branch `nnue` @ `2e874fd`, emsdk **2.0.26**, `make -C src emscripten_build ARCH=wasm embedded_nnue=no` (but see gotcha 1)
- Rule-bearing files (`position.{h,cpp}`, `movegen.cpp`, `parser.cpp`, `variant.{h,cpp}`, `apiutil.h`, `piece.cpp`, `types.h`) are byte-identical between the two trees (engine tree differs only by 4 `position.cpp` lines — Misère SEE, irrelevant to duels; re-verified at the pins). ONE patch feeds BOTH.
- Unpatched rebuilds reproduced the vendored npm artifacts (worker byte-identical; js/wasm identical except two memory-layout constants), so the published packages are rebuildable with these pins.

## Build gotchas (each cost a cycle)

1. **`make -j` is UNSAFE for the engine**: `emscripten_build: build emscripten_copy_files` has unordered prerequisites — parallel make runs the copy BEFORE the link and publishes a STALE binary that looks fine and ignores `^`. Build serially: `make build && make emscripten_copy_files`, or copy by hand and…
2. **…the worker is a CONCATENATION**: `cat stockfish.worker.js emscripten/worker-postamble.js > public/stockfish.worker.js`. A plain `cp` yields "worker.js received unknown command custom" and the engine never answers `uci`.
3. **emsdk is stateful**: `./emsdk install 2.0.26` deactivates 1.39.16 in the same checkout. Build ffish FIRST, then the engine — or keep two emsdk dirs.
4. **Engine variant config goes through the virtual FS**: `sf.FS.writeFile('/variants.ini', ini)` + `setoption name VariantPath value /variants.ini` + `setoption name UCI_Variant value <name>`. Host paths silently no-op and without UCI_Variant you are playing 8×8 chess.
5. The engine Makefile tries to download a 47.7 MB NNUE net from tests.stockfishchess.org even with `embedded_nnue=no` — cache `nn-3475407dc199.nnue` next to the Makefile or the build needs that host reachable. (Native builds want it too; the host was reachable through this container's proxy on 2026-08-25.)

## Validation gate (rule 16) — run 2026-08-26, all container items green

- [x] patch applies to both pinned trees; native `^`-free perft AND
  fixed-depth search-transcript equivalence vs stock; crate semantics +
  mirror-exactness + hand-verified d1 (see Native validation)
- [x] WASM: `test-ffish.cjs` — **19/19** (incl. promotion-capture push/pop,
  SAN, mustCapture ruling, 60-catalog)
- [x] WASM: `test-engine.cjs` — **7/7** (renders `^`, crate capture,
  validated perft counts incl. the promo fixture, d12 bestmove)
- [x] WASM: `xcheck.cjs` — ffish↔engine agreement on all 8 crate fixtures
  + the promo mirror-pair identity: **PASS**
- [x] WASM: `regress.cjs` — engine `^`-free perft 1–4 identical to vendored
  1.1.11 on all 3 fixtures incl. the wall board
- [x] WASM: `regress-ffish.cjs` — ffish `^`-free perft/moves/validateFen/
  12x10 identical to vendored 0.7.9
- [x] WASM: `search-identity.cjs` — PILOT deterministic; patched
  node-for-node identical to BOTH a stock same-pin build AND the vendored
  1.1.11 at depth 12 (19459/26462/35136 nodes — the wasm tree at `2e874fd`
  searches identically to shipped 1.1.11 on these fixtures; see the
  baseline note in the script)
- [x] `play/selftest.html` in headless Chromium over a COOP/COEP server —
  **29/29** (SharedArrayBuffer live, pthread worker path, 60-catalog, the
  new §4.6 furniture block: perft agreement, promotion-capture push/pop,
  strip-mate bestmove on a `^` board)
- [x] depth-cap re-measure (`depthcap.cjs`, mixed 4–6-file arenas incl. `^`
  and `*`, production watchdog): **d22 110/110 clean, slowest 1553 ms; d60
  30/30 clean** — cap STAYS at d22 (0/30 at d60 is not evidence of a fix
  at the old 1/30 crash rate; rule 11 unchanged)
- [x] spike10 rerun — **32/32**, and `phase0/lib/selftest.mjs` ALL PASSED,
  both under the vendored-pair overlay (A-prime no-draw internals intact)
- [x] **phone feel check** — passed 2026-08-26 (designer: duel feel
  unchanged on the new pair; selftest green on device). The crates-dense
  live-duel reading lands with 1.2.4 stage support — re-check feel once
  `^` boards are playable, as part of 1.2.4's exit ("crates in live phone
  duels")

Gate-run notes: two spike-era harness bugs were fixed while running it —
`test-engine.cjs` parsed a "Legal uci moves" line this engine's `d` does
not print (and its Fen-line wait raced the output; moves now come from
`go perft 1`), and `search-identity.cjs` gained the BASELINE_JS override
plus the mainline-vs-wasm-tree warning.

## Tests

Node, from repo root; point the env vars at a patched build:

```sh
FFISH_JS=/path/to/patched/ffish.js node engine/tests/test-ffish.cjs      # 19 crate-semantics asserts
ENGINE_JS=/path/to/patched/stockfish.js node engine/tests/test-engine.cjs   # engine sees ^, validated perft, bestmove
FFISH_JS=... ENGINE_JS=... node engine/tests/xcheck.cjs                  # ffish<->engine agreement, 8 fixtures + mirror
ENGINE_JS=... node engine/tests/regress.cjs                              # engine ^-free equivalence vs play/vendor
FFISH_JS=... node engine/tests/regress-ffish.cjs                         # ffish ^-free equivalence vs play/vendor
PILOT=1 node engine/tests/search-identity.cjs                            # determinism pilot (vendored vs itself)
ENGINE_JS=... node engine/tests/search-identity.cjs                      # fixed-depth transcript identity vs vendored
ENGINE_JS=... node engine/tests/depthcap.cjs                             # rule-11 re-measure (110 d22 + 30 d60)
```

`regress.cjs`, `regress-ffish.cjs` and `search-identity.cjs` read the
vendored artifacts via repo-relative paths; the others take everything from
the environment. Fixture discipline: never give a test side a bare king —
`extinctionPieceTypes=*` decides the game at load (CLAUDE.md rule 4b).

## Upstreaming (optional — not planned)

Designer decision 2026-08-25: no FSF pull requests are planned. The patch
is deliberately upstream-shaped anyway (glyph-driven, no new variant keys,
stock-identical with no `^` on board, coherent across variants we never
play) should that ever change; the natural venue would be FSF issue #609
(the maintainer's own dead-squares wishlist item).

The **walled-passer eval bug** stays UNFIXED in our patch by design:
`evaluate.cpp:1045` gates the free-to-advance passer bonus on
`pos.empty(blockSq)`, which is true for walls AND crates (`empty()` is
`board[]`-based), paying up to ~200 cp for a pawn that can never move.
Fixing it would break eval-equivalence with the shipped pair for zero play
value. It is documented here so a future engine upgrade or upstream sync
knows to look for it.

Context: rule 11's crash is `fairy-stockfish/fairy-stockfish.wasm` issue
#14 ("pthread issue", open since 2024-01, undiagnosed) — a self-built pair
neither fixes nor worsens it on current evidence.
