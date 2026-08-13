// Sweep driver (brief §7): run a grid of arena configs × seeds through
// engine-vs-engine self-play, logging one JSON line per game.
//
// Usage: node harness/sweep.mjs <sweep-config.json> [--out results/foo.jsonl]
//
// Sweep config shape:
// {
//   "name": "smoke",
//   "go": "movetime 120",
//   "maxPlies": 400,
//   "evalDeadband": 50,
//   "crumble": { "onsetPly": 40, "cadence": 8 },
//   "seeds": 3,
//   "axes": {
//     "widths": [3, 5],
//     "gaps": [2, 4],
//     "wallDensities": [0, 0.15],
//     "matchups": [
//       { "white": {"comp": "full4", "arch": "balanced"},
//         "black": {"comp": "full4", "arch": "balanced"} }
//     ]
//   }
// }
import fs from 'fs';
import path from 'path';
import { loadFfish, loadEngine } from '../lib/load.mjs';
import { buildArena, collectVariantsIni } from './arena.mjs';
import { playGame } from './game.mjs';
import { summarize, renderSummary } from './analyze.mjs';

const args = process.argv.slice(2);
const configPath = args.find((a) => !a.startsWith('--'));
if (!configPath) {
  console.error('usage: node harness/sweep.mjs <sweep-config.json> [--out out.jsonl]');
  process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : `results/sweep-${cfg.name}.jsonl`;
fs.mkdirSync(path.dirname(outPath), { recursive: true });

// Expand the grid
const points = [];
for (const width of cfg.axes.widths) {
  for (const gap of cfg.axes.gaps) {
    for (const wallDensity of cfg.axes.wallDensities) {
      for (const matchup of cfg.axes.matchups) {
        points.push({ width, gap, wallDensity, white: matchup.white, black: matchup.black });
      }
    }
  }
}
const totalGames = points.length * cfg.seeds;
console.log(`sweep "${cfg.name}": ${points.length} config points x ${cfg.seeds} seeds = ${totalGames} games`);
console.log(`go: ${cfg.go}; crumble: ${JSON.stringify(cfg.crumble ?? null)}; out: ${outPath}`);

const ffish = await loadFfish();
const engine = await loadEngine();
await engine.uci();
engine.setoption('Use NNUE', 'false');

// Pre-generate all arenas so one variants.ini covers every (files, ranks)
// the sweep needs — loaded once. All other variation lives in the FEN.
const jobs = [];
for (const point of points) {
  for (let s = 0; s < cfg.seeds; s++) {
    const seed = (cfg.baseSeed ?? 1000) + s;
    jobs.push({ point, seed, arena: buildArena(point, seed) });
  }
}
const ini = collectVariantsIni(jobs.map((j) => j.arena));
ffish.loadVariantConfig(ini);
await engine.loadVariantsIni(ini);

const out = fs.createWriteStream(outPath);
const started = Date.now();
let done = 0;
const records = [];
for (const job of jobs) {
  engine.setoption('UCI_Variant', job.arena.variantName);
  await engine.isready();
  const t0 = Date.now();
  const record = await playGame({
    engine,
    ffish,
    arena: job.arena,
    opts: {
      go: cfg.go,
      maxPlies: cfg.maxPlies ?? 400,
      crumble: cfg.crumble,
      seed: job.seed,
      evalDeadband: cfg.evalDeadband ?? 50,
    },
  });
  record.wallMs = Date.now() - t0;
  records.push(record);
  out.write(JSON.stringify(record) + '\n');
  done++;
  const eta = Math.round(((Date.now() - started) / done) * (totalGames - done) / 1000);
  console.log(
    `[${done}/${totalGames}] w${job.point.width} g${job.point.gap} d${job.point.wallDensity} ` +
      `${job.point.white.comp}v${job.point.black.comp} seed${job.seed}: ` +
      `${record.result ?? 'ERR'} in ${record.plies} plies, ${record.crumbles.length} crumbles ` +
      `(${record.wallMs}ms, eta ${eta}s)` +
      (record.error ? ` ERROR: ${record.error}` : '')
  );
}
out.end();

const summary = summarize(records);
const summaryPath = outPath.replace(/\.jsonl$/, '-summary.md');
fs.writeFileSync(summaryPath, renderSummary(cfg, summary));
console.log(`\nwrote ${outPath} and ${summaryPath}`);
console.log(renderSummary(cfg, summary));
process.exit(0);
