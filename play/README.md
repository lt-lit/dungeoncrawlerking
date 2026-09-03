# Phase 1 — duel vertical slice (the proving grounds)

Designer-locked stage terrain × generated armies → variant config + FEN →
playable duel vs the engine on a phone (brief §10). Setup screen (stage
picker + army generator), win/loss, promotion, live Earthquakes (the Board
State Director). No overworld. Vanilla JS ES modules, no build step,
GitHub Pages.

**The slice-refresh setup flow replaced the original arena menu + placement
screen** (retired with `arenas/*.json`, `js/arena.mjs`, and the enemy-edit
cheat): pick one of the 33 locked stages, then shape both armies LIVE — the
generator knobs (width 3–8, points budget or exact pieces, depth archetype,
anchor, initiative, flip, crop, one master seed + 🎲) sit under the board
preview, and every change re-deals the armies on the board in place (an
impossible combo shows the bare terrain and the reason, with Begin
blocked). One master seed derives the armies, their molding AND the
Director's quake stream — re-entering a seed reproduces the whole duel.
The player always holds White at the bottom; "Enemy moves first" is the
turn field, not a seat swap.

**This build replaces the §4.5 crumble system with the Board State Director
("THE GODS")** — the experimental arena-regeneration design from the 2026-08
prototype sweeps. Repetition is no longer punished at all (no repetition
crumble, no position tracking). Instead, past a rising hazard ramp the arena
quakes: pieces scoot to adjacent squares (displacement — symmetric-preferred,
one piece per side) and, increasingly late, squares collapse (crumbles).
Displacements un-stick terrain-locked positions; crumbles shrink the board so
duels provably end. Tune it in Options → **The Gods** (Calm / Restless /
Wrathful / Custom / Off); `window.__DCK.setFavor(m)` is the runtime tuning
hook for future in-game effects (Favor of the Gods).

## Running

Any static host works locally for a quick look, but the engine is a pthread
build (needs `SharedArrayBuffer`): serve with COOP/COEP headers, or over
https / `localhost` where `coi-serviceworker.min.js` (which must stay NEXT TO
`index.html` — service-worker scope) injects them after one self-reload.

- `index.html` — the game. Debug/E2E query params (see `js/main.mjs` header):
  `?stage=<id>&flip=1&ct=&cb=&turn=w|b&seed=<n>&w=<spec>&b=<spec>&autobegin=1&go=…&probe=…&theme=hall|castle|crypt|classic`
  (army spec strings are `width:spec:archetype:anchor`, spec = `b<points>`
  or piece letters — e.g. `w=6:b30`, `b=5:QRNN:scrambled`), plus Director
  overrides `&onset=&qramp=&cramp=&debt=&asymonset=&asymramp=&dirseed=`
  and `&fx=<scale>` (animation speed; **`fx=0` disables motion entirely —
  drivers want this**, since animations run inside `app.busy` and
  `waitIdle()` waits them out). `prefers-reduced-motion` does the same by
  default.
- `selftest.html` — in-browser infra cross-check (ffish ↔ engine perft parity,
  60-variant catalog, crumble filter, stalemate-as-loss protocol, and since
  2026-09-02 a detached-board renderer check). All lines must read PASS.
- Headless gates, from `phase0/` (`npm i --no-save playwright` once):
  `node harness/selftest-headless.mjs` runs the selftest in real Chromium;
  `node harness/ui-smoke.mjs --shots` plays a forced-hot duel on the LIVE
  board and asserts the tiles, the per-rung residue marks and arrows, the
  gods line, the log, the streaming hint probe, and the art themes (the
  stage's own on the live board and legend, the Art-set override, classic
  stripping back to the in-house SVG), with screenshots in
  `phase0/results/ui-smoke/` for the eye (`00-theme-*.png` is the same
  opening board in every theme). `window.__DCK.cheat`, `window.__DCK.marks`
  and `window.__DCK.theme` are the read-only surfaces it uses.

## Layout

- `js/fen.mjs`, `js/prng.mjs`, `js/crumbleFilter.mjs` — verbatim ports of the
  validated Phase 0 modules (import paths only). (`js/crumble.mjs` — the old
  repetition+pacing controller — is deleted; `phase0/harness/legacy/crumble.mjs`
  remains the historical record.)
- `js/director.mjs` — **the Board State Director (v3 — the ladder;
  brief §4.5).** Triggered by two meters — restlessness (`js/meter.mjs`,
  the record) × staleness (`js/staleness.mjs`, the position / fun score,
  which sets the fill rate) — never by ply (the old ramp survives only as
  the late backstop floor) and never while a king is in check. Each quake
  spends a DRAWN action budget across four rungs: weaken (`*`→`^`),
  breach (`^`→floor, king-filtered), displace (ONE piece, either side,
  best tier over both — A frees a terrain-locked pawn / B unsticks a
  piece / C cosmetic camouflage; v2's one-per-side pairing is repealed),
  and crumble (a permanent HOLE — `director.holes`, Director state, since
  FSF cannot tell a hole from an authored wall; at most one per quake,
  debt cap counts every rung). Exhaustive candidate enumeration
  throughout (neutral vs terminal crumbles — terminal fires only when the
  board has closed, termination `earthquake`); targets picked
  seeded-weighted by STRUCTURAL impact, never by eval. Kings are never
  displaced; pawns never land on rank 1/promotion rank; quakes never give
  check, never leave a side in check, never end the game except through
  the terminal-crumble path, and — **Phase 1.1** — never hand out
  material (see `js/threat.mjs`), a guard that now holds across the whole
  budget. **Phase 1.2:** instrumented from the inside — every `quake()`
  call records a roll trace (`lastTrace`), the enumerators return their
  rejections with reasons, and RNG-free getters
  (`pQuake`/`pressure`/`rungWeights`/`forecast`) + live dials (`tune()`)
  expose the math without touching the seeded stream (see the
  debug-overlay section below).
- `js/threat.mjs` — **landing safety.** Attack chains + a simplified static
  exchange evaluation over the FEN grid; pure, no ffish, no engine. Exists
  because every other displacement guard is a *king*-safety guard, so a
  "symmetric" quake could step a piece onto an already-attacked square and
  gift it (observed on arena03: enemy rook a7→b7 into a white rook on the
  open b-file, White to move). Two guards use it: each candidate's landing
  square must be materially safe, and every later action in a quake's budget
  must leave every square this quake already landed a piece on safe too —
  filtering actions independently is not enough, since only earlier → later
  is covered by enumeration order (v3 generalized this from v2's leg pair).
  Verified: 420 seeded quakes over 7 realistic positions, zero gifts;
  it rejects ~11% of grid-legal steps overall (0% from opening positions,
  25–35% once files open), and 411/420 quakes still paired symmetrically.
  Two of the old Phase 1.3 gaps are closed as of 2026-09-01: discovered
  attacks (`editExposes` — the promoted no-new-winning-capture rule prices
  what any line-editing action uncovers or severs, on breach, displacement
  and crumble) and crumble victims (quakes cannot swallow; occupied squares
  are not crumble candidates). Still open: rescues of already-hanging
  pieces, and pins counted as defenders.
- `js/variant.mjs` — Phase 0 port + the fixed 60-variant catalog (3–12 files ×
  5–10 ranks: `duel_3x5`…`duel_12x10`, loaded ONCE at boot — variant names
  are single-use) and a variants.ini key allowlist (unknown keys are
  silently ignored by both libraries). Promotion region = the ENTIRE far
  rank, per color, in every variant (designer rule — see the stage section).
  `dealVariant()` builds the PER-DEAL variant that carries the CAMP-LINE
  double-step (spike 14): its `doubleStepRegion` spans every rank from
  each home edge to that side's camp line (armygen `campLineRank` — the
  mode pawn rank, ties toward the enemy), its name encodes that config
  (`duel_<f>x<r>__w<line>__b<line>` — so re-registration is always an
  identical no-op, never a silent rules change), and deal variants
  register INCREMENTALLY alongside the catalog — ffish via
  `loadVariantConfig`, the engine via the cumulative `app.catalog`
  reload that every recycle path already performs.
- `js/stage.mjs` — stage schema v2: terrain-only ASCII maps ('.', '#',
  '^' furniture — §4.6) → `loadStageV2`, plus the two transforms every
  corpus and the setup screen use: `flipStageVertical` (the
  both-orientations testing convention) and `cropStage` (boundary
  redraw — the manual gap knob AND the king-anchored auto-crop's
  mechanism; the old fully-walled-extreme-rank guards are retired, see
  the crop rule below).
- `js/armygen.mjs` — the army generator + molding layout (unit bags W×2,
  W 3–8; molding v2.1 with the two designer invariants: royal rearmost,
  pawns in front PER FILE) and **`dealMatchup`, the single composed entry
  point** (terrain transforms + armies + molding + connectivity + ffish
  sanity checks + seeded retries) shared by the setup screen,
  `phase0/harness/verify-stages.mjs`, and the meter-lab corpus builder —
  never re-assemble the pipeline by hand (the crumbleFilter split is the
  cautionary tale).
- `stages/*.json` — the stage set, authored with §4.6 capturable walls
  from the start (wave 4, s01–s33: the furniture bed — locked, all 33
  accepted 2026-08-27, replacing the retired waves 1–3; wave 5,
  s34–s58: rooms & breaches — sectioned maps, crate clusters,
  furniture in wall structures, breakable double doors, and the s51+
  floorplans (multi-room maps: hallways, doors to and between rooms,
  per-room furniture patterns) — locked, all 25 accepted 2026-08-27);
  `stages/manifest.json` is the
  generated browser bundle (regenerate with
  `phase0/harness/gen-stage-manifest.mjs` after any stage edit —
  `verify-stages.mjs` fails on a stale bundle). Designer review gallery:
  `stages-gallery.html` (generated by `phase0/harness/gen-gallery.mjs`;
  both tools need the patched pair overlaid into phase0/node_modules —
  they fail with the recipe when it isn't).
- `js/engine.mjs` — browser engine/ffish access; `UciEngine` is the Phase 0
  class verbatim, incl. the search watchdog. Boot always sets
  `Use NNUE false` (defaults TRUE in this build) and `Threads 1`.
- `js/duel.mjs` — the live game loop, a structural port of
  `phase0/harness/game.mjs` (since frozen in `harness/legacy/`): ffish is the source of truth, game end is
  `numberLegalMoves() === 0` → side to move loses. The bare-army rule (a
  side stripped to a bare king loses — no lone-king chases) is IN-GRAMMAR
  (`extinctionPieceTypes=*`, `extinctionPieceCount=1`), so the engine plays
  for strips and hint arrows/eval bar are truthful about them; quakes never
  remove a piece — crumbles take bare floor only (designer-final
  2026-09-01). The game layer adjudicates
  only kingless states (surgery-only). Engine history resets via bare
  `position fen` after every quake, plus an engine-stall recovery
  ladder (recycle instance, retry at reduced depth).
- `js/board-ui.mjs`, `style.css` — board/promotion rendering, absolute
  `data-square` addressing, fits 3×5–12×10 boards on a 390×844 viewport.
  **Terrain tiles (2026-09-02 UI refresh)** — one CELL class per kind, so a
  tileset later replaces only what each class paints: `.wall` (authored
  stone — a cold purple-grey outlined block on the warm olive floor),
  `.hole` (a square the gods crumbled — the sunken pit, permanent),
  `.furniture` (a `^`, §4.6) and `.cracked` (a wall the gods weakened — the
  same stone block with a branching black crack across it, §4.5's
  telegraph on the board; NOT a crate). FSF reads walls and holes alike
  as `*`, so `setPosition(fen, { holes, godCrates, skins })` takes the
  Director's two ledgers plus the stage's skin map (main.mjs `paintBoard`;
  the setup preview passes skins only). The in-house tiles and furniture
  SPRITES are pixel-art SVG data URIs generated into `style.css` by
  `phase0/harness/gen-sprites.mjs` (crate, door, barrel, table, chair,
  shelf, chest, rubble, the stone block, the crack) — and since
  **2026-09-03 the board wears one of three ART THEMES** repacked from free
  16×16 packs (`tiles.css`, `img/tileset.png`, `CREDITS.md`; see "Art
  themes" below): a theme only overrides those same variables under
  `[data-theme=…]`, nothing else changes. Furniture deliberately
  renders like a PIECE — one neutral `.piece.neutral` element per cell,
  painting the sprite its `skin-<name>` class picks (the crate by default;
  on a cracked wall it carries the crack itself) — because it can be
  captured: the capture-dissolve animation, the breach burst and the
  ringed target mark then cover every flavor with zero extra code. Skins
  are cosmetics, never grid state; the crate/cracked split is Director
  state. Edge **coordinates** (`.coord`: files along the bottom row,
  ranks down the left column) make every square the log names findable.
  Marks compose on separate channels: terrain = `background`, residue and
  debug rings = `box-shadow`, last move = `filter`, selection/check =
  `outline`, targets = `::after`. Three more cell classes serve the themes:
  `wm-<mask>` on a wall (or cracked wall) is its AUTOTILE case — the mask
  of solid neighbours, N=1 E=2 S=4 W=8 plus the diagonals NE=16 SE=32 SW=64
  NW=128 (a diagonal counts only when both its orthogonals are solid —
  `canonicalMask`, the standard 47-case blob), where solid means stone that
  is not a hole, a cracked wall, or a DOOR (a door continues a wall line;
  crates and the rest do not) — painting the theme's case
  (`--tile-wall-<mask>`, else the plain wall); `weak` on a door skin
  sitting in a north–south wall line — there is no edge-on door (the
  designer cut the first attempt), so the cell paints the column's own
  autotile case like a cracked wall does and its sprite is THE crack: one
  overlay for every weakened wall, whoever weakened it (`--tile-crack`,
  gen-sprites.mjs — thin black branching lines on transparency, nothing
  else, so it reads on any wall colour) — functionally the same
  capturable `^`; and `f1`…`f6`, the square's stable floor-texture variant
  (a hash of the square, so a repaint never makes the floor crawl; f1 on
  ~70% of squares, the rest scattered — `FLOOR_VARIANTS`); and `.decor`,
  a cosmetic prop span under the piece (`decorFor`: a torch, banner or
  chain on an east–west wall face, a cobweb, bones, skull or candle on a
  floor square, scattered by a stable hash at low rates; the theme's
  `--decor-<name>` paints it, or nothing — cosmetics only, and a breached
  wall drops its torch with the repaint; props paint at NATIVE 16-px scale,
  pixel-aligned with the tiles, their placement baked into the sprite by
  the repack tool — wall props anchored to the face, litter to a corner).
  The same span carries the RESIDUE main.mjs keeps per duel (`opened` /
  `rubble` sets passed to `setPosition`): a floor square where a door was
  captured or burst open keeps the theme's OPEN DOORWAY (`decor-doorway`:
  pixel-poem's leaf swung open, Dungeon Gathering's bare arch, the crypt
  gate with its bars raised), and one where a wall or crate was broken
  keeps RUBBLE (`decor-rubble`, the theme's rubble sprite) — derived by
  diffing the terrain squares of consecutive paints, so an undo that brings
  the `^` back clears it, and a square that became a hole shows the hole. A
  captured door SWINGS (`scaleX` at the hinge) instead of dissolving. The
  crack overlay on a cracked wall or weak spot is CLIPPED to the wall's own
  pixels (`mask: var(--wall-tile)`), so a north–south column's crack never
  spills onto the floor margins. Every wall,
  furniture and cracked cell keeps its floor layers UNDER the tile, so a
  themed pillar's transparent sides and every sprite sit on the floor tile
  (the first cut painted the flat in-house colour behind sprites).
  `setTheme(name)` stamps `data-theme` on the board.
  **Piece sprites (2026-09-03):** every piece span carries
  `data-piece="<FEN letter>"` and `setPieces(name)` stamps `data-pieces`
  on the board (`PIECE_SETS`: `nulltale` / `nulltale-dread` — NullTale's
  *Chess*, CC BY 4.0, the classic blue-vs-red silhouettes and the
  white-vs-black "dread" set, the DEFAULT; `pixel-chess` / `pixel-chess-wood`
  — Dani Maccari's *Pixel Chess*, 16×16; `deja-view` — Deja View's *Chess
  Assets*, cream vs navy with its white outline recoloured dark by the
  repack tool; null = the Unicode glyphs). Under a set the glyph goes to
  size 0 and the span becomes an absolutely positioned box `--piece-w` ×
  `--piece-h` cells, bottom-anchored, painting the sprite bottom-centred
  with `contain`. Every set is FITTED: the box is scaled so the set's
  tallest piece stands 0.96 cell, so no piece rises into the square above
  (designer: tall pieces overlapping the piece north of them read badly
  clustered). The FLIP clone copies the piece's own box, not the cell's;
  the promotion picker takes the same set and shows sprite buttons.
  Each sprite is centred in its box and the box in the square, so a piece
  sits mid-square rather than on its bottom edge. Options → Look →
  **Pieces** (persisted, default NullTale classic) and `?pieces=` pick it,
  independently of the theme; **Doors** (`DOOR_SETS`: leaf / portcullis /
  gate, `data-doors` on the board, `?doors=`) picks a door set over any
  theme's own, with its open doorway.
  **Motion:** pieces travel between squares as FLIP clones on an
  `.fx-layer` overlay (`animateSlide`/`animateSlides`) instead of teleporting
  — used by both the engine's replies and quake displacements, with captures
  dissolving under the incoming piece. Quakes play as three beats (rumble →
  motion → settle), with terrain fx per RUNG (`animateTerrain`: a weaken
  cracks, a breach bursts, a crumble sinks — each held on its end frame
  until the commit), and leave the gods' **residue** in their own light-blue
  hue: `quake-from` hollow, `quake-to` filled plus a dashed **arrow** on the
  SVG layer for every displacement, `fresh-crack`, `fresh-breach`, and
  `fresh-pit` (rust). Residue persists through the enemy's reply, MERGES
  across quakes in one window, and clears when the player moves; the same
  actions are written to the **gods line** in the player's bar under the
  board ("⚡ the gods: wall cracks c4 · your knight e4→e5") and to the log.
  Colour roles: gold = the player's own marks, gold/silver/bronze = the
  oracle's ranked hints, light blue = the gods, rust = a fresh hole, red =
  check. Every CSS-timed motion is also gated by `data-fx="0"` on `<html>`
  (stamped for `?fx=0`), not only by the OS reduced-motion setting.
- `js/main.mjs` — boot, the setup screen (stage picker + generator panel),
  duel driving, win/loss.
- `vendor/` — fairy-stockfish-nnue.wasm 1.1.11 largeboard + ffish 0.7.9,
  the exact builds Phase 0 validated.

## Art themes (2026-09-03)

Designer decision after shopping free tilesets: use all three, make 16×16
the standard, mix and match, repack and credit. The board wears one of
three themes — **hall** (pixel-poem's *Dungeon Asset Puck*: purple-grey
flagstones, salmon stone, timber doors), **castle** (SnowHex's *Dungeon
Gathering*: cold blue-grey stone) and **crypt** (Szadi art's *Rogue Fantasy
Catacombs*: dark brown flagstones, low brick walls) — or **classic**, the
in-house drawn set. Which one: `?theme=<name>` (a feel-check override,
never saved) > the Options panel's **Art set** (persisted; "The stage's
own" by default) > the stage's `theme`. Every stage in the bed carries one,
assigned by `gen-skins.mjs` from the stage NAME's vocabulary (tombs, rubble
and warrens are crypt; gates, parapets and redoubts are castle; pantries,
banquets and doorways are hall), the rest balanced across the three so
neighbouring floors differ, plus a reviewed override table — 18 / 21 / 19
over the 58. Cosmetics only: a theme changes what the renderer paints,
never the grid, the deal or the gods.

The packs are NOT in the repo (their terms allow use in projects but not
redistribution of the packs; Catacombs is public domain). Only the tiles
the game uses are repacked by `phase0/harness/repack-tiles.mjs` from
`phase0/assets-src/<pack>/` (gitignored — download each pack from the
author's page named in `CREDITS.md` and drop the sheets there) into
`img/tileset.png` (one row per theme, one column per role — the
human-readable record of what was taken) + `img/tileset.json` (per-tile
provenance) + `tiles.css` (the runtime: each tile as a PNG data-URI custom
property under `[data-theme="…"]`, so any cell size stays pixel-exact —
a background-position sheet bleeds at fractional scales) + `CREDITS.md`.
Every theme's floor is the same six bevelled flagstones from the Catacombs
brown set (the designer's verdict: the only floor tiles that look good) —
crypt wears them as drawn, hall and castle wear them RECOLOURED into their
own pack's floor tone (each pixel keeps its shading relative to the
flagstones' base colour and takes the target hue, so bevels, cracks and
grain survive). Each theme has its OWN door: the hall keeps pixel-poem's
timber leaf; neither Dungeon Gathering nor Catacombs draws a wooden door,
so the castle's is a portcullis drawn into Dungeon Gathering's own arched
doorway tile and the crypt's a barred gate in its stone. The castle's
crate is Dungeon Gathering's stone block. Each theme also carries its
cosmetic PROPS (torch, candle, cobweb, bones, skull, chain, banner —
pixel-poem's and Catacombs' own torch, candle and chain; the rest
borrowed from pixel-poem). A theme also provides the wall in all
**47 autotile cases**, a weak-spot overlay, and the door, crate, chest,
barrel and rubble sprites. The repack tool also builds `img/pieces.png`
(32-px atlas cells, one row per set) and the `[data-pieces=…]` sprite
variables from the sheets in `assets-src/pixel-chess/`, `assets-src/
nulltale/` and `assets-src/deja-view/` — each set names the exact crop
per piece, pasted bottom-centred into the set's box.
The wall cases are GENERATED, not cropped: the packs draw walls as 2.5-D
room borders two tiles tall (a top surface over a brick face) and ship no
thin-wall set, and stitching their pieces into one-cell walls made fence
posts and mismatched junctions (rounds 4–5). So the tool draws every case
as a top BAND in the pack's own colours — an east–west run fills the top 9
rows edge to edge, a north–south run a 10-px column, junctions their
union, a thick block's inner corner only when the diagonal neighbour is
solid — bevelled where the surface does not continue into a neighbour,
outlined on the floor, and EXTRUDED: the pack's own brick face (7 rows
cropped from its wall tile) hangs under every south edge that ends inside
the cell, so runs read cap-and-face like the pack's, a column's south end
shows its face and a block faces south along its bottom.
Where a pack lacks a role the theme
borrows from another (every door is pixel-poem's leaf; castle's barrel is
Dungeon Gathering's vase) and where none has it (table, chair, shelf, the
hole, the crack) the in-house sprite paints, unchanged. `phase0/lib/png.mjs`
is the dependency-free codec the tool uses. The Options panel names the
three packs with links, and `CREDITS.md` carries the terms and a per-tile
provenance table.

## Stages (schema 2) + the army generator

A stage is GROUND — walls and dimensions drawn as ASCII, nothing else
(armies are never part of a stage):

```json
{ "schema": 2, "id": "s03-the-squeeze", "title": "The Squeeze",
  "notes": "why this terrain exists / what it tests",
  "map": ["#....", ".....", "..."] }
```

`.` floor · `#` stone wall (`*` accepted — the FEN glyph) · `^` furniture
(§4.6: the neutral capturable occupant — terrain to molding/crop/the gods,
an ordinary capture in play; `^`→`.` derives the stone-only corpus control
arm from the same file); rectangular, top rank first; 3–12 files × 5–10
ranks (the engine's largeboard caps). An optional **`skin`** grid, the same
shape as the map, says what each `^` LOOKS like — `D` door · `B` barrel ·
`T` table · `C` chair · `S` shelf · `X` chest · `K` crate · `R` rubble ·
`.` default (crate). Skins are cosmetics only (the same `^` to the engine,
molding, crop, the camp line and the gods); a letter on a non-`^` square is
a load error. They ride flip, crop and the auto-crop beside the map and
reach the renderer as `stageSkins()` (a square→skin map). An optional
**`theme`** (`hall` / `castle` / `crypt`, stage.mjs `THEMES`) names the
stage's art set ("Art themes" above) — cosmetic, validated on load,
carried through flip and crop. The bed's skins
are authored by `phase0/harness/gen-skins.mjs` — rule-based (a `^` embedded
in a wall line is a door; the notes pick the furniture family; 2×2 blocks
are stacked crates) plus a reviewed per-square override table — and kept
in the stage files so the diff stays the review surface; regenerate the
manifest after running it. The locked stages are a curated
sample of plausible dungeon slices — Phase 2's dungeon generator replaces
authoring wholesale, so there is no editor; the diff and the gallery are
the review surface.

**The deal pipeline** (armygen `dealMatchup`, one call): stage →
`flipStageVertical`? → `cropStage`? → per-side armies (`makeArmy`: width
3–8, explicit pieces or a seeded points-budget draw) → molding
(`layoutArmy` — dense center-out fill; royal rearmost, pawns in front per
file; terrain reshapes everything, furniture included) → gap check →
**king-anchored auto-crop** (rows behind either king are removed; below 5
ranks the attempt is rejected) → connectivity check on the cropped board
(furniture is PASSABLE — armies smash through; a furniture-only seal is
legal and warn-flagged by the verifier) → the deal's own variant (the
camp-line double-step, spike 14) → ffish sanity probes (no side starts in
check, not decided at ply 0) → seeded retries on rejection → start FEN +
`variantName`/`variantIni`. Everything derives from ONE master seed via
`childSeed` (armies, molding, and the Director's quake stream), so a
seed + knobs reproduces the entire duel.

**Double-step = the CAMP LINE (designer rule, 2026-08-21).** Every pawn
has the two-square push **at or behind its side's camp line** — the rank
holding the most of that side's dealt pawns, ties toward the enemy — and
never past it. Spike 13's every-visit caveat (repeated doubles from
anywhere) is repealed. The line sits where the position LOOKS like the
starting line: chess's row-based rule generalized — it equals
first-move-only until a quake moves a pawn backward or sideways, and
there the row wins, because a player can see a line, not a pawn's
history. Accepted consequences: a pawn molded AHEAD of the wall
(~10% of dealt pawns on this bed) reads and plays as already advanced —
no leap, ever; a moved pawn knocked back behind the line regains the
jump; rear pawns behind the line can single-step then double once lanes
open (tied stacks put the line at the front wall).

**Crop = redrawing the boundary, and KINGS ANCHOR THE ARENA (designer
ground rules, 2026-08-27).** To every piece a rank of solid wall and the
board simply ending are identical, so `cropStage` REMOVES far/near ranks
instead of walling them; the cropped board uses the smaller catalog
variant. On top of that, the deal itself enforces the king anchors: the
player's king always starts on the first row and the enemy king on the
last — after molding, `dealMatchup` AUTO-CROPS every row behind either
king (floor 5 ranks — gap 1, a duel can't start closer; below it the
attempt is rejected). Consequence, load-bearing: **the promotion zone is
ALWAYS the enemy king's starting row — the real far rank — and it always
holds a usable square, because the king is standing on it.** The old
corollary ("no stage or crop may produce a fully-walled extreme rank") is
RETIRED — the guarantee is true by construction, so
`loadStageV2`/`cropStage` no longer police extreme ranks and the verifier
instead flags stages whose fully-terrain edge rows leave fewer than 5
playable ranks (nothing could ever deal there). Manual cropping still
exists so every stage can test smaller gaps than its full height
supports — it rehearses how a dungeon encounter will draw arena
boundaries.

Balance philosophy (§13, §2.2): the engine is always full strength, so the
tuning knob is the material edge the generator hands the player (the setup
screen shows the live edge; §7's puzzle band is ~+4..+7, "two blunders
from losing"). Mirror matches are a lab-only bias canary, never a play
mode. The static verifier is `phase0/harness/verify-stages.mjs` (every
stage × both orientations × crops × sampled armies through `dealMatchup`,
exit-code semantics — run it after editing any stage); engine-vs-engine
verification is the meter-lab rerun on this same bed.

## Options / Cheater Mode

The gear menu has a Cheater Mode toggle with four sub-options, persisted in
localStorage: **Show best n moves** (a MultiPV probe of the current position
on the player's turn — arrows coloured by RANK, gold / silver / bronze, at
about half their old size, outlined, each carrying its eval written INTO
the arrow ("+0.8", "−M2"), whose width/opacity still scale lichess-style with
how close each move is to the best one; the ranked SANs plus the reached
depth go to the hint line in the player's bar under the board;
MultiPV is restored to 1 when the probe settles and pinned to 1 by the duel
before every reply, which stays full-strength), **Keep evaluating** (the
probe drops its time limit and thinks to the depth cap or until you move —
costs battery), **Allow undo** (snapshot-based rewind to the player's
previous turn, usable from the loss screen; the Director RNG stream is not
rewound), and **Show eval bar** (player-POV score from the engine's replies
and the cheat probes). The old "edit enemy pieces" testing tool retired
with the placement screen — the generator knobs + seeds cover its job.
Above the Gods section, **Look → Art set** picks the board's theme (the
stage's own / hall / castle / crypt / classic — "Art themes" above),
**Pieces** the sprite set (NullTale classic / dread, Pixel Chess stone /
wood, Deja View, classic glyphs), **Doors** the door set (the theme's own /
timber leaf / portcullis / barred gate), and the panel credits the packs.

Engine pacing (designer decision, 2026-08): the enemy thinks up to **10
seconds** per move (`depth 22 movetime 10000` — the depth cap is the WASM
stability rule, not a strength limit). Small boards still reply in
<200 ms because depth 22 arrives first; big boards get the full think.
Lab corpora set their own faster limits.

The hint probe (2026-09-02) thinks as long as the enemy does — the same
`depth 22 movetime 10000`, or the bare depth cap with Keep evaluating —
and STREAMS: every `info multipv` line repaints the arrows (engine.mjs
`go()` takes an `onLine` reader), so the first hints land at depth ~8
within a few hundred ms and sharpen while you think; the hint line shows
the depth reached (`1 Nf3 · 2 e4 · 3 d4 · d14…`). `?probe=<go args>`
overrides it (E2E runs pass a short one next to `?go=`). Cancel hardening:
your move sends `stop` and waits ≤300 ms; a probe that never answers marks
the instance suspect and it is recycled before the reply search (measured:
a second `go` sent into an un-stopped search receives the FIRST search's
bestmove, which would desync the duel).

## The Gods debug overlay (Phase 1.2)

The Director's tuning instrument (brief §10): built BEFORE Phase 1.3 changes
the rules it measures, so before/after comparisons run on one instrument.
Toggle: Options → The Gods → **Debug overlay**, or `?godsdebug=1` (E2E/dev;
holds for the session, and is only written to storage if some option is
changed afterwards). It is not gated on Cheater Mode — it is a debug tool,
not a cheat. The panel renders under the duel log; everything it shows
derives from `duel.record` plus the Director's pure getters.

**The invariant everything hangs on:** the Director's draws share one
seeded stream and the draw pattern is state-dependent (no draw before onset,
the debt cap skips the rung roll, the budget consumes a variable number of
draws and picks). So the overlay NEVER re-rolls to preview: probabilities
come from RNG-free getters (`pQuake`/`pressure`/`rungWeights`/`forecast` —
pure functions of the meters, config, debt and favor), and rolls are
recorded by instrumentation *inside* `quake()`. Tracing is unconditional. Two
separate guarantees back this: byte-identity of the draw sequence to the
pre-1.2 Director was verified at development time by a Node A/B harness
(12 seeds × 24 plies × 2 fixtures, old vs new, getters/census/forecast
hammered between rolls — identical, incl. 118 fall-throughs); and
`selftest.html` permanently asserts the live half — a seeded quake
sequence replays exactly whether or not the overlay is exercised between
rolls, and the getters consume zero RNG.

What the panel shows:

- **Per-ply roll trace** — one line per completed ply (quiet plies dim),
  from `record.quakeTraces`. Each trace carries every draw (value +
  threshold), the RNG-free probabilities, the census of what the
  enumerations produced, and an ordered reason-code path (v3 ladder):
  `pre-onset` · `held-in-check` · `quake-roll-failed` · `quake` ·
  `crumble-forced` · `weaken` · `breach` · `displace` · `no-displacement` ·
  `crumble-neutral` · `crumble-terminal` · `starved`, plus `budget`,
  `rungsSpent` (every action in order, `terminal` included) and
  `rungFallback` (a rolled rung with nothing to work on walked the ladder).
  `fellThrough` means the budget ran out of legal actions before it was
  spent. A `VETOED` marker means the duel layer's
  safety net overrode the Director (also logged to `record.anomalies`).
- **Next-roll readout + forecast** — the getters at ply+1, debt/cap, favor,
  plus median plies for next quake / first crumble / closure from
  `director.forecast()`. The forecast is the NOMINAL model (it prices the
  crumble roll, not the fall-through), deliberately: the gap between
  forecast and trace is the fall-through effect, measured.
- **Candidate census** (`census now`) — a full enumeration of the CURRENT
  position: displacement tiers A/B/C per side with veto reasons
  (`unsafe_landing` per side is the Phase 1.3 starvation-risk metric),
  neutral/terminal crumble candidates with veto reasons (`hangs_piece`,
  `exposes_king`, …), locked pawns. This is the one expensive act in the
  overlay — a quake-scale enumeration, 300–720 ms synchronous (rule 14) —
  so it only ever runs from the button (player's turn) or the `__DCK` hook,
  never per-ply. Quake traces get their census for free from the
  enumerations the quake itself ran.
- **Board heat** (`heat: on`) — the census painted on the board: landing
  squares by tier (A yellow / B blue / C dim), terminal crumbles red. The
  census describes one position, so heat switches itself off on any move or
  quake instead of silently re-enumerating.
- **Eval delta per quake** — the ground truth of "did the arena change who's
  winning": two short probes (`depth 12 movetime 300`, paired limits) of the
  quake's pre/post FENs, normalized to white POV, `flipped` when the sign
  changed (mate scores count as ±∞ — SEE is blind to mate-net changes, which
  the sweeps measured as the dominant flip mode). Probes run in the player's
  idle window on the shared engine, sequenced with the cheat probe, and
  carry their OWN staleness seq + visible failure + capped recycle
  (rule 12 — the duel's stall ladder never fires for probes). Results land
  on the `record.quakes` entry (`evalDelta`).
- **Live dials** — while the overlay is on, Gods settings changes
  (temperament preset / custom knobs) also retune the LIVE Director via
  `director.tune()`, and the favor slider drives `setFavor()` — both
  recorded on `record.tunes` with their ply, so an exported trace explains
  itself. Without the overlay they keep their shipped meaning (next duel).
  Config changes never touch the RNG stream, debt, or favor.
- **Export** (`copy trace`) — the full ledger as JSON to the clipboard:
  the deal provenance (stage id, flip, crop, army specs, master setup
  seed — everything a replay re-deals from), the Director seed,
  `config0` (the starting config a replay constructs with),
  the live config, tunes (undo drops a `{ply, undo: true}` marker on the
  ledger, since an undo forks the RNG stream and ends replayability),
  moves, quakes + deltas, every roll trace. `__DCK.gods.export()` returns
  the same object.

Console/E2E surface: `window.__DCK.gods` — `traces`, `quakes`, `tunes`,
`probs()`, `forecast()`, `census()`, `tune(partial)`, `export()`.
