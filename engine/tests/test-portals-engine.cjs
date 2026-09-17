// THE PORTAL GATE, engine half (engine/patches/portals.patch): the wasm
// engine on the same hand-verified fixtures the ffish gate and the native
// debug build ran - perft counts, the trailing FEN field through 'd', the
// cast sequence, the strip rule at the root, and a search that takes a
// queen through a portal.
//   ENGINE_JS=/path/to/patched/stockfish.js node engine/tests/test-portals-engine.cjs
const ENGINE_JS = process.env.ENGINE_JS; if (!ENGINE_JS) { console.error('set ENGINE_JS=/path/to/patched/stockfish.js'); process.exit(2); }
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

[portal10:portal8]
maxRank = 10
maxFile = 10
promotionRegionWhite = *10
promotionRegionBlack = *1
doubleStepRegionWhite = *2 *3 *4 *5 *6 *7 *8 *9
doubleStepRegionBlack = *9 *8 *7 *6 *5 *4 *3 *2
dropRegionWhite = *2 *3 *4 *5 *6 *7 *8 *9
dropRegionBlack = *2 *3 *4 *5 *6 *7 *8 *9
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
  const fenOf = async (fen, moves = []) => {
    send('position fen ' + fen + (moves.length ? ' moves ' + moves.join(' ') : ''));
    send('d'); const out = await until((l) => l.startsWith('Checkers:'));
    return out.find((l) => l.startsWith('Fen:')).slice(4).trim();
  };
  const perft = async (fen, n, moves = []) => {
    send('position fen ' + fen + (moves.length ? ' moves ' + moves.join(' ') : ''));
    send('go perft ' + n); const out = await until((l) => l.startsWith('Nodes searched'));
    const mv = {}; for (const l of out) { const m = l.match(/^(\S+): (\d+)$/); if (m) mv[m[1]] = +m[2]; }
    return { total: +out.find((l) => l.startsWith('Nodes searched')).split(':')[1].trim(), moves: mv };
  };

  send('uci'); await until((l) => l === 'uciok');
  send('setoption name Use NNUE value false');
  send('setoption name Threads value 1');
  sf.FS.writeFile('/variants.ini', INI);
  send('setoption name VariantPath value /variants.ini');
  await ready();
  send('setoption name UCI_Variant value portal8');
  await ready();

  // Fixtures: FEN, expected perft 1, a move that must be offered, one that must not, perft 2
  const F = [
    ['F1 quiet teleport', 'r3k3/3p4/8/8/8/8/3P4/2R1K3 w - - 0 1 {c3-f6}', 16, 'c1c3', null],
    ['F2 capture through, swap', '4k3/3p4/5b2/8/8/2n5/3P4/2R1K3 w - - 0 1 {c3-f6}', 9, 'c1c3', 'c1c4'],
    ['F3 king into attack refused', '4k3/p6r/8/8/8/8/1P1K4/R7 w - - 0 1 {d3-g7}', 22, null, 'd2d3'],
    ['F3b king teleport', '4k2r/p7/8/8/8/8/1P1K4/R7 w - - 0 1 {d3-g7}', 23, 'd2d3', null],
    ['F4 swap the enemy king into check', 'r7/3p4/4k3/8/8/8/3P4/2R1K3 w - - 0 1 {c3-e6}', 16, 'c1c3', null],
    ['F5 twin-to-twin capture', '4k3/3p4/5n2/8/8/2B5/3P4/4K3 w - - 0 1 {c3-f6}', 13, 'c3f6', null],
    ['F5b twin-to-twin quiet', '4k3/3p4/8/8/8/2B5/3P4/4K3 w - - 0 1 {c3-f6}', 15, 'c3f6', null],
    ['F8 pawn through a portal', '4k3/3p4/4P3/8/8/8/3P4/4K3 w - - 0 1 {b3-e7}', 8, 'e6e7', null],
    ['F9 no cast in check', '4k3/3p4/8/8/8/8/3P4/r3K3[OOoo] w - - 0 1', 2, null, 'O@c3'],
    ['F7 casts', '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1', 52, 'O@c3', 'O@c1'],
  ];
  for (const [name, fen, n1, yes, no] of F) {
    const f = await fenOf(fen);
    ok(`${name}: FEN round-trips`, f.replace('[]', '') === fen.replace('[]', ''), f);
    const p = await perft(fen, 1);
    ok(`${name}: perft 1 = ${n1}`, p.total === n1, `${p.total} ${Object.keys(p.moves).sort().join(',')}`);
    if (yes) ok(`${name}: ${yes} offered`, yes in p.moves);
    if (no) ok(`${name}: ${no} not offered`, !(no in p.moves));
    const p3 = await perft(fen, 3);
    ok(`${name}: perft 3 completes (${p3.total})`, p3.total > 0);
  }
  // The positions after the key moves, and F4's evasion count
  ok('F1: the rook lands on f6', (await fenOf(F[0][1], ['c1c3'])).startsWith('r3k3/3p4/5R2/8/8/8/3P4/4K3'));
  ok('F2: rook on f6, bishop on c3, knight gone', (await fenOf(F[1][1], ['c1c3'])).startsWith('4k3/3p4/5R2/8/8/2b5/3P4/4K3'));
  ok('F4: 8 evasions incl. d7e6', (await perft(F[4][1], 1, ['c1c3'])).total === 8 && 'd7e6' in (await perft(F[4][1], 1, ['c1c3'])).moves);
  ok('F5: the bishop is back on c3, the knight gone', (await fenOf(F[5][1], ['c3f6'])).startsWith('4k3/3p4/8/8/8/2B5/3P4/4K3[] b'));
  const cast = await fenOf(F[9][1], ['O@c3', 'O@f6', 'O@e5', 'O@a4']);
  ok('F7: the four casts close two pairs, hands empty', cast === '4k3/3p4/8/8/8/8/3P4/4K3[] w - - 0 3 {c3-e5,a4-f6}', cast);
  const halfway = await fenOf(F[9][1], ['O@c3', 'O@f6', 'O@e5']);
  ok('F7: one pair and a black half', halfway === '4k3/3p4/8/8/8/8/3P4/4K3[o] b - - 0 2 {c3-e5,f6b}', halfway);
  const p2 = await perft(F[9][1], 1, ['O@c3', 'O@f6', 'O@e5']);
  ok('F7: black has 43 casts, none on c3/e5/f6', Object.keys(p2.moves).filter((m) => m.startsWith('O@')).length === 43 && !('O@c3' in p2.moves) && !('O@f6' in p2.moves));

  // The strip rule at the root: a king with only scrolls has lost
  send('position fen 4k3/3p4/8/8/8/8/8/4K3[OOoo] w - - 0 1');
  send('go depth 1'); let out = await until((l) => l.startsWith('bestmove'));
  ok('strip: king + scrolls -> bestmove (none), mate 0', out.some((l) => l === 'bestmove (none)') && out.some((l) => l.includes('score mate 0')), out.slice(-2).join(' | '));
  send('position fen 4k3/3p4/8/8/8/8/8/4K3[] w - - 0 1 {c3-f6}');
  send('go depth 1'); out = await until((l) => l.startsWith('bestmove'));
  ok('strip: king + a pair -> bestmove (none)', out.some((l) => l === 'bestmove (none)'), out.slice(-2).join(' | '));

  // Search: a queen on a portal entry is taken through it
  send('position fen 4k3/3p4/8/8/8/2q5/3P4/2R1K3 w - - 0 1 {c3-f6}');
  send('go depth 10'); out = await until((l) => l.startsWith('bestmove'));
  const bml = out.find((l) => l.startsWith('bestmove')); ok('search: bestmove c1c3 takes the queen through the portal', bml.startsWith('bestmove c1c3'), bml);

  // A duel-shaped 10x10 position with scrolls in hand and one pair: a production-limit search completes alive
  send('setoption name UCI_Variant value portal10');
  await ready();
  const duel = '1r2k1r3/1pppppp3/10/10/10/10/10/10/1PPPPPP3/1R2K1R3[OOoo] w - - 0 1 {d4-g7}';
  const pd = await perft(duel, 2);
  ok('10x10 duel shape: perft 2 completes', pd.total > 0, String(pd.total));
  send('position fen ' + duel);
  send('go depth 12 movetime 4000'); out = await until((l) => l.startsWith('bestmove'), 60000);
  const bm = out.find((l) => l.startsWith('bestmove'));
  ok('10x10 duel shape: depth-12 search answers', /^bestmove \S+/.test(bm) && bm !== 'bestmove (none)', bm);
  await ready();
  ok('engine alive after the search', true);

  console.log(`\nportals/engine: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
