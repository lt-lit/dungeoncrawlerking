// THE TERRAIN INTERPRETER GATE, ffish half — engine/patches/terrain.patch
// (brief §4.10 "Phase 3.3b" and "3.3b RULED", 2026-10-03): a card is a
// DEFINITION `<effect> <shape> <targeting>` the engine interprets over the
// board, through the JS API the game uses. Effects: hit1 / hit2 (an intact
// wall cracks into a crate, a crate is floor; under hit2 a wall is floor at
// once; bedrock, pits and pieces untouched), ice (the floor of the shape
// slippery), wall / pit (empty floor rises as stone / sinks into a pit, the ice
// under it cleared), harden (an intact wall becomes bedrock), sledge (the
// caster's colour may hammer from now on: `*w` in the field), drop <letter>
// (a real piece placed on the anchor), win, portal, meta. Shapes are picture
// strings with `o` the anchor, no rotation, clipped at the edge; targeting any
// / near / middle / margin<n> / king / ray<n> / camp. A cast is the slot's
// drop on the anchor (`S@e4`), a ray's on the king's neighbour; a cast that
// changes nothing is no move; no cast in check; a hit's demolition opens lines
// (check by demolition, and a self-exposing hit is illegal).
//   FFISH_JS=/path/to/patched/ffish.js node engine/tests/test-terrain-ffish.cjs
// Every count was derived by the forge's independent Python oracle
// (engine/forge/oracle.py) and confirmed on the native build before the wasm
// ran it (engine/forge/native-test-terrain.py). The test variants are the
// forge's terrain.ini, read from disk so both gates share one definition.
const fs = require('fs'), path = require('path');
const FFISH_JS = process.env.FFISH_JS; if (!FFISH_JS) { console.error('set FFISH_JS=/path/to/patched/ffish.js'); process.exit(2); }
const INI = fs.readFileSync(path.join(__dirname, '..', 'forge', 'terrain.ini'), 'utf8');
const realFetch = global.fetch; delete global.fetch;
const Module = require(FFISH_JS);
Module.onRuntimeInitialized = () => { global.fetch = realFetch; run(Module); };

function run(ffish) {
  let pass = 0, fail = 0;
  const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
  ffish.loadVariantConfig(INI);
  const V = 'terrain8';
  const moves = (b) => b.legalMoves().split(' ').filter(Boolean).sort();
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const after = (fen, mvs, v = V) => { const b = new ffish.Board(v, fen); for (const m of mvs) b.push(m); const f = b.fen(); b.delete(); return f; };
  const movesAfter = (fen, mvs, v = V) => { const b = new ffish.Board(v, fen); for (const m of mvs) b.push(m); const ms = moves(b); b.delete(); return ms; };
  const casts = (ms, slot = 'S') => ms.filter((m) => m.startsWith(slot + '@'));
  const checked = (fen, mvs, v = V) => { const b = new ffish.Board(v, fen); for (const m of mvs) b.push(m); const c = b.isCheck(); b.delete(); return c; };

  // T1 THE CRACK (40: hit1 o near): the wall beside the king cracks into a crate; black draws
  let fen = '4k3/p7/8/8/8/8/3*4/R3K3[Ss] w - - 0 1 {w|20.30,b|41,S=w40,S=b45}';
  ok('validateFen accepts a terrain deal\'s field (piles, bindings)', ffish.validateFen(fen, V) === 1, String(ffish.validateFen(fen, V)));
  ok('validateFen accepts the sledge flags', ffish.validateFen('4k3/p7/8/8/8/8/3*4/R3K3[] w - - 0 1 {*w,*b}', V) === 1);
  let b = new ffish.Board(V, fen);
  let ms = moves(b);
  ok('T1: one cast, S@d2, with the mulligan and 13 piece moves: 15', same(casts(ms), ['S@d2']) && ms.includes('@@@@') && ms.length === 15, ms.join(','));
  ok("T1: SAN 'S@d2'", b.sanMove('S@d2') === 'S@d2', b.sanMove('S@d2'));
  b.push('S@d2');
  ok('T1: d2 is a crate, the card spent, black drew 41 into t', b.fen() === '4k3/p7/8/8/8/8/3^4/R3K3[st] b - - 0 1 {w|20.30,S=b45,T=b41}', b.fen());
  ms = moves(b);
  ok('T1: black casts nothing (no wall on a ray from e8, none beside its pieces): 7 moves', !casts(ms, 'S').length && !casts(ms, 'T').length && ms.length === 7, ms.join(','));
  ok('T1: pop restores the wall and the hand (the FEN in canonical order: a side\'s pile, then its bindings)', (b.pop(), b.fen() === '4k3/p7/8/8/8/8/3*4/R3K3[Ss] w - - 0 1 {w|20.30,S=w40,b|41,S=b45}'), b.fen());
  b.delete();
  // T2 THE SMASH (41: hit2 o near): floor at once; a crate too
  const fen2 = '4k3/p7/8/8/8/8/3*^3/R3K3[SS] w - - 0 1 {S=w41}';
  ms = movesAfter(fen2, []);
  ok('T2: the smashes on d2 (a wall) and e2 (a crate)', same(casts(ms), ['S@d2', 'S@e2']), casts(ms).join(','));
  ok('T2: S@d2 — floor at once, one smash left', after(fen2, ['S@d2']) === '4k3/p7/8/8/8/8/4^3/R3K3[S] b - - 0 1 {S=w41}', after(fen2, ['S@d2']));
  ok('T2: S@e2 next — the crate is floor', after(fen2, ['S@d2', 'e8d8', 'S@e2']).startsWith('3k4/p7/8/8/8/8/8/R3K3[] b'), after(fen2, ['S@d2', 'e8d8', 'S@e2']));
  // T3 THE NULL RULE
  ms = movesAfter('4k3/p7/8/8/8/8/8/R3K3[ST] w - - 0 1 {S=w40,T=w43}', []);
  ok('T3: nothing to hit, no cast of either card', !casts(ms, 'S').length && !casts(ms, 'T').length, ms.join(','));
  // T4 CHECK BY DEMOLITION
  const fen4 = 'k7/7p/8/8/^7/8/8/R3K3[S] w - - 0 1 {S=w43}';
  ms = movesAfter(fen4, []);
  ok('T4: six anchors cover the crate on a4', same(casts(ms), ['S@a3', 'S@a4', 'S@a5', 'S@b3', 'S@b4', 'S@b5']), casts(ms).join(','));
  ok('T4: flooring a4 opens the a-file — black is in check after S@a4', checked(fen4, ['S@a4']) && after(fen4, ['S@a4']).startsWith('k7/7p/8/8/8/8/8/R3K3[] b'), after(fen4, ['S@a4']));
  ok('T4: the evasions alone: a8b7, a8b8', same(movesAfter(fen4, ['S@a4']), ['a8b7', 'a8b8']), movesAfter(fen4, ['S@a4']).join(','));
  ms = movesAfter('r6k/8/8/8/^7/8/1P6/K7[S] w - - 0 1 {S=w43}', []);
  ok('T4: a hit that would expose the caster\'s own king is illegal — no cast at all, four plain moves', !casts(ms).length && ms.length === 4, ms.join(','));
  // T5 THE LANCE (45: hit1 o ray; 46: ray2)
  const fen5 = '7k/p3#3/4^3/4*3/8/4*1*1/5_2/4K2R[S] w - - 0 1 {S=w45}';
  ms = movesAfter(fen5, []);
  ok('T5: two rays change something — north (S@e2) and north-east over the pit (S@f2)', same(casts(ms), ['S@e2', 'S@f2']), casts(ms).join(','));
  ok('T5: north — e3 and e5 crack, the crate on e6 is floor, the bedrock on e7 stops the ray', after(fen5, ['S@e2']).startsWith('7k/p3#3/8/4^3/8/4^1*1/5_2/4K2R[] b'), after(fen5, ['S@e2']));
  ok('T5: north-east over the pit — g3 cracks', after(fen5, ['S@f2']).startsWith('7k/p3#3/4^3/4*3/8/4*1^1/5_2/4K2R[] b'), after(fen5, ['S@f2']));
  const fen5c = fen5.replace('S=w45', 'S=w46');
  ok('T5: ray2 north — e3 cracks, e5 and e6 untouched', after(fen5c, ['S@e2']).startsWith('7k/p3#3/4^3/4*3/8/4^1*1/5_2/4K2R[] b'), after(fen5c, ['S@e2']));
  // T6 THE WALL and IMMUREMENT (stalemate is a loss)
  const fen6 = 'k*6/1*6/8/8/8/7p/7P/4K3[S] w - - 0 1 {S=w51}';
  ok('T6: S@a7 seals the pocket', after(fen6, ['S@a7']).startsWith('k*6/**6/8/8/8/7p/7P/4K3[] b'), after(fen6, ['S@a7']));
  ok('T6: black has no legal move after it', movesAfter(fen6, ['S@a7']).length === 0, movesAfter(fen6, ['S@a7']).join(','));
  ok('T6: wall x/o/x near — S@d2 raises d2 and d3 (d1 too)', after('4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w50}', ['S@d2']).startsWith('4k3/p7/8/8/8/3*4/3*4/R2*K3[] b'), after('4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w50}', ['S@d2']));
  // T7 THE PIT
  const fen7 = '4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w60}';
  ok('T7: S@f2 sinks f2 and g2', after(fen7, ['S@f2']).startsWith('4k3/p7/8/8/8/8/5__1/R3K3[] b'), after(fen7, ['S@f2']));
  ms = movesAfter(fen7, ['S@f2', 'e8d8']);
  ok('T7: the king does not step into the pit', !ms.includes('e1f2') && ms.includes('e1f1'), ms.filter((m) => m.startsWith('e1')).join(','));
  // T8 HARDEN
  const fen8 = '4k3/p7/8/8/8/8/3*4/R3K3[ST] w - - 0 1 {S=w71,T=w41}';
  ok('T8: S@d2 — d2 is bedrock', after(fen8, ['S@d2']).startsWith('4k3/p7/8/8/8/8/3#4/R3K3[T] b'), after(fen8, ['S@d2']));
  ok('T8: nothing left to smash', !casts(movesAfter(fen8, ['S@d2', 'e8d8']), 'T').length);
  // T9 THE SLEDGE
  const fen9 = '4k3/p7/8/8/8/8/3*4/R3K3[S] w - - 0 1 {S=w80}';
  ms = movesAfter(fen9, []);
  ok('T9: no hammer before the enchantment; the cast is on the king', !ms.includes('e1d2') && same(casts(ms), ['S@e1']), ms.join(','));
  ok('T9: S@e1 — the flag *w in the field, the card spent', after(fen9, ['S@e1']) === '4k3/p7/8/8/8/8/3*4/R3K3[] b - - 0 1 {*w}', after(fen9, ['S@e1']));
  ok('T9: white hammers now: e1d2 on offer', movesAfter(fen9, ['S@e1', 'e8d8']).includes('e1d2'));
  ok('T9: after the hammer d2 is a crate and the flag stays', after(fen9, ['S@e1', 'e8d8', 'e1d2']) === '3k4/p7/8/8/8/8/3^4/R3K3[] b - - 0 2 {*w}', after(fen9, ['S@e1', 'e8d8', 'e1d2']));
  b = new ffish.Board(V, fen9); b.push('S@e1'); b.push('e8d8'); b.push('e1d2');
  ok("T9: SAN 'K*d2' for the hammer", (b.pop(), b.sanMove('e1d2') === 'K*d2'), b.sanMove('e1d2'));
  b.delete();
  const fen9d = '4k3/p2*4/8/8/8/8/3*4/R3K3[] w - - 0 1 {*b}';
  ok('T9: under *b white has no hammer and black has e8d7', !movesAfter(fen9d, []).includes('e1d2') && movesAfter(fen9d, ['e1f1']).includes('e8d7'));
  // T10 THE DROP
  const fen10 = '4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w90}';
  ms = movesAfter(fen10, []);
  ok('T10: 47 pawn drops, every empty square of ranks 2-7', casts(ms).length === 47 && casts(ms).every((m) => '234567'.includes(m[3])), String(casts(ms).length));
  ok('T10: S@e2 — a pawn stands on e2, the card spent', after(fen10, ['S@e2']) === '4k3/p7/8/8/8/8/4P3/R3K3[] b - - 0 1', after(fen10, ['S@e2']));
  ok('T10: a pawn dropped on d4 gives check to a king on e5', checked('7p/8/8/4k3/8/8/8/R3K3[S] w - - 0 1 {S=w90}', ['S@d4']) && !checked('7p/8/8/4k3/8/8/8/R3K3[S] w - - 0 1 {S=w90}', ['S@e4']));
  ms = movesAfter('4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w91}', []);
  ok('T10: a knight near — eight empty squares within a king step of a1 or e1', casts(ms).length === 8 && casts(ms).every((m) => 'abdef'.includes(m[2]) && '12'.includes(m[3])), casts(ms).join(','));
  // T11 ICE anywhere / middle / margin / the legacy word
  const fen11 = '4k3/p7/8/8/8/8/8/R3K3[STUV] w - - 0 1 {S=w2,T=w3,U=w4,V=w1}';
  ms = movesAfter(fen11, []);
  ok('T11: ice anywhere — 64 anchors, the king rows included', casts(ms, 'S').length === 64, String(casts(ms, 'S').length));
  ok('T11: ice xox middle — 16 anchors on ranks 4 and 5', casts(ms, 'T').length === 16 && casts(ms, 'T').every((m) => '45'.includes(m[3])), String(casts(ms, 'T').length));
  ok('T11: ice x/o/x margin1 — 32 anchors on ranks 3-6', casts(ms, 'U').length === 32 && casts(ms, 'U').every((m) => '3456'.includes(m[3])), String(casts(ms, 'U').length));
  ok('T11: the legacy word — the 3x3 on the middle rows, 16 anchors', casts(ms, 'V').length === 16 && casts(ms, 'V').every((m) => '45'.includes(m[3])), String(casts(ms, 'V').length));
  ok('T11: S@e8 ices the enemy king row under him', after(fen11, ['S@e8']).endsWith('{~d7,~e7,~f7,~d8,~e8,~f8,T=w3,U=w4,V=w1}'), after(fen11, ['S@e8']));
  // T12 ICE UNDER A RAISED WALL IS CLEARED
  ok('T12: the wall on d4 e4 f4 clears the ice under it', after('4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {~e4,~f4,S=w51}', ['S@e4']) === '4k3/p7/8/8/3***2/8/8/R3K3[] b - - 0 1', after('4k3/p7/8/8/8/8/8/R3K3[S] w - - 0 1 {~e4,~f4,S=w51}', ['S@e4']));
  // T13 clipped at the edge
  ms = movesAfter('4k3/p7/8/8/8/8/8/*3K2R[S] w - - 0 1 {S=w43}', []);
  ok('T13: the clipped 3x3 covers a1 from a1 a2 b1 b2', same(casts(ms), ['S@a1', 'S@a2', 'S@b1', 'S@b2']), casts(ms).join(','));
  // T15 the field round-trips with both flags
  const fen15 = '4k3/p7/8/8/8/8/3*4/R3K3[STst] w - - 0 1 {d4-e5,~a2,w|20,S=w40,T=w80,b|41,S=b45,T=b60,*w,*b}';
  ok('T15: the field round-trips in the engine\'s order', after(fen15, []) === fen15, after(fen15, []));
  ok('T15: both enchanted — white hammers e1d2', movesAfter(fen15, []).includes('e1d2'));
  // T16 NO CARD IN CHECK
  ms = movesAfter('4k3/p7/8/8/8/8/3*4/r3K3[STU] w - - 0 1 {S=w40,T=w51,U=w90}', []);
  ok('T16: in check the king moves alone', ms.every((m) => m.startsWith('e1')) && !ms.some((m) => m.includes('@')), ms.join(','));
  // THE CHECK-FLAG SWEEP: isCheck after every legal move of the fixtures equals the engine's own gives_check (through push + isCheck, the game's reading)
  let sweep = 0, bad = 0;
  for (const [v, f] of [[V, fen], [V, fen4], [V, fen5], [V, fen6], [V, fen8], [V, fen9], [V, fen10], [V, fen11], [V, fen15], ['terrain10', 'r1bqkbn3/pppppp4/10/2*3*3/10/3^2^3/10/10/PPPPPP4/RNBQKB4[STUVstuv] w - - 0 1 {w|45.80.53.60,S=w40,T=w2,U=w50,V=w90,b|43.41,S=b42,T=b51,U=b61,V=b4}']]) {
    const bb = new ffish.Board(v, f);
    for (const m of moves(bb)) {
      const san = bb.sanMove(m);
      bb.push(m); sweep++;
      const chk = bb.isCheck();
      if (chk !== /\+$/.test(san) && !/#$/.test(san)) bad++;
      bb.pop();
    }
    bb.delete();
  }
  ok(`the check-flag sweep: SAN's + agrees with isCheck after every move (${sweep} moves)`, bad === 0, String(bad));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
