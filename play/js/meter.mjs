// THE RESTLESSNESS METER — the record half of the Gods' trigger.
//
// Promoted to canon from the Phase 1.3 evidence pass (was
// `phase0/harness/meterlab/meter.mjs`, where it was a lab prototype
// subclassing the Director). The lab measured it against the old ply-ramp
// trigger on 96 games and it won on every axis that mattered: per-game
// god-inflicted harm 3.27 → 1.48, quakes fired while a king was in check
// 11.1% → 2.9%, and games got SHORTER rather than longer (median 45 → 43
// plies, q3 59 → 52, checkmate share up) — because the old trigger's quakes
// were actively un-mating positions, so removing the mistimed ones speeds
// duels up. The gods were the pacing problem they were built to solve.
//
// What it replaces: "how long has this duel run?" (a function of ply alone,
// blind to the board) with "is this game going anywhere?" — chess's
// fifty-move instinct as a boredom detector:
//
//   quiet ply (no capture, no check, no pawn advance, no promotion)
//       → meter climbs, faster on a stale board (staleness.mjs), faster
//         still if the position is a repeat
//   forcing ply → meter sates
//   P(quake)   = clamp((meter − threshold) / rampPlies), floored late by a
//                slow ply ramp — the backstop, so no duel is god-proof
//
// The meter is a pure function of the game record and the position — no
// engine search, no eval, no wall clock — so seeded determinism and ledger
// replay survive untouched. That is a hard constraint, not a preference:
// a movetime-bounded search anywhere in the trigger would make the draw
// sequence wall-clock dependent and every replay and corpus worthless.

import { getSquare, WALL, FURNITURE } from './fen.mjs';

export const METER_DEFAULTS = {
  sate: 4, // meter points refunded by one forcing ply
  repBonus: 2, // extra restlessness when a position repeats (shuffling = boredom)
  rampPlies: 16, // quiet plies (net of sating) from calm to P(quake)=1
  stalenessFloor: 0.5, // a fully LIVE board still fills the meter this fast...
  stalenessGain: 1, // ...and a fully dead one fills it at floor+gain
  floorOnsetPly: 120, // ply where the backstop floor starts rising...
  floorRampPlies: 120, // ...reaching P=1 this many plies later
};

export class RestlessnessMeter {
  constructor(config = {}) {
    const c = { ...METER_DEFAULTS, ...config };
    this.sate = c.sate;
    this.repBonus = c.repBonus;
    this.rampPlies = Math.max(1, c.rampPlies);
    this.stalenessFloor = c.stalenessFloor;
    this.stalenessGain = c.stalenessGain;
    this.floorOnsetPly = c.floorOnsetPly;
    this.floorRampPlies = Math.max(1, c.floorRampPlies);
    this.value = 0;
    this.staleness = 0; // last observed position staleness (0 live … 1 inert)
    this.config0 = Object.freeze({ ...c });
  }

  /**
   * Feed one completed ply. `ev` is a moveEvents() record; `staleness` is the
   * post-move position's inertness (staleness.mjs), which sets the fill RATE:
   * a live board bores the gods at `stalenessFloor`, a dead one at
   * `stalenessFloor + stalenessGain`. Returns the new meter value.
   */
  observe(ev, staleness = 0) {
    this.staleness = Math.min(1, Math.max(0, staleness));
    const forcing = !!(ev.capture || ev.check || ev.pawnAdvance || ev.promotion);
    if (forcing) {
      this.value = Math.max(0, this.value - this.sate);
    } else {
      const fill = 1 + (ev.repetition ? this.repBonus : 0);
      this.value += fill * (this.stalenessFloor + this.stalenessGain * this.staleness);
    }
    return this.value;
  }

  /** Meter-driven probability for an arbitrary meter value. */
  pOf(v) {
    return Math.min(1, Math.max(0, v / this.rampPlies));
  }

  /** Meter-driven probability component (no floor). */
  p() {
    return this.pOf(this.value);
  }

  /** Backstop floor: a slow ply ramp so even a perpetually "hot" duel
   *  (spite-check farming, endless captures) eventually faces the gods —
   *  termination cannot hinge on the meter alone. */
  floor(ply) {
    return Math.min(1, Math.max(0, (ply - this.floorOnsetPly) / this.floorRampPlies));
  }

  /** The trigger pressure at `ply`: whichever of meter and backstop is higher. */
  pAt(ply) {
    return Math.max(this.p(), this.floor(ply));
  }
}

const UCI_RE = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))([a-z]?)$/;

/**
 * Classify one completed ply for the meter. `prevFen` is the position the
 * move was played FROM; `postBoard` is the live ffish board AFTER the move
 * (isCheck() there means the mover delivered check). En-passant captures land
 * on an empty square, so "pawn changed file" also counts as a capture.
 *
 * A crate smash is NOT a capture here. It is an ordinary capture to search
 * and SAN (§4.6), but giving it sate credit lets the player farm furniture to
 * keep the gods asleep — brief §4.6 rules it out explicitly, and on the
 * current bed 56 of 58 stages carry crates, so the difference is not
 * academic. Stone can never be a move destination, so both terrain glyphs are
 * excluded here for symmetry rather than necessity.
 */
export function moveEvents(prevFen, uci, postBoard) {
  const m = uci.match(UCI_RE);
  if (!m) return { capture: false, check: postBoard.isCheck(), pawnAdvance: false, promotion: false };
  const [, from, to, promo] = m;
  let moverPiece = null;
  let destOcc = null;
  try {
    moverPiece = getSquare(prevFen, from);
    destOcc = getSquare(prevFen, to);
  } catch {
    /* offboard should be impossible for a legal move */
  }
  const isPawn = moverPiece === 'p' || moverPiece === 'P';
  const fileChanged = from[0] !== to[0];
  const tookAPiece = destOcc != null && destOcc !== WALL && destOcc !== FURNITURE;
  return {
    capture: tookAPiece || (isPawn && fileChanged && destOcc == null),
    check: postBoard.isCheck(),
    pawnAdvance: isPawn,
    promotion: !!promo,
  };
}

/** Repetition tracking for the meter: board field + turn, exact match. */
export class PositionLog {
  constructor() {
    this.counts = new Map();
  }

  /** Record a position; returns how many times it has now occurred. */
  record(fen) {
    const key = fen.split(' ').slice(0, 2).join(' ');
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n;
  }
}
