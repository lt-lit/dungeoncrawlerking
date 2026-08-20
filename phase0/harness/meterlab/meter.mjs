// Meter lab (Phase 1.3 evidence pass) — the RESTLESSNESS METER prototype.
//
// Hypothesis under test: the Director's core defect is its trigger, not its
// filters. pQuake is a function of PLY alone, so under 'restless' the gods
// fire into mating attacks and dead shuffles with equal enthusiasm — and the
// one-directional candidate filters then guarantee the intervention loosens
// whatever the position was building (the check-rescue / M1→M2 treadmill).
// The meter replaces "how long has the duel run?" with "is the game going
// anywhere?" — chess's fifty-move instinct as a boredom detector:
//
//   quiet ply (no capture, no check, no pawn advance, no promotion)
//       → meter += 1  (+repBonus more if the position is a repeat)
//   forcing ply → meter = max(0, meter - sate)   (the gods are SATED)
//   P(quake)   = clamp(meter / rampPlies), floored late by a slow ply ramp
//                (the backstop: no game is infinitely god-proof)
//
// The meter is a pure function of the game record — no engine, no eval, no
// wall clock — so seeded determinism and ledger replay survive untouched.
//
// MeterDirector subclasses the CANON Director and overrides pQuake() ONLY.
// quakeDue() consumes exactly one RNG draw per post-onset ply regardless of
// the threshold, so the draw PATTERN stays byte-aligned with the stock
// Director; streams diverge only where a quake outcome actually differs.
// Everything downstream — candidate enumeration, tiers, debt, crumbles,
// traces — is inherited untouched. (forecast() is NOT meaningful here: it
// extrapolates pQuake over future plies, and future meter values are
// unknowable. The lab never calls it.)
import { Director } from '../../../play/js/director.mjs';
import { getSquare } from '../../../play/js/fen.mjs';

export const METER_DEFAULTS = {
  sate: 4, // meter points refunded by one forcing ply
  repBonus: 2, // extra restlessness when a position repeats (shuffling = boredom)
  rampPlies: 16, // quiet plies (net of sating) from calm to P(quake)=1
  floorOnsetPly: 120, // ply where the backstop floor starts rising...
  floorRampPlies: 120, // ...reaching P=1 this many plies later
};

export class RestlessnessMeter {
  constructor(config = {}) {
    const c = { ...METER_DEFAULTS, ...config };
    this.sate = c.sate;
    this.repBonus = c.repBonus;
    this.rampPlies = Math.max(1, c.rampPlies);
    this.floorOnsetPly = c.floorOnsetPly;
    this.floorRampPlies = Math.max(1, c.floorRampPlies);
    this.value = 0;
    this.config0 = Object.freeze({ ...c });
  }

  /** Feed one completed ply's events; returns the new meter value. */
  observe(ev) {
    const forcing = !!(ev.capture || ev.check || ev.pawnAdvance || ev.promotion);
    if (forcing) this.value = Math.max(0, this.value - this.sate);
    else this.value += 1 + (ev.repetition ? this.repBonus : 0);
    return this.value;
  }

  /** Meter-driven probability component (no floor). */
  p() {
    return Math.min(1, this.value / this.rampPlies);
  }

  /** Backstop floor: a slow ply ramp so even a perpetually "hot" game
   *  (spite-check farming, endless captures) eventually faces the gods —
   *  the termination guarantee cannot hinge on the meter alone. */
  floor(ply) {
    return Math.min(1, Math.max(0, (ply - this.floorOnsetPly) / this.floorRampPlies));
  }

  pAt(ply) {
    return Math.max(this.p(), this.floor(ply));
  }
}

/**
 * The canon Director with the meter as its trigger. The host must call
 * observePly(events) after every completed ply BEFORE the quake phase runs
 * (the DuelController's onMove hook fires in exactly that window).
 */
export class MeterDirector extends Director {
  constructor(config = {}) {
    super(config);
    this.meter = new RestlessnessMeter(config.meter ?? {});
  }

  observePly(events) {
    return this.meter.observe(events);
  }

  /** State-aware trigger: meter (or the backstop floor), scaled by favor.
   *  onsetPly still gates the opening; favor 0 still silences entirely. */
  pQuake(ply) {
    if (ply < this.onsetPly) return 0;
    return Math.min(1, this.meter.pAt(ply) * this.favor);
  }
}

const UCI_RE = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))([a-z]?)$/;

/**
 * Classify one completed ply for the meter. `prevFen` is the position the
 * move was played FROM; `postBoard` is the live ffish board AFTER the move
 * (isCheck() there = the mover delivered check). En-passant captures land
 * on an empty square, so "pawn changed file" also counts as a capture.
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
  return {
    capture: (destOcc != null && destOcc !== '*') || (isPawn && fileChanged),
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
