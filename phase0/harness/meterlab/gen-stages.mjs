// Stage-variety generalization set (meter lab phase 2).
//
// The primary sweep runs on the four hand-authored play/arenas — 4×6…5×7,
// 0–2 walls. That is the shipped Phase 1 game, but it is a THIN slice of the
// geometry the design expects (§7 sweeps span widths 3–5, gaps 2–6, wall
// densities to 0.35 — and wall density is the axis that stresses the
// Director hardest: fall-through starvation, terrain-locked pawns, tier-A
// picks). This script generates a fixed, seeded stage set with the
// PHASE-0-VALIDATED sweep generator (harness/arena.mjs: §6-style
// connectivity guarantee, archetype placement) so the meter conclusions can
// be checked for geometry-dependence before anything becomes 1.3 canon.
//
// Every stage hands the PLAYER side a §7-style decisive edge (+4…+7 points,
// the "two blunders from losing" band), alternating player color, spanning
// board sizes 3×6 … 5×10 and gap-band wall densities 0 … 0.35.
//
// Usage: cd phase0 && node harness/meterlab/gen-stages.mjs
// Output: harness/meterlab/stages-varied.json (committed — the corpus input)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadFfish } from '../../lib/load.mjs';
import { buildArena, compValue, COMPS, ARCHETYPES, PIECE_VALUES } from '../arena.mjs';
import { buildDuelBoard, boardToFen, makeDuelVariantIni } from '../../lib/variant.mjs';
import { mulberry32, childSeed } from '../prng.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'stages-varied.json');
const GEN_SEED = 7000; // one fixed seed for the whole set — regeneration is byte-identical

// { width | white/black widths, gap, wallDensity, comps, pawns, playerColor }
// Edge target: player total (comp + pawns) minus enemy total in [4, 7].
const SPECS = [
  { id: 's01-cramped-open', width: 3, gap: 2, wallDensity: 0.0, player: 'white', white: { comp: 'mixed3', pawns: 3 }, black: { comp: 'minors2', pawns: 2 } },
  { id: 's02-walled-corridor', width: 3, gap: 4, wallDensity: 0.2, player: 'black', white: { comp: 'minor1', pawns: 3 }, black: { comp: 'rooks2', pawns: 3 } },
  { id: 's03-mid-sparse', width: 4, gap: 3, wallDensity: 0.1, player: 'white', white: { comp: 'mixed3', pawns: 4 }, black: { comp: 'minors2', pawns: 3 } },
  { id: 's04-deep-dense', width: 4, gap: 5, wallDensity: 0.35, player: 'white', white: { comp: 'heavy3', pawns: 2 }, black: { comp: 'mixed3', pawns: 3 } },
  { id: 's05-wide-brawl', width: 5, gap: 2, wallDensity: 0.1, player: 'black', white: { comp: 'heavy3', pawns: 2 }, black: { comp: 'full4', pawns: 3 } },
  { id: 's06-wide-mid', width: 5, gap: 4, wallDensity: 0.2, player: 'white', white: { comp: 'rooks2', pawns: 5 }, black: { comp: 'minors2', pawns: 3 } },
  { id: 's07-grand-open', width: 5, gap: 6, wallDensity: 0.0, player: 'black', white: { comp: 'mixed3', pawns: 4 }, black: { comp: 'heavy3', pawns: 4 } },
  { id: 's08-asym-patches', gap: 4, wallDensity: 0.2, player: 'white', white: { comp: 'mixed3', pawns: 3, width: 5 }, black: { comp: 'minors2', pawns: 2, width: 3 } },
  { id: 's09-long-corridor', width: 3, gap: 6, wallDensity: 0.1, player: 'white', white: { comp: 'queen1', pawns: 3 }, black: { comp: 'minors2', pawns: 2 } },
  { id: 's10-dense-wide', width: 5, gap: 3, wallDensity: 0.35, player: 'black', white: { comp: 'minor1', pawns: 5 }, black: { comp: 'mixed3', pawns: 3 } },
];

// ---- WIDE stages (8-10 files) ---------------------------------------------
// The Phase 0 generator conflates board width with patch width (§4.2 caps the
// ARMY at 3-5 wide), so it never emits a board wider than 5 files — but live
// stages go to 8-10. These build §4.2-sized patches ON wide ground with
// buildDuelBoard directly: placement varies (center / left / right corners),
// walls sprinkle across the FULL-width gap band, connectivity is re-checked
// (§6-style: a king path must join the two pawn rows).
const WIDE_SPECS = [
  { id: 's11-wide8-open', files: 8, gap: 3, wallDensity: 0.0, player: 'white', white: { comp: 'mixed3', pawns: 3, place: 'center' }, black: { comp: 'minors2', pawns: 2, place: 'center' } },
  { id: 's12-wide8-walled', files: 8, gap: 4, wallDensity: 0.25, player: 'black', white: { comp: 'minors2', pawns: 2, place: 'left' }, black: { comp: 'rooks2', pawns: 3, place: 'right' } },
  { id: 's13-wide10-open', files: 10, gap: 4, wallDensity: 0.0, player: 'black', white: { comp: 'mixed3', pawns: 2, place: 'center' }, black: { comp: 'heavy3', pawns: 3, place: 'center' } },
  { id: 's14-wide10-dense', files: 10, gap: 4, wallDensity: 0.3, player: 'white', white: { comp: 'mixed3', pawns: 2, place: 'center' }, black: { comp: 'minors2', pawns: 3, place: 'center' } },
  { id: 's15-wide9-offset', files: 9, gap: 5, wallDensity: 0.15, player: 'white', white: { comp: 'rooks2', pawns: 3, place: 'left' }, black: { comp: 'minors2', pawns: 2, place: 'right' } },
  { id: 's16-wide10-grand', files: 10, gap: 6, wallDensity: 0.2, player: 'black', white: { comp: 'heavy3', pawns: 2, place: 'center' }, black: { comp: 'full4', pawns: 3, place: 'center' } },
];

/** King-step BFS: the two pawn rows must be connectable through non-walls
 *  (mirror of harness/arena.mjs `connected`, which is module-private). */
function connectedGrid(board, files, ranks) {
  const blocked = (rt, f) => board[rt][f] === '*';
  const start = [];
  for (let f = 0; f < files; f++) if (!blocked(ranks - 2, f)) start.push([ranks - 2, f]);
  const seen = new Set(start.map(([r, f]) => r * 100 + f));
  const queue = [...start];
  while (queue.length) {
    const [r, f] = queue.shift();
    if (r === 1) return true;
    for (let dr = -1; dr <= 1; dr++) {
      for (let df = -1; df <= 1; df++) {
        if (!dr && !df) continue;
        const nr = r + dr;
        const nf = f + df;
        if (nr < 0 || nr >= ranks || nf < 0 || nf >= files) continue;
        const key = nr * 100 + nf;
        if (seen.has(key) || blocked(nr, nf) || seen.size > 4000) continue;
        seen.add(key);
        queue.push([nr, nf]);
      }
    }
  }
  return false;
}

/** §4.2 patch on wide ground → { files, ranks, startFen, meta-ish fields }. */
function buildWideStage(spec) {
  const { files, gap, wallDensity } = spec;
  const ranks = 4 + gap;
  const rng = mulberry32(childSeed(GEN_SEED, spec.id));
  const mkSide = (s) => {
    const comp = COMPS[s.comp];
    const width = Math.max(comp.length + 1, s.pawns); // K + pieces, pawns fit
    const row = ARCHETYPES.balanced(comp, width, rng);
    const start = s.place === 'left' ? 0 : s.place === 'right' ? files - width : Math.floor((files - width) / 2);
    const kingFile = start + row.indexOf('K');
    const patchFiles = Array.from({ length: width }, (_, i) => start + i);
    patchFiles.sort((p, q) => Math.abs(p - kingFile) - Math.abs(q - kingFile) || p - q);
    return { row, start, pawnFiles: patchFiles.slice(0, s.pawns).sort((p, q) => p - q) };
  };
  const w = mkSide(spec.white);
  const b = mkSide(spec.black);
  for (let attempt = 0; attempt < 50; attempt++) {
    const walls = [];
    for (let rank = 2; rank <= ranks - 3; rank++) {
      for (let f = 0; f < files; f++) {
        if (rng() < wallDensity) walls.push(String.fromCharCode(97 + f) + (rank + 1));
      }
    }
    const board = buildDuelBoard({
      files,
      ranks,
      walls,
      white: { backRank: w.row, backRankStart: w.start, row: 0, pawnFiles: w.pawnFiles },
      black: { backRank: b.row, backRankStart: b.start, row: ranks - 1, pawnFiles: b.pawnFiles },
    });
    if (wallDensity === 0 || connectedGrid(board, files, ranks)) {
      return { files, ranks, startFen: boardToFen(board), whiteRow: w.row, blackRow: b.row };
    }
  }
  throw new Error(`${spec.id}: no connected layout in 50 tries (density ${wallDensity})`);
}

const ffish = await loadFfish();
const stages = [];
let failures = 0;
for (const spec of [...SPECS, ...WIDE_SPECS]) {
  const arena = spec.files
    ? (() => {
        const wide = buildWideStage(spec);
        const variantName = `duel_${wide.files}x${wide.ranks}`;
        return {
          ...wide,
          variantName,
          ini: makeDuelVariantIni({ name: variantName, files: wide.files, ranks: wide.ranks }),
          meta: { whiteRow: wide.whiteRow, blackRow: wide.blackRow },
        };
      })()
    : buildArena(
        { width: spec.width, gap: spec.gap, wallDensity: spec.wallDensity, white: spec.white, black: spec.black },
        GEN_SEED
      );
  ffish.loadVariantConfig(arena.ini); // rule 7: names are single-use; dims-keyed dedupe below
  const valid = ffish.validateFen(arena.startFen, arena.variantName) === 1;
  let playable = false;
  if (valid) {
    const b = new ffish.Board(arena.variantName, arena.startFen);
    playable = b.numberLegalMoves() > 0;
    b.delete();
  }
  const wVal = compValue(spec.white.comp, spec.white.pawns);
  const bVal = compValue(spec.black.comp, spec.black.pawns);
  const edge = spec.player === 'white' ? wVal - bVal : bVal - wVal;
  const ok = valid && playable && edge >= 3;
  if (!ok) {
    failures++;
    console.log(`FAIL ${spec.id}: valid=${valid} playable=${playable} edge=${edge}`);
    continue;
  }
  const walls = (arena.startFen.split(' ')[0].match(/\*/g) ?? []).length;
  stages.push({
    id: spec.id,
    files: arena.files,
    ranks: arena.ranks,
    startFen: arena.startFen,
    playerColor: spec.player,
    meta: {
      wallDensity: spec.wallDensity,
      walls,
      gap: spec.gap,
      dims: `${arena.files}x${arena.ranks}`,
      playerValue: spec.player === 'white' ? wVal : bVal,
      enemyValue: spec.player === 'white' ? bVal : wVal,
      edge,
      whiteRow: arena.meta.whiteRow,
      blackRow: arena.meta.blackRow,
      genSeed: GEN_SEED,
    },
  });
  console.log(
    `PASS ${spec.id}: ${arena.files}x${arena.ranks} walls=${walls} (d=${spec.wallDensity}) ` +
      `player=${spec.player} edge=+${edge} fen=${arena.startFen.split(' ')[0]}`
  );
}

if (failures) {
  console.log(`\n${failures} stage(s) failed validation — NOT writing ${OUT}`);
  process.exit(1);
}
fs.writeFileSync(OUT, JSON.stringify({ genSeed: GEN_SEED, stages }, null, 2) + '\n');
console.log(`\n${stages.length} stages → ${OUT}`);
