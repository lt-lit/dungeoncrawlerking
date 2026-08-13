// Live human-vs-engine duel controller with the crumble system (brief §4.5).
//
// Structural port of phase0/harness/game.mjs (the reference implementation of
// the whole loop) with the synchronous engine-vs-engine loop split into
// driver-called steps: main.mjs calls playerMove()/engineMove() depending on
// whose seat is on turn; the post-move pipeline (game-end check + crumble
// phase) is identical to the harness's.
//
// The ffish Board is the source of truth for legality and game end; the
// engine is queried per ply with `position fen <base> moves <since-base>` so
// its repetition history matches ours — a bare `position fen` after every
// crumble resets engine repetition history (spike 10/11, CLAUDE.md rule 9).
import { CrumbleController, applyCrumble } from './crumble.mjs';
import { validateCrumbleCandidate } from './crumbleFilter.mjs';
import { findSquares, getSquare } from './fen.mjs';

/**
 * Game-end check per spike 11: numberLegalMoves()===0 is the ONLY end
 * condition, and the side to move LOSES (checkmate, stalemate-as-loss and
 * post-king-capture states all reduce to mover-loses under the duel config).
 * ffish's isGameOver()/result() draw-adjudicate bare-kings insufficient
 * material even under the no-draw config, so they must not drive the loop.
 */
function gameEnded(board) {
  return board.numberLegalMoves() === 0;
}

// Backstop only: the crumble system guarantees termination (§4.5); a duel
// that reaches this many plies is a bug, not a long game.
const MAX_PLIES = 1000;

export class DuelController {
  /**
   * opts = {
   *   ffish, engine,                       // initialized modules (catalog loaded)
   *   variantName, startFen, files, ranks,
   *   crumble: { onsetPly, cadence, seed },
   *   go: 'depth 60 movetime 500',         // paired limits (CLAUDE.md rule 5)
   *   hooks: {                             // all optional, awaited where async matters
   *     onMove({ uci, san, mover, ply }),
   *     onCrumble({ square, type, pieceLost, endedGame, postFen }),  // awaited (UI animates)
   *     onEnd({ result, winner, termination }),
   *     onEngineInfo({ score, depth }),
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
    this.go = opts.go ?? 'depth 60 movetime 500';
    this.hooks = opts.hooks ?? {};
    this.crumbler = new CrumbleController({
      onsetPly: opts.crumble?.onsetPly ?? Infinity,
      cadence: opts.crumble?.cadence ?? 0,
      seed: opts.crumble?.seed ?? 1,
    });
    this.board = null;
    this.baseFen = opts.startFen;
    this.movesSinceBase = [];
    this.ply = 0;
    this.state = 'idle'; // idle | playing | ended | error
    this.record = { moves: [], sans: [], crumbles: [], anomalies: [], result: null, winner: null, termination: null, error: null };
  }

  /** Register the variant + start position with both libraries. */
  async start() {
    this.board = new this.ffish.Board(this.variantName, this.startFen);
    this.engine.send('ucinewgame');
    this.engine.setoption('UCI_Variant', this.variantName);
    await this.engine.isready();
    this.crumbler.recordPosition(this.board.fen());
    this.state = 'playing';
    if (gameEnded(this.board)) {
      // Arena validation should make this impossible; degrade gracefully.
      await this.#finish();
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
    if (score && this.hooks.onEngineInfo) {
      const depth = res.infoLines.length ? (res.infoLines[res.infoLines.length - 1].match(/depth (\d+)/) ?? [])[1] : null;
      this.hooks.onEngineInfo({ score, depth: depth ? parseInt(depth, 10) : null });
    }
    return this.#push(res.bestmove, 'engine');
  }

  /** One search with paired limits and a tight per-move UCI timeout, so a
   *  dead engine surfaces in seconds (the go() watchdog still fires first
   *  in the recoverable overrun case). Tracked so destroy() can stop it and
   *  the host can fence a reused engine (see whenQuiet). */
  #search(goArgs) {
    this.engine.position({ fen: this.baseFen, moves: this.movesSinceBase });
    const mt = goArgs.match(/movetime (\d+)/);
    const timeout = mt ? parseInt(mt[1], 10) * 2 + 8000 : 60000;
    const p = this.engine.go(goArgs, { timeout });
    this.activeSearch = p.catch(() => {});
    return p;
  }

  /** Resolves once no search from this duel is in flight. A duel begun on the
   *  same engine before this settles could consume the stale bestmove. */
  whenQuiet() {
    return this.activeSearch ?? Promise.resolve();
  }

  #assertPlaying() {
    if (this.state !== 'playing') throw new Error(`duel is ${this.state}, not playing`);
  }

  async #fail(msg) {
    this.record.error = msg;
    this.state = 'error';
    if (this.hooks.onEnd) await this.hooks.onEnd({ result: null, winner: null, termination: 'error' });
    return { ended: true, error: msg };
  }

  /** Shared post-move pipeline — the harness loop body, verbatim in spirit. */
  async #push(uci, mover) {
    const san = this.board.sanMove(uci);
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
    if (this.ply >= MAX_PLIES) {
      return this.#fail(`max-plies backstop (${MAX_PLIES}) reached — crumble config failed to terminate`);
    }

    // --- crumble phase (between plies, after EVERY completed ply) ---
    const fenNow = this.board.fen();
    const occurrences = this.crumbler.recordPosition(fenNow);

    let crumbleEvent = null;
    const rep = this.crumbler.repetitionCrumble(occurrences, uci);
    if (rep) {
      crumbleEvent = rep;
    } else if (this.crumbler.pacingCrumbleDue(this.ply)) {
      // Re-roll random candidates through the §4.5 legality filter.
      for (let tries = 0; tries < 60; tries++) {
        const sq = this.crumbler.randomSquare(this.files, this.ranks);
        if (getSquare(fenNow, sq) === '*') continue; // already a pit
        const v = validateCrumbleCandidate(this.ffish, this.variantName, fenNow, sq);
        if (v.ok) {
          crumbleEvent = { type: 'pacing', square: sq, rerolls: tries };
          break;
        }
      }
      this.crumbler.markPacingFired(this.ply); // fired or exhausted — don't retry every ply
      if (!crumbleEvent) this.record.anomalies.push(`ply ${this.ply}: pacing crumble found no legal candidate in 60 rolls`);
    }

    if (crumbleEvent) {
      const { postFen, pieceLost } = applyCrumble(fenNow, crumbleEvent.square);
      if (this.ffish.validateFen(postFen, this.variantName) < 0) {
        this.record.anomalies.push(`ply ${this.ply}: crumble ${crumbleEvent.type}@${crumbleEvent.square} produced invalid FEN — skipped`);
      } else {
        const next = new this.ffish.Board(this.variantName, postFen);
        if (next.numberLegalMoves() === 0) {
          if (crumbleEvent.type === 'repetition') {
            // Repetition crumbles are deterministic and may legitimately end
            // things via stalemate-as-loss (§4.5 termination guarantee).
            this.#adoptPostCrumble(next, postFen);
            const ev = { ply: this.ply, ...crumbleEvent, pieceLost, endedGame: true, postFen };
            this.record.crumbles.push(ev);
            if (this.hooks.onCrumble) await this.hooks.onCrumble(ev);
            if (this.state !== 'playing') return { ended: true };
            await this.#finish();
            return { ended: true };
          }
          next.delete();
          this.record.anomalies.push(`ply ${this.ply}: crumble would end game instantly — skipped (filter should have caught)`);
        } else {
          this.#adoptPostCrumble(next, postFen);
          const ev = { ply: this.ply, ...crumbleEvent, pieceLost, endedGame: false, postFen };
          this.record.crumbles.push(ev);
          if (this.hooks.onCrumble) await this.hooks.onCrumble(ev);
          if (this.state !== 'playing') return { ended: true };
        }
      }
    }
    return { ended: false };
  }

  /** Swap in the post-crumble board and reset both repetition histories
   *  (ours via resetHistory, the engine's via the next bare `position fen`). */
  #adoptPostCrumble(next, postFen) {
    this.board.delete();
    this.board = next;
    this.baseFen = postFen;
    this.movesSinceBase = [];
    this.crumbler.resetHistory();
    this.crumbler.recordPosition(postFen);
  }

  /** Derive the result directly: the side to move LOSES (see gameEnded). */
  async #finish() {
    const whiteToMove = this.board.turn();
    this.record.result = whiteToMove ? '0-1' : '1-0';
    this.record.winner = whiteToMove ? 'black' : 'white';
    const fen = this.board.fen();
    const kings = findSquares(fen, (c) => c === 'K' || c === 'k').map((s) => s.cell);
    if (!kings.includes('K') || !kings.includes('k')) {
      this.record.termination = 'king-capture';
    } else if (this.board.isCheck()) {
      this.record.termination = 'checkmate';
    } else {
      this.record.termination = 'stalemate'; // the floor gives way (§4.4)
    }
    this.state = 'ended';
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
