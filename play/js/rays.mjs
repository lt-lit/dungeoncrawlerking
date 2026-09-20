// PORTALS ON THE GRID — THE BODY RULE (2026-09-18 as Portals v2; the tunnel
// retired 2026-09-19 as Portals v4; brief §4.7; engine/patches/portals-body.patch).
//
// The engine's rule, mirrored for the game's own grid code: a linked portal
// square is a BODY — every line stops at it, whatever stands on it — and
// nothing runs THROUGH a pair: a rider's line that reaches a portal square
// ends there, and the move onto it is the ordinary landing (the piece
// appears on the twin, or swaps with whatever stands there). Halves are not
// bodies until linked (they are not in the pairs). A pawn's double step never
// crosses a portal square. (v2's tunnel — an empty pair carrying a rider's
// line on from the twin — is gone: the designer, 2026-09-19, "everything
// going thru a portal simply lands on the exit portal now"; it may return as
// a late-game upgrade, and its grid half is in the history at the v2 commit.)
//
// ONE walker (`walkRay`) serves threat.mjs (the gods' landing guard and the
// exposure rule) and tactics.mjs (attacks, pins and skewers, the loser's
// terrain reach). A grid carries its pairs as a non-enumerable `portals`
// property (withPortals / copyGrid), so every consumer sees the same board
// without a signature change; a grid without the property walks plain lines,
// as before.

import { parseBoard, parsePortalField, splitFen } from './fen.mjs';

/** 'e4' → { f, r } (0-based, r from the bottom). */
export const sqFR = (sq) => ({ f: sq.charCodeAt(0) - 97, r: parseInt(sq.slice(1), 10) - 1 });
/** { f, r } → 'e4'. */
export const SQ = (f, r) => String.fromCharCode(97 + f) + (r + 1);
const key = (f, r) => `${f},${r}`;

/** The pairs of a FEN's portal field as a twin map in grid coordinates: Map<'f,r', {f, r}>. */
export function portalTwins(fen) {
  const m = new Map();
  for (const [a, b] of parsePortalField(fen).pairs) {
    const A = sqFR(a), B = sqFR(b);
    m.set(key(A.f, A.r), B);
    m.set(key(B.f, B.r), A);
  }
  return m;
}

/** Attach the pairs to a grid (non-enumerable, so the grid still reads as rows). Returns the grid. */
export function withPortals(grid, twins) {
  Object.defineProperty(grid, 'portals', { value: twins && twins.size ? twins : null, enumerable: false, writable: true, configurable: true });
  return grid;
}

/** A copy of a grid that keeps its pairs (a plain `map(row => [...row])` would drop them). */
export function copyGrid(grid) {
  return withPortals(grid.map((row) => [...row]), grid.portals ?? null);
}

/** The twin of the portal square at (f, r) on this grid, or null. */
export function twinAt(grid, f, r) {
  return grid.portals?.get(key(f, r)) ?? null;
}

/**
 * Walk a line from (f, r) in direction (df, dr) under the body rule, calling
 * `visit(nf, nr, occ)` for every square the line reaches: an empty square,
 * the piece or terrain it stops at (terrain is visited with its glyph, then
 * the walk ends), or a portal square — a body: it is visited (a landing, or
 * whatever stands on it) and the line ends there. `visit` may return false
 * to stop early. Returns the squares visited, in order.
 */
export function walkRay(grid, files, ranks, f0, r0, df, dr, visit) {
  const path = [];
  let f = f0 + df;
  let r = r0 + dr;
  while (f >= 0 && f < files && r >= 0 && r < ranks) {
    const occ = grid[r][f];
    path.push({ f, r });
    if (visit(f, r, occ) === false) break;
    if (occ || grid.portals?.has(key(f, r))) break; // a piece, terrain or a portal square ends the line
    f += df;
    r += dr;
  }
  return path;
}

/** A FEN → { grid, files, ranks }, the grid [rankFromBottom][file] with the pairs attached. */
export function gridFromFen(fen) {
  const rows = parseBoard(splitFen(fen).board);
  const ranks = rows.length;
  const files = Math.max(...rows.map((row) => row.length));
  const grid = Array.from({ length: ranks }, () => Array(files).fill(null));
  rows.forEach((row, ri) => row.forEach((cell, f) => { grid[ranks - 1 - ri][f] = cell; }));
  return { grid: withPortals(grid, portalTwins(fen)), files, ranks };
}
