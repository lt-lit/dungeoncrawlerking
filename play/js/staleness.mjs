// STALENESS — the position half of the Gods' trigger ("the fun score").
//
// The restlessness meter (meter.mjs) reads the game RECORD: "nothing has
// happened lately." This reads the POSITION: "nothing CAN happen here."
// They catch different deaths and neither substitutes for the other:
//
//   - a shuffling repetition on a wide-open board trips the RECORD meter
//     while staleness stays low (plenty is possible; nobody is doing it);
//   - a locked fortress where both sides still have captures and checks to
//     spend trips STALENESS while the record meter stays sated (things keep
//     happening; the position is going nowhere).
//
// The Gods read both: staleness sets how fast the record meter fills, so a
// dead board bores them roughly three times faster than a live one.
//
// Deliberately NOT an engine evaluation. Two reasons, both hard:
//  1. Eval answers "who is winning", which is the one question the Gods must
//     never act on (brief §4.5: they may not pick a winner) and the one a
//     player would eventually notice them acting on. A dead-drawn fortress
//     and a razor-sharp melee both score 0.00.
//  2. Movetime-bounded searches are wall-clock dependent, so an eval in the
//     trigger would destroy seeded replay — the property every corpus and
//     every ledger export rests on. Staleness is a pure function of the
//     position and the legal-move list, so replay survives untouched.
//
// Pure: no ffish, no FEN parsing, no RNG. Callers pass the cell grid that
// fenGrid() produces ([rankFromBottom][file]; '*' wall, '^' furniture, null
// empty, piece letters otherwise) plus the legal-move list they already have.
// Terrain never counts as a piece here — '^' === '^'.toUpperCase() is the
// standing landmine (§4.6), so every cell test goes through isTerrain first.

import { isTerrain } from './fen.mjs';

export const STALENESS_DEFAULTS = {
  wMobility: 0.4, // weight: how starved for legal moves the side to move is
  wContact: 0.35, // weight: whether the armies are in contact at all
  wPawnLock: 0.25, // weight: how many pawns are walled off from promoting
  movesPerPiece: 2, // mobility normalizer — moves per piece ON THE BOARD (both
  //                   sides) that reads as fully mobile. The move list is the
  //                   mover's alone, so this is calibrated against the total.
  contactFloor: 3, // this many available piece captures reads as fully engaged
};

// Rank 10 makes squares 3 chars, so both halves need the multi-digit branch
// (rule 8). The alternation puts '10' first: in 'a1a10' the middle chars are
// '1a', so the greedy branch fails there and the single-digit one wins.
const UCI_RE = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))/;

/** 'e4' → { f, r } (0-based file, rank from bottom). */
function sqFR(sq) {
  return { f: sq.charCodeAt(0) - 97, r: parseInt(sq.slice(1), 10) - 1 };
}

/** Can this pawn reach its promotion rank by straight pushes through
 *  non-terrain? Furniture blocks a push exactly like stone — a pawn can never
 *  capture straight ahead, so it can't clear its own blocker (§4.6). */
function pushReaches(grid, f, r, white, ranks) {
  const target = white ? ranks - 1 : 0;
  let rr = r;
  while (rr !== target) {
    rr += white ? 1 : -1;
    if (isTerrain(grid[rr][f])) return false;
  }
  return true;
}

/**
 * Read one position's inertness.
 *
 * `legalMoves` is the mover's UCI move list (whitespace-joined or an array) —
 * whatever ffish `Board.legalMoves()` handed back. Captures are counted by
 * looking at what stands on each destination, so a crate smash is NOT a
 * contact: the armies touching each other is the signal, and a board whose
 * only available captures are furniture is exactly as inert as one with none
 * (it is also the farm brief §4.6 warns about).
 *
 * Returns { staleness, fun, pieces, moves, captures, lockedPawns, pawns },
 * where `staleness` is 0 (everything is possible) … 1 (nothing is), and
 * `fun` is its complement — the number the debug overlay shows.
 */
export function stalenessOf(grid, legalMoves, files, ranks, config = {}) {
  const c = { ...STALENESS_DEFAULTS, ...config };
  const moveList = Array.isArray(legalMoves)
    ? legalMoves
    : String(legalMoves ?? '').trim().split(/\s+/).filter(Boolean);

  let pieces = 0;
  let pawns = 0;
  let locked = 0;
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      const ch = grid[r][f];
      if (!ch || isTerrain(ch)) continue;
      pieces++;
      if (ch === 'P' || ch === 'p') {
        pawns++;
        if (!pushReaches(grid, f, r, ch === 'P', ranks)) locked++;
      }
    }
  }

  // Captures available to the mover, furniture excluded (see above).
  let captures = 0;
  for (const mv of moveList) {
    const m = UCI_RE.exec(mv);
    if (!m) continue;
    const { f, r } = sqFR(m[2]);
    if (f < 0 || f >= files || r < 0 || r >= ranks) continue;
    const occ = grid[r][f];
    if (occ && !isTerrain(occ)) captures++;
  }

  const mobStale = pieces ? 1 - Math.min(1, moveList.length / (pieces * c.movesPerPiece)) : 1;
  const contactStale = 1 - Math.min(1, captures / c.contactFloor);
  const lockStale = pawns ? locked / pawns : 0;

  const staleness = Math.min(
    1,
    Math.max(0, c.wMobility * mobStale + c.wContact * contactStale + c.wPawnLock * lockStale)
  );
  return {
    staleness,
    fun: 1 - staleness,
    pieces,
    moves: moveList.length,
    captures,
    lockedPawns: locked,
    pawns,
  };
}
