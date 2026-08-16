// Arena schema/validator regression test — pure, no engine, runs in ~50 ms.
//
// Pins the VALIDATION POLICY documented on loadArena(): hard errors are only
// for what the engine or our own code cannot survive; everything we merely
// believe about pacing, balance and army shape is a warning. The §4.2 patch
// caps, the pieceSet ceiling, the 3x6 dimension floor and the gap cap were all
// throws once — this file exists so they cannot quietly come back.
//
// Usage: cd phase0 && node harness/verify-arena-schema.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadArena, buildStartFen, defaultPlacement, playerPool } from '../../play/js/arena.mjs';
import { makeDuelVariantIni, catalogSize } from '../../play/js/variant.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARENA_DIR = path.resolve(HERE, '../../play/arenas');

let pass = 0;
let fail = 0;
function check(label, fn) {
  try {
    const note = fn();
    pass++;
    console.log(`  PASS ${label}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    fail++;
    console.log(`  FAIL ${label} — ${e.message}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

/** A minimal valid arena; `over` patches it. */
const base = (over = {}) => ({
  schema: 2,
  id: 'fixture',
  title: 'Fixture',
  files: 6,
  ranks: 8,
  walls: [],
  enemy: { backRank: ['R', 'K'], backRankStart: 2, pawns: ['c', 'd'] },
  player: { pieceSet: ['R', 'N'], backRankStart: 1, patchWidth: 3, pawns: ['b', 'c', 'd'] },
  initiative: 'player',
  ...over,
});

const loads = (over) => loadArena(base(over));
const throws = (over) => {
  try {
    loadArena(base(over));
  } catch (e) {
    return e.message;
  }
  throw new Error('expected loadArena to throw, it did not');
};

console.log('\n--- shapes that must LOAD (these were hard errors before) ---');
check('2-wide player patch (below the old §4.2 floor of 3)', () => {
  const a = loads({ player: { pieceSet: ['N'], backRankStart: 1, patchWidth: 2, pawns: ['b', 'c'] } });
  assert(a.player.patchWidth === 2, 'patchWidth not preserved');
});
check('12-wide player patch (above the old cap of 5)', () => {
  const a = loads({
    files: 12,
    player: { pieceSet: ['Q', 'R', 'R', 'B', 'B', 'N', 'N'], backRankStart: 0, patchWidth: 12, pawns: ['a', 'b'] },
  });
  assert(a.player.patchWidth === 12);
});
check('8-piece pieceSet (above the old ceiling of 7)', () => {
  const a = loads({
    files: 10,
    player: { pieceSet: ['Q', 'R', 'R', 'B', 'B', 'N', 'N', 'R'], backRankStart: 0, patchWidth: 8, pawns: ['a'] },
  });
  assert(a.player.pieceSet.length === 8);
});
check('12x10, the FSF ceiling (ranks 9-10 were blocked by the gap cap)', () => {
  const a = loads({ files: 12, ranks: 10 });
  assert(a.variantName === 'duel_12x10', a.variantName);
});
check('4x2 board (below the old 3x6 catalog floor)', () => {
  // Pawnless both sides, so each formation is one rank deep and two ranks fit.
  const a = loadArena({
    schema: 2,
    id: 'tiny',
    title: 'Tiny',
    files: 4,
    ranks: 2,
    enemy: { backRank: ['R', 'K'], backRankStart: 0, pawns: [] },
    player: { pieceSet: ['R'], backRankStart: 0, patchWidth: 2, pawns: [] },
    initiative: 'player',
  });
  assert(a.variantName === 'duel_4x2', a.variantName);
  return `${a.files}x${a.ranks}`;
});
check('a pawnless side is one rank shallower for the overlap check', () => {
  // 1 piece row + no pawns a side = depth 1 each; 3 ranks is plenty.
  loadArena({
    schema: 2,
    id: 'shallow',
    title: 'Shallow',
    files: 5,
    ranks: 3,
    enemy: { backRank: ['R', 'K'], backRankStart: 0, pawns: [] },
    player: { pieceSet: ['R'], backRankStart: 0, patchWidth: 2, pawns: [] },
    initiative: 'player',
  });
});
check('gap 6 loads and only WARNS', () => {
  const a = loads({ ranks: 10 });
  assert(a.warnings.some((w) => /gap 6/.test(w)), `expected a gap warning, got ${JSON.stringify(a.warnings)}`);
});
check('disconnected arena loads and only WARNS (fortress case is testable)', () => {
  const a = loads({ files: 3, ranks: 8, walls: ['a4', 'b4', 'c4'], player: { pieceSet: ['R'], backRankStart: 0, patchWidth: 3, pawns: ['a'] }, enemy: { backRank: ['R', 'K'], backRankStart: 0, pawns: ['a'] } });
  assert(a.warnings.some((w) => /disconnected/.test(w)), `expected a connectivity warning, got ${JSON.stringify(a.warnings)}`);
});
check('schema 1 still loads unchanged', () => {
  const a = loadArena(JSON.parse(fs.readFileSync(path.join(ARENA_DIR, 'arena01-first-duel.json'), 'utf8')));
  assert(a.section === 'campaign' && a.expect === 'player', `${a.section}/${a.expect}`);
  assert(a.player.pieceRows === 1, 'pieceRows should default to 1');
});

console.log('\n--- shapes that must THROW (engine- or code-fatal) ---');
check('13 files — one past the FSF largeboard ceiling', () => {
  const m = throws({ files: 13 });
  assert(/catalog range/.test(m), m);
});
check('11 ranks — one past the ceiling', () => {
  const m = throws({ ranks: 11 });
  assert(/catalog range/.test(m), m);
});
check('enemy with two kings', () => throws({ enemy: { backRank: ['K', 'K'], backRankStart: 0, pawns: [] } }));
check('enemy with no king', () => throws({ enemy: { backRank: ['R', 'R'], backRankStart: 0, pawns: [] } }));
check('walled enemy king slot', () => {
  const m = throws({ walls: ['d8'], enemy: { backRank: ['R', 'K'], backRankStart: 2, pawns: [] } });
  assert(/walled/.test(m), m);
});
check('overlapping formations (deeper than the board)', () => {
  const m = throws({
    ranks: 4,
    player: { pieceSet: ['R'], pieceRows: 2, backRankStart: 0, patchWidth: 2, pawns: ['a'] },
    enemy: { rows: [['R', 'K'], ['N', null]], backRankStart: 0, pawns: ['a'] },
  });
  assert(/overlap/.test(m), m);
});
check('player with no non-king material', () => {
  const m = throws({ player: { pieceSet: [], backRankStart: 0, patchWidth: 3, pawns: [] } });
  assert(/no non-king material/.test(m), m);
});
check('player.rows contradicting player.pieceSet', () => {
  const m = throws({
    player: { rows: [['R', 'K', 'N']], pieceSet: ['Q', 'Q'], backRankStart: 1, patchWidth: 3, pawns: ['b'] },
  });
  assert(/does not match/.test(m), m);
});
check('bad expect value', () => throws({ expect: 'nobody' }));

console.log('\n--- formation geometry ---');
check('N x 3 army = 2 piece rows + 1 pawn row', () => {
  const a = loads({
    files: 8,
    ranks: 8,
    player: { rows: [['R', 'K', 'R'], ['N', 'Q', 'N']], pieceRows: 2, backRankStart: 1, patchWidth: 3, pawns: ['b', 'c', 'd'] },
  });
  const { startFen } = buildStartFen(a, defaultPlacement(a));
  const rows = startFen.split(' ')[0].split('/');
  // rows[] is rank-descending: rank 3 = pawns, rank 2 = second piece row, rank 1 = back.
  assert(/N.?Q.?N/.test(rows[6]) || rows[6].includes('NQN'), `second piece row wrong: ${rows[6]}`);
  assert(rows[7].includes('RKR'), `back rank wrong: ${rows[7]}`);
  assert(rows[5].includes('PPP'), `pawn row wrong: ${rows[5]}`);
  // 2 rows x 3 slots = 6, minus the king = 5 derived pieces.
  assert(a.player.pieceSet.length === 5, `derived pool should be 5 pieces, got ${a.player.pieceSet}`);
  return startFen;
});
check('8 x 2 classic army stamps the real chess position', () => {
  const a = loadArena(JSON.parse(fs.readFileSync(path.join(ARENA_DIR, 'test14-classic.json'), 'utf8')));
  const { startFen } = buildStartFen(a, defaultPlacement(a));
  assert(
    startFen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w - - 0 1',
    `not the standard position: ${startFen}`
  );
  assert(playerPool(a).length === 16, `pool should be 16, got ${playerPool(a).length}`);
  return startFen;
});
check('authored player.rows beats the value-sorted default', () => {
  const withRows = loads({ player: { rows: [['N', 'K', 'R']], backRankStart: 1, patchWidth: 3, pawns: ['b'] } });
  const placed = defaultPlacement(withRows);
  assert(placed.b1 === 'N' && placed.c1 === 'K' && placed.d1 === 'R', JSON.stringify(placed));
});

console.log('\n--- catalog ---');
check('catalog spans files 2-12 x ranks 2-10', () => {
  assert(catalogSize() === 99, `expected 99, got ${catalogSize()}`);
});
check('makeDuelVariantIni still guards the FSF ceiling', () => {
  for (const [f, r] of [[13, 10], [12, 11]]) {
    let threw = false;
    try {
      makeDuelVariantIni({ name: 'x', files: f, ranks: r });
    } catch {
      threw = true;
    }
    assert(threw, `${f}x${r} should be rejected — loadVariantConfig accepts it silently and Board construction then crashes the heap`);
  }
});

console.log('\n--- every shipped arena ---');
for (const f of fs.readdirSync(ARENA_DIR).filter((x) => x.endsWith('.json')).sort()) {
  check(f, () => {
    const a = loadArena(JSON.parse(fs.readFileSync(path.join(ARENA_DIR, f), 'utf8')));
    const { startFen } = buildStartFen(a, defaultPlacement(a));
    assert(startFen.split(' ')[0].split('/').length === a.ranks, 'FEN rank count mismatch');
    const board = startFen.split(' ')[0];
    assert((board.match(/K/g) || []).length === 1, 'exactly one white king expected');
    assert((board.match(/k/g) || []).length === 1, 'exactly one black king expected');
    return `${a.files}x${a.ranks} ${a.section}/${a.expect}${a.warnings.length ? ` (${a.warnings.length} warn)` : ''}`;
  });
}

console.log(`\n${fail === 0 ? 'ALL PASS' : `${fail} FAILURES`} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
