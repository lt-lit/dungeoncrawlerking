// One engine-vs-engine duel driven by the SHIPPED Board State Director
// (Earthquakes — brief §4.5, §7).
//
// This is a structural mirror of play/js/duel.mjs's pipeline: same Director,
// same guards, same post-quake protocol reset. It used to run the retired
// crumble system (repetition tracking + fixed-cadence pacing), which meant
// every §7 sweep and every encounter-linter ply count described rules the game
// no longer had. Nothing here may diverge from duel.mjs without a reason
// written down.
//
// The ffish Board is the source of truth for legality and game end; the engine
// is queried per ply with `position fen <base> moves <since-base>`, and a bare
// `position fen <postFen>` after every quake resets its history following
// position surgery (CLAUDE.md rule 9).
//
// Repetition is NOT punished (Director design): no position tracking, no
// repetition crumble. Termination rests on crumbles alone — free squares only
// ever shrink, and the debt cap guarantees they keep landing.
import { Director, DIRECTOR_DEFAULTS, lockedPawns } from '../../play/js/director.mjs';

/**
 * Game-end check per spike 11: numberLegalMoves()===0 is the primary end
 * condition (checkmate or stalemate — both decisive under stalemateValue=loss).
 * ffish's isGameOver()/result() draw-adjudicate bare-kings insufficient
 * material even under the no-draw config, so they must not drive the loop.
 */
function gameEnded(board) {
  return board.numberLegalMoves() === 0;
}

/** Non-king piece counts per color from a FEN's board field. */
export function nonKingCounts(fen) {
  const counts = { white: 0, black: 0 };
  for (const ch of fen.split(' ')[0]) {
    if (/[A-Z]/.test(ch) && ch !== 'K') counts.white++;
    else if (/[a-z]/.test(ch) && ch !== 'k') counts.black++;
  }
  return counts;
}

/** 'white'|'black' if exactly that side is down to a bare king, else null. */
function bareSide(fen) {
  const { white, black } = nonKingCounts(fen);
  if (white === 0 && black > 0) return 'white';
  if (black === 0 && white > 0) return 'black';
  return null; // both armed — or both bare, which the crumble guard prevents
}

const MATE_SENTINEL = 100000;

/** Normalize an engine score ({type, value}, mover POV) to a white-POV number. */
export function whitePovScore(score, whiteToMove) {
  if (!score) return null;
  let v;
  if (score.type === 'mate') {
    v = score.value > 0 ? MATE_SENTINEL - score.value : -MATE_SENTINEL - score.value;
  } else {
    v = score.value;
  }
  return whiteToMove ? v : -v;
}

const sign = (v, deadband) => (v > deadband ? 1 : v < -deadband ? -1 : 0);

/**
 * Play one duel to completion.
 * opts = {
 *   go: 'movetime 120' | 'depth 6',
 *   maxPlies: 400,
 *   director: { onsetPly, quakeRamp, crumbleRamp, debtCap,
 *               asymOnsetPly, asymRamp },  // DIRECTOR_DEFAULTS if omitted;
 *                                          // onsetPly: Infinity silences the gods
 *   seed,
 *   evalDeadband: 50,                 // cp band treated as "equal" for flip detection
 *   bareKingLoses: false,             // harness adjudication: a side stripped to a
 *                                     // bare king loses immediately. Belt-and-braces:
 *                                     // the duel baseline carries the extinction
 *                                     // quartet, so this is normally caught in
 *                                     // grammar by numberLegalMoves()===0 first.
 * }
 * Returns a game record (JSON-serializable).
 */
export async function playGame({ engine, ffish, arena, opts }) {
  const { variantName, startFen, files, ranks } = arena;
  const record = {
    arena: arena.meta,
    variantName,
    startFen,
    seed: opts.seed,
    go: opts.go,
    moves: [],
    evals: [],
    quakes: [],
    anomalies: [],
    result: null,
    winner: null,
    plies: 0,
    error: null,
  };

  const director = new Director({ ...DIRECTOR_DEFAULTS, ...(opts.director ?? {}), seed: opts.seed });

  let board = new ffish.Board(variantName, startFen);
  let baseFen = startFen;
  let movesSinceBase = [];
  let lastEval = null;
  let pendingQuakeEval = null; // quake event awaiting its evalAfter

  // §7 "locked-pawn trajectory": the Director's actual job, measured directly.
  // Displacement is the ONLY mechanic that can free a terrain-locked pawn
  // (a crumble measured 0 for 7073), so start-vs-end is the honest scoreboard.
  record.lockedPawnsStart = lockedPawns(startFen, files, ranks).length;

  engine.send('ucinewgame');
  await engine.isready();

  try {
    let ply = 0;
    while (ply < opts.maxPlies) {
      if (gameEnded(board)) break;

      const whiteToMove = board.turn();
      engine.position({ fen: baseFen, moves: movesSinceBase });
      const res = await engine.go(opts.go);
      const score = engine.lastScore(res);
      const evalWhite = whitePovScore(score, whiteToMove);
      record.evals.push(evalWhite);
      if (pendingQuakeEval) {
        pendingQuakeEval.evalAfter = evalWhite;
        pendingQuakeEval = null;
      }

      if (!res.bestmove || res.bestmove === '(none)') {
        record.anomalies.push(`ply ${ply}: engine returned no move but ffish says game not over`);
        break;
      }
      const legal = board.legalMoves().trim().split(/\s+/).filter(Boolean);
      if (!legal.includes(res.bestmove)) {
        record.error = `ply ${ply}: engine move ${res.bestmove} illegal per ffish (desync)`;
        break;
      }
      board.push(res.bestmove);
      movesSinceBase.push(res.bestmove);
      record.moves.push(res.bestmove);
      ply++;
      record.plies = ply;
      lastEval = evalWhite;

      if (gameEnded(board)) break;

      // King-capture adjudication (unconditional): a kingless side has lost.
      // Probed: ffish only self-terminates a capture that leaves the victim
      // with nothing; with material remaining the kingless side keeps
      // generating moves and can never be mated.
      {
        const bf = board.fen().split(' ')[0];
        const kingless = !bf.includes('K') && bf.includes('k') ? 'white' : !bf.includes('k') && bf.includes('K') ? 'black' : null;
        if (kingless) {
          record.result = kingless === 'white' ? '0-1' : '1-0';
          record.winner = kingless === 'white' ? 'black' : 'white';
          record.termination = 'king-capture';
          break;
        }
      }

      // Bare-army adjudication (after the mover-loses check so a mating
      // capture still records as checkmate): the stripped side loses now
      // instead of being king-chased to the inevitable no-draw end.
      if (opts.bareKingLoses) {
        const bare = bareSide(board.fen());
        if (bare) {
          record.result = bare === 'white' ? '0-1' : '1-0';
          record.winner = bare === 'white' ? 'black' : 'white';
          record.termination = 'bare-king';
          break;
        }
      }

      // --- quake phase (between plies, after EVERY completed ply) ---
      // Structural mirror of duel.mjs. The Director owns candidate
      // enumeration, the symmetric-displacement pairing, landing safety and
      // the terminal-crumble path; the harness only applies the result.
      const fenNow = board.fen();
      const quake = director.quake(ffish, variantName, fenNow, files, ranks, ply);

      if (quake) {
        if (ffish.validateFen(quake.postFen, variantName) !== 1) {
          record.anomalies.push(`ply ${ply}: quake produced invalid FEN — skipped`);
        } else {
          const next = new ffish.Board(variantName, quake.postFen);
          if (next.numberLegalMoves() === 0 && !quake.endsGame) {
            next.delete();
            record.anomalies.push(`ply ${ply}: quake would end game instantly — skipped (director should have caught)`);
          } else {
            board.delete();
            board = next;
            baseFen = quake.postFen; // bare `position fen` next ply (rule 9)
            movesSinceBase = [];
            const ev = {
              ply,
              displacements: quake.displacements,
              crumble: quake.crumble,
              pieceLost: quake.crumble?.pieceLost ?? null,
              endedGame: !!quake.endsGame,
              evalBefore: lastEval,
              evalAfter: null,
            };
            record.quakes.push(ev);
            if (quake.endsGame) {
              // Terminal crumble: the board had already closed (no neutral
              // candidate anywhere). The collapse immobilizes the side to
              // move; the normal mover-loses flow below derives the result,
              // and the termination is named for what did it.
              record.terminalQuake = true;
              break;
            }
            pendingQuakeEval = ev;
          }
        }
      }
    }

    if (record.error) {
      // engine/ffish desync — already recorded
    } else if (record.result) {
      // bare-king adjudication already recorded result/winner/termination
    } else if (gameEnded(board)) {
      // Under the duel config, numberLegalMoves()===0 always means the side
      // to move LOSES: checkmate (mover mated), stalemate (stalemateValue=
      // loss — the floor gives way), and post-king-capture states (mover has
      // no king) all reduce to mover-loses. Derive the result directly —
      // ffish's result(false) reports "1/2-1/2" for bare-kings stalemates
      // because its insufficient-material adjudication masks the variant's
      // stalemate rule.
      const whiteToMove = board.turn();
      record.result = whiteToMove ? '0-1' : '1-0';
      record.winner = whiteToMove ? 'black' : 'white';
      const endFen = board.fen().split(' ')[0];
      const loser = whiteToMove ? 'white' : 'black';
      record.termination = record.terminalQuake
        ? 'earthquake' // the floor closed on the side to move (§4.5 terminal crumble)
        : !endFen.includes('K') || !endFen.includes('k')
          ? 'king-capture'
          : board.isCheck()
            ? 'checkmate'
            : nonKingCounts(board.fen())[loser] === 0
              ? 'bare-king' // in-grammar extinction: army stripped, game over
              : 'stalemate';
      record.ffishResult = board.result(false);
      if (record.ffishResult !== record.result && record.ffishResult !== '1/2-1/2') {
        record.anomalies.push(`ffish result(false)="${record.ffishResult}" disagrees with derived "${record.result}"`);
      }
    } else {
      record.error = `max-plies (${opts.maxPlies}) reached without termination`;
    }

    // Quake alarm metric input (§7): did any quake flip the eval sign? This is
    // the Director's central risk — a "symmetric" stir that hands the game to
    // one side. Measured per quake, not per crumble, because displacement is
    // now the common case.
    const db = opts.evalDeadband ?? 50;
    record.quakeFlips = record.quakes.filter(
      (q) =>
        q.evalBefore !== null &&
        q.evalAfter !== null &&
        sign(q.evalBefore, db) !== 0 &&
        sign(q.evalAfter, db) !== 0 &&
        sign(q.evalBefore, db) !== sign(q.evalAfter, db)
    ).length;
    record.displacementCount = record.quakes.reduce((n, q) => n + (q.displacements?.length ?? 0), 0);
    record.crumbleCount = record.quakes.filter((q) => q.crumble).length;
    record.piecesLostToCrumbles = record.quakes.filter((q) => q.pieceLost).length;
    // One-sided stirs: the patience ramp lets these through late, and they are
    // exactly what the symmetric-preference exists to avoid early.
    record.oneSidedQuakes = record.quakes.filter((q) => (q.displacements?.length ?? 0) === 1).length;
    record.lockedPawnsEnd = lockedPawns(board.fen(), files, ranks).length;
  } finally {
    board.delete();
  }
  return record;
}
