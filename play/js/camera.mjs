// THE CAMERA — pure geometry (Phase 2, the camera PR, 2026-09-08).
//
// Brief §5.1: the camera turns with the army — screen-up is the army's
// facing — and CLAUDE.md § Phase 2: the buffer is painted from the world
// through a camera { facing, k }. This module is the facing half, all
// data: where a world square lands on the screen grid, the inverse for
// hit-testing, where an arena PIXEL lands (the debris flight, the fx), how
// an autotile MASK reads once the neighbours have turned, how a 16×16
// debris buffer turns by index permutation, which half of a double door a
// leaf paints on the screen, and whether a door stands edge-on. The
// canvas board (canvas-board.mjs) calls these and nothing else decides
// orientation; the selftest and phase0/harness/test-camera.mjs cross-check
// them against brute force.
//
// FACING is which WORLD direction points up the screen: 0 north (the
// duel's view since Phase 1), 1 east, 2 south (the old `flipped` — the
// 180° turn), 3 west. Turning the army RIGHT (north → east) is facing + 1:
// the map on the screen turns COUNTER-clockwise, what stood to the right
// now stands ahead. Every direction-bearing tile is generated from a mask,
// so a turn is a bit permutation applied before the tile lookup (the
// masks themselves stay in world space — that is the shared test
// surface); pieces and props never rotate; variant hashes key on world
// coordinates so a turn never reshuffles the floor; the turn is a CUT.
export const FACINGS = 4;
export const FACING_NAMES = ['north', 'east', 'south', 'west'];

/** A facing, normalised to 0…3 (anything unparseable is north). */
export function normFacing(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return ((Math.round(v) % FACINGS) + FACINGS) % FACINGS;
}

export function facingName(n) {
  return FACING_NAMES[normFacing(n)];
}

/** The screen grid's size in tiles: a quarter turn swaps the axes. */
export function screenDims(files, ranks, facing) {
  return normFacing(facing) & 1 ? { cols: ranks, rows: files } : { cols: files, rows: ranks };
}

/** World square (file 0-based, rank 1-based) → screen column / row-from-top. */
export function toScreen(f, rank, files, ranks, facing) {
  switch (normFacing(facing)) {
    case 1: return { col: ranks - rank, row: files - 1 - f };
    case 2: return { col: files - 1 - f, row: rank - 1 };
    case 3: return { col: rank - 1, row: f };
    default: return { col: f, row: ranks - rank };
  }
}

/** Screen column / row → world square { f, rank }, or null off the grid. */
export function toWorld(col, row, files, ranks, facing) {
  const { cols, rows } = screenDims(files, ranks, facing);
  if (col < 0 || col >= cols || row < 0 || row >= rows) return null;
  switch (normFacing(facing)) {
    case 1: return { f: files - 1 - row, rank: ranks - col };
    case 2: return { f: files - 1 - col, rank: row + 1 };
    case 3: return { f: row, rank: col + 1 };
    default: return { f: col, rank: ranks - row };
  }
}

/** Arena pixel (x right, y down from the top rank, the unturned view; the
 *  arena is W×H px) → screen pixel. The same permutation as the squares,
 *  one pixel at a time, so a flight's chunk lands in the turned square
 *  exactly where it lands in the unturned one. */
export function pxToScreen(x, y, W, H, facing) {
  switch (normFacing(facing)) {
    case 1: return { x: y, y: W - 1 - x };
    case 2: return { x: W - 1 - x, y: H - 1 - y };
    case 3: return { x: H - 1 - y, y: x };
    default: return { x, y };
  }
}

/** One quarter turn of the 8-neighbour wall mask (N=1 E=2 S=4 W=8, NE=16
 *  SE=32 SW=64 NW=128): the screen's north neighbour is the world's east.
 *  Each nibble rotates right by one bit. */
function rot8(m) {
  const lo = m & 15, hi = (m >> 4) & 15;
  return (((lo >> 1) | (lo << 3)) & 15) | ((((hi >> 1) | (hi << 3)) & 15) << 4);
}

/** The wall mask as the screen sees it under a facing (world mask in). */
export function rotMask8(mask, facing) {
  if (!(mask >= 0)) return mask;
  let m = mask;
  for (let i = normFacing(facing); i > 0; i--) m = rot8(m);
  return m;
}

/** The 4-bit ruin / pit-rim / doorway mask (N=1 E=2 S=4 W=8) under a facing. */
export function rotMask4(mask, facing) {
  if (!(mask >= 0)) return mask;
  let m = mask & 15;
  for (let i = normFacing(facing); i > 0; i--) m = ((m >> 1) | (m << 3)) & 15;
  return m;
}

/** A 16×16 RGBA buffer (a debris cell) turned by index permutation — pixel
 *  (u, v) lands where pxToScreen puts it inside the tile. Returns a new
 *  buffer of the same type; facing 0 returns the input itself. */
export function rotTile(buf, facing, size = 16) {
  const fc = normFacing(facing);
  if (!fc || !buf) return buf;
  const out = new buf.constructor(buf.length);
  for (let v = 0; v < size; v++) for (let u = 0; u < size; u++) {
    const p = pxToScreen(u, v, size, size, fc);
    const si = (v * size + u) * 4, di = (p.y * size + p.x) * 4;
    out[di] = buf[si]; out[di + 1] = buf[si + 1]; out[di + 2] = buf[si + 2]; out[di + 3] = buf[si + 3];
  }
  return out;
}

/**
 * Which half of a double door a leaf paints ON THE SCREEN — 'l' / 'r' — or
 * null when the pair stands edge-on under this facing (or the leaf is no
 * pair). `door2` is board-ui's WORLD-space end: 'l' the west leaf / 'r' the
 * east leaf of a pair along a rank, 'n' / 's' the ends of a pair along a
 * file.
 */
export function doorHalf(door2, facing) {
  if (!door2) return null;
  switch (normFacing(facing)) {
    case 0: return door2 === 'l' || door2 === 'r' ? door2 : null;
    case 2: return door2 === 'l' ? 'r' : door2 === 'r' ? 'l' : null;
    case 1: return door2 === 'n' ? 'l' : door2 === 's' ? 'r' : null;
    default: return door2 === 'n' ? 'r' : door2 === 's' ? 'l' : null;
  }
}

/** Does a door stand EDGE-ON — its wall line running up the screen — under
 *  this facing? `doorLine` is board-ui's world-space line: 'ns' for a door
 *  between north / south walls, 'ew' otherwise. */
export function edgeOn(doorLine, facing) {
  const odd = (normFacing(facing) & 1) === 1;
  return doorLine === 'ns' ? !odd : odd;
}

/** What the edge coordinates label: along the bottom edge the thing that
 *  VARIES across the screen's columns, down the left edge the other. */
export function coordEdges(facing) {
  return normFacing(facing) & 1 ? { bottom: 'rank', left: 'file' } : { bottom: 'file', left: 'rank' };
}
