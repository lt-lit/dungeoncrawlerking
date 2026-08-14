// Encounter linter v0: verify the Phase 1 arenas produce puzzle-band duels.
//
// For each play/arenas/*.json: load + validate (play/js/arena.mjs), stamp the
// DEFAULT placement (same algorithm as play/js/main.mjs), and play seeded
// engine-vs-engine games from the resulting startFen. Engine-vs-engine plies
// approximate "plies to mate under best play both sides" — the number an
// encounter's puzzle difficulty is stated in. Exit 0 iff every game is
// decisive, error-free, and the favored side (the player) wins.
//
// Usage: cd phase0 && node harness/verify-play-arenas.mjs [--games 3]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFfish, loadEngine } from '../lib/load.mjs';
import { playGame } from './game.mjs';
import {
  loadArena,
  buildStartFen,
  playerSlotSquares,
  defaultPawnSquares,
} from '../../play/js/arena.mjs';
import { makeDuelVariantIni } from '../../play/js/variant.mjs';
import { parseSquare } from '../../play/js/fen.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARENA_DIR = path.resolve(HERE, '../../play/arenas');
const GAMES = (() => {
  const i = process.argv.indexOf('--games');
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : 3;
})();

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

const files = fs.readdirSync(ARENA_DIR).filter((f) => f.endsWith('.json')).sort();
const arenas = files.map((f) => {
  const arena = loadArena(JSON.parse(fs.readFileSync(path.join(ARENA_DIR, f), 'utf8')));
  const { startFen } = buildStartFen(arena, defaultPlacement(arena));
  return {
    variantName: arena.variantName,
    files: arena.files,
    ranks: arena.ranks,
    ini: makeDuelVariantIni({ name: arena.variantName, files: arena.files, ranks: arena.ranks }),
    startFen,
    meta: { id: arena.id, playerColor: arena.playerColor, crumble: arena.crumble },
    playerColor: arena.playerColor,
    crumble: arena.crumble,
    id: arena.id,
  };
});

const ffish = await loadFfish();
const catalogIni = [...new Map(arenas.map((a) => [a.variantName, a.ini])).values()].join('\n');
ffish.loadVariantConfig(catalogIni);
const engine = await loadEngine();
await engine.uci();
engine.setoption('Use NNUE', 'false');
await engine.loadVariantsIni(catalogIni);

let failures = 0;
for (const arena of arenas) {
  console.log(`\n=== ${arena.id} (${arena.variantName}, player=${arena.playerColor}) ===`);
  for (let g = 0; g < GAMES; g++) {
    engine.setoption('UCI_Variant', arena.variantName);
    await engine.isready();
    const record = await playGame({
      engine,
      ffish,
      arena,
      opts: {
        go: 'depth 60 movetime 150',
        maxPlies: 400,
        crumble: { onsetPly: arena.crumble.onsetPly, cadence: arena.crumble.cadence },
        seed: arena.crumble.seed + g,
        evalDeadband: 50,
      },
    });
    const playerWon = record.winner === arena.playerColor;
    const ok = !record.error && record.winner && playerWon;
    if (!ok) failures++;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'} seed ${arena.crumble.seed + g}: ${record.result ?? 'ERR'} ` +
        `(${record.winner ?? '-'} = ${playerWon ? 'player' : 'enemy'}) in ${record.plies} plies, ` +
        `${record.termination ?? '?'}, ${record.crumbles.length} crumbles` +
        (record.error ? ` ERROR: ${record.error}` : '')
    );
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} across ${arenas.length} arenas x ${GAMES} games`);
process.exit(failures === 0 ? 0 : 1);
