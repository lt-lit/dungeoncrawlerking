// Encounter linter v1: report what the arenas actually produce.
//
// For each play/arenas/*.json: load + validate (play/js/arena.mjs), stamp the
// DEFAULT placement (the shared defaultPlacement() the game itself uses), and
// play seeded engine-vs-engine games from the resulting startFen.
// Engine-vs-engine plies approximate "plies to mate under best play both
// sides" — the number an encounter's puzzle difficulty is stated in.
//
// Each arena declares what it EXPECTS (arena JSON `expect`, defaulted by
// section in arena.mjs):
//   "player" — the §13 balance philosophy: the arena favors the player.
//   "enemy"  — a deliberately inverted encounter.
//   "any"    — only has to be decisive and error-free. Test scenarios exist to
//              be extreme; asserting a winner on them would be asserting a
//              belief we have not measured.
//
// Two scopes, because the test shelf is far too slow to gate on:
//   --campaign  (default) campaign arenas only. This is the gating run.
//   --all       every arena including the test shelf. Informational; a
//               nonzero exit here still means something is genuinely broken
//               (an error or a non-decisive game), not merely unbalanced.
//
// CAVEAT (CLAUDE.md, Phase 1.5): playGame() still drives the RETIRED crumble
// system (harness/crumble.mjs — repetition + fixed cadence), NOT the shipped
// Board State Director. Ply counts and termination rates here therefore
// describe arena GEOMETRY and MATERIAL faithfully, but not how the live game
// paces or ends. A max-plies non-termination in particular says the old
// system could not close that board; it does not predict the Director. Porting
// the harness is Phase 1.5.
//
// Usage: cd phase0 && node harness/verify-play-arenas.mjs [--games 3] [--all]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFfish, loadEngine } from '../lib/load.mjs';
import { playGame } from './game.mjs';
import { loadArena, buildStartFen, defaultPlacement } from '../../play/js/arena.mjs';
import { makeDuelVariantIni } from '../../play/js/variant.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARENA_DIR = path.resolve(HERE, '../../play/arenas');
const GAMES = (() => {
  const i = process.argv.indexOf('--games');
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : 3;
})();
const SCOPE = process.argv.includes('--all') ? 'all' : 'campaign';
// --only <substr>: iterate on one arena without paying for the whole shelf.
const ONLY = (() => {
  const i = process.argv.indexOf('--only');
  return i >= 0 ? process.argv[i + 1] : null;
})();

const files = fs.readdirSync(ARENA_DIR).filter((f) => f.endsWith('.json')).sort();
const arenas = files
  .map((f) => {
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
      section: arena.section,
      expect: arena.expect,
      warnings: arena.warnings ?? [],
    };
  })
  .filter((a) => (SCOPE === 'all' || a.section === 'campaign') && (!ONLY || a.id.includes(ONLY)));

console.log(`scope: ${SCOPE} — ${arenas.length} arena(s) x ${GAMES} games\n`);
for (const a of arenas) {
  for (const w of a.warnings) console.log(`  WARN ${a.id}: ${w}`);
}

const ffish = await loadFfish();
const catalogIni = [...new Map(arenas.map((a) => [a.variantName, a.ini])).values()].join('\n');
ffish.loadVariantConfig(catalogIni);

// CLAUDE.md rule 6: the WASM instance corrupts under sustained multi-game use,
// so recycle it well before ~40 games. This used to run one instance for the
// whole file, which was survivable at 4 campaign arenas x 3 games (12) and
// crashed outright at 19 x 2 (38) — "memory access out of bounds" from inside
// ffish, AFTER the last game's result printed. Never call quit() in Node
// (Emscripten kills the process); just drop the reference.
const RECYCLE_EVERY = 16;
let engine = null;
let gamesOnEngine = 0;
async function freshEngine() {
  const e = await loadEngine();
  await e.uci();
  e.setoption('Use NNUE', 'false'); // rule 1: defaults TRUE in this build
  await e.loadVariantsIni(catalogIni);
  return e;
}
async function engineFor(variantName) {
  if (!engine || gamesOnEngine >= RECYCLE_EVERY) {
    if (engine) console.log(`  … recycling engine instance after ${gamesOnEngine} games (rule 6)`);
    engine = await freshEngine();
    gamesOnEngine = 0;
  }
  engine.setoption('UCI_Variant', variantName);
  await engine.isready();
  gamesOnEngine++;
  return engine;
}

let failures = 0;
for (const arena of arenas) {
  console.log(
    `\n=== ${arena.id} (${arena.variantName}, player=${arena.playerColor}, expect=${arena.expect}) ===`
  );
  for (let g = 0; g < GAMES; g++) {
    const engine = await engineFor(arena.variantName);
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
        bareKingLoses: true, // the live rule (play/js/duel.mjs adjudicates)
      },
    });
    const playerWon = record.winner === arena.playerColor;
    // Every arena must be decisive and error-free. WHO wins is only asserted
    // when the arena claims to know.
    const decisive = !record.error && !!record.winner;
    const asExpected =
      arena.expect === 'any' || (arena.expect === 'player' ? playerWon : !playerWon);
    const ok = decisive && asExpected;
    if (!ok) failures++;
    console.log(
      `  ${ok ? 'PASS' : 'FAIL'} seed ${arena.crumble.seed + g}: ${record.result ?? 'ERR'} ` +
        `(${record.winner ?? '-'} = ${playerWon ? 'player' : 'enemy'}) in ${record.plies} plies, ` +
        `${record.termination ?? '?'}, ${record.crumbles.length} crumbles` +
        (!decisive ? ' [NOT DECISIVE]' : !asExpected ? ` [expected ${arena.expect} to win]` : '') +
        (record.error ? ` ERROR: ${record.error}` : '')
    );
  }
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`} across ${arenas.length} arenas x ${GAMES} games (scope: ${SCOPE})`);
process.exit(failures === 0 ? 0 : 1);
