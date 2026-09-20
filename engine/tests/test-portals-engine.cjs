// THE PORTAL GATE, engine half — PORTALS v4 (engine/patches/portals.patch +
// portals-body.patch + portals-cast.patch): the wasm engine on the same
// hand-verified fixtures the ffish gate and the native build ran — perft 1
// move sets, perft 3 totals pinned to the native build's (the two binaries are
// one patch set), the boards after the key moves through `d`, no check and no
// self-check through a pair (v2's tunnel is retired), the strip rule at the
// root, a search that takes a queen standing on a portal square, and a
// duel-shaped 10x10 search that completes alive. PORTALS v3: the one-turn cast
// — an open half freezes the other side (its one move is a pass) and binds its
// caster to the link; a pass fizzles a half no link can close.
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
    ['F1 the body', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 11, 1155, ['a1a2', 'a1a3', 'a1a4', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'], 'a1a4', 'a1h6'],
    ['F2 plugged exit', '4k3/p7/8/7n/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 11, 1762, null, 'a1a4', 'a1h6'],
    ['F3 plugged entry', '4k3/p7/8/8/n7/8/8/R3K3[] w - - 0 1 {a4-h5}', 11, 1676, null, 'a1a4', 'a1h6'],
    ['F4 no check through the pair', '8/6bk/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', 13, 1581, ['g7a1', 'g7b2', 'g7c3', 'g7d4', 'g7e5', 'g7f6', 'g7f8', 'g7h6', 'g7h8', 'h7g6', 'h7g8', 'h7h6', 'h7h8'], 'h7h6', null],
    ['F4b no pin through the pair', '7k/8/7b/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', 10, 1024, ['h6c1', 'h6d2', 'h6e3', 'h6f4', 'h6f8', 'h6g5', 'h6g7', 'h8g7', 'h8g8', 'h8h7'], 'h6g5', null],
    ['F5 no discovered check through the pair', '7k/1p6/7B/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 18, 1562, null, 'h6g5', 'a1h6'],
    ['F6 the body stops both rooks', 'r7/7k/8/8/8/8/8/R3K3[] b - - 0 1 {a4-h5}', 16, 2570, null, 'a8a4', 'a8a1'],
    ['F7 two pairs, no chain', '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-c6,c7-f2}', 10, 917, ['a1a2', 'a1a3', 'a1b1', 'a1c1', 'a1d1', 'e1d1', 'e1d2', 'e1e2', 'e1f1', 'e1f2'], 'e1f2', 'a1f8'],
    ['F8 two pairs on one file', '7k/p7/8/8/8/8/8/R3K3[] w - - 0 1 {a3-e5,e6-e3}', 10, 720, null, 'a1a3', 'a1a4'],
    ['F9a double step blocked', '4k3/7p/8/8/8/8/P7/4K3[] w - - 0 1 {a3-d5}', 6, 321, null, 'a2a3', 'a2a4'],
    ['F9b double step onto the portal', '4k3/7p/8/8/8/8/P7/4K3[] w - - 0 1 {a4-d5}', 7, 398, null, 'a2a4', null],
    ['F10a the link ply, no check through the new pair', '8/1p5k/8/8/8/8/8/R3K3[OO] w - - 0 1 {a4w}', 45, 17173, null, 'O@h5', 'a1a2'],
    ['F10b every link legal (no self-exposure through a pair)', 'r2k4/8/8/8/7K/8/8/1R6[OO] w - - 0 1 {a5w}', 46, 28018, null, 'O@h6', 'b1b2'],
    ['F11 twin to twin', '4k3/3p4/5n2/8/8/2B5/3P4/4K3[] w - - 0 1 {c3-f6}', 13, 1881, null, 'c3f6', null],
    ['F11b the pass, g7 gone', '4k3/3p4/8/8/8/2B5/3P4/4K3[] w - - 0 1 {c3-f6}', 13, 981, null, 'c3f6', 'c3g7'],
    ['F12 swap the king', 'r7/3p4/4k3/8/8/8/3P4/2R1K3[] w - - 0 1 {c3-e6}', 11, 3064, null, 'c1c3', 'c1c4'],
    ['F13 capture through, swap', '4k3/3p4/5b2/8/8/2n5/3P4/2R1K3[] w - - 0 1 {c3-f6}', 9, 2190, null, 'c1c3', 'c1c4'],
    ['F14 king refused onto an attacked exit, c3 fine', '4k3/p6r/8/8/8/8/1P1K4/R7[] w - - 0 1 {d3-g7}', 22, 5517, null, 'd2c3', 'd2d3'],
    ['F14b king through onto a safe exit', '4k2r/p7/8/8/8/8/1P1K4/R7[] w - - 0 1 {d3-g7}', 23, 6507, null, 'd2d3', null],
    ['F15 a pawn through a portal', '4k3/3p4/4P3/8/8/8/3P4/4K3[] w - - 0 1 {b3-e7}', 8, 369, null, 'e6e7', null],
    ['F16 no cast in check', '4k3/3p4/8/8/8/8/3P4/r3K3[OOoo] w - - 0 1', 2, 2070, null, null, 'O@c3'],
    ['F17 the casts', '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1', 52, 4248, null, 'O@c3', 'O@c1'],
    ['B1 the shield', '4k3/8/n7/8/8/8/8/R3K3[] w - - 0 1 {a4-h5}', 11, 1477, null, 'a1a4', 'a1a6'],
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
  ok('F1: a1a4 gives no check (nothing comes out of the twin at e8)', (await display(F[0][1], ['a1a4'])).checkers === '');
  ok('F2: a1a4 swaps with the knight', (await after(F[1][1], 'a1a4')) === '4k3/p7/8/7R/n7/8/8/4K3');
  ok('F3: a1a4 takes the knight and lands on h5', (await after(F[2][1], 'a1a4')) === '4k3/p7/8/7R/8/8/8/4K3');
  ok('F4: black does NOT stand in check (v2 read a check through the tunnel)', (await display(F[3][1])).checkers === '');
  ok('F5: h6g5 discovers nothing; h6g7 is the bishop\'s own direct check', (await display(F[5][1], ['h6g5'])).checkers === '' && (await display(F[5][1], ['h6g7'])).checkers !== '');
  ok('F5: a1a4 gives no check', (await display(F[5][1], ['a1a4'])).checkers === '');
  ok('F6: black does not stand in check; a8a4 puts the rook on h5', (await display(F[6][1])).checkers === '' && (await after(F[6][1], 'a8a4')) === '8/7k/8/7r/8/8/8/R3K3');
  ok('F7: a1a3 lands on c6, e1f2 on c7', (await after(F[7][1], 'a1a3')) === '4k3/p7/2R5/8/8/8/8/4K3' && (await after(F[7][1], 'e1f2')) === '4k3/p1K5/8/8/8/8/8/R7');
  ok('F8: a1a3 puts the rook on e5', (await after(F[8][1], 'a1a3')) === '7k/p7/8/4R3/8/8/8/4K3');
  const f9 = await display(F[10][1], ['a2a4']);
  ok('F9b: a2a4 lands on d5 with no en passant square', board(f9.fen) === '4k3/7p/8/3P4/8/8/8/4K3' && f9.fen.split(' ')[3] === '-', f9.fen);
  ok('F10a: O@h5 gives no check, black plays on with 7 moves', (await display(F[11][1], ['O@h5'])).checkers === '' && (await perft(F[11][1], 1, ['O@h5'])).total === 7);
  ok('F12: c1c3 gives check, 8 evasions incl. d7e6', (await display(F[15][1], ['c1c3'])).checkers !== '' && (await perft(F[15][1], 1, ['c1c3'])).total === 8 && 'd7e6' in (await perft(F[15][1], 1, ['c1c3'])).moves);
  ok('F13: knight gone, rook on f6, bishop on c3', (await after(F[16][1], 'c1c3')) === '4k3/3p4/5R2/8/8/2b5/3P4/4K3');
  ok('B1: a1a4 lands on h5 with the knight on a6 untouched', (await after(F[22][1], 'a1a4')) === '4k3/8/n7/7R/8/8/8/4K3');
  const cast = (await display(F[21][1], ['O@c3', 'e8e8', 'O@e5', 'O@f6', 'e1e1', 'O@a4'])).fen; // v3: half, the frozen pass, link — twice
  ok('F17: two one-turn casts close two pairs, hands empty', cast === '4k3/3p4/8/8/8/8/3P4/4K3[] w - - 0 4 {c3-e5,a4-f6}', cast);

  // V3 THE ONE-TURN CAST (2026-09-19, portals-cast.patch — portals-v3.patch until the tunnel's retirement): the frozen ply, the link ply, the fizzle
  const fenV3 = '4k3/3p4/8/8/8/8/3P4/4K3[OOoo] w - - 0 1';
  let pv3 = await perft(fenV3, 1, ['O@c4']);
  ok('V3: after the half the enemy is FROZEN — perft 1 is the pass e8e8 alone', pv3.total === 1 && 'e8e8' in pv3.moves, Object.keys(pv3.moves).join(','));
  let dv3 = await display(fenV3, ['O@c4', 'e8e8']);
  ok('V3: the pass leaves the half, white to move, no check', canon(dv3.fen) === '4k3/3p4/8/8/8/8/3P4/4K3[Ooo] w - - 1 2 {c4w}' && dv3.checkers === '', dv3.fen);
  pv3 = await perft(fenV3, 1, ['O@c4', 'e8e8']);
  ok('V3: the link ply — 45 linking casts, no piece move, no pass', pv3.total === 45 && Object.keys(pv3.moves).every((m) => m.startsWith('O@')) && !('O@c4' in pv3.moves), `${pv3.total} ${Object.keys(pv3.moves).filter((m) => !m.startsWith('O@')).join(',')}`);
  dv3 = await display(fenV3, ['O@c4', 'e8e8', 'O@f5']);
  ok('V3: the link closes the pair, black to move unfrozen', canon(dv3.fen) === '4k3/3p4/8/8/8/8/3P4/4K3[oo] b - - 0 2 {c4-f5}', dv3.fen);
  pv3 = await perft(fenV3, 1, ['O@c4', 'e8e8', 'O@f5']);
  ok('V3: black then has 50 moves — 6 of its pieces and 44 opening casts, no pass', pv3.total === 50 && !('e8e8' in pv3.moves), String(pv3.total));
  send('position fen ' + fenV3 + ' moves O@c4'); send('go depth 6'); let outV3 = await until((l) => l.startsWith('bestmove'));
  ok('V3: the frozen side searches to the pass', outV3.find((l) => l.startsWith('bestmove')).startsWith('bestmove e8e8'), outV3.find((l) => l.startsWith('bestmove')));
  send('position fen ' + fenV3 + ' moves O@c4 e8e8'); send('go depth 6'); outV3 = await until((l) => l.startsWith('bestmove'));
  ok('V3: the caster searches to a link', /^bestmove O@/.test(outV3.find((l) => l.startsWith('bestmove'))), outV3.find((l) => l.startsWith('bestmove')));
  send('setoption name UCI_Variant value portal6'); await ready();
  const fenFz = '4rk/******/******/******/1*****/KN4[OO] w - - 0 1'; // ONE castable square on the whole board
  pv3 = await perft(fenFz, 1);
  ok('V3 fizzle: Ka2 and the one cast alone', same(Object.keys(pv3.moves), ['a1a2', 'O@a2']), Object.keys(pv3.moves).join(','));
  pv3 = await perft(fenFz, 1, ['O@a2', 'f6f6']);
  ok('V3 fizzle: no castable square is left — the fizzle a1a1 alone', same(Object.keys(pv3.moves), ['a1a1']), Object.keys(pv3.moves).join(','));
  dv3 = await display(fenFz, ['O@a2', 'f6f6', 'a1a1']);
  ok('V3 fizzle: the half is gone, the other scroll kept, black to move', dv3.fen === '4rk/******/******/******/1*****/KN4[O] b - - 2 2', dv3.fen);
  pv3 = await perft(fenFz, 1, ['O@a2', 'f6f6', 'a1a1']);
  ok('V3 fizzle: black plays on after two passes in a row — the rook along the sixth rank', same(Object.keys(pv3.moves), ['e6a6', 'e6b6', 'e6c6', 'e6d6']), Object.keys(pv3.moves).join(','));
  pv3 = await perft('5k/******/*r****/*1****/1*****/KN4[OO] w - - 0 1', 1, ['O@a2', 'f6f6']);
  ok('V3: v3\'s fizzle board links freely now — O@b3 is its one legal move (no tunnel to expose a1)', same(Object.keys(pv3.moves), ['O@b3']), Object.keys(pv3.moves).join(','));
  send('setoption name UCI_Variant value portal8'); await ready();

  // The strip rule at the root: a king with only scrolls has lost
  send('position fen 4k3/3p4/8/8/8/8/8/4K3[OOoo] w - - 0 1');
  send('go depth 1'); let out = await until((l) => l.startsWith('bestmove'));
  ok('strip: king + scrolls -> bestmove (none), mate 0', out.some((l) => l === 'bestmove (none)') && out.some((l) => l.includes('score mate 0')), out.slice(-2).join(' | '));

  // Search: a queen standing on a portal entry is taken there, the captor landing on the twin
  send('position fen 4k3/3p4/8/8/8/2q5/3P4/2R1K3 w - - 0 1 {c3-f6}');
  send('go depth 10'); out = await until((l) => l.startsWith('bestmove'));
  let bml = out.find((l) => l.startsWith('bestmove')); ok('search: the queen on the portal square is taken — by the rook (c1c3) or the pawn (d2c3), the captor landing on f6', /^bestmove (c1c3|d2c3)/.test(bml), bml);
  const taken = await display('4k3/3p4/8/8/8/2q5/3P4/2R1K3 w - - 0 1 {c3-f6}', [bml.split(' ')[1]]);
  ok('search: after it the queen is gone and the captor stands on f6', !board(taken.fen).includes('q') && ['5R2', '5P2'].includes(board(taken.fen).split('/')[2]), taken.fen);

  // A duel-shaped 10x10 position with scrolls in hand and one pair: perft pinned, a production-limit search completes alive
  send('setoption name UCI_Variant value portal10');
  await ready();
  const duel = '1r2k1r3/1pppppp3/10/10/10/10/10/10/1PPPPPP3/1R2K1R3[OOoo] w - - 0 1 {d4-g7}';
  const pd = await perft(duel, 2);
  ok('10x10 duel shape: perft 2 = 1893 (the native build\'s)', pd.total === 1893, String(pd.total));
  send('position fen ' + duel);
  send('go depth 12 movetime 4000'); out = await until((l) => l.startsWith('bestmove'), 60000);
  const bm = out.find((l) => l.startsWith('bestmove'));
  ok('10x10 duel shape: depth-12 search answers', /^bestmove \S+/.test(bm) && bm !== 'bestmove (none)', bm);
  await ready();
  ok('engine alive after the search', true);

  console.log(`\nportals/engine: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
