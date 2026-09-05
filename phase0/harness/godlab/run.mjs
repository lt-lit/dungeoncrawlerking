// The god lab — the Phase 1.5 Director-calibration sweep rig.
//
// Successor to the retired crumble-era harness (game.mjs/crumble.mjs/
// arena.mjs/sweep.mjs). Those re-implemented the duel loop and generated
// legacy arenas; both halves were wrong by 1.5 — the loop had drifted from
// the shipped rules (the §7 sweep-validity law: calibration counts only if
// the harness plays the EXACT shipped ruleset, and two sweep generations
// died to that law already) and the bed was the pre-1.2.4 "wrong
// distribution" the Proving Grounds replaced. This rig fixes both by
// construction: it plays the CANON play/js pipeline — DuelController and
// the v3 Director, untouched — on the designer-locked stage bed via
// armygen.dealMatchup, so a Director change is measured the moment it
// lands, with no port to keep in sync.
//
// What one run produces (JSONL, one game per line):
//   - the game: moves, result, termination, plies, the deal's variantName
//     AND variantIni (recorded so deal-variant corpora replay byte-exact —
//     the camp-line double-step lives in that ini, and the meter-lab rig's
//     omission of it was a known 1.2.4 defect)
//   - per-quake digests: rungs spent, terrain edits, displacements, held
//     (in-check) flag, plus an OFFLINE eval referee (white-POV probes of
//     preFen/postFen at the 1.2 instrument's settings) for the §7 alarm
//     metric — refereeing only, nothing feeds back into play
//   - per-ply trails: staleness + its inputs (captures available, legal
//     moves), locked pawns (the §6 lint's replacement — the trajectory IS
//     the evidence for whether v3 clears locks), wall/crate counts (terrain
//     attrition — "the gods strip rooms bare" as a curve, designer report
//     2026-09-01), and the Director's own pressure from its roll traces
//
// Usage (from phase0/, with the play/vendor overlay applied — see
// engine/README.md; the stock pair dies on the first '^' FEN):
//   node harness/godlab/run.mjs harness/godlab/sweeps/smoke.json
//     [--out results/godlab] [--tag foo] [--stages s51,s52] [--arms calm,off]
//
// Engine stdout is huge and searches are CPU-bound: one lab at a time, and
// for big grids run one process per arm×stage batch (--arms/--stages) — the
// WASM engine corrupts under sustained multi-game use (rule 6) and dropped
// instances never free their pthread workers, so process exit is the only
// real memory hygiene.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFfish, loadEngine, assertFurnitureSupport } from '../../lib/load.mjs';
import { DuelController } from '../../../play/js/duel.mjs';
import { loadStageV2 } from '../../../play/js/stage.mjs';
import { dealMatchup } from '../../../play/js/armygen.mjs';
import { makeCatalogIni } from '../../../play/js/variant.mjs';
import { fenGrid, lockedPawns, GOD_PRESETS } from '../../../play/js/director.mjs';
import { stalenessOf } from '../../../play/js/staleness.mjs';
import { isTerrain, WALL, FURNITURE } from '../../../play/js/fen.mjs';
import { mulberry32, childSeed } from '../../../play/js/prng.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGE_DIR = path.join(HERE, '../../../play/stages');

// GOD_PRESETS is imported from director.mjs — the ONE table the game ships
// (the hand-synced copies here and in ladder-smoke died with the 2026-09-01
// retune; an arm's `preset` key always measures what the phone plays).

const EVAL_PROBE_TIMEOUT_PAD = 4000; // referee movetime + this = watchdog
const GAME_WALL_CLOCK_MS = 15 * 60 * 1000; // lab backstop, not a game rule
const RECYCLE_EVERY_GAMES = 12; // rule 6 margin (live play recycles at 20 duels)

function cliArg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
}

const configPath = process.argv.slice(2).find((a) => !a.startsWith('--') && a !== process.argv[1]);
if (!configPath) {
  console.error('usage: node harness/godlab/run.mjs <sweep-config.json> [--out dir] [--tag t] [--stages s01,s51] [--arms calm,off]');
  process.exit(2);
}
const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const GO = cfg.go ?? 'depth 22 movetime 500'; // the shipped duel search (rule 11 cap)
const MATE_GO = cfg.mateGo === undefined ? 'depth 12 movetime 600' : cfg.mateGo; // v4.2: the gods' mate probes (null = off)
// Favored-seat model (§7): the favored side searches shallow because live
// play's pathology is a mid-skill human converting SLOWLY into the phase
// where the gods matter. playerColor null = symmetric (no favored seat).
const PLAYER_GO = cfg.playerGo ?? '';
const PLAYER_COLOR = cfg.playerColor ?? null;
const PLAYER_MODEL = cfg.playerModel ?? 'depth'; // depth | multipv
const PLAYER_EDGE = cfg.playerEdge ?? 1; // §7 material edge: favored side's budget multiplier
const MAX_PLIES = cfg.maxPlies ?? 600;
const SEEDS = parseInt(cliArg('seeds', String(cfg.seeds ?? 2)), 10);
const SEED_BASE = cfg.seedBase ?? 11000;
const REFEREE_GO = cfg.referee === false ? null : (cfg.refereeGo ?? 'depth 12 movetime 300'); // the 1.2 instrument's settings
const OUT_DIR = path.resolve(HERE, '../..', cliArg('out', cfg.out ?? 'results/godlab'));
const TAG = cliArg('tag', cfg.tag ?? '');

// Arms: [{ key, preset?, gods?: 'off', favor?, director?: {knob overrides} }].
// Overrides land on top of the preset (DIRECTOR_DEFAULTS underneath), so an
// arm can turn exactly one knob and cross-arm deltas attribute cleanly.
const armFilter = cliArg('arms', '').split(',').map((s) => s.trim()).filter(Boolean);
const arms = (cfg.arms ?? [{ key: 'restless', preset: 'restless' }]).filter(
  (a) => !armFilter.length || armFilter.includes(a.key)
);
for (const a of arms) {
  if (a.preset && !(a.preset in GOD_PRESETS)) {
    console.error(`arm "${a.key}": unknown preset "${a.preset}" — valid: ${Object.keys(GOD_PRESETS).join(', ')}`);
    process.exit(1);
  }
}
function directorConfigFor(arm, seed) {
  if (arm.gods === 'off') return { seed, onsetPly: Infinity };
  const preset = arm.preset ? GOD_PRESETS[arm.preset] : GOD_PRESETS.restless;
  return { seed, ...preset, ...(arm.director ?? {}) };
}

// --- the bed: designer-locked stages × orientations × dealMatchup ---------

const stageFilters = cliArg('stages', (cfg.stageFilter ?? []).join(','))
  .split(',').map((s) => s.trim()).filter(Boolean);
const allStages = fs.readdirSync(STAGE_DIR)
  .filter((f) => /^s\d+.*\.json$/.test(f))
  .sort()
  .map((f) => loadStageV2(JSON.parse(fs.readFileSync(path.join(STAGE_DIR, f), 'utf8'))))
  .filter((s) => !stageFilters.length || stageFilters.some((f) => s.id.includes(f)));

// Stratified spread (ladder-smoke's trick): sort by area then furniture and
// index evenly, so a subset keeps small/large and sparse/crate-dense boards
// and one stage's quirk cannot read as a Director property.
let stages = allStages;
if (cfg.stageSpread && cfg.stageSpread < allStages.length) {
  const spread = [...allStages].sort((a, b) => {
    const area = (s) => s.files * s.ranks;
    return area(a) - area(b) || a.furniture.length - b.furniture.length;
  });
  stages = [];
  for (let i = 0; i < cfg.stageSpread; i++) stages.push(spread[Math.floor((i * spread.length) / cfg.stageSpread)]);
}
const ORIENTATIONS = cfg.orientations === 'normal' ? [false] : cfg.orientations === 'flipped' ? [true] : [false, true];

// Stage class for the per-class breakdowns (wave 4 = the furniture bed,
// wave 5 splits at the s51 floorplans — see CLAUDE.md's 1.2.4 notes;
// wave 6, s59+, is the 2026-09-04 refresh — 36 hand-authored 10×10
// arenas, one class: every one is a floorplan-scale crop).
function stageClass(id) {
  const n = parseInt(id.match(/^s(\d+)/)?.[1] ?? '0', 10);
  return n >= 59 ? 'refresh' : n >= 51 ? 'floorplan' : n >= 34 ? 'rooms' : 'core';
}

// Army width scales with the stage or the 5x5 end of the bed rejects every
// deal and the spread silently loses its small boards (ladder-smoke's
// hard-won sampling-bias fix). PLAYER_EDGE hands the §7 material edge to the
// favored seat through its budget.
function specFor(stage) {
  const width = Math.max(3, Math.min(8, stage.files - 2));
  const budget = Math.round(width * 4.5);
  const edged = Math.round(budget * PLAYER_EDGE);
  return {
    white: { spec: { width, budget: PLAYER_COLOR === 'white' ? edged : budget } },
    black: { spec: { width, budget: PLAYER_COLOR === 'black' ? edged : budget } },
  };
}

// --- per-ply instrumentation ----------------------------------------------

/** Wall/crate counts from a grid (authored + god-made together — the split
 *  is reconstructed in analysis from the quake terrain-edit stream). */
function terrainCounts(grid, files, ranks) {
  let walls = 0;
  let crates = 0;
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      if (grid[r][f] === WALL) walls++;
      else if (grid[r][f] === FURNITURE) crates++;
    }
  }
  return { walls, crates };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

// --- engine plumbing ------------------------------------------------------

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
  const mt = REFEREE_GO.match(/movetime (\d+)/);
  const res = await engine.go(REFEREE_GO, { timeout: (mt ? parseInt(mt[1], 10) : 2000) + EVAL_PROBE_TIMEOUT_PAD });
  const score = engine.lastScore(res);
  if (!score) throw new Error('eval probe returned no score');
  return fen.split(' ')[1] === 'w' ? score : { type: score.type, value: -score.value };
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
 *  window. Seeded — the pick lands in record.moves, so replay never
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

// --- one game -------------------------------------------------------------

/** Play one duel; returns { line, engine } (engine may have been recycled). */
async function playOne({ ffish, engine, catalogIni, deal, stage, flip, arm, seed }) {
  const directorConfig = directorConfigFor(arm, seed);
  const t0 = Date.now();
  const seatRng = mulberry32(childSeed(seed, 'seat')); // multipv seat picks only

  // Per-ply trails. staleness/locked/terrain come from onMove (pure grid
  // reads — stalenessOf touches no RNG, so the Director's stream is safe);
  // pressure comes from the Director's own roll trace (onDirectorTrace
  // fires every ply, quake or quiet).
  const trail = { staleness: [], lockedPawns: [], walls: [], crates: [], captures: [], pressure: [], heat: [], threats: [], tedium: [] };

  const duel = new DuelController({
    ffish,
    engine,
    variantName: deal.variantName,
    startFen: deal.fen,
    files: deal.files,
    ranks: deal.ranks,
    director: directorConfig,
    go: GO,
    mateGo: MATE_GO,
    hooks: {
      onMove() {
        const fen = duel.board.fen();
        const grid = fenGrid(fen, deal.files, deal.ranks);
        const s = stalenessOf(grid, duel.board.legalMoves(), deal.files, deal.ranks, duel.director.stalenessConfig);
        const t = terrainCounts(grid, deal.files, deal.ranks);
        trail.staleness.push(r3(s.staleness));
        trail.lockedPawns.push(s.lockedPawns);
        trail.walls.push(t.walls);
        trail.crates.push(t.crates);
        trail.captures.push(s.captures);
      },
      onDirectorTrace(trace) {
        trail.pressure.push(r3(trace.p?.pressure ?? 0));
        trail.heat.push(r3(trace.heat ?? 0)); // v4
        trail.threats.push(trace.threats ?? 0); // v4: new threat keys this ply created
        trail.tedium.push(r3(trace.tedium ?? 0)); // v4: the ladder's input
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
  if (arm.favor !== undefined) duel.setFavor(arm.favor); // the intensity dial, recorded in record.tunes

  await duel.start();
  let labError = null;
  while (duel.state === 'playing') {
    if (duel.ply >= MAX_PLIES) {
      labError = `max-plies (${MAX_PLIES}) reached without termination`;
      break;
    }
    if (Date.now() - t0 > GAME_WALL_CLOCK_MS) {
      labError = `lab wall-clock backstop (${GAME_WALL_CLOCK_MS} ms) — aborted`;
      break;
    }
    // Asymmetric seats: the favored side plays the shallow "human" search.
    // Clear Hash first on that seat, or the shared TT quietly lends it the
    // enemy's depth-22 lines and the handicap evaporates.
    const playerSeat = PLAYER_GO && PLAYER_COLOR && duel.turnColor() === PLAYER_COLOR;
    if (playerSeat) duel.engine.send('setoption name Clear Hash');
    if (playerSeat && PLAYER_MODEL === 'multipv') {
      // Human-shaped seat, with the recovery the meter-lab rig lacked (its
      // known 1.2.4 defect): a search failure here recycles the engine and
      // falls through to the plain seat instead of crashing the arm —
      // rule 12, every search path needs its own way back.
      let cands = null;
      try {
        duel.engine.setoption('MultiPV', '3');
        duel.engine.position({ fen: duel.baseFen, moves: duel.movesSinceBase });
        const mt = PLAYER_GO.match(/movetime (\d+)/);
        const res = await duel.engine.go(PLAYER_GO, { timeout: mt ? parseInt(mt[1], 10) + 4000 : 30000 });
        const legal = duel.legalMoves();
        cands = parseMultiPvMoves(res.infoLines).filter((c) => legal.includes(c.move));
      } catch (e) {
        duel.record.anomalies.push(`ply ${duel.ply}: multipv seat search failed (${String(e?.message ?? e).split('\n')[0]}) — recycling`);
        try {
          duel.engine = await freshEngine(catalogIni);
          duel.engine.setoption('UCI_Variant', deal.variantName);
          await duel.engine.isready();
        } catch {
          labError = 'multipv seat: engine recycle failed';
          break;
        }
      } finally {
        try {
          duel.engine.setoption('MultiPV', '1');
        } catch { /* dead instance already replaced */ }
      }
      if (cands?.length) {
        const r = await duel.playerMove(pickHumanMove(cands, seatRng));
        if (r.ended) break;
        continue;
      }
      // no usable pv — fall through to the plain engine seat
    }
    duel.go = playerSeat ? PLAYER_GO : GO;
    const r = await duel.engineMove();
    if (r.ended || r.error) break;
  }

  // Per-quake digests + the offline eval referee (§7 alarm metric input).
  let probeFailures = 0;
  const quakes = [];
  for (const q of duel.record.quakes) {
    const digest = {
      ply: q.ply,
      preFen: q.preFen, // v4.2: the exact board the gods edited, for offline probe replays
      rungsSpent: q.trace?.rungsSpent ?? [],
      held: q.trace?.held ?? null,
      terrain: (q.terrain ?? []).map((t) => `${t.kind}@${t.square}`),
      displacements: q.displacements.map((d) => `${d.piece}${d.from}>${d.to}`),
      crumble: q.crumble ? { sq: q.crumble.square, pieceLost: q.crumble.pieceLost ?? null } : null,
      endedGame: q.endedGame,
      meterAfter: q.trace?.meterAfter ?? null, // v4: the discharge
      pressureMeter: q.trace?.p?.meterP ?? null, // v4: which half of the trigger fired
      pressureFloor: q.trace?.p?.floor ?? null,
      pressureDead: q.trace?.p?.dead ?? null, // v4: the dead-board backstop
      protected: q.trace?.protected // v4: the protected set's census
        ? {
            pieces: q.trace.protected.pieces,
            squares: q.trace.protected.squares,
            wins: q.trace.protected.wins,
            nodes: q.trace.protected.nodes,
            truncated: q.trace.protected.truncated,
            engine: q.trace.protected.engine // v4.2: hints seen, mate lines found, and the lines
              ? { hints: q.trace.protected.engine.hints, mates: q.trace.protected.engine.mates, lines: q.trace.protected.engine.lines, probes: q.trace.protected.engine.probes ?? null }
              : null,
          }
        : null,
      evalBefore: null,
      evalAfter: null,
    };
    if (REFEREE_GO && probeFailures <= 3) {
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
            duel.engine.setoption('UCI_Variant', deal.variantName);
            await duel.engine.isready();
          } catch {
            probeFailures = 99; // give up on probes for this game
          }
        }
      }
    }
    quakes.push(digest);
  }

  const startGrid = fenGrid(deal.fen, deal.files, deal.ranks);
  const authored = {
    ...terrainCounts(startGrid, deal.files, deal.ranks),
    area: deal.files * deal.ranks,
    lockedPawns: lockedPawns(deal.fen, deal.files, deal.ranks).length,
  };

  const line = {
    lab: cfg.name,
    arm: arm.key,
    stage: stage.id,
    class: stageClass(stage.id),
    flip,
    dims: `${deal.files}x${deal.ranks}`,
    files: deal.files,
    ranks: deal.ranks,
    seed,
    go: GO,
    playerGo: PLAYER_GO || null,
    playerColor: PLAYER_COLOR,
    playerModel: PLAYER_GO ? PLAYER_MODEL : null,
    playerEdge: PLAYER_EDGE,
    refereeGo: REFEREE_GO,
    variantName: deal.variantName,
    variantIni: deal.variantIni,
    startFen: deal.fen,
    directorConfig: duel.director.config0, // post-guard, replay-exact
    favor: duel.director.favor,
    authored,
    result: duel.record.result,
    winner: duel.record.winner,
    termination: labError ? null : duel.record.termination,
    plies: duel.ply,
    error: labError ?? duel.record.error,
    anomalies: duel.record.anomalies,
    holesEnd: duel.director.holes.size,
    quakes,
    moves: duel.record.moves,
    trail,
    wallMs: Date.now() - t0,
  };
  const next = duel.engine; // may have been recycled by the stall ladder
  duel.destroy();
  return { line, engine: next };
}

// --- main -----------------------------------------------------------------

const ffish = await loadFfish();
let catalogIni = makeCatalogIni();
ffish.loadVariantConfig(catalogIni);
assertFurnitureSupport(ffish); // overlay guard — stock pair fails loudly here

// Materialize every deal up front so ONE cumulative catalog covers the whole
// run (rule 7: deal-variant names encode their config, re-registration is an
// identical-config no-op; every fresh engine reloads the full catalog).
const seenVariants = new Set();
const jobs = [];
for (const stage of stages) {
  for (const flip of ORIENTATIONS) {
    for (let s = 0; s < SEEDS; s++) {
      const seed = SEED_BASE + s;
      const deal = dealMatchup({ stage, flip, ...specFor(stage), seed, turn: 'w', ffish });
      if (!deal.ok) {
        jobs.push({ stage, flip, seed, skipped: deal.error });
        continue;
      }
      // dealMatchup already registered the deal variant with ffish
      // (armygen.mjs) — only the engines' cumulative catalog needs it.
      if (!seenVariants.has(deal.variantName)) {
        catalogIni += '\n' + deal.variantIni;
        seenVariants.add(deal.variantName);
      }
      jobs.push({ stage, flip, seed, deal });
    }
  }
}
const playable = jobs.filter((j) => j.deal);
const totalGames = playable.length * arms.length;
console.log(
  `god lab "${cfg.name}": ${stages.length} stages × ${ORIENTATIONS.length} orientations × ${SEEDS} seeds` +
    ` = ${playable.length} deals (${jobs.length - playable.length} skipped) × ${arms.length} arms = ${totalGames} games`
);
console.log(`go "${GO}" playerGo "${PLAYER_GO}" playerColor ${PLAYER_COLOR} edge ${PLAYER_EDGE} referee "${REFEREE_GO}" mateGo "${MATE_GO}"`);

let engine = await freshEngine(catalogIni);
fs.mkdirSync(OUT_DIR, { recursive: true });
const suffix = TAG ? `-${TAG}` : '';
const started = Date.now();
let done = 0;
let gamesSinceRecycle = 0;
const outPaths = [];
for (const arm of arms) {
  const outPath = path.join(OUT_DIR, `godlab-${cfg.name}-${arm.key}${suffix}.jsonl`);
  outPaths.push(outPath);
  fs.writeFileSync(outPath, '');
  for (const job of jobs) {
    if (job.skipped) {
      fs.appendFileSync(outPath, JSON.stringify({ lab: cfg.name, arm: arm.key, stage: job.stage.id, flip: job.flip, seed: job.seed, skipped: job.skipped }) + '\n');
      continue;
    }
    if (gamesSinceRecycle >= RECYCLE_EVERY_GAMES) {
      engine = await freshEngine(catalogIni); // rule 6: drop the old reference, never quit()
      gamesSinceRecycle = 0;
    }
    let { line, engine: next } = await playOne({ ffish, engine, catalogIni, ...job, arm });
    engine = next;
    gamesSinceRecycle++;
    // Sporadic WASM corruption (rule 6) surfaces as desync/no-move errors.
    // One retry on a FRESH instance; a repeat failure is real.
    if (line.error && !line.error.includes('backstop') && !line.error.includes('max-plies')) {
      console.log(`  retrying on a fresh engine after: ${line.error}`);
      engine = await freshEngine(catalogIni);
      const again = await playOne({ ffish, engine, catalogIni, ...job, arm });
      engine = again.engine;
      again.line.retried = true;
      again.line.firstAttemptError = line.error;
      line = again.line;
    }
    fs.appendFileSync(outPath, JSON.stringify(line) + '\n');
    done++;
    const eta = Math.round(((Date.now() - started) / done) * (totalGames - done) / 1000);
    const acts = line.quakes.reduce((a, q) => a + q.rungsSpent.length, 0);
    console.log(
      `[${done}/${totalGames}] [${arm.key}] ${job.stage.id}${job.flip ? '~f' : ''} seed ${job.seed}: ` +
        `${line.result ?? 'ERR'} ${line.termination ?? '?'} in ${line.plies}p · ` +
        `${line.quakes.length}q/${acts}a · holes ${line.holesEnd} · ${(line.wallMs / 1000).toFixed(1)}s · eta ${eta}s` +
        (line.error ? ` · ERROR: ${line.error}` : '')
    );
  }
  console.log(`arm ${arm.key} → ${outPath}`);
}
console.log(`\ndone — analyze with:\n  node harness/godlab/analyze.mjs ${outPaths.join(' ')}`);
process.exit(0);
