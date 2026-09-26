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
patch" below). Played the same day — the first sledge duel, on the phone
(designer: "Seems to work pretty good on mobile… I definitely saw the engine
go for at least one sledge move, so it definitely evaluates the option"; the
log is the analyzer's third sample, `replay/samples/dck-log_vaults-4-t109_
s3010228489.json` — one K*e4 played, the reply the engine's own depth-22
search had predicted, and four more hammers in its lines).

**Status 2026-09-18: THE PORTALS-V2 PATCH shipped.** `patches/portals-v2.patch`
(650 lines across `position.h`, `position.cpp`, `movegen.cpp`, applied on
top of the five above, in that order — six patches now) gives the engine
brief §4.7's Portals v2: a linked portal square is a BODY to every line and
an EMPTY PAIR a TUNNEL for riders, chained once per pair per line. Both
artifacts rebuilt from clean pinned trees; validated natively against an
INDEPENDENT Python oracle on 1,500 random positions before any WASM was
built; the rule-16 gate ran green end to end (see "The portals-v2 patch as built"
below). Phone verdict 2026-09-19 (designer): "Seems to work fine on the
phone" — IN.

**Status 2026-09-19: THE PORTALS-V3 PATCH shipped — the one-turn cast.**
`patches/portals-v3.patch` (185 lines across `position.h`, `position.cpp`,
`movegen.cpp`, `apiutil.h`, applied on top of the six above — seven patches
now) gives the engine brief §4.7's Portals v3: an open half FREEZES the
other side (its one legal move is a pass) and BINDS its caster to the
linking casts; a pass FIZZLES a half no link can close. Both artifacts
rebuilt from the clean pinned trees; validated natively against the
Python oracle extended with scrolls, halves and passes (1,800 random
positions, the sweep, the fixtures under asserts); the rule-16 gate ran
green end to end (see "The portals-cast patch" below). On the way it closed
a gap in portals.patch: an ordinary move onto a portal square was
pseudo-legal, so a colliding transposition-table move could be tried as a
non-teleporting move.

**Status 2026-09-19 (later the same day): PORTALS v4 — THE TUNNEL RETIRED.**
`patches/portals-v2.patch` is REPLACED by `patches/portals-body.patch` (263
lines across `position.h`, `position.cpp`, `movegen.cpp`: the body rule
alone — a linked portal square ends every line — with every tunnel
construct removed: `open_portals` / `portal_through` / `tunnel_attackers`,
the tunnel movegen, the whole-board evasions, the tunnel checks, the
linking cast's exposure and check tests), and `patches/portals-v3.patch` is
REBASED on it as `patches/portals-cast.patch` (185 lines, the one-turn cast
unchanged in substance). Seven patches still, applied in order:
dead-squares, thread-stack, portals, wall-kinds, hammer, portals-body,
portals-cast. The designer, on the s88 log: "Let's make v3 portals without
the pass thru moves… Everything going thru a portal simply lands on the
exit portal now, swapping if there's something there." Both artifacts
rebuilt from the clean pinned trees; validated natively against the
oracle with its pass-through removed (62 fixtures on the debug build with
asserts on, 1,800 random positions, the sweep, perft 4); the rule-16 gate
ran green end to end (see "The portals-body patch" below). Portal-free
boards are node-identical to the seven-patch build before it; a board
with SCROLLS IN HAND is not portal-free to a search (it casts pairs deep
in the tree, where the rules differ), so the identity check reads boards
with no pair and no scroll. Verdict 2026-09-20 (designer): "Alright this
works pretty good" — IN.

**Status 2026-09-20: THE ICE PATCH shipped.** `patches/ice.patch` (1,095
lines, +677/−21 across nine files — `types.h`, `variant.h`, `parser.cpp`,
`evaluate.cpp`, `position.h`, `position.cpp`, `movegen.cpp`, `apiutil.h`,
`uci.cpp` — applied on top of the seven above: EIGHT patches now, in order
dead-squares, thread-stack, portals, wall-kinds, hammer, portals-body,
portals-cast, ice) gives the engine brief §4.9: SLIPPERY SQUARES of any
shape (`~e5` entries in the trailing FEN field), the SLIDE move type (a
piece whose move ends on ice glides on in its own direction until floor,
an obstacle or a pit; momentum passes to a piece it hits standing on ice;
an empty portal square on the way is a landing), THE PIT `_` (a hole the
engine tells from bedrock: nothing enters it by a move, a sliding piece
falls into it and is gone; a side whose king fell has lost), and THE ICE
SCROLL (`iceScroll`, a custom immobile piece dropped on the middle rows,
one ply, never in check: the 3×3 around the square turns slippery). Both
artifacts rebuilt from the clean pinned trees; validated natively against
the independent Python oracle grown for the ice (55 fixtures, 4,200
random positions, the sweep, perft 4 under asserts) before any WASM was
built; ice-free boards node-identical to the seven-patch build; the
rule-16 gate ran green end to end (see "The ice patch" below). The phone
verdict is owed.

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
so no pawn ever promotes through one and the move carries no promotion —
the engine's floor; the game's deal keeps a cast TWO rows off since
2026-09-20, in the ini alone: `variant.mjs portalIniKeys`).
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
  drop region is the variant's `dropRegionWhite/Black` (grammar; the game's
  deal emits ranks 3…R−2 since 2026-09-20 — two rows off each king row, an
  ini rule — and every rank but the king rows before, which these tests'
  own variants keep). A cast gives no check and passes SEE at zero.
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

## The deck patch and the deck-search patch (`patches/deck.patch`, `patches/deck-search.patch`) — 2026-09-26

Canon: brief §4.10 "Phase 3.3 — the engine's deck" (the designer, 2026-09-25:
"I need an engine that actually sees the deck and understands that both
players will draw more cards. An engine that plays at a super human level
is of upmost importance. I thought I was clear on the last session that the
entire card and deck mechanic needs to work at the FSF engine level"; "will
it see the crazy powerful card at the bottom of the deck and understand that
it can repeatedly mulligan hands to get to it? I need that level of
foresight"; the standing rule: NO CARD IS EVER VALUED BY A NUMBER; "The only
cards you are legally allowed to play while in check are Undo and Reveal. No
exceptions."). Authored on the pinned trees on top of the eight patches above
(apply in this order: dead-squares, thread-stack, portals, wall-kinds, hammer,
portals-body, portals-cast, ice, deck, deck-search). deck: `types.h`,
`variant.h`, `parser.cpp`, `position.h`, `position.cpp`, `movegen.h`,
`movegen.cpp`, `apiutil.h`, `uci.cpp`, `psqt.cpp`; deck-search:
`movepick.cpp`, `search.cpp`. The source of both is
`engine/forge/apply-deck.py` + `apply-deck-search.py` (anchor-based edits;
the patch files are their diff against the eight-patch tree).

Design, in the engine's own shapes — THE FEN IS THE DECK:

- **Cards are SLOTS, not letters.** A hand lives in the holdings as custom
  immobile pieces `s..z` (`cardSlots = stuvwxyz`; the parser adds them from
  `CUSTOM_PIECES_END − 1` downward with an empty Betza), one letter per copy,
  and every slot is BOUND per colour to a card ID by the FEN's trailing field
  — `S=w12` (White's slot s holds card 12; `+` after the id marks the slot
  whose portal half stands open), the binding read while the slot's count in
  hand is > 0. The ini declares `card<ID> = portal | ice | win | meta` for
  every ID a deal's decks hold and `handSize = 4`. So a deck of a hundred
  unique cards costs no letters (the designer: "Expect full decks of entirely
  unique cards"), identical cards share a slot (count 2 = two copies), and
  what a slot DOES is a property of the deal, not of the engine.
- **The pile rides the FEN** — `w|12.7.33`, top first, the cards still to
  draw (both piles visible to both sides, the designer's ruling) — in
  `Position::pile[c][MAX_PILE]` / `pileLen[c]`, and THE POINTER IS A COUNT OF
  THE REMAINDER, `StateInfo::pileLeft[c]` (copied with the state): a search's
  root position is re-set from `pos.fen()`, which prints the remainder alone,
  with the setup state copied over it (`Threads::start_thinking`), so a
  pointer that counted the DRAWN cards pointed past the re-parsed pile and
  the mulligan vanished at every root reached by moves (the first cut's bug,
  found by the dig probes: `go perft 1` on a position reached by moves listed
  71 moves, the same FEN parsed fresh 72). A count of what remains is
  invariant under the re-parse.
- **THE DRAW is inside `do_move`.** At the end of every move, `refill(them)`
  draws the side ABOUT TO MOVE up to the hand size (an identical card joins
  its slot, a new card takes the lowest free slot that is not the open cast
  slot; `st->rule50 = 0` — a draw is irreversible), recording each draw in the
  state for undo — except while a portal half stands open (the frozen side's
  pass and the caster's link ply: that turn began before) and after a win
  card. So the search sees every draw within its horizon and the hand it
  searches on is next turn's hand, both piles included.
- **THE MULLIGAN is a move**: type `MULLIGAN` (11 in the 4-bit field, after
  SLIDE), `make<MULLIGAN>(ksq, ksq)`, UCI `@@@@`, SAN `redraw`; generated in
  QUIETS / NON_EVASIONS when `mulligan_allowed` (a deck on, a king, not in
  check, no half open, a card left on the pile, no winner); `do_mulligan`
  discards the whole hand (the discards vanish — the spent pile is the
  game's to name from the deck as shuffled) and refills; legal by the rule,
  never a check, `key_after` unchanged, undo by the state.
- **A CAST is the slot's drop, by kind.** `generate_drops` reads
  `card_kind(Us, pt)`: a PORTAL card opens a half like the scroll (the half
  MARKS its slot with `castSlot`, spends nothing; the link — or the fizzle —
  spends the card; `portal_cast_type` is the marked slot, so the one-turn
  cast machinery is untouched); an ICE card casts on `ice_cast_region` (the
  two middle rows of the board for a slot, the custom piece's mobility region
  for the legacy scroll) — and NEVER A NULL CAST: a cast whose 3×3 would ice
  nothing (every floor square of it already slippery) is not generated, for
  the legacy scroll too, since a cast that changes nothing would be a pass
  and the game has none (this re-pinned four ice perft-3 counts and the
  10×10 duel shape's perft 2 in `test-ice-*`: 48,633 → 47,168 / 59,174 →
  57,749 / 44,233 → 42,861 / 7,859 → 7,799 / 4,453 → 4,429); a WIN card casts
  on the caster's own king (`!w` in the field, `is_immediate_game_end` first
  — the other side has no move), the test-only You Win card; a META card
  (Reveal, Undo — the player's alone) is a blank the engine never casts.
  **No card is cast in check** (`generate_drops` returns at once; `legal()`
  refuses a slot drop in check; the portal card's drop too) — the designer's
  rule, no exceptions but the meta cards, which the game plays outside the
  move grammar by rewriting the hand.
- **Cards are never pieces** — `is_spell_scroll` covers the slots, so the
  extinction count skips them (a bared king with a hand has lost),
  `capture()` / `capture_or_promotion()` are false for a cast and a mulligan.
- **THE HASH is content, not layout.** Zobrist `castSlot` / `cardWinner`
  tables from their own PRNG (the stock key sequence untouched);
  `card_key(c, id, n)` per slot with a card (the ID and the count, NOT the
  slot letter — two layouts of one hand are one position), `pile_key(c,
  fromBottom, id)` per remaining card by its index FROM THE BOTTOM, so a
  fresh parse of the remainder hashes identically to the incremental state
  (the xsweep found 274 "BAD state" lines when the pointer was hashed).
- **A card in hand is worth NOTHING to the eval** (`psqt.cpp`): stock gives
  every piece in hand its value plus a flat `(35, 10) × (1 + !isSlider)`, which
  had priced a value-0 scroll at 35–70 centipawns since the portal patch — a
  number on a spell. The in-hand piece-square score of a portal scroll, an
  ice scroll or a card slot is `SCORE_ZERO` now (measured: `eval` on
  `4k3/p7/8/8/8/8/8/R3K3` gives +3.62 with no cards, `[ST]`, `[STUV]` + a
  pile, `[st]`, `[O]` and `[o]` alike; it had read +3.77 / +3.85 / +3.54 /
  +3.85 / +3.46). The `hand()` term already skipped scrolls. So the engine
  casts a card when the position after the cast is better and for no other
  reason — the standing rule, in the engine.
- **The FEN grammar** (`check_portal_field` in apiutil.h accepts it):
  `{c3-h8,e4w,~e5,w|12.7.33,S=w12+,T=w7,b|1,S=b2,!w}` — the pairs, halves
  and ice as before, then per colour its pile and its bindings, then the
  winner; printed in that order, read in any.
- **deck-search.patch — THE DIG IS NEVER PRUNED.** The mulligan and a win
  card's cast (`is_dig_move`) are never skipped by move-count pruning (a
  `generate_dig` list stands in for the quiets when `skipQuiets`, and the
  QUIET stage's predicate lets a dig through), never pruned at shallow depth
  (Step 13), never reduced by LMR (Step 16), and a win card's cast is ordered
  first among the quiets (`+1 << 24` in `score<QUIETS>`). So the deck's
  horizon is the search depth and nothing shorter: on a counterplay-free
  board (kings, two blocked pawns sealed behind walls) with the win card
  under A ice cards, the native release reports the exact mate — in 2 / 3 /
  4 / 5 / 6 / 7 / 8 / 9 for A = 0 / 4 / 8 / 12 / 16 / 20 / 24 / 28 — at depth
  3 / 5 / 7 / 9 / 12 / 13 / 22 / 23, the mate in 9 (eight mulligans deep) in
  9.6 s (`engine/forge/horizon.py`; before the in-hand zero the same probe
  read 3 / 6 / 8 / 16 / 16 / 15 / 17 / 17 — a hand that weighs nothing digs
  cleaner). THE MIRROR (`horizon.py --mirror`: the deck on Black, White to
  move with nothing to do): the engine reads the mate AGAINST it — mate −2 …
  −9 at depth 4 / 6 / 8 / 17 / 19 / 20 / 22 / 24, the −9 in 8.8 s — so it sees
  the opponent's dig as well as its own. The fixture is D11 in
  `native-test-deck.py`. Scroll-free boards are node-identical to the
  eight-patch build with the policy applied (perft 3 = 61,433 and the
  depth-12 transcripts on five boards): the dig exists only where a deck is.
- Not in this patch, on purpose: the pass-through tunnel, a value knob, a
  per-card region, the meta cards' effects (the game's), and any card kind
  beyond the four (the terrain interpreter is 3.3b's forge).

### Native validation (2026-09-26)

THE ORACLE FIRST: `engine/forge/oracle.py` grew the deck — slots, piles,
the binding rule, the draw at the hand-over, the mulligan, the four kinds,
the null-cast rule, `from_fen` with the deck field — and every fixture count
in `native-test-deck.py` (D1–D13) was derived by it before the engine ran it
(`deck.ini`: deck8 / deck6 / deck10, IDs 1–9 ice, 10–19 portal, 20–29 win,
30–39 meta). On the release and the debug build with asserts on: the fixtures
**55/55** (the start and the draw, the win card on the spot and black
moveless after it, the mulligan and its clock reset, the portal card's half /
frozen pass / link / spend, the fizzle spending the card, identical cards
merging, no card in check, a bared king with cards lost, THE DIG on the
sealed board — mates in 2 / 3 / 4 / 5 by depth 4 / 8 / 10 / 18 — and under
counterplay, the 10×10 duel shape perft 2 = 6,930, and D13 THE ROOT BY MOVES:
two mulligans and two pawn moves in, the position searches on the same 72
moves as its own FEN and finds the third mulligan's mate in 2); **500 (seed
21) + 400 (seed 7) random deck positions** (6×6 / 8×8 / 10×10, hands, piles,
halves, ice, pits) equal to the oracle on perft-1 move sets and perft-2
per-move counts under `xsweep 2` (pseudo_legal / legal / gives_check / the
incremental state against a fresh parse / the undo); perft 4 on seven deck
fixtures under asserts; the legacy suites on the deck build — portals
63/63 + 300 random + sweep, ice 47/47 + 300 random + sweep; identity on
scroll-free boards vs the eight-patch release (perft 3 and depth-12
score / nodes / bestmove on five boards) IDENTICAL. Two bugs the sweeps and
probes caught before any WASM was built: the drawn-count pointer at a
re-parsed root (above) and the undo assert that had never learned the
mulligan.

### The rule-16 gate (both WASM binaries rebuilt from the clean pinned trees)

`ffish.js` differs from the vendored in 11 bytes and `stockfish.js` in 9
(the static memory layout constants) and the worker is byte-identical; the
wasms +22,386 / +36,037 bytes.

- [x] `test-deck-ffish.cjs` **39/39** — the deck field through validateFen and the round trip, the casts and the mulligan among the legal moves, SAN `S@e4` / `redraw` / `--`, the draw at the hand-over, push/pop through a cast and a mulligan, the one-turn portal card (the marked slot, the frozen pass, the link's spend, the fizzle's spend), identical cards in one slot, no card in check, a bared king with cards lost, the root by moves equal to its FEN, the 10×10 duel shape's 198 moves, a 3,917-move check-flag sweep with 0 mismatches
- [x] `test-deck-engine.cjs` **58/58** — perft 1 sets and perft 3 totals pinned to the native build on every fixture (D1 24,842 · D2 10,654 · D3 7,447 · D4 9,310 · D5 130,298 / 15,562 · D6 42,190 / 1,793 / 50,387 / 25,697 · D7 13 / 4 / 4 · D8 7,395 · D9 11,593 · D11 10,599 · D13 45,461; the 10×10 duel shape perft 1 = 198, perft 2 = 12,316), the FEN after every key move through `d`, the win card played on the spot, THE DIG (mate in 2 / 3 / 4 by depth 4 / 8 / 10, the root by moves' mate in 2, mate in 3 under counterplay), a depth-12 search alive on the 10×10 shape with two decks
- [x] `test-ice-ffish.cjs` 53, `test-ice-engine.cjs` 79 (re-pinned for the null-cast rule, above), `test-portals-ffish.cjs` 78, `test-portals-engine.cjs` 146, `test-hammer-ffish.cjs` 27, `test-hammer-engine.cjs` 25, `test-ffish.cjs` 19, `test-engine.cjs` 7
- [x] `regress.cjs` + `regress-ffish.cjs` — crate-free positions identical to the shipped pair; `xcheck.cjs` — ffish and engine agree on every crate fixture; `stack-regress.cjs` 5
- [x] `search-identity.cjs` — node-for-node identical to the vendored eight-patch engine at depth 12 (19,459 / 26,462 / 35,136 nodes)
- [x] `depthcap.cjs` — d22 110/110 (slowest 1,392 ms), d60 30/30 (slowest 10,021 ms, the movetime) — **the cap stays at d22**
- [x] the game's gates on the vendored pair: selftest **52/52** headless (THE DECK IN THE ENGINE check: the deal variant, the opening deal, 32 portal + 16 ice casts and the redraw, the engine's draw at the hand-over, the redraw merging two ices and drawing the win card, `U@e1` ending the game, engine perft = ffish, bestmove `@@@@` mate 2), test-deck 65, test-deck-duel 46, test-ice-game 42, test-portals-game 27, test-logreport 79, test-cards 57, test-barrier 170, test-armygen, test-world 132, test-enemy 100, test-army 131, test-dungeon 96, test-camera 80, test-debris 76 — and the page's, in `play/README.md` § "The deck in the engine"

## The ice patch (`patches/ice.patch`) — 2026-09-20

Canon: brief §4.9 (the designer's rules, 2026-09-20: "a sliding piece
should keep sliding until it's not on a slippery surface anymore. Or until
it hits a wall or another piece"; "Sliding pieces can fall into holes and
die. So I guess we do in fact need to differentiate between holes and
indestructible walls"; "either king can slide and fall into a hole, just
make a move illegal if ends with your king dead or in check, just like
always"; "don't assume that every slippery patch is always going to be a
3x3 placed spell"; momentum transfers when a slider bumps a piece on the
ice; a portal square is never slippery). The eighth patch, applied after
portals-cast; the scripted edit that produced it is in the forge's scratch
(`apply-ice.py`), the patch itself the record.

- **The glyphs and the field** (`position.cpp`, `apiutil.h`, `uci.cpp`):
  `_` on the board is a PIT — parsed into `holeSquares` ⊂ `hardSquares` ⊂
  `wallSquares` (so every reader that knows `#` treats it as an obstacle a
  move never enters), emitted and printed as `_`, hashed by `Zobrist::hole`
  from its own PRNG (seed `0x165667B19E3779F9`, with `Zobrist::slick`; the
  stock key sequence untouched). `~sq` entries in the trailing `{}` field
  are the SLIPPERY squares, `slickSquares` in the copied state region;
  `slick_effective()` = slick & ~portalSquares (a portal square is never
  slippery). A pawn's promotion where its slide stops prints `=Q` in SAN;
  the check suffix reads the real checkers after the slide.
- **The SLIDE move type** (`types.h` type 10, after HAMMER): encoded on the
  ENTERED square, plain `e2e4` notation (+ the promotion letter when the
  pawn STOPS on its zone — `slide_promotion(m)` in the promotion bits;
  `uci.cpp` prints the char). Movegen (`movegen.cpp` `emit_slide` and the
  hook): a NORMAL, EN_PASSANT or PROMOTION move whose destination is
  slick-effective and whose line has a direction (`slide_direction`,
  Direction(0) for a leap — a knight lands where it jumps) becomes a SLIDE;
  a RIDER's quiet move onto ice is emitted only at the LAST empty ice
  square before what stops it (skipped when the next square is empty and
  reachable — the folded moves would end where the plain move past the ice
  does), pawns, kings and every capture always emitted; promotion variants
  when the resting square is in the zone. In check, `generate_slide_evasions`
  generates the slides whole and filters (a slide may block, capture the
  checker, or carry the king out), slick squares masked out of the regular
  evasion target so no move onto ice is generated twice.
- **The physics** (`Position::slide_outcome`): from the entered square,
  in the move's direction — the next square off the board, a wall or a
  crate: stop here; a pit: FELL; an empty portal square: a LANDING (out of
  the twin, swapping with whatever stands there; the swap step recorded
  BEFORE the mover's, since a slide can exit onto the square it came from
  through a pair); a piece on ice: SHOVED (the momentum passes: the slider
  stops, the hit piece slides on the same way, chained); a piece on floor:
  stop before it; empty ice: on; empty floor: land. Every relocation is a
  `SlideStep { from, to | SQ_NONE, before, after, wasPromoted }` in the
  StateInfo's not-copied region (`MAX_SLIDE_STEPS` 16), so `do_move`
  applies the list castling-style and `undo_move` walks it backwards off
  the state pointer. A shoved pawn that stops on its zone promotes to the
  strongest piece (the mover's to the letter the move names).
- **Legality and check** (`position.cpp`): `slide_attacks_king` judges a
  SLIDE on the virtual board after every relocation — the mover's king
  fallen (`SQ_NONE`) or attacked → illegal; the enemy king attacked (or
  fallen) → `gives_check`. `pseudo_legal` refuses a NORMAL-typed move onto
  a slick square with a direction (movegen encodes it as SLIDE — the
  transposition-table collision the one-turn cast's gate found for
  portals), and validates a SLIDE by regeneration. No en passant square is
  set after a SLIDE; a slide whose capture WAS en passant carries
  `st->slideEp` so the capture square is right in `do_move` / `undo_move`
  / SEE. `see_ge` prices a SLIDE by its capture alone (the captor leaves
  the square, so nothing recaptures there).
- **The game's end**: `is_immediate_game_end` — while any square is slick,
  a side without a king has LOST (the engine scores it as mate; a kingless
  side has no legal move, so ffish's `isGameOver` reads it too).
- **The scroll** (`variant.h` / `parser.cpp` `iceScroll`; `movegen.cpp`
  `generate_drops`; `evaluate.cpp`): a custom piece with an empty Betza
  string (`customPiece1 = i:`, immobile) named by `iceScroll`; its drop —
  `I@e5` for either side — is generated on the intersection of the drop
  region and the piece's MOBILITY region (the cast rows), on occupied floor
  too, never on a wall, a crate or a pit, never in check, never while a
  portal half is open (the in-cast branch drops the portal scroll alone);
  `do_move` adds `ice_patch(s)` (the 3×3 ∩ `board_bb` ∩ ~dead squares) to
  the slick set and spends the scroll, `undo_move` restores the set off the
  state. `is_spell_scroll` keeps every scroll out of the extinction count
  and the eval's in-hand term (a scroll is never a piece).

Stock when nothing is slick and no scroll is in hand: the SLIDE branches
sit behind `slick_effective()`, the drops behind `iceScroll`, and the
game-end check behind the slick set; ice-free boards are node-identical to
the seven-patch build (fixed-depth transcripts identical on five boards —
plain 8×8, with a pair, with walls and crates, 10×10, 6×6 — native).

### Native validation (2026-09-20)

`engine/forge/oracle.py` grew the ice from the rule text (`TERRAIN`
`*#^_`, `slippery`, `slide`, `promote`, `cast_ice`, the rider dedupe in
`legal_moves`, a missing king ending the game, `~sq` in `to_fen` /
`from_fen`, `random_position(ice='patch' | 'scatter' | 'floor' | 'mixed')`);
`native_test_common.py` is the shared UCI driver, `native-test-ice.py` the
fixtures I1–I13 (every count derived with the oracle before the engine
ran them), `ice.ini` the test variants (`ice8` / `ice6` / `ice10`: the
portal variants + the scroll, cast rows the two middle ranks);
`apply-xsweep.py` puts the scratch-only `xsweep` command into a tree.

| check | result |
|---|---|
| the fixtures — a run of ice, the shove and the capture, a king onto ice, a pit behind the ice (the king may not slide in), the enemy king shoved into a pit (game over), a chain of knights and a gap in it, a pawn's push and double step sliding, a slide onto the promotion zone, a shoved pawn promoting to the strongest, a rook and a knight into a pit, a slide into a portal as a landing (the twin plugged, a knight on the portal square an obstacle), the casts (16 on rows 4–5, under a knight, not on a wall, none in check, none for the frozen side), a knight landing where it jumps, evasions that slide, a shove that gives check, a pinned rook that may not slide off the rank, en passant onto ice promoting at the end, a shoved king with no check, the 10×10 duel shape | **55/55** on the debug build (asserts on) and the release, the sweep clean |
| random positions vs the oracle — 6×6 / 8×8 / 10×10, kings and 2–7 pieces, walls, crates and pits, a pair on a third, scrolls in hand, ice as a 3×3 patch / scattered / most of the floor: perft-1 move sets and perft-2 per-move counts | **4,200: 0 mismatches**, `xsweep` clean (pseudo_legal / legal / gives_check / the incremental state / the undo) |
| debug perft 4 on 9 fixtures (`givesCheck == checkers`, `pos_is_ok`, the undo) | completed, no assert |
| the portal fixtures on the ice build (`native-test.py`) | 62/62, sweep 71/71 |
| ice-free identity vs the seven-patch native build | depth-12 transcripts identical on five boards |

TWO REAL BUGS the oracle caught before any WASM was built: a slide into a
portal recorded the mover's arrival before the twin's occupant left, so
`do_move` clobbered the piece and `slide_attacks_king` misread the king's
square (a king ending attacked on j9 read as legal) — the swap step is
recorded first now; and a leaper's move onto ice in check was generated
as an evasion off the check line — the slide evasions take the evasion
target.

### The rule-16 gate (both WASM binaries rebuilt from the clean pinned trees)

`ffish.js` and `stockfish.js` differ from the vendored in seven bytes each
(the static memory layout constants — the data segment grew with the new
Zobrist tables and the slide storage) and the worker is byte-identical;
the wasms +18,109 / +19,403 bytes.

- [x] `test-ice-ffish.cjs` **53/53** — the fixtures through the JS API, SAN (`Ra4`, `Rxa5`, `d5=Q+`, `I@e4`), push/pop along a slide, the field kept, the fallen king's game over, a 3,932-move check-flag sweep with 0 mismatches
- [x] `test-ice-engine.cjs` **79/79** — perft 1–3 on every fixture over UCI pinned to the native build (I1 981, I2 1,486, I3 1,440 / 1,228 / 551, I4 1,787 / 2,023, I5 320 / 764 / 7,435, I6 3,402, I7 742 / 1,195, I8 946 / 1,292 / 1,468, I9 48,633 / 59,174 / 44,233 / 7,859, I10 454, I11 704 / 2,985 / 1,481, I12 379, I13 494; the 10×10 duel shape perft 1 = 107, perft 2 = 4,453), `d` with the pit and the ice, the boards after the key moves, the search finding the shove into the pit (`e1f1`), a search alive on a floor of ice
- [x] `test-portals-ffish.cjs` 78, `test-portals-engine.cjs` 146, `test-hammer-ffish.cjs` 27, `test-hammer-engine.cjs` 25, `test-ffish.cjs` 19, `test-engine.cjs` 7
- [x] `regress.cjs` + `regress-ffish.cjs` — crate-free positions identical to the shipped pair; `xcheck.cjs` — ffish and engine agree on every crate fixture; `stack-regress.cjs` 5
- [x] `search-identity.cjs` — node-for-node identical to the vendored seven-patch engine at depth 12
- [x] `depthcap.cjs` — d22 110/110 (slowest 1,533 ms), d60 30/30 (slowest 10,023 ms, the movetime) — **the cap stays at d22**
- [x] the game's gates on the vendored pair: `test-ice-game.mjs` 42 (the grid's physics against ffish on the fixtures and 1,142 random slides), selftest 51/51 headless (the ice check on the deal variant), ui-smoke 318 ok (THE ICE block), facing-walk 108/108, replay-smoke 76, test-logreport 61, test-world 132, test-barrier 170, test-portals-game 27, the other Node gates unchanged

## The portals-cast patch (`patches/portals-cast.patch`, was `portals-v3.patch`) — 2026-09-19

The one-turn cast, rebased on the body-only patch when the tunnel was
retired later the same day (Portals v4, below). In substance unchanged:
the two conflicts of the rebase were the tunnel's evasion block in
`generate_all` (gone) and the three tunnel declarations in `position.h`
(gone). ONE RULE CHANGED BY THE REBASE, not by this patch: the caster's
pass FIZZLES only when no castable square is left — v2's self-exposure
filter on the link (a twin that would open an enemy slider onto the
caster's king THROUGH THE NEW TUNNEL) has no tunnel to test any more, so
every castable square is a legal link; the fizzle stays as the safety net
and is unreachable on a real board. The v3 record follows as written.


Canon: brief §4.7 "Portals v3 — the one-turn cast" (the designer: "Is it
possible to make it so both portals are placed in one turn instead of
two?" — then "It might make portals too strong but let's go ahead and try
it"). A free pair as ONE move is quadratic (about 1,000–2,400 legal casts
at every node on a 10×10 while the scrolls are in hand; `MAX_MOVES` is
8,192 in this build, so the array holds them and the search does not), so
the one turn is three alternating plies the other side cannot use — the
engine stays an ordinary alternating engine and nothing in `search.cpp`
moves. Authored on the pinned trees on top of the six patches before it
(apply in that order); 81 insertions / 3 deletions across four files.

Design, in the engine's own shapes:

- **The state is the FEN's.** Nothing new is carried: `Position::half_open()`
  (either side's half stands; for `do_move`, where the new state's checkers
  are not yet set) and `in_cast()` (the same and nobody in check) read the
  portals patch's `st->portalHalf[c]`. Which side is bound is who owns the
  half: its caster to the link, the other side to a pass. A half never
  outlives the link ply (linked or fizzled), so "the opponent's half is
  open" IS "frozen" — no flag, no grammar change, a bare `position fen`
  reproduces the legal move set exactly.
- **movegen** (`generate_all`, before anything else, never for EVASIONS):
  when `in_cast()`, CAPTURES yields nothing; the caster's ply yields
  `generate_drops` of the scroll alone (the existing drop generator, so the
  king rows, the taken squares and the in-check rule hold) plus the PASS
  `make<SPECIAL>(ksq, ksq)` — FSF's own pass move, printed `e1e1` by UCI —
  and the frozen side's ply yields the pass alone; QUIET_CHECKS carries no
  pass (a pass never checks). Then `return`.
- **legal()**: a pass inside a cast is legal for the frozen side, and for
  the caster only when NO linking cast is legal — the fizzle: the casts of
  `MoveList<QUIETS>` judged by the position's own `legal()` (v2's
  self-exposure test, `portal_attacks_king`), a list of at most a few
  dozen. `pseudo_legal()`: inside a cast the move set is that short list,
  so a transposition-table or killer move is validated by regeneration
  (`MoveList<NON_EVASIONS>.contains`) — a colliding ordinary move can
  never slip through the frozen or the link ply.
- **gives_check()**: a pass is never a check (stock's blocker logic would
  have read a king standing between its own rook and the enemy king as
  discovering a check by not moving — latent for FSF's pass variants,
  ruled out here). **do_move()**: `st->pass` is set only for a VARIANT's
  pass (`pass` / `wallOrMove`), never for a cast's, so FSF's double-pass
  game end (`st->pass && st->previous->pass` → draw) never fires on a frozen
  pass followed by a fizzle; the fizzle clears the caster's half and XORs
  its Zobrist key out (`undo_move` restores it with the state pointer; no
  scroll returns). The two asserts that name a pass accept a portal
  variant's. **key_after()**: a pass moves nothing (stock XORed the king's
  square once too often for `from == to`), and the fizzle takes the half's
  key with it.
- **SAN** (`apiutil.h`): a pass in a portal variant prints `--`; the check
  suffix never applies.
- **Closed on the way — portals.patch's gap**: `pseudo_legal()` let a
  NORMAL-typed move onto a portal square through its fast path (movegen
  encodes every such move as PORTAL). A colliding transposition-table move
  (the 16-bit key check) could therefore be tried as a move that lands on
  the portal square without teleporting — found by the debug build's
  MovePicker assert during the one-turn cast's search tests, at
  `4k3/3p4/8/8/8/8/3P4/4K3[oo] b - - 0 2 {c4-e7}` with `e8e7` typed NORMAL.
  Now `type_of(m) == NORMAL && (portalSquares & to)` is not pseudo-legal.

Stock when no half stands: the early return, the legality branches and the
pass paths are behind `in_cast()` / `is_pass()`; portal-free boards are
node-identical to the six-patch build (perft 3 = 61,433 on the v1 gate's
opening; depth-12 transcripts identical — bestmove, nodes 62,772 / 9,297 /
464, score — on three plain positions, native).

### Native validation (2026-09-19)

`engine/forge/oracle.py` grew the rules from the text: scrolls in hand
(`hand`), the open half per colour (`half`), the opening cast, the link
with its self-exposure test, the frozen pass, the fizzle, and `from_fen`
so the fixtures are loaded, not rebuilt. `native-test.py` drives a native
largeboard build over UCI (`--fixtures --random N --sweep --depth D`; the
scratch tree's `xsweep` learnt the fizzle rule: a pass at a link ply is
legal iff no cast is).

| check | result |
|---|---|
| the fixtures (the v2 set + V3a–e: 46 casts beside 6 piece moves; after `O@c4` black's one move `e8e8`; after the pass 45 linking casts and nothing else; the link `{c4-f5}` with black free on 50 moves; the searches — frozen → the pass, bound → a cast; the fizzle board `5k/******/*r****/*1****/1*****/KN4[OO] w` on portal6: `O@a2`, `f6f6`, then `a1a1` alone, the half gone, the other scroll kept, black on with Ke6 and Rb3), every count confirmed by the oracle first | **64/64** on the debug build (asserts on) and the release |
| F10a / F10b under v3 (a white half open, white to move = the link ply) | 45 and 43 legal moves, the casts alone (v2: 60 / 62 with the piece moves) — the oracle agrees |
| random positions vs the oracle — scrolls 0–2 a side, a half open for one side on 35% of them (frozen or link plies), 1–3 pairs, walls and crates, 6×6 / 8×8 / 10×10: perft-1 move sets and perft-2 per-move counts | **400 (seed 11, release, perft only) + 800 (seed 21, debug, + xsweep 2) + 600 (seed 99, release, more pairs, + xsweep 2): 0 mismatches** |
| debug perft 4 on 15 fixtures (`givesCheck == checkers`, `pos_is_ok`, the undo) | completed, no assert |
| portal-free identity vs the six-patch native build | perft 3 equal (61,433); depth-12 transcripts identical on three positions |

### The rule-16 gate (both WASM binaries rebuilt from the clean pinned trees)

`ffish.js` and `stockfish.js` byte-identical to the vendored (the worker
as ever `cat stockfish.worker.js emscripten/worker-postamble.js`); the
wasms +3,402 / +1,457 bytes.

- [x] `test-portals-ffish.cjs` **77/77** — the v2 set with F10b at 43 and F17's two pairs in six plies (half, the frozen pass, link — twice), plus V3: the frozen ply, SAN `--`, the FENs along the sequence, the link ply's 45 casts, pop back to the frozen ply, the fizzle on portal6 with `isGameOver(true)` false after two passes in a row; the check-flag sweep over the fixtures plus a frozen and a link ply
- [x] `test-portals-engine.cjs` **141/141** — perft 3 re-pinned to the native build where scrolls are in hand (F10a 16,214, F10b 33,603, F16 2,070, F17 4,248; the 10×10 duel shape perft 2 = 1,893), the V3 sequence over UCI, the searches, the fizzle
- [x] `test-hammer-ffish.cjs` 27, `test-hammer-engine.cjs` 25, `test-ffish.cjs` 19, `test-engine.cjs` 7
- [x] `regress.cjs` + `regress-ffish.cjs` — crate-free positions identical to the shipped pair; `xcheck.cjs` — ffish and engine agree on every crate fixture; `stack-regress.cjs` 5
- [x] `search-identity.cjs` — node-for-node identical to the vendored six-patch engine at depth 12 (19,459 / 26,462 / 35,136 nodes)
- [x] `depthcap.cjs` — d22 110/110 (slowest 1,551 ms), d60 30/30 (slowest 10,021 ms, the movetime) — **the cap stays at d22**
- [x] the game's gates on the vendored pair: selftest 50/50 headless (the v3 check on the deal variant, the v1 check's four casts now six plies), ui-smoke 326 ok (THE PORTAL SPELL block reads the one-turn cast), replay-smoke 76, test-logreport 61, test-portals-game 34, the other Node gates unchanged

## The portals-body patch (`patches/portals-body.patch`, was `portals-v2.patch`) — 2026-09-18, the tunnel retired 2026-09-19

Canon: brief §4.7 "Portals v4 — the tunnel retired" (the designer, on the
s88 log: "I'm actually considering getting rid of the true pass thru moves
for sliders, and making it so entering a portal always stops movement and
lands on the exit portal… I'm worried it's not intuitive to read" — then
"Let's make v3 portals without the pass thru moves. We'll keep the double
portal cast and the portals stopping movement. Everything going thru a
portal simply lands on the exit portal now, swapping if there's something
there."). `portals-body.patch` is `portals-v2.patch` with its tunnel half
removed, regenerated from the tree (pin + five patches + v2, edited, `git
diff`): 61 insertions / 26 deletions across three files, against v2's 309
/ 55. What stays is the BODY RULE — every ray passes its occupancy through
`pieces() | st->portalSquares`: `attacks_from` / `moves_from`, the check
squares, the sniper and blocker lines of `slider_blockers` (an empty portal
square on a line is skipped as a blocker of record), SEE's x-rays, the
promotion branches of `gives_check`, the pawn's double and triple steps,
and `attackers_to`, which now adds the bodies to its occupancy in ONE line
at the top (v2 had restructured it around the tunnel term). What went:
`open_portals`, `portal_through`, `tunnel_attackers` and the `twin_of`
helper; the tunnel squares in `generate_moves`; the whole-board evasions
(`tunnelEvasions`) — the evasions are v1's again, portal landings
generated whole by `generate_portal_evasions` and `legal()` deciding, the
en passant early return back to stock; the tunnel fallback and the
regeneration-in-check in `pseudo_legal`; the tunnel block of
`gives_check`; the DROP branch of `portal_attacks_king` (a linking cast is
`!checkers() && !(portal_taken() & to)` again and never gives check — two
bodies can only close lines), whose PORTAL branch is v1's shape judged
through the bodies. Stock when no pair stands: portal-free boards
node-identical to the build before (perft 3 = 61,433 on the v1 gate's
opening; depth-12 transcripts identical on four boards with no pair and no
scroll — with scrolls in hand a search casts pairs deep in the tree, where
the rules legitimately differ).

### Native validation (2026-09-19)

`engine/forge/oracle.py` lost its pass-through (a ray ends at a portal
square) and the link's exposure test (vacuous without a tunnel); every
fixture count in `native-test.py` was re-derived by it before the engine
ran — and it corrected one of mine on the way (F5: h6g7 is the bishop's own
direct check, so "no bishop move gives check" reads "only h6g7").

| check | result |
|---|---|
| the fixtures (F1 11 moves, a1a4 landing on h5 with no check; F4 not in check with 13 free moves, the bishop on h6 unpinned; F5 no discovered check; F6 not in check, a8a4 to h5, a8a1 no move; F7 and F8 ten moves — the first pair the body, no chain; F10a 45 links and none gives check, black on with 7 moves after O@h5; F10b all 46 links legal, h5/h6/h7 included; F14 22 moves with d2c3 legal and d2d3 refused; B1 the shield; the v1 landings, the double step, the casts and V3a–d unchanged; the fizzle on a NEW board — `4rk/******/******/******/1*****/KN4[OO] w` on portal6, one castable square in all, so after the half nothing is left to link — while v3's fizzle board links freely now, O@b3 its one legal move) | **62/62** on the debug build (asserts on) and the release |
| random positions vs the oracle — scrolls 0–2 a side, a half open for one side on 35% of them, 1–3 pairs (plugged or open), walls and crates, 6×6 / 8×8 / 10×10: perft-1 move sets and perft-2 per-move counts | **800 (seed 21, debug, + xsweep 2) + 600 (seed 99, release, more pairs, + xsweep 2) + 400 (seed 7, release): 0 mismatches** |
| `xsweep 3` on the nine sweep fixtures | clean |
| debug perft 4 on 16 fixtures (`givesCheck == checkers`, `pos_is_ok`, the undo) | completed, no assert |
| the oracle's own perft 3 on six fixtures (F1 1,155 · F4 1,581 · F7 917 · F10b 28,018 · F16 2,070 · F17 4,248) | equal to the native build's |
| portal-free identity vs the seven-patch (tunnel) native build | perft 3 equal (61,433); depth-12 transcripts identical on four boards with no pair and no scroll |

### The rule-16 gate (both WASM binaries rebuilt from the clean pinned trees)

`ffish.js`, `stockfish.js` and the worker byte-identical to the vendored;
the wasms −10,849 / −8,745 bytes.

- [x] `test-portals-ffish.cjs` **78/78** — rewritten for v4 (the fixtures above through the JS API, SAN `Ra4` for the landing, no `+` on any cast, the new fizzle board, the old one linking; the check-flag sweep over the fixtures plus a frozen and a link ply)
- [x] `test-portals-engine.cjs` **146/146** — perft 3 re-pinned to the native build (F1 1,155, F4 1,581, F10a 17,173, F10b 28,018, F14 5,517, F17 4,248 …; the 10×10 duel shape perft 2 = 1,893), the boards after the key moves, no check through a pair, the V3 sequence and the fizzle, the queen on its portal square taken by search (the rook or the pawn, the captor landing on f6), the strip rule, the 10×10 search alive
- [x] `test-hammer-ffish.cjs` 27, `test-hammer-engine.cjs` 25, `test-ffish.cjs` 19, `test-engine.cjs` 7
- [x] `regress.cjs` + `regress-ffish.cjs` — crate-free positions identical to the shipped pair; `xcheck.cjs` — ffish and engine agree on every crate fixture; `stack-regress.cjs` 5
- [x] `search-identity.cjs` — node-for-node identical to the vendored seven-patch engine at depth 12 (19,459 / 26,462 / 35,136 nodes)
- [x] `depthcap.cjs` — d22 110/110 (slowest 1,410 ms), d60 30/30 (slowest 10,022 ms, the movetime) — **the cap stays at d22**
- [x] the game's gates on the vendored pair: selftest 50/50 headless (the v4 check), ui-smoke 373 ok (one run died on the engine transport glue on record, the rerun green), replay-smoke 76 ok, test-logreport 61, test-portals-game 27, the other Node gates unchanged

## The portals-v2 patch as built (2026-09-18) — THE RECORD; its tunnel half is gone since v4, above

Canon: brief §4.7 "Portals v2" (the designer's two questions — "portals
block sliders?" and "sliders go fully thru both portals?" — settled in one
conversation: a linked portal square is a BODY, every line stops at it
whatever stands on it, a half is not a body until linked; an EMPTY PAIR is
a TUNNEL for rooks, bishops and queens — the line comes out of the twin in
the same direction and runs on, through another empty pair too, each pair
once per line; landings step through and swap exactly as v1; a pawn's
double step never crosses a portal square; capture at the exit and a
tunnel for the double step were rejected). Authored on the pinned trees on
top of dead-squares, thread-stack, portals, wall-kinds, hammer (apply in
that order); 309 insertions / 55 deletions across three files.

Design, in the engine's own shapes:

- **The bodies**: every ray passes its occupancy through
  `byTypeBB[ALL_PIECES] | st->portalSquares` — `attacks_from` /
  `moves_from` (both paths; `moves_bb<true>` too, so a pawn's lame double
  step stops at a portal), `attackers_to` (the occupancy parameter is a
  piece occupancy, real or virtual; the bodies are added inside), the
  check squares in `set_check_info`, the sniper and blocker lines of
  `slider_blockers` (an EMPTY portal square on a line is a body that never
  moves — it is skipped as a blocker of record, so nothing is pinned by it
  and nothing discovered past it), SEE's x-ray additions, the promotion
  branches of `gives_check`. No representation change: the pairs ride the
  state and the FEN's trailing field as before, halves stay inert.
- **The tunnels**: `portal_through(riders, s, bodies, open)` — the rider's
  magic rays with the bodies in (they stop AT a portal square and include
  it), then from each OPEN entry (both squares empty, `open_portals`) a
  stepped walk from the twin in the line's direction until the next body,
  which is included (a piece to capture, a plugged portal to step into);
  an open portal of an unused pair on the way is entered again (each pair
  once per line — the loop terminates at the used pair, whose square is
  still a landing); never a wall, and NEVER THE ORIGIN (a line that comes
  back round to its own square attacks nothing there — the oracle found
  that one). `tunnel_attackers` lists the riders whose lines reach a
  square through a tunnel; `attackers_to` appends them, so FSF's
  `legal()` — which already judges every move on a virtual occupancy —
  reads the rule for free, and so do the evasions' king-square tests, SEE
  and the checkers after a move.
- **The relocating moves**: `portal_attacks_king` keeps the PORTAL move's
  virtual board (victim gone, mover on the twin, the twin's occupant on
  the target) and adds the tunnel attackers of the stayers (the relocated
  squares' pieces of record masked out and judged from where they end)
  and the mover's and the swapped piece's own lines from their new
  squares; it also judges a LINKING CAST with the new pair in the table
  (`twin_of` takes the extra pair) — `legal()` refuses a cast that opens a
  tunnel onto the caster's own king, `gives_check` reports one that opens
  a tunnel onto the enemy's.
- **`gives_check`**: while a pair is open after the move, the mover's
  tunnel line from its new square (the promoted type for a promotion) and
  the attackers of the king on the new occupancy (a discovered check
  through a tunnel, or plainly); the stock direct-check squares and
  branches read through the bodies.
- **Move generation**: a rider's attacks and quiets gain
  `portal_through` (the bitboards dedupe a square reached plainly and
  through a pair); the pawn's double and triple steps never cross a
  portal square; IN CHECK WITH AN OPEN PAIR the whole board is generated
  and `legal()` decides — a leaper's check and a double check included,
  since a landing on a portal may swap the king out of either (the
  non-sliding-rider fallback's shape; `generate_portal_evasions` stays
  for the plugged-pairs case) — and the en passant early return yields
  when portals stand. `pseudo_legal` accepts a rider's tunnel move and,
  in check with an open pair, validates by regeneration.
- **Stock when absent**: every new expression is behind
  `st->portalSquares` — portal-free boards are node-identical to the
  five-patch build (perft 4 and depth-12 transcripts, natively and in
  WASM).

Known gaps, on record: the eval's mobility terms use plain occupancies (the
search sees the tunnel moves, the eval does not count them); a PORTAL move
still takes the stock simple SEE (zero); the quiet-check generator finds no
tunnel checks (the main search does at depth one); only rook and bishop
lines tunnel (a hopper's or a nightrider's do not).

### Validation (2026-09-18, this container)

Native first, and for the first time against an INDEPENDENT ORACLE
(`engine/forge/oracle.py`, COMMITTED with the driver: the rules written as
Python from the rule text — forward rays for every attack where the engine
uses reverse rays plus a tunnel term, make/unmake by copying the board;
`engine/forge/native-test.py` drives a native largeboard build over UCI on
`engine/forge/portals-v2.ini` — `python3 native-test.py <binary> --fixtures
--sweep --random 600 --seed 99 --pairs 1 --depth 4`; the `--sweep` flag needs
the scratch `xsweep` command compiled into the binary, described above):

- 57 hand-derived fixture checks — the body (a5..a7 gone, h6..h8 through
  a4–h5), the plugged exit's swap and the plugged entry's capture, check
  and a pin through the tunnel, a discovered check off the blocking
  square, stepping into the tunnel as a block, the chain through two
  pairs (c8 never reached), the cycle cap, the pawn's double step (blocked
  by a portal on the first square, landing on one on the second, no en
  passant square), a linking cast giving check and one refused as a
  self-check, the v1 landings kept (twin to twin, the swapped king, the
  capture through) — every count confirmed by the oracle before the
  engine ran it (the oracle corrected one of mine: in the old F3 the king
  may not step to c3, the enemy rook reaches it THROUGH g7–d3);
- the engine's own consistency sweep (`xsweep`, a scratch UCI command in
  the forge build only): for every generated move, `pseudo_legal`,
  `legal` against the king's real attackers after the move, `gives_check`
  against the real check after it, the incremental keys / checkers /
  blockers / pinners / check squares / material against a fresh position
  from the FEN, and the undo — depth 3 over the fixtures, depth 2 over
  every random position, clean;
- 1,500 random positions (seeds 7, 99, 2024; 6×6, 8×8 and 10×10 boards
  with walls, crates and one to five pairs, plugged or open): perft-1
  move sets and perft-2 per-move counts equal to the oracle's. The runs
  caught TWO real bugs on the way: a captured piece's own tunnel line
  looping back to its square counted it as an attacker of the square it
  was taken on (a legal king capture refused), and the evasion fallback's
  leaper narrowing dropped the portal landings that swap a king out of a
  knight's check;
- a debug largeboard build (asserts on, `givesCheck == checkers` in
  `do_move`, `pos_is_ok`): perft 5 on twelve fixtures (up to 94 M nodes),
  the fixtures and the sweep;
- portal-free boards node-identical to the five-patch build (perft 4,
  depth-12 node counts and PVs).

WASM (both binaries rebuilt from clean clones of the pinned trees with the
six patches applied by `git apply`; `ffish.js`, `stockfish.js` and the
worker came out byte-identical in size to the vendored, the wasms +11 KB
and +10 KB):

- [x] `test-portals-ffish.cjs` — **64/64** (rewritten for v2: the same
  fixtures through the JS API, SAN `Rh8+` through the tunnel, `O@h5+`, the
  pin, the swap, push/pop, a 2-ply check-flag sweep over twelve fixtures)
- [x] `test-portals-engine.cjs` — **129/129** (perft 1 sets and perft 3
  totals pinned to the native build's, the boards after the key moves
  through `d`, the casts, the strip rule, the queen taken through a tunnel
  by search, a 10×10 duel-shaped perft 2 = 7503 and a depth-12 search
  alive)
- [x] `regress.cjs` / `regress-ffish.cjs` — crate-free perft identical to
  the vendored pair; `test-engine.cjs` 7/7; `test-ffish.cjs` 19/19;
  `xcheck.cjs` PASS; `test-hammer-ffish.cjs` 27/27; `test-hammer-engine.cjs`
  25/25; `stack-regress.cjs` 5/5
- [x] `search-identity.cjs` — node-for-node identical to the vendored pair
  at depth 12 (19459 / 26462 / 35136)
- [x] `depthcap.cjs` — d22 110/110 clean (slowest 1335 ms), d60 30/30 clean
  (slowest 10015 ms) — the cap STAYS at d22 (rule 11)
- [x] `play/selftest.html` in headless Chromium — **49/49** (a new v2 check
  on the game's own deal variant, both binaries, and the grid's walker)
- [x] the game's gates on the vendored pair (CLAUDE.md, the Portals v2
  paragraph)

Build notes: the toolchains were reinstalled from scratch again (the
container keeps nothing — the two emsdk installs, the two trees, the net);
the artifacts were built from CLEAN clones with the six patches applied by
`git apply`, never from the working tree that carried the scratch sweep
command. `ffish.js` compiles `uci.cpp` into the library, so any scratch
instrumentation there would ride into the artifact — build from a clean
tree.

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
FFISH_JS=... node engine/tests/test-portals-ffish.cjs                   # the portal spell — the body rule + the one-turn cast (Portals v4), ffish half (78)
ENGINE_JS=... node engine/tests/test-portals-engine.cjs                 # the portal spell — the body rule + the one-turn cast (Portals v4), engine half (146)
FFISH_JS=... node engine/tests/test-hammer-ffish.cjs                    # the hard wall + the sledgehammer, ffish half (27)
ENGINE_JS=... node engine/tests/test-hammer-engine.cjs                  # the hard wall + the sledgehammer, engine half (25)
FFISH_JS=... node engine/tests/test-ice-ffish.cjs                       # the ice — slippery squares, the slide, the pit `_`, the scroll — ffish half (53)
ENGINE_JS=... node engine/tests/test-ice-engine.cjs                     # the ice, engine half: perft pinned to the native build, the searches (79)
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
