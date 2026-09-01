// Spike 7 — clipped/asymmetric formations (§9.7): off-center kings, unequal
// patch widths, non-mirrored positions — confirm nothing about eval or
// move-gen assumes symmetry. Also settles the pawn double-step question on
// non-8-rank boards (doubleStepRegionBlack defaults to literal *7).
import { loadFfish, loadEngine } from '../lib/load.mjs';
import { makeDuelVariantIni, buildDuelBoard, boardToFen } from '../lib/variant.mjs';
import { splitFen, parseBoard, serializeBoard, joinFen } from '../lib/fen.mjs';
import { mulberry32, pick, randInt } from '../harness/prng.mjs';
import { buildArena } from '../harness/legacy/arena.mjs';
import { playGame } from '../harness/legacy/game.mjs';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${detail ? `  [${detail}]` : ''}`);
  cond ? pass++ : fail++;
};

const ffish = await loadFfish();
const engine = await loadEngine();
await engine.uci();
engine.setoption('Use NNUE', 'false');

const legal = (b) => b.legalMoves().trim().split(/\s+/).filter(Boolean);
const perft1 = async (variant, fen) => {
  engine.setoption('UCI_Variant', variant);
  engine.position({ fen });
  const lines = await engine.sendUntil('go perft 1', (l) => l.startsWith('Nodes searched'));
  return parseInt(lines[lines.length - 1].split(':')[1], 10);
};

// ---- 1. Seeded batch of asymmetric setups ----------------------------------
console.log('--- 1. asymmetric setup batch ---');
const rng = mulberry32(20260813);
const iniBlocks = [];
const setups = [];
for (let i = 0; i < 10; i++) {
  const files = 6 + randInt(rng, 5); // 6..10
  const ranks = 6 + randInt(rng, 5); // 6..10
  const name = `a7_${i}`;
  iniBlocks.push(makeDuelVariantIni({ name, files, ranks }));
  // white patch: width 3-5 at random offset; black patch: independent width/offset
  const wWidth = 3 + randInt(rng, 3);
  const bWidth = 3 + randInt(rng, 3);
  const wStart = randInt(rng, Math.max(1, files - wWidth + 1));
  const bStart = randInt(rng, Math.max(1, files - bWidth + 1));
  const pool = ['Q', 'R', 'B', 'N', 'R', 'N', 'B'];
  const mkRow = (width) => {
    const row = Array(width).fill(null);
    row[randInt(rng, width)] = 'K'; // off-center kings welcome
    for (let s = 0; s < width; s++) if (row[s] === null && rng() < 0.8) row[s] = pick(rng, pool);
    return row;
  };
  // a couple of walls in the gap band, non-mirrored
  const walls = [];
  for (let w = 0; w < 1 + randInt(rng, 4); w++) {
    const f = randInt(rng, files);
    const r = 3 + randInt(rng, Math.max(1, ranks - 5));
    walls.push(String.fromCharCode(97 + f) + r);
  }
  const board = buildDuelBoard({
    files,
    ranks,
    walls: [...new Set(walls)],
    white: { backRank: mkRow(wWidth), backRankStart: wStart, row: 0 },
    black: { backRank: mkRow(bWidth), backRankStart: bStart, row: ranks - 1 },
  });
  setups.push({ name, files, ranks, fen: boardToFen(board) });
}
ffish.loadVariantConfig(iniBlocks.join('\n'));
await engine.loadVariantsIni(iniBlocks.join('\n'));

for (const s of setups) {
  const v = ffish.validateFen(s.fen, s.name);
  check(`${s.name} ${s.files}x${s.ranks}: validateFen`, v === 1, v !== 1 ? `v=${v} fen=${s.fen}` : '');
  if (v !== 1) continue;
  const b = new ffish.Board(s.name, s.fen);
  const moves = legal(b);
  const p1 = await perft1(s.name, s.fen);
  check(`${s.name}: perft1 == ffish (${p1})`, p1 === moves.length, p1 !== moves.length ? `${p1} vs ${moves.length}` : '');
  // search from both colors
  for (const turn of ['w', 'b']) {
    const f2 = joinFen({ ...splitFen(s.fen), turn });
    const b2 = new ffish.Board(s.name, f2);
    if (b2.numberLegalMoves() === 0) {
      b2.delete();
      continue;
    }
    engine.position({ fen: f2 });
    const res = await engine.go('depth 8');
    const lm = legal(b2);
    check(`${s.name} (${turn} to move): legal bestmove, finite score`,
      lm.includes(res.bestmove) && engine.lastScore(res) !== null,
      `best=${res.bestmove} score=${JSON.stringify(engine.lastScore(res))}`);
    b2.delete();
  }
  b.delete();
}

// ---- 2. Eval sanity: better side scores better; castling residue -----------
console.log('\n--- 2. eval sanity + castling residue ---');
{
  // Same geometry, white has Q+R vs black's N+B: white must be clearly better
  const ini = makeDuelVariantIni({ name: 'a7mat', files: 7, ranks: 7 });
  ffish.loadVariantConfig(ini);
  await engine.loadVariantsIni(ini);
  const strong = buildDuelBoard({
    files: 7, ranks: 7, walls: ['d4'],
    white: { backRank: ['Q', 'K', 'R'], backRankStart: 2, row: 0 },
    black: { backRank: ['n', 'k', 'b'].map((c) => c.toUpperCase()), backRankStart: 2, row: 6 },
  });
  const fen = boardToFen(strong);
  engine.setoption('UCI_Variant', 'a7mat');
  engine.position({ fen });
  const res = await engine.go('depth 10');
  const sc = engine.lastScore(res);
  check('material edge reflected in eval (Q+R vs N+B, stm white, cp > 300)',
    sc?.type === 'mate' || (sc?.type === 'cp' && sc.value > 300), `score=${JSON.stringify(sc)}`);

  // No castling moves anywhere in the batch (castling=false + '-' FENs)
  let castlingSeen = 0;
  for (const s of setups) {
    const b = new ffish.Board(s.name, s.fen);
    for (const m of legal(b)) {
      const san = b.sanMove(m);
      if (san.startsWith('O-O')) castlingSeen++;
    }
    b.delete();
  }
  check('no castling moves in any generated position', castlingSeen === 0, `seen=${castlingSeen}`);
}

// ---- 3. Pawn double-step on non-8-rank boards ------------------------------
console.log('\n--- 3. double-step semantics on generated boards ---');
{
  // Demonstrate the raw-default hazard once: FSF's literal *7 black region
  {
    const name = 'dsbroken7';
    ffish.loadVariantConfig(makeDuelVariantIni({ name, files: 5, ranks: 7, extra: { doubleStepRegionWhite: null, doubleStepRegionBlack: null } }));
    const board = buildDuelBoard({
      files: 5, ranks: 7, walls: [],
      white: { backRank: ['R', 'K', 'R'], backRankStart: 1, row: 0 },
      black: { backRank: ['r', 'k', 'r'].map((c) => c.toUpperCase()), backRankStart: 1, row: 6 },
    });
    const fen = boardToFen(board);
    const bb = new ffish.Board(name, joinFen({ ...splitFen(fen), turn: 'b' }));
    const bDouble = legal(bb).filter((m) => {
      const mm = m.match(/^([a-e])(\d+)\1(\d+)$/);
      return mm && parseInt(mm[2], 10) - parseInt(mm[3], 10) === 2;
    }).length;
    bb.delete();
    check('FSF default region on 7 ranks gives black ZERO double-steps (the hazard)', bDouble === 0, `b=${bDouble}`);
  }
  for (const ranks of [6, 7, 8, 10]) {
    const name = `ds${ranks}`;
    ffish.loadVariantConfig(makeDuelVariantIni({ name, files: 5, ranks }));
    const board = buildDuelBoard({
      files: 5, ranks, walls: [],
      white: { backRank: ['R', 'K', 'R'], backRankStart: 1, row: 0 },
      black: { backRank: ['r', 'k', 'r'].map((c) => c.toUpperCase()), backRankStart: 1, row: ranks - 1 },
    });
    const fen = boardToFen(board);
    const bw = new ffish.Board(name, fen);
    const wDouble = legal(bw).filter((m) => /^([a-e])2\1(4)$/.test(m)).length;
    bw.delete();
    const bb = new ffish.Board(name, joinFen({ ...splitFen(fen), turn: 'b' }));
    const bDouble = legal(bb).filter((m) => m.match(/^([a-e])(\d+)\1(\d+)$/)).filter((m) => {
      const mm = m.match(/^([a-e])(\d+)\1(\d+)$/);
      return parseInt(mm[2], 10) - parseInt(mm[3], 10) === 2;
    }).length;
    bb.delete();
    console.log(`INFO - ${ranks} ranks: white double-steps=${wDouble}, black double-steps=${bDouble} (explicit per-color doubleStepRegion baked into baseline)`);
    check(`${ranks} ranks: double-step symmetric with baseline regions`, wDouble === bDouble && wDouble === 3, `w=${wDouble} b=${bDouble}`);
  }
  // Fix: explicit per-color regions restore symmetry on any rank count
  for (const ranks of [6, 10]) {
    const name = `dsfix${ranks}`;
    ffish.loadVariantConfig(
      makeDuelVariantIni({ name, files: 5, ranks, extra: { doubleStepRegionWhite: '*2', doubleStepRegionBlack: `*${ranks - 1}` } })
    );
    const board = buildDuelBoard({
      files: 5, ranks, walls: [],
      white: { backRank: ['R', 'K', 'R'], backRankStart: 1, row: 0 },
      black: { backRank: ['r', 'k', 'r'].map((c) => c.toUpperCase()), backRankStart: 1, row: ranks - 1 },
    });
    const fen = boardToFen(board);
    const bw = new ffish.Board(name, fen);
    const wDouble = legal(bw).filter((m) => /^([a-e])2\1(4)$/.test(m)).length;
    bw.delete();
    const bb = new ffish.Board(name, joinFen({ ...splitFen(fen), turn: 'b' }));
    const bDouble = legal(bb).filter((m) => {
      const mm = m.match(/^([a-e])(\d+)\1(\d+)$/);
      return mm && parseInt(mm[2], 10) - parseInt(mm[3], 10) === 2;
    }).length;
    bb.delete();
    check(`${ranks} ranks with explicit doubleStepRegion override: symmetric (3 pawns)`, wDouble === bDouble && wDouble === 3, `w=${wDouble} b=${bDouble}`);
  }
}

// ---- 4. Complete self-play games from asymmetric starts (mini §7 loop) -----
console.log('\n--- 4. asymmetric self-play to termination ---');
{
  const matchups = [
    { width: 3, gap: 3, wallDensity: 0.15, white: { comp: 'mixed3', arch: 'balanced' }, black: { comp: 'minors2', arch: 'knightCore' } },
    { width: 5, gap: 2, wallDensity: 0, white: { comp: 'full4', arch: 'queenCorner' }, black: { comp: 'rooks2', arch: 'rookFlanks' } },
    { width: 4, gap: 6, wallDensity: 0.1, white: { comp: 'heavy3', arch: 'balanced' }, black: { comp: 'full4', arch: 'scrambled' } },
  ];
  const arenas = matchups.map((m, i) => buildArena(m, 555 + i));
  const iniAll = arenas.map((a) => a.ini).join('\n');
  ffish.loadVariantConfig(iniAll);
  await engine.loadVariantsIni(iniAll);
  for (const [i, arena] of arenas.entries()) {
    engine.setoption('UCI_Variant', arena.variantName);
    await engine.isready();
    const rec = await playGame({
      engine,
      ffish,
      arena,
      opts: { go: 'depth 6', maxPlies: 350, crumble: { onsetPly: 60, cadence: 10 }, seed: 555 + i, evalDeadband: 50 },
    });
    check(
      `game ${i} (${arena.variantName} ${matchups[i].white.comp} vs ${matchups[i].black.comp}): terminated decisively`,
      !rec.error && (rec.result === '1-0' || rec.result === '0-1'),
      `result=${rec.result} plies=${rec.plies} crumbles=${rec.crumbles.length} anomalies=${rec.anomalies.length} ${rec.error ?? ''}`
    );
    if (rec.plies > 200) console.log(`INFO - game ${i} ran long (${rec.plies} plies) — crumble-tuning grist`);
  }
}

console.log(`\nSPIKE 7: ${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECKS FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
