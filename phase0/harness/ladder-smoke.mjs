// Ladder smoke test — does the v3 Director behave on the real stage bed?
//
// NOT a calibration corpus. This is the cheap sanity pass that runs after a
// change to the Director's decision layer: a handful of engine-vs-engine
// duels across a spread of stages, answering three questions and no more.
//
//   1. Do duels still TERMINATE? v2's guarantee was "free squares only ever
//      shrink"; v3 breaks that (a breach adds one back) and rests instead on
//      the hole set — permanent, monotone, debt-forced. That argument needs
//      to survive contact with real boards.
//   2. Did games get LONGER? The whole point of the rework is that the gods
//      were lengthening duels by dissolving the mates that would have ended
//      them. Longer games mean the rework failed.
//   3. Where does god activity actually LAND on the ladder? The design bet is
//      that most of it moves to the cheap rungs (weaken/breach), which cannot
//      wreck a game, and that crumbles become an endgame event.
//
// Deliberately not measured here: harm classification (needs the eval
// referee), colour drift, per-stage breakdowns. Those belong to a corpus, and
// the corpus is not what this change needs — feel is, and feel is the
// designer's phone.
//
// Usage (from phase0/, with the play/vendor overlay applied — see
// engine/README.md; a stone-only run would silently skip the furniture guard):
//   node harness/ladder-smoke.mjs [--games 12] [--seed 1] [--go 'depth 8 movetime 250']

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadFfish, loadEngine, assertFurnitureSupport } from '../lib/load.mjs';
import { loadStageV2 } from '../../play/js/stage.mjs';
import { dealMatchup } from '../../play/js/armygen.mjs';
import { makeCatalogIni } from '../../play/js/variant.mjs';
import { DuelController } from '../../play/js/duel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const STAGE_DIR = join(HERE, '../../play/stages');

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : dflt;
};
const GAMES = parseInt(arg('games', '12'), 10);
const SEED_BASE = parseInt(arg('seed', '1'), 10);
// Both seats shallow: this asks whether the DIRECTOR behaves, not how a
// mid-skill human converts, and a deep search would spend the whole budget on
// the engine instead of on god rolls.
const GO = arg('go', 'depth 8 movetime 250');
// --gods off runs the identical bed and seeds with the Director silenced.
// Without that control, "median 103 plies" cannot be attributed: the new
// stage bed is 2-3x the area of the four legacy arenas every published ply
// count came from, solong games might simply be the boards.
const GODS = arg('gods', 'on');
// The shipped presets, mirrored from play/js/main.mjs GOD_PRESETS. They were
// picked by argument, not measurement — this flag is how they stop being
// guesses. Keep in sync or the smoke is measuring something the game does not
// ship.
const GOD_PRESETS = {
  calm: { onsetPly: 20, rampPlies: 26, sate: 5, debtCap: 12, extraActions: 1 },
  restless: { onsetPly: 8, rampPlies: 16, sate: 4, debtCap: 10, extraActions: 2 },
  wrathful: { onsetPly: 4, rampPlies: 9, sate: 3, debtCap: 6, extraActions: 3 },
};
const PRESET = arg('preset', 'restless');
if (!(PRESET in GOD_PRESETS)) {
  console.error(`unknown preset "${PRESET}" — valid: ${Object.keys(GOD_PRESETS).join(', ')}`);
  process.exit(1);
}

const stages = readdirSync(STAGE_DIR)
  .filter((f) => /^s\d+.*\.json$/.test(f))
  .sort()
  .map((f) => loadStageV2(JSON.parse(readFileSync(join(STAGE_DIR, f), 'utf8'))));

// A spread rather than a sample: small/large, sparse/crate-dense. Stratifying
// by area and furniture count is the cheapest way to keep one stage's quirk
// from reading as a Director property.
const spread = [...stages].sort((a, b) => {
  const area = (s) => s.files * s.ranks;
  return area(a) - area(b) || a.furniture.length - b.furniture.length;
});
const picks = [];
for (let i = 0; i < GAMES; i++) picks.push(spread[Math.floor((i * spread.length) / GAMES)]);

const ffish = await loadFfish();
let catalog = makeCatalogIni();
ffish.loadVariantConfig(catalog);
assertFurnitureSupport(ffish);
const seenVariants = new Set();

// Army width has to scale with the stage or the 5x5 end of the bed rejects
// every deal ("white 5x2 doesn't fit") and the spread silently loses its
// small boards — exactly the sampling bias the new bed exists to remove.
function specFor(stage) {
  const width = Math.max(3, Math.min(8, stage.files - 2));
  const budget = Math.round(width * 4.5);
  return { white: { spec: { width, budget } }, black: { spec: { width, budget } } };
}

// v3 counts ACTIONS, not quakes: a quake spends a budget, so the interesting
// numbers are how many rungs fire per quake (is it actually mixing?) and how
// the actions split across the ladder.
const tally = { weaken: 0, breach: 0, displace: 0, crumble: 0, terminal: 0 };
const budgetHist = {};
let mixedQuakes = 0;
const rows = [];
let engine = await loadEngine();

for (let i = 0; i < picks.length; i++) {
  const stage = picks[i];
  const seed = SEED_BASE + i;
  const flip = i % 2 === 1; // both orientations, per the designer's mirror rule
  const deal = dealMatchup({ stage, flip, ...specFor(stage), seed, turn: 'w', ffish });
  if (!deal.ok) {
    rows.push({ stage: stage.id, skipped: deal.error.slice(0, 60) });
    continue;
  }
  // Rule 7: deal-variant names encode their own config, so registering one
  // twice is an identical-config no-op — but re-sending the whole catalog
  // makes ffish warn on every already-known name. Send the deal alone.
  if (!seenVariants.has(deal.variantName)) {
    ffish.loadVariantConfig(deal.variantIni);
    catalog += '\n' + deal.variantIni;
    seenVariants.add(deal.variantName);
  }
  await engine.loadVariantsIni(catalog);

  const duel = new DuelController({
    ffish,
    engine,
    variantName: deal.variantName,
    startFen: deal.fen,
    files: deal.files,
    ranks: deal.ranks,
    go: GO,
    director: GODS === 'off' ? { seed, onsetPly: Infinity } : { seed, ...GOD_PRESETS[PRESET] },
  });
  const t0 = Date.now();
  try {
    await duel.start();
    while (duel.state === 'playing') {
      const r = await duel.engineMove();
      if (r.ended || r.error) break;
    }
  } catch (e) {
    rows.push({ stage: stage.id, error: String(e?.message ?? e).split('\n')[0] });
    engine = await loadEngine(); // rule 6: drop the reference, never quit()
    continue;
  }

  const outcomes = {};
  let actions = 0;
  for (const t of duel.record.quakeTraces) {
    if (t.outcome === 'quiet') continue;
    const spent = t.rungsSpent ?? [];
    budgetHist[spent.length] = (budgetHist[spent.length] ?? 0) + 1;
    if (new Set(spent).size > 1) mixedQuakes++;
    for (const r of spent) {
      outcomes[r] = (outcomes[r] ?? 0) + 1;
      if (r in tally) tally[r]++;
      actions++;
    }
  }
  const inCheckFires = duel.record.quakeTraces.filter((t) => t.outcome !== 'quiet' && t.held).length;
  rows.push({
    stage: `${stage.id}${flip ? '~f' : ''}`,
    dims: `${deal.files}x${deal.ranks}`,
    plies: duel.ply,
    term: duel.record.termination ?? duel.record.error ?? '?',
    quakes: duel.record.quakeTraces.filter((t) => t.outcome !== 'quiet').length,
    actions,
    holes: duel.director.holes.size,
    inCheckFires,
    outcomes,
    s: Math.round((Date.now() - t0) / 100) / 10,
  });
  duel.destroy();
  if ((i + 1) % 6 === 0) engine = await loadEngine(); // rule 6 margin
}

const played = rows.filter((r) => r.plies !== undefined);
const q = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.floor(p * (s.length - 1))] : NaN;
};
const plies = played.map((r) => r.plies);
const totalQuakes = played.reduce((a, r) => a + r.quakes, 0);
const totalActions = played.reduce((a, r) => a + r.actions, 0);

console.log(`\n=== ladder smoke (gods ${GODS}, preset ${PRESET}, ${GO}) ===`);
for (const r of rows) {
  if (r.skipped) console.log(`  ${r.stage}: SKIPPED (${r.skipped})`);
  else if (r.error) console.log(`  ${r.stage}: ERROR ${r.error}`);
  else
    console.log(
      `  ${r.stage.padEnd(26)} ${r.dims.padStart(5)} ${String(r.plies).padStart(4)}p ` +
        `${r.term.padEnd(12)} ${String(r.quakes).padStart(3)}q ${String(r.actions).padStart(3)}a holes ${String(r.holes).padStart(2)} ` +
        `${r.s}s  ${JSON.stringify(r.outcomes)}`
    );
}
console.log(`\ngames ${played.length}/${rows.length}   plies q1/med/q3: ${q(plies, 0.25)}/${q(plies, 0.5)}/${q(plies, 0.75)}`);
console.log(`terminations: ${JSON.stringify(played.reduce((a, r) => ((a[r.term] = (a[r.term] ?? 0) + 1), a), {}))}`);
const failures = played.filter((r) => r.term === '?' || String(r.term).includes('max-plies'));
console.log(`TERMINATION FAILURES: ${failures.length}${failures.length ? ' ← ' + failures.map((r) => r.stage).join(', ') : ''}`);
console.log(`quakes ${totalQuakes} total (${(totalQuakes / Math.max(1, played.length)).toFixed(1)}/game), actions ${totalActions} (${(totalActions / Math.max(1, totalQuakes)).toFixed(2)}/quake)`);
console.log(`actions per quake: ${JSON.stringify(budgetHist)} — MIXED-rung quakes ${mixedQuakes}/${totalQuakes} (${((100 * mixedQuakes) / Math.max(1, totalQuakes)).toFixed(1)}%)`);
const pct = (n) => `${((100 * n) / Math.max(1, totalActions)).toFixed(1)}%`;
console.log(
  `ladder (by ACTION): weaken ${tally.weaken} (${pct(tally.weaken)}) · breach ${tally.breach} (${pct(tally.breach)}) · ` +
    `displace ${tally.displace} (${pct(tally.displace)}) · ` +
    `crumble ${tally.crumble + tally.terminal} (${pct(tally.crumble + tally.terminal)})`
);
console.log(`fired while a king was in check: ${played.reduce((a, r) => a + r.inCheckFires, 0)} (v2 baseline: 11.1% of quakes)`);
process.exit(failures.length ? 1 : 0);
