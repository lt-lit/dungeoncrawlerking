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
import { fenGrid, Director, displacementCandidates, crumbleCandidates, lockedPawns } from './director.mjs';
import { captureLoss } from './threat.mjs';
import { loadStageV2, flipStageVertical, cropStage } from './stage.mjs';
import { dealMatchup, campLineRank } from './armygen.mjs';

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
    // 2026-08-26: the king-anchored auto-crop makes the promotion-row
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
    }
    return `${stages.length} stages round-trip (walls + furniture)`;
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
      '##########', // rank 1: all stone — legal since 2026-08-26, auto-crops away
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
  // deal variant grants the leap at or behind its front-most dealt pawn
  // rank — past the line, never again. Quake-scooted pawns behind the
  // line keep it, which is the whole point of rows over dealt squares.
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

  // The designer's promotion rule (king-anchored since 2026-08-26): the
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
  const runDirector = (seed, exercise, startFen = dirFen) => {
    const d = new Director({ ...dirCfg, seed });
    let fen = startFen;
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

  // Furniture is stone to the gods (§4.6 interim rule, Set Dressing): the
  // same fixture with the wall swapped for a crate must (a) replay
  // identically with the overlay exercised, and (b) never displace, land
  // on, or crumble the crate — terrain in every enumeration.
  const dirFenCrate = dirFen.replace('2*2', '2^2'); // the c4 wall becomes a crate
  await check('seeded ^ quake sequence: identical replay, crate untouched', () => {
    if (ffish.validateFen(dirFenCrate, dirVariant) !== 1) throw new Error('crate director fixture FEN rejected');
    for (const seed of [3, 7]) {
      const plain = runDirector(seed, false, dirFenCrate);
      const hammered = runDirector(seed, true, dirFenCrate);
      if (JSON.stringify(plain.out) !== JSON.stringify(hammered.out)) {
        throw new Error(`seed ${seed}: overlay perturbed the ^ quake sequence`);
      }
      for (const ev of plain.out) {
        if (ev === null) continue;
        for (const move of ev.d) if (move.includes('c4')) throw new Error(`gods touched the crate square: ${move}`);
        if (ev.c && ev.c.startsWith('c4:')) throw new Error(`gods crumbled the crate: ${ev.c}`);
        if (findSquares(ev.post, (c) => c === '^').length !== 1) {
          throw new Error(`crate count changed: ${ev.post}`);
        }
      }
    }
    return '2 seeds × 14 plies replay exactly; the crate on c4 is stone to the gods';
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
