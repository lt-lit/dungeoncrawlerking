// Meter lab replay checker — proves the corpus is self-contained evidence.
//
// The Director is deterministic given (seed, config, ply sequence), and the
// meter is a pure function of the move record — so a corpus line's quake
// history must be re-derivable from { directorConfig, meterConfig, startFen,
// moves } alone, NO ENGINE. This script replays every game in the given
// corpus files and byte-checks the reconstructed quake sequence (ply,
// outcome, displacements, crumble square, endsGame) against the recorded
// digests. Exit 0 = every game replays exactly.
//
// This is the property the evidence-preservation argument rests on (the
// baseline corpus stays analyzable after any 1.3 rule change ships), and it
// doubles as the seed of the Phase 1.5 harness replay path.
//
// Usage: cd phase0 && node harness/meterlab/replay.mjs results/meterlab/corpus-*.jsonl
import fs from 'fs';
import { loadFfish } from '../../lib/load.mjs';
import { Director } from '../../../play/js/director.mjs';
import { makeDuelVariantIni } from '../../../play/js/variant.mjs';
import { MeterDirector, PositionLog, moveEvents } from './meter.mjs';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node harness/meterlab/replay.mjs <corpus.jsonl> [...]');
  process.exit(1);
}

const games = [];
for (const f of files) {
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    if (line.trim()) games.push(JSON.parse(line));
  }
}

const ffish = await loadFfish();
const loadedVariants = new Set();

let failures = 0;
let replayed = 0;
for (const g of games) {
  if (g.error) continue; // errored games recorded a partial timeline; skip
  // Arena id → variant via board geometry of the start FEN.
  const ranks = g.startFen.split(' ')[0].split('/').length;
  const filesN = (() => {
    // count cells in the first rank row (digits are runs of empties)
    let n = 0;
    for (const m of g.startFen.split(' ')[0].split('/')[0].matchAll(/(\d+)|([^0-9])/g)) {
      n += m[1] ? parseInt(m[1], 10) : 1;
    }
    return n;
  })();
  const vName = `duel_${filesN}x${ranks}`;
  if (!loadedVariants.has(vName)) {
    ffish.loadVariantConfig(makeDuelVariantIni({ name: vName, files: filesN, ranks })); // rule 7: single-use names
    loadedVariants.add(vName);
  }

  const director =
    g.arm === 'meter'
      ? new MeterDirector({ ...g.directorConfig, meter: g.meterConfig })
      : new Director(g.directorConfig);
  const posLog = new PositionLog();
  posLog.record(g.startFen);
  let board = new ffish.Board(vName, g.startFen);
  let prevFen = g.startFen;
  const got = [];
  for (let i = 0; i < g.moves.length; i++) {
    board.push(g.moves[i]);
    const ply = i + 1;
    const ev = moveEvents(prevFen, g.moves[i], board);
    ev.repetition = posLog.record(board.fen()) >= 2;
    if (g.arm === 'meter') director.observePly(ev);
    prevFen = board.fen();
    if (board.numberLegalMoves() === 0) break; // game over — no quake phase
    const bf = board.fen().split(' ')[0];
    if (!bf.includes('K') || !bf.includes('k')) break; // kingless adjudication
    const quake = director.quake(ffish, vName, board.fen(), filesN, ranks, ply);
    if (!quake) continue;
    // Duel-layer safety net, replayed deterministically (adoption-only).
    if (ffish.validateFen(quake.postFen, vName) !== 1) continue;
    const next = new ffish.Board(vName, quake.postFen);
    if (next.numberLegalMoves() === 0 && !quake.endsGame) {
      next.delete();
      continue;
    }
    got.push({
      ply,
      outcome: quake.trace.outcome,
      displacements: quake.displacements.map((d) => `${d.piece}${d.from}>${d.to}`),
      crumble: quake.crumble ? quake.crumble.square : null,
      endedGame: quake.endsGame,
    });
    board.delete();
    board = next;
    prevFen = quake.postFen;
    if (quake.endsGame) break;
  }
  board.delete();

  const want = g.quakes.map((q) => ({
    ply: q.ply,
    outcome: q.outcome,
    displacements: q.displacements,
    crumble: q.crumble ? q.crumble.sq : null,
    endedGame: q.endedGame,
  }));
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  replayed++;
  if (a !== b) {
    failures++;
    console.log(`MISMATCH ${g.arm} ${g.arena} seed ${g.seed}:`);
    console.log(`  recorded: ${b}`);
    console.log(`  replayed: ${a}`);
  }
}

console.log(`${failures === 0 ? 'PASS' : 'FAIL'}: ${replayed - failures}/${replayed} games replay exactly (engine-free)`);
process.exit(failures === 0 ? 0 : 1);
