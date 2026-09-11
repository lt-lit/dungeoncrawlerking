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
door whose wall line runs UP the screen stands EDGE-ON on a generated
placeholder — since the camera, 2026-09-08; until then a north–south
door was a WEAK SPOT wearing the crack — and an authored double is
`door2-l`/`-r`, dealt on the screen, pairs along a file included), crate, chest (the LID is the line:
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
displacement its blue arrow alone.**

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
PIXEL ART, the flight's pixels; a piece in mid-slide is in the tall pass by its feet since 2026-09-10), ONE blit at k =
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
**MILESTONE 3 ✅ 2026-09-08 — THE CAMERA** (`play/js/camera.mjs` the pure
geometry; `play/README.md` § "The canvas board", milestone 3; the
designer: "just do what you think is best" on the decisions below).
FACING is in the camera model: which world direction points up the
screen, 0 north … 3 west, `flipped` the old spelling of 2 (it was false
everywhere in the game — only the selftest exercised it); a quarter turn
is a CUT — the buffer swaps its axes, every square, pixel, mark and
arrow goes through canvas-board's one `#origin`, `squareAtPoint` is its
inverse. `classifyTerrain` needed no rewrite: its masks stay in WORLD
space (the `wm-<mask>` test surface never turns) and `rotMask8` /
`rotMask4` permute them to the screen at the tile lookup, so wall faces,
ruin stubs, pit rims, doorway posts and the props hanging on a wall's
face follow the turn; a square's debris buffer turns by index
permutation (`rotTile`); pieces and props never turn; the cosmetic
hashes AND the checker key on WORLD coordinates (`hashCoords` — the
environment's cell through the debris ledger's transform, read at paint
time; the replay page builds the same from the log) so a crop, a flip or
a turn never reshuffles the floor. TWO DECISIONS TAKEN: (1) EVERY DOOR IS
A DOOR — the weak-spot rule for a north–south door is RETIRED (brief
§11): `classifyTerrain` records the door's wall line (`doorLine`), `weak`
is masonry alone, a door always carries its wall case, doubles pair
along a rank AND along a file (a stack is the same double seen from its
side) with the halves dealt on the SCREEN (`doorHalf`), every door
leaves a doorway and the doorway mask has four bits; on the screen a
door whose line runs up it paints the GENERATED EDGE-ON PLACEHOLDER (the
wall's case with a slab in the leaf's own two tones and a post above and
below in the doorway's post tones, composited per theme / door set /
case) and an opened north–south doorway is the doorway tile turned a
quarter — so d8 and c3 on s59 stopped reading as cracked stone; (2) THE
CAMERA OWNS THE SCREEN on a wide screen only: main.mjs stamps
`body.layout-wide` at ONE breakpoint (`WIDE_LAYOUT` 900 px, `?layout=`
pins it), style.css makes the duel screen two columns — the board an
explicit box the canvas fills (`fit: 'box'`: k the largest integer step
that fits the board AND its headroom row on both axes, centred in whole
device pixels; fill the exact quotient of the tighter axis; a box without
a height falls back to the width fit) sticky under the topbar, the bars
/ hint list / eval bar / setup panel / log / debug panel in the column —
and a 1080p desktop goes from k 3 to k 5 (height-bound; 1280×720 gets k
3); a phone keeps the stacked layout and the width fit the verdicts were
given on. Fill stays a duel option (there is no exploration yet). The
turn BUTTONS wait for the army: the debug pair in Options → Look ("Turn
the view", not saved), `?facing=`, `__DCK.renderer.facing(n)`. GATES,
all green: `camera-guard.mjs` (milestone 2's method on six cases ×
fifteen hot plies, the inputs recorded on the build before and replayed
on the build after: north-up byte-identical except the door squares,
south-up identical except the art that legitimately turns — the old
flipped path mirrored positions and nothing else — 166/166),
`facing-walk.mjs` (all 36 arenas × facings 1–3, a dressed position: the
camera's paint equals the world itself rotated painted north-up,
108/108), `test-camera.mjs` 80/80, selftest 44/44, ui-smoke 213 ok,
replay-smoke 63, test-logreport 47, test-debris 53, strip-ruin-chips,
canvas-grid 4/4 Chromium + 18/18 Firefox (`./node_modules/.bin/playwright
install firefox`). NOT DONE, on purpose: the buffer as a VIEWPORT over a
world grid larger than one arena (the dimmed dungeon around a duel, the
one-tile margin) — there is no world to paint yet, so it is the FIRST
step of the next milestone; per-theme edge-on door ART. **THE DESKTOP
LOOK IS THE DESIGNER'S TO JUDGE ON THIS BUILD** (a 1920×1080 shot: the
board 800×860 device px at k 5 in the left column, the panels a narrow
text column on the right — functional, not designed).
**MILESTONE 4a + 4b ✅ built 2026-09-08 — THE WORLD, THE WINDOW, THE ARMY,
THE WALK** (`play/README.md` § "The canvas board", milestones 4a and 4b;
the layout list below names the modules). DECIDED WITH THE DESIGNER the
same day, before the first line: EACH RUN HAS ITS OWN SAVE, one object
(`play/js/run.mjs`, `dck-run/1`: the floor whole, the army, the start,
the turn list — a run replays from its seed and inputs; ONE localStorage
key; export / import as a file through the replay log's delivery path,
`?save=<url>`), NO META PROGRESSION, NO BACKWARD COMPATIBILITY ("assume I
do not give a single shit about backwards compatibility" — a stamp
mismatch is refused with one line, no migrations; the replay log's own
duel shape is untouched because the committed sample and its gates run
on it); A ROTATION COSTS A MOVE (a wait with a turned pattern; the
camera cuts to the new facing and the army reforms over the following
turns); the rest of the discussion's defaults stood: the king never
moves alone, a slot on blocked ground sends its piece to the nearest
reachable floor cell (ties toward the king), friends pass the BFS and
enemies and terrain do not, a diagonal king step between wall corners is
allowed and watched, pawns push one square on a walk, the camera locks
on the king and the world slides under him, the default zoom fits
fifteen tiles across the short axis, the 3×2 kit is the walk's army
(`?army=setup` for the knobs), no undo on the walk, a start marker in
the map file (`@`, digits reserved for the enemy spawns), a 3×3 pad
with wait in the middle (superseded the same day by the d-pad — see the
HUD note under 4c). THE ENVIRONMENT IS THE WORLD: the Phase 1
page's world IS the dealt arena (its crop the identity, no mirror
exists — a flip is how a lab world is built); a world duel is a crop
with the army's facing (4c). THE FIXTURE (`play/worlds/w01-the-
undercroft`, 60×40, `phase0/harness/gen-worlds.mjs` carves it from a
written plan) IS THE DESIGNER'S TO APPROVE from `world-shots.mjs`'s
render; the phone verdict on the walk is the milestone's gate — **IN,
2026-09-08 (designer): "Seems to work fine on mobile and desktop" — the
walk-around build passed; the branch merges as it stands.**
**MILESTONE 4c ✅ built 2026-09-08 — THE BARRIER BY HAND**
(`play/js/barrier.mjs` the pure half; main.mjs § THE BARRIER BY HAND;
`play/README.md` § "The canvas board", milestone 4c). A debug button on
the walk (⚔ Barrier, `B`, an initiative select; `__DCK.walk.barrier`)
drops the barrier on the army as it stands. DECIDED WITH THE DESIGNER the
same day (2026-09-08 — "a duel can start at gap 4 for now, and the kings
have to be aligned"; the rest "just do whatever you think the default
is"): THE KING ANCHORS THE ARENA — his rank is row 0, his facing
arena-north; WIDTH = the local room width at the king's rank (brief
§4.1), capped at THE ARENA'S 10 FILES (designer, same day, on the first
phone log — a 12×9 duel in the antechamber: "Max arena is 10x10 … a
12 wide board is k 5 on mobile and that is officially too small for my
thumbs"; the engine's 12 is the engine's, not the game's), the window
centred on the king's file and slid whole to stay inside the room,
under 3 wide refused; GAP EXACTLY 4 with
THE ENEMY KING ON THE PLAYER'S KING'S FILE (strict colinearity — brief
§5.3's band is amended for the barrier; the trigger conversation may
loosen it), so the DEPTH IS COMPUTED, not dialled: the player's molded
depth + 4 + the enemy's, by iteration on the crop's real terrain
(`planBarrier`: grow while a side overflows, shrink by the surplus when
the gap runs over, refuse past the engine's 10 ranks — a 2-deep kit vs a
2-deep enemy is 8 ranks, the kings 7 apart; the 3–12 × 5–10 cap now
lives in `buildMatchup` too, since a runtime crop never passes the stage
loader); THE STAMP IS THE PATTERN, not the walk positions (the
formation materializes whole — stragglers snap into their slots — molded
by the deal's own rule with the royal PINNED to the king's cell and the
back row in the order the player walked with: `layoutArmy` gained
`royalAt` / `order: 'as-given'`, army.mjs `bagOfPattern`; the enemy is
pinned to the same file; the camp-line variant falls out as for any
deal; a crop the armies cannot fit refuses with one line); INITIATIVE IS
THE TURN FIELD, never a seat swap (the player is always White, brief
§4.4's "plays White" reads "moves first"); the enemy is dealt fresh from
the setup screen's Black knobs (re-dealt on a lint failure); a square off
the map is the barrier's wall (`arenaFen`; a planned crop never hangs
off — the window is the floor run and the enemy king must stand on
floor); THE DUEL RUNS ON THE WORLD — `startDuel(session)` is the one
path after the deal for both pages, the board a WINDOW over the run's
world (`mountDuelBoard`: the crop at the army's facing, viewport screen,
the dungeon dimmed — under the tall pass now, so the top rank's heads
rise undimmed — the coordinates keyed on camera − crop facing), every
ply written into the crop's cells, the world's own layers seeded into
the Director BEFORE the terrain anchor (`DuelController` opts `holes` /
`godCrates` from `World.cropLayers` — a pit is never a standing wall nor
weakened into a crate; every off-map square joins `holes`) and the
residue seeded from the world's doorways and ruins; WALKING OUT is ONE
overlay button (Rematch / Re-deal / Back / the cheat Undo hidden on a
world duel): a WIN clears every letter in the crop (the enemy is gone
from the floor) and re-spawns the pattern whole around the king's FINAL
cell, facing kept (promotions revert, captured pieces return — brief
§8; `spawnArmy` `lenient`: a king the closer sealed in a pocket walks
his army out anyway, the rest on the nearest floor beyond); a LOSS ends
the run (`run.ended`; the save stays exportable, the resume card says
so, `beginRun` refuses it with one line); an ENGINE ERROR restores the
floor, the army and the ledger from a pre-drop snapshot. THE RUN records
a duel as its RESULT (`run.mjs recordDuel`: kind 'duel', crop, seed,
initiative, result, termination, plies, quakes, the final FEN, the log
id — never its plies, which the replay log holds; `run.turn` counts
inputs alone) and a PENDING entry is written before the floor changes,
so a reload mid-duel re-drops the SAME seeded duel from move one (Back
is hidden during a world duel); THE DEBRIS LEDGER LIVES IN THE RUN (one
per floor, `floors[id].debris`, carried by `updateRun`; the walk binds
it at the identity, a barrier through the crop, `debrisSave` routes to
the run save after a walk turn and never mid-duel; the walk's smash
records its crate's own splinters by CELL — `debrisEventCell`, the
square-name wrappers cap at file `l` — its steps wear the floor, and the
walk board PAINTS the scars through `setCellDebris`); THE REPLAY LOG
carries a `world` block (the world, the crop, the stage the crop made —
terrain + skins — the floor's layers at the drop) and the analyzer paints
a barrier log from it without a manifest (`resolveStage` reads it first;
the report prints a `world` header line); `DuelController.adjudicate`
(a concession, `__DCK.walk.concede`) is the test surface that ends a
duel on demand. Gates: `test-barrier.mjs` 60 (the fixture at every
facing: the pin, the gap, the crop reading north-up, the order kept, the
window on a wide hall, a crawlspace refused, terrain deepening the crop,
past 10 refused, off-map walls on a hand-built crop, the layers, the
run's duel entry, the lenient spawn), ui-smoke 318 ok + THE BARRIER block (a
smash on the walk in the run, the drop by button, the crop's FEN equal to
the duel's every ply, the window, the pending entry, the log's world
block, a reload re-dropping the same seed, the one-button walk-out with
the army whole and the enemy gone, a second duel seeded with a hand-dug
pit, a loss ending the run, the analyzer on the barrier log), selftest
46/46, test-world 125, test-army 57, test-armygen, test-debris 60,
test-camera 80, test-logreport 47, facing-walk 108/108, replay-smoke 63.
THE WALK'S HUD was redone the same day on the designer's verdict
("the ugliest most unusable virtual d-pad I've ever used"; the snap-zoom
"absurdly oversized" on a desktop): the map fills the screen under the
topbar and the controls FLOAT over it — bottom-left A REAL D-PAD (the
designer's second verdict, the same day: "something that actually looks
and FEELS like an actual d-pad… I don't need a wait button right in the
middle": ONE cross, an inline SVG, driven by where the thumb is — the
angle from the hub picks one of eight directions, an arm or between two
arms for a diagonal, the hub dead, a press steps at once and KEEPS
STEPPING while held, the thumb slides to steer, the pressed arm lights;
wait lives in the side cluster), the turn / wait / zoom / barrier cluster
bottom-right, the status strip along the top — a SWIPE on the map is a step in its direction (a short
pointer is still a tap), and the tap-a-piece SNAP-ZOOM is no longer a
constant k 6 but THE K A 10×10 DUEL GETS IN THIS BOX (`duelZoomFor`: the
width fit on a phone, both axes under the wide layout — k 6 on the
phone, k 3 in a narrow desktop window, k 5 on a 1080p wide layout).
**NOT here, on purpose: enemies on the map, line of sight, the trigger
(the conversation after this — do not build it to a number), per-theme
edge-on door art, a phone height for the duel box (the dimmed dungeon
shows beside the crop on a phone, not above or below), the analyzer
mounting the whole world (it paints the crop as an arena, so an edge
wall's autotile can differ from the game's).** THE PHONE VERDICT IS THE
GATE.


**THE TRIGGER CONVERSATION ✅ HELD 2026-09-08 (branch
`claude/phase-2-milestone-5-discussion-o4vlf6`, docs only — nothing built;
the discussion is the deliverable; the phone verdict on 4c and the d-pad
is still owed). FOUR DESIGNER RULINGS:** (1) **THE ARENA IS ALWAYS 10×10**
(designer: "just make it always a 10x10 arena. As soon as the two armies
fit in a 10x10 box and it's a legal board state with both kings in the
right rows, then the duel can start") — the gap is an OUTPUT (ten ranks
minus the two moldings; the kings ALWAYS 9 apart; gap 6 on open ground,
the wave-6 spacing), never a rule: the gap band, a gap scaled to the
player's width (proposed and superseded within the hour), the room-width
window and the depth iteration in `planBarrier` all go. (2) **MINIMUM GAP
2** (designer) — the deal's `gapMin`. (3) **NO 2-WIDE HALLWAYS** (designer:
"WHY NOT JUST NOT USE 2 WIDE HALLWAYS") — the generator authors nothing
under 3 wide, so brief §5.3's crawlspace clause has nothing to apply to
(w01's crawlspace was the sideways-walk test and goes with w01). (4)
**BOTH HAND-BUILT MAPS ARE RETIRED AND A GENERATOR IS THE MILESTONE**
(designer: "both these big maps are garbage. Just completely big blocks
of boring empty featureless rectangles"; "It's literally got 'dungeon
crawler' in the title, randomized dungeons are a requirement. Not just
one alg either, I need different floors to have unique styles and
features and themes"). MEASURED before the ruling — a 10×10 window slid
over every position of both maps and scored as the 36 arenas score: per
10×10 the wave-6 bed has 3 / 7 / 13 separate wall-or-crate features (min
/ median / max), 31 / 43 / 58 floor cells touching terrain and a largest
empty block of 12 / 19 / 40 cells; w01's busiest crop (of 255 with enough
floor to fight on) has 4 features, 22 touching and an empty block of 42,
and only 6 of its crops reach the PLAINEST arena on every count; w02
clears it on 367 of 3403 crops by accident of its packed rooms and has no
design in it. A room is an empty block by definition: no
rooms-and-corridors dungeon crops to the bed. **THE BED IS THE SPEC**,
and its vocabulary is ROOM RECIPES (`play/README.md` § "Stages (schema
2)": the nave with a colonnade, the cistern of pillars, the cell block
behind doors, the ossuary of alcoves, the barrel aisles, the crate-
blocked strongroom, the gatehouse two thick, the switchback of stubs, the
throne room's dais, the cave-in, the grotto, the cloister, the ruin).

**PHASE 2 MILESTONE 5 IS THE GENERATOR ✅ FIRST PR BUILT 2026-09-08, the
same day** (`play/js/dungeon.mjs`; `play/README.md` § "The dungeon
generator"; enemies + LOS + the trigger move to MILESTONE 6, on generated
floors). BUILT: THE BOX in barrier.mjs (`BOX` 10, `GAP_MIN` 2,
`boxPlacement` the one placement rule, `boxAt`, `planBox` with the enemy
on any far-row file, `planBarrier` the button walking outward from the
king's file; the summoning on ground connected to its king through a
`reach` mask in `layoutArmy` / `buildMatchup`; `test-barrier.mjs` 109),
THE LINTS (`LINT`, the bed's envelope: `denseFloor` 60, `openMax` 40,
`featsMin` 3, `narrowExtent` 10 — the bed is FULL of short 2-wide
passages, so the narrow rule is about EXTENT, a pocket no longer than an
arena; the touching share is reported, not enforced), THE PREFAB GRID
(style `vaults`: the 36 arenas as pieces off the loaded stages, each
once, turned by seed, seams scored, a wall ring), THE FIX-UPS (connect
by a 0-1 BFS tunnel three wide, widen by one 3×3 alcove at a pocket's
middle, dress by a pillar or a crate pair in the largest empty block;
one round settles every seed tried), THE START (a wide cell with a
legal box ahead), THE SPAWN DIGITS (`SPAWN_WIDTHS`, by distance), the
setup screen's "New floor" + `?gen=` + `__DCK.walk.generate`, the
fixtures `vaults-1…4` written by `gen-worlds.mjs` (w01 and w02 DELETED),
`test-dungeon.mjs` 92 (the bed's minima and maxima ARE the constants),
ui-smoke's walk and barrier blocks on `?gen=vaults&seed=1` with
geometry-agnostic checks (the drop at the start — a STAGING AREA three
wide and five long with a legal box ahead, so the kit's first steps move
it as one; a crate set down by hand on a knight's landing when no crate
is in reach of the start; a second duel with a hand-dug pit on a fresh
run of the same floor, since the walk-out lands where no box is
promised; the expects stream to stderr as they land, so a hang is
locatable). GATES GREEN: test-dungeon 92, test-barrier 109, ui-smoke 248
ok, selftest 46/46, test-world 125, test-army 57, test-camera 80,
test-debris 60, test-logreport 47; `world-shots.mjs` rendered the four
fixtures and the walk screen (`phase0/results/world-shots/`). THE DESIGNER'S DEFAULTS TAKEN ("get started
unless you actually need anything from me"): 60×40-class floors first
(62×42 with the ring; 100×100 the cap), the arenas as prefab pieces, the
five style names, four enemies at two levels, and the far row read as
the BAND. THE PLAN as discussed — the lints, measured off the bed, not
guessed: NO BOX IS BORING (for every floor cell, each of the
four 10×10 boxes the trigger would drop has a largest empty block under
30 cells, at least 3 separate terrain features and about 40% of its
floor touching something — the one rule that kills empty rectangles
everywhere at once); THREE WIDE EVERYWHERE (erode the floor by one cell:
the cells left must be ONE connected body and every floor cell within a
step of it — bans a 2-wide passage as the only way anywhere, allows a
niche, a pillar gap, an aisle); reachable from the start; NOTHING
SYMMETRIC (no room dressed as its own mirror — the designer's standing
complaint); DUELABLE GROUND (from most floor cells at least one box deals
legally for the kit and no region has none — checked by THE TRIGGER
FUNCTION ITSELF, so the lint, the live check and the threat display stay
one piece of code, brief §5.3). THE BUILD: SKELETONS decide the bones and
there are several — packed rooms for keeps and abbeys, a wide maze for
catacombs, cellular caves for grottos and fissures, and a PREFAB GRID
laying the 36 arenas themselves as pieces with their edge exits joined,
a style of its own and the fallback that always passes; ROOM RECIPES
decide what fills them — colonnade, pillar lattice, dais, alcove row,
cell row with doors, barrel / crate aisles, a crate-blocked door, a choir
screen, a stair core, an L with an alley — a room is never left empty and
the lint refuses one whose box comes out plain; PASSAGE RECIPES — a
guard post, stubs in a switchback, twin passages, a four-way crossing
with unequal quadrants, an enfilade; a WEAR PASS per style breaks the
bones after — ruin runs into masonry and gaps, a cave-in, masonry giving
way to cave, a breached curtain wall; ONE SIGNATURE SET PIECE per floor,
placed once, from a hand-authored library that starts with the arenas;
THEMES ride the style (the three art sets, skins per recipe: urns in the
crypt, crates in the store, chests in the vault, doors in every doorway,
masonry as weak spots). FIVE STYLES from the bed's own vocabulary as the
starting table — the keep (packed rooms; barracks, armoury, guard posts,
mess hall, stables, smithy; castle; signature the gatehouse), the abbey
(packed rooms with wide passages; nave, arcade, scriptorium, refectory,
cloister; hall; the throne room), the cellars (a maze of aisles; wine
cellar, larder, warehouse, strongroom, cistern; castle; the crate-blocked
strongroom), the catacombs (wide maze plus caves; ossuary, cell block,
warren, cave-in; crypt; the round tower base), the ruin (packed rooms,
heavy wear; any recipe, then broken; hall; masonry giving way to cave).
WHERE IT RUNS: a pure module in `play/js/`, seeded from the run so every
run gets its own floor, the SAME code in the harness; a retry loop on the
lints with a budget and the acceptance rate per style measured so a
phone never waits on a bad seed; every passing floor rendered by
`world-shots.mjs` into a GALLERY with its lint numbers beside it, styles
approved by eye in batches as the arena waves were; the generator places
the start, the enemy spawns with the level rising away from it, and the
stairs down for Phase 3. FIRST PR: the lints + the prefab-grid skeleton +
the gallery (floors at arena density in front of the designer fast), then
the recipe skeletons style by style; w01 and w02 retire with it (DONE,
above). NEXT PR: the recipe skeletons, style by style, each a gallery
batch — packed rooms first (the keep), with the room and passage recipes,
the wear pass, a signature piece and a symmetry lint; then milestone 6.
THE FIRST VERDICT CAME THE SAME NIGHT (2026-09-09, a Firefox log at walk
turn 96 on vaults-1): "this might work. A little incoherent, plus I'm
sure on replays people will start to notice the repeating patterns. Also,
why is the arena bounds not centered around the armies? Every duel is
off-center, even in relatively open areas." THE LOG SAID WHY: `kingFile
0` — the placement slid the box to keep the room's floor run inside it
and measured the run along the king's rank alone, so a king beside a
wall, or beside ONE CRATE in an open hall, stood at the box's edge with
his army hugging it. FIXED the same night: THE BOX IS CENTRED ON THE
KING, always (`boxPlacement` returns file 4; the run is reported and
decides nothing), test-barrier 108. AGAINST THE REPEATS, a stopgap: the
prefab grid lays pieces in EIGHT orientations (mirrored or not — a
mirrored arena is not symmetric) and WEATHERS each by seed (zero to
three edits in the ruin vocabulary, never on a door or an edge;
`weathered`), so no floor carries an arena verbatim; test-dungeon 96,
ui-smoke 254 ok (the deal at the start: kings on file 4).
COHERENCE is the recipe skeletons' to give (a mosaic of set pieces has
no floor plan) — the next PR, unchanged. The phone verdict on the
centred box is the gate. THE DESIGNER'S DIRECTION, the same session
(2026-09-09, discussion, nothing built): "if we can categorize them well
and use them intelligently, I could see dungeons that actually feel
different every playthru. Should we stick to 10x10 or get weird with the
building block size? … these stages will serve for now." THE ANSWER ON
RECORD: the arena's 10 has nothing to do with the piece size (the box
floats over the world and never aligns to a piece grid), so pieces go on
a 5-CELL LATTICE in multiples of five — 5×5 connectors and closets,
10×5 corridors and galleries, 10×10 rooms (the arenas as they are),
15×10 and 20×10 halls, 20×20 set-piece complexes — because variety of
SCALE is what a mosaic of equal squares cannot give; pieces are TAGGED
(role: room / corridor / junction / dead end / vault / set piece; size;
theme; EXITS — which sides open and where, computed off the piece, so
the 36 arenas tag themselves; density; a rating); a PLAN is drawn
before a piece is laid — a graph on the lattice: the critical path from
the start to the stairs, side rooms, a loop or two, dead ends, one
vault, the set piece — each node a size + role + required exits, then
pieces chosen by tag, oriented to match, seams EXACT where the plan
demands a connection (Spelunky's typed rooms on a critical path, with
variable piece sizes); the incoherence of the vaults is that the arenas
were authored as CROPS (rooms running off every edge), so new pieces
are authored FOR ASSEMBLY (walls on the border where nothing should
leak, openings where the plan can use them); the recipe generators
become PIECE FACTORIES feeding the same assembler (a generated room is a
tagged piece like a hand-authored one), so both roads meet and the
library never runs dry; styles = which tags a floor draws from + which
plan shapes. NEXT, IN THE DESIGNER'S ORDER: (1) a session on THE
CONTROLS AND THE CAMERA — ✅ HELD 2026-09-09, the paragraph below (theirs to lead; the open items on record: the
turn as a cut with no animation, the zoom as ± cuts and no pinch, the
walk's default zoom fitting fifteen tiles, the d-pad's held repeat and
the swipe, the tap-a-piece snap-zoom and its target pick, the duel box
on a phone with the dimmed dungeon beside it only, the desktop layout
"functional, not designed", per-theme edge-on door art); (2) THE PLAN
LAYER for the generator (the lattice, the tags, the plan graph, exact
seams), the arenas retagged, pieces authored for assembly in batches;
(3) milestone 6.

**THE CONTROLS AND CAMERA CONVERSATION ✅ HELD 2026-09-09 (designer-led;
brief §5.1 carries the EIGHTEEN RULINGS in full — read them there before
touching the walk; this is the digest). THE RULINGS: (1) the camera is
NORTH-UP on the walk, always — it turns for a duel and back after, each
cut a blackout wipe; the turn buttons are gone. (2) THE D-PAD TURNS THE
ARMY "like a typical third person video game": inputs are WORLD-relative,
the FACING FOLLOWS THE STEP (cardinal → that way; a diagonal keeps the
facing when it is one of its components, else the perpendicular one,
never about-face), a TAP in a new direction turns in place (a move), a
HOLD walks. (3) a duel starts WITH THE PIECES WHERE THEY STAND — nothing
summoned, 4c's stamp-is-the-pattern retired. (4) nobody is ever behind
the king — by the pivot and the box invariant, never by refusing a duel.
(5) NO CAMERA JERK on a tap; the snap-zoom is gone. (6) PINCH TO ZOOM,
quantized to whole k, the wheel on a desktop, no zoom buttons. (7) WASD /
arrow DIAGONALS by held-key chords. (8) POKÉMON FEEL: tap turns, hold
walks, seamless chained steps with one buffered input, a wall bump, the
battle wipe. (9) THE GAP IS BETWEEN THE PAWN LINES (the camp lines),
never the front-most pieces. (10) THE KING MOVES BY HIS OWN CHESS MOVE on
the walk, captures included, and the army takes its auto-formation move
with it. (11) EVERY INTERACTION WITH THE ENVIRONMENT IS AN ACTUAL CHESS
MOVE: a manual move offers chess moves only (the king-step option lives
inside the auto move alone), `^` is taken only by a chess move and never
by the d-pad, a front pawn cannot open the door dead ahead ("that is the
puzzle"), enemy pieces are never captured on the map. (12) THE ANCHOR IS
THE FORMATION'S FRONT-CENTRE, NOT THE KING (designer: "I'd want the pawns
to file in first and the king to go last"; the back line will be
editable): the d-pad moves that cell, it must be floor, every piece incl.
the king walks to its slot, the camera follows the formation's centre.
(13) CATCH-UP: two steps a turn when the path is longer than one, three
while behind the king — a pawn walks at the king's own speed and could
never make up a lost step (the designer's "half the army, usually pawns,
trailing way behind"). (14) TURNS PIVOT, WALKS WALK: a facing change
wheels the formation in place about the king, every piece sliding
straight to its turned cell (molded), one beat — a teleport dressed as a
slide, because an about-face in a three-wide corridor is a sliding
puzzle walking cannot solve. (15) THE ARMY ALWAYS FITS THE BOX — a 10×10
with the king on its first row, "not necessarily centered", slid along
his rank — after every input: a manual move that would break it is not
offered (the box was outlined while a piece was selected until 2026-09-10 — designer: "get rid of the big blue square when I make chess moves during exploration" — the filter stays, the outline is gone), a STUCK piece (no
path by its OWN moves — a knight beyond a thin wall has its hop back and
is not stuck) is teleported to its slot ("who gives a fuck"), nothing is
ever sealed off (the walk-out moves the whole army to the nearest floor
that holds it). (16) THE DROP: the box slides to hold every piece,
centred on the formation when there is slack; the enemy molds across the
pawn-line gap and around the player's pieces; the one refusal is a
position decided at load; milestone 6's trigger is four AXES on the king.
(17) DRAG TO LOOK AROUND, the camera gliding back on the next army
input; the swipe-to-step is gone. (18) the knight keeps its hop over
walls. BUILD ORDER: the CONTROLS AND CAMERA PR (1, 2, 5–8, 10–15, 17, 18
— the movement model is inseparable from the controls; branch
`claude/exploration-controls-camera-714e6f`), then the DUEL START PR
(3, 9, 16: barrier.mjs + armygen.mjs buildMatchup + the walk-out).
Supersedes in this file: milestone 4b's "a rotation costs a move" (a
tap-to-turn still does; a step's turn is the step's), the body-relative
d-pad and swipe in 4c's HUD note, the snap-zoom and `duelZoomFor`, the
walk's "king centred" camera, and — for the walk only — "the camera
turns with the army".**
**THE CONTROLS PR ✅ BUILT 2026-09-09, the same session** (`play/README.md`
§ "The canvas board", milestone 4d — the record; `play/js/army.mjs`
rewritten, main.mjs § THE WALK rewritten). Rulings 1, 2, 5–8, 10–15, 17
and 18 are live: the anchor is the formation's front-centre (`pattern.
anchor`, `army.at`), inputs are world-relative (`dck-run/2`), the facing
follows the step (`facingOfStep`), turns pivot (`pivotPlacement`), walks
walk with catch-up (front rows first, the king last, stayers and
finals as obstacles, one piece per doorway cell per turn, `via`
waypoints), the box invariant teleports the stuck and the strays
(`boxOf`), manual moves are chess moves only (`manualMoves`), the king's
move is a step the army follows; the board is north-up with the wipe
around the duel's cuts, the camera on the formation's centre, the pad
taps-to-turn / holds-to-walk with chained steps and a buffered input,
key chords, drag-to-look, pinch and wheel zoom, the wall bump, the box
outline on selection. Gates: test-army 97, selftest 46/46, ui-smoke 241
ok, test-barrier 108, test-world 125, test-dungeon 96,
test-debris 60, test-camera 80, test-logreport 47. THE FIRST WALK'S
VERDICT, the same day (three screenshots: "the king is lagging behind
sometimes… without manual moves"; "bumping into single blocks the army
should just be able to flow around"), FIXED the same day: the anchor may
stand one cell into stone beside reachable floor (`anchorMay` — a crate
or a pillar is flowed around) and "blocked" is a step that moves nobody;
a catching-up path prefers one that does not cut through a comrade's
slot (the king was being starved of his own cell); the king hurries
three, ties toward the anchor, and THE KING'S LEASH (`KING_LEASH` 3)
turns a step he could not follow into a REGROUP (the anchor holds, the
walk runs, nothing refused). test-army 106. THE SECOND WALK'S VERDICT
(designer, the same day, four screenshots on Vaults 4: "It mostly works…
I'm still seeing the king in weird spots despite seeing him make
multiple moves… I feel the pieces should at least be able to stay
adjacent if I'm only using d-pad movement"), MEASURED then fixed the
same day with a new instrument, `phase0/harness/walk-stress.mjs` (random
d-pad walks over the generated fixtures, `--hold` a thumb on one arm;
the king's lag to his slot, his distance to the nearest comrade, the
army's connectivity, teleports by reason, the worst turns as maps,
`--trace <turn>`): the teleports WERE the weird spots — 4842 in 11 000
random turns, almost all the box rule firing after the KING STEPPED
DIAGONALLY AHEAD of a comrade still queued at a door, which the rule
then read as "behind him" and threw across the map. Now (army.mjs, all
in the walk itself): THE KING NEVER OVERTAKES a comrade and no comrade
ENDS behind him (a way round a crate pair may dip `DETOUR` 2 cells
behind him within the turn), so the box row is kept by the walk and the
teleport is only for the truly stuck; a piece's plan HOLDS across the
planning passes unless a re-plan ends strictly nearer (the king and a
rook waiting on each other had swapped plans every pass); a comrade who
has not planned yet is not an obstacle (a pawn planned before the pawn
in front of it was detouring round the back of the formation); a way
round the comrades longer than the way through them by `DETOUR_MAX` 3
is not walked — the piece QUEUES up to the crowd; THE TARGETS OF A WALK
ARE ONE CONNECTED SET (`assignTargets`: the king's first, slots as they
are, the rest molded BESIDE a target already given, never behind the
king's cell, a cell behind his TARGET costing `BEHIND_COST` 2 per rank —
a pawn placed across a wall's corner had walked a parallel corridor for
twenty turns with the king forbidden to overtake it; the pivot places by
the same rule); STUCK means no way to the target that does not end
behind the king (a pawn in a pocket beside him rejoins by teleport); and
`KING_LEASH` is 2. Measured (held cardinal walks, 11 100 turns): the
king never more than two behind his slot, two on 17% of turns, two or
more from every comrade on 5.7%, 0–8 teleports a world (stuck or a
pivot's leftovers); random walks with diagonals: lag three gone,
teleports 4842 → 9–15 a world, regroups 588 → 90–130. test-army 106 (the
chain fixture's rook now stands where every pattern's royal-rearmost
rule puts it), selftest 46/46, ui-smoke 287 ok (its key-chord check
judges the chord's inputs, not their count — with motion off a held
chord chains a step per tick, and the north-east step it makes was
refused on the old build), the other Node gates unchanged. THE THIRD
WALK'S VERDICT (designer, the same day, five screenshots of "regrouping"
turns with the army spread round a wall stub: "Still getting odd
positioning sometimes. Maybe we're overthinking it. The whole goal of
this is to make it so when moving with just a d-pad the army should
never be split. They should stay in a battle ready cluster as much as
possible") made THE CLUSTER THE INVARIANT: after every d-pad turn the
army is ONE BODY — every piece TOUCHING another by chains, a diagonal
counting only when one of its orthogonal cells is crossable (a piece
across a wall's corner is not in the body — that corner was how pieces
slipped onto the far side of thin walls). army.mjs: `settleBody` judges
the walk's end; a laggard that could not move at all while the body went
on is STUCK and teleports beside the body ("just teleport pieces that
get stuck somewhere") unless a comrade was what stopped it (`queued`,
waited for); THE RETRACTION (`retractSplit`) gives back last steps until
the army is one body — the outside pieces' steps that did not bring them
nearer, then the body's own, THE KING FIRST — so the army waits for a
straggler still on its way; the second verdict's never-overtake planning
rule is RETIRED (it froze a run 1800 turns with two pieces level with the
king in a nook): the king plans freely, LAST in the order again, and the
retraction gives his steps back only when a comrade would end BEHIND him
(`behindKing`: behind his row and not touching — one rank behind but
touching, the queued rook at a door, is tolerated by walk and box loop
alike; the drop molds it); a plan made while a comrade still meant to
leave its cell is void once that comrade stays. Measured (held cardinal
walks, 10 300 turns): split on 0.2% of turns, zero collisions, the king
touching a comrade on every turn, 4–32 teleports a fixture; random walks
with diagonals: split on 4–8 turns a fixture. test-army 115 (+ THE
CLUSTER block), `walk-stress.mjs` grew `--teleports` / `--refused`
samples, a collision check and the would-be targets on a refused traced
turn; selftest 46/46, ui-smoke 331 ok. THE FOURTH WALK'S VERDICT (designer,
2026-09-10, five screenshots, every one "blocked" with open floor ahead:
"Alright they're much better at staying together. but now I'm getting
blocked in a lot of places I feel shouldn't be a problem"), MEASURED then
fixed the same day (7–11% of held cardinal inputs refused by the walk;
`--refused N` now prints the refused step's stage traces and a `pieces:`
line that rebuilds the position, `--lag N` the king's worst lags, and the
maps show `%` / `x` for an anchor / slot one cell into stone): the greedy
retraction is REPLACED BY THE ROPE (`ropeSettle`: the army settled from
the king outward, each piece taking the farthest cell on its walk path
adjacent to a piece already laid, a FOLLOW step for one with nothing to
touch, the chain giving back a step only then, a deferral and an
EXTENSION pass so the lay is order-blind); THE BODY IS EIGHT-ADJACENT
(`adjacent`, corners included — the corner-free `touching` now only says
where a target may be MOLDED, and the target set's connectivity and its
bridging re-mold use the body's adjacency, so a set leads through a
crate-and-wall gap by its corner cell instead of collapsing into a swap);
a molded target ties toward the ANCHOR; TWO RANKS behind the king is the
walk's tolerance (`behindKing`, read alike by the box loop, the drop and
`manualMoves`, which offers a move that leaves the box no worse); a
REGROUP THAT MOVES NOBODY yields the step's own whole walk with the
anchor still held (it never runs ahead of the army). Measured (held
cardinal walks, 11 000 turns): walk refusals 37–51 a fixture (104–168),
one body on EVERY turn, zero collisions, the king never more than three
behind his slot, 3–7 teleports; random walks with diagonals: walk
refusals 28–47 (147–163), split on 0–4 turns a fixture, 6–24 teleports;
every refused position replayed flows, the crate pair, the crate-and-wall
corner, the corner-only pocket and the one-wide gap included. test-army
115, selftest 46/46, ui-smoke 280 ok (its east walk runs 80 inputs to
the ring; its box check reads the tolerance). THE FIFTH WALK'S VERDICT
(designer, 2026-09-10, five screenshots: "Alright we're almost there.
I'm now getting situations where pieces end up behind the king") — SO
RULING 4 IS STRICT: nobody behind the king's rank after any input, the
one- and two-rank tolerances retired (`behindKing` is `dy < 0`; `boxOf`
whole after every turn; `manualMoves` filters on it; the harness counts
BEHIND THE KING turns, `--behind N` samples them; test-army asserts the
box whole through its walks). Paid for in army.mjs, each rule replayed:
THE KING WAITS (the rope gives back his steps for a comrade that would
end behind him; a piece the chain pulled to zero is not "stuck"); a
target is never molded behind the king's TARGET; THE KING'S PLAN NEVER
HOLDS ACROSS PASSES (released each pass as "he stays", so the comrades
take the cells they need and he plans round them, last); THE LAST
RESORT before a refusal, only where the strict rope collapsed a walk
that had moves — THE KING STEPS ASIDE (a walk with him pinned one king
step level or back, his cell given to the comrades who could move only
through it), then THE BREAKER (the comrade he waited for in vain is
stuck and teleports beside the body); no swaps in the rope, a stuck
teleport never on its own cell, a shared cell stays taken, a detached
piece rallies; the walk's STUCK is "no way at all"; THE QUEUE SWAP (a
comrade on its own target in a piece's way trades targets with it); THE
ANCHOR enters stone only beside or ahead of floor, and a second stone
step in a row SNAPS it to the floor beside. Measured (3000 inputs a
fixture, 22 400 turns): nobody behind the king on any turn but one (a
pivot in a two-wide nook — the residue), walk refusals 0–3 a fixture
(104–168 before the fourth walk), 0–7 teleports, one body on every turn,
zero collisions, the king within three of his slot, 14–18% of inputs a
regroup (the king waiting for the file). test-army 119, selftest 46/46,
ui-smoke 259 ok. THE DESIGNER'S VERDICT ON THIS
BUILD (2026-09-10): "Alright this will do for now, but we should
probably take another look at this eventually" — the branch MERGES AS
IT STANDS — and one more ask the same day, DONE: "get rid of the big blue
square when I make chess moves during exploration" — THE BOX OUTLINE on a
selected piece is gone (`setCellMarks` lost `frame`, canvas-board its
`BOXLINE` edge painter; the manual moves still filter on the box,
unseen); and THE SLIDE ORDER, the same day (designer: "when I move
with the d-pad, tall pieces like the king, their heads briefly render
under the piece to the north" — a piece in mid-slide painted LAST, over
everything, and the walk's arrivals in plan order with the king first,
so a comrade north of him painted over his head for the slide's length;
a slider now paints in the tall pass by where its feet are that frame,
duel slides included — canvas-board `#slideAt` / `#cellSlideAt`). THE
REVISIT LIST is on record in README milestone 4d: the
REGROUP RATE (14–18% of held inputs a turn the king spends waiting for
the file — the army standing still on a held pad), the pivot in a
two-wide nook (the one "behind" residue), a diagonal input from inside
a one-wide north–south slot still refused, and the anchor refused at
dead ends and the map's edge (143–265 a fixture, the map's own).
`phase0/harness/walk-replay.mjs` rebuilds any position from the
harness's `pieces:` line and replays one input with planTurn's stage
traces, or holds it N turns printing the maps — read a screenshot's
position into it before touching army.mjs again. NEXT: the DUEL START PR
(rulings 3, 9, 16 — barrier.mjs `planBox` reading the pieces where they
stand, `buildMatchup` measuring the gap between the camp lines and
molding the enemy around the player's pieces, the box slid to hold the
army, the walk-out keeping survivors in place and moving a whole army out
of a sealed pocket), then milestone 6. THE PHONE VERDICT IS THE GATE.**

**MILESTONE 6 — ENEMIES + LOS + THE TRIGGER, on generated floors: what the
conversation SETTLED and what it only PROPOSED.** Settled (designer): the
fixed box, min gap 2, no crawlspaces. Proposed in the discussion and not
objected to — build to these unless the designer says otherwise: THE
TRIGGER IS "YOUR BOX" — four 10×10 boxes on the player's king, one per
WORLD direction (his facing does not gate it: an enemy behind him can
catch him; at the drop the army turns to the axis as a cut and the
pattern stamps forward as 4c does — flanking stays §11), his rank the
box's row 0, CENTRED on his file (four to the left, five to the right —
nothing slides, designer 2026-09-09 — SUPERSEDED the same day by the
controls session's ruling 16: the box SLIDES along his rank to hold every
piece and centres the formation when there is slack; four AXES, not four
placements); a duel
starts the moment a HUNTING enemy's king stands on the FAR ROW of one —
anywhere on it: brief §5.3's band alignment is back and 4c's strict
colinearity retired, read from "both kings in the right rows" and NOT
YET CONFIRMED by the designer — and the deal is legal (both armies MOLD
into the box — fit means the molding fits, not where the walking pieces
stand — gap ≥ 2, connected, the lint); the hunter's targets are those
far rows and the threat display is those rows lit where the deal is
legal, forty checks per move. TWO THINGS THE FIXED BOX BREAKS IN THE
CODE: `layoutArmy` fills a window as wide as the army centred on the
pinned royal and skips walls without asking whether the floor beyond is
reachable — in 4c the window was the room, so it never bit; in a fixed
box an 8-wide army in a 3-wide corridor would materialize through a thin
wall into the next room — so THE SUMMONING MUST LAND ON GROUND CONNECTED
TO THE KING (a mask on the stamp; floor beyond a thin wall stays in the
arena and a knight may hop into it) and `armiesConnected` must run from
the king rather than from every piece; and a hunter that gets too close
backs off to nine, several steps, which the player can stall by
following at no gain (harmless, odd once). SIGHT: king to king, a ray on
the cell grid; walls and doors block, holes do not, crates proposed to
block (a one-line switch); no range cap; no fog — the whole floor and
every army visible as now; the enemy's STATE visible as a mark over its
king (hunting / searching); sight checked AFTER EVERY MOVE, not once per
enemy turn, so a step into a clear aligned line at nine is the player's
ambush with his initiative, and a crate or a pillar on the axis means no
fight from that cell. ROAM = SENTRIES for the first build (a predictable
encounter for the phone; routes later as a list of cells in the file).
THE HUNT: BFS from the enemy king over floor it can cross (its own pieces
pass; the player's, furniture and holes block) to the nearest far-row
cell, the first step as its body-relative king step into `planTurn`; it
never turns (a rotation would cost it a step; the pattern trails
wherever the king walks); with no legal cell reachable it walks toward
the player's king, which parks it at the mouth of wherever he hides;
sight lost → the last-seen cell, then it stands. SPEED PARITY: one enemy
turn per player input, waits / turns / individual moves included (every
input that leaves the king in place hands the hunter a step); the
player's turn, then each enemy in spawn order, the trigger checked after
each army's turn, every arrival in the one slide so the d-pad's repeat is
not slowed. INITIATIVE per brief §4.4; several at once → the chooser
overlay. A WIN removes the whole enemy army (letters inside or outside
the crop); the other enemy keeps its state through the frozen duel
(§5.5). NO CAPTURES ON THE MAP: `pieceMoves` already codes a `piece`
capture for the individual move, unreachable until an enemy exists —
turn it off; a piece dies only in a duel. THE ENGINE BOOTS WITH THE RUN
(a triggered drop cannot be refused for a cold engine the way
`walkBarrier` refuses now; a drop that beats it waits on one line). THE
SAVE: enemies in the floor's entry with state, last-seen cell and seed;
stamp `dck-run/2`; the turn list stays inputs only, the enemy's moves
pure functions of state + seed. IMPLEMENTATION HAZARD: two enemy armies
share lowercase letters and `Army.stamp` clears EVERY lowercase letter
before writing — the second army erases the first; the stamp must clear
its own last cells. SPAWNS: the digit read as the army's WIDTH (3…8,
§8's level telegraph) drawn from the run's seed, an optional per-spawn
block for an authored composition — the generator's to place now. Held
over, on purpose: flanking, patrol routes, a sight range, fog, aggro
between hunters, an enemy that smashes crates on its path, per-theme
edge-on door art, a phone height for the duel box, the analyzer mounting
the whole world, the debris flight on the walk's smash.**

**THE ENEMIES SESSION ✅ HELD 2026-09-10 (designer: "Alright, it's time to
get some enemies to fight… I'm thinking we make the player's starter army
4 wide. 1 rook, 1 knight, 1 bishop, 4 pawns. Enemies will be 3 wide for
now"; on the six picks below, "Sounds good, go ahead"). SIX RULINGS, built
to: (1) THE KIT IS 4×2 — K + R + N + B and four pawns, value 15, laid by
the molder as N K R B over P P P P (a width of four has no middle, so the
king stands second from the left; the anchor stays on his file);
`army.mjs OPENING_KIT` is the ONE constant (it was copy-pasted in six
places). ENEMIES ARE 3 WIDE FOR NOW: the spawn digit is still the width,
`SPAWN_WIDTHS` reads all threes until §8's ladder returns, and the two
pieces are drawn from the run's seed in a NINE-TO-THIRTEEN band (no
queens at width 3). (2) THE FAR ROW IS A BAND, any file of it (§5.3's
unconfirmed reading, confirmed; THE FAR HALF since 2026-09-11 — the
paragraph below). (3) CRATES AND DOORS BLOCK SIGHT, holes
do not; king to king, no cap, no fog, after every move (ANY TWO PIECES
since 2026-09-11). (4) A REAR OR
SIDE CATCH PIVOTS THE ARMY to the axis at the drop (ruling 14's wheel),
then the pieces are read where they stand — never a refusal of rear
axes. (5) the enemy band above. (6) SENTRIES FIRST; a closed door is a
wall to a hunter (automatic moves never take furniture). WHAT THE
SESSION FOUND STALE in the milestone-6 paragraph above: "the pattern
stamps forward at the drop" died with ruling 3; "the hunter never turns"
is moot — the facing follows the step and the pivot is inside it, for
enemies as for the player; `pieceMoves`' piece capture is ALREADY off
(an enemy piece is a blocked square to every walk move since the
controls rewrite); the engine ALREADY boots at page load, before any
run, so only a recycle in flight can delay a drop and `startDuel` waits
on it. TWO PLACEMENTS EXISTED: the walk's `boxOf` slides the box to hold
every piece, the barrier's `boxPlacement` returned file 4 — the duel
start makes the walk's the one rule. THE ORDER: the kit (one constant,
the fixtures regenerated, walk-stress re-run on 4 wide — a four-piece
front files into the vaults' 3-wide passages three deep, so the walk's
numbers on record are 3-wide numbers), THE DUEL START (rulings 3, 9, 16:
the player's pieces where they stand, the box slid by `boxOf`, the gap
between the camp lines, the enemy molded around the player's pieces, a
walk-out that keeps survivors in place), then ENEMIES (`play/js/enemy.mjs`).
**ALL THREE ✅ BUILT 2026-09-10/11** (`play/README.md` § "The canvas
board", milestone 6 — the record). THE KIT: one constant, the staging
area shaped by its slots, the fixtures regenerated; walk-stress on 4 wide
— one body on every turn, nobody behind the king, zero teleports, the
REGROUP RATE 27% of held inputs (14–18% on 3 wide: a four-piece front
files into three-wide passages three deep — the revisit list's first
item, heavier now). THE DUEL START: `planBox` reads `standingCells`, the
box is `boxOf` (the barrier's `boxPlacement` keeps only the lone king's
centred box for the lint), `buildMatchup` takes `white.cells` and
`gapAt: 'camp'`, an axis other than the facing is refused as the army
stands and dealt after `walkBarrier`'s `face` turn, `walkOutArmy`
keeps survivors in place and reverts promotions, `nearestHold` moves a
sealed king's whole army; test-barrier 160. THE ENEMIES: `enemy.mjs` —
`spawnEnemies` from the digits, `lineOfSight` (a ray through the cell
centres, the corner rule), sentry / hunt / search, `hunterGoals` on the
four axes through `armyAlongFast` (the pivot's placement, once per input
via `axisArmies`) and `farRowTargets` with the ffish lint, `triggerFor`
(the exact pivot on the one or two axes the king is nine off along),
`enemyTurn` (the king's neighbour nearest a goal by the BFS, driven by
THE KING'S OWN MOVE where it is offered — a d-pad step's catch-up carried
him past the far-row cell — each candidate judged by its outcome, a
regroup toward the goal above a sidestep, a WAYPOINT for an unreachable
target, a STALL by a recurring position → the pivot escape → a REST),
`liftInside` / `settleBack` for bystanders; main.mjs `walkEnemies` in
the walk's loop (sight, the trigger with the player's initiative, each
enemy's turn with the trigger after it, one slide), `walkResolveTrigger`
and THE CHOOSER, `walkBarrier` with an enemy / a far-row file / an axis,
the badges and the threat display on the board, `dck-run/3`,
`?enemies=off`, `Army.stamp` clearing only its own cells, the lint's
cached Board (`setFen`). MEASURED (`hunt-stress.mjs`, sight granted,
grid-only): the player standing 13 of 16 spawns caught (median 28 turns,
max 83), 3 missed at 120 — formations tangled in crate pockets, the same
item as the regroup rate; fleeing 16 of 16 (median 35, max 98); enemy
work 29 ms a turn standing, 56 fleeing, in Node. Gates: test-enemy 66,
test-barrier 160, test-army 121, test-dungeon 96, test-world 125,
selftest 46, ui-smoke 319 ok with THE ENEMIES block, replay-smoke 63. THE
PHONE VERDICT IS THE GATE. Held over, on purpose: patrol routes, a sight
range and fog, aggro between hunters, an enemy that smashes crates, a
planner over formation states for the pocket tangles, per-theme edge-on
door art, a phone height for the duel box, the analyzer mounting the
whole world.**

**THE FIRST PHONE LOGS ✅ READ 2026-09-11 — ANY-PIECE SIGHT AND THE FAR
HALF (designer, two replay logs from the phone: "First one had a lot of
trouble starting the duel. You understand that duel activation can force
the player's army to turn right? Or maybe the line of sight is too
strict. Maybe we should count it as any two pieces seeing eachother, not
just the kings" — and, on the measurements, "Do both, go ahead").**
MEASURED FIRST, before a line changed: THE PIVOT never refused (1,200
random placements and 2,246 walked turns across the four fixtures, every
axis) — a rear or side catch turning the army is ruling 4 working, not
the trouble; the first log's duel came on the south axis with the
enemy's initiative and enemy 3's king two cells behind its spawn, on the
far row — the shape of a sentry that noticed late and backed off (the
log holds no walk inputs; the run save export would replay the 181
turns); KING-TO-KING SIGHT held on 2–3% of enemy-and-position pairs
across the fixtures against 7–12% for any two pieces, and from farther
(median ten cells against seven; around the log's two spawns 128 and 66
of about 540 nearby floor cells against 344 and 220 —
`phase0/harness/sight-map.mjs`, an ASCII map of where a spawn sees you);
and THE RETREAT DANCE: the far row alone meant a hunter that first
saw the player inside nine had to back off to nine at SPEED PARITY, and
a player walking at it kept the distance forever — of six charges that
began under king sight, four never started in 250 turns while the enemy
retreated 15–86 times, and the same six with a wait after first sight
started within ten turns (`phase0/harness/charge-stress.mjs`: a crude
thumb walking the kit at every sentry, `--kings` the old rule, `--policy
wait` the wait). BUILT the same day, both: (1) SIGHT IS BETWEEN
ARMIES — `enemy.mjs armiesSee`, any piece of one seeing any piece of the
other, the kings first, at most 64 rays; `updateSight` reads it, the
last-seen cell stays the king's; `__DCK.walk.sight` too. (2) THE FAR
HALF — `barrier.mjs FAR_HALF` 5: a hunting king anywhere on rows 5…9 of
a box, on a file whose deal is legal, triggers (`triggerFor` returns
`row`; the deal molds it onto the far row as ever — its walking pieces
were never read, so its standing cell only names the axis and the file);
`farRowTargets` lists every floor cell of the far half of a legal file
(`far` marks the far row), so the hunter's goals, THE THREAT DISPLAY
(the far row framed, the band tinted — canvas-board `THREAT_TINT`) and
the trigger stay ONE function; a hunter inside five backs off to five,
never to nine; the drop records the standing row (`enemyRow` on the
pending entry, the run's duel entry, the duel getter and the log's
`world` block). MEASURED AFTER: charge-stress — sixteen charges, nine
sighted, nine started with a wait after first sight, eight walking on
(the ninth the driver stuck behind the enemy's formation in a corridor),
the dance zero; hunt-stress unchanged (13/16 standing, 16/16 fleeing —
from afar the far row is still the nearest goal). Gates: test-enemy 80
(a walled kings' line seen pawn to pawn, a blind pair behind a wall
line, seven ranks off triggering at once with the player's initiative
and the deal on the far row, ten off not yet, four off backing to five,
a charge from twelve met at nine), test-barrier 160 (the band's cells
per legal file, the far row marked), ui-smoke 256 ok (the ambush
through the pivot now SIX ranks off, its row in the run and the log),
selftest 46/46, replay-smoke 63, the other Node gates unchanged. THE
PHONE VERDICT IS THE GATE — and the run save export of a troubled walk
is the instrument to send with it.**

**THE WANDERERS ✅ BUILT 2026-09-11 (designer, on the far-half build:
"Alright seems to work a lot better. Can we get some wandering
enemies?").** Every spawn ROAMS by default (`enemy.mjs` state `roam`,
the enemy's `mode`; `?enemies=sentry` the old rule, `?enemies=off` none):
a WAYPOINT WALK ON ITS BEAT — `pickRoamTarget`: a floor cell its king can
reach by the walk's own BFS (its pieces pass; every other army, furniture,
holes and walls block), within `ROAM_LEASH` 12 of its spawn (the level
telegraph stays where the generator put it) and at least `ROAM_MIN` 4
off, not under a piece, uniform by ONE DRAW from the enemy's own seed
numbered by `roam.n` (`roamDraw`), so a run replays from its inputs; at
the waypoint a PAUSE of `ROAM_PAUSE` 2–6 turns (drawn), then the next;
the same `enemyTurn` machinery as the hunt (`approach`, the king's own
move, the stall / pivot / rest), speed parity; sight after every move,
so a wanderer that walks into view hunts at once, and a search that
finds nobody goes back to the beat (`restState`: the mode's state);
`enemyTurn` reports `paused` and `target`. THE STRANGER RULE (army.mjs
`enemyAt` / `landing`): two enemy armies share the lowercase letters, so
a same-side letter that is not one of THIS army's pieces is an obstacle,
never a comrade — before it the walk would have routed one wanderer
through another and the stamp erased its letters. The save carries
`mode` and `roam` (`dck-run/4`); the badges stay hunt / search only.
MEASURED: charge-stress `--roam` on vaults-2 (wanderers instead of
sentries): four charges, four sighted, four duels, median first sight
ten cells off (eight against sentries); hunt-stress unchanged (its
enemies spawn as sentries). Gates: test-enemy 100 (the default spawn a
wanderer, the beat within the leash with pauses and arrivals, the trail
replayed from the seed and through a save at turn 40, another seed
another beat, ten waypoints on bare floor, the search ending on the
beat, sight on the beat, two wanderers in one corridor never sharing a
cell), ui-smoke 270 ok (THE WANDERERS block: four roamers on the
fixture over thirty waits — kings off their spawns, no shared cell, the
letters whole, the leash kept, a second run of the same seed walking the
same beats; the enemies block on `?enemies=sentry`), the other gates
unchanged. THE PHONE VERDICT IS THE GATE. Held over: patrol ROUTES as a
list of cells in the world file, a per-spawn mode, aggro between
wanderers.**

**HANDOFF (end of 2026-09-08, after milestone 3 — HISTORY, kept for the
reasoning; 4a, 4b and 4c are built above): NEXT WAS THE WORLD +
THE ARMY RULE — the third PR (built the same day as 4a + 4b, above).** Its first step is the viewport: the
buffer becomes the screen's device size ÷ k in tiles plus a one-tile
margin and the headroom row, painted from a WORLD grid through the
camera's origin (canvas-board's `#origin(sq)` gains the origin offset;
`squareAtPoint` follows; the arena's crop is painted through the same
path and the world beyond it dimmed); full repaint of the viewport per
change (about 600 cells at phone k 4 — six arenas' worth of today's
per-change paint; no dirty rectangles until something needs them; a
100×100 painted whole would be 1600² and pointless). The duel zoom stays
what milestone 3 built (the largest integer k fitting the arena and its
headroom on both axes); exploration is ALWAYS integer and FILL becomes
duel-only then. A zoom step is a CUT like a turn — which makes the
brief's snap-zoom for the tap-a-piece move free (phone k 4 tiles are
under 4 mm, below a thumb: the d-pad carries the army, the individual
move needs the zoom). Decide the SAVE SHAPE on the milestone's first
day, before the first line (below). THE DUEL TRIGGER IS A DESIGN
CONVERSATION OF ITS OWN, NOT A NUMBER (designer 2026-09-08: "there's
going to be a shit fuck ton of rules dictating how and when a duel is
allowed to trigger. It's not just about the trigger band. We will get
to it") — do NOT ask for the band again, do not build the trigger to
§5.3's old numbers, and do not make the walk-around milestone wait on
it: the first hand-built map is a WALK-AROUND FIXTURE, and the
enemies + LOS + trigger milestone opens with that conversation when
the designer is ready. The stage loader refuses anything outside 3–12 × 5–10 (the
engine's caps); a world file is the same schema bigger, so that cap
moves from the loader to the DEAL, where §4.2 says every guarantee
lives. The §11 corners of the one rule (rotation free or a turn, the
king's individual move, the snap-zoom target pick) wait for the
walk-around build; the exploration zoom is a fixed k with ± buttons
stepping it as a cut, not pinch.
THE WORLD + THE ARMY RULE — most plumbing exists: stage schema 2 IS
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
- `play/js/dungeon.mjs` — THE DUNGEON GENERATOR (Phase 2 milestone 5,
  2026-09-08): a floor from a seed — the lints (the bed's envelope: no
  boring box, no long narrow way, reachable, duelable ground through the
  trigger function), the prefab-grid skeleton (the 36 arenas as pieces),
  the fix-ups, the start and the spawn digits; `STYLES` (one: the
  vaults). Node gate `test-dungeon.mjs`; `gen-worlds.mjs` writes the
  fixtures, `world-shots.mjs` the gallery. `play/README.md` § "The
  dungeon generator".
- `play/js/enemy.mjs` — THE ENEMIES (Phase 2 milestone 6, 2026-09-10): an
  enemy is the same army on the black side, spawned from the digits;
  sight BETWEEN ARMIES (any piece seeing any piece, since 2026-09-11 —
  king to king before); roam / sentry / hunt / search — THE WANDERERS
  (2026-09-11): a waypoint walk on the spawn's beat, seeded; the hunter's
  goals through the trigger function itself — THE FAR HALF of the four
  boxes since 2026-09-11; the enemy's turn on the walk's own planner; the
  trigger with its initiative; bystanders lifted and set back. Node gate
  `test-enemy.mjs`; `hunt-stress.mjs` the convergence instrument,
  `charge-stress.mjs` the encounter instrument, `sight-map.mjs` the
  sight map. main.mjs § THE WALK runs the loop, the chooser and the drop.
- `play/js/barrier.mjs` — THE BOX (Phase 2 milestone 5, 2026-09-08, on
  4c's barrier by hand): the arena is ALWAYS 10×10 on the player's king
  (his rank row 0, the axis arena-north), placed by THE WALK'S OWN RULE
  since THE DUEL START (2026-09-10 — `boxOf`, slid to hold every piece;
  `boxPlacement` keeps the lone king's centred box for the generator's
  lint), THE PIECES WHERE THEY STAND (`standingCells`), the enemy king on
  the far row on the king's file or the nearest that deals (the band; THE
  TRIGGER accepts it anywhere in THE FAR HALF, rows `FAR_HALF` 5…9, since
  2026-09-11 — the deal still molds it onto the far row),
  the gap an output measured BETWEEN THE CAMP LINES with a floor of 2,
  the enemy molded around the player's pieces on ground connected to its
  king, an axis other than the facing dealt after the pivot,
  `farRowTargets` the hunter's goals and the threat display; main.mjs
  § THE BARRIER BY HAND is the page (the drop, the world session, the
  walk-out with survivors in place, the run's ledger). Node gate
  `test-barrier.mjs`.
- `play/js/army.mjs` + `run.mjs` + `play/worlds/` — THE ARMY AND THE WALK
  (Phase 2 milestone 4b, 2026-09-08; REWRITTEN 2026-09-09 for the controls
  and camera session, brief §5.1's eighteen rulings): the movement model
  as a pure module — the pattern with its front-centre ANCHOR, the army's
  `at`, world-relative inputs, the facing following the step, the PIVOT on
  a turn, the walk with CATCH-UP (front rows first, the king last), the
  BOX invariant with its stuck / stray teleports, manual moves as chess
  moves only, the king's move the army follows, and since the second
  walk's verdict (2026-09-09) THE ROW KEPT BY THE WALK ITSELF — the king
  targets one connected set (`assignTargets`), a plan that holds across
  the passes, and since the third verdict THE CLUSTER INVARIANT — one
  body after every d-pad turn (`settleBody`, `retractSplit`, `isClustered`,
  the stuck teleport beside the body), and since the fourth verdict
  (2026-09-10) THE ROPE (`ropeSettle`: the army settled from the king
  outward with a follow step, a deferral and an extension pass; the body
  eight-adjacent, a target never molded across a corner, two ranks behind
  the king tolerated, a regroup that moves nobody yielding the step's walk
  with the anchor held), and since the fifth verdict (2026-09-10) NOBODY
  BEHIND THE KING, strictly (the king waits, steps aside as the last
  resort — `sidesteps` — before the rope's breaker teleports the comrade
  he waited for in vain; the queue swap; the anchor snapping to the floor
  beside a wall) (Node gate `test-army.mjs` 119;
  `phase0/harness/walk-stress.mjs` the cohesion instrument, `walk-replay.mjs` the position replayer); the run
  save (one object per run, `dck-run/4` since the wanderers, export / import as
  a file, no backward compatibility); the fixtures in `play/worlds/`
  (GENERATED floors since milestone 5). main.mjs § THE WALK is the page
  (`#screen-walk`: the north-up board, the tap-to-turn / hold-to-walk
  pad, key chords, drag, pinch, the wipe, the bump; `?world=` /
  `?run=resume` / `?save=`); `play/README.md` § "The canvas board",
  milestones 4b and 4d.
- `play/js/world.mjs` — THE WORLD (Phase 2 milestone 4a, 2026-09-08): the
  floor's data (any size, stage schema 2 with `@` the start and digits the
  enemy spawns; terrain / pieces / skins / the Director's layers; a save
  round trip) and THE CROP TRANSFORM (an origin cell + the army's facing:
  where an arena's squares, pixels and directions land in the world —
  debris.mjs re-exports it as the ledger's env transform; the Phase 1
  page's world IS the dealt arena, its crop the identity, no mirror
  exists). Node gate `phase0/harness/test-world.mjs`.
- `play/js/canvas-board.mjs` + `camera.mjs` + `atlas.mjs` +
  `pixelarrow.mjs` + `pixelfont.mjs` — THE BOARD (Phase 2, 2026-09-07;
  A WINDOW OVER THE WORLD since milestone 4a, 2026-09-08 — its one model
  is a World, setPosition writes the FEN into the crop's cells, the
  buffer is a window of the world's screen grid: viewport 'crop' the
  arena alone as always, 'screen' the screen's tiles centred on a focus
  with the world outside the crop dimmed, fit 'window' a fixed zoom;
  `play/README.md` § "The canvas board", milestone 4a):
  one 16×16 buffer scaled once, its art off `play/img/` (the atlas;
  `phase0/lib/inhouse.mjs` draws the classic row), painted through THE
  CAMERA (`camera.mjs`, 2026-09-08: the facing's pure geometry — squares,
  pixels, masks, debris and doors turned to the screen; Node-tested by
  `phase0/harness/test-camera.mjs`). `play/js/board-ui.mjs` is the pure
  terrain rule (`classifyTerrain`, `residueStep`, the hashes, the masks)
  + the promotion picker — the DOM board that file used to be is retired.
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
node harness/canvas-grid.mjs --browser all  # the canvas board's one blit lands 1:1 on the device-pixel grid at nine ratio × width cases, integer + fill, per snap strategy (./node_modules/.bin/playwright install firefox once)
node harness/test-camera.mjs         # THE CAMERA's geometry (play/js/camera.mjs) against brute force — squares, pixels, masks, tiles, doors, at every facing; Node only
node harness/test-world.mjs          # THE WORLD (play/js/world.mjs): the crop transform against brute force at every facing, the world's read / write paths, a world file, a save round trip; Node only
node harness/test-army.mjs           # THE ARMY RULE (play/js/army.mjs): brief §5.1's one movement rule on its own cases — unison, the about-face, the pillar, the stragglers, the chain, molding, never a capture, the individual move; Node only
node harness/walk-stress.mjs [--steps 3000] [--world vaults-4] [--hold 1] [--trace <turn>] [--splits 3] [--teleports 4] [--refused 3] [--lag 4] [--behind 3]  # THE WALK'S COHESION INSTRUMENT: random d-pad walks over the generated fixtures (--hold: a thumb on one arm) — the king's lag to his slot, his distance to the nearest comrade, the army's connectivity (the cluster invariant: split turns must stay near zero), teleports by reason, collisions, refusals split into the anchor's and the walk's, the worst turns as local maps (% / x an anchor / slot in stone), the turns with a piece BEHIND THE KING (must be none; --behind samples them); --refused prints a refused step's stage traces and a pieces: line that rebuilds the position, --lag the king's worst lags, --trace the turns before one (a refused step prints the targets it would have assigned)
node harness/walk-replay.mjs <world> <df,dr> [--hold N] [--trace] [pieces: K1@f,r R2@f,r … anchor f,r facing n]  # THE WALK'S REPLAYER: rebuild a position from a walk-stress pieces: line (or start at the fixture's start), replay one input printing every stage of planTurn's trace (targets, vias, stuck, queued), or hold it N turns printing the map, the plan and the pieces: line after each — read a screenshot's position into it before touching army.mjs
node harness/test-barrier.mjs        # THE BOX + THE DUEL START (play/js/barrier.mjs): the fixed 10×10 arena at every facing placed by the walk's own rule, the pieces where they stand, the far-row band, the gap between the camp lines with a floor of 2, the enemy molded around the player's pieces, off-map walls, an axis behind the army refused then dealt after the pivot, the walk-out's survivors and returns; Node only
node harness/test-enemy.mjs          # THE ENEMIES (play/js/enemy.mjs): the band, the spawns from the digits and the stamp that clears only its own cells, sight and the corner rule, sight between ARMIES (any piece seeing any piece), sentry / hunt / search, the hunter's goals and the trigger with its initiative, THE FAR HALF (a hunter seven off starts the duel at once, four off backs to five), the ambush through the pivot, search and the door, bystanders, the save; Node only
node harness/hunt-stress.mjs [--flee] [--turns 120] [--world vaults-2]  # THE HUNT'S CONVERGENCE: every spawn of every fixture hunts the kit at the start with sight granted (the player standing, or fleeing on a held cardinal walk) — turns to the trigger, parks, misses, the enemy work per turn
node harness/charge-stress.mjs [--policy charge|wait] [--kings] [--roam] [--turns 250] [--world vaults-2]  # THE CHARGE (2026-09-11): a crude thumb walks the kit AT every sentry (--roam: at every WANDERER on its beat) under the game's sight rule (--kings the old king-to-king one), the player walking on or pressing wait after first sight — first sight's turn and distance, whether and when the duel starts and whose initiative, THE RETREAT DANCE (turns the player stepped nearer and the enemy king stepped away; must stay near zero)
node harness/sight-map.mjs [--world vaults-4] [--enemy 3] [--radius 13]  # WHERE A SPAWN SEES YOU: an ASCII map around one enemy's spawn — k its king sees your king there, a some piece of its army sees some piece of the kit stood there, . nothing
node harness/test-dungeon.mjs        # THE DUNGEON GENERATOR (play/js/dungeon.mjs): the bed's envelope is the lint, a plain room fails, seeds replay, every floor passes, the lint's box is the game's; Node only

node harness/gen-worlds.mjs [--duel] # THE GENERATOR's fixtures in play/worlds/ (vaults-1…4, generated at fixed seeds, linted as written; --duel adds the duelable-ground coverage) + their manifest
node harness/world-shots.mjs         # each fixture painted whole by the canvas board + the walk screen on a phone and a desktop → phase0/results/world-shots/ (THE GALLERY, for the eye)
node harness/facing-walk.mjs --shots # every arena × facings 1–3 on the bare lab page: the camera's paint must equal the world itself rotated, painted north-up
node harness/camera-guard.mjs dump <dir> && node harness/camera-guard.mjs compare <dir> --allow door,turned  # the renderer's paint before/after a change: record the inputs + hashes on the build before (a pristine worktree), replay them on the build after
node harness/camera-shots.mjs        # the desktop layout at 1920×1080 / 1280×720, the phone at the four facings, a door crop — for the eye
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
