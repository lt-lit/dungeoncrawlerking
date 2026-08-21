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
import { loadStageV2 } from '../../play/js/stage.mjs';
import { makeArmy, armyValue, layoutArmy, buildMatchup, armiesConnected, lintMatchupFen, PIECE_VALUES } from '../../play/js/armygen.mjs';
import { makeCatalogIni } from '../../play/js/variant.mjs';
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
    check('front partial row: spare pawns on coverage files (c,d) + outer flanks (a,f)',
      row2.length === 4 && row2.every((c) => c.piece === 'P') && row2Files === '0,2,3,5',
      `files [${row2Files}]`);
  }
  pass('mixed rows');
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
    check('bitten corner avoids walls', l.cells.every((c) => stage.grid[c.r][c.f] !== '*'));
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

console.log(failures === 0 ? '\nARMYGEN TESTS PASS' : `\nARMYGEN TESTS FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
