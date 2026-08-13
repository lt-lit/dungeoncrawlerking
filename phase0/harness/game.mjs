// One engine-vs-engine duel with the crumble system (brief §4.5, §7).
//
// The ffish Board is the source of truth for legality and game end; the
// engine is queried per ply with `position fen <base> moves <since-base>` so
// its repetition history matches the harness's (history resets on crumble).
import { CrumbleController, applyCrumble, validateCrumbleCandidate } from './crumble.mjs';
import { findSquares } from '../lib/fen.mjs';

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
 *   crumble: { onsetPly, cadence },   // omit/cadence 0 to disable pacing
 *   seed,
 *   evalDeadband: 50,                 // cp band treated as "equal" for flip detection
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
    crumbles: [],
    anomalies: [],
    result: null,
    winner: null,
    plies: 0,
    error: null,
  };

  const crumbler = new CrumbleController({
    onsetPly: opts.crumble?.onsetPly ?? Infinity,
    cadence: opts.crumble?.cadence ?? 0,
    seed: opts.seed,
  });

  let board = new ffish.Board(variantName, startFen);
  let baseFen = startFen;
  let movesSinceBase = [];
  let lastEval = null;
  let pendingCrumbleEval = null; // crumble event awaiting its evalAfter

  engine.send('ucinewgame');
  await engine.isready();

  try {
    crumbler.recordPosition(board.fen());
    let ply = 0;
    while (ply < opts.maxPlies) {
      if (board.isGameOver()) break;

      const whiteToMove = board.turn();
      engine.position({ fen: baseFen, moves: movesSinceBase });
      const res = await engine.go(opts.go);
      const score = engine.lastScore(res);
      const evalWhite = whitePovScore(score, whiteToMove);
      record.evals.push(evalWhite);
      if (pendingCrumbleEval) {
        pendingCrumbleEval.evalAfter = evalWhite;
        pendingCrumbleEval = null;
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

      if (board.isGameOver()) break;

      // --- crumble phase (between plies) ---
      const fenNow = board.fen();
      const occurrences = crumbler.recordPosition(fenNow);

      let crumbleEvent = null;
      const rep = crumbler.repetitionCrumble(occurrences, res.bestmove);
      if (rep) {
        crumbleEvent = rep;
      } else if (crumbler.pacingCrumbleDue(ply)) {
        // Re-roll random candidates through the §4.5 legality filter.
        for (let tries = 0; tries < 60; tries++) {
          const sq = crumbler.randomSquare(files, ranks);
          const cell = findSquares(fenNow, (c, f, r) => `${String.fromCharCode(97 + f)}${r + 1}` === sq)[0]?.cell;
          if (cell === '*') continue; // already a pit
          const v = validateCrumbleCandidate(ffish, variantName, fenNow, sq);
          if (v.ok) {
            crumbleEvent = { type: 'pacing', square: sq, rerolls: tries };
            break;
          }
        }
        crumbler.markPacingFired(ply); // fired or exhausted — don't retry every ply
        if (!crumbleEvent) record.anomalies.push(`ply ${ply}: pacing crumble found no legal candidate in 60 rolls`);
      }

      if (crumbleEvent) {
        const { postFen, pieceLost } = applyCrumble(fenNow, crumbleEvent.square);
        if (ffish.validateFen(postFen, variantName) < 0) {
          record.anomalies.push(`ply ${ply}: crumble ${crumbleEvent.type}@${crumbleEvent.square} produced invalid FEN — skipped`);
        } else {
          const next = new ffish.Board(variantName, postFen);
          if (next.legalMoves().trim() === '' || next.isGameOver()) {
            // Repetition crumbles are deterministic and may legitimately end
            // things via stalemate-as-loss; record it and let the result stand.
            if (crumbleEvent.type === 'repetition') {
              board.delete();
              board = next;
              baseFen = postFen;
              movesSinceBase = [];
              crumbler.resetHistory();
              crumbler.recordPosition(postFen);
              const ev = { ply, ...crumbleEvent, pieceLost, evalBefore: lastEval, evalAfter: null, endedGame: true };
              record.crumbles.push(ev);
              break;
            }
            next.delete();
            record.anomalies.push(`ply ${ply}: crumble would end game instantly — skipped (filter should have caught)`);
          } else {
            board.delete();
            board = next;
            baseFen = postFen;
            movesSinceBase = [];
            crumbler.resetHistory();
            crumbler.recordPosition(postFen);
            const ev = { ply, ...crumbleEvent, pieceLost, evalBefore: lastEval, evalAfter: null };
            record.crumbles.push(ev);
            pendingCrumbleEval = ev;
          }
        }
      }
    }

    if (record.error) {
      // engine/ffish desync — already recorded
    } else if (board.isGameOver()) {
      record.result = board.result();
      record.winner = record.result === '1-0' ? 'white' : record.result === '0-1' ? 'black' : record.result;
      if (record.result === '1/2-1/2') {
        record.anomalies.push('DRAW RESULT under no-draw config — investigate');
      }
    } else {
      record.error = `max-plies (${opts.maxPlies}) reached without termination`;
    }

    // Crumble alarm metric input (§7): did any crumble flip the eval sign?
    const db = opts.evalDeadband ?? 50;
    record.crumbleFlips = record.crumbles.filter(
      (c) =>
        c.evalBefore !== null &&
        c.evalAfter !== null &&
        sign(c.evalBefore, db) !== 0 &&
        sign(c.evalAfter, db) !== 0 &&
        sign(c.evalBefore, db) !== sign(c.evalAfter, db)
    ).length;
  } finally {
    board.delete();
  }
  return record;
}
