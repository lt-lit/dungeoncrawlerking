// Sweep arena generation (brief §7): material compositions, patch widths 3-5,
// gaps 2-6, wall densities, arrangement archetypes → variant + startFen.
//
// v0 harness geometry: board files = patch width (both patches full width,
// aligned), ranks = 4 + gap (two 2-deep formations + gap band). Walls are
// sprinkled only in the gap band, never on formation rows. A connectivity
// check regenerates layouts whose walls fully sever the two formations —
// mirroring the §6 linter guarantee that duels have duel-capable ground.
import { makeDuelVariantIni, buildDuelBoard, boardToFen } from '../lib/variant.mjs';
import { isTerrain } from '../lib/fen.mjs';
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

export function compValue(comp, pawnCount) {
  const pieces = COMPS[comp] ?? comp;
  const pieceSum = pieces.reduce((s, p) => s + PIECE_VALUES[p.toLowerCase()], 0);
  return pieceSum + pawnCount; // default pawn row spans the patch width (§4.2)
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
  // board is [rankFromTop][file]; terrain '*'/'^'. Pieces are passable (they
  // move). Legacy generator: it never authors '^', but the test stays honest.
  const blocked = (rt, f) => isTerrain(board[rt][f]);
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
 * Per-side extensions (all optional, default = legacy shared-width behavior):
 *   side.width — this side's patch width (2–5; 2 = the small-army floor for
 *     scrub encounters — the §4.2 width-3 floor is player-side only now),
 *   side.pawns — pawn COUNT for a sparse row (files picked nearest the king;
 *     omit for the automatic full-width §4.2 row),
 *   side.label — display name used in summaries instead of the comp string.
 * files = max(3, widths) — catalog floor stays 3; narrower patches center.
 * Returns { variantName, files, ranks, ini, startFen, meta }.
 */
export function buildArena(cfg, seed) {
  const { gap, wallDensity = 0 } = cfg;
  const side = (s) => ({ ...s, width: s.width ?? cfg.width, pawns: s.pawns });
  const w = side(cfg.white);
  const b = side(cfg.black);
  const perSide = cfg.white.width !== undefined || cfg.black.width !== undefined ||
    cfg.white.pawns !== undefined || cfg.black.pawns !== undefined;
  for (const s of [w, b]) {
    const lo = perSide ? 2 : 3; // legacy configs keep the strict §4.2 floor
    if (s.width < lo || s.width > 5) throw new Error(`patch width ${s.width} outside [${lo},5] (§4.2)`);
    if (s.pawns !== undefined && (s.pawns < 0 || s.pawns > s.width)) {
      throw new Error(`pawn count ${s.pawns} outside [0,${s.width}]`);
    }
  }
  if (gap < 2 || gap > 6) throw new Error(`gap ${gap} outside [2,6] (§4.4)`);
  const files = Math.max(3, w.width, b.width); // variant catalog floor: 3 files
  const ranks = 4 + gap;
  // Legacy configs must keep the exact Phase 0 seed string (smoke/tiny and
  // spikes 07/08 replay byte-identically); per-side configs get their own.
  const seedTag = perSide
    ? `arena-${w.width}p${w.pawns ?? 'a'}v${b.width}p${b.pawns ?? 'a'}-${gap}-${wallDensity}`
    : `arena-${cfg.width}-${gap}-${wallDensity}`;
  const rng = mulberry32(childSeed(seed, seedTag));

  const mkRow = (s) => {
    const comp = COMPS[s.comp] ?? s.comp;
    const arch = ARCHETYPES[s.arch ?? 'balanced'];
    return arch(comp, s.width, rng);
  };
  const whiteRow = mkRow(w);
  const blackRow = mkRow(b);
  const startOf = (s) => Math.floor((files - s.width) / 2); // center narrow patches
  // Sparse pawn rows: `pawns` files nearest the king (ties break left) —
  // the screen a summoner raises first is the one in front of the throne.
  const pawnFilesFor = (s, row, start) => {
    if (s.pawns === undefined) return undefined; // automatic full-width row
    const kingFile = start + row.indexOf('K');
    const patchFiles = Array.from({ length: s.width }, (_, i) => start + i);
    patchFiles.sort((p, q) => Math.abs(p - kingFile) - Math.abs(q - kingFile) || p - q);
    return patchFiles.slice(0, s.pawns).sort((p, q) => p - q);
  };

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
      white: {
        backRank: whiteRow,
        backRankStart: startOf(w),
        row: 0,
        pawnFiles: pawnFilesFor(w, whiteRow, startOf(w)),
      },
      black: {
        backRank: blackRow,
        backRankStart: startOf(b),
        row: ranks - 1,
        pawnFiles: pawnFilesFor(b, blackRow, startOf(b)),
      },
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
      whiteValue: compValue(w.comp, w.pawns ?? w.width),
      blackValue: compValue(b.comp, b.pawns ?? b.width),
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
