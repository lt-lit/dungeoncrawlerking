#!/usr/bin/env node
// Bundle play/stages/*.json into play/stages/manifest.json — the single
// fetch the game's setup screen loads at boot (GitHub Pages serves no
// directory listing, and the whole bed is a few tens of KB, so one bundle
// beats N round trips). Every stage is validated through loadStageV2 before it
// is admitted; a bad stage fails the build, not the phone.
//
//   node harness/gen-stage-manifest.mjs      (from phase0/)
//
// Re-run after adding or editing any stage. verify-stages.mjs asserts the
// committed manifest matches the directory so a stale bundle can't ship.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadStageV2 } from '../../play/js/stage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STAGE_DIR = join(ROOT, 'play', 'stages');

export function buildManifest() {
  const stages = [];
  for (const file of readdirSync(STAGE_DIR).sort()) {
    if (!file.endsWith('.json') || file === 'manifest.json') continue;
    const json = JSON.parse(readFileSync(join(STAGE_DIR, file), 'utf8'));
    const stage = loadStageV2(json); // throws on any invalid stage
    if (stage.id !== file.replace(/\.json$/, '')) {
      throw new Error(`${file}: id "${stage.id}" does not match filename`);
    }
    stages.push(json);
  }
  return { schema: 2, count: stages.length, stages };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = buildManifest();
  writeFileSync(join(STAGE_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  console.log(`manifest.json: ${manifest.count} stages bundled`);
}
