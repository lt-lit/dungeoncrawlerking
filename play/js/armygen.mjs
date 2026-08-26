// Army generation + molding layout (slice refresh — the deployment brain).
//
// An army is a UNIT BAG, not a formation: native shape W×2 (W = 3–8) —
// W pawns, one royal, W−1 non-pawns — but the shape on the board comes
// from MOLDING: armies squish and rearrange to fit the terrain they deploy
// on. Only two invariants constrain the rearrangement (designer-specified):
//   1. the royal sits in the army's REARMOST OCCUPIED row;
//   2. pawns stay IN FRONT — PER FILE (molding v2.1): within any single
//      file every piece sits strictly behind every pawn. Mixed piece/pawn
//      ROWS are legal and normal; the fill order proves the per-file
//      screen (see layoutArmy).
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
import { emptyBoard, serializeBoard, isTerrain, WALL } from './fen.mjs';
import { catalogVariantName, dealVariant } from './variant.mjs';
import { flipStageVertical, cropStage } from './stage.mjs';

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
 * MOLDING v2.1 — dense packing, one back-to-front cursor, CENTER-OUT
 * everywhere (designer-corrected twice: v1's strict row separation
 * hollowed formations; v2's outer-first/coverage-driven pawns scattered
 * the sparse front row). Center-out for both unit classes produces every
 * shape the designer specified with zero special cases: in a MIXED row
 * the pieces took the center first, so pawns land on the outer cells; in
 * a sparse FRONT row the spare pawns center themselves.
 *
 * Pawn cover is a REPORT, not a placement force: a piece counts as
 * screened if its file holds an own pawn forward of it OR a wall forward
 * of it (walls block sliders — cover is cover). With pawn count always
 * equal to non-pawn count, open-file pieces only arise from overflow
 * rows on wall-less ground; `violations` names those files and the
 * designer judges them in the gallery.
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
  // Furniture eats molding slots exactly like stone (§4.6: a wall to molding).
  const open = (i, f) => !isTerrain(grid[rowRank(i)][f]);
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
  let unit = 0;
  let pawns = 0;
  let row = 0;
  while (pawns < army.width) {
    if (row >= depthCap) return null; // doesn't fit
    // One center-out pass per row: non-pawns until the bag runs dry, then
    // pawns continue in the same row (mixed rows put pawns on the outer
    // cells because the pieces already hold the center; a sparse front
    // row centers its spares).
    for (const f of centerOut(start, w)) {
      if (!open(row, f)) continue;
      if (unit < backUnits.length) {
        cells.push({ f, r: rowRank(row), piece: backUnits[unit++] });
      } else if (pawns < army.width) {
        cells.push({ f, r: rowRank(row), piece: 'P' });
        pawns++;
      } else break;
    }
    row++;
  }

  // Cover report (informational): a piece is screened by an own pawn OR a
  // wall forward of it in its file. Per the per-file invariant any own
  // pawn in the file is forward of every piece in it.
  const dir = side === 'white' ? 1 : -1;
  const pawnFiles = new Set(cells.filter((c) => c.piece === 'P').map((c) => c.f));
  const openFiles = new Set();
  for (const c of cells) {
    if (c.piece === 'P' || pawnFiles.has(c.f) || openFiles.has(c.f)) continue;
    let walled = false;
    for (let r = c.r + dir; r >= 0 && r < ranks; r += dir) {
      if (isTerrain(grid[r][c.f])) {
        // furniture screens too (blocks sliders until captured) — soft report
        walled = true;
        break;
      }
    }
    if (!walled) openFiles.add(c.f);
  }
  const violations = [...openFiles].sort((a, b) => a - b).map((f) => `open-file:${String.fromCharCode(97 + f)}`);
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

  const fen = composeFen(grid, files, ranks, wl.cells, bl.cells, turn);
  return {
    fen,
    variantName: catalogVariantName(files, ranks),
    white: { army: wArmy, layout: wl },
    black: { army: bArmy, layout: bl },
    gap,
    violations: [...wl.violations.map((v) => `white:${v}`), ...bl.violations.map((v) => `black:${v}`)],
  };
}

/** Compose a start FEN: terrain stamped VERBATIM (both glyphs — copying
 *  only '*' silently deleted authored furniture, the emitter landmine),
 *  then the two layouts. Board arrays are [rankFromTop][file] (fen.mjs). */
function composeFen(grid, files, ranks, wCells, bCells, turn) {
  const board = emptyBoard(files, ranks);
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) if (grid[r][f] !== null) board[ranks - 1 - r][f] = grid[r][f];
  }
  for (const c of wCells) board[ranks - 1 - c.r][c.f] = c.piece.toUpperCase();
  for (const c of bCells) board[ranks - 1 - c.r][c.f] = c.piece.toLowerCase();
  return `${serializeBoard(board)} ${turn} - - 0 1`;
}

/** King-step BFS: can the two armies reach each other through non-walls?
 *  (pieces are passable — they move). Grid-pure §6-style check.
 *
 *  Furniture is deliberately PASSABLE by default (§4.6 [designer-final]):
 *  armies can smash through a `^`, so a furniture-only seal never rejects a
 *  deal — "a chamber you must smash into" is legal. The verifier passes
 *  `furnitureBlocks: true` for a second look and WARNS when the two
 *  readings differ (stone-connected but furniture-sealed), flagging the
 *  stage for the gallery eye. */
export function armiesConnected(stage, matchup, { furnitureBlocks = false } = {}) {
  const { grid, files, ranks } = stage;
  const blocked = (cell) => (furnitureBlocks ? isTerrain(cell) : cell === WALL);
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
        if (seen.has(key(nr, nf)) || blocked(grid[nr][nf])) continue;
        seen.add(key(nr, nf));
        queue.push([nr, nf]);
      }
    }
  }
  return false;
}

/**
 * Deal a complete duel: terrain transforms + armies + molding + every
 * sanity check, in ONE call. This is the single shared entry point for
 * the setup UI, the stage verifier, and the meter-lab corpus builder —
 * no caller re-assembles the buildMatchup/armiesConnected/lintMatchupFen
 * trio by hand (the crumbleFilter split is the cautionary tale).
 *
 * opts = {
 *   stage,                    — loadStageV2() output (untransformed)
 *   flip = false,             — flipStageVertical first (testing convention)
 *   cropTop = 0, cropBottom = 0, — then cropStage, in the FINAL orientation
 *   white, black,             — per-side { army | spec, anchor, archetype }
 *   seed = 1,                 — ONE master seed; army/mold/director streams
 *                               derive from it via childSeed
 *   turn = 'w',               — initiative ('b' = enemy moves first; the
 *                               player always holds White)
 *   gapMin = 1,
 *   attempts = 8,             — seeded retries on a failed deal; attempt 0
 *                               uses the master seed itself, attempt k>0
 *                               uses childSeed(seed, 'attempt<k>') — fully
 *                               deterministic given (inputs, seed)
 *   ffish = null,             — optional; enables the FEN-level checks
 *                               (start-position legality, checks, decided)
 * }
 *
 * KING-ANCHORED AUTO-CROP (designer ground rules 2026-08-26): after
 * molding, every row behind either king is cropped out of the playable
 * area, so the player's king always starts on the first row and the enemy
 * king on the last. Molding puts each royal in its army's rearmost
 * occupied row, so removed rows are guaranteed free of pieces (terrain in
 * them — furniture included — goes too, §4.6). The promotion zone (the
 * entire extreme rank in every catalog variant) is then the enemy king's
 * starting row by construction, and always holds a usable square: the
 * king is standing on it. A crop below 5 ranks (gap 1 — a duel can't
 * start closer) REJECTS the attempt; connectivity, camp lines, the deal
 * variant and the FEN are all computed on the cropped board.
 *
 * Success: { ok: true, stageId, flip, cropTop, cropBottom, stage (the
 *   transformed terrain, auto-crop applied — its id carries the ~crop
 *   suffix), files, ranks, autoCrop: {top, bottom}, variantName, fen,
 *   turn, white, black, gap, edge (white value − black value),
 *   violations, seed, attempt, attemptSeed, directorSeed }.
 * Failure: { ok: false, error, reasons: [per-attempt reason strings] }.
 */
export function dealMatchup({
  stage, flip = false, cropTop = 0, cropBottom = 0,
  white, black, seed = 1, turn = 'w', gapMin = 1, attempts = 8, ffish = null,
}) {
  let terrain;
  try {
    terrain = cropStage(flip ? flipStageVertical(stage) : stage, cropTop, cropBottom);
  } catch (e) {
    return { ok: false, error: e.message, reasons: [e.message] };
  }
  const reasons = [];
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
    const attemptSeed = attempt === 0 ? seed : childSeed(seed, `attempt${attempt}`);
    const m = buildMatchup({ stage: terrain, white, black, seed: attemptSeed, gapMin, turn });
    if (m.error) {
      reasons.push(`attempt ${attempt}: ${m.error}`);
      continue;
    }
    // King-anchored auto-crop (see the doc above). The royal cell IS the
    // army's rearmost occupied row (molding invariant 1), so nothing but
    // terrain is ever removed.
    let arena = terrain;
    const royalRow = (side) => side.layout.cells.find((c) => c.piece === side.army.royal).r;
    const autoBottom = royalRow(m.white);
    const autoTop = terrain.ranks - 1 - royalRow(m.black);
    if (autoBottom || autoTop) {
      try {
        arena = cropStage(terrain, autoTop, autoBottom);
      } catch {
        reasons.push(`attempt ${attempt}: auto-crop behind the kings leaves ${terrain.ranks - autoTop - autoBottom} ranks (min 5)`);
        continue;
      }
      for (const side of [m.white.layout, m.black.layout]) {
        side.cells = side.cells.map((c) => ({ ...c, r: c.r - autoBottom }));
      }
      m.fen = composeFen(arena.grid, arena.files, arena.ranks, m.white.layout.cells, m.black.layout.cells, turn);
    }
    // Connectivity on the board the duel actually gets: a path that only
    // existed through the cropped rows is not a path.
    if (!armiesConnected(arena, m)) {
      reasons.push(`attempt ${attempt}: disconnected`);
      continue;
    }
    // The camp-line double-step (spike 14, designer rule 2026-08-21,
    // final form): each side's line is the rank holding the MOST of its
    // dealt pawns — where the position LOOKS like the starting line —
    // with ties resolved toward the enemy (a tied stack puts the line at
    // its front wall; all-scattered terrain resolves generous). The leap
    // zone is that rank plus everything behind it; a pawn dealt AHEAD of
    // the line is already advanced and never leaps.
    const variant = dealVariant(
      arena.files,
      arena.ranks,
      campLineRank(m.white.layout.cells, 1),
      campLineRank(m.black.layout.cells, -1)
    );
    if (ffish) {
      registerDealVariant(ffish, variant);
      const lint = lintMatchupFen(ffish, variant.name, m.fen);
      if (!lint.ok) {
        reasons.push(`attempt ${attempt}: ${lint.reasons.join(',')}`);
        continue;
      }
    }
    return {
      ok: true,
      stageId: stage.id,
      flip,
      cropTop,
      cropBottom,
      stage: arena,
      files: arena.files,
      ranks: arena.ranks,
      autoCrop: { top: autoTop, bottom: autoBottom },
      variantName: variant.name,
      variantIni: variant.ini,
      fen: m.fen,
      turn,
      white: m.white,
      black: m.black,
      gap: m.gap,
      edge: m.white.army.value - m.black.army.value,
      violations: m.violations,
      seed,
      attempt,
      attemptSeed,
      directorSeed: childSeed(attemptSeed, 'director'),
    };
  }
  return { ok: false, error: reasons[reasons.length - 1] ?? 'no attempt ran', reasons };
}

/** The camp line: the rank holding the most of this side's dealt pawns,
 *  ties resolved toward the enemy (`enemyward` = +1 for white, −1 for
 *  black). A lone straggler can never drag the line forward — only an
 *  equally large pawn wall moves it. */
export function campLineRank(layoutCells, enemyward) {
  const counts = new Map();
  for (const c of layoutCells) {
    if (c.piece === 'P') counts.set(c.r + 1, (counts.get(c.r + 1) ?? 0) + 1);
  }
  let best = null;
  for (const [r, n] of counts) {
    if (!best || n > best.n || (n === best.n && (r - best.r) * enemyward > 0)) best = { r, n };
  }
  return best.r;
}

/** Register a deal variant into ffish exactly once per page/process.
 *  Names encode their config (dealVariant), so a repeat is always the
 *  identical block — the guard only saves the redundant parse. */
const registeredDealVariants = new Set();
function registerDealVariant(ffish, variant) {
  if (registeredDealVariants.has(variant.name)) return;
  ffish.loadVariantConfig(variant.ini);
  registeredDealVariants.add(variant.name);
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
