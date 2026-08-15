// Live human-vs-engine duel controller with the Board State Director
// (Earthquakes — the crumble system's successor; see director.mjs).
//
// Structural port of phase0/harness/game.mjs (the reference implementation of
// the whole loop) with the synchronous engine-vs-engine loop split into
// driver-called steps: main.mjs calls playerMove()/engineMove() depending on
// whose seat is on turn; the post-move pipeline (game-end check + quake
// phase) mirrors the harness's.
//
// Repetition is NOT punished (Director design): no position tracking, no
// repetition crumble. Termination rests on the Director's crumbles (debt cap
// guarantees they keep landing) + stalemate-as-loss.
//
// The ffish Board is the source of truth for legality and game end; the
// engine is queried per ply with `position fen <base> moves <since-base>`,
// and a bare `position fen` after every quake resets engine repetition
// history (spike 10/11, CLAUDE.md rule 9) — load-bearing here, since with
// no repetition rules a stale engine history could never adjudicate anyway,
// but the reset also clears TT-adjacent state after surgery.
import { Director } from './director.mjs';
import { findSquares } from './fen.mjs';

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

// Backstop only: the Director guarantees termination (debt-capped crumbles
// shrink the board monotonically); a duel that reaches this many plies is a
// bug, not a long game.
const MAX_PLIES = 1000;

export class DuelController {
  /**
   * opts = {
   *   ffish, engine,                       // initialized modules (catalog loaded)
   *   variantName, startFen, files, ranks,
   *   director: { onsetPly, quakeRamp, crumbleRamp, debtCap,
   *               asymOnsetPly, asymRamp, seed },   // see DIRECTOR_DEFAULTS
   *   go: 'depth 22 movetime 500',         // paired limits (CLAUDE.md rule 5; 22 is a WASM-stability cap, see main.mjs)
   *   hooks: {                             // all optional, awaited where async matters
   *     onMove({ uci, san, mover, ply }),
   *     onQuake({ displacements, crumble, endedGame, postFen }),  // awaited (UI animates)
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
    this.go = opts.go ?? 'depth 22 movetime 500';
    this.hooks = opts.hooks ?? {};
    this.director = new Director(opts.director ?? {});
    this.board = null;
    this.baseFen = opts.startFen;
    this.movesSinceBase = [];
    this.ply = 0;
    this.state = 'idle'; // idle | playing | ended | error
    this.record = { moves: [], sans: [], quakes: [], anomalies: [], result: null, winner: null, termination: null, error: null };
    this.snapshots = []; // undo support (cheat feature) — one per playable state
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

    // --- quake phase (between plies, after EVERY completed ply) ---
    const fenNow = this.board.fen();
    const quake = this.director.quake(this.ffish, this.variantName, fenNow, this.files, this.ranks, this.ply);

    if (quake) {
      if (this.ffish.validateFen(quake.postFen, this.variantName) !== 1) {
        this.record.anomalies.push(`ply ${this.ply}: quake produced invalid FEN — skipped`);
      } else {
        const next = new this.ffish.Board(this.variantName, quake.postFen);
        if (next.numberLegalMoves() === 0 && !quake.endsGame) {
          next.delete();
          this.record.anomalies.push(`ply ${this.ply}: quake would end game instantly — skipped (director should have caught)`);
        } else {
          this.#adoptPostQuake(next, quake.postFen);
          const ev = { ply: this.ply, displacements: quake.displacements, crumble: quake.crumble, endedGame: quake.endsGame, postFen: quake.postFen };
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
      }
    }
    this.#takeSnapshot();
    return { ended: false };
  }

  // ---- undo (cheat feature) ----------------------------------------------

  /** Full restorable state after a completed pipeline step. The Director's
   *  RNG stream is deliberately NOT restored — after an undo, future quake
   *  rolls differ from the abandoned timeline, which is fine for a cheat
   *  tool (quake determinism matters for harness replays, not take-backs). */
  #takeSnapshot() {
    this.snapshots.push({
      turn: this.board.turn() ? 'w' : 'b',
      fen: this.board.fen(),
      baseFen: this.baseFen,
      moves: [...this.movesSinceBase],
      ply: this.ply,
      debt: this.director.debt,
      lens: {
        moves: this.record.moves.length,
        quakes: this.record.quakes.length,
        anomalies: this.record.anomalies.length,
      },
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
    if (this.board) this.board.delete();
    this.board = new this.ffish.Board(this.variantName, s.fen);
    this.baseFen = s.baseFen;
    this.movesSinceBase = [...s.moves];
    this.ply = s.ply;
    this.director.debt = s.debt;
    this.record.moves.length = s.lens.moves;
    this.record.sans.length = s.lens.moves;
    this.record.quakes.length = s.lens.quakes;
    this.record.anomalies.length = s.lens.anomalies;
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
