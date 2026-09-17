// THE IN-HOUSE SET — the classic drawings and THE CRACK, as 16×16 pixel
// buffers for the atlas (phase0/harness/repack-tiles.mjs writes them into
// play/img/tileset.png as the `classic` row: wall / crate / door / barrel /
// chest / rubble and crack-1…4). Until 2026-09-07 these were SVG data URIs
// in play/style.css (gen-sprites.mjs) that the DOM board painted and the
// canvas board decoded off the cascade at boot; the DOM board's retirement
// moved them into the PNG, so the canvas board reads ONE atlas and no CSS.
// The drawings are unchanged: every sprite is crisp-edged <rect>s on the
// 16×16 grid, painted here in order — the same pixels a browser rasterised.
//
// Palette + drawings are the gen-sprites.mjs originals, verbatim — plus,
// since 2026-09-11, THE EDGE-ON DOOR (designer: "can we finally get a
// proper vertical door asset? The placeholder looks like ass"; then, on two
// cuts and a sheet of alternatives, their own drawing — "Use this one"):
// the leaf a door shows when its wall line runs up the screen is THE
// DESIGNER'S SPRITE, `inhouse/door-profile.png`, a 5×16 side-view door in
// pixel-poem's face-on leaf's exact colours (so the repack tool's per-theme
// hue recolour lands on the castle's walnut and the crypt's dark oak byte
// for byte), placed in the wall band's middle; the classic set wears the
// same sprite in its own wood and iron.
import { readFileSync } from 'node:fs';
import { decodePng, blank } from './png.mjs';
const T = 16;

// Palette (shared so the set reads as one hand).
const P = {
  mortar: '#262433', stone: '#605e7a', stoneHi: '#8583a3', stoneLo: '#403e55', speck: '#6f6d8c', speckLo: '#52506a',
  crack: '#0b0a10',
  ink: '#3a2213', woodHi: '#d09a5c', wood: '#b8713a', woodLo: '#8a4f28', woodDeep: '#5a3418', iron: '#9aa0ad', ironLo: '#5d626e', gold: '#e0c25a', red: '#c96a4a',
};

const R = (x, y, w, h, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const PATH = (d, stroke, w, extra = '') => `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="square" stroke-linejoin="miter"${extra}/>`;
const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${body}</svg>`;

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
  chest: svg(
    R(2, 2, 12, 5, P.ink) + R(3, 3, 10, 3, P.woodLo) + R(3, 3, 10, 1, P.wood) +
    R(2, 7, 12, 7, P.ink) + R(3, 8, 10, 5, P.wood) + R(3, 8, 10, 1, P.woodHi) +
    R(4, 3, 1, 10, P.iron) + R(11, 3, 1, 10, P.iron) + R(4, 6, 1, 1, P.ironLo) + R(11, 6, 1, 1, P.ironLo) +
    R(7, 6, 2, 3, P.gold) + R(7, 7, 2, 1, P.ink)
  ),
  // A shelf unit with odds and ends on it.
  // The rubble HEAP is residue-only since 2026-09-04 (the classic set's ruin
  // fallback): authored masonry is a weak spot wearing the crack.
  rubble: svg(
    R(1, 8, 7, 7, P.mortar) + R(2, 9, 5, 5, P.stone) + R(2, 9, 5, 1, P.stoneHi) +
    R(7, 9, 8, 6, P.mortar) + R(8, 10, 6, 4, P.stone) + R(8, 10, 6, 1, P.stoneHi) + R(8, 13, 6, 1, P.stoneLo) +
    R(5, 4, 6, 6, P.mortar) + R(6, 5, 4, 4, P.stoneHi) + R(6, 8, 4, 1, P.stone) +
    R(11, 5, 3, 3, P.mortar) + R(12, 6, 1, 1, P.stone) + R(3, 6, 2, 2, P.mortar) + R(3, 6, 1, 1, P.stoneLo)
  ),
};

// THE EDGE-ON LEAF every pack theme wears (2026-09-11): the designer's
// own sprite, `inhouse/door-profile.png` — a 5×16 side-view door, one
// tile tall: the lit body (pixel-poem's lintel timber) crossed by board
// rows in the plank timber, an outline down its left and along its foot,
// the hinges' two irons down the leftmost column — placed at column
// EDGE_LEAF_X of a 16×16 tile so it stands in the middle of the wall
// band (columns 2–13), which the canvas board paints under it. The repack
// tool recolours it per theme as it does the face-on leaf, scaled against
// the PLANK timber as the dominant wood (the lit body dominates this
// sprite, so the tool is told the base — else the castle's and the
// crypt's leaves would drift from their face-on doors).
const EDGE_LEAF_X = 5;
export { EDGE_LEAF_X };
const EDGE_LEAF_FILE = new URL('./inhouse/door-profile.png', import.meta.url);
/** The classic set's colours for the sprite's pixel-poem ones. */
const CLASSIC_LEAF = { '#25131a': P.ink, '#895a45': P.woodLo, '#bf704d': P.wood, '#adc1cf': P.iron, '#90919e': P.ironLo };

/** The designer's profile door placed in a 16×16 tile — a door is a door
 *  seen edge-on: the same sixteen rows as the face-on leaf, standing at
 *  its own square's depth at the same lift (2026-09-12, the designer on a
 *  27-row leaf reaching the far wall's face top: "they look like they
 *  connect all the way at the top of the wall, unlike the forward facing
 *  doors"). `map` (a colour → colour table, #rrggbb) recolours it for the
 *  classic set. */
function profileDoor(map = null) {
  const src = decodePng(readFileSync(EDGE_LEAF_FILE));
  if (src.width + EDGE_LEAF_X > T || src.height !== T) throw new Error(`inhouse: door-profile.png is ${src.width}×${src.height}; expected ≤ ${T - EDGE_LEAF_X}×${T}`);
  const tile = blank(T, T);
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const i = (y * src.width + x) * 4, o = (y * T + x + EDGE_LEAF_X) * 4;
    if (!src.data[i + 3]) continue;
    let rgb = [src.data[i], src.data[i + 1], src.data[i + 2]];
    if (map) {
      const key = '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
      const to = map[key];
      if (to) rgb = [parseInt(to.slice(1, 3), 16), parseInt(to.slice(3, 5), 16), parseInt(to.slice(5, 7), 16)];
    }
    tile.data[o] = rgb[0]; tile.data[o + 1] = rgb[1]; tile.data[o + 2] = rgb[2]; tile.data[o + 3] = src.data[i + 3];
  }
  return tile;
}

/** Paint an SVG of axis-aligned <rect>s (integer x / y / width / height,
 *  an opaque #rrggbb fill) into a 16×16 RGBA buffer, in document order. */
export function rasterize(svgText) {
  const data = Buffer.alloc(T * T * 4);
  const re = /<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)" fill="#([0-9a-fA-F]{6})"\/>/g;
  let m;
  let n = 0;
  while ((m = re.exec(svgText))) {
    n++;
    const [x, y, w, h] = m.slice(1, 5).map(Number);
    const r = parseInt(m[5].slice(0, 2), 16), g = parseInt(m[5].slice(2, 4), 16), b = parseInt(m[5].slice(4, 6), 16);
    for (let j = Math.max(0, y); j < Math.min(T, y + h); j++) for (let i = Math.max(0, x); i < Math.min(T, x + w); i++) {
      const o = (j * T + i) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
    }
  }
  if (!n || svgText.replace(re, '').replace(/<svg[^>]*>|<\/svg>/g, '').trim()) throw new Error('inhouse: a sprite carries something other than rects');
  return { width: T, height: T, data };
}

/** The edge-on LEAF the pack themes wear: the designer's profile door in
 *  pixel-poem's timber, placed in the band; the repack tool recolours it
 *  per theme as it does the face-on leaf, against the plank timber. */
export function edgeLeafTile() {
  return profileDoor();
}

/** Every in-house tile by ATLAS ROLE: the classic row's wall / crate / door
 *  / barrel / chest / rubble, the designer's profile door in the set's own
 *  colours (door-edge) and crack-1…4 (the same crack every theme wears). */
export function inhouseTiles() {
  const out = {};
  for (const [name, s] of Object.entries(SPRITES)) {
    const role = name === 'tile-wall' ? 'wall' : name.startsWith('tile-crack-') ? `crack-${name.slice('tile-crack-'.length)}` : name;
    out[role] = rasterize(s);
  }
  out['door-edge'] = profileDoor(CLASSIC_LEAF);
  return out;
}
