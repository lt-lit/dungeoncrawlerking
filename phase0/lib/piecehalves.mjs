// The TILE-GRID piece tiers in tiles.css (2026-09-07, Options → Piece pixels
// "tile grid"): a piece drawn with the SAME pixel size and alignment as the
// 16×16 stage tiles. The cut itself — a fitted sprite into 16×16 tiles, one
// per square it covers, its lift and shift baked in — is play/js/
// piecetiers.mjs (browser-safe; the board re-cuts lifted tiers at runtime).
// This is the Node adapter that writes the LIFT-0 tiers into tiles.css: the
// piece's own square (`lo`) and the square above (`mid`); the third tier
// (`hi`, two squares up) is empty for every set at lift 0 and is left to
// the rule's fallback (`none`).
//
// One implementation for the repack tool (which builds the atlas) and
// gen-piece-halves.mjs (which reads the committed atlas back when the
// packs are not on disk), so the two can never emit different bytes.
import { encodePng } from './png.mjs';
import { pieceTiers, TIERS, TILE } from '../../play/js/piecetiers.mjs';

export { TILE };

/** The lift-0 tiers of one piece: `tile` is its fitted bw×fit RGBA image
 *  (the foot on the bottom row — the atlas tile, tiles.css --piece-<fen>).
 *  Returns { lo, mid, hi }: 16×16 RGBA images or null where empty. */
export function pieceHalves(tile) {
  return pieceTiers(tile, { lift: 0, shift: 0 });
}

const dataUrl = (img) => `url("data:image/png;base64,${encodePng({ width: img.width, height: img.height, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength) }).toString('base64')}")`;

/** The tiles.css declarations for a piece's static tiers (indented two
 *  spaces, inside the set's `[data-pieces=…]` block): `lo` always, `mid`
 *  when the set rises into the square above (else `none`), `hi` only if
 *  some future set were three squares tall. */
export function halvesDecl(fen, tiers) {
  const out = [`  --piece-${fen}-lo: ${tiers.lo ? dataUrl(tiers.lo) : 'none'};`, `  --piece-${fen}-mid: ${tiers.mid ? dataUrl(tiers.mid) : 'none'};`];
  if (tiers.hi) out.push(`  --piece-${fen}-hi: ${dataUrl(tiers.hi)};`);
  return out;
}

/** The per-letter rule mapping a piece's tiers onto the element (next to
 *  the existing --piece-img line); `hi` falls back to nothing. The board
 *  overrides --piece-<fen>-<tier> inline when it bakes a lifted piece. */
export const halvesRule = (fen) => `[data-pieces] [data-piece="${fen}"] { ${TIERS.map((t) => `--piece-${t}: var(--piece-${fen}-${t}${t === 'hi' ? ', none' : ''});`).join(' ')} }`;
