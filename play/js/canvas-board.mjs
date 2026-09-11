// THE CANVAS BOARD — the 16×16 renderer (Phase 2 milestone 1, 2026-09-07;
// the ONE board since the DOM board's retirement the same day; A WINDOW
// OVER THE WORLD since milestone 4, 2026-09-08).
//
// Brief §2 item 5: every drawn thing is 16×16 pixel art on ONE native-
// resolution grid, composed in ONE buffer and scaled to the screen ONCE,
// by a whole number where the screen allows it. This class is that. Its
// method surface is the one the DOM board had (main.mjs and the replay
// page drive it; the selftest and the smokes read it):
//
//   THE WORLD   (milestone 4) the board's ONE model is a World (world.mjs):
//               a grid of cells with terrain, pieces, skins and the
//               Director's layers, any size. An ARENA is a CROP of it —
//               world.mjs's transform: an origin cell and the army's
//               facing — and every square-named call (setPosition, the
//               marks, the arrows, setDebris, the hit-test) crosses that
//               transform: setPosition WRITES the FEN and the ledgers into
//               the crop's cells, the painter reads the world. A board
//               constructed with `files` / `ranks` alone makes a bare world
//               of that size with the identity crop — the Phase 1 page,
//               where the world IS the arena — so every old caller paints
//               exactly what it did.
//   THE WINDOW  the buffer is a WINDOW of the world's screen grid (the
//               world under the camera's facing): with `viewport: 'crop'`
//               (the default — the Phase 1 page) exactly the crop's
//               rectangle, as it always was; with `viewport: 'screen'`
//               the screen's own size in tiles at k, a one-tile margin
//               each side, clipped to the world, centred on a FOCUS (the
//               crop's centre, or `lookAt` — the king on a walk), the
//               world outside the crop DIMMED. The buffer is repainted
//               whole on every change (about 600 cells at a phone's k 4
//               — no dirty rectangles until something needs them). A
//               square's buffer pixel is `#origin`: the world cell →
//               the screen tile (camera.mjs) → minus the window's corner.
//   THE BUFFER  an offscreen canvas at 16 px per tile — the window's
//               columns × 16 wide, its rows × 16 tall plus HEADROOM for the
//               top row's tall pieces — repainted from scratch on every
//               change in painter's order: floor (+ the dark square's
//               shade), the cell's DEBRIS (debris.mjs paintCell's 16×16
//               buffer, put straight in — no PNG, no <img>), terrain by
//               kind (board-ui classifyCell — the one terrain rule, run
//               lazily per world cell, shared with the replay analyzer),
//               the marks under the pieces, then row by row from the far
//               row to the near one the TALL things — furniture props
//               (16×32) and pieces (their sprite at its native size,
//               lifted and shifted by whole tile pixels) — so a nearer head
//               paints over the piece behind it, the dim over the world
//               outside the crop, then the marks over the pieces, the
//               crop's edge coordinates in a 3×5 pixel font, the debris
//               FLIGHT's pixels (particles.mjs, through drawFlight). A
//               piece in mid-slide paints in the tall pass by where its
//               feet are that frame (it painted last, over everything,
//               until 2026-09-10). Nothing in it has a fractional
//               coordinate: buffer coordinates are integers.
//   THE BLIT    one drawImage of the buffer (or the visible part of it)
//               onto the screen canvas at scale k, smoothing off. The
//               screen canvas is the container's full width; its backing
//               store is sized from ResizeObserver's DEVICE-PIXEL content
//               box, so canvas pixels and device pixels are one to one,
//               and k = ⌊device width ÷ (16 × the crop's columns)⌋
//               ('integer', the default — the board is centred in whole
//               device pixels) or the exact quotient ('fill' — the fallback
//               for a screen where the integer step is too small; uneven
//               pixel widths, every layer still aligned because they share
//               the one resample), or a fixed ZOOM (fit 'window', the walk:
//               `setZoom`, ± as cuts).
//   MOTION      a slide moves its sprite in whole native pixels per frame
//               (a piece never shimmers off-grid); a terrain rung's fx
//               (crack, burst, sink) is drawn in the buffer and its END
//               FRAME held until setPosition commits; the quake's rumble
//               jitters the blit offset in whole native pixels; the flight
//               is pixels in the buffer above the pieces. One
//               requestAnimationFrame loop while anything moves; nothing
//               otherwise.
//   ARROWS      the hint arrows, the enemy's last move and the gods'
//               displacements are PIXEL ART in the buffer (pixelarrow.mjs:
//               a shaft and head with a one-pixel halo, the width and
//               opacity the player's dials — setArrowStyle; no number on a
//               hint, the hint line lists the evals), drawn above the
//               pieces. No overlay element sits on the canvas at all (a
//               designer's white flash on the first build pointed at the
//               SVG overlay it then had; the diagnostics line main.mjs
//               shows comes from `renderInfo`).
//   INPUT       hit-testing by division: pointer → device px → buffer px →
//               tile → world cell → square (squareAtPoint — the inverse of
//               #origin; cellAtPoint for the world).
//   THE CAMERA  (Phase 2, the camera PR, 2026-09-08; play/js/camera.mjs is
//               the geometry) — FACING: which world direction points up
//               the screen (0 north, 1 east, 2 south — the old `flipped`
//               — 3 west; setFacing, a CUT). A quarter turn swaps the
//               screen grid's axes; every square, pixel and mark goes
//               through the one origin function; every direction-bearing
//               tile is generated from a mask, so the terrain's world-space
//               masks (classifyCell, the shared test surface) are PERMUTED
//               to the screen before the tile lookup — wall faces, ruin
//               stubs, pit rims and doorway posts follow the turn; a
//               cell's debris buffer (stored in WORLD orientation) turns by
//               index permutation; pieces and props never turn; the variant
//               hashes and the checker key on the WORLD CELL (so a crop or
//               a turn never reshuffles the floor; `hashCoords` overrides
//               them — the facing-walk gate's inverse map); a DOOR whose
//               wall line runs up the screen stands EDGE-ON (a generated
//               placeholder: the wall's band with the leaf as a thin slab
//               and a post above and below — brief §11 — until per-theme
//               art exists) and a double door's halves are dealt on the
//               screen. FIT: 'width' (the phone — k from the container's
//               width, the canvas as tall as the crop) or 'box' (the camera
//               owns the screen: the container's device box is the canvas,
//               k the largest step that fits the crop AND its headroom row
//               on both axes, the crop centred in whole device pixels; fill
//               is the exact quotient of the tighter axis) or 'window' (a
//               fixed zoom in the container's box — exploration).
//
// What it does NOT do (milestone 1, on purpose): the classic GLYPH pieces
// (a piece set is always drawn — the glyphs are text, not pixel art; the
// default set stands in), the % piece-fit dials (the tile grid is the only
// mode here: the art's own scale, lift and shift in whole tile pixels).
// The atlas is play/js/atlas.mjs.
import { WALL } from './fen.mjs';
import { classifyCell, pairDoors, decorFor, crackVariantIndex, skinVariantIndex, floorVariantIndex, PIECE_SETS, DOOR_SETS, DEFAULT_PIECE_FIT, TILE_LIFT_RANGE, TILE_SHIFT_RANGE } from './board-ui.mjs';
import { drawArrow, arrowColour, sortArrows, normalizeArrowStyle, arrowAlpha } from './pixelarrow.mjs';
import { Atlas, TILE } from './atlas.mjs';
import { drawText, textWidth } from './pixelfont.mjs';
import { normFacing, facingName, screenDims, toScreen, toWorld, pxToScreen, rotMask8, rotMask4, rotTile, doorHalf, edgeOn, coordEdges } from './camera.mjs';
import { World, identityTransform, cropTransform, arenaToWorld, worldToArena, arenaPxToEnv } from './world.mjs';

const T = TILE;
const EMPTY = new Set();
const FX_KINDS = { weaken: 'cracking', breach: 'breaching', crumble: 'crumbling', terminal: 'crumbling' };
/** The classic set's flat colours (style.css --cell-light / --cell-dark / --pit). */
const CLASSIC = { light: '#4a4a42', dark: '#3a3a33', pit: '#0a0a0e', pitLip: '#000000' };
const SHADE = 'rgba(0,0,0,0.22)'; // the dark square's checker shade under a theme (#00000038)
const DIM = 'rgba(0,0,0,0.55)'; // the world outside a duel's crop
const GODS = '#7cc8ff'; // style.css --gods
const GOLD = '#f2c14e'; // --gold
const BAD = '#e5484d'; // --bad
const TARGET = 'rgba(215,180,106,0.53)'; // .cell.target::after #d7b46a88
const THREAT = 'rgba(229,72,77,0.55)'; // the threat display's far-row cells (--bad at half)
const HEAT = { a: 'rgba(255,215,90,0.78)', b: 'rgba(108,195,255,0.59)', c: 'rgba(154,157,170,0.33)', t: 'rgba(255,90,90,0.78)' };
const COORD = 'rgba(255,255,255,0.4)';
const COORD_SHADOW = 'rgba(0,0,0,0.6)';
/** The wall's jitter in the weaken fx, six steps (style.css crack-jitter). */
const JITTER = [[0, 0], [-1, 1], [1, -1], [-1, 0], [1, 1], [0, 0]];
/** The rumble's blit jitter in native pixels by phase (style.css board-quake). */
const RUMBLE = [[0, 0], [-1, 0], [1, 0], [-1, 0], [1, 0], [0, 0]];
const NUDGE = [1, 2, 2, 1, 0]; // the wall bump's lean, in tile pixels, over its beat
/** The window's margin beyond the visible tiles (viewport 'screen'). */
const MARGIN = 1;

/** The set drawn when no piece set is chosen (the glyphs are text, not pixel art). */
export const DEFAULT_SET = 'nulltale';
/** Position-snap strategies (setSnapMode) and the default the gate settled
 *  (phase0/harness/canvas-grid.mjs, 2026-09-07): 'none' — the browser's
 *  own placement — measured exact in Firefox at every ratio and width,
 *  integer and fill, and in Chromium at ratio 1 (the only ratio its
 *  emulator can measure); 'margin' measured the same; 'transform' defeats
 *  Chromium's own snapping and is kept for the record. */
export const SNAP_MODES = ['none', 'margin', 'transform'];
export const DEFAULT_SNAP = 'none';
export const FITS = ['width', 'box', 'window'];
export const VIEWPORTS = ['crop', 'screen'];
export const ZOOM_RANGE = [1, 12];

const clampInt = (v, [lo, hi]) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : 0);
const wait = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const ease = (p) => 1 - (1 - p) ** 2.2; // ≈ the FLIP clone's cubic-bezier(.3,.8,.35,1)
const squareName = (f, rank) => String.fromCharCode(97 + f) + rank;

/** One atlas per page: loaded on the first board (the PNGs + the index; the
 *  in-house drawings are its classic row — nothing is read off the CSS). */
let atlasPromise = null;
export function loadAtlas() {
  if (!atlasPromise) atlasPromise = Atlas.load();
  return atlasPromise;
}
/** Test hook: forget the shared atlas (a page that swaps art). */
export function resetAtlas() {
  atlasPromise = null;
}

export class CanvasBoard {
  constructor(container, { files = null, ranks = null, world = null, crop = null, flipped = false, facing = null, fit = 'width', viewport = 'crop', zoom = 4, hashCoords = null, showCoords = true, onSquareTap = null, onCellTap = null, scaling = 'integer', atlas = null, onResize = null, arrowStyle = null } = {}) {
    this.container = container;
    this.onResize = onResize;
    // THE CAMERA: the facing (`flipped: true` is the old spelling of the
    // 180° turn), the fit, the viewport, the zoom, the world coordinates
    // the hashes key on (an override; the world cell by default) and
    // whether the edge coordinates are drawn.
    this.facing = normFacing(facing ?? (flipped ? 2 : 0));
    this.fit = FITS.includes(fit) ? fit : 'width';
    this.viewport = VIEWPORTS.includes(viewport) ? viewport : 'crop';
    this.zoom = clampInt(zoom, ZOOM_RANGE) || 4;
    this.boxMode = false; // the fit actually in force (a box needs a height)
    this.hashCoords = typeof hashCoords === 'function' ? hashCoords : null;
    this.showCoords = showCoords !== false;
    this.onSquareTap = onSquareTap;
    this.onCellTap = onCellTap;
    this.interactive = false;
    this.scaling = scaling === 'fill' ? 'fill' : 'integer';
    this.dimOutside = true; // the world beyond the crop is dimmed (a duel's dungeon)
    this.overscroll = 0; // native px the window may look past the world's edge (the walk's HUD-aware focus; #fitWindow)

    this.focus = null; // { x, y } in the rotated world's native pixels, or null = the crop's centre
    this.focusCell = null; // lookAt's cell + offset, re-projected on a turn
    this.atlas = null;
    this.ready = (atlas ? Promise.resolve(atlas) : loadAtlas()).then((a) => { this.atlas = a; this.#resize(); this.invalidate(); return a; });
    this.tileLift = DEFAULT_PIECE_FIT.tileLift;
    this.tileShift = DEFAULT_PIECE_FIT.tileShift;
    this.pieceBaked = Promise.resolve();
    // The board's state, all data: the world, the crop, what marks it wears.
    this.fen = null;
    this.marks = { selected: null, targets: EMPTY, check: null, pits: EMPTY, cracked: EMPTY, breached: EMPTY, heat: {} };
    this.cellMarks = { selected: null, targets: new Map(), threats: new Set(), badges: new Map() }; // the walk's (setCellMarks): a selection, its targets, THE THREAT DISPLAY (milestone 6: the far-row cells where a hunter's duel would start) and the badges over the enemy kings
    this.debrisBufs = new Map(); // cell index → 16×16 RGBA in WORLD orientation (the test surface: the buffer the cell wears)
    this.debrisCanvas = new Map(); // cell index → a 16×16 canvas of it, turned to the screen
    this.fx = new Map(); // sq → { kind, t0, ms, hold, done }
    this.slides = []; // { from, to, letter, t0, ms, fade, victimLetter }
    this.hidden = new Set(); // squares whose sprite is hidden (a shatter, a slide's source)
    this.hiddenCells = new Set(); // world cells whose sprite is hidden (an arrival in flight)
    this.cellSlides = []; // the walk's arrivals: { from, to, ch, t0, ms }
    this.pan = null; // the camera gliding: { from, to, t0, ms, cell }
    this.flight = null; // the flight's pixels this frame: [{ rgb, a, x, y }]
    this.rumbling = null; // { t0, ms }
    this.testPattern = false;
    this.paintWaiters = [];
    this.composites = new Map(); // cache: cracked tiles, piece shadows
    this.kindCache = new Map(); // cell index → classifyCell (cleared by setPosition)
    this.kindsView = null; // Map(square → kind) over the crop, built on demand
    // Geometry (device pixels): set by #resize.
    this.dpr = 1;
    this.devW = 0;
    this.devH = 0;
    this.k = 1;
    this.x0 = 0;
    this.y0 = 0;
    this.headroom = 0;
    this.win = { col0: 0, row0: 0, cols: 0, rows: 0 }; // the buffer's window on the screen grid
    this.cropBox = { col0: 0, row0: 0, cols: 0, rows: 0 }; // the crop's rectangle on the screen grid
    this.blitRect = { sx: 0, sy: 0, sw: 0, sh: 0, dx: 0, dy: 0 };
    this.raf = 0;
    this.loop = false;
    this.snapX = 0; // the correction that lands the canvas on a whole device pixel (#snap)
    this.snapY = 0;
    this.snapMode = DEFAULT_SNAP;

    container.classList.add('board', 'board-canvas');
    container.classList.toggle('inactive', true);
    container.textContent = '';
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'board-surface';
    this.canvas.setAttribute('aria-label', 'the board');
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d', { alpha: true });
    this.buf = document.createElement('canvas');
    this.bctx = this.buf.getContext('2d', { willReadFrequently: true });
    this.arrows = []; // the arrows drawn in the buffer, in draw order (pixelarrow.mjs)
    this.arrowStyle = normalizeArrowStyle(arrowStyle); // the width / opacity dials (setArrowStyle)
    this.scratch = document.createElement('canvas'); // an arrow's opaque pixels before its alpha lands
    this.canvas.addEventListener('click', (e) => this.#onClick(e));
    this.#setWorld(world ?? new World({ id: 'board', files: files ?? 8, ranks: ranks ?? 8 }), crop);
    this.#observe();
    this.#allocBuffer();
  }

  // ------------------------------------------------------------ the world

  /** Install a world and the crop the arena sits in (the identity of the
   *  world's size when none). Rebuilds the square table and the layout. */
  #setWorld(world, crop) {
    this.world = world;
    // `crop: false` — no arena at all (the walk); undefined / null the identity.
    this.crop = crop === false ? null : crop ?? identityTransform(world.files, world.ranks);
    this.files = this.crop ? this.crop.files : 0;
    this.ranks = this.crop ? this.crop.ranks : 0;
    this.container.style.setProperty('--files', this.files || world.files);
    this.container.style.setProperty('--ranks', this.ranks || world.ranks);
    // sq → { f, rank, cell: { f, r }, idx } for the crop's squares (.has / .get: the surface the callers read).
    this.cells = new Map();
    for (let rank = 1; rank <= this.ranks; rank++) {
      for (let f = 0; f < this.files; f++) {
        const cell = arenaToWorld(this.crop, f, rank - 1);
        this.cells.set(squareName(f, rank), { f, rank, cell, idx: cell && world.inBounds(cell.f, cell.r) ? world.idx(cell.f, cell.r) : -1 });
      }
    }
    this.ctxWorld = {
      files: world.files,
      ranks: world.ranks,
      cell: (f, rank) => world.cellView(f, rank - 1),
      key: (f, rank) => world.idx(f, rank - 1),
      pairs: new Map(),
    };
    this.#reclassify();
    this.#layout();
  }

  /** A new world (and crop) under a mounted board: the walk page's, or a
   *  duel's crop on a walk. The debris buffers are the world's — dropped. */
  setWorld(world, crop = null) {
    this.debrisBufs.clear();
    this.debrisCanvas.clear();
    this.fx.clear();
    this.hidden.clear();
    this.hiddenCells.clear();
    this.slides = [];
    this.cellSlides = [];
    this.pan = null;
    this.#setWorld(world, crop);
    this.#allocBuffer();
    this.#resize();
    this.invalidate();
  }

  /** The crop alone (the same world): where the arena sits and which way. */
  setCrop(crop) {
    this.#setWorld(this.world, crop === false ? false : crop ? cropTransform({ ...crop, worldFiles: this.world.files, worldRanks: this.world.ranks }) : null);
    this.#allocBuffer();
    this.#resize();
    this.invalidate();
  }

  /** Forget every cached classification (the world changed): the door
   *  pairs are re-read off the skin grid, the cells reclassify lazily. */
  #reclassify() {
    this.ctxWorld.pairs = pairDoors(this.ctxWorld);
    this.kindCache.clear();
    this.kindsView = null;
  }

  /** The kind of a world cell (board-ui classifyCell, cached), or null off the world. */
  #kindAt(f, r) {
    if (!this.world.inBounds(f, r)) return null;
    const i = this.world.idx(f, r);
    let k = this.kindCache.get(i);
    if (!k) {
      k = classifyCell(this.ctxWorld, f, r + 1);
      this.kindCache.set(i, k);
    }
    return k;
  }

  #kindOfSq(sq) {
    const c = this.cells.get(sq);
    return c && c.cell ? this.#kindAt(c.cell.f, c.cell.r) : null;
  }

  /** Map(square → kind) over the crop — the test surface (classifyTerrain's shape). */
  get kinds() {
    if (!this.kindsView) {
      this.kindsView = new Map();
      for (const [sq, c] of this.cells) if (c.cell) this.kindsView.set(sq, this.#kindAt(c.cell.f, c.cell.r));
    }
    return this.kindsView;
  }

  /** The world coordinates a cell's cosmetic hashes key on: the cell itself
   *  (file, 1-based rank), or the override's answer for its arena square. */
  #hc(cell, sq) {
    if (this.hashCoords && sq) {
      const c = this.cells.get(sq);
      return this.hashCoords(c.f, c.rank);
    }
    return [cell.f, cell.r + 1];
  }

  // ------------------------------------------------------------ geometry

  #observe() {
    if (typeof ResizeObserver === 'undefined') return;
    this.observer = new ResizeObserver((entries) => {
      const e = entries[0];
      const box = e?.devicePixelContentBoxSize?.[0];
      const css = e?.contentRect;
      // The CONTAINER is observed (the width the board may have); the canvas
      // is then given an explicit size in whole device pixels (#resize).
      // The device-pixel box is the truth on a real screen (a fractional
      // ratio's rounding is its job) — but under an EMULATED ratio (a
      // headless driver's deviceScaleFactor) Chromium reports it in CSS px,
      // a whole factor off; when it disagrees with CSS × ratio by more than
      // a pixel, the product is the better guess.
      if (box && css) {
        const dpr = window.devicePixelRatio || 1;
        const guessW = css.width * dpr, guessH = css.height * dpr;
        if (Math.abs(box.inlineSize - guessW) > 1.5 || Math.abs(box.blockSize - guessH) > 1.5) this.#resize({ w: Math.round(guessW), h: Math.round(guessH), emulated: true });
        else this.#resize({ w: box.inlineSize, h: box.blockSize });
      } else this.#resize();
    });
    try {
      this.observer.observe(this.container, { box: 'device-pixel-content-box' });
    } catch {
      this.observer.observe(this.container);
    }
  }

  /** The old spelling of the 180° turn. */
  get flipped() {
    return this.facing === 2;
  }
  /** The crop's screen grid in tiles: a quarter turn swaps the axes. */
  get screenCols() {
    return this.cropBox.cols;
  }
  get screenRows() {
    return this.cropBox.rows;
  }
  /** The crop's native size on the screen: cols×16 by rows×16. */
  get boardW() {
    return this.cropBox.cols * T;
  }
  get boardH() {
    return this.cropBox.rows * T;
  }
  /** The buffer: the window's tiles, plus the headroom on top. */
  get bufW() {
    return this.win.cols * T;
  }
  get bufH() {
    return this.win.rows * T + this.headroom;
  }
  /** The world's screen grid under the facing. */
  get worldCols() {
    return screenDims(this.world.files, this.world.ranks, this.facing).cols;
  }
  get worldRows() {
    return screenDims(this.world.files, this.world.ranks, this.facing).rows;
  }

  /** World cell → screen tile { col, row } under the facing. */
  #tileOf(f, r) {
    return toScreen(f, r + 1, this.world.files, this.world.ranks, this.facing);
  }

  /** Screen tile → world cell { f, r }, or null off the world. */
  #cellAt(col, row) {
    const w = toWorld(col, row, this.world.files, this.world.ranks, this.facing);
    return w ? { f: w.f, r: w.rank - 1 } : null;
  }

  /** The crop's rectangle on the screen grid: the bounding box of its four corners. */
  #layout() {
    const tx = this.crop ?? { wf: 0, wr: 0, w: this.world.files, h: this.world.ranks };
    const corners = [[tx.wf, tx.wr], [tx.wf + tx.w - 1, tx.wr], [tx.wf, tx.wr + tx.h - 1], [tx.wf + tx.w - 1, tx.wr + tx.h - 1]].map(([f, r]) => this.#tileOf(f, r));
    const col0 = Math.min(...corners.map((c) => c.col)), col1 = Math.max(...corners.map((c) => c.col));
    const row0 = Math.min(...corners.map((c) => c.row)), row1 = Math.max(...corners.map((c) => c.row));
    this.cropBox = { col0, row0, cols: col1 - col0 + 1, rows: row1 - row0 + 1 };
    if ((this.viewport === 'crop' && this.fit !== 'window') || !this.win.cols) this.win = { ...this.cropBox };
  }

  /** Headroom in native pixels: how far the tallest piece rises above the top row. */
  #headroomFor() {
    const box = this.atlas?.pieceBox(this.pieces);
    const fit = box ? box[1] : T;
    return Math.max(0, fit - T + this.tileLift);
  }

  #allocBuffer() {
    const h = this.#headroomFor();
    if (this.buf.width === this.bufW && this.headroom === h && this.buf.height === this.win.rows * T + h) return;
    this.headroom = h;
    this.buf.width = this.bufW;
    this.buf.height = this.bufH;
    this.bctx.imageSmoothingEnabled = false;
  }

  /** The focus in the rotated world's native pixels: `lookAt`'s, else the crop's centre. */
  #focusPx() {
    if (this.focus) return this.focus;
    const b = this.cropBox;
    return { x: (b.col0 + b.cols / 2) * T, y: (b.row0 + b.rows / 2) * T };
  }

  /**
   * Size the screen canvas from its DEVICE-pixel box: backing store = the
   * box (one canvas pixel per device pixel). FIT 'width': k from the
   * width, the CSS height set so the crop fits at k; the observer fires
   * again on the height change and this settles in one more step. FIT
   * 'box' (a container with a height to give — the camera owns the
   * screen): the canvas IS the box, k the largest step that fits the
   * crop and its headroom row on both axes, the crop centred in whole
   * device pixels on both; a box without a height falls back to 'width'.
   * FIT 'window': the canvas is the box and k is the zoom. Then THE
   * WINDOW: with viewport 'crop' the buffer is the crop's rectangle and
   * the blit is the whole buffer; with 'screen' (or fit 'window') the
   * buffer covers the visible tiles plus a margin, clipped to the world,
   * centred on the focus, and the blit is the visible part — per axis, a
   * world that fits the screen is centred whole.
   */
  #resize(box = null) {
    if (!this.canvas.isConnected) return;
    this.dpr = window.devicePixelRatio || 1;
    let w, h;
    this.emulated = !!box?.emulated;
    if (box) {
      w = Math.floor(box.w);
      h = Math.floor(box.h);
    } else {
      const r = this.container.getBoundingClientRect();
      w = Math.floor(r.width * this.dpr);
      h = Math.floor(r.height * this.dpr);
    }
    if (!(w > 0)) return;
    this.boxW = w;
    this.boxH = h;
    this.#fitWindow();
    this.#applyCanvasSize();
    this.invalidate();
    this.onResize?.(this.renderInfo);
  }

  /** The canvas's CSS size is its backing store in whole device pixels,
   *  stated explicitly (a 100% width is a fractional number of device
   *  pixels whenever the container's is, and a canvas drawn into a box a
   *  fraction wider than its bitmap is RESAMPLED — measured in both
   *  browsers, phase drifting a column in). A layout unit's rounding of
   *  this length (1/64 css px) is far under the half pixel that would
   *  move a nearest-neighbour sample. */
  #applyCanvasSize() {
    if (!(this.devW > 0)) return;
    const st = this.canvas.style;
    st.width = `${this.devW / this.dpr}px`;
    st.height = `${this.devH / this.dpr}px`;
    if (this.canvas.width !== this.devW || this.canvas.height !== this.devH) {
      this.canvas.width = this.devW;
      this.canvas.height = this.devH;
    }
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Test hook: the container's device box, given instead of measured (a
   *  detached board in the selftest), then the fit. */
  setBox(w, h) {
    this.boxW = Math.floor(w);
    this.boxH = Math.floor(h);
    this.dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    this.#fitWindow();
    this.#applyCanvasSize();
    this.invalidate();
    return this.renderInfo;
  }

  /** k, the canvas's device size, the window and the blit from the
   *  measured box (#resize) — also on a focus change alone (lookAt). */
  #fitWindow() {
    const w = this.boxW ?? 0, h = this.boxH ?? 0;
    if (!(w > 0)) return;
    this.headroom = this.#headroomFor();
    const cropW = this.boardW, cropH = this.boardH + this.headroom;
    const windowFit = (this.fit === 'window' || !this.crop) && h > 0;
    const boxMode = windowFit || (this.fit === 'box' && h >= cropH);
    this.boxMode = boxMode;
    let k;
    if (windowFit) k = this.zoom;
    else if (this.scaling === 'integer') k = boxMode ? Math.max(1, Math.min(Math.floor(w / cropW), Math.floor(h / cropH))) : Math.max(1, Math.floor(w / cropW));
    else k = boxMode ? Math.min(w / cropW, h / cropH) : w / cropW;
    this.k = k;
    this.devW = w;
    this.devH = boxMode ? h : Math.ceil(cropH * k);
    const cropOnly = this.viewport === 'crop' && !windowFit;
    if (cropOnly) {
      // The buffer IS the crop, blitted whole: the Phase 1 page.
      this.win = { ...this.cropBox };
      this.#allocBuffer();
      this.x0 = this.scaling === 'integer' || boxMode ? Math.floor((w - this.bufW * k) / 2) : 0;
      this.y0 = boxMode ? Math.floor((this.devH - this.bufH * k) / 2) : 0;
      this.blitRect = { sx: 0, sy: 0, sw: this.bufW, sh: this.bufH, dx: this.x0, dy: this.y0 };
      return;
    }
    // The window: the visible tiles at k plus a margin, clipped to the
    // world, centred on the focus — per axis; a world that fits the screen
    // on an axis is centred whole on it.
    const focus = this.#focusPx();
    const worldW = this.worldCols * T, worldH = this.worldRows * T;
    const centre = this.scaling === 'integer' || boxMode;
    const axis = (worldPx, devPx, focusPx, tiles, over = 0) => {
      const visible = Math.ceil(devPx / k);
      if (worldPx <= visible) return { t0: 0, n: tiles, s: 0, sw: worldPx, d: centre ? Math.floor((devPx - worldPx * k) / 2) : 0, fits: true };
      // OVERSCROLL (the walk's HUD-aware focus, 2026-09-08): the window may
      // look `over` native pixels past the world's FAR edge on this axis —
      // the screen's bottom — so a focus set above the screen's centre is
      // honoured at the map's edge too; the void it shows lies under the
      // HUD's controls. Off-world tiles paint nothing (#cellAt is null).
      const v0 = Math.max(0, Math.min(worldPx - visible + over, Math.round(focusPx - visible / 2)));
      const t0 = Math.max(0, Math.floor(v0 / T) - MARGIN);
      const t1 = Math.ceil((v0 + visible) / T) + MARGIN;
      return { t0, n: t1 - t0, s: v0 - t0 * T, sw: visible, d: 0, fits: false };
    };
    const ax = axis(worldW, this.devW, focus.x, this.worldCols);
    let ay;
    if (!boxMode) {
      // The width fit: the canvas is as tall as the crop; the window's rows are the crop's.
      ay = { t0: this.cropBox.row0, n: this.cropBox.rows, s: 0, sw: this.cropBox.rows * T + this.headroom, d: 0, fits: true };
    } else {
      ay = axis(worldH, this.devH, focus.y, this.worldRows, Math.max(0, this.overscroll | 0));
      if (ay.fits) {
        ay.sw = worldH + this.headroom;
        ay.d = Math.floor((this.devH - ay.sw * k) / 2);
      }
    }
    this.win = { col0: ax.t0, row0: ay.t0, cols: ax.n, rows: ay.n };
    this.#allocBuffer();
    this.x0 = ax.d;
    this.y0 = ay.d;
    this.blitRect = { sx: ax.s, sy: ay.fits ? 0 : this.headroom + ay.s, sw: ax.sw, sh: ay.sw, dx: ax.d, dy: ay.d };
  }

  /** Which renderer this is (the smokes read it; 'canvas' is the only one). */
  get kind() {
    return 'canvas';
  }

  /** What the screen shows, for the diagnostics line and the gates. */
  get renderInfo() {
    return {
      renderer: 'canvas',
      scaling: this.scaling,
      integer: this.scaling === 'integer',
      dpr: this.dpr,
      devW: this.devW,
      devH: this.devH,
      cssW: this.canvas.clientWidth,
      cssH: this.canvas.clientHeight,
      k: this.k,
      tilePx: T * this.k,
      x0: this.x0,
      y0: this.y0,
      headroom: this.headroom,
      bufW: this.bufW,
      bufH: this.bufH,
      files: this.files,
      ranks: this.ranks,
      facing: this.facing, // THE CAMERA: which world direction points up the screen
      facingName: facingName(this.facing),
      screenCols: this.screenCols,
      screenRows: this.screenRows,
      fit: this.fit === 'window' && this.boxMode ? 'window' : this.boxMode ? 'box' : 'width', // the fit in force (the option may ask for a box the container cannot give)
      fitAsked: this.fit,
      viewport: this.viewport,
      zoom: this.zoom,
      window: { ...this.win }, // the buffer's tiles on the world's screen grid
      crop: this.crop ? { ...this.cropBox, wf: this.crop.wf, wr: this.crop.wr, facing: this.crop.facing } : null,
      world: { files: this.world.files, ranks: this.world.ranks, cols: this.worldCols, rows: this.worldRows },
      blit: { ...this.blitRect },
      ready: !!this.atlas,
      emulated: !!this.emulated, // the device-pixel box disagreed with css × ratio (a driver's emulated ratio)
      snap: [this.snapX, this.snapY], // the sub-pixel correction that lands the canvas on the device grid
      snapMode: this.snapMode,
    };
  }

  /** One line for the screen: "canvas · dpr 2.625 · 1080 dev px · k 6 (integer) · 96 px/tile". */
  get diag() {
    const i = this.renderInfo;
    const kf = Number.isInteger(i.k) ? String(i.k) : i.k.toFixed(3);
    return `canvas · dpr ${+i.dpr.toFixed(3)} · ${i.devW}×${i.devH} device px · k ${kf} (${i.integer ? 'integer' : 'fill'}) · ${+(i.tilePx).toFixed(2)} px/tile · ${(i.tilePx / i.dpr).toFixed(1)} css px · ${i.facingName} up · fit ${i.fit}`;
  }

  /** Column / row-from-top of a square on the WORLD's screen grid (the camera's facing). */
  gridPos(sq) {
    const c = this.cells.get(sq);
    if (!c || !c.cell) return null;
    return this.#tileOf(c.cell.f, c.cell.r);
  }

  /** Buffer pixel of a screen tile's top-left. */
  #originOfTile(col, row) {
    return { x: (col - this.win.col0) * T, y: this.headroom + (row - this.win.row0) * T };
  }

  /** Buffer pixel of a square's top-left — THE origin: every painter and
   *  the hit-test go through here (CLAUDE.md § Phase 2, the camera): the
   *  world cell, its screen tile, minus the window's corner. */
  #origin(sq) {
    const t = this.gridPos(sq);
    return t ? this.#originOfTile(t.col, t.row) : { x: -T * 4, y: -T * 4 };
  }

  /** The arena square on a screen tile, or null (off the world, outside the crop). */
  #squareAt(col, row) {
    const c = this.#cellAt(col, row);
    if (!c || !this.crop) return null;
    const a = worldToArena(this.crop, c.f, c.r);
    return a ? squareName(a.f, a.r + 1) : null;
  }

  /** Client point → buffer pixel (the inverse of the blit), or null off the canvas. */
  #bufPointAt(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    if (!(r.width > 0) || !this.devW) return null;
    const b = this.blitRect;
    const cx = ((clientX - r.left) * this.devW) / r.width, cy = ((clientY - r.top) * this.devH) / r.height;
    return { x: b.sx + (cx - b.dx) / this.k, y: b.sy + (cy - b.dy) / this.k };
  }

  /** The world cell under a client point, or null. */
  cellAtPoint(clientX, clientY) {
    const p = this.#bufPointAt(clientX, clientY);
    if (!p) return null;
    const y = p.y - this.headroom;
    if (p.x < 0 || y < 0) return null;
    return this.#cellAt(this.win.col0 + Math.floor(p.x / T), this.win.row0 + Math.floor(y / T));
  }

  /** The square under a client point (the inverse of #origin), or null. */
  squareAtPoint(clientX, clientY) {
    const c = this.cellAtPoint(clientX, clientY);
    if (!c || !this.crop) return null;
    const a = worldToArena(this.crop, c.f, c.r);
    return a ? squareName(a.f, a.r + 1) : null;
  }

  /** The client point at the centre of a square (the test hook for the round trip). */
  pointOfSquare(sq) {
    if (!this.cells.has(sq)) return null;
    const { x, y } = this.#origin(sq);
    return this.#clientPoint(x + T / 2, y + T / 2);
  }

  /** The client point at the centre of a world cell. */
  pointOfCell(f, r) {
    if (!this.world.inBounds(f, r)) return null;
    const t = this.#tileOf(f, r);
    const { x, y } = this.#originOfTile(t.col, t.row);
    return this.#clientPoint(x + T / 2, y + T / 2);
  }

  #clientPoint(bx, by) {
    const r = this.canvas.getBoundingClientRect();
    const b = this.blitRect;
    return { x: r.left + ((b.dx + (bx - b.sx) * this.k) * r.width) / this.devW, y: r.top + ((b.dy + (by - b.sy) * this.k) * r.height) / this.devH };
  }

  #onClick(e) {
    if (!this.interactive) return;
    if (this.onSquareTap) {
      const sq = this.squareAtPoint(e.clientX, e.clientY);
      if (sq) this.onSquareTap(sq);
    }
    if (this.onCellTap) {
      const c = this.cellAtPoint(e.clientX, e.clientY);
      if (c) this.onCellTap(c.f, c.r);
    }
  }

  /** THE CAMERA's turn: which world direction points up the screen (0…3).
   *  A CUT: the buffer swaps its axes, the debris turns, k is refitted.
   *  Returns the facing in force. */
  setFacing(n) {
    const f = normFacing(n);
    if (f === this.facing) return f;
    this.facing = f;
    this.focus = this.focusCell ? this.#focusOf(this.focusCell) : null;
    this.#layout();
    this.#allocBuffer();
    for (const [i, buf] of this.debrisBufs) this.#putDebris(i, buf);
    this.#resize();
    this.invalidate();
    return f;
  }

  /** The fit ('width' / 'box' / 'window' — see #resize). */
  setFit(fit) {
    const f = FITS.includes(fit) ? fit : 'width';
    if (f === this.fit) return f;
    this.fit = f;
    this.#layout();
    this.#resize();
    this.invalidate();
    return f;
  }

  /** The viewport: 'crop' (the buffer is the crop) or 'screen' (the screen's tiles, the world around). */
  setViewport(v) {
    const vp = VIEWPORTS.includes(v) ? v : 'crop';
    if (vp === this.viewport) return vp;
    this.viewport = vp;
    this.#layout();
    this.#resize();
    this.invalidate();
    return vp;
  }

  /** The zoom for fit 'window': k in whole steps (a CUT). */
  setZoom(k) {
    const z = clampInt(k, ZOOM_RANGE) || this.zoom;
    if (z === this.zoom) return z;
    this.zoom = z;
    this.#resize();
    this.invalidate();
    return z;
  }

  /** The rotated-world pixel of a world cell's centre plus an offset in WORLD pixels (x right, y down). */
  #focusOf({ f, r, dx = 0, dy = 0 }) {
    const wx = f * T + T / 2 + dx, wy = (this.world.ranks - 1 - r) * T + T / 2 + dy;
    return pxToScreen(wx, wy, this.world.files * T, this.world.ranks * T, this.facing);
  }

  /** Centre the window on a world cell (plus an offset in world pixels —
   *  the world sliding under the king), or null for the crop's centre. */
  lookAt(f, r = null, dx = 0, dy = 0) {
    if (f === null) {
      this.focusCell = null;
      this.focus = null;
    } else {
      this.focusCell = { f, r, dx, dy };
      this.focus = this.#focusOf(this.focusCell);
    }
    this.#fitWindow();
    this.invalidate();
  }

  // ------------------------------------------------------------ state

  /** Render pieces + terrain from a FEN and the ledgers: written into the
   *  world through the crop, then the window repaints. */
  setPosition(fen, { holes = EMPTY, godCrates = EMPTY, skins = {}, opened = EMPTY, rubble = EMPTY, debris = null } = {}) {
    if (!this.crop) return; // no arena on a walk: the world is written by the army (refresh)
    this.fen = fen;
    this.world.writeArena(this.crop, fen, { holes, godCrates, opened, rubble, skins });
    this.#reclassify();
    this.fx.clear(); // a held end frame never outlives its edit
    this.hidden.clear(); // a flight's hide never outlives the paint
    for (const sq of this.cells.keys()) void this.setDebris(sq, debris ? debris(sq, this.#kindOfSq(sq)) : null);
    this.invalidate();
  }

  /** The world changed under the board (a walk's turn, an edit): reclassify and repaint. */
  refresh() {
    this.#reclassify();
    this.invalidate();
  }

  /** Cell-keyed marks for the walk: the selected cell and its targets [{ f, r,
   *  capture }]. (THE BOX's outline — a `frame` rectangle one pixel wide —
   *  was a mark here from 2026-09-09 until the designer's 2026-09-10 "get rid
   *  of the big blue square when I make chess moves during exploration".) */
  setCellMarks({ selected = null, targets = [], threats = [], badges = [] } = {}) {
    this.cellMarks = {
      selected: selected ? this.world.idx(selected.f, selected.r) : null,
      targets: new Map(targets.map((t) => [this.world.idx(t.f, t.r), t.capture ?? null])),
      threats: new Set(threats.map((c) => this.world.idx(c.f, c.r))),
      badges: new Map(badges.map((b) => [this.world.idx(b.f, b.r), { text: String(b.text ?? ''), color: b.color ?? BAD }])),
    };
    this.invalidate();
  }

  /** Replace ALL marks. */
  setMarks({ selected = null, targets = [], check = null, arrows = [], pit = null, pits = [], cracked = [], breached = [], heat = {} } = {}) {
    this.marks = {
      selected,
      targets: new Set(targets),
      check,
      pits: new Set(pit ? [pit, ...pits] : pits),
      cracked: new Set(cracked),
      breached: new Set(breached),
      heat: heat ?? {},
    };
    this.setArrows(arrows);
    this.invalidate();
  }

  /** The arrows to draw: kept in draw order and
   *  painted into the buffer above the pieces on the next frame. */
  setArrows(arrows) {
    this.arrows = sortArrows(arrows ?? []);
    this.invalidate();
  }
  /** The arrows' style — the shaft's width in floor pixels and the opacity
   *  (Options → Look; pixelarrow.mjs). Repaints the same arrows. */
  setArrowStyle(style) {
    this.arrowStyle = normalizeArrowStyle(style);
    this.invalidate();
  }

  /**
   * Show one square's debris: a 16×16 RGBA buffer (debris.mjs paintCell,
   * WORLD orientation) or null. Put straight into a per-cell canvas the
   * buffer composites; resolves once a frame has painted it.
   */
  async setDebris(sq, buf) {
    const c = this.cells.get(sq);
    if (!c || c.idx < 0) return;
    return this.setCellDebris(c.idx, buf);
  }

  /** The same by world cell index. */
  async setCellDebris(i, buf) {
    const had = this.debrisBufs.get(i) ?? null;
    if (!buf && !had) return;
    if (buf && had && buf.length === had.length && buf.every((v, j) => v === had[j])) return;
    if (!buf) {
      this.debrisBufs.delete(i);
      this.debrisCanvas.delete(i);
    } else {
      this.debrisBufs.set(i, buf);
      this.#putDebris(i, buf);
    }
    this.invalidate();
    await new Promise((r) => this.paintWaiters.push(r));
  }

  /** The cell's debris canvas from its world-space buffer, TURNED to the
   *  camera's facing by index permutation (the buffer itself stays in world
   *  space — the test surface). */
  #putDebris(i, buf) {
    let c = this.debrisCanvas.get(i);
    if (!c) {
      c = document.createElement('canvas');
      c.width = T;
      c.height = T;
      this.debrisCanvas.set(i, c);
    }
    const data = rotTile(buf instanceof Uint8ClampedArray ? buf : new Uint8ClampedArray(buf), this.facing, T);
    c.getContext('2d').putImageData(new ImageData(data, T, T), 0, 0);
  }

  debrisBuf(sq) {
    const c = this.cells.get(sq);
    return c && c.idx >= 0 ? this.debrisBufs.get(c.idx) ?? null : null;
  }

  /** The terrain rule's kind for a WORLD cell (the walk's smash reads what
   *  a crate wore before it broke). */
  kindAtCell(f, r) {
    return this.world.inBounds(f, r) ? this.#kindAt(f, r) : null;
  }


  hasDebris(sq) {
    const c = this.cells.get(sq);
    return !!c && c.idx >= 0 && this.debrisBufs.has(c.idx);
  }

  /** Hide a square's sprite until the next paint (the flight shatters it). */
  shatterSprite(sq) {
    this.hidden.add(sq);
    this.invalidate();
  }

  /** The flight's pixels this frame (particles.mjs): [{ rgb, a, x, y }] in
   *  arena pixels (x right, y down from the top rank), or null when the
   *  flight is over. Drawn above the pieces on the next frame. */
  drawFlight(pixels) {
    this.flight = pixels && pixels.length ? pixels : null;
    this.invalidate();
  }

  // ------------------------------------------------------------ art options

  setTheme(name) {
    if (name) this.container.dataset.theme = name;
    else delete this.container.dataset.theme;
    this.composites.clear();
    this.invalidate();
  }
  get theme() {
    return this.container.dataset.theme ?? null;
  }
  setPieces(name) {
    if (name && PIECE_SETS.includes(name)) this.container.dataset.pieces = name;
    else delete this.container.dataset.pieces;
    this.#allocBuffer();
    this.#resize();
    this.invalidate();
  }
  get pieces() {
    return this.container.dataset.pieces ?? null;
  }
  /** The set actually drawn: the chosen one, or the default for the glyphs. */
  get drawnSet() {
    return this.pieces ?? DEFAULT_SET;
  }
  setDoors(name) {
    if (name && DOOR_SETS.includes(name)) this.container.dataset.doors = name;
    else delete this.container.dataset.doors;
    this.invalidate();
  }
  get doors() {
    return this.container.dataset.doors ?? null;
  }
  /** The tile grid is the only mode here: `tileLift` / `tileShift` apply
   *  (whole tile pixels, clamped); the % dials and modes are ignored. */
  setPieceFit({ tileLift, tileShift } = {}) {
    this.tileLift = Number.isFinite(Number(tileLift)) ? clampInt(tileLift, TILE_LIFT_RANGE) : 0;
    this.tileShift = Number.isFinite(Number(tileShift)) ? clampInt(tileShift, TILE_SHIFT_RANGE) : 0;
    this.container.dataset.piecePixels = 'tile';
    this.#allocBuffer();
    this.#resize();
    this.invalidate();
  }
  get pieceFit() {
    return { scale: null, lift: null, shift: null, pixels: 'tile', snap: false, box: null, tileLift: this.tileLift, tileShift: this.tileShift, tiers: 0 };
  }
  get piecePixels() {
    return 'tile';
  }
  /** The classes this cell wears, by name — the shared test surface
   *  (selftest, ui-smoke, the replay page): terrain kinds and marks, from
   *  data (board-ui.mjs lists the names). */
  cellClasses(sq) {
    const c = this.cells.get(sq);
    if (!c || !c.cell) return null;
    const [hf, hr] = this.#hc(c.cell, sq);
    const out = ['cell', (hf + hr - 1) % 2 === 0 ? 'dark' : 'light', `f${floorVariantIndex(hf, hr)}`, `ck${crackVariantIndex(hf, hr)}`, `sv${skinVariantIndex(hf, hr)}`];
    const k = this.#kindAt(c.cell.f, c.cell.r);
    if (k) {
      if (k.wallTile) out.push('wall');
      if (k.hole) out.push('hole');
      if (k.furniture) out.push('furniture');
      if (k.cracked) out.push('cracked');
      if (k.skin) out.push(`skin-${k.skin}`);
      // The double door's halves and the edge-on stance are the SCREEN's
      // (the camera): door2-l is the leaf on the screen's left.
      const half = doorHalf(k.door2, this.facing);
      if (half) out.push(`door2-${half}`);
      if (k.skin === 'door' && edgeOn(k.doorLine, this.facing)) out.push('door-edge');
      if (k.weak) out.push('weak');
      if (k.ruin) out.push('ruin');
      if (k.mask >= 0) out.push(`wm-${k.mask}`);
    }
    const m = this.marks;
    if (m.selected === sq) out.push('sel');
    if (m.targets.has(sq)) out.push('target');
    if (m.check === sq) out.push('check');
    if (m.pits.has(sq)) out.push('fresh-pit');
    if (m.cracked.has(sq)) out.push('fresh-crack');
    if (m.breached.has(sq)) out.push('fresh-breach');
    const h = m.heat[sq];
    if (h) out.push(`heat-${h}`);
    const fx = this.fx.get(sq);
    if (fx) out.push(fx.kind);
    return out;
  }

  /** The decor a square wears (torch / banner / chain / doorway), or null —
   *  the DOM's .decor span, as data. A wall prop hangs on the face toward
   *  the viewer, so the mask is the SCREEN's (the camera); the scatter
   *  hash keys on the world cell. */
  decorOf(sq) {
    const c = this.cells.get(sq);
    if (!c || !c.cell) return null;
    return this.#decorOfCell(this.#kindAt(c.cell.f, c.cell.r), this.#hc(c.cell, sq));
  }

  #decorOfCell(k, [hf, hr]) {
    if (!k) return null;
    return decorFor({ wallTile: k.wallTile, cracked: k.cracked, mask: rotMask8(k.mask, this.facing), f: hf, rank: hr, earned: k.doorway ? 'doorway' : null });
  }

  setInteractive(enabled) {
    this.interactive = enabled;
    this.container.classList.toggle('inactive', !enabled);
  }

  destroy() {
    this.destroyed = true; // a repaint scheduled by a promise that lands later must find nothing to do
    this.observer?.disconnect();
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.container.textContent = '';
    this.container.classList.remove('board', 'board-canvas', 'inactive');
    this.cells.clear();
    this.debrisBufs.clear();
    this.debrisCanvas.clear();
    for (const r of this.paintWaiters.splice(0)) r();
  }

  // ------------------------------------------------------------ motion

  /** Terrain fx for one edited square: drawn in
   *  the buffer; with `hold` the end frame stays until setPosition. */
  async animateTerrain(square, kind, ms, { hold = false } = {}) {
    const cls = FX_KINDS[kind];
    if (!this.cells.has(square) || !cls || !ms) return;
    this.fx.set(square, { kind: cls, t0: now(), ms, hold, done: false });
    this.#run();
    await wait(ms);
    const f = this.fx.get(square);
    if (f && f.t0 + f.ms <= now() + 1) {
      if (!hold) this.fx.delete(square);
      else f.done = true;
    }
    this.invalidate();
  }

  animateCrumble(square, ms = 450) {
    return this.animateTerrain(square, 'crumble', ms);
  }

  /** Slide one piece from → to in whole native pixels; `fade` dissolves
   *  the destination's occupant (a capture). The buffer still holds the
   *  PRE-move position; the caller commits with setPosition after. */
  async animateSlide(from, to, { ms = 240, fade = false } = {}) {
    if (!ms || !this.cells.has(from) || !this.cells.has(to) || !this.fen) return;
    const letter = this.#letterAt(from);
    if (!letter || letter === WALL) return;
    const victim = fade ? this.#letterAt(to) : null;
    const s = { from, to, letter, t0: now(), ms, fade: !!victim && victim !== WALL };
    this.slides.push(s);
    this.hidden.add(from);
    this.#run();
    await wait(ms);
    this.slides = this.slides.filter((x) => x !== s);
    this.hidden.delete(from); // before the caller's setPosition
    this.invalidate();
  }

  async animateSlides(moves, { ms = 340, stagger = 120 } = {}) {
    if (!ms) return;
    await Promise.all(moves.map(async ({ from, to }, i) => {
      if (i && stagger) await wait(i * stagger);
      await this.animateSlide(from, to, { ms });
    }));
  }

  /**
   * THE WALK's motion (milestone 4b): the world already holds the pieces on
   * their NEW cells; each arrival slides from its old cell to the new one
   * in whole native pixels while the new cell's sprite is hidden. `moves`
   * = [{ from: { f, r }, to: { f, r }, ch }]. Resolves when they land.
   */
  async animateArrivals(moves, { ms = 200 } = {}) {
    if (!ms || !moves.length) return;
    const t0 = now();
    const list = moves.map((m) => ({ ...m, path: [m.from, ...(m.via ?? []), m.to], t0, ms }));
    this.cellSlides = [...(this.cellSlides ?? []), ...list];
    for (const m of list) this.hiddenCells.add(this.world.idx(m.to.f, m.to.r));
    this.#run();
    await wait(ms);
    this.cellSlides = this.cellSlides.filter((x) => !list.includes(x));
    for (const m of list) this.hiddenCells.delete(this.world.idx(m.to.f, m.to.r));
    this.invalidate();
  }

  /** Glide the focus to a world cell over `ms` (the world sliding under the
   *  king on a walk); 0 ms is a cut. Resolves when it lands. */
  async panTo(f, r, ms = 200, dx = 0, dy = 0) {
    const to = this.#focusOf({ f, r, dx, dy });
    if (!ms || !this.focus) {
      this.lookAt(f, r, dx, dy);
      return;
    }
    this.pan = { from: { ...this.focus }, to, t0: now(), ms, cell: { f, r, dx, dy } };
    this.#run();
    await wait(ms);
    this.pan = null;
    this.lookAt(f, r, dx, dy);
  }


  /** The quake's rumble: the blit jitters by whole native pixels for `ms`
   *  (main.mjs calls it on the quake's first beat). */
  rumble(ms) {
    if (!ms) return;
    this.rumbling = { t0: now(), ms };
    this.#run();
  }

  /** THE WALL BUMP (2026-09-09): the blit leans `dx`, `dy` (screen
   *  direction, −1 / 0 / 1) by up to two native pixels and comes back over
   *  `ms` — a refused step reads as the army bumping the wall. */
  nudge(dx, dy, ms) {
    if (!ms || (!dx && !dy)) return;
    this.nudging = { t0: now(), ms, dx: Math.sign(dx), dy: Math.sign(dy) };
    this.#run();
  }

  /** The FEN cell of a square: a piece letter, '*', '^' or null. */
  #letterAt(sq) {
    const c = this.cells.get(sq);
    return c && c.cell ? this.world.v(c.cell.f, c.cell.r) ?? null : null;
  }

  // ------------------------------------------------------------ the loop

  get animating() {
    const t = now();
    if (this.slides.length || this.flight || this.cellSlides.length || this.pan) return true;
    if (this.rumbling && t < this.rumbling.t0 + this.rumbling.ms) return true;
    if (this.nudging && t < this.nudging.t0 + this.nudging.ms) return true;
    for (const f of this.fx.values()) if (!f.done && t < f.t0 + f.ms) return true;
    return false;
  }

  /** Paint + blit on the next frame (coalesced). */
  invalidate() {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.#frame();
    });
  }

  /** Keep painting every frame while something moves. */
  #run() {
    this.loop = true;
    this.invalidate();
  }

  /**
   * Land the canvas element on a whole device pixel. Its layout position
   * is fractional in device pixels whenever the page above it is (a CSS
   * layout unit is 1/64 px, and × a ratio like 2.625 that is rarely
   * whole), and a canvas composited at a fractional offset is RESAMPLED —
   * nearest-neighbour, so one row of every block comes out a pixel short
   * (measured: at ratio 1.25 the first 4-px block was 3 rows tall). A
   * transform is a float, not a layout unit, so translating the element
   * by the negative residual puts its corner exactly on the grid. Measured
   * every frame (cheap: no layout is dirty at blit time) and rewritten
   * only when it moves.
   */
  #snap() {
    if (!this.canvas.isConnected || this.snapMode === 'none') return;
    const r = this.canvas.getBoundingClientRect();
    const dpr = this.dpr || 1;
    // The uncorrected corner: the rect minus what is already applied.
    const ux = r.left - this.snapX, uy = r.top - this.snapY;
    const rx = (ux * dpr) - Math.round(ux * dpr), ry = (uy * dpr) - Math.round(uy * dpr);
    const sx = -rx / dpr, sy = -ry / dpr;
    if (Math.abs(sx - this.snapX) < 1e-4 && Math.abs(sy - this.snapY) < 1e-4) return;
    this.snapX = sx;
    this.snapY = sy;
    const cs = this.canvas.style;
    if (this.snapMode === 'transform') {
      cs.transform = sx || sy ? `translate(${sx.toFixed(5)}px, ${sy.toFixed(5)}px)` : '';
    } else {
      // 'margin': a layout offset (quantised to a layout unit, 1/64 css px —
      // a residual under dpr/128 device px), which a browser that snaps
      // untransformed layers to the device grid then snaps the rest of the way.
      cs.marginLeft = `${sx.toFixed(5)}px`;
      cs.marginTop = `${sy.toFixed(5)}px`;
    }
  }

  /** The position-snap strategy: 'none' (the browser's own placement),
   *  'margin' (a layout offset onto the device grid) or 'transform' (a
   *  float translate onto it). The device-pixel gate measures all three;
   *  the default is what measured exact in both browsers. */
  setSnapMode(mode) {
    if (!SNAP_MODES.includes(mode)) return;
    const cs = this.canvas.style;
    cs.transform = ''; cs.marginLeft = ''; cs.marginTop = '';
    this.snapX = 0;
    this.snapY = 0;
    this.snapMode = mode;
    this.invalidate();
  }

  #frame() {
    if (this.destroyed) return;
    if (this.pan) {
      const u = Math.min(1, (now() - this.pan.t0) / this.pan.ms);
      const e = ease(u);
      this.focus = { x: Math.round(this.pan.from.x + (this.pan.to.x - this.pan.from.x) * e), y: Math.round(this.pan.from.y + (this.pan.to.y - this.pan.from.y) * e) };
      this.#fitWindow();
    }
    this.#snap();
    this.#paint();
    this.#blit();
    for (const r of this.paintWaiters.splice(0)) r();
    if (this.animating) this.invalidate();
    else if (this.rumbling || this.nudging) {
      this.rumbling = null;
      this.nudging = null;
      this.invalidate(); // one clean frame after the shake
    } else this.loop = false;
  }

  /** Is the buffer exactly the crop (the Phase 1 page's whole-board blit)? */
  get #cropIsWindow() {
    const w = this.win, c = this.cropBox;
    return w.col0 === c.col0 && w.row0 === c.row0 && w.cols === c.cols && w.rows === c.rows;
  }

  #blit() {
    const g = this.ctx;
    if (!this.devW) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    let jx = 0, jy = 0;
    if (this.rumbling) {
      const u = Math.min(1, (now() - this.rumbling.t0) / this.rumbling.ms);
      const [dx, dy] = RUMBLE[Math.min(RUMBLE.length - 1, Math.floor(u * RUMBLE.length))];
      jx = dx * Math.round(this.k);
      jy = dy * Math.round(this.k);
    } else if (this.nudging) {
      const u = Math.min(1, (now() - this.nudging.t0) / this.nudging.ms);
      const lean = NUDGE[Math.min(NUDGE.length - 1, Math.floor(u * NUDGE.length))];
      jx = this.nudging.dx * lean * Math.round(this.k);
      jy = this.nudging.dy * lean * Math.round(this.k);
    }
    const k = this.k;
    const b = this.blitRect;
    const x = b.dx + jx, y = b.dy + jy;
    // A frame of one tile pixel around the crop where the margin allows it.
    const fw = Math.max(1, Math.round(k));
    const cropX = x + ((this.cropBox.col0 - this.win.col0) * T - b.sx) * k;
    const cropY = y + (this.headroom + (this.cropBox.row0 - this.win.row0) * T - b.sy) * k;
    const cw = this.boardW * k, ch = this.boardH * k;
    g.fillStyle = '#000';
    if (!this.crop) {
      g.drawImage(this.buf, b.sx, b.sy, b.sw, b.sh, x, y, b.sw * k, b.sh * k);
    } else if (this.#cropIsWindow) {
      // The buffer is the crop: the frame under it, showing at its rim.
      g.fillRect(cropX - fw, cropY - fw, cw + 2 * fw, ch + 2 * fw);
      g.drawImage(this.buf, b.sx, b.sy, b.sw, b.sh, x, y, b.sw * k, b.sh * k);
    } else {
      g.drawImage(this.buf, b.sx, b.sy, b.sw, b.sh, x, y, b.sw * k, b.sh * k);
      if (this.dimOutside && this.crop) {
        // The world shows around the crop: the frame over it, as a ring.
        g.fillRect(cropX - fw, cropY - fw, cw + 2 * fw, fw);
        g.fillRect(cropX - fw, cropY + ch, cw + 2 * fw, fw);
        g.fillRect(cropX - fw, cropY, fw, ch);
        g.fillRect(cropX + cw, cropY, fw, ch);
      }
    }
  }

  // ------------------------------------------------------------ painting

  /** A drawImage of an atlas rectangle at buffer (x, y), optional size. */
  #draw(tile, x, y, w = tile?.w, h = tile?.h) {
    if (!tile) return;
    this.bctx.drawImage(tile.src, tile.sx, tile.sy, tile.w, tile.h, x, y, w, h);
  }

  /** A theme's tile for a role (or the classic set's), honouring the door set. */
  #tile(role) {
    return this.atlas?.tileOf(this.theme, role, { doors: this.doors }) ?? null;
  }

  /** The wall case a square's stone wears (classic: the one block). */
  #wallTile(mask) {
    return this.#tile(this.theme ? `wall-${mask}` : 'wall');
  }

  /** A cracked wall: the wall case with the crack drawing masked to the
   *  wall's own pixels (style.css masks the crack with the wall tile). Cached. */
  #crackedTile(mask, ck) {
    const key = `crack|${this.theme ?? ''}|${mask}|${ck}`;
    let c = this.composites.get(key);
    if (c) return c;
    const wall = this.#wallTile(mask);
    const crack = this.atlas?.crack(ck);
    if (!wall) return null;
    const cv = document.createElement('canvas');
    cv.width = T;
    cv.height = T;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(wall.src, wall.sx, wall.sy, T, T, 0, 0, T, T);
    if (crack) {
      g.globalCompositeOperation = 'source-atop';
      g.drawImage(crack.src, crack.sx, crack.sy, crack.w, crack.h, 0, 0, T, T);
      g.globalCompositeOperation = 'source-over';
    }
    c = { src: cv, sx: 0, sy: 0, w: T, h: T };
    this.composites.set(key, c);
    return c;
  }

  /** A piece's one-tile-pixel shadow: its silhouette at 67% black. Cached. */
  #shadowOf(set, fen, sprite) {
    const key = `shadow|${set}|${fen}`;
    let c = this.composites.get(key);
    if (c) return c;
    const cv = document.createElement('canvas');
    cv.width = sprite.w;
    cv.height = sprite.h;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(sprite.src, sprite.sx, sprite.sy, sprite.w, sprite.h, 0, 0, sprite.w, sprite.h);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = 'rgba(0,0,0,0.667)';
    g.fillRect(0, 0, sprite.w, sprite.h);
    c = { src: cv, sx: 0, sy: 0, w: sprite.w, h: sprite.h };
    this.composites.set(key, c);
    return c;
  }

  /** The furniture sprite a cell shows: the door leaf / its half of a
   *  double ON THE SCREEN (the camera deals the halves), a prop (crate /
   *  chest / barrel / wreckage, by the cell's variant), or the crate for
   *  an unskinned '^'. { tile, prop } — a prop is 16×32. An edge-on door
   *  has no sprite here: it is flat terrain (#edgeDoorTile). */
  #furnitureSprite(k, [hf, hr]) {
    if (k.skin === 'door') {
      const half = doorHalf(k.door2, this.facing);
      return { tile: this.#tile(half ? `door2-${half}` : 'door'), prop: false };
    }
    const role = k.skin && k.skin !== 'masonry' ? k.skin : 'crate';
    const v = skinVariantIndex(hf, hr);
    const tile = this.#tile(v > 1 ? `${role}-${v}` : role) ?? this.#tile(role) ?? this.#tile('crate');
    return { tile, prop: !!tile && tile.h === 2 * T };
  }

  /** Is this door edge-on under the camera's facing? */
  #edgeOn(k) {
    return k.skin === 'door' && edgeOn(k.doorLine, this.facing);
  }

  /** The half of a double door a square's leaf paints ON THE SCREEN ('l' /
   *  'r'), or null — a single leaf, an edge-on pair, no door. */
  doorHalfOf(sq) {
    const k = this.#kindOfSq(sq);
    return k && k.skin === 'door' ? doorHalf(k.door2, this.facing) : null;
  }

  /** Is the door on this square edge-on under the camera? */
  edgeOnAt(sq) {
    const k = this.#kindOfSq(sq);
    return !!k && this.#edgeOn(k);
  }

  /** The pixels of an atlas tile (for the composites), or null. */
  #pixelsOf(tile) {
    return tile ? Atlas.pixelsOf(tile) : null;
  }

  /** The two colours a leaf / a post is made of: the brightest and the
   *  darkest opaque pixel of a tile's middle. */
  static #tones(px, x0 = 4, y0 = 4, w = 8, h = 8) {
    if (!px) return null;
    let lit = null, dark = null, hi = -1, lo = 1e9;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const o = (y * px.w + x) * 4;
      if (px.data[o + 3] < 200) continue;
      const l = px.data[o] * 3 + px.data[o + 1] * 6 + px.data[o + 2];
      if (l > hi) { hi = l; lit = `rgb(${px.data[o]},${px.data[o + 1]},${px.data[o + 2]})`; }
      if (l < lo) { lo = l; dark = `rgb(${px.data[o]},${px.data[o + 1]},${px.data[o + 2]})`; }
    }
    return lit && dark ? { lit, dark } : null;
  }

  /**
   * THE EDGE-ON DOOR (brief §11, a GENERATED placeholder until per-theme
   * art exists): the wall case the door stands in (its band, as the wall
   * line runs up the screen), a gap cut through its middle holding the
   * leaf as a thin vertical slab in the leaf's own two tones (the door
   * set's leaf, so the option follows), and a POST above and below in the
   * doorway's post tones (the theme's doorway tile; the leaf's tones when
   * a set has no doorway — the classic row). `mask` is the SCREEN mask.
   * Cached per theme / door set / mask.
   */
  #edgeDoorTile(mask) {
    const key = `edge|${this.theme ?? ''}|${this.doors ?? ''}|${mask}`;
    let c = this.composites.get(key);
    if (c) return c;
    const wall = this.#wallTile(mask);
    if (!wall) return null;
    const cv = document.createElement('canvas');
    cv.width = T;
    cv.height = T;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(wall.src, wall.sx, wall.sy, T, T, 0, 0, T, T);
    const leaf = CanvasBoard.#tones(this.#pixelsOf(this.#tile('door'))) ?? { lit: '#bf704d', dark: '#895a45' };
    const post = CanvasBoard.#tones(this.#pixelsOf(this.#tile('doorway')), 0, 0, 2, 16) ?? leaf;
    // The slab: four columns through the band, dark edges, lit planks.
    g.fillStyle = leaf.dark;
    g.fillRect(6, 1, 1, 14);
    g.fillRect(9, 1, 1, 14);
    g.fillStyle = leaf.lit;
    g.fillRect(7, 1, 2, 14);
    // A plank seam every fourth row, so it reads as a leaf, not a bar.
    g.fillStyle = leaf.dark;
    for (let y = 4; y < 15; y += 4) g.fillRect(7, y, 2, 1);
    // The posts: a cap above and below, two rows each, lit over dark.
    g.fillStyle = post.lit;
    g.fillRect(5, 0, 6, 1);
    g.fillRect(5, 14, 6, 1);
    g.fillStyle = post.dark;
    g.fillRect(5, 1, 6, 1);
    g.fillRect(5, 15, 6, 1);
    c = { src: cv, sx: 0, sy: 0, w: T, h: T };
    this.composites.set(key, c);
    return c;
  }

  /**
   * The OPEN DOORWAY's posts for a SCREEN mask of standing walls (N=1 E=2
   * S=4 W=8): the theme's east / west post tiles as they are, and for a
   * wall standing north or south the same tiles TURNED a quarter (the
   * doorway tile is flat generated art — two full-height posts — so its
   * quarter turn is the north–south post pair, brief §11). Mixed cases
   * overlay both. Cached per theme / mask; null when the theme has no
   * doorway (the classic row).
   */
  #doorwayTile(mask) {
    if (!this.theme) return null;
    const key = `doorway|${this.theme}|${mask}`;
    let c = this.composites.get(key);
    if (c !== undefined) return c;
    const ew = mask & 10, ns = mask & 5;
    const ewTile = ew === 10 ? this.#tile('doorway') : ew === 8 ? this.#tile('doorway-8') : ew === 2 ? this.#tile('doorway-2') : null;
    // A quarter turn (camera facing 1) sends the west post to the south
    // edge and the east post to the north edge.
    const nsSrc = ns === 5 ? this.#tile('doorway') : ns === 4 ? this.#tile('doorway-8') : ns === 1 ? this.#tile('doorway-2') : null;
    if (!ewTile && !nsSrc) {
      this.composites.set(key, null);
      return null;
    }
    const cv = document.createElement('canvas');
    cv.width = T;
    cv.height = T;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    if (ewTile) g.drawImage(ewTile.src, ewTile.sx, ewTile.sy, T, T, 0, 0, T, T);
    if (nsSrc) {
      const px = this.#pixelsOf(nsSrc);
      if (px) {
        const turned = rotTile(px.data, 1, T);
        const tmp = document.createElement('canvas');
        tmp.width = T;
        tmp.height = T;
        tmp.getContext('2d').putImageData(new ImageData(turned, T, T), 0, 0);
        g.drawImage(tmp, 0, 0);
      }
    }
    c = { src: cv, sx: 0, sy: 0, w: T, h: T };
    this.composites.set(key, c);
    return c;
  }

  #frame1(x, y, fill, inset = 0) {
    const g = this.bctx;
    g.fillStyle = fill;
    g.fillRect(x + inset, y + inset, T - 2 * inset, 1);
    g.fillRect(x + inset, y + T - 1 - inset, T - 2 * inset, 1);
    g.fillRect(x + inset, y + inset + 1, 1, T - 2 - 2 * inset);
    g.fillRect(x + T - 1 - inset, y + inset + 1, 1, T - 2 - 2 * inset);
  }

  /** Is a world cell inside the crop? */
  #inCrop(f, r) {
    return !!this.crop && worldToArena(this.crop, f, r) !== null;
  }

  #paint() {
    const g = this.bctx;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.bufW, this.bufH);
    if (this.testPattern) return this.#paintTestPattern();
    if (!this.atlas) return;
    const theme = this.theme;
    const t = now();
    const H = this.headroom;
    const { col0, row0, cols, rows } = this.win;
    // The window's cells: each one's rectangle, its kind, its square (null
    // outside the crop) and its hash coordinates, in rendered (screen)
    // order, bucketed by screen row for the tall pass.
    const byRow = [];
    let outside = 0;
    for (let row = 0; row < rows; row++) {
      const list = [];
      for (let col = 0; col < cols; col++) {
        const cell = this.#cellAt(col0 + col, row0 + row);
        if (!cell) continue;
        const a = this.crop ? worldToArena(this.crop, cell.f, cell.r) : null;
        const sq = a ? squareName(a.f, a.r + 1) : null;
        if (!sq && this.crop) outside++;
        list.push({ sq, cell, idx: this.world.idx(cell.f, cell.r), x: col * T, y: H + row * T, k: this.#kindAt(cell.f, cell.r), row, h: this.#hc(cell, sq) });
      }
      byRow.push(list);
    }
    // 1. floor + shade + debris + flat terrain + marks under the pieces —
    // and the world beyond the crop DIMMED here, under the tall pass, so
    // the heads of the crop's top rank (the enemy's back rank on a barrier
    // duel) rise into the dungeon undimmed.
    const dim = outside && this.dimOutside;
    for (const list of byRow) for (const s of list) {
      this.#paintFlat(s, theme, t);
      if (dim && !s.sq) {
        g.fillStyle = DIM;
        g.fillRect(s.x, s.y, T, T);
      }
    }
    // 2. the tall things, far row first: props and pieces interleaved by
    //    screen row (the dungeon's, faded) — and the pieces IN MID-SLIDE
    //    among them, each by where its feet are this frame (a slider used
    //    to paint last, over everything, and the walk's arrivals in their
    //    plan's order, the king first: a tall king sliding beside the piece
    //    north of him lost his head under it for the slide's length —
    //    designer 2026-09-10, "their heads briefly render under the piece
    //    to the north"). A slider on a row's own line paints after that row.
    const sliding = [];
    for (const s of this.slides) { const p = this.#slideAt(s, t); sliding.push({ x: p.x, y: p.y, paint: () => this.#paintSlideAt(s, p.x, p.y) }); }
    for (const s of this.cellSlides) { const p = this.#cellSlideAt(s, t); if (p) sliding.push({ x: p.x, y: p.y, paint: () => this.#paintPiece(s.ch, p.x, p.y) }); }
    sliding.sort((a, b) => a.y - b.y || a.x - b.x);
    let si = 0;
    for (let row = 0; row < byRow.length; row++) {
      const lineY = H + row * T;
      while (si < sliding.length && sliding[si].y < lineY) sliding[si++].paint();
      for (const s of byRow[row]) {
        if (dim && !s.sq) {
          g.globalAlpha = 0.45;
          this.#paintTall(s, t);
          g.globalAlpha = 1;
        } else this.#paintTall(s, t);
      }
    }
    while (si < sliding.length) sliding[si++].paint();

    // 3. marks over the pieces (the arena's by square, the walk's by cell)
    for (const list of byRow) for (const s of list) if (s.sq) this.#paintMarksOver(s);
    if (this.cellMarks.selected !== null || this.cellMarks.targets.size || this.cellMarks.threats.size || this.cellMarks.badges.size) for (const list of byRow) for (const s of list) this.#paintCellMarks(s);
    // 4. coordinates
    this.#paintCoords();
    // 4b. the arrows, above the pieces (the DOM's layer sits above the cells)
    this.#paintArrows();
    // 5. the flight
    if (this.flight) {
      for (const p of this.flight) {
        const { x, y } = this.#arenaToBuf(p.x, p.y);
        if (x < 0 || y < 0 || x >= this.bufW || y >= this.bufH) continue;
        g.globalAlpha = p.a;
        g.fillStyle = `rgb(${p.rgb})`;
        g.fillRect(x, y, 1, 1);
      }
      g.globalAlpha = 1;
    }
  }

  /** A walk's arrival this frame: the buffer origin of the sliding letter
   *  between its old and new cells, or null when it is off the buffer. */
  #cellSlideAt(s, t) {
    const u = Math.min(1, (t - s.t0) / s.ms);
    const e = ease(u);
    // Along the path (a catch-up walk carries waypoints, so a slide goes
    // AROUND a crate, never through it): the eased progress spread over the
    // segments by their length.
    const pts = (s.path ?? [s.from, s.to]).map((c) => { const tl = this.#tileOf(c.f, c.r); return this.#originOfTile(tl.col, tl.row); });
    const lens = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); lens.push(l); total += l; }
    let x = pts[pts.length - 1].x, y = pts[pts.length - 1].y;
    if (total > 0) {
      let d = e * total;
      for (let i = 0; i < lens.length; i++) {
        if (d <= lens[i] || i === lens.length - 1) {
          const tt = lens[i] > 0 ? Math.min(1, d / lens[i]) : 1;
          x = Math.round(pts[i].x + (pts[i + 1].x - pts[i].x) * tt);
          y = Math.round(pts[i].y + (pts[i + 1].y - pts[i].y) * tt);
          break;
        }
        d -= lens[i];
      }
    }
    if (x < -2 * T || y < -2 * T || x > this.bufW + T || y > this.bufH + T) return null;
    return { x, y };
  }

  /** Arena px (the arena's own north-up view, y down from its top rank) →
   *  buffer px: into the world through the crop (world.mjs), onto the
   *  screen through the camera (camera.mjs pxToScreen), minus the window. */
  #arenaToBuf(x, y) {
    const e = this.crop ? arenaPxToEnv(this.crop, x, y) : { x, y };
    const p = pxToScreen(e.x, e.y, this.world.files * T, this.world.ranks * T, this.facing);
    return { x: p.x - this.win.col0 * T, y: this.headroom + p.y - this.win.row0 * T };
  }

  #paintFlat({ sq, idx, x, y, k, h }, theme, t) {
    const g = this.bctx;
    const [hf, hr] = h;
    const dark = (hf + hr - 1) % 2 === 0;
    const fx = sq ? this.fx.get(sq) : null;
    const u = fx ? (fx.done ? 1 : Math.min(1, (t - fx.t0) / fx.ms)) : 0;
    const facing = this.facing;
    // Floor: the theme's flagstone variant over the flat colour, the dark
    // square's shade over it; the classic set is the flat colours alone.
    const floor = theme ? this.#tile(`floor-${floorVariantIndex(hf, hr)}`) : null;
    g.fillStyle = dark ? CLASSIC.dark : CLASSIC.light;
    g.fillRect(x, y, T, T);
    if (floor) {
      this.#draw(floor, x, y);
      if (dark) {
        g.fillStyle = SHADE;
        g.fillRect(x, y, T, T);
      }
    }
    // (The cell's debris is drawn AFTER its terrain, below: the DOM's
    // debris image paints over the cell's background, so on a ruin the
    // rubble lies over the stub.)
    const dz = this.debrisCanvas.get(idx);
    if (!k) {
      if (dz) g.drawImage(dz, 0, 0, T, T, x, y, T, T);
      return;
    }
    const ck = crackVariantIndex(hf, hr);
    // The autotile cases as the SCREEN sees them (the camera): the wall's
    // 8-neighbour mask and the 4-bit ruin / pit / doorway masks permuted
    // to the facing before the tile lookup.
    const sm = rotMask8(k.mask, facing);
    const sm4 = rotMask4(k.mask, facing);
    if (fx?.kind === 'crumbling') {
      // The floor gives way: the lone-pit tile fades in over the floor, then stays.
      const hole = theme ? this.#tile('hole-0') : null;
      if (hole) {
        g.globalAlpha = u;
        this.#draw(hole, x, y);
        g.globalAlpha = 1;
      } else {
        g.fillStyle = `rgba(10,10,14,${u})`;
        g.fillRect(x, y, T, T);
      }
      if (dz) g.drawImage(dz, 0, 0, T, T, x, y, T, T);
      return;
    }
    if (fx?.kind === 'breaching') {
      // A crate bursts / a cracked wall breaks open: bare floor under a
      // white flash; the sprite itself bursts in #paintTall.
      if (dz) g.drawImage(dz, 0, 0, T, T, x, y, T, T);
      g.fillStyle = `rgba(255,255,255,${(0.63 * (1 - u)).toFixed(3)})`;
      g.fillRect(x, y, T, T);
      return;
    }
    if (k.hole) {
      const hole = theme ? this.#tile(`hole-${sm4}`) : null;
      if (hole) this.#draw(hole, x, y);
      else {
        g.fillStyle = CLASSIC.pit;
        g.fillRect(x, y, T, T);
        g.fillStyle = CLASSIC.pitLip;
        g.fillRect(x, y, T, 3);
      }
    } else if (k.wallTile) {
      const [jx, jy] = fx?.kind === 'cracking' ? JITTER[Math.min(JITTER.length - 1, Math.floor(u * JITTER.length))] : [0, 0];
      this.#draw(this.#wallTile(sm), x + jx, y + jy);
      if (fx?.kind === 'cracking') {
        // The crack appears under a flash of light; the end frame is the cracked tile.
        this.#draw(this.#crackedTile(sm, ck), x + jx, y + jy);
        if (u < 1) {
          g.fillStyle = `rgba(255,255,255,${(0.5 * (1 - u)).toFixed(3)})`;
          g.fillRect(x, y, T, T);
        }
      }
    } else if (k.ruin) {
      this.#draw(this.#tile(theme ? `ruin-${sm4}` : 'rubble'), x, y);
    } else if (k.furniture && (k.cracked || k.weak)) {
      this.#draw(this.#crackedTile(sm, ck), x, y);
    } else if (this.#edgeOn(k)) {
      // A door whose wall line runs up the screen: the edge-on placeholder,
      // flat terrain like the wall band it stands in.
      this.#draw(this.#edgeDoorTile(sm), x, y);
    }
    if (dz) g.drawImage(dz, 0, 0, T, T, x, y, T, T);
    // Decor: a prop on a standing wall's face (never on a cracked wall), or
    // the OPEN DOORWAY a door left — both above the debris, as the DOM's
    // decor span is above its debris image (the posts stand on the rubble).
    const decor = this.#decorOfCell(k, h);
    if (decor === 'doorway') {
      const tile = this.#doorwayTile(sm4);
      if (tile) this.#draw(tile, x, y);
    } else if (decor && theme) this.#draw(this.#tile(decor), x, y);
    // Marks under the pieces: the gods' residue and the debug heat.
    if (!sq) return;
    const m = this.marks;
    const heat = m.heat[sq];
    if (heat && HEAT[heat]) this.#frame1(x, y, HEAT[heat]);
    if (m.pits.has(sq) || m.cracked.has(sq) || m.breached.has(sq)) this.#frame1(x, y, GODS);
  }

  #paintTall({ sq, idx, x, y, k, h }, t) {
    if (!k || (sq && this.hidden.has(sq)) || this.hiddenCells.has(idx)) return;
    const g = this.bctx;
    const fx = sq ? this.fx.get(sq) : null;
    const u = fx ? (fx.done ? 1 : Math.min(1, (t - fx.t0) / fx.ms)) : 0;
    const v = k.v;
    if (k.furniture) {
      if (k.cracked || k.weak) {
        if (fx?.kind === 'breaching' && u < 1) {
          // The crack bursts away from the broken wall.
          const [hf, hr] = h;
          const ck = crackVariantIndex(hf, hr);
          const crack = this.atlas.crack(ck);
          if (crack) this.#burst(crack, x, y, T, T, u);
        }
        return; // the crack itself is drawn with the wall in #paintFlat
      }
      if (this.#edgeOn(k)) {
        // An edge-on door is flat terrain (#paintFlat); when it breaks, the
        // slab bursts away like a crack does.
        if (fx?.kind === 'breaching' && u < 1) {
          const tile = this.#edgeDoorTile(rotMask8(k.mask, this.facing));
          if (tile) this.#burst(tile, x, y, T, T, u);
        }
        return;
      }
      const { tile, prop } = this.#furnitureSprite(k, h);
      if (!tile) return;
      const py = prop ? y - T : y;
      const ph = prop ? 2 * T : T;
      if (fx?.kind === 'breaching') {
        if (u < 1) this.#burst(tile, x, py, T, ph, u);
        return;
      }
      const fading = sq ? this.slides.find((s) => s.fade && s.to === sq) : null;
      if (fading) {
        const fu = Math.min(1, (t - fading.t0) / fading.ms);
        if (k.skin === 'door') {
          // A captured door SWINGS instead of dissolving (scaleX .12 about its hinge).
          const w = Math.max(2, Math.round(T * (1 - 0.88 * fu)));
          g.globalAlpha = 1 - 0.15 * fu;
          this.#draw(tile, x + Math.round(1.6 * fu), py, w, ph);
          g.globalAlpha = 1;
        } else this.#dissolve(tile, x, py, T, ph, fu);
        return;
      }
      this.#draw(tile, x, py);
      return;
    }
    if (!v || v === WALL) return;
    const fading = sq ? this.slides.find((s) => s.fade && s.to === sq) : null;
    this.#paintPiece(v, x, y, fading ? Math.min(1, (t - fading.t0) / fading.ms) : 0);
  }

  /** A piece sprite at its square: the shadow one tile pixel down, then the sprite, lifted and shifted. */
  #paintPiece(v, x, y, fadeU = 0) {
    const set = this.drawnSet;
    const letter = v.replace('+', '');
    const sprite = this.atlas.pieceOf(set, letter);
    if (!sprite) return;
    const px = x + Math.floor((T - sprite.w) / 2) + this.tileShift;
    const py = y + T - sprite.h - this.tileLift;
    if (fadeU > 0) return this.#dissolve(sprite, px, py, sprite.w, sprite.h, fadeU, this.#shadowOf(set, letter, sprite));
    const shadow = this.#shadowOf(set, letter, sprite);
    this.#draw(shadow, px, py + 1);
    this.#draw(sprite, px, py);
  }

  /** A captured sprite dissolves: fades and shrinks to 65% about its centre (steps of a tile pixel). */
  #dissolve(tile, x, y, w, h, u, shadow = null) {
    const g = this.bctx;
    const s = 1 - 0.35 * u;
    const dw = Math.max(1, Math.round(w * s)), dh = Math.max(1, Math.round(h * s));
    const dx = x + Math.round((w - dw) / 2), dy = y + Math.round((h - dh) / 2);
    g.globalAlpha = Math.max(0, 1 - u);
    if (shadow) this.#draw(shadow, dx, dy + 1, dw, dh);
    this.#draw(tile, dx, dy, dw, dh);
    g.globalAlpha = 1;
  }

  /** The breach's burst: the sprite swells to 1.3× then shrinks to nothing, fading (style.css shard-burst). */
  #burst(tile, x, y, w, h, u) {
    const g = this.bctx;
    const s = u < 0.35 ? 1 + (0.3 * u) / 0.35 : 1.3 - (1.1 * (u - 0.35)) / 0.65;
    const a = u < 0.35 ? 1 - (0.1 * u) / 0.35 : 0.9 * (1 - (u - 0.35) / 0.65);
    const dw = Math.max(1, Math.round(w * s)), dh = Math.max(1, Math.round(h * s));
    g.globalAlpha = Math.max(0, a);
    this.#draw(tile, x + Math.round((w - dw) / 2), y + Math.round((h - dh) / 2), dw, dh);
    g.globalAlpha = 1;
  }

  /** A duel slide this frame: the buffer origin of the sliding sprite between its squares. */
  #slideAt(s, t) {
    const u = Math.min(1, (t - s.t0) / s.ms);
    const a = this.#origin(s.from), b = this.#origin(s.to);
    const e = ease(u);
    return { x: Math.round(a.x + (b.x - a.x) * e), y: Math.round(a.y + (b.y - a.y) * e) };
  }

  /** The sliding sprite of a duel slide, drawn at a buffer origin (#slideAt). */
  #paintSlideAt(s, x, y) {
    const k = this.#kindOfSq(s.from);
    if (k?.furniture) {
      if (this.#edgeOn(k)) {
        const tile = this.#edgeDoorTile(rotMask8(k.mask, this.facing));
        if (tile) this.#draw(tile, x, y);
        return;
      }
      const c = this.cells.get(s.from);
      const { tile, prop } = this.#furnitureSprite(k, this.#hc(c.cell, s.from));
      if (tile) this.#draw(tile, x, prop ? y - T : y);
      return;
    }
    this.#paintPiece(s.letter, x, y);
  }

  #paintCellMarks({ idx, x, y, k }) {
    const g = this.bctx;
    const cm = this.cellMarks;
    // THE THREAT DISPLAY (brief §5.4): a far-row cell where a hunter's duel
    // would start — a red frame, under the selection's marks.
    if (cm.threats.has(idx)) this.#frame1(x, y, THREAT, 1);
    // A BADGE over an enemy king: its state, in the 3×5 font at the cell's top edge.
    const badge = cm.badges.get(idx);
    if (badge && badge.text) drawText(g, badge.text, x + T - 1 - textWidth(badge.text), y - 3, badge.color, COORD_SHADOW);
    if (cm.selected === idx) this.#frame1(x, y, GOLD);
    if (cm.targets.has(idx)) {
      const capture = cm.targets.get(idx);
      if (capture || (k?.v && k.v !== WALL)) this.#frame1(x, y, capture ? BAD : TARGET, 1);
      else {
        g.fillStyle = TARGET;
        g.fillRect(x + 6, y + 6, 4, 4);
      }
    }
  }

  #paintMarksOver({ sq, x, y, k }) {
    const g = this.bctx;
    const m = this.marks;
    if (m.selected === sq) this.#frame1(x, y, GOLD);
    if (m.check === sq) this.#frame1(x, y, BAD);
    if (m.targets.has(sq)) {
      const occupied = !!k?.v && k.v !== WALL;
      if (occupied) this.#frame1(x, y, TARGET, 1);
      else {
        g.fillStyle = TARGET;
        g.fillRect(x + 6, y + 6, 4, 4);
      }
    }
  }

  /** The arrows in the buffer: centre to centre, the shape and colour by
   *  kind and rank, the opacity by strength (pixelarrow.mjs). */
  #paintArrows() {
    if (!this.arrows.length) return;
    if (this.scratch.width !== this.bufW || this.scratch.height !== this.bufH) {
      this.scratch.width = this.bufW;
      this.scratch.height = this.bufH;
    }
    const sg = this.scratch.getContext('2d');
    sg.imageSmoothingEnabled = false;
    for (const a of this.arrows) {
      if (!this.cells.has(a.from) || !this.cells.has(a.to)) continue;
      const p = this.#origin(a.from), q = this.#origin(a.to);
      const s = Math.max(0, Math.min(1, a.strength ?? 1));
      drawArrow(this.bctx, p.x + T / 2, p.y + T / 2, q.x + T / 2, q.y + T / 2, { colour: arrowColour(a), label: a.label ?? null, width: this.arrowStyle.width, alpha: arrowAlpha(this.arrowStyle.alpha, s), scratch: sg });
    }
  }

  /** The crop's edge coordinates (the DOM's .coord): along its bottom row
   *  what varies across the screen's columns — file letters north / south
   *  up, rank numbers east / west up — and down its left column the other. */
  #paintCoords() {
    if (!this.showCoords || !this.crop) return;
    const g = this.bctx;
    const b = this.cropBox;
    // What varies along the crop's edges depends on how the CAMERA sits
    // relative to the CROP's own north (a barrier duel is a crop at the
    // army's facing, read north-up under a camera at the same facing).
    const edges = coordEdges((this.facing - (this.crop.facing ?? 0) + 4) & 3);

    const label = (sq, what) => (what === 'file' ? sq[0] : sq.slice(1));
    const visible = (col, row) => col >= this.win.col0 && col < this.win.col0 + this.win.cols && row >= this.win.row0 && row < this.win.row0 + this.win.rows;
    const bottom = b.row0 + b.rows - 1;
    for (let col = b.col0; col < b.col0 + b.cols; col++) {
      const sq = this.#squareAt(col, bottom);
      if (!sq || !visible(col, bottom)) continue;
      const text = label(sq, edges.bottom);
      const { x, y } = this.#originOfTile(col, bottom);
      drawText(g, text, x + T - 1 - textWidth(text), y + T - 6, COORD, COORD_SHADOW);
    }
    for (let row = b.row0; row < b.row0 + b.rows; row++) {
      const sq = this.#squareAt(b.col0, row);
      if (!sq || !visible(b.col0, row)) continue;
      const { x, y } = this.#originOfTile(b.col0, row);
      drawText(g, label(sq, edges.left), x + 1, y + 1, COORD, COORD_SHADOW);
    }
  }

  /** The device-pixel gate's pattern: every buffer pixel encodes its own
   *  (x, y) — red = x, green = y (mod 256), blue = 255 — over the whole
   *  buffer, so a screenshot says whether the blit landed 1:1 at k. */
  #paintTestPattern() {
    const g = this.bctx;
    const img = g.createImageData(this.bufW, this.bufH);
    const d = img.data;
    for (let y = 0; y < this.bufH; y++) for (let x = 0; x < this.bufW; x++) {
      const o = (y * this.bufW + x) * 4;
      d[o] = x & 255;
      d[o + 1] = y & 255;
      d[o + 2] = 255;
      d[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  /** Test hook: the pattern on / off. */
  setTestPattern(on) {
    this.testPattern = !!on;
    this.invalidate();
  }

  /** Test hook: the buffer's pixels for a square (16×16 RGBA, its own
   *  rectangle only). A pending repaint is painted first, so the pixels
   *  are the board's current state, never a cleared buffer between a
   *  reallocation and its frame. */
  squarePixels(sq) {
    if (!this.cells.has(sq)) return null;
    if (this.raf) this.paintNow();
    const { x, y } = this.#origin(sq);
    if (x < 0 || y < 0 || x + T > this.bufW || y + T > this.bufH) return null;
    return this.bctx.getImageData(x, y, T, T).data;
  }

  /** Test hook: a world cell's pixels (16×16 RGBA), or null off the buffer. */
  cellPixels(f, r) {
    if (!this.world.inBounds(f, r)) return null;
    if (this.raf) this.paintNow();
    const t = this.#tileOf(f, r);
    const { x, y } = this.#originOfTile(t.col, t.row);
    if (x < 0 || y < 0 || x + T > this.bufW || y + T > this.bufH) return null;
    return this.bctx.getImageData(x, y, T, T).data;
  }

  /** Test hook: the whole buffer as RGBA (painted first if a frame is pending). */
  bufferPixels() {
    if (this.raf) this.paintNow();
    return { width: this.bufW, height: this.bufH, data: this.bctx.getImageData(0, 0, this.bufW, this.bufH).data };
  }

  /** Test hook: paint now, synchronously (the next frame would otherwise). */
  paintNow() {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    this.#frame();
  }
}
