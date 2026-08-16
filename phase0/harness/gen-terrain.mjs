// Terrain generator / auditor for arena authoring.
//
// WHY THIS EXISTS: hand-drawn "random-looking" walls are not random. The first
// pass of the test shelf shipped nine scenarios with zero walls, three with
// perfect mirror symmetry, and one billed as a rubble field that was in fact a
// period-3 diagonal lattice. Terrain in the real game is projected from a
// procedurally generated dungeon (§5.1/§6) and will be lopsided, will clip one
// formation and not the other, and will lock pawns. The brief puts generated
// wall density at 0.15-0.3 and reports that 95.6% of positions at that density
// carry at least one terrain-locked pawn (mean 4.18) — and that locked starts
// "must stay in the test set" (§6).
//
// So: generate, audit, and freeze the good ones into arena JSON rather than
// drawing them by hand.
//
// Usage:
//   node harness/gen-terrain.mjs --files 9 --ranks 8 --shape rubble --seeds 12
//   node harness/gen-terrain.mjs --audit          # audit the shipped arenas
//
// Shapes are dungeon-plausible processes, not noise:
//   rubble    clustered collapse — seeded blobs that grow, leaving debris
//             trails. Density varies across the board; edges get more.
//   chambers  room walls with doorways punched through at irregular offsets.
//   fault     a wandering diagonal fracture with spurs and gaps.
//   erosion   Earthquake scars (§4.5): pits biased toward where a fight
//             would have been, i.e. the middle ranks.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mulberry32 } from './prng.mjs';
import { loadArena, buildStartFen, defaultPlacement } from '../../play/js/arena.mjs';
import { lockedPawns } from '../../play/js/director.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARENA_DIR = path.resolve(HERE, '../../play/arenas');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const SQ = (f, r) => `${String.fromCharCode(97 + f)}${r + 1}`;

// --------------------------------------------------------------- generators

/** Clustered collapse: pick seed points, grow blobs of varying size. */
function rubble(rng, files, ranks, band, target) {
  const walls = new Set();
  let guard = 0;
  while (walls.size < target && guard++ < 500) {
    // Seed a blob. Bias toward the edges — the middle of a room stays open
    // longer than its corners do.
    const f = Math.floor(rng() * files);
    const r = band[0] + Math.floor(rng() * (band[1] - band[0] + 1));
    const size = 1 + Math.floor(rng() * 4);
    let cf = f;
    let cr = r;
    for (let i = 0; i < size && walls.size < target; i++) {
      if (cf >= 0 && cf < files && cr >= band[0] && cr <= band[1]) walls.add(SQ(cf, cr));
      // Random walk, favouring one axis per blob so debris trails rather than
      // forming a disc.
      if (rng() < 0.6) cf += rng() < 0.5 ? -1 : 1;
      else cr += rng() < 0.5 ? -1 : 1;
    }
  }
  return [...walls];
}

/** Chamber walls with doorways at irregular offsets. */
function chambers(rng, files, ranks, band, target) {
  const walls = new Set();
  const nWalls = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < nWalls; i++) {
    const r = band[0] + Math.floor(rng() * (band[1] - band[0] + 1));
    // Walls rarely span the full width — they stop where the room stopped.
    const from = Math.floor(rng() * Math.max(1, Math.floor(files / 3)));
    const to = files - Math.floor(rng() * Math.max(1, Math.floor(files / 3)));
    // Doorways must land INSIDE the span, or the wall is a solid barrier —
    // picking them from the whole width let seed 1 emit an 8-wide unbroken
    // wall whose only "doors" were the squares the wall never covered.
    const span = Math.max(1, to - from);
    const doors = 1 + Math.floor(rng() * 2);
    const doorAt = new Set();
    for (let d = 0; d < doors; d++) doorAt.add(from + Math.floor(rng() * span));
    for (let f = from; f < to; f++) if (!doorAt.has(f)) walls.add(SQ(f, r));
  }
  // A stub or two of vertical wall, so it is not all horizontal banding.
  const stubs = Math.floor(rng() * 3);
  for (let i = 0; i < stubs; i++) {
    const f = Math.floor(rng() * files);
    const r = band[0] + Math.floor(rng() * (band[1] - band[0] + 1));
    const len = 1 + Math.floor(rng() * 2);
    for (let d = 0; d < len; d++) if (r + d <= band[1]) walls.add(SQ(f, r + d));
  }
  return [...walls].slice(0, target + 4);
}

/** A wandering fracture with spurs — a fault line that is not a staircase. */
function fault(rng, files, ranks, band, target) {
  const walls = new Set();
  let f = Math.floor(rng() * files);
  for (let r = band[0]; r <= band[1]; r++) {
    walls.add(SQ(f, r));
    // Spurs: the fracture occasionally splits sideways.
    if (rng() < 0.45) {
      const df = rng() < 0.5 ? -1 : 1;
      if (f + df >= 0 && f + df < files) walls.add(SQ(f + df, r));
    }
    // Wander, sometimes staying put (a vertical section), sometimes jumping 2.
    const roll = rng();
    if (roll < 0.35) f += rng() < 0.5 ? -1 : 1;
    else if (roll < 0.5) f += rng() < 0.5 ? -2 : 2;
    f = Math.max(0, Math.min(files - 1, f));
  }
  return [...walls].slice(0, target + 3);
}

/** Earthquake scars — pits clustered where the fighting was. */
function erosion(rng, files, ranks, band, target) {
  const walls = new Set();
  const mid = (band[0] + band[1]) / 2;
  let guard = 0;
  while (walls.size < target && guard++ < 500) {
    const f = Math.floor(rng() * files);
    // Gaussian-ish pull toward the middle ranks.
    const spread = (band[1] - band[0]) / 2;
    const r = Math.round(mid + (rng() + rng() + rng() - 1.5) * spread);
    if (r >= band[0] && r <= band[1]) walls.add(SQ(f, r));
  }
  return [...walls];
}

const SHAPES = { rubble, chambers, fault, erosion };

/**
 * Minimum free squares a rank may have. Brief §5.3: "Width 1-2 passages are
 * non-duelable crawlspaces — author them scarce so they read as claustrophobic
 * exceptions, not safe hallways." A rank narrower than this funnels the whole
 * fight through a doorway, which produces fortresses rather than puzzles: the
 * symmetric 2-wide causeway in the first pass was a 400-ply non-termination.
 */
export function minFreePerRank(files) {
  return files <= 4 ? 2 : Math.max(3, Math.ceil(files / 3));
}

/**
 * Widen chokepoints. Two passes, both removing walls (never adding):
 *   1. any rank with fewer than minFreePerRank() free squares is opened up;
 *   2. isolated 1-wide doorways — a free square with a wall either side in its
 *      own rank — are widened by knocking out one flank.
 * Runs on generator output so the SHAPE stays whatever the process produced;
 * this only prevents it from sealing the board.
 */
export function relaxChokes(walls, files, ranks, rng = mulberry32(1)) {
  const set = new Set(walls);
  const free = (f, r) => !set.has(SQ(f, r));
  const minFree = minFreePerRank(files);

  for (let r = 0; r < ranks; r++) {
    let open = [];
    for (let f = 0; f < files; f++) if (free(f, r)) open.push(f);
    while (open.length < minFree) {
      const walled = [];
      for (let f = 0; f < files; f++) if (!free(f, r)) walled.push(f);
      if (!walled.length) break;
      set.delete(SQ(walled[Math.floor(rng() * walled.length)], r));
      open = [];
      for (let f = 0; f < files; f++) if (free(f, r)) open.push(f);
    }
  }

  for (let r = 0; r < ranks; r++) {
    for (let f = 1; f < files - 1; f++) {
      if (free(f, r) && !free(f - 1, r) && !free(f + 1, r)) {
        set.delete(SQ(rng() < 0.5 ? f - 1 : f + 1, r));
      }
    }
  }
  return [...set].sort();
}

/** Generate walls for a board, keeping clear of the formation rows by default. */
export function generateWalls({
  files,
  ranks,
  shape = 'rubble',
  seed = 1,
  density = 0.2,
  keepClear = 1,
  relax = true,
}) {
  const rng = mulberry32(seed);
  const band = [keepClear, ranks - 1 - keepClear];
  const target = Math.round(files * ranks * density);
  const raw = (SHAPES[shape] ?? rubble)(rng, files, ranks, band, target);
  return relax ? relaxChokes(raw, files, ranks, rng) : raw.sort();
}

// ------------------------------------------------------------------- audit

/** Mirror symmetry check — the failure mode of hand-drawn terrain. */
function symmetryReport(walls, files, ranks) {
  const set = new Set(walls);
  const mirrorH = walls.every((w) => {
    const f = w.charCodeAt(0) - 97;
    const r = parseInt(w.slice(1), 10);
    return set.has(SQ(files - 1 - f, r - 1));
  });
  const mirrorV = walls.every((w) => {
    const f = w.charCodeAt(0) - 97;
    const r = parseInt(w.slice(1), 10);
    return set.has(SQ(f, ranks - r));
  });
  return { mirrorH: walls.length > 0 && mirrorH, mirrorV: walls.length > 0 && mirrorV };
}

function auditArena(arena) {
  const { startFen } = buildStartFen(arena, defaultPlacement(arena));
  const locked = lockedPawns(startFen, arena.files, arena.ranks);
  const density = arena.walls.length / (arena.files * arena.ranks);
  const sym = symmetryReport(arena.walls, arena.files, arena.ranks);
  return { startFen, locked, density, ...sym };
}

function renderBoard(files, ranks, walls) {
  const set = new Set(walls);
  const lines = [];
  for (let r = ranks - 1; r >= 0; r--) {
    let line = String(r + 1).padStart(2) + ' ';
    for (let f = 0; f < files; f++) line += set.has(SQ(f, r)) ? '##' : ' .';
    lines.push(line);
  }
  lines.push('   ' + [...Array(files).keys()].map((f) => ' ' + String.fromCharCode(97 + f)).join(''));
  return lines.join('\n');
}

// -------------------------------------------------------------------- main
// Guarded so generateWalls() can be imported by authoring scripts without the
// CLI firing on import.

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (!isMain) {
  // module use only
} else if (process.argv.includes('--audit')) {
  console.log('Arena terrain audit — density target is 0.15-0.3 (brief §6);');
  console.log('locked pawns are EXPECTED (95.6% of generated positions have >=1).\n');
  console.log('arena                     dims   walls  density  mirrorH mirrorV  lockedPawns');
  for (const f of fs.readdirSync(ARENA_DIR).filter((x) => x.endsWith('.json')).sort()) {
    const arena = loadArena(JSON.parse(fs.readFileSync(path.join(ARENA_DIR, f), 'utf8')));
    const a = auditArena(arena);
    console.log(
      `${arena.id.padEnd(24)} ${String(arena.files).padStart(2)}x${arena.ranks}  ` +
        `${String(arena.walls.length).padStart(3)}   ${a.density.toFixed(3)}    ` +
        `${a.mirrorH ? 'YES' : ' - '}     ${a.mirrorV ? 'YES' : ' - '}     ` +
        `${String(a.locked.length).padStart(2)}${a.locked.length ? ' ' + a.locked.map((l) => l.sq).join(',') : ''}`
    );
  }
} else {
  const files = parseInt(arg('files', '9'), 10);
  const ranks = parseInt(arg('ranks', '8'), 10);
  const shape = arg('shape', 'rubble');
  const seeds = parseInt(arg('seeds', '8'), 10);
  const density = parseFloat(arg('density', '0.2'));
  const keepClear = parseInt(arg('keepClear', '1'), 10);
  for (let seed = 1; seed <= seeds; seed++) {
    const walls = generateWalls({ files, ranks, shape, seed, density, keepClear });
    const sym = symmetryReport(walls, files, ranks);
    console.log(
      `\n--- ${shape} seed ${seed} — ${walls.length} walls, density ${(walls.length / (files * ranks)).toFixed(3)}` +
        `${sym.mirrorH ? ' MIRROR-H!' : ''}${sym.mirrorV ? ' MIRROR-V!' : ''}`
    );
    console.log(renderBoard(files, ranks, walls));
    console.log(JSON.stringify(walls));
  }
}
