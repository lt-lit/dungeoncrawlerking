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
// (`door-edge`, 2026-09-11) from that theme's row — a decor role a theme
// lacks is nothing, and the
// classic set answers
// with its own drawings. Props (crate / chest / barrel / wreckage and their
// variants) are 32 tall: the lower half is the square, the upper half the
// square north; a wall or ruin case is 24 tall (TALL WALLS, 2026-09-12:
// the roof's far half over the face).
export const TILE = 16;
export const PIECE_ORDER = 'pnrbqk';
/** Furniture roles that are 16×32 prop boxes in the atlas (repack-tiles placeProp). */
const PROP_ROLES = new Set(['crate', 'chest', 'barrel', 'wreckage']);
/** TALL WALLS (2026-09-12): a wall case and a ruin case are 16×24 sprites
 *  (board-ui WALL_SPRITE_H — the roof's far half over the face).
 *  Everything else, the door leaves included, is a 16×16 tile. */
const TALL_H = 24;
/** A role's box height by its base name (`wall-10` → wall, `ruin-5` → ruin). */
function roleHeight(base) {
  if (PROP_ROLES.has(base)) return 2 * TILE;
  if (base === 'wall' || base === 'ruin') return TALL_H;
  return TILE;
}
/** The atlas row of the in-house drawings (the classic set + the cracks). */
const CLASSIC = 'classic';
/** The classic set's tile per family: its own wall and ruin cases (the
 *  crypt's tall walls in the classic palette since 2026-09-12), the
 *  wreckage and a double door's half its crate and door. */
const CLASSIC_ROLE = { crate: 'crate', door: 'door', 'door2-l': 'door', 'door2-r': 'door', 'door-edge': 'door-edge', barrel: 'barrel', chest: 'chest', wreckage: 'crate', rubble: 'rubble' };

const baseRole = (role) => role.replace(/-\d+$/, '');
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
/** Recolour a rectangle of a canvas by the ratio method (the repack
 *  tool's floor rule): every opaque pixel keeps its shading relative to
 *  `from` and takes `to` — channel-wise to × pixel / from, clamped. */
function retone(g, sx, sy, w, h, from, to) {
  const img = g.getImageData(sx, sy, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    for (let c = 0; c < 3; c++) d[i + c] = from[c] ? Math.max(0, Math.min(255, Math.round((to[c] * d[i + c]) / from[c]))) : d[i + c];
  }
  g.putImageData(img, sx, sy);
}
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
    // THE TONES (2026-09-12): per tone key (a theme, or 'classic'), the
    // floor and wall base colours the designer set; `tinted` is the
    // tileset with those rows recoloured, served in place of `tiles`.
    this.toneMap = new Map();
    this.tinted = null;
    this.bases = new Map();
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
    return { src: this.#src(), sx: cell.col * TILE, sy: row.row * this.rowH, w: TILE, h: roleHeight(b), role: name, theme: srcTheme };
  }

  // ------------------------------------------------------------ THE TONES
  // (2026-09-12, the designer: "Can I get an in-game color selector? 2
  // tones, for the floor and walls.") A tone key is a theme name or
  // 'classic' (the drawn set). A row's FLOOR BASE is the dominant colour
  // of its first flagstone, its WALL BASE the dominant colour of its
  // east–west wall's face (the brick); a tone recolours every floor,
  // wall and ruin tile of the row by the repack tool's ratio rule (each
  // pixel keeps its shading relative to the base and takes the tone), so
  // the bevels, the mortar, the crack flecks and the void's ramp all
  // follow, into a tinted copy of the tileset that every tile is served
  // from. Doors, props, cracks and pieces are untouched.
  /** The tileset every tile is drawn from: the tinted copy when a tone is set. */
  #src() {
    return this.tinted ?? this.tiles;
  }
  #toneRow(key) {
    return this.index.themes[key && key !== 'classic' ? key : CLASSIC] ?? null;
  }
  /** A row's own base colours { floor, wall } (#rrggbb, or null where the row lacks the tile), or null. */
  baseTones(key) {
    const k = key ?? 'classic';
    if (this.bases.has(k)) return this.bases.get(k);
    const row = this.#toneRow(k);
    let out = null;
    if (row && this.tiles && typeof document !== 'undefined') {
      const g = this.tiles.getContext('2d');
      const dominant = (cell, y0, h) => {
        if (!cell) return null;
        const d = g.getImageData(cell.col * TILE, row.row * this.rowH + y0, TILE, h).data;
        const m = new Map();
        for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; const c = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]; m.set(c, (m.get(c) ?? 0) + 1); }
        let best = null, n = 0;
        for (const [c, cnt] of m) if (cnt > n) { best = c; n = cnt; }
        return best === null ? null : `#${best.toString(16).padStart(6, '0')}`;
      };
      out = { floor: dominant(row.tiles['floor-1'], 0, TILE), wall: dominant(row.tiles['wall-10'], 8, TILE) };
    }
    this.bases.set(k, out);
    return out;
  }
  /** Set (or, with null, clear) a row's tones { floor?, wall? } (#rrggbb) and rebuild the tinted tileset. */
  setTones(key, tones) {
    const k = key ?? 'classic';
    const t = tones && (tones.floor || tones.wall) ? { ...tones } : null;
    if (t) this.toneMap.set(k, t);
    else this.toneMap.delete(k);
    this.#retint();
  }
  /** The tones a row wears, or null. */
  tonesOf(key) {
    return this.toneMap.get(key ?? 'classic') ?? null;
  }
  #retint() {
    if (!this.tiles || typeof document === 'undefined') return;
    if (!this.toneMap.size) { this.tinted = null; return; }
    const c = document.createElement('canvas');
    c.width = this.tiles.width;
    c.height = this.tiles.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.drawImage(this.tiles, 0, 0);
    for (const [k, tones] of this.toneMap) {
      const row = this.#toneRow(k);
      const base = this.baseTones(k);
      if (!row || !base) continue;
      for (const [role, cell] of Object.entries(row.tiles)) {
        const b = baseRole(role);
        const isFloor = b === 'floor', isWall = b === 'wall' || b === 'ruin';
        const to = isFloor ? tones.floor : isWall ? tones.wall : null;
        const from = isFloor ? base.floor : isWall ? base.wall : null;
        if (!to || !from) continue;
        retone(g, cell.col * TILE, row.row * this.rowH, TILE, isWall ? TALL_H : TILE, hexRgb(from), hexRgb(to));
      }
    }
    this.tinted = c;
  }

  /** A cell of the classic row as a drawImage rectangle, or null: its
   *  drawn props are 16×16 tiles (never prop boxes), its walls and ruins
   *  tall sprites. */
  #classicCell(name) {
    const row = this.index.themes[CLASSIC];
    const cell = row?.tiles[name];
    if (!cell) return null;
    const b = baseRole(name);
    const h = b === 'wall' || b === 'ruin' ? TALL_H : TILE;
    return { src: this.#src(), sx: cell.col * TILE, sy: row.row * this.rowH, w: TILE, h, role: name, theme: null };
  }

  /** The classic (in-house) set's sprite for a role, or null: its own wall
   *  and ruin cases, the crate for the wreckage, the leaf for a double
   *  door's half, the designer's profile door in its own colours
   *  (door-edge), the flagstones in its own grey since the palette round
   *  (2026-09-12); no hole or decor (the gradient pit is the canvas
   *  board's own). */
  classicTile(role) {
    const b = baseRole(role);
    if (b === 'wall' || b === 'ruin' || b === 'floor') return this.#classicCell(role);
    const name = CLASSIC_ROLE[b];
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
