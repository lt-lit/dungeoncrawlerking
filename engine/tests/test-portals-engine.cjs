// THE PORTAL GATE, engine half — PORTALS v2 (engine/patches/portals.patch +
// portals-v2.patch): the wasm engine on the same hand-verified fixtures the
// ffish gate and the native build ran — perft 1 move sets, perft 3 totals
// pinned to the native build's (the two binaries are one patch), the boards
// after the key moves through `d`, a cast that gives check through the new
// tunnel and one refused as a self-check, the strip rule at the root, a
// search that takes a queen through a portal, and a duel-shaped 10x10 search
// that completes alive.
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
  const display = async (fen, moves = []) => {
    send('position fen ' + fen + (moves.length ? ' moves ' + moves.join(' ') : ''));
    send('d'); const out = await until((l) => l.startsWith('Checkers:'));
    return { fen: out.find((l) => l.startsWith('Fen:')).slice(4).trim(), checkers: out.find((l) => l.startsWith('Checkers:')).slice('Checkers:'.length).trim() };
  };
  const board = (f) => f.split(' ')[0].split('[')[0];
  // The engine writes the portal field in bitboard order (each pair lower square first, pairs by their lower square); compare canonically
  const canon = (f) => f.replace(/\{([^}]*)\}/, (_, body) => {
    const idx = (sq) => (parseInt(sq.slice(1), 10) - 1) * 16 + (sq.charCodeAt(0) - 97);
    const parts = body.split(',').map((e) => (e.includes('-') ? e.split('-').sort((a, b) => idx(a) - idx(b)).join('-') : e));
    return '{' + parts.sort((a, b) => idx(a.split('-')[0].replace(/[wb]$/, '')) - idx(b.split('-')[0].replace(/[wb]$/, ''))).join(',') + '}';
  });
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
  send('setoption name UCI_Variant value portal8');
  await ready();

  // Fixtures: [name, fen, perft 1, perft 3 (the native build's), exact move set or null, must-have, must-not]
  const F = [
    ['F1 body + tunnel', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 14, 1554, ['a1a2', 'a1a3', 'a1a4', 'a1h6', 'a1h7', 'a1h8', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'], 'a1h8', 'a1a5'],
    ['F2 plugged exit', '4k3/p7/8/7n/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 11, 1837, null, 'a1a4', 'a1h6'],
    ['F3 plugged entry', '4k3/p7/8/8/n7/8/8/R3K3[] w - - 0 1 {a4-h5}', 11, 1751, null, 'a1a4', 'a1h6'],
    ['F4 check through the tunnel', '8/6bk/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', 4, 400, ['h7g6', 'h7g8', 'g7h6', 'g7a1'], 'g7h6', 'h7h6'],
    ['F4b pinned through the tunnel', '7k/8/7b/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', 3, 301, ['h8g8', 'h8g7', 'h8h7'], 'h8h7', 'h6g5'],
    ['F5 discovered check through the tunnel', '7k/1p6/7B/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 18, 1235, null, 'h6g5', 'a1h6'],
    ['F6 stepping into the tunnel', 'r7/7k/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', 4, 847, ['h7g6', 'h7g7', 'h7g8', 'a8a4'], 'a8a4', 'a8a1'],
    ['F7 the chain', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}', 17, 1555, null, 'a1f8', 'a1c8'],
    ['F8 the cycle cap', '7k/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-e5,e6-e3}', 13, 1096, null, 'a1e5', 'a1a4'],
    ['F9a double step blocked', '4k3/7p/8/8/8/8/P7/4K3[] w - - 0 1 {a3-d5}', 6, 321, null, 'a2a3', 'a2a4'],
    ['F9b double step onto the portal', '4k3/7p/8/8/8/8/P7/4K3[] w - - 0 1 {a4-d5}', 7, 398, null, 'a2a4', null],
    ['F10a cast gives check', '8/1p5k/8/8/8/8/8/R3K3[OO] w - - 0 1 {a4w}', 60, 22390, null, 'O@h5', null],
    ['F10b self-exposing cast refused', 'r2k4/8/8/8/7K/8/8/1R6[OO] w - - 0 1 {a5w}', 62, 47273, null, 'O@c3', 'O@h6'],
    ['F11 twin to twin', '4k3/3p4/5n2/8/8/2B5/3P4/4K3[] w - - 0 1 {c3-f6}', 13, 1929, null, 'c3f6', null],
    ['F11b the pass, g7 gone', '4k3/3p4/8/8/8/2B5/3P4/4K3[] w - - 0 1 {c3-f6}', 13, 1023, null, 'c3f6', 'c3g7'],
    ['F12 swap the king', 'r7/3p4/4k3/8/8/8/3P4/2R1K3[] w - - 0 1 {c3-e6}', 11, 3053, null, 'c1c3', 'c1c4'],
    ['F13 capture through, swap', '4k3/3p4/5b2/8/8/2n5/3P4/2R1K3[] w - - 0 1 {c3-f6}', 9, 2190, null, 'c1c3', 'c1c4'],
    ['F14 king refused onto an attacked exit', '4k3/p6r/8/8/8/8/1P1K4/R7[] w - - 0 1 {d3-g7}', 21, 6268, null, null, 'd2d3'],
    ['F14b king through onto a safe exit', '4k2r/p7/8/8/8/8/1P1K4/R7[] w - - 0 1 {d3-g7}', 23, 6318, null, 'd2d3', null],
    ['F15 a pawn through a portal', '4k3/3p4/4P3/8/8/8/3P4/4K3[] w - - 0 1 {b3-e7}', 8, 369, null, 'e6e7', null],
    ['F16 no cast in check', '4k3/3p4/8/8/8/8/3P4/r3K3[OOoo] w - - 0 1', 2, 6525, null, null, 'O@c3'],
    ['F17 the casts', '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1', 52, 133729, null, 'O@c3', 'O@c1'],
  ];
  for (const [name, fen, n1, n3, exact, yes, no] of F) {
    const d = await display(fen);
    ok(`${name}: FEN round-trips`, canon(d.fen) === canon(fen), d.fen);
    const p = await perft(fen, 1);
    ok(`${name}: perft 1 = ${n1}`, p.total === n1, `${p.total} ${Object.keys(p.moves).sort().join(',')}`);
    if (exact) ok(`${name}: the exact move set`, same(Object.keys(p.moves), exact), Object.keys(p.moves).sort().join(','));
    if (yes) ok(`${name}: ${yes} offered`, yes in p.moves);
    if (no) ok(`${name}: ${no} not offered`, !(no in p.moves));
    const p3 = await perft(fen, 3);
    ok(`${name}: perft 3 = ${n3} (the native build's)`, p3.total === n3, String(p3.total));
  }

  // The boards after the key moves, and the checks
  const after = async (fen, mv) => board((await display(fen, [mv])).fen);
  ok('F1: a1a4 lands on h5', (await after(F[0][1], 'a1a4')) === '4k3/p7/8/7R/8/8/8/4K3');
  ok('F1: a1h6 leaves the rook on h6', (await after(F[0][1], 'a1h6')) === '4k3/p7/7R/8/8/8/8/4K3');
  ok('F1: a1h8 gives check through the tunnel', (await display(F[0][1], ['a1h8'])).checkers !== '');
  ok('F2: a1a4 swaps with the knight', (await after(F[1][1], 'a1a4')) === '4k3/p7/8/7R/n7/8/8/4K3');
  ok('F3: a1a4 takes the knight and lands on h5', (await after(F[2][1], 'a1a4')) === '4k3/p7/8/7R/8/8/8/4K3');
  ok('F4: black stands in check', (await display(F[3][1])).checkers !== '');
  ok('F5: h6g5 discovers the check', (await display(F[5][1], ['h6g5'])).checkers !== '');
  ok('F5: a1a4 gives no check', (await display(F[5][1], ['a1a4'])).checkers === '');
  ok('F6: a8a4 puts the rook on h5', (await after(F[6][1], 'a8a4')) === '8/7k/8/7r/8/8/8/R3K3');
  ok('F7: a1a3 lands on c6, a1c7 on f2, e1f2 on c7', (await after(F[7][1], 'a1a3')) === '4k3/p7/2R5/8/8/8/8/4K3' && (await after(F[7][1], 'a1c7')) === '4k3/p7/8/8/8/8/5R2/4K3' && (await after(F[7][1], 'e1f2')) === '4k3/p1K5/8/8/8/8/8/R7');
  ok('F8: a1e5 puts the rook on a3', (await after(F[8][1], 'a1e5')) === '7k/p7/8/8/8/R7/8/4K3');
  const f9 = await display(F[10][1], ['a2a4']);
  ok('F9b: a2a4 lands on d5 with no en passant square', board(f9.fen) === '4k3/7p/8/3P4/8/8/8/4K3' && f9.fen.split(' ')[3] === '-', f9.fen);
  ok('F10a: O@h5 gives check, black has the 3 king steps', (await display(F[11][1], ['O@h5'])).checkers !== '' && (await perft(F[11][1], 1, ['O@h5'])).total === 3);
  ok('F12: c1c3 gives check, 8 evasions incl. d7e6', (await display(F[15][1], ['c1c3'])).checkers !== '' && (await perft(F[15][1], 1, ['c1c3'])).total === 8 && 'd7e6' in (await perft(F[15][1], 1, ['c1c3'])).moves);
  ok('F13: knight gone, rook on f6, bishop on c3', (await after(F[16][1], 'c1c3')) === '4k3/3p4/5R2/8/8/2b5/3P4/4K3');
  const cast = (await display(F[21][1], ['O@c3', 'O@f6', 'O@e5', 'O@a4'])).fen;
  ok('F17: the four casts close two pairs, hands empty', cast === '4k3/3p4/8/8/8/8/3P4/4K3[] w - - 0 3 {c3-e5,a4-f6}', cast);

  // The strip rule at the root: a king with only scrolls has lost
  send('position fen 4k3/3p4/8/8/8/8/8/4K3[OOoo] w - - 0 1');
  send('go depth 1'); let out = await until((l) => l.startsWith('bestmove'));
  ok('strip: king + scrolls -> bestmove (none), mate 0', out.some((l) => l === 'bestmove (none)') && out.some((l) => l.includes('score mate 0')), out.slice(-2).join(' | '));

  // Search: a queen on a portal entry is taken through it; a rook aimed at an open tunnel finds the check through it
  send('position fen 4k3/3p4/8/8/8/2q5/3P4/2R1K3 w - - 0 1 {c3-f6}');
  send('go depth 10'); out = await until((l) => l.startsWith('bestmove'));
  let bml = out.find((l) => l.startsWith('bestmove')); ok('search: bestmove c1c3 takes the queen through the portal', bml.startsWith('bestmove c1c3'), bml);
  send('position fen 4k3/6q1/7p/8/8/8/8/R3K3[] w - - 0 1 {a3-g5}');
  send('go depth 8'); out = await until((l) => l.startsWith('bestmove'));
  bml = out.find((l) => l.startsWith('bestmove')); ok('search: the rook takes the queen through the tunnel (a1g7 via a3-g5)', bml.startsWith('bestmove a1g7'), bml);

  // A duel-shaped 10x10 position with scrolls in hand and one pair: perft pinned, a production-limit search completes alive
  send('setoption name UCI_Variant value portal10');
  await ready();
  const duel = '1r2k1r3/1pppppp3/10/10/10/10/10/10/1PPPPPP3/1R2K1R3[OOoo] w - - 0 1 {d4-g7}';
  const pd = await perft(duel, 2);
  ok('10x10 duel shape: perft 2 = 7503 (the native build\'s)', pd.total === 7503, String(pd.total));
  send('position fen ' + duel);
  send('go depth 12 movetime 4000'); out = await until((l) => l.startsWith('bestmove'), 60000);
  const bm = out.find((l) => l.startsWith('bestmove'));
  ok('10x10 duel shape: depth-12 search answers', /^bestmove \S+/.test(bm) && bm !== 'bestmove (none)', bm);
  await ready();
  ok('engine alive after the search', true);

  console.log(`\nportals/engine: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
