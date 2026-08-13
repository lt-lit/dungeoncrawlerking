// Crumble system (brief §4.5): repetition crumbles + pacing crumbles as
// orchestration-layer arena regeneration. The harness rewrites the FEN
// between plies; every state the engine sees is FSF-pure.
import { splitFen, setSquare, clearEp, findSquares, squareName } from '../lib/fen.mjs';
import { mulberry32, childSeed, randInt } from './prng.mjs';

/** Position key for repetition tracking: board + turn + ep (castling is always '-'). */
export function positionKey(fen) {
  const f = splitFen(fen);
  return `${f.board} ${f.turn} ${f.ep}`;
}

/**
 * §4.5 legality filter: candidate collapse squares are validated with ffish
 * before they collapse. Reject candidates that:
 *  - are either king's current square (pacing crumbles never target kings),
 *  - would leave the side-not-to-move's king immediately capturable
 *    (a duel must never be decided by a dice roll in one ply),
 *  - would instantly end the game (checkmate or stalemate),
 *  - produce a position ffish rejects outright.
 * Returns { ok, reason, postFen }.
 */
export function validateCrumbleCandidate(ffish, variantName, fen, square) {
  const kings = findSquares(fen, (c) => c === 'K' || c === 'k').map((s) => s.name);
  if (kings.includes(square)) return { ok: false, reason: 'king-square' };
  let postFen;
  try {
    postFen = clearEp(setSquare(fen, square, '*'));
  } catch (e) {
    return { ok: false, reason: `fen-edit-failed: ${e.message}` };
  }
  let board = null;
  try {
    if (ffish.validateFen(postFen, variantName) < 0) {
      return { ok: false, reason: 'invalid-fen' };
    }
    board = new ffish.Board(variantName, postFen);
    // Exposed king: any legal move for the side to move that lands on the
    // enemy king's square means the duel could be decided in one ply.
    const enemyKingChar = splitFen(postFen).turn === 'w' ? 'k' : 'K';
    const enemyKing = findSquares(postFen, (c) => c === enemyKingChar)[0];
    if (!enemyKing) return { ok: false, reason: 'king-vanished' };
    const moves = board.legalMoves().trim().split(/\s+/).filter(Boolean);
    if (moves.length === 0) return { ok: false, reason: 'instant-stalemate-or-mate' };
    if (board.isGameOver()) return { ok: false, reason: 'instant-game-over' };
    if (moves.some((m) => m.slice(2, 4) === enemyKing.name || m.slice(2).startsWith(enemyKing.name))) {
      return { ok: false, reason: 'exposes-king' };
    }
    return { ok: true, postFen };
  } catch (e) {
    return { ok: false, reason: `ffish-error: ${e.message}` };
  } finally {
    if (board) board.delete();
  }
}

/**
 * Per-game crumble controller. Tracks position occurrences for repetition
 * crumbles and schedules pacing crumbles. All RNG is seeded per game.
 *
 * opts = { onsetPly, cadence, seed, repetitionThreshold = 3 }
 * cadence = 0 disables pacing crumbles; onsetPly = Infinity likewise.
 */
export class CrumbleController {
  constructor({ onsetPly = Infinity, cadence = 0, seed = 1, repetitionThreshold = 3 } = {}) {
    this.onsetPly = onsetPly;
    this.cadence = cadence;
    this.repetitionThreshold = repetitionThreshold;
    this.rng = mulberry32(childSeed(seed, 'crumble'));
    this.positionCounts = new Map();
    this.lastPacingPly = null;
  }

  /** Reset position history (called after every crumble — new walls = new positions). */
  resetHistory() {
    this.positionCounts.clear();
  }

  /** Record the position after a ply. Returns occurrence count. */
  recordPosition(fen) {
    const key = positionKey(fen);
    const n = (this.positionCounts.get(key) ?? 0) + 1;
    this.positionCounts.set(key, n);
    return n;
  }

  /**
   * Repetition crumble check (§4.5.1): on the Nth occurrence of a position,
   * collapse the square the loop-closing piece just moved FROM (empty by
   * construction, never a king's current square).
   * Call after recordPosition. lastMove is the uci move that just completed.
   */
  repetitionCrumble(occurrences, lastMove) {
    if (occurrences < this.repetitionThreshold) return null;
    const from = lastMove.slice(0, 2);
    return { type: 'repetition', square: from };
  }

  /**
   * Pacing crumble check (§4.5.2): past onset ply P, a random square collapses
   * every k plies. Both kings excluded; occupied squares fair game (piece lost).
   * Returns a candidate-square generator so the caller can re-roll through the
   * legality filter: { type, next() } or null if not due.
   */
  pacingCrumbleDue(ply) {
    if (this.cadence <= 0 || ply < this.onsetPly) return null;
    if (this.lastPacingPly !== null && ply - this.lastPacingPly < this.cadence) return null;
    return true;
  }

  markPacingFired(ply) {
    this.lastPacingPly = ply;
  }

  /** Uniformly random square from the board (caller filters). */
  randomSquare(files, ranks) {
    const f = randInt(this.rng, files);
    const r = randInt(this.rng, ranks);
    return squareName(f, r);
  }
}

/** Apply a crumble to a FEN: square → wall, ep cleared. Reports any piece lost. */
export function applyCrumble(fen, square) {
  const found = findSquares(fen, (c, file, rb) => squareName(file, rb) === square);
  const cell = found[0]?.cell;
  const pieceLost = cell && cell !== '*' ? cell : null;
  const postFen = clearEp(setSquare(fen, square, '*'));
  return { postFen, pieceLost };
}
