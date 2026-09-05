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
//   .hole       a square the gods crumbled: a sunken pit, permanent — under a
//               theme the pit AUTOTILES like the ruins (round 13: wm-<mask>
//               = the 4-bit mask of its HOLE neighbours, so joined pits are
//               one pit with a ragged rim only where floor meets them;
//               --tile-hole-<mask>). FSF reads
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
//   skin-<name> on a .furniture cell picks the SPRITE (door, barrel, table,
//   chair, shelf, chest; the crate is the default) from the stage's skin
//   grid (stage.mjs stageSkins) — cosmetics only, never grid state. The
//   masonry skin has no sprite of its own: it is a .weak cell (below).
//   .wm-<mask> on a wall/cracked cell: its AUTOTILE case — the mask of
//              solid neighbours (N=1 E=2 S=4 W=8, diagonals NE=16 SE=32
//              SW=64 NW=128, canonicalMask below; solid = stone that is
//              not a hole, a cracked wall, a DOOR skin or MASONRY — those
//              continue the wall line; crates and the rest do not). A
//              theme paints the 47 blob cases (--tile-wall-<mask>,
//              tiles.css), the in-house set one block for all.
//   .weak      an authored WEAK SPOT: the masonry skin anywhere, or a door
//              skin in a north–south wall line (no edge-on door exists,
//              designer round 6). The cell paints its wall case and the
//              sprite is THE crack (--tile-crack), the same overlay a
//              god-weakened wall wears — the same capturable '^'. Since
//              2026-09-04 masonry is a weak spot, not a rubble heap
//              ("they look absurdly out of place. Why not just use a
//              cracked wall?"); the heap sprite is residue-only.
//   .f1…fN     the floor's stable texture variant (FLOOR_VARIANTS).
//   .ck1…ckN   the crack drawing this square's wall would wear
//              (CRACK_VARIANTS; style.css maps it to --tile-crack).
//   .sv1…svN   which of a skin's sprite VARIANTS this square shows
//              (SKIN_VARIANTS; tiles.css maps svN + skin-<role> to
//              --sprite-<role>-N, the base sprite as the fallback).
//   .door2-l / .door2-r  a door skin paired with the door skin beside it
//              in its rank (round 16): the two paint ONE two-wide door —
//              the west leaf its left half, the east its right
//              (--sprite-door2-l / -r; a theme or door set without a
//              double falls back to two leaves). Paired west to east, so
//              a run of three is a double and a single.
//   .decor     a cosmetic prop span under the piece (decor-<name>: torch /
//              chain / banner on an east–west wall face, scattered by a
//              stable hash of the square — floor litter is packed away
//              since round 10 — and decor-doorway, the OPEN DOORWAY an
//              east–west door left behind, whose cell also wears wm-<mask>
//              = the east (2) / west (8) walls still STANDING beside it,
//              so a post stands only where its wall does — round 12); the
//              theme's --decor-<name> paints it, or nothing.
//   .ruin      a floor square where a wall, a cracked wall or a weak spot
//              BROKE (main.mjs residue ledger `rubble`): it paints the
//              theme's ruin stub case (--tile-ruin-<mask>, 16 cases by its
//              STANDING wall neighbours as wm-<mask> — never another ruin
//              or an opened doorway, round 12) under whatever stands
//              there, and it COUNTS AS SOLID to its neighbours' wall cases
//              — as does an opened doorway — so the wall line runs on
//              through the break instead of capping either side of a gap.
// PIECES (2026-09-03): every piece span carries data-piece="<FEN letter>";
// setPieces(name) stamps data-pieces on the board and tiles.css paints the
// set's sprite (PIECE_SETS) instead of the glyph; null = the glyphs.
// THEME (2026-09-03): setTheme(name) stamps data-theme on the board; the
// repacked tilesets (play/tiles.css) scope their tile variables to it, so
// the same classes paint hall / castle / crypt art, or the in-house set when
// no theme is set.
//
// COORDINATES: file letters along the bottom visual row and rank numbers down
// the left visual column, as .coord children of the edge cells — every
// square the log, the hint list and the gods line name is findable.
//
// MARKS live on separate channels so they compose instead of clobbering:
// terrain paints `background`, residue/debug rings paint `box-shadow`,
// selection/check are `outline` (style.css); MOVES are arrows on the SVG
// layer — the enemy's last move in red, the gods' displacements in their
// blue, the oracle's hints by rank (round 13: no square tints for moves).
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

/** Wall autotile mask bits: N=1 E=2 S=4 W=8, diagonals NE=16 SE=32 SW=64
 *  NW=128. A diagonal only matters when BOTH its orthogonal neighbours are
 *  solid (it decides whether that corner of a thick block is filled — the
 *  standard 47-case blob), so canonicalMask() zeroes the rest and
 *  WALL_MASK_CODES are the only classes the renderer emits (and the only
 *  tiles repack-tiles.mjs composes). */
export function canonicalMask(m) {
  const n = m & 1, e = m & 2, s = m & 4, w = m & 8;
  let c = m & 15;
  if (n && e && m & 16) c |= 16;
  if (s && e && m & 32) c |= 32;
  if (s && w && m & 64) c |= 64;
  if (n && w && m & 128) c |= 128;
  return c;
}
export const WALL_MASK_CODES = [...new Set(Array.from({ length: 256 }, (_, m) => canonicalMask(m)))].sort((a, b) => a - b);

/** Piece-sprite sets the board can wear (tiles.css [data-pieces=…];
 *  repack-tiles.mjs builds them). null / 'classic' = the Unicode glyphs. */
export const PIECE_SETS = ['pixel-chess', 'pixel-chess-wood', 'nulltale', 'nulltale-dread', 'deja-view'];
/** Door sets (tiles.css [data-doors=…]): each theme's door, selectable
 *  over any theme — the leaf, the portcullis, the barred gate. */
export const DOOR_SETS = ['leaf', 'portcullis', 'gate'];
/** Floor texture variants a theme may provide (--tile-floor-1..N). */
export const FLOOR_VARIANTS = 6;
/** Crack drawings (gen-sprites --tile-crack-1..N): every cell carries
 *  ck1…ckN by a stable hash of its square, so neighbouring cracked walls
 *  differ and a repaint never swaps a crack (round 14). */
export const CRACK_VARIANTS = 4;
/** Furniture sprite variants (round 16, 2026-09-05: "look at all these
 *  vase and crate variants"): every cell carries sv1…svN by a stable hash
 *  of its square, and tiles.css maps svN on a skin to the theme's Nth
 *  sprite for that role (--sprite-<role>-N, the base as the fallback), so
 *  a row of urns is not five identical urns and a repaint never swaps one. */
export const SKIN_VARIANTS = 5;

/** The piece-fit dials' defaults (setPieceFit; style.css carries the same
 *  as its CSS fallbacks): the designer's settled phone numbers, round 11 —
 *  the box at 146% of its fit, lifted 0.22 cell, nudged 0.04 right, and
 *  PIXEL-PERFECT on, so a piece stands on its square's bottom edge and
 *  rises well into the one above at a whole-pixel scale. */
export const DEFAULT_PIECE_FIT = { scale: 1.46, lift: 0.22, shift: 0.04, snap: true };

/** Stable floor-texture variant for a square: f1 (the common stone) on
 *  ~70% of squares, f2…f6 scattered over the rest — a fixed hash of the
 *  square, so a repaint never makes the floor crawl. */
/** Stable per-square hash for cosmetic scatter (decor). */
function squareHash(f, rank, salt) {
  return (((f + 1) * 2654435761) ^ ((rank + 1) * 40503) ^ (salt * 97)) >>> 0;
}

/** Which cosmetic prop a square carries, or null. Walls facing south (an
 *  east–west run with floor below) get wall-mounted props at a low rate —
 *  a prop must never read as a piece or as terrain. Floor litter (web /
 *  bones / skull / candle) is PACKED AWAY (designer round 10: it made the
 *  pieces harder to read); the sprites stay in tiles.css. */
function decorFor({ wallTile, cracked, mask, f, rank, earned }) {
  if (earned) return earned; // the open doorway a door left behind
  if (!wallTile || cracked || !(mask & 10) || mask & 4) return null;
  const r = squareHash(f, rank, 7) % 1000;
  return r < 200 ? 'torch' : r < 260 ? 'banner' : r < 320 ? 'chain' : null;
}

function floorVariant(f, rank) {
  const h = (((f + 1) * 73856093) ^ ((rank + 1) * 19349663)) >>> 0;
  const r = h % 16;
  return r < FLOOR_VARIANTS - 1 ? `f${r + 2}` : 'f1';
}

/** Which of the crack drawings a square wears if its wall cracks. */
function crackVariant(f, rank) {
  return `ck${1 + (squareHash(f, rank, 11) % CRACK_VARIANTS)}`;
}
/** Which of a skin's sprite variants a square shows (SKIN_VARIANTS). */
function skinVariant(f, rank) {
  return `sv${1 + (squareHash(f, rank, 17) % SKIN_VARIANTS)}`;
}

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
    // Pixel-perfect pieces re-lay out with the board's size (setPieceFit snap).
    this.pieceSnap = false;
    if (typeof ResizeObserver !== 'undefined') {
      this.pieceObserver = new ResizeObserver(() => { if (this.pieceSnap) this.layoutPieceSnap(); });
      this.pieceObserver.observe(container);
    }
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
        cell.className = 'cell ' + ((f + rank - 1) % 2 === 0 ? 'dark' : 'light') + ' ' + floorVariant(f, rank) + ' ' + crackVariant(f, rank) + ' ' + skinVariant(f, rank);
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
   * Draw arrows: [{from, to, strength, rank?, kind?, label?}].
   *
   * `label` (hints) is the line's eval, written INSIDE the arrow: the text
   * runs along the shaft, rotated with it (never upside down), sized to fit
   * between the tail and the head, in dark ink on the arrow's colour —
   * "+0.8", "−1.2", "M3". A labelled arrow gets a fixed wide shaft that
   * starts at the origin square's centre so even a one-square move has
   * room; strength then only drives its opacity.
   * `kind` is 'hint' (default — the oracle's best lines; COLOUR carries the
   * rank: 1 gold, 2 silver, 3 bronze), 'quake' (a displacement the gods
   * just made, in the gods' hue) or 'last' (the enemy's most recent move,
   * red — round 13, in place of the old square tints). All three share
   * one geometry and outline; only the colour differs (the quake dash is
   * gone). `strength` ∈ (0,1] still nudges
   * width and opacity, lichess-style ("how close to the best"), but never
   * carries the rank — two equal-eval moves used to be indistinguishable.
   * Quake arrows draw beneath everything, the last move above them, then
   * hints; the best hint draws on top of all.
   * Geometry is about half the old size: a 3×5 board's cells are ~30 px on a
   * phone and the old head was two thirds of a cell.
   */
  setArrows(arrows) {
    this.svg.textContent = '';
    // Ascending sort key: quake arrows first (drawn first = underneath), then
    // hints from worst rank to best, so rank 1 is appended last (on top).
    const key = (a) => (a.kind === 'quake' ? -100 : a.kind === 'last' ? -90 : -(a.rank ?? 2 - (a.strength ?? 1)));
    const sorted = [...arrows].sort((a, b) => key(a) - key(b));
    for (const { from, to, strength = 1, rank = null, kind = 'hint', label = null } of sorted) {
      const [x1, y1] = this.#squareCenter(from);
      const [x2, y2] = this.#squareCenter(to);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy);
      if (!len) continue;
      const ux = dx / len;
      const uy = dy / len;
      const s = Math.max(0, Math.min(1, strength));
      // A labelled arrow is a fixed 2.5 units wide (25% of a cell) — the
      // text's cap height is ~1.4, so it sits inside the coloured shaft with
      // the outline clear on both sides; otherwise 1.6–2.2 by strength.
      const width = label ? 2.5 : 1.4 + 0.8 * s;
      const head = label ? 3.2 : Math.min(3.6, width * 1.8); // head length ≤ 36% of a cell (was 65%)
      // Unlabelled: the shaft starts clear of the origin glyph and the tip
      // pulls short of the destination centre so the head never covers a
      // piece. Labelled: start at the origin centre and pull back less, so
      // a one-square move still has ~6 units of shaft for the number.
      const tail = label ? 0 : 0.32;
      const pull = label ? 0.06 : 0.2;
      const tipX = x2 - ux * CELL * pull;
      const tipY = y2 - uy * CELL * pull;
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
      if (label) {
        // Along the shaft: midpoint between the shaft's start and the head's
        // base, rotated to the arrow's angle (flipped so it never reads
        // upside down), font sized to the shaft's length (bold monospace
        // advances ~0.62 em per glyph) with a floor so it stays a number.
        const sx = x1 + ux * CELL * tail;
        const sy = y1 + uy * CELL * tail;
        const mx = (sx + baseX) / 2;
        const my = (sy + baseY) / 2;
        const shaftLen = Math.hypot(baseX - sx, baseY - sy);
        const size = Math.max(1.3, Math.min(2.0, (shaftLen - 0.6) / (0.62 * label.length)));
        let deg = (Math.atan2(uy, ux) * 180) / Math.PI;
        if (deg > 90 || deg <= -90) deg += 180;
        const text = svgEl('text', { x: mx, y: my, class: 'label', 'font-size': size.toFixed(2), transform: `rotate(${deg.toFixed(1)} ${mx} ${my})` });
        text.textContent = label;
        g.appendChild(text);
      }
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
   * `skins` is the stage's {square: skinName} map (stage.mjs stageSkins):
   * an authored '^' with a skin gets the `skin-<name>` class and paints
   * that sprite; a god-cracked wall never takes a skin. `opened` / `rubble`
   * are main.mjs's RESIDUE ledger — floor squares where an east–west door
   * was opened keep its doorway decor, floor squares where a wall broke
   * become `.ruin` cells wearing the broken stub (cosmetic, but both count
   * as solid to the wall autotile so the line runs on through them; a
   * ruin's own stub case and a doorway's posts count only STANDING walls,
   * never residue).
   * Committing a tile also strips any held terrain-fx class on the cell.
   */
  setPosition(fen, { holes = EMPTY, godCrates = EMPTY, skins = {}, opened = EMPTY, rubble = EMPTY } = {}) {
    const boardField = fen.includes(' ') ? splitFen(fen).board : fen;
    const grid = parseBoard(boardField); // [rankFromTop][file]
    // STANDING = stone that is not a hole: a wall, a cracked wall, a door,
    // authored masonry (a weak spot is still stone in the line) — the
    // things that continue a wall line to the eye. SOLID (for the wall
    // autotile) = standing, or the RESIDUE of it: a broken wall's ruin stub
    // and an opened doorway keep the line running through the break (round
    // 10). A RUIN's own stub case counts STANDING neighbours only (round 12:
    // two broken squares side by side each drew a stub at the other — a
    // clump of wall floating between two floor squares — and a stub grew
    // against an open doorway's post): its stubs are the broken ends of
    // walls that still stand, and residue has no end to show.
    const standing = (ff, rr) => {
      if (ff < 0 || ff >= this.files || rr < 1 || rr > this.ranks) return false;
      const t = grid[this.ranks - rr]?.[ff] ?? null;
      const name = String.fromCharCode(97 + ff) + rr;
      if (t === FURNITURE) return godCrates.has(name) || skins[name] === 'door' || skins[name] === 'masonry';
      if (t === WALL) return !holes.has(name);
      return false;
    };
    // A HOLE's autotile case joins only other holes (round 13): joined pits
    // are one pit, and the ragged rim runs only where floor meets them.
    const isHole = (ff, rr) => {
      if (ff < 0 || ff >= this.files || rr < 1 || rr > this.ranks) return false;
      return grid[this.ranks - rr]?.[ff] === WALL && holes.has(String.fromCharCode(97 + ff) + rr);
    };
    const solid = (ff, rr) => {
      if (standing(ff, rr)) return true;
      if (ff < 0 || ff >= this.files || rr < 1 || rr > this.ranks) return false;
      const t = grid[this.ranks - rr]?.[ff] ?? null;
      if (t === FURNITURE || t === WALL) return false;
      const name = String.fromCharCode(97 + ff) + rr;
      return rubble.has(name) || opened.has(name);
    };
    // DOUBLE DOORS (round 16): two door skins side by side in a rank are
    // one two-wide door. A god-cracked '^' is stone, not a leaf.
    const isDoor = (ff, rr) => {
      const name = String.fromCharCode(97 + ff) + rr;
      return grid[this.ranks - rr]?.[ff] === FURNITURE && !godCrates.has(name) && skins[name] === 'door';
    };
    const leftLeaf = new Set(), rightLeaf = new Set();
    for (let rr = 1; rr <= this.ranks; rr++) {
      for (let ff = 0; ff < this.files - 1; ff++) {
        if (!isDoor(ff, rr) || !isDoor(ff + 1, rr)) continue;
        leftLeaf.add(String.fromCharCode(97 + ff) + rr);
        rightLeaf.add(String.fromCharCode(97 + ff + 1) + rr);
        ff++; // the pair is spoken for
      }
    }
    for (const [sq, cell] of this.cells) {
      const f = sq.charCodeAt(0) - 97;
      const rank = parseInt(sq.slice(1), 10);
      const v = grid[this.ranks - rank]?.[f] ?? null;
      const isWall = v === WALL;
      const isFurniture = v === FURNITURE;
      cell.classList.toggle('door2-l', leftLeaf.has(sq));
      cell.classList.toggle('door2-r', rightLeaf.has(sq));
      cell.classList.remove(...FX_CLASSES);
      cell.style.removeProperty('--fx-ms');
      const wallTile = isWall && !holes.has(sq);
      const hole = isWall && holes.has(sq);
      cell.classList.toggle('wall', wallTile);
      cell.classList.toggle('hole', hole);
      cell.classList.toggle('furniture', isFurniture);
      const cracked = isFurniture && godCrates.has(sq);
      cell.classList.toggle('cracked', cracked);
      const skin = isFurniture && !cracked ? skins[sq] ?? null : null;
      for (const cls of [...cell.classList]) if (cls.startsWith('skin-') && cls !== `skin-${skin}`) cell.classList.remove(cls);
      if (skin) cell.classList.add(`skin-${skin}`);
      // WEAK SPOTS wear the crack (2026-09-04): authored masonry anywhere,
      // and a door in a north–south wall line (there is no edge-on door, so
      // it reads as the weakened stone it stands in). Both paint the wall
      // block with THE crack, exactly like a god-weakened wall — the same
      // capturable '^'.
      const N = solid(f, rank + 1), E = solid(f + 1, rank), S = solid(f, rank - 1), W = solid(f - 1, rank);
      const weak = skin === 'masonry' || (skin === 'door' && (N || S) && !(E || W));
      cell.classList.toggle('weak', weak);
      // A floor square where a wall broke keeps the broken stub.
      const floor = !isWall && !isFurniture;
      const ruin = floor && rubble.has(sq);
      cell.classList.toggle('ruin', ruin);
      // The autotile case of a wall, cracked wall or weak spot: which
      // neighbours it joins (the 47-case blob); a ruin's is the plain
      // 4-bit mask of its STANDING neighbours (the 16 stub cases — a
      // neighbouring ruin or doorway is no wall end); a hole's is the plain
      // 4-bit mask of its HOLE neighbours (a diagonal floor square touches a
      // pit only at a corner point, so 16 cases cover it). One wm-<mask> class,
      // replaced on every paint.
      // An opened doorway's posts stand only beside STANDING walls too
      // (round 12: "awkward looking vertical door frames between empty
      // spaces" — a frame's post falls with the wall it framed): the cell
      // wears the east/west standing mask, and tiles.css picks the frame,
      // one post, or nothing.
      const doorway = floor && !ruin && opened.has(sq);
      const mask = wallTile || cracked || weak
        ? canonicalMask((N ? 1 : 0) | (E ? 2 : 0) | (S ? 4 : 0) | (W ? 8 : 0) | (solid(f + 1, rank + 1) ? 16 : 0) | (solid(f + 1, rank - 1) ? 32 : 0) | (solid(f - 1, rank - 1) ? 64 : 0) | (solid(f - 1, rank + 1) ? 128 : 0))
        : ruin ? (standing(f, rank + 1) ? 1 : 0) | (standing(f + 1, rank) ? 2 : 0) | (standing(f, rank - 1) ? 4 : 0) | (standing(f - 1, rank) ? 8 : 0)
        : doorway ? (standing(f + 1, rank) ? 2 : 0) | (standing(f - 1, rank) ? 8 : 0)
        : hole ? (isHole(f, rank + 1) ? 1 : 0) | (isHole(f + 1, rank) ? 2 : 0) | (isHole(f, rank - 1) ? 4 : 0) | (isHole(f - 1, rank) ? 8 : 0)
        : -1;
      for (const cls of [...cell.classList]) if (cls.startsWith('wm-') && cls !== `wm-${mask}`) cell.classList.remove(cls);
      if (mask >= 0) cell.classList.add(`wm-${mask}`);
      // Cosmetic props (one span under the piece; removed when the square
      // changes kind — a breached wall drops its torch).
      const decor = decorFor({ wallTile, cracked, mask, f, rank, earned: doorway ? 'doorway' : null });
      let span = cell.querySelector(':scope > .decor');
      if (decor) {
        if (!span) {
          span = document.createElement('span');
          cell.insertBefore(span, cell.querySelector('.piece'));
        }
        span.className = `decor decor-${decor}`;
      } else if (span) span.remove();
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
          delete glyph.dataset.piece;
        } else {
          const letter = v.replace('+', '');
          const isWhite = letter === letter.toUpperCase();
          glyph.textContent = GLYPHS[letter.toLowerCase()] ?? letter;
          glyph.dataset.piece = letter; // the sprite hook (tiles.css [data-pieces] [data-piece])
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
   *  `pit`/`cracked`/`breached` are the gods' TERRAIN residue, one class per
   *  rung so crack and break-through read differently: they outlive the
   *  animation and the enemy's reply, and clear only when the player
   *  moves, so "what just happened" is answerable from the board instead
   *  of the log. A displacement is an ARROW alone (round 13: the from/to
   *  square marks are gone — "the blue arrow is enough"), as is the
   *  enemy's last move (kind 'last'; the last-move square tint is gone).
   *
   *  `heat` (Phase 1.2, Gods debug overlay) is a {square: 'a'|'b'|'c'|'t'}
   *  map painting the Director's candidate census — displacement landing
   *  squares by tier, 't' for terminal crumbles. Debug-only chrome: its CSS
   *  sits before the quake marks so live-game marks win ties. */
  setMarks({ selected = null, targets = [], check = null, arrows = [], pit = null, pits = [], cracked = [], breached = [], heat = {} } = {}) {
    const targetSet = new Set(targets);
    const pitSet = new Set(pit ? [pit, ...pits] : pits); // `pit` is the one-square form
    const crackedSet = new Set(cracked);
    const breachedSet = new Set(breached);
    for (const [sq, cell] of this.cells) {
      cell.classList.toggle('sel', sq === selected);
      cell.classList.toggle('target', targetSet.has(sq));
      cell.classList.toggle('check', sq === check);
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

  /** Art theme: 'hall' | 'castle' | 'crypt' stamps data-theme on the board
   *  (play/tiles.css scopes the repacked tiles to it); null/'' clears it,
   *  which is the in-house drawn set. Cosmetic — no repaint needed. */
  setTheme(name) {
    if (name) this.container.dataset.theme = name;
    else delete this.container.dataset.theme;
  }

  get theme() {
    return this.container.dataset.theme ?? null;
  }

  /** Piece sprites: one of PIECE_SETS stamps data-pieces on the board
   *  (tiles.css paints the sprites); null clears it — the glyphs. */
  setPieces(name) {
    if (name && PIECE_SETS.includes(name)) this.container.dataset.pieces = name;
    else delete this.container.dataset.pieces;
    this.layoutPieceSnap(); // a set has its own native box
  }

  get pieces() {
    return this.container.dataset.pieces ?? null;
  }

  /** Door set: one of DOOR_SETS overrides the theme's own door (and its
   *  open doorway); null = the theme's. */
  setDoors(name) {
    if (name && DOOR_SETS.includes(name)) this.container.dataset.doors = name;
    else delete this.container.dataset.doors;
  }

  /** The piece-sprite fit dials (Options → Piece size / lift / shift /
   *  Pixel-perfect; style.css --piece-scale / --piece-lift / --piece-shift
   *  and data-piece-snap): `scale` multiplies every set's fitted box (1 =
   *  the tallest piece stands 0.96 cell), `lift` raises it and `shift`
   *  moves it right by that fraction of a cell, and `snap` sizes the box
   *  in WHOLE device-pixel multiples of the sprite (--piece-fit /
   *  --piece-box, the set's native pixels from tiles.css) and lands it on
   *  whole device pixels — the art scales without uneven pixels, re-laid
   *  out on every resize. Non-finite values clear to the CSS defaults
   *  (DEFAULT_PIECE_FIT). */
  setPieceFit({ scale, lift, shift, snap = false } = {}) {
    // (snap defaults to OFF here on purpose: a bare setPieceFit({}) — the
    // selftest's "clear" — clears everything; main.mjs passes the dials.)
    const st = this.container.style;
    for (const [k, v] of [['--piece-scale', scale], ['--piece-lift', lift], ['--piece-shift', shift]]) {
      if (Number.isFinite(v)) st.setProperty(k, String(v));
      else st.removeProperty(k);
    }
    this.pieceSnap = !!snap;
    if (this.pieceSnap) this.container.dataset.pieceSnap = '';
    else delete this.container.dataset.pieceSnap;
    this.layoutPieceSnap();
  }

  get pieceFit() {
    const st = this.container.style;
    const num = (v) => (v === '' ? null : Number(v));
    const px = (k) => st.getPropertyValue(k) || null;
    return {
      scale: num(st.getPropertyValue('--piece-scale')),
      lift: num(st.getPropertyValue('--piece-lift')),
      shift: num(st.getPropertyValue('--piece-shift')),
      snap: this.pieceSnap,
      box: this.pieceSnap ? { w: px('--piece-box-w'), h: px('--piece-box-h'), left: px('--piece-left'), top: px('--piece-top') } : null,
    };
  }

  /** Pixel-perfect layout (setPieceFit snap): measure a cell, take the
   *  largest whole device-pixel scale k that keeps the set's box within the
   *  size dial, and publish the box and its offsets in CSS px on the board
   *  (style.css [data-piece-snap] reads them). Cleared when snap is off or
   *  nothing can be measured (no set, a detached board). */
  layoutPieceSnap() {
    const st = this.container.style;
    const clear = () => { for (const k of ['--piece-box-w', '--piece-box-h', '--piece-left', '--piece-top']) st.removeProperty(k); };
    if (!this.pieceSnap) return clear();
    const cs = getComputedStyle(this.container);
    const fit = parseFloat(cs.getPropertyValue('--piece-fit')), box = parseFloat(cs.getPropertyValue('--piece-box'));
    const cw = this.cells.values().next().value?.getBoundingClientRect().width ?? 0;
    if (!(fit > 0) || !(box > 0) || !(cw > 0)) return clear();
    const dial = (k, d) => { const v = parseFloat(st.getPropertyValue(k)); return Number.isFinite(v) ? v : d; };
    const scale = dial('--piece-scale', DEFAULT_PIECE_FIT.scale), lift = dial('--piece-lift', DEFAULT_PIECE_FIT.lift), shift = dial('--piece-shift', DEFAULT_PIECE_FIT.shift);
    const dpr = window.devicePixelRatio || 1;
    const k = Math.max(1, Math.floor((cw * dpr * 0.96 * scale) / fit));
    const w = (box * k) / dpr, h = (fit * k) / dpr;
    const whole = (v) => Math.round(v * dpr) / dpr;
    st.setProperty('--piece-box-w', `${w}px`);
    st.setProperty('--piece-box-h', `${h}px`);
    st.setProperty('--piece-left', `${whole((cw - w) / 2 + shift * cw)}px`);
    st.setProperty('--piece-top', `${whole((cw - h) / 2 - lift * cw)}px`);
  }

  get doors() {
    return this.container.dataset.doors ?? null;
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
    // enormous. Pin the resolved size instead — and pin the PIECE's own box,
    // not the cell's: a tall sprite set stands on its square and rises into
    // the one above, and the clone must keep that box while it travels.
    const g = glyph.getBoundingClientRect();
    clone.style.fontSize = getComputedStyle(glyph).fontSize;
    clone.style.left = `${g.left - base.left}px`;
    clone.style.top = `${g.top - base.top}px`;
    clone.style.width = `${g.width}px`;
    clone.style.height = `${g.height}px`;
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

/** Modal promotion picker (§4.4). No dismissal without choosing. `pieces`
 *  is the board's sprite set, so the buttons show the same art. */
export function pickPromotion(letters, { pieces = null } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'promo-overlay';
    const card = document.createElement('div');
    card.className = 'promo-card';
    if (pieces && PIECE_SETS.includes(pieces)) card.dataset.pieces = pieces;
    const label = document.createElement('div');
    label.className = 'promo-label';
    label.textContent = 'Promote to';
    card.appendChild(label);
    for (const l of letters) {
      const btn = document.createElement('button');
      btn.className = 'promo-btn';
      btn.textContent = GLYPHS[l.toLowerCase()] ?? l;
      btn.dataset.piece = l;
      btn.setAttribute('aria-label', l);
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
