// Live human-vs-engine duel controller with the Board State Director
// (Earthquakes — the crumble system's successor; see director.mjs).
//
// Structural port of phase0/harness/game.mjs (the reference implementation of
// the whole loop) with the synchronous engine-vs-engine loop split into
// driver-called steps: main.mjs calls playerMove()/engineMove() depending on
// whose seat is on turn; the post-move pipeline (game-end check + quake
// phase) mirrors the harness's.
//
// Repetition is NOT punished as a RULE (Director design): no repetition
// crumble. The position log below only feeds the restlessness meter —
// shuffling bores the gods faster; it never adjudicates anything.
// Termination rests on the Director's holes (debt cap guarantees crumbles
// keep landing) + stalemate-as-loss.
//
// The ffish Board is the source of truth for legality and game end; the
// engine is queried per ply with `position fen <base> moves <since-base>`,
// and a bare `position fen` after every quake resets engine repetition
// history (spike 10/11, CLAUDE.md rule 9) — load-bearing here, since with
// no repetition rules a stale engine history could never adjudicate anyway,
// but the reset also clears TT-adjacent state after surgery.
import { Director } from './director.mjs';
import { moveEvents, PositionLog } from './meter.mjs';
import { findSquares } from './fen.mjs';
import { flipTurn, evalSoftens } from './tactics.mjs';

/** The principal variation of a search result's last "info … pv …" line,
 *  as UCI moves. Parsed here rather than on the engine wrapper because the
 *  duel runs on two of them (play/js/engine.mjs in the browser, the Node
 *  UCI wrapper in phase0/lib/load.mjs for the labs) and both hand back
 *  `infoLines`. */
function lastPv(result) {
  const lines = result?.infoLines ?? [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/ pv (.+)$/);
    if (m) return m[1].trim().split(/\s+/).filter(Boolean);
  }
  return [];
}

/**
 * Game-end check per spike 11: numberLegalMoves()===0 is the primary end
 * condition, and the side to move LOSES (checkmate, stalemate-as-loss and
 * post-king-capture states all reduce to mover-loses under the duel config).
 * ffish's isGameOver()/result() draw-adjudicate bare-kings insufficient
 * material even under the no-draw config, so they must not drive the loop.
 *
 * The bare-army rule (a side stripped to a bare king loses — the army IS
 * the summoning) is IN-GRAMMAR: the variant config carries
 * extinctionPieceTypes=* + extinctionPieceCount=1 (+ pseudoRoyal=false), so
 * the engine itself plays for strips (scores them mate-1) and a bared side
 * has zero legal moves — mover-loses covers it with no game-layer check.
 * The game layer keeps ONE adjudication: kingless states (reachable only
 * through position surgery). Crumbles never strip a last piece (guard in
 * the pacing loop), so only a capture can bare a side.
 */
function gameEnded(board) {
  return board.numberLegalMoves() === 0;
}

/** Non-king piece counts per color from a FEN's board field. */
function nonKingCounts(fen) {
  const counts = { white: 0, black: 0 };
  for (const ch of fen.split(' ')[0]) {
    if (/[A-Z]/.test(ch) && ch !== 'K') counts.white++;
    else if (/[a-z]/.test(ch) && ch !== 'k') counts.black++;
  }
  return counts;
}

/** 'white'|'black' if that side has NO KING (post-capture state), else null.
 *  Probed: ffish only auto-terminates a king capture when the victim had
 *  nothing else; a kingless side with material keeps generating moves (and
 *  can never be mated — no king). The engine understands (scores it as a
 *  forced loss), but the game layer ends it NOW rather than letting a
 *  zombie army shuffle for a few plies. */
function kinglessSide(fen) {
  const boardField = fen.split(' ')[0];
  const hasWhiteK = boardField.includes('K');
  const hasBlackK = boardField.includes('k');
  if (!hasWhiteK && hasBlackK) return 'white';
  if (!hasBlackK && hasWhiteK) return 'black';
  return null;
}

// Backstop only: the Director guarantees termination (debt-forced crumbles
// accumulate permanent holes — the monotone force; breaches can reopen at
// most the finite authored-wall supply); a duel that reaches this many
// plies is a bug, not a long game.
const MAX_PLIES = 1000;

/**
 * THE REPLAY LOG (2026-09-06). `record` is the duel's ledger — everything a
 * post-mortem of the gods needs, appended as it happens and never rewritten:
 *   moves / sans        one per ply
 *   states              the EXACT board state after every completed pipeline
 *                       step (post-quake): fen, holes, god crates, debt, the
 *                       meters — states[0] is the start position
 *   quakeTraces         the Director's roll trace, every ply (Phase 1.2)
 *   quakes              what landed, pre/post FEN (+ the host's evalDelta)
 *   attempts            v4.3 compositions the eval gate REJECTED, in full —
 *                       "what did the gods try first, and why not"
 *   engine              the enemy's reply searches: score, depth, pv, ms
 *   anomalies           the duel layer's own warnings
 *   log                 display lines the host mirrored (what the player saw)
 *   flags               the player's own "look at this" marks
 *   branches            UNDO history — see #restore: the tail an undo cuts
 *                       off is moved here, not dropped, with the board state
 *                       right before the undo
 *   tunes               config history (dials, favor, undo markers) — never
 *                       truncated, like the RNG stream it explains
 * Every entry carries `seq` (a counter that never resets or rewinds — the
 * wall-clock order across undos, which is also the Director's RNG order)
 * and `at` (epoch ms). Undo truncates the RECORD_ARRAYS by the snapshot's
 * lens; the ONE list below feeds both the lens and the branch capture, so a
 * new per-ply array cannot be lost by one side and kept by the other.
 */
export const RECORD_ARRAYS = ['moves', 'sans', 'states', 'quakeTraces', 'quakes', 'attempts', 'engine', 'anomalies', 'log', 'flags'];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const r4 = (x) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 1e4) / 1e4 : x);

/** The last "info … depth D … nodes N … pv …" line of a search result, parsed. */
function searchSummary(result) {
  const lines = result?.infoLines ?? [];
  let depth = null;
  let seldepth = null;
  let nodes = null;
  let time = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (!/ score /.test(l)) continue;
    depth = (l.match(/ depth (\d+)/) ?? [])[1] ?? null;
    seldepth = (l.match(/ seldepth (\d+)/) ?? [])[1] ?? null;
    nodes = (l.match(/ nodes (\d+)/) ?? [])[1] ?? null;
    time = (l.match(/ time (\d+)/) ?? [])[1] ?? null;
    break;
  }
  const num = (v) => (v === null ? null : parseInt(v, 10));
  return { depth: num(depth), seldepth: num(seldepth), nodes: num(nodes), time: num(time), pv: lastPv(result) };
}

export class DuelController {
  /**
   * opts = {
   *   ffish, engine,                       // initialized modules (catalog loaded)
   *   variantName, startFen, files, ranks,
   *   director: { onsetPly, debtCap, holdInCheck, extraActions,
   *               weakenBias, breachAt/Bias, displaceAt/Bias, crumbleAt/Bias,
   *               meter: {...}, staleness: {...}, seed },  // DIRECTOR_DEFAULTS
   *   go: 'depth 22 movetime 500',         // paired limits (CLAUDE.md rule 5; 22 is a WASM-stability cap, see main.mjs)
   *   mateGo: 'depth 12 movetime 600',     // v4.2: the gods' mate probes when a quake is due (null = off)
   *   evalGate: { draws: 2, softenCp: 200, flipMinCp: 150, giftCp: 500 }, // v4.3: probe each composition, reject softening (null = off)
   *   hooks: {                             // all optional, awaited where async matters
   *     onMove({ uci, san, mover, ply }),
   *     onQuake({ displacements, crumble, terrain, endedGame, preFen, postFen, trace }),
   *                                        // awaited (UI animates). `terrain`
   *                                        // is an ARRAY — a quake spends a
   *                                        // budget, so rungs mix.
   *     onEnd({ result, winner, termination }),
   *     onEngineInfo({ score, depth }),
   *     onDirectorTrace(trace),            // Phase 1.2: EVERY ply's roll trace,
   *                                        // quake or not — fire-and-forget
   *                                        // (never awaited; render-only)
   *   },
   * }
   */
  constructor(opts) {
    this.ffish = opts.ffish;
    this.engine = opts.engine;
    this.variantName = opts.variantName;
    this.startFen = opts.startFen;
    this.files = opts.files;
    this.ranks = opts.ranks;
    this.go = opts.go ?? 'depth 22 movetime 500';
    // v4.2 (designer 2026-09-05: "give the gods the data they need"): when a
    // quake is due the duel asks the engine for mate lines — the position as
    // it stands and, turn flipped, the "trap is set" position — and hands
    // them to the Director as the protected set's source of record. The
    // enemy's own last search joins for free when it is fresh. Paired limits
    // (rule 5); a failed probe is logged and the gods fall back to the grid.
    this.mateGo = opts.mateGo === undefined ? 'depth 12 movetime 600' : opts.mateGo;
    this.lastSearch = null; // { fen, score, pv } of the enemy's last reply search
    // v4.3 (designer 2026-09-05): every composed quake is probed on the board
    // it produces and rejected if it softens the game — a decided position
    // pulled toward equality, a flip of who is ahead, a mate lost, changed
    // hands or delayed, or an equal position decided by the gods. A rejected
    // composition is rolled back and a fresh one drawn, `draws` times; then
    // a lone weaken is tried; then nothing lands and the meter is spent
    // anyway. Requires the mate probe (the before-eval is its score).
    this.evalGate = opts.evalGate === undefined ? { draws: 2, softenCp: 200, flipMinCp: 150, giftCp: 500 } : opts.evalGate;
    this.hooks = opts.hooks ?? {};
    this.director = new Director(opts.director ?? {});
    // The conservation brake's reference point (§4.5, designer 2026-09-01):
    // freeze the authored terrain census from the start position. A replay
    // re-derives the identical anchor from the identical startFen.
    this.director.anchorTerrain(opts.startFen, opts.files, opts.ranks);
    this.board = null;
    this.baseFen = opts.startFen;
    this.movesSinceBase = [];
    this.ply = 0;
    this.state = 'idle'; // idle | playing | ended | error
    this.record = { result: null, winner: null, termination: null, error: null, tunes: [], branches: [], startedAt: Date.now() };
    for (const k of RECORD_ARRAYS) this.record[k] = [];
    this.seq = 0; // the log's event counter — never reset, never rewound (see RECORD_ARRAYS)
    this.snapshots = []; // undo support (cheat feature) — one per playable state
    // The Director's restlessness meter is fed from here, not from a host
    // hook: the trigger is canon now (v3), so a host that forgot to wire it
    // would silently get a Director that never fires.
    this.positions = new PositionLog();
  }

  /** Register the variant + start position with both libraries. */
  async start() {
    this.board = new this.ffish.Board(this.variantName, this.startFen);
    this.engine.send('ucinewgame');
    this.engine.setoption('UCI_Variant', this.variantName);
    await this.engine.isready();
    this.state = 'playing';
    if (gameEnded(this.board)) {
      // Arena validation should make this impossible; degrade gracefully.
      await this.#finish();
    } else {
      this.#takeSnapshot();
    }
    return this.state;
  }

  fen() {
    return this.board.fen();
  }

  /** 'white' | 'black' side to move. */
  turnColor() {
    return this.board.turn() ? 'white' : 'black';
  }

  /** Legal moves (UCI strings) in the current position. */
  legalMoves() {
    return this.board.legalMoves().trim().split(/\s+/).filter(Boolean);
  }

  /** Play the human's move (full UCI incl. promotion suffix). */
  async playerMove(uci) {
    this.#assertPlaying();
    if (!this.legalMoves().includes(uci)) {
      throw new Error(`illegal move: ${uci}`);
    }
    return this.#push(uci, 'player');
  }

  /** Ask the engine for its move and play it. */
  async engineMove() {
    this.#assertPlaying();
    let res;
    let goUsed = this.go;
    let recovered = false;
    const t0 = now();
    try {
      res = await this.#search(this.go);
      if (this.state !== 'playing') return { ended: true }; // destroyed mid-search
    } catch (e) {
      if (this.state !== 'playing') return { ended: true };
      // Search stalled or the WASM instance died (extreme late-game walled
      // positions can stack-overflow the engine pthread — the A-prime
      // runaway hazard past what the watchdog can rescue). Recovery ladder:
      // recycle the engine (fresh instance, never quit() — rule 6) via the
      // host, then retry ONCE at a much lower depth cap.
      this.record.anomalies.push(`ply ${this.ply}: engine search failed (${e.message.split('\n')[0]}) — recycling`);
      if (!this.hooks.onEngineStall) return this.#fail(`ply ${this.ply}: engine search failed: ${e.message.split('\n')[0]}`);
      let fresh = null;
      try {
        fresh = await this.hooks.onEngineStall(e);
      } catch {
        fresh = null;
      }
      if (this.state !== 'playing') return { ended: true }; // destroyed during recycle
      if (!fresh) return this.#fail(`ply ${this.ply}: engine recycle failed after search stall`);
      this.engine = fresh;
      this.engine.send('ucinewgame');
      this.engine.setoption('UCI_Variant', this.variantName);
      await this.engine.isready();
      const mt = this.go.match(/movetime (\d+)/);
      const reduced = `depth 12${mt ? ` movetime ${mt[1]}` : ''}`;
      goUsed = reduced;
      recovered = true;
      try {
        res = await this.#search(reduced);
      } catch (e2) {
        return this.#fail(`ply ${this.ply}: engine search failed even after recycle: ${e2.message.split('\n')[0]}`);
      }
      if (this.state !== 'playing') return { ended: true };
    }
    if (!res.bestmove || res.bestmove === '(none)') {
      return this.#fail(`ply ${this.ply}: engine returned no move but ffish says game not over`);
    }
    if (!this.legalMoves().includes(res.bestmove)) {
      return this.#fail(`ply ${this.ply}: engine move ${res.bestmove} illegal per ffish (desync)`);
    }
    const score = this.engine.lastScore(res);
    const summary = searchSummary(res);
    // The replay log: the enemy's reading of every position it moved from,
    // mover-POV score as the engine reports it. `ply` is the ply this move
    // becomes (#push increments). The eval trajectory of a game lives here.
    this.record.engine.push(this.#stamp({ ply: this.ply + 1, fen: this.board.fen(), go: goUsed, ms: Math.round(now() - t0), bestmove: res.bestmove, score, ...summary, recovered }));
    // v4.2: keep the search — its mate line, if any, is the gods' business.
    this.lastSearch = { fen: this.board.fen(), score, pv: summary.pv };
    if (score && this.hooks.onEngineInfo) {
      this.hooks.onEngineInfo({ score, depth: summary.depth });
    }
    return this.#push(res.bestmove, 'engine');
  }

  // ---- the replay log's own entries ----------------------------------------

  /** Stamp an event with the log's sequence number and the wall clock. */
  #stamp(obj) {
    obj.seq = ++this.seq;
    obj.at = Date.now();
    return obj;
  }

  /** Summary of the Director's meters — the per-ply state's readout, not the
   *  meter's full restore snapshot (the trace carries the rest). */
  #meterReadout() {
    const m = this.director.meter;
    return { value: r4(m.value), tedium: r4(m.t), heat: r4(m.heat), staleness: r4(m.staleness), streak: m.streak, lastQuakePly: m.lastQuakePly };
  }

  /** The exact board state right now: what the undo stack holds, what a
   *  reader needs to print any position without a chess library. */
  #stateNow(extra = {}) {
    const fen = this.board ? this.board.fen() : null;
    return this.#stamp({
      ply: this.ply,
      fen,
      turn: fen ? fen.split(' ')[1] : null,
      debt: this.director.debt,
      holes: [...this.director.holes],
      godCrates: [...this.director.godCrates],
      meter: this.#meterReadout(),
      ...extra,
    });
  }

  /** A host display line, mirrored into the log (main.mjs feeds its duel
   *  log through here) — so an export shows what the player was told. */
  note(msg, cls = null) {
    this.record.log.push(this.#stamp({ ply: this.ply, msg: String(msg), cls }));
  }

  /** The player's own mark: "look at this ply" — with an optional note. An
   *  undo carries flags on the abandoned line into the branch with it. */
  flag(note = '') {
    const f = this.#stateNow({ note: String(note ?? ''), state: this.state });
    this.record.flags.push(f);
    return f;
  }

  /** The record's array lengths — the undo lens (see RECORD_ARRAYS). */
  #lens() {
    const lens = {};
    for (const k of RECORD_ARRAYS) lens[k] = this.record[k].length;
    return lens;
  }

  /** One search with paired limits and a tight per-move UCI timeout, so a
   *  dead engine surfaces in seconds (the go() watchdog still fires first
   *  in the recoverable overrun case). Tracked so destroy() can stop it and
   *  the host can fence a reused engine (see whenQuiet). */
  #search(goArgs) {
    // Pin MultiPV to 1 before EVERY reply search (§2.2: the enemy's own
    // moves are full-strength single-PV searches). The host's hint probe
    // runs MultiPV=n on this same instance and restores 1 when it settles —
    // but a probe that died mid-search never settles, and a reply run under
    // MultiPV=n hands lastScore the WORST line's score. Idempotent otherwise.
    this.engine.setoption('MultiPV', '1');
    this.engine.position({ fen: this.baseFen, moves: this.movesSinceBase });
    const mt = goArgs.match(/movetime (\d+)/);
    // A healthy overrun emits bestmove right after the go() watchdog's `stop`
    // (movetime + 1500 ms); anything still silent past that is a dead pthread,
    // so surface the stall fast — the recovery ladder is the fix, and the
    // player is staring at "the enemy is thinking…" the whole time.
    const timeout = mt ? parseInt(mt[1], 10) + 4000 : 60000;
    const p = this.engine.go(goArgs, { timeout });
    this.activeSearch = p.catch(() => {});
    return p;
  }

  /** Resolves once no search from this duel is in flight. A duel begun on the
   *  same engine before this settles could consume the stale bestmove. */
  whenQuiet() {
    return this.activeSearch ?? Promise.resolve();
  }

  // ---- Phase 1.2: recorded Director tuning ---------------------------------

  /** Live ramp dials: apply a partial Director config NOW and log it on the
   *  duel's ledger (record.tunes), so an exported trace explains itself.
   *  Returns the knobs actually applied (post-guard). */
  tuneDirector(partial) {
    const applied = this.director.tune(partial);
    if (Object.keys(applied).length) this.record.tunes.push(this.#stamp({ ply: this.ply, ...applied }));
    return applied;
  }

  /** Favor of the Gods, recorded. Same semantics as director.setFavor(). */
  setFavor(mult) {
    this.director.setFavor(mult);
    this.record.tunes.push(this.#stamp({ ply: this.ply, favor: this.director.favor }));
  }

  #assertPlaying() {
    if (this.state !== 'playing') throw new Error(`duel is ${this.state}, not playing`);
  }

  async #fail(msg) {
    this.record.error = msg;
    this.state = 'error';
    this.record.states.push(this.#stateNow({ ended: true, error: msg }));
    if (this.hooks.onEnd) await this.hooks.onEnd({ result: null, winner: null, termination: 'error' });
    return { ended: true, error: msg };
  }

  /** Shared post-move pipeline — the harness loop body, verbatim in spirit. */
  async #push(uci, mover) {
    const san = this.board.sanMove(uci);
    const fenBefore = this.board.fen(); // the meter classifies the move against it
    this.board.push(uci);
    this.movesSinceBase.push(uci);
    this.ply++;
    this.record.moves.push(uci);
    this.record.sans.push(san);
    if (this.hooks.onMove) await this.hooks.onMove({ uci, san, mover, ply: this.ply });
    if (this.state !== 'playing') return { ended: true }; // destroyed during an awaited hook

    if (gameEnded(this.board)) {
      await this.#finish();
      return { ended: true };
    }
    // King-capture adjudication (§4.5 filter-miss safety net): a kingless
    // side has lost — instantly, even if its army could still move. (Bare
    // armies need no game-layer check anymore: extinction is in-grammar,
    // so a bared side has zero legal moves and gameEnded caught it above.)
    const kingless = kinglessSide(this.board.fen());
    if (kingless) {
      await this.#finish({ loser: kingless, termination: 'king-capture' });
      return { ended: true };
    }
    if (this.ply >= MAX_PLIES) {
      return this.#fail(`max-plies backstop (${MAX_PLIES}) reached — director config failed to terminate`);
    }

    // --- the trigger (v3): feed both meters BEFORE the quake phase ---------
    // The record meter classifies the move that was just played; staleness
    // reads the position it produced. Neither consults the engine, so this
    // stays a pure function of the ledger and seeded replay is unaffected.
    const fenNow = this.board.fen();
    const moveEv = moveEvents(fenBefore, uci, this.board);
    moveEv.repetition = this.positions.record(fenNow) >= 2;
    const tRoll = now();
    this.director.observePly(this.ffish, this.variantName, fenNow, this.files, this.ranks, moveEv);

    // --- quake phase (between plies, after EVERY completed ply) ---
    // v4.2: roll first; only a due quake pays for the engine's mate probes.
    const roll = this.director.rollQuake(this.ffish, this.variantName, fenNow, this.files, this.ranks, this.ply);
    // The replay log times the phase: the meters + roll, the mate probes,
    // the compositions and the gate probes — a slow quake on the phone
    // splits into what the engine cost and what the Director cost.
    const timing = { roll: Math.round(now() - tRoll), probes: 0, compose: 0, gate: 0, total: 0 };
    let quake = null;
    if (roll.due) {
      const tProbes = now();
      const { hints, probes, before } = await this.#mateHints(fenNow, mover, uci);
      timing.probes = Math.round(now() - tProbes);
      if (this.state !== 'playing') return { ended: true }; // destroyed during the probe
      quake = await this.#composeGated(roll, fenNow, hints, probes, before, timing);
      if (this.state !== 'playing') return { ended: true }; // destroyed during a gate probe
    }
    timing.total = Math.round(now() - tRoll);

    // Duel-layer safety net first, so a veto is stamped on the trace BEFORE
    // anyone renders it.
    let adoptBoard = null;
    const trace = this.director.lastTrace;
    if (trace) {
      trace.timing = timing;
      this.#stamp(trace);
    }
    if (quake) {
      if (this.ffish.validateFen(quake.postFen, this.variantName) !== 1) {
        this.record.anomalies.push(`ply ${this.ply}: quake produced invalid FEN — skipped`);
        if (trace) trace.vetoed = 'invalid-fen'; // duel layer overrode the Director
      } else {
        const next = new this.ffish.Board(this.variantName, quake.postFen);
        if (next.numberLegalMoves() === 0 && !quake.endsGame) {
          next.delete();
          this.record.anomalies.push(`ply ${this.ply}: quake would end game instantly — skipped (director should have caught)`);
          if (trace) trace.vetoed = 'instant-end'; // duel layer overrode the Director
        } else {
          adoptBoard = next;
        }
      }
    }

    // Phase 1.2: the Director traces EVERY roll (null returns included);
    // the record keeps them all — this is the per-ply roll trace the debug
    // overlay renders and the harness will export. Fire-and-forget hook:
    // render-only, so no await and no post-hook state checks needed.
    if (trace) {
      this.record.quakeTraces.push(trace);
      if (this.hooks.onDirectorTrace) {
        try {
          this.hooks.onDirectorTrace(trace);
        } catch {
          // render-only hook — a broken overlay must never break the duel
        }
      }
    }

    if (adoptBoard) {
      this.#adoptPostQuake(adoptBoard, quake.postFen);
      const ev = this.#stamp({ ply: this.ply, displacements: quake.displacements, crumble: quake.crumble, terrain: quake.terrain ?? null, endedGame: quake.endsGame, preFen: fenNow, postFen: quake.postFen, trace });
      this.record.quakes.push(ev);
      if (this.hooks.onQuake) await this.hooks.onQuake(ev);
      if (this.state !== 'playing') return { ended: true };
      if (quake.endsGame) {
        // Terminal crumble: the board had closed (no neutral candidate
        // anywhere) — the collapse immobilizes the side to move, and the
        // floor takes them. Normal mover-loses flow derives the result;
        // termination is named for what did it.
        await this.#finish({ termination: 'earthquake' });
        return { ended: true };
      }
    }
    this.#takeSnapshot();
    return { ended: false };
  }

  // ---- v4.2: the gods' mate probes -----------------------------------------

  /** The engine's mate lines for the board as it stands: the enemy's last
   *  reply search when it is fresh (the quake fires right after its move, so
   *  its PV's first move is the one just played and the rest is the line
   *  from here), plus one probe for the side to move and one, turn flipped,
   *  for the side that just moved ("the trap is set"; skipped when the mover
   *  is in check, where the flip is illegal). Only mate scores are returned.
   *  A probe that fails is logged and ends the probing — the next reply
   *  search's recovery ladder owns a dead engine. */
  async #mateHints(fen, mover, uci) {
    const hints = [];
    const probes = { ran: 0, failed: 0, fresh: 0 }; // for the trace: what was asked, not just what came back
    let before = null; // the to-move probe's score, whatever its type — the eval gate's baseline
    const last = this.lastSearch;
    if (last?.score?.type === 'mate' && last.pv?.length) {
      if (mover === 'engine' && last.pv[0] === uci) {
        // The enemy just played the first move of its own line.
        hints.push({ ...last, source: 'enemy-search' });
        probes.fresh = 1;
      } else if (mover === 'player' && last.pv.length >= 3 && last.pv[1] === uci) {
        // v4.3: the player played the reply the enemy's deep search predicted,
        // so the rest of that line — 22 plies deep on the phone, far past the
        // probe — is the engine's own reading of THIS position, two plies on.
        // Replayed on the current board by mateNets, so a quake in between
        // can only shorten it, never mislead it; the mate is one move nearer.
        const v = last.score.value;
        hints.push({ fen, score: { type: 'mate', value: Math.sign(v) * Math.max(1, Math.abs(v) - 1) }, pv: last.pv.slice(2), source: 'enemy-search-followed' });
        probes.fresh = 1;
      }
    }
    if (!this.mateGo) return { hints, probes, before };
    const targets = [{ fen, side: 'to-move' }];
    if (!this.board.isCheck()) {
      const flipped = flipTurn(fen);
      if (this.ffish.validateFen(flipped, this.variantName) === 1) targets.push({ fen: flipped, side: 'trap' });
    }
    for (const p of targets) {
      let res;
      try {
        res = await this.#probe(p.fen);
      } catch (e) {
        probes.failed++;
        this.record.anomalies.push(`ply ${this.ply}: mate probe (${p.side}) failed (${String(e?.message ?? e).split('\n')[0]}) — the gods act on the grid search alone`);
        break;
      }
      if (this.state !== 'playing') break;
      probes.ran++;
      const score = this.engine.lastScore(res);
      if (p.side === 'to-move' && score) before = score;
      if (score?.type === 'mate') hints.push({ fen: p.fen, score, pv: lastPv(res), source: `probe-${p.side}` });
    }
    return { hints, probes, before };
  }

  /**
   * v4.3 — compose, probe, accept or roll back. Each draw is a fresh seeded
   * composition on the same roll; the board it produces is probed from the
   * same side to move and compared with `before` (tactics.mjs evalSoftens).
   * A rejected draw is rolled back in full (director.restore) and the next
   * one drawn; after `draws` rejections a lone weaken is tried, itself
   * gated; if that softens too, nothing lands and the meter is spent. A
   * missing baseline or a failed probe lets the draw stand — the gate is a
   * guard, not a gate on the gods acting at all.
   */
  async #composeGated(roll, fen, hints, probes, before, timing = null) {
    const gate = this.evalGate && this.mateGo && before ? this.evalGate : null;
    const draws = gate ? Math.max(1, gate.draws | 0) : 1;
    const rejected = [];
    // The replay log: the engine's INPUTS to this quake, verbatim — every
    // mate line handed to the protected set (fen, score, pv, source) and the
    // gate's baseline. The Director's decisions are seeded and replay from
    // the log; the probes that fed them are time-limited and do not, so
    // they are recorded rather than re-run. Set on the roll's trace AND its
    // pristine header, so every attempt's trace carries them.
    const inputs = { hints: hints.map((h) => ({ fen: h.fen, score: h.score, pv: h.pv, source: h.source })), probes, before };
    roll.trace.inputs = inputs;
    if (roll.header) roll.header.inputs = inputs;
    const compose = (opts) => {
      const t0 = now();
      const cand = this.director.quake(this.ffish, this.variantName, fen, this.files, this.ranks, this.ply, opts);
      if (timing) timing.compose += Math.round(now() - t0);
      return cand;
    };
    const judge = async (cand, attempt, extra = {}) => {
      if (!gate || cand.endsGame) {
        cand.trace.evalGate = gate ? { attempt, before, after: null, verdict: 'terminal', rejected: rejected.slice(), ...extra } : null;
        return true;
      }
      let after = null;
      const t0 = now();
      try {
        after = this.engine.lastScore(await this.#probe(cand.postFen));
      } catch (e) {
        this.record.anomalies.push(`ply ${this.ply}: eval-gate probe failed (${String(e?.message ?? e).split('\n')[0]}) — the draw stands unjudged`);
      }
      if (timing) timing.gate += Math.round(now() - t0);
      if (this.state !== 'playing') return false;
      const why = after ? evalSoftens(before, after, gate) : null;
      cand.trace.evalGate = { attempt, before, after, verdict: why ?? (after ? 'ok' : 'unjudged'), rejected: rejected.slice(), ...extra };
      if (!why) return true;
      rejected.push({ attempt, after, verdict: why, chosen: cand.trace.chosen, ...extra });
      // The rejected composition IN FULL — its own trace (rolls, path, census,
      // protected set, chosen edits, its gate verdict) and the board it would
      // have left. The trace of record keeps only the summary above.
      this.record.attempts.push(this.#stamp({ ply: this.ply, attempt, verdict: why, before, after, postFen: cand.postFen, displacements: cand.displacements, terrain: cand.terrain ?? null, crumble: cand.crumble, trace: cand.trace, ...extra }));
      return false;
    };
    for (let attempt = 0; attempt < draws; attempt++) {
      const snap = this.director.snapshot();
      const cand = compose({ rolled: roll, mates: hints, probes, attempt });
      if (!cand) return null; // starved — nothing to gate
      if (await judge(cand, attempt)) return cand;
      if (this.state !== 'playing') return null;
      this.director.restore(snap);
    }
    // Every full draw softened the game: a lone weaken, the one rung that
    // moves nothing, gated once.
    const snap = this.director.snapshot();
    const weak = compose({ rolled: roll, mates: hints, probes, attempt: draws, only: 'weaken' });
    if (weak) {
      if (await judge(weak, draws, { fallback: 'weaken' })) return weak;
      if (this.state !== 'playing') return null;
      this.director.restore(snap);
    }
    this.director.vetoed(this.ply, { before, rejected, draws });
    return null;
  }

  /** One bare-position probe with paired limits, tracked like a reply search
   *  so destroy() and whenQuiet() fence it. The hash is CLEARED first: a
   *  probe run on the transposition table the shallow reply search just
   *  left behind reported +12 on a position a fresh search calls mate in 3
   *  (measured on the v4h corpus — the lab's depth-8 replies misled the
   *  depth-12 probe in one trial of three). Quakes are rare, so the reply
   *  search losing its table once in a while costs nothing visible. */
  #probe(fen) {
    this.engine.send('setoption name Clear Hash');
    this.engine.setoption('MultiPV', '1');
    this.engine.position({ fen });
    const mt = this.mateGo.match(/movetime (\d+)/);
    const p = this.engine.go(this.mateGo, { timeout: mt ? parseInt(mt[1], 10) + 4000 : 30000 });
    this.activeSearch = p.catch(() => {});
    return p;
  }

  // ---- undo (cheat feature) ----------------------------------------------

  /** Full restorable state after a completed pipeline step. The Director's
   *  RNG stream is deliberately NOT restored — after an undo, future quake
   *  rolls differ from the abandoned timeline, which is fine for a cheat
   *  tool (quake determinism matters for harness replays, not take-backs). */
  #takeSnapshot() {
    // The replay log's per-ply state FIRST, so the lens below covers it.
    this.record.states.push(this.#stateNow());
    this.snapshots.push({
      turn: this.board.turn() ? 'w' : 'b',
      fen: this.board.fen(),
      baseFen: this.baseFen,
      moves: [...this.movesSinceBase],
      ply: this.ply,
      debt: this.director.debt,
      // v3 Director state that is NOT recoverable from the FEN: holes read as
      // ordinary '*' to FSF and to any observer, and the meter is a running
      // total over the record. An undo that dropped either would let the gods
      // re-crack a sealed pit or forget how bored they were.
      holes: [...this.director.holes],
      // God-minted crates are ledger state too (the breach bias, and the
      // renderer's cracked-wall tile): an undo that dropped them would paint
      // a weakened wall as an authored crate and lose the gods' +3 on it.
      godCrates: [...this.director.godCrates],
      // v4: the meter carries a heat window now, and the Director a threat
      // ledger (replaced, never mutated — holding the reference is enough).
      meter: this.director.meter.snapshot(),
      ledger: this.director.ledger,
      threats: this.director.snapshotThreats(),
      lens: this.#lens(),
    });
    if (this.snapshots.length > 200) this.snapshots.shift();
  }

  /** Rewind to the most recent earlier state where `colorChar` ('w'|'b') was
   *  on turn. Works from 'ended' too (undo the losing blunder). Returns
   *  whether anything was undone. */
  undoToTurn(colorChar) {
    const last = this.snapshots.length - 1;
    const from = this.state === 'ended' || this.state === 'error' ? last : last - 1;
    for (let i = from; i >= 0; i--) {
      const s = this.snapshots[i];
      if (s.turn === colorChar) {
        this.#restore(s);
        this.snapshots.length = i + 1;
        return true;
      }
    }
    return false;
  }

  #restore(s) {
    // THE BRANCH (replay log, designer 2026-09-06: "we absolutely need a
    // record of the exact board state right before an undo happened"). The
    // tail the undo cuts off is MOVED, not dropped: every per-ply array's
    // slice past the snapshot's lens, plus the state as it stands this
    // instant (the board, the ledgers, the meters, how the game had ended if
    // it had). Branches are never truncated themselves — an undo past an
    // earlier fork keeps that fork's branch; sorting every entry by `seq`
    // recovers the true wall-clock order (which is also the RNG order).
    const branch = this.#stamp({
      fromPly: this.ply,
      toPly: s.ply,
      from: this.#stateNow({ state: this.state, result: this.record.result, winner: this.record.winner, termination: this.record.termination, error: this.record.error }),
      tail: {},
    });
    for (const k of RECORD_ARRAYS) branch.tail[k] = this.record[k].slice(s.lens[k] ?? this.record[k].length);
    this.record.branches.push(branch);
    if (this.board) this.board.delete();
    this.board = new this.ffish.Board(this.variantName, s.fen);
    this.baseFen = s.baseFen;
    this.movesSinceBase = [...s.moves];
    this.ply = s.ply;
    this.director.debt = s.debt;
    this.director.holes = new Set(s.holes ?? []);
    this.director.godCrates = new Set(s.godCrates ?? []);
    if (typeof s.meter === 'number') this.director.meter.restore({ value: s.meter }); // pre-v4 snapshot shape
    else this.director.meter.restore(s.meter);
    this.director.ledger = s.ledger ?? null;
    this.director.restoreThreats(s.threats);
    for (const k of RECORD_ARRAYS) this.record[k].length = s.lens[k] ?? this.record[k].length;
    // record.tunes stays — dial changes are config history, and (like the RNG
    // stream and favor) director config is deliberately NOT rewound by undo.
    // But the rewind itself must be on the ledger: without a marker, an
    // exported record shows tunes dated at plies the truncated traces revisit
    // with the tune already live, and nothing reveals why (or that the RNG
    // stream forked here). The branch above holds the abandoned line itself.
    this.record.tunes.push(this.#stamp({ ply: s.ply, undo: true, fromPly: branch.fromPly, branch: branch.seq }));
    this.record.result = null;
    this.record.winner = null;
    this.record.termination = null;
    this.record.error = null;
    this.state = 'playing';
    // Engine state needs no repair: the next engineMove sends
    // `position fen <baseFen> moves …` from the restored protocol state.
  }

  /** Swap in the post-quake board. The next engine query sends a bare
   *  `position fen <postFen>` (movesSinceBase reset), which also resets the
   *  engine's internal history after surgery (CLAUDE.md rule 9). */
  #adoptPostQuake(next, postFen) {
    this.board.delete();
    this.board = next;
    this.baseFen = postFen;
    this.movesSinceBase = [];
  }

  /** Derive the result: the side to move LOSES (see gameEnded), unless an
   *  adjudication names the loser directly ({ loser, termination }) or just
   *  the termination ({ termination } — loser stays the side to move). */
  async #finish(adjudicated = null) {
    if (adjudicated && adjudicated.loser) {
      this.record.result = adjudicated.loser === 'white' ? '0-1' : '1-0';
      this.record.winner = adjudicated.loser === 'white' ? 'black' : 'white';
      this.record.termination = adjudicated.termination;
      this.state = 'ended';
      this.record.states.push(this.#stateNow({ ended: true, result: this.record.result, termination: this.record.termination }));
      if (this.hooks.onEnd) {
        await this.hooks.onEnd({ result: this.record.result, winner: this.record.winner, termination: this.record.termination });
      }
      return;
    }
    const whiteToMove = this.board.turn();
    this.record.result = whiteToMove ? '0-1' : '1-0';
    this.record.winner = whiteToMove ? 'black' : 'white';
    const fen = this.board.fen();
    const kings = findSquares(fen, (c) => c === 'K' || c === 'k').map((s) => s.cell);
    const loser = whiteToMove ? 'white' : 'black';
    if (adjudicated?.termination) {
      this.record.termination = adjudicated.termination; // e.g. 'earthquake' — loser is still the mover
    } else if (!kings.includes('K') || !kings.includes('k')) {
      this.record.termination = 'king-capture';
    } else if (this.board.isCheck()) {
      this.record.termination = 'checkmate';
    } else if (nonKingCounts(fen)[loser] === 0) {
      this.record.termination = 'army-extinct'; // in-grammar extinction (types=*, count=1)
    } else {
      this.record.termination = 'stalemate'; // the floor gives way (§4.4)
    }
    this.state = 'ended';
    // The final position is a state too (no undo snapshot — the losing move
    // is undone from the snapshot before it), so the log ends on the board
    // the game ended on.
    this.record.states.push(this.#stateNow({ ended: true, result: this.record.result, termination: this.record.termination }));
    if (this.hooks.onEnd) {
      await this.hooks.onEnd({ result: this.record.result, winner: this.record.winner, termination: this.record.termination });
    }
  }

  destroy() {
    if (this.activeSearch) {
      try {
        this.engine.send('stop'); // flush any in-flight search's bestmove
      } catch {
        /* engine already dead */
      }
    }
    if (this.board) {
      this.board.delete();
      this.board = null;
    }
    this.state = 'idle';
  }
}
