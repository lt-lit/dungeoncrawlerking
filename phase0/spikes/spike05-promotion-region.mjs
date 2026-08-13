// Spike 5 — per-color promotionRegion = enemy back rank on generated boards
// (§4.4, §9.5). Baseline config sets promotionRegionWhite=*<ranks>,
// promotionRegionBlack=*1. Verifies promotion fires exactly on the enemy back
// rank on several board sizes, enumerates default promotion targets (feeds
// the [OPEN] promotion-targets question), tests promotionPieceTypes as a
// lever, capture-promotion, walls on the back rank, and engine behavior.
import { loadFfish, loadEngine } from '../lib/load.mjs';
import { makeDuelVariantIni } from '../lib/variant.mjs';

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

const ini = [
  makeDuelVariantIni({ name: 'p8', files: 8, ranks: 8 }),
  makeDuelVariantIni({ name: 'p5x7', files: 5, ranks: 7 }),
  makeDuelVariantIni({ name: 'p12x10', files: 12, ranks: 10 }),
  makeDuelVariantIni({ name: 'p8n', files: 8, ranks: 8, extra: { promotionPieceTypes: 'n' } }),
].join('\n');
ffish.loadVariantConfig(ini);
await engine.loadVariantsIni(ini);

const legal = (b) => b.legalMoves().trim().split(/\s+/).filter(Boolean);
const promos = (moves, from, to) => moves.filter((m) => m.startsWith(from + to)).map((m) => m.slice(4)).sort();

// ---- 1. Promotion fires exactly on the enemy back rank ---------------------
console.log('--- 1. promotion exactly on enemy back rank ---');
{
  // 8x8: white pawn e7 promotes on e8
  const b = new ffish.Board('p8', 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1');
  const p = promos(legal(b), 'e7', 'e8');
  check('8x8 white e7->e8 promotes', p.length > 0, `targets: ${p.join(',')}`);
  b.delete();
  // one rank early: e6->e7 must NOT promote
  const b2 = new ffish.Board('p8', '4k3/8/4P3/8/8/8/8/4K3 w - - 0 1');
  const early = legal(b2).filter((m) => m.startsWith('e6e7'));
  check('8x8 white e6->e7 does NOT promote', early.length === 1 && early[0] === 'e6e7', `moves: ${early.join(',')}`);
  b2.delete();
  // black pawn e2 promotes on e1
  const b3 = new ffish.Board('p8', '4k3/8/8/8/8/8/4p3/1K6 b - - 0 1');
  const pb = promos(legal(b3), 'e2', 'e1');
  check('8x8 black e2->e1 promotes', pb.length > 0, `targets: ${pb.join(',')}`);
  b3.delete();
  // 5x7: white pawn on rank 6 promotes on rank 7 (board top), not rank 6
  const b4 = new ffish.Board('p5x7', 'k4/2P2/5/5/5/5/2K2 w - - 0 1');
  const p57 = promos(legal(b4), 'c6', 'c7');
  check('5x7 white c6->c7 (top rank) promotes', p57.length > 0, `targets: ${p57.join(',')}`);
  b4.delete();
  const b5 = new ffish.Board('p5x7', '2k2/5/2P2/5/5/5/2K2 w - - 0 1');
  const early57 = legal(b5).filter((m) => m.startsWith('c5c6'));
  check('5x7 white c5->c6 does NOT promote', early57.length === 1 && early57[0] === 'c5c6', `moves: ${early57.join(',')}`);
  b5.delete();
  // 12x10: white pawn on rank 9 promotes on rank 10
  const b6 = new ffish.Board('p12x10', 'k11/5P6/12/12/12/12/12/12/12/5K6 w - - 0 1');
  const p1210 = promos(legal(b6), 'f9', 'f10');
  check('12x10 white f9->f10 promotes', p1210.length > 0, `targets: ${p1210.join(',')}`);
  b6.delete();
}

// ---- 2. Default promotion targets + restriction lever ----------------------
console.log('\n--- 2. promotion piece targets ---');
{
  const b = new ffish.Board('p8', 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1');
  const p = promos(legal(b), 'e7', 'e8');
  check('default targets inherited from chess = n,b,r,q', p.join(',') === 'b,n,q,r', `targets: ${p.join(',')}`);
  const sans = p.map((suffix) => b.sanMove('e7e8' + suffix));
  check('promotion SAN well-formed (=Q style)', sans.every((s) => /=[NBRQ]/.test(s)), `sans: ${sans.join(' ')}`);
  b.delete();
  const bn = new ffish.Board('p8n', 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1');
  const pn = promos(legal(bn), 'e7', 'e8');
  check('promotionPieceTypes=n restricts to knight only', pn.join(',') === 'n', `targets: ${pn.join(',')}`);
  bn.delete();
}

// ---- 3. Capture-promotion + walls on the back rank -------------------------
console.log('\n--- 3. capture-promotion and walled back rank ---');
{
  // black rook on d8, white pawn e7: exd8=Q available alongside e8 push
  const b = new ffish.Board('p8', '3r1k2/4P3/8/8/8/8/8/4K3 w - - 0 1');
  const cap = promos(legal(b), 'e7', 'd8');
  check('capture-promotion into region works', cap.length === 4, `exd8 targets: ${cap.join(',')}`);
  b.delete();
  // wall directly in front of pawn on the back rank: push impossible,
  // diagonal capture-promotion still works
  const wfen = '3r*k2/4P3/8/8/8/8/8/4K3 w - - 0 1';
  check('walled back rank FEN validates', ffish.validateFen(wfen, 'p8') === 1);
  const b2 = new ffish.Board('p8', wfen);
  const moves = legal(b2);
  const push = moves.filter((m) => m.startsWith('e7e8'));
  const capw = promos(moves, 'e7', 'd8');
  check('pawn cannot push onto wall square', push.length === 0, `e7e8 moves: ${push.join(',') || 'none'}`);
  check('capture-promotion beside wall still works', capw.length === 4, `exd8 targets: ${capw.join(',')}`);
  b2.delete();
}

// ---- 4. Engine promotes in a won ending ------------------------------------
console.log('\n--- 4. engine promotion behavior ---');
{
  engine.setoption('UCI_Variant', 'p8');
  engine.position({ fen: '8/2k1P3/8/4K3/8/8/8/8 w - - 0 1' });
  const res = await engine.go('depth 12');
  const score = engine.lastScore(res);
  check('engine wins K+P vs K via promotion (mate score)', score?.type === 'mate' && score.value > 0,
    `best=${res.bestmove} score=${JSON.stringify(score)}`);
  const b = new ffish.Board('p8', '8/2k1P3/8/4K3/8/8/8/8 w - - 0 1');
  check('engine bestmove legal (promotes or shepherds)', legal(b).includes(res.bestmove), `best=${res.bestmove}`);
  b.delete();
}

console.log(`\nSPIKE 5: ${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECKS FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
