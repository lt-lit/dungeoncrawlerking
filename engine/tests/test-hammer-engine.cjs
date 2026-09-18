// THE SLEDGEHAMMER GATE, engine half (engine/patches/wall-kinds.patch +
// hammer.patch): the wasm engine on the hand-verified fixtures the ffish
// gate and the native debug build ran — perft counts, the hard wall through
// 'd', a # board equal to its * twin without the key, per-colour keys, a
// search on a 10x10 duel-shaped board with both kings hammering.
//   ENGINE_JS=/path/to/patched/stockfish.js node engine/tests/test-hammer-engine.cjs
const ENGINE_JS = process.env.ENGINE_JS; if (!ENGINE_JS) { console.error('set ENGINE_JS=/path/to/patched/stockfish.js'); process.exit(2); }
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
const INI = `[plain8:chess]\n${BASE}\n[hammer8:chess]\n${BASE}hammerPieceTypes = k\n\n[hammer8kr:hammer8]\nhammerPieceTypes = kr\n\n[hammer8w:hammer8]\nhammerPieceTypesWhite = k\nhammerPieceTypesBlack = -\n\n[hammer10:hammer8]\nmaxRank = 10\nmaxFile = 10\npromotionRegionWhite = *10\npromotionRegionBlack = *1\ndoubleStepRegionWhite = *2 *3 *4 *5 *6 *7 *8 *9\ndoubleStepRegionBlack = *9 *8 *7 *6 *5 *4 *3 *2\n`;
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
  const variant = async (v) => { send(`setoption name UCI_Variant value ${v}`); await ready(); };
  const dOf = async (fen, moves = []) => {
    send('position fen ' + fen + (moves.length ? ' moves ' + moves.join(' ') : ''));
    send('d'); const out = await until((l) => l.startsWith('Checkers:'));
    return { fen: out.find((l) => l.startsWith('Fen:')).slice(4).trim(), out };
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

  // H1
  await variant('hammer8');
  const H1 = '4k3/3p4/8/8/8/8/3P1*2/4K#2 w - - 0 1';
  let p = await perft(H1, 1);
  ok('H1: perft 1 = 5 with the hammer e1f2, none onto the hard f1', p.total === 5 && 'e1f2' in p.moves && !('e1f1' in p.moves), JSON.stringify(p.moves));
  let d = await dOf(H1);
  ok('H1: the FEN round-trips with # and *', d.fen === H1, d.fen);
  ok("H1: 'd' shows # and * apart", d.out.some((l) => l.includes('| #')) && d.out.some((l) => l.includes('| *')));
  d = await dOf(H1, ['e1f2']);
  ok('H1: after the hammer f2 is a crate, the king on e1, rule50 reset', d.fen === '4k3/3p4/8/8/8/8/3P1^2/4K#2 b - - 0 1', d.fen);
  ok('H1: the hammer gives no check', d.out.some((l) => l.trim() === 'Checkers:'));
  p = await perft(H1, 1, ['e1f2', 'e8d8']);
  ok('H1: white then captures the crate — 5 moves, e1f2 a capture, no hammer left', p.total === 5 && 'e1f2' in p.moves, JSON.stringify(p.moves));
  d = await dOf(H1, ['e1f2', 'e8d8', 'e1f2']);
  ok('H1: the crate is gone, the king on f2, f1 still hard', d.fen.startsWith('3k4/3p4/8/8/8/8/3P1K2/5#2 b'), d.fen);
  p = await perft(H1, 3); ok(`H1: perft 3 = 182 (the native debug gate's count) (${p.total})`, p.total === 182);
  p = await perft(H1, 4); ok(`H1: perft 4 = 1338 (${p.total})`, p.total === 1338);
  // H2
  p = await perft('4k3/8/8/8/8/8/3P1*2/r3K3 w - - 0 1', 1);
  ok('H2: in check only Ke2 — no hammer', p.total === 1 && 'e1e2' in p.moves, JSON.stringify(p.moves));
  // H3
  await variant('hammer8kr');
  const H3 = '4k3/8/8/8/4r3/8/4R*2/4K3 w - - 0 1';
  p = await perft(H3, 1);
  ok('H3: 7 moves — the pinned rook may hammer (e2f2), never leave the file', p.total === 7 && 'e1f2' in p.moves && 'e2f2' in p.moves && !('e2d2' in p.moves), JSON.stringify(p.moves));
  p = await perft(H3, 3); ok(`H3: perft 3 = 508 (${p.total})`, p.total === 508);
  p = await perft(H3, 4); ok(`H3: perft 4 = 6521 (${p.total})`, p.total === 6521);
  // H4/H5
  await variant('plain8');
  p = await perft(H1, 1); ok('H4: plain8 — 4 moves, no hammer', p.total === 4 && !('e1f2' in p.moves));
  const twinS = await perft('4k3/3p4/8/8/8/8/3P1*2/4K*2 w - - 0 1', 3);
  const twinH = await perft('4k3/3p4/8/8/8/8/3P1#2/4K#2 w - - 0 1', 3);
  ok(`H5: plain8 — a * board and its # twin agree at perft 3 (${twinS.total})`, twinS.total === twinH.total && twinS.total === 134, `${twinS.total} vs ${twinH.total}`);
  await variant('hammer8');
  const allHard = await perft('4k3/3p4/8/8/8/8/3P1#2/4K#2 w - - 0 1', 3);
  ok('H5: hammer8 on an all-# board equals the plain count (no hammer)', allHard.total === 134, String(allHard.total));
  // H6
  await variant('hammer8w');
  p = await perft('3*k3/3p4/8/8/8/8/3P4/4K*2 w - - 0 1', 1); ok('H6: white (a hammer king) has e1f1', 'e1f1' in p.moves);
  p = await perft('3*k3/3p4/8/8/8/8/3P4/4K*2 w - - 0 1', 1, ['e1e2']); ok('H6: black (no hammer) has no e8d8', !('e8d8' in p.moves), JSON.stringify(p.moves));
  await variant('hammer8');
  p = await perft('3*k3/3p4/8/8/8/8/3P4/4K*2 w - - 0 1', 1, ['e1e2']); ok('H6: under hammer8 black hammers d8', 'e8d8' in p.moves);
  // H7: a 10x10 duel-shaped board, both kings hammering, a search
  await variant('hammer10');
  const H7 = 'rnbqk*nbr1/ppppp*pppp/10/10/10/10/10/10/PPPPP*PPPP/RNBQK*NBR1 w - - 0 1';
  p = await perft(H7, 1); ok('H7: 10x10 — the king offers both hammers (f1, f2)', 'e1f1' in p.moves && 'e1f2' in p.moves);
  send('position fen ' + H7); send('go depth 10 movetime 8000');
  let out = await until((l) => l.startsWith('bestmove'), 60000);
  let bm = out[out.length - 1].split(' ')[1];
  ok(`H7: a depth-10 search returns a legal bestmove (${bm}) and the instance answers`, bm in p.moves); await ready();
  // H8: a boxed king whose quiet moves are hammers
  await variant('hammer8');
  const H8 = '4k3/3p4/8/8/8/8/*PP5/*K#5 w - - 0 1';
  p = await perft(H8, 1); ok('H8: a boxed king hammers a1 and a2, never the hard c1', 'b1a1' in p.moves && 'b1a2' in p.moves && !('b1c1' in p.moves), JSON.stringify(p.moves));
  send('position fen ' + H8); send('go depth 8');
  out = await until((l) => l.startsWith('bestmove'), 60000); bm = out[out.length - 1].split(' ')[1];
  ok(`H8: the search completes (${bm})`, bm in p.moves); await ready();
  p = await perft(H8, 3); ok(`H8: perft 3 = 241 (${p.total})`, p.total === 241);
  p = await perft(H8, 4); ok(`H8: perft 4 = 1853 (${p.total})`, p.total === 1853);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
});
