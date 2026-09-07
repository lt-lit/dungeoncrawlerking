// THE PIECE TIERS (2026-09-07, Options → Piece pixels "tile grid"): a piece
// sprite cut into 16×16 TILES, one per board square it covers, so the board
// can paint each exactly as it paints the floor — a cell-sized box with
// `center / 100% 100%`, the ONE construction that lands on the floor's
// device-pixel grid in both Chromium and Firefox (phase0/harness/
// piece-grid.mjs). Any other box, and any background offset by whole tile
// pixels, drifts by a device pixel on some rows — so a piece's POSITION
// (its lift above the square's bottom edge, its shift off centre, in whole
// tile pixels) is BAKED INTO THE TILES here, never expressed in CSS.
//
// The canvas is three squares tall (CANVAS_ROWS 48): `lo` is the piece's
// own square, `mid` the square north of it, `hi` the one above that. The
// sprite is the set's FITTED tile (bw × fit, the foot on its bottom row,
// tiles.css --piece-<fen>); it stands with its foot `lift` rows above the
// square's bottom edge, centred on the tile's 16 columns and moved `shift`
// columns east; whatever falls outside the three tiles is cut (a wider
// set's box loses its outer columns — deja-view's knights one outline
// column). A tier with no opaque pixel is null: the board paints nothing
// there.
//
// Pure and browser-safe (Uint8Array RGBA in, Uint8Array RGBA out): the
// board bakes lifted tiers at runtime (board-ui layoutPieceTiers, the
// sprite decoded off the DOM), the repack tool and gen-piece-halves.mjs
// write the lift-0 tiers into tiles.css (phase0/lib/piecehalves.mjs).
export const TILE = 16;
export const TIERS = ['lo', 'mid', 'hi'];
export const CANVAS_ROWS = TILE * TIERS.length;
/** The tile-grid placement dials, in whole tile pixels (the slider ranges). */
export const TILE_LIFT_RANGE = [-4, 20];
export const TILE_SHIFT_RANGE = [-7, 7];

const clampInt = (v, [lo, hi]) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

/** The per-cell custom properties that place a piece's upper tiers
 *  (style.css: the ::before at --tier-mid-top / --tier-mid-h, the ::after
 *  at --tier-hi-top / --tier-hi-h). */
export const TIER_VARS = ['--tier-mid-top', '--tier-mid-h', '--tier-hi-top', '--tier-hi-h'];

/** A cell's tier boxes from MEASURED rectangles ({ top, height } of the
 *  cell, the square north of it and the one above that; null where the
 *  board ends): the offsets that make a tier's box exactly that square's.
 *  `top: -100%` is not that: a grid hands its sub-pixel remainder to some
 *  rows (Chromium at one width: 35.6875-px rows above 35.70313-px ones),
 *  and 1/32 px off flips a device row (phase0/harness/piece-grid.mjs).
 *  Returns the properties to set; a missing square leaves its pair out
 *  (the stylesheet's fallback — above the board there is no floor to
 *  align with). */
export function tierRowVars(cell, north, far) {
  const out = {};
  if (north) { out['--tier-mid-top'] = `${north.top - cell.top}px`; out['--tier-mid-h'] = `${north.height}px`; }
  if (far) { out['--tier-hi-top'] = `${far.top - cell.top}px`; out['--tier-hi-h'] = `${far.height}px`; }
  return out;
}

/**
 * @param {{width:number, height:number, data:Uint8Array|Uint8ClampedArray}} sprite the fitted tile (bw × fit RGBA)
 * @param {{lift?:number, shift?:number}} at whole tile pixels
 * @returns {{lo:object|null, mid:object|null, hi:object|null}} 16×16 RGBA tiers, null where empty
 */
export function pieceTiers(sprite, { lift = 0, shift = 0 } = {}) {
  const { width: bw, height: bh, data } = sprite;
  const dy0 = CANVAS_ROWS - bh - clampInt(lift, TILE_LIFT_RANGE);
  const dx0 = Math.floor((TILE - bw) / 2) + clampInt(shift, TILE_SHIFT_RANGE);
  const canvas = new Uint8Array(TILE * CANVAS_ROWS * 4);
  for (let sy = 0; sy < bh; sy++) {
    const dy = dy0 + sy;
    if (dy < 0 || dy >= CANVAS_ROWS) continue;
    for (let sx = 0; sx < bw; sx++) {
      const dx = dx0 + sx;
      if (dx < 0 || dx >= TILE) continue;
      const s = (sy * bw + sx) * 4, d = (dy * TILE + dx) * 4;
      canvas[d] = data[s];
      canvas[d + 1] = data[s + 1];
      canvas[d + 2] = data[s + 2];
      canvas[d + 3] = data[s + 3];
    }
  }
  const out = {};
  TIERS.forEach((name, i) => {
    // lo = the bottom 16 rows, mid the 16 above, hi the top 16.
    const top = CANVAS_ROWS - TILE * (i + 1);
    const tier = canvas.subarray(top * TILE * 4, (top + TILE) * TILE * 4);
    let any = false;
    for (let a = 3; a < tier.length; a += 4) if (tier[a]) { any = true; break; }
    out[name] = any ? { width: TILE, height: TILE, data: new Uint8Array(tier) } : null;
  });
  return out;
}
