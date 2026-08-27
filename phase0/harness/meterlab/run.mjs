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
//   for arm in baseline meter; do for s in s01 s02; do
//     node harness/meterlab/run.mjs --stage-file <set.json> --arms $arm --arenas $s --tag $s --seeds 10
//   done; done
// (--stage-file is REQUIRED since the legacy play/arenas were retired;
// --arenas remains the id substring filter within the set.)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFfish, loadEngine, assertFurnitureSupport } from '../../lib/load.mjs';
import { DuelController } from '../../../play/js/duel.mjs';
import { makeDuelVariantIni } from '../../../play/js/variant.mjs';
import { MeterDirector, RestlessnessMeter, PositionLog, moveEvents, METER_DEFAULTS } from './meter.mjs';
import { mulberry32, childSeed } from '../../../play/js/prng.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// The sweep-validated live baseline (play/js/main.mjs GOD_PRESETS.restless).
const RESTLESS = { onsetPly: 8, quakeRamp: 60, crumbleRamp: 100, debtCap: 10, asymOnsetPly: 50, asymRamp: 60 };

// Arm name → meter config override (see meter.mjs VARIANT KNOBS). null =
// stock Director ('baseline'); everything else runs MeterDirector with v0
// defaults plus exactly ONE knob turned, so cross-arm deltas attribute
// cleanly. 'meter' is v0 itself (the first corpus's arm, kept as control).
const ARM_METER = {
  baseline: null,
  meter: {},
  hold: { holdInCheck: true },
  drain: { sateMode: 'reset' },
  decay: { sateMode: 'decay' },
  'net-presence': { netMode: 'presence' },
  'net-approach': { netMode: 'approach' },
  'crumble-integral': { crumbleIntegral: 100 },
  fast: { rampPlies: 10 },
  slow: { rampPlies: 24 },
  threshold: { thresholdM: 8, rampPlies: 4 },
};
const EVAL_PROBE_GO = 'depth 12 movetime 300'; // mirror of the 1.2 instrument
const EVAL_PROBE_TIMEOUT = 4300;
const GAME_WALL_CLOCK_MS = 15 * 60 * 1000; // lab backstop, not a game rule
const RECYCLE_EVERY_GAMES = 12; // rule 6 margin (live play recycles at 20 duels)

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

const ARMS = arg('arms', 'baseline,meter').split(',').map((s) => s.trim()).filter(Boolean);
for (const a of ARMS) {
  if (!(a in ARM_METER)) {
    console.error(`unknown arm "${a}" — valid: ${Object.keys(ARM_METER).join(', ')}`);
    process.exit(1);
  }
}
const SEEDS = parseInt(arg('seeds', '6'), 10);
const SEED_BASE = parseInt(arg('seed-base', '9000'), 10);
// Comma-separated id substrings (match ANY); empty = all.
const ARENA_FILTERS = arg('arenas', '').split(',').map((s) => s.trim()).filter(Boolean);
const matchesFilter = (id) => !ARENA_FILTERS.length || ARENA_FILTERS.some((f) => id.includes(f));
const GO = arg('go', 'depth 22 movetime 500'); // the shipped duel search (rule 11 cap)
// The favored side (the "player" seat) searches SHALLOW by default: two
// full-strength engines convert the §7 material edge in ~20 plies and the
// duel ends before the gods ever matter. Live play's pathology is a
// mid-skill human converting SLOWLY into the saturated-ramp phase — a
// shallow favored seat reproduces exactly that regime (and its blunders
// keep the §7 "two blunders from losing" frame honest). Pass
// --player-go "" to run both seats at full strength.
const PLAYER_GO = arg('player-go', 'depth 5 movetime 120');
// Seat model for the favored side:
//   depth   — engineMove() at PLAYER_GO (uniformly mediocre; the v1 proxy)
//   multipv — our own MultiPV-3 search at PLAYER_GO, then a SEEDED weighted
//             pick among near-best moves with an occasional blunder window —
//             mostly-good moves + rare lapses, i.e. a human-shaped error
//             model instead of a uniformly shallow one. Moves are recorded,
//             so replay is unaffected by the seat's RNG.
const PLAYER_MODEL = arg('player-model', 'depth');
const OUT_DIR = path.resolve(HERE, '../..', arg('out', 'results/meterlab'));
const TAG = arg('tag', '');
// JSON stage set: {stages:[{id, files, ranks, startFen, playerColor, meta}]}.
// The legacy play/arenas mode is RETIRED with the arenas themselves (the
// setup-UI rework); the Phase 1.3 rerun's corpus builder emits this same
// shape from play/stages × flipStageVertical × armygen.dealMatchup.
const STAGE_FILE = arg('stage-file', '');

function loadArenas() {
  if (!STAGE_FILE) {
    throw new Error(
      'the legacy play/arenas corpus is retired — pass --stage-file <set.json> ' +
        '(the meter-lab rerun builds sets from play/stages × armygen.dealMatchup; ' +
        'startFen/playerColor per entry, both orientations pre-materialized)'
    );
  }
  const { stages } = JSON.parse(fs.readFileSync(path.resolve(STAGE_FILE), 'utf8'));
  return stages
    .filter((s) => matchesFilter(s.id))
    .map((s) => {
      // Entries from the dealMatchup materializer carry their own deal
      // variant (the camp-line double-step, spike 14). variantName and
      // ini travel TOGETHER and the ini must define exactly that name —
      // otherwise every game on the entry targets an unregistered
      // variant (or silently runs under the wrong double-step rules).
      if (!!s.variantName !== !!s.ini) {
        throw new Error(`stage ${s.id}: variantName and ini must be provided together`);
      }
      if (s.ini && !s.ini.includes(`[${s.variantName}:`)) {
        throw new Error(`stage ${s.id}: ini does not define variant "${s.variantName}"`);
      }
      const variantName = s.variantName ?? `duel_${s.files}x${s.ranks}`;
      return {
        id: s.id,
        variantName,
        files: s.files,
        ranks: s.ranks,
        startFen: s.startFen,
        playerColor: s.playerColor,
        meta: s.meta ?? null,
        ini: s.ini ?? makeDuelVariantIni({ name: variantName, files: s.files, ranks: s.ranks }),
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

/** Last (deepest) info line per multipv rank → [{rank, move, score}]. */
function parseMultiPvMoves(infoLines) {
  const byRank = new Map();
  for (const l of infoLines) {
    const m = l.match(/multipv (\d+).*?score (cp|mate) (-?\d+).*? pv (\S+)/);
    if (m) byRank.set(parseInt(m[1], 10), { rank: parseInt(m[1], 10), move: m[4], score: { type: m[2], value: parseInt(m[3], 10) } });
  }
  return [...byRank.values()].sort((a, b) => a.rank - b.rank);
}

const scoreNum = (s) => (s.type === 'mate' ? (s.value > 0 ? 1e6 - s.value : -1e6 - s.value) : s.value);

/** Human-shaped seat pick (mover POV): mostly the best move, sometimes a
 *  near-best alternative, rarely (8%) anything within a 500cp blunder
 *  window. Seeded — but the pick lands in record.moves, so replay never
 *  re-rolls it. */
function pickHumanMove(cands, rng) {
  const best = Math.max(...cands.map((c) => scoreNum(c.score)));
  const loss = (c) => best - scoreNum(c.score);
  if (rng() < 0.08) {
    const pool = cands.filter((c) => loss(c) <= 500);
    return pool[Math.floor(rng() * pool.length)].move;
  }
  const pool = cands.filter((c) => loss(c) <= 150);
  const weights = [0.7, 0.2, 0.1];
  const w = pool.map((c, i) => weights[Math.min(i, weights.length - 1)]);
  const total = w.reduce((a, b) => a + b, 0);
  let roll = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    roll -= w[i];
    if (roll <= 0) return pool[i].move;
  }
  return pool[pool.length - 1].move;
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
  const meterCfg = ARM_METER[arm]; // null = stock Director (baseline arm)
  const meter = new RestlessnessMeter(meterCfg ?? {}); // active (meter arms) or passive observer (baseline)
  const evOpts = { netMode: meter.netMode, files: arena.files, ranks: arena.ranks };
  const posLog = new PositionLog();
  const plyEvents = []; // compact per-ply event string: c/k/a/o/r
  const meterTrail = []; // meter VALUE after each completed ply
  let prevFen = arena.startFen;
  const t0 = Date.now();

  const seatRng = mulberry32(childSeed(seed, 'seat')); // multipv seat picks only
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
        const ev = moveEvents(prevFen, uci, duel.board, evOpts);
        ev.repetition = posLog.record(duel.board.fen()) >= 2;
        const v = arm !== 'baseline' ? duel.director.observePly(ev) : meter.observe(ev);
        meterTrail.push(v);
        plyEvents.push(
          (ev.capture ? 'c' : '') + (ev.check ? 'k' : '') + (ev.pawnAdvance ? 'a' : '') + (ev.promotion ? 'o' : '') + (ev.repetition ? 'r' : '') + (ev.netProgress ? 'n' : '')
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
  if (arm !== 'baseline') duel.director = new MeterDirector({ ...directorConfig, meter: meterCfg });
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
    if (playerSeat && PLAYER_MODEL === 'multipv') {
      // Human-shaped seat: our own MultiPV search on the idle engine, then a
      // seeded near-best pick played through the duel's own playerMove path.
      duel.engine.setoption('MultiPV', '3');
      duel.engine.position({ fen: duel.baseFen, moves: duel.movesSinceBase });
      const mt = PLAYER_GO.match(/movetime (\d+)/);
      let res;
      try {
        res = await duel.engine.go(PLAYER_GO, { timeout: mt ? parseInt(mt[1], 10) + 4000 : 30000 });
      } finally {
        duel.engine.setoption('MultiPV', '1');
      }
      const legal = duel.legalMoves();
      const cands = parseMultiPvMoves(res.infoLines).filter((c) => legal.includes(c.move));
      if (cands.length) {
        const r = await duel.playerMove(pickHumanMove(cands, seatRng));
        if (r.ended) break;
        continue;
      }
      // no usable pv (rare) — fall through to the plain engine seat
    }
    duel.go = playerSeat ? PLAYER_GO : GO;
    const r = await duel.engineMove();
    if (r.ended) break;
  }
  const activeMeter = arm !== 'baseline' ? duel.director.meter : meter;

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
      digest.meterP = Math.min(1, Math.max(activeMeter.pOf(digest.meterV), activeMeter.floor(q.ply)));
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
    playerModel: PLAYER_MODEL,
    stageMeta: arena.meta ?? null,
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
  console.error(`no arenas match filter "${ARENA_FILTERS.join(',')}"`);
  process.exit(1);
}
const catalogIni = [...new Map(arenas.map((a) => [a.variantName, a.ini])).values()].join('\n');
const ffish = await loadFfish();
ffish.loadVariantConfig(catalogIni);
// Stage bed carries furniture (§4.6) since 1.2.4 — fail loudly with the
// overlay recipe when node_modules holds the stock pair, instead of dying
// on the first '^' FEN mid-corpus (the meter-lab law: calibration is only
// valid under the exact shipped ruleset). Probe with the corpus's own
// first crate arena so the variant dims always match.
const crateArena = arenas.find((a) => a.startFen?.includes('^'));
if (crateArena) assertFurnitureSupport(ffish, crateArena.variantName, crateArena.startFen);
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
