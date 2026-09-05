// Browser infra selftest for the duel slice. Ports every check from
// phase0/lib/selftest.mjs (FEN round-trip, wall setSquare, validateFen,
// ffish-vs-engine perft-1 legality cross-check, engine bestmove legality) and
// adds the Phase 1 boot-path checks: the full 60-variant catalog loaded ONCE
// into BOTH libraries (variant names are single-use — rule 7), the §4.5
// crumble filter, and the game-end protocol (rule 4: numberLegalMoves()===0
// and the mover loses — never ffish isGameOver()/result()).
//
// Renders one PASS/FAIL line per check into #out, then sets
// window.__SELFTEST = { done, passed, failed, lines } (done set LAST) so a
// headless driver can poll for completion.
import { createEngine, getFfish } from './engine.mjs';
import { makeCatalogIni, catalogVariantName, buildDuelBoard, boardToFen } from './variant.mjs';
import { splitFen, parseBoard, serializeBoard, setSquare, getSquare, findSquares } from './fen.mjs';
import { validateCrumbleCandidate } from './crumbleFilter.mjs';
import { fenGrid, Director, displacementCandidates, crumbleCandidates, lockedPawns, weakenCandidates, terrainCensus } from './director.mjs';
import { captureLoss } from './threat.mjs';
import { threatLedger, gridOf, forcedWins, winInOne, newThreats, mateNets } from './tactics.mjs';
import { RestlessnessMeter } from './meter.mjs';
import { loadStageV2, flipStageVertical, cropStage, stageSkins } from './stage.mjs';
import { dealMatchup, campLineRank } from './armygen.mjs';
import { BoardUI } from './board-ui.mjs';

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

  await check('setSquare furniture', async () => {
    const crateFen2 = setSquare(fens[0], 'e4', '^');
    if (getSquare(crateFen2, 'e4') !== '^') throw new Error('setSquare/getSquare disagree on ^e4');
    return crateFen2.split(' ')[0];
  });

  // --- Full 60-variant catalog into BOTH libraries (rule 7: load once at
  // boot; ranks 5-10 since the slice refresh added the 3x5 minimum stage) ---
  const catalogIni = makeCatalogIni();
  await check('catalog load (ffish)', async () => {
    const blocks = (catalogIni.match(/^\[duel_/gm) || []).length;
    if (blocks !== 60) throw new Error(`expected 60 catalog variants in ini, got ${blocks}`);
    ffish.loadVariantConfig(catalogIni);
    return '60 variants registered';
  });
  await check('catalog load (engine)', async () => {
    await engine.loadVariantsIni(catalogIni); // the FULL catalog text, same as boot
    return '60 variants written to /variants.ini, readyok';
  });

  // --- Catalog extremes: smallest and largest boards construct and move.
  // 3x5 is the catalog's floor (the archived wave-4 bed served it; the
  // wave-6 bed is all 10x10, but the catalog still carries every size). ---
  const extremeSpecs = [
    {
      files: 3, ranks: 5, walls: [],
      white: { backRank: ['R', 'K', 'N'], backRankStart: 0, row: 0 },
      black: { backRank: ['r', 'k', 'n'], backRankStart: 0, row: 4 },
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

  // --- The proving grounds (slice refresh): stages + the army generator.
  // The setup screen fetches the manifest bundle and runs dealMatchup in the
  // browser for the first time — these checks make a regression in that
  // path visible here, not on a phone. ---
  let stages = [];
  await check('stage manifest loads and validates', async () => {
    const res = await fetch('stages/manifest.json');
    if (!res.ok) throw new Error(`HTTP ${res.status} — regenerate with phase0/harness/gen-stage-manifest.mjs`);
    const manifest = await res.json();
    stages = manifest.stages.map((json) => loadStageV2(json));
    if (stages.length !== manifest.count || stages.length < 33) {
      throw new Error(`expected ≥33 stages (count ${manifest.count}), loaded ${stages.length}`);
    }
    // (The extreme-rank promotion check is retired — ground rules
    // 2026-08-27: the king-anchored auto-crop makes the promotion-row
    // guarantee true by construction; see the dealMatchup check below.)
    const furn = stages.reduce((n, s) => n + s.furniture.length, 0);
    return `${stages.length} stages, ${furn} furniture squares`;
  });

  await check('flipStageVertical is an involution on every stage', () => {
    if (!stages.length) throw new Error('no stages loaded');
    for (const s of stages) {
      const back = flipStageVertical(flipStageVertical(s));
      if (JSON.stringify(back.grid) !== JSON.stringify(s.grid)) throw new Error(`${s.id}: double flip changed the grid`);
      if (JSON.stringify([...back.walls].sort()) !== JSON.stringify([...s.walls].sort())) {
        throw new Error(`${s.id}: double flip changed the wall set`);
      }
      if (JSON.stringify([...back.furniture].sort()) !== JSON.stringify([...s.furniture].sort())) {
        throw new Error(`${s.id}: double flip changed the furniture set`);
      }
      // Skins ride the transform beside the map (2026-09-02).
      if (JSON.stringify(back.skin) !== JSON.stringify(s.skin)) throw new Error(`${s.id}: double flip changed the skin grid`);
      const flipped = flipStageVertical(s);
      for (const [sq, name] of Object.entries(stageSkins(s))) {
        const mirror = `${sq[0]}${s.ranks + 1 - parseInt(sq.slice(1), 10)}`;
        if (stageSkins(flipped)[mirror] !== name) throw new Error(`${s.id}: skin on ${sq} did not mirror to ${mirror}`);
      }
    }
    const skinned = stages.reduce((n, s) => n + Object.keys(stageSkins(s)).length, 0);
    return `${stages.length} stages round-trip (walls + furniture + ${skinned} skins)`;
  });

  // Synthetic fixtures from here down — deliberately NOT tied to stage ids,
  // so the designer can accept/tweak/kill the live set without breaking
  // infra checks (the set-level checks above cover the real files).
  const kingsAnchorStage = loadStageV2({
    schema: 2,
    id: 'selftest-keep',
    title: 'Selftest Keep',
    notes: 'synthetic: fully-walled near row exercises the king-anchored auto-crop',
    map: [
      '..........',
      '..#....^..',
      '..........',
      '....##....',
      '..^.......',
      '..........',
      '.......#..',
      '..........',
      '..........',
      '##########', // rank 1: all stone — legal since 2026-08-27, auto-crops away
    ],
  });
  const dealKnobs = {
    white: { spec: { width: 6, budget: 30 } },
    black: { spec: { width: 5, budget: 20 } },
    seed: 7,
  };
  await check('dealMatchup: deterministic, kings anchored, auto-crop fires', () => {
    const a = dealMatchup({ stage: kingsAnchorStage, ...dealKnobs, turn: 'b', ffish });
    if (!a.ok) throw new Error(`deal failed: ${a.error}`);
    const b = dealMatchup({ stage: kingsAnchorStage, ...dealKnobs, turn: 'b', ffish });
    if (a.fen !== b.fen || a.directorSeed !== b.directorSeed) throw new Error('same inputs dealt different duels');
    if (a.autoCrop.bottom < 1) throw new Error(`walled near row should auto-crop, got ${JSON.stringify(a.autoCrop)}`);
    const wK = findSquares(a.fen, (c) => c === 'K')[0];
    const bK = findSquares(a.fen, (c) => c === 'k')[0];
    if (wK.rankFromBottom !== 0) throw new Error(`white king on rank ${wK.rankFromBottom + 1}, not the first row`);
    if (bK.rankFromBottom !== a.ranks - 1) throw new Error(`black king on rank ${bK.rankFromBottom + 1}, not the far row`);
    if (!a.variantName.startsWith(`${catalogVariantName(a.files, a.ranks)}__w`) || !a.variantIni) {
      throw new Error(`deal variant does not match the cropped board: ${a.variantName} vs ${a.files}x${a.ranks}`);
    }
    if (a.fen.split(' ')[1] !== 'b') throw new Error('turn field lost — enemy-first deals must start black to move');
    // Flipped, the walled row faces the enemy — the crop moves to the top.
    const f = dealMatchup({ stage: kingsAnchorStage, flip: true, ...dealKnobs, ffish });
    if (!f.ok) throw new Error(`flipped deal failed: ${f.error}`);
    if (f.autoCrop.top < 1) throw new Error(`flipped walled row should crop from the top, got ${JSON.stringify(f.autoCrop)}`);
    return `10x10→${a.files}x${a.ranks} deal replays exactly, kings on the extreme rows both orientations (gap ${a.gap})`;
  });

  // The designer's double-step rule (spike 14, camp line): each side's
  // deal variant grants the leap at or behind its CAMP LINE — the rank
  // holding the MOST of its dealt pawns, ties toward the enemy (NOT the
  // front-most pawn rank; that reading was tried and rejected — a lone
  // straggler must never drag the line forward). Past the line, never
  // again. Quake-scooted pawns behind the line keep it, which is the
  // whole point of rows over dealt squares.
  const flatsStage = loadStageV2({
    schema: 2,
    id: 'selftest-flats',
    title: 'Selftest Flats',
    notes: 'synthetic: open wide-shallow ground for the camp-line check',
    map: ['..........', '..........', '..........', '..........', '..........', '..........'],
  });
  await check('double-step follows the camp line on a dealt board', () => {
    const deal = dealMatchup({ stage: flatsStage, white: { spec: { width: 5, budget: 22 } }, black: { spec: { width: 5, budget: 18 } }, seed: 4, ffish });
    if (!deal.ok) throw new Error(`deal failed: ${deal.error}`);
    const whitePawns = deal.white.layout.cells.filter((c) => c.piece === 'P');
    const wLine = campLineRank(deal.white.layout.cells, 1); // mode pawn rank, ties toward the enemy
    if (!deal.variantName.includes(`__w${wLine}__`)) throw new Error(`variant ${deal.variantName} does not encode line w${wLine}`);
    const sq = (c) => `${String.fromCharCode(97 + c.f)}${c.r + 1}`;
    const b = new ffish.Board(deal.variantName, deal.fen);
    const legal = () => b.legalMoves().trim().split(/\s+/).filter(Boolean);
    // dealt pawns on the line offer the double at ply 0
    const doubles = legal().filter((m) => {
      const p = whitePawns.find((c) => m.startsWith(sq(c)));
      return p && parseInt(m.slice(sq(p).length).replace(/^[a-l]/, ''), 10) === p.r + 3;
    });
    if (!doubles.length) {
      b.delete();
      throw new Error('no dealt pawn offers a double-step at ply 0');
    }
    // a pawn that crosses the line loses the leap forever
    const pawn = whitePawns.find((c) => legal().includes(`${sq(c)}${String.fromCharCode(97 + c.f)}${c.r + 2}`));
    if (!pawn) {
      b.delete();
      throw new Error('no pawn with a legal single step to test');
    }
    const from = sq(pawn);
    const stepped = `${String.fromCharCode(97 + pawn.f)}${pawn.r + 2}`;
    b.push(`${from}${stepped}`);
    b.push(legal()[0]); // any black reply
    const saved = legal().find((m) => m.startsWith(stepped) && m.endsWith(String(pawn.r + 4)));
    b.delete();
    if (saved) throw new Error(`pawn ${from}→${stepped} kept its leap past the line (${saved})`);
    // the quake-scoot case: a pawn relocated to an empty square BEHIND the
    // line (never a dealt square) must still leap — simulate the surgery.
    const scootTo = findSquares(deal.fen, (cell, f, r) => cell === null && r + 1 < wLine)
      .find((s) => getSquare(deal.fen, { file: s.file, rankFromBottom: s.rankFromBottom + 1 }) === null
        && getSquare(deal.fen, { file: s.file, rankFromBottom: s.rankFromBottom + 2 }) === null);
    if (!scootTo) {
      return `${doubles.length} camp-line doubles at ply 0; crossing the line kills the leap (no open scoot square to test the quake case)`;
    }
    const scootFen = setSquare(setSquare(deal.fen, from, null), scootTo.name, 'P');
    const b2 = new ffish.Board(deal.variantName, scootFen);
    const leap = b2.legalMoves().trim().split(/\s+/).includes(`${scootTo.name}${String.fromCharCode(97 + scootTo.file)}${scootTo.rankFromBottom + 3}`);
    b2.delete();
    if (!leap) throw new Error(`scooted pawn on ${scootTo.name} (behind line ${wLine}) cannot leap`);
    return `${doubles.length} camp-line doubles at ply 0; crossing the line kills the leap; a scooted pawn on ${scootTo.name} still leaps`;
  });

  const hallStage = loadStageV2({
    schema: 2,
    id: 'selftest-hall',
    title: 'Selftest Hall',
    notes: 'synthetic: 10x10 with scattered pillars for the molding check',
    map: [
      '..........',
      '..........',
      '...#......',
      '..........',
      '......#...',
      '..#.......',
      '..........',
      '.......#..',
      '..........',
      '..........',
    ],
  });
  await check('molding invariants hold on a dealt board', () => {
    const deal = dealMatchup({ stage: hallStage, white: { spec: { width: 8, budget: 40 } }, black: { spec: { width: 8, budget: 40 } }, seed: 3, ffish });
    if (!deal.ok) throw new Error(`deal failed: ${deal.error}`);
    for (const [layout, isWhite] of [[deal.white.layout, true], [deal.black.layout, false]]) {
      const rearward = (r) => (isWhite ? r : deal.ranks - 1 - r); // rows from the side's home edge
      const royalRow = Math.min(...layout.cells.filter((c) => c.piece === 'K').map((c) => rearward(c.r)));
      const minRow = Math.min(...layout.cells.map((c) => rearward(c.r)));
      if (royalRow !== minRow) throw new Error(`${isWhite ? 'white' : 'black'}: royal not in the rearmost occupied row`);
      const byFile = new Map();
      for (const c of layout.cells) {
        if (!byFile.has(c.f)) byFile.set(c.f, []);
        byFile.get(c.f).push(c);
      }
      for (const [f, cells] of byFile) {
        const pawns = cells.filter((c) => c.piece === 'P').map((c) => rearward(c.r));
        const pieces = cells.filter((c) => c.piece !== 'P').map((c) => rearward(c.r));
        if (pawns.length && pieces.length && Math.min(...pawns) <= Math.max(...pieces)) {
          throw new Error(`${isWhite ? 'white' : 'black'} file ${f}: a pawn sits behind a piece`);
        }
      }
    }
    return `royal-rearmost + per-file pawn screen hold for both 8x2 armies (gap ${deal.gap})`;
  });

  // The designer's promotion rule (king-anchored since 2026-08-27): the
  // promotion zone is the enemy king's starting row — always the real far
  // rank, because cropping redraws the boundary (the rank is REMOVED,
  // never walled off) and the auto-crop anchors the kings on the extremes.
  await check('cropping keeps promotion on the actual far rank', () => {
    const cropped = cropStage(hallStage, 2, 1); // 10x10 → 10x7
    if (cropped.ranks !== 7 || cropped.variantName !== catalogVariantName(10, 7)) {
      throw new Error(`crop 2t1b: expected 10x7 duel_10x7, got ${cropped.files}x${cropped.ranks} ${cropped.variantName}`);
    }
    // A white pawn one step under the cropped far rank must have promotion
    // moves there (both sides keep escorts — a bare king is decided at load).
    const fen = '2k7/P1p7/10/10/10/2P7/2K7 w - - 0 1'; // 10 files x 7 ranks
    if (ffish.validateFen(fen, cropped.variantName) !== 1) throw new Error('promotion fixture FEN rejected');
    const b = new ffish.Board(cropped.variantName, fen);
    const moves = b.legalMoves().trim().split(/\s+/).filter(Boolean);
    b.delete();
    const promos = moves.filter((m) => m.startsWith('a6a7'));
    if (!promos.length || !promos.some((m) => m.length > 4)) {
      throw new Error(`no promotion moves on the cropped far rank (a6a7*): ${moves.join(' ')}`);
    }
    return `a6a7 promotes on duel_10x7 (${promos.join(' ')})`;
  });

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

  // --- §4.6 furniture (^) on the patched pair, in-browser ---
  // Counts pinned by the Forge gate (engine/README.md): [10,88,1024] and the
  // promotion-capture fixture's [24 legal, d1 hand-verified]. These run on a
  // CATALOG variant (full duel baseline), not a test-only config.
  const crateVariant = catalogVariantName(6, 6);
  const crateFen = '2r2k/6/2^3/6/6/2R2K w - - 0 1';
  const promoFen = 'r^1^1k/2P3/6/6/6/R4K w - - 0 1';

  await check('furniture: ^ accepted + round-trips (ffish + fen.mjs)', async () => {
    if (ffish.validateFen(crateFen, crateVariant) !== 1) throw new Error('validateFen rejected ^');
    const b = new ffish.Board(crateVariant, crateFen);
    const rt = b.fen();
    b.delete();
    if (rt !== crateFen) throw new Error(`ffish round-trip: ${rt}`);
    const f = splitFen(crateFen);
    const js = serializeBoard(parseBoard(f.board));
    if (js !== f.board) throw new Error(`fen.mjs round-trip: ${js}`);
    return crateFen.split(' ')[0];
  });

  await check('furniture: ffish vs engine perft 1-3 on a ^ board', async () => {
    const jsPerft = (fen, d) => {
      const rec = (b, dd) => {
        if (!dd) return 1;
        let n = 0;
        for (const m of b.legalMoves().trim().split(/\s+/).filter(Boolean)) {
          b.push(m);
          n += rec(b, dd - 1);
          b.pop();
        }
        return n;
      };
      const b = new ffish.Board(crateVariant, fen);
      const n = rec(b, d);
      b.delete();
      return n;
    };
    const fp = [1, 2, 3].map((d) => jsPerft(crateFen, d));
    engine.setoption('UCI_Variant', crateVariant);
    const ep = [];
    for (const d of [1, 2, 3]) {
      engine.position({ fen: crateFen });
      const ls = await engine.sendUntil(`go perft ${d}`, (l) => l.startsWith('Nodes searched'));
      ep.push(parseInt(ls[ls.length - 1].split(':')[1], 10));
    }
    if (JSON.stringify(fp) !== JSON.stringify(ep)) throw new Error(`MISMATCH: ffish ${fp} vs engine ${ep}`);
    if (JSON.stringify(fp) !== JSON.stringify([10, 88, 1024])) throw new Error(`expected [10,88,1024], got ${fp}`);
    return `[${fp.join(',')}] on both sides`;
  });

  await check('furniture: promotion-capture of a crate pushes and pops exactly', async () => {
    const b = new ffish.Board(crateVariant, promoFen);
    const moves = b.legalMoves().trim().split(/\s+/).filter(Boolean);
    const fail = (msg) => { b.delete(); throw new Error(msg); };
    if (moves.length !== 24) fail(`expected 24 legal moves, got ${moves.length}`);
    if (!moves.includes('c5b6q')) fail('missing c5b6q');
    b.push('c5b6q');
    const after = b.fen();
    b.pop();
    const restored = b.fen();
    b.delete();
    if (!after.startsWith('rQ1^1k/')) throw new Error(`push: ${after}`);
    if (restored !== promoFen) throw new Error(`pop did not restore the crate: ${restored}`);
    return 'c5b6q promotes; pop restores the crate (the reference-diff undo-bug class)';
  });

  await check('furniture: engine plays the ^ board (finds the strip mate)', async () => {
    engine.position({ variant: crateVariant, fen: promoFen });
    const res = await engine.go('depth 8 movetime 4000');
    if (res.bestmove !== 'a1a6') throw new Error(`expected the bare-army strip a1a6, got ${res.bestmove}`);
    return 'bestmove a1a6 — extinction (rule 4) intact with crates on board';
  });

  // --- §4.6 furniture through the STAGE pipeline (Set Dressing) ---
  const crateStage = loadStageV2({
    schema: 2,
    id: 'selftest-crates',
    title: 'Selftest Crates',
    notes: 'synthetic: furniture in midfield + deployment reach',
    map: ['......', '..^...', '.^....', '......', '...^..', '..##..', '......'],
  });
  await check('furniture: a ^ stage deals — crates survive into the FEN', () => {
    const deal = dealMatchup({ stage: crateStage, white: { spec: { width: 4, budget: 16 } }, black: { spec: { width: 4, budget: 12 } }, seed: 2, ffish });
    if (!deal.ok) throw new Error(`deal failed: ${deal.error}`);
    const crates = findSquares(deal.fen, (c) => c === '^');
    const expected = deal.stage.furniture.length;
    if (crates.length !== expected) {
      throw new Error(`dealt FEN carries ${crates.length} crates, stage has ${expected} — an emitter dropped furniture`);
    }
    const onFurniture = [...deal.white.layout.cells, ...deal.black.layout.cells].filter((c) =>
      deal.stage.furniture.includes(`${String.fromCharCode(97 + c.f)}${c.r + 1}`)
    );
    if (onFurniture.length) throw new Error(`molding placed pieces on furniture: ${JSON.stringify(onFurniture)}`);
    const wK = findSquares(deal.fen, (c) => c === 'K')[0];
    const bK = findSquares(deal.fen, (c) => c === 'k')[0];
    if (wK.rankFromBottom !== 0 || bK.rankFromBottom !== deal.ranks - 1) {
      throw new Error('kings not anchored on a furniture stage');
    }
    return `${crates.length} crates dealt onto ${deal.files}x${deal.ranks}, ffish lints clean, kings anchored`;
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
      a.pressure(ply);
      a.rungWeights(ply);
    }
    a.forecast(10);
    const b = new Director({ seed: 42 });
    for (let i = 0; i < 5; i++) {
      if (a.rng() !== b.rng()) throw new Error('a getter consumed a draw from the seeded stream');
    }
    return 'pQuake/pressure/rungWeights/forecast leave the stream untouched';
  });

  await check('director probability math matches the rolls', () => {
    // v3: the trigger is the METER, so pQuake is driven by restlessness, not
    // by ply. Only the backstop floor is a ply ramp.
    const d = new Director({ seed: 1, onsetPly: 8, rampPlies: 16, debtCap: 10 });
    if (d.pQuake(7) !== 0) throw new Error('pQuake before onset must be 0');
    if (d.pQuake(20) !== 0) throw new Error('a calm meter must leave pQuake at 0');
    d.meter.value = 16;
    if (d.pQuake(20) !== 1) throw new Error('a full meter must drive pQuake to 1');
    d.setFavor(0);
    if (d.pQuake(20) !== 0) throw new Error('favor 0 must silence pQuake');
    d.setFavor(1);
    d.meter.value = 0;
    if (d.pQuake(300) !== 1) throw new Error('the backstop floor must force pQuake late');
    const applied = d.tune({ rampPlies: 8, bogus: 5 });
    if (applied.rampPlies !== 8 || 'bogus' in applied) throw new Error(`tune misapplied: ${JSON.stringify(applied)}`);
    d.meter.value = 8;
    if (d.pQuake(20) !== 1) throw new Error('tuned rampPlies not reflected in pQuake');
    // The ladder escalates with TEDIUM (v4 — how long the board has been
    // dead; v3 keyed it to pressure, which a discharging meter rarely
    // reaches): crumble weight is zero on a live board and the top rungs
    // only open up as tedium climbs.
    d.meter.cold = [false, false, false, false]; // every recent ply an event: live
    const lo = d.rungWeights(20);
    if (lo.crumble !== 0 || lo.displace !== 0) throw new Error('a live board must not reach the destructive rungs');
    if (!(lo.weaken > 0)) throw new Error('weaken must always be on the menu');
    d.meter.cold = [true, true, true, true]; // nothing irreversible for the whole window: dead
    const hi = d.rungWeights(20);
    if (!(hi.crumble > 0) || !(hi.displace > lo.displace)) throw new Error('a dead board must open the destructive rungs');
    const f = d.forecast(20);
    if (!(f.nextQuake > 20)) throw new Error(`implausible forecast ${JSON.stringify(f)}`);
    return `tune + getters consistent; ladder escalates; forecast ${JSON.stringify(f)}`;
  });

  await check('holes are permanent — the gods never re-crack a pit', () => {
    const files = 4;
    const ranks = 4;
    // Two walls, one of which we declare a hole. Only the other is weakenable.
    const fen = '4/1*1*/4/4 w - - 0 1';
    const all = weakenCandidates(fen, files, ranks, new Set());
    const withHole = weakenCandidates(fen, files, ranks, new Set(['b3']));
    if (!all.some((c) => c.sq === 'b3')) throw new Error('b3 should be weakenable when it is an authored wall');
    if (withHole.some((c) => c.sq === 'b3')) throw new Error('a hole must never be offered as a weaken candidate');
    if (withHole.length !== all.length - 1) throw new Error('only the hole should have been removed');
    const census = terrainCensus(fen, files, ranks, new Set(['b3']));
    if (census.walls !== 1 || census.holes !== 1) throw new Error(`terrain census miscounts: ${JSON.stringify(census)}`);
    return `${all.length} weakenable walls, ${withHole.length} once b3 is a hole`;
  });

  // Seeded replay with the instrument hammered between rolls. Uses a small
  // 5x6 fixture so the whole check stays in the low seconds on a phone.
  const dirVariant = catalogVariantName(5, 6);
  const dirFen = '1rk1n/ppp2/2*2/5/1PP2/1KR1N w - - 0 1';
  const dirCfg = { onsetPly: 2, rampPlies: 4, debtCap: 3, extraActions: 2 };
  const quakeSummary = (q) =>
    q === null
      ? null
      : {
          d: q.displacements.map((x) => `${x.piece}${x.from}${x.to}`),
          c: q.crumble ? `${q.crumble.square}:${q.crumble.pieceLost ?? '-'}` : null,
          t: (q.terrain ?? []).map((x) => `${x.kind}:${x.square}`),
          post: q.postFen,
          ends: q.endsGame,
        };
  // v3: the trigger is the METER, so a fixture that only calls quake() in a
  // loop never fires — restlessness has to be fed. A quiet ply is the whole
  // point of the fixture (nothing is happening, so the gods get bored), and
  // feeding it keeps the replay checks below meaningful rather than vacuously
  // comparing two all-quiet sequences.
  const QUIET_PLY = { capture: false, check: false, pawnAdvance: false, promotion: false, repetition: false };
  const runDirector = (seed, exercise, startFen = dirFen) => {
    const d = new Director({ ...dirCfg, seed });
    let fen = startFen;
    const out = [];
    const traces = [];
    for (let ply = 1; ply <= 14; ply++) {
      d.observePly(ffish, dirVariant, fen, 5, 6, QUIET_PLY);
      if (exercise) {
        d.pQuake(ply);
        d.pressure(ply);
        d.rungWeights(ply);
        d.forecast(ply);
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

  // Furniture is a TARGET now, not stone (v3 — §4.6's `[1.2.4 interim]`
  // clause handed the real policy to this rework). The crate fixture asserts
  // what still has to hold once the gods can edit terrain: the sequence
  // replays identically with the overlay exercised, a crate is never picked
  // up and carried by a displacement (breaching is the only way to remove
  // one), and every post-quake FEN is legal.
  const dirFenCrate = dirFen.replace('2*2', '2^2'); // the c4 wall becomes a crate
  await check('seeded ^ quake sequence: identical replay, crate breachable not portable', () => {
    if (ffish.validateFen(dirFenCrate, dirVariant) !== 1) throw new Error('crate director fixture FEN rejected');
    let breaches = 0;
    let weakens = 0;
    for (const seed of [3, 7]) {
      const plain = runDirector(seed, false, dirFenCrate);
      const hammered = runDirector(seed, true, dirFenCrate);
      if (JSON.stringify(plain.out) !== JSON.stringify(hammered.out)) {
        throw new Error(`seed ${seed}: overlay perturbed the ^ quake sequence`);
      }
      for (const ev of plain.out) {
        if (ev === null) continue;
        // A displacement may never move a crate: '^' is not a piece, and the
        // toUpperCase() landmine class is exactly how it would become one.
        for (const move of ev.d) if (move.startsWith('^')) throw new Error(`gods carried a crate: ${move}`);
        if (ffish.validateFen(ev.post, dirVariant) !== 1) throw new Error(`quake produced an illegal FEN: ${ev.post}`);
        // `t` is a LIST now — a quake spends a budget, so rungs mix.
        for (const edit of ev.t) {
          if (edit.startsWith('breach')) breaches++;
          if (edit.startsWith('weaken')) weakens++;
        }
        // A weaken must always land on a WALL, so furniture exists afterwards
        // — the supply is walls, and holes are excluded from it.
        if (ev.t.some((x) => x.startsWith('weaken')) && findSquares(ev.post, (c) => c === '^').length < 1) {
          throw new Error(`weaken produced no furniture: ${ev.post}`);
        }
      }
    }
    return `2 seeds × 14 plies replay exactly; ${weakens} weakens, ${breaches} breaches, no crate carried`;
  });

  await check('roll trace records every ply with consistent reason codes', () => {
    if (!dirTraces.length) throw new Error('no traces from the replay check');
    let quakes = 0;
    dirTraces.forEach((t, i) => {
      if (!t) throw new Error(`no trace at index ${i}`);
      if (!Array.isArray(t.rolls) || !Array.isArray(t.path) || !t.path.length) throw new Error(`ply ${t?.ply}: empty trace`);
      const ev = dirEvents[i];
      // v3: a quake spends a BUDGET, so several rungs can fire at once and
      // the trace's `outcome` is the HEAVIEST of them. The event has to agree
      // with that ranking, and `rungsSpent` has to account for every edit.
      const heaviest = (e) =>
        e.ends ? 'terminal' : e.c ? 'crumble' : e.d.length ? 'displace' : e.t.some((x) => x.startsWith('breach')) ? 'breach' : 'weaken';
      const want = ev === null ? ['quiet', 'starved'] : [heaviest(ev)];
      if (!want.includes(t.outcome)) throw new Error(`ply ${t.ply}: outcome ${t.outcome} disagrees with the event (${JSON.stringify(ev)})`);
      if (ev !== null) {
        const spent = t.rungsSpent ?? [];
        const edits = ev.d.length + ev.t.length + (ev.c ? 1 : 0);
        if (spent.length !== edits) throw new Error(`ply ${t.ply}: ${spent.length} rungs spent but ${edits} edits applied`);
        if (!spent.length) throw new Error(`ply ${t.ply}: quake recorded no rungs`);
        if (spent.length > t.budget) throw new Error(`ply ${t.ply}: spent ${spent.length} over budget ${t.budget}`);
        // At most one hole per quake — a pit is the heaviest thing the gods
        // do and two in a breath is a different mechanic.
        const holes = spent.filter((r) => r === 'crumble' || r === 'terminal').length;
        if (holes > 1) throw new Error(`ply ${t.ply}: ${holes} crumbles in one quake`);
        if (t.fellThrough !== spent.length < t.budget) throw new Error(`ply ${t.ply}: fellThrough disagrees with budget spend`);
      }
      if (t.outcome === 'quiet' && t.census !== null) throw new Error(`ply ${t.ply}: quiet ply computed a census`);
      if (t.outcome !== 'quiet') {
        if (!t.census || typeof t.census.lockedPawns !== 'number') throw new Error(`ply ${t.ply}: quake trace lacks census`);
        quakes++;
      }
    });
    if (!quakes) throw new Error('fixture produced no quakes — check the config');
    return `${dirTraces.length} traces, ${quakes} quakes, outcomes+paths consistent`;
  });

  // --- THE GODS v4 (designer 2026-09-05): memory, heat, protection --------
  // Every check here is a measured v3 defect turned into an invariant: the
  // meter banked debt past its ramp and a quake never spent it; a quake
  // touched the same square twice; the gods un-mated forced wins (a third of
  // the quakes that fired onto one, on the v3 corpora); and building an
  // attack read as boredom because only fifty-move events were "forcing".

  await check('v4 tactics: the ledger reads hang / fork / pin / skewer', () => {
    const L = (fen) => threatLedger(gridOf(fen, 8, 8), 8, 8);
    const fork = L('8/8/1q3r2/3N4/8/8/8/4K2k w - - 0 1');
    for (const k of ['hang:b6', 'hang:f6', 'fork:d5']) if (!fork.white.keys.has(k)) throw new Error(`fork fixture lacks ${k}`);
    for (const sq of ['d5', 'b6', 'f6']) if (!fork.white.pieces.has(sq)) throw new Error(`fork fixture does not protect ${sq}`);
    const pin = L('r3k3/8/2n5/1B6/8/8/8/4K3 w - - 0 1');
    if (!pin.white.keys.has('pin:c6')) throw new Error('pin fixture lacks pin:c6');
    if (!pin.white.squares.has('d7') || !pin.white.pieces.has('e8')) throw new Error('pin fixture: ray square d7 / king e8 not protected');
    const skewer = L('8/8/8/R3k2r/8/8/8/4K3 w - - 0 1');
    if (!skewer.white.keys.has('skewer:e5')) throw new Error('skewer fixture lacks skewer:e5');
    if (!skewer.white.pieces.has('h5')) throw new Error('skewer fixture: the piece behind is not protected');
    const quiet = L('4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1');
    if (quiet.white.keys.size || quiet.black.keys.size) throw new Error('a quiet opening reads as threats');
    // A new threat is the difference between two ledgers, for the MOVER only.
    const before = L('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    const rookLift = L('4k3/8/8/8/8/8/8/4K2R b - - 0 1'); // Ra1-h1: nothing new
    const attack = L('R3k3/8/8/8/8/8/8/4K3 b - - 0 1'); // Ra8+: the king is hit
    if (newThreats(before, rookLift, 'white').length) throw new Error('an idle rook lift counted as a threat');
    if (!newThreats(before, attack, 'white').length) throw new Error('Ra8+ created no threat key');
    return 'hang/fork/pin/skewer keys, pieces and ray squares; new-threat diff is mover-only';
  });

  await check('v4 meter: ceiling at the ramp, discharge on a quake, heat slows the fill', () => {
    const quiet = { capture: false, check: false, pawnAdvance: false, promotion: false, threat: false };
    const hot = { ...quiet, capture: true };
    const m = new RestlessnessMeter({ rampPlies: 10, sate: 3, stalenessFloor: 1, stalenessGain: 0, heatWindow: 4, heatGain: 1 });
    for (let i = 0; i < 40; i++) m.observe(quiet, 1);
    if (m.value !== 10) throw new Error(`meter overshot the ramp: ${m.value}`);
    m.observe(hot, 1);
    if (m.value !== 7) throw new Error(`one hot ply did not refund sate: ${m.value}`);
    if (m.discharge() !== 0) throw new Error('a quake did not discharge the meter');
    // A hot record fills slowly: 4 hot plies then a quiet one adds ~nothing;
    // a cold record fills at the full rate.
    const c = new RestlessnessMeter({ rampPlies: 10, sate: 3, stalenessFloor: 1, stalenessGain: 0, heatWindow: 4, heatGain: 1 });
    for (let i = 0; i < 4; i++) c.observe(hot, 1);
    if (c.heat !== 1) throw new Error(`heat after 4 hot plies should be 1, got ${c.heat}`);
    const before = c.value;
    c.observe(quiet, 1);
    if (c.value - before > 1e-9) throw new Error(`a quiet ply on a fully hot record still filled (${c.value - before})`);
    const cold = new RestlessnessMeter({ rampPlies: 10, sate: 3, stalenessFloor: 1, stalenessGain: 0, heatWindow: 4, heatGain: 1 });
    cold.observe(quiet, 1);
    if (Math.abs(cold.value - 1) > 1e-9) throw new Error(`a quiet ply on a cold record should fill 1, got ${cold.value}`);
    // A new threat or a CHECK heats but does not sate: the meter neither
    // fills nor refunds on such a ply, and the record reads it as hot. A
    // repeated position is cold whatever the move was.
    const t = new RestlessnessMeter({ rampPlies: 10, sate: 3, heatWindow: 4 });
    t.value = 5;
    t.observe({ ...quiet, threat: true }, 1);
    t.observe({ ...quiet, check: true }, 1);
    if (t.value !== 5) throw new Error(`a threat or check ply must leave the meter alone, got ${t.value}`);
    if (t.heat !== 1) throw new Error('threat and check plies must read as hot');
    const rep = new RestlessnessMeter({ rampPlies: 20, sate: 3, repBonus: 2, stalenessFloor: 1, stalenessGain: 0, heatGain: 0 });
    rep.value = 5;
    rep.observe({ ...hot, repetition: true }, 1);
    if (rep.value !== 8 || rep.window.at(-1) !== false) throw new Error(`a repeated position must be cold, capture or not (got ${rep.value})`);
    // relief 0 is v3's behaviour (never discharged) — the A/B control.
    const v3 = new RestlessnessMeter({ rampPlies: 10, relief: 0 });
    v3.value = 6;
    if (v3.discharge() !== 6) throw new Error('relief 0 must leave the meter alone');
    // The backstop floor counts plies since the LAST QUAKE (wave 6 games run
    // ~200 plies; a floor from ply 0 fired half of calm's quakes there).
    const fl = new RestlessnessMeter({ floorOnsetPly: 100, floorRampPlies: 100 });
    if (fl.floor(150) !== 0.5) throw new Error(`floor from ply 0: expected 0.5 at p150, got ${fl.floor(150)}`);
    fl.discharge(140);
    if (fl.floor(150) !== 0) throw new Error('a quake at p140 must restart the backstop');
    if (fl.floor(340) !== 1) throw new Error('the backstop must still reach 1 — the guarantee holds from the last quake');
    // Tedium is the cold share of the recent record — never discharged,
    // never sated, blind to threats — the ladder's clock.
    const td = new RestlessnessMeter({ rampPlies: 10, tediumPlies: 10, stalenessFloor: 1, stalenessGain: 0 });
    for (let i = 0; i < 20; i++) td.observe(quiet, 1);
    if (td.value !== 10 || td.t !== 1) throw new Error(`meter/tedium after 20 quiet plies: ${td.value}/${td.t}`);
    td.discharge(20);
    if (td.value !== 0 || td.t !== 1) throw new Error('a quake must discharge the meter and leave tedium alone');
    for (let i = 0; i < 5; i++) td.observe(hot, 1);
    if (Math.abs(td.t - 0.5) > 1e-9) throw new Error(`five events in a ten-ply window should read 0.5, got ${td.t}`);
    td.observe({ ...quiet, threat: true }, 1);
    if (Math.abs(td.t - 0.5) > 1e-9) throw new Error('a threat is not progress: tedium must not fall on it');
    // The dead-board backstop: on after a full dead window plus a cold
    // streak, gone the ply something irreversible happens.
    const db = new RestlessnessMeter({ tediumPlies: 10, tediumDeadAt: 0.8, coldStreak: 3, tediumFloor: 0.4 });
    for (let i = 0; i < 9; i++) db.observe(quiet, 1);
    if (db.deadFloor() !== 0) throw new Error('the dead floor must wait for a full window');
    db.observe(quiet, 1);
    if (db.deadFloor() !== 0.4) throw new Error(`a dead window + streak must raise the floor, got ${db.deadFloor()}`);
    db.observe(hot, 1);
    if (db.deadFloor() !== 0) throw new Error('one event must drop the dead floor');
    if (Math.abs(db.t - 0.9) > 1e-9) throw new Error(`tedium after one event in ten should be 0.9, got ${db.t}`);
    for (let i = 0; i < 3; i++) db.observe(quiet, 1);
    if (db.deadFloor() !== 0.4) throw new Error('the streak must rebuild the dead floor');
    return 'ceiling, sate, discharge, heat-scaled fill, threat = hot, relief 0 = v3, floor counts from the last quake, tedium undischarged';
  });

  await check('v4: nothing is touched twice in one quake, and the quake spends the meter', () => {
    // The replay fixture again, with a wide budget so several actions land
    // per quake — every square edited or vacated and every piece moved must
    // be unique within the quake, and the meter must read 0 afterwards.
    let quakes = 0;
    let multi = 0;
    for (const seed of [1, 2, 3, 4]) {
      const d = new Director({ ...dirCfg, extraActions: 3, seed });
      let fen = dirFen;
      for (let ply = 1; ply <= 24; ply++) {
        d.observePly(ffish, dirVariant, fen, 5, 6, QUIET_PLY);
        if (d.meter.value > d.meter.rampPlies + 1e-9) throw new Error(`meter above the ramp at ply ${ply}`);
        const q = d.quake(ffish, dirVariant, fen, 5, 6, ply);
        if (!q) continue;
        quakes++;
        const touched = [];
        const movers = [];
        for (const x of q.displacements) {
          if (movers.includes(x.from)) throw new Error(`seed ${seed} p${ply}: a piece moved twice (${x.piece} ${x.from}→${x.to})`);
          movers.push(x.to);
          touched.push(x.from, x.to);
        }
        for (const t of q.terrain) touched.push(t.square);
        if (q.crumble) touched.push(q.crumble.square);
        if (new Set(touched).size !== touched.length) throw new Error(`seed ${seed} p${ply}: a square was touched twice (${touched.join(' ')})`);
        if (touched.length > 1) multi++;
        if (d.lastTrace.meterAfter !== 0) throw new Error(`seed ${seed} p${ply}: meter after the quake is ${d.lastTrace.meterAfter}, not 0`);
        if (q.endsGame) break;
        fen = q.postFen;
      }
    }
    if (!multi) throw new Error('fixture produced no multi-action quake — the check is vacuous');
    return `${quakes} quakes (${multi} multi-action) over 4 seeds: no double-touch, meter discharged`;
  });

  await check('v4: a forced win survives the gods — mate-in-1, the trap set, the strip', () => {
    // The designer's treadmill, as an invariant: whichever side has a win on
    // the move must still have it on the board the gods hand back. The
    // unprotected control shows what v3 did to the same positions.
    const v8 = catalogVariantName(8, 8);
    const cases = [
      ['mate-in-1', '6k1/5ppp/8/8/8/2N5/1P4P1/R5K1 w - - 0 1'],
      ['trap set', '6k1/5ppp/8/8/8/2N5/1P4P1/R5K1 b - - 0 1'],
      ['mate-in-2 K+R', '6k1/7p/5K2/8/3n4/8/8/R7 w - - 0 1'],
      ['strip-in-1', '4k3/8/8/8/8/8/R2n4/4K3 w - - 0 1'],
    ];
    const flip = (fen) => fen.replace(/ ([wb]) /, (m, t) => (t === 'w' ? ' b ' : ' w '));
    const winsOn = (fen) => {
      let n = 0;
      for (const f of [fen, flip(fen)]) {
        if (ffish.validateFen(f, v8) !== 1) continue;
        const b = new ffish.Board(v8, f);
        n += winInOne(b).wins.length;
        b.delete();
      }
      return n;
    };
    let fired = 0;
    let unmatedControl = 0;
    let controlFired = 0;
    for (const [label, fen] of cases) {
      if (ffish.validateFen(fen, v8) !== 1) throw new Error(`${label}: fixture rejected`);
      if (!winsOn(fen)) throw new Error(`${label}: fixture has no win-in-1 to protect`);
      const fw = forcedWins(ffish, v8, fen, 8, 8);
      if (!fw.wins.white) throw new Error(`${label}: forcedWins found no white win`);
      for (let seed = 1; seed <= 6; seed++) {
        for (const protect of [true, seed <= 2 ? false : null]) {
          if (protect === null) continue;
          const d = new Director({ onsetPly: 0, rampPlies: 1, extraActions: 3, seed, protect });
          d.observePly(ffish, v8, fen, 8, 8, QUIET_PLY);
          d.meter.value = 1; // pinned: the roll always passes
          const q = d.quake(ffish, v8, fen, 8, 8, 5);
          if (!q) continue;
          const kept = winsOn(q.postFen) > 0;
          if (protect) {
            fired++;
            if (!kept) throw new Error(`${label} seed ${seed}: the gods un-mated it — ${JSON.stringify(d.lastTrace.chosen)}`);
            if (!d.lastTrace.protected || !(d.lastTrace.protected.pieces > 0)) throw new Error(`${label}: trace carries no protected census`);
          } else {
            controlFired++;
            if (!kept) unmatedControl++;
          }
        }
      }
    }
    if (!fired) throw new Error('no protected quake fired — the check is vacuous');
    return `${fired} protected quakes kept the win; unprotected control un-mated ${unmatedControl}/${controlFired}`;
  });

  await check('v4.2: the engine\'s mate line is protected — grid search off', () => {
    // A search result as the duel hands it to the Director: a mate score and
    // a principal variation. Replayed on ffish, every mover, destination and
    // path joins the protected set, and so does the loser's king zone. With
    // the grid search OFF (winDepth 0) the line is the ONLY protection, so a
    // kept win proves the engine's data reached the gods.
    const v8 = catalogVariantName(8, 8);
    const fen = '6k1/7p/5K2/8/3n4/8/8/R7 w - - 0 1'; // 1.Rb1 (Kf8 / h6) 2.Rb8#
    const hint = { fen, score: { type: 'mate', value: 2 }, pv: ['a1b1', 'g8f8', 'b1b8'], source: 'test' };
    const nets = mateNets(ffish, v8, fen, 8, 8, [hint]);
    if (nets.lines[0]?.played !== 3) throw new Error(`the PV did not replay: ${JSON.stringify(nets.lines)}`);
    for (const sq of ['a1', 'g8']) if (!nets.pieces.has(sq)) throw new Error(`${sq} should be a protected piece`);
    for (const sq of ['b1', 'b4', 'b8', 'f8', 'h8']) if (!nets.squares.has(sq)) throw new Error(`${sq} should be a protected square (path / zone)`);
    const stale = mateNets(ffish, v8, fen, 8, 8, [{ ...hint, pv: ['a1b1', 'g8g7', 'b1b8'] }]); // g8g7 is illegal
    if (stale.lines[0]?.played !== 1) throw new Error('a stale PV must stop at the first illegal move and keep what it had');
    const replays = (post) => mateNets(ffish, v8, post, 8, 8, [{ ...hint, fen: post }]).lines[0]?.played === 3;
    let kept = 0;
    let fired = 0;
    let controlBroke = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (const mates of [[hint], []]) {
        const d = new Director({ onsetPly: 0, rampPlies: 1, extraActions: 3, seed, protect: true, winDepth: 0 });
        d.observePly(ffish, v8, fen, 8, 8, QUIET_PLY);
        d.meter.value = 1;
        d.meter.cold = Array(10).fill(true); // a dead record: the budget opens
        const roll = d.rollQuake(ffish, v8, fen, 8, 8, 5);
        if (!roll.due) throw new Error('a pinned meter must roll a quake');
        const q = d.quake(ffish, v8, fen, 8, 8, 5, { rolled: roll, mates });
        if (!q) continue;
        if (mates.length) {
          fired++;
          if (!d.lastTrace.protected?.engine?.mates) throw new Error('the trace does not show the engine line');
          if (replays(q.postFen)) kept++;
          else throw new Error(`seed ${seed}: the line broke — ${JSON.stringify(d.lastTrace.chosen)}`);
        } else if (!replays(q.postFen)) controlBroke++;
      }
    }
    if (!fired) throw new Error('no protected quake fired');
    return `${kept}/${fired} kept the engine's line with the grid search off; control broke it ${controlBroke}/6`;
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

  // --- Board renderer (2026-09-02 UI refresh) --------------------------------
  // The only automated net the renderer has: a detached board, the tile
  // classes from the Director ledgers, the edge coordinates, the per-rung
  // residue marks and the ranked arrow layer. Looks are the phone's job.
  await check('board renderer: tiles from ledgers, coordinates, rung marks, ranked arrows', async () => {
    const host = document.createElement('div');
    const ui = new BoardUI(host, { files: 4, ranks: 5 });
    const has = (sq, cls) => ui.cellClasses(sq).includes(cls);
    // Ranks top→bottom: rank 2 holds crates on c2/d2, rank 1 walls on a1/b1.
    const fen = '4/4/4/2^^/**2 w - - 0 1';
    ui.setPosition(fen, { holes: new Set(['b1']), godCrates: new Set(['d2', 'zz9']), skins: { c2: 'door', d2: 'barrel' } });
    if (!has('a1', 'wall') || has('a1', 'hole')) throw new Error(`a1 should be an authored wall: ${ui.cellClasses('a1')}`);
    if (!has('b1', 'hole') || has('b1', 'wall')) throw new Error(`b1 should be a hole: ${ui.cellClasses('b1')}`);
    if (!has('c2', 'furniture') || has('c2', 'cracked')) throw new Error(`c2 should be a plain crate: ${ui.cellClasses('c2')}`);
    if (!has('d2', 'furniture') || !has('d2', 'cracked')) throw new Error(`d2 should be a cracked wall: ${ui.cellClasses('d2')}`);
    if (!has('c2', 'skin-door')) throw new Error(`c2 should wear its door skin: ${ui.cellClasses('c2')}`);
    if (has('d2', 'skin-barrel')) throw new Error('a god-cracked wall never takes a skin');
    if (has('a3', 'wall') || has('a3', 'hole') || has('a3', 'furniture')) throw new Error('a3 should be bare floor');
    for (const sq of ['c2', 'd2']) {
      if (!host.querySelector(`[data-square="${sq}"] .piece.neutral`)) throw new Error(`${sq}: both crate kinds keep the one neutral sprite`);
    }
    // No ledgers (the setup preview): every '*' is stone, every '^' a crate.
    ui.setPosition(fen);
    if (!has('b1', 'wall') || has('b1', 'hole') || has('d2', 'cracked')) throw new Error('bare setPosition must paint authored terrain only');
    if (has('c2', 'skin-door')) throw new Error('a repaint without skins must drop the old skin class');
    // A held terrain-fx class is stripped by the commit.
    host.querySelector('[data-square="a1"]').classList.add('cracking');
    ui.setPosition(fen);
    if (has('a1', 'cracking')) throw new Error('setPosition must strip held fx classes');
    await ui.animateTerrain('a1', 'weaken', 0, { hold: true }); // ms=0: no-op (reduced motion)
    if (has('a1', 'cracking')) throw new Error('animateTerrain with ms=0 must not touch the cell');
    // Coordinates: file letters along the bottom row, rank numbers down the left column.
    const files = [...host.querySelectorAll('.coord-file')].map((el) => el.textContent).join('');
    const ranks = [...host.querySelectorAll('.coord-rank')].map((el) => el.textContent).join(',');
    if (files !== 'abcd') throw new Error(`file coordinates: ${files}`);
    if (ranks !== '5,4,3,2,1') throw new Error(`rank coordinates: ${ranks}`);
    if (host.querySelectorAll('[data-square="a1"] .coord').length !== 2) throw new Error('a1 carries both coordinates');
    // Terrain residue, one class per rung; a displacement and the enemy's
    // last move are ARROWS alone (round 13: no square marks for moves);
    // hints ranked, the quake arrow beneath everything, the last move
    // above it.
    ui.setMarks({
      cracked: ['a1'],
      breached: ['c2'],
      pit: 'b1',
      arrows: [
        { from: 'a3', to: 'a4', strength: 1, rank: 1, kind: 'hint', label: '+0.8' },
        { from: 'b3', to: 'b4', strength: 0.5, rank: 2, kind: 'hint' },
        { from: 'c3', to: 'c4', strength: 0.2, rank: 3, kind: 'hint' },
        { from: 'd3', to: 'd4', strength: 0.7, kind: 'quake' },
        { from: 'a2', to: 'b2', strength: 1, kind: 'last' },
      ],
    });
    for (const [sq, cls] of [['a1', 'fresh-crack'], ['c2', 'fresh-breach'], ['b1', 'fresh-pit']]) {
      if (!has(sq, cls)) throw new Error(`${sq} should carry ${cls}: ${ui.cellClasses(sq)}`);
    }
    for (const sq of ['d3', 'd4', 'a2', 'b2']) {
      if (ui.cellClasses(sq).some((c) => ['quake-from', 'quake-to', 'last'].includes(c))) throw new Error(`${sq}: a move is an arrow, never a square mark: ${ui.cellClasses(sq)}`);
    }
    const gs = [...host.querySelectorAll('.arrow-layer g.arrow')];
    if (gs.length !== 5) throw new Error(`expected 5 arrows, got ${gs.length}`);
    if (!gs[0].classList.contains('arrow-quake')) throw new Error('the quake arrow must draw first (beneath everything)');
    if (!gs[1].classList.contains('arrow-last')) throw new Error('the last-move arrow draws above the quake arrow, beneath the hints');
    if (gs[1].querySelectorAll('.halo').length !== 2 || gs[1].querySelector('line:not(.halo)') === null) throw new Error('the last-move arrow is drawn like every other: halo line + head, shaft, head');
    const rankOrder = gs.slice(2).map((g) => g.dataset.rank).join('');
    if (rankOrder !== '321') throw new Error(`hint arrows must draw worst→best (best on top), got ranks ${rankOrder}`);
    if (!gs[4].classList.contains('rank-1') || !gs[4].classList.contains('arrow-hint')) throw new Error('rank-1 hint arrow class missing');
    const bestWidth = parseFloat(gs[4].querySelector('line:not(.halo)').getAttribute('stroke-width'));
    if (!(bestWidth > 2.4 && bestWidth < 2.6)) throw new Error(`a labelled arrow's shaft should be 2.5 viewBox units (25% of a cell), got ${bestWidth}`);
    const rank2Width = parseFloat(gs[3].querySelector('line:not(.halo)').getAttribute('stroke-width'));
    if (!(rank2Width > 1.6 && rank2Width < 2.0)) throw new Error(`an unlabelled arrow's shaft scales with strength (~1.8 at 0.5), got ${rank2Width}`);
    if (gs[4].querySelectorAll('.halo').length !== 2) throw new Error('every arrow carries a halo line + head');
    const labelEl = gs[4].querySelector('text.label');
    if (labelEl?.textContent !== '+0.8') throw new Error('the rank-1 arrow carries its eval label');
    if (!/^rotate\(-?\d+(\.\d+)? /.test(labelEl.getAttribute('transform') ?? '')) throw new Error('the label runs along the arrow (rotate transform)');
    const fs = parseFloat(labelEl.getAttribute('font-size'));
    if (!(fs >= 1.3 && fs <= 2.0)) throw new Error(`label font sized to the shaft, got ${fs}`);
    if (gs[4].querySelector('rect') || gs[4].querySelector('text.label-halo')) throw new Error('no box or halo twin behind the label — the eval sits inside the arrow');
    if (gs[3].querySelector('text.label')) throw new Error('an arrow without a label draws none');
    ui.setMarks({});
    if (host.querySelector('.arrow-layer g.arrow') || has('a1', 'fresh-crack') || has('b1', 'fresh-pit')) throw new Error('setMarks({}) must clear marks and arrows');
    return 'wall/hole/crate/cracked (+ a door skin) from the ledgers, a–d + 5–1 coordinates, 3 terrain rung marks, arrows ranked 3→2→1 over the last-move arrow over the quake arrow, eval label on rank 1';
  });

  // --- Art themes (2026-09-03): the repacked tilesets ride a data-theme
  // attribute; wall RUNS and floor VARIANTS are classes the themes paint.
  // (selftest.html loads no stylesheet — computed looks are ui-smoke's job.)
  await check('board renderer: art themes, wall autotile masks, floor variants', async () => {
    const host = document.createElement('div');
    const ui = new BoardUI(host, { files: 4, ranks: 5 });
    const has = (sq, cls) => ui.cellClasses(sq).includes(cls);
    const mask = (sq) => ui.cellClasses(sq).find((c) => c.startsWith('wm-')) ?? null;
    // a1–a3 a stone column, b5–d5 a stone row, c3 a lone block.
    const fen = '1***/4/*1*1/*3/*3 w - - 0 1';
    ui.setPosition(fen);
    // Mask bits N=1 E=2 S=4 W=8.
    for (const [sq, want] of [['a1', 'wm-1'], ['a2', 'wm-5'], ['a3', 'wm-4'], ['b5', 'wm-2'], ['c5', 'wm-10'], ['d5', 'wm-8'], ['c3', 'wm-0']]) {
      if (mask(sq) !== want) throw new Error(`${sq} autotile case: want ${want}, got ${mask(sq)} (${ui.cellClasses(sq)})`);
    }
    if (mask('b3') !== null) throw new Error('floor carries no autotile class');
    // A hole is not solid (it breaks the column); a cracked wall and a door are; a crate is not.
    ui.setPosition(fen, { holes: new Set(['a2']) });
    if (mask('a1') !== 'wm-0' || mask('a3') !== 'wm-0' || mask('a2') !== 'wm-0') throw new Error(`a hole between two walls must break the column, and wears its own lone-pit case (${mask('a1')}, ${mask('a2')}, ${mask('a3')})`);
    ui.setPosition('1***/4/*1*1/^3/*3 w - - 0 1', { godCrates: new Set(['a2']) });
    if (mask('a1') !== 'wm-1' || mask('a2') !== 'wm-5' || mask('a3') !== 'wm-4') throw new Error(`a cracked wall continues the column (${mask('a1')}, ${mask('a2')}, ${mask('a3')})`);
    ui.setPosition('1***/4/*1*1/^3/*3 w - - 0 1', { skins: { a2: 'door' } });
    if (mask('a1') !== 'wm-1' || mask('a3') !== 'wm-4' || mask('a2') !== 'wm-5') throw new Error(`a door continues the column, and as a weak spot wears the column's own case (${mask('a1')}, ${mask('a2')}, ${mask('a3')})`);
    ui.setPosition('1***/4/*1*1/^3/*3 w - - 0 1', { skins: { a2: 'crate' } });
    if (mask('a1') !== 'wm-0' || mask('a3') !== 'wm-0') throw new Error(`a crate does not continue the wall line (${mask('a1')}, ${mask('a3')})`);
    ui.setPosition(fen);
    if (mask('a1') !== 'wm-1' || mask('c3') !== 'wm-0') throw new Error('masks must be recomputed on every paint');
    // A door in a north–south line is a WEAK SPOT wearing the wall's own
    // autotile case; in an east–west line it is the door leaf.
    ui.setPosition('1***/4/*1*1/^3/*3 w - - 0 1', { skins: { a2: 'door' } });
    if (!has('a2', 'weak') || mask('a2') !== 'wm-5') throw new Error(`a door between a1 and a3 is a weak spot in the column: ${ui.cellClasses('a2')}`);
    ui.setPosition('1*^*/4/4/4/4 w - - 0 1', { skins: { c5: 'door' } });
    if (has('c5', 'weak') || mask('c5') !== null || !has('c5', 'skin-door')) throw new Error(`a door between b5 and d5 is the leaf, no wall case: ${ui.cellClasses('c5')}`);
    // MASONRY (2026-09-04) is a weak spot WHEREVER it stands — the wall
    // block with the crack, never the retired rubble heap — and it
    // continues a wall line like the stone it is.
    ui.setPosition('1***/4/*1*1/^3/*3 w - - 0 1', { skins: { a2: 'masonry' } });
    if (!has('a2', 'weak') || mask('a2') !== 'wm-5' || mask('a1') !== 'wm-1' || mask('a3') !== 'wm-4') throw new Error(`masonry is a weak spot continuing the column (${ui.cellClasses('a2')}, ${mask('a1')}, ${mask('a3')})`);
    ui.setPosition('4/4/2^1/4/4 w - - 0 1', { skins: { c3: 'masonry' } });
    if (!has('c3', 'weak') || mask('c3') !== 'wm-0') throw new Error(`masonry alone on the floor is still a weak spot, lone-block case: ${ui.cellClasses('c3')}`);
    // DOUBLE DOORS (round 16): two door skins side by side in a rank pair
    // into one two-wide door, west leaf left, east leaf right; a run of
    // three is a double and a single; a vertical pair is two weak spots.
    ui.setPosition('*^^*/4/4/4/4 w - - 0 1', { skins: { b5: 'door', c5: 'door' } });
    if (!has('b5', 'door2-l') || !has('c5', 'door2-r') || has('b5', 'door2-r') || has('c5', 'door2-l')) throw new Error(`b5+c5 doors are one double door: ${ui.cellClasses('b5')} / ${ui.cellClasses('c5')}`);
    ui.setPosition('^^^1/4/4/4/4 w - - 0 1', { skins: { a5: 'door', b5: 'door', c5: 'door' } });
    if (!has('a5', 'door2-l') || !has('b5', 'door2-r') || has('c5', 'door2-l') || has('c5', 'door2-r')) throw new Error(`three doors in a row: a double and a single (${ui.cellClasses('c5')})`);
    ui.setPosition('1***/4/*1*1/^3/^3 w - - 0 1', { skins: { a1: 'door', a2: 'door' } });
    if (has('a1', 'door2-l') || has('a1', 'door2-r') || has('a2', 'door2-l') || has('a2', 'door2-r') || !has('a2', 'weak')) throw new Error(`doors stacked in a column never pair (${ui.cellClasses('a2')})`);
    // Round 17: the pair is AUTHORED — a leaf keeps its half after its
    // partner is god-cracked, captured or burst (the half paints only on a
    // leaf that still stands).
    ui.setPosition('*^^*/4/4/4/4 w - - 0 1', { skins: { b5: 'door', c5: 'door' }, godCrates: new Set(['c5']) });
    if (!has('b5', 'door2-l') || !has('c5', 'cracked') || has('c5', 'door2-r')) throw new Error(`a god-cracked partner is stone, the other leaf keeps its half: ${ui.cellClasses('b5')} / ${ui.cellClasses('c5')}`);
    ui.setPosition('*^1*/4/4/4/4 w - - 0 1', { skins: { b5: 'door', c5: 'door' }, opened: new Set(['c5']) });
    if (!has('b5', 'door2-l') || has('c5', 'door2-r') || has('c5', 'door2-l')) throw new Error(`a captured leaf leaves the other as its half of the double, not a single leaf: ${ui.cellClasses('b5')} / ${ui.cellClasses('c5')}`);
    ui.setPosition('4/4/4/4/4 w - - 0 1');
    if (has('b5', 'door2-l') || has('c5', 'door2-r')) throw new Error('the pair classes clear on repaint');
    // SKIN VARIANTS: every cell carries exactly one stable sv1…svN class.
    for (const [sq, cls] of [['a1', ui.cellClasses('a1')], ['d5', ui.cellClasses('d5')]]) {
      const sv = cls.filter((c) => /^sv\d+$/.test(c));
      if (sv.length !== 1) throw new Error(`${sq} carries one skin-variant class, got ${sv.join(',') || 'none'}`);
    }
    // Piece sprites: every piece carries its FEN letter; the set is an attribute.
    ui.setPosition('k3/4/4/4/K2P w - - 0 1');
    const at = (sq) => host.querySelector(`[data-square="${sq}"] .piece`)?.dataset.piece ?? null;
    if (at('a1') !== 'K' || at('d1') !== 'P' || at('a5') !== 'k') throw new Error(`pieces carry data-piece (${at('a1')}, ${at('d1')}, ${at('a5')})`);
    ui.setPieces('pixel-chess');
    if (ui.pieces !== 'pixel-chess' || host.dataset.pieces !== 'pixel-chess') throw new Error('setPieces must stamp data-pieces');
    // The fit dials are published on the board; pixel-perfect stamps its
    // attribute (the box itself needs a laid-out board — ui-smoke measures it).
    ui.setPieceFit({ scale: 1.2, lift: 0.25, shift: -0.1, snap: true });
    const pf = ui.pieceFit;
    if (pf.scale !== 1.2 || pf.lift !== 0.25 || pf.shift !== -0.1 || !pf.snap || !('pieceSnap' in host.dataset)) throw new Error(`setPieceFit must publish the dials: ${JSON.stringify(pf)}`);
    ui.setPieceFit({});
    if (ui.pieceFit.scale !== null || ui.pieceFit.lift !== null || ui.pieceFit.snap || 'pieceSnap' in host.dataset) throw new Error('setPieceFit({}) clears to the CSS defaults');
    ui.setPieces('no-such-set');
    if (ui.pieces !== null) throw new Error('an unknown piece set clears to the glyphs');
    ui.setDoors('castle');
    if (ui.doors !== 'castle' || host.dataset.doors !== 'castle') throw new Error('setDoors must stamp data-doors');
    ui.setDoors(null);
    if (ui.doors !== null) throw new Error('setDoors(null) clears to the theme door');
    const at1 = (sq) => host.querySelector(`[data-square="${sq}"] .piece`)?.dataset.piece ?? null;
    // Residue: an opened doorway is a decor on a floor square wearing the
    // east/west mask of its STANDING walls (its posts); a broken wall is a
    // RUIN cell wearing the 4-bit case of its standing neighbours; and both
    // count as solid to the walls beside them — no end caps at a break.
    // Rank 1 here is wall, ruin, wall: one east–west line.
    ui.setPosition('4/4/4/4/*1*1 w - - 0 1', { opened: new Set(['d3']), rubble: new Set(['b1', 'zz9']) });
    const dec = (sq) => host.querySelector(`[data-square="${sq}"] .decor`)?.className ?? null;
    if (dec('d3') !== 'decor decor-doorway') throw new Error(`doorway decor (${dec('d3')})`);
    if (!has('b1', 'ruin') || mask('b1') !== 'wm-10' || dec('b1') !== null) throw new Error(`a broken wall between two walls is a ruin wearing the east–west stub case: ${ui.cellClasses('b1')}`);
    if (mask('a1') !== 'wm-2' || mask('c1') !== 'wm-8') throw new Error(`the walls run on into the ruin (${mask('a1')}, ${mask('c1')})`);
    ui.setPosition('4/4/4/4/*1*1 w - - 0 1', { opened: new Set(['b1']) });
    if (has('b1', 'ruin') || mask('b1') !== 'wm-10' || dec('b1') !== 'decor decor-doorway' || mask('a1') !== 'wm-2') throw new Error(`an opened doorway keeps the wall line too, and wears the full frame between two walls: ${ui.cellClasses('b1')} / ${mask('a1')}`);
    ui.setPosition('4/4/4/1^2/*1*1 w - - 0 1', { opened: new Set(['b2']), rubble: new Set(['b1']) });
    if (dec('b2') !== null) throw new Error('a square that is furniture again carries no doorway decor');
    ui.setPosition('4/4/4/4/*K*1 w - - 0 1', { rubble: new Set(['b1']) });
    if (!has('b1', 'ruin') || mask('b1') !== 'wm-10' || at1('b1') !== 'K') throw new Error(`a piece standing on a ruin leaves the stub under it: ${ui.cellClasses('b1')}`);
    ui.setPosition('4/4/4/4/*1*1 w - - 0 1');
    if (has('b1', 'ruin') || mask('b1') !== null || mask('a1') !== 'wm-0') throw new Error(`the ruin and its case go when the ledger forgets the square: ${ui.cellClasses('b1')} / ${mask('a1')}`);
    // Round 12: a ruin's stub case counts STANDING walls only. Two broken
    // squares side by side show no stub at each other (each used to draw
    // one — a clump of wall floating between two floor squares), a ruin
    // beside an opened doorway shows none toward the doorway's post, and
    // the walls still run on into every kind of residue.
    ui.setPosition('4/4/4/4/*2* w - - 0 1', { rubble: new Set(['b1', 'c1']) });
    if (mask('b1') !== 'wm-8' || mask('c1') !== 'wm-2') throw new Error(`adjacent ruins show only the standing walls' ends (${mask('b1')}, ${mask('c1')})`);
    if (mask('a1') !== 'wm-2' || mask('d1') !== 'wm-8') throw new Error(`the walls still run on into adjacent ruins (${mask('a1')}, ${mask('d1')})`);
    ui.setPosition('4/4/4/4/*2* w - - 0 1', { rubble: new Set(['c1']), opened: new Set(['b1']) });
    if (mask('c1') !== 'wm-2' || dec('b1') !== 'decor decor-doorway' || mask('a1') !== 'wm-2' || mask('d1') !== 'wm-8') throw new Error(`a ruin beside an opened doorway shows no stub toward it, and the line runs on (${mask('c1')}, ${dec('b1')}, ${mask('a1')}, ${mask('d1')})`);
    ui.setPosition('*3/4/4/*3/4 w - - 0 1', { rubble: new Set(['a4', 'a3']) });
    if (mask('a5') !== 'wm-4' || mask('a4') !== 'wm-1' || mask('a3') !== 'wm-4' || mask('a2') !== 'wm-1') throw new Error(`a broken column shows one stub per standing end (${mask('a5')}, ${mask('a4')}, ${mask('a3')}, ${mask('a2')})`);
    ui.setPosition('4/4/4/4/*3 w - - 0 1', { rubble: new Set(['b1', 'c1', 'd1']) });
    if (mask('b1') !== 'wm-8' || mask('c1') !== 'wm-0' || mask('d1') !== 'wm-0') throw new Error(`a ruin among ruins is flecks alone (${mask('b1')}, ${mask('c1')}, ${mask('d1')})`);
    // A cracked wall or a standing door beside a ruin IS a wall end; a
    // crate or a hole is not.
    ui.setPosition('4/4/4/4/*^1* w - - 0 1', { godCrates: new Set(['b1']), rubble: new Set(['c1']) });
    if (mask('c1') !== 'wm-10') throw new Error(`a cracked wall beside a ruin is a wall end (${mask('c1')})`);
    ui.setPosition('4/4/4/4/*^1* w - - 0 1', { skins: { b1: 'door' }, rubble: new Set(['c1']) });
    if (mask('c1') !== 'wm-10') throw new Error(`a standing door beside a ruin is a wall end (${mask('c1')})`);
    ui.setPosition('4/4/4/4/*^1* w - - 0 1', { skins: { b1: 'crate' }, rubble: new Set(['c1']) });
    if (mask('c1') !== 'wm-2') throw new Error(`a crate beside a ruin is no wall end (${mask('c1')})`);
    ui.setPosition('4/4/4/4/**1* w - - 0 1', { holes: new Set(['b1']), rubble: new Set(['c1']) });
    if (mask('c1') !== 'wm-2') throw new Error(`a hole beside a ruin is no wall end (${mask('c1')})`);
    // …and a DOORWAY's posts stand only beside standing walls: one post
    // beside a break (the west post = wm-8, the east = wm-2), none between
    // two breaks (wm-0) — the frame's post fell with the wall it framed.
    ui.setPosition('4/4/4/4/*2* w - - 0 1', { opened: new Set(['b1']), rubble: new Set(['c1']) });
    if (mask('b1') !== 'wm-8' || dec('b1') !== 'decor decor-doorway') throw new Error(`a doorway with its east wall broken keeps the west post only (${mask('b1')}, ${dec('b1')})`);
    ui.setPosition('4/4/4/4/*2* w - - 0 1', { opened: new Set(['c1']), rubble: new Set(['b1']) });
    if (mask('c1') !== 'wm-2' || dec('c1') !== 'decor decor-doorway') throw new Error(`a doorway with its west wall broken keeps the east post only (${mask('c1')}, ${dec('c1')})`);
    ui.setPosition('4/4/4/4/4 w - - 0 1', { opened: new Set(['b1']), rubble: new Set(['a1', 'c1']) });
    if (mask('b1') !== 'wm-0' || dec('b1') !== 'decor decor-doorway' || !has('b1', 'wm-0')) throw new Error(`a doorway between two breaks has no posts (${mask('b1')}, ${dec('b1')})`);
    ui.setPosition('4/4/4/4/1*2 w - - 0 1', { opened: new Set(['c1']) });
    if (mask('c1') !== 'wm-8') throw new Error(`a doorway's post stands beside its wall, none beside plain floor (${mask('c1')})`);
    ui.setPosition('4/4/4/4/4 w - - 0 1');
    if (mask('b1') !== null || dec('b1') !== null) throw new Error('a forgotten doorway leaves neither decor nor case');
    // Every cell carries ONE crack drawing (ck1…ckN, round 14), fixed by its
    // square: a repaint never swaps it.
    const ck = (sq) => ui.cellClasses(sq).filter((c) => /^ck[1-4]$/.test(c));
    if (ck('a1').length !== 1 || ck('d5').length !== 1) throw new Error(`one crack variant per cell (${ck('a1')}, ${ck('d5')})`);
    const ckBefore = ck('a1')[0];
    ui.setPosition('1***/4/*1*1/*3/*3 w - - 0 1', { godCrates: new Set(['a2']) });
    if (ck('a1')[0] !== ckBefore) throw new Error('a repaint must not swap a crack variant');
    // Holes autotile too (round 13): a pit's case joins other pits only —
    // never a wall — so joined pits read as one and a pit beside stone
    // keeps its rim.
    ui.setPosition('4/4/4/4/**2 w - - 0 1', { holes: new Set(['a1', 'b1']) });
    if (mask('a1') !== 'wm-2' || mask('b1') !== 'wm-8') throw new Error(`joined pits are one pit (${mask('a1')}, ${mask('b1')})`);
    ui.setPosition('4/4/4/**2/**2 w - - 0 1', { holes: new Set(['a1', 'b1', 'a2', 'b2']) });
    if (mask('a2') !== 'wm-6' || mask('b2') !== 'wm-12' || mask('a1') !== 'wm-3' || mask('b1') !== 'wm-9') throw new Error(`a 2×2 pit, N=1 E=2 S=4 W=8 (${mask('a2')}, ${mask('b2')}, ${mask('a1')}, ${mask('b1')})`);
    ui.setPosition('4/4/4/4/**2 w - - 0 1', { holes: new Set(['a1']) });
    if (mask('a1') !== 'wm-0' || mask('b1') !== 'wm-0') throw new Error(`a pit beside a wall: neither joins the other (${mask('a1')}, ${mask('b1')})`);
    // Props: wall props only — the floor litter is packed away (round 10).
    ui.setPosition('****/4/4/4/4 w - - 0 1');
    for (const d of host.querySelectorAll('.decor')) {
      if (!['decor decor-torch', 'decor decor-banner', 'decor decor-chain'].includes(d.className)) throw new Error(`floor litter is packed away; found ${d.className}`);
      if (!d.parentElement.classList.contains('wall')) throw new Error(`a prop off a wall face: ${d.className} on ${d.parentElement.dataset.square}`);
    }
    // Diagonals: a thick 2×2 block fills its inner corners (NE=16 SE=32
    // SW=64 NW=128), and a diagonal alone never counts.
    ui.setPosition('4/4/4/**2/**2 w - - 0 1');
    for (const [sq, want] of [['a2', 'wm-38'], ['b2', 'wm-76'], ['a1', 'wm-19'], ['b1', 'wm-137']]) {
      if (mask(sq) !== want) throw new Error(`2×2 block ${sq}: want ${want}, got ${mask(sq)}`);
    }
    ui.setPosition('4/4/4/1*2/*3 w - - 0 1');
    if (mask('a1') !== 'wm-0' || mask('b2') !== 'wm-0') throw new Error(`diagonal-only neighbours do not join (${mask('a1')}, ${mask('b2')})`);
    // Floor variants: one per square, stable across repaints, f1 the
    // majority and several of f2…f6 scattered over an 8×8.
    const variants = (sq) => ui.cellClasses(sq).filter((c) => /^f[1-6]$/.test(c));
    const before = {};
    for (const [sq] of ui.cells) {
      const v = variants(sq);
      if (v.length !== 1) throw new Error(`${sq} must carry exactly one floor variant: ${v}`);
      before[sq] = v[0];
    }
    ui.setPosition(fen);
    for (const [sq] of ui.cells) if (variants(sq)[0] !== before[sq]) throw new Error(`${sq}: the floor variant must not change on repaint`);
    {
      const big = new BoardUI(document.createElement('div'), { files: 8, ranks: 8 });
      const tally = {};
      for (const [sq] of big.cells) {
        const v = big.cellClasses(sq).find((c) => /^f[1-6]$/.test(c));
        tally[v] = (tally[v] ?? 0) + 1;
      }
      const kinds = Object.keys(tally).filter((k) => k !== 'f1').length;
      if (!(tally.f1 > 32) || kinds < 3) throw new Error(`8×8 floor: f1 should dominate with several variants scattered (${JSON.stringify(tally)})`);
    }
    // The theme attribute.
    if (ui.theme !== null || host.dataset.theme !== undefined) throw new Error('a fresh board wears no theme');
    ui.setTheme('crypt');
    if (ui.theme !== 'crypt' || host.dataset.theme !== 'crypt') throw new Error(`setTheme must stamp data-theme (${host.dataset.theme})`);
    ui.setTheme(null);
    if (ui.theme !== null || 'theme' in host.dataset) throw new Error('setTheme(null) must clear data-theme');
  });

  finish(null);
}

main().catch((e) => {
  report(false, 'selftest crashed', e && e.message ? e.message : String(e));
  finish('crashed');
});
