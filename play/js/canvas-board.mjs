// THE CANVAS BOARD — Phase 2's 16×16 renderer, milestone 1 (2026-09-07).
//
// Brief §2 item 5: every drawn thing is 16×16 pixel art on ONE native-
// resolution grid, composed in ONE buffer and scaled to the screen ONCE,
// by a whole number where the screen allows it. This class is that, with
// the DOM board's method surface (board-ui.mjs BoardUI) so main.mjs and
// the replay page drive either without knowing which:
//
//   THE BUFFER  an offscreen canvas at 16 px per tile — files×16 wide,
//               ranks×16 tall plus HEADROOM for the top rank's tall
//               pieces — repainted from scratch on every change in
//               painter's order: floor (+ the dark square's shade), the
//               square's DEBRIS (debris.mjs paintCell's 16×16 buffer, put
//               straight in — no PNG, no <img>), terrain by kind
//               (board-ui classifyTerrain — the one terrain rule, shared
//               with the DOM board and the replay analyzer), the marks
//               under the pieces, then row by row from the far rank to the
//               near one the TALL things — furniture props (16×32) and
//               pieces (their sprite at its native size, lifted and
//               shifted by whole tile pixels) — so a nearer head paints
//               over the piece behind it, then the marks over the pieces,
//               the edge coordinates in a 3×5 pixel font, the debris
//               FLIGHT's pixels (particles.mjs, through drawFlight), and a
//               piece in mid-slide last. Nothing in it has a fractional
//               coordinate: buffer coordinates are integers.
//   THE BLIT    one drawImage of the buffer onto the screen canvas at
//               scale k, smoothing off. The screen canvas is the
//               container's full width; its backing store is sized from
//               ResizeObserver's DEVICE-PIXEL content box, so canvas
//               pixels and device pixels are one to one, and k =
//               ⌊device width ÷ (16 × files)⌋ ('integer', the default —
//               the board is centred in whole device pixels) or the exact
//               quotient ('fill' — the fallback for a screen where the
//               integer step is too small; uneven pixel widths, every
//               layer still aligned because they share the one resample).
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
//               pieces — where
//               the DOM board keeps its SVG overlay. No overlay element
//               sits on the canvas at all (a designer's white flash on the
//               first build pointed at the SVG; the diagnostics line
//               main.mjs shows comes from `renderInfo`).
//   INPUT       hit-testing by division: pointer → device px → tile.
//
// What it does NOT do (milestone 1, on purpose): the classic GLYPH pieces
// (a piece set is always drawn — the glyphs are text, not pixel art; the
// default set stands in), the % piece-fit dials (the tile grid is the only
// mode here: the art's own scale, lift and shift in whole tile pixels),
// the overworld camera (later — this board is a fixed-size viewport over
// one arena). The atlas is play/js/atlas.mjs.
import { splitFen, parseBoard, WALL } from './fen.mjs';
import { classifyTerrain, decorFor, crackVariantIndex, skinVariantIndex, floorVariantIndex, PIECE_SETS, DOOR_SETS, DEFAULT_PIECE_FIT, TILE_LIFT_RANGE, TILE_SHIFT_RANGE } from './board-ui.mjs';
import { drawArrow, arrowColour, sortArrows, normalizeArrowStyle, arrowAlpha } from './pixelarrow.mjs';
import { Atlas, TILE } from './atlas.mjs';
import { drawText, textWidth } from './pixelfont.mjs';

const T = TILE;
const EMPTY = new Set();
const FX_KINDS = { weaken: 'cracking', breach: 'breaching', crumble: 'crumbling', terminal: 'crumbling' };
/** The classic set's flat colours (style.css --cell-light / --cell-dark / --pit). */
const CLASSIC = { light: '#4a4a42', dark: '#3a3a33', pit: '#0a0a0e', pitLip: '#000000' };
const SHADE = 'rgba(0,0,0,0.22)'; // the dark square's checker shade under a theme (tiles.css --floor-shade #00000038)
const GODS = '#7cc8ff'; // style.css --gods
const GOLD = '#f2c14e'; // --gold
const BAD = '#e5484d'; // --bad
const TARGET = 'rgba(215,180,106,0.53)'; // .cell.target::after #d7b46a88
const HEAT = { a: 'rgba(255,215,90,0.78)', b: 'rgba(108,195,255,0.59)', c: 'rgba(154,157,170,0.33)', t: 'rgba(255,90,90,0.78)' };
const COORD = 'rgba(255,255,255,0.4)';
const COORD_SHADOW = 'rgba(0,0,0,0.6)';
/** The wall's jitter in the weaken fx, six steps (style.css crack-jitter). */
const JITTER = [[0, 0], [-1, 1], [1, -1], [-1, 0], [1, 1], [0, 0]];
/** The rumble's blit jitter in native pixels by phase (style.css board-quake). */
const RUMBLE = [[0, 0], [-1, 0], [1, 0], [-1, 0], [1, 0], [0, 0]];

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

const clampInt = (v, [lo, hi]) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : 0);
const wait = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const ease = (p) => 1 - (1 - p) ** 2.2; // ≈ the FLIP clone's cubic-bezier(.3,.8,.35,1)
const squareName = (f, rank) => String.fromCharCode(97 + f) + rank;

/** One atlas per page: loaded on the first board, warmed with the in-house SVGs. */
let atlasPromise = null;
export function loadAtlas(el) {
  if (!atlasPromise) atlasPromise = Atlas.load().then(async (a) => { await a.warmCss(el ?? document.body); return a; });
  return atlasPromise;
}
/** Test hook: forget the shared atlas (a page that swaps art). */
export function resetAtlas() {
  atlasPromise = null;
}

export class CanvasBoard {
  constructor(container, { files, ranks, flipped = false, onSquareTap = null, scaling = 'integer', atlas = null, onResize = null, arrowStyle = null } = {}) {
    this.container = container;
    this.onResize = onResize;
    this.files = files;
    this.ranks = ranks;
    this.flipped = flipped;
    this.onSquareTap = onSquareTap;
    this.interactive = false;
    this.scaling = scaling === 'fill' ? 'fill' : 'integer';
    this.atlas = null;
    // (The in-house SVGs are warmed off <body>, never off the board: under a
    // theme the board's --sprite-* resolve to the pack's PNGs.)
    this.ready = (atlas ? Promise.resolve(atlas) : loadAtlas()).then((a) => { this.atlas = a; this.#resize(); this.invalidate(); return a; });
    this.tileLift = DEFAULT_PIECE_FIT.tileLift;
    this.tileShift = DEFAULT_PIECE_FIT.tileShift;
    this.pieceBaked = Promise.resolve();
    // The board's state, all data: what every square is, what marks it wears.
    this.fen = null;
    this.grid = null; // [rankFromTop][file] FEN cells
    this.kinds = null; // classifyTerrain
    this.marks = { selected: null, targets: EMPTY, check: null, pits: EMPTY, cracked: EMPTY, breached: EMPTY, heat: {} };
    this.debrisBufs = new Map(); // sq → 16×16 RGBA (the test surface: the buffer the square wears)
    this.debrisCanvas = new Map(); // sq → a 16×16 canvas of it
    this.cells = new Map(); // sq → { f, rank } (BoardUI compatibility: .has / .get)
    for (let rank = 1; rank <= ranks; rank++) for (let f = 0; f < files; f++) this.cells.set(squareName(f, rank), { f, rank });
    this.fx = new Map(); // sq → { kind, t0, ms, hold, done }
    this.slides = []; // { from, to, letter, t0, ms, fade, victimLetter }
    this.hidden = new Set(); // squares whose sprite is hidden (a shatter, a slide's source)
    this.flight = null; // the flight's pixels this frame: [{ rgb, a, x, y }]
    this.rumbling = null; // { t0, ms }
    this.testPattern = false;
    this.paintWaiters = [];
    this.composites = new Map(); // cache: cracked tiles, piece shadows
    // Geometry (device pixels): set by #resize.
    this.dpr = 1;
    this.devW = 0;
    this.devH = 0;
    this.k = 1;
    this.x0 = 0;
    this.y0 = 0;
    this.headroom = 0;
    this.raf = 0;
    this.loop = false;
    this.snapX = 0; // the correction that lands the canvas on a whole device pixel (#snap)
    this.snapY = 0;
    this.snapMode = DEFAULT_SNAP;

    container.classList.add('board', 'board-canvas');
    container.classList.toggle('inactive', true);
    container.style.setProperty('--files', files);
    container.style.setProperty('--ranks', ranks);
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
    this.#observe();
    this.#allocBuffer();
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

  /** The board's native size: files×16 by ranks×16 + headroom. */
  get boardW() {
    return this.files * T;
  }
  get boardH() {
    return this.ranks * T;
  }
  get bufW() {
    return this.boardW;
  }
  get bufH() {
    return this.boardH + this.headroom;
  }

  /** Headroom in native pixels: how far the tallest piece rises above the top rank. */
  #headroomFor() {
    const box = this.atlas?.pieceBox(this.pieces);
    const fit = box ? box[1] : T;
    return Math.max(0, fit - T + this.tileLift);
  }

  #allocBuffer() {
    const h = this.#headroomFor();
    if (this.buf.width === this.bufW && this.headroom === h && this.buf.height === this.boardH + h) return;
    this.headroom = h;
    this.buf.width = this.bufW;
    this.buf.height = this.bufH;
    this.bctx.imageSmoothingEnabled = false;
  }

  /**
   * Size the screen canvas from its DEVICE-pixel box: backing store = the
   * box (one canvas pixel per device pixel), k from the width, the CSS
   * height set so the board fits at k; the observer fires again on the
   * height change and this settles in one more step.
   */
  #resize(box = null) {
    if (!this.canvas.isConnected) return;
    this.dpr = window.devicePixelRatio || 1;
    this.#allocBuffer();
    let w;
    this.emulated = !!box?.emulated;
    if (box) w = Math.floor(box.w);
    else w = Math.floor(this.container.getBoundingClientRect().width * this.dpr);
    if (!(w > 0)) return;
    const k = this.scaling === 'integer' ? Math.max(1, Math.floor(w / this.boardW)) : w / this.boardW;
    const needH = Math.ceil(this.bufH * k);
    this.k = k;
    this.devW = w;
    this.devH = needH;
    this.x0 = this.scaling === 'integer' ? Math.floor((w - this.boardW * k) / 2) : 0;
    this.y0 = 0;
    // The canvas's CSS size is its backing store in whole device pixels,
    // stated explicitly (a 100% width is a fractional number of device
    // pixels whenever the container's is, and a canvas drawn into a box a
    // fraction wider than its bitmap is RESAMPLED — measured in both
    // browsers, phase drifting a column in). A layout unit's rounding of
    // this length (1/64 css px) is far under the half pixel that would
    // move a nearest-neighbour sample.
    const st = this.canvas.style;
    st.width = `${this.devW / this.dpr}px`;
    st.height = `${this.devH / this.dpr}px`;
    if (this.canvas.width !== this.devW || this.canvas.height !== this.devH) {
      this.canvas.width = this.devW;
      this.canvas.height = this.devH;
    }
    this.ctx.imageSmoothingEnabled = false;
    this.invalidate();
    this.onResize?.(this.renderInfo);
  }

  /** Which renderer this is (main.mjs picks by option). */
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
    return `canvas · dpr ${+i.dpr.toFixed(3)} · ${i.devW}×${i.devH} device px · k ${kf} (${i.integer ? 'integer' : 'fill'}) · ${+(i.tilePx).toFixed(2)} px/tile · ${(i.tilePx / i.dpr).toFixed(1)} css px`;
  }

  /** Column / row-from-top of a square on the rendered grid (flip-aware). */
  gridPos(sq) {
    const f = sq.charCodeAt(0) - 97;
    const rank = parseInt(sq.slice(1), 10);
    return { col: this.flipped ? this.files - 1 - f : f, row: this.flipped ? rank - 1 : this.ranks - rank };
  }

  /** Buffer pixel of a square's top-left. */
  #origin(sq) {
    const { col, row } = this.gridPos(sq);
    return { x: col * T, y: this.headroom + row * T };
  }

  #squareAt(col, row) {
    if (col < 0 || col >= this.files || row < 0 || row >= this.ranks) return null;
    const f = this.flipped ? this.files - 1 - col : col;
    const rank = this.flipped ? row + 1 : this.ranks - row;
    return squareName(f, rank);
  }

  #onClick(e) {
    if (!this.interactive || !this.onSquareTap) return;
    const r = this.canvas.getBoundingClientRect();
    if (!(r.width > 0)) return;
    const x = ((e.clientX - r.left) * this.devW) / r.width - this.x0;
    const y = ((e.clientY - r.top) * this.devH) / r.height - this.y0 - this.headroom * this.k;
    const sq = this.#squareAt(Math.floor(x / (T * this.k)), Math.floor(y / (T * this.k)));
    if (sq) this.onSquareTap(sq);
  }

  // ------------------------------------------------------------ state

  /** Render pieces + terrain from a FEN and the ledgers (BoardUI.setPosition). */
  setPosition(fen, { holes = EMPTY, godCrates = EMPTY, skins = {}, opened = EMPTY, rubble = EMPTY, debris = null } = {}) {
    this.fen = fen;
    const boardField = fen.includes(' ') ? splitFen(fen).board : fen;
    this.grid = parseBoard(boardField);
    this.skins = skins;
    this.kinds = classifyTerrain(fen, { holes, godCrates, skins, opened, rubble }, this.files, this.ranks);
    this.fx.clear(); // a held end frame never outlives its edit
    this.hidden.clear(); // a flight's hide never outlives the paint
    for (const sq of this.cells.keys()) void this.setDebris(sq, debris ? debris(sq, this.kinds.get(sq)) : null);
    this.invalidate();
  }

  /** Replace ALL marks (BoardUI.setMarks). */
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

  /** The arrows to draw (BoardUI.setArrows' list): kept in draw order and
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
   * Show one square's debris: a 16×16 RGBA buffer (debris.mjs paintCell)
   * or null. Put straight into a per-square canvas the buffer composites;
   * resolves once a frame has painted it.
   */
  async setDebris(sq, buf) {
    if (!this.cells.has(sq)) return;
    const had = this.debrisBufs.get(sq) ?? null;
    if (!buf && !had) return;
    if (buf && had && buf.length === had.length && buf.every((v, i) => v === had[i])) return;
    if (!buf) {
      this.debrisBufs.delete(sq);
      this.debrisCanvas.delete(sq);
    } else {
      this.debrisBufs.set(sq, buf);
      let c = this.debrisCanvas.get(sq);
      if (!c) {
        c = document.createElement('canvas');
        c.width = T;
        c.height = T;
        this.debrisCanvas.set(sq, c);
      }
      const data = buf instanceof Uint8ClampedArray ? buf : new Uint8ClampedArray(buf);
      c.getContext('2d').putImageData(new ImageData(data, T, T), 0, 0);
    }
    this.invalidate();
    await new Promise((r) => this.paintWaiters.push(r));
  }

  debrisBuf(sq) {
    return this.debrisBufs.get(sq) ?? null;
  }

  hasDebris(sq) {
    return this.debrisBufs.has(sq);
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
  layoutPieceRows() {}
  layoutPieceSnap() {}
  async layoutPieceTiers() {}

  /** The classes the DOM board would put on this cell — the shared test
   *  surface (selftest, ui-smoke): terrain kinds and marks, from data. */
  cellClasses(sq) {
    const c = this.cells.get(sq);
    if (!c) return null;
    const { f, rank } = c;
    const out = ['cell', (f + rank - 1) % 2 === 0 ? 'dark' : 'light', `f${floorVariantIndex(f, rank)}`, `ck${crackVariantIndex(f, rank)}`, `sv${skinVariantIndex(f, rank)}`];
    const k = this.kinds?.get(sq);
    if (k) {
      if (k.wallTile) out.push('wall');
      if (k.hole) out.push('hole');
      if (k.furniture) out.push('furniture');
      if (k.cracked) out.push('cracked');
      if (k.skin) out.push(`skin-${k.skin}`);
      if (k.door2) out.push(`door2-${k.door2}`);
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

  /** The decor a square wears (torch / banner / chain / doorway), or null — the DOM's .decor span, as data. */
  decorOf(sq) {
    const k = this.kinds?.get(sq);
    const c = this.cells.get(sq);
    if (!k || !c) return null;
    return decorFor({ wallTile: k.wallTile, cracked: k.cracked, mask: k.mask, f: c.f, rank: c.rank, earned: k.doorway ? 'doorway' : null });
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

  /** Terrain fx for one edited square (BoardUI.animateTerrain): drawn in
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
    if (!ms || !this.cells.has(from) || !this.cells.has(to) || !this.grid) return;
    const letter = this.#letterAt(from);
    if (!letter || letter === WALL) return;
    const victim = fade ? this.#letterAt(to) : null;
    const s = { from, to, letter, t0: now(), ms, fade: !!victim && victim !== WALL };
    this.slides.push(s);
    this.hidden.add(from);
    this.#run();
    await wait(ms);
    this.slides = this.slides.filter((x) => x !== s);
    this.hidden.delete(from); // before the caller's setPosition, as the DOM board does
    this.invalidate();
  }

  async animateSlides(moves, { ms = 340, stagger = 120 } = {}) {
    if (!ms) return;
    await Promise.all(moves.map(async ({ from, to }, i) => {
      if (i && stagger) await wait(i * stagger);
      await this.animateSlide(from, to, { ms });
    }));
  }

  /** The quake's rumble: the blit jitters by whole native pixels for `ms`
   *  (the DOM board's CSS shake; main.mjs calls this as well as adding the
   *  class, which the canvas CSS ignores). */
  rumble(ms) {
    if (!ms) return;
    this.rumbling = { t0: now(), ms };
    this.#run();
  }

  #letterAt(sq) {
    const f = sq.charCodeAt(0) - 97;
    const rank = parseInt(sq.slice(1), 10);
    return this.grid?.[this.ranks - rank]?.[f] ?? null;
  }

  // ------------------------------------------------------------ the loop

  get animating() {
    const t = now();
    if (this.slides.length || this.flight) return true;
    if (this.rumbling && t < this.rumbling.t0 + this.rumbling.ms) return true;
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
    this.#snap();
    this.#paint();
    this.#blit();
    for (const r of this.paintWaiters.splice(0)) r();
    if (this.animating) this.invalidate();
    else if (this.rumbling) {
      this.rumbling = null;
      this.invalidate(); // one clean frame after the shake
    } else this.loop = false;
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
    }
    const k = this.k;
    const x = this.x0 + jx, y = this.y0 + jy;
    // A frame of one tile pixel around the board where the margin allows it.
    const b = Math.max(1, Math.round(k));
    g.fillStyle = '#000';
    g.fillRect(x - b, y + this.headroom * k - b, this.boardW * k + 2 * b, this.boardH * k + 2 * b);
    g.drawImage(this.buf, 0, 0, this.bufW, this.bufH, x, y, this.bufW * k, this.bufH * k);
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

  /** The furniture sprite a square shows: the door leaf / double half, a
   *  prop (crate / chest / barrel / wreckage, by the square's variant), or
   *  the crate for an unskinned '^'. { tile, prop } — a prop is 16×32. */
  #furnitureSprite(sq, k) {
    const c = this.cells.get(sq);
    if (k.skin === 'door') return { tile: this.#tile(k.door2 ? `door2-${k.door2}` : 'door'), prop: false };
    const role = k.skin && k.skin !== 'masonry' ? k.skin : 'crate';
    const v = skinVariantIndex(c.f, c.rank);
    const tile = this.#tile(v > 1 ? `${role}-${v}` : role) ?? this.#tile(role) ?? this.#tile('crate');
    return { tile, prop: !!tile && tile.h === 2 * T };
  }

  #frame1(sq, x, y, fill, inset = 0) {
    const g = this.bctx;
    g.fillStyle = fill;
    g.fillRect(x + inset, y + inset, T - 2 * inset, 1);
    g.fillRect(x + inset, y + T - 1 - inset, T - 2 * inset, 1);
    g.fillRect(x + inset, y + inset + 1, 1, T - 2 - 2 * inset);
    g.fillRect(x + T - 1 - inset, y + inset + 1, 1, T - 2 - 2 * inset);
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
    const kinds = this.kinds;
    const H = this.headroom;
    // The square's own rectangle and its kind, in rendered order.
    const squares = [];
    for (let row = 0; row < this.ranks; row++) for (let col = 0; col < this.files; col++) {
      const sq = this.#squareAt(col, row);
      const c = this.cells.get(sq);
      if (!c) continue;
      squares.push({ sq, x: col * T, y: H + row * T, k: kinds?.get(sq) ?? null, c, row });
    }
    // 1. floor + shade + debris + flat terrain + marks under the pieces
    for (const s of squares) this.#paintFlat(s, theme, t);
    // 2. the tall things, far rank first: props and pieces interleaved by row
    for (let row = 0; row < this.ranks; row++) for (const s of squares) if (s.row === row) this.#paintTall(s, t);
    // 3. marks over the pieces
    for (const s of squares) this.#paintMarksOver(s);
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
    // 6. pieces in mid-slide, on top
    for (const s of this.slides) this.#paintSlide(s, t);
  }

  /** Arena px (unflipped board space, y down from the top rank) → buffer px. */
  #arenaToBuf(x, y) {
    if (!this.flipped) return { x, y: this.headroom + y };
    return { x: this.boardW - 1 - x, y: this.headroom + this.boardH - 1 - y };
  }

  #paintFlat({ sq, x, y, k, c }, theme, t) {
    const g = this.bctx;
    const dark = (c.f + c.rank - 1) % 2 === 0;
    const fx = this.fx.get(sq);
    const u = fx ? (fx.done ? 1 : Math.min(1, (t - fx.t0) / fx.ms)) : 0;
    // Floor: the theme's flagstone variant over the flat colour, the dark
    // square's shade over it; the classic set is the flat colours alone.
    const floor = theme ? this.#tile(`floor-${floorVariantIndex(c.f, c.rank)}`) : null;
    g.fillStyle = dark ? CLASSIC.dark : CLASSIC.light;
    g.fillRect(x, y, T, T);
    if (floor) {
      this.#draw(floor, x, y);
      if (dark) {
        g.fillStyle = SHADE;
        g.fillRect(x, y, T, T);
      }
    }
    // (The square's debris is drawn AFTER its terrain, below: the DOM's
    // debris image paints over the cell's background, so on a ruin the
    // rubble lies over the stub.)
    const dz = this.debrisCanvas.get(sq);
    if (!k) {
      if (dz) g.drawImage(dz, 0, 0, T, T, x, y, T, T);
      return;
    }
    const ck = crackVariantIndex(c.f, c.rank);
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
      const hole = theme ? this.#tile(`hole-${k.mask}`) : null;
      if (hole) this.#draw(hole, x, y);
      else {
        g.fillStyle = CLASSIC.pit;
        g.fillRect(x, y, T, T);
        g.fillStyle = CLASSIC.pitLip;
        g.fillRect(x, y, T, 3);
      }
    } else if (k.wallTile) {
      const [jx, jy] = fx?.kind === 'cracking' ? JITTER[Math.min(JITTER.length - 1, Math.floor(u * JITTER.length))] : [0, 0];
      this.#draw(this.#wallTile(k.mask), x + jx, y + jy);
      if (fx?.kind === 'cracking') {
        // The crack appears under a flash of light; the end frame is the cracked tile.
        this.#draw(this.#crackedTile(k.mask, ck), x + jx, y + jy);
        if (u < 1) {
          g.fillStyle = `rgba(255,255,255,${(0.5 * (1 - u)).toFixed(3)})`;
          g.fillRect(x, y, T, T);
        }
      }
    } else if (k.ruin) {
      this.#draw(this.#tile(theme ? `ruin-${k.mask}` : 'rubble'), x, y);
    } else if (k.furniture && (k.cracked || k.weak)) {
      this.#draw(this.#crackedTile(k.mask, ck), x, y);
    }
    if (dz) g.drawImage(dz, 0, 0, T, T, x, y, T, T);
    // Decor: a prop on a standing wall's face (never on a cracked wall), or
    // the OPEN DOORWAY a door left — both above the debris, as the DOM's
    // decor span is above its debris image (the posts stand on the rubble).
    const decor = this.decorOf(sq);
    if (decor === 'doorway') {
      const role = k.mask === 10 ? 'doorway' : k.mask === 8 ? 'doorway-8' : k.mask === 2 ? 'doorway-2' : null;
      if (role && theme) this.#draw(this.#tile(role), x, y);
    } else if (decor && theme) this.#draw(this.#tile(decor), x, y);
    // Marks under the pieces: the gods' residue and the debug heat.
    const m = this.marks;
    const h = m.heat[sq];
    if (h && HEAT[h]) this.#frame1(sq, x, y, HEAT[h]);
    if (m.pits.has(sq) || m.cracked.has(sq) || m.breached.has(sq)) this.#frame1(sq, x, y, GODS);
  }

  #paintTall({ sq, x, y, k, c }, t) {
    if (!k || this.hidden.has(sq)) return;
    const g = this.bctx;
    const fx = this.fx.get(sq);
    const u = fx ? (fx.done ? 1 : Math.min(1, (t - fx.t0) / fx.ms)) : 0;
    const v = k.v;
    if (k.furniture) {
      if (k.cracked || k.weak) {
        if (fx?.kind === 'breaching' && u < 1) {
          // The crack bursts away from the broken wall.
          const ck = crackVariantIndex(c.f, c.rank);
          const crack = this.atlas.crack(ck);
          if (crack) this.#burst(crack, x, y, T, T, u);
        }
        return; // the crack itself is drawn with the wall in #paintFlat
      }
      const { tile, prop } = this.#furnitureSprite(sq, k);
      if (!tile) return;
      const py = prop ? y - T : y;
      const ph = prop ? 2 * T : T;
      if (fx?.kind === 'breaching') {
        if (u < 1) this.#burst(tile, x, py, T, ph, u);
        return;
      }
      const fading = this.slides.find((s) => s.fade && s.to === sq);
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
    const fading = this.slides.find((s) => s.fade && s.to === sq);
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

  #paintSlide(s, t) {
    const u = Math.min(1, (t - s.t0) / s.ms);
    const a = this.#origin(s.from), b = this.#origin(s.to);
    const e = ease(u);
    const x = Math.round(a.x + (b.x - a.x) * e), y = Math.round(a.y + (b.y - a.y) * e);
    const k = this.kinds?.get(s.from);
    if (k?.furniture) {
      const { tile, prop } = this.#furnitureSprite(s.from, k);
      if (tile) this.#draw(tile, x, prop ? y - T : y);
      return;
    }
    this.#paintPiece(s.letter, x, y);
  }

  #paintMarksOver({ sq, x, y, k }) {
    const g = this.bctx;
    const m = this.marks;
    if (m.selected === sq) this.#frame1(sq, x, y, GOLD);
    if (m.check === sq) this.#frame1(sq, x, y, BAD);
    if (m.targets.has(sq)) {
      const occupied = !!k?.v && k.v !== WALL;
      if (occupied) this.#frame1(sq, x, y, TARGET, 1);
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

  /** File letters along the bottom row, rank numbers down the left column (the DOM's .coord). */
  #paintCoords() {
    const g = this.bctx;
    const H = this.headroom;
    for (let col = 0; col < this.files; col++) {
      const sq = this.#squareAt(col, this.ranks - 1);
      const letter = sq[0];
      drawText(g, letter, col * T + T - 1 - textWidth(letter), H + (this.ranks - 1) * T + T - 6, COORD, COORD_SHADOW);
    }
    for (let row = 0; row < this.ranks; row++) {
      const sq = this.#squareAt(0, row);
      drawText(g, sq.slice(1), 1, H + row * T + 1, COORD, COORD_SHADOW);
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
