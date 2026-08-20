// Browser infra selftest for the duel slice. Ports every check from
// phase0/lib/selftest.mjs (FEN round-trip, wall setSquare, validateFen,
// ffish-vs-engine perft-1 legality cross-check, engine bestmove legality) and
// adds the Phase 1 boot-path checks: the full 50-variant catalog loaded ONCE
// into BOTH libraries (variant names are single-use — rule 7), the §4.5
// crumble filter, and the game-end protocol (rule 4: numberLegalMoves()===0
// and the mover loses — never ffish isGameOver()/result()).
//
// Renders one PASS/FAIL line per check into #out, then sets
// window.__SELFTEST = { done, passed, failed, lines } (done set LAST) so a
// headless driver can poll for completion.
import { createEngine, getFfish } from './engine.mjs';
import { makeCatalogIni, catalogVariantName, buildDuelBoard, boardToFen } from './variant.mjs';
import { splitFen, parseBoard, serializeBoard, setSquare, getSquare } from './fen.mjs';
import { validateCrumbleCandidate } from './crumbleFilter.mjs';
import { fenGrid, Director, displacementCandidates, crumbleCandidates, lockedPawns } from './director.mjs';
import { captureLoss } from './threat.mjs';

const out = document.getElementById('out');
const summaryEl = document.getElementById('summary');
const lines = [];
let passed = 0;
let failed = 0;

function report(ok, label, detail) {
  const text = `${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`;
  lines.push(text);
  const div = document.createElement('div');
  div.className = `line ${ok ? 'pass' : 'fail'}`;
  div.textContent = text;
  out.appendChild(div);
  if (ok) passed++;
  else failed++;
}

/** Run one check; fn returns a detail string on success, throws on failure. */
async function check(label, fn) {
  try {
    report(true, label, await fn());
  } catch (e) {
    report(false, label, e && e.message ? e.message : String(e));
  }
}

function finish(note) {
  summaryEl.textContent = `${passed} passed, ${failed} failed${note ? ` (${note})` : failed === 0 ? ' — ALL SELF-TESTS PASSED' : ''}`;
  summaryEl.className = failed === 0 && !note ? 'pass' : 'fail';
  const summary = { passed, failed, lines };
  window.__SELFTEST = summary;
  summary.done = true; // set LAST — headless drivers poll window.__SELFTEST.done
}

async function main() {
  summaryEl.textContent = 'loading ffish + engine…';
  let ffish = null;
  let engine = null;

  await check('module init (ffish + engine)', async () => {
    [ffish, engine] = await Promise.all([getFfish(), createEngine()]);
    return 'both WASM modules initialized';
  });

  // --- FEN round-trip (phase0 selftest) ---
  const fens = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'n*nnnn*k/**pppp**/pp4pp/8/8/PP4PP/**PPPP**/K*NNNN*N w - - 0 1',
    'rnbqkbnr4/pppppppp4/12/12/12/12/PPPPPPPP4/RNBQKBNR4/12/12 w kq - 0 1',
  ];
  await check('fen round-trip', async () => {
    for (const fen of fens) {
      const f = splitFen(fen);
      const rt = serializeBoard(parseBoard(f.board));
      if (rt !== f.board) throw new Error(`round-trip failed: ${f.board} → ${rt}`);
    }
    return `${fens.length} FENs`;
  });

  await check('setSquare wall', async () => {
    const wallFen = setSquare(fens[0], 'e4', '*');
    if (getSquare(wallFen, 'e4') !== '*') throw new Error('setSquare/getSquare disagree on e4');
    return wallFen.split(' ')[0];
  });

  // --- Full 50-variant catalog into BOTH libraries (rule 7: load once at boot) ---
  const catalogIni = makeCatalogIni();
  await check('catalog load (ffish)', async () => {
    const blocks = (catalogIni.match(/^\[duel_/gm) || []).length;
    if (blocks !== 50) throw new Error(`expected 50 catalog variants in ini, got ${blocks}`);
    ffish.loadVariantConfig(catalogIni);
    return '50 variants registered';
  });
  await check('catalog load (engine)', async () => {
    await engine.loadVariantsIni(catalogIni); // the FULL catalog text, same as boot
    return '50 variants written to /variants.ini, readyok';
  });

  // --- Catalog extremes: smallest and largest boards construct and move ---
  const extremeSpecs = [
    {
      files: 3, ranks: 6, walls: [],
      white: { backRank: ['R', 'K', 'N'], backRankStart: 0, row: 0 },
      black: { backRank: ['r', 'k', 'n'], backRankStart: 0, row: 5 },
    },
    {
      files: 12, ranks: 10, walls: [],
      white: { backRank: ['R', 'N', 'K', 'B', 'Q'], backRankStart: 3, row: 0 },
      black: { backRank: ['r', 'n', 'k', 'b', 'q'], backRankStart: 3, row: 9 },
    },
  ];
  for (const spec of extremeSpecs) {
    const name = catalogVariantName(spec.files, spec.ranks);
    await check(`catalog board (${name})`, async () => {
      const fen = boardToFen(buildDuelBoard(spec));
      if (ffish.validateFen(fen, name) !== 1) throw new Error(`validateFen rejected ${fen}`);
      const b = new ffish.Board(name, fen);
      const n = b.numberLegalMoves();
      b.delete();
      if (n < 1 || n > 300) throw new Error(`implausible legal-move count ${n} for ${fen}`);
      return `${n} legal moves`;
    });
  }

  // --- Duel generation + legality cross-check (phase0 selftest, 9x8 arena) ---
  const spec = {
    files: 9,
    ranks: 8,
    walls: ['e4', 'e5', 'a3'],
    white: { backRank: ['R', 'N', 'K', 'B'], backRankStart: 2, row: 0 },
    black: { backRank: ['r', 'n', 'k', 'b', 'q'], backRankStart: 3, row: 7 },
  };
  const duelVariant = catalogVariantName(spec.files, spec.ranks);
  const startFen = boardToFen(buildDuelBoard(spec));
  let ffishMoves = [];

  await check('duel startFen validateFen', async () => {
    if (ffish.validateFen(startFen, duelVariant) !== 1) throw new Error(`validateFen rejected ${startFen}`);
    return startFen.split(' ')[0];
  });

  await check('legality cross-check (ffish vs engine perft 1)', async () => {
    const b = new ffish.Board(duelVariant, startFen);
    ffishMoves = b.legalMoves().trim().split(/\s+/).filter(Boolean);
    b.delete();
    engine.setoption('UCI_Variant', duelVariant);
    engine.position({ fen: startFen });
    const perftLines = await engine.sendUntil('go perft 1', (l) => l.startsWith('Nodes searched'));
    const perft1 = parseInt(perftLines[perftLines.length - 1].split(':')[1], 10);
    if (perft1 !== ffishMoves.length) throw new Error(`MISMATCH: ffish ${ffishMoves.length} vs engine ${perft1}`);
    return `${ffishMoves.length} moves on both sides`;
  });

  await check('engine bestmove legality', async () => {
    if (!ffishMoves.length) throw new Error('no ffish move list (cross-check failed earlier)');
    engine.position({ variant: duelVariant, fen: startFen });
    // Paired limits (rule 5); go() adds the movetime+1500ms stop watchdog.
    const res = await engine.go('depth 8 movetime 4000');
    if (!res.bestmove || !ffishMoves.includes(res.bestmove)) {
      throw new Error(`engine bestmove ${res.bestmove} not in ffish legal moves`);
    }
    const score = engine.lastScore(res);
    return `bestmove ${res.bestmove}, score ${score ? `${score.type} ${score.value}` : 'n/a'}`;
  });

  // --- §4.5 crumble filter on a catalog variant ---
  await check('crumble filter accepts legal candidate', async () => {
    const v = validateCrumbleCandidate(ffish, duelVariant, startFen, 'b5');
    if (!v.ok) throw new Error(`rejected b5: ${v.reason}`);
    return `b5 ok → ${v.collapsedFen.split(' ')[0]}`;
  });
  await check('crumble filter rejects king square', async () => {
    const v = validateCrumbleCandidate(ffish, duelVariant, startFen, 'e1');
    if (v.ok || v.reason !== 'king_square') {
      throw new Error(`expected king_square rejection, got ok=${v.ok} reason=${v.reason}`);
    }
    return 'e1 rejected (king_square)';
  });

  // --- Displacement landing safety (threat.mjs, Phase 1.1) ---
  // Pure static exchange evaluation, no ffish — the Director's guard against
  // quakes that hand out free material. The headline case is the observed
  // arena03 bug: a "symmetric" quake stepped the enemy rook onto b7, into a
  // white rook already bearing down the open b-file, with White to move.
  await check('landing safety — the observed arena03 gift is priced', () => {
    const F = (c) => c.charCodeAt(0) - 97;
    const at = (fen, sq, files, ranks) =>
      captureLoss(fenGrid(fen, files, ranks), F(sq[0]), parseInt(sq.slice(1), 10) - 1, files, ranks);
    // arena03 (5x7, walls c1/c4) after 11...Ra7, White to move.
    const pre = 'r4/3P1/1R3/2*1k/1N3/2KP1/2*2 w - - 0 12';
    if (at(pre, 'a7', 5, 7) !== 0) throw new Error('rook on a7 should be safe before the quake');
    // leg 1 of the observed quake: the enemy rook displaced a7 -> b7
    const gift = '1r3/3P1/1R3/2*1k/1N3/2KP1/2*2 w - - 0 12';
    const loss = at(gift, 'b7', 5, 7);
    if (loss !== 500) throw new Error(`expected a 500cp loss on b7, got ${loss}`);
    return 'b7 priced at 500cp (free rook) — rejected by the Director';
  });

  await check('landing safety — SEE mechanics', () => {
    const F = (c) => c.charCodeAt(0) - 97;
    const at = (fen, sq) => captureLoss(fenGrid(fen, 8, 8), F(sq[0]), parseInt(sq.slice(1), 10) - 1, 8, 8);
    const cases = [
      ['undefended pawn', '8/8/8/3p4/8/8/8/3R4 w - - 0 1', 'd5', 100],
      ['even trade allowed', '8/8/2p5/3r4/8/8/8/3R4 w - - 0 1', 'd5', 0],
      ['NxR then PxN', '8/8/8/3R4/2P5/2n5/8/8 w - - 0 1', 'd5', 180],
      ['x-ray: doubled rooks', '3R4/3R4/8/3r4/8/1p6/8/8 w - - 0 1', 'd5', 500],
      ['blocker shuts the ray', '8/8/8/3p4/8/3N4/8/3R4 w - - 0 1', 'd5', 0],
      ['a wall blocks a slider', '8/8/8/3p4/8/3*4/8/3R4 w - - 0 1', 'd5', 0],
      ['a knight leaps walls', '8/8/8/3p4/2**4/2N5/8/8 w - - 0 1', 'd5', 100],
      ['king declines a defended pawn', '8/1b6/8/3p4/3K4/8/8/8 w - - 0 1', 'd5', 0],
    ];
    for (const [label, fen, sq, want] of cases) {
      const got = at(fen, sq);
      if (got !== want) throw new Error(`${label}: expected ${want}, got ${got}`);
    }
    return `${cases.length} SEE cases (walls block sliders, leapers jump them)`;
  });

  // --- Phase 1.2: the Gods debug instrument must not perturb what it measures ---
  // The three rolls share one seeded stream with a STATE-DEPENDENT draw
  // pattern (no draw before onset, the debt cap skips the crumble roll, the
  // displacement leg consumes a variable number of picks), so the overlay's
  // probability getters must be RNG-free and rolls recorded inside quake()
  // — never by re-rolling (brief §10). These checks are the acceptance
  // criterion: a seeded duel replays identically with the overlay exercised.

  await check('director probability getters consume zero RNG', () => {
    const a = new Director({ seed: 42 });
    for (let ply = 0; ply < 120; ply++) {
      a.pQuake(ply);
      a.pCrumble(ply);
      a.pOneSided(ply);
    }
    a.forecast(10, { freeSquares: 20 });
    const b = new Director({ seed: 42 });
    for (let i = 0; i < 5; i++) {
      if (a.rng() !== b.rng()) throw new Error('a getter consumed a draw from the seeded stream');
    }
    return 'pQuake/pCrumble/pOneSided/forecast leave the stream untouched';
  });

  await check('director probability math matches the rolls', () => {
    const d = new Director({ seed: 1, onsetPly: 8, quakeRamp: 60, crumbleRamp: 100, debtCap: 10 });
    if (d.pQuake(7) !== 0) throw new Error('pQuake before onset must be 0');
    if (d.pQuake(68) !== 1) throw new Error('pQuake at onset+ramp must be 1');
    d.setFavor(0);
    if (d.pQuake(68) !== 0) throw new Error('favor 0 must silence pQuake');
    d.setFavor(1);
    d.debt = 10;
    if (d.pCrumble(20) !== 1) throw new Error('debt cap must force pCrumble to 1');
    d.debt = 0;
    const applied = d.tune({ quakeRamp: 30, bogus: 5 });
    if (applied.quakeRamp !== 30 || 'bogus' in applied) throw new Error(`tune misapplied: ${JSON.stringify(applied)}`);
    if (d.pQuake(38) !== 1) throw new Error('tuned quakeRamp not reflected in pQuake');
    const f = d.forecast(10, { freeSquares: 15 });
    if (!(f.nextQuake > 10) || !(f.firstCrumble >= f.nextQuake)) throw new Error(`implausible forecast ${JSON.stringify(f)}`);
    return `tune + getters consistent; forecast ${JSON.stringify(f)}`;
  });

  // Seeded replay with the instrument hammered between rolls. Uses a small
  // 5x6 fixture so the whole check stays in the low seconds on a phone.
  const dirVariant = catalogVariantName(5, 6);
  const dirFen = '1rk1n/ppp2/2*2/5/1PP2/1KR1N w - - 0 1';
  const dirCfg = { onsetPly: 2, quakeRamp: 8, crumbleRamp: 30, debtCap: 3, asymOnsetPly: 6, asymRamp: 10 };
  const quakeSummary = (q) =>
    q === null
      ? null
      : {
          d: q.displacements.map((x) => `${x.piece}${x.from}${x.to}`),
          c: q.crumble ? `${q.crumble.square}:${q.crumble.pieceLost ?? '-'}` : null,
          post: q.postFen,
          ends: q.endsGame,
        };
  const runDirector = (seed, exercise) => {
    const d = new Director({ ...dirCfg, seed });
    let fen = dirFen;
    const out = [];
    const traces = [];
    for (let ply = 1; ply <= 14; ply++) {
      if (exercise) {
        d.pQuake(ply);
        d.pCrumble(ply);
        d.pOneSided(ply);
        d.forecast(ply, { freeSquares: 10 });
        if (ply === 6) {
          displacementCandidates(ffish, dirVariant, fen, 5, 6);
          crumbleCandidates(ffish, dirVariant, fen, 5, 6);
          lockedPawns(fen, 5, 6);
        }
      }
      const q = d.quake(ffish, dirVariant, fen, 5, 6, ply);
      traces.push(d.lastTrace);
      out.push(quakeSummary(q));
      if (q && !q.endsGame) fen = q.postFen;
      if (q && q.endsGame) break;
    }
    return { out, traces };
  };

  let dirTraces = [];
  let dirEvents = [];
  await check('seeded quake sequence identical with the overlay exercised', () => {
    if (ffish.validateFen(dirFen, dirVariant) !== 1) throw new Error('director fixture FEN rejected');
    for (const seed of [3, 7]) {
      const plain = runDirector(seed, false);
      const hammered = runDirector(seed, true);
      if (JSON.stringify(plain.out) !== JSON.stringify(hammered.out)) {
        throw new Error(`seed ${seed}: getters/census/forecast perturbed the quake sequence`);
      }
      dirTraces = dirTraces.concat(plain.traces);
      dirEvents = dirEvents.concat(plain.out);
    }
    return `2 seeds × 14 plies replay exactly (${dirTraces.length} traces)`;
  });

  await check('roll trace records every ply with consistent reason codes', () => {
    if (!dirTraces.length) throw new Error('no traces from the replay check');
    let quakes = 0;
    dirTraces.forEach((t, i) => {
      if (!t) throw new Error(`no trace at index ${i}`);
      if (!Array.isArray(t.rolls) || !Array.isArray(t.path) || !t.path.length) throw new Error(`ply ${t?.ply}: empty trace`);
      const ev = dirEvents[i];
      const want =
        ev === null
          ? ['quiet', 'starved']
          : ev.ends
            ? ['terminal']
            : ev.c
              ? ['crumble']
              : [ev.d.length === 2 ? 'paired' : 'one-sided'];
      if (!want.includes(t.outcome)) throw new Error(`ply ${t.ply}: outcome ${t.outcome} disagrees with the event`);
      const reachedCrumbleLeg = t.path.includes('crumble-neutral') || t.path.includes('crumble-terminal') || t.path.includes('starved');
      const crumbleWanted = t.path.includes('crumble-forced') || t.path.includes('crumble-roll-passed');
      if (t.fellThrough !== (reachedCrumbleLeg && !crumbleWanted)) throw new Error(`ply ${t.ply}: fellThrough bookkeeping wrong (${t.path.join(',')})`);
      if (t.outcome === 'quiet' && t.census !== null) throw new Error(`ply ${t.ply}: quiet ply computed a census`);
      if (t.outcome !== 'quiet') {
        if (!t.census || typeof t.census.lockedPawns !== 'number') throw new Error(`ply ${t.ply}: quake trace lacks census`);
        quakes++;
      }
    });
    if (!quakes) throw new Error('fixture produced no quakes — check the config');
    return `${dirTraces.length} traces, ${quakes} quakes, outcomes+paths consistent`;
  });

  // --- Game-end protocol (rule 4): numberLegalMoves()===0, mover loses ---
  await check('game-end protocol (stalemate = mover loses)', async () => {
    // Classic corner stalemate, black to move, on the catalog 8x8 board.
    // ffish result()/isGameOver() mislabel such states under our config —
    // the ONLY game-end signal is numberLegalMoves()===0, side to move loses.
    // Black keeps an inert blocked pawn (a4 vs Pa3): a BARE king is decided
    // at load under the native bare-army config, which would make this test
    // pass for the wrong reason (extinction, not the stalemate protocol).
    const staleFen = '7k/8/6Q1/8/p7/P7/8/K7 b - - 0 1';
    const name = catalogVariantName(8, 8);
    if (ffish.validateFen(staleFen, name) !== 1) throw new Error('stalemate FEN rejected by validateFen');
    const b = new ffish.Board(name, staleFen);
    const n = b.numberLegalMoves();
    const inCheck = b.isCheck();
    b.delete();
    if (n !== 0) throw new Error(`expected 0 legal moves, got ${n}`);
    if (inCheck) throw new Error('expected stalemate, position is check');
    return 'black to move, 0 legal moves, not in check → black loses, white wins';
  });

  finish(null);
}

main().catch((e) => {
  report(false, 'selftest crashed', e && e.message ? e.message : String(e));
  finish('crashed');
});
