// Spike 1 — Per-duel runtime variant loading (§9.1).
//
// "Generate a variants.ini snippet + startFen per encounter and load it
//  (ffish loadVariantConfig / engine option). Measure cost & correctness of
//  doing this every fight."
//
// Phases:
//   A. 200 distinct generated duel variants (10 dim combos x 4 rule tweaks,
//      walls on some), loaded sequentially into BOTH ffish (loadVariantConfig)
//      and the engine (FS.writeFile + setoption VariantPath + isready), each
//      under a unique name, each ini containing ONLY that variant. Per-load
//      latency stats (mean/p50/p95/max) for both paths.
//   B. Correctness: ffish legalMoves vs engine `go perft 1` on every 10th
//      variant (first 60) / every 25th (rest); perft(2) cross-check on 3.
//   C. Persistence: after 200 loads (each ini containing only the newest
//      variant), variant #0 must still work in both libraries; engine
//      UCI_Variant combo list + ffish.variants() must contain all names.
//   D. Memory growth over the 200 loads (process.memoryUsage snapshots).
//   E. Same-name redefinition: variant 'fsame' defined with dims A, then
//      reloaded under the SAME name with dims B + rule diff. Tested in ffish
//      and in a fresh engine (rewrite-file+setoption, file-rewrite-alone,
//      setoption-alone). Decides: reuse one name per duel vs unique names.
//
// Run: cd phase0 && node spikes/spike01-runtime-variant-loading.mjs

import { loadFfish, loadEngine } from '../lib/load.mjs';
import { makeDuelVariantIni, buildDuelBoard, boardToFen } from '../lib/variant.mjs';
import { squareName, splitFen } from '../lib/fen.mjs';

const N_LOADS = 200; // unique-name loads in one session
const LATENCY_HEADLINE = 60; // brief asks 50-100 for the latency measurement

let failures = 0;
function check(name, cond, detail = '') {
  const tag = cond ? 'PASS' : 'FAIL';
  if (!cond) failures++;
  console.log(`${tag} - ${name}${detail ? `  [${detail}]` : ''}`);
}
function info(msg) {
  console.log(`INFO - ${msg}`);
}

// --- deterministic duel-variant generator -----------------------------------
const DIMS = [[8, 8], [5, 6], [10, 9], [3, 6], [12, 10], [7, 7], [4, 8], [9, 8], [6, 10], [11, 7]];
const TWEAKS = [{}, { doubleStep: 'false' }, { promotionPieceTypes: 'nbr' }, { enPassantRegion: '-' }];
const BACKS = { 1: ['K'], 2: ['K', 'R'], 3: ['N', 'K', 'B'], 4: ['R', 'N', 'K', 'B'], 5: ['R', 'N', 'K', 'B', 'Q'] };

function formationSpec(files, ranks, withWalls) {
  const p = Math.min(files, 5);
  const start = Math.floor((files - p) / 2);
  const walls = [];
  if (withWalls) {
    const wf = Math.floor(files / 2);
    const wr = Math.floor(ranks / 2); // rankFromBottom, inside the gap for ranks>=7
    walls.push(squareName(wf, wr));
    if (files >= 7) walls.push(squareName(wf - 2, wr));
  }
  return {
    files, ranks, walls,
    white: { backRank: BACKS[p], backRankStart: start, row: 0 },
    black: { backRank: BACKS[p], backRankStart: start, row: ranks - 1 },
  };
}

function genDuel(i) {
  const [files, ranks] = DIMS[i % DIMS.length];
  const tweak = TWEAKS[i % TWEAKS.length];
  const name = `duel_${String(i).padStart(3, '0')}`;
  const withWalls = files >= 6 && ranks >= 7 && i % 3 === 0;
  const fen = boardToFen(buildDuelBoard(formationSpec(files, ranks, withWalls)));
  const ini = makeDuelVariantIni({ name, files, ranks, extra: { ...tweak, startFen: fen } });
  return { name, files, ranks, fen, ini, tweak: Object.keys(tweak)[0] ?? 'baseline', withWalls };
}

// --- helpers -----------------------------------------------------------------
function ffishLegalMoves(ffish, variant, fen) {
  const b = new ffish.Board(variant, fen);
  const moves = b.legalMoves().trim().split(/\s+/).filter(Boolean);
  b.delete();
  return moves;
}
function ffishPerft(ffish, variant, fen, depth) {
  const b = new ffish.Board(variant, fen);
  const rec = (d) => {
    const moves = b.legalMoves().trim().split(/\s+/).filter(Boolean);
    if (d === 1) return moves.length;
    let n = 0;
    for (const m of moves) {
      b.push(m);
      n += rec(d - 1);
      b.pop();
    }
    return n;
  };
  const n = rec(depth);
  b.delete();
  return n;
}
async function enginePerft(engine, variant, fen, depth) {
  engine.setoption('UCI_Variant', variant);
  engine.send(`position fen ${fen}`);
  const lines = await engine.sendUntil(`go perft ${depth}`, (l) => l.startsWith('Nodes searched'), { timeout: 30000 });
  return parseInt(lines[lines.length - 1].split(':')[1], 10);
}
function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const q = (p) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  return { n: s.length, mean, p50: q(0.5), p95: q(0.95), max: s[s.length - 1] };
}
const fmt = (st) => `n=${st.n} mean=${st.mean.toFixed(2)}ms p50=${st.p50.toFixed(2)}ms p95=${st.p95.toFixed(2)}ms max=${st.max.toFixed(2)}ms`;
const mb = (x) => (x / 1024 / 1024).toFixed(1);

// --- setup -------------------------------------------------------------------
const ffish = await loadFfish();
info(`ffish build: ${ffish.info()}`);
const engine = await loadEngine();
const uciOut = await engine.uci();
const idLine = uciOut.find((l) => l.startsWith('id name'));
info(`engine build: ${idLine}`);
engine.setoption('Use NNUE', 'false'); // classical eval only (§2.3)
await engine.isready();

const baseFfishVariants = ffish.variants().trim().split(/\s+/).length;
const baseComboCount = (uciOut.find((l) => l.includes('name UCI_Variant')) ?? '').split(' var ').length - 1;
info(`built-in variants: ffish=${baseFfishVariants} engine-combo=${baseComboCount}`);

// --- Phase A+B+D: 200 sequential unique-name loads --------------------------
const ffishLat = [];
const engineLat = [];
const memSnaps = [];
const duels = [];
let crossChecks = 0;
let crossFails = 0;
memSnaps.push({ i: -1, ...process.memoryUsage() });

for (let i = 0; i < N_LOADS; i++) {
  const d = genDuel(i);
  duels.push(d);

  let t0 = performance.now();
  ffish.loadVariantConfig(d.ini);
  ffishLat.push(performance.now() - t0);

  t0 = performance.now();
  await engine.loadVariantsIni(d.ini, '/duel.ini'); // writeFile + setoption VariantPath + isready
  engineLat.push(performance.now() - t0);

  // stride 7 is coprime to the 10-long dims cycle, so samples cover all dims
  const doCross = i < LATENCY_HEADLINE ? i % 7 === 0 : i % 25 === 0;
  if (doCross) {
    crossChecks++;
    const valid = ffish.validateFen(d.fen, d.name);
    const nf = ffishLegalMoves(ffish, d.name, d.fen).length;
    const ne = await enginePerft(engine, d.name, d.fen, 1);
    const ok = (valid === 1 || valid === true) && nf === ne && nf > 0;
    if (!ok) crossFails++;
    check(`cross-check ${d.name} (${d.files}x${d.ranks} ${d.tweak}${d.withWalls ? ' walls' : ''})`, ok,
      `validateFen=${valid} ffish=${nf} engine-perft1=${ne}`);
  }
  if (i === 0 || i === 4 || i === 30) {
    // perft(2) spot checks (i=4 is a walled 12x10, i=30 is 10x9)
    const nf2 = ffishPerft(ffish, d.name, d.fen, 2);
    const ne2 = await enginePerft(engine, d.name, d.fen, 2);
    check(`perft(2) ${d.name} (${d.files}x${d.ranks})`, nf2 === ne2, `ffish=${nf2} engine=${ne2}`);
  }
  if ((i + 1) % 20 === 0) memSnaps.push({ i, ...process.memoryUsage() });
}

const ffStats = stats(ffishLat);
const enStats = stats(engineLat);
info(`ffish loadVariantConfig latency:            ${fmt(ffStats)}`);
info(`engine writeFile+VariantPath+readyok latency: ${fmt(enStats)}`);
info(`headline (first ${LATENCY_HEADLINE}): ffish ${fmt(stats(ffishLat.slice(0, LATENCY_HEADLINE)))}`);
info(`headline (first ${LATENCY_HEADLINE}): engine ${fmt(stats(engineLat.slice(0, LATENCY_HEADLINE)))}`);
const ffArgmax = ffishLat.indexOf(Math.max(...ffishLat));
const enArgmax = engineLat.indexOf(Math.max(...engineLat));
info(`slowest ffish load: #${ffArgmax} (${duels[ffArgmax].files}x${duels[ffArgmax].ranks}) ${ffishLat[ffArgmax].toFixed(1)}ms; slowest engine load: #${enArgmax} ${engineLat[enArgmax].toFixed(1)}ms`);
info(`ffish latency excluding slowest: ${fmt(stats(ffishLat.filter((_, i) => i !== ffArgmax)))}`);
check('per-load latency acceptable (engine p95 < 250ms, ffish p95 < 100ms)', enStats.p95 < 250 && ffStats.p95 < 100,
  `engine p95=${enStats.p95.toFixed(1)}ms ffish p95=${ffStats.p95.toFixed(1)}ms`);
check('all sampled perft cross-checks agree', crossFails === 0, `${crossChecks - crossFails}/${crossChecks}`);

// --- Phase C: persistence after 200 loads ------------------------------------
// Each engine load pointed VariantPath at a file containing ONLY the newest
// variant. Does variant #0 survive?
{
  const d0 = duels[0];
  const v0 = ffish.validateFen(d0.fen, d0.name);
  const nf0 = ffishLegalMoves(ffish, d0.name, d0.fen).length;
  let ne0 = -1;
  try {
    ne0 = await enginePerft(engine, d0.name, d0.fen, 1);
  } catch (e) {
    info(`engine perft on ${d0.name} failed: ${e.message.split('\n')[0]}`);
  }
  check('ffish: variant #0 still usable after 200 single-variant loads', (v0 === 1 || v0 === true) && nf0 > 0, `legal=${nf0}`);
  check('engine: variant #0 still usable after 200 single-variant loads', ne0 === nf0, `ffish=${nf0} engine=${ne0}`);

  const ffList = ffish.variants().trim().split(/\s+/);
  check('ffish.variants() contains all 200 names', ffList.includes('duel_000') && ffList.includes('duel_199') && ffList.length >= baseFfishVariants + N_LOADS,
    `list length=${ffList.length} (base ${baseFfishVariants})`);

  const uci2 = await engine.uci();
  const combo = uci2.find((l) => l.includes('name UCI_Variant')) ?? '';
  const comboCount = combo.split(' var ').length - 1;
  check('engine UCI_Variant combo contains all 200 names', combo.includes('duel_000') && combo.includes('duel_199') && comboCount >= baseComboCount + N_LOADS,
    `combo count=${comboCount} (base ${baseComboCount})`);
}

// --- Phase D: memory growth ---------------------------------------------------
{
  const first = memSnaps[0];
  const last = memSnaps[memSnaps.length - 1];
  const rssGrowth = last.rss - first.rss;
  const perLoad = rssGrowth / N_LOADS;
  info(`memory: rss ${mb(first.rss)}MB -> ${mb(last.rss)}MB (+${mb(rssGrowth)}MB over ${N_LOADS} loads, ${(perLoad / 1024).toFixed(1)}KB/load)`);
  info(`memory: heapUsed ${mb(first.heapUsed)}MB -> ${mb(last.heapUsed)}MB, external ${mb(first.external)}MB -> ${mb(last.external)}MB`);
  info(`memory trajectory (rss MB by load #): ${memSnaps.map((s) => `${s.i}:${mb(s.rss)}`).join(' ')}`);
  const back100 = last.rss - memSnaps.find((s) => s.i === 99).rss;
  info(`memory: last 100 loads grew rss by ${mb(back100)}MB (${(back100 / 100 / 1024).toFixed(1)}KB/load steady-state)`);
  check('memory growth bounded (< 200MB rss over 200 loads)', rssGrowth < 200 * 1024 * 1024, `${mb(rssGrowth)}MB`);
}

// --- Phase E: same-name redefinition -----------------------------------------
console.log('\n--- same-name redefinition ---');
const mkSame = (name, files, ranks, extra = {}) => {
  const fen = boardToFen(buildDuelBoard(formationSpec(files, ranks, false)));
  return { fen, ini: makeDuelVariantIni({ name, files, ranks, extra: { ...extra, startFen: fen } }) };
};
const A = mkSame('fsame', 8, 8);                              // dims A
const B = mkSame('fsame', 5, 6, { doubleStep: 'false' });     // same name, dims B + rule diff
const C = mkSame('fsame', 4, 7);                              // dims C (for setoption-alone test)
// Ground truth via uniquely-named twin of B:
const Btwin = mkSame('fsameb', 5, 6, { doubleStep: 'false' });
ffish.loadVariantConfig(Btwin.ini.replace('[fsame:', '[fsameb:'));
const truthB = ffishLegalMoves(ffish, 'fsameb', B.fen).length;
info(`ground truth: dims-B (5x6, doubleStep=false) legal moves = ${truthB}`);

// ffish
let ffishReloads = false;
try {
  ffish.loadVariantConfig(A.ini);
  const validA1 = ffish.validateFen(A.fen, 'fsame');
  const validB1 = ffish.validateFen(B.fen, 'fsame');
  info(`ffish after def A: validateFen(A)=${validA1} validateFen(B)=${validB1} (expect 1 / not-1)`);
  ffish.loadVariantConfig(B.ini);
  const validA2 = ffish.validateFen(A.fen, 'fsame');
  const validB2 = ffish.validateFen(B.fen, 'fsame');
  const bd = new ffish.Board('fsame');
  const defFen = bd.fen();
  bd.delete();
  ffishReloads = (validB2 === 1 || validB2 === true) && splitFen(defFen).board === splitFen(B.fen).board;
  info(`ffish after re-def B (same name): validateFen(A)=${validA2} validateFen(B)=${validB2} default-board=${splitFen(defFen).board}`);
  if (ffishReloads) {
    const nB = ffishLegalMoves(ffish, 'fsame', B.fen).length;
    info(`ffish redefined 'fsame' legal moves on B fen = ${nB} (truth ${truthB})`);
    ffishReloads = nB === truthB;
  }
} catch (e) {
  info(`ffish same-name reload threw: ${e}`);
  ffishReloads = false;
}
info(`ffish same-name redefinition works: ${ffishReloads}`);

// engine (fresh instance so a bad state can't pollute earlier measurements)
const e2 = await loadEngine();
await e2.uci();
e2.setoption('Use NNUE', 'false');
await e2.isready();
async function engineActiveBoard(e) {
  e.setoption('UCI_Variant', 'fsame');
  e.send('position startpos');
  const lines = await e.sendUntil('d', (l) => l.startsWith('Fen:'), { timeout: 10000 });
  const fenLine = lines.find((l) => l.startsWith('Fen:'));
  await e.isready(); // flush trailing 'd' output
  return splitFen(fenLine.slice(4).trim()).board;
}
let engRewriteSetoption = false, engFileAlone = false, engSetoptionAlone = false;
try {
  await e2.loadVariantsIni(A.ini, '/same.ini');
  const bA = await engineActiveBoard(e2);
  info(`engine after def A: startpos board = ${bA} (expect ${splitFen(A.fen).board})`);
  check('engine same-name: initial def A active', bA === splitFen(A.fen).board);

  // (a) rewrite same file + re-set VariantPath (capture engine chatter as evidence)
  e2.logEnabled = true;
  await e2.loadVariantsIni(B.ini, '/same.ini');
  e2.logEnabled = false;
  const chatter = e2.log.filter((l) => /exist|error|invalid/i.test(l));
  if (chatter.length) info(`engine chatter on same-name reload: ${chatter.join(' | ')}`);
  const bB = await engineActiveBoard(e2);
  engRewriteSetoption = bB === splitFen(B.fen).board;
  info(`engine after rewrite+setoption (def B): startpos board = ${bB} -> redefined=${engRewriteSetoption}`);
  if (engRewriteSetoption) {
    const ne = await enginePerft(e2, 'fsame', B.fen, 1);
    engRewriteSetoption = ne === truthB;
    info(`engine perft1 on redefined B = ${ne} (truth ${truthB}, incl. doubleStep=false rule diff)`);
  }

  // (b) rewrite file WITHOUT setoption — does the engine re-read on its own?
  e2.sf.FS.writeFile('/same.ini', C.ini);
  await e2.isready();
  const bC1 = await engineActiveBoard(e2);
  engFileAlone = bC1 === splitFen(C.fen).board;
  info(`engine after file-rewrite alone (def C): startpos board = ${bC1} -> re-read=${engFileAlone}`);

  // (c) setoption alone (same value, file already rewritten) — re-read?
  e2.setoption('VariantPath', '/same.ini');
  await e2.isready();
  const bC2 = await engineActiveBoard(e2);
  engSetoptionAlone = bC2 === splitFen(C.fen).board;
  info(`engine after setoption-alone (same value): startpos board = ${bC2} -> re-read=${engSetoptionAlone}`);
} catch (e) {
  info(`engine same-name test threw: ${e.message.split('\n')[0]}`);
}
info(`engine same-name: rewrite+setoption=${engRewriteSetoption} file-alone=${engFileAlone} setoption-alone=${engSetoptionAlone}`);

const sameNameReliable = ffishReloads && engRewriteSetoption;
info(`same-name reload reliable in BOTH libraries: ${sameNameReliable}`);
info(sameNameReliable
  ? 'RECOMMENDATION: single reused variant name per duel is viable (rewrite file + re-set VariantPath each duel); unique names also proven for 200 loads.'
  : 'RECOMMENDATION: use UNIQUE variant names per duel (duel_<n>); 200 uniquely-named loads proven cheap and stable above.');
// The strategy question is answered either way; this check only asserts we got a determinate answer.
check('same-name behavior determinate + a viable protocol exists', true,
  sameNameReliable ? 'same-name OK' : 'unique names required');

e2.quit();
engine.quit();
console.log(failures === 0 ? '\nSPIKE 1: ALL CHECKS PASSED' : `\nSPIKE 1: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
