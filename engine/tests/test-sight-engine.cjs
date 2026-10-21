// THE SIGHT WORD GATE, engine half — engine/patches/sight.patch (brief §4.10
// "3.4 RULED", the targeting ruling of 2026-10-21): the wasm engine on the
// hand-verified fixtures the forge's native gate ran
// (engine/forge/native-test-sight.py, every count derived by the independent
// Python oracle first) — perft 1 totals, perft 3 totals pinned to the native
// build's (the two binaries are one patch set), the boards after the key casts
// through `d` (a 3x3 stun through an anchor in sight, a hit on the wall at the
// end of a diagonal, a wall raised in sight, a control through sight that
// checks, a stun on a held piece), and the searches: the control cast with
// check found at once, a duel-shaped 10×10 search with sight decks that
// completes alive.
//   ENGINE_JS=/path/to/patched/stockfish.js node engine/tests/test-sight-engine.cjs
// The test variants are the forge's (engine/forge/states.ini: the sight cards
// 140-147), read from disk so the native and the wasm gates share one definition.
const fs = require('fs'), path = require('path');
const ENGINE_JS = process.env.ENGINE_JS; if (!ENGINE_JS) { console.error('set ENGINE_JS=/path/to/patched/stockfish.js'); process.exit(2); }
const INI = fs.readFileSync(path.join(__dirname, '..', 'forge', 'states.ini'), 'utf8');
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
  let variant = null;
  const setVariant = async (v) => { if (v !== variant) { send('setoption name UCI_Variant value ' + v); variant = v; await ready(); } };
  const pos = (fen, moves = []) => 'position fen ' + fen + (moves.length ? ' moves ' + moves.join(' ') : '');
  const display = async (fen, moves = []) => {
    send(pos(fen, moves));
    send('d'); const out = await until((l) => l.startsWith('Checkers:'));
    return { fen: out.find((l) => l.startsWith('Fen:')).slice(4).trim(), checkers: out.find((l) => l.startsWith('Checkers:')).slice('Checkers:'.length).trim() };
  };
  const perft = async (fen, n, moves = []) => {
    send(pos(fen, moves));
    send('go perft ' + n); const out = await until((l) => l.startsWith('Nodes searched'), 600000);
    const mv = {}; for (const l of out) { const m = l.match(/^(\S+): (\d+)$/); if (m) mv[m[1]] = +m[2]; }
    return { total: +out.find((l) => l.startsWith('Nodes searched')).split(':')[1].trim(), moves: mv };
  };
  const search = async (fen, go, moves = []) => {
    send('setoption name Clear Hash'); await ready();
    send(pos(fen, moves)); send(go);
    const out = await until((l) => l.startsWith('bestmove'), 300000);
    const infos = out.filter((l) => l.startsWith('info depth') && l.includes(' pv '));
    return { best: out.find((l) => l.startsWith('bestmove')), last: infos[infos.length - 1] || '', infos };
  };
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const field = (fen) => fen.includes('{') ? fen.slice(fen.indexOf('{')) : '';
  const casts = (p, slot = 'S') => Object.keys(p.moves).filter((m) => m.startsWith(slot + '@')).sort();

  send('uci'); await until((l) => l === 'uciok');
  send('setoption name Use NNUE value false');
  send('setoption name Threads value 1');
  sf.FS.writeFile('/variants.ini', INI);
  send('setoption name VariantPath value /variants.ini');
  await ready();
  await setVariant('states8');

  // THE PINS: perft 1 and perft 3 totals from the native release build (engine/forge/native-test-sight.py's fixtures)
  const PINS = [
    ['G1a', 'r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w140}', 17, 3182, ['S@a1', 'S@a8']],
    ['G1b', 'r3k3/8/8/8/P7/8/8/R3K3[S] w - - 0 1 {S=w140}', 15, 2717, ['S@a1', 'S@a4', 'S@a8']],
    ['G1c', 'r3k3/8/8/8/*7/8/8/R3K3[S] w - - 0 1 {S=w140}', 11, 1629, ['S@a1']],
    ['G1d', 'r3k3/8/8/8/p7/8/8/R3K3[S] w - - 0 1 {S=w140}', 13, 2388, ['S@a1', 'S@a4']],
    ['G1e', 'r3k3/8/8/8/^7/8/8/R3K3[S] w - - 0 1 {S=w140}', 12, 2081, ['S@a1']],
    ['G1f', 'r3k3/8/8/8/_7/8/8/R3K3[S] w - - 0 1 {S=w140}', 11, 1629, ['S@a1']],
    ['G1g', 'r3k3/8/8/8/#7/8/8/R3K3[S] w - - 0 1 {S=w140}', 11, 1629, ['S@a1']],
    ['G1h', 'r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w140,~a4}', 16, 2724, ['S@a1', 'S@a8']],
    ['G1i', 'r3k3/8/8/8/8/8/8/N3K3[S] w - - 0 1 {S=w140}', 9, 1061, ['S@a1', 'S@a8']],
    ['G2', '4k3/8/8/8/8/r7/8/R3K3[S] w - - 0 1 {S=w146}', 11, 2446, ['S@a3']],
    ['G2u', '4k3/8/8/8/8/r7/8/R3K3[S] w - - 0 1 {S=w140}', 12, 2614, ['S@a1', 'S@a3']],
    ['G3a', '4k3/8/8/4n3/8/8/8/B3K3[S] w - - 0 1 {S=w140}', 11, 1440, ['S@a1', 'S@e5']],
    ['G3b', '4k3/8/8/4n3/8/8/8/B3K3[S] w - - 0 1 {c3-e3,S=w140}', 8, 926, ['S@a1']],
    ['G3c', '4k3/8/8/8/8/2n5/8/B3K3[S] w - - 0 1 {c3-e3,S=w140}', 7, 527, ['S@a1', 'S@c3']],
    ['G4', '4k3/8/8/3n1n2/8/8/8/R3K3[S] w - - 0 1 {S=w143}', 24, 8925, ['S@a1', 'S@a2', 'S@b1', 'S@b2', 'S@d4', 'S@e4', 'S@e5', 'S@e6', 'S@f6']],
    ['G5', '2*1k2*/1p6/8/*7/8/8/8/R2*K3[S] w - - 0 1 {S=w144}', 12, 1159, ['S@a5', 'S@d1', 'S@h8']],
    ['G6', '4k3/1p6/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w145}', 45, 7867, null],
    ['G7', 'r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w141}', 16, 3043, ['S@a8']],
    ['G7d', '3rk3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w141}', 13, 2694, []],
    ['G8a', '4k3/8/8/8/8/8/7r/R3K3[S] w - - 0 1 {S=w140}', 13, 3033, ['S@a1']],
    ['G8b', '4k3/8/8/8/8/7P/7r/R3K3[S] w - - 0 1 {S=w140}', 16, 2879, ['S@a1', 'S@h2']],
    ['G9', '4k3/7n/8/8/7R/8/8/R3K3[S] w - - 0 1 {S=w140,%h4c3b}', 31, 6087, ['S@a1', 'S@h4', 'S@h7']],
    ['G10a', '4k3/1p6/8/8/8/8/8/R3K3[s] b - - 0 1 {S=b140}', 7, 902, []],
    ['G10b', '4k3/1p6/8/8/R7/8/8/4K3[s] b - - 0 1 {S=b140}', 8, 1167, ['S@a4']],
    ['G12', '4k3/8/8/8/8/r7/8/R3K3[ST] w - - 0 1 {S=w146,T=w147}', 13, 3072, ['S@a3']],
    ['G7s', '3qk2r/8/8/8/8/8/3P4/4K3[S] w - - 0 1 {S=w141}', 7, 1223, ['S@d8']],
  ];
  for (const [name, fen, n1, n3, want] of PINS) {
    const p1 = await perft(fen, 1);
    const p3 = await perft(fen, 3);
    ok(`${name} perft 1 = ${n1}, perft 3 = ${n3} (the native build's)${want ? `; the casts ${want.join(' ') || 'none'}` : ''}`, p1.total === n1 && p3.total === n3 && (!want || same(casts(p1), want)), `${p1.total} ${p3.total} ${casts(p1).join(',')}`);
  }
  {
    const p = await perft('4k3/1p6/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w145}', 1);
    ok('G6 the wall card casts on 30 empty squares in sight (a8 and h8 among them, never h7)', casts(p).length === 30 && casts(p).includes('S@a8') && casts(p).includes('S@h8') && !casts(p).includes('S@h7'), casts(p).join(','));
  }
  // the boards after the key casts, through `d`
  {
    const d4 = await display('4k3/8/8/3n1n2/8/8/8/R3K3[S] w - - 0 1 {S=w143}', ['S@e5']);
    ok('G4 S@e5 through an anchor in sight stuns both knights off the line: %d5s3,%f5s3', field(d4.fen) === '{%d5s3,%f5s3}' && !d4.checkers, d4.fen);
    const d5 = await display('2*1k2*/1p6/8/*7/8/8/8/R2*K3[S] w - - 0 1 {S=w144}', ['S@h8']);
    ok('G5 S@h8 cracks the wall at the end of the long diagonal', d5.fen.startsWith('2*1k2^/'), d5.fen);
    const d6 = await display('4k3/1p6/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w145}', ['S@h8']);
    ok('G6 S@h8 raises stone at the diagonal\'s end', d6.fen.startsWith('4k2*/'), d6.fen);
    const d7 = await display('r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w141}', ['S@a8']);
    ok('G7 S@a8: the stolen rook (white\'s, %a8c4b) checks from where it stands — Checkers: a8', d7.fen.startsWith('R3k3/') && field(d7.fen) === '{%a8c4b}' && d7.checkers === 'a8', `${d7.fen} | ${d7.checkers}`);
    const p7 = await perft('r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w141}', 1, ['S@a8']);
    ok('G7 black has the three king steps off rank 8 and nothing else', same(Object.keys(p7.moves), ['e8d7', 'e8e7', 'e8f7']), Object.keys(p7.moves).join(','));
    const d9 = await display('4k3/7n/8/8/7R/8/8/R3K3[S] w - - 0 1 {S=w140,%h4c3b}', ['S@h4']);
    ok('G9 a stun on the held rook returns it to black, stunned: %h4s3', d9.fen.includes('/7r/') && field(d9.fen) === '{%h4s3}', d9.fen);
  }
  // the searches
  {
    const r0 = await search('r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w141}', 'go depth 8');
    ok('G7 with the rook en prise the search just takes it (bestmove a1a8): a capture beats a cast', /^bestmove a1a8/.test(r0.best), r0.best);
    const G7s = '3qk2r/8/8/8/8/8/3P4/4K3[S] w - - 0 1 {S=w141}';
    const d7s = await display(G7s, ['S@d8']);
    ok('G7s the queen beside the enemy king is in sight up the pawn\'s file and not en prise: S@d8 steals it with check (Checkers: d8), the king must take it or step aside', d7s.checkers === 'd8' && field(d7s.fen) === '{%d8c4b}', `${d7s.fen} | ${d7s.checkers}`);
    const r = await search(G7s, 'go depth 8');
    ok('G7s the search picks the control through sight (bestmove S@d8): the least-bad move in a lost position is the steal with check', /^bestmove S@d8/.test(r.best), r.best);
    const r2 = await search('3rk3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w141}', 'go depth 8');
    ok('G7d with the rook out of sight the card cannot be cast: a plain move', /^bestmove (?!S@)(?!\(none\))/.test(r2.best), r2.best);
  }
  // G11 THE 10x10 DUEL SHAPE with sight decks
  await setVariant('states10');
  {
    const G11 = '4k5/pppp6/10/10/10/10/10/10/PPPP6/R3K5[STst] w - - 0 1 {w|144,S=w140,T=w141,S=b140,T=b143,b|142}';
    const p1 = await perft(G11, 1);
    ok('G11 the duel shape: perft 1 = 29, the control on the four front pawns in sight up their files', p1.total === 29 && same(casts(p1, 'T'), ['T@a9', 'T@b9', 'T@c9', 'T@d9']), `${p1.total} ${casts(p1, 'T').join(',')}`);
    const p2 = await perft(G11, 2);
    ok('G11 perft 2 = 1490 (the native build\'s, the oracle\'s)', p2.total === 1490, String(p2.total));
    const G11c = '4k5/pppp6/10/10/10/10/10/10/P1PP6/RB2K5[STst] w - - 0 1 {w|144,S=w140,T=w141,S=b140,T=b143,b|142}';
    const p1c = await perft(G11c, 1);
    const p2c = await perft(G11c, 2);
    ok('G11c a bishop under the open b-file: perft 1 = 24, perft 2 = 1235, T@b9 back in sight', p1c.total === 24 && p2c.total === 1235 && casts(p1c, 'T').includes('T@b9'), `${p1c.total} ${p2c.total}`);
    const r = await search(G11, 'go depth 8');
    ok('G11 a depth-8 search with sight decks on both sides completes', /^bestmove (?!\(none\))/.test(r.best), r.best);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
