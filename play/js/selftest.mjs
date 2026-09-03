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
  // 3x5 IS the real minimum the setup screen serves (s01-the-closet). ---
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
    // The ladder escalates: crumble weight is zero at low pressure and the
    // top rungs only open up as the meter climbs.
    d.meter.value = 0;
    const lo = d.rungWeights(20);
    if (lo.crumble !== 0 || lo.displace !== 0) throw new Error('low pressure must not reach the destructive rungs');
    if (!(lo.weaken > 0)) throw new Error('weaken must always be on the menu');
    d.meter.value = 8; // full ramp after the tune above → pressure 1
    const hi = d.rungWeights(20);
    if (!(hi.crumble > 0) || !(hi.displace > lo.displace)) throw new Error('high pressure must open the destructive rungs');
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
    // Residue marks, one class per rung; arrows ranked, the quake arrow beneath.
    ui.setMarks({
      cracked: ['a1'],
      breached: ['c2'],
      pit: 'b1',
      quakeFrom: ['a3'],
      quakeTo: ['a4'],
      arrows: [
        { from: 'a3', to: 'a4', strength: 1, rank: 1, kind: 'hint', label: '+0.8' },
        { from: 'b3', to: 'b4', strength: 0.5, rank: 2, kind: 'hint' },
        { from: 'c3', to: 'c4', strength: 0.2, rank: 3, kind: 'hint' },
        { from: 'd3', to: 'd4', strength: 0.7, kind: 'quake' },
      ],
    });
    for (const [sq, cls] of [['a1', 'fresh-crack'], ['c2', 'fresh-breach'], ['b1', 'fresh-pit'], ['a3', 'quake-from'], ['a4', 'quake-to']]) {
      if (!has(sq, cls)) throw new Error(`${sq} should carry ${cls}: ${ui.cellClasses(sq)}`);
    }
    const gs = [...host.querySelectorAll('.arrow-layer g.arrow')];
    if (gs.length !== 4) throw new Error(`expected 4 arrows, got ${gs.length}`);
    if (!gs[0].classList.contains('arrow-quake')) throw new Error('the quake arrow must draw first (beneath the hints)');
    const rankOrder = gs.slice(1).map((g) => g.dataset.rank).join('');
    if (rankOrder !== '321') throw new Error(`hint arrows must draw worst→best (best on top), got ranks ${rankOrder}`);
    if (!gs[3].classList.contains('rank-1') || !gs[3].classList.contains('arrow-hint')) throw new Error('rank-1 hint arrow class missing');
    const bestWidth = parseFloat(gs[3].querySelector('line:not(.halo)').getAttribute('stroke-width'));
    if (!(bestWidth > 2.4 && bestWidth < 2.6)) throw new Error(`a labelled arrow's shaft should be 2.5 viewBox units (25% of a cell), got ${bestWidth}`);
    const rank2Width = parseFloat(gs[2].querySelector('line:not(.halo)').getAttribute('stroke-width'));
    if (!(rank2Width > 1.6 && rank2Width < 2.0)) throw new Error(`an unlabelled arrow's shaft scales with strength (~1.8 at 0.5), got ${rank2Width}`);
    if (gs[3].querySelectorAll('.halo').length !== 2) throw new Error('every arrow carries a halo line + head');
    const labelEl = gs[3].querySelector('text.label');
    if (labelEl?.textContent !== '+0.8') throw new Error('the rank-1 arrow carries its eval label');
    if (!/^rotate\(-?\d+(\.\d+)? /.test(labelEl.getAttribute('transform') ?? '')) throw new Error('the label runs along the arrow (rotate transform)');
    const fs = parseFloat(labelEl.getAttribute('font-size'));
    if (!(fs >= 1.3 && fs <= 2.0)) throw new Error(`label font sized to the shaft, got ${fs}`);
    if (gs[3].querySelector('rect') || gs[3].querySelector('text.label-halo')) throw new Error('no box or halo twin behind the label — the eval sits inside the arrow');
    if (gs[2].querySelector('text.label')) throw new Error('an arrow without a label draws none');
    ui.setMarks({});
    if (host.querySelector('.arrow-layer g.arrow') || has('a1', 'fresh-crack') || has('b1', 'fresh-pit')) throw new Error('setMarks({}) must clear marks and arrows');
    return 'wall/hole/crate/cracked (+ a door skin) from the ledgers, a–d + 5–1 coordinates, 5 rung marks, arrows ranked 3→2→1 over the quake arrow, eval label on rank 1';
  });

  // --- Art themes (2026-09-03): the repacked tilesets ride a data-theme
  // attribute; wall RUNS and floor VARIANTS are classes the themes paint.
  // (selftest.html loads no stylesheet — computed looks are ui-smoke's job.)
  await check('board renderer: art themes, wall runs, floor variants', async () => {
    const host = document.createElement('div');
    const ui = new BoardUI(host, { files: 4, ranks: 5 });
    const has = (sq, cls) => ui.cellClasses(sq).includes(cls);
    // a1–a3 a stone column, b5–d5 a stone row, c3 a lone block.
    const fen = '1***/4/*1*1/*3/*3 w - - 0 1';
    ui.setPosition(fen);
    for (const sq of ['a1', 'a2', 'a3']) if (!has(sq, 'wall-v')) throw new Error(`${sq} stands in a vertical run: ${ui.cellClasses(sq)}`);
    for (const sq of ['b5', 'c5', 'd5', 'c3']) if (has(sq, 'wall-v')) throw new Error(`${sq} is not a vertical run: ${ui.cellClasses(sq)}`);
    // A hole breaks the run (it is not solid); furniture joins it.
    ui.setPosition(fen, { holes: new Set(['a2']) });
    if (has('a1', 'wall-v') || has('a3', 'wall-v') || has('a2', 'wall-v')) throw new Error('a hole between two walls must break the vertical run');
    ui.setPosition('1***/4/*1*1/^3/*3 w - - 0 1', { godCrates: new Set(['a2']) });
    if (!has('a1', 'wall-v') || !has('a2', 'wall-v') || !has('a3', 'wall-v')) throw new Error('furniture (here a cracked wall) is solid to the run: ' + ui.cellClasses('a2'));
    // Floor variants: one per square, stable across repaints, some of each.
    const variants = (sq) => ui.cellClasses(sq).filter((c) => /^f[123]$/.test(c));
    const before = {};
    let f2 = 0, f3 = 0;
    for (const [sq] of ui.cells) {
      const v = variants(sq);
      if (v.length !== 1) throw new Error(`${sq} must carry exactly one floor variant: ${v}`);
      before[sq] = v[0];
      if (v[0] === 'f2') f2++;
      if (v[0] === 'f3') f3++;
    }
    if (!f2 || !f3) throw new Error(`a 4×5 board should scatter both variants (f2 ${f2}, f3 ${f3})`);
    ui.setPosition(fen);
    for (const [sq] of ui.cells) if (variants(sq)[0] !== before[sq]) throw new Error(`${sq}: the floor variant must not change on repaint`);
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
