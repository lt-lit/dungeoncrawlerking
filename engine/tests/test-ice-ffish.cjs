// THE ICE GATE, ffish half — engine/patches/ice.patch (brief §4.9): SLIPPERY
// squares ('~e4' entries of the FEN's trailing field) and PITS ('_' on the
// board). A piece whose move ends on ice keeps sliding the way it was moving
// and stops on the first square that is not ice; a wall, a crate, the edge or a
// piece that cannot slide stops it on the square before; a piece on ice that it
// hits takes its momentum (the hitter stops, the hit piece slides on, either
// colour, kings included; a slide never captures); a pit swallows what slides
// into it; an empty portal square is a landing (out of the twin, at rest); a
// knight lands; a pawn that stops on its promotion zone promotes; a move that
// ends with your own king in a pit is illegal and a side whose king fell has
// lost. The ICE CAST 'I@sq' (one scroll per side) ices the floor of the 3x3
// around a square of the cast rows, under whatever stands there. All through
// the JS API the game uses.
//   FFISH_JS=/path/to/patched/ffish.js node engine/tests/test-ice-ffish.cjs
// Every count below was derived by the forge's independent Python oracle
// (engine/forge/oracle.py) and confirmed on the native build before the wasm
// ran it; the check-flag sweep compares the SAN check suffix (gives_check)
// against push + isCheck on every legal move of every fixture and one ply deeper.
const FFISH_JS = process.env.FFISH_JS; if (!FFISH_JS) { console.error('set FFISH_JS=/path/to/patched/ffish.js'); process.exit(2); }
const realFetch = global.fetch; delete global.fetch;
const Module = require(FFISH_JS);
Module.onRuntimeInitialized = () => { global.fetch = realFetch; run(Module); };

const INI = `[ice8:chess]
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
customPiece1 = i:
iceScroll = i
mobilityRegionWhiteCustomPiece1 = *4 *5
mobilityRegionBlackCustomPiece1 = *4 *5
pieceValueMg = o:0 i:0
pieceValueEg = o:0 i:0

[ice10:ice8]
maxRank = 10
maxFile = 10
promotionRegionWhite = *10
promotionRegionBlack = *1
doubleStepRegionWhite = *2 *3 *4 *5 *6 *7 *8 *9
doubleStepRegionBlack = *9 *8 *7 *6 *5 *4 *3 *2
dropRegionWhite = *2 *3 *4 *5 *6 *7 *8 *9
dropRegionBlack = *2 *3 *4 *5 *6 *7 *8 *9
mobilityRegionWhiteCustomPiece1 = *5 *6
mobilityRegionBlackCustomPiece1 = *5 *6
`;

function run(ffish) {
  let pass = 0, fail = 0;
  const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
  ffish.loadVariantConfig(INI);
  const V = 'ice8';
  const moves = (b) => b.legalMoves().split(' ').filter(Boolean).sort();
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const diff = (a, b) => { const A = new Set(a), B = new Set(b); return [...[...A].filter((x) => !B.has(x)).map((x) => '+' + x), ...[...B].filter((x) => !A.has(x)).map((x) => '-' + x)].join(','); };
  const board = (f) => f.split(' ')[0].split('[')[0];
  const after = (fen, mv, v = V) => { const b = new ffish.Board(v, fen); b.push(mv); const f = b.fen(); b.delete(); return f; };
  const field = (f) => (f.match(/\{[^}]*\}/) || [''])[0];

  // I1 THE SLIDE: a rider never parks on ice
  let fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}';
  ok('validateFen accepts the ice field', ffish.validateFen(fen, V) === 1, String(ffish.validateFen(fen, V)));
  ok('validateFen accepts a pit', ffish.validateFen('4k3/p7/8/8/_7/8/8/R3K3[] w - - 0 1 {~a2,~a3}', V) === 1, String(ffish.validateFen('4k3/p7/8/8/_7/8/8/R3K3[] w - - 0 1 {~a2,~a3}', V)));
  let b = new ffish.Board(V, fen);
  ok('the FEN round-trips with the ice field', b.fen() === fen, b.fen());
  let want = ['a1a2', 'a1a6', 'a1a7', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'];
  ok('I1: 11 moves — a3..a5 gone, a6 the landing', same(moves(b), want), diff(moves(b), want));
  ok("I1: SAN of the landing is 'Ra6'", b.sanMove('a1a6') === 'Ra6', b.sanMove('a1a6'));
  b.delete();

  // I2 THE SHOVE
  fen = '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}';
  b = new ffish.Board(V, fen);
  want = ['a1a2', 'a1a4', 'a1a5', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'];
  ok('I2: 11 moves — a1a4 the shove, a1a5 the capture, a1a3 folded into a1a4', same(moves(b), want), diff(moves(b), want));
  ok("I2: SAN 'Ra4' for the shove (no capture, no check)", b.sanMove('a1a4') === 'Ra4', b.sanMove('a1a4'));
  ok("I2: SAN 'Rxa5' for the capture", b.sanMove('a1a5') === 'Rxa5', b.sanMove('a1a5'));
  b.push('a1a4');
  ok('I2: a1a4 — the rook stops on a4, the knight is shoved to a6', board(b.fen()) === '4k3/p7/n7/8/R7/8/8/4K3', b.fen());
  ok('I2: the ice stays where it was', field(b.fen()) === '{~a3,~a4,~a5}', b.fen());
  b.pop();
  ok('I2: pop restores the start', b.fen() === fen, b.fen());
  ok('I2: a1a5 — the capture, then the rook slides on to a6', board(after(fen, 'a1a5')) === '4k3/p7/R7/8/8/8/8/4K3');
  b.delete();

  // I3 THE KING
  fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~e2,~e3,~e4}';
  b = new ffish.Board(V, fen);
  ok('I3: 14 moves, the king steps onto e2 and slides to e5', moves(b).length === 14 && moves(b).includes('e1e2') && board(after(fen, 'e1e2')) === '4k3/p7/8/4K3/8/8/8/R7', board(after(fen, 'e1e2')));
  b.delete();
  fen = '4k3/p7/8/4_3/8/8/8/R3K3[] w - - 0 1 {~e2,~e3,~e4}';
  b = new ffish.Board(V, fen);
  ok('I3: a pit on e5 — the king may not slide into it, e1e2 is no move, 13 moves', !moves(b).includes('e1e2') && moves(b).length === 13, moves(b).join(','));
  b.delete();
  fen = '8/p7/8/8/8/8/8/R3K1k_[] w - - 0 1 {~f1,~g1}';
  b = new ffish.Board(V, fen);
  ok('I3: the enemy king on ice with a pit behind him — Kf1 shoves him in, 13 moves', moves(b).includes('e1f1') && moves(b).length === 13, moves(b).join(','));
  b.push('e1f1');
  ok('I3: ...no black king on the board', board(b.fen()) === '8/p7/8/8/8/8/8/R4K1_', b.fen());
  ok('I3: ...black has lost: no legal moves, game over', moves(b).length === 0 && b.isGameOver(), `${moves(b).length} ${b.isGameOver()}`);
  b.pop();
  ok('I3: pop brings the king back', b.fen() === fen, b.fen());
  b.delete();

  // I4 THE CHAIN
  fen = '4k3/p7/8/8/8/8/8/RnnnK3[] w - - 0 1 {~b1,~c1,~d1}';
  b = new ffish.Board(V, fen);
  want = ['a1a2', 'a1a3', 'a1a4', 'a1a5', 'a1a6', 'a1a7', 'a1b1', 'e1d1', 'e1f1'];
  ok('I4: three knights on ice up to the king — 9 moves', same(moves(b), want), diff(moves(b), want));
  ok('I4: a1b1 — the momentum runs into the king and nobody moves, the rook rests on b1', board(after(fen, 'a1b1')) === '4k3/p7/8/8/8/8/8/1RnnK3', board(after(fen, 'a1b1')));
  b.delete();
  fen = '4k3/p7/8/8/8/8/8/R1nn1K2[] w - - 0 1 {~b1,~c1,~d1,~e1}';
  ok('I4: a gap — a1b1 shoves c1 into d1, c1 stays, d1 slides to e1', board(after(fen, 'a1b1')) === '4k3/p7/8/8/8/8/8/1Rn1nK2', board(after(fen, 'a1b1')));

  // I5 THE PAWN
  fen = '4k3/p7/8/8/8/8/3P4/4K3[] w - - 0 1 {~d3,~d4}';
  b = new ffish.Board(V, fen);
  ok('I5: d2d3 and d2d4 both slide to d5, 6 moves', moves(b).length === 6 && board(after(fen, 'd2d3')) === '4k3/p7/8/3P4/8/8/8/4K3' && board(after(fen, 'd2d4')) === '4k3/p7/8/3P4/8/8/8/4K3', moves(b).join(','));
  ok('I5: no en passant square after the slide', after(fen, 'd2d4').split(' ')[3] === '-', after(fen, 'd2d4'));
  b.delete();
  fen = '1k6/p7/8/8/3P4/8/8/4K3[] w - - 0 1 {~d5,~d6,~d7}';
  b = new ffish.Board(V, fen);
  want = ['d4d5b', 'd4d5n', 'd4d5q', 'd4d5r', 'd4d6b', 'd4d6n', 'd4d6q', 'd4d6r', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'];
  ok('I5: the push and the double step both slide onto d8 — a promotion each, 13 moves', same(moves(b), want), diff(moves(b), want));
  ok("I5: SAN 'd5=Q+' — the promotion where the slide stops, giving check", b.sanMove('d4d5q') === 'd5=Q+', b.sanMove('d4d5q'));
  b.push('d4d5q');
  ok('I5: a queen on d8, black in check', board(b.fen()) === '1k1Q4/p7/8/8/8/8/8/4K3' && b.isCheck(), b.fen());
  b.pop();
  b.delete();

  // I6 A SHOVED PAWN promotes to the strongest piece where it stops
  fen = '1R6/p3k3/8/8/8/8/1p5K/8[] w - - 0 1 {~b3,~b2}';
  b = new ffish.Board(V, fen);
  ok('I6: 18 moves; b8b3 stops on b3 and shoves the pawn from b2 to b1, where it is a queen', moves(b).length === 18 && board(after(fen, 'b8b3')) === '8/p3k3/8/8/8/1R6/7K/1q6', board(after(fen, 'b8b3')));
  b.delete();

  // I7 THE PIT
  fen = '4k3/p7/8/8/_7/8/8/R3K3[] w - - 0 1 {~a2,~a3}';
  b = new ffish.Board(V, fen);
  ok('I7: a1a3 slides the rook into the pit — offered, a1a2 folded into it, 9 moves; the rook is gone', moves(b).includes('a1a3') && !moves(b).includes('a1a2') && moves(b).length === 9 && board(after(fen, 'a1a3')) === '4k3/p7/8/8/_7/8/8/4K3', moves(b).join(','));
  b.delete();
  fen = '4k3/p7/8/8/_7/n7/8/R3K3[] w - - 0 1 {~a2,~a3}';
  ok('I7: the knight on a3 shoved into the pit by a1a2 is gone, the rook rests on a2', board(after(fen, 'a1a2')) === '4k3/p7/8/8/_7/8/R7/4K3', board(after(fen, 'a1a2')));

  // I8 PORTALS
  fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4,~h6,~h7}';
  b = new ffish.Board(V, fen);
  want = ['a1a2', 'a1a5', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'];
  ok('I8: a slide into the portal is the landing a1a5, so a1a3/a1a4 fold into it — 10 moves', same(moves(b), want), diff(moves(b), want));
  ok('I8: a1a5 lands on h7 and rests there though h7 is iced', board(after(fen, 'a1a5')) === '4k3/p6R/8/8/8/8/8/4K3', board(after(fen, 'a1a5')));
  b.delete();
  fen = '4k3/p7/8/8/8/8/8/R2K4[] w - - 0 1 {d5-h7,~d2,~d3,~d4,~h6,~h7}';
  ok('I8: a king step onto d2 slides into the portal at d5 and out at h7, at rest', board(after(fen, 'd1d2')) === '4k3/p6K/8/8/8/8/8/R7', board(after(fen, 'd1d2')));
  fen = '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4}';
  ok('I8: a knight on the portal square is an obstacle — a1a4 stops on a4, no shove', board(after(fen, 'a1a4')) === '4k3/p7/8/n7/R7/8/8/4K3', board(after(fen, 'a1a4')));

  // I9 THE CAST
  fen = '4k3/p7/8/8/8/8/8/R3K3[IOOioo] w - - 0 1';
  b = new ffish.Board(V, fen);
  const casts = moves(b).filter((m) => m.startsWith('I@'));
  ok('I9: sixteen ice casts on rows 4 and 5 beside the piece moves and portal casts — 77 moves', casts.length === 16 && casts.every((m) => '45'.includes(m[3])) && moves(b).length === 77, `${casts.length} ${moves(b).length}`);
  ok("I9: SAN 'I@e4'", b.sanMove('I@e4') === 'I@e4', b.sanMove('I@e4'));
  b.push('I@e4');
  ok('I9: I@e4 ices d3..f5, the scroll spent, black to move', b.fen() === '4k3/p7/8/8/8/8/8/R3K3[OOioo] b - - 0 1 {~d3,~e3,~f3,~d4,~e4,~f4,~d5,~e5,~f5}', b.fen());
  // (69 since deck.patch's NULL-CAST RULE, 2026-09-26: a cast on e4 would ice nothing — its patch is white's — so it is no move)
  ok('I9: black then has 69 moves: its 7 piece moves, 47 portal casts and 15 ice casts of its own (not e4, iced through)', moves(b).length === 69 && moves(b).filter((m) => m.startsWith('I@')).length === 15 && !moves(b).includes('I@e4'), String(moves(b).length));
  b.pop();
  ok('I9: pop returns the scroll', b.fen() === fen, b.fen());
  b.delete();
  fen = '4k3/p7/8/8/3n4/8/8/R3K3[IOOioo] w - - 0 1';
  ok('I9: a cast under the knight on d4 is offered and ices under it', board(after(fen, 'I@d4')) === '4k3/p7/8/8/3n4/8/8/R3K3' && field(after(fen, 'I@d4')) === '{~c3,~d3,~e3,~c4,~d4,~e4,~c5,~d5,~e5}', after(fen, 'I@d4'));
  fen = '4k3/p7/8/8/3*4/8/8/R3K3[IOOioo] w - - 0 1';
  b = new ffish.Board(V, fen);
  ok('I9: the wall on d4 takes no ice and is no cast square', !moves(b).includes('I@d4') && field(after(fen, 'I@d5')) === '{~c4,~e4,~c5,~d5,~e5,~c6,~d6,~e6}', field(after(fen, 'I@d5')));
  b.delete();
  fen = '4k3/p7/8/8/8/8/8/r3K2R[IOOioo] w - - 0 1';
  b = new ffish.Board(V, fen);
  ok('I9: no cast in check — the three king evasions alone', same(moves(b), ['e1d2', 'e1e2', 'e1f2']), moves(b).join(','));
  b.delete();

  // I10 A knight lands
  fen = '4k3/p7/8/8/8/8/8/N3K3[] w - - 0 1 {~b3,~c2,~c3,~c4}';
  b = new ffish.Board(V, fen);
  ok('I10: the knight lands on b3 and stays — 7 moves', moves(b).length === 7 && board(after(fen, 'a1b3')) === '4k3/p7/8/8/8/1N6/8/4K3', moves(b).join(','));
  b.delete();

  // I11 CHECK THROUGH THE PHYSICS
  fen = '4k3/p7/8/8/8/1R6/8/K6r[] w - - 0 1 {~b2,~b1}';
  b = new ffish.Board(V, fen);
  ok('I11: in check from h1 — three evasions: Ka2, Kb2 (sliding on to c3), Rb1 (sliding down to interpose)', same(moves(b), ['a1a2', 'a1b2', 'b3b1']), moves(b).join(','));
  ok('I11: a1b2 ends on c3; b3b1 interposes on b1', board(after(fen, 'a1b2')) === '4k3/p7/8/8/8/1RK5/8/7r' && board(after(fen, 'b3b1')) === '4k3/p7/8/8/8/8/8/KR5r', board(after(fen, 'a1b2')));
  b.delete();
  fen = '8/p7/8/8/8/4B3/R7/KR1nk3[] w - - 0 1 {~c1,~d1,~e1,~f1}';
  b = new ffish.Board(V, fen);
  ok("I11: b1c1 shoves the knight into the king, who slides into the bishop's line — SAN 'Rc1+', 32 moves", b.sanMove('b1c1') === 'Rc1+' && moves(b).length === 32, `${b.sanMove('b1c1')} ${moves(b).length}`);
  b.push('b1c1');
  ok('I11: ...black in check on g1, with f1 and h1 to go to', b.isCheck() && board(b.fen()) === '8/p7/8/8/8/4B3/R7/K1Rn2k1' && same(moves(b), ['g1f1', 'g1h1']), `${b.fen()} ${moves(b).join(',')}`);
  b.pop();
  b.delete();
  fen = 'k7/p7/8/8/8/8/8/K2R3r[] w - - 0 1 {~d2,~d3}';
  b = new ffish.Board(V, fen);
  ok('I11: the rook shielding a1 may not slide off the rank — 9 moves, none of d1d2/d1d3/d1d4', moves(b).length === 9 && !moves(b).some((m) => ['d1d2', 'd1d3', 'd1d4'].includes(m)), moves(b).join(','));
  b.delete();

  // I12 EN PASSANT onto ice slides on diagonally, here to a8 where it promotes
  fen = '4k3/8/8/2pP4/8/8/8/4K3[] w - c6 0 1 {~c6,~b7}';
  b = new ffish.Board(V, fen);
  ok('I12: the en passant capture d5c6 slides the pawn to a8 — four promotions, 11 moves', ['d5c6q', 'd5c6r', 'd5c6b', 'd5c6n'].every((m) => moves(b).includes(m)) && !moves(b).includes('d5c6') && moves(b).length === 11, moves(b).join(','));
  ok('I12: d5c6q — the c5 pawn gone, a queen on a8', board(after(fen, 'd5c6q')) === 'Q3k3/8/8/8/8/8/8/4K3', board(after(fen, 'd5c6q')));
  b.delete();

  // I13 A pawn shoves the enemy king
  fen = '4r3/p7/8/8/4k3/8/4P3/4K3[] w - - 0 1 {~e3,~e4}';
  b = new ffish.Board(V, fen);
  ok('I13: e2e3 shoves the black king from e4 to e5, no check — 5 moves', moves(b).length === 5 && board(after(fen, 'e2e3')) === '4r3/p7/8/4k3/8/4P3/8/4K3' && !/\+/.test(b.sanMove('e2e3')), `${moves(b).join(',')} ${b.sanMove('e2e3')}`);
  b.delete();

  // I14 The 10x10 duel shape with both scrolls, a pair and a patch: the move count the native build pinned
  const duel = '1r2k1r3/1pppppp3/10/10/10/10/10/10/1PPPPPP3/1R2K1R3[IOOioo] w - - 0 1 {d4-g7,~d5,~e5,~f5,~d6,~e6,~f6}';
  b = new ffish.Board('ice10', duel);
  ok('I14: the 10x10 duel shape: 107 legal moves (the native build\'s)', moves(b).length === 107, String(moves(b).length));
  ok('I14: the FEN round-trips on 10x10', b.fen() === duel, b.fen());
  b.delete();

  // THE CHECK-FLAG SWEEP: gives_check (the SAN suffix) against push + isCheck on every fixture and one ply deeper
  const fixtures = [
    '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~e2,~e3,~e4}', '8/p7/8/8/8/8/8/R3K1k_[] w - - 0 1 {~f1,~g1}',
    '4k3/p7/8/8/8/8/8/R1nn1K2[] w - - 0 1 {~b1,~c1,~d1,~e1}', '1k6/p7/8/8/3P4/8/8/4K3[] w - - 0 1 {~d5,~d6,~d7}', '7r/8/8/8/8/8/1P1R4/K5k1[] w - - 0 1 {~b3,~b4,~b5,~b6,~b7}',
    '1R6/p3k3/8/8/8/8/1p5K/8[] w - - 0 1 {~b3,~b2}', '4k3/p7/8/8/_7/n7/8/R3K3[] w - - 0 1 {~a2,~a3}', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4,~h6,~h7}',
    '4k3/p7/8/8/3n4/8/8/R3K3[IOOioo] w - - 0 1', '4k3/p7/8/8/8/1R6/8/K6r[] w - - 0 1 {~b2,~b1}', '8/p7/8/8/8/4B3/R7/KR1nk3[] w - - 0 1 {~c1,~d1,~e1,~f1}',
    '4k3/8/8/2pP4/8/8/8/4K3[] w - c6 0 1 {~c6,~b7}', '4r3/p7/8/8/4k3/8/4P3/4K3[] w - - 0 1 {~e3,~e4}',
  ];
  let checked = 0, bad = 0;
  const sweep = (bd, depth) => {
    for (const mv of moves(bd)) {
      const san = bd.sanMove(mv);
      const saysCheck = /[+#]$/.test(san);
      bd.push(mv);
      const isCheck = bd.isCheck();
      if (saysCheck !== isCheck) { bad++; if (bad < 6) console.log('   mismatch', bd.fen(), mv, san, isCheck); }
      checked++;
      if (depth > 1 && !bd.isGameOver()) sweep(bd, depth - 1);
      bd.pop();
    }
  };
  for (const f of fixtures) { const sb = new ffish.Board(V, f); sweep(sb, 2); sb.delete(); }
  ok(`check-flag sweep: ${checked} moves, SAN check suffix == push+isCheck`, bad === 0, `${bad} mismatches`);

  console.log(`\nice/ffish: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
