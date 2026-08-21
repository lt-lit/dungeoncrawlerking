// Duel-variant generation: variants.ini snippet + startFen builders.
// Browser port of phase0/lib/variant.mjs with two additions: a known-key
// allowlist (unknown variants.ini keys are silently ignored by BOTH libraries
// — spike 6 — so a typo produces legal-looking wrong rules) and the fixed
// 50-variant catalog (variant names are single-use — spike 1 — so the game
// loads every duel_<files>x<ranks> once at boot and never redefines).
import { emptyBoard, serializeBoard } from './fen.mjs';

// Keys the duel baseline is allowed to emit. Extend deliberately, never ad hoc.
const KNOWN_INI_KEYS = new Set([
  'maxRank',
  'maxFile',
  'castling',
  'stalemateValue',
  'nMoveRule',
  'nFoldRule',
  'nFoldValue',
  'extinctionValue',
  'extinctionPieceTypes',
  'extinctionPieceCount',
  'extinctionPseudoRoyal',
  'promotionRegionWhite',
  'promotionRegionBlack',
  'promotionPieceTypes',
  'doubleStepRegionWhite',
  'doubleStepRegionBlack',
  'pieceDrops',
  'capturesToHand',
  'dropRegionWhite',
  'dropRegionBlack',
]);

/**
 * Emit a variants.ini snippet for a duel arena.
 * Baseline rules follow brief §4.4: no draws, dual loss condition,
 * promotion on enemy back rank, no castling (generated positions).
 * Any key in `extra` overrides/extends the baseline (allowlisted).
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
    // Loss conditions beyond checkmate (§4.4): bare-army IN-GRAMMAR — a side
    // down to 1 total piece (its king) loses, and the engine plays for it
    // (strip-wins score mate-1; hints/eval bar are truthful automatically).
    // pseudoRoyal=false is required for the count rule to fire; the king
    // stays royal (spike 4 finding 5), so check semantics are untouched.
    // Kingless states (surgery-only) are adjudicated in duel.mjs.
    extinctionValue: 'loss',
    extinctionPieceTypes: '*',
    extinctionPieceCount: '1',
    extinctionPseudoRoyal: 'false',
    // Promotion region = enemy back rank (§4.4, spike 5)
    promotionRegionWhite: `*${ranks}`,
    promotionRegionBlack: '*1',
    // UNIVERSAL pawn double-step (slice refresh; spike 13): armies mold to
    // terrain, so pawns start on arbitrary ranks — the region covers every
    // pawn-legal rank so the push is never an accident of deployment depth.
    // FSF region semantics are every-visit (no first-move tracking): any
    // pawn in the region always has the double-step. Walls block both the
    // jumped and landing squares; en passant works against any of them.
    doubleStepRegionWhite: Array.from({ length: Math.max(0, ranks - 2) }, (_, i) => `*${i + 2}`).join(' '),
    doubleStepRegionBlack: Array.from({ length: Math.max(0, ranks - 2) }, (_, i) => `*${ranks - 1 - i}`).join(' '),
    ...extra,
  };
  for (const k of Object.keys(opts)) {
    if (!KNOWN_INI_KEYS.has(k)) {
      throw new Error(`unknown variants.ini key "${k}" — unknown keys are silently ignored by FSF/ffish (spike 6); add it to KNOWN_INI_KEYS deliberately if it is real`);
    }
  }
  const lines = [`[${name}:chess]`];
  for (const [k, v] of Object.entries(opts)) {
    if (v === null || v === undefined) continue;
    lines.push(`${k} = ${v}`);
  }
  return lines.join('\n') + '\n';
}

/** Catalog variant name for a board size. */
export function catalogVariantName(files, ranks) {
  return `duel_${files}x${ranks}`;
}

/**
 * The fixed 60-variant catalog: duel_<files>x<ranks> for files 3–12 × ranks
 * 5–10 (spikes 1/3/8; ranks-5 added by the slice refresh for the 3×5
 * minimum stage). Loaded ONCE at boot into both ffish and the engine;
 * every duel thereafter varies only via FEN.
 */
export function makeCatalogIni() {
  const blocks = [];
  for (let files = 3; files <= 12; files++) {
    for (let ranks = 5; ranks <= 10; ranks++) {
      blocks.push(makeDuelVariantIni({ name: catalogVariantName(files, ranks), files, ranks }));
    }
  }
  return blocks.join('\n');
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
