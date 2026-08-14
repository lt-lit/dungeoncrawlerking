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
    // No draws, ever (§4.4). nFoldRule=0 kills repetition adjudication;
    // nFoldValue=loss additionally disables the engine's PRIVATE in-search
    // repetition draw-scoring (spike 10: without it, a losing engine holds
    // its eval at 0.00 by shuffling — "Plan A-prime" config).
    stalemateValue: 'loss',
    nMoveRule: '0',
    nFoldRule: '0',
    nFoldValue: 'loss',
    // Loss conditions beyond checkmate (§4.4): bare-army IN-GRAMMAR.
    // extinctionPieceTypes=* + extinctionPieceCount=1 is real total-count
    // semantics (probed): a side down to 1 total piece (its king) loses, and
    // the ENGINE understands — it plays strip-wins as mate-1 instead of
    // king-shuffling toward a longer mate (the shipped-config pathology).
    // pseudoRoyal must be false for the count rule to fire; the chess
    // template's king stays fully royal regardless (spike 4 finding 5), so
    // check/checkmate/stalemate semantics are untouched. King capture is NOT
    // expressible alongside this (single (types,count) slot) — kingless
    // states (surgery-only: the §4.5 filter re-rolls exposures, and crumbles
    // cannot geometrically create them) are adjudicated at the game layer.
    extinctionValue: 'loss',
    extinctionPieceTypes: '*',
    extinctionPieceCount: '1',
    extinctionPseudoRoyal: 'false',
    // Promotion region = enemy back rank (§4.4, spike 5)
    promotionRegionWhite: `*${ranks}`,
    promotionRegionBlack: '*1',
    // Symmetric pawn double-step from each side's pawn row (spike 7: the
    // default doubleStepRegionBlack is literal *7, which misses black's pawn
    // row on every board that isn't 8 ranks — silent formation asymmetry).
    doubleStepRegionWhite: '*2',
    doubleStepRegionBlack: `*${ranks - 1}`,
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
 *   white: { backRank: ['R','N','K',...], backRankStart: 0, row: 0,  // row = rank from bottom
 *            pawnFiles: [0, 2] },            // optional: explicit pawn files
 *   black: { backRank: [...], backRankStart: 0, row: ranks-1 },
 * }
 * Pawn rows are stamped in front of each back row (§4.2). Default: automatic,
 * spanning the patch width; a walled back-row slot then suppresses BOTH the
 * piece and that file's pawn (walls eat slots — the semantics every Phase 0
 * sweep shipped with). With explicit `pawnFiles` (0-based file indices) only
 * those files get pawns, decoupled from back-row wall clipping — the arena
 * author owns the pawn count. Walled pawn squares stay empty either way.
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
    const pawnAt = (file) => {
      if (file < 0 || file >= files) return;
      if (board[ranks - 1 - pawnRow][file] !== '*') {
        put(file, pawnRow, isWhite ? 'P' : 'p');
      }
    };
    side.backRank.forEach((piece, i) => {
      const file = start + i;
      if (file >= files) return; // clipped by board edge
      if (board[ranks - 1 - row][file] === '*') return; // walls eat slots (§4.2)
      if (piece) put(file, row, isWhite ? piece.toUpperCase() : piece.toLowerCase());
      if (!side.pawnFiles) pawnAt(file); // automatic full-width row (§4.2 default)
    });
    if (side.pawnFiles) for (const f of side.pawnFiles) pawnAt(f);
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
