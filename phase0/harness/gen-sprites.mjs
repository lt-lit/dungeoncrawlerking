#!/usr/bin/env node
// Placeholder pixel-art tiles + furniture sprites for the board, as inline
// SVG data URIs, written into play/style.css between the @sprites markers.
// 16×16 crisp-edged rects — chunky enough to read at 30 px, cheap to swap
// for a real tileset later (a tileset replaces what these variables paint,
// nothing else). Usage (from phase0/): node harness/gen-sprites.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CSS = join(ROOT, 'play', 'style.css');

// Palette (shared so the set reads as one hand).
const P = {
  mortar: '#262433', stone: '#605e7a', stoneHi: '#8583a3', stoneLo: '#403e55', speck: '#6f6d8c', speckLo: '#52506a',
  crack: '#0b0a10',
  ink: '#3a2213', woodHi: '#d09a5c', wood: '#b8713a', woodLo: '#8a4f28', woodDeep: '#5a3418', iron: '#9aa0ad', ironLo: '#5d626e', gold: '#e0c25a', red: '#c96a4a',
};

const R = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const PATH = (d, stroke, w, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="square" stroke-linejoin="miter"${extra}/>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${body}</svg>`;
const uri = (s) => `url("data:image/svg+xml,${encodeURIComponent(s).replace(/%20/g, ' ').replace(/%3D/g, '=').replace(/%3A/g, ':').replace(/%2F/g, '/').replace(/%22/g, "'")}")`;

const SPRITES = {
  // One stone block per tile, outlined — adjacent tiles read as a wall line.
  'tile-wall': svg(
    R(0, 0, 16, 16, P.mortar) + R(1, 1, 14, 14, P.stone) +
    R(1, 1, 14, 1, P.stoneHi) + R(1, 1, 1, 14, P.stoneHi) + R(1, 14, 14, 1, P.stoneLo) + R(14, 1, 1, 14, P.stoneLo) +
    R(4, 5, 1, 1, P.speck) + R(10, 3, 1, 1, P.speck) + R(6, 10, 1, 1, P.speck) + R(12, 11, 1, 1, P.speck) + R(3, 12, 1, 1, P.speck) + R(8, 7, 1, 1, P.speckLo) + R(11, 8, 1, 1, P.speckLo)
  ),
  // THE crack: thin black branching lines and nothing else — transparent
  // everywhere, no highlight, so it reads on any wall colour. One overlay
  // for every weakened wall, whoever weakened it (a god's crack and an
  // authored weak spot are the same '^' — designer 2026-09-03): laid over
  // the wall tile by the .cracking fx and carried by the sprite element on
  // a cracked wall or a weak spot. Round 13: drawn ON THE 16×16 PIXEL GRID
  // — one black pixel per wall pixel, 8-connected so it stays one pixel
  // thin on the diagonals — where the first cut was 1-unit strokes at
  // half-pixel offsets that rasterised finer and softer than the wall
  // under it ("make a 16x16 version that actually matches the resolution
  // of the wall"). Round 14: FOUR drawings ("make a few more variations
  // and we can use a mix of them" — board-ui stamps ck1…ck4 on every cell
  // by a stable hash of the square, style.css maps them): a fissure top to
  // bottom, a diagonal, a fork, a low crack across the block.
  ...Object.fromEntries([
    [ // 1: the fissure, four branches and a nick
      [[7, 0], [7, 1], [6, 2], [6, 3], [5, 4], [5, 5], [6, 6], [6, 7], [7, 8], [7, 9], [7, 10], [8, 11], [8, 12], [7, 13], [7, 14], [8, 15]],
      [[7, 5], [8, 4], [9, 4], [10, 3], [11, 3], [12, 2]],
      [[4, 5], [3, 6], [2, 6], [1, 7]],
      [[9, 11], [10, 12], [11, 12], [12, 13], [13, 13]],
      [[6, 14], [5, 14], [4, 15]],
      [[8, 8], [9, 8]],
    ],
    [ // 2: a diagonal, top-left to bottom-right
      [[2, 0], [3, 1], [3, 2], [4, 3], [5, 4], [5, 5], [6, 6], [7, 7], [8, 8], [8, 9], [9, 10], [10, 11], [10, 12], [11, 13], [12, 14], [12, 15]],
      [[4, 6], [3, 7], [2, 7], [1, 8]],
      [[9, 7], [10, 6], [11, 6], [12, 5], [13, 4]],
      [[9, 13], [8, 14], [7, 14]],
      [[4, 2], [5, 2]],
    ],
    [ // 3: a fork — one stem from the bottom, two arms to the top
      [[6, 15], [6, 14], [7, 13], [7, 12], [7, 11], [8, 10], [8, 9], [8, 8], [8, 7]],
      [[7, 6], [6, 5], [6, 4], [5, 3], [5, 2], [4, 1], [4, 0]],
      [[9, 6], [10, 5], [10, 4], [11, 3], [11, 2], [12, 1], [12, 0]],
      [[9, 9], [10, 9], [11, 8], [12, 8]],
      [[6, 12], [5, 11], [4, 11], [3, 10]],
      [[3, 3], [4, 3]],
    ],
    [ // 4: a low crack across the block, edge to edge
      [[0, 9], [1, 9], [2, 8], [3, 8], [4, 9], [5, 10], [6, 10], [7, 9], [8, 9], [9, 8], [10, 8], [11, 9], [12, 10], [13, 10], [14, 11], [15, 11]],
      [[7, 8], [8, 7], [8, 6], [9, 5], [9, 4]],
      [[3, 7], [2, 6], [2, 5]],
      [[13, 11], [13, 12], [14, 13]],
      [[4, 10], [3, 11], [3, 12]],
      [[10, 7], [11, 6]],
    ],
  ].map((lines, i) => {
    // Every line is one pixel thin and 8-connected: consecutive points
    // differ by at most one in each axis, all on the 16×16 grid.
    for (const line of lines) for (let k = 0; k < line.length; k++) {
      const [x, y] = line[k];
      if (x < 0 || x > 15 || y < 0 || y > 15) throw new Error(`crack ${i + 1}: (${x},${y}) off the grid`);
      if (k && (Math.abs(x - line[k - 1][0]) > 1 || Math.abs(y - line[k - 1][1]) > 1)) throw new Error(`crack ${i + 1}: (${x},${y}) is not 8-connected to its predecessor`);
    }
    const px = new Set(lines.flat().map(([x, y]) => `${x},${y}`));
    return [`tile-crack-${i + 1}`, svg([...px].map((k) => { const [x, y] = k.split(',').map(Number); return R(x, y, 1, 1, P.crack); }).join(''))];
  })),
  // A crate: horizontal plank slats with dark seams, a raised lighter lid
  // strip, and four iron nails at the corners of the batten frame — a stack
  // of planks reads as a crate where a box with an X read as a tile.
  crate: svg(
    R(1, 1, 14, 14, P.ink) + R(2, 2, 12, 12, P.wood) +
    R(2, 2, 12, 2, P.woodHi) + R(2, 5, 12, 1, P.woodDeep) + R(2, 8, 12, 1, P.woodDeep) + R(2, 11, 12, 1, P.woodDeep) +
    R(2, 6, 12, 1, P.woodHi) + R(2, 9, 12, 1, P.woodHi) + R(2, 12, 12, 2, P.woodLo) +
    R(2, 2, 2, 12, P.woodLo) + R(12, 2, 2, 12, P.woodLo) + R(3, 3, 1, 10, P.wood) + R(12, 3, 1, 10, P.woodDeep) +
    R(3, 3, 1, 1, P.iron) + R(12, 3, 1, 1, P.iron) + R(3, 12, 1, 1, P.iron) + R(12, 12, 1, 1, P.iron)
  ),
  // A door IN a wall: stone jambs and lintel (the wall's own block colours)
  // around an arched door of vertical planks, one iron band, a ring handle.
  // Vertical planks + jambs are what say "door" at 30 px (a banded box
  // reads as a barrel or a chest).
  door: svg(
    R(0, 0, 16, 16, P.mortar) + R(1, 1, 2, 15, P.stone) + R(13, 1, 2, 15, P.stone) + R(1, 1, 14, 1, P.stone) +
    R(1, 1, 2, 1, P.stoneHi) + R(13, 1, 2, 1, P.stoneHi) + R(1, 1, 1, 15, P.stoneHi) +
    R(3, 2, 10, 14, P.ink) +
    R(4, 4, 8, 12, P.woodLo) + R(5, 3, 6, 1, P.woodLo) +
    R(4, 4, 1, 12, P.wood) + R(7, 3, 1, 13, P.wood) + R(10, 4, 1, 12, P.wood) +
    R(6, 4, 1, 12, P.woodDeep) + R(9, 4, 1, 12, P.woodDeep) +
    R(4, 9, 8, 2, P.ironLo) + R(4, 9, 8, 1, P.iron) + R(5, 9, 1, 2, P.ink) + R(10, 9, 1, 2, P.ink) +
    R(10, 12, 2, 2, P.gold) + R(11, 13, 1, 1, P.ink)
  ),
  // A barrel with two hoops.
  barrel: svg(
    R(3, 1, 10, 14, P.ink) + R(2, 3, 12, 10, P.ink) +
    R(4, 2, 8, 12, P.wood) + R(3, 4, 10, 8, P.wood) +
    R(4, 2, 1, 12, P.woodHi) + R(6, 2, 1, 12, P.woodLo) + R(9, 2, 1, 12, P.woodLo) + R(11, 2, 1, 12, P.woodLo) +
    R(3, 4, 10, 1, P.iron) + R(3, 5, 10, 1, P.ironLo) + R(3, 10, 10, 1, P.iron) + R(3, 11, 10, 1, P.ironLo)
  ),
  // A round table seen from above.
  table: svg(
    R(3, 2, 10, 12, P.ink) + R(2, 3, 12, 10, P.ink) + R(1, 5, 14, 6, P.ink) +
    R(4, 3, 8, 10, P.wood) + R(3, 4, 10, 8, P.wood) + R(2, 6, 12, 4, P.wood) +
    R(4, 3, 8, 1, P.woodHi) + R(3, 4, 1, 8, P.woodHi) + R(3, 7, 10, 1, P.woodLo) + R(4, 10, 8, 1, P.woodLo) + R(2, 6, 12, 1, P.woodHi)
  ),
  // A chair, side on: back, seat, two legs.
  chair: svg(
    R(4, 1, 3, 9, P.ink) + R(5, 2, 1, 7, P.wood) + R(5, 4, 1, 1, P.woodLo) + R(5, 6, 1, 1, P.woodLo) +
    R(3, 8, 11, 3, P.ink) + R(4, 9, 9, 1, P.wood) + R(4, 9, 3, 1, P.woodHi) +
    R(3, 11, 3, 4, P.ink) + R(11, 11, 3, 4, P.ink) + R(4, 11, 1, 3, P.woodLo) + R(12, 11, 1, 3, P.woodLo)
  ),
  // A banded chest with a lock.
  chest: svg(
    R(2, 2, 12, 5, P.ink) + R(3, 3, 10, 3, P.woodLo) + R(3, 3, 10, 1, P.wood) +
    R(2, 7, 12, 7, P.ink) + R(3, 8, 10, 5, P.wood) + R(3, 8, 10, 1, P.woodHi) +
    R(4, 3, 1, 10, P.iron) + R(11, 3, 1, 10, P.iron) + R(4, 6, 1, 1, P.ironLo) + R(11, 6, 1, 1, P.ironLo) +
    R(7, 6, 2, 3, P.gold) + R(7, 7, 2, 1, P.ink)
  ),
  // A shelf unit with odds and ends on it.
  shelf: svg(
    R(2, 1, 12, 14, P.ink) + R(3, 2, 10, 12, P.woodDeep) +
    R(3, 2, 10, 1, P.wood) + R(3, 6, 10, 1, P.wood) + R(3, 10, 10, 1, P.wood) + R(3, 13, 10, 1, P.woodLo) +
    R(4, 3, 2, 3, P.gold) + R(7, 4, 2, 2, P.iron) + R(10, 3, 2, 3, P.red) +
    R(4, 7, 3, 3, P.iron) + R(9, 8, 2, 2, P.gold) + R(5, 11, 2, 2, P.red) + R(9, 11, 3, 2, P.wood)
  ),
  // Rubble: a heap of loose stone — weak masonry, a plug, a fallen arch.
  // The rubble HEAP is residue-only since 2026-09-04 (the classic set's ruin
  // fallback): authored masonry is a weak spot wearing the crack.
  rubble: svg(
    R(1, 8, 7, 7, P.mortar) + R(2, 9, 5, 5, P.stone) + R(2, 9, 5, 1, P.stoneHi) +
    R(7, 9, 8, 6, P.mortar) + R(8, 10, 6, 4, P.stone) + R(8, 10, 6, 1, P.stoneHi) + R(8, 13, 6, 1, P.stoneLo) +
    R(5, 4, 6, 6, P.mortar) + R(6, 5, 4, 4, P.stoneHi) + R(6, 8, 4, 1, P.stone) +
    R(11, 5, 3, 3, P.mortar) + R(12, 6, 1, 1, P.stone) + R(3, 6, 2, 2, P.mortar) + R(3, 6, 1, 1, P.stoneLo)
  ),
};

const lines = ['  /* --- @sprites — generated by phase0/harness/gen-sprites.mjs; do not hand-edit --- */'];
for (const [name, s] of Object.entries(SPRITES)) lines.push(`  --${name.startsWith('tile-') ? name : `sprite-${name}`}: ${uri(s)};`);
lines.push('  /* --- @/sprites --- */');

const css = readFileSync(CSS, 'utf8');
const start = css.indexOf('  /* --- @sprites');
const end = css.indexOf('  /* --- @/sprites --- */');
if (start < 0 || end < 0) throw new Error('style.css: @sprites markers missing');
const out = css.slice(0, start) + lines.join('\n') + css.slice(end + '  /* --- @/sprites --- */'.length);
writeFileSync(CSS, out);
console.log(`style.css: ${Object.keys(SPRITES).length} sprites written (${lines.join('\n').length} bytes)`);
