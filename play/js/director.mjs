// The Board State Director ("THE GODS") — arena regeneration, v3.
//
// v3 GUTS v2's decision layer (designer, 2026-08-31). Everything the engine
// sees still stays FSF-pure; the Director rewrites the FEN between plies
// exactly as before (Prime Directive carve-out, brief §2). What changed is
// WHEN the gods act and WHAT they do.
//
// Why: v2 fired on a ply ramp — `pQuake` was a function of duel length alone,
// blind to the board — so the gods stirred into mating attacks and dead
// shuffles with equal enthusiasm, and the one-directional candidate filters
// then guaranteed the intervention LOOSENED whatever the position was
// building. Measured over 96 games: 23.3% of quakes wrecked a mate or flipped
// the eval (3.27 per game), 11.1% fired while a king was in check — where the
// postcondition filters rescue that king by construction. The mechanic built
// to shorten duels was lengthening them by dissolving the mates that would
// have ended them.
//
// THE LADDER. Restlessness buys escalation, and the cheap rungs are the safe
// ones, so most god activity now lands where it cannot wreck a game:
//
//   weaken   `*` → `^`   a solid wall cracks. Opens no line yet (the crate
//                        still blocks) — it only adds a capture option for
//                        BOTH sides, so it is safe by construction rather
//                        than by filter. The telegraph: players see the
//                        breach coming before it arrives.
//   breach   `^` → floor the crate is smashed and the line opens for real.
//                        Filtered like a displacement (discovered checks).
//   displace piece → adjacent square. v2's quake, rules unchanged.
//   crumble  square → a HOLE. The closer; demoted from mid-game event to
//                        endgame pressure, kept landing by the debt cap.
//
// Terrain edits are the point, not decoration. Three v2 findings argue for
// them harder than the design conversation did:
//  - "Displacement is the only mechanic that can free a terrain-locked pawn
//    (a crumble never can — measured 0/7073)." Displacement was carrying the
//    unlocking job and is bad at it: it moves the PIECE, not the wall.
//    Weaken/breach attack terrain locks directly.
//  - Displacement is also the only rung that can hand out material — the
//    whole arena03 free-rook class (rule 13), which needed two fixes. A wall
//    cracking moves nobody.
//  - "One-sided moves hand whole games to the favored side (measured: median
//    flip = a mate-score transition)" — which is why pairing exists, and
//    pairing is expensive and often unsatisfiable. A wall is not a move FOR
//    anyone, so the terrain rungs are side-neutral and need no pairing.
//
// HOLES vs WALLS. `*` means two different things now and FSF cannot tell them
// apart, so the Director does: `this.holes` is the set of squares a crumble
// created. A hole is permanent — never weakened, never re-opened — which is
// what keeps termination provable. Free squares are no longer monotone (a
// breach adds one), but the wall supply is finite, so breaches can add at
// most W squares across the whole duel while holes accumulate without bound.
// The board still provably closes and the duel still ends via
// stalemate-as-loss (§4.4); it just closes later. Hole-ness cannot be derived
// from the FEN — an authored wall that was weakened, breached, occupied and
// then crumbled reads as `*` on a square the stage authored as `*` — so it is
// real Director state, restored alongside `debt` (duel.mjs #snapshot).
//
// THE TRIGGER. Two meters, because they catch different deaths:
//   meter.mjs      the RECORD — "nothing has happened lately"
//   staleness.mjs  the POSITION — "nothing CAN happen here" (the fun score)
// Staleness sets the meter's fill rate; the meter drives P(quake), floored
// late by a slow ply ramp as the termination backstop. Neither consults the
// engine: eval answers "who is winning", which is the one question the gods
// must never act on (§4.5) and the one a player would eventually catch them
// acting on — and a movetime-bounded search in the trigger would destroy
// seeded replay outright.
//
// TARGETING. The rung comes from the meter; the target comes from a seeded
// weighted pick over a STRUCTURAL impact score (how much would this unstick?)
// — never from an evaluation. A structural criterion never references a side,
// so "feels random" and "never picks a winner" hold by construction instead
// of needing to be engineered.
//
// Retained from v2 unchanged: exhaustive candidate enumeration (sampling
// starves on late walled boards), the SEE landing guard on displacements
// (threat.mjs) judged on the COMPOSITE board, kings never displaced, pawns
// never landed on rank 1 or the promotion rank, no quake gives check or
// leaves the non-mover in check, no crumble strips a side's last piece, and
// full inside-out instrumentation — every quake() call including null returns
// leaves a roll trace on `lastTrace`, with probabilities for display coming
// from the RNG-FREE getters, never from re-rolling.
//
// Furniture is no longer stone to the gods (§4.6's `[Phase 1.2.4 interim]`
// clause said the rework owns the real policy — this is that policy). It is
// still terrain to molding, crop, the camp line, and to displacement, which
// neither moves a crate nor lands on one.
import { validateCrumbleCandidate } from './crumbleFilter.mjs';
import { getSquare, setSquare, clearEp, splitFen, joinFen, isTerrain, WALL, FURNITURE } from './fen.mjs';
import { RestlessnessMeter } from './meter.mjs';
import { mulberry32, childSeed, randInt } from './prng.mjs';
import { stalenessOf } from './staleness.mjs';
import { landingIsSafe } from './threat.mjs';

const SQ = (f, r) => `${String.fromCharCode(97 + f)}${r + 1}`;

function flipTurn(fen) {
  const f = splitFen(fen);
  f.turn = f.turn === 'w' ? 'b' : 'w';
  return joinFen(f);
}

/** Board field → cell grid indexed [rankFromBottom][file]; '*' walls,
 *  '^' furniture, null empty, piece letters otherwise. */
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

/** Can this pawn reach its promotion rank by straight pushes through
 *  non-terrain? Furniture blocks a push exactly like stone — a pawn can
 *  never capture straight ahead, so it can't clear its own blocker (§4.6:
 *  the CLAUDE.md landmine — '^' read as open inverted this metric). */
function pushReaches(grid, f, r, white, ranks) {
  const target = white ? ranks - 1 : 0;
  let rr = r;
  while (rr !== target) {
    rr += white ? 1 : -1;
    if (isTerrain(grid[rr][f])) return false;
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
        // isTerrain first: '^' === '^'.toUpperCase(), so without the guard
        // every crate counts as a stuck white piece (the landmine class).
        if (!isTerrain(ch) && (ch === ch.toUpperCase()) === whiteToMove && ch.toLowerCase() !== 'k') {
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
 *              each verdict and the old code just dropped it. Terrain
 *              (walls AND furniture — §4.6 interim) and offboard squares
 *              stay silent — they were never candidates.
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
      // Terrain stays silent — never a candidate. '^' rides the same skip
      // ('*' would misclassify it as WHITE at the owner test below, tripping
      // last_piece vetoes and counting crates as white material): furniture
      // is stone to the gods, and no crumble ever lands on or swallows it.
      if (occ === undefined || isTerrain(occ)) continue;
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

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Terrain tally for one board — the cheap grid scan the rung weights need
 *  before any candidate is enumerated. `holes` are Director state, so a `*`
 *  is only a weakenable WALL if the gods did not put it there. */
export function terrainCensus(fen, files, ranks, holes) {
  const g = fenGrid(fen, files, ranks);
  let walls = 0;
  let crates = 0;
  let holeCount = 0;
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      const c = g[r][f];
      if (c === FURNITURE) crates++;
      else if (c === WALL) (holes.has(SQ(f, r)) ? holeCount++ : walls++);
    }
  }
  return { walls, crates, holes: holeCount };
}

/**
 * Every wall the gods may crack (`*` → `^`), with a structural impact score.
 *
 * Holes are excluded: a crumble's pit is permanent, and that permanence is
 * what keeps termination provable. Walls buried inside stone are excluded
 * too — cracking one opens nothing, and a crate nobody can ever reach is
 * just scenery.
 *
 * Impact is deliberately STRUCTURAL, never evaluative: open orthogonal
 * neighbours (how much of a passage this square would become) plus a bonus
 * for standing on a locked pawn's file (the lock the gods exist to break).
 * Nothing here references a side, so the pick cannot favour one.
 *
 * Safe by construction — no filtering needed. The square stays blocking, so
 * no line opens, no check can be discovered and no side can be stalemated;
 * the edit only ADDS a capture option, symmetrically, to both armies.
 */
export function weakenCandidates(fen, files, ranks, holes) {
  const g = fenGrid(fen, files, ranks);
  const lockedFiles = new Set(lockedPawns(fen, files, ranks).map((p) => p.f));
  const out = [];
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      if (g[r][f] !== WALL) continue;
      const sq = SQ(f, r);
      if (holes.has(sq)) continue;
      let open = 0;
      for (const [df, dr] of ORTHO) {
        const nf = f + df;
        const nr = r + dr;
        if (nf < 0 || nf >= files || nr < 0 || nr >= ranks) continue;
        if (!isTerrain(g[nr][nf])) open++;
      }
      if (open < 2) continue; // walled in on all sides — cracking it opens nothing
      out.push({ sq, impact: open + (lockedFiles.has(f) ? 3 : 0) });
    }
  }
  return out;
}

/**
 * Every crate the gods may smash (`^` → floor), scored and filtered.
 *
 * Unlike a weaken this genuinely OPENS a line, so it runs the same king
 * guards a displacement does: it may not give check, may not leave the mover
 * able to take the other king, and may not leave anyone with zero legal moves
 * (that is the crumble leg's job, and only when the board has already
 * closed). Impact counts locked pawns actually freed — the direct read on the
 * mechanic's purpose — plus the space the square opens onto.
 *
 * Costs two ffish Boards per crate, which is why the caller only enumerates
 * this rung once the roll has already chosen it (rule 14).
 */
export function breachCandidates(ffish, variant, fen, files, ranks) {
  const ok = [];
  const rejected = [];
  const g = fenGrid(fen, files, ranks);
  const lockedBefore = lockedPawns(fen, files, ranks).length;
  for (let r = 0; r < ranks; r++) {
    for (let f = 0; f < files; f++) {
      if (g[r][f] !== FURNITURE) continue;
      const sq = SQ(f, r);
      const veto = (reason) => rejected.push({ sq, reason });
      let opened;
      try {
        opened = clearEp(setSquare(fen, sq, null));
      } catch {
        veto('fen_edit_failed');
        continue;
      }
      if (ffish.validateFen(opened, variant) !== 1) {
        veto('invalid_fen');
        continue;
      }
      {
        const probe = new ffish.Board(variant, flipTurn(opened));
        const exposed = probe.isCheck();
        probe.delete();
        if (exposed) {
          veto('exposes_king');
          continue;
        }
      }
      const b = new ffish.Board(variant, opened);
      const givesCheck = b.isCheck();
      const noMoves = b.numberLegalMoves() === 0;
      b.delete();
      if (givesCheck || noMoves) {
        veto(givesCheck ? 'gives_check' : 'no_moves');
        continue;
      }
      let space = 0;
      for (const [df, dr] of ORTHO) {
        const nf = f + df;
        const nr = r + dr;
        if (nf < 0 || nf >= files || nr < 0 || nr >= ranks) continue;
        if (!isTerrain(g[nr][nf])) space++;
      }
      const freed = lockedBefore - lockedPawns(opened, files, ranks).length;
      ok.push({ sq, fen: opened, impact: space + 4 * Math.max(0, freed), freed });
    }
  }
  return { ok, rejected };
}

/**
 * Every legal single-step displacement (piece → empty adjacent square),
 * tiered by usefulness:
 *   A — frees a terrain-locked pawn (its new file has a clear push path).
 *   B — lowers the board's stuck-piece count.
 *   C — cosmetic (legal, changes little) — the camouflage tier.
 * Rejected: kings, occupied/terrain/offboard targets, pawn to rank 1 or the
 * promotion rank, any check either way, any zero-legal-move result, and any
 * landing square where the opponent wins material (threat.mjs). Furniture
 * is neither a mover nor a target (stone to the gods — §4.6 interim).
 *
 * `[Phase 1.2]` Substantive rejections come back in `rejected` with reasons
 * ('unsafe_landing', 'exposes_king', 'gives_check', 'no_moves', …) for the
 * census/heat overlay — pure bookkeeping on verdicts the filters already
 * reached. Geometry that was never a candidate (kings, terrain, occupied or
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
      // Terrain is not a piece: '^' must ride the same skip as '*' or the
      // gods would pick a crate up and scoot it ('^'.toLowerCase() !== 'k'
      // let it through). Landing ON terrain is excluded below (non-null).
      if (!occ || isTerrain(occ) || occ.toLowerCase() === 'k') continue;
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
  debtCap: 10, // consecutive hole-less quakes before a crumble is forced
  holdInCheck: true, // never stir while the side to move is in check — the
  //                    gods exist to reopen inert boards, and a board with a
  //                    king in check is the opposite of inert. v2 fired here
  //                    11.1% of the time and the filters then rescued the
  //                    king by construction.
  asymOnsetPly: 50, // ply where one-sided DISPLACEMENT becomes acceptable...
  asymRamp: 60, // ...ramping to always-acceptable over this many plies

  // --- the ladder: pressure thresholds and biases -------------------------
  // Each rung's weight is `bias × max(0, pressure − at)`, except weaken which
  // is always available and fades as pressure climbs. The rung is then a
  // seeded weighted pick, so the gods VARY at equal pressure instead of
  // stepping deterministically through a staircase — that variety is most of
  // what sells the mechanic as random.
  weakenBias: 1, // ...at pressure 0; falls to weakenBias×0.4 at pressure 1
  breachAt: 0.15,
  breachBias: 2,
  displaceAt: 0.35,
  displaceBias: 2.5,
  crumbleAt: 0.7,
  crumbleBias: 3,
  crateBrake: true, // damp weaken as furniture comes to outnumber walls, so a
  //                   long duel does not dissolve the whole dungeon into crates
};

/** Rung order for the fallback walk when the rolled rung has no candidates. */
const RUNGS = ['weaken', 'breach', 'displace', 'crumble'];

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
    this.debtCap = Math.max(1, c.debtCap);
    this.holdInCheck = c.holdInCheck !== false;
    this.asymOnsetPly = c.asymOnsetPly;
    this.asymRamp = Math.max(1, c.asymRamp);
    this.weakenBias = Math.max(0, c.weakenBias);
    this.breachAt = c.breachAt;
    this.breachBias = Math.max(0, c.breachBias);
    this.displaceAt = c.displaceAt;
    this.displaceBias = Math.max(0, c.displaceBias);
    this.crumbleAt = c.crumbleAt;
    this.crumbleBias = Math.max(0, c.crumbleBias);
    this.crateBrake = c.crateBrake !== false;
    this.seed = c.seed ?? 1; // kept for the export — a trace without its seed cannot be replayed
    this.rng = mulberry32(childSeed(this.seed, 'director'));
    this.debt = 0; // quakes since the last crumble (ALL rungs count — the
    //                cheap rungs are where most activity lives now, so a
    //                displacement-only counter would never force a hole)
    this.favor = 1;
    this.lastTrace = null; // roll trace of the most recent quake() call
    // The two meters. The host must call observePly() after every completed
    // ply, BEFORE the quake phase (duel.mjs does this itself). Meter knobs
    // are accepted FLAT as well as nested, so a preset and a live dial name
    // the same thing (`rampPlies`, `sate`, …) — the nested form wins.
    const flatMeter = {};
    for (const k of ['sate', 'repBonus', 'rampPlies', 'stalenessFloor', 'stalenessGain', 'floorOnsetPly', 'floorRampPlies']) {
      if (typeof c[k] === 'number' && !Number.isNaN(c[k])) flatMeter[k] = c[k];
    }
    this.meter = new RestlessnessMeter({ ...flatMeter, ...(c.meter ?? {}) });
    this.stalenessConfig = c.staleness ?? {};
    this.lastStaleness = null; // full stalenessOf() record, for the overlay
    // Holes: squares a crumble created. FSF sees the same '*' as an authored
    // wall; the gods must not, because a hole is permanent (never weakened,
    // never reopened) and that permanence is the termination guarantee. Not
    // derivable from the FEN — see this module's header.
    this.holes = new Set();
    this._held = false; // holdInCheck, stamped per quake() from the preFen
    // Post-guard STARTING config, frozen — tune() mutates the live knobs, so
    // an exported record needs this to reconstruct the duel from ply 0.
    this.config0 = Object.freeze({
      onsetPly: this.onsetPly,
      debtCap: this.debtCap,
      holdInCheck: this.holdInCheck,
      asymOnsetPly: this.asymOnsetPly,
      asymRamp: this.asymRamp,
      weakenBias: this.weakenBias,
      breachAt: this.breachAt,
      breachBias: this.breachBias,
      displaceAt: this.displaceAt,
      displaceBias: this.displaceBias,
      crumbleAt: this.crumbleAt,
      crumbleBias: this.crumbleBias,
      crateBrake: this.crateBrake,
      meter: this.meter.config0,
      staleness: { ...this.stalenessConfig },
    });
  }

  /**
   * Feed one completed ply to the trigger. `ev` is a meter.moveEvents()
   * record for the move just played; the position is read for staleness (one
   * ffish Board, no search). Call after every ply, before the quake phase.
   * Returns { meter, staleness } for the overlay.
   */
  observePly(ffish, variant, fen, files, ranks, ev) {
    let stale = { staleness: 0, fun: 1 };
    if (ffish.validateFen(fen, variant) === 1) {
      const b = new ffish.Board(variant, fen);
      const legal = b.legalMoves();
      b.delete();
      stale = stalenessOf(fenGrid(fen, files, ranks), legal, files, ranks, this.stalenessConfig);
    }
    this.lastStaleness = stale;
    const meter = this.meter.observe(ev, stale.staleness);
    return { meter, staleness: stale };
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
      debtCap: (v) => (this.debtCap = Math.max(1, v)),
      asymOnsetPly: (v) => (this.asymOnsetPly = v),
      asymRamp: (v) => (this.asymRamp = Math.max(1, v)),
      weakenBias: (v) => (this.weakenBias = Math.max(0, v)),
      breachAt: (v) => (this.breachAt = v),
      breachBias: (v) => (this.breachBias = Math.max(0, v)),
      displaceAt: (v) => (this.displaceAt = v),
      displaceBias: (v) => (this.displaceBias = Math.max(0, v)),
      crumbleAt: (v) => (this.crumbleAt = v),
      crumbleBias: (v) => (this.crumbleBias = Math.max(0, v)),
      // meter knobs, reachable through the same dial surface
      rampPlies: (v) => (this.meter.rampPlies = Math.max(1, v)),
      sate: (v) => (this.meter.sate = v),
      repBonus: (v) => (this.meter.repBonus = v),
      floorOnsetPly: (v) => (this.meter.floorOnsetPly = v),
      floorRampPlies: (v) => (this.meter.floorRampPlies = Math.max(1, v)),
    };
    const read = {
      rampPlies: () => this.meter.rampPlies,
      sate: () => this.meter.sate,
      repBonus: () => this.meter.repBonus,
      floorOnsetPly: () => this.meter.floorOnsetPly,
      floorRampPlies: () => this.meter.floorRampPlies,
    };
    for (const [k, v] of Object.entries(partial ?? {})) {
      if (!(k in set) || typeof v !== 'number' || Number.isNaN(v)) continue;
      set[k](v);
      applied[k] = read[k] ? read[k]() : this[k];
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

  /** The trigger pressure at `ply` before favor: the meter, floored late by
   *  the ply backstop. Pure — no RNG. */
  pressure(ply) {
    return this.meter.pAt(ply);
  }

  /** P(a quake fires at `ply`). 0 before onset, 0 while a king is in check
   *  (the hold is stamped by quake() from the preFen). Pure — no RNG. */
  pQuake(ply) {
    if (ply < this.onsetPly) return 0;
    if (this._held) return 0;
    return Math.min(1, this.pressure(ply) * this.favor);
  }

  /**
   * Rung weights at `pressure` — the ladder, as a pure function. Weaken is
   * always on the menu and fades as pressure climbs; every other rung is
   * `bias × (pressure − threshold)`, clamped at zero. `terrain` (from
   * terrainCensus) zeroes rungs with no material to work on and applies the
   * crate brake. Pure — no RNG, no ffish.
   */
  rungWeights(ply, terrain = null) {
    const p = this.pressure(ply);
    let weaken = this.weakenBias * (1 - 0.6 * p);
    if (terrain) {
      if (!terrain.walls) weaken = 0;
      else if (this.crateBrake) {
        // As furniture comes to outnumber walls the gods lose interest in
        // cracking more of it — without this a long duel dissolves the whole
        // dungeon into crates and the stage stops being the stage.
        const share = terrain.crates / Math.max(1, terrain.walls + terrain.crates);
        weaken *= Math.max(0.15, 1 - share);
      }
    }
    return {
      weaken,
      breach: terrain && !terrain.crates ? 0 : this.breachBias * Math.max(0, p - this.breachAt),
      displace: this.displaceBias * Math.max(0, p - this.displaceAt),
      crumble: this.crumbleBias * Math.max(0, p - this.crumbleAt),
    };
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
   * Short-horizon forecast for the overlay: median plies to the next quake
   * and to the next hole, under the explicit assumption that pressure HOLDS
   * AT ITS CURRENT VALUE.
   *
   * That assumption is the whole caveat. v2's forecast extrapolated a ply
   * ramp, which was knowable arbitrarily far ahead; v3's trigger is the
   * meter, and future meter values depend on moves nobody has played yet. So
   * this is a "if the game stays exactly this interesting" readout, not a
   * prediction — it moves every ply, and that movement is the useful signal.
   *
   * `closure` is dropped: free squares are no longer monotone (a breach adds
   * one back), so the v2 estimate — expected crumbles versus free squares —
   * would now be a confident lie. Termination still holds via the hole set
   * (see this module's header); it just is not a closed form any more.
   *
   * Returns { nextQuake, nextHole }, each a ply or null beyond `horizon`.
   */
  forecast(ply, { horizon = 400 } = {}) {
    const q = Math.min(1, this.pressure(ply) * this.favor);
    if (q <= 0) return { nextQuake: null, nextHole: null };
    // P(crumble | quake): the rung weights at held pressure, plus the debt
    // force, which is what actually guarantees holes keep landing.
    const w = this.rungWeights(ply);
    const total = w.weaken + w.breach + w.displace + w.crumble;
    const pc = total > 0 ? w.crumble / total : 0;
    let sQuake = 1;
    let nextQuake = null;
    let sHole = 1;
    let nextHole = null;
    let debt = this.debt;
    let quakesSoFar = 0;
    for (let k = ply + 1; k <= ply + horizon; k++) {
      if (nextQuake === null) {
        sQuake *= 1 - q;
        if (sQuake <= 0.5) nextQuake = k;
      }
      if (nextHole === null) {
        // Expected quakes accumulate at rate q; each is a hole with prob pc,
        // and the debt cap forces one every debtCap quakes regardless.
        quakesSoFar += q;
        const forced = Math.floor(debt + quakesSoFar) >= this.debtCap;
        sHole *= 1 - q * (forced ? 1 : pc);
        if (sHole <= 0.5 || forced) nextHole = k;
      }
      if (nextQuake !== null && nextHole !== null) break;
    }
    return { nextQuake, nextHole };
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

  /** One recorded weighted pick over `{name: weight}`. Consumes exactly one
   *  rng() whatever the weights are, so the draw pattern stays stable. */
  #pickWeighted(name, weights) {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    const value = this.rng();
    let chosen = null;
    if (total > 0) {
      let acc = 0;
      const target = value * total;
      for (const [k, w] of entries) {
        acc += w;
        if (target < acc) {
          chosen = k;
          break;
        }
      }
      chosen ??= entries[entries.length - 1][0]; // float slop at the top end
    }
    if (this.#activeTrace) {
      this.#activeTrace.rolls.push({
        roll: name,
        value: r6(value),
        weights: Object.fromEntries(Object.entries(weights).map(([k, w]) => [k, r6(w)])),
        chosen,
      });
    }
    return chosen;
  }

  /**
   * Impact-weighted pick over scored terrain candidates. The score biases
   * toward squares that would actually unstick something; the randomness
   * masks that bias, so the player reads the choice as arbitrary. Structural
   * only — `impact` never references a side, so this cannot favour one.
   */
  #pickByImpact(name, candidates) {
    const weights = {};
    candidates.forEach((c, i) => (weights[i] = Math.max(0.25, c.impact)));
    const key = this.#pickWeighted(name, weights);
    return key === null ? null : candidates[Number(key)];
  }

  quakeDue(ply) {
    if (ply < this.onsetPly) return false;
    return this.#draw('quake', this.pQuake(ply));
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
    // holdInCheck is stamped BEFORE the trace is built, because both the
    // trace's p.quake and the quakeDue draw read pQuake() — so the recorded
    // probability is the one actually rolled against.
    if (this.holdInCheck && ffish.validateFen(fen, variant) === 1) {
      const b = new ffish.Board(variant, fen);
      this._held = b.isCheck();
      b.delete();
    }
    const terrain = terrainCensus(fen, files, ranks, this.holes);
    const trace = {
      ply,
      debtBefore: this.debt,
      debtAfter: this.debt,
      favor: this.favor,
      held: this._held,
      meter: r6(this.meter.value),
      staleness: this.lastStaleness ? r6(this.lastStaleness.staleness) : null,
      terrain,
      p: {
        quake: r6(this.pQuake(ply)),
        pressure: r6(this.pressure(ply)),
        crumbleForced: this.debt >= this.debtCap,
        oneSided: r6(this.pOneSided(ply)),
      },
      weights: null,
      rung: null,
      rungFallback: null,
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
      return this.#quakeTraced(trace, ffish, variant, fen, files, ranks, ply, terrain);
    } finally {
      this.#activeTrace = null;
      this._held = false;
      trace.debtAfter = this.debt;
    }
  }

  #quakeTraced(trace, ffish, variant, fen, files, ranks, ply, terrain) {
    if (!this.quakeDue(ply)) {
      trace.path.push(this._held ? 'held-in-check' : ply < this.onsetPly ? 'pre-onset' : 'quake-roll-failed');
      return null;
    }
    trace.path.push('quake');
    trace.census = { lockedPawns: lockedPawns(fen, files, ranks).length, displacement: null, displacement2: null, crumble: null };

    // --- rung selection ---------------------------------------------------
    // The debt cap forces a hole outright (no weighted draw consumed — one of
    // the state-dependent draw patterns the trace exists to expose). Every
    // rung counts toward debt now, not just displacements: the cheap rungs
    // are where most activity lives, so a displacement-only counter would
    // never force one and the board would never close.
    const forced = this.debt >= this.debtCap;
    let rung;
    if (forced) {
      rung = 'crumble';
      trace.path.push('crumble-forced');
    } else {
      const weights = this.rungWeights(ply, terrain);
      trace.weights = Object.fromEntries(Object.entries(weights).map(([k, w]) => [k, r6(w)]));
      rung = this.#pickWeighted('rung', weights) ?? 'crumble';
    }
    trace.rung = rung;

    // Walk the ladder from the rolled rung: if it has nothing to work with,
    // try the others in escalation order rather than wasting the quake.
    const order = [rung, ...RUNGS.filter((r) => r !== rung)];
    for (const r of order) {
      if (r !== rung && trace.rungFallback === null) trace.rungFallback = [];
      const out = this.#applyRung(r, trace, ffish, variant, fen, files, ranks, ply);
      if (out) {
        if (r !== rung) trace.rungFallback.push(r);
        return out;
      }
      if (r !== rung) trace.rungFallback.push(`${r}:empty`);
      else trace.fellThrough = true; // the rolled rung came up empty-handed
    }
    trace.path.push('starved');
    trace.outcome = 'starved';
    return null; // nothing legal anywhere — extremely late board; try next ply
  }

  /** Apply one rung, or return null if it has no candidates. */
  #applyRung(rung, trace, ffish, variant, fen, files, ranks, ply) {
    if (rung === 'weaken') return this.#weakenLeg(trace, fen, files, ranks);
    if (rung === 'breach') return this.#breachLeg(trace, ffish, variant, fen, files, ranks);
    if (rung === 'displace') return this.#displaceLeg(trace, ffish, variant, fen, files, ranks, ply);
    return this.#crumbleLeg(trace, ffish, variant, fen, files, ranks);
  }

  /** Rung 1 — a solid wall cracks into furniture. Safe by construction: the
   *  square keeps blocking, so no line opens and no check can be discovered;
   *  the edit only adds a capture option, to both armies equally. */
  #weakenLeg(trace, fen, files, ranks) {
    const cands = weakenCandidates(fen, files, ranks, this.holes);
    trace.census.weaken = cands.length;
    if (!cands.length) return null;
    const c = this.#pickByImpact('pick-weaken', cands);
    if (!c) return null;
    const postFen = clearEp(setSquare(fen, c.sq, FURNITURE));
    this.debt++;
    trace.chosen = { ...(trace.chosen ?? {}), terrain: { kind: 'weaken', square: c.sq, impact: c.impact } };
    trace.path.push('weaken');
    trace.outcome = 'weaken';
    return {
      displacements: [],
      crumble: null,
      terrain: { kind: 'weaken', square: c.sq },
      postFen,
      endsGame: false,
      trace,
    };
  }

  /** Rung 2 — furniture is smashed and the line opens for real. Filtered
   *  like a displacement, because opening a ray can discover a check. */
  #breachLeg(trace, ffish, variant, fen, files, ranks) {
    const { ok, rejected } = breachCandidates(ffish, variant, fen, files, ranks);
    trace.census.breach = { ok: ok.length, rejected: countByReason(rejected) };
    if (!ok.length) return null;
    const c = this.#pickByImpact('pick-breach', ok);
    if (!c) return null;
    this.debt++;
    trace.chosen = { ...(trace.chosen ?? {}), terrain: { kind: 'breach', square: c.sq, impact: c.impact, freed: c.freed } };
    trace.path.push('breach');
    trace.outcome = 'breach';
    return {
      displacements: [],
      crumble: null,
      terrain: { kind: 'breach', square: c.sq, freed: c.freed },
      postFen: c.fen,
      endsGame: false,
      trace,
    };
  }

  /** Rung 3 — v2's displacement, rules unchanged: symmetric preferred, the
   *  SEE landing guard judged on the composite board, one-sided only once
   *  its own ramp has run out. */
  #displaceLeg(trace, ffish, variant, fen, files, ranks, ply) {
    const tiers = displacementCandidates(ffish, variant, fen, files, ranks);
    trace.census.displacement = censusOfTiers(tiers);
    const firstWhite = this.#draw('first-side', 0.5);
    trace.firstSide = firstWhite ? 'white' : 'black';
    const p1 = bestTierForSide(tiers, firstWhite);
    if (!p1) {
      // The rolled first side has no legal candidate in ANY tier — the other
      // side may well have had one (the census shows it), but the Director
      // does not re-roll sides: the quake falls to the next rung.
      trace.path.push('no-first-leg');
      return null;
    }
    const c1 = this.#pickTraced('pick-leg1', p1.pool, p1.tier);
    trace.chosen = { ...(trace.chosen ?? {}), leg1: { from: c1.from, to: c1.to, piece: c1.piece, tier: p1.tier } };
    const tiers2 = displacementCandidates(ffish, variant, c1.fen, files, ranks);
    trace.census.displacement2 = censusOfTiers(tiers2);
    const p2 = bestTierForSide(tiers2, !firstWhite, (c) => leavesFirstLegSafe(c, c1.to, files, ranks));
    let displacements;
    let postFen;
    if (p2) {
      // symmetric: one piece per side — the arena breaks locks evenly
      const c2 = this.#pickTraced('pick-leg2', p2.pool, p2.tier);
      trace.chosen.leg2 = { from: c2.from, to: c2.to, piece: c2.piece, tier: p2.tier };
      displacements = [
        { from: c1.from, to: c1.to, piece: c1.piece },
        { from: c2.from, to: c2.to, piece: c2.piece },
      ];
      postFen = c2.fen;
      trace.path.push('paired');
    } else if (this.acceptsOneSided(ply)) {
      displacements = [{ from: c1.from, to: c1.to, piece: c1.piece }];
      postFen = c1.fen;
      trace.path.push('unpaired-one-sided');
    } else {
      trace.path.push('unpaired-held'); // hold out for a pairable quake
      return null;
    }
    this.debt++;
    trace.outcome = displacements.length === 2 ? 'paired' : 'one-sided';
    return { displacements, crumble: null, terrain: null, postFen, endsGame: false, trace };
  }

  /** Rung 4 — the closer. A square becomes a permanent HOLE, recorded in
   *  `this.holes` so the gods never crack it open again; that permanence is
   *  what keeps the duel provably finite. */
  #crumbleLeg(trace, ffish, variant, fen, files, ranks) {
    const { neutral, terminal, rejected } = crumbleCandidates(ffish, variant, fen, files, ranks);
    trace.census.crumble = { neutral: neutral.length, terminal: terminal.length, rejected: countByReason(rejected) };
    if (neutral.length) {
      const c = this.#pickTraced('pick-crumble', neutral);
      this.debt = 0;
      this.holes.add(c.sq);
      trace.chosen = { ...(trace.chosen ?? {}), crumble: { square: c.sq, pieceLost: c.pieceLost } };
      trace.path.push('crumble-neutral');
      trace.outcome = 'crumble';
      return {
        displacements: [],
        crumble: { square: c.sq, pieceLost: c.pieceLost },
        terrain: null,
        postFen: c.fen,
        endsGame: false,
        trace,
      };
    }
    if (terminal.length) {
      // The board has closed: every remaining collapse immobilizes the mover.
      // The arena finishes it — the floor gives way (§4.4), termination
      // 'earthquake' at the duel layer.
      const t = this.#pickTraced('pick-terminal', terminal);
      this.debt = 0;
      this.holes.add(t.sq);
      const collapsed = clearEp(setSquare(fen, t.sq, WALL));
      trace.chosen = { ...(trace.chosen ?? {}), crumble: { square: t.sq, reason: t.reason, pieceLost: t.pieceLost } };
      trace.path.push('crumble-terminal');
      trace.outcome = 'terminal';
      return {
        displacements: [],
        crumble: { square: t.sq, reason: t.reason, pieceLost: t.pieceLost },
        terrain: null,
        postFen: collapsed,
        endsGame: true,
        trace,
      };
    }
    return null;
  }
}
