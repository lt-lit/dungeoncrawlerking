// THE ICE GATE, engine half — engine/patches/ice.patch (brief §4.9): the wasm
// engine on the hand-verified fixtures the ffish gate and the native build
// ran — perft 1 move sets, perft 3 totals pinned to the native build's (the
// two binaries are one patch set), the boards after the key moves through
// `d`, the cast, the pit, the shove-check, a search that shoves the enemy king
// into a pit, and a duel-shaped 10x10 search on an iced board that completes
// alive.
//   ENGINE_JS=/path/to/patched/stockfish.js node engine/tests/test-ice-engine.cjs
const ENGINE_JS = process.env.ENGINE_JS; if (!ENGINE_JS) { console.error('set ENGINE_JS=/path/to/patched/stockfish.js'); process.exit(2); }
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
const saved = global.fetch; global.fetch = undefined;
const Stockfish = require(ENGINE_JS);
Stockfish().then(async (sf) => {
  global.fetch = saved;
  let pass = 0, fail = 0;
  const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
  const lines = []; sf.addMessageListener((l) => lines.push(l));
  const send = (c) => sf.postMessage(c);
  const until = (pred, ms = 120000) => new Promise((res, rej) => {
    const s = lines.length; const t = setInterval(() => {
      for (let i = s; i < lines.length; i++) if (pred(lines[i])) { clearInterval(t); clearTimeout(k); return res(lines.slice(s)); }
    }, 20); const k = setTimeout(() => { clearInterval(t); rej(new Error('timeout: ' + lines.slice(-6).join(' | '))); }, ms);
  });
  const ready = async () => { send('isready'); await until((l) => l === 'readyok'); };
  const display = async (fen, moves = []) => {
    send('position fen ' + fen + (moves.length ? ' moves ' + moves.join(' ') : ''));
    send('d'); const out = await until((l) => l.startsWith('Checkers:'));
    return { fen: out.find((l) => l.startsWith('Fen:')).slice(4).trim(), checkers: out.find((l) => l.startsWith('Checkers:')).slice('Checkers:'.length).trim() };
  };
  const board = (f) => f.split(' ')[0].split('[')[0];
  const field = (f) => (f.match(/\{[^}]*\}/) || [''])[0];
  const perft = async (fen, n, moves = []) => {
    send('position fen ' + fen + (moves.length ? ' moves ' + moves.join(' ') : ''));
    send('go perft ' + n); const out = await until((l) => l.startsWith('Nodes searched'), 600000);
    const mv = {}; for (const l of out) { const m = l.match(/^(\S+): (\d+)$/); if (m) mv[m[1]] = +m[2]; }
    return { total: +out.find((l) => l.startsWith('Nodes searched')).split(':')[1].trim(), moves: mv };
  };
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

  send('uci'); await until((l) => l === 'uciok');
  send('setoption name Use NNUE value false');
  send('setoption name Threads value 1');
  sf.FS.writeFile('/variants.ini', INI);
  send('setoption name VariantPath value /variants.ini');
  await ready();
  send('setoption name UCI_Variant value ice8');
  await ready();

  // Fixtures: [name, fen, perft 1, perft 3 (the native build's), exact move set or null, must-have, must-not]
  const F = [
    ['I1 the slide', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', 11, 981, ['a1a2', 'a1a6', 'a1a7', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'], 'a1a6', 'a1a3'],
    ['I2 the shove', '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', 11, 1486, ['a1a2', 'a1a4', 'a1a5', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'], 'a1a4', 'a1a3'],
    ['I3 the king slides', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~e2,~e3,~e4}', 14, 1440, null, 'e1e2', null],
    ['I3 the pit ahead of the king', '4k3/p7/8/4_3/8/8/8/R3K3[] w - - 0 1 {~e2,~e3,~e4}', 13, 1228, null, 'e1d2', 'e1e2'],
    ['I3 the enemy king shoved into a pit', '8/p7/8/8/8/8/8/R3K1k_[] w - - 0 1 {~f1,~g1}', 13, 551, null, 'e1f1', null],
    ['I4 the chain into the king', '4k3/p7/8/8/8/8/8/RnnnK3[] w - - 0 1 {~b1,~c1,~d1}', 9, 1787, ['a1a2', 'a1a3', 'a1a4', 'a1a5', 'a1a6', 'a1a7', 'a1b1', 'e1d1', 'e1f1'], 'a1b1', null],
    ['I4 the chain with a gap', '4k3/p7/8/8/8/8/8/R1nn1K2[] w - - 0 1 {~b1,~c1,~d1,~e1}', 11, 2023, null, 'a1b1', null],
    ['I5 the pawn slides', '4k3/p7/8/8/8/8/3P4/4K3[] w - - 0 1 {~d3,~d4}', 6, 320, null, 'd2d4', null],
    ['I5 the pawn promotes where it stops', '1k6/p7/8/8/3P4/8/8/4K3[] w - - 0 1 {~d5,~d6,~d7}', 13, 764, ['d4d5b', 'd4d5n', 'd4d5q', 'd4d5r', 'd4d6b', 'd4d6n', 'd4d6q', 'd4d6r', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'], 'd4d5q', 'd4d5'],
    ['I5 the long slide to promotion', '7r/8/8/8/8/8/1P1R4/K5k1[] w - - 0 1 {~b3,~b4,~b5,~b6,~b7}', 22, 7435, null, 'b2b3q', 'b2b3'],
    ['I6 the shoved pawn', '1R6/p3k3/8/8/8/8/1p5K/8[] w - - 0 1 {~b3,~b2}', 18, 3402, null, 'b8b3', null],
    ['I7 the rook into the pit', '4k3/p7/8/8/_7/8/8/R3K3[] w - - 0 1 {~a2,~a3}', 9, 742, null, 'a1a3', 'a1a2'],
    ['I7 the knight shoved into the pit', '4k3/p7/8/8/_7/n7/8/R3K3[] w - - 0 1 {~a2,~a3}', 10, 1195, null, 'a1a2', null],
    ['I8 the slide into a portal', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4,~h6,~h7}', 10, 946, ['a1a2', 'a1a5', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'], 'a1a5', 'a1a3'],
    ['I8 the king through a portal', '4k3/p7/8/8/8/8/8/R2K4[] w - - 0 1 {d5-h7,~d2,~d3,~d4,~h6,~h7}', 13, 1292, null, 'd1d2', null],
    ['I8 a piece on a portal square', '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4}', 11, 1468, null, 'a1a4', 'a1a3'],
    ['I9 the casts', '4k3/p7/8/8/8/8/8/R3K3[IOOioo] w - - 0 1', 77, 48633, null, 'I@e4', 'I@e3'],
    ['I9 a cast under a piece', '4k3/p7/8/8/3n4/8/8/R3K3[IOOioo] w - - 0 1', 75, 59174, null, 'I@d4', null],
    ['I9 a wall in the patch', '4k3/p7/8/8/3*4/8/8/R3K3[IOOioo] w - - 0 1', 75, 44233, null, 'I@d5', 'I@d4'],
    ['I9 no cast in check', '4k3/p7/8/8/8/8/8/r3K2R[IOOioo] w - - 0 1', 3, 7859, ['e1d2', 'e1e2', 'e1f2'], 'e1d2', 'I@e4'],
    ['I10 the knight lands', '4k3/p7/8/8/8/8/8/N3K3[] w - - 0 1 {~b3,~c2,~c3,~c4}', 7, 454, null, 'a1b3', null],
    ['I11 evasions by a slide', '4k3/p7/8/8/8/1R6/8/K6r[] w - - 0 1 {~b2,~b1}', 3, 704, ['a1a2', 'a1b2', 'b3b1'], 'b3b1', 'b3b2'],
    ['I11 check by a shove', '8/p7/8/8/8/4B3/R7/KR1nk3[] w - - 0 1 {~c1,~d1,~e1,~f1}', 32, 2985, null, 'b1c1', null],
    ['I11 a shield may not slide off', 'k7/p7/8/8/8/8/8/K2R3r[] w - - 0 1 {~d2,~d3}', 9, 1481, null, 'd1e1', 'd1d2'],
    ['I12 en passant onto ice', '4k3/8/8/2pP4/8/8/8/4K3[] w - c6 0 1 {~c6,~b7}', 11, 379, null, 'd5c6q', 'd5c6'],
    ['I13 a pawn shoves the king', '4r3/p7/8/8/4k3/8/4P3/4K3[] w - - 0 1 {~e3,~e4}', 5, 494, null, 'e2e3', null],
  ];
  for (const [name, fen, n1, n3, exact, must, mustNot] of F) {
    const p1 = await perft(fen, 1);
    const ms = Object.keys(p1.moves);
    let good = p1.total === n1 && (!exact || same(ms, exact)) && (!must || ms.includes(must)) && (!mustNot || !ms.includes(mustNot));
    ok(`${name}: perft 1 = ${n1}${exact ? ', the exact set' : ''}`, good, `${p1.total} ${ms.sort().join(',')}`);
    const p3 = await perft(fen, 3);
    ok(`${name}: perft 3 = ${n3} (the native build's)`, p3.total === n3, String(p3.total));
  }

  // The boards after the key moves, through `d`
  const B = [
    ['I2 a1a4: the rook stops on a4, the knight shoved to a6', '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', 'a1a4', '4k3/p7/n7/8/R7/8/8/4K3'],
    ['I2 a1a5: the capture, then the slide on to a6', '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}', 'a1a5', '4k3/p7/R7/8/8/8/8/4K3'],
    ['I3 e1e2: the king slides to e5', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~e2,~e3,~e4}', 'e1e2', '4k3/p7/8/4K3/8/8/8/R7'],
    ['I3 e1f1: the enemy king falls, gone', '8/p7/8/8/8/8/8/R3K1k_[] w - - 0 1 {~f1,~g1}', 'e1f1', '8/p7/8/8/8/8/8/R4K1_'],
    ['I4 a1b1: the chain into the king moves nobody', '4k3/p7/8/8/8/8/8/RnnnK3[] w - - 0 1 {~b1,~c1,~d1}', 'a1b1', '4k3/p7/8/8/8/8/8/1RnnK3'],
    ['I4 a1b1 with a gap: d1 slides to e1', '4k3/p7/8/8/8/8/8/R1nn1K2[] w - - 0 1 {~b1,~c1,~d1,~e1}', 'a1b1', '4k3/p7/8/8/8/8/8/1Rn1nK2'],
    ['I5 d4d5q: a queen on d8', '1k6/p7/8/8/3P4/8/8/4K3[] w - - 0 1 {~d5,~d6,~d7}', 'd4d5q', '1k1Q4/p7/8/8/8/8/8/4K3'],
    ['I6 b8b3: the shoved pawn is a queen on b1', '1R6/p3k3/8/8/8/8/1p5K/8[] w - - 0 1 {~b3,~b2}', 'b8b3', '8/p3k3/8/8/8/1R6/7K/1q6'],
    ['I7 a1a3: the rook is gone', '4k3/p7/8/8/_7/8/8/R3K3[] w - - 0 1 {~a2,~a3}', 'a1a3', '4k3/p7/8/8/_7/8/8/4K3'],
    ['I8 a1a5: through the portal, at rest on iced h7', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a5-h7,~a3,~a4,~h6,~h7}', 'a1a5', '4k3/p6R/8/8/8/8/8/4K3'],
    ['I8 d1d2: the king through the portal', '4k3/p7/8/8/8/8/8/R2K4[] w - - 0 1 {d5-h7,~d2,~d3,~d4,~h6,~h7}', 'd1d2', '4k3/p6K/8/8/8/8/8/R7'],
    ['I11 b1c1: the king shoved into the bishop\'s line', '8/p7/8/8/8/4B3/R7/KR1nk3[] w - - 0 1 {~c1,~d1,~e1,~f1}', 'b1c1', '8/p7/8/8/8/4B3/R7/K1Rn2k1'],
    ['I12 d5c6q: en passant, the slide to a8, the queen', '4k3/8/8/2pP4/8/8/8/4K3[] w - c6 0 1 {~c6,~b7}', 'd5c6q', 'Q3k3/8/8/8/8/8/8/4K3'],
    ['I13 e2e3: the pawn shoves the king to e5', '4r3/p7/8/8/4k3/8/4P3/4K3[] w - - 0 1 {~e3,~e4}', 'e2e3', '4r3/p7/8/4k3/8/4P3/8/4K3'],
  ];
  for (const [name, fen, mv, want] of B) {
    const d = await display(fen, [mv]);
    ok(name, board(d.fen) === want, d.fen);
  }
  let d = await display('8/p7/8/8/8/4B3/R7/KR1nk3[] w - - 0 1 {~c1,~d1,~e1,~f1}', ['b1c1']);
  ok('I11 b1c1 gives check (the bishop on g1)', d.checkers === 'e3', d.checkers);
  d = await display('4k3/p7/8/8/8/8/8/R3K3[IOOioo] w - - 0 1', ['I@e4']);
  ok('I9 I@e4: the 3x3 iced, the scroll spent', field(d.fen) === '{~d3,~e3,~f3,~d4,~e4,~f4,~d5,~e5,~f5}' && d.fen.includes('[OOioo]'), d.fen);
  d = await display('4k3/p7/8/8/3*4/8/8/R3K3[IOOioo] w - - 0 1', ['I@d5']);
  ok('I9 I@d5 beside a wall: eight squares iced', field(d.fen) === '{~c4,~e4,~c5,~d5,~e5,~c6,~d6,~e6}', d.fen);
  d = await display('4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {~a3,~a4,~a5}');
  ok('the ice field round-trips through the engine', d.fen.endsWith('{~a3,~a4,~a5}'), d.fen);
  d = await display('4k3/p7/8/8/_7/8/8/R3K3[] w - - 0 1 {~a2,~a3}');
  ok('the pit round-trips through the engine', board(d.fen) === '4k3/p7/8/8/_7/8/8/R3K3', d.fen);

  // Searches: the shove into the pit or the strip win on the spot; the shove-mate
  send('position fen 8/p7/8/8/8/8/8/R3K1k_[] w - - 0 1 {~f1,~g1}');
  send('go depth 6'); let out = await until((l) => l.startsWith('bestmove'));
  let bm = out.find((l) => l.startsWith('bestmove'));
  ok('search: white wins on the spot — the shove into the pit (e1f1) or the strip (a1a7)', /^bestmove (e1f1|a1a7)/.test(bm), bm);
  send('position fen 8/pp6/8/8/8/8/8/R3K1k_[] w - - 0 1 {~f1,~g1}');
  send('go depth 6'); out = await until((l) => l.startsWith('bestmove'));
  bm = out.find((l) => l.startsWith('bestmove'));
  ok('search: with two black pawns no strip is on, so the shove into the pit (e1f1) is the one win', /^bestmove e1f1/.test(bm), bm);
  const fallen = await perft('8/pp6/8/8/8/8/8/R3K1k_[] w - - 0 1 {~f1,~g1}', 1, ['e1f1']);
  ok('...black has no move after it', fallen.total === 0, String(fallen.total));

  // A duel-shaped 10x10 position with both scrolls, a pair and a patch: perft pinned, a production-limit search completes alive
  send('setoption name UCI_Variant value ice10');
  await ready();
  const duel = '1r2k1r3/1pppppp3/10/10/10/10/10/10/1PPPPPP3/1R2K1R3[IOOioo] w - - 0 1 {d4-g7,~d5,~e5,~f5,~d6,~e6,~f6}';
  const p1 = await perft(duel, 1);
  ok('10x10 duel shape: perft 1 = 107 (the native build\'s)', p1.total === 107, String(p1.total));
  const pd = await perft(duel, 2);
  ok('10x10 duel shape: perft 2 = 4453 (the native build\'s)', pd.total === 4453, String(pd.total));
  send('position fen ' + duel);
  send('go depth 12 movetime 4000'); out = await until((l) => l.startsWith('bestmove'), 60000);
  bm = out.find((l) => l.startsWith('bestmove'));
  ok('10x10 duel shape: depth-12 search answers', /^bestmove \S+/.test(bm) && bm !== 'bestmove (none)', bm);
  const floor = 'rnbqkbnr2/pppppppp2/10/10/10/10/10/10/PPPPPPPP2/RNBQKBNR2[IOOioo] w - - 0 1 {~a3,~b3,~c3,~d3,~e3,~f3,~g3,~h3,~i3,~j3,~a4,~b4,~c4,~d4,~e4,~f4,~g4,~h4,~i4,~j4,~a5,~b5,~c5,~d5,~e5,~f5,~g5,~h5,~i5,~j5,~a6,~b6,~c6,~d6,~e6,~f6,~g6,~h6,~i6,~j6,~a7,~b7,~c7,~d7,~e7,~f7,~g7,~h7,~i7,~j7,~a8,~b8,~c8,~d8,~e8,~f8,~g8,~h8,~i8,~j8}';
  send('position fen ' + floor);
  send('go depth 12 movetime 4000'); out = await until((l) => l.startsWith('bestmove'), 60000);
  bm = out.find((l) => l.startsWith('bestmove'));
  ok('an ice floor: depth-12 search answers', /^bestmove \S+/.test(bm) && bm !== 'bestmove (none)', bm);
  await ready();
  ok('engine alive after the searches', true);

  console.log(`\nice/engine: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
