// THE PORTAL GATE, ffish half (engine/patches/portals.patch): the portal move
// type, the scroll cast, the trailing FEN field, the strip rule and the
// check-flag consistency, all through the JS API the game uses.
//   FFISH_JS=/path/to/patched/ffish.js node engine/tests/test-portals-ffish.cjs
// Hand-verified counts are the same fixtures the native gate ran
// (scratch: forge/native-test.py); the consistency sweep compares the SAN
// check suffix (gives_check) against push + isCheck on every legal move.
const FFISH_JS = process.env.FFISH_JS; if (!FFISH_JS) { console.error('set FFISH_JS=/path/to/patched/ffish.js'); process.exit(2); }
const realFetch = global.fetch; delete global.fetch;
const Module = require(FFISH_JS);
Module.onRuntimeInitialized = () => { global.fetch = realFetch; run(Module); };

const INI = `[portal8:chess]
castling = false
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
immobile = o
portalScroll = o
pieceDrops = true
dropRegionWhite = *2 *3 *4 *5 *6 *7
dropRegionBlack = *2 *3 *4 *5 *6 *7
pieceValueMg = o:0
pieceValueEg = o:0
`;

function run(ffish) {
  let pass = 0, fail = 0;
  const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
  ffish.loadVariantConfig(INI);
  const V = 'portal8';
  const moves = (b) => b.legalMoves().split(' ').filter(Boolean).sort();

  // F1 quiet teleport
  let fen = 'r3k3/3p4/8/8/8/8/3P4/2R1K3 w - - 0 1 {c3-f6}';
  ok('validateFen accepts the portal field', ffish.validateFen(fen, V) === 1, String(ffish.validateFen(fen, V)));
  let b = new ffish.Board(V, fen);
  ok('FEN round-trips with the portal field', b.fen() === 'r3k3/3p4/8/8/8/8/3P4/2R1K3[] w - - 0 1 {c3-f6}', b.fen());
  let m = moves(b);
  ok('F1: 16 legal moves incl. c1c3', m.length === 16 && m.includes('c1c3'), m.join(','));
  ok("F1: SAN of the teleport is 'Rc3'", b.sanMove('c1c3') === 'Rc3', b.sanMove('c1c3'));
  b.push('c1c3');
  ok('F1: the rook stands on f6, c3 empty', b.fen().startsWith('r3k3/3p4/5R2/8/8/8/3P4/4K3[]'), b.fen());
  b.pop();
  ok('F1: pop restores the rook on c1', b.fen() === 'r3k3/3p4/8/8/8/8/3P4/2R1K3[] w - - 0 1 {c3-f6}', b.fen());

  // F2 capture through a portal, the far occupant swapped back
  fen = '4k3/3p4/5b2/8/8/2n5/3P4/2R1K3 w - - 0 1 {c3-f6}';
  b = new ffish.Board(V, fen); m = moves(b);
  ok('F2: 9 legal moves, c1c3 offered, c1c4 not', m.length === 9 && m.includes('c1c3') && !m.includes('c1c4'), m.join(','));
  ok("F2: SAN is a capture 'Rxc3'", b.sanMove('c1c3') === 'Rxc3', b.sanMove('c1c3'));
  b.push('c1c3');
  ok('F2: knight gone, rook on f6, bishop swapped to c3', b.fen().startsWith('4k3/3p4/5R2/8/8/2b5/3P4/4K3[]'), b.fen());
  b.pop();
  ok('F2: pop restores all three squares', b.fen().startsWith('4k3/3p4/5b2/8/8/2n5/3P4/2R1K3[]'), b.fen());

  // F3 a king may not teleport onto an attacked exit
  b = new ffish.Board(V, '4k3/p6r/8/8/8/8/1P1K4/R7 w - - 0 1 {d3-g7}'); m = moves(b);
  ok('F3: 22 moves, d2d3 refused (g7 attacked)', m.length === 22 && !m.includes('d2d3'), m.join(','));
  b = new ffish.Board(V, '4k2r/p7/8/8/8/8/1P1K4/R7 w - - 0 1 {d3-g7}'); m = moves(b);
  ok('F3b: 23 moves, d2d3 offered', m.length === 23 && m.includes('d2d3'), m.join(','));
  b.push('d2d3');
  ok('F3b: the king stands on g7', b.fen().startsWith('4k2r/p5K1/8/8/8/8/1P6/R7[]'), b.fen());

  // F4 teleport onto the enemy king: he is swapped next to a pawn, in check
  b = new ffish.Board(V, 'r7/3p4/4k3/8/8/8/3P4/2R1K3 w - - 0 1 {c3-e6}'); m = moves(b);
  ok('F4: 16 moves incl. c1c3', m.length === 16 && m.includes('c1c3'), m.join(','));
  ok("F4: SAN carries the check 'Rc3+'", b.sanMove('c1c3') === 'Rc3+', b.sanMove('c1c3'));
  b.push('c1c3');
  ok('F4: black is in check on c3', b.isCheck() && b.fen().startsWith('r7/3p4/4R3/8/8/2k5/3P4/4K3[]'), b.fen());
  m = moves(b);
  ok('F4: 8 evasions incl. d7e6 (the pawn swaps the king out through the portal)', m.length === 8 && m.includes('d7e6'), m.join(','));
  b.push('d7e6');
  ok('F4: after d7e6 the king is back on e6, the pawn on c3, the rook gone', b.fen().startsWith('r7/8/4k3/8/8/2p5/3P4/4K3[]'), b.fen());

  // F5 twin to twin: capture at range, and the quiet pass
  b = new ffish.Board(V, '4k3/3p4/5n2/8/8/2B5/3P4/4K3 w - - 0 1 {c3-f6}'); m = moves(b);
  ok('F5: 13 moves incl. c3f6', m.length === 13 && m.includes('c3f6'), m.join(','));
  b.push('c3f6');
  ok('F5: the knight is gone and the bishop is back on c3', b.fen().startsWith('4k3/3p4/8/8/8/2B5/3P4/4K3[] b'), b.fen());
  b = new ffish.Board(V, '4k3/3p4/8/8/8/2B5/3P4/4K3 w - - 0 1 {c3-f6}'); m = moves(b);
  ok('F5b: 15 moves incl. c3f6 and c3g7', m.length === 15 && m.includes('c3f6') && m.includes('c3g7'), m.join(','));
  b.push('c3f6');
  ok('F5b: the quiet twin-to-twin move changes nothing but the turn', b.fen().startsWith('4k3/3p4/8/8/8/2B5/3P4/4K3[] b'), b.fen());

  // F8 a pawn through a portal
  b = new ffish.Board(V, '4k3/3p4/4P3/8/8/8/3P4/4K3 w - - 0 1 {b3-e7}'); m = moves(b);
  ok('F8: 8 moves incl. e6e7', m.length === 8 && m.includes('e6e7'), m.join(','));
  b.push('e6e7');
  ok('F8: the pawn lands on b3', b.fen().startsWith('4k3/3p4/8/8/8/1P6/3P4/4K3[]'), b.fen());

  // F9 no cast while in check
  b = new ffish.Board(V, '4k3/3p4/8/8/8/8/3P4/r3K3[OOoo] w - - 0 1'); m = moves(b);
  ok('F9: 2 evasions, no cast', m.length === 2 && !m.some((x) => x.includes('@')), m.join(','));

  // F7 the casts: open, the enemy opens, close, the enemy closes
  const fen7 = '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1';
  b = new ffish.Board(V, fen7); m = moves(b);
  const casts = m.filter((x) => x.startsWith('O@'));
  ok('F7: 52 moves = 6 normal + 46 casts', m.length === 52 && casts.length === 46, `${m.length} ${casts.length}`);
  ok('F7: no cast on rank 1 or 8', !casts.some((x) => /[18]$/.test(x)), casts.filter((x) => /[18]$/.test(x)).join(','));
  ok("F7: cast SAN is 'O@c3'", b.sanMove('O@c3') === 'O@c3', b.sanMove('O@c3'));
  b.push('O@c3');
  ok('F7: white half open', b.fen() === '4k3/3p4/8/8/8/8/3P4/4K3[Ooo] b - - 0 1 {c3w}', b.fen());
  b.push('O@f6');
  ok('F7: black half open', b.fen() === '4k3/3p4/8/8/8/8/3P4/4K3[Oo] w - - 0 2 {c3w,f6b}', b.fen());
  b.push('O@e5');
  ok('F7: white pair closed', b.fen() === '4k3/3p4/8/8/8/8/3P4/4K3[o] b - - 0 2 {c3-e5,f6b}', b.fen());
  m = moves(b);
  const bc = m.filter((x) => x.startsWith('O@'));
  ok('F7: black cannot cast on c3, e5 or f6', !bc.some((x) => ['c3', 'e5', 'f6'].includes(x.slice(2))));
  ok('F7: black has 43 casts left to choose from', bc.length === 43, String(bc.length));
  b.push('O@a4');
  ok('F7: both pairs closed, hands empty', b.fen() === '4k3/3p4/8/8/8/8/3P4/4K3[] w - - 0 3 {c3-e5,a4-f6}', b.fen());
  b.pop(); b.pop(); b.pop(); b.pop();
  ok('F7: four pops restore the start', b.fen() === '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1', b.fen());
  ok('validateFen rejects a portal on a king row', ffish.validateFen('4k3/3p4/8/8/8/8/3P4/4K3[] w - - 0 1 {a1-c4}', V) < 0);
  ok('validateFen rejects a square used twice', ffish.validateFen('4k3/3p4/8/8/8/8/3P4/4K3[] w - - 0 1 {c3-c4,c4-d5}', V) < 0);

  // The strip rule: scrolls, halves and pairs are never pieces
  const strip = (f, label) => {
    const sb = new ffish.Board(V, f);
    ok(`strip: ${label} is decided at load (game over, side to move lost)`, sb.isGameOver() && sb.result() !== '*', `${sb.isGameOver()} ${sb.result()}`);
  };
  strip('4k3/3p4/8/8/8/8/8/4K3[OOoo] w - - 0 1', 'king + scrolls in hand');
  strip('4k3/3p4/8/8/8/8/8/4K3[] w - - 0 1 {e4w}', 'king + an open half');
  strip('4k3/3p4/8/8/8/8/8/4K3[] w - - 0 1 {c3-f6}', 'king + a pair');
  ok('strip: king + a pawn + scrolls is NOT bare', !new ffish.Board(V, '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1').isGameOver());

  // Consistency sweep: the SAN check suffix (gives_check) against push + isCheck,
  // on every legal move of every fixture position and one ply deeper.
  const fixtures = [
    'r3k3/3p4/8/8/8/8/3P4/2R1K3 w - - 0 1 {c3-f6}',
    '4k3/3p4/5b2/8/8/2n5/3P4/2R1K3 w - - 0 1 {c3-f6}',
    '4k2r/p7/8/8/8/8/1P1K4/R7 w - - 0 1 {d3-g7}',
    'r7/3p4/4k3/8/8/8/3P4/2R1K3 w - - 0 1 {c3-e6}',
    '4k3/3p4/5n2/8/8/2B5/3P4/4K3 w - - 0 1 {c3-f6}',
    '4k3/3p4/4P3/8/8/8/3P4/4K3 w - - 0 1 {b3-e7}',
    'r2qk2r/pp1bppb1/2np1np1/8/3P4/2N2N2/PPQ1PPPP/R3KB1R w - - 0 1 {c4-f5,d5-g6}',
    '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1 {c3-f6}',
  ];
  let checked = 0, bad = 0;
  const sweep = (board, depth) => {
    for (const mv of moves(board)) {
      const san = board.sanMove(mv);
      const saysCheck = /[+#]$/.test(san);
      board.push(mv);
      const isCheck = board.isCheck();
      if (saysCheck !== isCheck) { bad++; if (bad < 6) console.log('   mismatch', board.fen(), mv, san, isCheck); }
      checked++;
      if (depth > 1 && !board.isGameOver()) sweep(board, depth - 1);
      board.pop();
    }
  };
  for (const f of fixtures) sweep(new ffish.Board(V, f), 2);
  ok(`check-flag sweep: ${checked} moves, SAN check suffix == push+isCheck`, bad === 0, `${bad} mismatches`);

  console.log(`\nportals/ffish: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
