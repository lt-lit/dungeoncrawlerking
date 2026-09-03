#!/usr/bin/env node
// Repack the third-party tilesets into the game's own atlas + CSS.
//
// The board's art comes from three FREE 16×16 packs (designer decision
// 2026-09-03: "use them all, 16×16 is the standard, mix and match, repack
// and give credit"). The packs themselves are NOT in the repo — put them
// under phase0/assets-src/ (gitignored; see SHEETS for the expected files)
// and run this. Only the tiles the game uses are cropped out, into:
//
//   play/img/tileset.png   the repacked atlas (one row per theme, one
//                          column per role) — the human-readable record of
//                          what was taken
//   play/img/tileset.json  atlas index + per-tile provenance
//   play/tiles.css         the runtime: every tile as a data-URI custom
//                          property scoped to [data-theme="<theme>"], so a
//                          board (or the legend) switches art by attribute
//                          and any cell size stays pixel-exact (no sheet
//                          bleed at fractional scales)
//   play/CREDITS.md        attribution, generated from PACKS + the picks
//
// THEMES: `hall` (pixel-poem's purple-and-timber keep), `castle` (Dungeon
// Gathering's cold blue-grey stone), `crypt` (Szadi art's dark catacombs).
// Where a pack lacks a role the theme borrows from another pack; where no
// pack has it (table, chair, shelf, the hole, the crack) the theme falls
// back to the in-house sprites (gen-sprites.mjs) — that is what "no
// override" in a theme block means. Roles are the renderer's names
// (style.css --tile-* / --sprite-*).
//
// Usage (from phase0/): node harness/repack-tiles.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng, encodePng, blank, crop, blit, samePixels } from '../lib/png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'phase0', 'assets-src');
const PLAY = join(ROOT, 'play');
const T = 16;

const PACKS = {
  'dungeon-gathering': {
    title: 'Dungeon Gathering (free version)',
    author: 'SnowHex (Jose Javier)',
    url: 'https://snowhex.itch.io/dungeon-gathering',
    terms: 'Free for commercial and non-commercial projects, edits allowed, credit appreciated. The pack itself may not be redistributed or resold as game assets, images or NFTs — only the tiles the game uses are repacked here.',
  },
  'pixel-poem': {
    title: 'Dungeon Asset Puck — 2D Pixel Dungeon Asset Pack (free version)',
    author: 'pixel-poem',
    url: 'https://pixel-poem.itch.io/dungeon-assetpuck',
    terms: 'Free and commercial projects, modification allowed, credit appreciated. No redistribution or resale of the pack — only the tiles the game uses are repacked here.',
  },
  catacombs: {
    title: 'Rogue Fantasy Catacombs',
    author: 'Szadi art',
    url: 'https://szadiart.itch.io/rogue-fantasy-catacombs',
    terms: 'Public domain, free for personal or commercial use, edits allowed, credit appreciated. The pack may not be resold, original or changed.',
  },
};

// Sheet key → [pack, file under assets-src/<pack>/]. Tile coords below are
// in 16-px tile units on these sheets (x = column, y = row, 0-based).
const SHEETS = {
  dg: ['dungeon-gathering', 'Set 1.png'],
  pp: ['pixel-poem', 'Dungeon_Tileset.png'],
  cat: ['catacombs', 'mainlevbuild.png'],
  catdeco: ['catacombs', 'decorative.png'],
};

// Role → the custom property it paints. floor-N are the floor's stable
// variants (board-ui.mjs picks f1/f2/f3 per square), wall-v the tile for a
// wall standing in a VERTICAL run (falls back to wall), the rest are the
// furniture sprites (skin-<name>; crate is the '^' default).
const ROLES = {
  'floor-1': '--tile-floor-1',
  'floor-2': '--tile-floor-2',
  'floor-3': '--tile-floor-3',
  wall: '--tile-wall',
  'wall-v': '--tile-wall-v',
  door: '--sprite-door',
  crate: '--sprite-crate',
  chest: '--sprite-chest',
  barrel: '--sprite-barrel',
  rubble: '--sprite-rubble',
};

const THEMES = {
  hall: {
    title: 'The hall — pixel-poem’s keep: purple-grey flagstones, salmon stone, timber doors',
    tiles: {
      'floor-1': ['pp', 8, 1],
      'floor-2': ['pp', 6, 0],
      'floor-3': ['pp', 7, 2],
      wall: ['pp', 2, 0],
      door: ['pp', 7, 3],
      crate: ['pp', 0, 8],
      chest: ['pp', 2, 8],
      rubble: ['cat', 20, 22],
    },
  },
  castle: {
    title: 'The castle — Dungeon Gathering’s cold blue-grey stone',
    tiles: {
      'floor-1': ['dg', 10, 3],
      'floor-2': ['dg', 11, 2],
      'floor-3': ['dg', 13, 2],
      wall: ['dg', 6, 10],
      door: ['pp', 7, 3],
      crate: ['pp', 0, 8],
      chest: ['pp', 2, 8],
      barrel: ['dg', 2, 12],
      rubble: ['dg', 12, 12],
    },
  },
  crypt: {
    title: 'The crypt — Szadi art’s catacombs: dark brown flagstones, low brick walls',
    tiles: {
      'floor-1': ['cat', 47, 14],
      'floor-2': ['cat', 46, 13],
      'floor-3': ['cat', 47, 15],
      wall: ['cat', 33, 8],
      'wall-v': ['cat', 25, 4],
      door: ['pp', 7, 3],
      crate: ['catdeco', 8, 5],
      chest: ['pp', 2, 8],
      barrel: ['catdeco', 12, 8],
      rubble: ['cat', 20, 22],
    },
  },
};

// ---- load sheets
const sheets = {};
for (const [key, [pack, file]] of Object.entries(SHEETS)) {
  const p = join(SRC, pack, file);
  if (!existsSync(p)) {
    console.error(`missing ${p}\n  download ${PACKS[pack].title} from ${PACKS[pack].url} and put "${file}" there`);
    process.exit(2);
  }
  sheets[key] = decodePng(readFileSync(p));
}

// ---- crop + atlas
const roleNames = Object.keys(ROLES);
const themeNames = Object.keys(THEMES);
const atlas = blank(roleNames.length * T, themeNames.length * T);
const index = { tile: T, roles: roleNames, themes: {}, packs: PACKS };
const css = ['/* --- generated by phase0/harness/repack-tiles.mjs — do not hand-edit; art credits in play/CREDITS.md --- */'];
const provenance = [];
themeNames.forEach((theme, row) => {
  const decl = [];
  index.themes[theme] = { row, title: THEMES[theme].title, tiles: {} };
  for (const [role, [sheet, x, y]] of Object.entries(THEMES[theme].tiles)) {
    if (!(role in ROLES)) throw new Error(`${theme}: unknown role ${role}`);
    const col = roleNames.indexOf(role);
    const tile = crop(sheets[sheet], x * T, y * T, T, T);
    blit(atlas, tile, col * T, row * T);
    const b64 = encodePng(tile).toString('base64');
    decl.push(`  ${ROLES[role]}: url("data:image/png;base64,${b64}");`);
    const pack = SHEETS[sheet][0];
    index.themes[theme].tiles[role] = { col, pack, sheet: SHEETS[sheet][1], x, y };
    provenance.push({ theme, role, pack, sheet: SHEETS[sheet][1], x, y });
  }
  css.push(`[data-theme="${theme}"] {\n${decl.join('\n')}\n}`);
});
// Pack tiles fill their 16×16 cell edge to edge; the in-house sprites carry
// their own margins, so under a theme every furniture sprite is full-size.
css.push('[data-theme] .cell.furniture .piece.neutral { width: 100%; height: 100%; }');
css.push('[data-theme] { --floor-shade: #00000038; }');

mkdirSync(join(PLAY, 'img'), { recursive: true });
const atlasPng = encodePng(atlas);
if (!samePixels(decodePng(atlasPng), atlas)) throw new Error('atlas round-trip failed');
writeFileSync(join(PLAY, 'img', 'tileset.png'), atlasPng);
writeFileSync(join(PLAY, 'img', 'tileset.json'), JSON.stringify(index, null, 1) + '\n');
writeFileSync(join(PLAY, 'tiles.css'), css.join('\n') + '\n');

// ---- credits
const md = [];
md.push('# Art credits');
md.push('');
md.push('The board tiles in `play/img/tileset.png` (and the same tiles inlined in `play/tiles.css`) are repacked from three free 16×16 pixel-art packs. Only the tiles the game uses are included; the packs themselves are not redistributed here — get them from their authors:');
md.push('');
for (const [key, p] of Object.entries(PACKS)) {
  md.push(`- **${p.title}** by ${p.author} — <${p.url}>  `);
  md.push(`  ${p.terms}`);
}
md.push('');
md.push('The remaining sprites (table, chair, shelf, the hole, the crack, and every role a theme does not override) are drawn in-house by `phase0/harness/gen-sprites.mjs`.');
md.push('');
md.push('## Which tile came from where');
md.push('');
md.push('Tile coordinates are 16-px tile units on the named sheet (column, row; 0-based). Regenerate with `cd phase0 && node harness/repack-tiles.mjs` after placing the packs under `phase0/assets-src/` (gitignored).');
md.push('');
md.push('| theme | role | pack | sheet | col | row |');
md.push('|---|---|---|---|---|---|');
for (const p of provenance) md.push(`| ${p.theme} | ${p.role} | ${PACKS[p.pack].title.split(' —')[0].split(' (')[0]} | ${p.sheet} | ${p.x} | ${p.y} |`);
md.push('');
writeFileSync(join(PLAY, 'CREDITS.md'), md.join('\n'));

console.log(`tileset.png ${atlas.width}×${atlas.height} (${atlasPng.length} B), tiles.css ${css.join('\n').length} B, ${provenance.length} tiles over ${themeNames.length} themes; CREDITS.md written`);
