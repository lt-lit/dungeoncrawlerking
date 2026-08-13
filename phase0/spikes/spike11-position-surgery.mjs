// Spike 11 — Mid-game position surgery (§4.5, §9.11).
//
// "Edit FEN between plies (add walls, remove a piece, clear ep), reload, and
//  confirm the engine continues sanely from arbitrary rewritten positions."
//
// Phases:
//   A. Engine self-play ~20 plies (depth 6, deterministic) on a 9x8 walled duel
//      variant; ffish Board is the FEN source of truth.
//   B. Crumble cadence loop: from ply 20, every 3 plies (every 2 past ply 80) the
//      harness rewrites the FEN (alternating wall-on-empty / eat-a-piece, ep
//      cleared each time), rebuilds the ffish board, re-feeds the engine, and
//      play continues to completion. Candidates are vetted with the spike-12
//      filter (spikes/crumbleFilter.mjs) — the same coupling live play will use.
//   C. Walls are FEN-level, not config-level: FENs whose wall set differs from
//      the variant's startFen validate and behave coherently.
//   D. Wall semantics on surgered positions: sliders blocked, nothing moves onto
//      a wall, knights jump over.
//   E. engine `go perft 1` vs ffish numberLegalMoves() on surgered positions,
//      including one with a pocket.
//
// Run: cd phase0 && node spikes/spike11-position-surgery.mjs

import { loadFfish, loadEngine } from '../lib/load.mjs';
import { makeDuelVariantIni, buildDuelBoard, boardToFen } from '../lib/variant.mjs';
import { setSquare, getSquare, splitFen, findSquares } from '../lib/fen.mjs';
import { validateCrumbleCandidate } from './crumbleFilter.mjs';

const SEED = 20260813;
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

let failures = 0;
function check(name, cond, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`${tag} - ${name}${detail ? `  [${detail}]` : ''}`);
}

// --- setup: 9x8 duel variant, formation start WITHOUT walls in the config -----
const FILES = 9, RANKS = 8, VARIANT = 'duel11';
const formation = buildDuelBoard({
  files: FILES, ranks: RANKS,
  white: { backRank: ['R', 'N', 'B', 'K', 'Q'], backRankStart: 2, row: 0 },
  black: { backRank: ['r', 'n', 'b', 'k', 'q'], backRankStart: 2, row: RANKS - 1 },
});
const startNoWalls = boardToFen(formation, { turn: 'w' });
// terrain walls live only in the game FEN (check C: walls are FEN-level)
const TERRAIN = ['d4', 'f5'];
let startWithWalls = startNoWalls;
for (const w of TERRAIN) startWithWalls = setSquare(startWithWalls, w, '*');

const iniMain = makeDuelVariantIni({ name: VARIANT, files: FILES, ranks: RANKS, extra: { startFen: startNoWalls } });
const iniPocket = makeDuelVariantIni({
  name: 'duel11p', files: FILES, ranks: RANKS,
  extra: {
    startFen: startNoWalls, pieceDrops: 'true', capturesToHand: 'false',
    whiteDropRegion: '*1 *2', blackDropRegion: `*${RANKS - 1} *${RANKS}`, pocketSize: '2',
  },
});
const combinedIni = iniMain + '\n' + iniPocket;

const ffish = await loadFfish();
ffish.loadVariantConfig(combinedIni);
const engine = await loadEngine();
await engine.uci();
engine.setoption('Use NNUE', 'false'); // hard constraint §2.3 — classical eval only
await engine.loadVariantsIni(combinedIni);
await engine.isready();
console.log(`# ffish build: ${ffish.info()}`);
console.log(`# variant: ${VARIANT} ${FILES}x${RANKS}, terrain walls ${TERRAIN.join(',')} (FEN-only)`);
console.log(`# start FEN: ${startWithWalls}`);

async function engineMove(fen, depth = 6) {
  engine.send('ucinewgame');
  await engine.isready();
  engine.position({ variant: VARIANT, fen });
  const res = await engine.go(`depth ${depth}`);
  return { bestmove: res.bestmove, score: engine.lastScore(res) };
}

async function enginePerft1(variant, fen) {
  engine.position({ variant, fen });
  const lines = await engine.sendUntil('go perft 1', (l) => l.startsWith('Nodes searched'));
  const m = lines[lines.length - 1].match(/Nodes searched:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

// ---------------------------------------------------------------------------
// Phases A + B: self-play with the crumble cadence loop.
// ---------------------------------------------------------------------------
let board = new ffish.Board(VARIANT, startWithWalls);
const surgeries = [];
const skippedSurgeries = [];
const issues = [];
const perftFens = [];
let plies = 0;
let movesChecked = 0, movesLegal = 0, scoresSane = 0, epClearedOk = 0;
let end = null, finalResult = null;
let sawEpField = false;
const MAX_PLIES = 300;

while (plies < MAX_PLIES) {
  if (board.numberLegalMoves() === 0) {
    end = 'no_moves';
    finalResult = board.result(false);
    break;
  }
  const adj = board.result(false);
  if (adj !== '*') {
    end = `ffish_adjudication(${adj})`; // e.g. bare-kings insufficient material — see results doc
    finalResult = adj;
    break;
  }

  // crumble cadence: onset ply 20; every 3 plies, every 2 past ply 80
  const cadence = plies >= 80 ? 2 : 3;
  if (plies >= 20 && (plies - 20) % cadence === 0) {
    const preferred = surgeries.length % 2 === 0 ? 'wall' : 'eat';
    const fen = board.fen();
    if (splitFen(fen).ep !== '-') sawEpField = true;
    // Try the preferred surgery type; if no candidate survives the filter
    // (e.g. the only remaining eat would leave bare kings), fall back to the
    // other type — the harness must keep crumbling either way.
    let done = null, type = preferred;
    for (const t of [preferred, preferred === 'wall' ? 'eat' : 'wall']) {
      const candidates = findSquares(fen, (cell) =>
        t === 'wall'
          ? cell === null
          : cell !== null && cell !== '*' && cell.replace('+', '').toLowerCase() !== 'k'
      ).map((s) => s.name);
      for (const sq of shuffle(candidates)) {
        const r = validateCrumbleCandidate(ffish, VARIANT, fen, sq);
        if (r.ok) { done = { sq, newFen: r.collapsedFen }; type = t; break; }
      }
      if (done) break;
    }
    if (!done) {
      skippedSurgeries.push({ ply: plies, type: preferred });
    } else {
      const { sq, newFen } = done;
      if (ffish.validateFen(newFen, VARIANT) !== 1) issues.push(`ply ${plies}: surgered FEN invalid: ${newFen}`);
      if (splitFen(newFen).ep === '-') epClearedOk++;
      else issues.push(`ply ${plies}: ep not cleared: ${newFen}`);
      board.delete();
      board = new ffish.Board(VARIANT, newFen); // fresh board from rewritten FEN
      if (board.numberLegalMoves() === 0) issues.push(`ply ${plies}: filter let through an instant end`);
      surgeries.push({ ply: plies, type, sq, fen: newFen });
      if (perftFens.length < 4 && surgeries.length % 2 === 1) perftFens.push({ label: `after surgery #${surgeries.length} (${type} ${sq}, ply ${plies})`, fen: newFen });
    }
  }

  const fenNow = board.fen();
  // deeper search in the eroded endgame so the engine actually converts
  // (mate/stalemate nets need a bit more depth than shuffling does)
  const { bestmove, score } = await engineMove(fenNow, plies >= 100 ? 10 : 6);
  movesChecked++;
  if (!bestmove || bestmove === '(none)') {
    issues.push(`ply ${plies}: engine returned '${bestmove}' on ${fenNow}`);
    break;
  }
  const legal = board.legalMoves().trim().split(/\s+/).includes(bestmove);
  if (legal) movesLegal++;
  else {
    issues.push(`ply ${plies}: bestmove ${bestmove} NOT legal in ${fenNow}`);
    break;
  }
  if (score && (score.type === 'mate' || Math.abs(score.value) < 30000)) scoresSane++;
  else issues.push(`ply ${plies}: insane score ${JSON.stringify(score)}`);
  board.push(bestmove);
  plies++;
}
if (!end && plies >= MAX_PLIES) end = 'ply_cap';

console.log(`# game: ${plies} plies, end=${end}, result=${finalResult}, surgeries=${surgeries.length} (${surgeries.filter((s) => s.type === 'wall').length} wall-adds, ${surgeries.filter((s) => s.type === 'eat').length} piece-eats), skipped=${skippedSurgeries.length}`);
console.log(`# surgeries: ${surgeries.map((s) => `${s.type}@${s.sq}(p${s.ply})`).join(' ')}`);
console.log(`# final FEN: ${board.fen()}`);
if (issues.length) console.log('# issues:\n#   ' + issues.join('\n#   '));

check('A: self-play reached the crumble onset (>= 20 plies played)', plies >= 20, `${plies} plies`);
check('B: multiple surgeries performed in one continuing game', surgeries.length >= 4, `${surgeries.length} surgeries`);
check('B: both surgery types exercised (wall-add and piece-eat)',
  surgeries.some((s) => s.type === 'wall') && surgeries.some((s) => s.type === 'eat'));
check('B: every engine bestmove was legal per ffish (incl. immediately after each surgery)',
  movesChecked > 0 && movesLegal === movesChecked, `${movesLegal}/${movesChecked}`);
check('B: every reported score finite/sane (|cp| < 30000 or mate)', scoresSane === movesChecked, `${scoresSane}/${movesChecked}`);
check('B: ep field cleared by every surgery', epClearedOk === surgeries.length, `${epClearedOk}/${surgeries.length}`);
check('B: game played to completion (no crash, no ply-cap bailout)',
  end === 'no_moves' || (end && end.startsWith('ffish_adjudication')), `end=${end}, result=${finalResult}`);
check('B: no per-ply issues recorded', issues.length === 0, issues.slice(0, 3).join(' | '));
console.log(`# note: ep field observed in a pre-surgery FEN during play: ${sawEpField}`);

// ---------------------------------------------------------------------------
// Phase C: walls are FEN-level — FEN wall set may differ from variant startFen.
// ---------------------------------------------------------------------------
{
  check('C: variant startFen has no walls', !ffish.startingFen(VARIANT).includes('*'),
    ffish.startingFen(VARIANT));
  check('C: validateFen accepts FEN with walls the variant startFen lacks',
    ffish.validateFen(startWithWalls, VARIANT) === 1);
  const b = new ffish.Board(VARIANT, startWithWalls);
  const moves = b.legalMoves().trim().split(/\s+/);
  const wallTargets = moves.filter((m) => {
    const mm = m.match(/^[a-l]\d{1,2}([a-l]\d{1,2})/);
    return mm && TERRAIN.includes(mm[1]);
  });
  check('C: legalMoves coherent — no move lands on a FEN-only wall', wallTargets.length === 0,
    `${moves.length} moves, wall targets: ${wallTargets.join(',') || 'none'}`);
  const sanCount = b.legalMovesSan().trim().split(/\s+/).length;
  check('C: SAN coherent — legalMovesSan count matches legalMoves count', sanCount === moves.length,
    `${sanCount} vs ${moves.length}`);
  check('C: SAN of a specific move renders', b.sanMove(moves[0]).length > 0, `${moves[0]} → ${b.sanMove(moves[0])}`);
  check('C: board.fen() round-trips the walls', TERRAIN.every((w) => getSquare(b.fen(), w) === '*'), b.fen());
  b.delete();
}

// ---------------------------------------------------------------------------
// Phase D: wall semantics on surgered positions (§4.5 Notes).
// ---------------------------------------------------------------------------
{
  // Slider block: white Ra1, surgered wall a4, nothing else on the a-file.
  const fenRook = '8k/9/9/9/*8/9/9/R3K4 w - - 0 1';
  check('D: surgered slider-block FEN validates', ffish.validateFen(fenRook, VARIANT) === 1);
  const b = new ffish.Board(VARIANT, fenRook);
  const moves = b.legalMoves().trim().split(/\s+/);
  const rookFile = moves.filter((m) => m.startsWith('a1a')).map((m) => m.slice(2)).sort();
  check('D: rook stops under the new wall (a2,a3 only — blocked at a4)',
    rookFile.join(',') === 'a2,a3', `a-file rook moves: ${rookFile.join(',')}`);
  check('D: nothing may move onto the wall square',
    !moves.some((m) => /^[a-l]\d{1,2}a4/.test(m)), `${moves.length} legal moves`);
  b.delete();

  // Knight ring: knight d4 fully ringed by 8 surgered walls — all 8 jumps clear.
  const fenKnight = 'k8/9/9/2***4/2*N*4/2***4/9/7K1 w - - 0 1';
  check('D: knight-ring FEN validates', ffish.validateFen(fenKnight, VARIANT) === 1);
  const b2 = new ffish.Board(VARIANT, fenKnight);
  const nMoves = b2.legalMoves().trim().split(/\s+/).filter((m) => m.startsWith('d4'));
  const expected = ['d4b3', 'd4b5', 'd4c2', 'd4c6', 'd4e2', 'd4e6', 'd4f3', 'd4f5'];
  check('D: knight ringed by 8 walls keeps all 8 jumps (leapers jump over pits)',
    JSON.stringify(nMoves.sort()) === JSON.stringify(expected),
    `knight moves: ${nMoves.join(',')}`);
  const allMoves = b2.legalMoves().trim().split(/\s+/);
  const wallSquares = findSquares(fenKnight, (c) => c === '*').map((s) => s.name);
  check('D: no move (knight or king) lands on any of the 8 ring walls',
    !allMoves.some((m) => {
      const mm = m.match(/^[a-l]\d{1,2}([a-l]\d{1,2})/);
      return mm && wallSquares.includes(mm[1]);
    }));
  b2.delete();
}

// ---------------------------------------------------------------------------
// Phase E: engine `go perft 1` vs ffish legalMoves on surgered positions.
// ---------------------------------------------------------------------------
{
  const cases = [
    { label: 'start FEN with terrain walls', variant: VARIANT, fen: startWithWalls },
    ...perftFens.map((p) => ({ label: p.label, variant: VARIANT, fen: p.fen })),
    { label: 'final position of the crumble game', variant: VARIANT, fen: board.fen() },
    { label: 'slider-block construction', variant: VARIANT, fen: '8k/9/9/9/*8/9/9/R3K4 w - - 0 1' },
    { label: 'knight-ring construction', variant: VARIANT, fen: 'k8/9/9/2***4/2*N*4/2***4/9/7K1 w - - 0 1' },
  ];
  for (const c of cases) {
    const b = new ffish.Board(c.variant, c.fen);
    const ffishCount = b.numberLegalMoves();
    b.delete();
    const perft = await enginePerft1(c.variant, c.fen);
    check(`E: perft 1 == ffish legalMoves — ${c.label}`, perft === ffishCount,
      `engine ${perft} vs ffish ${ffishCount}`);
  }

  // Pocket variant: knight removed from d1 into the white pocket, surgered wall e4.
  let pocketFen = setSquare(startNoWalls, 'd1', null);
  pocketFen = setSquare(pocketFen, 'e4', '*');
  const f = splitFen(pocketFen);
  f.pocket = 'Nn';
  const { joinFen } = await import('../lib/fen.mjs');
  const pfen = joinFen(f);
  check('E: pocket FEN validates on drops variant', ffish.validateFen(pfen, 'duel11p') === 1, pfen);
  const bp = new ffish.Board('duel11p', pfen);
  const pMoves = bp.legalMoves().trim().split(/\s+/);
  const drops = pMoves.filter((m) => m.includes('@'));
  const ffishCount = bp.numberLegalMoves();
  bp.delete();
  check('E: pocket position generates drop moves', drops.length > 0, `${drops.length} drops, e.g. ${drops.slice(0, 3).join(' ')}`);
  const perft = await enginePerft1('duel11p', pfen);
  check('E: perft 1 == ffish legalMoves — surgered position WITH pocket', perft === ffishCount,
    `engine ${perft} vs ffish ${ffishCount}`);
}

board.delete();
engine.quit();
console.log(failures === 0 ? '\nSPIKE 11: ALL CHECKS PASSED' : `\nSPIKE 11: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
