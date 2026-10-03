// THE DECK GATE, ffish half — engine/patches/deck.patch (brief §4.10 "Phase
// 3.3"): the deck IN THE ENGINE through the JS API the game uses. A side's
// hand is card SLOTS in the holdings (custom immobile pieces s..z, each bound
// per colour to a card ID by the FEN's trailing field: `S=w12`, `+` the slot
// whose portal half stands open), its PILE the field's `w|12.7.33` (top
// first); the side about to move draws up to the hand size inside the move
// that hands it the turn (never the frozen side of an open half, never on the
// link ply); the MULLIGAN `@@@@` (SAN `redraw`) discards the hand and draws
// anew; a card is cast as a drop of its slot (`S@e4`) by its kind — portal,
// ice, the test-only WIN card (cast on the caster's own king: `!w` in the
// field, the game over), a blank (a meta card) never; no card is cast in
// check; a bared king with cards in hand has lost (cards are never pieces).
//   FFISH_JS=/path/to/patched/ffish.js node engine/tests/test-deck-ffish.cjs
// Every count was derived by the forge's independent Python oracle
// (engine/forge/oracle.py) and confirmed on the native build before the wasm
// ran it (engine/forge/native-test-deck.py). The test variants are the
// forge's deck.ini, read from disk so both gates share one definition.
const fs = require('fs'), path = require('path');
const FFISH_JS = process.env.FFISH_JS; if (!FFISH_JS) { console.error('set FFISH_JS=/path/to/patched/ffish.js'); process.exit(2); }
const INI = fs.readFileSync(path.join(__dirname, '..', 'forge', 'deck.ini'), 'utf8');
const realFetch = global.fetch; delete global.fetch;
const Module = require(FFISH_JS);
Module.onRuntimeInitialized = () => { global.fetch = realFetch; run(Module); };

function run(ffish) {
  let pass = 0, fail = 0;
  const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
  ffish.loadVariantConfig(INI);
  const V = 'deck8';
  const moves = (b) => b.legalMoves().split(' ').filter(Boolean).sort();
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const diff = (a, b) => { const A = new Set(a), B = new Set(b); return [...[...A].filter((x) => !B.has(x)).map((x) => '+' + x), ...[...B].filter((x) => !A.has(x)).map((x) => '-' + x)].join(','); };
  const pocket = (f) => (f.match(/\[([^\]]*)\]/) || ['', ''])[1];
  const field = (f) => (f.match(/\{[^}]*\}/) || [''])[0];
  const after = (fen, mvs, v = V) => { const b = new ffish.Board(v, fen); for (const m of mvs) b.push(m); const f = b.fen(); b.delete(); return f; };
  const casts = (ms, slot) => ms.filter((m) => m.startsWith(slot + '@'));

  // D1 THE START: white holds an ice card (id 1) in s, its pile a win card and a blank; black an ice card (id 2) in s, its pile another ice
  let fen = '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|20.30,b|1,S=w1,S=b2}';
  ok('validateFen accepts the deck field (a pile, a binding)', ffish.validateFen(fen, V) === 1, String(ffish.validateFen(fen, V)));
  ok('validateFen accepts a marked slot and a winner', ffish.validateFen('4k3/p7/8/8/8/8/8/R3K3[Ss] b - - 0 1 {e4w,S=w10+,S=b2}', V) === 1 && ffish.validateFen('3k4/p7/8/8/8/8/8/R3K3[Tst] b - - 0 2 {T=w30,S=b2,T=b1,!w}', V) === 1);
  let b = new ffish.Board(V, fen);
  ok('D1: the FEN round-trips in canonical order (a side\'s pile, then its bindings; white then black)', b.fen() === '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|20.30,S=w1,b|1,S=b2}', b.fen());
  let ms = moves(b);
  ok('D1: 31 moves — 16 ice casts of slot s on the middle rows, the mulligan, 14 piece moves', ms.length === 31 && casts(ms, 'S').length === 16 && casts(ms, 'S').every((m) => '45'.includes(m[3])) && ms.includes('@@@@'), `${ms.length} ${ms.join(',')}`);
  ok("D1: SAN 'S@e4' for the cast, 'redraw' for the mulligan", b.sanMove('S@e4') === 'S@e4' && b.sanMove('@@@@') === 'redraw', `${b.sanMove('S@e4')} ${b.sanMove('@@@@')}`);
  // D2 THE DRAW: after white's ice cast, black draws its pile's ice into its next free slot (t); white draws nothing yet
  b.push('S@e4');
  ok('D2: S@e4 — the patch iced, white\'s card spent, black drew id 1 into t', b.fen() === '4k3/p7/8/8/8/8/8/R3K3[st] b - - 0 1 {~d3,~e3,~f3,~d4,~e4,~f4,~d5,~e5,~f5,w|20.30,S=b2,T=b1}', b.fen());
  ms = moves(b);
  ok('D2: black — fifteen casts from each slot (e4 is iced through), 7 piece moves, no mulligan on an empty pile: 37', ms.length === 37 && casts(ms, 'S').length === 15 && casts(ms, 'T').length === 15 && !ms.includes('S@e4') && !ms.includes('@@@@'), String(ms.length));
  // D3 white draws at the end of black's move: the win card (20) into s, the blank (30) into t
  b.push('e8d8');
  ok('D3: e8d8 — white draws 20 into S and 30 into T, its pile empty, the halfmove clock reset by the draw', b.fen() === '3k4/p7/8/8/8/8/8/R3K3[STst] w - - 0 2 {~d3,~e3,~f3,~d4,~e4,~f4,~d5,~e5,~f5,S=w20,T=w30,S=b2,T=b1}', b.fen());
  ms = moves(b);
  ok('D3: the win card is cast on the king\'s own square alone, the blank never, no mulligan on an empty pile: 15', ms.includes('S@e1') && casts(ms, 'S').length === 1 && casts(ms, 'T').length === 0 && !ms.includes('@@@@') && ms.length === 15, ms.join(','));
  ok("D3: SAN 'S@e1'", b.sanMove('S@e1') === 'S@e1', b.sanMove('S@e1'));
  // D4 THE WIN: the game ends at once
  b.push('S@e1');
  ok('D4: S@e1 — the field carries !w, the card spent, nobody draws', b.fen() === '3k4/p7/8/8/8/8/8/R3K3[Tst] b - - 0 2 {~d3,~e3,~f3,~d4,~e4,~f4,~d5,~e5,~f5,T=w30,S=b2,T=b1,!w}', b.fen());
  ok('D4: black has no legal move and the game is over', moves(b).length === 0 && b.isGameOver(), `${moves(b).length} ${b.isGameOver()}`);
  b.pop(); b.pop(); b.pop();
  ok('D4: three pops restore the start (the draws undone, the ice gone, the cards back)', b.fen() === '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|20.30,S=w1,b|1,S=b2}', b.fen());
  b.delete();

  // D5 THE MULLIGAN: discard the hand, draw four; the discards never return; black draws its own pile at the end of the ply
  fen = '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|10.11.20.31,b|1,S=w1,S=b2}';
  b = new ffish.Board(V, fen);
  ok('D5: 31 moves with the mulligan among them', moves(b).length === 31 && moves(b).includes('@@@@'), String(moves(b).length));
  b.push('@@@@');
  ok('D5: after it — two portals, the win card and a blank in s..v, the ice gone, the pile empty; black drew its ice into t', b.fen() === '4k3/p7/8/8/8/8/8/R3K3[STUVst] b - - 0 1 {S=w10,T=w11,U=w20,V=w31,S=b2,T=b1}', b.fen());
  ms = moves(b);
  ok('D5: black to move with two ice cards and no pile: 16 + 16 casts, 7 piece moves, no mulligan — 39', ms.length === 39 && casts(ms, 'S').length === 16 && casts(ms, 'T').length === 16 && !ms.includes('@@@@'), String(ms.length));
  b.pop();
  ok('D5: pop restores the hand and the pile', b.fen() === '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|10.11.20.31,S=w1,b|1,S=b2}', b.fen());
  b.delete();

  // D6 A PORTAL CARD: the half marks its slot and spends nothing; the other side is frozen; the link spends the card and both draw
  fen = '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|1,b|1,S=w10,S=b2}';
  b = new ffish.Board(V, fen);
  ms = moves(b);
  ok('D6: 62 moves — 47 casts of the portal card (rows 2-7 less the pawn on a7), the mulligan, 14 piece moves', ms.length === 62 && casts(ms, 'S').length === 47 && ms.includes('@@@@'), String(ms.length));
  b.push('S@e4');
  ok('D6: S@e4 — the half stands, the slot marked +, the card still in hand, nobody drew', b.fen() === '4k3/p7/8/8/8/8/8/R3K3[Ss] b - - 0 1 {e4w,w|1,S=w10+,b|1,S=b2}', b.fen());
  ok("D6: black is frozen — its one move the pass e8e8, SAN '--'", same(moves(b), ['e8e8']) && b.sanMove('e8e8') === '--', `${moves(b).join(',')} ${b.sanMove('e8e8')}`);
  b.push('e8e8');
  ms = moves(b);
  ok('D6: the link ply offers the slot\'s drops alone — 46 links (the castables less e4), no mulligan, no piece move', ms.length === 46 && casts(ms, 'S').length === 46 && !ms.includes('S@e4'), String(ms.length));
  b.push('S@c5');
  ok('D6: S@c5 — the pair stands, the card spent, black draws its pile\'s ice into t', b.fen() === '4k3/p7/8/8/8/8/8/R3K3[st] b - - 0 2 {e4-c5,w|1,S=b2,T=b1}', b.fen());
  b.push('d8d7'.replace('d8', 'e8'));
  ok('D6: ...and white then draws its ice into s', pocket(b.fen()) === 'Sst' && field(b.fen()).includes('S=w1') && !field(b.fen()).includes('w|'), b.fen());
  b.pop(); b.pop(); b.pop(); b.pop();
  ok('D6: four pops restore the start', b.fen() === '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|1,S=w10,b|1,S=b2}', b.fen());
  b.delete();

  // D7 THE FIZZLE spends the card: one castable square on a walled 6x6, the caster left without a link
  fen = '2p1k1/******/******/******/1*****/K4N[S] w - - 0 1 {S=w10}';
  b = new ffish.Board('deck6', fen);
  ok('D7: three moves — S@a2 the one cast, beside Ka2 and Kb1', same(moves(b), ['S@a2', 'a1a2', 'a1b1']), moves(b).join(','));
  b.push('S@a2'); b.push('e6e6');
  ok("D7: the caster with no link left has the fizzle pass alone, SAN '--'", same(moves(b), ['a1a1']) && b.sanMove('a1a1') === '--', moves(b).join(','));
  b.push('a1a1');
  ok('D7: after it the half is gone and the card spent', b.fen() === '2p1k1/******/******/******/1*****/K4N[] b - - 0 2', b.fen());
  b.pop(); b.pop(); b.pop();
  ok('D7: pops restore the card', b.fen() === fen, b.fen());
  b.delete();

  // D8 IDENTICAL CARDS MERGE: two ice cards of one ID drawn into one slot with a count of two, the blank beside
  fen = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {w|1.1.30,b|2}';
  let f = after(fen, ['e1d1', 'e8d8']);
  ok('D8: white holds SST — two of id 1 in s, the blank in t; black its one card', pocket(f) === 'SSTs' && field(f).includes('S=w1') && field(f).includes('T=w30') && field(f).includes('S=b2') && !field(f).includes('|'), f);
  b = new ffish.Board(V, f);
  ok('D8: the doubled slot casts like one card: 16 casts, 13 piece moves (Kd1, Ra1), no blank cast, no mulligan — 29', moves(b).length === 29 && casts(moves(b), 'S').length === 16 && casts(moves(b), 'T').length === 0 && !moves(b).includes('@@@@'), String(moves(b).length));
  b.push('S@e4');
  ok('D8: one cast leaves one', pocket(b.fen()).startsWith('ST'), b.fen());
  b.delete();

  // D9 NO CARD IN CHECK; D10 CARDS ARE NEVER PIECES
  b = new ffish.Board(V, '4k3/p7/8/8/8/8/8/r3K2R[STst] w - - 0 1 {w|20,S=w1,T=w10,S=b2,T=b1}');
  ok('D9: in check — the king\'s three evasions and nothing else (no cast, no mulligan)', same(moves(b), ['e1d2', 'e1e2', 'e1f2']), moves(b).join(','));
  b.delete();
  b = new ffish.Board(V, '4k3/p7/8/8/8/8/8/4K3[ST] w - - 0 1 {w|20,S=w1,T=w10}');
  ok('D10: a bared king with two cards in hand has lost — no legal move, game over', moves(b).length === 0 && b.isGameOver(), String(moves(b).length));
  b.delete();

  // D13 THE ROOT BY MOVES equals its FEN: two mulligans and two pawn moves in, the third mulligan on the last card
  fen = '3k4/pppp4/8/8/8/8/P7/4K3[STUV] w - - 0 1 {w|5.6.7.8.9.1.2.3.20,S=w1,T=w2,U=w3,V=w4}';
  b = new ffish.Board(V, fen);
  for (const m of ['@@@@', 'c7c5', '@@@@', 'c5c4']) b.push(m);
  ok('D13: one card left, the hand 9.1.2.3', b.fen() === '3k4/pp1p4/8/8/2p5/8/P7/4K3[STUV] w - - 0 3 {w|20,S=w9,T=w1,U=w2,V=w3}', b.fen());
  const fresh = new ffish.Board(V, b.fen());
  ok('D13: the same 72 moves by moves and from the FEN, the mulligan among them', same(moves(b), moves(fresh)) && moves(b).length === 72 && moves(b).includes('@@@@'), diff(moves(b), moves(fresh)));
  b.push('@@@@');
  ok('D13: the third mulligan draws the win card into s, the pile empty', pocket(b.fen()) === 'S' && field(b.fen()) === '{S=w20}', b.fen());
  fresh.delete(); b.delete();

  // D12 THE 10x10 DUEL SHAPE with two decks: the move count the native build pinned
  const duel = '1r2k1r3/1pppppp3/10/10/10/10/10/10/1PPPPPP3/1R2K1R3[STUVstuv] w - - 0 1 {w|3.14.20.7.15.30,b|9.19.1.31.5,S=w1,T=w10,U=w2,V=w11,S=b2,T=b12,U=b3,V=b13}';
  b = new ffish.Board('deck10', duel);
  ok('D12: the 10x10 duel shape: 198 legal moves (the native build\'s)', moves(b).length === 198, String(moves(b).length));
  ok('D12: the FEN round-trips on 10x10 (each side\'s pile then its bindings)', b.fen() === '1r2k1r3/1pppppp3/10/10/10/10/10/10/1PPPPPP3/1R2K1R3[STUVstuv] w - - 0 1 {w|3.14.20.7.15.30,S=w1,T=w10,U=w2,V=w11,b|9.19.1.31.5,S=b2,T=b12,U=b3,V=b13}', b.fen());
  b.delete();

  // THE CHECK-FLAG SWEEP: gives_check (the SAN suffix) against push + isCheck on every fixture and one ply deeper
  const fixtures = [
    ['deck8', '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|20.30,b|1,S=w1,S=b2}'], ['deck8', '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|10.11.20.31,b|1,S=w1,S=b2}'],
    ['deck8', '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|1,b|1,S=w10,S=b2}'], ['deck6', '2p1k1/******/******/******/1*****/K4N[S] w - - 0 1 {S=w10}'],
    ['deck8', 'r2k4/p7/8/8/8/8/8/R3K3[STst] w - - 0 2 {S=w20,T=w30,S=b2,T=b1}'], ['deck8', '4k3/p7/8/8/8/8/8/r3K2R[STst] w - - 0 1 {w|20,S=w1,T=w10,S=b2,T=b1}'],
    ['deck8', '7k/8/**6/p*6/P*6/**6/8/4K3[STUV] w - - 0 1 {w|5.6.7.8.20,S=w1,T=w2,U=w3,V=w4}'],
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
  for (const [v, fx] of fixtures) { const sb = new ffish.Board(v, fx); sweep(sb, 2); sb.delete(); }
  ok(`check-flag sweep: ${checked} moves, SAN check suffix == push+isCheck`, bad === 0, `${bad} mismatches`);

  console.log(`\ndeck/ffish: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
