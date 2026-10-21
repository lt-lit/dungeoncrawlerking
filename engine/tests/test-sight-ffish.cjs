// THE SIGHT WORD GATE, ffish half — engine/patches/sight.patch (brief §4.10
// "3.4 RULED", the targeting ruling of 2026-10-21): `sight` (and `sight<n>`, a
// cap) as a targeting word of the card grammar — the anchor must be IN SIGHT of
// the caster's army: every square a queen standing on one of the caster's
// pieces could move onto, the first blocker on each line included (a piece of
// either colour, a crate, a wall, a pit, bedrock; a portal body ends the
// line). Every piece is an eye (a stunned or an entombed one too, a piece held
// under mind control for its holder); the enemy's pieces are nobody's eyes;
// the eye's own square is not in its sight. The word restricts the anchor
// alone — a shaped cast's cells follow the shape.
//   FFISH_JS=/path/to/patched/ffish.js node engine/tests/test-sight-ffish.cjs
// Every count was derived by the forge's independent Python oracle
// (engine/forge/oracle.py, grown for the sight) and confirmed on the native
// build before the wasm ran it (engine/forge/native-test-sight.py). The test
// variants are the forge's states.ini (the sight cards 140-147), read from
// disk so both gates share one definition.
const fs = require('fs'), path = require('path');
const FFISH_JS = process.env.FFISH_JS; if (!FFISH_JS) { console.error('set FFISH_JS=/path/to/patched/ffish.js'); process.exit(2); }
const INI = fs.readFileSync(path.join(__dirname, '..', 'forge', 'states.ini'), 'utf8');
const realFetch = global.fetch; delete global.fetch;
const Module = require(FFISH_JS);
Module.onRuntimeInitialized = () => { global.fetch = realFetch; run(Module); };

function run(ffish) {
  let pass = 0, fail = 0;
  const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
  ffish.loadVariantConfig(INI);
  const V = 'states8';
  const moves = (b) => b.legalMoves().split(' ').filter(Boolean).sort();
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  const after = (fen, mvs, v = V) => { const b = new ffish.Board(v, fen); for (const m of mvs) b.push(m); const f = b.fen(); b.delete(); return f; };
  const movesAfter = (fen, mvs, v = V) => { const b = new ffish.Board(v, fen); for (const m of mvs) b.push(m); const ms = moves(b); b.delete(); return ms; };
  const sanAfter = (fen, mvs, m, v = V) => { const b = new ffish.Board(v, fen); for (const x of mvs) b.push(x); const s = b.sanMove(m); b.delete(); return s; };
  const casts = (ms, slot = 'S') => ms.filter((m) => m.startsWith(slot + '@'));
  const checked = (fen, mvs, v = V) => { const b = new ffish.Board(v, fen); for (const m of mvs) b.push(m); const c = b.isCheck(); b.delete(); return c; };
  const field = (fen) => fen.includes('{') ? fen.slice(fen.indexOf('{')) : '';

  ok('validateFen accepts a sight card in hand', ffish.validateFen('r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w140}', V) === 1);

  // G1 THE LINE AND ITS BLOCKERS (140: stun3 o sight): the rook a1 and the king e1 the eyes
  const G1 = (a4, extra = '') => `r3k3/8/8/8/${a4}/8/8/R3K3[S] w - - 0 1 {S=w140${extra}}`;
  let ms = movesAfter(G1('8'), []);
  ok('G1a an open a-file: the rook a8 in sight up the file, the rook a1 along rank 1 from the king — S@a1, S@a8; 17 moves', same(casts(ms), ['S@a1', 'S@a8']) && ms.length === 17, ms.join(','));
  ms = movesAfter(G1('P7'), []);
  ok('G1b a pawn of yours on the line is an eye of its own: S@a1, S@a4, S@a8', same(casts(ms), ['S@a1', 'S@a4', 'S@a8']) && ms.length === 15, ms.join(','));
  ms = movesAfter(G1('*7'), []);
  ok('G1c a wall ends the line: S@a1 alone', same(casts(ms), ['S@a1']) && ms.length === 11, ms.join(','));
  ms = movesAfter(G1('p7'), []);
  ok('G1d an enemy piece is in sight and ends the line (no eye of yours): S@a1, S@a4', same(casts(ms), ['S@a1', 'S@a4']) && ms.length === 13, ms.join(','));
  ms = movesAfter(G1('^7'), []);
  ok('G1e a crate ends the line: S@a1 alone', same(casts(ms), ['S@a1']) && ms.length === 12, ms.join(','));
  ms = movesAfter(G1('_7'), []);
  ok('G1f a pit ends the line: S@a1 alone', same(casts(ms), ['S@a1']) && ms.length === 11, ms.join(','));
  ms = movesAfter(G1('#7'), []);
  ok('G1g bedrock ends the line: S@a1 alone', same(casts(ms), ['S@a1']) && ms.length === 11, ms.join(','));
  ms = movesAfter(G1('8', ',~a4'), []);
  ok('G1h a slippery square is no blocker: S@a1, S@a8', same(casts(ms), ['S@a1', 'S@a8']) && ms.length === 16, ms.join(','));
  ms = movesAfter('r3k3/8/8/8/8/8/8/N3K3[S] w - - 0 1 {S=w140}', []);
  ok('G1i every piece sees along queen lines, a knight too: S@a1, S@a8', same(casts(ms), ['S@a1', 'S@a8']) && ms.length === 9, ms.join(','));
  // G2 THE CAP (146: stun3 o sight2)
  ms = movesAfter('4k3/8/8/8/8/r7/8/R3K3[S] w - - 0 1 {S=w146}', []);
  ok('G2 sight2: the rook a3 within two of a1 is in sight, the rook a1 four from the king is not — S@a3 alone', same(casts(ms), ['S@a3']) && ms.length === 11, ms.join(','));
  ms = movesAfter('4k3/8/8/8/8/r7/8/R3K3[S] w - - 0 1 {S=w140}', []);
  ok('G2 without the cap: S@a1, S@a3', same(casts(ms), ['S@a1', 'S@a3']) && ms.length === 12, ms.join(','));
  ms = movesAfter('4k3/8/8/8/8/r7/8/R3K3[ST] w - - 0 1 {S=w146,T=w147}', []);
  ok('G12 an invincible card in sight beside it: T@a1 and T@a3 (sight, uncapped), the capped stun on a3 alone', same(casts(ms), ['S@a3']) && same(casts(ms, 'T'), ['T@a1', 'T@a3']) && ms.length === 13, ms.join(','));
  // G3 THE PORTAL BODY ends a line; a piece on the body is in sight
  ms = movesAfter('4k3/8/8/4n3/8/8/8/B3K3[S] w - - 0 1 {S=w140}', []);
  ok('G3a the knight e5 on the bishop\'s diagonal and the king\'s file: S@a1, S@e5', same(casts(ms), ['S@a1', 'S@e5']) && ms.length === 11, ms.join(','));
  ms = movesAfter('4k3/8/8/4n3/8/8/8/B3K3[S] w - - 0 1 {c3-e3,S=w140}', []);
  ok('G3b the pair c3-e3: a portal body ends each line short of e5 — S@a1 alone', same(casts(ms), ['S@a1']) && ms.length === 8, ms.join(','));
  ms = movesAfter('4k3/8/8/8/8/2n5/8/B3K3[S] w - - 0 1 {c3-e3,S=w140}', []);
  ok('G3c a knight on the body c3 is in sight: S@a1, S@c3', same(casts(ms), ['S@a1', 'S@c3']) && ms.length === 7, ms.join(','));
  // G4 A SHAPED CAST (143: stun3 xxx/xox/xxx sight): the anchor must be in sight, the cells follow the shape
  const G4 = '4k3/8/8/3n1n2/8/8/8/R3K3[S] w - - 0 1 {S=w143}';
  ms = movesAfter(G4, []);
  ok('G4 the 3x3 stun: anchors in sight whose 3x3 holds a piece — around the rook a1, and the knights through d4, e4, e5, e6, f6; never d5 or f5 themselves', same(casts(ms), ['S@a1', 'S@a2', 'S@b1', 'S@b2', 'S@d4', 'S@e4', 'S@e5', 'S@e6', 'S@f6']) && ms.length === 24, ms.join(','));
  ok('G4 S@e5 stuns both knights off the line: %d5s3,%f5s3', field(after(G4, ['S@e5'])) === '{%d5s3,%f5s3}', after(G4, ['S@e5']));
  // G5 A HIT IN SIGHT (144: hit1 o sight): the first wall on a line is the anchor
  const G5 = '2*1k2*/1p6/8/*7/8/8/8/R2*K3[S] w - - 0 1 {S=w144}';
  ms = movesAfter(G5, []);
  ok('G5 the walls d1 (rank 1), a5 (the a-file) and h8 (the long diagonal) are in sight, c8 is not: S@a5, S@d1, S@h8', same(casts(ms), ['S@a5', 'S@d1', 'S@h8']) && ms.length === 12, ms.join(','));
  ok('G5 S@h8 cracks the wall at the end of the diagonal', after(G5, ['S@h8']).startsWith('2*1k2^/'), after(G5, ['S@h8']));
  // G6 A WALL RAISED IN SIGHT (145: wall o sight): the empty squares on the lines
  const G6 = '4k3/1p6/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w145}';
  ms = movesAfter(G6, []);
  ok('G6 30 anchors on the lines; h7 on no line, e8 under the king; 45 moves', casts(ms).length === 30 && casts(ms).includes('S@a8') && casts(ms).includes('S@h8') && !casts(ms).includes('S@h7') && !casts(ms).includes('S@e8') && ms.length === 45, casts(ms).join(','));
  ok('G6 S@h8 raises stone at the diagonal\'s end', after(G6, ['S@h8']).startsWith('4k2*/'), after(G6, ['S@h8']));
  // G7 MIND CONTROL THROUGH SIGHT (141: control4 o sight): the stolen rook checks from where it stands
  const G7 = 'r3k3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w141}';
  ms = movesAfter(G7, []);
  ok('G7 the control casts on the rook a8 alone (your own a1 changes nothing)', same(casts(ms), ['S@a8']) && ms.length === 16, ms.join(','));
  ok('G7 S@a8 gives check (SAN S@a8+): the stolen rook strikes e8 along rank 8', checked(G7, ['S@a8']) && sanAfter(G7, [], 'S@a8') === 'S@a8+', sanAfter(G7, [], 'S@a8'));
  ok('G7 the record %a8c4b, the rook white\'s', after(G7, ['S@a8']).startsWith('R3k3/') && field(after(G7, ['S@a8'])) === '{%a8c4b}', after(G7, ['S@a8']));
  ok('G7 black has the three king steps off rank 8 and no cast', same(movesAfter(G7, ['S@a8']), ['e8d7', 'e8e7', 'e8f7']), movesAfter(G7, ['S@a8']).join(','));
  ms = movesAfter('3rk3/8/8/8/8/8/8/R3K3[S] w - - 0 1 {S=w141}', []);
  ok('G7d the rook d8 off every line: nothing in sight to steal', casts(ms).length === 0 && ms.length === 13, ms.join(','));
  // G8 THE ENEMY'S PIECES ARE NOBODY'S EYES
  ms = movesAfter('4k3/8/8/8/8/8/7r/R3K3[S] w - - 0 1 {S=w140}', []);
  ok('G8a the rook h2 sees your pieces; you do not see it: S@a1 alone', same(casts(ms), ['S@a1']) && ms.length === 13, ms.join(','));
  ms = movesAfter('4k3/8/8/8/8/7P/7r/R3K3[S] w - - 0 1 {S=w140}', []);
  ok('G8b a pawn of yours on h3 is an eye down the file (and itself on no other line): S@a1, S@h2', same(casts(ms), ['S@a1', 'S@h2']) && ms.length === 16, ms.join(','));
  // G9 A STOLEN PIECE IS ITS HOLDER'S EYE
  const G9 = '4k3/7n/8/8/7R/8/8/R3K3[S] w - - 0 1 {S=w140,%h4c3b}';
  ms = movesAfter(G9, []);
  ok('G9 the held rook sees up the h-file to the knight h7, and is itself seen from the king: S@a1, S@h4, S@h7', same(casts(ms), ['S@a1', 'S@h4', 'S@h7']) && ms.length === 31, ms.join(','));
  ok('G9 a stun on the held rook returns it to black, stunned (the overwrite)', after(G9, ['S@h4']).includes('/7r/') && field(after(G9, ['S@h4'])) === '{%h4s3}', after(G9, ['S@h4']));
  // G10 BLACK'S OWN SIGHT
  ms = movesAfter('4k3/1p6/8/8/8/8/8/R3K3[s] b - - 0 1 {S=b140}', []);
  ok('G10a the rook a1 is off both black eyes\' lines, the pawn b7 off the king\'s: no cast, 7 moves', casts(ms).length === 0 && ms.length === 7, ms.join(','));
  ms = movesAfter('4k3/1p6/8/8/R7/8/8/4K3[s] b - - 0 1 {S=b140}', []);
  ok('G10b the rook a4 on the king\'s diagonal e8-a4: S@a4', same(casts(ms), ['S@a4']) && ms.length === 8, ms.join(','));
  // G11 THE 10x10 DUEL SHAPE with sight decks: each pawn sees straight up its file across the gap
  const G11 = '4k5/pppp6/10/10/10/10/10/10/PPPP6/R3K5[STst] w - - 0 1 {w|144,S=w140,T=w141,S=b140,T=b143,b|142}';
  ms = movesAfter(G11, [], 'states10');
  ok('G11 the control casts on the enemy\'s front pawns a9-d9 and nothing behind them; the stun on those and your own; 29 moves', same(casts(ms, 'T'), ['T@a9', 'T@b9', 'T@c9', 'T@d9']) && same(casts(ms), ['S@a1', 'S@a2', 'S@a9', 'S@b2', 'S@b9', 'S@c2', 'S@c9', 'S@d2', 'S@d9']) && ms.length === 29, ms.join(','));
  ms = movesAfter('4k5/pppp6/10/10/10/10/10/10/P1PP6/R3K5[STst] w - - 0 1 {w|144,S=w140,T=w141,S=b140,T=b143,b|142}', [], 'states10');
  ok('G11b nothing of yours on the b-file: b9 drops out of sight', same(casts(ms, 'T'), ['T@a9', 'T@c9', 'T@d9']) && ms.length === 24, ms.join(','));
  ms = movesAfter('4k5/pppp6/10/10/10/10/10/10/P1PP6/RB2K5[STst] w - - 0 1 {w|144,S=w140,T=w141,S=b140,T=b143,b|142}', [], 'states10');
  ok('G11c a bishop on b1 under the open file sees b9 again', same(casts(ms, 'T'), ['T@a9', 'T@b9', 'T@c9', 'T@d9']) && casts(ms).includes('S@b9') && ms.length === 24, ms.join(','));

  // THE CHECK-FLAG SWEEP: SAN's + after every legal move of the fixtures equals isCheck after the push, to two plies
  let sweep = 0, bad = 0;
  for (const [v, f] of [[V, G1('8')], [V, G1('P7')], [V, G4], [V, G5], [V, G6], [V, G7], [V, G9], [V, '4k3/1p6/8/8/R7/8/8/4K3[s] b - - 0 1 {S=b140}'], ['states10', G11]]) {
    const bb = new ffish.Board(v, f);
    for (const m of moves(bb)) {
      const san = bb.sanMove(m);
      bb.push(m); sweep++;
      if (bb.isCheck() !== /\+$/.test(san) && !/#$/.test(san)) bad++;
      if (v === V) for (const m2 of moves(bb)) {
        const san2 = bb.sanMove(m2);
        bb.push(m2); sweep++;
        if (bb.isCheck() !== /\+$/.test(san2) && !/#$/.test(san2)) bad++;
        bb.pop();
      }
      bb.pop();
    }
    bb.delete();
  }
  ok(`the check-flag sweep: SAN's + agrees with isCheck after every move (${sweep} moves)`, bad === 0, String(bad));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
