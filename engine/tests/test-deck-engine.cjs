// THE DECK GATE, engine half — engine/patches/deck.patch + deck-search.patch
// (brief §4.10 "Phase 3.3"): the wasm engine on the hand-verified fixtures the
// forge's native gate ran (engine/forge/native-test-deck.py, every count
// derived by the independent Python oracle first) — perft 1 move sets, perft 3
// totals pinned to the native build's (the two binaries are one patch set),
// the boards after the key moves through `d` (the draw, the slot bindings, the
// cast slot, the winner), the searches: the win card played on the spot, THE
// DIG (the win card two and three mulligans deep found as the exact mate the
// deck makes it), a root reached BY MOVES searching the same deck as its own
// FEN (the pile pointer must survive the root's re-parse), and a duel-shaped
// 10x10 search with two decks that completes alive.
//   ENGINE_JS=/path/to/patched/stockfish.js node engine/tests/test-deck-engine.cjs
// The test variants are the forge's (engine/forge/deck.ini: hand 4, slots
// s..z, card IDs 1-9 ice, 10-19 portal, 20-29 win, 30-39 meta), read from disk
// so the native and the wasm gates share one definition.
const fs = require('fs'), path = require('path');
const ENGINE_JS = process.env.ENGINE_JS; if (!ENGINE_JS) { console.error('set ENGINE_JS=/path/to/patched/stockfish.js'); process.exit(2); }
const INI = fs.readFileSync(path.join(__dirname, '..', 'forge', 'deck.ini'), 'utf8');
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
  const board = (f) => f.split(' ')[0].split('[')[0];
  const pocket = (f) => (f.match(/\[([^\]]*)\]/) || ['', ''])[1];
  const field = (f) => (f.match(/\{[^}]*\}/) || [''])[0];

  send('uci'); await until((l) => l === 'uciok');
  send('setoption name Use NNUE value false');
  send('setoption name Threads value 1');
  sf.FS.writeFile('/variants.ini', INI);
  send('setoption name VariantPath value /variants.ini');
  await ready();

  const F1 = '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|20.30,b|1,S=w1,S=b2}';
  const FW = 'r2k4/p7/8/8/8/8/8/R3K3[STst] w - - 0 2 {S=w20,T=w30,S=b2,T=b1}';
  const F5 = '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|10.11.20.31,b|1,S=w1,S=b2}';
  const F6 = '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|1,b|1,S=w10,S=b2}';
  const F7 = '2p1k1/******/******/******/1*****/K4N[S] w - - 0 1 {S=w10}';
  const F8 = '4k3/p7/8/8/8/8/8/R3K3[] w - - 0 1 {w|1.1.30,b|2}';
  const F9 = '4k3/p7/8/8/8/8/8/r3K2R[STst] w - - 0 1 {w|20,S=w1,T=w10,S=b2,T=b1}';
  const F10 = '4k3/p7/8/8/8/8/8/4K3[ST] w - - 0 1 {w|20,S=w1,T=w10}';
  const dig = (A) => { const pile = Array.from({ length: A }, (_, i) => [5, 6, 7, 8, 9, 1, 2, 3][i % 8]).concat([20]); return `7k/8/**6/p*6/P*6/**6/8/4K3[STUV] w - - 0 1 {w|${pile.join('.')},S=w1,T=w2,U=w3,V=w4}`; };
  const F13 = '3k4/pppp4/8/8/8/8/P7/4K3[STUV] w - - 0 1 {w|5.6.7.8.9.1.2.3.20,S=w1,T=w2,U=w3,V=w4}';
  const L13 = ['@@@@', 'c7c5', '@@@@', 'c5c4'];
  const F12 = '1r2k1r3/1pppppp3/10/10/10/10/10/10/1PPPPPP3/1R2K1R3[STUVstuv] w - - 0 1 {w|3.14.20.7.15.30,b|9.19.1.31.5,S=w1,T=w10,U=w2,V=w11,S=b2,T=b12,U=b3,V=b13}';

  // Fixtures: [name, variant, fen, moves, perft 1, perft 3 (the native build's; null where the game is over), exact set or null, must-have, must-not]
  const F = [
    ['D1 the start: an ice card in hand, a win card and a blank on the pile', 'deck8', F1, [], 31, 24842, null, ['@@@@', 'S@e4', 'S@a5'], ['S@e3', 'S@e1']],
    ['D2 black after the ice cast: two ice cards, no pile left', 'deck8', F1, ['S@e4'], 37, 10654, null, ['S@a4', 'T@a4'], ['S@e4', '@@@@']],
    ['D3 white drew the win card and the blank', 'deck8', F1, ['S@e4', 'e8d8'], 15, 7447, null, ['S@e1'], ['T@e1', 'S@e4', '@@@@']],
    ['D4 the win played: black has no move', 'deck8', F1, ['S@e4', 'e8d8', 'S@e1'], 0, null, [], null, null],
    ['D4 the winning position', 'deck8', FW, [], 15, 9310, null, ['S@e1'], ['T@e1']],
    ['D5 a mulligan on offer (a pile of four)', 'deck8', F5, [], 31, 130298, null, ['@@@@'], null],
    ['D5 after the mulligan: black drew its ice into t', 'deck8', F5, ['@@@@'], 39, 15562, null, ['S@e4', 'T@e4'], ['@@@@']],
    ['D6 a portal card in hand', 'deck8', F6, [], 62, 42190, null, ['S@e4', 'S@a2', '@@@@'], ['S@a7', 'S@a1']],
    ['D6 the half open: black frozen', 'deck8', F6, ['S@e4'], 1, 1793, ['e8e8'], null, null],
    ['D6 the link ply: the slot\'s drops alone', 'deck8', F6, ['S@e4', 'e8e8'], 46, 50387, null, ['S@c5'], ['S@e4', '@@@@', 'e1d1']],
    ['D6 after the link: the card spent, black drew', 'deck8', F6, ['S@e4', 'e8e8', 'S@c5'], 39, 25697, null, ['T@e4'], ['e8e8']],
    ['D7 one castable square', 'deck6', F7, [], 3, 13, ['S@a2', 'a1a2', 'a1b1'], null, null],
    ['D7 the caster with no link left: the fizzle pass alone', 'deck6', F7, ['S@a2', 'e6e6'], 1, 4, ['a1a1'], null, null],
    ['D7 after the fizzle', 'deck6', F7, ['S@a2', 'e6e6', 'a1a1'], 2, 4, ['e6d6', 'e6f6'], null, null],
    ['D8 black drew one card of the pile', 'deck8', F8, ['e1d1'], 23, 7395, null, ['S@e4'], ['@@@@']],
    ['D9 in check: the king\'s three evasions, no cast, no mulligan', 'deck8', F9, [], 3, 11593, ['e1d2', 'e1e2', 'e1f2'], null, null],
    ['D10 a bared king with cards in hand has lost', 'deck8', F10, [], 0, null, [], null, null],
    ['D11 the dig board', 'deck8', dig(4), [], 62, 10599, null, ['@@@@', 'S@a4'], null],
    ['D13 the root by moves: the third mulligan on the last card', 'deck8', F13, L13, 72, 45461, null, ['@@@@'], null],
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

  // The boards after the key moves, through `d`: the FEN's deck field as the native build prints it
  await setVariant('deck8');
  const B = [
    ['D1 the FEN round-trips (the pile, the bindings, canonical order)', F1, [], '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 0 1 {w|20.30,S=w1,b|1,S=b2}'],
    ['D2 S@e4: the 3x3 iced, the card spent, black draws id 1 into t', F1, ['S@e4'], '4k3/p7/8/8/8/8/8/R3K3[st] b - - 0 1 {~d3,~e3,~f3,~d4,~e4,~f4,~d5,~e5,~f5,w|20.30,S=b2,T=b1}'],
    ['D3 e8d8: white draws 20 into S and 30 into T, its pile empty, the clock reset by the draw', F1, ['S@e4', 'e8d8'], '3k4/p7/8/8/8/8/8/R3K3[STst] w - - 0 2 {~d3,~e3,~f3,~d4,~e4,~f4,~d5,~e5,~f5,S=w20,T=w30,S=b2,T=b1}'],
    ['D4 S@e1: the win recorded as !w, the card spent, nobody draws', F1, ['S@e4', 'e8d8', 'S@e1'], '3k4/p7/8/8/8/8/8/R3K3[Tst] b - - 0 2 {~d3,~e3,~f3,~d4,~e4,~f4,~d5,~e5,~f5,T=w30,S=b2,T=b1,!w}'],
    ['D5 @@@@: the hand discarded, four drawn into s..v, the pile empty, black drew too', F5, ['@@@@'], '4k3/p7/8/8/8/8/8/R3K3[STUVst] b - - 0 1 {S=w10,T=w11,U=w20,V=w31,S=b2,T=b1}'],
    ['D6 S@e4: the half stands, the slot marked +, the card still in hand, nobody drew', F6, ['S@e4'], '4k3/p7/8/8/8/8/8/R3K3[Ss] b - - 0 1 {e4w,w|1,S=w10+,b|1,S=b2}'],
    ['D6 e8e8: the frozen pass', F6, ['S@e4', 'e8e8'], '4k3/p7/8/8/8/8/8/R3K3[Ss] w - - 1 2 {e4w,w|1,S=w10+,b|1,S=b2}'],
    ['D6 S@c5: the pair linked, the card spent, black draws its pile\'s ice into t', F6, ['S@e4', 'e8e8', 'S@c5'], '4k3/p7/8/8/8/8/8/R3K3[st] b - - 0 2 {e4-c5,w|1,S=b2,T=b1}'],
    ['D13 two mulligans and two pawn moves: one card left, the hand 9.1.2.3', F13, L13, '3k4/pp1p4/8/8/2p5/8/P7/4K3[STUV] w - - 0 3 {w|20,S=w9,T=w1,U=w2,V=w3}'],
  ];
  for (const [name, fen, mv, want] of B) {
    const d = await display(fen, mv);
    ok(name, d.fen === want, d.fen);
  }
  let d = await display(F8, ['e1d1', 'e8d8']);
  ok('D8 two ice cards of one ID merge into one slot with a count of two, the blank beside', pocket(d.fen).startsWith('SST') && field(d.fen).includes('S=w1') && field(d.fen).includes('T=w30') && !field(d.fen).includes('w|'), d.fen);
  await setVariant('deck6');
  d = await display(F7, ['S@a2', 'e6e6']);
  ok('D7 the half with no link left, the slot marked', d.fen === '2p1k1/******/******/******/1*****/K4N[S] w - - 1 2 {a2w,S=w10+}', d.fen);
  d = await display(F7, ['S@a2', 'e6e6', 'a1a1']);
  ok('D7 the fizzle spends the card and the half is gone', d.fen === '2p1k1/******/******/******/1*****/K4N[] b - - 0 2', d.fen);
  await setVariant('deck8');

  // Searches: the win card on the spot; THE DIG at the depths the native release measured (mate in 2..5 at depth 3 / 6 / 8 / 16)
  let r = await search(FW, 'go depth 4');
  ok('search: the win card is played on the spot (bestmove S@e1, mate 1)', /^bestmove S@e1/.test(r.best) && r.last.includes(' score mate 1 '), `${r.best} | ${r.last}`);
  r = await search(dig(0), 'go depth 4');
  ok('the dig: the win card at the top of the pile — mate in 2 (mulligan, cast) by depth 4', r.last.includes(' score mate 2 ') && /^bestmove @@@@/.test(r.best), r.last);
  r = await search(dig(4), 'go depth 8');
  ok('the dig: four cards over it — mate in 3 by depth 8', r.last.includes(' score mate 3 '), r.last);
  r = await search(dig(8), 'go depth 10');
  ok('the dig: eight cards over it — mate in 4 by depth 10', r.last.includes(' score mate 4 '), r.last);
  r = await search(F13, 'go depth 6', L13);
  ok('the root by moves: the third mulligan draws the last card — mate in 2, bestmove @@@@', r.last.includes(' score mate 2 ') && /^bestmove @@@@/.test(r.best), `${r.best} | ${r.last}`);
  r = await search('3k4/pppp4/8/8/8/8/8/R3K3[STUV] w - - 0 1 {w|5.6.7.8.20,S=w1,T=w2,U=w3,V=w4}', 'go depth 8');
  ok('the dig under counterplay (a pawn queens with check in three): still mate in 3', r.last.includes(' score mate 3 '), r.last);

  // The 10x10 duel shape with two decks: perft pinned to the native build, a production-limit search completes alive
  await setVariant('deck10');
  const p1 = await perft(F12, 1);
  ok('D12 the 10x10 duel shape with two decks: perft 1 = 198 (the native build\'s)', p1.total === 198, String(p1.total));
  const p2 = await perft(F12, 2);
  ok('D12 perft 2 = 12316 (the native build\'s)', p2.total === 12316, String(p2.total));
  r = await search(F12, 'go depth 12 movetime 4000');
  ok('D12 a depth-12 search answers', /^bestmove \S+/.test(r.best) && r.best !== 'bestmove (none)', r.best);
  await ready();
  ok('engine alive after the searches', true);

  console.log(`\ndeck/engine: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
