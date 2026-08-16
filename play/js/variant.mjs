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
    // Symmetric pawn double-step from each side's pawn row (spike 7: the
    // default doubleStepRegionBlack is literal *7, which misses black's pawn
    // row on every board that isn't 8 ranks — silent formation asymmetry).
    doubleStepRegionWhite: '*2',
    doubleStepRegionBlack: `*${ranks - 1}`,
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

/** Catalog bounds. The upper bounds are the FSF largeboard ceiling and are
 *  REAL: 13x10 / 12x11 crash this WASM build ("memory access out of bounds")
 *  the moment a Board is constructed, and `loadVariantConfig` does NOT throw
 *  on the oversized block — it silently drops the variant (same silent-failure
 *  family as rules 6/7). The lower bounds are ours and are set as low as FSF
 *  will go, deliberately: the old 3x6 floor was an authoring guess that had
 *  hardened into a throw. */
export const CATALOG_FILES = { min: 2, max: 12 };
export const CATALOG_RANKS = { min: 2, max: 10 };

/**
 * The fixed 99-variant catalog: duel_<files>x<ranks> over the full range FSF
 * supports (files 2–12 × ranks 2–10). Loaded ONCE at boot into both ffish and
 * the engine; every duel thereafter varies only via FEN.
 *
 * Widened from the old 50 (files 3–12 × ranks 6–10) so that board size stops
 * being an authoring constraint. Measured cost of the extra 49 variants:
 * 33 KB of ini and 10.4 ms in `loadVariantConfig`, against 16 KB / 9.1 ms for
 * the old catalog — i.e. free.
 */
export function makeCatalogIni() {
  const blocks = [];
  for (let files = CATALOG_FILES.min; files <= CATALOG_FILES.max; files++) {
    for (let ranks = CATALOG_RANKS.min; ranks <= CATALOG_RANKS.max; ranks++) {
      blocks.push(makeDuelVariantIni({ name: catalogVariantName(files, ranks), files, ranks }));
    }
  }
  return blocks.join('\n');
}

/** Number of variants makeCatalogIni() emits. */
export function catalogSize() {
  return (CATALOG_FILES.max - CATALOG_FILES.min + 1) * (CATALOG_RANKS.max - CATALOG_RANKS.min + 1);
}

/**
 * Build a duel start position as a 2D board array.
 *
 * spec = {
 *   files, ranks,
 *   walls: ['c3', ...],                      // wall squares from terrain
 *   white: { rows: [['R','N','K'], [null,'B',null]],  // rows[0] = back rank
 *            backRankStart: 0, row: 0,       // row = rank from bottom
 *            pawnFiles: [0, 2] },            // optional: explicit pawn files
 *   black: { rows: [[...]], backRankStart: 0, row: ranks-1 },
 * }
 *
 * A formation is N piece rows plus ONE pawn row. `rows[0]` is the back rank
 * (furthest from the enemy) and each later entry steps one rank toward the
 * enemy; the pawn row sits in front of the last piece row. An N×M army in §4.2
 * bounding-box terms is therefore `M-1` piece rows + 1 pawn row — 8×2 is the
 * classic chess army, 5×3 is two piece rows of 5 over 5 pawns.
 *
 * `backRank` (a single array) is still accepted as shorthand for `rows: [.]`.
 *
 * Pawn rows default to automatic, spanning the piece-row width; a walled
 * back-row slot then suppresses BOTH the piece and that file's pawn (walls eat
 * slots — the semantics every Phase 0 sweep shipped with). With explicit
 * `pawnFiles` (0-based file indices) only those files get pawns, decoupled
 * from back-row wall clipping — the arena author owns the pawn count. Walled
 * pawn squares stay empty either way.
 *
 * NOTE (double-step): the variant's doubleStepRegion is `*2` / `*{ranks-1}`,
 * i.e. literally the rank one step in front of the back rank. A formation with
 * TWO piece rows puts its pawns a rank further out, so those pawns have no
 * double step. This is symmetric between the sides (both formations are the
 * same depth from their own edge), so it is a pacing quirk, not an imbalance —
 * deep armies simply advance slower than they look.
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
    const pieceRows = sideRows(side);
    const back = side.row ?? (isWhite ? 0 : ranks - 1);
    const dir = isWhite ? 1 : -1; // toward the enemy
    const pawnRow = back + dir * pieceRows.length;
    const start = side.backRankStart ?? 0;
    const onBoard = (rb) => rb >= 0 && rb < ranks;
    const pawnAt = (file) => {
      if (file < 0 || file >= files || !onBoard(pawnRow)) return;
      if (board[ranks - 1 - pawnRow][file] !== '*') {
        put(file, pawnRow, isWhite ? 'P' : 'p');
      }
    };
    const autoPawnFiles = new Set();
    pieceRows.forEach((rowPieces, depth) => {
      const rb = back + dir * depth;
      if (!onBoard(rb)) return; // clipped by board edge
      rowPieces.forEach((piece, i) => {
        const file = start + i;
        if (file >= files) return; // clipped by board edge
        if (board[ranks - 1 - rb][file] === '*') return; // walls eat slots (§4.2)
        if (piece) put(file, rb, isWhite ? piece.toUpperCase() : piece.toLowerCase());
        if (depth === 0) autoPawnFiles.add(file); // automatic row follows the BACK rank
      });
    });
    if (side.pawnFiles) for (const f of side.pawnFiles) pawnAt(f);
    else for (const f of autoPawnFiles) pawnAt(f); // §4.2 default
  };
  stamp(spec.white, true);
  stamp(spec.black, false);
  return board;
}

/** A side's piece rows, accepting the `backRank` single-row shorthand. */
export function sideRows(side) {
  if (side.rows) return side.rows;
  if (side.backRank) return [side.backRank];
  return [];
}

/** Serialize a duel board + turn into a full startFen. */
export function boardToFen(board, { turn = 'w', pocket = null } = {}) {
  const boardField = serializeBoard(board);
  const pocketField = pocket !== null ? `[${pocket}]` : '';
  return `${boardField}${pocketField} ${turn} - - 0 1`;
}
