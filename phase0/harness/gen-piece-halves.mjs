// Regenerate the TILE-GRID piece halves in play/tiles.css from the
// committed atlas (play/img/pieces.png + tileset.json) — the way to refresh
// them WITHOUT the piece packs on disk. repack-tiles.mjs emits the very same
// lines (both go through lib/piecehalves.mjs) when it runs with the packs,
// so a full repack reproduces this file byte for byte.
//
// Usage (from phase0/): node harness/gen-piece-halves.mjs [--check]
//   --check  exit 1 if tiles.css would change (the committed halves are stale)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng, crop } from '../lib/png.mjs';
import { pieceHalves, halvesDecl, halvesRule, ATLAS_CELL } from '../lib/piecehalves.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLAY = join(ROOT, 'play');
const CHECK = process.argv.includes('--check');

const atlas = decodePng(readFileSync(join(PLAY, 'img', 'pieces.png')));
const index = JSON.parse(readFileSync(join(PLAY, 'img', 'tileset.json'), 'utf8')).pieces;
const cssPath = join(PLAY, 'tiles.css');
const lines = readFileSync(cssPath, 'utf8').split('\n');

// 1. Inside every `[data-pieces="<set>"] {` block: after each `--piece-<fen>:`
//    line, the two halves (replacing any halves already there).
const out = [];
let set = null;
for (const line of lines) {
  const open = line.match(/^\[data-pieces="([^"]+)"\] \{$/);
  if (open) set = open[1];
  else if (line === '}') set = null;
  if (/^  --piece-[A-Za-z]-(lo|hi): /.test(line)) continue; // regenerated below
  out.push(line);
  const own = set && line.match(/^  --piece-([A-Za-z]): url\(/);
  if (!own) continue;
  const fen = own[1];
  const s = index.sets[set];
  if (!s) throw new Error(`tileset.json knows no piece set "${set}"`);
  const col = (fen === fen.toUpperCase() ? 0 : 6) + index.order.indexOf(fen.toLowerCase());
  const cell = crop(atlas, col * ATLAS_CELL, s.row * ATLAS_CELL, s.box[0], ATLAS_CELL);
  out.push(...halvesDecl(fen, pieceHalves(cell)));
}
// 2. The per-letter mapping rules, right after each `--piece-img` rule.
const final = [];
for (const line of out) {
  if (/^\[data-pieces\] \[data-piece="[A-Za-z]"\] \{ --piece-lo: /.test(line)) continue;
  final.push(line);
  const m = line.match(/^\[data-pieces\] \[data-piece="([A-Za-z])"\] \{ --piece-img: /);
  if (m) final.push(halvesRule(m[1]));
}
const next = final.join('\n');
const prev = lines.join('\n');
if (next === prev) {
  console.log('tiles.css: piece halves up to date');
} else if (CHECK) {
  console.error('tiles.css: the piece halves are STALE — run node harness/gen-piece-halves.mjs');
  process.exit(1);
} else {
  writeFileSync(cssPath, next);
  const n = final.filter((l) => /^  --piece-[A-Za-z]-lo: /.test(l)).length;
  console.log(`tiles.css: wrote ${n} piece halves pairs`);
}
