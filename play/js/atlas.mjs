// THE ATLAS (Phase 2, 2026-09-07 — the 16×16 renderer's art source).
//
// One PNG of tiles (play/img/tileset.png: a row per theme, a column per
// role, 16 px wide, a theme row 32 px tall because furniture PROPS are
// 16×32 boxes) plus one PNG of pieces (play/img/pieces.png: a row per set,
// twelve 32-px cells — white p n r b q k, then black — the fitted sprite in
// the cell's bottom-left) and the index the repack tool writes next to
// them (play/img/tileset.json). The canvas board draws straight off these
// two images with drawImage — no data URIs, no CSS custom properties, no
// per-tile decode. (play/tiles.css, the same pixels inlined for the DOM
// board, retired with that board on 2026-09-07; the atlas is the one art
// source now — the board, the debris sampler and the options legend all
// read it.)
//
// The in-house drawings — THE CRACK (four drawings, every theme wears them
// on a weakened wall) and the `classic` set (the drawn wall block, crate,
// door, barrel, chest, rubble heap: what a stage without a theme wears) —
// are the atlas's `classic` row (phase0/lib/inhouse.mjs draws them, the
// repack tool writes them); until 2026-09-07 they were SVG data URIs in
// play/style.css decoded off the cascade at boot.
//
// Role resolution (`tileOf`) is the CSS cascade's, on data: a skin VARIANT
// the theme lacks wraps around (barrel-7 on a theme with five barrels is
// its second, as tiles.css aliases it), a double door's half falls back to
// the leaf, a chosen DOOR SET takes its door, double and edge-on leaf
// (`door-edge`, 2026-09-11) from that theme's row — never the doorway posts,
// which are the wall's — a decor role a theme lacks is nothing, and the
// classic set answers
// with its SVG sprites. Props (crate / chest / barrel / wreckage and their
// variants) are 32 tall: the lower half is the square, the upper half the
// square north.
export const TILE = 16;
export const PIECE_ORDER = 'pnrbqk';
/** Furniture roles that are 16×32 prop boxes in the atlas (repack-tiles placeProp). */
const PROP_ROLES = new Set(['crate', 'chest', 'barrel', 'wreckage']);
/** The atlas row of the in-house drawings (the classic set + the cracks). */
const CLASSIC = 'classic';
/** The classic set's one tile per family: any wall case is its block, a
 *  ruin its heap, the wreckage and a double door's half its crate and door. */
const CLASSIC_ROLE = { wall: 'wall', crate: 'crate', door: 'door', 'door2-l': 'door', 'door2-r': 'door', 'door-edge': 'door-edge', barrel: 'barrel', chest: 'chest', wreckage: 'crate', rubble: 'rubble', ruin: 'rubble' };

const baseRole = (role) => role.replace(/-\d+$/, '');
const variantOf = (role) => { const m = role.match(/-(\d+)$/); return m ? parseInt(m[1], 10) : 1; };

/** Decode an image URL into { img, w, h } (the image itself is the drawImage source). */
async function loadImage(src) {
  const img = new Image();
  img.decoding = 'sync';
  img.src = src;
  await img.decode();
  return { img, w: img.naturalWidth, h: img.naturalHeight };
}

/** A canvas holding one decoded image (a drawImage source that never
 *  re-decodes, and a pixel source for getImageData). Off the DOM. */
function canvasOf(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, w, h);
  return c;
}

export class Atlas {
  /**
   * @param {object} index play/img/tileset.json
   * @param {HTMLCanvasElement} tiles the decoded tileset
   * @param {HTMLCanvasElement} pieces the decoded piece atlas
   */
  constructor(index, tiles, pieces) {
    this.index = index;
    this.tiles = tiles;
    this.pieces = pieces;
    this.themes = Object.keys(index.themes).filter((t) => !index.themes[t].inhouse); // the art sets (the classic row is the fallback, not a theme)
    this.roles = index.roles;
    this.rowH = index.row ?? 2 * TILE;
    // Variant counts per (theme, base role): how many crops the theme lists.
    this.variants = {};
    for (const [theme, t] of Object.entries(index.themes)) {
      const counts = {};
      for (const role of Object.keys(t.tiles)) {
        const b = baseRole(role);
        counts[b] = Math.max(counts[b] ?? 1, variantOf(role));
      }
      this.variants[theme] = counts;
    }
  }

  /** Fetch and decode the atlas from play/img/ (relative to this module). */
  static async load(base = new URL('../img/', import.meta.url)) {
    const [index, tiles, pieces] = await Promise.all([
      fetch(new URL('tileset.json', base)).then((r) => { if (!r.ok) throw new Error(`atlas: ${r.status} for tileset.json`); return r.json(); }),
      loadImage(new URL('tileset.png', base).href),
      loadImage(new URL('pieces.png', base).href),
    ]);
    return new Atlas(index, canvasOf(tiles.img, tiles.w, tiles.h), canvasOf(pieces.img, pieces.w, pieces.h));
  }

  /** The theme's row in the tile atlas, or -1. */
  themeRow(theme) {
    return this.index.themes[theme]?.row ?? -1;
  }

  /** Is `role` (exactly) in the theme's row? */
  has(theme, role) {
    return !!this.index.themes[theme]?.tiles[role];
  }

  /**
   * The tile a theme paints for a role, as a drawImage source rectangle:
   * { src, sx, sy, w, h } — or null when the theme (or the classic set)
   * has nothing for it. `doors` names the door set whose leaf / double
   * replaces the theme's own (board-ui DOOR_SETS = the theme names).
   * Synchronous.
   */
  tileOf(theme, role, { doors = null } = {}) {
    if (!theme) return this.classicTile(role);
    const t = this.index.themes[theme];
    if (!t) return null;
    let name = role;
    let srcTheme = theme;
    const b = baseRole(role);
    if ((b === 'door' || b === 'door2-l' || b === 'door2-r' || b === 'door-edge') && doors && this.index.themes[doors]) srcTheme = doors;
    const row = this.index.themes[srcTheme];
    if (!row.tiles[name]) {
      // A skin variant the theme lacks wraps around its own variants.
      const n = variantOf(role);
      if (n > 1 && PROP_ROLES.has(b)) {
        const count = this.variants[srcTheme][b] ?? 1;
        const v = ((n - 1) % count) + 1;
        name = v > 1 ? `${b}-${v}` : b;
      } else if (b === 'door2-l' || b === 'door2-r') name = 'door';
    }
    const cell = row.tiles[name];
    if (!cell) return null;
    const h = PROP_ROLES.has(b) ? 2 * TILE : TILE;
    return { src: this.tiles, sx: cell.col * TILE, sy: row.row * this.rowH, w: TILE, h, role: name, theme: srcTheme };
  }

  /** A cell of the classic row as a 16×16 drawImage rectangle, or null. */
  #classicCell(name) {
    const row = this.index.themes[CLASSIC];
    const cell = row?.tiles[name];
    if (!cell) return null;
    return { src: this.tiles, sx: cell.col * TILE, sy: row.row * this.rowH, w: TILE, h: TILE, role: name, theme: null };
  }

  /** The classic (in-house) set's sprite for a role, or null: one block for
   *  every wall case, the heap for every ruin, the crate for the wreckage,
   *  the leaf for a double door's half, its own edge-on door (posts and
   *  leaf in one tile); no floor, hole, decor or doorway
   *  (the flat colours and the gradient pit are the canvas board's own). */
  classicTile(role) {
    const b = baseRole(role);
    const key = b.startsWith('wall') ? 'wall' : b.startsWith('ruin') ? 'ruin' : b;
    const name = CLASSIC_ROLE[key];
    return name ? this.#classicCell(name) : null;
  }

  /** The crack drawing n (1…CRACK_VARIANTS), or null. */
  crack(n) {
    return this.#classicCell(`crack-${n}`);
  }

  /** A piece set's box [w, h] (its native fitted size), or null. */
  pieceBox(set) {
    const s = this.index.pieces?.sets?.[set];
    return s ? s.box : null;
  }

  /**
   * A piece sprite as a drawImage rectangle: { src, sx, sy, w, h } for the
   * FEN letter (case = colour) in the set, or null. The fitted tile sits
   * in the bottom-left of its 32-px atlas cell.
   */
  pieceOf(set, fen) {
    const s = this.index.pieces?.sets?.[set];
    if (!s) return null;
    const letter = fen.replace('+', '');
    const i = PIECE_ORDER.indexOf(letter.toLowerCase());
    if (i < 0) return null;
    const white = letter === letter.toUpperCase();
    const cell = this.index.pieces.cell ?? 32;
    const [bw, bh] = s.box;
    return { src: this.pieces, sx: ((white ? 0 : 6) + i) * cell, sy: s.row * cell + (cell - bh), w: bw, h: bh };
  }

  /** The RGBA pixels of a rectangle of a source (for samplers and tests). */
  static pixelsOf({ src, sx, sy, w, h }) {
    const g = src.getContext('2d', { willReadFrequently: true });
    return { w, h, data: g.getImageData(sx, sy, w, h).data };
  }
}
