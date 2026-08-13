// Duel-variant generation: variants.ini snippet + startFen builders.
//
// Every duel is a generated variant: a config block (board dims, regions,
// win conditions) plus a start FEN (pieces, walls). See brief §3, §4.
import { emptyBoard, serializeBoard } from './fen.mjs';

/**
 * Emit a variants.ini snippet for a duel arena.
 * Baseline rules follow brief §4.4: no draws, dual loss condition,
 * promotion on enemy back rank, no castling (generated positions).
 * Any key in `extra` overrides/extends the baseline.
 */
export function makeDuelVariantIni({ name = 'duel', files = 8, ranks = 8, extra = {} } = {}) {
  if (files < 1 || files > 12 || ranks < 1 || ranks > 10) {
    throw new Error(`board ${files}x${ranks} outside FSF largeboard caps (12 files x 10 ranks)`);
  }
  const opts = {
    maxRank: String(ranks),
    maxFile: String(files),
    castling: 'false',
    // No draws, ever (§4.4)
    stalemateValue: 'loss',
    nMoveRule: '0',
    nFoldRule: '0',
    // Dual loss condition: checkmate OR king capture (§4.4, spike 4)
    extinctionValue: 'loss',
    extinctionPieceTypes: 'k',
    extinctionPseudoRoyal: 'true',
    // Promotion region = enemy back rank (§4.4, spike 5)
    promotionRegionWhite: `*${ranks}`,
    promotionRegionBlack: '*1',
    ...extra,
  };
  const lines = [`[${name}:chess]`];
  for (const [k, v] of Object.entries(opts)) {
    if (v === null || v === undefined) continue;
    lines.push(`${k} = ${v}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Build a duel start position as a 2D board array.
 *
 * spec = {
 *   files, ranks,
 *   walls: ['c3', ...],                      // wall squares from terrain
 *   white: { backRank: ['R','N','K',...], backRankStart: 0, row: 0 },  // row = rank from bottom
 *   black: { backRank: [...], backRankStart: 0, row: ranks-1 },
 * }
 * Pawn rows are stamped automatically in front of each back row (§4.2),
 * spanning the patch width, skipping wall squares.
 */
export function buildDuelBoard(spec) {
  const { files, ranks } = spec;
  const board = emptyBoard(files, ranks);
  const put = (file, rankFromBottom, piece) => {
    board[ranks - 1 - rankFromBottom][file] = piece;
  };
  for (const w of spec.walls ?? []) {
    const file = w.charCodeAt(0) - 97;
    const rank = parseInt(w.slice(1), 10) - 1;
    put(file, rank, '*');
  }
  const stamp = (side, isWhite) => {
    if (!side) return;
    const row = side.row ?? (isWhite ? 0 : ranks - 1);
    const pawnRow = isWhite ? row + 1 : row - 1;
    const start = side.backRankStart ?? 0;
    side.backRank.forEach((piece, i) => {
      const file = start + i;
      if (file >= files) return; // clipped by board edge
      if (board[ranks - 1 - row][file] === '*') return; // walls eat slots (§4.2)
      if (piece) put(file, row, isWhite ? piece.toUpperCase() : piece.toLowerCase());
      if (board[ranks - 1 - pawnRow][file] !== '*') {
        put(file, pawnRow, isWhite ? 'P' : 'p');
      }
    });
  };
  stamp(spec.white, true);
  stamp(spec.black, false);
  return board;
}

/** Serialize a duel board + turn into a full startFen. */
export function boardToFen(board, { turn = 'w', pocket = null } = {}) {
  const boardField = serializeBoard(board);
  const pocketField = pocket !== null ? `[${pocket}]` : '';
  return `${boardField}${pocketField} ${turn} - - 0 1`;
}
