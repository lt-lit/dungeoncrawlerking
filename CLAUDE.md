# Dungeon Crawler King — repo guide

Design source of truth: `dungeon-crawler-king-prototype-brief.md`.
Phase 0 (spikes + calibration harness) is **complete** — read
`phase0/PHASE0-RESULTS.md` before touching anything engine-related; it
summarizes 12 verified spikes and the sweep results. **Phase 1 — the duel
vertical slice — is built and lives in `play/`** (hand-authored arena →
playable duel vs engine on a phone; placement UI, win/loss, promotion, live
Earthquakes; no overworld). See `play/README.md` for its layout and the arena
JSON schema. **The Board State Director (`play/js/director.mjs`) is CANON, v3
GUTTED its decision layer (designer 2026-08-31, brief §4.5), and v4 GAVE IT A
MEMORY (designer 2026-09-05 — see "THE GODS v4" below; the v3 text that
follows still describes the ladder and the meters, which v4 keeps).** The gods now
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
`play/js/threat.mjs`); **THE ART — what survives the DOM board (2026-09-02 … 2026-09-07; the
round-by-round record, including every DOM mechanic that got each look,
is `play/README.md` § "Art themes" and stays there).** Everything drawn
is 16×16 pixel art off ONE atlas (`play/img/tileset.png` + `pieces.png` +
`tileset.json`, written by `phase0/harness/repack-tiles.mjs` from three
free packs in gitignored `phase0/assets-src/` + the in-house drawings in
`phase0/lib/inhouse.mjs`; the tool READS BACK a missing pack from the
committed atlas, so the index, the classic row and new roles regenerate
without the packs; `play/CREDITS.md` is generated). Three THEMES —
`hall` (pixel-poem), `castle` (SnowHex Dungeon Gathering), `crypt`
(Szadi art Catacombs) — plus `classic`, the in-house set (the atlas's
classic row: one wall block for every case, its crate / door / barrel /
chest, the rubble heap as its ruin, and THE CRACK ×4 that every theme
masks onto a weakened wall). Every stage carries a `theme` (wave 6 hand-
authored, 12/12/12), overridden by Options → Art set or `?theme=`. The
renderer classes every wall by its solid-neighbour mask (the 47-case blob,
`canonicalMask`; holes are not solid, doors and masonry are; ruins and
opened doorways count as solid so a line runs through a break), a RUIN by
its standing-wall neighbours (16 stub cases, chip-free — the debris layer
owns every fleck), a HOLE by its hole neighbours (16 pit cases) and an
opened DOORWAY by the walls still standing beside it (posts only where a
wall stands). Floors are six Catacombs flagstones palette-swapped per
theme (`f1…f6` by a stable hash); walls are generated bevelled tops in
each pack's colours over the pack's own brick face. FURNITURE SKINS
(`^`, stage skin grids): door (pixel-poem's leaf stained per theme; a
door in a north–south line is a WEAK SPOT wearing the crack; an
authored double is `door2-l`/`-r`), crate, chest (the LID is the line:
domed = chest, flat = crate; no grey crates), barrel (urns), wreckage,
masonry (= a weak spot); every role has VARIANTS (`sv1…sv10` by a stable
hash, wrapping around what the theme has); props are 16×32 boxes (small
ones centred in the square, tall urns rising north); table / chair /
shelf are dropped; the rubble heap died 2026-09-04. Cosmetic PROPS
(torch / banner / chain) scatter on east–west wall faces by hash; floor
litter is packed away. PIECE SETS (`PIECE_SETS`: NullTale classic — the
DEFAULT — and dread, Pixel Chess stone / wood, Deja View; every set
fitted to a native box, one baseline), drawn at the art's own scale on
THE TILE GRID — every sprite pixel is one floor pixel — placed by
Options → Piece lift / shift in WHOLE TILE PIXELS (`tileLift` −4…+20,
`tileShift` ±7; `?tilelift=` / `?tileshift=`; `DEFAULT_PIECE_FIT` = the
designer's settled lift +5, shift +1; a piece stands on its square's
bottom edge and rises into the square north, which paints behind it).
The classic GLYPH piece set is gone (text, not pixel art). Decisions
that still bind the art: no numbers on hint arrows (the hint LIST under
the board carries rank swatch + SAN + eval + depth), one 3-px light-blue
frame for every god action, arrows in the player's own width / opacity
(Options → Arrow width / opacity), the enemy's last move a red arrow, a
displacement its blue arrow alone.**The designer's baseline, same
day: lift +5, shift +1.**

**PHASE 2 OPENS WITH THE 16×16 RENDERER — DECIDED 2026-09-07 (designer:
"I can't help but feel like our whole graphics pipeline might be a bit
janky. Especially if we want to commit to the 16x16 tile grid for
everything… I want to commit to 16x16").** Brief §2 item 5 is the
constraint: every drawn thing is 16×16 pixel art on ONE native-resolution
grid, composed in ONE buffer and scaled to the screen ONCE, by a whole
number where the screen allows it. THE DIAGNOSIS that decided it: the DOM
board was a CSS grid of FRACTIONAL cells and every layer a separate image
the browser resampled on its own, so alignment was a property each layer
had to re-earn by construction (a tile pixel drawn 7,7,7,6,7 device
pixels; the debris `<img>` a sub-device-pixel off the floor; FLIP slides
off-grid; no CSS trick fixes it at dpr 3, where a device pixel is not a
multiple of Chromium's 1/64-px layout unit), and a DOM grid of 10 000
cells × 5 layers cannot carry the 100×100 overworld.
**MILESTONE 1 ✅ 2026-09-07 — THE CANVAS BOARD** (`play/js/canvas-board.mjs`
+ `atlas.mjs` + `pixelfont.mjs` + `pixelarrow.mjs`; `play/README.md` §
"The canvas board"): one native buffer at 16 px per tile plus HEADROOM
(fit − 16 + lift), repainted from scratch in painter's order (floor, flat
terrain, debris over a ruin's stub, decor and the doorway over the
debris, marks under, the tall things row by row far-to-near — props and
pieces interleaved — marks over, the 3×5-font coordinates, the arrows as
PIXEL ART, the flight's pixels, a piece in mid-slide), ONE blit at k =
⌊device width ÷ (16 × files)⌋ (`integer`, the board centred in whole
device pixels) or the exact quotient (`fill`), on-grid slides in whole
native pixels, terrain fx with held end frames, the rumble as blit
jitter. THREE MEASURED FACTS (rule 18): the screen canvas must be sized
EXPLICITLY in whole device pixels from the container's
`device-pixel-content-box`; under an EMULATED ratio Chromium reports that
box in CSS px (the board falls back to css × ratio, `renderInfo.emulated`);
and a canvas at a fractional device-pixel POSITION is resampled — `none`
(the browser's own placement) measured exact in Firefox at every ratio
and in Chromium at ratio 1, `transform` fails everywhere, and Chromium at
any other ratio cannot be measured under Playwright (its emulation
resamples twice) — the real phone is the final word. Gates that remain:
`canvas-grid.mjs` (nine ratio × width cases, integer + fill, Chromium +
Firefox), `ui-smoke.mjs`, selftest, `flicker-scan.mjs` (Playwright's
Firefox: 3.3 / 18.4 piece- / debris-scale blinks per 10 s vs the DOM
board's 8.5 / 48.2; no white frame). **THE DESIGNER'S VERDICTS (2026-09-07,
Zenfone 10 + Firefox/Windows): "works fine on both desktop and mobile" —
k 3 on the desktop, k 6 on the phone — the fill scaling "doesn't look bad
either"; a "big white rectangle flash" laid at the SVG arrow overlay
(gone: the arrows are pixels in the buffer, nothing overlays the canvas);
and, the next session, "the current build looks fine with canvas
rendering on both desktop and mobile, including integer scaling" — the
DOM board goes.**
**MILESTONE 2 ✅ 2026-09-07 — THE DOM BOARD IS RETIRED** (the same
session; `play/README.md` § "The canvas board", Milestone 2). One PR of
deletion plus one move, GATED PIXEL FOR PIXEL: a guard dumped the debris
sampler's decoded sprites and every square of the buffer on six cases
(three themes, classic, a door set, another piece set; the start and 14
hot plies) before and after — every pack theme identical to the byte,
zero page errors. The in-house drawings (the classic set + the four
cracks) are the atlas's `classic` row (`phase0/lib/inhouse.mjs`, exact
against the browser's 16×16 decode of the SVGs it replaces); the repack
tool READS BACK a missing pack from the committed atlas; the debris
SAMPLER reads the atlas through `atlas.tileOf` under the board's theme
and door set (the ledger's sprite names keep the old custom-property
spelling as keys); the options LEGEND is five 16×16 canvases painted off
the atlas (main.mjs `paintLegend`); the promotion picker draws the set's
sprites; the residue ledger runs on `residueStep` (the replay page's
rule) over the last paint's own ledgers; the replay page mounts the
canvas board. GONE: `BoardUI` + `renderArrows` (board-ui.mjs is the pure
half: `classifyTerrain`, `residueStep`, `decorFor`, the hashes, the
masks, the set lists, `DEFAULT_PIECE_FIT`, `pickPromotion`), tiles.css,
style.css's tile / cell / piece / arrow / fx rules and `@sprites` block,
`piecetiers.mjs` + `lib/piecehalves.mjs` + `gen-piece-halves.mjs`,
`gen-sprites.mjs`, `canvas-parity.mjs`, `piece-grid.mjs`, the flight's
SVG sink, the Renderer option (`?renderer=`), the Piece-pixels modes and
the three % dials, the classic GLYPH piece set. ONE FIX fell out: the
canvas board had drawn the classic set's SVGs at their 150-px decode
size (a viewBox-only SVG's intrinsic size in Chromium), so a classic wall
block spilled over nine squares — the atlas row is 16×16 and the classic
theme paints right (and its debris now samples true 16×16 sprites).
`renderer.set` takes the scaling alone (the old `set('canvas', s)` still
reads); saved DOM-era options are not read. Gates after: selftest 43/43,
ui-smoke 186 ok, replay-smoke, test-debris 53, test-logreport 47,
strip-ruin-chips --check, canvas-grid `none` 4/4 in Chromium at ratio 1
and 18/18 in Firefox (the `transform` strategy fails by design, as
recorded; a build container's `npx playwright install firefox` can
resolve a different Playwright than node_modules' — install through
`./node_modules/.bin/playwright` so the build numbers agree).
DECIDED the same day (brief §5.1, §10, §11): the DUEL IS A CAMERA
VIEW OF THE SAME WORLD, zoomed (the largest integer step that fits the
arena, the dungeon outside dimmed — small fights zoom in, no letterbox,
no board mode); the CAMERA TURNS WITH THE ARMY (screen-up = facing; every
direction-bearing tile is mask-generated, so the masks are computed in
SCREEN space and the tiles follow the turn; debris buffers rotate by
index permutation; pieces and props never rotate; variant hashes key on
world coordinates; the turn is a cut) — only the DOOR needs edge-on art
per theme; the ONE MOVEMENT RULE (d-pad moves the king, every piece takes
the king step OR its own chess move that most reduces its BFS distance to
its slot, rotation turns the pattern, automatic moves never capture, a
wait button); integer scaling the default, FILL the fallback (designer:
"not a dealbreaker"). THE PHONE NUMBERS (1080-wide Zenfone 10, ratio
likely 2.625): a 10-file arena at k 6 = 96 device px = 5.7 mm per tile;
exploration at k 4 = 17 × 34 tiles at 3.8 mm; across current phones a
10-file arena lands between 5.0 and 7.1 mm per tile; a 1080p desktop is
height-bound at k 5–6 with 35 tiles of dungeon beside the arena. The
five decisions of the retirement session (designer: "sounds fine by
me"): retire now; the classic glyph set dies; tiles.css all the way; THE
CAMERA OWNS THE DESKTOP SCREEN; a generated edge-on door placeholder
until per-theme art exists.
**HANDOFF (end of 2026-09-07, after milestone 2): NEXT IS THE CAMERA —
the second PR, on a codebase with one renderer.** The buffer becomes the
VIEWPORT (the screen's device size ÷ k in tiles, plus a one-tile margin
for partial tiles and one headroom row), painted from a WORLD grid
through a camera {origin, facing, k}; canvas-board's `#origin(sq)` is the
ONE function to redirect (every painter takes an origin; hit-testing is
its inverse); full repaint of the viewport per change (about 600 cells at
phone k 4 — six arenas' worth of today's per-change paint; no dirty
rectangles until something needs them; a 100×100 painted whole would be
1600² and pointless). THE CAMERA OWNS THE SCREEN: k on BOTH axes, and
the duel zoom is the largest integer k that fits the arena on both axes
INCLUDING the headroom row (else the top rank's heads clip at the
barrier), the world outside dimmed — today k is the container's WIDTH
alone and the board box is capped at 560 CSS px, which is why the
desktop got k 3 (560 ÷ 160 floors to 3); a 1080p desktop is height-bound
at k 5–6, so the panels (the player's bar, the hint list; the desktop
sits the board beside them at 45%) move to give the camera the screen —
the desktop look is the designer's to judge on the first build. FILL
becomes DUEL-ONLY (exploration has no arena to fit; it is always
integer). FACING goes into the camera model NOW, the turn BUTTONS wait
for the army (a full turn is unobservable until an army turns):
`flipped` already IS the 180° turn — coordinate mirroring in `gridPos`,
`#squareAt` and `#arenaToBuf` — so quarter turns generalise it to a
facing with the buffer's width and height swapping; `classifyTerrain`
needs NO rewrite — a wall mask is eight neighbour bits, so a quarter turn
is a BIT PERMUTATION applied before the tile lookup, the same for the
four-bit ruin / pit-rim / doorway-post masks; debris buffers rotate by
index permutation; the gate is a debug ROTATE button walked over the
36-arena bed. Variant hashes move to WORLD coordinates (today the
arena's file + rank) so a crop or a turn never reshuffles the floor. The
EDGE-ON DOOR is a GENERATED PLACEHOLDER (the wall's top band with a slab
and a post above and below, brief §11) until per-theme art exists. A
zoom step is a CUT like a turn — which makes the brief's snap-zoom for
the tap-a-piece move free (phone k 4 tiles are under 4 mm, below a
thumb: the d-pad carries the army, the individual move needs the zoom).
THEN THE WORLD + THE ARMY RULE — most plumbing exists: stage schema 2 IS
a world file (a hand-built 100×100 map is the same file, bigger); the
debris ledger keys on the environment's uncropped grid through
`envTransform`, so the WORLD IS THAT ENVIRONMENT and a duel IS A CROP.
THE SAVE IS THE WORLD: holes (the Director's, written back after a
duel), residue, debris, army positions, facing and enemy states in ONE
serializable object per floor, keyed the way the debris ledger is today
— decide it at the milestone's start so the replay log can grow an
exploration section without a second format. NEW: a pure MOVE GENERATOR
on the world grid for the army rule's "its own chess move" (sliders
blocked by walls and pieces, knight hops, pawns forward along facing, no
check — ffish caps at 12×10 and rule 7's catalog is per dimension; the
exploration layer lives outside FSF by design, brief §2 item 1, and this
generator is NEVER duel legality); a STAMPING path that puts the CARRIED
formation, facing as it stands, into the barrier's crop (`dealMatchup`
keeps dealing random armies for the setup screen and the labs; the
molding invariants — royal rearmost, pawns in front per file — are the
shape of the pattern the player carries); the TRIGGER check as one pure
module read by the linter, the live check and the threat display; the
ENGINE BOOTS AT PAGE LOAD once a world exists (the barrier drop must not
wait on the WASM; the catalog + incremental per-deal variants already
cover any crop). The Phase 1 page survives as "a world the size of the
arena where the duel triggers at once", which keeps the god lab, the
smokes and the analyzer alive without a port. THE TRIGGER RULE IS STALE
AGAINST THE BED: brief §5.3 caps kings at 7 apart (gap 4) and §4.4 has
the band under re-investigation, but the wave-6 arenas stand the kings 9
apart (gap 8) and those were "the fun" — marked under review in the
brief; settle the band before enemies + LOS + the trigger pipeline, and
never build the trigger to the old numbers.**
**Phase 1.2 — the Gods debug overlay ✅ done**
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

**THE GODS v4 — MEMORY, HEAT, PROTECTION (designer 2026-09-05; built the
same day, on the first god-lab corpus ever played on the WAVE 6 bed).** The
designer's five complaints after phone play on wave 6 — back-to-back quakes,
the same piece or square hit twice in one quake, quakes that turn a mate-in-N
into a +10 that runs twenty turns longer ("the entire point is to SHORTEN
games"), no notion of forks/pins/skewers, and every preset but calm rewarding
passive play — were each measured on the corpora first and every one was
real. What the code did: a quake NEVER touched the meter and the meter had NO
CEILING, so once pinned the gods fired every ply (wave 6 baseline, shipped
v3: calm 13.8 quakes/100 plies with 53% on the very next ply, wrathful 32.1
and 59%; half of calm's quakes were the late PLY FLOOR, which on 200-ply
wave 6 games is mid-game); the budget re-enumerated on the post-edit board
with only the landed squares carried, so 21% (calm) to 55% (wrathful) of
multi-action quakes moved a piece twice, stepped into a square just
vacated, or cracked and smashed one wall in a breath; the guards asked only
whether an edit CREATES a hanging piece, never whether it RELIEVES one, and
the second displacement tier hunts immobilized pieces — which is what a
mating net is — so a third of the quakes fired onto a forced mate destroyed
or delayed it (calm 12/43 on mate-in-3 or less, wrathful 23/57); and the
meter's "forcing" list was the fifty-move list, so best-move engine play
drained it on 20–25% of plies, BELOW break-even on restless/wrathful — perfect
play could not hold the gods off, while a pawn shuffle drained it as much as
winning a queen. v4, all replay-safe and colour-blind: **a quake DISCHARGES
the meter** (`relief`, 0 = v3) and **the meter is capped at its ramp**; **the
backstop floor counts plies SINCE THE LAST QUAKE**; **a per-quake TOUCHED
set** (no square edited or vacated twice, no piece moved twice — no
cross-quake memory, designer); **HEAT** (`play/js/tactics.mjs threatLedger`,
grid-only every ply: a ply is hot if it captures/checks/promotes/pushes a
pawn OR creates a NEW threat — SEE-won piece, pin, skewer, fork, mate
threat — news ONCE per side per game via `threatMemory`; a 16-ply memory
left 25–39% of 600-ply shuffles reading hot; a hot record scales the fill
down); **TEDIUM** (`meter.t` — the NEVER-discharged twin: the cold share of the
last `tediumPlies` plies, no fifty-move event, threats blind, nothing sates
it; restlessness decides WHEN, tedium decides WHAT and HOW MUCH:
`rungWeights` and the budget draws key to it; without it a discharging meter
fired only weakens and 4 of 24 calm games hit the ply cap, and as a sated
accumulator it never rose on calm); **a threat or a CHECK heats but does not SATE, and a repeated position is
cold** (the refund is the fifty-move rule's own list — capture, pawn move,
promotion; checks on the list let two games run 600 plies as check farms
with the meter never above 0.08; replayed offline over the wave 6 records,
sating made no difference to pacing — the fill and the ramp set it, so the
ramps came down: calm 26 / restless 14 / wrathful 6); **the DEAD-BOARD
BACKSTOP** (`meter.deadFloor`: a P floor — calm 0.25 / restless 0.35 /
wrathful 0.5 — while the record has been dead for the whole tedium window
AND nothing irreversible has happened for `coldStreak` plies, undischarged,
gone the ply something happens; a discharging meter's dynamic range is too
narrow to close a 10×10 fortress — one took 29 holes and was still open at
the ply cap — so this, not volume, is the closer now); and **PROTECTION** (`tactics.mjs
protectedSet` on every quake: both ledgers + every FORCED WIN's net —
win-in-1 exact for either side incl. the turn-flipped "trap is set" case,
mate-in-2 by a node-budgeted checks-first search (quiet first moves on
boards ≤32 legal moves, 12k nodes; a mate-in-3 or a quiet-move mate-in-2
on a wide board is the known unprotected residue — and a WEAKEN can undo
one, since a cracked wall is a crate the mated king may capture to flee),
the mating move's PATH included — three vetoes on every rung: no displacement of a protected
piece, no landing on a protected square, no edit or hole on one; reason
codes `touched`/`protected`). No hard cooldown (designer: "too
predictable"); the gods still displace everything outside the net
(designer: "just not the specific pieces responsible"). Gates: selftest
39/39 headless (four v4 checks: ledger, meter, no double-touch + discharge,
and a forced win surviving 24 seeded quakes with the unprotected control
un-mating 8/8), ladder-smoke reports double-touches (must be 0) and
next-ply quakes. `phase0/harness/godlab/gods-metrics.mjs` scores any corpus
on exactly these axes; the wave 6 corpora are `results/godlab/
godlab-wave6-*-{v3base,v4a,v4b,v4d}.jsonl` and the numbers are in
`results/godlab/v4-findings.md` (v4a = protection+heat+discharge with the
old floor; v4b = + floor-since-quake, which broke termination; v4d = +
tedium as a sated accumulator + game-long threat memory; v4e = tedium as
a windowed cold share, threats no longer sating, the new ramps; v4f = +
checks demoted, repetition cold, the dead-board backstop, the wider mate
search — the shipped set). Presets carry
`tediumPlies` (the window: calm 60 / restless 40 / wrathful 24), the dead
backstop (`tediumFloor` 0.25 / 0.35 / 0.5, `coldStreak` 8 / 6 / 4) and the
new ramps (26 / 14 / 6); sate, onset, debt caps and the staleness knobs are
untouched pending the phone. **Measured (v4f, the shipped set): 4.2 / 7.8 /
10.7 quakes per 100 plies (v3 13.8 / 17.2 / 32.1), next-ply quakes 10 / 14 /
14% (53 / 32 / 59) all on dead records by construction, double-touch 0,
short-mate un-mating 0/2 · 0/9 · 4/19 (12/43 · 15/55 · 23/57 — the four are
mate-in-3s and a quiet-move mate-in-2, beyond the search), terrain remaining
52 / 43 / 27% (37 / 25 / 17), termination 23/24 · 24/24 · 24/24 at the
lab's 600-ply cap (the holdout is a fortress that took 37 holes).**
**v4.1 — THE LADDER, same day, after restless on the phone ("feels okay,
huge improvement": "weakens should definitely be weighted higher than
breaches — weakening walls does a better job of opening up new lines, plus
it's fun to smash thru walls").** A crack hands BOTH players a wall to
smash; a breach smashes it for them. `DIRECTOR_DEFAULTS`: weakenBias 1.8→3,
breachBias 2.2→1.2, breachAt 0.15→0.3 (displace/crumble untouched), and the
CRATE BRAKE now counts only GOD-MINTED crates (`terrainCensus(…, godCrates)`
→ `godCrates`; authored furniture is the stage, and a crate-heavy stage was
braking cracks from ply 1). The four biases are LIVE SLIDERS in the debug
panel (`#gods-ladder`, `options.godLadder`, persisted; `defaults` resets;
they retune the running Director through the dial path and apply to new
duels through `godConfig()`); the forecast row shows the shares they
produce at the board's current tedium. Measured (`*-v4g.jsonl`, same 24
deals): by ACTION weaken/breach went calm 31/22% → 39/11%, restless 15/14%
→ 25/13%, wrathful 19/17% → 24/11%; standing crates at the end doubled
(12→31% / 15→34% / 24→43% of authored); pacing 3.7 / 7.0 / 10.6 q/100p;
termination 24/24 in every arm; double-touch 0; the un-mated short mates
(0/1 · 4/8 · 0/9) are all `wins found 0` — the search residue, not the
ladder. Displacement still leads by action (38–49%) because the terrain
rungs run dry and the budget falls through to it — structural, as before.

**v4.2 — THE GODS READ THE ENGINE'S MATE LINES (designer 2026-09-05, same
day: "Wait we're NOT feeding engine results to The Gods to detect Mate in
N? … Ditch the dumbass rule").** The "never consults the engine" clause is
REPEALED for mate, and only for mate: the gods read a MATE score, never an
eval. `duel.mjs` now rolls first (`director.rollQuake`) and, only when the
quake is due, gathers mate lines — the enemy's fresh reply search
(`lastSearch`, its PV's first move is the one just played), a fixed-depth
probe of the board as it stands, and one of the turn-flipped "trap is set"
board (skipped when the mover is in check) — `mateGo` `depth 12 movetime
600`, paired limits, tracked like a reply search, `?mateprobe=` /
`?mateprobe=off`, the lab's `cfg.mateGo`; a failed probe is an anomaly and
the grid falls back. `director.quake(…, { rolled, mates, probes })` hands
them to `tactics.mjs mateNets`: every PV is replayed on ffish (stopping at
the first move it will not play), each mover / destination / PATH and the
LOSER's king zone (at the end of the line AND now) join the protected set;
`winDepth` 0 turns the grid search off (engine-only arm). Two lessons from
the first engine-fed corpus (`*-v4h.jsonl`): **the probe CLEARS THE HASH
first** — run on the transposition table the shallow reply search left
behind, a depth-12 probe reported +12 on a position a fresh search calls
mate in 3 (one trial in three; the referee, probing after the game with a
hindsight-filled table, saw mates the probe missed); and **the loser gets
no new captures** (`tactics.mjs terrainReach`): while a mate line exists,
every wall the losing side could take as a crate, every crate it could
take and every such square is off limits to the terrain rungs — three of
v4i's eleven moved mates were single WEAKENS with the engine's line in
hand ("safe by construction" is false next to a net: a cracked wall is a
capture the defender can spend on an escape). The trace's
`protected.engine` records hints, mate lines and probes; the overlay's quake
line reads "engine N mate lines from 2 probes". Gates: selftest 40/40
(v4.2: an engine line keeps the win with the grid search off, control
breaks it 6/6), a Node end-to-end on the trap fixture (two probes → black's
loss in 4 and the trap-set mate in 1, 11 pieces / 28 squares protected, the
quake dropped its hole outside the net), and a live browser duel where
every quake line carried two probes and no anomaly. **Measured (v4j, the
shipped set, same 24 deals): moved mates across ALL distances 1/9 · 2/10 ·
3/29 (v3 baseline 35/96 · 30/98 · 48/110), mate-in-3-or-less 0/4 · 1/6 ·
0/17 (12/43 · 15/55 · 23/57); the six that remain are one- or two-move
delays by pawn displacements outside the line or long mates that became
+15 to +23 pawns; pacing 3.3 / 7.4 / 11.0 q/100p, 24/24 terminated in every
arm, double-touch 0.** The corpora are `*-v4h.jsonl` (first wiring), `-v4i`
(hash cleared), `-v4j` (loser's terrain reach — shipped); the digest now
carries `preFen` so a probe can be replayed offline.

**v4.3 — THE EVAL GATE AND THE FOLLOWED LINE (designer 2026-09-05, same
day: "a more objective way to measure whether the gods actions are about to
screw something up"; the TWO-DRAW CAP was the designer's pick over a 1–2 s
"try many, keep the best" budget, which would put a thumb on the scale —
hunting for shortening quakes on purpose is a separate conversation if it is
ever wanted).** The gods still never read an eval to CHOOSE — targets stay
structural — but every composition is now JUDGED by one before it lands:
`duel.mjs #composeGated` probes the board a composition would leave (the
mate probe itself, `mateGo`, hash cleared, same side to move) and compares
it with the to-move probe taken before the quake (`tactics.mjs
evalSoftens`): a decided position (|score| ≥ `flipMinCp` 150) may not be
pulled toward equality by more than `softenCp` 200, may not flip, and a mate
may not be lost, delayed or flipped; an undecided one may not be handed a
decision (a swing ≥ `giftCp` 500, or a mate). A rejected draw is ROLLED BACK
IN FULL (`director.snapshot()` / `restore()` — debt, holes, god crates, the
meter, the ledger, the threat memory; the RNG deliberately NOT, so the retry
composes a fresh quake on the roll's pristine header, `attempt` on the trace)
and a second draw is judged; after `draws` (2) rejections a LONE WEAKEN
(`only: 'weaken'`) is drawn and judged; if that softens too, nothing lands,
the trace of record reads outcome `vetoed`, and the meter is still spent
(`director.vetoed` — a board where every composition softens must not be
probed every ply). No baseline (probe off or failed) lets the draw stand
unjudged; a game-ending terminal crumble is never judged. `evalGate` on the
DuelController (`{ draws: 2, softenCp: 200, flipMinCp: 150, giftCp: 500 }`,
null = off, `?evalgate=off`, the lab's `cfg.evalGate`); the trace carries
`evalGate = { attempt, before, after, verdict, rejected, fallback? }`, the
overlay's quake line reads "eval gate ok (+3.1 → +2.8)" or "… on draw 2 after
softened", and a vetoed ply gets its own warn line. THE FOLLOWED LINE: when
the player plays the very reply the enemy's deep search predicted
(`lastSearch.pv[1]`), the rest of that PV — searched at the enemy's own
depth, far past the probe's — is handed to `mateNets` as a hint on the
current board (source `enemy-search-followed`, the mate one move nearer);
replayed on ffish it can only be cut short by a board change, never mislead.
Gates: selftest 41/41 (v4.3: 17 `evalSoftens` verdicts; a rejected draw
rolls back clean and the retry composes on a clean header — the first cut
let attempt 0's path bleed into attempt 1's trace, caught in the dev test;
a veto spends the meter), the Node end-to-end on the trap fixture (judged ok
at mate −4 → −4), a followed-line Node test (probe off: the followed line is
the gods' only hint, 8 plies replayed, the quake keeps it; the control move
gives no hint — the LAB never exercises this path, both its seats are reply
searches) and a live browser duel with a verdict on every quake line and no
anomaly. **Measured (v4k, same 24 deals; every arm 24/24 terminated,
double-touch 0): the gate rejected 12 / 20 / 41 draws (calm / restless /
wrathful — softened 9/4/16, flipped 3/13/16, decided 0/2/6, mate-lost
0/1/3), 10 / 14 / 31 quakes landed on a retry (2 / 6 / 10 of them the lone
weaken) and 2 / 13 / 12 plies were vetoed; the REFEREE's own before/after
verdict — its hindsight-filled table against the gate's fresh probe — fell
from 3.8 / 3.0 / 4.3% of quakes to 1.0 / 2.7 / 1.9%, and every remaining
case is one the gate's own pair reads as flat or inside the band: the two
probes disagree about the position by 2–7 pawns or a mate distance (twice a
mate — in 4 and in 13 — the fresh depth-12 probe never saw), four sit
within a pawn of the 200 cp band — the residue is the probe's horizon, and
`mateGo` is its knob. Pacing 3.9 / 6.5 / 12.4 q/100p (v4j 3.3 / 7.4 / 11.0),
median plies 196.5 / 179.5 / 183.5 (199 / 214 / 169.5) — a 24-game sample's
noise, in both directions; un-mated 0/10 · 2/13 · 4/24 (1/9 · 2/10 · 3/29);
the gate costs one more `mateGo` search per quake (30–340 ms), two or three
on a retry.** Corpus `*-v4k.jsonl`; the digest carries `gate`, the trail
`vetoed`, and `gods-metrics.mjs` two new columns (`soften`, `retry`).
**Phone verdict 2026-09-06 (designer): v4.1–v4.3 "seem to play fine" —
the extra probes per quake and the silent veto both passed unnoticed; the
v4 set (memory, heat, protection, the ladder, the engine's mate lines, the
eval gate) is the SHIPPED Director. Presets were not retuned for v4.3 and
need not be until the phone says so.**

**THE REPLAY LOG ✅ built 2026-09-06 (designer: "a button to export a
detailed replay/debug log… to diagnose some possibly weird The Gods
behavior"; "we absolutely need a record of the exact board state right
before an undo happened"; "capture the entire board state every single
turn").** The duel's `record` (duel.mjs, `RECORD_ARRAYS` — the ONE list the
undo lens and the branch capture both read, so a new per-ply array cannot be
kept by one and lost by the other) now holds, every entry stamped `seq` (a
counter that never resets or rewinds — wall-clock order across undos, which
is also the Director's RNG order) and `at`: `states` (the exact board after
EVERY completed ply, post-quake — fen, holes, god crates, debt, the meters;
`states[0]` the start, an `ended` entry on the final position), `engine`
(every reply search: score, depth, seldepth, nodes, pv, ms, the `go` used,
`recovered`), `quakeTraces` with `timing` (roll / probes / compose / gate /
total ms) and `inputs` (the engine's mate hints VERBATIM — fen, score, pv,
source — the probe census and the gate's baseline: the Director's decisions
replay from the seed, the time-limited probes that fed them do not, so they
are recorded, never re-run), `attempts` (every composition the v4.3 gate
REJECTED, in full — its trace, its board, its verdict), `log` (the duel-log
lines the player saw, mirrored by main.mjs `log()`), `flags` (the ⚑ topbar
button: ply, board, optional note), and **`branches` — UNDO HISTORY**: an
undo MOVES the tail it cuts off into a branch (every RECORD_ARRAYS slice past
the snapshot's lens) with `from`, the exact state the instant before the undo
(board, ledgers, meters, how the game had ended if it had); branches are
never truncated, nested undos sort by `seq`, and the tunes ledger's undo
marker now points at its branch. `play/js/replaylog.mjs` builds the ONE
export object (`buildLog`, schema `dck-log/1`, deal provenance + variantIni +
`meta`: build stamp `APP_BUILD`, UA, engine `id name`, go/mateGo/evalGate/
probeGo, the gods options), delivers it (`deliverLog`: Web Share as a FILE
on a coarse-pointer device → `<a download>` → clipboard → console; the
share call runs inside the click's user activation) and keeps the last THREE
duels in a localStorage ring (`LogStore`, rewritten after every ply, on
undo, flag, end and back-to-setup — a reload or a dead tab loses nothing;
the stage picker's "Saved replay logs" row exports them). Buttons: ⚑ flag
in the topbar (in-duel), "Export log" on the end overlay and in Options →
Replay log (+ "Copy as text"), the debug panel's `copy trace` is now `copy
log` (same object, clipboard). `__DCK.log` = `build / flag / autosave /
saved / load / export`. Reader: `phase0/harness/log-report.mjs` prints a log
as a post-mortem — timeline with engine evals and quake summaries, every
quake's board before/after (`#` wall, `O` hole, `x` god-cracked, `^` crate)
with its ladder path, protected census, inputs, gate verdict, rejected
draws and timing, every undo with the pre-undo board and the abandoned line,
flags, anomalies; no engine, no ffish. Cost: a 10×10 state is ~300 B, so a
200-ply game logs well under 100 KB of states; a whole log runs 100–300 KB.
Gates: selftest 42/42 (a live 5x6 duel: states, engine record, inputs on
every due roll, one undo → one branch with the pre-undo fen and the
abandoned tail, seq unique, export round-trips, the store rotates), ui-smoke
asserts the export on the live board and an undo through the real button
path, and a Node smoke on s59 with three nested undos. **The first two logs
(s75 from Firefox/Windows, s79 from the phone — Android Firefox, flipped +
cropped stage, two undos, a mid-duel preset change on the tunes ledger) were
clean, and the first "gods delayed my mate" suspicion was a FALSE ALARM the
log itself settled**: a mate-in-10 the enemy's own search had conceded was
thrown away by the player's Qxe6 one ply before a quake (a depth-22 probe
of the recorded boards: M10 before the move, no mate after it, M12 after
the quake) — designer: "my human brain naturally has a hard time spotting a
M11, we can expect players to throw those away all the time". So (same
day): every ply's state carries `move` / `san` / `mover` and, for the
player, `predicted` (the enemy's predicted reply — pv[1] of a search whose
pv[0] it then played, no quake between), `followed` and `engineSaw` (that
search's score, enemy POV); `log-report.mjs` marks `⚠ left the engine's
mate-in-N line` on the timeline, counts them in the header, and `--probe
[go]` re-searches each quake's three boards (before the ply's move, before
the quake, after it) with the real engine (default `depth 22 movetime
20000`, hash cleared) and says in words what the move and what the quake
did (`deltaWords`: LOST / created / shortened / LENGTHENED / FLIPPED a
mate, else the swing); and the debug panel has the IN-GAME HALF — `before`
paints the last quake's `preFen` with the previous ply's ledgers on the
real board (player's turn only, non-interactive, any move/quake/undo
restores the present; `app.godsBefore`, `__DCK.gods.before()`) and `deep Δ`
queues a probe of that quake's three boards at the enemy's own `duel.go`
(hash cleared, ahead of the shallow delta and the hint probe in the idle
window, a flight already in the air is re-kicked when it lands; the verdict
lands on `record.quakes[].deepDelta` + the trace panel + the export;
`__DCK.gods.deep()`). Gates: selftest 42/42 (the replay-log check now
asserts the state annotations), ui-smoke exercises before/after and a deep
Δ through the real buttons. **THE "WHY" LAYER (designer, same day: "I want
to be able to trace their every action and why they did it")** — the audit
found the trigger and the outcome fully traced and the reasoning traced
only down to the roll: a pick was "index 3 of weights 4,2,2,5,3,3" with the
squares behind the indices unrecorded, rejections were counts by reason,
the protected set was a number, and the meters' inputs were thin. Now every
trace carries `moveEv` (the record meter's classification of the ply),
`threatKeys` (the new keys that made it hot) and `stale` (legal moves,
captures, locked pawns, pieces, pawns); every rung a quake walks appends to
`trace.candidates` its whole pool with scores (weaken: impact + open sides +
locked file; breach: + freed; displace: every tier's candidates, the tier
drawn from, the pool; crumble: the bare-floor and terminal squares),
`chosen` (the pick's index) and `rejected` (each candidate passed over with
its reason — `weakenCandidates` gained an optional `rejected` out-param and
the `walled_in` reason; the composite landing check is `composite_landing`);
`trace.protected` names `pieceList` / `squareList`, the threat `keys` per
side and `by` source (`tactics.mjs protectedSet` returns `keys` + `by`);
`#cloneHeader` resets `candidates` on a retry. All bookkeeping on data the
quake already had in hand — no new ffish or grid work (rule 14). Cost: a
quiet ply +~150 B, a quake +2–5 KB (a 200-ply game runs ~350–450 KB).
`log-report.mjs` prints each action as a ranked pool with the pick marked
and the rejects grouped by reason, the protected members and keys, and
each ply's classification. Gates: selftest 42/42 (every chosen terrain edit
must be the pick of a recorded pool; the protected set must be listed),
ui-smoke asserts pools on every due roll and inputs on every ply. The
third log (s77 The Smithy, 77 plies, 3 quakes, 3 undos — the first on the
why-layer build) was clean on every check: 150 KB, every chosen edit the
pick of its recorded pool, and one undo that abandoned a quake whose
replayed ply drew a DIFFERENT quake (the dice do not rewind — both are in
the log, the first in its branch), which is the branches doing their job.
**Designer verdict 2026-09-06: three logs, no gods misbehaviour found; the
replay log is DONE for this phase.**

**THE REPLAY ANALYZER ✅ built 2026-09-07 (designer 2026-09-06: "Next
session we'll build the in-game log/replay analyzer suite"; 2026-09-07:
"just do whatever you recommend. In my mind it's separate from the play
mode on something like lt-lit.github.io/dungeoncrawlerking/replay/").** It
is a SEPARATE PAGE — `replay/index.html` + `replay/js/replay.mjs` +
`replay/replay.css`, a sibling of `play/` on Pages (its own copy of
`coi-serviceworker.min.js` — rule 10, scope; `../play/vendor/stockfish.js`
finds its wasm and worker next to itself; `../play/style.css`
for the look) — so the game's phase machine and main.mjs are untouched
beyond two entry buttons (`▶ Review` on the end overlay → `../replay/
?latest=1`; `Open` on the setup screen's saved-logs row → `?slot=N`; both
just navigate — same origin, same localStorage, so the analyzer reads the
game's autosave ring directly). THE ONE RENDERING: the Node report's
rendering moved into `play/js/logreport.mjs` (pure; every function takes
the log explicitly; `renderReport` is the CLI's whole output, verified
byte-identical on the s77 log across `all` / default / `--ply` / `--json`),
and BOTH readers import it — `phase0/harness/log-report.mjs` is now the CLI
(args, `--json`, `--probe`) and the page prints the same lines on the real
board; main.mjs imports `deltaWords` from it too. `lineTree(L)` turns the
undo history into a TREE from `seq` alone (a branch's parent is the
EARLIEST later undo that rewound BELOW its fork ply, else the line of
record; each line carries full per-ply arrays from ply 0, the parent's
prefix + the tail). THE RENDERER'S ONE RULE: `board-ui.mjs classifyTerrain
(fen, ledgers, files, ranks)` — what every square IS (wall / hole / cracked
/ skin / weak spot / ruin / doorway / autotile mask) — was lifted out of
`setPosition`, which now only paints it, and `residueStep(prev, next,
skins)` is main.mjs paintBoard's doorway/rubble rule on DATA (the page
rebuilds a line's residue with one forward walk over its states; the game
still reads the last paint's classes — equivalent, adopt later if wanted).
The page: load (ring / `<input type=file>` / pasted JSON / `?url=` / a drop
/ `?sample=1` = the committed `replay/samples/dck-log_s77-the-smithy_
s1818861954.json`, the designer's third log), scrub (first/prev/next/last,
a slider, jump to quake / flag / undo, `←` `→` `q`), every state painted
with ITS holes + god crates + the stage's skins (re-derived from the
manifest by id + flip + crop + the king-anchored AUTO-CROP, which the log
never recorded — `buildLog` now exports `autoCrop`, and older logs recover
it by matching the stage's terrain against `startFen`; a stage missing from
the manifest paints without skins and says so), the ply's move as an arrow
(gold = the player, red = the enemy), the quake's marks, the eval bar (the
enemy's last search, player POV, or the probe), the gods line, the report's
timeline line + the meters as the ply line; THE STRIPS (`replay/js/
strips.mjs`, designer same day: "graphs plotting The God's stats like
pressure under the scrubber. Maybe eval score as well") — two small charts
under the slider on one x-axis with a shared cursor, tap or drag to scrub:
the gods' P(quake) as an area + tedium + heat + FUN (1 − staleness; designer:
"plot fun, and make it so I can toggle each line") as lines on ONE 0…1 axis,
each lettered at the right edge with a leader (direct labels — four series
on one axis, and no fourth hue clears the deutan floor against the other
three, so fun's green sits in the validator's 6–8 band that is legal only
with secondary encoding), every legend item a persisted TOGGLE
(`dck.replay.strips.v1`, `__DCK.replay.toggleSeries`), with
a tick per quake (half-height = vetoed) and gold notches at undo points, and
the eval from the PLAYER's POV on its own axis (±10 pawns, mate on the rail,
a probe as a ringed dot) — two measures, two charts, never a second y-axis;
series colours validated on the panel surface (dark lightness band, CVD
separation: `--s-pressure/-tedium/-heat/-eval` in replay.css), the readout
row wears the text tokens; ⚙ TUNE ROWS on the timeline (a tune belongs to
the line whose events surround its seq — `tunesFor`; `logreport.mjs
tuneWords` is the one wording, header and rows); sections under the board
in the report's order (the gods = the quake block with the pick marked; probe;
timeline with tap-to-jump and fork rows that step INTO a branch; undos;
engine; anomalies; duel log; header). THE WHY PANEL ON THE BOARD: before/
after, the protected set (pieces gold, squares blue), each rung's pool (the
pick gold, the rest blue, rejects dim; displacement pools as arrows), each
rejected draw's board (its residue via residueStep), each engine hint's PV
and the probe's PV as numbered arrows. PROBE ON DEMAND: the page's OWN
engine, booted on the first probe (no duel is ever live here), the log's
`variantIni` appended to the catalog (rule 7, cumulative across logs),
hash cleared; an eval of the shown board (`state.probe`) or the three-board
deep Δ of a quake (`quake.deepDelta`, `replay: true`), one job at a time,
visible failure + a fresh instance, three strikes and it stops (rule 12);
limits default to the log's own `go` (`?go=` / the field). Results attach
to the loaded log and export with it (`meta.analyzed`), plus "copy the
report as text" (the whole post-mortem on the clipboard — paste it to me).
Old logs load: every read is optional. Gates: `phase0/harness/test-
logreport.mjs` (Node, 47 checks: the full report, the pick marked, the
stacked phone layout, `lineTree` on the sample + a synthetic NESTED undo,
an old-shape log and an empty log render, the residue walk finds f7's ruin
at ply 32), `phase0/harness/replay-smoke.mjs` (Playwright, 64 checks on
the sample: load, scrub, marks, ruin, the strips' readout vs the trace
(fun = 1 − staleness) + a tick per quake + the four direct labels + a
legend toggle that hides a line and survives a reload + tap/drag
scrubbing + the probe's dot, overlays, branch
in/out, eval + deep Δ on a shallow `--go`, PV arrows, report, annotated
export, old-shape log via the object path with synthetic tune rows on the
right lines, paste, the ring, `?latest=1`; `--shots` →
`phase0/results/replay-smoke/`), and the existing gates re-run green on the
renderer refactor (selftest 42/42 headless, ui-smoke 145 ok). Surface:
`window.__DCK.replay` — `open / openUrl / openSlot / goto / next / prev /
nextQuake / prevQuake / enterBranch / leaveBranch / show / probe / deep /
export / report / waitIdle`, getters `view` (line, ply, fen, marks,
godsLine, plyLine, evalText, stage, skins, theme, engine, `cell(sq)`),
`log`, `tree`. Still deferred: the offline replayer that feeds the recorded
inputs back into the Director and diffs, and `gods-metrics.mjs` reading
browser logs (the lab's line shape and the export are two shapes of one
thing); mid-duel review (the in-game `before` / `deep Δ` cover the last
quake).

**THE DEBRIS LAYER ✅ built 2026-09-07 (renderer detail in this paragraph —
the per-cell `<img>`, the SVG flight, the three flicker rounds, "NO
CANVAS on the board" — is the DOM board's and HISTORY since its
retirement the same day; the canvas board draws the debris buffer and the
flight's pixels straight into its own buffer, and the ledger, the
painter, the transform, the caps, the settling and the flight model are
what survive unchanged) (designer: "a universal debris
system, so traces of destruction can be seen everywhere… blood splatters
for captured pieces… skid marks under displacements and worn paths sound
awesome… actual particle effects… stick to the 16×16 tiles… persist after
duels, dungeon maps are going to be 100×100").** The floor remembers.
`play/js/debris.mjs` is a pure ledger + painter: every violent event —
`smash` (a piece captures terrain), `breach`, `crumble`, `weaken`
(the gods), `kill` (a piece captured) and `skid` (a displacement) — is
recorded in ENVIRONMENT PIXEL SPACE (the base stage's own uncropped,
unflipped grid, y down from its top rank; a duel contributes through
`envTransform` — the deal's flip + crop + king-anchored auto-crop, ONE
function for squares, pixels and direction vectors, round-trip tested)
with its kind, material, origin, direction (away from the attacker; a god
edit is a radial burst), the EPOCH (the duel count on that floor) and ply,
and the SPRITE the broken thing wore (role + variant + wall case, never
pixels). THE LEDGER IS THE TRUTH, PIXELS ARE A CACHE: the painter
(`paintCell`) writes each env cell's 16×16 RGBA buffer from a PRNG seeded
by the event alone, sampling chunks off the actual sprite (plank pixels off
the crate, the brick face off the wall, a material palette when no sprite
is decoded), so a theme switch or a toggle repaints the whole history; the
buffer becomes a deterministic PNG data URL (`pngmini.mjs`, store-only
zlib, no canvas) shown by the square's own 16×16 DEBRIS IMAGE (board-ui
`setDebris`: a plain `<img>`, the cell's first child, under the sprites
and pieces, scaled to the cell exactly like the floor tile — 100%×100%,
pixelated; a NEW image is decoded OFF the DOM and only then swapped in
over the old one, so no frame ever paints without its debris), THE 16×16
RULE: no debris pixel is ever a different size or alignment from a floor
pixel. (Three cuts went before it: a data URL swapped into every cell's
background stack — a background that changes to an undecoded image paints
a frame without it, Firefox blinked every landing, and a cell's inline
style change restyled the piece inside it; then a per-cell `<canvas>`
painted with putImageData — which coincided with pieces vanishing for
whole seconds on a desktop Firefox while idle, not reproducible in
headless Firefox, so the canvases went on principle: an `<img>` is a
decoded bitmap to every compositor. The image paints over the cell's own
tiles, which only matters on a ruin's stub — rubble on rubble; debris is
floor-only.) Persistence RIDES THE ENVIRONMENT, never the duel:
main.mjs keeps one ledger per stage in localStorage (`dck.debris.v1:<stage
id>`), opened when the stage is previewed, ticked an epoch by every
`beginDuel` (Rematch included — same dungeon), saved after every event,
on undo, on end and on pagehide; the setup preview paints the stage's
scars. Growth is bounded twice (`CELL_CAP` 12 events per cell bucket,
oldest evicted; `PIXEL_CAP` 112 opaque px per cell, the oldest event
drops its smallest chunks first) and debris SETTLES (after an epoch the
1-px flecks are gone, after three the 2-px chips; blood dries red→maroon
after `DRY_PLIES` 20 or by the next duel; skids fade) — a 100×100 floor
is the same code with more cells. WEAR is a dense traffic grid, not
events: every move visits its landing square and, for a straight move,
the squares it passes over (a slider wears the file it runs on, a shuffle
draws its circle), three levels of translucent scuff at `WEAR_LEVELS`
6/16/40 visits — the one debris that needs no palette. THE FLIGHT
(`play/js/particles.mjs`): the debris does not appear, it flies — every
live chunk is drawn, on a ~15-Hz pixel-art tick, as PATHS OF 16-GRID
PIXELS on a second SVG over the board (board-ui `flightSvg`: the arrow
layer's twin, same viewBox, above the pieces and below the FLIP clones;
one `<path>` per colour, crisp edges — NO CANVAS anywhere on the board),
from the broken thing to the exact pixels the painter lands them on (the
painter decided first; the last frame IS the persistent debris), stone
hops short and bounces, wood flies far, the victim SPRITE SHATTERS into
2×2 blocks that fade in the air (`shatterOf`; a crumble's blocks fall
INTO the pit), a skid draws progressively under the slide; a chunk in the
air passes IN FRONT of a piece (the only place a board-wide layer can be
without giving the pieces a z-index), the landed debris is under it;
captures fly while the engine thinks (never awaited; the event is
`pending` until it lands, then its cells re-encode through `setDebris`,
which touches nothing else on a cell — a held quake frame stays held —
and the flight is released once the swaps have landed, a few ms), quake
rungs fly inside their beats, and with the flight OFF a rung's debris
lands AFTER the rung's own animation (`after`), never before the wall
has broken. THE FLICKER ROUNDS
(designer's first phone sessions: "pieces and the debris sometimes
flickering for a split second… right after a capture all the pieces will
blink out of existence, or the blood and debris will be rendered on top of
the piece layer"): (1) the flight runs ONE frame loop for every flight in
the air — flying → landed (chunks held, `landed` resolved) → released
once the cells' images have swapped — where per-flight loops had cleared
each other's chunks at 15 Hz; (2) the flight never gives the pieces a
z-index: an intermediate cut stacked them over a board-wide flight layer
with `position: relative; z-index: 3` — which made FIREFOX DROP EVERY
POSITIONED CHILD OF THE CELLS (pieces, sprites, torches) for a frame
during the quake animations, reproduced and isolated in Playwright's
Firefox (the door and torch of s59 vanishing 7–8 times a duel with the
z-index, 0 without, 4 with the z-index and the flight off) — NEVER give
the pieces a z-index; (3) NO CANVAS on the board: the persistent layer is
the per-cell `<img>` above and the flight is SVG paths — the per-cell
canvases of the third cut coincided with the designer's "while idle on my
turn, all the pieces will randomly disappear, sometimes for OVER a second,
a lot more on desktop" (Firefox/Windows), which 25 s of idle in headless
Firefox with a per-frame DOM sampler did not reproduce (pieces present and
visible in every sample, only the hint arrows mutating), so the canvases
went on principle. Headless Firefox also records whole-board white/black
frames in every build including the pre-debris one (a capture artefact),
so the recording (`flicker-*` in the session's scratch, not committed) is
only good for per-square blinks; the phone and the desktop are the judge —
and the designer's verdict on the `<img>` build (same day): "didn't see it
this time". The recorder + scanner is committed as
`phase0/harness/flicker-scan.mjs` (record a duel or an idle turn in
Playwright's Firefox or Chromium, scan the frames for squares that blink,
compare builds); Firefox needs `npx playwright install firefox` once. A capture's victim is
the square whose occupant VANISHED (the landing square or the en-passant
pawn), a shattering crate holds until the piece arrives (no dissolve),
a piece still dissolves under the blow. Toggles filter the PAINT, never
the record (Options → Debris: destruction / blood / skid / wear /
particles, an amount slider 0–200% scaling counts and the cap — its 100%
is the designer's settled baseline, what the first cut painted at 200%
(`debris.mjs BASELINE` 2, hands the painter intensity × 2; a setting
saved on the old scale is halved once on load, `options.debris.v` 2),
Clean this stage / every stage; `?debris=off|all|<list>`; `data-debris`
on the board); an undo forgets this epoch's events past the rewound ply and
recounts the traffic from the record. The RUIN autotile lost its baked
chips (`RUIN.chips` 0 in the repack tool; the committed tiles rewritten
by `phase0/harness/strip-ruin-chips.mjs`, which strips isolated ≤2-px
components and refuses anything larger — every fleck on the floor is the
debris layer's now, one set of dials). Gates: `phase0/harness/
test-debris.mjs` (Node, 53 checks: the transform under flip/crop/auto-crop,
buckets, cap, undo, traffic, serialize, determinism, sprite sampling,
settling, drying, the shatter, the painter's cap and toggles, the PNG
round-trip against png.mjs, the strip), ui-smoke (one event per capture
and per quake rung, decoded 16×16 images on floor only, not one canvas on the board, the layer stack, the saved ledger, toggles
hide and keep, the preview shows the scars, a rematch is epoch + 1 with
every event kept, and a second page with motion ON: frames drawn on the
flight SVG, everything landed, no page errors), selftest 42/42,
replay-smoke 63/63 unchanged. `__DCK.debris` = ledger / env / tx /
options / stats / events / cell(sq) / paint(sq) / frames / busy / clean /
save. Held for round two (designer): fallen props, bones, cobwebs on idle
pieces, torches that gutter with tedium, hole craters, the promotion kit,
per-side blood; the replay analyzer paints no debris yet (the painter is
pure, so it can).

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
suitably chill"; its numbers are settled.** Restless: v4 on the phone
"feels okay, huge improvement" (2026-09-05) and v4.3 "seems to play fine"
(2026-09-06); wrathful reads as crazy, which is its brief — its extra heat
under the exposure guard (26 q/100p, 12.4 under v4.3) is the one number
still on the table, and `rampPlies`/`stalenessGain` are the walk-back
knobs for any preset. **Wrathful pass 2026-09-01: quakes can no longer
swallow pieces at all** (designer-final, after a wrathful hole ate a
knight at ply 13 — the tuned corpus measured wrathful at 1.96
swallows/game, median ply 51, so the ply-13 knight was typical, not a
tail). Crumbles now take bare floor only; the debt-forced hole still
lands (termination untouched), and the closed-endgame `terminal` crumble
that ends a fully-locked board is unchanged (it immobilizes, it does not
eat). The favored-seat model/edge for the live-regime
arm still needs the designer. Then **Phase 2 — exploration slice —
STARTS NEXT SESSION (designer 2026-09-07), and it opens with the 16×16
renderer (see "PHASE 2 OPENS WITH THE 16×16 RENDERER" above).**

**2026-09-04 — ARENA REFRESH: the test bed is now WAVE 6, s59–s94, thirty-six
hand-authored 10×10 arenas** (designer: the small stages had become useless,
the big complex 10×10s were the fun; each batch of twelve was previewed and
approved before anything was written). Rules of the bed, which the Phase 2
generator inherits: every arena is a plausible CROP of a bigger dungeon (rooms
with walls off-frame, corridors leaving by the edges, wall lines the crop cut
short), NOTHING is symmetric under mirror or 180° rotation — the designer's
standing complaint, and a fable session had just burned 40% of a weekly budget
on a dozen symmetric set pieces — and both king rows keep centre floor so no
deal auto-crops. Skins and themes are HAND-AUTHORED (`gen-skins.mjs` skips
wave ≥ 6; 12/12/12 hall/castle/crypt). The 1.2.4 bed (s01–s58) is ARCHIVED in
`play/stages-archive/` — not loaded; the godlab/meter-lab corpora in
`phase0/results/` were played on it, and `godlab/run.mjs stageClass` still
recognises its id ranges (the new bed is one class, `refresh`). The ui-smoke
default stage is `s59-hall-corner` (door at d8). The design vocabulary, stage
by stage, is listed in `play/README.md` § "Stages (schema 2)".

## Layout

- `replay/` — the REPLAY ANALYZER (2026-09-07): a replay log on the real
  board, its own page next to `play/` (imports `../play/js/*`, its own
  `coi-serviceworker.min.js`), `replay/samples/` the committed sample log.
- `play/js/canvas-board.mjs` + `atlas.mjs` + `pixelarrow.mjs` +
  `pixelfont.mjs` — THE BOARD (Phase 2, 2026-09-07): one 16×16 buffer
  scaled once, its art off `play/img/` (the atlas; `phase0/lib/inhouse.mjs`
  draws the classic row). `play/js/board-ui.mjs` is the pure terrain rule
  (`classifyTerrain`, `residueStep`, the hashes, the masks) + the
  promotion picker — the DOM board that file used to be is retired.
- `play/js/debris.mjs` + `particles.mjs` + `pngmini.mjs` — THE DEBRIS
  LAYER (2026-09-07): the environment's scar ledger + painter (pure), the
  flight (pixels the board draws) and the deterministic PNG; wired in
  main.mjs (§ THE DEBRIS LAYER), painted straight into the canvas board's
  buffer through setPosition's `debris` callback / `setDebris`.
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
node harness/godlab/gods-metrics.mjs results/godlab/godlab-wave6-*.jsonl  # the v4 scorecard: pacing, next-ply share, double-touch, un-mating, heat, floor
node harness/selftest-headless.mjs  # play/selftest.html in real Chromium (npm i --no-save playwright)
node harness/ui-smoke.mjs --shots   # live-board UI smoke on the canvas board: tiles/marks/arrows/probe/themes/legend/geometry on a forced-hot duel (+ screenshots) + the debris layer + the replay log's export/undo branch
node harness/log-report.mjs <dck-log_*.json> [quakes|branches|engine|all] [--ply N]  # a phone's exported replay log as a readable post-mortem (no engine needed; the rendering is play/js/logreport.mjs, shared with replay/)
node harness/test-logreport.mjs      # the shared report module's Node gate on the committed sample log (replay/samples/)
node harness/test-debris.mjs         # THE DEBRIS LAYER's Node gate: transform, ledger, painter, the debris PNG, the ruin tiles' chip strip
node harness/strip-ruin-chips.mjs --check  # the committed atlas's ruin tiles carry no baked chips (the debris layer owns the flecks)
node harness/replay-smoke.mjs --shots  # the replay analyzer (replay/index.html) driven headlessly on the sample: scrub, marks, overlays, branches, probes, export (+ screenshots)
node harness/flicker-scan.mjs record --browser firefox --out /tmp/cast && node harness/flicker-scan.mjs scan /tmp/cast  # the flicker recorder + blink scanner; --idle 25000 for an idle turn; compare <dirs…>
node harness/repack-tiles.mjs       # rebuild play/img/tileset.png + tileset.json + CREDITS.md (+ pieces.png) from the packs in assets-src/ (gitignored) — or, without them, read back from the committed atlas (the classic row is always regenerated)
node harness/canvas-grid.mjs --browser all  # the canvas board's one blit lands 1:1 on the device-pixel grid at nine ratio × width cases, integer + fill, per snap strategy (npx playwright install firefox once)
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
18. **Browsers do not resample two images alike (2026-09-07; measured by
    the piece-grid gate, retired with the DOM board the same day — the
    rule's conclusion IS the canvas board, and it is why nothing may be
    added beside it).** On the DOM board, the ONLY thing
    that lands on the floor tile's device-pixel grid in both Chromium and
    Firefox is a 16×16 image painted exactly as the floor is — a
    cell-sized box, `center / 100% 100%`. A box of another size, a 200%
    background, a background offset by whole tile pixels, the same box
    with `0 0` against a `center` floor, and a plain `<img>` (which
    behaves like `0 0`) all drift by a device pixel somewhere; and
    `top: -100%` is not the row above, because a CSS grid hands its
    sub-pixel remainder to some rows (35.6875-px rows over 35.70313-px
    ones) — measure the rows. Any position must be baked into the pixels.
    This is the case for the Phase 2 renderer: one buffer, one resample,
    nothing to align. Do not add another DOM layer that has to match the
    floor — there is no gate for one any more; draw it in the buffer.
19. **The atlas is the ONE art source (2026-09-07).** Every tile, sprite,
    crack and piece the game shows comes from `play/img/tileset.png` +
    `pieces.png` + `tileset.json` through `atlas.mjs tileOf` — the board,
    the debris sampler, the options legend and the promotion picker all
    read it, and `tileOf` is the one cascade (theme row, door set, variant
    wrap-around, the classic row as the fallback). Never put art in CSS
    again (a data URI decoded off computed style is a second source that
    drifts: the classic SVGs decoded at 150 px, not 16, and the canvas
    board drew them nine squares wide until the atlas replaced them), and
    regenerate the atlas only through the repack tool, which reads back
    what the packs are not on disk to rebuild.
