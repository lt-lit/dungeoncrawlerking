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
//   forcing ply → meter sated (mode-dependent, see sateMode)
//   P(quake)   = clamp((meter − thresholdM) / rampPlies), floored late by a
//                slow ply ramp (the backstop: no game is infinitely god-proof)
//
// The meter is a pure function of the game record — no engine, no eval, no
// wall clock — so seeded determinism and ledger replay survive untouched.
//
// VARIANT KNOBS (the second sweep; every arm is one knob off v0):
//   sateMode        'sub' (v0: −sate) | 'reset' (drain to 0) | 'decay' (×decayFactor)
//   thresholdM      no meter contribution below this value ('threshold' arm)
//   netMode         null | 'presence' | 'approach' — quiet moves that make
//                   mating-net progress ALSO sate (the "constriction is
//                   action even when silent" hypothesis). presence: the
//                   mover's piece count in the enemy king's zone (Chebyshev
//                   ≤ 2) grew. approach: the moved piece ended closer to the
//                   enemy king than it started.
//   holdInCheck     never roll while the side to move is in check
//                   (deterministic from the FEN; the timing-layer HOLD)
//   crumbleIntegral >0: P(crumble|quake) ramps on the meter's CUMULATIVE
//                   staleness integral (Σ p per ply) over this many
//                   stale-ply-equivalents, instead of the raw ply ramp —
//                   the board closes in proportion to how boring the game
//                   has BEEN, not how long it has lasted. Debt-cap force
//                   is untouched.
//
// MeterDirector subclasses the CANON Director and overrides pQuake() (and,
// for the variants, quake()/pCrumble()) ONLY. quakeDue() consumes exactly
// one RNG draw per post-onset ply regardless of the threshold, so the draw
// PATTERN stays byte-aligned with the stock Director; streams diverge only
// where a quake outcome actually differs. Everything downstream — candidate
// enumeration, tiers, debt, crumbles, traces — is inherited untouched.
// (forecast() is NOT meaningful here: it extrapolates pQuake over future
// plies, and future meter values are unknowable. The lab never calls it.)
import { Director, fenGrid } from '../../../play/js/director.mjs';
import { getSquare } from '../../../play/js/fen.mjs';

export const METER_DEFAULTS = {
  sate: 4, // meter points refunded by one forcing ply (sateMode 'sub')
  repBonus: 2, // extra restlessness when a position repeats (shuffling = boredom)
  rampPlies: 16, // quiet plies (net of sating) from calm to P(quake)=1
  floorOnsetPly: 120, // ply where the backstop floor starts rising...
  floorRampPlies: 120, // ...reaching P=1 this many plies later
  sateMode: 'sub', // 'sub' | 'reset' | 'decay'
  decayFactor: 0.4, // sateMode 'decay': meter ×= this on a forcing ply
  thresholdM: 0, // meter values below this contribute P=0
  netMode: null, // null | 'presence' | 'approach' (net progress sates too)
  holdInCheck: false, // never roll while the side to move is in check
  crumbleIntegral: 0, // >0: crumble ramp runs on Σ staleness, not ply
};

export class RestlessnessMeter {
  constructor(config = {}) {
    const c = { ...METER_DEFAULTS, ...config };
    this.sate = c.sate;
    this.repBonus = c.repBonus;
    this.rampPlies = Math.max(1, c.rampPlies);
    this.floorOnsetPly = c.floorOnsetPly;
    this.floorRampPlies = Math.max(1, c.floorRampPlies);
    this.sateMode = c.sateMode;
    this.decayFactor = c.decayFactor;
    this.thresholdM = c.thresholdM;
    this.netMode = c.netMode;
    this.holdInCheck = c.holdInCheck;
    this.crumbleIntegral = c.crumbleIntegral;
    this.value = 0;
    this.integral = 0; // Σ p() per completed ply — the staleness odometer
    this.config0 = Object.freeze({ ...c });
  }

  /** Feed one completed ply's events; returns the new meter value. */
  observe(ev) {
    const forcing = !!(ev.capture || ev.check || ev.pawnAdvance || ev.promotion || ev.netProgress);
    if (forcing) {
      if (this.sateMode === 'reset') this.value = 0;
      else if (this.sateMode === 'decay') this.value *= this.decayFactor;
      else this.value = Math.max(0, this.value - this.sate);
    } else {
      this.value += 1 + (ev.repetition ? this.repBonus : 0);
    }
    this.integral += this.p();
    return this.value;
  }

  /** Meter-driven probability for an arbitrary meter value (threshold-aware). */
  pOf(v) {
    if (v < this.thresholdM) return 0;
    return Math.min(1, (v - this.thresholdM) / this.rampPlies);
  }

  /** Meter-driven probability component (no floor). */
  p() {
    return this.pOf(this.value);
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
    this._held = false; // holdInCheck: set per quake() call from the preFen
  }

  observePly(events) {
    return this.meter.observe(events);
  }

  /** State-aware trigger: meter (or the backstop floor), scaled by favor.
   *  onsetPly still gates the opening; favor 0 still silences entirely;
   *  holdInCheck zeroes the roll while a king is in check (the draw still
   *  happens — rng() < 0 fails — so the stream stays byte-aligned). */
  pQuake(ply) {
    if (ply < this.onsetPly) return 0;
    if (this._held) return 0;
    return Math.min(1, this.meter.pAt(ply) * this.favor);
  }

  /** crumbleIntegral variant: the crumble ramp runs on cumulative staleness
   *  instead of the raw ply. Debt-cap force is inherited semantics. */
  pCrumble(ply, debt = this.debt) {
    if (!this.meter.crumbleIntegral) return super.pCrumble(ply, debt);
    if (debt >= this.debtCap) return 1;
    const p = Math.min(1, this.meter.integral / this.meter.crumbleIntegral);
    return p * p; // squared, like the canon ramp: rare early, certain late
  }

  /** holdInCheck needs the preFen, which pQuake never sees — stamp the check
   *  state before the canon quake() builds its trace (its p.quake and the
   *  quakeDue draw both call this.pQuake, so the trace shows the truth). */
  quake(ffish, variant, fen, files, ranks, ply) {
    if (this.meter.holdInCheck) {
      const b = new ffish.Board(variant, fen);
      this._held = b.isCheck();
      b.delete();
    }
    try {
      return super.quake(ffish, variant, fen, files, ranks, ply);
    } finally {
      this._held = false;
    }
  }
}

const UCI_RE = /^([a-l](?:10|[1-9]))([a-l](?:10|[1-9]))([a-z]?)$/;

const sqFR = (sq) => ({ f: sq.charCodeAt(0) - 97, r: parseInt(sq.slice(1), 10) - 1 });
const cheb = (a, b) => Math.max(Math.abs(a.f - b.f), Math.abs(a.r - b.r));

function findKing(grid, ch) {
  for (let r = 0; r < grid.length; r++) {
    for (let f = 0; f < grid[r].length; f++) {
      if (grid[r][f] === ch) return { f, r };
    }
  }
  return null;
}

/** Mover-color piece count (own king included — it mates in endgames) within
 *  Chebyshev ≤ 2 of the enemy king. */
function zoneCount(grid, moverWhite, ek) {
  let n = 0;
  for (let r = 0; r < grid.length; r++) {
    for (let f = 0; f < grid[r].length; f++) {
      const c = grid[r][f];
      if (!c || c === '*') continue;
      if ((c === c.toUpperCase()) !== moverWhite) continue;
      if (cheb({ f, r }, ek) <= 2) n++;
    }
  }
  return n;
}

/**
 * Classify one completed ply for the meter. `prevFen` is the position the
 * move was played FROM; `postBoard` is the live ffish board AFTER the move
 * (isCheck() there = the mover delivered check). En-passant captures land
 * on an empty square, so "pawn changed file" also counts as a capture.
 *
 * opts = { netMode, files, ranks } — when netMode is set, also compute
 * `netProgress` (see the variant notes at the top). The enemy king cannot
 * move during the mover's ply, so its square is read from prevFen.
 */
export function moveEvents(prevFen, uci, postBoard, opts = {}) {
  const m = uci.match(UCI_RE);
  if (!m) return { capture: false, check: postBoard.isCheck(), pawnAdvance: false, promotion: false, netProgress: false };
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
  let netProgress = false;
  if (opts.netMode && moverPiece) {
    const moverWhite = moverPiece === moverPiece.toUpperCase();
    const gPrev = fenGrid(prevFen, opts.files, opts.ranks);
    const ek = findKing(gPrev, moverWhite ? 'k' : 'K');
    if (ek) {
      if (opts.netMode === 'approach') {
        netProgress = cheb(sqFR(to), ek) < cheb(sqFR(from), ek);
      } else {
        const gPost = fenGrid(postBoard.fen(), opts.files, opts.ranks);
        netProgress = zoneCount(gPost, moverWhite, ek) > zoneCount(gPrev, moverWhite, ek);
      }
    }
  }
  return {
    capture: (destOcc != null && destOcc !== '*') || (isPawn && fileChanged),
    check: postBoard.isCheck(),
    pawnAdvance: isPawn,
    promotion: !!promo,
    netProgress,
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
