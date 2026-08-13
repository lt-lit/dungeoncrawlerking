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
   *  the SVG overlay (see setArrows). */
  setMarks({ selected = null, targets = [], lastMove = [], check = null, slots = [], arrows = [] } = {}) {
    const targetSet = new Set(targets);
    const lastSet = new Set(lastMove);
    const slotSet = new Set(slots);
    for (const [sq, cell] of this.cells) {
      cell.classList.toggle('sel', sq === selected);
      cell.classList.toggle('target', targetSet.has(sq));
      cell.classList.toggle('last', lastSet.has(sq));
      cell.classList.toggle('check', sq === check);
      cell.classList.toggle('slot', slotSet.has(sq));
    }
    this.setArrows(arrows);
  }

  /** Floor-gives-way animation; caller follows with setPosition(postFen). */
  async animateCrumble(square) {
    const cell = this.cells.get(square);
    if (!cell) return;
    cell.classList.add('crumbling');
    await new Promise((r) => setTimeout(r, 450));
    cell.classList.remove('crumbling');
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
