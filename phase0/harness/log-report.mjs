// Replay-log report (2026-09-06): a browser export (play/js/replaylog.mjs,
// schema dck-log/1 — the Export / copy-log buttons, `__DCK.log.build()`, or
// a saved autosave slot) printed as a human-readable post-mortem. No engine,
// no ffish: every board is drawn from the FENs the log carries, so a pasted
// log is readable anywhere Node runs.
//
// The RENDERING lives in play/js/logreport.mjs (2026-09-07) — the same
// functions the in-browser analyzer (replay/) paints on the real board.
// This file is the CLI: arguments, the --json peek, and --probe (which
// needs Node's engine loader).
//
// Usage: node harness/log-report.mjs <log.json> [sections…] [--ply N]
//   sections (default: header timeline quakes branches flags anomalies):
//     header     the deal, the build, the engine limits, the verdict
//     timeline   one line per ply: move, engine eval, quake summary, flags,
//                where an undo resumed
//     quakes     every quake in full: board before/after, the ladder path,
//                the protected census, the engine inputs, the gate verdict,
//                the rejected attempts, timing, eval delta
//     branches   every undo: the board right before it, the abandoned line
//     flags      the player's marks
//     anomalies  the duel layer's warnings
//     engine     the enemy's eval trajectory, one line per search
//     log        the display lines the player saw
//     all        everything
//   --ply N      restrict quakes/attempts/traces to one ply (adds the ply's
//                full roll trace as JSON)
//   --probe [go] re-search each quake's three boards (before the ply's move,
//                before the quake, after it) with the real engine at `go`
//                (default "depth 22 movetime 20000") and say what the move
//                and what the quake did to the position — needs the
//                vendored pair overlaid into node_modules (engine/README.md)
//   --json a.b   print one field of the log as JSON and exit
import fs from 'fs';
import { renderReport, stateAt, SECTION_NAMES, DEFAULT_SECTIONS } from '../../play/js/logreport.mjs';

const argv = process.argv.slice(2);
const NAMES = new Set([...SECTION_NAMES, 'all']);
// --probe [go]: re-search every quake's three boards (before the ply's move,
// before the quake, after it) with the REAL engine at the given limits
// (default: the enemy's own depth cap, 20 s) — the s75 lesson: a mate the
// depth-12 probe cannot see is settled only by a search at the enemy's
// depth, and the log carries the exact boards. Needs the vendored pair
// overlaid into node_modules (engine/README.md); slow by design.
const GO_RE = /^(depth|movetime|nodes)\b/;
const probeIdx = argv.indexOf('--probe');
const PROBE = probeIdx >= 0 ? (argv[probeIdx + 1] && GO_RE.test(argv[probeIdx + 1]) ? argv[probeIdx + 1] : 'depth 22 movetime 20000') : null;
const consumed = (i) => i > 0 && (['--ply', '--json'].includes(argv[i - 1]) || (argv[i - 1] === '--probe' && GO_RE.test(argv[i])));
const file = argv.find((a, i) => !a.startsWith('--') && !NAMES.has(a) && !consumed(i));
if (!file) {
  console.error('usage: node harness/log-report.mjs <log.json> [header|timeline|quakes|branches|flags|anomalies|engine|log|all] [--ply N] [--probe [go]] [--json path]');
  process.exit(2);
}
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};
const wanted = new Set(argv.filter((a) => NAMES.has(a)));
const sections = wanted.has('all') ? SECTION_NAMES : wanted.size ? SECTION_NAMES.filter((s) => wanted.has(s)) : DEFAULT_SECTIONS;
const onlyPly = opt('ply') !== null ? parseInt(opt('ply'), 10) : null;

const L = JSON.parse(fs.readFileSync(file, 'utf8'));
if (opt('json') !== null) {
  const v = opt('json').split('.').reduce((o, k) => (o == null ? o : o[/^\d+$/.test(k) ? parseInt(k, 10) : k]), L);
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

/** --probe: the three boards of each quake, searched now. Engine chatter is
 *  muted while it runs (the wasm module prints straight to console.log). */
async function probeQuakes(quakes) {
  const results = new Map();
  if (!quakes.length) return results;
  const { loadEngine } = await import('../lib/load.mjs');
  const { makeCatalogIni } = await import('../../play/js/variant.mjs');
  const origLog = console.log;
  console.log = (...a) => {
    if (!/^(info |bestmove|id |option |uciok|readyok|Fairy-Stockfish)/.test(String(a[0] ?? ''))) origLog(...a);
  };
  try {
    const engine = await loadEngine();
    await engine.uci();
    engine.setoption('Use NNUE', 'false'); // rule 1
    engine.setoption('Threads', '1');
    await engine.loadVariantsIni(makeCatalogIni() + (L.variantIni ? '\n' + L.variantIni : ''));
    engine.setoption('UCI_Variant', L.variant);
    await engine.isready();
    const mt = PROBE.match(/movetime (\d+)/);
    const timeout = (mt ? parseInt(mt[1], 10) : 60000) + 8000;
    const one = async (fen) => {
      if (!fen) return null;
      engine.send('setoption name Clear Hash'); // the v4.2 lesson: never probe on a stale table
      engine.position({ fen });
      const t0 = Date.now();
      const res = await engine.go(PROBE, { timeout });
      const s = engine.lastScore(res);
      if (!s) return null;
      const depth = parseInt((res.infoLines[res.infoLines.length - 1]?.match(/ depth (\d+)/) ?? [])[1] ?? '0', 10);
      const pov = fen.split(' ')[1] === 'w' ? s : { type: s.type, value: -s.value };
      return { ...pov, depth, ms: Date.now() - t0 };
    };
    for (const q of quakes) {
      process.stderr.write(`probing ply ${q.ply} (${PROBE})…\n`);
      results.set(q.ply, { beforeMove: await one(stateAt(L.states, q.ply - 1)?.fen ?? null), pre: await one(q.preFen), post: await one(q.postFen) });
    }
  } finally {
    console.log = origLog;
  }
  return results;
}

const probes = PROBE && sections.includes('quakes') ? await probeQuakes((L.quakes ?? []).filter((q) => onlyPly === null || q.ply === onlyPly)) : new Map();
console.log(renderReport(L, { sections, onlyPly, probes, probeGo: PROBE }));
if (PROBE) process.exit(0); // the engine's worker keeps the loop alive otherwise
