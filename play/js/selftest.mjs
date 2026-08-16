// Browser infra selftest for the duel slice. Ports every check from
// phase0/lib/selftest.mjs (FEN round-trip, wall setSquare, validateFen,
// ffish-vs-engine perft-1 legality cross-check, engine bestmove legality) and
// adds the Phase 1 boot-path checks: the full variant catalog loaded ONCE
// into BOTH libraries (variant names are single-use — rule 7), the §4.5
// crumble filter, and the game-end protocol (rule 4: numberLegalMoves()===0
// and the mover loses — never ffish isGameOver()/result()).
//
// Renders one PASS/FAIL line per check into #out, then sets
// window.__SELFTEST = { done, passed, failed, lines } (done set LAST) so a
// headless driver can poll for completion.
import { createEngine, getFfish } from './engine.mjs';
import { makeCatalogIni, catalogSize, catalogVariantName, buildDuelBoard, boardToFen } from './variant.mjs';
import { splitFen, parseBoard, serializeBoard, setSquare, getSquare } from './fen.mjs';
import { validateCrumbleCandidate } from './crumbleFilter.mjs';
import { fenGrid } from './director.mjs';
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

  // --- Full catalog into BOTH libraries (rule 7: load once at boot) ---
  const catalogIni = makeCatalogIni();
  const catalogN = catalogSize();
  await check('catalog load (ffish)', async () => {
    const blocks = (catalogIni.match(/^\[duel_/gm) || []).length;
    if (blocks !== catalogN) throw new Error(`expected ${catalogN} catalog variants in ini, got ${blocks}`);
    ffish.loadVariantConfig(catalogIni);
    return `${catalogN} variants registered`;
  });
  await check('catalog load (engine)', async () => {
    await engine.loadVariantsIni(catalogIni); // the FULL catalog text, same as boot
    return `${catalogN} variants written to /variants.ini, readyok`;
  });
  // The catalog corners: the FSF largeboard ceiling, and the smallest board the
  // widened catalog now allows. Both must produce a usable Board — one rank
  // past the ceiling (13x10 / 12x11) crashes this WASM build's heap, and
  // loadVariantConfig does NOT reject it, so only a real Board proves the size.
  for (const [f, r] of [[12, 10], [2, 2]]) {
    await check(`catalog corner ${f}x${r}`, async () => {
      const name = catalogVariantName(f, r);
      // King + rook a side, so neither is bare (rule 4 would decide it at load).
      const pad = f > 2 ? String(f - 2) : '';
      const ranks = [`kr${pad}`, ...Array.from({ length: r - 2 }, () => String(f)), `KR${pad}`];
      const board = new ffish.Board(name, `${ranks.join('/')} w - - 0 1`);
      const moves = board.numberLegalMoves();
      const fen = board.fen();
      board.delete();
      if (!moves) throw new Error(`no legal moves on ${name} — ${fen}`);
      return `${moves} legal moves, ${fen}`;
    });
  }

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
