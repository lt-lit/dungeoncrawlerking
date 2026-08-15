// The Board State Director ("THE GODS") — arena regeneration, v2.
//
// Replaces the §4.5 repetition+pacing crumble system with Earthquakes:
// past a rising hazard ramp, the arena stirs — pieces scoot to adjacent
// squares (displacement) and, increasingly as the duel runs long, squares
// collapse into pits (crumbles). Everything the engine sees stays FSF-pure;
// the Director rewrites the FEN between plies exactly like the old crumble
// system (Prime Directive carve-out, brief §2).
//
// Design rules (validated in the 2026-08 prototype sweeps; see the session's
// walled-arena head-to-heads):
//  - Repetition is not punished. No position tracking, no repetition crumble.
//    Termination now rests on crumbles alone: free squares only ever shrink,
//    so a duel provably ends via stalemate-as-loss (§4.4) once the board
//    closes. The debt cap guarantees crumbles keep landing.
//  - Displacements lead, crumbles are rare mid-game and certain late.
//    Displacement is the only mechanic that can free a terrain-locked pawn
//    (a crumble never can — measured 0/7073); crumbles are the only
//    mechanic that closes the board.
//  - Symmetric displacement preferred: if the arena breaks a lock, it breaks
//    it evenly — one piece per side per quake. One-sided moves hand whole
//    games to the favored side (measured: median flip = a mate-score
//    transition). Patience for a pairable quake runs out on its own ramp.
//  - Crumbles never kill the game by dice: candidates are enumerated
//    EXHAUSTIVELY (not sampled — sampling starves on late walled boards)
//    and split into neutral (safe) and terminal (instant stalemate/mate for
//    the mover). Terminal fires only when no neutral candidate exists —
//    the arena finishing a duel that had already closed.
//  - Kings are never displaced, pawns never land on rank 1 / promotion rank,
//    displacement targets only empty squares, quakes never give check and
//    never leave the non-mover in check, a crumble never strips a side's
//    last piece.
import { validateCrumbleCandidate } from './crumbleFilter.mjs';
import { getSquare, setSquare, clearEp, splitFen, joinFen } from './fen.mjs';
import { mulberry32, childSeed, randInt } from './prng.mjs';

const SQ = (f, r) => `${String.fromCharCode(97 + f)}${r + 1}`;

function flipTurn(fen) {
  const f = splitFen(fen);
  f.turn = f.turn === 'w' ? 'b' : 'w';
  return joinFen(f);
}

/** Board field → cell grid indexed [rankFromBottom][file]; '*' walls, null empty. */
export function fenGrid(fen, files, ranks) {
  const g = Array.from({ length: ranks }, () => Array(files).fill(null));
  fen.split(' ')[0].split('/').forEach((row, ri) => {
    const r = ranks - 1 - ri;
    let f = 0;
    for (let i = 0; i < row.length; i++) {
      const m = row.slice(i).match(/^\d+/);
      if (m) { f += parseInt(m[0], 10); i += m[0].length - 1; continue; }
      g[r][f] = row[i];
      f++;
    }
  });
  return g;
}

/** Can this pawn reach its promotion rank by straight pushes through non-walls? */
function pushReaches(grid, f, r, white, ranks) {
  const target = white ? ranks - 1 : 0;
  let rr = r;
  while (rr !== target) {
    rr += white ? 1 : -1;
    if (grid[rr][f] === '*') return false;
  }
  return true;
}

/** Pawns walled off from their promotion rank (push-only metric). */
export function lockedPawns(fen, files, ranks) {
  const g = fenGrid(fen, files, ranks);
  const out = [];
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      const c = g[r][f];
      if ((c === 'P' || c === 'p') && !pushReaches(g, f, r, c === 'P', ranks)) {
        out.push({ f, r, white: c === 'P', sq: SQ(f, r) });
      }
    }
  }
  return out;
}

function nonKingCounts(fen) {
  const c = { white: 0, black: 0 };
  for (const ch of fen.split(' ')[0]) {
    if (/[A-Z]/.test(ch) && ch !== 'K') c.white++;
    else if (/[a-z]/.test(ch) && ch !== 'k') c.black++;
  }
  return c;
}

/** Per-side count of pieces with zero legal moves (via turn-flip probe). */
function stuckCount(ffish, variant, fen) {
  let stuck = 0;
  for (const f of [fen, flipTurn(fen)]) {
    if (ffish.validateFen(f, variant) !== 1) return Infinity;
    const b = new ffish.Board(variant, f);
    const legal = b.legalMoves().trim().split(/\s+/).filter(Boolean);
    const froms = new Set(legal.map((m) => m.match(/^([a-l](?:10|[1-9]))/)?.[1]));
    const whiteToMove = f.split(' ')[1] === 'w';
    const rows = f.split(' ')[0].split('/');
    const ranks = rows.length;
    rows.forEach((row, ri) => {
      let fi = 0;
      for (let i = 0; i < row.length; i++) {
        const m = row.slice(i).match(/^\d+/);
        if (m) { fi += parseInt(m[0], 10); i += m[0].length - 1; continue; }
        const ch = row[i];
        if (ch !== '*' && (ch === ch.toUpperCase()) === whiteToMove && ch.toLowerCase() !== 'k') {
          if (!froms.has(SQ(fi, ranks - 1 - ri))) stuck++;
        }
        fi++;
      }
    });
    b.delete();
  }
  return stuck;
}

const KING_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Every legal crumble candidate, enumerated exhaustively and bucketed:
 *   neutral  — passes the §4.5 filter; play continues.
 *   terminal — rejected ONLY as instant stalemate/checkmate: collapsing it
 *              leaves the mover with no moves. The Director may use these
 *              solely when neutral is empty (the duel has already closed).
 * Never eligible: walls, king squares, exposure, last-piece strips.
 */
export function crumbleCandidates(ffish, variant, fen, files, ranks) {
  const neutral = [];
  const terminal = [];
  const counts = nonKingCounts(fen);
  for (let f = 0; f < files; f++) {
    for (let r = 0; r < ranks; r++) {
      const sq = SQ(f, r);
      let occ;
      try { occ = getSquare(fen, sq); } catch { continue; }
      if (occ === undefined || occ === '*') continue;
      if (occ && occ !== 'K' && occ !== 'k') {
        const owner = occ === occ.toUpperCase() ? 'white' : 'black';
        if (counts[owner] === 1) continue; // never strip a last piece
      }
      const v = validateCrumbleCandidate(ffish, variant, fen, sq);
      if (v.ok) neutral.push({ sq, fen: v.collapsedFen, pieceLost: occ ?? null });
      else if (v.reason === 'instant_stalemate' || v.reason === 'instant_checkmate') {
        terminal.push({ sq, reason: v.reason, pieceLost: occ ?? null });
      }
    }
  }
  return { neutral, terminal };
}

/**
 * Every legal single-step displacement (piece → empty adjacent square),
 * tiered by usefulness:
 *   A — frees a terrain-locked pawn (its new file has a clear push path).
 *   B — lowers the board's stuck-piece count.
 *   C — cosmetic (legal, changes little) — the camouflage tier.
 * Rejected: kings, occupied/wall/offboard targets, pawn to rank 1 or the
 * promotion rank, any check either way, any zero-legal-move result.
 */
export function displacementCandidates(ffish, variant, fen, files, ranks) {
  const A = [];
  const B = [];
  const C = [];
  const g0 = fenGrid(fen, files, ranks);
  const locked = new Set(lockedPawns(fen, files, ranks).map((p) => p.sq));
  const stuckBefore = stuckCount(ffish, variant, fen);
  for (let f = 0; f < files; f++) {
    for (let r = 0; r < ranks; r++) {
      const occ = g0[r][f];
      if (!occ || occ === '*' || occ.toLowerCase() === 'k') continue;
      const from = SQ(f, r);
      const isPawn = occ.toLowerCase() === 'p';
      for (const [df, dr] of KING_STEPS) {
        const nf = f + df;
        const nr = r + dr;
        if (nf < 0 || nf >= files || nr < 0 || nr >= ranks) continue;
        if (isPawn && (nr === 0 || nr === ranks - 1)) continue;
        if (g0[nr][nf] !== null) continue;
        const to = SQ(nf, nr);
        let moved;
        try {
          moved = clearEp(setSquare(setSquare(fen, from, null), to, occ));
        } catch {
          continue;
        }
        if (ffish.validateFen(moved, variant) !== 1) continue;
        // exposure: would the actual mover be able to take the other king?
        {
          const probe = new ffish.Board(variant, flipTurn(moved));
          const exposed = probe.isCheck();
          probe.delete();
          if (exposed) continue;
        }
        const b = new ffish.Board(variant, moved);
        const givesCheck = b.isCheck();
        const noMoves = b.numberLegalMoves() === 0;
        b.delete();
        if (givesCheck || noMoves) continue;
        const cand = { from, to, piece: occ, white: occ === occ.toUpperCase(), fen: moved };
        const g1 = fenGrid(moved, files, ranks);
        if (isPawn && locked.has(from) && pushReaches(g1, nf, nr, occ === 'P', ranks)) A.push(cand);
        else if (stuckCount(ffish, variant, moved) < stuckBefore) B.push(cand);
        else C.push(cand);
      }
    }
  }
  return { A, B, C };
}

function bestTierForSide(tiers, white) {
  for (const t of [tiers.A, tiers.B, tiers.C]) {
    const side = t.filter((c) => c.white === white);
    if (side.length) return side;
  }
  return [];
}

export const DIRECTOR_DEFAULTS = {
  onsetPly: 8, // first ply a quake can fire
  quakeRamp: 60, // plies from onset to P(quake)=1
  crumbleRamp: 100, // plies from onset to P(crumble|quake)=1 (squared — rare early)
  debtCap: 10, // consecutive crumble-less quakes before one is forced
  asymOnsetPly: 50, // ply where one-sided displacement becomes acceptable...
  asymRamp: 60, // ...ramping to always-acceptable over this many plies
};

/**
 * The Director. One instance per duel, seeded, deterministic given the seed
 * and the ply sequence — sweeps replay exactly (brief §7).
 *
 * Favor (the runtime tuning hook, theme TBD): `setFavor(mult)` scales quake
 * probability — 0 silences the gods, 1 is baseline, >1 angers them. Game
 * events can move it mid-duel; it composes with the config knobs, never
 * replaces them.
 */
export class Director {
  constructor(config = {}) {
    const c = { ...DIRECTOR_DEFAULTS, ...config };
    this.onsetPly = c.onsetPly;
    this.quakeRamp = Math.max(1, c.quakeRamp);
    this.crumbleRamp = Math.max(1, c.crumbleRamp);
    this.debtCap = Math.max(1, c.debtCap);
    this.asymOnsetPly = c.asymOnsetPly;
    this.asymRamp = Math.max(1, c.asymRamp);
    this.rng = mulberry32(childSeed(c.seed ?? 1, 'director'));
    this.debt = 0; // displacement-only quakes since the last crumble
    this.favor = 1;
  }

  /** Runtime tuning hook (Favor of the Gods): scales P(quake). */
  setFavor(mult) {
    this.favor = Math.max(0, mult);
  }

  #ramp(ply, length) {
    return Math.min(1, Math.max(0, (ply - this.onsetPly) / length));
  }

  quakeDue(ply) {
    if (ply < this.onsetPly) return false;
    return this.rng() < Math.min(1, this.#ramp(ply, this.quakeRamp) * this.favor);
  }

  wantsCrumble(ply) {
    if (this.debt >= this.debtCap) return true;
    const p = this.#ramp(ply, this.crumbleRamp);
    return this.rng() < p * p; // squared: genuinely rare mid-game, certain late
  }

  acceptsOneSided(ply) {
    return this.rng() < this.#ramp(ply - (this.asymOnsetPly - this.onsetPly), this.asymRamp);
  }

  pick(arr) {
    return arr[randInt(this.rng, arr.length)];
  }

  /**
   * Roll one quake against the current position. Pure planning — applies
   * nothing. Returns null (no quake this ply) or:
   *   { displacements: [{from,to,piece}], crumble: {square,pieceLost}|null,
   *     postFen, endsGame: false }
   *   { displacements: [], crumble: {square,reason}, postFen, endsGame: true }
   * endsGame=true only ever comes from the terminal path (neutral empty):
   * the caller finishes the duel through the normal mover-loses flow.
   */
  quake(ffish, variant, fen, files, ranks, ply) {
    if (!this.quakeDue(ply)) return null;

    // --- displacement leg (unless a crumble is due) ---
    let postFen = fen;
    const displacements = [];
    if (!this.wantsCrumble(ply)) {
      const tiers = displacementCandidates(ffish, variant, fen, files, ranks);
      const firstWhite = this.rng() < 0.5;
      const p1 = bestTierForSide(tiers, firstWhite);
      if (p1.length) {
        const c1 = this.pick(p1);
        const tiers2 = displacementCandidates(ffish, variant, c1.fen, files, ranks);
        const p2 = bestTierForSide(tiers2, !firstWhite);
        if (p2.length) {
          // symmetric: one piece per side — the arena breaks locks evenly
          const c2 = this.pick(p2);
          displacements.push({ from: c1.from, to: c1.to, piece: c1.piece }, { from: c2.from, to: c2.to, piece: c2.piece });
          postFen = c2.fen;
        } else if (this.acceptsOneSided(ply)) {
          displacements.push({ from: c1.from, to: c1.to, piece: c1.piece });
          postFen = c1.fen;
        }
        // else: hold out for a pairable quake — fall through, maybe crumble
      }
      if (displacements.length) {
        this.debt++;
        return { displacements, crumble: null, postFen, endsGame: false };
      }
    }

    // --- crumble leg ---
    const { neutral, terminal } = crumbleCandidates(ffish, variant, postFen, files, ranks);
    if (neutral.length) {
      const c = this.pick(neutral);
      this.debt = 0;
      return { displacements, crumble: { square: c.sq, pieceLost: c.pieceLost }, postFen: c.fen, endsGame: false };
    }
    if (terminal.length) {
      // The board has closed: every remaining collapse immobilizes the mover.
      // The arena finishes it — the floor gives way (§4.4), termination
      // 'earthquake' at the duel layer.
      const t = this.pick(terminal);
      this.debt = 0;
      const collapsed = clearEp(setSquare(postFen, t.sq, '*'));
      return { displacements: [], crumble: { square: t.sq, reason: t.reason, pieceLost: t.pieceLost }, postFen: collapsed, endsGame: true };
    }
    return null; // nothing legal anywhere — extremely late board; try next ply
  }
}
