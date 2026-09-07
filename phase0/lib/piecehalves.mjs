// The TILE-GRID piece sprites (2026-09-07, Options → Piece pixels "tile
// grid"): a piece drawn with the SAME pixel size and alignment as the 16×16
// stage tiles. Measured in Playwright's Chromium and Firefox
// (phase0/harness/piece-grid.mjs): the only construction that lands on the
// floor tile's device-pixel grid in BOTH browsers, at every fractional cell
// size, is a 16×16 image painted exactly like the floor — a cell-sized box
// with `center / 100% 100%`. A single box of any other size (23/16 of the
// cell, two cells, a 200% background on the cell) drifts by a device pixel
// on some rows in one browser or the other, and a background offset by
// whole tile pixels drifts too. So every piece sprite is cut into TWO 16×16
// halves off its 32-row atlas cell: `lo` (rows 16..31 — the body, painted
// in the piece's own square) and `hi` (rows 0..15 — the head, painted in a
// second cell-sized box one cell up: `::before` at top:-100%). Width is the
// tile's 16 columns: a wider box (deja-view's 18) keeps its centre 16.
//
// One implementation for the repack tool (which builds the atlas) and
// gen-piece-halves.mjs (which reads the committed atlas back when the
// packs are not on disk), so the two can never emit different bytes.
import { blank, crop, blit, encodePng } from './png.mjs';

export const TILE = 16;
export const ATLAS_CELL = 32;

/** The two halves of one piece: `cell` is its bw×32 atlas cell (the fitted
 *  sprite bottom-aligned, blank above). Returns { lo, hi } 16×16 RGBA
 *  images, or `hi: null` when the upper half is fully transparent (a set no
 *  taller than a tile paints no head). */
export function pieceHalves(cell) {
  if (cell.height !== ATLAS_CELL) throw new Error(`pieceHalves: a ${ATLAS_CELL}-row atlas cell, got ${cell.height}`);
  const x0 = Math.max(0, Math.floor((cell.width - TILE) / 2));
  const w = Math.min(TILE, cell.width);
  const half = (y) => {
    const img = blank(TILE, TILE);
    blit(img, crop(cell, x0, y, w, TILE), Math.floor((TILE - w) / 2), 0);
    return img;
  };
  const hi = half(0);
  let any = false;
  for (let i = 3; i < hi.data.length; i += 4) if (hi.data[i]) { any = true; break; }
  return { lo: half(TILE), hi: any ? hi : null };
}

const dataUrl = (img) => `url("data:image/png;base64,${encodePng(img).toString('base64')}")`;

/** The two tiles.css declarations for a piece's halves (indented two
 *  spaces, inside the set's `[data-pieces=…]` block). */
export function halvesDecl(fen, { lo, hi }) {
  return [`  --piece-${fen}-lo: ${dataUrl(lo)};`, `  --piece-${fen}-hi: ${hi ? dataUrl(hi) : 'none'};`];
}

/** The per-letter rule mapping a piece's halves onto the element (next to
 *  the existing --piece-img line). */
export const halvesRule = (fen) => `[data-pieces] [data-piece="${fen}"] { --piece-lo: var(--piece-${fen}-lo); --piece-hi: var(--piece-${fen}-hi); }`;
