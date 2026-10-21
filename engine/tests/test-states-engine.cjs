// THE PIECE STATES GATE, engine half — engine/patches/piece-states.patch
// (brief §4.10 "3.4 RULED", 2026-10-21): the wasm engine on the hand-verified
// fixtures the forge's native gate ran (engine/forge/native-test-states.py,
// every count derived by the independent Python oracle first) — perft 1
// totals, perft 3 totals pinned to the native build's (the two binaries are
// one patch set), the boards after the key casts through `d` (a stun, an
// invincible, a control and its return, a block, the overwrite, the clock
// through the half / the pass / the link / the mulligan, the recall, the hammer
// under a return), the checks a return and a freeing hit give, and the
// searches: the invincible queen taking a defended pawn (and never without
// the invincibility), a search across a control's return, a duel-shaped
// 10×10 search with two state decks that completes alive.
//   ENGINE_JS=/path/to/patched/stockfish.js node engine/tests/test-states-engine.cjs
// The test variants are the forge's (engine/forge/states.ini: terrain.ini's
// boards plus the piece-effect cards 100-131), read from disk so the native
// and the wasm gates share one definition.
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

  send('uci'); await until((l) => l === 'uciok');
  send('setoption name Use NNUE value false');
  send('setoption name Threads value 1');
  sf.FS.writeFile('/variants.ini', INI);
  send('setoption name VariantPath value /variants.ini');
  await ready();

  const S1 = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w100}';
  const S1c = '4k3/8/3r4/8/8/8/8/3RK3[] w - - 0 1 {%d6s3}';
  const S2 = '4k3/8/3r4/8/8/8/8/3RK3[S] w - - 0 1 {S=w110}';
  const S2c = '4k3/8/R3r3/8/8/8/8/4K3[] w - - 0 1 {%e6i5}';
  const S2d = '4k3/3p4/8/4P3/8/8/8/4K3[] b - - 0 1 {%d7i5}';
  const S2e = '4k3/8/8/2p1p3/3p4/8/8/Q3K3[] w - - 0 1 {%a1i9}';
  const S2f = '4k3/p7/8/8/7_/8/8/4K2R[] w - - 0 1 {~h2,~h3,%h1i5}';
  const S3 = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w120}';
  const S3f = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w122}';
  const S3g = '4k3/8/8/3p4/8/8/P7/4K3[S] w - - 0 1 {S=w120}';
  const S3i = '4k3/p7/8/8/8/8/4K3/r7[S] w - - 0 1 {%a1c3w,S=w120}';
  const S4 = '4k3/8/3r4/8/8/8/8/3RK3[S] w - - 0 1 {S=w130}';
  const S4c = '4k3/8/3r4/8/8/8/8/3RK3[S] w - - 0 1 {%d6e,S=w43}';
  const S4e = '4k3/p3R3/8/8/8/8/8/4K3[S] w - - 0 1 {%e7e,S=w43}';
  const S4g = '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a2,~a3,~a4,%a5e}';
  const S4h = '6k1/7n/8/8/8/8/8/2R1K3[] w - - 0 1 {c3-h7,%h7e}';
  const S5 = '4k3/8/3R4/8/8/8/8/R3K3[s] b - - 0 1 {%d6c4b,S=b100}';
  const S5g = '4k3/p7/4r3/8/8/8/8/3K4[S] w - - 0 1 {%e6c4w,S=w100}';
  const S6 = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {%d6s2,S=w10}';
  const S6e = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {w|101,%d6s2,S=w100}';
  const S7 = '4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%a1i5,%d1e,%d6c4w}';
  const S8 = '4k3/8/8/8/8/8/P7/r3K3[STU] w - - 0 1 {S=w100,T=w120,U=w130}';
  const S12 = '4k3/8/2nr4/2pq4/8/8/8/R3K3[S] w - - 0 1 {S=w101}';
  const S13 = '4k3/8/8/8/4r3/8/P3n3/4K3[S] w - - 0 1 {S=w104}';
  const S14 = '4k3/8/8/8/8/8/P2rb3/4K3[S] w - - 0 1 {S=w105}';
  const S15 = '4k3/p7/8/8/8/8/2n*4/4K3[] w - - 0 1 {*w,%c2c1w}';
  const S15c = '4r1k1/p7/8/8/8/8/2n*4/4K3[] w - - 0 1 {*w,%c2c1w}';
  const S9 = 'r1bqkbn3/pppppp4/10/2*3*3/10/3^2^3/10/10/PPPPPP4/RNBQKB4[STUVstuv] w - - 0 1 {w|100.120.130.110,S=w101,T=w120,U=w130,V=w110,b|100.122,S=b100,T=b121,U=b131,V=b112}';

  // Fixtures: [name, variant, fen, moves, perft 1, perft 3 (the native build's), exact set or null, must-have, must-not]
  const F = [
    ['S1 a stun card: both non-king pieces castable', 'states8', S1, [], 15, 3952, null, ['S@a1', 'S@d6'], ['S@e1', 'S@e8']],
    ['S1 black with a stunned rook: five king moves', 'states8', S1, ['S@d6'], 5, 385, ['e8d7', 'e8d8', 'e8e7', 'e8f7', 'e8f8'], null, null],
    ['S1 a stunned piece is capturable', 'states8', S1c, [], 11, 785, null, ['d1d6'], ['e1d1', 'e1d2']],
    ['S2 an invincible card', 'states8', S2, [], 13, 3312, null, ['S@d1', 'S@d6'], null],
    ['S2 check from an invincible rook: the king walks', 'states8', S2c, [], 4, 980, ['e1d1', 'e1d2', 'e1f1', 'e1f2'], null, null],
    ['S2 an invincible pawn', 'states8', S2d, [], 6, 293, null, ['d7d5'], null],
    ['S2 the slide before the pit', 'states8', S2f, [], 8, 611, null, ['h1h3'], ['h1h2', 'h1h4']],
    ['S3 a control card', 'states8', S3, [], 14, 3703, null, ['S@d6'], null],
    ['S3 the return due at the end of this move', 'states8', S3, ['S@d6', 'e8f8', 'd6d2', 'f8e8'], 23, 5088, null, ['e1f1', 'd2d8'], ['e1d1', 'e1e2', 'e1f2', 'd2d1', 'd2e2']],
    ['S3 the recall on offer', 'states8', S3i, [], 7, 1278, null, ['S@a1'], null],
    ['S4 an entomb card', 'states8', S4, [], 13, 3040, null, ['S@d1', 'S@d6'], null],
    ['S4 a hit frees it: nine anchors', 'states8', S4c, [], 20, 3092, null, ['S@c5', 'S@d6', 'S@e7'], ['S@b4', 'S@f8']],
    ['S4 black in check from the freed rook', 'states8', S4e, ['S@e6'], 3, 142, ['e8e7', 'e8d8', 'e8f8'], null, null],
    ['S4 a wall to the slide', 'states8', S4g, [], 9, 710, null, ['a1a4'], ['a1a5', 'a1a2']],
    ['S4 no landing onto an entombed twin', 'states8', S4h, [], 9, 480, null, ['c1c2'], ['c1c3', 'c1c4']],
    ['S5 the owner stuns its stolen rook', 'states8', S5, [], 5, 690, null, ['S@a1', 'S@d6'], null],
    ['S5 a return that gives check', 'states8', S5g, [], 5, 540, null, ['S@e6'], null],
    ['S6 a portal card beside a stun', 'states8', S6, [], 60, 5869, null, ['S@b3'], null],
    ['S6 the mulligan on offer', 'states8', S6e, [], 16, 2284, null, ['@@@@'], null],
    ['S7 three records: the invincible rook moves, the entombed one does not', 'states8', S7, [], 11, 2665, null, ['a1a2'], ['d1d2', 'd1d3']],
    ['S8 no card in check: the three evasions', 'states8', S8, [], 3, 405, ['e1d2', 'e1e2', 'e1f2'], null, null],
    ['S12 an area stun', 'states8', S12, [], 33, 18254, null, ['S@c5'], null],
    ['S13 a stun on a ray: the one ray with pieces', 'states8', S13, [], 7, 909, null, ['S@e2'], ['S@d2', 'S@f2', 'S@e1']],
    ['S14 the king\'s neighbours', 'states8', S14, [], 5, 521, ['S@e1', 'e1f2', 'e1d2', 'a2a3', 'a2a4'], null, null],
    ['S15 the hammer under a return', 'states8', S15, [], 5, 413, ['e1d2', 'e1d1', 'e1f1', 'e1e2', 'e1f2'], null, null],
    ['S15 a second checker the return does not answer', 'states8', S15c, [], 3, 533, ['e1d1', 'e1f1', 'e1f2'], null, null],
  ];
  for (const [name, v, fen, moves, n1, n3, exact, must, mustNot] of F) {
    await setVariant(v);
    const p1 = await perft(fen, 1, moves);
    const ms = Object.keys(p1.moves);
    const good = p1.total === n1 && (!exact || same(ms, exact)) && (must || []).every((m) => ms.includes(m)) && (mustNot || []).every((m) => !ms.includes(m));
    ok(`${name}: perft 1 = ${n1}${exact ? ', the exact set' : ''}`, good, `${p1.total} ${ms.sort().join(',')}`);
    const p3 = await perft(fen, 3, moves);
    ok(`${name}: perft 3 = ${n3} (the native build's)`, p3.total === n3, String(p3.total));
  }

  // The boards after the key casts, through `d`
  await setVariant('states8');
  const B = [
    ['S1 S@d6: %d6s3, the card spent, no tick on the cast', S1, ['S@d6'], '4k3/8/3r4/8/8/8/8/R3K3[] b - - 0 1 {%d6s3}'],
    ['S1 the count falls a ply at a time: %d6s1 after a1a2', S1, ['S@d6', 'e8d8', 'a1a2'], '3k4/8/3r4/8/8/8/R7/4K3[] b - - 2 2 {%d6s1}'],
    ['S1 at zero the stun ends as the move\'s last act', S1, ['S@d6', 'e8d8', 'a1a2', 'd8e8'], '4k3/8/3r4/8/8/8/R7/4K3[] w - - 3 3'],
    ['S1 the victim\'s record goes with it', S1c, ['d1d6'], '4k3/8/3R4/8/8/8/8/4K3[] b - - 0 1'],
    ['S2 S@d6: %d6i5', S2, ['S@d6'], '4k3/8/3r4/8/8/8/8/3RK3[] b - - 0 1 {%d6i5}'],
    ['S2 the record rides the pawn: %d5i4', S2d, ['d7d5'], '4k3/8/8/3pP3/8/8/8/4K3[] w - d6 0 2 {%d5i4}'],
    ['S2 the pit still kills: the rook gone with its record', S2f, ['h1h3'], '4k3/p7/8/8/7_/8/8/4K3[] b - - 0 1 {~h2,~h3}'],
    ['S3 S@d6: the rook is white, %d6c4b', S3, ['S@d6'], '4k3/8/3R4/8/8/8/8/R3K3[] b - - 0 1 {%d6c4b}'],
    ['S3 the record rides the rook: %d2c2b', S3, ['S@d6', 'e8f8', 'd6d2'], '5k2/8/8/8/8/8/3R4/R3K3[] b - - 2 2 {%d2c2b}'],
    ['S3 after e1f1 the rook is black again, no record', S3, ['S@d6', 'e8f8', 'd6d2', 'f8e8', 'e1f1'], '4k3/8/8/8/8/8/3r4/R4K2[] b - - 0 3'],
    ['S3 the promotion then the return: a black queen on d8', S3g, ['S@d5', 'e8f8', 'd5d7', 'f8g8', 'd7d8q'], '3q2k1/8/8/8/8/8/P7/4K3[] b - - 0 3'],
    ['S3 the recall: a white rook on a1, no record', S3i, ['S@a1'], '4k3/p7/8/8/8/8/4K3/R7[] b - - 0 1'],
    ['S4 S@d6: %d6e, no count', S4, ['S@d6'], '4k3/8/3r4/8/8/8/8/3RK3[] b - - 0 1 {%d6e}'],
    ['S4 the block has no clock', S4, ['S@d6', 'e8f8', 'e1d2', 'f8e8', 'd2e1'], '4k3/8/3r4/8/8/8/8/3RK3[] b - - 4 3 {%d6e}'],
    ['S4 freed by the hit: a black rook on d6', S4c, ['S@d6'], '4k3/8/3r4/8/8/8/8/3RK3[] b - - 0 1'],
    ['S4 the rook rests on a4 before the entombed knight', S4g, ['a1a4'], '4k3/p7/8/n7/R7/8/8/4K3[] b - - 1 1 {~a2,~a3,~a4,%a5e}'],
    ['S5 the owner stuns its stolen rook: home, stunned for three', S5, ['S@d6'], '4k3/8/3r4/8/8/8/8/R3K3[] w - - 0 2 {%d6s3}'],
    ['S5 the thief entombs the piece it holds: back as a block', '4k3/8/3R4/8/8/8/8/R3K3[S] w - - 0 1 {%d6c4b,S=w130}', ['S@d6'], '4k3/8/3r4/8/8/8/8/R3K3[] b - - 0 1 {%d6e}'],
    ['S5 control overwrites a stun', '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {%d6s3,S=w120}', ['S@d6'], '4k3/8/3R4/8/8/8/8/R3K3[] b - - 0 1 {%d6c4b}'],
    ['S6 the half ticks (the slot stays open until the link: S=w10+)', S6, ['S@b3'], '4k3/8/3r4/8/8/8/8/R3K3[S] b - - 0 1 {b3w,S=w10+,%d6s1}'],
    ['S6 the pass and the link tick nothing', S6, ['S@b3', 'e8e8', 'S@g3'], '4k3/8/3r4/8/8/8/8/R3K3[] b - - 0 2 {b3-g3,%d6s1}'],
    ['S6 the mulligan ticks', S6e, ['@@@@'], '4k3/8/3r4/8/8/8/8/R3K3[S] b - - 0 1 {S=w101,%d6s1}'],
    ['S7 the field round-trips', S7, [], S7],
    ['S7 a record that cannot stand is dropped', '4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%d6c4b,%e8s3,%a1s0,%d1i20}', [], '4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1'],
    ['S12 S@c5 stuns the four', S12, ['S@c5'], '4k3/8/2nr4/2pq4/8/8/8/R3K3[] b - - 0 1 {%c5s3,%d5s3,%c6s3,%d6s3}'],
    ['S13 the ray: the knight and the rook', S13, ['S@e2'], '4k3/8/8/8/4r3/8/P3n3/4K3[] b - - 0 1 {%e2s3,%e4s3}'],
    ['S14 both neighbours stunned for four', S14, ['S@e1'], '4k3/8/8/8/8/8/P2rb3/4K3[] b - - 0 1 {%d2s4,%e2s4}'],
    ['S15 the hammer under a return: a crate, the knight white, the flag alone', S15, ['e1d2'], '4k3/p7/8/8/8/8/2N^4/4K3[] b - - 0 1 {*w}'],
  ];
  for (const [name, fen, moves, want] of B) {
    const d = await display(fen, moves);
    ok(name, d.fen === want, d.fen);
  }
  {
    const d = await display(S3f, ['S@d6', 'e8f8', 'd6e6', 'f8g8']);
    ok('S3 control3: the rook returns on black\'s move and checks from e6', d.fen === '6k1/8/4r3/8/8/8/8/R3K3[] w - - 0 3' && d.checkers === 'e6', `${d.fen} | ${d.checkers}`);
    const d2 = await display(S4e, ['S@e6']);
    ok('S4 the freed rook on e7 checks the king', d2.fen === '4k3/p3R3/8/8/8/8/8/4K3[] b - - 0 1' && d2.checkers === 'e7', `${d2.fen} | ${d2.checkers}`);
    const d3 = await display(S5g, ['S@e6']);
    ok('S5 the returned rook on e6 checks the king, stunned for three', d3.fen === '4k3/p7/4R3/8/8/8/8/3K4[] b - - 0 1 {%e6s3}' && d3.checkers === 'e6', `${d3.fen} | ${d3.checkers}`);
    const d4 = await display(S15, []);
    ok('S15 before the hammer: in check from the held knight', d4.checkers === 'c2', d4.checkers);
    const d5 = await display(S15, ['e1d2']);
    ok('S15 after it: no check', d5.checkers === '', d5.checkers);
  }

  // THE SEARCHES
  {
    const r = await search(S2e, 'go depth 10');
    ok('S2 the search takes the defended pawn with the invincible queen (a1d4: nothing can take it back)', r.best.startsWith('bestmove a1d4'), r.best);
    const r2 = await search(S2e.replace(' {%a1i9}', ''), 'go depth 10');
    ok('S2 ...and never without the invincibility', !r2.best.startsWith('bestmove a1d4') && /^bestmove /.test(r2.best), r2.best);
    const r3 = await search(S3, 'go depth 8', ['S@d6', 'e8f8', 'd6d2', 'f8e8']);
    ok('S3 a search across the return completes with a legal move', /^bestmove (e1f1|d2d8|d2d[3-7]|d2[abcfgh]2|a1[a-h]1|a1a[2-8])/.test(r3.best), r3.best);
  }
  // S9 THE 10x10 DUEL SHAPE with two state decks
  await setVariant('states10');
  {
    const p1 = await perft(S9, 1);
    ok('S9 the duel shape: perft 1 = 118', p1.total === 118, String(p1.total));
    const p2 = await perft(S9, 2);
    ok('S9 the duel shape: perft 2 = 14392 (the native build\'s, the oracle\'s)', p2.total === 14392, String(p2.total));
    const r = await search(S9, 'go depth 8');
    ok('S9 a depth-8 search with two state decks completes', /^bestmove (?!\(none\))/.test(r.best), r.best);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
