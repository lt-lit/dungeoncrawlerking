// Board renderer + placement tray + promotion picker (mobile-first DOM/CSS).
//
// Squares are addressed by ABSOLUTE name ('a1'..'l10') everywhere; flipping
// the view (player plays Black) only changes visual row/column order —
// data-square attributes and all callbacks stay absolute. Pieces render as
// the filled Unicode glyph set for BOTH colors (fonts render the filled set
// far more consistently than the outline set); color comes from CSS classes.
import { splitFen, parseBoard } from './fen.mjs';

const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const CELL = 10; // SVG units per cell (viewBox space)

const wait = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

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
        container.appendChild(cell);
        this.cells.set(sq, cell);
      }
    }
    // Arrow overlay (hints). position:absolute lifts it out of the grid flow.
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

  /** Draw hint arrows: [{from, to, strength}] with strength ∈ (0,1] scaling
   *  width and opacity, lichess-style. Best (strength 1) draws on top. */
  setArrows(arrows) {
    this.svg.textContent = '';
    const sorted = [...arrows].sort((a, b) => a.strength - b.strength);
    for (const { from, to, strength } of sorted) {
      const [x1, y1] = this.#squareCenter(from);
      const [x2, y2] = this.#squareCenter(to);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (!len) continue;
      const ux = dx / len;
      const uy = dy / len;
      const width = 1.4 + 2.0 * strength;
      const head = width * 1.9;
      // shaft stops where the head begins; tip pulls short of the cell center
      const tipX = x2 - ux * CELL * 0.12;
      const tipY = y2 - uy * CELL * 0.12;
      const baseX = tipX - ux * head;
      const baseY = tipY - uy * head;
      const g = document.createElementNS(SVG_NS, 'g');
      g.classList.add('arrow');
      g.dataset.from = from;
      g.dataset.to = to;
      g.setAttribute('opacity', (0.4 + 0.5 * strength).toFixed(2));
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x1 + ux * CELL * 0.3);
      line.setAttribute('y1', y1 + uy * CELL * 0.3);
      line.setAttribute('x2', baseX);
      line.setAttribute('y2', baseY);
      line.setAttribute('stroke-width', width);
      const headEl = document.createElementNS(SVG_NS, 'polygon');
      const px = -uy;
      const py = ux;
      headEl.setAttribute(
        'points',
        `${tipX},${tipY} ${baseX + px * head * 0.55},${baseY + py * head * 0.55} ${baseX - px * head * 0.55},${baseY - py * head * 0.55}`
      );
      g.appendChild(line);
      g.appendChild(headEl);
      this.svg.appendChild(g);
    }
  }

  /** Render pieces + walls from a full FEN (or a bare board field). */
  setPosition(fen) {
    const boardField = fen.includes(' ') ? splitFen(fen).board : fen;
    const grid = parseBoard(boardField); // [rankFromTop][file]
    for (const [sq, cell] of this.cells) {
      const f = sq.charCodeAt(0) - 97;
      const rank = parseInt(sq.slice(1), 10);
      const v = grid[this.ranks - rank]?.[f] ?? null;
      cell.classList.toggle('wall', v === '*');
      let glyph = cell.querySelector('.piece');
      if (v && v !== '*') {
        const letter = v.replace('+', '');
        const isWhite = letter === letter.toUpperCase();
        if (!glyph) {
          glyph = document.createElement('span');
          glyph.className = 'piece';
          cell.appendChild(glyph);
        }
        glyph.textContent = GLYPHS[letter.toLowerCase()] ?? letter;
        glyph.classList.toggle('white', isWhite);
        glyph.classList.toggle('black', !isWhite);
      } else if (glyph) {
        glyph.remove();
      }
    }
  }

  /** Replace ALL marks. Absent keys clear their mark class; `arrows` feeds
   *  the SVG overlay (see setArrows).
   *
   *  `quakeFrom`/`quakeTo`/`pit` are the gods' residue: they outlive the
   *  animation and the enemy's reply, and clear only when the player moves,
   *  so "what just happened" is answerable from the board instead of the log.
   *  from and to are marked DIFFERENTLY — the old cue flashed both with one
   *  class, which showed that something moved but never which way. */
  setMarks({ selected = null, targets = [], lastMove = [], check = null, slots = [], arrows = [], quakeFrom = [], quakeTo = [], pit = null } = {}) {
    const targetSet = new Set(targets);
    const lastSet = new Set(lastMove);
    const slotSet = new Set(slots);
    const quakeFromSet = new Set(quakeFrom);
    const quakeToSet = new Set(quakeTo);
    for (const [sq, cell] of this.cells) {
      cell.classList.toggle('sel', sq === selected);
      cell.classList.toggle('target', targetSet.has(sq));
      cell.classList.toggle('last', lastSet.has(sq));
      cell.classList.toggle('check', sq === check);
      cell.classList.toggle('slot', slotSet.has(sq));
      cell.classList.toggle('quake-from', quakeFromSet.has(sq));
      cell.classList.toggle('quake-to', quakeToSet.has(sq));
      cell.classList.toggle('fresh-pit', sq === pit);
    }
    this.setArrows(arrows);
  }

  /** Floor-gives-way animation; caller follows with setPosition(postFen). */
  async animateCrumble(square, ms = 450) {
    const cell = this.cells.get(square);
    if (!cell || !ms) return;
    cell.style.setProperty('--fx-ms', `${ms}ms`);
    cell.classList.add('crumbling');
    await wait(ms);
    cell.classList.remove('crumbling');
    cell.style.removeProperty('--fx-ms');
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
   * Slide several pieces at once, offset by `stagger` so a symmetric quake
   * reads as two events rather than one blur. Resolves when the last lands.
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

/** Placement tray: the player's piece pool (§4.3). */
export class Tray {
  constructor(container, { onTap } = {}) {
    this.container = container;
    this.onTap = onTap;
    container.classList.add('tray');
  }

  setPieces(items) {
    this.container.textContent = '';
    for (const it of items) {
      const chip = document.createElement('button');
      chip.className = `tray-chip ${it.state}`;
      chip.dataset.trayId = it.id;
      chip.disabled = it.state === 'placed';
      const glyph = document.createElement('span');
      glyph.className = `piece ${it.color}`;
      glyph.textContent = GLYPHS[it.piece.toLowerCase()] ?? it.piece;
      chip.appendChild(glyph);
      chip.addEventListener('click', () => this.onTap && this.onTap(it.id));
      this.container.appendChild(chip);
    }
  }

  clear() {
    this.container.textContent = '';
  }
}
