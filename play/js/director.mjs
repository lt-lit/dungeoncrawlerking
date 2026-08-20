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
//  - Displacements never hand out material. `[Phase 1.1 stopgap]` The guards
//    above are all KING-safety guards; ordinary piece safety went unchecked,
//    so a "symmetric" quake could step a piece onto an already-attacked
//    square and gift it (observed: arena03, black rook a7->b7 into a white
//    rook bearing down the open b-file, with White to move). Symmetric meant
//    symmetric in COUNT, not in CONSEQUENCE. Landing squares now go through
//    an SEE check (threat.mjs). The full rule — a quake may create no new
//    winning capture for EITHER side, judged on the composite post-quake
//    position — is Phase 1.3; see that module's header for what this
//    narrower guard still misses (discovered attacks, rescues, pins).
//  - The Director is instrumented from the inside. `[Phase 1.2]` Every
//    quake() call — including the null returns — records a roll trace on
//    `lastTrace`: each RNG draw with its threshold, a census of what the
//    enumerations produced, and a reason-coded path. The three rolls share
//    one seeded stream and the draw pattern is state-dependent (no draw
//    before onset, the debt cap skips the crumble roll, the displacement leg
//    consumes a variable number of picks), so probabilities for display come
//    from the RNG-FREE getters (pQuake/pCrumble/pOneSided/forecast) — never
//    from re-rolling. Tracing is unconditional and pure bookkeeping: the
//    draw sequence is byte-identical to the untraced v2 Director, so seeded
//    sweeps replay exactly (§7).
import { validateCrumbleCandidate } from './crumbleFilter.mjs';
import { getSquare, setSquare, clearEp, splitFen, joinFen } from './fen.mjs';
import { mulberry32, childSeed, randInt } from './prng.mjs';
import { landingIsSafe } from './threat.mjs';

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
 *   rejected — `[Phase 1.2]` every OTHER exclusion, with its reason
 *              ('last_piece', 'exposes_king', …), for the census/heat
 *              overlay. Collecting them is free: the filter already computed
 *              each verdict and the old code just dropped it. Walls and
 *              offboard squares stay silent — they were never candidates.
 */
export function crumbleCandidates(ffish, variant, fen, files, ranks) {
  const neutral = [];
  const terminal = [];
  const rejected = [];
  const counts = nonKingCounts(fen);
  for (let f = 0; f < files; f++) {
    for (let r = 0; r < ranks; r++) {
      const sq = SQ(f, r);
      let occ;
      try { occ = getSquare(fen, sq); } catch { continue; }
      if (occ === undefined || occ === '*') continue;
      if (occ && occ !== 'K' && occ !== 'k') {
        const owner = occ === occ.toUpperCase() ? 'white' : 'black';
        if (counts[owner] === 1) {
          rejected.push({ sq, reason: 'last_piece' }); // never strip a last piece
          continue;
        }
      }
      const v = validateCrumbleCandidate(ffish, variant, fen, sq);
      if (v.ok) neutral.push({ sq, fen: v.collapsedFen, pieceLost: occ ?? null });
      else if (v.reason === 'instant_stalemate' || v.reason === 'instant_checkmate') {
        terminal.push({ sq, reason: v.reason, pieceLost: occ ?? null });
      } else {
        rejected.push({ sq, reason: v.reason });
      }
    }
  }
  return { neutral, terminal, rejected };
}

/**
 * Every legal single-step displacement (piece → empty adjacent square),
 * tiered by usefulness:
 *   A — frees a terrain-locked pawn (its new file has a clear push path).
 *   B — lowers the board's stuck-piece count.
 *   C — cosmetic (legal, changes little) — the camouflage tier.
 * Rejected: kings, occupied/wall/offboard targets, pawn to rank 1 or the
 * promotion rank, any check either way, any zero-legal-move result, and any
 * landing square where the opponent wins material (threat.mjs).
 *
 * `[Phase 1.2]` Substantive rejections come back in `rejected` with reasons
 * ('unsafe_landing', 'exposes_king', 'gives_check', 'no_moves', …) for the
 * census/heat overlay — pure bookkeeping on verdicts the filters already
 * reached. Geometry that was never a candidate (kings, walls, occupied or
 * offboard targets, pawn rank limits) stays silent. `rejected.unsafe_landing`
 * per side is the Phase 1.3 starvation-risk metric: it counts what a stricter
 * symmetric rule would additionally have to survive.
 */
export function displacementCandidates(ffish, variant, fen, files, ranks) {
  const A = [];
  const B = [];
  const C = [];
  const rejected = [];
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
        const veto = (reason) => rejected.push({ from, to, piece: occ, white: occ === occ.toUpperCase(), reason });
        // Landing safety (Phase 1.1 stopgap): the gods hand out no free
        // material. Mutate-and-restore on the grid we already have — no FEN
        // round-trip — and run it BEFORE the ffish probes below, so unsafe
        // candidates cost a few array walks instead of four ffish Boards.
        g0[r][f] = null;
        g0[nr][nf] = occ;
        const safeLanding = landingIsSafe(g0, nf, nr, files, ranks);
        g0[r][f] = occ;
        g0[nr][nf] = null;
        if (!safeLanding) {
          veto('unsafe_landing');
          continue;
        }
        let moved;
        try {
          moved = clearEp(setSquare(setSquare(fen, from, null), to, occ));
        } catch {
          veto('fen_edit_failed');
          continue;
        }
        if (ffish.validateFen(moved, variant) !== 1) {
          veto('invalid_fen');
          continue;
        }
        // exposure: would the actual mover be able to take the other king?
        {
          const probe = new ffish.Board(variant, flipTurn(moved));
          const exposed = probe.isCheck();
          probe.delete();
          if (exposed) {
            veto('exposes_king');
            continue;
          }
        }
        const b = new ffish.Board(variant, moved);
        const givesCheck = b.isCheck();
        const noMoves = b.numberLegalMoves() === 0;
        b.delete();
        if (givesCheck || noMoves) {
          veto(givesCheck ? 'gives_check' : 'no_moves');
          continue;
        }
        const cand = { from, to, piece: occ, white: occ === occ.toUpperCase(), fen: moved };
        const g1 = fenGrid(moved, files, ranks);
        if (isPawn && locked.has(from) && pushReaches(g1, nf, nr, occ === 'P', ranks)) A.push(cand);
        else if (stuckCount(ffish, variant, moved) < stuckBefore) B.push(cand);
        else C.push(cand);
      }
    }
  }
  return { A, B, C, rejected };
}

/** First non-empty tier (A → B → C) for `white`, or null. `[Phase 1.2]`
 *  Returns which tier the pool came from so the roll trace can name it. */
function bestTierForSide(tiers, white, extraOk = null) {
  for (const [tier, t] of [['A', tiers.A], ['B', tiers.B], ['C', tiers.C]]) {
    const side = t.filter((c) => c.white === white && (!extraOk || extraOk(c)));
    if (side.length) return { tier, pool: side };
  }
  return null;
}

/**
 * Does this second-leg displacement leave the FIRST leg's landing square
 * materially safe?
 *
 * Each leg is filtered for its own landing safety during enumeration, and
 * the second leg is enumerated on the first leg's board — so leg 1's effect
 * on leg 2 is already covered. The reverse was not, and it is not a corner
 * case: on the arena03 position that prompted this work, the pair
 * (ra7->a6, Rb5->a5) parks the white rook on a5 attacking the black rook it
 * had just relocated to a6 — the same gift as the reported bug, reached
 * through the other ordering. Symmetry has to hold on the COMPOSITE board.
 */
function leavesFirstLegSafe(cand, firstTo, files, ranks) {
  const tf = firstTo.charCodeAt(0) - 97;
  const tr = parseInt(firstTo.slice(1), 10) - 1;
  return landingIsSafe(fenGrid(cand.fen, files, ranks), tf, tr, files, ranks);
}

// ---- Phase 1.2 trace helpers (pure bookkeeping — no RNG, no ffish) --------

const r6 = (x) => Math.round(x * 1e6) / 1e6;

function countByReason(rejected) {
  const out = {};
  for (const r of rejected) out[r.reason] = (out[r.reason] ?? 0) + 1;
  return out;
}

/** Reason → {white, black} counts (displacement rejections carry a side —
 *  `unsafe_landing` per side is the Phase 1.3 starvation-risk metric). */
function countByReasonSide(rejected) {
  const out = {};
  for (const r of rejected) {
    const bucket = (out[r.reason] ??= { white: 0, black: 0 });
    bucket[r.white ? 'white' : 'black']++;
  }
  return out;
}

/** Per-side tier counts + per-side rejection reasons for one displacement
 *  enumeration. */
function censusOfTiers(tiers) {
  const side = (arr) => ({ white: arr.filter((c) => c.white).length, black: arr.filter((c) => !c.white).length });
  return { A: side(tiers.A), B: side(tiers.B), C: side(tiers.C), rejected: countByReasonSide(tiers.rejected) };
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
    this.seed = c.seed ?? 1; // kept for the export — a trace without its seed cannot be replayed
    this.rng = mulberry32(childSeed(this.seed, 'director'));
    this.debt = 0; // displacement-only quakes since the last crumble
    this.favor = 1;
    this.lastTrace = null; // roll trace of the most recent quake() call (Phase 1.2)
    // Post-guard STARTING config, frozen — tune() mutates the live knobs, so
    // an exported record needs this to reconstruct the duel from ply 0.
    this.config0 = Object.freeze({
      onsetPly: this.onsetPly,
      quakeRamp: this.quakeRamp,
      crumbleRamp: this.crumbleRamp,
      debtCap: this.debtCap,
      asymOnsetPly: this.asymOnsetPly,
      asymRamp: this.asymRamp,
    });
  }

  /** Active trace collector; set only for the duration of a quake() call. */
  #activeTrace = null;

  /** Runtime tuning hook (Favor of the Gods): scales P(quake). */
  setFavor(mult) {
    this.favor = Math.max(0, mult);
  }

  /**
   * Live ramp dials (Phase 1.2): retune any config knob mid-duel. Applies
   * the same guards as the constructor and touches CONFIG ONLY — never the
   * RNG stream, debt, or favor — so a replay that re-applies the same tunes
   * before the same plies reproduces exactly. Returns the knobs actually
   * applied (post-guard values); unknown keys and non-numbers are ignored.
   */
  tune(partial) {
    const applied = {};
    const set = {
      onsetPly: (v) => (this.onsetPly = v),
      quakeRamp: (v) => (this.quakeRamp = Math.max(1, v)),
      crumbleRamp: (v) => (this.crumbleRamp = Math.max(1, v)),
      debtCap: (v) => (this.debtCap = Math.max(1, v)),
      asymOnsetPly: (v) => (this.asymOnsetPly = v),
      asymRamp: (v) => (this.asymRamp = Math.max(1, v)),
    };
    for (const [k, v] of Object.entries(partial ?? {})) {
      if (!(k in set) || typeof v !== 'number' || Number.isNaN(v)) continue;
      set[k](v);
      applied[k] = this[k];
    }
    return applied;
  }

  #ramp(ply, length) {
    return Math.min(1, Math.max(0, (ply - this.onsetPly) / length));
  }

  // ---- RNG-free probability getters (Phase 1.2) ---------------------------
  // Pure functions of (ply, config, debt, favor): they NEVER touch this.rng,
  // so the overlay can display and forecast without perturbing the seeded
  // stream. The rolls below draw against exactly these values — one source
  // of truth for the math, one owner of the stream.

  /** P(a quake fires at `ply`). 0 before onset. Pure — no RNG. */
  pQuake(ply) {
    if (ply < this.onsetPly) return 0;
    return Math.min(1, this.#ramp(ply, this.quakeRamp) * this.favor);
  }

  /** P(the crumble leg is taken | a quake fires) at `debt` (default: now).
   *  1 when the debt cap forces it — no roll happens in that case, which is
   *  one of the state-dependent draw patterns the trace exists to expose.
   *  Pure — no RNG. */
  pCrumble(ply, debt = this.debt) {
    if (debt >= this.debtCap) return 1;
    const p = this.#ramp(ply, this.crumbleRamp);
    return p * p; // squared: genuinely rare mid-game, certain late
  }

  /** P(a lone displacement is accepted one-sided | its roll happens).
   *  Pure — no RNG. The Infinity-onset guard ('off' preset) matters for
   *  DISPLAY only: (ply - (asym - Infinity)) is NaN, and rng() < NaN is
   *  false exactly like rng() < 0, so the roll outcome is unchanged. */
  pOneSided(ply) {
    if (!Number.isFinite(this.onsetPly)) return 0;
    return this.#ramp(ply - (this.asymOnsetPly - this.onsetPly), this.asymRamp);
  }

  /**
   * Analytic forecast (Phase 1.2): median plies of the next quake, the first
   * crumble, and board closure — pure ramp math over the debt chain, no RNG
   * consumed, no board knowledge. NOMINAL model only: it prices the crumble
   * ROLL but not the fall-through (an unpairable displacement also lands in
   * the crumble leg), so real crumbles run EARLIER than forecast — the roll
   * trace measures that gap, and this is the baseline it is measured against.
   *
   * Returns { nextQuake, firstCrumble, closure }, each a ply or null (beyond
   * `horizon`, or never — e.g. favor 0). `closure` needs opts.freeSquares
   * (empty squares left) and is the crudest of the three: each crumble
   * consumes one square, closure ≈ the ply where expected crumbles have
   * consumed them all.
   */
  forecast(ply, { freeSquares = null, horizon = 600 } = {}) {
    const cap = Math.min(this.debtCap, 64); // chain width guard vs huge dials
    let sQuake = 1;
    let nextQuake = null;
    // chain A absorbs at the first crumble (median of the first-crumble dist)
    let chainA = new Array(cap + 1).fill(0);
    chainA[Math.min(this.debt, cap)] = 1;
    let sCrumble = 1;
    let firstCrumble = null;
    // chain B keeps running (debt resets on crumble) for the crumble pace
    let chainB = chainA.slice();
    let expCrumbles = 0;
    let closure = null;
    for (let k = ply + 1; k <= ply + horizon; k++) {
      const q = this.pQuake(k);
      if (nextQuake === null) {
        sQuake *= 1 - q;
        if (sQuake <= 0.5) nextQuake = k;
      }
      if (firstCrumble === null) {
        const next = new Array(cap + 1).fill(0);
        let crumbleNow = 0;
        for (let d = 0; d <= cap; d++) {
          const m = chainA[d];
          if (!m) continue;
          // pCrumble checks d >= this.debtCap itself, so the top bucket is
          // forced exactly when cap === debtCap; under a >64 dial the chain
          // just never forces (a mild under-estimate, not a wrong force).
          const pc = this.pCrumble(k, d);
          next[d] += m * (1 - q);
          crumbleNow += m * q * pc;
          next[Math.min(d + 1, cap)] += m * q * (1 - pc);
        }
        chainA = next;
        sCrumble -= crumbleNow;
        if (sCrumble <= 0.5) firstCrumble = k;
      }
      if (freeSquares !== null && closure === null) {
        const next = new Array(cap + 1).fill(0);
        for (let d = 0; d <= cap; d++) {
          const m = chainB[d];
          if (!m) continue;
          const pc = this.pCrumble(k, d);
          next[d] += m * (1 - q);
          next[0] += m * q * pc;
          expCrumbles += m * q * pc;
          next[Math.min(d + 1, cap)] += m * q * (1 - pc);
        }
        chainB = next;
        if (expCrumbles >= freeSquares) closure = k;
      }
      if (nextQuake !== null && firstCrumble !== null && (freeSquares === null || closure !== null)) break;
    }
    return { nextQuake, firstCrumble, closure };
  }

  // ---- the rolls — the ONLY consumers of the seeded stream ----------------

  /** One recorded draw against threshold p. Records into the active trace
   *  when quake() is running; consumes exactly one rng() either way. */
  #draw(name, p) {
    const value = this.rng();
    const pass = value < p;
    if (this.#activeTrace) this.#activeTrace.rolls.push({ roll: name, value: r6(value), p: r6(p), pass });
    return pass;
  }

  /** One recorded uniform pick (same math as prng.randInt). */
  #pickTraced(name, arr, tier = null) {
    const value = this.rng();
    const index = Math.floor(value * arr.length);
    if (this.#activeTrace) {
      const rec = { roll: name, value: r6(value), poolSize: arr.length, index };
      if (tier) rec.tier = tier;
      this.#activeTrace.rolls.push(rec);
    }
    return arr[index];
  }

  quakeDue(ply) {
    if (ply < this.onsetPly) return false;
    return this.#draw('quake', this.pQuake(ply));
  }

  wantsCrumble(ply) {
    if (this.debt >= this.debtCap) return true; // forced — NO draw consumed
    return this.#draw('crumble', this.pCrumble(ply));
  }

  acceptsOneSided(ply) {
    return this.#draw('one-sided', this.pOneSided(ply));
  }

  pick(arr) {
    return arr[randInt(this.rng, arr.length)];
  }

  /**
   * Roll one quake against the current position. Pure planning — applies
   * nothing. Returns null (no quake this ply) or:
   *   { displacements: [{from,to,piece}], crumble: {square,pieceLost}|null,
   *     postFen, endsGame: false, trace }
   *   { displacements: [], crumble: {square,reason}, postFen, endsGame: true, trace }
   * endsGame=true only ever comes from the terminal path (neutral empty):
   * the caller finishes the duel through the normal mover-loses flow.
   *
   * Instrumentation (Phase 1.2): EVERY call — null returns included — leaves
   * a roll trace on `this.lastTrace` (non-null returns also carry it as
   * `.trace`). Rolls are recorded inside the draw itself, never by
   * re-rolling, so the seeded stream and the draw sequence are byte-identical
   * to the untraced Director. Trace shape:
   *   { ply, debtBefore, debtAfter, favor,
   *     p: { quake, crumble, crumbleForced, oneSided },   // RNG-free values
   *     rolls: [{roll, value, p, pass} | {roll, value, poolSize, index, tier?}],
   *     path: [reason codes, in order],
   *     census: { lockedPawns, displacement, displacement2, crumble } | null,
   *     firstSide, chosen, outcome, fellThrough }
   * Path codes: pre-onset · quake-roll-failed · quake · crumble-forced ·
   * crumble-roll-passed · crumble-roll-failed · no-first-leg · paired ·
   * unpaired-one-sided · unpaired-held · crumble-neutral · crumble-terminal ·
   * starved. `fellThrough` marks the crucial case the nominal probabilities
   * hide: the displacement leg came up empty-handed (no-first-leg or
   * unpaired-held) and the quake dropped into the crumble leg anyway — which
   * is why crumbles land more often than P(crumble|quake) implies.
   * `chosen` records picked candidates; on unpaired-held the picked leg1 was
   * DISCARDED, not applied — `outcome` says what actually happened.
   */
  quake(ffish, variant, fen, files, ranks, ply) {
    const trace = {
      ply,
      debtBefore: this.debt,
      debtAfter: this.debt,
      favor: this.favor,
      p: {
        quake: r6(this.pQuake(ply)),
        crumble: r6(this.pCrumble(ply)),
        crumbleForced: this.debt >= this.debtCap,
        oneSided: r6(this.pOneSided(ply)),
      },
      rolls: [],
      path: [],
      census: null,
      firstSide: null,
      chosen: null,
      outcome: 'quiet',
      fellThrough: false,
    };
    this.lastTrace = trace;
    this.#activeTrace = trace;
    try {
      return this.#quakeTraced(trace, ffish, variant, fen, files, ranks, ply);
    } finally {
      this.#activeTrace = null;
      trace.debtAfter = this.debt;
    }
  }

  #quakeTraced(trace, ffish, variant, fen, files, ranks, ply) {
    if (!this.quakeDue(ply)) {
      trace.path.push(ply < this.onsetPly ? 'pre-onset' : 'quake-roll-failed');
      return null;
    }
    trace.path.push('quake');
    trace.census = { lockedPawns: lockedPawns(fen, files, ranks).length, displacement: null, displacement2: null, crumble: null };

    // --- displacement leg (unless a crumble is due) ---
    let postFen = fen;
    const displacements = [];
    const forced = this.debt >= this.debtCap;
    const wants = this.wantsCrumble(ply);
    trace.path.push(forced ? 'crumble-forced' : wants ? 'crumble-roll-passed' : 'crumble-roll-failed');
    if (!wants) {
      const tiers = displacementCandidates(ffish, variant, fen, files, ranks);
      trace.census.displacement = censusOfTiers(tiers);
      const firstWhite = this.#draw('first-side', 0.5);
      trace.firstSide = firstWhite ? 'white' : 'black';
      const p1 = bestTierForSide(tiers, firstWhite);
      if (!p1) {
        // The rolled first side has no legal candidate in ANY tier — the
        // other side may well have had one (the census shows it), but the
        // Director does not re-roll sides: the quake drops to the crumble leg.
        trace.path.push('no-first-leg');
      } else {
        const c1 = this.#pickTraced('pick-leg1', p1.pool, p1.tier);
        trace.chosen = { leg1: { from: c1.from, to: c1.to, piece: c1.piece, tier: p1.tier } };
        const tiers2 = displacementCandidates(ffish, variant, c1.fen, files, ranks);
        trace.census.displacement2 = censusOfTiers(tiers2);
        const p2 = bestTierForSide(tiers2, !firstWhite, (c) => leavesFirstLegSafe(c, c1.to, files, ranks));
        if (p2) {
          // symmetric: one piece per side — the arena breaks locks evenly
          const c2 = this.#pickTraced('pick-leg2', p2.pool, p2.tier);
          trace.chosen.leg2 = { from: c2.from, to: c2.to, piece: c2.piece, tier: p2.tier };
          displacements.push({ from: c1.from, to: c1.to, piece: c1.piece }, { from: c2.from, to: c2.to, piece: c2.piece });
          postFen = c2.fen;
          trace.path.push('paired');
        } else if (this.acceptsOneSided(ply)) {
          displacements.push({ from: c1.from, to: c1.to, piece: c1.piece });
          postFen = c1.fen;
          trace.path.push('unpaired-one-sided');
        } else {
          // hold out for a pairable quake — fall through, maybe crumble
          trace.path.push('unpaired-held');
        }
      }
      if (displacements.length) {
        this.debt++;
        trace.outcome = displacements.length === 2 ? 'paired' : 'one-sided';
        return { displacements, crumble: null, postFen, endsGame: false, trace };
      }
      trace.fellThrough = true; // the fall-through path (§10 Phase 1.2)
    }

    // --- crumble leg ---
    const { neutral, terminal, rejected } = crumbleCandidates(ffish, variant, postFen, files, ranks);
    trace.census.crumble = { neutral: neutral.length, terminal: terminal.length, rejected: countByReason(rejected) };
    if (neutral.length) {
      const c = this.#pickTraced('pick-crumble', neutral);
      this.debt = 0;
      trace.chosen = { ...(trace.chosen ?? {}), crumble: { square: c.sq, pieceLost: c.pieceLost } };
      trace.path.push('crumble-neutral');
      trace.outcome = 'crumble';
      return { displacements, crumble: { square: c.sq, pieceLost: c.pieceLost }, postFen: c.fen, endsGame: false, trace };
    }
    if (terminal.length) {
      // The board has closed: every remaining collapse immobilizes the mover.
      // The arena finishes it — the floor gives way (§4.4), termination
      // 'earthquake' at the duel layer.
      const t = this.#pickTraced('pick-terminal', terminal);
      this.debt = 0;
      const collapsed = clearEp(setSquare(postFen, t.sq, '*'));
      trace.chosen = { ...(trace.chosen ?? {}), crumble: { square: t.sq, reason: t.reason, pieceLost: t.pieceLost } };
      trace.path.push('crumble-terminal');
      trace.outcome = 'terminal';
      return { displacements: [], crumble: { square: t.sq, reason: t.reason, pieceLost: t.pieceLost }, postFen: collapsed, endsGame: true, trace };
    }
    trace.path.push('starved');
    trace.outcome = 'starved';
    return null; // nothing legal anywhere — extremely late board; try next ply
  }
}
