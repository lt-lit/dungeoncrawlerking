// armygen + molding test bench (slice refresh).
//
// Asserts the two molding invariants (royal rearmost, pawns strictly in
// front), unit counts, gap math, doesn't-fit rejection, determinism, and
// budget-mode accuracy — on native shapes, squeezed corridors, wall
// pockets, and a seeded fuzz across synthetic terrains. ffish lints run on
// every composed FEN; lint failures (e.g. a long-range piece checking
// across the gap at deal time) are legal outcomes counted and reported —
// callers re-roll those — but grid invariants must NEVER fail.
//
// Usage: cd phase0 && node harness/test-armygen.mjs
import { loadFfish } from '../lib/load.mjs';
import { loadStageV2, flipStageVertical, cropStage } from '../../play/js/stage.mjs';
import { makeArmy, armyValue, layoutArmy, buildMatchup, armiesConnected, lintMatchupFen, dealMatchup, campLineRank, PIECE_VALUES } from '../../play/js/armygen.mjs';
import { makeCatalogIni } from '../../play/js/variant.mjs';
import { isTerrain } from '../../play/js/fen.mjs';
import { mulberry32 } from '../../play/js/prng.mjs';

let failures = 0;
const check = (name, cond, detail = '') => {
  if (!cond) {
    failures++;
    console.log(`FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const pass = (name) => console.log(`PASS: ${name}`);

const openStage = (files, ranks, id = `open-${files}x${ranks}`) =>
  loadStageV2({ schema: 2, id, map: Array.from({ length: ranks }, () => '.'.repeat(files)) });

/** Invariants on one side's layout (molding v2: dense, per-file screen). */
function checkSide(name, army, layout, side, ranks) {
  const rows = (c) => (side === 'white' ? c.r : ranks - 1 - c.r); // depth from home edge
  const backs = layout.cells.filter((c) => c.piece !== 'P');
  const pawns = layout.cells.filter((c) => c.piece === 'P');
  check(`${name}: unit counts`, backs.length === army.width && pawns.length === army.width,
    `${backs.length} back (want ${army.width} incl royal), ${pawns.length} pawns`);
  const royal = backs.filter((c) => c.piece === army.royal);
  check(`${name}: exactly one royal`, royal.length === 1);
  if (royal.length === 1) {
    const rearmost = Math.min(...layout.cells.map(rows));
    check(`${name}: royal in rearmost occupied row`, rows(royal[0]) === rearmost,
      `royal depth ${rows(royal[0])}, rearmost ${rearmost}`);
    check(`${name}: no pawn in the royal's row`, pawns.every((c) => rows(c) !== rows(royal[0])));
  }
  // per-file screen: within each file, every non-pawn sits behind every pawn
  const byFile = new Map();
  for (const c of layout.cells) {
    if (!byFile.has(c.f)) byFile.set(c.f, []);
    byFile.get(c.f).push(c);
  }
  for (const [f, cs] of byFile) {
    const b = cs.filter((c) => c.piece !== 'P').map(rows);
    const p = cs.filter((c) => c.piece === 'P').map(rows);
    if (b.length && p.length) {
      check(`${name}: file ${String.fromCharCode(97 + f)} screen order`, Math.max(...b) < Math.min(...p),
        `back depths ${b}, pawn depths ${p}`);
    }
  }
  // dense: no empty usable cell strictly behind an occupied cell in the same file
  // (holes inside the formation were the v1 bug — cheap proxy: cell count fits depth)
}

// ---- 1. composition ----
{
  const a = makeArmy({ width: 5, pieces: ['Q', 'R', 'B', 'N'] });
  check('explicit army value', a.value === 5 + 9 + 5 + 3 + 3, String(a.value));
  const r1 = makeArmy({ width: 6, budget: 20 }, mulberry32(42));
  const r2 = makeArmy({ width: 6, budget: 20 }, mulberry32(42));
  check('budget draw deterministic', JSON.stringify(r1) === JSON.stringify(r2));
  let maxDev = 0;
  for (let s = 0; s < 100; s++) {
    for (const w of [3, 5, 8]) {
      const lo = w + 3 * (w - 1);
      const hi = w + 9 * (w - 1);
      const budget = lo + (s % (hi - lo + 1));
      const a2 = makeArmy({ width: w, budget }, mulberry32(1000 + s));
      maxDev = Math.max(maxDev, Math.abs(a2.value - budget));
    }
  }
  check('budget accuracy within 2 across 300 draws (lattice bound — {3,5,9} gaps near the edges)', maxDev <= 2, `max deviation ${maxDev}`);
  pass('composition');
}

// ---- 2. native shape on open ground ----
{
  const stage = openStage(10, 10);
  const army = makeArmy({ width: 8, pieces: ['Q', 'R', 'R', 'B', 'B', 'N', 'N'] });
  const l = layoutArmy({ grid: stage.grid, files: 10, ranks: 10, side: 'white', army, maxDepth: 8 });
  check('8x2 on open ground is depth 2', l && l.depthRows === 2, l && String(l.depthRows));
  checkSide('open 8x2 white', army, l, 'white', 10);
  pass('native shape');
}

// ---- 3. the squeeze: 8x2 army in a 4-wide hall ----
{
  const stage = openStage(4, 10, 'hall-4');
  const army = makeArmy({ width: 8, pieces: ['Q', 'R', 'R', 'B', 'B', 'N', 'N'] });
  for (const side of ['white', 'black']) {
    const l = layoutArmy({ grid: stage.grid, files: 4, ranks: 10, side, army, maxDepth: 7 });
    check(`squeezed 8x2 ${side} is depth 4`, l && l.depthRows === 4, l && String(l.depthRows));
    if (l) checkSide(`squeezed 8x2 ${side}`, army, l, side, 10);
  }
  pass('squeeze');
}

// ---- 3b. mixed rows: 8x2 army on a 6-wide window (the v1 hollow-row case) ----
{
  const stage = openStage(6, 10, 'hall-6');
  const army = makeArmy({ width: 8, pieces: ['Q', 'Q', 'R', 'B', 'B', 'N', 'N'] });
  const l = layoutArmy({ grid: stage.grid, files: 6, ranks: 10, side: 'white', army, maxDepth: 7 });
  check('8x2 on 6-wide is depth 3 (dense, was 4 with holes)', l && l.depthRows === 3, l && String(l.depthRows));
  if (l) {
    checkSide('mixed-row 8x2', army, l, 'white', 10);
    const row1 = l.cells.filter((c) => c.r === 1);
    check('overflow row mixes pieces and pawns (no holes)', row1.length === 6 && row1.some((c) => c.piece === 'P') && row1.some((c) => c.piece !== 'P'),
      `row1 has ${row1.length} cells`);
    const row2 = l.cells.filter((c) => c.r === 2);
    const row2Files = row2.map((c) => c.f).sort((a, b) => a - b).join(',');
    check('sparse front row is CENTERED (v2.1)',
      row2.length === 4 && row2.every((c) => c.piece === 'P') && row2Files === '1,2,3,4',
      `files [${row2Files}]`);
    const row1Pawns = l.cells.filter((c) => c.r === 1 && c.piece === 'P').map((c) => c.f).sort((a, b) => a - b).join(',');
    check('mixed-row pawns sit on the outer cells (pieces hold center)', row1Pawns === '0,1,4,5', `files [${row1Pawns}]`);
  }
  pass('mixed rows');
}

// ---- 3c. walls count as cover (report-only, v2.1) ----
{
  // Wall at a2: file a's piece has no pawn but IS screened by the wall.
  const stage = loadStageV2({ schema: 2, id: 'wall-cover', map: ['...', '...', '...', '...', '...', '...', '#..', '...'] });
  const army = makeArmy({ width: 3, pieces: ['R', 'N'] });
  const l = layoutArmy({ grid: stage.grid, files: 3, ranks: 8, side: 'white', army, maxDepth: 6 });
  check('wall-screened file is NOT flagged', l && l.violations.length === 0, l && l.violations.join(','));
  pass('wall cover');
}

// ---- 4. wall pocket in the deployment zone (molding showcase) ----
{
  const stage = loadStageV2({
    schema: 2,
    id: 'bitten-corner',
    map: ['##......', '##......', '#.......', '........', '........', '........', '........', '........'],
  });
  const army = makeArmy({ width: 6, pieces: ['R', 'R', 'B', 'N', 'N'] });
  const l = layoutArmy({ grid: stage.grid, files: 8, ranks: 8, side: 'black', army, anchor: 'left', maxDepth: 6 });
  check('bitten corner still lays out', !!l);
  if (l) {
    checkSide('bitten-corner black', army, l, 'black', 8);
    check('bitten corner avoids terrain', l.cells.every((c) => !isTerrain(stage.grid[c.r][c.f])));
  }
  pass('wall pocket');
}

// ---- 5. doesn't fit + gap floor ----
{
  const tiny = openStage(3, 5);
  const big = { spec: { width: 8, budget: 30 } };
  const m = buildMatchup({ stage: tiny, white: big, black: big, seed: 7 });
  check('two 8x2 armies rejected on 3x5', !!m.error, m.error);
  const small = { spec: { width: 3, budget: 9 } };
  const ok = buildMatchup({ stage: tiny, white: small, black: small, seed: 7, gapMin: 1 });
  check('two 3x2 armies fit 3x5 at gap 1', !ok.error && ok.gap === 1, ok.error ?? `gap ${ok.gap}`);
  const rej = buildMatchup({ stage: tiny, white: small, black: small, seed: 7, gapMin: 2 });
  check('gapMin 2 rejects the 3x5 pairing', !!rej.error, rej.error);
  pass('fit + gap');
}

// ---- 6. determinism of full matchups ----
{
  const stage = openStage(7, 9);
  const args = {
    stage,
    white: { spec: { width: 6, budget: 22 }, anchor: 'left', archetype: 'scrambled' },
    black: { spec: { width: 4, budget: 12 }, anchor: 'right' },
    seed: 99,
  };
  const a = buildMatchup(args);
  const b = buildMatchup(args);
  check('matchup deterministic', !a.error && a.fen === b.fen, a.error ?? '');
  pass('determinism');
}

// ---- 7. seeded fuzz with ffish lint ----
const ffish = await loadFfish();
ffish.loadVariantConfig(makeCatalogIni());
{
  const stages = [
    openStage(10, 10),
    openStage(4, 10, 'hall'),
    openStage(3, 5, 'closet'),
    loadStageV2({
      schema: 2,
      id: 'pockets',
      map: ['........', '.#......', '........', '..##....', '....#...', '........', '......#.', '........', '........'],
    }),
  ];
  const anchors = ['center', 'left', 'right', 2];
  const archetypes = ['heavies-deep', 'minors-deep', 'scrambled'];
  let built = 0;
  let rejected = 0;
  let lintFails = 0;
  let disconnected = 0;
  for (let s = 0; s < 300; s++) {
    const rng = mulberry32(5000 + s);
    const stage = stages[Math.floor(rng() * stages.length)];
    const spec = () => ({
      spec: { width: 3 + Math.floor(rng() * 6), budget: 10 + Math.floor(rng() * 25) },
      anchor: anchors[Math.floor(rng() * anchors.length)],
      archetype: archetypes[Math.floor(rng() * archetypes.length)],
    });
    const m = buildMatchup({ stage, white: spec(), black: spec(), seed: 5000 + s });
    if (m.error) {
      rejected++;
      continue;
    }
    built++;
    checkSide(`fuzz#${s} white`, m.white.army, m.white.layout, 'white', stage.ranks);
    checkSide(`fuzz#${s} black`, m.black.army, m.black.layout, 'black', stage.ranks);
    check(`fuzz#${s} gap >= 1`, m.gap >= 1, String(m.gap));
    if (!armiesConnected(stage, m)) disconnected++;
    const lint = lintMatchupFen(ffish, stage.variantName, m.fen);
    if (!lint.ok) lintFails++;
  }
  console.log(`fuzz: ${built} built, ${rejected} rejected (doesn't fit / gap), ${lintFails} lint-flagged (re-roll class), ${disconnected} disconnected`);
  check('fuzz built a healthy majority', built > 150, String(built));
  check('no disconnected matchups on these terrains', disconnected === 0, String(disconnected));
  pass('fuzz');
}

// ---- 10. flip + crop (stage transforms the corpus convention and the
// setup screen build on) ----
{
  const jag = loadStageV2({
    schema: 2,
    id: 'jagged',
    map: ['#.......', '........', '..##....', '........', '.....#..', '........', '#......#', '........'],
  });
  const flipped = flipStageVertical(jag);
  const back = flipStageVertical(flipped);
  check('flip is an involution (grid)', JSON.stringify(back.grid) === JSON.stringify(jag.grid));
  check('flip is an involution (walls)', JSON.stringify([...back.walls].sort()) === JSON.stringify([...jag.walls].sort()));
  check('flip mirrors ranks', flipped.grid[0].join() === jag.grid[jag.ranks - 1].join());
  // molding on flipped terrain obeys the same invariants
  const m = buildMatchup({ stage: flipped, white: { spec: { width: 5, budget: 22 } }, black: { spec: { width: 5, budget: 22 } }, seed: 11 });
  check('flipped stage deals', !m.error, m.error);
  if (!m.error) {
    checkSide('flipped white', m.white.army, m.white.layout, 'white', flipped.ranks);
    checkSide('flipped black', m.black.army, m.black.layout, 'black', flipped.ranks);
  }

  const cropped = cropStage(jag, 2, 1);
  check('crop dims', cropped.files === 8 && cropped.ranks === 5, `${cropped.files}x${cropped.ranks}`);
  check('crop variant follows the smaller board', cropped.variantName === 'duel_8x5', cropped.variantName);
  check('crop keeps interior rows', cropped.grid[0].join() === jag.grid[1].join() && cropped.grid[4].join() === jag.grid[5].join());
  check('crop 0/0 is identity', cropStage(jag, 0, 0) === jag);
  let threw = false;
  try {
    cropStage(jag, 3, 1); // 8 ranks - 4 = 4 < 5
  } catch {
    threw = true;
  }
  check('crop below 5 ranks throws', threw);
  threw = false;
  try {
    // walling the would-be far rank must be rejected (promotion row rule)
    cropStage(loadStageV2({ schema: 2, id: 'walltop', map: ['......', '######', '......', '......', '......', '......', '......'] }), 1, 0);
  } catch {
    threw = true;
  }
  check('crop onto an all-wall far rank throws', threw);
  pass('flip + crop');
}

// ---- 11. dealMatchup (the shared setup/verify/corpus entry point) ----
{
  const stage = loadStageV2({
    schema: 2,
    id: 'deal-bench',
    map: ['........', '..#.....', '........', '....##..', '........', '........', '.#......', '........', '........', '........'],
  });
  const knobs = { white: { spec: { width: 6, budget: 30 } }, black: { spec: { width: 5, budget: 20 } }, seed: 9 };
  const a = dealMatchup({ stage, flip: true, cropTop: 1, cropBottom: 1, turn: 'b', ...knobs, ffish });
  check('deal succeeds', a.ok, a.error);
  if (a.ok) {
    const b = dealMatchup({ stage, flip: true, cropTop: 1, cropBottom: 1, turn: 'b', ...knobs, ffish });
    check('deal deterministic', a.fen === b.fen && a.directorSeed === b.directorSeed && a.attempt === b.attempt);
    check('deal dims follow the crop', a.files === 8 && a.ranks === 8, `${a.files}x${a.ranks}`);
    check('deal carries the turn', a.fen.split(' ')[1] === 'b');
    // camp-line double-step (spike 14): the deal rides its own variant
    // whose regions run from each home edge to that side's camp line —
    // the mode pawn rank, ties toward the enemy; move-semantics proof
    // lives in spike 14 + selftest.
    const lines = a.variantName.match(/__w(\d+)__b(\d+)$/);
    check(
      'deal variant encodes the camp lines',
      !!lines && +lines[1] === campLineRank(a.white.layout.cells, 1) && +lines[2] === campLineRank(a.black.layout.cells, -1) && !!a.variantIni,
      a.variantName
    );
    check('deal variant is registered and serves the FEN', ffish.validateFen(a.fen, a.variantName) === 1);
    check('deal edge is white minus black', a.edge === a.white.army.value - a.black.army.value);
    check('deal director seed differs from setup seed', a.directorSeed !== a.seed);
  }
  const tooBig = dealMatchup({ stage, cropTop: 3, cropBottom: 3, ...knobs, ffish });
  check('impossible crop reports, never throws', tooBig.ok === false && /ranks/.test(tooBig.error), tooBig.error);
  const noFit = dealMatchup({
    stage: loadStageV2({ schema: 2, id: 'tiny', map: ['...', '...', '...', '...', '...'] }),
    white: { spec: { width: 8, budget: 40 } },
    black: { spec: { width: 8, budget: 40 } },
    seed: 1,
    ffish,
  });
  check("doesn't-fit reports with per-attempt reasons", noFit.ok === false && noFit.reasons.length >= 1, JSON.stringify(noFit.reasons));
  pass('dealMatchup');
}

// ---- 12. the camp line: mode row, ties toward the enemy ----
{
  // Sparse front row: W6 on 5-wide ground — the sixth back unit spills
  // into row 1, so pawns land 4 on rank 2 + 2 bumped to rank 3. The line
  // must sit at the WALL (rank 2), not the bumped stragglers' rank.
  const narrow = openStage(5, 8);
  const a = dealMatchup({ stage: narrow, white: { spec: { width: 6, budget: 28 } }, black: { spec: { width: 6, budget: 28 } }, seed: 2, ffish });
  check('sparse-front deal succeeds', a.ok, a.error);
  if (a.ok) {
    const wRanks = a.white.layout.cells.filter((c) => c.piece === 'P').map((c) => c.r + 1);
    check('case really has bumped-forward pawns', wRanks.some((r) => r === 3) && wRanks.filter((r) => r === 2).length === 4, wRanks.join(','));
    check('line sits at the pawn wall, not the stragglers', /__w2__b7$/.test(a.variantName), a.variantName);
    // a bumped-forward pawn (rank 3, ahead of line 2) must NOT leap
    const b = new ffish.Board(a.variantName, a.fen);
    const legal = b.legalMoves().trim().split(/\s+/);
    b.delete();
    const straggler = a.white.layout.cells.find((c) => c.piece === 'P' && c.r + 1 === 3);
    const sq = `${String.fromCharCode(97 + straggler.f)}${straggler.r + 1}`;
    check('straggler ahead of the line never leaps', !legal.includes(`${sq}${String.fromCharCode(97 + straggler.f)}${straggler.r + 3}`), sq);
  }

  // Tied stacks: W8 in a 4-wide hall — two full pawn walls (4+4) tie,
  // and the tie resolves TOWARD THE ENEMY: the line is the front wall.
  const hall = openStage(4, 10);
  const t = dealMatchup({ stage: hall, white: { spec: { width: 8, budget: 40 } }, black: { spec: { width: 8, budget: 40 } }, seed: 3, ffish });
  check('tied-stack deal succeeds', t.ok, t.error);
  if (t.ok) {
    const wCounts = {};
    for (const c of t.white.layout.cells) if (c.piece === 'P') wCounts[c.r + 1] = (wCounts[c.r + 1] ?? 0) + 1;
    check('case really is a 4+4 tie', wCounts[3] === 4 && wCounts[4] === 4, JSON.stringify(wCounts));
    check('tie resolves toward the enemy (front wall)', /__w4__b7$/.test(t.variantName), t.variantName);
  }
  pass('camp line (mode + enemy-tie)');
}

console.log(failures === 0 ? '\nARMYGEN TESTS PASS' : `\nARMYGEN TESTS FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
