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
/** TALL WALLS (2026-09-12): a wall case and a ruin case are 16×TALL_H sprites (20 rows since the shorter face of 2026-09-15; 24 before)
 *  (board-ui WALL_SPRITE_H — the roof's far half over the face).
 *  Everything else, the door leaves included, is a 16×16 tile. */
const TALL_H = 20; // board-ui WALL_SPRITE_H: the tall wall / ruin sprite (test-debris asserts the two agree)
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
function rgbHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
  let h = 0, s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}
function hslRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round((v + m) * 255))));
}
/** Recolour a rectangle of a canvas TO A TONE: every opaque pixel takes
 *  the tone's hue, its saturation scaled by the tone's over the base's
 *  (the tone's own where the base is near grey) and its lightness scaled
 *  by the tone's over the base's — so the bevels, the mortar and the
 *  ramp keep their shading and the whole thing is the chosen colour.
 *  (The first cut scaled each channel by the tone's over the base's —
 *  the repack tool's floor rule — which turned the pack's olive
 *  highlight flecks GREEN under any tone whose hue differed from the
 *  base's: the designer's "permanent green highlights that I can't
 *  change", 2026-09-15.) `moss`: the flecks' own colour in the baked
 *  tile — with `mossTo` they take that colour exactly (THE MOSS slot);
 *  without it they follow the wall like any pixel. `from` / `to` null:
 *  only the moss is touched. */
function retone(g, sx, sy, w, h, from, to, { moss = null, mossTo = null } = {}) {
  const img = g.getImageData(sx, sy, w, h);
  const d = img.data;
  const base = from && to ? { from: rgbHsl(from), to: rgbHsl(to) } : null;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    if (moss && mossTo && d[i] === moss[0] && d[i + 1] === moss[1] && d[i + 2] === moss[2]) {
      d[i] = mossTo[0]; d[i + 1] = mossTo[1]; d[i + 2] = mossTo[2];
      continue;
    }
    if (!base) continue;
    const [, s, l] = rgbHsl([d[i], d[i + 1], d[i + 2]]);
    const [H1, S1, L1] = base.to, [, S0, L0] = base.from;
    const s2 = S0 > 0.05 ? Math.min(1, (s * S1) / S0) : S1;
    const l2 = L0 > 0 ? Math.min(1, (l * L1) / L0) : l;
    const [r, gg, b] = hslRgb(H1, s2, l2);
    d[i] = r; d[i + 1] = gg; d[i + 2] = b;
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
  // tones, for the floor and walls."; 2026-09-15, THE MOSS: "a color
  // selector for the green 'moss' highlights in the brick work of the
  // walls"). A tone key is a theme name or 'classic' (the drawn set). A
  // row's BASES are the palette the repack tool recorded on it — the
  // floor's base colour, the wall's brick, the MOSS (the brick face's
  // highlight flecks, one flat colour); a floor or wall tone recolours
  // every floor, or every wall and ruin, tile of the row to the tone
  // (`retone`: the tone's hue, the pixel's saturation and lightness scaled
  // from the base's to the tone's, so the bevels, the mortar and the
  // void's ramp keep their shading), and the moss tone replaces the
  // flecks' colour exactly — into a tinted copy of the tileset that every
  // tile is served from. Doors, props, cracks and pieces are untouched.
  /** The tileset every tile is drawn from: the tinted copy when a tone is set. */
  #src() {
    return this.tinted ?? this.tiles;
  }
  #toneRow(key) {
    return this.index.themes[key && key !== 'classic' ? key : CLASSIC] ?? null;
  }
  /** A row's own base colours { floor, wall, moss } (#rrggbb, or null
   *  where the row lacks one) — the palette the repack tool recorded on
   *  the row (the floor's base, the wall's brick, the moss flecks'
   *  colour), else read off the tiles (the first flagstone's and the wall
   *  face's dominant colours; no moss) — or null. */
  baseTones(key) {
    const k = key ?? 'classic';
    if (this.bases.has(k)) return this.bases.get(k);
    const row = this.#toneRow(k);
    let out = null;
    if (row?.palette) out = { floor: row.palette.floor ?? null, wall: row.palette.wall ?? null, moss: row.palette.moss ?? null };
    else if (row && this.tiles && typeof document !== 'undefined') {
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
      out = { floor: dominant(row.tiles['floor-1'], 0, TILE), wall: dominant(row.tiles['wall-10'], 8, TALL_H - 8), moss: null };
    }
    this.bases.set(k, out);
    return out;
  }
  /** Set (or, with null, clear) a row's tones { floor?, wall?, moss? } (#rrggbb) and rebuild the tinted tileset. */
  setTones(key, tones) {
    const k = key ?? 'classic';
    const t = tones && (tones.floor || tones.wall || tones.moss) ? { ...tones } : null;
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
      const moss = base.moss ? hexRgb(base.moss) : null;
      const mossTo = moss && tones.moss ? hexRgb(tones.moss) : null;
      for (const [role, cell] of Object.entries(row.tiles)) {
        const b = baseRole(role);
        const isFloor = b === 'floor', isWall = b === 'wall' || b === 'ruin';
        if (isFloor) {
          if (tones.floor && base.floor) retone(g, cell.col * TILE, row.row * this.rowH, TILE, TILE, hexRgb(base.floor), hexRgb(tones.floor));
        } else if (isWall) {
          const wall = !!(tones.wall && base.wall);
          if (wall || mossTo) retone(g, cell.col * TILE, row.row * this.rowH, TILE, TALL_H, wall ? hexRgb(base.wall) : null, wall ? hexRgb(tones.wall) : null, { moss, mossTo });
        }
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
