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
  stripping back to the in-house drawings), with screenshots in
  `phase0/results/ui-smoke/` for the eye (`00-theme-*.png` is the same
  opening board in every theme). `window.__DCK.cheat`, `window.__DCK.marks`,
  `window.__DCK.theme` and `window.__DCK.renderer` are the read-only
  surfaces it uses; the board's own device-pixel gate is `node
  harness/canvas-grid.mjs` (the blit on the device-pixel grid, Chromium +
  Firefox; § "The canvas board" below). THE CAMERA's gates (2026-09-08,
  milestone 3): `node harness/test-camera.mjs` (the geometry, Node only),
  `node harness/test-world.mjs` (the world and the crop transform, Node only),
  `node harness/test-army.mjs` (the army rule on the brief's cases, Node only),
  `node harness/gen-worlds.mjs [--duel]` (THE GENERATOR's fixtures + their manifest — generated floors at fixed seeds, linted as written; § "The dungeon generator"),
  `node harness/test-dungeon.mjs` (the generator's gate: the bed's envelope is the lint, a plain room fails, seeds replay, every floor passes, the lint's box is the game's),
  `node harness/world-shots.mjs` (each fixture painted whole + the walk screen, for the eye — the generator's gallery),
  `node harness/test-barrier.mjs` (THE BOX + THE DUEL START: the fixed 10×10 arena placed by the walk's own rule, the pieces where they stand, the band, the gap between the camp lines, the enemy molded around the player's pieces, the walk-out's survivors),
  `node harness/test-enemy.mjs` (THE ENEMIES: the spawns, sight between armies, sentry / hunt / search, the hunter's goals over the far half, the trigger with its initiative, bystanders, the save),
  `node harness/hunt-stress.mjs [--flee]` (the hunt's convergence over the fixtures: turns to the trigger, parks, misses, the enemy work per turn),
  `node harness/charge-stress.mjs [--policy wait] [--kings] [--roam]` (a crude thumb walks the kit at every sentry, or at every wanderer with `--roam`: first sight, the duel's start and initiative, the retreat dance — `--kings` replays the old king-to-king sight),
  `node harness/sight-map.mjs --world vaults-4 --enemy 3` (an ASCII map of where a spawn sees you: its king your king, any piece any piece),
  `node harness/facing-walk.mjs [--shots]` (every arena × three facings:
  the turned camera equals the world itself rotated), `node
  harness/camera-guard.mjs dump|compare <dir> [--allow door,turned]`
  (the paint before and after a renderer change, from recorded inputs)
  and `node harness/camera-shots.mjs` (the desktop layout, the four
  phone facings and a door crop, for the eye).

## Layout

- **THE DOM BOARD IS RETIRED (2026-09-07).** The board is `js/canvas-board.mjs`
  (one 16×16 buffer, scaled once — § "The canvas board" below) drawing off
  `js/atlas.mjs` (`img/tileset.png` + `img/pieces.png` + `img/tileset.json`,
  the ONE art source) through `js/camera.mjs` (THE CAMERA, 2026-09-08: the
  facing's pure geometry — squares, pixels, masks, debris and doors turned
  to the screen; milestone 3 below); `js/board-ui.mjs` is the pure half that survived —
  `classifyTerrain`, `residueStep`, `decorFor`, the variant hashes, the
  masks, the set lists, `DEFAULT_PIECE_FIT` and the promotion picker.
  `tiles.css`, `piecetiers.mjs`, the FLIP slides, the arrow SVG, the
  per-cell debris `<img>`, the % piece dials, the piece-pixel modes and the
  classic glyph piece set are gone. The bullets below that speak of cells,
  `.piece` elements, CSS custom properties and `tiles.css` describe the
  retired board's IMPLEMENTATION and stand as the record of the decisions;
  the class names they use survive verbatim as the canvas board's
  `cellClasses()` test surface, and every look they settled is painted the
  same by the canvas board (the retirement was gated pixel for pixel).
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
- `stages/*.json` — the stage set: **wave 6, s59–s94 — the 2026-09-04
  arena refresh: 36 hand-authored 10×10 arenas, designer-approved in
  three previewed batches, now THE test bed** (see "Stages (schema 2)"
  below for what they are). Waves 4–5 (s01–s58, the 1.2.4 bed: the
  furniture bed and the rooms & breaches set, incl. the s51+ floorplans)
  are ARCHIVED in `stages-archive/` — not loaded, kept because the
  godlab and meter-lab corpora in `phase0/results/` were played on them;
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
  shelf, chest, the stone block, the crack, and the rubble heap the ruin
  tile falls back to) — and since
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
  debug rings = `box-shadow`, selection/check = `outline`, targets =
  `::after`; MOVES are arrows on the SVG layer — the enemy's last move in
  red (`kind: 'last'`, shown from the reply until the player answers;
  round 13 retired the last-move square tint), the gods' displacements in
  their blue, the oracle's hints by rank — all one geometry and outline,
  the colour alone says whose. Three more cell classes serve the themes:
  `wm-<mask>` on a wall (or cracked wall) is its AUTOTILE case — the mask
  of solid neighbours, N=1 E=2 S=4 W=8 plus the diagonals NE=16 SE=32 SW=64
  NW=128 (a diagonal counts only when both its orthogonals are solid —
  `canonicalMask`, the standard 47-case blob), where solid means stone that
  is not a hole, a cracked wall, a DOOR or authored MASONRY (those continue
  a wall line; crates and the rest do not) — painting the theme's case
  (`--tile-wall-<mask>`, else the plain wall); `weak` on an authored WEAK
  SPOT — the `masonry` skin (until the camera, 2026-09-08, a door skin
  sitting in a north–south wall line was one too, for want of an edge-on
  door — the designer cut the first attempt; since the camera every door
  is a door, edge-on when its line runs up the screen: § "The canvas
  board", milestone 3) — so the cell paints its own
  autotile case like a cracked wall does and its sprite is THE crack: one
  overlay for every weakened wall, whoever weakened it (`--tile-crack`,
  gen-sprites.mjs — thin black branching lines on transparency, nothing
  else, so it reads on any wall colour; since round 13 drawn ON the 16-px
  pixel grid, one black pixel per wall pixel, 8-connected — the first cut's
  half-pixel strokes rasterised finer than the wall; since round 14 FOUR
  drawings, `--tile-crack-1…4`, and every cell carries `ck1…ck4` by a
  stable hash of its square (`CRACK_VARIANTS`), style.css mapping it to
  `--tile-crack`, so neighbouring cracks differ and never swap on a
  repaint) — functionally the same
  capturable `^`; and `f1`…`f6`, the square's stable floor-texture variant
  (a hash of the square, so a repaint never makes the floor crawl; f1 on
  ~70% of squares, the rest scattered — `FLOOR_VARIANTS`); and `.decor`,
  a cosmetic prop span under the piece (`decorFor`: a torch, banner or
  chain on an east–west wall face, scattered by a stable hash at low
  rates; the theme's `--decor-<name>` paints it, or nothing — cosmetics
  only, and a breached wall drops its torch with the repaint; props paint
  at NATIVE 16-px scale, pixel-aligned with the tiles, their placement
  baked into the sprite by the repack tool, anchored to the face). The
  floor litter (cobweb, bones, skull, candle) is PACKED AWAY since round
  10 — the designer found it made the pieces harder to read; the sprites
  are still repacked, the renderer just never scatters them.
  The RESIDUE main.mjs keeps per duel (`opened` / `rubble` sets passed to
  `setPosition`, derived by diffing the terrain squares of consecutive
  paints — what stood there is read off the last paint's cell classes —
  so an undo that brings the `^` back clears it, and a square that became
  a hole shows the hole): a floor square where a door in an EAST–WEST line
  was captured or burst open keeps the theme's OPEN DOORWAY (`decor-doorway`
  on the same span, GENERATED per theme by the repack tool — round 11:
  "avoid having something arc over the space above the doorway" — a
  two-pixel POST in the door's material (pixel-poem's timber, the castle's
  pale stone, the crypt's iron) at each edge of the cell WHERE A WALL
  STILL STANDS — the cell wears the east/west standing mask as
  `wm-<mask>` and tiles.css picks the frame (wm-10), one post (wm-8 the
  west, wm-2 the east) or nothing (wm-0): round 12, "awkward looking
  vertical door frames between empty spaces" — a frame's post falls with
  the wall it framed — where the neighbour's wall runs flat into it, and
  the floor between, top to bottom — ten of the sixteen pixels, after
  "visibly very narrow" — so a piece standing in the doorway stands
  between the posts and nothing arcs over it; the doorway is the theme's,
  whatever door set is chosen); a
  floor square where a WALL, a cracked wall or authored
  masonry broke (and, until the camera, a weak-spot door — the crack in a
  north–south line — which never left a doorway: "cracked walls turning
  into open doors doesn't make any sense"; since 2026-09-08 every door
  leaves its doorway, a north–south one with its posts above and below)
  becomes a `.ruin` cell: it paints the theme's RUIN AUTOTILE — 16
  cases (`--tile-ruin-<mask>`, the cell's `wm-<mask>` is the plain 4-bit
  mask of its STANDING wall neighbours — a wall, a cracked wall or a
  door, never another ruin or an opened doorway: round 12, "broken wall
  segments next to each other form clumps of wall between squares" —
  each had drawn a stub at the other, and a stub grew against an open
  doorway's post) that the repack tool GENERATES like the
  walls, and since round 11 ("wall rubble reads too much like a barrier —
  needs to blend with the floor") the tile IS floor but for the broken END
  of each joining wall — the band enters one pixel flush from the
  neighbour, then a ragged hashed fringe of up to two more, with the brick
  face under it: a west or east end's columns hang the wall's seven rows
  under their own bottom (the flush column's face runs on into the
  neighbour's), a NORTH end's is the stump's own
  two rows (round 12: "these rubble wall edges cover a ton of the square
  when pointed south" — under the wall's full face the stub took 8–10 of
  the 16 rows, and a north–south case had drawn no face at all) — so the
  gap is 10–14 of the 16 across and 8–12 down — and a few flat flecks of
  the stone on the floor between (a lone break, or a break among breaks,
  is flecks alone); under whatever stands there; the in-house set falls
  back to its rubble sprite. Other furniture (a crate, a barrel, a table…)
  leaves nothing when it goes — it never continued a wall line. Both kinds
  of residue COUNT AS SOLID to the wall autotile, so the walls either side
  run on into the break instead of capping ("autotiling gives up when a
  door opens, leaving visible gaps"). A captured door SWINGS (`scaleX` at
  the hinge) instead of dissolving. The
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
  `--piece-h` cells painting the sprite with `contain`. Every set is
  FITTED: the repack tool trims each sprite to its opaque bounds and pastes
  it bottom-centred into a box exactly the set's tallest piece high, so a
  set stands on ONE baseline and the box scaled to 0.96 cell never rises
  into the square above (designer: tall pieces overlapping the piece north
  of them read badly clustered; round 10: a taller box centred in the
  square hung every foot below it — "chopped in half"). **PIECE PIXELS
  (2026-09-07)** — Options → Look → **Piece pixels** (`?piecepixels=`,
  `setPieceFit({ pixels })` → `data-piece-pixels` on the board,
  `PIECE_PIXELS`) picks how a sprite's pixels are sized, and the DEFAULT
  is the **tile grid**: every sprite pixel is one floor pixel, the same
  size and the same alignment as the 16×16 tile under it (designer: "the
  pixels making up the pieces [must] exactly match the size and alignment
  of the pixels making up the 16x16 tiles"; the old "Pixel-perfect"
  checkbox had snapped the box to whole SCREEN pixels instead — a
  different size from a tile pixel, on an unrelated grid). Measured in
  Playwright's Chromium AND Firefox (`phase0/harness/piece-grid.mjs`, the
  gate): the only construction that lands on the floor's device-pixel
  grid in both browsers, at fractional cell sizes, is a 16×16 image
  painted exactly as the floor is — a CELL-SIZED box with `center / 100%
  100%`; a box of any other size (the 23-row sprite at 23/16 of a cell, a
  two-cell box, a 200% background on the cell) drifts by a device pixel
  on some rows in one browser or the other, and a background offset by
  whole tile pixels drifts too — so a tile-grid piece is THREE such
  boxes, one per square it can cover: its own square (`--piece-lo`), the
  square north (`--piece-mid`, a `::before`; being later in the DOM than
  that square, a nearer piece's head paints over the piece behind it, as
  before) and the one above that (`--piece-hi`, a `::after`, for a lifted
  piece) — and those two boxes are the north squares' MEASURED rectangles
  (`layoutPieceRows` sets `--tier-mid-top/-h` / `--tier-hi-top/-h` on
  every cell from `getBoundingClientRect`, re-measured on resize;
  `piecetiers.mjs tierRowVars`): `top: -100%` of this cell is NOT the row
  above once a grid hands its sub-pixel remainder to some rows (Chromium
  at one width laid 35.6875-px rows over 35.70313-px ones, and the 1/32 px
  flipped a device row in the gate); the percentages survive only as the
  fallback above the top rank, where there is no floor to align with.
  THE TIERS ARE THE POSITION: `play/js/piecetiers.mjs` (pure,
  browser-safe) cuts a set's fitted sprite into the three 16×16 tiles with
  its placement baked in — **Piece lift** / **Piece shift** in WHOLE TILE
  PIXELS (Options, shown on the tile grid only; `?tilelift=` /
  `?tileshift=`; `TILE_LIFT_RANGE` −4…+20, `TILE_SHIFT_RANGE` ±7; the
  defaults `DEFAULT_PIECE_FIT.tileLift` 5 / `tileShift` 1 — the designer's settled numbers, after "the
  foot of the piece should be roughly centered on the tile"). tiles.css
  carries every set's lift-0 tiers (`--piece-<fen>-lo` / `-mid`, cut by
  `phase0/lib/piecehalves.mjs` through the same function — the repack
  tool emits them, and `phase0/harness/gen-piece-halves.mjs` writes the
  same lines from the committed atlas when the packs are not on disk,
  `--check` = are they stale); any other placement is BAKED AT RUNTIME by
  `board-ui.layoutPieceTiers` — the set's sprites read off the board's
  computed `--piece-<fen>` and decoded once, off the DOM, exactly as the
  debris sampler does (a canvas never touches the board), re-cut per
  (set, lift, shift) and cached, encoded by `pngmini.mjs`, and set inline
  on the board as `--piece-<fen>-lo/-mid/-hi` over the stylesheet's; a
  slider drag re-encodes twelve tiny PNGs per step, `boardUI.pieceBaked`
  resolves when the board wears it, `--piece-tile-lift` feeds the
  headroom. A wider box keeps the tile's 16 centre columns (deja-view's
  knights lose one outline column); what a lift or shift pushes out of
  the three tiles is cut. The size dial does not apply (the art's own
  scale; NullTale 16×23 is one square wide, its head 7 + lift px into the
  square above; the shadow is one tile pixel, `100cqh/16`, pinned in px on
  the FLIP clone whose layer is no size container). The other two modes
  keep the % dials: **screen pixels** (`display`, round 11's "pixel-perfect";
  `layoutPieceSnap`, re-run by a ResizeObserver, measures a cell, reads
  the set's native box from tiles.css (`--piece-fit` / `--piece-box`),
  takes the largest whole device-pixel scale k that fits the size dial
  and lands the box on whole device pixels — no sprite pixel wider than
  its neighbour, at the cost of stepping between sizes as the board
  resizes; `data-piece-snap`) and **free**. In those, dials place the box
  (**Piece size** / **lift** / **shift**; `?piecescale=` / `?piecelift=` /
  `?pieceshift=`; `--piece-scale` / `--piece-lift` / `--piece-shift`; wide
  ranges — size 50–200%, lift −50…+100%, shift ±50% — because the
  designer's numbers hit the first caps): the box is scaled, centred in
  the square, raised by the lift and moved by the shift; the defaults are
  the designer's settled phone numbers, `DEFAULT_PIECE_FIT` = 146% / +22%
  / +4% (board-ui, mirrored as style.css's fallbacks): a piece stands on
  its square's bottom edge and rises well into the one above — which is
  earlier in the DOM, so the nearer (lower) piece paints in front, as it
  should. (`?piecesnap=1` / `=0` are the old spellings of display / free;
  a saved `pieceSnap` is no longer read — every player lands on the tile
  grid.) The board is OPEN at the top
  (round 13: `overflow: visible` with a `clip-path` that still clips the
  sides and bottom), so a tall piece on the top row rises past the border
  instead of losing its head, and under a sprite set the board steps down
  by that overhang (`.board[data-pieces] { margin-top }` — from the dials,
  or (fit − 16)/16 of a cell on the tile grid) so the heads never sit on
  the bar above. ui-smoke asserts the display box is a whole multiple of
  the set's height, the tile-grid king's box is its cell, painted like
  the floor, with its head one cell up, and the default lift baked into
  36 inline tiers (lift 0 wears the stylesheet's); `piece-grid.mjs`
  measures the lift-0, default, hi-tier and clamp-edge placements exact
  on the floor's grid in both browsers. The FLIP clone copies the piece's
  own box, not the cell's (on the tile grid, the cell — the head rides
  along as its `::before` / `::after`); the promotion picker takes the
  same set and shows sprite buttons. Options → Look → **Pieces**
  (persisted, default NullTale classic) and `?pieces=` pick it,
  independently of the theme; **Doors** (`DOOR_SETS`: leaf / portcullis /
  gate, `data-doors` on the board, `?doors=`) picks a door set over any
  theme's own (the open doorway stays the theme's — it is drawn in the
  theme's wall).
  **Motion:** pieces travel between squares as FLIP clones on an
  `.fx-layer` overlay (`animateSlide`/`animateSlides`) instead of teleporting
  — used by both the engine's replies and quake displacements, with captures
  dissolving under the incoming piece. Quakes play as three beats (rumble →
  motion → settle), with terrain fx per RUNG (`animateTerrain`: a weaken
  cracks, a breach bursts, a crumble sinks — each held on its end frame
  until the commit), and leave the gods' **residue** in their own light-blue
  hue: a solid **arrow** on the SVG layer for every displacement and
  nothing on its squares (round 13: "the blue arrow is enough" — the
  `quake-from`/`quake-to` marks and the dash are gone), and ONE 3-px
  light-blue frame on a square the gods cracked, breached or collapsed
  (`fresh-crack` / `fresh-breach` / `fresh-pit` stay distinct classes
  but paint alike — round 14: "just a blue frame around the square is
  enough; all god actions in light blue", so the breach's fill and the
  hole's rust rim are gone). Residue persists through the enemy's reply, MERGES
  across quakes in one window, and clears when the player moves; the same
  actions are written to the **gods line** in the player's bar under the
  board ("⚡ the gods: wall cracks c4 · your knight e4→e5") and to the log.
  Colour roles: gold = the player's own marks, gold/silver/bronze = the
  oracle's ranked hints, light blue = the gods (every mark and arrow of
  theirs), red = check and the enemy's last-move arrow. Every CSS-timed motion is also gated by `data-fx="0"` on `<html>`
  (stamped for `?fx=0`), not only by the OS reduced-motion setting.
- `js/main.mjs` — boot, the setup screen (stage picker + generator panel),
  duel driving, win/loss.
- `vendor/` — fairy-stockfish-nnue.wasm 1.1.11 largeboard + ffish 0.7.9,
  the exact builds Phase 0 validated.

## The canvas board — Phase 2 milestone 1 (2026-09-07), the one board since milestone 2

The designer committed to 16×16 for everything and Phase 2 opens with the
rendering pipeline that makes it true (brief §2 item 5, §10). The DOM
board under "Art themes" was a CSS grid of fractional cells where every
layer is a separate image the browser resamples on its own — which is why
the tile-grid pieces needed cell-sized boxes, measured row rectangles,
positions baked into tiles and a two-browser gate to line up with the
floor, why the debris image sat a sub-device-pixel off it, and why a
slide shimmered off-grid. **The replacement was built behind a switch
(milestone 1), the phone judged it fine on desktop and mobile, integer
scaling included, and the DOM board was RETIRED the same day (milestone
2, below).** `js/canvas-board.mjs` (`CanvasBoard` — main.mjs and the
replay page drive it), `js/atlas.mjs` (the art, straight off
`img/tileset.png` + `img/pieces.png` + `img/tileset.json` — no data URIs,
no CSS; the in-house drawings, the cracks and the classic set, are the
atlas's `classic` row, drawn by `phase0/lib/inhouse.mjs`) and
`js/pixelfont.mjs` (a 3×5 font for the edge coordinates). Options → Look
→ **Scaling** (`integer` / `fill`; `?scaling=`); the change remounts the
board live on the same position. A diagnostics line underWhile the canvas board is on, a diagnostics line under
the board says what the screen got — `canvas · dpr 2.625 · 1012×1032
device px · k 6 (integer) · 96 px/tile · 36.6 css px` — and
`__DCK.renderer` exposes it (`kind`, `info`, `diag`, `square(sq)`,
`buffer()`, `decor(sq)`, `testPattern(on)`, `snapMode(m)`, `paintNow()`,
`ready()`, `set(renderer, scaling)`).

**The shape.** One native buffer at 16 px per tile — files×16 wide,
ranks×16 tall plus HEADROOM for the top rank's tall pieces (fit − 16 +
lift, so a head never leaves the buffer) — repainted from scratch on
every change in painter's order: floor (+ the dark square's shade), flat
terrain by `classifyTerrain` (the one terrain rule, shared with the DOM
board and the replay analyzer: the pits — since the TALL WALLS of
2026-09-12, round 21 below, a wall case, a cracked wall with the crack
masked onto its face by `source-atop`, a weak spot and a ruin's stub are
16×24 sprites of the TALL pass, standing at the square's y − 11), the
square's DEBRIS (the painter's 16×16 buffer put straight in), decor and
the open doorway above it (the DOM's decor span is above its debris
image, so the posts stand on the rubble), the marks under the pieces
(the gods' one-pixel frames, the debug heat), then row by row from the
far rank to the near one the TALL things — furniture props (16×32) and
pieces (the set's sprite at its native size, lifted and shifted by whole
tile pixels, one tile pixel of shadow — a cached silhouette) — so a
nearer head paints over the piece behind it, then selection / check /
target over the pieces, the coordinates, the debris FLIGHT's pixels
(`particles.mjs` hands a frame to `drawFlight` on this board and draws
SVG paths on the other — the flight model is unchanged) and a piece in
mid-slide among the tall things by where its feet are that frame (it painted last, over everything, until 2026-09-10 — a sliding king's head went under the piece north of him). Nothing in it has a fractional coordinate. **One blit**
(`drawImage`, smoothing off) puts it on the screen canvas at scale k =
⌊device width ÷ (16 × files)⌋, the board centred in whole device pixels
(`integer`) or at the exact quotient (`fill`: uneven pixel widths, every
layer still aligned because they share the one resample). **The arrows
are pixel art in the buffer** (`js/pixelarrow.mjs`: a shaft and head with
a one-pixel black halo, the colour by kind and rank as before, the alpha
through a scratch canvas so the halo never shows through. THE STYLE IS
THE PLAYER'S — Options → Look → **Arrow width** (the shaft in floor
pixels, 1–5, default 2; the head grows with it, width + 3 long and width
+ 1 to each side; an odd width runs through a pixel centre and an even one
along a boundary, so a straight shaft is exactly that many rows) and
**Arrow opacity** (0.2–1, default 0.85, scaled by the arrow's strength:
60% of it at none), `?arrowwidth=` / `?arrowalpha=`, `setArrowStyle` on
both boards (the DOM board draws the same shape in viewBox units),
`__DCK.arrowStyle` / `setArrowStyle(w, a)` — designer 2026-09-07: "make
the arrows thinner. A thickness and opacity dial wouldn't hurt". THE
HINTS CARRY NO NUMBER: the first pixel arrows set each hint's eval on a
plate beside the shaft ("way too big"), a second cut put the digits inside
the shaft as a staircase of 3×5 glyphs stepping along the arrow, and the
designer cut the numbers off the board altogether ("I don't think the
numbers are worth keeping. Let's list them somewhere else") — the HINT
LIST in the player's bar has them: one entry per rank, a swatch in the
rank's arrow colour, the move and its eval in bold, then the depth
(`1 Nf3 +0.8 · 2 e4 +0.6 · 3 d4 +0.5 · d14`). A LABEL is still drawn when
a caller asks for one — the replay page numbers its PV arrows — as that
staircase inside a 5-px shaft, compacted to a tile: "12", "5.1", "-1.2",
"M3") —
the first build kept the DOM board's SVG overlay above the canvas, and
the designer's first session on it saw "a big white rectangle flash"
that pointed at the overlay, so nothing overlays the canvas at all now
(the DOM board keeps `renderArrows`). The container keeps `data-theme` /
`data-pieces` / `data-doors` (the legend and the debris sampler read the
cascade off it).
A slide moves its sprite in whole native pixels per frame; a terrain
rung's fx (crack with jitter and a flash, burst, sink to the lone pit) is
drawn in the buffer and its END FRAME held until setPosition commits; the
quake's rumble jitters the blit by whole native pixels (`rumble(ms)`,
which main.mjs calls beside the class the canvas's CSS ignores); a
captured door swings. One requestAnimationFrame loop while anything
moves, nothing otherwise. Hit-testing is division: pointer → device px →
tile. Not here on purpose (milestone 1): the classic GLYPH pieces (a set
is always drawn — glyphs are text, not pixel art; the default set stands
in), the % piece-fit dials (the tile grid is the only mode: the art's own
scale, lift and shift in whole tile pixels), the overworld camera.

**Landing on the device grid — what measured.** The screen canvas must
be sized EXPLICITLY in whole device pixels (`ResizeObserver` on the
container's `device-pixel-content-box` → the canvas's CSS width = its
backing width ÷ ratio): a `width: 100%` canvas is a fractional number of
device pixels whenever the container's is, and a bitmap drawn into a box
a fraction wider than itself is resampled — a column drifts in part way
across, in both browsers. Under an EMULATED ratio (a headless driver's
`deviceScaleFactor`) Chromium reports that box in CSS px, a whole factor
off; the board falls back to css × ratio when the two disagree by more
than a pixel (`renderInfo.emulated`). The element's POSITION is fractional
in device pixels too whenever the page above it is; `setSnapMode` carries
three strategies — `none` (the browser's own placement), `margin` (a
layout offset onto the grid, quantised to a layout unit) and `transform`
(a float translate) — and `phase0/harness/canvas-grid.mjs` measures them
per browser. **The verdict (2026-09-07): `none` is the default.** In
Firefox — whose emulated ratio is the real preference — the blit landed
1:1 in 18 of 18 cases (ratios 1, 1.25, 2, 2.625 and 3 at nine widths,
integer and fill, `none` and `margin` alike); in Chromium at ratio 1 all
four cases were exact with either, and `transform` failed everywhere (a
float translate defeats the browser's own snapping). Chromium at any
other ratio cannot be measured under Playwright: its emulation is a
compositor-level scale over a layout that still believes ratio 1, so a
canvas bitmap is resampled twice and blocks drift a device pixel part way
across even with the element on a whole device pixel and its box exactly
its backing size — the emulator, not the browser; the gate runs Chromium
at ratio 1 only and says so. The real phone's screenshot is the final
word for that path.

**Gates.** `phase0/harness/canvas-grid.mjs` is the device-pixel gate (the
test pattern, nine ratio × width cases, integer and fill, Chromium +
Firefox). `ui-smoke.mjs` runs the live smoke on this board (every check
reads the board through `__DCK.marks.cell`, `__DCK.renderer.decor` and
the buffer's pixels; the board's geometry, the diagnostics line, the live
Scaling remount, the atlas legend and the cracked wall's ink are checked
directly), and the selftest asserts on detached boards (a stub atlas,
nothing drawn) that the board classifies, decorates and marks every square
as `classifyTerrain` says, orders its arrows quake < last < hints 3→2→1,
clamps its placement dials and flips its geometry; the pixel arrows'
compact labels, staircase steps and ink land as the shape says and a
straight shaft is exactly the dial's width in rows (1–5). (The parity gate
against the DOM board and the piece-grid gate retired with that board.)
`flicker-scan.mjs` records
the board: in Playwright's Firefox at the
phone viewport, a 48-s canvas duel (25 quakes and captures) scanned at
3.3 piece-scale and 18.4 debris-scale blinks per 10 s against the DOM
board's 8.5 and 48.2 on a duel of its own (motion on — slides, bursts
and flights are transient by design; the games differ, the moves are
random), the s59 door and torch vanishing 0 times on the canvas (0 and
1 on the DOM), and a 25-s idle turn with the hint probe streaming showed
no blink beyond the arrows' repaints. **The designer's verdict (2026-09-07,
Zenfone 10 + Firefox/Windows): "works fine on both desktop and mobile",
k 3 on the desktop and k 6 on the phone, and the fill scaling "doesn't
look bad either"; one "big white rectangle flash", suspected of the SVG
arrow overlay — hence the pixel arrows above.** **The second verdict
(2026-09-07, the next session): "looks fine with canvas rendering on both
desktop and mobile, including integer scaling" — THE DOM BOARD GOES.**

**Milestone 2 — THE RETIREMENT (2026-09-07, the same session).** One PR
of deletion plus one move, gated pixel for pixel: a guard script dumped
the debris sampler's decoded sprites and the buffer's every square on six
cases (the three themes, classic, a door set, another piece set; the
start position and fourteen hot plies) before and after — every pack
theme identical to the byte, zero page errors. What moved: the in-house
drawings (the classic set + the four cracks) into the atlas as its
`classic` row (`phase0/lib/inhouse.mjs` paints the same rects
gen-sprites.mjs drew; exact against the browser's 16×16 decode of the
SVGs), the repack tool reading back a missing pack from the committed
atlas, the debris SAMPLER reading the atlas (`atlas.tileOf`, the board's
own resolver, under the theme and door set the board wears; the ledger's
sprite names are the old custom-property spellings, kept as keys), the
options LEGEND as five 16×16 canvases painted off the atlas (main.mjs
`paintLegend`), the promotion picker drawing the set's sprites, the
residue ledger on `residueStep` (the replay page's rule, on the last
paint's own ledgers) and the replay page mounting the canvas board. What
went: `BoardUI` and `renderArrows`, `tiles.css` (160 KB), the tile rules
and the `@sprites` block in `style.css`, `piecetiers.mjs` and the tier
CSS, `gen-sprites.mjs`, `gen-piece-halves.mjs`, `lib/piecehalves.mjs`,
`canvas-parity.mjs`, `piece-grid.mjs`, the flight's SVG sink, the
Renderer option, the Piece-pixels modes and the three % dials, and the
classic GLYPH piece set (text, not pixel art — an unknown set draws the
default). One fix fell out: the canvas board had drawn the classic set's
SVGs at their 150-px decode size (a viewBox-only SVG's intrinsic size),
so a classic wall block spilled over nine squares; the atlas row is 16×16
and the classic theme paints right. The `.board` container keeps its
width formula and `data-theme` / `-pieces` / `-doors` (the atlas resolves
the look from them); `renderer.set` takes the scaling alone (the old
two-argument spelling still reads). Options saved by the DOM board
(`renderer`, `piecePixels`, the % dials, `pieces: 'classic'`) are simply
not read.

**Milestone 3 — THE CAMERA (2026-09-08).** Brief §5.1: the camera turns
with the army — screen-up is the army's facing — and CLAUDE.md § Phase 2:
the board is painted through a camera. `js/camera.mjs` is the geometry,
all data and Node-testable (`phase0/harness/test-camera.mjs`, 80 checks
against brute force): FACING is which world direction points up the
screen — 0 north (the duel's view since Phase 1), 1 east, 2 south (the
old `flipped`, which the constructor still reads), 3 west; turning the
army right is facing + 1 and the map turns counter-clockwise on the
screen. `toScreen` / `toWorld` map a square to its screen column and
row and back (a quarter turn swaps the grid's axes), `pxToScreen` does
the same for an arena PIXEL (the debris flight, the fx — a chunk lands
in the turned square exactly where it lands in the unturned one),
`rotMask8` / `rotMask4` permute the wall and the 4-bit ruin / pit /
doorway masks to the screen (each nibble rotates one bit; `canonicalMask`
commutes with it), `rotTile` turns a 16×16 debris buffer by index
permutation, `doorHalf` deals a double door's halves on the screen and
`edgeOn` says whether a door stands edge-on. The board (`CanvasBoard`
options `facing`, `fit`, `hashCoords`, `showCoords`; `setFacing(n)` — a
CUT: the buffer swaps its axes, the debris canvases are re-put, k
refits; `setFit`; `squareAtPoint` / `pointOfSquare`, the hit-test and
its inverse; `doorHalfOf` / `edgeOnAt`; `renderInfo.facing / fit /
screenCols / screenRows`) routes every square, pixel, mark and arrow
through the one origin function; `classifyTerrain`'s masks stay in
WORLD space (the shared test surface — `wm-<mask>` never turns) and are
permuted at the tile lookup, so wall faces, ruin stubs, pit rims,
doorway posts and the props hanging on a wall's face all follow the
turn; pieces and props never turn; the floor's variant, the crack
drawing, the skin variant, the prop scatter and the checker key on
`hashCoords` — the ENVIRONMENT's cell (main.mjs `hashCoordsLive` reads
the debris ledger's transform at paint time; the replay page builds the
same from the log's flip, crop and recovered auto-crop) — so a crop, a
flip or a turn never reshuffles the floor; the edge coordinates label
what varies along each edge (rank numbers along the bottom east / west
up). EVERY DOOR IS A DOOR: `classifyTerrain` records a door's wall LINE
(`doorLine` 'ns' / 'ew', world space) and always its wall case, `weak`
is masonry alone, doubles pair along a rank (west 'l' / east 'r') and
then along a file (south 's' / north 'n'), `residueStep` gives every
door its doorway and the doorway's mask has four bits; on the screen a
door whose line runs up it paints the EDGE-ON PLACEHOLDER (brief §11 —
the wall's case with a gap holding the leaf as a thin four-column slab
in the leaf's own two tones, plank seams, a two-row post above and
below in the doorway's post tones; composited once per theme / door set
/ case, the classic row from its own leaf; a breach bursts the slab; the
class is `door-edge`), a double edge-on is two of them, and an opened
north–south doorway is the doorway tile TURNED a quarter (posts above
and below; mixed cases overlay both) `[2026-09-11: the placeholder and
the quarter turn are GONE — the drawn edge-on door, § "Art themes",
round 20: the door set's leaf is the designer's own 5×16 profile door,
standing in the wall band; the north–south doorway has its own post
tiles; the class is still `door-edge`]`. THE CAMERA OWNS THE SCREEN on a
wide screen: main.mjs stamps `body.layout-wide` at ONE breakpoint
(`WIDE_LAYOUT`, 900 px; `?layout=wide|stack` pins it) and style.css
turns the duel screen into two columns — the board an explicit box
(`fit: 'box'`: the canvas IS the container's device box, k the largest
integer step that fits the board AND its headroom row on both axes, the
board centred in whole device pixels on both; fill = the exact quotient
of the tighter axis; a box without a height falls back to the width fit)
sticky under the topbar, the bars, the eval bar, the hint list, the
setup panel, the log and the debug panel in the column beside it. A
1080p desktop goes from k 3 (the 560-px page cap) to k 5, height-bound;
a 1280×720 window gets k 3; a phone keeps the stacked layout and the
width fit the verdicts were given on. The diagnostics line adds the
facing and the fit. The turn buttons wait for the army: Options → Look →
"Turn the view" (↺ ↻, not saved), `?facing=0..3|n|e|s|w`,
`__DCK.renderer.facing(n)` / `.layout` / `.squareAtPoint` /
`.pointOfSquare`. NOT in this milestone, on purpose: the world beyond one
arena — the buffer as a viewport over a world grid, the dimmed dungeon
around a duel — which is the first step of the world milestone, since
there is no world to paint yet; per-theme edge-on door ART (the
placeholder stands until the designer wants better — ✅ drawn 2026-09-11,
§ "Art themes", round 20).
**Gates.** `phase0/harness/camera-guard.mjs` — the retirement's method:
`dump` records, on a build, six cases (the three themes, the classic set,
a door set, another piece set) at the start and fourteen hot plies —
every INPUT the board paints from and a hash of every square on the live
board and on a mirror board turned 180°; `compare` mounts detached
boards from those inputs on the current build and diffs square by
square (`--allow door,turned`: the door squares and, away from north,
the art that legitimately turns). Result: north-up byte-identical on
every ply except the door squares; south-up identical except walls,
ruins, rims, doorways, props and debris — 166/166. `facing-walk.mjs`
(the bare `harness/lab/board.html`): every arena × facings 1–3 with a
dressed position (pieces, a hole, a god-cracked wall, an opened door, a
ruin, marks, arrows) — the camera's paint must equal the WORLD ITSELF
ROTATED painted north-up, with `hashCoords` mapping the rotated squares
back: 108/108, 60 edge-on door paints, 7 double halves. `test-camera.mjs`
80/80. Selftest 44/44 (+ the camera check: the buffer 7×5 → 5×7, a1 at
all four corners, kinds and floor unchanged by a turn, a debris pixel
landing where `pxToScreen` says, `hashCoords` = the world square; the
door checks rewritten for the edge-on rule and the file pairs).
ui-smoke 213 (d8 edge-on and opaque at ply 0; the turn through the real
buttons — buffer swapped, k refitted, every square hit-testing back to
itself, kinds and debris unchanged, the diag line naming the facing —
and the wide layout at 1280×720: the body class, the canvas = the box,
k = min of both axes, the board centred, the bar in the column, and
back). replay-smoke 63, test-logreport 47, test-debris 53,
strip-ruin-chips, canvas-grid `none` 4/4 Chromium + 18/18 Firefox.
`camera-shots.mjs` takes the desktop, the four phone facings and a door
crop for the eye.

**Milestone 4a — THE WORLD AND THE WINDOW (2026-09-08).** Brief §1 read
literally (decided 2026-09-07): the duel is a camera view of the same
world, zoomed. `js/world.mjs` is the world's data — a `World` of cells
(terrain `.` `*` `O` `^`, a piece, the authored skin), the Director's and
the residue's layers (`godCrates`, `opened`, `rubble`) as cell sets, the
player's `start` and the enemy `spawns` a world file marks (`@`, `1`…`9`
on the map; `loadWorld`: stage schema 2, ANY size — the 3–12 × 5–10 cap
is the deal's, an arena must fit the engine), `serialize` / `load` — and
THE CROP TRANSFORM: where an arena's squares land in the world's cells.
A crop is `{ wf, wr, facing, files, ranks }` — the world cell of its
south-west corner in world axes and the ARMY's facing: arena-north is
the world direction the player faces, so under a camera at that facing
the arena reads north-up on the screen at one offset (`arenaToWorld` /
`worldToArena`; the pixels turn with the squares, `arenaPxToEnv`,
`toArenaPx`; a direction, `envDir`). THE ENVIRONMENT IS THE WORLD: the
debris ledger keys on its cells (debris.mjs re-exports the transform
under the ledger's names — `toEnvCell`, `toEnvPx`, `cellOfPx`…), the
cosmetic hashes and the checker key on the world cell, so a crop or a
turn never reshuffles the floor. No mirror exists any more: this page's
world IS the dealt arena (a stage flipped and cropped BEFORE it became a
world — a flip is how a lab world is built, never a runtime transform),
its crop the identity, its ledger one per transformed stage in the
arena's own grid (until the run save takes it over); the deal's flip and
crop no longer feed `hashCoords` (gone from main.mjs and the replay page;
the option survives on the board for the facing-walk gate's inverse map).
THE BOARD'S ONE MODEL IS THE WORLD (`canvas-board.mjs`): `setPosition`
WRITES the FEN and the ledgers into the crop's cells (`World.writeArena`
— a `skins` map replaces the crop's skins, so a repaint without skins
drops them; the door pairs re-read off the skin grid each write) and the
painter reads the world; the terrain rule runs per cell, lazily, cached
until the next write (`board-ui.mjs classifyCell` + `pairDoors` are the
core; `classifyTerrain(fen, …)` is the same rule on a FEN, verified
identical on 144 random boards); `kinds` is a square-keyed view over the
crop; a board built with `files` / `ranks` alone makes a bare world of
that size (every old caller), `world` + `crop` mount a real one
(`setWorld`, `setCrop`). THE WINDOW: the buffer is a window of the
world's screen grid — `viewport: 'crop'` (the default, this page) exactly
the crop's rectangle, blitted whole, as it always was; `'screen'` the
screen's tiles at k plus a one-tile margin, clipped to the world,
centred on a FOCUS (`lookAt(f, r, dx, dy)` — a world cell plus a pixel
offset, the world sliding under the king on a walk; null = the crop's
centre), the visible part blitted, the world outside the crop DIMMED
under the marks, the crop's frame drawn as a ring over it; per axis a
world that fits the screen is centred whole. Fit `'window'` is a fixed
integer zoom (`setZoom`, `ZOOM_RANGE` 1–12, a CUT) in the container's
box — the walk's fit; `?zoom=N` (implies `?viewport=screen`) puts this
page on it as a test surface, `__DCK.renderer.zoom / viewport / lookAt /
cellAtPoint / pointOfCell`. `#origin(sq)` is the world cell's screen tile
minus the window's corner; `squareAtPoint` inverts the blit, the window
and the crop; `cellAtPoint` stops at the cell (a walk's tap);
`renderInfo` adds `viewport`, `zoom`, `window`, `crop`, `world`, `blit`.
Full repaint of the window on every change (about 600 cells at a phone's
k 4); no dirty rectangles until something needs them. GATED BYTE FOR
BYTE: `camera-guard.mjs` (the six cases × fifteen plies recorded on the
build before, replayed on this one: 172/172 identical, no allowances),
`facing-walk.mjs` 108/108, `test-camera.mjs` 80, `test-debris.mjs` 60
(the transform's cases are now the identity and a turned crop at the
four facings), `test-world.mjs` 125 (the crop against brute force at
every facing, the crop agreeing with the camera, the identity, a stage
becoming a world, an arena written through a turned crop reading back as
the same FEN, a world file with its start and spawns, a save round trip),
selftest 45/45 (+ the world window: a 7×5 crop in a 24×18 world at the
four facings, the screen viewport at a fixed zoom, every square and every
visible cell hit-testing back, the outside dimmed, lookAt centring),
ui-smoke (+ the page at `?zoom=12&viewport=screen`: a window of the arena,
the visible squares round-tripping, zoom 2 the whole arena again),
replay-smoke 63, test-logreport 47, canvas-grid `none` 4/4 Chromium.
NOT in this milestone: the army (4b), the barrier by hand (4c).

**Milestone 4b — THE ARMY AND THE WALK (2026-09-08).** Brief §5.1's ONE
MOVEMENT RULE on a hand-built floor: the walk-around build the phone
judges, before any enemy exists. `js/army.mjs` is the rule, pure and
Node-gated (`phase0/harness/test-army.mjs`, 57 checks on the brief's own
cases): THE PATTERN is body-relative (`dx` right of the king, `dy` ahead,
a letter per slot; slot 0 the king; `makePattern` lays a dealt army's
W×2 molding on open ground — royal rearmost, pawns in front per file —
`rotateBody` / `toBody` turn it with the FACING); a turn is one INPUT —
`{ kind: 'step', dx, dy }` (a body-relative king step), `{ kind:
'turn', dir }` (A ROTATION COSTS A MOVE, designer 2026-09-08: it is a
wait with a turned pattern), `{ kind: 'wait' }`, or `{ kind: 'move', id,
to }` (one piece's own move, captures allowed; the king never) —
`planTurn` is pure (the king first: onto floor that is empty or held by
a comrade, who is then evicted; terrain or an enemy refuses, and a
refusal costs nothing), then every other piece's ONE move — a king step
or its own chess move on the world grid (`pieceMoves`: sliders stopped
by terrain and any piece, a comrade's cell a landing only for the
planner and never passed through, knights hop, pawns one step forward
along the facing, never a capture by a push) — that STRICTLY reduces its
BFS distance (`distanceField`, 8-connected king steps over floor, friends
passable, enemies and terrain not) to its TARGET: its slot when that is
reachable floor, else the nearest reachable floor cell to the slot by
Chebyshev, ties toward the king (`targetOf` — molding on the move);
precedence is nearest-to-target then id, in passes (three at most) so a
piece can step into a cell a comrade is leaving (one claim per piece,
its destination; an evicted piece must move and takes its nearest cell
even if farther from home; a turn nobody can complete is refused — "the
way is held", a safety net the swap makes nearly unreachable);
`applyTurn` writes the army and the world's piece grid (a smash turns
the furniture to floor); `spawnArmy` puts an army down molded to the
ground. Measured on the fixtures: unison on open floor in every
direction, the about-face onto the turned slots within four turns, the
blob flowing round a pillar and reforming, a rook home in one, a knight
hopping, a bishop on the wrong colour on foot, a pawn king-stepping
back, a file of four stepping as one, a 5-wide line squeezed into a
3-wide corridor, a crate never smashed by an automatic move, the
individual move smashing one, a pawn capturing diagonally only. THE RUN
(`js/run.mjs`): one object per run and nothing else (designer: no meta
progression; export and import as files; no backward compatibility) —
the stamp `dck-run/1`, the seed, the world id, `floors` keyed by floor
id (one for now; Phase 3 adds entries) holding the floor
(`World.serialize` — the whole terrain grid, the pieces, the skins, the
layers) and the army, the `start` (both as the run began), the turn
count and THE TURN LIST (every input, so a run replays from its seed
and its inputs: the rule is pure, and a save is a bug report); ONE
localStorage key (`dck.run.v1`, the newest run wins), saved after every
turn; `checkRun` refuses a stamp mismatch with one line naming the build
that wrote it. THE WALK SCREEN (`#screen-walk`, main.mjs § THE WALK):
the setup screen lists the worlds (`play/worlds/manifest.json`; a
thumbnail per card, the resume card when a run is saved, "Import a
save"); a world card begins a run — the 3×2 opening kit (K + R + N and
three pawns, brief §4.2; `?army=setup` takes the setup screen's White
knobs) spawned at the map's `@` facing its `facing`, the board a WINDOW
over the world (`crop: false`, fit `window`, viewport `screen`, the
default zoom the largest whole k with 15 tiles across the short axis —
a phone lands on k 4, `?zoom=` pins it), the king centred, the world
SLIDING under him (the board's `panTo`) while the arrivals slide in
whole native pixels (`animateArrivals`; a facing change is a CUT
first); a 3×3 pad (the eight ways, wait in the middle — replaced by the
d-pad the same day, see milestone 4c's HUD note), the two turns,
the zoom ± (a cut), Export save; WASD / arrows / numpad 1–9, Q E, space,
+ −, Escape; TAP A PIECE (not the king) for its own move: the zoom snaps
to at least k 6 centred on it and its moves are marked (a capture red),
tap a target to move, tap elsewhere to let go and zoom back; the status
line (turn, facing, pieces, the king's cell, a note — "blocked" on a
refused step); Back leaves the run saved, Resume picks it up; `?world=
<id>` begins, `?run=resume` resumes, `?save=<url>` imports at boot.
THE WORLDS (`play/worlds/`, `phase0/harness/gen-worlds.mjs`) — HISTORY:
both were RETIRED on 2026-09-08 (the designer: "just completely big
blocks of boring empty featureless rectangles"; § "The dungeon
generator" below has the measurement, and the fixtures are generated
floors now): `w01-the-
undercroft`, the hand-built 60×40 walk-around fixture carved from a
written plan — an antechamber where the walk begins facing east, a
3-wide corridor with pillars and a stub, a great hall with a colonnade
and four pillars entered by double doors, a north-west store and its
2-wide crawlspace, a north-east chapel with a choir screen and a weak
spot, an east corridor, two quarters with a door between, a cave, an
alcove, a dead end, a back way, nothing symmetric; `w02-stress-100`, a
seeded 100×100 of sixty rooms for the frame budget; every floor cell
reachable from the start; `world-shots.mjs` renders each world whole
and the walk screen on a phone and a desktop for the designer's eye.
Gates: `test-army.mjs` 57, selftest 46/46 (+ the run save's round trip
and refused stamp), ui-smoke (+ the walk: the screen, the window with
no crop, the kit facing east, a forward step +f for all six, a turn that
costs a move and turns the camera, a wait, a refused wall step, the save
after every turn, the tap's snap-zoom and targets, the zoom buttons,
the pad and the keys, leave / resume, a refused stamp, an import), the
4a gates unchanged. THE VERDICT (designer,
2026-09-08): "Seems to work fine on mobile and desktop." NOT here, on
purpose: enemies, line of sight, the
trigger (a design conversation of its own), the barrier by hand (4c),
debris on a walk's smash (the ledger is the floor's; the walk's captures
will feed it with 4c), a replay of a run's turn list in the analyzer.

**Milestone 4c — THE BARRIER BY HAND (2026-09-08).** A debug button on
the walk (⚔ Barrier, the `B` key, an initiative select beside it;
`__DCK.walk.barrier({ seed, turn, knobs })`) drops the barrier on the
army as it stands. `js/barrier.mjs` is the pure half: the WINDOW across
the king — the room's floor run at his rank, capped at THE ARENA'S 10
FILES (designer 2026-09-08, on the first phone log's 12×9 duel: "Max
arena is 10x10" — k 6 on a phone; 12 wide is k 5, too small for thumbs;
the engine's 12 is not the game's), centred on his file and slid whole
to stay in the room, refused under 3 wide (`barrierWindow`); the CROP — his rank is row 0, his facing
arena-north, so the arena reads north-up under the camera that turns
with the army (`cropAt`); and the DEAL — gap EXACTLY 4 with the enemy
king pinned to the player's king's FILE on the last row (designer
2026-09-08: "a duel can start at gap 4 for now, and the kings have to be
aligned"), the depth a FIXED POINT of the molding on the crop's own
terrain (`planBarrier` starts at 2 + 4 + 2 ranks, grows while a side
overflows, shrinks by the surplus when the gap runs over, refuses past
10), the carried PATTERN stamped whole (the formation materializes,
stragglers snap into their slots) through the deal's own molding with
the royal pinned (`armygen.mjs layoutArmy` `royalAt`, the back row in
walking order `order: 'as-given'`, `army.mjs bagOfPattern`), the enemy
dealt from the setup screen's Black knobs and re-dealt on a lint failure,
the camp-line variant minted as for any deal; a square off the map is
the barrier's wall (`World.arenaFen`; a planned crop never hangs off);
`World.arenaStage` is the crop as a stage (terrain + the skins whatever
stands there now, a hole a wall to the deal), `cropLayers` its pits,
god crates, doorways and ruins by square. THE DUEL RUNS ON THE WORLD:
`startDuel(session)` is the one path after the deal for both pages; a
world session (`makeWorldSession`, makeSession's exact shape plus the
world, the crop, the layers and the log's `world` block) mounts the
duel screen's board as a WINDOW over the run's world (`mountDuelBoard`:
the crop at the army's facing, viewport screen, the dungeon dimmed
under the tall pass so the top rank's heads rise undimmed, the
coordinates keyed on camera − crop facing; a scaling change remounts on
the same world), the Director is seeded with the floor's pits and cracks
BEFORE its terrain anchor (`DuelController` `holes` / `godCrates`: a pit
is never a standing wall nor a weaken candidate — every off-map square
joins the holes), the residue with the floor's doorways and ruins, and
every ply writes the crop's cells (the board's one model since 4a) —
`__DCK.walk.arenaFen()` must equal the duel's board, and the smoke
asserts it. INITIATIVE is the turn field: the player is always White.
WALKING OUT is ONE overlay button (Rematch, Re-deal, Back to setup and
the cheat Undo hide on a world duel; Back is hidden during it): a WIN
clears every letter in the crop — the enemy is gone from the floor —
and re-spawns the pattern whole around the king's FINAL cell, facing
kept (promotions revert, captured pieces return, brief §8; `spawnArmy`
`lenient`: a king the closer sealed in a pocket walks out anyway, the
rest on the nearest floor beyond); a LOSS ends the run (`run.ended` —
the save stays exportable, the resume card says "Run over", `beginRun`
refuses it with one line); an ENGINE ERROR restores the floor, the army
and the ledger from the pre-drop snapshot. THE RUN records a duel as
its RESULT (`run.mjs recordDuel`: kind 'duel', the crop, the seed, the
initiative, result, termination, plies, quakes, the final FEN, the log
id; never its plies — the replay log holds them; `run.turn` counts
inputs alone, `inputsOf`) and a PENDING entry (`run.pending`: seed,
initiative, the enemy's knobs, the walk turn) goes into the save before
the floor changes, so a reload mid-duel resumes the walk and re-drops
the SAME seeded duel from move one. THE DEBRIS LEDGER LIVES IN THE RUN
(`floors[id].debris`, `updateRun` carries it, `openRun` returns it):
the walk binds it at the identity transform (`debrisBindRun`), a
barrier through the crop (`debrisBindCrop` — every kill and quake lands
in the floor's own pixels), `debrisSave` routes to the run save after a
walk turn and never mid-duel; the walk's SMASH records the crate's own
splinters by CELL (`debrisEventCell`, `debrisSrcOfCell` — the
square-name wrappers cap at file `l`), its steps WEAR the floor
(`debrisWalkTurn`), and the walk board paints the scars
(`debrisPaintWalk` → canvas-board `setCellDebris`; the sampler keys on
the mounted board's theme). THE REPLAY LOG carries `world` (the world,
the crop, the stage the crop made, the layers at the drop; the file is
named by world and walk turn) and the analyzer paints a barrier log from
it without a manifest (`resolveStage` reads it first; the report's
header prints a `world` line). `DuelController.adjudicate({ loser })`
(`__DCK.walk.concede`) ends a duel on demand — the smoke's way to a
verdict. Gates: `phase0/harness/test-barrier.mjs` (60: the fixture at
every facing — the pin, the gap, the crop reading north-up, the order
kept; the window on a hall wider than 12; a crawlspace refused; terrain
deepening the crop; two deep armies in a corridor refused past 10;
off-map walls and the layers on a hand-built crop; the run's duel entry
and the ended run; the lenient spawn out of a sealed pocket), ui-smoke
318 ok + THE BARRIER block (a smash on the walk in the run, the drop by button,
the crop's FEN equal to the duel's at ply 0 and 2, the window around the
crop, the pending entry, the log's world block, a reload re-dropping the
same seed, the one-button walk-out with six pieces around the king and
no enemy letter left, the run's duel entry, a second duel seeded with a
hand-dug pit, a loss ending the run and resume refused, the analyzer on
the barrier log), selftest 46/46, test-world 125, test-army 57,
test-debris 60, test-camera 80, test-logreport 47, facing-walk 108/108,
replay-smoke 63. THE WALK'S HUD, redone the same day on the designer's
verdict ("the ugliest most unusable virtual d-pad I've ever used"): the
map fills the screen under the topbar (`#walk-stage`) and the controls
float over it (`#walk-hud`) — bottom-left A REAL D-PAD (the designer's
second verdict the same day: "something that actually looks and FEELS
like an actual d-pad… I don't need a wait button right in the middle"):
ONE cross, an inline SVG, pointer-driven — the angle from the hub picks
one of eight directions (`WALK_OCTANTS`; an arm, or between two arms for
a diagonal), the hub is dead (`WALK_PAD_HUB`), a press steps at once and
KEEPS STEPPING while held (`WALK_REPEAT_DELAY_MS` 320, then every
`WALK_REPEAT_MS` 150 — the slide is 140), the thumb slides to steer, the
pressed arm lights (`data-dir` on the pad); wait is a button in the side
cluster — the turn / wait / zoom / barrier / export cluster bottom-right,
the status strip along the top; a SWIPE on the map is a step in
its direction (eight ways, body-relative — the camera is at the army's
facing; `WALK_SWIPE_PX` 24, a shorter pointer is a tap and reaches the
piece pick); and the tap-a-piece SNAP-ZOOM goes to `duelZoomFor()` — the
k a 10×10 duel gets in this very box (the width fit on a phone, both
axes under the wide layout: k 6 on the phone, k 3 in a narrow desktop
window, k 5 on a 1080p wide layout) — never the old constant k 6, which
was "absurdly oversized" on a desktop. NOT here, on purpose: enemies on the map, line of
sight, the trigger (its own conversation), per-theme edge-on door art,
a phone height for the duel box (on a phone the dimmed dungeon shows
beside the crop only), the analyzer mounting the whole world (it paints
the crop as an arena). THE PHONE VERDICT IS THE GATE.

**Milestone 4d — THE CONTROLS AND THE CAMERA (2026-09-09).** The
designer-led session whose eighteen rulings are brief §5.1 (read them
there; CLAUDE.md carries the digest), built as the CONTROLS PR — the
movement model and the walk's controls together, since the d-pad's
meaning IS the movement model. THE RULE (`play/js/army.mjs`, rewritten;
`phase0/harness/test-army.mjs` 97): THE ANCHOR IS THE FORMATION'S
FRONT-CENTRE, not the king — `pattern.anchor` (the front row's centre
file, the king's when within half a cell of it, at the front row's
depth), `army.at` its world cell (the formation's position; a save
without one derives it from the king), the king a follower with a slot
like everyone else, so through a one-wide door the pawns file in first
and the king last, and "blocked" means the anchor's next cell is not
floor (the FRONT met the wall — a bump, never a capture). INPUTS ARE
WORLD-RELATIVE (`step { df, dr }`, `face { facing }`, `wait`, `move { id,
to }`; the run stamp is `dck-run/2`): THE FACING FOLLOWS THE STEP
(`facingOfStep` — a cardinal step faces that way; a diagonal keeps the
facing when the facing is one of its components, else turns to the
perpendicular one, never about-face; no ties), and a facing change is a
PIVOT (`pivotPlacement`: every piece to its slot in the turned formation
about the king's cell, molded to the nearest reachable floor at or ahead
of him, own pieces never blocking since all are in motion) BEFORE the
step; a `face` input is the pivot alone (a move). THE WALK (`planTurn` →
`walk`): every piece toward its slot, FRONT ROWS FIRST, THE KING LAST OF
ALL, else nearest-to-slot, in passes; a piece's path is measured with
the comrades who STAY and every cell another piece ENDS on as obstacles
(so a pawn boxed in behind the back row walks around it); a cell one
piece passes THROUGH this turn carries nobody else (one at a time through
a doorway); CATCH-UP — a second step when the path is longer than one, a
third while behind the king (`CATCH_UP` 2 / `CATCH_UP_BEHIND` 3); moves
carry `via`, the waypoints, so a slide goes AROUND a crate. THE
INVARIANT after every turn: a STUCK piece (no king-step path to its
target through floor at all AND no move that gets nearer — sealed off,
not queued; a knight beyond a thin wall keeps its hop and hops home on
its own) and any piece THE BOX cannot hold (`boxOf`: a 10×10 with the
king on its first row, none behind him, the files spanning at most ten;
`left` the offset that CENTRES the formation when there is slack, `rect`
the box in world cells) are TELEPORTED to their slots (`teleport: true`
on the move; the box loop takes the farthest-from-slot first). MANUAL
MOVES (`manualMoves`) are a piece's ACTUAL CHESS MOVES and nothing else —
`pieceMoves({ manual: true })`: the king one square any way, a pawn its
push and its diagonal captures, sliders and the knight their own;
furniture a capture; enemy pieces never — minus any that would break the
box (the king's own filtered on the files' span alone); THE KING'S manual
move is a step the army follows (`fixed` in the walk: his destination
pinned, the anchor shifted by his delta, the facing following, a pivot if
it changes). THE PAGE (main.mjs § THE WALK, rewritten): the board mounts
NORTH-UP always (`facing: 0`), turned for a duel by `mountDuelBoard` as
before and back by `mountWalkBoard` after, each cut behind THE WIPE
(`#wipe`, a black sheet fading `WALK_WIPE_MS` 160 each way; the duel's
lifts once the board has painted or after 1.5 s); the camera's focus is
THE FORMATION'S CENTRE (`formationFocus`, fractional, through `walkFocus`
with the HUD-aware offset) plus the look-around offset; `walkInput`
BUFFERS one input that lands mid-turn and CHAINS the next step of a held
pad or key on the end of the last (`W.pending` / `W.held`), so a walk has
no seam; a refused step NUDGES the view into the wall (canvas-board
`nudge`, `NUDGE` 1-2-2-1-0 tile pixels over `WALK_BUMP_MS` 120); a
teleport dashes (`WALK_TELEPORT_MS` 260), a pivot takes its own beat
(`WALK_PIVOT_MS` 220), a step `WALK_STEP_MS` 150. THE HUD: the d-pad is
WORLD-relative (up is north) — a press in a NEW direction turns the army
in place at once (a `face`, a move) and WALKS if held past `WALK_HOLD_MS`
180, a press the way it faces steps at once and keeps stepping while
held, the thumb slides to steer; the turn buttons, the zoom buttons and
the swipe are GONE (the cluster is wait / barrier + initiative / export);
THE KEYS are world directions, the direction THE SUM OF WHAT IS HELD (W
and D = north-east) after a `WALK_KEY_CHORD_MS` 45 window, a new
direction turning first and walking if still held, Q / E face left /
right, space waits, + − zoom, B the debug barrier, Escape lets go; ON THE
MAP a DRAG (past `WALK_DRAG_PX` 10) pans the focus in whole native pixels
(`W.look`, cleared by the next move — the camera glides back with the
step), a PINCH steps the zoom on each crossing of the geometric midpoint
between neighbouring k (re-anchored per step; the wheel likewise), and a
TAP selects a piece — the king included — marking its chess moves at the
current zoom with the camera unmoved and NO BOX OUTLINE — one was drawn
(`setCellMarks({ frame })`, one pixel in `BOXLINE`, an edge wherever the
neighbour lay outside the rectangle) until the designer's 2026-09-10 "get
rid of the big blue square when I make chess moves during exploration";
the manual moves still filter on the box, unseen; a
catch-up path animates along its waypoints (`animateArrivals` takes
`via`; `#paintCellSlide` walks the polyline). The status strip reads
turn · facing · pieces · k · a note. The debug turn in Options → Look and
`?facing=` stay for the renderer gates. `__DCK.walk` gained `look()`,
`box()`, `focus()`; `state` carries `at` and `look`; `duelZoom` is gone.
Gates: test-army 97 (the facing rule's sixteen cases, unison and the
pivot on open ground, the corridor about-face in one turn, the dead end,
the doorway — one at a time, a pawn first, the king last — catch-up past
a pillar, stragglers home, the chain, molding, the crate bump, manual =
chess only, the king's move with the army following, the box's filter and
teleport, the sealed pocket, the knight's hop home, refusals, the save
with its anchor), selftest 46/46, ui-smoke (the walk block rewritten: the
step, the face, the pivots to a wall, the tap without a snap and the box,
the king tapped, the pad's tap-turn, q, a W+D chord, a drag and its
return, a pinch; the barrier block's walk-out waits for the transition)
241 ok, test-barrier 108, test-world 125, test-dungeon 96, test-debris 60,
test-camera 80, test-logreport 47. NOT here, on purpose (the DUEL START
PR, rulings 3, 9, 16): the drop still stamps the pattern; the gap is
still front-most to front-most; the box at the drop is still centred on
the king's file; the walk-out still re-spawns the pattern whole. THE
PHONE VERDICT IS THE GATE — the pace (`WALK_STEP_MS`), the hold threshold
and the pivot's beat are the first dials to turn on it. THE FIRST WALK'S
VERDICT (designer, the same day, three screenshots): "the king is lagging
behind sometimes… I feel like this shouldn't be seeing this without
manual moves. Also, bumping into single blocks the army should just be
able to flow around" — a junction of crates where the army bumped in
several directions. Three defects, fixed the same day: (1) the step was
refused whenever the anchor's cell was not floor, so one crate or pillar
ahead of the middle pawn stopped the whole army — now the anchor may
stand ONE cell into stone beside floor reachable from the king
(`anchorMay`: a single block is flowed around, a thin wall into the next
room is not), and "blocked" is a step that moves NOBODY (the front met
the wall); (2) the king, planned last, could not end on a cell another
piece passed through, so a pawn catching up across his slot starved him
of it turn after turn — now a catching-up path PREFERS an equal-length
path that does not cut through a comrade's slot (the strict one-passer
rule stays, so at a doorway the king still waits his turn); (3) once
behind, the king closed in at two cells a turn against a front moving
one, with his molding tie-break pulling toward himself — now THE KING
HURRIES THREE whenever his path is longer than one and his tie-break
runs toward the ANCHOR, and THE KING'S LEASH (`KING_LEASH` 3): a step
that would leave him more than three cells from his slot becomes a
REGROUP (`plan.regroup`, the status says "regrouping") — the anchor
holds, the walk still runs, nobody is refused, the front waits for its
king. test-army 106 (+ the flow past a pillar and a crate with no refusal
and the crate standing, a solid wall still refused, twenty-four inputs
through a cluttered hall with the king never past the leash, the door
scene's lag bound, a synthetic regroup).

THE SECOND WALK'S VERDICT (designer, the same day, four screenshots on
Vaults 4, all from the d-pad alone): "It mostly works, I'm not getting
stuck on every little square, and the army is mostly better at staying
together. I'm still seeing the king in weird spots despite seeing him
make multiple moves… I feel the pieces should at least be able to stay
adjacent if I'm only using d-pad movement. Maybe this has something to
do with how the spots are assigned in hairy spots. I'm seeing the king
making multiple moves per turn just to pick a square that's sometimes
multiple spaces behind the rest of the army." AN INSTRUMENT FIRST:
`phase0/harness/walk-stress.mjs` walks the kit at random over the four
generated fixtures (a direction held one to eight steps, 4% waits;
`--hold 1` a thumb on one arm of the pad, cardinals held six to twenty)
and measures what the designer was seeing — the king's lag to his slot,
his distance to the nearest comrade, whether the army is one 8-connected
body, teleports by reason (`plan.teleportWhy`: stuck / behind / box) —
and prints the worst turns as local maps (K the king, k his slot, @ the
anchor) and, with `--trace <turn>`, the twelve turns before one. The
first run said where the weird spots came from: 4842 TELEPORTS in 11 000
turns, and almost every one was the box rule firing after the king had
stepped DIAGONALLY AHEAD of a comrade still queued at a door — the rule
read the rook as "behind him" and threw it into the doorway. Every fix
below is in the walk itself (army.mjs), each measured on the harness:
(1) THE KING NEVER OVERTAKES a comrade (no step of his may put another
piece's cell behind his own) and no comrade ENDS behind him — a path
round a crate pair may dip `DETOUR` 2 cells behind him and come back
within the turn — so the box's "king on the first row" is kept by the
walk and the teleport is only for the truly stuck and what the ten-by-ten
cannot hold (teleports 4842 → 35 on the spot); (2) a piece's plan HOLDS
across the planning passes (its claim and the cells it passes through
stay booked) and a re-plan replaces it only when it ends strictly nearer
— the king and a rook waiting on each other had swapped plans every pass
and the cut-off left one of them standing; (3) a comrade who has not
planned yet this turn is not an obstacle in a piece's field (a pawn
planned before the pawn in front of it was detouring round the back of
the formation and blocking the king), and pass 0 is always followed by a
second pass; (4) a way round the comrades longer than the way through
them by `DETOUR_MAX` 3 is not walked — the piece QUEUES up to the crowd
on the straight way's field (the king at a doorway had been sent round
the outside of the building, then held by "never walks away", so he
stood still); (5) THE TARGETS OF A WALK ARE ONE CONNECTED SET
(`assignTargets`, once per turn, unique: the king's first — his slot, or
the nearest direct cell never ahead of its row — then every slot that is
free direct floor, then the rest molded BESIDE a target already given,
never behind the king's cell, a cell behind his TARGET costing
`BEHIND_COST` 2 per rank, and while the set falls apart the detached
target nearest the king's component is given again beside it; the pivot
places by the same rule) — a pawn molded across a wall's corner had
walked a parallel corridor for twenty turns with the king forbidden to
overtake it; (6) STUCK means no way to the target that does not end
behind the king (a pawn in a pocket beside him whose only way out is
round his back rejoins by teleport); (7) a step's tie-break prefers the
more forward cell (a knight's hop over a diagonal step back); (8)
`KING_LEASH` 2. MEASURED, the shipped set, 3000 inputs a fixture: held
cardinal walks (11 100 turns) — the king never more than two behind his
slot, two on 17% of turns, at least two from every comrade on 5.7%, 0–8
teleports a fixture; random walks with diagonals (10 900 turns) — lag
three gone, 9–15 teleports a fixture (stuck, or a pivot's leftovers),
regroups 588 → 90–130, the army in more than one 8-connected body on
36% of turns, two thirds of those a pawn already ON its target a cell
ahead of a king one behind his. test-army 106 (the chain fixture's rook
now stands where every pattern's royal-rearmost rule puts it), selftest
46/46, ui-smoke 287 ok (its key-chord check now judges the chord's
inputs rather than their count: with motion off a held chord chains a
step per tick, and the north-east step it makes was refused on the old
build), test-barrier 108, test-world 125, test-dungeon 96, test-debris
60, test-camera 80, test-logreport 47.

THE THIRD WALK'S VERDICT (designer, the same day, five screenshots, every
one a "regrouping" turn with the army spread over three or four cells
around a wall stub or an urn column): "Still getting odd positioning
sometimes. Maybe we're overthinking it. The whole goal of this is to make
it so when moving with just a d-pad the army should never be split. They
should stay in a battle ready cluster as much as possible." So THE
CLUSTER IS THE INVARIANT, not a side effect: after every d-pad turn the
army is ONE BODY — every piece TOUCHING another by chains (a king step
apart; a diagonal counts only when one of its two orthogonal cells is
crossable, so a piece across a wall's corner is NOT part of the body —
that corner was how pieces had been slipping onto the far side of thin
walls and walking a parallel corridor). Built in army.mjs on the
harness, every rule measured: (1) the walk plans as before, then
`settleBody` judges its end: whole, or else; (2) a laggard that could
not move AT ALL while the body went on is STUCK — it teleports beside
the body (ruling 15's "just teleport pieces that get stuck somewhere,
who gives a fuck"), unless a comrade was what stopped it (`queued`: a
claimed cell, a cell passed through, a cell not yet left — it is waited
for); (3) THE RETRACTION (`retractSplit`, on a copy of the walk —
REPLACED BY THE ROPE on the fourth walk's verdict, below): a
split end gives back last steps until the army is one body — first the
outside pieces' steps that did not bring them nearer the body (a pawn
that rounded a pillar a step too far waits beside the rook; the rook
follows next turn), then the body's own, THE KING FIRST (he waits for a
straggler still on its way, and for the rook he stepped past at a door),
a piece stepping back onto a cell a comrade took in its wake pushing
that comrade back too; (4) if even that fails the army was split before
the walk began (a piece moved away by hand): it walks on and converges;
(5) the king's never-overtake PLANNING rule of the second verdict is
RETIRED — with two pieces level with him in a dead-end nook it froze the
whole army for 1800 turns of a run: the king plans freely and the
retraction gives his steps back only when a comrade would end BEHIND HIM
(`behindKing`: behind his row and not touching him — one rank behind but
touching, the queued rook at a door, is tolerated by the walk and the box
loop alike; the drop molds it into the box), so the walk order is the
king LAST again and the rook takes the doorway ahead of him; (6) a plan
made while a comrade still meant to leave its cell is VOID once that
comrade stays (the passes are capped; two pieces had ended on one cell);
(7) the target set and the pivot's placement use the same touching
adjacency; a stuck piece's teleport lands beside the body. THE
INSTRUMENT grew what the work needed: `--teleports N` and `--refused N`
samples, a collision check, and the would-be targets printed on a
refused traced turn. MEASURED, the shipped set, 3000 inputs a fixture:
held cardinal walks (10 300 turns) — the army in more than one body on
3–6 turns a fixture (0.2%), zero collisions, the king touching a comrade
on EVERY turn and never more than two behind his slot (lag two on 14%),
4–32 teleports a fixture (stuck pieces, one "behind"), 3–4% regroups,
16% refusals (the front meeting a wall); random walks with diagonals
(10 100 turns) — split on 4–8 turns a fixture, 18–36 teleports. test-army
115 (+ THE CLUSTER block: one body after every turn through the door,
round the pillar, through the clutter and on a seeded random walk; a
rook dragged four cells away rallies back on foot while the body stands),
selftest 46/46, ui-smoke 331 ok, the other Node gates unchanged.

THE FOURTH WALK'S VERDICT (designer, 2026-09-10, five screenshots, every
one the status "blocked" with open floor ahead, the formation often a
column across its facing): "Alright they're much better at staying
together. but now I'm getting blocked in a lot of places I feel shouldn't
be a problem." The harness agreed — 7–11% of held cardinal inputs were
refused BY THE WALK ("blocked (walk)": a step that moves nobody; the
summary now splits refusals into `[anchor N, walk M]`, the anchor's own
being the map's edge or a thin wall) — and `--refused N` grew what the
diagnosis needed: the refused step's stage traces (walk / settled / held
walk / held settled / settle, each with its `queued` and `stuck` sets), a
`pieces:` line in world coordinates with the anchor and the facing (a
scratch script rebuilds the position from it and replays the input, or
holds it for ten turns), and, since the marks hid what they stood on, `%`
for an anchor and `x` for a king's slot one cell into stone; `--lag N`
samples the turns where the king ends three or more from his slot. Every
refusal replayed was the cluster machinery refusing a step the pieces
could take, and each cause is fixed in army.mjs and measured: (1) THE
RETRACTION WAS GREEDY — `retractSplit` gave back whole walks whenever one
pocketed pawn could not be reconnected — and is REPLACED BY THE ROPE
(`ropeSettle`): the army is settled as a rope from the king outward — the
pieces ordered by their chain distance from him as they STAND, each with
the parent that links it toward him; the king takes his walk cell and
every piece after him the FARTHEST cell on its walk path adjacent to a
piece already settled, never a cell taken, never one behind the king
(unless it started there); a piece with nothing to touch takes THE FOLLOW
STEP (up to `CATCH_UP_BEHIND` of its own moves through free floor to the
nearest cell adjacent to the body, ties toward its target — a rook that
slid north while the king rounded a wall's east end steps after him
instead of holding the whole army back); a piece with neither pulls its
chain back — the piece standing in its start cell if one took it (a
follower loses its follow, a walker a step), else its nearest ancestor
with a step left — and the rope is laid again; a laggard with no step at
all that stone stopped is STUCK and teleports beside the body; a piece
the start already left split (moved away by hand) takes its farthest free
cell and converges; (2) THE LAY IS ORDER-BLIND: a piece that cannot take
its whole path is DEFERRED once and laid again after the rest (the
comrade beside its path, or the one that fills the cell it leaves, may be
laid by then — a pawn ahead of a corner could not step into it until the
pawn behind it was laid in its cell), and THE EXTENSION after a whole lay
lets every piece take the farthest cell on its path that keeps the army
one body, round after round (the chain touches only pieces laid before
it); (3) THE BODY IS EIGHT-ADJACENT (`adjacent`), corners included —
judged corner-free, an army whose only way out of a pocket was the
diagonal between a crate and a wall could never pass it as one body (the
first piece through was "split off"), so it stood blocked, or a piece
already past walked on alone, nine cells ahead of its king; a TARGET is
still never MOLDED across a corner (`touching`), but the target set's
connectivity is the body's, and a detached slot is given again beside the
king's component by the body's adjacency — so a set leads through such a
gap by its corner cell instead of collapsing into the pocket as a swap
nobody could start; (4) A MOLDED TARGET TIES TOWARD THE ANCHOR, as the
king's does — tied toward the king, a pawn threading a one-wide gap was
given the gap cell it stood in, and the file behind it waited on a pawn
told to stay; (5) TWO RANKS BEHIND THE KING is the walk's tolerance
(`behindKing`; one was the third walk's) — a diagonal file of three
through a gap spans two ranks by geometry, so at one the king in a gap's
mouth could never step on to let the pawn behind him in; the box loop and
the drop read the same tolerance, and `manualMoves` offers a move while a
comrade stands there when it leaves the box no worse (with the box not
`ok`, nobody had been offered anything); (6) A REGROUP THAT MOVES NOBODY
YIELDS the step's own walk when that is whole — the pieces take it WITH
THE ANCHOR STILL HELD, so the formation closes up on the step's cells and
the anchor never runs ahead of an army that cannot follow (held on a
crate pair, the regroup's slots were a swap no piece could start and the
step's walk, whole and moving, was thrown away; an anchor that stepped on
while one rook walked ran nine cells ahead of the king). MEASURED, the
shipped set, 3000 inputs a fixture: held cardinal walks (11 000 turns) —
refused by the walk 37–51 a fixture (104–168 before; the anchor's own
refusals, the map's edge or a thin wall, 148–267), the army ONE BODY on
every turn, zero collisions, the king touching a comrade on every turn
and never more than three behind his slot (three on 1–5 turns), 3–7
teleports a fixture (stuck), 58–107 regroups; random walks with
diagonals (10 800 turns) — refused by the walk 28–47 (147–163), split on
0–4 turns a fixture (a pivot in a cramped corner, the strays converging
within a turn or two), 6–24 teleports. Every position replayed flows: the
crate pair, the crate-and-wall corner, the pocket whose only exit is a
corner, the one-wide gap — all the way out. test-army 115, selftest 46/46,
ui-smoke 280 ok (its east walk now runs to 80 inputs before the ring
refuses — the army walks farther before a wall — and its box check reads
the walk's tolerance), the other Node gates unchanged.

THE FIFTH WALK'S VERDICT (designer, 2026-09-10, five screenshots: a pawn
a rank behind the king after his diagonal step, a rook a rank behind him
and touching, a pawn two ranks behind with the rook between, the box
outline drawn with those two outside it): "Alright we're almost there.
I'm now getting situations where pieces end up behind the king." So
RULING 4 IS STRICT: nobody is behind the king's rank after any input —
the third walk's "one rank behind and touching" and the fourth's two
ranks are RETIRED (`behindKing` is `dy < 0`; `boxOf` is whole after every
turn and `manualMoves` filters on it again; the harness counts BEHIND THE
KING turns, `--behind N` samples them, and test-army asserts the box
whole after every turn of its cluster walks). What the strict rule cost
was measured on the harness and paid back in army.mjs, each rule on a
replayed position: (1) THE KING WAITS — the rope gives back his steps
for a comrade that would end behind him (a comrade queued at a door goes
through first and he goes last) and never holds a piece stuck because the
chain pulled its steps to zero (a laggard is one the WALK could not
move); (2) a target is never molded behind the king's TARGET (`floorAt:
origin`), not merely his cell; (3) THE KING'S PLAN NEVER HOLDS ACROSS
PASSES — released at the start of every pass ("he stays": his cell an
obstacle, nothing else booked), so the comrades take the cells they need
and he plans round them, last (planned last, he had booked a corner cell
as his via while the pawn and the rook beside him could not yet step,
and his booking then kept them out); (4) THE LAST RESORT before a step
is refused, only where the strict rope collapsed a walk that had moves:
THE KING STEPS ASIDE — a walk with him pinned to one king step level
with him or a rank back, never forward, his cell given to the comrades
who could move only through it (a pocket's mouth, a gap he stands
before), so they file in first — and only if no sidestep moves anyone
THE BREAKER: the comrade he waited for in vain is stuck and teleports
beside the body (ruling 15's "just teleport pieces that get stuck
somewhere"); (5) no swaps in the rope (two pawns in a pocket had traded
cells every turn through the follow step), a stuck piece's teleport
never lands on its own cell, a cell shared with the king (laid on a
stuck piece's start) stays taken through the placement, and a piece a
stuck teleport detaches rallies beside the body; (6) the walk's STUCK is
a piece with no way to its target AT ALL — a way that runs behind the
king is a way, since he can step aside (the second walk's "none that
does not end behind the king" is retired); (7) THE QUEUE SWAP — a comrade
standing on its own target in a piece's way, able to reach that piece's
target, trades targets with it, so a file of pawns in a one-wide
passage moves as one instead of the front one being told to stay; (8)
THE ANCHOR may enter stone only where floor lies BESIDE OR AHEAD of the
stone (the floor behind it let it into a dead end's wall, and the slots
molded beyond sent the army on a tour of the map), and a second step
into stone in a row SNAPS it to the floor beside — it had been walking
down a wall column parallel to a one-wide passage and molding the file's
slots into a swap. Every stage snapshot of planTurn's `trace` carries
`targets` and `vias` now ('walk' / 'settled' / 'held walk' / 'held
settled' / 'aside' / 'breaker' / 'settle'), which is how each case above
was read. MEASURED, the shipped set, 3000 inputs a fixture: held cardinal
walks (11 200 turns) — nobody behind the king on any turn but ONE (a
pivot in a nook two cells wide, where no cell ahead exists: seven
'behind' teleports on that fixture, the residue), refused by the walk
0–3 a fixture (37–51 after the fourth walk, 104–168 before it), 0–2
stuck teleports, one body on EVERY turn, zero collisions, the king
touching a comrade on every turn and never more than three behind his
slot, 390–500 regroups (14–18% of inputs: the king waiting for the file,
and the status says so); random walks with diagonals (11 200 turns) —
refused by the walk 0–3, 0–2 teleports, nobody behind the king, split on
no turn. Every position replayed flows and none needs a teleport: the
crate pair, the crate-and-wall corner, the pocket whose only exit is a
corner (the king steps back into the pocket and the pawns file out
through his cell, one a turn), the wall spur, the one-wide passage, the
door (the king last, one piece through a turn). test-army 119, selftest
46/46, ui-smoke 259 ok (its box check reads `ok` again), the other
Node gates unchanged.
THE DESIGNER'S VERDICT (the same day): "Alright this will do for now,
but we should probably take another look at this eventually." The
branch merges as it stands — and one more ask the same day, done: "get rid
of the big blue square when I make chess moves during exploration" — the
box outline on a selected piece is gone (`setCellMarks` lost its `frame`,
canvas-board its `BOXLINE` edge painter; the manual moves still filter on
the box, unseen); and THE SLIDE ORDER, the same day (designer: "when I
move with the d-pad, tall pieces like the king, their heads briefly
render under the piece to the north"): a piece in mid-slide painted LAST,
over everything, and the walk's arrivals in their plan's order with the
king first, so a comrade north of him painted over his head for the
slide's length and the tall pass put it back when they landed — now a
slider paints IN the tall pass by where its feet are that frame (before
the row whose line lies below them, after the row on whose line they
stand), duel slides included (`#slideAt` / `#cellSlideAt`; a mid-pivot
frame of the kit, sampled off the buffer, shows the knight's head whole
over the pawn beside it where the old build clipped it). THE REVISIT
LIST, for when it is looked at
again: (1) THE REGROUP RATE — 14–18% of held inputs are a turn the king
spends waiting for the file, which reads as the army standing still on
a held pad (a walk could plan the file's move and his own step in one
turn wherever his step keeps the row); (2) THE NOOK PIVOT — a turn in a
nook two cells wide leaves a piece behind the king because no cell
ahead of him exists (seven 'behind' teleports on vaults-3, the one
residue); (3) THE SLOT DIAGONAL — a diagonal input from inside a
one-wide north–south slot (the harness's gap-file case) is still
refused; (4) DEAD ENDS — the anchor refuses at a dead end's wall and
the map's edge (143–265 a fixture, all the map's own), which the
status strip should say in words. THE INSTRUMENT FOR IT, committed:
`phase0/harness/walk-replay.mjs <world> <df,dr> [--hold N] [pieces: …]`
rebuilds a position from the `pieces:` line walk-stress prints (or
starts at the fixture's start) and replays one input printing every
stage of planTurn's trace with its targets and vias, or holds the input
N turns printing the map, the plan and the position after each — the
scratch scripts every case above was read on.

**Milestone 6 — THE ENEMIES (2026-09-10, the enemies session; three PRs
in one branch).** The designer opened with the kit and the enemy size
("I'm thinking we make the player's starter army 4 wide. 1 rook, 1
knight, 1 bishop, 4 pawns. Enemies will be 3 wide for now") and ruled on
six picks with "sounds good, go ahead" (CLAUDE.md § "THE ENEMIES
SESSION" carries them: the 4×2 kit, the far row as a band, crates and
doors block sight, a rear or side catch pivots the army to the axis, the
enemy band at width 3 is nine to thirteen points with no queens, sentries
first). WHAT WAS BUILT, in the order it went in:

THE KIT (`army.mjs OPENING_KIT`, the one constant): K + R + N + B and
four pawns, value 15, laid N K R B over P P P P — a width of four has no
middle, so the king stands second from the left and the anchor on his
file. It was copy-pasted in six places before; the page, the generator's
start and lints, walk-stress, walk-replay and the tests import it now.
The generator's staging area is shaped by the kit's own slots
(`stagingOf`: floor under every slot, one row behind the king, four rows
ahead of its front), `SPAWN_WIDTHS` reads all threes, the four fixtures
were regenerated (the starts moved on vaults-1, -3 and -4; the kit stands
on its slots at every start and its first step moves all eight). MEASURED
on the 4-wide kit (walk-stress, 3000 inputs a fixture): held cardinal
walks (11 370 turns) — one body on EVERY turn, nobody behind the king,
zero teleports, the king within four of his slot (two on 45%, three on
89 turns, four on 6), 630 refusals of which 6 the walk's and the rest the
map's own dead ends and edges, and THE REGROUP RATE UP: 3096 regroups,
27% of held inputs (14–18% on the 3-wide kit — a four-piece front files
into the vaults' three-wide passages three deep, so the king waits for
the file more often; the revisit list's first item, now heavier); random
walks with diagonals (11 209 turns) — 16 walk refusals, 3 teleports, 2319
regroups (21%), split on no turn, nobody behind the king.

THE DUEL START (brief §5.1 rulings 3, 9, 16; `barrier.mjs` rewritten,
`armygen.mjs buildMatchup` taught `white.cells` and `gapAt: 'camp'`):
THE PIECES STAND WHERE THEY STAND — the deal's white cells are the walk's
own through the crop (`standingCells`), nothing is summoned and 4c's
stamp-is-the-pattern is retired; THE BOX IS THE WALK'S OWN RULE — the
barrier's `boxPlacement` (file 4 always) and the walk's `boxOf` (slid
along the king's rank to hold every piece, the formation centred when
there is slack) were two placements, and the barrier reads `boxOf` now
(a lone king, the generator's lint, still gets the centred box); THE GAP
IS BETWEEN THE CAMP LINES (each side's pawn line, `campLineRank`) with a
floor of 2, so a piece pre-moved ahead of the pawns sits inside the gap
and THE ENEMY MOLDS AROUND IT (its `reach` excludes every white cell;
`buildMatchup` refuses an overlap besides); an AXIS other than the
army's facing is refused as the army stands and dealt after THE PIVOT —
`walkBarrier` plans a `face` turn on the world first (the drop's, never
a walk turn; the pending entry carries the axis, the run's duel entry
carries `axis` and `pivoted`); `planBox` takes `axis` and `enemyFile`,
`farRowTargets` lists every far-row cell that deals along an axis (the
hunter's goals and the threat display, one function). THE WALK-OUT
(`army.mjs walkOutArmy`): the survivors stand where they stood when the
duel ended (each survivor takes the slot of its letter nearest its cell;
a letter beyond the kit's count of it is a promoted pawn and reverts at
its cell), the captured return beside the body (the spawn's molding
around the fixed survivors — `spawnArmy` gained `fixed` and `stamp:
false`), and a king whose pocket cannot hold the army moves it WHOLE to
the nearest floor that can (ruling 15; `nearestHold`), the lenient spawn
the last resort. A drop on a real floor costs 0.57 ms per axis of
far-row checks grid-only. `test-barrier.mjs` was rewritten (160: the
walk's box on a standing army, the slide, the pieces where they stand at
every facing, a pre-moved rook inside the gap with the enemy molded
around it, a pawn ahead of its wall leaving the camp line, the band, the
thin wall, the sealed and the doored line, the depth outputs, the axes
behind the army refused then dealt after the pivot, the walk-out's
survivors, promotions and returns, the sealed king's whole army).

THE ENEMIES (`play/js/enemy.mjs` the pure half — `phase0/harness/
test-enemy.mjs` 66; main.mjs § THE WALK runs the loop and the drop):
AN ENEMY IS THE SAME ARMY — an army.mjs Army on the black side with a
pattern from its spawn's digit (the width) and a bag drawn from the
run's seed in the band (`enemyBudget`: width + 4 per piece, ±2; no queen
fits at width 3), spawned at the digit facing the way the start lies
(`facingToward`), driven through `planTurn` with step inputs, so the
cluster, the box and nobody-behind-the-king hold for it as for the
player; `Army.stamp` clears only THE CELLS IT LAST WROTE (two enemy
armies share the lowercase letters and the old stamp erased the other
army; `remember`, `lift`). SIGHT (`lineOfSight`): king to king, a ray
through the cell centres — walls, doors and crates block, holes do not,
pieces never do, a ray through the corner between two cells passes when
either is see-through — checked after EVERY move. THE STATES: a SENTRY
stands until it sees the king; a HUNTER walks by BFS over ground it can
cross (its own pieces pass; the player's, furniture, holes and walls
block — a closed door is a wall to it) to THE TRIGGER'S far-row cells
(`hunterGoals`: the four boxes on the player's king, the axes behind him
through the pivot the drop would make — `armyAlongFast`, the pivot's
placement alone, computed once per input for every hunter (`axisArmies`)
— each far-row cell where `planBox` comes out legal for THIS enemy's bag,
with the ffish lint: a far-row cell the player's rook covers is no goal),
sight lost sends it SEARCHING to the last-seen cell, where it stands (a
sentry again); with no goal reachable a hunter walks at the player's
king, and a target it cannot reach becomes a WAYPOINT (the reachable
cell nearest it, held until reached — a cell recomputed every turn had
the army pacing between two cells). THE STEP is the king's neighbour
nearest a goal by the BFS (strictly nearer first, level steps when the
formation cannot make a nearer one, never straight back), each candidate
planned in turn and JUDGED BY ITS OUTCOME — the king nearer, else a
regroup on a nearer direction (the pawns filing through a door while the
king waits is a corridor's normal gait), else a sidestep; a position
the army has stood in within the last six turns is a STALL, and after
`STALL_MAX` 3 the army PIVOTS to face its way (ruling 14's wheel
re-molds the formation about the king — a human player's own way out of
a tangle), a second tangle within `REST_AFTER` 8 turns of that a REST of
`REST_TURNS` 6. THE TRIGGER (`triggerFor`): a HUNTING king on a far-row
cell of one of the four boxes (the exact pivot planned for the one or
two axes it is nine off along) with a legal deal — the side whose move
completed the alignment moves first (brief §4.4); the page checks it
after the player's move for every hunter (his ambush, White) and after
each enemy's turn (its initiative, Black), the world freezing at the
first; SEVERAL AT ONCE open THE CHOOSER (`#walk-chooser`: one button per
candidate, inputs refused while it waits, `__DCK.walk.choose`). SPEED
PARITY: one enemy turn per input that costs one (never a refused step),
the player's turn then each enemy in spawn order, every arrival in the
ONE slide with the player's so a held pad keeps its cadence. THE DROP
(`walkBarrier` with `enemy` / `enemyFile` / `axis`): the enemy's letters
leave the floor (inside the crop or trailing outside it) and its bag is
molded into the box; a BYSTANDER's pieces inside the box are lifted for
the duel and set back after on the nearest floor (`liftInside`,
`settleBack`); the pending entry names the enemy, the axis and its far-
row file, so a reload re-drops the same duel. A WIN removes the whole
enemy army; the other enemies keep their state through the frozen duel
(a second hunter already on a far row catches the player on his next
input). THE SAVE is `dck-run/3` — the enemies in the floor's entry
(army, state, last-seen cell, seed, waypoint); the turn list stays
inputs only. ON THE BOARD: THE THREAT DISPLAY (brief §5.4 — the far-row
cells of every hunter's goals framed red, `setCellMarks` `threats`) and
a BADGE over every king that is not a sentry (`!` hunting, `?`
searching, the 3×5 font grew both glyphs). `?enemies=off` walks an empty
floor (the labs, the old smoke blocks); `__DCK.walk` grew `enemies`,
`sight`, `goals`, `threats`, `candidates`, `choose`, `enemyMs`,
`placeEnemy` and `setEnemyState` (the last two test-only). The lint
(`lintMatchupFen`) keeps ONE ffish Board per variant and re-sets it
(`setFen`) instead of constructing two per cell — a construction costs
~3 ms on the WASM pair, a `setFen` ~0.03 — since a hunter lints forty
far-row cells a turn. MEASURED (`phase0/harness/hunt-stress.mjs`: every
spawn of every fixture hunts the kit at the start with sight granted,
grid-only): the player STANDING — 13 of 16 caught (median 28 turns, max
83; 8 through a pivot), 3 missed at 120 turns; FLEEING (a held cardinal
walk away) — 16 of 16 caught (median 35, max 98; 11 through a pivot,
one of them the player's own step into the line); the enemy work 29 ms a
turn standing, 56 fleeing, in Node; the browser's first hunting turn
with the lint measured 111 ms before the fast pivots and the lint's
cached Board, 51 after. THE HUNTER'S KING MOVES BY HIS OWN MOVE (ruling
10) where the box offers it — a d-pad step's catch-up had carried him
two cells at once and straight past the far-row cell he was walking to,
the corridor hunt of the smoke missing its far-row cell for nine inputs;
pinned by his move he lands on it in six. THE RESIDUE, on record: the
three standing misses are
formations tangled in crate pockets (the hunter's greedy step over king
cells cannot solve what the walk's regroup cannot — the same item as
the regroup rate on the revisit list; a planner over formation states is
the fix if the phone asks for it); a hunter that gets closer than nine
backs off to the far row, which a player can stall by following (the
conversation's known oddity); the lint's cost still scales with the
hunters. Gates: test-enemy 66 (the band, the spawns from the digits and
the stamp that clears only its own cells, sight and the corner rule, the
state machine on open ground with the trigger's initiative, the player's
ambush and the axis behind him through the pivot, search and the door,
the pillar's cell no goal, the wall line, bystanders, the spawn's facing,
the save), ui-smoke THE ENEMIES block (four sentries on the fixture,
a hunter stood in the west corridor caught after nine inputs with its
initiative, the ambush through the pivot on the north far row with the
player's, a reload mid-duel, the chooser with two hunters at once, the
other hunter's catch on the next input, the floor clear after four
duels), the old walk and barrier blocks on `?enemies=off`. THE PHONE
VERDICT IS THE GATE.

**THE FIRST PHONE LOGS (2026-09-11) — SIGHT BETWEEN ARMIES AND THE FAR
HALF.** Two replay logs from the phone, both duels won; the designer on
the first: "First one had a lot of trouble starting the duel. You
understand that duel activation can force the player's army to turn
right? Or maybe the line of sight is too strict. Maybe we should count
it as any two pieces seeing eachother, not just the kings." MEASURED
before anything changed: (1) THE PIVOT is not the trouble — a rear or
side catch wheels the army to the axis at the drop by ruling 4, and it
never refused at 1,200 random kit placements and 2,246 walked turns
across the fixtures, on any axis. (2) The first log's duel came on the
south axis with the enemy's initiative; enemy 3's king stood two cells
behind its spawn, on the far row — a sentry that noticed late and backed
off (the log has no walk inputs; the run save export would replay the
181 turns). (3) KING-TO-KING SIGHT was strict: on random kit positions
the kings saw each other on 1.7–3.1% of enemy-and-position pairs
(median seven cells), any two pieces on 6.6–11.9% (median ten); around
the log's two spawns the enemy king saw the player's from 128 and 66 of
about 540 nearby floor cells, any piece any piece from 344 and 220
(`phase0/harness/sight-map.mjs`, an ASCII map of where a spawn sees
you). (4) THE RETREAT DANCE, the larger fault: the trigger wanted the enemy king
EXACTLY nine off, on the far row, so a hunter that first saw the player
inside nine had to back off — one step per input, SPEED PARITY — and a
player who kept walking at it never let it: `phase0/harness/charge-
stress.mjs` (a crude thumb walking the kit at every sentry, sixteen
hunts; `--kings` the old sight rule, `--policy wait`) had six start under
king sight, four of them never triggering in 250 turns while the enemy
retreated 15–86 times, and the same six with a wait pressed after first
sight triggering within ten turns; under any-piece sight nine started
and eight triggered while walking on. The designer: "Do both, go
ahead." BUILT: SIGHT IS BETWEEN ARMIES — `enemy.mjs armiesSee`, any
piece of one army seeing any piece of the other (the kings first, at
most 64 rays; pieces never block), read by `updateSight` (the last-seen
cell stays the king's — the hunt's goals are his boxes) and
`__DCK.walk.sight`. THE FAR HALF — `barrier.mjs FAR_HALF` 5: a hunting
king anywhere on rows 5…9 of a box, on a file whose deal is legal,
triggers; the deal molds it onto the far row as ever (ruling 16 never
read its walking pieces, so its standing cell only names the axis and
the file); `farRowTargets` lists every floor cell of the far half of
each legal file, `far` marking the far row, so the hunter's goals, the
threat display and the trigger stay ONE function; `triggerFor`'s cheap
half is "five to nine off along some axis" and it returns `row`; a
hunter inside five backs off to five, never to nine; THE THREAT DISPLAY
frames the far row and tints the rest of the band (canvas-board
`THREAT_TINT`); the drop records the standing row — `enemyRow` on the
pending entry, the run's duel entry, `__DCK.walk.duel` and the log's
`world` block. MEASURED AFTER: charge-stress — nine sighted, nine
started with a wait after first sight, eight walking on (the ninth the
driver stuck behind the enemy's formation in a corridor), the dance
zero; hunt-stress unchanged (13/16 standing, 16/16 fleeing — from afar
the far row is still the nearest goal). Gates: test-enemy 80 (a walled
kings' line seen pawn to pawn, a blind pair behind a wall line, seven
off triggering at once with the player's initiative and the deal on the
far row, ten off not yet, four off backing to five, a charge from twelve
met at nine), test-barrier 160 (five rows per legal file, the far row
marked), ui-smoke 256 ok (the ambush through the pivot now six
ranks off, its row in the run and the log), selftest 46/46, replay-smoke
63, the other Node gates unchanged. THE PHONE VERDICT came the same day
(designer: "Alright seems to work a lot better") — in.

**THE WANDERERS (2026-09-11).** The verdict on the far-half build came
the same day — "Alright seems to work a lot better. Can we get some
wandering enemies?" — so every spawn now ROAMS by default (`enemy.mjs`
state `roam`, an enemy's `mode`; `?enemies=sentry` the old rule,
`?enemies=off` none). A wanderer walks ITS BEAT: `pickRoamTarget` draws a
waypoint — a floor cell its king can reach by the walk's own BFS (its
pieces pass; every other army, furniture, holes and walls block), within
`ROAM_LEASH` 12 cells of its spawn so the level telegraph stays where the
generator put it, at least `ROAM_MIN` 4 off so the walk is a walk and not
a shuffle, not under a piece — uniform by ONE draw from the enemy's own
seed numbered by its draw count (`roamDraw`, `roam.n`), so a run replays
from its inputs; it walks there on the hunt's own machinery (`approach`,
the king's own move where it is offered, the stall / pivot / rest), one
step per input like everything else, stands a PAUSE of `ROAM_PAUSE` 2–6
turns (drawn) and draws the next; a waypoint it cannot reach any more (a
comrade army in the corridor) is dropped for another. Sight is checked
after every move, so a wanderer that walks into view of your army is a
hunter at once — and its search, finding nobody at the last-seen cell,
goes back to the beat (`restState`). THE STRANGER RULE fell out of it
(army.mjs `enemyAt` / `landing`): two enemy armies share the lowercase
letters, and the walk read any same-side letter as a comrade to route
through — with one moving army that never bit; with two, a wanderer
would have walked through another and its stamp erased the other's
letters — so a same-side letter that is not one of THIS army's own pieces
is an obstacle now. The save carries `mode` and `roam` (`dck-run/4`);
the badges stay hunt `!` / search `?`; `enemyTurn` reports `paused` and
`target`. MEASURED: charge-stress `--roam` on vaults-2 — four charges at
wanderers, four sighted, four duels (median first sight ten cells off,
eight against sentries); hunt-stress unchanged, its enemies spawned as
sentries on purpose. Gates: test-enemy 100 (the default spawn a
wanderer, the beat within the leash with pauses and arrivals, the trail
replayed from the seed and through a save at turn 40, another seed
another beat, ten waypoints on bare floor, the search ending on the
beat, sight on the beat, two wanderers in one corridor never sharing a
cell), ui-smoke 270 ok (THE WANDERERS block: four roamers on the
fixture over thirty waits — kings off their spawns, no shared cell, the
letters whole, the leash kept, a second run of the same seed walking the
same beats; the enemies block on `?enemies=sentry`), the other gates
unchanged. Held over: patrol ROUTES as a list of cells in the world
file, a per-spawn mode, aggro between wanderers. (A standing rule from
the same day: the designer's "seems to work" includes the phone — no
separate phone verdict is asked for again.)


## The dungeon generator (Phase 2 milestone 5, 2026-09-08)

`js/dungeon.mjs`, pure and seeded: a floor from a seed, the same floor in
the game and in the harness. Built on the day of THE TRIGGER CONVERSATION
(CLAUDE.md § Phase 2 carries the four rulings), after the designer retired
both hand-built maps on a measurement — "just completely big blocks of
boring empty featureless rectangles"; "It's literally got 'dungeon
crawler' in the title, randomized dungeons are a requirement. Not just one
alg either, I need different floors to have unique styles and features and
themes" — so the milestone that was to be enemies became the generator,
and enemies, line of sight and the trigger are milestone 6 on the floors
it makes.

**THE BED IS THE SPEC.** A 10×10 window slid over every position of both
old maps and scored the way the 36 wave-6 arenas score: per 10×10 the bed
carries 3 / 7 / 13 separate wall-or-crate features (min / median / max),
31 / 43 / 58 floor cells touching terrain and a largest empty block of
12 / 19 / 40 cells; w01's busiest crop had 4 features and an empty block
of 42, and 6 of its 255 crops with enough floor to fight on reached the
PLAINEST arena on every count; w02 cleared it on 367 of 3403 by accident
of its packed rooms. A room is an empty block by definition: no
rooms-and-corridors dungeon crops to the bed, whose vocabulary is ROOM
RECIPES (§ "Stages" below — the nave with a colonnade, the cistern, the
cell block, the ossuary, the barrel aisles, the crate-blocked strongroom,
the gatehouse, the switchback of stubs, the throne room's dais, the
cave-in, the grotto, the cloister, the ruin).

**THE LINTS** are the bed's own envelope, measured, not guessed
(`LINT`; `test-dungeon.mjs` re-measures the bed and asserts the constants
are its minima and maxima, and that a plain room fails): NO BOX IS BORING
— for every floor cell, each of the four 10×10 boxes the trigger would
drop (`boxRect`, through barrier.mjs's one placement rule: THE BOX IS
CENTRED ON THE KING, four files to his left and five to his right, the
room's walls falling where they fall — the first cut slid the box to
keep the room's floor run inside it, and the designer's first log had
the army hugging the arena's edge: "why is the arena bounds not
centered around the armies? Every duel is off-center") that holds at
least 60 floor cells has a largest empty block of at most 40 and at least
3 separate features (the two measures that mean "empty featureless
rectangle"; the touching share is reported, not enforced — a mosaic box
straddles it); NO LONG NARROW WAY — the designer: "WHY NOT JUST NOT USE 2
WIDE HALLWAYS" — a floor cell is WIDE when no stone stands in its 3×3
(furniture does not narrow: a barrel aisle is not a hallway), passable
cells neither wide nor a king step from a wide cell are NARROW, and a
narrow pocket may not stretch farther than one arena's width in either
axis (the bed itself is full of SHORT 2-wide passages — the junction's
sliced hallway, the guard post's corridors, the cell block — so short is
the bed's measure; the rule forbids the crawlspace, two arenas' passages
chaining across a seam); REACHABLE — every passable cell from the start,
furniture passable (an army smashes through); DUELABLE GROUND — from a
seeded sample of floor cells at least one box deals legally for the kit,
checked by THE TRIGGER FUNCTION ITSELF (barrier.mjs `planBarrier`), so
the lint, the live check and the threat display stay one piece of code
(brief §5.3); the harness runs it (`gen-worlds.mjs --duel`), the game
does not. Nothing symmetric is by construction with the prefab skeleton.

**THE BUILD**: a SKELETON lays the bones, FIX-UPS make the lints true,
then the start and the spawns are placed. The first skeleton is THE
PREFAB GRID (style `vaults`, "The Vaults"): the 36 arenas themselves as
pieces (`pieceOf` off the loaded stages the game already holds), each
used once until the deck runs dry, in one of EIGHT orientations by seed
(four turns, mirrored or not), laid in reading order with the piece and
orientation whose seams meet the west and north neighbours best
(`seamScore`: floor meeting floor in runs of three to six is a passage,
a whole-edge merge scores low, a sealed seam lower) — every arena was
written as a plausible crop of a bigger dungeon with corridors leaving
by its edges — each piece WEATHERED by seed (zero to three edits in the
ruin vocabulary: a wall segment cracks into masonry or opens into a gap,
a crate appears against a wall, a crate goes; never on a door, never on
the piece's edge), and a one-cell wall ring around the whole (6×4 tiles
is 62×42). THE DESIGNER'S FIRST VERDICT on it (2026-09-09, a Firefox
log at walk turn 96): "this might work. A little incoherent, plus I'm
sure on replays people will start to notice the repeating patterns" —
the mirrors and the wear are the stopgap against the repeats; coherence
is the recipe skeletons' (next), since a mosaic of set pieces has no
floor plan. THE FIX-UPS, until the cheap lints hold: CONNECT (a
0-1 BFS tunnels from the smallest region to the nearest other through
the fewest walls, three wide — no seed tried has needed one), WIDEN (a
narrow pocket that stretches too far is cut at its middle: the stone in
one 3×3 goes, an alcove that makes the middle wide and splits the pocket
— the least cut that ends a crawlspace), DRESS (while a box is boring, a
pillar or a two-crate cluster drops into its largest empty block, a cell
in from the block's edge, seeded), round again; one round settles every
seed tried, at 9 to 24 cells widened and 0 to 7 features dropped per
fixture. THE START is a STAGING AREA — floor three wide from one row
behind the king to four ahead, so the kit stands molded on its slots and
its first steps move it as one — with a LEGAL BOX that way for the kit,
drawn by seed (the first drop on a fresh floor must deal — the smoke drops
at the start; a floor with no such area falls back to a wide cell with
four cells of run ahead). THE SPAWNS
(`SPAWN_WIDTHS`, the digits on the map): wide cells at least 14 steps
from the start and 8 apart, spread over the distance range, the nearest
with the smallest army (3, 3, 4, 5 for the style's four) — brief §8's
level telegraph, placed for milestone 6 to read. The style sets the
THEME (crypt for the vaults; `theme` overrides). The world file carries a
`gen` block (the pieces laid with their turns, the fix-up counts, the
spawns, the lint) — provenance for the log and the gallery.

**WHERE IT RUNS**: the setup screen's "New floor" (a style, a seed with
a die, a size — small 4×3, medium 6×4, large 8×6 — and the button) makes
a floor from the loaded stages and begins the run on it; `?gen=<style>
&seed=N&size=…` does the same at boot; `__DCK.walk.generate(opts)` for
drivers; a run's save holds its floor whole, so a resume never
regenerates. About half a second on a laptop for a medium floor, most of
it the density lint's 7 000 boxes. THE FIXTURES on the cards
(`play/worlds/`, written by `gen-worlds.mjs`) are floors this made at
fixed seeds — `vaults-1` … `vaults-3` at 62×42 and `vaults-4` at 92×62,
54 pieces with the deck reshuffled once — and `world-shots.mjs` renders
them whole for the designer's eye, THE GALLERY the styles are approved
from in batches as the arena waves were. The measured fixtures: every
passable cell reachable, narrow extent 10, boring boxes 0 of 5 500 to
14 000 dense, duelable ground on 100% of 80 sampled cells, no dead tile.

**GATES**: `test-dungeon.mjs` 92 (the bed's envelope re-measured and
asserted to be the constants, a plain room and an empty hall failing, a
2-wide passage thirty long as one narrow pocket, a sealed room
unreachable, three seeds replayed byte for byte, every lint holding,
the ring, each piece once, the start's legal box and run ahead, the
spawns' widths rising with distance and their spacing, the coverage, a
3×3 grid and a 7×6 grid that reshuffles the deck, the lint's box
agreeing with the game's on every box tried), `test-barrier.mjs` 109
(the placement rule, the box at every facing, the band, the reach mask
through a thin wall and a door, the gap floor, off-map walls, the run's
entry, the lenient walk-out), ui-smoke 248 ok (the walk and the barrier
blocks on `?gen=vaults&seed=1`: the first step moves all six, a wall
refuses, the drop at the start deals a 10×10 at gap ≥ 2, the reload
re-drops the seed, the walk-out, a second duel on a fresh run with a
hand-dug pit, a loss ending the run, the analyzer on the barrier log),
selftest 46/46, test-world 125, test-army 57, test-camera 80, test-debris
60, test-logreport 47.

**NOT HERE, ON PURPOSE**: the recipe skeletons (packed rooms for the keep
and the abbey, a maze of aisles for the cellars, a wide maze with caves
for the catacombs, heavy wear for the ruin) and the room, passage and
wear recipes they draw on; a signature set piece per floor; a symmetry
lint for them; the stairs down (Phase 3). Each style is a batch for the
designer's eye.

## Art themes (2026-09-03)

> **Read with the Layout note above (2026-09-07):** the LOOKS below — the
> packs, the palettes, the autotile cases, the skins and their variants,
> the double doors, the props, the piece sets and the designer's verdicts
> round by round — are canon and are what the canvas board paints, off the
> atlas. The MECHANICS below — `tiles.css` custom properties, `[data-theme]`
> cascades, cell classes as CSS selectors, `::before` tiers, measured row
> rectangles, the piece-grid gate — are the retired DOM board's, kept as
> the record of how each look was arrived at.

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
over the archived 58; the wave-6 bed sets `theme` by hand, 12 / 12 / 12
over the 36. Cosmetics only: a theme changes what the renderer paints,
never the grid, the deal or the gods.

The packs are NOT in the repo (their terms allow use in projects but not
redistribution of the packs; Catacombs is public domain). Only the tiles
the game uses are repacked by `phase0/harness/repack-tiles.mjs` from
`phase0/assets-src/<pack>/` (gitignored — download each pack from the
author's page named in `CREDITS.md` and drop the sheets there) into
`img/tileset.png` (one row per theme, one column per role — the
human-readable record of what was taken) + `img/tileset.json` (per-tile
provenance — the runtime's one source since 2026-09-07; `tiles.css`, the
same pixels as data URIs for the DOM board, retired with it) +
`CREDITS.md`. Without the packs on disk the tool READS BACK every theme's
tiles from the committed atlas (as it has read back a missing piece pack
since 2026-09-04), so the in-house `classic` row and new roles can be
regenerated anywhere; only a new pack tile needs the pack.
Every theme's floor is the same six bevelled flagstones from the Catacombs
brown set (the designer's verdict: the only floor tiles that look good) —
crypt wears them as drawn, hall and castle wear them RECOLOURED into their
own pack's floor tone (each pixel keeps its shading relative to the
flagstones' base colour and takes the target hue, so bevels, cracks and
grain survive). Each theme has its OWN door: the hall keeps pixel-poem's
timber leaf; neither Dungeon Gathering nor Catacombs draws a wooden door,
so the castle's is a portcullis drawn into Dungeon Gathering's own arched
doorway tile and the crypt's a barred gate in its stone (the OPEN doorway
is generated per theme — see the residue notes above). The castle's
crate is Dungeon Gathering's stone block. Each theme also carries its
cosmetic PROPS (torch, candle, cobweb, bones, skull, chain, banner —
pixel-poem's and Catacombs' own torch, candle and chain; the rest
borrowed from pixel-poem; the floor litter is repacked but no longer
scattered). A theme also provides the wall in all **47 autotile cases**,
the broken wall in **16 ruin cases** (`ruin-<mask>`, generated the same
way — see the renderer notes above), the god-made pit in **16 hole
cases** (`hole-<mask>`, round 13: the cell's `wm-<mask>` is the 4-bit
mask of its HOLE neighbours — the four sides are the whole story, a
diagonal floor square touches a pit only at a corner — and the tool draws
a ragged 1–3 px rim on every floor-facing side — its innermost pixel a
lip in the theme's edge colour, the rest floor showing through — the
pit's far wall in the wall's top colour shaded under a north rim, and
pit edge to edge toward another hole, so joined pits read as one; the
in-house set keeps its gradient pit, and the crumble fx ends on the
lone-pit case), and the door, crate, chest and barrel sprites (the packs'
rubble tile is still repacked, but since round 15 nothing reads it:
authored masonry paints as a cracked wall, and every theme generates its
own ruin cases). The repack tool also builds `img/pieces.png` (32-px
atlas cells, one row per set) and the `[data-pieces=…]` sprite variables
from the sheets in `assets-src/pixel-chess/`, `assets-src/nulltale/` and
`assets-src/deja-view/` — each set names the exact crop per piece,
trimmed and pasted bottom-centred into the set's box (its width × the
tallest piece).
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
borrows from another (every chest is pixel-poem's; castle's barrel is
Dungeon Gathering's vase, the crypt's a Catacombs urn) — and since round
15 (2026-09-04) that goes for FURNITURE too: pixel-poem is the only pack
that draws a table, a stool and a rack, so the hall wears them (and its own
barrel, which it had lacked — its barrels were the in-house sprite) and
castle and crypt wear the same three PALETTE-SWAPPED into their own stone
and timber (the theme's `tint` map: the sprite's fill is recoloured like
the flagstones, its dark outline left alone — `recolourFill`). The
designer's verdict on the in-house furniture: "I don't like the sprites you
authored, they look worse than the ones from the asset packs" — so no `^`
paints an in-house sprite under a theme any more; only the hole and the
crack are drawn in-house. The tool also runs WITHOUT the three chess packs
on disk: a missing piece pack's fitted sprites are read back from the
committed `img/pieces.png` (the atlas holds exactly the tiles it wrote), so
tile work needs only the three tile packs. **Round 16 (2026-09-05)**, the
designer going through the packs himself ("multiple chest options that
look better than the one you picked… ALL KINDS OF STUFF… an actual double
door"): a theme may now list SEVERAL crops for a furniture role —
`chest: [[…], […], […]]` — the first is the role's tile, the rest
`--sprite-<role>-N`, and every cell carries `sv1…sv5` by a stable hash of
its square (`SKIN_VARIANTS`, board-ui) with tiles.css mapping `svN` on a
skin to the theme's Nth sprite, the base as the fallback and a theme with
fewer wrapping around by alias — so a row of urns is five different urns
and a repaint never swaps one. The hall's chests are pixel-poem's three
(timber, iron-bound, small) and its tables two; the castle's crates are
Dungeon Gathering's three stone blocks; the crypt's crates and chests are
the Catacombs' own crates and low boxes (pixel-poem's grey chest is off the
crypt) and its barrels five Catacombs urns, purple and green. And DOUBLE
DOORS: two door skins side by side in a rank are ONE two-wide door — the
west leaf wears `door2-l`, the east `door2-r`, paired west to east so a run
of three is a double and a single, never when either is god-cracked, and a
vertical pair stayed two weak spots (until the camera, 2026-09-08: a
stack in a file pairs too — the same double seen from its side, two
edge-on doors north-up and a leaf pair once the camera turns; the halves
are dealt on the SCREEN, `door2-l` the leaf on the screen's left) —
painting `--sprite-door2-l` / `-r`:
pixel-poem draws the double (6,6)+(7,6); the castle's is its portcullis
dropped into the pack's two-wide arch (12,8)+(13,8) with the bars
continuing through the seam; the crypt's a generated two-wide barred gate;
every door SET carries its double too, and a theme or set without one falls
back to two leaves. **Round 17 (2026-09-05)**, seven points from the
designer: (1) crates and chests vary like the urns — hall crates are
pixel-poem's three boxes and its chests five (the sheet's three plus the
loose `box_1_1` / `mini_box_1_1` sprites, copied flat into `assets-src/
pixel-poem/`), castle chests four, crypt crates and low boxes four each
(all four Catacombs crate columns are distinct sprites); (2) + (3) every
furniture PROP is a 16×32 BOARD BOX (`placeProp`: trimmed to its pixels,
centred left–right; a prop that fits a cell sits CENTRED in the lower
cell, a taller one — the big urns are 20 px, cropped 16×32 with `tall` —
stands on the cell's bottom edge and rises into the cell north, which
paints behind it by DOM order as a tall piece does), and tiles.css gives
the sprite element the same 1×2-cell box on the board (`#board[data-
theme] .cell.furniture:not(.skin-door):not(.weak):not(.cracked)
.piece.neutral`; the options legend shows a prop's lower half); (4) the
double-door pair is AUTHORED — paired on the stage's skin grid, painted
only on a leaf that still stands — so a leaf keeps its half after its
partner is captured, burst or god-cracked instead of "suddenly becoming a
normal door"; (5) the castle's portcullis and the crypt's barred gate are
GONE ("the doors on Castle and Crypt suck"): every theme wears pixel-
poem's leaf and double, the castle's in a slate stain and the crypt's in
dark oak by `recolourHue` — the WOOD (saturated, non-dark pixels) takes
the target hue at its own brightness, the iron bands and the outline stay
— and the doorway posts follow (`doorPost`); the Doors option is the three
themes' leaves (`DOOR_SETS` hall / castle / crypt); (6) TABLE and CHAIR
are DROPPED ("no version of them ever has [looked good]") — `T` / `C`
stay in the stage files as authoring intent and `SKIN_CHARS` maps them
onto crate / chest until the category has art; the in-house SVGs and CSS
went with them. **Round 18 (2026-09-05)** — the designer marked the
in-use sheet with X's and the pack sheet with O's: OUT went the castle's
stone-block crates, the crypt's narrow crates and low boxes, the hall's
keg and the whole SHELF category (`S` paints as a crate now); IN came the
Catacombs' broken crates and its small, tiny and spilled urns. So: castle
crates are the Catacombs crates in slate; crypt keeps its two wide crates
and its wide low box, with pixel-poem's two chests in dark oak beside it;
hall barrels are Dungeon Gathering's vase (already the hall's orange) and
four Catacombs urns as terracotta, castle barrels the vase plus three
small urns as they are, crypt barrels all ten of its urns
(`SKIN_VARIANTS` 10); and a new skin, WRECKAGE (`W`) — the two broken
crates and five spilled urns, native on the crypt, timber / terracotta on
the hall, slate on the castle — on the seven squares whose notes say
broken, collapsed or spilled. The castle's doors are a cool WALNUT
(`#7d6455`; the slate was "too blue/grey"), its crates and wreckage kept
the slate until round 19. A tint may be `{ to, whole: true }`: a WHOLE-sprite tint —
every pixel but the near-black outline, normalised to the sprite's
brightest pixel at 1.25× the target — for the urns and shards, whose green
ones are saturated enough to be half-taken by the wood-only recolour and
whose broken crates blew their highlights out under dominant-colour
scaling. **Round 19 (2026-09-05) — the LID is the line.** "Chests need
to all have rounded tops like hall chest 3. What's even the difference
between chests and crates?" A CHEST has a domed lid, a CRATE is a flat
box, and every pack sprite sorted onto one side. Chests are pixel-poem's
closed domed chest and mini chest — the sheet's (4,8) and (5,8) — plus
their SQUAT poses (`chest_2` / `mini_chest_2`, copied flat into
`assets-src/pixel-poem/`), silver-bodied as drawn on the hall and castle,
dark oak on the crypt. Crates are the sheet's two orange boxes (3,8) and
(0,8), their squats (`box_2_4` / `mini_box_2_4`) and the Catacombs' three
slatted crates — timber on the hall, dark oak on the crypt, and WALNUT on
the castle like its door: the slate stain made a grey crate, and the
pack's grey boxes are out for the same reason ("let's not use silver/grey
on crates, looks too much like chests"). The trap that cost two previews:
every pixel-poem prop is a four-frame idle BOUNCE and only frame 3 is the
rest pose the static sheet carries ((4,8) / (5,8) are `chest_3` /
`mini_chest_3` pixel for pixel) — frame 1 LIFTS the lid (a clear row above
the chest's body, a pinched waist under the box's) and frame 2 stretches
it, so the loose `chest_1` / `box_2_1` frames the first cut shipped read
as "an open animation, or the lid is detached"; frame 4, the squat, keeps
the lid seated on a body a pixel wider and is the one extra silhouette.
`phase0/lib/png.mjs`
is the dependency-free codec the tool uses. The Options panel names the
three packs with links, and `CREDITS.md` carries the terms and a per-tile
provenance table.

**Round 20 (2026-09-11) — THE EDGE-ON DOOR.** The designer, after the
wanderers: "can we finally get a proper vertical door asset? The
placeholder looks like ass." Since the camera (milestone 3) a door whose
wall line ran up the screen had painted a GENERATED slab — the wall's
band with a four-column bar through it — and an opened north–south
doorway the east–west doorway tile turned a quarter, sixteen wide against
a twelve-wide band. THREE CUTS WENT BEFORE THE ASSET: a framed
eight-column leaf lying flat in the band between two post caps with
floor either side ("these aren't great"), a sheet of four alternatives
(the face-on leaf squeezed to the band, the same inset between the
band's bevels, a thicker slab, an arch), and a tall 16×32 leaf drawn to a
reference the designer sent — then THE DESIGNER DREW IT ("Use this one"):
`phase0/lib/inhouse/door-profile.png`, a 5×16 side-view door, one tile
tall, in pixel-poem's face-on leaf's exact colours — the lit body
(#bf704d) crossed by board rows in the plank timber (#895a45), the
outline (#25131a) down its left and along its foot, the hinges' two
irons (#adc1cf / #90919e) down the leftmost column. BUILT TO IT: (1) THE
LEAF is that file, committed, read by `inhouse.mjs profileDoor` and placed
at column `EDGE_LEAF_X` 5 of a 16×16 tile so it stands in the middle of
the wall band (columns 2–13); the repack tool emits it per theme
recoloured by the door tint SCALED AGAINST THE PLANK TIMBER
(`recolourHue` gained a `dominant` base — the lit body dominates the
sprite, and the histogram would otherwise have scaled the castle's and
the crypt's leaves darker than their face-on doors; the castle's body is
#a2816e over #7d6455 boards, the crypt's #77604e over #5c4a3c, the
face-on tiles' own values), and the classic set wears the same sprite
mapped into its own wood and iron (`CLASSIC_LEAF`); the hall's tile is
the file byte for byte and every theme's has the file's exact shape
(test-debris). (2) IT STANDS IN THE GAP IT IS: canvas-board `#wallMask`
treats a door standing edge-on, or an opened doorway whose walls stand
above and below it on the screen (`#gapUp`), as NOT SOLID for the wall
masks of the cells around it — classifyTerrain's world mask still counts
every door and doorway as solid so a line runs through a break, which is
right across the screen where a leaf fills its tile, and the exception
is taken in SCREEN space at paint time, recomputed from the neighbours'
kinds only for a wall with such a gap beside it — so the walls above and
below END with their own autotile end cases, the brick face on a south
end and the bevelled top on a north end, exactly as a wall ends at floor
anywhere. The door's own tile is floor, and the leaf is FURNITURE in the
tall pass (`#furnitureSprite` returns it for an edge-on door, a 16×16
sprite like the face-on leaf), standing from the north wall's face to the
south wall's edge, so a piece to its south stands in front of it, a
breach bursts it like any furniture and leaves the gap between the same
two wall ends, and a slide carries it; the door SET option swaps the
leaf (`atlas.mjs tileOf` routes `door-edge` like `door` and the double).
A stacked double is two leaves in a row between the two wall ends. TWO
CUTS WENT BEFORE THIS: the flat pass ran the wall band on under the leaf
(designer: "you can't just slap it on top of a wall, why do I see wall
in front of and behind the door?"), then generated CAPS — the
north–south post tiles `doorway-ns` / `-n` / `-s`, a lit row over a dark
row in the post material at the band's end — framed the door and the
opened doorway alike (designer: "these lazy ass door frames completely
abandon the wall autotiling. Shouldn't we be seeing the bricks?"); the
post tiles are gone from the atlas and the repack tool, and an opened
north–south doorway paints nothing of its own — its walls' end cases are
its frame. (3) THE EAST–WEST DOORWAY keeps round 11's generated posts
(`doorway` / `-8` / `-2`, for a doorway whose walls stand across the
screen); the same autotile-end treatment is one flag away if wanted.
The atlas grew ONE role (132 → 133, `door-edge`), appended after the
crack; every old tile is byte-identical. `camera-guard.mjs compare
--allow door` admits the door squares, the doorways they leave and every
square touching one (the walls whose ends changed). THE GUARD EARNED ITS KEEP on the tall cut: reporting the prop
height for every prop role of the classic row had floated the classic
crates a square north, and only the guard's mirror rows saw it (its
facing-0 rows drift after ply 0 on the pristine build — a pre-existing
gap, on record); test-debris now asserts every prop height, so a 16-tall
tile can never report the box again.

**Round 21 (2026-09-12) — TALL WALLS.** The designer, on the edge-on door:
"now the door doesn't look like it actually intersects with the wall to
the north at all… I want tall walls, walls that overlap the northern
tiles, just like the tall chess pieces do." TEN MOCK-UP ROUNDS off the
atlas and the packs (nothing in the repo until the build): (1) the first
cut's overlap — eight rows into the square north — "is the maximum", but
a roof that deep was "too much of the wall… roof, not the actual south
face"; (2) an 8-row roof strip over a 16-row face "is good, proportions
wise", the generated running-bond bricks "look too much like drawers",
"the vertical doors need to connect higher on the wall face", "the
ceiling above horizontal doors needs to go", "the horizontal doors should
move north a few pixels"; (3) "have a look at the original assets again,
these look so much better" — the packs' own faces, and their own roof art
where they had any: pixel-poem has none but a four-row ledge and a coping
stone, Dungeon Gathering a sixteen-wide slab, the Catacombs a seven-pixel
bevelled frame; (4) "3B is the only one that looks decent… the other
attempts look like a lost cause. Let's just focus on fixing 3B and make
palette swaps of it when we're done" — the crypt, with the face three
pixels off its seam and the floor showing under it (the designer's own
question the round before: "should wall faces be moved north a few
pixels, revealing some of the floor tile it's standing on?"); (5) the
vertical roofs, sampled off the pack's own vertical band with its two lit
lines and a groove colliding on our ten-pixel band, were "awful for no
reason. Like, just turn the horizontal ones sideways" — done: the strip's
outline and lit line down the band's west side, the outline down its
east; (6) the band's middle was then "flat and textureless" — the pack's
four cracked fill rows, whose marks run front to back across the strip,
STRETCHED over the band's seven fill columns so every mark crosses the
band as a rung; (7) a per-cell offset into the pack's band made those
marks "stop halfway, or have this other weird variation with one pixel
missing" — the strip is the pack's tile verbatim on every cell, and the
rungs align across cells; (8) "why do the roofs look incomplete? It looks
like you've trimmed out so much" — the raised face had cut the strip to
five rows; the pack's north band is worn WHOLE, outline, lit line, four
fill rows, inner outline, a row of fill, which with the three-pixel raise
puts the wall's top ELEVEN rows into the square north (past the "maximum"
of round 1 — the designer's pick over the seam-tight version); (9) "take
3 and get rid of the roof segments that show above horizontal doors";
(10) stray dashes on a vertical band's north end were the horizontal
band's own crack marks — a band's ends wear only the outline and lit
line, and its rungs run on through a T; "shift the doors down a couple
pixels and build it".

THE BUILD. `js/board-ui.mjs` carries the geometry: `WALL_BAND` (columns
3–12), `WALL_LIFT` 8 (the roof plane, one tile deep, shifted north),
`WALL_RAISE` 3 (the face off its seam), `WALL_SPRITE_H` 24, `DOOR_LIFT`
5 (a leaf, face-on or edge-on, two pixels above the face's foot),
`wallBody(mask)` (the shipped blob footprint of round 5: an east–west run
the width, a north–south run the band, corners, T's and crosses their
union, a thick block's inner corner only with its diagonal) and
`wallFaceCols(mask)` (the columns where the roof's body ends at the
square's south edge). The repack tool composes EVERY CASE FROM TWO
CATACOMBS TILES — the frame's north band (5,3) and the brick face (5,9)
— into a 16×24 sprite: rows 0–7 the roof's far half, rows 8–23 the face
in the face columns and the roof's near half where it runs on. The roof
is drawn by DEPTH from its open edges: a horizontal top wears the band's
rows on its far edge (outline, lit line, the four cracked fill rows, the
inner outline), the outline and lit line turned on its west end, the
outline on its east; a vertical band the same two down its west side,
the stretched rungs, the outline down its east, and its rungs run on
through a horizontal wall where it meets one; corners and ends by the
nearest edge. The RUIN is the same drawing with each joining wall's
ragged tongue (a flush pixel and up to two of fringe, hashed per pair of
rows), the face under a west or east tongue's south edge, six rows of it
as a low stump under a north tongue, nothing under a south tongue (the
wall's own roof is right below it); chips none, as before. The hall, the
castle and the classic set are EXACT PALETTE SWAPS of the crypt's tiles
(`WALL_SWAPS` names every colour of the crypt's drawing — the tool
refuses one it does not name); the classic row keeps its drawn props and
cracks and takes its walls and ruins from the crypt row, so they
regenerate without the pack. The doorway post tiles (`doorway`,
`doorway-8`, `doorway-2`) are gone: an opened doorway is a gap and the
walls beside it end with their own cases (`#gapUp` is any doorway).
`door-edge` is the designer's 5×16 leaf as drawn, one tile tall, in the
band's middle (`inhouse.mjs profileDoor`; the first build stretched it
to 27 rows — the second round, below, put it back).

THE CANVAS BOARD paints walls, cracked walls, weak spots and ruins in
THE TALL PASS, at the square's y − 11 — the roof over the feet of
whatever stands north, as a nearer head covers the piece behind it —
with the crack masked onto the face where there is one and onto the roof
where a band runs on (the crack is the tell that a wall is weakened; a
band mid-run has no face), the cracking flash over the whole sprite, the
whole sprite bursting on a breach, a ruin's stub with the square's
debris put back over its foot, a wall prop (torch / banner / chain) on
the face, and the residue and heat frames over the sprite; either leaf
at y − 5 — a door stands at its own square's depth, face-on or edge-on
(the edge-on leaf's head meets the far face's bottom, the near wall's
roof covers of its foot what it covers of anything); the options legend
shows the face under the roof's last rows. Gates green on the build:
`test-debris` 70 (the boxes, the classic row's own cases, the leaf's
exact shape and the hall's byte for byte, no doorway role), `strip-ruin-chips --check`
(reads the whole sprite, row 15 attached — a south tongue runs into the
neighbour's roof), selftest 46/46, ui-smoke 270 (a cracked band mid-run
wears its ink on the roof), facing-walk 108/108, replay-smoke 63,
test-camera 80, test-world 125, test-barrier 160, test-logreport 47,
canvas-grid `none` / `margin` 4/4 in Chromium; the camera guard's dump
self-check drifts from ply 2 exactly as on the build before (on record)
and a fresh baseline was dumped. The hall's, the castle's and the
classic set's palettes are first picks for the designer to retune.

THE SECOND ROUND, the same day. The designer, on two screenshots of the
build's walk screen: "Roofs on clusters of walls look kinda odd. Either
we should make it fade to black, or smooth it out. Also, vertical doors
look weird in several ways. They look like they connect all the way at
the top of the wall, unlike the forward facing doors. And it looks super
weird when you break the lower door of a double door set, there's no
visible side edge of the door like you'd expect." Two fixes, built the
same day. (1) A MASS FADES TO BLACK. The first build's `roofOf` drew
every cell by the same profiles, so a thick wall tiled the band and the
rungs over every interior cell — a lattice of ledges. The pack itself
never draws a thick wall's top: its frame is a bevelled RIM around a
BLACK VOID (the band, two rows of shade, then black), and that is what
a mass is now. `roofOf` takes `mass` (the cell has a diagonal set, so
it sits in a 2×2 block of walls) and, for a pixel that is thick both
ways (a run longer than a cell across AND along — a T of thin walls in
a mass cell keeps its band), lays the nearest RIM by depth from the
open edge: the far edge the band's seven rows; the near edge, over the
face, the band and its row of fill — exactly a thin wall's roof, so a
thin east–west wall joining a mass runs into its near or far rim
without a seam; the west and east edges exactly a thin vertical band,
ten columns (outline, lit line, the seven stretched rungs, outline —
lit on the west side as the thin band is, so a thin vertical wall
joining a mass continues into its side rim without a seam); the side
rims are cast on the roof MINUS the eight rows the face hides, so at
an inner corner of the void a side rim runs up to the face stub's top
instead of stopping a square short; a lone band entering from the
north runs its rungs over the far rim to the void, one leaving south
starts from the void and runs on; everything else is the pack's shade
for two rows under the far rim and then its black (`CRYPT.black`,
named per theme in `WALL_SWAPS` — the band's three black flecks, which
the first build's swaps folded into the outline colour, now swap to the
void's black on every theme, the one change to a thin tile outside the
crypt; every thin case is byte-identical to the first build in the
crypt's own colours; the shade became the ramp in the third round,
below). Ruins pass `mass` false and are untouched. (2) THE EDGE-ON LEAF IS ONE TILE AGAIN. The 27-row stretch
reached from the far face's top to behind the near roof, which read as
a door hung from the roof — "they look like they connect all the way at
the top of the wall" — and when the lower leaf of a stacked double
broke, the upper leaf's foot was the stretch's middle, no edge at all.
`door-edge` is the designer's 5×16 file as drawn (`inhouse.mjs
profileDoor`, `EDGE_LEAF_X` 5), a 16×16 tile like the face-on leaf,
drawn by the canvas board at `DOOR_LIFT` like the face-on leaf: its head
meets the far face's bottom (the face stands three pixels off its seam,
the leaf rises five, so they overlap by two — the leaf enters the wall),
its foot stands clear when the leaf below it is gone, and the near
wall's roof covers of it what it covers of anything standing there.
`edgeLeafRows`, `EDGE_LEAF_ROWS` and `EDGE_LEAF_H` are gone; test-debris
asserts the tile's height, the file's exact shape on every theme and the
hall's leaf byte for byte. The masses were judged on a scratch composer
laying wall grids off the atlas the way the board paints them (a 4×3
block, a 2-wide ring, an L of 2-wide walls, thin walls joining a 3×3
block on all four sides, per theme) beside the same grids off the first
build's atlas, and the doors on `s59`'s d8 and the g5–h5 double turned
east-up with its lower leaf opened, at a dpr-3 phone's k 6. Gates
green on the second round: `test-debris` 70, `strip-ruin-chips
--check`, selftest 46/46, ui-smoke 280, facing-walk 108/108,
replay-smoke 63, test-camera 80, test-world 125, test-logreport 47,
canvas-grid `none` / `margin` 4/4 in Chromium.

THE THIRD ROUND, the same day. The designer, on the second: "That's WAY
too low on the wall for the vertical door. And the roof darkness needs
to be on a gradient." (1) THE EDGE-ON LEAF CLIMBS THE WALL. At the
face-on lift its head sat a row under the far wall's face foot; the
27-row stretch had reached the face's top. `EDGE_DOOR_LIFT` 10
(`board-ui`, `WALL_LIFT + WALL_RAISE − 1`) puts the leaf's head seven
rows up the far wall's face and its foot on the very row the near
wall's roof begins (y + 5, where the near sprite starts at y − 11 of
its own square), so a door seen edge-on runs from mid-face to behind
the wall in front of it, with the foot's outline tucked under that
roof; a stacked double is one continuous strip (the lower leaf's head
meets the upper's foot), and a broken lower half leaves the upper
leaf's foot on the doorway's floor, ten rows above the square's front
edge. (2) THE VOID IS A RAMP. The pack's two rows of shade and flat
black read as a hole; the void now darkens by depth from the nearest
rim: `SHADES` 6 steps from a theme's outline to its black, one per
pixel (`shade1…6`, computed in the tool from each palette's own
outline and black so the swaps stay exact — the last step is the black
itself, the crypt's ramp #181614 → #070707); `roofOf` casts its rays to
`REACH` 33 (past every rim and the ramp — the old cap of 17 would have
clipped the near rim's depth to one step), measures the depth past
each rim (the far rim's seven rows, the near rim's sixteen from the
face, the side rims' ten) and takes the nearest; a band entering from
the north ends where the far rim would, and the ramp starts there as
it does beside it. A 2-wide wall's six-pixel void never reaches black;
a block's centre does within six pixels of every rim. Gates green on
the third round: test-debris 70, strip-ruin-chips, selftest 46/46, ui-smoke 313, facing-walk 108/108, replay-smoke 63, test-camera 80, test-world 125, test-logreport 47, canvas-grid `none` / `margin` 4/4 in Chromium.

THE PALETTE ROUND, the same day. The designer, on the third build: "We
need to re think the color palettes overall. 1. I think the roof and
walls should be a lot closer color wise. 2. Also, not a fan of the
purple floor or the grey castle floor. Both are too similar to the
piece set I like. 3. Also the wall faces have some overly dark lines in
the brick pattern. Makes it hard to see the cracks for weak walls." The
NullTale set is light blue-grey against wine red, and the hall's plum
and the castle's blue-grey floors sat right beside them. Candidate
sheets (a scratch composer laying a cracked wall, a block, both doors
and the NullTale kings and pawns per theme, off atlases the repack tool
built under `DCK_PALETTE` overrides) drew the rulings: "browns and tans
and dark greys for the floors. No moroons or greens or lite greys (like
my pieces). Also be sure that the walls don't blend too heavily with
the floors"; "what happened to the checkerboard pattern?" — nothing, it
is the 22% shade the board lays over every dark square at draw time,
which a raw-tile composite never shows, so the picks were re-rendered
on the live board; and then "Can I get an in-game color selector? 2
tones, for the floor and walls." BUILT: THE WALLS — `WALL_SWAPS` names
every set, the crypt included (the pack's own drawing is swapped like
the rest now): a roof's fill is its face's brick, its lit line the
brick lightened by a sixth toward white, its outline the mortar; the
mortar lines are lifted halfway to the brick so the black crack reads
on a weak wall's face. THE FLOORS — `FLOOR_BASES`, one base colour per
set, the six flagstones recoloured from the pack's stones by the ratio
rule (the pack-floor tints are gone): crypt #2c2c2f, hall #4a3629,
castle #2e2f33, classic #2a2a2e — the classic row carries the
flagstones now (its flat olive checker was a green; the flat colours
remain the fallback under a row without floors; `flagstones()` reads
the pack or, without it, the last atlas's classic or crypt row, and
the classic row's walls are read back too when the pack is off disk).
THE TONES — Options → Tones: two colour pickers, the floor's stone and
the walls' stone of the art set the board wears. `atlas.mjs setTones
(key, { floor, wall })` builds a tinted copy of the tileset with the
row's floor, wall and ruin tiles recoloured by the ratio rule from the
row's own base (`baseTones`: the first flagstone's dominant colour,
the east–west wall face's dominant brick), and every tile is served
from the copy, so the bevels, the mortar, the crack flecks, the void's
ramp and the debris sampler all follow; doors, props, cracks and pieces
are untouched. The board's `setTones` clears the cracked-wall
composites and repaints; the legend repaints. Saved per set
(`options.tones[key]`, key the theme or 'classic'), applied as the
picker drags, the hex beside each picker the number to report, reset
the set's own; `?floor=` / `?wall=` override for a shot, unsaved;
`__DCK.tones` get / set / reset / key / base. Known gap: debris chunks
cut before a tone change keep their sprite's old colours until they
are repainted. THE GATES: ui-smoke grew THE TONES block (the floor's
and the wall's signatures before / toned / after reset, measured with
the hint arrows OFF — the streaming probe kicked by the option change
above lands its arrows over the floor square at every depth, and the
block's first run read "before" and "after reset" under two depths'
arrows — the legend following, the save per set, the pickers' values,
reset restoring the set's own), and its breach-debris check now skips
a breached square the gods have since crumbled into a pit (debris
paints on floor only; one run's single breach, f9, collapsed two
quakes later). Gates green: test-debris 71, strip-ruin-chips, selftest 46/46, ui-smoke 251 ok, facing-walk 108/108, replay-smoke 63, test-camera 80, test-world 125, test-logreport 47, canvas-grid `none` / `margin` 4/4 in Chromium.

THE PICKER, the same day (designer, on the phone: "What the fuck are
these color options? I get one usable shade of brown and everything
else is unusably garish. Who tf wants bright yellow or fucking traffic
cone orange for the floor colors??? … This supposed to be a color
selector for a DUNGEON not a fucking CIRCUS TENT"). The first cut's
pickers were two `<input type="color">`, and on FIREFOX FOR ANDROID the
native colour dialog is a FIXED LIST OF NINE SWATCHES — red, orange,
yellow, green, blue, navy, purple, light grey, white, plus the current
colour — with no way to enter a colour at all. So the picker is IN THE
PAGE now, one implementation on every browser (main.mjs § THE TONE
PICKER, `#tone-picker` in index.html, the `.tone-*` rules in style.css):
the Tones row is two CHIPS, each showing its slot's colour and hex (the
number to report); a tap opens the picker on that slot, a second tap
closes it, `aria-pressed` marks the open one. The picker: a grid of 24
DUNGEON STONES (`TONE_SWATCHES` — a row of neutral-to-cool greys, a row
of warm greys into browns, a row of tans, umbers and olive stone: the
designer's "browns and tans and dark greys" ruling as swatches, the
one under the tone ringed), HUE / SATURATION / LIGHTNESS sliders
(`input type=range`, restyled; each track painted by `paintToneTracks`
in the colours it leads to — the hue ring at a saturation the eye can
read, since a dungeon stone's own would show as grey, saturation from
grey to full at the tone's lightness, lightness from black through the
tone to white) and a HEX field that takes a number with or without the
#. Every change goes through `setTone` and applies live — one apply per
task, on the last value, so a drag's dozens of inputs a second cost one
re-tint and one repaint each frame — and the picker keeps its own
H/S/L (`tonePicker.hsl`) while a slider is dragged: hex → H/S/L rounds,
and re-reading the tone would have moved the thumb under the finger.
`hexToHsl` / `hslToHex` are the conversions. `__DCK.tones` grew
`open(slot)`, `picker()` (slot, hsl, hidden), `swatches` and `hsl`.
ui-smoke's TONES block now drives the picker: the floor chip opens it
on #804020 (20° 60% 31%, 24 stones, painted tracks), a swatch sets the
tone with the chip, the ring and the hex following, a lightness input
moves the tone and repaints the floor with the slider keeping its own
number, a hex typed without the # lands with the sliders following,
reset returns the chips and the open picker to the base, the second tap
closes it. Gates green: ui-smoke 351 ok (one run before it died on an engine transport glue — `bestmove c4b5 ponder e7d8readyok` arrived as ONE line, so `isready` never saw its `readyok`; the re-run green; engine.mjs untouched, on record), the picker exercised by hand in Chromium at phone width (a swatch, a slider, reset); a page-only change, the Node gates and the replay page untouched.

## The debris layer (2026-09-07)

The floor remembers. Designer brief: "a universal debris system, so traces
of destruction can be seen everywhere" — blood for captured pieces, skid
marks under the gods' displacements, worn paths, splinter spray for every
kind of destruction, actual particle effects, all togglable, on the 16×16
grid, persisting after duels and ready for a 100×100 dungeon floor.

**The ledger** (`js/debris.mjs`, pure; Node gate
`phase0/harness/test-debris.mjs`). Six kinds of event: `smash` (a piece
captures terrain), `breach` / `crumble` / `weaken` (the gods), `kill` (a
piece captured) and `skid` (a displacement, from → to). Each is a few
numbers in ENVIRONMENT PIXEL SPACE — the base stage's own uncropped,
unflipped grid, sixteen pixels a square, y down from its top rank — with a
direction (away from the attacker; a god's edit bursts radially), the
epoch (the duel count on this floor) and ply it happened on, and the
sprite the broken thing was wearing (a role, a variant and a wall case,
never pixels: `spriteVar` names the CSS custom property). A duel
contributes through ONE transform, `envTransform(deal, stage)` — the
deal's flip, crop and king-anchored auto-crop — for squares, pixels and
direction vectors alike. Materials: stone (walls, masonry, weak spots),
wood (crates, chests, doors, wreckage), clay (barrels and urns), floor (a
crumble throws the floor's own pixels), blood.

**The painter.** `paintCell(ledger, ef, er, ctx)` writes the cell's 16×16
RGBA buffer: the wear scuff, then every event's chunks oldest first, each
chunk a small rectangle SAMPLED OFF THE ACTUAL SPRITE (plank pixels off the
crate that broke, the brick face off the wall, the glaze off the urn; the
material's palette when no sprite is decoded — the game's sampler reads
the property off the board and decodes it once per theme, warmed by
`applyTheme`), placed by a PRNG seeded
by the event alone, so the same ledger paints the same pixels after a
reload, a theme switch or a toggle. Stone is chunky and lands short; wood
flies far in slivers; clay in shards; big pieces near, flecks far. Blood is
a pool a little along the blow plus droplets and two far drips, red for
`DRY_PLIES` (20) plies and maroon after, or by the next duel. A skid is a
translucent scuff along the drag, denser and darker at the landing. Wear
is not events but a dense traffic grid — every move visits its landing
square and, for a straight move, the squares it passed over — with three
levels of translucent scuff (`WEAR_LEVELS` 6 / 16 / 40 visits). Growth is
bounded twice: `CELL_CAP` (12) events per cell bucket, the oldest evicted;
`PIXEL_CAP` (112) opaque pixels per cell, the oldest event dropping its
smallest chunks first. Debris settles with age: after an epoch the 1-px
flecks are gone, after three the 2-px chips; skids fade.

**The 16×16 rule.** The buffer becomes a deterministic PNG data URL
(`js/pngmini.mjs`, a store-only zlib PNG, no canvas) shown by the square's
own 16×16 debris IMAGE (board-ui `setDebris`: a plain `<img>`, the cell's
first child, under the sprites and the pieces, scaled to the cell exactly
like the floor tile — 100%×100%, pixelated), so a debris pixel is never a
different size or alignment from a floor pixel. A new image is decoded OFF
the DOM and only then swapped in over the old one, so no frame ever paints
without its debris. Three cuts went before it: a data URL swapped into the
cell's background stack (a background that changes to an undecoded image
paints a frame without it — Firefox blinked on every landing — and touching
the cell's style restyled the piece inside it), then a per-cell canvas
(which coincided with pieces vanishing for whole seconds on a desktop
Firefox while idle). An `<img>` is a decoded bitmap to every compositor.
Debris paints on FLOOR only (a wall neighbour swallows its share of a
spray; a smashed crate's square is floor from then on), so the one tile it
can cover is a ruin's stub — rubble on rubble.

**The flight** (`js/particles.mjs`). Debris does not appear, it flies: on a
~15-Hz pixel-art tick every live chunk is drawn as paths of 16-grid pixels
on a second SVG over the board (board-ui `flightSvg`, the arrow layer's
twin — above the pieces, below the FLIP clones; one path per colour, crisp
edges, no canvas anywhere on the board), from the thing that broke to the
exact pixels the painter lands them on — the painter decided first, so the
last frame of the flight IS the persistent debris. A chunk in the air passes
in front of a piece (the only place a board-wide layer can be without
giving the pieces a z-index); the landed debris is under it. With the
flight off, a rung's debris lands after the rung's own animation, never
before the wall has broken. A hop for
the arc, a bounce for stone and clay; the broken SPRITE SHATTERS into 2×2
blocks that fade in the air (`shatterOf`); a crumble's floor blocks fall
INTO the pit; a skid draws progressively under the sliding piece. A
capture's spray flies while the engine thinks (never awaited — the event is
`pending` until it lands, then its cells repaint through `setDebris`,
which touches nothing else on the cell); a shattering crate holds until
the piece arrives instead of dissolving, a captured piece still dissolves
under the blow; the gods' rungs fly inside their beats. Reduced motion,
`?fx=0` or the Particles toggle: the debris simply appears. One frame loop
serves every flight in the air: a flight is flying, then LANDED (its chunks
held on the flight layer, its `landed` promise resolved so the game can paint the
cells under them), then released the same tick — two loops clearing one
canvas had made overlapping flights flicker. No z-index on the pieces: an
intermediate cut stacked them over a board-wide flight layer with
`position: relative; z-index: 3`, which made Firefox drop every positioned
child of the cells — pieces, sprites, torches — for a frame during the quake
animations ("all the pieces will blink out of existence"; reproduced and
isolated in Playwright's Firefox). Never give the pieces a z-index. And no
canvas on the board: a per-cell canvas cut coincided with pieces vanishing
for whole seconds on a desktop Firefox while idle.

**Persistence rides the environment**, never the duel: main.mjs keeps one
ledger per stage in localStorage (`dck.debris.v1:<stage id>`), opened when
the stage is previewed (the preview shows its scars), ticked an epoch by
every `beginDuel` — Rematch included, it is the same dungeon — and saved
after every event, on undo, on end and on pagehide. When the 100×100 floor
arrives a stage becomes a window into it with one more offset; nothing
here is keyed to a duel. An undo forgets this epoch's events past the
rewound ply and recounts the traffic from the record's moves.

**Options → Debris**: splinters/shards/rubble, blood, skid marks, worn
paths, particles — each a checkbox — an amount slider (0–200%, scales the
chunk counts and the cap; its 100% is the designer's settled baseline —
what the first cut painted at 200%, `debris.mjs BASELINE` — and a setting
saved on the old scale is halved once on load), Clean this stage / Clean
every stage. Toggles
filter the PAINT, never the record, so a toggle flipped mid-game reveals
the whole history. `?debris=off|all|destruction,blood,skid,wear,fx` is the
test override; the board carries `data-debris` with the enabled kinds.
Test surface: `__DCK.debris` — `ledger`, `env`, `tx`, `options`,
`stats()`, `events()`, `cell(sq)` (env cell, events, traffic, wear, the
painted URL), `paint(sq)` (the raw buffer), `frames()`, `busy`,
`clean(all)`, `save()`.

**The ruin tiles lost their chips.** The stone flecks the ruin autotile used
to bake in are the debris layer's now (a breach scatters the wall's own
pixels, under the same dials as everything else): `RUIN.chips` is 0 in the
repack tool and the committed `img/tileset.png` was rewritten
by `phase0/harness/strip-ruin-chips.mjs` (isolated components of at most
two pixels; it refuses anything larger; `--check` is part of the Node gate).
The stubs, their faces and the open doorways are untouched.

Held for a second round: fallen wall props, bones, cobwebs on idle pieces,
torches that gutter with tedium, hole craters, the promotion kit, per-side
blood, and debris in the replay analyzer (the painter is pure, so it can).

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
`T` table · `C` chair · `S` shelf · `X` chest · `K` crate · `R` cracked
masonry · `.` default (crate). `R` paints as a WEAK SPOT — the wall block
wearing the crack, exactly like a god-weakened wall — since round 15
(2026-09-04: "why not just use a cracked wall?"); the rubble-heap sprite
it used to wear is retired to residue duty. Skins are cosmetics only (the same `^` to the engine,
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

**The wave-6 bed (s59–s94, 2026-09-04)** is thirty-six 10×10 arenas —
the designer's verdict on the 1.2.4 bed was that the small stages had
become useless and the big complex ones were the fun — hand-drawn under
three rules the generator inherits: (1) every arena is a plausible CROP
of a bigger dungeon, never a set piece fitted to the frame — rooms show
two or three walls with the rest off-frame, corridors enter on one edge
and leave by another, wall lines stop where the crop cut them; (2)
nothing is symmetric under a mirror or a 180° rotation (a scratch lint
rejected exact symmetry and flagged >80% agreement); (3) both king rows
keep floor near the centre files so no deal auto-crops, and every stage
dealt 15/15 in both orientations through `dealMatchup` before it was
shown. Skins and themes are hand-authored (gen-skins.mjs skips wave ≥ 6).
The design vocabulary, each with a stage: a hall corner (s59), a
T-junction with a hallway sliced lengthwise (s60), a cell block (s61),
an armoury behind barred doors (s62), a chapel nave with a colonnade
(s63), kitchens and larder (s64), a guard post on a corridor (s65), a
pillared cistern (s66), a gallery cut lengthwise (s67), a switchback of
wall stubs (s68), a breached curtain wall with a tower base (s69), a
strongroom with a crate-blocked door (s70), a stair core wrapped by its
passage (s71), barracks (s72), a ROUND tower wall two thick at the
steps (s73), a wine cellar of barrel aisles (s74), a cave-in you smash
through or bypass (s75), an ossuary with uneven alcoves (s76), a smithy
(s77), a scriptorium of shelf stacks (s78), a gatehouse wall two thick
with a portcullis pair and a postern (s79), a mess hall defined by its
tables (s80), a rock-cut dead-end warren (s81), a natural grotto (s82),
a throne room with a dais (s83), a diagonal fissure (s84), twin parallel
passages (s85), a crate warehouse (s86), stables (s87), a RUIN whose
walls decay into stone/cracked-masonry/gap runs (s88), an enfilade of rooms
(s89), a true four-way crossing with unequal quadrants (s90), an arcade
(s91), masonry giving way to cave (s92), a cloister garth (s93) and an
L-shaped tannery with an alley (s94). Rooms reachable only through a
door are legal (§4.6 smash-in) and were flagged in review: s59, s61,
s62, s73 and s79 keep theirs by design.

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
about half their old size, outlined, their width the Arrow width dial
and their opacity the Arrow opacity dial scaled lichess-style by how close
each move is to the best one; the evals are NOT on the arrows (they were,
until 2026-09-07 — "not worth keeping") but in the HINT LIST in the
player's bar under the board: a swatch in each rank's colour, the SAN,
the eval in bold, then the reached depth;
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
the depth reached (`1 Nf3 +0.8 · 2 e4 +0.6 · 3 d4 +0.5 · d14…`). `?probe=<go args>`
overrides it (E2E runs pass a short one next to `?go=`). Cancel hardening:
your move sends `stop` and waits ≤300 ms; a probe that never answers marks
the instance suspect and it is recycled before the reply search (measured:
a second `go` sent into an un-stopped search receives the FIRST search's
bestmove, which would desync the duel).

## The Gods v4 — memory, heat, protection (2026-09-05)

The designer's five complaints, each measured on the v3 corpora before
anything changed and turned into an invariant (`director.mjs` header has
the full record; `phase0/results/godlab/v4-findings.md` the numbers):

- **A quake spends the meter** (`meter.discharge`, `relief` knob; 0 = v3)
  and the meter is **capped at its ramp** — v3 fired every ply once pinned
  (wrathful's median gap was ONE ply) and banked a debt no aggression could
  repay. The late backstop floor counts plies **since the last quake**. No
  hard cooldown (designer: "too predictable").
- **Nothing is touched twice in one quake** — a `touched` set (every square
  edited or vacated, every piece moved) threads through the rungs; reason
  code `touched` in the census. No cross-quake memory, by design.
- **Heat** (`meter.heat`, `heatWindow`/`heatGain`): a ply is HOT if it
  captures, checks, promotes, pushes a pawn, OR creates a **new threat**
  (`tactics.mjs threatLedger` — a piece won by static exchange, a pin, a
  skewer, a fork, a mate threat; news ONCE per side per game,
  `threatMemory`). A hot record scales the fill of both meters down, so
  building an attack keeps the gods asleep and a pawn shuffle no longer
  outranks a rook lift.
- **Tedium** (`meter.t`, `tediumPlies`): the never-discharged twin of
  restlessness — the COLD SHARE of the last `tediumPlies` plies (no
  capture, check, pawn move or promotion; a threat is not progress), so a
  shuffle reads ~0.9 and a real fight ~0.5. Restlessness decides WHEN the
  gods act; tedium decides WHAT (`rungWeights`) and HOW MUCH (the budget
  draws open with the displacement rung). A discharging meter alone
  stalled the hole clock; a sated accumulator never rose on calm.
- **A threat or a check heats but does not sate**: the `sate` refund is
  reserved for the fifty-move rule's own list — capture, pawn move,
  promotion — and a repeated position is cold whatever the move was
  (check farms ran 600 plies with the meter never above 0.08). Ramps came
  down to match the slower fill (calm 26 / restless 14 / wrathful 6).
- **The dead-board backstop** (`tediumFloor`/`tediumDeadAt`/`coldStreak`):
  when the record has been dead for the whole tedium window AND nothing
  irreversible has happened for `coldStreak` plies, P(quake) has a floor
  (calm 0.25 / restless 0.35 / wrathful 0.5), undischarged, escalated by
  tedium — the gods hammer a board on which nothing is happening and back
  off the ply something does. This, not volume, closes fortresses (one
  10×10 fortress took 29 holes and was still open at the ply cap on the
  meter alone). The overlay flags it as `DEAD-BOARD floor`.
- **Protection** (`tactics.mjs protectedSet`, `protect`/`winDepth`/
  `winNodes`): on every quake, both sides' threat ledgers plus every
  **forced win** (win-in-1 exact for either side incl. the turn-flipped
  "trap is set" case; mate-in-2 by a node-budgeted checks-first search —
  never a clock, so replay holds) yield a set of pieces and squares the
  gods may not touch: no displacement of a protected piece, no landing on
  a protected square, no terrain edit or hole on one (reason code
  `protected`). The mating piece's PATH is in the set — the first cut
  protected a1 and a8 for Ra8# and a pawn scooted onto a3. Everything else
  stays fair game; symmetric, colour never enters. Known limit: the search
  sees win-in-1 exactly and mate-in-2 (quiet first moves only on boards
  with ≤32 legal moves, 12k-node budget); a mate-in-3, or a mate-in-2 by a
  quiet move on a wide-open board, is unprotected — and a WEAKEN can undo
  one (a cracked wall is a crate the mated king may capture to flee).

- **The engine's mate lines (v4.2)**: the "never consults the engine" rule
  is repealed for MATE and only for mate. When the quake roll passes the
  duel gathers mate lines — the enemy's fresh reply search, a fixed-depth
  probe of the board, and one of the turn-flipped "trap is set" board
  (`mateGo` `depth 12 movetime 600`; `?mateprobe=depth N movetime M` or
  `?mateprobe=off`) — and every principal variation is replayed on ffish
  into the protected set (movers, destinations, paths, the loser's king
  zone). The grid search stays as the exact win-in-1 check and the fallback
  for a failed probe (`winDepth` 0 = engine only). Each probe clears the
  hash first (a warm table from the reply search hid a mate in 3 from the
  probe), and while a mate line exists every wall or crate the losing side
  could capture is off limits to weaken, breach and crumble
  (`terrainReach`: a crack next to a net is a capture the defender spends
  on an escape). The trace line reads `engine N mate lines from 2 probes`.
- **The eval gate and the followed line (v4.3)**: the gods still never
  read an eval to CHOOSE, but every composition is judged by one before it
  lands — the duel probes the board a composition would leave (`mateGo`,
  hash cleared, same side to move) against the pre-quake probe
  (`tactics.mjs evalSoftens`: a decided position, ≥ 150 cp, may not soften
  by more than 200 cp, flip, or lose / delay / flip a mate; an undecided
  one may not be handed a ≥ 500 cp swing or a mate). A rejected draw rolls
  back in full (`director.snapshot()` / `restore()`; the RNG is excluded so
  the retry differs), a second draw is judged, then a lone weaken; if all
  three soften nothing lands, the trace reads `vetoed` and the meter is
  still spent. `evalGate` on the DuelController (`draws` 2, `?evalgate=off`).
  The trace line reads `eval gate ok (+3.1 → +2.8)` or `… on draw 2 after
  softened`; a vetoed ply gets its own warn line. And when the player plays
  the reply the enemy's deep search predicted, the rest of that PV is handed
  to the protection as `enemy-search-followed` — the enemy's own 22-ply
  reading of this very position, far past the probe's depth.
- **The ladder (v4.1)**: weaken leads (`weakenBias` 3), breach comes later
  and lighter (`breachBias` 1.2 from tedium 0.3) — a crack hands both
  players a wall to smash, a breach smashes it for them — and the crate
  brake counts only god-minted crates. The four rung biases are sliders in
  the debug panel (below).

`selftest.html` asserts all of it (six `v4` checks, incl. a forced win
surviving 24 seeded quakes while the unprotected control un-mates 8/8, an
engine line kept with the grid search off, and the eval gate's verdicts
and rollback);
`phase0/harness/godlab/gods-metrics.mjs` scores any corpus on the same
axes; `ladder-smoke.mjs` reports double-touches and next-ply quakes.
Phone verdicts: v4 on restless "feels okay, huge improvement" (2026-09-05);
v4.1–v4.3 "seem to play fine" (2026-09-06) — the v4 set is what ships.

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
- **The ladder sliders** (v4.1) — `weaken` / `breach` / `displace` /
  `crumble` rung biases (0–6), live on the running Director (logged as a
  dial) and persisted for new duels (`options.godLadder`; `defaults`
  clears it). Orthogonal to temperament. The forecast row's `ladder:` shares
  are the pure `rungWeights` at the board's current tedium, so a slider's
  effect is visible before the next quake.
- **The meters line** (v4) — fun, **heat** (with the last move's new threat
  keys), **tedium**, restlessness/ramp → pressure. Quake trace lines carry
  `meter a→b` (the discharge), heat, tedium and the **protected** census
  (pieces / squares, forced wins found per side, `search cut` if the
  node budget bound).
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
- **before / after** (2026-09-06, the replay log's in-game half) — paints
  the board as it stood BEFORE the last quake (the record's `preFen` with
  the previous ply's ledgers), non-interactive while it shows the past;
  `after` returns to now, as does any move, quake or undo. Player's turn only.
- **deep Δ** — probes the last quake's three boards (before the ply's
  move, before the quake, after it) at the ENEMY'S OWN limits (`duel.go`,
  up to 10 s each on the phone), hash cleared, in the idle window ahead of
  the shallow delta and the hint probe; the verdict lands on the
  `record.quakes` entry (`deepDelta`) and the trace panel in words — "the
  move LOST white's mate-in-10; the quake kept it" — the s75 lesson (a
  mate the depth-12 probe cannot see is settled only at the enemy's depth,
  and it was the player's move that lost it). One per quake, on demand;
  "Keep evaluating" holds the engine all turn, so the job then runs on the
  next one.
- **Export** (`copy log`, was `copy trace`) — the full REPLAY LOG as JSON
  to the clipboard: the deal provenance (stage id, flip, crop, army specs,
  master setup seed — everything a replay re-deals from), the Director
  seed, `config0` (the starting config a replay constructs with), the live
  config, tunes (undo drops a `{ply, undo: true, branch}` marker on the
  ledger, pointing at the branch that holds the abandoned line — see "The
  replay log" below), moves, per-ply states, the engine record, quakes +
  deltas, every roll trace, the rejected draws, undo branches, flags.
  `__DCK.gods.export()` and `__DCK.log.build()` return the same object; the
  Export buttons on the end overlay and in Options deliver it as a FILE.

Console/E2E surface: `window.__DCK.gods` — `traces`, `quakes`, `tunes`,
`probs()` (v4: also `heat`, `tedium`, `threats`), `forecast()`, `census()`,
`tune(partial)` (v4 dials: `relief`, `heatWindow`, `heatGain`,
`tediumPlies`, `threatMemory`, `winDepth`, `winNodes`), `export()`.

## The replay log (2026-09-06)

The instrument for "why did the gods do that?" — and for everything else a
post-mortem needs. Designer brief: a button to export a detailed replay/debug
log; **undos must be recorded**, with the exact board state right before each
one; and capture the whole board state every turn (it costs ~300 bytes a
ply). Every duel records itself, always; nothing here is gated on Cheater
Mode or the debug overlay.

**What is recorded** (`js/duel.mjs` `record`; every entry stamped `seq`, a
counter that never resets or rewinds — wall-clock order across undos, which
is also the Director's RNG order — and `at`, epoch ms):

- `moves` / `sans` — one per ply.
- `states` — the exact board after EVERY completed pipeline step
  (post-quake): fen, side to move, holes, god-minted crates, debt, the meters'
  readout. `states[0]` is the start position; a finished game adds an
  `ended` entry on the final board. A reader needs no chess library.
- `engine` — every reply search: mover-POV score, depth/seldepth/nodes, the
  pv, wall ms, the `go` used, and `recovered` when the stall ladder retried.
  The eval trajectory of the game.
- `quakeTraces` — the Director's roll trace every ply (Phase 1.2), now with
  `timing` (roll / mate probes / compose / gate probes / total, ms) and, on
  every due roll, `inputs`: the engine's mate hints VERBATIM (fen, score, pv,
  source), the probe census and the eval gate's baseline. The Director's
  decisions replay from the seed; the time-limited probes that fed them do
  not, so they are recorded rather than re-run. **The "why" layer
  (designer 2026-09-06: "trace their every action and why they did it")**:
  every trace carries the meters' INPUTS — `moveEv` (how the record meter
  classified the ply: capture / check / pawn push / promotion / repetition /
  threat), `threatKeys` (the new threat keys that made it hot) and `stale`
  (the staleness score's ingredients: legal moves, captures available,
  locked pawns, pieces, pawns); every rung a quake walked appends to
  `candidates` its whole POOL with scores (`weaken`: square, impact, open
  sides, locked file; `breach`: + pawns freed; `displace`: every tier's
  candidates, the tier drawn from, the pool; `crumble`: the bare-floor
  squares, the terminal squares), `chosen` (the pick's index into the pool)
  and `rejected` (every candidate passed over WITH its reason — `protected`,
  `touched`, `hangs_piece`, `unsafe_landing`, `exposes_king`, `walled_in`,
  `composite_landing`, …); and `protected` names its members (`pieceList`,
  `squareList`), the threat `keys` per side (`hang:e4`, `pin:…`, `fork:d5`,
  `win1`) and `by` source (ledger / grid wins / engine lines). The report
  prints each action as a ranked pool with the pick marked and the rejects
  grouped by reason.
- `quakes` — what landed, pre/post FEN, the overlay's `evalDelta`.
- `attempts` — every composition the v4.3 eval gate REJECTED, in full: its
  own trace, the board it would have left, its verdict. "What did the gods
  try first, and why not."
- `anomalies`, `log` (the duel-log lines the player saw, mirrored), `flags`
  (the ⚑ topbar button: ply, board, an optional note — "look at this").
- **`branches` — the undo history.** An undo MOVES the tail it cuts off into a
  branch instead of dropping it: every per-ply array's slice past the
  snapshot's lens (`RECORD_ARRAYS` is the ONE list the lens and the branch
  capture both read), plus `from`, the exact state the instant before the
  undo — board, ledgers, meters, and how the game had ended if it had.
  Branches are never truncated; an undo past an earlier fork keeps that
  fork's branch, and sorting by `seq` recovers the true order. The tunes
  ledger's `{ply, undo: true, fromPly, branch}` marker points at its branch.
- `tunes` — config history (dials, favor, undo markers), never truncated.

**The export** (`js/replaylog.mjs` `buildLog`, schema `dck-log/1`): the
record plus the deal provenance (stage, flip, crop, armies, master seed,
`variantIni`), the Director seed and `config0`, the engine limits (`go`,
`mateGo`, `evalGate`) and `meta` — the build stamp (`APP_BUILD` in
main.mjs, bumped by hand), UA, the engine's `id name`, the hint probe's
limits, the gods options in force. `deliverLog` gets it off the device: Web
Share as a FILE on a coarse-pointer device (Files, AirDrop, a message to
yourself), else a download, else the clipboard, else the console. The last
THREE duels are kept in a localStorage ring (`LogStore`), rewritten after
every ply, undo, flag, end and back-to-setup — a reload or a dead tab loses
nothing; the stage picker's **Saved replay logs** row exports them.

**Buttons:** ⚑ in the top bar (flag, in-duel); **Export log** on the
end-of-game overlay; Options → Replay log → **Export this duel's log** /
**Copy as text**; the debug panel's `copy log` (clipboard). Console/E2E:
`__DCK.log` — `build()`, `flag(note)`, `autosave()`, `saved()`,
`load(slot)`, `export(force)`.

**Reading one:** `cd phase0 && node harness/log-report.mjs <dck-log_*.json>
[header|timeline|quakes|branches|flags|anomalies|engine|log|all] [--ply N]
[--probe [go]] [--json path]` — a timeline with engine evals and quake
summaries, every quake's board before/after (`#` wall, `O` hole, `x`
god-cracked wall, `^` crate) with its ladder path, protected census, inputs,
gate verdict, rejected draws and timing, every undo with the pre-undo board
and the abandoned line, flags, anomalies. No engine, no ffish — except
`--probe`, which re-searches each quake's three boards (before the ply's
move, before the quake, after it) with the real engine (default `depth 22
movetime 20000`, hash cleared, the vendored pair overlaid into node_modules)
and says what the move and what the quake did: "the move LOST white's
mate-in-10; the quake kept it".

**The first false alarm, and the marks that catch it (s75, 2026-09-06):** a
mate-in-10 the enemy's own search had conceded was thrown away by the
player's next move, one ply before a quake that then got the blame — human
players cannot see a mate-in-11 and will throw them away all the time. So
every ply's state now carries `move` / `san` / `mover` and, for the player,
`predicted` (the enemy's predicted reply, pv[1] of a search whose pv[0] it
then played, no quake in between), `followed`, and `engineSaw` (that search's
score, enemy POV); the report marks `⚠ left the engine's mate-in-N line` on
the timeline and counts them in the header. The in-game half is the debug
panel's **before / after** and **deep Δ** (see the overlay section above).

**Gates:** `selftest.html` "replay log" (a live 5x6 duel against the real
engine: states, the engine record, inputs on every due roll, one undo → one
branch with the pre-undo fen and the abandoned tail, `seq` unique, the export
round-trips through JSON, the store rotates); `ui-smoke.mjs` asserts the
export on the live board and an undo through the real button path.

**Status (2026-09-06):** three logs in (s75 and s77 from Firefox/Windows,
s79 from the phone — Android Firefox, a flipped + cropped stage), all clean
on every structural check, no gods misbehaviour found; the one suspicion
was the player's own move (see above). The replay log is DONE for this
phase.

**The replay analyzer (2026-09-07)** — the log on the real board, on the
phone: `../replay/` (its own page next to this one; designer: "separate
from the play mode"). See `replay/README.md`. From here: **▶ Review** on
the end-of-game overlay opens the duel you just played there
(`../replay/?latest=1`), and **Open** on the setup screen's saved-logs row
opens a saved one (`?slot=N`); both just navigate — the analyzer reads
this page's autosave ring (same origin). The report's rendering now lives
in `js/logreport.mjs` and both the Node tool and the analyzer print it;
`board-ui.mjs` exports `classifyTerrain` (the one terrain rule setPosition
paints) and `residueStep` (paintBoard's doorway/rubble rule on data) for
it; `buildLog` records `autoCrop`. Still deferred: the offline replayer
that feeds the recorded inputs back into the Director and diffs, and
`gods-metrics.mjs` reading browser logs directly.
