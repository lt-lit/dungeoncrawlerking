// THE PORTAL GATE, ffish half — PORTALS v2 (engine/patches/portals.patch +
// portals-v2.patch): a linked portal square is a BODY to every line, an EMPTY
// PAIR is a TUNNEL for riders (through another pair too, each pair once per
// line), landings step through and swap as before, a pawn's double step never
// crosses a portal, a linking cast may give check through the new pair and
// may not expose the caster. PORTALS v3 (portals-v3.patch, 2026-09-19): an
// open half freezes the other side (its one move is a pass, SAN '--') and
// binds its caster to the link; a pass fizzles a half no link can close.
// All through the JS API the game uses.
//   FFISH_JS=/path/to/patched/ffish.js node engine/tests/test-portals-ffish.cjs
// Every count below was derived by hand and confirmed by an independent
// Python model of the rules (the forge's oracle) before the engine ran it;
// the check-flag sweep compares the SAN check suffix (gives_check) against
// push + isCheck on every legal move of every fixture and one ply deeper.
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

[portal6:chess]
maxRank = 6
maxFile = 6
castling = false
stalemateValue = loss
nMoveRule = 0
nFoldRule = 0
nFoldValue = loss
extinctionValue = loss
extinctionPieceTypes = *
extinctionPieceCount = 1
extinctionPseudoRoyal = false
promotionRegionWhite = *6
promotionRegionBlack = *1
doubleStepRegionWhite = *2 *3 *4 *5
doubleStepRegionBlack = *5 *4 *3 *2
immobile = o
portalScroll = o
pieceDrops = true
dropRegionWhite = *2 *3 *4 *5
dropRegionBlack = *2 *3 *4 *5
pieceValueMg = o:0
pieceValueEg = o:0
`;

function run(ffish) {
  let pass = 0, fail = 0;
  const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
  ffish.loadVariantConfig(INI);
  const V = 'portal8';
  const moves = (b) => b.legalMoves().split(' ').filter(Boolean).sort();
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const diff = (a, b) => { const A = new Set(a), B = new Set(b); return [...[...A].filter((x) => !B.has(x)).map((x) => '+' + x), ...[...B].filter((x) => !A.has(x)).map((x) => '-' + x)].join(','); };
  const board = (f) => f.split(' ')[0].split('[')[0];
  const after = (fen, mv) => { const b = new ffish.Board(V, fen); b.push(mv); const f = b.fen(); b.delete(); return f; };

  // F1 THE BODY AND THE TUNNEL: a1's line stops at a4 (a5..a7 gone), comes out of h5 and runs on to h8
  let fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}';
  ok('validateFen accepts the portal field', ffish.validateFen(fen, V) === 1, String(ffish.validateFen(fen, V)));
  let b = new ffish.Board(V, fen);
  ok('FEN round-trips with the portal field', b.fen() === fen, b.fen());
  let want = ['a1a2', 'a1a3', 'a1a4', 'a1h6', 'a1h7', 'a1h8', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'];
  ok('F1: exactly the 14 moves — the body stops the a-file, the tunnel opens h6..h8', same(moves(b), want), diff(moves(b), want));
  ok("F1: SAN of the tunnel check is 'Rh8+'", b.sanMove('a1h8') === 'Rh8+', b.sanMove('a1h8'));
  ok("F1: SAN of the landing is 'Ra4' (a quiet move)", b.sanMove('a1a4') === 'Ra4', b.sanMove('a1a4'));
  b.push('a1a4');
  ok('F1: the landing puts the rook on h5', board(b.fen()) === '4k3/p7/8/7R/8/8/8/4K3', b.fen());
  b.pop();
  b.push('a1h6');
  ok('F1: the tunnel move puts the rook on h6, both portals empty', board(b.fen()) === '4k3/p7/7R/8/8/8/8/4K3', b.fen());
  b.pop();
  ok('F1: two pops restore the start', b.fen() === fen, b.fen());
  b.delete();

  // F2 THE PLUGGED EXIT: no tunnel; the landing swaps with the plug
  fen = '4k3/p7/8/7n/8/8/8/R3K3[] w - - 0 1 {a4-h5}';
  b = new ffish.Board(V, fen);
  want = ['a1a2', 'a1a3', 'a1a4', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'];
  ok('F2: 11 moves, the tunnel closed by the knight on the exit', same(moves(b), want), diff(moves(b), want));
  b.push('a1a4');
  ok('F2: the landing swaps: rook on h5, knight on a4', board(b.fen()) === '4k3/p7/8/7R/n7/8/8/4K3', b.fen());
  b.delete();

  // F3 THE PLUGGED ENTRY: captured on landing, the rook steps through
  fen = '4k3/p7/8/8/n7/8/8/R3K3[] w - - 0 1 {a4-h5}';
  b = new ffish.Board(V, fen);
  ok('F3: 11 moves', same(moves(b), want), diff(moves(b), want));
  ok("F3: SAN 'Rxa4'", b.sanMove('a1a4') === 'Rxa4', b.sanMove('a1a4'));
  b.push('a1a4');
  ok('F3: the knight is gone, the rook on h5', board(b.fen()) === '4k3/p7/8/7R/8/8/8/4K3', b.fen());
  b.delete();

  // F4 CHECK THROUGH THE TUNNEL, and the pin through it
  b = new ffish.Board(V, '8/6bk/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}');
  ok('F4: black is in check through the tunnel', b.isCheck());
  want = ['h7g6', 'h7g8', 'g7h6', 'g7a1'];
  ok('F4: the 4 evasions — two king steps, the bishop blocks at h6 or takes the rook', same(moves(b), want), diff(moves(b), want));
  b.delete();
  b = new ffish.Board(V, '7k/8/7b/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}');
  want = ['h8g8', 'h8g7', 'h8h7'];
  ok('F4b: the bishop on h6 is pinned through the tunnel — 3 king moves only', same(moves(b), want), diff(moves(b), want));
  b.delete();

  // F5 DISCOVERED CHECK THROUGH THE TUNNEL: every bishop move off h6 gives check
  fen = '7k/1p6/7B/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}';
  b = new ffish.Board(V, fen);
  const bish = ['h6g7', 'h6f8', 'h6g5', 'h6f4', 'h6e3', 'h6d2', 'h6c1'];
  want = [...bish, 'a1a2', 'a1a3', 'a1a4', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'];
  ok('F5: 18 moves, the tunnel closed by the bishop', same(moves(b), want), diff(moves(b), want));
  ok('F5: every bishop move discovers the check (SAN +)', bish.every((m) => /\+$/.test(b.sanMove(m))), bish.map((m) => b.sanMove(m)).join(','));
  ok('F5: the landing under the bishop gives no check', !/\+$/.test(b.sanMove('a1a4')), b.sanMove('a1a4'));
  b.delete();

  // F6 STEPPING INTO THE TUNNEL BLOCKS; the body stops the rook's own line short of a1
  fen = 'r7/7k/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}';
  b = new ffish.Board(V, fen);
  ok('F6: black in check', b.isCheck());
  want = ['h7g6', 'h7g7', 'h7g8', 'a8a4'];
  ok('F6: 4 evasions — a8a4 plugs the exit from inside; a8a1 is no move', same(moves(b), want), diff(moves(b), want));
  b.push('a8a4');
  ok('F6: the rook stands on h5', board(b.fen()) === '8/7k/8/7r/8/8/8/R3K3', b.fen());
  b.delete();

  // F7 THE CHAIN through two pairs
  fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}';
  b = new ffish.Board(V, fen);
  want = ['a1a2', 'a1a3', 'a1c7', 'a1f3', 'a1f4', 'a1f5', 'a1f6', 'a1f7', 'a1f8', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'];
  ok('F7: 17 moves — c8 never reached, f3..f8 through both pairs', same(moves(b), want), diff(moves(b), want));
  ok("F7: SAN 'Rf8+' through two tunnels", b.sanMove('a1f8') === 'Rf8+', b.sanMove('a1f8'));
  ok('F7: a1a3 lands on c6', board(after(fen, 'a1a3')) === '4k3/p7/2R5/8/8/8/8/4K3');
  ok('F7: a1c7 (stopping in the second tunnel) lands on f2', board(after(fen, 'a1c7')) === '4k3/p7/8/8/8/8/5R2/4K3');
  ok('F7: the king steps into the second pair and lands on c7', board(after(fen, 'e1f2')) === '4k3/p1K5/8/8/8/8/8/R7');
  b.delete();

  // F8 EACH PAIR ONCE PER LINE: the loop stops at the used pair
  fen = '7k/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-e5,e6-e3}';
  b = new ffish.Board(V, fen);
  want = ['a1a2', 'a1a3', 'a1e6', 'a1e4', 'a1e5', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'];
  ok('F8: 13 moves — a4..a8 and e7/e8 never reached', same(moves(b), want), diff(moves(b), want));
  ok('F8: landing on the used pair (a1e5) puts the rook on a3', board(after(fen, 'a1e5')) === '7k/p7/8/8/8/R7/8/4K3');
  b.delete();

  // F9 THE PAWN'S DOUBLE STEP: a portal on the first square ends it; on the second it lands and steps through
  b = new ffish.Board(V, '4k3/7p/8/8/8/8/P7/4K3[] w - - 0 1 {a3-d5}');
  ok('F9a: a2a3 only (the double step crosses no portal)', moves(b).includes('a2a3') && !moves(b).includes('a2a4') && moves(b).length === 6, moves(b).join(','));
  b.push('a2a3');
  ok('F9a: the pawn lands on d5', board(b.fen()) === '4k3/7p/8/3P4/8/8/8/4K3', b.fen());
  b.delete();
  b = new ffish.Board(V, '4k3/7p/8/8/8/8/P7/4K3[] w - - 0 1 {a4-d5}');
  ok('F9b: a2a3 and a2a4 (the double step lands on the portal)', moves(b).includes('a2a4') && moves(b).length === 7, moves(b).join(','));
  b.push('a2a4');
  ok('F9b: the pawn lands on d5 and no en passant square is set', board(b.fen()) === '4k3/7p/8/3P4/8/8/8/4K3' && b.fen().split(' ')[3] === '-', b.fen());
  b.delete();

  // F10 THE CASTS: a linking cast gives check through the new pair; one that exposes the caster is illegal
  fen = '8/1p5k/8/8/8/8/8/R3K3[OO] w - - 0 1 {a4w}';
  b = new ffish.Board(V, fen);
  ok('F10a: O@h5 is a legal cast', moves(b).includes('O@h5'));
  ok("F10a: SAN 'O@h5+' — the cast gives check through the new tunnel", b.sanMove('O@h5') === 'O@h5+', b.sanMove('O@h5'));
  const checkCasts = moves(b).filter((m) => m.startsWith('O@') && /\+$/.test(b.sanMove(m)));
  ok('F10a: exactly the h2..h6 casts give check', same(checkCasts, ['O@h2', 'O@h3', 'O@h4', 'O@h5', 'O@h6']), checkCasts.join(','));
  b.push('O@h5');
  ok('F10a: black is in check after the cast, with the 3 king steps', b.isCheck() && same(moves(b), ['h7g6', 'h7g7', 'h7g8']), moves(b).join(','));
  b.delete();
  b = new ffish.Board(V, 'r2k4/8/8/8/7K/8/8/1R6[OO] w - - 0 1 {a5w}');
  const m10 = moves(b);
  ok('F10b: the casts that would open a line onto the caster\'s king are refused (h5, h6, h7), c3 is offered', !m10.includes('O@h5') && !m10.includes('O@h6') && !m10.includes('O@h7') && m10.includes('O@c3'), m10.filter((m) => m.startsWith('O@h')).join(','));
  ok('F10b: 43 legal moves — the linking casts alone (v3 binds the caster to the link; v2 had 62 with the king and rook moves)', m10.length === 43, String(m10.length));
  b.delete();

  // The landings as before: twin to twin, the swap of a king, the capture through
  fen = '4k3/3p4/5n2/8/8/2B5/3P4/4K3[] w - - 0 1 {c3-f6}';
  b = new ffish.Board(V, fen);
  ok('F11: twin to twin captures at range, 13 moves', moves(b).includes('c3f6') && moves(b).length === 13, String(moves(b).length));
  b.push('c3f6');
  ok('F11: the knight is gone and the bishop is back on c3', board(b.fen()) === '4k3/3p4/8/8/8/2B5/3P4/4K3', b.fen());
  b.delete();
  b = new ffish.Board(V, '4k3/3p4/8/8/8/2B5/3P4/4K3[] w - - 0 1 {c3-f6}');
  ok('F11b: the quiet pass c3f6 stays, c3g7 is gone (f6 is a body): 13 moves', moves(b).includes('c3f6') && !moves(b).includes('c3g7') && moves(b).length === 13, moves(b).join(','));
  b.push('c3f6');
  ok('F11b: the pass changes nothing but the turn', board(b.fen()) === '4k3/3p4/8/8/8/2B5/3P4/4K3' && b.fen().includes(' b '), b.fen());
  b.delete();
  fen = 'r7/3p4/4k3/8/8/8/3P4/2R1K3[] w - - 0 1 {c3-e6}';
  b = new ffish.Board(V, fen);
  ok('F12: 11 moves (c4..c8 gone), c1c3 offered', moves(b).includes('c1c3') && moves(b).length === 11, String(moves(b).length));
  ok("F12: SAN 'Rc3+' — the king is swapped next to the pawn", b.sanMove('c1c3') === 'Rc3+', b.sanMove('c1c3'));
  b.push('c1c3');
  ok('F12: 8 evasions incl. d7e6, the pawn swapping the king back out', b.isCheck() && moves(b).length === 8 && moves(b).includes('d7e6'), moves(b).join(','));
  b.push('d7e6');
  ok('F12: the king back on e6, the pawn on c3, the rook gone', board(b.fen()) === 'r7/8/4k3/8/8/2p5/3P4/4K3', b.fen());
  b.delete();
  fen = '4k3/3p4/5b2/8/8/2n5/3P4/2R1K3[] w - - 0 1 {c3-f6}';
  b = new ffish.Board(V, fen);
  ok("F13: capture through with the far occupant swapped back — 9 moves, SAN 'Rxc3'", moves(b).length === 9 && b.sanMove('c1c3') === 'Rxc3', moves(b).join(','));
  b.push('c1c3');
  ok('F13: knight gone, rook on f6, bishop on c3', board(b.fen()) === '4k3/3p4/5R2/8/8/2b5/3P4/4K3', b.fen());
  b.pop();
  ok('F13: pop restores all three squares', b.fen() === fen, b.fen());
  b.delete();
  b = new ffish.Board(V, '4k3/p6r/8/8/8/8/1P1K4/R7[] w - - 0 1 {d3-g7}');
  ok('F14: 21 moves — the king may not step through onto g7 (attacked), nor to c3 (h7 attacks it through g7-d3)', moves(b).length === 21 && !moves(b).includes('d2d3') && !moves(b).includes('d2c3'), moves(b).join(','));
  b.delete();
  b = new ffish.Board(V, '4k2r/p7/8/8/8/8/1P1K4/R7[] w - - 0 1 {d3-g7}');
  ok('F14b: 23 moves with d2d3 onto a safe exit', moves(b).length === 23 && moves(b).includes('d2d3'), String(moves(b).length));
  b.push('d2d3');
  ok('F14b: the king stands on g7', board(b.fen()) === '4k2r/p5K1/8/8/8/8/1P6/R7', b.fen());
  b.delete();
  b = new ffish.Board(V, '4k3/3p4/4P3/8/8/8/3P4/4K3[] w - - 0 1 {b3-e7}');
  ok('F15: a pawn through a portal — 8 moves incl. e6e7', moves(b).length === 8 && moves(b).includes('e6e7'), moves(b).join(','));
  b.push('e6e7');
  ok('F15: the pawn lands on b3', board(b.fen()) === '4k3/3p4/8/8/8/1P6/3P4/4K3', b.fen());
  b.delete();
  b = new ffish.Board(V, '4k3/3p4/8/8/8/8/3P4/r3K3[OOoo] w - - 0 1');
  ok('F16: no cast while in check — 2 evasions', moves(b).length === 2 && !moves(b).some((x) => x.includes('@')), moves(b).join(','));
  b.delete();

  // The four casts as before, and the field's own checks
  const fen7 = '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1';
  b = new ffish.Board(V, fen7);
  const casts = moves(b).filter((x) => x.startsWith('O@'));
  ok('F17: 52 moves = 6 normal + 46 casts, none on a king row', moves(b).length === 52 && casts.length === 46 && !casts.some((x) => /[18]$/.test(x)), `${moves(b).length} ${casts.length}`);
  for (const m of ['O@c3', 'e8e8', 'O@e5', 'O@f6', 'e1e1', 'O@a4']) b.push(m); // v3: half, the frozen pass, link — twice
  ok('F17: both pairs closed, hands empty, six plies', b.fen() === '4k3/3p4/8/8/8/8/3P4/4K3[] w - - 0 4 {c3-e5,a4-f6}', b.fen());
  b.delete();

  // V3 THE ONE-TURN CAST (2026-09-19, portals-v3.patch): the frozen ply, the link ply, the fizzle, the pass's SAN
  b = new ffish.Board(V, '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1');
  b.push('O@c4');
  ok('V3: after the half the enemy is FROZEN — its one legal move is the pass', moves(b).join(',') === 'e8e8', moves(b).join(','));
  ok("V3: the pass reads '--' in SAN", b.sanMove('e8e8') === '--', b.sanMove('e8e8'));
  ok('V3: the half stands in the FEN, black to move, the scroll spent', b.fen() === '4k3/3p4/8/8/8/8/3P4/4K3[Ooo] b - - 0 1 {c4w}', b.fen());
  b.push('e8e8');
  ok('V3: nobody in check after the pass; white to move on the link ply', !b.isCheck() && b.fen() === '4k3/3p4/8/8/8/8/3P4/4K3[Ooo] w - - 1 2 {c4w}', b.fen());
  const links = moves(b);
  ok('V3: the link ply — 45 linking casts and nothing else (no piece move; the pass is illegal while a link is)', links.length === 45 && links.every((x) => x.startsWith('O@')) && !links.includes('O@c4'), `${links.length} ${links.filter((x) => !x.startsWith('O@')).join(',')}`);
  b.push('O@f5');
  ok('V3: the pair stands, black to move unfrozen with 50 moves, its own casts among them', b.fen() === '4k3/3p4/8/8/8/8/3P4/4K3[oo] b - - 0 2 {c4-f5}' && moves(b).length === 50 && moves(b).some((x) => x.startsWith('O@')) && !moves(b).includes('e8e8'), `${b.fen()} ${moves(b).length}`);
  b.pop(); b.pop();
  ok('V3: pop restores the frozen ply', moves(b).join(',') === 'e8e8' && b.fen() === '4k3/3p4/8/8/8/8/3P4/4K3[Ooo] b - - 0 1 {c4w}', b.fen());
  b.delete();
  const V6 = 'portal6';
  b = new ffish.Board(V6, '5k/******/*r****/*1****/1*****/KN4[OO] w - - 0 1');
  ok('V3 fizzle: Ka2 and the two casts alone (the knight is walled in)', same(moves(b), ['a1a2', 'O@a2', 'O@b3']), moves(b).join(','));
  b.push('O@a2');
  ok('V3 fizzle: black frozen — f6f6', moves(b).join(',') === 'f6f6', moves(b).join(','));
  b.push('f6f6');
  ok('V3 fizzle: no legal link (b3 would open the rook onto a1 through a2) — the fizzle a1a1 alone', moves(b).join(',') === 'a1a1', moves(b).join(','));
  ok("V3 fizzle: its SAN is '--' too", b.sanMove('a1a1') === '--', b.sanMove('a1a1'));
  b.push('a1a1');
  ok('V3 fizzle: the half is gone, the other scroll kept, black to move with Ke6 and Rb3', b.fen() === '5k/******/*r****/*1****/1*****/KN4[O] b - - 2 2' && same(moves(b), ['f6e6', 'b4b3']), `${b.fen()} ${moves(b).join(',')}`);
  ok('V3 fizzle: two passes in a row end nothing', !b.isGameOver() && !b.isGameOver(true), `${b.isGameOver()} ${b.isGameOver(true)}`);
  b.delete();
  ok('validateFen rejects a portal on a king row', ffish.validateFen('4k3/3p4/8/8/8/8/3P4/4K3[] w - - 0 1 {a1-c4}', V) < 0);
  ok('validateFen rejects a square used twice', ffish.validateFen('4k3/3p4/8/8/8/8/3P4/4K3[] w - - 0 1 {c3-c4,c4-d5}', V) < 0);

  // The strip rule: scrolls, halves and pairs are never pieces
  for (const [f, label] of [['4k3/3p4/8/8/8/8/8/4K3[OOoo] w - - 0 1', 'king + scrolls in hand'], ['4k3/3p4/8/8/8/8/8/4K3[] w - - 0 1 {e4w}', 'king + an open half'], ['4k3/3p4/8/8/8/8/8/4K3[] w - - 0 1 {c3-f6}', 'king + a pair']]) {
    const sb = new ffish.Board(V, f);
    ok(`strip: ${label} is decided at load`, sb.isGameOver() && sb.result() !== '*', `${sb.isGameOver()} ${sb.result()}`);
    sb.delete();
  }

  // Consistency sweep: the SAN check suffix (gives_check) against push + isCheck,
  // on every legal move of every fixture position and one ply deeper.
  const fixtures = [
    '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', '4k3/p7/8/7n/8/8/8/R3K3[] w - - 0 1 {a4-h5}', '8/6bk/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}',
    '7k/1p6/7B/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 'r7/7k/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}',
    '7k/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-e5,e6-e3}', '8/1p5k/8/8/8/8/8/R3K3[OO] w - - 0 1 {a4w}', 'r2k4/8/8/8/7K/8/8/1R6[OO] w - - 0 1 {a5w}',
    'r7/3p4/4k3/8/8/8/3P4/2R1K3[] w - - 0 1 {c3-e6}', 'r2qk2r/pp1bppb1/2np1np1/8/3P4/2N2N2/PPQ1PPPP/R3KB1R[] w - - 0 1 {c4-f5,d5-g6}',
    '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1 {c3-f6}',
    '4k3/3p4/8/8/8/8/3P4/4K3[Ooo] b - - 0 1 {c4w}', '4k3/3p4/8/8/8/8/3P4/4K3[Ooo] w - - 0 1 {c4w}', // v3: a frozen ply, a link ply
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

  console.log(`\nportals/ffish: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
