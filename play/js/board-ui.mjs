// Board renderer + promotion picker (mobile-first DOM/CSS).
//
// Squares are addressed by ABSOLUTE name ('a1'..'l10') everywhere; flipping
// the view (player plays Black) only changes visual row/column order —
// data-square attributes and all callbacks stay absolute. Pieces render as
// the filled Unicode glyph set for BOTH colors (fonts render the filled set
// far more consistently than the outline set); color comes from CSS classes.
//
// TERRAIN is a CELL treatment, one class per kind — a tileset later replaces
// only what each class paints:
//   .wall       authored stone: a raised slab.
//   .hole       a square the gods crumbled: a sunken pit, permanent. FSF reads
//               both as '*' and only the Director's `holes` ledger tells them
//               apart, so setPosition takes that ledger as an argument.
//   .furniture  a crate '^' (§4.6). Deliberately renders like a PIECE — a
//               neutral-colored glyph span over a raised cell tint — because
//               it behaves like a victim: it can be captured, so the
//               capture-dissolve path (animateSlide's dst .piece query) and
//               the ringed target mark must treat it as one. ONE sprite for
//               every furniture flavor; the flavor is per-stage fiction.
//   .cracked    a wall the gods weakened into a crate (§4.5 weaken) — the
//               same sprite over a slab shot through with cracks, so the
//               telegraph ("a cracked wall says a breach is coming") is on
//               the board. From the Director's `godCrates` ledger ANDed with
//               the FEN's '^' (the ledger keeps stale entries for god-crates
//               an army captured; the AND is what keeps them from painting).
//   .furniture stays on a .cracked cell: everything that keys off "this cell
//   holds a capturable sprite" keeps working, and the cell carries the look.
//
// COORDINATES: file letters along the bottom visual row and rank numbers down
// the left visual column, as .coord children of the edge cells — every
// square the log, the hint list and the gods line name is findable.
//
// MARKS live on separate channels so they compose instead of clobbering:
// terrain paints `background`, residue/debug rings paint `box-shadow`, the
// last-move tint is a `filter`, selection/check are `outline` (style.css).
import { splitFen, parseBoard, WALL, FURNITURE } from './fen.mjs';

const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FURNITURE_GLYPH = '▦';
const SVG_NS = 'http://www.w3.org/2000/svg';
const CELL = 10; // SVG units per cell (viewBox space)
const EMPTY = new Set();
// Transient terrain fx classes (animateTerrain). setPosition strips them as
// it commits the edited tile, so a HELD end frame never outlives its edit.
const FX_CLASSES = ['cracking', 'breaching', 'crumbling'];
const FX_BY_KIND = { weaken: 'cracking', breach: 'breaching', crumble: 'crumbling', terminal: 'crumbling' };

const wait = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function svgEl(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

export class BoardUI {
  constructor(container, { files, ranks, flipped = false, onSquareTap = null } = {}) {
    this.container = container;
    this.files = files;
    this.ranks = ranks;
    this.flipped = flipped;
    this.onSquareTap = onSquareTap;
    this.interactive = false;
    container.classList.add('board');
    container.classList.toggle('inactive', true);
    container.style.setProperty('--files', files);
    container.style.setProperty('--ranks', ranks);
    container.textContent = '';
    this.cells = new Map();

    const rankOrder = [];
    for (let r = ranks; r >= 1; r--) rankOrder.push(r);
    const fileOrder = [...Array(files).keys()];
    if (flipped) {
      rankOrder.reverse();
      fileOrder.reverse();
    }
    const bottomRank = rankOrder[rankOrder.length - 1];
    const leftFile = fileOrder[0];
    for (const rank of rankOrder) {
      for (const f of fileOrder) {
        const sq = String.fromCharCode(97 + f) + rank;
        const cell = document.createElement('div');
        // a1 dark: (file + rankFromBottom) even = dark.
        cell.className = 'cell ' + ((f + rank - 1) % 2 === 0 ? 'dark' : 'light');
        cell.dataset.square = sq;
        cell.addEventListener('click', () => {
          if (this.interactive && this.onSquareTap) this.onSquareTap(sq);
        });
        // Coordinates on the two visible edges only (a child element, not a
        // pseudo: ::after is the target mark, and pseudo-elements cannot
        // carry per-cell text without an attribute hack).
        if (rank === bottomRank) cell.appendChild(coordEl('coord-file', String.fromCharCode(97 + f)));
        if (f === leftFile) cell.appendChild(coordEl('coord-rank', String(rank)));
        container.appendChild(cell);
        this.cells.set(sq, cell);
      }
    }
    // Arrow overlay (hints + the gods' displacements). position:absolute
    // lifts it out of the grid flow.
    this.svg = document.createElementNS(SVG_NS, 'svg');
    this.svg.classList.add('arrow-layer');
    this.svg.setAttribute('viewBox', `0 0 ${files * CELL} ${ranks * CELL}`);
    this.svg.setAttribute('preserveAspectRatio', 'none');
    container.appendChild(this.svg);

    // FX overlay: FLIP clones slide across it so pieces travel between
    // squares instead of teleporting. Also absolute, so it stays out of the
    // grid flow; the board's own overflow:hidden clips it, which is fine
    // because every slide is cell-to-adjacent-cell.
    this.fx = document.createElement('div');
    this.fx.className = 'fx-layer';
    container.appendChild(this.fx);
  }

  /** Center of a square in viewBox units (flip-aware). */
  #squareCenter(sq) {
    const f = sq.charCodeAt(0) - 97;
    const rank = parseInt(sq.slice(1), 10);
    const col = this.flipped ? this.files - 1 - f : f;
    const rowFromTop = this.flipped ? rank - 1 : this.ranks - rank;
    return [col * CELL + CELL / 2, rowFromTop * CELL + CELL / 2];
  }

  /**
   * Draw arrows: [{from, to, strength, rank?, kind?}].
   *
   * `kind` is 'hint' (default — the oracle's best lines; COLOUR carries the
   * rank: 1 gold, 2 silver, 3 bronze) or 'quake' (a displacement the gods
   * just made, in the gods' hue, dashed). `strength` ∈ (0,1] still nudges
   * width and opacity, lichess-style ("how close to the best"), but never
   * carries the rank — two equal-eval moves used to be indistinguishable.
   * Quake arrows draw beneath hints; the best hint draws on top of all.
   * Geometry is about half the old size: a 3×5 board's cells are ~30 px on a
   * phone and the old head was two thirds of a cell.
   */
  setArrows(arrows) {
    this.svg.textContent = '';
    // Ascending sort key: quake arrows first (drawn first = underneath), then
    // hints from worst rank to best, so rank 1 is appended last (on top).
    const key = (a) => (a.kind === 'quake' ? -100 : -(a.rank ?? 2 - (a.strength ?? 1)));
    const sorted = [...arrows].sort((a, b) => key(a) - key(b));
    for (const { from, to, strength = 1, rank = null, kind = 'hint' } of sorted) {
      const [x1, y1] = this.#squareCenter(from);
      const [x2, y2] = this.#squareCenter(to);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (!len) continue;
      const ux = dx / len;
      const uy = dy / len;
      const s = Math.max(0, Math.min(1, strength));
      const width = 0.8 + 0.8 * s; // 0.9–1.6 units: 9–16% of a cell (was 18–34%)
      const head = Math.min(3.0, width * 1.9); // head length ≤ 30% of a cell (was 65%)
      // Shaft starts clear of the origin square's glyph and the tip pulls
      // short of the destination centre so the head never covers a piece.
      const tail = kind === 'quake' ? 0.22 : 0.32;
      const tipX = x2 - ux * CELL * 0.2;
      const tipY = y2 - uy * CELL * 0.2;
      const baseX = tipX - ux * head;
      const baseY = tipY - uy * head;
      const g = document.createElementNS(SVG_NS, 'g');
      g.classList.add('arrow', `arrow-${kind}`);
      if (rank) {
        g.classList.add(`rank-${rank}`);
        g.dataset.rank = String(rank);
      }
      g.dataset.from = from;
      g.dataset.to = to;
      g.setAttribute('opacity', (0.6 + 0.3 * s).toFixed(2));
      const px = -uy;
      const py = ux;
      const lineAttrs = { x1: x1 + ux * CELL * tail, y1: y1 + uy * CELL * tail, x2: baseX, y2: baseY };
      const points = `${tipX},${tipY} ${baseX + px * head * 0.5},${baseY + py * head * 0.5} ${baseX - px * head * 0.5},${baseY - py * head * 0.5}`;
      // A dark halo under the coloured stroke keeps silver legible on light
      // cells and bronze on the pit — a stroke, not a CSS filter (filters
      // scale with the non-uniform viewBox).
      g.appendChild(svgEl('line', { ...lineAttrs, class: 'halo', 'stroke-width': width + 1.1 }));
      g.appendChild(svgEl('polygon', { points, class: 'halo', 'stroke-width': 1.1 }));
      g.appendChild(svgEl('line', { ...lineAttrs, 'stroke-width': width }));
      g.appendChild(svgEl('polygon', { points }));
      this.svg.appendChild(g);
    }
  }

  /**
   * Render pieces + terrain from a full FEN (or a bare board field).
   *
   * `holes` and `godCrates` are the Director's ledgers (Sets of square
   * names): a '*' in `holes` paints as a hole, not a wall; a '^' in
   * `godCrates` paints as a cracked wall, not a crate. Omit both (the setup
   * preview has no Director) and every '*' is stone, every '^' a crate.
   * Committing a tile also strips any held terrain-fx class on the cell.
   */
  setPosition(fen, { holes = EMPTY, godCrates = EMPTY } = {}) {
    const boardField = fen.includes(' ') ? splitFen(fen).board : fen;
    const grid = parseBoard(boardField); // [rankFromTop][file]
    for (const [sq, cell] of this.cells) {
      const f = sq.charCodeAt(0) - 97;
      const rank = parseInt(sq.slice(1), 10);
      const v = grid[this.ranks - rank]?.[f] ?? null;
      const isWall = v === WALL;
      const isFurniture = v === FURNITURE;
      cell.classList.remove(...FX_CLASSES);
      cell.style.removeProperty('--fx-ms');
      cell.classList.toggle('wall', isWall && !holes.has(sq));
      cell.classList.toggle('hole', isWall && holes.has(sq));
      cell.classList.toggle('furniture', isFurniture);
      cell.classList.toggle('cracked', isFurniture && godCrates.has(sq));
      let glyph = cell.querySelector('.piece');
      if (v && v !== WALL) {
        if (!glyph) {
          glyph = document.createElement('span');
          glyph.className = 'piece';
          cell.appendChild(glyph);
        }
        if (isFurniture) {
          // Neutral sprite — neither side's color. Without this branch '^'
          // fell through to the piece path as a literal glyph styled WHITE
          // (the toUpperCase landmine, renderer edition).
          glyph.textContent = FURNITURE_GLYPH;
          glyph.classList.remove('white', 'black');
          glyph.classList.add('neutral');
        } else {
          const letter = v.replace('+', '');
          const isWhite = letter === letter.toUpperCase();
          glyph.textContent = GLYPHS[letter.toLowerCase()] ?? letter;
          glyph.classList.toggle('white', isWhite);
          glyph.classList.toggle('black', !isWhite);
          glyph.classList.remove('neutral');
        }
      } else if (glyph) {
        glyph.remove();
      }
    }
  }

  /** Replace ALL marks. Absent keys clear their mark class; `arrows` feeds
   *  the SVG overlay (see setArrows).
   *
   *  `quakeFrom`/`quakeTo`/`pit`/`cracked`/`breached` are the gods' residue,
   *  one class per RUNG so crack and break-through read differently: they
   *  outlive the animation and the enemy's reply, and clear only when the
   *  player moves, so "what just happened" is answerable from the board
   *  instead of the log. from and to are marked DIFFERENTLY (and the
   *  displacement itself is an arrow, see setArrows) — the old cue flashed
   *  both with one class, which showed that something moved but never
   *  which way.
   *
   *  `heat` (Phase 1.2, Gods debug overlay) is a {square: 'a'|'b'|'c'|'t'}
   *  map painting the Director's candidate census — displacement landing
   *  squares by tier, 't' for terminal crumbles. Debug-only chrome: its CSS
   *  sits before the quake marks so live-game marks win ties. */
  setMarks({ selected = null, targets = [], lastMove = [], check = null, arrows = [], quakeFrom = [], quakeTo = [], pit = null, pits = [], cracked = [], breached = [], heat = {} } = {}) {
    const targetSet = new Set(targets);
    const lastSet = new Set(lastMove);
    const quakeFromSet = new Set(quakeFrom);
    const quakeToSet = new Set(quakeTo);
    const pitSet = new Set(pit ? [pit, ...pits] : pits); // `pit` is the one-square form
    const crackedSet = new Set(cracked);
    const breachedSet = new Set(breached);
    for (const [sq, cell] of this.cells) {
      cell.classList.toggle('sel', sq === selected);
      cell.classList.toggle('target', targetSet.has(sq));
      cell.classList.toggle('last', lastSet.has(sq));
      cell.classList.toggle('check', sq === check);
      cell.classList.toggle('quake-from', quakeFromSet.has(sq));
      cell.classList.toggle('quake-to', quakeToSet.has(sq));
      cell.classList.toggle('fresh-pit', pitSet.has(sq));
      cell.classList.toggle('fresh-crack', crackedSet.has(sq));
      cell.classList.toggle('fresh-breach', breachedSet.has(sq));
      const h = heat[sq];
      cell.classList.toggle('heat-a', h === 'a');
      cell.classList.toggle('heat-b', h === 'b');
      cell.classList.toggle('heat-c', h === 'c');
      cell.classList.toggle('heat-t', h === 't');
    }
    this.setArrows(arrows);
  }

  /** The classes on one cell — the test surface for tiles and marks. */
  cellClasses(square) {
    const cell = this.cells.get(square);
    return cell ? [...cell.classList] : null;
  }

  /**
   * Terrain fx for one edited square, by rung: 'weaken' (a wall cracks —
   * the slab jitters and the crack web appears), 'breach' (a crate bursts —
   * the sprite shatters, the cell flashes light) or 'crumble'/'terminal'
   * (the floor gives way — the cell sinks to the hole tile). With `hold` the
   * end frame stays on the cell until setPosition commits the edit, so a
   * multi-action quake never shows an edited wall snapping back to solid
   * while the pieces after it are still sliding. Caller follows with
   * setPosition(postFen). Resolves immediately when ms is 0.
   */
  async animateTerrain(square, kind, ms, { hold = false } = {}) {
    const cell = this.cells.get(square);
    const cls = FX_BY_KIND[kind];
    if (!cell || !cls || !ms) return;
    cell.classList.remove(...FX_CLASSES);
    cell.style.setProperty('--fx-ms', `${ms}ms`);
    cell.classList.add(cls);
    await wait(ms);
    if (!hold) {
      cell.classList.remove(cls);
      cell.style.removeProperty('--fx-ms');
    }
  }

  /** Floor-gives-way animation; caller follows with setPosition(postFen). */
  animateCrumble(square, ms = 450) {
    return this.animateTerrain(square, 'crumble', ms);
  }

  /**
   * Slide one piece from → to as a FLIP clone on the fx layer, so the eye can
   * follow it. The DOM still holds the PRE-move position when this is called;
   * the caller commits with setPosition() once it resolves.
   *
   * `fade` dissolves a piece standing on the destination (a capture) during
   * the slide. Resolves immediately when ms is 0 (reduced motion / ?fx=0).
   */
  async animateSlide(from, to, { ms = 240, fade = false } = {}) {
    const src = this.cells.get(from);
    const dst = this.cells.get(to);
    if (!ms || !src || !dst) return;
    const glyph = src.querySelector('.piece');
    if (!glyph) return;
    const base = this.container.getBoundingClientRect();
    const a = src.getBoundingClientRect();
    const b = dst.getBoundingClientRect();
    const clone = glyph.cloneNode(true);
    clone.classList.add('fx-piece');
    // .piece sizes itself with 78cqmin against its CELL's container context.
    // The clone lives on the fx layer, which establishes no such context, so
    // the query unit would resolve against the viewport and render the glyph
    // enormous. Pin the resolved size instead.
    clone.style.fontSize = getComputedStyle(glyph).fontSize;
    clone.style.left = `${a.left - base.left}px`;
    clone.style.top = `${a.top - base.top}px`;
    clone.style.width = `${a.width}px`;
    clone.style.height = `${a.height}px`;
    clone.style.transitionDuration = `${ms}ms`;
    this.fx.appendChild(clone);
    glyph.style.visibility = 'hidden';
    const victim = fade ? dst.querySelector('.piece') : null;
    if (victim) {
      victim.style.transitionDuration = `${ms}ms`;
      victim.classList.add('fx-captured');
    }
    void clone.offsetWidth; // commit the start frame before transitioning
    clone.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px)`;
    await wait(ms);
    clone.remove();
    // Restore BEFORE the caller's setPosition: it reuses existing .piece
    // elements per cell, so a still-hidden glyph would render an empty square.
    glyph.style.visibility = '';
    if (victim) {
      victim.classList.remove('fx-captured');
      victim.style.removeProperty('transition-duration');
    }
  }

  /**
   * Slide several pieces at once, offset by `stagger` so a multi-piece quake
   * reads as separate events rather than one blur. Resolves when the last lands.
   */
  async animateSlides(moves, { ms = 340, stagger = 120 } = {}) {
    if (!ms) return;
    await Promise.all(
      moves.map(async ({ from, to }, i) => {
        if (i && stagger) await wait(i * stagger);
        await this.animateSlide(from, to, { ms });
      })
    );
  }

  setInteractive(enabled) {
    this.interactive = enabled;
    this.container.classList.toggle('inactive', !enabled);
  }

  destroy() {
    this.container.textContent = '';
    this.container.classList.remove('board', 'inactive');
    this.cells.clear();
  }
}

function coordEl(cls, text) {
  const el = document.createElement('span');
  el.className = `coord ${cls}`;
  el.textContent = text;
  return el;
}

/** Modal promotion picker (§4.4). No dismissal without choosing. */
export function pickPromotion(letters) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'promo-overlay';
    const card = document.createElement('div');
    card.className = 'promo-card';
    const label = document.createElement('div');
    label.className = 'promo-label';
    label.textContent = 'Promote to';
    card.appendChild(label);
    for (const l of letters) {
      const btn = document.createElement('button');
      btn.className = 'promo-btn';
      btn.textContent = GLYPHS[l.toLowerCase()] ?? l;
      btn.addEventListener('click', () => {
        overlay.remove();
        resolve(l);
      });
      card.appendChild(btn);
    }
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}
