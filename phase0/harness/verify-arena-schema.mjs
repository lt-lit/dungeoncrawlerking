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
import { lockedPawns, fenGrid } from '../../play/js/director.mjs';
import { minFreePerRank } from './gen-terrain.mjs';

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

console.log('\n--- test-shelf terrain ---');
// The first pass of the shelf shipped nine scenarios with no walls at all and
// three with perfect mirror symmetry, because hand-drawn "random" terrain is
// neither. Real terrain is projected from a generated dungeon (§5.1/§6) at
// density 0.15-0.3, and locked pawns are a permanent feature of it, not a
// defect: "locked starts must stay in the test set" (§6). Pin all three.
const shelf = fs
  .readdirSync(ARENA_DIR)
  .filter((x) => x.startsWith('test') && x.endsWith('.json'))
  .sort()
  .map((f) => loadArena(JSON.parse(fs.readFileSync(path.join(ARENA_DIR, f), 'utf8'))));
const SQ = (f, r) => `${String.fromCharCode(97 + f)}${r + 1}`;
const mirrored = (arena) => {
  const set = new Set(arena.walls);
  if (!arena.walls.length) return false;
  const h = arena.walls.every((w) => set.has(SQ(arena.files - 1 - (w.charCodeAt(0) - 97), parseInt(w.slice(1), 10) - 1)));
  const v = arena.walls.every((w) => set.has(SQ(w.charCodeAt(0) - 97, arena.ranks - parseInt(w.slice(1), 10))));
  return h || v;
};
check('no test scenario has mirror-symmetric terrain', () => {
  const bad = shelf.filter(mirrored).map((a) => a.id);
  assert(!bad.length, `mirror-symmetric: ${bad.join(', ')}`);
});
check('at most one bare test scenario (test14-classic, deliberately)', () => {
  const bare = shelf.filter((a) => !a.walls.length).map((a) => a.id);
  assert(bare.length <= 1 && (bare[0] ?? 'test14-classic') === 'test14-classic', `bare: ${bare.join(', ')}`);
  return `bare: ${bare.join(', ') || 'none'}`;
});
check('shelf terrain density tracks the generated band (median 0.15-0.30)', () => {
  const out = shelf.filter((a) => a.walls.length);
  const ds = out.map((a) => a.walls.length / (a.files * a.ranks)).sort((x, y) => x - y);
  const median = ds[Math.floor(ds.length / 2)];
  assert(median >= 0.15 && median <= 0.3, `median density ${median.toFixed(3)} outside 0.15-0.3`);
  // A hard per-arena floor would be wrong: pawn-heavy armies and terrain are in
  // direct tension. Any wall ahead of a pawn locks it (§6), so on a narrow
  // board a pawn-storm scenario cannot carry band density AND keep its pawns
  // mobile — test08 sits low deliberately. Assert the aggregate, and only that
  // nothing is effectively bare.
  for (const a of out) {
    const d = a.walls.length / (a.files * a.ranks);
    assert(d >= 0.09, `${a.id} density ${d.toFixed(3)} is effectively bare`);
  }
  return `${out.length} arenas, ${ds[0].toFixed(3)}-${ds[ds.length - 1].toFixed(3)}, median ${median.toFixed(3)}`;
});
check('no king starts walled into a hole (<=2 adjacent wall squares)', () => {
  // test08 shipped a king with THREE walled neighbours on top of its own
  // pawn wall, and a LONE KNIGHT mated it in 8 plies. Count WALLS only:
  // a king boxed by its own army is normal — that is the standard chess
  // opening, where every neighbour of e1 is a friendly piece — and those
  // pieces move. Walls never do.
  const bad = [];
  const all = fs
    .readdirSync(ARENA_DIR)
    .filter((x) => x.endsWith('.json'))
    .map((f) => loadArena(JSON.parse(fs.readFileSync(path.join(ARENA_DIR, f), 'utf8'))));
  for (const a of all) {
    const { startFen } = buildStartFen(a, defaultPlacement(a));
    const g = fenGrid(startFen, a.files, a.ranks);
    for (const royal of ['K', 'k']) {
      let kf = -1;
      let kr = -1;
      for (let r = 0; r < a.ranks; r++) for (let f = 0; f < a.files; f++) if (g[r][f] === royal) { kf = f; kr = r; }
      if (kf < 0) continue;
      let walls = 0;
      for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nf = kf + df;
        const nr = kr + dr;
        if (nf < 0 || nf >= a.files || nr < 0 || nr >= a.ranks) continue;
        if (g[nr][nf] === '*') walls++;
      }
      if (walls > 2) bad.push(`${a.id} ${royal === 'K' ? 'white' : 'black'} king has ${walls} walled neighbours`);
    }
  }
  assert(!bad.length, bad.join('; '));
});
check('the shelf carries terrain-locked pawns (§6: they must stay in the set)', () => {
  let withLocks = 0;
  let total = 0;
  for (const a of shelf) {
    const { startFen } = buildStartFen(a, defaultPlacement(a));
    const n = lockedPawns(startFen, a.files, a.ranks).length;
    if (n) withLocks++;
    total += n;
  }
  assert(withLocks >= 12, `only ${withLocks} scenarios lock a pawn`);
  return `${withLocks}/${shelf.length} scenarios, ${total} locked pawns total`;
});

console.log('\n--- puzzle balance ---');
// §2.2/§13: the engine is ALWAYS full strength, so a human does not win a fair
// game. Every arena hands the player a decisive material edge, and the edge has
// to be measured as a RATIO — +5 is decisive against a 7-point army and noise
// against a 45-point one. The campaign ladder runs 1.6-2.2x; the shelf matches.
const PIECE_VALUE = { q: 9, r: 5, b: 3, n: 3, p: 1, k: 0 };
function material(arena) {
  const { startFen } = buildStartFen(arena, defaultPlacement(arena));
  let white = 0;
  let black = 0;
  for (const ch of startFen.split(' ')[0]) {
    if (/[A-Z]/.test(ch)) white += PIECE_VALUE[ch.toLowerCase()] ?? 0;
    else if (/[a-z]/.test(ch)) black += PIECE_VALUE[ch] ?? 0;
  }
  return arena.playerColor === 'white' ? { you: white, them: black } : { you: black, them: white };
}
check('every puzzle gives the player a decisive material edge (>=1.5x)', () => {
  const bad = [];
  for (const a of shelf) {
    if (a.expect !== 'player') continue; // test14-classic is a fair fixture
    const { you, them } = material(a);
    if (you < them * 1.5) bad.push(`${a.id} ${you}/${them}`);
  }
  assert(!bad.length, `too close to fair: ${bad.join(', ')}`);
  const rs = shelf.filter((a) => a.expect === 'player').map((a) => {
    const m = material(a);
    return m.you / m.them;
  });
  return `${rs.length} puzzles, ${Math.min(...rs).toFixed(2)}x-${Math.max(...rs).toFixed(2)}x`;
});
check('test14-classic is the only arena that is materially fair', () => {
  const fair = shelf.filter((a) => {
    const { you, them } = material(a);
    return you === them;
  });
  assert(fair.length === 1 && fair[0].id === 'test14-classic', `fair: ${fair.map((a) => a.id).join(', ')}`);
});
check('no 1-wide chokepoints (§5.3: crawlspaces must be scarce)', () => {
  const bad = [];
  for (const a of shelf) {
    const { startFen } = buildStartFen(a, defaultPlacement(a));
    const g = fenGrid(startFen, a.files, a.ranks);
    const floor = minFreePerRank(a.files);
    for (let r = 0; r < a.ranks; r++) {
      let free = 0;
      for (let f = 0; f < a.files; f++) if (g[r][f] !== '*') free++;
      if (free < floor) bad.push(`${a.id} rank ${r + 1} has ${free}/${a.files} free (floor ${floor})`);
      // A free square walled on both sides in its own rank is a doorway.
      for (let f = 1; f < a.files - 1; f++) {
        if (g[r][f] !== '*' && g[r][f - 1] === '*' && g[r][f + 1] === '*') {
          bad.push(`${a.id} 1-wide doorway at ${String.fromCharCode(97 + f)}${r + 1}`);
        }
      }
    }
  }
  assert(!bad.length, bad.join('; '));
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
