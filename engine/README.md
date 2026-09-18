# The Forge — Phase 1.2.3 patch kit (capturable walls, `^`)

Canon: brief §4.6. Governance: CLAUDE.md rules 15–17.

**Status 2026-08-26: PHASE 1.2.3 COMPLETE.** `play/vendor/` carries the
patched pair (built from the pins below + `patches/dead-squares.patch`,
emsdk 1.39.16 / 2.0.26); the rule-16 gate ran green end to end — Node
suite, headless-Chromium `play/selftest.html` 29/29 with SharedArrayBuffer
live, depth-cap re-measure, spike10 rerun — and the designer's phone feel
check passed (2026-08-26; duel feel unchanged, selftest green on device).
The crates-dense feel reading landed with Phase 1.2.4's stage support:
**1.2.4's exit passed 2026-08-27** — crate duels live on-device with
Earthquakes on (designer verdict: "surprisingly really fun").

**Status 2026-08-27: the STACK patch shipped.** `patches/thread-stack.patch`
(TH_STACK_SIZE 8MB→32MB) fixes the live-duel engine stalls — FSF's
largeboard search-thread stack overflow, upstream issue #804. Engine
artifact rebuilt from the same pins (js+worker byte-identical to the
2026-08-26 pair, wasm +2 bytes); ffish unchanged (the constant is dead
code in its threadless build); full rule-16 gate green (see "The stack
patch" below). Phone feel check passed 2026-09-01. Adopt upstream PR #1031 when it
lands and drop the patch.

**Status 2026-09-17: THE PORTALS PATCH shipped.** `patches/portals.patch`
(489+/14− across eight files, applied on top of the two above, in that
order) gives the engine the portal spell of brief §4.7: a PORTAL move type,
the scroll cast as a drop, the trailing FEN field for the pairs, and the
strip rule that never counts a spell. Both artifacts rebuilt from the same
pins and toolchains; the rule-16 gate ran green end to end (see "The
portals patch" below). Played the same day (the first portal duel).

**Status 2026-09-17, later: THE WALL-KINDS AND HAMMER PATCHES shipped.**
`patches/wall-kinds.patch` (131 lines) and `patches/hammer.patch` (265),
applied on top of the three above in that order, give the engine brief
§4.8: `#`, the indestructible wall, hashed apart from the breakable `*`;
and the HAMMER move type — a piece of a `hammerPieceTypes` type spends its
move turning an adjacent breakable wall into a dead square. One forge
session, one build, one gate (see "The wall-kinds patch and the hammer
patch" below). Not yet played by the designer.

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

## The stack patch (`patches/thread-stack.patch`) — 2026-08-27

One hunk: `TH_STACK_SIZE` 8MB → 32MB in `src/thread_win32_osx.h` (a file
byte-identical across both pinned trees, untouched upstream since 2022).
Fixes the live-duel engine stalls ("engine stalled — recycling instance" /
"hint probe failed … — reforming"): FSF pins every search thread's stack
via `pthread_attr_setstacksize` (active under USE_PTHREADS, em++
included; the wasm glue honors the attribute), while largeboard search
frames run ~70KB each (`MAX_MOVES=8192` → a 64KB ExtMove buffer per
MovePicker) — a deep re-search line toward MAX_PLY needs 17–24MB and
overflows. Natively that is a SIGSEGV / ASan `stack-overflow` on the
search thread (~118 recursive plies, 124 frames in gdb); in wasm it is a
SILENT overwrite of adjacent linear memory — the search often still emits
a legal bestmove, then the instance never answers again. One bug, five
error wordings: `index out of bounds` (Firefox wasm), `memory access out
of bounds` (Chromium/Node wasm), `too much recursion` (Firefox glue),
`TypeError: a is not a function` (Chromium glue), `Maximum call stack
size exceeded` (Node pthread message).

Findings of record (investigation 2026-08-27; the P60 golden fixture is
now `engine/tests/stack-regress.cjs`):

- The old pair dies on ONE search: variant `duel_10x10__w2__b9`, the P60
  FEN, `go depth 22 nodes 3000000` — 19/19 in headless Chromium, 4/4 in
  Node. Field rate on big boards at production limits: ~3 deaths/100
  searches (4×7 control: 0/20). With 32MB the same search completes at
  the exact stock node count (1,786,533, sd 32) — search-identical by
  construction, and verified node-for-node against native (d26 =
  4,894,925 in both).
- Depth/nodes/movetime caps do NOT mitigate — they resample which tree is
  walked (a 4-node timing jitter flips dead↔alive); a Hash change dodges
  by path luck. And `isready` is NOT proof of life: one Node failure mode
  leaves the UCI queue answering `readyok` over a dead search thread
  (rule 12 applies — liveness checks must be a real search).
- NOT a 1.1.11→1.1.12 regression: native builds SIGSEGV at BOTH vintages;
  with an adequate stack both complete byte-identically. The old base's
  "clean" deep largeboard searches are layout luck (upstream documents
  corrupt-before-trap) — treat them as untrusted, and do NOT roll back.
  This likely also explains rule 6's sustained-use corruption and the
  rule-11 d60 crash rate.
- Upstream: FSF issue #804 (open since 2024); the structural fix is draft
  PR fairy-stockfish/Fairy-Stockfish#1031 (per-thread MovePicker buffer
  pool — its own numbers match these). ADOPT IT when it lands and drop
  this patch. Cost of ours: one 32MB block per search thread (Threads=1
  live, so 32MB total).

Rebuild provenance (2026-08-27): same pins and toolchain as 1.2.3, both
patches applied (dead-squares hunk 12 at the known −2 offset). The
rebuilt `stockfish.js` and `stockfish.worker.js` are BYTE-IDENTICAL to
the previous vendored pair; `stockfish.wasm` differs by +2 bytes — the
delta is the stack constant and nothing else. ffish is NOT rebuilt: the
constant is dead code in its threadless build (no USE_PTHREADS), so the
vendored ffish artifacts are unchanged.

### Validation gate (rule 16) — run 2026-08-27, all container items green

- [x] Node suite: test-ffish 19/19 (vendored ffish control) ·
  test-engine 7/7 · xcheck 8 fixtures + mirror PASS · regress: candidate
  `^`-free perft == vendored exactly · regress-ffish PASS ·
  search-identity: PILOT + candidate node-for-node identical to vendored
  at d12 (19459/26462/35136)
- [x] stack-regress (the new test): kill-search completes, nodes
  1,786,533, sd 32, post-kill search answers. Against the OLD pair it
  fails (dead instance; `Maximum call stack size exceeded`) — the test
  demonstrably detects the bug.
- [x] `play/selftest.html` headless Chromium over COOP/COEP: **29/29**,
  SharedArrayBuffer live, pthread worker path
- [x] Browser P60 fixture 5/5 complete+alive (3× node-capped, 2×
  `movetime 10000` form); browser crash-arm rerun (30 production-limit
  searches on developed Collapsed-Keep 10×10 boards, same deal as the
  original investigation arm): **0 deaths** — the old pair scored 1/30
  on this arm, ~3/100 across arms
- [x] phase0 overlay: `lib/selftest.mjs` ALL PASSED, spike10 32/32,
  node_modules restored to stock (md5-verified)
- [x] depth-cap re-measure: d22 110/110 clean (slowest 1619 ms), d60
  30/30 clean; NEW 10×10 tier (previously unmeasured): d22/10s, d26/12M
  and d30/20M-node searches all complete with the instance alive — the
  cap STAYS at d22 (rule 11: live pacing unchanged; 0/30 at d60 remains
  weak evidence at the historical 1/30 rate)
- [x] POST-MERGE revalidation (2026-08-27, after PR #15 / Phase 1.2.4
  merged into the branch): `play/selftest.html` on the merged tree
  **32/32** (the 1.2.4 furniture checks included; ran twice, identical),
  and a furniture-stage browser run through the NEW `dealMatchup` —
  s52-the-apartments (10×10 floorplan, 12 `^` on the dealt board), two
  seeds × 15 production-limit searches (8 of them full-10s at 2.4–2.7M
  nodes, the regime that stalled ~3/100 on the old pair): 30/30
  bestmove, **0 deaths**, 0 page errors, final liveness proven by a real
  follow-up search. Fast Node suite re-run green on the merged tree
  (stack-regress 5/5, test-engine 7/7, regress, search-identity pilot).
- [x] phone feel check — passed 2026-09-01 (designer, on Pages, on the
  v3-Gods build that ships this pair: extended big-board duels, verdict
  "plays pretty well" — the stall class this patch fixes did not resurface)

## The portals patch (`patches/portals.patch`) — 2026-09-17

Canon: brief §4.7 (the designer's three rules, 2026-09-17: landing on a
portal always teleports the piece to the other portal; if the other portal
is occupied they swap places; a piece standing on a portal is captured as
normal, and the attacker is teleported after the capture) plus one
placement rule (portals never on a king row, which is the promotion zone,
so no pawn ever promotes through one and the move carries no promotion).
Authored against the pinned trees on top of `dead-squares.patch` +
`thread-stack.patch` (apply in that order); 489 insertions / 14 deletions
across `types.h`, `variant.h`, `parser.cpp`, `position.h`, `position.cpp`,
`movegen.cpp`, `evaluate.cpp`, `apiutil.h`.

Design, in the engine's own shapes:

- **The PORTAL move type** (a free value of the 4-bit type field), encoded
  as `from` + the portal square P, so the notation is the plain `from``to`
  string (every move onto a portal square IS a portal move) and
  `capture(m)` reads the victim on P as stock code does. `do_move` captures
  on P as usual, then removes-and-places the mover on the twin Q and the
  twin's occupant on P (castling's remove-before-place, since Q may equal
  `from` on a twin-to-twin move: the mover ends where it stood — the
  capture at range and the quiet pass the rule implies, both generated).
  `undo_move` derives everything from the board and `capturedPiece`; the
  pair table rides the copied region of StateInfo, so a cast's undo is
  `st = st->previous` and nothing else.
- **`portal_attacks_king(m, colour)`**, one helper for legality (the
  mover's king) and `gives_check` (the enemy's): the three relocated
  squares are virtual — the victim gone, the mover on Q, the swapped piece
  on P, a king that moved or was swapped judged where he ends — and every
  other piece attacks from where it stands through the new occupancy (the
  en passant test's shape with two relocations).
- **Evasions by filtering**: in check every portal move is generated whole
  (`generate_portal_evasions`) and `legal()` decides, because a portal move
  can block through Q, block through the swapped piece, or swap a checked
  king out; the regular evasion masks drop portal squares so nothing is
  emitted twice. `pseudo_legal` validates a PORTAL TT move by regeneration
  (the stock fallback for every non-NORMAL type).
- **The cast**: a DROP of the `portalScroll` type (a new variant key naming
  a piece type that only ever lives in hand — the duel uses FSF's own
  `immobile` piece, letter `o`; two per side in the holdings `[OOoo]`).
  `do_move` places nothing: the hand loses a scroll and the caster's open
  half closes into a pair with the square, or the square becomes the
  caster's open half (`portalHalf[colour]`). Never while in check, never
  on a square a portal or a half already takes (`portal_taken()`), and the
  drop region is the variant's `dropRegionWhite/Black` (grammar: every rank
  but the king rows). A cast gives no check and passes SEE at zero.
- **The trailing FEN field** ` {c3-h8,d1-a9,e4w}` after the move counters —
  pairs as `a-b` (emitted with the lower square first), halves as the
  square plus `w`/`b` — parsed by `set()` (3check's optional trailing field
  is the precedent; entries off the board, on a promotion rank, on a wall
  or crate, or on a taken square are dropped), emitted by `fen()`,
  validated and stripped by apiutil's `validate_fen`
  (`FEN_INVALID_PORTAL_FIELD` = −15), hashed per pair and per half from a
  separate PRNG so the stock key sequence is untouched.
- **Spells are never pieces**: the extinction (strip) count uses
  `count_with_hand_spellfree`, which drops scrolls in hand; the pairs and
  halves are state, not occupancy, so no count ever sees them. The eval's
  hand term skips the scroll type (its in-hand PSQT value stays: the
  `pieceValueMg/Eg` of the scroll plus FSF's small in-hand bonus is the
  engine's eagerness knob).
- **Stock when absent**: with no portal squares and no scroll type the
  changed expressions reduce to the stock ones — verified node-for-node
  (`search-identity.cjs`) and by perft against the shipped pair.

Known gaps, on record: a PORTAL move takes the stock "simple SEE" of every
special move type (zero), as en passant does — a capture through a portal
is ordered as a neutral capture, never pruned as losing; en passant is
never offered onto a portal square; a quiet portal move that gives check
only through the twin is not found by the QUIET_CHECKS generator (the main
search finds it at depth one); the helper covers every piece `attacks_bb`
covers (Janggi's palace pieces and cannons are not on that list); the UCI
`flip` command does not turn the portal field.

### Validation (2026-09-17, this container)

Native first: a debug largeboard build with `pos_is_ok`'s full state check
narrowed to the keys, the checkers and the material (`set_state`
recomputed after every move and compared with the incremental state) and
the `givesCheck == checkers` assert in `do_move`, driven over UCI
(scratch `forge/native-test.py`): ten hand-verified fixtures — a quiet
teleport, a capture through with the swap, a king refused onto an attacked
exit and allowed onto a safe one, the enemy king swapped into check with
its 8 evasions (one a pawn capture that swaps the king out through the
portal), a twin-to-twin capture and pass, a pawn through a portal, no cast
in check, the four-cast sequence, the strip fixture — every perft 1 equal
to the hand count and every perft 3 completing under the asserts; the
portal variant with empty hands equal to the plain one at depth 3;
`go depth 8` taking a queen through the portal.

Then the rule-16 gate on the wasm pair:

- [x] `test-ffish.cjs` 19/19 · `regress-ffish.cjs` PASS (crate-free
  perft / moves / validateFen / 12x10 identical to vendored 0.7.9)
- [x] `test-portals-ffish.cjs` **42/42** — the fixtures through the JS API,
  SAN (`Rc3`, `Rxc3`, `Rc3+`, `O@c3`), push/pop round trips, the field's
  validation, the three strip fixtures decided at load, and a 5,534-move
  consistency sweep (SAN's check suffix, i.e. `gives_check`, against push +
  `isCheck` on every legal move of eight positions one ply deep): 0
  mismatches
- [x] `test-engine.cjs` 7/7 · `regress.cjs` PASS · `xcheck.cjs` PASS ·
  `search-identity.cjs` node-for-node identical to vendored 1.1.11 at d12
  (19459/26462/35136) · `stack-regress.cjs` 5/5
- [x] `test-portals-engine.cjs` **55/55** — the same fixtures over UCI,
  perft 1 and 3, the four-cast sequence through `d`, the strip rule at the
  root (`bestmove (none)`, mate 0), `go depth 10` → `c1c3`, a 10×10
  duel-shaped position with scrolls and a pair searched at depth 12 with
  the instance alive after
- [x] depth-cap re-measure (`depthcap.cjs`): d22 110/110 clean (slowest
  1621 ms), d60 30/30 clean — the cap STAYS at d22 (rule 11 unchanged)
- [x] `play/selftest.html` in headless Chromium: **47/47** (the new
  portals check: cast → link → teleport + swap → strip on the game's own
  deal variant, both binaries)
- [x] the replay page's smoke 63/63 on the new pair; ui-smoke on the real
  page with portals on for both sides: 330 ok, 0 failed
- [x] the designer's own play (2026-09-17, vaults-4, 70 plies, both pairs
  cast in the first three moves, no anomaly — the analyzer's `?sample=2`):
  "the engine seems to be VERY aware of the advantages of portals"

Build notes: `make emscripten_copy_files` needs `ARCH=wasm` on the command
line as well (the emscripten Makefile is only included under it); the
three toolchains were reinstalled from scratch this session (the container
keeps nothing) — emsdk 1.39.16 and 2.0.26 in separate checkouts, the
default net pre-downloaded next to the engine Makefile. `stockfish.js`,
`stockfish.worker.js` and `ffish.js` came out the vendored sizes; the wasms
grew 16 KB (ffish) and 18 KB (engine) for the portal code.

## The wall-kinds patch and the hammer patch (`patches/wall-kinds.patch`, `patches/hammer.patch`) — 2026-09-17

Canon: brief §4.8 (the designer's four rules, 2026-09-17: a piece with the
sledgehammer spends its move turning an adjacent wall into `^`; a property
of a piece, not a spell; designed for the kings; a second kind of wall in
the engine — `*` breakable, `#` any indestructible obstacle). Authored on
the pinned trees on top of the three patches above (apply in this order:
dead-squares, thread-stack, portals, wall-kinds, hammer); one forge
session, one build, one gate. wall-kinds: `position.h`, `position.cpp`,
`apiutil.h`; hammer: `types.h`, `variant.h`, `parser.cpp`, `position.h`,
`position.cpp`, `movegen.cpp`, `apiutil.h`.

Design, in the engine's own shapes:

- **`#`, the hard wall** (wall-kinds): parsed into `wallSquares` like `*`
  AND into a new `StateInfo::hardSquares` subset (copied with the state);
  `breakable_walls()` = `wallSquares & ~hardSquares`. A `#` is a wall to
  everything — `board_bb()` excludes it, sliders stop at it — and hashes
  with `Zobrist::hard[]`, drawn from its own PRNG so the stock key
  sequence is untouched (the portal patch's idiom): a `*` and a `#` on the
  same square are different positions, since a hammer side's legal moves
  differ. `fen()` emits `#`, the `d` display shows it, `validate_fen`
  accepts it. With no `#` on the board every changed expression reduces to
  the stock one.
- **The HAMMER move type** (`9 << (2 * SQUARE_BITS)`, the free value after
  PORTAL), encoded `from` + the wall square, so the notation is the plain
  `e1d1` (every move onto a breakable wall IS a hammer; `UCI::to_move`
  matches it off the legal list). `generate_hammers<Us>`: for every piece
  of a `hammerPieceTypes[Us]` type, `PseudoAttacks[KING][from] &
  breakable_walls()` — the eight king steps — in QUIETS and NON_EVASIONS
  only (never CAPTURES, QUIET_CHECKS or EVASIONS).
- **Legality, check, the TT**: nothing moves and the square stays blocked
  (a dead square is occupancy exactly as a wall is), so a hammer neither
  gives nor resolves check. `gives_check` answers false explicitly (stock
  would test the moved piece's attacks from the wall square — wrong for any
  hammer piece); `legal()` returns `!checkers()` (stock's king-move test
  asks whether the destination is attacked; its `board_bb() & to` assert is
  relaxed for the type, since `board_bb` excludes wall squares); the
  variant's quiet-move rules (mustCapture, mustDrop) still have their say
  first; `pseudo_legal` validates a TT hammer by regeneration, before the
  `board_bb() & to` check that would reject it. A pinned piece may hammer.
- **do / undo**: do = the wall bit off, the dead bit on, `Zobrist::wall ^
  Zobrist::dead` on the key, rule50 reset (irreversible), no piece moves
  (the castling-rights, flip-enclosed and pawn sections are skipped for
  the type; NNUE's dirty-piece count is zeroed — classical eval only, rule
  1). undo = the state pointer: the stock wall XOR at the top of
  `undo_move` and the dead-squares XOR at its bottom both touch the
  hammered square and cancel, so only the piece move is skipped, as a
  drop's is. `key_after` performs the same swap. SEE is zero by type
  (stock's simple SEE for every special move).
- **SAN**: the piece letter, `*`, the square — `K*d1`, `R*d1`; never `x`
  (not a capture), never `+` (never a check). The variant key
  `hammerPieceTypes` (a PieceSet) with `hammerPieceTypesWhite` /
  `hammerPieceTypesBlack` overrides; NO_PIECE_SET (the default) generates
  nothing.

Known gaps, on record: SAN disambiguation is skipped for a hammer (two
same-type hammer pieces beside one wall would both print `R*d1`; only
kings hammer today); a hammering pawn would print `*d1`; the cuckoo cycle
tables never hold a hammer (irreversible, correctly); the extinction count
is untouched (a hammer changes no count).

### Validation (2026-09-17, this container)

Native first: a debug largeboard build (asserts on, `pos_is_ok` after every
undo) driven over UCI (scratch `forge/native-test.py`): 28 checks — a king
beside a `*` and a `#` (5 moves, the hammer offered, the hard wall never),
the FEN and the display round-tripping `#` and `*` apart, the crate after
the hammer with the king in place and rule50 reset, no check given, the
crate captured next move, in check no hammer, a PINNED rook hammering
without leaving its file (7 moves), `#` ≡ `*` without the key at perft 3,
an all-`#` board offering no hammer, per-colour keys, a 10×10 duel-shaped
board with both kings hammering searched to depth 10 with the instance
alive, a boxed king whose quiet moves are hammers, perft 3–4 on every
fixture under the asserts (5/30/182/1338 · 7/59/508/6521 ·
6/36/241/1853).

Then the rule-16 gate on the wasm pair:

- [x] `test-hammer-ffish.cjs` **27/27** — the fixtures through the JS API,
  SAN (`K*f2`, `R*f2`, `Kxf2` for the capture after), push/pop round
  trips, `validateFen` on `#`, perft 1–4 equal to the native counts, the
  strip rule untouched, and a 1,505-move check-flag sweep on hammer boards:
  0 mismatches
- [x] `test-hammer-engine.cjs` **25/25** — the same fixtures over UCI,
  `d`, the twins at perft 3, the depth-10 and depth-8 searches
- [x] `test-ffish.cjs` 19/19 · `regress-ffish.cjs` PASS (crate-free /
  wall boards identical to the vendored 0.7.9) · `test-portals-ffish.cjs`
  42/42
- [x] `test-engine.cjs` 7/7 · `regress.cjs` PASS · `xcheck.cjs` PASS ·
  `search-identity.cjs` node-for-node identical to the vendored 1.1.11 at
  d12 (19459/26462/35136) · `stack-regress.cjs` 5/5 ·
  `test-portals-engine.cjs` 55/55
- [x] depth-cap re-measure (`depthcap.cjs`): d22 110/110 clean (slowest
  1613 ms), d60 30/30 clean (slowest 10022 ms) — the cap STAYS at d22
  (rule 11 unchanged)
- [x] `play/selftest.html` in headless Chromium: **48/48** (the new
  sledgehammer check on the game's own deal variant, both binaries)
- [x] the game's Node and browser gates on the vendored pair (CLAUDE.md,
  the sledgehammer paragraph)

Build notes: the three toolchains were reinstalled from scratch again (the
container keeps nothing; the two emsdk installs, the two trees and the net
took about twenty minutes wall-clock, scripted in the session's scratch);
`ffish.js`, `stockfish.js` and the worker came out the vendored sizes; the
wasms grew 2.5 KB (ffish) and 5 KB (engine). The stock pair now REFUSES a
`#` board ("Invalid piece character"), so a phase0 run that forgot the
overlay dies at once instead of misplaying.

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
FFISH_JS=... node engine/tests/test-portals-ffish.cjs                   # the portal spell, ffish half (42)
ENGINE_JS=... node engine/tests/test-portals-engine.cjs                 # the portal spell, engine half (55)
FFISH_JS=... node engine/tests/test-hammer-ffish.cjs                    # the hard wall + the sledgehammer, ffish half (27)
ENGINE_JS=... node engine/tests/test-hammer-engine.cjs                  # the hard wall + the sledgehammer, engine half (25)
node engine/tests/stack-regress.cjs                                      # P60 stack-overflow kill-fixture: completes + SURVIVES (no env: guards play/vendor)
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

Context: rule 11's crash family — `fairy-stockfish/fairy-stockfish.wasm`
issue #14 ("pthread issue", open since 2024-01) — is DIAGNOSED as of
2026-08-27: it is the largeboard search-thread stack overflow fixed by
`patches/thread-stack.patch` (see "The stack patch" above; upstream FSF
issue #804, structural fix in draft PR #1031).
