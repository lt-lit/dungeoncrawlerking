// THE SLEDGEHAMMER GATE, ffish half (engine/patches/wall-kinds.patch +
// hammer.patch): the hard wall '#', the HAMMER move type, its SAN, push /
// pop, the check-flag consistency — through the JS API the game uses.
//   FFISH_JS=/path/to/patched/ffish.js node engine/tests/test-hammer-ffish.cjs
// The counts are the hand-verified fixtures of the native debug gate
// (scratch: forge/native-test.py, 2026-09-17).
const FFISH_JS = process.env.FFISH_JS; if (!FFISH_JS) { console.error('set FFISH_JS=/path/to/patched/ffish.js'); process.exit(2); }
const realFetch = global.fetch; delete global.fetch;
const Module = require(FFISH_JS);
Module.onRuntimeInitialized = () => { global.fetch = realFetch; run(Module); };

const BASE = `castling = false
stalemateValue = loss
nMoveRule = 0
nFoldRule = 0
nFoldValue = loss
extinctionValue = loss
extinctionPieceTypes = *
extinctionPieceCount = 1
extinctionPseudoRoyal = false
promotionRegionWhite = *8
promotionRegionBlack = *1
doubleStepRegionWhite = *2 *3 *4 *5 *6 *7
doubleStepRegionBlack = *7 *6 *5 *4 *3 *2
`;
const INI = `[plain8:chess]\n${BASE}\n[hammer8:chess]\n${BASE}hammerPieceTypes = k\n\n[hammer8kr:hammer8]\nhammerPieceTypes = kr\n\n[hammer8w:hammer8]\nhammerPieceTypesWhite = k\nhammerPieceTypesBlack = -\n`;

function run(ffish) {
  let pass = 0, fail = 0;
  const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
  ffish.loadVariantConfig(INI);
  const moves = (b) => b.legalMoves().split(' ').filter(Boolean).sort();

  // H1: a king beside a breakable wall (f2) and a hard one (f1)
  const H1 = '4k3/3p4/8/8/8/8/3P1*2/4K#2 w - - 0 1';
  ok('validateFen accepts # (hammer8)', ffish.validateFen(H1, 'hammer8') === 1, String(ffish.validateFen(H1, 'hammer8')));
  ok('validateFen accepts # (plain8)', ffish.validateFen(H1, 'plain8') === 1);
  let b = new ffish.Board('hammer8', H1);
  ok('H1: the FEN round-trips with # and *', b.fen() === H1, b.fen());
  let m = moves(b);
  ok('H1: 5 legal moves incl. the hammer e1f2, none onto the hard f1', m.length === 5 && m.includes('e1f2') && !m.includes('e1f1'), m.join(','));
  ok("H1: SAN of the hammer is 'K*f2'", b.sanMove('e1f2') === 'K*f2', b.sanMove('e1f2'));
  b.push('e1f2');
  ok('H1: after the hammer f2 is a crate, the king still on e1, rule50 reset', b.fen() === '4k3/3p4/8/8/8/8/3P1^2/4K#2 b - - 0 1', b.fen());
  ok('H1: the hammer gives no check', !b.isCheck());
  m = moves(b);
  ok('H1: black has 6 moves and no hammer (no wall beside e8)', m.length === 6, m.join(','));
  b.push('e8d8');
  m = moves(b);
  ok('H1: white now captures the crate (e1f2 a capture), 5 moves, no hammer left', m.length === 5 && m.includes('e1f2') && b.sanMove('e1f2') === 'Kxf2', m.join(',') + ' ' + b.sanMove('e1f2'));
  b.push('e1f2');
  ok('H1: the crate is gone, the king on f2, f1 still hard', b.fen().startsWith('3k4/3p4/8/8/8/8/3P1K2/5#2 b'), b.fen());
  b.pop(); b.pop(); b.pop();
  ok('H1: three pops restore the wall', b.fen() === H1, b.fen());
  b.delete();

  // H2: in check the hammer is not offered
  b = new ffish.Board('hammer8', '4k3/8/8/8/8/8/3P1*2/r3K3 w - - 0 1'); m = moves(b);
  ok('H2: in check only Ke2 is legal — no hammer', m.length === 1 && m[0] === 'e1e2', m.join(','));
  b.delete();

  // H3: a pinned rook may hammer (it does not move); each hammer has its own SAN
  b = new ffish.Board('hammer8kr', '4k3/8/8/8/4r3/8/4R*2/4K3 w - - 0 1'); m = moves(b);
  ok('H3: 7 moves — Kd1 Kf1 Kd2, Re3 Rxe4, K*f2 and R*f2', m.length === 7 && m.includes('e1f2') && m.includes('e2f2') && !m.includes('e2d2'), m.join(','));
  ok("H3: SAN 'K*f2' and 'R*f2'", b.sanMove('e1f2') === 'K*f2' && b.sanMove('e2f2') === 'R*f2', b.sanMove('e1f2') + ' ' + b.sanMove('e2f2'));
  b.push('e2f2');
  ok('H3: the rook hammers, stays on e2, f2 a crate', b.fen() === '4k3/8/8/8/4r3/8/4R^2/4K3 b - - 0 1', b.fen());
  b.pop();
  b.delete();

  // H4/H5: without the key there is no hammer; a # board is the same board as its * twin
  b = new ffish.Board('plain8', H1); m = moves(b);
  ok('H4: plain8 — 4 moves, no hammer', m.length === 4 && !m.includes('e1f2'), m.join(','));
  b.delete();
  const twinS = new ffish.Board('plain8', '4k3/3p4/8/8/8/8/3P1*2/4K*2 w - - 0 1');
  const twinH = new ffish.Board('plain8', '4k3/3p4/8/8/8/8/3P1#2/4K#2 w - - 0 1');
  ok('H5: plain8 — a * board and its # twin list the same moves', twinS.legalMoves() === twinH.legalMoves(), twinH.legalMoves());
  ok('H5: the # twin round-trips as #', twinH.fen() === '4k3/3p4/8/8/8/8/3P1#2/4K#2 w - - 0 1', twinH.fen());
  twinS.delete(); twinH.delete();
  const allHard = new ffish.Board('hammer8', '4k3/3p4/8/8/8/8/3P1#2/4K#2 w - - 0 1');
  ok('H5: hammer8 on an all-# board offers no hammer', moves(allHard).length === 4, moves(allHard).join(','));
  allHard.delete();

  // H6: per-colour keys
  b = new ffish.Board('hammer8w', '3*k3/3p4/8/8/8/8/3P4/4K*2 w - - 0 1');
  ok('H6: white (a hammer king) has e1f1', moves(b).includes('e1f1'), moves(b).join(','));
  b.push('e1e2');
  ok('H6: black (no hammer) has no e8d8', !moves(b).includes('e8d8'), moves(b).join(','));
  b.delete();
  b = new ffish.Board('hammer8', '3*k3/3p4/8/8/8/8/3P4/4K*2 w - - 0 1'); b.push('e1e2');
  ok('H6: under hammer8 black hammers d8', moves(b).includes('e8d8') && b.sanMove('e8d8') === 'K*d8', moves(b).join(',') + ' ' + b.sanMove('e8d8'));
  b.delete();

  // perft through the JS API: the native debug gate's counts (push/pop over every legal move)
  const perft = (bb, n) => { if (!n) return 1; let t = 0; for (const mv of moves(bb)) { bb.push(mv); t += perft(bb, n - 1); bb.pop(); } return t; };
  for (const [v, f, want] of [['hammer8', H1, [5, 30, 182, 1338]], ['hammer8kr', '4k3/8/8/8/4r3/8/4R*2/4K3 w - - 0 1', [7, 59, 508, 6521]], ['hammer8', '4k3/3p4/8/8/8/8/*PP5/*K#5 w - - 0 1', [6, 36, 241, 1853]]]) {
    const bb = new ffish.Board(v, f);
    const got = [1, 2, 3, 4].map((n) => perft(bb, n));
    ok(`perft 1-4 on ${f.split(' ')[0]} (${v}) = ${want.join(',')}`, JSON.stringify(got) === JSON.stringify(want), got.join(','));
    bb.delete();
  }

  // The strip rule is untouched: a king beside walls with no other piece has lost
  b = new ffish.Board('hammer8', '4k3/3p4/8/8/8/8/8/4K*2 w - - 0 1');
  ok('a bare king with a wall to hammer is still stripped (extinction)', b.isGameOver(), b.legalMoves());
  b.delete();

  // Consistency sweep: SAN's check suffix (gives_check) against push + isCheck on every legal move, one ply deep, on hammer boards
  const fixtures = [H1, '4k3/8/8/8/4r3/8/4R*2/4K3 w - - 0 1', '3*k3/3p4/8/8/8/8/3P4/4K*2 w - - 0 1', 'r*b1k2r/pppp*ppp/2n2n2/8/8/2N2N2/PPPP*PPP/R*BQK2R w - - 0 1', '4k3/3p4/8/8/8/8/*PP5/*K#5 w - - 0 1'];
  let checked = 0, mismatches = 0;
  for (const f of fixtures) for (const v of ['hammer8', 'hammer8kr']) {
    const root = new ffish.Board(v, f);
    for (const mv of moves(root)) {
      root.push(mv);
      for (const mv2 of moves(root)) {
        const san = root.sanMove(mv2);
        root.push(mv2);
        const inCheck = root.isCheck();
        root.pop();
        checked++;
        if (/[+#]$/.test(san) !== inCheck) mismatches++;
      }
      root.pop();
    }
    root.delete();
  }
  ok(`check-flag consistency sweep: ${checked} moves, ${mismatches} mismatches`, checked > 1000 && mismatches === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
