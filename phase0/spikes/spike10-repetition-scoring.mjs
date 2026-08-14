// Spike 10 — In-search repetition scoring [load-bearing — do first]
//
// Brief §9.10: With nFoldRule = 0, confirm the engine does not *privately*
// score repetition lines as draws inside search (Stockfish-lineage cycle
// detection is separate from the rule). If that belief survives config, a
// losing engine will deliberately loop and farm crumbles — the exact failure
// §4.5 forbids. Plan B if un-disableable: nFoldValue = loss + fire the
// repetition crumble at the *second* occurrence.
//
// Run: cd /home/user/dungeoncrawlerking/phase0 && node spikes/spike10-repetition-scoring.mjs
//
// Test geometry (all deterministic, no RNG):
//
// KNIGHT LOOP (8x8 duel arena with walls a7,b7,c7,c8):
//   White: Ka2, Nd7.  Black: Ka8, Qh4, Rg4, Rh5.  White to move, down Q+2R vs N.
//   White has a fully FORCED perpetual: Nb6+ Kb8 Nd7+ Ka8 ... (black king is
//   boxed by walls, black's replies are single legal moves; no black piece
//   attacks b6/d7; knight checks cannot be blocked). Position classes:
//     S  = P(Nd7,Ka8, w)  <- root         A' = P(Nb6,Ka8, b) (check)
//     W1 = P(Nb6,Kb8, w)                  B1 = P(Nd7,Kb8, b) (check)
//
// QUEEN PERPETUAL (plain 8x8, no walls — also runnable on built-in 'chess'):
//   White: Kh2, Qe2.  Black: Kg8, Pg7, Qa1, Rb4.  White to move, down a rook.
//   Forced perpetual: Qe8+ Kh7 Qh5+ Kg8 Qe8+ ... (escapes covered, no blocks,
//   no captures of the checking queen available to black).
import { loadFfish, loadEngine } from '../lib/load.mjs';
import { makeDuelVariantIni } from '../lib/variant.mjs';

const KNIGHT_FEN = 'k1*5/***N4/8/7r/6rq/8/K7/8 w - - 0 1'; // class S
const A_FEN = 'k1*5/***5/1N6/7r/6rq/8/K7/8 b - - 0 1'; // class A' (Nb6+, btm)
const B1_FEN = '1k*5/***N4/8/7r/6rq/8/K7/8 b - - 0 1'; // class B1 (Nd7+, btm)
const CYCLE = ['d7b6', 'a8b8', 'b6d7', 'b8a8']; // S -> A' -> W1 -> B1 -> S
const CYCLE_FROM_A = ['a8b8', 'b6d7', 'b8a8', 'd7b6']; // A' -> W1 -> B1 -> S -> A'

const QUEEN_FEN = '6k1/6p1/8/8/1r6/8/4Q2K/q7 w - - 0 1';
const QENTRY = 'e2e8';

// White Kc4 Qb5 vs Black Kh1 + an inert blocked pawn (a3, blocked by Pa2):
// under the native bare-army baseline a BARE king is decided at load, so the
// "winning side mates normally" fixtures need the victim un-bared.
const KQK_FEN = '8/8/8/1Q6/2K5/p7/P7/7k w - - 0 1';

const checks = [];
function check(id, desc, pass, detail = '') {
  checks.push({ id, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${desc}${detail ? ' — ' + detail : ''}`);
}
function note(msg) {
  console.log(`      ${msg}`);
}
const fmt = (s) => (s ? (s.type === 'cp' ? `cp ${s.value}` : `mate ${s.value}`) : 'no-score');
const isDrawish = (s) => s && s.type === 'cp' && Math.abs(s.value) <= 60;
const isClearlyNeg = (s) => s && ((s.type === 'cp' && s.value <= -400) || (s.type === 'mate' && s.value < 0));
const isClearlyPos = (s) => s && ((s.type === 'cp' && s.value >= 400) || (s.type === 'mate' && s.value > 0));
const isMatePlus = (s) => s && s.type === 'mate' && s.value > 0;
const isMateMinus = (s) => s && s.type === 'mate' && s.value < 0;

let ffish, eng;

function gameState(board) {
  return {
    over: board.isGameOver(),
    overClaim: board.isGameOver(true),
    result: board.result(),
    resultClaim: board.result(true),
    turn: board.turn() ? 'w' : 'b',
  };
}

/** Play moves on a fresh board, returning per-ply game state. */
function stepGame(variant, fen, moves) {
  const b = new ffish.Board(variant, fen);
  const timeline = [{ ply: 0, move: null, ...gameState(b) }];
  for (let i = 0; i < moves.length; i++) {
    if (!b.push(moves[i])) {
      b.delete();
      throw new Error(`illegal move ${moves[i]} at ply ${i + 1} on ${variant} ${fen}`);
    }
    timeline.push({ ply: i + 1, move: moves[i], ...gameState(b) });
  }
  b.delete();
  return timeline;
}

function firstOver(timeline, claim = true) {
  return timeline.find((t) => (claim ? t.overClaim : t.over)) ?? null;
}

async function analyze({ variant, fen, moves = [], go = 'depth 12', fresh = true, timeout = 120000 }) {
  if (fresh) {
    eng.send('ucinewgame');
    await eng.isready();
  }
  eng.position({ variant, fen, moves });
  await eng.isready();
  const res = await eng.go(go, { timeout });
  const score = eng.lastScore(res);
  const pvLine = [...res.infoLines].reverse().find((l) => l.includes(' pv '));
  const pv = pvLine ? pvLine.split(' pv ')[1] : '';
  return { score, bestmove: res.bestmove, pv };
}

async function perft1(variant, fen) {
  eng.send('ucinewgame');
  await eng.isready();
  eng.position({ variant, fen });
  await eng.isready();
  const lines = await eng.sendUntil('go perft 1', (l) => l.startsWith('Nodes searched'));
  return parseInt(lines[lines.length - 1].match(/Nodes searched:\s*(\d+)/)[1], 10);
}

async function main() {
  ffish = await loadFfish();
  eng = await loadEngine();
  const uciLines = await eng.uci();
  const engName = (uciLines.find((l) => l.startsWith('id name')) ?? 'id name ?').slice(8);
  console.log(`# ffish.js: ${ffish.info()}`);
  console.log(`# engine:   ${engName}`);
  const repOpts = uciLines.filter((l) => /^option name .*(fold|repet|draw|cycle)/i.test(l));
  console.log(`# UCI options mentioning fold/repetition/draw/cycle: ${repOpts.length ? repOpts.join(' | ') : 'NONE (no engine-side switch for in-search repetition scoring)'}`);

  // ---- Variant zoo -------------------------------------------------------
  const ini = [
    // Plan A as the brief originally specified: nFoldRule=0 with DEFAULT nFoldValue
    // (=draw). Pinned explicitly because lib/variant.mjs's baseline was updated to
    // A-prime (nFoldValue=loss) as a result of this spike — this variant must keep
    // demonstrating the dead config.
    makeDuelVariantIni({ name: 'duela', files: 8, ranks: 8, extra: { nFoldValue: 'draw' } }),
    makeDuelVariantIni({ name: 'duelctl', files: 8, ranks: 8, extra: { nFoldRule: '3', nFoldValue: 'draw' } }), // control: rep draws ON
    makeDuelVariantIni({ name: 'duelb', files: 8, ranks: 8, extra: { nFoldRule: '3', nFoldValue: 'loss' } }), // Plan B symmetric
    makeDuelVariantIni({ name: 'duelb0', files: 8, ranks: 8, extra: { nFoldRule: '0', nFoldValue: 'loss' } }), // is value live with rule=0?
    makeDuelVariantIni({ name: 'duelbabs', files: 8, ranks: 8, extra: { nFoldRule: '3', nFoldValue: 'loss', nFoldValueAbsolute: 'true' } }),
    makeDuelVariantIni({ name: 'duelbabswin', files: 8, ranks: 8, extra: { nFoldRule: '3', nFoldValue: 'win', nFoldValueAbsolute: 'true' } }),
  ].join('\n');
  ffish.loadVariantConfig(ini);
  await eng.loadVariantsIni(ini);
  eng.setoption('Use NNUE', 'false'); // hard constraint §2.3 — classical eval only
  await eng.isready();

  // ---- S0: sanity — geometry, legality, forcedness ----------------------
  {
    const b = new ffish.Board('duela', KNIGHT_FEN);
    const nFfish = b.numberLegalMoves();
    b.delete();
    const nPerft = await perft1('duela', KNIGHT_FEN);
    check('S0a', 'knight-loop FEN: ffish legal move count == engine perft 1', nFfish === nPerft, `ffish=${nFfish} perft=${nPerft}`);

    // forcedness of the loop: black has exactly one legal reply at A' and B1
    const bA = new ffish.Board('duela', KNIGHT_FEN);
    bA.push('d7b6');
    const mA = bA.legalMoves().trim();
    bA.push('a8b8');
    bA.push('b6d7');
    const mB = bA.legalMoves().trim();
    bA.delete();
    check('S0b', 'knight loop is forced (black has exactly 1 legal reply to each check)', mA === 'a8b8' && mB === 'b8a8', `after Nb6+: [${mA}], after Nd7+: [${mB}]`);

    const bQ = new ffish.Board('duela', QUEEN_FEN);
    bQ.push('e2e8');
    const q1 = bQ.legalMoves().trim();
    bQ.push('g8h7');
    bQ.push('e8h5');
    const q2 = bQ.legalMoves().trim();
    bQ.delete();
    check('S0c', 'queen perpetual is forced (black has exactly 1 legal reply to each check)', q1 === 'g8h7' && q2 === 'h7g8', `after Qe8+: [${q1}], after Qh5+: [${q2}]`);
  }

  // ---- E1: Plan A — does the losing side score its forced loop as 0.00? --
  console.log('\n== E1: Plan A (nFoldRule=0) — in-search scoring of a forced loop, losing side to move ==');
  const e1 = {};
  for (const d of [8, 10, 12, 14]) {
    const r = await analyze({ variant: 'duela', fen: KNIGHT_FEN, go: `depth ${d}` });
    e1[d] = r;
    note(`duela knight root depth ${d}: score ${fmt(r.score)} bestmove ${r.bestmove} pv ${r.pv.split(' ').slice(0, 8).join(' ')}`);
  }
  let e1d16 = null;
  try {
    e1d16 = await analyze({ variant: 'duela', fen: KNIGHT_FEN, go: 'depth 16', timeout: 90000 });
    note(`duela knight root depth 16: score ${fmt(e1d16.score)} bestmove ${e1d16.bestmove}`);
  } catch {
    note('depth 16 probe timed out (>90s) — skipped, depths 8-14 carry the result');
  }
  const e1Loop = await analyze({ variant: 'duela', fen: KNIGHT_FEN, go: 'depth 12 searchmoves d7b6' });
  note(`duela knight LOOP LINE ONLY (searchmoves d7b6) depth 12: score ${fmt(e1Loop.score)} pv ${e1Loop.pv.split(' ').slice(0, 8).join(' ')}`);
  const e1qFull = await analyze({ variant: 'duela', fen: QUEEN_FEN, go: 'depth 12' });
  const e1qLoop = await analyze({ variant: 'duela', fen: QUEEN_FEN, go: 'depth 12 searchmoves e2e8' });
  note(`duela queen root depth 12: score ${fmt(e1qFull.score)} bestmove ${e1qFull.bestmove}`);
  note(`duela queen LOOP LINE ONLY (searchmoves e2e8) depth 12: score ${fmt(e1qLoop.score)}`);

  const planAScores = [e1[8], e1[10], e1[12], e1[14], e1Loop, e1qFull, e1qLoop].map((r) => r.score);
  const planADead = planAScores.every(isDrawish);
  const planAAlive = planAScores.every(isClearlyNeg);
  check('E1', 'Plan A measurement is determinate (all loop scores agree: either all ~0.00 or all clearly losing)', planADead || planAAlive,
    planADead
      ? 'ALL scores are cp 0 -> in-search repetition draw-scoring is ACTIVE despite nFoldRule=0 -> PLAN A IS DEAD'
      : planAAlive
        ? 'scores stay clearly negative -> Plan A alive'
        : `mixed/indeterminate: ${planAScores.map(fmt).join(', ')}`);

  // ---- E3 (run before E2 so controls validate the method first) ----------
  console.log('\n== E3: Controls — same positions where repetition draws ARE live must score ~0.00 ==');
  const cChessFull = await analyze({ variant: 'chess', fen: QUEEN_FEN, go: 'depth 12' });
  const cChessLoop = await analyze({ variant: 'chess', fen: QUEEN_FEN, go: 'depth 12 searchmoves e2e8' });
  note(`chess queen root depth 12: ${fmt(cChessFull.score)} bestmove ${cChessFull.bestmove} pv ${cChessFull.pv.split(' ').slice(0, 6).join(' ')}`);
  note(`chess queen loop-only depth 12: ${fmt(cChessLoop.score)}`);
  check('E3a', 'control (built-in chess): losing side scores the perpetual ~0.00 and prefers it', isDrawish(cChessLoop.score) && isDrawish(cChessFull.score),
    `full ${fmt(cChessFull.score)}, loop-only ${fmt(cChessLoop.score)}`);

  const cCtlLoop = await analyze({ variant: 'duelctl', fen: KNIGHT_FEN, go: 'depth 12 searchmoves d7b6' });
  const cCtlFull = await analyze({ variant: 'duelctl', fen: KNIGHT_FEN, go: 'depth 12' });
  note(`duelctl (duel rules + nFoldRule=3 draw) knight loop-only depth 12: ${fmt(cCtlLoop.score)}; full: ${fmt(cCtlFull.score)} bestmove ${cCtlFull.bestmove}`);
  check('E3b', 'control (duel variant with nFoldRule=3): walled knight loop scores ~0.00', isDrawish(cCtlLoop.score) && isDrawish(cCtlFull.score),
    `loop-only ${fmt(cCtlLoop.score)}, full ${fmt(cCtlFull.score)}`);
  const cCtlQ = await analyze({ variant: 'duelctl', fen: QUEEN_FEN, go: 'depth 12 searchmoves e2e8' });
  check('E3c', 'control (duelctl): queen perpetual scores ~0.00', isDrawish(cCtlQ.score), fmt(cCtlQ.score));

  // ---- E2: move-history occurrences fed via `position ... moves` ---------
  console.log('\n== E2: root game history — does a 2nd real occurrence snap the score to 0? ==');
  const e2 = {};
  for (const d of [10, 12, 14]) {
    e2[d] = await analyze({ variant: 'duela', fen: KNIGHT_FEN, moves: CYCLE, go: `depth ${d}` });
    note(`duela knight + 1 full cycle in history (root = 2nd occurrence of S) depth ${d}: ${fmt(e2[d].score)} bestmove ${e2[d].bestmove}`);
  }
  const e2Loop = await analyze({ variant: 'duela', fen: KNIGHT_FEN, moves: CYCLE, go: 'depth 12 searchmoves d7b6' });
  note(`duela occ2-history loop-only depth 12: ${fmt(e2Loop.score)}`);
  const e2All = [e2[10], e2[12], e2[14], e2Loop].map((r) => r.score);
  check('E2a', 'Plan A + occ2 history: measurement determinate and consistent with E1 (draw-scored iff E1 was)',
    planADead ? e2All.every(isDrawish) : e2All.every(isClearlyNeg),
    `d10..d14 full: ${[10, 12, 14].map((d) => fmt(e2[d].score)).join(', ')}; loop-only: ${fmt(e2Loop.score)}${planADead ? ' — draw-scored with root-history occurrences too' : ''}`);

  const e2c = await analyze({ variant: 'duelctl', fen: KNIGHT_FEN, moves: CYCLE, go: 'depth 10 searchmoves d7b6' });
  check('E2b', 'control (duelctl): with occ2 in history, loop line is an immediate ~0.00', isDrawish(e2c.score), fmt(e2c.score));

  // duela: 2 full cycles (3rd occurrence already ARRIVED) — must not adjudicate
  const tlA = stepGame('duela', KNIGHT_FEN, [...CYCLE, ...CYCLE, ...CYCLE]);
  const overA = firstOver(tlA);
  check('E2c', 'Plan A (ffish): nFoldRule=0 never adjudicates — 3 full cycles, isGameOver stays false', overA === null,
    overA ? `game over at ply ${overA.ply} result ${overA.resultClaim}` : 'no game end through 12 plies / 4 occurrences of S');
  const e2deep = await analyze({ variant: 'duela', fen: KNIGHT_FEN, moves: [...CYCLE, ...CYCLE], go: 'depth 10' });
  check('E2d', 'Plan A (engine): searches sanely from a position whose 3rd occurrence already arrived', !!e2deep.bestmove && !!e2deep.score,
    `score ${fmt(e2deep.score)} bestmove ${e2deep.bestmove}`);

  // ---- E4: Plan B semantics (nFoldValue) ---------------------------------
  console.log('\n== E4: Plan B — nFoldValue semantics (who loses?) and engine behavior ==');
  // (a) ffish adjudication: WHO loses, and at exactly which ply?
  const tlB = stepGame('duelb', KNIGHT_FEN, [...CYCLE, ...CYCLE, ...CYCLE.slice(0, 2)]);
  const oB = firstOver(tlB);
  check('E4a', 'duelb (nFoldRule=3, nFoldValue=loss): game adjudicated at the 3rd occurrence of the root position (ply 8)', !!oB && oB.ply === 8,
    oB ? `over at ply ${oB.ply}, result "${oB.resultClaim}" (claim), "${oB.result}" (no claim), side to move: ${oB.turn}` : 'never adjudicated');
  if (oB) {
    note(`SEMANTICS: at ply 8 the thrice-occurred position has ${oB.turn} to move; result ${oB.resultClaim} => ${oB.resultClaim === '0-1' ? 'the SIDE TO MOVE loses; the mover who completed the repetition WINS' : oB.resultClaim === '1-0' ? 'the side to move WINS (mover who completed it loses)' : 'unexpected'}`);
  }
  // mirror: rotate the cycle so the thrice-repeated class has BLACK to move
  const tlB2 = stepGame('duelb', A_FEN, [...CYCLE_FROM_A, ...CYCLE_FROM_A]);
  const oB2 = firstOver(tlB2);
  check('E4b', 'duelb mirror (loop rooted at a black-to-move position): black-to-move class triples first, result flips', !!oB2 && oB2.ply === 8 && oB2.turn === 'b' && oB2.resultClaim !== (oB ? oB.resultClaim : ''),
    oB2 ? `over at ply ${oB2.ply}, result "${oB2.resultClaim}", side to move: ${oB2.turn}` : 'never adjudicated');

  // (b) nFoldValue with nFoldRule=0 — dead or alive?
  const tlB0 = stepGame('duelb0', KNIGHT_FEN, [...CYCLE, ...CYCLE, ...CYCLE]);
  const oB0 = firstOver(tlB0);
  check('E4c', 'duelb0 (nFoldRule=0 + nFoldValue=loss): nFoldValue is DEAD when nFoldRule=0 (no adjudication in 3 cycles)', oB0 === null,
    oB0 ? `unexpectedly over at ply ${oB0.ply} result ${oB0.resultClaim}` : 'nFoldValue requires nFoldRule > 0');

  // (b2) THE DISCOVERY: nFoldRule=0 kills adjudication, but a non-draw nFoldValue
  // ALSO disables the in-search repetition/cycle DRAW-scoring. Together
  // (nFoldRule=0 + nFoldValue=loss) the engine simply searches THROUGH loops and
  // returns the honest eval — exactly the semantics Plan A wanted. "Plan A-prime".
  const b0probe = await analyze({ variant: 'duelb0', fen: KNIGHT_FEN, go: 'depth 10 searchmoves d7b6' });
  check('E4c2', 'PLAN A-PRIME (nFoldRule=0 + nFoldValue=loss): loop line gets an honest lost eval — no draw-scoring, no adjudication',
    isClearlyNeg(b0probe.score) && b0probe.score.type === 'cp',
    `loop-only ${fmt(b0probe.score)} (cp, not 0.00, not mate)`);

  // (c) absolute variants
  const oAbs = firstOver(stepGame('duelbabs', KNIGHT_FEN, [...CYCLE, ...CYCLE]));
  const oAbsW = firstOver(stepGame('duelbabswin', KNIGHT_FEN, [...CYCLE, ...CYCLE]));
  const oAbsB = firstOver(stepGame('duelbabs', A_FEN, [...CYCLE_FROM_A, ...CYCLE_FROM_A]));
  check('E4d', 'nFoldValueAbsolute=true: result is fixed from White POV regardless of which class triples',
    !!oAbs && !!oAbsW && !!oAbsB && oAbs.resultClaim === '0-1' && oAbsB.resultClaim === '0-1' && oAbsW.resultClaim === '1-0',
    `abs-loss w-to-move: ${oAbs?.resultClaim}, abs-loss b-to-move: ${oAbsB?.resultClaim}, abs-win: ${oAbsW?.resultClaim}`);

  // (d) engine, Plan B symmetric: IN-SEARCH the engine adjudicates at the FIRST
  // re-visit (2-fold, upstream cycle detection) and applies nFoldValue relative to
  // the side to move at the repeated node. The mover completing the repeat picks
  // the parity — so the LOSING side sees its own forced loop as a forced WIN
  // (mate +3: adjudication at ply 5, the first 2-fold whose earlier occurrence
  // lies inside the search tree). Symmetric nFoldValue=loss is therefore WORSE
  // than Plan A: the engine chases loops believing it is mating.
  const b1 = await analyze({ variant: 'duelb', fen: KNIGHT_FEN, go: 'depth 10 searchmoves d7b6' });
  note(`duelb fresh root, loop-only: ${fmt(b1.score)} (in-search 2-fold adjudication, mover picks parity)`);
  check('E4e', 'symmetric Plan B engine: losing side scores its own forced loop as a forced WIN (mate+) via in-search 2-fold parity', isMatePlus(b1.score), fmt(b1.score));
  const b1f = await analyze({ variant: 'duelb', fen: KNIGHT_FEN, go: 'depth 12' });
  check('E4f', 'symmetric Plan B engine: full search from a dead-lost position CHASES the loop (bestmove = loop move, mate+ score)', isMatePlus(b1f.score) && b1f.bestmove === 'd7b6',
    `score ${fmt(b1f.score)} bestmove ${b1f.bestmove} — believes it is winning while down Q+2R`);

  // (e) engine, Plan B symmetric: the mover COMPLETING the 3rd occurrence wins
  const hist7 = [...CYCLE, 'd7b6', 'a8b8', 'b6d7']; // 7 plies, black to move at B1 occ2, forced b8a8 -> S occ3
  const b2 = await analyze({ variant: 'duelb', fen: KNIGHT_FEN, moves: hist7, go: 'depth 5' });
  check('E4g', 'Plan B engine: completing the 3rd occurrence is scored as an immediate WIN for the mover (mate +1)', isMatePlus(b2.score) && b2.score.value === 1,
    `black to move, forced b8a8 closes the loop: ${fmt(b2.score)}`);

  // (f) THE FARMING HAZARD: symmetric nFoldValue=loss lets a losing engine WIN by repetition
  // history: root A' (black to move, occ1) + a8b8 => engine(white) to move at W1.
  // Loop b6d7 ... makes A' (an opponent-to-move class already in history) triple FIRST.
  // Every position in this history occurred exactly once — fully reachable in live play.
  const haz = await analyze({ variant: 'duelb', fen: A_FEN, moves: ['a8b8'], go: 'depth 12' });
  note(`duelb, history holds 1 old occurrence of an opponent-to-move position: full search ${fmt(haz.score)} bestmove ${haz.bestmove}`);
  check('E4h', 'HAZARD (symmetric Plan B): losing engine finds a forced WIN by chasing repetition of a historical position', isMatePlus(haz.score) && haz.bestmove === 'b6d7',
    `${fmt(haz.score)} via ${haz.bestmove} — a lost engine will actively chase loops under symmetric nFoldValue=loss`);

  // (g) THE FIX: nFoldValueAbsolute anti-engine — all repetitions lose for the engine side
  const fix = await analyze({ variant: 'duelbabs', fen: A_FEN, moves: ['a8b8'], go: 'depth 12' });
  note(`duelbabs (any repetition = White loses), same history: full search ${fmt(fix.score)} bestmove ${fix.bestmove}`);
  const fixLoop = await analyze({ variant: 'duelbabs', fen: A_FEN, moves: ['a8b8'], go: 'depth 10 searchmoves b6d7' });
  check('E4i', 'FIX (nFoldValueAbsolute=true, loss for engine side): same engine now treats every loop as losing and stops chasing',
    !isMatePlus(fix.score) && isClearlyNeg(fix.score) && !isMatePlus(fixLoop.score),
    `full ${fmt(fix.score)} bestmove ${fix.bestmove}; loop-only ${fmt(fixLoop.score)}`);

  // (h) winning side sanity: KQ vs K under Plan B configs — mates normally, no repetition fear
  const kqk = await analyze({ variant: 'duelb', fen: KQK_FEN, go: 'depth 12' });
  const kqkAbs = await analyze({ variant: 'duelbabs', fen: KQK_FEN, go: 'depth 12' });
  check('E4j', 'Plan B winning side (KQ vs K): finds a forced mate normally under both duelb and duelbabs',
    isMatePlus(kqk.score) && isMatePlus(kqkAbs.score),
    `duelb ${fmt(kqk.score)} (${kqk.bestmove}), duelbabs ${fmt(kqkAbs.score)} (${kqkAbs.bestmove})`);

  // ---- E5: history reset via a fresh `position fen` (position surgery) ----
  console.log('\n== E5: repetition-history reset on a fresh `position fen` (crumble surgery) ==');
  // Reference A (clean engine state): B1 position with NO history. Black (to move,
  // up Q+2R) wins, but only via a fresh in-search repetition race / normal play:
  // a LONG mate, NOT the immediate mate +1 that 7 plies of real history hand it.
  const refFresh = await analyze({ variant: 'duelb', fen: B1_FEN, go: 'depth 12' });
  note(`duelb B1 as fresh root (no history): ${fmt(refFresh.score)}`);
  // Reference B: the SAME board position reached with 7 plies of history — black's
  // forced b8a8 completes a REAL 3-fold => immediate adjudication, mate +1 (E4g).
  const withHist = await analyze({ variant: 'duelb', fen: KNIGHT_FEN, moves: hist7, go: 'depth 12' });
  note(`duelb same position via 7-ply history: ${fmt(withHist.score)}`);
  check('E5a', 'history is live: same position scores mate +1 with real 3-fold history vs a longer mate with none',
    isMatePlus(withHist.score) && withHist.score.value === 1 && isMatePlus(refFresh.score) && refFresh.score.value > 1,
    `with history ${fmt(withHist.score)} vs fresh ${fmt(refFresh.score)}`);
  // The actual surgery flow: feed history, then immediately send a bare `position fen` WITHOUT
  // ucinewgame (live play won't get one wrong) — does the engine still see the old history?
  eng.position({ variant: 'duelb', fen: KNIGHT_FEN, moves: hist7 });
  await eng.isready();
  const surg = await analyze({ variant: 'duelb', fen: B1_FEN, go: 'depth 12', fresh: false });
  check('E5b', 'after a bare `position fen` (no ucinewgame), history is RESET (score matches the fresh reference, not mate +1)',
    surg.score.type === refFresh.score.type && surg.score.value === refFresh.score.value && surg.score.value !== withHist.score.value,
    `surgery ${fmt(surg.score)} vs fresh-reference ${fmt(refFresh.score)} vs with-history ${fmt(withHist.score)}`);
  // TT-poisoning probe: same surgery but with a hash clear — should agree with E5b
  eng.send('ucinewgame');
  await eng.isready();
  const surgClean = await analyze({ variant: 'duelb', fen: B1_FEN, go: 'depth 12' });
  check('E5c', 'TT probe: surgery-without-clear vs clean-hash search agree (no stale adjudication leaks through the TT)',
    surgClean.score.type === surg.score.type && Math.sign(surgClean.score.value) === Math.sign(surg.score.value),
    `no-clear ${fmt(surg.score)} vs clean ${fmt(surgClean.score)}`);
  // Plan A config version of the reset: cp 0 either way (in-search draw-scoring
  // needs no history at all — E1), so nFoldRule=0 offers no observable to
  // distinguish reset; the engine-side reset is proven by E5b.
  const a5hist = await analyze({ variant: 'duela', fen: KNIGHT_FEN, moves: CYCLE, go: 'depth 12 searchmoves d7b6' });
  eng.position({ variant: 'duela', fen: KNIGHT_FEN, moves: CYCLE });
  await eng.isready();
  const a5fresh = await analyze({ variant: 'duela', fen: KNIGHT_FEN, go: 'depth 12 searchmoves d7b6', fresh: false });
  check('E5d', 'nFoldRule=0 config: loop line scores identically with or without history (draw-scoring is history-free)',
    (planADead ? isDrawish(a5hist.score) && isDrawish(a5fresh.score) : isClearlyNeg(a5hist.score) && isClearlyNeg(a5fresh.score)),
    `hist ${fmt(a5hist.score)} vs post-surgery fresh ${fmt(a5fresh.score)}`);

  // ---- E6: full battery for Plan A-prime (nFoldRule=0 + nFoldValue=loss) --
  console.log('\n== E6: Plan A-prime (nFoldRule=0 + nFoldValue=loss) — the candidate shipping config ==');
  const p1 = {};
  for (const d of [10, 12, 14]) {
    p1[d] = await analyze({ variant: 'duelb0', fen: KNIGHT_FEN, go: `depth ${d}` });
    note(`duelb0 knight root depth ${d}: ${fmt(p1[d].score)} bestmove ${p1[d].bestmove} pv ${p1[d].pv.split(' ').slice(0, 8).join(' ')}`);
  }
  check('E6a', 'A-prime: losing side full search returns honest lost eval at all depths (never ~0.00, never fake mate+)',
    [10, 12, 14].every((d) => isClearlyNeg(p1[d].score) && !isMatePlus(p1[d].score)),
    [10, 12, 14].map((d) => fmt(p1[d].score)).join(', '));
  const p2 = await analyze({ variant: 'duelb0', fen: QUEEN_FEN, go: 'depth 12 searchmoves e2e8' });
  const p2f = await analyze({ variant: 'duelb0', fen: QUEEN_FEN, go: 'depth 12' });
  check('E6b', 'A-prime: queen perpetual line also scored honestly (~ -500, a rook down), full search agrees',
    isClearlyNeg(p2.score) && isClearlyNeg(p2f.score),
    `loop-only ${fmt(p2.score)}, full ${fmt(p2f.score)} bestmove ${p2f.bestmove}`);
  const p3 = await analyze({ variant: 'duelb0', fen: KNIGHT_FEN, moves: CYCLE, go: 'depth 12 searchmoves d7b6' });
  const p3f = await analyze({ variant: 'duelb0', fen: KNIGHT_FEN, moves: [...CYCLE, ...CYCLE], go: 'depth 10' });
  check('E6c', 'A-prime: real occurrences in game history change nothing (occ2 loop-only and occ3 full search both honest)',
    isClearlyNeg(p3.score) && isClearlyNeg(p3f.score) && !isMatePlus(p3.score) && !isMatePlus(p3f.score),
    `occ2 loop-only ${fmt(p3.score)}; occ3-arrived full ${fmt(p3f.score)}`);
  const p4 = await analyze({ variant: 'duelb0', fen: A_FEN, moves: ['a8b8'], go: 'depth 12' });
  check('E6d', 'A-prime: the E4h hazard history produces NO repetition-chasing (honest eval, no mate+)',
    isClearlyNeg(p4.score) && !isMatePlus(p4.score),
    `full ${fmt(p4.score)} bestmove ${p4.bestmove}`);
  const p5 = await analyze({ variant: 'duelb0', fen: KQK_FEN, go: 'depth 12' });
  check('E6e', 'A-prime: winning side (KQ vs K) still finds forced mate normally', isMatePlus(p5.score),
    `${fmt(p5.score)} (${p5.bestmove})`);
  const tlP = stepGame('duelb0', KNIGHT_FEN, [...CYCLE, ...CYCLE, ...CYCLE]);
  const oP = firstOver(tlP);
  check('E6f', 'A-prime (ffish): repetition still NEVER adjudicates a result (3 cycles, no game end) — §4.4 holds', oP === null,
    oP ? `unexpected game end at ply ${oP.ply}: ${oP.resultClaim}` : 'isGameOver false through 12 plies');

  // ---- Verdict -----------------------------------------------------------
  console.log('\n== Summary ==');
  const failed = checks.filter((c) => !c.pass);
  const aPrimeOk = ['E4c2', 'E6a', 'E6b', 'E6c', 'E6d', 'E6e', 'E6f'].every((id) => checks.find((c) => c.id === id)?.pass);
  if (planADead) {
    console.log('PLAN A AS SPECIFIED IS DEAD: with nFoldRule=0 (and default nFoldValue=draw) the engine');
    console.log('STILL privately scores repetition lines as 0.00 in search and prefers them from dead-lost');
    console.log('positions (E1/E2). No UCI switch exists.');
    console.log('SYMMETRIC nFoldValue=loss with nFoldRule=3 is ALSO unusable: in-search 2-fold adjudication');
    console.log('lets the losing engine chase repetitions as forced WINS (E4e/E4f/E4h).');
  }
  if (aPrimeOk) {
    console.log('PLAN A-PRIME WORKS and is the recommended shipping config (per-duel variants.ini lines):');
    console.log('  nMoveRule = 0');
    console.log('  nFoldRule = 0        # repetition never adjudicates (LOCKED, §4.4)');
    console.log('  nFoldValue = loss    # dead as a rule, but disables in-search repetition DRAW-scoring');
    console.log('Crumble fires at the 3rd occurrence (Plan A rule, §4.5); harness resets engine history by');
    console.log('sending a bare `position fen` after each crumble (E5b) — no ucinewgame required (E5c).');
    console.log('Fallback if a future build changes this interaction: Plan B-absolute (nFoldRule = 3,');
    console.log('nFoldValueAbsolute = true, nFoldValue = loss when engine is White / win when engine is');
    console.log('Black) + crumble at the 2nd occurrence (E4i).');
  } else {
    console.log('PLAN A-PRIME FAILED — fall back to Plan B-absolute (see E4i) with crumble at 2nd occurrence.');
  }
  console.log(`${checks.length - failed.length}/${checks.length} checks passed${failed.length ? ' — FAILED: ' + failed.map((c) => c.id).join(', ') : ''}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error('SPIKE CRASHED:', e);
    process.exitCode = 2;
  })
  .finally(() => {
    try { eng?.quit(); } catch { /* ignore */ }
    setTimeout(() => process.exit(process.exitCode ?? 0), 500);
  });
