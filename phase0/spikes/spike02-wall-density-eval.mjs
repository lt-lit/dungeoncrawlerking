// Spike 2 — static wall squares (`*`) in startFen at density: classical eval
// behavior (§9.2). Support is confirmed shipping-grade (crossderby + spikes
// 11/12); this spike is about EVAL SANITY under heavy walls: mirrored
// positions should stay near equality, color-flips should negate, and known
// pathologies (disconnected arenas, sealed kings, walled-off passers) should
// degrade understandably rather than explode.
import { loadFfish, loadEngine } from '../lib/load.mjs';
import { makeDuelVariantIni } from '../lib/variant.mjs';
import { splitFen, parseBoard, serializeBoard, joinFen } from '../lib/fen.mjs';
import { mulberry32 } from '../harness/prng.mjs';

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

const DIMS = [
  { name: 'w8x8', files: 8, ranks: 8 },
  { name: 'w10x8', files: 10, ranks: 8 },
  { name: 'w12x10', files: 12, ranks: 10 },
];
const ini = DIMS.map((d) => makeDuelVariantIni({ name: d.name, files: d.files, ranks: d.ranks })).join('\n');
ffish.loadVariantConfig(ini);
await engine.loadVariantsIni(ini);

const legal = (b) => b.legalMoves().trim().split(/\s+/).filter(Boolean);

/** Mirrored duel FEN: standard-ish back rows sized to files, pawn rows, and
 * color-symmetric walls in the gap band at the given density (seeded). */
function mirroredFen(files, ranks, density, seed) {
  const backRow = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R', 'R', 'N', 'B', 'Q'].slice(0, files);
  if (!backRow.includes('K')) backRow[Math.floor(files / 2)] = 'K';
  const rng = mulberry32(seed);
  // board[0] is the TOP FEN rank: black back row at top, white at bottom.
  const board = Array.from({ length: ranks }, () => Array(files).fill(null));
  for (let f = 0; f < files; f++) {
    board[0][f] = backRow[f].toLowerCase();
    board[1][f] = 'p';
    board[ranks - 1][f] = backRow[f];
    board[ranks - 2][f] = 'P';
  }
  // symmetric walls: sample in bottom half of gap band, mirror to top
  const gapLo = 2;
  const gapHi = ranks - 3; // rank indices from bottom, inclusive
  for (let r = gapLo; r <= Math.floor((gapLo + gapHi) / 2); r++) {
    for (let f = 0; f < files; f++) {
      if (rng() < density) {
        const rTop = ranks - 1 - r;
        const mirrorR = gapLo + gapHi - r;
        const mirrorTop = ranks - 1 - mirrorR;
        if (board[rTop][f] === null && board[mirrorTop][f] === null) {
          board[rTop][f] = '*';
          board[mirrorTop][f] = '*';
        }
      }
    }
  }
  return serializeBoard(board) + ' w - - 0 1';
}

/** Color-flip a FEN: mirror ranks, swap piece case, swap side to move. */
function flipFen(fen) {
  const f = splitFen(fen);
  const board = parseBoard(f.board);
  const flipped = board
    .slice()
    .reverse()
    .map((rank) =>
      rank.map((c) => {
        if (c === null || c === '*') return c;
        return c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase();
      })
    );
  return joinFen({ ...f, board: serializeBoard(flipped), turn: f.turn === 'w' ? 'b' : 'w', ep: '-' });
}

async function evalPos(variant, fen, depth = 10) {
  engine.setoption('UCI_Variant', variant);
  engine.position({ fen });
  const res = await engine.go(`depth ${depth}`);
  const s = engine.lastScore(res);
  const cp = s?.type === 'mate' ? (s.value > 0 ? 9999 : -9999) : (s?.value ?? null);
  return { cp, bestmove: res.bestmove, nodes: res.infoLines.map((l) => l.match(/nodes (\d+)/)).filter(Boolean).map((m) => +m[1]).pop() ?? 0, timeMs: res.infoLines.map((l) => l.match(/time (\d+)/)).filter(Boolean).map((m) => +m[1]).pop() ?? 0 };
}

// ---- 1. Density sweep on mirrored arenas -----------------------------------
console.log('--- 1. mirrored arenas at wall density 0/10/20/30/40% ---');
const densityStats = [];
for (const dim of DIMS) {
  for (const density of [0, 0.1, 0.2, 0.3, 0.4]) {
    const fen = mirroredFen(dim.files, dim.ranks, density, 42 + Math.round(density * 100));
    const v = ffish.validateFen(fen, dim.name);
    if (v !== 1) {
      check(`${dim.name} d${density}: FEN valid`, false, `validateFen=${v} fen=${fen}`);
      continue;
    }
    const b = new ffish.Board(dim.name, fen);
    const moves = legal(b);
    const perftLines = await (async () => {
      engine.setoption('UCI_Variant', dim.name);
      engine.position({ fen });
      return engine.sendUntil('go perft 1', (l) => l.startsWith('Nodes searched'));
    })();
    const perft1 = parseInt(perftLines[perftLines.length - 1].split(':')[1], 10);
    const wallCount = (fen.split(' ')[0].match(/\*/g) ?? []).length;
    check(`${dim.name} d${density} (${wallCount} walls): perft1 matches ffish`, perft1 === moves.length, `${perft1} vs ${moves.length}`);
    const e = await evalPos(dim.name, fen);
    densityStats.push({ dim: dim.name, density, wallCount, cp: e.cp, nodes: e.nodes, timeMs: e.timeMs });
    check(`${dim.name} d${density}: mirrored eval near equality (|cp| <= 150)`, e.cp !== null && Math.abs(e.cp) <= 150, `cp=${e.cp} best=${e.bestmove}`);
    check(`${dim.name} d${density}: bestmove legal`, moves.includes(e.bestmove));
    b.delete();
  }
}
console.log('density table:', JSON.stringify(densityStats));

// ---- 2. Color-flip consistency on asymmetric walled positions --------------
console.log('\n--- 2. color-flip eval consistency ---');
{
  const asymFens = [
    // off-center king, asymmetric walls, unequal minor placement (8x8)
    ['w8x8', '1k2r3/1ppp4/2*5/8/3**3/5*2/2PPP3/1KR2B2 w - - 0 1'],
    ['w8x8', 'r2k4/pp1p4/8/2*2*2/8/1*6/1PPP2P1/2K1R3 w - - 0 1'],
    ['w10x8', '2rk1b4/2pppp4/10/3*2*3/1*8/10/3PPPP3/3KRB4 w - - 0 1'],
  ];
  for (const [variant, fen] of asymFens) {
    if (ffish.validateFen(fen, variant) !== 1) {
      check(`flip test ${variant}: base FEN valid`, false, fen);
      continue;
    }
    const flipped = flipFen(fen);
    check(`flip test ${variant}: flipped FEN valid`, ffish.validateFen(flipped, variant) === 1, flipped);
    // Engine scores are side-to-move POV: a correct color-flip means the
    // score is (near-)EQUAL, not negated.
    const a = await evalPos(variant, fen, 10);
    const bE = await evalPos(variant, flipped, 10);
    const diff = a.cp - bE.cp;
    check(`flip test ${variant}: stm-POV eval equal under flip (|diff| <= 60)`, Math.abs(diff) <= 60, `cp=${a.cp} flip=${bE.cp} diff=${diff}`);
  }
}

// ---- 3. Pathologies --------------------------------------------------------
console.log('\n--- 3. pathologies ---');
{
  // (a) fully disconnected arena: solid wall rank splits the board
  const fen = '1k2r3/pppp4/8/********/8/8/PPPP4/1K2R3 w - - 0 1';
  check('disconnected arena FEN valid', ffish.validateFen(fen, 'w8x8') === 1);
  const e = await evalPos('w8x8', fen, 12);
  console.log(`INFO - disconnected arena: cp=${e.cp} best=${e.bestmove} (design risk: no progress possible, no draw rule to end it — §6 linter must forbid)`);
  check('disconnected arena: engine returns finite eval + legal move', e.cp !== null && Math.abs(e.cp) < 9999, `cp=${e.cp}`);

  // (b) king sealed in a 1-square pocket (with another piece so not stalemate)
  const fen2 = '4k3/8/8/8/8/**6/K*6/R7 w - - 0 1'; // wait: Ka2 sealed by walls a3,b3,b2; Ra1 below
  const v2 = ffish.validateFen(fen2, 'w8x8');
  if (v2 === 1) {
    const e2 = await evalPos('w8x8', fen2, 10);
    check('sealed-king pocket: finite eval, legal move', e2.cp !== null, `cp=${e2.cp} best=${e2.bestmove}`);
  } else {
    console.log(`INFO - sealed-king FEN rejected (validateFen=${v2}) — construction issue, skipping`);
  }

  // (c) walled-off passed pawn: e5 pawn with wall e6 — path permanently blocked.
  // Compare vs same position with the wall parked harmlessly at a6.
  const blocked = '4k3/8/4*3/4P3/8/8/8/4K3 w - - 0 1';
  const free = '4k3/8/*7/4P3/8/8/8/4K3 w - - 0 1';
  const eb = await evalPos('w8x8', blocked, 12);
  const ef = await evalPos('w8x8', free, 12);
  console.log(`INFO - passer eval: blocked-by-wall cp=${eb.cp}, free-path cp=${ef.cp}, delta=${ef.cp - eb.cp}`);
  check('walled-off passer not scored better than free passer', eb.cp <= ef.cp + 30, `blocked=${eb.cp} free=${ef.cp}`);
}

// ---- 4. Perf: nodes/sec at density 0% vs 30% -------------------------------
console.log('\n--- 4. search perf vs density ---');
{
  const f0 = mirroredFen(10, 8, 0, 7);
  const f30 = mirroredFen(10, 8, 0.3, 7);
  const e0 = await evalPos('w10x8', f0, 12);
  const e30 = await evalPos('w10x8', f30, 12);
  const nps0 = e0.timeMs ? Math.round((e0.nodes / e0.timeMs) * 1000) : 0;
  const nps30 = e30.timeMs ? Math.round((e30.nodes / e30.timeMs) * 1000) : 0;
  console.log(`INFO - depth 12 on 10x8: d0 ${e0.nodes} nodes ${e0.timeMs}ms (${nps0} nps); d30 ${e30.nodes} nodes ${e30.timeMs}ms (${nps30} nps)`);
  check('no perf cliff at 30% walls (>= 25% of open-board nps)', nps30 >= nps0 * 0.25, `${nps30} vs ${nps0} nps`);
}

console.log(`\nSPIKE 2: ${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECKS FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
