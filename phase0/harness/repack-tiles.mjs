#!/usr/bin/env node
// Repack the third-party tilesets into the game's own atlas.
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
//   play/img/tileset.json  atlas index + per-tile provenance — the
//                          runtime's ONE source (play/js/atlas.mjs draws
//                          straight off the PNG; play/tiles.css, the same
//                          pixels as data URIs for the DOM board, retired
//                          with it on 2026-09-07)
//   play/img/pieces.png    the piece sets, one row per set
//   play/CREDITS.md        attribution, generated from PACKS + the picks
//
// WITHOUT THE PACKS (2026-09-07): a tile pack that is not on disk is read
// BACK from the committed atlas — every tile of every theme at the cell the
// last run wrote it, with the provenance the index recorded — exactly as a
// missing piece pack has been since 2026-09-04. So the in-house `classic`
// row (lib/inhouse.mjs: the drawn wall / crate / door / barrel / chest /
// rubble and the four CRACKS every theme wears) can be regenerated, roles
// added and the index rewritten on a machine that has never seen the packs;
// only a NEW pack tile needs the pack.
//
// THEMES: `hall` (pixel-poem's purple-and-timber keep), `castle` (Dungeon
// Gathering's cold blue-grey stone), `crypt` (Szadi art's dark catacombs).
// Where a pack lacks a role the theme borrows from another pack; where no
// pack has it (the hole, the crack) the theme falls back to the in-house
// drawings (lib/inhouse.mjs, the `classic` row) — that is what "no
// override" in a theme block means. Roles are the atlas's names (the
// renderer's, play/js/atlas.mjs tileOf).
//
// Usage (from phase0/): node harness/repack-tiles.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { decodePng, encodePng, blank, crop, blit, samePixels } from '../lib/png.mjs';
import { canonicalMask, WALL_MASK_CODES, PIECE_SETS, DOOR_SETS, FLOOR_VARIANTS, SKIN_VARIANTS, CRACK_VARIANTS, WALL_BAND, WALL_SPRITE_H, wallBody, wallFaceCols } from '../../play/js/board-ui.mjs';
import { inhouseTiles, edgeLeafTile } from '../lib/inhouse.mjs';

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
  'pixel-chess': {
    title: 'Pixel Chess',
    author: 'Dani Maccari',
    url: 'https://dani-maccari.itch.io/pixel-chess',
    terms: 'Free for personal or commercial projects as long as it is attributed to DANI MACCARI; edits allowed; the assets may not be repackaged, redistributed or resold — only the twelve piece sprites the game uses are inlined here, with that attribution.',
  },
  nulltale: {
    title: 'Chess (NullTale Chess.png)',
    author: 'NullTale',
    url: 'https://nulltale.itch.io/chess',
    terms: 'Creative Commons Attribution 4.0 International — free for commercial and non-commercial use with attribution; redistribution allowed under the same terms.',
  },
  'deja-view': {
    title: 'Chess Assets',
    author: 'Deja View',
    url: 'https://deja-view.itch.io/chess-assets',
    terms: '"Use it in whatever you like, just don\'t resell it as your own assets." Credit appreciated, not required.',
  },
};

// Sheet key → [pack, file under assets-src/<pack>/]. Tile coords below are
// in 16-px tile units on these sheets (x = column, y = row, 0-based).
const SHEETS = {
  dg: ['dungeon-gathering', 'Set 1.png'],
  pp: ['pixel-poem', 'Dungeon_Tileset.png'],
  cat: ['catacombs', 'mainlevbuild.png'],
  catdeco: ['catacombs', 'decorative.png'],
  pcW: ['pixel-chess', 'WhitePieces.png'],
  pcB: ['pixel-chess', 'BlackPieces.png'],
  pcWw: ['pixel-chess', 'WhitePieces_Wood.png'],
  pcBw: ['pixel-chess', 'BlackPieces_Wood.png'],
  nt: ['nulltale', 'NullTale Chess.png'],
  dv: ['deja-view', 'ChessAssets.png'],
  // pixel-poem's loose 16×16 prop sprites (items and trap_animation/<prop>/
  // <prop>_N.png, copied flat). Every prop is a four-frame idle bounce and
  // only its REST pose is a closed box: frame 1 lifts the lid (the chest's
  // floats a clear row above the body, the boxes pinch a waist under it —
  // "these look like they're for an open animation, or the lid is detached",
  // round 19c), frame 2 stretches (the same pinch), frame 3 is the rest pose
  // the static sheet already carries ((4,8) / (5,8) ARE chest_3 /
  // mini_chest_3 pixel for pixel; (3,8) / (0,8) sit a row taller than
  // box_2_3 / mini_box_2_3), and frame 4 is the SQUAT — lid seated, body a
  // pixel wider — the one extra silhouette that still reads closed.
  ppboxsquat: ['pixel-poem', 'box_2_4.png'],
  ppminiboxsquat: ['pixel-poem', 'mini_box_2_4.png'],
  ppchestsquat: ['pixel-poem', 'chest_2.png'],
  ppminichestsquat: ['pixel-poem', 'mini_chest_2.png'],
  cattorch: ['catacombs', 'torch_1.png'],
  catcandle: ['catacombs', 'candleA_01.png'],
};

// Piece sets (2026-09-03). Names are board-ui.mjs PIECE_SETS (the option
// list); the renderer stamps data-pieces on the board and
// data-piece="<FEN letter>" on every piece. Each set names, per piece, the
// exact crop on its sheet [sheet, x, y, w, h]; the tool TRIMS it to its
// opaque bounds and pastes it bottom-centred into the set's box — `box` px
// wide, `fit` px tall — so every piece of a set stands on ONE baseline and
// the tallest fills the box exactly (round 10: a 32-px NullTale box centred
// in the square hung every foot below the square, "chopped in half").
const PIECE_ORDER = 'pnrbqk';
const row6 = (sheet, y, w = 16, h = 16, x0 = 0, step = 16) => Object.fromEntries([...PIECE_ORDER].map((l, i) => [l, [sheet, x0 + i * step, y, w, h]]));
// `fit` is the set's tallest piece in px, and the box's height: the box is
// scaled so that piece stands 0.96 cell tall — no set rises into the square
// above (designer round 8: tall pieces overlapping the piece north of them
// read badly when clustered); the Options' piece SIZE and LIFT dials
// (style.css --piece-scale / --piece-lift) then scale and raise the box.
// `outline` recolours a set's outline pixels (that colour, next to
// transparency) — Deja View's white outline becomes a dark one.
const PIECE_SHEETS = {
  'pixel-chess': { title: 'Pixel Chess — stone (Dani Maccari)', pack: 'pixel-chess', box: 16, fit: 16, white: row6('pcW', 0), black: row6('pcB', 0) },
  'pixel-chess-wood': { title: 'Pixel Chess — wood (Dani Maccari)', pack: 'pixel-chess', box: 16, fit: 16, white: row6('pcWw', 0), black: row6('pcBw', 0) },
  // NullTale: 16-px columns 1–6 = pawn rook knight bishop queen king, each
  // colour a 32-px band bottom-aligned; the classic silhouettes are the
  // blue (white side) and dark-red (black side) rows, the "dread" ones the
  // white-and-red and near-black rows. Kings are 23 / 26 px.
  nulltale: { title: 'NullTale — classic (blue vs red)', pack: 'nulltale', box: 16, fit: 23, white: ntRow(208), black: ntRow(176) },
  'nulltale-dread': { title: 'NullTale — dread (white vs black)', pack: 'nulltale', box: 16, fit: 26, white: ntRow(96), black: ntRow(64) },
  // Deja View: exact sprite bounds on the 108×104 sheet (connected
  // components), cream vs navy; its white outline is recoloured dark.
  'deja-view': {
    title: 'Deja View (cream vs navy)', pack: 'deja-view', box: 18, fit: 23, outline: { from: [0xfa, 0xf5, 0xf0], to: [0x1c, 0x1a, 0x24] },
    white: { p: ['dv', 48, 40, 13, 16], r: ['dv', 77, 39, 13, 17], n: ['dv', 45, 63, 17, 17], b: ['dv', 95, 61, 13, 19], q: ['dv', 48, 83, 13, 21], k: ['dv', 78, 81, 13, 23] },
    black: { p: ['dv', 62, 40, 13, 16], r: ['dv', 91, 39, 13, 17], n: ['dv', 63, 63, 17, 17], b: ['dv', 81, 61, 13, 19], q: ['dv', 62, 83, 13, 21], k: ['dv', 92, 81, 13, 23] },
  },
};
function ntRow(y) {
  const order = 'prnbqk'; // NullTale's column order differs from PIECE_ORDER
  return Object.fromEntries([...order].map((l, i) => [l, ['nt', 16 * (i + 1), y, 16, 32]]));
}
for (const name of PIECE_SETS) if (!PIECE_SHEETS[name]) throw new Error(`piece set ${name} has no sheets`);

// Role → the custom property it paints. floor-N are the floor's stable
// variants (board-ui.mjs picks f1/f2/f3 per square); wall is the plain
// east–west run (the legend, and the fallback); wall-<mask> are the 47
// AUTOTILE cases (board-ui.mjs canonicalMask: N=1 E=2 S=4 W=8, diagonals
// NE=16 SE=32 SW=64 NW=128 — the renderer classes each wall `wm-<mask>`),
// GENERATED below in the pack's colours with the pack's brick face; the
// rest are the furniture sprites (skin-<name>; crate is the '^' default).
// floor-1..N are the floor's texture variants (N = board-ui FLOOR_VARIANTS;
// f1 is the common one). A door skin in a north–south wall line stands
// EDGE-ON on the screen (the camera, 2026-09-08 — until then it was a weak
// spot wearing the crack): `door-edge`, appended below with the crack.
const ROLES = {
  wall: '--tile-wall',
  door: '--sprite-door',
  // DOUBLE DOOR (round 16): the two halves a side-by-side pair of door
  // skins paints (board-ui door2-l / door2-r). pixel-poem draws one; the
  // castle's and crypt's are the same leaves with the wood recoloured, a
  // two-wide barred gate.
  'door2-l': '--sprite-door2-l',
  'door2-r': '--sprite-door2-r',
  crate: '--sprite-crate',
  chest: '--sprite-chest',
  barrel: '--sprite-barrel',
  // WRECKAGE (round 18, 2026-09-05 — the designer's O's on the pack sheet):
  // the Catacombs' broken crates and spilled urns, the smashed-furniture
  // look three stages' notes wanted ("one bunk collapsed", "one row broken
  // to rubble", "bones where they fell") and lost when the heap died.
  // TABLE, CHAIR and SHELF are DROPPED (rounds 17–18: "the stools and
  // tables don't look good and no version of them ever has"; the rack was
  // X'd on the in-use sheet) — stage.mjs maps T / C / S onto crate / chest
  // / crate until a category has art.
  wreckage: '--sprite-wreckage',
  // --sprite-rubble is the IN-HOUSE set's ruin fallback only (2026-09-04:
  // authored masonry paints as a cracked wall, so no theme reads its heap).
  rubble: '--sprite-rubble',
  // DECOR (round 8: "cosmetic props like torches on the wall"): purely
  // cosmetic sprites board-ui scatters by a stable hash — torch / chain /
  // banner on east–west wall faces — painted by a .decor span under the
  // piece; a theme without a role paints nothing there. The floor litter
  // (web / bones / skull / candle) is PACKED AWAY since round 10 ("they
  // make it harder to read the pieces"): still repacked, never scattered.
  torch: '--decor-torch',
  candle: '--decor-candle',
  web: '--decor-web',
  bones: '--decor-bones',
  skull: '--decor-skull',
  chain: '--decor-chain',
  banner: '--decor-banner',
  // (The OPEN DOORWAY's generated posts — round 11's frame, round 12's
  // one-post cases — are RETIRED with the tall walls, 2026-09-12: a
  // doorway is a gap, and the walls beside it end with their own cases.)
};
// Where a prop sits inside its 16×16 tile: props paint at native scale,
// pixel-aligned with the tiles (designer round 9), so placement is baked
// in by anchoring the sprite's opaque bounds — wall-mounted props to the
// bottom (the face), litter to a corner.
const DECOR_ANCHOR = { torch: 'bottom', banner: 'bottom', chain: 'bottom', web: 'topleft', bones: 'bottomright', skull: 'bottomleft', candle: 'bottomright' };
function anchorSprite(tile, anchor) {
  let minx = T, miny = T, maxx = -1, maxy = -1;
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (tile.data[(y * T + x) * 4 + 3]) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  if (maxx < 0) return tile;
  const w = maxx - minx + 1, h = maxy - miny + 1;
  const dx = anchor === 'topleft' || anchor === 'bottomleft' ? 1 - minx : anchor === 'bottomright' ? T - 1 - maxx : Math.floor((T - w) / 2) - minx;
  const dy = anchor === 'topleft' ? 1 - miny : T - 1 - maxy;
  const out = blank(T, T);
  blit(out, crop(tile, minx, miny, w, h), minx + dx, miny + dy);
  return out;
}
/** A sprite cropped to its opaque bounds (unchanged when it is empty). */
function trim(tile) {
  const W = tile.width, H = tile.height;
  let minx = W, miny = H, maxx = -1, maxy = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (tile.data[(y * W + x) * 4 + 3]) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  if (maxx < 0) return tile;
  return crop(tile, minx, miny, maxx - minx + 1, maxy - miny + 1);
}
for (let i = 1; i <= FLOOR_VARIANTS; i++) ROLES[`floor-${i}`] = `--tile-floor-${i}`;
for (const code of WALL_MASK_CODES) ROLES[`wall-${code}`] = `--tile-wall-${code}`;
// ruin-<mask>: the 16 BROKEN-WALL stub cases (ruinBlob below) a floor
// square wears where a wall broke (board-ui .ruin, main.mjs residue).
for (let m = 0; m < 16; m++) ROLES[`ruin-${m}`] = `--tile-ruin-${m}`;
// hole-<mask>: the 16 PIT cases (holeBlob below) a god-made hole wears by
// its hole neighbours (board-ui .hole + wm-<mask>) — round 13.
for (let m = 0; m < 16; m++) ROLES[`hole-${m}`] = `--tile-hole-${m}`;

// ---- TALL WALLS (2026-09-12) — THE CATACOMBS' OWN WALL, PALETTE-SWAPPED.
// The designer, after the edge-on door: "I want tall walls, walls that
// overlap the northern tiles, just like the tall chess pieces do" — and,
// over ten mock-up rounds, the shape that survived: the generated bricks
// "look too much like drawers", the packs' own art "looks so much better";
// of the three packs only the Catacombs frame made a roof that read ("the
// other attempts look like a lost cause… make palette swaps of it when
// we're done"); a vertical wall's roof is the horizontal one "turned
// sideways and stretched a little"; the face stands "a few pixels" off its
// seam with the floor showing under it; the roof strip is the pack's north
// band whole ("see the detail on the roof?"), never trimmed; no roof over
// a face-on door.
//
// So every theme's wall is ONE drawing, the Catacombs' (mainlevbuild.png):
// its frame's north band, tile (5,3) — outline, lit line, four cracked fill
// rows whose marks run front to back, inner outline — over its brick face,
// tile (5,9); the hall, the castle and the classic set wear the same
// pixels in their own palettes (WALL_SWAPS: an exact colour map, every
// colour of the crypt's drawing named, so nothing slips through untinted).
// A wall case is a 16×24 SPRITE the canvas board paints in the tall pass
// at the square's y − WALL_LIFT − WALL_RAISE (board-ui): rows 0–7 the
// ROOF's far half (in the square north), rows 8–23 the FACE where the
// roof's body ends at the square's south edge (wallFaceCols) and the
// roof's near half where it runs on. The roof is drawn by DEPTH from its
// open edges: a horizontal top wears the band's rows on its far edge
// (outline, lit, the fill rows, inner outline), the outline and lit line
// turned on its west end and the outline on its east; a vertical BAND
// (WALL_BAND, three pixels of floor either side) is the same band turned
// — outline and lit line down its west side, the four fill rows STRETCHED
// over its seven fill columns so a mark that crossed the strip crosses
// the band (the rungs), the outline down its east — and its rungs run on
// through a T where it meets a horizontal wall. Corners and ends by the
// nearest edge. The RUIN (a broken wall's stub, ruin-<mask> by its
// standing neighbours N=1 E=2 S=4 W=8) is the same drawing: each joining
// wall's roof enters the cell a flush pixel and up to two of ragged
// fringe (hashed per pair of rows, so the break reads as chunks), the face
// under a west/east tongue's south edge as under any wall, RUIN.face rows
// of it under a north tongue's ragged end (the broken band's end face, a
// low stump), nothing under a south tongue (the wall's own roof is right
// below it). Chips: none — the flecks on the floor are THE DEBRIS LAYER's.
const CAT_BAND = ['cat', 5, 3];
const CAT_FACE = ['cat', 5, 9];
const RUIN = { tongue: 1, fringe: 2, face: 6, chips: 0 }; // chips: none — the flecks on the floor are the debris layer's (test-debris reads this)
const STRETCH = [2, 2, 3, 3, 4, 4, 5]; // the band's seven fill columns ← the strip's four fill rows
/** The crypt's own colours, named — the keys of every swap. */
const CRYPT = { outline: '#1b1916', lit: '#454135', fill: '#2e2a25', dark: '#23201d', mid: '#3c3129', black: '#070707', mortarDark: '#140e0e', mortar: '#1a1512', brickDark: '#231f19', brick: '#312220', brickLight: '#3f3628' };
/** Every other theme's wall: the crypt's drawing, colour for colour. */
const WALL_SWAPS = {
  hall: { outline: '#25131a', lit: '#916a62', fill: '#6e4a48', dark: '#4c2f49', mid: '#5d3d48', black: '#25131a', mortarDark: '#25131a', mortar: '#3d253b', brickDark: '#422c3b', brick: '#543740', brickLight: '#5e4148' },
  castle: { outline: '#181425', lit: '#c7cfdd', fill: '#92a1b9', dark: '#5a6787', mid: '#7a8aa3', black: '#181425', mortarDark: '#181425', mortar: '#2a2f4e', brickDark: '#424c6e', brick: '#657392', brickLight: '#92a1b9' },
  classic: { outline: '#262433', lit: '#8583a3', fill: '#605e7a', dark: '#403e55', mid: '#52506a', black: '#16141f', mortarDark: '#16141f', mortar: '#262433', brickDark: '#403e55', brick: '#52506a', brickLight: '#605e7a' },
};
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hash = (x, y, k) => (((x + 1) * 73856093) ^ ((y + 1) * 19349663) ^ ((k + 1) * 83492791)) >>> 0;
const pxOf = (img, x, y) => { const o = (y * img.width + x) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]]; };
const TH = WALL_SPRITE_H;
const inBand = (x) => x >= WALL_BAND.x0 && x <= WALL_BAND.x1;

/** The band's seven rows (each sixteen pixels wide) and the face, off the pack. */
function catWallArt(sheets) {
  const [bk, bx, by] = CAT_BAND, [fk, fx, fy] = CAT_FACE;
  const band = Array.from({ length: 7 }, (_, r) => Array.from({ length: T }, (_, x) => pxOf(sheets[bk], bx * T + x, by * T + r)));
  return { band, face: crop(sheets[fk], fx * T, fy * T, T, T), fill: hex(CRYPT.fill) };
}
/**
 * A roof (16×16, the top surface) for a footprint `body(x, y)` (true in
 * the neighbours too): every body pixel wears the band's row at its depth
 * from the nearest open edge — the far edge the band whole (a vertical
 * band's ends only its outline and lit line), the west end the same two
 * turned, the east end and the near edge the outline — else the fill:
 * the turned, stretched rungs on a band or where a band runs through, the
 * plain fill elsewhere. `vertical`: no east–west run through the cell.
 */
function roofOf(body, art, { vertical, through }) {
  const { band, fill } = art;
  const prof = vertical
    ? { N: band.slice(0, 2), S: [band[0]], W: band.slice(0, 2), E: [band[0]] }
    : { N: band, S: [band[0]], W: band.slice(0, 2), E: [band[0]] };
  const x0 = WALL_BAND.x0 + 2;
  const rung = (x, y) => band[STRETCH[Math.max(0, Math.min(6, x - x0))]][y];
  const out = blank(T, T);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (!body(x, y)) continue;
    let dN = 0; while (dN < 17 && body(x, y - dN - 1)) dN++;
    let dS = 0; while (dS < 17 && body(x, y + dS + 1)) dS++;
    let dW = 0; while (dW < 17 && body(x - dW - 1, y)) dW++;
    let dE = 0; while (dE < 17 && body(x + dE + 1, y)) dE++;
    const cands = [['N', dN], ['S', dS], ['W', dW], ['E', dE]].sort((a, b) => a[1] - b[1]);
    let c = vertical || (inBand(x) && through) ? rung(x, y) : fill;
    for (const [side, d] of cands) { const p = prof[side]; if (d < p.length) { c = side === 'N' || side === 'S' ? p[d][x] : p[d][y]; break; } if (d >= 8) break; }
    const o = (y * T + x) * 4;
    out.data[o] = c[0]; out.data[o + 1] = c[1]; out.data[o + 2] = c[2]; out.data[o + 3] = 255;
  }
  return out;
}
/** The 16×24 sprite: the roof's far half, then the face where the body
 *  ends south (`faceCols`), the roof's near half where it runs on;
 *  `stumps` adds RUIN.face rows of face under a north tongue's ragged end
 *  (x → the row the face starts on, or undefined). */
function tallSprite(roof, art, faceCols, stumps = null) {
  const out = blank(T, TH);
  blit(out, crop(roof, 0, 0, T, 8), 0, 0);
  for (let x = 0; x < T; x++) {
    if (faceCols[x]) blit(out, crop(art.face, x, 0, 1, T), x, 8);
    else blit(out, crop(roof, x, 8, 1, 8), x, 8);
    const y0 = stumps?.[x];
    if (y0 !== undefined) blit(out, crop(art.face, x, 0, 1, Math.min(RUIN.face, TH - y0)), x, y0);
  }
  return out;
}
/** Every wall case (wall-<mask>) and ruin case (ruin-<mask>) in the crypt's own colours. */
function tallWallSet(sheets) {
  const art = catWallArt(sheets);
  const walls = {}, ruins = {};
  for (const code of WALL_MASK_CODES) {
    const n = code & 1, e = code & 2, s = code & 4, w = code & 8;
    const body = wallBody(code);
    const roof = roofOf(body, art, { vertical: !e && !w, through: !!(n || s) });
    walls[`wall-${code}`] = tallSprite(roof, art, wallFaceCols(code));
  }
  for (let m = 0; m < 16; m++) {
    const n = m & 1, e = m & 2, s = m & 4, w = m & 8;
    const reach = (k, salt) => RUIN.tongue + (hash(k >> 1, m, salt) % (RUIN.fringe + 1));
    const body = (x, y) => {
      if (y < 0) return !!n && inBand(x);
      if (y >= T) return !!s && inBand(x);
      if (x < 0) return !!w;
      if (x >= T) return !!e;
      if (w && x < reach(y, 11)) return true;
      if (e && x >= T - reach(y, 13)) return true;
      if (n && inBand(x) && y < reach(x, 17)) return true;
      if (s && inBand(x) && y >= T - reach(x, 19)) return true;
      return false;
    };
    const roof = roofOf(body, art, { vertical: !e && !w, through: !!(n || s) });
    const faceCols = Array.from({ length: T }, (_, x) => body(x, T - 1) && !body(x, T));
    const stumps = {};
    if (n) for (let x = WALL_BAND.x0; x <= WALL_BAND.x1; x++) stumps[x] = reach(x, 17);
    ruins[`ruin-${m}`] = tallSprite(roof, art, faceCols, stumps);
  }
  return { walls, ruins };
}
/** A tile with every colour of the crypt's wall drawing replaced by the
 *  theme's (`swap`: the CRYPT names → #rrggbb); a colour the map does not
 *  name is an error — the swap is exact or it is nothing. */
function swapPalette(tile, swap) {
  const map = new Map(Object.entries(CRYPT).map(([name, from]) => { if (!swap[name]) throw new Error(`swap lacks ${name}`); return [from, hex(swap[name])]; }));
  const out = blank(tile.width, tile.height);
  const unmapped = new Set();
  for (let i = 0; i < tile.width * tile.height; i++) {
    const o = i * 4;
    if (!tile.data[o + 3]) continue;
    const key = '#' + [tile.data[o], tile.data[o + 1], tile.data[o + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    const to = map.get(key);
    if (!to) { unmapped.add(key); continue; }
    out.data[o] = to[0]; out.data[o + 1] = to[1]; out.data[o + 2] = to[2]; out.data[o + 3] = tile.data[o + 3];
  }
  if (unmapped.size) throw new Error(`swapPalette: the crypt's wall carries colours the map does not name: ${[...unmapped].join(' ')}`);
  return out;
}

// ---- the hole blob (round 13, 2026-09-03: "ragged edges on hole tiles?
// Needs complete autotiling"). A god-made pit AUTOTILES by its HOLE
// neighbours (N=1 E=2 S=4 W=8 — the four sides are the whole story: a
// diagonal floor square touches a pit only at a corner point, so there
// are no inner-corner cases and 16 tiles cover every shape). On a side
// that faces floor the pit stops short of the cell edge by a ragged
// 1…1+HOLE.fringe pixels, hashed per pair of pixels along the side, so the
// floor tile shows through the margin and the break in it is a jagged
// line; on a side that faces another pit it runs edge to edge, so joined
// pits read as one pit. The pit floor is near-black in the theme's own
// dark, a 1-px outline in the theme's edge colour rims the break on the
// floor side (so the rim is 1–3 px of which the innermost is the lip and
// the rest floor), and under a north rim the pit's FAR WALL shows —
// HOLE.face rows of the wall's top colour shaded and one darker — with a
// 1-px lit strip down a west rim: the same light as the walls' bevels.
// The wall shows only in columns whose pit BEGINS at the north rim (a
// column inside a ragged west/east rim begins lower — round 13's first cut
// lit a stray fragment there, caught in review), the strip only in rows
// whose pit begins at the west rim, below the wall.
const HOLE = { fringe: 2, face: 2 };
function holeBlob(spec) {
  const fill = hex(spec.fill), edge = hex(spec.edge);
  const black = [0, 0, 0];
  const pitC = mix(edge, black, 0.85);
  const faceC = mix(fill, black, 0.5), faceLo = mix(fill, black, 0.68);
  const out = {};
  for (let m = 0; m < 16; m++) {
    const n = m & 1, e = m & 2, s = m & 4, w = m & 8;
    const rim = (k, salt) => 1 + (hash(k >> 1, m, salt) % (HOLE.fringe + 1));
    const pit = (x, y) => {
      if (x < 0 || x >= T || y < 0 || y >= T) return false;
      if (!n && y < rim(x, 31)) return false;
      if (!s && y >= T - rim(x, 33)) return false;
      if (!w && x < rim(y, 35)) return false;
      if (!e && x >= T - rim(y, 37)) return false;
      return true;
    };
    const tile = blank(T, T);
    const put = (x, y, c) => { const o = (y * T + x) * 4; tile.data[o] = c[0]; tile.data[o + 1] = c[1]; tile.data[o + 2] = c[2]; tile.data[o + 3] = 255; };
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (pit(x, y)) put(x, y, pitC);
    // The far wall under a north rim; the lit strip down a west rim.
    for (let x = 0; x < T; x++) {
      if (n) break;
      const y0 = rim(x, 31);
      if (!pit(x, y0)) continue; // this column is inside a west/east rim
      for (let r = 0; r <= HOLE.face && pit(x, y0 + r); r++) put(x, y0 + r, r < HOLE.face ? faceC : faceLo);
    }
    for (let y = 0; y < T; y++) {
      if (w) break;
      const x0 = rim(y, 35);
      if (!pit(x0, y)) continue; // this row is inside a north/south rim
      if (!n && y <= rim(x0, 31) + HOLE.face) continue; // the far wall owns these rows
      put(x0, y, faceLo);
    }
    // The outline: floor pixels touching the pit take the theme's edge
    // colour — the broken lip of the floor.
    for (let y = 0; y < T; y++) {
      for (let x = 0; x < T; x++) {
        if (pit(x, y)) continue;
        if (pit(x - 1, y) || pit(x + 1, y) || pit(x, y - 1) || pit(x, y + 1)) put(x, y, edge);
      }
    }
    out[`hole-${m}`] = tile;
  }
  return out;
}

// ---- floors (round 7, 2026-09-03: "the crypt floor tiles put both the
// other themes to shame — palette-swap them for the other themes"). Every
// theme's floor is the six bevelled flagstones of the Catacombs brown set;
// hall and castle wear them RECOLOURED into their own pack's floor tone:
// each pixel keeps its shading relative to the flagstones' base colour
// (the set's most common pixel) and takes the target's hue — channel-wise
// out = target × (pixel / base), clamped — so bevels, cracks and grain
// survive and only the stone changes colour.
const FLAGSTONES = [['cat', 47, 14], ['cat', 46, 13], ['cat', 47, 15], ['cat', 46, 14], ['cat', 47, 13], ['cat', 46, 15]];
function mostCommon(tile) {
  const hist = new Map();
  for (let i = 0; i < tile.width * tile.height; i++) {
    const o = i * 4;
    if (!tile.data[o + 3]) continue;
    const k = (tile.data[o] << 16) | (tile.data[o + 1] << 8) | tile.data[o + 2];
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  const k = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return [k >> 16, (k >> 8) & 255, k & 255];
}
function recolour(tile, base, target) {
  const out = blank(tile.width, tile.height);
  for (let i = 0; i < tile.width * tile.height; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) out.data[o + c] = Math.max(0, Math.min(255, Math.round((target[c] * tile.data[o + c]) / Math.max(1, base[c]))));
    out.data[o + 3] = tile.data[o + 3];
  }
  return out;
}

const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const sat = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);
/** A borrowed prop in the theme's colour (round 17 — the doors: "take the
 *  Hall doors and make palette swaps for the other themes"): the WOOD —
 *  every saturated, non-dark pixel — takes the target hue at its own
 *  brightness (target × luma / luma of the dominant wood), while greys
 *  (iron bands, pale supports) and the dark outline are left alone, so a
 *  slate-stained door keeps its iron. */
function recolourHue(tile, target, force = false, dominant = null) {
  const wood = (o) => tile.data[o + 3] && luma(tile.data[o], tile.data[o + 1], tile.data[o + 2]) >= 70 && sat(tile.data[o], tile.data[o + 1], tile.data[o + 2]) >= 40;
  const hist = new Map();
  if (!force) for (let i = 0; i < tile.width * tile.height; i++) {
    const o = i * 4;
    if (!wood(o)) continue;
    const k = (tile.data[o] << 16) | (tile.data[o + 1] << 8) | tile.data[o + 2];
    hist.set(k, (hist.get(k) ?? 0) + 1);
  }
  // A sprite with no saturated wood at all (the Catacombs' grey-purple
  // urns) — or a role tinted `{ whole: true }` (the urns and shards as a
  // set: the green ones are saturated enough to be half-taken otherwise) —
  // takes the tint as a WHOLE: every non-dark pixel, at its own shading.
  const whole = !hist.size;
  // In whole mode only the near-black outline is spared (the Catacombs'
  // green urns are dark enough — luma ≈ 64 — that the wood cut-off of 70
  // would leave their bodies green with tinted highlights).
  const lit = (o) => tile.data[o + 3] && luma(tile.data[o], tile.data[o + 1], tile.data[o + 2]) >= 32;
  if (whole) for (let i = 0; i < tile.width * tile.height; i++) { const o = i * 4; if (!lit(o)) continue; const k = (tile.data[o] << 16) | (tile.data[o + 1] << 8) | tile.data[o + 2]; hist.set(k, (hist.get(k) ?? 0) + 1); }
  if (!hist.size) return tile;
  const k = [...hist.entries()].sort((a, b) => b[1] - a[1])[0][0];
  // Wood mode scales each pixel by its brightness relative to the dominant
  // wood; whole mode by its brightness relative to the sprite's BRIGHTEST
  // pixel, which lands at 1.25× the target — so a sprite whose common
  // colour is dark (a broken crate) does not blow its highlights out.
  let maxL = 0;
  if (whole) for (let i = 0; i < tile.width * tile.height; i++) { const o = i * 4; if (lit(o)) maxL = Math.max(maxL, luma(tile.data[o], tile.data[o + 1], tile.data[o + 2])); }
  // `dominant` names the wood to scale against when the drawing's commonest
  // wood is not the one its face-on sibling is scaled by (the edge-on leaf).
  const baseL = whole ? maxL / 1.25 : dominant ? luma(...dominant) : luma(k >> 16, (k >> 8) & 255, k & 255);
  const takes = whole ? lit : wood;
  const out = blank(tile.width, tile.height);
  for (let i = 0; i < tile.width * tile.height; i++) {
    const o = i * 4;
    const f = takes(o) ? luma(tile.data[o], tile.data[o + 1], tile.data[o + 2]) / baseL : null;
    for (let c = 0; c < 3; c++) out.data[o + c] = f === null ? tile.data[o + c] : Math.max(0, Math.min(255, Math.round(target[c] * f)));
    out.data[o + 3] = tile.data[o + 3];
  }
  return out;
}
/** A furniture prop in its 16×32 BOARD BOX (round 17: "the smaller props
 *  aren't pressed right up against the bottom of the square — they should
 *  be centered" / "the tops of the taller vases are getting cropped, let
 *  them overlap the tile to the north"): trimmed to its pixels and centred
 *  left–right; a prop that fits a cell is centred in the LOWER cell, a
 *  taller one stands on the cell's bottom edge and rises into the cell
 *  above. The canvas board draws a prop as a 1×2-cell box. */
function placeProp(tile) {
  const sprite = trim(tile);
  const box = blank(T, 2 * T);
  const h = sprite.height;
  blit(box, sprite, Math.floor((T - sprite.width) / 2), h <= T ? T + Math.floor((T - h) / 2) : 2 * T - h);
  return box;
}
/** A 16×32 crop: the tile at (x, y) AND the one above it, for the props
 *  the packs draw taller than a tile (the Catacombs' big urns). */
const tall = (sheet, x, y) => [sheet, x * T, (y - 1) * T, T, 2 * T];

/** Pixels of colour `from` that touch transparency (or the sprite's edge)
 *  become `to` — a white outline turns dark without touching the fill. */
function recolourOutline(tile, from, to) {
  const { width: w, height: h } = tile;
  const a = (x, y) => x >= 0 && x < w && y >= 0 && y < h && tile.data[(y * w + x) * 4 + 3] > 0;
  const out = blank(w, h);
  tile.data.copy(out.data);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (!tile.data[o + 3] || tile.data[o] !== from[0] || tile.data[o + 1] !== from[1] || tile.data[o + 2] !== from[2]) continue;
      if (!a(x - 1, y) || !a(x + 1, y) || !a(x, y - 1) || !a(x, y + 1)) { out.data[o] = to[0]; out.data[o + 1] = to[1]; out.data[o + 2] = to[2]; }
    }
  }
  return out;
}

/** A w×h crop pasted bottom-centred into a 16×16 tile (small props). */
function cropFit(sheets, key, x, y, w, h) {
  const sprite = crop(sheets[key], x, y, w, h);
  const tile = blank(T, T);
  blit(tile, sprite, Math.floor((T - w) / 2), T - h);
  return tile;
}

/** A theme's edge-on door leaf in the theme's door tint. Generated every
 *  run (never read back — the designer's file is the source). */
function emitEdgeDoor(theme, emit) {
  const tint = THEMES[theme].tint?.door;
  const leaf = edgeLeafTile();
  // The designer's 5×16 profile door (lib/inhouse/door-profile.png) in the
  // band's middle; the plank timber is the base the face-on leaf was
  // scaled by, so the two match on every theme.
  emit('door-edge', tint ? recolourHue(leaf, hex(tint), false, hex('#895a45')) : leaf, { composed: `the designer's profile door (lib/inhouse/door-profile.png) in the band${tint ? `, wood to ${tint}` : ''}` });
}

const THEMES = {
  hall: {
    title: 'The hall — pixel-poem’s keep: purple-grey flagstones, salmon stone, timber doors',
    tiles: {
      door: ['pp', 7, 3],
      // Several crops for a role = its VARIANTS (board-ui sv1…svN by
      // square): the first is the role's tile, the rest --sprite-<role>-N.
      // Round 19: the line between the two is the LID — a chest has a rounded
      // one ("chests need to all have rounded tops like hall chest 3"), a
      // crate is a flat box. Round 19c: the pack's GREY boxes are out of the
      // crates ("let's not use silver/grey on crates, looks too much like
      // chests" — the chests are its silver-bodied domed ones), and every
      // prop is its rest pose or its squat, never the lid-lifted frame (see
      // SHEETS). Crates: the sheet's two orange boxes, their squats, and the
      // Catacombs' three slatted crates in the hall's timber.
      crate: [['pp', 3, 8], ['pp', 0, 8], ['ppboxsquat', 0, 0], ['ppminiboxsquat', 0, 0], ['catdeco', 8, 5], ['catdeco', 9, 5], ['catdeco', 9, 4]],
      // Chests: the sheet's closed domed chest and mini chest, and their squats.
      chest: [['pp', 4, 8], ['pp', 5, 8], ['ppchestsquat', 0, 0], ['ppminichestsquat', 0, 0]],
      // Round 18: the pack's keg (8,3) was X'd. Dungeon Gathering's vase is
      // already the hall's orange; the Catacombs urns come in as terracotta.
      barrel: [['dg', 2, 12], tall('catdeco', 9, 8), ['catdeco', 10, 8], ['catdeco', 12, 8], ['catdeco', 13, 8]],
      wreckage: [['catdeco', 8, 6], ['catdeco', 9, 6], ['catdeco', 9, 9], ['catdeco', 10, 9], ['catdeco', 11, 9], ['catdeco', 9, 12], ['catdeco', 10, 12]],
      rubble: ['cat', 20, 22],
      // cosmetic props (board-ui scatters them; see DECOR below)
      torch: ['pp', 0, 9],
      candle: ['pp', 3, 9],
      web: ['pp', 4, 6],
      bones: ['pp', 8, 6],
      skull: ['pp', 7, 7],
      chain: ['pp', 5, 7],
      banner: ['pp', 4, 7],
    },
    door2: [['pp', 6, 6], ['pp', 7, 6]], // the pack's DOUBLE door — a side-by-side pair of door skins wears it
    // Borrowed Catacombs pieces in the hall's timber / terracotta (the vase is that orange already, so it comes through unchanged).
    tint: { crate: '#bf704d', barrel: { to: '#bf704d', whole: true }, wreckage: { to: '#bf704d', whole: true } }, // the Catacombs crates take the hall's timber (pixel-poem's own is that colour already)
    doorSet: 'hall',
    wall: { fill: '#6e4a48', hi: '#916a62', lo: '#4c2f49', edge: '#25131a', speckle: 0 }, // the hole blob's palette (the walls are WALL_SWAPS)
    // The Catacombs flagstones in pixel-poem's floor purple.
    floor: { tint: ['pp', 8, 1] },
  },
  castle: {
    title: 'The castle — Dungeon Gathering’s cold blue-grey stone',
    tiles: {
      door: ['pp', 7, 3], // pixel-poem's leaf, walnut-stained (tint) — round 17: "the doors on Castle and Crypt suck"; round 18: "less blue/grey"
      crate: [['catdeco', 8, 5], ['catdeco', 9, 5], ['catdeco', 9, 4], ['pp', 3, 8], ['pp', 0, 8], ['ppboxsquat', 0, 0], ['ppminiboxsquat', 0, 0]], // round 18: the stone blocks were X'd; round 19c: the Catacombs crates and pixel-poem's orange boxes, walnut like the door (tint) — the slate stain made a grey crate, and grey is the chests' colour
      chest: [['pp', 4, 8], ['pp', 5, 8], ['ppchestsquat', 0, 0], ['ppminichestsquat', 0, 0]], // pixel-poem's closed DOMED chests — already in the castle's grey
      barrel: [['dg', 2, 12], ['catdeco', 12, 8], ['catdeco', 13, 8], ['catdeco', 11, 11]], // the pack's vase + the small Catacombs urns as they are (their grey-purple and green sit in the castle's cool palette)
      wreckage: [['catdeco', 8, 6], ['catdeco', 9, 6], ['catdeco', 9, 9], ['catdeco', 10, 9], ['catdeco', 11, 9], ['catdeco', 9, 12], ['catdeco', 10, 12]],
      rubble: ['dg', 12, 12],
      torch: ['pp', 1, 9],
      candle: ['pp', 5, 9],
      web: ['pp', 4, 6],
      bones: ['pp', 8, 6],
      skull: ['pp', 7, 7],
      chain: ['pp', 6, 7],
      banner: ['pp', 4, 7],
    },
    door2: [['pp', 6, 6], ['pp', 7, 6]],
    // Borrowed timber recoloured (recolourHue: the wood takes the hue at
    // its own brightness, iron and outline stay). The DOORS are a cool
    // walnut (round 18: the slate stain was "too blue/grey") — the same
    // brightness as the slate, warmer, still sitting against the pack's
    // vase. Round 19c: the crates and their wreckage wear the same walnut
    // (the slate stain made a grey crate — "let's not use silver/grey on
    // crates, looks too much like chests"). The doorway posts are cut from
    // the door's walnut.
    tint: { door: '#7d6455', door2: '#7d6455', crate: '#7d6455', wreckage: { to: '#7d6455', whole: true } },
    doorSet: 'castle',
    wall: { fill: '#92a1b9', hi: '#c7cfdd', lo: '#5a6787', edge: '#181425', speckle: 0 },
    // The Catacombs flagstones in Dungeon Gathering's floor blue-grey.
    floor: { tint: ['dg', 10, 3] },
  },
  crypt: {
    title: 'The crypt — Szadi art’s catacombs: dark brown flagstones, low brick walls',
    tiles: {
      door: ['pp', 7, 3], // pixel-poem's leaf in dark oak (tint)
      crate: [['catdeco', 8, 5], ['catdeco', 9, 5], ['catdeco', 9, 4], ['pp', 3, 8], ['pp', 0, 8], ['ppboxsquat', 0, 0], ['ppminiboxsquat', 0, 0]], // its two wide crates and its low box + pixel-poem's orange boxes in dark oak (tint)
      chest: [['pp', 4, 8], ['pp', 5, 8], ['ppchestsquat', 0, 0], ['ppminichestsquat', 0, 0]], // pixel-poem's closed domed chests in dark oak (tint)
      // All ten of its urns, purple and green — the big ones are 20 px tall
      // and rise into the tile above, so they are cropped 16×32 (`tall`).
      barrel: [tall('catdeco', 9, 8), ['catdeco', 10, 8], ['catdeco', 11, 8], ['catdeco', 12, 8], ['catdeco', 13, 8], tall('catdeco', 9, 11), ['catdeco', 10, 11], ['catdeco', 11, 11], ['catdeco', 12, 11], ['catdeco', 13, 11]],
      wreckage: [['catdeco', 8, 6], ['catdeco', 9, 6], ['catdeco', 9, 9], ['catdeco', 10, 9], ['catdeco', 11, 9], ['catdeco', 9, 12], ['catdeco', 10, 12]], // its broken crates and spilled urns
      rubble: ['cat', 20, 22],
      torch: ['cattorch', 0, 0],
      candle: ['catcandle', 0, 0, 7, 14],
      chain: ['catdeco', 8, 1],
      web: ['pp', 4, 6],
      bones: ['pp', 8, 6],
      skull: ['pp', 7, 7],
    },
    door2: [['pp', 6, 6], ['pp', 7, 6]],
    tint: { door: '#5c4a3c', door2: '#5c4a3c', chest: '#5c4a3c', crate: '#5c4a3c' }, // dark oak, a step above the Catacombs crate (its own crates come through near-unchanged)
    doorSet: 'crypt',
    wall: { fill: '#3c3129', hi: '#5a5347', lo: '#231f19', edge: '#0e0a08', speckle: 14 },
    floor: {},
  },
};

// ---- load sheets
const sheets = {};
// A pack that is not on disk is tolerated: a PIECE pack's fitted sprites are
// read back from the committed play/img/pieces.png (2026-09-04, so tile work
// does not need the chess packs to hand), and since 2026-09-07 a TILE pack's
// tiles are read back from the committed play/img/tileset.png — the atlas
// holds exactly the tiles this tool wrote, at the cells the index records —
// and the index and credit rows still come from the record, unchanged.
// (Every theme is read back together: the themes share the packs.)
const pieceOnlySheets = new Set(Object.values(PIECE_SHEETS).flatMap((set) => [...Object.values(set.white), ...Object.values(set.black)].map((c) => c[0])));
let oldPieces = null;
let readBack = false;
for (const [key, [pack, file]] of Object.entries(SHEETS)) {
  const p = join(SRC, pack, file);
  if (!existsSync(p)) {
    if (!pieceOnlySheets.has(key)) readBack = true;
    else {
      oldPieces ??= decodePng(readFileSync(join(PLAY, 'img', 'pieces.png')));
      console.error(`(${pack}/${file} not on disk — its piece sprites are read back from play/img/pieces.png)`);
    }
    continue;
  }
  sheets[key] = decodePng(readFileSync(p));
}
const old = readBack ? { png: decodePng(readFileSync(join(PLAY, 'img', 'tileset.png'))), index: JSON.parse(readFileSync(join(PLAY, 'img', 'tileset.json'), 'utf8')) } : null;
if (readBack) console.error(`(a tile pack is not on disk — every theme's tiles are read back from play/img/tileset.png; put the packs under ${SRC} to change a pack tile)`);

// SKIN VARIANTS (round 16, 2026-09-05): a theme may list several crops for
// a furniture role. The first is the role's own tile, the rest are
// --sprite-<role>-N; board-ui stamps sv1…svN (SKIN_VARIANTS) on every cell
// by a stable hash and the rules emitted below map svN on a skin to its
// Nth sprite, the base as the fallback. A theme with fewer variants than N
// WRAPS AROUND by alias, so every variant it has is used evenly.
const SKIN_ROLES = ['crate', 'chest', 'barrel', 'wreckage'];
const variantCount = {};
for (const t of Object.values(THEMES)) for (const [role, spec] of Object.entries(t.tiles)) if (Array.isArray(spec[0])) variantCount[role] = Math.max(variantCount[role] ?? 1, spec.length);
for (const [role, k] of Object.entries(variantCount)) {
  if (!SKIN_ROLES.includes(role)) throw new Error(`${role}: only furniture skins take variants`);
  if (k > SKIN_VARIANTS) throw new Error(`${role}: ${k} variants, board-ui SKIN_VARIANTS is ${SKIN_VARIANTS}`);
  for (let n = 2; n <= k; n++) ROLES[`${role}-${n}`] = `${ROLES[role]}-${n}`;
}
// THE CRACK (2026-09-07, in the atlas): four drawings every theme wears on a
// weakened wall (board-ui CRACK_VARIANTS, ck1…ck4 by a stable hash of the
// square), in the `classic` row — appended after the variants so every
// pack tile keeps its column.
for (let n = 1; n <= CRACK_VARIANTS; n++) ROLES[`crack-${n}`] = `--tile-crack-${n}`;
// THE EDGE-ON DOOR (2026-09-11): the leaf a door shows when its wall line
// runs up the screen — appended after the crack so every pack tile keeps
// its column. (The north–south doorway posts of the day's earlier cuts are
// gone: the walls end at such a doorway with their own autotile end cases.)
ROLES['door-edge'] = '--sprite-door-edge';

// ---- crop + atlas
const roleNames = Object.keys(ROLES);
const themeNames = Object.keys(THEMES);
const atlas = blank(roleNames.length * T, (themeNames.length + 1) * 2 * T); // a theme row is two tiles tall: furniture props are 16×32 boxes; + the classic row
const index = { tile: T, row: 2 * T, roles: roleNames, themes: {}, packs: PACKS };
const provenance = [];
/** The emitter for one atlas row: blit the tile, record its cell + provenance. */
const emitter = (theme, row) => (role, tile, prov) => {
  if (!(role in ROLES)) throw new Error(`${theme}: unknown role ${role}`);
  const col = roleNames.indexOf(role);
  blit(atlas, tile, col * T, row * 2 * T);
  index.themes[theme].tiles[role] = { col, ...prov };
  if (!prov.composed) provenance.push({ theme, role, ...prov });
};
// THE TALL WALLS, once, in the crypt's colours (the Catacombs sheet on
// disk) — every theme's are palette swaps of these (WALL_SWAPS; the crypt
// wears them as they are). Without the pack every theme's are read back.
const cryptWalls = sheets.cat ? tallWallSet(sheets) : null;
function wallProvenance(theme) {
  const swapped = theme === 'crypt' ? '' : `, palette-swapped to the ${theme}`;
  provenance.push({ theme, role: `wall roof (the frame's north band${swapped})`, pack: SHEETS[CAT_BAND[0]][0], sheet: SHEETS[CAT_BAND[0]][1], x: CAT_BAND[1], y: CAT_BAND[2] });
  provenance.push({ theme, role: `wall face (the brick face${swapped})`, pack: SHEETS[CAT_FACE[0]][0], sheet: SHEETS[CAT_FACE[0]][1], x: CAT_FACE[1], y: CAT_FACE[2] });
}
function emitWalls(theme, emit) {
  if (!cryptWalls) throw new Error(`${theme}: the Catacombs sheet is needed to draw the walls`);
  const swap = theme === 'crypt' ? null : WALL_SWAPS[theme];
  if (theme !== 'crypt' && !swap) throw new Error(`${theme}: no wall palette swap`);
  const tint = (tile) => (swap ? swapPalette(tile, swap) : tile);
  const how = swap ? `the crypt's tall wall (the Catacombs north band + face) in the ${theme} palette` : "the Catacombs north band (5,3) over its brick face (5,9), drawn by depth";
  wallProvenance(theme);
  emit('wall', tint(cryptWalls.walls['wall-10']), { composed: `${how} — case 10, the east–west run`, mask: 10 });
  for (const [role, tile] of Object.entries(cryptWalls.walls)) emit(role, tint(tile), { composed: how, mask: +role.slice(5) });
  for (const [role, tile] of Object.entries(cryptWalls.ruins)) emit(role, tint(tile), { composed: `ruin: ${how}, the joining walls' ragged tongues`, mask: +role.slice(5) });
}
themeNames.forEach((theme, row) => {
  index.themes[theme] = { row, title: THEMES[theme].title, tiles: {} };
  const emit = emitter(theme, row);
  if (readBack) {
    // Every tile of this theme, in the order the last run wrote it, with the
    // provenance it recorded (a composed case carries `composed` + `mask`).
    const was = old.index.themes[theme];
    if (!was) throw new Error(`${theme}: not in the committed atlas — the packs are needed to build a new theme`);
    for (const [role, cell] of Object.entries(was.tiles)) {
      const { col, ...prov } = cell;
      if (role === 'door-edge' || !(role in ROLES)) continue; // the leaf is generated below, never read back; a retired role (the doorway posts) is dropped
      emit(role, crop(old.png, col * T, was.row * 2 * T, T, 2 * T), prov);
    }
    wallProvenance(theme);
    emitEdgeDoor(theme, emit);
    return;
  }
  for (const [role, spec] of Object.entries(THEMES[theme].tiles)) {
    const crops = Array.isArray(spec[0]) ? spec : [spec];
    const prop = SKIN_ROLES.includes(role);
    crops.forEach(([sheet, x, y, w, h], i) => {
      let tile = w ? (prop ? crop(sheets[sheet], x, y, w, h) : cropFit(sheets, sheet, x, y, w, h)) : crop(sheets[sheet], x * T, y * T, T, T);
      if (DECOR_ANCHOR[role]) tile = anchorSprite(tile, DECOR_ANCHOR[role]);
      const spec = THEMES[theme].tint?.[role];
      const tint = typeof spec === 'string' ? spec : spec?.to;
      if (tint) tile = recolourHue(tile, hex(tint), !!spec?.whole);
      if (prop) tile = placeProp(tile); // 16×32: centred small, standing tall
      emit(i ? `${role}-${i + 1}` : role, tile, { pack: SHEETS[sheet][0], sheet: SHEETS[sheet][1], x: w ? x / T : x, y: w ? y / T : y, recoloured: tint ? `${spec?.whole ? 'all' : 'wood'} to ${tint}` : undefined });
    });
    // (Fewer variants than SKIN_VARIANTS wrap around at runtime — atlas.mjs
    // tileOf: sv4 on a role with three sprites is its first again.)
  }
  // The door — also a selectable DOOR SET at runtime (Options → Doors,
  // board-ui DOOR_SETS: every theme's leaf, on any theme — atlas.mjs tileOf
  // takes the door and double from the chosen theme's row) — and its DOUBLE
  // (round 16): two door skins side by side wear the halves. Round 17:
  // pixel-poem's leaf and double for every theme, the wood recoloured for
  // the castle and the crypt ("the doors on Castle and Crypt suck").
  const tint2 = THEMES[theme].tint?.door2;
  const door2 = THEMES[theme].door2.map(([sheet, x, y]) => { const t = crop(sheets[sheet], x * T, y * T, T, T); return tint2 ? recolourHue(t, hex(tint2)) : t; });
  door2.forEach((half, i) => emit(i ? 'door2-r' : 'door2-l', half, { pack: SHEETS[THEMES[theme].door2[i][0]][0], sheet: SHEETS[THEMES[theme].door2[i][0]][1], x: THEMES[theme].door2[i][1], y: THEMES[theme].door2[i][2], recoloured: tint2 ? `wood to ${tint2}` : undefined }));
  emitEdgeDoor(theme, emit);
  {
    const stones = FLAGSTONES.map(([sheet, x, y]) => crop(sheets[sheet], x * T, y * T, T, T));
    const tint = THEMES[theme].floor.tint;
    const base = tint ? mostCommon(stones[0]) : null;
    const target = tint ? mostCommon(crop(sheets[tint[0]], tint[1] * T, tint[2] * T, T, T)) : null;
    stones.forEach((stone, i) => {
      const [sheet, x, y] = FLAGSTONES[i];
      const tile = tint ? recolour(stone, base, target) : stone;
      emit(`floor-${i + 1}`, tile, { pack: SHEETS[sheet][0], sheet: SHEETS[sheet][1], x, y, recoloured: tint ? `to ${SHEETS[tint[0]][0]} floor (${tint[1]},${tint[2]})` : undefined });
    });
  }
  const ws = THEMES[theme].wall;
  emitWalls(theme, emit);
  for (const [role, tile] of Object.entries(holeBlob(ws))) emit(role, tile, { composed: 'hole blob: the pit in the pack palette, rimmed where floor meets it', mask: +role.slice(5) });
});
// THE CLASSIC ROW (2026-09-07): the in-house drawings (lib/inhouse.mjs) —
// what a stage without a theme wears (one wall block for every case, its
// crate / door / barrel / chest, the rubble heap as its ruin) and the four
// CRACKS every theme masks onto a weakened wall. Generated every run, never
// read back; provenance `composed`, so the credits table skips them.
{
  const row = themeNames.length;
  index.themes.classic = { row, title: 'The classic set — drawn in-house (a stage without a theme; the crack every theme wears)', inhouse: true, tiles: {} };
  const emit = emitter('classic', row);
  for (const [role, tile] of Object.entries(inhouseTiles())) if (role !== 'wall') emit(role, tile, { composed: 'drawn in-house (lib/inhouse.mjs)' });
  // Its walls and ruins: the crypt row's (whichever way that row was
  // filled) in the classic palette — so they regenerate without the pack.
  const cryptRow = index.themes.crypt;
  for (const role of ['wall', ...WALL_MASK_CODES.map((c) => `wall-${c}`), ...Array.from({ length: 16 }, (_, m) => `ruin-${m}`)]) {
    const cell = cryptRow.tiles[role];
    if (!cell) throw new Error(`classic: the crypt row has no ${role}`);
    emit(role, swapPalette(crop(atlas, cell.col * T, cryptRow.row * 2 * T, T, TH), WALL_SWAPS.classic), { composed: "the crypt's tall wall in the classic palette", mask: cell.mask });
  }
}
// ---- pieces: one row per set (32-px atlas cells), white p n r b q k then black.
const PA = 32;
const pieceNames = Object.keys(PIECE_SHEETS);
const piecesAtlas = blank(12 * PA, pieceNames.length * PA);
index.pieces = { order: PIECE_ORDER, cell: PA, sets: {} };
pieceNames.forEach((name, row) => {
  const set = PIECE_SHEETS[name];
  const bw = set.box, bh = set.fit;
  index.pieces.sets[name] = { row, title: set.title, pack: set.pack, box: [bw, bh], sheets: [...new Set([...Object.values(set.white), ...Object.values(set.black)].map((c) => SHEETS[c[0]][1]))] };
  [...PIECE_ORDER].forEach((letter, i) => {
    for (const side of ['white', 'black']) {
      const [sheetKey, x, y, w, h] = set[side][letter];
      const col = (side === 'white' ? 0 : 6) + i;
      let tile;
      if (sheets[sheetKey]) {
        let sprite = crop(sheets[sheetKey], x, y, w, h);
        if (set.outline) sprite = recolourOutline(sprite, set.outline.from, set.outline.to);
        sprite = trim(sprite);
        if (sprite.width > bw || sprite.height > bh) throw new Error(`${name} ${side} ${letter}: ${sprite.width}×${sprite.height} exceeds its ${bw}×${bh} box`);
        tile = blank(bw, bh);
        blit(tile, sprite, Math.floor((bw - sprite.width) / 2), bh - sprite.height); // one baseline per set: every foot on the box's bottom row
      } else {
        tile = crop(oldPieces, col * PA, row * PA + (PA - bh), bw, bh); // the pack is not on disk: the committed atlas holds this exact tile
      }
      blit(piecesAtlas, tile, col * PA, row * PA + (PA - bh));
    }
  });
  provenance.push({ theme: 'pieces', role: name, pack: set.pack, sheet: index.pieces.sets[name].sheets.join(' + '), x: '—', y: '—' });
});
mkdirSync(join(PLAY, 'img'), { recursive: true });
writeFileSync(join(PLAY, 'img', 'pieces.png'), encodePng(piecesAtlas));
const atlasPng = encodePng(atlas);
if (!samePixels(decodePng(atlasPng), atlas)) throw new Error('atlas round-trip failed');
writeFileSync(join(PLAY, 'img', 'tileset.png'), atlasPng);
writeFileSync(join(PLAY, 'img', 'tileset.json'), JSON.stringify(index, null, 1) + '\n');

// ---- credits
const md = [];
md.push('# Art credits');
md.push('');
md.push('The board tiles in `play/img/tileset.png` and the piece sprites in `play/img/pieces.png` are repacked from six free pixel-art packs. Only the tiles and sprites the game uses are included; the packs themselves are not redistributed here — get them from their authors:');
md.push('');
for (const [key, p] of Object.entries(PACKS)) {
  md.push(`- **${p.title}** by ${p.author} — <${p.url}>  `);
  md.push(`  ${p.terms}`);
}
md.push('');
md.push('The remaining sprites (the crack, the edge-on door leaf every theme wears in its own door tint, and the `classic` row — the drawn set a stage without a theme wears) are drawn in-house by `phase0/lib/inhouse.mjs`. THE WALLS (47 tall autotile cases per theme, `wall-<mask>`) and the RUINS (16 cases, `ruin-<mask>` — the stub a broken wall leaves) are ONE drawing on every theme: the Catacombs frame\'s north band over its brick face (the two tiles listed below), composed case by case by the repack tool and worn by the hall, the castle and the classic set as exact palette swaps. The HOLE autotile (16 cases, `hole-<mask>` — the pit the gods leave, rimmed where floor meets it) is generated in each theme\'s colours.');
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

console.log(`tileset.png ${atlas.width}×${atlas.height} (${atlasPng.length} B), pieces.png ${piecesAtlas.width}×${piecesAtlas.height} (${pieceNames.length} sets), ${provenance.length} provenance rows over ${themeNames.length} themes${readBack ? ' (read back)' : ''}; CREDITS.md written`);
