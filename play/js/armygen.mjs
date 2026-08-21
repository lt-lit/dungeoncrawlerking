// Army generation + molding layout (slice refresh — the deployment brain).
//
// An army is a UNIT BAG, not a formation: native shape W×2 (W = 3–8) —
// W pawns, one royal, W−1 non-pawns — but the shape on the board comes
// from MOLDING: armies squish and rearrange to fit the terrain they deploy
// on. Only two invariants constrain the rearrangement (designer-specified):
//   1. the royal sits in the army's REARMOST OCCUPIED row;
//   2. pawns stay IN FRONT: every pawn row is strictly forward of every
//      non-pawn row.
// Everything else — width, depth, raggedness around walls — is terrain.
//
// Army size has NOTHING to do with stage geometry (the old width coupling
// was a bug of assumption). The only contact point is feasibility: the two
// molded armies must fit with a gap of at least `gapMin` ranks between
// them, or the matchup is REJECTED ("doesn't fit") — never silently
// trimmed. What the dungeon does about a duel that can't deploy is a
// Phase-2 design question, not this module's.
//
// layoutArmy() is a PURE seeded function (stage, side, army, knobs) →
// placement, shared by the setup UI, the meter lab, and (later) the
// dungeon layer. No ffish here — grid math only; the ffish lints live in
// lintMatchupFen() so headless callers can skip them.
//
// Soft preference (designer: "generally at least one pawn in front of each
// non-pawn"): pawn fill favors files that contain an uncovered piece;
// files a wall makes uncoverable are reported in `violations`, judged by
// eye in the stage gallery rather than enforced.
import { mulberry32, childSeed } from './prng.mjs';
import { emptyBoard, serializeBoard } from './fen.mjs';
import { catalogVariantName } from './variant.mjs';

export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
export const ARMY_MIN_WIDTH = 3;
export const ARMY_MAX_WIDTH = 8;
const DRAW_POOL = ['N', 'B', 'R', 'Q']; // budget-mode draw set

/** Total point value of an army (royal counts 0, pawns 1 each). */
export function armyValue(army) {
  return army.width + army.back.reduce((s, p) => s + PIECE_VALUES[p.toLowerCase()], 0);
}

/**
 * Compose an army. spec = {
 *   width: 3..8,
 *   royal: 'K' (parameterized for future royal variants — schema-ready),
 *   pieces: ['Q','R','N']   — explicit back row (length width-1), OR
 *   budget: 14, budgetTol: 1 — total army value target (pawns included);
 *                              seeded rejection draw, closest kept.
 * }
 * Returns { width, royal, back: [width-1 pieces], value }.
 */
export function makeArmy(spec, rng = mulberry32(1)) {
  const width = spec.width;
  if (!(width >= ARMY_MIN_WIDTH && width <= ARMY_MAX_WIDTH)) {
    throw new Error(`army width ${width} outside ${ARMY_MIN_WIDTH}-${ARMY_MAX_WIDTH}`);
  }
  const royal = spec.royal ?? 'K';
  if (spec.pieces) {
    if (spec.pieces.length !== width - 1) {
      throw new Error(`explicit pieces: ${spec.pieces.length} given, width-1=${width - 1} needed`);
    }
    const army = { width, royal, back: [...spec.pieces] };
    return { ...army, value: armyValue(army) };
  }
  const budget = spec.budget;
  if (typeof budget !== 'number') throw new Error('army spec needs pieces[] or budget');
  const tol = spec.budgetTol ?? 1;
  // Draw once for variety, then repair toward the budget with single-piece
  // swaps (N/B↔R↔Q) — a pure i.i.d. draw can't hit extreme budgets (an
  // all-queens target is a 6e-5 event). Piece values {3,5,9} leave real
  // gaps near the lattice edges (all-queens minus 2 is unreachable by ANY
  // composition), so ±2 is the honest guarantee; callers read `value` for
  // the exact result.
  const back = Array.from({ length: width - 1 }, () => DRAW_POOL[Math.floor(rng() * DRAW_POOL.length)]);
  const value = () => width + back.reduce((s, p) => s + PIECE_VALUES[p.toLowerCase()], 0);
  for (let guard = 0; guard < 64; guard++) {
    const dev = value() - budget;
    if (Math.abs(dev) <= tol) break;
    let bestIdx = -1;
    let bestPiece = null;
    let bestDev = Math.abs(dev);
    for (let i = 0; i < back.length; i++) {
      for (const p of DRAW_POOL) {
        const d = Math.abs(dev - PIECE_VALUES[back[i].toLowerCase()] + PIECE_VALUES[p.toLowerCase()]);
        if (d < bestDev) {
          bestDev = d;
          bestIdx = i;
          bestPiece = p;
        }
      }
    }
    if (bestIdx < 0) break; // no swap improves — budget outside reach
    back[bestIdx] = bestPiece;
  }
  const army = { width, royal, back };
  return { ...army, value: armyValue(army) };
}

/** Deterministic seeded shuffle (Fisher-Yates on a copy). */
function shuffled(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Center-out ordering of the files in [start, start+w) — stable, left-first ties. */
function centerOut(start, w) {
  const mid = start + (w - 1) / 2;
  return Array.from({ length: w }, (_, i) => start + i).sort(
    (a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b
  );
}

/** Outer-first ordering (edges of the window inward) — stable, left-first ties. */
function outerFirst(start, w) {
  const mid = start + (w - 1) / 2;
  return Array.from({ length: w }, (_, i) => start + i).sort(
    (a, b) => Math.abs(b - mid) - Math.abs(a - mid) || a - b
  );
}

/**
 * Mold one army onto terrain. Pure and seeded.
 *
 * opts = {
 *   grid, files, ranks,        — stage terrain (stage.mjs convention)
 *   side: 'white'|'black',     — deploys from rank 1 / rank `ranks`
 *   army,                      — makeArmy() output
 *   anchor: 'center'|'left'|'right'|<file>,  — window placement
 *   archetype: 'heavies-deep'|'minors-deep'|'scrambled',
 *   rng,                       — consumed by 'scrambled' only
 *   maxDepth,                  — rows available before the gap begins
 * }
 * Returns { cells: [{f, r, piece}], depthRows, extent, violations } or null
 * ("doesn't fit"). `extent` = the last occupied row index measured from the
 * side's home edge (gap math).
 *
 * MOLDING v2 — dense packing (designer-corrected: rows MIX; the v1 strict
 * row separation hollowed formations whenever the back row overflowed).
 * One back-to-front cell cursor; non-pawns favor BACK rows + CENTER
 * columns, pawns take the very next cell onward — same row allowed —
 * favoring OUTER columns, with pawn-coverage priority above the outer
 * preference (files holding a still-unscreened piece get pawns first;
 * designer: "generally at least one pawn in front of each non-pawn").
 * The partial last row therefore lands at the FRONT and its spares sit on
 * the flanks.
 *
 * The fill order IS the invariant proof: every piece cell precedes every
 * pawn cell in a back-to-front walk, so within any single file pieces sit
 * strictly behind pawns (walls skip cells but never reorder); the royal is
 * placed first, taking the rearmost usable row, center-most cell; and the
 * royal's row can never hold a pawn (the window is at most `width` files,
 * the army has exactly `width` non-pawns, so pieces always consume the
 * entire rearmost row before pawns begin).
 */
export function layoutArmy({ grid, files, ranks, side, army, anchor = 'center', archetype = 'heavies-deep', rng = mulberry32(1), maxDepth }) {
  const w = Math.min(army.width, files);
  const start =
    anchor === 'center' ? (files - w) >> 1
    : anchor === 'left' ? 0
    : anchor === 'right' ? files - w
    : Math.max(0, Math.min(files - w, anchor | 0));
  const rowRank = (i) => (side === 'white' ? i : ranks - 1 - i);
  const open = (i, f) => grid[rowRank(i)][f] !== '*';
  const depthCap = Math.min(maxDepth ?? ranks, ranks);

  // Back units, royal first; the archetype orders the rest (first-placed
  // sits deepest).
  const rest =
    archetype === 'scrambled' ? shuffled(rng, army.back)
    : [...army.back].sort((a, b) => {
        const d = PIECE_VALUES[b.toLowerCase()] - PIECE_VALUES[a.toLowerCase()];
        return archetype === 'minors-deep' ? -d : d;
      });
  const backUnits = [army.royal, ...rest];

  const cells = [];
  const pieceFiles = new Set();
  const covered = new Set();
  let unit = 0;
  let pawns = 0;
  let row = 0;
  while (pawns < army.width) {
    if (row >= depthCap) return null; // doesn't fit
    // Non-pawns first, center-out, until the bag runs dry — then pawns
    // CONTINUE in the same row: unscreened piece-files first, then outer.
    const taken = new Set();
    for (const f of centerOut(start, w)) {
      if (unit >= backUnits.length) break;
      if (!open(row, f)) continue;
      cells.push({ f, r: rowRank(row), piece: backUnits[unit++] });
      pieceFiles.add(f);
      taken.add(f);
    }
    if (unit >= backUnits.length) {
      const cand = outerFirst(start, w).filter((f) => open(row, f) && !taken.has(f));
      cand.sort((a, b) => {
        const na = pieceFiles.has(a) && !covered.has(a) ? 0 : 1;
        const nb = pieceFiles.has(b) && !covered.has(b) ? 0 : 1;
        return na - nb; // coverage outranks the outer preference (stable sort keeps outer order inside each bucket)
      });
      for (const f of cand) {
        if (pawns >= army.width) break;
        cells.push({ f, r: rowRank(row), piece: 'P' });
        covered.add(f);
        pawns++;
      }
    }
    row++;
  }

  const violations = [...pieceFiles]
    .filter((f) => !covered.has(f))
    .map((f) => `uncovered-piece-file:${String.fromCharCode(97 + f)}`);
  return { cells, depthRows: row, extent: row - 1, violations };
}

/**
 * Compose a full matchup: two molded armies on a stage → start FEN.
 *
 * opts = {
 *   stage,                      — stage.mjs loadStageV2() output
 *   white, black: { army | spec, anchor, archetype },
 *   seed,                       — one seed, per-side child streams
 *   gapMin = 1,                 — lint floor (designer: practical 2-5)
 *   turn = 'w',
 * }
 * Returns { fen, variantName, white, black, gap, violations } or
 * { error } ("doesn't fit" / "no-gap"). Deterministic given (stage, specs,
 * seed).
 */
export function buildMatchup({ stage, white, black, seed = 1, gapMin = 1, turn = 'w' }) {
  const { grid, files, ranks } = stage;
  const mk = (sideSpec, label) =>
    sideSpec.army ?? makeArmy(sideSpec.spec, mulberry32(childSeed(seed, `${label}-army`)));
  const wArmy = mk(white, 'white');
  const bArmy = mk(black, 'black');

  // White lays out first with room left for a 2-row opponent + the gap;
  // black gets exactly what remains.
  const wl = layoutArmy({
    grid, files, ranks, side: 'white', army: wArmy,
    anchor: white.anchor ?? 'center', archetype: white.archetype ?? 'heavies-deep',
    rng: mulberry32(childSeed(seed, 'white-mold')),
    maxDepth: ranks - gapMin - 2,
  });
  if (!wl) return { error: `white ${wArmy.width}x2 doesn't fit`, white: wArmy, black: bArmy };
  const bl = layoutArmy({
    grid, files, ranks, side: 'black', army: bArmy,
    anchor: black.anchor ?? 'center', archetype: black.archetype ?? 'heavies-deep',
    rng: mulberry32(childSeed(seed, 'black-mold')),
    maxDepth: ranks - gapMin - (wl.extent + 1),
  });
  if (!bl) return { error: `black ${bArmy.width}x2 doesn't fit`, white: wArmy, black: bArmy };

  // Gap = empty ranks between the armies' closest occupied rows.
  const wTop = Math.max(...wl.cells.map((c) => c.r));
  const bBottom = Math.min(...bl.cells.map((c) => c.r));
  const gap = bBottom - wTop - 1;
  if (gap < gapMin) return { error: `gap ${gap} < ${gapMin}`, white: wArmy, black: bArmy };

  // Compose the FEN: board arrays are [rankFromTop][file] (fen.mjs).
  const board = emptyBoard(files, ranks);
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) if (grid[r][f] === '*') board[ranks - 1 - r][f] = '*';
  }
  for (const c of wl.cells) board[ranks - 1 - c.r][c.f] = c.piece.toUpperCase();
  for (const c of bl.cells) board[ranks - 1 - c.r][c.f] = c.piece.toLowerCase();
  const fen = `${serializeBoard(board)} ${turn} - - 0 1`;
  return {
    fen,
    variantName: catalogVariantName(files, ranks),
    white: { army: wArmy, layout: wl },
    black: { army: bArmy, layout: bl },
    gap,
    violations: [...wl.violations.map((v) => `white:${v}`), ...bl.violations.map((v) => `black:${v}`)],
  };
}

/** King-step BFS: can the two armies reach each other through non-walls?
 *  (pieces are passable — they move). Grid-pure §6-style check. */
export function armiesConnected(stage, matchup) {
  const { grid, files, ranks } = stage;
  const key = (r, f) => r * 16 + f;
  const targets = new Set(matchup.black.layout.cells.map((c) => key(c.r, c.f)));
  const seen = new Set(matchup.white.layout.cells.map((c) => key(c.r, c.f)));
  const queue = [...matchup.white.layout.cells.map((c) => [c.r, c.f])];
  while (queue.length) {
    const [r, f] = queue.shift();
    if (targets.has(key(r, f))) return true;
    for (let dr = -1; dr <= 1; dr++) {
      for (let df = -1; df <= 1; df++) {
        if (!dr && !df) continue;
        const nr = r + dr;
        const nf = f + df;
        if (nr < 0 || nr >= ranks || nf < 0 || nf >= files) continue;
        if (seen.has(key(nr, nf)) || grid[nr][nf] === '*') continue;
        seen.add(key(nr, nf));
        queue.push([nr, nf]);
      }
    }
  }
  return false;
}

/**
 * ffish lints on a composed matchup FEN — the checks grid math cannot do.
 * Caller supplies ffish (headless callers may skip). Returns { ok, reasons }.
 */
export function lintMatchupFen(ffish, variantName, fen) {
  const reasons = [];
  if (ffish.validateFen(fen, variantName) !== 1) {
    return { ok: false, reasons: ['invalid-fen'] };
  }
  const flip = (() => {
    const parts = fen.split(' ');
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    return parts.join(' ');
  })();
  const b = new ffish.Board(variantName, fen);
  if (b.numberLegalMoves() === 0) reasons.push('decided-at-start');
  if (b.isCheck()) reasons.push('mover-in-check');
  b.delete();
  const b2 = new ffish.Board(variantName, flip);
  if (b2.isCheck()) reasons.push('non-mover-in-check');
  b2.delete();
  return { ok: reasons.length === 0, reasons };
}
