// Sweep arena generation (brief §7): material compositions, patch widths 3-5,
// gaps 2-6, wall densities, arrangement archetypes → variant + startFen.
//
// v0 harness geometry: board files = patch width (both patches full width,
// aligned), ranks = 4 + gap (two 2-deep formations + gap band). Walls are
// sprinkled only in the gap band, never on formation rows. A connectivity
// check regenerates layouts whose walls fully sever the two formations —
// mirroring the §6 linter guarantee that duels have duel-capable ground.
import { makeDuelVariantIni, buildDuelBoard, boardToFen } from '../lib/variant.mjs';
import { mulberry32, childSeed, randInt, shuffle } from './prng.mjs';

export const PIECE_VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Named back-row compositions (king added separately). */
export const COMPS = {
  none: [],
  minor1: ['N'],
  minors2: ['N', 'B'],
  rooks2: ['R', 'R'],
  queen1: ['Q'],
  mixed3: ['R', 'N', 'B'],
  heavy3: ['Q', 'R', 'N'],
  full4: ['Q', 'R', 'B', 'N'],
};

export function compValue(comp, width) {
  const pieces = COMPS[comp] ?? comp;
  const pieceSum = pieces.reduce((s, p) => s + PIECE_VALUES[p.toLowerCase()], 0);
  return pieceSum + width; // pawn row spans the patch width (§4.2)
}

/**
 * Arrangement archetypes (§7): map composition + width → back row array.
 * Returns array of length `width` of piece letters (or null for empty slot),
 * exactly one 'K'.
 */
export const ARCHETYPES = {
  // King center, pieces alternating outward, strongest nearest king.
  balanced(comp, width, rng) {
    const row = Array(width).fill(null);
    const kFile = Math.floor(width / 2);
    row[kFile] = 'K';
    const sorted = comp.slice().sort((a, b) => PIECE_VALUES[b.toLowerCase()] - PIECE_VALUES[a.toLowerCase()]);
    let offset = 1;
    let side = -1;
    for (const p of sorted) {
      let placed = false;
      while (!placed && offset < width) {
        const f = kFile + side * offset;
        if (side === 1) offset++;
        side = -side;
        if (f >= 0 && f < width && row[f] === null) {
          row[f] = p;
          placed = true;
        }
      }
    }
    return row;
  },
  // Queen (or strongest piece) in the corner, king center.
  queenCorner(comp, width, rng) {
    const row = ARCHETYPES.balanced(comp, width, rng);
    const qIdx = row.findIndex((p) => p === 'Q');
    if (qIdx >= 0) {
      const corner = row[0] === null ? 0 : row[width - 1] === null ? width - 1 : -1;
      if (corner >= 0) {
        row[corner] = 'Q';
        row[qIdx] = null;
      } else {
        [row[corner < 0 ? 0 : corner], row[qIdx]] = [row[qIdx], row[corner < 0 ? 0 : corner]];
      }
    }
    return row;
  },
  // Rooks at both ends.
  rookFlanks(comp, width, rng) {
    const rooks = comp.filter((p) => p === 'R');
    const rest = comp.filter((p) => p !== 'R');
    const row = ARCHETYPES.balanced(rest, width, rng);
    for (const r of rooks) {
      if (row[0] === null) row[0] = r;
      else if (row[width - 1] === null) row[width - 1] = r;
      else {
        const f = row.findIndex((x) => x === null);
        if (f >= 0) row[f] = r;
      }
    }
    return row;
  },
  // Knights hugging the king.
  knightCore(comp, width, rng) {
    const knights = comp.filter((p) => p === 'N');
    const rest = comp.filter((p) => p !== 'N');
    const row = Array(width).fill(null);
    const kFile = Math.floor(width / 2);
    row[kFile] = 'K';
    let off = 1;
    for (const n of knights) {
      if (kFile - off >= 0 && row[kFile - off] === null) row[kFile - off] = n;
      else if (kFile + off < width && row[kFile + off] === null) row[kFile + off] = n;
      off++;
    }
    const restRow = ARCHETYPES.balanced(rest, width, rng);
    for (let f = 0; f < width; f++) {
      if (row[f] === null && restRow[f] !== null && restRow[f] !== 'K') row[f] = restRow[f];
    }
    return row;
  },
  // Random legal arrangement (seeded) — variety archetype.
  scrambled(comp, width, rng) {
    const slots = shuffle(rng, [...Array(width).keys()]);
    const row = Array(width).fill(null);
    row[slots[0]] = 'K';
    comp.forEach((p, i) => {
      if (i + 1 < slots.length) row[slots[i + 1]] = p;
    });
    return row;
  },
};

/** 8-directional BFS: can a king-step path connect the two pawn rows through non-walls? */
function connected(board, files, ranks) {
  // board is [rankFromTop][file]; walls '*'. Treat pieces as passable (they move).
  const blocked = (rt, f) => board[rt][f] === '*';
  const start = [];
  const targetRank = 1; // top pawn row (rankFromTop 1)
  const startRank = ranks - 2; // bottom pawn row
  for (let f = 0; f < files; f++) if (!blocked(startRank, f)) start.push([startRank, f]);
  const seen = new Set(start.map(([r, f]) => r * 100 + f));
  const queue = [...start];
  while (queue.length) {
    const [r, f] = queue.shift();
    if (r === targetRank) return true;
    for (let dr = -1; dr <= 1; dr++) {
      for (let df = -1; df <= 1; df++) {
        if (!dr && !df) continue;
        const nr = r + dr;
        const nf = f + df;
        if (nr < 0 || nr >= ranks || nf < 0 || nf >= files) continue;
        const key = nr * 100 + nf;
        if (seen.has(key) || blocked(nr, nf)) continue;
        seen.add(key);
        queue.push([nr, nf]);
      }
    }
  }
  return false;
}

/**
 * Build an arena from a sweep config point.
 * cfg = { width, gap, wallDensity, white: {comp, arch}, black: {comp, arch} }
 * Returns { variantName, files, ranks, ini, startFen, meta }.
 */
export function buildArena(cfg, seed) {
  const { width, gap, wallDensity = 0 } = cfg;
  if (width < 3 || width > 5) throw new Error(`patch width ${width} outside [3,5] (§4.2)`);
  if (gap < 2 || gap > 6) throw new Error(`gap ${gap} outside [2,6] (§4.4)`);
  const files = width;
  const ranks = 4 + gap;
  const rng = mulberry32(childSeed(seed, `arena-${width}-${gap}-${wallDensity}`));

  const mkRow = (side) => {
    const comp = COMPS[side.comp] ?? side.comp;
    const arch = ARCHETYPES[side.arch ?? 'balanced'];
    return arch(comp, width, rng);
  };
  const whiteRow = mkRow(cfg.white);
  const blackRow = mkRow(cfg.black);

  // Wall placement in the gap band only (ranks 2..ranks-3 from bottom, 0-based)
  let board = null;
  let wallRerolls = 0;
  for (let attempt = 0; attempt < 50; attempt++) {
    const walls = [];
    for (let rank = 2; rank <= ranks - 3; rank++) {
      for (let f = 0; f < files; f++) {
        if (rng() < wallDensity) walls.push(String.fromCharCode(97 + f) + (rank + 1));
      }
    }
    const candidate = buildDuelBoard({
      files,
      ranks,
      walls,
      white: { backRank: whiteRow, backRankStart: 0, row: 0 },
      black: { backRank: blackRow, backRankStart: 0, row: ranks - 1 },
    });
    if (wallDensity === 0 || connected(candidate, files, ranks)) {
      board = candidate;
      break;
    }
    wallRerolls++;
  }
  if (!board) throw new Error(`could not generate connected arena after 50 tries (density ${wallDensity})`);

  const variantName = `duel_${files}x${ranks}`;
  return {
    variantName,
    files,
    ranks,
    ini: makeDuelVariantIni({ name: variantName, files, ranks }),
    startFen: boardToFen(board),
    meta: {
      ...cfg,
      files,
      ranks,
      whiteRow,
      blackRow,
      whiteValue: compValue(cfg.white.comp, width),
      blackValue: compValue(cfg.black.comp, width),
      wallRerolls,
    },
  };
}

/** Collect one variants.ini covering every distinct (files, ranks) a sweep needs. */
export function collectVariantsIni(arenas) {
  const seen = new Map();
  for (const a of arenas) {
    if (!seen.has(a.variantName)) seen.set(a.variantName, a.ini);
  }
  return [...seen.values()].join('\n');
}
