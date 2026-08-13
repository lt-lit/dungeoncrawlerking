// Spike 8 — engine perf at duel board sizes (§9.8). Node-side proxy numbers
// (a real phone runs the browser page in spikes/spike08-mobile/). Also
// generates bench-data.js so the browser page runs the IDENTICAL suite.
import fs from 'fs';
import { loadFfish, loadEngine } from '../lib/load.mjs';
import { makeDuelVariantIni } from '../lib/variant.mjs';
import { buildArena } from '../harness/arena.mjs';

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${detail ? `  [${detail}]` : ''}`);
  cond ? pass++ : fail++;
};

// ---- 1. Cold init time -----------------------------------------------------
console.log('--- 1. engine init ---');
// NOTE: never call engine.quit() on the extra instances — the Emscripten
// runtime's quit handler exits the whole Node process. Keep references.
const initTimes = [];
const instances = [];
for (let i = 0; i < 3; i++) {
  const t0 = Date.now();
  const e = await loadEngine();
  await e.uci();
  initTimes.push(Date.now() - t0);
  instances.push(e);
}
const engine = instances[instances.length - 1];
console.log(`INFO - init->uciok times: ${initTimes.join(', ')}ms`);
check('engine init < 3000ms in Node (phone budget 3s at ~5-10x slower)', Math.min(...initTimes) < 3000, `${Math.min(...initTimes)}ms`);
engine.setoption('Use NNUE', 'false');

// ---- 2. Full duel catalog load (the live-game boot path) -------------------
console.log('\n--- 2. variant catalog load ---');
{
  // The game can pre-generate every possible arena dims combo at boot:
  // files 3-12 x ranks 6-10 = 50 variants, one ini, loaded once.
  const blocks = [];
  for (let f = 3; f <= 12; f++) for (let r = 6; r <= 10; r++) blocks.push(makeDuelVariantIni({ name: `duel_${f}x${r}`, files: f, ranks: r }));
  const catalog = blocks.join('\n');
  const ffish = await loadFfish();
  const t0 = Date.now();
  ffish.loadVariantConfig(catalog);
  const tFfish = Date.now() - t0;
  const t1 = Date.now();
  await engine.loadVariantsIni(catalog);
  const tEngine = Date.now() - t1;
  console.log(`INFO - 50-variant catalog: ffish ${tFfish}ms, engine ${tEngine}ms, ini ${catalog.length} bytes`);
  check('50-variant catalog loads < 1s combined', tFfish + tEngine < 1000, `${tFfish + tEngine}ms`);
}

// ---- 3. Search perf on representative arenas -------------------------------
console.log('\n--- 3. search perf ---');
const ARENAS = [
  { label: 'small (3-wide, gap 2 → 3x6)', cfg: { width: 3, gap: 2, wallDensity: 0, white: { comp: 'minors2' }, black: { comp: 'minors2' } } },
  { label: 'standard (5-wide, gap 4 → 5x8, walls)', cfg: { width: 5, gap: 4, wallDensity: 0.15, white: { comp: 'full4' }, black: { comp: 'full4' } } },
  { label: 'max (5-wide, gap 6 → 5x10, walls)', cfg: { width: 5, gap: 6, wallDensity: 0.15, white: { comp: 'full4' }, black: { comp: 'full4' } } },
];
const benchData = [];
for (const a of ARENAS) {
  const arena = buildArena(a.cfg, 808);
  await engine.loadVariantsIni(arena.ini);
  engine.setoption('UCI_Variant', arena.variantName);
  await engine.isready();
  const rows = [];
  for (const mt of [200, 500, 1000]) {
    engine.send('ucinewgame');
    await engine.isready();
    engine.position({ fen: arena.startFen });
    const res = await engine.go(`movetime ${mt}`);
    const depth = res.infoLines.map((l) => l.match(/^info depth (\d+)/)).filter(Boolean).map((m) => +m[1]).pop() ?? 0;
    const nodes = res.infoLines.map((l) => l.match(/nodes (\d+)/)).filter(Boolean).map((m) => +m[1]).pop() ?? 0;
    rows.push({ movetime: mt, depth, nodes, nps: Math.round(nodes / (mt / 1000)) });
  }
  // time-to-depth
  for (const d of [8, 12]) {
    engine.send('ucinewgame');
    await engine.isready();
    engine.position({ fen: arena.startFen });
    const t0 = Date.now();
    await engine.go(`depth ${d}`);
    rows.push({ toDepth: d, ms: Date.now() - t0 });
  }
  console.log(`INFO - ${a.label}: ${JSON.stringify(rows)}`);
  benchData.push({ label: a.label, variantName: arena.variantName, ini: arena.ini, startFen: arena.startFen, nodeResults: rows });
  const at500 = rows.find((r) => r.movetime === 500);
  check(`${a.label}: depth >= 10 at 500ms (Node)`, at500.depth >= 10, `depth=${at500.depth}`);
}

// ---- 4. Threads option -----------------------------------------------------
console.log('\n--- 4. threading ---');
{
  const uciLines = await engine.uci();
  const threadsOpt = uciLines.find((l) => l.includes('name Threads'));
  console.log(`INFO - Threads option: ${threadsOpt ?? 'ABSENT'}`);
  const sab = fs.readFileSync('node_modules/fairy-stockfish-nnue.wasm/stockfish.js', 'utf8').includes('SharedArrayBuffer');
  console.log(`INFO - build references SharedArrayBuffer: ${sab} (pthread build -> browser needs cross-origin isolation -> coi-serviceworker on GitHub Pages)`);
  check('Threads option exists (threaded build)', !!threadsOpt);
  if (threadsOpt) {
    const arena = benchData[1];
    engine.setoption('UCI_Variant', arena.variantName);
    for (const th of [1, 2]) {
      engine.setoption('Threads', String(th));
      engine.send('ucinewgame');
      await engine.isready();
      engine.position({ fen: arena.startFen });
      const t0 = Date.now();
      const res = await engine.go('depth 12');
      const nodes = res.infoLines.map((l) => l.match(/nodes (\d+)/)).filter(Boolean).map((m) => +m[1]).pop() ?? 0;
      console.log(`INFO - Threads=${th}: depth 12 in ${Date.now() - t0}ms, ${nodes} nodes`);
    }
    engine.setoption('Threads', '1');
  }
}

// ---- 5. Memory -------------------------------------------------------------
console.log('\n--- 5. memory ---');
{
  const m = process.memoryUsage();
  console.log(`INFO - rss=${(m.rss / 1e6).toFixed(0)}MB external=${(m.external / 1e6).toFixed(0)}MB (one engine + ffish + 50-variant catalog)`);
  check('rss < 800MB', m.rss < 800e6, `${(m.rss / 1e6).toFixed(0)}MB`);
}

// ---- 6. Emit shared bench data for the browser page ------------------------
fs.writeFileSync(
  'spikes/spike08-mobile/bench-data.js',
  '// Generated by spike08-perf.mjs — identical arenas for browser benchmarking.\n' +
    'window.BENCH_DATA = ' + JSON.stringify(benchData.map(({ label, variantName, ini, startFen }) => ({ label, variantName, ini, startFen })), null, 2) + ';\n'
);
console.log('INFO - wrote spikes/spike08-mobile/bench-data.js');

console.log(`\nSPIKE 8: ${fail === 0 ? 'ALL CHECKS PASSED' : `${fail} CHECKS FAILED`} (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
