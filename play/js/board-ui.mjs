// The board's TERRAIN RULE and its pure helpers — what every square IS
// (classifyTerrain), what a break leaves behind (residueStep), which
// cosmetic prop a wall face carries (decorFor), the stable per-square
// variant hashes (floor / crack / skin), the wall autotile mask, the piece
// and door set lists and the piece placement defaults — shared by the
// canvas board (canvas-board.mjs), the replay analyzer, the selftest, the
// repack tool and the log report. No DOM in here but the promotion picker
// at the bottom.
//
// Until 2026-09-07 this file was the DOM board (BoardUI: a CSS grid of
// cells, tiles.css's data-URI tiles, FLIP slides, an SVG arrow layer, the
// tile-grid piece tiers) and these were its data half. The DOM board is
// retired — the 16×16 canvas board is the one renderer (brief §2 item 5;
// CLAUDE.md § Phase 2) — and the data half stays, unchanged, under the
// name every importer knows.
//
// Squares are addressed by ABSOLUTE name ('a1'..'l10') everywhere; flipping
// the view (player plays Black) is the renderer's business.
//
// TERRAIN, per square (classifyTerrain — the classes the canvas board's
// cellClasses() reports are these names, the shared test surface):
//   wall       authored stone that is not a hole (standing)
//   hole       a square the gods crumbled: permanent. FSF reads both as '*'
//              and only the Director's `holes` ledger tells them apart, so
//              classifyTerrain takes that ledger as an argument.
//   furniture  a crate '^' (§4.6): capturable, neutral. The flavour is the
//              stage's skin grid (skin-<name>: door / barrel / chest / crate
//              / wreckage / masonry; the crate is the default).
//   cracked    a wall the gods weakened into a crate (§4.5 weaken): the
//              wall case with the crack, from the Director's `godCrates`
//              ledger ANDed with the FEN's '^' (the ledger keeps stale
//              entries for god-crates an army captured; the AND is what
//              keeps them from painting). A cracked cell is still
//              furniture: everything keyed on "this cell holds a capturable
//              sprite" keeps working.
//   wm-<mask>  the AUTOTILE case of a wall / cracked wall: the mask of solid
//              neighbours (N=1 E=2 S=4 W=8, diagonals NE=16 SE=32 SW=64
//              NW=128, canonicalMask below; solid = stone that is not a
//              hole, a cracked wall, a DOOR skin or MASONRY — those continue
//              the wall line; crates and the rest do not). A theme paints
//              the 47 blob cases (wall-<mask> in the atlas), the classic set
//              one block for all.
//   weak       an authored WEAK SPOT: the masonry skin. The cell paints its
//              wall case under THE crack, the same overlay a god-weakened
//              wall wears — the same capturable '^'. Since 2026-09-04
//              masonry is a weak spot, not a rubble heap (the heap survives
//              as the classic set's ruin). Until the camera (2026-09-08) a
//              DOOR in a north–south wall line was a weak spot too, for
//              want of edge-on art; now every door is a door — see doorLine.
//   doorLine   the wall line a door skin stands in, WORLD space: 'ns' when
//              it has a standing neighbour north or south and none east or
//              west, else 'ew'. The camera (camera.mjs edgeOn) decides
//              whether the line runs up the screen — then the door paints
//              EDGE-ON (the generated placeholder: the wall's band with the
//              leaf as a thin slab and a post above and below, brief §11)
//              — or across it, the leaf.
//   f1…fN      the floor's stable texture variant (FLOOR_VARIANTS).
//   ck1…ckN    the crack drawing this square's wall would wear (CRACK_VARIANTS).
//   sv1…svN    which of a skin's sprite VARIANTS this square shows
//              (SKIN_VARIANTS; the atlas wraps a variant the theme lacks).
//   door2      a door skin paired with the door skin beside it ALONG ITS
//              WALL LINE (round 16; both axes since the camera, 2026-09-08):
//              the two paint ONE two-wide door. The value is the leaf's
//              WORLD end — 'l' the west / 'r' the east leaf of a pair along
//              a rank, 'n' / 's' the ends of a pair along a file — and the
//              camera turns it into the SCREEN half (camera.mjs doorHalf:
//              the left leaf on the screen paints the left half; a pair
//              standing edge-on paints two edge-on doors, the brief's
//              "two-tall pair"). The board's cellClasses report the screen
//              half as door2-l / door2-r. Paired west to east, then south
//              to north, on the AUTHORED skin grid, so a run of three is a
//              double and a single, and a leaf keeps its half after its
//              partner goes.
//   decor      a cosmetic prop under the piece (decorFor: torch / chain /
//              banner on an east–west wall face, scattered by a stable hash
//              of the square — floor litter is packed away since round 10 —
//              and the OPEN DOORWAY a door left behind, whose cell wears
//              wm-<mask> = the walls still STANDING beside it (N=1 E=2 S=4
//              W=8 — the north / south bits since the camera, 2026-09-08:
//              a north–south door's doorway has its posts above and
//              below), so a post stands only where its wall does — round
//              12).
//   ruin       a floor square where a wall, a cracked wall or a weak spot
//              BROKE (the residue ledger `rubble`): the theme's ruin stub
//              case (ruin-<mask>, 16 cases by its STANDING wall neighbours —
//              never another ruin or an opened doorway, round 12) under
//              whatever stands there, and it COUNTS AS SOLID to its
//              neighbours' wall cases — as does an opened doorway — so the
//              wall line runs on through the break instead of capping
//              either side of a gap.
import { splitFen, parseBoard, WALL, FURNITURE } from './fen.mjs';

/** The tile grid's placement dials, in whole tile pixels (canvas-board
 *  setPieceFit): rows above the square's bottom edge, columns east of centre. */
export const TILE_LIFT_RANGE = [-4, 20];
export const TILE_SHIFT_RANGE = [-7, 7];
/** The filled Unicode glyphs — the promotion picker's fallback when no
 *  atlas is to hand (a page without the art). */
const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const EMPTY = new Set();

/** Wall autotile mask bits: N=1 E=2 S=4 W=8, diagonals NE=16 SE=32 SW=64
 *  NW=128. A diagonal only matters when BOTH its orthogonal neighbours are
 *  solid (it decides whether that corner of a thick block is filled — the
 *  standard 47-case blob), so canonicalMask() zeroes the rest and
 *  WALL_MASK_CODES are the only classes the renderer emits (and the only
 *  tiles repack-tiles.mjs composes). */
export function canonicalMask(m) {
  const n = m & 1, e = m & 2, s = m & 4, w = m & 8;
  let c = m & 15;
  if (n && e && m & 16) c |= 16;
  if (s && e && m & 32) c |= 32;
  if (s && w && m & 64) c |= 64;
  if (n && w && m & 128) c |= 128;
  return c;
}
export const WALL_MASK_CODES = [...new Set(Array.from({ length: 256 }, (_, m) => canonicalMask(m)))].sort((a, b) => a - b);

/** Piece-sprite sets the board can wear (play/img/pieces.png, a row per
 *  set; repack-tiles.mjs builds them). The third is the board's default. */
export const PIECE_SETS = ['pixel-chess', 'pixel-chess-wood', 'nulltale', 'nulltale-dread', 'deja-view'];
/** Door sets (data-doors on the board; atlas.mjs tileOf): each theme's
 *  door (and its double), selectable over any theme — since round 17 all three are
 *  pixel-poem's leaf, in the hall's timber, a slate stain, dark oak. */
export const DOOR_SETS = ['hall', 'castle', 'crypt'];
/** Floor texture variants a theme may provide (floor-1..N in the atlas). */
export const FLOOR_VARIANTS = 6;
/** Crack drawings (the atlas's classic row, lib/inhouse.mjs): every cell carries
 *  ck1…ckN by a stable hash of its square, so neighbouring cracked walls
 *  differ and a repaint never swaps a crack (round 14). */
export const CRACK_VARIANTS = 4;
/** Furniture sprite variants (round 16, 2026-09-05: "look at all these
 *  vase and crate variants"): every cell carries sv1…svN by a stable hash
 *  of its square, and the atlas maps svN on a skin to the theme's Nth
 *  sprite for that role (<role>-N, wrapping around what it has), so
 *  a row of urns is not five identical urns and a repaint never swaps one. */
export const SKIN_VARIANTS = 10;

/** The piece placement's defaults (canvas-board setPieceFit), in WHOLE
 *  TILE PIXELS on the tile grid — `tileLift` rows above the square's bottom
 *  edge (designer 2026-09-07: "the foot of the piece should be roughly
 *  centered on the tile") and `tileShift` columns east of centre: the
 *  designer's settled numbers, lift +5, shift +1. (The % dials and the
 *  'display' / 'free' pixel modes of the DOM board retired with it.) */
export const DEFAULT_PIECE_FIT = { tileLift: 5, tileShift: 1 };

/** Stable floor-texture variant for a square: f1 (the common stone) on
 *  ~70% of squares, f2…f6 scattered over the rest — a fixed hash of the
 *  square, so a repaint never makes the floor crawl. */
/** Stable per-square hash for cosmetic scatter (decor). */
function squareHash(f, rank, salt) {
  return (((f + 1) * 2654435761) ^ ((rank + 1) * 40503) ^ (salt * 97)) >>> 0;
}

/** Which cosmetic prop a square carries, or null. Walls facing south (an
 *  east–west run with floor below) get wall-mounted props at a low rate —
 *  a prop must never read as a piece or as terrain. Floor litter (web /
 *  bones / skull / candle) is PACKED AWAY (designer round 10: it made the
 *  pieces harder to read); the sprites stay in the atlas. */
export function decorFor({ wallTile, cracked, mask, f, rank, earned }) {
  if (earned) return earned; // the open doorway a door left behind
  if (!wallTile || cracked || !(mask & 10) || mask & 4) return null;
  const r = squareHash(f, rank, 7) % 1000;
  return r < 200 ? 'torch' : r < 260 ? 'banner' : r < 320 ? 'chain' : null;
}

function floorVariant(f, rank) {
  const h = (((f + 1) * 73856093) ^ ((rank + 1) * 19349663)) >>> 0;
  const r = h % 16;
  return r < FLOOR_VARIANTS - 1 ? `f${r + 2}` : 'f1';
}

/** Which of the crack drawings a square wears if its wall cracks. */
function crackVariant(f, rank) {
  return `ck${crackVariantIndex(f, rank)}`;
}
/** The crack drawing's NUMBER (1…CRACK_VARIANTS) for a square. */
export function crackVariantIndex(f, rank) {
  return 1 + (squareHash(f, rank, 11) % CRACK_VARIANTS);
}
/** Which of a skin's sprite variants a square shows (SKIN_VARIANTS). */
function skinVariant(f, rank) {
  return `sv${skinVariantIndex(f, rank)}`;
}
/** The variant NUMBER (1…SKIN_VARIANTS) — the debris layer records which
 *  sprite a square wore when it broke, so the spray is that sprite's own
 *  pixels (debris.mjs spriteVar). */
export function skinVariantIndex(f, rank) {
  return 1 + (squareHash(f, rank, 17) % SKIN_VARIANTS);
}
/** The floor-tile variant NUMBER (1…FLOOR_VARIANTS) a square wears. */
export function floorVariantIndex(f, rank) {
  return parseInt(floorVariant(f, rank).slice(1), 10);
}

/**
 * What every square IS, from the FEN and the Director's ledgers — the ONE
 * terrain rule of the renderer (2026-09-07: lifted out of setPosition so the
 * replay analyzer can rebuild a board's residue from a log without a DOM;
 * setPosition paints exactly this). Returns Map(square → {
 *   v            the FEN cell: a piece letter, '*', '^' or null
 *   wallTile     '*' that is not a hole (standing stone)
 *   hole         '*' the gods crumbled (the `holes` ledger)
 *   furniture    '^'
 *   cracked      '^' the gods weakened (the `godCrates` ledger ANDed with the FEN)
 *   skin         the authored skin on an un-cracked '^', else null
 *   door2        the leaf's world end in an authored double door — 'l' / 'r'
 *                (west / east, a pair along a rank), 'n' / 's' (a pair along
 *                a file) — else null
 *   doorLine     for a door skin, the wall line it stands in: 'ns' / 'ew'
 *   weak         a weak spot: authored masonry
 *   ruin         floor where a wall broke (the `rubble` residue)
 *   doorway      floor where a door opened (the `opened` residue)
 *   mask         the autotile case (wm-<mask>), −1 for plain floor — WORLD
 *                space; the camera permutes it to the screen (camera.mjs)
 * }).
 *
 * STANDING = stone that is not a hole: a wall, a cracked wall, a door,
 * authored masonry (a weak spot is still stone in the line) — the things
 * that continue a wall line to the eye. SOLID (for the wall autotile) =
 * standing, or the RESIDUE of it: a broken wall's ruin stub and an opened
 * doorway keep the line running through the break (round 10). A RUIN's own
 * stub case counts STANDING neighbours only (round 12: two broken squares
 * side by side each drew a stub at the other — a clump of wall floating
 * between two floor squares — and a stub grew against an open doorway's
 * post): its stubs are the broken ends of walls that still stand, and
 * residue has no end to show. A HOLE's autotile case joins only other holes
 * (round 13): joined pits are one pit, and the ragged rim runs only where
 * floor meets them. An opened DOORWAY's posts stand only beside STANDING
 * walls (round 12): the cell wears the east/west standing mask.
 */
export function classifyTerrain(fen, { holes = EMPTY, godCrates = EMPTY, skins = {}, opened = EMPTY, rubble = EMPTY } = {}, files, ranks) {
  const boardField = fen.includes(' ') ? splitFen(fen).board : fen;
  const grid = parseBoard(boardField); // [rankFromTop][file]
  const name = (ff, rr) => String.fromCharCode(97 + ff) + rr;
  const ctx = {
    files,
    ranks,
    cell: (ff, rr) => {
      if (ff < 0 || ff >= files || rr < 1 || rr > ranks) return undefined;
      const sq = name(ff, rr);
      return { v: grid[ranks - rr]?.[ff] ?? null, hole: holes.has(sq), crate: godCrates.has(sq), skin: skins[sq] ?? null, opened: opened.has(sq), rubble: rubble.has(sq) };
    },
    key: name,
  };
  ctx.pairs = pairDoors(ctx);
  const out = new Map();
  for (let rank = 1; rank <= ranks; rank++) {
    for (let f = 0; f < files; f++) out.set(name(f, rank), classifyCell(ctx, f, rank));
  }
  return out;
}

/**
 * THE CORE of the terrain rule on any grid (Phase 2 milestone 4, 2026-09-08
 * — the world: the canvas board classifies the world's cells through this,
 * lazily, and classifyTerrain above is the same rule on a FEN). `ctx` is
 * { files, ranks, cell(f, rank) → { v, hole, crate, skin, opened, rubble }
 * or undefined off the grid, key(f, rank) → a Map key, pairs: pairDoors(ctx) }.
 * Ranks are 1-based here, as the FEN's are.
 */
export function classifyCell(ctx, f, rank) {
  const { cell } = ctx;
  const at = (ff, rr) => cell(ff, rr);
  const standing = (ff, rr) => {
    const c = at(ff, rr);
    if (c === undefined) return false;
    if (c.v === FURNITURE) return c.crate || c.skin === 'door' || c.skin === 'masonry';
    if (c.v === WALL) return !c.hole;
    return false;
  };
  const isHole = (ff, rr) => {
    const c = at(ff, rr);
    return !!c && c.v === WALL && c.hole;
  };
  const solid = (ff, rr) => {
    if (standing(ff, rr)) return true;
    const c = at(ff, rr);
    if (c === undefined || c.v === FURNITURE || c.v === WALL) return false;
    return c.rubble || c.opened;
  };
  const me = at(f, rank);
  const v = me?.v ?? null;
  const isWall = v === WALL;
  const furniture = v === FURNITURE;
  const wallTile = isWall && !me.hole;
  const hole = isWall && !!me.hole;
  const cracked = furniture && !!me.crate;
  const skin = furniture && !cracked ? me.skin ?? null : null;
  const door2 = skin === 'door' ? ctx.pairs.get(ctx.key(f, rank)) ?? null : null;
  // WEAK SPOTS wear the crack (2026-09-04): authored masonry, which
  // paints the wall block with THE crack exactly like a god-weakened
  // wall — the same capturable '^'. A DOOR is a door wherever it stands
  // (the camera, 2026-09-08): its wall LINE is recorded here in world
  // space, and the board decides on the screen whether the leaf shows
  // or the door stands edge-on (camera.mjs edgeOn). (Until then a door
  // in a north–south line was a weak spot, for want of edge-on art.)
  const N = solid(f, rank + 1), E = solid(f + 1, rank), S = solid(f, rank - 1), W = solid(f - 1, rank);
  const weak = skin === 'masonry';
  const doorLine = skin === 'door' ? ((N || S) && !(E || W) ? 'ns' : 'ew') : null;
  const floor = !isWall && !furniture;
  const ruin = floor && !!me?.rubble;
  const doorway = floor && !ruin && !!me?.opened;
  // A door always carries its wall case: edge-on it paints the wall's
  // band, and which way it stands is the camera's call, not this one.
  const mask = wallTile || cracked || weak || skin === 'door'
    ? canonicalMask((N ? 1 : 0) | (E ? 2 : 0) | (S ? 4 : 0) | (W ? 8 : 0) | (solid(f + 1, rank + 1) ? 16 : 0) | (solid(f + 1, rank - 1) ? 32 : 0) | (solid(f - 1, rank - 1) ? 64 : 0) | (solid(f - 1, rank + 1) ? 128 : 0))
    : ruin ? (standing(f, rank + 1) ? 1 : 0) | (standing(f + 1, rank) ? 2 : 0) | (standing(f, rank - 1) ? 4 : 0) | (standing(f - 1, rank) ? 8 : 0)
    : doorway ? (standing(f, rank + 1) ? 1 : 0) | (standing(f + 1, rank) ? 2 : 0) | (standing(f, rank - 1) ? 4 : 0) | (standing(f - 1, rank) ? 8 : 0)
    : hole ? (isHole(f, rank + 1) ? 1 : 0) | (isHole(f + 1, rank) ? 2 : 0) | (isHole(f, rank - 1) ? 4 : 0) | (isHole(f - 1, rank) ? 8 : 0)
    : -1;
  return { v, wallTile, hole, furniture, cracked, skin, door2, doorLine, weak, ruin, doorway, mask };
}

/**
 * DOUBLE DOORS (round 16): two door skins side by side along their wall
 * line are one two-wide door. Paired on the AUTHORED skin grid (round 17:
 * "if one opens or is destroyed, the closed door next to it suddenly
 * becomes a normal door"), so a leaf keeps its half after its partner is
 * captured, burst or god-cracked — the half is painted only on a leaf
 * that still stands. Pairs along a rank first (west leaf 'l', east 'r'),
 * then, among the leaves still single, along a file (south 's', north
 * 'n' — the camera, 2026-09-08: a stack in a file is the same double door
 * seen from its side, and turns into a rank pair under a quarter turn).
 * Returns Map(key → end) over the whole grid.
 */
export function pairDoors(ctx) {
  const { files, ranks, cell, key } = ctx;
  const isDoor = (ff, rr) => cell(ff, rr)?.skin === 'door';
  const pairEnd = new Map();
  for (let rr = 1; rr <= ranks; rr++) {
    for (let ff = 0; ff < files - 1; ff++) {
      if (!isDoor(ff, rr) || !isDoor(ff + 1, rr)) continue;
      pairEnd.set(key(ff, rr), 'l');
      pairEnd.set(key(ff + 1, rr), 'r');
      ff++; // the pair is spoken for
    }
  }
  for (let ff = 0; ff < files; ff++) {
    for (let rr = 1; rr < ranks; rr++) {
      if (!isDoor(ff, rr) || !isDoor(ff, rr + 1) || pairEnd.has(key(ff, rr)) || pairEnd.has(key(ff, rr + 1))) continue;
      pairEnd.set(key(ff, rr), 's');
      pairEnd.set(key(ff, rr + 1), 'n');
      rr++;
    }
  }
  return pairEnd;
}

/**
 * The RESIDUE a board change leaves (main.mjs paintBoard's rule, on data):
 * terrain that stood on `prev` and is gone on `next` leaves the theme's
 * OPEN DOORWAY where a door was captured or burst (any door since the
 * camera, 2026-09-08 — a north–south door's doorway wears its posts above
 * and below; until then such a door was a weak spot and left a ruin), and
 * the RUIN stub where a wall, a cracked wall or authored masonry broke
 * (round 10: "cracked walls turning into open doors doesn't make any
 * sense"); any other furniture (a crate, a barrel…) leaves nothing — it
 * never continued a wall line. Terrain that is back (an undo) clears its
 * residue. `prev` = { fen, holes, godCrates, opened, rubble }, `next` =
 * { fen, holes }; returns the next { opened, rubble } (new Sets).
 */
export function residueStep(prev, next, skins = {}, files, ranks) {
  const opened = new Set(prev.opened ?? []);
  const rubble = new Set(prev.rubble ?? []);
  if (!prev.fen || !next.fen || prev.fen === next.fen) return { opened, rubble };
  const was = classifyTerrain(prev.fen, { holes: prev.holes ?? EMPTY, godCrates: prev.godCrates ?? EMPTY, skins, opened, rubble }, files, ranks);
  const nextGrid = parseBoard((next.fen.includes(' ') ? splitFen(next.fen).board : next.fen));
  const nextHoles = next.holes ?? EMPTY;
  const terrainNext = (sq) => {
    const f = sq.charCodeAt(0) - 97;
    const rank = parseInt(sq.slice(1), 10);
    const t = nextGrid[ranks - rank]?.[f] ?? null;
    return t === WALL || t === FURNITURE;
  };
  for (const [sq, k] of was) {
    const stood = k.wallTile || k.furniture;
    if (!stood) continue;
    if (terrainNext(sq) || nextHoles.has(sq)) continue;
    if (k.skin === 'door') opened.add(sq);
    else if (k.wallTile || k.cracked || k.skin === 'masonry') rubble.add(sq);
  }
  for (const sq of [...opened, ...rubble]) if (terrainNext(sq)) { opened.delete(sq); rubble.delete(sq); }
  return { opened, rubble };
}

/** Modal promotion picker (§4.4). No dismissal without choosing. Each
 *  button shows the piece as the board draws it — the set's sprite off the
 *  atlas (canvas-board loadAtlas), pixelated; the glyph when there is none. */
export function pickPromotion(letters, { pieces = null, atlas = null } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'promo-overlay';
    const card = document.createElement('div');
    card.className = 'promo-card';
    const label = document.createElement('div');
    label.className = 'promo-label';
    label.textContent = 'Promote to';
    card.appendChild(label);
    const set = pieces && PIECE_SETS.includes(pieces) ? pieces : PIECE_SETS[2];
    for (const l of letters) {
      const btn = document.createElement('button');
      btn.className = 'promo-btn';
      btn.dataset.piece = l;
      btn.setAttribute('aria-label', l);
      const sprite = atlas?.pieceOf?.(set, l) ?? null;
      if (sprite) {
        const c = document.createElement('canvas');
        c.width = sprite.w;
        c.height = sprite.h;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(sprite.src, sprite.sx, sprite.sy, sprite.w, sprite.h, 0, 0, sprite.w, sprite.h);
        c.className = 'promo-sprite';
        btn.appendChild(c);
      } else btn.textContent = GLYPHS[l.toLowerCase()] ?? l;
      btn.addEventListener('click', () => {
        overlay.remove();
        resolve(l);
      });
      card.appendChild(btn);
    }
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}
