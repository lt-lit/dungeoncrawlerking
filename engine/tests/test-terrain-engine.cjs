// THE TERRAIN INTERPRETER GATE, engine half — engine/patches/terrain.patch
// (brief §4.10 "Phase 3.3b" and "3.3b RULED", 2026-10-03): the wasm engine on
// the hand-verified fixtures the forge's native gate ran
// (engine/forge/native-test-terrain.py, every count derived by the independent
// Python oracle first) — perft 1 move sets, perft 3 totals pinned to the
// native build's (the two binaries are one patch set), the boards after the
// key casts through `d` (a crack, a smash, the lance, a raised wall, a pit,
// bedrock, the sledge flag, a dropped pawn, ice under a king), the searches:
// check by demolition seen as a check, the immurement found as the mate it is
// (stalemate is a loss), and a duel-shaped 10x10 search with two terrain decks
// that completes alive.
//   ENGINE_JS=/path/to/patched/stockfish.js node engine/tests/test-terrain-engine.cjs
// The test variants are the forge's (engine/forge/terrain.ini: hand 4, slots
// s..z, hammerPieceTypes = k, defs 1-4 ice, 10 portal, 20 win, 30 meta, 40-46
// hits, 50-53 walls, 60-61 pits, 70-71 harden, 80 sledge, 90-91 drops), read
// from disk so the native and the wasm gates share one definition.
const fs = require('fs'), path = require('path');
const ENGINE_JS = process.env.ENGINE_JS; if (!ENGINE_JS) { console.error('set ENGINE_JS=/path/to/patched/stockfish.js'); process.exit(2); }
const INI = fs.readFileSync(path.join(__dirname, '..', 'forge', 'terrain.ini'), 'utf8');
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

  send('uci'); await until((l) => l === 'uciok');
  send('setoption name Use NNUE value false');
  send('setoption name Threads value 1');
  sf.FS.writeFile('/variants.ini', INI);
  send('setoption name VariantPath value /variants.ini');
  await ready();

  const T1 = '4k3/p7/8/8/8/8/3*4/R3K3[Ss] w - - 0 1 {w|20.30,b|41,S=w40,S=b45}';
  const T2 = '4k3/p7/8/8/8/8/3*^3/R3K3[SS] w - - 0 1 {S=w41}';
  const T4 = 'k7/7p/8/8/^7/8/8/R3K3[S] w - - 0 1 {S=w43}';
  const T4c = 'r6k/8/8/8/^7/8/1P6/K7[S] w - - 0 1 {S=w43}';
  const T5 = '7k/p3#3/4^3/4*3/8/4*1*1/5_2/4K2R[S] w - - 0 1 {S=w45}';
  const T6 = 'k*6/1*6/8/8/8/7p/7P/4K3[S] w - - 0 1 {S=w51}';
  const T6c = '4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w50}';
  const T7 = '4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w60}';
  const T8 = '4k3/p7/8/8/8/8/3*4/R3K3[ST] w - - 0 1 {S=w71,T=w41}';
  const T9 = '4k3/p7/8/8/8/8/3*4/R3K3[S] w - - 0 1 {S=w80}';
  const T10 = '4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w90}';
  const T10c = '4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w91}';
  const T11 = '4k3/p7/8/8/8/8/8/R3K3[STUV] w - - 0 1 {S=w2,T=w3,U=w4,V=w1}';
  const T15 = '4k3/p7/8/8/8/8/3*4/R3K3[STst] w - - 0 1 {d4-e5,~a2,w|20,S=w40,T=w80,b|41,S=b45,T=b60,*w,*b}';
  const T17 = 'r1bqkbn3/pppppp4/10/2*3*3/10/3^2^3/10/10/PPPPPP4/RNBQKB4[STUVstuv] w - - 0 1 {w|45.80.53.60,S=w40,T=w2,U=w50,V=w90,b|43.41,S=b42,T=b51,U=b61,V=b4}';

  // Fixtures: [name, variant, fen, moves, perft 1, perft 3 (the native build's), exact set or null, must-have, must-not]
  const F = [
    ['T1 the crack on offer', 'terrain8', T1, [], 15, 1546, null, ['S@d2', '@@@@'], ['e1d2']],
    ['T2 two smashes: the wall and the crate beside the king', 'terrain8', T2, [], 15, 1539, null, ['S@d2', 'S@e2'], ['S@c2']],
    ['T4 the demolition: six anchors cover the crate', 'terrain8', T4, [], 17, 1226, null, ['S@a3', 'S@a4', 'S@a5', 'S@b3', 'S@b4', 'S@b5'], ['S@c4']],
    ['T4 the self-exposing demolition: no cast, the king and the pawn move', 'terrain8', T4c, [], 4, 465, ['a1a2', 'a1b1', 'b2b3', 'b2b4'], null, null],
    ['T5 the lance: north and north-east over the pit', 'terrain8', T5, [], 15, 443, null, ['S@e2', 'S@f2'], ['S@d2', 'S@d1', 'S@f1']],
    ['T6 the immuring wall', 'terrain8', T6, [], 66, 622, null, ['S@a7'], null],
    ['T6 the wall x/o/x near', 'terrain8', T6c, [], 24, 3205, null, ['S@d2'], ['S@a5']],
    ['T7 the sink', 'terrain8', T7, [], 24, 3260, null, ['S@f2'], null],
    ['T8 petrify + smash', 'terrain8', T8, [], 15, 1532, null, ['S@d2', 'T@d2'], null],
    ['T9 the sledge card, the hammer off', 'terrain8', T9, [], 14, 1377, null, ['S@e1'], ['e1d2']],
    ['T10 the reinforcement: 47 drops in the camp', 'terrain8', T10, [], 61, 10288, null, ['S@e2', 'S@a2', 'S@h7'], ['S@b8', 'S@b1']],
    ['T10 a knight near', 'terrain8', T10c, [], 22, 3190, null, ['S@d1', 'S@b2'], ['S@c3']],
    ['T11 four ice cards: anywhere, middle, margin1, the legacy word', 'terrain8', T11, [], 142, 97507, null, ['S@a1', 'S@e8', 'T@a4', 'U@a3', 'V@h5'], ['T@a3', 'U@a2', 'V@a3']],
    ['T15 both enchanted, a pair, ice, both piles', 'terrain8', T15, [], 15, 4179, null, ['e1d2', 'S@d2'], null],
  ];
  for (const [name, v, fen, moves, n1, n3, exact, must, mustNot] of F) {
    await setVariant(v);
    const p1 = await perft(fen, 1, moves);
    const ms = Object.keys(p1.moves);
    const good = p1.total === n1 && (!exact || same(ms, exact)) && (must || []).every((m) => ms.includes(m)) && (mustNot || []).every((m) => !ms.includes(m));
    ok(`${name}: perft 1 = ${n1}${exact ? ', the exact set' : ''}`, good, `${p1.total} ${ms.sort().join(',')}`);
    if (n3 !== null) {
      const p3 = await perft(fen, 3, moves);
      ok(`${name}: perft 3 = ${n3} (the native build's)`, p3.total === n3, String(p3.total));
    }
  }
  // T4c is a position where the hit is illegal: white still has king and pawn moves
  await setVariant('terrain8');
  {
    const p = await perft(T4c, 1);
    ok('T4 the self-exposing demolition: the king and the pawn move, no cast', p.total === 4 && !Object.keys(p.moves).some((m) => m.includes('@')), `${p.total} ${Object.keys(p.moves).join(',')}`);
  }

  // The boards after the key casts, through `d`
  const B = [
    ['T1 S@d2: d2 is a crate, black drew 41 into t', T1, ['S@d2'], '4k3/p7/8/8/8/8/3^4/R3K3[st] b - - 0 1 {w|20.30,S=b45,T=b41}'],
    ['T2 S@d2: floor at once', T2, ['S@d2'], '4k3/p7/8/8/8/8/4^3/R3K3[S] b - - 0 1 {S=w41}'],
    ['T5 S@e2: e3 and e5 crack, e6 is floor, e7 stops the ray', T5, ['S@e2'], '7k/p3#3/8/4^3/8/4^1*1/5_2/4K2R[] b - - 0 1'],
    ['T5 S@f2: over the pit, g3 cracks', T5, ['S@f2'], '7k/p3#3/4^3/4*3/8/4*1^1/5_2/4K2R[] b - - 0 1'],
    ['T6 S@a7: the pocket sealed', T6, ['S@a7'], 'k*6/**6/8/8/8/7p/7P/4K3[] b - - 0 1'],
    ['T7 S@f2: f2 and g2 sink', T7, ['S@f2'], '4k3/p7/8/8/8/8/5__1/R3K3[] b - - 0 1'],
    ['T8 S@d2: bedrock', T8, ['S@d2'], '4k3/p7/8/8/8/8/3#4/R3K3[T] b - - 0 1 {T=w41}'],
    ['T9 S@e1: the flag *w', T9, ['S@e1'], '4k3/p7/8/8/8/8/3*4/R3K3[] b - - 0 1 {*w}'],
    ['T9 the hammer after it', T9, ['S@e1', 'e8d8', 'e1d2'], '3k4/p7/8/8/8/8/3^4/R3K3[] b - - 0 2 {*w}'],
    ['T10 S@e2: a pawn on e2', T10, ['S@e2'], '4k3/p7/8/8/8/8/4P3/R3K3[] b - - 0 1'],
    ['T11 S@e8: ice under the enemy king', T11, ['S@e8'], '4k3/p7/8/8/8/8/8/R3K3[TUV] b - - 0 1 {~d7,~e7,~f7,~d8,~e8,~f8,T=w3,U=w4,V=w1}'],
    ['T12 a wall over ice clears it', '4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {~e4,~f4,S=w51}', ['S@e4'], '4k3/p7/8/8/3***2/8/8/R3K3[] b - - 0 1'],
    ['T15 the field round-trips', T15, [], T15],
  ];
  for (const [name, fen, moves, want] of B) {
    const d = await display(fen, moves);
    ok(name, d.fen === want, d.fen);
  }
  {
    const d = await display(T4, ['S@a4']);
    ok('T4 S@a4: the crate gone, black in check from a1', d.fen.startsWith('k7/7p/8/8/8/8/8/R3K3[] b') && d.checkers === 'a1', `${d.fen} | ${d.checkers}`);
    const d2 = await display('7p/8/8/4k3/8/8/8/R3K3[S] w - - 0 1 {S=w90}', ['S@d4']);
    ok('T10 a dropped pawn checks the king on e5', d2.checkers === 'd4', d2.checkers);
  }

  // THE SEARCHES
  {
    const r = await search(T6, 'go depth 6');
    ok('T6 the immurement is found: mate in 1 by the wall', / score mate 1 /.test(r.last) && r.best.includes('S@a7'), `${r.best} | ${r.last}`);
    const r4 = await search(T4, 'go depth 4');
    ok('T4 a search on the demolition board completes', /^bestmove /.test(r4.best), r4.best);
  }
  // T17 THE 10x10 DUEL SHAPE with two terrain decks
  await setVariant('terrain10');
  {
    const p1 = await perft(T17, 1);
    ok('T17 the duel shape: perft 1 = 194', p1.total === 194, String(p1.total));
    const p2 = await perft(T17, 2);
    ok('T17 the duel shape: perft 2 = 43530 (the native build\'s)', p2.total === 43530, String(p2.total));
    const r = await search(T17, 'go depth 8');
    ok('T17 a depth-8 search with two terrain decks completes', /^bestmove (?!\(none\))/.test(r.best), r.best);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
