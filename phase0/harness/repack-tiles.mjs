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
import { canonicalMask, WALL_MASK_CODES } from '../../play/js/board-ui.mjs';

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
// variants (board-ui.mjs picks f1/f2/f3 per square); wall is the plain
// east–west run (the legend, and the fallback); wall-<mask> are the 47
// AUTOTILE cases (board-ui.mjs canonicalMask: N=1 E=2 S=4 W=8, diagonals
// NE=16 SE=32 SW=64 NW=128 — the renderer classes each wall `wm-<mask>`),
// GENERATED below in the pack's colours with the pack's brick face; door-v
// is the edge-on door for a north–south wall line; the rest are the
// furniture sprites (skin-<name>; crate is the '^' default).
const ROLES = {
  'floor-1': '--tile-floor-1',
  'floor-2': '--tile-floor-2',
  'floor-3': '--tile-floor-3',
  wall: '--tile-wall',
  door: '--sprite-door',
  'door-v': '--sprite-door-v',
  crate: '--sprite-crate',
  chest: '--sprite-chest',
  barrel: '--sprite-barrel',
  rubble: '--sprite-rubble',
};
for (const code of WALL_MASK_CODES) ROLES[`wall-${code}`] = `--tile-wall-${code}`;

// ---- the wall blob (round 5, 2026-09-03: "walls still look janky")
// The packs draw walls as 2.5-D ROOM BORDERS two tiles tall (a top surface
// and, below it, a brick face) and ship no thin-wall set at all, so
// stitching their pieces into one-cell walls made fence posts and
// mismatched junctions. Instead every case is drawn here, in the pack's own
// colours, with the pack's own bricks: a wall is a TOP BAND — an east–west
// run fills rows 0–8 edge to edge, a north–south run fills columns 3–12
// top to bottom, corners/T/crosses are their union, and a thick block's
// inner corner fills only when the diagonal neighbour is solid too (the
// 47-case blob) — bevelled light on north/west edges and dark on
// south/east edges wherever the surface does not continue into a solid
// neighbour, outlined 1 px on the floor, and EXTRUDED: under every south
// edge that ends inside the cell the pack's brick face (FACE_H rows cropped
// from its wall tile) hangs down, so an east–west wall reads cap-and-face
// like the pack's own, a column's south end shows its face, and a thick
// block faces south along its whole bottom. The floor tile shows through
// the transparent margins (style.css layers the wall over the floor).
const BAND = { x0: 3, x1: 12, y1: 8 }; // north–south band columns; east–west band's last row
const FACE_H = 7;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hash = (x, y, k) => (((x + 1) * 73856093) ^ ((y + 1) * 19349663) ^ ((k + 1) * 83492791)) >>> 0;

function wallBlob(spec, sheets) {
  const fill = hex(spec.fill), hi = hex(spec.hi), lo = hex(spec.lo), edge = hex(spec.edge);
  const face = crop(sheets[spec.face.sheet], spec.face.x * T, spec.face.y * T + spec.face.row, T, FACE_H);
  const facePx = (x, r) => { const o = (r * T + x) * 4; return [face.data[o], face.data[o + 1], face.data[o + 2]]; };
  const inBand = (x) => x >= BAND.x0 && x <= BAND.x1;
  const out = {};
  for (const code of WALL_MASK_CODES) {
    const n = code & 1, e = code & 2, s = code & 4, w = code & 8, ne = code & 16, se = code & 32, sw = code & 64, nw = code & 128;
    // Is (x, y) wall surface — inside the cell, or (just outside it) in the
    // neighbour, which by construction holds the same bands.
    const body = (x, y) => {
      if (y < 0) return inBand(x) ? !!n : x > BAND.x1 ? !!(n && e && ne) : !!(n && w && nw);
      if (y >= T) return inBand(x) ? !!s : x > BAND.x1 ? !!(s && e && se) : !!(s && w && sw);
      if (x < 0) return y <= BAND.y1 ? !!w : !!(w && s && sw);
      if (x >= T) return y <= BAND.y1 ? !!e : !!(e && s && se);
      if (y <= BAND.y1) return inBand(x) || (x > BAND.x1 ? !!e : !!w);
      return inBand(x) ? !!s : x > BAND.x1 ? !!(s && e && se) : !!(s && w && sw);
    };
    const tile = blank(T, T);
    const solidPx = Array.from({ length: T }, () => Array(T).fill(false));
    const put = (x, y, c) => {
      const o = (y * T + x) * 4;
      tile.data[o] = c[0]; tile.data[o + 1] = c[1]; tile.data[o + 2] = c[2]; tile.data[o + 3] = 255;
      solidPx[y][x] = true;
    };
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (!body(x, y)) continue;
        let c = fill;
        if (spec.speckle && hash(x, y, 0) % 100 < spec.speckle) c = mix(fill, lo, 0.5);
        if (!body(x + 1, y) || !body(x, y + 1)) c = lo;
        if (!body(x - 1, y) || !body(x, y - 1)) c = hi;
        put(x, y, c);
      }
    }
    for (let x = 0; x < T; x++) {
      let yb = -1;
      for (let y = 0; y < T; y++) if (body(x, y)) yb = y;
      if (yb < 0 || yb >= T - 1) continue;
      for (let r = 0; r < FACE_H && yb + 1 + r < T; r++) {
        const y = yb + 1 + r;
        put(x, y, r === FACE_H - 1 ? mix(facePx(x, r), edge, 0.5) : facePx(x, r));
      }
    }
    const solidAt = (x, y) => x >= 0 && x < T && y >= 0 && y < T && solidPx[y][x];
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (solidPx[y][x]) continue;
        if (solidAt(x - 1, y) || solidAt(x + 1, y) || solidAt(x, y - 1) || solidAt(x, y + 1)) {
          const o = (y * T + x) * 4;
          tile.data[o] = edge[0]; tile.data[o + 1] = edge[1]; tile.data[o + 2] = edge[2]; tile.data[o + 3] = 255;
        }
      }
    }
    out[`wall-${code}`] = tile;
  }
  return out;
}

// The edge-on door for a north–south wall line: the wall band continues
// through the top and bottom rows, and between them a plank door in the
// pack door's own wood and iron (pixel-poem's leaf, sampled), framed dark.
const DOOR_WOOD = { wood: hex('#895a45'), woodHi: hex('#bf704d'), seam: hex('#523b40'), woodLo: hex('#724736'), iron: hex('#adc1cf'), ironLo: hex('#90919e'), ink: hex('#25131a') };
function doorEdgeOn(spec) {
  const fill = hex(spec.fill), hi = hex(spec.hi), lo = hex(spec.lo), edge = hex(spec.edge);
  const D = DOOR_WOOD;
  const tile = blank(T, T);
  const put = (x, y, c) => { const o = (y * T + x) * 4; tile.data[o] = c[0]; tile.data[o + 1] = c[1]; tile.data[o + 2] = c[2]; tile.data[o + 3] = 255; };
  for (let y = 0; y < T; y++) { put(BAND.x0 - 1, y, edge); put(BAND.x1 + 1, y, edge); }
  for (const y of [0, 1, T - 2, T - 1]) for (let x = BAND.x0; x <= BAND.x1; x++) put(x, y, x === BAND.x0 ? hi : x === BAND.x1 ? lo : fill);
  for (let x = BAND.x0; x <= BAND.x1; x++) { put(x, 2, D.ink); put(x, T - 3, D.ink); }
  for (let y = 3; y <= T - 4; y++) {
    for (let x = BAND.x0; x <= BAND.x1; x++) {
      const k = x - BAND.x0; // 0..9: three planks with two seams
      put(x, y, k === 3 || k === 7 ? D.seam : k === 0 || k === 4 || k === 8 ? D.woodHi : k === 9 ? D.woodLo : D.wood);
    }
  }
  for (const y of [5, T - 6]) for (let x = BAND.x0; x <= BAND.x1; x++) put(x, y, (x - BAND.x0) % 4 === 1 ? D.ink : D.iron);
  for (const y of [6, T - 5]) for (let x = BAND.x0; x <= BAND.x1; x++) put(x, y, D.ironLo);
  put(BAND.x1 - 1, 8, D.ink); put(BAND.x1, 8, D.iron); // the ring
  return tile;
}

const THEMES = {
  hall: {
    title: 'The hall — pixel-poem’s keep: purple-grey flagstones, salmon stone, timber doors',
    tiles: {
      'floor-1': ['pp', 8, 1],
      'floor-2': ['pp', 6, 0],
      'floor-3': ['pp', 7, 2],
      door: ['pp', 7, 3],
      crate: ['pp', 0, 8],
      chest: ['pp', 2, 8],
      rubble: ['cat', 20, 22],
    },
    // Top band in the pack's cap colours; the face is its own brick rows.
    wall: { fill: '#6e4a48', hi: '#916a62', lo: '#4c2f49', edge: '#25131a', speckle: 0, face: { sheet: 'pp', x: 2, y: 0, row: 4 } },
  },
  castle: {
    title: 'The castle — Dungeon Gathering’s cold blue-grey stone',
    tiles: {
      'floor-1': ['dg', 10, 3],
      'floor-2': ['dg', 11, 2],
      'floor-3': ['dg', 13, 2],
      door: ['pp', 7, 3],
      crate: ['pp', 0, 8],
      chest: ['pp', 2, 8],
      barrel: ['dg', 2, 12],
      rubble: ['dg', 12, 12],
    },
    // The pack's wall-top blue with its highlight/shade; brick face rows.
    wall: { fill: '#92a1b9', hi: '#c7cfdd', lo: '#5a6787', edge: '#181425', speckle: 0, face: { sheet: 'dg', x: 6, y: 10, row: 8 } },
  },
  crypt: {
    title: 'The crypt — Szadi art’s catacombs: dark brown flagstones, low brick walls',
    tiles: {
      'floor-1': ['cat', 47, 14],
      'floor-2': ['cat', 46, 13],
      'floor-3': ['cat', 47, 15],
      door: ['pp', 7, 3],
      crate: ['catdeco', 8, 5],
      chest: ['pp', 2, 8],
      barrel: ['catdeco', 12, 8],
      rubble: ['cat', 20, 22],
    },
    // Lifted a step above the pack's near-black stone so a wall reads
    // against its own floor; speckled like its column.
    wall: { fill: '#3c3129', hi: '#5a5347', lo: '#231f19', edge: '#0e0a08', speckle: 14, face: { sheet: 'cat', x: 33, y: 8, row: 6 } },
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
  const emit = (role, tile, prov) => {
    if (!(role in ROLES)) throw new Error(`${theme}: unknown role ${role}`);
    const col = roleNames.indexOf(role);
    blit(atlas, tile, col * T, row * T);
    const b64 = encodePng(tile).toString('base64');
    decl.push(`  ${ROLES[role]}: url("data:image/png;base64,${b64}");`);
    index.themes[theme].tiles[role] = { col, ...prov };
    if (!prov.composed) provenance.push({ theme, role, ...prov });
  };
  const tiles = {};
  for (const [role, [sheet, x, y]] of Object.entries(THEMES[theme].tiles)) {
    tiles[role] = crop(sheets[sheet], x * T, y * T, T, T);
    emit(role, tiles[role], { pack: SHEETS[sheet][0], sheet: SHEETS[sheet][1], x, y });
  }
  const ws = THEMES[theme].wall;
  const cases = wallBlob(ws, sheets);
  const fs = ws.face;
  provenance.push({ theme, role: 'wall face (brick rows under every south edge)', pack: SHEETS[fs.sheet][0], sheet: SHEETS[fs.sheet][1], x: fs.x, y: fs.y });
  emit('wall', cases['wall-10'], { composed: 'blob case 10 (east–west run)', mask: 10 });
  for (const [role, tile] of Object.entries(cases)) emit(role, tile, { composed: 'blob in the pack palette + its face', mask: +role.slice(5) });
  emit('door-v', doorEdgeOn(ws), { composed: 'edge-on door: wall band + pixel-poem door wood' });
  css.push(`[data-theme="${theme}"] {\n${decl.join('\n')}\n}`);
});
// Pack tiles fill their 16×16 cell edge to edge; the in-house sprites carry
// their own margins, so under a theme every furniture sprite is full-size.
// The autotile classes → the theme's case, the plain wall as the fallback
// (so the in-house set, with no per-case tiles, paints its one block).
for (const code of WALL_MASK_CODES) css.push(`.cell.wm-${code} { --wall-tile: var(--tile-wall-${code}, var(--tile-wall)); }`);
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
md.push('The remaining sprites (table, chair, shelf, the hole, the crack, and every role a theme does not override) are drawn in-house by `phase0/harness/gen-sprites.mjs`. The wall autotile (47 cases per theme, `wall-<mask>` in the atlas) and the edge-on door are GENERATED by the repack tool in each pack\'s colours; the only pack pixels in them are the brick FACE rows cropped from the pack\'s wall tile listed below (pixel-poem\'s door wood colours are reused for the edge-on door).');
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
