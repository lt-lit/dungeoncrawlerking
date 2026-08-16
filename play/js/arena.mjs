// Hand-authored arena loading + validation (Phase 1 pipeline head: arena
// JSON → variant config + FEN, brief §10).
//
// Color mapping (§4.4): the initiative side plays White, and White ALWAYS
// occupies the bottom formation in FEN terms (buildDuelBoard convention).
// An enemy-initiative arena therefore stamps the ENEMY at the bottom and the
// UI flips the view — square names stay absolute everywhere.
//
// The player's king is NOT part of pieceSet: it is always in the placement
// pool (§4.3 — the summoner deploys with the army; where in the back row is
// the player's choice).
import {
  catalogVariantName,
  buildDuelBoard,
  boardToFen,
  sideRows,
  CATALOG_FILES,
  CATALOG_RANKS,
} from './variant.mjs';
import { squareName, parseSquare, emptyBoard } from './fen.mjs';

export const ARENA_MANIFEST = [
  // Campaign — the authored encounter ladder.
  'arenas/arena01-first-duel.json',
  'arenas/arena02-ambush.json',
  'arenas/arena03-clipped-vault.json',
  'arenas/arena04-long-stair.json',
  // Test scenarios — terrain, army-shape and scale coverage. These exist to
  // be extreme; several are deliberately unbalanced or unwinnable-as-authored.
  'arenas/test01-pillar-hall.json',
  'arenas/test02-causeway.json',
  'arenas/test03-fault-line.json',
  'arenas/test04-sundered-court.json',
  'arenas/test05-rubble-field.json',
  'arenas/test06-ruined-muster.json',
  'arenas/test07-broken-queen.json',
  'arenas/test08-pawn-storm.json',
  'arenas/test09-knights-errant.json',
  'arenas/test10-wardens-court.json',
  'arenas/test11-mirror-match.json',
  'arenas/test12-scrub.json',
  'arenas/test13-full-muster.json',
  'arenas/test14-classic.json',
  'arenas/test15-emperor.json',
];

const BACK_ROW_PIECES = new Set(['Q', 'R', 'B', 'N']);
const SQUARE_RE = /^[a-l](10|[1-9])$/;

function bad(id, msg) {
  throw new Error(`arena ${id ?? '<no id>'}: ${msg}`);
}

/**
 * Validate + normalize one arena JSON object.
 *
 * VALIDATION POLICY — read before adding a check here.
 *
 * `bad()` (a throw) is reserved for arenas the ENGINE or OUR OWN CODE cannot
 * survive: dimensions outside the FSF largeboard ceiling (13x10 crashes the
 * WASM heap), a side without exactly one royal (duel.mjs's king-capture
 * adjudication and the Director's never-displace-a-king rule both assume one),
 * formations that overlap (the stamp would silently overwrite), a side with no
 * material (already decided at load under the bare-army rule 4), and squares
 * that are not on the board.
 *
 * Everything else we merely BELIEVE — pacing, balance, patch width, army
 * composition — is a `warn()`, collected on `arena.warnings`. The §4.2 patch
 * caps (player 3–5, enemy 2–5), the pieceSet ceiling, the 3x6 dimension floor
 * and the gap cap used to be throws. They were authoring guesses from a brief
 * that marks army composition `[PROVISIONAL]` and §8 that says the army GROWS
 * through the run; the gap cap in particular was justified by sweep data from
 * the RETIRED crumble system, which CLAUDE.md itself disowns until the Phase
 * 1.5 harness port lands. A throw stops us from ever collecting the
 * counter-evidence; a warning stays falsifiable. Phase 1.5 re-derives the real
 * numbers — until then the linter reports, it does not forbid.
 */
export function loadArena(json) {
  const id = json.id;
  const warnings = [];
  const warn = (msg) => warnings.push(msg);

  if (json.schema !== 1 && json.schema !== 2) bad(id, `unsupported schema ${json.schema}`);
  if (!id || !json.title) bad(id, 'id and title are required');
  const { files, ranks } = json;
  // REAL: the catalog range is the FSF largeboard ceiling. Past 12x10 this
  // WASM build throws "memory access out of bounds" on Board construction —
  // and loadVariantConfig does NOT reject the oversized block, it silently
  // drops the variant.
  if (!Number.isInteger(files) || files < CATALOG_FILES.min || files > CATALOG_FILES.max) {
    bad(id, `files ${files} outside catalog range ${CATALOG_FILES.min}–${CATALOG_FILES.max} (FSF largeboard ceiling)`);
  }
  if (!Number.isInteger(ranks) || ranks < CATALOG_RANKS.min || ranks > CATALOG_RANKS.max) {
    bad(id, `ranks ${ranks} outside catalog range ${CATALOG_RANKS.min}–${CATALOG_RANKS.max} (FSF largeboard ceiling)`);
  }

  const walls = json.walls ?? [];
  const wallSet = new Set();
  for (const w of walls) {
    if (typeof w !== 'string' || !SQUARE_RE.test(w)) bad(id, `bad wall square "${w}"`);
    const { file, rankFromBottom } = parseSquare(w);
    if (file >= files || rankFromBottom >= ranks) bad(id, `wall ${w} off the ${files}x${ranks} board`);
    if (wallSet.has(w)) bad(id, `duplicate wall ${w}`);
    wallSet.add(w);
  }

  if (json.initiative !== 'player' && json.initiative !== 'enemy') {
    bad(id, `initiative must be "player" or "enemy", got "${json.initiative}"`);
  }
  const playerColor = json.initiative === 'player' ? 'white' : 'black';
  const enemyColor = playerColor === 'white' ? 'black' : 'white';

  // Enemy formation: fixed, authored. One or more piece rows (rows[0] = back
  // rank, later entries step toward the player) plus one pawn row. `backRank`
  // is the schema-1 single-row shorthand.
  const enemy = json.enemy ?? {};
  const eRows = sideRows(enemy);
  if (!Array.isArray(eRows) || !eRows.length || !eRows.every((r) => Array.isArray(r))) {
    bad(id, 'enemy needs `rows` (array of piece-row arrays) or `backRank` (single row)');
  }
  const eStart = enemy.backRankStart ?? 0;
  if (!Number.isInteger(eStart) || eStart < 0) bad(id, `enemy.backRankStart ${eStart} must be a non-negative integer`);
  const eWidth = Math.max(...eRows.map((r) => r.length));
  if (eStart + eWidth > files) {
    warn(`enemy formation [${eStart}, ${eStart + eWidth}) overhangs ${files} files — the overhang is clipped (§4.2)`);
  }
  // REAL: exactly one royal per side. FSF itself tolerates two kings (measured:
  // it returns legal moves happily), but duel.mjs's kingless adjudication and
  // the Director's never-displace-a-king rule are both written for one. A
  // letter check for now; when custom royals land this becomes "exactly one
  // piece whose type is royal".
  const kings = eRows.flat().filter((p) => p === 'K').length;
  if (kings !== 1) bad(id, `enemy formation needs exactly one 'K', has ${kings}`);
  for (const p of eRows.flat()) {
    if (p !== null && p !== 'K' && !BACK_ROW_PIECES.has(p)) bad(id, `enemy piece "${p}" not in {Q,R,B,N,K,null}`);
  }
  const enemyBackRow = playerColor === 'white' ? ranks - 1 : 0;
  const eDir = enemyBackRow === 0 ? 1 : -1;
  const eKingDepth = eRows.findIndex((r) => r.includes('K'));
  const eKingFile = eStart + eRows[eKingDepth].indexOf('K');
  const eKingSquare = squareName(eKingFile, enemyBackRow + eDir * eKingDepth);
  // REAL: a walled or clipped king slot means the stamped position has no
  // enemy king at all.
  if (eKingFile >= files) bad(id, `enemy king is clipped off the ${files}-file board`);
  if (wallSet.has(eKingSquare)) bad(id, `enemy king slot ${eKingSquare} is walled`);

  // Player: a POOL plus a default arrangement anchor. `pieceRows` is how deep
  // the player's piece-placement region runs — an N×M army in §4.2
  // bounding-box terms is M-1 piece rows over one pawn row.
  const player = json.player ?? {};
  const width = player.patchWidth ?? 3;
  if (!Number.isInteger(width) || width < 1) bad(id, `player.patchWidth ${width} must be a positive integer`);
  const pStart = player.backRankStart ?? 0;
  if (!Number.isInteger(pStart) || pStart < 0) bad(id, `player.backRankStart ${pStart} must be a non-negative integer`);
  if (pStart + width > files) {
    warn(`player patch [${pStart}, ${pStart + width}) overhangs ${files} files — the overhang is clipped (§4.2)`);
  }
  // `player.rows` is an OPTIONAL authored default arrangement, same shape as
  // the enemy's. Without it the default placement is the value-sorted
  // heuristic below (king centre, heavy pieces outward), which is right for
  // an ordinary encounter but cannot express a specific opening shape — the
  // classic back rank comes out as BNRKQRBN. With it, the arena author names
  // the exact squares. The player may still rearrange everything at setup;
  // this only seeds the board.
  const pRows = player.rows ?? null;
  if (pRows !== null && (!Array.isArray(pRows) || !pRows.length || !pRows.every((r) => Array.isArray(r)))) {
    bad(id, 'player.rows must be an array of piece-row arrays');
  }
  if (pRows) {
    const pKings = pRows.flat().filter((p) => p === 'K').length;
    if (pKings !== 1) bad(id, `player.rows is a full arrangement and needs exactly one 'K', has ${pKings}`);
    for (const p of pRows.flat()) {
      if (p !== null && p !== 'K' && !BACK_ROW_PIECES.has(p)) bad(id, `player piece "${p}" not in {Q,R,B,N,K,null}`);
    }
  }
  const pieceRows = player.pieceRows ?? pRows?.length ?? 1;
  if (!Number.isInteger(pieceRows) || pieceRows < 1) bad(id, `player.pieceRows ${pieceRows} must be a positive integer`);
  if (pRows && pieceRows < pRows.length) {
    bad(id, `player.pieceRows ${pieceRows} is shallower than the ${pRows.length} rows authored in player.rows`);
  }
  // With an authored arrangement the pool is DERIVED from it, so the tray and
  // the board can never disagree (a mismatch would only surface as "not in
  // your piece pool" at Begin).
  const derived = pRows ? pRows.flat().filter((p) => p && p !== 'K') : null;
  const pieceSet = derived ?? player.pieceSet ?? [];
  if (!Array.isArray(pieceSet)) bad(id, 'player.pieceSet must be an array');
  if (derived && player.pieceSet) {
    const norm = (a) => a.slice().sort().join('');
    if (norm(derived) !== norm(player.pieceSet)) {
      bad(id, `player.pieceSet [${player.pieceSet}] does not match the pieces in player.rows [${derived}]`);
    }
  }
  for (const p of pieceSet) {
    if (!BACK_ROW_PIECES.has(p)) bad(id, `player piece "${p}" not in {Q,R,B,N} (the king is implicit)`);
  }
  const queens = pieceSet.filter((p) => p === 'Q').length + eRows.flat().filter((p) => p === 'Q').length;
  if (queens > 2) warn(`${queens} queens across both armies — the design target is at most one per side`);

  // Legacy pacing block: only `seed` is read by this build (the Director's
  // pacing comes from the settings preset / query params). onsetPly and
  // cadence are accepted and ignored rather than validated — range-checking
  // fields that nothing reads was pure ceremony.
  const crumble = { onsetPly: 60, cadence: 12, seed: 1, ...(json.crumble ?? {}) };
  if (!Number.isInteger(crumble.seed) || crumble.seed < 1) bad(id, 'crumble.seed must be an integer >= 1');

  // Optional explicit pawn files ("pawns": ["a","c"]) — sparse pawn rows.
  // Absent = the §4.2 automatic full-patch-width row.
  const parsePawns = (side, label) => {
    if (side.pawns === undefined) return null;
    if (!Array.isArray(side.pawns)) bad(id, `${label}.pawns must be an array of file letters`);
    const idx = [];
    for (const p of side.pawns) {
      if (typeof p !== 'string' || !/^[a-l]$/.test(p)) bad(id, `${label}.pawns entry "${p}" is not a file letter`);
      const f = p.charCodeAt(0) - 97;
      if (f >= files) bad(id, `${label} pawn file "${p}" off the ${files}-file board`);
      if (idx.includes(f)) bad(id, `duplicate ${label} pawn file "${p}"`);
      idx.push(f);
    }
    return idx;
  };
  const enemyPawnFiles = parsePawns(enemy, 'enemy');
  const playerPawnFiles = parsePawns(player, 'player');

  // REAL (bare-army adjudication, rule 4): a side with no non-king material
  // has already lost — the position is decided the moment it loads, so the
  // arena is unplayable rather than merely unbalanced.
  // Automatic pawn rows span the back rank's slots (§4.2 default), so an
  // absent `pawns` array means one pawn per back-rank slot.
  const enemyPawnCount = enemyPawnFiles ? enemyPawnFiles.length : eRows[0].length;
  const enemyUnits = eRows.flat().filter((p) => p && p !== 'K').length + enemyPawnCount;
  if (enemyUnits < 1) bad(id, 'enemy army has no non-king material (instant loss under bare-army adjudication)');
  const playerUnits = pieceSet.length + (playerPawnFiles ? playerPawnFiles.length : width);
  if (playerUnits < 1) bad(id, 'player army has no non-king material (instant loss under bare-army adjudication)');

  // REAL: the two formations must not overlap. Each side occupies its piece
  // rows plus a pawn row; if those depths collide the two stamps silently
  // overwrite each other and the arena that loads is not the one authored.
  // A PAWNLESS side ("pawns": []) occupies no pawn row and is one rank
  // shallower — counting it anyway would reject legal tight boards.
  const hasPawns = (pawnFiles) => (pawnFiles === null ? 1 : pawnFiles.length > 0 ? 1 : 0);
  const playerDepth = pieceRows + hasPawns(playerPawnFiles);
  const enemyDepth = eRows.length + hasPawns(enemyPawnFiles);
  if (playerDepth + enemyDepth > ranks) {
    bad(
      id,
      `formations overlap: player is ${playerDepth} rows deep, enemy ${enemyDepth}, on ${ranks} ranks ` +
        `(need ${playerDepth + enemyDepth} or more)`
    );
  }

  const arena = {
    id,
    title: json.title,
    intro: json.intro ?? '',
    // Presentation only — groups the menu. Never gates validation.
    section: json.section === 'test' ? 'test' : 'campaign',
    files,
    ranks,
    walls: [...wallSet],
    // `rows` is the single source of truth for a formation — no `backRank`
    // alias on the loaded object, so the two cannot drift.
    enemy: { rows: eRows, backRankStart: eStart, pawnFiles: enemyPawnFiles },
    player: {
      pieceSet,
      pieceRows,
      rows: pRows,
      backRankStart: pStart,
      patchWidth: width,
      pawnFiles: playerPawnFiles,
    },
    initiative: json.initiative,
    playerColor,
    enemyColor,
    // What the encounter linter should assert. Defaults to the §13 balance
    // philosophy (arenas favor the player) for campaign arenas; test scenarios
    // exist to be extreme, so they only have to be DECISIVE unless they say
    // otherwise.
    expect: json.expect ?? (json.section === 'test' ? 'any' : 'player'),
    crumble,
    variantName: catalogVariantName(files, ranks),
    warnings,
  };
  if (!['player', 'enemy', 'any'].includes(arena.expect)) {
    bad(id, `expect must be "player", "enemy" or "any", got "${arena.expect}"`);
  }

  // REAL: with nowhere to put the king there is no placement at all.
  const slots = playerSlotSquares(arena);
  if (!slots.length) bad(id, 'player has no non-wall placement square — the king cannot be placed');
  if (slots.length < pieceSet.length + 1) {
    warn(`player has ${slots.length} placement square(s) for ${pieceSet.length + 1} pieces — the surplus cannot be deployed`);
  }

  // Gap: the empty ranks between the two formations. The old [2,4] cap is
  // gone — it was calibrated against the RETIRED crumble system (CLAUDE.md
  // disowns those sweep numbers until the Phase 1.5 harness port). Phase 1.5
  // re-derives the real band; until then this reports and does not forbid.
  const gap = ranks - playerDepth - enemyDepth;
  if (gap > 4) warn(`gap ${gap} is wide — gaps above 4 ground past 100 plies under the retired crumble system (unverified for the Director)`);

  // Disconnected arenas are a real §6 hazard (spike 2: finite eval, no progress
  // possible, no draw rule) — but a severed board is also exactly the fortress
  // case worth testing on purpose, so this reports rather than throws.
  const board = composeBoard(arena, {}, {});
  if (!formationsConnected(arena, board)) {
    warn('arena is disconnected — walls fully sever the two formations; expect a fortress grind with no legal progress (§6)');
  }

  return arena;
}

/** Rank-from-bottom index of the player's back row. */
export function playerBackRow(arena) {
  return arena.playerColor === 'white' ? 0 : arena.ranks - 1;
}

/** Step direction (in ranks-from-bottom) from a side's back row toward the
 *  enemy: +1 for the bottom formation, -1 for the top one. */
function forward(backRow) {
  return backRow === 0 ? 1 : -1;
}

/** The player's piece rows, back rank first, as rank-from-bottom indices. */
function playerPieceRowIndices(arena) {
  const back = playerBackRow(arena);
  const dir = forward(back);
  const out = [];
  for (let d = 0; d < (arena.player.pieceRows ?? 1); d++) {
    const rb = back + dir * d;
    if (rb >= 0 && rb < arena.ranks) out.push(rb);
  }
  return out;
}

/** Rank-from-bottom index of the player's pawn row — in front of the last
 *  piece row, so it moves outward as the army gets deeper. */
function playerPawnRow(arena) {
  const back = playerBackRow(arena);
  return back + forward(back) * (arena.player.pieceRows ?? 1);
}

function rowSquares(arena, rowRb) {
  if (rowRb < 0 || rowRb >= arena.ranks) return [];
  const wallSet = new Set(arena.walls);
  const out = [];
  for (let f = 0; f < arena.files; f++) {
    const sq = squareName(f, rowRb);
    if (!wallSet.has(sq)) out.push(sq);
  }
  return out;
}

/** Piece slots: every non-wall square of the player's piece rows (placement is
 *  not patch-bound — the patch only sets the DEFAULT arrangement). */
export function playerSlotSquares(arena) {
  return playerPieceRowIndices(arena).flatMap((rb) => rowSquares(arena, rb));
}

/** Pawn-legal squares: anywhere non-wall within the player's formation depth —
 *  the piece rows plus the pawn row in front of them. */
export function playerPawnSquares(arena) {
  return [...playerSlotSquares(arena), ...rowSquares(arena, playerPawnRow(arena))];
}

/** Scan a buildDuelBoard result into { square: PIECE } (uppercase). */
function scanSetup(arena, board) {
  const setup = {};
  board.forEach((rankArr, rt) => {
    rankArr.forEach((cell, f) => {
      if (cell && cell !== '*') setup[squareName(f, arena.ranks - 1 - rt)] = cell.toUpperCase();
    });
  });
  return setup;
}

/** Stamp one side alone and scan it. buildDuelBoard's white/black slots
 *  encode pawn-row DIRECTION (white's pawn row is above its back row), so
 *  the slot must follow board position — bottom formation stamps as white,
 *  top as black — regardless of the side's actual duel color. */
function stampSideSetup(arena, side, row) {
  const atBottom = row === 0;
  const board = buildDuelBoard({
    files: arena.files,
    ranks: arena.ranks,
    walls: arena.walls,
    white: atBottom ? { ...side, row } : null,
    black: atBottom ? null : { ...side, row },
  });
  return scanSetup(arena, board);
}

/** The authored enemy formation as an editable { square: piece } map —
 *  exactly what buildDuelBoard stamps (§4.2 semantics, walls eat slots). */
export function defaultEnemySetup(arena) {
  const eRow = playerBackRow(arena) === 0 ? arena.ranks - 1 : 0;
  return stampSideSetup(
    arena,
    {
      rows: arena.enemy.rows,
      backRankStart: arena.enemy.backRankStart,
      pawnFiles: arena.enemy.pawnFiles ?? undefined,
    },
    eRow
  );
}

/** The authored default squares for the player's pawns. An empty piece row per
 *  `pieceRows` puts the pawn row at the army's real depth. */
export function defaultPawnSquares(arena) {
  const setup = stampSideSetup(
    arena,
    {
      rows: Array.from({ length: arena.player.pieceRows ?? 1 }, () =>
        Array(arena.player.patchWidth).fill(null)
      ),
      backRankStart: arena.player.backRankStart,
      pawnFiles: arena.player.pawnFiles ?? undefined,
    },
    playerBackRow(arena)
  );
  return Object.keys(setup);
}

/** The player's full placement pool: king + pieces + pawns. */
export function playerPool(arena) {
  return ['K', ...arena.player.pieceSet, ...defaultPawnSquares(arena).map(() => 'P')];
}

const PIECE_VALUES = { q: 9, r: 5, b: 3, n: 3, k: 0, p: 1 };

/**
 * Default placement — the authored formation: king nearest the patch middle,
 * pieces by value outward (the harness's "balanced" archetype, §7), pawns at
 * their authored squares.
 *
 * Lives here because both the game (main.mjs) and the encounter linter
 * (phase0/harness/verify-play-arenas.mjs) must stamp the IDENTICAL default —
 * they used to keep hand-synced copies, so a linter run could measure a
 * position the game never shows.
 *
 * With more than one piece row the back rank fills completely before anything
 * spills into the row in front of it, so a deep army still leads with its king
 * and heavy pieces on the back rank.
 */
export function defaultPlacement(arena) {
  const slots = playerSlotSquares(arena); // piece rows, back rank first
  if (!slots.length) return {};

  // Authored arrangement: stamp it verbatim (walls still eat slots), then let
  // the pawn pass below fill in anything it did not cover.
  if (arena.player.rows) {
    const placement = stampSideSetup(
      arena,
      {
        rows: arena.player.rows,
        backRankStart: arena.player.backRankStart,
        pawnFiles: arena.player.pawnFiles ?? undefined,
      },
      playerBackRow(arena)
    );
    for (const sq of defaultPawnSquares(arena)) {
      if (!placement[sq]) placement[sq] = 'P';
    }
    return placement;
  }

  const placement = {};
  const mid = (arena.player.backRankStart * 2 + arena.player.patchWidth - 1) / 2;
  const fromMid = (a, b) => Math.abs(parseSquare(a).file - mid) - Math.abs(parseSquare(b).file - mid);

  // Group by rank (playerSlotSquares already emits back rank first), then sort
  // each row from the patch middle outward.
  const rows = [];
  for (const sq of slots) {
    const rb = parseSquare(sq).rankFromBottom;
    let row = rows.find((r) => r.rb === rb);
    if (!row) rows.push((row = { rb, squares: [] }));
    row.squares.push(sq);
  }
  const ordered = rows.flatMap((row) => row.squares.slice().sort(fromMid));

  placement[ordered[0]] = 'K';
  const rest = ordered.slice(1);
  const pieces = arena.player.pieceSet
    .slice()
    .sort((a, b) => PIECE_VALUES[b.toLowerCase()] - PIECE_VALUES[a.toLowerCase()]);
  pieces.slice(0, rest.length).forEach((p, i) => {
    placement[rest[i]] = p;
  });
  for (const sq of defaultPawnSquares(arena)) {
    if (!placement[sq]) placement[sq] = 'P';
  }
  return placement;
}

/** Compose the duel board from explicit square maps (no validation). */
function composeBoard(arena, placement, enemySetup) {
  const board = emptyBoard(arena.files, arena.ranks);
  const put = (sq, piece, color) => {
    const { file, rankFromBottom } = parseSquare(sq);
    board[arena.ranks - 1 - rankFromBottom][file] = color === 'white' ? piece.toUpperCase() : piece.toLowerCase();
  };
  for (const w of arena.walls) {
    const { file, rankFromBottom } = parseSquare(w);
    board[arena.ranks - 1 - rankFromBottom][file] = '*';
  }
  for (const [sq, piece] of Object.entries(enemySetup)) put(sq, piece, arena.enemyColor);
  for (const [sq, piece] of Object.entries(placement)) put(sq, piece, arena.playerColor);
  return board;
}

/** Placement-screen preview — no validation (kingless previews are fine). */
export function buildPreviewFen(arena, placement, enemySetup = null) {
  return boardToFen(composeBoard(arena, placement, enemySetup ?? defaultEnemySetup(arena)));
}

const PLACEABLE = new Set(['K', 'Q', 'R', 'B', 'N', 'P']);

/** Validate a player placement (+ optionally edited enemy setup) and emit the
 *  duel startFen (turn = White, §4.3: placement consumes no plies regardless
 *  of initiative). Pieces go on the back row; pawns anywhere on the first two
 *  rows; the enemy may be rearranged freely but keeps exactly one king. */
export function buildStartFen(arena, placement, enemySetup = null) {
  const enemy = enemySetup ?? defaultEnemySetup(arena);
  const entries = Object.entries(placement);
  if (!entries.length) throw new Error('place your king first');
  const slots = new Set(playerSlotSquares(arena));
  const pawnSquares = new Set(playerPawnSquares(arena));
  const pool = playerPool(arena);
  let kings = 0;
  for (const [sq, piece] of entries) {
    if (piece === 'P') {
      if (!pawnSquares.has(sq)) throw new Error(`pawns go within your formation depth (${sq})`);
    } else {
      if (!slots.has(sq)) throw new Error(`pieces go on your piece rows (${sq})`);
      if (piece === 'K') kings++;
    }
    const i = pool.indexOf(piece);
    if (i < 0) throw new Error(`${piece} is not in your piece pool`);
    pool.splice(i, 1);
    if (enemy[sq]) throw new Error(`${sq} is occupied by the enemy`);
  }
  if (kings !== 1) throw new Error('your king must be placed (exactly once)');
  const wallSet = new Set(arena.walls);
  let eKings = 0;
  for (const [sq, piece] of Object.entries(enemy)) {
    const { file, rankFromBottom } = parseSquare(sq);
    if (file >= arena.files || rankFromBottom >= arena.ranks) throw new Error(`enemy piece off the board (${sq})`);
    if (wallSet.has(sq)) throw new Error(`enemy piece on a wall (${sq})`);
    if (!PLACEABLE.has(piece)) throw new Error(`bad enemy piece "${piece}" at ${sq}`);
    if (piece === 'K') eKings++;
  }
  if (eKings !== 1) throw new Error('the enemy must keep exactly one king');
  return { startFen: boardToFen(composeBoard(arena, placement, enemy)) };
}

/** 8-directional BFS from the PLAYER's surviving formation squares to any
 *  ENEMY formation square, through non-walls (pieces are passable — they
 *  move). Adapted from phase0/harness/arena.mjs, where full-width patches let
 *  it start from the whole pawn row; here patches can be narrower than the
 *  board, so an open corridor OUTSIDE the patch must not count as connected. */
function formationsConnected(arena, board) {
  const { files, ranks } = arena;
  const rt = (rb) => ranks - 1 - rb; // rank-from-bottom → board row index
  const blocked = (r, f) => board[r][f] === '*';
  const pBack = playerBackRow(arena);
  const eBack = pBack === 0 ? ranks - 1 : 0;
  // A formation's cells are its piece rows plus its pawn row, so the depth
  // follows pieceRows / rows.length rather than the old hardcoded two.
  const patchCells = (backRb, start, width, depth) => {
    const dir = forward(backRb);
    const out = [];
    for (let d = 0; d <= depth; d++) {
      const rb = backRb + dir * d;
      if (rb < 0 || rb >= ranks) continue;
      for (let i = 0; i < width; i++) {
        const f = start + i;
        if (f < files && !blocked(rt(rb), f)) out.push([rt(rb), f]);
      }
    }
    return out;
  };
  const start = patchCells(
    pBack,
    arena.player.backRankStart,
    arena.player.patchWidth,
    arena.player.pieceRows ?? 1
  );
  const eWidth = Math.max(...arena.enemy.rows.map((r) => r.length));
  const targets = new Set(
    patchCells(eBack, arena.enemy.backRankStart, eWidth, arena.enemy.rows.length).map(([r, f]) => r * 100 + f)
  );
  const seen = new Set(start.map(([r, f]) => r * 100 + f));
  const queue = [...start];
  while (queue.length) {
    const [r, f] = queue.shift();
    if (targets.has(r * 100 + f)) return true;
    for (let dr = -1; dr <= 1; dr++) {
      for (let df = -1; df <= 1; df++) {
        if (!dr && !df) continue;
        const nr = r + dr;
        const nf = f + df;
        if (nr < 0 || nr >= ranks || nf < 0 || nf >= files) continue;
        const key = nr * 100 + nf;
        if (seen.has(key) || blocked(nr, nf)) continue;
        seen.add(key);
        queue.push([nr, nf]);
      }
    }
  }
  return false;
}

export async function fetchArena(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
  return loadArena(await res.json());
}
