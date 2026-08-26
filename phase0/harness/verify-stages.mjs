#!/usr/bin/env node
// Proving-grounds verifier — the successor to verify-play-arenas.mjs (which
// linted the four retired schema-1 arenas by playing engine games on the
// retired crumble harness). This one is STATIC matchup-sampling over the
// locked stage set: every stage × BOTH orientations (the designer's
// flip-testing convention) × crops × a seeded spread of generated armies
// goes through armygen.dealMatchup — the same single entry point the setup
// screen and the meter-lab corpus builder use — and every accepted deal is
// re-checked against the molding invariants. No games are played here; the
// engine-vs-engine half of verification is the meter-lab rerun's job
// (Phase 1.3) on this same bed.
//
// Exit 0 = every check passed. Nonzero on: a stale manifest bundle, any
// molding-invariant or king-anchor violation, a stage whose fully-terrain
// edge rows leave fewer than 5 playable ranks (every deal would die in the
// auto-crop), or a stage×orientation that cannot produce a single clean
// uncropped deal (a designer-locked terrain that starves the generator is
// a data bug, not bad luck). Furniture-only army separation is LEGAL and
// only warned (§4.6 — a chamber you must smash into). Needs the patched
// vendored pair overlaid into node_modules (assertFurnitureSupport says
// how when it isn't).
//
// Usage: cd phase0 && node harness/verify-stages.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadFfish, assertFurnitureSupport } from '../lib/load.mjs';
import { loadStageV2, flipStageVertical } from '../../play/js/stage.mjs';
import { dealMatchup, campLineRank, armiesConnected } from '../../play/js/armygen.mjs';
import { makeCatalogIni } from '../../play/js/variant.mjs';
import { buildManifest } from './gen-stage-manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGE_DIR = join(ROOT, 'play', 'stages');

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log(`FAIL: ${msg}`);
};

// ---- the committed manifest bundle must match the stage directory ----
{
  const fresh = JSON.stringify(buildManifest());
  const committed = readFileSync(join(STAGE_DIR, 'manifest.json'), 'utf8');
  if (JSON.stringify(JSON.parse(committed)) !== fresh) {
    fail('manifest.json is stale — rerun harness/gen-stage-manifest.mjs');
  } else {
    console.log('PASS: manifest bundle matches the stage directory');
  }
}

const stages = readdirSync(STAGE_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'manifest.json')
  .sort()
  .map((f) => loadStageV2(JSON.parse(readFileSync(join(STAGE_DIR, f), 'utf8'))));
const totalFurniture = stages.reduce((n, s) => n + s.furniture.length, 0);
console.log(`${stages.length} stages loaded (${totalFurniture} furniture squares across the set)`);

// The old extreme-rank promotion check is RETIRED (ground rules
// 2026-08-26): the king-anchored auto-crop makes the promotion-row
// guarantee true by construction. What CAN still be a data bug is a stage
// whose fully-terrain edge rows leave fewer than 5 playable ranks — every
// deal on it auto-crops below the floor and is rejected, so the
// ≥1-clean-deal gate below would fail with an unhelpful tally. Name it.
for (const s of stages) {
  const deadRow = (r) => s.grid[r].every((c) => c !== null);
  let dead = 0;
  for (let r = 0; r < s.ranks && deadRow(r); r++) dead++;
  for (let r = s.ranks - 1; r >= 0 && deadRow(r); r--) dead++;
  if (s.ranks - dead < 5) {
    fail(`${s.id}: fully-terrain edge rows leave ${s.ranks - dead} playable ranks (min 5) — no deal can survive the king-anchored auto-crop`);
  }
}

/** Molding invariants on one accepted deal (royal rearmost + per-file
 *  screen), plus the king-anchor guarantee: after auto-crop each royal
 *  STARTS on its side's extreme row (ground rules 2026-08-26). */
function checkInvariants(label, deal) {
  for (const [layout, side] of [[deal.white.layout, 'white'], [deal.black.layout, 'black']]) {
    const depth = (c) => (side === 'white' ? c.r : deal.ranks - 1 - c.r);
    const royal = layout.cells.filter((c) => c.piece === 'K');
    if (royal.length !== 1) return fail(`${label} ${side}: ${royal.length} royals`);
    if (depth(royal[0]) !== 0) return fail(`${label} ${side}: royal not on the extreme row after auto-crop (depth ${depth(royal[0])})`);
    const rearmost = Math.min(...layout.cells.map(depth));
    if (depth(royal[0]) !== rearmost) return fail(`${label} ${side}: royal not rearmost`);
    const byFile = new Map();
    for (const c of layout.cells) byFile.set(c.f, [...(byFile.get(c.f) ?? []), c]);
    for (const [f, cs] of byFile) {
      const b = cs.filter((c) => c.piece !== 'P').map(depth);
      const p = cs.filter((c) => c.piece === 'P').map(depth);
      if (b.length && p.length && Math.max(...b) >= Math.min(...p)) {
        return fail(`${label} ${side}: file ${f} pawn behind piece`);
      }
    }
  }
}

const ffish = await loadFfish();
ffish.loadVariantConfig(makeCatalogIni());
assertFurnitureSupport(ffish); // stock npm pair can't parse ^ — fail loudly with the overlay recipe

// ---- the sampling sweep ----
// Specs span the army range (small/medium/full width, player-favored and
// even), seeds give each cell a few draws. Rejections are legal outcomes
// (doesn't fit / mover-in-check re-rolls) — what MUST hold is: zero
// invariant violations anywhere, and every stage×orientation deals cleanly
// at least once uncropped.
const SPECS = [
  { white: { spec: { width: 3, budget: 12 } }, black: { spec: { width: 3, budget: 9 } } },
  { white: { spec: { width: 4, budget: 16 } }, black: { spec: { width: 4, budget: 12 } } },
  { white: { spec: { width: 6, budget: 30 } }, black: { spec: { width: 5, budget: 22 } } },
  { white: { spec: { width: 8, budget: 40 } }, black: { spec: { width: 8, budget: 40 } } },
  { white: { spec: { width: 5, pieces: ['Q', 'R', 'N', 'B'] } }, black: { spec: { width: 5, budget: 18 } } },
];
const SEEDS = [1, 2, 3];

let deals = 0;
let rejects = 0;
let autoCropped = 0;
// §4.6 warning (never a rejection): a deal whose armies are stone-connected
// but sealed apart by furniture alone — "a chamber you must smash into" —
// is legal, flagged here for the gallery eye.
const furnitureSealed = new Set();
const reasonTally = new Map();
// Camp-line census (informational, designer-requested 2026-08-21): where
// the mode-row line lands and how many dealt pawns sit AHEAD of it
// ("advanced" — no leap). Not a gate; the numbers go in the run output.
const census = { pawns: 0, forward: 0, dealsWithForward: 0, worst: 0, tieDeals: 0 };
function censusDeal(d) {
  let fwd = 0;
  let pawns = 0;
  for (const [side, enemyward] of [['white', 1], ['black', -1]]) {
    const cells = d[side].layout.cells;
    const line = campLineRank(cells, enemyward);
    const counts = new Map();
    for (const c of cells) {
      if (c.piece !== 'P') continue;
      pawns++;
      counts.set(c.r + 1, (counts.get(c.r + 1) ?? 0) + 1);
      if ((c.r + 1 - line) * enemyward > 0) fwd++;
    }
    const top = Math.max(...counts.values());
    if ([...counts.values()].filter((n) => n === top).length > 1) census.tieDeals++;
  }
  census.pawns += pawns;
  census.forward += fwd;
  if (fwd > 0) census.dealsWithForward++;
  census.worst = Math.max(census.worst, fwd / pawns);
}
for (const base of stages) {
  for (const flip of [false, true]) {
    const orientation = `${base.id}${flip ? '~flipped' : ''}`;
    let cleanUncropped = 0;
    const cropSets = [[0, 0]];
    if (base.ranks >= 7) cropSets.push([1, 1]);
    if (base.ranks >= 9) cropSets.push([2, 1]);
    for (const [ct, cb] of cropSets) {
      for (const spec of SPECS) {
        for (const seed of SEEDS) {
          const d = dealMatchup({ stage: base, flip, cropTop: ct, cropBottom: cb, ...spec, seed, turn: seed % 2 ? 'w' : 'b', ffish });
          if (!d.ok) {
            rejects++;
            const key = d.error.replace(/attempt \d+: /, '').slice(0, 40);
            reasonTally.set(key, (reasonTally.get(key) ?? 0) + 1);
            continue;
          }
          deals++;
          if (ct === 0 && cb === 0) cleanUncropped++;
          if (d.autoCrop.top || d.autoCrop.bottom) autoCropped++;
          checkInvariants(`${orientation} c${ct}/${cb} ${spec.white.spec.width}v${spec.black.spec.width} s${seed}`, d);
          censusDeal(d);
          if (d.gap < 1) fail(`${orientation}: gap ${d.gap} < 1 accepted`);
          if (d.stage.furniture.length && !armiesConnected(d.stage, d, { furnitureBlocks: true })) {
            furnitureSealed.add(orientation);
          }
        }
      }
    }
    if (!cleanUncropped) fail(`${orientation}: no clean uncropped deal across ${SPECS.length * SEEDS.length} tries`);
  }
}

console.log(`${deals} deals accepted, ${rejects} rejected (legal re-roll class); ${autoCropped} auto-cropped behind the kings`);
if (furnitureSealed.size) {
  console.log(
    `WARN (legal, §4.6): furniture alone seals the armies apart on ${furnitureSealed.size} stage-orientation(s) — smash-in chambers, judge in the gallery: ${[...furnitureSealed].sort().join(', ')}`
  );
}
console.log(
  `camp-line census: ${census.forward}/${census.pawns} dealt pawns ahead of a line ` +
    `(${((100 * census.forward) / census.pawns).toFixed(1)}%) · ` +
    `${census.dealsWithForward}/${deals} deals have ≥1 advanced pawn · ` +
    `worst single deal ${(100 * census.worst).toFixed(0)}% · ` +
    `${census.tieDeals} side-ties (resolved toward the enemy)`
);
for (const [reason, n] of [...reasonTally.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  reject: ${n}× ${reason}`);
}
console.log(failures === 0 ? '\nSTAGE VERIFY PASS' : `\nSTAGE VERIFY FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
