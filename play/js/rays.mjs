// PORTALS v2 ON THE GRID (2026-09-18; brief §4.7; engine/patches/portals-v2.patch).
//
// The engine's rule, mirrored for the game's own grid code: a linked portal
// square is a BODY — every line stops at it, whatever stands on it — and an
// EMPTY PAIR is a TUNNEL for riders: a rook's, bishop's or queen's line
// entering an empty portal whose twin is also empty comes out of the twin in
// the same direction and runs on, through another empty pair as well, each
// pair once per line. Halves are neither until linked (they are not in the
// pairs). Landings step through and swap as ever; a pawn's double step never
// crosses a portal square.
//
// ONE walker (`walkRay`) serves threat.mjs (the gods' landing guard and the
// exposure rule), tactics.mjs (attacks, pins and skewers, the loser's terrain
// reach) and the page (the ROUTE of a move — which pairs a rider's line ran
// through — for the slide in one ring and out of the other, the two-segment
// arrows and the log). A grid carries its pairs as a non-enumerable
// `portals` property (withPortals / copyGrid), so every consumer sees the
// same board without a signature change; a grid without the property walks
// plain lines, as before.

import { isTerrain, parseBoard, parsePortalField, splitFen } from './fen.mjs';

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const UCI_RE = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))/;

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
 * Walk a line from (f, r) in direction (df, dr) under Portals v2, calling
 * `visit(nf, nr, occ, through)` for every square the line reaches: an empty
 * square, the piece or terrain it stops at (terrain is visited with its
 * glyph, then the walk ends), or a portal square — a body: the line stops
 * there, unless the square and its twin are both empty and this line has not
 * used the pair yet, when `through` is the twin and the walk continues from
 * it in the same direction. `visit` may return false to stop early. Returns
 * the squares visited, in order.
 */
export function walkRay(grid, files, ranks, f0, r0, df, dr, visit) {
  const path = [];
  const used = new Set();
  let f = f0 + df;
  let r = r0 + dr;
  while (f >= 0 && f < files && r >= 0 && r < ranks) {
    if (f === f0 && r === r0) break; // never the origin: a line that comes back round through the pairs to its own square ends there (the engine's rule too)
    const occ = grid[r][f];
    const k = key(f, r);
    const twin = grid.portals?.get(k) ?? null;
    const tk = twin ? key(twin.f, twin.r) : null;
    const through = twin && !occ && !grid[twin.r][twin.f] && !used.has(k) && !used.has(tk) ? twin : null;
    path.push({ f, r });
    if (visit(f, r, occ, through) === false) break;
    if (occ) break; // a piece or terrain ends the line
    if (twin) {
      if (!through) break; // a plugged pair: a body
      used.add(k);
      used.add(tk);
      f = twin.f + df;
      r = twin.r + dr;
      continue;
    }
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

const sliderDirs = (ch) => {
  const t = ch.toLowerCase();
  return t === 'q' ? [...ORTHO, ...DIAG] : t === 'r' ? ORTHO : t === 'b' ? DIAG : null;
};

/**
 * How a move travelled. `null` for a plain move — a plain landing on a portal
 * included (the piece slides to the portal and appears at its twin, as the
 * commit paints it) — else, when a rider's line ran through one or more
 * tunnels to reach its square: { pairs: [[entry, exit], …] in the order
 * passed, path: [from, entry, exit, …, to] } — every second boundary of the
 * path is a cut. A square reachable plainly is plain, whatever tunnel might
 * also lead there (the same move, the shorter picture).
 */
export function portalRoute(fenBefore, uci) {
  if (!fenBefore) return null;
  const m = String(uci ?? '').match(UCI_RE);
  if (!m) return null;
  const { grid, files, ranks } = gridFromFen(fenBefore);
  if (!grid.portals) return null;
  const a = sqFR(m[1]), b = sqFR(m[2]);
  const ch = grid[a.r]?.[a.f];
  if (!ch || isTerrain(ch)) return null;
  const dirs = sliderDirs(ch);
  if (!dirs) return null;
  const on = (f, r) => f >= 0 && f < files && r >= 0 && r < ranks;
  // Plain first: the line as it runs without tunnels, stopping at every body
  for (const [df, dr] of dirs) {
    for (let f = a.f + df, r = a.r + dr; on(f, r); f += df, r += dr) {
      if (f === b.f && r === b.r) return null;
      if (grid[r][f] || twinAt(grid, f, r)) break;
    }
  }
  // Then through the tunnels
  for (const [df, dr] of dirs) {
    const pairs = [];
    let found = false;
    walkRay(grid, files, ranks, a.f, a.r, df, dr, (f, r, occ, through) => {
      if (f === b.f && r === b.r) {
        found = true;
        return false;
      }
      if (through) pairs.push([SQ(f, r), SQ(through.f, through.r)]);
      return true;
    });
    if (found && pairs.length) return { pairs, path: [m[1], ...pairs.flat(), m[2]] };
  }
  return null;
}
