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
//   cold ply   (no capture, no check, no pawn advance, no promotion, and no
//               NEW THREAT — v4)
//       → meter climbs, faster on a stale board (staleness.mjs), faster
//         still if the position is a repeat, SLOWER the hotter the recent
//         record (v4 heat, below)
//   hot ply    → meter sates
//   P(quake)   = clamp((meter − threshold) / rampPlies), floored late by a
//                slow ply ramp — the backstop, so no duel is god-proof
//
// v4 (designer 2026-09-05) changed three things about the record, each a
// measured defect of v3:
//
//   1. A CEILING. v3's meter had none: quiet plies kept adding past the
//      point where P was already 1, so a long quiet stretch banked a debt
//      no realistic aggression could repay — on wrathful, after twenty quiet
//      plies past full, it took 8–10 consecutive captures to bring P under
//      0.5 (simulated with this class). The meter now never holds more than
//      one ramp's worth, so a couple of captures always visibly matter.
//   2. A QUAKE SPENDS THE METER (`discharge`, called by the Director when a
//      quake lands). v3's quake left the meter where it was, so once P was
//      pinned the gods fired every ply until somebody captured — the median
//      gap between wrathful quakes was ONE ply. No hard cooldown (designer:
//      "too predictable"): the meter refills at random from the board's
//      staleness, so the spacing varies, but the gods never fire on a meter
//      they just discharged. The late BACKSTOP floor discharges too: it
//      counts plies SINCE THE LAST QUAKE, not since ply 0. On the wave 6 bed
//      games run ~200 plies and the old floor started rising at 120, so
//      half of calm's quakes there were floor-driven and the last stretch
//      of every long game was a barrage nothing could relieve. The
//      guarantee it carries is unchanged — the gods never stay silent
//      longer than floorOnsetPly + floorRampPlies — it is just measured from
//      the last time they acted.
//   3. HEAT. The fifty-move list — capture, check, pawn move, promotion — is
//      a list of IRREVERSIBLE moves, not aggressive ones: the best move is
//      usually quiet (rook to the open file, knight to the outpost, set the
//      fork), and every one of those read as boredom, while a pawn shuffle
//      and a spite check drained the meter as much as winning a queen.
//      Measured against the shipped presets, best-move engine play drained
//      the meter on 20–25% of plies, which is BELOW break-even on restless
//      and wrathful once a sectioned board pins staleness high — perfect
//      play could not hold the gods off. Now a ply is HOT if it does any of
//      the fifty-move things OR creates a new threat (tactics.mjs: a piece
//      won by static exchange, a pin, a skewer, a fork, a mate threat), and
//      a rolling window of recent plies scales the fill rate: while the
//      fight is hot the meter barely fills, however walled the dungeon is
//      around it; let it go cold and the gods wake, faster on a dead board.
//      Both sides' plies count — heat is a property of the record, and the
//      gods do not know which colour is the player.
//   4. TEDIUM — the slow twin. Discharging the meter broke the ladder: the
//      rungs were keyed to instantaneous pressure, and a meter that resets
//      on every quake fires, on average, well below the pressure where the
//      heavy rungs open, so a dead board got weaken after weaken and the
//      hole clock stopped (4 of 24 calm games on wave 6 ran to the ply cap
//      with five weakens and no hole). Tedium is the COLD SHARE of the last
//      `tediumPlies` plies of the record — the fraction with no fifty-move
//      event (capture, check, pawn move, promotion; a threat is not
//      progress) — so a shuffle reads 0.85–0.9 and a real fight 0.5–0.6.
//      It is never discharged and nothing sates it (a first cut as a sated
//      accumulator never rose on calm: a 12%-event shuffle drained it as
//      fast as it filled). Restlessness decides WHEN the gods act; tedium
//      decides WHAT they do and HOW MUCH (director.mjs rungWeights and the
//      budget draws).
//   5. A THREAT OR A CHECK HEATS BUT DOES NOT SATE. Heat scales the fill;
//      the refund (`sate`) is reserved for the fifty-move rule's own list —
//      capture, pawn move, promotion — which is the list of IRREVERSIBLE
//      things. Checks were on v3's forcing list and paid for it: two calm
//      and restless games on wave 6 ran 600 plies with half their plies
//      "hot", the meter never above 0.08, tedium 0.5 — check farms, the
//      perpetual-check draw this ruleset has no draw for. And a REPEATED
//      position is cold whatever the move was: repetition is boredom.
//      Building an attack calms the gods; only progress pays them off.
//   6. THE TEDIUM FLOOR — the dead-board backstop. A meter with a ceiling,
//      a discharge and heat has a narrow dynamic range: a dead board fills
//      it maybe twice as fast as a live one, and closing a 10×10 fortress
//      needs dozens of holes (v3 spent 84 on one). So when the record has
//      been dead for the whole tedium window AND nothing irreversible has
//      happened for `coldStreak` plies, P has a floor (`tediumFloor`),
//      undischarged: the gods hammer a board on which nothing is happening,
//      escalated (tedium opens the heavy rungs), and back off the instant
//      something does — one capture resets the streak and the floor is gone
//      for six plies, time enough to use the line. A hot record never sees
//      it. This, not volume, is what closes fortresses now.
//
// The meter is a pure function of the game record and the position — no
// engine search, no eval, no wall clock — so seeded determinism and ledger
// replay survive untouched. That is a hard constraint, not a preference:
// a movetime-bounded search anywhere in the trigger would make the draw
// sequence wall-clock dependent and every replay and corpus worthless.

import { getSquare, WALL, FURNITURE } from './fen.mjs';

export const METER_DEFAULTS = {
  sate: 4, // meter points refunded by one hot ply
  repBonus: 2, // extra restlessness when a position repeats (shuffling = boredom)
  rampPlies: 16, // quiet plies (net of sating) from calm to P(quake)=1 — and the CEILING
  stalenessFloor: 0.5, // a fully LIVE board still fills the meter this fast...
  stalenessGain: 1, // ...and a fully dead one fills it at floor+gain
  floorOnsetPly: 120, // ply where the backstop floor starts rising...
  floorRampPlies: 120, // ...reaching P=1 this many plies later
  heatWindow: 8, // plies of record the heat reads (both sides)
  tediumPlies: 48, // plies of record tedium reads: the cold share of the last this-many plies
  tediumDeadAt: 0.8, // tedium at or above this = a dead record...
  coldStreak: 6, // ...and this many plies with nothing irreversible = the tedium floor is on
  tediumFloor: 0.35, // P(quake) floor on a dead record (0 = off)
  heatGain: 1, // fill × (1 − heatGain × heat): 1 = a fully hot record stops the fill, 0 = heat off
  relief: 1, // share of the meter a quake discharges: 1 = reset, 0 = v3 (never)
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
    this.heatWindow = Math.max(1, Math.round(c.heatWindow));
    this.tediumPlies = Math.max(1, c.tediumPlies);
    this.tediumDeadAt = Math.min(1, Math.max(0, c.tediumDeadAt));
    this.coldStreak = Math.max(0, Math.round(c.coldStreak));
    this.tediumFloor = Math.min(1, Math.max(0, c.tediumFloor));
    this.heatGain = Math.min(1, Math.max(0, c.heatGain));
    this.relief = Math.min(1, Math.max(0, c.relief));
    this.value = 0;
    this.staleness = 0; // last observed position staleness (0 live … 1 inert)
    this.window = []; // the last heatWindow plies, true = hot
    this.cold = []; // the last tediumPlies plies, true = no fifty-move event (v4 tedium)
    this.streak = 0; // plies since the last irreversible event (v4 tedium floor)
    this.lastQuakePly = 0; // the backstop floor counts from here (v4)
    this.config0 = Object.freeze({ ...c });
  }

  /** Share of the recent record that was hot, 0 … 1. Pure. */
  get heat() {
    if (!this.window.length) return 0;
    let hot = 0;
    for (const h of this.window) if (h) hot++;
    return hot / this.window.length;
  }

  /** A fifty-move event: irreversible progress — capture, pawn move,
   *  promotion — and never on a repeated position. Sates the meter. */
  static isEvent(ev) {
    return !ev.repetition && !!(ev.capture || ev.pawnAdvance || ev.promotion);
  }

  /** Is this ply hot? An event, a check, or a new threat (v4) — never a
   *  repetition. Heats the record; only an EVENT sates. */
  static isHot(ev) {
    return !ev.repetition && (RestlessnessMeter.isEvent(ev) || !!ev.check || !!ev.threat);
  }

  /**
   * Feed one completed ply. `ev` is a moveEvents() record (plus `threat`, set
   * by the Director from the threat ledger); `staleness` is the post-move
   * position's inertness (staleness.mjs), which sets the fill RATE: a live
   * board bores the gods at `stalenessFloor`, a dead one at
   * `stalenessFloor + stalenessGain` — scaled down by how hot the recent
   * record is. Returns the new meter value, never above the ceiling.
   */
  observe(ev, staleness = 0) {
    this.staleness = Math.min(1, Math.max(0, staleness));
    const event = RestlessnessMeter.isEvent(ev);
    const hot = RestlessnessMeter.isHot(ev);
    // Heat reads the record BEFORE this ply joins it, so a hot ply on a cold
    // record still sates in full and a cold ply on a hot record fills little.
    const coldness = 1 - this.heatGain * this.heat;
    if (event) {
      this.value = Math.max(0, this.value - this.sate);
    } else if (!hot) {
      const fill = (1 + (ev.repetition ? this.repBonus : 0)) * (this.stalenessFloor + this.stalenessGain * this.staleness) * coldness;
      this.value += fill;
    }
    // (a threat-only ply neither sates nor fills: it heats the record.)
    this.value = Math.min(this.value, this.rampPlies); // the ceiling (v4)
    this.window.push(hot);
    if (this.window.length > this.heatWindow) this.window.splice(0, this.window.length - this.heatWindow);
    this.cold.push(!event);
    if (this.cold.length > this.tediumPlies) this.cold.splice(0, this.cold.length - this.tediumPlies);
    this.streak = event ? 0 : this.streak + 1;
    return this.value;
  }

  /** A quake landed at `ply`: the gods spent their restlessness (v4), and
   *  the backstop floor restarts from here. Returns the meter value after
   *  relief. */
  discharge(ply = null) {
    this.value = Math.max(0, this.value * (1 - this.relief));
    if (typeof ply === 'number') this.lastQuakePly = ply;
    return this.value;
  }

  /** Tedium: the cold share of the recent record, 0 (every ply an event)
   *  … 1 (nothing irreversible for a full window). Pure; never discharged,
   *  never sated. The ladder and the budget read this. */
  get t() {
    if (!this.cold.length) return 0;
    let n = 0;
    for (const c of this.cold) if (c) n++;
    return n / this.cold.length;
  }

  /** Alias kept for readers of the record: tedium as a 0…1 number. */
  get tedium() {
    return this.t;
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
   *  termination cannot hinge on the meter alone. v4: measured in plies
   *  since the last quake, so a quake relieves the backstop too. */
  floor(ply) {
    return Math.min(1, Math.max(0, (ply - this.lastQuakePly - this.floorOnsetPly) / this.floorRampPlies));
  }

  /** The dead-board backstop (v4): `tediumFloor` while the record has been
   *  dead for the whole window and nothing irreversible has happened for
   *  `coldStreak` plies; 0 otherwise. Pure; never discharged. */
  deadFloor() {
    if (!this.tediumFloor || this.cold.length < this.tediumPlies) return 0;
    return this.t >= this.tediumDeadAt && this.streak >= this.coldStreak ? this.tediumFloor : 0;
  }

  /** The trigger pressure at `ply`: the meter, the late backstop, or the
   *  dead-board backstop — whichever is highest. */
  pAt(ply) {
    return Math.max(this.p(), this.floor(ply), this.deadFloor());
  }

  /** Snapshot for the duel's undo stack (duel.mjs #snapshot). */
  snapshot() {
    return { value: this.value, cold: [...this.cold], streak: this.streak, window: [...this.window], staleness: this.staleness, lastQuakePly: this.lastQuakePly };
  }

  restore(s) {
    this.value = s?.value ?? 0;
    this.cold = Array.isArray(s?.cold) ? [...s.cold] : [];
    this.streak = s?.streak ?? 0;
    this.window = Array.isArray(s?.window) ? [...s.window] : [];
    this.staleness = s?.staleness ?? 0;
    this.lastQuakePly = s?.lastQuakePly ?? 0;
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
 *
 * `threat` (v4) is NOT set here — it needs the threat ledger of the previous
 * position, which the Director keeps (director.mjs observePly).
 */
export function moveEvents(prevFen, uci, postBoard) {
  const m = uci.match(UCI_RE);
  if (!m) return { capture: false, check: postBoard.isCheck(), pawnAdvance: false, promotion: false, threat: false };
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
    threat: false,
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
