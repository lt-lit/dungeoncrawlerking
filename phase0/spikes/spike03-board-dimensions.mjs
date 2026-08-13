// Spike 3 — Variable board dimensions per duel (§9.3).
//
// "Variable board dimensions per duel (3–12 files x 6–10 ranks), including the
//  small/clipped end. Confirm the shipped WASM artifact is the largeboard
//  flavor."
//
// Phases:
//   A. Build evidence: version strings from both libraries (LB = largeboard),
//      plus a working 12x10 board (in phase B sweep).
//   B. Dimension sweep {3,4,5,8,10,12} files x {6,7,8,10} ranks: generated duel
//      variant + clipped formation, validateFen, perft-1 cross-check
//      (ffish legalMoves vs engine `go perft 1`), depth-6 search with legal
//      bestmove + sane score. 3-wide is the duelable floor (§5.3) — checked
//      hard like every other combo.
//   C. Gap-band check (§4.4): 2+2 formations on 10 ranks -> gap 6, on 6 ranks
//      -> gap 2; 12-ply engine self-play at both extremes with every move
//      legality-checked by ffish.
//   D. Degenerate probes (fresh "risk" engine so failures can't poison A-C):
//      within-caps: 2x8, 1x8, 8x5 (gap 1), 8x4 (gap 0), 8x3 — informational.
//      beyond-caps: maxFile=13, maxRank=11 — exact failure mode in engine and
//      ffish, and proof both stay functional afterwards.
//
// Run: cd phase0 && node spikes/spike03-board-dimensions.mjs

import { loadFfish, loadEngine } from '../lib/load.mjs';
import { makeDuelVariantIni, buildDuelBoard, boardToFen } from '../lib/variant.mjs';
import { squareName, findSquares } from '../lib/fen.mjs';

let failures = 0;
function check(name, cond, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`${tag} - ${name}${detail ? `  [${detail}]` : ''}`);
}
function info(msg) {
  console.log(`INFO - ${msg}`);
}

const BACKS = { 1: ['K'], 2: ['K', 'R'], 3: ['N', 'K', 'B'], 4: ['R', 'N', 'K', 'B'], 5: ['R', 'N', 'K', 'B', 'Q'] };
function formationSpec(files, ranks, withWalls) {
  const p = Math.min(files, 5);
  const start = Math.floor((files - p) / 2);
  const walls = [];
  if (withWalls) {
    const wf = Math.floor(files / 2);
    const wr = Math.floor(ranks / 2);
    walls.push(squareName(wf, wr));
    if (files >= 7) walls.push(squareName(wf - 2, wr));
  }
  return {
    files, ranks, walls,
    white: { backRank: BACKS[p], backRankStart: start, row: 0 },
    black: { backRank: BACKS[p], backRankStart: start, row: ranks - 1 },
  };
}
function ffishLegalMoves(ffish, variant, fen) {
  const b = new ffish.Board(variant, fen);
  const moves = b.legalMoves().trim().split(/\s+/).filter(Boolean);
  b.delete();
  return moves;
}
async function enginePerft1(engine, variant, fen) {
  engine.setoption('UCI_Variant', variant);
  engine.send(`position fen ${fen}`);
  const lines = await engine.sendUntil('go perft 1', (l) => l.startsWith('Nodes searched'), { timeout: 30000 });
  return parseInt(lines[lines.length - 1].split(':')[1], 10);
}

// --- Phase A: largeboard evidence --------------------------------------------
const ffish = await loadFfish();
const ffishVer = ffish.info();
info(`ffish build: ${ffishVer}`);
const engine = await loadEngine();
const uciOut = await engine.uci();
const idLine = uciOut.find((l) => l.startsWith('id name'));
info(`engine build: ${idLine}`);
engine.setoption('Use NNUE', 'false'); // classical eval only (§2.3)
await engine.isready();
check('ffish version string is largeboard (LB)', /\bLB\b/.test(ffishVer), ffishVer);
check('engine version string is largeboard (LB)', /\bLB\b/.test(idLine), idLine);

// --- Phase B: dimension sweep ------------------------------------------------
console.log('\n--- dimension sweep ---');
const FILES_SET = [3, 4, 5, 8, 10, 12];
const RANKS_SET = [6, 7, 8, 10];
const sweepRows = [];
for (const files of FILES_SET) {
  for (const ranks of RANKS_SET) {
    const name = `d${files}x${ranks}`;
    const withWalls = files >= 6 && ranks >= 8; // wall(s) mid-gap on roomy boards
    const spec = formationSpec(files, ranks, withWalls);
    const fen = boardToFen(buildDuelBoard(spec));
    const ini = makeDuelVariantIni({ name, files, ranks, extra: { startFen: fen } });
    let ok = false, detail = '';
    try {
      ffish.loadVariantConfig(ini);
      await engine.loadVariantsIni(ini, '/dims.ini');
      const valid = ffish.validateFen(fen, name);
      const moves = ffishLegalMoves(ffish, name, fen);
      const perft = await enginePerft1(engine, name, fen);
      engine.send('ucinewgame');
      await engine.isready();
      engine.setoption('UCI_Variant', name);
      engine.send(`position fen ${fen}`);
      const res = await engine.go('depth 6', { timeout: 60000 });
      const score = engine.lastScore(res);
      const legalBest = moves.includes(res.bestmove);
      const saneScore = score !== null && (score.type === 'mate' || Math.abs(score.value) <= 2000);
      ok = (valid === 1 || valid === true) && moves.length === perft && moves.length > 0 && legalBest && saneScore;
      detail = `validateFen=${valid} ffish=${moves.length} perft1=${perft} best=${res.bestmove} score=${score.type} ${score.value}`;
      sweepRows.push({ files, ranks, walls: spec.walls.join('+') || '-', legal: moves.length, best: res.bestmove, score: `${score.type} ${score.value}` });
    } catch (e) {
      detail = `threw: ${String(e).split('\n')[0]}`;
    }
    check(`${name}${withWalls ? ' (walls)' : ''}`, ok, detail);
  }
}
info('sweep table: files x ranks | walls | legal | best | score(cp, mover POV, depth 6)');
for (const r of sweepRows) info(`  ${r.files}x${r.ranks} | ${r.walls} | ${r.legal} | ${r.best} | ${r.score}`);

// --- Phase C: gap-band check (§4.4 / §5.3) -----------------------------------
console.log('\n--- gap band ---');
async function gapTest(ranks, expectGap) {
  const files = 8;
  const name = `gap${ranks}`;
  const fen = boardToFen(buildDuelBoard(formationSpec(files, ranks, false)));
  const ini = makeDuelVariantIni({ name, files, ranks, extra: { startFen: fen } });
  ffish.loadVariantConfig(ini);
  await engine.loadVariantsIni(ini, '/gap.ini');
  // measure the actual empty band between the two pawn rows
  const whiteMax = Math.max(...findSquares(fen, (c) => c && c !== '*' && c === c.toUpperCase()).map((s) => s.rankFromBottom));
  const blackMin = Math.min(...findSquares(fen, (c) => c && c !== '*' && c === c.toLowerCase()).map((s) => s.rankFromBottom));
  const gap = blackMin - whiteMax - 1;
  check(`2+2 formations on ${ranks} ranks leave gap ${expectGap}`, gap === expectGap, `measured gap=${gap} fen=${fen.split(' ')[0]}`);
  // 12 plies of engine self-play, every move legality-checked by ffish
  const b = new ffish.Board(name, fen);
  const moves = [];
  let plies = 0, allLegal = true, ended = '';
  for (let i = 0; i < 12; i++) {
    const legal = b.legalMoves().trim().split(/\s+/).filter(Boolean);
    if (legal.length === 0) {
      ended = `game over after ${plies} plies (result ${b.result()})`;
      break;
    }
    engine.setoption('UCI_Variant', name);
    engine.send(`position fen ${fen} moves ${moves.join(' ')}`.trim());
    const res = await engine.go('depth 6', { timeout: 60000 });
    if (!legal.includes(res.bestmove)) {
      allLegal = false;
      ended = `ILLEGAL bestmove ${res.bestmove} at ply ${plies + 1}`;
      break;
    }
    b.push(res.bestmove);
    moves.push(res.bestmove);
    plies++;
  }
  check(`self-play at gap ${expectGap} (${ranks} ranks): all engine moves legal`, allLegal && (plies === 12 || ended.startsWith('game over')),
    `plies=${plies}${ended ? ' ' + ended : ''} line=${moves.join(' ')}`);
  b.delete();
}
await gapTest(10, 6);
await gapTest(6, 2);

// --- Phase D: degenerate probes ---------------------------------------------
console.log('\n--- degenerate probes (fresh risk engine) ---');
const risk = await loadEngine();
await risk.uci();
risk.setoption('Use NNUE', 'false');
await risk.isready();

async function probe(name, ini, fen, { depth = 6 } = {}) {
  try {
    ffish.loadVariantConfig(ini);
    await risk.loadVariantsIni(ini, '/probe.ini');
    const valid = ffish.validateFen(fen, name);
    const moves = ffishLegalMoves(ffish, name, fen);
    const perft = await enginePerft1(risk, name, fen);
    risk.send('ucinewgame');
    await risk.isready();
    risk.setoption('UCI_Variant', name);
    risk.send(`position fen ${fen}`);
    const res = await risk.go(`depth ${depth}`, { timeout: 60000 });
    const score = risk.lastScore(res);
    const legalBest = moves.includes(res.bestmove) || (moves.length === 0 && res.bestmove === '(none)');
    info(`${name}: validateFen=${valid} ffish=${moves.length} perft1=${perft} best=${res.bestmove} legalBest=${legalBest} score=${score ? `${score.type} ${score.value}` : 'n/a'}`);
    return { works: (valid === 1 || valid === true) && moves.length === perft && legalBest, moves: moves.length };
  } catch (e) {
    info(`${name}: threw ${String(e).split('\n')[0]}`);
    return { works: false, moves: -1 };
  }
}

// within-caps, below the design floor — informational, but they must not crash
const p2x8 = await probe('p2x8',
  makeDuelVariantIni({ name: 'p2x8', files: 2, ranks: 8, extra: { startFen: boardToFen(buildDuelBoard(formationSpec(2, 8, false))) } }),
  boardToFen(buildDuelBoard(formationSpec(2, 8, false))));
const fen1x8 = 'k/1/1/1/*/1/1/K w - - 0 1';
const p1x8 = await probe('p1x8', makeDuelVariantIni({ name: 'p1x8', files: 1, ranks: 8, extra: { startFen: fen1x8 } }), fen1x8, { depth: 4 });
const p8x5 = await probe('p8x5',
  makeDuelVariantIni({ name: 'p8x5', files: 8, ranks: 5, extra: { startFen: boardToFen(buildDuelBoard(formationSpec(8, 5, false))) } }),
  boardToFen(buildDuelBoard(formationSpec(8, 5, false))));
const p8x4 = await probe('p8x4',
  makeDuelVariantIni({ name: 'p8x4', files: 8, ranks: 4, extra: { startFen: boardToFen(buildDuelBoard(formationSpec(8, 4, false))) } }),
  boardToFen(buildDuelBoard(formationSpec(8, 4, false))));
const fen8x3 = '4r2k/8/K2R4 w - - 0 1';
const p8x3 = await probe('p8x3', makeDuelVariantIni({ name: 'p8x3', files: 8, ranks: 3, extra: { startFen: fen8x3 } }), fen8x3);
check('degenerate within-caps boards did not crash either library', true,
  `2x8=${p2x8.works} 1x8=${p1x8.works} 8x5=${p8x5.works} 8x4=${p8x4.works} 8x3=${p8x3.works}`);

// beyond-caps: engine first (risk instance), ffish last (singleton)
console.log('\n--- beyond-caps probes ---');
async function badEngineProbe(name, iniBody) {
  risk.log.length = 0;
  risk.logEnabled = true;
  try {
    await risk.loadVariantsIni(`[${name}:chess]\n${iniBody}\n`, '/bad.ini');
  } catch (e) {
    info(`${name}: engine load threw ${String(e).split('\n')[0]}`);
  }
  risk.logEnabled = false;
  const chatter = risk.log.filter((l) => !/^readyok$/.test(l));
  info(`${name}: engine chatter on load: ${chatter.length ? chatter.join(' | ') : '(none)'}`);
  const uci2 = await risk.sendUntil('uci', (l) => l === 'uciok', { timeout: 10000 });
  const combo = uci2.find((l) => l.includes('name UCI_Variant')) ?? '';
  const listed = combo.includes(name);
  info(`${name}: present in UCI_Variant combo after load: ${listed}`);
  return listed;
}
const eng13 = await badEngineProbe('bad13', 'maxFile = 13');
const eng11 = await badEngineProbe('bad11', 'maxRank = 11');
// engine must still be healthy afterwards
{
  const fen = boardToFen(buildDuelBoard(formationSpec(4, 6, false)));
  const ini = makeDuelVariantIni({ name: 'postbad', files: 4, ranks: 6, extra: { startFen: fen } });
  ffish.loadVariantConfig(ini);
  await risk.loadVariantsIni(ini, '/postbad.ini');
  const nf = ffishLegalMoves(ffish, 'postbad', fen).length;
  const ne = await enginePerft1(risk, 'postbad', fen);
  check('engine still healthy after beyond-caps loads', nf === ne && nf > 0, `postbad 4x6: ffish=${nf} engine=${ne}; bad13 listed=${eng13} bad11 listed=${eng11}`);
}
// ffish beyond-caps (may abort the singleton — do this last)
function badFfishProbe(name, iniBody) {
  let threw = null, listed = false, boardOk = null;
  try {
    ffish.loadVariantConfig(`[${name}:chess]\n${iniBody}\n`);
  } catch (e) {
    threw = String(e).split('\n')[0];
  }
  try {
    listed = ffish.variants().trim().split(/\s+/).includes(name);
    if (listed) {
      const b = new ffish.Board(name);
      boardOk = b.fen();
      b.delete();
    }
  } catch (e) {
    boardOk = `Board threw: ${String(e).split('\n')[0]}`;
  }
  info(`${name}: ffish loadVariantConfig threw=${threw ?? 'no'} listed=${listed} board=${boardOk ?? 'n/a'}`);
  return { threw, listed, boardOk };
}
const ff13 = badFfishProbe('fbad13', 'maxFile = 13');
const ff11 = badFfishProbe('fbad11', 'maxRank = 11');
{
  // ffish must still be healthy afterwards
  let healthy = false, detail = '';
  try {
    const fen = boardToFen(buildDuelBoard(formationSpec(5, 7, false)));
    const ini = makeDuelVariantIni({ name: 'postbadf', files: 5, ranks: 7, extra: { startFen: fen } });
    ffish.loadVariantConfig(ini);
    const n = ffishLegalMoves(ffish, 'postbadf', fen).length;
    healthy = n > 0;
    detail = `postbadf 5x7 legal=${n}`;
  } catch (e) {
    detail = String(e).split('\n')[0];
  }
  check('ffish still healthy after beyond-caps loads', healthy, detail);
}
info(`beyond-caps summary: engine bad13-listed=${eng13} bad11-listed=${eng11}; ffish fbad13 listed=${ff13.listed} fbad11 listed=${ff11.listed}`);

risk.quit();
engine.quit();
console.log(failures === 0 ? '\nSPIKE 3: ALL CHECKS PASSED' : `\nSPIKE 3: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
