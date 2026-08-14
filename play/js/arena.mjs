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
import { catalogVariantName, buildDuelBoard, boardToFen } from './variant.mjs';
import { squareName, parseSquare, emptyBoard } from './fen.mjs';

export const ARENA_MANIFEST = [
  'arenas/arena01-first-duel.json',
  'arenas/arena02-ambush.json',
  'arenas/arena03-clipped-vault.json',
  'arenas/arena04-long-stair.json',
];

const BACK_ROW_PIECES = new Set(['Q', 'R', 'B', 'N']);
const SQUARE_RE = /^[a-l](10|[1-9])$/;

function bad(id, msg) {
  throw new Error(`arena ${id ?? '<no id>'}: ${msg}`);
}

/** Validate + normalize one arena JSON object. */
export function loadArena(json) {
  const id = json.id;
  if (json.schema !== 1) bad(id, `unsupported schema ${json.schema}`);
  if (!id || !json.title) bad(id, 'id and title are required');
  const { files, ranks } = json;
  if (!Number.isInteger(files) || files < 3 || files > 12) bad(id, `files ${files} outside catalog range 3–12`);
  if (!Number.isInteger(ranks) || ranks < 6 || ranks > 10) bad(id, `ranks ${ranks} outside catalog range 6–10`);
  // Gap cap 4: gaps 5–6 produced 100+-ply grinds with near-certain
  // crumble-flips in every Phase 0/starter sweep — duels are puzzles now, and
  // the duel trigger will enforce the same ceiling. (Catalog still carries
  // 9/10-rank variants; arenas just may not use them.)
  const gap = ranks - 4;
  if (gap < 2 || gap > 4) bad(id, `gap ${gap} outside [2,4] (§4.4 gap math + puzzle-pacing cap)`);

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

  // Enemy formation: fixed, authored (§4.3).
  const enemy = json.enemy ?? {};
  // Enemy patch floor is 2 (small-army encounters: king + one piece). The
  // §4.2 width-3 floor is a PLAYER-side rule — the arena itself never drops
  // below 3 files, so a 2-wide enemy just leaves open lanes.
  const eRank = enemy.backRank;
  if (!Array.isArray(eRank) || eRank.length < 2 || eRank.length > 5) {
    bad(id, `enemy.backRank must be a 2–5 slot array (§4.2 patch width; enemy floor 2)`);
  }
  const eStart = enemy.backRankStart ?? 0;
  if (!Number.isInteger(eStart) || eStart < 0 || eStart + eRank.length > files) {
    bad(id, `enemy patch [${eStart}, ${eStart + eRank.length}) does not fit ${files} files`);
  }
  const kings = eRank.filter((p) => p === 'K').length;
  if (kings !== 1) bad(id, `enemy.backRank needs exactly one 'K', has ${kings}`);
  for (const p of eRank) {
    if (p !== null && p !== 'K' && !BACK_ROW_PIECES.has(p)) bad(id, `enemy piece "${p}" not in {Q,R,B,N,K,null}`);
  }
  const enemyRow = playerColor === 'white' ? ranks - 1 : 0;
  const eKingFile = eStart + eRank.indexOf('K');
  if (wallSet.has(squareName(eKingFile, enemyRow))) bad(id, `enemy king slot ${squareName(eKingFile, enemyRow)} is walled`);

  // Player patch + pool.
  const player = json.player ?? {};
  const width = player.patchWidth;
  if (!Number.isInteger(width) || width < 3 || width > 5) bad(id, `player.patchWidth ${width} outside [3,5] (§4.2)`);
  const pStart = player.backRankStart ?? 0;
  if (!Number.isInteger(pStart) || pStart < 0 || pStart + width > files) {
    bad(id, `player patch [${pStart}, ${pStart + width}) does not fit ${files} files`);
  }
  const pieceSet = player.pieceSet ?? [];
  if (!Array.isArray(pieceSet) || pieceSet.length > 7) bad(id, 'player.pieceSet must be an array of at most 7 pieces');
  for (const p of pieceSet) {
    if (!BACK_ROW_PIECES.has(p)) bad(id, `player piece "${p}" not in {Q,R,B,N} (the king is implicit)`);
  }

  const crumble = json.crumble ?? { onsetPly: 60, cadence: 12, seed: 1 };
  for (const [k, min] of [['onsetPly', 1], ['cadence', 0], ['seed', 1]]) {
    if (!Number.isInteger(crumble[k]) || crumble[k] < min) bad(id, `crumble.${k} must be an integer >= ${min}`);
  }

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

  const arena = {
    id,
    title: json.title,
    intro: json.intro ?? '',
    files,
    ranks,
    walls: [...wallSet],
    enemy: { backRank: eRank, backRankStart: eStart, pawnFiles: enemyPawnFiles },
    player: { pieceSet, backRankStart: pStart, patchWidth: width, pawnFiles: playerPawnFiles },
    initiative: json.initiative,
    playerColor,
    enemyColor,
    crumble,
    variantName: catalogVariantName(files, ranks),
  };

  const slots = playerSlotSquares(arena);
  if (slots.length < 2) bad(id, `player back row keeps only ${slots.length} non-wall square(s) — need king + at least one`);

  // Disconnected arenas are the one real §6 hazard (spike 2: finite eval, no
  // progress possible, no draw rule). The BFS treats pieces as passable, so a
  // walls-only board is all it needs.
  const board = composeBoard(arena, {}, {});
  if (!formationsConnected(arena, board)) bad(id, 'arena is disconnected — walls fully sever the two formations (§6 lint)');

  return arena;
}

/** Rank-from-bottom index of the player's back row. */
export function playerBackRow(arena) {
  return arena.playerColor === 'white' ? 0 : arena.ranks - 1;
}

/** Rank-from-bottom index of the player's pawn row (second row). */
function playerPawnRow(arena) {
  return playerBackRow(arena) === 0 ? 1 : arena.ranks - 2;
}

function rowSquares(arena, rowRb) {
  const wallSet = new Set(arena.walls);
  const out = [];
  for (let f = 0; f < arena.files; f++) {
    const sq = squareName(f, rowRb);
    if (!wallSet.has(sq)) out.push(sq);
  }
  return out;
}

/** Piece slots: the ENTIRE non-wall back row (placement is not patch-bound). */
export function playerSlotSquares(arena) {
  return rowSquares(arena, playerBackRow(arena));
}

/** Pawn-legal squares: anywhere non-wall on the player's first two rows. */
export function playerPawnSquares(arena) {
  return [...rowSquares(arena, playerBackRow(arena)), ...rowSquares(arena, playerPawnRow(arena))];
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
      backRank: arena.enemy.backRank,
      backRankStart: arena.enemy.backRankStart,
      pawnFiles: arena.enemy.pawnFiles ?? undefined,
    },
    eRow
  );
}

/** The authored default squares for the player's pawns. */
export function defaultPawnSquares(arena) {
  const setup = stampSideSetup(
    arena,
    {
      backRank: Array(arena.player.patchWidth).fill(null),
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
      if (!pawnSquares.has(sq)) throw new Error(`pawns go on your first two rows (${sq})`);
    } else {
      if (!slots.has(sq)) throw new Error(`pieces go on your back row (${sq})`);
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
  const pawnOf = (back) => (back === 0 ? 1 : ranks - 2);
  const patchCells = (backRb, start, width) => {
    const out = [];
    for (const rb of [backRb, pawnOf(backRb)]) {
      for (let i = 0; i < width; i++) {
        const f = start + i;
        if (f < files && !blocked(rt(rb), f)) out.push([rt(rb), f]);
      }
    }
    return out;
  };
  const start = patchCells(pBack, arena.player.backRankStart, arena.player.patchWidth);
  const targets = new Set(
    patchCells(eBack, arena.enemy.backRankStart, arena.enemy.backRank.length).map(([r, f]) => r * 100 + f)
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
