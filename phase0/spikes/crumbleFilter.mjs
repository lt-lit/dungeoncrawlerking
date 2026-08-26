// Spike 12 deliverable: the §4.5 crumble legality filter.
//
// validateCrumbleCandidate(ffish, variant, fen, square) → { ok, reason, collapsedFen? }
//
// A candidate collapse square is REJECTED when:
//   - it is off-board, already a wall, or either king's current square;
//   - after the collapse (square → '*', occupant removed, ep cleared) the side to
//     move could immediately capture the side-not-to-move's king ("exposes_king" —
//     an illegal-by-exposure position; a duel must never be decided in one ply by
//     a dice roll);
//   - the collapsed position is instantly game-over for the side to move:
//     checkmate, stalemate (zero legal moves — a loss under stalemateValue=loss),
//     or any other immediate result ffish adjudicates (e.g. ffish flags K-vs-K
//     insufficient material as an immediate 1/2-1/2 even with claimDraw=false).
//
// API choices (probe-verified on ffish.js "Fairy-Stockfish 010526 LB"):
//   - Exposure CANNOT be detected with isGameOver()/result() on the collapsed
//     position: under extinctionPseudoRoyal a position with the non-mover's king
//     en prise is "ongoing" (result '*') and the king-capture move is simply one
//     of the legal moves. Instead we flip the turn field and ask isCheck(): if
//     the original non-mover, put on the move, is in check, their king was
//     capturable by the actual mover. isCheck() keeps normal check semantics
//     under the pseudo-royal config.
//   - Instant end uses numberLegalMoves() === 0 (checkmate/stalemate — both are
//     losses for the mover under stalemateValue=loss; isCheck() distinguishes
//     them for the reason string) plus result(false) !== '*' as a catch-all for
//     any other immediate adjudication.
//
// PERFORMANCE: `new ffish.Board(...)` costs ~4 ms each (fixed embind/allocation
// overhead, board-size independent), which would put a 2-board validation at
// ~8 ms. `board.setFen()` on a reused Board costs ~0.013 ms. The filter therefore
// keeps one cached Board per (ffish, variant) and setFen()s it, giving
// ~0.1 ms/validation. Cache is invalidated via resetCrumbleFilterCache() — call
// it if you re-register a variant NAME with different rules/dimensions.
//
// The variant must already be registered via ffish.loadVariantConfig().

import { setSquare, getSquare, clearEp, splitFen, joinFen, isTerrain } from '../lib/fen.mjs';

// (ffish module) → Map(variantName → reused Board)
const boardCache = new WeakMap();

function cachedBoard(ffish, variant, fen) {
  let perModule = boardCache.get(ffish);
  if (!perModule) {
    perModule = new Map();
    boardCache.set(ffish, perModule);
  }
  let b = perModule.get(variant);
  if (!b) {
    b = new ffish.Board(variant, fen);
    perModule.set(variant, b);
  } else {
    b.setFen(fen);
  }
  return b; // owned by the cache — do NOT delete()
}

/** Drop all cached Boards for an ffish module (e.g. after re-registering a variant name). */
export function resetCrumbleFilterCache(ffish) {
  const perModule = boardCache.get(ffish);
  if (perModule) {
    for (const b of perModule.values()) b.delete();
    boardCache.delete(ffish);
  }
}

/** Apply the §4.5 collapse transform: square → '*', occupant removed, ep cleared. */
export function collapseFen(fen, square) {
  return clearEp(setSquare(fen, square, '*'));
}

/**
 * Validate one candidate collapse square.
 * @param {object} ffish  initialized ffish.js module (variant config already loaded)
 * @param {string} variant  variant name
 * @param {string} fen  current position (side to move = side that moves after the crumble)
 * @param {string|{file,rankFromBottom}} square  candidate square, e.g. 'e4'
 * @returns {{ok: boolean, reason: string|null, collapsedFen?: string}}
 */
export function validateCrumbleCandidate(ffish, variant, fen, square) {
  let occ;
  try {
    occ = getSquare(fen, square);
  } catch {
    return { ok: false, reason: 'offboard' };
  }
  if (occ === undefined) return { ok: false, reason: 'offboard' };
  // Terrain is never a collapse candidate. '^' rides the '*' verdict —
  // furniture is stone to the gods (§4.6 interim) and the Director skips it
  // before ever calling here; this is the belt-and-braces layer, and the
  // reason string stays 'already_wall' so the census schema doesn't fork.
  if (isTerrain(occ)) return { ok: false, reason: 'already_wall' };
  if (occ !== null && occ.replace('+', '').toLowerCase() === 'k') {
    return { ok: false, reason: 'king_square' };
  }

  let collapsed;
  try {
    collapsed = collapseFen(fen, square);
  } catch (e) {
    return { ok: false, reason: `fen_edit_failed(${e.message || e})` };
  }
  if (ffish.validateFen(collapsed, variant) !== 1) {
    return { ok: false, reason: 'invalid_fen' };
  }

  // 1) Illegal-by-exposure: flip the turn; if the original non-mover is then in
  //    check, the actual mover could capture their king outright.
  const f = splitFen(collapsed);
  f.turn = f.turn === 'w' ? 'b' : 'w';
  if (cachedBoard(ffish, variant, joinFen(f)).isCheck()) {
    return { ok: false, reason: 'exposes_king' };
  }

  // 2) Instant game end for the side to move.
  const b = cachedBoard(ffish, variant, collapsed);
  if (b.numberLegalMoves() === 0) {
    return { ok: false, reason: b.isCheck() ? 'instant_checkmate' : 'instant_stalemate' };
  }
  const r = b.result(false);
  if (r !== '*') return { ok: false, reason: `instant_result(${r})` };

  return { ok: true, reason: null, collapsedFen: collapsed };
}
