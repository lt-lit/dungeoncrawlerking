// Spike 4 — Dual loss condition: checkmate OR king capture (§4.4, §9.4).
// Originally verified extinctionValue=loss + extinctionPieceTypes=k +
// extinctionPseudoRoyal=true. The baseline has since moved to the NATIVE
// bare-army config (types=* count=1 pseudoRoyal=false — the engine plays
// for strips); fixtures were updated to give every "victim" a spare blocked
// piece, because bare-king positions are now decided at load — the original
// fixtures stopped testing mate/stalemate and started testing extinction.
// Verifies exactly which chess king-safety semantics survive, what the
// harness-facing game-end API is, and what happens in king-en-prise states
// (spike 12's filter is supposed to prevent them — this documents the
// failure mode if it has a bug).
import { loadFfish, loadEngine } from '../lib/load.mjs';
import { makeDuelVariantIni } from '../lib/variant.mjs';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${detail ? `  [${detail}]` : ''}`);
  cond ? pass++ : fail++;
};

const ffish = await loadFfish();
const engine = await loadEngine();
await engine.uci();
engine.setoption('Use NNUE', 'false');

// Variant zoo: baseline duel (pseudo-royal trio) + true-extinction alternative
const ini = [
  makeDuelVariantIni({ name: 'd4', files: 8, ranks: 8 }),
  makeDuelVariantIni({ name: 'd4ext', files: 8, ranks: 8, extra: { extinctionPseudoRoyal: 'false' } }),
].join('\n');
ffish.loadVariantConfig(ini);
await engine.loadVariantsIni(ini);

const legal = (b) => b.legalMoves().trim().split(/\s+/).filter(Boolean);

// ---- 1. King-safety semantics under pseudo-royal ---------------------------
console.log('\n--- 1. king-safety semantics (pseudo-royal) ---');
{
  // White Ke1 vs black Rh2 (attacks rank 2) + Ke8: into-check moves must be illegal
  const b = new ffish.Board('d4', '4k3/8/8/8/8/8/7r/4K3 w - - 0 1');
  const moves = legal(b);
  const intoRank2 = moves.filter((m) => m.startsWith('e1') && m[3] === '2');
  check('moving into check is illegal', intoRank2.length === 0, `king moves: ${moves.filter((m) => m.startsWith('e1')).join(',')}`);
  check('isCheck() false when not in check', !b.isCheck());
  b.delete();

  // Pinned piece may not expose king: white Ke1, Ne2 pinned by black Re8
  const b2 = new ffish.Board('d4', '4r1k1/8/8/8/8/8/4N3/4K3 w - - 0 1');
  const nMoves = legal(b2).filter((m) => m.startsWith('e2'));
  check('pinned piece cannot expose king', nMoves.length === 0, `Ne2 moves: ${nMoves.join(',') || 'none'}`);
  b2.delete();

  // In-check evasion: only check-resolving moves legal
  const b3 = new ffish.Board('d4', '4k3/8/8/8/8/8/4r3/4K3 w - - 0 1');
  check('isCheck() true in check', b3.isCheck());
  const evasions = legal(b3);
  check('in check, all moves resolve check (incl. RxK? no - capture rook or step aside)',
    evasions.every((m) => m.startsWith('e1')), `evasions: ${evasions.join(',')}`);
  b3.delete();
}

// ---- 2. Checkmate path -----------------------------------------------------
console.log('\n--- 2. checkmate ---');
{
  // Back-rank style mate-in-1: white Ra7+Rb1, black Kg8 boxed by own pawns? Keep it simple:
  // white Qg7 mate supported by Kg5... use ladder: white Ra1 Rb2, black Kh8 -> Rb2-b8? blocked? empty board ladder mate:
  const fen = '7k/8/8/8/8/8/1R6/R5K1 w - - 0 1'; // Rb2-b8# (Ra1 guards rank 1? need rank 8 cut) — actually Rb8+ Kh7... use two-rook ladder: Ra1 on a-file cuts nothing. Choose Q+K mate:
  const b = new ffish.Board('d4', '7k/p7/6QK/8/8/8/8/8 w - - 0 1'); // Qg6-g7# (Kh6 guards g7)
  const moves = legal(b);
  check('mate-in-1 available (g6g7 legal)', moves.includes('g6g7'), '');
  const san = b.sanMove('g6g7');
  check('SAN marks mate with #', san.endsWith('#'), `san=${san}`);
  engine.setoption('UCI_Variant', 'd4');
  engine.position({ fen: '7k/p7/6QK/8/8/8/8/8 w - - 0 1' });
  const res = await engine.go('depth 8');
  const score = engine.lastScore(res);
  check('engine finds mate 1', score?.type === 'mate' && score.value === 1 && res.bestmove === 'g6g7',
    `best=${res.bestmove} score=${JSON.stringify(score)}`);
  b.push('g6g7');
  check('after mate: numberLegalMoves === 0', b.numberLegalMoves() === 0);
  check('after mate: result(false) = 1-0', b.result(false) === '1-0', `result=${b.result(false)}`);
  b.delete();

  // Black delivers mate (both-sides symmetry)
  const bb = new ffish.Board('d4', '8/8/8/8/8/6qk/P7/7K b - - 0 1'); // black Qg3-g2#? Kh1, qg3 kh3: g3g2 mate
  const bmoves = legal(bb);
  check('black mate-in-1 available (g3g2)', bmoves.includes('g3g2'));
  bb.push('g3g2');
  check('black mate: result(false) = 0-1', bb.result(false) === '0-1', `result=${bb.result(false)}`);
  bb.delete();
}

// ---- 3. King capture path (post-surgery states) ----------------------------
console.log('\n--- 3. king capture (extinction) ---');
{
  // Constructed king-en-prise: WHITE to move, black king attacked by Qd5->e_8? place Qe4 attacking Ke8 on open e-file
  const fen = '4k3/p7/8/8/4Q3/8/8/4K3 w - - 0 1';
  check('ffish accepts king-en-prise FEN (validateFen)', ffish.validateFen(fen, 'd4') === 1, `v=${ffish.validateFen(fen, 'd4')}`);
  const b = new ffish.Board('d4', fen);
  const moves = legal(b);
  const kingCapture = moves.includes('e4e8');
  check('king capture is a LEGAL move in en-prise state', kingCapture, `e4e8 in moves: ${kingCapture}`);
  if (kingCapture) {
    b.push('e4e8');
    check('after king capture: game over (numberLegalMoves===0)', b.numberLegalMoves() === 0, `n=${b.numberLegalMoves()}`);
    check('after king capture: result 1-0 (extinction loss for black)', b.result(false) === '1-0', `result=${b.result(false)}`);
  }
  b.delete();
  // Engine in the same state: must take the king (or at least win instantly)
  engine.position({ fen });
  const res = await engine.go('depth 6');
  check('engine plays into extinction win from en-prise state',
    res.bestmove === 'e4e8' || engine.lastScore(res)?.type === 'mate',
    `best=${res.bestmove} score=${JSON.stringify(engine.lastScore(res))}`);

  // True-extinction alternative (pseudoRoyal=false): into-check moves STAY
  // illegal — the chess template's king remains royal regardless; extinction
  // settings add a loss condition but do not de-royalize. Making checks
  // meaningless would require redefining the king as a commoner (like FSF's
  // shipped 'extinction' variant: king = -, commoner = k), which discards
  // check/checkmate semantics wholesale. Confirms the pseudo-royal trio is
  // the right config, with no viable middle ground.
  const b2 = new ffish.Board('d4ext', '4k3/8/8/8/8/8/7r/4K3 w - - 0 1');
  const intoRank2 = legal(b2).filter((m) => m.startsWith('e1') && m[3] === '2');
  check('d4ext (pseudoRoyal=false): king STAYS royal (into-check still illegal)',
    intoRank2.length === 0, `into-rank2: ${intoRank2.join(',') || 'none'}`);
  b2.delete();
}

// ---- 4. Stalemate = loss ---------------------------------------------------
console.log('\n--- 4. stalemate as loss ---');
{
  // Classic corner stalemate: black Ka8, white Kb6+Qc7 -> black to move has no moves, NOT in check
  const fen = 'k7/2Q5/1K6/8/7p/7P/8/8 b - - 0 1';
  const b = new ffish.Board('d4', fen);
  check('stalemate position: numberLegalMoves === 0', b.numberLegalMoves() === 0, `n=${b.numberLegalMoves()}`);
  check('stalemated side NOT in check', !b.isCheck());
  check('stalemate result 1-0 (loss for stalemated black)', b.result(false) === '1-0', `result=${b.result(false)}`);
  b.delete();
  // Mirror: white stalemated
  const fen2 = '8/8/8/7p/7P/1k6/2q5/K7 w - - 0 1';
  const b2 = new ffish.Board('d4', fen2);
  check('mirror stalemate result 0-1 (loss for stalemated white)', b2.numberLegalMoves() === 0 && b2.result(false) === '0-1', `result=${b2.result(false)}`);
  b2.delete();

  // Engine steers INTO stalemate as a win: white to move, Qb5-c6?? no —
  // position where stalemate-in-1 exists: white Kb6 Qh7, black Ka8. Qh7-c7? no that's from above.
  // Qh7->b7 would be mate-ish? Kb6+Qb7 is MATE (king adjacent). Use Kb6, Qh2, black Ka8:
  // Qh2-c7 gives the corner stalemate (not check, black king a8 has no moves).
  engine.position({ fen: 'k7/8/1K6/8/7p/7P/7Q/8 w - - 0 1' });
  const res = await engine.go('depth 10');
  const score = engine.lastScore(res);
  check('engine scores stalemate-in-reach as mate-like win', score?.type === 'mate' && score.value > 0,
    `best=${res.bestmove} score=${JSON.stringify(score)}`);
  // Verify the engine's chosen line actually ends the game quickly
  const b3 = new ffish.Board('d4', 'k7/8/1K6/8/7p/7P/7Q/8 w - - 0 1');
  check('engine bestmove legal in stalemate-steering position', legal(b3).includes(res.bestmove), `best=${res.bestmove}`);
  b3.delete();
  // Direct proof stalemate is scored as a WIN by search: restrict the engine
  // to ONLY the stalemating move (h2c7 reaches the corner stalemate verified
  // above) — it must report mate 1, i.e. stalemate delivery == mate delivery.
  engine.position({ fen: 'k7/8/1K6/8/7p/7P/7Q/8 w - - 0 1' });
  const resSm = await engine.go('depth 6 searchmoves h2c7');
  const scoreSm = engine.lastScore(resSm);
  check('engine scores the stalemating move itself as mate 1',
    resSm.bestmove === 'h2c7' && scoreSm?.type === 'mate' && scoreSm.value === 1,
    `best=${resSm.bestmove} score=${JSON.stringify(scoreSm)}`);
}

console.log(`\nSPIKE 4: ${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECKS FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
