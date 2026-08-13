// Spike 12 — Crumble legality filter (§4.5, §9.12).
//
// "Validate candidate collapse squares via ffish.js (§4.5): detect exposed-king
//  and instant-end positions cheaply enough to re-roll in real time on a phone."
//
// Tests the reusable filter in ./crumbleFilter.mjs and benchmarks it.
// Run: cd phase0 && node spikes/spike12-crumble-filter.mjs

import { loadFfish } from '../lib/load.mjs';
import { makeDuelVariantIni, buildDuelBoard, boardToFen } from '../lib/variant.mjs';
import { findSquares, getSquare, splitFen } from '../lib/fen.mjs';
import { validateCrumbleCandidate, collapseFen } from './crumbleFilter.mjs';

// --- tiny seeded RNG (mulberry32) for deterministic candidate sampling ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let failures = 0;
function check(name, cond, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`${tag} - ${name}${detail ? `  [${detail}]` : ''}`);
}

const ffish = await loadFfish();
console.log(`# ffish build: ${ffish.info()}`);

// Variants: baseline 8x8 duel, 8x8 + cannon (hopper exposure vector), 10x10 for benchmark.
const ini8 = makeDuelVariantIni({ name: 'cf8', files: 8, ranks: 8 });
const ini8c = makeDuelVariantIni({ name: 'cf8c', files: 8, ranks: 8, extra: { cannon: 'c' } });

const board10 = buildDuelBoard({
  files: 10, ranks: 10,
  walls: ['d4', 'e6', 'g5', 'c7', 'h3', 'f8'],
  white: { backRank: ['R', 'N', 'B', 'Q', 'K'], backRankStart: 2, row: 0 },
  black: { backRank: ['r', 'n', 'b', 'q', 'k'], backRankStart: 3, row: 9 },
});
const start10 = boardToFen(board10, { turn: 'w' });
const ini10 = makeDuelVariantIni({ name: 'cf10', files: 10, ranks: 10, extra: { startFen: start10 } });

ffish.loadVariantConfig(ini8 + '\n' + ini8c + '\n' + ini10);

// ---------------------------------------------------------------------------
// 0. API-surface facts the filter design rests on (documented in results doc).
// ---------------------------------------------------------------------------
{
  // Under extinctionPseudoRoyal, a position with the non-mover's king en prise is
  // NOT flagged by result()/isGameOver(); the king capture is just a legal move.
  const exposedFen = 'R3k3/8/8/8/8/8/8/4K3 w - - 0 1'; // Ra8 attacks ke8, white to move
  const b = new ffish.Board('cf8', exposedFen);
  const kingCaptureLegal = b.legalMoves().split(' ').includes('a8e8');
  check('API: pseudo-royal king capture is a legal move in exposed position', kingCaptureLegal);
  check('API: exposed position NOT detected by result(false)/isGameOver(false)',
    b.result(false) === '*' && b.isGameOver(false) === false,
    `result=${b.result(false)} → why the filter needs the flipped-turn isCheck() probe`);
  b.delete();
  const bf = new ffish.Board('cf8', 'R3k3/8/8/8/8/8/8/4K3 b - - 0 1');
  check('API: flipped-turn isCheck() detects the exposure', bf.isCheck() === true);
  bf.delete();
}

// ---------------------------------------------------------------------------
// 1. Exposure rejections.
// ---------------------------------------------------------------------------
{
  // (a) In-play-reachable exposure, EMPTY candidate: a cannon (hopper) gains an
  // attack when a wall appears as its hurdle. White cannon e1, empty e-file,
  // black king e8: collapsing empty e4 gives the cannon a hurdle → ke8 en prise.
  const fen = '4k3/8/8/8/8/8/8/K3C3 w - - 0 1';
  const pre = new ffish.Board('cf8c', fen);
  check('cannon setup: black king NOT attacked before collapse (position legal)',
    !pre.legalMoves().split(' ').includes('e1e8'));
  pre.delete();
  const r = validateCrumbleCandidate(ffish, 'cf8c', fen, 'e4');
  check('reject: empty-square collapse exposes non-mover king to cannon over new wall',
    r.ok === false && r.reason === 'exposes_king', `reason=${r.reason}`);

  // (b) Exposure detection on the OCCUPIED path: artificial pre-exposed position
  // (black king already en prise to Ra8, white to move); candidate is an occupied
  // black pawn square far away. Never reachable in legal play — proves the
  // detector fires regardless of how the exposure arose (defense in depth).
  const fen2 = 'R3k3/6p1/8/8/8/8/8/4K3 w - - 0 1';
  const r2 = validateCrumbleCandidate(ffish, 'cf8', fen2, 'g7');
  check('reject: occupied-square candidate in an already-exposed position',
    r2.ok === false && r2.reason === 'exposes_king', `reason=${r2.reason}`);

  // (c) Counter-case: eating a slider's shield does NOT expose, because the pit
  // itself blocks the line. White Rh1, black shield Nh5, black Kh8. Collapsing h5
  // removes the knight but the wall keeps h-file closed → accepted.
  const fen3 = '5k1r/8/8/7n/8/8/8/K6R w - - 0 1'; // wait: black king h8? see below
  void fen3;
  const fenShield = '7k/8/8/7n/8/8/8/K6R w - - 0 1'; // Rh1, nh5 shield, kh8
  const r3 = validateCrumbleCandidate(ffish, 'cf8', fenShield, 'h5');
  check('accept: eating a slider shield (pit blocks the line — no exposure possible)',
    r3.ok === true, `reason=${r3.reason}`);
  if (r3.ok) {
    const b3 = new ffish.Board('cf8', r3.collapsedFen);
    check('  …and rook is indeed still blocked at the new wall',
      !b3.legalMoves().split(' ').some((m) => m.startsWith('h1') && ['h5', 'h6', 'h7', 'h8'].includes(m.slice(2))));
    b3.delete();
  }
}

// ---------------------------------------------------------------------------
// 2. Instant-end rejections.
// ---------------------------------------------------------------------------
{
  // Instant checkmate: white Ka1 in check from ra8; b2 already a pit; the sole
  // escape is Kb1. Collapsing b1 mates the side to move.
  const fen = 'r7/8/8/5k2/8/8/1*6/K7 w - - 0 1';
  const pre = new ffish.Board('cf8', fen);
  check('mate setup: exactly one escape move before collapse', pre.legalMoves().trim() === 'a1b1',
    `moves=${pre.legalMoves()}`);
  pre.delete();
  const r = validateCrumbleCandidate(ffish, 'cf8', fen, 'b1');
  check('reject: collapse creates instant checkmate against side to move',
    r.ok === false && r.reason === 'instant_checkmate', `reason=${r.reason}`);

  // Instant stalemate: white Ka1 (not in check), black kc2 covers b1/b2; only
  // move is Ka2. Collapsing a2 leaves zero legal moves → stalemate (= loss under
  // stalemateValue=loss, still an instant end → reject).
  const fenS = '8/8/8/7p/8/8/2k5/K7 w - - 0 1';
  const preS = new ffish.Board('cf8', fenS);
  check('stalemate setup: exactly one move before collapse', preS.legalMoves().trim() === 'a1a2',
    `moves=${preS.legalMoves()}`);
  preS.delete();
  const rS = validateCrumbleCandidate(ffish, 'cf8', fenS, 'a2');
  check('reject: collapse creates instant stalemate (zero legal moves)',
    rS.ok === false && rS.reason === 'instant_stalemate', `reason=${rS.reason}`);

  // Any-immediate-result catch-all: eating the last non-king piece leaves K vs K,
  // which ffish adjudicates 1/2-1/2 (insufficient material) even with
  // claimDraw=false. The filter rejects it as an immediate result.
  const fenK = '8/8/4k3/4p3/8/8/8/K7 w - - 0 1';
  const rK = validateCrumbleCandidate(ffish, 'cf8', fenK, 'e5');
  check('reject: collapse to bare K-vs-K (ffish immediate insufficient-material result)',
    rK.ok === false && rK.reason.startsWith('instant_result'), `reason=${rK.reason}`);
}

// ---------------------------------------------------------------------------
// 3. King squares / structural rejections.
// ---------------------------------------------------------------------------
{
  const fen = '4k3/8/8/8/8/8/4*3/4K3 w - - 0 1';
  check('reject: white king current square',
    validateCrumbleCandidate(ffish, 'cf8', fen, 'e1').reason === 'king_square');
  check('reject: black king current square',
    validateCrumbleCandidate(ffish, 'cf8', fen, 'e8').reason === 'king_square');
  check('reject: square that is already a wall',
    validateCrumbleCandidate(ffish, 'cf8', fen, 'e2').reason === 'already_wall');
  check('reject: off-board square',
    validateCrumbleCandidate(ffish, 'cf8', fen, 'j4').reason === 'offboard');
}

// ---------------------------------------------------------------------------
// 4. Normal candidates accepted; check-but-not-mate accepted.
// ---------------------------------------------------------------------------
{
  const startFen = ffish.startingFen('cf8');
  const rEmpty = validateCrumbleCandidate(ffish, 'cf8', startFen, 'e4');
  check('accept: normal empty square (pacing crumble, e4 at startpos)', rEmpty.ok === true,
    `reason=${rEmpty.reason}`);
  check('  …collapsedFen returned has wall at e4 and ep cleared',
    rEmpty.ok && getSquare(rEmpty.collapsedFen, 'e4') === '*' && splitFen(rEmpty.collapsedFen).ep === '-');
  const rOcc = validateCrumbleCandidate(ffish, 'cf8', startFen, 'b7');
  check('accept: normal occupied square (pacing crumble eats the b7 pawn)', rOcc.ok === true,
    `reason=${rOcc.reason}`);
  check('  …occupant removed, square is wall',
    rOcc.ok && getSquare(rOcc.collapsedFen, 'b7') === '*');

  // A collapse that gives CHECK to the side to move (cannon behind new wall) but
  // leaves moves is a legal pressure crumble → must be ACCEPTED, not over-rejected.
  const fenChk = '4c3/8/8/8/8/8/8/4K2k w - - 0 1'; // black cannon e8 vs Ke1, empty e-file
  const rChk = validateCrumbleCandidate(ffish, 'cf8c', fenChk, 'e4');
  check('accept: collapse that merely gives check to the side to move', rChk.ok === true,
    `reason=${rChk.reason}`);
  if (rChk.ok) {
    const bC = new ffish.Board('cf8c', rChk.collapsedFen);
    check('  …side to move is in check and has escapes', bC.isCheck() && bC.numberLegalMoves() > 0,
      `nMoves=${bC.numberLegalMoves()}`);
    bC.delete();
  }
}

// ---------------------------------------------------------------------------
// 5. Repetition-crumble edge: the just-vacated square (empty by construction).
// ---------------------------------------------------------------------------
{
  const b = new ffish.Board('cf8', ffish.startingFen('cf8'));
  b.push('g1f3'); // knight leaves g1
  const fen = b.fen();
  b.delete();
  check('vacated square is empty in FEN', getSquare(fen, 'g1') === null);
  const r = validateCrumbleCandidate(ffish, 'cf8', fen, 'g1');
  check('accept: repetition-crumble candidate = square the piece just vacated', r.ok === true,
    `reason=${r.reason}`);
}

// ---------------------------------------------------------------------------
// 6. Benchmark on a realistic 10x10 walled midgame position.
// ---------------------------------------------------------------------------
{
  // Deterministic "midgame": from the 10x10 start, play 16 plies picking a
  // seeded-random legal move each ply (pure ffish, no engine needed).
  const rng = mulberry32(20260813);
  let b = new ffish.Board('cf10', start10);
  for (let ply = 0; ply < 16 && b.numberLegalMoves() > 0; ply++) {
    const moves = b.legalMoves().trim().split(' ');
    b.push(moves[Math.floor(rng() * moves.length)]);
  }
  const midFen = b.fen();
  b.delete();
  console.log(`# benchmark position (10x10, 6 terrain walls, after 16 plies): ${midFen}`);

  // Candidate pool: every board square (filter itself sorts out walls/kings).
  const all = findSquares(midFen, () => true).map((s) => s.name);
  const N = 1000;
  const t0 = performance.now();
  let accepted = 0, rejected = 0;
  const reasons = {};
  for (let i = 0; i < N; i++) {
    const sq = all[Math.floor(rng() * all.length)];
    const r = validateCrumbleCandidate(ffish, 'cf10', midFen, sq);
    if (r.ok) accepted++;
    else { rejected++; reasons[r.reason] = (reasons[r.reason] || 0) + 1; }
  }
  const ms = performance.now() - t0;
  const perCand = ms / N;
  console.log(`# benchmark: ${N} validations in ${ms.toFixed(1)} ms → ${perCand.toFixed(3)} ms/candidate, ${Math.round(N / (ms / 1000))} candidates/sec`);
  console.log(`# benchmark mix: ${accepted} accepted, ${rejected} rejected ${JSON.stringify(reasons)}`);
  check('benchmark: ≥100 candidates/sec even assuming a 10x slower phone (re-roll budget holds)',
    perCand * 10 < 10, `${perCand.toFixed(3)} ms/candidate here → ~${(perCand * 10).toFixed(2)} ms on a 10x-slower phone`);

  // Re-roll loop realism: time-to-first-accepted-candidate over 200 seeded rolls.
  const t1 = performance.now();
  let rolls = 0;
  for (let i = 0; i < 200; i++) {
    for (;;) {
      rolls++;
      const sq = all[Math.floor(rng() * all.length)];
      if (validateCrumbleCandidate(ffish, 'cf10', midFen, sq).ok) break;
    }
  }
  const ms1 = performance.now() - t1;
  console.log(`# re-roll loop: 200 crumbles resolved with ${rolls} total rolls (${(rolls / 200).toFixed(2)} rolls/crumble) in ${ms1.toFixed(1)} ms → ${(ms1 / 200).toFixed(3)} ms/crumble`);
  check('re-roll loop: a full crumble resolves within a few ms on a 10x-slower phone',
    (ms1 / 200) * 10 < 15, `${((ms1 / 200) * 10).toFixed(2)} ms projected/crumble on phone`);
}

console.log(failures === 0 ? '\nSPIKE 12: ALL CHECKS PASSED' : `\nSPIKE 12: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
