// THE ATLAS (Phase 2, 2026-09-07 — the 16×16 renderer's art source).
//
// One PNG of tiles (play/img/tileset.png: a row per theme, a column per
// role, 16 px wide, a theme row 32 px tall because furniture PROPS are
// 16×32 boxes) plus one PNG of pieces (play/img/pieces.png: a row per set,
// twelve 32-px cells — white p n r b q k, then black — the fitted sprite in
// the cell's bottom-left) and the index the repack tool writes next to
// them (play/img/tileset.json). The canvas board draws straight off these
// two images with drawImage — no data URIs, no CSS custom properties, no
// per-tile decode — which is what play/tiles.css (160 KB of the SAME
// pixels inlined) is for the DOM board. Both come from one run of
// phase0/harness/repack-tiles.mjs, so a tile here and a tile there are
// byte-identical; the parity gate (phase0/harness/canvas-parity.mjs)
// checks exactly that on the real board.
//
// The in-house drawings that never went into the PNG — THE CRACK (four
// drawings, every theme wears them on a weakened wall) and the "classic"
// set (the drawn wall block, crate, door, barrel, chest, rubble heap) — are
// SVG data URIs in play/style.css; `cssSprite` decodes one off a CSS
// custom property into a 16×16 bitmap, exactly as the debris sampler in
// main.mjs does. Moving them into the PNG atlas is the repack tool's job,
// a later step.
//
// Role resolution (`tileOf`) is the CSS cascade's, on data: a skin VARIANT
// the theme lacks wraps around (barrel-7 on a theme with five barrels is
// its second, as tiles.css aliases it), a double door's half falls back to
// the leaf, a chosen DOOR SET takes its door and double from that theme's
// row, a decor role a theme lacks is nothing, and the classic set answers
// with its SVG sprites. Props (crate / chest / barrel / wreckage and their
// variants) are 32 tall: the lower half is the square, the upper half the
// square north.
export const TILE = 16;
export const PIECE_ORDER = 'pnrbqk';
/** Furniture roles that are 16×32 prop boxes in the atlas (repack-tiles placeProp). */
const PROP_ROLES = new Set(['crate', 'chest', 'barrel', 'wreckage']);
/** The in-house (classic) set's sprites, by role → the style.css property. */
const CLASSIC_VARS = { wall: '--tile-wall', crate: '--sprite-crate', door: '--sprite-door', barrel: '--sprite-barrel', chest: '--sprite-chest', wreckage: '--sprite-crate', rubble: '--sprite-rubble' };

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
    this.themes = Object.keys(index.themes);
    this.roles = index.roles;
    this.rowH = index.row ?? 2 * TILE;
    this.cssCache = new Map(); // css property → { canvas, w, h } | null
    this.cssInflight = new Map();
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
   * Synchronous; classic-set sprites answer only once `warmCss` decoded them.
   */
  tileOf(theme, role, { doors = null } = {}) {
    if (!theme) return this.classicTile(role);
    const t = this.index.themes[theme];
    if (!t) return null;
    let name = role;
    let srcTheme = theme;
    const b = baseRole(role);
    if ((b === 'door' || b === 'door2-l' || b === 'door2-r') && doors && this.index.themes[doors]) srcTheme = doors;
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

  /** The classic (in-house) set's sprite for a role — an SVG off style.css,
   *  decoded by warmCss — or null. The wall is one block for every case. */
  classicTile(role) {
    const b = baseRole(role);
    const key = b.startsWith('wall') ? 'wall' : b.startsWith('ruin') ? 'rubble' : b;
    const prop = CLASSIC_VARS[key];
    if (!prop) return null;
    const s = this.cssCache.get(prop);
    return s ? { src: s.canvas, sx: 0, sy: 0, w: s.w, h: s.h, role: key, theme: null } : null;
  }

  /** The crack drawing n (1…4) — style.css --tile-crack-n, once warmed. */
  crack(n) {
    const s = this.cssCache.get(`--tile-crack-${n}`);
    return s ? { src: s.canvas, sx: 0, sy: 0, w: s.w, h: s.h } : null;
  }

  /**
   * Decode the in-house SVG sprites off `el`'s computed style (style.css
   * :root carries them, so any element in the document will do): the four
   * cracks and, for the classic set, its drawings. Idempotent; resolves
   * when every named property is decoded (or found missing).
   */
  async warmCss(el, names = [...Array.from({ length: 4 }, (_, i) => `--tile-crack-${i + 1}`), ...Object.values(CLASSIC_VARS)]) {
    if (typeof getComputedStyle === 'undefined' || !el) return;
    const cs = getComputedStyle(el);
    await Promise.all([...new Set(names)].map(async (name) => {
      if (this.cssCache.has(name)) return;
      if (this.cssInflight.has(name)) return this.cssInflight.get(name);
      const job = (async () => {
        let out = null;
        try {
          const m = cs.getPropertyValue(name).trim().match(/url\(\s*["']?(.*?)["']?\s*\)/);
          if (m) {
            const { img, w, h } = await loadImage(m[1]);
            // An SVG's natural size is its viewBox (16×16 here); rasterise at that size, crisp.
            const size = w > 0 && h > 0 ? { w, h } : { w: TILE, h: TILE };
            out = { canvas: canvasOf(img, size.w, size.h), w: size.w, h: size.h };
          }
        } catch {
          /* a sprite that will not decode paints nothing */
        }
        this.cssCache.set(name, out);
        this.cssInflight.delete(name);
      })();
      this.cssInflight.set(name, job);
      return job;
    }));
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
