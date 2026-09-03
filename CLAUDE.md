# Dungeon Crawler King — repo guide

Design source of truth: `dungeon-crawler-king-prototype-brief.md`.
Phase 0 (spikes + calibration harness) is **complete** — read
`phase0/PHASE0-RESULTS.md` before touching anything engine-related; it
summarizes 12 verified spikes and the sweep results. **Phase 1 — the duel
vertical slice — is built and lives in `play/`** (hand-authored arena →
playable duel vs engine on a phone; placement UI, win/loss, promotion, live
Earthquakes; no overworld). See `play/README.md` for its layout and the arena
JSON schema. **The Board State Director (`play/js/director.mjs`) is CANON, and v3
GUTTED its decision layer (designer 2026-08-31, brief §4.5).** The gods now
trigger on TWO METERS — restlessness (`play/js/meter.mjs`, the game record:
"nothing has happened") and staleness (`play/js/staleness.mjs`, the position:
"nothing CAN happen", the fun score, which sets the fill rate) — never on a
ply ramp, which survives only as a late backstop floor, and never while a king
is in check. They act on a SEVERITY LADDER: weaken (`*`→`^`, a wall cracks —
safe by construction, telegraphs the breach) → breach (`^`→floor, the line
opens) → displace (ONE piece, either side) → crumble (a permanent HOLE,
demoted to the closer — and NEVER on a piece: QUAKES CANNOT SWALLOW,
designer-final 2026-09-01; occupied squares are not crumble candidates,
which subsumes rule 4a's last-piece guard). A quake SPENDS AN ACTION BUDGET (drawn, not computed
— each extra action is its own Bernoulli trial at P(quake)), so rungs mix and
neither the kind nor the COUNT of what happens is a signature. **v2's pairing
rule is GONE** (designer 2026-08-31): one white piece and one black piece
moving every single quake is a tell, and it never did its job anyway —
pairing is symmetric in COUNT, and count is not consequence; the SEE landing
guard (rule 13) is what actually stops a displacement handing a game away,
and it now applies across the whole budget. Rung by meter, target by seeded
weighted pick over a STRUCTURAL impact score — never an eval, which would
both pick a winner and destroy seeded replay. `*` now means wall OR hole; FSF cannot tell them apart
so `director.holes` does, and holes are permanent (that is the termination
guarantee — see brief §4.5's amended "Holes are forever"). Sanity harness:
`phase0/harness/ladder-smoke.mjs` (`--gods off` is the control).
Next per brief §10, a Gods track before calibration resumes:
**Phase 1.1 — quake legibility ✅ done** (piece motion, sequenced quake
beats, persistent quake marks, + the landing-safety stopgap in
`play/js/threat.mjs`); **UI refresh ✅ built 2026-09-02** (designer-settled: terrain
TILES by kind — wall slab / hole / crate / cracked wall, painted from
`director.holes` + `godCrates` via `setPosition(fen, ledgers)`; edge
coordinates; hint arrows gold/silver/bronze by RANK at half size; the gods'
residue in their own light-blue hue, one mark per rung plus a dashed arrow
per displacement, merged across quakes and mirrored in a gods line under
the board; per-rung terrain fx held on their end frame; the hint probe
STREAMS at the enemy's own `depth 22 movetime 10000` with a "Keep
evaluating" option, `?probe=` override, and cancel hardening — an
unanswered `stop` recycles the instance and `duel.#search` pins MultiPV 1;
`?fx=0` is stamped as `data-fx` so CSS motion collapses too; the selftest
gained a renderer check and `__DCK.cheat`/`__DCK.marks`; a live-board smoke
lives in `phase0/harness/ui-smoke.mjs`; **round 2, same day**: floor is olive
flagstone and walls are pixel-art purple-grey stone blocks, a cracked wall is
the block with a branching black crack and NO crate sprite, hint arrows are
outlined on shaft and head and carry their eval written into the arrow (paints
are depth-consistent across ranks), the floor is warm grey, and `^` has
SKINS — an optional stage `skin` grid (door/barrel/table/chair/shelf/chest/
crate/rubble; cosmetics only, never grid state) authored over the whole bed
by `phase0/harness/gen-skins.mjs` (wall-line doors by geometry, furniture
family by the stage notes, a reviewed override table) with sprites
generated into `style.css` by `gen-sprites.mjs`; **round 3, 2026-09-03 —
ART THEMES**: the designer shopped free tilesets and settled "use them all,
16×16 is the standard, mix and match, repack and credit" — the board wears
`hall` (pixel-poem Dungeon Asset Puck), `castle` (SnowHex Dungeon
Gathering) or `crypt` (Szadi art Rogue Fantasy Catacombs), or `classic`
(the in-house set); `phase0/harness/repack-tiles.mjs` crops ONLY the used
tiles from the packs in gitignored `phase0/assets-src/` into
`play/img/tileset.png` + `play/tiles.css` (PNG data-URI variables under
`[data-theme]`) + `play/CREDITS.md`; the packs themselves are never
committed; every stage carries a `theme` (gen-skins.mjs assigns it from the
stage NAME's vocabulary, balanced 18/21/19), overridden by the Options
panel's Art set or `?theme=`; the renderer classes every wall by its
solid-neighbour mask (`wm-<mask>`, N=1 E=2 S=4 W=8 + diagonals, the 47-case
blob via `canonicalMask`; holes are not solid, doors are) and the repack
tool GENERATES each theme's 47 cases as a bevelled top band in the pack's
colours with the pack's own brick face extruded under every south edge
(the packs draw 2.5-D room borders and ship no thin-wall set; stitching
their pieces was rounds 4–5's "walls look like ass / still janky"); a door
in a north–south wall line is a WEAK SPOT (`weak`: the column's own case +
`--sprite-weak`; the edge-on door was cut, designer round 6); floor tiles
show through under every sprite, `f1…f6` are floor variants (crypt wears
all six Catacombs flagstones); and **PIECE SPRITES** (round 6): Dani
Maccari's *Pixel Chess* 16×16 sets (`pixel-chess` stone / `-wood`) via
`data-piece` on every piece span + `data-pieces` on the board
(`PIECE_SETS`, Options → Pieces, `?pieces=`; classic = the glyphs), the
promotion picker included; selftest 35/35, ui-smoke asserts the themes,
the doorway's masks and the piece sprites on the live board — see
`play/README.md` § "Art themes"); **Phase 1.2 — the Gods debug overlay ✅ done**
(the tuning instrument, built BEFORE 1.3 changes what it measures: roll
trace with reason codes recorded INSIDE `quake()` incl. the fall-through
path, candidate census + board heat, RNG-free probability getters +
nominal forecast, live ramp dials, eval delta per quake — see
`play/README.md` § "The Gods debug overlay"; `play/selftest.html` asserts
a seeded quake sequence replays identically with the overlay exercised);
**Phase 1.3 — THE GODS REWORK ✅ built 2026-08-31** (it WIDENED from
"redefine symmetric" to replacing the whole decision layer — see the v3
ladder above and brief §4.5; the meter-lab data in `phase0/results/` supplied
the trigger half of the case and live play supplied the rest). The old 1.3
scope — promote the landing-safety stopgap to "no new winning capture for
either side" — is ✅ **DONE (2026-09-01)**: the deferral's condition fired
exactly as written — live play produced the gift (a breach opened a line
and handed over the player's queen, ~ply 30), because "terrain rungs cannot
hand out material" was true of MOVING material and false of EXPOSING it.
The promoted rule is `threat.mjs editExposes`: an edit only changes SEE
relations for the FIRST piece along each of the 8 rays through an edited
square, so those pieces are priced pre/post and any candidate that turns a
SEE-safe piece SEE-losing (either side) is vetoed `hangs_piece` — on
breach (the observed case), displacement (vacated-square discovery), and
crumble (severed defence lines); weaken stays exempt, safe by
construction. Measured: calm's flip rate fell 2.8→0.3%/quake; wrathful's
did NOT (its flips are multi-action composites and strip-race re-timings
no per-edit ray test can see), and vetoed unlocks feed staleness back
into the meter, so wrathful ran HOTTER (21.7→26.1 q/100p) — see
`results/godlab/tuned-ab-findings.md`. **The test
bed's data half is DONE**: the designer-locked stage bed (58 stages
since 1.2.4 — `play/stages/`,
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
plus the 2026-08-27 ground rules are canon: **crop redraws the boundary
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
line, and displacement. Since v3 the GODS create and destroy `^` (weaken /
breach, §4.5); nothing else does. It needs a
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
not planned (designer 2026-08-25). **2026-08-27 — the engine-stall ROOT
CAUSE is FIXED**: the live-duel stalls ("engine stalled", "hint probe
failed" — worst on big boards, browser-independent) were FSF's largeboard
search-thread STACK OVERFLOW (upstream issue #804): silent wasm memory
corruption — a search can emit a legal bestmove and the instance is
already dead. NOT a dead-squares bug and NOT a 1.1.11 regression (the old
base crashes natively too — never roll back; its deep-largeboard output
is untrusted). `engine/patches/thread-stack.patch` (TH_STACK_SIZE 8→32MB;
dead code in threadless ffish, so ONLY the engine wasm changed — js and
worker rebuilt byte-identical, wasm +2 bytes) is vendored behind a full
rule-16 gate; `engine/tests/stack-regress.cjs` guards the deterministic
P60 kill-fixture (the old pair dies on it 19/19). Adopt upstream PR #1031
(per-thread MovePicker pool) when it lands and drop the patch. Phone feel
check passed 2026-09-01 (the v3 playtest ran on this pair). **Phase 1.2.4 — Set Dressing ✅ done
(2026-08-27)**: retired the hard-coded `'*'` tests for the shared
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
REPLACEMENT stage set — the designer retired the original 33 on
2026-08-27; wave 4 (s01–s33, the furniture bed) is ACCEPTED/locked
2026-08-27, and wave 5 (s34–s58, rooms & breaches: sectioned maps,
crate clusters, furniture in wall structures, breakable double doors,
and the s51+ FLOORPLANS — multi-room maps with hallways, doors to and
BETWEEN rooms, per-room furniture; designer: big boards play fine
on-phone, 10-wide confirmed) is ACCEPTED/locked 2026-08-27 — the full
58-stage bed is designer-locked, and the **exit PASSED 2026-08-27**:
crate duels live on-device with Earthquakes on (designer verdict —
"surprisingly really fun").
**PHASE 1.5 — DIRECTOR CALIBRATION — IS THE ACTIVE PHASE** (2026-09-01;
1.3 is BUILT and live on Pages). The meter-lab evidence pass had already
answered 1.3's question — the ply-ramp trigger was the wrong half — and live
play answered the rest: the mechanic was game-breaking, so it was GUTTED
rather than tuned. v3 (the ladder, above) shipped for playtesting; **feel on
the phone is the test**, not a corpus — and the first phone verdict is in
(designer 2026-09-01, a few games): the gods reshape ENTIRE arenas even on
Calm + intensity 1.0, breach-heavy, rooms stripped of furniture fast — "fun,
but I wouldn't call this calm". That report is now Phase 1.5's work list
(below). The `ladder-smoke.mjs` sanity pass on 14 stages ×
both orientations: 14/14 terminated, median 104 plies vs **268 with the gods
off (5 of 14 never terminating at all)**, zero quakes fired into check, 1.84
actions/quake with 33% of quakes mixing rungs, ladder split by ACTION weaken
22% / breach 19% / displace 50% / crumble 9%. Displacement leads because the
terrain rungs have a FINITE supply per board — once a board's eligible walls
and crates are spent, later budget actions fall back to displacement. That is
structural, not a tuning miss: the finite supply is what makes the termination
argument work.

**Phase 1.2.5's lab rig is SHELVED, deliberately** — the corpus programme it
specified (58 stages × both orientations × both terrain arms × generated
matchups × eleven arms) costs ~550 h of serial CPU and answers calibration
questions this rework does not need; the designer cut it 2026-08-31 as
overkill. Do not resurrect it without being asked. If it ever comes back its
remaining half was the LAB RIG — all automated-playtest plumbing, no duel
rules change: (a) the **corpus materializer** (the locked 58-stage bed ×
both orientations × {stone-only, furniture} arms (§4.6: `^`→`.` derives
the control from the same stage files) × `dealMatchup` → the stage-file sets `harness/meterlab/
run.mjs` consumes, §7 player-favored edge + a full-strength mirror arm);
(b) the **mirror-canary drift metric** in `harness/meterlab/analyze.mjs`;
(c) the **meter-lab rerun** on the new bed; (d) two rig defects from the
1.2.4 pre-merge review, fix BEFORE the rerun: corpus lines must record
`variantName`/`variantIni` (run.mjs plays deal variants but its output
omits them, so `replay.mjs` reconstructs the catalog baseline — the
camp-line double-step is lost and deal-variant corpora cannot replay
byte-exact), and run.mjs's MultiPV human-seat path lacks the
fresh-engine retry (an engine death mid-corpus crashes the arm instead
of retrying), and the designer would have to settle which arms run,
seeds/matchups per stage-orientation, and the favored-seat model before any
compute is burned.

**Phase 1.5's rig half is ✅ built (2026-09-01): the GOD LAB**
(`phase0/harness/godlab/` — run.mjs, analyze.mjs, sweeps/). It REPLACED the
brief's original "port `harness/game.mjs` to `director.mjs`" plan (designer
2026-09-01: no ports — the testing rig must not need fixing every time the
game changes): a port means two implementations of the shipped loop drifting
apart (the §7 sweep-validity law's failure mode; `play/js/duel.mjs` already
IS the ported loop), so the rig drives the CANON DuelController + v3
Director on the locked stage bed via `dealMatchup` — a Director change is
measured the moment it lands. Corpus lines record `variantName`/`variantIni`
(the meter-lab replay defect, fixed by design); per-ply trails cover
staleness, pressure, locked pawns, and wall/crate counts; an offline eval
referee feeds the §7 alarm metric; analyze.mjs splits per arm × stage class
(core/rooms/floorplan). The crumble-era harness is RETIRED: sweep.mjs/
analyze.mjs/sweeps deleted, loop modules frozen in `harness/legacy/` (spikes
07/08 still import them — never produce Director data with them), old
`results/sweep-*` corpora flagged historical (`results/sweep-corpora-RETIRED.md`).
The §6 promotion-reachability lint is DEFERRED pending the lab's locked-pawn
trajectory data — v3's ladder already targets locks directly (weaken +3 on
locked files, breach scores pawns freed, staleness prices locks), so measure
before writing generator law.

Remaining 1.5 work, in order: (a) the **baseline corpus** on current v3 —
**a preliminary 192-game pass ✅ ran 2026-09-01**
(`results/godlab/prelim-findings.md`: gods-off never terminates on 42% of
the bed incl. 6/8 floorplan games; Calm fires 3× harder on floorplans than
core — MORE than wrathful's average, so stage class outweighs the preset
dial, confirming the staleness path; terrain strips to 8–24% remaining
across presets; locked pawns 6.4→<1; alarm flip rate 2.6–3.8%/quake vs
v2's 31–75% of games — the ladder moved the harm out); the full
`presets.json` grid stays available if tuning needs tighter error bars;
(b) the **terrain-context
change — ✅ BUILT and A/B-measured 2026-09-01**: the CONSERVATION BRAKE
(brief §4.5 item 4) — `director.anchorTerrain()` freezes the authored
census at duel start (duel.mjs calls it; no anchor = brake off, which is
what keeps the selftest fixtures byte-identical), `conserveMult` damps
BOTH terrain rungs from `conserveAt` 0.6 down to silent at `conserveFloor`
0.3 of authored standing terrain, and the `director.godCrates` ledger
biases breach +3 toward god-minted crates so authored furniture outlives
god rubble. A/B on the frozen prelim seeds
(`results/godlab/brake-ab-findings.md`): calm floorplan terrain remaining
18%→32%, wrathful 5%→17%, pacing/alarm/termination flat, displacement
share up (the fall-through absorbs braked actions — SEE-guarded). Gates
run: selftest 33/33 headless Chromium, ladder-smoke 12/12. Both knobs are
live tune() dials for phone feel-tuning; (c) **preset separation — ✅ first pass 2026-09-01**: presets now reach
into the staleness knobs (the prelim data's verdict — stage class was
outweighing the preset dial) and `GOD_PRESETS` lives in `director.mjs` as
the ONE table main.mjs, ladder-smoke and the god lab all import. Calm:
onset 30, ramp 44, sate 6, debtCap 14, stalenessFloor/Gain 0.35/0.55,
late floor 160; restless 12/20/4/10 + 0.45/0.85; wrathful untouched (the
chaos preset anchors the scale). Measured separation 5.9 / 11.7 / 26.1
quakes/100p (was 12.3/14.3/20.8), calm terrain-remaining 43%, calm flip
rate 0.3%/quake — `results/godlab/tuned-ab-findings.md`, incl. the honest
trades (calm's long tail stretched; wrathful runs hotter under the
exposure guard via staleness feedback); (d) settle ramp numbers
from rig + feel together — **phone verdict 2026-09-01: calm is "finally
suitably chill"; its numbers are settled.** Restless is untested on the
phone; wrathful reads as crazy, which is its brief — its extra heat under
the exposure guard (26 q/100p) is the one number still on the table, and
`rampPlies`/`stalenessGain` are the walk-back knobs for any preset. **Wrathful pass 2026-09-01: quakes can no longer
swallow pieces at all** (designer-final, after a wrathful hole ate a
knight at ply 13 — the tuned corpus measured wrathful at 1.96
swallows/game, median ply 51, so the ply-13 knight was typical, not a
tail). Crumbles now take bare floor only; the debt-forced hole still
lands (termination untouched), and the closed-endgame `terminal` crumble
that ends a fully-locked board is unchanged (it immobilizes, it does not
eat). The favored-seat model/edge for the live-regime
arm still needs the designer. Then **Phase 2 — exploration slice**.

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
  **`play/vendor/` carries the PATCHED pair** (dead-squares 2026-08-26 +
  thread-stack 2026-08-27, each behind a green rule-16 gate; both phone
  feel checks passed — thread-stack's on 2026-09-01, on the v3 build). phase0's npm `node_modules` are
  still the STOCK pair — overlay `play/vendor/` artifacts before any
  phase0 run that must play the shipped rules (see `engine/README.md`).
- `phase0/lib/` — shared infra: `png.mjs` (dependency-free PNG codec for the
  asset tools), `load.mjs` (Node loaders + UCI wrapper),
  `fen.mjs` (largeboard FEN editing: walls `*`, multi-digit runs, pockets),
  `variant.mjs` (duel variants.ini generator — the canonical rule baseline)
- `phase0/spikes/` — one runnable script per §9 spike (deterministic, exit 0 =
  pass). `crumbleFilter.mjs` is production-bound (validated §4.5 filter).
  `spike08-mobile/` is a static phone benchmark page (vendored WASM).
- `phase0/harness/` — the calibration + verification tools. **`godlab/` is
  the §7 Director-calibration rig (Phase 1.5)**: `run.mjs <sweep.json>`
  plays the canon DuelController + v3 Director over the stage bed
  (JSONL out), `analyze.mjs` aggregates per arm × stage class. Needs the
  play/vendor overlay (see engine/README.md) — it fails loudly on the stock
  pair. `ladder-smoke.mjs` is the cheap post-change sanity pass;
  `verify-stages.mjs` the static stage verifier; `meterlab/` the shelved 1.3
  evidence rig (its Director config is v2-era — do not reuse without
  updating); `legacy/` the frozen crumble-era loop kept only for spikes
  07/08 — never produce Director data with it.
- `phase0/results/` — per-spike results docs + sweep outputs.

## Running things

```sh
cd phase0                      # npm deps live here (node_modules gitignored)
npm install                    # ffish + fairy-stockfish-nnue.wasm
node lib/selftest.mjs          # infra cross-check (ffish vs engine perft)
node spikes/spike04-*.mjs      # any spike; PASS/FAIL lines, exit code
node harness/godlab/run.mjs harness/godlab/sweeps/smoke.json  # rig sanity
node harness/selftest-headless.mjs  # play/selftest.html in real Chromium (npm i --no-save playwright)
node harness/ui-smoke.mjs --shots   # live-board UI smoke: tiles/marks/arrows/probe/themes on a forced-hot duel (+ screenshots)
node harness/repack-tiles.mjs       # rebuild play/tiles.css + img/tileset.png + CREDITS.md from the packs in assets-src/ (gitignored)
```
(godlab and ladder-smoke play the SHIPPED rules — overlay the play/vendor
pair into node_modules first, per engine/README.md.)

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
   under this config. Consequences: (a) crumbles can no longer strip ANY
   piece — since 2026-09-01 quakes cannot swallow (occupied squares are not
   crumble candidates, superseding the old last-piece exclusion this rule
   used to require); (b) test/spike fixtures must never use bare-king "victims" — such
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
   Node (Emscripten kills the whole process); drop the reference. (2026-08-27:
   the stack-overflow diagnosis — `engine/README.md`, thread-stack patch — is
   the likely root cause of this corruption; keep the recycle discipline
   until re-measured on the fixed pair.)
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
    file arenas — the engine reaches depth 55+. The crash behind this cap
    (`index out of bounds`; 1.1.11 d60 1/30, d22 0/110; dead-squares pair
    2026-08-26: d22 110/110, d60 30/30) is ROOT-CAUSED as of 2026-08-27:
    largeboard search-thread stack overflow (`engine/README.md`, thread-stack
    patch) — depth was only a proxy, and BIG boards hit the same crash BELOW
    d22 (~3 stalls/100 searches at `depth 22 movetime 10000` on 10×10 before
    the fix; the 4–6-file measurements never covered that regime).
    Re-measured on the thread-stack pair (2026-08-27,
    `engine/tests/depthcap.cjs` + 10×10 spot-checks): d22 110/110 clean
    (slowest 1619 ms), d60 30/30 clean, and on 10×10 d22/10s, d26/12M-node
    and d30/20M-node searches all complete with the instance alive (d26
    node-identical to the native reference). The cap still STAYS at d22 —
    live pacing is unchanged and deep-search evidence stays thin (0/30 at
    d60 vs the old 1/30 base rate). Not a handicap; live play was reaching
    d22–23 anyway. `stack-regress.cjs` is the permanent kill-fixture guard.
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
    board the player actually receives. (2026-09-01: the "separate" piece
    safety now exists — `threat.mjs editExposes`, the promoted
    no-new-winning-capture rule — pricing what an edit UNCOVERS or SEVERS
    on every line-editing rung, not just where a piece lands. The
    per-composite caveat stands: `landingsStillSafe` still re-checks landed
    squares across the budget, and compound geometry two edits only create
    JOINTLY is caught only where they share a ray.)
14. **`director.quake()` is expensive and synchronous** — measured 300–720 ms
    per quake on 4×6–6×8 arenas (Node, v2; v3's terrain rungs are cheaper
    per action but a budget can spend several). `displacementCandidates`
    builds ~4 ffish Boards per candidate (`stuckCount` alone
    is 2, and only ever distinguishes tier B from tier C). Cheap filters
    belong BEFORE the ffish probes — that is why the landing-safety check
    runs on the grid. Do not add per-candidate ffish work without measuring.
15. **The vendored pair is a MATCHED SET built from one patch, two trees,
    two toolchains.** ffish comes from FSF mainline (`src/Makefile_js`,
    emsdk 1.39.16); the engine from `fairy-stockfish/fairy-stockfish.wasm`
    branch `nnue` (emsdk 2.0.26) — but every rule-bearing source file is
    byte-identical between them, so ONE patch (set) feeds both —
    `dead-squares.patch` + `thread-stack.patch`, and the latter is dead
    code in the threadless ffish build, so its 2026-08-27 rebuild
    legitimately touched only the engine artifact. Any RULES change
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
