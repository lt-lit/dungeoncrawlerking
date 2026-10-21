// THE PIECE STATES GATE, ffish half — engine/patches/piece-states.patch
// (brief §4.10 "3.4 RULED", 2026-10-21): one record per piece — stun<n>
// (immobile for n plies, still attacks and defends, capturable), invincible<n>
// (nothing captures it, en passant and portal landings included; the pit still
// kills), control<n> (the piece changes colour and returns to its owner as the
// last act of the move the count runs out on, from wherever it stands; it
// counts for its OWNER in the extinction count), entomb (no clock: immobile,
// uncapturable, attacks nothing, a wall to every line and to the slide, never a
// landing's swap partner; freed by any hit). A new piece effect OVERWRITES the
// record whole (a controlled piece first returns to its owner). THE CLOCK is in
// plies: a record set this move does not tick on it; the frozen pass, the
// fizzle and the link ply tick nothing; the mulligan ticks; expiry is the
// move's last act. A cast, a hit that frees a block and a move a control
// returns on are judged on the board the move leaves — the return may give
// check, may resolve a check against the mover (a hammer included), and a move
// that would leave the returning piece on the mover's own king is illegal. No
// card in check (the designer's rule); kings are never targets.
//   FFISH_JS=/path/to/patched/ffish.js node engine/tests/test-states-ffish.cjs
// Every count was derived by the forge's independent Python oracle
// (engine/forge/oracle.py, grown for the states) and confirmed on the native
// build before the wasm ran it (engine/forge/native-test-states.py). The test
// variants are the forge's states.ini (terrain.ini's boards plus the
// piece-effect cards 100-131), read from disk so both gates share one
// definition.
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

  // S1 STUN (100: stun3 o any): the piece cannot move, still attacks and defends, can be taken; the clock in plies
  const S1 = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w100}';
  ok('validateFen accepts a record field (an invincible, a block, a control)', ffish.validateFen('4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%a1i5,%d1e,%d6c4w}', V) === 1, String(ffish.validateFen('4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%a1i5,%d1e,%d6c4w}', V)));
  let ms = movesAfter(S1, []);
  ok('S1: the casts are both non-king pieces, either colour (S@a1, S@d6), 13 piece moves beside: 15', same(casts(ms), ['S@a1', 'S@d6']) && ms.length === 15, ms.join(','));
  ok("S1: SAN 'S@d6'", sanAfter(S1, [], 'S@d6') === 'S@d6', sanAfter(S1, [], 'S@d6'));
  ok('S1: S@d6 — the record %d6s3, the card spent, no tick on the cast\'s own move', after(S1, ['S@d6']) === '4k3/8/3r4/8/8/8/8/R3K3[] b - - 0 1 {%d6s3}', after(S1, ['S@d6']));
  ms = movesAfter(S1, ['S@d6']);
  ok('S1: the stunned rook has no move — five king moves', ms.length === 5 && !ms.some((m) => m.startsWith('d6')), ms.join(','));
  ms = movesAfter(S1, ['S@d6', 'e8d8']);
  ok('S1: it still attacks — e1d1 and e1d2 are not on offer, e1f1 is', !ms.includes('e1d1') && !ms.includes('e1d2') && ms.includes('e1f1'), ms.join(','));
  ok('S1: the count fell with black\'s move: %d6s2', field(after(S1, ['S@d6', 'e8d8'])) === '{%d6s2}', after(S1, ['S@d6', 'e8d8']));
  ok('S1: and with white\'s: %d6s1', field(after(S1, ['S@d6', 'e8d8', 'a1a2'])) === '{%d6s1}', after(S1, ['S@d6', 'e8d8', 'a1a2']));
  ok('S1: at zero the stun ends as the move\'s last act — no record', !after(S1, ['S@d6', 'e8d8', 'a1a2', 'd8e8']).includes('{'), after(S1, ['S@d6', 'e8d8', 'a1a2', 'd8e8']));
  ok('S1: black has its rook back — 19 moves', movesAfter(S1, ['S@d6', 'e8d8', 'a1a2', 'd8e8', 'a2a1']).length === 19, String(movesAfter(S1, ['S@d6', 'e8d8', 'a1a2', 'd8e8', 'a2a1']).length));
  {
    const b = new ffish.Board(V, S1); b.push('S@d6'); b.push('e8d8'); b.push('a1a2'); b.push('d8e8');
    const gone = !b.fen().includes('{');
    b.pop(); const back1 = field(b.fen()) === '{%d6s1}'; b.pop(); b.pop(); const back3 = field(b.fen()) === '{%d6s3}'; b.pop();
    ok('S1: pop restores the record at every count and the card in hand', gone && back1 && back3 && b.fen() === S1, b.fen());
    b.delete();
  }
  const S1c = '4k3/8/3r4/8/8/8/8/3RK3[] w - - 0 1 {%d6s3}';
  ok('S1: a stunned piece is capturable (d1d6) and its record goes with it', movesAfter(S1c, []).includes('d1d6') && !after(S1c, ['d1d6']).includes('{'), after(S1c, ['d1d6']));

  // S2 INVINCIBLE (110: invincible5 o any): nothing captures it; it moves, attacks and gives check; the pit still kills
  const S2 = '4k3/8/3r4/8/8/8/8/3RK3[S] w - - 0 1 {S=w110}';
  ms = movesAfter(S2, []);
  ok('S2: the casts S@d1 and S@d6', same(casts(ms), ['S@d1', 'S@d6']), casts(ms).join(','));
  ok('S2: S@d6 — %d6i5', field(after(S2, ['S@d6'])) === '{%d6i5}', after(S2, ['S@d6']));
  ms = movesAfter(S2, ['S@d6', 'e8f8']);
  ok('S2: d1d6 is not on offer, d1d5 is; the count read 4 after black\'s move', !ms.includes('d1d6') && ms.includes('d1d5') && field(after(S2, ['S@d6', 'e8f8'])) === '{%d6i4}', ms.filter((m) => m.startsWith('d1')).join(','));
  const S2c = '4k3/8/R3r3/8/8/8/8/4K3[] w - - 0 1 {%e6i5}';
  ok('S2: check from an invincible rook — the checker cannot be taken, the king walks (d1 d2 f1 f2)', checked(S2c, []) && same(movesAfter(S2c, []), ['e1d1', 'e1d2', 'e1f1', 'e1f2']), movesAfter(S2c, []).join(','));
  const S2d = '4k3/3p4/8/4P3/8/8/8/4K3[] b - - 0 1 {%d7i5}';
  ok('S2: the record rides the double-stepping pawn: %d5i4', field(after(S2d, ['d7d5'])) === '{%d5i4}', after(S2d, ['d7d5']));
  ms = movesAfter(S2d, ['d7d5']);
  ok('S2: no en passant onto it — e5d6 is not on offer, e5e6 is', !ms.includes('e5d6') && ms.includes('e5e6'), ms.join(','));
  const S2f = '4k3/p7/8/8/7_/8/8/4K2R[] w - - 0 1 {~h2,~h3,%h1i5}';
  ok('S2: an invincible rook slides to the last empty ice before the pit (h1h3 on offer)', movesAfter(S2f, []).includes('h1h3'), movesAfter(S2f, []).join(','));
  ok('S2: the pit still kills — the rook is gone with its record', after(S2f, ['h1h3']).startsWith('4k3/p7/8/8/7_/8/8/4K3[] b') && !after(S2f, ['h1h3']).includes('%'), after(S2f, ['h1h3']));

  // S3 MIND CONTROL (120: control4 o any; 122: control3): the flip, the count by owner, the uses, the return judged on the move
  const S3 = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w120}';
  ok('S3: S@d6 — the rook is white, the record %d6c4b (it returns to black in four)', after(S3, ['S@d6']) === '4k3/8/3R4/8/8/8/8/R3K3[] b - - 0 1 {%d6c4b}', after(S3, ['S@d6']));
  ok('S3: black is not bare (the rook counts for its owner): three king moves', same(movesAfter(S3, ['S@d6']), ['e8e7', 'e8f7', 'e8f8']), movesAfter(S3, ['S@d6']).join(','));
  ok('S3: white uses the stolen rook (d6d2 among its moves); the count read 3', movesAfter(S3, ['S@d6', 'e8f8']).includes('d6d2') && field(after(S3, ['S@d6', 'e8f8'])) === '{%d6c3b}', after(S3, ['S@d6', 'e8f8']));
  ok('S3: the record rides the rook: %d2c2b', field(after(S3, ['S@d6', 'e8f8', 'd6d2'])) === '{%d2c2b}', after(S3, ['S@d6', 'e8f8', 'd6d2']));
  ms = movesAfter(S3, ['S@d6', 'e8f8', 'd6d2', 'f8e8']);
  ok('S3: with the return due, the moves that would leave the returning rook on the king\'s line are illegal (e1d1 e1e2 e1f2 d2d1 d2e2); e1f1 and d2d8 stand: 23', ['e1d1', 'e1e2', 'e1f2', 'd2d1', 'd2e2'].every((m) => !ms.includes(m)) && ms.includes('e1f1') && ms.includes('d2d8') && ms.length === 23, ms.join(','));
  ok('S3: after e1f1 the rook is black again, no record', after(S3, ['S@d6', 'e8f8', 'd6d2', 'f8e8', 'e1f1']).startsWith('4k3/8/8/8/8/8/3r4/R4K2[] b') && !after(S3, ['S@d6', 'e8f8', 'd6d2', 'f8e8', 'e1f1']).includes('{'), after(S3, ['S@d6', 'e8f8', 'd6d2', 'f8e8', 'e1f1']));
  const S3f = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {S=w122}';
  ok('S3: control3 — the rook returns on black\'s move and gives check from e6 (SAN Kg8+)', after(S3f, ['S@d6', 'e8f8', 'd6e6', 'f8g8']).startsWith('6k1/8/4r3/8/8/8/8/R3K3[] w') && checked(S3f, ['S@d6', 'e8f8', 'd6e6', 'f8g8']) && sanAfter(S3f, ['S@d6', 'e8f8', 'd6e6'], 'f8g8') === 'Kg8+', `${after(S3f, ['S@d6', 'e8f8', 'd6e6', 'f8g8'])} | ${sanAfter(S3f, ['S@d6', 'e8f8', 'd6e6'], 'f8g8')}`);
  ok('S3: the four king moves are the evasions', same(movesAfter(S3f, ['S@d6', 'e8f8', 'd6e6', 'f8g8']), ['e1d1', 'e1d2', 'e1f1', 'e1f2']), movesAfter(S3f, ['S@d6', 'e8f8', 'd6e6', 'f8g8']).join(','));
  const S3g = '4k3/8/8/3p4/8/8/P7/4K3[S] w - - 0 1 {S=w120}';
  ms = movesAfter(S3g, ['S@d5', 'e8f8']);
  ok('S3: a stolen pawn pushes white\'s way — d5d6 and the double step d5d7 (the camp runs to rank 7): nine moves', ms.includes('d5d6') && ms.includes('d5d7') && ms.length === 9, ms.join(','));
  ok('S3: the promotion then the return — a black queen on d8, no record, no check', after(S3g, ['S@d5', 'e8f8', 'd5d7', 'f8g8', 'd7d8q']).startsWith('3q2k1/8/8/8/8/8/P7/4K3[] b') && !after(S3g, ['S@d5', 'e8f8', 'd5d7', 'f8g8', 'd7d8q']).includes('{') && !checked(S3g, ['S@d5', 'e8f8', 'd5d7', 'f8g8', 'd7d8q']), after(S3g, ['S@d5', 'e8f8', 'd5d7', 'f8g8', 'd7d8q']));
  const S3i = '4k3/p7/8/8/8/8/4K3/r7[S] w - - 0 1 {%a1c3w,S=w120}';
  ok('S3: the recall — control cast on your own stolen rook brings it home, no record', movesAfter(S3i, []).includes('S@a1') && after(S3i, ['S@a1']).startsWith('4k3/p7/8/8/8/8/4K3/R7[] b') && !after(S3i, ['S@a1']).includes('{'), after(S3i, ['S@a1']));
  const S3j = '4k3/3R4/8/8/8/8/8/R3K3[] b - - 0 1 {%d7c4b}';
  ok('S3: the owner may take its stolen rook (e8d7) and is bare after it: no moves', movesAfter(S3j, []).includes('e8d7') && movesAfter(S3j, ['e8d7']).length === 0, movesAfter(S3j, ['e8d7']).join(','));

  // S4 ENTOMB (130: entomb o any): inert, uncapturable, a wall to lines and to the slide; freed by a hit
  const S4 = '4k3/8/3r4/8/8/8/8/3RK3[S] w - - 0 1 {S=w130}';
  ms = movesAfter(S4, []);
  ok('S4: the casts S@d1 and S@d6; S@d6 — %d6e, no count', same(casts(ms), ['S@d1', 'S@d6']) && field(after(S4, ['S@d6'])) === '{%d6e}', after(S4, ['S@d6']));
  ok('S4: black with an entombed rook — five king moves, the rook none', movesAfter(S4, ['S@d6']).length === 5, movesAfter(S4, ['S@d6']).join(','));
  ms = movesAfter(S4, ['S@d6', 'e8f8']);
  ok('S4: it attacks nothing (e1d2 on offer), nothing takes it (no d1d6), its square ends the file (no d1d7): 11 moves', ms.includes('e1d2') && !ms.includes('d1d6') && !ms.includes('d1d7') && ms.length === 11, ms.join(','));
  ok('S4: the block has no clock — the record stands after four plies', field(after(S4, ['S@d6', 'e8f8', 'e1d2', 'f8e8', 'd2e1'])) === '{%d6e}', after(S4, ['S@d6', 'e8f8', 'e1d2', 'f8e8', 'd2e1']));
  const S4c = '4k3/8/3r4/8/8/8/8/3RK3[S] w - - 0 1 {%d6e,S=w43}';
  ms = casts(movesAfter(S4c, []));
  ok('S4: a hit frees it (43: hit1 3x3 any) — the nine anchors whose 3x3 covers d6', ms.length === 9 && ms.every((m) => 'cde'.includes(m[2]) && '567'.includes(m[3])), ms.join(','));
  ok('S4: freed — a black rook on d6, no record', after(S4c, ['S@d6']).startsWith('4k3/8/3r4/8/8/8/8/3RK3[] b') && !after(S4c, ['S@d6']).includes('{'), after(S4c, ['S@d6']));
  ok('S4: freeing a piece onto your own king is illegal — no cast at all', !casts(movesAfter('4k3/8/8/8/8/8/8/3rK3[S] w - - 0 1 {%d1e,S=w43}', [])).length, movesAfter('4k3/8/8/8/8/8/8/3rK3[S] w - - 0 1 {%d1e,S=w43}', []).join(','));
  const S4e = '4k3/p3R3/8/8/8/8/8/4K3[S] w - - 0 1 {%e7e,S=w43}';
  ok('S4: freeing your own rook onto the enemy king gives check (SAN S@e6+)', checked(S4e, ['S@e6']) && sanAfter(S4e, [], 'S@e6') === 'S@e6+', sanAfter(S4e, [], 'S@e6'));
  ok('S4: the freed rook is capturable again — e8e7 among the evasions, with d8 and f8', same(movesAfter(S4e, ['S@e6']), ['e8e7', 'e8d8', 'e8f8']), movesAfter(S4e, ['S@e6']).join(','));
  ms = movesAfter('3rk3/8/3n4/8/8/8/8/3RK3[] w - - 0 1 {%d6e}', []);
  ok('S4: a wall to the line — the white rook\'s file ends at the block (no d1d6, no d1d8, d1d5 stands)', !ms.includes('d1d6') && !ms.includes('d1d8') && ms.includes('d1d5'), ms.filter((m) => m.startsWith('d1')).join(','));
  const S4g = '4k3/p7/8/n7/8/8/8/R3K3[] w - - 0 1 {~a2,~a3,~a4,%a5e}';
  ms = movesAfter(S4g, []);
  ok('S4: a wall to the slide — the rook\'s slide is listed at a4, never a1a5, and it rests on a4', ms.includes('a1a4') && !ms.includes('a1a5') && !ms.includes('a1a2') && after(S4g, ['a1a4']).startsWith('4k3/p7/8/n7/R7/8/8/4K3[] b'), after(S4g, ['a1a4']));
  ms = movesAfter('6k1/7n/8/8/8/8/8/2R1K3[] w - - 0 1 {c3-h7,%h7e}', []);
  ok('S4: a landing never swaps with an entombed twin — no c1c3; c1c2 stands; the line still ends at the body (no c1c4)', !ms.includes('c1c3') && ms.includes('c1c2') && !ms.includes('c1c4'), ms.filter((m) => m.startsWith('c1')).join(','));

  // S5 OVERWRITE: one state per piece; a controlled piece first returns to its owner
  const S5 = '4k3/8/3R4/8/8/8/8/R3K3[s] b - - 0 1 {%d6c4b,S=b100}';
  ok('S5: the owner stuns its stolen rook — the control ends: a black rook on d6, stunned for three', same(casts(movesAfter(S5, [])), ['S@a1', 'S@d6']) && after(S5, ['S@d6']) === '4k3/8/3r4/8/8/8/8/R3K3[] w - - 0 2 {%d6s3}', after(S5, ['S@d6']));
  ok('S5: the owner\'s invincibility as counterplay — it comes home and cannot be taken', after(S5.replace('S=b100', 'S=b110'), ['S@d6']) === '4k3/8/3r4/8/8/8/8/R3K3[] w - - 0 2 {%d6i5}', after(S5.replace('S=b100', 'S=b110'), ['S@d6']));
  ok('S5: the thief entombs the piece it holds — it goes back to its owner as a block', after('4k3/8/3R4/8/8/8/8/R3K3[S] w - - 0 1 {%d6c4b,S=w130}', ['S@d6']) === '4k3/8/3r4/8/8/8/8/R3K3[] b - - 0 1 {%d6e}', after('4k3/8/3R4/8/8/8/8/R3K3[S] w - - 0 1 {%d6c4b,S=w130}', ['S@d6']));
  const S5d = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {%d6s1,S=w100}';
  ok('S5: a recast refreshes — the count is three again', field(after(S5d, ['S@d6'])) === '{%d6s3}', after(S5d, ['S@d6']));
  ok('S5: a recast that changes nothing is no move — S@d6 not on offer, S@a1 is', same(casts(movesAfter(S5d.replace('%d6s1', '%d6s3'), [])), ['S@a1']), casts(movesAfter(S5d.replace('%d6s1', '%d6s3'), [])).join(','));
  ok('S5: a return onto your own king is illegal — stunning the stolen rook on e6 would return it onto e1: no cast', !casts(movesAfter('4k3/8/4R3/8/8/8/8/4K3[S] w - - 0 1 {%e6c4b,S=w100}', [])).length, movesAfter('4k3/8/4R3/8/8/8/8/4K3[S] w - - 0 1 {%e6c4b,S=w100}', []).join(','));
  const S5g = '4k3/p7/4r3/8/8/8/8/3K4[S] w - - 0 1 {%e6c4w,S=w100}';
  ok('S5: a return that gives check — stunning the rook black holds returns it to white on e6: check, four king evasions', checked(S5g, ['S@e6']) && same(movesAfter(S5g, ['S@e6']), ['e8d8', 'e8f8', 'e8d7', 'e8f7']), movesAfter(S5g, ['S@e6']).join(','));
  const S5h = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {%d6s3,S=w120}';
  ok('S5: control overwrites a stun — the rook is white\'s and free to move (d6d2)', field(after(S5h, ['S@d6'])) === '{%d6c4b}' && movesAfter(S5h, ['S@d6', 'e8f8']).includes('d6d2'), after(S5h, ['S@d6']));

  // S6 THE CLOCK: the half ticks, the pass and the link do not; the mulligan ticks
  const S6 = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {%d6s2,S=w10}';
  ok('S6: the half ticks — %d6s1 beside the open half', after(S6, ['S@b3']).includes('%d6s1') && after(S6, ['S@b3']).includes('b3w'), after(S6, ['S@b3']));
  ok('S6: the forced pass ticks nothing — still %d6s1', after(S6, ['S@b3', 'e8e8']).includes('%d6s1'), after(S6, ['S@b3', 'e8e8']));
  ok('S6: the link ticks nothing — still %d6s1, the pair stands', after(S6, ['S@b3', 'e8e8', 'S@g3']).includes('%d6s1') && after(S6, ['S@b3', 'e8e8', 'S@g3']).includes('b3-g3'), after(S6, ['S@b3', 'e8e8', 'S@g3']));
  ok('S6: black\'s move ticks it out', !after(S6, ['S@b3', 'e8e8', 'S@g3', 'e8f8']).includes('%'), after(S6, ['S@b3', 'e8e8', 'S@g3', 'e8f8']));
  const S6e = '4k3/8/3r4/8/8/8/8/R3K3[S] w - - 0 1 {w|101,%d6s2,S=w100}';
  ok('S6: the mulligan ticks — %d6s1, the hand redrawn (101)', movesAfter(S6e, []).includes('@@@@') && after(S6e, ['@@@@']).includes('%d6s1') && after(S6e, ['@@@@']).includes('S=w101'), after(S6e, ['@@@@']));

  // S7 THE FIELD ROUND-TRIPS, in square order after the flags
  const S7 = '4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%a1i5,%d1e,%d6c4w}';
  ok('S7: the field echoes', after(S7, []) === S7, after(S7, []));
  ok('S7: a record that cannot stand is dropped (an owner of the piece\'s own colour, a king, a zero stun, a count over 15)', !after('4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%d6c4b,%e8s3,%a1s0,%d1i20}', []).includes('{'), after('4k3/p7/3r4/8/8/8/8/R2RK3[] w - - 0 1 {%d6c4b,%e8s3,%a1s0,%d1i20}', []));

  // S8 NO CARD IN CHECK
  ms = movesAfter('4k3/8/8/8/8/8/P7/r3K3[STU] w - - 0 1 {S=w100,T=w120,U=w130}', []);
  ok('S8: in check the king moves alone — the three evasions, no stun, no control, no entomb', same(ms, ['e1d2', 'e1e2', 'e1f2']), ms.join(','));

  // S12 AN AREA STUN (101: stun3 3x3 any), S13 A RAY (104), S14 THE KING'S NEIGHBOURS (105)
  const S12 = '4k3/8/2nr4/2pq4/8/8/8/R3K3[S] w - - 0 1 {S=w101}';
  ok('S12: S@c5 stuns all four black pieces; five king moves and nothing else', field(after(S12, ['S@c5'])) === '{%c5s3,%d5s3,%c6s3,%d6s3}' && movesAfter(S12, ['S@c5']).length === 5, after(S12, ['S@c5']));
  const S13 = '4k3/8/8/8/4r3/8/P3n3/4K3[S] w - - 0 1 {S=w104}';
  ok('S13: a stun on a ray — the one ray with pieces on it (S@e2); the knight and the rook stunned, the king never', same(casts(movesAfter(S13, [])), ['S@e2']) && field(after(S13, ['S@e2'])) === '{%e2s3,%e4s3}', after(S13, ['S@e2']));
  const S14 = '4k3/8/8/8/8/8/P2rb3/4K3[S] w - - 0 1 {S=w105}';
  ok('S14: the king\'s neighbours — S@e1, e1f2, e1xd2 and the pawn\'s two; both neighbours stunned for four', same(movesAfter(S14, []), ['S@e1', 'e1f2', 'e1d2', 'a2a3', 'a2a4']) && field(after(S14, ['S@e1'])) === '{%d2s4,%e2s4}', after(S14, ['S@e1']));

  // S15 THE HAMMER UNDER A RETURN: in check from a stolen piece that returns with this move, the hammer stands
  const S15 = '4k3/p7/8/8/8/8/2n*4/4K3[] w - - 0 1 {*w,%c2c1w}';
  ok('S15: the hammer e1d2 and the four king steps — the return resolves the check', same(movesAfter(S15, []), ['e1d2', 'e1d1', 'e1f1', 'e1e2', 'e1f2']), movesAfter(S15, []).join(','));
  ok('S15: after the hammer (SAN K*d2): a crate on d2, the knight white again, the sledge flag alone, no check', sanAfter(S15, [], 'e1d2') === 'K*d2' && after(S15, ['e1d2']).startsWith('4k3/p7/8/8/8/8/2N^4/4K3[] b') && field(after(S15, ['e1d2'])) === '{*w}' && !checked(S15, ['e1d2']), after(S15, ['e1d2']));
  ok('S15: the same check with the return a ply later is a plain check — the four king steps, no hammer', same(movesAfter(S15.replace('%c2c1w', '%c2c2w'), []), ['e1d1', 'e1f1', 'e1e2', 'e1f2']), movesAfter(S15.replace('%c2c1w', '%c2c2w'), []).join(','));
  ok('S15: a second checker the return does not answer — three king steps off the file, no hammer', same(movesAfter('4r1k1/p7/8/8/8/8/2n*4/4K3[] w - - 0 1 {*w,%c2c1w}', []), ['e1d1', 'e1f1', 'e1f2']), movesAfter('4r1k1/p7/8/8/8/8/2n*4/4K3[] w - - 0 1 {*w,%c2c1w}', []).join(','));

  // THE CHECK-FLAG SWEEP: SAN's + after every legal move of the fixtures equals isCheck after the push (the game's reading), to two plies
  let sweep = 0, bad = 0;
  const S9 = 'r1bqkbn3/pppppp4/10/2*3*3/10/3^2^3/10/10/PPPPPP4/RNBQKB4[STUVstuv] w - - 0 1 {w|100.120.130.110,S=w101,T=w120,U=w130,V=w110,b|100.122,S=b100,T=b121,U=b131,V=b112}';
  for (const [v, f] of [[V, S1], [V, S2c], [V, S3], [V, S3f], [V, S4e], [V, S5], [V, S5g], [V, S6], [V, S7], [V, S12], [V, S14], [V, S15], ['states10', S9]]) {
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
