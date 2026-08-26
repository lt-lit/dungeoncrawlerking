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
Next per brief §10, a Gods track before calibration resumes:
**Phase 1.1 — quake legibility ✅ done** (piece motion, sequenced quake
beats, persistent quake marks, + the landing-safety stopgap in
`play/js/threat.mjs`); **Phase 1.2 — the Gods debug overlay ✅ done**
(the tuning instrument, built BEFORE 1.3 changes what it measures: roll
trace with reason codes recorded INSIDE `quake()` incl. the fall-through
path, candidate census + board heat, RNG-free probability getters +
nominal forecast, live ramp dials, eval delta per quake — see
`play/README.md` § "The Gods debug overlay"; `play/selftest.html` asserts
a seeded quake sequence replays identically with the overlay exercised);
**Phase 1.3 — redefine "symmetric"** (promote the stopgap to
"no new winning capture for either side", retune — the 1.2 instrument
supplies the evidence: eval-delta flips decide whether SEE suffices,
`rejected.unsafe_landing` counts starvation risk, fall-through rates show
the crumble-rate shift). **1.3 is BLOCKED on Phase 1.2.5 — The
Proving Grounds** (brief §10), the calibration test bed +
automated-playtest rig; its evidence work is paused there (`play/SLICE-REFRESH-PLAN.md`): the meter-lab
data (`phase0/harness/meterlab/`, results + findings in
`phase0/results/`) showed the ply-ramp trigger is the wrong half of the
Director; final numbers wait on the representative test bed. **The test
bed's data half is DONE**: 33 designer-locked stages (`play/stages/`,
gallery via `phase0/harness/gen-gallery.mjs`) × the army generator
(`play/js/armygen.mjs` — W×2 unit bags, W 3–8, molding layout with two
invariants: royal rearmost, pawns in front PER FILE; army size is
INDEPENDENT of stage geometry), plus the CAMP-LINE pawn double-step
(spikes 13+14 — every deal registers its own variant whose
`doubleStepRegion` runs from each home edge to that side's camp line,
the rank holding the MOST of its dealt pawns with ties toward the
enemy: at or behind your line you can leap, past it never again; pawns
molded ahead of the wall are "advanced" and never leap; the every-visit
caveat is REPEALED, designer correction 2026-08-21) and a 60-variant
catalog (ranks 5–10). Balance corpora run every stage in BOTH vertical
orientations (mirrors are not separate scenarios — `flipStageVertical`).
**The setup-UI rework is DONE**: the game boots into a stage picker →
LIVE preview (the generator panel sits under the board and every knob
change re-deals the armies in place — per-side knobs, initiative toggle,
flip, CROP steppers, ONE master seed driving armies+molding+Director via
childSeed), Rematch/Re-deal;
the legacy arenas, placement screen, enemyEdit cheat and
`play/js/arena.mjs` are RETIRED (`armygen.dealMatchup` is the single
composed deal entry point — UI, `phase0/harness/verify-stages.mjs`, and
the future corpus builder all share it). Designer rules from that build
plus the 2026-08-26 ground rules are canon: **crop redraws the boundary
by REMOVING ranks (never walling them)**; **KINGS ANCHOR THE ARENA**
(brief §4.2: stages are emergent, not authored — guarantees live in the
DEAL, not in authoring lints; the player's king always starts on the
first row and the enemy king on the last, and `dealMatchup` AUTO-CROPS
any rows behind either king — floor 5 ranks, a deal that would crop
below it is rejected; the promotion zone is ALWAYS the enemy king's
starting row, guaranteed usable because the king stands on it — this
SUPERSEDES the old "no fully-walled extreme rank" lint, now retired
from `stage.mjs`/the verifier); and **human play caps the
engine at 10 s/move** (`depth 22 movetime 10000` — d22 stays as the WASM
stability cap; perf/optimization work is deliberately parked, labs keep
faster limits). **CAPTURABLE WALLS ARE CANON — brief §4.6** (designer decision
2026-08-25): a second terrain glyph `^` — furniture — neutral, immobile,
owned by neither side, capturable by EITHER side by moving onto it, and
priced natively by the engine (the point). Furniture is TERRAIN
everywhere except the capture itself — a wall to molding, crop, the camp
line, and the gods — and NOTHING ever creates a `^` mid-duel. It needs a
patched engine pair, so two phases now precede the Proving Grounds.
**Phase 1.2.3 — The Forge ✅ done (2026-08-26)**: both vendored
WASM artifacts rebuilt from ONE dead-squares patch on current FSF master.
The patch is AUTHORED and natively validated (2026-08-25):
`engine/patches/dead-squares.patch`, 73+/22− across four files, applies
to both pinned trees; `^`-free boards are node-for-node identical to
stock at fixed depth; the internet reference diff is REFERENCE ONLY — it
carries THREE defects (the two known movegen ones, which the authored
design is immune to by construction, plus a promotion-capture undo
corruption found in the audit); the §4.6 terrain-is-not-a-victim ruling
(mustCapture / capture-gated promotion ignore crate captures) is
implemented engine-wide. **The pair is BUILT and VENDORED (2026-08-26)**:
rule 16's gate ran green end to end — full Node suite (incl.
`regress-ffish.cjs`, `search-identity.cjs` node-exact vs both baselines,
the promo mirror fixtures), `play/selftest.html` 29/29 in headless
Chromium with SharedArrayBuffer live, depth-cap re-measure (rule 11
unchanged), spike10 32/32, and the designer's phone feel check passed
(2026-08-26 — duel feel unchanged, selftest green on device). The
walled-passer eval fix stays deliberately NOT shipped, and upstreaming is
not planned (designer 2026-08-25). **PHASE 1.2.4 — SET DRESSING — IS THE
ACTIVE PHASE**: retire the hard-coded `'*'` tests for the shared
terrain helper (`fen.mjs` `WALL`/`FURNITURE`/`isTerrain`; the audit
found 65 sites / 24 files — the two known landmines confirmed, plus
furniture-as-displaceable and furniture-as-white-crumble-victim in
`director.mjs`, `^`-painted-as-white-piece in `board-ui.mjs`, and
silent `^`-dropping emitters in `armygen.mjs`/`main.mjs`; sed hazards:
ffish RESULT strings `=== '*'` in both `crumbleFilter.mjs` copies +
spike11/12, and the variants.ini `*` wildcards), interim Director rule
"furniture is stone to the gods" (never displaced, never a crumble
candidate, silent in every census, NO new reason codes — the rework
owns the real policy), a sprite (neutral piece-like glyph + cell tint,
so capture dissolve works unchanged), the stage-map `^` character, the
king-anchored auto-crop (see the ground rules above), and the
REPLACEMENT stage set (~33 fresh stages authored WITH furniture — the
designer retired the original 33 on 2026-08-26; gallery-reviewed,
accept/tweak/kill) — exit is crates in live phone duels.
After both land, **PHASE 1.2.5** resumes; its
remaining half is the LAB RIG — all automated-playtest plumbing, no duel
rules change: (a) the **corpus materializer** (33 stages × both
orientations × {stone-only, furniture} arms (§4.6: `^`→`.` derives the
control from the same stage files) × `dealMatchup` → the stage-file sets `harness/meterlab/
run.mjs` consumes, §7 player-favored edge + a full-strength mirror arm);
(b) the **mirror-canary drift metric** in `harness/meterlab/analyze.mjs`;
(c) the **meter-lab rerun** on the new bed. Ask the designer FIRST which
arms run, seeds/matchups per stage-orientation, and the favored-seat
model (depth-2 proxy vs human-shaped MultiPV) — switching mid-corpus
forks the evidence. The phase ends when the evidence is on the table.
Only then **Phase 1.3** (the rule decision — and note the
meter-lab first pass may widen it from "redefine symmetric" to replacing
the whole decision layer; §4.5 is LOCKED in shape, so that needs a design
conversation first). Then **Phase 1.5 — Director calibration** (port
`harness/game.mjs` off the retired crumble system, add the §6 promotion
lint, settle ramp numbers) — gated behind 1.3 so the sweeps are not burned
twice — and finally **Phase 2 — exploration slice**.

## Layout

- `play/` — the Phase 1 game (vanilla-JS ES modules, GitHub Pages). Phase 0
  modules are ported verbatim into `play/js/`; `play/vendor/` carries its own
  copy of the validated WASM builds; `coi-serviceworker.min.js` sits next to
  `play/index.html` (rule 10). `play/selftest.html` is the in-browser infra
  cross-check — keep it PASSing.
- `engine/` — the Phase 1.2.3 patch kit: `patches/dead-squares.patch` (the
  AUTHORED patch of record), the KOTH PR #29 reference diff (reference
  only — three known defects), the rule-16 gate tests (`tests/*.cjs`), and
  `engine/README.md` (recipe, gotchas, gate results, validation evidence).
  **`play/vendor/` carries the PATCHED pair since 2026-08-26** (gate green;
  only the phone feel check outstanding). phase0's npm `node_modules` are
  still the STOCK pair — overlay `play/vendor/` artifacts before any
  phase0 run that must play the shipped rules (see `engine/README.md`).
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
   dims-keyed catalog pattern: `duel_<files>x<ranks>`, all 60 loaded once at
   boot. Incremental ADDITION of new names is safe in both libraries
   (spike 14): per-deal variants (`duel_<f>x<r>__w<line>__b<line>`, the
   camp-line double-step) register alongside the catalog, and their
   names ENCODE their config so a re-registration is always an
   identical-config no-op — never mint a deal-variant name that doesn't
   fully determine its rules. The engine learns them via the CUMULATIVE
   `app.catalog` reload (every recycle path reloads it — a mid-duel
   engine swap must keep the live deal variant).
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
    crash this WASM build's pthread (`index out of bounds`). Measured on
    1.1.11: d60 crashed 1/30 searches, d22 crashed 0/110 and still returns
    <200 ms. Re-measured on the dead-squares pair (2026-08-26, Node,
    `engine/tests/depthcap.cjs`, arenas incl. `^` and `*`): d22 110/110
    clean (slowest 1553 ms), d60 30/30 clean — the cap STAYS at d22 (0/30
    at d60 is not evidence of a fix at a 1/30 base rate). Not a handicap;
    live play was reaching d22–23 anyway.
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
14. **`director.quake()` is expensive and synchronous** — measured 300–720 ms
    per quake on 4×6–6×8 arenas (Node). It calls `displacementCandidates`
    twice, and that builds ~4 ffish Boards per candidate (`stuckCount` alone
    is 2, and only ever distinguishes tier B from tier C). Cheap filters
    belong BEFORE the ffish probes — that is why the landing-safety check
    runs on the grid. Do not add per-candidate ffish work without measuring.
15. **The vendored pair is a MATCHED SET built from one patch, two trees,
    two toolchains.** ffish comes from FSF mainline (`src/Makefile_js`,
    emsdk 1.39.16); the engine from `fairy-stockfish/fairy-stockfish.wasm`
    branch `nnue` (emsdk 2.0.26) — but every rule-bearing source file is
    byte-identical between them, so ONE patch feeds both. Any rules change
    rebuilds BOTH or the game desyncs (ffish is the legality gate at
    `duel.mjs`). Build gotchas that already bit: emsdk activation is
    stateful (installing one version deactivates the other — build ffish
    FIRST); `make -j emscripten_build` races the copy step and publishes a
    STALE binary (build serially: `make build && make
    emscripten_copy_files`); the worker is `cat stockfish.worker.js
    emscripten/worker-postamble.js`, never a plain copy. Full recipe:
    `engine/README.md`.
16. **No rebuilt pair is vendored before the equivalence gate**: `^`-free
    perft parity vs the previous pair for BOTH binaries; ffish↔engine
    perft agreement on `^` boards; `play/selftest.html` + the 60-variant
    catalog in a REAL browser (Node exercises neither SharedArrayBuffer
    nor the pthread path); re-measure rule 11's depth cap on the new
    binaries and update it here.
17. **The patch bar.** The engine is patched only for a mechanic that (a)
    cannot be expressed in variants.ini (enumerate the grammar first —
    all 147 parser keys were swept before furniture cleared the bar) and
    (b) cannot be faked at the game layer without the engine playing
    badly. Patches are separate minimal files in `engine/patches/`, kept
    upstream-SHAPED (no new variant keys, stock-identical without the new
    glyph) — but upstreaming itself is optional and NOT planned (designer
    2026-08-25; the natural venue would be FSF issue #609 if that ever
    changes). The walled-passer eval fix stays unshipped, documented in
    `engine/README.md`.
