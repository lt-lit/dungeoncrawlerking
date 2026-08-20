// Meter lab corpus runner (Phase 1.3 evidence pass).
//
// Plays seeded engine-vs-engine duels through the CANON play/js pipeline —
// the shipped DuelController and Board State Director, untouched — with the
// engine in both seats (engineMove() regardless of turn). Two arms:
//
//   baseline — stock Director, 'restless' preset. The meter runs PASSIVELY
//              alongside (pure bookkeeping, zero game effect), stamping every
//              ply so each fired quake carries "what would the meter have
//              said here?". This arm doubles as the evidence-preservation
//              baseline: seed + config + recorded moves re-derive the full
//              roll traces without an engine (the Director is deterministic
//              given the seed and the ply sequence).
//   meter    — MeterDirector (meter-driven pQuake, canon everything else),
//              same seeds, same arenas, same search settings.
//
// After each duel, every adopted quake gets an offline eval referee: white-POV
// engine probes of preFen/postFen at the Phase 1.2 instrument's settings
// (depth 12 movetime 300 — see play/js/main.mjs EVAL_PROBE_GO), plus a
// preFen in-check tag. Offline refereeing only — nothing feeds back into play.
//
// Usage: cd phase0 && node harness/meterlab/run.mjs \
//          [--arms baseline,meter] [--seeds 6] [--seed-base 9000]
//          [--arenas <substring>] [--go 'depth 22 movetime 500']
//          [--player-go 'depth 5 movetime 120'] [--out results/meterlab] [--tag smoke]
// Output: <out>/corpus-<arm>[-<tag>].jsonl, one game per line.
// Engine stdout is huge and searches are CPU-bound: run ONE lab at a time.
//
// RUN ONE PROCESS PER ARM×ARENA BATCH. The WASM engine corrupts under
// sustained multi-game use (rule 6) — observed here as a spurious
// "bestmove (none)" four games into a mixed-arena run — and dropped
// instances never free their ~200 MB (pthread workers pin them), so
// in-process recycling cannot be the primary hygiene. A batch of ~10 games
// per process, memory reclaimed at exit, plus the one-shot fresh-engine
// retry below for sporadic corruption, keeps every game clean:
//   for arm in baseline meter; do for a in 01 02 03 04; do
//     node harness/meterlab/run.mjs --arms $arm --arenas arena$a --tag a$a --seeds 10
//   done; done
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFfish, loadEngine } from '../../lib/load.mjs';
import { DuelController } from '../../../play/js/duel.mjs';
import { makeDuelVariantIni } from '../../../play/js/variant.mjs';
import { loadArena, buildStartFen, playerSlotSquares, defaultPawnSquares } from '../../../play/js/arena.mjs';
import { parseSquare } from '../../../play/js/fen.mjs';
import { MeterDirector, RestlessnessMeter, PositionLog, moveEvents, METER_DEFAULTS } from './meter.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARENA_DIR = path.resolve(HERE, '../../../play/arenas');

// The sweep-validated live baseline (play/js/main.mjs GOD_PRESETS.restless).
const RESTLESS = { onsetPly: 8, quakeRamp: 60, crumbleRamp: 100, debtCap: 10, asymOnsetPly: 50, asymRamp: 60 };
const EVAL_PROBE_GO = 'depth 12 movetime 300'; // mirror of the 1.2 instrument
const EVAL_PROBE_TIMEOUT = 4300;
const GAME_WALL_CLOCK_MS = 15 * 60 * 1000; // lab backstop, not a game rule
const RECYCLE_EVERY_GAMES = 12; // rule 6 margin (live play recycles at 20 duels)

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

const ARMS = arg('arms', 'baseline,meter').split(',').map((s) => s.trim()).filter(Boolean);
const SEEDS = parseInt(arg('seeds', '6'), 10);
const SEED_BASE = parseInt(arg('seed-base', '9000'), 10);
const ARENA_FILTER = arg('arenas', '');
const GO = arg('go', 'depth 22 movetime 500'); // the shipped duel search (rule 11 cap)
// The favored side (the "player" seat) searches SHALLOW by default: two
// full-strength engines convert the §7 material edge in ~20 plies and the
// duel ends before the gods ever matter. Live play's pathology is a
// mid-skill human converting SLOWLY into the saturated-ramp phase — a
// shallow favored seat reproduces exactly that regime (and its blunders
// keep the §7 "two blunders from losing" frame honest). Pass
// --player-go "" to run both seats at full strength.
const PLAYER_GO = arg('player-go', 'depth 5 movetime 120');
const OUT_DIR = path.resolve(HERE, '../..', arg('out', 'results/meterlab'));
const TAG = arg('tag', '');

const PIECE_VALUES = { q: 9, r: 5, b: 3, n: 3, k: 0, p: 1 };

/** Default placement — mirror of play/js/main.mjs defaultPlacement(). */
function defaultPlacement(arena) {
  const slots = playerSlotSquares(arena);
  const placement = {};
  const mid = (arena.player.backRankStart * 2 + arena.player.patchWidth - 1) / 2;
  const byMid = slots
    .slice()
    .sort((a, b) => Math.abs(parseSquare(a).file - mid) - Math.abs(parseSquare(b).file - mid));
  placement[byMid[0]] = 'K';
  const rest = byMid.slice(1);
  const pieces = arena.player.pieceSet
    .slice()
    .sort((a, b) => PIECE_VALUES[b.toLowerCase()] - PIECE_VALUES[a.toLowerCase()]);
  pieces.slice(0, rest.length).forEach((p, i) => {
    placement[rest[i]] = p;
  });
  for (const sq of defaultPawnSquares(arena)) {
    if (!placement[sq]) placement[sq] = 'P';
  }
  return placement;
}

function loadArenas() {
  const files = fs
    .readdirSync(ARENA_DIR)
    .filter((f) => f.endsWith('.json') && f.includes(ARENA_FILTER))
    .sort();
  return files.map((f) => {
    const arena = loadArena(JSON.parse(fs.readFileSync(path.join(ARENA_DIR, f), 'utf8')));
    const { startFen } = buildStartFen(arena, defaultPlacement(arena));
    return {
      id: arena.id,
      variantName: arena.variantName,
      files: arena.files,
      ranks: arena.ranks,
      startFen,
      playerColor: arena.playerColor,
      ini: makeDuelVariantIni({ name: arena.variantName, files: arena.files, ranks: arena.ranks }),
    };
  });
}

async function freshEngine(catalogIni) {
  const engine = await loadEngine();
  await engine.uci();
  engine.setoption('Use NNUE', 'false'); // rule 1 — defaults TRUE in this build
  engine.setoption('Threads', '1');
  await engine.loadVariantsIni(catalogIni);
  await engine.isready();
  return engine;
}

/** One WHITE-POV eval of a bare FEN — mirror of play/js/main.mjs probeEval. */
async function probeEval(engine, fen) {
  engine.position({ fen });
  const res = await engine.go(EVAL_PROBE_GO, { timeout: EVAL_PROBE_TIMEOUT });
  const score = engine.lastScore(res);
  if (!score) throw new Error('eval probe returned no score');
  return fen.split(' ')[1] === 'w' ? score : { type: score.type, value: -score.value };
}

/** Play one duel; returns { line, engine } (engine may have been recycled). */
async function playOne({ ffish, engine, catalogIni, arena, arm, seed }) {
  const directorConfig = { ...RESTLESS, seed };
  const meter = new RestlessnessMeter(); // active (meter arm) or passive observer (baseline)
  const posLog = new PositionLog();
  const plyEvents = []; // compact per-ply event string: c/k/a/o/r
  const meterTrail = []; // meter VALUE after each completed ply
  let prevFen = arena.startFen;
  const t0 = Date.now();

  const duel = new DuelController({
    ffish,
    engine,
    variantName: arena.variantName,
    startFen: arena.startFen,
    files: arena.files,
    ranks: arena.ranks,
    director: directorConfig,
    go: GO,
    hooks: {
      onMove({ uci }) {
        const ev = moveEvents(prevFen, uci, duel.board);
        ev.repetition = posLog.record(duel.board.fen()) >= 2;
        const v = arm === 'meter' ? duel.director.observePly(ev) : meter.observe(ev);
        meterTrail.push(v);
        plyEvents.push(
          (ev.capture ? 'c' : '') + (ev.check ? 'k' : '') + (ev.pawnAdvance ? 'a' : '') + (ev.promotion ? 'o' : '') + (ev.repetition ? 'r' : '')
        );
        prevFen = duel.board.fen();
      },
      onQuake({ postFen }) {
        prevFen = postFen; // next move is played from the post-quake board
      },
      onEngineStall: async () => {
        try {
          return await freshEngine(catalogIni);
        } catch {
          return null;
        }
      },
    },
  });
  if (arm === 'meter') duel.director = new MeterDirector({ ...directorConfig, meter: {} });
  posLog.record(arena.startFen);

  await duel.start();
  let labError = null;
  while (duel.state === 'playing') {
    if (Date.now() - t0 > GAME_WALL_CLOCK_MS) {
      labError = `lab wall-clock backstop (${GAME_WALL_CLOCK_MS} ms) — aborted`;
      break;
    }
    // Asymmetric seats: the favored side plays the shallow "human" search.
    // Clear Hash first on that seat, or the shared TT quietly lends it the
    // enemy's depth-22 lines and the handicap evaporates.
    const playerSeat = PLAYER_GO && duel.turnColor() === arena.playerColor;
    if (playerSeat) duel.engine.send('setoption name Clear Hash');
    duel.go = playerSeat ? PLAYER_GO : GO;
    const r = await duel.engineMove();
    if (r.ended) break;
  }
  const activeMeter = arm === 'meter' ? duel.director.meter : meter;

  // Per-ply quake-phase outcome tally from the full trace stream (traces are
  // re-derivable from seed+moves, so the corpus keeps only the digest).
  const outcomes = {};
  let fellThrough = 0;
  for (const t of duel.record.quakeTraces) {
    outcomes[t.outcome] = (outcomes[t.outcome] ?? 0) + 1;
    if (t.fellThrough) fellThrough++;
  }

  // Offline eval referee per adopted quake (white POV, 1.2 instrument settings).
  let probeFailures = 0;
  const quakes = [];
  for (const q of duel.record.quakes) {
    const digest = {
      ply: q.ply,
      outcome: q.trace?.outcome ?? null,
      path: q.trace?.path?.join('>') ?? null,
      fellThrough: q.trace?.fellThrough ?? null,
      displacements: q.displacements.map((d) => `${d.piece}${d.from}>${d.to}`),
      crumble: q.crumble ? { sq: q.crumble.square, pieceLost: q.crumble.pieceLost ?? null } : null,
      endedGame: q.endedGame,
      meterV: meterTrail[q.ply - 1] ?? null, // meter after the ply that preceded this quake
      meterP: null,
      preCheck: null,
      evalBefore: null,
      evalAfter: null,
    };
    if (digest.meterV !== null) {
      digest.meterP = Math.min(1, Math.max(Math.min(1, digest.meterV / activeMeter.rampPlies), activeMeter.floor(q.ply)));
    }
    try {
      const b = new ffish.Board(arena.variantName, q.preFen);
      digest.preCheck = b.isCheck();
      b.delete();
    } catch {
      /* leave null */
    }
    if (probeFailures <= 3) {
      try {
        digest.evalBefore = await probeEval(duel.engine, q.preFen);
        digest.evalAfter = await probeEval(duel.engine, q.postFen);
        probeFailures = 0;
      } catch (e) {
        probeFailures++;
        digest.probeError = String(e?.message ?? e).split('\n')[0];
        if (probeFailures === 3) {
          try {
            duel.engine = await freshEngine(catalogIni);
            duel.engine.setoption('UCI_Variant', arena.variantName);
            await duel.engine.isready();
          } catch {
            probeFailures = 99; // give up on probes for this game
          }
        }
      }
    }
    quakes.push(digest);
  }

  const line = {
    arm,
    arena: arena.id,
    playerColor: arena.playerColor,
    seed,
    go: GO,
    playerGo: PLAYER_GO || null,
    directorConfig,
    meterConfig: activeMeter.config0,
    result: duel.record.result,
    winner: duel.record.winner,
    termination: duel.record.termination,
    plies: duel.ply,
    error: labError ?? duel.record.error,
    anomalies: duel.record.anomalies,
    outcomes,
    fellThrough,
    quakes,
    moves: duel.record.moves,
    startFen: arena.startFen,
    plyEvents,
    meterTrail,
    wallMs: Date.now() - t0,
  };
  const next = duel.engine; // may have been recycled by the stall ladder
  duel.destroy();
  return { line, engine: next };
}

const arenas = loadArenas();
if (!arenas.length) {
  console.error(`no arenas match filter "${ARENA_FILTER}"`);
  process.exit(1);
}
const catalogIni = [...new Map(arenas.map((a) => [a.variantName, a.ini])).values()].join('\n');
const ffish = await loadFfish();
ffish.loadVariantConfig(catalogIni);
let engine = await freshEngine(catalogIni);

fs.mkdirSync(OUT_DIR, { recursive: true });
const suffix = TAG ? `-${TAG}` : '';
console.log(`meter lab: arms=[${ARMS}] seeds=${SEEDS} arenas=[${arenas.map((a) => a.id).join(', ')}] go="${GO}" playerGo="${PLAYER_GO}"`);
console.log(`meter defaults: ${JSON.stringify(METER_DEFAULTS)}`);

let gamesSinceRecycle = 0;
for (const arm of ARMS) {
  const outPath = path.join(OUT_DIR, `corpus-${arm}${suffix}.jsonl`);
  fs.writeFileSync(outPath, '');
  for (const arena of arenas) {
    for (let s = 0; s < SEEDS; s++) {
      const seed = SEED_BASE + s;
      if (gamesSinceRecycle >= RECYCLE_EVERY_GAMES) {
        engine = await freshEngine(catalogIni); // rule 6: drop the old reference, never quit()
        gamesSinceRecycle = 0;
      }
      let { line, engine: next } = await playOne({ ffish, engine, catalogIni, arena, arm, seed });
      engine = next;
      gamesSinceRecycle++;
      // Sporadic WASM corruption (rule 6) surfaces as engine desync/no-move
      // errors. One retry on a FRESH instance; a repeat failure is real.
      if (line.error && !line.error.includes('backstop')) {
        console.log(`  retrying on a fresh engine after: ${line.error}`);
        engine = await freshEngine(catalogIni);
        const again = await playOne({ ffish, engine, catalogIni, arena, arm, seed });
        engine = again.engine;
        again.line.retried = true;
        again.line.firstAttemptError = line.error;
        line = again.line;
      }
      fs.appendFileSync(outPath, JSON.stringify(line) + '\n');
      const probes = line.quakes.filter((q) => q.evalBefore && q.evalAfter).length;
      console.log(
        `[${arm}] ${arena.id} seed ${seed}: ${line.result ?? 'ERR'} ${line.winner ?? '-'} ` +
          `${line.termination ?? '?'} in ${line.plies} plies · ${line.quakes.length} quakes ` +
          `(${probes} probed) · fellThrough ${line.fellThrough} · ${(line.wallMs / 1000).toFixed(1)}s` +
          (line.error ? ` · ERROR: ${line.error}` : '')
      );
    }
  }
  console.log(`arm ${arm} → ${outPath}`);
}
console.log('done');
process.exit(0);
