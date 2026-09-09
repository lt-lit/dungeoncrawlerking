#!/usr/bin/env node
// THE WORLDS (Phase 2 milestone 5, 2026-09-08): the fixtures in play/worlds/
// are GENERATED floors — play/js/dungeon.mjs from the stage manifest (the
// 36 wave-6 arenas are the pieces) at fixed seeds — plus their manifest.
//
//   node harness/gen-worlds.mjs [--duel]     (from phase0/; --duel adds the
//                                            duelable-ground coverage, slow)
//
// The hand-built w01 and the seeded w02 were retired by the designer on
// 2026-09-08 ("just completely big blocks of boring empty featureless
// rectangles"; no 10×10 crop of either came near the bed). Every fixture
// is linted as it is written and the report is printed; world-shots.mjs
// renders the set for the designer's eye.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadWorld } from '../../play/js/world.mjs';
import { loadStageV2 } from '../../play/js/stage.mjs';
import { generateWorld, lintWorld } from '../../play/js/dungeon.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'play', 'worlds');
mkdirSync(DIR, { recursive: true });

/** The fixture set: style, seed, size — stable ids, so the smokes can name them. */
export const FIXTURES = [
  { style: 'vaults', seed: 1 },
  { style: 'vaults', seed: 2 },
  { style: 'vaults', seed: 3 },
  { style: 'vaults', seed: 4, cols: 9, rows: 6, title: 'The Vaults 4 (large)' },
];

export function loadPieces() {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'play', 'stages', 'manifest.json'), 'utf8'));
  return manifest.stages.map((j) => loadStageV2(j));
}

export function buildManifest() {
  const worlds = [];
  for (const file of readdirSync(DIR).sort()) {
    if (!file.endsWith('.json') || file === 'manifest.json') continue;
    const json = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
    const world = loadWorld(json);
    if (world.id !== file.replace(/\.json$/, '')) throw new Error(`${file}: id "${world.id}" does not match filename`);
    worlds.push(json);
  }
  return { schema: 2, count: worlds.length, worlds };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const duel = process.argv.includes('--duel');
  const pieces = loadPieces();
  const written = new Set();
  for (const f of FIXTURES) {
    const json = generateWorld({ ...f, pieces });
    const lint = lintWorld(json, { duel, samples: 80 });
    if (!lint.ok) throw new Error(`${json.id}: the lints fail — ${JSON.stringify({ unreachable: lint.reach.unreachable, narrow: lint.narrow.pockets.length, boring: lint.density.violations })}`);
    writeFileSync(join(DIR, `${json.id}.json`), JSON.stringify(json, null, 1) + '\n');
    written.add(`${json.id}.json`);
    const g = json.gen;
    console.log(`${json.id}: ${json.map[0].length}×${json.map.length}, ${lint.reach.passable} passable cells all reachable, ${g.pieces.length} pieces (${new Set(g.pieces.map((t) => t.id)).size} distinct), carved ${g.fixes.carved} / widened ${g.fixes.widened} / dropped ${g.fixes.dropped} in ${g.fixes.rounds} round(s), narrow extent ≤ ${lint.narrow.maxExtent}, boring boxes ${lint.density.violations} of ${lint.density.dense} dense, spawns ${g.spawns.map((s) => `${s.width}@${s.dist}`).join(' ')}${lint.coverage ? `, duelable ${Math.round(lint.coverage.ratio * 100)}% of ${lint.coverage.sampled} sampled${lint.coverage.dead.length ? ` (dead tiles ${lint.coverage.dead.join(' ')})` : ''}` : ''}`);
  }
  // A fixture no longer in the set goes (the retired maps included).
  for (const file of readdirSync(DIR)) if (file.endsWith('.json') && file !== 'manifest.json' && !written.has(file)) { unlinkSync(join(DIR, file)); console.log(`${file}: removed`); }
  const manifest = buildManifest();
  writeFileSync(join(DIR, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`manifest.json: ${manifest.count} worlds bundled`);
}
